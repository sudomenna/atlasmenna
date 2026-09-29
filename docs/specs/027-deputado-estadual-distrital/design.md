---
id: 027-deputado-estadual-distrital
type: design
title: Deputado Estadual e Distrital — nomes por cargo, Fase 1 × Fase 2, orçamento de requisições, Conferência em resumo, capa das 27 casas
status: ready
date: 2026-09-29
spec: ./spec.md
# + ADR-0066 (cargos 7/8 como proporcionais: nomes, UFs, totais, interruptor único) e ADR-0067
#   (orçamento; emenda o ADR-0036) — escritos em paralelo pelo adr-author
adrs: [0001, 0005, 0012, 0021, 0023, 0026, 0027, 0036, 0038, 0039, 0044, 0049, 0063, 0064, 0065]
requirements: [RF-278, RF-279, RF-280, RF-281, RF-282, RF-283, RF-284, RF-285, RF-286, RF-287, RF-288, RF-289, RF-290]
---

# Design 027 — as assembleias sobre o proporcional da 026

> Contrato entre as frentes que trabalham em paralelo de 29/09 a 02/10: **T** (TypeScript, `lib/` e
> rotas), **P** (Python, `api/model/`), **U-a** (página da casa), **U-b** (capa e navegação), **S**
> (modo simulado) e **Fase 2**. A forma do JSON continua sendo a do [design 026](../026-deputado-listas-projecao/design.md)
> § 2; este arquivo só diz **o que muda por cargo** e os dois acréscimos aditivos do § 3.2. O que muda
> aqui muda o contrato: combine antes.

## 0. O que muda em relação às specs 017 e 026

| Hoje (6 só) | Com 7 e 8 |
|---|---|
| `CargoTse = 1 \| 3 \| 5 \| 6`; 7/8 "fora do escopo" (`lib/config/cargos.ts:38-42`) | `1 \| 3 \| 5 \| 6 \| 7 \| 8`; 7 e 8 `proporcional: true`, `eleicao: "estadual"` |
| "27 UFs" implícito em todo lugar (`project.py:7744` `UFS_DA_ELEICAO = 27`, `TODAS_UFS` em `targets.ts:513`) | UFs **por cargo**: `ufsDoCargo(7)` = 26 (sem DF), `ufsDoCargo(8)` = `["DF"]`, demais 27 |
| Proporcional ⇔ `cargo === 6` em vários pontos (`edge-write/route.ts:342` `z.literal(6)`, `ingest-handler.ts:264`, `deputado-uf.ts:200,805`, `writer.ts:1384`, `types.ts:2052`) | Proporcional ⇔ `cargoInfo(c).proporcional`; tipo `CargoProporcional = 6 \| 7 \| 8` |
| Blob `deputado/uf/<UF>.json` sem cargo no caminho (`paths.ts:208,231`) | Prefixo por cargo; **o do 6 não muda** (§ 2) |
| `total_cadeiras` 513 fixo (`cargos.py:132`) | 1.035 (7), 24 (8); capa 1.059 |
| Deputado em zona, 6 fatias, volta de 30 min | Fase 1: 7 e 8 em resumo a 5 min, 6 inalterado. Fase 2: 6 e 7 intercalados, volta de 60 min; 8 em zona a 5 min |
| Um interruptor (`interruptor-projecao-dep`) | Mais um, `interruptor-projecao-est`, para 7 **e** 8 |
| Conferência pressupõe zonas | Em resumo, as comparações de zona saem como "não comparado" (§ 6) |

## 1. Arquitetura — o caminho de um ciclo de 7 e 8

### 1.1 Fase 1 (resumo)

```
cron /api/ingest/deputado-estadual   (a cada 5 min, 1 rps)      cron /api/ingest/deputado-distrital (idem)
  └─ listIngestTargets(cargo 7) → 26 alvos "uf" (sem DF)           └─ 1 alvo "uf": df-c0008-e021272-u.json
        │ snapshots (cargo 7/8, append-only — o banco não muda)
        ▼
  POST /api/model/project { cargo: 7|8, turno: 1, trigger_ts }          ← sem projecao_dep: resumo não projeta
        │
        ▼ api/model/project.py — ramo proporcional (`_e_proporcional` lê a tabela)
        dvt (026 § 7) · % apurado = e.esi/e.te do resumo (026 § 6 com uma linha)
        Conferência em modo resumo (§ 6) · SEM projeção, SEM `projecao` no objeto
        deputado_payload.py — payload v2 com `cargo`, `granularidade: "uf"`, total fixo
        ▼
POST /api/internal/edge-write  { cargo: 7|8, payload, payloads_uf: { UF: {…, lista_restante} } }
        │  UF fora de ufsDoCargo(cargo) → descartada, `error` + alerta (RF-279)
        ├─ Global Config  projection-current-est-t1 | projection-current-dis-t1
        ├─ Blob           deputado-estadual/uf/<UF>.json | deputado-distrital/uf/DF.json
        └─ Blob           deputado-estadual/uf-lista/<UF>.json   (só SP, MG, RJ, BA podem ter rank > 60)

render de /uf/[sigla]/deputado-estadual (revalidate 60)
  Promise.all([ readDeputadoProjection(7), readDeputadoUfDetail(7, uf), lerInterruptorDaTela(7) ])
  clique em "mostrar todos" ─▶ GET /uf/[sigla]/deputado-estadual/lista ─▶ Blob uf-lista do 7

render de /deputado-estadual (revalidate 60)
  Promise.all([ readDeputadoProjection(7), readDeputadoProjection(8), lerInterruptorDaTela(7) ])  ← nunca Blob de UF
```

### 1.2 Fase 2 (zona)

```
cron /api/ingest/deputado-federal/<n>   minutos 0/10/20/30/40/50 — fatia n uma vez por hora
cron /api/ingest/deputado-estadual/<n>  minutos 5/15/25/35/45/55 — fatia n uma vez por hora
  └─ ninguém da faixa de 5 rps roda junto (teste de `vercel.ts`, § 5.3)
cron /api/ingest/deputado-distrital     a cada 5 min, 1 rps, 19 pares + agregado do DF, sem fatia
  ├─ lê interruptor-projecao-est (Global Config) ── falha ⇒ desligado
  └─ POST /api/model/project { cargo: 7|8, turno: 1, trigger_ts, projecao_dep }
        projecao_dep: o MESMO campo da 026 (§ 2.11 dela), com o valor da chave DO CARGO:
        6 → interruptor-projecao-dep; 7 e 8 → interruptor-projecao-est
        │
        ▼ igual ao 6: trava (026 § 2.7) + projeção (026 § 5) + payload v2, `granularidade: "zona"`
```

A leitura do interruptor continua acontecendo duas vezes, de propósito (ciclo e render, ADR-0063 D4).
Python **não** lê o Edge Config; o nome do campo do POST fica `projecao_dep` (é "a projeção de
deputado do cargo deste POST"), e o log `dep_projecao` ganha `cargo`.

## 2. Nomes por cargo — fixados no ADR-0066

| | Federal (6, inalterado) | Estadual (7) | Distrital (8) |
|---|---|---|---|
| slug / rota | `deputado-federal` | `deputado-estadual` | `deputado-distrital` |
| rótulo | Deputado Federal | Deputado Estadual | Deputado Distrital |
| token (ADR-0012) | `dep` | `est` | `dis` |
| UFs (`ufsDoCargo`) | 27 | 26 (sem DF) | `["DF"]` |
| chave nacional | `projection-current-dep-t1` | `projection-current-est-t1` | `projection-current-dis-t1` |
| Blob da UF | `deputado/uf/<UF>.json` | `deputado-estadual/uf/<UF>.json` | `deputado-distrital/uf/DF.json` |
| Blob da lista 61+ | `deputado/uf-lista/<UF>.json` | `deputado-estadual/uf-lista/<UF>.json` | — (DF: até 25 por agremiação) |
| rota da lista | `/uf/[sigla]/deputado-federal/lista` | `/uf/[sigla]/deputado-estadual/lista` | — |
| interruptor | `interruptor-projecao-dep` | `interruptor-projecao-est` | ← o mesmo do 7 |
| total fixo | 513 | 1.035 | 24 (capa: 1.059) |
| cadastro (`candidatos/uf/<UF>/<token>.json`) | `dep.json` | `est.json` | `dis.json` |
| casa (RF-284) | Câmara dos Deputados | Assembleia Legislativa de/do/da {UF} | Câmara Legislativa do Distrito Federal |

Regras:

- **Tudo deriva de `CARGOS`.** Construtores de chave e de caminho recebem o cargo e leem o token/slug da
  tabela; nenhum `cargo === 7 ? … : …` e nenhum `??` perto de cargo (a regra de bordo do "default
  silencioso em conversor de enum", que já mandou payload de Senador para a chave do Presidente).
- **O federal não muda de nome.** `deputadoUfBlobPathname("SP")` continua devolvendo
  `deputado/uf/SP.json`; o construtor novo recebe o cargo e, para o 6, devolve o caminho de hoje. Um
  teste fixa os três caminhos do 6 **literalmente**.
- **Prefixos não se engolem.** `deputado/` não é prefixo de `deputado-estadual/` (a barra conta), e
  `…/uf/` não é prefixo de `…/uf-lista/` — o mesmo raciocínio de `paths.ts:217-231`.
- **Validação de sigla por cargo.** Os construtores de caminho e a rota da lista conferem a sigla contra
  `ufsDoCargo(cargo)`, não contra as 27: `deputadoUfBlobPathname(7, "DF")` lança;
  `/uf/DF/deputado-estadual/lista` é 404.
- **Chave válida pelo ADR-0012** (`^[A-Za-z0-9_-]+$`): as três novas passam por
  `assertValidGlobalConfigKey`, como a do federal (`keys.ts:262`).

### 2.1 A tabela `CARGOS` — o que entra (frente T)

```ts
export type CargoTse = 1 | 3 | 5 | 6 | 7 | 8;
export type CargoProporcional = 6 | 7 | 8;          // derivado por tipo de `proporcional: true`

interface CargoInfo {
  // … campos de hoje …
  /** UFs em que o cargo existe. Obrigatório, sem default (ADR-0044: um cargo sem UFs declaradas é
   *  erro de compilação). 7: as 26 sem DF; 8: ["DF"]; demais: as 27. */
  readonly ufs: readonly Uf[];
  /** Faixa de rps compartilhada (ADR-0067). Cargos na mesma faixa nunca rodam juntos (§ 5.3);
   *  `piorCasoAgregadoRps()` soma o `rpsMax` de cada faixa UMA vez. Ausente ⇒ faixa própria. */
  readonly faixaRps?: "deputado-zona";
}
```

| cd | slug | token | granularidade F1 → F2 | rpsMax F1 → F2 | faixa F2 |
|---|---|---|---|---|---|
| 7 | `deputado-estadual` | `est` | `uf` → `zona` (6 fatias) | 1 → 5 | `deputado-zona` (com o 6) |
| 8 | `deputado-distrital` | `dis` | `uf` → `zona` (sem fatia) | 1 → 1 | própria |

`lib/config/calendar.ts:52` (`Cargo = "pres" | "gov" | "sen" | "dep"`) ganha `"est" | "dis"`, e o
compilador aponta o resto (`lib/config/dado-freshness.ts:77`, `app/sobre-as-etiquetas/page.tsx:152`,
qualquer `Record<CargoTse, …>`). Espelho em `api/model/cargos.py`, travado por `test_cargos_sync.py`.

## 3. Contrato — o que muda por cargo

### 3.1 Campos que passam a variar com o cargo (sem campo novo)

| Onde | Hoje | Passa a |
|---|---|---|
| `EdgePayloadDeputado.cargo` (`types.ts:2052`) | `6` | `CargoProporcional` — discriminante |
| `DeputadoUfDetail.cargo`, `DeputadoUfLista.cargo` (`deputado-uf.ts:200,805`; `writer.ts:1384`) | `6` | `CargoProporcional` |
| `bancada.total_cadeiras` | 513 | o total fixo do cargo (RF-280) |
| `bancada.ufs_calculadas + ufs_aguardando` | 27 | `ufsDoCargo(cargo).length` |
| `pct_apurado_total`, `ufs_apuradas` | sobre 27 UFs | sobre as UFs do cargo |
| `atualizacao_min` | `ATUALIZACAO_MIN_DEPUTADO` (30) | `CADENCIA_SEGUNDOS[cargo] / 60` (§ 4) |
| textos de alerta e de log (`project.py:8168, :8512`) | "Deputado Federal" | rótulo do cargo |
| rota de escrita (`deputadoBodySchema`, `route.ts:342`) | `cargo: z.literal(6)` | união dos proporcionais, derivada da tabela |

`contrato` continua `2`: tudo é aditivo e um leitor v2 da 026 lê um objeto de 7/8 sem mudança de forma.

### 3.2 Dois acréscimos aditivos ao v2 (combinar com P e U antes de implementar)

```ts
interface DeputadoUfDetailV2 /* design 026 § 2.4 */ {
  /** Como o ciclo leu ESTE cargo: `"uf"` (resumo) ou `"zona"`. Presente em todo objeto produzido
   *  depois da 027, para 6, 7 e 8. Ausente (objeto antigo) ⇒ a tela não afirma granularidade. */
  granularidade?: "uf" | "zona";
  /** AUSENTE em modo resumo (a projeção não é calculada — RF-285). Com `granularidade: "zona"`,
   *  presente como na 026. */
  projecao?: DeputadoProjecaoUf;
}

interface DeputadoConferencia /* design 026 § 2.8 */ {
  /** Comparações que o ciclo NÃO fez e por quê — só em modo resumo, hoje. A frase "não comparado"
   *  da tela sai daqui, nunca da ausência em `comparou` (que também acontece sem agregado). */
  nao_comparou?: Array<{ comparacao: "eleitorado" | "votos_validos"; motivo: "granularidade_uf" }>;
}
```

- `nao_comparou` só lista `votos_validos` quando o agregado tem `tf = "s"` (é quando a comparação
  **seria** feita em zona); `eleitorado` sempre que há agregado.
- O estado da Conferência não muda de regra (026 § 2.8): `diverge` se há divergência; `confere` se
  `algoritmo` foi feita; senão `sem_dado_tse`. Em resumo, `algoritmo` e `eleitos` são comparações reais —
  só dependem do agregado.

### 3.3 Transporte

- Rota de escrita: aceita `cargo ∈ CargoProporcional`; para cada `payloads_uf[UF]`, UF ∉
  `ufsDoCargo(cargo)` ⇒ descarta, log `error` + alerta (`notifySlack`), segue (RF-279). O
  `payload.por_uf[]` com UF de fora é o mesmo defeito e tem o mesmo tratamento.
- Writer: chave nacional e prefixos pelo cargo (§ 2); a ordem "lista 61+ antes do objeto da UF" (026
  § 2.5) vale por cargo.
- Tamanho do corpo: ver § 12 — o do cargo 7 é o maior.

## 4. Fase 1 × Fase 2

| | Fase 1 (resumo) | Fase 2 (zona) |
|---|---|---|
| cargo 7 | 26 resumos, 1 rps, cron a cada 5 min | ~6.091 pares + 26 agregados em 6 fatias, 5 rps, na faixa do 6; volta 60 min |
| cargo 8 | 1 resumo, 1 rps, a cada 5 min | 19 pares + agregado do DF, 1 rps, a cada 5 min, sem fatia |
| cargo 6 | **inalterado**: 6 fatias, volta 30 min | fatias nos minutos 0/10/…/50, volta **60 min** |
| `CADENCIA_SEGUNDOS` 6 / 7 / 8 | 1.800 / 300 / 300 | 3.600 / 3.600 / 300 |
| `atualizacao_min` 6 / 7 / 8 | 30 / 5 / 5 | 60 / 60 / 5 |
| projeção 7/8 | nunca calculada; objeto sem `projecao` | calculada atrás de `interruptor-projecao-est`, publicada desligada |
| Conferência 7/8 | `algoritmo`, `eleitos`; `nao_comparou` para `eleitorado`/`votos_validos` | as quatro, como a 026 |
| % apurado 7/8 | `e.esi / e.te` do resumo | Σ `e.esi` ÷ max(agregado, Σ zonas) (RF-275) |
| faixa de cadeiras 7/8 | ausente (uma unidade por UF — o motivo do ADR-0036) | como o 6 (`cadeiras_ci95` da parcial); a da projeção segue adiada (026 P2.5) |
| pior caso rps | **82** | **81** |
| crons em `vercel.ts` (duas janelas) | 23 | 33 |

A passagem de fase é **só configuração** (tabela `CARGOS`, `vercel.ts`, `CADENCIA_SEGUNDOS` nos dois
lados): o código de ingestão, modelo e tela é o mesmo nas duas fases e lê a granularidade do cargo.
Por isso a Fase 1 é a degradação da Fase 2 sem código a reverter.

⚠️ **`TSE_GRANULARIDADE=zona` na Fase 1** levaria o 7 a ~6.091 alvos a 1 rps numa invocação (≈ 100 min,
muito além do `maxDuration` de 300 s). A variável já é proibida no dia D (`scripts/vigia-armado.ts`);
a rota do 7 recusa zona **sem** fatia (400), como defesa.

## 5. Orçamento de requisições (ADR-0067, emenda o ADR-0036)

### 5.1 A tabela de `lib/config/cargos.ts:155-163`, estendida

Fase 1:

| cargo | alvos | rps | duração do ciclo |
|---|---|---|---|
| Presidente | 6.110 | 25 | ~244 s |
| Governador | 6.110 | 25 | ~244 s |
| Senador | 6.110 | 25 | ~244 s |
| Deputado Federal | 6.110 (+27) | 5 | ~204 s por fatia (÷6) |
| Deputado Estadual | 26 | 1 | ~26 s |
| Deputado Distrital | 1 | 1 | ~1 s |
| **pior caso** | | **82** | |

Fase 2:

| cargo | alvos | rps | duração |
|---|---|---|---|
| Presidente / Governador / Senador | 6.110 cada | 25 cada | ~244 s |
| Deputado Federal ‖ Estadual (faixa) | 6.137 ‖ ~6.117 | 5 (um de cada vez) | ~204 s por fatia |
| Deputado Distrital | 20 | 1 | ~20 s |
| **pior caso** | | **81** | |

O ADR-0036 recusou 85 (rpsMax 10 no 6) por reabrir a margem de 2026-09-11; 81 e 82 ficam abaixo, e o
teto documentado do TSE é 100 por IP (constituição § 1).

### 5.2 `piorCasoAgregadoRps()`

Soma o `rpsMax` **uma vez por faixa**: cargos com o mesmo `faixaRps` contribuem com o maior `rpsMax`
da faixa; cargos sem faixa, com o próprio. Teste fixo: 82 com a tabela da Fase 1, 81 com a da Fase 2.
O teste que fixa 80 hoje (`tests/unit/config/cargos.test.ts:85`) é reescrito, não apagado.

### 5.3 A faixa só é verdade se os crons não colidem

A soma por faixa **pressupõe** que 6 e 7 nunca disparam no mesmo minuto. Isso é propriedade de
`vercel.ts`, não da tabela — daí um teste que lê os crons de `vercel.ts`, expande as expressões para
os 60 minutos de cada janela e exige: no máximo um disparo da faixa por minuto; cada fatia de cada
cargo uma vez por hora. Fatia é ~204 s nominais contra 300 s entre disparos; atraso de cron ou ciclo no
`maxDuration` pode encostar duas fatias por instantes (10 rps, pior caso 86) — o mesmo risco que já
existe hoje entre fatias consecutivas do 6.

### 5.4 Contagem de crons

Hoje: 19 entradas (Presidente 2, Governador 2, Senador 2, fatias do 6 12, heartbeat 1). Cada cargo tem
uma entrada por janela — apuração (`20-23,0-7` UTC) e simulado (`12-20` UTC).

- Fase 1: +2 (7) +2 (8) = **23**.
- Fase 2: as 12 do 6 mudam de expressão sem mudar de número; o 7 passa a 12 (6 fatias × 2 janelas); o
  8 fica com 2 = **33**.

O limite de crons do plano Vercel tem de ser conferido antes (frente T). Se a janela do simulado não
servir mais (Passo 0: simulado do TSE fora do ar), as entradas dela para 7/8 não entram (Fase 1: 21;
Fase 2: 26) — open question 2 da spec.

⚠️ **A hora 20 UTC está nas duas janelas.** `12-20` e `20-23,0-7` incluem as duas a hora 20
(`vercel.ts:121` e `:129`, e as mesmas duas para Senador e fatias do 6), e a janela de produção
`INGEST_WINDOW = "17-04"` inclui 17h de Brasília (`lib/tse/ingest-window.ts:103`). A trava
anti-sobreposição lê `ingest_log` e depois grava `running: true`
(`lib/tse/ingest-handler.ts:507-541`) — não é atômica. **A verificar fora desta spec**: se as duas
entradas disparam no mesmo minuto, a primeira hora da apuração pode ter duas invocações por cargo, e o
pior caso de 81/82 não vale nessa hora. Nas entradas **novas** desta spec, a janela do simulado é
`12-19`, para não repetir o defeito.

## 6. Conferência no modo resumo

Em resumo, "as zonas que lemos" **são** o agregado: comparar o eleitorado ou os votos válidos delas com
o do agregado é comparar o arquivo com ele mesmo — daria "igual" sempre, e a frase seria falsa pela
forma (a spec 026 nasceu, em parte, de uma Conferência que dizia "batem" sem comparar, RF-269).

| Comparação | Em zona (026 § 2.8) | Em resumo |
|---|---|---|
| `eleitorado` | Σ `e.te` das zonas × `e.te` do agregado | **não feita**; entra em `nao_comparou` |
| `algoritmo` | nossa conta sobre os votos do agregado × `carg.qe` / `agr.vag` | **feita** — só depende do agregado |
| `eleitos` (com `tf = "s"`) | eleitos da parcial × `cand.e`, por pessoa | **feita** — a parcial em resumo **é** a conta sobre o agregado |
| `votos_validos` (com `tf = "s"`) | Σ `v.vv` das zonas × `v.vv` do agregado | **não feita**; entra em `nao_comparou` |

Implementação (frente P): quem chama a Conferência em modo resumo passa `eleitorado_lido=None` e
`validos_lidos=None` (`api/model/deputado.py:1098-1140` só compara quando recebe o número) e monta
`nao_comparou`. Tela (frente U-a): cada item de `nao_comparou` vira uma linha "não comparado — este
cargo é lido pelo resumo do estado nesta noite"; a frase de igualdade, quando `confere`, cita só o que
está em `comparou` e o horário do boletim.

## 7. Página da casa (frente U-a)

### 7.1 Um módulo, três páginas finas

- O corpo de `app/(dep)/uf/[sigla]/deputado-federal/page.tsx` (934 linhas hoje) vai para
  `app/(dep)/_pagina-uf-deputado.tsx` com `render(cargo, sigla)` e `metadata(cargo, sigla)`.
- `deputado-federal/page.tsx`, `deputado-estadual/page.tsx` e `deputado-distrital/page.tsx` ficam finos.
  O federal renderiza **igual** ao de hoje — os testes de `tests/unit/pages/deputado-federal.test.tsx`
  continuam passando sem edição (é o portão da extração).
- `generateStaticParams`/validação de sigla por `ufsDoCargo(cargo)`.
- `/uf/DF/deputado-estadual` → `permanentRedirect("/uf/DF/deputado-distrital")`;
  `/uf/XX/deputado-distrital` (XX ≠ DF) → `permanentRedirect("/uf/XX/deputado-estadual")` (open question
  1). Sigla fora das 27 → `notFound()`.
- `app/(dep)/_interruptor.ts::lerInterruptorDaTela` ganha o cargo e lê a chave dele.

### 7.2 Rota da lista

`app/(dep)/uf/[sigla]/deputado-estadual/lista/route.ts`, com o corpo do federal num módulo comum
(`app/(dep)/_rota-lista-deputado.ts`, `GET(cargo, sigla)`), mesmos cabeçalhos e códigos (026 § 8.5;
ADR-0065 D3). Não existe rota para o 8.

### 7.3 Blocos com cargo

- `DeputadoListaAgremiacao` recebe `rotaLista: string | null` (o 8 passa `null` ⇒ nunca há botão
  "mostrar todos") e o cache em memória é chaveado por `` `${slug}:${uf}` `` (hoje só por UF —
  `components/blocks/DeputadoListaAgremiacao.tsx:106` o mapa, `:126` a consulta, `:129` a URL com
  `deputado-federal` fixo): sem isso, SP federal e SP estadual trocariam de lista na mesma aba.
- `DeputadoMaisVotados` (props em `:38`) e `DeputadoPuxadores` (props em `:46`) recebem o cargo para
  textos e links.
- `DeputadoRegras`, `DeputadoConferencia`, `DeputadoMetodologia`: os números já vêm do objeto; o texto
  nomeia a casa (RF-284) em vez de "Câmara".
- Sem projeção no objeto (Fase 1), a linha de estado da projeção no resumo e o bloco "o que está
  movendo" **não renderizam** — a condição é o objeto ter `projecao`, não o cargo.

### 7.4 Nome da casa

`lib/utils/casa-legislativa.ts`:

```ts
export function nomeDaCasa(cargo: CargoProporcional, uf: Uf): string;
// 6 → "Câmara dos Deputados" (a bancada de {UF}); 7 → "Assembleia Legislativa " + prep + nome;
// 8 → "Câmara Legislativa do Distrito Federal"
export function nomeDaUnidade(cargo: CargoProporcional, uf: Uf): "estado" | "distrito";
```

Tabela fechada das 26 UFs com `{ nome, prep: "de" | "do" | "da" }`, sem default (RF-284).

## 8. Capa `/deputado-estadual` (frente U-b)

### 8.1 Fonte de cada bloco

| Bloco | Fonte | Nunca |
|---|---|---|
| enquadramento (1.059, 27 casas) | constantes do cargo (`total_cadeiras` de `est` e `dis`, somados) | a soma das casas presentes |
| frescor | `ts`/`dado_ts`/`atualizacao_min` de **cada** payload | um "atualizado às" único |
| soma por partido ou federação | `est.bancada.por_agremiacao` ⊕ `dis.bancada.por_agremiacao` | Blob de UF |
| mais votados do país | `est.mais_votados` ∪ `dis.mais_votados` | Blob de UF |
| puxadores | `est.puxadores` ∪ `dis.puxadores` | Blob de UF |
| grade das 27 casas | `est.por_uf` (26) + `dis.por_uf` (DF), via `resumosPorUf` movido para `lib/` | Blob de UF |

### 8.2 Uniões — funções puras em `lib/`

- **Mais votados**: os 10 primeiros da união, `(−votos, uf, sqcand)` (026 § 3.3). Como cada lista é o
  top 10 do seu conjunto, o top 10 da união está contido na união dos dois tops — a conta é exata.
- **Puxadores**: os 30 primeiros da união, `(−excedente, −votos, uf, sqcand)` (026 § 3.5), mesmo
  argumento.
- **Soma**: pela **chave nacional estável** da agremiação (conserto da spec 026 em 29/09: partido
  isolado pelo número do partido, `par[0].n`; federação pela composição) — **nunca** por `agr[].n`, que é
  número de registro por cargo×UF (medido em 29/09: zero coincidências entre RR e AP); soma `cadeiras`,
  `cadeiras_indefinidas`, `votos_validos`, `votos_nominais`, `votos_legenda`; `sigla`, `nome`, `tipo` e
  `componentes` do primeiro que tiver o `cod` (`est` antes de `dis`); `sigla_lider` do `est` quando o
  `cod` existe lá (open question 4); `pct_votos` = Σ válidos da agremiação ÷ Σ válidos das 27 casas;
  ordem `(−cadeiras, sigla, chave)`. `total` = 1.059 fixo enquanto faltar casa; com as 27 presentes, Σ `nv`
  (RF-280); `aguardando` = `total` − Σ `cadeiras`, nunca negativo por construção nem mascarado por `max(0, …)`.

### 8.3 O que a capa não mostra

- **Plenário** (`CamaraHemiciclo`) e **Camara2027Panel** — não há plenário de 1.059, e etiquetas estão
  fora (spec § Fora).
- **Faixa de cadeiras**: o intervalo de uma casa não se soma ao de outra; a capa diz, por agremiação,
  quantas das cadeiras somadas são **sobra apertada** (Σ `cadeiras_indefinidas`), que é a incerteza que
  sobrevive à soma.
- **Selo de projeção por UF** só quando o objeto nacional traz `por_uf[].projecao` **e** o interruptor
  `-est` está ligado — na Fase 1, nunca.

### 8.4 `DeputadoBancadaPanel`

O painel de bancada da capa federal está inline em `app/(dep)/deputado-federal/page.tsx:520` (barra
`VoteBar` sem marcador + lista `#bancada-agremiacoes`). Extrair para
`components/blocks/DeputadoBancadaPanel.tsx` com `{ bancada, total, aviso?, titleId }`; a capa federal
passa a usá-lo e continua passando nos testes de hoje sem edição. O `aria-label` da barra diz "soma de
27 casas separadas" na capa estadual.

## 9. Navegação (frente U-b)

- `components/layout/CargoTabs.tsx:130-135`: visível "Deputados"; nome acessível começando por
  "Deputados" (o `<CurrentFlag />` fica depois, como hoje); `href` continua `/deputado-federal`; atual em
  toda rota de deputado (federal, estadual, distrital, capa e UF).
- `components/layout/DeputadoCasaSeletor.tsx` (novo, servidor): `<nav aria-label="Casa legislativa">`
  com dois `<a>`; o atual com `aria-current="page"`. Na UF leva à mesma UF no outro cargo; no DF o
  segundo rótulo é "Distrital". Zero JS.
- `<main data-trilha="dep">` nas páginas de 7/8.
- 320 px medido em navegador servido por `pnpm dev:sim` (memória do projeto: faixa de grade colapsada
  deixa vão que o happy-dom não vê).

## 10. Python (frente P)

- `api/model/cargos.py`: 7 e 8 na tabela (espelho do TS), `TOTAL_CADEIRAS` e `VAGAS_EM_DISPUTA_2026`
  com `7: 1035, 8: 24`, `CADENCIA_SEGUNDOS` por fase (§ 4), `ufs_do_cargo`.
- `api/model/project.py`: `UFS_DA_ELEICAO` (`:7744`; usos em `:8463, :8497, :8528`) → UFs do
  cargo; `%` nacional e `ufs_aguardando` sobre elas; `CARGOS_COM_VOTACAO_UF` (`:4129`) com 7 e 8;
  `atualizacao_min` da cadência do cargo em vez de `ATUALIZACAO_MIN_DEPUTADO` (`:8527`); textos de
  alerta pelo rótulo (`:8168, :8512`); a válvula `zonas_para_o_modelo` (`:2667`) não loga `warn` quando o
  cargo está **configurado** em resumo (o `warn` é para a zona que falta, não para o modo escolhido).
- Projeção: `deputado_projecao.py` já é genérico; o gate novo é "granularidade `uf` ⇒ não calcula",
  **antes** da trava (a trava daria `aguardando/zonas_minimas` para sempre — falso, porque não se resolve
  sozinho).
- `deputado_payload.py`: `cargo`, `granularidade`, `nao_comparou` (§ 3.2, § 6), total fixo e
  `conferir_total_de_cadeiras` por cargo.
- `CARGOS_COM_SERIE_PERSISTIDA` **não** muda (`{1, 3, 5}`).
- Golden (RF-290): `scripts/build-cadeiras-golden.py` recebe `--cargo`; o `513` de `:150` vira o total
  do cargo; teste por casa, com as divergências nomeadas.

## 11. Modo simulado e servidor falso (frente S)

- `data-pipeline/simulacao-gerar.ts::montarDeputado` por cargo (hoje `cargo: 6` em `:3950, :4098,
  :4171, :4269`; validadores de 27 UFs / 513 em `:1036, :5009`), com o tamanho das casas da spec (dado
  de teste); saídas `deputado-estadual*.json` e `deputado-distrital*.json`; `lib/dev/simulacao.ts:382,
  448` lê por cargo. SP estadual com o tamanho real (94 lugares, agremiações com 95 candidatos) para o
  portão de peso medir o pior caso.
- Cobrir no simulado: Fase 1 (`granularidade: "uf"`, sem `projecao`, `nao_comparou`) e Fase 2 (as três
  saídas da trava) — o gerador recebe a fase.
- `scripts/edge-config-falso.ts`: serve `projection-current-est-t1`, `projection-current-dis-t1`,
  `interruptor-projecao-est` e os Blobs dos dois prefixos (RF-289).
- `pnpm sim:full` roda **no terminal do dono** (lê o banco só com `SELECT`) — nunca `pnpm sim` sozinho.

## 12. Peso

| Item | Tamanho |
|---|---|
| linhas no documento de `/uf/SP/deputado-estadual` | até 60 por agremiação — o mesmo teto por agremiação do federal; o que cresce é quantas listas enchem as 60 |
| lista 61+ (`uf-lista`) | SP até 35 linhas por agremiação, MG 18, RJ 11, BA 4 — o federal só tem SP, até 11 |
| POST de escrita do cargo 7 | **estimativa, não medição**: federal ~2–2,5 MB × (11.276 / 7.791 candidaturas registradas ≈ 1,45) ≈ 2,9–3,6 MB — encosta no `warn` de 3,5 MB e fica abaixo do limite de 4,5 MB. Medir no simulado; se passar do `warn`, gravar em lotes (plano) |
| chaves nacionais novas | `est` ≈ a do `dep` (~19 KiB), `dis` pequena; medir o uso do Edge Config antes (aviso em 780 KB) |
| documento de `/uf/SP/deputado-estadual` | **teto próprio medido** (RF-289); o global de 300 KiB não muda |

Nenhum número desta tabela é garantia: o projeto já errou três vezes com amostra média em vez de pior
caso — o portão mede SP com agremiações de 95 candidatos, os nomes mais longos e os acentos.

## 13. Riscos técnicos

| Risco | Mitigação |
|---|---|
| Endereço de arquivo de 7/8 nunca requisitado por nós | Passo 0 com arquivos reais do simulado (se no ar); senão, o primeiro ciclo de 04/10 é vigiado — erro de leitura alerta |
| Pedir URL que não existe (8 fora do DF, 7 no DF) | `ufsDoCargo` em todo construtor, sem default; teste nos quatro construtores (RF-278) |
| SP estadual sobrescrever SP federal no Blob | prefixo por cargo; teste de "não tocou `deputado/uf/SP.json`" (RF-279) |
| Cargo 7 cair no ramo majoritário (`_e_proporcional`) | a função lê a tabela; teste com 7 e 8 |
| Total crescer durante a noite | total fixo 1.035/24/1.059; teste com 2 casas presentes (RF-280) |
| Conferência dizer "confere" do que não comparou | `nao_comparou` do produtor; teste em resumo (RF-285) |
| Faixa de 5 rps com 6 e 7 no mesmo minuto | teste que expande `vercel.ts` (§ 5.3) |
| Hora 20 UTC com duas entradas de cron | a verificar fora desta spec (§ 5.4); entradas novas usam `12-19` |
| Limite de crons do plano Vercel | conferir antes da Fase 1 (§ 5.4) |
| `TSE_CARGOS` em produção sem 7 e 8 | `listIngestTargets` devolve lista **vazia**, sem erro (`lib/tse/targets.ts:674-683`, default `"1,3"` em `:399`): o cron roda e não busca nada. Variável de ambiente só chega a deploy novo (ADR-0063 D4) — incluir 7 e 8 **antes** do congelamento de 04/10; o vigia do ciclo passa a olhar `est` e `dis` e alerta dado parado |
| Corpo de escrita do 7 acima de 3,5 MB | medir; lotes se passar |
| Federal fica mais lento (60 min) | aceito pelo dono; só se a Fase 2 subir |
| DF: eleitorado das zonas vem do simulado (a tabela `eleitorado` não tem o DF — runbook) | a condição de cobertura da trava (026 § 2.7 #6) e a Conferência mostram se não fechar |
| Conflito com a 026 nos mesmos arquivos (`project.py`, `simulacao-gerar.ts`, páginas de deputado) | worktrees a partir da `main` atual; `git log` antes de editar; S da 027 depois da S da 026 |
| Extração do módulo comum quebrar o federal | testes do federal sem edição como portão da extração |

## 14. Degradação

| Resultado dos portões (sex 02/10 18h) | O que sobe |
|---|---|
| Fase 2 verde | tudo; `interruptor-projecao-est` desligada até o dono ver o G2 e ligar |
| Fase 2 não verde, Fase 1 verde | tabela e `vercel.ts` da Fase 1; federal em 30 min; sem projeção de 7/8 |
| Fase 1 não verde | nada de 7/8 sobe; as assembleias entram depois de 05/10 com os arquivos finais do TSE |

## 15. ADRs aplicáveis

- **ADR-0066** — cargos 7/8 como proporcionais: a tabela do § 2, UFs por cargo, totais fixos,
  interruptor único das assembleias.
- **ADR-0067** — orçamento: Fase 1 a 1 rps em resumo; Fase 2 com o 7 na faixa de 5 rps do 6, volta de
  60 min, 8 a 1 rps, pior caso 81; emenda o ADR-0036.
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — a regra de
  cadeiras, a mesma para as assembleias (CE arts. 106–109).
- [ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md) — fatias, trava
  por `(cargo, fatia)`.
- [ADR-0044](../../architecture/adrs/0044-codigo-eleicao-por-cargo.md) — 7/8 na eleição `21272`, campo
  obrigatório.
- [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — total
  fixo, nunca a soma das UFs presentes.
- [ADR-0063](../../architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md),
  [ADR-0064](../../architecture/adrs/0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md),
  [ADR-0065](../../architecture/adrs/0065-listas-proporcionais-em-tres-faixas.md) — valem para 7/8 sem
  mudança de regra.
- [ADR-0012](../../architecture/adrs/0012-edge-config-chaves-nomeadas.md) — chaves nomeadas por token.
