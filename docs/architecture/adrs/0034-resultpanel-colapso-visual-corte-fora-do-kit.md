---
id: ADR-0034
title: Painel de resultado do protótipo como hero único, colapso visual sem remoção de nós e poda dos blocos fora do kit — participação sai de três telas, não do payload
status: accepted
date: 2026-09-10
supersedes: ADR-0018
---

# ADR-0034 — Painel de resultado do protótipo como hero único, colapso visual sem remoção de nós e poda dos blocos fora do kit

## Status

Aceito. Este ADR **supersede o ADR-0018** — não parcialmente, como o ADR-0017 supersedia o ADR-0013:
a escolha de seis termômetros como hero do 1T multi-candidato é abandonada nas quatro rotas de
projeção onde o `<ResultPanel>` do kit entra (`/`, `/uf/[sigla]`, `/uf/[sigla]/governador`). A
metodologia do ADR-0018 (denominadores `v.vvc`/`e.c`/`e.esi`, IC de "Outros" por soma de resamples)
continua sendo a fonte de verdade da única instância remanescente de `<ProjectionThermometers>`, em
`/governador` (`variant="participacao-only"`), protegida pelo ADR-0022 — **não revisto por este
ADR**. Este documento fecha, também, a pendência que o próprio ADR-0033 deixou explicitamente aberta
em sua nota de emenda ao ADR-0029 (D17): se a reversão do hero era só de posição ou também de
conteúdo. É de conteúdo — este é o "ADR de acompanhamento" que aquele texto previu.

Este ADR também **emenda, sem supersedir**, o ADR-0017 (D21 — distingue *ocultar* de *colapsar
visualmente preservando a árvore*) e o ADR-0019 (D23 — `<TrilhaKicker>` sai de três das quatro
rotas). Os textos de emenda aplicados a `0017-transparencia-total-3-camadas.md`,
`0018-termometros-hero-1t.md`, `0019-identidade-visual-por-trilha.md` e
`0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md` estão reproduzidos na seção
[Texto de emenda aplicado](#texto-de-emenda-aplicado-nos-adrs-afetados) e foram **aplicados
diretamente** pelo mesmo agente que escreveu este documento — ao contrário da restrição que o
próprio ADR-0029 se impôs sobre 0017/0018, não há aqui restrição de processo contra editar o
`## Status` de outro ADR.

Formaliza três decisões do usuário tomadas na sessão de 2026-09-09 (D21, D22, D23), sobre a mesma
frente de trabalho — fazer a UI seguir o protótipo do kit Atlas Menna à risca — e por isso
registradas juntas, como o ADR-0033 já fez para D15–D17.

> **Nota 2026-09-27 (decisão do dono, [ADR-0022](0022-participacao-governador-fora-do-dom.md#status) `deprecated`).** A exceção registrada abaixo (D23, tabela de poda) e nas Consequências — `/governador` mantém `<ProjectionThermometers variant="participacao-only">`, protegida pelo ADR-0022, como única rota a não receber `<ResultPanel>` mas ainda assim distinta por reter esse bloco — deixou de existir: o dono removeu o bloco de participação inteiro dessa rota, nos dois estados do payload. O ADR-0022 passou a `status: deprecated` (suas regras não têm mais objeto). Isto não reabre o que este ADR decidiu em D21/D22/D23 nas outras três rotas, nem a razão pela qual `/governador` não recebeu `<ResultPanel>` (seção "Por que `/governador` não recebeu o `<ResultPanel>`", intocada) — apenas remove a última instância ativa de `<ProjectionThermometers>` no produto.
>
> **Nota 2026-09-27 (emenda parcial, [ADR-0055](0055-resultpanel-top2-cartoes-versao-d.md)).** D22
> muda de forma: a lista completa de candidatos por rank/sigla/votos/PARCIAL/PROJ dá lugar aos
> dois primeiros da base ativa em cartões lado a lado + os demais em um único cartão em linhas
> (versão D do protótipo de 2026-09-27). As duas `<Figure>` ("Apurado", "Margem") e a
> `<VoteBar marker={50}>` que D22 introduziu acima da lista **ficam como estão**. D21 (colapso
> visual, todos os candidatos sempre no DOM) e D23 (poda de blocos sem contraparte no protótipo)
> não são tocados por essa emenda.

## Contexto

Os commits `b7c1bbb` ("painel de resultado na forma do protótipo (D21, D22)") e `910f21f` ("painel
do protótipo nas rotas de UF e mapa recortado por estado") introduziram um novo componente,
`<ResultPanel>` (`components/blocks/ResultPanel.tsx`), como hero de resultado em três das quatro
rotas de projeção. O código já documenta a decisão em comentário de cabeçalho de cada arquivo
tocado, mas nenhum ADR formalizava, até agora, que isso contraria a letra de cinco ADRs `accepted`.
Sem essa formalização, a próxima sessão que ler `0017`/`0018`/`0019` como única fonte de verdade
desfaria o trabalho — o padrão de erro que este ADR existe para prevenir.

### D21 — o botão "Todos os N candidatos" e a distinção entre ocultar e colapsar

O ADR-0017 proíbe literalmente "qualquer botão 'Mostrar todos os N candidatos'"
(`0017-transparencia-total-3-camadas.md:33`, "sem `display:none`, sem `hidden`, sem `<details>`") e
o ADR-0029 § 7 reafirma essa proibição contra o próprio componente equivalente do kit (`ResultPanel`
do protótipo, `App.jsx:39`, que faz `rows.slice(0, limit)` — remoção literal de itens do array antes
do render). O `<ResultPanel>` do SalaCofre (`components/blocks/ResultPanel.tsx:204-215`) monta
**todas** as linhas de candidato, sempre, no mesmo `<ol>`, na ordem do ranking:

```
const linhas = candidatos.map((c, i) => {
  const props = candidateResultRowProps(c, i + 1, i >= 2 && c.pct_atual < 3);
  return (
    <li className={i >= limit ? resultPanelExtraRowClass : undefined} ...>
      <CandidateResultRow {...props} variant="kit" />
    </li>
  );
});
```

Quando há excedentes (`candidatos.length > limit`, `limit` default 6 — `ResultPanel.tsx:169,202`),
as linhas inteiras (não um subconjunto) são passadas como `children` para
`<CandidateListCollapse>` (`components/blocks/CandidateListCollapse.tsx`). Esse componente client
não decide o que renderizar — só escreve `data-collapsed` na `<ol>` e mantém `aria-expanded`/
`aria-controls` no botão (`CandidateListCollapse.tsx:79-108`). Quem clipa é
`components/blocks/ResultPanel.module.css:44-47`:

```css
.list[data-collapsed="true"] > .extra {
  height: 0;
  overflow: hidden;
}
```

Isto é a mesma mecânica do padrão `sr-only`: o nó continua no DOM, com layout próprio, só clipado —
o oposto de `display:none`/`hidden`/`<details>`, que removem o nó da árvore de acessibilidade.
Medido no navegador em 2026-09-09, com um payload de 11 candidatos: 11 `<li>` com `display:list-item`
computado, o contêiner `.extra` a `0px` de altura e o filho projetado (o conteúdo real da linha) a
`55px`, e a 11ª linha (a última, a mais "escondida" visualmente) alcançável pela árvore de
acessibilidade do navegador. O botão em si é rotulado `"Todos os {total} candidatos"` /
`"Mostrar menos"` (`CandidateListCollapse.tsx:103`) — o mesmo texto que o ADR-0017 proíbe **quando o
botão remove nós**. A proibição nunca foi sobre o texto do botão; foi sobre a remoção.
`CandidateListCollapse.tsx:19-23` já documenta essa leitura no próprio código, citando ADR-0017,
ADR-0029 § 7 e ADR-0033 § 2 — mas nenhum dos três ADRs tinha, até este documento, uma nota
formalizando que a leitura foi aceita, e não presumida pelo autor do componente.

### D22 — o painel de resultado do protótipo substitui os seis termômetros

`ResultPanel.tsx` traduz `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:20-43` campo a
campo: duas `<Figure>` no topo (`ResultPanel.tsx:230,242-263`) — "Apurado" (com a nota "X de Y votos
válidos", `:190-193`) e "Margem `<líder>`" (com o número da outra base — parcial ou projeção — na
`note`, para nenhuma leitura ficar indisponível em nenhum estado do controle de visualização) —, uma
`<VoteBar marker={50}>` com três segmentos (líder · Outros · 2º colocado, `:268-277,144-162`), e a
lista de candidatos com rank/sigla/votos/PARCIAL/PROJ via `<CandidateResultRow variant="kit">`
(`:212`). Este painel passa a ser o hero de **três** rotas — a home (`app/(pres)/page.tsx:391-401`,
só no modo `multi-1t`) e as duas rotas de UF (`app/(pres)/uf/[sigla]/page.tsx:440-449`,
`app/(gov)/uf/[sigla]/governador/page.tsx:377-386`, nos dois turnos, sem dispatch de modo — o
`<ResultPanel>` é o mesmo componente em `binary` e `multi-1t` nessas duas rotas, ao contrário da
home).

Isto substitui, nessas três rotas, o hero de seis termômetros do ADR-0018
(`<ProjectionThermometers />`) e a lista "Composição de Outros" (`<MinorCandidatesList>`) por uma
única superfície. **Consequência aceita explicitamente pelo usuário**: brancos, nulos e abstenção
saem da tela de resultado nessas três rotas — o `<ResultPanel>` não tem campo para participação, só
para candidatos. O ADR-0018 existia, em parte, precisamente para que essa omissão não acontecesse
(`0018-termometros-hero-1t.md:22`, "constituição § 8 exige que toda página com projeção mostre 'o
que está movendo o forecast'"; `:44`, "atende constituição § 8 ... participação deixa de ser dado
omitido"). O dado não desaparece do sistema: continua em `EdgeParticipacao`/
`EdgePayloadUf.participacao` (comentário em `app/(pres)/uf/[sigla]/page.tsx:290-294` confirma que o
campo segue presente no payload, só sem consumidor nessas rotas) e continua exibido em
`/governador`, onde o ADR-0022 torna o bloco de participação agregada **obrigatório**
(`app/(gov)/governador/page.tsx:284-320` — termômetro com dado, ou o parágrafo explicativo estático
sem dado, nunca omissão).

O ADR-0018 listou quatro razões para rejeitar exatamente este padrão como hero do 1T multi-candidato
(`0018-termometros-hero-1t.md:20,22,24,26`): (i) esconder o 3º colocado quando é competitivo; (ii)
omitir participação; (iii) misturar denominadores (`v.vvc`, `e.c`, `e.esi`) sob uma única
normalização; (iv) IC de "Outros" incorreto se calculado por subtração em vez de soma de resamples.
O próprio ADR-0029, um dia antes de o usuário reverter a posição do hero (nota D17, aplicada pelo
ADR-0033), reafirmou essas quatro razões como vigentes e usou-as para descrever exatamente por que
copiar o `ResultPanel` do kit seria um erro
(`0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md:51`, "o padrão do próprio protótipo reproduz
exatamente o problema (i) e (ii)"). Este ADR não refuta esse diagnóstico — ele continua correto. O
que mudou é que o usuário, em 2026-09-09, decidiu aceitar os custos (i) e (ii) explicitamente em
troca da fidelidade ao protótipo, nas rotas de corrida única. A razão (iii) fica moot nessas rotas —
não há mais denominadores múltiplos exibidos ali para confundir. A razão (iv) também fica moot — o
IC de "Outros" não é mais exibido como número isolado (o agregado "Outros" vira só um segmento da
`<VoteBar>` e uma entrada na lista, sem faixa de incerteza própria renderizada).

### D23 — poda do que não está no protótipo

A tradução para o kit continuou o padrão já usado pelo ADR-0029/ADR-0033 (comparar página real ao
protótipo em `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx` e cortar o que não tem
contraparte), agora aplicado às duas rotas de UF e complementado no grid nacional de governadores.
Nenhum arquivo de componente foi apagado — os cortes são só de call site, verificáveis pelos
comentários de cabeçalho de cada `page.tsx` tocado e pela ausência de `import` correspondente.
Verificado componente a componente, com `grep` sobre `app/`, em 2026-09-10:

| Componente | Saiu de | Continua em | Por quê |
|---|---|---|---|
| `BreakingNewsTicker` | `/uf/[sigla]`, `/uf/[sigla]/governador` | `/` (`app/(pres)/page.tsx:342`), `/governador` (`app/(gov)/governador/page.tsx:251`) | conteúdo ambiente (ADR-0029 § 1); as rotas de corrida única não têm "chamadas recentes" no mesmo sentido de rota nacional |
| `WinnerBanner` (RF-032, distinto de `NationalWinnerBanner`) | `/uf/[sigla]`, `/uf/[sigla]/governador` | — | sem contraparte no protótipo (comentário em ambos os arquivos) |
| `UFBreadcrumb` | `/uf/[sigla]`, `/uf/[sigla]/governador` | — | o protótipo não tem breadcrumb; orientação "onde estou" passa a ser o `<CargoTabs>` do shell + título do painel |
| `TrilhaKicker` | `/uf/[sigla]`, `/uf/[sigla]/governador`, `/governador` | `/` (`app/(pres)/page.tsx:371`) | ver emenda ao ADR-0019 abaixo |
| `InsightCard` | `/uf/[sigla]`, `/uf/[sigla]/governador` | `/` (`app/(pres)/page.tsx:506`, quando `insights.length > 0`) | sem contraparte no protótipo nas rotas de UF |
| Agulha estadual (`<Needle>`, painel "Forecast") | `/uf/[sigla]`, `/uf/[sigla]/governador` | — | sem contraparte no protótipo (distinto de `<NationalNeedle>`, que é da home) |
| `RaceStatsCards` | `/governador` | — | único call site do componente no repositório; sem contraparte no protótipo |
| `MunicipioWaffleGrid` | `/uf/[sigla]/governador` | — | cortado em 2026-09-08 (S06 leftover), sem contraparte no protótipo; a tabela de municípios (acessível) permanece |
| `ProjectionThermometers` | `/` (ambos os modos), `/uf/[sigla]`, `/uf/[sigla]/governador` | `/governador` (`variant="participacao-only"`, `app/(gov)/governador/page.tsx:293`) | ADR-0022 obriga o bloco de participação de governador; é a única das quatro rotas em que sobrevive |
| `ApuracaoMeta` | `/` — só no modo `multi-1t` | `/` — modo `binary` (`app/(pres)/page.tsx:412`) | vira a `<Figure>` "Apurado" do `<ResultPanel>`; o modo `binary` não usa `<ResultPanel>` |

Duas entradas do levantamento inicial do usuário **não foram localizadas como removidas** em nenhum
call site do código em `app/` na revisão deste ADR (2026-09-10): `NationalWinnerBanner`
(`app/(pres)/page.tsx:355-361`, renderizado incondicionalmente, nos dois modos) e `TurnoOneRecap`
(`app/(pres)/page.tsx:421`, renderizado quando `turno === 2`). Ambos continuam com call site ativo na
home. Registrado aqui por precisão — não como contradição da decisão do usuário, mas para que este
ADR não formalize um corte que a implementação não fez; se a intenção era cortá-los também, é um
gap de implementação a resolver separadamente, não uma leitura equivocada deste ADR sobre um corte
já existente. `RunoffScenarios`, `DecisiveUFsGrid` (cortados do `app/(pres)/page.tsx` pelo
ADR-0033 § 2, antes desta sessão) e `TwoRoundIndicator` (substituído por `<ChancesPanel>` na home,
comentário em `app/(pres)/page.tsx:94`) já estavam fora da home antes de D21–D23 e não são
re-decididos aqui — citados só para composição completa do quadro que o usuário pediu.

Quatro exceções resistem ao corte, por regra de nível mais alto que fidelidade ao protótipo:

- **`ForecastTransparency`** — constituição § 8 (transparência metodológica obrigatória em toda
  página com projeção). Presente nas quatro rotas.
- **`Footer`** — constituição § 1 ("Não oficial. Fonte: TSE." obrigatório em todo footer). Presente
  nas quatro rotas.
- **`MunicipioExplorer`/`MunicipioTable`** — constituição § 4 ("Mapas devem ter `aria-label` + lista
  textual paralela", `docs/constitution.md:53`). É a alternativa acessível ao mapa municipal nas
  duas rotas de UF (`app/(pres)/uf/[sigla]/page.tsx:464-469`,
  `app/(gov)/uf/[sigla]/governador/page.tsx:404-411`). No protótipo esse papel seria do
  `BiggestPanel` (`App.jsx:353`), que este produto **não adota** porque o payload não tem
  eleitorado por município — bloqueado, não recusado.
- **`ProjectionThermometers` em `/governador`** — ADR-0022, ver tabela acima.

E duas retenções por decisão explícita do usuário, sem embasamento constitucional, registradas para
não serem cortadas depois por engano de "fidelidade ao protótipo": `StateGroupedTable` ("Placar por
estado", `app/(pres)/page.tsx:474-485`, já retido pelo ADR-0033 § 2) e a grade de 27
`<GovernorCard>` em `/governador` (`app/(gov)/governador/page.tsx:407`, retida porque é o próprio
conteúdo da rota — o protótipo não tem 27 corridas simuladas, só uma UF de exemplo).

### Por que `/governador` não recebeu o `<ResultPanel>`

As outras três rotas trocaram o hero pelo `<ResultPanel>` porque cada uma corresponde a **uma**
corrida (presidencial nacional, ou uma UF específica de presidente/governador). Em `/governador`,
`national.candidatos` é a concatenação das 27 corridas estaduais — na fixture, 81 candidatos, com
`rank` reiniciando a cada UF (`app/(gov)/governador/page.tsx:86-93`). Um `<ResultPanel>` sobre esse
array publicaria "1º Gov AC, 2º Gov AC, 4º Gov AL" como se fosse um placar nacional e uma "Margem"
comparando dois candidatos do Acre sob uma barra de 50% que não significa nada agregado — a
constituição § 6 (determinismo: a UI não inventa número) e § 8 (transparência metodológica) barram
essa leitura. A rota mantém o `<Panel>` "Governadores 2026" com o parágrafo que explica as 27
disputas e o bloco de participação (ADR-0022).

## Decisão

**D21.** O `<ResultPanel>` mantém o botão "Todos os N candidatos"/"Mostrar menos"
(`<CandidateListCollapse>`), mas ele **nunca remove nenhum candidato do DOM, da árvore de
acessibilidade ou da busca da página**, em nenhum estado. O colapso é puramente visual — clip de
altura via CSS (`ResultPanel.module.css:44-47`), sem `display:none`, `hidden` ou `<details>`. Este
mecanismo satisfaz a letra e o espírito do ADR-0017/ADR-0029 § 7/ADR-0033 § 2, que proíbem a
**remoção** de nós, não o colapso visual com árvore preservada.

**D22.** O hero de resultado da home (modo `multi-1t`), de `/uf/[sigla]` e de `/uf/[sigla]/governador`
passa a ser o `<ResultPanel>` do kit: duas `<Figure>` (Apurado, Margem do líder), `<VoteBar>` com
marcador em 50%, e a lista completa de candidatos com rank/sigla/votos/PARCIAL/PROJ. Isto substitui,
nessas três rotas, os seis termômetros do ADR-0018 e a lista "Composição de Outros". Consequência
aceita: brancos, nulos e abstenção saem dessas três telas. O dado permanece no payload
(`EdgeParticipacao`/`EdgePayloadUf.participacao`) e continua obrigatório em `/governador`
(ADR-0022). O ADR-0018 fica **superseded** por este ADR nas quatro rotas de projeção como regra
geral de hero; sua metodologia de cálculo permanece vigente para a instância de
`/governador`.

**D23.** As duas rotas de UF e o grid nacional de governadores cortam os componentes sem
contraparte no protótipo listados na tabela acima, com as quatro exceções constitucionais e as duas
retenções por decisão do usuário também listadas acima. Nenhum arquivo foi apagado — apenas o call
site.

## Consequências

**Positivas**:
- Fecha a lacuna de rastreabilidade que motivou este ADR: cinco ADRs `accepted` (0017, 0018, 0019 e,
  por associação de conteúdo, 0022 e 0029) deixam de contradizer silenciosamente o código — a
  próxima sessão que ler `docs/architecture/adrs/` antes do código não vai mais desfazer o trabalho
  de 08–09/09.
- A distinção formal entre "ocultar" e "colapsar visualmente" (D21) é reutilizável **só para
  listagens sem alteração de contagem**. Desde 2026-09-20 (`d5765c4`), `MunicipioTable` pagina
  REMOVENDO nós da DOM (20 + 40, não colapso visual) — um padrão diferente que não reutiliza esta
  decisão. Prioridade de futuro: formalizar quando remover é preferível a colapsar.
- Fecha explicitamente a pendência que o ADR-0033 nomeou como aberta (D17) — a próxima leitura do
  ADR-0029 não encontra mais uma tensão sem resposta na própria nota de Status.
- A tabela de D23 dá a qualquer agente futuro uma fonte única de "o que saiu de onde e por quê",
  em vez de depender de ler quatro comentários de cabeçalho de `page.tsx` para reconstruir o mesmo
  quadro.

**Negativas**:
- **A perda de participação nas três telas de corrida única é uma regressão real de transparência**,
  não cosmética — é exatamente o que o ADR-0018 foi escrito para evitar (constituição § 8). O
  usuário aceitou esse custo explicitamente em troca de fidelidade ao protótipo; este ADR registra o
  aceite, não o referenda como neutro.
- **Duas entradas do pedido original do usuário (`NationalWinnerBanner`, `TurnoOneRecap`) não têm
  call site removido em nenhum arquivo revisado** — ou a intenção do usuário não foi implementada
  para esses dois componentes, ou a lista original incluía itens que na verdade nunca chegaram a sair.
  Este ADR não resolve a discrepância, só a registra, para não formalizar um corte que a
  implementação não fez.
- **`/governador` fica estruturalmente assimétrica em relação às outras três rotas** — é a única com
  `<ProjectionThermometers>` e sem `<ResultPanel>` — por uma razão de fundo bem documentada (não há
  corrida nacional de governador), mas isso é mais uma diferença que um futuro refactor "unificar as
  quatro rotas" precisa saber respeitar, não uma inconsistência a corrigir.
- **O ADR-0018 vira `superseded` como regra geral, mas sua metodologia continua sendo consumida por
  código em produção** (`/governador`) — um leitor que veja "superseded" e conclua que o cálculo de
  denominadores/IC não vale mais em lugar nenhum estaria errado. A nota de Status aplicada ao
  ADR-0018 tenta prevenir essa leitura, mas é uma nuance que só sobrevive se for lida.
- **O colapso visual de D21 mantém todas as N linhas no DOM mesmo colapsadas** — o custo de payload
  HTML e de trabalho de layout que o ADR-0017 já aceitava (todas as camadas sempre no DOM) não muda,
  mas agora soma-se ao custo (pequeno) do próprio `<CandidateListCollapse>` como client component.

## Texto de emenda aplicado nos ADRs afetados

Aplicado diretamente por este documento, sem restrição de processo:

**`0017-transparencia-total-3-camadas.md`** — frontmatter `amended_by` passa a listar `ADR-0034`
junto de `ADR-0029`; no `## Status`, acrescentado:

> **Nota 2026-09-10 (D21, [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)).** A
> permanência "sempre no DOM" ganha uma segunda camada de precisão: o botão "Todos os N candidatos"
> do painel de resultado (`<CandidateListCollapse>`, `components/blocks/CandidateListCollapse.tsx`)
> não remove nenhuma linha excedente — clipa via `height: 0; overflow: hidden`
> (`components/blocks/ResultPanel.module.css:44-47`), a mesma mecânica de `sr-only`. A proibição
> deste ADR sempre mirou a REMOÇÃO de nós (`display:none`, `hidden`, `<details>`), nunca o colapso
> visual que preserva a árvore de acessibilidade e a busca da página — medido no navegador em
> 2026-09-09 (11 linhas com `display:list-item` computado, a 11ª alcançável pela árvore de
> acessibilidade). Ver ADR-0034 para o levantamento completo.

**`0018-termometros-hero-1t.md`** — frontmatter `status` passa de `accepted` para `superseded`,
acrescido `superseded_by: ADR-0034`; no `## Status`, acrescentado:

> **Superseded em 2026-09-10 por [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md).**
> A reversão do hero do `multi-1t` registrada na nota de emenda do ADR-0029 (D17, 2026-09-08) deixou
> de ser só de posição: o ADR-0034 substitui inteiramente os seis termômetros pelo `<ResultPanel>`
> do kit na home e nas duas rotas de UF. As quatro razões pelas quais este ADR rejeitou o duelo
> top-2 (esconder o 3º colocado competitivo; omitir participação; misturar denominadores
> `v.vvc`/`e.c`/`e.esi`; IC de "Outros" incorreto por subtração) permanecem corretas como
> diagnóstico — o ADR-0034 não as refuta, registra que o usuário aceitou os custos que elas
> descrevem. A metodologia deste ADR (denominadores, IC de "Outros" por soma de resamples) continua
> sendo a fonte de verdade da única instância remanescente de `<ProjectionThermometers>`, em
> `/governador` (`variant="participacao-only"`, ADR-0022 — não revisto por este ADR nem pelo
> ADR-0034).

**`0019-identidade-visual-por-trilha.md`** — frontmatter acrescido `amended_by: ADR-0034`; no
`## Status`, acrescentado:

> **Nota 2026-09-10 (D23, [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)).**
> `<TrilhaKicker>` sai de três das quatro rotas que este ADR cobria — `/uf/[sigla]`,
> `/uf/[sigla]/governador` e `/governador` — na poda de blocos sem contraparte no protótipo do kit.
> Sobrevive apenas na home (`/`), acima do `<h1>` do painel de resultado, como este ADR descreve. O
> mecanismo (atributo `data-trilha` + tokens `--trilha-accent`/`--trilha-accent-soft` redefinidos
> por seletor) não muda, e as três rotas continuam declarando `data-trilha` no `<main>` — só o
> elemento visual de kicker desaparece delas.

**`0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md`** — frontmatter acrescido
`amended_by: ADR-0034`; no `## Status`, acrescentado após a nota de 2026-09-08:

> **Nota 2026-09-10 ([ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)).** A
> pendência registrada pela nota de emenda do ADR-0033 (D17) acima — se a reversão do hero do
> `multi-1t` era só de posição ou também de conteúdo — está resolvida: é de conteúdo. O ADR-0034
> substitui os seis termômetros (item 6 desta Decisão) pelo `<ResultPanel>` do kit inteiro, e por
> isso o ADR-0018 fica `superseded` (ver a nota correspondente no próprio ADR-0018). Os itens 1–5 e
> 7–9 desta Decisão permanecem intocados; o item 7 (`<CandidateResultRow>` com parcial/projeção lado
> a lado) é, na prática, absorvido pelo `<ResultPanel>`, que usa a mesma linha internamente.

## Alternativas consideradas

- **Copiar o botão do kit tal como está (`rows.slice(0, limit)`)** — rejeitada: é exatamente o que
  o ADR-0017/ADR-0029 § 7 proíbem; teria exigido reabrir os dois ADRs para autorizar remoção de nós,
  o que o usuário não pediu.
- **Manter os seis termômetros como hero e só restilizá-los na densidade do kit** — era a leitura
  original do ADR-0029 item 6 (posição muda, conteúdo não); foi revogada pelo usuário em 08/09 (D17,
  ADR-0033) e a reversão de conteúdo, não só posição, é o que este ADR formaliza.
- **Adotar o `<ResultPanel>` também em `/governador`** — rejeitada por má-formação semântica: o
  array `national.candidatos` ali não é uma corrida, é 27 corridas concatenadas; o painel produziria
  um "líder" e uma "margem" nacionais fictícios, violando constituição § 6 e § 8.
- **Manter `<TrilhaKicker>` nas quatro rotas e só mudar seu conteúdo** — não foi a decisão do
  usuário; o corte foi motivado por "sem contraparte no protótipo", não por um problema no
  componente em si.

## Cross-refs

- [ADR-0017](0017-transparencia-total-3-camadas.md) — emendado (D21, distinção ocultar vs. colapsar
  visualmente).
- [ADR-0018](0018-termometros-hero-1t.md) — **superseded** por este ADR como regra geral de hero;
  metodologia de cálculo permanece vigente via ADR-0022.
- [ADR-0019](0019-identidade-visual-por-trilha.md) — emendado (D23, `TrilhaKicker` sai de 3 de 4
  rotas).
- [ADR-0022](0022-participacao-governador-fora-do-dom.md) — não revisto; é a razão pela qual
  `<ProjectionThermometers>` sobrevive em `/governador`.
- [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) — emendado; fecha a pendência D17
  deixada pelo ADR-0033.
- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) — registrou a
  reversão do hero (D17) como pendência aberta; este ADR a resolve. Não é emendado por este
  documento (a pendência estava em sua nota de emenda ao ADR-0029, não em seu próprio `## Status`).
- Constituição § 1 (rodapé regulatório — `Footer` inegociável), § 4 (mapas precisam de lista textual
  paralela — `MunicipioExplorer`/`MunicipioTable`), § 6 (determinismo — a UI não inventa número,
  razão para `/governador` não receber `<ResultPanel>`), § 8 (transparência metodológica —
  `ForecastTransparency`, e o custo aceito da participação sair de três telas):
  [../../constitution.md](../../constitution.md)
- `components/blocks/ResultPanel.tsx`, `components/blocks/ResultPanel.module.css`,
  `components/blocks/CandidateListCollapse.tsx` — implementação de D21/D22.
- `app/(pres)/page.tsx`, `app/(pres)/uf/[sigla]/page.tsx`,
  `app/(gov)/uf/[sigla]/governador/page.tsx`, `app/(gov)/governador/page.tsx` — call sites afetados
  por D22/D23, cada um com comentário de cabeçalho datado descrevendo o corte.
- Specs afetadas (frontmatter `adrs:` deve passar a citar `0034`, e `0018` deve sair da lista onde
  não é mais aplicável): `docs/specs/003-home-nacional/spec.md`,
  `docs/specs/004-pagina-uf-presidencial/spec.md`, `docs/specs/005-pagina-uf-governador/spec.md`,
  `docs/specs/006-grid-governadores/spec.md`.
- Pendente de propagação (`spec-syncer`): `docs/_meta/traceability.md` (RF-030.5/RF-030.6 e as
  entradas de `ProjectionThermometers`/`MinorCandidatesList` nas specs 003/004/005 regridem, mesmo
  padrão já sinalizado pelos comentários "DEIXARAM de ter implementação" nos `page.tsx` tocados),
  `docs/design-system/components.md` (novo componente `ResultPanel`/`CandidateListCollapse`; catálogo
  de `TrilhaKicker`/`ProjectionThermometers`/`ApuracaoMeta`/`WinnerBanner`/`UFBreadcrumb` precisa
  refletir as rotas reais de uso), `docs/reference/risks.md` (perda de participação em 3 de 4 telas
  como risco de transparência aceito).
