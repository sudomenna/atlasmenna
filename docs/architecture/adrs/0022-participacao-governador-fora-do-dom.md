---
id: ADR-0022
title: Participação nacional em /governador — bloco explicativo estático antes da 1ª apuração, não "aguardando" nem omissão
status: deprecated
date: 2026-09-05
amended: 2026-09-27
---

# ADR-0022 — Participação nacional em /governador: bloco explicativo estático antes da 1ª apuração, não "aguardando" nem omissão

## Status

**Deprecated em 2026-09-27** (histórico — ver nota logo abaixo). Vigorou como **Aceito, emendado em 2026-09-06** entre 05/09 e 27/09: a decisão original (05/09) autorizava omitir o bloco inteiramente do DOM; a emenda de 06/09 substituiu a omissão por um bloco explicativo estático, sempre presente. O registro da decisão original está preservado na seção [Histórico da decisão](#histórico-da-decisão) — o que mudou, quando e por quê.

> **Nota 2026-09-27 — deprecated, decisão do dono.** O bloco de participação nacional agregada nesta rota — nas suas duas formas (os termômetros `<ProjectionThermometers variant="participacao-only" />` **e** o bloco explicativo estático que os substituía sem dado) — foi **removido inteiro** de `/governador` (`app/(gov)/governador/page.tsx`), nos dois estados do payload (com e sem `national.participacao`). A constante `PARTICIPACAO_HEADING` e o import de `ProjectionThermometers` saíram do arquivo. `tests/integration/governador-page.test.tsx` substituiu os antigos casos (j)/(k)/(l) por um único caso (j) que trava a **ausência** do bloco nos dois estados (ver [Cobertura de teste](#consequências)). As regras que este ADR fixava — bloco sempre presente no DOM, heading constante, bloco explicativo estático como fallback sem dado — **deixam de ter objeto**: não há mais bloco a manter presente, nem heading a preservar entre dois ramos, porque não há mais ramos. Este ADR não vira `superseded` porque não há ADR substituto decidindo uma nova forma de apresentar participação nesta rota — a decisão foi remover a métrica da página, do mesmo modo editorial que `<RaceStatsCards>` saiu da rota em 09/09 (ADR-0034, D23), não trocar a forma de apresentá-la. **Motivo:** decisão editorial do dono — o bloco não é desta página. Não é omissão por falta de dado (o payload pode ou não ter `national.participacao`; o resultado é o mesmo: nada é renderizado), portanto isto não é uma violação silenciosa do ADR-0018 (fallback visível quando falta dado *em bloco que existe*) — aqui não há bloco.

Enquanto vigorou (05/09 a 27/09), preservado aqui como registro histórico: este ADR **não supersedia o ADR-0018**, que permanece `accepted` e íntegro. Depois da emenda de 06/09, a divergência em relação ao ADR-0018 ficou menor do que era: a regra central — *blocos de projeção nunca somem do DOM* — passou a ser **cumprida** nesta rota também. O que este ADR ainda registrava era uma exceção estreita à **forma do fallback**: onde o ADR-0018 prescreve o estado "aguardando projeção", `/governador` usava um texto explicativo. Presença no DOM: igual a todas as outras rotas. Conteúdo do estado vazio: diferente, pelas razões abaixo. Desde 27/09 nada disso se aplica: o bloco não existe mais, então não há "forma de fallback" a comparar.

## Contexto

O ADR-0018 existe para que ausência de dado seja **visível**, nunca silenciosa: é regra de honestidade editorial e de acessibilidade (constituição § 4 e § 8), não de estética. Na prática, isso significa que qualquer bloco de projeção que ainda não tem dado renderiza um estado "aguardando projeção" anunciável por leitor de tela, em vez de simplesmente não existir no DOM — o leitor sabe que *há* algo a caminho, mesmo sem o valor.

A rota `/governador` (spec 006, grid nacional de 27 corridas estaduais) é estruturalmente diferente das outras três rotas com projeção (`/`, `/uf/[sigla]`, `/uf/[sigla]/governador`). Nessas três, cada bloco de candidato corresponde a uma corrida que **existe** desde o registro de candidatura — presidente é uma corrida nacional única, e cada UF tem uma corrida de governador única. Em `/governador`, não existe corrida nacional de governador: existem 27 corridas independentes, cada uma já coberta pelo bloco de candidatos por UF (`GovernorCard`, `HexCartogramBrasil`). O único número que é legitimamente **nacional** nessa página é a participação agregada (abstenção, brancos/nulos), calculada por `compute_participacao` como extrapolação por regra de três a partir das zonas já apuradas em qualquer UF, ponderada por eleitorado (mesmo método do ADR-0018/ADR-0021 para participação).

Essa agregação tem uma característica que os blocos de candidato não têm: antes de qualquer zona ter apurado em qualquer uma das 27 corridas, não há **nenhuma** base amostral sobre a qual extrapolar — o cálculo não tem "resultado pendente", tem **denominador vazio**. Isso é diferente de um candidato em `/uf/[sigla]/governador` a 0% apurado: ali a corrida existe (é uma UF específica com um pleito específico), só falta o primeiro boletim, e "aguardando" é a leitura correta porque há uma entidade concreta sendo aguardada. No `national.participacao` de `/governador`, antes da primeira zona apurar em qualquer lugar do país, não há entidade nenhuma à qual "aguardando" se refira — é um agregado que ainda não foi instanciado, não um valor pendente de uma corrida real.

Foi essa distinção — legítima e ainda vigente — que motivou a decisão original. O erro dela não estava no diagnóstico, e sim na conclusão: de "«aguardando» é semanticamente errado aqui" não se segue "logo, nada deve ser renderizado". Havia uma terceira opção, registrada como alternativa (b) já no ADR original e recomendada explicitamente pelo próprio autor: um texto estático que explica por que o número não existe, sem afirmar que um valor está a caminho. A emenda de 06/09 adota essa terceira opção.

## Decisão

> **Histórico — vigorou de 06/09 a 27/09/2026.** Esta seção descreve a decisão como ela funcionou até ser removida (ver nota de deprecação em [Status](#status)). Desde 27/09, nenhuma das duas formas abaixo existe mais em `/governador`.

Na rota `/governador` (`app/(gov)/governador/page.tsx`), o bloco de participação nacional agregada (abstenção, brancos/nulos, somados sobre as 27 corridas estaduais) **estava sempre presente no DOM**, em duas formas mutuamente exclusivas, decididas pela presença de `national.participacao` no payload:

1. **Com `national.participacao`** — renderiza `<ProjectionThermometers variant="participacao-only" />` normalmente: dois termômetros, faixa de incerteza, marcador do apurado e rótulo de base, como qualquer outro bloco de projeção. Inalterado em relação ao comportamento anterior.

2. **Sem `national.participacao`** (`null`/`undefined` — nenhuma zona apurou em nenhuma das 27 corridas) — renderiza no mesmo ponto da página um **bloco explicativo estático**: um `<section aria-labelledby>` cujo rótulo é um `<h2>` com o **mesmo texto e o mesmo nível** do heading do termômetro ("Participação do eleitorado"), seguido de dois parágrafos que explicam (a) que não existe corrida nacional de governador, sendo o número a soma de 27 disputas estaduais, e (b) que ele passa a existir quando a primeira zona eleitoral for apurada em algum estado.

Requisitos que a forma (2) tem de satisfazer, e que são a razão de ser da emenda:

- **É um landmark nomeado e anunciável.** `section` + `aria-labelledby` apontando para o `<h2>` produz uma `region` com nome acessível — alcançável por navegação de landmarks e de headings, exatamente como o bloco da forma (1).
- **A estrutura de headings não muda conforme o dado chega.** O mesmo `<h2>`, no mesmo ponto do documento, nas duas formas. Quem memorizou a página em um estado não a reencontra reorganizada no outro.
- **O texto não promete um valor nem sugere progresso.** Nada de "aguardando", "carregando", "em breve", nem percentual de exemplo. Ele descreve uma condição de existência ("passa a existir quando…"), que é literalmente verdadeira, não um evento em andamento.
- **Sem `role="meter"`, sem barra, sem faixa de incerteza.** Não há número; renderizar um medidor vazio seria a mesma desonestidade que a decisão original corretamente recusou.

O heading é uma constante única (`PARTICIPACAO_HEADING` em `app/(gov)/governador/page.tsx`) consumida pelos dois ramos, para que não seja possível divergir um do outro por edição descuidada.

Esta exceção continua estrita e não se estende:

- à rota `/` (home nacional, modo `multi-1t`) — os seis termômetros do ADR-0018 continuam sempre no DOM, em "aguardando projeção" quando falta dado, sem exceção;
- à rota `/uf/[sigla]` (presidencial por UF);
- à rota `/uf/[sigla]/governador` (governador por UF) — aqui a corrida existe desde o primeiro instante (é uma UF específica), então o estado "aguardando" é exatamente correto e permanece **obrigatório**;
- a qualquer bloco de candidato, em qualquer rota — candidatos sempre renderizam, mesmo a 0% apurado, em estado "aguardando", por força do ADR-0017/ADR-0018;
- a qualquer outro agregado nacional que venha a ser adicionado a `/governador` no futuro (por exemplo, um contador de "eleitos em 1T" cruzando as 27 corridas). Qualquer novo bloco com estado vazio atípico precisa da sua própria justificativa e do seu próprio ADR.

### Histórico da decisão

**Decisão original — 2026-09-05 (revista em 06/09, não mais vigente).** Ficava autorizado **omitir inteiramente do DOM** o bloco `<ProjectionThermometers variant="participacao-only" />` em `/governador`, sem nenhum estado "aguardando", exatamente quando `national.participacao` estivesse ausente no payload. O bloco voltava a renderizar assim que o campo deixasse de ser vazio. A justificativa era a da seção Contexto acima: "aguardando" pressupõe uma entidade concreta a caminho, e não existe "a corrida nacional de governador" à qual esse estado se refira.

Essa decisão foi tomada em resposta a um achado **HIGH** do `constitution-guard` sobre `app/(gov)/governador/page.tsx:199-210`, que exigia formalizar a exceção em ADR ou reverter o comportamento; a escolha, na ocasião, foi formalizar.

**Motivo da revisão — 2026-09-06.** O custo que a própria seção de Consequências deste ADR registrava como **real e não eliminado**: um usuário de leitor de tela que abrisse `/governador` antes da primeira apuração não recebia nenhum sinal de que existe uma métrica de participação na página — nem heading, nem texto. Era exatamente a omissão silenciosa que o ADR-0018 foi criado para evitar, aceita deliberadamente e mitigada apenas de forma temporal (a janela dura até a primeira zona reportar), sem nenhuma garantia de SLA sobre essa duração.

O que destravou a revisão foi perceber que o custo era **evitável sem reabrir a discussão de fundo**. A objeção a "aguardando" continua válida e foi preservada: o bloco explicativo não diz que há um valor a caminho. Mas ele fecha a lacuna de acessibilidade, restaura a simetria estrutural com as outras três rotas, e custa um texto estático — nenhuma lógica de estado nova. Ou seja: a alternativa (b), que o autor do ADR original havia recomendado na própria seção de alternativas e que o usuário reconsiderou e adotou em 06/09.

**O que exatamente mudou:** a decisão original omitia o bloco; a emenda o mantém no DOM em forma explicativa. Não mudou nada sobre o comportamento **com** dado, nem sobre as outras três rotas, nem sobre o ADR-0018 (que segue `accepted` e sem alteração), nem sobre a recusa em usar "aguardando" nesta rota específica.

**Remoção do bloco — 2026-09-27.** Por decisão do dono, o bloco de participação nacional agregada — nas suas duas formas (termômetros com dado; bloco explicativo estático sem dado) — foi removido inteiro da rota `/governador`. A constante `PARTICIPACAO_HEADING` e o import de `<ProjectionThermometers>` saíram de `app/(gov)/governador/page.tsx`; `tests/integration/governador-page.test.tsx` substituiu os casos (j)/(k)/(l) por um único caso (j) que exige a ausência do bloco nos dois estados do payload (com e sem `national.participacao`). Motivo: decisão editorial — o bloco não pertence a esta página, no mesmo espírito de `<RaceStatsCards>` ter saído da rota em 09/09 (ADR-0034, D23). Não é uma correção do diagnóstico das seções anteriores — a distinção entre "aguardando" e denominador vazio (alternativa (a), rejeitada) permanece um diagnóstico correto — nem uma reversão silenciosa da falha de acessibilidade que motivou a emenda de 06/09: é a decisão de que a métrica, agora, simplesmente não aparece nesta rota, com ou sem dado, eliminando por completo a assimetria "tem dado"/"não tem dado" que motivava tudo o que vem antes. Este ADR passa a `status: deprecated`: suas regras (bloco sempre presente, heading constante, texto explicativo como fallback) não têm mais objeto — não há bloco a regrar. Ver nota em [Status](#status).

## Consequências

**Positivas**:
- **A lacuna de acessibilidade que a decisão original assumia deixa de existir.** Quem usa leitor de tela recebe, antes da primeira apuração, um landmark nomeado, um heading e uma explicação do porquê — em vez de silêncio. É o principal ganho da emenda e a razão de ela ter acontecido.
- Evita, ao mesmo tempo, o estado "aguardando" semanticamente incoerente para uma entidade que não existe ("a corrida nacional de governador") — preserva o significado de "aguardando" nas rotas onde ele é usado (uma corrida concreta que ainda não reportou). As duas objeções são atendidas simultaneamente; não houve troca de um problema por outro.
- **Restaura a simetria estrutural entre as quatro rotas de projeção.** `/governador` volta a ter o mesmo esqueleto sempre-presente de `/`, `/uf/[sigla]` e `/uf/[sigla]/governador`, que são pareadas visualmente pelo ADR-0019. Some com o risco, registrado na versão original, de alguém refatorar as quatro em conjunto sem perceber que uma tinha um bloco condicional.
- Ganho editorial lateral: o texto explica ao leitor comum — não só ao de leitor de tela — uma característica não óbvia da página (não existe corrida nacional de governador; o agregado é a soma de 27 disputas). Antes, essa informação só existia neste ADR e num comentário de código.
- Custo de engenharia baixíssimo: markup estático, sem estado, sem client component, sem impacto de bundle (RNF-007a).

**Negativas**:
- A divergência em relação ao ADR-0018 não desaparece, só encolhe: `/governador` continua sendo a única rota cujo estado vazio não é "aguardando projeção". Alguém que leia apenas o ADR-0018 e depois esta rota ainda encontra uma diferença que precisa deste ADR para ser entendida. Mitigação: o comentário em `app/(gov)/governador/page.tsx` cita ADR-0018 **e** ADR-0022, e a diferença agora é de conteúdo do fallback, não de existência dele — muito menos capaz de passar despercebida do que a omissão era.
- Há dois textos que precisam permanecer coerentes com o mesmo conceito (o parágrafo explicativo e o rótulo de origem RF-062 do termômetro). Se a metodologia de `compute_participacao` mudar, os dois precisam ser revisados juntos; nada automatiza esse acoplamento.
- O bloco explicativo ocupa espaço vertical acima dos `<RaceStatsCards />` num momento em que a página tem pouco conteúdo real. É uma escolha deliberada (a informação vale o espaço), mas é espaço gasto num estado transitório.
- O nome do arquivo deste ADR (`0022-participacao-governador-fora-do-dom.md`) descreve a decisão original, não a emendada. Manteve-se por ser identificador estável já referenciado por `docs/_meta/index.json`, pela spec 006 e pelo código; o título do frontmatter foi atualizado. Quem chegar pelo nome do arquivo pode se confundir até ler o Status.

**Cobertura de teste — histórico, vigente de 06/09 a 27/09** (o que a versão original registrava como ausente): `tests/integration/governador-page.test.tsx` cobria os dois lados do comportamento — caso (j), com `participacao`, os dois termômetros; caso (k), sem `participacao`, o bloco explicativo com `section`/`aria-labelledby`/`<h2>`, a ausência de termômetro, a posição acima dos stats cards e a ausência de vocabulário de espera ("aguardando", "em breve", "carregando", "%"); caso (l), a igualdade da lista de headings entre os dois estados. A recomendação de teste de regressão feita na versão original estava atendida.

**Cobertura de teste — vigente desde 2026-09-27.** Os três casos acima deixaram de existir: com a remoção do bloco inteiro da rota (ver [Status](#status) e a entrada de 27/09 acima), `tests/integration/governador-page.test.tsx` os substituiu por um único caso, rotulado "🔴 (j) 'Participação do eleitorado' SAIU (dono, 2026-09-27) — com e sem dado", que exige a **ausência** do bloco de participação (termômetros e bloco explicativo) nos dois estados do payload — com e sem `national.participacao`. Mutação conferida: rodando este teste novo contra a página anterior à remoção (com o bloco presente), o teste reprova.

## Alternativas consideradas

**(a) Manter o estado "aguardando" do ADR-0018, sem exceção alguma.** Rejeitada em 05/09 e a rejeição **permanece válida após a emenda**. "Aguardando" pressupõe uma entidade concreta que será aguardada — uma corrida, um candidato, um valor que vai chegar. Não existe "a corrida nacional de governador" para a qual esse estado faça sentido: zero zonas apuradas em zero UFs não é "um resultado pendente", é a ausência da amostra que o cálculo pressupõe. Renderizar "aguardando" aqui implicaria falsamente que `/governador` tem uma corrida nacional homóloga às outras três rotas.

**(b) Renderizar um bloco explicativo estático, em vez de omitir.** **Esta é a decisão vigente desde 06/09.** Foi registrada como alternativa na versão original deste ADR, com a recomendação explícita do autor de que era melhor que a decisão então tomada, pela razão que a emenda confirmou: um texto explicativo não afirma que existe uma corrida ou um valor a caminho — apenas explica *por que* o número ainda não existe, o que é literalmente verdade e continua honesto —, e ao mesmo tempo resolve o custo de acessibilidade que a omissão registrava como não mitigado. A omissão total só teria vantagem sobre (b) se até *anunciar a existência futura* da métrica fosse indesejável, e não havia razão para isso.

**(c) Omitir o bloco inteiramente do DOM.** Foi a decisão original de 05/09, revista em 06/09 pelas razões da seção [Histórico da decisão](#histórico-da-decisão). Registrada aqui como alternativa rejeitada para que a leitura deste ADR não dependa de arqueologia de git.

## Cross-refs

- ADR-0018 (blocos de projeção sempre no DOM — regra geral; entre 06/09 e 27/09 era cumprida também em `/governador`, com exceção estreita quanto à forma do fallback; desde 27/09 não há mais bloco nesta rota ao qual a regra se aplique): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- ADR-0017 (transparência total em 3 camadas — candidatos sempre visíveis, inalterado por este ADR): [0017-transparencia-total-3-camadas.md](0017-transparencia-total-3-camadas.md)
- ADR-0019 (identidade visual por trilha — as quatro rotas de projeção pareadas visualmente; a emenda de 06/09 restaurava a simetria estrutural entre elas): [0019-identidade-visual-por-trilha.md](0019-identidade-visual-por-trilha.md)
- ADR-0021 (extrapolação do apurado por zona — método de `compute_participacao`, cuja ausência de amostra motivou esta exceção enquanto vigorou): [0021-extrapolacao-do-apurado-sem-2022.md](0021-extrapolacao-do-apurado-sem-2022.md)
- ADR-0034 (poda de blocos sem contraparte no protótipo do kit — precedente de remoção editorial de bloco de uma rota, ex. `<RaceStatsCards>` fora de `/governador` em 09/09, citado na nota de 27/09 acima): [0034-resultpanel-colapso-visual-corte-fora-do-kit.md](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
- Constituição § 4 (acessibilidade WCAG 2.1 AA) e § 8 (transparência metodológica — "o que está movendo o forecast"): [../../constitution.md](../../constitution.md)
- Spec 006 (grid nacional de governadores) — rota e bloco afetados: `docs/specs/006-grid-governadores/spec.md`
- `app/(gov)/governador/page.tsx` — 2026-09-27: o bloco de participação nacional e a constante `PARTICIPACAO_HEADING` foram removidos da rota; nenhuma das duas formas descritas na seção Decisão existe mais no arquivo (path corrigido nesta emenda — o ADR historicamente citava `app/governador/page.tsx`, sem o grupo de rota `(gov)`)
- `tests/integration/governador-page.test.tsx` — desde 2026-09-27, um único caso (j) trava a **ausência** do bloco nos dois estados do payload; os antigos casos (j)/(k)/(l), que travavam os dois estados com o bloco presente, foram substituídos
- NFR: `docs/nfr/accessibility.md` (RNF-023 — fallback de tabela para leitor de tela; não mais afetado por este ADR desde que o bloco saiu da rota)
