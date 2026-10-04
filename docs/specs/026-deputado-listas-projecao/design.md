---
id: 026-deputado-listas-projecao
type: design
title: Deputado Federal v2 — contrato de dados, trava da projeção, marcas e telas
status: ready
date: 2026-09-29
spec: ./spec.md
# + ADR-0063 (projeção com trava e interruptor), ADR-0064 (destino do voto no proporcional),
#   ADR-0065 (listas em três faixas) — números a preencher pelo orquestrador
adrs: [0001, 0005, 0017, 0021, 0023, 0026, 0027, 0034, 0036, 0038, 0049, 0053]
requirements: [RF-260, RF-261, RF-262, RF-263, RF-264, RF-265, RF-266, RF-267, RF-268, RF-269, RF-270, RF-271, RF-272, RF-273, RF-274, RF-275, RF-276, RF-277, RF-291]
---

# Design 026 — contrato v2, trava, marcas e telas

> Contrato entre as quatro frentes que trabalham em paralelo de 30/09 a 02/10: **P** (Python,
> `api/model/`), **T** (dados em TypeScript, `lib/`), **S** (modo simulado) e **U** (telas). Como no
> design 017, **este arquivo é a única fonte da forma do JSON** — não há tipo espelhado entre Python e
> TypeScript. O que muda aqui muda o contrato: combine antes.
>
> **Emenda 2026-10-04 (decisão do dono, manhã do 1º turno — voto projetado por candidatura).**
> A Decisão 1 listava "votos projetados por candidatura (chave `sqcand`)" entre o que a projeção produz,
> mas o contrato publicado levava por linha só a marca "eleito na projeção" (e `votos_projetados` por
> agremiação): o número de cada candidato ficava no modelo e nunca chegava à tela. Passa a ser publicado
> e exibido (§ 2.2, RF-297), com as ressalvas: **eleitos + 7** em vez de "eleitos + 5, mínimo 10" (novas
> faixas de visibilidade), sem reordenar (Decisão 5 permanece).
>
> Os fatos do feed citados vêm dos EA20 reais do simulado de 28/09
> (`tests/fixtures/tse/2026-sim/dep/README.md`), não do dicionário do TSE.

## 0. O que muda em relação ao design 017

| Design 017 | Aqui |
|---|---|
| D9 — "o número central é voto apurado; a tela não pode chamar isso de projeção" | **Superado** (ADR-0063). O número central **continua** sendo o apurado (`cadeiras`); a projeção existe em campos próprios (`cadeiras_projetadas`, marca `projecao`), sempre "não oficial" |
| D10 — `composition = {0, 0, 1}` porque "não há modelo" | O valor fica `{0, 0, 1}`: `bancada` continua sendo só voto contado. Muda o porquê, não o número. O teste (m6) fica |
| D6 — `suplentes`: "primeiros 5 por agremiação"; suplência nominal fora | `eleitos` e `suplentes` ficam **só por compatibilidade** (§ 2.12); a lista inteira vive em `candidatos` e na lista 61+ |
| D6 — `divergencias` saída de `conferir_contra_tse` | Vira `conferencia` (§ 2.8), com o que foi comparado e a magnitude. O campo v1 continua, com o mesmo conteúdo |
| `pct_apurado` = `max` das linhas (`project.py:7923`) | Σ `e.esi` ÷ eleitorado da UF (§ 6) |
| Voto nominal = `cand.vap` de todos (`deputado.py:313`) | Só `Válido`; `Válido (legenda)` vai para a legenda; anulado e sub judice saem (§ 7) |

## 1. Arquitetura — o caminho de um ciclo

```
cron da fatia (TS, lib/tse/ingest-handler.ts)
  ├─ lê interruptor-projecao-dep (Global Config) ── falha ⇒ desligado
  └─ POST /api/model/project { cargo: 6, turno: 1, trigger_ts, projecao_dep }     § 2.11
        │
        ▼ api/model/project.py — ramo proporcional
        P1: dvt (§ 7) · % apurado (§ 6) · Conferência sobre o agregado (§ 2.8)
        P2: deputado_projecao.py (puro) — trava (§ 2.7) + projeção (§ 5)
        P3: deputado_payload.py — payload v2 (§ 2)
        │   log estruturado `dep_projecao` (uma linha por ciclo, § 5.9)
        ▼
POST /api/internal/edge-write   { payload, payloads_uf: { UF: {…, lista_restante} } }  § 2.1
        │  writer separa `lista_restante`
        ├─ Global Config  projection-current-dep-t1            (nacional, § 2.9)
        ├─ Blob           deputado/uf/<UF>.json                 (§ 2.4)
        └─ Blob           deputado/uf-lista/<UF>.json           (só se houver rank > 60, § 2.5)

render de /uf/[sigla]/deputado-federal (revalidate 60)
  Promise.all([ readDeputadoProjection(), readDeputadoUfDetail(uf), readInterruptorProjecao() ])
  clique em "mostrar todos" ─▶ GET /uf/[sigla]/deputado-federal/lista (§ 2.10) ─▶ Blob uf-lista
```

A leitura do interruptor acontece **duas vezes, de propósito**: no ciclo (o produtor não calcula nem
publica marcas com ele desligado) e no render (desligar apaga da tela na próxima requisição, sem
esperar os até 30 min da volta completa das fatias). Python **não** lê o Edge Config: recebe o estado
no corpo do POST, e o registra no log do ciclo — é o que torna a projeção reproduzível (§ 5.9).

## 2. Contrato de dados

Tudo é **aditivo**. Um objeto v1 (sem `contrato`) continua válido e renderiza (RF-276, § 2.12).

### 2.1 Transporte — só dentro de `payload` e `payloads_uf[UF]`

`deputadoBodySchema` (`app/api/internal/edge-write/route.ts:273`) é `z.object` no topo: chave nova ao
lado de `payload`/`payloads_uf` é **descartada sem erro**. `payload`, `payload.bancada`,
`payload.por_uf[]` e cada `payloads_uf[UF]` são `.passthrough()`. Regra:

- campo nacional novo → dentro de `payload` (ou de `payload.por_uf[i]`);
- campo de UF novo → dentro de `payloads_uf[UF]`;
- a lista 61+ → `payloads_uf[UF].lista_restante`, que o writer **tira** do objeto da UF antes de gravar
  `deputado/uf/<UF>.json` e grava à parte como `deputado/uf-lista/<UF>.json` (§ 2.5).

Teste obrigatório da rota (frente T): um corpo com um campo v2 em cada um dos três lugares chega ao
Blob/Global Config; o mesmo campo no topo do corpo não chega e não dá erro.

Tamanho do POST: ~2–2,5 MB por ciclo nas 27 UFs (limite de corpo da função: 4,5 MB). O writer loga
`warn` acima de 3,5 MB.

### 2.2 A linha do candidato — `DeputadoUfLinha`

```ts
/** Uma linha de candidato em `candidatos[]` (Blob) e em `lista_restante` / uf-lista. */
interface DeputadoUfLinha {
  /** `cand.sqcand` — a identidade. NÚMERO no JSON (11 dígitos em 2026, cabe em 2^53). Nunca `cand.n`. */
  sqcand: number;
  /** `cand.nmu`, depois `cand.nm` (como hoje). */
  nome: string;
  /** Sigla do PARTIDO (dentro da federação, o componente). */
  partido: string;
  /** `cand.n` — número de urna. Exibição, nunca chave: repete entre UFs e partidos. */
  numero?: number;
  /** `cand.vap` — voto apurado, qualquer que seja o destino. */
  votos: number;
  /** 1-based na agremiação, por voto apurado (§ 3.1). A tela ordena por ele e NUNCA reordena. */
  rank: number;
  /** % dos válidos da UF, 0–100, 5 casas (`round(100·votos/vv_uf, 5)`). `null` ⇔ destino anulado ou sub judice. */
  pct_validos: number | null;
  /** Eleito na parcial, e por onde (na NOSSA conta). */
  parcial?: "qp" | "sobra";
  /** Sobra apertada na parcial — mesma semântica e nome do v1 (`_marcar_indefinidas`). Só com `parcial: "sobra"`. */
  indefinido?: true;
  /** Eleito na projeção. Só existe com `projecao.estado === "liberada"` na UF. */
  projecao?: "qp" | "sobra";
  /** Sobra apertada na projeção. Só com `projecao: "sobra"`. */
  projecao_apertada?: true;
  /** Voto projetado do candidato (por `sqcand`). Só existe com `projecao.estado === "liberada"` (emenda 04/10, RF-297). */
  votos_projetados?: number;
  /** `cand.st` mapeado. Só existe com totalização final (`tf = "s"`), e então em TODA linha. */
  tse?: "eleito_qp" | "eleito_media" | "eleito" | "suplente" | "nao_eleito";
  /** `cand.dvt` mapeado, só quando NÃO é voto nominal válido. Ausente = `Válido` ou `dvt` ainda não publicado. */
  destino?: "valido_legenda" | "anulado" | "sub_judice";
}
```

Chaves opcionais são **omitidas**, nunca `null` (exceto `pct_validos`, em que `null` é o dado). Um
campo booleano opcional só aparece como `true`.

Mapeamentos (tabelas fechadas, sem default — valor fora da tabela ⇒ campo ausente + `warn`):

| `cand.dvt` | `destino` | entra como |
|---|---|---|
| `Válido` | *(ausente)* | voto nominal elegível |
| `Válido (legenda)` | `valido_legenda` | voto da legenda (o candidato não pode ocupar vaga) |
| `Anulado` | `anulado` | fora de tudo |
| `Anulado sub judice` | `sub_judice` | fora de tudo |
| *(ausente — `and = "n"`)* | *(ausente)* | como hoje (bit-idêntico, § 7) |

| `cand.st` (só com `tf = "s"`) | `tse` |
|---|---|
| `Eleito por QP` | `eleito_qp` |
| `Eleito por média` | `eleito_media` |
| `Eleito` | `eleito` |
| `Suplente` | `suplente` |
| `Não eleito` | `nao_eleito` |

⚠️ `tse` guarda o **rótulo do TSE**, e `parcial`/`projecao` guardam a **nossa** via (primeiras
`min(QP, elegíveis ≥ 10% QE)` vagas = `qp`, as demais = `sobra`, `_cadeiras_de_fase_1`). No simulado de
28/09 os dois **não coincidem**. Nada no código, no teste ou na tela compara um com o outro; a
Conferência compara pessoas (§ 2.8).

### 2.3 A agremiação — campos novos

```ts
interface DeputadoUfAgremiacaoV2 extends DeputadoUfAgremiacao /* v1, lib/blob/deputado-uf.ts */ {
  /** Ranks 1..60 ∪ todo candidato com marca (parcial, projecao, tse eleito*) ∪ `corte.primeiro_fora`. Por rank asc. */
  candidatos?: DeputadoUfLinha[];
  /** Total de candidatos da agremiação na UF (Blob + lista 61+). */
  total_candidatos?: number;
  /** Só com projeção liberada. Eleitos na projeção — mesma semântica de `cadeiras` (RF-125.1). */
  cadeiras_projetadas?: number;
  /** RF-127 emendado (ADR-0063). Ausente quando não medida — nunca `[n, n]`. */
  cadeiras_projetadas_ci95?: [number, number];
  /** Só com projeção liberada. Votos válidos projetados da agremiação (nominais válidos + legenda). */
  votos_projetados?: number;
  /** Na PARCIAL. Ausente sem eleito ou sem candidato válido de fora (§ 3.4). */
  corte?: {
    ultimo_eleito: number;       // sqcand
    primeiro_fora: number;       // sqcand
    diferenca: number;           // votos(ultimo_eleito) − votos(primeiro_fora) ≥ 0
    primeiro_fora_abaixo_piso_10?: true; // 10·votos(primeiro_fora) < QE
  };
  /** Ausente quando ninguém da agremiação tem excedente ≥ 1 (§ 3.5). Por rank asc. */
  puxadores?: Array<{ sqcand: number; quocientes: number; excedente: number }>;
}
```

`votos_nominais`, `votos_legenda` e `votos_validos` (v1) passam a obedecer à regra do `dvt` (§ 7):
`votos_nominais` = Σ votos das linhas **sem** `destino`; `votos_legenda` = `tvtl` (que já inclui os
`Válido (legenda)`); `votos_validos = votos_nominais + votos_legenda`. `pct_votos` continua sobre os
válidos da UF.

### 2.4 O objeto da UF — `deputado/uf/<UF>.json`

```ts
interface DeputadoUfDetailV2 extends DeputadoUfDetail /* v1 */ {
  /** Versão do contrato. Ausente ⇒ v1. */
  contrato?: 2;
  /** ADR-0038 — o produtor JÁ publica os dois; o tipo v1 não declara (RF-276). */
  dado_ts?: string | null;
  pares_atrasados?: number | null;
  /** v2: Σ esi ÷ eleitorado da UF (§ 6). O nome e o tipo não mudam; o número deixa de ser o `max`. */
  pct_apurado: number;
  agremiacoes: DeputadoUfAgremiacaoV2[];
  /** Ausente sem QE (sem `nv` ou sem voto). § 2.6. */
  regras?: DeputadoRegras;
  /** Presente em todo objeto v2. § 2.7. */
  projecao?: DeputadoProjecaoUf;
  /** Presente em todo objeto v2. § 2.8. `divergencias` (v1, topo) === `conferencia.divergencias`. */
  conferencia?: DeputadoConferencia;
  /** Top 10 da UF por voto apurado, como REFERÊNCIA a linhas de `candidatos` (§ 3.2). */
  mais_votados?: Array<{ cod: string; sqcand: number }>;
  /** Ausente quando não há rank > 60 na UF (na prática, toda UF menos SP). */
  lista?: { restantes: number };
}
```

`mais_votados` é referência, e não linha repetida, para não haver duas fontes da mesma linha no mesmo
objeto. Resolve sempre no Blob: quem está entre os 10 mais votados da UF tem rank ≤ 10 na própria
agremiação. O helper `maisVotadosDaUf(detail)` em `lib/blob/deputado-uf.ts` devolve as linhas no
formato de `EdgeDeputadoDestaque` (§ 2.9) para o mesmo componente servir a UF e a capa.

### 2.5 A lista 61+ — `deputado/uf-lista/<UF>.json`

```ts
interface DeputadoUfLista {
  ts: string;            // o mesmo carimbo do objeto da UF no ciclo
  cargo: 6;
  turno: 1;
  contrato: 2;
  uf: string;
  /** Na ordem das agremiações do objeto da UF; cada uma com as linhas de rank > 60, rank asc. */
  agremiacoes: Array<{ cod: string; candidatos: DeputadoUfLinha[] }>;
}
```

No transporte: `payloads_uf[UF].lista_restante = DeputadoUfLista["agremiacoes"]`. O writer monta o
envelope (`ts`, `cargo`, `turno`, `contrato`, `uf`), grava só se houver ao menos uma linha, e grava
**antes** do objeto da UF (quem lê `lista.restantes > 0` nunca encontra a lista mais velha que ele).
Pathname: `deputadoUfListaBlobPathname(sigla)` em `lib/blob/paths.ts`, mesma validação de sigla de
`deputadoUfBlobPathname`.

### 2.6 Regras com os números da UF

```ts
interface DeputadoRegras {
  quociente_eleitoral: number;   // === DeputadoUfDetail.quociente_eleitoral
  votos_validos: number;         // Σ agremiacoes[].votos_validos
  lugares_a_preencher: number;
  piso_candidato: number;        // ⌈QE/10⌉  — art. 108: candidato precisa de ≥ 10% do QE para vaga de QP
  piso_agremiacao_sobras: number;// ⌈4·QE/5⌉ — art. 109 § 2º I: agremiação com ≥ 80% do QE disputa sobra
  piso_candidato_sobras: number; // ⌈QE/5⌉  — art. 109 § 2º II: candidato com ≥ 20% do QE na sobra restrita
}
```

Em inteiros, sem `float`: `⌈a/b⌉ = −(−a // b)`. O algoritmo compara `votos ≥ Fraction(QE, 10)`, e o
menor inteiro que satisfaz isso é exatamente `⌈QE/10⌉` — o número publicado é o que vale na conta.

### 2.7 Estado da projeção e motivos

```ts
interface DeputadoProjecaoUf {
  estado: "liberada" | "aguardando" | "indisponivel";
  /** Ausente ⇔ liberada. Conjunto FECHADO, por estado. */
  motivo?:
    | "pct_minimo" | "zonas_minimas" | "sem_vagas"          // aguardando — resolve sozinho
    | "interruptor" | "coligacao" | "cobertura" | "erro";   // indisponivel — não resolve sem ação
  pct_minimo: number;       // 25, ou o da chave do interruptor
  zonas_apuradas: number;   // zonas com e.esi > 0 ∧ v.vv > 0
  zonas_total: number;      // pares (município×zona) da UF na nossa tabela
}
```

Avaliação em ordem fixa — o **primeiro** que falha é o motivo publicado (determinismo, § 6 da
constituição):

| # | Condição para liberar | Falha ⇒ |
|---|---|---|
| 1 | interruptor ligado e válido | `indisponivel` / `interruptor` |
| 2 | nenhuma agremiação `tp = "c"` | `indisponivel` / `coligacao` |
| 3 | `carg.nv` publicado | `aguardando` / `sem_vagas` |
| 4 | `pct_apurado` (§ 6) ≥ `pct_minimo` | `aguardando` / `pct_minimo` |
| 5 | `zonas_apuradas` ≥ 2 | `aguardando` / `zonas_minimas` |
| 6 | Σ `e.te` das zonas conhecidas == `e.te` do agregado (quando há agregado) | `indisponivel` / `cobertura` |
| 7 | o cálculo não lançou | `indisponivel` / `erro` (a parcial sai normal; log `error`) |

A condição 6 nasceu do simulado de 28/09: no AP, o par Macapá×0014 não está na tabela `zonas`, a soma
do eleitorado das 17 zonas lidas dá 505.610 contra 628.071 do agregado (−19,5%), e a imputação "do
estado inteiro" imputaria só o estado que conhecemos. Em RR a soma fecha exata em todos os momentos.
Sem agregado lido no ciclo, a condição não é avaliada (passa) — a Conferência diz `sem_dado_tse`.

`por_uf[].projecao` (nacional) é **o mesmo objeto**, byte a byte.

### 2.8 Conferência

```ts
type Comparacao = "eleitorado" | "algoritmo" | "eleitos" | "votos_validos";

interface DeputadoConferencia {
  estado: "confere" | "diverge" | "sem_dado_tse";
  /** Hora do boletim do agregado comparado (dg/hg → ISO UTC). `null` sem agregado. */
  boletim_dado_ts: string | null;
  /** `tf` do agregado comparado. */
  totalizacao_final: boolean;
  /** O que foi DE FATO comparado neste ciclo. A frase da tela sai daqui. */
  comparou: Comparacao[];
  divergencias: DeputadoDivergencia[];
}

interface DeputadoDivergencia {
  /** Conjunto fechado (amplia `CHAVES_DE_DIVERGENCIA` de deputado_payload.py — mudança de contrato). */
  o_que: "quociente_eleitoral" | "cadeiras" | "eleitos" | "eleitorado" | "votos_validos";
  nosso: number;
  tse: number;
  detalhe: string;
  /** 100·(nosso − tse)/tse, 5 casas, com sinal. Presente em `eleitorado` e `votos_validos`. */
  diferenca_pct?: number;
}
```

| Comparação | Quando é feita | Chaves que produz |
|---|---|---|
| `eleitorado` | há agregado da UF no ciclo (qualquer `and`) | `eleitorado` — Σ `e.te` das zonas × `e.te` do agregado |
| `algoritmo` | agregado com `and ≠ "n"` e `carg.qe` presente (`qe` só existe no agregado da UF; `agr.vag` com `and = "n"` é resto de ciclo anterior) | `quociente_eleitoral`, `cadeiras` (detalhe `agremiação <cod>`) — `distribuir_cadeiras` sobre os votos **do próprio agregado** (regra do `dvt` aplicada) × `carg.qe` / `agr.vag` do mesmo arquivo |
| `eleitos` | agregado com `tf = "s"` | `eleitos` — `nosso` = eleitos na parcial que o TSE não elegeu, `tse` = o inverso; `detalhe` lista os `sqcand`. Por pessoa (`cand.e = "s"`), **nunca** por rótulo |
| `votos_validos` | agregado com `tf = "s"` | `votos_validos` — Σ `v.vv` das zonas × `v.vv` do agregado |

Estado: `diverge` se há ao menos uma divergência; senão `confere` se `algoritmo` foi feita; senão
`sem_dado_tse`. **A frase "batem com o TSE" só existe com `confere`**, e nomeia o horário do boletim.

`quociente_eleitoral_tse` (v1, topo) passa a ser o `carg.qe` do último agregado lido (hoje é sempre
`null` no modo por zona, `deputado.py:502`). Ele pode diferir do nosso `quociente_eleitoral` sem que
haja divergência de `algoritmo`: o nosso é calculado sobre a soma das zonas, que pode estar em outro
momento ou — como no AP — ter menos eleitorado; é a comparação `eleitorado` que explica.

### 2.9 Payload nacional — `projection-current-dep-t1`

```ts
interface EdgePayloadDeputado /* v1 + */ {
  /** Top 10 do país por voto apurado. Autossuficiente: a capa NUNCA lê Blob (RF-271). */
  mais_votados?: EdgeDeputadoDestaque[];
  /** Até 30, por excedente desc (§ 3.5). */
  puxadores?: EdgeDeputadoPuxador[];
  por_uf: Array<EdgeDeputadoUfRow & { projecao?: DeputadoProjecaoUf }>;
}

interface EdgeDeputadoDestaque {
  uf: string;
  sqcand: number;
  nome: string;
  partido: string;
  cod: string;        // agremiação — chave NACIONAL, resolve em bancada.por_agremiacao (emenda 29/09 abaixo)
  sigla: string;      // agremiação
  numero?: number;
  votos: number;
  /** % dos válidos DA UF DO CANDIDATO — o único denominador com sentido. */
  pct_validos: number | null;
  destino?: "valido_legenda" | "anulado" | "sub_judice";
}

interface EdgeDeputadoPuxador extends EdgeDeputadoDestaque {
  quociente_eleitoral: number; // o da UF dele
  quocientes: number;          // ⌊votos/QE⌋
  excedente: number;           // quocientes − 1 ≥ 1
}
```

`bancada` não muda (continua a parcial). Custo: +~8 KB, chegando a ~19 KiB dos 75 KiB do orçamento da
chave. Nenhuma bancada nacional projetada **neste contrato** (spec § Fora).

> **Emenda 04/10 (decisão do dono).** O cenário nacional misto (RF-300) e a lista nacional de eleitos
> (RF-299) **não entram neste contrato**: são montados na leitura, por `GET /deputado-federal/eleitos`, a
> partir dos objetos por UF do Blob. O payload do Edge Config e o modelo não mudam. ADR-0063, emenda de
> 04/10 (2).

⚠️ **Emenda de 2026-09-29 — o `cod` da agremiação é a chave nacional, não o `agr[].n`.** Até esta data
o `cod` era o `agr[].n` do EA20, sob a premissa (design 017 D3) de que ele seria estável no país. Não
é: é o id da inscrição da agremiação **naquela UF**, e nos EA20 reais de RR e AP nenhum coincide. O
`cod` de `mais_votados[]`, `puxadores[]`, `por_uf[].lider` e de cada agremiação do objeto da UF e da
lista 61+ passa a ser a chave de `api/model/deputado.py::chave_agremiacao` — o número do partido
(`"13"`) ou `"fed:" + fed[].n` (`"fed:101"`) — e **resolve sempre** contra uma linha de
`bancada.por_agremiacao`. Regra completa e evidência no design 017, D3 (emenda da mesma data). O
formato continua `string`; nenhum consumidor TS interpreta o `cod` além de igualdade.

### 2.10 Chave do interruptor — `interruptor-projecao-dep`

```ts
interface InterruptorProjecaoDep {
  ligada: boolean;
  /** 25 ≤ pct_minimo ≤ 100 sobe a trava. Fora disso, ou não numérico, é IGNORADO (vale 25), com log; `ligada` fica como veio. Ausente ⇒ 25. */
  pct_minimo?: number;
  /** ISO 8601 de quando foi gravada. */
  em?: string;
  /** Rótulo curto de quem gravou ("dono", "vigia"). Nunca e-mail. */
  por?: string;
}
```

- Constante em `lib/edge-config/keys.ts`: `INTERRUPTOR_PROJECAO_DEP_KEY = "interruptor-projecao-dep"`.
- `readInterruptorProjecao()` em `lib/edge-config/reader.ts` devolve
  `{ ligada: boolean; pct_minimo: number; origem: "chave" | "ausente" | "invalida" | "falha" }` —
  `ligada` só é `true` com `origem: "chave"`. Nunca lança, e tem teto de tempo de **2 s**
  (`TIMEOUT_INTERRUPTOR_MS`): tempo esgotado é `falha` ⇒ desligada (ADR-0063 D4 lista "tempo
  esgotado" entre as leituras que desligam). O teto vale para o render e para o ciclo de ingestão,
  que espera esta leitura antes de disparar o modelo.
- **Regra da chave — a mesma nos dois lados** (TS `interpretarInterruptor`, Python
  `deputado_projecao.interruptor_do_corpo`; alinhados em 29/09, ADR-0063 D4 "ignorado, com log"):
  - valor que não é objeto, ou `ligada` que não é o booleano `true` ⇒ **desligada**. No TS, `ligada`
    não booleano é `origem: "invalida"` (log em `error`); `{ligada: false}` é `chave` (desligada pela
    operação);
  - `pct_minimo` entre 25 e 100 ⇒ vale (decimal sobe para o inteiro de cima no POST do modelo e,
    se chegar decimal ao Python, lá também — `ceil` erra para travar mais);
  - `pct_minimo` abaixo de 25, acima de 100, não numérico, booleano, `null`, NaN ⇒ **ignorado**: a
    trava fica em 25, `ligada` **não muda**, e sai um aviso no log (`pct_minimo_ignorado` no TS,
    `aviso` no Python). Até 29/09 o Python desligava o interruptor inteiro nesses casos enquanto a
    tela só ignorava o `pct_minimo` — o modelo e a página discordavam sobre a mesma chave.
- Começa **ligada** na virada (decisão do dono, plano de 29/09) — ausente ⇒ desligada, então alguém
  precisa gravá-la: é o passo do runbook de 03/10.
- `scripts/interruptor-projecao.ts` (`pnpm dep:projecao [--ligar|--desligar] [--pct N] [--ensaio]`):
  mostra o valor atual e o id/nome do store, pede confirmação digitada, recusa o store de ensaio
  (`salacofre-edge-config-preview`) sem `--ensaio` e recusa qualquer outro com `--ensaio`. O ensaio de
  03/10 ("desligar → some em até 60 s") roda com `--ensaio`.
- ⚠️ **Variável de ambiente não é interruptor.** Na Vercel ela só chega a deploy novo. O runbook
  (`docs/operations/runbook.md:870`) e `vercel.ts:184` dizem "sem deploy" sobre
  `TSE_DEPUTADO_GRANULARIDADE` — falso; corrigir o texto (frente T).

### 2.11 Corpo do POST do modelo

```py
class ProjectRequest(BaseModel):          # api/model/project.py:216
    cargo: int
    turno: int
    trigger_ts: str
    # novo, opcional — ausente ⇒ desligado (falha fechada)
    projecao_dep: ProjecaoDep | None = None

class ProjecaoDep(BaseModel):
    ligada: bool
    pct_minimo: int = Field(default=25, ge=25, le=100)
```

> **Como ficou (29/09).** O campo entrou como `projecao_dep: Any = None` e é normalizado por
> `deputado_projecao.interruptor_do_corpo` com a regra do § 2.10, **não** por `Field(ge=25, le=100)`:
> um valor fora da faixa daria 400 no corpo inteiro e o ciclo deixaria de publicar até a parcial.
> Ausente ⇒ desligado; `pct_minimo` inválido ⇒ ignorado (25), com `warn` no log do ciclo.

`derive_seed` **não** muda (continua `(cargo, turno, trigger_ts)`): a projeção de deputado é
determinística e não consome RNG; o bootstrap da faixa (se houver) usa a mesma semente derivada.

### 2.12 Compatibilidade v1 ↔ v2

- **Leitor v2 lendo objeto v1** (o último ciclo antes do deploy, ou Blob velho): `contrato` ausente ⇒
  a página usa `eleitos` + `suplentes` como lista (por `ordem`), sem %, número, marcas novas, corte,
  puxadores, regras, mais votados nem projeção; a Conferência mostra o texto neutro de "sem dado"
  (nunca o "batem" de hoje). Teste contra `tests/fixtures/blob/dep-uf.json`, **intocada**.
- **Leitor v1 lendo objeto v2** (rollback): `eleitos`, `suplentes`, `divergencias`, `ordem` e
  `indefinido` continuam no objeto v2 com a semântica v1. O rollback volta ao texto antigo da
  Conferência — aceito, é o código antigo.
- `isDeputadoUfDetail` continua estrutural mínimo (`ts`, `uf`, `agremiacoes[]`); campos v2 são
  opcionais no tipo e checados no uso.

## 3. Ordem e desempate

Toda ordem aqui é decidida pelo **produtor** e a tela **não reordena** — ela não tem os dados para
reproduzir o desempate (a data de nascimento do art. 110 só existe em memória no ciclo; constituição
§ 5, ADR-0058).

### 3.1 `rank` na agremiação

Chave: `(−votos, destino, art. 110, sqcand)`, em que `destino` ordena válido/ausente < `Válido
(legenda)` < sub judice < anulado, e "art. 110" é o desempate de `cadeiras._ordenar_candidatos`
(mais idoso primeiro; sem data, depois; em memória). Consequência verificável: os eleitos na parcial
são sempre os primeiros ranks válidos da agremiação, na ordem em que ocuparam vaga.

### 3.2 Mais votados da UF

Todas as linhas da UF (Blob ∪ lista 61+), `(−votos, sqcand)`, 10 primeiras. Inclui destino anulado e
sub judice (spec, open question 2).

### 3.3 Mais votados do país

Todas as linhas das UFs do ciclo, `(−votos, uf, sqcand)`, 10 primeiras.

### 3.4 Linha de corte

`ultimo_eleito` = maior rank com `parcial`; `primeiro_fora` = menor rank **sem** `parcial` e **sem**
`destino`. Como os eleitos são os primeiros ranks válidos (§ 3.1), `diferenca ≥ 0`. Ausente se a
agremiação não tem eleito ou não tem candidato válido de fora.

### 3.5 Puxadores

Linha sem `destino` com `excedente = ⌊votos/QE⌋ − 1 ≥ 1` (votos ≥ 2·QE — spec, open question 1). Na
agremiação: por rank. No país: `(−excedente, −votos, uf, sqcand)`, até 30.

### 3.6 Agremiações

Inalterado: `(−cadeiras, −votos_validos, sigla, cod)` na UF; `(−cadeiras, sigla, cod)` no nacional.
Cadeiras **da parcial** — a projeção nunca ordena (constituição § 2).

## 4. Marcas — uma derivação só

`lib/utils/deputado-marcas.ts` é o único lugar que decide o que a linha mostra; servidor e cliente
usam a mesma função (o servidor a chama e manda o resultado já derivado, § 8.3).

```ts
type Marca =
  | { tipo: "tse" }                                            // "Eleito (TSE)"
  | { tipo: "projecao"; via: "qp" | "sobra"; apertada: boolean } // "eleito na projeção · não oficial"
  | { tipo: "parcial"; via: "qp" | "sobra"; apertada: boolean }; // "eleito na parcial"

function marcasDaLinha(
  linha: DeputadoUfLinha,
  ctx: { totalizacaoFinal: boolean; projecaoVisivel: boolean },
): Marca[];
```

Regras, nesta ordem:

1. `destino` presente ⇒ `[]` (defensivo: o produtor já não marca, e a tela também não).
2. `ctx.totalizacaoFinal` ⇒ só o TSE: `tse` ∈ {`eleito_qp`, `eleito_media`, `eleito`} ⇒
   `[{tipo: "tse"}]`; qualquer outro ⇒ `[]`. **Precedência**: parcial e projeção somem na UF inteira.
3. Senão: `parcial` ⇒ marca de parcial; `projecao` **e** `ctx.projecaoVisivel` ⇒ marca de projeção. As
   duas podem coexistir.

`projecaoVisivel = detail.projecao?.estado === "liberada" && interruptor.ligada` — as duas leituras,
sempre juntas.

Texto (nunca "eleito" sozinho):

| Marca | Texto | Visual |
|---|---|---|
| parcial | "eleito na parcial" (+ " · sobra apertada") | estilo próprio, distinto das outras duas |
| projeção | "eleito na projeção · não oficial" (+ " · apertada") | **vazada** (borda, sem preenchimento) |
| TSE | "Eleito (TSE)" | **cheia** |
| destino | "votos para a legenda" / "votos anulados" / "sub judice — fora da conta" | texto, sem marca de eleito |

A via ("pelo quociente do partido" / "nas sobras") aparece **junto da marca de parcial ou de projeção**
e é dita como conta nossa. O rótulo do TSE nunca vira via e a via nunca vira rótulo do TSE.

## 5. Projeção (P2) — o que o ADR-0063 fixa, em forma de contrato

Módulo novo `api/model/deputado_projecao.py`, **puro** (sem I/O, sem log — quem loga é
`project.py`), reusando `extrapolation.py`, `_compute_estratos_por_uf` e `cadeiras.py`.

1. **Zona apurada**: último boletim com `e.esi > 0` e `v.vv > 0`.
2. **Fator da zona**: `e.te / e.esi` sobre os votos da zona (ADR-0021).
3. **Razão das somas por chave**: por estrato, Σ votos projetados ÷ Σ eleitorado apurado, por chave —
   `sqcand` (candidato válido) e `legenda:<cod>` (legenda, já com os `Válido (legenda)`).
4. **Pós-estratificação** por tercis de tamanho de zona (eleitorado) em UF com ≥ 12 zonas; abaixo
   disso, um estrato só (ADR-0023).
5. **Imputação**: toda zona sem boletim recebe, por chave, a razão do seu estrato × o eleitorado dela.
   É o estado inteiro — daí a condição de cobertura (§ 2.7 #6).
6. **Arredondamento**: votos projetados viram inteiro por chave com regra determinística (maiores
   restos, desempate por chave), antes de `distribuir_cadeiras` — o algoritmo exige inteiros e
   `Fraction`.
7. **Apertada**: `_marcar_indefinidas` sobre a entrada projetada e o mesmo `pct_apurado`.
8. **Faixa** (`cadeiras_projetadas_ci95`): opcional; mesmo padrão do `cadeiras_bootstrap.py` (um `idx`
   de zonas compartilhado por todas as agremiações). Ausente se não couber no ciclo.

### 5.9 Log `dep_projecao` e reprodutibilidade

Uma linha estruturada por ciclo (`_log("info", "dep_projecao", …)`), com: `trigger_ts`, estado do
interruptor recebido (`ligada`, `pct_minimo`), e por UF `estado`, `motivo`, `pct_apurado`,
`zonas_apuradas`, `zonas_total`, `ms`. Com os snapshots (append-only, § 10) e o código, isso
reconstrói qualquer projeção publicada — sem gravar em `projections` (spec § Fora).

## 6. % apurado da UF (P1, RF-275)

```
pct_apurado_uf = 100 · Σ_z e.esi(z) / TE_uf
TE_uf          = max( e.te do agregado da UF (se lido no ciclo), Σ_z e.te(z) )
```

sobre as zonas conhecidas da UF (a última linha de cada par). `s.psa` é binário no feed (0 com
`and = "n"`, 100 com qualquer boletim) e o `snapshots.pct_apurado` **é** `s.psa`
(`lib/tse/ingest-handler.ts:732-745`) — daí nunca ler aquela coluna para isso. O `max` com o agregado
é o que impede o AP de marcar 100%: sem ele, Σ `esi` ÷ Σ `te` das 17 zonas lidas dá 100%.

Alimenta: `pct_apurado` do objeto da UF e de `por_uf[]`, a trava (§ 2.7 #4) e `_marcar_indefinidas`.

## 7. Regra do `dvt` (P1, RF-268, ADR-0064)

Por arquivo (zona ou agregado), em `deputado.py::extrair_entrada_proporcional`:

- Se **nenhum** `cand.dvt` no arquivo: caminho de hoje, bit-idêntico (`Candidato` para todo
  candidato com `vap`; legenda = Σ `par.tvtl`).
- Senão: `Candidato` só para `Válido`; legenda da agremiação = Σ `par.tvtl` (que o TSE já publica
  como `tval + Σ vap[Válido (legenda)]`); `Anulado`/`Anulado sub judice` ficam fora; e a identidade
  do candidato ganha `destino` para o payload.
- Invariante por arquivo: Σ agremiações (nominais `Válido` + legenda) == `v.vv`. Violação: log `error`
  + `_alert_slack`, **sem** abortar; o ciclo segue com o que o TSE marcou.
- Partido com `par.dvt` sub judice (chapa inteira sub judice, visto no AP): `tvtn = 0` e a legenda
  dele não entra; a agremiação aparece com 0 válido.
- `combinar_entradas` soma por `sqcand`/`cod` como hoje; `destino` de um `sqcand` é o do arquivo mais
  recente (é status do candidato, não da zona).

Golden de 2022: inalterado (os arquivos de 2022 não têm `dvt`).

## 8. Telas (U)

### 8.1 Componentes novos

| Componente | Arquivo | Tipo | RFs |
|---|---|---|---|
| `DeputadoListaAgremiacao` | `components/blocks/DeputadoListaAgremiacao.tsx` | cliente | RF-260, RF-261, RF-272 |
| `MarcaDeputado` | `components/atoms/badges/MarcaDeputado.tsx` | sem estado, importável pelo cliente (a lista o usa) | RF-262, RF-266, RF-267 |
| `DeputadoMaisVotados` | `components/blocks/DeputadoMaisVotados.tsx` | servidor | RF-270, RF-271 |
| `DeputadoPuxadores` | `components/blocks/DeputadoPuxadores.tsx` | servidor | RF-273 |
| `DeputadoRegras` | `components/blocks/DeputadoRegras.tsx` | servidor | RF-274 |
| `DeputadoConferencia` | `components/blocks/DeputadoConferencia.tsx` | servidor | RF-269 |
| `DeputadoMetodologia` (estendido) | existente | servidor | RF-266 |
| `marcasDaLinha` | `lib/utils/deputado-marcas.ts` | util | RF-262, RF-267 |
| `readInterruptorProjecao` | `lib/edge-config/reader.ts` | util | RF-265 |

O registro em `docs/design-system/components.md` é do `spec-syncer`, na barreira.

### 8.2 `DeputadoListaAgremiacao`

- `<ol>` única por agremiação; linhas 1–20 visíveis; 21–60 no documento com `data-faixa="2"`,
  escondidas por CSS enquanto a lista está fechada (padrão D21 do ADR-0034: nenhum nó sai do DOM);
  61+ inseridas na mesma `<ol>` depois da busca.
- Botão "ver mais" (`aria-expanded`, `aria-controls` na `<ol>`); botão "mostrar todos (N)" só com
  `lista.restantes > 0`, que busca a rota uma vez por aba (cache em memória por UF), com
  `aria-busy`, região viva `role="status"` ("N candidatos carregados"), foco na primeira linha nova
  (`tabIndex={-1}`) e, no erro, mensagem + "tentar de novo".
- A linha de corte é um `<li role="separator">` com texto entre `ultimo_eleito` e `primeiro_fora`; o
  cabeçalho da agremiação repete a diferença (RF-272).
- Classes de CSS (CSS Module), não estilo inline, e `content-visibility: auto` com
  `contain-intrinsic-size` no contêiner da agremiação.

### 8.2b Mini-foto dos eleitos (RF-291, emenda de 03/10)

- **A regra num lugar só**: `<AvatarEleito>` (`components/blocks/AvatarEleito.tsx`, sem diretiva —
  serve à lista cliente e ao `<DeputadoMaisVotados>` servidor). Eleito = `ehEleitoNosBits`
  (`lib/utils/deputado-marcas.ts`): bit `PARCIAL` ou `TSE` dos bits já derivados — herda a
  precedência do § 4 e é a mesma regra de "quem conta como eleito" de `lib/deputado/lista-documento.ts`.
- **A URL é decidida no servidor**: `lerFotosDaCasa(cargo, uf)` (`app/(dep)/_dados-da-casa.ts`) lê a
  fatia `candidatos/uf/<UF>/<dep|est|dis>.json` (Data Cache 12 h) e devolve os `sqcand` com
  `foto_ok`; `fotosDosEleitos` (`lib/deputado/fotos-eleitos.ts`) monta, **por lista**, o mapa
  `sqcand → candidatoFotoUrl(uf, sqcand)` só dos eleitos com foto. O cliente não deriva URL e não lê
  `/api/*` (BotID). Eleito fora do mapa ⇒ iniciais. A leitura acontece depois do estado "aguardando
  dados" (naquele estado não há eleito, e a grade do RF-149 já lê a mesma fatia).
- **Forma**: `<CandidateAvatar rounded responsive={false} semEstiloInline>` 28×28 com UMA classe
  (`.avatar` no CSS Module da lista, par neutro `--surface-sunken`/`--text-secondary`); a margem
  negativa mantém a linha alinhada pela base do texto, e `li:has(.avatar)` ganha `padding` de
  `--space-2` para o círculo não invadir o filete vizinho. O recorte da faixa 2 (federal) continua
  vencendo (seletor mais específico).
- **Peso** (decisão do dono, 03/10): ~368 B por eleito com foto (HTML + RSC); o teto das listas no
  teste de unidade subiu de 360 para 384 KiB com a medida escrita ao lado. No e2e o servidor falso
  sintetiza a fatia de candidaturas com `foto_ok` em toda linha (pior caso); SP estadual mediu
  406,5 KiB e o teto das assembleias subiu de 400 para 424 KiB; o federal de SP (544,9 KiB) segue
  nos 560.

### 8.3 Tuplas compactas (contrato interno da frente U — não trafega no Blob)

O servidor chama `marcasDaLinha` e manda ao cliente, por linha, uma tupla de posição fixa em vez de
objeto com chaves (o payload RSC de SP repetiria ~1.000 × os nomes das chaves):

```ts
type LinhaCompacta = readonly [
  rank: number,
  sqcand: number,
  nome: string,
  partido: string,
  numero: number | null,
  votos: number,
  pct_validos: number | null,
  marcas: number,   // bitmask das Marca já derivadas (constantes exportadas de deputado-marcas.ts)
  destino: 0 | 1 | 2 | 3, // 0 nenhum · 1 valido_legenda · 2 anulado · 3 sub_judice
];
```

A resposta da rota 61+ é convertida para a mesma tupla no cliente, pela mesma função (importada de
`deputado-marcas.ts`).

### 8.4 Capa `/deputado-federal`

`DeputadoMaisVotados` e `DeputadoPuxadores` recebem `payload.mais_votados`/`payload.puxadores`. A
tabela estado a estado ganha o selo de `por_uf[].projecao` (texto: "projeção liberada · não oficial",
"aguarda 25%", "indisponível"), escondido quando o interruptor está desligado. Teste: com o leitor de
Blob mockado, a capa renderiza e `readDeputadoUfDetail` tem 0 chamadas.

### 8.5 Rota da lista

`app/(dep)/uf/[sigla]/deputado-federal/lista/route.ts`:

- `GET` → `readDeputadoUfLista(sigla)` (novo, `lib/blob/deputado-uf.ts`, mesmo molde discriminado de
  `readDeputadoUfDetail`, nunca lança).
- `export const revalidate = 60`; resposta com
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- 200 com `DeputadoUfLista`; 404 para sigla inválida ou objeto inexistente; 502 para falha do Blob.
- Fora de `/api` porque o BotID (`proxy.ts:103`, matcher `/api/:path*`) barraria o clique de quem
  passou pela página sem JS de verificação.

## 9. Fixtures — ordem de troca

1. **Agora (W0)**: `tests/fixtures/contrato/deputado-uf-v2.json`, `deputado-uf-lista.json`,
   `deputado-nacional-v2.json` — escritas à mão no formato de produção, com invariantes em
   `tests/unit/contrato/deputado-v2-fixtures.test.ts`. As frentes T e U trabalham contra elas.
2. **Quinta 01/10, 18h**: `pnpm sim:full` passa a emitir v2 (`data-pipeline/simulacao-gerar.ts::montarDeputado`,
   frente S), incluindo `deputado-uf-lista.json` no mesmo diretório; a U troca para o simulado.
3. `tests/fixtures/blob/dep-uf.json` fica v1 para sempre (RF-276).

## 10. Peso

| Item | Tamanho |
|---|---|
| Blob de SP (v1 → v2) | 31 KB → ~180 KB |
| 27 Blobs de UF por ciclo | ~1,5 MB |
| POST de escrita | ~2–2,5 MB (limite 4,5 MB; `warn` a 3,5 MB) |
| Payload nacional | +~8 KB (~19 de 75 KiB) |
| Documento de `/uf/SP/deputado-federal` | teto próprio **480 KiB** (≈ 70 KiB gzip), no e2e |

O teto entra em `tests/e2e/perf-budget.spec.ts` como exceção nomeada da rota (o teto geral de 300 KiB
não muda). Para medir, o servidor falso (`scripts/edge-config-falso.ts`) passa a servir também o
Blob (`/deputado/uf/<UF>.json`, `/deputado/uf-lista/<UF>.json`) e a chave do interruptor, e
`build:e2e`/`start:e2e` apontam `BLOB_PUBLIC_BASE_URL` para ele — hoje `BLOB_READ_WRITE_TOKEN=""` faz
`blobPublicBaseUrl()` devolver `null` e o portão mede "Detalhe indisponível".

## 11. Riscos técnicos

| Risco | Mitigação |
|---|---|
| Voto de reduto mal imputado a 25% | rótulo "não oficial", "apertada", interruptor, G2 reportado ao dono |
| Trava abrir cedo por % errado | P1 (§ 6) entra antes do P2; teste no limiar |
| Zona fora da tabela (AP) | condição de cobertura (§ 2.7 #6) + Conferência com magnitude |
| Rótulo do TSE lido como a nossa via | tipos separados (`tse` × `parcial`/`projecao`), texto separado, Conferência por pessoa |
| Campo novo descartado pela rota de escrita | só dentro de `payload`/`payloads_uf`, com teste da rota (§ 2.1) |
| Página de SP pesada | tuplas, CSS Module, `content-visibility`, teto medido, tempo de SSR medido |
| Interruptor no store errado | script confirma o store, recusa o de ensaio sem `--ensaio` |
| Falha de leitura do Edge Config esconder a projeção | falha fechada, de propósito |
| Edição paralela em `project.py`, `simulacao-gerar.ts`, `/sobre-o-modelo` | worktrees; `git log` antes de editar |

## 12. ADRs aplicáveis

- **ADR-0063** — projeção de deputado com trava de 25% e interruptor no Edge Config (supersede o D9 do
  design 017 e o texto do D10; estende o ADR-0021/0023 ao cargo 6; emenda o RF-127; variável de
  ambiente não é interruptor; posição sobre o § 6).
- **ADR-0064** — destino do voto no proporcional (seguir o `dvt`; invariante com `v.vv`; `dvt` ausente
  bit-idêntico; diferença do ADR-0053).
- **ADR-0065** — listas de candidaturas proporcionais (faixas 20/60/61+; emenda escopada do ADR-0017;
  rota fora de `/api`; teto de peso próprio).
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md),
  [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md),
  [ADR-0023](../../architecture/adrs/0023-pos-estratificacao-por-porte-de-zona.md),
  [ADR-0034](../../architecture/adrs/0034-resultpanel-colapso-visual-corte-fora-do-kit.md),
  [ADR-0038](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md),
  [ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md).
