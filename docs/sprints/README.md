# Sprints — AtlasMenna

Camada temporal entre o [roadmap macro](../product/roadmap.md) (fases F1–F8) e as [tasks por spec](../specs/) (granularidade fina).

## Princípio

**Sprints variáveis alinhadas às fases**, não cadência fixa. Cada sprint = 1 fase do roadmap (F4 é a única quebrada em 2 sprints porque 4 semanas é longo demais sem checkpoint).

## Cadência

| Item | Regra |
|---|---|
| **Tamanho** | 1–3 semanas, dependendo da fase. Não é fixo. |
| **Objetivo único** | Cada sprint tem **1 frase** de goal. Se cumpriu, sprint foi sucesso. |
| **Definition of Done** | Toda spec listada em `specs_in_flight:` atinge `status: shipped` passando nos 4 gates. |
| **Carry-over** | Tasks não-completadas viram primeira coisa da próxima sprint, sem renomear sprint. |
| **Cerimônias** | Planning = abrir o arquivo da sprint. Retro = preencher seção `## Retrospective` ao fechar. Daily = ad-hoc com o usuário, sem ritual. |
| **Replanejamento mid-sprint** | Permitido, mas registrado no próprio arquivo. |
| **Status válidos** | `planned`, `active`, `done`, `cancelled` |
| **Apenas 1 sprint `active`** por vez. |

## Cronograma — 13 sprints + 2 marcos + trilho externo

| Sprint | Fase | Período | Status | Goal |
|---|---|---|---|---|
| [S01](./2026-S01-f1-fundacao.md) | F1 | 18/mai → 07/jun (3 sem) | done | Infra Vercel + schema + históricos 2018/2022 + PMTiles |
| [S02](./2026-S02-f2-ingestao.md) | F2 | 08/jun → 21/jun (2 sem) | done | Pipeline TSE end-to-end shipped |
| [S03](./2026-S03-f3-modelo.md) | F3 | 22/jun → 05/jul (2 sem) | done | Modelo estatístico (Caminho C) — `implementing` até simulado oficial |
| [S04](./2026-S04-f4a-home-uf.md) | F4a | 06/jul → 19/jul (2 sem) | done | Home + UF + Sobre-o-modelo (T-01, T-03, T-06) |
| [S05](./2026-S05-f4c-multi-candidato.md) | F4c | 20/jul → 02/ago (2 sem) | done | Foundation multi-candidato 1T presidencial |
| [S06](./2026-S06-f4d-2t-governadores.md) | F4d | 03/ago → 16/ago (2 sem) | done | 2º turno presidencial + Governadores 27 corridas |
| [S07](./2026-S07-f6-simulado-hero-1t.md) | F6 | 06/set → 24/set (2.5 sem) | done ⚠️ | Simulado-ready + Hero 1T — **objetivo único NÃO cumprido** (ingestão real do TSE aconteceu 1×); fechada 18/09, ver [Retrospective](./2026-S07-f6-simulado-hero-1t.md#retrospective--fechada-em-2026-09-18) |
| [S08](./2026-S08-f7-enxergar.md) | F7 | **sem data** (`sequence: 1`) | **active** | Enxergar — alarme, vigia externo, pytest no CI, matriz de rastreabilidade |
| [S09](./2026-S09-f7-provar.md) | F7 | **sem data** (`sequence: 2`) | planned | Provar — o gráfico desenhado, o pipeline medido, freio no store |
| [S10](./2026-S10-f7-verdade.md) | F7 | **sem data** (`sequence: 3`) | planned | Só afirmar o que sustenta — a promessa real, contraste, 4 specs a `shipped` |
| [S11](./2026-S11-f7-resiliencia.md) | F7 | **sem data** (`sequence: 4`) | planned | Sobreviver ao pior — manutenção, backup, carga, checklist pré-prod |
| [_trilho externo_](./_trilho-externo.md) | — | **datas do TSE** | standing | Simulado 22–24/09 · código da eleição 03/10 · cadastro 02–03/10 |
| **[D1](./_D1-04out2026.md)** | — | **04/out** | — | **Produção 1º turno** |
| [S12](./2026-S12-f8a-retro1t.md) | F8a | 05/out → 14/out (1.5 sem) | planned | Análise pós-1T + recalibração modelo |
| [S13](./2026-S13-f8b-prep2t.md) | F8b | 15/out → 24/out (1.5 sem) | planned | Ajustes + bug bash 2T |
| **[D2](./_D2-25out2026.md)** | — | **25/out** | — | **Produção 2º turno** |

> **Hiato 17/ago → 05/set.** O planejamento ficou parado entre o fechamento da S06 e o
> re-baseline de 05/09. As janelas originais da S07 (17–30/ago) e da S08 (31/ago–06/set)
> venceram sem execução e foram re-baselinadas pela decisão D9 do
> [plano de 05/09](../_meta/plano-s07-2026-09-05.md). A S07 e a S08 agora encostam
> continuamente no D1: 06/set → 24/set → 03/out → **04/out**.

## Duas formas de sprint

Desde **2026-09-18** o repositório tem **duas** formas de sprint, e a diferença não é
estilo: é de onde vem a âncora.

| Forma | Âncora | `start`/`end` | Ordem vem de | Quando usar |
|---|---|---|---|---|
| **Com janela** | data de terceiro | datas reais | o calendário | quando a data não é nossa: dia D, 2º turno, janelas de simulado do TSE |
| **Por dependência** | o ritmo do dono | `null` | `sequence:` + `depends_on_sprint:` | quando a data é nossa, ou seja: quase sempre |

**Por que a mudança.** Sprint com data era uma promessa, e três delas não foram
honradas — o hiato de 17/08 a 05/09, o re-baseline D9 e a janela da S08, que nunca
abriu. O esquema afirmava o que a prática não sustentava. Um `start:` que ninguém honra
é pior que campo vazio, porque parece informação.

**O que NÃO mudou, e fica mais importante**: continua valendo **exatamente uma sprint
`active` por vez**. Sem datas, essa regra é a única coisa que responde "onde eu estou".
Ela fica mais rígida, não menos.

⚠️ **Sprint sem data não é sprint sem fim.** O que fecha uma sprint é o seu
`## Definition of Done`, e por isso ele tem de ser verificável linha a linha — cada
item é um comando que alguém roda ou uma evidência que alguém vê, nunca uma intenção.
As sprints S08–S11 são o primeiro exemplar dessa forma; use-as de molde.

**As pós-eleição (S12, S13) e os marcos (D1, D2) continuam com data**, e isso é a
demonstração da regra, não uma exceção a ela: a data delas é do TSE, não nossa.

---

## Template de uma sprint

```yaml
---
id: 2026-SNN
title: Sprint NN — <Tema>
status: planned | active | done | cancelled
start: YYYY-MM-DD
end: YYYY-MM-DD
phase: FN
goal: <1 frase>
specs_in_flight: [NNN-slug, ...]
specs_planned_next: [...]
---

## Objetivo único
<1 frase — se cumprir só isso, sprint foi sucesso>

## Specs in-flight
- [ ] NNN-slug — detalhes em `../specs/NNN-slug/tasks.md`

## Chores fora de spec
- [ ] chore 1
- [ ] chore 2

## Definition of Done
- spec NNN-slug `shipped` (4 gates ok)
- chore X concluído
- ...

## Riscos da sprint
- <risco>: <mitigação>

## Replanejamentos mid-sprint
- <data>: <mudança e razão>

## Retrospective (preencher ao fechar)
- O que funcionou:
- O que melhorar:
- Carry-over pra próxima:
```

## Como o orquestrador usa

Antes de despachar `spec-implementer`:

1. Leia a sprint ativa (`grep -l "status: active" docs/sprints/*.md`).
2. Confirme que a spec está em `specs_in_flight:`.
3. Passe ao subagent o objetivo da sprint + capacidade restante (tasks já fechadas vs total).

## Backlog

Chores não priorizadas pra sprint nenhuma ficam em [backlog.md](./backlog.md).

## Cross-refs

- Roadmap macro: [../product/roadmap.md](../product/roadmap.md)
- Specs: [../specs/](../specs/)
- Convenções: [../_meta/conventions.md](../_meta/conventions.md)
