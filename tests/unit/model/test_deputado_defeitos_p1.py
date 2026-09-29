"""Os três defeitos do Deputado Federal corrigidos em 2026-09-29 (spec 026, P1).

1. **Destino do voto (`cand.dvt`, ADR-B).** `extrair_entrada_proporcional`
   usava `cand.vap` — voto COMPUTADO, que inclui o de candidatura anulada ou
   sub judice — e entregava tudo ao quociente eleitoral. Agora segue o TSE:
   só `"Válido"` (ou `dvt` ausente) vira candidato; `"Válido (legenda)"` vai
   para a legenda; anulado e sub judice ficam fora de QE e QP. No AP do
   simulado a regra antiga dava 2 das 8 cadeiras a chapas sub judice.
2. **`% apurado` da UF.** Era `max()` sobre o `pct_apurado` das linhas — e
   esse campo é `s.psa`, binário no feed. A primeira zona a fechar punha o
   estado inteiro em 100% (RR a 20% dizia 100%), desligando o "indefinido".
3. **Conferência.** No modo por zona a entrada somada não tem `qe`/`vag`, e a
   conferência devolvia sempre `[]` — a tela dizia "batem" sem comparar nada.
   Agora ela roda sobre o agregado da UF e mede também a cobertura.

Os casos reais vêm de `tests/fixtures/tse/2026-sim/dep/` (RR e AP, simulado de
28/09, ver o README de lá). Cada bloco tem o caso que a mutação correspondente
derruba (anulado↔sub judice trocados, sinal da legenda invertido, `max` no
lugar da ponderação, o caminho antigo da conferência, `tvtn`/`tvtl`
ignorados).
"""

from __future__ import annotations

import copy
import json
import pathlib
from typing import Any

import pytest

from api.model.cadeiras import Agremiacao, Candidato, distribuir_cadeiras
from api.model.deputado import (
    DESTINO_ANULADO,
    DESTINO_DESCONHECIDO,
    DESTINO_SUB_JUDICE,
    DESTINO_VALIDO,
    DESTINO_VALIDO_LEGENDA,
    PREFIXO_COLIGACAO,
    anomalias_de_leitura,
    combinar_entradas,
    conferir_agregado_da_uf,
    destino_proporcional,
    extrair_entrada_proporcional,
    status_tse_do_candidato,
)
from api.model.deputado_payload import (
    UfProporcional,
    construir_detalhe_uf,
    normalizar_divergencia,
)
from api.model.project import pct_apurado_uf_proporcional
from tests.unit.model.test_deputado_payload import (  # noqa: F401 — `ciclo_deputado` é fixture
    _envelope_de_zona,
    ciclo_deputado,
)

FIXTURES_SIMULADO = pathlib.Path(__file__).parents[2] / "fixtures" / "tse" / "2026-sim"
DEP = FIXTURES_SIMULADO / "dep"


def _ler(caminho: pathlib.Path) -> dict[str, Any]:
    return json.loads(caminho.read_text())


# ---------------------------------------------------------------------------
# Construtores — o formato real do EA20, em miniatura
# ---------------------------------------------------------------------------


def _cand(
    sq: int,
    votos: int,
    *,
    dvt: str | None = None,
    st: str | None = None,
    e: str = "n",
) -> dict[str, Any]:
    c: dict[str, Any] = {
        "n": str(1000 + sq),
        "sqcand": str(sq),
        "nm": f"CANDIDATO {sq}",
        "nmu": f"C{sq}",
        "e": e,
        "vap": str(votos),
    }
    if dvt is not None:
        c["dvt"] = dvt
    if st is not None:
        c["st"] = st
    return c


def _par(
    numero: str,
    sigla: str,
    cands: list[dict[str, Any]],
    *,
    tvtl: int,
    tvtn: int | None = None,
) -> dict[str, Any]:
    p: dict[str, Any] = {
        "n": numero,
        "sg": sigla,
        "nm": f"Partido {sigla}",
        "tvtl": str(tvtl),
        "cand": cands,
    }
    if tvtn is not None:
        p["tvtn"] = str(tvtn)
    return p


def _agr(numero: str, pars: list[dict[str, Any]], *, tp: str = "i", **extra: Any) -> dict[str, Any]:
    return {"n": numero, "nm": f"Agremiação {numero}", "tp": tp, "par": pars, **extra}


def _env(
    agrs: list[dict[str, Any]],
    *,
    nv: str = "4",
    qe: str | None = None,
    tf: str = "n",
    andamento: str | None = None,
    vv: int | None = None,
    te: int | None = None,
    dg: str | None = None,
    hg: str | None = None,
) -> dict[str, Any]:
    carg: dict[str, Any] = {"cd": "6", "nv": nv, "agr": agrs}
    if qe is not None:
        carg["qe"] = qe
    env: dict[str, Any] = {"tf": tf, "carg": [carg]}
    if andamento is not None:
        env["and"] = andamento
    if vv is not None:
        env["v"] = {"vv": str(vv)}
    if te is not None:
        env["e"] = {"te": str(te), "esi": str(te)}
    if dg is not None:
        env["dg"] = dg
    if hg is not None:
        env["hg"] = hg
    return env


def _por_cod(entrada) -> dict[str, Agremiacao]:
    return {a.cod: a for a in entrada.agremiacoes}


# ---------------------------------------------------------------------------
# 1. Destino do voto — o mapa dos quatro valores do dicionário
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("dvt", "esperado"),
    [
        ("Válido", DESTINO_VALIDO),
        ("VÁLIDO", DESTINO_VALIDO),
        (" Válido (legenda) ", DESTINO_VALIDO_LEGENDA),
        ("Anulado", DESTINO_ANULADO),
        ("Anulado sub judice", DESTINO_SUB_JUDICE),
        ("anulado SUB JUDICE", DESTINO_SUB_JUDICE),
        (None, None),
        ("", None),
        ("   ", None),
        ("Cassado", DESTINO_DESCONHECIDO),
    ],
)
def test_destino_proporcional_segue_o_dicionario_sem_default(dvt: Any, esperado: str | None) -> None:
    """Os QUATRO valores de `cand.dvt` do dicionário; ausente é `None` (válido);
    fora do dicionário é `desconhecido` — nunca "válido" por omissão."""
    assert destino_proporcional(dvt) == esperado


def _cenario_destinos(tvtn: int = 1000, tvtl: int = 350) -> dict[str, Any]:
    """PA com um candidato de cada destino; PB de controle, só válido.

        PA: A válido 1.000 · B "Válido (legenda)" 300 · C anulado 200 ·
            D sub judice 150 · E "Cassado" (fora do dicionário) 50
            legenda própria 50
        PB: F válido 900, legenda 100

    Default no formato MEDIDO do TSE (README de `dep/`): `tvtn` = Σ válido
    (1.000) e `tvtl` = legenda + o voto "Válido (legenda)" (50 + 300).
    Válido do TSE: PA = 1.350 · PB = 1.000 · `v.vv` = 2.350.
    """
    return _env(
        [
            _agr(
                "10",
                [
                    _par(
                        "10",
                        "PA",
                        [
                            _cand(1, 1000, dvt="Válido"),
                            _cand(2, 300, dvt="Válido (legenda)"),
                            _cand(3, 200, dvt="Anulado"),
                            _cand(4, 150, dvt="Anulado sub judice"),
                            _cand(5, 50, dvt="Cassado"),
                        ],
                        tvtl=tvtl,
                        tvtn=tvtn,
                    )
                ],
            ),
            _agr("20", [_par("20", "PB", [_cand(6, 900, dvt="Válido")], tvtl=100, tvtn=900)]),
        ],
        vv=2350,
    )


def test_so_valido_vira_candidato_e_os_outros_saem_com_destino() -> None:
    e = extrair_entrada_proporcional(_cenario_destinos())
    agr = _por_cod(e)

    assert [c.cod for c in agr["10"].candidatos] == [1], (
        "só o válido disputa vaga — legenda, anulado, sub judice e desconhecido ficam fora"
    )
    assert e.votos_fora_do_calculo == {2: 300, 3: 200, 4: 150, 5: 50}
    # A identidade existe para TODOS — a tela lista o anulado também.
    assert {sq: i.destino for sq, i in e.identidade_candidatos.items()} == {
        1: DESTINO_VALIDO,
        2: DESTINO_VALIDO_LEGENDA,
        3: DESTINO_ANULADO,
        4: DESTINO_SUB_JUDICE,
        5: DESTINO_DESCONHECIDO,
        6: DESTINO_VALIDO,
    }
    assert e.identidade_candidatos[3].numero == "1003"
    assert e.valores_desconhecidos == ("dvt=Cassado",)


@pytest.mark.parametrize(
    ("tvtn", "tvtl"),
    [
        # O TSE põe o voto "Válido (legenda)" em `tvtl` (medido em 417
        # arquivos reais: `tvtl = tval + Σ vap[Válido (legenda)]`)…
        (1000, 350),
        # …e a regra daria o mesmo se ele estivesse em `tvtn`. É o ponto de
        # subtrair do TOTAL válido do partido, e não somar peças.
        (1300, 50),
    ],
)
def test_legenda_e_o_total_valido_do_partido_menos_os_nominais_do_calculo(
    tvtn: int, tvtl: int
) -> None:
    e = extrair_entrada_proporcional(_cenario_destinos(tvtn=tvtn, tvtl=tvtl))
    agr = _por_cod(e)

    assert agr["10"].votos_legenda == 350
    assert agr["10"].votos_totais == 1350
    assert agr["20"].votos_legenda == 100
    assert e.legendas_recalculadas == ()


def test_invariante_soma_das_agremiacoes_fecha_com_vv() -> None:
    e = extrair_entrada_proporcional(_cenario_destinos())
    assert (e.votos_validos_tse, e.soma_validos, e.diferenca_validos) == (2350, 2350, 0)
    assert anomalias_de_leitura([e]) == {
        "n_leituras": 1,
        "n_validos_divergentes": 0,
        "maior_diferenca_validos": 0,
        "legendas_recalculadas": [],
        "valores_desconhecidos": ["dvt=Cassado"],
    }


def test_invariante_quebrada_e_reportada() -> None:
    env = _cenario_destinos()
    env["v"]["vv"] = "2500"  # 150 a mais que a soma das agremiações
    e = extrair_entrada_proporcional(env)

    assert e.diferenca_validos == -150
    anomalias = anomalias_de_leitura([e])
    assert anomalias is not None
    assert anomalias["n_validos_divergentes"] == 1
    assert anomalias["maior_diferenca_validos"] == -150


def test_sem_vv_nao_ha_invariante_a_conferir() -> None:
    env = _cenario_destinos()
    del env["v"]
    e = extrair_entrada_proporcional(env)
    assert e.votos_validos_tse is None
    assert e.diferenca_validos is None
    assert anomalias_de_leitura([e]) == {
        "n_leituras": 1,
        "n_validos_divergentes": 0,
        "maior_diferenca_validos": 0,
        "legendas_recalculadas": [],
        "valores_desconhecidos": ["dvt=Cassado"],
    }


def test_leitura_limpa_nao_gera_anomalia() -> None:
    env = _cenario_destinos()
    env["carg"][0]["agr"][0]["par"][0]["cand"].pop()  # tira o "Cassado"
    env["v"]["vv"] = "2350"
    assert anomalias_de_leitura([extrair_entrada_proporcional(env)]) is None


def test_legenda_negativa_cai_em_tvtl_e_fica_registrada() -> None:
    """`tvtn` menor que os nominais válidos do próprio arquivo é dado
    inconsistente: a conta daria legenda NEGATIVA (0 + 350 − 1.000). O recurso
    é `tvtl` — que, no formato medido, já traz o voto "Válido (legenda)".
    Somá-lo de novo (a redação original da regra) daria 650."""
    env = _env(
        [
            _agr(
                "10",
                [
                    _par(
                        "10",
                        "PA",
                        [_cand(1, 1000, dvt="Válido"), _cand(2, 300, dvt="Válido (legenda)")],
                        tvtl=350,
                        tvtn=0,
                    )
                ],
            )
        ]
    )
    e = extrair_entrada_proporcional(env)

    assert _por_cod(e)["10"].votos_legenda == 350
    assert e.legendas_recalculadas == ("10",)
    anomalias = anomalias_de_leitura([e])
    assert anomalias is not None and anomalias["legendas_recalculadas"] == ["10"]


def test_tvtn_ausente_usa_tvtl() -> None:
    env = _env(
        [
            _agr(
                "10",
                [
                    _par(
                        "10",
                        "PA",
                        [
                            _cand(1, 1000, dvt="Válido"),
                            _cand(2, 300, dvt="Válido (legenda)"),
                            _cand(3, 999, dvt="Anulado"),
                        ],
                        tvtl=350,
                    )
                ],
            )
        ]
    )
    e = extrair_entrada_proporcional(env)
    assert _por_cod(e)["10"].votos_legenda == 350
    assert [c.cod for c in _por_cod(e)["10"].candidatos] == [1]
    assert e.legendas_recalculadas == ()


def test_federacao_soma_a_legenda_partido_a_partido() -> None:
    """PT: 500 válidos + 20 de legenda. PV: 300 válido, 100 de candidatura
    "Válido (legenda)" (em `tvtl`, como o TSE faz), 80 anulados, 30 de
    legenda própria. Legenda da federação = 20 + 130 = 150."""
    env = _env(
        [
            _agr(
                "99",
                [
                    _par("13", "PT", [_cand(1, 500, dvt="Válido")], tvtl=20, tvtn=500),
                    _par(
                        "43",
                        "PV",
                        [
                            _cand(2, 300, dvt="Válido"),
                            _cand(3, 100, dvt="Válido (legenda)"),
                            _cand(4, 80, dvt="Anulado"),
                        ],
                        tvtl=130,
                        tvtn=300,
                    ),
                ],
                tp="f",
                tvtl="150",
            )
        ],
        vv=950,
    )
    e = extrair_entrada_proporcional(env)
    fed = _por_cod(e)["99"]

    assert [c.cod for c in fed.candidatos] == [1, 2]
    assert fed.votos_legenda == 150
    assert e.diferenca_validos == 0


# --- casos reais do simulado de 28/09 ---------------------------------------


def test_ap_final_chapas_sub_judice_nao_levam_cadeira() -> None:
    """AP, totalização final: quatro chapas inteiras sub judice (P 9962,
    9964, 9965, 9988 — ~21 mil votos computados cada, `tvtn = 0`). Com a
    regra antiga (`vap`), P 9964 e P 9988 levavam as cadeiras que o TSE deu a
    P 9971 e P 9972 — 2 das 8. Com o `dvt`, a conta é a do TSE."""
    payload = _ler(DEP / "ap" / "m3-final-tf" / "ap-c0006-e021272-u.json")
    e = extrair_entrada_proporcional(payload)
    sigla = {c: i.sigla for c, i in e.identidade_agremiacoes.items()}

    novo = distribuir_cadeiras(e.agremiacoes, 8)
    antigo = distribuir_cadeiras(_referencia_pre_adr_b(payload), 8)

    def _com_cadeira(r) -> set[str]:
        return {sigla[c] for c, n in r.cadeiras.items() if n}

    assert novo.quociente_eleitoral == e.quociente_eleitoral_tse == 55655
    assert dict(novo.cadeiras) == {c: n for c, n in e.vagas_tse.items()} | {
        c: 0 for c in novo.cadeiras if c not in e.vagas_tse
    }
    assert _com_cadeira(novo) - _com_cadeira(antigo) == {"P 9971", "P 9972"}
    assert _com_cadeira(antigo) - _com_cadeira(novo) == {"P 9964", "P 9988"}
    assert antigo.quociente_eleitoral == 66199, "a regra antiga inflava o QE em 19%"


def test_rr_candidatura_valido_legenda_vota_para_o_partido() -> None:
    """RR: a candidatura 41619111 (P 9997, nº 6607) tem `dvt = "Válido
    (legenda)"`: não disputa vaga, e os 152 votos já estão no `tvtl` do
    partido (323 = 171 de `tval` + 152)."""
    e = extrair_entrada_proporcional(_ler(DEP / "rr" / "m3-final-tf" / "rr-c0006-e021272-u.json"))
    ident = e.identidade_candidatos[41619111]
    p9997 = _por_cod(e)[ident.agremiacao]

    assert ident.destino == DESTINO_VALIDO_LEGENDA
    assert ident.numero == "6607"
    assert 41619111 not in {c.cod for c in p9997.candidatos}
    assert e.votos_fora_do_calculo[41619111] == 152
    assert p9997.votos_legenda == 323
    assert e.diferenca_validos == 0


# ---------------------------------------------------------------------------
# 1b. `dvt` ausente — bit-idêntico ao cálculo anterior ao ADR-B
# ---------------------------------------------------------------------------


def _referencia_pre_adr_b(payload: Any, cargo: int = 6) -> list[Agremiacao]:
    """O laço de `extrair_entrada_proporcional` como estava em `239c7a9`,
    reduzido ao que chega a `distribuir_cadeiras`. Congelado aqui de propósito:
    é a régua da bit-identidade, não código de produção."""

    def _i(raw: Any, default: int = 0) -> int:
        if raw is None:
            return default
        t = str(raw).strip().replace(".", "").replace(" ", "")
        if not t:
            return default
        try:
            return int(t)
        except ValueError:
            return default

    def _nasc(raw: Any) -> int | None:
        if raw is None:
            return None
        p = str(raw).strip().split("/")
        if len(p) != 3 or not all(x.isdigit() for x in p) or len(p[2]) != 4:
            return None
        return int(p[2]) * 10_000 + int(p[1]) * 100 + int(p[0])

    raiz = payload
    if isinstance(payload, dict) and isinstance(payload.get("abr"), list) and payload["abr"]:
        raiz = payload["abr"][0]
    out: list[Agremiacao] = []
    for carg in raiz.get("carg") or []:
        if _i(carg.get("cd"), -1) != cargo:
            continue
        for agr in carg.get("agr") or []:
            tipo = str(agr.get("tp", "")).strip().lower()
            numero = str(agr.get("n", "")).strip()
            if not numero:
                continue
            cod = f"{PREFIXO_COLIGACAO}{numero}" if tipo == "c" else numero
            cands: list[Candidato] = []
            leg_par = 0
            for par in agr.get("par") or []:
                leg_par += _i(par.get("tvtl"))
                for c in par.get("cand") or []:
                    sq = str(c.get("sqcand") or "").strip()
                    if not sq.isdigit():
                        continue
                    cands.append(Candidato(int(sq), _i(c.get("vap")), _nasc(c.get("dt"))))
            legenda = _i(agr.get("tvtl"), default=leg_par)
            if agr.get("tvtl") is None:
                legenda = leg_par
            out.append(Agremiacao(cod=cod, votos_legenda=legenda, candidatos=tuple(cands)))
        return out
    return out


def _sem_dvt(payload: Any) -> Any:
    """Cópia do envelope com TODO `dvt` removido (candidato e partido)."""
    copia = copy.deepcopy(payload)

    def _limpa(no: Any) -> None:
        if isinstance(no, dict):
            no.pop("dvt", None)
            for v in no.values():
                _limpa(v)
        elif isinstance(no, list):
            for v in no:
                _limpa(v)

    _limpa(copia)
    return copia


def _arquivos_reais() -> list[tuple[pathlib.Path, int]]:
    """Todos os envelopes EA20 reais do simulado de 2026 no repositório — os de
    cargo 6 de RR e AP (`dep/`) e os de cargo 1/3/5 (mesmo formato de
    `agr/par/cand`) —, com o cargo de cada um."""
    saida = []
    for arq in sorted(FIXTURES_SIMULADO.rglob("*.json")):
        for cargo in (1, 3, 5, 6):
            if f"-c000{cargo}-" in arq.name:
                saida.append((arq, cargo))
    return saida


_REAIS = _arquivos_reais()
_IDS = [str(a.relative_to(FIXTURES_SIMULADO)) for a, _ in _REAIS]


def test_ha_arquivos_reais_de_deputado_para_medir() -> None:
    """Sem isto, os paramétricos abaixo passariam vazios se a pasta sumisse."""
    assert sum(1 for _, cargo in _REAIS if cargo == 6) >= 20
    assert len(_REAIS) >= 50


def _envelopes_sinteticos_sem_dvt() -> list[dict[str, Any]]:
    """Casos em que o caminho NOVO daria número diferente se fosse tomado:
    `tvtn` inconsistente, `agr.tvtl` diferente da soma dos `par.tvtl`,
    candidato sem `sqcand`, e o anulado que só `dvt` revelaria."""
    return [
        _env(
            [
                _agr(
                    "10",
                    [
                        _par(
                            "10",
                            "PA",
                            [_cand(1, 1000), _cand(2, 300), _cand(3, 200)],
                            tvtl=50,
                            tvtn=99_999,
                        )
                    ],
                ),
                _agr(
                    "99",
                    [
                        _par("13", "PT", [_cand(4, 500)], tvtl=40, tvtn=1),
                        _par("43", "PV", [_cand(5, 400), {"n": "4399", "vap": "77"}], tvtl=40),
                    ],
                    tp="f",
                    tvtl="77",
                ),
            ],
            vv=123,
        ),
        _cenario_destinos(),
    ]


@pytest.mark.parametrize("env", _envelopes_sinteticos_sem_dvt())
def test_dvt_ausente_e_bit_identico_ao_calculo_anterior_sintetico(env: dict[str, Any]) -> None:
    sem = _sem_dvt(env)
    e = extrair_entrada_proporcional(sem)
    assert e.agremiacoes == _referencia_pre_adr_b(sem)
    assert e.votos_fora_do_calculo == {}
    assert e.legendas_recalculadas == ()


@pytest.mark.parametrize(("arquivo", "cargo"), _REAIS, ids=_IDS)
def test_dvt_ausente_e_bit_identico_ao_calculo_anterior_real(
    arquivo: pathlib.Path, cargo: int
) -> None:
    sem = _sem_dvt(_ler(arquivo))
    e = extrair_entrada_proporcional(sem, cargo=cargo)
    ref = _referencia_pre_adr_b(sem, cargo=cargo)
    assert e.agremiacoes == ref
    nv = e.lugares_a_preencher or 1
    assert distribuir_cadeiras(e.agremiacoes, nv) == distribuir_cadeiras(ref, nv)


@pytest.mark.parametrize(("arquivo", "cargo"), _REAIS, ids=_IDS)
def test_regra_do_dvt_fecha_com_o_vv_do_tse_em_todo_arquivo_real(
    arquivo: pathlib.Path, cargo: int
) -> None:
    """Com a regra do `dvt`, a soma das agremiações é EXATAMENTE o `v.vv` do TSE
    em todo envelope real do simulado. Com a regra antiga (`vap`), sobra em
    cada arquivo exatamente o voto que ficou fora do cálculo — o anulado e o
    sub judice, que iam para o quociente, e o "Válido (legenda)", contado duas
    vezes (no candidato e no `tvtl`)."""
    payload = _ler(arquivo)
    e = extrair_entrada_proporcional(payload, cargo=cargo)
    assert e.votos_validos_tse is not None
    assert e.diferenca_validos == 0
    assert e.legendas_recalculadas == ()

    antiga = sum(a.votos_totais for a in _referencia_pre_adr_b(payload, cargo=cargo))
    assert antiga - e.votos_validos_tse == sum(e.votos_fora_do_calculo.values())


def test_a_regra_antiga_nao_fechava_na_maioria_dos_arquivos_reais() -> None:
    """O par do teste acima, para ele não passar num conjunto sem anulados."""
    abertos = 0
    for arquivo, cargo in _REAIS:
        payload = _ler(arquivo)
        vv = extrair_entrada_proporcional(payload, cargo=cargo).votos_validos_tse
        antiga = sum(a.votos_totais for a in _referencia_pre_adr_b(payload, cargo=cargo))
        abertos += antiga != vv
    assert abertos >= 40, abertos


# ---------------------------------------------------------------------------
# Combinação de zonas — o que é somado e o que não é
# ---------------------------------------------------------------------------


def test_combinar_soma_os_votos_fora_e_o_vv_e_zera_a_situacao_oficial() -> None:
    a = extrair_entrada_proporcional(_cenario_destinos() | {"tf": "s"})
    b = extrair_entrada_proporcional(_cenario_destinos() | {"tf": "s"})
    c = combinar_entradas([a, b])

    assert c.votos_fora_do_calculo == {2: 600, 3: 400, 4: 300, 5: 100}
    assert c.votos_validos_tse == 4700
    assert c.diferenca_validos == 0
    assert c.status_tse == {}, "a marca oficial vem do agregado da UF, não da soma"


def test_combinar_sem_vv_em_alguma_linha_nao_inventa_vv() -> None:
    com = extrair_entrada_proporcional(_cenario_destinos())
    sem_env = _cenario_destinos()
    del sem_env["v"]
    sem = extrair_entrada_proporcional(sem_env)
    assert combinar_entradas([com, sem]).votos_validos_tse is None


def test_combinar_prefere_a_identidade_que_ja_tem_destino() -> None:
    """A ordem das zonas não pode decidir se a tela sabe que a candidatura foi
    anulada: a leitura sem `dvt` cede para a que o tem."""
    antes = extrair_entrada_proporcional(_sem_dvt(_cenario_destinos()))
    depois = extrair_entrada_proporcional(_cenario_destinos())
    c = combinar_entradas([antes, depois])
    assert c.identidade_candidatos[3].destino == DESTINO_ANULADO


# ---------------------------------------------------------------------------
# 2. Situação oficial (`cand.st`) — a marca "Eleito (TSE)"
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("st", "e", "esperado"),
    [
        ("Eleito por QP", "s", ("eleito_qp", None)),
        ("Eleito por média", "s", ("eleito_media", None)),
        ("Eleito por media", "s", ("eleito_media", None)),
        ("Eleito", "s", ("eleito", None)),
        ("Suplente", "n", ("suplente", None)),
        ("Não eleito", "n", ("nao_eleito", None)),
        # `2º turno` vem com `e == "s"`; cair no `e` diria "eleito".
        ("2º turno", "s", (None, "2º turno")),
        # `st` vazio (o feed publica `""` antes do fim) é ausente.
        ("", "s", ("eleito", None)),
        (None, "s", ("eleito", None)),
        (None, "n", (None, None)),
    ],
)
def test_status_tse_mapeia_o_st_do_dicionario(
    st: str | None, e: str, esperado: tuple[str | None, str | None]
) -> None:
    assert status_tse_do_candidato(_cand(1, 10, st=st, e=e)) == esperado


def test_status_tse_so_e_lido_com_totalizacao_final() -> None:
    agrs = [
        _agr(
            "10",
            [
                _par(
                    "10",
                    "PA",
                    [
                        _cand(1, 1000, st="Eleito por QP", e="s"),
                        _cand(2, 300, st="Suplente"),
                        _cand(3, 200, st="Não eleito"),
                    ],
                    tvtl=0,
                )
            ],
        )
    ]
    assert extrair_entrada_proporcional(_env(agrs, tf="s")).status_tse == {
        1: "eleito_qp",
        2: "suplente",
        3: "nao_eleito",
    }
    assert extrair_entrada_proporcional(_env(agrs, tf="n")).status_tse == {}


def test_status_tse_real_de_rr_guarda_o_rotulo_do_tse() -> None:
    """RR final: o TSE rotula 3 eleitos "por QP" e 5 "por média" — e não bate
    com a divisão `floor(votos/QE)`, que daria 6 por QP. A marca guarda o
    rótulo do TSE como veio; a conferência compara o CONJUNTO, não a via."""
    e = extrair_entrada_proporcional(_ler(DEP / "rr" / "m3-final-tf" / "rr-c0006-e021272-u.json"))
    marcas = list(e.status_tse.values())
    assert marcas.count("eleito_qp") == 3
    assert marcas.count("eleito_media") == 5
    assert {"suplente", "nao_eleito"} <= set(marcas)


# ---------------------------------------------------------------------------
# 3. Conferência contra o agregado da UF
# ---------------------------------------------------------------------------


def _agregado_conferivel(
    *,
    qe: str | None,
    vag: dict[str, int] | None,
    tf: str = "n",
    andamento: str = "p",
    st_do_7: str = "Eleito por média",
) -> dict[str, Any]:
    """4 vagas, 10.000 válidos, QE 2.500 — e um candidato sub judice com 5.000
    votos COMPUTADOS em C, que o TSE deixa fora. Eleitorado 50.000.

        A: 3.000 + 1.000 + 500 + 500 de legenda = 5.000 → QP 2
        B: 2.000 +   500 + 400 + 100 de legenda = 3.000 → QP 1
        C: 1.500 +   400       + 100 de legenda = 2.000 → QP 0
        4ª vaga em sobras: médias A 1.666, B 1.500, C 2.000 → C.

    Resultado: A 2, B 1, C 1. Com o voto sub judice contado (regra antiga),
    C teria 7.000 e o QE subiria para 3.750.
    """
    agrs = [
        _agr(
            "10",
            [
                _par(
                    "10",
                    "PA",
                    [
                        _cand(1, 3000, st="Eleito por QP", e="s"),
                        _cand(2, 1000, st="Eleito por QP", e="s"),
                        _cand(3, 500, st="Suplente"),
                    ],
                    tvtl=500,
                )
            ],
        ),
        _agr(
            "20",
            [
                _par(
                    "20",
                    "PB",
                    [
                        _cand(4, 2000, st="Eleito por QP", e="s"),
                        _cand(5, 500, st="Suplente"),
                        _cand(6, 400, st="Suplente"),
                    ],
                    tvtl=100,
                )
            ],
        ),
        _agr(
            "30",
            [
                _par(
                    "30",
                    "PC",
                    [
                        _cand(7, 1500, dvt="Válido", st=st_do_7, e="s"),
                        _cand(8, 400, dvt="Válido", st="Suplente"),
                        _cand(9, 5000, dvt="Anulado sub judice", st="Não eleito"),
                    ],
                    tvtl=100,
                    tvtn=1900,
                )
            ],
        ),
    ]
    if vag is not None:
        for agr in agrs:
            if agr["n"] in vag:
                agr["vag"] = str(vag[agr["n"]])
    return _env(
        agrs,
        nv="4",
        qe=qe,
        tf=tf,
        andamento=andamento,
        vv=10_000,
        te=50_000,
        dg="04/10/2026",
        hg="20:15:30",
    )


_VAG_CERTA = {"10": 2, "20": 1, "30": 1}


def test_conferencia_sem_agregado_e_sem_dado_tse() -> None:
    c = conferir_agregado_da_uf(None)
    assert (c.estado, c.motivo, c.boletim_dado_ts, c.divergencias) == (
        "sem_dado_tse",
        "sem_agregado",
        None,
        (),
    )


def test_conferencia_sem_qe_nem_vag_publicados_e_sem_dado_tse() -> None:
    c = conferir_agregado_da_uf(_agregado_conferivel(qe=None, vag=None))
    assert (c.estado, c.motivo) == ("sem_dado_tse", "tse_nao_publicou")
    assert c.boletim_dado_ts == "2026-10-04T23:15:30+00:00"


def test_conferencia_ignora_vag_velho_de_apuracao_nao_iniciada() -> None:
    """Com `and == "n"` o `vag` é da rodada ANTERIOR (medido no simulado) e o
    `qe` é `"0"`. Conferir contra ele acusaria (ou confirmaria) à toa."""
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="0", vag={"10": 4, "20": 0, "30": 0}, andamento="n")
    )
    assert (c.estado, c.motivo, c.divergencias) == ("sem_dado_tse", "apuracao_nao_iniciada", ())


def test_conferencia_confere_quando_a_conta_bate_com_o_tse() -> None:
    c = conferir_agregado_da_uf(_agregado_conferivel(qe="2500", vag=_VAG_CERTA))
    assert (c.estado, c.motivo, c.divergencias) == ("confere", None, ())
    assert c.totalizacao_final is False


def test_conferencia_diverge_quando_o_tse_da_outra_cadeira() -> None:
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="2501", vag={"10": 3, "20": 1, "30": 0}, tf="s", andamento="f")
    )
    assert c.estado == "diverge"
    assert c.totalizacao_final is True
    assert [(d.o_que, d.nosso, d.tse) for d in c.divergencias] == [
        ("quociente_eleitoral", 2500, 2501),
        ("cadeiras[10]", 2, 3),
        ("cadeiras[30]", 1, 0),
    ]


def test_conferencia_com_totalizacao_final_compara_o_conjunto_de_eleitos() -> None:
    """Mesmas cadeiras por agremiação, mas o TSE marca o 8 (e não o 7) como
    eleito em C: a conta de cadeiras bate e a de nomes, não."""
    env = _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f", st_do_7="Suplente")
    env["carg"][0]["agr"][2]["par"][0]["cand"][1]["st"] = "Eleito por média"
    c = conferir_agregado_da_uf(env)

    assert c.estado == "diverge"
    assert [(d.o_que, d.nosso, d.tse) for d in c.divergencias] == [
        ("eleito[7]", 1, 0),
        ("eleito[8]", 0, 1),
    ]
    linha = normalizar_divergencia(c.divergencias[0])
    assert linha["o_que"] == "eleitos"
    assert linha["detalhe"].startswith("candidatura 7 — C7 (PC)")


def test_conferencia_nao_compara_a_via_qp_ou_media() -> None:
    """O rótulo do TSE (QP × média) não segue `floor(votos/QE)`: trocar o
    rótulo sem trocar quem é eleito não pode acusar nada."""
    env = _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f")
    for agr in env["carg"][0]["agr"]:
        for cand in agr["par"][0]["cand"]:
            if cand.get("st", "").startswith("Eleito"):
                cand["st"] = "Eleito por média"
    assert conferir_agregado_da_uf(env).estado == "confere"


def test_conferencia_acusa_eleitorado_que_nao_esta_na_nossa_soma() -> None:
    """O caso real do AP: a zona 0014 de Macapá não era lida. A conta sobre o
    agregado confere; a soma que publicamos não cobre o estado — e a
    divergência leva a magnitude para a tela explicar."""
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="2500", vag=_VAG_CERTA), eleitorado_lido=40_250
    )
    assert c.estado == "diverge"
    assert [(d.o_que, d.nosso, d.tse) for d in c.divergencias] == [("eleitorado", 40_250, 50_000)]
    assert "80.5%" in c.divergencias[0].detalhe


def test_conferencia_de_cobertura_vale_antes_do_primeiro_boletim() -> None:
    """Zona que não lemos é estrutural — aparece já com `and == "n"`."""
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="0", vag=None, andamento="n"), eleitorado_lido=40_250
    )
    assert c.estado == "diverge"
    assert c.motivo == "apuracao_nao_iniciada"


def test_conferencia_cobertura_completa_nao_acusa() -> None:
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="2500", vag=_VAG_CERTA), eleitorado_lido=50_000
    )
    assert c.estado == "confere"


def test_conferencia_carrega_a_situacao_oficial_do_agregado() -> None:
    c = conferir_agregado_da_uf(
        _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f")
    )
    assert c.estado == "confere"
    assert c.entrada is not None
    assert c.entrada.status_tse == {
        1: "eleito_qp",
        2: "eleito_qp",
        3: "suplente",
        4: "eleito_qp",
        5: "suplente",
        6: "suplente",
        7: "eleito_media",
        8: "suplente",
        9: "nao_eleito",
    }


# --- casos reais -------------------------------------------------------------


@pytest.mark.parametrize(
    ("uf", "momento", "estado", "motivo"),
    [
        ("rr", "m0-zero", "sem_dado_tse", "apuracao_nao_iniciada"),
        ("rr", "m1-inicial-pst20", "confere", None),
        ("rr", "m2-tardio-pst94", "confere", None),
        ("rr", "m3-final-tf", "confere", None),
        ("ap", "m1-inicial-pst34", "confere", None),
        ("ap", "m2-tardio-pst84", "confere", None),
        ("ap", "m3-final-tf", "confere", None),
    ],
)
def test_conferencia_real_do_simulado(uf: str, momento: str, estado: str, motivo: str | None) -> None:
    """A conta sobre cada agregado real confere com o TSE — cadeiras, QE e, no
    final, o conjunto de eleitos."""
    c = conferir_agregado_da_uf(_ler(DEP / uf / momento / f"{uf}-c0006-e021272-u.json"))
    assert (c.estado, c.motivo, c.divergencias) == (estado, motivo, ())


def test_rr_empate_a_20_por_cento_reproduz_o_desempate_do_tse() -> None:
    """RR a 20%: P 9979 e P 9980 empatados em 21.262 votos, QP 2 cada. O TSE
    deu a sobra a P 9980 (3 × 2) — e a nossa conta também."""
    payload = _ler(DEP / "rr" / "m1-inicial-pst20" / "rr-c0006-e021272-u.json")
    e = extrair_entrada_proporcional(payload)
    r = distribuir_cadeiras(e.agremiacoes, 8)
    por_sigla = {e.identidade_agremiacoes[a.cod].sigla: a for a in e.agremiacoes}

    assert por_sigla["P 9979"].votos_totais == por_sigla["P 9980"].votos_totais == 21262
    assert r.cadeiras[por_sigla["P 9980"].cod] == 3
    assert r.cadeiras[por_sigla["P 9979"].cod] == 2
    assert r.empates_indeterminados == []
    assert conferir_agregado_da_uf(payload).estado == "confere"


def _linhas_do_resumo(uf: str, momento: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """As linhas de zona de um momento real (`zonas-resumo.json`), reduzidas ao
    que a conta do `% apurado` e a cobertura leem (`e.te`, `e.esi`), com o
    `pct_apurado` como o banco grava (`s.psa`: 0 ou 100)."""
    resumo = _ler(DEP / uf / "zonas-resumo.json")["momentos"][momento]
    linhas = [
        {
            "uf": uf.upper(),
            "cod_zona": z["zona"],
            "pct_apurado": 0.0 if z["and"] == "n" else 100.0,
            "payload": {"e": {"te": str(z["te"]), "esi": str(z["esi"])}},
        }
        for z in resumo["zonas"]
    ]
    ag = resumo["agregado"]
    agregado = {
        "uf": uf.upper(),
        "pct_apurado": 100.0,
        "payload": {"e": {"te": str(ag["te"]), "esi": str(ag["esi"])}},
    }
    return linhas, agregado


def test_ap_conferencia_real_acusa_a_zona_de_macapa_que_nao_lemos() -> None:
    """AP, momento tardio: as 17 zonas lidas somam 505.610 eleitores; o
    agregado do TSE, 628.071. A conferência diz "diverge" com a magnitude."""
    linhas, _ = _linhas_do_resumo("ap", "tardio")
    eleitorado_lido = sum(int(linha["payload"]["e"]["te"]) for linha in linhas)
    c = conferir_agregado_da_uf(
        _ler(DEP / "ap" / "m2-tardio-pst84" / "ap-c0006-e021272-u.json"),
        eleitorado_lido=eleitorado_lido,
    )
    assert c.estado == "diverge"
    assert [(d.o_que, d.nosso, d.tse) for d in c.divergencias] == [
        ("eleitorado", 505_610, 628_071)
    ]
    assert "80.5%" in c.divergencias[0].detalhe


def test_detalhe_da_uf_publica_conferencia_e_marca_tse() -> None:
    env = _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f")
    entrada = extrair_entrada_proporcional(env)
    uf = UfProporcional(
        uf="SP",
        pct_apurado=100.0,
        entrada=entrada,
        resultado=distribuir_cadeiras(entrada.agremiacoes, 4),
        conferencia=conferir_agregado_da_uf(env),
    )
    detalhe = construir_detalhe_uf(
        dados=uf, ts_iso="2026-10-04T23:20:00+00:00", cargo=6, turno=1, divergencias=[]
    )

    assert detalhe["conferencia"] == {
        "estado": "confere",
        "boletim_dado_ts": "2026-10-04T23:15:30+00:00",
        "totalizacao_final": True,
        "divergencias": [],
    }
    por_cod = {a["cod"]: a for a in detalhe["agremiacoes"]}
    assert [(c["sqcand"], c.get("tse")) for c in por_cod["30"]["eleitos"]] == [(7, "eleito_media")]
    assert [(c["sqcand"], c.get("tse")) for c in por_cod["10"]["suplentes"]] == [(3, "suplente")]


def test_detalhe_sem_conferencia_omite_a_chave_leitor_v1() -> None:
    env = _agregado_conferivel(qe="2500", vag=None)
    entrada = extrair_entrada_proporcional(env)
    uf = UfProporcional(
        uf="SP",
        pct_apurado=100.0,
        entrada=entrada,
        resultado=distribuir_cadeiras(entrada.agremiacoes, 4),
    )
    detalhe = construir_detalhe_uf(
        dados=uf, ts_iso="2026-10-04T23:20:00+00:00", cargo=6, turno=1, divergencias=[]
    )
    assert "conferencia" not in detalhe
    assert all("tse" not in c for a in detalhe["agremiacoes"] for c in a["eleitos"])


# --- no ciclo, modo por zona: o defeito original ----------------------------


def _linha_zona(
    cod_zona: int, envelope: dict[str, Any], *, te: int, esi: int, pct: float = 100.0
) -> dict[str, Any]:
    payload = copy.deepcopy(envelope)
    payload["e"] = {"te": str(te), "esi": str(esi)}
    return {
        "cargo": 6,
        "turno": 1,
        "uf": "SP",
        "cod_municipio_tse": 71072 + cod_zona,
        "cod_zona": cod_zona,
        "pct_apurado": pct,
        "payload": payload,
    }


def _linha_agregado(envelope: dict[str, Any]) -> dict[str, Any]:
    return {
        "cargo": 6,
        "turno": 1,
        "uf": "SP",
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "nivel": "uf",
        "pct_apurado": 100.0,
        "payload": envelope,
    }


def _rodar_ciclo_com_alertas(ciclo, monkeypatch, linhas, **kw):
    from api.model import project as proj

    alertas: list[tuple] = []
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )
    status, _r, publicados = ciclo(linhas, **kw)
    assert status == 200
    return publicados[0], alertas


def _zonas_de_sp() -> list[dict[str, Any]]:
    """Duas zonas que somam o eleitorado do agregado sintético (50.000)."""
    return [
        _linha_zona(1, _envelope_de_zona("10"), te=20_000, esi=20_000),
        _linha_zona(2, _envelope_de_zona("20"), te=30_000, esi=30_000),
    ]


def _alertas_de_conferencia(alertas: list[tuple]) -> list[tuple]:
    return [a for a in alertas if "conferência de Deputado Federal" in a[1]]


def test_ciclo_por_zona_diverge_com_totalizacao_final_e_alarma(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    """O defeito: com as zonas somadas, `qe`/`vag` somem e a conferência dava
    `[]` — a tela dizia "batem". Agora o agregado da UF diverge, o ciclo
    alarma, e `divergencias` (o campo v1) diz o mesmo que `conferencia`."""
    agregado = _agregado_conferivel(
        qe="2500", vag={"10": 3, "20": 1, "30": 0}, tf="s", andamento="f"
    )
    (_payload, detalhes), alertas = _rodar_ciclo_com_alertas(
        ciclo_deputado, monkeypatch, [*_zonas_de_sp(), _linha_agregado(agregado)]
    )

    conf = detalhes["SP"]["conferencia"]
    assert conf["estado"] == "diverge"
    assert conf["totalizacao_final"] is True
    assert {d["o_que"] for d in conf["divergencias"]} == {"cadeiras"}
    assert detalhes["SP"]["divergencias"] == conf["divergencias"]
    alarmes = _alertas_de_conferencia(alertas)
    assert alarmes and alarmes[0][2]["o_que"] == ["cadeiras"], alertas


def test_ciclo_por_zona_diverge_parcial_nao_alarma(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    agregado = _agregado_conferivel(qe="2500", vag={"10": 3, "20": 1, "30": 0}, tf="n")
    (_payload, detalhes), alertas = _rodar_ciclo_com_alertas(
        ciclo_deputado, monkeypatch, [*_zonas_de_sp(), _linha_agregado(agregado)]
    )
    assert detalhes["SP"]["conferencia"]["estado"] == "diverge"
    assert detalhes["SP"]["conferencia"]["totalizacao_final"] is False
    assert not _alertas_de_conferencia(alertas)


def test_ciclo_por_zona_confere(ciclo_deputado, monkeypatch: pytest.MonkeyPatch) -> None:
    agregado = _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f")
    (_payload, detalhes), alertas = _rodar_ciclo_com_alertas(
        ciclo_deputado, monkeypatch, [*_zonas_de_sp(), _linha_agregado(agregado)]
    )
    assert detalhes["SP"]["conferencia"] == {
        "estado": "confere",
        "boletim_dado_ts": "2026-10-04T23:15:30+00:00",
        "totalizacao_final": True,
        "divergencias": [],
    }
    assert detalhes["SP"]["divergencias"] == []
    assert not _alertas_de_conferencia(alertas)


def test_ciclo_por_zona_com_zona_faltando_diverge_e_alarma_no_final(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Só a zona 1 (20.000 de 50.000) na soma — o AP de 28/09 em miniatura."""
    agregado = _agregado_conferivel(qe="2500", vag=_VAG_CERTA, tf="s", andamento="f")
    (_payload, detalhes), alertas = _rodar_ciclo_com_alertas(
        ciclo_deputado, monkeypatch, [_zonas_de_sp()[0], _linha_agregado(agregado)]
    )
    conf = detalhes["SP"]["conferencia"]
    assert conf["estado"] == "diverge"
    assert [(d["o_que"], d["nosso"], d["tse"]) for d in conf["divergencias"]] == [
        ("eleitorado", 20_000, 50_000)
    ]
    assert _alertas_de_conferencia(alertas)


def test_ciclo_por_zona_sem_agregado_nao_afirma_que_confere(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    (_payload, detalhes), _alertas = _rodar_ciclo_com_alertas(
        ciclo_deputado, monkeypatch, _zonas_de_sp()
    )
    assert detalhes["SP"]["conferencia"]["estado"] == "sem_dado_tse"
    assert detalhes["SP"]["conferencia"]["boletim_dado_ts"] is None
    assert detalhes["SP"]["divergencias"] == []


# ---------------------------------------------------------------------------
# 4. `% apurado` da UF — Σ e.esi sobre o eleitorado inteiro
# ---------------------------------------------------------------------------


def _linha_pct(pct: float, te: int | None, esi: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"carg": []}
    if te is not None:
        payload["e"] = {"te": str(te)}
        if esi is not None:
            payload["e"]["esi"] = str(esi)
    return {"uf": "SP", "cod_zona": 1, "pct_apurado": pct, "payload": payload}


def test_rr_a_20_por_cento_le_20_e_nao_100() -> None:
    """A regressão, com o RR real do simulado (28/09, 16 zonas): só Boa Vista
    zona 1 tinha boletim. `s.psa` dela é 100 (binário) — o `max()` antigo dizia
    100%, e ponderar o `psa` pelo eleitorado ainda dizia 38,6%. O TSE dizia
    20,06% de seções (`s.pst`) e 20,19% de eleitorado (`e.esi/e.te`)."""
    linhas, agregado = _linhas_do_resumo("rr", "inicial")
    pct, fonte = pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=0, agregado=agregado)
    assert fonte == "ponderado"
    assert pct == pytest.approx(20.1875, abs=1e-4)
    assert max(linha["pct_apurado"] for linha in linhas) == 100.0, "o premissa do teste mudou"


def test_ap_sem_a_zona_de_macapa_nunca_chega_a_100() -> None:
    """AP no final: as 17 zonas lidas estão todas apuradas, mas o estado tem
    628.071 eleitores e elas somam 505.610. O número é o que está na NOSSA
    soma — 80,5% — e é isso que mantém o "indefinido" ligado."""
    linhas, agregado = _linhas_do_resumo("ap", "final")
    pct, fonte = pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=0, agregado=agregado)
    assert (round(pct, 3), fonte) == (80.502, "ponderado")


def test_primeira_zona_a_fechar_nao_poe_a_uf_em_100() -> None:
    pct, fonte = pct_apurado_uf_proporcional(
        [_linha_pct(100.0, 250, esi=250)], eleitorado_total_uf=1000
    )
    assert (pct, fonte) == (25.0, "ponderado")


def test_pct_nao_le_o_psa_da_linha() -> None:
    """Zona com boletim parcial: `psa` 100 (binário), 40% do eleitorado dela
    totalizado. Vale o `esi`."""
    pct, _ = pct_apurado_uf_proporcional(
        [_linha_pct(100.0, 1000, esi=400)], eleitorado_total_uf=1000
    )
    assert pct == 40.0


def test_pct_denominador_e_o_maior_eleitorado_conhecido() -> None:
    linhas = [_linha_pct(100.0, 500, esi=500)]
    agregado = {"pct_apurado": 100.0, "payload": {"e": {"te": "2000", "esi": "2000"}}}
    assert pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=1000, agregado=agregado)[0] == 25.0
    assert pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=4000, agregado=agregado)[0] == 12.5
    assert pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=0)[0] == 100.0


def test_pct_ponderado_soma_as_fatias() -> None:
    pct, fonte = pct_apurado_uf_proporcional(
        [_linha_pct(100.0, 400, esi=200), _linha_pct(100.0, 100, esi=100)],
        eleitorado_total_uf=1000,
    )
    assert (pct, fonte) == (30.0, "ponderado")


def test_pct_sem_e_nas_linhas_cai_no_agregado() -> None:
    pct, fonte = pct_apurado_uf_proporcional(
        [_linha_pct(100.0, None)],
        eleitorado_total_uf=1000,
        agregado={"pct_apurado": 100.0, "payload": {"e": {"te": "1000", "esi": "420"}}},
    )
    assert (pct, fonte) == (42.0, "agregado")


def test_pct_sem_nada_cai_no_maximo_de_antes() -> None:
    pct, fonte = pct_apurado_uf_proporcional(
        [_linha_pct(60.0, None), _linha_pct(20.0, None)], eleitorado_total_uf=0
    )
    assert (pct, fonte) == (60.0, "maximo")


def test_ciclo_publica_o_pct_ponderado_e_mantem_o_indefinido_ligado(
    ciclo_deputado,
) -> None:
    """No ciclo inteiro: uma zona de 400 eleitores fechada, num estado de
    2.000 — 20%, não 100%. E a consequência que motivou a correção: com 80%
    por apurar, a cadeira de sobra marginal sai `indefinido`; com o `max()`
    antigo (100%), `_marcar_indefinidas` não marcava nada."""
    _s, _r, publicados = ciclo_deputado(
        [_linha_zona(1, _envelope_de_zona("10"), te=400, esi=400)],
        eleitorado_zonas={("SP", 1): 400, ("SP", 2): 600, ("SP", 3): 1000},
    )
    payload, detalhes = publicados[0]

    assert detalhes["SP"]["pct_apurado"] == 20.0
    marcadas = [
        c for a in detalhes["SP"]["agremiacoes"] for c in a["eleitos"] if c.get("indefinido")
    ]
    assert marcadas, "com 80% por apurar a cadeira marginal de sobra é indefinida"


def test_ciclo_avisa_uma_vez_por_uf_quando_o_arquivo_nao_fecha_com_o_vv(
    ciclo_deputado, caplog: pytest.LogCaptureFixture
) -> None:
    env = _cenario_destinos()
    env["v"]["vv"] = "9999"
    with caplog.at_level("INFO", logger="api.model.project"):
        ciclo_deputado(
            [_linha_zona(1, env, te=400, esi=200), _linha_zona(2, env, te=400, esi=200)],
            eleitorado_zonas={("SP", 1): 400, ("SP", 2): 400},
        )
    avisos = [
        json.loads(r.message)
        for r in caplog.records
        if "invariante v.vv" in r.message and '"level": "warn"' in r.message
    ]
    assert len(avisos) == 1, "um aviso por UF, não um por arquivo"
    assert avisos[0]["n_validos_divergentes"] == 2
    assert avisos[0]["maior_diferenca_validos"] == 2350 - 9999
