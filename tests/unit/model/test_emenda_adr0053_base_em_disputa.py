"""Emenda de 2026-09-27 ao ADR-0053 (decisão do dono, opção A) — os percentuais
PUBLICADOS também vão para os votos em disputa.

Quando a abrangência tem ao menos uma candidatura de destino `"anulado"`, todo
percentual publicado de quem COMPETE passa a ser sobre `vvc − Σ anuladas` — a
mesma base em que o ADR-0053 já decide (`estimativas_para_decisao`). Sem
anulada no escopo, nada muda, byte a byte. Sub judice não renormaliza nada.
A anulada segue publicada sobre `vvc` (o `pvap` oficial), e a tela não a exibe.

Cenário-guia (100 votos): Ana 45 / Bruno 30 / Carla 10 sub judice / Davi 15
anulado ⇒ Ana 45/85 = 52,94%, Carla 10/85, Davi 15% marcado anulado.

Mutações que cada bloco mata (aplicadas à mão — ver o relatório do commit):
  M1. renormaliza também sem anulada        → golden (`_GOLDEN`), sem anulada;
  M2. esquece "Outros"                       → bloco "Outros";
  M3. esquece a série                        → bloco "Série";
  M4. trata sub judice como anulada          → golden com sub judice.

O golden (`golden_emenda_adr0053_sem_anulada.json`) foi gerado a partir do
código ANTERIOR à emenda (commit 741cc91), rodando `_do_project` inteiro sobre
os cenários de `_CENARIOS_GOLDEN`. Ele é a definição de "o payload de antes".
Regenerar (`python -m tests.unit.model.test_emenda_adr0053_base_em_disputa`)
só quando uma mudança INTENCIONAL alterar o payload do caso sem anulada — e
nunca para fazer este teste passar depois de mexer na renormalização.

Regenerado em 2026-09-28 só para acrescentar `por_uf[].votos_disputa_projetados`
(capas por região). Conferido: removido esse campo, o golden novo é IDÊNTICO ao
anterior, cenário a cenário.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from api.model import project as proj
from tests.unit.model.test_destino_do_voto_decisao import (
    ANULADO,
    SUB_JUDICE,
    VALIDO,
    _cand,
    _cenario,
    _dvt_fixo,
    _por_uf,
    _rodar,
)

ANA, BRUNO, CARLA, DAVI = 13, 22, 57, 60
LIDER, X, Y, W, ANUL, Z = 13, 22, 44, 77, 60, 90

_DVT_GUIA = {ANA: VALIDO, BRUNO: VALIDO, CARLA: SUB_JUDICE, DAVI: ANULADO}
_GUIA = {ANA: 0.45, BRUNO: 0.30, CARLA: 0.10, DAVI: 0.15}

_GOLDEN = Path(__file__).with_name("golden_emenda_adr0053_sem_anulada.json")


def _competem(itens: list[dict[str, Any]], fora: set[int]) -> list[dict[str, Any]]:
    return [c for c in itens if c["id"] not in fora]


# ===========================================================================
# O cenário-guia — Presidente
# ===========================================================================


def test_guia_presidente_nacional_uf_e_top_na_base_em_disputa(monkeypatch) -> None:
    snaps, eleit = _cenario({"SP": _GUIA, "RJ": _GUIA}, _dvt_fixo(_DVT_GUIA), cargo=1)
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    nat = body["payload"]["national"]

    esperado = {ANA: 100 * 45 / 85, BRUNO: 100 * 30 / 85, CARLA: 100 * 10 / 85, DAVI: 15.0}
    for cid, pct in esperado.items():
        assert _cand(nat, cid)["pct_projetado"] == pytest.approx(pct, abs=0.3), cid
        assert _cand(nat, cid)["pct_atual"] == pytest.approx(pct, abs=0.3), cid
    # Davi segue sobre vvc e marcado; Carla (sub judice) compete e é renormalizada.
    assert _cand(nat, DAVI)["destino"] == "anulado"
    assert _cand(nat, CARLA)["destino"] == "sub_judice"
    # Quem compete fecha 100% na base em disputa — o apurado exatamente.
    competem = _competem(nat["candidatos"], {DAVI})
    assert sum(c["pct_atual"] for c in competem) == pytest.approx(100.0, abs=1e-3)
    assert sum(c["pct_projetado"] for c in competem) == pytest.approx(100.0, abs=0.05)
    # IC coerente com o ponto.
    for c in competem:
        assert c["pct_projetado_lower"] <= c["pct_projetado"] <= c["pct_projetado_upper"]
    # `p_fecha_1t` coerente com o número publicado: 52,9% > 50% ⇔ fecha.
    assert _cand(nat, ANA)["pct_projetado"] > 50.0
    assert _cand(nat, ANA)["p_fecha_1t"] > 0.99
    assert nat["vai_a_2t_nacional"] is False

    for sigla in ("SP", "RJ"):
        linha = _por_uf(body["payload"], sigla)
        top = {t["id"]: t for t in linha["top_candidatos"]}
        uf = {c["id"]: c for c in body["payloads_uf"][sigla]["candidatos"]}
        for cid, pct in esperado.items():
            assert top[cid]["pct"] == pytest.approx(pct, abs=0.3), (sigla, cid)
            assert top[cid]["pct_atual"] == pytest.approx(pct, abs=0.3), (sigla, cid)
            assert uf[cid]["pct_projetado"] == pytest.approx(pct, abs=0.3), (sigla, cid)
            assert uf[cid]["pct_atual"] == pytest.approx(pct, abs=0.3), (sigla, cid)
        assert sum(t["pct"] for t in top.values() if t["id"] != DAVI) == pytest.approx(
            100.0, abs=0.05
        )
        for cid, c in uf.items():
            if cid != DAVI:
                assert c["ci95"]["lower"] <= c["pct_projetado"] <= c["ci95"]["upper"]
        # a base comparecimento NÃO foi tocada: a soma dela não fecha 100 sem Davi.
        assert uf[ANA]["comparecimento"]["pct_projetado"] < uf[ANA]["pct_projetado"]


def test_guia_ic_escalado_pelo_mesmo_fator_do_ponto(monkeypatch) -> None:
    """O IC publicado é o de SEM `dvt` × o MESMO fator do ponto (nacional e UF)."""
    com, eleit = _cenario({"SP": _GUIA, "RJ": _GUIA}, _dvt_fixo(_DVT_GUIA), cargo=1)
    sem, _ = _cenario({"SP": _GUIA, "RJ": _GUIA}, lambda *_: None, cargo=1)
    b_com = _rodar(monkeypatch, com, eleit, cargo=1)
    b_sem = _rodar(monkeypatch, sem, eleit, cargo=1)
    n_com, n_sem = b_com["payload"]["national"], b_sem["payload"]["national"]
    for cid in (ANA, BRUNO, CARLA):
        k = _cand(n_com, cid)["pct_projetado"] / _cand(n_sem, cid)["pct_projetado"]
        assert k == pytest.approx(100 / (100 - _cand(n_sem, DAVI)["pct_projetado"]), rel=1e-5)
        for campo in ("pct_projetado_lower", "pct_projetado_upper"):
            assert _cand(n_com, cid)[campo] == pytest.approx(_cand(n_sem, cid)[campo] * k, abs=2e-5)


def test_coerencia_nos_dois_sentidos_governador(monkeypatch) -> None:
    """Na UF a coerência é por construção: `vai_a_2t` e o `pct` publicado saem
    da MESMA conta. Ana 45/85 fecha; Ana 42/85 = 49,4% vai ao 2º turno — o
    número publicado diz de que lado dos 50% ela está."""
    fecha = {ANA: 0.45, BRUNO: 0.30, CARLA: 0.10, DAVI: 0.15}
    nao = {ANA: 0.42, BRUNO: 0.33, CARLA: 0.10, DAVI: 0.15}
    for shares, vai in ((fecha, False), (nao, True)):
        snaps, eleit = _cenario({"SP": shares, "RJ": shares}, _dvt_fixo(_DVT_GUIA), cargo=3)
        body = _rodar(monkeypatch, snaps, eleit, cargo=3)
        for sigla in ("SP", "RJ"):
            linha = _por_uf(body["payload"], sigla)
            ana = next(t for t in linha["top_candidatos"] if t["id"] == ANA)
            assert linha["vai_a_2t"] is vai, (sigla, shares[ANA])
            assert (ana["pct"] < 50.0) is vai, (sigla, ana["pct"])
            uf_ana = next(c for c in body["payloads_uf"][sigla]["candidatos"] if c["id"] == ANA)
            assert uf_ana["pct_projetado"] == pytest.approx(ana["pct"], abs=1e-9)


def test_coerencia_presidente_ana_42_nao_fecha(monkeypatch) -> None:
    nao = {ANA: 0.42, BRUNO: 0.33, CARLA: 0.10, DAVI: 0.15}
    snaps, eleit = _cenario({"SP": nao, "RJ": nao}, _dvt_fixo(_DVT_GUIA), cargo=1)
    nat = _rodar(monkeypatch, snaps, eleit, cargo=1)["payload"]["national"]
    assert _cand(nat, ANA)["pct_projetado"] == pytest.approx(100 * 42 / 85, abs=0.3)
    assert _cand(nat, ANA)["pct_projetado"] < 50.0
    assert _cand(nat, ANA)["p_fecha_1t"] < 0.5


# ===========================================================================
# Margem, selo `chamada` e agulha da UF (2ª parte da decisão, 2026-09-27)
# ===========================================================================


@pytest.mark.parametrize("cargo", [1, 3])
def test_guia_margem_e_a_diferenca_exata_da_lista(monkeypatch, cargo) -> None:
    """`margem_atual` = 52,94 − 35,29 = 17,65 — e é, ao último dígito, a
    diferença dos dois primeiros que competem como aparecem na lista."""
    snaps, eleit = _cenario({"SP": _GUIA, "RJ": _GUIA}, _dvt_fixo(_DVT_GUIA), cargo=cargo)
    body = _rodar(monkeypatch, snaps, eleit, cargo=cargo)
    for sigla in ("SP", "RJ"):
        linha = _por_uf(body["payload"], sigla)
        top = {t["id"]: t["pct"] for t in linha["top_candidatos"]}
        assert linha["lider"] == ANA
        assert linha["margem_atual"] == top[ANA] - top[BRUNO]
        assert linha["margem_projetada"] == top[ANA] - top[BRUNO]
        assert linha["margem_atual"] == pytest.approx(100 * 45 / 85 - 100 * 30 / 85, abs=0.3)
        lo, hi = linha["margem_projetada_ci"]
        assert lo <= linha["margem_projetada"] <= hi
        assert linha["chamada"] is True  # 17,65 > 10
        uf = body["payloads_uf"][sigla]
        assert uf["needle_position"] == pytest.approx(
            min(1.0, linha["margem_projetada"] / 20.0), abs=1e-9
        )


#: Na base `vvc` a margem entre as que competem é 36 − 28 = 8 (≤ 10); nos votos
#: em disputa (70) é 51,4 − 40,0 = 11,4 (> 10). O selo MUDA com a base.
_SELO = {ANA: 0.36, BRUNO: 0.28, CARLA: 0.06, DAVI: 0.30}


@pytest.mark.parametrize("cargo", [1, 3])
def test_selo_chamada_muda_com_a_base(monkeypatch, cargo) -> None:
    com, eleit = _cenario({"SP": _SELO, "RJ": _SELO}, _dvt_fixo(_DVT_GUIA), cargo=cargo)
    sem, _ = _cenario({"SP": _SELO, "RJ": _SELO}, lambda *_: None, cargo=cargo)
    b_com = _rodar(monkeypatch, com, eleit, cargo=cargo)
    b_sem = _rodar(monkeypatch, sem, eleit, cargo=cargo)
    for sigla in ("SP", "RJ"):
        top_vvc = {t["id"]: t["pct"] for t in _por_uf(b_sem["payload"], sigla)["top_candidatos"]}
        assert top_vvc[ANA] - top_vvc[BRUNO] <= 10.0  # em vvc, não chamaria
        linha = _por_uf(b_com["payload"], sigla)
        assert linha["lider"] == ANA
        assert linha["margem_projetada"] == pytest.approx(100 * 8 / 70, abs=0.3)
        assert linha["margem_projetada"] > 10.0
        assert linha["chamada"] is True
        assert linha["bucket"] == "chamada"


def test_guia_serie_sem_a_linha_de_davi() -> None:
    """A série da noite (nacional e UF) não carrega Davi, e Ana sai na base
    em disputa ponto a ponto."""
    momento = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
    balde = proj._balde_epoch(momento, 5)
    pcts = {ANA: 45.0, BRUNO: 30.0, CARLA: 10.0, DAVI: 15.0}

    def _bruta_guia(escopo):
        return proj.SeriePorCandidatoBruta(
            5,
            {escopo: {c: {balde: {"momento": momento, "pct_atual": p, "pct_projetado": p}}
                      for c, p in pcts.items()}},
        )

    rows = [{**_row(c, p, p), "cargo": 1} for c, p in pcts.items()]
    nat = [_nat_row(c, p, i + 1) for i, (c, p) in enumerate(sorted(pcts.items(),
                                                                    key=lambda kv: -kv[1]))]
    an = proj.anulados_na_decisao(
        {("BR", DAVI): "anulado", ("BR", CARLA): "sub_judice"}, 1
    )
    payload = proj.build_edge_payload(
        cargo=1, turno=1, ts_iso="t", uf_rows=rows, national_rows=nat,
        eleitorado_total_by_uf={"SP": 1}, serie_bruta=_bruta_guia(None), anulados=an,
    )
    serie = payload["serie_por_candidato"]["candidatos"]
    assert [c["id"] for c in serie] == [ANA, BRUNO, CARLA]
    assert serie[0]["apurado"] == [round(100 * 45 / 85, 2)]
    uf = proj.build_uf_payloads(
        cargo=1, turno=1, ts_iso="t", uf_rows=rows, national_rows=[],
        municipio_aggregates={}, zona_municipio={}, series_by_uf={},
        serie_bruta=_bruta_guia("SP"), anulados=an,
    )["SP"]
    serie = uf["series_temporais"]["por_candidato"]["candidatos"]
    assert [c["id"] for c in serie] == [ANA, BRUNO, CARLA]
    assert serie[0]["projetado"] == [round(100 * 45 / 85, 2)]


# ===========================================================================
# Sem anulada ⇒ o payload de antes, inteiro (golden gerado em 741cc91)
# ===========================================================================

_SEIS = {LIDER: 0.38, X: 0.22, ANUL: 0.15, 57: 0.12, Y: 0.08, W: 0.05}
_SEIS_DVT = {LIDER: VALIDO, X: VALIDO, ANUL: VALIDO, 57: SUB_JUDICE, Y: VALIDO, W: VALIDO}


def _dvt_so_em_sp(uf, _zona, cod):
    if cod == ANUL:
        return ANULADO if uf == "SP" else VALIDO
    return _SEIS_DVT.get(cod)


#: nome → (shares, dvt, cargo, vpe, recorte). `recorte` escolhe a parte do corpo
#: que tem de ser igual à de antes.
_CENARIOS_GOLDEN: dict[str, tuple[Any, ...]] = {
    "pres_sub_judice": (_SEIS, _dvt_fixo(_SEIS_DVT), 1, 1, "tudo"),
    "gov_sub_judice": (_SEIS, _dvt_fixo(_SEIS_DVT), 3, 1, "tudo"),
    "sen_sub_judice": (_SEIS, _dvt_fixo(_SEIS_DVT), 5, 2, "tudo"),
    "gov_anulada_so_em_sp": (_SEIS, _dvt_so_em_sp, 3, 1, "nacional_e_rj"),
}


def _recorte(body: dict[str, Any], recorte: str) -> dict[str, Any]:
    if recorte == "tudo":
        return body
    return {
        "national": body["payload"]["national"],
        "por_uf_rj": _por_uf(body["payload"], "RJ"),
        "payload_uf_rj": body["payloads_uf"]["RJ"],
    }


def _rodar_golden(monkeypatch, nome: str) -> dict[str, Any]:
    shares, dvt, cargo, vpe, recorte = _CENARIOS_GOLDEN[nome]
    snaps, eleit = _cenario({"SP": shares, "RJ": shares}, dvt, cargo=cargo, vpe=vpe)
    return _recorte(_rodar(monkeypatch, snaps, eleit, cargo=cargo), recorte)


@pytest.mark.parametrize("nome", sorted(_CENARIOS_GOLDEN))
def test_sem_anulada_no_escopo_payload_identico_ao_de_antes(monkeypatch, nome) -> None:
    """M1/M4. Sub judice sozinha, ou anulada só em OUTRA UF (Gov: SP), não mexe
    em número nenhum do escopo — o corpo inteiro é o de antes da emenda."""
    golden = json.loads(_GOLDEN.read_text(encoding="utf-8"))
    assert _rodar_golden(monkeypatch, nome) == golden[nome]


def test_base_da_disputa_sem_anulada_e_none() -> None:
    linhas = [
        {"candidato_id": 1, "pct_projetado": 60.0, "pct_atual": 60.0},
        {"candidato_id": 2, "pct_projetado": 40.0, "pct_atual": 40.0},
    ]
    assert proj.base_da_disputa(linhas, frozenset()) is None
    assert proj.base_da_disputa(linhas, frozenset({99})) is None  # anulada sem linha
    # todas anuladas: não há votos em disputa — nada a renormalizar.
    assert proj.base_da_disputa(linhas, frozenset({1, 2})) is None
    b = proj.base_da_disputa(linhas, frozenset({2}))
    assert b is not None
    assert b.projetado == pytest.approx(100 / 60)
    assert proj.na_disputa(30.0, None) == 30.0
    assert proj.na_disputa(None, 2.0) is None


# ===========================================================================
# "Outros" — a cauda que compete, na base em disputa
# ===========================================================================

#: (shares, top_ids esperados, cauda competindo da linha da UF, cauda rank>=4)
_OUTROS = {
    # anulada NA cauda (rank 5): sai da soma e de `n_candidatos`.
    "anulada_na_cauda": (
        {LIDER: 0.40, X: 0.25, Y: 0.15, W: 0.08, ANUL: 0.07, Z: 0.05},
        [LIDER, X, Y, W],
        [Z],
        [W, Z],
    ),
    # anulada FORA das 4 primeiras e SOZINHA na cauda da linha: `outros` some.
    "anulada_sozinha_na_cauda": (
        {LIDER: 0.40, X: 0.25, Y: 0.15, W: 0.12, ANUL: 0.08},
        [LIDER, X, Y, W],
        [],
        [W],
    ),
    # anulada no TOPO (rank 2): a cauda é a mesma, só o fator muda.
    "anulada_no_topo": (
        {LIDER: 0.35, ANUL: 0.20, X: 0.18, Y: 0.12, W: 0.09, Z: 0.06},
        [LIDER, ANUL, X, Y],
        [W, Z],
        [Y, W, Z],
    ),
}


@pytest.mark.parametrize("caso", sorted(_OUTROS))
def test_outros_e_a_cauda_que_compete_na_base_em_disputa(monkeypatch, caso) -> None:
    """M2. `por_uf[].outros`, `national.participacao.outros` e
    `EdgePayloadUf.participacao.outros`."""
    shares, top_ids, cauda_uf, cauda_rank4 = _OUTROS[caso]
    base = 1 - shares[ANUL]
    snaps, eleit = _cenario({"SP": shares, "RJ": shares}, _dvt_fixo({ANUL: ANULADO}), cargo=1)
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)

    esperado_uf = 100 * sum(shares[c] for c in cauda_uf) / base
    esperado_r4 = 100 * sum(shares[c] for c in cauda_rank4) / base
    for sigla in ("SP", "RJ"):
        linha = _por_uf(body["payload"], sigla)
        assert [t["id"] for t in linha["top_candidatos"]] == top_ids
        if not cauda_uf:
            assert "outros" not in linha
            continue
        outros = linha["outros"]
        assert outros["n_candidatos"] == len(cauda_uf)
        # nenhum VOTO da anulada: a soma é exatamente a da cauda que compete.
        votos_uf = {c["id"]: c["votos_atuais"] for c in body["payloads_uf"][sigla]["candidatos"]}
        assert outros["votos_atuais"] == sum(votos_uf[c] for c in cauda_uf)
        assert outros["pct"] == pytest.approx(esperado_uf, abs=0.3)
        assert outros["pct_atual"] == pytest.approx(esperado_uf, abs=0.3)
        soma = sum(t["pct"] for t in linha["top_candidatos"] if t["id"] != ANUL)
        assert soma + outros["pct"] == pytest.approx(100.0, abs=0.05)

    for sigla in ("SP", "RJ"):
        part_uf = body["payloads_uf"][sigla]["participacao"]["outros"]
        assert part_uf["n_candidatos"] == len(cauda_rank4)
        assert part_uf["pct_projetado"] == pytest.approx(esperado_r4, abs=0.3)
        assert part_uf["pct_atual"] == pytest.approx(esperado_r4, abs=0.3)
        assert part_uf["lower"] <= part_uf["pct_projetado"] <= part_uf["upper"]

    part_nat = body["payload"]["national"]["participacao"]["outros"]
    assert part_nat["n_candidatos"] == len(cauda_rank4)
    assert part_nat["pct_projetado"] == pytest.approx(esperado_r4, abs=0.3)
    assert part_nat["pct_atual"] == pytest.approx(esperado_r4, abs=0.3)
    assert part_nat["lower"] <= part_nat["pct_projetado"] <= part_nat["upper"]


# ===========================================================================
# RF-190 — a seleção de `top_candidatos` e a ordem por parcial não mudam
# ===========================================================================


def _row(cid: int, proj_pct: float, atual: float) -> dict[str, Any]:
    return {
        "cargo": 3,
        "turno": 1,
        "uf": "SP",
        "candidato_id": cid,
        "votos_projetados": int(proj_pct * 1000),
        "votos_atuais": int(atual * 1000),
        "pct_atual": atual,
        "pct_projetado": proj_pct,
        "pct_projetado_lower": proj_pct - 1,
        "pct_projetado_upper": proj_pct + 1,
        "p_vitoria": None,
        "pct_apurado": 30.0,
    }


#: 6 lidera o APURADO e é 6º na projeção ⇒ resgatado (RF-190).
_RESGATE = [
    _row(1, 30.0, 20.0),
    _row(2, 22.0, 18.0),
    _row(3, 18.0, 15.0),
    _row(4, 12.0, 10.0),
    _row(5, 10.0, 7.0),
    _row(6, 8.0, 30.0),
]


@pytest.mark.parametrize("anulada", [3, 6, 5])
def test_rf190_selecao_e_ordem_nao_mudam_com_a_renormalizacao(anulada: int) -> None:
    def _payload(an):
        return proj.build_edge_payload(
            cargo=3,
            turno=1,
            ts_iso="2026-10-04T20:00:00Z",
            uf_rows=[dict(r) for r in _RESGATE],
            national_rows=[],
            eleitorado_total_by_uf={"SP": 1},
            anulados=an,
        )

    sem = _payload(None)["por_uf"][0]
    com = _payload(proj.anulados_na_decisao({("SP", anulada): "anulado"}, 3))["por_uf"][0]
    assert [t["id"] for t in com["top_candidatos"]] == [t["id"] for t in sem["top_candidatos"]]
    assert [t["id"] for t in sem["top_candidatos"]] == [1, 2, 3, 4, 6]
    # A ordem por parcial entre as que competem é a mesma nas duas bases.
    competem_com = [
        c["id"]
        for c in proj.ordenar_por_parcial(
            [{**t, "pct_projetado": t["pct"]} for t in com["top_candidatos"]]
        )
        if c["id"] != anulada
    ]
    competem_sem = [
        c["id"]
        for c in proj.ordenar_por_parcial(
            [{**t, "pct_projetado": t["pct"]} for t in sem["top_candidatos"]]
        )
        if c["id"] != anulada
    ]
    assert competem_com == competem_sem
    # E a anulada fica em vvc.
    t_com = {t["id"]: t for t in com["top_candidatos"]}
    t_sem = {t["id"]: t for t in sem["top_candidatos"]}
    if anulada in t_com:
        assert t_com[anulada]["pct"] == t_sem[anulada]["pct"]
        assert t_com[anulada]["pct_atual"] == t_sem[anulada]["pct_atual"]


# ===========================================================================
# Município e mesorregião
# ===========================================================================


def _uf_payloads(an: proj.AnuladosNaDecisao | None) -> dict[str, Any]:
    rows = [
        {**_row(cid, p, p), "uf": uf}
        for uf in ("SP", "RJ")
        for cid, p in ((11, 45.0), (22, 30.0), (33, 10.0), (44, 15.0))
    ]
    votos = {
        ("SP", 1): {11: 450, 22: 300, 33: 100, 44: 150},
        ("SP", 2): {11: 100, 22: 200, 33: 0, 44: 700},
        ("RJ", 3): {11: 450, 22: 300, 33: 100, 44: 150},
    }
    municipio_aggregates = {
        k: {"pct_apurado": 50.0, "votos_por_candidato": dict(v), "total_votos": sum(v.values())}
        for k, v in votos.items()
    }
    zona_municipio = {
        (uf, cod, 1): {
            "uf": uf,
            "cod_municipio_tse": cod,
            "cod_ibge": f"{cod:07d}",
            "nome": f"M{cod}",
            "mesorregiao_cod": f"{uf}01",
            "mesorregiao_nome": "Meso",
        }
        for (uf, cod) in votos
    }
    return proj.build_uf_payloads(
        cargo=3,
        turno=1,
        ts_iso="2026-10-04T20:00:00Z",
        uf_rows=rows,
        national_rows=[],
        municipio_aggregates=municipio_aggregates,
        zona_municipio=zona_municipio,
        series_by_uf={},
        anulados=an,
    )


def test_municipio_e_mesorregiao_na_base_em_disputa() -> None:
    an = proj.anulados_na_decisao({("SP", 44): "anulado", ("SP", 33): "sub_judice"}, 3)
    sp = _uf_payloads(an)["SP"]
    m1, m2 = sp["municipios"]
    # M1: 450 − 300 sobre 1000 − 150 = 850.
    assert m1["lider"]["candidato_id"] == 11
    assert m1["lider"]["margem_pp"] == pytest.approx(100 * 150 / 850)
    # M2: a anulada (700) teria liderado; quem compete: 22 (200) − 11 (100) sobre 300.
    assert m2["lider"]["candidato_id"] == 22
    assert m2["lider"]["margem_pp"] == pytest.approx(100 * 100 / 300)
    # contagens intocadas.
    assert m2["votos_reportados"] == {11: 100, 22: 200, 33: 0, 44: 700}
    (meso,) = sp["mesorregioes"]
    # meso: 11 = 550, 22 = 500, 33 = 100, 44 = 850 ⇒ em disputa 1150.
    assert meso["lider_candidato_id"] == 11
    assert meso["lider_pct"] == pytest.approx(100 * 550 / 1150)
    assert meso["margem"] == pytest.approx(100 * 50 / 1150)


def test_municipio_e_mesorregiao_sem_anulada_no_escopo_identicos() -> None:
    """Sub judice sozinha, ou anulada só no RJ (Gov: escopo da UF), deixa os
    municípios e a mesorregião de SP exatamente como sem mapa nenhum."""
    antes = _uf_payloads(None)["SP"]
    for an in (
        proj.anulados_na_decisao({("SP", 33): "sub_judice"}, 3),
        proj.anulados_na_decisao({("RJ", 44): "anulado"}, 3),
    ):
        agora = _uf_payloads(an)["SP"]
        assert agora["municipios"] == antes["municipios"]
        assert agora["mesorregioes"] == antes["mesorregioes"]
        sem_etiqueta = [{k: v for k, v in c.items() if k != "destino"} for c in agora["candidatos"]]
        assert sem_etiqueta == antes["candidatos"]


# ===========================================================================
# Série (spec 020)
# ===========================================================================

_T0 = datetime(2026, 10, 4, 20, 0, 0, tzinfo=timezone.utc)


def _ponto(minutos: int, atual: float | None, projetado: float | None) -> tuple[int, dict]:
    momento = _T0 + timedelta(minutes=minutos)
    return proj._balde_epoch(momento, 5), {
        "momento": momento,
        "pct_atual": atual,
        "pct_projetado": projetado,
    }


def _bruta(escopo: str | None) -> proj.SeriePorCandidatoBruta:
    """Três baldes. No 2º a anulada (44) não tem linha (fração 0 naquele ciclo);
    no 3º o apurado dela é desconhecido (⇒ furo no apurado de quem compete)."""
    pontos = {
        11: [_ponto(0, 40.0, 42.0), _ponto(5, 44.0, 44.0), _ponto(10, 45.0, 45.0)],
        22: [_ponto(0, 30.0, 30.0), _ponto(5, 30.0, 30.0), _ponto(10, 30.0, 30.0)],
        33: [_ponto(0, 10.0, 10.0), _ponto(5, 10.0, 10.0), _ponto(10, 10.0, 10.0)],
        44: [_ponto(0, 20.0, 18.0), _ponto(10, None, 15.0)],
    }
    return proj.SeriePorCandidatoBruta(
        5, {escopo: {cid: dict(pts) for cid, pts in pontos.items()}}
    )


def _cands(destino_44: str | None = "anulado") -> list[dict[str, Any]]:
    out = []
    for cid, atual in ((11, 45.0), (22, 30.0), (33, 10.0), (44, 15.0)):
        c: dict[str, Any] = {"id": cid, "nome": f"C{cid}", "partido": "P", "pct_atual": atual,
                             "pct_projetado": atual}
        if cid == 44 and destino_44:
            c["destino"] = destino_44
        out.append(c)
    return out


def test_serie_ponto_a_ponto_na_base_em_disputa() -> None:
    serie = proj.montar_serie_por_candidato(_bruta("SP"), "SP", _cands(), anulados={44})
    assert serie is not None
    por_id = {c["id"]: c for c in serie["candidatos"]}
    # A anulada NÃO entra na série, nem com vaga sobrando (2ª parte da decisão).
    assert list(por_id) == [11, 22, 33]
    assert por_id[11]["apurado"] == [
        round(40 * 100 / 80, 2),  # balde 1: anulada com 20%
        44.0,  # balde 2: anulada sem linha ⇒ fração 0
        None,  # balde 3: apurado da anulada desconhecido ⇒ furo
    ]
    assert por_id[11]["projetado"] == [
        round(42 * 100 / 82, 2),
        44.0,
        round(45 * 100 / 85, 2),
    ]
    assert por_id[33]["projetado"][2] == round(10 * 100 / 85, 2)  # sub judice compete
    # Só pelo conjunto do escopo (sem etiqueta `destino`) ela também sai.
    so_conjunto = proj.montar_serie_por_candidato(
        _bruta("SP"), "SP", _cands(None), anulados={44}
    )
    assert [c["id"] for c in so_conjunto["candidatos"]] == [11, 22, 33]


def test_serie_sem_anulada_identica() -> None:
    antes = proj.montar_serie_por_candidato(_bruta("SP"), "SP", _cands(None))
    for fora in (frozenset(), frozenset({99})):
        assert (
            proj.montar_serie_por_candidato(_bruta("SP"), "SP", _cands(None), anulados=fora)
            == antes
        )


def _nat_row(cid: int, pct: float, rank: int) -> dict[str, Any]:
    return {
        "cargo": 1,
        "turno": 1,
        "uf": None,
        "candidato_id": cid,
        "votos_projetados": 1,
        "pct_projetado": pct,
        "pct_projetado_lower": pct - 1,
        "pct_projetado_upper": pct + 1,
        "p_vitoria": 0.5,
        "rank": rank,
        "p_passa_2t": 0.5,
        "p_fecha_1t": 0.0,
    }


def test_serie_fio_nacional_e_uf() -> None:
    """M3. O fio: Presidente leva as anuladas NACIONAIS à série nacional e à da
    UF; Governador leva as da UF à série da UF e NADA à nacional."""
    rows = [{**_row(cid, p, p), "cargo": 1} for cid, p in ((11, 45.0), (22, 30.0),
                                                          (33, 10.0), (44, 15.0))]
    nat = [_nat_row(cid, p, i + 1) for i, (cid, p) in enumerate(((11, 45.0), (22, 30.0),
                                                                  (44, 15.0), (33, 10.0)))]
    an_pres = proj.anulados_na_decisao({("BR", 44): "anulado"}, 1)
    payload = proj.build_edge_payload(
        cargo=1, turno=1, ts_iso="2026-10-04T20:00:00Z", uf_rows=rows, national_rows=nat,
        eleitorado_total_by_uf={"SP": 1}, serie_bruta=_bruta(None), anulados=an_pres,
    )
    s11 = next(c for c in payload["serie_por_candidato"]["candidatos"] if c["id"] == 11)
    assert s11["projetado"][0] == round(42 * 100 / 82, 2)

    comum = dict(
        turno=1, ts_iso="2026-10-04T20:00:00Z", national_rows=[], municipio_aggregates={},
        zona_municipio={}, series_by_uf={}, serie_bruta=_bruta("SP"),
    )
    uf = proj.build_uf_payloads(cargo=1, uf_rows=rows, anulados=an_pres, **comum)["SP"]
    s11 = next(c for c in uf["series_temporais"]["por_candidato"]["candidatos"] if c["id"] == 11)
    assert s11["projetado"][0] == round(42 * 100 / 82, 2)

    rows_gov = [{**r, "cargo": 3} for r in rows]
    an_gov = proj.anulados_na_decisao({("SP", 44): "anulado"}, 3)
    uf = proj.build_uf_payloads(cargo=3, uf_rows=rows_gov, anulados=an_gov, **comum)["SP"]
    s11 = next(c for c in uf["series_temporais"]["por_candidato"]["candidatos"] if c["id"] == 11)
    assert s11["projetado"][0] == round(42 * 100 / 82, 2)
    # Governador: o bloco nacional é a união de 27 corridas — série intocada.
    nat_gov = [{**r, "cargo": 3} for r in nat]
    payload = proj.build_edge_payload(
        cargo=3, turno=1, ts_iso="2026-10-04T20:00:00Z", uf_rows=rows_gov,
        national_rows=nat_gov, eleitorado_total_by_uf={"SP": 1}, serie_bruta=_bruta(None),
        anulados=proj.anulados_na_decisao({("SP", 44): "anulado", ("BR", 44): "anulado"}, 3),
    )
    s11 = next(c for c in payload["serie_por_candidato"]["candidatos"] if c["id"] == 11)
    assert s11["projetado"][0] == 42.0


def test_governador_bloco_nacional_intocado() -> None:
    """Gov/Sen: `national.candidatos` fica em `vvc` mesmo com a anulada no
    escopo "BR" — não há corrida nacional para dividir."""
    rows = [{**_row(cid, p, p)} for cid, p in ((11, 45.0), (22, 30.0), (33, 10.0), (44, 15.0))]
    nat = [{**_nat_row(cid, p, i + 1), "cargo": 3}
           for i, (cid, p) in enumerate(((11, 45.0), (22, 30.0), (44, 15.0), (33, 10.0)))]
    comum = dict(cargo=3, turno=1, ts_iso="t", uf_rows=rows, national_rows=nat,
                 eleitorado_total_by_uf={"SP": 1})
    antes = proj.build_edge_payload(**comum)["national"]
    agora = proj.build_edge_payload(
        **comum,
        anulados=proj.anulados_na_decisao({("SP", 44): "anulado", ("BR", 44): "anulado"}, 3),
    )["national"]
    assert agora == antes


# ===========================================================================
# Geração do golden — rodar SÓ contra o código de antes (ver a docstring)
# ===========================================================================


def gerar_golden(destino: Path = _GOLDEN) -> None:
    mp = pytest.MonkeyPatch()
    try:
        saida = {nome: _rodar_golden(mp, nome) for nome in sorted(_CENARIOS_GOLDEN)}
    finally:
        mp.undo()
    destino.write_text(json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":  # pragma: no cover
    gerar_golden(Path(sys.argv[1]) if len(sys.argv) > 1 else _GOLDEN)
