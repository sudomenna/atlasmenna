---
title: Modelo de Dados
description: Schema Postgres (Neon) e payload do Edge Config — fonte canônica do shape de dados
status: stable
source: PRD.md § 11
---

# Modelo de Dados

## Tabelas Postgres (Neon)

```sql
-- Histórico de eleições GERAIS (Presidente + Governador) — 2018 e 2022.
-- NÃO inclui 2024 (pleito municipal: prefeito/vereador — fora do escopo do SalaCofre).
-- Se houver expansão futura para municipal, adicionar cargos 11 (Prefeito), 13 (Vereador) e ano 2020/2024.
CREATE TABLE historical_results (
  id BIGSERIAL PRIMARY KEY,
  ano SMALLINT NOT NULL,            -- 2018, 2022 (ciclos de eleição geral)
  turno SMALLINT NOT NULL,          -- 1, 2
  cargo SMALLINT NOT NULL,          -- 1 = Presidente, 3 = Governador
  uf CHAR(2) NOT NULL,
  cod_municipio_tse INT,
  cod_zona INT NOT NULL,
  cod_candidato INT NOT NULL,
  nome_candidato TEXT,
  partido VARCHAR(20),
  votos INT NOT NULL,
  pct_validos NUMERIC(8,5),
  pct_total NUMERIC(8,5),
  UNIQUE (ano, turno, cargo, uf, cod_zona, cod_candidato)
);
CREATE INDEX ix_hist_lookup ON historical_results (ano, turno, cargo, uf, cod_zona);

-- Eleitorado por PAR (município × zona) — atualizado para 2026.
-- ADR-0035 D1 / migration 0006: a PK era (ano, uf, cod_zona), o que forçava o
-- importador a creditar a zona inteira a um município só. 62,5% das zonas
-- cobrem de 2 a 8 municípios; o total por zona é SUM(...) GROUP BY uf, cod_zona.
CREATE TABLE eleitorado (
  ano SMALLINT NOT NULL,
  uf CHAR(2) NOT NULL,
  cod_municipio_tse INT NOT NULL,
  cod_zona INT NOT NULL,
  eleitores_aptos INT NOT NULL,
  comparecimento_pct_historico NUMERIC(5,4),
  PRIMARY KEY (ano, uf, cod_municipio_tse, cod_zona)
);

-- Mesorregiões IBGE (migration 0005) — dimensão entre UF e município.
-- cod = 4 dígitos IBGE (UF[2] + meso[2]). Ex.: 3510 = SP / Itapeva.
CREATE TABLE mesorregioes (
  cod CHAR(4) PRIMARY KEY,
  nome TEXT NOT NULL,
  uf_sigla CHAR(2) NOT NULL
);
CREATE INDEX ix_meso_uf ON mesorregioes (uf_sigla);

-- Mapeamento geográfico
CREATE TABLE municipios (
  cod_ibge CHAR(7) PRIMARY KEY,
  cod_municipio_tse INT NOT NULL UNIQUE,
  uf CHAR(2) NOT NULL,
  nome TEXT NOT NULL,
  geo_centroid GEOGRAPHY(POINT),
  populacao INT,
  mesorregiao_cod CHAR(4) REFERENCES mesorregioes(cod) ON DELETE SET NULL, -- 0005
  capital BOOLEAN NOT NULL DEFAULT false                                   -- 0006
);
CREATE INDEX ix_municipio_uf ON municipios (uf);
CREATE INDEX ix_municipio_meso ON municipios (mesorregiao_cod);

-- Pares (município × zona). O nome `zonas` é herdado: uma linha é um PAR.
-- ADR-0035 D1 / migration 0006 (emenda o ADR-0002, que fixara (uf, cod_zona)):
-- o TSE 2026 publica um EA20 por par, e enumerar alvos por zona pediria ~2.651
-- dos ~6.085 arquivos — perdendo ~56% dos votos sem nenhum 404.
-- Fonte primária: 'ea12' (arquivo de configuração de municípios, nacional) desde 15/09;
-- fallback: 'csv' (eleitorado 2024 até o EA12 2026 existir).
CREATE TABLE zonas (
  uf CHAR(2) NOT NULL,
  cod_municipio_tse INT NOT NULL,
  cod_zona INT NOT NULL,
  nome TEXT,
  fonte TEXT NOT NULL DEFAULT 'csv',  -- 'ea12' | 'csv'
  PRIMARY KEY (uf, cod_municipio_tse, cod_zona),
  FOREIGN KEY (cod_municipio_tse) REFERENCES municipios(cod_municipio_tse) ON DELETE RESTRICT
);
CREATE INDEX ix_zona_uf ON zonas (uf);

-- Snapshots append-only do TSE durante apuração
CREATE TABLE snapshots (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cargo SMALLINT NOT NULL,
  turno SMALLINT NOT NULL,
  uf CHAR(2) NOT NULL,
  cod_municipio_tse INT NOT NULL DEFAULT 0, -- 0006; sentinel 0 = abrangência BR/UF
  cod_zona INT NOT NULL,
  etag TEXT,                        -- ETag do TSE para dedup
  pct_apurado NUMERIC(5,2),
  votos_total INT,
  payload JSONB NOT NULL,           -- EA20 cru
  hash_payload CHAR(64) NOT NULL    -- SHA256 para detecção rápida de mudança
);
CREATE INDEX ix_snap_lookup ON snapshots (cargo, turno, uf, cod_zona, ts DESC);
CREATE INDEX ix_snap_lookup_par ON snapshots (cargo, turno, uf, cod_municipio_tse, cod_zona, ts);
CREATE INDEX ix_snap_ts ON snapshots (ts DESC);

-- Cálculos de projeção (histórico do modelo)
CREATE TABLE projections (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- quando o Python rodou
  cargo SMALLINT NOT NULL,
  turno SMALLINT NOT NULL,
  uf CHAR(2),                       -- NULL = nacional
  candidato_id INT NOT NULL,
  votos_projetados BIGINT,
  pct_projetado NUMERIC(8,5),
  pct_projetado_lower NUMERIC(8,5), -- CI95 lower
  pct_projetado_upper NUMERIC(8,5),
  p_vitoria NUMERIC(5,4),
  pct_apurado NUMERIC(5,2),         -- ⚠️ PROGRESSO da apuração, não fatia de candidatura
  -- migration 0009 — a base "apurado" da série da spec 020. As três são
  -- ANULÁVEIS e SEM DEFAULT de propósito: NULL é "não foi medido", 0 seria
  -- uma afirmação. A própria migration reprova se alguém as criar com
  -- NOT NULL ou DEFAULT. Ver «pct_apurado ≠ pct_atual» logo abaixo.
  pct_atual NUMERIC(8,5),           -- ⚠️ FATIA de votos da candidatura, 0–100
  votos_atuais BIGINT,              -- numerador de pct_atual (denominador é móvel)
  dado_ts TIMESTAMPTZ               -- hora do BOLETIM do TSE (ADR-0038), não do cálculo
);
CREATE INDEX ix_proj_lookup ON projections (cargo, turno, uf NULLS FIRST, ts DESC);
-- 0009: uma linha do gráfico é exatamente um prefixo desta chave. O
-- ix_proj_lookup para em `uf` e obrigaria a varrer todas as candidaturas
-- da UF para desenhar uma.
CREATE INDEX ix_proj_serie ON projections (cargo, turno, uf, candidato_id, ts);

-- Operational
CREATE TABLE ingest_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INT,
  files_fetched INT,
  files_changed INT,
  errors INT,
  notes TEXT
);
```

## `pct_apurado` ≠ `pct_atual` — colunas vizinhas, significados opostos

As duas moram na mesma tabela, as duas são `0–100`, e medem coisas contrárias.
É a confusão mais provável deste schema, e por isso está escrita aqui, na
migration (`data-pipeline/migrations/0009_projections_pct_atual.ts`) e no
docstring de `insert_projections`.

| Coluna | Grandeza | Denominador | `37` significa |
|---|---|---|---|
| `pct_apurado` (pré-existente) | **progresso da apuração** no escopo da linha | seções/zonas esperadas | "37% da apuração já saiu" |
| `pct_atual` (0009) | **fatia de votos da candidatura** | votos a votáveis já apurados (`v.vvc`) | "esta candidatura tem 37% dos votos contados até agora" |

O nome `pct_atual` foi mantido porque é o que o dicionário Python,
`EdgeCandidate` e `EdgeUfCandidate` já usam ponta a ponta — um quarto nome
criaria mais uma tradução na pilha. O mesmo par de nomes atravessa o payload e
os tipos de transporte, com a mesma armadilha.

**Por que `votos_atuais` existe.** `pct_atual` tem denominador **móvel** (os
votos a votáveis crescem a noite toda) e percentual não se re-agrega: sem o
numerador, a série nacional não se reconstrói a partir das UFs sem rodar o
modelo de novo. O nacional é **razão de somas** — `Σ votos_atuais` da
candidatura ÷ `Σ votos_atuais` de todas as UFs — nunca média dos percentuais
das 27 UFs (`pct_atual_nacional_por_candidato`, `api/model/project.py`).

**Por que `dado_ts` existe.** É o eixo horizontal do gráfico da spec 020, e tem
de ser a hora do **boletim** ([ADR-0038](adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)).
Com `ts` (hora do cálculo), uma ingestão parada desenharia uma linha que
continua avançando no eixo sobre dado congelado. `ts` não muda de significado:
continua sendo "quando o Python rodou".

**Prazo.** A migration é pré-requisito do gráfico da noite e **já está aplicada
em produção**. Cada ciclo que rodasse sem ela seria um ponto perdido para
sempre — o EA20 publica o acumulado corrente, não o histórico, e passado não se
reconstrói depois.

### Escopo do que é persistido — `CARGOS_COM_SERIE_PERSISTIDA`

`CARGOS_COM_SERIE_PERSISTIDA = frozenset({1, 3, 5})` em `api/model/project.py`:
**Presidente** (nacional **e** por UF), **Governador** e **Senador** têm série
gravada. **Deputado Federal (6) fica de fora.**

Volume medido por ciclo e por noite de 8h a 60s (480 ciclos):

| Cargo | Linhas/ciclo | Linhas/noite |
|---|---|---|
| Presidente (nacional + 27 UFs) | 364 | ~175.000 |
| Senador | 319 | ~153.000 |
| Governador | 200 | ~96.000 |
| **Subtotal persistido** | **883** | **~424.000** |
| ~~Deputado Federal~~ (excluído) | 7.791 | ~3.700.000 |

Deputado Federal sozinho seria **nove vezes todo o resto somado**. Hoje o cargo
6 tem caminho próprio (`api/model/deputado.py`) e nem chega a este ponto — a
constante existe para que ligá-lo um dia seja uma **decisão**, e não efeito
colateral: a validação de entrada aceita `cargo` 1..99 de propósito (um código
inesperado não pode derrubar o ciclo), então a fronteira do que se **grava**
mora na constante, não na borda. Se um dia precisar, o caminho é guardar só as
candidaturas mais votadas, nunca as 7.791. Dois testes travam a decisão
(`tests/unit/model/test_projections_serie.py`).

## Escala de percentuais

O modelo (`api/model/`) trabalha internamente em **fração [0,1]** — é o
espaço do bootstrap (`bootstrap_uf`), de `edge_cases.py` (RF-017/RF-018) e
de `p_vitoria`. A fronteira de saída é `compute_uf_projections` /
`compute_national`: ambas convertem para **percentual 0–100** antes de
devolver `rows` (via `_frac_to_pct`) — mesma escala de `projections.pct_projetado*`
(coluna `NUMERIC(8,5)`, comporta até 999.99999) e do payload Edge Config
(`EdgeCandidate.pct_projetado*`, ver abaixo). `estimates_by_uf` /
`national_estimates` (os arrays do bootstrap, reusados por
`aggregate_national_estimates`, `compute_p_passa_2t`, `compute_p_fecha_1t`,
`compute_two_round_scenarios`) permanecem em fração — só `rows` cruza a
fronteira.

`api/model/replay_batch.py` (usado por `scripts/replay-2022.ts`, gate OT-4)
converte de volta para fração na serialização de stdout — o contrato com o
dataset de replay (`ground_truth`) e o threshold `< 0.02` sempre foram em
fração, e continuam sendo.

Linhas pré-simulado (2026-09-14 e antes) em `projections.pct_projetado*`
podem estar em fração (bug corrigido em S07) — não comparar diretamente
com linhas novas sem normalizar a escala.

`pct_apurado` (tabela `snapshots`, `historical_results.pct_total`, campo
`pct_apurado` de `rows`/payload) sempre foi 0–100 — não sofre essa
conversão em nenhum ponto do pipeline.

`projections.pct_atual` (0009) fica do lado **percentual** da mesma fronteira:
chega já convertido, na mesma linha de `rows` que alimenta
`insert_projections`, `build_uf_payloads` e `build_edge_payload`. Daí ele sair
`NUMERIC(8,5)`, espelhando `pct_projetado`, e não `NUMERIC(5,2)` como
`pct_apurado`.

## Payload do Edge Config

Chave `projection:current` — JSON único de ~30KB:

```ts
type EdgePayload = {
  ts: string;                       // ISO8601
  cargo: 1 | 3;                     // Presidente ou Governador (1 cargo por payload)
  turno: 1 | 2;
  pct_apurado_total: number;        // 0–100
  ufs_apuradas: number;             // 0–27
  national: {
    candidatos: Array<{
      id: number;
      nome: string;
      partido: string;
      cor: string;
      votos_atuais: number;
      votos_projetados: number;
      pct_atual: number;
      pct_projetado: number;
      pct_projetado_lower: number;
      pct_projetado_upper: number;
      p_vitoria: number;
    }>;
    needle_position: number;        // -1 a 1
    needle_band: 'very_likely_a' | 'likely_a' | 'lean_a' | 'tossup' | 'lean_b' | 'likely_b' | 'very_likely_b';
  };
  por_uf: Array<{
    sigla: string;
    pct_apurado: number;
    lider: number;                  // candidato_id
    margem_atual: number;           // pp
    margem_projetada: number;
    margem_projetada_ci: [number, number];
    chamada: boolean;
    swing_vs_2022: number;          // pp
  }>;
  insights: string[];               // 1-3 frases por template
  composition: {                    // "What's powering the forecast"
    pre_election: number;           // 0–1, soma = 1
    model: number;
    actual_results: number;
  };
};
```

Payload `por_uf` para drill-down (chave `projection-uf-<SIGLA>-<cargo>-t<turno>`):
o **resumo** da UF — candidatos, agulha, bucket, mesorregiões, participação.
Poucos KB. Desde o ADR-0032 ele **não** carrega mais `municipios` nem
`series_temporais`: os dois vivem no Vercel Blob, descritos em «Detalhe por UF
no Vercel Blob» abaixo.

### Limite de tamanho — é do STORE, não da requisição

> **Correção 2026-09-08.** Esta seção antes não existia, e o número que
> circulava no código (`lib/edge-config/writer.ts`) era **512 KB por
> requisição**. As duas coisas estavam erradas: o limite é o dobro disso, e é
> aplicado ao store inteiro. Escrevemos 2 + 2N chaves por ciclo; validar cada
> uma isoladamente nunca detectaria o estouro do conjunto.

Fonte: Vercel, [Global Config Limits](https://vercel.com/docs/global-config/global-config-limits)
(atualizada em 2026-07-29). O produto foi renomeado de **Edge Config** para
**Global Config**; o pacote npm segue sendo `@vercel/edge-config`, e as
variáveis de ambiente (`EDGE_CONFIG`, `EDGE_CONFIG_ID`, `EDGE_CONFIG_TOKEN`) e
os nomes de chave deste documento não mudam.

| Fato | Valor |
|---|---|
| Tamanho máximo do store | **1 MB** — igual em Hobby, Pro e Enterprise (não há upgrade que compre folga) |
| Escopo do limite | *"the total size limit of each store, including all keys and values"* — **o store inteiro**, somando todas as chaves |
| Stores por projeto | 3 (Pro) |
| Modo de falha | *"Updates to items will be rejected if the resulting size would exceed your plan's limits"* — a escrita é **recusada**, não truncada |
| Propagação | até 10s globalmente |

O modo de falha é o que importa operacionalmente: passando de 1 MB, o `PATCH`
é recusado e a projeção **congela no último payload que coube** — na noite da
apuração, isso é a página parar de atualizar sem nenhum erro visível ao
usuário.

**Volume medido (2026-09-08).** 5.572 municípios em 27 UFs, a ~206 B por
município (medido sobre o payload real de MG):

| Conteúdo | Bytes |
|---|---|
| Arrays de municípios, 1 cargo | ~1.148.000 (**1,10 MiB**) |
| Arrays de municípios, Presidente + Governador | ~2.296.000 (**2,19 MiB**) |
| Limite do store | 1.000.000 |

Ou seja: **com o detalhe municipal dentro do Global Config, o store já não
cabe.** A saída, formalizada no [ADR-0032](adrs/0032-detalhe-municipal-vercel-blob.md)
e implementada em `lib/blob/`, é mover o detalhe para o Vercel Blob — ver a
seção seguinte.

**Instrumentação.** `lib/edge-config/writer.ts` mede o store antes de cada
escrita (`GET /v1/edge-config/<id>` → `sizeInBytes`, metadados apenas, sem
baixar conteúdo) e avisa com limiar operacional abaixo do limite oficial:
warn em **780.000 B (78%)**, error em **940.000 B (94%)**. A folga de 220 KB
do primeiro limiar cobre ~7 ciclos de 60s no pico de crescimento medido
(~30 KB/ciclo), que é a janela para alguém ler o log e apagar uma chave. A
guarda **nunca aborta a gravação**: se a medição falhar, a ingestão segue.

O bloco acima é o esqueleto histórico (S04). O shape completo e vigente — com
`rank`, `p_passa_2t`, `p_fecha_1t`, `participacao`, `mesorregioes` e o bloco de
segunda base descrito abaixo — vive em `lib/edge-config/types.ts`, que **deriva
deste markdown**: alterou o shape, atualize aqui primeiro.

### Detalhe por UF no Vercel Blob (ADR-0032)

Dois campos saíram do envelope de Global Config e passaram a ser um objeto
próprio no Vercel Blob, um por UF/cargo/turno:

```
municipios/uf/<SIGLA>/<cargo>/t<turno>.json     municipios/uf/SP/pres/t1.json
```

```ts
type UfDetailBlob = {
  ts: string;                       // ISO8601 — PRÓPRIO, ver abaixo
  uf: string;                       // "SP" — redundante com o caminho, de propósito
  cargo: 'pres' | 'gov';
  turno: 1 | 2;
  municipios: EdgeUfMunicipio[];    // saiu de EdgePayloadUf.municipios
  series_temporais: EdgeUfSeriesTemporais | null;  // saiu de EdgePayloadUf.series_temporais
};
```

Contrato canônico em `lib/blob/uf-detail.ts`; o esquema de caminho e a
construção de URL vivem em `lib/blob/paths.ts`, compartilhados com o
drill-down de Deputado Federal do [ADR-0026](adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md)
(`deputado/uf/<SIGLA>.json`).

| Fato | Valor |
|---|---|
| Separador de segmento | `/` — dois-pontos produz URL percent-encoded no Blob, e o read path monta a URL a partir do pathname, sem lookup |
| Escrita | `put()` com `allowOverwrite: true`, `addRandomSuffix: false` → URL determinística |
| `cacheControlMaxAge` | **60 s** — o mínimo do Blob e a cadência do ADR-0011. O default do SDK é **um mês**, que congelaria o detalhe no CDN |
| Leitura | `fetch` no servidor com `next: { revalidate: 60 }`, **em paralelo** com `readUfProjection()` |
| Objetos por ciclo | até 27 UFs × 2 cargos = 54 `put()` |
| Tamanho medido (SP, pior caso) | **248.473 B** com os 645 municípios reais, 11 candidatos por município e 3 séries de 480 pontos |

**Por que `ts` é próprio.** As duas escritas (Global Config e Blob) não são
atômicas entre si, e o CDN pode servir uma versão anterior além do
`revalidate`. O detalhe municipal pode ficar visivelmente mais velho que o
resumo, e a UI **não deve silenciar** essa diferença — `<DetailFreshness>`
exibe a idade do detalhe e a defasagem contra o resumo.

**Degradação.** `readUfDetail` nunca lança e nunca devolve `null` cru: devolve
o motivo (`not_configured` | `not_found` | `fetch_error` | `invalid`). As
seções de detalhe renderizam `<DetailUnavailable>` — explícito e **sempre no
DOM** ([ADR-0017](adrs/0017-transparencia-total-3-camadas.md)) — nunca somem
nem ficam vazias em silêncio. Global Config e Blob falham independentemente.

### Série por candidatura (spec 020 / ADR-0046)

O gráfico de evolução da noite precisa de uma série temporal **por
candidatura**, que `EdgeUfSeriesTemporais` não tinha: `margem`, `p_vitoria` e
`turnout` são três séries sobre a corrida inteira, não uma por candidato. Os
dois tipos novos vivem em `lib/edge-config/types.ts`:

```ts
/** Forma COLUNAR: um eixo compartilhado + arrays paralelos por candidatura. */
type EdgeSeriePorCandidato = {
  eixo: string[];                   // `dado_ts` ISO8601, ASC — hora do BOLETIM
  cadencia_min: number;             // declarada pelo produtor, nunca inferida do eixo
  candidatos: EdgeSerieCandidato[]; // ORDEM DE EXIBIÇÃO — contrato, não se re-ordena
};

type EdgeSerieCandidato = {
  id: number;                       // = EdgeCandidate.id
  nome: string;
  partido: string;                  // a COR sai daqui (textForParty), nunca de `cor`
  sqcand?: string;
  apurado: (number | null)[];       // fatia da candidatura, 0–100, alinhada ao eixo
  projetado: (number | null)[];     // idem
};
```

**Três invariantes que a forma carrega:**

1. **`eixo.length === apurado.length === projetado.length`** para todo
   candidato — é o que torna a forma colunar legível: o valor de índice `i` de
   qualquer candidato pertence ao instante `eixo[i]`.
2. **`null` é balde sem ciclo, nunca `0`.** É a regra dos três estados aplicada
   a um ponto: "não medimos neste balde" e "mediu-se zero por cento" são fatos
   diferentes, e colapsá-los num `?? 0` desenha um mergulho ao chão que nunca
   aconteceu. O consumidor quebra o traçado em dois no furo — nunca interpola,
   nunca zera. Daí as colunas serem `(number | null)[]`.
3. **`apurado` é fatia da candidatura**, não `pct_apurado` — mesma armadilha da
   seção «`pct_apurado` ≠ `pct_atual`» acima, agora no transporte.

**O eixo só tem instantes com hora do TSE** ([ADR-0047](adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md)
D2, 2026-09-18): linha de `projections` com `dado_ts` NULL não entra na série, e
o ciclo cujo `relogio_do_dado` devolve `None` não anexa ponto. Não há `COALESCE`
para `projections.ts`, que é o relógio de **cálculo** — com ele, a linha da
projeção marchava para a direita sobre ciclos em que nenhum boletim chegou.
Consequência aceita: as 13.180 linhas anteriores à migration 0009 (nenhuma com
`pct_atual`) ficam fora do eixo.

**A cor da linha é `textForParty(partido)`** (ADR-0047 D1), a variante legível do
mesmo token — a base é cor de área e reprova o piso de 3:1 do WCAG 2.1 SC 1.4.11
em quatro partidos no tema claro. A fonte continua sendo a **sigla**, nunca o
campo `cor` (ADR-0046 D5, ADR-0024).

**Por que colunar.** A chave `"ts"` repetida uma vez por PONTO em vez de uma vez
por SÉRIE é o custo inteiro da forma rejeitada:

| Forma | Escopo UF (pior caso) | Escopo nacional |
|---|---|---|
| Array de objetos `{ts,pct}` | 160.460 B | 32.356 B |
| **Colunar** (adotada) | 33.249 B | **6.905 B** |

**Teto por construção.** `SERIE_MAX_PONTOS = 120` ([ADR-0046](adrs/0046-serie-por-candidato-limitada-por-construcao.md)
D2): a cadência é o menor valor de `[5, 10, 15, 30]` minutos tal que
`ceil(janela_min / cadência) ≤ 120`. O teto **re-bucketiza**, nunca corta o
começo da noite. Cada balde é o ponto de **maior `dado_ts`** dentro dele — o
último, nunca a média, que suavizaria descontinuidades e poderia fazer uma
quantidade quase-monotônica regredir. O balde deriva do **epoch de `dado_ts`**,
não do índice do array: um ciclo perdido não desloca os pontos publicados antes
dele (constituição § 6). Consequência: **o máximo absoluto é de 120 pontos por
corrida**, e é esse o teto — não um número de bytes. Medida no emissor real, a
grade cheia custa entre 8.822 e 9.066 B, variando com o comprimento do nome de
urna (dado do TSE). Este parágrafo dizia "8.553 B, para sempre"; ver a emenda de
2026-09-17 no [ADR-0046](./adrs/0046-serie-por-candidato-limitada-por-construcao.md).

**Onde cada escopo mora (ADR-0046 D3 — emenda o ADR-0032, não o supersede):**

| Escopo | Campo | Destino | Por quê |
|---|---|---|---|
| Nacional | `EdgePayload.serie_por_candidato?` | chave de Global Config **já existente** | 17.301 B + 6.905 B = ~24.206 B, contra teto de aviso de 75 KB por chave nacional (`EDGE_CONFIG_NATIONAL_WARN_BYTES`) — folga de 3× |
| UF | `EdgeUfSeriesTemporais.por_candidato?` | Vercel Blob (objeto do ADR-0032) | 27 UF × 3 cargos × 6.905 B = **559.305 B** |

⚠️ **`EdgePayloadUf` não ganhou campo nenhum** — e a conta acima é o motivo. Os
559.305 B levariam o store de ~410 KB a **~969 KB**: acima do limiar de erro de
940.000 B do writer e a 31 KB do teto de 1 MB, com a escrita **recusada na noite
de 04/10**. Nada precisou mudar em `splitUfPayload` (`lib/blob/uf-detail.ts`)
para a série de UF viajar: o destructuring já leva o objeto de séries **inteiro**
ao Blob, com o campo novo dentro.

Os dois campos são **opcionais**. Payloads e blobs gravados antes da spec 020
seguem válidos, e a fase pré-eleição não tem série para emitir — ausente ≡ "o
produtor não emitiu", que a tela trata como estado próprio (`sem_serie`),
distinto de "a fonte não respondeu".

**A cor da linha sai de `partido`, nunca de `EdgeCandidate.cor`** (ADR-0046 D5).
`cor` ainda publica `var(--color-cand-{rank})`, a cor por rank que o
[ADR-0024](adrs/0024-paleta-editorial-por-partido.md) aposentou; consumi-la aqui
reintroduziria o defeito no único componente do produto onde ele seria visível
como **movimento** — a linha trocaria de cor ao vivo, no instante exato de uma
ultrapassagem.

### Duas bases por candidato (S07/Fase 2 — extrapolação do apurado)

A projeção de candidatos passa a ser **extrapolação do apurado por zona**
(regra de três: `k(z) = te/esi`, `V_c(z) = vap_c · k`), não mais swing vs. 2022.
Como a mesma contagem projetada de votos pode ser lida sobre dois
denominadores diferentes, o payload publica **as duas bases** e a UI escolhe
qual exibir — o numerador é idêntico, só o denominador muda.

| Base | Denominador (EA20) | Rótulo na UI | Onde |
|---|---|---|---|
| `votaveis` (default) | `v.vvc` — votos a **votáveis** concorrentes (válidos + anulados + sub judice; é o denominador do `pvap` do TSE) | "% dos votos a votáveis" | campos `pct_atual` / `pct_projetado` / `pct_projetado_lower` / `pct_projetado_upper` (nacional) e `ci95` (UF) |
| `comparecimento` | `e.c` — quem compareceu | "% do comparecimento" | bloco opcional `comparecimento` |

**Nunca chamar `vvc` de "válidos"** — o dicionário oficial de leiautes
(`docs/reference/tse-2026-leiautes.md`) reserva "válidos" para `v.vv`. O rótulo
canônico é "votáveis".

```ts
/** Segunda base de uma métrica de candidato: % sobre quem compareceu (e.c). */
type EdgeBaseComparecimento = {
  pct_atual: number | null;   // 0–100; null = ainda sem zona apurada
  pct_projetado: number;      // 0–100
  lower: number;              // CI95 inferior, 0–100
  upper: number;              // CI95 superior, 0–100
};

// EdgeCandidate      (nacional)                → comparecimento?: EdgeBaseComparecimento
// EdgeUfCandidate    (drill-down de UF)        → comparecimento?: EdgeBaseComparecimento
// EdgeParticipacao.outros                      → comparecimento?: EdgeBaseComparecimento
```

O campo é **opcional em todos os três pontos**: payloads pré-S07/Fase 2 e os
três fixtures de `tests/fixtures/edge-config/` continuam válidos. Quando a UI
está na base `comparecimento` e o campo não veio, o termômetro correspondente
renderiza em **"aguardando projeção"** (ADR-0017 — permanece no DOM) e **nunca**
cai de volta na base `votaveis`: exibir um número de outro denominador sob o
rótulo errado seria pior do que não exibir número nenhum.

**Identidade da base `comparecimento`.** O EA20 fecha
`Σvap + vb + tvn + van + vansj + vscv = c`, logo:

> candidatos + Outros + brancos + nulos = 100% de quem compareceu **menos**
> anulados e sub judice.

O resíduo (`van`, `vansj`, `vscv`) é pequeno mas não é zero — a legenda da UI
declara isso explicitamente em vez de arredondar para "somam 100". A abstenção
**não** entra nessa soma: ela tem base própria (`eleitores_instalados`).

### `participacao.metodo` — origem do número (RF-062)

```ts
metodo?: {
  tipo: "extrapolacao_apurado" | "imputado_nacional";
  n_zonas: number;              // zonas que entraram no estimador
  pct_apurado: number;          // 0–100
  n_zonas_imputadas?: number;   // zonas sem urna, imputadas pela proporção da UF
};
```

- `"extrapolacao_apurado"` — caminho normal: há pelo menos uma zona apurada na
  UF (ou no país) e a projeção é extrapolada do que já foi apurado.
- `"imputado_nacional"` — **nenhuma** zona da UF apurou ainda; a projeção usa a
  proporção nacional como âncora provisória, com IC alargado (RF-017). Só existe
  para cargo 1 (presidente): governador não tem agregado nacional equivalente,
  então a UF fica em "aguardando projeção".

`tipo` era `string` livre até S07/Fase 2 — passa a união fechada porque a UI
ramifica o rótulo por valor. `n_zonas_imputadas` é opcional: ausente ≡ 0.

### Campos em transição

- **`EdgeUfRow.votos_disputa_projetados?: number`** — emitido a partir de S09/ADR-0057, cargos 1 (Presidente), 3 (Governador) e 5 (Senador). Total de votos em disputa projetado para a UF (válidos + sub judice, anulado fora — mesma base que já alimenta `top_candidatos[].pct`); usado exclusivamente no cálculo de consolidado regional de votos. **Ausência do campo (payload anterior a 2026-09-28) faz a Projeção regional mostrar "—", nunca uma estimativa** — princípio de ADR-0051 ("não sabemos" ≠ "zero") aplicado a dados ausentes. Opcional.
- **`EdgeUfRow.swing_vs_2022: number | null`** — o tipo aceita `null` desde
  S07/Fase 2 (consumidores devem exibir "—"), mas o orchestrator ainda emite
  `0.0` fixo. Vira o **swing descritivo** (E1: apurado de agora − 2022, um fato
  observado, não insumo da projeção) na Fase 5, quando passa a ser `null` para
  UF/candidato sem número em 2022.
- **`EdgePayloadUf.model_fallback_tier`** — `@deprecated`. O K-1 3-tier
  (ADR-0015) dependia de 2022 como âncora e sai junto com o swing; a coluna
  `projections.model_fallback_tier` permanece no schema (sem migration) e o
  campo segue no tipo apenas para não quebrar payloads gravados. Novos
  consumidores não devem lê-lo.

## Operação e manutenção do banco

### Quem pode ESCREVER no banco a partir de um teste (2026-09-17)

Cinco testes de integração inserem linhas reais em `projections`, `snapshots`,
`eleitorado` e `historical_results`. O único freio era a **ausência** de
`DATABASE_URL` — e ausência é um estado que se perde por acidente: quem
carregasse o `.env.local` para qualquer outra coisa (conferir uma migration,
por exemplo) e rodasse `vitest run` passava a escrever **no banco de produção**,
o mesmo que vai guardar a apuração de 04/10/2026.

Foi o que aconteceu. **1.877 linhas de harness** ficaram no banco de produção:
**1.233** sob cargos que não existem (91, 92, 93) e **644 sob o cargo REAL 1**,
com as candidaturas sintéticas 101 e 102 ao lado das candidaturas de verdade.
As linhas foram removidas.

Duas causas, as duas fechadas:

| Causa | Correção |
|---|---|
| A guarda era a ausência de uma variável | `tests/integration/_guarda-banco.ts` — a escrita exige `ALLOW_DB_WRITE_TESTS=1` **declarado** (igualdade exata com `"1"`); a dúvida resolve para "não escreve" |
| O cleanup filtrava `uf IN (…)`, e `IN` **nunca casa com `NULL`** | filtro passa a ser `(uf IS NULL OR uf IN (…))` |

O furo de SQL é o que explica o resíduo ter crescido por meses sem ninguém
notar: as linhas de escopo **nacional** (`uf IS NULL`) são justamente as que o
modelo cria em todo ciclo, e o teste limpava o que via e deixava o que não via.

Detectar "é produção" pelo host seria adivinhação, e adivinhação com default
permissivo é a rede de mão única que este repositório já pagou caro — uma URL
nova, um host de preview, um proxy, e o teste volta a escrever achando que está
seguro. Consentimento explícito não tem esse modo de falha.

## Princípios

- **Snapshots são append-only** (princípio § 10 da constituição) — habilita replay e auditoria.
- **Postgres não está no read path do cliente** — Edge Config é o único leitor durante apuração.
- **Hash SHA256 do payload** permite dedup rápida vs ETag do TSE.

## Cross-refs

- Constituição § 7 (resiliência) e § 10 (append-only): [../constitution.md](../constitution.md)
- ADR-0001 Edge Config no read path: [./adrs/0001-edge-config-no-read-path.md](./adrs/0001-edge-config-no-read-path.md)
- ADR-0008 Não Convex: [./adrs/0008-nao-convex.md](./adrs/0008-nao-convex.md)
- ADR-0032 Detalhe municipal no Vercel Blob: [./adrs/0032-detalhe-municipal-vercel-blob.md](./adrs/0032-detalhe-municipal-vercel-blob.md)
- ADR-0038 `dado_ts` é a hora do dado, não a do cálculo: [./adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md](./adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)
- ADR-0046 Série por candidato limitada por construção: [./adrs/0046-serie-por-candidato-limitada-por-construcao.md](./adrs/0046-serie-por-candidato-limitada-por-construcao.md)
- Specs que consomem: [001-ingestao-tse](../specs/001-ingestao-tse/), [002-modelo-estatistico](../specs/002-modelo-estatistico/), [020-evolucao-da-apuracao](../specs/020-evolucao-da-apuracao/)
