---
id: 003-home-nacional
title: Home Nacional Presidencial (T-01)
status: shipped
priority: M
personas: [P1, P2, P3, P4]
screens: [T-01]
requirements: [RF-021, RF-022, RF-023, RF-025, RF-026, RF-027, RF-028, RF-029, RF-030, RF-030.1, RF-030.2, RF-030.3, RF-030.4, RF-030.5, RF-030.6, RF-030.7, RF-030.8, RF-061, RF-062, RF-063, RF-177, RF-178, RF-180, RF-181, RF-185, RF-186, RF-187, RF-188, RF-189, RF-190, RF-191]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 008-interatividade-brushing]
apis: [GET /api/projection]
components: [HeadlineScore, NationalChoroplethMap, MapViewToggle, StateGroupedTable, NationalNeedle, ChancesPanel, InsightCard, ForecastTransparency, LiveBadge, Tabs, MinorCandidatesList, RaceTypeIndicator, TurnoBadge, ProjectionThermometer, ProjectionThermometers, TrilhaKicker, RaceHeader, ApuracaoMeta, BreakingNewsTicker, NationalWinnerBanner, TurnoOneRecap, ResultPanel, CandidateListCollapse]
nfr: [RNF-001, RNF-002, RNF-003, RNF-007, RNF-008, RNF-022, RNF-023, RNF-024, RNF-025, RNF-026, RNF-028]
adrs: [0001, 0002, 0003, 0004, 0005, 0010, 0012, 0013, 0014, 0017, 0018, 0019, 0025, 0033, 0034, 0038, 0050, 0051]
shipped_with_carry_overs:
  - RF-025-UFForecastTable-completa-deferida-S05
  - RF-030.4-hachura-flip-MapLibre-sprite-deferida-S05
  - chunk-MapLibre-287KB-acima-RNF-007b-pendente-ADR-aumentar-meta-300KB
  - e2e-Playwright-cobertura-completa-deferida-S05
---

# Spec 003 — Home Nacional Presidencial

**Rota**: `/`

## Objetivo

Em 5 segundos, comunicar quem está vencendo a presidência. Em 30 segundos, dar profundidade suficiente para o curioso engajado.

## Escopo

**In**:
- Headline com score dos 2 candidatos líderes (estilo NYT).
- Mapa coroplético do Brasil em destaque (hero) com toggles de visualização.
- Agulha de probabilidade.
- Grid de UFs decisivas (top 6 por contribuição ao swing).
- Tabela de UFs agrupada por margem.
- Card de insight gerado por template.
- Bloco "O que está movendo o forecast".
- Toggle Presidente/Governador (Governador leva para [spec 006](../006-grid-governadores/)).
- Toggle 1º/2º turno.
- Atualização live sem reload (polling SWR).

**Out**:
- Drill-down em UF (escopo [spec 004](../004-pagina-uf-presidencial/)).
- Lógica de brushing entre componentes (escopo [spec 008](../008-interatividade-brushing/)).

## Personas e jornadas

- **P1, P4** (alvo primário): consomem o hero em segundos.
- **P2, P3**: usam UFs decisivas + tabela agrupada para drill-down.

Jornada principal: [../../product/use-cases.md](../../product/use-cases.md#fluxo-principal-quem-está-ganhando)

## Wireframe (desktop)

```
┌──────────────────────────────────────────────────────────────────┐
│ SalaCofre     ● AO VIVO   atualizado 17:23:42      [Pres][Gov] │
├──────────────────────────────────────────────────────────────────┤
│   Apuração Presidencial 2026: Lula à frente                      │
│   Projeção em tempo real com base em apuração real do TSE e     │
│   comparação com 2022. Como funciona ›                           │
│                                                                  │
│   ┌──────────────────────────┐ ┌──────────────────────────────┐ │
│   │  53,2%                   │ │                      46,8%   │ │
│   │  Lula (PT)               │ │           Bolsonaro (PL)     │ │
│   │  ████████████████░░░░░░░░│░│░░░░░░░░░░░░░░░░░██████████   │ │
│   │  79.812.408 votos        │ │ 70.140.992 votos             │ │
│   └──────────────────────────┘ └──────────────────────────────┘ │
│                ▲ 50%+1 (gatilho de 2º turno)                     │
│                                                                  │
│   [Por vencedor] [Margem] [Swing vs 2022] [% apurado]            │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │   [MAPA CHOROPLETH DO BRASIL — hero]                     │  │
│   │   tooltip on hover: UF, % líder, votos, contrib. swing   │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌──────────────────────┐    ┌─────────────────────────────┐   │
│   │      AGULHA          │    │ Apurado: 23,4% das urnas    │   │
│   │   ╱── prob 78% ─╲   │    │ UFs apuradas: 14/27         │   │
│   │       ▼              │    │ Última atualização: 17:23:42│   │
│   │      LULA            │    └─────────────────────────────┘   │
│   └──────────────────────┘                                       │
│                                                                  │
│   UFs decisivas (top contribuição ao swing)                      │
│   [6 cards: MG, SP, RJ, RS, BA, PR]                              │
│                                                                  │
│   Resultados por estado (agrupado por margem)                    │
│   Lula confortável | Lula apertado | Em disputa | Bolsonaro      │
│   apertado | Bolsonaro confortável                               │
│                                                                  │
│   [InsightCard textual gerado por template]                      │
│                                                                  │
│   O que está movendo o forecast                                  │
│   Modelo:  ████ 12%  |  Apuração: ████████████████████ 88%      │
└──────────────────────────────────────────────────────────────────┘
```

**Mobile (375px)**: stack vertical. Agulha no topo. Estimativas em accordion. UFs decisivas vira carrossel swipeable. Tabela vira lista virtualizada com cards.

## Estados

- **Loading inicial**: skeleton da agulha + barras dos candidatos com shimmer.
- **Pré-eleição (sábado < 17h domingo)**: cronograma "Apuração começa em Xh"; agulha estática em "Aguardando dados".
- **Dados zerados (17h–17h05)**: agulha em tossup, mensagem "Primeiras urnas chegando".
- **Apuração ativa**: estado normal.
- **Apuração concluída (>99%)**: banner "Resultado final" + lock no winner.
- **Erro de dados (>60s sem update)**: banner amarelo "Reconectando ao TSE", continua mostrando último valor.

## Requisitos Funcionais (EARS)

### Componentes hero

**RF-021 — Agulha hero com probabilidade de vitória**

WHEN a home renderiza, the system SHALL exibir uma agulha hero indicando `P(vitória)` do candidato líder.

**Aceitação**:
- Given `p_vitoria_A = 0.78`, when a agulha renderiza, then a posição reflete `(0.78 - 0.5) * 2 = 0.56` e a banda é `'likely'`.

**RF-022 — Votos absolutos projetados por candidato**

WHEN a home renderiza, the system SHALL exibir os votos absolutos projetados de cada candidato no headline.

**RF-023 — Percentual projetado com intervalo de confiança**

WHEN a home renderiza, the system SHALL exibir `pct_projetado` e intervalo `[pct_projetado_lower, pct_projetado_upper]` para cada candidato.

### Mapa coroplético hero

**RF-030.1 — Mapa coroplético do Brasil em destaque**

WHEN a home renderiza, the system SHALL exibir um mapa coroplético do Brasil em destaque (hero) com UFs coloridas pelo líder **da base ativa** (ver RF-189).

> ⚠️ Até 2026-09-20 esta linha dizia "coloridas pelo líder **projetado**", e
> era o que o código fazia — em ambas as bases. Ver RF-189.

**RF-030.2 — Toggles de visualização**

WHEN o usuário interage com `<MapViewToggle />`, the system SHALL alternar a coloração do mapa entre `Por vencedor`, `Margem`, `Swing vs 2022` e `% apurado`.

**RF-030.3 — Hover/tap em UF abre tooltip e click navega (desktop) ou abre gaveta (mobile)**

WHERE usuário tem ponteiro fino E suporta hover (`(hover: hover) and (pointer: fine)`) — i.e., desktop com mouse — WHEN passa o mouse em uma UF, the system SHALL exibir balão com votos, %, e link clicável `/uf/[sigla]` (ADR-0050).
WHERE usuário toca (mobile ou sem suporte a hover), WHEN toca em uma UF, the system SHALL exibir gaveta `<StateResultSheet>` com resumo do estado e opção "Ver detalhes" navegando para `/uf/[sigla]` (ADR-0050, 2026-09-20).

**RF-030.4 — Hachura/pattern em UFs que viraram (Should)**

WHERE uma UF tem `swing_vs_2022 > threshold` que mudou o vencedor vs 2022, the system SHOULD aplicar hachura/pattern visual indicando "flip".

### Scoreboard e tabela

**RF-030.5 — Scoreboard headline grande com gatilho 50%+1**

WHEN a home renderiza **em modo `binary`**, the system SHALL exibir um placar grande com `pct_projetado` dos 2 candidatos líderes e uma marca visual em 50%+1 (gatilho de 2º turno).

> **Escopo restrito desde S07** ([ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md)): em modo `multi-1t` o `<HeadlineScore />` sai do hero e é substituído por RF-061. RF-030.5 continua **integralmente vigente** no modo `binary` (2º turno), que não foi tocado.

**RF-030.6 — Tabela "Resultados por estado" agrupada por margem**

WHEN a home renderiza, the system SHALL exibir tabela `<StateGroupedTable />` com UFs agrupadas em 5 colunas: `Lula confortável | Lula apertado | Em disputa | Bolsonaro apertado | Bolsonaro confortável`.

### Lista de UFs

**RF-024 — UFs decisivas (top 6 por contribuição ao swing)** — 🔴 **CORTADO em 2026-09-08**

> **Não é requisito vigente.** O bloco saiu da home pelo ADR-0033 (corte do
> protótipo) e `app/(pres)/page.tsx:97-98` registra a remoção. O componente
> `<DecisiveUFsGrid />` continua no repositório, com teste, mas **nenhuma
> página o renderiza**.
>
> ⚠️ **Por isso RF-024 NÃO está em `requirements:` no frontmatter, e isso está
> certo.** Uma varredura que compare o corpo com o frontmatter vai acusar a
> divergência; a resposta é esta nota, não acrescentar o RF à lista. Verificado
> em 2026-09-20, depois de eu quase "consertar" para o lado errado.

WHEN a home renderiza, the system SHALL exibir grid com as 6 UFs com maior contribuição ao swing nacional.

**RF-025 — Tabela completa das 27 UFs com dot-plot inline**

WHEN a home renderiza, the system SHALL exibir tabela `<UFForecastTable />` com as 27 UFs incluindo dot-plot inline de margem.

### Atualização live

**RF-026 — Indicador de timestamp de última atualização**

WHEN a home renderiza, the system SHALL exibir timestamp ISO da última ingestão TSE.

**RF-027 — Atualização do payload sem reload**

WHILE a página está aberta, the system SHALL fazer polling SWR de `/api/projection` a cada 5s e atualizar apenas componentes afetados.

**RF-028 — Indicador "ao vivo" pulsante (Should)**

WHILE a página está aberta e a janela de apuração está ativa, the system SHOULD exibir badge "● AO VIVO" pulsante.

### Tabs

**RF-029 — Tabs Presidente/Governador**

WHEN o usuário clica no tab `[Gov]`, the system SHALL navegar para `/governador` (escopo [spec 006](../006-grid-governadores/)).

**RF-030 — Switch 1º/2º turno (Must no 2º turno)**

WHEN estamos no 2º turno (data ≥ 2026-10-25), the system SHALL exibir switch para alternar entre dados do 1º e 2º turno.

### Multi-candidato no 1º turno (S05/F4c)

> Estes três requisitos foram **implementados em S05** e só agora receberam texto EARS formal. O conteúdo é o registrado em [`docs/sprints/2026-S05-f4c-multi-candidato.md`](../../sprints/2026-S05-f4c-multi-candidato.md) — "RF-030.7..030.9 (P(2T), cenários 2T, ranking multi-camada)".

**RF-030.7 — Indicador de probabilidade de 2º turno**

WHILE a home está em modo `multi-1t` (1º turno com mais de 2 candidatos), the system SHALL exibir `<TwoRoundIndicator />` com `p_segundo_turno_overall` do payload e a banda de confiança correspondente, conforme [ADR-0014](../../architecture/adrs/0014-p-segundo-turno-primeira-classe.md).

**Aceitação**:
- Given `national.p_segundo_turno_overall = 0.62`, when a home renderiza em `multi-1t`, then o indicador exibe 62% e a banda derivada.
- Given `payload.turno === 2`, when a home renderiza, then o indicador **não** é renderizado (a métrica já se resolveu).

**RF-030.8 — Transparência total: todos os candidatos visíveis, sem collapsible**

WHILE a home está em modo `multi-1t`, the system SHALL manter **todos** os candidatos com `pct_projetado ≥ 0,1%` acessíveis sem clique, no DOM, distribuídos em camadas de destaque decrescente e **sem nenhum controle de expandir/recolher**, conforme [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md).

Após [ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md), as camadas em `multi-1t` são: **Camada 1** = os seis termômetros (RF-061), que já absorvem os ranks 1–3 e o agregado de rank ≥ 4; **Camada 2/3** = `<MinorCandidatesList />` sob o heading "Composição de Outros", detalhando quem compõe o agregado. `<RaceTypeIndicator />` declara o número de candidatos na corrida. O modo `binary` segue com `<HeadlineScore />` como Camada 1, inalterado.

**Aceitação**:
- Given um payload de 1º turno com 11 candidatos, when a home renderiza, then todos os 11 aparecem no HTML servido, sem `<details>`, sem botão "ver mais" e sem `hidden`.
- Given a mesma renderização, when os candidatos de rank ≥ 4 são inspecionados, then aparecem sob o heading "Composição de Outros".

**RF-030.9 — Cenários de 2º turno (Should)** — 🔴 **CORTADO em 2026-09-08**

> **Não é requisito vigente.** Mesmo corte de RF-024 (ADR-0033, protótipo):
> `app/(pres)/page.tsx:97-98` registra a saída do `Panel "Cenários"`. O
> componente `<RunoffScenarios />` continua no repositório, com teste, sem
> nenhuma página que o renderize.
>
> ⚠️ **Ausente de `requirements:` de propósito** — ver a nota de RF-024.
>
> ⚠️ A linha 237 desta spec ainda o cita como "inalterado" na regra do modo
> `multi-1t`. A citação descreve o estado ANTERIOR ao corte e vale como
> histórico, não como requisito.

IF `p_segundo_turno_overall ≥ 0,4` e a home está em modo `multi-1t`, the system SHOULD exibir `<RunoffScenarios />` com os até 3 duelos mais prováveis lidos de `national.cenarios_2t`, cada um com sua probabilidade.

**Aceitação**:
- Given `p_segundo_turno_overall = 0.72` e `cenarios_2t` com 3 pares, when a home renderiza, then os 3 duelos aparecem ordenados por probabilidade decrescente.
- Given `p_segundo_turno_overall = 0.25`, when a home renderiza, then o bloco é omitido (gate de relevância — abaixo de 0,4 o cenário de 2T é ruído).

### Extensão do coroplético a outros cargos (S08)

RF-030.1 a RF-030.6 (mapa coroplético nacional com toggles de visualização) foram estendidos em 2026-09-18 a **Governador** (`/governador`, spec 006 RF-006.3 reenumerada) e **Senador** (`/senador` nível Brasil, spec 016 novo). A mudança está registrada no [ADR-0048](../../architecture/adrs/0048-coropletico-substitui-cartograma-governador-estreia-senador.md), que salienta que o mapa reutiliza `<NationalMapBlock>` e `<NationalChoroplethMap>` já existentes em Presidente, sem novo componente — a extensão é uma reexecução do mesmo padrão em novos cargos, validada sob as mesmas metas de bundle e acessibilidade.

### Hero de seis termômetros e identidade de trilha (S07)

**RF-061 — Hero de seis termômetros de projeção no 1º turno**

WHILE a home está em modo `multi-1t`, the system SHALL exibir como hero o bloco `<ProjectionThermometers />` com **seis** termômetros de projeção — 1º, 2º e 3º colocados, "Outros candidatos" (agregado de rank ≥ 4), brancos/nulos e abstenção — cada um com valor projetado, faixa de incerteza `[lower, upper]`, marcador do valor apurado e **rótulo explícito da sua base de cálculo**, conforme [ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md).

WHERE a home está em modo `multi-1t`, the system SHALL **substituir** `<HeadlineScore />`, `<CandidateRanking />` e `<NationalNeedle variant="national-1t" />` por este bloco, e SHALL manter `<TwoRoundIndicator />` (RF-030.7) e `<RunoffScenarios />` (RF-030.9) inalterados.

IF a home está em modo `binary` (2º turno, ou 1º turno com exatamente 2 candidatos), the system SHALL **não** renderizar este bloco e SHALL preservar integralmente o layout anterior (RF-030.5 com `<HeadlineScore />` como hero) — decisão D1 de 2026-09-05.

**Denominador misto e rotulado** (decisão D3): candidatos e "Outros" em % de `v.vvc` — votos a votáveis concorrentes, o mesmo denominador do campo oficial `pvap` do TSE; brancos/nulos em % de `e.c` (comparecimento); abstenção em % de `e.esi` (eleitorado das seções instaladas). Os seis números **não somam 100** e o bloco fecha com uma legenda única dizendo isso. Normalizar tudo num denominador só está vedado: produziria percentual de candidato divergente do publicado pelo TSE e alteraria o conteúdo dos dados distribuídos (art. 267 §4º da Res. TSE 23.751/2026 — [ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)).

**Aceitação**:
- Given um payload de 1º turno com 11 candidatos e bloco `participacao` completo, when a home renderiza, then existem exatamente 6 elementos com `role="meter"`, na ordem 1º, 2º, 3º, Outros, brancos/nulos, abstenção.
- Given o mesmo payload, when o `aria-label` de cada meter é lido, then ele cita o valor projetado, a base do denominador, o IC95 e o valor apurado.
- Given `pct_atual = null` para uma métrica, when o termômetro renderiza, then o marcador de apurado é omitido e o rodapé escreve "sem apuração" — nunca um marcador em zero.
- Given `payload.turno === 2`, when a home renderiza, then não há nenhum `role="meter"` de termômetro e `<HeadlineScore />` continua sendo o hero.

**RF-062 — Projeção de participação e do agregado "Outros" na interface**

WHEN o payload traz `national.participacao`, the system SHALL exibir os termômetros de brancos/nulos, abstenção e "Outros" com os valores de RF-020.1 ([spec 002](../002-modelo-estatistico/spec.md)), rotulando a origem do número como **projeção a partir do apurado** — nunca como valor oficial e nunca como "baseado em 2022".

IF o payload **não** traz uma dessas métricas, the system SHALL manter o termômetro correspondente no DOM em estado "aguardando projeção" (ADR-0017 proíbe esconder camadas), e SHALL **não** exibir número, faixa nem marcador para ela.

IF o payload não traz `participacao.outros`, the system SHALL degradar para o fallback `100 − Σtop3` **sem faixa de incerteza** e com o rótulo explícito "IC indisponível" — nunca apresentar a subtração como se fosse um IC calculado.

> **Exceção de rota**: em `/governador` ([spec 006](../006-grid-governadores/spec.md)) o bloco inteiro é **omitido** quando `national.participacao` está ausente, em vez de renderizar em "aguardando". A razão é que ali não existe uma corrida nacional de governador — existem 27 corridas — e a participação é o único agregado nacional legítimo daquela tela; um bloco vazio anunciaria uma projeção nacional que não existe. Nas outras três rotas vale a regra geral de ADR-0017.

**Aceitação**:
- Given um payload com `participacao.abstencao` e `participacao.brancos_nulos`, when a home renderiza, then cada termômetro exibe o rótulo da sua base e o IC95 formatado.
- Given um payload **sem** o bloco `participacao`, when a home renderiza em `multi-1t`, then os 6 meters continuam no DOM e 3 deles (Outros, brancos/nulos, abstenção) estão em "aguardando projeção".
- Given `participacao.outros` ausente com top-3 somando 89,7%, when o termômetro de Outros renderiza, then exibe 10,3% sem faixa e com a nota "IC indisponível".

**RF-063 — Identidade visual por trilha**

WHEN qualquer uma das quatro páginas de corrida renderiza, the system SHALL declarar `data-trilha="pres" | "gov"` no `<main>` e SHALL exibir, acima do `<h1>`, um `<TrilhaKicker />` com o rótulo da trilha e a profundidade da navegação (ex.: "PRESIDÊNCIA · Brasil › SP", "GOVERNADOR · SP"), colorido por `--trilha-accent`, conforme [ADR-0019](../../architecture/adrs/0019-identidade-visual-por-trilha.md).

WHILE a página está renderizada, the system SHALL usar `--trilha-accent` **apenas** em chrome de navegação (`<TrilhaKicker />`, `<LiveBadge />`, aba ativa de `<Tabs />`, breadcrumb) e SHALL **nunca** usá-lo para colorir dado de apuração, projeção ou candidato — as cores de candidato continuam vindo exclusivamente dos tokens de identidade de candidatura — ~~`--color-cand-*` ([ADR-0013](../../architecture/adrs/0013-tokens-multi-candidato-por-rank.md), intocado)~~ ⚠️ **corrigido em 2026-09-19**: o ADR-0013 foi **superado** pelo [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md) em 07/09 e a cor vem do **partido** (`--party-*`), resolvida por `candidateColor`/`candidateMarkerColor`. Os `--color-cand-*` sobrevivem apenas como **fallback** de sigla sem token próprio. O que este RF normatiza não muda: `--trilha-accent` segue proibido em dado de apuração.

WHERE a trilha é `gov`, the system SHALL exibir o breadcrumb **sem** nó nacional presidencial (`Governadores › SP`), porque a trilha de governador não tem agregação nacional equivalente — apenas o cargo Presidente possui arquivo de abrangência Brasil no EA20.

**Aceitação**:
- Given a home, when o HTML é servido, then `<main data-trilha="pres">` e o kicker lê "PRESIDÊNCIA · Brasil".
- Given `/uf/SP`, when o HTML é servido, then o kicker lê "PRESIDÊNCIA · Brasil › SP" e o breadcrumb é `Brasil › SP`, com "SP" marcado `aria-current="page"`.
- Given `/uf/SP/governador`, when o HTML é servido, then `<main data-trilha="gov">`, o kicker lê "GOVERNADOR · SP" e o breadcrumb é `Governadores › SP` — sem nó "Brasil".
- Given qualquer uma das quatro páginas, when os tokens de cor são inspecionados, then nenhum elemento que representa dado eleitoral usa `--trilha-accent`.
- **Gate obrigatório** (ADR-0019): o accent escolhido precisa ser perceptualmente distinguível de `--color-cand-2` e `--color-cand-4`, verificado por `a11y-perf-auditor` antes de qualquer promoção a `shipped`.

### Balão do mapa e seletor de base (S08/2026-09-19/20)

**RF-177 — Balão do mapa com as candidaturas de `top_candidatos` + agregado "Outros"**

WHEN o usuário passa o mouse sobre uma UF no mapa nacional, the system SHALL exibir um balão com **todas** as candidaturas publicadas em `EdgeUfRow.top_candidatos[]` — os 4 de maior projeção e, quando houver, os resgatados pela ordem do apurado (RF-190) —, seguidas de uma linha agregada "Outros (N)" que resume o restante das candidaturas.

> **Emenda de 2026-09-21 (decisão do dono).** O enunciado anterior fixava "os 4 candidatos com maior intenção de voto registrados em `top_candidatos[0..3]`" e o 1º critério exigia "**exatamente 5 linhas**". Isso passou a ser incompatível com RF-190: quando quem lidera os boletins apurados está fora do corte por projeção, ele entra em `top_candidatos[4..5]`, e um balão travado em 5 linhas o esconderia justamente na tela em que a cor do estado o aponta. O dono escolheu **o balão crescer** (até 6 linhas + "Outros") em vez de (a) mantê-lo em 4 e empurrar o caso raro para a ficha, ou (b) trocar o conteúdo por base. O balão passa a refletir o comprimento do array, sem número mágico próprio.

**Aceitação**:
- Given um estado com 10+ candidaturas em `EdgeUfRow.candidatos` e **nenhum resgate** (as duas ordens concordam — o caso normal, 133 de 133 observações no replay 2022), when o tooltip renderiza, then exatamente 5 linhas aparecem (4 líderes + 1 agregado).
- Given um estado em que o 1º ou o 2º do apurado está fora do corte por projeção, when o tooltip renderiza, then aparecem `top_candidatos.length` linhas (até 6) + 1 agregado, e o resgatado **nunca** aparece também dentro de "Outros".
- Given `EdgeUfRow.outros` ausente (payload pré-2026-09-19 ou legado), when o balão monta, then a linha "Outros" não aparece e nenhuma candidatura é omitida.
- Given um estado com ≤4 candidaturas registradas, when renderiza, then nenhuma linha "Outros" aparece.
- Given `top_candidatos[i].pct_atual` ausente (impute_uf ou payload em transição), when a coluna "Parcial" renderiza, then exibe "—" (ausência), não "0%" (zero medido).
- 🔴 **Ordem (2026-09-20)** — ✅ **Conflito com a constituição § 2 RESOLVIDO** pela emenda 1.4 → 1.5 de 2026-09-20 ([ADR-0051](../../architecture/adrs/0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md)), que criou a exceção de ordem por base ativa sob três condições cumulativas. Este critério e RF-181 estão legitimados. Given a visão "Parcial", when o balão monta, then as linhas saem ordenadas por `pct_atual` desc; Given a visão "Projeção", por `pct_projetado` desc. A ordem é a MESMA derivação que pinta a UF (RF-189), para que a cor do estado e o topo do balão nunca discordem sobre quem lidera.
- Given a visão "Parcial" com `pct_atual` ausente em ALGUM candidato do corte, when o balão monta, then a ordem inteira cai na de projeção — nunca se trata o ausente como `0`, que daria a ele a última posição sem dado que sustente.

**RF-189 — A cor e a intensidade do mapa seguem a base ativa**

> Novo em 2026-09-20. O comportamento que ele descreve **não existia**: a cor
> do mapa nunca respondeu ao seletor Parcial/Projeção, em nenhum cargo. Ver a
> análise em `lib/utils/lider-por-base.ts` e no commit `b3029e8`.

WHEN o leitor alterna o seletor "Parcial / Projeção" do shell, the system SHALL repintar cada UF do mapa coroplético nacional com a cor do partido do líder **daquela base**, e SHALL usar a margem **daquela base** para escolher o nível de intensidade na view `Margem`.

**Aceitação**:
- Given uma UF cujo líder apurado difere do líder projetado, when o seletor está em "Parcial", then a UF é pintada com a cor do partido do líder APURADO; when está em "Projeção", com a do líder PROJETADO.
- Given a view `Margem`, when a base muda, then o nível de intensidade é recalculado com a margem daquela base (1º − 2º), não com um valor fixo.
- Given `pct_atual` ausente em algum candidato do corte, when a base é "Parcial", then a derivação cai inteira na de projeção — nunca se fabrica `0`.
- Given uma UF com `pct_apurado === 0` e base "Parcial", when renderiza, then a UF fica em `--map-uncounted`, nunca pintada pelo líder projetado sob rótulo de parcial (guarda anterior à escolha de líder — RF-157).
- Given o cargo Senador, when a view é `Margem`, then a margem continua sendo a da 2ª vaga (`margemSegundaVaga`, RF-104), que não distingue base — limitação de dado, registrada.

**Escopo**: nível Brasil dos três cargos (Presidente, Governador, Senador), que compartilham `<NationalMapBlock>` (ADR-0048). **Não** se aplica ao mapa MUNICIPAL: `EdgeUfMunicipio` não publica campo projetado algum, então não existe segunda base para alternar. Fabricar uma — por regra de três local ou rateando a da UF — violaria a constituição § 1 (decisão do dono, 2026-09-21, dívida 21).

**RF-190 — O payload resgata quem lidera o apurado fora do corte por projeção**

> Novo em 2026-09-21, decisão do dono. Pré-requisito de RF-189, RF-181 e
> RF-177: todos os três derivam da base ativa, e nenhum deles consegue mostrar
> uma candidatura que o payload não publica.

`EdgeUfRow.top_candidatos[]` é um corte TOP-N **por projeção**. Quem lidera os boletins já apurados sem estar entre os N primeiros por `pct_projetado` ficava agregado em `outros`, que não carrega `id` nem nome — invisível para a UI e para `lib/utils/lider-por-base.ts`.

WHEN o produtor monta `por_uf[].top_candidatos[]`, the system SHALL publicar a **união** entre as `TOP_CANDIDATOS_POR_UF` candidaturas de maior `pct_projetado` e as `RESGATE_POR_APURADO` de maior `pct_atual` da corrida inteira, anexando as resgatadas **ao fim** do array.

**Aceitação**:
- Given uma UF em que o 1º do apurado está fora do corte por projeção, when o payload é gerado, then ele aparece em `top_candidatos[]` com `id`, e `outros.n_candidatos` é decrementado — nunca publicado nos dois lugares.
- Given as duas ordens concordando (o caso normal), when o payload é gerado, then **nada** é anexado e o array sai idêntico ao de antes desta data.
- Given `pct_atual` ausente em toda a corrida (`impute_uf_from_national`, cargo 1), when o payload é gerado, then não há resgate — a ausência nunca é lida como `0`, que elegeria pelo número de urna no desempate.
- Given um resgate, when a UI lê `top_candidatos[1]`/`[2]` por posição (`margemSegundaVaga`, RF-104), then o prefixo por projeção continua nos índices `0..TOP_CANDIDATOS_POR_UF-1`, inalterado.
- Given `RESGATE_POR_APURADO = 2`, when o 3º do apurado também está fora do corte, then ele **não** entra — os dois postos resgatados são exatamente os que `liderIdPorBase` e `margemPorBase` consomem.

**Escopo**: produtor (`api/model/project.py`) e o gerador do simulado (`data-pipeline/simulacao-gerar.ts`), que precisam concordar para que `pnpm dev:sim` não esconda a tela que produção mostra. **Fora de escopo**: o 3º colocado do apurado e a margem do 3º→4º; nenhum consumidor os usa.

**RF-178 — Orientação vertical adaptativa do balão do mapa**

WHEN o cursor do mouse se posiciona em uma UF próxima à borda inferior do contêiner, the system SHALL reposicionar o balão para cima, evitando corte pela moldura `<PersistentMapFrame overflow: hidden>`.

**Aceitação**:
- Given um estado no terço inferior do mapa (RS, SC) com clientY > contêiner.height − cartão.height, when o tooltip renderiza, then transform aplicar `translateY(-100% - gap)` para cima.
- Given um estado no terço superior, when o balão cabe para baixo, then `translateY(+12px)` padrão.
- Given um cartão de altura H=150px e contêiner C=400px, when clientY = 350px (>200), then reposicionar para cima, com base em medição real do cartão e contêiner.

**RF-180 — A barra é o apurado; o traço é a projeção, e só existe na visão de Projeção**

> 🔴 **Reescrito em 2026-09-20 (2ª rodada de decisões do dono).** A redação
> anterior exigia o oposto — "o traço marca a base que **não** está em foco",
> um traço em cada visão. Ver o histórico no docblock de
> `components/atoms/tables/CandidateResultRow.tsx`.

WHEN uma linha de candidato renderiza, the system SHALL desenhar o preenchimento da barra `[data-testid="result-bar-fill"]` no percentual **apurado**, em ambas as bases; e SHALL exibir um traço vertical curto `[data-testid="result-bar-marker"]` na posição do percentual **projetado** apenas na visão "Projeção".

**Aceitação**:
- Given a visão "Parcial", when a linha renderiza, then não existe traço algum, e a coluna de projeção sai do DOM (`data-view-only="proj"` ⇒ `display: none` pela cascata do shell) — inclusive da árvore de acessibilidade.
- Given a visão "Projeção", when a linha renderiza, then existe exatamente **um** traço, com `data-marca="proj"`, posicionado em `left: min(<pct_projetado>%, calc(100% - 2px))`.
- Given qualquer das duas bases, when a barra renderiza, then o preenchimento tem largura `<pct_atual>%` — nenhuma base desenha a projeção na barra, e é isso que torna impossível o traço coincidir com a ponta do preenchimento.
- Given `pct_projetado` igual a `0` ou não-finito, when a linha renderiza, then nenhum traço é desenhado (regra dos três estados: não fabricar zero de resgate). O número `0,0%` continua na coluna de texto.
- Given a coluna "Parcial", when a linha renderiza em qualquer base, then ela permanece no DOM com `data-view-cell="parcial"` — só a ênfase tipográfica muda.

**RF-181 — Lista de candidatos reordena ao trocar base ativa**

> 🔴 **Mecanismo reescrito em 2026-09-20** (`d1a9f16`). A redação anterior
> exigia o contrário do que o produto faz hoje: *"sem reescrever o DOM, apenas
> ajustando a ordem visual via CSS `order`"*. Aquele mecanismo movia pixel e
> deixava o documento na ordem da Projeção — leitor de tela, teclado, `Ctrl+F`
> e copiar-colar recebiam a lista fora de ordem, com a numeração da base nova.
> É **WCAG SC 1.3.2 (Meaningful Sequence), nível A**, e era a dívida 17.
> A reordenação agora é **no DOM**; a regra de `order` saiu de `globals.css`.

WHEN um usuário alterna o seletor "Parcial / Projeção" do `<ShellControls />`, the system SHALL **reordenar os nós da lista no DOM** conforme o ranking da base agora ativa, atualizando também numeração sequencial, highlight de margem e (em Senado) ocupação de vagas — de modo que a ordem do documento e a ordem visual **coincidam sempre**.

**Aceitação**:
- Given lista emitida em ordem de Projeção, com custom properties `--ord-parcial` e `--ord-proj` em cada linha, when usuário seleciona "Parcial", then os `<li>` são **reposicionados no DOM** por `<ReordenaListaPorBase>` na ordem de `--ord-parcial` — e uma leitura do documento (leitor de tela, `Ctrl+F`, copiar-colar) devolve a mesma sequência que a tela mostra.
- Given foco de teclado dentro da lista, when a base muda, then o foco permanece no mesmo elemento (guardado e devolvido com `preventScroll`) — mover o `<li>` que o contém o descartaria para o `<body>`.
- Given `--ord-<base>` ausente numa linha, when a lista reordena, then aquela linha vai para o fim sem embaralhar as demais — nunca é tratada como posição `0`.
- Given a lista de identidade da fase pré, when a base muda, then **nada** é reordenado: ela não recebe `ATRIBUTO_LISTA`, porque sem voto contado não há métrica do leitor a seguir (constituição § 2 v1.5, cuja exceção exige controle de base).
- 🔴 Given `app/globals.css`, when varrido, then **não existe** regra de `order` para `[data-ord]` — com a reordenação no DOM, uma regra dessas compõe com ela e produz uma terceira ordem, que não é nenhuma das duas bases.
- Given candidato em 1º na Projeção e 3º na Parcial, when bases alternam, then a numeração de posição, a intensidade de cor de margem e (se Senado) o badge de vaga acompanham a nova base.

**RF-191 — A ficha do mapa reordena pela base ativa, e o selinho de vaga segue junto**

> Novo em 2026-09-21, decisão do dono (dívida 2).
>
> ⚠️ **Não é RF-181 com outro consumidor.** O `rf-coverage-checker` sugeriu
> emendar o RF-181 para citar `<StateResultSheet>`, e isso estaria errado: o
> RF-181 descreve um **mecanismo específico** — `<ReordenaListaPorBase>`
> movendo `<li>` no DOM segundo as custom properties `--ord-<base>`, com
> guarda de foco e com a proibição da regra de `order` em `globals.css`.
> A ficha **não tem** `--ord-*`, não é marcada com `ATRIBUTO_LISTA` e não
> passa por aquele componente: ela reordena no RENDER do React, antes do
> `.map()`. Amarrá-la ao RF-181 faria os critérios daquele RF descreverem
> atributos que esta tela não possui.

WHEN o leitor alterna o seletor "Parcial / Projeção" com a ficha de UF aberta, the system SHALL reordenar as linhas de `<StateResultSheet>` pelo ranking da base ativa, SHALL resolver a linha "Líder:" pela mesma base, e — em corridas de mais de uma vaga (Senador, RF-105) — SHALL marcar com `<VagaBadge>` as `vagas` primeiras linhas **daquela** ordem.

**Aceitação**:
- Given uma UF cuja dupla líder no apurado difere da dupla líder na projeção, when o seletor está em "Parcial", then a ficha lista os dois mais votados nos boletins chegados e o `<VagaBadge>` marca esses dois; when está em "Projeção", os dois da projeção.
- Given a base "Parcial", when a ficha renderiza a linha "Líder:", then ela nomeia o líder do APURADO — nunca `row.lider`, que carrega projeção apesar do nome e destacaria quem aparece por último na lista logo abaixo.
- Given `pct_atual` ausente em algum candidato do corte, when a base é "Parcial", then a ordem inteira degrada para a de projeção — nunca se trata o ausente como `0`.
- Given a degradação acima, when o rótulo da lista e o `aria-label` do `<ul>` renderizam, then os dois dizem "projeção" — eles nomeiam a base que a lista **de fato** usou (`usouParcial`), não a que o botão pediu (`viewMode`).
- Given Presidente ou Governador (1 vaga), when a ficha renderiza em qualquer base, then **nenhum** `<VagaBadge>` aparece.

**Escopo**: `<StateResultSheet>` nas quatro superfícies em que é aberta (home e as três rotas de UF). Deriva de `ordenarTopCandidatosPorBase`/`liderIdPorBase` (`lib/utils/lider-por-base.ts`), o mesmo ponto único do coroplético e dos comparadores de `<ResultPanel>` — é o que satisfaz a condição (b) da constituição § 2 v1.5.

**RF-185 — Painel de chances acompanha a base ativa**

WHEN o usuário alterna a base ativa do seletor (Parcial/Projeção), the system SHALL atualizar o `<ChancesPanel />` para refletir as probabilidades de VITÓRIA e FECHAMENTO 1º TURNO (se Presidente) ou ELEIÇÃO (se Governador/Senado) calculadas sobre a base exibida.

**Aceitação**:
- Given `payload.nacional.p_vitoria = 0.78` (Projeção) e `payload.nacional.p_vitoria_parcial = 0.62` (Parcial), when usuário muda base de proj→parcial, then o medidor de `aria-valuenow` muda de 78 para 62.
- Given campo de probabilidade ausente para uma base (payload legado), when aquela base é ativada, then o medidor correspondente não renderiza (não fabrica zero).

**RF-186 — Ficha do mapa (StateResultSheet) exibe apurado E projetado por candidatura**

WHEN um usuário abre a ficha de resultado de uma UF via toque no mapa, the system SHALL exibir os dados de apurado e projetado **lado a lado** por candidatura, com rótulo explícito "Em ordem de projeção", NUNCA fabricando zero quando `EdgeCandidate.pct_atual` é ausente.

**Aceitação**:
- Given uma candidatura em uma UF com `pct_atual = null` (impute_uf ou payload pré-09-19), when a ficha renderiza, then a coluna "Parcial" mostra "—" (traço), não "0,0%".
- Given `pct_atual = 0` (medido: zero voto apurado para essa candidatura), when renderiza, then "0,0%" aparece — diferença intencional: "não sabemos" vs "medimos zero".
- Given o rótulo "Em ordem de projeção", when inspecionado em `/uf/SP`, then não aparece em `/uf/SP/governador` se a UF tem múltiplos candidatos com ordens conflitantes entre as bases (degrade gracioso — rótulo é premissa de ordem única).

**RF-187 — Seletor Parcial/Projeção renderizado dentro do conteúdo (desktop)**

WHERE usuário tem capacidade de ponteiro fino (`(hover: hover) and (pointer: fine)`), the system SHALL renderizar o seletor "Parcial / Projeção" **dentro** do espaço de conteúdo do `<TopBar>` em `<ShellControls />`, permanentemente visível e acessível via teclado.

**Aceitação**:
- Given desktop com mouse, when a página renderiza, then `<SegmentedControl role="tablist">` com os dois tabs aparece inline no top bar, não em overlay modal.
- Given `role="tablist"` + dois tabs com `data-value="parcial"` e `data-value="proj"`, when renderiza, then exatamente um tem `aria-selected="true"` (default = proj conforme state de store).
- Given height do botão ≥ `--tap-min` (28px constituição § 4), when inspecionado em Chromium DevTools, then satisfaz.

**RF-188 — Interação com o mapa segue capacidade de ponteiro, não viewport width**

WHEN o usuário interage com um estado/município no mapa, the system SHALL avaliar `(hover: hover) and (pointer: fine)` em lugar de `window.innerWidth > breakpoint` para decidir o modo de apresentação: desktop (mouse) abre balão; toque (sem fine pointer) abre gaveta.

**Aceitação**:
- Given dispositivo desktop com mouse (fine pointer + hover capability), when hover sobre UF, then `<HoverCard>` balão aparece.
- Given tablet com touch (pointer: coarse, sem suporte a hover), when toque UF, then balão **não** aparece; `<StateResultSheet>` gaveta abre ao tap.
- Given Safari/Chrome em aparelho com toque que emite mousemove **sintético** antes do tap, when `bloqueiaBalaoNoToqueRef` está ativo (lê resultado de `useHasFinePointer`), then balão é suprimido apesar do mousemove artificial.
- Given desktop de 375px de largura com mouse real (fine pointer), when cursor sobre UF, then balão abre (critério é ponteiro, não viewport).

## Requisitos Não-Funcionais aplicáveis

- LCP <2.5s, INP <200ms, bundle <150KB, mapa <1.5s — [performance](../../nfr/performance.md).
- Contraste 4.5:1, fallback de tabela para gráficos, navegação por teclado, mapa com `aria-label`, reduced-motion — [accessibility](../../nfr/accessibility.md).
- OG tags dinâmicas — [seo](../../nfr/seo.md) + [spec 009](../009-compartilhamento-meta/).

## Open questions

- Cores partidárias: a paleta atual em [`tokens.md`](../../design-system/tokens.md) mapeia PT → vermelho, PL → azul. Confirmar com QA de design antes de F4.
- Carrossel mobile de UFs decisivas — swipe horizontal ou vertical scroll com snap? (atual: swipe horizontal).

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26)

O painel "Votação" (RF-192..199) entra na tela `/` imediatamente após a lista de candidaturas (RF-192), renderizado em seu próprio `<Panel>`.

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) renderiza imediatamente **depois** do painel "Votação" (spec 021) na tela `/`, em seu próprio `<Panel>`.

## v2 — S05 Multi-candidato (1º turno)

Extensão da v1 binária (2 candidatos líderes) para suporte total a 2º turno e visualização de todos os candidatos em 1º turno.

**Mudanças principais** (conforme [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md)):

- **Hero headline**: top-2 líderes + indicador de 2º turno obrigatório (ADR-0014).
- **Camada 2 (ranking)**: candidatos rank 3–6 em bloco colapsível. ⚠️ **2026-09-19**: dizia "com tokens de rank (ADR-0013)" — o rank segue definindo **quem entra** nesta camada, mas **não** a cor, que vem do partido desde o [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md). A confusão entre os dois papéis do `rank` é o que manteve o defeito no ar por 12 dias.
- **Camada 3 (minor)**: candidatos rank 7+ em lista compacta, visível por padrão; não collapsível.
- **Métrica P(2º turno)**: componente novo `<TwoRoundIndicator />` exibe probabilidade calculada pelo modelo (ADR-0014, RF-030 extendido).
- **Badges turno**: `<TurnoBadge />` identifica "1º turno" ou "2º turno" em contextos de seleção (RF-030).

**Componentes novos**:
- `<TurnoBadge />` — chip visual "1º/2º turno" (atom).
- `<RaceTypeIndicator />` — cabeçalho "Disputa entre N candidatos" (atom).
- `<MinorCandidatesList />` — camada 3 rank 7+ em linha compacta (atom).
- `<TwoRoundIndicator />` — card com P(2º turno) e bandas de confiança (block).
- `<CandidateRanking />` — camada 2 rank 3–6 renderizado dinamicamente (block).

**Componentes refatorados**:
- `<HeadlineScore />` agora aceita `mode: 'binary' | 'multi-candidate'` (padrão: `'binary'` para backward-compat).
- `<NationalNeedle />` com variant `showTwoRoundIndicator` (integra a métrica de segundo turno).
- `<NationalChoroplethMap />` com `rankByLider` filter (opcional, mostra só vitória do líder vs 2º lugar).

**Status**: v1 (`status: shipped`) continua válida pra 1T binário. v2 estende e retrocompat é garantida.

## v3 — S07 Hero de seis termômetros + identidade de trilha

Terceira evolução, conforme [ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md) e [ADR-0019](../../architecture/adrs/0019-identidade-visual-por-trilha.md), decisões D1–D8 de 2026-09-05.

**Mudanças principais**:

- **Camada 1 em `multi-1t` trocada** — `<ProjectionThermometers />` (RF-061) substitui `<HeadlineScore />` + `<CandidateRanking />` + `<NationalNeedle variant="national-1t" />`. `<TwoRoundIndicator />` e `<RunoffScenarios />` permanecem. O modo `binary` (2º turno) é **byte-a-byte o anterior**.
- **Participação entra na tela** — brancos/nulos, abstenção e "Outros" com IC próprio (RF-062), alimentados por RF-020.1 da [spec 002](../002-modelo-estatistico/spec.md).
- **Denominador misto e rotulado** — três bases distintas, nunca normalizadas entre si.
- **`<MinorCandidatesList />` muda de papel** — deixa de ser "camada 3 solta" e passa a ser a "Composição de Outros" do termômetro-agregado, sempre no DOM.
- **Chrome por trilha** (RF-063) — `data-trilha` no `<main>`, `<TrilhaKicker />`, `<RaceHeader />` compartilhado pelas quatro rotas, breadcrumb com profundidade real.

**Componentes novos**:
- `<ProjectionThermometer />` — barra horizontal com faixa de IC e marcador do apurado (atom, `components/atoms/bars/ProjectionThermometer.tsx`).
- `<ProjectionThermometers />` — o bloco de seis, com `variant: "full" | "participacao-only"` (block, `components/blocks/ProjectionThermometers.tsx`).
- `<TrilhaKicker />` — rótulo de trilha acima do `h1` (atom, `components/atoms/nav/TrilhaKicker.tsx`).
- `<RaceHeader />` — cabeçalho compartilhado pelas quatro rotas (layout, `components/layout/RaceHeader.tsx`).

**Componentes refatorados**:
- `<UFBreadcrumb />` ganha `trilha?` e `items?` (profundidade real da trilha); o modo legado `label`/`href` continua funcionando.

Todos são **Server Components puros** — sem `"use client"`, sem `framer-motion` — porque o hero é above-the-fold e não pode custar bundle (RNF-007a).

## Cross-refs

- Design técnico: [./design.md](./design.md)
- Wireframes detalhados: [../../design-system/components.md](../../design-system/components.md)
- Brushing & linking: [../008-interatividade-brushing/](../008-interatividade-brushing/)
- Templates de insights: [../../design-system/insights-templates.md](../../design-system/insights-templates.md)
- ADRs aplicáveis: [0001](../../architecture/adrs/0001-edge-config-no-read-path.md), [0002](../../architecture/adrs/0002-polling-cdn-cache.md), [0003](../../architecture/adrs/0003-pmtiles-nao-geojson.md), [0004](../../architecture/adrs/0004-maplibre-nao-mapbox.md), [0005](../../architecture/adrs/0005-templates-nao-llm.md), [0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md), [0018](../../architecture/adrs/0018-termometros-hero-1t.md), [0019](../../architecture/adrs/0019-identidade-visual-por-trilha.md)
- Origem dos dados de RF-062: [spec 002 — RF-020.1](../002-modelo-estatistico/spec.md)
- Rotas que herdam RF-061/062/063: [spec 004](../004-pagina-uf-presidencial/spec.md), [spec 005](../005-pagina-uf-governador/spec.md), [spec 006](../006-grid-governadores/spec.md)
