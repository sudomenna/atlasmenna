---
title: Handoff — 2026-09-05, Fase 3 (docs e specs)
description: O que a Fase 3 do plano S07 mudou, o que os gates encontraram, e o que ficou pendente
status: stable
branch: s07/simulado-ready-hero-1t
supersedes_partially: handoff-2026-09-05.md
---

# Handoff — Fase 3 (docs e specs)

> **Leia antes**: [`handoff-2026-09-05.md`](./handoff-2026-09-05.md) (Fases 0/1a/2 — continua válido
> para tudo que é código), [`plano-s07-2026-09-05.md`](./plano-s07-2026-09-05.md) (o plano; **tem
> errata no topo**), [`../reference/tse-2026-leiautes.md`](../reference/tse-2026-leiautes.md)
> (fonte técnica) e [`../architecture/adrs/0020-conformidade-res-23751-2026.md`](../architecture/adrs/0020-conformidade-res-23751-2026.md)
> (a base normativa nova).
>
> Este documento cobre **só a Fase 3**. Nada de código de produto mudou aqui, com três exceções
> pontuais listadas em § 4.

## 1. O que aconteceu

A Fase 3 foi executada por **sete subagents em paralelo**, em três ondas, mais uma onda de gates.
Resultado: ~35 arquivos de documentação reescritos, 1 ADR novo, 13 RFs novos formalizados em EARS,
2 sprints re-baselinadas, 1 spec supersedida.

O problema que a Fase 3 resolveu: a documentação de maio/2026 afirmava quatro coisas falsas —
que existia cadastro obrigatório no TSE, que o EA20 tinha ficado obsoleto, que a resolução de 2026
não fora publicada, e citava três arquivos (`parser-ea20.ts`, `fetcher.ts`, `schema.ts`) que **nunca
existiram no repositório**.

## 2. Fatos verificados contra fonte primária

Confirmados por mim, não só pelos agentes, em `tse_docs/txt/apresentacao-interessados-2026.txt`:

- Norma vigente: **Res. TSE nº 23.751/2026**, divulgação no **Título III, Cap. VI, arts. 264–269**.
- **Não existe cadastro.** As strings `cadastr`, `credenci` e `inscri` têm **zero ocorrências** no
  material oficial do TSE.
- Limites, literais na fonte: *"Máximo de 100 requisições por IP por segundo · Bloqueio de 10 minutos
  (renovado)"*; *"Caso os endereços sejam requisitados de forma incorreta (404), também pode haver
  bloqueio"*; *"Não é possível listar os arquivos"*.
- **EA20 mantido** — sempre foi JSON. A doc de maio confundiu "mudança de leiaute" com "mudança de
  formato de serialização".

## 3. ⚠️ Três afirmações que NÃO se confirmaram — não propagar como fato

Estas vinham do plano aprovado e **não têm respaldo na fonte**. Foram mantidas como postura
conservadora, sempre rotuladas como tal. Quem continuar precisa saber a diferença.

| Afirmação | Situação real | Onde está registrado |
|---|---|---|
| **"art. 265 §2º pede válidos/sub judice/anulados"** | O art. 265 tem apenas **§1º** visível (liberação do resultado de Presidente às 17h); os §§2º–4º pertencem ao **art. 267**. A obrigação de decompor `v.vvc = v.vv + v.van + v.vansj` é requisito de **schema do EA20**, não artigo. | Errata no topo do plano; ADR-0020 § Contexto; `regulatory.md` § 1; `backlog.md` |
| **"304 conta para o limite de requisições"** | **Nada** no material do TSE fala de cache condicional (a única ocorrência de "304" é um código de pleito). Adotado como postura conservadora de dimensionamento. | RF-010.4 (spec 001), com ressalva explícita; risco aberto em `risks.md` |
| **Datas dos simulados (15–17/09, 22–24/09)** | **Não constam dos PDFs.** O slide diz apenas que "a agenda de testes será divulgada no site do TSE". Vêm da pesquisa web de 05/09. | Proveniência registrada em `regulatory.md` e `risks.md` |

**Ação recomendada, barata e de alto retorno**: perguntar as duas primeiras no canal
`30308800.tse.jus.br` (descrição começando em `Resultados - Divulgação`) antes de 15/09. A resposta
sobre o 304 muda diretamente o orçamento de requisições por ciclo.

## 4. Mudanças de código feitas nesta sessão

A Fase 3 é docs-only por desenho. O código mudou por duas razões: **conformidade** (lacunas que os
gates expuseram) e o **item C** (problemas visuais). Nenhuma é feature nova.

### Conformidade

1. **`lib/tse/rate-limiter.ts`** — `TSE_MAX_RPS_CEILING` baixado de **80 → 50**, para cumprir o
   RF-010.3 recém-escrito. Default segue 30. Teste atualizado.
2. **`lib/tse/acompanhamento.ts`** — o User-Agent estava **hardcoded como literal**, duplicando
   `USER_AGENT` de `client.ts`. Quando o contato pendente for preenchido, este caminho ficaria
   silenciosamente desatualizado. Agora importa a constante.
3. **`tests/unit/tse/client.test.ts`** — teste novo fechando a lacuna do **RF-010.4**: assere que uma
   resposta 304 **consome token do rate limiter**. É o comportamento de que todo o orçamento de
   requisições depende; sem o teste, uma "otimização" futura poderia pular o limiter quando há ETag.
4. **`components/blocks/RunoffScenarios.tsx`** e seu teste — anotação de RF corrigida de RF-030.8 para
   **RF-030.9** (ver § 6).

### Item C — problemas visuais (detalhe e medições em § 12)

5. **`components/atoms/bars/ProjectionThermometer.tsx`** — geometria de banda/tick/marcador.
6. **`components/blocks/ProjectionThermometers.tsx`** — grid de `participacao-only`, legenda
   condicional ao variant, copy do "Outros".
7. **`app/sobre-o-modelo/page.tsx`** — migração dos tokens de banda.
8. **`app/page.tsx`** — contraste do `<summary>` de debug (falhava RNF-022).
9. **`app/uf/[sigla]/page.tsx`** + **`tests/unit/components/UFPage.test.tsx`** — fim da trilha
   duplicada. O teste **fixava a duplicação como esperada**, e por isso o auditor não pôde corrigir.
10. **`components/layout/RaceHeader.tsx`** — comentário documentando a decisão.

### Fechamento de lacunas de gate (rodada final)

11. **`app/sobre-o-modelo/page.tsx`** + seu CSS — link do TSE dentro do `<footer>` (constituição § 1,
    MEDIUM do `constitution-guard`) e sublinhado nos links do disclaimer (`link-in-text-block` do axe).
12. **`tests/unit/components/RaceHeader.test.tsx`** (novo, 7 casos) — fecha o RF-063.
13. **`lib/utils/cand-color.ts`** — helper novo `strongForRank()` + **`CandidateRow.tsx`** usa a
    variante `-strong` no avatar. `--color-cand-3` (âmbar) e `-5` (lilás) contra branco ficavam em
    ~3:1, falhando WCAG 1.4.3. Os tokens `-strong` já existiam e não eram usados. `colorForRank` e
    `bandForRank` seguem intocados (ADR-0013).
14. **`tests/unit/tse/no-url-probing.test.ts`** (novo) — fecha o RF-010.5 por varredura de fonte.
15. **`docs/_meta/index.json`** — formatação (o `spec-syncer` deixou uma linha que o biome reprovava;
    era o único erro de lint acima do baseline).

Gates ao fim da sessão: **507 vitest / 68 arquivos / 1 skipped** · **153 pytest** · **typecheck
limpo** · **lint no baseline (5 warnings, zero erros)**. (507 = 493 do baseline + 14 testes novos.)

## 5. Numeração de RF — decisão tomada nesta sessão

O plano mandava formalizar os requisitos novos como **RF-046/047/048**. Esses números **já pertencem
à spec 008** (brushing): `RF-046` hover em linha de tabela destaca mapas, `RF-047` click navega para
drill-down, `RF-048` tooltip flutuante. Renumerar a spec 008 seria pior.

**Decisão: RF-061, RF-062, RF-063** (a faixa 061–069 estava livre; 070+ pertence às specs 014/015).

| RF | Assunto | Spec de origem |
|---|---|---|
| RF-061 | Hero de seis termômetros no 1º turno | 003 |
| RF-062 | Participação e "Outros" na interface | 003 |
| RF-063 | Identidade visual por trilha | 003 |

## 6. RF-030.7 / .8 / .9 — mapeamento escolhido, e por quê

Havia ambiguidade: a leitura ordenada da sprint S05 daria `.7`=P(2T), `.8`=cenários, `.9`=ranking.
O **código dizia outra coisa** — `RF-030.8` aparecia anotado em quatro componentes de *ranking* e em
apenas um de *cenários*; `RF-030.9` não aparecia em lugar nenhum.

**Mapeamento adotado (seguindo o código, 4 anotações contra 1):**

- **RF-030.7** = indicador de probabilidade de 2º turno (`<TwoRoundIndicator />`)
- **RF-030.8** = transparência total / ranking multi-camada, sem collapsible (ADR-0017)
- **RF-030.9** = cenários de 2º turno (`<RunoffScenarios />`)

Consequência já aplicada: `RunoffScenarios.tsx` e seu teste foram retagueados para RF-030.9.
**Se você preferir a leitura ordenada da sprint, a troca é entre `.8` e `.9`** nos textos das specs e
na matriz — o código volta ao que era.

## 7. Os 13 RFs novos

Texto EARS completo vive nas specs. Resumo do mapeamento:

| RF | Spec | Assunto |
|---|---|---|
| RF-010.1 | 001 | integridade do dado oficial (art. 267 §4º) — payload cru, append-only |
| RF-010.2 | 001 | projeção rotulada como conteúdo derivado |
| RF-010.3 | 001 | rate limiter de saída, taxa efetiva ≤ 50 req/s |
| RF-010.4 | 001 | requisição condicional ciente de que 304 consome cota ⚠️ (ver § 3) |
| RF-010.5 | 001 | proibição absoluta de sondar URL adivinhada |
| RF-010.6 | 001 | User-Agent honesto, sem declarar cadastro |
| RF-020.1 | 002 | projeção de participação + "Outros" com IC real |
| RF-030.7/.8/.9 | 003 | P(2T) / transparência total / cenários 2T |
| RF-061/062/063 | 003 | hero 1T / participação na UI / identidade de trilha |

RF-010 e RF-030 passaram a ser requisitos **cabeçalho** — a cobertura vive nos sub-requisitos.

## 8. Estado das specs

| Spec | Status | Observação |
|---|---|---|
| 001 ingestão TSE | `shipped` | RF-010 reescrito em 6 sub-RFs verificáveis; `design.md` corrigido contra o leiaute real |
| **001.1 refactor JSON** | **`superseded`** | premissas todas falsas; nota de superseção no corpo, RFs preservados como registro |
| 002 modelo | `implementing` | RF-020.1 novo; `ship_blocked_on` auditado, **nada removido** — remover bloqueador é ato de gate |
| 003 home nacional | `shipped` | 6 RFs novos |
| 004 / 005 / 006 | `shipped` | só passe de referência; RF-031 corrigido para o texto real do breadcrumb |
| 013 página manutenção | `ready` | ⚠️ ver § 11 |

## 9. Sprints re-baselinadas

- **S07** renomeada: `2026-S07-f6-hardening.md` → **`2026-S07-f6-simulado-hero-1t.md`**.
  "Simulado-ready + Hero 1T", **`status: active`**, **06/09 → 24/09**.
- **S08**: "Estabilização + D-1", `planned`, **25/09 → 03/10**.
- Cadeia final sem buraco: S07 · S08 · **D1 04/10** · S09 05/10→14/10 · S10 15/10→24/10 · **D2 25/10**.

⚠️ **Aperto estrutural**: a S08 termina em **03/10**, o mesmo dia em que o TSE insere os parâmetros
oficiais no data center. `TSE_COD_ELEICAO` real só existe nesse dia — o último item do checklist
pré-prod só fecha na véspera do 1º turno. É do calendário do TSE, não do planejamento.

## 9b. Gates — resultado

| Gate | Veredito |
|---|---|
| `spec-syncer` | ✅ propagou, **com 2 defeitos que corrigi** (ver abaixo) |
| `constitution-guard` | ⚠️ **1 HIGH · 3 MEDIUM** — os 6 pontos do § 1 confirmados por código, um a um |
| `rf-coverage-checker` | ✅ **desbloqueado** — as 3 lacunas que ele apontou foram fechadas |
| `a11y-perf-auditor` | ⚠️ **passa com ressalva** — 6/6 problemas visuais fechados; bundle above-the-fold acima da meta (débito anterior, em investigação) |

### Defeitos do `spec-syncer` que corrigi

1. **RF-061/062/063 ficaram fora da matriz principal** — entraram só na tabela secundária, que não tem
   colunas de componente e teste. Como é a matriz principal que o `rf-coverage-checker` lê, os três
   requisitos novos seriam invisíveis para o gate. Reinseridos com componente e teste reais.
2. **Cobertura inventada** — a matriz declarava "unit (mock MapLibre)" para RF-034/035/036/038, mas
   **nenhum arquivo em `tests/` importa** `ChoroplethMapUF`, `BubbleMap`, `SwingArrowMap`, `UFMapDuo`
   ou `UfMapsLazy`. As quatro linhas foram marcadas como sem cobertura.
3. **RF-020.1 mal mapeado pelo próprio checker** — ele o atribuiu a testes de UI
   (`participacao.test.ts`, `ProjectionThermometers.test.tsx`), que cobrem o **RF-062**. RF-020.1 é
   requisito **do modelo**, coberto por `test_turnout.py` / `test_outros.py` / `test_orchestrator.py`.
   Veredito certo, raciocínio errado; matriz corrigida.

### `constitution-guard` — 1 HIGH, 3 MEDIUM

- **HIGH** — exceção do `/governador` ao ADR-0018. Ver § 13.3. **Bloqueia promover a spec 006.**
- **MEDIUM** — `app/sobre-o-modelo/page.tsx:364`: é a única página que não usa o `<Footer />`
  compartilhado, e o link do TSE fica num `<aside>`, fora do próprio `<footer>`. **Aberto.**
- **MEDIUM** — inversão `--color-pt-band`/`--color-pl-band`. Julgamento do guard: **não é violação de
  neutralidade** (as cores seguem NYT-like genéricas, e o único consumidor usa "Candidato A/B"), mas é
  defeito real — em `sobre-o-modelo:598` a mesma série mistura linha vermelha com banda azul.
  Correção recomendada: **migrar o consumidor** para `--color-band-lean`/`--color-band-likely` em vez
  de inverter os tokens legados, evitando quebrar retrocompat. **Aberto.**
- **MEDIUM** — User-Agent duplicado em `acompanhamento.ts`. ✅ **Fechado nesta sessão.**

### `rf-coverage-checker` — spec 001 é o problema

A spec 001 está `shipped`, mas decompor RF-010 em 6 sub-requisitos verificáveis **expôs duas lacunas
de requisito Must** que o texto antigo (inverificável) escondia:

| RF | Situação |
|---|---|
| RF-010.4 (304 consome cota) | ✅ **Fechado** — `client.test.ts` assere que o 304 consome token do rate limiter. |
| RF-010.5 (proibição de sondar URL) | ✅ **Fechado** — `tests/unit/tse/no-url-probing.test.ts`. |
| RF-063 (`<RaceHeader />`) | ✅ **Fechado** — `tests/unit/components/RaceHeader.test.tsx`, 7 casos. |

**As três lacunas foram fechadas nesta sessão.** A spec 001 deixa de ter Must sem cobertura, então a
decisão que estava pendente (rebaixar para `implementing` vs. aceitar o invariante) **não é mais
necessária**.

Vale registrar de onde as lacunas vieram: elas **não eram regressão**. Decompor RF-010 em seis
sub-requisitos verificáveis *criou* as lacunas, porque o texto antigo ("o status do cadastro é
aprovado") era inverificável e passava no gate por vacuidade. O gate só ficou capaz de reprovar
depois que o requisito ficou honesto.

**Sobre o RF-010.5 especificamente** — o `rf-coverage-checker` o classificou como invariante de
revisão, não de teste, e tinha razão em parte: uma varredura textual não é prova formal (não pega URL
montada em runtime a partir de dado externo). Mas pega o caso real e provável — alguém escrevendo
`fetch("https://resultados.tse.jus.br/algum/palpite.json")` para "só conferir se existe" — e custa
milissegundos. O teste trava a invariante de que o host do TSE só aparece em **duas** constantes de
base URL (`lib/tse/targets.ts:71`, `scripts/tse-watch.ts:58`); toda URL requisitada nasce dos builders
de `targets.ts`. Verifiquei que ele **falha** quando um literal novo é introduzido, nomeando o arquivo
infrator — teste que não sabe falhar não vale nada.

## 10. Monitoramento do TSE — estado de hoje (05/09)

`pnpm tse:watch --once` **rodou hoje**, 07:45 UTC:

```
changed=false  exitCode=0  state=build/tse-watch/state.json
[ele-c.json] ciclo=ele2024  dg=17/06/2026  hg=17:36:58  (47 eleições)
9 leiautes: last-modified 08/07/2026 (EA20: 10/07/2026 18:46 GMT)
```

- **`ele-c.json` de produção ainda está em `ciclo=ele2024`** — não há eleição geral 2026 publicada;
  o ambiente de simulado **não foi ativado**. É esse o sinal que estamos esperando: o script destaca
  em maiúsculas quando surgir.
- Esta foi a **primeira execução** — todos os alvos registraram "estado inicial". A partir de
  **06/09** as comparações passam a ser significativas.
- Nenhum leiaute mudou desde a coleta dos PDFs.
- **`scripts/tse-watch.targets.json` já está preenchido** com as 9 URLs oficiais. O handoff anterior
  listava isso como pendência humana #1 — **está resolvida**.

**Rodar diariamente.** Se nada surgir até **12/09**, abrir chamado em `30308800.tse.jus.br` com a
descrição começando em `Resultados - Divulgação`.

## 11. Achados que contradizem registros anteriores

1. **A S06 registrou como entregue o que não existe.** `MaintenancePageMessage` e
   `TurnoTransitionBanner` estavam no catálogo como "✅ shipped S06". **Não existe arquivo nenhum**;
   `app/manutencao/` só tem `.gitkeep` de 17/05 e a spec 013 segue `status: ready`. Vale reabrir na
   retro da S06.
2. **O catálogo de componentes tinha 8 fantasmas e 5 caminhos errados**, não os "5 e 2" que o handoff
   anterior estimava. Também faltavam **9 componentes que existem e nunca foram catalogados**.
3. **`TSE_EA15_PATH_TEMPLATE` não existe no código.** O handoff anterior a listava como variável de
   ambiente nova. `detectChangedUfs` busca **só o EA14** — que é o desenho correto para
   `TSE_GRANULARIDADE=uf`. `EA15Schema` e `buildEA15Url` existem **sem consumidor**.
4. **`api/model/project.py` já foi corrigido** para o envelope EA20 real (commit `67c1014`). O alerta
   "achado crítico downstream" em `tse-2026-leiautes.md` § 2 estava obsoleto e disparava alarme falso
   a cada leitura — marcado como resolvido.
5. **Nenhum teste importa componente de mapa.** A matriz de traceability declarava
   "unit (mock MapLibre)" para RF-034/035/036/038 — cobertura inventada. RF-034 já corrigido.

## 12. Os 6 problemas visuais (item C) — **todos fechados**

O `a11y-perf-auditor` mediu cada um com Playwright em 375px, em vez de julgar a olho.

| # | Problema | Situação |
|---|---|---|
| 1 | Faixa de incerteza ilegível com \|projetado−apurado\| < 1pp | ✅ **corrigido** |
| 2 | `/uf/*` mostra a trilha duas vezes | ✅ **corrigido** |
| 3 | "Outros · 0 candidatos · IC indisponível" com 10,3% | ✅ **corrigido** |
| 4 | Legenda do denominador cita categoria ausente | ✅ **corrigido** |
| 5 | `/governador`: coluna vazia no grid | ✅ **corrigido** |
| 6 | `/sobre-o-modelo` usa tokens de banda partidários | ✅ **corrigido** |

**#1 — a medição.** Em `/uf/SP`, candidato PT com projetado 43,2% e apurado 43,5% (0,3pp), a 375px:
banda 18,64px, tick 2px, losango 11,3px — os três **centrados na mesma posição vertical**, span de
~19px. Contraste tick-sobre-banda medido: **3,19:1**, no limite de WCAG 1.4.11 (piso 3:1 para
não-texto) — frágil demais para carregar a distinção sozinho. Correção: o marcador do apurado saiu do
trilho para uma faixa própria abaixo dele, então a distinção passou a ser **forma e posição**, não
cor; tick ganhou halo; guarda de largura mínima para ICs patológicos (ativa em <2% da escala). Após o
fix, banda/tick em y=333,5–347,5 e marcador em y=354,8–366,2 — gap de ~7,3px, zero sobreposição.

**#2 — resolvido nesta sessão, e por que estava travado.** O auditor não pôde corrigir porque
`tests/unit/components/UFPage.test.tsx` **fixava a duplicação como comportamento esperado**
(`toBe("PRESIDÊNCIA · Brasil › SP")`) e ele só podia editar `app/` e `components/`. Apliquei
`crumbs={[]}` na página presidencial e atualizei o teste: o kicker fica só com o rótulo da trilha
(RF-063) e a profundidade é do breadcrumb, que tem links reais (RF-031). A trilha de governador
**não** tem o problema — os rótulos diferem ("GOVERNADOR · SP" vs. "Governadores › SP").

**#3 — a causa raiz vale registrar.** `outrosFallback = 100 − Σtop3` inclui anulados e sub judice, que
entram no denominador `votaveis` (o `pvap` do TSE) mas não pertencem a candidato nenhum. Quando não há
candidato adicional conhecido, a copy afirmava "0 candidatos" ao lado de um número positivo. Agora,
com `outrosN === 0` e `outrosPct > 0,05`, o subtítulo vira "resíduo do total (anulados/sub judice)".

**#6 — decisão tomada.** Os tokens legados `--color-pt-band`/`--color-pl-band` **continuam invertidos
em `app/globals.css:22-23`** — de propósito. Corrigi-los quebraria consumidores não descobertos; em
vez disso migramos os 6 usos de `/sobre-o-modelo`: swatches Lean/Likely → `--color-band-lean`/
`--color-band-likely` (neutros); banda de confiança e arcos do needle → `--color-cand-band-1/2`,
espelhando o que o `<Needle />` real usa. **A inversão segue lá, sem consumidor.** Quem for mexer nela
precisa saber que `tailwind.config.ts:38,42` tem o par correto e o CSS não.

### a11y — achados pré-existentes, não introduzidos pelo hero

axe-core 4.9.1 nas 5 rotas. Um achado novo foi corrigido (`app/page.tsx:314`, `<summary>` de debug com
`--color-text-faint` a ~2,85:1, falhando RNF-022). Os demais **precedem a S07** e seguem abertos:

- `/uf/SP` e `/uf/SP/governador`: contraste do avatar de iniciais em `CandidateRow.tsx:76-80` — texto
  branco sobre `--color-cand-3`/`-5` (âmbar/lilás). **Este é exatamente o watch item que
  `globals.css:41-48` já previa**; os tokens `-strong` existem e não são usados aqui. Fix barato.
- `/uf/SP` e `/uf/SP/governador`: `landmark-unique` em `canvas[width="608"]` (mapa).
- `/governador`: contraste em 20 nós de `GovernorCard` + `nested-interactive` em
  `HexCartogramBrasil.tsx:56`.
- `/sobre-o-modelo`: `link-in-text-block` — link do TSE distinguível só por cor.

O `role="meter"` do termômetro passa: `aria-valuemin/max/now` e `aria-label` completo, verificado no
texto gerado ("Candidato PT: 43,2% dos votos a votáveis, projetado; intervalo de 41,8% a 44,6%;
apurado 43,5%"). Accents de trilha acima de 7:1 (pres 12,2:1, gov 9,7:1) — medido indiretamente pela
ausência de violação axe, não recalculado hex a hex.

**Não verificados por falta de orçamento**: passe de teclado dedicado, fallback de tabela
(constituição § 4), Lighthouse real, RNF-008 (tempo de render do mapa).

### Bundle — o hero não custou um byte

Medido com `pnpm build` + `next start`, somando o gzip de todos os chunks referenciados no HTML de `/`:

| Métrica | Valor |
|---|---|
| Above-the-fold `/` hoje | **191,6 KB gz** (9 chunks) |
| Above-the-fold `/` **antes do hero** (`67c1014`, worktree isolado, build limpo) | **191,6 KB gz — byte a byte idêntico** |
| Chunk lazy do MapLibre | **281,05 KiB gz** (RNF-007b: < 250KB) |

Os 4 componentes novos são Server Components puros — sem `"use client"`, sem `framer-motion`
(confirmado por grep do pragma real, não da docstring). O hero **não mudou o bundle above-the-fold**.

✅ **A discrepância foi resolvida — era artefato de medição, não regressão de código.**

A soma de "todo `<script src>` do HTML" inclui um chunk que o Next emite com o atributo **`nomodule`**:
**39.373 bytes gz**, byte a byte idêntico a `next/dist/build/polyfills/polyfill-nomodule.js`
(verifiquei o arquivo: 112.594 raw / 39.373 gz, bate exatamente). Qualquer navegador que entenda
`<script type="module">` **ignora esse arquivo e nem faz o request** — ele não custa nada a usuário
real nenhum, mas entra na conta.

Descontado, o custo real above-the-fold é de **~148,7 KiB em 8 requests** — **dentro** da meta de
150KB, com o veredito dependendo de arredondamento (KB decimal vs. KiB) e do nível de compressão do
medidor. Não estávamos 42KB acima; estávamos na linha.

**A medição da S05 tinha o mesmo defeito**, e isso reconcilia boa parte da conta: os "168KB" eram
`71 + 40 + 39 + 18`, e aquele bucket de **40KB** é este mesmo polyfill. Resta uma diferença de ~18KB
nos buckets de router/RSC entre a S05 e hoje — provavelmente versão do Next, não investigado por não
ser prioridade.

Nenhum dos chunks contém `framer-motion`, `zustand`, `swr`, `zod`, `maplibre` ou `d3-*`: o código do
app não vazou para o above-the-fold, o que resta é overhead de framework.

**A ação é consertar a régua, não o código.** Antes de RNF-007a virar gate de CI, a medição precisa
filtrar `noModule` — de preferência capturando requests reais via Playwright, que já aplica a
semântica de `nomodule` e elimina a classe de erro sem depender de regex de HTML. Receita em
[`../nfr/performance.md`](../nfr/performance.md). E **não** perseguir `browserslist` para cortar
polyfills legados: como o chunk nunca é baixado, removê-lo não melhora LCP nem INP.

LCP medido em localhost ficou em 24–40ms e **não serve** como proxy de RNF-002 (p95 global < 2,5s) —
só Vercel Speed Insights em produção valida isso.

## 12b. ⚠️ Depois deste handoff: o modelo está sendo reescrito (Fase 3b)

Ao ler o resumo da sprint, o usuário rejeitou o método de projeção dos candidatos — *"eu não
quero estimar pelo que aconteceu em 2022"* — e pediu **regra de três por localidade**. Plano
aprovado em [`plano-modelo-regra-de-tres-2026-09-05.md`](./plano-modelo-regra-de-tres-2026-09-05.md);
**leia-o antes de tocar em `api/model/`**. Quatro agentes foram despachados em paralelo no fim
desta sessão (`model-validator`, `adr-author`, `spec-implementer`, `tse-parser-builder`); o estado
do trabalho deles está no `git status`, não neste documento.

Três fatos que mudam a leitura das seções acima:

- **O OT-4 "PASS" (0,998pp) registrado em § 4 e no handoff anterior era tautológico.** O dataset
  de replay foi construído a partir do próprio 2022 (`build-replay-fixtures.ts:11,273`), logo
  swing ≡ 0 e projeção = gabarito. Não é evidência de nada. Fica suspenso até regeneração.
- **Com `TSE_GRANULARIDADE=uf` (default atual) o modelo está quebrado**: `eleitorado` não tem linha
  `(uf, 0)` → peso 0 → candidatos mostram 2022 ± 10pp como projeção, participação `None`. Ninguém
  viu porque em dev as páginas usam fixture. Decisão E4: **zona**.
- A constituição vai a **1.2** (§ 8 deixa de nomear "swing"), o ADR-0015 (K-1) fica `superseded`
  pelo **ADR-0021**, e os 4 gates da § 9b **precisam rodar de novo** ao fim da Fase 3b.

## 13. Decisões humanas pendentes

Ordenadas por prazo.

### 13.1 Texto de contato do User-Agent — **bloqueante antes de 15/09**
`lib/tse/client.ts:60` tem `AtlasMenna/1.0 (+https://atlasmenna.online; contato: pendente)`. O ADR-0020
fixa o **formato** e proíbe declarar cadastro; o **texto** (URL ou e-mail público) é decisão sua.
Depois de decidir, basta editar `client.ts` — `acompanhamento.ts` já importa a constante.

### 13.2 Spec 012 (`/_status`) ficou fora da S08
Não consta da Fase 7 do plano, e 9 dias não comportam 009 + 010 + 013 + load test + checklist +
bug bash. **É perda real, não faxina**: o dashboard vale sobretudo *durante* a noite do 1º turno, então
diferi-lo para depois do dia D esvazia o propósito. Sem ele, a operação de 04/10 depende de logs da
Vercel + alertas Slack da spec 010. Três alternativas ficaram escritas na S08:
(a) aceitar; (b) versão mínima read-only, sem os botões "Pausar Cron"/"Forçar refresh", como stretch;
(c) trocar 009 por 012.

### 13.3 Exceção do `/governador` ao ADR-0018 — **bloqueia promover a spec 006**
`app/governador/page.tsx:203` renderiza o bloco de participação **só quando** `national.participacao`
existe. O ADR-0018 fecha essa porta textualmente: *"inclusive para os termômetros de participação que
ainda não têm dado disponível (renderizam em estado 'aguardando projeção', **nunca omitidos do DOM**)"*.
A spec 006 abriu exceção citando apenas o ADR-0017, mais genérico.

Pela hierarquia do projeto (constituição > ADR > spec), isto é sinal de parada. O `constitution-guard`
considerou a **justificativa de produto razoável** — não existe corrida nacional de governador, então
"aguardando" seria promessa falsa de uma projeção que nunca virá — mas ela precisa estar num ADR, não
num comentário de código. Duas saídas: **(a)** ADR curto qualificando a cláusula do ADR-0018 para
corridas sem abrangência nacional; **(b)** reverter e sempre renderizar em "aguardando projeção".

### 13.4 Orçamento de ciclo em produção — decidir **após medir no simulado 1**
`maxDuration=180` + lock anti-overlap vs. gating por EA14. Com granularidade `uf` o ciclo caiu para
~55 GETs, então deixou de ser aperto de throughput — mas **o modelo ainda precisa de granularidade de
zona** para o swing vs. 2022 (RF-011/012). Desenho recomendado: híbrido (UF/BR para as telas, zona só
nas UFs que o EA14 sinalizar). Não decidir antes de medir.

### 13.5 Mapeamento RF-030.8 ↔ RF-030.9
Ver § 6. Adotei a leitura do código; se preferir a da sprint S05, é uma troca entre os dois.

## 14. Onde continuar

1. **Diariamente**: `pnpm tse:watch --once`. Chamado no TSE se nada até 12/09.
2. **Decidir 13.1 e 13.3** — são as duas que travam coisas (contato do UA bloqueia o simulado;
   exceção do `/governador` bloqueia a spec 006).
3. **Perguntar ao TSE** sobre o 304 e sobre a agenda dos simulados (§ 3) — barato, alto retorno.
4. ~~Fechar o MEDIUM que sobrou~~ — **fechado**: o link do TSE entrou no `<footer>` de
   `/sobre-o-modelo`, e o `link-in-text-block` do axe na mesma página também.
5. ~~Lacunas de teste baratas~~ — **as três foram fechadas** (`<RaceHeader />`, avatar de
   `CandidateRow`, varredura do RF-010.5). Restam os achados de a11y pré-existentes de § 12:
   `landmark-unique` no canvas do mapa e `nested-interactive` em `HexCartogramBrasil.tsx:56`.
6. **Fase 4** (protocolo do simulado, 15/09) — passos em `docs/testing/tse-simulados.md`.

## 15. Regras que continuam invioláveis

- **Nunca sondar URL adivinhada** contra `resultados.tse.jus.br` ou `resultados-sim.tse.jus.br` —
  404 malformado pode bloquear o IP por 10 min e o limiar não é divulgado. Use
  `scripts/tse-mock-server.ts` (`pnpm tse:mock --port 8787`) para qualquer teste de ingestão.
- Nunca rodar fan-out completo fora das janelas de simulado ou sem `TSE_MAX_RPS`.
- Não alterar o conteúdo dos dados do TSE (art. 267 §4º).
- Não editar `docs/PRD.md` (snapshot read-only).
- Não mexer em `--color-cand-*`, `colorForRank`, `bandForRank` (ADR-0013).
- Não alterar o layout `binary` (2º turno).
- Não usar `framer-motion` no hero (RNF-007a).
- Não voltar o envelope EA20 para `.strict()` — o TSE não congela leiaute.
- **Não elevar `TSE_MAX_RPS_CEILING` acima de 50** sem revisar RF-010.3 e o ADR-0020.

## 16. Comandos

```bash
set -a; . ./.env.local; set +a     # 8 arquivos de teste dependem do Neon
pnpm test                          # 507 vitest / 68 arquivos / 1 skipped
.venv-model/bin/python -m pytest -q # 153
pnpm typecheck
pnpm tse:watch --once              # monitor diário do ele-c.json + 9 leiautes
pnpm tse:mock --port 8787          # CDN falso
rm -rf .next                       # SEMPRE antes de gate visual
```
