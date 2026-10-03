---
id: ADR-0069
title: Renomeação do sistema de SalaCofre para AtlasMenna (03/10/2026) — código, documentação (inclusive registros históricos), projeto Vercel, repositório GitHub e domínio atlasmenna.online; exceções deliberadas mantêm o nome antigo
status: accepted
date: 2026-10-03
---

# ADR-0069 — Renomeação do sistema: SalaCofre → AtlasMenna (03/10/2026)

## Status

Aceito (2026-10-03). Decisão do dono, tomada na véspera do 1º turno.

**Nota histórica (leia antes de usar qualquer documento anterior a 2026-10-03).** Todo documento datado antes de
03/10/2026 que hoje diz "AtlasMenna", `atlasmenna.online` ou `sudomenna/atlasmenna` **dizia originalmente**
"SalaCofre", `salacofre.vercel.app` / `salacofre.com.br` ou `sudomenna/salacofre`. Isso vale para handoffs,
sprints, retros e ADRs antigos, que foram reescritos com o nome novo (Decisão 2). Consequências para quem lê o
histórico:

- O domínio `atlasmenna.online` **não existia** antes de 27/09/2026 (registrado em 2026-09-27) e só foi
  anexado ao projeto em 03/10. Onde um documento anterior a essas datas o cita, o endereço real da época era
  `salacofre.vercel.app`.
- **Medições** de peso, acessibilidade, LCP e afins registradas em documentos antigos foram tomadas contra
  `salacofre.vercel.app`, não contra o domínio novo.
- O contato `contato@salacofre.com.br` **nunca teve registro MX**: nunca recebeu e-mail. Foi removido dos
  User-Agents (Decisão 4); onde ele aparece no histórico, tratar como endereço inexistente.
- O nome do commit é a fronteira: `624b145` é o último commit com o nome antigo no código; a renomeação textual
  está nos commits `0418a27`, `e10e41f` e `981d4e1`.

## Contexto

O produto se chamou SalaCofre desde 2026-05-17. O redesign de setembro já mostrava "AtlasMenna" na interface
pública, de modo que o nome visível ao leitor e o nome do código, dos documentos, do projeto Vercel e do
repositório divergiam havia semanas. Em 03/10/2026, a um dia do 1º turno, o dono decidiu unificar tudo sob
AtlasMenna, incluindo um domínio próprio (`atlasmenna.online`), que substitui o `*.vercel.app` como endereço
público.

A janela é a pior possível para tocar em qualquer coisa: 04/10 é a noite de apuração, com deploy congelado das
16h às 5h (ADR-0063). O que tornou a decisão aceitável foi separar o que é só nome do que é
**comportamento**. Um rótulo de código ou documento não muda o que o sistema faz; já o User-Agent das
requisições ao TSE, os nomes dos stores do Edge Config (que carregam o interruptor de projeção) e a semente do
simulador mudam comportamento ou risco, e precisaram de tratamento próprio (Decisões 4 e 5).

Alternativas: (a) **manter o status quo**, interface com um nome e todo o resto com outro, o estado desde
setembro; (b) **renomear só código e interface**, deixando documentos históricos com o nome antigo, o que
preserva a literalidade dos registros mas exige que o leitor mantenha duas grafias na cabeça; (c) **renomear
tudo, histórico incluído, e registrar a fronteira neste ADR**. O dono escolheu (c).

## Decisão

**1. Renomeação completa, de uma vez, em um único deploy de produção.** Código, testes, documentação, agentes
(`.claude/agents/`) e índice (`docs/_meta/index.json`) passam de SalaCofre a AtlasMenna em três commits
(`0418a27` código e testes; `e10e41f` User-Agents; `981d4e1` documentação, agentes e índice). Um único deploy
leva o conjunto à produção.

**2. Registros históricos também foram reescritos.** Handoffs, sprints e ADRs antigos usam o nome novo. Não é
uma emenda a cada ADR: é uma troca textual global, e a **única** salvaguarda do que era literal é a nota
histórica acima. O corpo decisório dos ADRs antigos não foi alterado além do nome.

**3. Infraestrutura renomeada.**
- Projeto Vercel `salacofre` → `atlasmenna`, mesmo id (`prj_ZEDsW5C8cOr7WredhPZUsx2tm2R3`). A ligação do Git
  continua por `repoId` 1241324365; a Vercel ainda exibe internamente o nome "salacofre" do repositório, sem
  efeito sobre o deploy.
- Repositório GitHub `sudomenna/salacofre` → `sudomenna/atlasmenna`. O GitHub redireciona o endereço antigo
  com 301.
- Domínio novo `atlasmenna.online`, DNS no Cloudflare, CNAME para a Vercel, **proxy desligado**. O apex
  responde 308 para `www.atlasmenna.online`.
- `salacofre.vercel.app` **redireciona (308) para `www.atlasmenna.online`** desde 03/10 ~16h12, preservando
  caminho e query (decisão do dono, antecipando o que estava previsto para depois do 1º turno). Antes de ligar,
  medido nos logs da Vercel (`vercel logs --follow --json`, campo `domain`): **todas** as invocações de cron
  (`/api/ingest/*`) chegam pela URL exclusiva do deployment (`atlasmenna-<hash>-sudomennas-projects.vercel.app`),
  nunca pelo alias — e cron da Vercel não segue redirect. Amostra de 2 min depois de ligar: ingest de
  presidente, governador, deputado-distrital e deputado-estadual seguiu rodando, sem erro. As chamadas
  internas (modelo, `edge-write`) usam `INTERNAL_BASE_URL` (ausente em produção) → `VERCEL_URL`, também a URL
  do deployment.
- **Endereço reserva**: `atlasmenna.vercel.app`, anexado em 03/10 servindo produção **sem** redirect. Não
  depende do DNS da Cloudflare; é o que `docs/sprints/_D1-04out2026.md` cita como contingência.

**4. User-Agents.**

| Cliente | Antes | Depois |
|---|---|---|
| EA20 (`lib/tse/client.ts`) | `SalaCofre/1.0 (+https://salacofre.vercel.app; contato: contato@salacofre.com.br)` | `AtlasMenna/1.0 (+https://atlasmenna.online)` |
| ETL, Senado, Câmara | `SalaCofre-ETL/0.1` | `AtlasMenna-ETL/0.1` |
| `tse-watch` | `SalaCofre-watch/1.0` | `AtlasMenna-watch/1.0` |

O e-mail saiu porque a caixa nunca existiu. `zonas-import.ts` passa a reutilizar `TSE_ETL_USER_AGENT` em vez de
ter string própria. **Medido em 03/10 por volta de 15h45 BRT**: o User-Agent antigo e o novo receberam respostas
byte a byte idênticas (status e hash do corpo) de `resultados.tse.jus.br` (`ele-c.json`, 200),
`resultados-sim.tse.jus.br`, `cdn.tse.jus.br`, `dadosabertos.tse.jus.br`, `legis.senado.leg.br` e
`dadosabertos.camara.leg.br`. Isso afasta o risco de o Akamai do TSE reagir ao nome novo (precedente: o 403 de
`SalaCofre-ETL/0.1` em `cdn.tse.jus.br`), mas é uma medição pontual, não uma garantia sobre a noite de apuração.

**5. Exceções deliberadas, com o nome antigo mantido.**
1. **Stores do Edge Config** `salacofre-edge-config` e `salacofre-edge-config-preview`. São o caminho do
   interruptor de projeção (ADR-0063) na noite da eleição. O código classifica stores por id `ecfg_` e regex,
   não por nome, de modo que renomear depois é seguro. Agendado para **05/10**.
2. **Semente do simulador** `salacofre-simulado-2026`. É semente de gerador pseudoaleatório: trocá-la
   regenera todos os dados simulados. Fica para **05/10**, junto com um `pnpm sim:full`.
3. **Recursos externos** `salacofre-db` (Neon) e `salacofre-blob` (Blob), e as URLs imutáveis de deployment
   `salacofre-*-sudomennas-projects.vercel.app`. Renomeação opcional, **depois de 26/10**.
4. **`docs/_pitch/salacofre-pitch-investidor.pdf`**: binário, inalterado. A versão HTML irmã foi renomeada.
5. **`salacofre.vercel.app`** continua anexado (agora como redirect 308 para o domínio novo), conforme a Decisão 3.

## Consequências

**Positivas**:
- Um nome só no que o leitor e o mantenedor veem: interface, código, documentos, repositório e domínio.
- Endereço público próprio (`atlasmenna.online`), sem depender do subdomínio `*.vercel.app`.
- User-Agent sem e-mail inexistente; `zonas-import.ts` com uma única fonte do User-Agent de ETL.
- O que é comportamento (Edge Config, semente) ficou fora da noite de 04/10 por escolha explícita.

**Negativas**:
- **Perde-se a literalidade do histórico.** Um documento de agosto agora cita um domínio e um repositório
  que, à época, não existiam. Quem investigar um incidente antigo pela grafia (busca por `salacofre`) não
  encontra mais nada no repositório; a nota histórica é a única ponte. Não há como reverter por inferência: a
  troca foi textual e global.
- **Medições antigas parecem ter sido feitas no domínio novo.** Os números de peso e acessibilidade dos
  documentos anteriores a 03/10 foram tomados em `salacofre.vercel.app`; o domínio novo (Cloudflare só como
  DNS, proxy desligado, mesmo projeto Vercel) não tem medição própria.
- **Estado misto residual até 05/10 e depois de 26/10.** Nomes antigos permanecem em stores do Edge Config, na
  semente do simulador, no Neon, no Blob e nas URLs imutáveis de deployment. Quem lê um log ou o painel da
  Vercel vê os dois nomes.
- **Renomeação em véspera de eleição.** Um deploy único concentra o risco de qualquer regressão escondida na
  troca textual. **Reversão**: Instant Rollback da Vercel para o deployment do commit `624b145` e, se
  necessário, renomear de volta o projeto Vercel e o repositório GitHub. O 301 do GitHub não cobre quem já
  tiver o remote antigo em clones, hooks ou integrações com nome fixo.
- **Dois endereços públicos servindo** (`www.atlasmenna.online` e a reserva `atlasmenna.vercel.app`): duas
  origens para BotID, cache e métricas. O alias antigo só redireciona.
- **A vigia da noite** (tarefa agendada local `vigia-noite-1t`) fazia `curl` sem `-L` em
  `salacofre.vercel.app` e teria acusado "site fora do ar" a cada 10 min; foi apontada para
  `www.atlasmenna.online` antes do redirect.
- **Pendências**: itens de 05/10 (stores do Edge Config e semente do simulador, esta com `pnpm sim:full`);
  renomeações opcionais após 26/10; o canal do Slack passa a constar nos
  documentos como `#atlasmenna-ops`, mas **nunca foi criado**, então o nome nos documentos ainda não
  corresponde a nenhum canal real.

## Cross-refs

- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md): o interruptor de projeção
  vive nos stores cujo nome foi mantido (exceção 1). Renomeá-los exige reconfirmar o id do store com
  `pnpm dep:projecao`.
- [ADR-0001](0001-edge-config-no-read-path.md) e [ADR-0012](0012-edge-config-chaves-nomeadas.md): Edge Config
  como caminho de leitura; os stores mantêm o nome antigo até 05/10.
- [ADR-0068](0068-limitador-de-taxa-do-tse-por-cargo.md) e [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md):
  teto de requisições ao TSE (RF-010.3); a troca de User-Agent não altera taxa nem alvos.
- Docs: `docs/sprints/_D1-04out2026.md` (alias antigo como contingência), `docs/operations/runbook.md` e
  `docs/operations/vespera-03-10.md` (reversão e 05/10), `docs/reference/regulatory.md` (User-Agent perante o
  TSE).
- Código: `lib/tse/client.ts` (User-Agent EA20), `TSE_ETL_USER_AGENT`, `zonas-import.ts`, `tse-watch`.
- Constituição § 9 (stack 100% Vercel): a hospedagem não muda, mas o DNS do domínio novo fica no Cloudflare,
  só como resolução (CNAME para a Vercel, proxy desligado, sem CDN nem WAF do Cloudflare no caminho). É a
  única peça fora da Vercel que esta decisão introduz; se a leitura de "toda infraestrutura" incluir DNS,
  isto é um desvio a confirmar pelo dono.
- Commits: `624b145` (último com o nome antigo), `0418a27`, `e10e41f`, `981d4e1`.
