---
id: 001-ingestao-tse
type: design
title: Ingestão TSE — Design Técnico
status: ready
last_updated: 2026-09-05
---

# Design — Ingestão TSE

## Arquitetura

Pipeline write-only que vive entre `Vercel Cron` e `Vercel Edge Config + Neon Postgres`. Ver [overview](../../architecture/overview.md).

```
Vercel Cron (a cada 60s, janela INGEST_WINDOW — default 17h–04h)
  → POST /api/ingest (Node, Fluid Compute)
    → [opcional] detectChangedUfs() via EA14 — filtra UFs sem alteração
    → rate limiter de saída (token bucket, TSE_MAX_RPS)
      → fetchEA20() por alvo (BR/UF por cargo — default; ou zona × cargo × UF)
        → Postgres snapshots (append-only, payload EA20 cru)
    → POST /api/model/project (Python 3.14)
      → Postgres projections + Vercel Edge Config
```

## Direcionamento EA14/EA15 (acompanhamento)

O CDN do TSE **não permite listar arquivos** — não há índice de diretório
([tse-2026-leiautes.md § 1](../../reference/tse-2026-leiautes.md)). Descobrir "o que mudou" só é
possível pelos arquivos de acompanhamento:

| Arquivo | Nome | Conteúdo |
|---|---|---|
| **EA14** (Brasil) | `br-e<eleicao6>-ab.json` | `abr[]` com 1 item `tpabr: "br"` + 1 item `tpabr: "uf"` **por UF com eleição** |
| **EA15** (UF) | `<uf>-e<eleicao6>-ab.json` | `abr[]` com 1 item `tpabr: "uf"` + 1 item `tpabr: "mun"` por município da UF |

Campos-chave por item: `and` (andamento `n`\|`p`\|`f`), `tpabr`, `cdabr`, `dt`/`ht` (última
totalização), `s`/`e` (mesma forma dos objetos de raiz do EA20). Note que **nem EA14 nem EA15
levam cargo no nome do arquivo** — 1 GET cobre todos os cargos daquela abrangência.

**Implementação**: `lib/tse/acompanhamento.ts` — `EA14Schema`/`EA15Schema` (`.passthrough()`),
`detectChangedUfs({ codEleicao, ufs, previous })` faz **1 GET do EA14** por ciclo, calcula
SHA-256 por item de UF (mais o ETag do arquivo inteiro) e devolve `UfChangeSignal[]`. Ativado por
`TSE_ACOMPANHAMENTO=on` em `app/api/ingest/route.ts`; sem a flag, todos os alvos são buscados.

**Fail-open por design**: qualquer falha (rede, 404, JSON inválido, Zod, UF ausente no EA14) marca
a UF como `changed: true`. Nunca se perde dado por causa do gating — no pior caso busca-se demais.

Com a granularidade `uf` (~55 GETs/ciclo) o gating deixou de ser necessidade de throughput e passou
a valer como **redução de escrita no Postgres** (menos INSERT em silêncio de madrugada) e como sinal
de observabilidade ("quais UFs estão totalizando agora").

## Rate limiting

Limites documentados pelo TSE ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)):
**100 req/s por IP**, cuja violação gera **bloqueio de 10 minutos renovado**; **304 conta** no
limite; **404 malformado também pode bloquear**, com limiar não divulgado.

**Implementação**: `lib/tse/rate-limiter.ts` — token bucket com relógio e `sleep` injetáveis;
`getTseRateLimiter(cargo?)` é o singleton de processo; sem `TSE_MAX_RPS` no ambiente ele usa o
teto **do cargo** (`lib/config/cargos.ts`, `rpsMax`: **25 req/s** para Presidente, Governador e
Senador; **5 req/s** para Deputado Federal; **5** quando o caller não informa cargo). `fetchEA20()`
chama `await getTseRateLimiter().acquire()` **antes de cada tentativa**, inclusive retries —
controle de **taxa**, complementar (não substituto) ao `INGEST_CONCURRENCY`, que só limita quantas
requisições ficam simultaneamente em voo.

429 e 503 são **retryáveis** (`lib/tse/retry.ts`): o delay é `max(backoffExponencial, Retry-After)`,
com cap de 15s por tentativa. O ciclo reporta `rateLimited` e `waitedMs` em `ingest_log`; qualquer
429 dispara alerta (RF-010.3).

> **Divergência aberta**: RF-010.3 fixa teto de **50 req/s**; `lib/tse/rate-limiter.ts` clampa hoje
> em 80. O default (30) está conforme — o teto precisa descer no código.

## Endpoints TSE

**Base URL**: configurável por `TSE_BASE_URL` (`lib/tse/targets.ts`, `getTseBaseUrl`):

| Ambiente | Valor |
|---|---|
| Produção (default) | `https://resultados.tse.jus.br/oficial` |
| Simulado oficial | `https://resultados-sim.tse.jus.br/simulado/simulado2026` |
| Dev / dry-run | `http://localhost:<porta>/oficial` (mock `scripts/tse-mock-server.ts`) |

Qualquer outro `http://` é rejeitado com throw (evita downgrade silencioso de TLS).

### Configuração da eleição (EA11)

```
GET <base>/comum/config/ele-c.json
```

Cacheado em memória da função. Campos relevantes:

- `pl[].e[].cd` — código da eleição (o `<eleição>` do path do CDN)
- `pl[].e[].t` — turno (1 ou 2)
- `pl[].e[].abr[].cd` — sigla UF (ou `br`)
- `pl[].e[].abr[].cp[].cd` — código do cargo (1 = Presidente, 3 = Governador)
- `c` (raiz) — ciclo eleitoral, ex. `"ele2026"` (o `<ciclo>` do path)

`TSE_COD_ELEICAO` codifica os dois segmentos concatenados: `ele<AAAA>/<dígitos>` (ex.
`ele2026/619`), validado por regex antes de qualquer GET.

### Configuração de municípios (EA12, arquivo único nacional)

```
GET <base>/comum/config/mun-e<eleição6>-cm.json
```

`abr[].mu[].z[]` lista os números de zona (4 dígitos) de cada município — origem dos dados de
`municipios`/`zonas` (RF-008). Trata-se de um arquivo único nacional, não um arquivo por UF como
em 2022. O campo `mu[].c` indica se é capital (`true`|`false`), semeado em `municipios.capital`
(ADR-0035 D1).

### Resultado unificado (EA20) — pasta e nome do arquivo

A pasta `dados/{br|<uf>|zz}/` é **folha** — não há subpasta de município. Os quatro formatos de
nome ([tse-2026-leiautes.md § 1](../../reference/tse-2026-leiautes.md)):

| Nível | Nome do arquivo | Builder |
|---|---|---|
| Brasil (só Presidente) | `br-c<cargo4>-e<eleicao6>-u.json` | `buildEA20UrlBr` |
| UF | `<uf>-c<cargo4>-e<eleicao6>-u.json` | `buildEA20UrlUf` |
| Município | `<uf><munic5>-c<cargo4>-e<eleicao6>-u.json` | `buildEA20UrlMunicipio` |
| Zona | `<uf><munic5>-z<zona4>-c<cargo4>-e<eleicao6>-u.json` | `buildEA20UrlZona` |

Exemplos corretos:
```
https://resultados.tse.jus.br/oficial/ele2026/619/dados/br/br-c0001-e000619-u.json
https://resultados.tse.jus.br/oficial/ele2026/619/dados/sp/sp-c0003-e000619-u.json
https://resultados.tse.jus.br/oficial/ele2026/619/dados/sp/sp71072-z0001-c0003-e000619-u.json
```

> **Correção (2026-09-05)**: o exemplo anterior desta seção
> (`.../dados/sp/sp80055/sp80055-c0001-z0001-e000544.json`) estava errado em **4 pontos**:
> (a) subpasta de município que não existe; (b) ordem `-c…-z…` invertida (o correto é `-z…-c…`);
> (c) faltava o sufixo `-u`; (d) o código de município precisa ser zero-padded a 5 dígitos
> (`71072`/`08055`, nunca `8055`). Toda URL malformada é risco de **bloqueio de IP** (RF-010.5).

### Granularidade (`TSE_GRANULARIDADE`)

| Valor | Alvos por ciclo (Presidente + Governador) | Uso |
|---|---|---|
| `uf` (**default**) | 27 UFs × 2 cargos + 1 BR = **~55 GETs** | Telas nacional/UF (specs 003–006) |
| `zona` | ~2.600 zonas × 2 cargos = **~5.200 GETs** | Swing zona-a-zona do modelo |

**Trade-off aberto (decisão humana, pós-simulado)**: o arquivo agregado de UF já vem pré-agregado
pelo TSE e **não contém os dados por zona**, então `TSE_GRANULARIDADE=uf` sozinho **não** atende
RF-011/RF-012 da [spec 002](../002-modelo-estatistico/spec.md), que calculam o swing vs. 2022 por
zona e agregam para UF ponderando por eleitorado. Desenho recomendado: **híbrido** — ciclo leve em
`uf` para as telas e busca em `zona` restrita às UFs que o EA14 sinaliza como alteradas
(`TSE_ACOMPANHAMENTO=on`). A escolha final entre híbrido e "zona escopado por EA14" depende de medir
latência e volume no simulado de 15–17/09 — ver [tse-2026-leiautes.md § 6](../../reference/tse-2026-leiautes.md).

## Par (município, zona) como unidade de ingestão e agregação (ADR-0035)

O TSE 2026 publica o EA20 de zona **por par** `(município, zona)`. Um arquivo por par — o nome
inclui o município de 5 dígitos (`<uf><munic5>-z<zona4>-c<cargo>-e<eleição>-u.json`), ex.
`sp71072-z0001-c0003-e000619-u.json`. Zona ↔ município é relação muitos-para-muitos: 62,5% das
zonas cobrem 2–8 municípios. O par é a interseção, mais fino que as duas visões, ambas deriváveis
dele por soma ([ADR-0035 D1, D2](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)).

Consequências:
- `zonas` (`lib/db/schema.ts:143-158`) é tabela de pares: PK `(uf, cod_municipio_tse, cod_zona)`, coluna `fonte` (`'ea12'` | `'csv'`).
- `snapshots` (`lib/db/schema.ts:164-193`) ganhou `codMunicipioTse int NOT NULL DEFAULT 0` e índice `ix_snap_lookup_par` — dedup por par, não por zona.
- `fetch_municipio_aggregates` (`api/model/project.py`) soma exata dos pares, sem rateio. Município é unidade de exibição.
- Modelo continua por zona (ADR-0021/0023 intocados): `api/model/zona_merge.py` soma pares de volta em zona em memória.

## Cron por cargo e rate limiter por invocação (ADR-0035 D3)

Duas rotas nova:
- `/api/ingest` — todos os cargos (preview, uso manual). Endpoint antigo, sem mudança de contrato.
- `/api/ingest/[cargo]` — `[cargo]` = segmento de rota (`presidente` ou `governador`), novo caminho do Vercel Cron.

`vercel.ts` aponta agora a `/api/ingest/presidente` e `/api/ingest/governador`, cada uma recebendo `GET` (do Vercel Cron, com `Authorization: Bearer`) além do `POST` (manual).

O lock anti-overlap é **por cargo** — `notes.cargo` em `ingest_log` — permitindo que Presidente e Governador rodem concorrentemente em processos separados, cada um com seu próprio rate limiter singleton (`lib/tse/rate-limiter.ts`).

Mudanças de operação:
- `TSE_MAX_RPS` deixou de ter default único e passou a ser **teto por cargo** (`lib/config/cargos.ts`): **25 rps** Presidente/Governador/Senador, **5 rps** Deputado Federal. Pior caso com os quatro crons simultâneos: 25+25+25+5 = **80 rps**, abaixo do teto documentado de 100 (RF-010.3). Histórico: 30 → 50 → 40 (fase de dois cargos) → por cargo em 11/09 (ADR-0026); em 13/09 o ADR-0036 pôs Deputado em zona sem mexer no rps, fatiando a varredura em 6.
- `maxDuration` 180→**300** s (fan-out por par chega a ~6.100 arquivos por cargo).
- Lock window 3→**6 min** (≥ `maxDuration`, evita overlap de dois ciclos do mesmo cargo).

## Schema EA20 (parcial relevante)

> **Reescrito em 2026-09-05.** A versão anterior desta seção descrevia um envelope com array
> `abr[]` de abrangências e candidatos achatados (`cand[].pn`, `cand[].sg`, `cand[].cc`) — um
> formato que **nunca existiu** no EA20. Era premissa herdada de 2022, jamais confirmada contra
> documento oficial (`grep` por `abr` como array de abrangências no leiaute EA20 real: **0
> ocorrências**; "abr" só aparece como sufixo de `cdabr`/`tpabr`). Fonte desta reescrita:
> [tse-2026-leiautes.md § 2](../../reference/tse-2026-leiautes.md), implementação de referência em
> `lib/tse/ea20-schema.ts`.

Três fatos estruturais do leiaute real:

1. **Cada arquivo JSON = uma única abrangência** (BR, UF, município ou zona), já identificada no
   nome do arquivo e nos campos de raiz `tpabr`/`cdabr`. Array de abrangências só existe no
   EA14/EA15 (acompanhamento).
2. **Totais em três objetos de raiz**: `s` (seções), `e` (eleitores), `v` (votos) — não em
   `abr[].psa`, `abr[].tap` etc.
3. **Candidatos em hierarquia** `carg[] → (fed[] | agr[].par[]) → agr[].par[].cand[]`. Partido
   (`par.sg`, `par.nm`) e coligação/federação (`agr.nm`, `agr.tp`) ficam **um e dois níveis acima**
   do candidato — `cand.pn`, `cand.pnm`, `cand.sg`, `cand.cc` **não existem**.

```ts
type EA20 = {
  ele: string;    // código da eleição
  t: string;      // turno: '1' | '2'
  f: string;      // fase: 'o' oficial | 's' simulado  (NUNCA travar em literal 'o')
  tpabr: string;  // 'br' | 'uf' | 'mu' | 'zona'
  cdabr: string;  // código da abrangência — p/ zona é o NÚMERO DA ZONA, não a UF
  dg: string;     // data de geração — dd/mm/aaaa  (não ddMMyyyy)
  hg: string;     // hora de geração — hh:mm:ss
  dt?, ht?, tf?, and?, md?, idg?, dv?, sup?: string;  // metadados condicionais

  s: {            // SEÇÕES
    ts: string;   // total de seções
    st: string; pst: string;      // totalizadas / %
    sa?: string; psa: string;     // apuradas / % apuradas  ← pctApurado do ingest
    /* si, sni, snt, sna + variantes 'n' de precisão estendida */
  };

  e: {            // ELEITORES
    te: string;   // eleitorado total (aptos)          ← era 'tap' na premissa antiga
    c: string;    // comparecimento                    ← era 'tc'
    pc?: string;  // % comparecimento
    a?: string;   // abstenção                         ← era 'ta'
    pa?: string;  // % abstenção
    /* est, esi, esa, esn* + variantes 'n' */
  };

  v: {            // VOTOS
    tv: string;      // total (vb + vn + vnt + van + vansj + vv)
    vvc?: string;    // votos a votáveis concorrentes = vv + van + vansj
    vv?: string;     // válidos                        ← era 'tvv'
    vnom?: string;   // NOMINAIS                       ← 'tvn' NÃO é nominais (ver abaixo)
    vl?: string;     // legenda (só proporcional)      ← era 'tvl'
    vb?: string; pvb?: string;   // brancos            ← era 'tvb'
    tvn?: string; ptvn?: string; // NULOS totais (vn + vnt) ← era 'tvnu'/'pvnu'
    vn?: string; pvn?: string;   // nulos (sem técnicos)
    van?: string; vansj?: string; // anulados / anulados sub judice
    vscv?: string; vsan?: string;
  };

  carg?: Array<{                 // ausente em consulta popular
    cd: string;                  // código do cargo (1 = Presidente, 3 = Governador)
    nv?: string; qe?: string;
    fed?: Array<{ n, nm, sg, com: string; npar: string[] }>;
    agr?: Array<{                // agremiação: coligação | isolado | federação
      n: string; nm: string; tp: string;   // 'c' | 'i' | 'f'
      com?: string; tvtn?, tvtl?, tvan?, tval?, vag?: string;
      par: Array<{               // PARTIDO — sigla/nome vivem aqui
        n: string; sg: string; nm: string; nfed?: string;
        cand?: Array<{
          n: string;             // número na urna
          sqcand: string;        // sequencial único (foto)
          nm: string; nmu: string;
          e: string;             // eleito / disputa 2º turno: 's' | 'n'
          vap: string;           // votos computados
          pvap: string;          // % (2 casas) — sobre votos a votáveis concorrentes
          pvapn?: string;        // % (9 casas)
          st?, dt?, dvt?, seq?: string;
          vs?: Array<{ tp, sqcand, nm, nmu, sgp: string }>;  // vice / suplentes
        }>;
      }>;
    }>;
  }>;
  perg?: [...];                  // consulta popular — fora de escopo
};
```

**Armadilhas de nome confirmadas no dicionário oficial** (cuidado ao portar código de 2022):

| Campo | Significado real 2026 | Significado presumido antes |
|---|---|---|
| `v.tvn` | **total de nulos** (`vn` + `vnt`) | "votos nominais" |
| `v.pvn` | **% de nulos** relativo a `vn` | "% votos nominais" |
| `v.vnom` / `v.pvnom` | votos nominais e seu % | — (não existia) |
| `cdabr` (arquivo de zona) | **número da zona** | sigla da UF |

**Denominadores**: `v.vvc` (votos a votáveis concorrentes) — não `v.tv` — é o denominador de "votos
a candidatos", e se decompõe em `vv` + `van` + `vansj`. `cand.pvap` já vem calculado sobre `vvc`.

**Validação**: Zod em `lib/tse/ea20-schema.ts` (o arquivo `ea20-parser.ts` citado antes nunca
existiu), com `.passthrough()` **em todos os níveis** — o TSE não anuncia freeze de leiaute, então
campo desconhecido nunca derruba o parse; só a ausência ou o tipo errado dos campos efetivamente
consumidos (`ele`, `t`, `f`, `tpabr`, `cdabr`, `dg`, `hg`, `s`, `e`, `v`) falha fail-fast, com log
estruturado. Voltar a `.strict()` está proibido (ADR-0020). Todos os numéricos chegam como string
em notação BR — `parseEA20Numeric()` converte no ponto de uso, preservando o payload bruto
(RF-010.1).

## Padrão de polling

```ts
// lib/tse/client.ts
// User-Agent HONESTO — identifica projeto, URL pública e contato. NUNCA declara
// cadastro/credenciamento: a Res. 23.751/2026 não prevê nenhum (RF-010.6, ADR-0020).
// 2026-10-03 — domínio próprio `atlasmenna.online` e SEM e-mail: a caixa de
// contato definida em 05/09 nunca existiu (sem registro MX), então não era
// contato verificável. Ver o docstring de `USER_AGENT` em lib/tse/client.ts.
export const USER_AGENT = 'AtlasMenna/1.0 (+https://atlasmenna.online)';

async function fetchEA20(opts: { url: string; etag?: string | null }): Promise<FetchResult> {
  // Token de taxa ANTES de cada tentativa, inclusive retries (RF-010.3).
  await getTseRateLimiter().acquire();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'User-Agent': USER_AGENT,
  };
  // If-None-Match só quando há ETag não-vazio (RF-003). Lembrar: 304 consome cota (RF-010.4).
  if (opts.etag) headers['If-None-Match'] = opts.etag;

  const res = await fetch(opts.url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 304) return { kind: 'not_modified' };
  if (res.status === 404) return { kind: 'not_found' };          // não é erro: alvo ainda sem dados
  if (!res.ok) {
    // 429/503 carregam retryAfterMs parseado do header Retry-After → retry honra o valor.
    throw new TSEError(res.status, opts.url, { retryAfterMs: parseRetryAfterMs(res) });
  }

  const text = await res.text();
  return { kind: 'fresh', data: EA20Schema.parse(JSON.parse(text)), etag: res.headers.get('etag'), hash: sha256(text) };
}
```

## Cadenciamento

| Janela | Cadência | Estratégia |
|---|---|---|
| Sábado (dia anterior) <12h | 1× | Validar "divulgação zero" |
| Sábado >12h, antes do domingo | 1×/hora | Heartbeat |
| Domingo <17h | 1×/min | Aguardar abertura |
| Domingo 17h–04h | A cada 60s | Apuração ativa ([ADR-0011](../../architecture/adrs/0011-cadencia-60s.md)) |
| Após 99% apurado | A cada 5min | Convergência final |
| Pós-eleição | Manual | Reconciliação |

| Simulados oficiais (15–17/09, 22–24/09) | A cada 60s, 9h–17h | `INGEST_WINDOW=9-17` no preview |

**Notas**:
- A tabela original previa 15s no pico de apuração. Cadência foi revisada para 60s — granularidade mínima do Vercel Cron nativo, sem self-loop dentro da função. Defasagem TSE→tela ajustada de <30s para <90s ([RNF-006](../../nfr/performance.md)).
- A janela deixou de ser literal `17h–04h` no código: `INGEST_WINDOW` (default `17-04`, suporta janela cruzando a meia-noite) parametriza `lib/tse/ingest-window.ts`, e `INGEST_WINDOW_OVERRIDE` continua disponível para dry-run. Sem isso os simulados — que rodam 9h–17h — cairiam sempre em `skipped: out_of_window`.

## Tratamento de falhas

| Falha | Mitigação |
|---|---|
| 304 Not Modified | Esperado — pula o arquivo (mas **conta no limite de taxa**, RF-010.4) |
| 404 | Alvo ainda sem dados — contador + log `debug`, retry no próximo ciclo. **Nunca** provocar 404 de propósito: pode bloquear o IP (RF-010.5) |
| 429 (rate limited) | Retryável honrando `Retry-After` (cap 15s/tentativa); contador `rateLimited` + alerta Slack; indica `TSE_MAX_RPS` alto demais |
| 503 | Idem 429 — retry com `max(backoff, Retry-After)` |
| 5xx | Retry com backoff exponencial (3 tentativas, 1s/2s/4s) |
| Timeout >5s | Aborta, retry no próximo ciclo |
| JSON inválido / Zod | Log com amostra do corpo, alerta Slack; ciclo segue nos demais alvos |
| TSE down >60s | Banner "Reconectando" no frontend, mantém último valor |
| TSE down >5min | Alerta crítico Slack; abrir chamado em `30308800.tse.jus.br` (descrição começa com `Resultados - Divulgação`) |

## Volume estimado

Para Presidente + 27 Governadores no 1º turno (recalculado em 2026-09-05 — o número antigo de
"~84.000 arquivos / ~2.500 GETs por ciclo" vinha da premissa de 28 cargos × 3.000 zonas, que
confundia cargos com corridas: são **2 códigos de cargo** (1 e 3), não 28):

| Granularidade | Arquivos por ciclo | Observação |
|---|---|---|
| `uf` (default) | 27 UFs × 2 cargos + 1 BR = **~55** | Cabe folgado em qualquer janela de 60s, mesmo com retries |
| `zona` | ~2.600 zonas × 2 cargos = **~5.200** | Só cabe com rate limiter + gating EA14; é a granularidade que o modelo precisa |

Em qualquer dos modos, o que se compara ao limite do TSE é o **número de requisições planejadas**,
não o de downloads: em regime de convergência a maioria responde 304, e 304 conta igual.

## Persistência

- **`snapshots`** (Postgres) — append-only, `payload` guarda o envelope EA20 **cru e inalterado**
  (art. 267 §4º / RF-010.1), hash SHA-256 do corpo para dedup, ETag persistido.
- **Vercel Blob** — previsto no design original para auditoria post-mortem; **não implementado**
  (decisão D-3 em [tasks.md](./tasks.md): só Postgres nesta fase, dual-write fica em backlog).

## ADRs aplicáveis

- [ADR-0001 Edge Config no read path](../../architecture/adrs/0001-edge-config-no-read-path.md)
- [ADR-0002 Polling com CDN cache](../../architecture/adrs/0002-polling-cdn-cache.md)
- [ADR-0008 Não Convex](../../architecture/adrs/0008-nao-convex.md)
- [ADR-0011 Cadência de polling 60s](../../architecture/adrs/0011-cadencia-60s.md)
- [ADR-0020 Conformidade Res. 23.751/2026, sem cadastro](../../architecture/adrs/0020-conformidade-res-23751-2026.md)

## Riscos técnicos

- **Leiaute EA20 muda sem aviso** — o TSE **não anuncia freeze de leiaute**, e o EA20 já mudou de
  estrutura entre 2022 e 2026 sem changelog público. Mitigação: `.passthrough()` em todos os níveis
  (nunca `.strict()`), fixtures dos simulados como regressão, `pnpm tse:watch` monitorando
  `ele-c.json` e os leiautes publicados. **Risco residual**: um campo que o pipeline consome
  (`v.vvc`, `s.psa`) ser renomeado — o parse aceitaria o arquivo e o valor sumiria em silêncio.
- **Bloqueio de IP por 10 minutos** — 100 req/s por IP, renovado a cada violação durante o bloqueio;
  404 malformado também pode bloquear. Mitigação: rate limiter de saída, URLs só de builders
  determinísticos, zero sondagem (RF-010.3/RF-010.5).
- **`TSE_MAX_RPS` é estimativa, não medição** — só calibrável nas duas janelas de simulado
  (15–17/09 e 22–24/09) antes do dia D.
- **Lag entre ingest e Edge Config write** — propagação Edge Config é ~5–10s; cabe no orçamento de
  <90s de [RNF-006](../../nfr/performance.md).

## Cross-refs

- Spec: [./spec.md](./spec.md)
- Leiautes oficiais TSE 2026 (fonte de verdade): [../../reference/tse-2026-leiautes.md](../../reference/tse-2026-leiautes.md)
- Spec downstream (modelo): [../002-modelo-estatistico/](../002-modelo-estatistico/)
- Spec 001.1 (refactor JSON — **superseded**, premissas falsas): [../001.1-tse-json-refactor/spec.md](../001.1-tse-json-refactor/spec.md)
- Runbook (TSE indisponível): [../../operations/runbook.md](../../operations/runbook.md)
- Testes: [../../testing/integration.md](../../testing/integration.md), [../../testing/replay.md](../../testing/replay.md)
