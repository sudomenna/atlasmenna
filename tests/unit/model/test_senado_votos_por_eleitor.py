"""Spec 022 RF-210 / spec 021 RF-195c — o Senado é contado em VOTOS no produtor.

O EA20 mistura duas unidades no mesmo arquivo: `e.te`/`e.esi`/`e.c`/`e.a` são
PESSOAS e `v.tv`/`v.vv`/`v.vb`/`v.tvn`/`v.van`/`v.vansj` são VOTOS. Num cargo de
um voto por eleitor elas coincidem; no Senado de 2026 (2 vagas) não. Medido nas
quatro capturas reais do simulado do TSE (cargo 5, eleição 21272, 100% apurado):
`v.tv == 2 × e.c` exato.

Antes da correção, medido nestas mesmas capturas (DF):
  - `participacao.validos` = 175,72% ⇒ achatado em 100% pelo clip ⇒
    `votacao.projetada.validos` = 1.862.765 (PESSOAS) contra 3.273.238 votos;
  - `participacao.brancos_nulos` = 11,82% contra 5,91% real;
  - Σ `pct_projetado_comparecimento` dos candidatos = 188%;
  - RF-212: Σ `votos_projetados` válidos − `projetada.validos` = +75,7%.

O contrato NÃO muda de unidade (decisão do dono, 2026-09-27): `contagens` segue
TSE-nativo. O que este arquivo protege é o PRODUTOR: a projeção sai na mesma
unidade que as contagens — votos em votos, pessoas em pessoas.

As capturas são agregados de UF; aqui cada uma entra no modelo como a "zona"
sentinela `cod_zona = 0` (o modo de granularidade `uf`), que é o mesmo caminho
de código das zonas reais com uma zona só. A 100% apurado a projeção tem de
reproduzir a verdade, que é conhecida exatamente.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import api.model.project as proj
from api.model import cargos
from api.model.project import (
    _parse_br_number,
    build_votacao_payload,
    build_votacao_uf_payloads,
    compute_participacao,
    compute_uf_projections,
)
from api.model.turnout import _votos_por_eleitor_valido

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "tse" / "2026-sim"
SENADO = FIXTURES / "senado"
UFS_SENADO = ("DF", "AC", "SP", "RS")
SEED = 20260927


def _carregar(uf: str) -> dict[str, Any]:
    return json.loads((SENADO / f"{uf.lower()}-c0005-e021272-u.json").read_text())


def _n(obj: dict[str, Any], chave: str) -> int:
    valor = _parse_br_number(obj[chave])
    assert valor is not None, chave
    return int(valor)


def _verdade(payload: dict[str, Any]) -> dict[str, int]:
    e, v = payload["e"], payload["v"]
    return {
        "te": _n(e, "te"),
        "esi": _n(e, "esi"),
        "c": _n(e, "c"),
        "a": _n(e, "a"),
        "tv": _n(v, "tv"),
        "vv": _n(v, "vv"),
        "vb": _n(v, "vb"),
        "tvn": _n(v, "tvn"),
        "van": _n(v, "van"),
        "vansj": _n(v, "vansj"),
    }


def _pipeline(cargo: int, payloads: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Roda o caminho de produção: `compute_uf_projections` →
    `compute_participacao(cand_by_uf=...)` → `build_votacao_*`."""
    snaps: list[dict[str, Any]] = []
    agregados: list[dict[str, Any]] = []
    eleitorado: dict[tuple[str, int], int] = {}
    for uf, payload in payloads.items():
        eleitorado[(uf, 1)] = _n(payload["e"], "te")
        base = {
            "uf": uf,
            "cod_zona": 0,
            "cod_municipio": 0,
            "pct_apurado": 100.0,
            "payload": payload,
            "ts": "2026-09-27T00:00:00+00:00",
        }
        snaps.append(dict(base))
        agregados.append({**base, "nivel": "uf"})
    _rows, _ev, _ec, cand_by_uf = compute_uf_projections(
        cargo, 1, SEED, snaps, eleitorado
    )
    part_uf, part_nac = compute_participacao(
        cargo, 1, SEED, snaps, eleitorado, cand_by_uf=cand_by_uf
    )
    return {
        "cand_by_uf": cand_by_uf,
        "part_uf": part_uf,
        "part_nac": part_nac,
        "votacao_uf": build_votacao_uf_payloads(agregados, cargo, part_uf),
        "votacao_nac": build_votacao_payload(agregados, cargo, part_nac),
    }


@pytest.fixture(scope="module")
def senado() -> dict[str, Any]:
    payloads = {uf: _carregar(uf) for uf in UFS_SENADO}
    return {"payloads": payloads, **_pipeline(5, payloads)}


# ---------------------------------------------------------------------------
# 0. A premissa medida — se o TSE mudar a forma de contar, este teste cai
#    primeiro e diz por quê.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_captura_real_tv_e_o_dobro_do_comparecimento(uf: str) -> None:
    t = _verdade(_carregar(uf))
    assert t["tv"] == 2 * t["c"]
    assert t["vv"] + t["vb"] + t["tvn"] + t["van"] + t["vansj"] == t["tv"]
    assert t["c"] + t["a"] == t["esi"]


# ---------------------------------------------------------------------------
# 1. De onde vem o fator — a MESMA tabela de `EdgePayloadUf.vagas`
# ---------------------------------------------------------------------------


def test_votos_por_eleitor_por_cargo() -> None:
    assert cargos.votos_por_eleitor(5) == 2
    assert cargos.votos_por_eleitor(5) == cargos.vagas_por_uf(5)
    assert cargos.votos_por_eleitor(1) == 1
    assert cargos.votos_por_eleitor(3) == 1
    # Proporcional: voto único, NÃO o tamanho da bancada.
    assert cargos.votos_por_eleitor(6) == 1


@pytest.mark.parametrize("cd", [0, 2, 4, 7, 91, 99])
def test_cargo_desconhecido_nao_tem_fator(cd: int) -> None:
    assert cargos.votos_por_eleitor(cd) is None


def test_majoritario_sem_vagas_declaradas_nao_supoe_2(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """O Senado com `vagas_por_uf` apagado da tabela NÃO vira 2 por
    conhecimento prévio nem 1 por default — vira `None`."""
    sem_vagas = {**cargos._POR_CD[5], "vagas_por_uf": None}
    monkeypatch.setitem(cargos._POR_CD, 5, sem_vagas)
    assert cargos.votos_por_eleitor(5) is None


@pytest.mark.parametrize("ruim", [0, -1, True, None, 2.0])
def test_fator_invalido_estoura(ruim: Any) -> None:
    with pytest.raises(ValueError):
        _votos_por_eleitor_valido(ruim)


# ---------------------------------------------------------------------------
# 2. `EdgeParticipacao` — votos sobre votos; abstenção pessoas sobre pessoas
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_participacao_de_voto_e_votos_sobre_votos(senado: dict[str, Any], uf: str) -> None:
    t = _verdade(senado["payloads"][uf])
    p = senado["part_uf"][uf]
    esperado = {
        "validos": t["vv"] / t["tv"],
        "brancos": t["vb"] / t["tv"],
        "nulos": t["tvn"] / t["tv"],
        # `brancos_nulos` sai do bootstrap dos candidatos (Fase 5) — o mesmo
        # que vira `EdgeParticipacao.brancos_nulos` na tela.
        "brancos_nulos": (t["vb"] + t["tvn"]) / t["tv"],
    }
    for metrica, frac in esperado.items():
        est = p[metrica]
        assert est is not None, metrica
        assert est["pct_atual"] == pytest.approx(100 * frac, abs=1e-4), metrica
        assert est["pct_projetado"] == pytest.approx(100 * frac, abs=1e-4), metrica


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_abstencao_continua_pessoas_sobre_pessoas(senado: dict[str, Any], uf: str) -> None:
    t = _verdade(senado["payloads"][uf])
    est = senado["part_uf"][uf]["abstencao"]
    assert est["pct_projetado"] == pytest.approx(100 * t["a"] / t["esi"], abs=1e-4)


def test_brancos_nulos_nacional_e_razao_de_somas_em_votos(senado: dict[str, Any]) -> None:
    ts = [_verdade(p) for p in senado["payloads"].values()]
    num = sum(t["vb"] + t["tvn"] for t in ts)
    den = sum(t["tv"] for t in ts)
    bn = senado["part_nac"]["brancos_nulos"]
    assert bn["num"] == num
    assert bn["den"] == den
    assert bn["pct_atual"] == pytest.approx(100 * num / den, abs=1e-4)


# ---------------------------------------------------------------------------
# 3. `votacao.projetada` — votos em votos, abstenção em pessoas
# ---------------------------------------------------------------------------

#: Arredondamento das frações em 5 casas (`_frac_to_pct`) × dezenas de milhões
#: de votos: SP dá +3. Folga de 10 votos, contra um defeito de milhões.
TOL_VOTOS = 10


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_projetada_da_uf_reproduz_a_verdade(senado: dict[str, Any], uf: str) -> None:
    t = _verdade(senado["payloads"][uf])
    projetada = senado["votacao_uf"][uf]["projetada"]
    assert abs(projetada["validos"] - t["vv"]) <= TOL_VOTOS
    assert abs(projetada["brancos"] - t["vb"]) <= TOL_VOTOS
    assert abs(projetada["nulos"] - t["tvn"]) <= TOL_VOTOS
    assert abs(projetada["abstencao"] - t["a"]) <= TOL_VOTOS


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_projetada_esta_na_unidade_das_contagens(senado: dict[str, Any], uf: str) -> None:
    """O cinza do arco 3 sai por subtração (RF-195). Com as fatias de voto em
    votos, o que sobra de `aptos × 2 − (v+b+n) − abstenção × 2` são os
    anulados + sub judice — não metade do eleitorado."""
    bloco = senado["votacao_uf"][uf]
    c, pj = bloco["contagens"], bloco["projetada"]
    residual = (
        2 * c["aptos"] - pj["validos"] - pj["brancos"] - pj["nulos"] - 2 * pj["abstencao"]
    )
    assert abs(residual - (c["anulados"] + c["sub_judice"])) <= 2 * TOL_VOTOS


def test_projetada_nacional_do_senado_soma_as_ufs(senado: dict[str, Any]) -> None:
    ts = [_verdade(p) for p in senado["payloads"].values()]
    pj = senado["votacao_nac"]["projetada"]
    n = len(ts)
    # Nacional = frações nacionais × Σ aptos; frações vêm ponderadas por
    # eleitorado, não por votos, então a tolerância é relativa (0,01%).
    assert pj["validos"] == pytest.approx(sum(t["vv"] for t in ts), rel=1e-4)
    assert pj["abstencao"] == pytest.approx(sum(t["a"] for t in ts), rel=1e-4)
    assert n == 4


# ---------------------------------------------------------------------------
# 4. RF-212 — o círculo de projeção da corrida usa `projetada.validos` como
#    total e a proporção de `votos_projetados`: os dois em VOTOS
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_rf212_soma_dos_validos_das_candidaturas_bate_projetada(
    senado: dict[str, Any], uf: str
) -> None:
    bloco = senado["votacao_uf"][uf]
    destino = {e["id"]: e.get("destino") for e in bloco["corrida"]}
    por_cand = senado["cand_by_uf"][uf]["por_candidato"]
    soma_validos = sum(
        c["votos_projetados"] for cid, c in por_cand.items() if destino.get(cid) == "valido"
    )
    total = bloco["projetada"]["validos"]
    assert abs(soma_validos - total) <= TOL_VOTOS
    assert abs(soma_validos - total) / total < 1e-5


# ---------------------------------------------------------------------------
# 5. Fase 5 — a base "comparecimento" dos candidatos também em votos
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("uf", UFS_SENADO)
def test_identidade_da_fase5_fecha_no_senado(senado: dict[str, Any], uf: str) -> None:
    """Σ share_comp(candidaturas) + brancos/nulos + anulados == 100%. Sem o
    fator dava 188% + 11,8% (DF)."""
    t = _verdade(senado["payloads"][uf])
    est = senado["cand_by_uf"][uf]
    soma = sum(c["pct_projetado_comparecimento"] for c in est["por_candidato"].values())
    bn = est["brancos_nulos_comparecimento"]["pct_projetado_comparecimento"]
    assert soma + bn + 100 * t["van"] / t["tv"] == pytest.approx(100.0, abs=1e-3)
    assert est["comparecimento_observado"] == t["tv"]


# ---------------------------------------------------------------------------
# 6. Sem fator declarado ⇒ não projeta (nunca supõe 1 nem 2)
# ---------------------------------------------------------------------------


def test_sem_fator_nao_projeta_voto_mas_mede_abstencao(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(proj, "cargo_votos_por_eleitor", lambda _cd: None)
    out = _pipeline(5, {"DF": _carregar("DF")})
    p = out["part_uf"]["DF"]
    for metrica in ("validos", "brancos", "nulos", "brancos_nulos"):
        assert p[metrica] is None, metrica
    assert p["abstencao"] is not None
    for metrica in ("validos", "brancos", "nulos", "brancos_nulos"):
        assert out["part_nac"][metrica] is None, metrica
    assert "projetada" not in out["votacao_uf"]["DF"]
    assert "projetada" not in out["votacao_nac"]
    # As contagens (TSE-nativas) continuam publicadas: é "aguardando
    # projeção", não "não sabemos".
    assert out["votacao_uf"]["DF"]["contagens"]["validos"] == 3273238


# ---------------------------------------------------------------------------
# 7. Presidente não muda — captura real de 100% apurado
# ---------------------------------------------------------------------------


def test_presidente_captura_real_projeta_a_verdade() -> None:
    payload = json.loads((FIXTURES / "br-c0001-e021270-u.json").read_text())
    t = _verdade(payload)
    assert t["tv"] == t["c"], "Presidente: um voto por eleitor"
    out = _pipeline(1, {"SP": payload})
    pj = out["votacao_uf"]["SP"]["projetada"]
    assert abs(pj["validos"] - t["vv"]) <= 200
    assert abs(pj["abstencao"] - t["a"]) <= 200
    bn = out["part_uf"]["SP"]["brancos_nulos"]
    assert bn["pct_atual"] == pytest.approx(100 * (t["vb"] + t["tvn"]) / t["c"], abs=1e-4)
