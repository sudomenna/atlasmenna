---
title: SalaCofre — Constituição do Produto
description: Princípios não-negociáveis que governam toda decisão de produto, design e engenharia
status: stable
version: 1.6
last_updated: 2026-09-29
---

# Constituição do SalaCofre

Estes princípios são **invariantes**. Toda spec, ADR, PR ou decisão de produto precisa respeitá-los. Mudar um princípio exige justificativa explícita registrada em ADR + atualização desta constituição com versionamento (não silenciosamente).

---

## 1. Conformidade regulatória (TSE)

A norma vigente é a **Resolução TSE nº 23.751/2026**, que trata da divulgação de resultados por terceiros no **Título III, Capítulo VI, artigos 264 a 269**. Ela está **publicada**. A Res. 23.736/2024 não rege este pleito e não é mais referência normativa.

- **Não existe cadastro prévio.** A Res. 23.751/2026 não institui inscrição, credenciamento nem homologação de "interessado na divulgação"; o termo é descritivo, não um status administrativo. O SalaCofre opera sem cadastro, e **nenhuma superfície do produto — a começar pelo `User-Agent` enviado ao TSE — pode declarar um cadastro, credenciamento ou autorização que não existe.** Identificação honesta (nome do projeto, URL pública, contato verificável) é obrigatória; afirmação de status inexistente é proibida.
- **O dado oficial é intocável.** O art. 267 §4º veda às entidades que divulgam resultados promover qualquer alteração de conteúdo dos dados distribuídos pela Justiça Eleitoral. Em consequência, o snapshot bruto recebido do TSE é persistido **cru e inalterado**, e nenhuma transformação do produto pode ser gravada sobre o registro do dado oficial.
- **A projeção é conteúdo derivado e precisa ser inconfundível com o oficial.** Projeção estatística, intervalo de confiança e probabilidades não são resultado do TSE; toda superfície onde aparecem deve rotulá-las como não oficiais, de forma que nenhum leitor razoável as confunda com apuração. Esta é uma obrigação regulatória (art. 267 §4º), não apenas editorial.
- **Os limites técnicos do CDN do TSE são invariantes de engenharia, não recomendações.** O TSE documenta máximo de 100 requisições por IP por segundo, com bloqueio de 10 minutos renovável; adverte que requisição malformada (404) também pode gerar bloqueio; e declara que **não é possível listar os arquivos**. Daí decorrem três invariantes: (a) **rate limiter de saída obrigatório**, com teto configurado bem abaixo do limite documentado; (b) **proibição absoluta de sondar URL adivinhada** contra `resultados.tse.jus.br` ou `resultados-sim.tse.jus.br` — toda URL requisitada deve derivar da padronização documentada ou de arquivo de acompanhamento; (c) **schema tolerante a campos desconhecidos** (`.passthrough()`, nunca `.strict()`), porque o TSE não anunciou freeze de leiaute.
- Toda página **deve** exibir, no footer, "Não oficial. Fonte: TSE." e link para `resultados.tse.jus.br`.
- Tooltips e legendas **devem** atribuir corretamente cada dado à sua fonte (TSE, IBGE).
- Qualquer mudança na regulamentação dispara revisão imediata desta constituição — e, por força do preâmbulo, um ADR que a justifique.

> **Mudança 1.0 → 1.1 (2026-09-05).** A versão 1.0 exigia operar "como interessado na divulgação **cadastrado**" e tratava a resolução de 2026 como "a ser publicada", usando a Res. 23.736/2024 como referência. Pesquisa em fonte primária feita em 2026-09-05 derrubou as duas premissas: a norma está publicada (Res. 23.751/2026, arts. 264–269) e **não há cadastro** — o requisito antigo era inverificável, e o `User-Agent` que o declarava era uma afirmação falsa perante o TSE. A 1.1 substitui o cadastro pelas obrigações efetivamente confirmadas (dado cru inalterado, projeção rotulada, limites de consumo do CDN). Justificativa completa em [ADR-0020](./architecture/adrs/0020-conformidade-res-23751-2026.md). Nenhum outro princípio (§§ 2–10) foi alterado.

## 2. Neutralidade política

- Cores partidárias seguem uma **paleta editorial própria do SalaCofre** — uma cor por partido/federação, documentada com hex exato em `docs/design-system/tokens.md` — **nunca** as cores oficiais de partido. Toda cor de partido deve ter **ΔE76 ≥ 10** em relação ao hex oficial documentado do partido (manual de marca ou uso reiterado em material oficial), critério auditável e verificável por qualquer agente ou revisor. A cor de cada partido é **estável durante toda a noite de apuração** e entre as duas noites do pleito (1º e 2º turnos): não muda por rank, por ordem de apuração, por margem ou por qualquer evento da corrida — apenas a **intensidade** (claro↔saturado) pode variar com a margem projetada, nunca a matiz.
- Nomes de candidatos e siglas partidárias aparecem **sempre na mesma ordem** dentro de uma mesma corrida sempre que essa ordem for escolhida pelo produto — por nome, por partido, por simpatia editorial ou por qualquer critério de desempate decidido sem input do leitor (sem favorecimento por ordem de leitura). **Exceção expressa**: quando a tela oferece um controle explícito, visível e reversível a um clique para o leitor alternar entre bases de apuração de voto (ex.: "Parcial" e "Projeção"), a ordem PODE acompanhar a base selecionada pelo próprio leitor — a invariante protege contra o produto decidindo a ordem por quem lê, não contra o leitor decidindo por si mesmo. Essa exceção só vale quando, cumulativamente: **(a)** a métrica que ordena é sempre uma métrica de voto — nunca nome, partido ou juízo de valor; **(b)** a mesma derivação de base rege, na mesma tela, ordem, cor e qualquer destaque correlacionado, sem duas fontes de verdade discordando sobre quem lidera; **(c)** dado ausente na base selecionada nunca produz um zero fabricado que desloque um candidato — a ordem cai inteira para a base com dado completo. Fora dessa exceção — sem controle de base ativa, como a fase pré-eleição ou uma lista de identidade de candidatura sem contagem de voto —, a ordem permanece fixa e não pode ser escolhida pelo produto.
- Insights gerados por templates **não emitem julgamento** ("Lula consolida vitória" é OK; "vitória esmagadora" não é).
- Quando há ambiguidade na atribuição de bloco político 2022→2026, exibir disclaimer explícito.
- **Classificação editorial.** O produto PODE exibir etiquetas editoriais sobre candidatos e parlamentares (campo ideológico, palanque presidencial, relação com o governo, trajetória no cargo, posição sobre impeachment de ministros do STF) **somente se todas** as condições abaixo valerem: **(a)** o catálogo de categorias e valores é fechado e versionado, e o critério escrito de cada valor está publicado **antes** de o valor ser usado; **(b)** toda classificação individual tem fonte, data e revisão nominal do dono do produto — sem revisão, a classificação não é exibida; **(c)** a etiqueta é textualmente distinta do dado do TSE e da projeção do modelo, e nunca é apresentada como um nem como o outro; **(d)** a paleta é neutra — nem vermelho nem azul, com piso de ΔE76 mensurável e verificado em teste contra as cores de partido — e a etiqueta é sempre texto, nunca só cor; **(e)** a etiqueta nunca altera a ordem de candidatos (que segue o parágrafo anterior), nunca entra no modelo e nunca entra no Edge Config; **(f)** o estado "A classificar" nunca é exibido ao leitor, e visão agregada só aparece quando o portão de cobertura está atendido; **(g)** o critério é simétrico — o mesmo para todos os candidatos, sem valor de conveniência para nenhum lado; **(h)** há registro público de alterações e canal de correção.

> **Mudança 1.2 → 1.3 (2026-09-07).** A versão 1.2 (e todas as anteriores) exigiam cor partidária "NYT-like (azul/vermelho)", e o [ADR-0013](./architecture/adrs/0013-tokens-multi-candidato-por-rank.md) foi além do texto ao atribuir cor por **rank de apuração**, não por sigla — uma escolha de implementação que evitava até a associação cor↔partido. Essa leitura deixou de servir quando o produto passou a exibir corridas em que a pergunta editorial é "qual partido", não "quem lidera esta tela": o grid de 27 governadores pinta 27 líderes de partidos diferentes com a mesma cor de rank 1; o Senado 2026 tem **duas** vagas por UF, onde "rank 1" e "rank 2" são os dois eleitos e não líder e perseguidor; e o Deputado Federal é proporcional por legenda, sem leitura visual coerente por candidato individual. A 1.3 substitui a regra por uma **paleta editorial própria por partido/federação**, com o limiar objetivo ΔE76 ≥ 10 contra o hex oficial — o que o § 2 sempre proibiu (a cor oficial do partido) continua proibido, agora com critério mensurável em vez de julgamento subjetivo. O risco assumido está nomeado no ADR: cor fixa por sigla, ano após ano, aproxima-se mais da identidade que o próprio partido cultiva do que uma cor por rank. Justificativa completa em [ADR-0024](./architecture/adrs/0024-paleta-editorial-por-partido.md), que supersede o ADR-0013. Os demais parágrafos do § 2 e todos os outros princípios (§§ 1, 3–10) ficam inalterados.

> **Mudança 1.4 → 1.5 (2026-09-20).** O texto anterior (vigente desde a v1.0, nunca emendado) proibia qualquer variação de ordem dentro de uma corrida, sem exceção. Em 2026-09-20 o dono decidiu, em `290b8de`, que a lista de candidatos passa a acompanhar a base de apuração ativa — formalizado como RF-181 em `3e83759` (spec 003, `shipped`) e estendido ao balão do mapa em `b3029e8` (RF-177), ambos no mesmo dia, **sem ADR nem versionamento da constituição no momento da decisão** — achado pelo `constitution-guard` em auditoria de rotina de `b3029e8`, não por revisão prévia. A 1.5 distingue "ordem que o produto escolhe por critério editorial" (permanece proibida) de "ordem que reflete a métrica de voto que o leitor selecionou num controle explícito e reversível" (passa a ser permitida, sob as três condições cumulativas do parágrafo). Preserva sem exceção as duas leituras restritivas já registradas no repositório — `docs/specs/019-fase-pre-eleicao/spec.md:444-449` (fase pré-eleição ordena por número de urna, nunca por `pct_projetado` zerado) e `docs/specs/018-identidade-candidatura/design.md:192-195` (lista de identidade de candidatura ordena por `numero`, nunca por nome ou partido) — porque nenhuma das duas telas oferece controle de base ativa. Justificativa completa em [ADR-0051](./architecture/adrs/0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md). Nenhum outro parágrafo do § 2, nem qualquer outro princípio (§§ 1, 3–10), foi alterado.
>
> ⚠️ **Sobre a numeração.** O [ADR-0031](./architecture/adrs/0031-piso-separacao-entre-partidos.md) (2026-09-08) também propôs uma emenda ao § 2 rotulada "1.4 → 1.5" — o piso de separação perceptual ΔE76 ≥ 12 **entre** as cores da paleta. Aquela proposta **nunca foi aprovada nem aplicada**, e o texto acima segue dizendo apenas "ΔE76 ≥ 10" contra o hex oficial. Esta emenda, aprovada pelo dono em 2026-09-20, ocupa a 1.5; a do ADR-0031 passa a ser **1.5 → 1.6** se e quando for aprovada. *(Atualizado em 2026-09-29: a 1.6 foi ocupada pela emenda da classificação editorial, abaixo; a do ADR-0031 passa a ser **1.6 → 1.7** se e quando for aprovada.)*

> **Mudança 1.5 → 1.6 (2026-09-29).** Até esta versão o produto afirmava, em comentários de código e no desenho do hemiciclo da Câmara (`components/blocks/CamaraHemiciclo.tsx:22-36`, `lib/utils/bancada.ts:28-32`, `components/blocks/GovernadoresPorPartido.tsx:28-31`), que "não classifica partido em esquerda/direita", e o § 2 não dizia nada sobre rótulos editoriais — nem os autorizava, nem os proibia. Em 2026-09-28/29 o dono pediu etiquetas editoriais sobre candidatos a Governador, Senador e Deputado Federal (campo ideológico, palanque presidencial, relação com o governo Lula, trajetória no cargo e, só no Senado, posição sobre impeachment de ministros do STF) e visões derivadas delas. A 1.6 faz três coisas. **§ 2**: cria o parágrafo "Classificação editorial", que permite a etiqueta **somente** sob oito condições cumulativas (catálogo fechado com critério público prévio; fonte, data e revisão do dono em cada linha; distinção textual do dado do TSE e da projeção; paleta neutra com piso de ΔE76 e nunca só cor; nunca muda ordem, nunca entra no modelo nem no Edge Config; "A classificar" nunca exibido e agregado só com portão de cobertura; critério simétrico; registro público de alterações e canal de correção) — a **ordem** das listas continua regida pelo parágrafo anterior e pelo ADR-0051, e a afirmação de que o produto não classifica partido deixa de ser verdadeira e é reescrita nos três pontos acima, sem tocar na ordem por tamanho. **§ 5**: esclarece que dado público de candidato e parlamentar usado para fins jornalísticos não é dado pessoal *de usuário*, que data de nascimento e documentos nunca são gravados, e que a classificação de opinião política — dado pessoal sensível na LGPD (art. 5º, II) — tem como base assumida o art. 4º, II, "a", condicionada às salvaguardas do § 2 e do § 8; o dono assumiu o risco jurídico em 2026-09-29, **sem consulta prévia a advogado**. **§ 8**: torna obrigatória a página de metodologia das etiquetas (`/sobre-as-etiquetas`), com link em toda superfície que exibe etiqueta. **A aplicação desta emenda foi autorizada pelo dono antes da revisão palavra por palavra; a revisão final está pendente** — a decisão precede qualquer etiqueta pública, ao contrário da 1.5 (ADR-0051), que formalizou o comportamento depois de ele estar no ar. Justificativa completa em [ADR-0059](./architecture/adrs/0059-classificacao-editorial-de-candidatos-governanca.md). Nenhum outro parágrafo do § 2, nem qualquer outro princípio (§§ 1, 3–4, 6–7, 9–10), foi alterado.

## 3. Performance percebida

- **LCP p95 global < 2,5s** em todos os dispositivos.
- **INP p95 < 200ms** em todas as interações.
- **Defasagem TSE → tela do usuário < 30s**.
- O **banco de dados não pode** estar no read path do cliente — estado quente vive em Vercel Edge Config.
- **Bundle JS above-the-fold**, medido pelos scripts efetivamente baixados pelo navegador até o evento `load` (o chunk `nomodule` de polyfill legado nunca é requisitado por um navegador moderno e não entra na conta), separa **piso de framework** — React, o runtime do Next.js App Router e o runtime do bundler, recalibrado quando essas dependências sobem de versão major — de **orçamento de aplicação**, o número que o time efetivamente controla e que é auditado em CI a cada PR: **orçamento de aplicação < 150KB gzipped**. O mapa (MapLibre + PMTiles) é carregado via `next/dynamic({ ssr: false })` após o first paint e não entra no above-the-fold — ver [ADR-0010](./architecture/adrs/0010-mapa-dynamic-import.md), cujo orçamento de chunk **< 300KB gzipped**. Bundle total da home (above-the-fold + lazy) < 500KB gzipped.

> **Mudança 1.3 → 1.4 (2026-09-08).** A versão anterior fixava "bundle JS above-the-fold < 150KB" como um número único, escrito em 2026-05-17, quando a home era placar + agulha e não existiam mapa, shell global nem paleta gerada. A medição do build de produção em 2026-09-07 mostrou que esse teto virou, na prática, o piso do framework: dos **153.482 bytes** que a home baixa acima da dobra em 8 requests, **71.080 são o React DOM** e o restante é runtime do Next e do bundler — a rota mais simples do site, `/sobre-o-modelo`, que não tem mapa nem polling, baixa exatamente o mesmo tanto. Sobravam **118 bytes** para todo o código de aplicação, o que tornava a métrica inútil como orçamento: ela media a escolha de framework, não as decisões do time. A 1.4 separa as duas coisas e mantém a exigência sobre a parte que o time controla, além de formalizar em 300KB o orçamento do chunk do mapa — débito aberto desde a S04, quando o chunk foi medido em ~287KB contra a meta de 250KB e seguiu sem ADR. **RNF-002 (LCP p95 < 2,5s) continua sendo a métrica de autoridade sobre performance percebida**; o orçamento de bytes é proxy. Justificativa completa em [ADR-0030](./architecture/adrs/0030-orcamento-above-the-fold-piso-framework-vs-aplicacao.md). Nenhum outro princípio (§§ 1–2, 4–10) foi alterado.

## 4. Acessibilidade (WCAG 2.1 AA)

- Contraste mínimo de texto 4.5:1.
- Todo gráfico **deve** ter fallback de tabela para screen readers.
- Navegação completa por teclado.
- Mapas **devem** ter `aria-label` + lista textual paralela.
- Animações **devem** respeitar `prefers-reduced-motion`.

## 5. Sem PII

- Nenhum dado pessoal é coletado, armazenado ou processado.
- Analytics apenas agregadas e anonimizadas (Vercel Analytics).
- Cookies apenas técnicos (rate limit), sem tracking de terceiros.
- LGPD-compliant by design.
- **Esclarecimento (1.6).** Este princípio protege o **usuário** do produto. Dado público sobre candidatos e parlamentares (nome, partido, cargo, votação nominal, mandato exercido) usado para fins jornalísticos não é dado pessoal de usuário. Isso não afrouxa a proteção de terceiros: data de nascimento, CPF, título de eleitor e demais documentos **nunca são gravados** — a única leitura de data de nascimento admitida é em memória, sem persistência (ADR-0039, ADR-0058). Opinião política é dado pessoal sensível na LGPD (art. 5º, II); a classificação editorial que a envolve (§ 2, "Classificação editorial") tem como base o art. 4º, II, "a" (tratamento para fins exclusivamente jornalísticos), condicionada às salvaguardas do § 2 e do § 8. O risco jurídico foi assumido expressamente pelo dono em 2026-09-29, sem consulta a advogado (ADR-0059).

## 6. Determinismo do modelo

- Projeção é **explicável**: cada valor pode ser reproduzido a partir do snapshot persistido + código versionado.
- Templates de insights **não usam LLM** — saída determinística, sem custo variável, sem risco de alucinação.
- Toda execução do modelo é persistida com timestamp em `projections` (auditabilidade).

## 7. Resiliência operacional

- Toda falha do TSE precisa ter **graceful degradation** (último valor conhecido + banner amarelo).
- Endpoint `/api/ingest` é **cron-only** + protegido por `x-cron-secret`.
- Rolling Release com canary 10/50/100% — **sem big-bang deploy no dia D**.
- Runbook escrito e revisado antes do dia D.

## 8. Transparência metodológica

- Página `/sobre-o-modelo` é **obrigatória** e detalha: como a projeção é extrapolada do apurado, como o intervalo de confiança é construído, e o que a comparação com 2022 significa na tela (fato observado, não insumo da projeção), como interpretar a agulha, limitações conhecidas.
- Bloco "O que está movendo o forecast" presente em toda página com projeção.
- Disclaimer explícito quando atribuição partidária é incerta.
- Página `/sobre-as-etiquetas` é **obrigatória** enquanto qualquer etiqueta editorial (§ 2, "Classificação editorial") for exibida, e **toda superfície que mostra uma etiqueta linka para ela**. Detalha: o catálogo com o critério escrito de cada valor, a política de fontes, o portão de cobertura, o método e a data de corte de qualquer critério derivado de dado, a lista de todas as classificações com fonte, data e origem (exceção individual, regra derivada ou padrão do partido), o registro de alterações, as limitações conhecidas e o canal de correção. A página `/sobre-o-modelo` apenas aponta para ela.

> **Mudança 1.1 → 1.2 (2026-09-05).** A versão 1.1 (e todas as anteriores) descreviam a projeção de candidatos como baseada em "swing" — variação em relação ao resultado de 2022, usado como âncora do modelo. Essa âncora exigia um mapeamento de coligação 2026→2022 (K-1, ADR-0015) que nunca ficou operacional, dependia de um campo (`historical_results.pct_validos`) nunca populado, e era "validada" por um gate de replay tautológico (dataset construído a partir do próprio 2022, ver `docs/reference/risks.md:27`). A 1.2 substitui o swing por **extrapolação do apurado por zona eleitoral** — regra de três sobre o que cada zona já apurou, sem depender de histórico — com 2022 relegado a comparação descritiva na tela. Justificativa completa em [ADR-0021](./architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md), que também supersede o ADR-0015. Nenhum outro parágrafo do § 8, nem qualquer outro princípio (§§ 1–7, 9–10), foi alterado.

## 9. Stack 100% Vercel

- Toda infraestrutura corre na Vercel (Compute, Edge Config, Blob, CDN, Cron, Analytics, BotID).
- Excepcionalidades exigem ADR justificando o trade-off.
- Mantém complexidade operacional baixa (single pane of glass).

## 10. Append-only para dados de apuração

- Snapshots do TSE **nunca** são sobrescritos — gravação `append-only` em `snapshots`.
- Habilita replay completo e validação por reprodução.
- Auditabilidade jurídica (caso necessário em disputa).

---

## Como aplicar

Antes de mergear qualquer PR, conferir que nenhum princípio acima foi violado. Toda spec em `docs/specs/` referencia os princípios aplicáveis. ADRs em `docs/architecture/adrs/` documentam decisões que dialogam com a constituição.
