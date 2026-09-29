# Deputado Federal (cargo 6) — EA20 reais do simulado TSE, RR e AP

Dados de contrato para a spec 026 (listas por partido, projeção com trava, correções de `dvt`, `% apurado` e
Conferência). São arquivos **EA20 crus de Deputado Federal** (eleição estadual `21272`, cargo `6`, turno 1) do
**simulado oficial do TSE** que o pipeline já tinha gravado em `snapshots` — **nenhuma requisição ao TSE foi feita**
para montar esta pasta.

## Origem

- Banco de produção (`DATABASE_URL` do `.env.local`), **somente `SELECT`**, em `BEGIN TRANSACTION READ ONLY` com
  `PGOPTIONS='-c default_transaction_read_only=on'`. Nada foi escrito.
- Tabela `snapshots` (`lib/db/schema.ts:165`): `cargo = 6`, `turno = 1`, `uf IN ('RR','AP')`. O `payload` (jsonb) é o
  EA20 cru; `nivel = 'uf'` é o agregado do estado (`tpabr: "uf"`, `cod_zona = 0`), `nivel = 'zona'` é um par
  município×zona (`api/model/project.py::particionar_por_nivel`, `nivel_do_snapshot`).
- Universo: 600 linhas (RR 302, AP 298; 14 agregados). Todas com `payload->>'ele' = '21272'`.
- Janelas gravadas: 23–24/09 (zonas) e 26/09 (agregado, já em 100% final de 24/09), **28/09** (rodada completa
  0% → 100% com agregado a cada ~30 min, a única em que agregado e zonas andam juntos) e 29/09 (rodada nova, 0%).
  Os momentos abaixo são todos da rodada de **28/09**.
- Formato: o texto de `payload::text` (jsonb — a ordem das chaves é a do jsonb, não a do arquivo original do TSE;
  espaços removidos). O **conteúdo** é o mesmo. `hash_payload` do banco é o SHA-256 do texto original, então **não**
  bate com o destes arquivos.
- `cand.dt` (data de nascimento) foi **mantido cru**: os candidatos do simulado são sintéticos (`CANDIDATO 9275`) e o
  repositório já guarda EA20 cru com `dt` (`tests/fixtures/tse/2026-sim/senado/*.json`). Sem PII real.

## Momentos e o que é "estado do mundo"

Para cada momento, o agregado é a linha `nivel = 'uf'` indicada. As zonas são, por par, a **última linha de zona com
`ts` ≤ `ts` do agregado + 90 s** (e `ts` ≥ 28/09) — é o que `fetch_snapshots` leria no ciclo. A ingestão só grava
linha nova quando o hash muda, então uma zona parada mantém a linha de ciclos anteriores.

| UF | Momento | % seções totalizadas (`s.pst`) | Zonas com boletim (`esi>0 ∧ vv>0`) |
|---|---|---|---|
| RR | `m0-zero` (só agregado) | 0,00 | 0 de 16 |
| RR | `m1-inicial-pst20` | 20,06 (`e.esi/e.te` = 20,19%) | **1 de 16** (Boa Vista zona 1, 38,6% do eleitorado) |
| RR | `m2-tardio-pst94` | 94,14 | 15 de 16 (3107×7 parcial a 84,6%; 3085×8 ainda em 0) |
| RR | `m3-final-tf` | 100,00, `tf = s` | 16 de 16 |
| AP | `m1-inicial-pst34` | 34,08 (`e.esi/e.te` = 33,00%) | 7 de 17 |
| AP | `m2-tardio-pst84` | 84,15 | 17 de 17 (todas em `and=f`, `tf=n`) |
| AP | `m3-final-tf` | 100,00, `tf = s` | 17 de 17 |

`zonas-resumo.json` (um por UF) lista **todas** as zonas de cada momento (id, `ts`, `te`, `esi`, `vv`, `pst`) e diz
quais têm o JSON cru guardado aqui. Só quatro zonas por momento (duas no final) foram guardadas, para manter a pasta
pequena; as outras se relêem do banco pelo `snapshot_id`.

## Arquivos

Nomes seguem o padrão de `tests/fixtures/tse/2026-sim/` (`<uf><município 5 dígitos>-z<zona>-c0006-e021272-u.json`;
agregado: `<uf>-c0006-e021272-u.json`).

| UF | Momento | Tipo | Arquivo | `snapshots.id` | `ts` (UTC) | `dg` `hg` | `and`/`tf` | `s.pst` | Tamanho |
|---|---|---|---|---|---|---|---|---|---|
| RR | inicial | agregado UF | `rr/m1-inicial-pst20/rr-c0006-e021272-u.json` | 355698 | 2026-09-28 18:21:19.606 | 28/09/2026 15:11:54 | p/n | 20,06 | 43 KiB |
| RR | inicial | zona 03018×0001 | `rr/m1-inicial-pst20/rr03018-z0001-c0006-e021272-u.json` | 355703 | 2026-09-28 18:21:20.067 | 28/09/2026 15:11:57 | p/n | 53,02 | 43 KiB |
| RR | inicial | zona 03018×0005 | `rr/m1-inicial-pst20/rr03018-z0005-c0006-e021272-u.json` | 337141 | 2026-09-28 17:50:31.389 | 28/09/2026 14:40:33 | n/n | 0,00 | 36 KiB |
| RR | inicial | zona 03107×0007 | `rr/m1-inicial-pst20/rr03107-z0007-c0006-e021272-u.json` | 337339 | 2026-09-28 17:50:43.018 | 28/09/2026 14:40:34 | n/n | 0,00 | 36 KiB |
| RR | inicial | zona 03000×0004 | `rr/m1-inicial-pst20/rr03000-z0004-c0006-e021272-u.json` | 337133 | 2026-09-28 17:50:31.188 | 28/09/2026 14:40:33 | n/n | 0,00 | 36 KiB |
| RR | tardio | agregado UF | `rr/m2-tardio-pst94/rr-c0006-e021272-u.json` | 372808 | 2026-09-28 19:20:32.460 | 28/09/2026 16:11:15 | p/n | 94,14 | 43 KiB |
| RR | tardio | zona 03018×0001 | `rr/m2-tardio-pst94/rr03018-z0001-c0006-e021272-u.json` | 365069 | 2026-09-28 18:52:43.414 | 28/09/2026 15:32:46 | f/n | 100,00 | 43 KiB |
| RR | tardio | zona 03018×0005 | `rr/m2-tardio-pst94/rr03018-z0005-c0006-e021272-u.json` | 372809 | 2026-09-28 19:20:32.628 | 28/09/2026 16:01:18 | f/n | 100,00 | 43 KiB |
| RR | tardio | zona 03107×0007 | `rr/m2-tardio-pst94/rr03107-z0007-c0006-e021272-u.json` | 372816 | 2026-09-28 19:20:34.685 | 28/09/2026 16:11:19 | p/n | 84,62 | 42 KiB |
| RR | tardio | zona 03000×0004 | `rr/m2-tardio-pst94/rr03000-z0004-c0006-e021272-u.json` | 365067 | 2026-09-28 18:52:43.212 | 28/09/2026 15:32:45 | f/n | 100,00 | 42 KiB |
| RR | final | agregado UF | `rr/m3-final-tf/rr-c0006-e021272-u.json` | 379408 | 2026-09-28 19:52:42.849 | 28/09/2026 16:37:44 | f/s | 100,00 | 45 KiB |
| RR | final | zona 03018×0001 | `rr/m3-final-tf/rr03018-z0001-c0006-e021272-u.json` | 379421 | 2026-09-28 19:52:43.454 | 28/09/2026 16:37:50 | f/s | 100,00 | 45 KiB |
| RR | final | zona 03107×0007 | `rr/m3-final-tf/rr03107-z0007-c0006-e021272-u.json` | 379589 | 2026-09-28 19:52:57.634 | 28/09/2026 16:37:50 | f/s | 100,00 | 44 KiB |
| AP | inicial | agregado UF | `ap/m1-inicial-pst34/ap-c0006-e021272-u.json` | 357274 | 2026-09-28 18:31:14.487 | 28/09/2026 15:21:14 | p/n | 34,08 | 39 KiB |
| AP | inicial | zona 06050×0002 | `ap/m1-inicial-pst34/ap06050-z0002-c0006-e021272-u.json` | 357278 | 2026-09-28 18:31:14.968 | 28/09/2026 15:21:15 | f/n | 100,00 | 39 KiB |
| AP | inicial | zona 06157×0006 | `ap/m1-inicial-pst34/ap06157-z0006-c0006-e021272-u.json` | 357281 | 2026-09-28 18:31:16.560 | 28/09/2026 15:21:16 | p/n | 16,27 | 39 KiB |
| AP | inicial | zona 06017×0001 | `ap/m1-inicial-pst34/ap06017-z0001-c0006-e021272-u.json` | 357275 | 2026-09-28 18:31:14.605 | 28/09/2026 15:04:48 | f/n | 100,00 | 39 KiB |
| AP | inicial | zona 06025×0012 | `ap/m1-inicial-pst34/ap06025-z0012-c0006-e021272-u.json` | 349060 | 2026-09-28 18:01:15.765 | 28/09/2026 14:40:32 | n/n | 0,00 | 33 KiB |
| AP | tardio | agregado UF | `ap/m2-tardio-pst84/ap-c0006-e021272-u.json` | 368934 | 2026-09-28 19:03:42.284 | 28/09/2026 16:01:15 | p/n | 84,15 | 39 KiB |
| AP | tardio | zona 06050×0002 | `ap/m2-tardio-pst84/ap06050-z0002-c0006-e021272-u.json` | 357278 | 2026-09-28 18:31:14.968 | 28/09/2026 15:21:15 | f/n | 100,00 | 39 KiB |
| AP | tardio | zona 06157×0006 | `ap/m2-tardio-pst84/ap06157-z0006-c0006-e021272-u.json` | 368958 | 2026-09-28 19:03:57.496 | 28/09/2026 15:32:45 | f/n | 100,00 | 39 KiB |
| AP | tardio | zona 06017×0001 | `ap/m2-tardio-pst84/ap06017-z0001-c0006-e021272-u.json` | 357275 | 2026-09-28 18:31:14.605 | 28/09/2026 15:04:48 | f/n | 100,00 | 39 KiB |
| AP | tardio | zona 06025×0012 | `ap/m2-tardio-pst84/ap06025-z0012-c0006-e021272-u.json` | 368935 | 2026-09-28 19:03:42.893 | 28/09/2026 16:01:18 | f/n | 100,00 | 39 KiB |
| AP | final | agregado UF | `ap/m3-final-tf/ap-c0006-e021272-u.json` | 385606 | 2026-09-29 12:01:34.123 | 28/09/2026 16:39:29 | f/s | 100,00 | 41 KiB |
| AP | final | zona 06050×0002 | `ap/m3-final-tf/ap06050-z0002-c0006-e021272-u.json` | 385621 | 2026-09-29 12:01:35.815 | 28/09/2026 16:39:34 | f/s | 100,00 | 41 KiB |
| AP | final | zona 06157×0006 | `ap/m3-final-tf/ap06157-z0006-c0006-e021272-u.json` | 385644 | 2026-09-29 12:01:38.086 | 28/09/2026 16:39:35 | f/s | 100,00 | 41 KiB |
| RR | zero | agregado UF | `rr/m0-zero/rr-c0006-e021272-u.json` | 337130 | 2026-09-28 17:50:30.910 | 28/09/2026 14:40:22 | n/n | 0,00 | 36 KiB |

## Consultas usadas (todas de leitura)

```sql
-- inventário: cargo 6 de RR/AP por nível
SELECT cargo, turno, nivel, uf, count(*), min(ts), max(ts), count(distinct (cod_municipio_tse, cod_zona))
FROM snapshots WHERE cargo = 6 AND uf IN ('RR','AP') GROUP BY 1,2,3,4;

-- agregados de UF (cabeçalho: dg, hg, tf, and, qe, nv, s.pst, e.te, e.esi, v.vv)
SELECT id, uf, ts, pct_apurado, payload->>'tf' tf, payload->'carg'->0->>'qe' qe, payload->'s'->>'pst' pst
FROM snapshots WHERE cargo = 6 AND uf IN ('RR','AP') AND nivel = 'uf' ORDER BY uf, ts;

-- despejo completo usado para gerar os arquivos e as medidas
SELECT json_build_object('id', id::text, 'uf', uf, 'nivel', nivel, 'ts', ts, 'mun', cod_municipio_tse,
       'zona', cod_zona, 'pct', pct_apurado::text, 'payload', payload)::text
FROM snapshots WHERE cargo = 6 AND uf IN ('RR','AP') AND turno = 1 ORDER BY uf, nivel, ts, id;

-- conferência dos pares (achado do AP)
SELECT uf, cod_municipio_tse, cod_zona, fonte FROM zonas;   -- comparado com o EA12 mun-e021270-cm.json
```

## O que estes arquivos mostram (medido; detalhes no relatório da tarefa)

1. **`cand.dvt`**: `Válido`, `Anulado sub judice`, `Válido (legenda)` e **ausente** — ausente **só** quando
   `and = "n"` (apuração não iniciada). Nunca apareceu `Anulado` puro.
2. **Identidades exatas em 100% dos 417 arquivos com `and ≠ "n"`** (agregados e zonas):
   `par.tvtn = Σ cand.vap[dvt=Válido]`; `par.tvan = Σ cand.vap[todos]`;
   `par.tvtl = par.tval + Σ cand.vap[dvt=Válido (legenda)]`; `v.vv = Σ_par (tvtn + tvtl) = v.vnom + v.vl`;
   `v.vansj = Σ cand.vap[dvt=Anulado sub judice]`.
3. **`s.psa` é binário** neste feed: `"0,00"` com `and = n`, `"100,00"` em qualquer arquivo com um boletim (`p` ou `f`).
   O que anda é `s.pst` e `e.esi/e.te` (`e.pest`). O banco grava `pct_apurado = s.psa`
   (`lib/tse/ingest-handler.ts:732-745`) — **não serve como medida de avanço**.
4. **AP: a soma das zonas nunca fecha com o agregado do TSE** a partir do momento em que o agregado inclui Macapá
   zona 0014, que **não existe** na tabela `zonas` (o EA12 do simulado a lista; `zonas` vem do CSV de 2024).
   Σ `e.te` das 17 zonas = 505.610 contra 628.071 do agregado (−19,5%); Σ `v.vv` 358.054 contra 445.241 no final.
   RR fecha exatamente (16 zonas, por candidato e por partido) em todos os momentos. Ver `ap/zonas-resumo.json`.
