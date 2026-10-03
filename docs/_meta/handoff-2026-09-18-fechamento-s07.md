---
title: Handoff — 2026-09-18 (2ª sessão), a S07 fecha e o trabalho começa a andar sozinho
description: Estado, o que entrou, as armadilhas novas e o prompt de retomada
status: stable
date: 2026-09-18
branch: main
supersedes: handoff-2026-09-18.md
---

# Handoff — 2026-09-18, segunda sessão

**Nenhum commit empurrado.** `main` está à frente de `origin/main` — confira quantos com
`git status -sb`, não com este número, que envelhece no próprio commit que o escreve.
Árvore limpa.

A sessão fez três coisas, nesta ordem: fechou a S07 depois de auditar as 76 caixas
abertas, abriu a S08, e — quando a S08 travou no que é do dono — seguiu pelo trabalho
das S09/S10 que não depende de ninguém.

---

## 1. 🔴 A primeira coisa a fazer

**Empurrar.** O trabalho desta sessão está só na máquina local.

```bash
cd /Users/tiagomenna/Projetos/AtlasMenna && git status -sb | head -1 && git push
```

⚠️ **Confira o número com o comando, não com este documento.** Um handoff não
consegue contar o próprio commit: quando escrevi "17" ainda faltava commitar este
arquivo. `git status -sb` diz a verdade sempre.

⚠️ Confira antes que o CI está verde na `main` — o job `test` ganhou um passo novo
(`pytest`) nesta sessão e **nunca rodou no GitHub**. Está provado localmente com o
comando exato do CI, mas o encanamento do Actions é outra coisa. Se der vermelho, é
quase certo ser ambiente, não os testes.

---

## 2. Baselines — medidos no fim da sessão, por código de saída

| | |
|---|---|
| `pnpm lint` | **exit 0**, 445 arquivos |
| `pnpm typecheck` | **exit 0** |
| Pytest | **576 passando** (entrou em 560) |
| Vitest | **2.649 passando** (entrou em 2.574) |

🔴 **`vitest` sai com código 1 neste ambiente, e ISSO É O BASELINE.** Dez arquivos
falham na **coleta** por falta de `DATABASE_URL`, não nos testes: `ingest-cycle`,
`ingest-model-trigger`, `ingest-routes-auth-cargo`, `model-cycle`, `model-edge-cases`,
`unit/model/repository`, `unit/tse/acompanhamento`, `unit/tse/geo-coverage`,
`unit/tse/historical-coverage`, `unit/tse/repository`. Se o número de arquivos que
falham na coleta **mudar de 10**, aí sim é regressão.

---

## 3. O estado das sprints

| Sprint | Status | Caixas |
|---|---|---|
| [S07](../sprints/2026-S07-f6-simulado-hero-1t.md) | **done**, `goal_atingido: false` | fechada |
| [S08 — Enxergar](../sprints/2026-S08-f7-enxergar.md) | **active** | 23 fechadas · 9 abertas |
| [S09 — Provar](../sprints/2026-S09-f7-provar.md) | planned | 3 fechadas · 25 abertas |
| [S10 — Verdade](../sprints/2026-S10-f7-verdade.md) | planned | 38 abertas |
| [S11 — Resiliência](../sprints/2026-S11-f7-resiliencia.md) | planned | — |

Exatamente uma `active`, conferido.

⚠️ **A S08 está travada no dono, e por isso houve trabalho de S09/S10 com a S08 ainda
aberta.** Das 9 caixas abertas da S08, **5 são a mesma decisão** (o canal de alarme)
contada em lugares diferentes; 2 exigem banco descartável; 2 dependem das anteriores.
Isso foi escolha consciente, não desvio — mas se você preferir fechar a S08 antes de
seguir, o que falta está listado no § 5.

---

## 4. O que entrou

```
a6c9571  a S07 fecha admitindo que não cumpriu o objetivo, e as 76 caixas ganham destino
279988f  o modelo ganha portão de CI, e um vigia que enxerga de fora
9728803  a série que congela em silêncio passa a contar e a gritar
accf620  o intervalo de confiança passa a ter quem o proteja
946b0ec  "não consegui olhar" deixa de sair com a cara de "nada mudou"
437fed2  RF-057 e RF-056 ganham dono único, o ciclo 010↔012 cai, RF-060 ganha teste que roda
c0508c8  o alarme que ninguém testava ganha regra separada do transporte
618b95c  seis linhas do "pronto" já cumpridas deixam de mentir
f4fd458  os documentos param de afirmar o que deixou de ser verdade
47f265d  `pnpm alerta:teste` — provar o canal sem encostar no TSE
e12a00e  a linha do gráfico é vista pela primeira vez
0537955  as quatro rotas desenham a linha — gov e senador entram
d15c254  a gaveta de dados ganha freio — mas só quando sabe que está cheia
042ed9e  os arquivos reais do simulado viram guarda, e a premissa mais cara vira teste
3cbcdbc  a retrospectiva do 1º turno deixa de nascer vazia em 25/10
9cd2746  o contraste de não-texto ganha requisito, conserto e guarda
2072a2c  remove os imports mortos que a troca de textForParty deixou
```

### Os cinco achados que valem mais que o código

1. 🔴 **O intervalo de confiança não tinha teste.** Trocar os percentis `2.5/97.5` por
   `10.0/90.0` em `api/model/extrapolation.py:389-398` — o que converte o IC de **95%
   para 80%** e estreita a faixa em todas as projeções — deixava os 560 testes verdes.
   Consertado (`tests/unit/model/test_extrapolation.py`, 3 casos). **Entrou na S08, não
   na S10, de propósito**: a S10 vai mexer nesse número pela D8, e mexer num número que
   nada protege é consertar no escuro.
2. 🔴 **`projection-archive-*` é lida e nunca escrita.** Em 25/10 o `<TurnoOneRecap>` do
   hero de 2º turno viria `null` a noite inteira. Consertado sem job novo: a chave
   `projection-current-*-t<N>` carrega o turno e vira, por construção, o retrato final.
3. 🔴 **RNF-006 significa TRÊS coisas em 12 lugares.** O real é *"defasagem TSE → tela
   < 90 s"*; é citado para o gate MAE (8×) e para `p95 < 2000 ms` (4×). **Nenhum RNF
   menciona MAE nem 2000 ms.** O handoff anterior registrava 2 citações. Insumo direto
   do ADR da S10.
4. 🔴 **RF-057 e RF-060 constavam cobertos e não eram.** O do RF-060 vivia atrás da
   guarda `ALLOW_DB_WRITE_TESTS` e nunca executava; o do RF-057 simplesmente não
   existia (`grep -rln notifySlack tests/` → zero). Os dois ganharam teste que roda.
5. **O gráfico da noite nunca tinha sido visto funcionando.** Publicado nas 4 rotas em
   18/09, e nenhuma fixture tinha série. Agora as quatro desenham — verificado no
   navegador, claro e escuro.

### Comandos novos

```bash
pnpm vigia:ciclo      # vigia externo: o ciclo está vivo?  0=ok · 2=parado · 1=cego
pnpm alerta:teste     # manda um alarme de teste SEM encostar no CDN do TSE
```

E `.claude/launch.json` ganhou `atlasmenna-dev-sim` (modo simulação no navegador).

---

## 5. Onde retomar

### 🔴 O que só o dono faz, e a janela do TSE é 22–24/09

1. **Colar `SLACK_WEBHOOK_URL`.** É 5 das 9 caixas abertas da S08. O passo a passo está
   na S08 § 1; o teste de chegada é `pnpm alerta:teste`, que **não toca o CDN do TSE**
   (forçar erro lá é proibido — ADR-0020, bloqueio de IP por 10 min).
   ⏸️ Adiado pelo dono nesta sessão, com a consequência escrita: se a janela rodar
   antes, roda sem ninguém ser avisado de falha.
2. **Decidir sobre um vigia hospedado.** O `pnpm vigia:ciclo` depende da máquina do dono
   estar ligada. Um dead-man's switch de fora custa dinheiro ou conta nova.

### Sem bloqueio — dá para seguir sozinho

- **Deputado Federal no gate e2e de a11y** — `tests/e2e/a11y-audit.spec.ts` cobre 6
  rotas e **nenhuma das duas de Deputado**.
- **Contraste do mapa coroplético** — as REGIÕES ainda usam a cor-base. Ficou fora de
  propósito: região é preenchimento com extensão e envolve contraste entre vizinhas,
  não só contra o papel. Precisa de verificação visual própria.
- **Legenda do mapa sem contorno** — achado desta sessão, registrado no RNF-035
  § Lacunas. Os degraus da rampa se separam por `gap: 2` sobre a página.
- **Luminância dinâmica no `HexCartogramBrasil`** — hoje é a matriz fixa `[1,2,5,6]`.
- **`compute_swing_descritivo` e `brancos_nulos`** — dois números que o modelo promete
  e emite `None`.
- **E2E do gráfico da noite** (RF-172b e RF-176e) — as duas lacunas reais que impedem a
  spec 020 de fechar.

### Precisa de banco descartável

- `rf-coverage-checker` sobre RF-008/RF-009 (pares município×zona).
- Medir a escrita da série no banco (S09 § 3).

🔴 **Nunca com o `.env.local` carregado** — o `DATABASE_URL` de lá é **produção**.

### Precisa da janela do TSE

19 itens no [trilho externo](../sprints/_trilho-externo.md). **O simulado de 22–24/09
dispara sozinho** — ninguém precisa acionar nada; o risco é rodar e ninguém ver.

---

## 6. Decisões do dono — não reabrir

As D1–D12 do [handoff anterior](./handoff-2026-09-18.md) § 3 continuam valendo. Em
especial:

- **D8** — a promessa de 95% será **BAIXADA para o número real** (MAE@1h 2,3623pp,
  cobertura 82,5%), **não** consertada. 🔴 *"Uma sessão zerada, sendo prestativa, vai
  querer tentar a terceira. Não tente."*
- **D9** — sprints por dependência, sem data. ⚠️ As quatro sprints novas citavam "D2"
  para essa decisão; **D2 é a decisão sobre o eixo do gráfico**. Corrigido em 8 lugares.
- **D10** — autonomia alta, parada só para: **mudar a estrutura do banco ou despejar
  dados nele**, **publicar no site**, **gastar dinheiro**, e **decisão de produto que
  muda o que o leitor vê**. Não para pela escrita de rotina do ciclo.

Decisões tomadas **nesta** sessão:

| # | Decisão |
|---|---|
| **D13** | A **S07 fecha como `done` com `goal_atingido: false`**, não `cancelled` — ela entregou 4 specs, o redesign e 3 ADRs; o que faltou está na retro. |
| **D14** | O canal de alarme fica **adiado**, e o trabalho segue pelo resto. Consequência aceita e escrita. |

---

## 7. Armadilhas — as antigas continuam, e há quatro novas

### As de sempre

1. **`pnpm test:py` está QUEBRADO.** Use `.venv-model/bin/python3.14 -m pytest`.
2. 🔴 **NUNCA declare `ALLOW_DB_WRITE_TESTS` com o `.env.local` carregado.**
3. **O gate e2e de a11y não roda contra build local** — o Vercel BotID derruba e o
   sintoma é timeout de NAVEGAÇÃO. Use `PLAYWRIGHT_BASE_URL` contra o site publicado, e
   `npx playwright install webkit` antes.
4. **Hook de pre-commit ativo** — `biome check` na árvore inteira. Conserto:
   `pnpm lint:fix`. ⚠️ Ele barra **erro**, não **aviso**: nesta sessão um commit passou
   com dois imports mortos.
5. **Nunca `git checkout --`** para desfazer mutação — cópia no scratchpad e `diff`.

### As novas, todas medidas nesta sessão

6. 🔴 **Restaurar o arquivo NÃO restaura o que roda, em Python.** O CPython invalida
   `.pyc` por **mtime + tamanho**, e uma mutação de um dígito preserva os dois. Um `cp`
   de restauração no mesmo segundo faz o teste continuar rodando o código **mutado** —
   com `diff` vazio e `git diff` vazio. Custou uma conclusão errada ("a mutação
   sobreviveu"). **Limpe `__pycache__` nos dois lados.** Registrado em
   [`orquestracao-paralela.md`](./orquestracao-paralela.md) § 7.4.
7. 🔴 **Confira por CÓDIGO DE SAÍDA, não pela última linha.** Um
   `pnpm typecheck 2>&1 | tail -1` devolveu saída vazia enquanto o comando saía com 1 e
   havia **cinco erros de tipo**. O próprio comando de verificação escondeu o defeito.
8. 🔴 **`du -sh` não é medição de tamanho** — arredonda para blocos de disco. Afirmei
   dois números errados com ele. Para conteúdo, some bytes: `git ls-tree -r -l`.
9. **O bloco claro de `app/tokens-party.css` é `@theme static`, não `:root`** — o único
   `:root` do arquivo é o **escuro**. Medi o tema errado e obtive "71 cores
   reprovando". Há um teste que afere o instrumento contra um número que o próprio
   arquivo documenta em comentário.

### A regra que atravessou o dia

**O mesmo conceito com duas casas.** Apareceu três vezes:
o alarme (`notifySlack` em TS, `_alert_slack` em Python — um agente contou 4 onde há
**10**), a série (topo do payload nacional × dentro de `series_temporais` no detalhe de
UF — o deslocador de relógio só olhava um), e o RF com duas specs donas (010 × 012).
**Quando um conceito tem duas casas, toda travessia precisa visitar as duas.**

---

## 8. Os erros desta sessão, e o que eles ensinam

Todos estão nas mensagens de commit, com o número medido. Os quatro que mais ensinam:

1. **Despachei o agente errado.** Mandei implementar o alarme para o `model-validator`;
   ele **recusou corretamente** e apontou o `spec-implementer`. Confundi "mexe em
   `api/model/`" com "é trabalho de modelo".
2. **Corrigi dois números de agentes, e um agente me corrigiu.** Um agente "corrigiu" os
   9 alarmes para 4 (contou só metade); outro marcou a Fase 3 da spec 020 como feita
   (os arquivos existem, o conteúdo não). Em compensação, foi o `rf-coverage-checker`
   que apontou que a lógica do RF-057 é testável **sem** o canal configurado — eu tinha
   aceitado tacitamente que não era.
3. **Dois testes meus não discriminavam.** Um afirmava "nenhum GET ao CDN" com o banco
   mockado (não sairia requisição de jeito nenhum) — **removido**, com a lacuna escrita
   no lugar. Outro fazia `toContain("DATA_FILL_STROKE")` e passava com o uso apagado,
   porque o `import` mantinha a string — forma em vez de conteúdo, pegando o próprio
   teste que persegue isso.
4. **Uma mutação "sobreviveu" e a investigação mudou a conclusão.** Remover
   `out[-1] = _r(valor_final)` não quebrou nada porque a fórmula já converge — a linha
   é redundante **por acaso**, não por desenho. O teste era forte; o comentário é que
   atribuía a garantia à linha errada.

> **A conclusão que vale mais que os quatro:** três defeitos reais desta sessão só
> apareceram **olhando a tela** — o gráfico congelado enquanto o cabeçalho dizia
> "agora", o separador invisível da barra, e o mapa municipal no estado errado. Teste
> não substitui abrir o produto.

### O que NÃO fazer

- Reabrir a decisão dos 95% (D8).
- Tentar a 3ª tentativa do gate OT-4.
- Sondar URL adivinhada do TSE (404 bloqueia o IP por 10 min).
- Deixar duas sprints `active`.
- Encostar em `docs/PRD.md` (snapshot read-only).
- Criar `CONTRIBUTING.md` (D12).
- Publicar "82,5% de cobertura de um intervalo de 95%" — publique **a faixa**.

---

## 9. Prompt de retomada

```
Retomando o AtlasMenna. Leia primeiro `docs/_meta/handoff-2026-09-18-fechamento-s07.md`
— ele supersede o de 18/09 e tem o estado, as armadilhas medidas e o que falta.

🔴 PRIMEIRA COISA: o trabalho da sessão anterior NÃO foi empurrado.
`git status -sb` diz quantos commits; confira e empurre.
O CI ganhou um passo novo (pytest) que nunca rodou no GitHub.

A sprint ativa é a S08 — Enxergar. Ela está travada no que é do dono: 5 das 9
caixas abertas são a mesma decisão (colar SLACK_WEBHOOK_URL). Por isso a sessão
anterior seguiu pelo trabalho de S09/S10 que não depende de ninguém, e você pode
continuar assim.

Sem bloqueio, em ordem de valor:
  1. Deputado Federal no gate e2e de a11y (as 2 rotas dele não são testadas)
  2. Contraste do mapa coroplético — REGIÕES ainda usam a cor-base; é decisão
     diferente do quadradinho (envolve contraste entre vizinhas) e precisa de
     verificação visual própria
  3. E2E do gráfico da noite (RF-172b, RF-176e) — as 2 lacunas que impedem a
     spec 020 de fechar
  4. compute_swing_descritivo e brancos_nulos — dois números que o modelo
     promete e emite None

Cinco armadilhas que custam horas:
  1. `pnpm test:py` está QUEBRADO. Use `.venv-model/bin/python3.14 -m pytest`.
  2. NUNCA declare ALLOW_DB_WRITE_TESTS com o `.env.local` carregado — é produção.
  3. Em Python, restaurar o arquivo NÃO restaura o que roda: o `.pyc` sobrevive
     quando mtime e tamanho coincidem, e mutação de um dígito preserva os dois.
     Limpe `__pycache__` nos DOIS lados. Ver orquestracao-paralela.md § 7.4.
  4. Confira por CÓDIGO DE SAÍDA, não pela última linha da saída. Um
     `pnpm typecheck 2>&1 | tail -1` já escondeu cinco erros de tipo.
  5. `vitest` sai com código 1 neste ambiente e ISSO É O BASELINE — 10 arquivos
     falham na COLETA sem DATABASE_URL. Regressão é o número mudar de 10.

Baselines: lint 445 arquivos exit 0 · typecheck exit 0 · pytest 576 · vitest 2.649.

Regra de teste desta casa: teste verde não prova nada. Para cada teste, aplique a
mutação você mesmo, confirme o vermelho, restaure e prove com `diff`. E se a
mutação sobreviver, investigue ANTES de concluir que o teste é fraco — nesta
sessão uma "sobreviveu" por bytecode em cache e outra por ser redundante.

E abra o produto. Três defeitos reais da sessão anterior só apareceram olhando a
tela, não nos testes. `pnpm dev:sim` está registrado em `.claude/launch.json`.

Fale comigo em linguagem comum: não sou engenheiro.
```
