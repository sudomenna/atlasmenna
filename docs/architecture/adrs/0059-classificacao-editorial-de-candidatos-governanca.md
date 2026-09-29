---
id: ADR-0059
title: Classificação editorial de candidatos e parlamentares só sob condições fechadas — governança, base legal assumida e emenda à constituição (1.5 → 1.6)
status: accepted
date: 2026-09-29
---

# ADR-0059 — Classificação editorial de candidatos e parlamentares: governança e constituição 1.6

## Status

Aceito (2026-09-29) — execução autorizada pelo dono; revisão final do dono pendente.

A emenda à constituição descrita abaixo **já foi aplicada** a `docs/constitution.md` no working
tree (versão 1.5 → 1.6, `last_updated: 2026-09-29`), por autorização do dono para executar o plano
até o fim ("depois a gente corrige no final"). Ela **não está commitada** e a revisão palavra por
palavra do dono continua pendente. Diferente do [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md),
que formalizou o comportamento depois de ele estar no ar, este ADR e a emenda **precedem** qualquer
etiqueta pública: nenhuma etiqueta vai ao ar antes de três coisas — a emenda aprovada, os critérios
publicados e fonte e data em cada classificação.

## Contexto

Em 28–29/09/2026 o dono pediu etiquetas editoriais sobre candidatos a Governador, Senador e
Deputado Federal — campo ideológico, palanque presidencial, relação com o governo Lula (com uma
marcação à parte para o Centrão), trajetória no cargo e, só no Senado, posição sobre impeachment de
ministros do STF —, e visões derivadas delas: Senado 2027 por bloco com placar do impeachment, mapa
dos palanques, renovação, filtro por etiqueta e Câmara 2027. É um tipo de conteúdo que o produto
nunca teve: juízo editorial sobre **pessoas nomeadas**, e parte dele é opinião política.

O repositório afirma o contrário, por escrito, em mais de um lugar. Os comentários de
`components/blocks/CamaraHemiciclo.tsx:22-36`, `lib/utils/bancada.ts:28-32` e
`components/blocks/GovernadoresPorPartido.tsx:28-31` dizem que "o produto não classifica partido em
esquerda/direita (constituição § 2)", e são a razão declarada de as listas serem ordenadas por
tamanho e de o hemiciclo não ter eixo ideológico (ADR-0049, item 6 da Decisão). O § 2 da
constituição, por sua vez, protege a **ordem** contra critério editorial ("por simpatia editorial")
e a cor contra o hex oficial do partido, mas não fala de rótulos: não os autoriza nem os proíbe.
O preâmbulo (`docs/constitution.md:11`) exige ADR **e** versionamento para mudar princípio; o
precedente de fazer o contrário (ADR-0051) custou uma auditoria do `constitution-guard` e uma emenda
retroativa.

O calendário aperta. A virada de produção é em 03/10, o 1º turno em 04/10, e o dono decidiu que cada
visão entra no ar **quando ficar pronta**, inclusive durante a apuração. Isso empurra a classificação
para um regime de publicação sem deploy ([ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md)) e, por isso mesmo,
exige que as regras de o que pode ser dito, com que prova e sob que controle existam **antes** do
mecanismo — o mecanismo torna barato publicar, e o que é barato de publicar precisa de um limite
escrito de o que se pode publicar.

Sobre o risco jurídico: opinião política é dado pessoal sensível na LGPD (Lei 13.709/2018,
art. 5º, II). O tratamento de dado pessoal **exclusivamente para fins jornalísticos** está fora do
alcance da lei (art. 4º, II, "a"), e é a tese que sustenta este produto. Ela é defensável para uma
classificação ancorada em conduta pública (partido, votação nominal, palanque declarado) com fonte e
critério públicos, e é contestável quando a classificação vira inferência sem fonte. **Não houve
consulta a advogado**: o dono assumiu expressamente o risco em 2026-09-29, com as salvaguardas do
plano (fonte, data, critério público, aviso por superfície, chaves por visão). Este ADR registra a
decisão e a base legal invocada; **não é parecer jurídico**.

## Decisão

**1. A constituição é emendada (1.5 → 1.6) em três pontos.** O texto literal está em
`docs/constitution.md`; este ADR registra o porquê.

*§ 2 — novo parágrafo "Classificação editorial".* Uma etiqueta editorial sobre candidato ou
parlamentar só é permitida se **todas** as oito condições valerem:

1. **Catálogo fechado e versionado**, com o critério de cada valor escrito e publicado **antes** de
   o valor ser usado. Não existe etiqueta ad hoc.
2. **Fonte, data e revisão do dono em cada classificação.** Linha sem revisão nominal não é exibida.
3. **Distinção textual** do dado do TSE e da projeção do modelo. A etiqueta nunca se passa por um
   nem por outro.
4. **Paleta neutra**: nem vermelho nem azul, com piso de ΔE76 mensurável e verificado em teste
   contra as cores de partido, e **sempre texto**, nunca só cor.
5. **Nunca muda a ordem dos candidatos, nunca entra no modelo, nunca entra no Edge Config.** A
   etiqueta é camada de leitura; o que foi decidido em ADR-0051 sobre ordem segue intacto.
6. **"A classificar" nunca é exibido** ao leitor, e visão agregada só aparece quando o portão de
   cobertura está atendido.
7. **Critério simétrico**: o mesmo critério para todos, sem valor de conveniência para nenhum lado.
8. **Registro público de alterações e canal de correção.**

*§ 5 — esclarecimento.* O § 5 protege o **usuário** do produto. Dado público de candidato e de
parlamentar (nome, partido, cargo, votação nominal, mandato exercido) usado para fins jornalísticos
não é dado pessoal de usuário. Isso não afrouxa a proteção de terceiros: data de nascimento, CPF,
título de eleitor e documentos **nunca são gravados** (ADR-0039; a única leitura de data de
nascimento é em memória, sem persistência, ADR-0058). A base legal invocada para a classificação de
opinião política é a LGPD art. 4º, II, "a", **condicionada às salvaguardas do § 2 e do § 8** — elas
são o que dá conteúdo jornalístico à tese.

*§ 8 — novo item.* Página de metodologia das etiquetas (`/sobre-as-etiquetas`) **obrigatória**
enquanto qualquer etiqueta for exibida, e toda superfície que mostra uma etiqueta linka para ela.
`/sobre-o-modelo` ganha só um parágrafo com link, **sem `<h2>` novo** — o teste
`tests/integration/sobre-o-modelo-page.test.tsx:29-56` trava oito. Cada superfície leva o aviso
"Classificação editorial do AtlasMenna, com fonte e data — não é dado do TSE nem resultado do
modelo."

**2. Catálogo fechado — decisões finais do dono.** Categorias, valores e cargos de partida; a matriz
cargo × categoria fica no catálogo (`lib/etiquetas/catalogo.ts`), que também guarda a ordem fixa dos
valores e a sentinela `a_classificar`.

| Categoria | Valores | Observação |
|---|---|---|
| Campo ideológico | Esquerda · Centro-esquerda · Centro · Centro-direita · Direita · Sem posição clara | herda do partido; exceção por `sqcand` |
| Palanque presidencial (por turno) | Palanque de Lula · Palanque de Flávio Bolsonaro · Palanque duplo · Sem palanque declarado | o catálogo não tem palanque de Kassab |
| Relação com o governo Lula | Base do governo · Oposição · Independente | mais uma marcação à parte, **Centrão** (sim/não) |
| Trajetória no cargo | Tenta a reeleição · Volta ao cargo · Estreante no cargo | Deputado Federal pelo [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md) |
| Impeachment de ministros do STF | A favor · Contra · Sem posição pública | **só Senado**, inclusive os 27 que continuam |
| (interno) | `a_classificar` | estado padrão; nunca aparece como etiqueta |

Fora do catálogo, por decisão do dono: a categoria "governo do estado" e o perfil dos eleitos
(gênero, raça, idade — mantém o ADR-0039). Cargos: Governador, Senador **e** Deputado Federal.
Visões previstas: Senado 2027 + placar do impeachment, mapa dos palanques, renovação, filtro por
etiqueta, Câmara 2027.

**3. Herança do partido, medição para deputado com mandato.** Vale a **herança do critério do
partido** para "Relação" e "Campo" em Governador e Senador também (não só em Deputado): todo
candidato herda do partido, com exceção individual por `sqcand`. Em Deputado Federal, antes de
04/10 a etiqueta é **por partido** (a bancada é lida por agremiação; federação exige valor explícito
em `partidos.csv`); depois do resultado, os 513 eleitos são conferidos um a um. Para o **deputado com
mandato**, a "Relação com o governo" é **medida**, não presumida: a taxa de alinhamento à orientação
do governo nas votações **disputadas** (fonte e método no [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md)) — **≥ 65% →
Base do governo; ≤ 35% → Oposição; entre os dois → Independente**. Com menos de **30** votos em
votações disputadas (amostra pequena), vale o critério do partido; sem mandato, também. Os três
limiares (65, 35, 30) moram **juntos** em `lib/etiquetas/catalogo.ts`. O corte dos dados é
03/09/2026 e é visível na metodologia. Precedência resumida (o compilador está no
[ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md)): exceção por
`sqcand` > regra derivada (alinhamento, trajetória) > padrão do partido > `a_classificar`.

**4. Ordem dos blocos.** Nas visões por bloco, a ordem é fixa pelo catálogo: **Base do governo à
esquerda → Independente/aguardando no meio → Oposição à direita**. O `<desc>` da figura diz que a
posição reflete a **relação com o governo, não a ideologia**. O desenho está no
[ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md).

**5. Comentários e textos que dizem "o produto não classifica partido" são REESCRITOS, não
apagados.** A **ordem** das listas continua por tamanho (contagem), e isso segue sendo verdade e
segue valendo (ADR-0049 item 6, ADR-0051). Muda o motivo declarado: a classificação existe, mas
**vive só na camada de etiquetas** e nunca decide ordem. Alvos:
`components/blocks/CamaraHemiciclo.tsx:22-36`, `lib/utils/bancada.ts:28-32` e
`components/blocks/GovernadoresPorPartido.tsx:28-31`. Ficam como estão, por continuarem verdadeiros,
os `<desc>` e legendas que dizem que a ordem por tamanho de bancada "não representa posição
ideológica" (`CamaraHemiciclo.tsx:308`, `:340`) — descrevem a **visão por partido**, cuja ordem não
mudou. A limitação 03 de `/sobre-o-modelo` ("O modelo não tem opinião sobre o que ainda não
votou... nenhum ajuste editorial", `app/sobre-o-modelo/page.tsx:657-663`) **permanece verdadeira**:
o modelo não é tocado, e a condição 5 garante que nenhuma etiqueta o alcança. Critério de aceite da
reescrita: `grep -rn "não classifica"` em `app/`, `components/` e `lib/` não devolve mais nada.

**6. Preenchimento e revisão.** O dono fornece critérios e fontes; a primeira versão dos dados é
preenchida por Claude, em lotes, e o dono revisa. **Linha com `revisado ≠ sim` compila como
`a_classificar` e nunca é exibida.** Isso é o que mantém a revisão humana como condição de
publicação — e o que mantém o § 6 da constituição intacto: nenhuma saída de LLM é gerada em tempo de
execução nem chega à tela sem revisão nominal; o ADR-0005 (templates, não LLM) trata de texto gerado
em execução, não de curadoria offline revisada.

## Consequências

**Positivas**:
- A regra chega **antes** do código: é o oposto do que aconteceu com a ordem (ADR-0051), e não repete
  o achado de auditoria pós-fato.
- Oito condições, das quais várias são mecanizáveis (paleta e piso de ΔE em teste, ausência de
  `a_classificar` na tela, ordem invariante, catálogo fechado, campos obrigatórios no compilador) e
  passíveis de mutação manual: um `constitution-guard` futuro verifica sem julgamento subjetivo.
- Etiqueta e modelo ficam isolados por regra escrita (condição 5). A projeção, o Edge Config e a
  ordem de candidatos não dependem de nenhuma decisão editorial.
- A tese jurídica fica registrada com a sua fragilidade, em vez de implícita: quem herdar o produto
  sabe que o risco foi assumido, por quem, quando e que não houve parecer jurídico.
- O § 5 deixa de ser lido como proibição de mostrar dado público sobre candidato, sem afrouxar a
  proteção de terceiros (nascimento e documentos continuam nunca gravados).

**Negativas**:
- **O produto muda de postura, e a mudança é visível.** Até 29/09 ele afirmava, em três
  comentários e no desenho do hemiciclo, que não classificava ninguém; a partir daqui classifica.
  Reação sobre neutralidade na noite da eleição é o risco central e não é eliminado por nenhuma
  salvaguarda — só reduzido (chaves por visão, revisão nominal, fonte e data públicas, histórico).
- **O risco jurídico está assumido, não afastado.** Sem consulta a advogado. A tese do art. 4º, II,
  "a" exige finalidade **exclusivamente** jornalística e é contestável para inferência editorial
  sobre opinião política; classificação errada de candidato nomeado abre porta a contestação e a
  direito de resposta eleitoral (Lei 9.504/1997, art. 58 — não avaliado por advogado). O dono
  decidiu com esse conhecimento; este ADR não o atenua.
- **Herança de partido produz erro individual conhecido.** Candidato que diverge do partido em
  "Relação" ou "Campo" carrega o rótulo do partido até alguém abrir uma exceção por `sqcand`. Com
  centenas de candidatos e quatro dias, a maioria carregará o padrão do partido, e `revisado = sim`
  passa a significar "regra revisada", não "pessoa revisada". A página de metodologia precisa deixar
  visível a origem de cada linha (exceção individual, regra derivada ou padrão do partido) para que
  o leitor não confunda as três.
- **Os limiares 65/35 são escolha editorial, não resultado.** Deputado a um ponto percentual do
  corte muda de bloco; a sensibilidade da composição do Senado e da Câmara aos limiares não foi
  medida. O piso de 30 votos evita ruído de suplente de passagem, mas é igualmente arbitrário.
- **"Critério simétrico" é julgamento, não número.** A condição 7 não é mecanizável como um ΔE; a
  verificação depende de revisão editorial, e é exatamente o tipo de condição que se cumpre na letra
  sem se cumprir no espírito (mesma fraqueza que o ADR-0051 nomeou para "controle explícito").
- **Volume humano em quatro dias.** O portão de cobertura esconde a visão incompleta, o que é o
  desenho correto e significa que **uma visão pode simplesmente não aparecer na noite** por falta de
  classificação. Qualidade e velocidade competem, e a concorrência é resolvida a favor da qualidade
  por regra (condição 6).
- **Piso de ΔE fixado só na spec.** A condição 4 exige um número mensurável; o valor é decidido na
  spec de etiquetas e testado, não está escrito na constituição. Até essa spec fixá-lo, a condição
  não é verificável.
- **Três seções da constituição mudam de uma vez, cinco dias antes da eleição, com revisão final
  posterior.** A execução foi autorizada antes da revisão palavra por palavra. Se o dono discordar de
  algum texto depois, a correção é uma nova emenda, não um retrocesso silencioso.
- **A numeração da constituição desloca de novo.** A proposta do
  [ADR-0031](0031-piso-separacao-entre-partidos.md) (piso de separação ΔE76 ≥ 12 **entre** cores de
  partido), nunca aplicada, passa de "1.5 → 1.6" a **1.6 → 1.7** se vier a ser aprovada.

## Alternativas consideradas

- **Classificar sem emendar — ler o § 2 como já permitindo.** Rejeitada: o preâmbulo exige ADR e
  versionamento, e o ADR-0051 é a demonstração de o que uma leitura frouxa custa.
- **Só publicar depois da eleição.** Rejeitada pelo dono: cada visão entra "quando ficar pronta",
  inclusive na apuração. A salvaguarda escolhida é o portão de cobertura e as chaves por visão, não o
  adiamento.
- **Medir "Relação com o governo" pela taxa geral de alinhamento, não pela das votações
  disputadas.** Rejeitada pela evidência do projeto de origem: redações finais e acordos têm apoio
  quase unânime e puxam a taxa de todo mundo para cima (o PL cai de 32% para 12% quando só se contam
  as 597 votações disputadas; o Centrão, de ~75% para ~65%).
- **Presumir o partido também para o deputado com mandato e amostra suficiente.** Rejeitada: onde
  existe medida individual com amostra ≥ 30, medir é mais defensável do que presumir.
- **Incluir "governo do estado" e perfil dos eleitos (gênero/raça/idade).** Rejeitadas pelo dono
  (fora do escopo; o perfil dos eleitos mantém o ADR-0039).

## Cross-refs

- Constituição `docs/constitution.md` — § 2 (novo parágrafo "Classificação editorial"), § 5
  (esclarecimento), § 8 (novo item), nota "Mudança 1.5 → 1.6 (2026-09-29)" e a nota de numeração do
  ADR-0031, atualizada para 1.6 → 1.7.
- [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — a afirmação "o produto não
  classifica partido" de seu item 6 é o texto reescrito; a decisão de ordem por tamanho não muda.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — a ordem continua
  regida por ele; a condição 5 impede que etiqueta a altere.
- [ADR-0024](0024-paleta-editorial-por-partido.md) e [ADR-0031](0031-piso-separacao-entre-partidos.md)
  — paleta de partido, contra a qual a paleta neutra das etiquetas tem piso de ΔE.
- [ADR-0039](0039-portal-dados-abertos-tse-identidade-candidatura.md) e
  [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md) — recorte de PII e sua exceção
  transitória.
- [ADR-0005](0005-templates-nao-llm.md) — nenhuma saída de LLM em execução; a curadoria offline
  revisada não a contradiz.
- [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) — onde as
  etiquetas moram, como são publicadas sem deploy, o portão de cobertura e o vigia.
- [ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md) — o hemiciclo por bloco,
  a ordem Base → Oposição e as marcas de limiar; emenda o ADR-0049.
- [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md) — a
  foto dos 27 do Senado e o alinhamento à orientação do governo que alimenta a regra 65/35/30.
- Constituição § 2 (neutralidade), § 5 (sem PII), § 6 (determinismo), § 8 (transparência
  metodológica).
- Specs afetadas (a criar ou emendar, delegar a `spec-syncer`): etiquetas editoriais (catálogo,
  compilador, portão, aviso, `/sobre-as-etiquetas`), 011 (parágrafo com link em `/sobre-o-modelo`),
  006/016/017 (superfícies que exibem etiqueta).
- LGPD (Lei 13.709/2018), art. 4º, II, "a", e art. 5º, II — citados como base **assumida**, sem
  consulta a advogado.
