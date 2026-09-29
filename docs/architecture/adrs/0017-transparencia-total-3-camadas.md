---
id: ADR-0017
title: Todos os candidatos do 1T visíveis em 3 camadas fixas, sem collapsible
status: accepted
date: 2026-05-17
amended_by: [ADR-0029, ADR-0034, ADR-0065] # 0029: formato de linha das Camadas 2/3; 0034: distingue colapso visual (D21) de remoção de nós; 0065: emenda escopada às listas proporcionais (faixas 20/60/61+)
---

# ADR-0017 — Todos os candidatos do 1T visíveis em 3 camadas fixas, sem collapsible

## Status

Aceito (parcialmente superado por [ADR-0018](0018-termometros-hero-1t.md) no modo `multi-1t`).

> **Nota 2026-09-05**: não há precedente de supersessão parcial anterior neste repositório — ADRs até aqui eram supersedidos por inteiro ou permaneciam integralmente aceitos. Registra-se aqui o critério adotado: quando um ADR novo altera apenas uma fração de uma decisão anterior, o ADR antigo mantém `status: accepted` no frontmatter (a decisão como um todo continua majoritariamente vigente) e a seção `## Status` narra explicitamente qual parte foi substituída e em qual contexto.
>
> Especificamente: a definição de **Camada 1** (hero) deste ADR — `<HeadlineScore />` top-2 — deixa de valer no modo `multi-1t` (1º turno com >2 candidatos), onde o ADR-0018 a substitui por `<ProjectionThermometers />` (seis termômetros: 1º, 2º, 3º colocados, "Outros", brancos/nulos, abstenção). A regra estrutural deste ADR — **todas as camadas sempre presentes no DOM, sem collapsibles** — permanece **integralmente vigente** em ambos os modos, assim como a definição completa da Camada 2 (`<CandidateRanking />`) e da Camada 3 (`<MinorCandidatesList />`, agora também consumida pelo ADR-0018 como "Composição de Outros"). Para o modo `binary` (2º turno), este ADR aplica-se **sem nenhuma alteração** — `<HeadlineScore />` continua sendo a Camada 1.

> **Nota 2026-09-08 (ADR-0029).** As linhas de candidato das Camadas 2 e 3 adotam o formato visual do componente `CandidateRow` do kit Atlas Menna (parcial e projeção lado a lado, com delta), em vez do formato comprimido pct+IC anterior. A regra central deste ADR — todas as camadas sempre no DOM, sem collapsible — é reafirmada e usada explicitamente para **rejeitar** o botão "Mostrar todos os N candidatos" presente no componente equivalente do kit (`ResultPanel`), que violaria esta regra se copiado sem revisão.

> **Nota 2026-09-10 (D21, [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)).** A permanência "sempre no DOM" ganha uma segunda camada de precisão: o botão "Todos os N candidatos" do painel de resultado (`<CandidateListCollapse>`, `components/blocks/CandidateListCollapse.tsx`) não remove nenhuma linha excedente — clipa via `height: 0; overflow: hidden` (`components/blocks/ResultPanel.module.css:44-47`), a mesma mecânica de `sr-only`. A proibição deste ADR sempre mirou a REMOÇÃO de nós (`display:none`, `hidden`, `<details>`), nunca o colapso visual que preserva a árvore de acessibilidade e a busca da página — medido no navegador em 2026-09-09 (11 linhas com `display:list-item` computado, a 11ª alcançável pela árvore de acessibilidade). Ver ADR-0034 para o levantamento completo.

> **Nota 2026-09-29 (emenda escopada, [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md)).** A
> proibição de collapsible e a justificativa deste ADR foram escritas para as ~11 candidaturas de uma
> corrida majoritária. Para a lista de candidaturas **por agremiação em eleição proporcional**
> (`/uf/[sigla]/deputado-federal`, dezenas de linhas por legenda), o ADR-0065 admite três faixas: as
> posições 1–20 visíveis; 21–60 no documento, recortadas por CSS e mantidas no DOM (a mecânica do
> D21 acima) com botão; e 61 em diante **fora do documento**, buscadas por clique. `<details>` **continua
> proibido**, e a ordem segue o voto contado, nunca escolha do produto. Fora dessa lista — Camadas 1 a 3
> das corridas majoritárias e tudo o que este ADR decide para elas — nada muda. A terceira faixa é a
> única parte que foge da letra da regra "todas as camadas sempre no DOM"; ver o ADR-0065 para o custo
> assumido.

## Contexto

O NYT Live Forecast esconde candidatos com baixa intenção de voto atrás de um controle "Show all candidates" — clique. Para eleições americanas com dois grandes partidos e eventual terceiro candidato irrelevante, essa escolha é justificável: o universo narrativo tem 2 candidatos e o terceiro é ruído.

No 1T presidencial brasileiro de 2026, candidatos com 3–5% de intenção de voto têm relevância política real. Em 2022, Ciro (PDT, 3%) e Tebet (PSDB, 4,2%) capturavam faixas do eleitorado que afetavam a narrativa da disputa e a análise de transferência de votos para o 2T. Escondê-los atrás de interação implica que não merecem atenção, o que é um viés editorial.

Adicionalmente, colapsáveis aumentam a fricção de acesso à informação para usuários de leitores de tela e dispositivos de entrada por voz (constituição § 4 — acessibilidade). Um `<details>` ou botão de toggle quebra a narrativa linear que leitores de tela percorrem.

A restrição real é viewport: em 375px com 11 candidatos, uma lista vertical ingênua empurra conteúdo relevante para scroll profundo. O problema é de density, não de visibilidade.

## Decisão

Estrutura de 3 camadas visuais, todas **sempre presentes no DOM** (sem `display:none`, sem `hidden`, sem `<details>`):

**Camada 1 — hero scoreboard** (top-2 do momento): componente `<HeadlineScore />` existente, dimensionamento grande, exibe pct apurado + IC + probabilidade. Ocupa a faixa superior da tela.

**Camada 2 — ranking compacto** (rank 3 a 6): componente `<CandidateRanking />`, linhas de altura média com paleta `colorForParty(sigla)` (ADR-0024, 2026-09-07 — cor editorial por partido, não por rank). Exibe nome, pct, IC em formato comprimido. Omitida se apenas 2 candidatos existirem (contexto 2T).

**Camada 3 — outros** (rank 7+ ou pct apurado < 1%): componente `<MinorCandidatesList />`, lista horizontal compacta em desktop ("Tebet 4.2% · Ciro 3.1% · ...") e lista vertical compacta em mobile (375px). Fonte menor, sem IC exibido individualmente — apenas pct.

Em **2T binário**, apenas a Camada 1 está presente. As Camadas 2 e 3 são renderizadas condicionalmente com base em `candidateCount` do payload, não em interação do usuário.

A densidade mobile é resolvida via tipografia: Camada 3 usa `font-size: 0.75rem`, line-height 1.2, espaçamento mínimo — aprovado pelo gate `a11y-perf-auditor` antes de shipped.

## Consequências

**Positivas**:
- Cobertura editorial completa: nenhum candidato com representatividade eleitoral é ocultado.
- Acessibilidade preservada: estrutura linear sem toggles é percorrível por leitores de tela sem interação adicional (§ 4).
- Consistência de componente: `<MinorCandidatesList />` pode ser reusada nas páginas de UF (spec 004, spec 005).
- Sem estado de UI para sincronizar: camadas são determinísticas dado o payload.

**Negativas**:
- Em viewport 375px com 11 candidatos, a altura total da seção de candidatos pode superar 60vh — usuário precisa scrollar antes de chegar ao mapa ou à agulha. Mitigado por tipografia compacta na Camada 3, mas não eliminado.
- `<MinorCandidatesList />` com candidatos de CI estreito (pct ~1%) pode dar falsa sensação de precisão — disclaimer na Camada 3 "valores estimados, < 1%" é necessário.
- Três componentes distintos para uma mesma seção aumentam superfície de manutenção e risco de inconsistência visual se tokens de cor mudarem.

## Cross-refs

- ADR-0018 (seis termômetros como Camada 1 em `multi-1t` — supera parcialmente este ADR nesse modo específico): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- ADR-0013 (tokens legados — superseded por ADR-0024): [0013-tokens-multi-candidato-por-rank.md](0013-tokens-multi-candidato-por-rank.md)
- ADR-0024 (cor editorial por partido, agora padrão): [0024-paleta-editorial-por-partido.md](0024-paleta-editorial-por-partido.md)
- ADR-0014 (p_segundo_turno — Camada 1 pode exibir `<TwoRoundIndicator />`): [0014-p-segundo-turno-primeira-classe.md](0014-p-segundo-turno-primeira-classe.md)
- Spec afetada: `docs/specs/003-home-nacional/spec.md` (seção de candidatos, componente `HeadlineScore`)
- Spec afetada: `docs/specs/004-pagina-uf-presidencial/spec.md` (componente `CandidateRow` evolui para as 3 camadas)
- Spec afetada: `docs/specs/005-pagina-uf-governador/spec.md` (herda as 3 camadas para corrida de governador)
- Design system: `docs/design-system/components.md` (novos componentes `CandidateRanking`, `MinorCandidatesList`)
- Constituição § 4 (acessibilidade): [../../constitution.md](../../constitution.md)
- NFR: `docs/nfr/accessibility.md` (WCAG AA para todas as camadas, incluindo `<MinorCandidatesList />`)
- Gate: `a11y-perf-auditor` obrigatório antes de marcar specs 003/004 como shipped com estas camadas
