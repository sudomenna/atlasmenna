"""Spec 022 — a corrida em três círculos, lado do PRODUTOR (RF-203 / RF-209).

O que este arquivo protege, em ordem de perigo:

1. **Voto anulado nunca vira voto de candidato.** `cand[].dvt` é mapeado SEM
   default: ausente ou desconhecido ⇒ a entrada sai SEM `destino`. Na captura
   real do simulado do TSE o MAIS votado é `"Anulado sub judice"` — um
   "desconhecido ⇒ válido" o poria em 1º lugar no círculo dos válidos.
2. **Soma por partido só com destino conhecido.** Qualquer candidatura com
   voto e sem destino, em qualquer UF, OMITE `corrida_por_partido` e publica
   `destino_pendente: true`.
3. **Corrida e contagens saem da MESMA linha agregada** — é o que faz o
   círculo fechar por identidade do TSE.
4. **UF do Presidente tem contagens da UF mesmo com a linha `br` presente**
   (o `return` antecipado de `somar_contagens_agregadas` não pode vazar para
   as UFs), e `BR` nunca é UF.
5. Deputado Federal não ganha corrida (RF-200).

Números de verdade: `tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`
(Presidente, Brasil) e `ac-c0003-e021272-u.json` (Governador, AC) — capturas
reais do simulado de 16/09.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from api.model import project as proj
from api.model.project import (
    NIVEL_BR,
    NIVEL_UF,
    build_votacao_payload,
    build_votacao_uf_payloads,
    destino_do_dvt,
    destino_pendente,
    extrair_corrida,
    montar_corrida_nacional,
    somar_contagens_agregadas,
    somar_corrida_por_partido,
)

_SIM = Path(__file__).resolve().parents[2] / "fixtures" / "tse" / "2026-sim"
FIXTURE_BR_PRESIDENTE = _SIM / "br-c0001-e021270-u.json"
FIXTURE_AC_GOVERNADOR = _SIM / "ac-c0003-e021272-u.json"


def _carregar(p: Path) -> dict[str, Any]:
    return json.loads(p.read_text())


def _snap(uf: str, payload: dict[str, Any], *, nivel: str = NIVEL_UF, ts: int = 100) -> dict[str, Any]:
    return {
        "uf": uf,
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "nivel": nivel,
        "pct_apurado": 100.0,
        "payload": payload,
        "ts": ts,
    }


def _ea20(
    cargo: int,
    cands: list[tuple[int, str, int, str | None]],
    *,
    te: int = 1_000,
    van: int = 0,
    vansj: int = 0,
    extra_vv: int = 0,
) -> dict[str, Any]:
    """Agregado EA20 mínimo e ARITMETICAMENTE FECHADO.

    `cands`: `(número, sigla, vap, dvt)`; `dvt=None` ⇒ chave ausente. `vv` é
    Σ vap das `Válido` (identidade do TSE, conferida na captura real);
    `extra_vv` existe só para o teste que quer a identidade QUEBRADA.
    """
    vv = sum(v for _n, _s, v, d in cands if d == "Válido") + extra_vv
    c = vv + van + vansj
    par = []
    for n, sg, vap, dvt in cands:
        cand: dict[str, Any] = {"n": str(n), "nm": f"CANDIDATO {n}", "vap": str(vap)}
        if dvt is not None:
            cand["dvt"] = dvt
        par.append({"n": str(n), "sg": sg, "cand": [cand]})
    return {
        "carg": [{"cd": str(cargo), "agr": [{"n": "1", "par": par}]}],
        "e": {"te": str(te), "esi": str(te), "c": str(c), "a": str(te - c)},
        "v": {
            "vv": str(vv),
            "vvc": str(c),
            "vb": "0",
            "tvn": "0",
            "van": str(van),
            "vansj": str(vansj),
        },
        "s": {"psa": "100,00"},
    }


@pytest.fixture
def avisos(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, dict[str, Any]]]:
    """Captura as linhas de `_log` — o aviso do dvt desconhecido é contrato."""
    linhas: list[tuple[str, str, dict[str, Any]]] = []
    monkeypatch.setattr(proj, "_log", lambda level, msg, **ctx: linhas.append((level, msg, ctx)))
    return linhas


# ---------------------------------------------------------------------------
# 1. O mapeamento de `dvt` — sem default
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("dvt", "esperado"),
    [
        ("Válido", "valido"),
        ("Anulado", "anulado"),
        ("Anulado sub judice", "sub_judice"),
        ("  Anulado sub judice  ", "sub_judice"),
    ],
)
def test_dvt_conhecido(dvt: str, esperado: str) -> None:
    assert destino_do_dvt(dvt) == esperado


@pytest.mark.parametrize("dvt", [None, "", "   "])
def test_dvt_ausente_sai_sem_destino_e_sem_aviso(dvt: Any, avisos: list) -> None:
    """Ausente é o estado NORMAL antes da 1ª totalização parcial."""
    assert destino_do_dvt(dvt) is None
    assert avisos == []


@pytest.mark.parametrize(
    "dvt",
    [
        "Valido",  # sem acento — não é o que o TSE publica
        "Válido (legenda)",  # proporcional: voto da legenda, não do nome
        "Cassado",
        "Anulado sub-judice",
    ],
)
def test_dvt_desconhecido_sai_sem_destino_e_avisa(dvt: str, avisos: list) -> None:
    """🔴 Nunca "desconhecido ⇒ válido"."""
    assert destino_do_dvt(dvt) is None
    assert len(avisos) == 1
    assert avisos[0][0] == "warn"
    assert avisos[0][2]["dvt"] == dvt.strip()


# ---------------------------------------------------------------------------
# 2. `extrair_corrida` contra as capturas reais
# ---------------------------------------------------------------------------


def test_captura_br_valido_fecha_em_vv_e_sub_judice_em_vansj() -> None:
    d = _carregar(FIXTURE_BR_PRESIDENTE)
    corrida = extrair_corrida(d, 1)
    assert corrida is not None
    assert len(corrida) == 13
    assert all("destino" in e for e in corrida)

    def soma(destino: str) -> int:
        return sum(e["votos"] for e in corrida if e.get("destino") == destino)

    assert soma("valido") == int(d["v"]["vv"]) == 100_982_116
    assert soma("sub_judice") == int(d["v"]["vansj"]) == 10_503_573
    # ⚠️ Na captura BR o `van` (9.218.887) NÃO é Σ vap `Anulado` (9.075.260):
    # 143.627 votos anulados do TSE não estão em candidatura nenhuma. Por isso
    # a tela usa `contagens.anulados`, não a soma da corrida, no círculo 2.
    assert soma("anulado") == 9_075_260
    assert int(d["v"]["van"]) - soma("anulado") == 143_627


def test_captura_br_o_mais_votado_e_sub_judice() -> None:
    """O fato do Contexto da spec: sem `destino`, o 1º lugar seria anulado."""
    corrida = extrair_corrida(_carregar(FIXTURE_BR_PRESIDENTE), 1)
    assert corrida is not None
    topo = max(corrida, key=lambda e: e["votos"])
    assert topo == {"id": 57, "partido": "P 9998", "votos": 10_503_573, "destino": "sub_judice"}
    validos = [e for e in corrida if e.get("destino") == "valido"]
    assert max(validos, key=lambda e: e["votos"])["id"] == 89


def test_captura_ac_governador() -> None:
    d = _carregar(FIXTURE_AC_GOVERNADOR)
    corrida = extrair_corrida(d, 3)
    assert corrida is not None
    assert len(corrida) == 9
    assert sum(e["votos"] for e in corrida if e.get("destino") == "valido") == 449_936
    assert [e["id"] for e in corrida if e.get("destino") == "sub_judice"] == [72]
    # Filtro por cargo: o arquivo é de Governador.
    assert extrair_corrida(d, 1) is None


def test_ordem_por_id_e_forma_do_contrato() -> None:
    corrida = extrair_corrida(_carregar(FIXTURE_BR_PRESIDENTE), 1)
    assert corrida is not None
    assert [e["id"] for e in corrida] == sorted(e["id"] for e in corrida)
    for e in corrida:
        assert set(e) <= {"id", "partido", "votos", "destino"}
        assert isinstance(e["id"], int)
        assert isinstance(e["votos"], int)
        assert isinstance(e["partido"], str) and e["partido"]


def test_dvt_ausente_na_captura_real_tira_so_o_destino() -> None:
    d = _carregar(FIXTURE_BR_PRESIDENTE)
    for c in d["carg"][0]["agr"][0]["par"][0]["cand"]:
        del c["dvt"]
    corrida = extrair_corrida(d, 1)
    assert corrida is not None
    sem = [e for e in corrida if "destino" not in e]
    assert [e["id"] for e in sem] == [60]
    assert sem[0]["votos"] == 9_075_260, "o voto continua lá; só o destino some"
    assert destino_pendente(corrida) is True


def test_arquivo_sem_candidatura_e_nao_sabemos_nao_lista_vazia() -> None:
    assert extrair_corrida({"e": {"te": "10"}, "v": {}}, 1) is None
    assert extrair_corrida(_ea20(1, []), 1) is None


def test_candidatura_sem_sigla_ou_sem_vap_fica_fora(avisos: list) -> None:
    payload = _ea20(1, [(13, "PT", 10, "Válido"), (22, "PL", 5, "Válido")])
    par = payload["carg"][0]["agr"][0]["par"]
    par[1]["sg"] = ""
    del par[0]["cand"][0]["vap"]
    assert extrair_corrida(payload, 1) is None
    assert len(avisos) == 2


# ---------------------------------------------------------------------------
# 3. `destino_pendente`
# ---------------------------------------------------------------------------


def test_pendente_so_conta_quem_tem_voto() -> None:
    assert destino_pendente([{"id": 1, "partido": "A", "votos": 0}]) is False
    assert destino_pendente([{"id": 1, "partido": "A", "votos": 1}]) is True
    assert (
        destino_pendente(
            [
                {"id": 1, "partido": "A", "votos": 10, "destino": "valido"},
                {"id": 2, "partido": "B", "votos": 0},
            ]
        )
        is False
    )


# ---------------------------------------------------------------------------
# 4. Nacional — Presidente por candidatura, Gov/Sen por partido
# ---------------------------------------------------------------------------


def test_presidente_nacional_publica_corrida_da_linha_br() -> None:
    d = _carregar(FIXTURE_BR_PRESIDENTE)
    br = _snap("BR", d, nivel=NIVEL_BR)
    # Uma UF com números diferentes: se a corrida viesse dela, o teste acusa.
    uf = _snap("AC", _ea20(1, [(13, "PT", 7, "Válido")], te=50))
    bloco = build_votacao_payload([uf, br], cargo=1)
    assert bloco is not None
    assert "corrida_por_partido" not in bloco
    assert "destino_pendente" not in bloco
    assert bloco["corrida"] == extrair_corrida(d, 1)
    # Mesma linha ⇒ fecha por identidade do TSE.
    assert (
        sum(e["votos"] for e in bloco["corrida"] if e.get("destino") == "valido")
        == bloco["contagens"]["validos"]
    )


def test_presidente_nacional_com_destino_ausente_marca_pendente() -> None:
    d = _carregar(FIXTURE_BR_PRESIDENTE)
    del d["carg"][0]["agr"][0]["par"][0]["cand"][0]["dvt"]
    bloco = build_votacao_payload([_snap("BR", d, nivel=NIVEL_BR)], cargo=1)
    assert bloco is not None
    assert bloco["destino_pendente"] is True
    assert len(bloco["corrida"]) == 13, "a corrida por candidatura continua publicada"


def test_presidente_sem_linha_br_soma_as_ufs_e_fecha() -> None:
    sp = _snap("SP", _ea20(1, [(13, "PT", 60, "Válido"), (22, "PL", 30, "Válido"), (40, "PSB", 5, "Anulado")], van=5))
    rj = _snap("RJ", _ea20(1, [(13, "PT", 20, "Válido"), (22, "PL", 40, "Válido"), (40, "PSB", 2, "Anulado")], van=2))
    bloco = build_votacao_payload([sp, rj], cargo=1)
    assert bloco is not None
    assert bloco["corrida"] == [
        {"id": 13, "partido": "PT", "votos": 80, "destino": "valido"},
        {"id": 22, "partido": "PL", "votos": 70, "destino": "valido"},
        {"id": 40, "partido": "PSB", "votos": 7, "destino": "anulado"},
    ]
    assert bloco["contagens"]["validos"] == 150


def test_presidente_sem_br_destino_divergente_entre_ufs_sai_sem_destino(avisos: list) -> None:
    sp = _snap("SP", _ea20(1, [(13, "PT", 60, "Válido")]))
    rj = _snap("RJ", _ea20(1, [(13, "PT", 20, "Anulado")], van=20))
    corrida = montar_corrida_nacional([sp, rj], 1)
    assert corrida["corrida"] == [{"id": 13, "partido": "PT", "votos": 80}]
    assert corrida["destino_pendente"] is True
    assert any("divergente" in msg for _l, msg, _c in avisos)


def test_presidente_sem_br_uma_uf_sem_destino_tira_o_destino_da_soma() -> None:
    sp = _snap("SP", _ea20(1, [(13, "PT", 60, "Válido")]))
    rj = _snap("RJ", _ea20(1, [(13, "PT", 20, None)]))
    corrida = montar_corrida_nacional([sp, rj], 1)
    assert "destino" not in corrida["corrida"][0]
    assert corrida["destino_pendente"] is True


@pytest.mark.parametrize("cargo", [3, 5])
def test_gov_sen_nacional_por_partido_so_valido(cargo: int) -> None:
    sp = _snap(
        "SP",
        _ea20(
            cargo,
            [(13, "PT", 100, "Válido"), (22, "PL", 90, "Válido"), (45, "PSDB", 999, "Anulado sub judice")],
            vansj=999,
        ),
    )
    rj = _snap(
        "RJ",
        _ea20(cargo, [(13, "PT", 10, "Válido"), (22, "PL", 50, "Anulado"), (45, "PSDB", 30, "Válido")], van=50),
    )
    bloco = build_votacao_payload([sp, rj], cargo=cargo)
    assert bloco is not None
    assert "corrida" not in bloco, "27 corridas não têm 1º colocado nacional (RF-201)"
    assert "destino_pendente" not in bloco
    assert bloco["corrida_por_partido"] == [
        {"partido": "PL", "votos_validos": 90},
        {"partido": "PSDB", "votos_validos": 30},
        {"partido": "PT", "votos_validos": 110},
    ]
    assert sum(p["votos_validos"] for p in bloco["corrida_por_partido"]) == bloco["contagens"]["validos"]


@pytest.mark.parametrize("cargo", [3, 5])
def test_gov_sen_uma_candidatura_pendente_em_uma_uf_omite_a_soma(cargo: int) -> None:
    sp = _snap("SP", _ea20(cargo, [(13, "PT", 100, "Válido"), (22, "PL", 90, "Válido")]))
    rj = _snap("RJ", _ea20(cargo, [(13, "PT", 10, "Válido"), (22, "PL", 1, None)]))
    bloco = build_votacao_payload([sp, rj], cargo=cargo)
    assert bloco is not None
    assert bloco["destino_pendente"] is True
    assert "corrida_por_partido" not in bloco
    assert "corrida" not in bloco


def test_gov_sen_pendente_com_zero_voto_nao_trava() -> None:
    sp = _snap("SP", _ea20(3, [(13, "PT", 100, "Válido"), (22, "PL", 0, None)]))
    bloco = build_votacao_payload([sp], cargo=3)
    assert bloco is not None
    assert "destino_pendente" not in bloco
    assert bloco["corrida_por_partido"] == [{"partido": "PT", "votos_validos": 100}]


def test_gov_uf_agregada_sem_candidaturas_omite_a_soma_nacional() -> None:
    sp = _snap("SP", _ea20(3, [(13, "PT", 100, "Válido")]))
    rj = _snap("RJ", {"e": {"te": "100", "esi": "100", "c": "50", "a": "50"}, "v": {"vv": "50"}})
    bloco = build_votacao_payload([sp, rj], cargo=3)
    assert bloco is not None
    assert set(bloco) == {"contagens"}, "soma parcial não fecharia contra validos"


def test_gov_linha_br_nao_entra_na_soma_por_partido() -> None:
    sp = _snap("SP", _ea20(3, [(13, "PT", 100, "Válido")]))
    br_rotulada_uf = _snap("BR", _ea20(3, [(13, "PT", 5_000, "Válido")]))
    br = _snap("BR", _ea20(3, [(13, "PT", 7_000, "Válido")]), nivel=NIVEL_BR)
    bloco = build_votacao_payload([sp, br_rotulada_uf, br], cargo=3)
    assert bloco is not None
    assert bloco["corrida_por_partido"] == [{"partido": "PT", "votos_validos": 100}]


def test_somar_corrida_por_partido_ignora_pendente_e_anulado() -> None:
    """Unidade: a função só soma `valido`. O caller é quem não a chama com
    pendência — este teste prova o filtro, o de cima prova o caller."""
    assert somar_corrida_por_partido(
        [
            [
                {"id": 1, "partido": "A", "votos": 10, "destino": "valido"},
                {"id": 2, "partido": "A", "votos": 99},
                {"id": 3, "partido": "B", "votos": 50, "destino": "anulado"},
                {"id": 4, "partido": "C", "votos": 7, "destino": "sub_judice"},
            ]
        ]
    ) == [{"partido": "A", "votos_validos": 10}]


def test_deputado_nao_ganha_corrida() -> None:
    sp = _snap("SP", _ea20(6, [(1301, "PT", 100, "Válido")]))
    bloco = build_votacao_payload([sp], cargo=6)
    assert bloco is not None
    assert set(bloco) == {"contagens"}
    assert montar_corrida_nacional([sp], 6) == {}
    # Spec 021 RF-192 emendado (26/09 noite): a UF de Deputado ganhou o painel
    # "Votação" — contagens, e NUNCA corrida (RF-200).
    por_uf = build_votacao_uf_payloads([sp], 6)
    assert set(por_uf) == {"SP"}
    assert set(por_uf["SP"]) == {"contagens"}


# ---------------------------------------------------------------------------
# 5. `votacao` de cada UF
# ---------------------------------------------------------------------------


def test_presidente_uf_tem_contagens_da_uf_mesmo_com_linha_br() -> None:
    """🔴 O `return` antecipado do cargo 1 em `somar_contagens_agregadas` não
    pode deixar as UFs do Presidente sem contagens por UF."""
    br = _snap("BR", _carregar(FIXTURE_BR_PRESIDENTE), nivel=NIVEL_BR)
    ac = _snap("AC", _ea20(1, [(13, "PT", 70, "Válido"), (22, "PL", 20, "Anulado")], te=200, van=20))
    por_uf = build_votacao_uf_payloads([br, ac], 1)
    assert set(por_uf) == {"AC"}
    assert por_uf["AC"]["contagens"]["aptos"] == 200
    assert por_uf["AC"]["contagens"]["validos"] == 70
    assert por_uf["AC"]["corrida"] == [
        {"id": 13, "partido": "PT", "votos": 70, "destino": "valido"},
        {"id": 22, "partido": "PL", "votos": 20, "destino": "anulado"},
    ]
    # E o nacional continua vindo da linha BR, não da UF.
    assert somar_contagens_agregadas([br, ac], 1)["aptos"] != 200  # type: ignore[index]


def test_uf_de_governador_real() -> None:
    d = _carregar(FIXTURE_AC_GOVERNADOR)
    por_uf = build_votacao_uf_payloads([_snap("AC", d)], 3)
    bloco = por_uf["AC"]
    assert set(bloco) == {"contagens", "corrida"}, "sem projetada; sem pendência"
    validos = sum(e["votos"] for e in bloco["corrida"] if e.get("destino") == "valido")
    assert validos == bloco["contagens"]["validos"] == 449_936
    assert bloco["contagens"]["sub_judice"] == 54_758


def test_uf_com_destino_ausente_marca_pendente() -> None:
    por_uf = build_votacao_uf_payloads([_snap("SP", _ea20(5, [(131, "PT", 10, None)]))], 5)
    assert por_uf["SP"]["destino_pendente"] is True
    assert por_uf["SP"]["corrida"] == [{"id": 131, "partido": "PT", "votos": 10}]


def test_uf_sem_candidaturas_publica_so_contagens() -> None:
    sem = {"e": {"te": "100", "esi": "100", "c": "0", "a": "0"}, "v": {}}
    por_uf = build_votacao_uf_payloads([_snap("SP", sem)], 3)
    assert set(por_uf["SP"]) == {"contagens"}


def test_br_nunca_e_uf_nem_rotulada_como_uf() -> None:
    linha = _ea20(1, [(13, "PT", 10, "Válido")])
    por_uf = build_votacao_uf_payloads(
        [
            _snap("BR", linha, nivel=NIVEL_BR),
            _snap("BR", copy.deepcopy(linha)),
            _snap("", copy.deepcopy(linha)),
            _snap("sp", copy.deepcopy(linha)),
        ],
        1,
    )
    assert set(por_uf) == {"SP"}


def test_uf_sem_eleitorado_nao_vira_zero() -> None:
    sem_te = _ea20(3, [(13, "PT", 10, "Válido")])
    sem_te["e"]["te"] = "0"
    assert build_votacao_uf_payloads([_snap("SP", sem_te)], 3) == {}


# ---------------------------------------------------------------------------
# 6. `projetada` de cada UF (spec 021 RF-192 emendado, 2026-09-26 noite)
#
# O painel "Votação" saiu das capas de Governador/Senador/Deputado e entrou
# nas telas de UF. O arco 3 da UF usa a MESMA regra do nacional
# (`projetar_fatias_em_contagens`) sobre as contagens e a participação
# projetada DA UF. Nunca a nacional no lugar.
# ---------------------------------------------------------------------------


def _est(pct: float) -> dict[str, Any]:
    """`ParticipacaoEstimate` mínimo — só `pct_projetado` é lido."""
    return {"pct_atual": pct, "pct_projetado": pct, "lower": pct, "upper": pct, "n_zonas": 1}


def _part(abst: float, validos: float, brancos: float, nulos: float) -> dict[str, Any]:
    return {
        "abstencao": _est(abst),
        "validos": _est(validos),
        "brancos": _est(brancos),
        "nulos": _est(nulos),
    }


def test_projetada_da_uf_usa_a_participacao_DA_UF() -> None:
    """🔴 O caso que discrimina: duas UFs com participações DIFERENTES. Se a
    função aplicasse a participação de outra UF (ou uma só para todas), ao
    menos uma das duas sairia errada."""
    sp = _snap("SP", _ea20(3, [(13, "PT", 10, "Válido")], te=1_000))
    rj = _snap("RJ", _ea20(3, [(13, "PT", 10, "Válido")], te=2_000))
    por_uf = build_votacao_uf_payloads(
        [sp, rj],
        3,
        {"SP": _part(10.0, 80.0, 5.0, 5.0), "RJ": _part(30.0, 70.0, 10.0, 10.0)},
    )
    # SP: abstenção 10% de 1.000 = 100; comparecimento 900.
    assert por_uf["SP"]["projetada"] == {
        "validos": 720,
        "brancos": 45,
        "nulos": 45,
        "abstencao": 100,
    }
    # RJ: abstenção 30% de 2.000 = 600; comparecimento 1.400.
    assert por_uf["RJ"]["projetada"] == {
        "validos": 980,
        "brancos": 140,
        "nulos": 140,
        "abstencao": 600,
    }


def test_projetada_da_uf_e_a_mesma_regra_do_nacional() -> None:
    """A UF não tem aritmética própria: é `projetar_fatias_em_contagens` sobre
    as contagens DA UF — a função do nacional."""
    sp = _snap("SP", _ea20(1, [(13, "PT", 300, "Válido")], te=1_000, van=20, vansj=10))
    part = _part(12.3, 81.0, 4.4, 3.3)
    por_uf = build_votacao_uf_payloads([sp], 1, {"SP": part})
    assert por_uf["SP"]["projetada"] == proj.projetar_fatias_em_contagens(
        por_uf["SP"]["contagens"], part
    )


def test_uf_sem_participacao_propria_nao_herda_a_de_outra() -> None:
    """Sem participação DA UF ⇒ sem `projetada` (arco 3 "aguardando",
    RF-195) — mesmo que outra UF tenha. Nunca um número emprestado."""
    sp = _snap("SP", _ea20(5, [(13, "PT", 10, "Válido")]))
    rj = _snap("RJ", _ea20(5, [(13, "PT", 10, "Válido")]))
    por_uf = build_votacao_uf_payloads([sp, rj], 5, {"SP": _part(10.0, 80.0, 5.0, 5.0)})
    assert "projetada" in por_uf["SP"]
    assert "projetada" not in por_uf["RJ"]
    assert "contagens" in por_uf["RJ"], "a contagem continua publicada"


def test_uf_com_participacao_incompleta_nao_projeta_parcial() -> None:
    sp = _snap("SP", _ea20(3, [(13, "PT", 10, "Válido")]))
    part = _part(10.0, 80.0, 5.0, 5.0)
    part["nulos"] = None
    assert "projetada" not in build_votacao_uf_payloads([sp], 3, {"SP": part})["SP"]


def test_sem_participacao_nenhuma_nao_ha_projetada() -> None:
    """Chamador legado (sem o 3º argumento) e o ciclo de Deputado."""
    sp = _snap("SP", _ea20(3, [(13, "PT", 10, "Válido")]))
    assert "projetada" not in build_votacao_uf_payloads([sp], 3)["SP"]


def test_deputado_uf_com_participacao_projeta_mas_nunca_tem_corrida() -> None:
    sp = _snap("SP", _ea20(6, [(1301, "PT", 100, "Válido")]))
    por_uf = build_votacao_uf_payloads([sp], 6, {"SP": _part(10.0, 80.0, 5.0, 5.0)})
    assert set(por_uf["SP"]) == {"contagens", "projetada"}


def test_deputado_uf_sem_agregado_omite_a_uf() -> None:
    """Sem linha agregada da UF ⇒ a UF não aparece: "não sabemos", nunca
    zeros. A zona (`nivel` zona) não conta."""
    zona = _snap("SP", _ea20(6, [(1301, "PT", 100, "Válido")]), nivel="zona")
    assert build_votacao_uf_payloads([zona], 6) == {}


def test_cargo_fora_da_lista_nao_publica_votacao_de_uf() -> None:
    # Até 2026-09-29 o exemplo era o cargo 7; a spec 027 o pôs na lista (o
    # painel "Votação" das Assembleias). O 2 (Vice-Presidente) segue fora.
    sp = _snap("SP", _ea20(3, [(13, "PT", 10, "Válido")]))
    assert build_votacao_uf_payloads([sp], 2) == {}
