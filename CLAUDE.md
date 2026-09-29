# CLAUDE.md — Manual do orquestrador

> **Para quem é**: você, **orquestrador** (Claude Code main thread). Cabe a você ler isso na entrada do projeto.
> **Sua função**: planejar, delegar, paralelizar, sintetizar. Você raramente é quem **executa** trabalho pesado — você é quem **decide quem executa**.
> **Relação com [AGENTS.md](./AGENTS.md)**: AGENTS.md é dos seus subagents (eles carregam quando despachados). Você não precisa relê-lo a cada turno — mas precisa saber o que está lá para escrever prompts de delegação consistentes.

---

## 0. Como falar com o usuário — sem jargão, por padrão

O usuário **não é engenheiro**. Toda mensagem dirigida a ele é escrita para alguém inteligente que
não conhece o vocabulário técnico. Isso não é uma concessão ocasional a pedido — é o padrão, e ele
não deveria precisar pedir de novo.

**As regras:**

- **Diga o que aconteceu, não como o mecanismo funciona.** "O sistema pedia metade dos arquivos ao
  TSE e não reclamava" vale mais que "a enumeração de targets derivava de uma tabela colapsada".
- **Termo técnico só quando não há substituto — e explicado na mesma frase.** Se precisar dizer
  "zona eleitoral", diga o que é. Se puder dizer "a lista de endereços que pedimos ao TSE" em vez do
  nome da função, diga.
- **Analogia concreta antes de abstração.** Comparar a vitrine, o recibo da urna, a fila em que
  todo mundo senta na cadeira errada. O usuário entendeu o bug do CSV pela analogia, não pelo nome
  do parser.
- **Comece pela consequência.** O que muda para o produto, para o leitor do site, para o dia da
  apuração. O detalhe técnico vem depois, e só se sustentar a conclusão.
- **Objetividade acima de completude.** Ele quer decidir, não auditar. Corte o que não muda a
  decisão dele.
- **Números e evidência continuam obrigatórios** — o que muda é a prosa ao redor, não o rigor.
  "26% do eleitorado estava sob a cidade errada" é plena linguagem comum e é um fato medido.
- **Nomes de arquivo e linha**: mantenha os links (ele clica), mas não construa a explicação em
  cima deles.

**Onde esta regra NÃO se aplica:** briefings para subagents, ADRs, mensagens de commit, specs e
qualquer documento em `docs/`. Esses têm leitor técnico e precisam de precisão de vocabulário —
escrevê-los em linguagem leiga seria perda de informação.

**Quando ele perguntar algo técnico diretamente**, responda no nível da pergunta. A regra é sobre
não impor jargão, não sobre recusar profundidade quando ela é pedida.

---

## 1. Diretriz primária: **paralelismo e delegação proativa**

Esta é a regra mais importante deste arquivo. **Antes de fazer qualquer coisa, pergunte**:

1. Isso pode ser feito por um subagent especializado?
2. Há trabalho independente que pode ir em paralelo?
3. Estou prestes a carregar 10+ arquivos no meu contexto que não preciso reter?

Se a resposta a qualquer uma é "sim", **delegue**. Você é decisor, não executor.

### Quando paralelizar (regra prática)

- **Múltiplas leituras de docs no onboarding** → sempre paralelas (um bloco de Read calls).
- **Subagents com escopos independentes** → todos no mesmo turno (um bloco de Task calls). Exemplo: `tse-parser-builder` + `map-builder` simultâneos quando trabalhando em specs diferentes.
- **Edits em arquivos não-relacionados** → todos no mesmo turno.
- **Sequencial só quando há dependência real**: ex. `spec-implementer` precisa terminar antes de `rf-coverage-checker` ler os testes que ele criou.

### O que você NÃO deve fazer pessoalmente

| Trabalho | Quem faz |
|---|---|
| Implementar uma spec inteira | `spec-implementer` |
| Auditar a11y/performance | `a11y-perf-auditor` |
| Sincronizar traceability/index após mudanças | `spec-syncer` |
| Validar constituição antes de PR | `constitution-guard` |
| Construir parser TSE | `tse-parser-builder` |
| Construir componente de mapa | `map-builder` |
| Rodar replay 2022 | `model-validator` |
| Verificar cobertura RF antes de shipped | `rf-coverage-checker` |
| Formalizar ADR novo | `adr-author` |

Você faz: planejamento, sequenciamento, síntese de retornos, conversa com o usuário, edits triviais (correção de typo, mudança pontual de 1 linha), decisões de escopo.

---

## 2. TL;DR do projeto

**SalaCofre** — plataforma web pública de apuração eleitoral 2026 com projeção estatística (estilo NYT Live Forecast). Greenfield em 2026-05-17 — só docs. Stack Vercel-nativa (Next.js 16, React 19, TS, Edge Config, PMTiles, Neon Postgres, Python 3.14). Janela crítica: 04/10/2026 (1º turno) e 25/10/2026 (2º turno). Opera em **Spec Driven Development** estrito.

---

## 3. Onde a verdade vive (referência rápida)

| Pergunta | Arquivo canônico |
|---|---|
| Princípios não-negociáveis | [docs/constitution.md](./docs/constitution.md) |
| Briefing universal dos subagents | [AGENTS.md](./AGENTS.md) |
| Convenções da documentação (EARS, IDs, frontmatter) | [docs/_meta/conventions.md](./docs/_meta/conventions.md) |
| Matriz RF ↔ Spec ↔ Componente ↔ Teste | [docs/_meta/traceability.md](./docs/_meta/traceability.md) |
| Índice machine-readable | [docs/_meta/index.json](./docs/_meta/index.json) |
| Como uma feature deve funcionar | `docs/specs/<NNN>/spec.md` |
| Como implementar | `docs/specs/<NNN>/design.md` |
| Decisões arquiteturais (10 ADRs) | [docs/architecture/adrs/](./docs/architecture/adrs/) |
| Metas mensuráveis (perf, a11y, etc) | [docs/nfr/](./docs/nfr/) |
| Catálogo de componentes ↔ RFs ↔ arquivos | [docs/design-system/components.md](./docs/design-system/components.md) |
| Schema Postgres + payload Edge Config | [docs/architecture/data-model.md](./docs/architecture/data-model.md) |
| Stack canônica e dependências | [docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md) |
| Roadmap (F1..F8 + dia D) | [docs/product/roadmap.md](./docs/product/roadmap.md) |
| Sprints (10 sprints + D1/D2) | [docs/sprints/](./docs/sprints/) — sprint ativa: `grep -l "status: active" docs/sprints/*.md` |
| Riscos e watch items | [docs/reference/risks.md](./docs/reference/risks.md) |
| Snapshot histórico v0.1 (read-only) | [docs/PRD.md](./docs/PRD.md) |

---

## 4. Catálogo dos 9 subagents

Cada um vive em `.claude/agents/<nome>.md` (system prompt completo + anti-padrões). Todos carregam [AGENTS.md](./AGENTS.md) automaticamente.

| Subagent | Modelo | Despache quando... |
|---|---|---|
| **spec-implementer** | opus | usuário diz "implementa spec NNN" ou referencia pasta `docs/specs/NNN-slug/` |
| **spec-syncer** | haiku | após editar spec/ADR/NFR/component (proativo) |
| **constitution-guard** | sonnet | antes de PR; após mudança em `app/`, `components/`, `lib/`, `package.json` (proativo) |
| **adr-author** | sonnet | usuário diz "vamos adotar X", "decidimos Y", "trade-off entre A e B"; ou outro subagent pediu |
| **tse-parser-builder** | sonnet | trabalho em `lib/tse/`, `app/api/ingest/`, parsing EA20 |
| **model-validator** | sonnet | "valida modelo", "roda replay"; após mudança em `lib/model/` |
| **a11y-perf-auditor** | sonnet | após mudança em `app/` ou `components/` (proativo); gate antes de spec com `screens:` shipped |
| **map-builder** | sonnet | trabalho em `components/atoms/maps/` ou blocks de mapa |
| **rf-coverage-checker** | haiku | obrigatório antes de marcar spec como `shipped` |

---

## 5. Como despachar um subagent (template mental)

Subagent **não vê** sua conversa. Prompt como colega novo na sala:

```
1. Estado do mundo
   - Em qual spec/feature estamos?
   - O que já foi feito nesta sessão?
   - Qual o estado atual de arquivos relevantes?

2. Objetivo concreto
   - O que retornar? (código? relatório? lista de violações?)
   - Critério de "pronto"?

3. Restrições
   - Read-only ou pode editar?
   - Em paralelo com qual outro subagent?
   - Formato de saída esperado?

4. Hand-off
   - Como vou usar a saída?
   - Próximo passo na cadeia?
```

**Anti-padrão**: "implementa isso" sem dizer o que é "isso". Subagent vai improvisar ou bloquear.

**Boa prática**: cada subagent já lê AGENTS.md no início, então você **não precisa repetir** restrições universais (não despache outros, não commite, formato de relatório). Foque no específico da tarefa.

---

## 6. Padrões de orquestração para cenários típicos

### 6.1. Implementar uma spec do zero

```
Turn 1 (planejamento)
  ↳ Você lê: docs/specs/NNN-slug/spec.md + sprint ativa (docs/sprints/*active*)
  ↳ Confirma que a spec está em specs_in_flight: da sprint ativa
  ↳ Decide escopo, checa open questions com usuário se necessário

Turn 2 (delegação principal)
  ↳ Despacha spec-implementer com prompt completo (incluindo capacidade restante da sprint)

Turn 3+ (após retorno do spec-implementer)
  ↳ Paralelo: constitution-guard + a11y-perf-auditor (se houve UI) + model-validator (se houve modelo)
  ↳ Sequencial: rf-coverage-checker (precisa dos testes que o spec-implementer criou)
  ↳ Sequencial: spec-syncer (propaga shipped + atualiza checkbox em docs/sprints/<ativa>.md)

Turn final
  ↳ Síntese para o usuário, citando progresso na sprint ativa
```

### 6.1b. Abertura de sprint (planning)

```
Turn 1 (paralelo)
  ↳ Lê sprint que vai abrir + sprint anterior (Retrospective + Carry-over)
  ↳ Lê backlog.md
  ↳ Lê specs listadas em specs_in_flight: + dependências

Turn 2
  ↳ Apresenta ao usuário: goal único proposto + DoD + chores + riscos
  ↳ Atualiza frontmatter: status: planned → active
  ↳ Atualiza index.json (status da sprint)
```

### 6.1c. Fechamento de sprint (retro)

```
Turn 1
  ↳ Audita DoD: todos os itens checados? specs in-flight em status: shipped?
  ↳ Lista carry-overs (tasks não fechadas)

Turn 2
  ↳ Preenche seção ## Retrospective com o usuário
  ↳ Move status: active → done
  ↳ Despacha spec-syncer pra propagar
  ↳ Despacha planning da próxima sprint (6.1b)
```

### 6.2. Implementar 2 specs independentes em paralelo

```
Turn 1 (delegação dupla, mesmo bloco)
  ↳ Task call: spec-implementer para spec A
  ↳ Task call: spec-implementer para spec B
  (Claude Code roda em paralelo)

Turn 2 (após ambos retornarem)
  ↳ Aplica padrão 6.1 fase 3 para cada uma — paralelo onde possível
```

### 6.3. Validar antes de commit/PR

```
Turn 1 (paralelo)
  ↳ constitution-guard (read-only, sempre rápido)
  ↳ a11y-perf-auditor se mudança toca UI
  ↳ rf-coverage-checker se a mudança encerra uma spec
```

### 6.4. Promover spec a `shipped` (gate sequence)

```
Pré-requisito: implementação concluída + testes verdes

Turn 1 (paralelo)
  ↳ rf-coverage-checker
  ↳ constitution-guard
  ↳ a11y-perf-auditor (se aplica)
  ↳ model-validator (se spec 002)

Turn 2 (sequencial, só se TODOS pass)
  ↳ Você (ou spec-implementer) muda status no spec.md frontmatter
  ↳ Despacha spec-syncer para propagar (traceability, index.json, README)
```

Se qualquer gate falhar → **pare**, reporte ao usuário, não promova.

### 6.5. Decisão técnica nova apareceu

```
Turn 1
  ↳ Despacha adr-author com contexto (problema, alternativas, decisão, motivação)

Turn 2 (após ADR criado)
  ↳ Despacha spec-syncer para propagar refs nas specs afetadas
```

### 6.6. Auditoria de área (sem mudanças pendentes)

```
Turn 1 (paralelo)
  ↳ constitution-guard escopo=<área>
  ↳ spec-syncer (audit mode — só reporta divergências)
  ↳ rf-coverage-checker para cada spec recente

Turn 2
  ↳ Síntese: o que está OK, o que precisa ação
```

### 6.7. Onboarding em uma spec existente

```
Turn 1 (leituras paralelas — você lê)
  ↳ docs/_meta/index.json
  ↳ docs/specs/NNN/spec.md
  ↳ docs/specs/NNN/design.md
  ↳ ADRs e NFRs listados no frontmatter (paralelo)

Turn 2
  ↳ Reporta ao usuário o entendimento; pergunta sobre open questions
```

---

## 7. Workflow SDD em modo orquestrador (resumo)

Detalhe completo em [AGENTS.md § 6](./AGENTS.md). Para você:

- **Spec primeiro, código depois.** Toda implementação começa lendo `spec.md` + `design.md`.
- **Hierarquia**: constitution > ADRs > NFRs > specs > código. Conflito entre níveis → pare e investigue.
- **Sintaxe EARS** para qualquer RF novo (você não escreve, mas valida).
- **Ciclo**: `draft → ready → implementing → shipped` com gates entre `implementing` e `shipped`.
- **Cobertura**: matriz em [docs/_meta/traceability.md](./docs/_meta/traceability.md) atualizada sempre.

---

## 8. Stack — pontos não-óbvios

Stack completa em [docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md). Os "gotchas" do orquestrador:

- **Postgres NUNCA no read path do cliente** ([ADR-0001](./docs/architecture/adrs/0001-edge-config-no-read-path.md)). Read path é Edge Config.
- **Mapa via `next/dynamic({ ssr: false })`** ([ADR-0010](./docs/architecture/adrs/0010-mapa-dynamic-import.md)). Bundle above-the-fold <150KB ([RNF-007a](./docs/nfr/performance.md)) só é viável assim.
- **Sem LLM em insights** ([ADR-0005](./docs/architecture/adrs/0005-templates-nao-llm.md)). Use templates determinísticos.
- **Cores via tokens** — PT=vermelho, PL=azul. Nunca cores oficiais de partido (constituição § 2).
- **Snapshots append-only** (constituição § 10). Nunca UPDATE/DELETE em `snapshots`.
- **Resolução TSE 23.751/2026 (arts. 264–269) está PUBLICADA e rege o pleito** — fonte canônica em [docs/reference/regulatory.md](./docs/reference/regulatory.md). ⚠️ A 23.736/2024 (municipais) **não** é mais referência de práticas: foi a analogia com ela que produziu as premissas falsas de maio/2026 (cadastro inexistente, abandono do EA20). Não há watch pendente aqui.

---

## 9. Gates obrigatórios antes de `shipped`

Toda spec promovida a `shipped` exige:

1. **Cobertura RF** — `rf-coverage-checker` retorna ✅
2. **Constitution OK** — `constitution-guard` retorna ✅
3. **NFR atingidos** — `a11y-perf-auditor` (se UI) + `model-validator` (se spec 002)
4. **Documentação sincronizada** — `spec-syncer` propaga `traceability.md`, `index.json`, `README.md`

Sem todos os 4 → **não promova**.

---

## 10. TodoWrite — uso pelo orquestrador

Use **proativamente** quando a sessão tem 3+ passos. Padrão:

- Quebrar trabalho em todos granulares (1 task ≈ 1 delegação ou 1 ação).
- **Exatamente 1 task `in_progress`** por vez.
- Marcar `completed` **imediatamente** após terminar, não em lote.
- Reorganizar quando o plano muda (não acumule todos obsoletos).

Quando despacha um subagent que vai fazer várias coisas, o subagent tem seu próprio tracking (TodoWrite ou `tasks.md`). Seu TodoWrite reflete só **os despachos e sínteses**, não as sub-tasks internas.

---

## 11. O que você NÃO faz (do orquestrador)

- ❌ Implementar uma feature de 5+ arquivos pessoalmente. Despache `spec-implementer`.
- ❌ Carregar dezenas de arquivos no contexto para "investigar" algo. Despache `Explore` agent ou subagent especializado.
- ❌ Editar `docs/PRD.md` (snapshot read-only, v0.1).
- ❌ Promover spec a `shipped` sem rodar os 4 gates.
- ❌ Adicionar dep fora da stack canônica sem despachar `adr-author`.
- ❌ Aceitar relatório de subagent sem ler — **trust but verify**. Cheque o que foi editado.
- ❌ Despachar subagent sem prompt estruturado (vai produzir trabalho generic).
- ❌ Rodar despachos sequenciais quando podiam ser paralelos.
- ❌ Skippar pre-commit hooks (`--no-verify`) sem ordem explícita do usuário.
- ❌ Commit/push sem ordem explícita.

---

## 12. Comandos úteis

**Toda invocação que toca o banco exige `set -a; . ./.env.local; set +a` antes.**

🔴 **E só quem toca o banco.** Esse comando carrega o arquivo INTEIRO, e a primeira
variável dele é o `DATABASE_URL` de **produção**. Script que não precisa do banco não
deve pedir isso — ele carrega sozinho o que precisa, por **lista branca**. O molde é
`scripts/_vigia-env.ts` (`pnpm vigia:ciclo`, 19/09): duas chaves, nenhuma toca banco, e
o ambiente real sempre vence o arquivo. Ver o § do vigia em
[docs/operations/runbook.md](./docs/operations/runbook.md).

```bash
pnpm dev                       # next dev :3000
pnpm build
pnpm typecheck                 # tsc --noEmit
pnpm lint                      # biome check .
pnpm test                      # vitest
pnpm test:py                   # ⚠️ QUEBRADO — ver "Python" logo abaixo
pnpm test:e2e                  # playwright — exige servidor de pé, ver abaixo
pnpm build:e2e                 # build para os portões e2e (Global Config falso de pé)
pnpm start:e2e                 # servidor para os portões e2e (chaves de escrita raspadas)
ANALYZE=true pnpm build        # bundle analyzer (RNF-007a/b/c)
```

**Python — `pnpm test:py` não resolve o venv sozinho.** O script é literalmente
`python -m pytest` (`package.json`), então ele pega o `python` do PATH e morre com
`ModuleNotFoundError: pydantic` antes do primeiro teste. Chame o intérprete do venv
**explicitamente**:

```bash
.venv-model/bin/python3.14 -m pytest      # 576 verdes em 18/09
```

✅ **Os portões e2e PASSARAM a rodar na máquina (21/09).** Até 20/09 peso de
página e acessibilidade só existiam por medição manual. São dois comandos, em
terminais separados:

```bash
pnpm build:e2e && pnpm start:e2e   # 🔴 os DOIS :e2e — NUNCA build, start nem dev
pnpm test:e2e                      # contagem da última execução no runbook
```

`pnpm start` não serve: o Next carrega o `.env.local` sozinho e o `DATABASE_URL`
de lá é **produção**. O `start:e2e` declara vazias as 13 variáveis de escrita
(o `build:e2e` também, menos o `DATABASE_URL`, que vira um banco MORTO em
`127.0.0.1:9` — o `neon()` lança com URL vazia no build). Confira no log:
`[db] DATABASE_URL ausente`.

🔴 **Desde 26/09 os portões leem DADO FIXO, não produção.** Até então o
`start:e2e` deixava o `EDGE_CONFIG` (leitura) do `.env.local` e os portões
mediam o que estivesse publicado. Agora ele sobe `scripts/edge-config-falso.ts`
(127.0.0.1:3101, serve `tests/fixtures/simulacao/`) e o `next start` na
**porta 3100**. Fixture só entra nas páginas sob `NODE_ENV=development`
(conserto de 13/09) — por isso o servidor falso, e não `EDGE_CONFIG=""`, que
faria as telas mostrarem "Aguardando dados".

🔴 **E desde 29/09 o BUILD também precisa dele — `pnpm build:e2e`, não `pnpm build`.**
Um `pnpm build` **sem `.env.local`** (worktree, CI, clone novo — onde os agentes
rodam) não tem `EDGE_CONFIG`: o Next pré-montava `/`, `/senador`,
`/deputado-federal` e `/uf/SP/*` com a casca "Esta página ainda não recebeu
dados", e os portões de peso e de acessibilidade mediram essa casca, verdes (foi
assim na auditoria de 29/09). No checkout principal o `pnpm build` pegava o
`EDGE_CONFIG` de **produção** do `.env.local` — as rotas saíam dinâmicas e o
`start:e2e` servia o dado fixo: certo por acaso, com o build carregando as
variáveis de produção. O `build:e2e` monta com o falso de pé e marca o `.next`;
o `start:e2e` **recusa** subir sem essa marca (ou com a de outro build), e os
dois portões reprovam se acharem a casca. Com o `EDGE_CONFIG` no build as rotas
saem dinâmicas (ƒ) — o SDK busca com `no-store`. Detalhe e ressalvas no
[runbook § portões e2e](./docs/operations/runbook.md).

**🔴 Modo simulado — use `pnpm sim:full`, NUNCA `pnpm sim` sozinho.**
A fixture de `tests/fixtures/simulacao/` não sai de um programa só: o gerador
monta a base e um script Python acrescenta a **série da evolução da apuração**
por cima. `pnpm sim` reescreve a base e **apaga a série** — 8 testes quebram
(`tests/unit/dev/serie-*.test.ts`) e o gráfico da spec 020 fica vazio no
simulado. Aconteceu em 20/09, com o conselho errado saindo daqui mesmo.

```bash
set -a; . ./.env.local; set +a; pnpm sim:full   # gerador + série + formatação
pnpm dev:sim                                    # sobe a tela com a fixture
```

`sim:full` (criado em 20/09) encadeia as três etapas na ordem e formata no fim
— o gerador emite JSON que o `biome` reprova, então sem a formatação o
pre-commit barra. O banco é lido **só** pelo primeiro passo, e **só com
`SELECT`**: as nove consultas do gerador são de leitura, ele não importa
`lib/edge-config/writer.ts` nem `lib/blob/write.ts`, e não faz rede.

✅ **`sim:full` é a cadeia INTEIRA** — não há mais elo avulso a rodar depois.
Três scripts irmãos (`gerar-votos-pct-atual-fixtures.py`,
`gerar-outros-fixtures.py`, `gerar-governador-uf-fixture.py`) faziam remendos
que o gerador passou a emitir sozinho (`votos_atuais`, `pct_atual`, `outros`,
`sqcand`) e foram **removidos em 2026-09-21** (decisão do dono, dívida 20). Se
você encontrar um deles num branch antigo ou num worktree, **não rode**: fora
de ordem eles reintroduzem o estado antigo.

**🔴 `ALLOW_DB_WRITE_TESTS` — cinco testes escrevem no banco de `DATABASE_URL`.**
São `tests/integration/model-edge-cases`, `model-cycle`, `ingest-cycle`,
`ingest-model-trigger` e o bloco de lock de `ingest-routes-auth-cargo`. Desde 17/09 eles só
rodam com a variável **declarada**; o ponto único de decisão é
`tests/integration/_guarda-banco.ts` (`podeEscreverNoBanco()`), e a igualdade é exata com `"1"`.

```bash
# de propósito, SEMPRE contra um banco descartável:
DATABASE_URL=<banco-descartavel> ALLOW_DB_WRITE_TESTS=1 npx vitest run tests/integration/model-cycle.test.ts
```

**Nunca declare essa variável com o `.env.local` carregado.** O `DATABASE_URL` de
`.env.local` é **produção** — o banco que vai guardar a apuração de 04/10. Até 17/09 o único
freio era a *ausência* de `DATABASE_URL`, e ausência é um estado que se perde por acidente:
bastou alguém carregar o `.env.local` para conferir uma migration e rodar `npx vitest run`
para **1.877 linhas de harness** entrarem em produção (1.233 sob os cargos inexistentes
91/92/93 e 644 sob o cargo **real** 1, com as candidaturas sintéticas 101/102 ao lado das de
verdade). Como conferir resíduo: [runbook § série por candidatura](./docs/operations/runbook.md).

**Hook de pre-commit ATIVO** (restaurado em 17/09 — os dois commits de 13/09 estavam presos
num worktree e nunca chegaram à `main`). `core.hooksPath=.githooks`; o
`.githooks/pre-commit` roda `biome check` na **árvore inteira** (~150 ms) e **aborta o
commit** se reprovar — barrou três commits em 17/09. Conserto: `pnpm lint:fix`.
`--no-verify` continua exigindo ordem explícita do dono (§ 11).

Modelo e gate OT-4:

```bash
pnpm replay-2022 --dataset tests/fixtures/replay-2022/snapshots.json \
                 --ground-truth tests/fixtures/replay-2022/ground-truth.json
# ↑ exige os dois argumentos. Referência estável: MAE@1h PT 2,3623pp / cobertura 82,5%.
#   Se mudar sem que o modelo tenha mudado, procure leitura de `eleitorado` sem SUM/GROUP BY.
pnpm replay-2022:sensitivity   # faixa do ADR-0033 D3 (atraso 0..3); REGENERA o fixture do banco
```

TSE e ingestão:

```bash
pnpm tse:watch --once          # config do TSE mudou? exit 0 = não, 2 = sim
pnpm list-targets --env production --cargo 1   # esperado ~6.110 (um por par município×zona)
pnpm tse:mock --pares <csv>    # CDN falso que só responde a pares conhecidos
```

Banco — migrations são **manuais e numeradas**, nunca `drizzle-kit push`:

```bash
pnpm db:migrate:0006           # migration + eleitorado-import + zonas-import, nessa ordem
pnpm db:migrate:0009           # série por candidatura: pct_atual, votos_atuais, dado_ts
pnpm db:push:DANGEROUS         # NÃO USE. Renomeado porque o push regride o banco
pnpm edge-config:smoke         # grava/lê/apaga no Global Config — exige EDGE_CONFIG_TOKEN
```

A **0009 já foi aplicada em produção em 17/09**. É aditiva e idempotente (todo o DDL é
`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) e O(1) — `ADD COLUMN` sem default
não reescreve a tabela em PG 11+. Rodar de novo é seguro; as linhas anteriores ficam com
`pct_atual` nulo **de propósito**.

Validação de docs (sem deps):

```bash
# Cross-refs quebradas em docs/
cd docs && python3 -c "
import os, re
broken=[]
for root,_,files in os.walk('.'):
  for f in files:
    if not f.endswith('.md'): continue
    p=os.path.join(root,f); base=os.path.dirname(p)
    with open(p) as fh: c=fh.read()
    for m in re.finditer(r'\]\((\.\.?/[^)#]*?)(#[^)]*)?\)', c):
      t=os.path.normpath(os.path.join(base, m.group(1)))
      if not (os.path.exists(t) or os.path.isdir(t)): broken.append((p, m.group(1)))
print(broken if broken else 'OK')
"

# Diff RFs PRD ↔ traceability
diff <(grep -oE 'RF-[0-9]+(\.[0-9]+)?' docs/PRD.md | sort -u) \
     <(grep -oE 'RF-[0-9]+(\.[0-9]+)?' docs/_meta/traceability.md | sort -u)

# Specs por status
grep -l "status: draft" docs/specs/*/spec.md
grep -l "status: shipped" docs/specs/*/spec.md
```

---

## 13. Quando algo dá errado — qual subagent disparar

| Sintoma | Subagent / ação |
|---|---|
| Build falhando por dep nova | `adr-author` antes de instalar |
| Mapa lento | `map-builder` + `a11y-perf-auditor` |
| Bundle estourou RNF-007a | `a11y-perf-auditor` para diagnóstico |
| Modelo retornando NaN ou MAE alto | `model-validator` |
| Pipeline TSE com lag | `tse-parser-builder` + leia [docs/operations/runbook.md](./docs/operations/runbook.md) |
| Spec contradiz ADR | Pare e reporte ao usuário — nível mais alto vence |
| Mudança no leiaute ou na norma do TSE | Releia [docs/reference/regulatory.md](./docs/reference/regulatory.md) e [tse-2026-leiautes.md](./docs/reference/tse-2026-leiautes.md); despache `tse-parser-builder` para diff técnico |
| RF aparece em spec mas falta em traceability | `spec-syncer` |
| Decisão técnica ambígua | `adr-author` |

---

## 14. Onboarding rápido (se for sua primeira vez no projeto)

Em paralelo:

1. **[docs/_meta/index.json](./docs/_meta/index.json)** — mapa completo.
2. **[docs/constitution.md](./docs/constitution.md)** — limites.
3. **[docs/README.md](./docs/README.md)** — as 20 specs.
4. **[AGENTS.md](./AGENTS.md)** — pra entender o que seus subagents carregam.

Daí você está pronto pra orquestrar.

---

## 15. Para você (orquestrador), em uma frase

> "Pense em paralelo, delegue por padrão, prompt o subagent como colega novo, valide o que volta, sintetize com o usuário. Você é decisor; subagents são executores."
