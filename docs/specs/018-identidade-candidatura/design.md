---
id: 018-identidade-candidatura
type: design
title: Design — onde a identidade mora, como o nome chega ao payload e o que a tela pode fazer
status: draft
date: 2026-09-13
spec: ./spec.md
adrs: [0039, 0040, 0041, 0042]
requirements: [RF-140, RF-141, RF-142, RF-143, RF-144, RF-145, RF-146, RF-147, RF-148, RF-149, RF-150, RF-151, RF-152]
---

# Design 018 — identidade de candidatura

> Escrito em 2026-09-13, **antes** de qualquer implementação, para ser o
> contrato entre o importador (`data-pipeline/`), o lado Python
> (`api/model/project.py`) e o lado TypeScript (`lib/blob/`, `lib/edge-config/`,
> `app/`). Os quatro ADRs (0039–0042) decidem; este documento diz **onde** e
> **com que forma**.
>
> Nenhuma linha de código desta spec existe hoje. Todos os caminhos abaixo são
> *previstos*; os caminhos de código já existentes estão marcados como tal.

## D1 — Onde os dados moram: Postgres para resolver, Blob para publicar, nunca Edge Config

Três armazenamentos, com papéis que não se misturam:

| Camada | O que guarda | Por quê |
|---|---|---|
| **Postgres** (`candidatos`) | as 20.939 linhas unidas, com publicabilidade e situação | é onde a **função de resolução** do RF-143 roda, e onde o diff entre importações é calculado (RF-152). Fora do read path do cliente ([ADR-0001](../../architecture/adrs/0001-edge-config-no-read-path.md)). |
| **Vercel Blob** | fatias JSON publicáveis + as fotos JPEG | é o read path. Precedente direto: [ADR-0032](../../architecture/adrs/0032-detalhe-municipal-vercel-blob.md) e [ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) item 4. |
| **Edge Config** | **nada desta spec**, exceto os três campos novos de `top_candidatos` | o store inteiro tem **1 MB** e já é dividido por quatro cargos (ADR-0032). 7.698 candidaturas com nome e partido passam disso sozinhas. |

O único dado desta spec que entra no Edge Config é o enriquecimento de
`top_candidatos` (D3), que é de **no máximo 3 itens por UF** — e mesmo esse
acréscimo precisa ser medido contra o guard de store antes de ir ao ar
(spec § open question 5).

### Caminhos no Blob

> ⚠️ **Verificado no disco em 13/09, já implementado** (`lib/blob/paths.ts`, em
> working tree, por trabalho paralelo em curso). Os três construtores e o
> parâmetro de extensão **existem**; este bloco descreve o que está lá, não uma
> proposta.

```
candidatos/uf/<SIGLA>/<cargo>.json      candidatos/uf/SP/dep.json
candidatos/index.json                   o que foi publicado e quando
candidatos/foto/<SIGLA>/<sqcand>.jpg    candidatos/foto/SP/250002553928.jpg
```

- `<SIGLA>` é a sigla de duas letras, validada por `UF_SIGLA_PATTERN`.
  **Presidente usa `BR`** — é o que o CSV traz em `SG_UF` para candidatura
  presidencial, e passa no padrão de duas letras sem caso especial.
- `<cargo>` é o **token** de `lib/config/calendar.ts` (`pres` · `gov` · `sen` ·
  `dep`), o mesmo que namespeia as chaves do Global Config (ADR-0012), **não** o
  código numérico do TSE. O código numérico continua sendo o que viaja **dentro**
  do JSON (D2), como em todo payload do produto — os dois tipos `Cargo` seguem
  separados de propósito (`lib/config/cargos.ts`, cabeçalho).
- Sem turno no caminho: quem se candidatou não muda entre 1º e 2º turno.
- `candidatos/index.json` existe para que o consumidor saiba o que foi publicado
  sem sondar 27 × 4 caminhos: um 404 numa fatia é ambíguo entre "esta UF não tem
  este cargo" e "o importador não rodou", e a diferença importa para o leitor
  (constituição § 8).

```ts
// lib/blob/paths.ts — implementado
export function candidatosUfBlobPathname(sigla: string, cargo: Cargo): string;
export function candidatosIndexBlobPathname(): string;
export function candidatoFotoBlobPathname(sigla: string, sqCandidato: string): string;
```

`sqCandidato` é **`string`**, não `number`: 11 ou 12 dígitos, `bigint` no banco, e
converter no meio do caminho convidaria uma perda de precisão que só apareceria
como foto do candidato errado.

### Duas extensões ao módulo de Blob (ADR-0041)

`lib/blob/write.ts` é JSON-only **por construção**: `putJson` fixa
`contentType: "application/json"` e `cacheControlMaxAge = 60`.

```ts
// lib/blob/paths.ts — ✅ IMPLEMENTADO (13/09)
export function blobPathname(
  segments: readonly string[],
  context: string,
  extension: string = ".json",   // validada por /^\.[a-z0-9]+$/; LANÇA sem o ponto
): string;

// lib/blob/write.ts — ⬜ A FAZER
export const BLOB_IMMUTABLE_MAX_AGE_SECONDS = 31_536_000; // 1 ano

export async function putBinary(
  pathname: string,
  body: Buffer | Uint8Array,
  opts: { contentType: string; cacheControlMaxAge?: number },
): Promise<BlobWriteResult>;
```

O default `".json"` preservou os três chamadores anteriores byte a byte —
nenhum precisou mudar. `cacheControlMaxAge` é obrigatório do caller para
binário — sem default herdado de 60 s, para que uma foto imutável não pegue por
acidente um cache pensado para dado que muda a cada minuto.

**Um módulo, não dois.** O ADR-0032 é literal — "a implementação que materializa
este ADR e a que materializa o ADR-0026 devem compartilhar o mesmo módulo de
escrita/leitura Blob — não é opcional" — e o ADR-0041 reaplica isso a um terceiro
recurso e a um segundo content-type. Um `lib/blob/write-binary.ts` duplicaria a
lógica de no-op sem credencial, de `allowOverwrite`/`addRandomSuffix` e de log
estruturado.

## D2 — Contrato: a fatia publicável (`candidatos/uf/<SIGLA>/<cargo>.json`)

> ✅ **Divergência RECONCILIADA em 13/09.** Este design e `lib/blob/candidatos.ts`
> nasceram em paralelo com contratos próximos e não idênticos. Julgamento campo
> a campo, e **nenhum dos dois lados ganhou inteiro**:
>
> | Delta | Decisão | Por quê |
> |---|---|---|
> | `candidaturas[]` vs `candidatos[]` | **`candidatos[]`** (código) | Coerência com a tabela `candidatos` e com o caminho `candidatos/uf/…`. Três nomes para a mesma coisa é como se erra. |
> | `ts` vs `gerado_ts` | **`gerado_ts`** (código) | `ts` já significa "hora em que o modelo rodou" em todo o payload desde o ADR-0038. Reusar o nome aqui fundiria dois relógios. |
> | `numero: string` vs `number` | **`number`** (código) | O argumento do design era preservar zero à esquerda. Medido: **zero ocorrências** em 8.323 números (2 a 4 dígitos). O join também não sofre — `projections.candidato_id` é `integer` e `EdgeCandidate.id` é `number`; o lado string é o EA20 cru, que o Python já converte com `int(c.get("n"))`. Assimetria deliberada com `sqcand: string`, que é string porque tem 11 OU 12 dígitos e ordenar como texto erra. |
> | falta `nome` | **acrescentado** (design) | RF-148 casa nome de urna **e** nome completo; sem ele a busca fica cega para "Luiz Inácio" → "LULA". ~28 KB na maior fatia. |
> | falta `federacao` | **acrescentado** (design) | Texto do card. Não vira cor — sigla composta cai em `outros` (ADR-0024). |
> | falta `sob_ressalva` | **acrescentado** (design) | Calculado na publicação, nunca no componente: o ADR-0040 proíbe filtrar pela situação e manda exibi-la, e 743 candidaturas estão na urna sob recurso. Regra editorial dessa delicadeza mora num lugar só. |
> | falta `foto_url` | **nem um nem outro: `foto_ok: boolean`** | A URL é derivável de `blobUrlFor(candidatoFotoBlobPathname(uf, sqcand))` — guardá-la duplica ~90 B por candidatura. O que **não** é derivável é se a foto existe. |

```ts
interface CandidatosUfSlice {
  uf: string;                     // sigla; "BR" para cargo 1
  /** Cargo como TOKEN: "pres" | "gov" | "sen" | "dep" (não código numérico). */
  cargo: Cargo;
  /**
   * RF-150 — frescor da FONTE, do header `Last-Modified` da resposta HTTP do
   * arquivo do TSE. **Nunca** o `last_modified` do catálogo CKAN (22/07 e
   * 03/08, metadado morto — ADR-0039, armadilha 1).
   *
   * Primo do `dado_ts` do ADR-0038 e pela mesma razão: a hora do dado, não a
   * hora do cálculo. São relógios distintos e a tela não pode fundi-los.
   */
  fonte_ts: string;
  /**
   * ISO 8601 — quando ESTE arquivo foi gerado. Separado de `fonte_ts` de propósito:
   * a tela precisa poder dizer "dado do TSE de X, importado por nós em Y" sem
   * fundir as duas datas (constituição § 8).
   */
  gerado_ts: string;
  /** Publicáveis nesta fatia. Só quem tem `ST_CANDIDATO_INSERIDO_URNA = "SIM"`. */
  candidatos: CandidatoIdentidade[];
}

interface CandidatoIdentidade {
  /** `SQ_CANDIDATO`, 11 ou 12 dígitos. `bigint` no Postgres, **string** aqui. */
  sqcand: string;
  /** `NR_CANDIDATO` — o número na urna. `number`: 2 a 4 dígitos, zero ocorrências com zero à esquerda em 8.323 medidas. */
  numero: number;
  /** `NM_URNA_CANDIDATO` — máx. 30 chars, nunca vazio (0 em 20.939). É o que a tela mostra. */
  nome_urna: string;
  /** `NM_CANDIDATO` — nome completo. Alimenta a busca (RF-148), não o card. */
  nome: string;
  /** Sigla do partido. Entra em `partyChipInk`, nunca em `colorForParty` como área (D7). */
  partido: string;
  /** Nome da federação quando houver; `null` em partido isolado. Não vira cor — sigla composta cai em `outros` (ADR-0024). */
  federacao?: string;
  /**
   * `DS_SITUACAO_JULGAMENTO` **cru**, como o TSE publica.
   *
   * RF-141: é TEXTO ao lado do candidato, NUNCA um segundo filtro. 743
   * candidaturas na urna trazem "INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO"
   * e recebem voto real. Não normalizar para enum: um conversor de enum com
   * `default` silencioso é exatamente o defeito que já mordeu este repositório
   * — valor desconhecido do TSE passa adiante como veio.
   */
  situacao_julgamento: string;
  /**
   * `true` quando `situacao_julgamento` NÃO é **exatamente igual** a `"DEFERIDO"`.
   * Inclui "INDEFERIDO", "DEFERIDO EM PRAZO RECURSAL OU COM RECURSO" (84 candidaturas),
   * e outros estados de julgamento não-triviais. Valor desconhecido é `true` (fail-closed,
   * ADR-0040 item 3). É **calculado na publicação, nunca no componente** — essa é a decisão:
   * o ADR-0040 proíbe usar a situação como filtro e manda exibi-la como texto honesto, e uma
   * regra editorial dessa delicadeza não pode viver espalhada em `if`s de JSX.
   */
  sob_ressalva: boolean;
  /** `true` se foto publicada para este `sqcand` existe. Não guardamos a URL — é derivável. */
  foto_ok: boolean;
}
```

**Não há** neste contrato — e a asserção é negativa, testada por serialização
(RF-140): `cpf`, `email`, `titulo_eleitoral`, `data_nascimento`, `ocupacao`,
`bens`, `patrimonio`.

Ordem: `numero` ascendente. Determinismo (constituição § 6) e neutralidade
(§ 2 — "nomes e siglas aparecem sempre na mesma ordem dentro de uma mesma
corrida"). Ordenar por nome ou por partido introduziria um critério editorial
onde não deve haver nenhum.

Tamanho medido em 13/09: **1.061 candidaturas publicáveis em cargo 6 (Deputado Federal) em SP**,
fatia de **211,6 KB** — a maior entre as 82 fatias do Blob. Razão do tamanho
maior que o estimado: cargo 6 tem mais nomes completos longos do que os demais,
e `nome` (~25 B médio por candidatura) representa ~28 KB da fatia. Cabe no Blob
com folga; não caberia no Global Config.

### O índice (`candidatos/index.json`)

```ts
interface CandidatosIndex {
  /** Hora da nossa publicação. */
  ts: string;
  /** Hora da fonte TSE (Last-Modified do Portal de Dados Abertos). */
  fonte_ts: string;
  /** Σ de candidaturas publicáveis nos quatro cargos. Baseline confirmado em 13/09: **7.698**. */
  total: number;
  /** Por cargo e UF: quantas candidaturas publicáveis. Estrutura: `{ <cargo_token>: { <uf>: <contagem> } }`. */
  por_cargo_uf: {
    pres: { BR: number };
    gov: { [uf: string]: number };
    sen: { [uf: string]: number };
    dep: { [uf: string]: number };
  };
}
```

Exemplo medido em 13/09 (83 objetos publicados: 82 fatias + 1 índice):

```json
{
  "ts": "2026-09-12T22:41:35Z",
  "fonte_ts": "2026-09-12T22:35:46Z",
  "total": 7698,
  "por_cargo_uf": {
    "pres": { "BR": 12 },
    "gov": { "AC": 4, "AL": 8, ... },
    "sen": { "AC": 3, "AL": 2, ... },
    "dep": { "AC": 48, "AL": 123, ... }
  }
}
```

Ele resolve a ambiguidade do 404 e é a **base de comparação** do RF-152: o ciclo
novo confronta seu `total` contra o do índice vigente antes de
escrever qualquer coisa.

### Snapshot confirmado por HTTP 200 (13/09)

Publicação verificada e alcançável: **83 objetos** (82 fatias de UF × cargo + 1 índice),
todos com status 200:

- **pres**: 1 fatia (BR)
- **gov**: 27 fatias (uma por UF)
- **sen**: 27 fatias (uma por UF)
- **dep**: 27 fatias (uma por UF)
- **index.json**: 1

Total publicável nacional: **7.698 candidaturas**. Composição:
- Presidente: 12
- Governadores: 180
- Senadores: 285
- Deputados Federais: 7.221

Dados consolidados no índice `fonte_ts="2026-09-12T22:35:46Z"` (último HTTP 200 do Portal de Dados Abertos do TSE).

### Armadilha de dados: `coligacao_nome` usa valores-sentinela

A coluna `coligacao_nome` do cadastro TSE publica três valores **distintos de nome real**:

| Valor | Registros | Percentual |
|---|---|---|
| `"PARTIDO ISOLADO"` | 5.246 | 68,1% |
| `"FEDERAÇÃO"` | 2.259 | 29,3% |
| Nome de coligação real | 193 | **2,5%** (91 nomes distintos) |

**Risco de apresentação**: publicar o sentinela cru faria 7.505 cards dizerem "Coligação: PARTIDO ISOLADO" — texto falso ao leitor. **Filtro aplicado**: igualdade exata com `"FEDERAÇÃO"` ou `"PARTIDO ISOLADO"`; nenhuma das 91 coligações reais começa com essas palavras-chave, então a regra é segura. O campo `federacao` no contrato já é dedicado à federação; `coligacao` não aparece no publicável (cabe no Postgres mas não na fatia de publicação — ver D1). O texto de coligação (quando aplicável) é transportado pela federação.

## D3 — Emenda ao contrato de `EdgeUfRow.top_candidatos`

Hoje (`lib/edge-config/types.ts:476`):

```ts
top_candidatos: Array<{ id: number; pct: number }>;
```

Passa a ser:

```ts
top_candidatos: Array<{
  id: number;      // número na urna — inalterado
  pct: number;     // 0–100 — inalterado
  /** Resolvido pela cadeia de D4. Ausente = consumidor cai em "Cand {id}". */
  nome?: string;
  /** Sigla. Ausente = consumidor cai no que já faz hoje. */
  partido?: string;
  /** Identidade global e estável; é o que liga esta linha à foto (ADR-0041). */
  sqcand?: string;
}>;
```

**Os três são opcionais de propósito**, e isso não é timidez de tipo: sob
`model_fallback_tier` o payload precisa continuar renderizando com o
placeholder, não com erro. A spec 016 e a spec 017 ficam **emendadas** por isso
— estrutura preservada, campo enriquecido (ADR-0042 item 3).

Os dois consumidores que precisam migrar, e que hoje carregam o defeito que o
ADR-0042 previne:

- `components/blocks/GovernorCard.tsx:130-143` — `new Map(candidatos.map(c => [c.id, c]))`
  e `nome: meta?.nome ?? "Cand ${t.id}"`, cruzando `uf.top_candidatos` contra
  `national.candidatos` por `id` sozinho.
- `app/(sen)/senador/page.tsx:139-146` (`topDaUf`) — mesmo padrão.

## D4 — Onde o nome entra, e a cadeia de resolução

### O ponto exato de entrada

`api/model/project.py` escreve `f"Candidato {id}"` em **dois** lugares, e eles
têm destinos diferentes:

| Site | O que monta | O que muda |
|---|---|---|
| `project.py:2810` | linha de candidato **da UF** | recebe nome real (RF-144) |
| `project.py:3275` | bloco **nacional** (`national.candidatos`) | recebe nome real **só em cargo 1** (RF-145) |

Cargo 3 e 5 mantêm o placeholder no nacional porque ali `national.candidatos` é
a **união de 27 corridas** sob o mesmo espaço de `id` — o próprio
`GovernorCard.tsx` já documenta isso em comentário. Nome ali seria ambíguo por
construção, não apenas impreciso.

### A cadeia, a testar degrau a degrau

```
1. EA20 cand[].nmu   (nome na urna)
2. EA20 cand[].nm    (nome completo)
3. fatia do cadastro por (cargo, uf, numero), resolvida pelo RF-143
4. "Candidato {n}"   (placeholder final — nunca ausência de nome)
```

**O CSV nunca sobrepõe o EA20.** O EA20 é a autoridade na noite da apuração:
quem tem linha de voto é quem aparece em `cand[]` do boletim. O cadastro decide,
no máximo, se essa linha tem nome e foto ou cai no placeholder.

Quatro testes, um por degrau, mais um quinto para a direção contrária: EA20 com
`nmu` **e** cadastro com nome diferente para o mesmo `(cargo, uf, numero)` →
vence o EA20. O teste do caminho feliz sozinho não discrimina.

### A função de resolução (passo 3), e por que não é uma constraint

```
a. só candidaturas publicáveis (ADR-0040)
b. entre elas, prefere DS_SITUACAO_JULGAMENTO começando em "DEFERIDO"
c. desempate final pelo maior sqcand (registro mais recente)
d. na noite da apuração, o EA20 vence a–c, sempre
```

`(cargo, uf, numero)` **não é única nem na fonte oficial**: 52 colisões brutas,
**4** depois do filtro de publicabilidade — todas cargo 6 na Bahia, sob recurso,
dois pares com o **mesmo nome** no mesmo número. Um `UNIQUE INDEX` quebraria em
produção contra dado real. Índice **não-único** + função determinística é o
único desenho que sobrevive, e os 4 casos da Bahia são o fixture pronto do caso
de borda mais importante.

### A função de partido fica como está

`extract_partido_by_cand` (`project.py:1712`) é um dicionário **plano**, chaveado
só pelo número. Está **certo** e não muda: em cargo majoritário o número na urna
É o número do partido — 13 é PT em qualquer UF. A nova função de nome **não pode**
ser escrita como gêmea dela, ou o candidato a governador do PT de São Paulo
aparece nos outros 26 estados. Comentário no código apontando para o ADR-0042,
para que ninguém "uniformize" as duas assinaturas depois.

## D5 — A tela: `/candidatos` e a grade, sem uma linha de JavaScript novo

### Restrição que governa tudo aqui

**RNF-007a está em 148,7 KiB de 150.** Sobram ~1,3 KiB. Qualquer componente
client novo acima da dobra estoura o orçamento que a constituição § 3 fixa e que
`tests/e2e/perf-budget.spec.ts` audita. Consequências diretas, não negociáveis:

- Filtros e busca por **`<form method="get">`** + `searchParams`. Sem `useState`,
  sem `onChange`, sem debounce. `searchParams` já é usado em várias rotas
  (`app/(gov)/governador/page.tsx`, `app/(pres)/uf/[sigla]/page.tsx`, …); o que
  não existe ainda no repositório é **um `<form>` sequer** — este será o
  primeiro.
- Tudo Server Component. `/candidatos` lê o Blob por `fetch` no servidor com
  revalidate, como `readUfDetail` já faz.

### Sem 5ª aba

`components/layout/CargoTabs.tsx` tem quatro abas e o próprio arquivo registra
que "Deputado Federal" já não cabe em 1/4 de 430px (o rótulo visível foi
encurtado para "Deputado", com " Federal" em `sr-only` para preservar o nome
acessível, WCAG 2.5.3). Uma quinta coluna quebraria a barra em todos os
breakpoints.

`/candidatos` é rota de nível superior — `app/candidatos/page.tsx` —, como
`/sobre-o-modelo`. **Não emite `main[data-trilha]`**, então nenhuma aba se marca
como atual: o mecanismo de aba corrente é CSS lendo `main[data-trilha]` com
`:has()` a partir do `<body>`, e a ausência do atributo é exatamente o estado
"nenhuma aba". Entrada pela grade do estado "aguardando" (RF-149) e pelo footer.

### O estado "aguardando": acrescentar, nunca substituir

O parágrafo honesto que já existe **permanece, primeiro, sem reescrita**. A
grade entra **abaixo** dele. Referência verificada:
`app/(dep)/deputado-federal/page.tsx:650` (`AguardandoNacional`, com
`data-testid="dep-aguardando"`) — o texto "Aguardando o primeiro boletim…".

⚠️ As outras três trilhas não têm função equivalente: `(gov)` e `(sen)` montam a
página encadeando `readProjection(...) ?? …` (`app/(gov)/governador/page.tsx:221`,
`app/(sen)/senador/page.tsx:154`). Localizar os três pontos é pré-requisito do
RF-149 (spec § open question 4).

O teste do RF-149 é de **ordem**, não de presença: o parágrafo vem antes da
grade. Um teste que só verifique "o parágrafo existe" passaria com a grade
enfiada por cima dele.

### Componentes

| Componente | Tipo | Papel | Arquivo *previsto* |
|---|---|---|---|
| `<CandidatoAvatar />` | atom | foto 161×225 ou fallback de mesmas dimensões (RF-151) | `components/atoms/media/CandidatoAvatar.tsx` |
| `<CandidatoCard />` | atom | avatar + nome de urna + chip de partido + ressalva de situação | `components/atoms/cards/CandidatoCard.tsx` |
| `<CandidatosGrid />` | block | grade responsiva; alternativa textual para RNF-023 | `components/blocks/CandidatosGrid.tsx` |
| `<CandidatosFiltros />` | block | `<form method="get">` com cargo, UF e busca | `components/blocks/CandidatosFiltros.tsx` |
| `<CandidaturasFonte />` | block | "Fonte: TSE" + `fonte_ts` + aviso de volatilidade (RF-150) | `components/blocks/CandidaturasFonte.tsx` |

Todos RSC. Reusam `<Panel />` (`components/atoms/surfaces/Panel.tsx`) e
`<Footer />`, ambos existentes.

## D6 — Imagens: as primeiras do produto

Não existe hoje **nenhum** `next/image` nem `<img>` em `app/` ou `components/`
(grep, 13/09). Não há precedente interno a copiar, e por isso as cinco decisões
abaixo ficam escritas em vez de implícitas:

1. **`unoptimized`** (ou `<img>` nativo). A Vercel cobra por imagem-fonte
   transformada, e a fonte **já chega** em 161×225 px — exatamente o tamanho de
   render. Otimizar é custo puro por ganho zero. "Otimizar toda imagem externa"
   é o instinto padrão de quem chega depois: registrado aqui e a registrar no
   runbook (ADR-0041 item 4).
2. **`width` e `height` explícitos** — 161×225. Imagem sem dimensão declarada é
   a causa clássica de CLS, e RNF-002 é a métrica de autoridade.
3. **`alt=""` + `aria-hidden="true"`.** O nome do candidato está em texto ao
   lado, dentro do mesmo card. Imagem redundante a texto adjacente é
   **decorativa** (WCAG 1.1.1); repetir o nome no `alt` faz o leitor de tela
   anunciar a mesma pessoa duas vezes. ⚠️ O ADR-0041 registra que nenhuma
   auditoria de `alt` foi feita e presume "nome do candidato" — esta é a decisão
   contrária, tomada aqui com o motivo escrito, e é **gate do
   `a11y-perf-auditor`** antes de `shipped`.
4. **`loading="lazy"`.** A grade tem centenas de cards; carregar tudo acima da
   dobra derrubaria o LCP que o RNF-002 protege.
5. `next.config.ts:13-15` já declara `images.remotePatterns` para
   `*.public.blob.vercel-storage.com` — herdado do ADR-0032 e até hoje sem
   consumidor. **Nenhuma mudança de config é necessária.**

## D7 — Cor: só `partyChipInk`

A identidade partidária no card usa **exclusivamente** `partyChipInk` de
`lib/utils/party-color.ts:236` — o par `background` + `ink`, medido e coberto por
gate (`tests/unit/design-system/party-chip-contrast.test.ts`).

**`colorForParty` como preenchimento de área é proibido nesta spec.** Medido em
12/09 contra `--surface-page`: **PSOL 2,08** e **NOVO 2,72**, contra o piso de
**3:1** da WCAG 1.4.11. O defeito é do gerador da paleta
(`scripts/gen-party-scale.ts` → `app/tokens-party.css`, **gerado** — corrigir à
mão é desfeito na próxima geração) e está **aberto** em
[risks.md](../../reference/risks.md), com prazo antes de 04/10. Uma grade de
7.698 cards seria a maior superfície de exposição desse defeito no produto
inteiro.

O fallback de avatar (RF-151) também não usa a cor-base como área — cinza neutro
do kit, ou iniciais sobre `--surface-card`.

A constituição § 2 continua valendo inteira: cor por **sigla**
([ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md)), nunca
por rank; estável a noite toda; nunca a cor oficial do partido.

## D8 — Prosa e números derivados, nunca literais

Lição D8 da spec 017, que custou quatro frases falsas de uma vez quando a
granularidade do Senador mudou: **nenhum número ou rótulo escrito à mão no JSX.**

- `fonte_ts` sai do payload — o teste injeta um valor e exige que a tela diga
  **aquele**.
- Contagens ("180 candidatos a governador") saem de `candidatos.length`, nunca
  de constante.
- Nome, slug e rótulo de cargo saem de `lib/config/cargos.ts`.
- O texto de situação sai cru do TSE, sem normalização (D2).

E **asserção negativa** nos testes de tela: proibir a frase errada, não só
conferir a certa. Um teste que confere "a tela diz 7.698" passa com o número
hardcoded no JSX.

## D9 — Postgres: tabela `candidatos`, migration 0008

Migrations são **manuais e numeradas** neste repositório (`data-pipeline/migrations/`,
última é `0007_municipio_boa_esperanca_do_norte.ts`); `drizzle-kit push` está
renomeado para `db:push:DANGEROUS` porque regride o banco. A tabela nova entra em
`0008_candidatos.ts` (implementado em 13/09) + entrada em `lib/db/schema.ts`, ao lado de
`eleitorado`, `zonas`, `municipios` e `mesorregioes`.

```
candidatos                              -- nome: plural de candidato, espelhando a fonte TSE
  sq_candidato          bigint PK       -- 11 ou 12 dígitos; string em TS e no payload
  ano                   smallint        -- 2026 (default), para histórico futuro
  cd_eleicao            integer         -- código TSE da eleição (ex. 2026)
  turno                 smallint        -- 1 ou 2 (default 1, presidente tem 2º)
  cargo                 smallint        -- código do TSE (1, 3, 5, 6)
  uf                    char(2)         -- "BR" para cargo 1; UF 2-letra para os demais
  numero                integer         -- NR_CANDIDATO em urna (2–4 dígitos, zero leadings ausentes)
  nome                  text            -- NM_CANDIDATO, nome completo
  nome_urna             text            -- NM_URNA_CANDIDATO, máx 30 chars, nunca vazio
  partido_sigla         varchar(20)     -- sigla do partido registrado no TSE
  partido_numero        smallint        -- número do partido
  partido_nome          text            -- nome do partido
  federacao_sigla       varchar(40)     -- sigla da federação (se houver, NULL em isolado)
  coligacao_nome        text            -- nome da coligação (NULL se ausente)
  situacao_julgamento   text            -- DS_SITUACAO_JULGAMENTO cru (9 valores medidos)
  inserido_urna         boolean         -- ST_CANDIDATO_INSERIDO_URNA = "SIM" → publicável
  substituido           boolean         -- candidato foi substituído por outro
  sq_substituido        bigint          -- SQ_CANDIDATO de quem o substituiu (se houver)
  publicavel            boolean         -- derivado: true ↔ inserido_urna AND situacao dentro de critério (ADR-0040)
  foto_ok               boolean         -- true ↔ foto encontrada, gravada no Blob (RF-142)
  fonte_ts              timestamptz     -- Last-Modified HTTP do arquivo TSE (RF-150, não CKAN metadata)
  importado_ts          timestamptz     -- quando o ciclo de importação gravou esta linha (default now())

  INDEX (cargo, uf)                     -- otimiza leitura por corrida
  INDEX (cargo, uf) WHERE publicavel    -- otimiza leitura de candidaturas publicáveis
  INDEX GIN (to_tsvector(...nome))      -- busca textual para RF-148
  
  NO UNIQUE INDEX sobre (cargo, uf, numero) — Ver D4 e ADR-0042 item 5: há 52 colisões brutas,
  4 sobrevivem ao filtro de publicabilidade, todas na Bahia. Índice não-único + função de
  desempate determinística (data-pipeline/candidatos-resolve.ts) é o único desenho que sobrevive.
```

**Não é append-only.** A constituição § 10 rege `snapshots` — o dado de apuração
—, não tabela de referência; `eleitorado`, `zonas` e `mesorregioes` seguem o mesmo regime de
substituição. O que protege contra perda aqui é a guarda de encolhimento do
RF-152, não o histórico.

Nenhuma coluna de PII. O parser descarta `NR_CPF_CANDIDATO`, `DS_EMAIL` e
`NR_TITULO_ELEITORAL_CANDIDATO` **antes** de qualquer escrita — não depois, não
por projeção de `SELECT`.

**Tabela `partidos`** — tabela de referência 1:N de `partido_numero`, criada
no mesmo migration, com **30 linhas** de dados reais de 2026 — é a chave de lookup
determinístico para `partido_sigla` e `partido_nome`, em caso de ambiguidade no CSV.

## D10 — O importador

`data-pipeline/candidatos-import.ts` (implementado em 13/09), com script `pnpm candidatos:import`.
Roda **fora** do request path, como `eleitorado-import` e `zonas-import` — não é
rota de cron:

- o download combinado é de 4,2 MB de CSV mais ~39 MB de foto; o `maxDuration`
  de uma função Vercel é o limite errado para isso;
- a cadência é humana (diária → 2–3 dias → obrigatória em 02–03/10), não de
  minuto a minuto;
- a guarda de encolhimento precisa de uma decisão de operador para o `--force`.

Usa `TSE_ETL_USER_AGENT` de `data-pipeline/_tse-common.ts:70` — hoje
`"AtlasMenna-ETL/0.1"`, já sem o contato entre parênteses que o WAF da Akamai
bloqueia (spec § open question 2). Não regenerar esse valor localmente: o
módulo é compartilhado com `historical-import`, `eleitorado-import` e
`zonas-import`, e o ADR-0039 nomeia a regressão por acoplamento como risco.

Ordem do ciclo, e ela importa: (1) checar frescor por `Range`; (2) baixar e unir
os dois CSVs; (3) aplicar publicabilidade; (4) **rodar a guarda de encolhimento
contra `candidatos/index.json`**; (5) só então escrever Postgres, fotos, fatias
e — **por último** — o índice, que é o que torna a publicação visível. Escrever antes de conferir transformaria uma importação truncada em
publicação truncada — e o cache de 1 ano da foto tornaria parte disso difícil de
desfazer.

## D11 — Riscos técnicos desta capability

- **Duas fontes de identidade que podem divergir na noite da apuração.** O
  ADR-0039 nomeia o risco: um bug de junção atribui o nome errado ao número
  certo. Nenhum teste dos ADRs protege contra isso; a cadeia de D4 testada
  degrau a degrau é a única rede, e ela precisa incluir o teste da direção
  contrária (cadastro discordando do EA20).
- **O cache de 1 ano é irreversível na prática.** Foto errada publicada fica
  servida até o `--force` do importador rodar e o CDN expirar. Trocar a foto sob
  o mesmo caminho é o único cenário de reescrita real, e o `--force` é peça de
  implementação que nenhum ADR especifica em detalhe.
- **`Last-Modified` é proxy de frescor, não prova de conteúdo novo.** O TSE pode
  regerar o arquivo sem mudança de registro e o header avança assim mesmo.
  `fonte_ts` diz "o TSE tocou o arquivo", não "há candidatura nova". Distinguir
  exigiria hash de conteúdo, fora de escopo.
- **A grade é a maior superfície de cor de partido do produto.** Enquanto o
  defeito de contraste de PSOL/NOVO estiver aberto, `partyChipInk` é a única
  saída segura — e um deslize para `colorForParty` aqui reprova WCAG 1.4.11 em
  milhares de elementos de uma vez.
- **O ensaio de foto cobre uma UF.** 387/387 no Acre; a uniformidade do formato
  do ZIP nas outras 26 é extrapolação, e o ADR-0041 registra isso como não
  confirmado. O importador precisa **contar e reportar** órfãs e faltantes por
  UF, não assumir 1:1.

## Cross-refs

- [Spec 018](./spec.md) — os RFs em EARS e as seis open questions
- [ADR-0039](../../architecture/adrs/0039-portal-dados-abertos-tse-identidade-candidatura.md) · [ADR-0040](../../architecture/adrs/0040-publicabilidade-candidatura-fail-closed.md) · [ADR-0041](../../architecture/adrs/0041-foto-candidato-blob-binario-cache-um-ano.md) · [ADR-0042](../../architecture/adrs/0042-cargo-uf-numero-chave-identidade-candidatura.md)
- [Design 017 § D6/D8](../017-deputado-federal/design.md) — molde do contrato por UF no Blob e a regra de prosa derivada
- `lib/blob/paths.ts`, `lib/blob/write.ts` — os dois módulos a estender
- `lib/blob/uf-detail.ts::readUfDetail` — molde do leitor de fatia
- `lib/utils/party-color.ts:236` (`partyChipInk`) — a única cor permitida no card
- `lib/config/cargos.ts` — tabela canônica dos quatro cargos
