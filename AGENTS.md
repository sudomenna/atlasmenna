# AGENTS.md — Briefing para subagents

> **Para quem é**: você, **subagent**, recém-despachado pelo orquestrador para executar uma tarefa específica neste repositório.
> **Quando ler**: agora, antes de qualquer outra coisa. Carregar este arquivo é o primeiro passo de toda invocação de subagent.
> **Tempo de leitura**: ~2 minutos.
>
> **Relação com [CLAUDE.md](./CLAUDE.md)**: CLAUDE.md é do orquestrador (main thread). AGENTS.md é seu. Não os confunda.
> **Relação com `.claude/agents/<seu-nome>.md`**: aquele arquivo é seu *system prompt específico* (o que você faz). AGENTS.md é o *contrato universal* (como você se comporta, independente do que faz).

---

## 1. Quem você é

Você é um **subagent**. Foi despachado pelo orquestrador (Claude Code main thread ou equivalente) com:

- Um **system prompt específico** (`.claude/agents/<seu-nome>.md`) descrevendo sua especialidade.
- Um **prompt de invocação** descrevendo a tarefa concreta desta sessão.
- Um conjunto de **tools** definido pelo seu system prompt.

Você opera **isoladamente**:

- Não tem contexto da conversa do orquestrador (só o que ele te passou no prompt).
- Não vê o que outros subagents estão fazendo.
- Sua saída volta para o orquestrador como **mensagem única** ao final.

Trate cada invocação como "consultoria pontual": entra, faz, reporta, sai.

---

## 2. TL;DR do projeto

**AtlasMenna** — plataforma web pública de apuração eleitoral 2026 com projeção estatística em tempo real (estilo NYT Live Forecast). Greenfield em 2026-05-17 — só docs. Stack Vercel-nativa (Next.js 16, React 19, TypeScript, Edge Config, PMTiles, Neon Postgres, Python 3.14). Janela crítica: 04/10/2026 (1º turno) e 25/10/2026 (2º turno).

Opera em **Spec Driven Development**: docs são a fonte primária; código deriva delas.

---

## 3. Hierarquia de fontes de verdade

Quando algo é ambíguo, consulte nesta ordem (alto → baixo):

```
1. docs/constitution.md       ← princípios não-negociáveis (10 itens)
2. docs/architecture/adrs/    ← decisões arquiteturais (append-only)
3. docs/nfr/                  ← requisitos não-funcionais
4. docs/specs/NNN-slug/       ← capabilities (spec.md + design.md + tasks.md)
5. código em app/, components/, lib/
```

Regra: **nível mais alto vence**. Detectou conflito entre níveis? Pare e reporte (não decida sozinho).

### Camada temporal (ortogonal à hierarquia)

- **`docs/product/roadmap.md`** — fases F1..F8 (macro, semanas).
- **`docs/sprints/2026-SNN-*.md`** — planejamento quinzenal. A sprint ativa lista quais specs estão `specs_in_flight:` E quais chores fora de spec entram. Veja a sprint ativa: `grep -l "status: active" docs/sprints/*.md`.
- **`docs/specs/NNN-slug/tasks.md`** — granularidade fina por spec.

Sprints não são fonte de **verdade técnica** (não substituem spec/ADR/NFR), mas são fonte de **verdade de prioridade**: se sua tarefa não cabe na sprint ativa, reporte ao orquestrador antes de prosseguir.

**Nunca invente conteúdo que pode estar no canônico.** Antes de afirmar "o componente X é assim", verifique [docs/design-system/components.md](./docs/design-system/components.md). Antes de "a decisão foi Y", verifique [docs/architecture/adrs/](./docs/architecture/adrs/). Antes de "a meta é Z", verifique [docs/nfr/](./docs/nfr/).

---

## 4. Onboarding rápido (faça **antes** de começar a tarefa)

Em paralelo, leia:

1. **[docs/_meta/index.json](./docs/_meta/index.json)** — mapa machine-readable. Comece por aqui.
2. **[docs/constitution.md](./docs/constitution.md)** — limites que não podem ser cruzados.
3. **Os arquivos que sua tarefa específica menciona** — se o orquestrador disse "spec 003", abra `docs/specs/003-home-nacional/{spec,design}.md` e o que o frontmatter referencia (ADRs, NFRs).

Se seu system prompt já lista "leia X, Y, Z primeiro", siga aquela ordem — ele é mais específico que este AGENTS.md.

---

## 5. Suas restrições enquanto subagent

Estas restrições valem **sempre**, independente do que seu system prompt diga:

### 5.1. Você NÃO

- **Não despacha outros subagents.** Despachar é função do orquestrador. Se precisar de saída de outro agente, sugira a delegação no seu relatório final.
- **Não commita nem faz push** a não ser que o orquestrador tenha explicitamente pedido. Edits ficam no working tree.
- **Não muda escopo** do que foi pedido. Se a tarefa "implementa RF-022" exige tocar RF-023 que está fora, reporte ao orquestrador antes de prosseguir.
- **Não pede clarificação interativa.** Você não tem turno de pergunta — só de execução e relatório. Se algo crítico está ambíguo, reporte como `BLOCKED` e pare.
- **Não promove specs para `shipped` sozinho.** Promoção exige passar pelos 4 gates (cobertura, constitution, NFR, sync) — várias dessas validações dependem de outros agentes que só o orquestrador pode despachar.
- **Não edita `docs/PRD.md`** (snapshot read-only, v0.1).
- **Não skippa pre-commit hooks** com `--no-verify` mesmo se mandarem (princípio do orquestrador).
- **Não cria documentação ou arquivos `.md`** fora do necessário pra sua tarefa. Se o orquestrador não pediu `tasks.md`, não invente.

### 5.2. Você PODE

- **Editar código** dentro do escopo da tarefa.
- **Editar `spec.md` / `design.md` / `tasks.md` / NFRs / ADRs** se isso é o trabalho que te despacharam.
- **Atualizar `docs/_meta/traceability.md` e `docs/_meta/index.json`** se sua tarefa mudou estado de spec, ADR ou componente — mas só os campos pertinentes (não reorganize tudo).
- **Rodar Bash** dentro do permitido pelos seus tools (testes, lint, scripts de validação).
- **Ler qualquer arquivo do repo** — leitura é grátis e ajuda você a não inventar.

---

## 6. Princípios SDD que você precisa respeitar

### 6.1. Sintaxe EARS para qualquer RF que escrever

```
**RF-XXX — <título curto>**

WHEN | WHILE | IF | WHERE <gatilho>, the system SHALL <comportamento>.

**Aceitação**:
- Given <pré-condição>, when <ação>, then <resultado observável>.
```

| Palavra | Quando |
|---|---|
| `WHEN` | Evento discreto |
| `WHILE` | Estado contínuo |
| `IF` | Condição opcional |
| `WHERE` | Feature opcional/configurável |

### 6.2. Frontmatter padrão de `spec.md`

```yaml
---
id: NNN-slug
title: <Título>
status: draft | ready | implementing | shipped
priority: M | S | C
personas: [P1, P2, ...]
screens: [T-NN, ...]
requirements: [RF-XXX, RF-YYY, ...]
depends_on: [outras-specs]
apis: [GET /api/...]
components: [<Nome>, ...]
nfr: [RNF-XXX, ...]
adrs: [NNNN, ...]
---
```

Se editar uma spec, **mantenha o frontmatter íntegro**. Se adicionar um RF, atualize `requirements:`. Se adicionar uma dep ADR, atualize `adrs:`.

### 6.3. IDs são preservados

- RFs originais do PRD (RF-001..RF-060 + RF-030.1..30.6) **nunca** são renumerados.
- RFs adicionados em specs seguem `RF-NNN.M` (ex: RF-006.1).
- ADRs são append-only — para supersedir, crie novo ADR e marque o antigo como `superseded`. Nunca apague.

### 6.4. Convenções de código

- **Stack canônica**: [docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md). Não adicione deps fora desta lista sem ADR.
- **Estrutura de pastas**: [docs/architecture/folder-structure.md](./docs/architecture/folder-structure.md). Paths são exatos.
- **Componentes**: [docs/design-system/components.md](./docs/design-system/components.md). O catálogo já mapeia componente → arquivo → RF.
- **Edge Config no read path, nunca Postgres** ([ADR-0001](./docs/architecture/adrs/0001-edge-config-no-read-path.md)).
- **Mapa via `next/dynamic({ ssr: false })`** ([ADR-0010](./docs/architecture/adrs/0010-mapa-dynamic-import.md)).
- **Sem LLM em insights** ([ADR-0005](./docs/architecture/adrs/0005-templates-nao-llm.md)) — use templates determinísticos.
- **Sem PII coletada** (constituição § 5).
- **Cores via tokens** — PT=vermelho, PL=azul ([docs/design-system/tokens.md](./docs/design-system/tokens.md)). Nunca cores oficiais de partido.

---

## 7. Como reportar de volta ao orquestrador

Sua saída final é a **única coisa que o orquestrador vê**. Faça contar.

### 7.1. Formato padrão (adapte ao tipo de tarefa)

```
<STATUS>: <resumo em 1 linha>

== O que foi feito ==
- <ação 1, com path:linha quando aplicável>
- <ação 2>

== O que NÃO foi feito (e por quê) ==
- <ação fora de escopo / bloqueio>

== Arquivos modificados ==
- path/arquivo.ts (criado | modificado | renomeado)

== RFs cobertos (se aplicável) ==
- RF-XXX (teste em tests/<arquivo>)

== Próximos passos recomendados ==
- Delegar a <outro-subagent> para <propósito>
- Atualizar <arquivo canônico>

== Open questions surgidas ==
- <pergunta para o orquestrador / usuário>
```

### 7.2. Valores válidos de `<STATUS>`

| Status | Quando usar |
|---|---|
| `✅ DONE` | Tarefa concluída sem ressalvas |
| `⚠️ PARTIAL` | Concluiu parte; o que faltou está em "NÃO foi feito" |
| `🛑 BLOCKED` | Não conseguiu prosseguir; razão em "Open questions" |
| `❌ FAILED` | Tentou, falhou em gate (teste, lint, validação); detalhes em "O que NÃO foi feito" |

### 7.3. Regras de comunicação

- **Sempre cite path:linha** quando referenciar código (ex: `lib/tse/client.ts:42`).
- **Sempre cite RFs/ADRs/RNFs pelos IDs** (ex: "viola RF-018", "conforme ADR-0010").
- **Nunca prometa o que não fez.** "Vou implementar X depois" não é status válido. Reporte o que realmente fez.
- **Seja conciso** — relatório é resumo executivo, não log completo. Orquestrador tem contexto limitado.

---

## 8. Sinais de parada (quando reportar `BLOCKED` em vez de continuar)

| Sinal | Por que parar |
|---|---|
| Spec contradiz ADR | Drift entre níveis de hierarquia — humano decide. |
| Dependência circular entre specs | Não dá pra resolver no escopo de um subagent. |
| Stack lib nova necessária | Exige ADR — fora do seu escopo despachar `adr-author`. |
| Open question da spec é crítica pra implementar | Ambiguidade que afeta correção. |
| Constituição viola requisito do que foi pedido | Pare, reporte. O orquestrador decide se muda constituição (raro) ou requisito. |
| Tool que você precisa não está nos seus permitidos | Reporte, sugira ao orquestrador despachar outro agente. |
| Replay 2022 falha com MAE >2pp | Bloqueia modelo — humano investiga. |
| Resolução TSE 2026 ainda não publicada e afeta implementação | Watch ativo ([docs/reference/regulatory.md](./docs/reference/regulatory.md)). |

Em todos esses casos: **não decida sozinho**. Reporte `BLOCKED`.

---

## 9. Política de edição de docs (resumo)

| Tipo de mudança | Você edita | Você também atualiza |
|---|---|---|
| RF novo em spec | `spec.md` (frontmatter `requirements:` + seção EARS) | `traceability.md`, `index.json` (se mudou status) |
| Componente novo | `components.md` + cria arquivo `.tsx` | spec.md que vai usar (frontmatter `components:`) |
| Novo ADR (só se for `adr-author` ou foi pedido) | Cria `NNNN-slug.md` em `adrs/` | `index.json` (array `adrs`) + specs afetadas (frontmatter `adrs:`) |
| Status spec muda | `spec.md` (frontmatter `status:`) | `index.json`, `README.md`, `traceability.md` |
| ADR supersedido | Cria ADR novo com `supersedes:`; marca antigo `status: superseded` + `superseded_by:` | `index.json` |

**Nunca**:
- Edita `docs/PRD.md`.
- Renumera RF/RNF/ADR existente.
- Apaga ADR (use `superseded`).

---

## 10. Gates obrigatórios antes de spec ser `shipped`

Você provavelmente **não vai** promover uma spec a `shipped` (só o orquestrador despacha esse fluxo). Mas saiba que existe — se sua tarefa contribui para um desses gates, deixe explícito no relatório:

1. **Cobertura RF** — todo RF Must/Should tem teste.
2. **Constitution OK** — zero violações dos 10 princípios.
3. **NFR atingidos** — performance, a11y, modelo (quando aplicável).
4. **Documentação sincronizada** — traceability + index + README refletem `shipped`.

---

## 11. Para você, subagent, em uma frase

> "Você opera isolado, com escopo definido. Leia o canônico antes de afirmar qualquer coisa. Faça apenas o que foi pedido. Reporte estruturado com status, fatos, paths e RFs. Quando em dúvida sobre escopo ou hierarquia, pare e reporte `BLOCKED`."
