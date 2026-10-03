---
id: ADR-0051
title: Ordem de candidatos segue a base de apuração selecionada pelo leitor, não é fixa por critério editorial — emenda ao § 2
status: accepted
date: 2026-09-20
---

# ADR-0051 — Ordem de candidatos segue a base de apuração selecionada pelo leitor, não é fixa por critério editorial

## Status

**Aceito em 2026-09-20.** Decisão do dono, caminho **(a)** de duas opções apresentadas — **(a)** emendar o § 2 distinguindo reordenação editorial de reordenação por métrica selecionada pelo leitor, ou **(b)** reverter a reordenação nas quatro telas e no balão, mantendo só cor e intensidade seguindo o seletor.

> ⚠️ **A decisão foi tomada depois de o comportamento já estar no ar — inversão da ordem que o SDD deste projeto exige (spec/ADR antes do código).** A reordenação entrou em `290b8de` (2026-09-20) como decisão do dono registrada em código e formalizada como **RF-181** em `3e83759`, dentro da spec 003, que está `shipped`. Foi estendida ao balão do mapa (**RF-177**) em `b3029e8`, no mesmo dia. Em nenhum dos dois commits foi escrito ADR, e `docs/constitution.md` não foi versionado — o preâmbulo (`docs/constitution.md:11`) exige as duas coisas para mudar qualquer princípio: *"justificativa explícita registrada em ADR + atualização desta constituição com versionamento (não silenciosamente)"*. O conflito foi achado pelo `constitution-guard`, hoje, numa auditoria de rotina de `b3029e8` — não por revisão prévia de spec.

## Contexto

`docs/constitution.md:32`, texto literal, vigente desde a v1.0 e **nunca emendado**:

> "Nomes de candidatos e siglas partidárias aparecem **sempre na mesma ordem** dentro de uma mesma corrida (sem favorecimento por ordem de leitura)."

O produto contraria esse texto hoje. Desde `290b8de`, a lista de candidatos (`<ResultPanel>`) reordena quando o leitor troca o seletor "Parcial / Projeção" do shell — RF-181 (`docs/specs/003-home-nacional/spec.md:356-362`). Desde `b3029e8`, o mesmo vale para o balão do mapa nacional — RF-177 (`docs/specs/003-home-nacional/spec.md:302-312`, aceitação em cuja linha 311 já registra o conflito), e para a própria coloração do mapa (RF-189, `spec.md:314-329`) e para o traço de projeção na barra (RF-180, `spec.md:340-354`). O alcance é **quatro telas de resultado** (Presidente, Governador, Senador, e as páginas de UF que compartilham `<ResultPanel>`) mais o balão — não um componente isolado. A spec 003 está `shipped`; o comportamento não é experimental.

O próprio repositório já leu essa frase da constituição de forma **restritiva**, duas vezes, ambas citando o § 2 nominalmente:

- `docs/specs/019-fase-pre-eleicao/spec.md:444-449` — recusa ordenar candidaturas por `pct_projetado` zerado na fase pré-eleição *"porque o leitor lê como ranking (constituição § 2, 'sempre na mesma ordem dentro de uma mesma corrida')"*; a saída escolhida é o número de urna, crescente e estável entre recarregamentos.
- `docs/specs/018-identidade-candidatura/design.md:192-195` — recusa ordenar a lista de identidade de candidatura por nome ou por partido, pelo mesmo motivo: *"ordenar por nome ou por partido introduziria um critério editorial onde não deve haver nenhum"*; a saída é `numero` ascendente.

As duas leituras são coerentes com o texto literal e precisam **continuar valendo** depois desta emenda — nenhuma das duas telas tem um controle de base de apuração para o leitor acionar.

O argumento a favor de emendar, em vez de reverter: aquelas duas telas **não têm voto disputado sendo exibido** — qualquer ordem ali é escolha do produto, e é exatamente isso que o § 2 existe para proibir. Numa noite de apuração, com o seletor Parcial/Projeção, a ordem que RF-181 produz reflete **a métrica que o próprio leitor selecionou** num controle explícito e reversível a um clique. "Favorecimento por ordem de leitura" descreve o produto escolhendo a ordem por quem lê (nome, partido, simpatia, desempate arbitrário) — não o leitor escolhendo a ordem por si, ao trocar de base. Essa é uma leitura do **espírito** do princípio contra o **texto literal**, e o texto é o que vale até ser emendado — daí a necessidade deste ADR em vez de uma interpretação silenciosa.

Uma dívida de acessibilidade correlata e **não resolvida** por este ADR está registrada em `docs/reference/dividas-tecnicas.md`, item 17: desde `290b8de`, `<ResultPanel>` monta o DOM sempre na ordem de Projeção e reposiciona visualmente por CSS `order` conforme a base ativa — leitor de tela e `Ctrl+F` seguem a sequência do DOM, não a visual, o que a WCAG SC 1.3.2 (Meaningful Sequence) existe para proibir. Este ADR legitima a reordenação **visual** perante a constituição; não decide o item 17, que segue como decisão do dono em aberto (P2, três caminhos apresentados pelo `a11y-perf-auditor`).

## Decisão

O § 2 é emendado para distinguir dois tipos de reordenação, com critério auditável em vez de proibição total:

- **Proibida** (mantém o espírito original do princípio): ordem que o **produto** escolhe por critério editorial — nome, partido, simpatia, popularidade, ou qualquer desempate arbitrário decidido sem input do leitor.
- **Permitida**: ordem que reflete uma **métrica de voto** que o leitor selecionou num **controle explícito, visível e reversível** (ex.: o seletor "Parcial / Projeção" do `<ShellControls>`), sob três condições cumulativas:
  1. A métrica que ordena é sempre uma métrica de voto (`pct_atual`, `pct_projetado`) — nunca nome, partido ou juízo de valor.
  2. Na mesma tela, a mesma derivação de base rege ordem, cor e qualquer destaque correlacionado — nunca duas fontes de verdade discordando sobre quem lidera (é a garantia que RF-189 já formaliza para cor, e que este ADR estende como exigência constitucional para ordem).
  3. Dado ausente na base selecionada nunca produz um zero fabricado que desloque um candidato — a leitura cai inteira para a base com dado completo (o comportamento que RF-177 e RF-189 já implementam para o corte de "impossível saber").

Fora dessa exceção — telas ou fases sem controle de base ativa, como a fase pré-eleição (spec 019) ou a lista de identidade de candidatura (spec 018) — a ordem continua fixa e não pode ser escolhida pelo produto, exatamente como já decidido nessas duas specs.

## Proposta de emenda ao § 2 da constituição

Texto para aprovação e aplicação do dono — a edição de `docs/constitution.md` (versão 1.4 → 1.5, com nota de cabeçalho análoga às mudanças 1.0→1.1, 1.1→1.2, 1.2→1.3 e 1.3→1.4) **não é feita por este ADR**; é entregue aqui para revisão palavra por palavra.

> ## 2. Neutralidade política
>
> - Cores partidárias seguem uma **paleta editorial própria do AtlasMenna** — uma cor por partido/federação, documentada com hex exato em `docs/design-system/tokens.md` — **nunca** as cores oficiais de partido. Toda cor de partido deve ter **ΔE76 ≥ 10** em relação ao hex oficial documentado do partido (manual de marca ou uso reiterado em material oficial), critério auditável e verificável por qualquer agente ou revisor. A cor de cada partido é **estável durante toda a noite de apuração** e entre as duas noites do pleito (1º e 2º turnos): não muda por rank, por ordem de apuração, por margem ou por qualquer evento da corrida — apenas a **intensidade** (claro↔saturado) pode variar com a margem projetada, nunca a matiz.
> - Nomes de candidatos e siglas partidárias aparecem **sempre na mesma ordem** dentro de uma mesma corrida sempre que essa ordem for escolhida pelo produto — por nome, por partido, por simpatia editorial ou por qualquer critério de desempate decidido sem input do leitor (sem favorecimento por ordem de leitura). **Exceção expressa**: quando a tela oferece um controle explícito, visível e reversível a um clique para o leitor alternar entre bases de apuração de voto (ex.: "Parcial" e "Projeção"), a ordem PODE acompanhar a base selecionada pelo próprio leitor — a invariante protege contra o produto decidindo a ordem por quem lê, não contra o leitor decidindo por si mesmo. Essa exceção só vale quando, cumulativamente: **(a)** a métrica que ordena é sempre uma métrica de voto — nunca nome, partido ou juízo de valor; **(b)** a mesma derivação de base rege, na mesma tela, ordem, cor e qualquer destaque correlacionado, sem duas fontes de verdade discordando sobre quem lidera; **(c)** dado ausente na base selecionada nunca produz um zero fabricado que desloque um candidato — a ordem cai inteira para a base com dado completo. Fora dessa exceção — sem controle de base ativa, como a fase pré-eleição ou uma lista de identidade de candidatura sem contagem de voto —, a ordem permanece fixa e não pode ser escolhida pelo produto.
> - Insights gerados por templates **não emitem julgamento** ("Lula consolida vitória" é OK; "vitória esmagadora" não é).
> - Quando há ambiguidade na atribuição de bloco político 2022→2026, exibir disclaimer explícito.

Nota de cabeçalho proposta, a inserir logo após o parágrafo acima:

> **Mudança 1.4 → 1.5 (2026-09-20).** O texto anterior (vigente desde a v1.0, nunca emendado) proibia qualquer variação de ordem dentro de uma corrida, sem exceção. Em 2026-09-20 o dono decidiu, em `290b8de`, que a lista de candidatos passa a acompanhar a base de apuração ativa — formalizado como RF-181 em `3e83759` (spec 003, `shipped`) e estendido ao balão do mapa em `b3029e8` (RF-177), ambos no mesmo dia, **sem ADR nem versionamento da constituição no momento da decisão** — achado pelo `constitution-guard` em auditoria de rotina de `b3029e8`, não por revisão prévia. A 1.5 distingue "ordem que o produto escolhe por critério editorial" (permanece proibida) de "ordem que reflete a métrica de voto que o leitor selecionou num controle explícito e reversível" (passa a ser permitida, sob as três condições cumulativas do parágrafo). Preserva sem exceção as duas leituras restritivas já registradas no repositório — `docs/specs/019-fase-pre-eleicao/spec.md:444-449` (fase pré-eleição ordena por número de urna, nunca por `pct_projetado` zerado) e `docs/specs/018-identidade-candidatura/design.md:192-195` (lista de identidade de candidatura ordena por `numero`, nunca por nome ou partido) — porque nenhuma das duas telas oferece controle de base ativa. Justificativa completa em ADR-0051 (`./architecture/adrs/0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md`, caminho relativo à constituição). Nenhum outro parágrafo do § 2, nem qualquer outro princípio (§§ 1, 3–10), foi alterado.
>
> ⚠️ **Colisão de numeração a resolver na aplicação**: [ADR-0031](0031-piso-separacao-entre-partidos.md) (2026-09-08) também propôs uma emenda ao § 2 rotulada "1.4 → 1.5" (piso de separação perceptual ΔE76 ≥ 12 entre as cores da paleta), e essa emenda **nunca foi aplicada** a `docs/constitution.md` — o texto vigente hoje ainda diz "ΔE76 ≥ 10" sem menção a piso de separação mútua. As duas propostas não podem ocupar o mesmo número de versão. Se o dono aplicar esta emenda primeiro, a de ADR-0031 (se/quando aplicada) vira 1.5 → 1.6; se aplicar a de ADR-0031 primeiro, esta vira 1.5 → 1.6. Quem aplicar a emenda decide a ordem — este ADR não presume qual vem primeiro.

## Consequências

**Positivas**:

- Legitima, em vez de reverter, uma decisão de produto já tomada e já em produção (RF-181, RF-177), evitando desfazer trabalho do dono de ontem.
- Fornece um critério de três partes, auditável, para qualquer feature futura que queira oferecer reordenação por base — não é permissão aberta para "qualquer reordenação com uma boa razão", é uma regra mecanizável (métrica de voto + derivação única + sem zero fabricado) que um `constitution-guard` futuro pode verificar sem julgamento subjetivo.
- Preserva explicitamente as duas decisões restritivas já tomadas (specs 018 e 019), nomeando-as no próprio texto da constituição — reduz o risco de uma leitura futura ampliar a exceção além do que ela cobre hoje.

**Negativas**:

- **A ordem de leitura de uma corrida deixa de ser invariante.** Quem compara duas capturas de tela da mesma UF, tiradas com bases diferentes selecionadas, vai ver os candidatos em ordens diferentes — o que a v1.0 do § 2 foi escrita explicitamente para impedir. Este ADR aceita esse trade-off como o preço de refletir a escolha do leitor, mas o efeito observável (duas capturas discordantes) é real e não deve ser descrito como inofensivo.
- **A decisão foi tomada depois de o comportamento entrar no ar.** RF-181 e RF-177 já estavam em produção, sob uma spec `shipped`, quando este ADR foi escrito — o SDD deste projeto pede o oposto (spec/ADR primeiro, código depois). Este ADR formaliza retroativamente, não previne a próxima ocorrência do mesmo padrão.
- **Não resolve a dívida de acessibilidade correlata.** O item 17 de `docs/reference/dividas-tecnicas.md` (ordem visual via CSS `order` divergindo da ordem do DOM, WCAG SC 1.3.2) permanece aberto — este ADR legitima a reordenação perante a constituição, mas não decide entre as três mitigações que o `a11y-perf-auditor` apresentou para aquele item.
- **A exceção depende de um julgamento não totalmente mecanizável**: "controle explícito, visível e reversível" é um padrão de qualidade de interação, não um número como ΔE76. Um controle escondido, um clique difícil de descobrir, ou um toggle que não é obviamente reversível poderia satisfazer a letra da condição sem satisfazer o espírito — checagem futura vai exigir revisão de design, não só grep.
- **Colisão de numeração de versão com ADR-0031** (ver nota acima): duas emendas propostas ao § 2, ambas rotuladas "1.4 → 1.5", nenhuma renumerada até este ADR. Fica para o dono resolver a ordem de aplicação.

## Alternativas consideradas

- **(b) Reverter a reordenação** — a outra opção apresentada ao dono: desfazer RF-181 e RF-177 nas quatro telas e no balão, mantendo cor e intensidade seguindo o seletor (RF-189, que não envolve ordem de lista, só preenchimento de área). Rejeitada pelo dono porque desfaria uma decisão de produto de ontem sem que ela tenha se mostrado problemática na prática — a única objeção levantada foi de conformidade textual com a constituição, não de comportamento incorreto para o leitor.
- **Interpretar silenciosamente o § 2 como já permitindo isso** — rejeitada: o preâmbulo (`docs/constitution.md:11`) exige ADR **e** versionamento explícito para qualquer mudança de princípio; uma leitura frouxa sem registro repetiria exatamente o padrão que já causou o conflito (código à frente da doc, achado só em auditoria).

## Cross-refs

- Texto emendado: [`../../constitution.md`](../../constitution.md) (§ 2, linha 32 no texto pré-emenda; preâmbulo, linha 11)
- Precedente de mecanismo (ADR que emenda § 2 com proposta de texto + nota de versão para aprovação do dono): [ADR-0024](0024-paleta-editorial-por-partido.md), [ADR-0031](0031-piso-separacao-entre-partidos.md) — este último com a colisão de numeração nomeada acima
- Requisitos afetados: RF-181, RF-177, RF-189, RF-180 — [`../../specs/003-home-nacional/spec.md`](../../specs/003-home-nacional/spec.md)
- Leituras restritivas preservadas: RF-161 — [`../../specs/019-fase-pre-eleicao/spec.md`](../../specs/019-fase-pre-eleicao/spec.md#L444-L449); identidade de candidatura — [`../../specs/018-identidade-candidatura/design.md`](../../specs/018-identidade-candidatura/design.md#L192-L195)
- Dívida técnica correlata, não resolvida por este ADR: `docs/reference/dividas-tecnicas.md`, itens 17 (ordem visual vs. DOM, WCAG SC 1.3.2) e 18 (este conflito, registrado antes deste ADR)
- Commits: `290b8de` (decisão original), `3e83759` (formalização de RF-181), `b3029e8` (extensão ao balão do mapa, achado do `constitution-guard`)
