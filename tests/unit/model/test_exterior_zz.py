"""ADR-0045 — o exterior (`ZZ`) como 28ª unidade de apuração, só no Presidente.

O que este arquivo trava, e por quê cada trava existe:

  (a) Isolamento por cargo. `ZZ` tem eleitorado carregado, mas só o cargo 1 o
      apura. Se ele ficar no denominador de Governador/Senador/Deputado, o
      `% apurado` nunca passa de ~99,4% — a tela da noite nunca fecha.
  (b) Pseudo-zona. As ~186 localidades do exterior compartilham a zona 1; sem a
      exceção declarada, `merge_pairs_into_zonas` as somaria em UMA unidade e o
      bootstrap daria intervalo de largura zero (constituição § 6).
  (c) A exceção vale SÓ para `ZZ`: uma UF qualquer com o mesmo desenho
      (vários municípios na zona 1) continua colapsando em uma zona.
  (d) `swing_vs_2022` é `None` no exterior, mesmo havendo histórico de 2022.
  (e) O nacional do cargo 1 inclui o exterior, ponderado pelo eleitorado.
  (f) Exterior sem boletim ainda não quebra nada nem publica linha enganosa.

O gate OT-4 (replay 2022) não se move: o fixture exclui `ZZ`, e nenhum caminho
das 27 UFs mudou (`test_exterior_zz.py::test_27_ufs_*` + o próprio replay).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

import numpy as np
import pytest

from api.model import project as proj_mod
from api.model.cargos import UF_EXTERIOR, UFS_BRASIL, ufs_do_cargo
from api.model.project import (
    _compute_estratos_por_uf,
    _eleitorado_total_by_uf,
    aggregate_national_estimates,
    build_edge_payload,
    compute_national,
    compute_swing_descritivo,
    compute_uf_projections,
    eleitorado_do_cargo,
    fetch_eleitorado,
    pct_atual_nacional_por_candidato,
)
from api.model.zona_merge import (
    check_zona_merge_sanity,
    cod_zona_de_agrupamento,
    merge_pairs_into_zonas,
)

# As fixtures do ciclo completo vivem em `test_orchestrator.py` (FakeConn que
# fala os SQLs de `project.py`). Importá-las é o que faz `_do_project` rodar
# contra o MESMO dublê dos demais testes de ciclo.
from tests.unit.model.test_orchestrator import (  # noqa: F401 — `fake_db` é fixture
    _synthetic_payload,
    fake_db,
)

# ---------------------------------------------------------------------------
# Construtores
# ---------------------------------------------------------------------------

N_LOCALIDADES = 186
COD_LOCALIDADE_BASE = 29_000  # códigos de município TSE do exterior ficam longe dos de SP


def _payload(vap_by_cand: dict[int, int], *, te: int, esi: int, c: int, vvc: int) -> dict:
    """Envelope EA20 mínimo que `_extract_zone_candidatos` entende."""
    return {
        "e": {"te": str(te), "esi": str(esi), "c": str(c), "a": str(max(0, esi - c))},
        "v": {"vvc": str(vvc), "vv": str(vvc), "vb": "0", "tvn": "0"},
        "s": {"si": "1", "sa": "1", "psa": "100,00"},
        "cand": [{"n": str(cod), "vap": str(vap)} for cod, vap in vap_by_cand.items()],
    }


def _linha_exterior(i: int, *, share_a: float = 0.60, apurado: float = 100.0) -> dict[str, Any]:
    """Uma localidade do exterior: `(ZZ, cod_municipio_tse, zona 1)`.

    O share varia com `i` (mesmo desenho do mundo real: consulado a consulado
    o resultado difere) — é o que dá ao bootstrap variância a medir.
    """
    a = int(round(1000 * min(0.95, max(0.05, share_a + (i % 7 - 3) * 0.03))))
    return {
        "uf": "ZZ",
        "cod_municipio_tse": COD_LOCALIDADE_BASE + i,
        "cod_zona": 1,
        "pct_apurado": apurado,
        "payload": _payload({100: a, 200: 1000 - a}, te=1200, esi=1200, c=1000, vvc=1000),
    }


def _linha_sp(i: int, *, cod_zona: int = 1) -> dict[str, Any]:
    """Um par de SP — mesmo desenho (zona 1, município diferente), outra UF."""
    return {
        "uf": "SP",
        "cod_municipio_tse": 71_000 + i,
        "cod_zona": cod_zona,
        "pct_apurado": 100.0,
        "payload": _payload({100: 400 + i, 200: 600 - i}, te=1200, esi=1200, c=1000, vvc=1000),
    }


# ---------------------------------------------------------------------------
# cargos.py — o contrato espelhado do TS
# ---------------------------------------------------------------------------


def test_universo_do_presidente_tem_o_exterior_e_o_dos_outros_cargos_nao() -> None:
    assert len(UFS_BRASIL) == 27 and UF_EXTERIOR not in UFS_BRASIL
    assert ufs_do_cargo(1) == (*UFS_BRASIL, UF_EXTERIOR)
    for cargo in (3, 5, 6, 7, 8):
        assert UF_EXTERIOR not in ufs_do_cargo(cargo), cargo


# ---------------------------------------------------------------------------
# (a) Isolamento por cargo
# ---------------------------------------------------------------------------


def _eleitorado_com_exterior() -> dict[tuple[str, int], int]:
    return {
        ("SP", 1): 100_000,
        ("SP", 2): 200_000,
        ("ZZ", COD_LOCALIDADE_BASE): 5_000,
        ("ZZ", COD_LOCALIDADE_BASE + 1): 7_000,
    }


def test_eleitorado_do_cargo_tira_o_exterior_dos_cargos_sem_exterior() -> None:
    eleitorado = _eleitorado_com_exterior()
    for cargo in (3, 5, 6, 7, 8, 99):
        sem = eleitorado_do_cargo(eleitorado, cargo)
        assert all(uf != "ZZ" for (uf, _z) in sem), cargo
        assert _eleitorado_total_by_uf(sem) == {"SP": 300_000}, cargo
    # O Presidente fica com o exterior, e nada é copiado nem alterado.
    com = eleitorado_do_cargo(eleitorado, 1)
    assert com is eleitorado
    assert _eleitorado_total_by_uf(com)["ZZ"] == 12_000
    # A entrada original nunca é mutada (a retirada devolve dict novo).
    assert ("ZZ", COD_LOCALIDADE_BASE) in eleitorado


def test_eleitorado_do_cargo_sem_zz_devolve_o_mesmo_objeto() -> None:
    """Os ciclos de antes de o exterior existir no banco não pagam cópia."""
    so_sp = {("SP", 1): 1}
    assert eleitorado_do_cargo(so_sp, 3) is so_sp


def _rodar_ciclo(
    fake_db: Any,
    monkeypatch: pytest.MonkeyPatch,
    *,
    cargo: int,
    snapshots: list[dict[str, Any]],
    eleitorado: list[dict[str, Any]],
) -> dict[str, Any]:
    """`_do_project` inteiro contra o FakeConn; devolve o payload do Edge Config."""
    fake_db(snapshots, [], eleitorado)
    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")
    capturado: dict[str, Any] = {}

    class _Resposta:
        status = 200

        def __enter__(self) -> "_Resposta":
            return self

        def __exit__(self, *a: Any) -> None:
            return None

    def _urlopen(req: Any, timeout: int = 10) -> _Resposta:  # noqa: ARG001
        capturado["body"] = json.loads(req.data.decode("utf-8"))
        return _Resposta()

    monkeypatch.setattr(proj_mod.urllib.request, "urlopen", _urlopen)
    body = json.dumps(
        {"cargo": cargo, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")
    status, resposta = proj_mod._do_project(body)
    assert status == 200, resposta
    assert resposta["computed"] is True
    return capturado["body"]["payload"]


def _eleitorado_fixture_ciclo() -> list[dict[str, Any]]:
    return [
        {"ano": 2026, "uf": "SP", "cod_municipio_tse": 71_001, "cod_zona": 1, "eleitores_aptos": 100_000},
        {"ano": 2026, "uf": "SP", "cod_municipio_tse": 71_002, "cod_zona": 2, "eleitores_aptos": 200_000},
        # Exterior carregado no banco: 2 localidades, ~918 mil no real.
        {"ano": 2026, "uf": "ZZ", "cod_municipio_tse": COD_LOCALIDADE_BASE, "cod_zona": 1, "eleitores_aptos": 5_000},
        {"ano": 2026, "uf": "ZZ", "cod_municipio_tse": COD_LOCALIDADE_BASE + 1, "cod_zona": 1, "eleitores_aptos": 7_000},
    ]


def _snapshots_sp(cargo: int) -> list[dict[str, Any]]:
    return [
        {
            "cargo": cargo, "turno": 1, "uf": "SP", "cod_municipio_tse": 71_001, "cod_zona": 1,
            "pct_apurado": 100.0, "payload": _synthetic_payload({100: 55.0, 200: 45.0}),
        },
        {
            "cargo": cargo, "turno": 1, "uf": "SP", "cod_municipio_tse": 71_002, "cod_zona": 2,
            "pct_apurado": 100.0, "payload": _synthetic_payload({100: 60.0, 200: 40.0}),
        },
    ]


@pytest.mark.parametrize("cargo", [3, 5])
def test_governador_e_senador_chegam_a_100pct_com_zz_no_eleitorado(
    fake_db: Any, monkeypatch: pytest.MonkeyPatch, cargo: int
) -> None:
    """SP 100% apurada é o país inteiro do cargo. Com o exterior (que nunca
    apura Governador/Senador) no denominador, sairia ~97,7% — aqui 5k+7k de
    312k. Tem de sair 100%."""
    payload = _rodar_ciclo(
        fake_db, monkeypatch, cargo=cargo,
        snapshots=_snapshots_sp(cargo), eleitorado=_eleitorado_fixture_ciclo(),
    )
    assert payload["pct_apurado_total"] == pytest.approx(100.0, abs=1e-9)
    assert all(u["sigla"] != "ZZ" for u in payload["por_uf"])


def test_presidente_conta_o_exterior_no_denominador_antes_do_primeiro_boletim(
    fake_db: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(f) Cargo 1, exterior com eleitorado e SEM nenhum snapshot ainda: o ciclo
    roda, `ZZ` não vira linha publicada (não houve boletim) e conta como 0%
    apurado com peso cheio — o `% apurado` NÃO fecha em 100%."""
    payload = _rodar_ciclo(
        fake_db, monkeypatch, cargo=1,
        snapshots=_snapshots_sp(1), eleitorado=_eleitorado_fixture_ciclo(),
    )
    esperado = 100.0 * 300_000 / 312_000
    assert payload["pct_apurado_total"] == pytest.approx(esperado, abs=1e-6)
    assert [u["sigla"] for u in payload["por_uf"]] == ["SP"]


# ---------------------------------------------------------------------------
# GROUP BY do eleitorado — SQL real, executado em sqlite
# ---------------------------------------------------------------------------


class _ConnSqlite:
    """Executa o SQL REAL de `fetch_eleitorado` (só troca `%s` por `?`).

    O dublê dos outros testes devolve o que a fixture manda; aqui o que se
    prova é a expressão `CASE ... GROUP BY uf, 2` de verdade.
    """

    def __init__(self, linhas: list[tuple[int, str, int, int, int]]) -> None:
        self._db = sqlite3.connect(":memory:")
        self._db.execute(
            "CREATE TABLE eleitorado (ano INT, uf TEXT, cod_municipio_tse INT, "
            "cod_zona INT, eleitores_aptos INT)"
        )
        self._db.executemany("INSERT INTO eleitorado VALUES (?,?,?,?,?)", linhas)

    def cursor(self) -> "_ConnSqlite":
        return self

    def __enter__(self) -> "_ConnSqlite":
        return self

    def __exit__(self, *a: Any) -> None:
        return None

    def execute(self, sql: str, params: tuple) -> None:
        self._cur = self._db.execute(sql.replace("%s", "?"), params)

    def fetchall(self) -> list[tuple]:
        return self._cur.fetchall()


def test_fetch_eleitorado_agrupa_o_exterior_por_localidade_e_as_ufs_por_zona() -> None:
    linhas: list[tuple[int, str, int, int, int]] = [
        # SP: dois municípios na MESMA zona 1 — somam (62,5% das zonas reais).
        (2026, "SP", 71_001, 1, 100),
        (2026, "SP", 71_002, 1, 50),
        (2026, "SP", 71_003, 2, 70),
        # Exterior: três localidades, todas na zona 1 — NÃO somam.
        (2026, "ZZ", 29_001, 1, 10),
        (2026, "ZZ", 29_002, 1, 20),
        (2026, "ZZ", 29_003, 1, 30),
        # Ano diferente nunca entra.
        (2024, "ZZ", 29_001, 1, 999),
    ]
    out = fetch_eleitorado(_ConnSqlite(linhas), ano=2026)
    assert out[("SP", 1)] == 150
    assert out[("SP", 2)] == 70
    assert out[("ZZ", 29_001)] == 10
    assert out[("ZZ", 29_002)] == 20
    assert out[("ZZ", 29_003)] == 30
    assert ("ZZ", 1) not in out
    assert len(out) == 5


# ---------------------------------------------------------------------------
# (b) + (c) Pseudo-zona no merge
# ---------------------------------------------------------------------------


def test_186_localidades_na_zona_1_viram_186_unidades_no_merge() -> None:
    linhas = [_linha_exterior(i) for i in range(N_LOCALIDADES)]
    merged = merge_pairs_into_zonas(linhas)

    assert len(merged) == N_LOCALIDADES
    codigos = [m["cod_zona"] for m in merged]
    assert codigos == [COD_LOCALIDADE_BASE + i for i in range(N_LOCALIDADES)]
    assert len(set(codigos)) == N_LOCALIDADES
    # A localidade mantém o município e o MESMO payload (nada reconstruído).
    for original, m in zip(linhas, merged, strict=True):
        assert m["cod_municipio_tse"] == original["cod_municipio_tse"]
        assert m["payload"] is original["payload"]
    # E o dict original da entrada não foi mutado.
    assert all(r["cod_zona"] == 1 for r in linhas)


def test_a_excecao_nao_vale_para_outra_uf() -> None:
    """Mesmo desenho — 186 municípios na zona 1 — numa UF comum continua
    colapsando em UMA zona (a regra geral do ADR-0021/0023 intacta)."""
    linhas = [_linha_sp(i) for i in range(N_LOCALIDADES)]
    merged = merge_pairs_into_zonas(linhas)

    assert len(merged) == 1
    assert merged[0]["uf"] == "SP" and merged[0]["cod_zona"] == 1
    # Soma real dos 186 pares (e.te = 186 × 1200).
    assert int(merged[0]["payload"]["e"]["te"]) == N_LOCALIDADES * 1200


def test_cod_zona_de_agrupamento_so_muda_para_zz_com_localidade_real() -> None:
    assert cod_zona_de_agrupamento("ZZ", 1, 29_254) == 29_254
    # Sentinela do exterior (município 0) não é localidade: não se reescreve.
    assert cod_zona_de_agrupamento("ZZ", 1, 0) == 1
    assert cod_zona_de_agrupamento("ZZ", 1, None) == 1
    # Qualquer outra UF devolve o `cod_zona` — inclusive com município real.
    for uf in ("SP", "AP", "DF", "BR", ""):
        assert cod_zona_de_agrupamento(uf, 7, 71_001) == 7
        assert cod_zona_de_agrupamento(uf, 0, 71_001) == 0


def test_merge_com_zz_e_sp_juntos_preserva_ordem_e_nao_vaza_a_excecao() -> None:
    linhas = [
        _linha_sp(0), _linha_exterior(0), _linha_sp(1), _linha_exterior(1),
    ]
    merged = merge_pairs_into_zonas(linhas)
    # SP: 2 pares na zona 1 → 1 unidade. ZZ: 2 localidades → 2 unidades.
    assert [(m["uf"], m["cod_zona"]) for m in merged] == [
        ("SP", 1),
        ("ZZ", COD_LOCALIDADE_BASE),
        ("ZZ", COD_LOCALIDADE_BASE + 1),
    ]


def test_sanidade_do_merge_nao_dispara_nem_quebra_com_zz() -> None:
    linhas = [_linha_exterior(i) for i in range(N_LOCALIDADES)]
    merged = merge_pairs_into_zonas(linhas)
    eleitorado = {("ZZ", COD_LOCALIDADE_BASE + i): 1200 for i in range(N_LOCALIDADES)}
    assert check_zona_merge_sanity(linhas, merged, eleitorado) == 0
    # Modo proporcional (sem linha mesclada) também: o grupo é a localidade.
    assert check_zona_merge_sanity(linhas, None, eleitorado) == 0
    # E sem eleitorado nenhum (ciclo antes da carga) não levanta.
    assert check_zona_merge_sanity(linhas, merged, {}) == 0


def test_27_ufs_seguem_byte_a_byte_o_merge_de_antes() -> None:
    """Zona de par único sai INALTERADA — o mesmo objeto, sem cópia."""
    linhas = [
        {**_linha_sp(0), "cod_zona": z, "cod_municipio_tse": 71_000 + z} for z in (1, 2, 3)
    ]
    merged = merge_pairs_into_zonas(linhas)
    assert all(m is o for m, o in zip(merged, linhas, strict=True))


# ---------------------------------------------------------------------------
# Bootstrap: intervalo de largura > 0, ponderado por localidade
# ---------------------------------------------------------------------------


def _projetar_exterior(n_localidades: int) -> tuple[list[dict[str, Any]], dict, dict]:
    linhas = [_linha_exterior(i) for i in range(n_localidades)]
    snapshots = merge_pairs_into_zonas(linhas)
    eleitorado = {("ZZ", COD_LOCALIDADE_BASE + i): 1200 for i in range(n_localidades)}
    rows, est, _estc, cand = compute_uf_projections(
        cargo=1, turno=1, seed_base=11, snapshots=snapshots, eleitorado=eleitorado
    )
    return rows, est, cand


def test_exterior_projeta_com_intervalo_de_largura_positiva() -> None:
    """A razão de ser da pseudo-zona (ADR-0045 item 5). Com 1 unidade o
    bootstrap devolveria `lower == upper` — afirmação de certeza."""
    rows, _est, _cand = _projetar_exterior(40)
    por_cand = {r["candidato_id"]: r for r in rows if r["uf"] == "ZZ"}
    assert set(por_cand) == {100, 200}
    for r in por_cand.values():
        assert r["pct_projetado_upper"] > r["pct_projetado_lower"]
        assert r["pct_apurado"] == pytest.approx(100.0, abs=1e-6)


def test_exterior_nao_e_estratificado_e_as_ufs_continuam_sendo() -> None:
    eleitorado = {("ZZ", COD_LOCALIDADE_BASE + i): 1000 + i for i in range(N_LOCALIDADES)}
    eleitorado.update({("SP", z): 1000 + z for z in range(1, 40)})
    # 186 pseudo-zonas passariam do mínimo de 12; ainda assim, ficam de fora.
    assert _compute_estratos_por_uf("ZZ", eleitorado) == (None, None)
    estratos, pesos = _compute_estratos_por_uf("SP", eleitorado)
    assert estratos is not None and pesos is not None and len(estratos) == 39


# ---------------------------------------------------------------------------
# (d) swing
# ---------------------------------------------------------------------------


def test_swing_do_exterior_e_none_mesmo_com_historico_de_2022() -> None:
    def _cod_2022(nr: int) -> int:
        # `cargo*1e6 + ano*1e3 + turno*100 + nr_partido` — historical-import.ts.
        return 1 * 1_000_000 + 2022 * 1000 + 1 * 100 + nr

    uf_rows = [
        {"uf": uf, "cargo": 1, "turno": 1, "candidato_id": cand, "pct_atual": pct}
        for uf in ("SP", "ZZ")
        for cand, pct in ((13, 60.0), (22, 40.0))
    ]
    historical = [
        {"uf": uf, "cod_zona": 1, "cod_candidato": _cod_2022(nr), "pct_validos": None,
         "partido": "X", "votos": votos}
        for uf in ("SP", "ZZ")
        for nr, votos in ((13, 500), (22, 500))
    ]
    swing = compute_swing_descritivo(uf_rows, historical)  # type: ignore[arg-type]
    assert swing["SP"] == pytest.approx(10.0)  # 60 − 50, controle: a conta funciona
    assert swing["ZZ"] is None  # há histórico de ZZ e ainda assim não calcula


# ---------------------------------------------------------------------------
# (e) nacional do cargo 1 inclui o exterior, ponderado
# ---------------------------------------------------------------------------


def _ciclo_cargo1_sp_e_zz() -> tuple[list[dict[str, Any]], dict, dict, dict, dict]:
    sp = [
        {**_linha_sp(i), "cod_zona": i + 1, "cod_municipio_tse": 71_000 + i,
         "payload": _payload({100: 400, 200: 600}, te=1200, esi=1200, c=1000, vvc=1000)}
        for i in range(30)
    ]
    zz = [
        {**_linha_exterior(i, share_a=0.80),
         "payload": _payload({100: 800 + (i % 5) * 10, 200: 200 - (i % 5) * 10},
                             te=1200, esi=1200, c=1000, vvc=1000)}
        for i in range(30)
    ]
    snapshots = merge_pairs_into_zonas([*sp, *zz])
    eleitorado: dict[tuple[str, int], int] = {("SP", i + 1): 3_000_000 // 30 for i in range(30)}
    eleitorado.update({("ZZ", COD_LOCALIDADE_BASE + i): 600_000 // 30 for i in range(30)})
    rows, est, est_c, cand = compute_uf_projections(
        cargo=1, turno=1, seed_base=5, snapshots=snapshots, eleitorado=eleitorado
    )
    return rows, est, est_c, cand, eleitorado


def test_nacional_do_cargo_1_inclui_o_exterior_ponderado_pelo_eleitorado() -> None:
    rows, est, _est_c, cand, eleitorado = _ciclo_cargo1_sp_e_zz()
    assert {"SP", "ZZ"} == set(est)
    total_by_uf = _eleitorado_total_by_uf(eleitorado)
    assert total_by_uf == {"SP": 3_000_000, "ZZ": 600_000}

    nacional = aggregate_national_estimates(est, total_by_uf)
    ponto_sp = float(np.mean(est["SP"][100]))
    ponto_zz = float(np.mean(est["ZZ"][100]))
    esperado = (ponto_sp * 3_000_000 + ponto_zz * 600_000) / 3_600_000
    assert float(np.mean(nacional[100])) == pytest.approx(esperado, rel=1e-9)
    # O exterior (~80% no candidato 100) puxa o nacional acima do de SP (~40%):
    # sem ele o número seria o de SP.
    assert float(np.mean(nacional[100])) > ponto_sp + 1.0 / 100

    # `compute_national` (a função que publica) usa a mesma base — o que sai é
    # percentual em 0–100 (fronteira de escala do módulo).
    national_rows, *_ = compute_national(
        cargo=1, turno=1, estimates_by_uf=est, eleitorado_total_by_uf=total_by_uf,
    )
    pct_100 = next(r for r in national_rows if r["candidato_id"] == 100)["pct_projetado"]
    assert pct_100 == pytest.approx(esperado * 100.0, rel=1e-6)

    # `pct_atual` nacional = razão de somas de votos, com o exterior dentro.
    pct, votos, total = pct_atual_nacional_por_candidato(rows)
    soma_zz = sum(int(r["votos_atuais"]) for r in rows if r["uf"] == "ZZ" and r["candidato_id"] == 100)
    assert soma_zz > 0
    assert votos[100] == sum(int(r["votos_atuais"]) for r in rows if r["candidato_id"] == 100)
    assert pct[100] == pytest.approx(100.0 * votos[100] / total)


def test_pct_apurado_total_do_cargo_1_pondera_o_exterior() -> None:
    """`build_edge_payload`: SP a 100% e o exterior a 0% (sem boletim) com
    pesos 3.000.000 e 600.000 ⇒ 83,33%, não 100%."""
    uf_rows = [
        {
            "uf": "SP", "candidato_id": 100, "pct_apurado": 100.0, "pct_projetado": 55.0,
            "pct_projetado_lower": 50.0, "pct_projetado_upper": 60.0, "p_vitoria": 0.9,
            "votos_atuais": 1000, "votos_projetados": 1000,
        },
    ]
    national_rows = [
        {
            "candidato_id": 100, "pct_projetado": 55.0, "pct_projetado_lower": 50.0,
            "pct_projetado_upper": 60.0, "p_vitoria": 0.9, "votos_projetados": 1000,
        },
    ]
    payload = build_edge_payload(
        cargo=1, turno=1, ts_iso="2026-10-04T18:00:00Z", uf_rows=uf_rows,
        national_rows=national_rows,
        eleitorado_total_by_uf={"SP": 3_000_000, "ZZ": 600_000}, cand_a_id=100,
    )
    assert payload["pct_apurado_total"] == pytest.approx(100.0 * 3_000_000 / 3_600_000, abs=1e-6)
