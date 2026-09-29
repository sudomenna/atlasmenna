---
id: 011-sobre-o-modelo
title: Página Sobre o Modelo (T-06)
status: shipped
priority: M
personas: [P2, P3]
screens: [T-06]
requirements: [RF-054]
depends_on: [002-modelo-estatistico]
apis: []
components: [ExtrapolationIllustration, ConfidenceBandIllustration, NeedleIllustration]
nfr: [RNF-022, RNF-027, RNF-030]
adrs: [0005, 0006, 0021, 0025]
shipped_with_carry_overs:
  - ilustracoes-SVG-inline-3-NYT-style-MVP-NeedleIllustration-mockup-estatico
  - link-ADR-0006-externo-GitHub-em-vez-de-rota-interna-docs
---

# Spec 011 — Página Sobre o Modelo

**Rota**: `/sobre-o-modelo`

## Objetivo

Credibilidade. Página estática (MDX) que explica metodologia completa do modelo estatístico, atendendo à transparência exigida pela constituição § 8.

## Escopo

**In**:
- O que é o modelo (resumo).
- Como funciona a regra de três por zona (extrapolação do apurado, [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)).
- Como é calculado o intervalo de confiança (bootstrap).
- Como interpretar a agulha (bandas: tossup/lean/likely/very_likely).
- O que 2022 significa na tela: comparação descritiva, nunca insumo da projeção (constituição § 8, v1.2).
- Limitações conhecidas — incluindo o **viés de composição** em baixa apuração.
- Quem somos.
- Fontes de dados (TSE, IBGE).
- Disclaimer: não somos oficiais; consulte o TSE para resultado final.

**Out**:
- Implementação do modelo (escopo [spec 002](../002-modelo-estatistico/)).

## Requisitos Funcionais (EARS)

**RF-054 — Página com metodologia completa**

WHEN o usuário acessa `/sobre-o-modelo`, the system SHALL exibir página estática com as seções: O modelo, Regra de três, Intervalo de confiança, Agulha, Limitações, Quem somos, Fontes, Disclaimer.

WHERE a seção de método é exibida, the system SHALL descrever a projeção como **extrapolação do apurado por zona** — fator de escala `k = te/esi`, votos da zona multiplicados por `k`, soma zona → UF → Brasil — e SHALL declarar que o resultado de 2022 é comparação descritiva, não insumo do cálculo ([ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md), constituição § 8 v1.2).

**Aceitação**:
- Given a página renderiza, when leitor procura "limitações", then encontra seção com pelo menos 3 limitações conhecidas — **viés de composição** (as primeiras urnas de uma zona não representam a zona, e o IC não enxerga esse resíduo), UF com <5% apurado (IC inflado) e UF sem nenhuma zona apurada (proporção nacional, ±10pp).
- Given a página renderiza, when se busca a palavra "swing" como descrição do **método**, then ela não aparece — a projeção não usa swing vs. 2022 desde o ADR-0021. (O rótulo "Swing vs 2022" segue existindo no seletor de visualização do mapa, que é comparação descritiva.)

## Requisitos Não-Funcionais

- Contraste 4.5:1 ([RNF-022](../../nfr/accessibility.md)).
- URL canônica ([RNF-027](../../nfr/seo.md)).
- Lighthouse SEO >95 ([RNF-030](../../nfr/seo.md)).

## S05 — Extensão: Métricas de 2º turno (e a remoção do K-1 em S07)

Com a introdução de suporte multi-turno ([ADR-0014](../../architecture/adrs/0014-p-segundo-turno-primeira-classe.md)) e fallback robusto para candidatos sem histórico ([ADR-0015](../../architecture/adrs/0015-k1-fallback-3-tier.md)), a página `/sobre-o-modelo` foi estendida para documentar:

**Novos campos no payload do modelo**:
- `p_segundo_turno_overall` — probabilidade de haver segundo turno para aquela corrida (nacional).
- `cenarios_2t` — array de cenários (top 2 por P(vitória)) que teríamos se houvesse 2T.
- `p_passa_2t` (por candidato) — fração dos resamples do bootstrap em que o candidato termina no top-2. **Não existe parâmetro de "voto indeciso" no modelo** (redação anterior descrevia algo que o código nunca fez): o universo é sempre o apurado do TSE decomposto pelo próprio EA20.
- `p_fecha_1t` (por candidato) — probabilidade de fechar eleição no 1T com >50% dos válidos.

**Tratamento de candidatos sem histórico em 2022** — **removido pelo [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)** (que supersede o ADR-0015):

- O fallback K-1 de 3 tiers **nunca ficou operacional** e deixou de existir com a extrapolação do apurado: a projeção não consulta 2022, então candidato novo entra na corrida por construção, sem mapeamento de coligação.
- A página **não** deve descrever "modelo desabilitado por falta de bloco político em 2022" — esse caminho não existe no código.
- O caso de borda que sobra é volumétrico, não histórico: UF sem nenhuma zona apurada herda a proporção nacional com IC ±10pp (RF-017); na corrida de governador, que não tem nacional, a UF aparece como "aguardando projeção".

**Transparência sobre limitações** (constituição § 8):
- 2º turno é derivado dos resamples do 1º turno — são cenários condicionais ao apurado de agora, não previsão de comportamento futuro do eleitor.
- Multi-candidato em 1T aumenta incerteza da projeção — CI é mais largo (documentado).
- **Viés de composição** é o ângulo cego central da extrapolação: as seções que apuram primeiro numa zona podem não parecer com as que faltam, e o bootstrap não mede esse resíduo. Mitigação declarada: IC inflado abaixo de 5% apurado (RF-018) + rótulo "projeção a partir do apurado" (RF-062).

## Emendas por specs posteriores

### Spec 025 — link para a metodologia das etiquetas (2026-09-29)

A página ganha **um parágrafo** com link para `/sobre-as-etiquetas` (RF-252, [spec 025](../025-visoes-editoriais/spec.md); constituição 1.6 § 8), na seção 6 (Limitações), logo depois da lista de limitações: as etiquetas editoriais são classificação do AtlasMenna, com fonte e data, e não entram no modelo. **Nenhum `<h2>` novo** — o teste de estrutura (`tests/integration/sobre-o-modelo-page.test.tsx`) segue travando oito. A limitação 03 ("nenhum ajuste editorial") continua verdadeira: o modelo não lê etiqueta.

### Spec 026 — a projeção de Deputado Federal (2026-09-29)

A página explica a **projeção de deputado** (RF-266, [spec 026](../026-deputado-listas-projecao/spec.md), ADR-0063) **dentro da seção 5, "Cadeiras"** (`#sec-cadeiras`, `app/sobre-o-modelo/page.tsx:586`), sem `<h2>` novo — o teste de estrutura segue travando oito. O que muda:

- A frase de abertura da seção ("não passa pela regra de três das seções anteriores… **nada é esticado para o fim da noite**") deixa de ser verdade e é reescrita: o número de cadeiras continua sendo a conta sobre o voto já apurado, e **ao lado** dele passa a existir a projeção — a regra de três zona a zona da seção 2 aplicada a cada candidato e a cada legenda, com as zonas sem boletim imputadas pelas apuradas de tamanho parecido, e depois a mesma distribuição de cadeiras.
- Um parágrafo sobre a **trava**: a projeção de um estado só aparece com 25% do eleitorado apurado, duas zonas com boletim, as vagas publicadas e o eleitorado das zonas que lemos fechando com o do TSE; e o interruptor que a desliga sem deploy.
- Uma limitação nova na seção 6, como item numerado da mesma lista (`S.limitationItem`, depois do último número existente): **voto de reduto mal imputado** — a 25% apurado, um candidato forte num lugar que ainda não reportou é subestimado; é por isso que a projeção é "não oficial" e marca "apertada" a vaga que ainda pode mudar.
- O parágrafo sobre o que a faixa **não** mede continua verdadeiro para a parcial e ganha uma frase: a faixa da projeção, quando existir, também não mede o erro da imputação.

A frase da seção 5 é da frente U da spec 026 (tasks U8); o texto final passa pelo `constitution-guard` (§ 8).

### Spec 027 — as Assembleias Legislativas e a Câmara Legislativa do DF (2026-09-29)

A seção 5 ("Cadeiras", `#sec-cadeiras`) ganha **um parágrafo** sobre Deputado Estadual e Distrital ([spec 027](../027-deputado-estadual-distrital/spec.md), RF-281/RF-285/RF-287, ADR-0066): a mesma regra de cadeiras (ADR-0027) aplicada a cada uma das 27 casas **separadamente** — 26 Assembleias com 1.035 cadeiras e a Câmara Legislativa do DF com 24 —; enquanto as casas são lidas pelo resumo do estado não há projeção, só a conta sobre o voto já apurado; a projeção das assembleias, quando existir, é a mesma da Câmara, com interruptor próprio; e a soma nacional da capa `/deputado-estadual` é soma de casas separadas, não um plenário. **Nenhum `<h2>` novo** — o teste de estrutura segue travando oito. O texto é da frente U-b da spec 027 (tasks Ub6) e passa pelo `constitution-guard` (§ 8).

## Cross-refs

- Design: [./design.md](./design.md)
- Spec modelo: [../002-modelo-estatistico/](../002-modelo-estatistico/)
- Constituição § 8 (transparência, v1.2 — método é extrapolação do apurado): [../../constitution.md](../../constitution.md#8-transparência-metodológica)
- ADR-0021 (extrapolação do apurado por zona, sem 2022): [../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)
- Fontes: [../../reference/data-sources.md](../../reference/data-sources.md)
- Glossário: [../../reference/glossary.md](../../reference/glossary.md)
