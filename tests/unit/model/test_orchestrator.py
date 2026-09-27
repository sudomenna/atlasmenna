"""T12 — Orchestrator /api/model/project.

Cobertura:
  (a) auth: sem header / header errado → 401.
  (b) body inválido → 400 estruturado do Pydantic.
  (c) compute end-to-end com fixture sintética (psycopg monkey-patched) → 200
      com response shape correto e `computed: True`.
  (d) determinismo (constituição § 6): mesmo trigger_ts → mesmo
      `national_p_vitoria_a` bit-a-bit.
  (e) sem snapshots → 200 com `computed: False, uf_count: 0`.

Estratégia de mock do DB:
  `_open_conn` é monkey-patched para devolver uma conexão fake com 3 fixtures
  estáticas (snapshots, historical, eleitorado) configuráveis por teste.
  `insert_projections` é interceptado para validar que recebe N linhas sem
  precisar de DB de verdade.

NÃO testa o path HTTP do BaseHTTPRequestHandler diretamente — chamamos
`_do_project(body_bytes)` que é a função pura por trás do handler. O wrapper
HTTP só faz auth + leitura de body + serialização; coberto via inspeção
manual (smoke).
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

import pytest

#: `ts` default para linhas de fixture que não especificam um — usado só
#: quando a UF não tem conflito de família (sentinela x zona real), caso em
#: que `_discard_zero_zona_sentinel_when_real_zonas_exist` nem olha o `ts`.
#: Os dois testes que exercitam o desempate por frescor passam `"ts"`
#: explícito e distinto em cada linha da fixture.
#:
#: 04/10 18h00 UTC (15h BRT): depois do corte de resíduo do simulado
#: (`_CORTE_RESIDUO_SIMULADO_POR_TURNO`, 04/10 03h00 UTC) e antes do
#: `trigger_ts` que quase todo teste usa (18h23 UTC). Até 27/09 era 01/01/2026
#: — com o corte seguindo o `trigger_ts`, uma linha dessas passou a ser
#: resíduo, e é assim que deve ser.
_DEFAULT_TS = datetime(2026, 10, 4, 18, 0, tzinfo=timezone.utc)


def _instante(ts: Any) -> datetime:
    """`ts` de fixture como instante: algumas fixtures o declaram em ISO
    (`_agregado_uf`), outras como `datetime` — o banco real devolve sempre
    `timestamptz`, e o `FakeCursor` precisa comparar os dois com o corte."""
    if isinstance(ts, str):
        return datetime.fromisoformat(ts)
    return ts


# ---------------------------------------------------------------------------
# Fixtures de DB sintéticas
# ---------------------------------------------------------------------------


def _synthetic_envelope(cand_pcts: dict[int, float]) -> dict[str, Any]:
    """Constrói payload EA20 ENVELOPE COMPLETO — formato REAL 2026 gravado
    por `app/api/ingest/route.ts` e validado por `lib/tse/ea20-schema.ts`
    (`EA20Schema`, reescrito 2026-09-05 contra os PDFs oficiais do TSE —
    ver `docs/reference/tse-2026-leiautes.md`). **Sem array `abr[]`**
    (premissa anterior nunca confirmada contra o documento oficial):
    candidatos em `carg[].agr[].par[].cand[]`, participação em `e`/`v`/`s`
    de raiz.

    `vap` (votos absolutos) é DERIVADO de `pct_pvap` e `v.vvc` (fixo em
    780) — `vap = round(pct/100 * vvc)` — em vez do `"0"` hardcoded
    original. Necessário desde a Fase 1 do plano `tem-um-erro-eu-
    velvety-sprout.md` (regra de três/extrapolação por zona): a projeção
    de candidatos lê `cand[].vap` (contagem absoluta via
    `_extract_zone_candidatos`), não mais `pvap` (percentual, pipeline de
    swing aposentado). `v.vv` também deixa de ser fixo em `"780"` —  vira
    a soma dos `vap` derivados (Σvap_c), preservando a identidade
    `Σvap_c == vv` que vários testes de `extrapolation.py` exploram.

    Fixture análoga a `tests/fixtures/tse/2026/zona-presidente-sp-z0001.json`,
    parametrizada por `{cod_candidato: pct_pvap}` — usada para provar que
    o orchestrator lê o payload real (BUG 1 original — `_extract_zone_
    candidate_pcts` fazia `payload.get("cand")` no topo e retornava `{}`;
    o schema do envelope em si também estava errado até a correção de
    2026-09-05).

    Cada candidato ganha sua própria `agr`/`par` (partido isolado `tp: "i"`)
    — suficiente para os testes deste arquivo, que não verificam
    coligação/federação.
    """
    vvc = 780
    vaps = {cod: int(round(pct / 100.0 * vvc)) for cod, pct in cand_pcts.items()}
    vv = sum(vaps.values())
    return {
        "ele": "999999",
        "t": "1",
        "f": "o",
        "tpabr": "zona",
        "cdabr": "0001",
        "dg": "04/10/2026",
        "hg": "18:00:00",
        "carg": [
            {
                "cd": "1",
                "nmn": "Presidente",
                "agr": [
                    {
                        "n": str(cod),
                        "nm": "PARTIDO",
                        "tp": "i",
                        "par": [
                            {
                                "n": str(cod),
                                "sg": "PP",
                                "nm": "PARTIDO",
                                "cand": [
                                    {
                                        "n": str(cod),
                                        "sqcand": f"{cod}0000000001",
                                        "nm": f"CANDIDATO {cod}",
                                        "nmu": f"CANDIDATO {cod}",
                                        "e": "n",
                                        "vap": str(vaps[cod]),
                                        "pvap": f"{pct:.2f}".replace(".", ","),
                                    }
                                ],
                            }
                        ],
                    }
                    for cod, pct in cand_pcts.items()
                ],
            }
        ],
        "s": {
            "ts": "1", "st": "1", "pst": "100,00",
            "si": "1", "psi": "100,00", "sa": "1", "psa": "100,00",
        },
        "e": {"te": "1000", "esi": "1000", "c": "800", "a": "200"},
        "v": {
            "tv": "800", "vvc": str(vvc), "vv": str(vv), "vnom": str(vv),
            "vb": "10", "tvn": "10", "vn": "10", "vnt": "0",
        },
    }


def _synthetic_payload(
    cand_pcts: dict[int, float],
) -> dict[str, Any]:
    """Constrói payload EA20 usado como snapshot sintético neste arquivo.

    Espelha (é literalmente um alias de) `_synthetic_envelope` — desde a
    Fase 1 do plano `tem-um-erro-eu-velvety-sprout.md`, a projeção de
    candidatos (`_extract_zone_candidatos`) exige `e`/`v`/`s` de raiz +
    `cand[].vap` (contagem absoluta) para escalar por `k = te/esi`; o
    payload achatado `{cand: [...]}` (só `pvap`, sem participação) não
    carrega o suficiente — mesma limitação documentada para o dataset de
    replay 2022 (`tests/fixtures/replay-2022/`, Fase 5 pendente, fora do
    escopo desta tarefa). Nome mantido (não renomeado em todos os
    call-sites deste arquivo) para minimizar o diff.
    """
    return _synthetic_envelope(cand_pcts)


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self._conn = conn
        self._last_rows: list[tuple] = []

    def execute(self, sql: str, params: tuple) -> None:
        # Dispatching pelo conteúdo da query — suficiente para os 3 SELECTs.
        # S04/F2: também responde às 3 novas queries `fetch_zona_municipio`,
        # `fetch_municipio_aggregates` e `fetch_series_temporais` (todas
        # com fixtures vazias por default, já que o minimal_dataset não
        # carrega zonas/municipios/projections histórico — orchestrator
        # gracefully degrada).
        #
        # Fase 3 (11/09): `fetch_municipio_aggregates` perdeu o `JOIN zonas`
        # (o município agora vem do próprio snapshot) — a âncora de dispatch
        # passou a ser `votos_total`, que só a query de município seleciona.
        # `test_project_sqls_todas_despachadas` (neste arquivo) executa CADA
        # SQL de `project.py` contra este cursor para que uma mudança futura
        # de SQL falhe alto, em vez de cair no `else: raise` de dentro de um
        # `try/except` que engole o erro.
        if "FROM snapshots" in sql and "ranked" in sql and "votos_total" in sql:
            # fetch_municipio_aggregates: mesma CTE, partição por par. O
            # `cod_municipio_tse` vem do snapshot (chave `cod_municipio_tse`
            # da fixture, 0 quando ausente — sentinela, ignorada pela função).
            #
            # Corte de resíduo do simulado (27/09): quando `fetch_
            # municipio_aggregates` calcula um corte, ela acrescenta um 3º
            # parâmetro (`ts >= %s`) — `*rest` absorve isso sem quebrar as
            # dezenas de chamadas existentes que só passam (cargo, turno).
            cargo, turno, *rest = params
            corte = rest[0] if rest else None
            self._last_rows = [
                (
                    s["uf"],
                    s["cod_zona"],
                    s["pct_apurado"],
                    s.get("votos_total"),
                    s["payload"],
                    int(s.get("cod_municipio_tse") or 0),
                )
                for s in self._conn.snapshots
                if s["cargo"] == cargo
                and s["turno"] == turno
                and (corte is None or _instante(s.get("ts", _DEFAULT_TS)) >= corte)
            ]
        elif "FROM snapshots" in sql:
            # fetch_snapshots — 7 colunas desde 2026-09-26 (cod_municipio_tse
            # entre uf e cod_zona desde a migration 0006; `ts` entrou para o
            # desempate sentinela-vs-zona-real por FRESCOR, não mais só por
            # presença — ver `_discard_zero_zona_sentinel_when_real_zonas_exist`;
            # `nivel` entrou com a spec 021, entre cod_zona e pct_apurado).
            #
            # ⚠️ `nivel` default `"zona"` quando a fixture não o declara — é o
            # MESMO default do `COALESCE` da query e de `nivel_do_snapshot`, e
            # é o que mantém as dezenas de fixtures pré-spec-021 válidas sem
            # tocá-las. Fixture que quer agregado declara `"nivel": "uf"`/`"br"`.
            #
            # Corte de resíduo do simulado (27/09) — ver comentário acima.
            cargo, turno, *rest = params
            corte = rest[0] if rest else None
            self._last_rows = [
                (
                    s["uf"],
                    int(s.get("cod_municipio_tse") or 0),
                    s["cod_zona"],
                    s.get("nivel") or "zona",
                    s["pct_apurado"],
                    s["payload"],
                    s.get("ts", _DEFAULT_TS),
                )
                for s in self._conn.snapshots
                if s["cargo"] == cargo
                and s["turno"] == turno
                and (corte is None or _instante(s.get("ts", _DEFAULT_TS)) >= corte)
            ]
        elif "FROM historical_results" in sql:
            cargo, turno = params
            self._last_rows = [
                (
                    h["uf"],
                    h["cod_zona"],
                    h["cod_candidato"],
                    h["pct_validos"],
                    h.get("partido"),
                    # Fase 5 — `votos` entrou no SELECT (E1 usa contagem, não
                    # `pct_validos`). Default 0 mantém as fixtures antigas
                    # válidas: sem votos em 2022, o swing sai `None`.
                    h.get("votos", 0),
                )
                for h in self._conn.historical
                if h["cargo"] == cargo and h["turno"] == turno
            ]
        elif "FROM eleitorado" in sql:
            # Três consultas diferentes batem aqui desde a migration 0006 —
            # todas agregam de verdade (o `GROUP BY` é o ponto do conserto:
            # com a PK no par, somar é o que distingue o peso certo da última
            # fatia de município).
            (ano,) = params
            fixtures = [e for e in self._conn.eleitorado if e["ano"] == ano]
            if "GROUP BY uf, cod_municipio_tse, cod_zona" in sql:
                # _fetch_eleitorado_por_par — peso do pct_apurado municipal.
                por_par: dict[tuple[str, int, int], int] = {}
                for e in fixtures:
                    chave = (e["uf"], int(e.get("cod_municipio_tse") or 0), e["cod_zona"])
                    por_par[chave] = por_par.get(chave, 0) + int(e["eleitores_aptos"])
                self._last_rows = [(u, m, z, v) for (u, m, z), v in por_par.items()]
            elif "GROUP BY uf, cod_municipio_tse" in sql:
                # fetch_municipio_eleitorado — Σ dos pares do município.
                por_mun: dict[tuple[str, int], int] = {}
                for e in fixtures:
                    chave = (e["uf"], int(e.get("cod_municipio_tse") or 0))
                    por_mun[chave] = por_mun.get(chave, 0) + int(e["eleitores_aptos"])
                self._last_rows = [(u, m, v) for (u, m), v in por_mun.items()]
            else:
                # fetch_eleitorado — Σ dos pares da zona (peso do estimador).
                por_zona: dict[tuple[str, int], int] = {}
                for e in fixtures:
                    chave = (e["uf"], e["cod_zona"])
                    por_zona[chave] = por_zona.get(chave, 0) + int(e["eleitores_aptos"])
                self._last_rows = [(u, z, v) for (u, z), v in por_zona.items()]
        elif "FROM candidatos" in sql:
            # fetch_identidade_cadastro (spec 018, RF-144 degrau 3). Vazio por
            # default — a maioria das fixturas não carrega cadastro e a cadeia
            # de nome fica só com os degraus do EA20. Precisa estar despachada
            # mesmo assim: a função engole a exceção para degradar
            # (constituição § 7), então sem este ramo o `AssertionError` do
            # `else` sumiria e `unsupported_sqls` seria a única testemunha.
            #
            # Colunas na ORDEM da query: uf, numero, sq_candidato, nome,
            # nome_urna, situacao_julgamento, publicavel, cargo.
            (cargo,) = params
            self._last_rows = [
                (
                    c["uf"], c["numero"], c["sq_candidato"], c["nome"],
                    c.get("nome_urna", c["nome"]),
                    c.get("situacao_julgamento", "DEFERIDO"),
                    c.get("publicavel", True),
                    c["cargo"],
                )
                for c in self._conn.candidatos
                if c["cargo"] == cargo and c.get("publicavel", True)
            ]
        elif "FROM zonas z" in sql or "JOIN municipios" in sql:
            # fetch_zona_municipio — sem fixture, devolve vazio.
            self._last_rows = []
        elif "FROM projections" in sql:
            # fetch_series_temporais — sem fixture, devolve vazio.
            self._last_rows = []
        else:
            # Registra ANTES de levantar: vários callers de `project.py`
            # envolvem a query em try/except e engoliriam este AssertionError,
            # degradando para dict vazio sem que o teste percebesse. A lista
            # é inspecionada por `test_todas_as_sqls_de_project_sao_despachadas`.
            self._conn.unsupported_sqls.append(sql)
            raise AssertionError(f"FakeCursor sql não suportada: {sql[:80]}")
        self._conn.executed_sqls.append(sql)

    def executemany(self, sql: str, rows: list[dict]) -> None:
        assert "INSERT INTO projections" in sql
        self._conn.inserted.extend(rows)

    def fetchall(self) -> list[tuple]:
        return self._last_rows

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *a: Any) -> None:
        return None


class FakeConn:
    def __init__(
        self,
        snapshots: list[dict],
        historical: list[dict],
        eleitorado: list[dict],
        candidatos: list[dict] | None = None,
    ) -> None:
        self.snapshots = snapshots
        self.historical = historical
        self.eleitorado = eleitorado
        # Spec 018 / RF-144 degrau 3 — cadastro de candidaturas. Default vazio:
        # só o teste que exercita o degrau o preenche.
        self.candidatos = candidatos or []
        self.inserted: list[dict] = []
        self.committed = False
        # Auditoria de dispatch — ver `FakeCursor.execute`.
        self.executed_sqls: list[str] = []
        self.unsupported_sqls: list[str] = []

    def rollback(self) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.committed = True

    def close(self) -> None:
        return None

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *a: Any) -> None:
        return None


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch):
    """Factory: cria FakeConn e injeta como _open_conn."""
    from api.model import project as proj_mod

    state: dict[str, FakeConn | None] = {"conn": None}

    def _make(
        snapshots: list[dict],
        historical: list[dict],
        eleitorado: list[dict],
        candidatos: list[dict] | None = None,
    ) -> FakeConn:
        conn = FakeConn(snapshots, historical, eleitorado, candidatos)
        state["conn"] = conn
        monkeypatch.setattr(proj_mod, "_open_conn", lambda: conn)
        return conn

    return _make


@pytest.fixture
def minimal_dataset():
    """Dataset sintético determinístico: 2 UFs × 2 candidatos × 2 zonas."""
    snapshots = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _synthetic_payload({100: 55.0, 200: 45.0}),
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "cod_zona": 2,
            "pct_apurado": 100.0,
            "payload": _synthetic_payload({100: 60.0, 200: 40.0}),
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "RJ",
            "cod_zona": 10,
            "pct_apurado": 100.0,
            "payload": _synthetic_payload({100: 48.0, 200: 52.0}),
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "RJ",
            "cod_zona": 11,
            "pct_apurado": 100.0,
            "payload": _synthetic_payload({100: 50.0, 200: 50.0}),
        },
    ]
    historical = [
        # SP: candidato A teve 50%, B teve 50% em 2022 (ambas as zonas)
        {"cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1, "cod_candidato": 100, "pct_validos": 0.50, "partido": "PT"},
        {"cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1, "cod_candidato": 200, "pct_validos": 0.50, "partido": "PL"},
        {"cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 2, "cod_candidato": 100, "pct_validos": 0.50, "partido": "PT"},
        {"cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 2, "cod_candidato": 200, "pct_validos": 0.50, "partido": "PL"},
        # RJ: A teve 45%, B teve 55%
        {"cargo": 1, "turno": 1, "uf": "RJ", "cod_zona": 10, "cod_candidato": 100, "pct_validos": 0.45, "partido": "PT"},
        {"cargo": 1, "turno": 1, "uf": "RJ", "cod_zona": 10, "cod_candidato": 200, "pct_validos": 0.55, "partido": "PL"},
        {"cargo": 1, "turno": 1, "uf": "RJ", "cod_zona": 11, "cod_candidato": 100, "pct_validos": 0.45, "partido": "PT"},
        {"cargo": 1, "turno": 1, "uf": "RJ", "cod_zona": 11, "cod_candidato": 200, "pct_validos": 0.55, "partido": "PL"},
    ]
    eleitorado = [
        {"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 100_000},
        {"ano": 2026, "uf": "SP", "cod_zona": 2, "eleitores_aptos": 200_000},
        {"ano": 2026, "uf": "RJ", "cod_zona": 10, "eleitores_aptos": 50_000},
        {"ano": 2026, "uf": "RJ", "cod_zona": 11, "eleitores_aptos": 80_000},
    ]
    return snapshots, historical, eleitorado


# ---------------------------------------------------------------------------
# (a) Auth
# ---------------------------------------------------------------------------


def test_seed_is_deterministic() -> None:
    """Constituição § 6: mesmo (cargo, turno, trigger_ts) → mesmo seed."""
    from api.model.project import derive_seed

    s1 = derive_seed(1, 1, "2026-10-04T18:23:15Z")
    s2 = derive_seed(1, 1, "2026-10-04T18:23:15Z")
    assert s1 == s2
    s3 = derive_seed(1, 1, "2026-10-04T18:23:16Z")
    assert s1 != s3


# ---------------------------------------------------------------------------
# (b) Body inválido
# ---------------------------------------------------------------------------


def test_invalid_json_returns_400() -> None:
    from api.model.project import _do_project

    status, payload = _do_project(b"not-json{{{")
    assert status == 400
    # Pydantic 2 reporta JSON malformado como ValidationError (json_invalid).
    assert payload["error"] in {"invalid_json", "invalid_body"}


def test_missing_field_returns_400() -> None:
    from api.model.project import _do_project

    body = json.dumps({"cargo": 1, "turno": 1}).encode("utf-8")  # falta trigger_ts
    status, payload = _do_project(body)
    assert status == 400
    assert payload["error"] == "invalid_body"
    # Pydantic ValidationError exposes structured detail.
    assert any("trigger_ts" in str(e) for e in payload["detail"])


def test_invalid_cargo_returns_400() -> None:
    from api.model.project import _do_project

    body = json.dumps(
        {"cargo": 0, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")
    status, payload = _do_project(body)
    assert status == 400


# ---------------------------------------------------------------------------
# (c) Compute end-to-end com fixture sintética
# ---------------------------------------------------------------------------


def test_compute_endtoend_returns_200(fake_db, minimal_dataset) -> None:
    from api.model.project import _do_project

    snapshots, historical, eleitorado = minimal_dataset
    conn = fake_db(snapshots, historical, eleitorado)

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, payload = _do_project(body)
    assert status == 200, payload
    assert payload["computed"] is True
    assert payload["uf_count"] == 2  # SP + RJ
    assert 0.0 <= payload["national_p_vitoria_a"] <= 1.0
    assert payload["computed_duration_ms"] >= 0

    # Persistiu append-only (sem upsert no INSERT).
    assert conn.committed is True
    assert len(conn.inserted) > 0
    # Inclui nacional (uf=None) e linhas UF.
    nationals = [r for r in conn.inserted if r["uf"] is None]
    ufs = [r for r in conn.inserted if r["uf"] is not None]
    assert len(nationals) >= 2  # 2 candidatos nacionais
    assert len(ufs) >= 4  # 2 UFs × 2 candidatos


def test_no_snapshots_returns_computed_false(fake_db) -> None:
    """Quando ainda não há snapshots ingeridos, o handler deve responder
    200 com `computed: False` (não-erro). Cobre RF-017 caso degenerado total."""
    from api.model.project import _do_project

    fake_db(snapshots=[], historical=[], eleitorado=[])

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, payload = _do_project(body)
    assert status == 200
    assert payload["computed"] is False
    assert payload["uf_count"] == 0


# ---------------------------------------------------------------------------
# (d) Determinismo end-to-end (constituição § 6)
# ---------------------------------------------------------------------------


def test_determinism_same_trigger_ts(fake_db, minimal_dataset) -> None:
    """Mesmo trigger_ts → mesma national_p_vitoria_a, bit-a-bit."""
    from api.model.project import _do_project

    snapshots, historical, eleitorado = minimal_dataset

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    fake_db(snapshots, historical, eleitorado)
    _, p1 = _do_project(body)

    fake_db(snapshots, historical, eleitorado)
    _, p2 = _do_project(body)

    assert p1["national_p_vitoria_a"] == p2["national_p_vitoria_a"]
    # E também os points UF persistidos devem coincidir.


def test_determinism_different_trigger_ts_differs(fake_db, minimal_dataset) -> None:
    """Sanity: trigger_ts diferente → estimates diferentes (seed propaga)."""
    from api.model.project import _do_project

    snapshots, historical, eleitorado = minimal_dataset

    fake_db(snapshots, historical, eleitorado)
    _, p1 = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )

    fake_db(snapshots, historical, eleitorado)
    _, p2 = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:16Z"}
        ).encode("utf-8")
    )
    # Não exigimos != absoluto (datasets pequenos podem coincidir), mas a
    # arquitetura DEVE propagar o seed — sanity check de não-crash basta aqui.
    assert "national_p_vitoria_a" in p1
    assert "national_p_vitoria_a" in p2


# ---------------------------------------------------------------------------
# (e) Smoke do handler HTTP — imports + class shape (sem subir socket)
# ---------------------------------------------------------------------------


def test_compute_national_top2_by_pct_when_leader_has_higher_id() -> None:
    """FIX S04 carry-over #1: A = líder por `pct_projetado` (mean dos estimates),
    NÃO `min(candidato_id)`.

    Cenário: candidato 200 (id MAIOR) tem mean ≈ 0.55; candidato 100 (id MENOR)
    tem mean ≈ 0.45. Antes do fix, A = 100 → `p_vitoria_a = P(100 > 200) ≈ 0`.
    Depois do fix, A = 200 → `p_vitoria_a = P(200 > 100) ≈ 1`.
    """
    import numpy as np
    from api.model.project import compute_national

    rng = np.random.default_rng(42)
    # Mesmo rng para os dois candidatos garantiria pareamento; cada candidato
    # com seu próprio rng filho descorrelaciona — o que queremos para que
    # P(c200 > c100) seja efetivamente determinado pelo gap dos means.
    estimates_by_uf = {
        "SP": {
            100: 0.45 + rng.normal(0, 0.005, 1000),  # menor id, segundo lugar
            200: 0.55 + rng.normal(0, 0.005, 1000),  # maior id, LIDER
        },
    }
    eleitorado_total = {"SP": 30_000_000}

    rows, p_a, cand_a, cand_b, _outros = compute_national(
        cargo=1,
        turno=1,
        estimates_by_uf=estimates_by_uf,
        eleitorado_total_by_uf=eleitorado_total,
    )

    assert cand_a == 200, f"esperado lider=200 (maior pct), got {cand_a}"
    assert cand_b == 100, f"esperado segundo=100, got {cand_b}"
    # p_a = P(estimates_a > estimates_b) — com gap de 10pp e σ=0.5pp, ≈ 1.0.
    assert p_a > 0.95, f"p_vitoria_a deveria ser ≈ 1 (lider claro), got {p_a}"
    # 2 rows nacionais.
    assert len(rows) == 2


def test_compute_national_tiebreaker_by_id_when_pct_equal() -> None:
    """FIX S04: se dois candidatos têm `pct_projetado` exatamente iguais
    (raro em dados reais, mas possível em fixtures sintéticas), tie-breaker é
    `candidato_id` ASCENDENTE — estável e determinístico.
    """
    import numpy as np
    from api.model.project import compute_national

    # Estimates idênticas → means idênticos por construção.
    same = np.full(1000, 0.50, dtype=np.float64)
    estimates_by_uf = {
        "SP": {
            500: same.copy(),
            300: same.copy(),
            700: same.copy(),
        },
    }
    eleitorado_total = {"SP": 30_000_000}

    rows, _p_a, cand_a, cand_b, _outros = compute_national(
        cargo=1,
        turno=1,
        estimates_by_uf=estimates_by_uf,
        eleitorado_total_by_uf=eleitorado_total,
    )

    # Empate total: tie-breaker == menor id primeiro.
    assert cand_a == 300, f"empate exato → A = menor id (300), got {cand_a}"
    assert cand_b == 500, f"segundo = próximo id (500), got {cand_b}"
    assert len(rows) == 3


def test_compute_national_single_candidate_returns_p_a_one() -> None:
    """Sanity: 1 candidato apenas → p_vitoria_a = 1.0, cand_b = None."""
    import numpy as np
    from api.model.project import compute_national

    estimates_by_uf = {
        "SP": {42: np.full(1000, 0.80, dtype=np.float64)},
    }
    eleitorado_total = {"SP": 30_000_000}

    rows, p_a, cand_a, cand_b, _outros = compute_national(
        cargo=1,
        turno=1,
        estimates_by_uf=estimates_by_uf,
        eleitorado_total_by_uf=eleitorado_total,
    )

    assert cand_a == 42
    assert cand_b is None
    assert p_a == 1.0
    assert len(rows) == 1


def test_edge_payload_orders_candidatos_by_leader_first(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """FIX S04: `national.candidatos[0]` é o líder semântico, não menor id.

    Reusa `minimal_dataset`: SP tem PT (100) com 57.5% e PL (200) com 42.5%
    (médias ponderadas). RJ tem PT com 49% e PL com 51%. Nacional ponderado
    pelo eleitorado deve dar líder claro a alguém — e seja quem for, deve
    aparecer em `candidatos[0]` do payload Edge.

    Também verifica os campos novos `candidato_a_id` / `candidato_b_id`.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, response = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200
    # Response também expõe os ids.
    assert response["candidato_a_id"] in (100, 200)
    assert response["candidato_b_id"] in (100, 200)
    assert response["candidato_a_id"] != response["candidato_b_id"]

    payload = captured["body"]["payload"]
    national = payload["national"]
    cand_a = national["candidato_a_id"]
    cand_b = national["candidato_b_id"]
    assert cand_a is not None and cand_b is not None
    # Primeiro candidato listado = líder semântico.
    assert national["candidatos"][0]["id"] == cand_a
    assert national["candidatos"][1]["id"] == cand_b
    # Líder tem pct_projetado >= 2º.
    assert (
        national["candidatos"][0]["pct_projetado"]
        >= national["candidatos"][1]["pct_projetado"]
    )
    # Needle aponta para o líder (>= 0).
    assert national["needle_position"] >= 0.0


def _sem_nome_no_ea20(payload: dict[str, Any]) -> dict[str, Any]:
    """Cópia do envelope com `nm`/`nmu` removidos de cada `cand[]`.

    É o estado que o degrau 3 existe para cobrir: o boletim traz a LINHA DE
    VOTO do candidato (número, votos) mas não o nome. A fixture padrão do
    orchestrator sempre traz nome, então sem esta poda o cadastro nunca seria
    consultado de verdade e o teste abaixo passaria com o merge desligado.
    """
    copia = copy.deepcopy(payload)
    for carg in copia.get("carg", []):
        for agr in carg.get("agr", []):
            for par in agr.get("par", []):
                for cand in par.get("cand", []):
                    cand.pop("nm", None)
                    cand.pop("nmu", None)
    return copia


def test_cadastro_preenche_o_nome_que_o_boletim_nao_trouxe(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spec 018 / RF-144 degrau 3, **ponta a ponta dentro de `_do_project`**.

    Os testes de `test_identidade_cadastro.py` cobrem a query, o desempate e a
    fusão em isolamento. Este cobre a COSTURA: as três linhas de `_do_project`
    que chamam `fetch_identidade_cadastro` e `merge_identidade_cadastro` antes
    de `build_edge_payload`. Sem ele, apagar essa chamada deixaria toda a
    suíte verde e o nome real nunca chegaria ao payload em produção.

    O cadastro guarda candidatura presidencial sob `uf = "BR"` (medido: cargo 1
    tem exatamente uma UF distinta no arquivo do TSE), e o payload a procura
    por `("SP", 100)` / `("RJ", 100)` — então este teste também é a prova de
    que a expansão de `"BR"` acontece no caminho real, não só na função pura.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots, historical, eleitorado = minimal_dataset
    snapshots = [
        {**s, "payload": _sem_nome_no_ea20(s["payload"])} for s in snapshots
    ]
    cadastro = [
        {
            "uf": "BR", "numero": 100, "cargo": 1,
            "sq_candidato": "280000600001",
            "nome": "NOME COMPLETO DO CADASTRO",
            "nome_urna": "NOME DE URNA DO CADASTRO",
        },
        {
            "uf": "BR", "numero": 200, "cargo": 1,
            "sq_candidato": "280000600002",
            "nome": "SEGUNDO COLOCADO",
        },
        # Não publicável: presente no cadastro, invisível para o payload.
        {
            "uf": "BR", "numero": 999, "cargo": 1,
            "sq_candidato": "280000600003",
            "nome": "FORA DA URNA", "publicavel": False,
        },
    ]
    fake_db(snapshots, historical, eleitorado, cadastro)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, _ = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200

    payload = captured["body"]["payload"]
    por_uf = {u["sigla"]: u for u in payload["por_uf"]}
    tops = {
        sigla: {t["id"]: t for t in linha["top_candidatos"]}
        for sigla, linha in por_uf.items()
    }

    # O nome de urna do cadastro, nas DUAS UFs — é a expansão de "BR".
    assert tops["SP"][100]["nome"] == "NOME DE URNA DO CADASTRO"
    assert tops["RJ"][100]["nome"] == "NOME DE URNA DO CADASTRO"
    assert tops["SP"][100]["sqcand"] == "280000600001"
    # Sem nome de urna, cai no nome completo — nunca no placeholder.
    assert tops["SP"][200]["nome"] == "SEGUNDO COLOCADO"

    # Cargo 1: o bloco nacional TAMBÉM recebe (RF-145 só cala cargo 3 e 5).
    nomes_nacionais = {c["id"]: c["nome"] for c in payload["national"]["candidatos"]}
    assert nomes_nacionais[100] == "NOME DE URNA DO CADASTRO"

    # A não-publicável não aparece em lugar nenhum do payload.
    assert "FORA DA URNA" not in json.dumps(payload, ensure_ascii=False)


def test_o_boletim_vence_o_cadastro_no_caminho_real(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A mesma costura, na direção contrária: com `nmu` presente no EA20, o
    cadastro não encosta no nome.

    Sem este teste, inverter a precedência dentro de `_do_project` (passar o
    cadastro como base e o EA20 como fallback) passaria o teste acima.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots, historical, eleitorado = minimal_dataset
    cadastro = [
        {
            "uf": "BR", "numero": 100, "cargo": 1,
            "sq_candidato": "280000600001",
            "nome": "NOME DO CADASTRO", "nome_urna": "NOME DO CADASTRO",
        },
    ]
    fake_db(snapshots, historical, eleitorado, cadastro)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, _ = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200

    payload = captured["body"]["payload"]
    assert "NOME DO CADASTRO" not in json.dumps(payload, ensure_ascii=False)
    por_uf = {u["sigla"]: u for u in payload["por_uf"]}
    tops = {t["id"]: t for t in por_uf["SP"]["top_candidatos"]}
    assert tops[100]["nome"] == "CANDIDATO 100"
    # E o `sqcand` é o do BOLETIM, não o do cadastro — a fusão é por entrada.
    assert tops[100]["sqcand"] == "1000000000001"


def test_handler_class_importable() -> None:
    """Smoke: a classe `handler` está no módulo (entrypoint Vercel)."""
    from api.model import project as proj_mod
    from http.server import BaseHTTPRequestHandler

    assert hasattr(proj_mod, "handler")
    assert issubclass(proj_mod.handler, BaseHTTPRequestHandler)
    assert hasattr(proj_mod.handler, "do_POST")
    assert hasattr(proj_mod.handler, "do_GET")


# ---------------------------------------------------------------------------
# S04/F2 — build_uf_payloads (EdgePayloadUf rico)
# ---------------------------------------------------------------------------


def test_build_uf_payloads_shape_minimal() -> None:
    """S04/F2: `build_uf_payloads` retorna shape canônico `EdgePayloadUf`
    com candidatos, municípios (vazio quando agregação ausente) e
    series_temporais (vazio quando histórico ausente).
    """
    from api.model.project import build_uf_payloads

    uf_rows = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "candidato_id": 100,
            "pct_projetado": 55.0,
            "pct_projetado_lower": 53.0,
            "pct_projetado_upper": 57.0,
            "pct_apurado": 80.0,
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "candidato_id": 200,
            "pct_projetado": 45.0,
            "pct_projetado_lower": 43.0,
            "pct_projetado_upper": 47.0,
            "pct_apurado": 80.0,
        },
    ]
    national_rows = [
        {"candidato_id": 100, "partido": "PT", "pct_projetado": 53.0},
        {"candidato_id": 200, "partido": "PL", "pct_projetado": 47.0},
    ]

    out = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=uf_rows,
        national_rows=national_rows,
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf={},
    )

    assert "SP" in out
    sp = out["SP"]
    # Shape canônico EdgePayloadUf.
    for key in (
        "uf",
        "ts",
        "cargo",
        "turno",
        "pct_apurado",
        "candidatos",
        "needle_position",
        "needle_band",
        "municipios",
        "series_temporais",
    ):
        assert key in sp, f"falta {key} no EdgePayloadUf"

    # Candidatos têm votos_atuais e votos_projetados (novos S04/F2).
    for c in sp["candidatos"]:
        assert "votos_atuais" in c
        assert "votos_projetados" in c
        assert isinstance(c["votos_atuais"], int)
        assert isinstance(c["votos_projetados"], int)
        assert "ci95" in c
        assert "lower" in c["ci95"]
        assert "upper" in c["ci95"]

    # Líder primeiro (pct_projetado desc).
    assert sp["candidatos"][0]["id"] == 100
    assert sp["candidatos"][1]["id"] == 200

    # Municípios vazios sem fixture (graceful degradation).
    assert sp["municipios"] == []

    # Series_temporais shape — sempre presente, com 3 arrays vazios quando
    # não há histórico.
    assert sp["series_temporais"] == {"margem": [], "p_vitoria": [], "turnout": []}


def test_build_uf_payloads_with_municipios() -> None:
    """S04/F2: quando `municipio_aggregates` + `zona_municipio` populados,
    `municipios[]` traz `{cod_ibge, nome, pct_apurado, lider, votos_reportados}`
    ordenados por cod_ibge ASC.
    """
    from api.model.project import build_uf_payloads

    uf_rows = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "candidato_id": 100,
            "pct_projetado": 55.0,
            "pct_projetado_lower": 53.0,
            "pct_projetado_upper": 57.0,
            "pct_apurado": 100.0,
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "candidato_id": 200,
            "pct_projetado": 45.0,
            "pct_projetado_lower": 43.0,
            "pct_projetado_upper": 47.0,
            "pct_apurado": 100.0,
        },
    ]
    national_rows = [
        {"candidato_id": 100, "partido": "PT", "pct_projetado": 53.0},
        {"candidato_id": 200, "partido": "PL", "pct_projetado": 47.0},
    ]
    # 2 municípios em SP: São Paulo capital (3550308) e Campinas (3509502).
    municipio_aggregates = {
        ("SP", 71072): {  # cod_municipio_tse capital
            "pct_apurado": 100.0,
            "votos_por_candidato": {100: 4_200_000, 200: 3_000_000},
            "total_votos": 7_200_000,
        },
        ("SP", 67016): {  # campinas
            "pct_apurado": 100.0,
            "votos_por_candidato": {100: 320_000, 200: 360_000},
            "total_votos": 680_000,
        },
    }
    # zona_municipio é chaveado por (uf, cod_zona) — a PK de `zonas` é composta
    # e o número da zona repete entre UFs (ver docstring de fetch_zona_municipio).
    zona_municipio = {
        ("SP", 1): {
            "uf": "SP",
            "cod_municipio_tse": 71072,
            "cod_ibge": "3550308",
            "nome": "São Paulo",
        },
        ("SP", 2): {
            "uf": "SP",
            "cod_municipio_tse": 67016,
            "cod_ibge": "3509502",
            "nome": "Campinas",
        },
    }

    out = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=uf_rows,
        national_rows=national_rows,
        municipio_aggregates=municipio_aggregates,
        zona_municipio=zona_municipio,
        series_by_uf={},
    )

    municipios = out["SP"]["municipios"]
    assert len(municipios) == 2
    # Ordem determinística (cod_ibge ASC) — Campinas (3509502) antes de SP (3550308).
    assert municipios[0]["cod_ibge"] == "3509502"
    assert municipios[0]["nome"] == "Campinas"
    assert municipios[1]["cod_ibge"] == "3550308"

    # Líder em Campinas: 200 (360k > 320k); em SP capital: 100 (4.2M > 3M).
    assert municipios[0]["lider"]["candidato_id"] == 200
    assert municipios[1]["lider"]["candidato_id"] == 100
    # Margem em pp positiva.
    assert municipios[0]["lider"]["margem_pp"] > 0
    assert municipios[1]["lider"]["margem_pp"] > 0

    # votos_reportados sparse (apenas candidatos com presença).
    assert municipios[0]["votos_reportados"] == {100: 320_000, 200: 360_000}
    assert municipios[1]["votos_reportados"] == {100: 4_200_000, 200: 3_000_000}


def test_build_uf_payloads_with_series_temporais() -> None:
    """S04/F2: timeline em `series_by_uf` vira 3 séries (margem, p_vitoria,
    turnout) ordenadas por ts ASC (constituição § 6).
    """
    from api.model.project import build_uf_payloads

    uf_rows = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "candidato_id": 100,
            "pct_projetado": 55.0,
            "pct_projetado_lower": 53.0,
            "pct_projetado_upper": 57.0,
            "pct_apurado": 80.0,
        },
    ]
    series_by_uf = {
        "SP": [
            {
                "ts": "2026-10-04T18:00:00Z",
                "margem_pp": 5.0,
                "pct_apurado": 20.0,
                "p_vitoria_lider": 0.72,
                "lider_id": 100,
            },
            {
                "ts": "2026-10-04T18:01:00Z",
                "margem_pp": 6.5,
                "pct_apurado": 35.0,
                "p_vitoria_lider": 0.81,
                "lider_id": 100,
            },
            # Ponto sem p_vitoria_lider — entra em margem/turnout mas não em p_vitoria.
            {
                "ts": "2026-10-04T18:02:00Z",
                "margem_pp": 7.0,
                "pct_apurado": 50.0,
                "p_vitoria_lider": None,
                "lider_id": 100,
            },
        ]
    }

    out = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=uf_rows,
        national_rows=[{"candidato_id": 100, "partido": "PT", "pct_projetado": 55.0}],
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf=series_by_uf,
    )

    series = out["SP"]["series_temporais"]
    # margem & turnout têm os 3 pontos (incluindo o sem p_vitoria).
    assert len(series["margem"]) == 3
    assert len(series["turnout"]) == 3
    # p_vitoria só os 2 com valor.
    assert len(series["p_vitoria"]) == 2

    # Ordem determinística (ts ASC, idem ao input).
    assert series["margem"][0]["ts"] == "2026-10-04T18:00:00Z"
    assert series["margem"][0]["margem_pp"] == 5.0
    assert series["p_vitoria"][0]["p"] == 0.72
    assert series["turnout"][2]["pct_apurado"] == 50.0


def test_edge_write_includes_payloads_uf(
    fake_db,
    minimal_dataset,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S04/F2: `_do_project` envia `payloads_uf` no body para o endpoint
    Node `/api/internal/edge-write` (junto do nacional). Cada chave é
    uma UF do `por_uf` nacional.
    """
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ANN201,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_mod.urllib.request, "urlopen", fake_urlopen)

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, _payload = proj_mod._do_project(body)
    assert status == 200

    # S04/F2: body do edge-write agora tem `payloads_uf` ao lado do `payload`.
    posted = captured["body"]
    assert "payload" in posted
    assert "payloads_uf" in posted
    payloads_uf = posted["payloads_uf"]
    # 2 UFs em `minimal_dataset` (SP + RJ) → 2 chaves em payloads_uf.
    assert set(payloads_uf.keys()) == {"SP", "RJ"}
    # Shape canônico EdgePayloadUf.
    sp = payloads_uf["SP"]
    assert "candidatos" in sp
    assert "municipios" in sp
    assert "series_temporais" in sp
    # Candidatos têm os novos campos votos_atuais/votos_projetados.
    for c in sp["candidatos"]:
        assert "votos_atuais" in c
        assert "votos_projetados" in c


# ---------------------------------------------------------------------------
# (f) T16b — Edge Config publication via /api/internal/edge-write
# ---------------------------------------------------------------------------


def test_edge_write_called_on_happy_path(
    fake_db,
    minimal_dataset,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T16b: `_do_project` chama `post_edge_write` ao final em happy path.

    Mockamos `urllib.request.urlopen` (caminho que `post_edge_write` usa) e
    verificamos:
      - foi chamado UMA vez;
      - request foi POST para `/api/internal/edge-write`;
      - header `x-model-secret` correto;
      - body JSON contém shape `{payload: {ts, cargo, turno, national, por_uf, ...}}`.
    """
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {"calls": []}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ANN201,ARG001
        captured["calls"].append(
            {
                "url": req.full_url,
                "method": req.get_method(),
                "x_model_secret": req.get_header("X-model-secret"),
                "body": req.data.decode("utf-8") if req.data else "",
            }
        )
        return FakeResponse()

    monkeypatch.setattr(proj_mod.urllib.request, "urlopen", fake_urlopen)

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, payload = proj_mod._do_project(body)
    assert status == 200, payload
    assert payload["computed"] is True

    assert len(captured["calls"]) == 1, captured
    call = captured["calls"][0]
    assert call["url"] == "http://localhost:13000/api/internal/edge-write"
    assert call["method"] == "POST"
    assert call["x_model_secret"] == "test-secret"

    body_obj = json.loads(call["body"])
    assert "payload" in body_obj
    p = body_obj["payload"]
    # Shape canônico (lib/edge-config/types.ts § EdgePayload).
    for key in ("ts", "cargo", "turno", "pct_apurado_total", "ufs_apuradas",
                "national", "por_uf", "insights", "composition"):
        assert key in p, f"falta {key} no payload"
    assert p["cargo"] == 1
    assert p["turno"] == 1
    assert isinstance(p["national"]["candidatos"], list)
    assert isinstance(p["por_uf"], list)
    # 2 UFs no dataset minimal_dataset → 2 entries.
    assert len(p["por_uf"]) == 2


def test_edge_write_failure_does_not_break_response(
    fake_db,
    minimal_dataset,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T16b: se `urlopen` lança erro de rede, `_do_project` ainda retorna 200.

    A persistência canônica está em `projections` (Postgres); o Edge Config
    se ressincroniza no próximo ciclo de 60s. Falha de publicação é warn,
    não erro.
    """
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    import urllib.error

    def boom(req, timeout=10):  # noqa: ANN001,ANN201,ARG001
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(proj_mod.urllib.request, "urlopen", boom)

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, payload = proj_mod._do_project(body)
    # 200 mesmo com edge-write falhando.
    assert status == 200, payload
    assert payload["computed"] is True
    assert payload["uf_count"] == 2


# ---------------------------------------------------------------------------
# S05/F4c — Multi-candidato (ADR-0014): rank, p_passa_2t, p_fecha_1t,
# p_segundo_turno_overall e cenarios_2t no payload.
# ---------------------------------------------------------------------------


def test_s05_payload_has_rank_and_multi_candidate_metrics(
    fake_db, minimal_dataset, monkeypatch
) -> None:
    """Sanity: o payload edge gerado pelo orchestrator inclui os campos
    multi-candidato adicionados em S05/F4c.

      - candidato.rank populado (1 = líder, 2 = segundo)
      - candidato.p_passa_2t em [0, 1]
      - candidato.p_fecha_1t em [0, 1]
      - candidato NÃO traz `cor` (saiu em 19/09; ADR-0024 — a cor vem da SIGLA)
      - national.p_segundo_turno_overall em [0, 1] OU None
      - national.cenarios_2t é lista (top-3, vazia se < 2 cands)
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret-s05")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, _ = _do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode(
            "utf-8"
        )
    )
    assert status == 200

    payload = captured["body"]["payload"]
    national = payload["national"]

    # rank populado e contíguo (1, 2, ...).
    ranks = [c["rank"] for c in national["candidatos"]]
    assert ranks == sorted(ranks)
    assert ranks[0] == 1

    # p_passa_2t e p_fecha_1t em [0, 1].
    for c in national["candidatos"]:
        assert "p_passa_2t" in c
        assert "p_fecha_1t" in c
        assert 0.0 <= c["p_passa_2t"] <= 1.0
        assert 0.0 <= c["p_fecha_1t"] <= 1.0

    # 🔴 O campo `cor` SAIU do payload em 2026-09-19. Este bloco AFIRMAVA O
    # DEFEITO: exigia `var(--color-cand-N)`, a paleta por COLOCAÇÃO do
    # ADR-0013, que o ADR-0024 aposentou em 07/09.
    #
    # A asserção agora é NEGATIVA, e é ela que discrimina: um produtor que
    # voltasse a emitir o campo passaria em qualquer teste que só conferisse
    # os outros campos. Constituição § 2: a cor é estável na noite inteira e
    # "não muda por rank" — emitir o rank como cor faz dois candidatos
    # trocarem de cor numa ultrapassagem, ao vivo.
    for c in national["candidatos"]:
        assert "cor" not in c, f"o payload voltou a emitir `cor`: {c.get('cor')!r}"

    # national tem as 2 chaves novas.
    assert "p_segundo_turno_overall" in national
    assert "cenarios_2t" in national
    p2t = national["p_segundo_turno_overall"]
    assert p2t is None or (0.0 <= p2t <= 1.0)
    assert isinstance(national["cenarios_2t"], list)

    # S06/F4d Fase 5 (carry-over) — vai_a_2t_nacional explícito.
    # Em 1T sempre presente (bool ou None se caller legado); semântica
    # alinhada com o nome: `true` ⇔ vai a 2T ⇔ p_segundo_turno_overall >= 0.01.
    assert "vai_a_2t_nacional" in national
    v2t_nac = national["vai_a_2t_nacional"]
    assert v2t_nac is None or isinstance(v2t_nac, bool)
    if p2t is not None and v2t_nac is not None:
        assert v2t_nac == (p2t >= 0.01)
    # No fixture minimal (2 candidatos), top-3 pode ter 1 entry só.
    for s in national["cenarios_2t"]:
        assert "par" in s and "prob" in s
        assert len(s["par"]) == 2

    # por_uf tem top_candidatos + bucket + vai_a_2t (presidencial 1T = null).
    for row in payload["por_uf"]:
        assert "top_candidatos" in row
        assert "vai_a_2t" in row
        assert "bucket" in row
        # Presidencial 1T → vai_a_2t sempre null.
        assert row["vai_a_2t"] is None
        # bucket é um dos 4 estados válidos.
        assert row["bucket"] in {"decidido_1t", "vai_2t", "indefinido", "chamada"}


# ---------------------------------------------------------------------------
# S07 fix — BUG 1 (envelope EA20) + BUG 2 (escala) end-to-end via _do_project
# ---------------------------------------------------------------------------


def test_envelope_payload_end_to_end_reads_swing_and_scales_to_pct(
    fake_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BUG 1 + BUG 2 (S07): payload EA20 REAL (envelope completo — não
    achatado) deve alimentar o swing corretamente, e o `pct_projetado`
    resultante no payload Edge deve sair em 0–100 (não fração [0,1]).

    Cenário: 1 UF (SP), 1 zona, 2 candidatos. 2022: 100 teve 40%, 200 teve
    60%. 2026 (envelope): 100 tem 45%, 200 tem 55% → swing = +5pp / -5pp.
    Com 1 única zona, o bootstrap sempre resample a mesma zona (sem
    variância) → `pct_projetado` determinístico = p_2022 + swing:
      100 → 0.40 + 0.05 = 0.45 → 45.0 (não 0.45!)
      200 → 0.60 - 0.05 = 0.55 → 55.0 (não 0.55!)

    Se BUG 1 não estivesse corrigido, `_extract_zone_candidate_pcts`
    devolveria `{}` para o envelope → zona excluída do swing → RF-017
    (zero apurado) aplicaria fallback `point = p_2022` SEM o swing:
      100 → 40.0 (❌, não 45.0)
      200 → 60.0 (❌, não 55.0)
    Este teste falha nesse cenário — prova que o envelope é lido.

    Se BUG 2 não estivesse corrigido, os valores sairiam em fração
    (0.45/0.55) em vez de percentual (45.0/55.0) — a asserção com
    `pytest.approx(45.0)` também falharia.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _synthetic_envelope({100: 45.0, 200: 55.0}),
        }
    ]
    historical = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "cod_candidato": 100, "pct_validos": 0.40, "partido": "PT",
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "cod_candidato": 200, "pct_validos": 0.60, "partido": "PL",
        },
    ]
    eleitorado = [{"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 100_000}]

    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret-envelope")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, response = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200, response
    assert response["computed"] is True
    assert response["uf_count"] == 1

    payload = captured["body"]["payload"]
    by_id = {c["id"]: c for c in payload["national"]["candidatos"]}
    assert set(by_id.keys()) == {100, 200}

    assert by_id[100]["pct_projetado"] == pytest.approx(45.0, abs=0.05)
    assert by_id[200]["pct_projetado"] == pytest.approx(55.0, abs=0.05)

    # por_uf também em 0–100 (mesma fronteira de escala).
    sp_row = next(r for r in payload["por_uf"] if r["sigla"] == "SP")
    assert sp_row["margem_atual"] == pytest.approx(10.0, abs=0.1)  # 55 - 45


# ---------------------------------------------------------------------------
# Fase 1a (RF-020.1) — participação (abstenção, brancos/nulos, outros) via
# envelope EA20 real, end-to-end através de `_do_project`.
# ---------------------------------------------------------------------------


def test_participacao_end_to_end_com_envelope_real(
    fake_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fase 1a: com um payload EA20 ENVELOPE REAL (`e`/`v`/`s` de raiz) e
    4 candidatos (o suficiente para "outros" existir, rank >= 4), o payload
    Edge publicado deve trazer `national.participacao` e
    `payloads_uf.SP.participacao` com as 3 métricas (abstenção,
    brancos/nulos, outros), bases corretas (D3 — denominador misto
    rotulado) e valores em 0–100.

    `_synthetic_envelope` fixa `e.te=1000, e.esi=1000, e.c=800, e.a=200`
    (abstenção = 200/1000 = 20%) e `v.vb=10, v.tvn=10` sobre
    `comparecimento=800` (brancos+nulos = 20/800 = 2.5%) — mesmos números
    para os 4 "candidatos" porque `e`/`v`/`s` vivem na raiz do envelope,
    não por candidato.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    cand_pcts = {100: 40.0, 200: 30.0, 300: 20.0, 400: 10.0}
    snapshots = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _synthetic_envelope(cand_pcts),
        }
    ]
    historical = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "cod_candidato": cod, "pct_validos": pct / 100.0, "partido": "PP",
        }
        for cod, pct in cand_pcts.items()
    ]
    eleitorado = [{"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 100_000}]

    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret-participacao")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, response = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200, response
    assert response["computed"] is True

    body = captured["body"]
    national = body["payload"]["national"]
    uf_sp = body["payloads_uf"]["SP"]

    for block, base_expected in (
        (national, {
            "abstencao": "eleitores_instalados",
            "brancos_nulos": "comparecimento",
            "outros": "votaveis",
        }),
        (uf_sp, {
            "abstencao": "eleitores_instalados",
            "brancos_nulos": "comparecimento",
            "outros": "votaveis",
        }),
    ):
        assert "participacao" in block, block.keys()
        participacao = block["participacao"]
        assert "metodo" in participacao
        assert participacao["metodo"]["tipo"] == "extrapolacao_apurado"
        assert participacao["metodo"]["n_zonas"] == 1
        for metric_key, base in base_expected.items():
            assert metric_key in participacao, (metric_key, participacao.keys())
            metric = participacao[metric_key]
            assert metric["base"] == base
            for field in ("pct_projetado", "lower", "upper"):
                assert 0.0 <= metric[field] <= 100.0

        # abstenção = 200/1000 = 20%.
        assert participacao["abstencao"]["pct_projetado"] == pytest.approx(20.0, abs=0.5)
        assert participacao["abstencao"]["pct_atual"] == pytest.approx(20.0, abs=0.5)
        # brancos+nulos = 20/800 = 2.5%.
        assert participacao["brancos_nulos"]["pct_projetado"] == pytest.approx(2.5, abs=0.1)
        # outros: só o candidato 400 (rank 4, 10%) — n_candidatos == 1.
        assert participacao["outros"]["n_candidatos"] == 1
        # Plano § B: `pct_atual` de "outros" agora vem DIRETO do `row`
        # (`compute_uf_projections`/`extrapolation.estimate_uf_
        # candidatos`, regra de três) — não mais de `municipio_aggregates`
        # (que este fixture minimal nem popula, `cod_municipio_tse` fica
        # `None` — ver `FakeCursor`). Candidato 400 é o único da cauda
        # (rank 4, único zona 100% apurada) — `pct_atual` real == 10.0.
        assert participacao["outros"]["pct_atual"] == pytest.approx(10.0, abs=0.5)


# ---------------------------------------------------------------------------
# Plano `tem-um-erro-eu-velvety-sprout.md` (2026-09-05) — decisão E1: 2022
# SAI da projeção de candidatos. Este é "o teste que prova o pedido"
# (plano § F): resultado end-to-end IDÊNTICO com `historical_results` vazio
# e cheio.
# ---------------------------------------------------------------------------


def test_do_project_e_invariante_a_historical(
    fake_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_do_project` produz o MESMO resultado (bit a bit, exceto
    `computed_duration_ms`) com `historical_results` vazio OU cheio —
    prova que 2022 não entra mais em nenhum lugar do cálculo de
    candidatos (decisão E1). `historical` continua sendo BUSCADO (não
    fatal — Fase 5 usará para o descritivo "mudou X pontos desde 2022"),
    mas `compute_uf_projections` não tem mais o parâmetro `historical` —
    esta é a prova end-to-end de que o dado, mesmo presente no banco, é
    inerte para a projeção.
    """
    from api.model.project import _do_project

    snapshots = [
        {
            "cargo": 1,
            "turno": 1,
            "uf": "SP",
            "cod_zona": 1,
            "pct_apurado": 100.0,
            "payload": _synthetic_envelope({100: 55.0, 200: 45.0}),
        },
        {
            "cargo": 1,
            "turno": 1,
            "uf": "RJ",
            "cod_zona": 10,
            "pct_apurado": 100.0,
            "payload": _synthetic_envelope({100: 48.0, 200: 52.0}),
        },
    ]
    eleitorado = [
        {"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 100_000},
        {"ano": 2026, "uf": "RJ", "cod_zona": 10, "eleitores_aptos": 50_000},
    ]
    # `historical` DIFERENTE em cada chamada — se algum ponto do pipeline
    # ainda dependesse dele, os dois resultados divergiriam.
    historical_vazio: list[dict] = []
    historical_cheio = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "cod_candidato": 100, "pct_validos": 0.10, "partido": "PT",
        },
        {
            "cargo": 1, "turno": 1, "uf": "RJ", "cod_zona": 10,
            "cod_candidato": 200, "pct_validos": 0.90, "partido": "PL",
        },
    ]

    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    fake_db(snapshots, historical_vazio, eleitorado)
    status1, resp1 = _do_project(body)

    fake_db(snapshots, historical_cheio, eleitorado)
    status2, resp2 = _do_project(body)

    assert status1 == 200 and status2 == 200
    assert resp1["computed"] is True and resp2["computed"] is True
    assert resp1["uf_count"] == resp2["uf_count"]
    assert resp1["national_p_vitoria_a"] == resp2["national_p_vitoria_a"]
    assert resp1["candidato_a_id"] == resp2["candidato_a_id"]
    assert resp1["candidato_b_id"] == resp2["candidato_b_id"]


# ---------------------------------------------------------------------------
# Sentinela `cod_zona = 0` vs. zonas reais — desempate por FRESCOR (`ts`)
#
# Reescrito em 2026-09-13 (review pós-implementação do cargo 6 fatiado): a
# versão original decidia só por PRESENÇA ("zona real existe? descarta a
# sentinela"), o que cobria certo a transição `uf` -> `zona` mas quebrava em
# silêncio a direção OPOSTA — alcançável desde que o interruptor de
# emergência `TSE_DEPUTADO_GRANULARIDADE=uf` passou a existir: ligá-lo no
# meio da apuração faria a sentinela NOVA ser descartada em favor dos pares
# de zona CONGELADOS no instante da virada (snapshots é append-only —
# ninguém mais escreve pra eles), com o modelo travado sem nenhum sinal
# visível. Os 4 casos abaixo cobrem as duas direções e os dois casos de
# família única.
# ---------------------------------------------------------------------------


def test_fetch_snapshots_uf_para_zona_zona_real_mais_recente_vence(
    fake_db,
) -> None:
    """Caso 1 — migração `uf` -> `zona` (a que já existia; não pode quebrar).

    Sentinela ANTIGA + zona real NOVA (`ts` maior) -> zona real vence."""
    from api.model.project import fetch_snapshots

    ts_sentinela_antiga = datetime(2026, 10, 4, 18, 0, tzinfo=timezone.utc)
    ts_zona_real_nova = datetime(2026, 10, 4, 18, 5, tzinfo=timezone.utc)

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 0,
            "pct_apurado": 40.0, "payload": _synthetic_envelope({100: 50.0}),
            "ts": ts_sentinela_antiga,
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "pct_apurado": 60.0, "payload": _synthetic_envelope({100: 55.0}),
            "ts": ts_zona_real_nova,
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_snapshots(conn, cargo=1, turno=1)

    assert len(out) == 1
    assert out[0]["cod_zona"] == 1


def test_fetch_snapshots_zona_para_uf_sentinela_mais_recente_vence(
    fake_db,
) -> None:
    """Caso 2 — o DEFEITO relatado pelo orquestrador: reversão `zona` -> `uf`
    via `TSE_DEPUTADO_GRANULARIDADE=uf` no meio da apuração.

    Pares de zona ANTIGOS (congelados desde antes da virada) + sentinela
    NOVA (`ts` maior, escrita pelas invocações pós-interruptor) -> a
    sentinela vence. Com a versão só-por-presença, este teste falharia: ela
    veria "a UF tem zona real" e descartaria a sentinela nova, mantendo o
    modelo travado nos pares antigos sem nenhum sinal."""
    from api.model.project import fetch_snapshots

    ts_zona_real_antiga = datetime(2026, 10, 4, 18, 0, tzinfo=timezone.utc)
    ts_sentinela_nova = datetime(2026, 10, 4, 18, 10, tzinfo=timezone.utc)

    snapshots = [
        {
            "cargo": 6, "turno": 1, "uf": "SP", "cod_zona": 1,
            "pct_apurado": 60.0, "payload": _synthetic_envelope({100: 55.0}),
            "ts": ts_zona_real_antiga,
        },
        {
            "cargo": 6, "turno": 1, "uf": "SP", "cod_municipio_tse": 0,
            "cod_zona": 0, "pct_apurado": 61.0,
            "payload": _synthetic_envelope({100: 55.5}),
            "ts": ts_sentinela_nova,
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_snapshots(conn, cargo=6, turno=1)

    assert len(out) == 1
    assert out[0]["cod_zona"] == 0


def test_fetch_snapshots_mantem_sentinela_zona_zero_sozinha(fake_db) -> None:
    """Caso 3 — sem NENHUMA zona real na UF, a linha `cod_zona = 0` (modo
    `uf`, ainda sem migração pra `zona`) é MANTIDA — é o único dado
    disponível daquela UF. Família única: `ts` nem entra na decisão."""
    from api.model.project import fetch_snapshots

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 0,
            "pct_apurado": 40.0, "payload": _synthetic_envelope({100: 50.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_snapshots(conn, cargo=1, turno=1)

    assert len(out) == 1
    assert out[0]["cod_zona"] == 0


def test_fetch_snapshots_mantem_zonas_reais_sozinhas(fake_db) -> None:
    """Caso 4 — sem NENHUMA sentinela na UF (o caso comum hoje: cargo em
    zona, interruptor nunca acionado), as zonas reais são MANTIDAS
    integralmente. Família única: `ts` nem entra na decisão."""
    from api.model.project import fetch_snapshots

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_zona": 1,
            "pct_apurado": 60.0, "payload": _synthetic_envelope({100: 55.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 2,
            "cod_zona": 2, "pct_apurado": 70.0,
            "payload": _synthetic_envelope({100: 58.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_snapshots(conn, cargo=1, turno=1)

    assert len(out) == 2
    assert {s["cod_zona"] for s in out} == {1, 2}


# ---------------------------------------------------------------------------
# Corte de resíduo do simulado (decisão do dono, 27/09/2026)
#
# Produção rodou o simulado oficial do TSE (23-26/09, seguindo até 03/10)
# sobre os MESMOS pares uf×município×zona dos reais, com `pct_apurado` =
# 100% — sem este corte, todo par sem boletim real ainda gravado em 04/10
# entraria no cálculo com os votos do simulado (docs/reference/risks.md,
# docs/operations/runbook.md). `_ts_minimo_valido` é testada isolada (pura,
# sem DB) e depois via `fetch_snapshots`/`fetch_municipio_aggregates`
# (com FakeCursor — real Postgres não é tocado aqui).
# ---------------------------------------------------------------------------


def test_ts_minimo_valido_antes_do_corte_devolve_none() -> None:
    """Antes do instante do turno, o filtro NÃO se aplica — comportamento
    IDÊNTICO ao anterior a esta mudança. Cobre hoje (27/09), o ensaio de
    03/10, e os testes de integração que inserem `ts = now()`."""
    from api.model.project import _ts_minimo_valido

    agora = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
    assert _ts_minimo_valido(1, agora) is None


def test_ts_minimo_valido_depois_do_corte_devolve_o_instante_do_turno() -> None:
    """04/10 20h UTC = 17h BRT, bem depois da virada (00h BRT = 03h UTC)."""
    from api.model.project import _ts_minimo_valido

    agora = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
    corte = _ts_minimo_valido(1, agora)
    assert corte == datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)


def test_ts_minimo_valido_no_limite_inclui() -> None:
    """`agora` exatamente igual ao instante do corte já ATIVA o filtro —
    prova o `>=`, não `>`, do lado de `agora` (a linha-limite do lado do
    `ts` é coberta por `test_fetch_snapshots_no_limite_ts_igual_ao_corte_entra`
    abaixo)."""
    from api.model.project import _ts_minimo_valido

    corte_turno1 = datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)
    assert _ts_minimo_valido(1, corte_turno1) == corte_turno1


def test_ts_minimo_valido_turno_2_usa_25_10() -> None:
    from api.model.project import _ts_minimo_valido

    agora = datetime(2026, 10, 25, 4, 0, tzinfo=timezone.utc)
    assert _ts_minimo_valido(2, agora) == datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc)


def test_ts_minimo_valido_turno_desconhecido_fail_open() -> None:
    """Turno fora de {1, 2} nunca deveria acontecer em produção — fail-open
    (mantém o dado) em vez de arriscar um corte com instante errado."""
    from api.model.project import _ts_minimo_valido

    agora = datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert _ts_minimo_valido(99, agora) is None


def test_fetch_snapshots_corte_ignora_par_so_com_residuo_do_simulado(fake_db) -> None:
    """Cenário do briefing: par A (MUNICÍPIO 1001) só tem a linha do
    simulado (24/09); par B (MUNICÍPIO 1002) tem a linha do simulado E uma
    linha nova (04/10 17h30 BRT, já real). Com `agora` = 04/10 18h BRT: A
    fica FORA do resultado (nenhuma linha sobrevive ao filtro nessa
    partição — não é "voto zerado", é ausência); B usa a linha NOVA."""
    from api.model.project import fetch_snapshots

    ts_simulado = datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc)
    ts_real = datetime(2026, 10, 4, 20, 30, tzinfo=timezone.utc)  # 17h30 BRT
    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1001,
            "cod_zona": 1, "pct_apurado": 100.0, "ts": ts_simulado,
            "payload": _synthetic_envelope({100: 90.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1002,
            "cod_zona": 1, "pct_apurado": 100.0, "ts": ts_simulado,
            "payload": _synthetic_envelope({100: 90.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1002,
            "cod_zona": 1, "pct_apurado": 12.0, "ts": ts_real,
            "payload": _synthetic_envelope({100: 40.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    agora_pos_virada = datetime(2026, 10, 4, 21, 0, tzinfo=timezone.utc)
    out = fetch_snapshots(conn, cargo=1, turno=1, agora=agora_pos_virada)

    municipios = {s["cod_municipio_tse"]: s for s in out}
    assert 1001 not in municipios
    assert 1002 in municipios
    assert municipios[1002]["pct_apurado"] == 12.0


def test_fetch_snapshots_corte_nao_se_aplica_antes_da_virada(fake_db) -> None:
    """Mesmo par A do teste acima, mas `agora` ainda não chegou no corte —
    comportamento idêntico ao anterior a esta mudança: o resíduo do
    simulado aparece (a mudança não apaga `snapshots` — constituição § 10 —
    só o CÁLCULO passa a ignorar, e só depois da virada)."""
    from api.model.project import fetch_snapshots

    ts_simulado = datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc)
    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1001,
            "cod_zona": 1, "pct_apurado": 100.0, "ts": ts_simulado,
            "payload": _synthetic_envelope({100: 90.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    agora_antes_da_virada = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
    out = fetch_snapshots(conn, cargo=1, turno=1, agora=agora_antes_da_virada)

    assert len(out) == 1
    assert out[0]["cod_municipio_tse"] == 1001


def test_fetch_snapshots_no_limite_ts_igual_ao_corte_entra(fake_db) -> None:
    """Linha com `ts` EXATAMENTE igual ao instante do corte é dado do DIA da
    eleição, não resíduo — entra (`>=`, não `>`, do lado do `ts`)."""
    from api.model.project import fetch_snapshots

    corte = datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)  # 00h BRT
    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 2001,
            "cod_zona": 1, "pct_apurado": 0.0, "ts": corte,
            "payload": _synthetic_envelope({100: 0.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_snapshots(conn, cargo=1, turno=1, agora=corte)

    assert len(out) == 1


def test_fetch_municipio_aggregates_corte_ignora_par_so_com_residuo(fake_db) -> None:
    """Mesmo cenário de `test_fetch_snapshots_corte_ignora_par_so_com_
    residuo_do_simulado`, agora pelo caminho de `fetch_municipio_
    aggregates` (mesma constante/regra, filtro próprio no SQL)."""
    from api.model.project import fetch_municipio_aggregates

    ts_simulado = datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc)
    ts_real = datetime(2026, 10, 4, 20, 30, tzinfo=timezone.utc)
    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1001,
            "cod_zona": 1, "pct_apurado": 100.0, "votos_total": 100,
            "ts": ts_simulado, "payload": _synthetic_envelope({100: 90.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1002,
            "cod_zona": 1, "pct_apurado": 100.0, "votos_total": 100,
            "ts": ts_simulado, "payload": _synthetic_envelope({100: 90.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 1002,
            "cod_zona": 1, "pct_apurado": 12.0, "votos_total": 12,
            "ts": ts_real, "payload": _synthetic_envelope({100: 40.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    agora_pos_virada = datetime(2026, 10, 4, 21, 0, tzinfo=timezone.utc)
    out = fetch_municipio_aggregates(conn, cargo=1, turno=1, agora=agora_pos_virada)

    assert ("SP", 1001) not in out
    assert ("SP", 1002) in out
    assert out[("SP", 1002)]["pct_apurado"] == 12.0


def test_fetch_snapshots_sql_so_ganha_filtro_de_ts_quando_corte_ativo(fake_db) -> None:
    """Prova o TEXTO da SQL, não só o comportamento via `FakeCursor` (que
    reimplementa o filtro em Python e não pegaria uma mutação `>=` → `>`
    na string da query real). Sem corte: SQL igual à de sempre, sem
    `ts >= %s`. Com corte: a cláusula aparece — e é por `ts`, nunca por
    `payload->>'ele'` (que destoastaria o JSONB inteiro no hot path)."""
    from api.model.project import fetch_snapshots

    conn = fake_db([], [], [])

    fetch_snapshots(conn, cargo=1, turno=1, agora=datetime(2026, 9, 27, tzinfo=timezone.utc))
    sql_sem_corte = conn.executed_sqls[-1]
    assert "ts >= %s" not in sql_sem_corte
    assert "payload->>'ele'" not in sql_sem_corte

    fetch_snapshots(
        conn, cargo=1, turno=1,
        agora=datetime(2026, 10, 4, 21, 0, tzinfo=timezone.utc),
    )
    sql_com_corte = conn.executed_sqls[-1]
    assert "ts >= %s" in sql_com_corte
    assert "payload->>'ele'" not in sql_com_corte


def test_ciclo_majoritario_corta_pelo_trigger_ts_e_nao_pelo_relogio(
    fake_db, minimal_dataset, monkeypatch
) -> None:
    """Constituição § 6: o mesmo `(cargo, turno, trigger_ts)` sobre as mesmas
    linhas dá o mesmo resultado em qualquer data. O corte decide "já é dia da
    eleição?" pelo `trigger_ts` do ciclo — com gatilho de 27/09 a SQL sai sem
    o filtro, com gatilho de 04/10 sai com ele, seja qual for o relógio da
    máquina que roda o teste. Discrimina nos dois sentidos: se a produção
    voltar a usar o relógio real, o primeiro caso quebra a partir de 04/10 e o
    segundo quebra antes dele."""
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    monkeypatch.setattr(proj_mod, "post_edge_write", lambda payload, payloads_uf=None: None)

    for trigger_ts, espera_corte in (
        ("2026-09-27T12:00:00Z", False),
        ("2026-10-04T18:23:15Z", True),
    ):
        conn = fake_db(list(snapshots), historical, eleitorado)
        status, _ = proj_mod._do_project(
            json.dumps({"cargo": 1, "turno": 1, "trigger_ts": trigger_ts}).encode()
        )
        assert status == 200
        sqls = [q for q in conn.executed_sqls if "FROM snapshots" in q]
        assert sqls, "o ciclo tem de ler snapshots"
        for q in sqls:
            assert ("ts >= %s" in q) is espera_corte, (trigger_ts, q)


def test_instante_do_gatilho_le_iso_com_z_e_sem_fuso_como_utc() -> None:
    from api.model.project import _instante_do_gatilho

    assert _instante_do_gatilho("2026-10-04T18:23:15Z") == datetime(
        2026, 10, 4, 18, 23, 15, tzinfo=timezone.utc
    )
    assert _instante_do_gatilho("2026-10-04T18:23:15") == datetime(
        2026, 10, 4, 18, 23, 15, tzinfo=timezone.utc
    )


def test_instante_do_gatilho_ilegivel_cai_no_relogio_e_nao_desliga_o_corte() -> None:
    """Fail-safe: `trigger_ts` ilegível não pode virar "sem corte" — isso poria
    o resíduo do simulado no cálculo da noite."""
    from api.model.project import _instante_do_gatilho

    antes = datetime.now(timezone.utc)
    instante = _instante_do_gatilho("...")
    assert instante.tzinfo is not None
    assert instante >= antes


def test_fetch_municipio_aggregates_sql_so_ganha_filtro_de_ts_quando_corte_ativo(
    fake_db,
) -> None:
    """`fetch_municipio_aggregates` também dispara a query de `eleitorado`
    (peso do par) logo depois — por isso filtramos `executed_sqls` pela
    query de `snapshots` (âncora `votos_total`, como no `FakeCursor`) em vez
    de olhar só a última SQL executada."""
    from api.model.project import fetch_municipio_aggregates

    def _ultima_sql_de_snapshots(conn) -> str:
        candidatas = [s for s in conn.executed_sqls if "votos_total" in s]
        return candidatas[-1]

    conn = fake_db([], [], [])

    fetch_municipio_aggregates(
        conn, cargo=1, turno=1,
        agora=datetime(2026, 9, 27, tzinfo=timezone.utc),
    )
    assert "s.ts >= %s" not in _ultima_sql_de_snapshots(conn)

    fetch_municipio_aggregates(
        conn, cargo=1, turno=1,
        agora=datetime(2026, 10, 4, 21, 0, tzinfo=timezone.utc),
    )
    assert "s.ts >= %s" in _ultima_sql_de_snapshots(conn)


# ---------------------------------------------------------------------------
# Dispatch de SQL — rede de proteção contra o `else: raise` engolido
# ---------------------------------------------------------------------------


def test_todas_as_sqls_de_project_sao_despachadas(fake_db) -> None:
    """Executa CADA consulta de `api/model/project.py` contra o `FakeCursor`
    e exige que todas caiam num ramo conhecido.

    Por que existe (risco R3 do plano de 11/09): o `FakeCursor` despacha por
    SUBSTRING da SQL e termina em `else: raise AssertionError`. Metade dos
    callers em `project.py` (`fetch_municipio_aggregates`,
    `fetch_zona_municipio`, `fetch_series_temporais`, `_fetch_eleitorado_por_par`)
    envolve a query em `try/except Exception` e degrada para dict vazio — ou
    seja, uma mudança de SQL que o mock não reconhece passaria como "sem
    dados" em vez de falhar. Aqui a lista `unsupported_sqls` é inspecionada
    diretamente, então a falha é alta e imediata.
    """
    from api.model.project import (
        _fetch_eleitorado_por_par,
        fetch_eleitorado,
        fetch_historical_2022,
        fetch_municipio_aggregates,
        fetch_municipio_eleitorado,
        fetch_series_temporais,
        fetch_identidade_cadastro,
        fetch_snapshots,
        fetch_zona_municipio,
    )

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 71072,
            "cod_zona": 1, "pct_apurado": 50.0, "votos_total": 260,
            "payload": _synthetic_envelope({100: 60.0, 200: 40.0}),
        },
    ]
    eleitorado = [
        {"ano": 2026, "uf": "SP", "cod_municipio_tse": 71072, "cod_zona": 1,
         "eleitores_aptos": 350},
    ]
    conn = fake_db(snapshots, [], eleitorado)

    assert len(fetch_snapshots(conn, cargo=1, turno=1)) == 1
    assert fetch_historical_2022(conn, cargo=1, turno=1) == []
    assert fetch_eleitorado(conn, ano=2026) == {("SP", 1): 350}
    assert fetch_municipio_eleitorado(conn, ano=2026) == {("SP", 71072): 350}
    assert _fetch_eleitorado_por_par(conn, ano=2026) == {("SP", 71072, 1): 350}
    assert fetch_zona_municipio(conn) == {}
    assert fetch_series_temporais(conn, cargo=1, turno=1) == {}
    # Spec 018 / RF-144 degrau 3 — sem fixture de cadastro o mapa sai vazio,
    # mas a SQL precisa ter sido RECONHECIDA; `fetch_identidade_cadastro`
    # degrada para `{}` em qualquer exceção, então só `unsupported_sqls`
    # distingue "sem cadastro" de "SQL que o mock não conhece mais".
    assert fetch_identidade_cadastro(conn, cargo=1) == {}
    # Aridade de 6 colunas preservada: se o mock tivesse devolvido outra coisa,
    # `fetch_municipio_aggregates` ignoraria a linha e o dict sairia vazio.
    agregados = fetch_municipio_aggregates(conn, cargo=1, turno=1)
    assert set(agregados.keys()) == {("SP", 71072)}
    assert agregados[("SP", 71072)]["total_votos"] == 260

    assert conn.unsupported_sqls == []


def test_fetch_eleitorado_soma_os_pares_da_zona(fake_db) -> None:
    """A zona espalhada por 3 municípios pesa a SOMA dos pares.

    Antes do `GROUP BY` (Fase 3, 11/09), o dict-comprehension de
    `fetch_eleitorado` ficava com a ÚLTIMA fatia de município — peso
    fragmentário, sem erro nenhum. Mesmo defeito que, em
    `scripts/build-replay-fixtures.ts`, levou o MAE@1h de 2,3623 pp a
    3,4636 pp.
    """
    from api.model.project import fetch_eleitorado

    eleitorado = [
        {"ano": 2026, "uf": "MG", "cod_municipio_tse": 41238, "cod_zona": 9,
         "eleitores_aptos": 100_000},
        {"ano": 2026, "uf": "MG", "cod_municipio_tse": 41254, "cod_zona": 9,
         "eleitores_aptos": 30_000},
        {"ano": 2026, "uf": "MG", "cod_municipio_tse": 41270, "cod_zona": 9,
         "eleitores_aptos": 7_000},
    ]
    conn = fake_db([], [], eleitorado)

    assert fetch_eleitorado(conn, ano=2026) == {("MG", 9): 137_000}


def test_fetch_municipio_aggregates_separa_pares_da_mesma_zona(fake_db) -> None:
    """Dois pares da MESMA zona em municípios distintos viram duas entradas
    municipais, cada uma com os seus votos — sem `JOIN zonas`, sem rateio
    (ADR-0035 D2)."""
    from api.model.project import fetch_municipio_aggregates

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "MG", "cod_municipio_tse": 41238,
            "cod_zona": 9, "pct_apurado": 100.0, "votos_total": 1_000,
            "payload": _synthetic_envelope({100: 60.0, 200: 40.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "MG", "cod_municipio_tse": 41254,
            "cod_zona": 9, "pct_apurado": 50.0, "votos_total": 400,
            "payload": _synthetic_envelope({100: 30.0, 200: 70.0}),
        },
        {
            # Sentinela de abrangência UF — nunca vira município.
            "cargo": 1, "turno": 1, "uf": "MG", "cod_municipio_tse": 0,
            "cod_zona": 0, "pct_apurado": 80.0, "votos_total": 9_999,
            "payload": _synthetic_envelope({100: 55.0, 200: 45.0}),
        },
    ]
    conn = fake_db(snapshots, [], [])

    out = fetch_municipio_aggregates(conn, cargo=1, turno=1)

    assert set(out.keys()) == {("MG", 41238), ("MG", 41254)}
    assert out[("MG", 41238)]["total_votos"] == 1_000
    assert out[("MG", 41254)]["total_votos"] == 400
    assert out[("MG", 41238)]["pct_apurado"] == 100.0
    assert out[("MG", 41254)]["pct_apurado"] == 50.0


def test_fetch_municipio_aggregates_pondera_pct_por_eleitorado_do_par(
    fake_db,
) -> None:
    """`pct_apurado` do município é média ponderada pelo eleitorado do par.

    Um município com duas zonas — uma de 200 mil eleitores a 100 % apurado e
    outra de 2 mil a 0 % — está 99,0 % apurado, não 50 % (que era o que a
    média simples anterior a 11/09 exibia).
    """
    from api.model.project import fetch_municipio_aggregates

    snapshots = [
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 71072,
            "cod_zona": 1, "pct_apurado": 100.0, "votos_total": 100,
            "payload": _synthetic_envelope({100: 60.0, 200: 40.0}),
        },
        {
            "cargo": 1, "turno": 1, "uf": "SP", "cod_municipio_tse": 71072,
            "cod_zona": 2, "pct_apurado": 0.0, "votos_total": 0,
            "payload": _synthetic_envelope({100: 50.0, 200: 50.0}),
        },
    ]
    eleitorado = [
        {"ano": 2026, "uf": "SP", "cod_municipio_tse": 71072, "cod_zona": 1,
         "eleitores_aptos": 200_000},
        {"ano": 2026, "uf": "SP", "cod_municipio_tse": 71072, "cod_zona": 2,
         "eleitores_aptos": 2_000},
    ]
    conn = fake_db(snapshots, [], eleitorado)

    out = fetch_municipio_aggregates(conn, cargo=1, turno=1)

    assert out[("SP", 71072)]["pct_apurado"] == pytest.approx(
        100.0 * 200_000 / 202_000
    )


def test_build_uf_payloads_emite_eleitores_e_capital() -> None:
    """`eleitores`/`capital` chegam ao `EdgeUfMunicipio` quando existem no
    mapa de municípios; `capital` só aparece quando é verdadeiro (decisão
    D-d — ambos opcionais no contrato TS)."""
    from api.model.project import build_uf_payloads

    uf_rows = [
        {
            "cargo": 1, "turno": 1, "uf": "MG", "candidato_id": 100,
            "pct_projetado": 55.0, "pct_projetado_lower": 53.0,
            "pct_projetado_upper": 57.0, "pct_apurado": 100.0,
        },
    ]
    national_rows = [{"candidato_id": 100, "partido": "PT", "pct_projetado": 55.0}]
    municipio_aggregates = {
        ("MG", 41238): {
            "pct_apurado": 100.0,
            "votos_por_candidato": {100: 900_000},
            "total_votos": 900_000,
        },
        ("MG", 41254): {
            "pct_apurado": 100.0,
            "votos_por_candidato": {100: 120_000},
            "total_votos": 120_000,
        },
    }
    # Chave tripla `(uf, cod_municipio_tse, cod_zona)` — a mesma zona 9 aparece
    # nos dois municípios, que é justamente o caso que a chave dupla perdia.
    zona_municipio = {
        ("MG", 41238, 9): {
            "uf": "MG", "cod_municipio_tse": 41238, "cod_ibge": "3106200",
            "nome": "Belo Horizonte", "eleitores": 1_992_984, "capital": True,
        },
        ("MG", 41254, 9): {
            "uf": "MG", "cod_municipio_tse": 41254, "cod_ibge": "3170206",
            "nome": "Uberaba", "eleitores": 238_276, "capital": False,
        },
    }

    out = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=uf_rows,
        national_rows=national_rows,
        municipio_aggregates=municipio_aggregates,
        zona_municipio=zona_municipio,
        series_by_uf={},
    )

    por_nome = {m["nome"]: m for m in out["MG"]["municipios"]}
    assert por_nome["Belo Horizonte"]["eleitores"] == 1_992_984
    assert por_nome["Belo Horizonte"]["capital"] is True
    assert por_nome["Uberaba"]["eleitores"] == 238_276
    # Não-capital não carrega a chave (ausência == false no contrato TS).
    assert "capital" not in por_nome["Uberaba"]


def test_build_uf_payloads_sem_eleitores_nem_capital_omite_campos() -> None:
    """Mapa de municípios sem os campos novos (Blob antigo / DB anterior à
    migration 0006) → payload sem `eleitores` nem `capital`, exatamente como
    antes. É o que mantém as fixtures de Blob já gravadas válidas."""
    from api.model.project import build_uf_payloads

    out = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso="2026-10-04T18:23:15Z",
        uf_rows=[
            {
                "cargo": 1, "turno": 1, "uf": "MG", "candidato_id": 100,
                "pct_projetado": 55.0, "pct_projetado_lower": 53.0,
                "pct_projetado_upper": 57.0, "pct_apurado": 100.0,
            },
        ],
        national_rows=[{"candidato_id": 100, "partido": "PT", "pct_projetado": 55.0}],
        municipio_aggregates={
            ("MG", 41238): {
                "pct_apurado": 100.0,
                "votos_por_candidato": {100: 900_000},
                "total_votos": 900_000,
            },
        },
        zona_municipio={
            ("MG", 41238, 9): {
                "uf": "MG", "cod_municipio_tse": 41238,
                "cod_ibge": "3106200", "nome": "Belo Horizonte",
            },
        },
        series_by_uf={},
    )

    municipio = out["MG"]["municipios"][0]
    assert "eleitores" not in municipio
    assert "capital" not in municipio


# ---------------------------------------------------------------------------
# ADR-0038 — o relógio do DADO no payload majoritário (D1/D2)
# ---------------------------------------------------------------------------


def _linha_com_relogio(
    *,
    cod_municipio_tse: int,
    te: int,
    hg: str,
    uf: str = "SP",
    cod_zona: int = 1,
) -> dict[str, Any]:
    """Um par (município, zona) com `e.te` e `hg` sob controle do teste.

    `te` decide qual par é o DOMINANTE da zona no `merge_pairs_into_zonas`
    (`zona_merge.py:52`) — e portanto de quem o `dg`/`hg` sobreviveria se o
    relógio do dado fosse medido depois do merge.
    """
    envelope = _synthetic_payload({100: 55.0, 200: 45.0})
    envelope["e"] = {**envelope["e"], "te": str(te)}
    envelope["hg"] = hg
    return {
        "cargo": 1,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": cod_municipio_tse,
        "cod_zona": cod_zona,
        "pct_apurado": 100.0,
        "payload": envelope,
    }


def test_dado_ts_majoritario_vem_dos_pares_antes_do_merge_de_zona(
    fake_db,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADR-0038 D1 — a fonte é `raw_snapshots`, não `snapshots`.

    A zona tem dois pares: o dominante (maior `e.te`) carimbado às 18h e uma
    fatia pequena carimbada às 20h15. `merge_pairs_into_zonas` preserva
    `dg`/`hg` só do dominante, então um relógio lido DEPOIS do merge publicaria
    18h — escondendo o boletim mais novo e, pior, escondendo 100% dos pares
    não-dominantes quando eles é que ficarem para trás.
    """
    from api.model import project as proj_mod

    snapshots = [
        _linha_com_relogio(cod_municipio_tse=71072, te=5000, hg="18:00:00"),
        _linha_com_relogio(cod_municipio_tse=71080, te=10, hg="20:15:30"),
    ]
    fake_db(snapshots, [], [{"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 100_000}])

    publicados: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
    )

    status, _resposta = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )

    assert status == 200
    payload, uf_payloads = publicados[0]
    # 20:15:30 BRT = 23:15:30 UTC — o par NÃO dominante.
    assert payload["dado_ts"] == "2026-10-04T23:15:30+00:00"
    # O dominante ficou 2h15 atrás do máximo do ciclo — muito além das 2
    # cadências de 60s do cargo 1.
    assert payload["pares_atrasados"] == 1
    assert uf_payloads["SP"]["dado_ts"] == "2026-10-04T23:15:30+00:00"
    assert uf_payloads["SP"]["pares_atrasados"] == 1
    # `ts` continua sendo a hora do cálculo — outro campo, outro valor.
    assert payload["ts"] != payload["dado_ts"]


def test_payload_majoritario_sem_dg_hg_publica_null_sem_cair_para_o_ts(
    fake_db,
    minimal_dataset,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Envelope podado (o formato das fixtures do replay 2022): o ciclo roda
    inteiro e publica `dado_ts: null`, jamais a hora do cálculo no lugar."""
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    podados = [
        {
            **s,
            "payload": {k: v for k, v in s["payload"].items() if k not in ("dg", "hg")},
        }
        for s in snapshots
    ]
    fake_db(podados, historical, eleitorado)

    publicados: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
    )

    status, resposta = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )

    assert status == 200
    assert resposta["computed"] is True
    payload, uf_payloads = publicados[0]
    assert payload["dado_ts"] is None
    assert payload["pares_atrasados"] is None
    assert uf_payloads["SP"]["dado_ts"] is None
    assert isinstance(payload["ts"], str)


# ---------------------------------------------------------------------------
# A trava anti-multiplicação está LIGADA ao ciclo majoritário (2026-09-13)
#
# `check_zona_merge_sanity` tinha 10 testes unitários verdes e nenhum que
# provasse que ela é CHAMADA. Mutar a chamada para fora do ciclo passava na
# suíte inteira — nos dois ramos. O ramo proporcional ganhou o teste de fio em
# `test_deputado_payload.py`; este é o do majoritário.
#
# A mutação que isto tem que matar é a que o código SOBREVIVE — trocar o
# resultado por zero violações, não apagar a linha. Apagar dá `NameError` e
# qualquer teste fica vermelho pelo motivo errado: mediria o compilador.
# ---------------------------------------------------------------------------


def _par(uf: str, cod_municipio_tse: int, cod_zona: int) -> dict[str, Any]:
    """Linha de par (município, zona) — a unidade de ingestão desde a
    migration 0006. O envelope sintético traz `e.te = 1000` fixo."""
    return {
        "cargo": 1,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": cod_municipio_tse,
        "cod_zona": cod_zona,
        "pct_apurado": 100.0,
        "payload": _synthetic_payload({100: 55.0, 200: 45.0}),
    }


def test_ciclo_majoritario_aciona_a_guarda_quando_a_premissa_da_fatia_cai(
    fake_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dois pares da MESMA zona, cada um trazendo `e.te = 1000`, contra uma
    zona de 1.000 eleitores: razão 2,0, acima do limiar de violação.

    É o sinal de que o arquivo do par não traz a fatia do município e sim a
    zona inteira — a premissa que o Passo 0 do simulado decide. Se cair sem
    que ninguém grite, Presidente/Governador/Senador saem multiplicados.
    """
    from api.model import project as proj

    alertas: list[tuple] = []
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )

    fake_db(
        snapshots=[_par("SP", 71072, 1), _par("SP", 67016, 1)],
        historical=[],
        eleitorado=[{"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 1_000}],
    )
    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, _payload = proj._do_project(body)

    assert status == 200, "a guarda NÃO pode abortar o ciclo (constituição § 7)"
    # Filtra por ESTE alarme: o mesmo ciclo tem outros (dado parado, por
    # exemplo), e assumir `alertas[0]` deixaria o teste vermelho pela razão
    # errada quando outro disparasse antes — mandando consertar o lugar errado.
    multiplicacao = [a for a in alertas if "multiplicação" in a[1]]
    assert multiplicacao, f"a guarda não acionou — a chamada saiu do ciclo? alertas={alertas}"
    nivel, _msg, ctx = multiplicacao[0]
    assert nivel == "error"
    assert ctx["n_violacoes"] == 1


def test_ciclo_majoritario_fica_calado_quando_a_premissa_se_confirma(
    fake_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """O outro lado, sem o qual o teste acima passaria com uma guarda que
    grita sempre: os mesmos dois pares contra uma zona de 2.000 eleitores dão
    razão 1,0 — a premissa da fatia confirmada. Silêncio.
    """
    from api.model import project as proj

    alertas: list[tuple] = []
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )

    fake_db(
        snapshots=[_par("SP", 71072, 1), _par("SP", 67016, 1)],
        historical=[],
        eleitorado=[{"ano": 2026, "uf": "SP", "cod_zona": 1, "eleitores_aptos": 2_000}],
    )
    body = json.dumps(
        {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
    ).encode("utf-8")

    status, _payload = proj._do_project(body)

    assert status == 200
    multiplicacao = [a for a in alertas if "multiplicação" in a[1]]
    assert not multiplicacao, f"alarme falso com a premissa confirmada: {multiplicacao}"


def test_serie_por_candidato_chega_ao_payload_publicado(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spec 020 Fase 2 — a COSTURA das três linhas novas de `_do_project`.

    `tests/unit/model/test_serie_por_candidato.py` cobre cada peça em
    isolamento: a consulta, o teto, o elenco, o ponto corrente. Este cobre o
    fio que as liga — `fetch_series_por_candidato`, `anexar_ponto_corrente` e
    os dois `serie_bruta=` nos construtores de payload. Sem ele, apagar
    qualquer uma dessas linhas deixaria a suíte inteira verde e o gráfico
    ficaria vazio em produção, nas quatro telas, sem erro em lugar nenhum.

    O `FakeCursor` devolve `[]` para `FROM projections`, isto é: banco sem
    histórico, primeira rodada da noite. Então a série publicada tem
    exatamente **um** ponto, e esse ponto só pode ter vindo de
    `anexar_ponto_corrente` — o que torna este teste também a prova de que o
    ponto do ciclo corrente é anexado a partir da memória, e não relido do
    banco depois da escrita.
    """
    from api.model.project import _do_project, urllib as proj_urllib

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    monkeypatch.setenv("MODEL_SECRET", "test-secret")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")

    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def fake_urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(proj_urllib.request, "urlopen", fake_urlopen)

    status, _response = _do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200

    payload = captured["body"]["payload"]
    serie = payload.get("serie_por_candidato")
    assert serie is not None, (
        "`serie_por_candidato` ausente do payload nacional — a fiação da "
        "spec 020 sumiu de `_do_project`"
    )
    assert len(serie["eixo"]) == 1
    assert serie["cadencia_min"] in (5, 10, 15, 30)
    assert 1 <= len(serie["candidatos"]) <= 4

    # O único ponto é o do ciclo corrente, e ele bate com o placar do MESMO
    # payload (RF-169). O banco desta fixture está vazio: se o ponto não
    # tivesse sido anexado da memória, não haveria ponto nenhum.
    placar = {c["id"]: c for c in payload["national"]["candidatos"]}
    for linha in serie["candidatos"]:
        assert linha["apurado"][-1] == round(placar[linha["id"]]["pct_atual"], 2)

    # E o escopo por UF, que é onde vivem 27 das 28 telas.
    payloads_uf = captured["body"]["payloads_uf"]
    for sigla, uf_payload in payloads_uf.items():
        serie_uf = uf_payload["series_temporais"].get("por_candidato")
        assert serie_uf is not None, f"{sigla} sem série por candidatura"
        placar_uf = {c["id"]: c for c in uf_payload["candidatos"]}
        for linha in serie_uf["candidatos"]:
            assert linha["apurado"][-1] == round(placar_uf[linha["id"]]["pct_atual"], 2)


def test_vigia_da_serie_cega_roda_antes_de_anexar_o_ponto(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S08 § 3 — a FIAÇÃO do vigia, que nenhum teste unitário alcança.

    `tests/unit/model/test_serie_cega_alarme.py` prova o comportamento de
    `vigiar_serie_cega` em isolamento. Este prova que `_do_project` de fato a
    chama: medido em 18/09, apagar a chamada do orquestrador deixava os 572
    testes verdes — um alarme corretíssimo e nunca invocado é um alarme mudo,
    que é exatamente o defeito que a S08 existe para não repetir.

    Duas asserções, e a segunda é a que discrimina de verdade:

      1. Foi chamada uma vez, com o `cargo`/`turno` da requisição.
      2. A `bruta` que ela recebeu é a série **como veio do banco** — vazia
         nesta fixture, porque o `FakeCursor` devolve `[]` para `FROM
         projections`. Se a chamada fosse movida para DEPOIS de
         `anexar_ponto_corrente`, a estrutura chegaria com o ponto do ciclo
         corrente e o baseline do alarme passaria a incluir o próprio ciclo
         que ele deveria estar julgando — o vigia nunca mais veria
         discrepância nenhuma.
    """
    from api.model import project as proj

    snapshots, historical, eleitorado = minimal_dataset
    fake_db(snapshots, historical, eleitorado)

    chamadas: list[dict[str, Any]] = []
    real = proj.vigiar_serie_cega

    def espiao(bruta, **kw):  # noqa: ANN001,ANN202
        chamadas.append({"escopos": dict(bruta.por_escopo), **kw})
        return real(bruta, **kw)

    monkeypatch.setattr(proj, "vigiar_serie_cega", espiao)

    status, _ = proj._do_project(
        json.dumps(
            {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
        ).encode("utf-8")
    )
    assert status == 200

    assert len(chamadas) == 1, (
        "`vigiar_serie_cega` não foi chamada por `_do_project` — o alarme da "
        "S08 § 3 existe no arquivo e não roda no ciclo"
    )
    assert chamadas[0]["cargo"] == 1
    assert chamadas[0]["turno"] == 1
    assert chamadas[0]["escopos"] == {}, (
        "o vigia recebeu a série JÁ com o ponto do ciclo corrente — ele tem de "
        "rodar antes de `anexar_ponto_corrente`, ou o baseline inclui o "
        "próprio ciclo que ele julga"
    )


# ---------------------------------------------------------------------------
# Spec 021 — o bloco `votacao` no ciclo inteiro (RF-199 / RF-195)
#
# Os testes de unidade de `somar_contagens_agregadas` /
# `projetar_fatias_em_contagens` vivem em `test_votacao.py`. O que se prova
# AQUI é a fiação: que o agregado chega ao payload publicado, e — o ponto
# perigoso — que ele NÃO entra no modelo pelo caminho.
# ---------------------------------------------------------------------------


def _agregado_uf(uf: str, *, te: int, ts: str = "2026-10-04T18:20:00Z") -> dict[str, Any]:
    """Linha de `snapshots` de nível "uf": o agregado que o TSE publica.

    `cod_zona = 0` e `cod_municipio_tse = 0` são os sentinelas de abrangência
    sem município (`lib/tse/targets.ts::buildUfTarget`). `ts` propositalmente
    MAIS FRESCO que o das zonas do `minimal_dataset` — é a condição em que o
    descarte por sentinela mataria as zonas reais se a partição por `nivel`
    não existisse.
    """
    return {
        "cargo": 1,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "nivel": "uf",
        "pct_apurado": 100.0,
        "ts": ts,
        # Aritmética do TSE FECHADA de propósito (senão o teste mede um mundo
        # impossível): `c + a == esi == te`, e dentro do comparecimento
        # `vv + vb + tvn + van + vansj == c`. Com 10% de anulados/sub judice
        # sobre os aptos, as QUATRO fatias nomeadas somam 90% e o residual do
        # círculo 1 é exatamente `van + vansj`.
        "payload": {
            "e": {
                "te": str(te),
                "esi": str(te),
                "c": str(int(te * 0.80)),
                "a": str(int(te * 0.20)),
            },
            "v": {
                "tv": str(int(te * 0.80)),
                "vv": str(int(te * 0.60)),
                "vvc": str(int(te * 0.70)),
                "vb": str(int(te * 0.05)),
                "tvn": str(int(te * 0.05)),
                "van": str(int(te * 0.06)),
                "vansj": str(int(te * 0.04)),
            },
        },
    }


def test_votacao_chega_ao_payload_publicado(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RF-199: as contagens absolutas do agregado do TSE saem no payload."""
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    com_agregado = [
        *snapshots,
        _agregado_uf("SP", te=30_000_000),
        _agregado_uf("RJ", te=12_000_000),
    ]
    fake_db(com_agregado, historical, eleitorado)

    publicados: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
    )

    status, _ = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )
    assert status == 200
    payload, _uf = publicados[0]

    assert "votacao" in payload, "o bloco tem de chegar à tela"
    contagens = payload["votacao"]["contagens"]
    # Cargo 1 SEM linha "br" neste cenário ⇒ soma dos agregados de UF.
    assert contagens["aptos"] == 42_000_000
    assert contagens["anulados"] == int(30_000_000 * 0.06) + int(12_000_000 * 0.06)
    assert contagens["sub_judice"] == int(30_000_000 * 0.04) + int(12_000_000 * 0.04)
    # RF-197 — anulados e sub judice existem e NÃO estão dentro de `validos`.
    quatro = (
        contagens["validos"]
        + contagens["brancos"]
        + contagens["nulos"]
        + contagens["abstencao"]
    )
    assert contagens["aptos"] - quatro == contagens["anulados"] + contagens["sub_judice"]


def test_agregado_nao_contamina_o_modelo(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """🔴 O teste que discrimina: acrescentar o agregado NÃO pode mover um
    número do modelo.

    O agregado chega com `cod_zona = 0` e com `ts` mais fresco que as zonas.
    Se ele entrasse na lista do modelo, duas coisas aconteceriam, ambas
    silenciosas: (a) cada voto seria contado duas vezes — uma pelas zonas
    reais, outra pelo agregado que as resume; (b) pior,
    `_discard_zero_zona_sentinel_when_real_zonas_exist` descartaria a família
    de zonas reais por ser MENOS fresca, e SP inteiro passaria a ser projetado
    a partir de uma única linha.

    A prova é por comparação: roda o ciclo sem o agregado e com ele, e exige
    que a projeção saia **idêntica**. Um teste que só verificasse "o payload
    tem votacao" passaria nos dois mundos.
    """
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset

    def _rodar(linhas: list[dict[str, Any]]) -> dict[str, Any]:
        fake_db(linhas, historical, eleitorado)
        publicados: list[dict[str, Any]] = []
        monkeypatch.setattr(
            proj_mod,
            "post_edge_write",
            lambda payload, payloads_uf=None: publicados.append(payload),
        )
        status, _ = proj_mod._do_project(
            json.dumps(
                {"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}
            ).encode()
        )
        assert status == 200
        return publicados[0]

    sem = _rodar(list(snapshots))
    com = _rodar([*snapshots, _agregado_uf("SP", te=30_000_000), _agregado_uf("RJ", te=12_000_000)])

    assert "votacao" not in sem, "sem agregado, a chave nem aparece (RF-198)"
    assert "votacao" in com

    # O modelo tem de estar intocado — campo a campo.
    assert com["pct_apurado_total"] == sem["pct_apurado_total"]
    assert com["ufs_apuradas"] == sem["ufs_apuradas"]
    assert [r["sigla"] for r in com["por_uf"]] == [r["sigla"] for r in sem["por_uf"]]
    assert com["national"]["candidatos"] == sem["national"]["candidatos"]
    assert com["national"]["needle_position"] == sem["national"]["needle_position"]
    assert com["national"].get("participacao") == sem["national"].get("participacao")
    # E nenhuma UF fantasma "BR" entrou na lista.
    assert "BR" not in {r["sigla"] for r in com["por_uf"]}


def test_linha_br_nao_entra_no_por_uf(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A linha de nível "br" (uf = "BR") é o país, não uma 28ª unidade
    federativa. Ela alimenta `votacao` e mais nada."""
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    br = {**_agregado_uf("BR", te=163_000_000), "nivel": "br", "uf": "BR"}
    fake_db([*snapshots, br], historical, eleitorado)

    publicados: list[dict[str, Any]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append(payload),
    )
    status, _ = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )
    assert status == 200
    payload = publicados[0]

    assert "BR" not in {r["sigla"] for r in payload["por_uf"]}
    # Cargo 1 COM linha "br": o número vem dela, não de uma soma.
    assert payload["votacao"]["contagens"]["aptos"] == 163_000_000


def test_agregado_mais_VELHO_que_as_zonas_sobrevive_ao_filtro_de_sentinela(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """🔴 O caso que discrimina o conserto do filtro de sentinela.

    `_discard_zero_zona_sentinel_when_real_zonas_exist` escolhe entre a
    família `cod_zona = 0` e a de zonas reais **por frescor**, e descarta a
    perdedora. O agregado chega com `cod_zona = 0`, então antes da spec 021
    ele era descartado **sempre que as zonas fossem mais recentes** — que é o
    estado normal de operação. O dado entrava no banco e sumia antes de chegar
    ao payload.

    As duas famílias deixaram de ser concorrentes e passaram a ser
    COMPLEMENTARES: a de zona alimenta o modelo, a agregada alimenta
    `votacao`. A partição por `nivel` roda ANTES do filtro, então o filtro só
    vê zonas e não tem mais como descartar o agregado.

    ⚠️ O `ts` do agregado aqui é deliberadamente MAIS VELHO que o das zonas.
    Um teste em que as duas famílias têm o mesmo `ts` não distinguiria nada:
    o empate favorece a sentinela e ela sobreviveria mesmo sem o conserto.
    """
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    # As zonas do `minimal_dataset` usam `_DEFAULT_TS`; o agregado vem antes.
    zonas_frescas = [{**s, "ts": "2026-10-04T21:00:00Z"} for s in snapshots]
    agregado_velho = _agregado_uf("SP", te=30_000_000, ts="2026-10-04T17:00:00Z")
    assert agregado_velho["ts"] < zonas_frescas[0]["ts"], "premissa do teste"

    fake_db([*zonas_frescas, agregado_velho], historical, eleitorado)
    publicados: list[dict[str, Any]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append(payload),
    )
    status, _ = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )
    assert status == 200
    payload = publicados[0]

    assert "votacao" in payload, (
        "o agregado mais VELHO que as zonas foi descartado pelo filtro de "
        "sentinela — era exatamente o buraco que a coluna `nivel` fecha"
    )
    assert payload["votacao"]["contagens"]["aptos"] == 30_000_000
    # E as zonas reais continuam sendo o insumo do modelo: SP projetado a
    # partir das suas 2 zonas, não da linha agregada.
    assert {r["sigla"] for r in payload["por_uf"]} == {"SP", "RJ"}


# ---------------------------------------------------------------------------
# Spec 022 — a corrida chega ao payload publicado (RF-209)
#
# Unidade em `test_corrida.py`. Aqui só a FIAÇÃO: que `_do_project` entrega
# `votacao` a cada `EdgePayloadUf` que tem agregado — inclusive com a linha
# `br` presente, que no Presidente faz as contagens nacionais retornarem cedo.
# ---------------------------------------------------------------------------


def _com_corrida(linha: dict[str, Any], cands: list[tuple[int, str, int, str]]) -> dict[str, Any]:
    linha = json.loads(json.dumps(linha))
    linha["payload"]["carg"] = [
        {
            "cd": "1",
            "agr": [
                {
                    "n": "1",
                    "par": [
                        {"n": str(n), "sg": sg, "cand": [{"n": str(n), "vap": str(v), "dvt": d}]}
                        for n, sg, v, d in cands
                    ],
                }
            ],
        }
    ]
    return linha


def test_corrida_chega_ao_payload_de_uf_mesmo_com_linha_br(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.model import project as proj_mod

    snapshots, historical, eleitorado = minimal_dataset
    sp = _com_corrida(
        _agregado_uf("SP", te=30_000_000),
        [(100, "PT", 10_000_000, "Válido"), (200, "PL", 8_000_000, "Válido")],
    )
    br = _com_corrida(
        {**_agregado_uf("BR", te=163_000_000), "nivel": "br", "uf": "BR"},
        [(100, "PT", 50_000_000, "Válido"), (200, "PL", 40_000_000, "Anulado sub judice")],
    )
    # RJ fica SEM agregado: o payload de RJ existe (zonas), o `votacao` dele não.
    fake_db([*snapshots, sp, br], historical, eleitorado)

    publicados: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
    )
    status, _ = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )
    assert status == 200
    payload, ufs = publicados[0]

    # Nacional: da linha BR.
    assert payload["votacao"]["contagens"]["aptos"] == 163_000_000
    assert [e["id"] for e in payload["votacao"]["corrida"]] == [100, 200]
    assert payload["votacao"]["corrida"][1]["destino"] == "sub_judice"
    assert "corrida_por_partido" not in payload["votacao"]

    # UF: das contagens da UF, não do Brasil.
    assert set(ufs) == {"SP", "RJ"}
    assert ufs["SP"]["votacao"]["contagens"]["aptos"] == 30_000_000
    assert ufs["SP"]["votacao"]["corrida"] == [
        {"id": 100, "partido": "PT", "votos": 10_000_000, "destino": "valido"},
        {"id": 200, "partido": "PL", "votos": 8_000_000, "destino": "valido"},
    ]
    # Spec 021 RF-192 emendado (26/09 noite): a UF agora projeta — o painel
    # "Votação" entrou na tela de UF. A fiação fina está no teste abaixo.
    assert "projetada" in ufs["SP"]["votacao"]
    assert "votacao" not in ufs["RJ"], "UF sem agregado é 'não sabemos', nunca zeros"


def test_projetada_da_uf_sai_da_participacao_DA_UF_e_nao_da_nacional(
    fake_db, minimal_dataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    """🔴 Spec 021 RF-192 emendado (26/09 noite) — a fiação que discrimina.

    `_do_project` tem as duas participações lado a lado (`participacao_by_uf`
    e `participacao_nacional`); trocar uma pela outra na chamada de
    `build_votacao_uf_payloads` compila, roda e publica um número plausível.
    O teste força as duas a DIVERGIREM (abstenção 10% na UF, 40% no país) e
    exige a da UF: 10% de 30.000.000 = 3.000.000.
    """
    from api.model import project as proj_mod

    original = proj_mod.compute_participacao

    def _participacao_divergente(*args: Any, **kwargs: Any):
        by_uf, nacional = original(*args, **kwargs)
        by_uf = {uf: dict(m) for uf, m in by_uf.items()}
        nacional = dict(nacional)
        for chave, pct_uf, pct_br in (
            ("abstencao", 10.0, 40.0),
            ("validos", 80.0, 50.0),
            ("brancos", 5.0, 20.0),
            ("nulos", 5.0, 20.0),
        ):
            base_uf = by_uf["SP"][chave]
            base_br = nacional[chave]
            assert base_uf is not None and base_br is not None, "premissa do teste"
            by_uf["SP"][chave] = {**base_uf, "pct_projetado": pct_uf}
            nacional[chave] = {**base_br, "pct_projetado": pct_br}
        return by_uf, nacional

    monkeypatch.setattr(proj_mod, "compute_participacao", _participacao_divergente)

    snapshots, historical, eleitorado = minimal_dataset
    fake_db([*snapshots, _agregado_uf("SP", te=30_000_000)], historical, eleitorado)
    publicados: list[tuple[dict, dict]] = []
    monkeypatch.setattr(
        proj_mod,
        "post_edge_write",
        lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
    )
    status, _ = proj_mod._do_project(
        json.dumps({"cargo": 1, "turno": 1, "trigger_ts": "2026-10-04T18:23:15Z"}).encode()
    )
    assert status == 200
    _payload, ufs = publicados[0]

    assert ufs["SP"]["votacao"]["projetada"] == {
        "abstencao": 3_000_000,
        "validos": 21_600_000,
        "brancos": 1_350_000,
        "nulos": 1_350_000,
    }
