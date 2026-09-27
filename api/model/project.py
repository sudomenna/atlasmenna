"""
api/model/project.py

POST /api/model/project — endpoint Python do modelo estatístico (spec 002).

Roda em Vercel Fluid Compute com runtime Python 3.14. Acionado pelo handler
TypeScript `/api/ingest` ao final de cada ciclo de ingestão (T16 da spec
002, Fase 5). Orquestrador completo cola `extrapolation.py` (regra de
três por zona, RF-011/012/013 — plano `tem-um-erro-eu-velvety-sprout.md`,
2026-09-05, substituiu o pipeline de swing vs. 2022 original de T06-T09),
`turnout.py` (participação, RF-020.1), `p_vitoria` (T10) e `edge_cases`
(T11, RF-017/018) atrás de um único POST com persistência no Postgres.

Por que NÃO está em `app/api/model/project/...`?
  O Next.js App Router só aceita route handlers TS/JS dentro de `app/`.
  Funções Python no Vercel vivem na pasta `/api/` na raiz do projeto
  (https://vercel.com/docs/functions/runtimes/python). Os dois subtrees
  coexistem na mesma URL surface — Vercel faz o roteamento por path
  prefix.

Imports (decisão T12):
  Usamos imports ABSOLUTOS desde a raiz: `from api.model.extrapolation
  import ...`. Em Vercel, a raiz do projeto é mantida no `sys.path`
  quando a function é importada via `api/model/project.py`, então
  `api.model.X` resolve. Imports relativos (`from .extrapolation import
  ...`) também funcionariam, mas os testes locais já usam absolutos (via
  conftest que injeta a raiz no sys.path) e essa consistência ajuda a
  debug: o mesmo import string vale em test/prod.
  Fallback: se Vercel quebrar com absolutos no Python runtime real,
  trocar para relativos é uma mudança de 6 linhas neste arquivo.

DB driver (decisão kickoff S03):
  psycopg[binary] direto contra `DATABASE_URL` (Neon). Aceita prepared
  statements no Neon serverless quando NÃO via pooler — caller DEVE usar
  a connection string `direct`. Se quebrar (cold start ↔ pgbouncer), criar
  um helper Node `/api/internal/snapshots` é o plano B.

Auth:
  Header `x-model-secret` === `os.environ["MODEL_SECRET"]`. Mesmo padrão
  do `x-cron-secret` do `/api/ingest`. Ausente/inválido → 401.

Determinismo (constituição § 6):
  Seed do bootstrap = SHA-256 dos 8 primeiros chars hex de
  `f"{cargo}:{turno}:{trigger_ts}"`. Reproduzível bit-a-bit — mesmo trigger_ts
  → mesma `national_p_vitoria_a`. Validado em test_orchestrator::test_determinism.

Append-only (constituição § 10):
  Persistimos via INSERT puro em `projections` (sem ON CONFLICT, sem
  UPDATE, sem DELETE). Re-execuções geram linhas novas com `ts` distinto.
  Replay histórico é literalmente `SELECT ... ORDER BY ts`.

Cobre: RF-019 (persistir cálculos do modelo), RF-020 (replay/auditoria via
append-only), RF-011..RF-018 indiretamente via composição de T06..T11.
Spec: docs/specs/002-modelo-estatistico/ (T12).
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler
import hashlib
import json
import logging
import math
import os
import time
import traceback
import urllib.error
import urllib.request
import uuid
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from typing import Any, NamedTuple, TypedDict

import numpy as np
from pydantic import BaseModel, Field, ValidationError

from api.model.cargos import (
    ATUALIZACAO_MIN_DEPUTADO,
    Granularidade,
    cargo_info,
    granularidade as cargo_granularidade,
    total_cadeiras as cargo_total_cadeiras,
    vagas_em_disputa as cargo_vagas_em_disputa,
    vagas_por_uf as cargo_vagas_por_uf,
    votos_por_eleitor as cargo_votos_por_eleitor,
)
from api.model.cadeiras import distribuir_cadeiras
from api.model.cadeiras_bootstrap import (
    IntervaloCadeiras,
    intervalo_de_cadeiras,
    intervalo_nacional,
)
from api.model.dado_ts import (
    RelogioDoDado,
    lag_segundos,
    limiar_alarme_segundos,
    relogio_do_dado,
    relogio_por_uf,
)
from api.model.deputado import (
    EntradaProporcional,
    combinar_entradas,
    conferir_contra_tse,
    extrair_entrada_proporcional,
)
from api.model.deputado_payload import (
    UfProporcional,
    conferir_total_de_cadeiras,
    construir_payload_deputado,
    normalizar_divergencia,
)
from api.model.extrapolation import (
    CandidatoEstimate,
    UfCandidatosEstimate,
    ZonaCandidatos,
    aggregate_national_votos,
    estimate_uf_candidatos,
    impute_uf_from_national,
)
from api.model.p_vitoria import p_eleito, p_vitoria
from api.model.turnout import (
    Metric as ParticipacaoMetric,
    ParticipacaoEstimate,
    ZonaParticipacao,
    _votos_por_eleitor_valido,
    aggregate_national_participacao,
    estimate_uf_participacao,
)
from api.model.zona_merge import check_zona_merge_sanity, merge_pairs_into_zonas

# ---------------------------------------------------------------------------
# Logging — JSON-line para alinhar com lib/tse/log.ts (RNF-032)
# ---------------------------------------------------------------------------

_logger = logging.getLogger("api.model.project")
if not _logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(_h)
    _logger.setLevel(logging.INFO)


def _log(level: str, msg: str, **ctx: Any) -> None:
    """Emite linha JSON com level/msg/ctx — equivalente Python ao logInfo TS."""
    payload = {"level": level, "msg": msg, **ctx}
    _logger.info(json.dumps(payload, default=str))


# ---------------------------------------------------------------------------
# Forma do payload por UF — constantes
# ---------------------------------------------------------------------------

#: Quantas candidaturas entram em `EdgeUfRow.top_candidatos[]` (2026-09-19,
#: pedido do dono — o balão de hover dos mapas passa de 3 para 4 linhas + uma
#: linha "Outros").
#:
#: **Por que é uma constante e não um `4` literal.** O número é lido em DOIS
#: lugares que TÊM de concordar: o corte (`ordered[:TOP_CANDIDATOS_POR_UF]`) e
#: a cauda que vira o agregado `outros` (`ordered[TOP_CANDIDATOS_POR_UF:]`).
#: Dois literais divergem em silêncio — um `[:4]` com um `[5:]` republicaria a
#: 5ª candidatura duas vezes (uma como linha própria, outra dentro de
#: "Outros"), e a soma `Σtop + outros` passaria de 100% sem nenhuma exceção
#: ser levantada. Um único nome torna a divergência impossível de escrever.
#:
#: NÃO confundir com `SERIE_ELENCO` (também 4): aquele é quantas candidaturas
#: entram no GRÁFICO de evolução (ADR-0046 D4), uma decisão de densidade de
#: traço; este é quantas linhas o BALÃO mostra. Coincidem hoje por acaso e
#: podem divergir amanhã sem que nada quebre.
TOP_CANDIDATOS_POR_UF = 4

#: Quantas candidaturas são RESGATADAS pela ordem do APURADO quando não estão
#: no corte por projeção (2026-09-21, decisão do dono).
#:
#: ## O defeito que isto fecha
#:
#: `top_candidatos` é um corte TOP-N **por projeção**. Quem lidera os boletins
#: já apurados mas não está entre os 4 primeiros por `pct_projetado` some
#: dentro de `outros`, que não tem `id` nem nome — e a UI, que desde
#: 2026-09-20 pinta o mapa, ordena a lista e destaca o líder pela BASE ATIVA
#: (`lib/utils/lider-por-base.ts`), não tem como mostrá-lo nem como saber que
#: ele existe. O payload silenciava a pessoa que está ganhando a contagem.
#:
#: ## Por que 2, e não 1
#:
#: São exatamente os dois postos que a derivação por base consome:
#:
#:   - **#1** — `liderIdPorBase` (cor do mapa, topo do balão, linha "Líder:").
#:   - **#2** — `margemPorBase` (intensidade do mapa: 1º−2º do apurado) e, em
#:     Senador, a 2ª CADEIRA, que é o posto que decide quem se elege.
#:
#: Resgatar só o #1 deixaria a margem do apurado maior do que a real sempre
#: que o 2º colocado estivesse fora do corte — furo já documentado na
#: docstring de `margemPorBase`. Resgatar mais que 2 cresceria o balão sem
#: nenhum consumidor que precise do 3º apurado.
#:
#: ## O que NÃO acontece
#:
#: O resgate **nunca inventa dado**: só entra quem tem `pct_atual` publicado,
#: e a comparação é entre `pct_atual` de verdade. Sem leitura parcial, não há
#: resgate e o payload sai byte a byte igual ao de antes desta data.
#:
#: 🔴 E os resgatados entram **DEPOIS** dos `TOP_CANDIDATOS_POR_UF` primeiros,
#: nunca no meio: `margemSegundaVaga` (`lib/utils/margem-senado.ts:43`) lê
#: `top_candidatos[1]`/`[2]` POSICIONALMENTE, assumindo que o prefixo continua
#: ordenado por projeção. Inserir um resgatado no índice 1 trocaria, em
#: silêncio, o par que decide a 2ª vaga do Senado.
RESGATE_POR_APURADO = 2


# ---------------------------------------------------------------------------
# Pydantic schemas — contrato do endpoint
# ---------------------------------------------------------------------------


class ProjectRequest(BaseModel):
    """Body do POST /api/model/project (design.md § Contratos).

    `trigger_ts` é ISO 8601; mantido como string crua para o seed
    determinístico (não convertemos para datetime — qualquer normalização
    mudaria o hash).
    """

    cargo: int = Field(
        ge=1,
        le=99,
        description=(
            "Código do cargo no TSE: 1=Presidente, 3=Governador, 5=Senador, "
            "6=Deputado Federal (tabela canônica em `lib/config/cargos.ts`, "
            "espelhada em `api/model/cargos.py`). A faixa 1..99 é deliberada: "
            "um cargo fora da tabela não é recusado na borda, degrada para o "
            "comportamento default (1 vaga, granularidade de zona) — o ciclo "
            "de apuração nunca cai por um código inesperado."
        ),
    )
    turno: int = Field(ge=1, le=2)
    trigger_ts: str = Field(min_length=1, max_length=64)


class ProjectResponse(BaseModel):
    """Response 200 do endpoint.

    `national_p_vitoria_a` = P(líder vence segundo lugar), onde "líder" e
    "segundo lugar" são determinados pelo `pct_projetado` agregado nacional
    (mean dos bootstrap estimates). Sempre ∈ [0.5, 1.0] no caso típico
    (líder por definição tem mais votos esperados; flutuação de resamples
    pode aproximar de 0.5 em tossup). Quando só há 1 candidato → 1.0; zero
    candidatos → 0.0.

    `candidato_a_id` / `candidato_b_id`: ids do líder e do segundo, para o
    consumidor TS resolver nome/cor/partido sem precisar ordenar de novo.
    `None` quando há menos de 2 candidatos com estimates válidas.

    Por que mudou (S04 carry-over #1 da retro S03): a versão anterior
    definia A = menor `candidato_id`, o que invertia a agulha quando o id
    do PT > id do PL (replay 2022 com Ciro=3022112 < Lula=3022113 gerou
    `p_vitoria_a` ≈ 0). Agora "A" é sempre o líder semântico.
    """

    computed: bool
    uf_count: int
    national_p_vitoria_a: float
    candidato_a_id: int | None = None
    candidato_b_id: int | None = None
    computed_duration_ms: int


# ---------------------------------------------------------------------------
# Seed determinístico (constituição § 6)
# ---------------------------------------------------------------------------


def derive_seed(cargo: int, turno: int, trigger_ts: str) -> int:
    """Seed para bootstrap a partir de (cargo, turno, trigger_ts).

    Determinismo: SHA-256 do f-string, primeiros 8 chars hex → int 32-bit.
    Compatível com `numpy.random.default_rng(seed)` (aceita int positivo).
    """
    key = f"{cargo}:{turno}:{trigger_ts}".encode("utf-8")
    return int(hashlib.sha256(key).hexdigest()[:8], 16)


# ---------------------------------------------------------------------------
# DB access — psycopg direto contra Neon (DATABASE_URL)
# ---------------------------------------------------------------------------


# Tipo de fronteira (parecido com LatestSnapshotRow em lib/model/repository.ts).
LatestSnapshot = dict[str, Any]
HistoricalRow = dict[str, Any]
EleitoradoRow = dict[str, int]


def _open_conn():
    """Abre conexão psycopg contra DATABASE_URL.

    Import lazy: `psycopg` só carrega quando o handler vai falar com DB,
    permitindo que os testes que mocam DB monkey-patchem este símbolo sem
    pagar o cold-start de carregar libpq.
    """
    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL não configurada — endpoint /api/model/project requer "
            "conexão direta com Neon. Configure a env var no projeto Vercel."
        )
    # autocommit=True: cada SELECT roda em sua própria transação implícita; os
    # INSERTs em projections vão dentro de uma transação explícita (with conn).
    return psycopg.connect(dsn, autocommit=False)


def _discard_zero_zona_sentinel_when_real_zonas_exist(
    snapshots: list[LatestSnapshot],
) -> list[LatestSnapshot]:
    """Por UF, escolhe entre a família sentinela (`cod_zona = 0`) e a
    família de zonas reais (`cod_zona > 0`) por FRESCOR (`ts`), não mais só
    por presença — achado do relatório de review de 2026-09-13.

    Origem (achado urgente do plano `tem-um-erro-eu-velvety-sprout.md`):
    `lib/tse/targets.ts` grava a linha de ingestão em nível `uf` com
    `cod_zona = 0`; como `snapshots` é append-only (constituição § 10), um
    ciclo que já rodou num modo deixa linhas paradas para sempre quando o
    cargo muda de modo — as duas famílias coexistem sem este filtro, e
    somar as duas seria dupla contagem.

    A versão original (só por PRESENÇA — "zona real existe? descarta a
    sentinela") cobria certo a transição `uf` → `zona` (histórico: modo
    `uf` era o default até 2026-09-05/11, todas as UFs tinham zona real
    quando o cargo migrava). Mas depois de 2026-09-13 o interruptor de
    emergência `TSE_DEPUTADO_GRANULARIDADE=uf` (cargo 6) tornou a direção
    OPOSTA alcançável em produção, no meio da apuração: alguém liga o
    interruptor, a ingestão passa a gravar `(uf, 0, 0)` frescas, mas os
    pares `(uf, município, zona)` de antes da virada continuam sendo o
    `rn = 1` das SUAS PRÓPRIAS chaves (nada de novo chega para eles) — só
    por presença, a versão antiga veria "esta UF tem zona real" e
    descartaria a sentinela NOVA, mantendo o modelo calculando sobre os
    pares CONGELADOS no instante da virada, em silêncio (sem erro, sem
    alerta — só um número parado atrás de um `ts` de payload que é a hora
    do cálculo, não a do dado; esse problema mais amplo é pré-existente e
    de todos os cargos, tratado à parte).

    Por isso a comparação agora é por `ts`: o `ts` mais recente de CADA
    família (o de todas as linhas com `cod_zona = 0`, e o de todas as
    linhas com `cod_zona > 0`) decide qual família sobrevive. UF com uma
    família só mantém o que tem (inclusive UF só-sentinela — não regride).
    Sem `ts` confiável de um dos lados (não deveria acontecer: `ts` é
    `NOT NULL` na tabela real), falha aberto — mantém as duas famílias em
    vez de arriscar descartar a certa por dado ausente.
    """
    tem_sentinela: set[str] = set()
    tem_real: set[str] = set()
    max_ts_sentinela: dict[str, Any] = {}
    max_ts_real: dict[str, Any] = {}

    for s in snapshots:
        uf = s["uf"]
        ts = s.get("ts")
        if s["cod_zona"] == 0:
            tem_sentinela.add(uf)
            atual = max_ts_sentinela.get(uf)
            if ts is not None and (atual is None or ts > atual):
                max_ts_sentinela[uf] = ts
        else:
            tem_real.add(uf)
            atual = max_ts_real.get(uf)
            if ts is not None and (atual is None or ts > atual):
                max_ts_real[uf] = ts

    def _mantem(s: LatestSnapshot) -> bool:
        uf = s["uf"]
        if not (uf in tem_sentinela and uf in tem_real):
            return True  # só uma família nesta UF — mantém o que tem.

        ts_sentinela = max_ts_sentinela.get(uf)
        ts_real = max_ts_real.get(uf)
        if ts_sentinela is None or ts_real is None:
            return True  # sem ts confiável de um dos lados — fail-open.

        sentinela_mais_recente = ts_sentinela >= ts_real
        return sentinela_mais_recente if s["cod_zona"] == 0 else not sentinela_mais_recente

    return [s for s in snapshots if _mantem(s)]


def fetch_snapshots(conn, cargo: int, turno: int) -> list[LatestSnapshot]:
    """Snapshot mais recente por **par** `(uf, cod_municipio_tse, cod_zona)`
    para (cargo, turno).

    Migration 0006 / ADR-0035 D1 (11/09): a unidade de ingestão passou a ser o
    par — o TSE publica um EA20 por `(município, zona)` e 62,5 % das zonas
    cobrem 2 a 8 municípios. Particionar por `(uf, cod_zona)` como antes
    devolveria **uma fatia** da zona (o par mais recente), descartando os
    demais em silêncio. A partição agora é pelo par e o índice usado é
    `ix_snap_lookup_par`.

    A soma dos pares de volta à zona — a unidade do estimador, que **não
    muda** (ADR-0021/0023) — é feita pelo CHAMADOR via
    `api.model.zona_merge.merge_pairs_into_zonas`, em memória e nunca
    persistida (§ 1/§ 6). Ver `_do_project` e `api/model/replay_batch.py`.

    CTE só espelha o padrão de ranking (partição por par + `ROW_NUMBER`) de
    `getLatestSnapshotsByZone` em lib/model/repository.ts:193 — aquela
    função TS NÃO implementa (nunca implementou) o descarte de sentinela
    abaixo; ela particiona só por `(uf, cod_zona)`, sem `cod_municipio_tse`
    nem `ts` no SELECT, e não tem nenhum caller de produção (só o próprio
    teste dela) — confirmado em 2026-09-13, não alterado aqui por estar
    fora do caminho crítico.
    `pct_apurado` volta como Decimal/None → convertemos para float. `ts`
    entrou no SELECT em 2026-09-13 (ver
    `_discard_zero_zona_sentinel_when_real_zonas_exist`).

    Achado urgente original (plano `tem-um-erro-eu-velvety-sprout.md`):
    descarta a família sentinela `cod_zona = 0` OU a família de zonas reais
    (`cod_zona > 0`) de uma UF, por frescor de `ts` — sem isso, as duas
    conviveriam com dupla contagem assim que os dois modos se alternassem
    (em QUALQUER direção; ver docstring da função para o porquê de ser por
    `ts` e não por presença desde 2026-09-13). O outro lado do fix (usar
    `eleitorado_total_by_uf[uf]` como peso quando só resta a zona-sentinela)
    vive em `_resolve_zone_weight` — quem CHAMA `fetch_snapshots`
    (`compute_uf_projections`/`compute_participacao`) já tem
    `eleitorado_total_by_uf` disponível.
    """
    # `nivel` entrou com a spec 021 (coluna nova em `snapshots`, migration
    # numerada). `COALESCE(..., 'zona')` porque toda linha gravada antes da
    # migration é de zona e vem com NULL — ver `nivel_do_snapshot`.
    #
    # 🔴 A PARTIÇÃO inclui `nivel`. Sem isso, o agregado de uma UF
    # (`cod_zona = 0`) e uma eventual linha de zona `0` dividiriam a mesma
    # chave e uma delas sumiria pelo `rn = 1`.
    #
    # ⚠️ Dependência de ordem de deploy: esta query exige a coluna. A
    # migration é aditiva e idempotente, e tem de ser aplicada ANTES de o
    # código subir (mesma disciplina da 0009).
    sql = """
        WITH ranked AS (
            SELECT
                uf,
                cod_municipio_tse,
                cod_zona,
                COALESCE(nivel, 'zona') AS nivel,
                pct_apurado,
                payload,
                ts,
                ROW_NUMBER() OVER (
                    PARTITION BY uf, cod_municipio_tse, cod_zona,
                                 COALESCE(nivel, 'zona')
                    ORDER BY ts DESC, id DESC
                ) AS rn
            FROM snapshots
            WHERE cargo = %s AND turno = %s
        )
        SELECT uf, cod_municipio_tse, cod_zona, nivel, pct_apurado, payload, ts
        FROM ranked
        WHERE rn = 1
    """
    with conn.cursor() as cur:
        cur.execute(sql, (cargo, turno))
        rows = cur.fetchall()
    raw: list[LatestSnapshot] = [
        {
            "uf": r[0],
            "cod_municipio_tse": int(r[1]) if r[1] is not None else 0,
            "cod_zona": r[2],
            "nivel": r[3],
            "pct_apurado": float(r[4]) if r[4] is not None else 0.0,
            "payload": r[5],
            "ts": r[6],
        }
        for r in rows
    ]
    # O descarte por sentinela é assunto SÓ das zonas: ele resolve a
    # convivência entre o modo `uf` e o modo `zona` da granularidade, não a
    # do agregado aditivo da spec 021. Rodá-lo sobre o agregado faria as
    # zonas reais de uma UF desaparecerem quando o agregado chegasse mais
    # fresco — ver `particionar_por_nivel`.
    zonas, agregados = particionar_por_nivel(raw)
    return [
        *_discard_zero_zona_sentinel_when_real_zonas_exist(zonas),
        *agregados,
    ]


def fetch_historical_2022(conn, cargo: int, turno: int) -> list[HistoricalRow]:
    """Resultados 2022 por (uf, cod_zona, cod_candidato) para o cargo/turno.

    2022 SAIU da projeção (decisão E1). O único consumidor vivo é
    `compute_swing_descritivo` — comparação DESCRITIVA entre dois fatos
    observados, nunca insumo do modelo.

    `votos` (plano § B, "SQL lê `votos`") é o campo que a E1 usa: o share
    de 2022 é `votos(n) / Σvotos(UF)`, contagem sobre contagem. NÃO
    `pct_validos`, que é uma média de percentuais por zona — somá-la ou
    ponderá-la de volta para a UF reintroduziria exatamente o viés de
    composição que o resto do modelo passa o tempo todo tirando. `votos`
    é `NOT NULL` no schema; `pct_validos` continua sendo lido porque é
    barato e documenta a diferença, mas nenhuma fórmula o usa.
    """
    sql = """
        SELECT uf, cod_zona, cod_candidato, pct_validos, partido, votos
        FROM historical_results
        WHERE ano = 2022 AND cargo = %s AND turno = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (cargo, turno))
        rows = cur.fetchall()
    return [
        {
            "uf": r[0],
            "cod_zona": r[1],
            "cod_candidato": r[2],
            "pct_validos": float(r[3]) if r[3] is not None else None,
            "partido": r[4],
            "votos": int(r[5]) if r[5] is not None else 0,
        }
        for r in rows
    ]


def fetch_eleitorado(conn, ano: int = 2026) -> dict[tuple[str, int], int]:
    """Eleitores aptos por (uf, cod_zona). Chave tuple para lookup O(1).

    ⚠️ O `SUM(...) GROUP BY` não é cosmético. Desde a migration 0006 a PK de
    `eleitorado` é o par `(ano, uf, cod_municipio_tse, cod_zona)`: 6.085 linhas
    para 2.619 zonas. Sem o `GROUP BY`, o dict-comprehension ficava com a
    **última fatia de município** de cada zona em vez da soma — o peso da zona
    no modelo virava fragmentário, em silêncio. O mesmo defeito, em
    `scripts/build-replay-fixtures.ts`, inflou o MAE@1h de 2,3623 pp para
    3,4636 pp (medido em 11/09). Ver
    `docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md` § "O que o
    conserto custa".

    A **chave de saída não muda** — continua `(uf, cod_zona)`, porque a
    unidade do estimador continua sendo a zona (ADR-0021/0023). Nada a jusante
    precisou mudar.
    """
    sql = """
        SELECT uf, cod_zona, SUM(eleitores_aptos) AS eleitores_aptos
        FROM eleitorado
        WHERE ano = %s
        GROUP BY uf, cod_zona
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ano,))
        rows = cur.fetchall()
    return {(r[0], r[1]): int(r[2]) for r in rows}


def fetch_municipio_eleitorado(conn, ano: int = 2026) -> dict[tuple[str, int], int]:
    """Eleitores aptos por `(uf, cod_municipio_tse)` — soma EXATA dos pares
    `(município, zona)` daquele município (ADR-0035 D2: sem rateio).

    Alimenta `EdgeUfMunicipio.eleitores` (decisão D-d), que por sua vez move o
    painel "Maiores colégios eleitorais" (decisão E4). Antes da migration 0006
    esse número não existia por município: a PK de `eleitorado` creditava a
    zona inteira a um município só, pondo 26,1 % do eleitorado sob rótulo
    errado (Uberaba e Governador Valadares sumiam do top-10 de MG).

    Mapa vazio (com log) quando a tabela ainda não foi importada — o payload
    simplesmente omite `eleitores` (campo opcional em `EdgeUfMunicipio`).
    """
    sql = """
        SELECT uf, cod_municipio_tse, SUM(eleitores_aptos) AS eleitores
        FROM eleitorado
        WHERE ano = %s
        GROUP BY uf, cod_municipio_tse
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (ano,))
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — sem seed de eleitorado
        _log("warn", "fetch_municipio_eleitorado failed", error=str(exc))
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 — autocommit ou sem tx
            pass
        return {}
    out: dict[tuple[str, int], int] = {}
    for r in rows:
        if r[1] is None:
            continue
        out[(str(r[0]), int(r[1]))] = int(r[2] or 0)
    return out


def _fetch_eleitorado_por_par(
    conn, ano: int = 2026
) -> dict[tuple[str, int, int], int]:
    """Eleitores aptos por par `(uf, cod_municipio_tse, cod_zona)` — a PK de
    `eleitorado` desde a migration 0006.

    Usado só como PESO do `pct_apurado` municipal em
    `fetch_municipio_aggregates`. Falha ou tabela vazia → `{}`, e o caller
    cai para peso 1 por par (média simples). O `SUM` é redundante com a PK,
    mas mantém a query correta se a chave mudar de novo.
    """
    sql = """
        SELECT uf, cod_municipio_tse, cod_zona, SUM(eleitores_aptos) AS eleitores
        FROM eleitorado
        WHERE ano = %s
        GROUP BY uf, cod_municipio_tse, cod_zona
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (ano,))
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — sem seed de eleitorado
        _log("info", "_fetch_eleitorado_por_par failed, peso cai para 1", error=str(exc))
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 — autocommit ou sem tx
            pass
        return {}
    out: dict[tuple[str, int, int], int] = {}
    for r in rows:
        if len(r) != 4 or r[1] is None:
            continue
        out[(str(r[0]), int(r[1]), int(r[2]))] = int(r[3] or 0)
    return out


def fetch_zona_municipio(conn) -> dict[tuple[str, int, int], dict[str, Any]]:
    """Mapa `(uf, cod_municipio_tse, cod_zona) -> {cod_ibge,
    cod_municipio_tse, nome, uf, mesorregiao_cod, mesorregiao_nome, capital,
    eleitores}`.

    ⚠️ A chave é a TRIPLA do **par**, desde a migration 0006 (ADR-0035 D1). Duas
    razões, nesta ordem:

      1. `zonas` virou tabela de pares (PK `(uf, cod_municipio_tse, cod_zona)`,
         6.109 linhas): a mesma zona aparece em até 8 municípios. Chavear por
         `(uf, cod_zona)` manteria só o ÚLTIMO município iterado de cada zona —
         era exatamente o colapso que a migration desfez (3.392 municípios
         invisíveis no mapa, `docs/_meta/diagnostico-colapso-zona-municipio-
         2026-09-10.md`).
      2. O número da zona **repete entre UFs** (bug de 2026-09-05: 2.229 de
         2.651 entradas sobrescritas ao chavear só por `cod_zona`) — a `uf`
         continua obrigatória na chave.

    Junta `zonas` (que tem o par) com `municipios` (`cod_ibge`, `nome`,
    `mesorregiao_cod` desde a migration 0005, `capital` desde a 0006) e
    `mesorregioes` (opcional). `eleitores` vem de `fetch_municipio_eleitorado`
    (soma dos pares do município). Usado pelo build de `EdgeUfMunicipio`
    (S04/F2) e por `aggregate_by_mesorregiao` (S06/F4d).

    Degradação por tiers de schema (dev/DB atrás das migrations):
      - sem `municipios.capital` (0006) → tenta a query só com mesorregião;
      - sem `municipios.mesorregiao_cod` (0005) → cai na query original (S04);
      - `capital` sai `False` e `mesorregiao_*` sai `None` nesses casos.

    Retorna mapa vazio quando ainda não há dados geográficos carregados
    (dev sem seed) — caller graciosamente produz `municipios: []`.
    """
    sql_full = """
        SELECT
            z.cod_zona, m.cod_ibge, m.cod_municipio_tse, m.nome, z.uf,
            m.mesorregiao_cod, meso.nome AS mesorregiao_nome, m.capital
        FROM zonas z
        JOIN municipios m ON m.cod_municipio_tse = z.cod_municipio_tse
        LEFT JOIN mesorregioes meso ON meso.cod = m.mesorregiao_cod
    """
    sql_with_meso = """
        SELECT
            z.cod_zona, m.cod_ibge, m.cod_municipio_tse, m.nome, z.uf,
            m.mesorregiao_cod, meso.nome AS mesorregiao_nome
        FROM zonas z
        JOIN municipios m ON m.cod_municipio_tse = z.cod_municipio_tse
        LEFT JOIN mesorregioes meso ON meso.cod = m.mesorregiao_cod
    """
    sql_fallback = """
        SELECT z.cod_zona, m.cod_ibge, m.cod_municipio_tse, m.nome, z.uf
        FROM zonas z
        JOIN municipios m ON m.cod_municipio_tse = z.cod_municipio_tse
    """

    rows: list[Any] | None = None
    for sql in (sql_full, sql_with_meso, sql_fallback):
        try:
            with conn.cursor() as cur:
                cur.execute(sql, ())
                rows = cur.fetchall()
            break
        except Exception as exc:  # noqa: BLE001 — coluna inexistente OU sem seed geo
            _log(
                "info",
                "fetch_zona_municipio query failed, trying next tier",
                error=str(exc),
            )
            # Rollback (se houver tx) — psycopg invalida o cursor após erro.
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 — autocommit ou sem tx
                pass
    if rows is None:
        _log("warn", "fetch_zona_municipio: nenhuma query funcionou")
        return {}

    eleitorado_munic = fetch_municipio_eleitorado(conn, ano=2026)

    out: dict[tuple[str, int, int], dict[str, Any]] = {}
    for r in rows:
        uf = str(r[4])
        cod_municipio_tse = int(r[2])
        entry: dict[str, Any] = {
            "cod_ibge": str(r[1]),
            "cod_municipio_tse": cod_municipio_tse,
            "nome": str(r[3]),
            "uf": uf,
        }
        if len(r) >= 7:
            entry["mesorregiao_cod"] = str(r[5]).strip() if r[5] is not None else None
            entry["mesorregiao_nome"] = str(r[6]) if r[6] is not None else None
        else:
            entry["mesorregiao_cod"] = None
            entry["mesorregiao_nome"] = None
        entry["capital"] = bool(r[7]) if len(r) >= 8 else False
        eleitores = eleitorado_munic.get((uf, cod_municipio_tse))
        if eleitores is not None:
            entry["eleitores"] = int(eleitores)
        # r[0] = cod_zona, r[2] = cod_municipio_tse, r[4] = uf — chave tripla.
        out[(uf, cod_municipio_tse, int(r[0]))] = entry
    return out


def fetch_series_temporais(
    conn,
    cargo: int,
    turno: int,
    window_hours: int = 24,
) -> dict[str, list[dict[str, Any]]]:
    """Lê histórico de `projections` agrupado por (uf, ts) para alimentar
    `EdgeUfSeriesTemporais` (S04/F2).

    Estratégia (constituição § 10 — append-only, leitura pura):
      `SELECT ... FROM projections WHERE cargo=? AND turno=? AND
       ts > NOW() - INTERVAL '<window_hours> hours' ORDER BY uf, ts ASC`

    Cada combinação (uf, ts) tem 1 linha por candidato; do lado de cada `ts`
    pegamos:
      - margem_pp: diferença pct_projetado entre top-2 (≥ 0)
      - p_vitoria: max(p_vitoria) entre candidatos da UF nesse ts
      - turnout: pct_apurado da UF (mesmo valor em todas as linhas do ts)

    p_vitoria a nível UF não existe na tabela `projections` (UF rows têm
    `p_vitoria = NULL`); o que retornamos para o chart RF-041 é a
    `p_vitoria` agregada NACIONAL no mesmo ts — equivalente em
    interpretação ao "como o líder está se saindo no agregado" no momento.
    A consulta abaixo lê tanto rows UF quanto nacional (uf IS NULL) e o
    parser separa-os.

    Retorna `{uf_sigla: [{ts, candidatos: [(id, pct, p_vit_nacional)], pct_apurado}, ...]}`
    ordenado por ts ASC dentro de cada UF. O caller transforma em séries
    finais (margem, p_vitoria, turnout) já filtrando pelo líder da UF.

    Tolerante: erro de query (ex.: coluna ausente) → log warn + dict vazio
    (chart vira placeholder gentil).
    """
    sql = """
        SELECT
            ts,
            uf,
            candidato_id,
            pct_projetado,
            pct_apurado,
            p_vitoria
        FROM projections
        WHERE cargo = %s
          AND turno = %s
          AND ts > NOW() - (%s || ' hours')::interval
        ORDER BY uf NULLS FIRST, ts ASC, candidato_id ASC
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (cargo, turno, str(window_hours)))
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — sem séries é OK em dev/preview
        _log("warn", "fetch_series_temporais failed", error=str(exc))
        return {}

    # Group by (uf, ts) — uf=None significa agregado nacional.
    # First pass: collect rows.
    by_uf: dict[str | None, dict[str, list[dict[str, Any]]]] = {}
    for ts_val, uf, cand, pct_proj, pct_ap, pv in rows:
        ts_iso = ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val)
        uf_key = uf if uf is not None else None
        ts_map = by_uf.setdefault(uf_key, {})
        ts_map.setdefault(ts_iso, []).append(
            {
                "candidato_id": int(cand),
                "pct_projetado": float(pct_proj) if pct_proj is not None else 0.0,
                "pct_apurado": float(pct_ap) if pct_ap is not None else 0.0,
                "p_vitoria": float(pv) if pv is not None else None,
            }
        )

    # Indexa p_vitoria nacional por ts → cand_id → p (alimenta chart UF
    # RF-041, já que p_vitoria por UF não é calculado).
    national_pv_by_ts: dict[str, dict[int, float]] = {}
    nat_rows = by_uf.get(None, {})
    for ts_iso, candidates in nat_rows.items():
        cand_map: dict[int, float] = {}
        for c in candidates:
            if c["p_vitoria"] is not None:
                cand_map[c["candidato_id"]] = c["p_vitoria"]
        national_pv_by_ts[ts_iso] = cand_map

    # Produz timeline por UF (não nacional).
    out: dict[str, list[dict[str, Any]]] = {}
    for uf_key, ts_map in by_uf.items():
        if uf_key is None:
            continue
        ordered_ts = sorted(ts_map.keys())  # ASC determinístico
        timeline: list[dict[str, Any]] = []
        for ts_iso in ordered_ts:
            candidates = ts_map[ts_iso]
            # Order desc by pct_projetado, take top-2 for margin.
            ordered_c = sorted(
                candidates, key=lambda c: c["pct_projetado"], reverse=True
            )
            top_pct = ordered_c[0]["pct_projetado"] if ordered_c else 0.0
            second_pct = ordered_c[1]["pct_projetado"] if len(ordered_c) >= 2 else 0.0
            top_cand = ordered_c[0]["candidato_id"] if ordered_c else None
            # pct_apurado é o mesmo nas N linhas do (uf, ts) — pega a 1ª válida.
            pct_apurado_uf = next(
                (c["pct_apurado"] for c in candidates if c["pct_apurado"] > 0.0), 0.0
            )
            # p_vitoria do líder UF olhando para o nacional naquele ts (sufficient
            # approximation para o chart RF-041; refinamento em S05+).
            pv_lider = (
                national_pv_by_ts.get(ts_iso, {}).get(top_cand) if top_cand else None
            )
            timeline.append(
                {
                    "ts": ts_iso,
                    "margem_pp": top_pct - second_pct,
                    "pct_apurado": pct_apurado_uf,
                    "p_vitoria_lider": pv_lider,
                    "lider_id": top_cand,
                }
            )
        out[uf_key] = timeline
    return out


# ---------------------------------------------------------------------------
# Spec 020 — a série por CANDIDATURA (ADR-0046)
# ---------------------------------------------------------------------------
#
# `fetch_series_temporais`, logo acima, é a irmã AGREGADA: três séries sobre a
# corrida (margem, p_vitoria, turnout), cada uma um array só. Aqui a pergunta é
# outra — "N candidaturas × M pontos" — e ela traz três decisões que a irmã não
# precisou tomar: quantos pontos cabem (`SERIE_MAX_PONTOS`), quem entra
# (`ordenar_por_parcial`) e de que lado do relógio o último ponto fica
# (`anexar_ponto_corrente`).

#: Teto duro de pontos de uma série publicada (ADR-0046 D2).
#:
#: O teto **re-bucketiza**, nunca corta. Cortar os pontos mais antigos apagaria
#: o começo da noite — exatamente o trecho que mostra quem largou na frente
#: antes de o Norte/Nordeste apurar, um dos dois eventos que a spec 020 existe
#: para mostrar. É por isso que ele NÃO é um `LIMIT` de SQL.
SERIE_MAX_PONTOS = 120

#: Cadências admissíveis, em minutos, da menor para a maior (ADR-0046 D2).
#:
#: 5 min não é número novo no projeto: `SERIE_PASSO_MIN` no gerador de simulação
#: e `CADENCIA_MIN` na página de senador já usam o mesmo valor. É a primeira
#: cadência em que o traço tem 3,5 px por ponto na coluna de 400 px das rotas de
#: UF — abaixo dela o ponto é sub-pixel e a linha vira ruído.
SERIE_CADENCIAS_MIN: tuple[int, ...] = (5, 10, 15, 30)

#: Casas decimais dos percentuais publicados na série.
#:
#: ⚠️ **Decisão de implementação, não escrita na spec.** A coluna
#: `pct_atual`/`pct_projetado` é `numeric(8,5)` e o float em memória tem 17
#: dígitos; publicar tudo isso custaria ~12 KB por série, contra os ~9 KB da
#: grade cheia com duas casas (ADR-0046 D2) — o eixo e as 8 colunas são o payload
#: inteiro. 0,01 pp é invisível no desenho: mesmo na escala mais apertada que o
#: componente produz (10 pp de amplitude em ~180 px de altura útil) um centésimo
#: de ponto percentual vale 0,18 px. Uma casa só (0,1 pp) daria degraus de ~2 px
#: nessa mesma escala, visíveis como escada — por isso duas, e não uma.
SERIE_CASAS_DECIMAIS = 2

#: Janela lida de `projections` para montar a série, em horas.
SERIE_JANELA_HORAS = 24

#: Quantas candidaturas entram no gráfico (ADR-0046 D4, decisão do dono D-A).
SERIE_ELENCO = 4


def cadencia_para_janela(janela_min: int) -> int:
    """A MENOR cadência de {@link SERIE_CADENCIAS_MIN} que cabe no teto.

    `ceil(janela_min / cadência) <= SERIE_MAX_PONTOS` (ADR-0046 D2). "Menor que
    satisfaz" é a regra inteira: pegar sempre a maior daria uma linha grosseira
    numa noite curta, e pegar sempre a menor estouraria o teto numa longa.

    Nenhuma cadência da lista serve (janela > 60 h)? Devolve a maior e o
    `montar_serie_por_candidato` re-bucketiza o que sobrar — nunca corta. Não
    acontece em produção: a janela é nossa e vale `SERIE_JANELA_HORAS`.
    """
    for cadencia in SERIE_CADENCIAS_MIN:
        if math.ceil(janela_min / cadencia) <= SERIE_MAX_PONTOS:
            return cadencia
    return SERIE_CADENCIAS_MIN[-1]


def _momento_aware(momento: datetime) -> datetime:
    """Datetime ingênuo → UTC. Mesma convenção de `_dado_ts_para_coluna`.

    Sem isto, `datetime.timestamp()` sobre um ingênuo assume o fuso da MÁQUINA
    — e o balde de um mesmo instante mudaria conforme o servidor, o que a
    constituição § 6 proíbe.
    """
    if momento.tzinfo is None:
        return momento.replace(tzinfo=timezone.utc)
    return momento


def _balde_epoch(momento: datetime, cadencia_min: int) -> int:
    """Epoch (s) do INÍCIO do balde que contém `momento`.

    Balde derivado do **epoch**, nunca do índice do array (ADR-0046 D2): um
    ciclo perdido não desloca os pontos publicados antes dele. Mesma aritmética
    do `floor(extract(epoch …) / largura) * largura` do SQL, de propósito — é a
    mesma função nos dois lados.
    """
    largura = cadencia_min * 60
    return (int(_momento_aware(momento).timestamp()) // largura) * largura


class SeriePorCandidatoBruta(NamedTuple):
    """O material bruto da série, antes de virar payload.

    `por_escopo[uf][candidato_id][balde_epoch] = {momento, pct_atual,
    pct_projetado}`, com `uf = None` para o escopo NACIONAL — a mesma convenção
    da coluna `uf` de `projections`.

    Chaveado por balde (e não por lista) porque é isso que torna
    `anexar_ponto_corrente` uma atribuição: o ponto do ciclo corrente cai no seu
    balde e substitui o que estivesse lá, que é exatamente a regra de
    último-do-balde do ADR-0046 D2.
    """

    cadencia_min: int
    por_escopo: dict[str | None, dict[int, dict[int, dict[str, Any]]]]


#: O downsample mora no SQL, não em TypeScript (design da spec 020 § 2.2d).
#:
#: Fazê-lo na leitura pagaria o transporte inteiro para descartar 80% do outro
#: lado do CDN; o limite do store é de ESCRITA. `DISTINCT ON` + `ORDER BY …
#: DESC` = o **último** do balde, nunca a média: média suavizaria
#: descontinuidades e poderia fazer uma quantidade quase-monotônica regredir, o
#: que a regra dos três estados proíbe.
#:
#: O `balde` é calculado numa subconsulta e só então usado no `DISTINCT ON` —
#: a forma com o apelido direto depende de o parser aceitar nome de coluna de
#: saída ali, e um erro dessa consulta só apareceria em produção.
#:
#: Duas janelas no `WHERE`, e as duas são necessárias: `ts` é a coluna do índice
#: `ix_proj_serie` e limita a VARREDURA; `dado_ts` limita o EIXO. Sem a segunda,
#: um boletim do TSE travado há três dias entraria pela porta do `ts` recente e
#: esticaria o eixo para muito além da janela.
#:
#: 🔴 **O `COALESCE(dado_ts, ts)` saiu daqui por decisão do dono, 2026-09-18** —
#: das três posições em que ele estava (balde, `momento` e a janela do eixo).
#: Estava escrito no design da spec 020 (§ 2.2d, e o § 8 item 2 o chamava de
#: "carga, não defesa"); a decisão o revoga, e o documento é que fica devendo.
#:
#: O que ele fazia: linha sem hora do boletim era ancorada no relógio de
#: CÁLCULO (`projections.ts`, `defaultNow()` em `lib/db/schema.ts:169`) e virava
#: um ponto indistinguível de um ponto vindo de boletim. Medido em produção em
#: 18/09, sobre os 25 ciclos posteriores à migration 0009: 22 sem `dado_ts`;
#: das 572 linhas sem `dado_ts`, **zero** têm `pct_atual`; das 78 com `dado_ts`,
#: **todas** têm. Hora do boletim e voto medido vêm da mesma fonte — sem
#: boletim não há nem hora nem voto. Mas `pct_projetado` existe e MUDA (39
#: valores distintos naquelas 572 linhas), então a linha da projeção marchava
#: para a direita sobre ciclos em que nada chegou do TSE: exatamente o modo de
#: falha que o ADR-0038 existe para impedir, e que a docstring de
#: `EdgeSeriePorCandidato.eixo` (`lib/edge-config/types.ts`) descreve.
#:
#: ⚠️ A consequência, aceita: **toda linha anterior à 0009 tem `dado_ts` NULL e
#: some da série**, junto com os ciclos cegos. O custo é pequeno e é o mesmo
#: número acima — essas linhas não têm `pct_atual` nenhum, então só a linha da
#: PROJEÇÃO perde histórico, e é histórico de entressafra, sem voto medido.
#:
#: O `dado_ts IS NOT NULL` é redundante com a janela (`NULL > x` já é `NULL` e
#: já reprova o `WHERE`) e está escrito assim mesmo: é o filtro que a decisão
#: nomeia, e um leitor não deve ter de derivá-lo da lógica ternária do SQL.
_SERIE_POR_CANDIDATO_SQL = """
    SELECT DISTINCT ON (uf, candidato_id, balde)
           uf, candidato_id, balde, momento, pct_atual, pct_projetado
    FROM (
        SELECT
            uf,
            candidato_id,
            floor(extract(epoch FROM dado_ts) / %(largura)s)
                * %(largura)s AS balde,
            dado_ts AS momento,
            pct_atual,
            pct_projetado
        FROM projections
        WHERE cargo = %(cargo)s
          AND turno = %(turno)s
          AND dado_ts IS NOT NULL
          AND ts > NOW() - (%(janela)s || ' hours')::interval
          AND dado_ts > NOW() - (%(janela)s || ' hours')::interval
    ) AS pontos
    ORDER BY uf, candidato_id, balde, momento DESC
"""


def fetch_series_por_candidato(
    conn,
    cargo: int,
    turno: int,
    window_hours: int = SERIE_JANELA_HORAS,
) -> SeriePorCandidatoBruta:
    """Lê `projections` já bucketizada por (uf, candidato, balde) — spec 020.

    Irmã de `fetch_series_temporais`, com a mesma tolerância a falha: erro de
    consulta (coluna ausente num banco sem a 0009, `projections` vazia em
    dev/preview) vira log warn + escopos vazios. Série ausente é um estado que a
    tela sabe mostrar (`sem_serie`); derrubar o ciclo do modelo por causa de um
    eixo horizontal não é (constituição § 7).

    🔴 **Ciclo sem hora legível do TSE não vira ponto: vira buraco.** Decisão
    do dono, 2026-09-18 — ver o bloco sobre `_SERIE_POR_CANDIDATO_SQL` para o
    número que a sustenta e para a consequência (as linhas anteriores à 0009
    somem da série). Esta função é METADE da decisão: a outra é
    `anexar_ponto_corrente`, que pelo mesmo motivo deixou de ancorar o ponto do
    ciclo em `ts_iso`.

    ⚠️ **As duas metades são uma coisa só, e corrigir uma sem a outra é pior
    que não corrigir nenhuma.** A linha do ciclo cego é gravada em
    `projections` com `dado_ts` NULL de qualquer jeito (o ADR-0038 D1 proíbe a
    coluna cair para outro relógio). Se só `anexar_ponto_corrente` fosse
    corrigida, o `COALESCE` daqui traria essa mesma linha de volta no ciclo
    seguinte, no mesmo lugar errado — e a linha passaria a PISCAR: some no
    ciclo em que nasce, reaparece no seguinte.
    """
    # 🔴 A consulta bucketiza na cadência mais FINA da lista, não na cadência
    # da janela declarada. A cadência final é uma função do que a noite de fato
    # durou, e às 19h a apuração tem uma hora de vida, não vinte e quatro:
    # derivá-la de `window_hours` publicaria a noite inteira em baldes de 15
    # min, quando 5 min cabem folgados no teto. Quem decide é
    # `montar_serie_por_candidato`, que conhece o primeiro e o último ponto —
    # esta cadência é o PISO, e ela só sobe de lá para cima.
    cadencia = SERIE_CADENCIAS_MIN[0]
    params = {
        "largura": cadencia * 60,
        "cargo": int(cargo),
        "turno": int(turno),
        "janela": str(window_hours),
    }
    try:
        with conn.cursor() as cur:
            cur.execute(_SERIE_POR_CANDIDATO_SQL, params)
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — sem série é OK; sem ciclo não é
        _log("warn", "fetch_series_por_candidato failed", error=str(exc))
        return SeriePorCandidatoBruta(cadencia, {})

    por_escopo: dict[str | None, dict[int, dict[int, dict[str, Any]]]] = {}
    for uf, candidato_id, balde, momento, pct_atual, pct_projetado in rows:
        baldes = por_escopo.setdefault(uf, {}).setdefault(int(candidato_id), {})
        baldes[int(balde)] = {
            "momento": _momento_aware(momento),
            # `None` sobrevive: é "não foi medido", e o consumidor desenha um
            # furo. `0.0` seria "mediu zero voto" — um mergulho ao chão que
            # nunca aconteceu (ADR-0046 D1, regra dos três estados).
            "pct_atual": float(pct_atual) if pct_atual is not None else None,
            "pct_projetado": (
                float(pct_projetado) if pct_projetado is not None else None
            ),
        }
    return SeriePorCandidatoBruta(cadencia, por_escopo)


def _chave_parcial(candidato: Mapping[str, Any]) -> tuple[float, float, int]:
    """A chave de ordenação de `rankByParcial`, em Python.

    `pct_atual` desc → `pct_projetado` desc → `id` asc. Porte literal de
    `lib/utils/rank-parcial.ts`; qualquer mudança de critério tem de acontecer
    nos dois arquivos no mesmo commit, ou o gráfico passa a mostrar um conjunto
    de candidaturas diferente do que a tabela ranqueia logo acima dele.

    ⚠️ **Ausência (`None`) conta como 0,0 — decisão, não descuido.** No
    TypeScript o `pct_atual` de `EdgeUfCandidate` é `number`, e é
    `build_uf_payloads` que já converte `None` em `0.0` ao montar o payload que
    a tela lê. Ordenar aqui com `None` "abaixo de tudo" faria o produtor e a
    tela discordarem justamente na candidatura imputada — o tipo de divergência
    silenciosa que este porte existe para evitar. O desempate por
    `pct_projetado` (que carrega o prior pré-eleitoral) é quem separa os
    empatados em zero, exatamente como na tela.
    """
    cid = candidato.get("id")
    if cid is None:
        cid = candidato.get("candidato_id")
    return (
        -float(candidato.get("pct_atual") or 0.0),
        -float(candidato.get("pct_projetado") or 0.0),
        int(cid),
    )


def ordenar_por_parcial(
    candidatos: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Porte de `rankByParcial` (`lib/utils/rank-parcial.ts`), ADR-0046 D4.

    🔴 **NÃO é o rank que este arquivo já calcula** com
    `sorted(rows, key=lambda r: pct_projetado, reverse=True)` para achar líder e
    segundo. Aquele ordena só por `pct_projetado`, e usá-lo aqui é a mutação
    mais provável do projeto — é copiar código que já está logo ali. A
    divergência entre os dois só aparece quando apurado e projetado discordam de
    ordem: isto é, na noite da apuração, com alguém olhando o gráfico e o painel
    de resultado ao mesmo tempo, na mesma tela.
    """
    return [dict(c) for c in sorted(candidatos, key=_chave_parcial)]


def anexar_ponto_corrente(
    bruta: SeriePorCandidatoBruta,
    *,
    uf_rows: list[dict[str, Any]],
    national_rows: list[dict[str, Any]],
    dado_ts: str | None,
    ts_iso: str,
) -> SeriePorCandidatoBruta:
    """Fecha a defasagem de um ciclo entre a série e o placar ao lado (RF-169).

    ## O defeito que esta função existe para corrigir

    A série é lida de `projections` **centenas de linhas antes** de o ciclo
    corrente ser escrito lá (`fetch_series_por_candidato` roda junto das outras
    leituras; o INSERT acontece no fim). Publicada como vem do banco, ela sai um
    ciclo — 60 s — atrasada em relação ao `pct_atual` que o mesmo payload
    publica no placar logo acima do gráfico. Ninguém notou até agora porque
    nenhuma tela consumia série.

    🔴 **A correção NÃO é mover a leitura para depois do INSERT**: isso custaria
    uma segunda varredura de `projections` dentro do orçamento de 60 s do ciclo.
    É anexar o ponto a partir dos valores que já estão em memória.

    ## Duas regras que não são negociáveis aqui

    1. O `pct_atual` nacional sai de `pct_atual_nacional_por_candidato` — a
       função é **chamada**, nunca reimplementada. Recomputar a razão de somas
       aqui reabriria exatamente a divergência de quinto decimal entre o gráfico
       e o placar que a Fase 1 fechou.
    2. O instante é `dado_ts`, **e só ele**. 🔴 Decisão do dono, 2026-09-18:
       ciclo sem hora legível do TSE não vira ponto, vira buraco — `ts_iso` é o
       relógio de CÁLCULO e ancorar nele produzia um ponto visualmente
       indistinguível de um vindo de boletim. `ts_iso` continua na assinatura
       porque quem chama tem de continuar passando os dois relógios do ciclo
       (ADR-0038 D2); ele só não decide mais onde o ponto cai.

       O `COALESCE(dado_ts, ts)` que esta regra espelhava saiu de
       `_SERIE_POR_CANDIDATO_SQL` no MESMO commit — ver lá o número medido e a
       consequência. Espelho é a palavra certa: as duas metades têm de andar
       juntas, ou a linha do ciclo cego some aqui e volta pela leitura do ciclo
       seguinte, que é piscar em vez de ficar honesta.

    Devolve estrutura nova; `bruta` não é mutada.
    """
    momento = _dado_ts_para_coluna(dado_ts)
    if momento is None:
        # Este `warn` é o sinal, não o alarme. Quem conta os ciclos cegos e
        # decide se o silêncio é legítimo é `vigiar_serie_cega`, logo abaixo —
        # o orquestrador a chama ANTES desta função, sobre a mesma `bruta`.
        _log("warn", "ponto corrente sem relogio legivel — serie fica um ciclo atras")
        return bruta

    balde = _balde_epoch(momento, bruta.cadencia_min)
    por_escopo: dict[str | None, dict[int, dict[int, dict[str, Any]]]] = {
        escopo: {cid: dict(baldes) for cid, baldes in cands.items()}
        for escopo, cands in bruta.por_escopo.items()
    }

    def _pousar(
        escopo: str | None,
        candidato_id: int,
        pct_atual: float | None,
        pct_projetado: float | None,
    ) -> None:
        # Atribuição direta = regra de último-do-balde: mesmo balde do último
        # ponto ⇒ substitui; balde novo ⇒ acrescenta. O ciclo corrente é, por
        # construção, o mais recente — é ele que o payload publica ao lado.
        por_escopo.setdefault(escopo, {}).setdefault(candidato_id, {})[balde] = {
            "momento": momento,
            "pct_atual": pct_atual,
            "pct_projetado": pct_projetado,
        }

    for r in uf_rows:
        uf = r.get("uf")
        if uf is None:
            continue
        pct_atual_raw = r.get("pct_atual")
        pct_proj_raw = r.get("pct_projetado")
        _pousar(
            uf,
            int(r["candidato_id"]),
            # RAW, nunca coalescido: aqui `None` é furo na linha. O `0.0` que
            # `build_uf_payloads` escreve no payload é uma exigência do contrato
            # TS daquele campo, e não vale para este.
            float(pct_atual_raw) if pct_atual_raw is not None else None,
            float(pct_proj_raw) if pct_proj_raw is not None else None,
        )

    pct_nat, _votos_nat, _total = pct_atual_nacional_por_candidato(uf_rows)
    for r in national_rows:
        cid = int(r["candidato_id"])
        pct_proj_raw = r.get("pct_projetado")
        _pousar(
            None,
            cid,
            # `.get(cid)` SEM default: candidatura que existe no nacional e não
            # aparece em UF nenhuma fica `None`, não `0.0`.
            pct_nat.get(cid),
            float(pct_proj_raw) if pct_proj_raw is not None else None,
        )

    return SeriePorCandidatoBruta(bruta.cadencia_min, por_escopo)


# ---------------------------------------------------------------------------
# S08 § 3 — o alarme de "série parada enquanto o placar anda"
# ---------------------------------------------------------------------------
#
# O ADR-0047 D2 descarta o ciclo sem hora legível do TSE em DOIS lugares — o
# `dado_ts IS NOT NULL` de `_SERIE_POR_CANDIDATO_SQL` e o `warn` de
# `anexar_ponto_corrente` — e o próprio ADR registra, na seção de
# consequências, que **não cria alarme para isso**. Este bloco é esse alarme.
#
# 🔴 **Por que ele não é inofensivo.** Hoje é: ciclo sem hora é ciclo sem voto
# (medido em produção 18/09 — 22 de 25 ciclos sem `dado_ts`; das 13.180 linhas
# sem `dado_ts`, ZERO têm `pct_atual`). Deixa de ser no dia em que o TSE mudar
# o formato da data e `relogio_do_dado` devolver `None` sobre pares com `dg`/`hg`
# presentes e malformados (`api/model/dado_ts.py:196-209`): aí um ciclo **com
# voto** some da série enquanto o placar ao lado do gráfico continua andando, e
# a linha congela em silêncio visual.
#
# ## A decisão de projeto: onde mora o "ciclo anterior"
#
# 🔴 **Nenhuma varredura extra de `projections`.** O ciclo tem orçamento de 60 s
# e a docstring de `anexar_ponto_corrente` já recusa uma segunda varredura por
# esse motivo; um `COUNT` com o mesmo `WHERE` menos a cláusula de `dado_ts`
# resolveria o contador e custaria exatamente o que aquela decisão evitou.
#
# Três candidatos foram considerados para guardar o estado do ciclo anterior:
#
#   (a) **`pct_atual` do payload já publicado** — rejeitado. Ler de volta o
#       Edge Config é uma ida de rede nova por ciclo, e o payload publicado é
#       justamente o que este alarme suspeita estar errado: se o ponto do ciclo
#       cego nunca entrou, o payload anterior carrega a mesma cegueira.
#
#   (b) **as linhas que a leitura da série já trouxe** — ✅ ESCOLHIDO.
#       `SeriePorCandidatoBruta` já está em memória, lida na mesma rodada das
#       outras consultas, e o `pct_atual` do seu último balde é LITERALMENTE o
#       número que o leitor vê na ponta da linha do gráfico. Comparar o placar
#       deste ciclo contra ele não é uma aproximação da discrepância que
#       queremos detectar: é a discrepância, medida nos dois valores exatos que
#       apareceriam lado a lado na mesma tela. Custo: zero query, zero rede.
#
#   (c) **uma coluna que o ciclo já lê** — rejeitado, mas por pouco.
#       `fetch_series_temporais` varre `projections` sem filtro de `dado_ts` e
#       já traz `pct_apurado`; acrescentar `dado_ts` ao seu SELECT daria um
#       censo EXATO de ciclos cegos na janela de 24 h, na mesma varredura. Foi
#       recusado porque muda o tipo de retorno de uma função usada em todo o
#       payload de UF, por um ganho de precisão que o alarme não precisa — a
#       conjunção dispara na primeira divergência, não num total histórico.
#       Fica registrado como o caminho a seguir se um dia o censo for exigido.
#
# ## O que o contador consegue e o que não consegue prometer
#
# O contador vive no processo, por `(cargo, turno)`, e conta ciclos cegos
# **consecutivos** — um ciclo com hora legível o zera. Numa instância fria ele
# recomeça do zero, então ele SUBESTIMA e nunca superestima. Isso é aceitável
# porque ele não é o gatilho sozinho: o gatilho é a conjunção, e a metade que
# de fato distingue "pausa legítima do TSE" de "série cega" é o placar ter
# andado — essa metade é medida contra a série, que é estado persistido.

#: Ciclos cegos CONSECUTIVOS por `(cargo, turno)`, dentro desta instância.
_SERIE_CICLOS_CEGOS: dict[tuple[int, int], int] = {}

#: `(cargo, turno)` cuja sequência cega CORRENTE já produziu um alarme.
#:
#: Sem isto, uma noite com o parser de data quebrado produziria uma mensagem
#: por ciclo — 60 por hora, por cargo — e treinaria o leitor a ignorar o canal
#: (risco nomeado na S08). Um alarme por sequência; o `_log` continua saindo
#: em TODO ciclo cego, porque log não tem esse problema.
_SERIE_CEGA_ALARMADA: set[tuple[int, int]] = set()

#: Piso de movimento do placar, em pontos percentuais, para contar como "andou".
#:
#: 0,01 pp é a precisão em que a série é publicada
#: ({@link SERIE_CASAS_DECIMAIS}): abaixo disso os dois números arredondam para
#: o mesmo valor na tela, e não há discrepância visível para alarmar. O piso
#: também absorve o ruído de ponto flutuante da razão de somas.
SERIE_PLACAR_EPSILON_PP = 0.01


def _placar_da_serie(
    bruta: SeriePorCandidatoBruta, escopo: str | None = None
) -> dict[int, float]:
    """`pct_atual` do ÚLTIMO ponto que a série já traz, por candidatura.

    É a ponta da linha do gráfico, no escopo nacional por padrão. Candidatura
    cujo último ponto tem `pct_atual` ausente fica FORA do dicionário: `None` é
    "não foi medido", e um baseline ausente não pode sustentar a afirmação de
    que o placar cresceu (ADR-0046 D1, regra dos três estados).

    O balde é epoch do início do intervalo, então `max(baldes)` é o mais
    recente — a mesma aritmética monotônica de {@link _balde_epoch}.
    """
    ultimo: dict[int, float] = {}
    for cid, baldes in bruta.por_escopo.get(escopo, {}).items():
        if not baldes:
            continue
        ponto = baldes[max(baldes)]
        pct = ponto.get("pct_atual")
        if pct is not None:
            ultimo[int(cid)] = float(pct)
    return ultimo


def vigiar_serie_cega(
    bruta: SeriePorCandidatoBruta,
    *,
    uf_rows: list[dict[str, Any]],
    dado_ts: str | None,
    cargo: int,
    turno: int,
) -> int:
    """Conta o ciclo cego e alarma na conjunção "série parada + placar andando".

    Ver o bloco de comentário logo acima para a decisão de projeto (de onde sai
    o "ciclo anterior") e para os números medidos que sustentam o desenho.

    Chamada ANTES de `anexar_ponto_corrente`, de propósito: é a série como ela
    veio do banco — a linha que o leitor teria visto se este ciclo não
    existisse — que serve de baseline.

    🔴 **A conjunção é o produto.** Alarmar só por ciclo cego seria ruído puro:
    hoje 88% dos ciclos são cegos e estão todos certos. O que separa a pausa
    legítima do TSE (nada se move) da série cega (o placar anda, a linha não) é
    a segunda metade, e só ela.

    Best-effort como todo alarme deste arquivo (constituição § 7): `_alert_slack`
    nunca levanta, e sem `SLACK_WEBHOOK_URL` ele registra
    `"slack alert skipped"` e segue — o contador no log funciona desde já, o
    canal ganha voz quando a variável existir.

    Devolve o valor corrente do contador (0 num ciclo com hora legível), para
    quem quiser asseri-lo sem ler log.
    """
    chave = (int(cargo), int(turno))

    if _dado_ts_para_coluna(dado_ts) is not None:
        # Ciclo com hora legível: a série recebe seu ponto, a sequência cega
        # acabou. Zerar aqui é o que torna o contador uma medida de "quanto
        # tempo a linha está parada AGORA", e não um total desde o boot.
        _SERIE_CICLOS_CEGOS.pop(chave, None)
        _SERIE_CEGA_ALARMADA.discard(chave)
        return 0

    anterior = _SERIE_CICLOS_CEGOS.get(chave, 0)
    ciclos = anterior + 1
    _SERIE_CICLOS_CEGOS[chave] = ciclos

    # O placar deste ciclo, pela MESMA função que alimenta o payload e a coluna
    # `pct_atual` das linhas nacionais — nunca uma razão de somas reescrita
    # aqui (ver a docstring de `pct_atual_nacional_por_candidato`). Pura, sobre
    # linhas já em memória: nenhuma ida ao banco.
    placar_agora, _votos, _total = pct_atual_nacional_por_candidato(uf_rows)
    placar_na_serie = _placar_da_serie(bruta)

    delta_pp = {
        cid: round(pct - placar_na_serie[cid], SERIE_CASAS_DECIMAIS)
        for cid, pct in placar_agora.items()
        if cid in placar_na_serie
        and abs(pct - placar_na_serie[cid]) > SERIE_PLACAR_EPSILON_PP
    }

    # `ciclos > anterior` é verdadeiro por construção NESTA linha — e está
    # escrito assim de propósito: é a primeira metade da conjunção que a S08
    # exige, e é a condição que a mutação "remover o incremento do contador"
    # falsifica. Sem ela, aquela mutação passaria despercebida pelo alarme.
    contador_cresceu = ciclos > anterior
    placar_andou = bool(delta_pp)

    _log(
        "warn",
        "serie: ciclo descartado por dado_ts ausente",
        cargo=cargo,
        turno=turno,
        ciclos_cegos=ciclos,
        placar_andou=placar_andou,
        delta_pp=delta_pp,
        candidaturas_na_serie=len(placar_na_serie),
    )

    if contador_cresceu and placar_andou and chave not in _SERIE_CEGA_ALARMADA:
        _SERIE_CEGA_ALARMADA.add(chave)
        _log(
            "error",
            "serie parada enquanto o placar anda — o grafico congelou e o "
            "placar ao lado nao",
            cargo=cargo,
            turno=turno,
            ciclos_cegos=ciclos,
            delta_pp=delta_pp,
        )
        _alert_slack(
            "error",
            "serie parada enquanto o placar anda",
            cargo=cargo,
            turno=turno,
            ciclos_cegos=ciclos,
            delta_pp=delta_pp,
        )

    return ciclos


def _rebucketizar(
    pontos: dict[int, dict[str, Any]], cadencia_min: int
) -> dict[int, dict[str, Any]]:
    """Reagrupa pontos já bucketizados numa cadência maior, mantendo o ÚLTIMO.

    Nunca descarta o começo: baldes vizinhos se fundem, e o representante do
    balde novo é o ponto de maior `momento` entre eles — a mesma regra do
    `DISTINCT ON` do SQL, aplicada de novo.
    """
    saida: dict[int, dict[str, Any]] = {}
    for _balde, ponto in sorted(pontos.items()):
        novo = _balde_epoch(ponto["momento"], cadencia_min)
        atual = saida.get(novo)
        if atual is None or ponto["momento"] >= atual["momento"]:
            saida[novo] = ponto
    return saida


def _arredondar_pct(valor: float | None) -> float | None:
    """`None` continua `None`. Ver {@link SERIE_CASAS_DECIMAIS}."""
    if valor is None:
        return None
    return round(float(valor), SERIE_CASAS_DECIMAIS)


def _eixo_iso(epoch: int) -> str:
    """Instante do balde em ISO 8601 UTC compacto (`…T23:15:00Z`).

    ⚠️ **Decisão de implementação, não escrita na spec.** O rótulo do eixo é o
    **início do balde**, não o `dado_ts` exato do boletim que representa o
    balde. Dois motivos:

      1. Balde sem ciclo nenhum precisa existir no eixo para virar `null` na
         coluna de cada candidatura (RF-175b: o traço INTERROMPE). Um balde
         vazio não tem boletim para nomear, então o eixo tem de ser a grade.
      2. A grade regular é o que torna `eixo.length <= SERIE_MAX_PONTOS`
         verdadeiro por construção, e o que fixa o teto de bytes: o eixo é a
         string mais repetida do payload.

    A forma compacta (`Z`, 20 caracteres) em vez de `+00:00` (25) economiza
    ~600 B numa série de 120 pontos — dentro do mesmo orçamento. `new Date()`
    lê as duas, e `formatTimeHMS` converte para `America/Sao_Paulo` do mesmo
    jeito.
    """
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def montar_serie_por_candidato(
    bruta: SeriePorCandidatoBruta | None,
    uf: str | None,
    candidatos: list[dict[str, Any]],
    limite: int = SERIE_ELENCO,
) -> dict[str, Any] | None:
    """`EdgeSeriePorCandidato` de um escopo — `uf=None` é o nacional.

    `candidatos` são os do PAYLOAD daquele escopo (com `id`, `nome`, `partido`,
    `sqcand?`, `pct_atual`, `pct_projetado`), em qualquer ordem: o elenco e a
    ordem de exibição saem daqui, por `ordenar_por_parcial`.

    Forma colunar (ADR-0046 D1): um `eixo` compartilhado mais dois arrays
    paralelos por candidatura. O custo inteiro da forma antiga era a chave
    `"ts"` repetida uma vez por ponto POR candidatura, em vez de uma vez só.

    Devolve `None` — e o campo some do payload, que é opcional dos dois lados —
    quando não há escopo, elenco ou nenhum ponto. "Ainda não publico série" é um
    estado que a tela sabe nomear (`sem_serie`); um objeto vazio não é.

    ## O que este corpo NÃO faz

    Não corta pontos para caber no teto. Quando a grade passaria de
    `SERIE_MAX_PONTOS`, a cadência sobe e os baldes se fundem
    (`_rebucketizar`) — o começo da noite sobrevive. Um `LIMIT` de SQL, ou uma
    fatia dos últimos 120, apagaria justamente quem largou na frente antes de o
    Nordeste apurar.
    """
    if bruta is None:
        return None
    dados_escopo = bruta.por_escopo.get(uf)
    if not dados_escopo:
        return None

    elenco = ordenar_por_parcial(candidatos)[:limite]
    if not elenco:
        return None

    por_cand: dict[int, dict[int, dict[str, Any]]] = {}
    for c in elenco:
        cid = int(c["id"])
        por_cand[cid] = dict(dados_escopo.get(cid, {}))
    if not any(por_cand.values()):
        return None

    # Teto por re-bucketização (ADR-0046 D2). Em operação normal o laço roda uma
    # vez só: o SQL já entregou os baldes na cadência da janela. O laço existe
    # para o caso em que os dados cobrem um intervalo maior que a janela pedida
    # — e para que o teto seja verdadeiro AQUI, e não apenas por causa de um
    # `WHERE` que um teste unitário não consegue exercer.
    #
    # O ponto de partida é `cadencia_para_janela` sobre o que a noite DE FATO
    # durou — do primeiro ao último ponto medido, e não sobre a janela nominal
    # de leitura. Às 19h a apuração tem uma hora de vida: publicá-la em baldes
    # de 15 min só porque a consulta olha 24h para trás desenharia quatro pontos
    # onde cabem doze. `bruta.cadencia_min` entra como PISO — a consulta já
    # perdeu a resolução abaixo dela, e descer mais seria inventar detalhe.
    momentos = [p["momento"] for pontos in por_cand.values() for p in pontos.values()]
    span_min = math.ceil((max(momentos) - min(momentos)).total_seconds() / 60)
    piso = max(cadencia_para_janela(span_min), bruta.cadencia_min)

    cadencia = piso
    candidatas = [c for c in SERIE_CADENCIAS_MIN if c >= piso] or [piso]
    for candidata in candidatas:
        cadencia = candidata
        agrupado = {cid: _rebucketizar(p, cadencia) for cid, p in por_cand.items()}
        ocupados = sorted({b for p in agrupado.values() for b in p})
        largura = cadencia * 60
        n_pontos = (ocupados[-1] - ocupados[0]) // largura + 1
        if n_pontos <= SERIE_MAX_PONTOS:
            break

    grade = list(range(ocupados[0], ocupados[-1] + 1, largura))

    saida_candidatos: list[dict[str, Any]] = []
    for c in elenco:
        cid = int(c["id"])
        pontos = agrupado.get(cid, {})
        candidato: dict[str, Any] = {
            "id": cid,
            "nome": str(c.get("nome") or f"Candidato {cid}"),
            # A cor sai DAQUI, via `colorForParty(partido)` no consumidor. O
            # campo `cor` do payload (`var(--color-cand-{rank})`) não entra
            # nesta série e não deve ser lido a partir dela: ele é a cor por
            # rank que o ADR-0024 aposentou, e aqui ela seria visível como
            # MOVIMENTO — a linha trocando de cor no instante da ultrapassagem.
            "partido": str(c.get("partido") or "—"),
            "apurado": [
                _arredondar_pct(pontos[b]["pct_atual"]) if b in pontos else None
                for b in grade
            ],
            "projetado": [
                _arredondar_pct(pontos[b]["pct_projetado"]) if b in pontos else None
                for b in grade
            ],
        }
        sqcand = c.get("sqcand")
        if sqcand:
            candidato["sqcand"] = str(sqcand)
        saida_candidatos.append(candidato)

    return {
        "eixo": [_eixo_iso(b) for b in grade],
        # Declarada, nunca inferida pelo consumidor: o primeiro intervalo do
        # eixo pode conter um furo, e quem inferisse dele desenharia a noite
        # inteira na cadência errada por causa de um buraco no começo.
        "cadencia_min": int(cadencia),
        "candidatos": saida_candidatos,
    }


def fetch_municipio_aggregates(
    conn,
    cargo: int,
    turno: int,
) -> dict[tuple[str, int], dict[str, Any]]:
    """Agrega snapshots por **par** `(município, zona)` em totais por
    município (S04/F2, reescrito na Fase 3 do plano de 11/09).

    Retorna `{(uf, cod_municipio_tse): {pct_apurado, votos_por_candidato,
    total_votos}}` para alimentar `EdgeUfMunicipio`.

    Estratégia: pega o snapshot mais recente de cada PAR (mesma CTE de
    `fetch_snapshots`) + payload EA20 → soma `cand[].vap` (votos absolutos) e
    `votos_total` por município. O total do município é a **soma exata** dos
    pares que caem nele — sem rateio (ADR-0035 D2; § 6 não admite estimativa
    apresentada como apuração).

    ⚠️ O `LEFT JOIN zonas` SAIU. Ele existia para re-derivar o município a
    partir da zona, e era justamente o caminho do colapso: `zonas` tinha um
    município por zona, então 31,2 % dos votos caíam no município errado e
    3.392 municípios ficavam estruturalmente invisíveis no mapa
    (`docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md` § Problema
    B). Agora `cod_municipio_tse` vem **do próprio snapshot** — o par é o que
    o TSE publicou, não uma reconstrução.

    Contrato de linha PRESERVADO em aridade e ordem —
    `(uf, cod_zona, pct_apurado, votos_total, payload, cod_municipio_tse)`,
    6 colunas, `cod_municipio_tse` por último. `tests/unit/model/
    test_payload_envelope.py:326-362` monta tuplas nessa ordem.

    `pct_apurado` do município: **média ponderada pelo eleitorado do par**
    (`SUM(eleitores_aptos) GROUP BY uf, cod_municipio_tse, cod_zona`). Era
    média SIMPLES entre zonas até 11/09 — o que dava a uma zona de 2 mil
    eleitores o mesmo peso de uma de 200 mil no percentual exibido do
    município. Sem eleitorado importado (dev sem seed), ou par sem linha em
    `eleitorado`, o peso cai para 1 e o resultado degrada exatamente para a
    média simples anterior.

    Tolerante: payload sem `vap` (formato antigo) → votos = 0 (chart fica
    sem dados mas não quebra). Par sentinela (`cod_municipio_tse = 0`, alvos
    de nível `uf`/`br`) é ignorado — não é município.

    Histórico: até 2026-09-05 o JOIN era `ON z.cod_zona = r.cod_zona` sem
    `uf`, e como o número da zona repete entre UFs isso gerava fan-out de
    2.651 para 35.757 linhas (13,5x, 226 s de query) além de resolver o
    município pela UF errada. O fix da época (casar por `uf`) deixou de ser
    necessário quando o JOIN inteiro saiu.
    """
    sql = """
        WITH ranked AS (
            SELECT
                s.uf,
                s.cod_municipio_tse,
                s.cod_zona,
                s.pct_apurado,
                s.votos_total,
                s.payload,
                ROW_NUMBER() OVER (
                    PARTITION BY s.uf, s.cod_municipio_tse, s.cod_zona
                    ORDER BY s.ts DESC, s.id DESC
                ) AS rn
            FROM snapshots s
            WHERE s.cargo = %s AND s.turno = %s
        )
        SELECT r.uf, r.cod_zona, r.pct_apurado, r.votos_total, r.payload,
               r.cod_municipio_tse
        FROM ranked r
        WHERE r.rn = 1
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (cargo, turno))
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        _log("warn", "fetch_municipio_aggregates failed", error=str(exc))
        return {}

    # Peso de cada par no `pct_apurado` do município. Query própria, tolerante:
    # sem eleitorado importado o dict fica vazio e todo par pesa 1 (média
    # simples, comportamento anterior a 11/09).
    eleitorado_par = _fetch_eleitorado_por_par(conn, ano=2026)

    # Aggregate per municipio. Envolvemos o loop em try/except porque o
    # FakeCursor em testes pode devolver tuplas com aridade diferente
    # e o `unpacking` levantaria ValueError. Em produção a query sempre
    # devolve 6 colunas — captura é defensiva (degrade graceful para
    # municípios vazios).
    agg: dict[tuple[str, int], dict[str, Any]] = {}
    try:
        _iter_rows = list(rows)
    except Exception:  # noqa: BLE001
        return {}
    for row in _iter_rows:
        if len(row) != 6:
            # Cursor antigo OR fixture de teste — graciosamente ignora.
            continue
        uf, cod_zona, pct_apurado, votos_total, payload, cod_municipio_tse = row
        if cod_municipio_tse is None:
            continue
        cod_municipio_tse = int(cod_municipio_tse)
        if cod_municipio_tse == 0:
            # Sentinela de abrangência `uf`/`br` — não é município.
            continue
        key = (str(uf), cod_municipio_tse)
        bucket = agg.setdefault(
            key,
            {
                "pct_apurado_num": 0.0,
                "pct_apurado_den": 0.0,
                "votos_por_candidato": {},
                "total_votos": 0,
            },
        )
        try:
            peso = float(
                eleitorado_par.get((str(uf), cod_municipio_tse, int(cod_zona)), 0)
            )
        except (TypeError, ValueError):
            peso = 0.0
        if peso <= 0:
            peso = 1.0
        bucket["pct_apurado_num"] += (
            float(pct_apurado) if pct_apurado is not None else 0.0
        ) * peso
        bucket["pct_apurado_den"] += peso
        if votos_total is not None:
            bucket["total_votos"] += int(votos_total)

        # Extrai votos absolutos por candidato do payload EA20. EA20 real:
        # `carg[].agr[].par[].cand[].vap` = votos absolutos (apurado para o
        # candidato) — ver `_iter_cands`. `_iter_cands` normaliza envelope
        # real OU payload achatado (mesmo helper de
        # `_extract_zone_candidate_pcts`). Aceita string BR ou int. Quando
        # ausente, ignora (não quebra).
        for c in _iter_cands(payload):
            try:
                cid = int(c.get("n"))
            except (TypeError, ValueError):
                continue
            votos_f = _parse_br_number(c.get("vap"))
            if votos_f is None:
                continue
            bucket["votos_por_candidato"][cid] = (
                bucket["votos_por_candidato"].get(cid, 0) + int(votos_f)
            )

    # Finaliza `pct_apurado` como média ponderada pelo eleitorado do par
    # (peso 1 quando não há eleitorado → média simples, como antes).
    out: dict[tuple[str, int], dict[str, Any]] = {}
    for key, b in agg.items():
        den = b["pct_apurado_den"]
        out[key] = {
            "pct_apurado": b["pct_apurado_num"] / den if den > 0 else 0.0,
            "votos_por_candidato": b["votos_por_candidato"],
            "total_votos": b["total_votos"],
        }
    return out


def _pct_razao_de_somas(votos: dict[int, int], total: int) -> dict[int, float]:
    """`{candidato: 100 * votos / total}` — a razão de somas, num lugar só.

    Separada de `pct_atual_nacional_por_candidato` porque o payload nacional
    tem uma segunda fonte de votos (o fallback por município, para callers
    legados) e precisa da MESMA aritmética sobre ela. `{}` quando não há
    denominador: ausência, não zero.
    """
    if total <= 0:
        return {}
    return {cid: 100.0 * v / total for cid, v in votos.items()}


def pct_atual_nacional_por_candidato(
    uf_rows: list[dict[str, Any]],
) -> tuple[dict[int, float], dict[int, int], int]:
    """Razão de somas: Σ `votos_atuais` da candidatura ÷ Σ `votos_atuais` de todas.

    Devolve `(pct_por_candidato, votos_por_candidato, total_de_votos)`, os três
    sobre as linhas de UF (as com `uf` não-nulo e `votos_atuais` presente). O
    percentual sai em 0–100, como todo o resto da fronteira de escala.

    ## Por que é função, e não duas contas inline

    O mesmo número é usado em dois lugares: a coluna `pct_atual` das linhas
    NACIONAIS de `projections` (a base "apurado" do gráfico, spec 020) e o
    `pct_atual` de `national.candidatos[]` no payload do Edge Config (o placar
    da home). Com duas implementações, o gráfico e o placar divergiriam no
    quinto decimal e não haveria como dizer qual está certo.

    ## Por que razão de somas, e não média dos percentuais das UFs

    Porque percentual não se re-agrega. A média simples de 60% em Roraima
    (300 mil votos) com 40% em São Paulo (30 milhões) dá 50%; a resposta certa
    é ~40,2%. Só o numerador se soma — é exatamente por isso que
    `votos_atuais` virou coluna na migration 0009.

    As linhas nacionais (`uf is None`) são ignoradas de propósito: somá-las
    contaria cada voto duas vezes.
    """
    votos: dict[int, int] = {}
    total = 0
    for r in uf_rows:
        if r.get("uf") is None or r.get("votos_atuais") is None:
            continue
        cid = int(r["candidato_id"])
        va = int(r["votos_atuais"])
        votos[cid] = votos.get(cid, 0) + va
        total += va
    return _pct_razao_de_somas(votos, total), votos, total


def _dado_ts_para_coluna(dado_ts: str | None) -> datetime | None:
    """`relogio.dado_ts` (ISO 8601 **string**) → `datetime` aware, para o driver.

    ⚠️ `RelogioDoDado.dado_ts` é `str | None`, não `datetime`: o valor sai de
    `.isoformat()` em `api/model/dado_ts.py`. A conversão vive AQUI, no ponto
    único por onde as duas listas de linhas passam — nunca espalhada pelos call
    sites, que é como duas interpretações da mesma data nascem.

    `None` entra e `None` sai: o ADR-0038 D1 proíbe substituir a ausência do
    relógio do dado por qualquer outro relógio. Uma string ilegível também vira
    `None` (com warn): ela só pode vir de um bug nosso — o valor é produzido
    por `.isoformat()` sobre datetime aware — e derrubar o INSERT de
    `projections`, que é a fonte de verdade, por causa de uma coluna de eixo
    horizontal seria a troca errada.
    """
    if not dado_ts:
        return None
    try:
        momento = datetime.fromisoformat(dado_ts)
    except (TypeError, ValueError):
        _log("warn", "dado_ts ilegivel — coluna fica NULL", dado_ts=dado_ts)
        return None
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    return momento


#: Cargos cuja série histórica é persistida em `projections`.
#:
#: **Decisão do dono, 2026-09-17.** Presidente (nacional E por UF — é o dado por
#: UF que alimenta o gráfico da spec 020 nas 27 telas de estado), Governador e
#: Senador. **Deputado Federal (6) fica FORA**: são 7.791 candidaturas
#: registradas, que a 480 ciclos de uma noite dariam ~3,7 milhões de linhas —
#: nove vezes todo o resto somado (Presidente ~175k, Senador ~153k, Governador
#: ~96k). Se um dia precisar, o caminho é guardar só as candidaturas mais
#: votadas, nunca as 7.791.
#:
#: Hoje o cargo 6 tem caminho próprio (`api/model/deputado.py`) e não chega
#: aqui; esta constante existe para que ligá-lo um dia seja uma DECISÃO, e não
#: um efeito colateral. A validação de entrada aceita 1..99 de propósito (um
#: código inesperado não pode derrubar o ciclo), então a fronteira do que se
#: GRAVA precisa morar aqui, e não na borda.
CARGOS_COM_SERIE_PERSISTIDA = frozenset({1, 3, 5})


def linhas_para_projections(
    uf_rows: list[dict[str, Any]],
    national_rows: list[dict[str, Any]],
    dado_ts: str | None,
) -> list[dict[str, Any]]:
    """As duas listas prontas para `insert_projections`, com as colunas da 0009.

    ## A armadilha que esta função existe para fechar

    `national_rows` nasce em `compute_national` **sem** a chave `pct_atual` —
    o `pct_atual` nacional só é calculado depois, na montagem do payload, fora
    da transação. Um `executemany` com `%(pct_atual)s` sobre
    `uf_rows + national_rows` levanta `ProgrammingError: query parameter
    missing: pct_atual` na primeira linha nacional, derrubando a persistência
    do ciclo inteiro. Listar a coluna no INSERT sem passar por aqui é o defeito.

    Devolve **cópias**: `uf_rows`/`national_rows` seguem para
    `build_edge_payload` e `build_uf_payloads` depois do INSERT, e nenhum dos
    dois deve ver campos que apareceram por efeito colateral da persistência.

    `pct_atual`/`votos_atuais` das linhas nacionais saem de
    `pct_atual_nacional_por_candidato` — a MESMA função que o payload usa.
    Quando não há voto apurado ainda, as duas ficam `None`, nunca `0`: `NULL` é
    "não foi medido", `0` seria "mediu zero voto", e o gráfico desenharia a
    segunda como um mergulho ao chão.
    """
    momento = _dado_ts_para_coluna(dado_ts)
    pct_nat, votos_nat, _total = pct_atual_nacional_por_candidato(uf_rows)

    prontas: list[dict[str, Any]] = []
    for r in uf_rows:
        prontas.append({**r, "dado_ts": momento})
    for r in national_rows:
        cid = int(r["candidato_id"])
        prontas.append(
            {
                **r,
                "pct_atual": pct_nat.get(cid),
                "votos_atuais": votos_nat.get(cid),
                "dado_ts": momento,
            }
        )
    return prontas


def insert_projections(conn, rows: list[dict[str, Any]]) -> int:
    """INSERT em projections (append-only — constituição § 10).

    Zero ON CONFLICT, zero UPDATE — re-execução gera linhas novas com `ts`
    distinto (defaultNow no schema). `executemany` em uma transação única;
    a transação é commitada pelo caller via `with conn:`.

    ⚠️ `rows` precisa vir de `linhas_para_projections`, e não de
    `uf_rows + national_rows` cru: as três colunas da migration 0009
    (`pct_atual`, `votos_atuais`, `dado_ts`) não existem nas linhas nacionais
    como `compute_national` as produz. Ver a docstring daquela função.

    ⚠️ `pct_atual` NÃO é `pct_apurado`. A primeira é a fatia de votos da
    candidatura; a segunda é o progresso da apuração. As duas são 0–100 e são
    colunas vizinhas (migration 0009, spec 020 § 2.1).

    Retorna número de linhas inseridas (== len(rows)) para o response.
    """
    if not rows:
        return 0
    sql = """
        INSERT INTO projections (
            cargo, turno, uf, candidato_id,
            votos_projetados, pct_projetado,
            pct_projetado_lower, pct_projetado_upper,
            p_vitoria, pct_apurado,
            pct_atual, votos_atuais, dado_ts
        ) VALUES (
            %(cargo)s, %(turno)s, %(uf)s, %(candidato_id)s,
            %(votos_projetados)s, %(pct_projetado)s,
            %(pct_projetado_lower)s, %(pct_projetado_upper)s,
            %(p_vitoria)s, %(pct_apurado)s,
            %(pct_atual)s, %(votos_atuais)s, %(dado_ts)s
        )
    """
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# Compute pipeline — cola T06..T11 (RF-011..RF-018)
# ---------------------------------------------------------------------------


def _parse_br_number(raw: Any) -> float | None:
    """Converte string BR ("12,34"), string canônica ("12.34") ou número
    para `float`. `None` se ausente/inválido — nunca levanta.

    Compartilhado por `_extract_zone_candidate_pcts`,
    `_extract_zone_participacao` e `fetch_municipio_aggregates` — único
    ponto de parsing numérico BR do payload EA20 (evita 3 implementações
    ligeiramente diferentes do mesmo parser).
    """
    if raw is None:
        return None
    try:
        if isinstance(raw, str):
            return float(raw.replace(",", "."))
        return float(raw)
    except (TypeError, ValueError):
        return None


def _payload_root(payload: Any) -> dict[str, Any] | None:
    """Normaliza a raiz do payload EA20 de uma zona — envelope real 2026 OU
    achatado legado.

    Payload REAL, gravado por `app/api/ingest/route.ts` e validado por
    `lib/tse/ea20-schema.ts` (`EA20Schema`, reescrito 2026-09-05 contra os
    9 PDFs oficiais do TSE — ver `docs/reference/tse-2026-leiautes.md`), é o
    envelope EA20 completo de UMA ÚNICA abrangência (BR/UF/Município/Zona).
    **Não existe array `abr[]`** no EA20 real (confirmado: 0 ocorrências de
    "abr" como array de abrangências no documento oficial — a única premissa
    anterior, `payload["abr"][0]`, nunca foi validada contra o PDF e estava
    simplesmente errada). O envelope inteiro JÁ é a zona/UF/BR — não há nada
    para "desembrulhar" além de reconhecer o formato:
      - Candidatos vivem em `carg[].agr[].par[].cand[]` (ver `_iter_cands`).
      - Participação/seções/votos vivem nos objetos de raiz `e`, `v`, `s`
        (ver `_extract_zone_participacao`).

    Payload ACHATADO `{cand: [...]}` (sem envelope, sem `e`/`v`/`s`) segue
    aceito — é o formato usado por `tests/fixtures/replay-2022/snapshots.json`
    (replay 2022, T21) e pelos builders sintéticos de
    `tests/unit/model/test_orchestrator.py`/`test_scale.py`. O replay nunca
    passou pelo pipeline de ingestão real (não tem `carg`/`e`/`v`/`s`, só
    `cod_candidato` + `pvap` por zona) — mantido por não haver necessidade
    de portar o dataset de replay para o envelope real só para extrair
    percentuais de candidato.

    Retorna:
      - o próprio `payload` se reconhecido em qualquer um dos formatos
        (`carg` lista não-vazia OU `cand` no topo OU `e`/`v`/`s` de raiz);
      - `None` se nenhum for reconhecido (payload corrompido/inesperado) —
        caller degrada graciosamente.
    """
    if not isinstance(payload, dict):
        return None
    carg_list = payload.get("carg")
    if isinstance(carg_list, list) and carg_list:
        return payload
    if "cand" in payload:
        return payload
    if (
        isinstance(payload.get("e"), dict)
        or isinstance(payload.get("v"), dict)
        or isinstance(payload.get("s"), dict)
    ):
        return payload
    return None


def _iter_cands(payload: Any, cargo: int | None = None) -> list[dict[str, Any]]:
    """Lista de dicts de candidato do payload EA20 real ou achatado,
    enriquecidos com o partido do nível `par[]` (um nível acima do
    candidato — ver `docs/reference/tse-2026-leiautes.md` § 2, "Estrutura
    de candidatos — antes vs. depois").

    Envelope real: percorre `carg[] → agr[] → par[] → cand[]`. Cada dict de
    candidato devolvido ganha duas chaves extras (não presentes no EA20
    original): `partido_sg` (`par.sg`) e `partido_n` (`par.n`) — usadas pelo
    payload (`build_uf_payloads`/`build_edge_payload`, campo `partido`) sem
    precisar re-navegar a hierarquia. `api/model/party_mapping.py`/K-1
    3-tier (ADR-0015) — que também consumia estas chaves — foi removido
    nesta tarefa (plano `tem-um-erro-eu-velvety-sprout.md`: 2022 sai da
    projeção, K-1 deixa de existir). Payload achatado legado não tem essa
    hierarquia — as duas chaves saem como `None`.

    `cargo`: se informado, filtra `carg[]` pelo campo `cd` (comparação
    numérica tolerante a string/int). Hoje um snapshot é sempre de um único
    cargo (o parâmetro é opcional e usado por nenhum caller ainda), mas
    deixa o contrato explícito para consumidores futuros (Fase 1a) que
    eventualmente recebam um payload com mais de um `carg`.

    `[]` se payload não reconhecido, sem `carg`/`cand`, ou `cargo` pedido
    não bate com nenhum elemento de `carg[]`.
    """
    root = _payload_root(payload)
    if root is None:
        return []

    carg_list = root.get("carg")
    if isinstance(carg_list, list) and carg_list:
        out: list[dict[str, Any]] = []
        for carg in carg_list:
            if not isinstance(carg, dict):
                continue
            if cargo is not None:
                cd = carg.get("cd")
                try:
                    if cd is None or int(cd) != int(cargo):
                        continue
                except (TypeError, ValueError):
                    continue
            agr_list = carg.get("agr")
            if not isinstance(agr_list, list):
                continue
            for agr in agr_list:
                if not isinstance(agr, dict):
                    continue
                par_list = agr.get("par")
                if not isinstance(par_list, list):
                    continue
                for par in par_list:
                    if not isinstance(par, dict):
                        continue
                    cand_list = par.get("cand")
                    if not isinstance(cand_list, list):
                        continue
                    partido_sg = par.get("sg")
                    partido_n = par.get("n")
                    for c in cand_list:
                        if not isinstance(c, dict):
                            continue
                        enriched = dict(c)
                        enriched["partido_sg"] = partido_sg
                        enriched["partido_n"] = partido_n
                        out.append(enriched)
        return out

    # Payload achatado legado — sem hierarquia de partido.
    cand_list = root.get("cand")
    if not isinstance(cand_list, list):
        return []
    out = []
    for c in cand_list:
        if not isinstance(c, dict):
            continue
        enriched = dict(c)
        enriched.setdefault("partido_sg", None)
        enriched.setdefault("partido_n", None)
        out.append(enriched)
    return out


class ZonaParticipacaoRaw(TypedDict):
    """Participação/comparecimento/votação crus de uma zona/UF/BR (Fase 1a
    — turnout.py), extraídos dos objetos de raiz `e` (eleitores) e `v`
    (votos) do EA20 real (RENOMEADO 2026-09-05 — o formato anterior lia
    campos `tap/tc/ta/tvb/tvnu/tvv/psa` de `abr[0]` que nunca existiram no
    documento oficial).

    Todos os campos de contagem são `int` (arredondados do BR-string TSE);
    `psa` fica em `float` (0–100, % seções apuradas). Extraído por
    `_extract_zone_participacao` — consumido pela Fase 1a do plano
    aprovado (comparecimento vs 2022), ainda não fiado neste módulo.
    """

    eleitores_aptos: int
    eleitores_instalados: int
    comparecimento: int
    abstencao: int
    brancos: int
    nulos: int
    validos: int
    votaveis: int
    anulados: int
    sub_judice: int
    psa: float


def _extract_zone_participacao(payload: Any) -> ZonaParticipacaoRaw | None:
    """Extrai participação/comparecimento (RF futuro — turnout, Fase 1a) dos
    objetos de raiz `e`, `v`, `s` do EA20 real.

    Mapeamento (confirmado contra o dicionário oficial,
    `tse-ea20-arquivo-de-resultado-unificado.txt:1053-1406`):
      - `eleitores_aptos`      ← `e.te`    (eleitorado total da abrangência).
      - `eleitores_instalados` ← `e.esi`   (eleitorado das seções
         instaladas). **Este, não `te`, é o denominador correto de
         `comparecimento`/`abstencao` abaixo** — o próprio dicionário define
         `e.pc`/`e.pa` como "percentual ... em relação aos eleitores das
         seções instaladas", não em relação a `te` (que inclui eleitores de
         seções ainda não instaladas, inflando artificialmente a abstenção
         aparente durante apuração parcial).
      - `comparecimento`  ← `e.c`.
      - `abstencao`       ← `e.a`.
      - `brancos`         ← `v.vb`.
      - `nulos`           ← `v.tvn` (TOTAL de nulos = `v.vn` + `v.vnt` —
         não confundir com `v.vn`, que é só "nulos" stricto sensu).
      - `validos`         ← `v.vv`.
      - `votaveis`        ← `v.vvc` (votos a votáveis concorrentes — base
         "votáveis" da extrapolação de candidatos, `api/model/
         extrapolation.py`. NUNCA rotular de "válidos": `vvc` != `vv`,
         ver ADR-0018).
      - `anulados`        ← `v.van` — sem uso imediato, mas capturado porque
         o art. 265 §2º da Res. TSE 23.751/2026 exige que painéis informem
         votos válidos, sub judice e anulados.
      - `sub_judice`      ← `v.vansj` — idem.
      - `psa`             ← `s.psa`, lido DIRETO do payload (o TSE já
         calcula e publica o percentual — não precisa ser derivado de
         `s.sa`/`s.si` neste módulo).

    Campo fatal: `eleitores_aptos` (`e.te`) — é o único campo `required`
    (não-opcional) do elemento `e` no schema EA20 (`EleitoresSchema.te`),
    presente mesmo em zonas com 0% apurado. Ausente/inválido/`<= 0` → `None`
    (payload corrompido ou zona sem eleitorado — dado de participação
    não-confiável; caller deve excluir a zona — mesmo contrato usado por
    `_extract_zone_candidatos`/`extrapolation.estimate_uf_candidatos`).

    Demais campos (`eleitores_instalados`, `comparecimento`, `abstencao`,
    `brancos`, `nulos`, `validos`, `anulados`, `sub_judice`, `psa`) degradam
    para `0`/`0.0` quando ausentes — esperado antes da primeira totalização
    parcial (`e.esi`/`e.c`/`e.a` só existem "após a totalização da seção
    eleitoral", por definição do dicionário oficial) — não invalidam a zona
    inteira.
    """
    root = _payload_root(payload)
    if root is None:
        return None

    e = root.get("e")
    if not isinstance(e, dict):
        return None
    v = root.get("v") if isinstance(root.get("v"), dict) else {}
    s = root.get("s") if isinstance(root.get("s"), dict) else {}

    te = _parse_br_number(e.get("te"))
    if te is None or te <= 0:
        return None

    esi = _parse_br_number(e.get("esi")) or 0.0
    comparecimento = _parse_br_number(e.get("c")) or 0.0
    abstencao = _parse_br_number(e.get("a")) or 0.0
    brancos = _parse_br_number(v.get("vb")) or 0.0
    nulos = _parse_br_number(v.get("tvn")) or 0.0
    validos = _parse_br_number(v.get("vv")) or 0.0
    votaveis = _parse_br_number(v.get("vvc")) or 0.0
    anulados = _parse_br_number(v.get("van")) or 0.0
    sub_judice = _parse_br_number(v.get("vansj")) or 0.0
    psa = _parse_br_number(s.get("psa")) or 0.0

    return {
        "eleitores_aptos": int(round(te)),
        "eleitores_instalados": int(round(esi)),
        "comparecimento": int(round(comparecimento)),
        "abstencao": int(round(abstencao)),
        "brancos": int(round(brancos)),
        "nulos": int(round(nulos)),
        "validos": int(round(validos)),
        "votaveis": int(round(votaveis)),
        "anulados": int(round(anulados)),
        "sub_judice": int(round(sub_judice)),
        "psa": psa,
    }


class ZonaCandidatosRaw(ZonaParticipacaoRaw):
    """`ZonaParticipacaoRaw` + votos absolutos por candidato — insumo de
    `api.model.extrapolation.estimate_uf_candidatos` (regra de três,
    plano `tem-um-erro-eu-velvety-sprout.md` § A). Substitui o antigo
    `_extract_zone_candidate_pcts` (que lia `pvap`, um percentual —
    a nova projeção precisa de CONTAGENS ABSOLUTAS para escalar por
    `k = te/esi`, não de um percentual já pronto)."""

    votos: dict[int, int]


def _extract_zone_candidatos(
    payload: Any, cargo: int | None = None
) -> ZonaCandidatosRaw | None:
    """Extrai participação (`_extract_zone_participacao`) + votos absolutos
    por candidato (`cand[].vap`) do payload EA20 de uma zona.

    `vap` — "quantidade de votos computados para o candidato" (dicionário
    oficial) — é a contagem ABSOLUTA, ao contrário de `pvap` (percentual
    sobre `vvc`, usado pelo pipeline de swing pré-Fase-1 e agora
    aposentado). A nova projeção (regra de três, `api/model/
    extrapolation.py`) precisa da contagem bruta para poder escalar por
    `k(z) = te/esi` — um percentual já pronto não pode ser "re-escalado".

    Zona sem participação válida (`_extract_zone_participacao` retornou
    `None` — tipicamente `eleitores_aptos <= 0`, campo fatal do EA20)
    também não tem candidatos: retorna `None` (mesmo contrato de
    `_extract_zone_participacao` — fail-safe, zona inteira é excluída
    pelo caller).

    Payload achatado legado `{cand: [...]}` (replay 2022 / fixtures
    sintéticas antigas) é aceito por `_iter_cands`, mas SEM `e`/`v`/`s`
    de raiz não tem participação — `_extract_zone_participacao` devolve
    `None` e esta função também devolve `None`. Isso é uma mudança de
    comportamento deliberada vs. o pipeline de swing anterior (que só
    precisava de `pvap`): o formato achatado não carrega o suficiente
    para a regra de três (ver plano § "Replay", Fase 5 pendente).
    """
    participacao = _extract_zone_participacao(payload)
    if participacao is None:
        return None

    votos: dict[int, int] = {}
    for c in _iter_cands(payload, cargo=cargo):
        try:
            cod = int(c.get("n"))
        except (TypeError, ValueError):
            continue
        vap = _parse_br_number(c.get("vap"))
        if vap is None:
            continue
        votos[cod] = int(round(vap))

    return {**participacao, "votos": votos}  # type: ignore[typeddict-item]


def _extract_zone_candidate_pcts(
    payload: Any, cargo: int | None = None
) -> dict[int, float]:
    """Extrai `{cod_candidato: pct_vvc}` (fração) do payload EA20 de uma
    zona via `cand[].pvap`.

    MANTIDO (decisão desta tarefa — plano `tem-um-erro-eu-velvety-
    sprout.md` § B pedia a remoção total, mas `tests/unit/model/
    test_payload_envelope.py`, na lista de testes que devem passar SEM
    alteração, importa e fixa o contrato desta função diretamente).
    NENHUM caller do pipeline de projeção usa mais este helper — a
    extrapolação por regra de três (`api/model/extrapolation.py`) lê
    `cand[].vap` (contagem absoluta) via `_extract_zone_candidatos`, não
    `pvap` (percentual). Este helper fica como utilitário standalone,
    sem uso na projeção de candidatos.

    `pvap` — "percentual de votos computados atribuídos ao candidato em
    relação aos votos a votáveis concorrentes" (`v.vvc`), vem como string
    BR-decimal (vírgula) — convertida para fração [0,1].

    Payload achatado legado `{cand: [...]}` (replay 2022 / fixtures
    sintéticas) também é aceito via `_iter_cands`. Tolerante: se o
    payload vier em outro formato inesperado, retorna `{}`.
    """
    out: dict[int, float] = {}
    for c in _iter_cands(payload, cargo=cargo):
        try:
            cod = int(c.get("n"))
        except (TypeError, ValueError):
            continue
        pct = _parse_br_number(c.get("pvap"))
        if pct is None:
            continue
        out[cod] = pct / 100.0
    return out


def _frac_to_pct(x: float) -> float:
    """Converte fração [0,1] (espaço do bootstrap/T06-T11) para percentual
    0–100 (espaço de `rows`/`projections`/payload Edge — `lib/edge-config/
    types.ts`, `docs/architecture/data-model.md` § "Escala de percentuais").

    Arredonda em 5 casas — mesma precisão de `NUMERIC(8,5)` na coluna
    `projections.pct_projetado` (evita ruído de float além da precisão
    persistida).
    """
    return round(100.0 * x, 5)


def _uf_projection_row(
    cargo: int,
    turno: int,
    uf: str,
    cand: int,
    cand_est: CandidatoEstimate,
    pct_apurado_uf: float,
    est: UfCandidatosEstimate,
    metodo_tipo: str = "extrapolacao_apurado",
    granularidade: Granularidade = "zona",
) -> dict[str, Any]:
    """Monta a linha `(uf, candidato)` a partir de `CandidatoEstimate`
    (regra de três, `api/model/extrapolation.py`) — usada tanto pelo
    caminho normal (`estimate_uf_candidatos`) quanto pela imputação
    nacional (`impute_uf_from_national`, RF-017 2o nível).

    `pct_projetado*`/`pct_atual` já chegam em PERCENTUAL 0-100
    (`CandidatoEstimate` segue a convenção de `_frac_to_pct`) — mesma
    fronteira de escala de `insert_projections`/`build_uf_payloads`/
    `build_edge_payload`.
    """
    return {
        "cargo": cargo,
        "turno": turno,
        "uf": uf,
        "candidato_id": cand,
        "votos_projetados": int(cand_est["votos_projetados"]),
        "votos_atuais": int(cand_est["votos_atuais"]),
        "pct_atual": cand_est["pct_atual_votaveis"],
        "pct_projetado": cand_est["pct_projetado_votaveis"],
        "pct_projetado_lower": cand_est["lower_votaveis"],
        "pct_projetado_upper": cand_est["upper_votaveis"],
        "p_vitoria": None,
        "pct_apurado": float(pct_apurado_uf),
        "comparecimento": {
            "pct_atual": cand_est["pct_atual_comparecimento"],
            "pct_projetado": cand_est["pct_projetado_comparecimento"],
            "lower": cand_est["lower_comparecimento"],
            "upper": cand_est["upper_comparecimento"],
        },
        "metodo": {
            "tipo": metodo_tipo,
            "n_zonas": est["n_zonas"],
            "n_zonas_imputadas": est["n_zonas_imputadas"],
            # RF-102 (spec 016) — a unidade em que a regra de três foi
            # aplicada. Não é detalhe interno: é a diferença que a tela precisa
            # declarar ao leitor (RF-108), porque uma projeção feita sobre um
            # único boletim agregado da UF não tem a mesma natureza da que
            # agrega ~98 zonas independentes.
            #
            # ⚠️ Corrigido em 2026-09-13. Este comentário afirmava `"uf"` para
            # "Senador e Deputado Federal, que o ADR-0026 item 1 ingere por UF
            # (27 GETs por ciclo)". Os dois saíram: Senador em 11/09 (nota "(b)"
            # do ADR-0026) e Deputado no ADR-0036 (13/09) — hoje os quatro
            # cargos são `"zona"` por padrão, e `"uf"` só aparece sob os
            # interruptores. E o cargo 6 nem chega nesta função: ver a docstring
            # de `compute_uf_projections` logo abaixo.
            "granularidade": granularidade,
        },
    }


def _eleitorado_total_by_uf(
    eleitorado: dict[tuple[str, int], int],
) -> dict[str, int]:
    """Σ eleitores aptos por UF a partir do dict `(uf, cod_zona) -> aptos`
    (`fetch_eleitorado`). Reusado por `compute_uf_projections`/
    `compute_participacao`/`_resolve_zone_weight` — um único lugar que
    faz essa soma (evita 3 implementações levemente diferentes)."""
    out: dict[str, int] = {}
    for (uf, _z), aptos in eleitorado.items():
        out[uf] = out.get(uf, 0) + aptos
    return out


NIVEL_ZONA = "zona"
NIVEL_UF = "uf"
NIVEL_BR = "br"
NIVEIS_AGREGADOS = (NIVEL_UF, NIVEL_BR)


def nivel_do_snapshot(s: Mapping[str, Any]) -> str:
    """Nível de abrangência de uma linha de `snapshots`, normalizado.

    Ponto ÚNICO de leitura da coluna `nivel` (spec 021 / decisão do dono de
    2026-09-26, que passou a ingerir o agregado do TSE **junto com** as
    zonas). Antes dessa coluna, o único sinal era o sentinela `cod_zona = 0`,
    e ele é ambíguo: a mesma linha `(uf, 0, 0)` pode ser o agregado ADITIVO
    (que alimenta `votacao`) ou a granularidade `uf` inteira do modo de
    diagnóstico `TSE_GRANULARIDADE=uf` (que alimenta o MODELO). Adivinhar
    pelo sentinela confundiria os dois.

    🔴 **Ausente/NULL ⇒ `"zona"`, e isso é deliberado.** Toda linha gravada
    antes da migration não tem a coluna, e toda ela é de zona — as fixtures
    de teste e os builders sintéticos também não a têm. O default preserva o
    comportamento anterior bit a bit; o desvio para `votacao` só acontece
    quando a ingestão nova grava `nivel` EXPLICITAMENTE.
    """
    raw = s.get("nivel")
    if raw is None:
        return NIVEL_ZONA
    texto = str(raw).strip().lower()
    return texto if texto in (NIVEL_ZONA, NIVEL_UF, NIVEL_BR) else NIVEL_ZONA


def particionar_por_nivel(
    snapshots: list[LatestSnapshot],
) -> tuple[list[LatestSnapshot], list[LatestSnapshot]]:
    """Separa `(zonas, agregados)` — a fronteira entre o que alimenta o
    MODELO e o que alimenta o bloco `votacao` (spec 021, RF-199).

    🔴 **Por que esta separação é a coisa mais perigosa desta spec.** O
    agregado do TSE chega com `cod_zona = 0`. Sem separá-lo, ele entra na
    lista de zonas da UF como uma "zona" do tamanho do estado inteiro, e
    `compute_uf_projections` passa a contar cada voto DUAS vezes — uma pelas
    zonas reais, outra pelo agregado que as resume.

    E o modo de falha pior não é a dupla contagem, é o oposto:
    `_discard_zero_zona_sentinel_when_real_zonas_exist` escolhe entre a
    família `cod_zona = 0` e a família de zonas reais **por frescor**, com o
    empate favorecendo a sentinela. O agregado é buscado no MESMO ciclo que
    as zonas, então seu `ts` é ≥ o delas com facilidade — e nesse instante
    **todas as zonas reais da UF são descartadas** e o modelo projeta o
    estado a partir de uma única linha. Silenciosamente: sem erro, sem
    alerta, só um número plausível e errado.

    Por isso a partição é por `nivel` (fato declarado na ingestão) e roda
    ANTES do descarte por sentinela, que passa a ver só zonas.

    Esta função é **pura**: parte a lista e nada mais. A válvula de
    degradação para o modo `uf` mora em `zonas_para_o_modelo`, separada de
    propósito — misturar as duas aqui fez, na primeira versão, a lista de
    agregados voltar duplicada.
    """
    zonas: list[LatestSnapshot] = []
    agregados: list[LatestSnapshot] = []
    for s in snapshots:
        if nivel_do_snapshot(s) in NIVEIS_AGREGADOS:
            agregados.append(s)
        else:
            zonas.append(s)
    return zonas, agregados


def zonas_para_o_modelo(
    zonas: list[LatestSnapshot],
    agregados: list[LatestSnapshot],
) -> list[LatestSnapshot]:
    """O que o MODELO consome, com a válvula do modo `uf`.

    Normalmente devolve `zonas` intocado. Se não houver zona NENHUMA e
    houver agregado, devolve os agregados: é exatamente o que o modo de
    diagnóstico `TSE_GRANULARIDADE=uf` espera — ele grava uma linha
    `(uf, 0, 0)` por UF e conta que o modelo a consuma como se fosse uma
    zona do tamanho do estado (ver `compute_uf_projections`, § granularidade).

    Sem esta válvula, ligar o interruptor de diagnóstico **cegaria** o
    modelo por completo (zero zonas ⇒ zero projeção) em vez de degradá-lo
    como hoje. É a lição da "rede de segurança de mão única": a guarda nova
    tornou alcançável a direção inversa que ninguém tinha considerado.

    O caso é logado em `warn` porque em produção é anômalo — a
    granularidade padrão dos 4 cargos é `zona` e `TSE_GRANULARIDADE` é
    proibida no dia D (`scripts/vigia-armado.ts`).
    """
    if zonas or not agregados:
        return zonas
    ufs_agregadas = {str(s.get("uf") or "").strip().upper() for s in agregados}
    _log(
        "warn",
        "nenhum snapshot de nivel=zona; agregados tratados como zonas "
        "(modo granularidade=uf?)",
        n_agregados=len(agregados),
        ufs=sorted(u for u in ufs_agregadas if u),
    )
    return agregados


def _snapshots_por_uf(
    snapshots: list[LatestSnapshot],
) -> dict[str, list[LatestSnapshot]]:
    """Agrupa snapshots por sigla de UF, **descartando `BR` e UF vazia**.

    🔴 Ponto ÚNICO desse agrupamento para o modelo. Antes da spec 021,
    `compute_uf_projections` e `compute_participacao` faziam
    `snaps_by_uf.setdefault(s["uf"], []).append(s)` cru, sem filtro — e uma
    linha `uf = "BR"` entrava como **28ª unidade federativa**, com peso de
    eleitorado inexistente, dentro da agregação nacional. Era inofensivo
    só porque nada produzia linha `BR`; a decisão do dono de 2026-09-26
    (ingerir o agregado nacional do TSE) é exatamente o que passa a
    produzi-la.

    O cargo 6 (`_do_project_proporcional`) e `api/model/dado_ts.py` já
    filtravam `"BR"` cada um por conta própria — este helper existe para
    que o caminho majoritário (cargos 1/3/5) não fique sendo o único
    desprotegido, e para que a regra viva em UM lugar.

    ⚠️ É a SEGUNDA guarda, não a primeira: `particionar_por_nivel` já
    deveria ter desviado o agregado nacional antes daqui. As duas são de
    propósito — uma rede que só funciona numa direção não é rede
    (`nivel` errado/ausente numa linha `BR` cairia direto no modelo).
    """
    out: dict[str, list[LatestSnapshot]] = {}
    for s in snapshots:
        sigla = str(s.get("uf") or "").strip().upper()
        if not sigla or sigla == "BR":
            continue
        out.setdefault(sigla, []).append(s)
    return out


def _resolve_zone_weight(
    uf: str,
    cod_zona: int,
    eleitorado: dict[tuple[str, int], int],
    eleitorado_total_by_uf: dict[str, int],
) -> int:
    """Peso (eleitores aptos 2026, RF-008) de uma zona para agregação.

    `cod_zona == 0` é o SENTINELA de ingestão em nível `uf`
    (`lib/tse/targets.ts:410`); a tabela `eleitorado` só tem linhas por
    zona REAL, nunca `(uf, 0)` — sem este fallback, a zona-sentinela
    pesaria sempre 0 e seria descartada em silêncio, quebrando o modo
    `uf` em produção (achado urgente do plano `tem-um-erro-eu-velvety-
    sprout.md`). Quando `cod_zona == 0`, usa o eleitorado TOTAL da UF em
    vez do lookup por zona.
    """
    if cod_zona == 0:
        return eleitorado_total_by_uf.get(uf, 0)
    return eleitorado.get((uf, cod_zona), 0)


# Mínimo de zonas para estratificar uma UF. Abaixo disso, três estratos
# repartiriam pouquíssimas zonas e trocariam viés de composição por
# variância — o remédio pior que a doença. Em 2026-09-06 as UFs abaixo do
# limiar são RR (8 zonas), AC (9), ZT (10) e AP (10); a seguinte, SE, tem 29.
_MIN_ZONAS_PARA_ESTRATIFICAR = 12

# Número de estratos (tercis de `te`). Três é o maior número que ainda deixa
# ≥ 4 zonas por estrato na menor UF elegível.
_N_ESTRATOS = 3


def _compute_estratos_por_uf(
    uf: str,
    eleitorado: dict[tuple[str, int], int],
) -> tuple[dict[int, int] | None, dict[int, float] | None]:
    """Pós-estratificação por porte: tercis de `te` sobre TODAS as zonas da UF.

    O ponto inteiro da estratificação está em usar `eleitorado` — que conhece
    **todas** as zonas — e não os snapshots, que só conhecem as que já
    reportaram. É isso que fixa o peso de cada estrato *a priori* e neutraliza
    o viés de composição: as zonas grandes chegam primeiro, mas o peso do
    estrato "grande" não cresce por causa disso (achado do replay 2022
    regenerado, 2026-09-06 — MAE@1h de 3,2pp concentrado em UFs com apuração
    parcial e composição enviesada).

    Devolve `(None, None)` quando a UF não é elegível — o caller então chama
    `estimate_uf_candidatos` sem os parâmetros e o caminho original roda
    byte-a-byte idêntico (nenhum sorteio extra é consumido do RNG, § 6).
    """
    zonas_da_uf = [
        (cod_zona, aptos)
        for (u, cod_zona), aptos in eleitorado.items()
        if u == uf and cod_zona != 0 and aptos > 0
    ]
    if len(zonas_da_uf) < _MIN_ZONAS_PARA_ESTRATIFICAR:
        return None, None

    # Ordena por porte e corta em tercis por CONTAGEM de zonas (não por soma
    # de eleitores): estratos com número parecido de zonas mantêm o bootstrap
    # por estrato estável. Empate de `te` resolve por `cod_zona` para que a
    # atribuição seja determinística (§ 6).
    zonas_da_uf.sort(key=lambda t: (t[1], t[0]))
    n = len(zonas_da_uf)
    estrato_by_cod_zona: dict[int, int] = {}
    te_total_by_estrato: dict[int, float] = {}
    for pos, (cod_zona, aptos) in enumerate(zonas_da_uf):
        k = min(pos * _N_ESTRATOS // n, _N_ESTRATOS - 1)
        estrato_by_cod_zona[cod_zona] = k
        te_total_by_estrato[k] = te_total_by_estrato.get(k, 0.0) + float(aptos)
    return estrato_by_cod_zona, te_total_by_estrato


def compute_uf_projections(
    cargo: int,
    turno: int,
    seed_base: int,
    snapshots: list[LatestSnapshot],
    eleitorado: dict[tuple[str, int], int],
) -> tuple[
    list[dict[str, Any]],
    dict[str, dict[int, np.ndarray]],
    dict[str, dict[int, np.ndarray]],
    dict[str, UfCandidatosEstimate],
]:
    """Projeta candidatos por UF via regra de três + bootstrap de zonas
    (`api.model.extrapolation`) — RF-011/012/013. SEM 2022 (decisão E1 do
    plano `tem-um-erro-eu-velvety-sprout.md`): a assinatura não recebe
    `historical` — a projeção nasce inteiramente do que a própria zona já
    apurou no ciclo 2026.

    Retorna tupla:
        - `rows`: lista pronta para `insert_projections` (uma linha por
          uf x candidato com votos/pct/CI/metodo).
        - `estimates_by_uf`: `{uf: {cod_candidato: ndarray}}` BASE
          VOTÁVEIS (fração [0,1], pareado) — contrato estável consumido
          por `compute_national`/`p_vitoria`/`compute_p_passa_2t`/
          `compute_p_fecha_1t`/`compute_two_round_scenarios`/
          `compute_outros_estimates` (NENHUMA dessas funções muda).
        - `estimates_c_by_uf`: idem, BASE COMPARECIMENTO — só alimenta o
          payload (E2/E2b), não entra no cálculo de `p_vitoria`.
        - `cand_by_uf`: `{uf: UfCandidatosEstimate}` — resultado bruto
          por UF (inclui `n_zonas`/`n_zonas_imputadas`/bases projetadas),
          reusado por `build_uf_payloads` para "Outros" na 2a base.

    Estratégia de seed (constituição § 6): UM bootstrap por UF (não mais
    um por candidato — ver `extrapolation.estimate_uf_candidatos`), seed
    `seed_base XOR hash(f"{uf}:candidatos")`.

    E3 hierárquico (RF-013/017): UF sem NENHUMA zona apurada —
      - cargo 1 (presidente): 2a passada abaixo usa
        `impute_uf_from_national` (a UF assume a proporção nacional já
        calculada a partir das UFs com dado, CI +-10pp).
      - cargo 3 (governador): não existe "nacional" por corrida estadual
        — a UF fica OMITIDA de `rows`/`estimates_by_uf` ("aguardando
        projeção" na UI).
      - cargo 5 (senador): MESMA omissão do governador, e por um motivo
        adicional e mais forte (RF-102, spec 016): a composição partidária
        do Senado varia demais entre estados para que a proporção nacional
        signifique alguma coisa num estado específico. Imputar ali não
        seria uma estimativa fraca — seria uma afirmação sobre um estado
        feita a partir de dado de outros 26. A UF sai `aguardando`.

    Granularidade (RF-102): o `k = te/esi` é sempre o da UNIDADE INGERIDA.
    Esta função só é chamada para cargos MAJORITÁRIOS (1, 3, 5) — o cargo 6
    (proporcional) nunca chega aqui, ele segue por `_do_project_proporcional`
    desde a guarda em `_do_project` (`_e_proporcional`). Por padrão, desde
    2026-09-13, os três cargos majoritários ingerem em zona (~6.110 pares por
    ciclo, somados de volta a zonas por `merge_pairs_into_zonas`). A unidade
    só vira a UF inteira quando um interruptor de emergência reverte um cargo
    específico a `uf` (`TSE_GRANULARIDADE`/`TSE_DEPUTADO_GRANULARIDADE`,
    `lib/tse/targets.ts::getGranularidade`) — o TSE publica um único EA20 por
    UF nesse modo, e `lib/tse/targets.ts` grava a linha com o sentinela
    `cod_zona = 0`, que `_resolve_zone_weight` pesa pelo eleitorado total da
    UF. Nenhum código especial é preciso para isso: a mesma função roda com
    UMA "zona" que é a UF. O que muda é o rótulo — `metodo.granularidade` —
    e a consequência estatística, documentada em `_uf_projection_row`.
    """
    granularidade = cargo_granularidade(int(cargo))
    # Spec 022 RF-210 — a base "comparecimento" dos candidatos (e o
    # brancos/nulos da Fase 5, que sai do MESMO bootstrap) em VOTOS: no
    # Senado de 2026 cada eleitor deposita 2. A base "votáveis" — a de
    # `p_vitoria`/`p_eleito`/`votos_projetados` — não depende do fator.
    vpe_cargo = _votos_por_eleitor_ou_none(cargo, "compute_uf_projections")
    # ⚠️ Cargo sem fator declarado (só os sintéticos do harness, 91–93: os
    # quatro cargos reais o declaram) segue com a base em pessoas, como antes
    # desta mudança. Não publica número errado por isso: o brancos/nulos que
    # sai deste bootstrap é DESCARTADO por `compute_participacao` para o mesmo
    # cargo (o `vpe is None` de lá), e o aviso acima fica no log.
    vpe_bootstrap = vpe_cargo if vpe_cargo is not None else 1
    # `_snapshots_por_uf` (não `setdefault` cru): descarta `BR`/UF vazia —
    # ver a docstring dele para o porquê de a linha nacional ser perigosa aqui.
    snaps_by_uf = _snapshots_por_uf(snapshots)

    eleitorado_total_by_uf = _eleitorado_total_by_uf(eleitorado)

    rows: list[dict[str, Any]] = []
    estimates_by_uf: dict[str, dict[int, np.ndarray]] = {}
    estimates_c_by_uf: dict[str, dict[int, np.ndarray]] = {}
    cand_by_uf: dict[str, UfCandidatosEstimate] = {}
    pending_national_fallback: list[str] = []

    for uf, snaps in snaps_by_uf.items():
        zonas: list[ZonaCandidatos] = []
        pct_num = 0.0
        for s in snaps:
            cod_zona = s["cod_zona"]
            w = _resolve_zone_weight(uf, cod_zona, eleitorado, eleitorado_total_by_uf)
            if w > 0:
                pct_num += s["pct_apurado"] * w
            raw = _extract_zone_candidatos(s["payload"])
            if raw is None:
                continue
            zona: ZonaCandidatos = {**raw, "cod_zona": cod_zona, "weight": w}  # type: ignore[typeddict-item]
            zonas.append(zona)
        # Denominador é o eleitorado TOTAL da UF (todas as zonas
        # conhecidas via `eleitorado`), não a soma dos pesos das zonas
        # PRESENTES no snapshot. Zonas ausentes (404 "sem dados ainda",
        # `app/api/ingest/route.ts`) apuraram 0% — contribuem 0 ao
        # numerador e nada ao denominador antigo, o que inflava
        # `uf_pct_apurado` para perto de 100% assim que qualquer zona
        # pequena fechasse (achado: no replay 2022 fixado (t=1h), TO
        # mostrava 100% apurado quando o real era ~52%; PI 93% vs ~37%
        # real — ver model-validator, 2026-09-06). NOTA: essa métrica só
        # alimenta RF-018 (limiar binário <5%) e o rótulo exibido ao
        # leitor — NÃO alimenta o ponto projetado (`estimate_uf_
        # candidatos` usa razão de somas das zonas efetivamente apuradas,
        # independente de `uf_pct_apurado`). Corrigir este denominador
        # não move MAE@1h nem cobertura IC95@1h no replay atual porque
        # nenhuma UF cruza o limiar de 5% nesse timestep mesmo com o
        # valor correto — o driver da falha de OT-4 é viés de composição
        # (zonas maiores apuram primeiro), não este bug.
        pct_den = eleitorado_total_by_uf.get(uf, 0)
        uf_pct_apurado = pct_num / pct_den if pct_den > 0 else 0.0

        local_seed = (
            seed_base
            ^ int(
                hashlib.sha256(f"{uf}:candidatos".encode("utf-8")).hexdigest()[:8],
                16,
            )
        ) & 0xFFFFFFFF

        estrato_by_cod_zona, te_total_by_estrato = _compute_estratos_por_uf(
            uf, eleitorado
        )
        est = estimate_uf_candidatos(
            zonas,
            uf_pct_apurado,
            local_seed,
            estrato_by_cod_zona=estrato_by_cod_zona,
            te_total_by_estrato=te_total_by_estrato,
            votos_por_eleitor=vpe_bootstrap,
        )
        if est is None:
            if int(cargo) == 1:
                # RF-017 2o nível — resolvido na 2a passada abaixo, depois
                # que o nacional das UFs COM dado estiver disponível.
                pending_national_fallback.append(uf)
            # Cargo 3 (governador): sem "nacional" para ancorar — a UF
            # fica de fora ("aguardando projeção").
            continue

        cand_by_uf[uf] = est
        estimates_by_uf[uf] = {
            cod: c["estimates_votaveis"] for cod, c in est["por_candidato"].items()
        }
        estimates_c_by_uf[uf] = {
            cod: c["estimates_comparecimento"]
            for cod, c in est["por_candidato"].items()
        }
        for cod, cand_est in est["por_candidato"].items():
            rows.append(
                _uf_projection_row(
                    cargo,
                    turno,
                    uf,
                    cod,
                    cand_est,
                    uf_pct_apurado,
                    est,
                    granularidade=granularidade,
                )
            )

    if pending_national_fallback and int(cargo) == 1 and estimates_by_uf:
        national_estimates = aggregate_national_estimates(
            estimates_by_uf, eleitorado_total_by_uf
        )
        national_point = {
            cod: float(np.mean(arr)) for cod, arr in national_estimates.items()
        }

        total_base_votaveis_br = sum(
            e["base_votaveis_projetada"] for e in cand_by_uf.values()
        )
        total_eleitorado_computed = sum(
            eleitorado_total_by_uf.get(u, 0) for u in cand_by_uf
        )
        r_v_br = (
            total_base_votaveis_br / total_eleitorado_computed
            if total_eleitorado_computed > 0
            else 0.0
        )

        for uf in pending_national_fallback:
            w_uf = eleitorado_total_by_uf.get(uf, 0)
            est = impute_uf_from_national(
                national_estimates, national_point, w_uf, r_v_br
            )
            cand_by_uf[uf] = est
            estimates_by_uf[uf] = {
                cod: c["estimates_votaveis"]
                for cod, c in est["por_candidato"].items()
            }
            estimates_c_by_uf[uf] = {
                cod: c["estimates_comparecimento"]
                for cod, c in est["por_candidato"].items()
            }
            for cod, cand_est in est["por_candidato"].items():
                rows.append(
                    _uf_projection_row(
                        cargo,
                        turno,
                        uf,
                        cod,
                        cand_est,
                        0.0,
                        est,
                        metodo_tipo="imputado_nacional",
                        granularidade=granularidade,
                    )
                )

    return rows, estimates_by_uf, estimates_c_by_uf, cand_by_uf


# Surrogate de `historical_results.cod_candidato`, definido em
# `data-pipeline/historical-import.ts::surrogateCandidatoId`:
#
#     cod_candidato = cargo*1_000_000 + ano*1000 + turno*100 + nr_partido
#
# O CSV aberto do TSE (`votacao_partido_munzona`) não traz número de
# candidato — traz `NR_PARTIDO`. Para Presidente e Governador o número de
# urna É o número do partido (13, 22, 12...), que é justamente o `n` que o
# EA20 2026 devolve em `cand[].n` e que vira `candidato_id` nas nossas
# linhas. É essa coincidência — e só ela — que torna a E1 computável sem
# uma tabela de-para.
_SURROGATE_ANO_2022 = 2022


def _nr_partido_2022(cod_candidato: int, cargo: int, turno: int) -> int | None:
    """Extrai `nr_partido` do surrogate de 2022, ou `None` se a linha não
    tiver o formato do surrogate.

    A guarda de formato não é paranoia decorativa: se um dia o importador
    passar a gravar o `SQ_CANDIDATO` real (11 dígitos) em `cod_candidato`,
    um `cod % 100` cego devolveria dois dígitos arbitrários que PODEM
    casar com o número de urna de algum candidato de 2026 — e o site
    publicaria um swing calculado contra o partido errado, sem nenhum
    sinal de erro. Preferimos perder a comparação (sai `None`, a UI já
    mostra "—") a publicar um número falso: constituição § 1/§ 8.
    """
    nr = cod_candidato % 100
    esperado = (
        int(cargo) * 1_000_000
        + _SURROGATE_ANO_2022 * 1000
        + int(turno) * 100
        + nr
    )
    if esperado != cod_candidato:
        return None
    return nr


# Cargos em que o número de urna coincide com o número do partido — e,
# portanto, em que a chave de 2022 é comparável com o `candidato_id` de
# 2026. Senador tem número de 3 dígitos (partido + sequencial) e Deputado
# idem; além disso o Senado renova 1/3 em 2022 contra 2/3 em 2026, o que
# torna a comparação sem sentido mesmo se a chave casasse. Os dois nem
# chegam aqui na prática (`historical_results` só foi importado para os
# cargos 1 e 3), mas a lista deixa a razão escrita.
_CARGOS_COM_SWING_2022 = frozenset({1, 3})


def compute_swing_descritivo(
    uf_rows: list[dict[str, Any]],
    historical: list[HistoricalRow],
) -> dict[str, float | None]:
    """E1 do plano § B (Fase 5) — swing DESCRITIVO de cada UF vs 2022.

        swing(U) = pct_atual_votaveis(líder de U, 2026)
                   − 100 * votos_2022(n do líder, U) / Σ_n votos_2022(n, U)

    Em PONTOS PERCENTUAIS, positivo quando o líder atual está melhor do
    que o partido dele estava em 2022 naquela UF.

    🔴 Isto NÃO é projeção (constituição § 1). Os dois termos são fatos
    OBSERVADOS: o percentual que o líder tem no que já foi apurado hoje, e
    o percentual que o mesmo número de urna teve em 2022. Nenhum bootstrap,
    nenhum `pct_projetado`, nenhuma extrapolação entra aqui — usar
    `pct_projetado` transformaria metade da subtração em estimativa e a
    frase "mudou X pontos desde 2022" deixaria de ser verdadeira.

    "Líder" é o líder do APURADO (maior `pct_atual`), não o líder da
    projeção, pela mesma razão: comparar o `pct_atual` de um candidato
    escolhido pela projeção misturaria os dois universos. Desempate por
    `candidato_id` ASC — mesmo critério estável do resto do módulo.

    `None` — nunca `0.0` — quando o número não existiu (plano § B, e
    achado HIGH do `constitution-guard` em 2026-09-05: `0.0` em toda UF
    afirma na tela que "nenhuma UF mudou desde 2022", que é falso):
      - a UF não tem nenhuma linha de 2022 (`historical` vazio, query que
        falhou, cargo nunca importado);
      - Σvotos_2022 da UF é 0;
      - o número de urna do líder não aparece em 2022 naquela UF (partido
        novo, ou partido que não teve voto nenhum ali);
      - ninguém tem `pct_atual` na UF ainda (nada apurado);
      - o cargo não é comparável (`_CARGOS_COM_SWING_2022`).

    Ruído conhecido, e ele é do DADO: com pouca coisa apurada o
    `pct_atual` do líder oscila muito, então o swing também oscila. É a
    mesma volatilidade que a UI já mostra em `pct_atual` — e é o preço de
    o número ser descritivo em vez de suavizado por projeção.

    Args:
        uf_rows: linhas `(uf, candidato)` de `compute_uf_projections` —
            `cargo`/`turno` saem das próprias linhas.
        historical: saída de `fetch_historical_2022` (pode ser `[]`; a
            leitura é não-fatal a montante).

    Returns:
        `{sigla: swing_pp | None}` com UMA entrada para cada UF presente
        em `uf_rows` — UF sem comparação entra explicitamente como `None`,
        para que o consumidor não confunda "sem dado" com "UF ausente".
    """
    rows_by_uf: dict[str, list[dict[str, Any]]] = {}
    for r in uf_rows:
        rows_by_uf.setdefault(str(r["uf"]), []).append(r)
    if not rows_by_uf:
        return {}

    cargo = int(uf_rows[0].get("cargo") or 0)
    turno = int(uf_rows[0].get("turno") or 0)
    comparavel = cargo in _CARGOS_COM_SWING_2022

    # Σvotos_2022 por (uf, nr_partido) e por uf — uma passada.
    votos_por_uf_n: dict[tuple[str, int], int] = {}
    total_por_uf: dict[str, int] = {}
    if comparavel:
        for h in historical:
            cod = h.get("cod_candidato")
            if cod is None:
                continue
            nr = _nr_partido_2022(int(cod), cargo, turno)
            if nr is None:
                continue
            votos = int(h.get("votos") or 0)
            if votos <= 0:
                continue
            uf_h = str(h.get("uf") or "")
            votos_por_uf_n[(uf_h, nr)] = votos_por_uf_n.get((uf_h, nr), 0) + votos
            total_por_uf[uf_h] = total_por_uf.get(uf_h, 0) + votos

    out: dict[str, float | None] = {}
    for sigla, rows in rows_by_uf.items():
        out[sigla] = None
        if not comparavel:
            continue
        # Líder do APURADO. Linhas sem `pct_atual` (UF imputada do
        # nacional, candidato sem voto ainda) não concorrem à liderança —
        # não foram observadas.
        com_atual = [r for r in rows if r.get("pct_atual") is not None]
        if not com_atual:
            continue
        lider = sorted(
            com_atual,
            key=lambda r: (-float(r["pct_atual"]), int(r["candidato_id"])),
        )[0]
        total_2022 = total_por_uf.get(sigla, 0)
        if total_2022 <= 0:
            continue
        votos_lider_2022 = votos_por_uf_n.get((sigla, int(lider["candidato_id"])))
        if votos_lider_2022 is None:
            continue
        pct_2022 = 100.0 * votos_lider_2022 / total_2022
        out[sigla] = round(float(lider["pct_atual"]) - pct_2022, 5)

    return out


def compute_p_eleito_by_uf(
    estimates_by_uf: dict[str, dict[int, np.ndarray]],
    vagas: int,
    anulados: AnuladosNaDecisao | None = None,
) -> dict[str, dict[int, float]]:
    """RF-103 (spec 016) — `p_eleito` por candidato, por UF.

    Delega a `api.model.p_vitoria.p_eleito`, que já resolve a parte difícil
    (contagem POR CENÁRIO, não por distribuição marginal) e tem cobertura
    própria em `tests/unit/model/test_p_eleito.py`. O que esta função
    acrescenta é só o laço sobre as 27 corridas — e a garantia de que a
    pergunta feita ao bootstrap é a certa para o cargo.

    Por que não reusar `p_vitoria`: em Senador a eleição não é ganha por quem
    lidera, é ganha por quem termina entre os DOIS primeiros. `p_vitoria`
    responderia com precisão a uma pergunta que não decide nada — o 2º
    colocado de um estado é senador exatamente como o 1º.

    A soma dos `p_eleito` de uma UF tende a `min(vagas, nº de candidatos)`,
    não a 1. Isso é a assinatura de que o número certo foi calculado.

    Zero sorteio novo: é função pura dos `estimates_by_uf` que
    `compute_uf_projections` já produziu (mesma filosofia de
    `compute_p_passa_2t` / `compute_p_fecha_1t` / `compute_outros_estimates`),
    então o determinismo da constituição § 6 é herdado, não reconquistado.

    Limitação conhecida, e ela é do DADO, não desta função: quando o cargo é
    ingerido em granularidade UF (ADR-0026 item 1), a UF tem uma única
    unidade de reamostragem — o bootstrap de zonas reamostra sempre a mesma
    linha e as 1.000 réplicas saem idênticas. Com dispersão zero, `p_eleito`
    degenera para 0 ou 1. O número continua correto ("dado o ponto estimado,
    estes dois estão à frente"), mas não carrega incerteza amostral. Quem
    exibe precisa olhar a largura do IC antes de chamar isso de "chance" —
    ver `EdgeUfCandidate.p_eleito` em `lib/edge-config/types.ts`.

    `anulados` (decisão do dono de 2026-09-27): candidatura de voto anulado
    NÃO disputa vaga — sai do sorteio por cenário e recebe `p_eleito = 0.0`
    (publicado, não omitido: é um fato, não um "não sabemos"). Com isso a soma
    das que competem continua sendo `min(vagas, nº das que competem)`. Não há
    reescala aqui: dividir todas as frações de um cenário pelo mesmo número
    positivo não muda quem fica entre as `vagas` primeiras.
    """
    if vagas < 1:
        raise ValueError(f"vagas deve ser >= 1, recebido {vagas}")
    out: dict[str, dict[int, float]] = {}
    for uf in sorted(estimates_by_uf):
        cand_map = estimates_by_uf[uf]
        if not cand_map:
            continue
        fora = anulados.da_uf(uf) if anulados is not None else frozenset()
        if fora and any(c in fora for c in cand_map):
            competem = {c: a for c, a in cand_map.items() if c not in fora}
            res = p_eleito(competem, vagas) if competem else {}
            for c in cand_map:
                if c in fora:
                    res[c] = 0.0
            out[uf] = res
            continue
        out[uf] = p_eleito(cand_map, vagas)
    return out


def extract_partido_by_cand(
    snapshots: list[LatestSnapshot], cargo: int | None = None
) -> dict[int, str]:
    """`{cod_candidato: sigla do partido}` a partir dos snapshots do ciclo.

    O EA20 carrega a sigla um nível ACIMA do candidato (`carg[] → agr[] →
    par[].sg`), e `_iter_cands` já a anexa a cada candidato como
    `partido_sg`. Até aqui ninguém colhia essa chave: `build_edge_payload`
    escrevia `"partido": "—"` literal e `build_uf_payloads` lia o `partido`
    das linhas nacionais, que `compute_national` nunca populou. O resultado
    era um travessão em toda tela, em todos os cargos.

    Isto vira pré-requisito com a spec 016: RF-107 pede a contagem das 54
    vagas **por partido/federação**, e não existe contagem por partido sem
    partido. A correção é do tamanho do problema — uma varredura sobre os
    snapshots que o ciclo já leu, sem query nova.

    Determinismo (§ 6): iteração na ordem dos snapshots (que
    `fetch_snapshots` já ordena) e primeira sigla não-vazia vence. Um
    candidato aparece em muitas zonas com a mesma sigla; divergência entre
    zonas seria dado corrompido do TSE, e neste caso a primeira leitura é
    tão defensável quanto qualquer outra — o que importa é que duas
    execuções sobre o mesmo dado deem o mesmo resultado.

    **O dicionário pode ser plano, e isso é decisão registrada — ADR-0042
    item 1.** Em cargo majoritário o número na urna É o número do partido:
    13 é PT em qualquer UF, então a sigla é função do número. **NOME não
    herda essa propriedade** e por isso `extract_identidade_by_cand` (logo
    abaixo) é chaveado pelo par `(uf, numero)`. Não uniformize as duas
    assinaturas: colapsar a de nome nesta poria o candidato a governador do
    PT de São Paulo nos outros 26 estados.
    """
    out: dict[int, str] = {}
    for s in snapshots:
        for c in _iter_cands(s.get("payload"), cargo=cargo):
            try:
                cod = int(c.get("n"))
            except (TypeError, ValueError):
                continue
            if cod in out:
                continue
            sg = c.get("partido_sg")
            if isinstance(sg, str) and sg.strip():
                out[cod] = sg.strip()
    return out


def extract_identidade_by_cand(
    snapshots: list[LatestSnapshot], cargo: int | None = None
) -> dict[tuple[str, int], dict[str, str]]:
    """`{(uf, número na urna): {"nome": ..., "sqcand": ...}}` — RF-143/RF-144.

    **Por que a chave é o PAR `(uf, numero)` e não o número sozinho.**
    `extract_partido_by_cand` (logo acima) pode ser um dicionário plano
    chaveado só pelo número, e está certo: em cargo majoritário o número na
    urna **É** o número do partido — 13 é PT em qualquer UF do país, então a
    sigla é função do número e não da UF. Nome **não** tem essa propriedade.
    Todo candidato a governador do PT do Brasil concorre sob o número 13; um
    dicionário plano com "primeira leitura não-vazia vence" poria o nome do
    candidato de São Paulo nos outros 26 estados, arbitrariamente, conforme a
    ordem de leitura do banco. Hoje a tela diz "Candidato 13" — feio, mas
    verdadeiro; nome de outro estado seria mentira com aparência de dado.

    Isto é decisão registrada — [ADR-0042], itens 1 e 4. **Não "uniformize"
    as duas funções sob a mesma assinatura**: a assimetria é o ponto, não um
    descuido. `tests/unit/model/test_identidade_cand.py` tem um caso (SP e BA
    compartilhando o número 13, nomes diferentes) que é impossível de passar
    com um dicionário plano — é essa a rede.

    `nmu` (nome na urna) antes de `nm` (nome completo), o mesmo critério que
    `api/model/deputado.py` já aplica: é o nome pelo qual o eleitor conhece o
    candidato e o que o próprio TSE exibe. Candidato sem nenhum dos dois
    **não entra** no mapa — uma entrada com `nome: ""` faria o consumidor
    renderizar um rótulo vazio em vez de cair no placeholder `"Candidato {n}"`,
    trocando um fallback honesto por um buraco na tela.

    `sqcand` viaja junto porque é a identidade **global e estável** do
    candidato (ADR-0042 item 2) e a chave que liga esta linha à foto
    (ADR-0041). Sai como **string**: `ea20-schema.ts` o declara
    `z.string()` obrigatório dentro de `cand[]`, e ele tem 11 **ou** 12
    dígitos — convertê-lo a número sobrevive, mas convida ao erro de compará-lo
    como texto entre larguras diferentes, onde `"99…"` (11) vence `"100…"`
    (12) em silêncio.

    Determinismo (constituição § 6): varredura na ordem de `fetch_snapshots`,
    primeira leitura não-vazia vence — igual ao irmão. Zero query nova: lê os
    snapshots que o ciclo já leu. A UF vem de `s["uf"]`, que `fetch_snapshots`
    já devolve em cada linha, então o laço de UF fica aqui, fora de
    `_iter_cands`.
    """
    out: dict[tuple[str, int], dict[str, str]] = {}
    for s in snapshots:
        uf_raw = s.get("uf")
        if not isinstance(uf_raw, str) or not uf_raw.strip():
            continue
        uf = uf_raw.strip().upper()
        for c in _iter_cands(s.get("payload"), cargo=cargo):
            try:
                numero = int(c.get("n"))
            except (TypeError, ValueError):
                continue
            chave = (uf, numero)
            if chave in out:
                continue
            nome = _nome_de_urna(c)
            if not nome:
                continue
            identidade: dict[str, str] = {"nome": nome}
            sq = c.get("sqcand")
            if sq is not None and str(sq).strip():
                identidade["sqcand"] = str(sq).strip()
            out[chave] = identidade
    return out


def _nome_de_urna(cand: dict[str, Any]) -> str:
    """`nmu` (nome na urna) → `nm` (nome completo) → `""`.

    Os dois primeiros degraus da cadeia do RF-144. O terceiro (fatia do
    cadastro de candidaturas) e o quarto (`"Candidato {n}"`) moram nos
    chamadores, porque só eles sabem a corrida e o número.

    Devolve `""` — nunca `None` — quando o EA20 não traz nenhum dos dois;
    quem chama decide o que fazer com o vazio, e o contrato de
    `extract_identidade_by_cand` é não registrar a entrada.
    """
    for chave in ("nmu", "nm"):
        raw = cand.get(chave)
        if raw is None:
            continue
        texto = str(raw).strip()
        if texto:
            return texto
    return ""


# ---------------------------------------------------------------------------
# RF-144 degrau 3 — o CADASTRO de candidaturas (tabela `candidatos`)
#
# Os degraus 1 e 2 (EA20 `nmu`, EA20 `nm`) moram em `_nome_de_urna`/
# `extract_identidade_by_cand`, acima. O degrau 4 (`f"Candidato {n}"`) mora nos
# construtores de payload. Este bloco é o degrau 3, e ele é **fallback**: só
# alcança o par `(uf, numero)` que o boletim não nomeou.
#
# Por que o EA20 vence sempre (ADR-0039, precedência absoluta e unidirecional):
# quem está em `cand[]` do boletim é quem está concorrendo de fato — inclusive
# a substituição de última hora que ainda não propagou ao CSV, e o candidato
# indeferido que continua na urna porque ela já foi programada. O cadastro
# decide, no máximo, se a linha do boletim tem nome ou cai no placeholder.
#
# Espelho em TypeScript: `data-pipeline/candidatos-resolve.ts`. As duas
# implementações precisam concordar — são a mesma regra do ADR-0042 item 5
# aplicada dos dois lados do pipeline.
# ---------------------------------------------------------------------------


def _deferido(candidatura: Mapping[str, Any]) -> bool:
    """`DS_SITUACAO_JULGAMENTO` começa em `DEFERIDO` — degrau (b) do ADR-0042.

    ⚠️ `"INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO"` **não** começa em
    `DEFERIDO` (começa em `IN`), e é exatamente essa distinção que separa
    ARIEL CAPISTRANO de ESTÊVÃO no caso real `3|BA|27`. Usar `in` no lugar de
    `startswith` colapsaria os dois e o desempate cairia no sequencial,
    escolhendo o INDEFERIDO — em silêncio.
    """
    return str(candidatura.get("situacao_julgamento") or "").lstrip().startswith(
        "DEFERIDO"
    )


def resolver_candidatura(
    cargo: int,
    uf: str,
    numero: int,
    candidaturas: Iterable[Mapping[str, Any]],
) -> Mapping[str, Any] | None:
    """Quem concorre com `numero` na corrida `(cargo, uf)` — ADR-0042 item 5.

    Gêmea de `resolverCandidato` em `data-pipeline/candidatos-resolve.ts`.
    Mesmos degraus, mesma ordem, mesmo resultado:

      a. só candidatura **publicável** (ADR-0040, fail-closed);
      b. entre as publicáveis, prefere `situacao_julgamento` começando em
         `DEFERIDO`;
      c. desempate final pelo **maior `sq_candidato`** (registro mais recente).

    O degrau (d) — "o EA20 vence a–c" — não mora aqui: mora em
    `merge_identidade_cadastro`, que é quem enxerga os dois lados.

    ⚠️ **`sq_candidato` é comparado como NÚMERO, nunca como texto.** O
    sequencial tem 11 **ou** 12 dígitos (1.995 de 8.323 nos quatro cargos do
    produto, medido em 2026-09-13), e em comparação textual `"99…"` de 11
    dígitos vence `"100…"` de 12 — o desempate escolhe o registro errado sem
    erro, sem log e sem teste vermelho. `int()` aqui não é cosmético; é a
    mesma armadilha que o `BigInt` do lado TypeScript existe para fechar.

    Determinismo (constituição § 6): o vencedor sai de comparação **total**
    entre os candidatos, não da posição na lista — a ordem de leitura do banco
    não muda o resultado. `None` quando ninguém publicável casa: nunca um
    palpite.
    """
    uf_alvo = str(uf).strip().upper()
    melhor: Mapping[str, Any] | None = None
    melhor_deferido = False

    for c in candidaturas:
        # Degrau (a) — fail-closed. Este guard é o que decide; o `WHERE
        # publicavel` da query é só o recorte barato que evita trazer as 625
        # linhas fora da urna pela rede.
        if not c.get("publicavel"):
            continue
        try:
            if (
                int(c["cargo"]) != int(cargo)
                or str(c["uf"]).strip().upper() != uf_alvo
                or int(c["numero"]) != int(numero)
            ):
                continue
            sq_novo = int(c["sq_candidato"])
        except (KeyError, TypeError, ValueError):
            continue

        deferido = _deferido(c)
        if melhor is None:
            melhor, melhor_deferido = c, deferido
            continue
        # Degrau (b) — DEFERIDO ganha de não-DEFERIDO, qualquer sequencial.
        if deferido != melhor_deferido:
            if deferido:
                melhor, melhor_deferido = c, True
            continue
        # Degrau (c) — empatados em (b), vence o maior sequencial.
        if sq_novo > int(melhor["sq_candidato"]):
            melhor, melhor_deferido = c, deferido

    return melhor


def fetch_identidade_cadastro(
    conn, cargo: int
) -> dict[tuple[str, int], dict[str, str]]:
    """`{(uf, numero): {"nome", "sqcand"}}` lido da tabela `candidatos`.

    O degrau 3 do RF-144. Mesma forma de saída de
    `extract_identidade_by_cand` — de propósito: `merge_identidade_cadastro`
    junta os dois mapas sem conversão, e um campo a mais aqui viraria peso
    morto (o `partido` continua vindo de `extract_partido_by_cand`, que é
    plano por decisão registrada no ADR-0042 item 1).

    ⚠️ **Chave é o par `(uf, numero)`, nunca o número sozinho** — é o ADR-0042
    inteiro. Em cargo 1 a UF do cadastro é a string literal `"BR"` (as 12
    candidaturas presidenciais publicáveis moram sob ela, medido); a expansão
    de `"BR"` para as UFs do ciclo é feita em `merge_identidade_cadastro`,
    não aqui, para que esta função devolva o cadastro como ele é.

    ⚠️ **Não filtra por `turno`.** A tabela só tem `turno = 1`: o TSE não
    republica o cadastro para o 2º turno. Um `AND turno = %s` devolveria zero
    linha em 25/10 e o degrau sumiria em silêncio, exatamente o modo de falha
    que um default de enum produz.

    **Uma query por ciclo, não uma por candidato.** São ≤ 285 linhas em cargo
    1/3/5 e 7.221 em cargo 6; o agrupamento e o desempate rodam em memória.
    `ORDER BY` explícito para que o log do ciclo seja reproduzível
    (constituição § 6) — o desempate em si já é independente de ordem.

    **Degrada, nunca derruba** (constituição § 7): tabela ausente (o replay
    2022 roda contra um banco sem cadastro de 2026), permissão negada, query
    lenta demais — qualquer falha vira `{}` com log `warn`, e a cadeia do
    RF-144 cai no degrau 4 (`"Candidato {n}"`) como caía antes desta função
    existir.
    """
    sql = """
        SELECT uf, numero, sq_candidato, nome, nome_urna,
               situacao_julgamento, publicavel, cargo
        FROM candidatos
        WHERE cargo = %s AND publicavel
        ORDER BY uf, numero, sq_candidato
    """
    t0 = time.perf_counter_ns()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (int(cargo),))
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — sem cadastro o ciclo segue
        _log(
            "warn",
            "fetch_identidade_cadastro failed, RF-144 cai no placeholder",
            cargo=int(cargo),
            error=str(exc),
        )
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 — autocommit ou sem tx
            pass
        return {}

    # Agrupa por `(uf, numero)` e resolve cada grupo com a MESMA função que o
    # lado TypeScript usa. Grupo de 1 (o caso de 99,95 % das chaves) passa pelo
    # mesmo caminho dos 4 grupos colidentes — sem atalho que só o caso raro
    # exercita.
    grupos: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for r in rows:
        try:
            uf = str(r[0]).strip().upper()
            numero = int(r[1])
        except (TypeError, ValueError):
            continue
        if not uf:
            continue
        grupos.setdefault((uf, numero), []).append(
            {
                "uf": uf,
                "numero": numero,
                "sq_candidato": r[2],
                "nome": r[3],
                "nome_urna": r[4],
                "situacao_julgamento": r[5],
                "publicavel": r[6],
                "cargo": r[7],
            }
        )

    out: dict[tuple[str, int], dict[str, str]] = {}
    for (uf, numero) in sorted(grupos):
        vencedora = resolver_candidatura(cargo, uf, numero, grupos[(uf, numero)])
        if vencedora is None:
            continue
        # Nome de urna antes do nome completo — o mesmo critério dos degraus 1
        # e 2 do EA20 (`nmu` antes de `nm`) e o nome pelo qual o eleitor
        # conhece o candidato. `NM_URNA_CANDIDATO` nunca vem vazio (0 em
        # 20.939 linhas), mas o fallback existe porque o contrato é do
        # arquivo, não da medição de um dia.
        nome = str(vencedora.get("nome_urna") or "").strip() or str(
            vencedora.get("nome") or ""
        ).strip()
        if not nome:
            # Mesma regra de `extract_identidade_by_cand`: entrada sem nome
            # faria a tela renderizar rótulo vazio em vez de cair no
            # placeholder honesto.
            continue
        entrada: dict[str, str] = {"nome": nome}
        sq = vencedora.get("sq_candidato")
        if sq is not None and str(sq).strip():
            # String, sempre (ADR-0042 item 2): 11 ou 12 dígitos, e é a chave
            # que endereça a foto (ADR-0041).
            entrada["sqcand"] = str(sq).strip()
        out[(uf, numero)] = entrada

    _log(
        "info",
        "fetch_identidade_cadastro ok",
        cargo=int(cargo),
        linhas=len(rows),
        chaves=len(out),
        colisoes=sum(1 for g in grupos.values() if len(g) > 1),
        duration_ms=(time.perf_counter_ns() - t0) // 1_000_000,
    )
    return out


def merge_identidade_cadastro(
    identidade_ea20: dict[tuple[str, int], dict[str, str]],
    cadastro: dict[tuple[str, int], dict[str, str]],
    ufs_do_ciclo: Iterable[Any],
) -> dict[tuple[str, int], dict[str, str]]:
    """Funde o cadastro **por baixo** do EA20 — degrau (d) do ADR-0042 item 5.

    O EA20 tem precedência **absoluta**: uma chave que o boletim nomeou não é
    tocada. A fusão é por ENTRADA, não por campo — o cadastro não completa o
    `sqcand` de uma entrada cujo nome veio do EA20. A razão é concreta: numa
    substituição de última hora o boletim traz a pessoa nova e o cadastro
    ainda resolve o par para a pessoa velha; costurar o `sqcand` do cadastro
    ao nome do EA20 penduraria a **foto errada** no nome certo — um erro que
    não tem como aparecer em log, só na tela. (Na prática o caso não chega a
    existir, porque `extract_identidade_by_cand` só registra entrada quando há
    nome, e nome e `sqcand` saem do mesmo `cand[]`; a regra está escrita para
    que continue assim se aquele contrato mudar.)

    **`"BR"` expande para as UFs do ciclo.** Em cargo 1 o cadastro guarda as 12
    candidaturas presidenciais sob `uf = "BR"`, enquanto o payload as procura
    por `("SP", 13)`, `("BA", 13)`, … Sem a expansão o degrau 3 seria inerte
    justamente no único cargo em que o número identifica uma pessoa no país
    inteiro. Expandir é seguro exatamente ali e em lugar nenhum mais: cargos
    3, 5 e 6 têm 27 UFs reais no cadastro e zero linha `"BR"` (medido).

    Determinismo (§ 6): varredura por chave ordenada e UFs ordenadas; nada de
    ordem de `set`. Devolve um dicionário **novo** — o mapa do EA20 que entrou
    continua intacto para quem ainda o tiver em mãos.
    """
    out: dict[tuple[str, int], dict[str, str]] = {
        chave: dict(valor) for chave, valor in identidade_ea20.items()
    }
    if not cadastro:
        return out

    ufs = sorted(
        {
            u.strip().upper()
            for u in ufs_do_ciclo
            if isinstance(u, str) and u.strip()
        }
    )

    for chave_cad in sorted(cadastro):
        uf_cad, numero = chave_cad
        alvos = ufs if uf_cad == "BR" else [uf_cad]
        for uf in alvos:
            if (uf, numero) in out:
                continue  # o EA20 já nomeou esta corrida — degrau (d).
            out[(uf, numero)] = dict(cadastro[chave_cad])

    return out


def compute_p_passa_2t(
    national_estimates: dict[int, np.ndarray],
) -> dict[int, float]:
    """P(candidato termina top-2 no 1º turno) — ADR-0014 (S05/F4c).

    Para cada candidato `c`, conta a frequência empírica nos resamples do
    bootstrap em que `c` aparece entre os 2 maiores valores. Soma das
    `p_passa_2t` é exatamente 2.0 (cada resample contribui com 1 slot
    top-1 e 1 slot top-2), modulo arredondamento.

    Determinismo (§ 6): zero novo random. Reusa o array `estimates` já
    calculado pelo bootstrap. Sem custo significativo extra — uma passada
    O(n_resamples × n_cands * log n_cands) pequena.

    Args:
        national_estimates: `{cand_id: ndarray[shape=(n_resamples,)]}`
            como emitido por `compute_national`.

    Returns:
        `{cand_id: prob}` com prob em [0, 1]. Candidatos ausentes do dict
        recebem 0.0 implicitamente (não estão entre as keys retornadas).
    """
    if not national_estimates:
        return {}
    candidates = sorted(national_estimates.keys())  # ordem determinística
    n = len(candidates)
    if n == 0:
        return {}
    if n == 1:
        # Só 1 candidato — está sempre no top-2 (vacuamente).
        return {candidates[0]: 1.0}

    # Stack: shape (n_cands, n_resamples).
    matrix = np.stack([national_estimates[c] for c in candidates], axis=0)
    n_resamples = matrix.shape[1]

    # Para cada resample, encontra os 2 índices com maiores valores.
    # argpartition é O(n) e suficiente (não precisamos do ranking
    # completo dos n-2 restantes).
    if n == 2:
        # Caso degenerado: ambos os candidatos estão sempre no top-2.
        return {c: 1.0 for c in candidates}

    counts = np.zeros(n, dtype=np.int64)
    # Argpartition retorna índices não ordenados, mas garante que os
    # n-2 menores ficam à esquerda — top-2 fica nas últimas 2 posições.
    top2_idx = np.argpartition(matrix, n - 2, axis=0)[n - 2 :, :]  # shape (2, n_resamples)
    for j in range(n_resamples):
        for k in range(2):
            counts[top2_idx[k, j]] += 1

    return {candidates[i]: float(counts[i]) / float(n_resamples) for i in range(n)}


def compute_p_fecha_1t(
    national_estimates: dict[int, np.ndarray],
) -> dict[int, float]:
    """P(candidato fecha 1T sozinho com >= 50%+1) — ADR-0014 (S05/F4c).

    Para cada candidato `c`, conta a frequência empírica de
    `estimates_c[i] >= 0.50` (fração; 0.50 = 50%) nos resamples.

    Em casos saudáveis (líder estável ≥ 55%), `p_fecha_1t[lider]` cresce
    rapidamente — gatilho do banner "Decidido no 1T se >X%" (RF-030.9).

    Determinismo (§ 6): zero novo random.

    Args:
        national_estimates: `{cand_id: ndarray}` (frações [0, 1]).

    Returns:
        `{cand_id: prob}` em [0, 1].
    """
    out: dict[int, float] = {}
    for cand, arr in national_estimates.items():
        # `arr` está em fração (0–1) — comparar com 0.50 = 50%+1 limite.
        out[cand] = float(np.mean(arr >= 0.50))
    return out


def compute_two_round_scenarios(
    national_estimates: dict[int, np.ndarray],
    _cand_ordered: list[int] | None = None,  # noqa: ARG001 — reservado pra logs/testes
) -> dict[str, Any]:
    """Calcula P(2º turno geral) + top-3 cenários de duelo no 2T — ADR-0014.

    Para cada resample do bootstrap:
      1. Identifica os 2 candidatos com maiores valores (top-2 do resample).
      2. Conta `(par[0], par[1])` na frequência — normalizando o par para
         ordenação canônica (id menor primeiro) evita dupla contagem do
         mesmo duelo.
      3. Conta se algum candidato fechou >= 50%+1 sozinho — `goes_to_2t`
         é o complemento ((max(estimates) < 0.50) nos resamples).

    Retorna:
        {
          "p_segundo_turno_overall": float ∈ [0, 1],
          "cenarios_2t": [{"par": [id_a, id_b], "prob": float}, ...]
            (top-3 ordenado desc por prob; vazio se < 2 candidatos)
        }

    Args:
        national_estimates: `{cand_id: ndarray}` (frações [0, 1]).
        cand_ordered: Lista opcional para deterministic ordering nos
            empates (não usada na contagem; útil pra logs/testes).

    Determinismo (§ 6): zero novo random. Pares são canonicalizados
    (menor id primeiro) para dedupar AB == BA. Top-3 ordenado por prob
    desc, tie-breaker pelo par (id_a, id_b) ASC.
    """
    if not national_estimates or len(national_estimates) < 2:
        return {"p_segundo_turno_overall": 0.0, "cenarios_2t": []}

    candidates = sorted(national_estimates.keys())
    n = len(candidates)
    matrix = np.stack([national_estimates[c] for c in candidates], axis=0)
    n_resamples = matrix.shape[1]

    # P(2T) = P(max(estimates) < 0.50) — ninguém fecha sozinho.
    max_per_resample = np.max(matrix, axis=0)  # shape (n_resamples,)
    p_2t = float(np.mean(max_per_resample < 0.50))

    # Top-3 pares (top-1, top-2 do resample) por frequência.
    # Para cada resample, identifica top-1 e top-2 (índices em `candidates`).
    pair_counts: dict[tuple[int, int], int] = {}
    if n == 2:
        # Único par possível.
        pair = (candidates[0], candidates[1])
        pair_counts[pair] = n_resamples
    else:
        # argpartition n-2 → top-2 ficam nas 2 últimas posições, em ordem
        # arbitrária. Sort dos top-2 por valor desc nos resamples seria
        # mais "real" (top-1 vs top-2 no duelo), mas para contagem do
        # PAR, a ordem dentro do par não importa — canonicalizamos.
        top2_idx = np.argpartition(matrix, n - 2, axis=0)[n - 2 :, :]
        for j in range(n_resamples):
            a_idx = int(top2_idx[0, j])
            b_idx = int(top2_idx[1, j])
            a_id = candidates[a_idx]
            b_id = candidates[b_idx]
            # Canonicaliza par: menor id primeiro (deduplica AB == BA).
            pair = (min(a_id, b_id), max(a_id, b_id))
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

    # Top-3 desc por prob; tie-breaker pelo par ASC.
    sorted_pairs = sorted(
        pair_counts.items(),
        key=lambda kv: (-kv[1], kv[0]),
    )
    top3 = [
        {"par": [pair[0], pair[1]], "prob": float(count) / float(n_resamples)}
        for pair, count in sorted_pairs[:3]
    ]

    return {"p_segundo_turno_overall": p_2t, "cenarios_2t": top3}


def aggregate_national_estimates(
    estimates_by_uf: dict[str, dict[int, np.ndarray]],
    eleitorado_total_by_uf: dict[str, int],
) -> dict[int, np.ndarray]:
    """Agrega `estimates_by_uf` para `{cand_id: ndarray}` nacional.

    Mesma lógica usada internamente em `compute_national`. Extraída em S05/F4c
    para que callers externos (orchestrator) possam alimentar funções
    derivadas como `compute_two_round_scenarios`, `compute_p_passa_2t`,
    `compute_p_fecha_1t` sem duplicar código nem rodar bootstrap extra.

    Determinismo (§ 6): mesma lógica determinística (pesos pelo eleitorado UF,
    sem random). Mesma entrada → mesma saída bit-a-bit.

    Args:
        estimates_by_uf: `{uf: {cand_id: ndarray}}` emitido por
            `compute_uf_projections`.
        eleitorado_total_by_uf: `{uf: int}` (soma de aptos por UF).

    Returns:
        `{cand_id: ndarray}` em fração [0, 1] (espaço do bootstrap).
        Vazio se nenhum candidato tem peso útil.
    """
    all_candidates: set[int] = set()
    for cand_map in estimates_by_uf.values():
        all_candidates.update(cand_map.keys())
    if not all_candidates:
        return {}

    sample_arr: np.ndarray | None = None
    for cand_map in estimates_by_uf.values():
        for arr in cand_map.values():
            sample_arr = arr
            break
        if sample_arr is not None:
            break
    if sample_arr is None:
        return {}

    n_resamples = sample_arr.shape[0]
    national_estimates: dict[int, np.ndarray] = {}

    for cand in all_candidates:
        agg = np.zeros(n_resamples, dtype=np.float64)
        weight_sum = 0
        for uf, cand_map in estimates_by_uf.items():
            arr = cand_map.get(cand)
            if arr is None:
                continue
            w = eleitorado_total_by_uf.get(uf, 0)
            if w <= 0:
                continue
            agg += arr * w
            weight_sum += w
        if weight_sum > 0:
            national_estimates[cand] = agg / weight_sum

    return national_estimates


def compute_outros_estimates(
    estimates: dict[int, np.ndarray],
    rank_by_cand: dict[int, int],
    min_rank: int = 4,
) -> tuple[np.ndarray, int]:
    """"Outros" com IC real (D4 do plano `sim-monte-um-planejamento-magical-
    key.md`) — soma, resample a resample, dos `estimates` (fração [0,1])
    dos candidatos com `rank >= min_rank`.

    Por que soma de resamples e não `100 - Σ(top3)`: a subtração descarta
    toda a incerteza dos candidatos de cauda (vira um número fixo). Somar
    os arrays PAREADOS por índice de resample preserva a covariância entre
    eles e devolve um IC genuíno para "Outros" — mesma filosofia de
    `aggregate_national_estimates`/`p_vitoria` (comparação/soma sempre
    pareada por resample, nunca por estatística agregada isolada).

    Determinismo (§ 6): soma elementwise de arrays já sorteados por
    `bootstrap_uf`/`estimate_uf_participacao` — zero `random` novo aqui.

    Args:
        estimates: `{cand_id: ndarray}` em fração [0,1], todos com o MESMO
            shape `(n_resamples,)` — garantido por quem produz `estimates`
            (`aggregate_national_estimates`/`estimates_by_uf[uf]`).
        rank_by_cand: `{cand_id: rank}` 1-based — mesma semântica de
            `compute_national`/`build_uf_payloads` (rank 1 = líder).
            Candidato ausente do dict é tratado como rank `0` (nunca entra
            em "outros" por omissão — fail-safe).
        min_rank: candidatos com `rank >= min_rank` entram na soma
            (default 4 — "Outros" = tudo além do pódio top-3, D2 do plano).

    Returns:
        `(soma, n_candidatos)`. `n_candidatos == 0` (menos de 4 candidatos
        na corrida, ou `estimates` vazio) devolve um array de zeros no
        shape do primeiro `estimates` encontrado (`np.zeros(0)` se
        `estimates` vazio) — caller trata `n_candidatos <= 0` como
        "omitir a chave `outros` inteira".
    """
    if not estimates:
        return np.zeros(0, dtype=np.float64), 0

    sample_shape = next(iter(estimates.values())).shape
    tail = [c for c in estimates if rank_by_cand.get(c, 0) >= min_rank]
    if not tail:
        return np.zeros(sample_shape, dtype=np.float64), 0

    agg = np.zeros(sample_shape, dtype=np.float64)
    for c in tail:
        agg = agg + estimates[c]
    return agg, len(tail)


def _outros_metric_payload(
    estimates: np.ndarray, n_candidatos: int
) -> dict[str, Any] | None:
    """Constrói o bloco `participacao.outros` a partir do resultado de
    `compute_outros_estimates` — `pct_projetado`/`lower`/`upper` em
    percentual 0–100, `base: "votaveis"` (D3 — % sobre votos a candidatos
    votáveis, mesma base semântica de `pvap`).

    `pct_atual` sai sempre `None` aqui — quem povoa é o caller que tem
    acesso a `municipio_aggregates` (`build_edge_payload`/
    `build_uf_payloads`), somando os `pct_atual` reais dos candidatos de
    cauda (rank >= `min_rank`).

    Returns:
        `None` se `n_candidatos <= 0` (menos de 4 candidatos na corrida —
        "outros" não existe; caller omite a chave inteira).
    """
    if n_candidatos <= 0:
        return None
    return {
        "pct_atual": None,
        "pct_projetado": _frac_to_pct(float(np.mean(estimates))),
        "lower": _frac_to_pct(float(np.percentile(estimates, 2.5))),
        "upper": _frac_to_pct(float(np.percentile(estimates, 97.5))),
        "base": "votaveis",
        "n_candidatos": n_candidatos,
    }


def _participacao_metric_payload(
    est: ParticipacaoEstimate, base: str
) -> dict[str, Any]:
    """Converte `ParticipacaoEstimate` (turnout.py) para o shape de payload
    `participacao.<abstencao|brancos_nulos>` (Fase 1a, D3/D5/D6)."""
    return {
        "pct_atual": est["pct_atual"],
        "pct_projetado": est["pct_projetado"],
        "lower": est["lower"],
        "upper": est["upper"],
        "base": base,
    }


def somar_contagens_agregadas(
    agregados: list[LatestSnapshot],
    cargo: int,
) -> dict[str, int] | None:
    """As 9 contagens absolutas do bloco `votacao.contagens` (spec 021,
    RF-199), a partir das linhas de nível `"br"`/`"uf"` de `snapshots`.

    Fonte: o agregado que o **próprio TSE** publica, lido pelo mesmo
    `_extract_zone_participacao` que lê zona (ele opera sobre os objetos de
    raiz `e`/`v` de qualquer envelope EA20 — BR, UF, município ou zona).
    Não é soma nossa por zona: o TSE já entrega o total conferido.

    Escolha da fonte:
      - **cargo 1** tem arquivo de nível `"br"` (`targets.ts`, `temArquivoBr`).
        Quando ele está presente, é ELE — um número do TSE, não uma soma.
      - **cargos 3/5/6** não têm arquivo nacional: o total é a **soma dos 27
        agregados de UF**. Soma de contagens inteiras, exata, sem projeção.
      - cargo 1 sem a linha `"br"` (ciclo em que o arquivo faltou) cai na
        soma das UFs, que é o mesmo número por identidade.

    Devolve `None` quando não há nenhuma linha agregada utilizável — o
    bloco `votacao` inteiro é OMITIDO, que é o estado **"não sabemos"**
    (RF-198 ⇒ `<DetailUnavailable>`).

    🔴 **Nunca devolve zeros de resgate.** `_extract_zone_participacao`
    exige `e.te > 0` e devolve `None` sem ele, então um agregado sem
    eleitorado não vira `aptos: 0`. A distinção importa: `aptos > 0` com o
    resto zerado é **"não começou"** (RF-193b, círculo 100% cinza) e é um
    estado LEGÍTIMO que este produtor publica de propósito; bloco ausente é
    "não sabemos". São três estados, decisão do dono de 14/09 — e fabricar
    zero colapsaria dois deles.
    """
    if not agregados:
        return None

    if int(cargo) == 1:
        br = _agregado_br(agregados)
        if br is not None:
            return _contagens_de_bruto(br[1])

    # Soma dos agregados de UF. `BR` fica fora para não somar o país duas
    # vezes — ele é o total, não uma parcela.
    por_uf = _agregados_de_uf(agregados)
    if not por_uf:
        return None

    total = {
        "aptos": 0,
        "instalados": 0,
        "comparecimento": 0,
        "abstencao": 0,
        "validos": 0,
        "brancos": 0,
        "nulos": 0,
        "anulados": 0,
        "sub_judice": 0,
    }
    for _snap, bruto in por_uf.values():
        parcela = _contagens_de_bruto(bruto)
        for chave in total:
            total[chave] += parcela[chave]
    return total


def _agregado_br(
    agregados: list[LatestSnapshot],
) -> tuple[LatestSnapshot, ZonaParticipacaoRaw] | None:
    """A linha de nível `"br"` utilizável (com `e.te > 0`), ou `None`.

    Mais de uma linha `br` não deveria existir (a chave é única por
    cargo/turno/nível); se existir, a mais fresca ganha — `ts` desc.

    Ponto ÚNICO da escolha, compartilhado por `somar_contagens_agregadas` e
    `montar_corrida_nacional` (spec 022): contagens e corrida TÊM de sair da
    mesma linha, senão os três círculos deixam de fechar por identidade.
    """
    br = [
        s
        for s in agregados
        if nivel_do_snapshot(s) == NIVEL_BR
        and _extract_zone_participacao(s["payload"]) is not None
    ]
    if not br:
        return None
    escolhida = max(br, key=lambda s: (s.get("ts") is not None, s.get("ts")))
    bruto = _extract_zone_participacao(escolhida["payload"])
    assert bruto is not None  # filtrado acima
    return escolhida, bruto


def _agregados_de_uf(
    agregados: list[LatestSnapshot],
) -> dict[str, tuple[LatestSnapshot, ZonaParticipacaoRaw]]:
    """`{sigla: (linha, participação crua)}` — uma linha agregada por UF.

    Só nível `"uf"`; sigla vazia e `"BR"` ficam fora (o país não é uma 28ª
    UF, RF-199). Linha sem `e.te > 0` fica fora (nunca zero de resgate).

    Uma linha por UF: `fetch_snapshots` já devolve o `rn = 1` por (uf,
    município, zona, nível), mas a defesa é barata e o custo de somar a
    mesma UF duas vezes seria um `aptos` inflado em silêncio. A última
    leitura vence — comportamento anterior à spec 022, preservado.

    Ponto ÚNICO da escolha, compartilhado pelas contagens, pela corrida
    nacional e pelo `votacao` de cada `EdgePayloadUf` (spec 022).
    """
    por_uf: dict[str, tuple[LatestSnapshot, ZonaParticipacaoRaw]] = {}
    for s in agregados:
        if nivel_do_snapshot(s) != NIVEL_UF:
            continue
        sigla = str(s.get("uf") or "").strip().upper()
        if not sigla or sigla == "BR":
            continue
        bruto = _extract_zone_participacao(s["payload"])
        if bruto is None:
            continue
        por_uf[sigla] = (s, bruto)
    return por_uf


def _contagens_de_bruto(bruto: ZonaParticipacaoRaw) -> dict[str, int]:
    """`ZonaParticipacaoRaw` → as 9 chaves de `EdgeVotacaoContagens`.

    Só renomeia (`eleitores_aptos` → `aptos`, `eleitores_instalados` →
    `instalados`) e descarta o que não entra no contrato (`votaveis`, `psa`).
    Ponto único do mapeamento, para que o nome do campo do TSE e o nome do
    campo do payload não sejam correlacionados na mão em dois lugares.
    """
    return {
        "aptos": int(bruto["eleitores_aptos"]),
        "instalados": int(bruto["eleitores_instalados"]),
        "comparecimento": int(bruto["comparecimento"]),
        "abstencao": int(bruto["abstencao"]),
        "validos": int(bruto["validos"]),
        "brancos": int(bruto["brancos"]),
        "nulos": int(bruto["nulos"]),
        "anulados": int(bruto["anulados"]),
        "sub_judice": int(bruto["sub_judice"]),
    }


# ---------------------------------------------------------------------------
# Spec 022 — a corrida em três círculos (RF-203 / RF-209)
# ---------------------------------------------------------------------------

#: Cargos que ganham a corrida no payload. Deputado Federal (6) fica FORA por
#: decisão do dono (RF-200): a disputa é proporcional, não há colocados.
CARGOS_COM_CORRIDA: tuple[int, ...] = (1, 3, 5)

#: Cargos cuja corrida NACIONAL é por partido (27 corridas, RF-201). O
#: Presidente (1) tem uma corrida só e publica por candidatura.
CARGOS_CORRIDA_POR_PARTIDO: tuple[int, ...] = (3, 5)

#: Cargos cujo `EdgePayloadUf` (ou, no 6, `DeputadoUfDetail`) publica
#: `votacao` — spec 021 RF-192 emendado em 2026-09-26 (noite): o painel
#: "Votação" entrou nas QUATRO telas de UF. O 6 publica contagens (e projeção,
#: quando houver participação da UF), nunca corrida — `CARGOS_COM_CORRIDA`.
CARGOS_COM_VOTACAO_UF: tuple[int, ...] = (1, 3, 5, 6)

#: `cand[].dvt` do EA20 → `EdgeDestinoVoto` (spec 022 RF-209,
#: `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:790-806`).
#:
#: 🔴 **Sem default, e é de propósito.** O que não está aqui sai SEM
#: `destino`, e isso põe a tela em "aguardando" (RF-207). "Desconhecido ⇒
#: válido" poria votos anulados dentro de uma fatia com nome de candidato —
#: na captura real do simulado o MAIS votado era `"Anulado sub judice"`.
#:
#: ⚠️ O dicionário do TSE lista um quarto valor, `"Válido (legenda)"`. Ele é
#: de cargo proporcional (voto que vai para a legenda, não para o nome) e
#: por isso NÃO está aqui: se aparecer num cargo majoritário, é dado que não
#: entendemos, e a tela espera em vez de nomear o voto de legenda como voto
#: da candidatura.
_DESTINO_POR_DVT: dict[str, str] = {
    "válido": "valido",
    "anulado": "anulado",
    "anulado sub judice": "sub_judice",
}


def destino_do_dvt(dvt: Any) -> str | None:
    """`cand[].dvt` → `"valido" | "anulado" | "sub_judice"` ou `None`.

    `None` em dois casos, e só o segundo é anômalo:
      - ausente/vazio — o TSE só publica o campo "após a primeira
        totalização parcial"; é o estado normal do começo da noite;
      - valor desconhecido — aviso no log, e a candidatura sai sem destino.
    """
    if dvt is None:
        return None
    texto = str(dvt).strip()
    if not texto:
        return None
    destino = _DESTINO_POR_DVT.get(texto.casefold())
    if destino is None:
        _log(
            "warn",
            "dvt desconhecido; candidatura publicada SEM destino (spec 022 RF-209)",
            dvt=texto,
        )
    return destino


def extrair_corrida(payload: Any, cargo: int) -> list[dict[str, Any]] | None:
    """`EdgeCorridaEntrada[]` de UM arquivo agregado do TSE (spec 022 RF-209).

    Uma entrada por candidatura: `id` (`cand.n`), `partido` (`par.sg`),
    `votos` (`cand.vap`) e `destino` (`cand.dvt` mapeado — AUSENTE, nunca
    default, quando o TSE ainda não o publicou ou publicou algo que não
    entendemos).

    Ordem: `id` crescente, para o payload não depender da ordem do arquivo
    (§ 6, determinismo). A ORDEM DA TELA é da tela (RF-202), por votos.

    Candidatura sem número, sem sigla ou sem `vap` legível fica FORA, com
    aviso: a soma deixa de fechar e a tela diz "não fecha" (RF-204) — que é
    a verdade — em vez de um zero ou um partido inventados.

    `None` quando o arquivo não tem candidatura nenhuma: é "não sabemos"
    (RF-207), nunca uma lista vazia que a tela leria como "ninguém votou".
    """
    out: dict[int, dict[str, Any]] = {}
    for c in _iter_cands(payload, cargo=cargo):
        try:
            cod = int(c.get("n"))
        except (TypeError, ValueError):
            _log("warn", "corrida: candidatura sem número legível", n=c.get("n"))
            continue
        sg = c.get("partido_sg")
        if not isinstance(sg, str) or not sg.strip():
            _log("warn", "corrida: candidatura sem sigla de partido", n=cod)
            continue
        votos = _parse_br_number(c.get("vap"))
        if votos is None or votos < 0:
            _log("warn", "corrida: candidatura sem vap legível", n=cod, vap=c.get("vap"))
            continue
        if cod in out:
            # Mesmo número duas vezes no MESMO arquivo é dado corrompido;
            # somar duplicaria votos, então a primeira leitura vence.
            _log("warn", "corrida: número de urna repetido no agregado", n=cod)
            continue
        entrada: dict[str, Any] = {
            "id": cod,
            "partido": sg.strip(),
            "votos": int(round(votos)),
        }
        destino = destino_do_dvt(c.get("dvt"))
        if destino is not None:
            entrada["destino"] = destino
        out[cod] = entrada
    if not out:
        return None
    return [out[k] for k in sorted(out)]


def destino_pendente(corrida: list[dict[str, Any]]) -> bool:
    """`True` se alguma candidatura COM voto está sem destinação (RF-209).

    Candidatura com 0 voto e sem destino não pende nada: não há voto a
    separar. É a regra de `votos > 0` do RF-207, a mesma que a tela aplica.
    """
    return any(int(e["votos"]) > 0 and "destino" not in e for e in corrida)


def _somar_corridas_de_uf(corridas: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Soma por candidatura de corridas de UF — Presidente nacional quando o
    arquivo `br` faltou no ciclo (a mesma queda das contagens).

    O destino de uma candidatura é da candidatura, não da UF: se todas as UFs
    concordam, é ele; se alguma não tem destino, a soma também não tem; se
    duas UFs DISCORDAM, é dado que não entendemos — sai sem destino, com
    aviso, e a tela espera.
    """
    soma: dict[int, dict[str, Any]] = {}
    destinos: dict[int, set[str | None]] = {}
    for corrida in corridas:
        for e in corrida:
            cod = int(e["id"])
            if cod not in soma:
                soma[cod] = {"id": cod, "partido": e["partido"], "votos": 0}
                destinos[cod] = set()
            soma[cod]["votos"] += int(e["votos"])
            destinos[cod].add(e.get("destino"))
    for cod, conjunto in destinos.items():
        if len(conjunto) == 1 and None not in conjunto:
            soma[cod]["destino"] = next(iter(conjunto))
        elif None not in conjunto:
            _log(
                "warn",
                "corrida: destino divergente entre UFs; publicado SEM destino",
                n=cod,
                destinos=sorted(str(d) for d in conjunto),
            )
    return [soma[k] for k in sorted(soma)]


def somar_corrida_por_partido(
    corridas: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """`EdgeCorridaPartido[]` — Σ `votos` das candidaturas `valido` por sigla,
    somando as corridas de UF (spec 022 RF-201/RF-209).

    🔴 **Só `destino == "valido"` entra (RF-203).** Candidatura anulada ou
    sub judice não soma no partido, nem com zero: o voto dela é da fatia
    "Anulados e sub judice". O caller NÃO pode chamar isto com destino
    pendente — ver `montar_corrida_nacional`.

    Partido sem nenhuma candidatura válida não aparece. Ordem por sigla,
    para determinismo (a ordem da tela é por votos, RF-202).
    """
    por_partido: dict[str, int] = {}
    for corrida in corridas:
        for e in corrida:
            if e.get("destino") != "valido":
                continue
            por_partido[e["partido"]] = por_partido.get(e["partido"], 0) + int(e["votos"])
    return [
        {"partido": sigla, "votos_validos": votos}
        for sigla, votos in sorted(por_partido.items())
    ]


def montar_corrida_nacional(
    agregados: list[LatestSnapshot],
    cargo: int,
) -> dict[str, Any]:
    """As chaves de corrida do `votacao` NACIONAL (spec 022 RF-209), para
    serem mescladas ao bloco — `{}` quando não há o que publicar.

    - **Presidente (1)**: `corrida` da linha `br` (a MESMA que deu as
      contagens, via `_agregado_br`). Sem linha `br`, soma das corridas das
      UFs, exatamente como as contagens caem na soma das UFs.
    - **Governador/Senador (3/5)**: `corrida_por_partido`, somando as UFs.
      Se QUALQUER candidatura com voto, em qualquer UF, está sem destino:
      `destino_pendente: true` e `corrida_por_partido` OMITIDO — a soma por
      partido sem saber quem é válido seria o número errado do Contexto.
    - **Deputado (6)** e qualquer outro: `{}` (RF-200).

    "Não sabemos" (`{}`): nenhuma UF com candidatura, ou alguma UF que entra
    nas contagens sem lista de candidaturas — uma soma parcial não fecharia
    contra `contagens.validos` e não é publicada.
    """
    cargo_i = int(cargo)
    if cargo_i not in CARGOS_COM_CORRIDA:
        return {}

    if cargo_i == 1:
        br = _agregado_br(agregados)
        if br is not None:
            corrida = extrair_corrida(br[0]["payload"], cargo_i)
            if corrida is None:
                return {}
            return _com_pendencia({"corrida": corrida}, corrida)

    por_uf = _agregados_de_uf(agregados)
    if not por_uf:
        return {}
    corridas: list[list[dict[str, Any]]] = []
    for sigla in sorted(por_uf):
        corrida = extrair_corrida(por_uf[sigla][0]["payload"], cargo_i)
        if corrida is None:
            _log(
                "warn",
                "corrida nacional omitida: UF agregada sem candidaturas",
                cargo=cargo_i,
                uf=sigla,
            )
            return {}
        corridas.append(corrida)

    if cargo_i not in CARGOS_CORRIDA_POR_PARTIDO:
        somada = _somar_corridas_de_uf(corridas)
        return _com_pendencia({"corrida": somada}, somada)

    if any(destino_pendente(c) for c in corridas):
        return {"destino_pendente": True}
    return {"corrida_por_partido": somar_corrida_por_partido(corridas)}


def _com_pendencia(bloco: dict[str, Any], corrida: list[dict[str, Any]]) -> dict[str, Any]:
    if destino_pendente(corrida):
        bloco["destino_pendente"] = True
    return bloco


# ---------------------------------------------------------------------------
# Destinação do voto nas DECISÕES — ADR-0053 / spec 002 RF-213 (2026-09-27)
# ---------------------------------------------------------------------------
#
# O defeito: a projeção trata toda candidatura com `vap` como concorrente e
# nunca lia `cand[].dvt`. Uma candidatura de voto ANULADO (art. 265 da Res.
# 23.751/2026) podia virar líder, entrar no par do 2º turno, ocupar vaga do
# Senado — e, pior, os votos dela ficavam na base da regra dos 50%: medido na
# captura `tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`, um líder com
# 46% de `vvc` e 16% de `vvc` anulado saía com `p_fecha_1t = 0` quando, pela
# norma, já venceu (46/84 = 54,8% da base que conta).
#
# A regra (decisão do dono, não reabrir):
#   1. `"anulado"` NÃO compete: sai de líder, par, agulha, `p_vitoria`,
#      `p_passa_2t`, `p_fecha_1t`, cenários do 2º turno, `chamada`,
#      `vai_a_2t` e `p_eleito`. Os votos dela saem da base da regra dos 50%
#      por reamostra: `f_i' = f_i / (1 − Σ f_anuladas)`.
#   2. `"sub_judice"` SEGUE O TSE — compete e fica na base, como antes (a
#      captura real marca essa candidatura com `st: "2º turno"`).
#   3. A EXIBIÇÃO não muda: `pct_atual`/`pct_projetado`/IC continuam sobre
#      `vvc` (ADR-0018). Só as decisões mudam.
#   4. Sem `dvt`, `dvt` ausente em algum arquivo, divergente entre arquivos da
#      mesma candidatura, ou valor desconhecido ⇒ ninguém é excluído (saída
#      byte a byte igual à de antes) + aviso no log. NUNCA default.
#   5. A regra é aplicada na FRONTEIRA das decisões — o estimador
#      (`_extract_zone_candidatos`/`estimate_uf_candidatos`) não sabe de
#      `dvt`, e é por isso que a exibição fica intocada por construção.
#      Presidente decide com o destino NACIONAL; Governador/Senador, com o da
#      UF.

#: Chave de escopo do mapa de destino para o país inteiro. `"BR"` nunca é
#: sigla de UF no modelo (`_snapshots_por_uf` o descarta), então não colide.
ESCOPO_NACIONAL = "BR"

#: Destinos que o mapa aceita — os três de `_DESTINO_POR_DVT`, e só eles.
_DESTINOS_CONHECIDOS = frozenset(_DESTINO_POR_DVT.values())

#: Destino que tira a candidatura das decisões (regra 1). `"sub_judice"` NÃO
#: está aqui, e é de propósito (regra 2).
DESTINO_FORA_DA_DECISAO = "anulado"

_OBS_AUSENTE = "__ausente__"
_OBS_DESCONHECIDO = "__desconhecido__"


def _observar_dvt(dvt: Any) -> str:
    """Um `cand[].dvt` → destino conhecido, ou uma das duas marcas de falta.

    Não usa `destino_do_dvt` de propósito: aquele loga um aviso POR CHAMADA, e
    aqui são ~6.110 arquivos × N candidaturas por ciclo. O aviso deste caminho
    é um só, agregado, em `montar_destino_por_candidatura`.
    """
    if dvt is None:
        return _OBS_AUSENTE
    texto = str(dvt).strip()
    if not texto:
        return _OBS_AUSENTE
    return _DESTINO_POR_DVT.get(texto.casefold(), _OBS_DESCONHECIDO)


def _sigla_do_snapshot(s: Mapping[str, Any]) -> str | None:
    """Sigla da UF de uma linha de `snapshots`, ou `None` para BR/vazia."""
    sigla = str(s.get("uf") or "").strip().upper()
    if not sigla or sigla == ESCOPO_NACIONAL:
        return None
    return sigla


def montar_destino_por_candidatura(
    zonas: Iterable[Mapping[str, Any]],
    agregados: Iterable[Mapping[str, Any]],
) -> dict[tuple[str, int], str]:
    """`{(escopo, cand_id): destino}` — o destino do voto de cada candidatura,
    por escopo (`"BR"` ou sigla da UF), lido de TODOS os arquivos do escopo.

    Fontes, e o escopo em que cada uma entra:
      - agregado `br`            → `"BR"`;
      - agregado `uf` da UF X    → `X` e `"BR"`;
      - zona (pré-merge) da UF X → `X` e `"BR"` (a conferência com as zonas).

    Uma candidatura entra no mapa SÓ quando todo arquivo do escopo que a lista
    concorda num destino conhecido. Qualquer outra coisa — `dvt` ausente em
    todos (começo da noite), ausente em alguns, divergente, ou valor fora do
    dicionário do TSE — deixa a candidatura FORA do mapa (regra 4), e fora do
    mapa ela é tratada exatamente como antes desta mudança: compete. Um aviso
    agregado por ciclo diz quantas e por quê.

    Candidatura sem `vap` legível num arquivo não conta como observação ali:
    é o mesmo filtro de `_extract_zone_candidatos`, isto é, o modelo também não
    a enxerga naquele arquivo.

    Sem `cargo`: o modelo lê os candidatos sem filtrar `carg[].cd`
    (`_extract_zone_candidatos(s["payload"])`), e o mapa tem de ver o mesmo
    conjunto que o modelo vê.
    """
    observado: dict[tuple[str, int], set[str]] = {}
    desconhecidos: set[str] = set()

    def _anotar(escopos: tuple[str, ...], payload: Any) -> None:
        for c in _iter_cands(payload):
            try:
                cod = int(c.get("n"))
            except (TypeError, ValueError):
                continue
            if _parse_br_number(c.get("vap")) is None:
                continue
            obs = _observar_dvt(c.get("dvt"))
            if obs == _OBS_DESCONHECIDO:
                desconhecidos.add(str(c.get("dvt")).strip())
            for escopo in escopos:
                observado.setdefault((escopo, cod), set()).add(obs)

    for s in agregados:
        if nivel_do_snapshot(s) == NIVEL_BR:
            _anotar((ESCOPO_NACIONAL,), s.get("payload"))
            continue
        sigla = _sigla_do_snapshot(s)
        escopos = (sigla, ESCOPO_NACIONAL) if sigla else (ESCOPO_NACIONAL,)
        _anotar(escopos, s.get("payload"))
    for s in zonas:
        sigla = _sigla_do_snapshot(s)
        escopos = (sigla, ESCOPO_NACIONAL) if sigla else (ESCOPO_NACIONAL,)
        _anotar(escopos, s.get("payload"))

    destinos: dict[tuple[str, int], str] = {}
    sem_decisao: dict[str, list[tuple[str, int]]] = {}
    for chave in sorted(observado):
        obs = observado[chave]
        if len(obs) == 1:
            (unico,) = obs
            if unico in _DESTINOS_CONHECIDOS:
                destinos[chave] = unico
                continue
            motivo = "sem_dvt" if unico == _OBS_AUSENTE else "desconhecido"
        elif _OBS_DESCONHECIDO in obs:
            motivo = "desconhecido"
        elif _OBS_AUSENTE in obs:
            motivo = "ausente_em_parte"
        else:
            motivo = "divergente"
        sem_decisao.setdefault(motivo, []).append(chave)

    if sem_decisao:
        _log(
            "warn",
            "destino do voto indefinido para parte das candidaturas; elas "
            "seguem COMPETINDO nas decisões (regra 4 da decisão de 2026-09-27)",
            **{f"n_{m}": len(v) for m, v in sorted(sem_decisao.items())},
            exemplos={
                m: [f"{e}:{c}" for e, c in v[:10]]
                for m, v in sorted(sem_decisao.items())
                if m != "sem_dvt"
            },
            dvt_desconhecidos=sorted(desconhecidos),
        )
    return destinos


class AnuladosNaDecisao(NamedTuple):
    """Quem fica FORA das decisões, por escopo — derivado do mapa de destino.

    `uf_segue_nacional`: Presidente decide com o destino NACIONAL em toda UF
    (a candidatura é uma só no país); Governador/Senador, com o da própria UF.
    """

    nacional: frozenset[int]
    por_uf: Mapping[str, frozenset[int]]
    uf_segue_nacional: bool

    def da_uf(self, sigla: str) -> frozenset[int]:
        if self.uf_segue_nacional:
            return self.nacional
        return self.por_uf.get(str(sigla).strip().upper(), frozenset())


SEM_ANULADOS = AnuladosNaDecisao(frozenset(), {}, False)


def anulados_na_decisao(
    destinos: Mapping[tuple[str, int], str], cargo: int
) -> AnuladosNaDecisao:
    """Recorta do mapa de destino as candidaturas `"anulado"` por escopo."""
    nacional: set[int] = set()
    por_uf: dict[str, set[int]] = {}
    for (escopo, cod), destino in destinos.items():
        if destino != DESTINO_FORA_DA_DECISAO:
            continue
        if escopo == ESCOPO_NACIONAL:
            nacional.add(int(cod))
        else:
            por_uf.setdefault(escopo, set()).add(int(cod))
    return AnuladosNaDecisao(
        frozenset(nacional),
        {uf: frozenset(v) for uf, v in por_uf.items()},
        int(cargo) == 1,
    )


def estimativas_para_decisao(
    estimates: dict[int, np.ndarray],
    anulados: frozenset[int] | set[int],
) -> dict[int, np.ndarray]:
    """Arrays de reamostra na base das DECISÕES (regra 1).

    Tira as candidaturas anuladas e reescala as demais, reamostra a
    reamostra: `f_i' = f_i / (1 − Σ f_anuladas)`. É a base "votáveis sem os
    anulados" = `vv + vansj`, onde a regra dos 50% é medida.

    Nenhuma anulada presente ⇒ devolve o PRÓPRIO dict recebido (o mesmo
    objeto): nada é recalculado, e toda decisão sai bit a bit igual à de antes.

    Reamostra em que os anulados somam 100% (`base <= 0`) ⇒ fração 0 para
    todos: não há voto que conte, ninguém fecha nada naquela reamostra.
    """
    fora = [c for c in sorted(estimates) if c in anulados]
    if not fora:
        return estimates
    soma = np.zeros_like(np.asarray(estimates[fora[0]], dtype=np.float64))
    for c in fora:
        soma = soma + np.asarray(estimates[c], dtype=np.float64)
    base = 1.0 - soma
    out: dict[int, np.ndarray] = {}
    for c, arr in estimates.items():
        if c in anulados:
            continue
        a = np.asarray(arr, dtype=np.float64)
        out[c] = np.divide(a, base, out=np.zeros_like(a), where=base > 0)
    return out


def _pct_na_base_da_decisao(
    pct: float,
    rows: list[dict[str, Any]],
    anulados: frozenset[int] | set[int],
) -> float:
    """Ponto `pct_projetado` (0–100, base `vvc`) → base das decisões.

    Mesma conta de `estimativas_para_decisao`, sobre os PONTOS das linhas de
    uma UF: `pct · 100 / (100 − Σ pct_anuladas)`. Sem anulada na UF ⇒ devolve
    `pct` intocado (nenhuma aritmética, byte a byte igual).
    """
    soma = sum(
        float(r.get("pct_projetado") or 0.0)
        for r in rows
        if int(r["candidato_id"]) in anulados
    )
    if not any(int(r["candidato_id"]) in anulados for r in rows):
        return pct
    base = 100.0 - soma
    return pct * 100.0 / base if base > 0 else 0.0


def _competidores(
    ordered: list[dict[str, Any]],
    anulados: frozenset[int] | set[int],
    *,
    onde: str,
    sigla: str,
) -> list[dict[str, Any]]:
    """As linhas de `ordered` que COMPETEM — mesma ordem, sem as anuladas.

    Nenhuma anulada ⇒ o próprio `ordered`. Todas anuladas (a UF inteira sem
    candidatura que compita — não há vencedor possível) ⇒ `ordered` também,
    com erro no log: o contrato do payload exige um `lider`, e inventar um
    "ninguém" quebraria o consumidor. Esse estado não tem como surgir de uma
    eleição real; se surgir, é dado que precisa de olho humano.
    """
    if not anulados:
        return ordered
    competem = [r for r in ordered if int(r["candidato_id"]) not in anulados]
    if competem:
        return competem
    if ordered:
        _log(
            "error",
            "todas as candidaturas da UF estão anuladas; decisões da UF "
            "caem na lista inteira",
            onde=onde,
            uf=sigla,
        )
    return ordered


def build_votacao_uf_payloads(
    agregados: list[LatestSnapshot],
    cargo: int,
    participacao_by_uf: Mapping[str, Mapping[str, ParticipacaoEstimate | None]] | None = None,
) -> dict[str, dict[str, Any]]:
    """`{sigla: EdgeVotacaoUf}` — o `votacao` de cada payload de UF dos
    cargos 1, 3, 5 e 6 (spec 022 RF-209 + spec 021 RF-192 emendado).

    Sai do agregado DA UF (`nivel = "uf"`), inclusive no Presidente — que
    tem linha `br` para o nacional mas precisa das contagens de cada UF para
    os três círculos das telas de UF.

    `projetada` (spec 021 RF-192 emendado em 2026-09-26, noite — o painel
    "Votação" entrou nas telas de UF): a MESMA regra do nacional,
    `projetar_fatias_em_contagens`, sobre as contagens DA UF e a participação
    projetada DA UF (`participacao_by_uf[sigla]`, a mesma que alimenta
    `EdgePayloadUf.participacao`). Sem participação da UF ⇒ sem `projetada`,
    e o arco 3 fica em "aguardando projeção" (RF-195).

    🔴 **Nunca a participação nacional no lugar da UF.** O parâmetro é
    indexado por sigla de propósito: a abstenção do Brasil aplicada ao
    eleitorado de uma UF publicaria um número que não é de ninguém, ao lado
    do círculo 2 exibindo a contagem verdadeira daquela UF.

    Deputado (6): `contagens` (+ `projetada` se houver participação da UF —
    o ciclo proporcional hoje não a calcula), **nunca** `corrida` (RF-200).

    UF sem linha agregada NÃO aparece no mapa — o `votacao` dela é omitido,
    que é "não sabemos", nunca zeros. `BR` nunca é UF (`_agregados_de_uf`).
    """
    cargo_i = int(cargo)
    if cargo_i not in CARGOS_COM_VOTACAO_UF:
        return {}
    participacoes = participacao_by_uf or {}
    # Spec 022 RF-210 — mesma unidade do nacional, da mesma tabela.
    vpe = _votos_por_eleitor_ou_none(cargo_i, "build_votacao_uf_payloads")
    out: dict[str, dict[str, Any]] = {}
    for sigla, (snap, bruto) in _agregados_de_uf(agregados).items():
        contagens = _contagens_de_bruto(bruto)
        bloco: dict[str, Any] = {"contagens": contagens}
        projetada = (
            projetar_fatias_em_contagens(
                contagens, participacoes.get(sigla) or {}, votos_por_eleitor=vpe
            )
            if vpe is not None
            else None
        )
        if projetada is not None:
            bloco["projetada"] = projetada
        if cargo_i in CARGOS_COM_CORRIDA:
            corrida = extrair_corrida(snap["payload"], cargo_i)
            if corrida is not None:
                bloco["corrida"] = corrida
                _com_pendencia(bloco, corrida)
        out[sigla] = bloco
    return out


def _votos_por_eleitor_ou_none(cargo: int, onde: str) -> int | None:
    """`cargos.votos_por_eleitor(cargo)`, com aviso no log quando é `None`.

    Ponto ÚNICO em que o produtor resolve a unidade voto/pessoa do cargo
    (spec 022 RF-210). Os quatro chamadores — `compute_uf_projections`,
    `compute_participacao`, `build_votacao_payload`,
    `build_votacao_uf_payloads` — leem daqui, da mesma tabela que dá
    `EdgePayloadUf.vagas` (`cargos.vagas_por_uf`), para que o fator do
    Senado não possa valer 2 num lugar e 1 no outro.

    `None` ⇒ quem chamou NÃO projeta métrica de voto. Nunca um palpite.
    """
    vpe = cargo_votos_por_eleitor(int(cargo))
    if vpe is None:
        _log(
            "warn",
            "cargo sem votos_por_eleitor declarado; metricas de VOTO nao "
            "projetadas (spec 022 RF-210)",
            cargo=int(cargo),
            onde=onde,
        )
    return vpe


def projetar_fatias_em_contagens(
    contagens: Mapping[str, int],
    participacao: Mapping[str, ParticipacaoEstimate | None],
    *,
    votos_por_eleitor: int = 1,
) -> dict[str, int] | None:
    """`votacao.projetada` (spec 021, RF-195): as quatro fatias do círculo 3
    em CONTAGENS ABSOLUTAS, projetadas para o fim da apuração.

    🔴 **CRUAS, sem reescala.** O contrato perdeu o `fator_normalizacao` em
    2026-09-26 justamente para que ninguém se sinta convidado a esticar
    estes quatro números até fecharem em `aptos`. Eles NÃO fecham, e o vão
    não é ruído: medido na captura real de 100% apurado
    (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`) o vão é
    19.722.727, dos quais 19.722.460 (99,9986%) são `anulados + sub_judice`
    e 267 são seções não instaladas. Fechar em `aptos` pediria fator 1,1376
    e publicaria 13.892.945 válidos que não existem, ao lado do círculo 2
    exibindo o número verdadeiro. O consumidor deriva o cinza por
    subtração, e ele estaciona no tamanho dos votos anulados — a verdade.

    Aritmética (a mesma extrapolação de sempre, só expressa em contagem):
      - `abstencao` projeta sobre a base `eleitores_instalados`, e ao fim da
        noite `instalados → aptos` (267 de diferença em 163 milhões). Logo
        `abstencao_projetada = p_abstencao × aptos`.
      - `validos`/`brancos`/`nulos` projetam sobre `comparecimento`, e o
        comparecimento do fim da noite é `aptos − abstencao_projetada`.
        Logo cada um é `p × (aptos − abstencao_projetada)`.

    Precisão medida contra a verdade na mesma captura: +165, +15, +15 e +40
    votos. É o ruído do bootstrap, e é 0,0001% do vão.

    🔴 **Unidade — Senado (spec 022 RF-210, 2026-09-27).** `abstencao` sai em
    PESSOAS (é `contagens.abstencao`, pessoas). `validos`/`brancos`/`nulos`
    saem em VOTOS (são `contagens.validos` etc., votos). A ponte é
    `votos_por_eleitor`: o comparecimento projetado (pessoas) vezes os votos
    que cada um deposita. As frações de voto chegam de
    `compute_participacao` sobre a base `comparecimento × votos_por_eleitor`
    (votos sobre votos), então a conta fecha: a 100% apurado,
    `validos → v.vv` e `abstencao → e.a`. Antes do fator, medido nas quatro
    capturas reais de Senador (`tests/fixtures/tse/2026-sim/senado/`): a
    fração de válidos saía 168–176% e era achatada em 100% pelo clip, e
    `projetada.validos` publicava o número de PESSOAS que compareceram
    (DF: 1.862.765 contra 3.273.238 válidos — 43% a menos), ao lado do
    círculo 2 exibindo a contagem verdadeira. `votos_por_eleitor` vem do
    chamador que conhece o cargo (`_votos_por_eleitor_ou_none`); `1` é o
    valor dos cargos de voto único.

    Devolve `None` se faltar QUALQUER uma das quatro projeções (ou `aptos`)
    — o círculo 3 vai para "aguardando projeção" **inteiro**, no DOM
    (ADR-0017/ADR-0018), em vez de desenhar três fatias e um buraco onde a
    quarta deveria estar.
    """
    aptos = int(contagens.get("aptos", 0))
    if aptos <= 0:
        return None

    fracoes: dict[str, float] = {}
    for metrica in ("abstencao", "validos", "brancos", "nulos"):
        est = participacao.get(metrica)
        if est is None:
            return None
        # `pct_projetado` está em 0–100 (convenção do payload); aqui a conta
        # é em fração.
        fracoes[metrica] = float(est["pct_projetado"]) / 100.0

    vpe = _votos_por_eleitor_valido(votos_por_eleitor)
    abstencao = fracoes["abstencao"] * aptos  # pessoas
    comparecimento = aptos - abstencao  # pessoas
    if comparecimento < 0:
        # Abstenção projetada > 100% dos aptos é impossível, mas se a
        # extrapolação estourar não publicamos comparecimento negativo.
        return None
    votos = comparecimento * vpe  # votos — a base das três fatias de voto

    return {
        "validos": int(round(fracoes["validos"] * votos)),
        "brancos": int(round(fracoes["brancos"] * votos)),
        "nulos": int(round(fracoes["nulos"] * votos)),
        "abstencao": int(round(abstencao)),
    }


def build_votacao_payload(
    agregados: list[LatestSnapshot],
    cargo: int,
    participacao: Mapping[str, ParticipacaoEstimate | None] | None = None,
) -> dict[str, Any] | None:
    """O bloco `votacao` do payload (spec 021, RF-199 + RF-195).

    `contagens` é obrigatório: sem ele não há bloco (RF-198 — a tela cai em
    `<DetailUnavailable>`, nunca em zeros). `projetada` é opcional e só
    aparece quando as quatro métricas existem — o círculo 3 tem seu próprio
    estado "aguardando projeção".

    Os dois estados do payload, que são DIFERENTES (decisão do dono, 14/09):
      - bloco ausente ⇒ **"não sabemos"** (nada agregado chegou);
      - `contagens` com `aptos > 0` e as fatias em zero ⇒ **"não começou"**
        (RF-193b), e é publicado de propósito assim que `e.te` é conhecido.
    """
    contagens = somar_contagens_agregadas(agregados, cargo)
    if contagens is None:
        return None
    bloco: dict[str, Any] = {"contagens": contagens}
    # Spec 022 RF-210 — cargo sem unidade declarada não projeta (círculo 3
    # "aguardando projeção"); o Senado projeta em votos.
    vpe = _votos_por_eleitor_ou_none(cargo, "build_votacao_payload")
    projetada = (
        projetar_fatias_em_contagens(
            contagens, participacao or {}, votos_por_eleitor=vpe
        )
        if vpe is not None
        else None
    )
    if projetada is not None:
        bloco["projetada"] = projetada
    # Spec 022 (RF-209) — a corrida sai do MESMO agregado das contagens.
    # Deputado (6) devolve `{}` lá dentro (RF-200).
    bloco.update(montar_corrida_nacional(agregados, cargo))
    return bloco


def build_participacao_payload(
    abstencao: ParticipacaoEstimate | None,
    brancos_nulos: ParticipacaoEstimate | None,
    outros: dict[str, Any] | None,
    pct_apurado: float,
    metodo_tipo: str = "extrapolacao_apurado",
    n_zonas_imputadas: int = 0,
) -> dict[str, Any] | None:
    """Monta o bloco `participacao` do payload Edge Config (Fase 1a —
    D3 denominador misto rotulado, D4 outros com IC real, D5 regra de
    três, D6 shape `participacao?`).

    Omite a chave inteira de cada métrica (`abstencao`/`brancos_nulos`/
    `outros`) quando o dado subjacente não pôde ser calculado (0 zonas
    úteis para participação, ou <4 candidatos para "outros"). Retorna
    `None` (bloco `participacao` inteiro omitido) se NENHUMA das três
    métricas está disponível — evita emitir `{"metodo": {...}}` órfão,
    sem nenhum dado real por trás.

    `metodo.n_zonas` = MAIOR `n_zonas` entre `abstencao`/`brancos_nulos`
    disponíveis (as duas métricas podem ter conjuntos de zonas úteis
    ligeiramente diferentes — zona com `comparecimento == 0` mas
    `eleitores_instalados > 0`, por exemplo — o maior é o mais
    representativo do "quanto já apuramos" para efeito de rótulo).

    `metodo_tipo`/`n_zonas_imputadas` (plano § B, RF-017 2o nível):
    propagados pelo CALLER a partir do `metodo` já calculado por
    `compute_uf_projections`/`_uf_projection_row` para os CANDIDATOS
    desta mesma UF/nacional — `"imputado_nacional"` quando a UF inteira
    caiu no fallback de `impute_uf_from_national` (nenhuma zona própria
    apurada). Participação (turnout.py) continua com seu próprio cálculo
    zona-a-zona independente; este campo só rotula a UI (RF-062).
    """
    out: dict[str, Any] = {}
    n_zonas = 0
    if abstencao is not None:
        out["abstencao"] = _participacao_metric_payload(
            abstencao, "eleitores_instalados"
        )
        n_zonas = max(n_zonas, abstencao["n_zonas"])
    if brancos_nulos is not None:
        out["brancos_nulos"] = _participacao_metric_payload(
            brancos_nulos, "comparecimento"
        )
        n_zonas = max(n_zonas, brancos_nulos["n_zonas"])
    if outros is not None:
        out["outros"] = outros
    if not out:
        return None
    out["metodo"] = {
        "tipo": metodo_tipo,
        "n_zonas": n_zonas,
        "pct_apurado": pct_apurado,
        "n_zonas_imputadas": n_zonas_imputadas,
    }
    return out


def _participacao_de_brancos_nulos(
    est: UfCandidatosEstimate | None,
) -> ParticipacaoEstimate | None:
    """Adapta o `brancos_nulos_comparecimento` de `extrapolation.py` para o
    shape `ParticipacaoEstimate` que o payload já consome.

    Fase 5 do plano § A ("Coerência das bases (E2)"): `brancos_nulos` DEIXA
    de sair de `turnout.py`. Lá ele tinha seed própria e estimador próprio
    (média de frações por zona ponderada por `weight`), e o resultado era
    uma tela em que candidatos + brancos/nulos somavam 100 ± 0,3 pp — o
    site dividia um inteiro e publicava partes que não fechavam nele. Vindo
    do MESMO `idx` do bootstrap dos candidatos, a identidade
    `Σ_c share_comp + bn == 1` passa a valer resample a resample.

    `None` quando a UF não observou nada (imputada do nacional) — a UI
    mostra "aguardando projeção", nunca um número inventado.
    """
    if est is None:
        return None
    bn = est.get("brancos_nulos_comparecimento")
    if bn is None:
        return None
    return {
        "pct_atual": bn["pct_atual_comparecimento"],
        "pct_projetado": bn["pct_projetado_comparecimento"],
        "lower": bn["lower_comparecimento"],
        "upper": bn["upper_comparecimento"],
        "n_zonas": est["n_zonas"],
        # `num`/`den` são as CONTAGENS BRUTAS observadas — é delas que
        # `aggregate_national_participacao` tira o `pct_atual` nacional
        # (Σnum/Σden, não média de percentuais das UFs).
        "num": bn["votos_atuais"],
        "den": est["comparecimento_observado"],
        "estimates": bn["estimates_comparecimento"],
    }


def compute_participacao(
    cargo: int,
    turno: int,
    seed_base: int,
    snapshots: list[LatestSnapshot],
    eleitorado: dict[tuple[str, int], int],
    cand_by_uf: dict[str, UfCandidatosEstimate] | None = None,
) -> tuple[
    dict[str, dict[str, ParticipacaoEstimate | None]],
    dict[str, ParticipacaoEstimate | None],
]:
    """Fiação da Fase 1a (RF-020.1) — projeta abstenção por UF (regra de
    três, D5, `turnout.py`) e agrega nacionalmente; brancos/nulos vêm de
    `extrapolation.py` desde a Fase 5.

    `cand_by_uf` (Fase 5, plano § A) é a saída de
    `compute_uf_projections` — quando fornecido, `brancos_nulos` sai do
    MESMO bootstrap dos candidatos (`_participacao_de_brancos_nulos`) e
    `turnout.py` não é mais consultado para essa métrica. Sem ele
    (callers legados/testes), o caminho antigo continua valendo — é a
    única razão de o parâmetro ser opcional.

    Reusa o MESMO snapshot mais recente por zona já lido por
    `fetch_snapshots`/consumido por `compute_uf_projections` — nenhuma
    query adicional ao Postgres. Extrai participação via
    `_extract_zone_participacao` (não `_extract_zone_candidate_pcts` —
    aquele lê candidatos, este lê os objetos de raiz `e`/`v`/`s`).

    Determinismo (§ 6): seed por `(uf, metric)` derivado do MESMO padrão de
    `local_seed` em `compute_uf_projections` (XOR do `seed_base` com os 8
    primeiros hex de `sha256(f"{uf}:{metric}")`) — reprodutível, e
    descorrelacionado entre UFs/métricas diferentes (evita que abstenção e
    brancos/nulos da mesma UF, ou a mesma métrica em UFs diferentes,
    reamostrem exatamente os mesmos índices).

    Returns:
        `(by_uf, nacional)`:
          - `by_uf`: `{uf: {"abstencao": Estimate|None, "brancos_nulos":
            Estimate|None}}`.
          - `nacional`: `{"abstencao": Estimate|None, "brancos_nulos":
            Estimate|None}` agregado via `aggregate_national_participacao`.
    """
    # `_snapshots_por_uf` (não `setdefault` cru): descarta `BR`/UF vazia —
    # ver a docstring dele. Uma linha nacional aqui entraria na agregação
    # como 28ª UF.
    snaps_by_uf = _snapshots_por_uf(snapshots)

    eleitorado_total_by_uf = _eleitorado_total_by_uf(eleitorado)

    metrics: tuple[ParticipacaoMetric, ...] = (
        "abstencao",
        "brancos_nulos",
        "validos",
        "brancos",
        "nulos",
    )
    # Spec 022 RF-210 — as quatro métricas de VOTO são votos sobre votos
    # (`comparecimento × votos_por_eleitor`); `abstencao` é pessoas sobre
    # pessoas e não depende do fator. Cargo sem fator declarado ⇒ as métricas
    # de voto ficam `None` ("aguardando projeção"), nunca um palpite de 1 ou 2.
    vpe = _votos_por_eleitor_ou_none(cargo, "compute_participacao")
    by_uf: dict[str, dict[str, ParticipacaoEstimate | None]] = {}

    for uf, snaps in snaps_by_uf.items():
        zonas: list[ZonaParticipacao] = []
        pct_num = 0.0
        for s in snaps:
            w = _resolve_zone_weight(
                uf, s["cod_zona"], eleitorado, eleitorado_total_by_uf
            )
            if w > 0:
                pct_num += s["pct_apurado"] * w
            raw = _extract_zone_participacao(s["payload"])
            if raw is None or w <= 0:
                continue
            zona: ZonaParticipacao = {**raw, "cod_zona": s["cod_zona"], "weight": w}  # type: ignore[typeddict-item]
            zonas.append(zona)
        # Mesmo fix de `compute_uf_projections` acima: denominador é o
        # eleitorado TOTAL da UF, não a soma dos pesos das zonas
        # presentes no snapshot (gêmeo do bug — zonas ausentes apuraram
        # 0%, não devem sumir do denominador).
        pct_den = eleitorado_total_by_uf.get(uf, 0)
        pct_apurado_uf = pct_num / pct_den if pct_den > 0 else 0.0

        uf_result: dict[str, ParticipacaoEstimate | None] = {}
        for metric in metrics:
            if metric != "abstencao" and vpe is None:
                uf_result[metric] = None
                continue
            # Fase 5 — brancos/nulos NÃO passa mais por `turnout.py` quando
            # o caller entregou o resultado do bootstrap de candidatos.
            # Nenhuma seed é derivada aqui para essa métrica: o valor vem do
            # `idx` que já sorteou os candidatos da mesma UF, e é isso que
            # faz a soma fechar exatamente em 100 na base comparecimento.
            if metric == "brancos_nulos" and cand_by_uf is not None:
                uf_result[metric] = _participacao_de_brancos_nulos(
                    cand_by_uf.get(uf)
                )
                continue
            local_seed = (
                seed_base
                ^ int(
                    hashlib.sha256(f"{uf}:{metric}".encode("utf-8")).hexdigest()[:8],
                    16,
                )
            ) & 0xFFFFFFFF
            uf_result[metric] = estimate_uf_participacao(
                zonas,
                metric,
                pct_apurado_uf,
                local_seed,
                # `abstencao` ignora o fator (pessoas/pessoas); as de voto o
                # usam. `vpe` não é `None` aqui: ver o `continue` acima.
                votos_por_eleitor=vpe if vpe is not None else 1,
            )
        by_uf[uf] = uf_result

    nacional: dict[str, ParticipacaoEstimate | None] = {}
    for metric in metrics:
        per_uf_estimates = {uf: r.get(metric) for uf, r in by_uf.items()}
        nacional[metric] = aggregate_national_participacao(
            per_uf_estimates, eleitorado_total_by_uf
        )

    return by_uf, nacional


def _national_votos_por_candidato(
    municipio_aggregates: dict[tuple[str, int], dict[str, Any]],
) -> tuple[dict[int, int], int]:
    """Soma `votos_por_candidato`/`total_votos` de TODOS os municípios
    (todas as UFs) — usado para popular `pct_atual` nacional real
    (Fase 1a §1a.2) a partir do MESMO dado já lido por
    `fetch_municipio_aggregates` (sem query adicional).
    """
    votos: dict[int, int] = {}
    total = 0
    for _key, agg in municipio_aggregates.items():
        total += int(agg.get("total_votos") or 0)
        for cid, v in agg.get("votos_por_candidato", {}).items():
            cid_int = int(cid)
            votos[cid_int] = votos.get(cid_int, 0) + int(v)
    return votos, total


class CargoProporcionalError(ValueError):
    """Cargo proporcional entrou onde só cabe corrida majoritária.

    Não é um erro de digitação de quem chamou: é a barreira que impede um
    agregado nacional inválido de sair publicado com cara de válido (design
    017, D3). Ver `compute_national`.
    """


def _e_proporcional(cargo: int) -> bool:
    """O cargo elege por lista proporcional? (`lib/config/cargos.ts`)."""
    info = cargo_info(cargo)
    return bool(info is not None and info["proporcional"])


def compute_national(
    cargo: int,
    turno: int,
    estimates_by_uf: dict[str, dict[int, np.ndarray]],
    eleitorado_total_by_uf: dict[str, int],
    votos_by_uf: dict[int, int] | None = None,
    *,
    anulados: frozenset[int] | set[int] = frozenset(),
) -> tuple[
    list[dict[str, Any]],
    float,
    int | None,
    int | None,
    tuple[np.ndarray, int],
]:
    """Agrega estimates UF → nacional ponderado pelo eleitorado da UF.

    `anulados` (decisão do dono de 2026-09-27): candidaturas de voto anulado.
    Continuam com linha, `pct_projetado` e IC sobre `vvc` (exibição intocada,
    e `rank`/"Outros" seguem a ordem da exibição), mas saem das DECISÕES: não
    viram `cand_a`/`cand_b`, recebem `p_vitoria`/`p_passa_2t`/`p_fecha_1t` =
    0.0, e as demais decidem sobre `estimativas_para_decisao` (base sem os
    anulados). Vazio (default) ⇒ saída bit a bit igual à anterior.

    Para cada candidato `c`:
        national_estimates[c] = Σ_uf (estimates[uf][c] * eleitorado[uf]) / Σ eleitorado
    O array nacional preserva o pareamento por índice de resample (constituição
    § 6), permitindo comparação A vs B em `p_vitoria` (T10).

    Identificação de "A" e "B" (FIX S04 — carry-over #1 da retro S03):
      A = líder por `mean(estimates_c)` (o `pct_projetado` nacional)
      B = segundo lugar pelo mesmo critério
      Tie-breaker (mesmo pct até 1e-9): `candidato_id` ASCENDENTE — estável
      e reprodutível. Empate exato é raro (somas de floats nunca batem
      exatamente em dataset real); o tie-breaker existe para garantir
      determinismo bit-a-bit em fixtures sintéticas.

      A versão anterior usava A = `min(candidato_id)`, o que invertia a
      agulha quando o id do PT > id do PL (replay 2022 detectou o bug:
      A=Ciro 3022112 < Lula 3022113 → `p_vitoria_a` semanticamente errado).

    Retorna:
        - `rows`: linhas nacionais (uma por candidato; com `p_vitoria`
          individual = P(c > max(outros))).
        - `p_vitoria_a`: P(líder > segundo). Se <2 candidatos → 1.0 ou 0.0.
        - `cand_a_id`: id do líder, ou None se 0 candidatos.
        - `cand_b_id`: id do segundo, ou None se ≤1 candidato.
        - `outros`: `(estimates, n_candidatos)` de `compute_outros_estimates`
          (D4 — "Outros" com IC real, soma de resamples de rank >= 4).
          `n_candidatos == 0` se <4 candidatos na corrida.

    `votos_by_uf` (RF-014, plano § B): `{cod_candidato: total_votos}` já
    somado UF -> Brasil por `extrapolation.aggregate_national_votos` —
    quando fornecido, popula `rows[*]["votos_projetados"]` com o total
    REAL (em vez de `None`). Assinatura estável para callers legados
    (`replay_batch.py`) que não têm esse dado.

    **Cargo proporcional é RECUSADO** (design 017, D3; `CargoProporcionalError`).
    Esta função agrega por `candidato_id`, que na corrida proporcional é o
    número de urna — e ele se repete entre UFs e entre partidos. Agregar por
    ele funde candidatos distintos: as linhas por UF continuam certas e a linha
    nacional sai inválida, sem erro nenhum. A visão nacional do Deputado é a
    **bancada** (`api/model/deputado_payload.py`), que é soma de 27 corridas, e
    não uma estimativa nacional.

    Raises:
        CargoProporcionalError: cargo com `proporcional: true` em
            `lib/config/cargos.ts` (hoje, o 6 — Deputado Federal).
    """
    if _e_proporcional(cargo):
        raise CargoProporcionalError(
            f"cargo {cargo} é proporcional — `compute_national` agrega por número "
            "de urna, que se repete entre UFs e partidos nesta corrida. A visão "
            "nacional do Deputado Federal é a bancada somada das 27 UFs "
            "(`api/model/deputado_payload.py`), não um agregado de candidatos."
        )

    _empty_outros: tuple[np.ndarray, int] = (np.zeros(0, dtype=np.float64), 0)

    # Reúne candidatos vistos.
    all_candidates: set[int] = set()
    for cand_map in estimates_by_uf.values():
        all_candidates.update(cand_map.keys())

    if not all_candidates:
        return [], 0.0, None, None, _empty_outros

    # Determina shape do array nacional pelo primeiro estimates não vazio.
    sample_arr: np.ndarray | None = None
    for cand_map in estimates_by_uf.values():
        for arr in cand_map.values():
            sample_arr = arr
            break
        if sample_arr is not None:
            break
    if sample_arr is None:
        return [], 0.0, None, None, _empty_outros

    n_resamples = sample_arr.shape[0]

    national_estimates: dict[int, np.ndarray] = {}
    total_eleitorado = sum(eleitorado_total_by_uf.values())
    if total_eleitorado <= 0:
        return [], 0.0, None, None, _empty_outros

    for cand in all_candidates:
        agg = np.zeros(n_resamples, dtype=np.float64)
        weight_sum = 0
        for uf, cand_map in estimates_by_uf.items():
            arr = cand_map.get(cand)
            if arr is None:
                continue
            w = eleitorado_total_by_uf.get(uf, 0)
            if w <= 0:
                continue
            agg += arr * w
            weight_sum += w
        if weight_sum > 0:
            national_estimates[cand] = agg / weight_sum

    if not national_estimates:
        return [], 0.0, None, None, _empty_outros

    # Ordenação SEMÂNTICA: A = líder por pct_projetado (mean), B = segundo.
    # Tie-breaker estável: candidato_id ASCENDENTE (segundo elemento do tuple).
    # Negate o mean para `sorted` ASC nos dois critérios — Python sorts são
    # estáveis, então (-mean, id) reproduz "pct desc, id asc" determinístico.
    point_by_cand: dict[int, float] = {
        cand: float(np.mean(arr)) for cand, arr in national_estimates.items()
    }
    ordered = sorted(
        national_estimates.keys(),
        key=lambda c: (-point_by_cand[c], c),
    )

    # Decisão do dono de 2026-09-27 — as DECISÕES saem da base sem os
    # anulados. Sem anulado presente, `decisao is national_estimates` e
    # `ordered_dec is ordered`: nada muda, bit a bit.
    decisao = estimativas_para_decisao(national_estimates, anulados)
    if decisao is national_estimates:
        ordered_dec = ordered
    else:
        point_dec = {cand: float(np.mean(arr)) for cand, arr in decisao.items()}
        ordered_dec = sorted(decisao.keys(), key=lambda c: (-point_dec[c], c))

    cand_a = ordered_dec[0] if ordered_dec else None
    cand_b = ordered_dec[1] if len(ordered_dec) >= 2 else None

    if cand_a is None:
        p_a = 0.0
    elif cand_b is None:
        p_a = 1.0
    else:
        p_a = p_vitoria(decisao[cand_a], decisao[cand_b])

    # S05/F4c (ADR-0014) — métricas multi-candidato pré-computadas a partir
    # do mesmo `national_estimates`. Zero novo bootstrap, zero random.
    p_passa_2t_by_cand = compute_p_passa_2t(decisao)
    p_fecha_1t_by_cand = compute_p_fecha_1t(decisao)

    # `rank` semântico por (-point, id) — mesma ordenação do `ordered` acima.
    rank_by_cand: dict[int, int] = {cand: i + 1 for i, cand in enumerate(ordered)}

    # D4 — "Outros" com IC real: soma de resamples de rank >= 4. Zero novo
    # bootstrap, zero random (mesma filosofia de `p_passa_2t`/`p_fecha_1t`
    # acima — pura função dos `national_estimates` já computados).
    outros = compute_outros_estimates(national_estimates, rank_by_cand, min_rank=4)

    rows: list[dict[str, Any]] = []
    for cand, arr in national_estimates.items():
        point = point_by_cand[cand]
        ci_lower = float(np.percentile(arr, 2.5))
        ci_upper = float(np.percentile(arr, 97.5))
        # p_vitoria por candidato: vs o melhor adversário (max dos outros)
        # QUE COMPETE. Candidatura anulada não disputa: 0.0.
        if cand not in decisao:
            pv = 0.0
        elif len(ordered_dec) >= 2:
            others_max = np.max(
                np.stack(
                    [decisao[c] for c in ordered_dec if c != cand], axis=0
                ),
                axis=0,
            )
            pv = float(np.mean(decisao[cand] > others_max))
        else:
            pv = 1.0
        # Escala (docs/architecture/data-model.md § "Escala de percentuais"):
        # `point`/`ci_lower`/`ci_upper` vêm de `national_estimates` (fração
        # [0,1], mesmo espaço de `estimates_by_uf`). `rows` — consumido por
        # `insert_projections`, `build_uf_payloads`, `build_edge_payload` —
        # espera 0–100. `p_vitoria` continua em [0,1] (é probabilidade, não
        # percentual).
        rows.append(
            {
                "cargo": cargo,
                "turno": turno,
                "uf": None,  # NULL = nacional
                "candidato_id": cand,
                "votos_projetados": (
                    int(votos_by_uf.get(cand, 0)) if votos_by_uf is not None else None
                ),
                "pct_projetado": _frac_to_pct(point),
                "pct_projetado_lower": _frac_to_pct(ci_lower),
                "pct_projetado_upper": _frac_to_pct(ci_upper),
                "p_vitoria": pv,
                "pct_apurado": None,
                # S05/F4c — métricas multi-candidato enriquecidas. Persistem
                # apenas na "memória" do orchestrator; o INSERT em
                # `projections` só usa as colunas declaradas em
                # `insert_projections` — campos extras são ignorados.
                "rank": rank_by_cand.get(cand, 0),
                "p_passa_2t": p_passa_2t_by_cand.get(cand, 0.0),
                "p_fecha_1t": p_fecha_1t_by_cand.get(cand, 0.0),
            }
        )

    return rows, p_a, cand_a, cand_b, outros


# ---------------------------------------------------------------------------
# Mesorregião aggregation (S06/F4d — Fase 2)
# ---------------------------------------------------------------------------


def aggregate_by_mesorregiao(
    uf_row: dict[str, Any],
    municipios: list[dict[str, Any]],
    historical_by_meso: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Agrega municípios por mesorregião IBGE — S06/F4d.

    Alimenta o bloco "Apuração por mesorregião" da página
    `/uf/[sigla]/governador` (spec 005, print 3 NYT-style). Determinista:
    pure function de (uf_row, municipios) — pode ser unit-tested sem DB.

    Args:
        uf_row: Linha de `EdgeUfRow` da UF (para identificar UF). Usa só
            `sigla` (pra cross-check) — campos não-críticos.
        municipios: Lista de municípios da UF, enriquecidos com
            `mesorregiao_cod` (4-char string) e `mesorregiao_nome` (str).
            Aceita campos faltantes — município sem `mesorregiao_cod` é
            silenciosamente skipped (forward-compat com Postgres pré-S06
            que ainda não tem a coluna populada). Cada município deve ter:
              - `cod_ibge`: str (debug only)
              - `mesorregiao_cod`: str | None
              - `mesorregiao_nome`: str | None
              - `pct_apurado`: float (0–100)
              - `lider` (dict): `{candidato_id, votos, partido, margem_pp}`
              - `votos_reportados` (dict): `{candidato_id: votos}`
        historical_by_meso: Opcional `{cod_meso: pct_lider_2022}` para
            calcular `delta_vs_2022`. Quando ausente ou cod_meso não está
            no mapa, `delta_vs_2022 = None` (UI mostra "—").

    Returns:
        Lista de mesorregiões da UF — uma entrada por `mesorregiao_cod`
        distinto entre os municípios. Cada entrada:

        ```python
        {
            "nome": str,                       # nome IBGE da mesorregião
            "cod": str,                        # 4-char IBGE code
            "pct_apurado": float,              # média ponderada pelo total_votos
            "lider_candidato_id": int,         # candidato com mais votos agregados
            "lider_pct": float,                # % do líder sobre o total da meso
            "margem": float,                   # margem em pp (lider - 2º)
            "delta_vs_2022": float | None,     # swing pp vs 2022 (ou None)
            "num_municipios": int,             # quantos municípios na meso
        }
        ```

        Ordem determinística (constituição § 6): sort por `cod` ASC.

    Edge cases:
        - `municipios` vazio → `[]`
        - Todos sem `mesorregiao_cod` → `[]` (UI omite o bloco; aceitável
          em dev/preview sem CSV de mesorregião populado)
        - Mesorregião com 0 votos reportados → `pct_apurado = 0`,
          `lider_pct = 0`, `margem = 0`. Líder degenerado: primeiro
          candidato lexicográfico nos `votos_reportados` (estabilidade).
        - 1 município com `lider.candidato_id == 0` (placeholder) → entra
          na agregação normalmente; resultado pode ter `lider_id = 0`.
    """
    # Sanity check (defensivo): se `uf_row` tem sigla, garante consistência
    # com os municípios passados. Não falha — apenas loga. Útil pra pegar
    # bug de orchestrator passando municípios da UF errada.
    expected_uf = uf_row.get("sigla") if isinstance(uf_row, dict) else None
    if expected_uf:
        for m in municipios:
            uf_m = m.get("uf")
            if uf_m and uf_m != expected_uf:
                _log(
                    "warn",
                    "aggregate_by_mesorregiao uf mismatch",
                    expected=expected_uf,
                    found=uf_m,
                    cod_ibge=m.get("cod_ibge"),
                )
                break  # 1 warn é suficiente

    # Agrupa por mesorregiao_cod.
    by_meso: dict[str, dict[str, Any]] = {}
    for m in municipios:
        cod = m.get("mesorregiao_cod")
        if not cod:
            continue
        nome = m.get("mesorregiao_nome") or f"Meso {cod}"
        entry = by_meso.setdefault(
            cod,
            {
                "cod": cod,
                "nome": nome,
                "_votos_por_cand": {},  # cand_id -> votos somados
                "_total_votos": 0,
                "_sum_pct_apurado_x_votos": 0.0,
                "_num_municipios": 0,
            },
        )
        # Soma votos por candidato.
        votos_reportados = m.get("votos_reportados") or {}
        munic_total = 0
        for cand_id, votos in votos_reportados.items():
            v = int(votos)
            entry["_votos_por_cand"][int(cand_id)] = (
                entry["_votos_por_cand"].get(int(cand_id), 0) + v
            )
            munic_total += v
        entry["_total_votos"] += munic_total
        # Média ponderada de pct_apurado pelo total_votos do município
        # (consistência com a UF: município pequeno com 0% apurado e
        # município grande com 90% apurado dá um agregado realista).
        pct_ap = float(m.get("pct_apurado") or 0.0)
        entry["_sum_pct_apurado_x_votos"] += pct_ap * munic_total
        entry["_num_municipios"] += 1

    # Materializa saída.
    out: list[dict[str, Any]] = []
    for cod in sorted(by_meso.keys()):
        e = by_meso[cod]
        total = e["_total_votos"]
        votos_cand = e["_votos_por_cand"]

        if total > 0 and votos_cand:
            # Top-2 por votos absolutos. Tie-break por candidato_id ASC.
            sorted_cands = sorted(
                votos_cand.items(), key=lambda kv: (-kv[1], kv[0])
            )
            lider_id, lider_votos = sorted_cands[0]
            second_votos = sorted_cands[1][1] if len(sorted_cands) >= 2 else 0
            lider_pct = 100.0 * lider_votos / total
            margem = 100.0 * (lider_votos - second_votos) / total
        elif votos_cand:
            # Degenerado: tem cand_id mas total=0 (todos zero). Estável.
            lider_id = min(votos_cand.keys())
            lider_pct = 0.0
            margem = 0.0
        else:
            # Sem votos reportados em nenhum município. Líder degenerado: 0.
            lider_id = 0
            lider_pct = 0.0
            margem = 0.0

        # pct_apurado ponderado pelo total_votos da mesorregião. Se total=0,
        # cai pra média simples dos municípios (preferível a NaN/0).
        if total > 0:
            pct_apurado_meso = e["_sum_pct_apurado_x_votos"] / total
        else:
            # Sem votos ainda — divide pelo número de municípios para
            # evitar 0 absoluto quando alguns têm pct_apurado > 0 mas
            # ninguém reportou votos (caso teórico). Em prática vai dar 0.
            n_munic = e["_num_municipios"]
            pct_apurado_meso = (
                e["_sum_pct_apurado_x_votos"] / max(n_munic, 1) if n_munic else 0.0
            )

        # delta_vs_2022 — opcional.
        if historical_by_meso is not None and cod in historical_by_meso:
            delta = lider_pct - float(historical_by_meso[cod])
        else:
            delta = None

        out.append(
            {
                "nome": e["nome"],
                "cod": cod,
                "pct_apurado": float(pct_apurado_meso),
                "lider_candidato_id": int(lider_id),
                "lider_pct": float(lider_pct),
                "margem": float(margem),
                "delta_vs_2022": float(delta) if delta is not None else None,
                "num_municipios": int(e["_num_municipios"]),
            }
        )

    return out


# ---------------------------------------------------------------------------
# Edge Config publication (T16b — Fase 5)
# ---------------------------------------------------------------------------


def _needle_band(position: float) -> str:
    """Mapeia `needle_position` em [-1, 1] para uma das 7 bandas do contrato TS.

    Bordas espelham `api/model/p_vitoria.py` (T10) e `lib/edge-config/types.ts`
    `NeedleBand`. Mantemos um helper local porque `p_vitoria.needle_position`
    devolve `(position, band)` apenas pra um cenário nacional binário; aqui
    cobrimos qualquer entrada com clip + bandas explícitas.
    """
    p = max(-1.0, min(1.0, position))
    if p >= 0.85:
        return "very_likely_a"
    if p >= 0.50:
        return "likely_a"
    if p >= 0.20:
        return "lean_a"
    if p > -0.20:
        return "tossup"
    if p > -0.50:
        return "lean_b"
    if p > -0.85:
        return "likely_b"
    return "very_likely_b"


def _resolve_internal_base_url() -> str:
    """Base URL para o endpoint Node `/api/internal/edge-write`.

    Mesma estratégia do lado TS: env explícita > VERCEL_URL > localhost.
    """
    explicit = os.environ.get("INTERNAL_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    vercel_url = os.environ.get("VERCEL_URL")
    if vercel_url:
        return f"https://{vercel_url}"
    port = os.environ.get("PORT", "3000")
    return f"http://localhost:{port}"


def build_uf_payloads(
    cargo: int,
    turno: int,
    ts_iso: str,
    uf_rows: list[dict[str, Any]],
    national_rows: list[dict[str, Any]],
    municipio_aggregates: dict[tuple[str, int], dict[str, Any]],
    zona_municipio: dict[tuple[str, int, int], dict[str, Any]],
    series_by_uf: dict[str, list[dict[str, Any]]],
    estimates_by_uf: dict[str, dict[int, np.ndarray]] | None = None,
    participacao_by_uf: dict[str, dict[str, ParticipacaoEstimate | None]] | None = None,
    estimates_c_by_uf: dict[str, dict[int, np.ndarray]] | None = None,
    p_eleito_by_uf: dict[str, dict[int, float]] | None = None,
    vagas: int | None = None,
    partido_by_cand: dict[int, str] | None = None,
    relogio_by_uf: dict[str, RelogioDoDado] | None = None,
    identidade_by_cand: dict[tuple[str, int], dict[str, str]] | None = None,
    serie_bruta: SeriePorCandidatoBruta | None = None,
    votacao_by_uf: dict[str, dict[str, Any]] | None = None,
    anulados: AnuladosNaDecisao | None = None,
) -> dict[str, dict[str, Any]]:
    """Constrói payloads canônicos `EdgePayloadUf` por UF (S04/F2).

    ADR-0053 / RF-213 acrescenta `anulados`: o líder e o 2º da UF — que dão a
    agulha da UF e o líder degenerado do município sem voto — saem das
    candidaturas que COMPETEM. `candidatos[]` (lista, %, rank local, "Outros")
    é exibição e não muda. `None` ⇒ comportamento anterior, byte a byte.

    Spec 022 (RF-209) acrescenta `votacao_by_uf` (`{uf: EdgeVotacaoUf}`, de
    `build_votacao_uf_payloads`): contagens e corrida do agregado da UF.
    UF ausente do mapa ⇒ a chave `votacao` não aparece ("não sabemos").

    Adicionado em S04/F2 para enriquecer o drill-down de UF com:
      - candidatos com `votos_atuais` e `votos_projetados` (rateio do
        total UF pelo pct_atual/pct_projetado de cada candidato);
      - lista `municipios` populada (`cod_ibge`, `nome`, `pct_apurado`,
        `lider {id, partido, votos, margem_pp}`, `votos_reportados`);
      - `series_temporais` (margem, p_vitoria, turnout) lidas de
        `projections` ordenadas por ts ASC.

    Fase 1a (RF-020.1, D3/D4/D5/D6) acrescenta, quando os parâmetros
    opcionais são passados:
      - `estimates_by_uf`: `{uf: {cand_id: ndarray}}` (mesmo output de
        `compute_uf_projections`) — usado para "Outros" com IC real
        (`compute_outros_estimates`, rank LOCAL da UF — top-3 da corrida
        estadual, não o rank nacional usado para cor).
      - `participacao_by_uf`: `{uf: {"abstencao": Estimate|None,
        "brancos_nulos": Estimate|None}}` (output de
        `compute_participacao`) — regra de três por UF.
    Ambos `None` (default, compat retroativa) → `uf_payload` não ganha a
    chave `participacao` (mesmo comportamento anterior à Fase 1a).

    Spec 016 (Senador) acrescenta mais três parâmetros opcionais, todos
    `None` por default e todos emitindo campos OPCIONAIS do contrato TS —
    a mesma disciplina de `eleitores?`/`capital?` no ADR-0035 D2, para que
    um Global Config já gravado e as fixtures existentes sigam válidos:
      - `p_eleito_by_uf` (RF-103): `{uf: {cand: p}}` de
        `compute_p_eleito_by_uf`. Vira `candidatos[].p_eleito`.
      - `vagas` (RF-105/RF-106): quantas cadeiras a UF elege neste cargo.
        Vira `EdgePayloadUf.vagas` — é o que permite a tela marcar DUAS
        linhas de vaga sem hardcodar "2" na UI.
      - `partido_by_cand` (RF-107): `{cand: sigla}` de
        `extract_partido_by_cand`. Tem PRECEDÊNCIA sobre o `partido` das
        linhas nacionais, que em produção nunca foi populado.

    Spec 018 (RF-144) acrescenta um quarto, pela mesma disciplina:
      - `identidade_by_cand`: `{(uf, numero): {"nome", "sqcand"}}` de
        `extract_identidade_by_cand`. Vira `candidatos[].nome` (no lugar do
        `"Candidato {id}"` literal) e `candidatos[].sqcand`. **A chave é o
        par, nunca o número sozinho** — ADR-0042; ver a docstring do
        extrator para o porquê. Ausente → o placeholder de sempre, que é a
        razão de o parâmetro ser opcional e não obrigatório.

    Retorna `{uf_sigla: EdgePayloadUf}`. Cada payload tem ~5–10 KB em
    UF típica, podendo chegar a 30–40 KB em SP (645 municípios + 480
    pontos × 3 séries). Caller (`writeProjection`) emite warn se passar
    de 450 KB.

    Determinismo (§ 6): municípios ordenados por `cod_ibge` ASC; séries
    ordenadas por ts ASC. Sem entradas aleatórias.

    Tolerância: município sem `cod_ibge` (ainda não seedado) → skip. UF
    sem municípios populados → `municipios: []` (mapa fica vazio mas
    page renderiza).
    """
    # Index uf_rows por (uf, candidato) e por uf-only (1ª row = pct_apurado UF).
    uf_by_sigla: dict[str, list[dict[str, Any]]] = {}
    for r in uf_rows:
        if r.get("uf") is None:
            continue
        uf_by_sigla.setdefault(r["uf"], []).append(r)

    # Dict cand_id → row nacional para resolver partido/cor/nome.
    # S05/F4c (ADR-0013): `rank` populado em national_rows define `--color-cand-N`.
    national_by_id: dict[int, dict[str, Any]] = {
        int(r["candidato_id"]): r for r in national_rows
    }
    # Mapping cand_id → rank canônico para cor.
    rank_by_cand: dict[int, int] = {}
    sorted_nat = sorted(
        national_rows,
        key=lambda r: (-float(r.get("pct_projetado") or 0.0), int(r["candidato_id"])),
    )
    for i, r in enumerate(sorted_nat):
        rank_by_cand[int(r["candidato_id"])] = i + 1

    # Inverte zona_municipio: para cada (uf, cod_municipio_tse) coleta dados.
    # Como `fetch_municipio_aggregates` já agrega por município, reuso direto.
    # Precisamos só mapear (uf, cod_municipio_tse) → cod_ibge + nome
    # (+ mesorregiao_cod/_nome quando disponíveis — S06/F4d; + eleitores/
    # capital desde a migration 0006 — decisão D-d do plano de 11/09).
    # A chave de `zona_municipio` é a tripla do par, mas só os VALORES
    # importam aqui — várias zonas do mesmo município colapsam na mesma
    # entrada (primeira vence; todas trazem os mesmos dados do município).
    munic_meta: dict[tuple[str, int], dict[str, Any]] = {}
    for _chave, z_meta in zona_municipio.items():
        key = (z_meta["uf"], z_meta["cod_municipio_tse"])
        if key not in munic_meta:
            munic_meta[key] = {
                "cod_ibge": z_meta["cod_ibge"],
                "nome": z_meta["nome"],
                "mesorregiao_cod": z_meta.get("mesorregiao_cod"),
                "mesorregiao_nome": z_meta.get("mesorregiao_nome"),
                "eleitores": z_meta.get("eleitores"),
                "capital": z_meta.get("capital"),
            }

    out: dict[str, dict[str, Any]] = {}
    for sigla in sorted(uf_by_sigla.keys()):
        rows = uf_by_sigla[sigla]
        # pct_apurado é o mesmo em todas as rows da UF.
        pct_apurado_uf = float(rows[0].get("pct_apurado") or 0.0)

        # Top-2 por pct_projetado para identificar líder e segundo (estável).
        ordered = sorted(
            rows, key=lambda r: float(r.get("pct_projetado") or 0.0), reverse=True
        )
        # ADR-0053 / RF-213 — líder e 2º (agulha da UF) entre os que
        # COMPETEM; `ordered` segue inteiro para a exibição abaixo.
        competem = _competidores(
            ordered,
            anulados.da_uf(sigla) if anulados is not None else frozenset(),
            onde="build_uf_payloads",
            sigla=sigla,
        )
        top = competem[0] if competem else None
        second = competem[1] if len(competem) >= 2 else None

        # Margem usada nas séries / display (não vai pra payload aqui — já vem
        # via candidato.pct_projetado).

        # Constrói candidatos: cada candidato da UF + voto absoluto rateado.
        # `local_rank_by_cand` — rank LOCAL da corrida da UF (1 = líder
        # estadual), distinto de `rank_by_cand` (rank NACIONAL usado só
        # para cor). "Outros" da UF (Fase 1a) usa o rank local — top-3 da
        # disputa estadual, não do ranking nacional.
        candidatos: list[dict[str, Any]] = []
        local_rank_by_cand: dict[int, int] = {}
        comparecimento_by_cid: dict[int, dict[str, Any] | None] = {}
        for idx, r in enumerate(ordered):
            cid = int(r["candidato_id"])
            local_rank_by_cand[cid] = idx + 1
            pct_proj = float(r.get("pct_projetado") or 0.0)
            pct_proj_lower = float(r.get("pct_projetado_lower") or pct_proj)
            pct_proj_upper = float(r.get("pct_projetado_upper") or pct_proj)

            # Fase 1 (plano § A/B): `pct_atual`/`votos_atuais`/
            # `votos_projetados` vêm DIRETO do `row` — resultado real de
            # `compute_uf_projections`/`extrapolation.estimate_uf_
            # candidatos` (regra de três), não mais um rateio aproximado
            # de `municipio_aggregates`. `pct_atual` pode ser `None`
            # (UF/candidato imputado via `impute_uf_from_national`) — o
            # payload degrada para `0.0` (nunca `None` — contrato TS
            # espera `number`).
            pct_atual_raw = r.get("pct_atual")
            pct_atual = float(pct_atual_raw) if pct_atual_raw is not None else 0.0
            votos_cand = int(r.get("votos_atuais") or 0)
            votos_proj = int(r.get("votos_projetados") or 0)
            comparecimento_by_cid[cid] = r.get("comparecimento")

            nat = national_by_id.get(cid, {})
            # S05/F4c (ADR-0013) — paleta visual por rank semântico.
            rank_cand = rank_by_cand.get(cid, len(candidatos) + 1)
            # Spec 016 — a sigla lida do próprio EA20 (`par.sg`) vem primeiro;
            # o `partido` da linha nacional fica como fallback para os callers
            # de teste que o passam à mão.
            partido_cand = (partido_by_cand or {}).get(cid) or str(
                nat.get("partido", "—")
            )
            # Spec 018 / RF-144 — o nome real, resolvido pelo par `(uf, numero)`
            # e NUNCA pelo número sozinho (ADR-0042): aqui `sigla` é a UF desta
            # corrida, e é ela que desambigua o 13 de São Paulo do 13 da Bahia.
            # `identidade_by_cand` ausente (caller legado, fixture antiga,
            # `model_fallback_tier`) → o placeholder de sempre, não erro: os
            # campos novos são opcionais de propósito.
            identidade_cand = (identidade_by_cand or {}).get((sigla, cid)) or {}
            nome_cand = identidade_cand.get("nome") or f"Candidato {cid}"
            candidato_payload: dict[str, Any] = {
                "id": cid,
                "nome": nome_cand,
                "partido": partido_cand,
                # 🔴 O campo `cor` SAIU em 2026-09-19, aqui e no bloco nacional.
                # Ver a nota longa no outro ponto (busque por "paleta por
                # COLOCAÇÃO" neste arquivo): a cor vem da SIGLA, no consumidor,
                # e emitir o rank como cor viola a constituição § 2.
                "votos_atuais": votos_cand,
                "votos_projetados": votos_proj,
                "pct_atual": pct_atual,
                "pct_projetado": pct_proj,
                "ci95": {
                    "lower": pct_proj_lower,
                    "upper": pct_proj_upper,
                },
            }
            # Spec 018 / ADR-0042 item 2 — a identidade GLOBAL do candidato,
            # que é o que liga esta linha à foto (ADR-0041). String, sempre:
            # tem 11 ou 12 dígitos, e comparar as duas larguras como texto
            # ordena errado em silêncio. Só entra quando o EA20 o trouxe —
            # ausência é ausência, não string vazia.
            sqcand_cand = identidade_cand.get("sqcand")
            if sqcand_cand:
                candidato_payload["sqcand"] = sqcand_cand
            # E2/E2b (plano § A/C) — base "comparecimento" alternativa,
            # só presente quando `_uf_projection_row` a calculou (sempre
            # o caso na Fase 1, exceto callers legados de teste que não
            # passam por `compute_uf_projections`).
            comp = comparecimento_by_cid[cid]
            if comp is not None:
                candidato_payload["comparecimento"] = {
                    "pct_atual": comp.get("pct_atual"),
                    "pct_projetado": comp.get("pct_projetado"),
                    "lower": comp.get("lower"),
                    "upper": comp.get("upper"),
                }
            # RF-103 — probabilidade de terminar entre os `vagas` primeiros.
            # Só aparece quando foi de fato calculada: um `0.0` default diria
            # "este candidato não se elege em cenário nenhum", que é uma
            # afirmação, não uma ausência de dado.
            p_el = (p_eleito_by_uf or {}).get(sigla, {}).get(cid)
            if p_el is not None:
                candidato_payload["p_eleito"] = float(p_el)
            candidatos.append(candidato_payload)

        # Fase 1a (RF-020.1, D3/D4/D5/D6) — bloco `participacao` da UF.
        # "Outros" (D4): soma de resamples de rank LOCAL >= 4 via
        # `estimates_by_uf[sigla]` (candidatos ainda não presentes em
        # `estimates_by_uf` — fallback legado sem parâmetro — resultam em
        # `outros_uf = None`, chave omitida, comportamento pré-Fase 1a).
        outros_uf: dict[str, Any] | None = None
        cand_map_uf = (estimates_by_uf or {}).get(sigla)
        if cand_map_uf:
            outros_estimates_uf, n_outros_uf = compute_outros_estimates(
                cand_map_uf, local_rank_by_cand, min_rank=4
            )
            outros_uf = _outros_metric_payload(outros_estimates_uf, n_outros_uf)
            if outros_uf is not None:
                # `pct_atual` real da cauda: soma dos `pct_atual` (base
                # votáveis, LITERAL) dos candidatos com rank local >= 4 —
                # sourced direto do `row` (plano § B), não mais de
                # `municipio_aggregates`. `None` para algum candidato da
                # cauda (UF/candidato imputado) => "sem dado real" fica
                # `None` (nunca um `0.0` falso — mesma semântica de
                # `outros_nacional` em `build_edge_payload`).
                tail_ids = [
                    int(r2["candidato_id"])
                    for r2 in ordered
                    if local_rank_by_cand.get(int(r2["candidato_id"]), 0) >= 4
                ]
                tail_pct_atual = [
                    r2.get("pct_atual")
                    for r2 in ordered
                    if int(r2["candidato_id"]) in tail_ids
                ]
                if tail_pct_atual and all(v is not None for v in tail_pct_atual):
                    outros_uf["pct_atual"] = sum(float(v) for v in tail_pct_atual)

                # Plano § B — "outros" na 2a base (comparecimento), campo
                # aninhado `outros.comparecimento` (`EdgeBaseComparecimento`
                # via `types.ts`), mesma filosofia de `candidato.comparecimento?`.
                cand_map_uf_c = (estimates_c_by_uf or {}).get(sigla)
                if cand_map_uf_c:
                    outros_est_c, n_outros_c = compute_outros_estimates(
                        cand_map_uf_c, local_rank_by_cand, min_rank=4
                    )
                    if n_outros_c > 0:
                        tail_pct_atual_c = [
                            (comparecimento_by_cid.get(cid) or {}).get("pct_atual")
                            for cid in tail_ids
                        ]
                        pct_atual_c = (
                            sum(float(v) for v in tail_pct_atual_c)
                            if tail_pct_atual_c and all(v is not None for v in tail_pct_atual_c)
                            else None
                        )
                        outros_uf["comparecimento"] = {
                            "pct_atual": pct_atual_c,
                            "pct_projetado": _frac_to_pct(float(np.mean(outros_est_c))),
                            "lower": _frac_to_pct(
                                float(np.percentile(outros_est_c, 2.5))
                            ),
                            "upper": _frac_to_pct(
                                float(np.percentile(outros_est_c, 97.5))
                            ),
                        }

        part_est_uf = (participacao_by_uf or {}).get(sigla, {})
        metodo_row = rows[0].get("metodo") if rows else None
        participacao_uf_payload = build_participacao_payload(
            part_est_uf.get("abstencao"),
            part_est_uf.get("brancos_nulos"),
            outros_uf,
            pct_apurado_uf,
            metodo_tipo=(metodo_row or {}).get("tipo", "extrapolacao_apurado"),
            n_zonas_imputadas=(metodo_row or {}).get("n_zonas_imputadas", 0),
        )

        # Constrói municípios — agregação determinística por cod_ibge.
        # `municipios_for_meso` é a lista enriquecida com mesorregiao_cod/uf
        # usada APENAS para `aggregate_by_mesorregiao` (não vai pro payload).
        municipios_payload: list[dict[str, Any]] = []
        municipios_for_meso: list[dict[str, Any]] = []
        for (uf, cod_tse), agg in municipio_aggregates.items():
            if uf != sigla:
                continue
            meta = munic_meta.get((uf, cod_tse))
            if not meta:
                continue
            votos_por_cand = agg["votos_por_candidato"]
            if not votos_por_cand:
                # Município sem votos reportados — ainda emitimos row para o
                # mapa, mas com lider degenerado.
                lider_id = top["candidato_id"] if top else 0
                lider_votos = 0
                margem_pp = 0.0
                lider_partido = "—"
            else:
                # Top-2 por votos absolutos no município.
                sorted_cands = sorted(
                    votos_por_cand.items(), key=lambda kv: kv[1], reverse=True
                )
                lider_id, lider_votos = sorted_cands[0]
                second_votos = sorted_cands[1][1] if len(sorted_cands) >= 2 else 0
                total_munic = sum(votos_por_cand.values())
                if total_munic > 0:
                    margem_pp = 100.0 * (lider_votos - second_votos) / total_munic
                else:
                    margem_pp = 0.0
                lider_partido = str(national_by_id.get(lider_id, {}).get("partido") or "—")

            votos_reportados_payload = {
                int(k): int(v) for k, v in votos_por_cand.items()
            }
            payload_row = {
                "cod_ibge": meta["cod_ibge"],
                "nome": meta["nome"],
                "pct_apurado": float(agg["pct_apurado"]),
                "lider": {
                    "candidato_id": int(lider_id),
                    "partido": lider_partido,
                    "votos": int(lider_votos),
                    "margem_pp": float(margem_pp),
                },
                "votos_reportados": votos_reportados_payload,
            }
            # Migration 0006 / decisão D-d — ambos OPCIONAIS no contrato TS
            # (`EdgeUfMunicipio.eleitores?` / `.capital?`): Blobs já gravados e
            # a fixture `tests/fixtures/blob/uf-municipios-pres-t1.json`
            # continuam válidos sem eles. Só emitimos quando o dado existe de
            # fato — `eleitores` é Σ dos pares do município (sem rateio),
            # `capital` é o seed estático das 27 capitais.
            # `capital` só aparece quando é `true` (são 27 em ~5.570
            # municípios): ausência == não-capital para o consumidor, e o
            # payload da UF não paga por 644 `"capital": false`.
            if meta.get("eleitores") is not None:
                payload_row["eleitores"] = int(meta["eleitores"])
            if meta.get("capital"):
                payload_row["capital"] = True
            municipios_payload.append(payload_row)
            # S06/F4d — versão enriquecida pra aggregate_by_mesorregiao.
            municipios_for_meso.append(
                {
                    **payload_row,
                    "uf": uf,
                    "mesorregiao_cod": meta.get("mesorregiao_cod"),
                    "mesorregiao_nome": meta.get("mesorregiao_nome"),
                }
            )
        # Ordem determinística por cod_ibge.
        municipios_payload.sort(key=lambda m: m["cod_ibge"])

        # S06/F4d — agregação por mesorregião. Só inclui no payload se
        # alguma mesorregião pôde ser derivada (≥1 município tem
        # `mesorregiao_cod` não-nulo). Caso contrário, omite o campo
        # `mesorregioes` inteiro (EdgePayloadUf.mesorregioes? é opcional).
        mesorregioes_payload = aggregate_by_mesorregiao(
            uf_row={"sigla": sigla},
            municipios=municipios_for_meso,
            historical_by_meso=None,  # spec 005 v2: enriquecer com 2022
        )

        # Séries temporais — converte timeline em 3 séries (margem, p_vitoria, turnout).
        timeline = series_by_uf.get(sigla, [])
        series_margem = [
            {"ts": pt["ts"], "margem_pp": float(pt["margem_pp"])} for pt in timeline
        ]
        series_pv = [
            {"ts": pt["ts"], "p": float(pt["p_vitoria_lider"])}
            for pt in timeline
            if pt.get("p_vitoria_lider") is not None
        ]
        series_turnout = [
            {"ts": pt["ts"], "pct_apurado": float(pt["pct_apurado"])} for pt in timeline
        ]

        # Spec 020 (RF-170) — o elenco das quatro sai de `candidatos`, que é a
        # MESMA lista que a tela recebe, reordenada pelo comparador de
        # `rankByParcial`. Passar `ordered` (que está por `pct_projetado`) no
        # lugar é a mutação que o teste T2 mata.
        serie_uf_payload = montar_serie_por_candidato(serie_bruta, sigla, candidatos)

        # Margem atual UF p/ derivar needle.
        top_pct = float(top.get("pct_projetado") or 0.0) if top else 0.0
        second_pct = float(second.get("pct_projetado") or 0.0) if second else 0.0
        margem = top_pct - second_pct
        needle_position = max(-1.0, min(1.0, margem / 20.0))
        needle_band = _needle_band(needle_position)

        # ADR-0038 D2 — cada UF carrega o relógio dos PARES DELA, não uma fatia
        # do nacional: a ingestão degrada regionalmente (rede específica, lock
        # preso num fan-out parcial) sem que o agregado nacional acuse nada.
        # UF ausente do mapa (caller legado, ou nenhum par daquela UF no ciclo)
        # publica `null` nos dois — que é o estado "hora do dado indisponível",
        # nunca um substituto fabricado.
        relogio_uf = (relogio_by_uf or {}).get(sigla)

        uf_payload: dict[str, Any] = {
            "uf": sigla,
            "ts": ts_iso,
            "dado_ts": relogio_uf.dado_ts if relogio_uf is not None else None,
            "pares_atrasados": (
                relogio_uf.pares_atrasados if relogio_uf is not None else None
            ),
            "cargo": int(cargo),
            "turno": int(turno),
            "pct_apurado": pct_apurado_uf,
            "candidatos": candidatos,
            "needle_position": float(needle_position),
            "needle_band": needle_band,
            "municipios": municipios_payload,
            "series_temporais": {
                "margem": series_margem,
                "p_vitoria": series_pv,
                "turnout": series_turnout,
                # Spec 020 / ADR-0046 D3 — a série por candidatura desta UF mora
                # AQUI DENTRO, e portanto no objeto Blob do ADR-0032: 27 UF × 3
                # cargos × ~6,9 KB levariam o store de Global Config a ~969 KB,
                # acima do limiar de erro do writer — escrita recusada na noite
                # de 04/10. `splitUfPayload` não precisou mudar: o
                # destructuring já leva o objeto de séries inteiro ao Blob.
                #
                # Campo OPCIONAL: ausente enquanto não há ponto nenhum, e o
                # consumidor nomeia esse estado (`sem_serie`) em vez de desenhar
                # um gráfico vazio.
                **(
                    {"por_candidato": serie_uf_payload}
                    if serie_uf_payload is not None
                    else {}
                ),
            },
        }
        # Spec 016 — quantas cadeiras esta UF elege no cargo (RF-105/RF-106) e
        # em que unidade a regra de três rodou (RF-102/RF-108). Os dois campos
        # são opcionais no contrato TS: sem eles, o consumidor cai no
        # comportamento de 1 vaga e não afirma granularidade nenhuma.
        if vagas is not None:
            uf_payload["vagas"] = int(vagas)
        granularidade_uf = (metodo_row or {}).get("granularidade")
        if granularidade_uf:
            uf_payload["granularidade"] = granularidade_uf

        # S06/F4d — só inclui `mesorregioes` quando há dado real
        # (≥ 1 mesorregião derivada). Campo é opcional em
        # `EdgePayloadUf`; omiti-lo quando vazio sinaliza "indisponível"
        # (consumidor esconde o bloco UI) em vez de "zero mesorregiões".
        if mesorregioes_payload:
            uf_payload["mesorregioes"] = mesorregioes_payload
        # Fase 1a (RF-020.1, D6) — `participacao?` só aparece quando pelo
        # menos uma métrica pôde ser calculada (ver `build_participacao_payload`).
        if participacao_uf_payload is not None:
            uf_payload["participacao"] = participacao_uf_payload
        # Spec 022 (RF-209) — `votacao?` só quando a UF tem linha agregada.
        votacao_uf = (votacao_by_uf or {}).get(sigla)
        if votacao_uf is not None:
            uf_payload["votacao"] = votacao_uf

        out[sigla] = uf_payload

    return out


def build_edge_payload(
    cargo: int,
    turno: int,
    ts_iso: str,
    uf_rows: list[dict[str, Any]],
    national_rows: list[dict[str, Any]],
    eleitorado_total_by_uf: dict[str, int],
    cand_a_id: int | None = None,
    cand_b_id: int | None = None,
    p_segundo_turno_overall: float | None = None,
    cenarios_2t: list[dict[str, Any]] | None = None,
    municipio_aggregates: dict[tuple[str, int], dict[str, Any]] | None = None,
    participacao_nacional: dict[str, ParticipacaoEstimate | None] | None = None,
    outros_nacional: dict[str, Any] | None = None,
    national_estimates_comparecimento: dict[int, np.ndarray] | None = None,
    partido_by_cand: dict[int, str] | None = None,
    vagas: int | None = None,
    vagas_em_disputa: int | None = None,
    total_cadeiras: int | None = None,
    dado_ts: str | None = None,
    pares_atrasados: int | None = None,
    identidade_by_cand: dict[tuple[str, int], dict[str, str]] | None = None,
    serie_bruta: SeriePorCandidatoBruta | None = None,
    swing_by_uf: dict[str, float | None] | None = None,
    votacao: dict[str, Any] | None = None,
    anulados: AnuladosNaDecisao | None = None,
) -> dict[str, Any]:
    """Monta o shape canônico `EdgePayload` (lib/edge-config/types.ts).

    ADR-0053 / RF-213 acrescenta `anulados`: em `por_uf[]`, `lider`, a margem
    (entre as duas primeiras que COMPETEM, em pp de `vvc`), `chamada`,
    `vai_a_2t` (líder sobre a base sem os anulados) e as vagas de
    `composicao_vagas` ignoram as candidaturas de voto anulado. A agulha e a
    ordem de `national.candidatos` já chegam decididas via `cand_a_id`/
    `cand_b_id` e `p_vitoria` de `compute_national`. `top_candidatos`,
    `outros` e todo percentual publicado são exibição e não mudam. `None` ⇒
    comportamento anterior, byte a byte.

    Spec 021 acrescenta `votacao` (opcional, já montado por
    `build_votacao_payload`): as contagens absolutas do eleitorado e a
    projeção crua das quatro fatias. Ausente ⇒ a chave não aparece no
    payload, e o painel "Votação" cai em `<DetailUnavailable>` (RF-198) —
    nunca em zeros.

    Spec 016 (Senador) acrescenta três parâmetros opcionais:
      - `partido_by_cand` (RF-107) — `{cand: sigla}` lido do próprio EA20
        por `extract_partido_by_cand`. Substitui o `"—"` literal que este
        método escrevia em `national.candidatos[].partido` desde a S03.
      - `vagas` (RF-105/RF-107) — cadeiras por UF neste cargo. Quando
        `>= 2`, dispara o bloco `composicao_vagas`.
      - `vagas_em_disputa` (RF-107) — quantas cadeiras a eleição renova
        (54 no Senado em 2026). É um fato da eleição, declarado em
        `api/model/cargos.py`, e NÃO uma contagem de UFs presentes no
        ciclo: derivá-lo de `por_uf` faria o denominador encolher quando
        um estado ainda não apurou, e o leitor veria "de 48 vagas" às 18h
        e "de 54" às 22h.
      - `total_cadeiras` (RF-107) — tamanho da casa legislativa inteira
        (81 no Senado), para a tela poder distinguir as vagas EM DISPUTA
        do total. Sem ele o bloco sai sem o denominador maior, nunca com
        um número inventado.

    Spec 018 acrescenta `identidade_by_cand` (opcional, `{(uf, numero):
    {"nome", "sqcand"}}` de `extract_identidade_by_cand`), com DOIS destinos
    de regra diferente:
      - `por_uf[].top_candidatos[]` (RF-144) ganha `nome`/`partido`/`sqcand`
        em **todo** cargo — ali a UF é conhecida, então o par resolve.
      - `national.candidatos[].nome` (RF-145) só em **cargo 1**. Cargo 3 e 5
        MANTÊM o placeholder: o bloco nacional desses cargos é a união de 27
        corridas sob o mesmo espaço de `id`. Ver o comentário longo no corpo.

    Fase 1a (RF-020.1, D3/D4/D5/D6) acrescenta 3 parâmetros opcionais,
    todos com default `None` (compat retroativa — sem eles o payload sai
    idêntico ao pré-Fase 1a):
      - `municipio_aggregates`: mesmo dado de `fetch_municipio_aggregates`
        (TODAS as UFs, sem filtro) — usado para popular `pct_atual` REAL
        de cada candidato nacional (antes hardcoded `0.0`) e o `pct_atual`
        de "outros" (soma da cauda rank >= 4).
      - `participacao_nacional`: `{"abstencao": Estimate|None,
        "brancos_nulos": Estimate|None}` (output de
        `compute_participacao`, campo `nacional`).
      - `outros_nacional`: dict já no shape `participacao.outros` (output
        de `_outros_metric_payload` sobre o 5º elemento de
        `compute_national`), com `pct_atual: None` — este método preenche
        o `pct_atual` real usando `municipio_aggregates` antes de anexar.
    `national.participacao` só aparece quando pelo menos uma das 3 chaves
    (`abstencao`/`brancos_nulos`/`outros`) tem dado real
    (`build_participacao_payload` decide).

    Plano § B (regra de três, sem 2022) acrescenta:
      - `pct_atual`/`votos_atuais` por candidato nacional agora vêm de
        `uf_rows` (razão de somas dos `votos_atuais` reais de
        `compute_uf_projections`/`extrapolation.estimate_uf_candidatos`),
        não mais de `municipio_aggregates` — que fica como FALLBACK
        (útil quando `uf_rows` vem de um caller legado sem os campos
        novos, ex.: testes antigos).
      - `votos_projetados` real vem de `national_rows[*]["votos_projetados"]`
        (populado por `compute_national(..., votos_by_uf=...)`,
        `aggregate_national_votos`).
      - `comparecimento?` por candidato nacional — bootstrap agregado de
        `national_estimates_comparecimento` (mesmo formato de
        `aggregate_national_estimates`, mas sobre `estimates_c_by_uf`).
        `pct_atual` desta base fica `None` na Fase 1 (não há um total
        nacional de comparecimento agregado ainda — simplificação
        documentada, ver relatório da tarefa).
      - `participacao.outros.comparecimento?` — mesma filosofia, soma de
        resamples de rank >= 4 sobre `national_estimates_comparecimento`.

    v1 (S03):

    v1 (S03):
      - `national.candidatos[]` — usa `national_rows`; o líder semântico
        (`cand_a_id`, vindo de `compute_national`) é o PRIMEIRO da lista,
        seguido do segundo (`cand_b_id`), depois os demais por `pct_projetado`
        desc. Isso garante que a agulha consome `candidatos[0]` como "A"
        sem precisar de re-ordenação no consumidor TS.
        Defaults nome/partido/cor permanecem até spec 011 ingerir o catálogo.
      - `por_uf[]` — uma linha por UF presente em `uf_rows`. `lider`, `margem*`,
        `chamada`, `swing_vs_2022` v1 são heurística simples:
          lider = candidato_id com maior `pct_projetado` na UF;
          margem_atual = margem_projetada = top - 2º top (pp);
          margem_projetada_ci = [margem - 5, margem + 5] (aprox; refinar S04);
          chamada = margem_projetada > 10 (regra placeholder);
          swing_vs_2022 = 0.0 v1.
      - `insights[]` = [] (spec 011 vai preencher templates determinísticos).
      - `composition` = {pre_election: 0, model: 1, actual_results: 0} (v1
        placeholder; spec 008 vai ponderar pelas 3 fontes).
      - `pct_apurado_total` = média ponderada pelo eleitorado UF.
      - `ufs_apuradas` = contagem de UFs com `pct_apurado > 0`.

    FIX S04 (carry-over #1 retro S03): antes ordenávamos `national_rows` por
    `candidato_id` ascendente e usávamos `candidatos[0].p_vitoria` na agulha
    — isso invertia a banda quando o líder tinha id maior. Agora a agulha
    usa diretamente a `p_vitoria` do líder (id == `cand_a_id`).
    """
    # Index UF rows por (uf, candidato).
    uf_by_sigla: dict[str, list[dict[str, Any]]] = {}
    for r in uf_rows:
        if r.get("uf") is None:
            continue
        uf_by_sigla.setdefault(r["uf"], []).append(r)

    # pct_apurado_total ponderado pelo eleitorado.
    #
    # Itera pela UNIÃO de `eleitorado_total_by_uf` (todas as UFs
    # conhecidas, RF-008) e `uf_by_sigla` (UFs com ao menos 1 linha em
    # `uf_rows`) — não só as últimas. Uma UF pode faltar inteiramente de
    # `uf_rows` quando NENHUMA zona sua apareceu em `snapshots` ainda
    # (todas as respostas do TSE foram 404 "sem dados", `app/api/ingest/
    # route.ts`) — nesse caso `compute_uf_projections` nunca a processa
    # (RF-017 hoje só cobre UFs presentes com estimativa `None`, não UFs
    # ausentes de ponta a ponta; achado do model-validator, 2026-09-06,
    # gêmeo do bug do denominador de `uf_pct_apurado`). Sem esta união, a
    # UF ficava fora do numerador E do denominador — inflando
    # artificialmente `pct_apurado_total` bem no início da apuração
    # (exatamente quando ele é mais visível). Trata a UF ausente como 0%
    # apurado (correto: ela não apurou nada), contribuindo com seu peso
    # cheio ao denominador.
    pct_total_num = 0.0
    pct_total_den = 0.0
    ufs_apuradas = 0
    todas_siglas = set(eleitorado_total_by_uf.keys()) | set(uf_by_sigla.keys())
    for sigla in todas_siglas:
        rows = uf_by_sigla.get(sigla)
        # rows são por candidato — pct_apurado vem repetido (é da UF, não do
        # candidato). Usa o primeiro. UF sem nenhuma linha -> 0% (não
        # apurou nada ainda), não "ausente do cálculo".
        pct_uf = float(rows[0].get("pct_apurado") or 0.0) if rows else 0.0
        if pct_uf > 0:
            ufs_apuradas += 1
        w = eleitorado_total_by_uf.get(sigla, 0)
        if w > 0:
            pct_total_num += pct_uf * w
            pct_total_den += w
    pct_apurado_total = (
        pct_total_num / pct_total_den if pct_total_den > 0 else 0.0
    )

    # Bloco nacional — candidatos.
    # Ordenação SEMÂNTICA (FIX S04 carry-over #1): líder (cand_a_id) primeiro,
    # segundo lugar (cand_b_id) em seguida, depois os outros por pct_projetado
    # desc. Tie-breaker para a "cauda" é candidato_id asc — estável e
    # determinístico.
    rows_by_id: dict[int, dict[str, Any]] = {
        int(r["candidato_id"]): r for r in national_rows
    }

    def _sort_key(r: dict[str, Any]) -> tuple[int, float, int]:
        rid = int(r["candidato_id"])
        if cand_a_id is not None and rid == cand_a_id:
            tier = 0
        elif cand_b_id is not None and rid == cand_b_id:
            tier = 1
        else:
            tier = 2
        return (tier, -float(r.get("pct_projetado") or 0.0), rid)

    sorted_national = sorted(national_rows, key=_sort_key)

    # Plano § B — `votos_atuais`/`pct_atual` nacional REAIS: razão de
    # somas a partir dos `votos_atuais` já calculados por UF (`uf_rows`,
    # `compute_uf_projections`/`extrapolation.estimate_uf_candidatos`).
    # PRIMÁRIO. `municipio_aggregates` fica como FALLBACK para callers
    # legados (testes antigos) que passam `uf_rows` sem os campos novos.
    #
    # Spec 020 — a conta vive em `pct_atual_nacional_por_candidato`, e este
    # bloco a CHAMA em vez de recomputá-la. A mesma função povoa a coluna
    # `pct_atual` das linhas nacionais de `projections`
    # (`linhas_para_projections`): com duas implementações, o gráfico e este
    # placar divergiriam no quinto decimal e não haveria como saber qual está
    # certo.
    (
        pct_atual_nat,
        votos_atuais_nat,
        total_votos_atuais_nat,
    ) = pct_atual_nacional_por_candidato(uf_rows)

    votos_por_cand_nat: dict[int, int] = {}
    total_votos_nat = 0
    if total_votos_atuais_nat > 0:
        votos_por_cand_nat, total_votos_nat = votos_atuais_nat, total_votos_atuais_nat
    elif municipio_aggregates:
        votos_por_cand_nat, total_votos_nat = _national_votos_por_candidato(
            municipio_aggregates
        )
        # Fonte diferente, MESMA aritmética — ver `_pct_razao_de_somas`.
        pct_atual_nat = _pct_razao_de_somas(votos_por_cand_nat, total_votos_nat)

    # Spec 018 / RF-145 — nome real no bloco NACIONAL **só em cargo 1**.
    #
    # Em cargo 3 (Governador) e 5 (Senador) `national.candidatos` não é uma
    # corrida: é a UNIÃO de 27 corridas sob o mesmo espaço de `id`, com `rank`
    # reiniciando a cada UF — o próprio `GovernorCard.tsx` já registra isso em
    # comentário. Ali o `id` 13 não identifica uma pessoa, identifica "o número
    # 13 nalguma UF", e qualquer nome atribuído seria ambíguo POR CONSTRUÇÃO,
    # não apenas impreciso. O placeholder `"Candidato {id}"` é feio e
    # verdadeiro; o nome do governador de um estado nos outros 26 seria bonito
    # e falso. Em cargo 1 existe de fato uma corrida nacional única — 13
    # candidaturas, 13 números distintos, medido contra o registro de 2026 —
    # então o par `(uf, numero)` degenera: o mesmo número traz o mesmo nome em
    # qualquer UF, e colapsar por número não perde informação.
    #
    # ⚠️ "Melhorar" isto depois estendendo a cargo 3/5 é exatamente o defeito
    # que o ADR-0042 existe para prevenir. `test_national_sem_nome_em_cargo_3_5`
    # é o teste que grita.
    identidade_nacional: dict[int, dict[str, str]] = {}
    if int(cargo) == 1 and identidade_by_cand:
        # Determinismo (§ 6): varredura por chave ordenada, primeira vence.
        for (_uf_ident, numero_ident) in sorted(identidade_by_cand):
            if numero_ident in identidade_nacional:
                continue
            identidade_nacional[numero_ident] = identidade_by_cand[
                (_uf_ident, numero_ident)
            ]

    national_candidatos: list[dict[str, Any]] = []
    pct_atual_outros_sum = 0.0
    for r in sorted_national:
        # S05/F4c (ADR-0013): paleta visual por RANK (`var(--color-cand-N)`),
        # não por partido. `rank` vem populado de `compute_national`; se
        # ausente (caller legado), coalesce para a posição+1 no array.
        rank = int(r.get("rank") or (len(national_candidatos) + 1))
        cid = int(r["candidato_id"])
        # 0.0 quando a candidatura não aparece no dado apurado: aqui é o
        # PAYLOAD, cujo contrato com a UI é numérico. A coluna `pct_atual` de
        # `projections` guarda `None` no mesmo caso, de propósito — lá o
        # destino é um gráfico, onde `0` seria um mergulho ao chão e `NULL` é
        # um furo na linha.
        pct_atual_cand = pct_atual_nat.get(cid, 0.0)
        if rank >= 4:
            pct_atual_outros_sum += pct_atual_cand
        ident_nat = identidade_nacional.get(cid) or {}
        candidato_nat: dict[str, Any] = {
            "id": cid,
            # RF-145: `identidade_nacional` está VAZIO fora do cargo 1 — ver o
            # bloco que a constrói. Não é uma condição a acrescentar aqui.
            "nome": ident_nat.get("nome") or f"Candidato {r['candidato_id']}",
            # Spec 016 — a sigla vem do próprio EA20 (`par.sg`, colhido por
            # `extract_partido_by_cand`). O `"—"` continua sendo o valor
            # quando o snapshot não carrega a hierarquia de partido (payload
            # achatado legado do replay 2022) ou quando o caller não passou o
            # mapa — nunca um chute.
            "partido": (partido_by_cand or {}).get(cid, "—"),
            # 🔴 O campo `cor` SAIU em 2026-09-19. Ele carregava
            # `var(--color-cand-{rank})` — a paleta por COLOCAÇÃO do ADR-0013,
            # que o ADR-0024 superou em 07/09. A cor vem da SIGLA, no consumidor.
            #
            # Não reintroduza: a constituição § 2 exige cor estável na noite
            # inteira e diz que ela "não muda por rank". Emitir o rank como cor
            # faz dois candidatos TROCAREM de cor numa ultrapassagem ao vivo —
            # sintoma que o dono viu em 19/09 (CAIADO/PSD laranja na lista e
            # verde na legenda, ao mesmo tempo). O campo segue OPCIONAL no
            # contrato TS só porque payloads antigos ainda o trazem.
            "votos_atuais": votos_por_cand_nat.get(cid, 0),
            "votos_projetados": int(r.get("votos_projetados") or 0),
            "pct_atual": pct_atual_cand,
            "pct_projetado": float(r.get("pct_projetado") or 0.0),
            "pct_projetado_lower": float(r.get("pct_projetado_lower") or 0.0),
            "pct_projetado_upper": float(r.get("pct_projetado_upper") or 0.0),
            "p_vitoria": float(r.get("p_vitoria") or 0.0),
            # S05/F4c (ADR-0014) — métricas multi-candidato.
            "rank": rank,
            "p_passa_2t": float(r.get("p_passa_2t") or 0.0),
            "p_fecha_1t": float(r.get("p_fecha_1t") or 0.0),
        }
        # ADR-0042 item 2 / ADR-0041 — identidade global, é o que endereça a
        # foto. Segue a mesma porta do nome: `identidade_nacional` só tem
        # conteúdo em cargo 1, então cargo 3/5 não ganha `sqcand` no nacional.
        sqcand_nat = ident_nat.get("sqcand")
        if sqcand_nat:
            candidato_nat["sqcand"] = sqcand_nat
        # Plano § B (E2/E2b) — base "comparecimento" nacional, agregada de
        # `national_estimates_comparecimento` (mesmo bootstrap agregado de
        # `estimates_c_by_uf`, ver `_do_project`). `pct_atual` fica `None`
        # nesta base na Fase 1 (sem total nacional de comparecimento
        # agregado ainda — simplificação documentada).
        if national_estimates_comparecimento is not None:
            arr_c = national_estimates_comparecimento.get(cid)
            if arr_c is not None:
                candidato_nat["comparecimento"] = {
                    "pct_atual": None,
                    "pct_projetado": _frac_to_pct(float(np.mean(arr_c))),
                    "lower": _frac_to_pct(float(np.percentile(arr_c, 2.5))),
                    "upper": _frac_to_pct(float(np.percentile(arr_c, 97.5))),
                }
        national_candidatos.append(candidato_nat)

    # Spec 020 / ADR-0046 D3 — a série NACIONAL viaja num campo novo da chave de
    # Global Config que já existe, e não numa chave nova nem num Blob nacional:
    # +6,9 KB sobre os ~17,3 KB do payload, contra um limiar de aviso de 75 KB.
    # É o teto duro de 120 pontos (D2) que permite isso sem reabrir o ADR-0032.
    #
    # `national_candidatos` já está montado com `id`/`nome`/`partido`/`sqcand`/
    # `pct_atual`/`pct_projetado` — os mesmos números que a tela lê. O elenco sai
    # dele, reordenado pelo comparador de `rankByParcial`, e NÃO da ordem
    # semântica acima (líder, segundo, cauda por `pct_projetado`).
    serie_nacional = montar_serie_por_candidato(serie_bruta, None, national_candidatos)

    # Fase 1a — patch `pct_atual` de "outros" com o dado real recém
    # computado (só quando houve alguma fonte de votos reais; sem ela,
    # `outros_nacional["pct_atual"]` permanece `None`, vindo de
    # `_outros_metric_payload`).
    if outros_nacional is not None and total_votos_nat > 0:
        outros_nacional = {**outros_nacional, "pct_atual": pct_atual_outros_sum}

    # Plano § B — "outros" nacional na 2a base (comparecimento), campo
    # aninhado `outros.comparecimento`, mesma filosofia da UF.
    if outros_nacional is not None and national_estimates_comparecimento:
        rank_by_cand_nat = {
            int(r["candidato_id"]): int(r.get("rank") or 0) for r in national_rows
        }
        outros_est_c, n_outros_c = compute_outros_estimates(
            national_estimates_comparecimento, rank_by_cand_nat, min_rank=4
        )
        if n_outros_c > 0:
            outros_nacional = {
                **outros_nacional,
                "comparecimento": {
                    "pct_atual": None,
                    "pct_projetado": _frac_to_pct(float(np.mean(outros_est_c))),
                    "lower": _frac_to_pct(float(np.percentile(outros_est_c, 2.5))),
                    "upper": _frac_to_pct(float(np.percentile(outros_est_c, 97.5))),
                },
            }

    # Needle nacional — usa p_vitoria do LÍDER (cand_a_id) mapeada para [-1, 1].
    # `position = 2 * p_a - 1`: p=0.5 → 0 (tossup), p=1 → +1.
    # Como `p_vitoria` por candidato é P(c > max(outros)) e o líder é o c com
    # maior pct, p_vitoria_a ≈ P(líder > segundo) ≈ valor retornado em
    # `national_p_vitoria_a`. Lemos do row do líder em vez de candidatos[0]
    # por explicitude (também são equivalentes após a ordenação acima).
    if cand_a_id is not None and cand_a_id in rows_by_id:
        p_a = float(rows_by_id[cand_a_id].get("p_vitoria") or 0.0)
        needle_position = 2.0 * p_a - 1.0
    elif national_candidatos:
        needle_position = 2.0 * national_candidatos[0]["p_vitoria"] - 1.0
    else:
        needle_position = 0.0
    needle_band = _needle_band(needle_position)

    # RF-107 (spec 016) — composição das vagas EM DISPUTA por partido.
    #
    # Isto é **agregação**, não estimativa: é a contagem de quantas UFs têm um
    # candidato daquele partido entre os `vagas` primeiros da projeção. Nenhum
    # modelo novo roda aqui (constituição § 6 — a UI e o agregador não
    # inventam número), e é por isso que o campo pode existir mesmo sem o TSE
    # publicar um arquivo `br-` para o cargo (`temArquivoBr: false` em
    # `lib/config/cargos.ts`; open question 2 da spec 016).
    #
    # `ufs_aguardando` não é decoração: uma UF sem nenhum boletim não aparece
    # em `uf_rows` e portanto não entrega vaga nenhuma. Publicar só a contagem
    # por partido faria a soma não fechar em 54 e o leitor concluir que faltam
    # vagas, quando o que falta é apuração.
    composicao_por_partido: dict[str, int] = {}
    ufs_com_projecao = 0

    # por_uf — agrega por UF.
    por_uf: list[dict[str, Any]] = []
    for sigla in sorted(uf_by_sigla.keys()):
        rows = uf_by_sigla[sigla]
        # Ordena por pct_projetado desc para identificar líder + 2º.
        ordered = sorted(rows, key=lambda r: float(r.get("pct_projetado") or 0.0), reverse=True)
        # ADR-0053 / RF-213 — as DECISÕES da UF (líder, margem, chamada,
        # vai_a_2t, vagas) saem só de quem compete. Presidente usa o destino
        # nacional; Governador/Senador, o da UF (`AnuladosNaDecisao.da_uf`).
        fora_da_uf = anulados.da_uf(sigla) if anulados is not None else frozenset()
        competem = _competidores(
            ordered, fora_da_uf, onde="build_edge_payload", sigla=sigla
        )
        top = competem[0]
        second_pct = float(competem[1].get("pct_projetado") or 0.0) if len(competem) > 1 else 0.0
        top_pct = float(top.get("pct_projetado") or 0.0)
        margem = top_pct - second_pct
        ci_lower = float(top.get("pct_projetado_lower") or top_pct) - second_pct
        ci_upper = float(top.get("pct_projetado_upper") or top_pct) - second_pct

        if vagas is not None and vagas >= 2:
            ufs_com_projecao += 1
            eleitos_da_uf = competem[: int(vagas)]
            for r_eleito in eleitos_da_uf:
                sigla_partido = (partido_by_cand or {}).get(
                    int(r_eleito["candidato_id"]), "—"
                )
                composicao_por_partido[sigla_partido] = (
                    composicao_por_partido.get(sigla_partido, 0) + 1
                )

        # S05/F4c (ADR-0017) — top-N candidatos da UF, tie-break por id ASC.
        # `N` era 3 até 2026-09-19; virou `TOP_CANDIDATOS_POR_UF` (= 4) a
        # pedido do dono, junto com a linha "Outros" logo abaixo.
        #
        # Spec 018 / RF-144 + ADR-0042 item 3: a linha da UF passa a carregar
        # a própria identidade (`nome`/`partido`/`sqcand`) em vez de obrigar o
        # consumidor a cruzar `id` contra `national.candidatos`. Esse cruzamento
        # é o defeito: em cargo 3/5 o bloco nacional é a união de 27 corridas,
        # e resolver nome por `id` sozinho ali entrega o candidato de outro
        # estado. Aqui `sigla` é a UF desta corrida — a chave é o par.
        #
        # Os três campos são OPCIONAIS e só entram quando resolvidos: um
        # payload sem eles (pré-018, ou sob `model_fallback_tier`) continua
        # renderizando o placeholder na tela, que é o contrato de degradação.
        #
        # 2026-09-18 (pedido do dono — balão do mapa nacional estilo NYT):
        # `votos_atuais`/`pct_atual` por candidato, mesmos nomes de
        # `EdgeUfCandidate` (o payload de drill-down de UF já os carrega —
        # ver `lib/edge-config/types.ts`). `r` aqui é a MESMA linha
        # `(uf, candidato)` de `_uf_projection_row`/`CandidatoEstimate`:
        # `votos_atuais` é sempre um `int` de verdade (0 é um FATO — zero
        # boletim chegado para este candidato nesta UF —, nunca "não
        # medimos"), mas `pct_atual` é `float | None` (`None` na imputação
        # nacional de `impute_uf_from_national`, cargo 1 apenas — RF-013/017
        # 2º nível). Ambos entram como os três de cima: SÓ quando não-`None`,
        # nunca coeridos para `0`/`0.0` — "não sabemos" e "medimos zero" são
        # estados diferentes (decisão do dono, 14/09; ver `swing_vs_2022`
        # alguns campos acima pela mesma regra).
        #
        # ── União com a ordem do APURADO (2026-09-21) ──────────────────────
        #
        # `ordered` está ordenado por `pct_projetado`. O prefixo continua sendo
        # exatamente `ordered[:TOP_CANDIDATOS_POR_UF]` — ele NÃO muda de
        # conteúdo nem de ordem, porque `margemSegundaVaga` o lê por posição.
        # Ao fim dele são ANEXADOS os `RESGATE_POR_APURADO` primeiros por
        # `pct_atual` que ficaram de fora (ver a docstring da constante).
        #
        # Guardas, na ordem em que importam:
        #
        #   1. **Sem `pct_atual`, sem resgate.** `rc.get("pct_atual") is None`
        #      é o caso `impute_uf_from_national` (cargo 1, UF sem nenhuma zona
        #      apurada): ali não existe ordem de apurado, e ordenar por um
        #      `0.0` de conveniência elegeria o resgatado pelo id, não pelo
        #      voto. Filtramos ANTES de ordenar.
        #   2. **Empate desempata por id**, como o resto do arquivo — duas
        #      execuções sobre o mesmo snapshot têm de emitir o mesmo payload
        #      (constituição § 6: o modelo é determinístico).
        #   3. **`cauda` é o complemento EXATO** do que entrou, por id — não
        #      mais `ordered[TOP_CANDIDATOS_POR_UF:]`. Manter o fatiamento
        #      antigo republicaria o resgatado duas vezes: como linha própria e
        #      dentro de "Outros", e `Σtop + outros` passaria de 100% sem
        #      exceção nenhuma ser levantada — é literalmente o defeito que a
        #      docstring de `TOP_CANDIDATOS_POR_UF` descreve para dois
        #      literais divergentes.
        #   0. 🔴 **UNIÃO, e não "os 2 melhores DE FORA".** A ordem por apurado
        #      é tirada da corrida INTEIRA (`ordered`), e só depois se remove
        #      quem já está no prefixo. A diferença não é de estilo: pegar os 2
        #      melhores entre os excluídos resgataria SEMPRE 2 pessoas em toda
        #      UF com 6+ candidaturas — inclusive os dois ÚLTIMOS do apurado,
        #      que é o oposto do objetivo — e apagaria a linha "Outros" de
        #      corridas de exatamente 6. Foi assim que a primeira versão desta
        #      mudança quebrou 7 casos de `test_uf_outros.py`, e os testes
        #      antigos estavam certos. Com a união, no caso normal (as duas
        #      ordens concordam) **nada é anexado** e o payload sai idêntico ao
        #      de antes — que é o que o replay de 2022 mostra em 133 de 133
        #      observações.
        prefixo = ordered[:TOP_CANDIDATOS_POR_UF]
        ids_prefixo = {int(r["candidato_id"]) for r in prefixo}
        com_apurado = [rc for rc in ordered if rc.get("pct_atual") is not None]
        top_por_apurado = sorted(
            com_apurado,
            key=lambda rc: (-float(rc["pct_atual"]), int(rc["candidato_id"])),
        )[:RESGATE_POR_APURADO]
        resgatados = [
            rc for rc in top_por_apurado if int(rc["candidato_id"]) not in ids_prefixo
        ]
        selecionados = [*prefixo, *resgatados]
        ids_selecionados = {int(r["candidato_id"]) for r in selecionados}

        top_candidatos: list[dict[str, Any]] = []
        for r in selecionados:
            cid_top = int(r["candidato_id"])
            item_top: dict[str, Any] = {
                "id": cid_top,
                "pct": float(r.get("pct_projetado") or 0.0),
            }
            ident_top = (identidade_by_cand or {}).get((sigla, cid_top)) or {}
            nome_top = ident_top.get("nome")
            if nome_top:
                item_top["nome"] = nome_top
            sqcand_top = ident_top.get("sqcand")
            if sqcand_top:
                item_top["sqcand"] = sqcand_top
            partido_top = (partido_by_cand or {}).get(cid_top)
            if partido_top:
                item_top["partido"] = partido_top
            votos_atuais_top = r.get("votos_atuais")
            if votos_atuais_top is not None:
                item_top["votos_atuais"] = int(votos_atuais_top)
            pct_atual_top = r.get("pct_atual")
            if pct_atual_top is not None:
                item_top["pct_atual"] = float(pct_atual_top)
            top_candidatos.append(item_top)

        # ── "Outros" — o que sobra depois do corte ─────────────────────────
        #
        # 2026-09-19 (pedido do dono): o balão de hover dos mapas mostra 4
        # candidaturas + uma linha "Outros" com o quanto TODOS os demais
        # somados representam. `cauda` é literalmente o complemento de
        # `ordered[:TOP_CANDIDATOS_POR_UF]` sobre a MESMA lista já ordenada —
        # por isso o mesmo nome nos dois fatiamentos (ver a docstring da
        # constante): top e cauda particionam `ordered`, sem sobra nem
        # sobreposição, por construção.
        #
        # 🔴 (a) SOMA CANDIDATO A CANDIDATO, NUNCA `100 - Σ(top 4)`.
        #
        # As duas contas parecem equivalentes e não são. `pct_projetado` é um
        # PONTO por candidatura (mean dos resamples do bootstrap, base
        # votáveis) e a soma de todos os pontos de uma UF não fecha em 100
        # exatamente — fecha em 100 ± um resíduo de fechamento, porque cada
        # média foi tirada separadamente. A subtração jogaria esse resíduo
        # inteiro dentro de "Outros", isto é, transformaria erro de fechamento
        # em "voto de alguém": um número inventado com cara de aritmética, que
        # cresce justamente quando a apuração está baixa e o resíduo é maior.
        # A soma direta não tem esse defeito — ela mede a cauda, não o que
        # falta para o topo.
        #
        # Não é regra nova neste arquivo: `compute_outros_estimates` (acima)
        # soma os resamples da cauda pela MESMA razão, e o teste
        # `tests/unit/model/test_outros.py::
        # test_5_candidatos_soma_rank_4_e_5_por_resample` trava a soma
        # elementwise contra exatamente esta mutação. A diferença é que lá a
        # soma preserva o IC95; aqui não há IC nenhum a preservar (são pontos),
        # e a razão para somar é a outra metade do mesmo argumento.
        #
        # 🔴 (b) `pct_atual` É TUDO-OU-NADA.
        #
        # Somar só os membros da cauda que têm `pct_atual` publicaria "os
        # demais somam 3,1%" quando 3,1% é o que UM deles tem e dos outros não
        # sabemos nada — medição servindo de capa para ausência. Decisão
        # durável do dono (14/09): "não começou", "não sabemos" e "apurando"
        # são TRÊS estados distintos, e nenhum deles se escreve como um número
        # menor.
        #
        # Na prática a condição é por UF INTEIRA, não por candidato: quem anula
        # `pct_atual` é `impute_uf_from_national` (`api/model/extrapolation.py`,
        # ~:551), que monta `pct_atual_votaveis: None` para TODOS os candidatos
        # da UF de uma vez — é o caso "a UF não tem nenhuma zona apurada e o
        # share veio do agregado nacional" (cargo 1, RF-017 2º nível). Ou seja:
        # em produção o `all(...)` abaixo é sempre 27-de-27 ou 0-de-27. Ele
        # está escrito por candidato mesmo assim porque é a condição CORRETA
        # se algum dia a imputação virar parcial — e porque um `all()` explícito
        # é o que discrimina a mutação, enquanto um `if pct_atual_do_primeiro`
        # passaria hoje por coincidência.
        #
        # `votos_atuais` NÃO segue a sorte do `pct_atual`: na linha imputada ele
        # vale `0`, e `0` ali é um FATO — zero boletim chegado — não ausência.
        # Omiti-lo junto com `pct_atual` apagaria um dado medido por causa de
        # outro que falta.
        #
        # ⚠️ **Desvio deliberado do plano de 2026-09-19**, que escrevia
        # `int(sum(int(rc.get("votos_atuais") or 0) ...))` incondicionalmente.
        # Em produção dá no mesmo (`_uf_projection_row` sempre grava o `int`),
        # mas em caller LEGADO — `uf_rows` sem a chave, caso real exercido por
        # `tests/unit/model/test_sqcand_string.py` e por
        # `test_top_candidatos_votos_pct_atual.py::
        # test_linha_sem_as_chaves_nenhuma_regressao_de_keyerror` — o `or 0`
        # publicaria `"votos_atuais": 0` para a cauda no MESMO payload em que
        # os `top_candidatos[]` omitem o campo por não o terem. Duas respostas
        # diferentes para a mesma ausência, e a de "Outros" seria a afirmação
        # falsa "a cauda não recebeu nenhum voto". A condição abaixo é a mesma
        # de `pct_atual` — tudo-ou-nada sobre a PRESENÇA da chave —, com a
        # diferença que importa: um `0` presente é publicado como `0`.
        #
        # ── O denominador: as duas pontas usam a MESMA base (verificado) ────
        #
        # "Outros = X% dos votos" só é somável com as 4 linhas de cima se o
        # denominador for o mesmo, e é:
        #
        #   - Aqui/nacional: `pct_atual` desta linha é `pct_atual_votaveis` de
        #     `CandidatoEstimate` (`_uf_projection_row`, ~:2266), que vale
        #     `Σ vap_c / Σ vvc` (`api/model/extrapolation.py:344`,
        #     `pct_atual_v = sum_vap / sum_vvc`). `vvc` = EA20 `v.vvc`, "votos
        #     a votáveis concorrentes" — a soma dos votos de TODOS os
        #     concorrentes da zona. O denominador JÁ INCLUI a cauda: top-4 e
        #     cauda são frações do mesmo total, e somá-las é legítimo.
        #     `pct_projetado` é `pct_projetado_votaveis`, o análogo projetado
        #     sobre `Σ B_v` — mesma base, mesma propriedade.
        #   - Municipal: `pct = v / Σ votos_reportados`
        #     (`lib/utils/municipio-votos.ts:118`), e a docstring :80-96 desse
        #     arquivo já demonstra ser a MESMA identidade sobre um subconjunto
        #     de zonas (o município em vez da UF) — `votos_reportados` é a soma
        #     de `cand[].vap` candidato a candidato, que é a segunda forma de
        #     escrever `vvc`. Batem.
        #
        # ⚠️ RÓTULO: a base é "votáveis" (`vvc`), NUNCA "válidos" (`vv`) —
        # ADR-0018 e o EA20 são explícitos que os dois campos são diferentes.
        # O pedido do dono fala em "% de votos válidos" e a UI usa esse rótulo;
        # a conta abaixo é a mesma que o resto do produto já publica sob esse
        # nome, então "Outros" não introduz inconsistência nova — mas o
        # vocabulário correto em código é "votáveis".
        #
        # ⚠️ SENADO (cargo 5, 2 vagas): cada eleitor vota em DUAS
        # candidaturas, então `Σ vvc` da zona vale ~2× o comparecimento. Isso
        # não quebra nada aqui: numerador e denominador saem do MESMO `vvc`, a
        # identidade `Σ_c pct_atual(c) = 100%` continua exata, e o que o número
        # significa é "% dos VOTOS", não "% dos eleitores" — que é exatamente
        # como o TSE divulga o cargo. A única leitura proibida é somar essas
        # frações com uma métrica de comparecimento (ADR-0020: as duas bases
        # não são intercambiáveis), e "Outros" não faz isso.
        #
        # ⚠️ `round(..., 5)` sobre a SOMA — segundo desvio deliberado do plano,
        # que escrevia `float(sum(...))` cru. As parcelas já saem de
        # `_frac_to_pct` com 5 casas (precisão de `NUMERIC(8,5)`), mas somar
        # floats de 5 casas ressuscita o ruído binário: `2.69 + 1.15` vale
        # `3.8400000000000003` em Python, e é ASSIM que iria para o JSON —
        # 18 caracteres de um número que só tem 3 dígitos significativos,
        # no meio de um payload cujo teto é de 1 MB. Arredondar na mesma
        # precisão das parcelas é o que `_outros_metric_payload` já faz com o
        # agregado irmão de `participacao` (ele publica via `_frac_to_pct`), e
        # não muda nenhum dígito que alguém leia. NÃO confundir com a
        # subtração proibida acima: o que está vedado é trocar a soma pelo
        # complemento, não dar à soma a precisão que as parcelas têm.
        # A ordem das chaves segue a declaração de `EdgeUfRow.outros` em
        # `lib/edge-config/types.ts` e a de `outrosDaCauda` no gerador de
        # simulação. Ordem de chave não muda semântica de JSON nenhuma — muda o
        # DIFF entre um payload de produção e uma fixture, que é onde alguém vai
        # comparar os dois a olho.
        #
        # 🔴 2026-09-21 — complemento POR ID, e não mais
        # `ordered[TOP_CANDIDATOS_POR_UF:]`. Com o resgate por apurado, top e
        # cauda deixaram de ser dois fatiamentos do mesmo índice: quem foi
        # resgatado está no top E estaria naquele fatiamento. A partição
        # continua exata — sem sobra e sem sobreposição —, só que agora a
        # chave é o id, que é o que de fato identifica a candidatura.
        cauda = [r for r in ordered if int(r["candidato_id"]) not in ids_selecionados]
        outros_top: dict[str, Any] | None = None
        if cauda:
            outros_top = {
                "pct": round(
                    sum(float(rc.get("pct_projetado") or 0.0) for rc in cauda), 5
                )
            }
            pcts_cauda = [rc.get("pct_atual") for rc in cauda]
            if all(p is not None for p in pcts_cauda):
                outros_top["pct_atual"] = round(sum(float(p) for p in pcts_cauda), 5)
            votos_cauda = [rc.get("votos_atuais") for rc in cauda]
            if all(v is not None for v in votos_cauda):
                outros_top["votos_atuais"] = int(sum(int(v) for v in votos_cauda))
            outros_top["n_candidatos"] = len(cauda)

        # vai_a_2t: aplicável apenas a governador 1T (cargo=3, turno=1).
        # Para presidente, a decisão de 2T é NACIONAL — null por UF.
        if int(cargo) == 3 and int(turno) == 1:
            # ADR-0053 / RF-213 — a regra dos 50% é sobre a base sem os
            # votos anulados (`vvc − van`), não sobre o `vvc` publicado.
            vai_a_2t: bool | None = (
                _pct_na_base_da_decisao(top_pct, ordered, fora_da_uf) < 50.0
            )
        else:
            vai_a_2t = None

        # bucket — estado declarativo (ADR-0017).
        chamada = margem > 10.0
        if chamada:
            bucket = "chamada"
        elif vai_a_2t is True:
            bucket = "vai_2t"
        elif vai_a_2t is False:
            bucket = "decidido_1t"
        else:
            bucket = "indefinido"

        linha_uf: dict[str, Any] = {
            "sigla": sigla,
            "pct_apurado": float(top.get("pct_apurado") or 0.0),
            "lider": int(top["candidato_id"]),
            "margem_atual": float(margem),
            "margem_projetada": float(margem),
            "margem_projetada_ci": [float(ci_lower), float(ci_upper)],
            # Placeholder v1: regra simples até spec de "chamada" definitiva.
            "chamada": chamada,
            # `None`, nunca 0.0. Sob a constituição 1.2 (§ 8) a comparação
            # com 2022 é um FATO OBSERVADO exibido ao leitor, não um
            # insumo interno do modelo — e `0.0` em toda UF afirmaria na
            # tela que "nenhuma UF mudou desde 2022", que é falso. O tipo
            # `EdgeUfRow.swing_vs_2022` já é `number | null` e a UI já
            # renderiza "—" para null. Achado HIGH do `constitution-guard`
            # em 2026-09-05.
            #
            # Fase 5 (2026-09-18): o valor real passou a existir —
            # `compute_swing_descritivo` (E1 do plano § B) o calcula a
            # partir de `historical_results.votos`. Quem NÃO tem número de
            # 2022 continua saindo `None` por este mesmo `.get`, que é o
            # ponto: o default do dict ausente é `None`, não `0.0`, e
            # continuará sendo mesmo que `swing_by_uf` não seja passado
            # (caller legado, replay, fixture).
            "swing_vs_2022": (swing_by_uf or {}).get(sigla),
            # S05/F4c — multi-candidato (ADR-0017).
            "top_candidatos": top_candidatos,
            "vai_a_2t": vai_a_2t,
            "bucket": bucket,
        }
        # Chave AUSENTE, nunca `None`. `EdgeUfRow.outros` é OPCIONAL no
        # contrato TS; publicar `"outros": null` obrigaria todo consumidor a
        # distinguir "não há cauda" de "há cauda e não sabemos nada dela" —
        # dois estados que este payload nunca produz (sem cauda ⇒ nada a dizer;
        # com cauda ⇒ `pct` e `n_candidatos` SEMPRE existem). Mesma regra dos
        # campos condicionais de `top_candidatos[]` logo acima.
        if outros_top is not None:
            linha_uf["outros"] = outros_top
        por_uf.append(linha_uf)

    # S05/F4c (ADR-0014) — em 2T, métricas multi-candidato degeneram:
    #   p_segundo_turno_overall = None (já estamos no 2T)
    #   cenarios_2t = []         (não faz sentido projetar cenário 2T no 2T)
    # Mantemos a semântica explícita aqui mesmo se caller não passou os
    # parâmetros (orchestrator legado).
    if int(turno) == 2:
        p_2t_overall: float | None = None
        cenarios_2t_payload: list[dict[str, Any]] = []
        # S06/F4d Fase 5 — em 2T, `vai_a_2t_nacional` degenera para None
        # (já estamos no 2T, semântica vazia). Consumidor UI esconde o sinal.
        vai_a_2t_nacional: bool | None = None
    else:
        p_2t_overall = p_segundo_turno_overall  # pode ser None se caller legado
        cenarios_2t_payload = cenarios_2t if cenarios_2t is not None else []
        # S06/F4d Fase 5 (carry-over) — derivação centralizada do sinal binário
        # "vai a 2T nacional?" a partir de `p_segundo_turno_overall`. Threshold
        # 0.01 mantém paridade com a heurística que vivia em `app/page.tsx`
        # (`vai_a_2t = p < 0.01`). Quando caller legado não passa
        # `p_segundo_turno_overall`, emite `None` (consumidor coalesce pra
        # derivação local — forward-compat).
        if p_2t_overall is None:
            vai_a_2t_nacional = None
        else:
            vai_a_2t_nacional = p_2t_overall >= 0.01

    # Fase 1a (RF-020.1, D6) — `national.participacao?`. Omitido inteiro
    # se nenhuma das 3 métricas (abstenção/brancos-nulos/outros) tem dado
    # real (`build_participacao_payload` decide).
    # RF-107 — o bloco só existe para cargo de mais de uma vaga por UF
    # (Senador). `vagas_em_disputa` é 27 × `vagas` sempre, não a contagem do
    # que já apurou: são as vagas que a eleição renova, e esse número não
    # muda ao longo da noite. `total_cadeiras` é a casa inteira (81 no
    # Senado) — omitido quando o caller não o informa, porque um default
    # inventado ali seria um fato falso sobre a composição do Senado.
    composicao_vagas: dict[str, Any] | None = None
    if vagas is not None and vagas >= 2:
        por_partido = sorted(
            (
                {"partido": sg, "vagas": n}
                for sg, n in composicao_por_partido.items()
            ),
            # Ordem determinística (§ 6): mais vagas primeiro, sigla como
            # desempate estável.
            key=lambda d: (-int(d["vagas"]), str(d["partido"])),
        )
        ufs_total = (
            vagas_em_disputa // vagas if vagas_em_disputa else len(uf_by_sigla)
        )
        composicao_vagas = {
            "vagas_por_uf": int(vagas),
            "ufs_projetadas": ufs_com_projecao,
            "ufs_aguardando": max(0, ufs_total - ufs_com_projecao),
            "vagas_projetadas": sum(composicao_por_partido.values()),
            "por_partido": por_partido,
            **(
                {"vagas_em_disputa": int(vagas_em_disputa)}
                if vagas_em_disputa
                else {}
            ),
            **({"total_cadeiras": int(total_cadeiras)} if total_cadeiras else {}),
        }

    _participacao_src = participacao_nacional or {}
    participacao_payload = build_participacao_payload(
        _participacao_src.get("abstencao"),
        _participacao_src.get("brancos_nulos"),
        outros_nacional,
        pct_apurado_total,
    )

    return {
        # DOIS relógios, de propósito (ADR-0038 D1): `ts` é a hora em que o
        # modelo rodou — não muda de nome, de valor nem de significado — e
        # `dado_ts` é a hora que o TSE carimbou no boletim mais recente que
        # entrou nesta conta. Quando a ingestão para, o primeiro continua
        # andando e o segundo congela: é essa diferença que a tela precisa
        # poder mostrar.
        "ts": ts_iso,
        "dado_ts": dado_ts,
        "pares_atrasados": pares_atrasados,
        "cargo": int(cargo),
        "turno": int(turno),
        "pct_apurado_total": float(pct_apurado_total),
        "ufs_apuradas": int(ufs_apuradas),
        # Spec 021 (RF-199/RF-195) — só presente quando o agregado do TSE
        # chegou. Ausente ≠ zeros: ver `build_votacao_payload`.
        **({"votacao": votacao} if votacao is not None else {}),
        "national": {
            "candidatos": national_candidatos,
            "needle_position": float(needle_position),
            "needle_band": needle_band,
            # FIX S04 carry-over #1 — ids semânticos do líder/segundo.
            # Consumidores TS (spec 003/004) usam para resolver nome/cor sem
            # re-ordenar. None quando ≤1 candidato com estimates válidas.
            "candidato_a_id": cand_a_id,
            "candidato_b_id": cand_b_id,
            # S05/F4c (ADR-0014) — métricas multi-candidato 1T.
            "p_segundo_turno_overall": p_2t_overall,
            "cenarios_2t": cenarios_2t_payload,
            # S06/F4d Fase 5 — sinal binário explícito (paridade com EdgeUfRow.vai_a_2t).
            "vai_a_2t_nacional": vai_a_2t_nacional,
            # Fase 1a (RF-020.1, D6) — só presente quando há dado real.
            **(
                {"participacao": participacao_payload}
                if participacao_payload is not None
                else {}
            ),
        },
        "por_uf": por_uf,
        # Spec 020 — opcional: ausente enquanto não há ponto nenhum. Ver o bloco
        # que o monta, acima.
        **(
            {"serie_por_candidato": serie_nacional}
            if serie_nacional is not None
            else {}
        ),
        "insights": [],
        "composition": {
            "pre_election": 0.0,
            "model": 1.0,
            "actual_results": 0.0,
        },
        # RF-107 — presente só em cargo de 2+ vagas por UF (hoje, Senador).
        **({"composicao_vagas": composicao_vagas} if composicao_vagas else {}),
    }


def _alert_slack(severity: str, msg: str, **ctx: Any) -> None:
    """POST best-effort para o Slack Incoming Webhook — lado Python.

    Não existia equivalente Python a `lib/tse/alerts.ts::notifySlack` antes
    desta função; espelha deliberadamente o mesmo contrato do lado TS (mesma
    env var `SLACK_WEBHOOK_URL`, mesmo formato de mensagem `[SEVERITY] msg` +
    bloco de código com o contexto) para os dois canais renderizarem igual
    no mesmo canal do Slack.

    Best-effort e nunca levanta (constituição § 7 — o alerta não pode
    derrubar o ciclo do modelo): ausência da env var, erro de rede ou 4xx/5xx
    do Slack viram `_log("warn"/"info", ...)`, nunca uma exceção propagada.
    stdlib `urllib.request` pelo mesmo motivo de `post_edge_write` — sem dep
    nova, uma chamada isolada por ciclo, timeout curto.
    """
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        # `alerta=` e não `msg=`: `_log(level, msg, **ctx)` já tem um parâmetro
        # chamado `msg`, e passá-lo de novo por keyword levanta TypeError. O
        # defeito viveu aqui desde que a função nasceu e só aparecia com
        # `SLACK_WEBHOOK_URL` ausente **e** um alerta disparando — isto é, em
        # todo ambiente sem Slack configurado, exatamente no momento em que
        # algo já tinha dado errado. A função que "nunca levanta" levantava, e
        # o ciclo inteiro virava 500.
        _log(
            "info",
            "slack alert skipped — SLACK_WEBHOOK_URL ausente",
            severity=severity,
            alerta=msg,
        )
        return

    text = f"[{severity.upper()}] {msg}"
    if ctx:
        try:
            text += f"\n```{json.dumps(ctx, default=str, indent=2)}```"
        except Exception:  # noqa: BLE001 — serialização nunca deve derrubar o alerta
            text += "\n[ctx: serialização falhou]"

    body = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        # 3s: mesmo teto de `lib/tse/alerts.ts` — um Slack lento não pode
        # consumir o orçamento do ciclo do modelo.
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status < 200 or response.status >= 300:
                _log("warn", "slack alert non-2xx", status=response.status)
    except urllib.error.HTTPError as exc:
        _log("warn", "slack alert http error", status=exc.code, reason=str(exc.reason))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        _log("warn", "slack alert failed", error=str(exc))


def _relogio_do_ciclo(
    snapshots: list[LatestSnapshot], *, cargo: int, turno: int
) -> tuple[RelogioDoDado, dict[str, RelogioDoDado]]:
    """O relógio do DADO deste ciclo — nacional e por UF — já logado e alarmado.

    ADR-0038 D1/D2/D3. Recebe a lista em granularidade de **par** (pré-merge no
    ramo majoritário: depois de `merge_pairs_into_zonas` o `dg`/`hg` sobrevive
    só do par dominante de cada zona, `zona_merge.py:52`) e devolve o que os
    construtores de payload precisam carimbar.

    Os três efeitos que este ponto concentra, e que por isso não se repetem nos
    dois ramos do modelo:

      1. **Log da ausência, com a causa.** O payload só sabe `null`; o log sabe
         por quê. `dg`/`hg` são obrigatórios no schema Zod que valida todo
         snapshot antes do insert (`lib/tse/ea20-schema.ts:337-338`), então
         ausência em produção é o TSE publicando fora do próprio dicionário —
         mas a mesma ausência é o normal das fixtures de replay, que foram
         gravadas com o envelope podado (`tests/fixtures/replay-2022/
         snapshots.json`: só `carg,e,s,v`). Campo ILEGÍVEL, ao contrário de
         campo ausente, não tem versão benigna — fixture podada não tem o que
         estar quebrado — e por isso sai em `error`, não em `warn`.
      2. **Alarme de dado parado** via `_alert_slack`, no limiar do cargo
         (×3 da cadência, `dado_ts.limiar_alarme_segundos`). Inerte sem
         `SLACK_WEBHOOK_URL`, que hoje não está configurada: até lá o alarme é
         só o log estruturado, por decisão do dono.
      3. **Uma linha de `info` por ciclo** com os dois relógios lado a lado —
         é o que torna RNF-006 ("defasagem TSE → tela") verificável de fato,
         em vez de inferida da cadência do cron.
    """
    nacional = relogio_do_dado(snapshots, cargo=cargo)
    por_uf = relogio_por_uf(snapshots, cargo=cargo)

    if nacional.n_malformados:
        _log(
            "error",
            "dg/hg ilegível no envelope do TSE — pares fora do relógio do dado",
            cargo=cargo,
            turno=turno,
            n_malformados=nacional.n_malformados,
            n_pares=nacional.n_pares,
        )

    if nacional.dado_ts is None and nacional.n_pares:
        _log(
            "warn",
            "nenhum par do ciclo tem dg/hg legível — dado_ts publicado como null "
            "(envelope podado de fixture, ou boletim real fora do dicionário do TSE)",
            cargo=cargo,
            turno=turno,
            n_pares=nacional.n_pares,
            n_sem_campos=nacional.n_sem_campos,
            n_malformados=nacional.n_malformados,
        )
        return nacional, por_uf

    if nacional.dado_ts is None:
        # Ciclo sem nenhuma linha. Quem chama já loga "sem snapshots" com mais
        # contexto — repetir aqui só duplicaria a linha.
        return nacional, por_uf

    lag = lag_segundos(nacional.dado_ts)
    limiar = limiar_alarme_segundos(cargo)
    _log(
        "info",
        "relogio_do_dado",
        cargo=cargo,
        turno=turno,
        dado_ts=nacional.dado_ts,
        lag_seconds=None if lag is None else round(lag, 1),
        limiar_seconds=limiar,
        pares_atrasados=nacional.pares_atrasados,
        n_pares=nacional.n_pares,
        n_sem_campos=nacional.n_sem_campos,
    )

    if limiar is not None and lag is not None and lag > limiar:
        _log(
            "error",
            "dado do TSE parado — o modelo está recalculando sobre dado que não avança",
            cargo=cargo,
            turno=turno,
            dado_ts=nacional.dado_ts,
            lag_seconds=round(lag, 1),
            limiar_seconds=limiar,
            pares_atrasados=nacional.pares_atrasados,
        )
        _alert_slack(
            "error",
            "dado do TSE parado",
            cargo=cargo,
            turno=turno,
            dado_ts=nacional.dado_ts,
            lag_seconds=round(lag, 1),
            limiar_seconds=limiar,
            pares_atrasados=nacional.pares_atrasados,
        )

    return nacional, por_uf


def post_edge_write(
    payload: dict[str, Any],
    payloads_uf: dict[str, dict[str, Any]] | None = None,
) -> None:
    """POST `/api/internal/edge-write` com `{payload, payloads_uf?}`.

    `payloads_uf` (S04/F2): mapa `sigla → EdgePayloadUf` rico (candidatos
    com votos, municípios com margem, séries temporais). Quando presente,
    o endpoint Node grava cada UF na sua chave
    `projection-uf-<SIGLA>-<cargo>-t<turno>` em vez de sintetizar esqueleto
    a partir de `por_uf`. Forward-compat: Zod no endpoint usa `passthrough`,
    então campo extra é aceito.

    **Nomes de chave do Global Config não são construídos deste lado.** O
    Python envia um payload; quem deriva os nomes de chave é o TS, num ponto
    único (`lib/edge-config/keys.ts`), que também os valida contra o padrão
    documentado `^[A-Za-z0-9_-]+$` — dois-pontos NÃO é aceito (emenda ao
    ADR-0012, 2026-09-08). Se um dia for preciso montar chave aqui, a regra
    é espelhar aquele módulo, não reinventar o formato.

    O único componente de chave que sai daqui é `por_uf[].sigla`, que vira
    `projection-uf-<SIGLA>-...`. O endpoint Node valida cada sigla na borda
    (2 letras) e responde 400 se não formar chave válida — falhar no POST é
    melhor que falhar parcialmente na gravação no meio da apuração.

    Best-effort:
      - Sem `MODEL_SECRET` em ambiente → log warn e retorna (no-op).
      - Erro HTTP / rede → log warn e retorna (não levanta). O Postgres
        (`projections`) já é fonte de verdade; o Edge Config se ressincroniza
        no próximo ciclo de 60s.
    Por que stdlib `urllib.request` em vez de `httpx`?
      - Sem dep nova (mantém `requirements.txt` enxuto: numpy + pydantic).
      - Body é JSON simples, sem necessidade de connection pooling (uma
        chamada por ciclo de modelo).
      - `urllib` em Python 3.14 já tem TLS e timeouts (`timeout` kwarg).
    """
    secret = os.environ.get("MODEL_SECRET")
    if not secret:
        _log("warn", "edge-write skipped — MODEL_SECRET ausente")
        return

    base = _resolve_internal_base_url()
    url = f"{base}/api/internal/edge-write"

    body_dict: dict[str, Any] = {"payload": payload}
    if payloads_uf:
        body_dict["payloads_uf"] = payloads_uf
    body = json.dumps(body_dict, default=str).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-model-secret": secret,
    }
    # Deployment de preview fica atrás do SSO da Vercel, e isso vale para a
    # chamada que o deployment faz para si mesmo: sem este header a plataforma
    # devolve 401 ANTES de chegar ao endpoint, e a projeção some em silêncio
    # (medido em 2026-09-17, primeiro ciclo contra o simulado). A variável é
    # injetada pela plataforma quando "Protection Bypass for Automation" está
    # ligado; em produção o domínio é público e o header é inócuo.
    bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET")
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers=headers,
    )

    try:
        # 10s timeout: writeProjection escreve ~28 chaves em paralelo (~1-3s
        # típico); 10s deixa margem para cold-start do endpoint Node.
        with urllib.request.urlopen(req, timeout=10) as response:
            status = response.status
            if status < 200 or status >= 300:
                _log(
                    "warn",
                    "edge-write non-2xx",
                    status=status,
                    url=url,
                )
            else:
                _log("info", "edge-write ok", status=status, url=url)
    except urllib.error.HTTPError as exc:
        # Endpoint respondeu HTTP de erro — log estruturado, não propaga.
        _log(
            "warn",
            "edge-write http error",
            status=exc.code,
            reason=str(exc.reason),
            url=url,
        )
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        _log("warn", "edge-write network error", error=str(exc), url=url)


# ---------------------------------------------------------------------------
# HTTP handler — Vercel Python entrypoint
# ---------------------------------------------------------------------------


#: `ATUALIZACAO_MIN_DEPUTADO` (=30) mudou para `api/model/cargos.py` em
#: 2026-09-13 (ADR-0038 D3) e continua importado no topo deste módulo — o nome
#: e o uso em `construir_payload_deputado` não mudaram. Foi para lá porque o
#: limiar de alarme de dado parado precisa derivar dela sem que `dado_ts.py`
#: importe `project.py` (a seta aponta para cá, não daqui).

#: UFs da eleição. Não é configuração nem contagem do ciclo: é quantas
#: circunscrições a Câmara tem. Derivar de quem já apurou faria
#: `ufs_aguardando` valer zero a noite inteira, e a soma "fecharia" mentindo.
UFS_DA_ELEICAO = 27


def _entradas_por_zona(
    pares: list[tuple[LatestSnapshot, EntradaProporcional]],
) -> list[EntradaProporcional]:
    """As leituras de par `(município, zona)` agrupadas em UMA entrada por zona.

    É a unidade de reamostragem do bootstrap de cadeiras (ADR-0036: "a unidade
    de reamostragem (...) passa a ser a zona real — 2.644 zonas distintas no
    país"), a mesma que `zona_merge.merge_pairs_into_zonas` produz para os
    cargos majoritários. A diferença é o nível em que a soma acontece: ali os
    pares são somados no **envelope EA20**, com `cand[].n` de chave; aqui eles
    já foram lidos em `EntradaProporcional`, e `combinar_entradas` soma por
    `sqcand` — que é a chave correta no proporcional, onde o número de urna se
    repete entre partidos (`deputado.py:101-112`).

    `cod_zona` é lido sem default: ele é `NOT NULL` na tabela, e um `or 0`
    silencioso aqui jogaria uma zona real no balde da sentinela — exatamente o
    modo de falha que esta base já pagou três vezes. Ausente, estoura, e o
    ciclo vira 500 com trace.

    A ORDEM das zonas segue a primeira aparição de cada `cod_zona` nas linhas,
    e a ordem das linhas dentro de cada zona é preservada: o bootstrap sorteia
    índices deste vetor, então reordenar mudaria os sorteios sem mudar o método.
    """
    por_zona: dict[int, list[EntradaProporcional]] = {}
    ordem: list[int] = []
    for linha, entrada in pares:
        cod_zona = int(linha["cod_zona"])
        if cod_zona not in por_zona:
            por_zona[cod_zona] = []
            ordem.append(cod_zona)
        por_zona[cod_zona].append(entrada)
    return [combinar_entradas(por_zona[cod_zona]) for cod_zona in ordem]


def _seed_agremiacoes(seed_base: int, uf: str) -> int:
    """Seed do bootstrap de cadeiras de uma UF (constituição § 6).

    Mesma convenção de `compute_uf_projections` (`:1546-1552`): `seed_base` XOR
    os 8 primeiros hex-chars do SHA-256 de `"<UF>:<eixo>"`, truncado a 32 bits.
    O eixo é `"agremiacoes"` (e não `"candidatos"`, do majoritário) para que os
    dois bootstraps de uma mesma UF não compartilhem fluxo de sorteio.

    Até 2026-09-13 o ciclo proporcional não derivava seed nenhuma — ele retorna
    antes de `derive_seed` em `_do_project`. Passa a derivar aqui, do MESMO
    `(cargo, turno, trigger_ts)`: reprocessar o mesmo snapshot devolve o mesmo
    intervalo, que é o que § 6 exige.
    """
    eixo = int(hashlib.sha256(f"{uf}:agremiacoes".encode("utf-8")).hexdigest()[:8], 16)
    return (seed_base ^ eixo) & 0xFFFFFFFF


def _do_project_proporcional(
    req: ProjectRequest, t0: int
) -> tuple[int, dict[str, Any]]:
    """Ciclo do cargo proporcional — Deputado Federal (spec 017, design D5/D6).

    É um caminho separado do majoritário, e não um `if` dentro dele, porque
    quase nada do outro se aplica: não há líder da corrida, não há duelo, não há
    agulha, e o bootstrap do majoritário estima **share de voto** por candidato,
    grandeza que não existe numa corrida de lista. O que existe é a aritmética
    do ADR-0027 sobre o voto apurado de cada UF, somada em bancada — mais, desde
    2026-09-13, um bootstrap próprio de **cadeiras** (RF-127, ver abaixo).

    Desde o ADR-0036 o cargo 6 é ingerido em granularidade **zona** — o par
    (município, zona), ~6.110 alvos varridos em 6 fatias, volta completa a cada
    30 min. A afirmação anterior deste docstring ("ingerido em granularidade UF,
    27 alvos por ciclo") ficou falsa naquele commit.

    O que este caminho **não** faz, e por quê:

      - **Não chama `compute_national`.** Ela agrega por número de urna, que se
        repete no proporcional (D3) — a guarda de lá recusaria de qualquer
        forma, e recusar é o ponto.
      - **Não grava em `projections`.** A tabela é de linha por candidato com
        `pct_projetado`/`p_vitoria`, grandezas que não existem aqui. A
        persistência append-only da corrida (constituição § 10) é a de
        `snapshots`, que a ingestão já faz — nada se perde.
      - **Não projeta voto.** As cadeiras saem do voto **apurado** até o
        instante do ciclo (D9). O intervalo de RF-127 mede a variância do
        recorte geográfico já apurado, não o voto que falta — as duas coisas
        estão separadas de propósito, ver `api/model/cadeiras_bootstrap.py`.

    ## As duas saídas por UF, e por que vêm da mesma leitura

    Cada linha de `snapshots` é um par (município, zona). Elas são lidas **uma
    vez** e a partir daí seguem dois caminhos que nunca se recalculam um ao
    outro:

      - somadas todas → `entrada`, de que sai o **ponto** (as cadeiras
        publicadas), exatamente como antes desta mudança;
      - agrupadas por `cod_zona` → `zonas`, a decomposição que o bootstrap
        reamostra para produzir o **intervalo**.

    A soma é associativa, então as zonas somam a `entrada` por construção — e
    `cadeiras_bootstrap` confere essa igualdade linha a linha antes de publicar
    qualquer faixa. Destruir a decomposição para obter a soma (ou vice-versa)
    deixaria os dois números descrevendo corridas diferentes na mesma tela.
    """
    with _open_conn() as conn:
        # Uma linha por (uf, município, zona) — o caminho NORMAL desde o
        # ADR-0036. Só o interruptor de emergência
        # `TSE_DEPUTADO_GRANULARIDADE=uf` devolve o cargo a UMA linha por UF,
        # com os sentinelas `cod_zona = 0` / `cod_municipio_tse = 0`
        # (`lib/tse/targets.ts::buildUfTarget`). Qual das duas famílias
        # sobrevive quando as duas existem é decidido por frescor de `ts` em
        # `_discard_zero_zona_sentinel_when_real_zonas_exist`; o que restar é
        # SOMADO por `combinar_entradas` — nunca uma escolhida e as outras
        # descartadas.
        snapshots = fetch_snapshots(conn, req.cargo, req.turno)
        # Spec 021 — mesma separação do ciclo majoritário, e pelo mesmo
        # motivo: o agregado de nível "uf" tem `cod_zona = 0` e entraria na
        # guarda de sanidade (`check_zona_merge_sanity`) e no
        # `_entradas_por_zona` como uma "zona" do tamanho do estado —
        # multiplicando a bancada. Ver `particionar_por_nivel`.
        zonas_prop, agregados = particionar_por_nivel(snapshots)
        snapshots = zonas_para_o_modelo(zonas_prop, agregados)
        try:
            eleitorado = fetch_eleitorado(conn, ano=2026)
        except Exception as exc:  # noqa: BLE001 — pesa o pct, não decide cadeira
            # O eleitorado só pondera o `pct_apurado_total`. Perdê-lo degrada
            # esse número (cai para média simples); derrubar o ciclo por causa
            # dele apagaria a bancada inteira da tela (constituição § 7).
            _log("warn", "fetch_eleitorado falhou no ciclo proporcional", error=str(exc))
            eleitorado = {}
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 — autocommit ou sem transação
                pass

    # Guarda de sanidade do cargo proporcional (2026-09-13). Mesma trava dos
    # majoritários, no modo sem merge (`merged_rows=None`): soma `e.te` dos
    # pares de cada zona e compara com o eleitorado real dela.
    #
    # Por que só agora: até o ADR-0036 o cargo 6 vinha em granularidade UF —
    # um arquivo por estado, nada a somar, exposição zero. O ADR passou a
    # somar ~6.110 pares e **afirmou por escrito que esta trava vinha junto**,
    # o que era falso: `check_zona_merge_sanity` só era chamada no ramo
    # majoritário. Enquanto isso, se a premissa da fatia por município (Passo
    # 0 do simulado) fosse falsa, a bancada da Câmara sairia multiplicada por
    # até 8× em silêncio, com os outros três cargos gritando ao lado.
    #
    # Não aborta o ciclo (constituição § 7): torna ruidoso, não fatal.
    if eleitorado:
        n_violacoes_pares = check_zona_merge_sanity(snapshots, None, eleitorado)
        if n_violacoes_pares:
            _log(
                "error",
                "zona_merge_sanity (proporcional): ciclo com zonas em violação "
                "confirmada — possível multiplicação de votos por par",
                cargo=req.cargo,
                turno=req.turno,
                n_violacoes=n_violacoes_pares,
            )
            _alert_slack(
                "error",
                "zona_merge_sanity (proporcional): possível multiplicação de "
                "votos de Deputado Federal (premissa da fatia por município "
                "pode estar violada) — ver logs do ciclo para UF/zona/razão",
                cargo=req.cargo,
                turno=req.turno,
                n_violacoes=n_violacoes_pares,
            )

    eleitorado_total_by_uf = _eleitorado_total_by_uf(eleitorado)

    # ADR-0038 D1/D2 — o relógio do dado sai da lista de PARES, antes das
    # agregações de `deputado.py`: `combinar_entradas` soma voto e
    # `_entradas_por_zona` agrupa por zona; nenhuma das duas carrega `dg`/`hg`
    # adiante, e depois delas não há mais par para medir. Este ramo não passa
    # por `merge_pairs_into_zonas` — a lista lida em `fetch_snapshots` já é a
    # granularidade certa (~6.110 alvos desde o ADR-0036).
    relogio, relogio_uf = _relogio_do_ciclo(
        snapshots, cargo=req.cargo, turno=req.turno
    )

    por_uf: dict[str, list[LatestSnapshot]] = {}
    for row in snapshots:
        sigla = str(row.get("uf") or "").strip().upper()
        if not sigla or sigla == "BR":
            continue
        por_uf.setdefault(sigla, []).append(row)

    if not por_uf:
        _log(
            "warn",
            "sem snapshots para cargo proporcional — modelo nao executa",
            cargo=req.cargo,
            turno=req.turno,
        )
        duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
        return 200, ProjectResponse(
            computed=False,
            uf_count=0,
            national_p_vitoria_a=0.0,
            computed_duration_ms=int(duration_ms),
        ).model_dump()

    ufs: list[UfProporcional] = []
    divergencias_por_uf: dict[str, list[dict[str, Any]]] = {}
    n_calculadas = 0

    # RF-127 — a seed do bootstrap de cadeiras. Derivada aqui porque este
    # caminho retorna antes de `derive_seed` em `_do_project`; usa o MESMO
    # `(cargo, turno, trigger_ts)`, então dois ciclos sobre o mesmo snapshot
    # produzem o mesmo intervalo (constituição § 6).
    seed_base = derive_seed(req.cargo, req.turno, req.trigger_ts)
    contribuicoes_ci: list[tuple[IntervaloCadeiras | None, dict[str, int]]] = []

    for sigla in sorted(por_uf):
        linhas = por_uf[sigla]
        # UMA leitura de envelope por linha (par município×zona). Dela saem as
        # duas visões: a soma da UF (o ponto) e a decomposição por zona (o
        # intervalo). Ver o docstring desta função.
        pares = [
            (linha, extrair_entrada_proporcional(linha.get("payload"), cargo=req.cargo))
            for linha in linhas
        ]
        entrada = combinar_entradas([leitura for _, leitura in pares])
        zonas = _entradas_por_zona(pares)
        # Desde 2026-09-13 o cargo 6 (Deputado Federal) é ingerido em
        # granularidade ZONA (emenda ao ADR-0026 item 1): mais de uma linha
        # por UF passou a ser o caminho NORMAL — cada par (município, zona)
        # chega como uma linha própria. Só volta a ser uma linha só quando o
        # interruptor de emergência `TSE_DEPUTADO_GRANULARIDADE=uf`
        # (`lib/tse/targets.ts::getGranularidade`) reverte o cargo à
        # ingestão por UF. De qualquer forma, o `pct_apurado` não tem uma
        # soma correta possível sem o eleitorado de cada zona (que este ponto
        # do código não tem à mão) — o maior dos publicados é o menos errado
        # dos números disponíveis.
        pct_apurado = max(float(linha.get("pct_apurado") or 0.0) for linha in linhas)
        if len(linhas) > 1:
            _log(
                "info",
                "UF de cargo proporcional com mais de uma linha (zona) — votos somados",
                cargo=req.cargo,
                turno=req.turno,
                uf=sigla,
                n_linhas=len(linhas),
            )

        resultado = None
        intervalo: IntervaloCadeiras | None = None
        if entrada.tem_coligacao:
            # ADR-0027, caso de borda 7: coligação em proporcional é vedada
            # desde 2020. Achar uma significa que o dado está errado — e
            # distribuir cadeiras a partir dele publicaria uma bancada falsa
            # com aparência normal. A UF sai como "aguardando", ruidosamente.
            _log(
                "error",
                "coligação em cargo proporcional — UF fora do cálculo de cadeiras",
                cargo=req.cargo,
                turno=req.turno,
                uf=sigla,
            )
            _alert_slack(
                "error",
                "coligação em corrida proporcional (vedada desde 2020) — a UF "
                "ficou sem cálculo de cadeiras neste ciclo",
                cargo=req.cargo,
                turno=req.turno,
                uf=sigla,
            )
        elif entrada.lugares_a_preencher is None:
            # RF-124 — sem `carg[].nv` não há denominador do quociente, e
            # inventá-lo corromperia a UF inteira. Fica aguardando.
            _log(
                "warn",
                "UF sem `carg[].nv` publicado — cadeiras não calculadas",
                cargo=req.cargo,
                turno=req.turno,
                uf=sigla,
            )
        else:
            calculado = distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher)
            if calculado.quociente_eleitoral < 1:
                # UF sem voto válido ainda (0% apurado). Um quociente eleitoral
                # de zero não é um quociente baixo: é a ausência dele. Publicar
                # `0` faria a tela escrever "quociente eleitoral: 0", e contar a
                # UF como calculada faria `ufs_aguardando` mentir. Ela fica
                # aguardando, com as vagas publicadas entrando no total.
                _log(
                    "info",
                    "UF sem voto válido ainda — sem quociente a publicar",
                    cargo=req.cargo,
                    turno=req.turno,
                    uf=sigla,
                )
                ufs.append(
                    UfProporcional(
                        uf=sigla, pct_apurado=pct_apurado, entrada=entrada, resultado=None
                    )
                )
                continue
            resultado = calculado
            n_calculadas += 1
            # RF-127 — o intervalo. `None` quando a UF tem menos de duas zonas
            # com voto (começo da noite, ou o interruptor de emergência que
            # devolve o cargo a uma sentinela por UF): `cadeiras_ci95` é
            # opcional no contrato (D5/D6) exatamente para poder faltar.
            intervalo = intervalo_de_cadeiras(
                zonas=zonas,
                entrada_uf=entrada,
                cadeiras_ponto=resultado.cadeiras,
                lugares_a_preencher=entrada.lugares_a_preencher,
                seed=_seed_agremiacoes(seed_base, sigla),
            )
            contribuicoes_ci.append((intervalo, resultado.cadeiras))
            divergencias = conferir_contra_tse(resultado, entrada)
            # `o_que` sai num conjunto fechado (`CHAVES_DE_DIVERGENCIA`) — a
            # tela rotula a divergência para o leitor e não pode ficar
            # adivinhando string nossa.
            divergencias_por_uf[sigla] = [normalizar_divergencia(d) for d in divergencias]
            if divergencias and entrada.totalizacao_final:
                # Com totalização final, divergir do TSE é erro — antes dela é
                # esperado, porque o TSE recalcula a cada boletim.
                _log(
                    "error",
                    "divergência contra o TSE com totalização final",
                    cargo=req.cargo,
                    turno=req.turno,
                    uf=sigla,
                    divergencias=divergencias_por_uf[sigla],
                )
                _alert_slack(
                    "error",
                    "cadeiras divergem do TSE com totalização final — "
                    "a conta do ADR-0027 e a publicada não batem",
                    cargo=req.cargo,
                    turno=req.turno,
                    uf=sigla,
                    n_divergencias=len(divergencias),
                )

        ufs.append(
            UfProporcional(
                uf=sigla,
                pct_apurado=pct_apurado,
                entrada=entrada,
                resultado=resultado,
                cadeiras_ci95=intervalo.por_agremiacao if intervalo is not None else None,
            )
        )

    # pct_apurado nacional ponderado pelo eleitorado, iterando pela UNIÃO das
    # UFs conhecidas e das presentes — uma UF que ainda não apurou nada precisa
    # entrar no DENOMINADOR com peso cheio, senão o número nacional infla
    # justamente no começo da noite (mesma armadilha documentada em
    # `build_edge_payload`).
    pct_num = 0.0
    pct_den = 0.0
    pct_by_uf = {d.uf: d.pct_apurado for d in ufs}
    for sigla in set(eleitorado_total_by_uf) | set(pct_by_uf):
        peso = eleitorado_total_by_uf.get(sigla, 0)
        if peso > 0:
            pct_num += pct_by_uf.get(sigla, 0.0) * peso
            pct_den += peso
    if pct_den > 0:
        pct_apurado_total = pct_num / pct_den
    else:
        # Sem a tabela `eleitorado` (banco sem seed, ambiente de teste) o peso
        # some, mas o número não pode sumir junto: cai para média simples sobre
        # as UFs da eleição, com a UF ausente contando 0. Menos preciso,
        # jamais inflado.
        pct_apurado_total = sum(pct_by_uf.values()) / max(UFS_DA_ELEICAO, len(pct_by_uf))

    # RF-127 — a faixa da bancada. Soma de RÉPLICAS das UFs, nunca soma das
    # faixas delas (ver `cadeiras_bootstrap.intervalo_nacional`).
    cadeiras_ci95_nacional = intervalo_nacional(contribuicoes_ci)
    n_uf_com_intervalo = sum(1 for i, _ in contribuicoes_ci if i is not None)
    if contribuicoes_ci:
        _log(
            "info",
            "intervalo de cadeiras (RF-127)",
            cargo=req.cargo,
            turno=req.turno,
            ufs_com_intervalo=n_uf_com_intervalo,
            ufs_sem_intervalo=len(contribuicoes_ci) - n_uf_com_intervalo,
            agremiacoes_com_faixa_nacional=len(cadeiras_ci95_nacional),
        )

    # RF-124 — a conferência do total nacional de cadeiras (2026-09-19).
    # `bancada.total_cadeiras` deixou de ser a soma dos `lugares_a_preencher`
    # das UFs presentes e passou a ser fato fixo (513, `api/model/cargos.py`),
    # porque a soma crescia durante a noite e a tela escrevia "26 cadeiras em
    # disputa" com três estados pequenos no ar.
    #
    # A soma não foi descartada: virou o sino do RF-124, cujo critério de
    # aceitação é "quando o valor de uma UF diverge do que o TSE publica, o
    # ciclo registra erro e aciona alerta". Só toca com as **27** UFs tendo
    # publicado `carg[].nv` — com menos, divergir é o estado normal do começo
    # da noite, e um alarme que toca 26 vezes às 18h é um alarme que ninguém
    # olha às 21h.
    #
    # Não aborta o ciclo (constituição § 7): o denominador suspeito é de uma UF,
    # e apagar a bancada inteira por causa dele seria pior que publicá-la com
    # ruído no log.
    divergencia_do_total = conferir_total_de_cadeiras(
        ufs=ufs, cargo=req.cargo, ufs_conhecidas=max(UFS_DA_ELEICAO, len(ufs))
    )
    if divergencia_do_total is not None:
        _log(
            "error",
            "total de cadeiras publicado pelo TSE não fecha com o tamanho da casa",
            cargo=req.cargo,
            turno=req.turno,
            nosso=divergencia_do_total.nosso,
            tse=divergencia_do_total.tse,
            detalhe=divergencia_do_total.detalhe,
        )
        _alert_slack(
            "error",
            "as 27 UFs publicaram `carg[].nv` e a soma não fecha com o tamanho "
            "da Câmara — o denominador do quociente eleitoral de ao menos uma "
            "UF está errado (RF-124)",
            cargo=req.cargo,
            turno=req.turno,
            esperado=divergencia_do_total.nosso,
            soma_publicada=divergencia_do_total.tse,
        )

    ts_iso = datetime.now(timezone.utc).isoformat()
    payload, detalhes_uf = construir_payload_deputado(
        ufs=ufs,
        divergencias_por_uf=divergencias_por_uf,
        ts_iso=ts_iso,
        cargo=req.cargo,
        turno=req.turno,
        atualizacao_min=ATUALIZACAO_MIN_DEPUTADO,
        ufs_conhecidas=max(UFS_DA_ELEICAO, len(ufs)),
        pct_apurado_total=pct_apurado_total,
        cadeiras_ci95_nacional=cadeiras_ci95_nacional,
        # ADR-0038 D1/D2 — o relógio do dado, nacional e por UF. `ts_iso`
        # acima segue sendo a hora do cálculo, sem mudança.
        dado_ts=relogio.dado_ts,
        pares_atrasados=relogio.pares_atrasados,
        relogio_by_uf=relogio_uf,
        # Spec 021 (RF-199) — só `contagens`. O ciclo proporcional não calcula
        # `compute_participacao` (o cargo 6 não tem bloco `participacao` no
        # contrato), então não há as quatro projeções e `projetada` fica
        # ausente: o círculo 3 exibe "aguardando projeção" — no DOM
        # (ADR-0017/0018), nunca escondido.
        votacao=build_votacao_payload(agregados, req.cargo),
        # Spec 021 RF-192 emendado (26/09 noite) — o painel "Votação" da tela
        # `/uf/[sigla]/deputado-federal`. Contagens do agregado de cada UF;
        # sem `participacao_by_uf` pela mesma razão do nacional acima, então
        # sem `projetada` (arco 3 "aguardando"). Sem `corrida` (RF-200).
        votacao_by_uf=build_votacao_uf_payloads(agregados, req.cargo),
    )

    try:
        post_edge_write(payload, payloads_uf=detalhes_uf)
    except Exception as edge_exc:  # noqa: BLE001 — publicar nunca derruba o ciclo
        _log(
            "warn",
            "edge-write block failed (cargo proporcional)",
            error=str(edge_exc),
            cargo=req.cargo,
            turno=req.turno,
        )

    duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
    _log(
        "info",
        "model_project_proporcional_ok",
        cargo=req.cargo,
        turno=req.turno,
        uf_count=n_calculadas,
        cadeiras_atribuidas=payload["bancada"]["cadeiras_atribuidas"],
        total_cadeiras=payload["bancada"]["total_cadeiras"],
        duration_ms=int(duration_ms),
    )
    return 200, ProjectResponse(
        computed=n_calculadas > 0,
        uf_count=n_calculadas,
        national_p_vitoria_a=0.0,
        computed_duration_ms=int(duration_ms),
    ).model_dump()


def _do_project(body_bytes: bytes) -> tuple[int, dict[str, Any]]:
    """Lógica POST sem I/O HTTP — testável diretamente.

    Retorna `(status, payload)`. O handler HTTP serializa.
    """
    t0 = time.perf_counter_ns()

    # 1. Parse + validate body.
    try:
        req = ProjectRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return 400, {"error": "invalid_body", "detail": e.errors()}
    except json.JSONDecodeError as e:
        return 400, {"error": "invalid_json", "detail": str(e)}

    # 1b. Cargo proporcional segue por outro caminho inteiro (spec 017, D3):
    # bancada somada das 27 UFs, sem bootstrap de candidato e sem agulha.
    if _e_proporcional(req.cargo):
        try:
            return _do_project_proporcional(req, t0)
        except Exception as exc:  # noqa: BLE001 — converter para 500 estruturado
            trace_id = uuid.uuid4().hex[:12]
            _log(
                "error",
                "model_project_proporcional_failed",
                trace_id=trace_id,
                cargo=req.cargo,
                turno=req.turno,
                error=str(exc),
                traceback=traceback.format_exc(),
            )
            return 500, {"error": "internal_error", "trace_id": trace_id}

    # 2. Seed determinístico (constituição § 6).
    seed_base = derive_seed(req.cargo, req.turno, req.trigger_ts)

    # 3. DB query + compute + persist (tudo em uma transação).
    try:
        with _open_conn() as conn:
            # `fetch_snapshots` devolve uma linha por PAR (município × zona)
            # desde a migration 0006; `merge_pairs_into_zonas` soma os pares de
            # volta à ZONA, que é e continua sendo a unidade do estimador
            # (ADR-0021/0023, decisão E5). Em memória, nunca persistido (§ 1).
            # Zona com um único par sai inalterada. `raw_snapshots` (pré-merge)
            # é mantido para a guarda de sanidade logo abaixo — comparar o
            # ANTES e o DEPOIS do merge é o que detecta multiplicação.
            raw_snapshots = fetch_snapshots(conn, req.cargo, req.turno)
            # Spec 021 — o agregado do TSE (nível "uf"/"br") sai da lista do
            # MODELO aqui, ANTES do merge. Se ficasse, `merge_pairs_into_zonas`
            # o trataria como um par de `cod_zona = 0` e ele viraria uma "zona"
            # do tamanho do estado inteiro: cada voto contado duas vezes, uma
            # pelas zonas reais e outra pelo agregado que as resume.
            raw_zonas, agregados = particionar_por_nivel(raw_snapshots)
            raw_snapshots = zonas_para_o_modelo(raw_zonas, agregados)
            # ADR-0038 D1/D2 — o relógio do dado sai daqui, do PRÉ-merge, e não
            # de `snapshots`: `merge_pairs_into_zonas` preserva `dg`/`hg` só do
            # par dominante de cada zona (`zona_merge.py:52`, metadado de
            # envelope não-aditivo), então medir depois esconderia todos os
            # pares não-dominantes — justamente os que ficam para trás quando a
            # ingestão degrada.
            relogio, relogio_uf = _relogio_do_ciclo(
                raw_snapshots, cargo=req.cargo, turno=req.turno
            )
            snapshots = merge_pairs_into_zonas(raw_snapshots)
            # ADR-0053 / RF-213 — quem fica FORA das decisões (voto anulado),
            # lido de TODOS os arquivos do ciclo: agregados `br`/`uf` e as
            # zonas PRÉ-merge (o merge preserva só o envelope do par
            # dominante; a conferência precisa de cada arquivo como veio).
            # Sem `dvt`, ou com `dvt` incoerente, o conjunto sai vazio e o
            # ciclo é byte a byte o de antes.
            anulados = anulados_na_decisao(
                montar_destino_por_candidatura(raw_snapshots, agregados),
                req.cargo,
            )
            # Plano § B — 2022 SAI da projeção de candidatos (decisão E1);
            # `historical` fica NÃO-FATAL e sem uso no cálculo — só existe
            # aqui para alimentar `compute_swing_descritivo` (Fase 5,
            # comparação visual "mudou X pontos desde 2022", fora do
            # escopo desta tarefa). Falha na query nunca deve derrubar a
            # projeção do ciclo.
            try:
                historical = fetch_historical_2022(conn, req.cargo, req.turno)
            except Exception as hist_exc:  # noqa: BLE001 — não-fatal, Fase 5
                _log(
                    "warn",
                    "fetch_historical_2022 failed (non-fatal — Fase 5 descritivo)",
                    error=str(hist_exc),
                )
                historical = []
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001 — autocommit ou sem tx
                    pass
            eleitorado = fetch_eleitorado(conn, ano=2026)

            # Guarda de sanidade (plano `perfeito-monte-um-plano-eventual-
            # candle.md`, 2026-09-11): a premissa de que o EA20 por par traz
            # só a FATIA do município, não a zona inteira, nunca foi
            # verificada contra dado real — ver docstring de
            # `check_zona_merge_sanity`. Não aborta o ciclo (§ 7); só torna a
            # violação ruidosa. Resolvida no simulado de 15/09.
            n_zona_merge_violacoes = check_zona_merge_sanity(
                raw_snapshots, snapshots, eleitorado
            )
            if n_zona_merge_violacoes:
                _log(
                    "error",
                    "zona_merge_sanity: ciclo com zonas em violação confirmada "
                    "— possível dupla contagem por multiplicação de fatia",
                    cargo=req.cargo,
                    turno=req.turno,
                    n_violacoes=n_zona_merge_violacoes,
                )
                _alert_slack(
                    "error",
                    "zona_merge_sanity: possível multiplicação de votos por "
                    "zona (premissa da fatia por município pode estar "
                    "violada) — ver logs do ciclo para UF/zona/razão",
                    cargo=req.cargo,
                    turno=req.turno,
                    n_violacoes=n_zona_merge_violacoes,
                )

            # S04/F2 — dados para enriquecer EdgePayloadUf. Cada um tolera
            # falha (DB sem seed geográfico, projections vazia) com dict
            # vazio + log warn — o payload UF cai pra esqueleto.
            zona_municipio = fetch_zona_municipio(conn)
            municipio_aggregates = fetch_municipio_aggregates(
                conn, req.cargo, req.turno
            )
            series_by_uf = fetch_series_temporais(
                conn, req.cargo, req.turno, window_hours=24
            )
            # Spec 020 — a série por candidatura, lida na mesma rodada de
            # leituras que as outras. Só para os cargos cuja série é de fato
            # persistida: nos demais a consulta não teria o que encontrar, e
            # pagá-la a cada ciclo seria puro desperdício de orçamento.
            serie_bruta = (
                fetch_series_por_candidato(
                    conn, req.cargo, req.turno, window_hours=SERIE_JANELA_HORAS
                )
                if req.cargo in CARGOS_COM_SERIE_PERSISTIDA
                else None
            )

            if not snapshots:
                _log(
                    "warn",
                    "sem snapshots para cargo/turno — modelo nao executa",
                    cargo=req.cargo,
                    turno=req.turno,
                )
                duration_ms = (time.perf_counter_ns() - t0) // 1_000_000
                return 200, ProjectResponse(
                    computed=False,
                    uf_count=0,
                    national_p_vitoria_a=0.0,
                    candidato_a_id=None,
                    candidato_b_id=None,
                    computed_duration_ms=int(duration_ms),
                ).model_dump()

            # Eleitorado total por UF (para a agregação nacional).
            eleitorado_total_by_uf = _eleitorado_total_by_uf(eleitorado)

            uf_rows, estimates_by_uf, estimates_c_by_uf, cand_by_uf = (
                compute_uf_projections(
                    cargo=req.cargo,
                    turno=req.turno,
                    seed_base=seed_base,
                    snapshots=snapshots,
                    eleitorado=eleitorado,
                )
            )

            # RF-014 — votos absolutos projetados, UF -> Brasil (regra de
            # três, `extrapolation.aggregate_national_votos`). Alimenta
            # `compute_national(..., votos_by_uf=...)` abaixo — sem isso
            # `votos_projetados` nacional voltaria a `None` (comportamento
            # legado pré-Fase-1).
            votos_by_uf, _votos_total_br = aggregate_national_votos(cand_by_uf)

            (
                national_rows,
                national_p_a,
                cand_a_id,
                cand_b_id,
                (outros_estimates_nat, n_outros_nat),
            ) = compute_national(
                cargo=req.cargo,
                turno=req.turno,
                estimates_by_uf=estimates_by_uf,
                eleitorado_total_by_uf=eleitorado_total_by_uf,
                votos_by_uf=votos_by_uf,
                anulados=anulados.nacional,
            )
            outros_nacional = _outros_metric_payload(outros_estimates_nat, n_outros_nat)

            # S05/F4c (ADR-0014) — métricas multi-candidato pré-computadas
            # uma vez aqui para serem reusadas pelo edge_payload abaixo.
            # `aggregate_national_estimates` é a MESMA lógica usada
            # internamente em `compute_national` — mesma saída bit-a-bit.
            national_estimates = aggregate_national_estimates(
                estimates_by_uf, eleitorado_total_by_uf
            )
            # ADR-0053 / RF-213 — par e P(2º turno) sobre a base sem os
            # anulados, a MESMA de `compute_national` acima.
            scenarios = compute_two_round_scenarios(
                estimativas_para_decisao(national_estimates, anulados.nacional)
            )

            # Plano § B (E2/E2b) — agregado nacional da BASE COMPARECIMENTO
            # (mesma lógica de `aggregate_national_estimates`, mas sobre
            # `estimates_c_by_uf`). Só alimenta o payload — nunca
            # `p_vitoria`/`compute_two_round_scenarios` (contrato de
            # `estimates_by_uf` permanece votáveis-only).
            national_estimates_comparecimento = aggregate_national_estimates(
                estimates_c_by_uf, eleitorado_total_by_uf
            )

            # Fase 1a (RF-020.1) — participação. Abstenção continua por
            # regra de três em `turnout.py` (base `esi`, fora do 100% por
            # E2); brancos/nulos vem do MESMO bootstrap dos candidatos
            # (`cand_by_uf`, Fase 5 do plano § A). Reusa os MESMOS
            # `snapshots`/`eleitorado` já buscados acima — sem query nova.
            participacao_by_uf, participacao_nacional = compute_participacao(
                cargo=req.cargo,
                turno=req.turno,
                seed_base=seed_base,
                snapshots=snapshots,
                eleitorado=eleitorado,
                cand_by_uf=cand_by_uf,
            )

            # Fase 5 (E1 do plano § B) — comparação DESCRITIVA com 2022.
            # Fora do modelo: não entra em `p_vitoria`, não entra em
            # `estimates_*`, não altera nenhuma projeção. `historical` já
            # foi lido acima de forma não-fatal; vazio => todo swing `None`.
            swing_by_uf = compute_swing_descritivo(uf_rows, historical)

            # Spec 016 (RF-103) — `p_eleito` por candidato, por UF. Pura
            # função dos `estimates_by_uf` já calculados; zero sorteio novo,
            # zero query. Em cargo de 1 vaga (Presidente/Governador) responde
            # à mesma pergunta que `p_vitoria` e não é publicado — só entra no
            # payload de cargo com 2+ vagas, onde a pergunta muda de fato.
            vagas_do_cargo = cargo_vagas_por_uf(req.cargo)
            p_eleito_by_uf = (
                compute_p_eleito_by_uf(estimates_by_uf, vagas_do_cargo, anulados)
                if vagas_do_cargo >= 2
                else None
            )

            # RF-107 — a sigla do partido, lida do próprio EA20 do ciclo.
            # Sem ela a contagem "vagas por partido" não existe.
            partido_by_cand = extract_partido_by_cand(snapshots, cargo=req.cargo)

            # Spec 018 / RF-144 — o NOME, lido do mesmo EA20 do mesmo ciclo.
            # Chaveado pelo par `(uf, numero)`, nunca pelo número sozinho
            # (ADR-0042). Zero query nova: varre os `snapshots` já lidos acima.
            identidade_by_cand = extract_identidade_by_cand(
                snapshots, cargo=req.cargo
            )

            # Spec 018 / RF-144 degrau 3 — o CADASTRO, só onde o boletim não
            # chegou. UMA query por ciclo (não uma por candidato), e o merge
            # põe o cadastro POR BAIXO do EA20: quem o boletim nomeou não é
            # tocado (ADR-0039, precedência absoluta). Tabela ausente ou query
            # falhando → `{}` e a cadeia cai no degrau 4, como antes.
            identidade_by_cand = merge_identidade_cadastro(
                identidade_by_cand,
                fetch_identidade_cadastro(conn, req.cargo),
                (s.get("uf") for s in snapshots),
            )

            # Persistência append-only (constituição § 10).
            #
            # Spec 020 — `linhas_para_projections` é obrigatória, não
            # cosmética: ela povoa `pct_atual`/`votos_atuais` das linhas
            # NACIONAIS (que `compute_national` não produz) e converte o
            # `dado_ts` de string ISO para datetime. `uf_rows + national_rows`
            # cru aqui levanta `ProgrammingError: query parameter missing:
            # pct_atual` na primeira linha nacional.
            # 🔴 O escopo do que se GRAVA é decisão de produto, não consequência
            # da validação de entrada (que aceita 1..99 de propósito, para um
            # código inesperado não derrubar o ciclo). Ver
            # `CARGOS_COM_SERIE_PERSISTIDA`: Deputado Federal fica fora porque
            # suas 7.791 candidaturas dariam ~3,7 milhões de linhas por noite,
            # nove vezes todo o resto somado.
            if req.cargo in CARGOS_COM_SERIE_PERSISTIDA:
                insert_projections(
                    conn,
                    linhas_para_projections(uf_rows, national_rows, relogio.dado_ts),
                )
                conn.commit()
            else:
                # Ruidoso de propósito: um cargo que deixa de ser persistido em
                # silêncio some do replay e do gráfico sem ninguém notar.
                _log(
                    "warn",
                    "serie nao persistida: cargo fora de CARGOS_COM_SERIE_PERSISTIDA",
                    cargo=req.cargo,
                    turno=req.turno,
                    linhas_descartadas=len(uf_rows) + len(national_rows),
                )

            uf_count = len(estimates_by_uf)

        # Publicação no Edge Config — best-effort, fora da transação do DB.
        # Falha aqui não desfaz `projections` (fonte de verdade) — o
        # próximo ciclo do cron ressincroniza em <60s.
        ts_iso = datetime.now(timezone.utc).isoformat()

        # Spec 020 / RF-169 — a série foi lida ANTES do INSERT deste ciclo (a
        # leitura está centenas de linhas acima). Sem este passo ela sairia 60 s
        # atrasada em relação ao `pct_atual` que o mesmo payload publica no
        # placar logo acima do gráfico. A correção é anexar o ponto a partir da
        # memória — nunca reler `projections` depois da escrita, que custaria
        # uma segunda varredura dentro do orçamento de 60 s do ciclo.
        if serie_bruta is not None:
            # S08 § 3 — ANTES de anexar: o baseline é a série como veio do
            # banco, isto é, a linha que o leitor veria se este ciclo não
            # existisse. Só para os cargos com série persistida: sem gráfico
            # não há linha para congelar. Zero query — ver o bloco de
            # comentário sobre a decisão de projeto, acima de `vigiar_serie_cega`.
            vigiar_serie_cega(
                serie_bruta,
                uf_rows=uf_rows,
                dado_ts=relogio.dado_ts,
                cargo=req.cargo,
                turno=req.turno,
            )
            serie_bruta = anexar_ponto_corrente(
                serie_bruta,
                uf_rows=uf_rows,
                national_rows=national_rows,
                dado_ts=relogio.dado_ts,
                ts_iso=ts_iso,
            )

        try:
            edge_payload = build_edge_payload(
                cargo=req.cargo,
                turno=req.turno,
                ts_iso=ts_iso,
                uf_rows=uf_rows,
                national_rows=national_rows,
                eleitorado_total_by_uf=eleitorado_total_by_uf,
                cand_a_id=cand_a_id,
                cand_b_id=cand_b_id,
                # S05/F4c (ADR-0014) — métricas multi-candidato.
                p_segundo_turno_overall=scenarios.get("p_segundo_turno_overall"),
                cenarios_2t=scenarios.get("cenarios_2t", []),
                # Fase 1a (RF-020.1, D3/D4/D5/D6) — participação + outros.
                municipio_aggregates=municipio_aggregates,
                participacao_nacional=participacao_nacional,
                outros_nacional=outros_nacional,
                # Plano § B (E2/E2b) — base comparecimento nacional.
                national_estimates_comparecimento=national_estimates_comparecimento,
                # Spec 016 — sigla real do partido (RF-107) e o bloco de
                # composição das vagas, que só nasce em cargo de 2+ vagas.
                partido_by_cand=partido_by_cand,
                vagas=vagas_do_cargo if vagas_do_cargo >= 2 else None,
                vagas_em_disputa=cargo_vagas_em_disputa(req.cargo),
                total_cadeiras=cargo_total_cadeiras(req.cargo),
                # ADR-0038 D1/D2 — o segundo relógio, ao lado de `ts_iso`.
                dado_ts=relogio.dado_ts,
                pares_atrasados=relogio.pares_atrasados,
                # Spec 018 — RF-144 em `top_candidatos`, RF-145 no nacional
                # (que filtra por cargo 1 lá dentro, não aqui).
                identidade_by_cand=identidade_by_cand,
                # Spec 020 — material bruto da série; o elenco e a forma
                # colunar saem lá dentro, a partir de `national.candidatos`.
                serie_bruta=serie_bruta,
                # Fase 5 (E1) — swing descritivo vs 2022, `None` por UF sem
                # número de 2022.
                swing_by_uf=swing_by_uf,
                # Spec 021 (RF-199/RF-195) — contagens absolutas do agregado
                # do TSE + projeção CRUA das quatro fatias. `None` quando
                # nenhum agregado chegou (⇒ chave ausente, RF-198).
                votacao=build_votacao_payload(
                    agregados, req.cargo, participacao_nacional
                ),
                anulados=anulados,
            )
            # S04/F2 — payloads UF ricos (candidatos com votos, municípios,
            # séries temporais). Envia junto do nacional; endpoint Node
            # grava cada chave `projection-uf-<SIGLA>-<cargo>-t<turno>`
            # quando presente (nome derivado no TS — ver lib/edge-config/keys.ts).
            uf_payloads = build_uf_payloads(
                cargo=req.cargo,
                turno=req.turno,
                ts_iso=ts_iso,
                uf_rows=uf_rows,
                national_rows=national_rows,
                municipio_aggregates=municipio_aggregates,
                zona_municipio=zona_municipio,
                series_by_uf=series_by_uf,
                # Fase 1a (RF-020.1, D3/D4/D5/D6) — participação + outros.
                estimates_by_uf=estimates_by_uf,
                participacao_by_uf=participacao_by_uf,
                # Plano § B (E2/E2b) — base comparecimento por UF.
                estimates_c_by_uf=estimates_c_by_uf,
                # Spec 016 — RF-103 (`p_eleito`), RF-105/RF-106 (`vagas`) e
                # RF-107 (sigla do partido).
                p_eleito_by_uf=p_eleito_by_uf,
                vagas=vagas_do_cargo if vagas_do_cargo >= 2 else None,
                partido_by_cand=partido_by_cand,
                # ADR-0038 D2 — relógio do dado por UF, medido só sobre os
                # pares daquela UF.
                relogio_by_uf=relogio_uf,
                # Spec 018 / RF-144 — nome real no lugar de "Candidato {id}".
                identidade_by_cand=identidade_by_cand,
                # Spec 020 — mesma estrutura bruta do nacional; cada UF fatia a
                # sua dentro de `build_uf_payloads`.
                serie_bruta=serie_bruta,
                # Spec 022 (RF-209) — contagens + corrida do agregado de cada
                # UF. Inclusive no Presidente, que tem linha `br` para o
                # nacional mas precisa da UF para as telas de UF.
                # Spec 021 RF-192 emendado (26/09 noite) — `projetada` de cada
                # UF sai da participação projetada DA UF, a mesma que vira
                # `EdgePayloadUf.participacao` acima. Nunca a nacional.
                votacao_by_uf=build_votacao_uf_payloads(
                    agregados, req.cargo, participacao_by_uf
                ),
                anulados=anulados,
            )
            post_edge_write(edge_payload, payloads_uf=uf_payloads)
        except Exception as edge_exc:  # noqa: BLE001 — never block the response
            _log(
                "warn",
                "edge-write block failed",
                error=str(edge_exc),
                cargo=req.cargo,
                turno=req.turno,
            )
    except Exception as exc:  # noqa: BLE001 — converter para 500 estruturado
        trace_id = uuid.uuid4().hex[:12]
        _log(
            "error",
            "model_project_failed",
            trace_id=trace_id,
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        return 500, {"error": "internal_error", "trace_id": trace_id}

    duration_ms = (time.perf_counter_ns() - t0) // 1_000_000

    _log(
        "info",
        "model_project_ok",
        cargo=req.cargo,
        turno=req.turno,
        uf_count=uf_count,
        national_p_vitoria_a=national_p_a,
        candidato_a_id=cand_a_id,
        candidato_b_id=cand_b_id,
        duration_ms=int(duration_ms),
    )

    return 200, ProjectResponse(
        computed=True,
        uf_count=uf_count,
        national_p_vitoria_a=float(national_p_a),
        candidato_a_id=cand_a_id,
        candidato_b_id=cand_b_id,
        computed_duration_ms=int(duration_ms),
    ).model_dump()


class handler(BaseHTTPRequestHandler):
    """Vercel Python serverless handler.

    Convenção Vercel: classe nomeada `handler` herdando de
    `BaseHTTPRequestHandler` é detectada como entrypoint da function.
    """

    def do_GET(self) -> None:
        """Health check — útil pra validar deploy preview com curl."""
        self._send_json(200, {"ok": True, "method": "GET", "service": "model"})

    def do_POST(self) -> None:
        """Orchestrator T12 — projeção end-to-end."""
        # 1. Auth — header x-model-secret == MODEL_SECRET.
        expected = os.environ.get("MODEL_SECRET")
        if not expected:
            self._send_json(500, {"error": "misconfigured"})
            return
        provided = self.headers.get("x-model-secret")
        if provided != expected:
            self._send_json(401, {"error": "unauthorized"})
            return

        # 2. Lê body.
        length = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(length) if length > 0 else b""

        # 3. Delega para função pura (testável).
        status, payload = _do_project(body)
        self._send_json(status, payload)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        """Silencia logs default do BaseHTTPRequestHandler (usamos _log)."""
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
