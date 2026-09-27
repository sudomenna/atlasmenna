"""Emenda ao ADR-0053 (opção A, 2026-09-27) — a série de Governador do simulado
sai da MESMA lista que a página mostra (`governador-uf.json`).

Com anulada publicada na UF, o resumo da UF traz os percentuais de quem compete
sobre os votos em disputa; o bloco nacional de Governador não muda. Ler os
números do nacional (a junção antiga, `cands_gov_da_uf`) poria na série um
percentual que o painel ao lado não mostra.

Cada teste nomeia a mutação que mata:

  M1. fonte errada — `cands_gov` voltar a ler os números do nacional;
  M2. fallback perdido — sem `governador-uf.json`, a série some em vez de cair
      na junção antiga;
  M3. anulada no gráfico — a linha dela entra quando sobra vaga (competem < 4)
      ou quando lidera o apurado.

Nenhum teste toca banco nem as fixtures em disco.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parents[3]
TS = "2026-10-04T20:15:00+00:00"


def _gerador() -> Any:
    caminho = RAIZ / "scripts" / "gerar-serie-fixtures.py"
    spec = importlib.util.spec_from_file_location("gerar_serie_fixtures_disputa", caminho)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _c(cid: int, atual: float, proj: float, destino: str | None = None) -> dict[str, Any]:
    c: dict[str, Any] = {
        "id": cid,
        "nome": f"C{cid}",
        "partido": "X",
        "pct_atual": atual,
        "pct_projetado": proj,
    }
    if destino is not None:
        c["destino"] = destino
    return c


#: O nacional de Governador: percentuais sobre o `vvc` (não muda com a emenda).
_NACIONAL = {
    1: _c(1, 45.0, 44.0),
    2: _c(2, 36.0, 37.0),
    3: _c(3, 10.0, 11.0, "anulado"),
    4: _c(4, 9.0, 8.0, "sub_judice"),
}
_ROW = {"top_candidatos": [{"id": i} for i in (1, 2, 3, 4)]}

#: O resumo DA UF: quem compete sobre os votos em disputa (÷ 0,90 / ÷ 0,89).
_RESUMO_SP = {
    "candidatos": [
        _c(1, 50.0, 49.44),
        _c(2, 40.0, 41.57),
        _c(3, 10.0, 11.0, "anulado"),
        _c(4, 10.0, 8.99, "sub_judice"),
    ]
}


def test_serie_de_governador_usa_o_resumo_da_uf() -> None:
    """M1 — o último ponto é o percentual SOBRE A DISPUTA, o do painel."""
    g = _gerador()
    cands = g.cands_gov("SP", _ROW, _NACIONAL, {"SP": _RESUMO_SP})
    serie = g.serie_de(cands, TS)
    ultimo = {c["id"]: (c["apurado"][-1], c["projetado"][-1]) for c in serie["candidatos"]}
    assert ultimo[1] == (50.0, 49.44)
    assert ultimo[2] == (40.0, 41.57)
    assert ultimo[4] == (10.0, 8.99)  # sub judice COMPETE, e sai sobre a disputa
    # A anulada NÃO entra, mesmo com vaga sobrando (3 competem, elenco é 4).
    assert [c["id"] for c in serie["candidatos"]] == [1, 2, 4]


def test_sem_resumo_da_uf_cai_na_juncao_antiga() -> None:
    """M2 — arquivo ausente (ou UF ausente nele) não apaga a série."""
    g = _gerador()
    for resumos in ({}, {"RJ": _RESUMO_SP}, {"SP": {"candidatos": []}}):
        cands = g.cands_gov("SP", _ROW, _NACIONAL, resumos)
        assert [c["id"] for c in cands] == [1, 2, 3, 4]
        assert cands[0]["pct_atual"] == 45.0


def test_anulada_nunca_entra_na_serie() -> None:
    """M3 — decisão do dono (27/09): nem liderando o apurado, nem com vaga."""
    g = _gerador()
    lidera = [_c(9, 60.0, 5.0, "anulado"), _c(1, 20.0, 50.0), _c(2, 20.0, 45.0)]
    assert [c["id"] for c in g.serie_de(lidera, TS)["candidatos"]] == [1, 2]
    cinco = [_c(9, 60.0, 5.0, "anulado")] + [_c(i, 10.0 - i, 10.0 - i) for i in range(1, 5)]
    assert [c["id"] for c in g.serie_de(cinco, TS)["candidatos"]] == [1, 2, 3, 4]
    # Sub judice COMPETE e entra.
    sj = [_c(1, 50.0, 50.0), _c(2, 30.0, 30.0, "sub_judice"), _c(3, 20.0, 20.0, "anulado")]
    assert [c["id"] for c in g.serie_de(sj, TS)["candidatos"]] == [1, 2]
    # Só anuladas: sem série, em vez de uma série com a anulada.
    assert g.serie_de([_c(9, 60.0, 5.0, "anulado")], TS) is None
