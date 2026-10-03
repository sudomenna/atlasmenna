# Prompt de retomada — cole isto numa sessão nova

> Gerado em **2026-09-13** às 00h59 e **atualizado às 05h**, depois de mais 19 commits.
> Substitui a versão de 12/09, que nasceu com dois erros.
> Se hoje não for 13/09, **recalcule os dias** até 15/09 (simulado 1) e 04/10 (1º turno).

---

Continuando o AtlasMenna. Leia primeiro, nesta ordem:

1. `docs/_meta/handoff-2026-09-13.md` — **comece por aqui**, é o estado completo
2. `docs/reference/risks.md` — as **quatro primeiras linhas** de *Riscos ativos* reenquadram o projeto
3. `docs/operations/runbook.md` — a rota de fuga de deploy está no topo, de propósito
4. `docs/specs/017-deputado-federal/design.md` — D1 a D10, o contrato do payload de Deputado
5. `docs/testing/tse-simulados.md` — **Passo 0 e Passo 0b** são o que importa no dia 15
6. `docs/constitution.md` — está em **1.4**

**Branch `main`, árvore limpa, tudo empurrado.** `origin/main` = `45b79e1` (ou mais recente).

## ⏱️ O que mudou entre 00h59 e 05h — isto reescreve boa parte do que vem abaixo

| o texto abaixo diz | hoje |
|---|---|
| spec 017 em `implementing`; **"RF-127 completo"** listado como trabalho a fazer | **`shipped`**, RF-127 **completo e no ar** |
| Deputado ingerido por UF, 27 alvos, cron de 15 min | **~6.110 alvos de par município×zona**, 6 fatias, volta de **30 min** (ADR-0036) |
| baseline 1.708 vitest / 333 pytest | **1.750 vitest / 374 pytest** |

**ADRs novos**: **0036** (granularidade fatiada do cargo 6) e **0037** (UF sem faixa entra como
constante no IC95 nacional da bancada).

**Cinco defeitos silenciosos achados e corrigidos**, todos da mesma família — *a verificação
confirmava a forma e não o conteúdo*: o interruptor de emergência congelava o dado em vez de
reverter; a whitelist do preview rejeitava os cargos 5 e 6 **no código** (o simulado rodaria verde
sem tocar em Senador nem Deputado); uma escotilha de diagnóstico desativava o interruptor; a tela
afirmava ao leitor uma granularidade desfeita três horas antes; e a trava contra multiplicação de
votos **não estava ligada ao ciclo** do cargo 6 — com o ADR afirmando por escrito que estava.

⚠️ **Uma dívida nova, com prazo 04/10**, em `docs/reference/risks.md`: a trava de sanidade agora
cobre o cargo 6, mas **nenhum dos dois ramos tinha teste provando que ela está ligada** — isso foi
escrito em 13/09. Se o Passo 0 do simulado reprovar, a premissa da fatia cai e os votos multiplicam.

⚠️ **Pode haver trabalho de outra sessão não commitado**: `dado_ts` (separar a hora do dado da hora
do cálculo), alarme de apuração parada e ADR-0038 estavam prontos e aguardando decisão às 05h.
**Confira o git.**

**Confira o git antes de acreditar em qualquer coisa que este arquivo afirme.** A versão anterior
deste prompt dizia que havia dois commits não empurrados (estavam empurrados) e mandava terminar a
spec 017 (já terminada). Documento envelhece; o disco não mente.

**Baselines** (medidos 2× em 13/09): **1.708 vitest** (1 pulado) · **333 pytest**
(`.venv-model/bin/python3.14`) · typecheck limpo · lint com **5 erros e 5 avisos pré-existentes**
(não tente consertá-los) · nenhuma cross-ref quebrada.
Gate OT-4 **reprovando**: MAE@1h PT 2,3623pp (teto 2) / cobertura 82,5% (piso 90) — bloqueia a
**spec 002**, não a 017.

⚠️ `pnpm test` exige `set -a; . ./.env.local; set +a` antes — sem isso 10 arquivos de banco falham
e parece regressão. E os testes de integração sobem Python (~11 s cada): **sob carga, um deles
reprova de forma intermitente**. Rode de novo com a máquina ociosa antes de investigar.

---

## Como falar comigo

**Não sou engenheiro.** `CLAUDE.md § 0` é regra: comece pela consequência, não pelo mecanismo;
termo técnico só sem substituto e explicado na mesma frase; analogia concreta antes de abstração.
Não vale para ADR, commit, spec nem briefing de subagent — ali precisão de vocabulário é
obrigatória. Quando eu perguntar algo técnico direto, responda no nível da pergunta.

---

## O estado, em cinco linhas

- **A spec 017 (Deputado Federal) está implementada** e passou nos 4 gates. Status `implementing`.
- **O site está no ar com o código atual.** Até 13/09 ele servia o build de **17 de maio**.
- **`git push` volta a publicar sozinho** — provado com `source: git`, não pelo painel.
- **Existe uma rota de fuga de deploy**, criada e testada, documentada no topo do runbook.
- **O que falta para o simulado depende do TSE**, e há uma vigia automática esperando a resposta.

---

## O que fazer, na ordem

**1. Nada, até o TSE responder.** O chamado foi aberto em 13/09. Sem o `codEleicao`, a ingestão
não roda em ambiente nenhum — `lib/tse/targets.ts:285` **lança** sem ele. A vigia
(`~/.claude/scheduled-tasks/vigia-tse-2026`) roda de hora em hora e avisa.

⚠️ Se nada chegar até a manhã de **15/09**, o protocolo do simulado **para no Passo 1**. Não
prosseguir por tentativa e erro: um 404 por URL adivinhada bloqueia o IP por 10 minutos e queima
uma das quatro janelas de teste.

**2. Quando o código chegar:** criar `TSE_COD_ELEICAO` **só no preview** (as outras 7 variáveis do
simulado já estão lá), e rodar o **Passo 0** — `pnpm verify-fatia-premise`. É a pergunta mais cara
de errar do projeto.

**3. Trabalho técnico que não depende de ninguém**, em ordem de valor:

- ~~**RF-127 completo**~~ — **feito em 13/09** (`api/model/cadeiras_bootstrap.py`). O intervalo de
  cadeiras existe e está no ar. ⚠️ Atenção ao que ele **não** é: mede a variação entre as zonas
  **já apuradas**, e **não** o voto que falta chegar — no cargo 6 continua sem projeção de voto
  (design § D9). Quem sinaliza o que pode virar é a marcação de cadeira indefinida.
- **Contraste de cor de partido** — **a maior pendência técnica agora.** PSOL 2,08 e NOVO 2,72
  contra piso de 3:1 da WCAG 1.4.11. ⚠️ O gerador da paleta registra **quatro** valores abaixo do
  piso, não dois — PSB 2,20 e o cinza de fallback 2,39 também. É do gerador, alcança o mapa
  nacional e a ficha de estado. **Prazo: antes de 04/10.**
- **e2e/a11y das rotas de Deputado e de `/sobre-o-modelo`** — elas **não estão** em
  `tests/e2e/a11y-audit.spec.ts` nem em `perf-budget.spec.ts`; foram auditadas à mão em 13/09, sem
  rede contra regressão. Mais `GET /api/projection?cargo=deputado-federal`, ainda não implementado.
- **SEO 91/100 em todo o site** (meta 95): falta `metadataBase` em `app/layout.tsx`, o que deixa a
  URL canônica relativa. Pré-existente e site-wide, confirmado numa rota não tocada.

**4. Minha decisão pendente:** `SLACK_WEBHOOK_URL`. Sem ela **não há alarme nenhum** na noite da
apuração — uma falha vira silêncio, não aviso.

---

## Não reabra

D1 a D10 de `docs/specs/017-deputado-federal/design.md` — em especial **D1** (Deputado não reusa
`EdgePayload`), **D2** (`vagas_obtidas` não vai à tela) e **D9** (a tela não chama o número de
projeção). ADR-0035 D1/D2/D3. As duas emendas ao ADR-0026. O teto de rps por cargo. D21/D22/D23 do
ADR-0034 e as quatro exceções constitucionais. A degradação pré-acordada da 017, que **não** foi
acionada — o método passou com 511/513.

---

## O risco que ainda importa mais que todo o resto

**Não foi verificado que o arquivo do par traz a *fatia* da zona naquele município, e não a zona
inteira.** Se a premissa cair, `merge_pairs_into_zonas` **multiplica os votos por até 8×** em ~62%
das zonas.

Quatro linhas de evidência convergem a favor, nenhuma é prova. **Não teste sondando URL** — a
constituição § 1 proíbe. O **Passo 0** resolve, e virou um comando:

```bash
pnpm verify-fatia-premise --fixtures tests/fixtures/tse/2026-sim
```

exit 0 = fatia · exit 2 = multiplicação, **pare** · exit 1 = inconclusivo, que **não** é sinal
verde. `check_zona_merge_sanity` é a rede enquanto isso.

---

## Armadilhas que estas sessões pagaram para aprender

1. **Relatório de subagent é hipótese.** Onze erraram de formas plausíveis em 11–13/09 — inclusive
   o `spec-syncer`, que creditou a uma tela quatro componentes que ela não importa. **Confira no
   disco.**
2. **Teste que passa não prova nada.** Verifique por **mutação**, você mesmo: quebre o código de
   propósito e confirme que o teste cai. Três formas distintas de teste decorativo já apareceram.
3. **Default silencioso em conversor de enum já mordeu 3 vezes.** A última mandava todo payload de
   Senador para a chave do Presidente. Procure ativamente.
4. **Painel dizendo "conectado" não é prova de nada.** A integração Git dizia isso por 4 meses
   enquanto nada era construído. Prova é `source: git` na API.
5. **Duas camadas podem falhar separado**: o GitHub App instalado (acesso ao repositório) e o
   webhook do projeto (avisa do push). `vercel git connect` responde *"already connected"* e não
   faz nada — precisa `disconnect` **e depois** `connect`.
6. **A ajuda de comando pode mentir.** O `--dpl` de `vercel rolling-release abort` é o destino do
   rollback, não o canário, apesar do texto dizer o contrário.
7. **A prosa fica para trás quando o dado muda.** Asserção **negativa** nos testes de tela.
8. **`Map.set` sobre linhas de par** desde a migration 0006 — toda leitura por `(uf, cod_zona)`
   precisa de `SUM(...) GROUP BY`.
9. **Não rode `constitution-guard` em paralelo com agente de implementação** — ele faz `git stash`.
10. **Podem existir outras sessões do Claude na mesma pasta.** Em 12/09 havia uma. Confira.

---

## Credenciais e acessos — o que existe nesta máquina

- **`gh`** tem duas contas; a ativa é `cneeducacao`, o repositório é `sudomenna/atlasmenna`, e a
  conta errada dá 403. Trocar antes do push e **devolver depois**.
- **A CLI `vercel` está logada em outra conta** (Bruna Puga). O caminho que funciona é
  `--token="$EDGE_CONFIG_TOKEN" --scope=sudomennas-projects`, ou `curl` na API.
- **`EDGE_CONFIG_TOKEN`** é de escopo de time e **amplo** — publica, lê e escreve variáveis, lista
  projetos. Está em texto puro no `.env.local`. **Dívida pós-outubro**: trocar por um de prazo
  curto.
- **`VERCEL_DEPLOY_HOOK_URL`** no `.env.local` é **segredo**: quem a tem publica em produção. Não
  commitar, não colar em chat ou ticket.

---

## Comandos

⚠️ **`pnpm test -- <arquivo>` NÃO filtra — roda a suíte inteira.** O `--` não é consumido pelo
pnpm: chega ao vitest como argumento (`vitest run -- tests/...`) e o filtro posicional não se
aplica. **A forma que filtra é `pnpm exec vitest run <caminho>`** (ou `npx vitest run <caminho>`).

Medido em 13/09, lado a lado: a forma correta leva **0,72 s** (1 arquivo, 66 testes); a forma com
`--` não terminou em 40 s. E a prova não é a duração — é o conteúdo do log: apareceram
`model_project_ok` e `zona_merge`, de testes de **integração** que o arquivo pedido não contém.

Custou uma madrugada a uma sessão paralela, que passou horas convencida de estar rodando alvos
isolados enquanto disputava o mesmo Neon de dev com outra. Nada no output acusa — o único sinal é
o tempo, que se lê como "a suíte é lenta mesmo", o que ela de fato é.

```bash
set -a; . ./.env.local; set +a            # antes de tudo que toque banco ou Vercel
pnpm typecheck && pnpm lint && pnpm test
.venv-model/bin/python3.14 -m pytest -q
pnpm tse:watch --once                     # exit 0 = sem mudança, 2 = mudou
pnpm verify-fatia-premise --fixtures tests/fixtures/tse/2026-sim
pnpm edge-config:smoke
```

**Push** (dispara build automático — confirme com `source: git`, não pelo painel):

```bash
gh auth switch --user sudomenna && git push origin main && gh auth switch --user cneeducacao
```

**Publicar sem depender de nada** (rota de fuga, testada em 13/09):

```bash
curl -s -X POST "$VERCEL_DEPLOY_HOOK_URL" | head -c 200
```
