---
id: 2026-S11
title: Sprint 11 — Sobreviver ao pior
status: planned
start: null        # D9 (2026-09-18): sprints por dependência, não por data
end: null
sequence: 4
depends_on_sprint: 2026-S10
phase: F7
goal: Quando algo quebrar, o site degrada com dignidade e alguém consegue consertar — página de manutenção, backup, carga medida e o checklist pré-produção fechado caixa a caixa.
specs_in_flight: [013-pagina-manutencao, 010-operacao-monitoramento]
specs_optional: [012-dashboard-status, 008-interatividade-brushing]
specs_planned_next: []
---

# Sprint 11 — Sobreviver ao pior

> **Sprint sem datas (D9, 2026-09-18).** `sequence: 4`, depende da S10 fechada. É a última
> sprint antes do marco [D1 — 04/10](./_D1-04out2026.md).
>
> **Esta sprint absorve a antiga `2026-S08-f7-estabilizacao.md`** — os quatro blocos do seu
> "Foco da sprint" (checklist pré-produção, env de produção, bug bash exaustivo e runbook
> D-1), mais o seu Definition of Done e os seus riscos. O conteúdo foi trazido para cá e
> atualizado com o que foi medido desde 05/09; os "Não-objetivos" daquele arquivo viraram a
> seção "Opcionais explícitos". O arquivo antigo foi descartado pelo orquestrador.

## Objetivo único

**Quando algo quebrar, o site degrada com dignidade e alguém consegue consertar.** Nada
aqui é feature. É o encanamento que decide se um incidente às 20h de 04/10 é um susto ou
uma noite perdida.

## Dependências

**O que esta sprint exige que já esteja pronto:**

- **Da S08**: o canal de alarme. O runbook desta sprint descreve o que fazer quando o
  alarme chega; sem canal, os ensaios de incidente são teatro.
- **Da S09**: o tamanho do payload medido no pior caso. O teste de carga sem esse número
  mede uma página que não é a de 04/10.
- **Da S10**: o site já afirmando só o que sustenta. Endurecer contra falha um site que
  promete cobertura que não tem é consertar a porta da casa com a parede caída.

**O que ela destrava:** o marco [D1](./_D1-04out2026.md). É a última porta.

---

## Specs in-flight

- [ ] **013-pagina-manutencao** (`ready`) — `/manutencao` como degradação; RFs
      058/058.1/058.2 já em `traceability.md` **sem código** desde a S06.

  🔴 **Contradição a resolver ANTES da primeira linha de código.** Os dois documentos da
  própria spec dizem o oposto um do outro:

  | Documento | Linha | Diz |
  |---|---|---|
  | `docs/specs/013-pagina-manutencao/spec.md` | `:33` | *"Lê **apenas** `maintenance:mode` e `maintenance:context` do Edge Config"* |
  | `docs/specs/013-pagina-manutencao/design.md` | `:13` | *"**Não** consome Edge Config (justamente para sobreviver à indisponibilidade dele)"* |

  Não é detalhe de implementação: é a pergunta central da página. Se o gatilho da
  manutenção é uma bandeira no Edge Config, a página não sobrevive ao Edge Config cair —
  que é o cenário para o qual ela existe (`spec.md:51` descreve exatamente esse caso). Se
  ela não lê nada, o gatilho tem de vir de outro lugar (env var + redeploy, ou rewrite no
  middleware com estado próprio).

  **Exige ADR antes de codar.** Hierarquia: `design.md` não pode contradizer `spec.md` em
  silêncio, e nenhum dos dois pode contradizer a constituição § 7 (degradação).

- [ ] **010-operacao-monitoramento** (`draft`) — a **fatia restante**, complementar à
      que a S08 levou: **RF-056** (painel de saúde), **RF-058** (modo manutenção) e
      **RF-059** (rolling release com rollback). RF-057 e RF-060 fecharam na S08.
      ⚠️ RF-056 depende da spec 012, **cortada pelo dono** (ver "Opcionais explícitos").

---

## Chores fora de spec

### 1. Checklist pré-produção — fechar caixa a caixa

[`docs/operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md) tem
**22 caixas**. Quando esta sprint foi escrita (18/09) estavam **todas as 22 em branco** —
não porque nada tivesse sido feito, mas porque o checklist parou de ser lido: a primeira
caixa já estava resolvida desde **05/09** (`lib/tse/client.ts:61-62` já traz
`SalaCofre/1.0 (+https://salacofre.com.br; contato: contato@salacofre.com.br)`) e seguia
em branco. Ainda em 18/09, essa caixa foi marcada — **1 de 22** (`:17`).

O trabalho desta sprint são as **21 restantes**, e a lição da caixa 1 é o método: uma
caixa fecha com **evidência**, e uma caixa em branco não significa "não feito".

- [ ] Percorrer as 21, uma a uma. Cada uma termina **marcada com evidência** ou
      **dispensada com justificativa escrita no próprio arquivo** — nunca em branco.
- [ ] ⚠️ A caixa `:38` (alertas Slack) já traz a regra da casa: *"sempre contra o mock
      local (`pnpm tse:mock`), nunca forçando erro contra o CDN do TSE"*. Ela fecha com a
      evidência produzida na S08.
- [ ] Caixas com data de terceiro **não fecham aqui** — vão para o trilho externo (D4):
      os dois códigos de eleição de produção (`:19` — `TSE_COD_ELEICAO_FEDERAL` e
      `TSE_COD_ELEICAO_ESTADUAL`, desde o [ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md))
      e a execução dos simulados oficiais (`:28`). Marcar como "rastreada fora da sprint",
      nunca como pendente sem dono.

### 2. Backup do Postgres

- [ ] Snapshot do Neon configurado (cadência diária, retenção declarada).
- [ ] **Ensaio de restauração** contra um branch do Neon — backup não testado não é backup.
      🔴 Nunca contra produção: o `DATABASE_URL` do `.env.local` é o banco que vai guardar
      a apuração de 04/10.
- [ ] Procedimento no [runbook](../operations/runbook.md): quem restaura, a partir de quê,
      em quanto tempo.

### 3. Teste de carga

**Atenção, os documentos discordam entre si**: `docs/operations/pre-prod-checklist.md:34`
pede **30k VUs** com p95 < 200 ms; `docs/testing/load.md:3,14-15` descreve **20k VUs**. E o
script que a própria `load.md` cita — `scripts/load-test.k6.js` — **não existe no
repositório** (conferido em 18/09).

- [ ] Reconciliar o número (30k vs 20k) e registrar a decisão no `load.md`.
- [ ] Escrever o `scripts/load-test.k6.js` que hoje só existe como bloco de código na
      documentação.
- [ ] ⚠️ O roteiro atual bate só em `/api/projection` (`load.md:25`). A noite de 04/10 não
      é feita de chamadas de API: é feita de **páginas**. Incluir as rotas que o leitor
      abre (`/`, `/uf/[sigla]`, `/governador`, `/senador`, `/deputado-federal`).
- [ ] Aceite: **p95 < 200 ms**, error rate **< 0,1%**, cache hit **> 99%** (`load.md:32-34`).
- [ ] Rodar com o payload medido na S09 — não com o payload de dev.

### 4. Bug bash exaustivo *(migrado da S08 antiga)*

- [ ] **Desktop**: Chrome, Firefox, Safari, Edge — última versão.
- [ ] **Mobile**: iOS Safari (último iPhone), Chrome Android (último Pixel/Samsung).
- [ ] Slow 3G simulado.
- [ ] `prefers-reduced-motion` ON (RNF-026).
- [ ] VoiceOver + NVDA — passada manual.
- [ ] Cobrir explicitamente o hero de 1º turno: legibilidade da faixa de incerteza a
      **375px**, estados "aguardando projeção", `data-trilha` nas 4 rotas.
- [ ] **Novo desde a S08 antiga**: cobrir o **gráfico da noite** (spec 020) a 375px, nos
      dois temas, com a série desenhada — e não só no estado vazio.
- [ ] **Novo**: cobrir `/candidatos` (spec 018) e o estado de **fase pré-eleição**
      (spec 019), que não existiam quando a lista original foi escrita.
- [ ] ⚠️ `rm -rf .next` antes de qualquer passada visual — o cache já fez o Lighthouse
      auditar folha de estilo de maio.

### 5. Env de produção e DNS *(migrado da S08 antiga)*

- [ ] `TSE_BASE_URL` de volta para `https://resultados.tse.jus.br/oficial`.
- [ ] `INGEST_WINDOW=17-04` — a janela diurna era só do simulado.
- [ ] `TSE_MAX_RPS`, `INGEST_CONCURRENCY` e `maxDuration` nos valores calibrados na S09.
      ⚠️ Em produção `TSE_MAX_RPS` fica **ausente**: é override global e anularia o teto
      por cargo de `lib/config/cargos.ts` (`pre-prod-checklist.md:18`).
- [ ] Decisão de orçamento de ciclo aplicada (gating por EA15 vs. lock anti-overlap).
- [ ] `SLACK_WEBHOOK_URL` presente em Production, não só em Preview (herda da S08).
- [ ] `EDGE_CONFIG` ativa e validada em produção — segue **comentada** no `.env.local`
      desde 18/05 por timeout do endpoint (`pre-prod-checklist.md:30`).
- [ ] DNS: `salacofre.com.br` **+** `.com` apontando para a Vercel; SSL automático conferido.
- [ ] Rolling Release configurado com canary de 10% inicial. ⚠️ Em 17/05 uma rolling
      release ficou **parada nos 10%** sem ninguém notar — conferir a promoção, não só a
      configuração.
- [ ] `TSE_COD_ELEICAO` real — **trilho externo** (D4): o TSE insere os parâmetros oficiais
      no data center em 03/10. A env é valor único validado por regex e trocar não exige
      redeploy de código.

### 6. Imagens de compartilhamento

A spec **009-compartilhamento-meta** (OG dinâmica, share buttons, sitemap) foi **diferida
em 05/09** e continua diferida. O que resta é o mínimo:

- [ ] Conferir que o **card estático de fallback** renderiza em WhatsApp, X e Threads —
      um link do site compartilhado no dia D não pode aparecer sem imagem nem título.

### 7. Runbook D-1 *(migrado da S08 antiga)*

- [ ] Ensaio operacional: simular incidente "TSE fora do ar por >5 min" e responder pelo
      runbook.
- [ ] Ensaio: bloqueio de IP por 10 min durante a apuração — qual é a resposta?
- [ ] **Novo**: ensaio "Edge Config fora do ar" — é o cenário que a spec 013 existe para
      cobrir, e é onde a contradição do item de spec se paga ou se cobra.
- [ ] Documentar o processo de hotfix no dia D: quem aprova, como sai o deploy
      emergencial. ⚠️ O hook de pre-commit está **ativo** (`core.hooksPath=.githooks`,
      `biome check` na árvore inteira, ~150 ms) e **aborta o commit** se reprovar;
      `--no-verify` exige ordem explícita do dono. Um hotfix às 21h não é hora de descobrir
      isso — o conserto é `pnpm lint:fix`.
- [ ] Congelar a `main` — último commit pelo menos 24 h antes do dia D.
- [ ] ~~Ensaio de pausa do cron (`CRON_ENABLED=false` por 30 s e religar)~~ — **retirado do
      dia D em 27/09**: trocar variável só vale com publicação nova, e o ensaio custaria duas no
      dia da eleição. O freio segue descrito em [D1](./_D1-04out2026.md) Parte 3.

---

## Opcionais explícitos — itens cortados pelo dono

Entram **como opcionais**, não como pendências. Ficam aqui para não sumirem do mapa; não
entram no Definition of Done e não bloqueiam nada.

- **spec 012 — painel de operação (`/_status`)** — cortada. `app/_status/` tem só um
  `.gitkeep`. ⚠️ Consequência de documentação: RF-012.1 e RF-012.2 estão na matriz de RFs
  apontando para uma spec sem código, e RF-056 (spec 010) depende dela. Decidir se a 012
  vira `cancelled` formalmente ou fica `draft` indefinidamente — é decisão de rastro, não
  de produto.
- **spec 008 — brushing & linking** — diferida desde a S05.
- **Replay do 2º turno** — o harness (`scripts/replay-2022.ts`, `api/model/replay_batch.py`)
  roda só 1º turno. Carry-over aberto desde a S06.
- **Melhorias do mapa de Deputado Federal.**

---

### 8. Herdados da S07 — triados no fechamento de 18/09

Referência: [S07 § Triagem](./2026-S07-f6-simulado-hero-1t.md#triagem-das-60-caixas-restantes).

- [ ] **Endurecer `readProjection` com `AbortController`** *(S07 linha 750)* — carry-over que
      vem desde a S06. Conferido em 18/09: `grep -n "AbortController\|timeout\|signal"
      lib/edge-config/reader.ts` → **zero ocorrências**. Não há timeout nenhum hoje; uma
      leitura lenta do Edge Config prende o render sem teto. Medições anteriores: ~1 s em
      dev, ~5 s em produção.
- [ ] **Backup do Postgres (snapshot diário do Neon)** *(S07 linha 752)* — é a chore 2 desta
      sprint. Conferido em 18/09: não há workflow, cron nem script de backup em lugar nenhum
      do repositório (`.github/workflows/` tem só `ci.yml`, com 3 jobs). Só o console do Neon
      pode confirmar se existe algo fora do repositório.

---

## Definition of Done

- [ ] **As 22 caixas de `docs/operations/pre-prod-checklist.md` estão marcadas OU
      dispensadas com justificativa escrita no próprio arquivo.** Verificável:
      `grep -c "^- \[ \]" docs/operations/pre-prod-checklist.md` → **0**.
- [ ] **ADR resolvendo a contradição da spec 013 existe**, e `spec.md` e `design.md` da 013
      passam a dizer a mesma coisa sobre o Edge Config.
- [ ] **`/manutencao` testada com o gatilho forçado** — captura da página servida, e prova
      de que ela renderiza com o Edge Config indisponível (se o ADR decidir que ela não o lê).
- [ ] **Backup restaurado num branch do Neon**, com o tempo de restauração cronometrado e
      escrito no runbook.
- [ ] **Teste de carga executado** com o número reconciliado de VUs, contra as **páginas**
      e não só contra `/api/projection`, atingindo p95 < 200 ms e error rate < 0,1%.
      `scripts/load-test.k6.js` existe no repositório.
- [ ] **Bug bash concluído** em desktop + mobile, com a lista de achados fechada: zero bug
      crítico aberto; zero bug `HIGH` sem mitigação aceita por escrito.
- [ ] **Dois ensaios de incidente executados pelo runbook** (TSE fora do ar; Edge Config
      fora do ar), com o tempo de resposta registrado.
- [ ] **Processo de hotfix documentado e ensaiado uma vez**, incluindo o comportamento do
      hook de pre-commit.
- [ ] **Card estático de compartilhamento conferido** nos três apps.
- [ ] 🔴 **Mutação aplicada à mão em cada teste novo desta sprint** — aplicar a mutação,
      confirmar o **vermelho**, restaurar, provar com `diff`. Vale inclusive para os testes
      da página de manutenção: um teste que renderiza a página e confere que ela não
      quebrou passa com qualquer conteúdo.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` verde e
      `.venv-model/bin/python3.14 -m pytest` verde (baseline: 560).
- [ ] **Último commit em `main` ≥ 24 h antes do dia D.**

---

## Riscos da sprint

- **Bug crítico descoberto tarde** — esta é a última porta antes de 04/10, e um bug achado
  no fim pode não ter conserto seguro. Mitigação: o bug bash roda **cedo** na sprint, não
  no fim; e o congelamento da `main` é item de DoD, não intenção.
- **A contradição da spec 013 ser resolvida "na implementação"** — a tentação é codar e
  decidir depois. Se a página ler o Edge Config, ela morre junto com ele, e ninguém
  descobre até o dia em que ele cair. Mitigação: ADR **antes** da primeira linha; o ensaio
  "Edge Config fora do ar" é o teste da decisão.
- **O teste de carga medir a coisa errada** — 30k VUs contra `/api/projection` e p95 verde
  não dizem nada sobre a home renderizando para 30 mil pessoas. Mitigação: o roteiro cobre
  páginas, e roda com o payload medido na S09.
- **O checklist ser fechado marcando caixas** — 22 caixas em branco viraram 22 caixas
  marcadas sem que nada mude. Mitigação: cada caixa fecha com **evidência** (comando
  rodado, captura, número medido) ou com **dispensa escrita**; a caixa 1 é o lembrete de
  que o inverso também acontece (feita em 05/09, em branco desde então).
- **Backup configurado e nunca restaurado** — é a forma mais comum de não ter backup.
  Mitigação: a restauração ensaiada é item de DoD.
- **A rolling release parar no canary sem ninguém ver** — aconteceu: ficou nos 10% desde
  17/05, invisível. Mitigação: conferir a **promoção a 100%**, com hora, não a
  configuração.
- **Opcionais virarem escopo** — "já que estamos aqui, o `/_status` seria útil". Mitigação:
  a seção de opcionais é explícita e não entra no DoD; qualquer promoção exige decisão do
  dono registrada em "Replanejamentos mid-sprint".

---

## Replanejamentos mid-sprint

_(preencher se mudar)_

---

## Retrospective (preencher ao fechar)

- O que funcionou:
- O que melhorar:
- Carry-over pra dia D:

---

## Cross-refs

- Sprint anterior: [2026-S10-f7-verdade.md](./2026-S10-f7-verdade.md)
- Próximo marco: [_D1-04out2026.md](./_D1-04out2026.md) — **1º turno, 04/10/2026**
- Specs tocadas: [013-pagina-manutencao](../specs/013-pagina-manutencao/spec.md) · [010-operacao-monitoramento](../specs/010-operacao-monitoramento/spec.md)
- Specs opcionais: [012-dashboard-status](../specs/012-dashboard-status/spec.md) · [008-interatividade-brushing](../specs/008-interatividade-brushing/spec.md)
- Checklist pré-produção: [../operations/pre-prod-checklist.md](../operations/pre-prod-checklist.md)
- Runbook: [../operations/runbook.md](../operations/runbook.md)
- Teste de carga: [../testing/load.md](../testing/load.md)
- Disponibilidade (RNF-012): [../nfr/availability.md](../nfr/availability.md)
- Constituição § 7 (resiliência operacional): [../constitution.md](../constitution.md)
- Backlog: [backlog.md](./backlog.md)
