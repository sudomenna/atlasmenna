"""ADR-0053 / RF-213 — a anulada vai para o FIM do elenco da série (spec 020).

A tela ordena as listas por `ordensPorBase` (`lib/utils/rank-parcial.ts`), que
é `anuladasAoFim(rankByParcial(...))`: a candidatura de destino `"anulado"`
continua na lista, com o percentual oficial, mas no fim — ela não disputa a
vaga. O gráfico de evolução escolhe as suas quatro no PRODUTOR, por
`ordenar_por_parcial`, e o consumidor não reordena (ADR-0046 D4). Sem a mesma
partição aqui, a anulada que lidera o apurado ocupava uma das quatro linhas
enquanto a tabela logo acima a manda para o fim.

Cada teste nomeia a mutação que mata:

  M1. filtro removido — a partição some de `ordenar_por_parcial`;
  M2. sub judice filtrado — a regra vira `destino == "valido"` (ou inclui
      `"sub_judice"`);
  M3. paridade quebrada — o TypeScript (ou o gerador de fixture) muda de regra
      e o produtor não.

Nenhum teste toca banco.
"""

from __future__ import annotations

import importlib.util
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from api.model.project import (
    DESTINO_FORA_DA_DECISAO,
    SeriePorCandidatoBruta,
    _balde_epoch,
    anulados_na_decisao,
    build_edge_payload,
    build_uf_payloads,
    montar_serie_por_candidato,
    ordenar_por_parcial,
)

RAIZ = Path(__file__).resolve().parents[3]
BOLETIM = datetime(2026, 10, 4, 20, 0, 0, tzinfo=timezone.utc)

#: 11 lidera o APURADO. É ela que vira anulada nos testes — a posição em que a
#: partição mais importa, porque é a 1ª linha do gráfico. Com 5 candidaturas o
#: elenco das 4 muda de COMPOSIÇÃO (55 entra, 11 sai), não só de ordem.
_CINCO = [
    ("SP", 11, 3_500_000, 35.0, 34.0),
    ("SP", 22, 3_000_000, 30.0, 19.0),
    ("SP", 33, 2_000_000, 20.0, 29.0),
    ("SP", 44, 1_000_000, 10.0, 5.0),
    ("SP", 55, 500_000, 5.0, 13.0),
]


def _cand(cid: int, atual: float, proj: float, destino: str | None = None) -> dict[str, Any]:
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


def _cinco(destino_do_11: str | None) -> list[dict[str, Any]]:
    return [
        _cand(cid, pct, proj, destino_do_11 if cid == 11 else None)
        for _uf, cid, _v, pct, proj in _CINCO
    ]


def _bruta(escopo: str | None) -> SeriePorCandidatoBruta:
    ponto = lambda pct, proj: {  # noqa: E731
        "momento": BOLETIM,
        "pct_atual": pct,
        "pct_projetado": proj,
    }
    return SeriePorCandidatoBruta(
        5,
        {
            escopo: {
                cid: {_balde_epoch(BOLETIM, 5): ponto(pct, proj)}
                for _uf, cid, _v, pct, proj in _CINCO
            }
        },
    )


def _uf_row(cargo: int, uf: str, cid: int, votos: int, pct_atual: float, pct: float):
    return {
        "cargo": cargo,
        "turno": 1,
        "uf": uf,
        "candidato_id": cid,
        "votos_projetados": votos * 2,
        "votos_atuais": votos,
        "pct_atual": pct_atual,
        "pct_projetado": pct,
        "pct_projetado_lower": pct - 1,
        "pct_projetado_upper": pct + 1,
        "p_vitoria": None,
        "pct_apurado": 50.0,
    }


def _national_row(cargo: int, cid: int, pct_projetado: float, rank: int, pct_atual: float):
    return {
        "cargo": cargo,
        "turno": 1,
        "uf": None,
        "candidato_id": cid,
        "votos_projetados": 1_000_000,
        "pct_atual": pct_atual,
        "pct_projetado": pct_projetado,
        "pct_projetado_lower": pct_projetado - 1,
        "pct_projetado_upper": pct_projetado + 1,
        "p_vitoria": 0.5,
        "pct_apurado": None,
        "rank": rank,
        "p_passa_2t": 0.5,
        "p_fecha_1t": 0.1,
    }


# ===========================================================================
# O comparador + a partição
# ===========================================================================


def test_anulada_que_lidera_o_apurado_vai_para_o_fim() -> None:
    """M1. Sem a partição a ordem seria [11, 22, 33, 44, 55]."""
    assert [c["id"] for c in ordenar_por_parcial(_cinco("anulado"))] == [22, 33, 44, 55, 11]


def test_sub_judice_e_valido_competem_no_lugar_de_sempre() -> None:
    """M2. Sub judice e `"valido"` são o comparador puro, idênticos a sem destino."""
    sem = [c["id"] for c in ordenar_por_parcial(_cinco(None))]
    assert sem == [11, 22, 33, 44, 55]
    assert [c["id"] for c in ordenar_por_parcial(_cinco("sub_judice"))] == sem
    assert [c["id"] for c in ordenar_por_parcial(_cinco("valido"))] == sem


def test_sem_destino_a_saida_e_byte_a_byte_a_de_antes() -> None:
    """Nenhum `destino` ⇒ exatamente `sorted(..., key=_chave_parcial)` — os
    dicionários inteiros, não só os ids. É o estado de toda UF antes de o TSE
    publicar `dvt`."""
    from api.model.project import _chave_parcial

    cands = _cinco(None)
    assert ordenar_por_parcial(cands) == [dict(c) for c in sorted(cands, key=_chave_parcial)]


def test_particao_estavel_nos_dois_lados() -> None:
    """Duas anuladas mantêm entre si a ordem do comparador, e as que competem
    também — é o `push` em ordem de `anuladasAoFim`, não um re-sort."""
    cands = [
        _cand(1, 40.0, 10.0, "anulado"),
        _cand(2, 30.0, 10.0),
        _cand(3, 30.0, 20.0, "anulado"),
        _cand(4, 30.0, 20.0, "sub_judice"),
        _cand(5, 5.0, 1.0),
    ]
    # comparador: 1, 3|4 empatam em atual e proj → id asc (3, 4), 2, 5
    assert [c["id"] for c in ordenar_por_parcial(cands)] == [4, 2, 5, 1, 3]


def test_elenco_das_quatro_troca_de_composicao() -> None:
    """M1 no gráfico: a anulada que lidera sai das quatro e 55 entra."""
    serie = montar_serie_por_candidato(_bruta("SP"), "SP", _cinco("anulado"))
    assert serie is not None
    assert [c["id"] for c in serie["candidatos"]] == [22, 33, 44, 55]


def test_com_menos_de_quatro_a_anulada_nao_entra_nem_com_vaga_sobrando() -> None:
    """Emenda de 2026-09-27 ao ADR-0053 (2ª parte, decisão do dono): a série não
    carrega a linha da anulada — nem quando sobra vaga. Sub judice entra."""
    tres = [c for c in _cinco("anulado") if c["id"] in (11, 22, 33)]
    serie = montar_serie_por_candidato(_bruta("SP"), "SP", tres)
    assert serie is not None
    assert [c["id"] for c in serie["candidatos"]] == [22, 33]
    sj = [c for c in _cinco("sub_judice") if c["id"] in (11, 22, 33)]
    serie = montar_serie_por_candidato(_bruta("SP"), "SP", sj)
    assert serie is not None
    assert [c["id"] for c in serie["candidatos"]] == [11, 22, 33]


# ===========================================================================
# Fio: o `destino` que chega ao elenco é o do escopo certo
# ===========================================================================


def test_fio_uf_governador_usa_o_destino_da_propria_uf() -> None:
    """Gov/Sen decidem com o destino DA UF. O 11 anulado em SP sai do elenco
    de SP; o mesmo número anulado no RJ não afeta SP (outra candidatura)."""
    rows = [_uf_row(3, uf, cid, v, pct, proj) for uf, cid, v, pct, proj in _CINCO]
    nat = [
        _national_row(3, cid, proj, i + 1, pct)
        for i, (_uf, cid, _v, pct, proj) in enumerate(_CINCO)
    ]
    comum = dict(
        cargo=3,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=rows,
        national_rows=nat,
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf={},
        serie_bruta=_bruta("SP"),
    )
    an_sp = anulados_na_decisao({("SP", 11): "anulado"}, 3)
    serie = build_uf_payloads(**comum, anulados=an_sp)["SP"]["series_temporais"]["por_candidato"]
    assert [c["id"] for c in serie["candidatos"]] == [22, 33, 44, 55]

    an_rj = anulados_na_decisao({("RJ", 11): "anulado"}, 3)
    serie = build_uf_payloads(**comum, anulados=an_rj)["SP"]["series_temporais"]["por_candidato"]
    assert [c["id"] for c in serie["candidatos"]] == [11, 22, 33, 44]


def test_fio_nacional_presidente_usa_o_destino_nacional() -> None:
    """Presidente: o destino é o nacional, e a série nacional o respeita."""
    payload = build_edge_payload(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=[_uf_row(1, uf, cid, v, pct, proj) for uf, cid, v, pct, proj in _CINCO],
        national_rows=[
            _national_row(1, cid, proj, i + 1, pct)
            for i, (_uf, cid, _v, pct, proj) in enumerate(_CINCO)
        ],
        eleitorado_total_by_uf={"SP": 34_000_000},
        serie_bruta=_bruta(None),
        anulados=anulados_na_decisao({("BR", 11): "anulado"}, 1),
    )
    assert [c["id"] for c in payload["serie_por_candidato"]["candidatos"]] == [22, 33, 44, 55]


# ===========================================================================
# M3 — paridade com o TypeScript e com o gerador de fixture
# ===========================================================================


def _corpo_ts(arquivo: str, nome: str) -> str:
    fonte = (RAIZ / "lib" / "utils" / arquivo).read_text(encoding="utf-8")
    depois = fonte.split(f"export function {nome}")[1]
    return re.split(r"\nexport ", depois)[0]


def test_paridade_a_tela_parte_as_anuladas_depois_do_comparador_de_parcial() -> None:
    """`ordensPorBase` aplica `anuladasAoFim` SOBRE `rankByParcial` — a mesma
    composição de `ordenar_por_parcial`. Se a tela mover a partição para dentro
    do comparador, ou deixar de aplicá-la, este guarda reprova."""
    corpo = _corpo_ts("rank-parcial.ts", "ordensPorBase")
    assert re.search(r"anuladasAoFim\(\s*rankByParcial\(\s*candidatos\s*\)\s*\)", corpo)


def test_paridade_a_regra_de_quem_compete_e_a_mesma() -> None:
    """`compete` é `destino !== "anulado"` e `anuladasAoFim` devolve
    `[...competem, ...anuladas]`, estável. O Python usa a mesma constante."""
    compete = _corpo_ts("destino-voto.ts", "compete")
    assert re.search(r'return\s+c\?\.destino\s*!==\s*"anulado"\s*;', compete)
    fim = _corpo_ts("destino-voto.ts", "anuladasAoFim")
    assert re.search(r"return\s+\[\.\.\.competem,\s*\.\.\.anuladas\]\s*;", fim)
    assert DESTINO_FORA_DA_DECISAO == "anulado"


def _gerador() -> Any:
    caminho = RAIZ / "scripts" / "gerar-serie-fixtures.py"
    spec = importlib.util.spec_from_file_location("gerar_serie_fixtures", caminho)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_CASOS_GERADOR = [
    _cinco(None),
    _cinco("anulado"),
    _cinco("sub_judice"),
    [
        _cand(1, 40.0, 10.0, "anulado"),
        _cand(2, 30.0, 10.0),
        _cand(3, 30.0, 20.0, "anulado"),
        _cand(4, 30.0, 20.0, "sub_judice"),
        _cand(5, 0.0, 1.0),
        _cand(6, 0.0, 9.0, "valido"),
    ],
]


@pytest.mark.parametrize("cands", _CASOS_GERADOR)
def test_paridade_gerador_de_fixture_e_produtor(cands: list[dict[str, Any]]) -> None:
    """O simulado escolhe as quatro com a MESMA regra do produtor."""
    g = _gerador()
    assert [c["id"] for c in g.rank_parcial(cands)] == [
        c["id"] for c in ordenar_por_parcial(cands)
    ]


def test_gerador_governador_herda_o_destino_da_uf() -> None:
    """Gov no simulado: identidade E destino da linha da UF (`daUf?.destino ??
    c.destino`), números do nacional. Sem isso a anulada da UF nunca chegaria
    ao `rank_parcial` — o bloco nacional de Gov não carrega destino."""
    g = _gerador()
    numeros = {c["id"]: c for c in _cinco(None)}
    row = {
        "top_candidatos": [
            {"id": 11, "nome": "UF11", "destino": "anulado"},
            {"id": 22, "nome": "UF22"},
            {"id": 33, "nome": "UF33", "destino": "sub_judice"},
            {"id": 44, "nome": "UF44"},
            {"id": 55, "nome": "UF55"},
        ]
    }
    cands = g.cands_gov_da_uf(row, numeros)
    assert [c.get("destino") for c in cands] == ["anulado", None, "sub_judice", None, None]
    assert [c["id"] for c in g.serie_de(cands, BOLETIM.isoformat())["candidatos"]] == [
        22,
        33,
        44,
        55,
    ]
    # Fallback: sem destino na UF, vale o do nacional.
    numeros_com = {**numeros, 22: {**numeros[22], "destino": "anulado"}}
    cands = g.cands_gov_da_uf({"top_candidatos": [{"id": 22}]}, numeros_com)
    assert cands[0]["destino"] == "anulado"
