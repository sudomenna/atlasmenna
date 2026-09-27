"""Prova, sem banco, do efeito de carregar `eleitorado` do DF.

Contexto (2026-09-27): `eleitorado` não tem o DF porque sua fonte é o CSV da
eleição MUNICIPAL de 2024 (`data-pipeline/eleitorado-import.ts`), e o DF não
elege prefeito. `_resolve_zone_weight` (api/model/project.py:2510-2528) dá
peso 0 a toda zona sem linha em `eleitorado`, e `_is_apurada`
(api/model/extrapolation.py:181-187) exige `weight > 0` — então NENHUMA zona
do DF nunca é considerada "apurada", não importa quantos boletins do TSE
cheguem. Efeito: Presidente-DF cai no fallback nacional com `pct_apurado`
travado em 0 (RF-017 2º nível); Governador/Senador do DF ficam OMITIDOS de
`rows` inteiramente (não existe fallback nacional para corrida estadual) —
"aguardando projeção" a noite inteira, mesmo com 100% das zonas apuradas.

`tests/unit/model/test_pct_apurado_denominador.py::
test_uf_ausente_de_eleitorado_nao_gera_divisao_por_zero` já cobre o lado
"sem eleitorado" para cargo 1 e continua passando (não foi tocado). Este
arquivo cobre o lado de DEPOIS — `eleitorado` com as linhas do DF
(`data-pipeline/eleitorado-df-import.ts`) — para os três cargos majoritários
que passam por `compute_uf_projections` (1, 3, 5).
"""

from __future__ import annotations

import pytest

from api.model.project import compute_uf_projections

# Duas zonas reais do DF (fixture `tests/fixtures/tse/2026-sim/df/`,
# `df97012-z0001-...json` e `...z0002...`) — números de `e.te` verdadeiros.
_DF_ZONA_1_TE = 74957
_DF_ZONA_2_TE = 114512


def _cand_payload(vap_by_cand: dict[int, int], *, te: int, esi: int, c: int, vvc: int) -> dict:
    a = max(0, esi - c)
    return {
        "e": {"te": str(te), "esi": str(esi), "c": str(c), "a": str(a)},
        "v": {"vvc": str(vvc), "vv": str(vvc), "vb": "0", "tvn": "0"},
        "cand": [{"n": str(cod), "vap": str(vap)} for cod, vap in vap_by_cand.items()],
    }


def _snapshots_df_duas_zonas_100pct() -> list[dict]:
    """DF com as 2 zonas do fixture 100% apuradas — mesmo payload para os
    três cargos majoritários (o schema EA20 não muda por cargo)."""
    return [
        {
            "uf": "DF",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _cand_payload(
                {100: 40000, 200: 30000},
                te=_DF_ZONA_1_TE,
                esi=_DF_ZONA_1_TE,
                c=70000,
                vvc=70000,
            ),
        },
        {
            "uf": "DF",
            "cod_zona": 2,
            "pct_apurado": 100.0,
            "payload": _cand_payload(
                {100: 60000, 200: 45000},
                te=_DF_ZONA_2_TE,
                esi=_DF_ZONA_2_TE,
                c=105000,
                vvc=105000,
            ),
        },
    ]


@pytest.mark.parametrize("cargo", [1, 3, 5])
def test_df_com_eleitorado_aparece_com_pct_apurado_real(cargo: int) -> None:
    """Com as linhas do DF em `eleitorado` (o que `eleitorado-df-import.ts`
    grava), as duas zonas do DF pesam > 0, viram "apuradas" e o DF aparece
    em `rows` com `pct_apurado` real — não mais 0.0 nem ausente — para os
    três cargos majoritários (Presidente, Governador, Senador)."""
    eleitorado = {("DF", 1): _DF_ZONA_1_TE, ("DF", 2): _DF_ZONA_2_TE}
    snapshots = _snapshots_df_duas_zonas_100pct()

    rows, _est, _est_c, cand_by_uf = compute_uf_projections(
        cargo=cargo, turno=1, seed_base=42, snapshots=snapshots, eleitorado=eleitorado,
    )

    df_rows = [r for r in rows if r["uf"] == "DF"]
    assert df_rows, f"cargo {cargo}: DF deveria aparecer em rows, mas está ausente"
    assert "DF" in cand_by_uf

    # As duas zonas fecharam a 100% -> pct_apurado da UF deve refletir isso
    # (bem acima de 0, o valor travado do bug).
    for r in df_rows:
        assert r["pct_apurado"] == pytest.approx(100.0, abs=0.01)
        assert r["metodo"]["tipo"] == "extrapolacao_apurado"
        # Sem eleitorado, o bug fazia pct_atual/pct_projetado ficarem presos
        # em 0 ou a UF nem chegar a ter linha — aqui os votos reais contam.
        assert r["votos_atuais"] > 0


@pytest.mark.parametrize("cargo", [3, 5])
def test_df_sem_eleitorado_fica_omitido_governador_senador(cargo: int) -> None:
    """Sem o DF em `eleitorado` (estado ATUAL antes da carga), Governador e
    Senador do DF ficam OMITIDOS de `rows` mesmo com 100% das zonas
    apuradas — não existe fallback nacional para corrida estadual (só
    cargo 1 tem `impute_uf_from_national`). Documenta o "aguardando
    projeção a noite inteira" citado no diagnóstico de 2026-09-27."""
    eleitorado: dict[tuple[str, int], int] = {}  # DF ausente de propósito
    snapshots = _snapshots_df_duas_zonas_100pct()

    rows, _est, _est_c, cand_by_uf = compute_uf_projections(
        cargo=cargo, turno=1, seed_base=42, snapshots=snapshots, eleitorado=eleitorado,
    )

    assert [r for r in rows if r["uf"] == "DF"] == []
    assert "DF" not in cand_by_uf


def test_df_sem_eleitorado_cargo_presidente_fica_zero_nao_ausente() -> None:
    """Contraparte de `test_df_com_eleitorado_...`: sem eleitorado do DF,
    Presidente-DF ainda aparece (via fallback nacional), mas com
    `pct_apurado` travado em 0.0 e método "imputado_nacional" — os votos
    reais das duas zonas (100% apuradas) são descartados. Mesmo
    comportamento de `test_pct_apurado_denominador.py::
    test_uf_ausente_de_eleitorado_nao_gera_divisao_por_zero`, com um
    payload mais próximo do real (2 zonas, não 1)."""
    eleitorado = {("SP", 1): 100_000}  # só para dar "nacional" a ancorar
    snapshots = _snapshots_df_duas_zonas_100pct() + [
        {
            "uf": "SP",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _cand_payload({100: 55000, 200: 45000}, te=100_000, esi=100_000, c=100_000, vvc=100_000),
        },
    ]

    rows, _est, _est_c, _cand_by_uf = compute_uf_projections(
        cargo=1, turno=1, seed_base=42, snapshots=snapshots, eleitorado=eleitorado,
    )

    df_rows = {r["candidato_id"]: r for r in rows if r["uf"] == "DF"}
    assert set(df_rows.keys()) == {100, 200}
    for r in df_rows.values():
        assert r["metodo"]["tipo"] == "imputado_nacional"
        assert r["pct_apurado"] == 0.0
