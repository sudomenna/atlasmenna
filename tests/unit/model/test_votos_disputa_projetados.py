"""tests/unit/model/test_votos_disputa_projetados.py

Capas agrupadas por região (decisão do dono de 2026-09-28): a Projeção
regional é `Σ pct/100 × total` UF a UF, e o payload nacional só trazia o `pct`.
`api/model/project.py` passa a emitir `por_uf[].votos_disputa_projetados` —
o total PROJETADO de votos em disputa da UF, na MESMA base dos
`top_candidatos[].pct` e de `outros.pct`.

O que este arquivo trava, e a mutação que cada bloco mata:

  1. O total é o DENOMINADOR do `pct` (`base_votaveis_projetada`), não a soma
     das partes. Mata `Σ votos_projetados`: a fixture direta soma 99,1% de
     propósito, e aí as duas contas divergem (1.000.000 contra 991.000).
  2. Anulada FORA (ADR-0053, emenda de 27/09): total = base × (100 − Σ pct
     das anuladas)/100. Mata "esqueceu a anulada" e "tirou também a sub
     judice" (a sub judice compete e fica na base).
  3. Consistência de ponta a ponta (`_do_project` inteiro): `pct/100 × total`
     devolve o `votos_projetados` do payload POR UF de cada candidatura que
     compete, e `Σ pct(compete) + outros.pct ≈ 100`.
  4. Senado em VOTOS (2 por eleitor): o total é `Σ vvc` projetado, ≈ 2× o
     comparecimento — nunca pessoas.
  5. Ausente, nunca `0`, quando não há base: caller legado, UF sem base, base
     `<= 0`, todas anuladas. "Não sabemos" ≠ zero (decisão do dono de 14/09).
"""

from __future__ import annotations

from typing import Any

import pytest

from api.model import project as proj
from api.model.project import (
    AnuladosNaDecisao,
    BaseDaDisputa,
    build_edge_payload,
    votos_disputa_projetados,
)
from tests.unit.model.test_destino_do_voto_decisao import (
    ANULADO,
    SUB_JUDICE,
    VALIDO,
    _cenario,
    _dvt_fixo,
    _por_uf,
    _rodar,
)

# ---------------------------------------------------------------------------
# Fixture direta — `build_edge_payload` sem o pipeline
# ---------------------------------------------------------------------------

BASE_BA = 1_000_000

#: Σ pct_projetado = 99,1 — de propósito (mesma razão de `test_uf_outros.py`):
#: com Σ = 100, `base` e `Σ votos_projetados` coincidiriam e o bloco 1 não
#: discriminaria nada.
_PCTS: list[tuple[int, float]] = [
    (13, 40.0),
    (22, 25.0),
    (12, 15.0),
    (15, 10.9),
    (30, 5.1),
    (50, 3.1),
]


def _linhas(cargo: int = 1, uf: str = "BA") -> list[dict[str, Any]]:
    return [
        {
            "cargo": cargo,
            "turno": 1,
            "uf": uf,
            "candidato_id": cid,
            "pct_projetado": pct,
            "pct_atual": pct,
            "votos_atuais": int(round(pct / 100 * BASE_BA * 0.5)),
            "votos_projetados": int(round(pct / 100 * BASE_BA)),
            "pct_apurado": 50.0,
        }
        for cid, pct in _PCTS
    ]


_NATIONAL = [
    {"candidato_id": cid, "pct_projetado": pct, "rank": i + 1}
    for i, (cid, pct) in enumerate(_PCTS)
]


def _ba(cargo: int = 1, **kwargs: Any) -> dict[str, Any]:
    payload = build_edge_payload(
        cargo=cargo,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=_linhas(cargo),
        national_rows=_NATIONAL,
        eleitorado_total_by_uf={"BA": 2_000_000},
        **kwargs,
    )
    (ba,) = [u for u in payload["por_uf"] if u["sigla"] == "BA"]
    return ba


# ---------------------------------------------------------------------------
# 1. O total é o denominador do `pct`
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("cargo", [1, 3, 5])
def test_total_e_a_base_do_pct_nao_a_soma_dos_votos(cargo: int) -> None:
    """Mata `Σ votos_projetados`: com Σ pct = 99,1, a soma daria 991.000."""
    ba = _ba(cargo, base_votaveis_by_uf={"BA": BASE_BA})
    assert ba["votos_disputa_projetados"] == BASE_BA
    assert isinstance(ba["votos_disputa_projetados"], int)
    soma_partes = sum(r["votos_projetados"] for r in _linhas(cargo))
    assert soma_partes != BASE_BA  # a fixture discrimina, de fato
    # pct/100 × total devolve os votos projetados de cada candidatura.
    for t in ba["top_candidatos"]:
        r = next(x for x in _linhas(cargo) if x["candidato_id"] == t["id"])
        assert t["pct"] / 100 * ba["votos_disputa_projetados"] == pytest.approx(
            r["votos_projetados"], abs=1
        )


# ---------------------------------------------------------------------------
# 2. Anulada fora, sub judice dentro
# ---------------------------------------------------------------------------


def test_anulada_sai_do_total_na_mesma_base_do_pct() -> None:
    """Mata "esqueceu a anulada": com 30 (5,1%) anulada, total = 949.000."""
    anul = AnuladosNaDecisao(
        nacional=frozenset({30}), por_uf={}, uf_segue_nacional=True
    )
    ba = _ba(1, base_votaveis_by_uf={"BA": BASE_BA}, anulados=anul)
    assert ba["votos_disputa_projetados"] == round(BASE_BA * (100 - 5.1) / 100)
    # a MESMA base dos pct publicados: pct(compete)/100 × total = votos.
    for t in ba["top_candidatos"]:
        if t["id"] == 30:
            continue
        r = next(x for x in _linhas() if x["candidato_id"] == t["id"])
        assert t["pct"] / 100 * ba["votos_disputa_projetados"] == pytest.approx(
            r["votos_projetados"], abs=1
        )
    # a cauda que compete também: outros.pct/100 × total = Σ votos da cauda.
    cauda = [r for r in _linhas() if r["candidato_id"] == 50]
    assert ba["outros"]["pct"] / 100 * ba["votos_disputa_projetados"] == pytest.approx(
        sum(r["votos_projetados"] for r in cauda), abs=1
    )


def test_helper_so_tira_quem_esta_em_anulados() -> None:
    """O helper só tira quem está em `anulados` — a sub judice (que não está
    lá) compete e fica na base; o ponta a ponta abaixo prova isso com `dvt`."""
    linhas = [{"candidato_id": 1, "pct_projetado": 60.0}, {"candidato_id": 2, "pct_projetado": 40.0}]
    assert votos_disputa_projetados(500_000, linhas, frozenset(), None) == 500_000
    base = proj.base_da_disputa(linhas, frozenset({2}))
    assert isinstance(base, BaseDaDisputa)
    assert base.projetado == pytest.approx(100 / 60)
    assert votos_disputa_projetados(500_000, linhas, frozenset({2}), base) == 300_000


# ---------------------------------------------------------------------------
# 3 e 4. Ponta a ponta — `_do_project` inteiro
# ---------------------------------------------------------------------------

ANA, BRUNO, CARLA, DAVI = 13, 22, 57, 60
_DVT = {ANA: VALIDO, BRUNO: VALIDO, CARLA: SUB_JUDICE, DAVI: ANULADO}
_SHARES = {ANA: 0.45, BRUNO: 0.30, CARLA: 0.10, DAVI: 0.15}


def _consistente(body: dict[str, Any], sigla: str, fora: set[int]) -> int:
    linha = _por_uf(body["payload"], sigla)
    total = linha["votos_disputa_projetados"]
    assert isinstance(total, int) and total > 0
    uf = {c["id"]: c for c in body["payloads_uf"][sigla]["candidatos"]}
    # Σ pct de quem compete (+ outros) ≈ 100.
    soma = sum(t["pct"] for t in linha["top_candidatos"] if t["id"] not in fora)
    soma += (linha.get("outros") or {}).get("pct", 0.0)
    assert soma == pytest.approx(100.0, abs=0.05)
    # pct/100 × total ≈ votos_projetados do payload POR UF.
    for t in linha["top_candidatos"]:
        if t["id"] in fora:
            continue
        vp = uf[t["id"]]["votos_projetados"]
        assert t["pct"] / 100 * total == pytest.approx(vp, rel=1e-5, abs=2), (sigla, t["id"])
    # e o total é o de quem compete: Σ votos_projetados das que competem.
    competem = sum(c["votos_projetados"] for cid, c in uf.items() if cid not in fora)
    assert total == pytest.approx(competem, rel=1e-4)
    return total


@pytest.mark.parametrize("cargo", [1, 3])
def test_ponta_a_ponta_com_anulada(monkeypatch, cargo: int) -> None:
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, _dvt_fixo(_DVT), cargo=cargo)
    body = _rodar(monkeypatch, snaps, eleit, cargo=cargo)
    for sigla in ("SP", "RJ"):
        total = _consistente(body, sigla, {DAVI})
        uf = {c["id"]: c for c in body["payloads_uf"][sigla]["candidatos"]}
        todos = sum(c["votos_projetados"] for c in uf.values())
        # a anulada (≈15%) ficou FORA do total; a sub judice, dentro.
        assert total == pytest.approx(todos - uf[DAVI]["votos_projetados"], rel=1e-4)
        assert total < todos * 0.9


def test_ponta_a_ponta_sem_destino_publicado_total_e_a_base_inteira(monkeypatch) -> None:
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, lambda *_: None, cargo=3)
    body = _rodar(monkeypatch, snaps, eleit, cargo=3)
    for sigla in ("SP", "RJ"):
        total = _consistente(body, sigla, set())
        uf = body["payloads_uf"][sigla]["candidatos"]
        assert total == pytest.approx(sum(c["votos_projetados"] for c in uf), rel=1e-4)


S451, S131, S221, S401 = 451, 131, 221, 401


def test_senado_em_votos_nunca_pessoas(monkeypatch) -> None:
    sp = {S451: 0.30, S131: 0.27, S221: 0.23, S401: 0.20}

    def dvt(uf, _zona, cod):
        return ANULADO if (uf, cod) == ("SP", S451) else VALIDO

    snaps, eleit = _cenario({"SP": sp, "RJ": sp}, dvt, cargo=5, vpe=2)
    body = _rodar(monkeypatch, snaps, eleit, cargo=5)
    total_sp = _consistente(body, "SP", {S451})
    total_rj = _consistente(body, "RJ", set())
    # Mesma votação nas duas UFs; SP perde só os ~30% da anulada.
    assert total_sp == pytest.approx(total_rj * 0.70, rel=0.02)
    # Em VOTOS: o total de RJ é Σ vvc (2 votos por eleitor), o dobro das
    # pessoas que compareceram.
    comparecimento_rj = sum(
        int(s["payload"]["e"]["c"])
        for s in snaps
        if s["uf"] == "RJ" and s.get("nivel") is None
    )
    vvc_rj = sum(
        int(s["payload"]["v"]["vvc"])
        for s in snaps
        if s["uf"] == "RJ" and s.get("nivel") is None
    )
    assert total_rj == vvc_rj
    # (`vvc ≈ 1,89 × c` aqui porque `c` também conta brancos e nulos; um total
    # em PESSOAS ficaria abaixo de `c`.)
    assert total_rj > 1.5 * comparecimento_rj


# ---------------------------------------------------------------------------
# 5. Ausente, nunca zero
# ---------------------------------------------------------------------------


def test_ausente_sem_base_caller_legado() -> None:
    assert "votos_disputa_projetados" not in _ba(1)


def test_ausente_quando_a_uf_nao_tem_base() -> None:
    assert "votos_disputa_projetados" not in _ba(1, base_votaveis_by_uf={"SP": BASE_BA})


@pytest.mark.parametrize("base", [0, -5, float("nan")])
def test_ausente_com_base_nao_positiva(base: float) -> None:
    assert "votos_disputa_projetados" not in _ba(1, base_votaveis_by_uf={"BA": base})


def test_ausente_quando_todas_estao_anuladas() -> None:
    linhas = [{"candidato_id": 1, "pct_projetado": 70.0}, {"candidato_id": 2, "pct_projetado": 30.0}]
    fora = frozenset({1, 2})
    assert proj.base_da_disputa(linhas, fora) is None
    assert votos_disputa_projetados(500_000, linhas, fora, None) is None


def test_anulada_so_em_outra_uf_nao_mexe(monkeypatch) -> None:
    """Governador: anulada só em SP; RJ sai com a base inteira."""

    def dvt(uf, _zona, cod):
        return ANULADO if (uf, cod) == ("SP", DAVI) else VALIDO

    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, dvt, cargo=3)
    body = _rodar(monkeypatch, snaps, eleit, cargo=3)
    total_sp = _consistente(body, "SP", {DAVI})
    total_rj = _consistente(body, "RJ", set())
    assert total_sp == pytest.approx(total_rj * 0.85, rel=0.02)
