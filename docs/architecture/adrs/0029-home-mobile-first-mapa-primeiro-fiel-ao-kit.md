---
id: ADR-0029
title: Home mobile-first com mapa primeiro e abas de cargo no rodapé, não pilha de blocos com hero de texto no topo — fidelidade ao protótipo do kit Atlas Menna
status: accepted
date: 2026-09-07
amended_by: [ADR-0034, ADR-0074] # 0034: fecha a pendência D17 (nota de ADR-0033): a reversão do hero é de conteúdo, não só posição — ADR-0018 fica superseded; 0074: terceiro componente de cliente no shell (Decisão 2)
---

# ADR-0029 — Home mobile-first com mapa primeiro e abas de cargo no rodapé, não pilha de blocos com hero de texto no topo

## Status

Aceito. Este ADR **emenda parcialmente** o ADR-0018 (só a **posição** do hero de seis termômetros no fluxo da página — o conteúdo, os denominadores e a lógica de IC do ADR-0018 permanecem intactos e são reforçados, ver Decisão) e o ADR-0017 (só o **formato visual** das linhas de candidato nas Camadas 2 e 3 — a regra "todas as camadas sempre no DOM, sem collapsible" permanece integralmente vigente e é usada aqui para **rejeitar** um padrão do próprio kit, ver Decisão). Não supersede nenhum dos dois. Não emenda o ADR-0012 nem o ADR-0028 — o texto de ambos já comporta o que este ADR decide sobre o seletor de turno (ver Decisão, item 4).

> **Nota de processo.** Por restrição desta sessão, quem escreveu este ADR não edita `0017-transparencia-total-3-camadas.md` nem `0018-termometros-hero-1t.md`. O texto exato de frontmatter e da nota em `## Status` a aplicar em cada um está reproduzido ao final da seção Decisão, para aplicação manual após revisão.

> **Nota 2026-09-08 (D17, [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md)).**
> A exceção aberta pelo item 6 da Decisão abaixo — manter o conteúdo do hero (seis termômetros,
> ADR-0018) e apenas **reposicioná-lo** para abaixo do bloco de mapa, em vez de adotar a composição
> de hero do próprio protótipo (mapa + `Figure` "Apurado" + `Figure` "Margem" + `VoteBar` + linhas de
> candidato, descrita no Contexto acima) — foi **revogada** pelo usuário nesta data: o hero da home
> volta a ser o do protótipo. O ADR-0033 registra esta reversão sem resolver, em nome do usuário, a
> tensão entre ela e as quatro razões pelas quais o ADR-0018 rejeitou o duelo top-2 como hero do 1T
> multi-candidato — razões que este próprio ADR-0029 reafirmou como vigentes um dia antes da
> reversão (ver "O padrão do próprio protótipo reproduz exatamente o problema (i) e (ii)" na Decisão,
> item 6). O restante desta Decisão — itens 1–5 e 7–9 — permanece integralmente vigente e não é
> tocado por esta nota.

> **Nota 2026-09-10 ([ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)).** A
> pendência registrada pela nota de emenda do ADR-0033 (D17) acima — se a reversão do hero do
> `multi-1t` era só de posição ou também de conteúdo — está resolvida: é de conteúdo. O ADR-0034
> substitui os seis termômetros (item 6 desta Decisão) pelo `<ResultPanel>` do kit inteiro, e por
> isso o ADR-0018 fica `superseded` (ver a nota correspondente no próprio ADR-0018). Os itens 1–5 e
> 7–9 desta Decisão permanecem intocados; o item 7 (`<CandidateResultRow>` com parcial/projeção lado
> a lado) é, na prática, absorvido pelo `<ResultPanel>`, que usa a mesma linha internamente.

> **Nota 2026-10-04 ([ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md)).** A
> restrição de que o shell global carrega só **dois** componentes de cliente (`<ViewModeSwitch>` e
> `<ThemeToggle>`, a Decisão 2 e a expectativa (e) de `tests/unit/shell/static-shell.test.ts`) passa a
> admitir um **terceiro**, `<AtualizacaoAutomatica>`, que chama `router.refresh()` a cada minuto. A
> proibição de `cookies()`, `headers()` e `searchParams` no shell permanece intacta.

## Contexto

Em 2026-09-07 o usuário rodou o protótipo do kit Atlas Menna (`docs/design-system/atlas-menna/ui_kits/atlas-menna/`, `viewport="430x900"` — um app de celular, não uma maquete de desktop) lado a lado com a home em produção, na mesma largura de 430px, e mediu oito diferenças estruturais:

| # | Protótipo | Hoje |
|---|---|---|
| 1 | Mapa é a primeira coisa, ocupando quase uma tela | mapa vem depois do título, do badge e de três figuras de contexto |
| 2 | Dois controles globais no topo: "1º/2º turno" e "Parcial/Projeção" | nenhum dos dois (turno vem do calendário, ADR-0012/ADR-0028) |
| 3 | Abas de cargo fixas embaixo (padrão de app) | abas no topo, e "Deputado Federal" quebra em duas linhas em 430px |
| 4 | Selo "70% APURADO" e botão de tema na barra do topo | badge "ao vivo" dentro da página; tema é Bloco 2 |
| 5 | Título pequeno dentro do painel ("Resultado parcial") | `<h1>` gigante ocupando a primeira dobra |
| 6 | Hero = mapa + duas figuras grandes + `VoteBar` + linhas de candidato com parcial (tinta) e projeção (ocre) lado a lado | seis termômetros com IC (ADR-0018) |
| 7 | Rótulos dos estados em mono sobre o mapa | sem rótulos |
| 8 | Rolagem total 3.129px | 6.770px |

O estado real da home hoje (`app/page.tsx:38-76`) já é o resultado do Bloco 1 do redesign (ADR-0025): uma sequência de `<Panel>`s com filete e kicker, cada bloco RF-bound preservado (D3 do handoff `docs/_meta/handoff-2026-09-07-redesign.md`), com o hero do modo `multi-1t` sendo `<ProjectionThermometers />` (ADR-0018) acima do bloco de mapa (`HomeClientShell`, mais abaixo na página). O shell global (`TopBar`/`TabBar`, ADR-0025 § 2) ainda não foi implementado nesta sessão — este ADR define o que ele deve conter e onde cada controle vive, antes da implementação.

O protótipo, porém, **não é fonte de verdade de produto** — é uma maquete com dados simulados, e a comparação lado a lado revelou quatro divergências factuais que precisam ser corrigidas na tradução para o AtlasMenna, e uma quinta divergência de comportamento (não listada na tabela do usuário, encontrada nesta revisão) que contraria um princípio já fixado:

- **Senado**: o protótipo rotula a corrida como `'1 vaga'` (`ui_kits/atlas-menna/App.jsx:349`, `cargo === 'senador' ? ' · 1 vaga' : ''`). 2026 tem **2 vagas por UF** (renovação de 2/3) — confirmado em `docs/architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md:35` ("2 vagas por UF, renovação de 2/3 em 2026 → 54 vagas no total"). O rótulo do kit está errado para este pleito; a spec 016 (Senador) não deve herdá-lo.
- **Wordmark**: `TopBar` do kit usa `brand="Atlas Menna"` como default (`components/layout/TopBar.jsx:3`, `ui_kits/atlas-menna/App.jsx:327`). O produto é **AtlasMenna**.
- **Rodapé**: o protótipo fecha a página com `"Protótipo com dados simulados. Candidaturas conforme registros no TSE encerrados em 15 ago 2026..."` (`App.jsx:358`). O AtlasMenna tem obrigação regulatória de rodapé — "Não oficial. Fonte: TSE." com link para `resultados.tse.jus.br` (constituição § 1) — que não é opcional nem substituível pelo texto do kit.
- **Rótulos de estado sobre o mapa** (item 7 da tabela) não são um ajuste de estilo: MapLibre GL renderiza texto em camadas `symbol` a partir de **glyphs PBF** (fontes SDF pré-processadas, servidas por range de código Unicode) referenciados pela propriedade `glyphs` do style spec — o protótipo usa geometria TopoJSON com D3 (`ui_kits/atlas-menna/MapView.jsx`, fora do escopo de produção, que usa PMTiles + MapLibre per ADR-0003/ADR-0004), então não paga esse custo. Habilitar rótulos no mapa real do AtlasMenna exige hospedar um conjunto de glyphs PBF (gerado uma vez, ex. via `fontnik`/`build-glyphs`, algumas centenas de KB por família tipográfica, servido estaticamente) e apontar `glyphs` no style — é pipeline geo, não token de design. Ver Consequências.
- **Divergência de comportamento não listada pelo usuário, encontrada nesta revisão**: `ResultPanel` do protótipo (`ui_kits/atlas-menna/App.jsx:39` — `rows.length > limit ? <D.Button ...>{all ? 'Mostrar menos' : 'Todos os N candidatos'}</D.Button> : null`) esconde candidatos além do 6º atrás de um botão "Mostrar todos". Isso é exatamente o padrão que o **ADR-0017 proíbe** ("todas as camadas sempre presentes no DOM... sem `display:none`, sem `hidden`, sem `<details>`", `0017-transparencia-total-3-camadas.md:30`) e que o próprio ADR-0017 justifica com a constituição § 4 (acessibilidade — um toggle quebra a narrativa linear que leitores de tela percorrem). O kit não foi desenhado pensando nessa regra; a tradução para o AtlasMenna **não adota o botão "Mostrar todos"**.

## Decisão

A home (`/`) e, por extensão de padrão, `/uf/[sigla]`, `/governador`, `/uf/[sigla]/governador` adotam a ordem de conteúdo e os controles do protótipo, com as correções acima. A ordem de blocos abaixo vale para **os dois breakpoints** (mobile <960px e desktop ≥960px) — este ADR **não** adota o layout de duas colunas (sidebar fixa + mapa) que o protótipo usa em desktop (`ui_kits/atlas-menna/App.jsx:371-379`, `gridTemplateColumns: 'var(--sidebar-w) 1fr'`). Essa divergência é deliberada, não uma omissão: o pedido do usuário comparou o protótipo e a home **nos dois casos em 430px** (a tabela das 8 diferenças é sobre a visão mobile), a spec 003/ADR-0025 já comprometeram a home a uma coluna linear restilizada em vez de uma segunda árvore de layout, e uma reforma para grid de duas colunas no desktop dobraria a superfície de decisão desta sessão sem medição equivalente à que fundamenta este ADR. A home ganha a mesma ordem de blocos em ambos os breakpoints; o que muda por breakpoint é só a posição da navegação de cargo (item 3) e a largura do mapa.

**1. Mapa primeiro.** O bloco de mapa (`HomeClientShell`, que hoje aparece depois do hero de termômetros) passa a ser o primeiro bloco de conteúdo da página, logo abaixo do shell (`TopBar` + seus controles). Em mobile, ocupa uma altura fixa de viewport (o protótipo usa `52vh`, mín. `400px` — `App.jsx:383`); em desktop, altura máxima fixa (não full-bleed) para não empurrar o resto do conteúdo para fora da primeira dobra. `NationalWinnerBanner` (renderização condicional, só quando há vencedor projetado) e `BreakingNewsTicker` continuam existindo — o ticker passa para uma faixa fina entre o `TopBar` e o mapa (compatível com sua natureza de conteúdo ambiente, não hero); o banner de vencedor, quando aplicável, aparece logo abaixo do mapa, antes do painel de resultado.

**2. Dois controles globais no `TopBar` do shell — turno e visualização.** `app/layout.tsx` ganha, dentro do `TopBar` portado (ADR-0025 § 2), duas `SegmentedControl`: "1º turno / 2º turno" e "Parcial / Projeção". A segunda é puramente de apresentação client-side (alterna qual coluna cada `CandidateRow`/`VoteBar` enfatiza e qual base o choropleth do mapa usa — parcial ou projetada — sem nova requisição de rede, os dois valores já vêm no mesmo payload). A primeira é **um controle de navegação, não uma forma de contornar o calendário**: o ADR-0012 já resolve `(cargo, turno)` a partir da data/hora do servidor para decidir qual é a corrida **ao vivo**, e o ADR-0028 (aceito no mesmo dia) já formaliza que todo call site deve passar `cargo`/`turno` **explícitos** aos readers, em vez de depender do default implícito de `currentRace()`. O seletor de turno deste ADR é apenas mais um desses call sites explícitos: seu valor default é `currentPresidentialTurno()` (nome pós-renomeação do ADR-0028); trocar o valor não pede ao modelo para "fingir" um turno que não aconteceu — pede ao reader o turno **arquivado**, via `readArchivedProjection({ cargo: "pres", turno: 1 })`, o mesmo mecanismo que já alimenta o `<TurnoOneRecap />` hoje (`app/page.tsx:138`). Portanto: (a) antes de 04/10/2026, só existe uma opção real (1º turno) — o controle aparece com a opção "2º turno" desabilitada, nunca oculta, para não sugerir dado que não existe; (b) durante o 2T (25/10), a opção "1º turno" fica habilitada e leva ao arquivo, sem nunca sobrescrever qual turno o resto do site (badge "ao vivo", polling) trata como corrente. Nenhum código deste ADR contraria ADR-0012 ou ADR-0028 — o contrário: implementa o padrão de chamador explícito que o ADR-0028 pede, generalizado para um controle de UI.

**3. Abas de cargo — TabBar embaixo no mobile, SegmentedControl em cima no desktop.** D5 do handoff (4 cargos: Presidente · Governador · Senador · Dep. Federal, com Senador/Deputado desabilitados até as specs 016/017 shippar) continua valendo integralmente — o que muda é só a posição. Em **mobile** (<960px), a navegação de cargo migra do topo (onde "Deputado Federal" quebra em duas linhas hoje) para um `<TabBar>` fixo no rodapé, portado de `docs/design-system/atlas-menna/components/layout/TabBar.jsx` — mesmo padrão do protótipo, e mesmo padrão de app nativo consagrado (zona de alcance do polegar). Em **desktop** (≥960px), a navegação permanece no topo como `SegmentedControl`, exatamente como o próprio protótipo já faz (`ui_kits/atlas-menna/App.jsx:330`, `desktop ? <D.SegmentedControl ... options={[...4 cargos...]} /> : null`) — o `TabBar.jsx` do kit se autodocumenta como `/** Bottom navigation (mobile) */` (`TabBar.jsx:2`), então manter o cargo no topo em desktop não é uma divergência da fonte, é seguir a própria intenção responsiva do kit. Justificativa: em mobile a barra inferior está na zona de alcance do polegar e é convenção de app; em desktop não há a mesma restrição de ergonomia, o mouse alcança o topo com o mesmo custo que o rodapé, e manter a navegação primária no cabeçalho é a convenção de web desktop que o próprio protótipo assume por padrão.

**4. Selo de apuração e tema no shell.** `<LiveBadge>` (com o percentual apurado da corrida ativa, ou "ao vivo" antes da 1ª apuração) e `<ThemeToggle>` migram para o lado direito do `TopBar`, junto ao wordmark — como o protótipo já faz. Isso não introduz estado dinâmico no layout (`ThemeToggle` já é `localStorage` + script anti-flash, ADR-0025 § 5; `LiveBadge` já é alimentado pelo mesmo payload client que hoje o renderiza dentro da página).

**5. Título pequeno dentro do painel, `<h1>` preservado.** O `<h1>` gigante que hoje domina a primeira dobra é substituído pelo padrão do protótipo: o painel de resultado (`ResultPanel` no kit → o `Panel` "Projeção Atlas Menna · não oficial" hoje em `app/page.tsx`) recebe um título pequeno, no mesmo peso visual do `title` do `Panel` ("Resultado parcial" / "Projeção Atlas", alternando com o controle "Parcial/Projeção"). Para não perder a estrutura de heading exigida pela constituição § 4 (WCAG 2.1 AA) e pelo `<TrilhaKicker />` do ADR-0019 (kicker acima do `h1`), **o título do painel é literalmente o `<h1>` da página** — não um `<p>` ou `<span>` estilizado como heading falso. `<TrilhaKicker />` continua acima dele. O que muda é só a escala tipográfica (a mesma do `Panel.title` de qualquer outra seção, não `--text-5xl`), não a semântica.

**6. Hero do modo `multi-1t`: seis termômetros permanecem, mudam de posição, não de conteúdo.** O ADR-0018 listou quatro razões para rejeitar o duelo top-2 como hero do 1T multi-candidato: (i) esconder o 3º colocado quando é competitivo; (ii) omitir participação (abstenção, brancos, nulos); (iii) misturar denominadores diferentes (`v.vvc`, `e.c`, `e.esi`) sob uma única normalização; (iv) IC de "Outros" só correto via soma de resamples, não subtração. **O padrão do próprio protótipo reproduz exatamente o problema (i) e (ii)**: `ResultPanel` com `poles={true}` (`App.jsx:349`) monta um "Figure 'Margem <líder>'" a partir de `a.pct - b.pct` — um duelo top-2 clássico — e nenhuma parte da tela do protótipo mede abstenção, brancos ou nulos. Copiar esse padrão para o modo `multi-1t` do AtlasMenna desfaria o ADR-0018 pelas mesmas razões pelas quais ele foi escrito. Por isso: **o ADR-0018 não é superseded**. `<ProjectionThermometers />` continua sendo a Camada 1 do modo `multi-1t`, com os mesmos seis termômetros, os mesmos três denominadores rotulados e o mesmo IC por soma de resamples — apenas restilizado com os átomos do kit (`VoteBar` por termômetro, no lugar da barra atual; `Figure` para o "Apurado" agregado) e **reposicionado**: passa a vir logo abaixo do bloco de mapa (item 1), não acima dele. `<MinorCandidatesList />` ("Composição de Outros") e `<TwoRoundIndicator />` continuam onde estão hoje, dentro do mesmo painel, sem mudança de conteúdo. Em modo `binary` (2T), o padrão de duelo top-2 do protótipo (Figure + `VoteBar` de 2 segmentos + `CandidateRow` × 2) **é** apropriado — 2T é genuinamente binário — e serve de alvo de restyle para `<HeadlineScore />`, sem alteração de ADR.

**7. `<CandidateRow />` com parcial e projeção lado a lado — camadas 2 e 3, não a camada 1 do 1T.** O padrão de linha do kit (`components/data/CandidateRow.jsx`) — rank, nome, `PartyTag`, barra fina, percentual parcial e percentual de projeção lado a lado com indicador de delta (▲/▼) — é adotado para as Camadas 2 (`<CandidateRanking />`) e 3 (`<MinorCandidatesList />`) do ADR-0017, substituindo o formato hoje comprimido (pct + IC) por parcial+projeção lado a lado, mais legível e mais alinhado ao § 8 da constituição (mostrar o que está "movendo o forecast"). **Sem o botão "Mostrar todos"** do kit (achado do Contexto): todas as linhas continuam sempre no DOM, com a tipografia compacta já prevista pelo ADR-0017 para a Camada 3 em telas estreitas. Em modo `binary`, o mesmo formato de linha se aplica à Camada 1 (`<HeadlineScore />`), onde o duelo top-2 é a leitura correta (item 6).

**8. Rótulos de estado no mapa — depende de pipeline de glyphs, não é decidido aqui.** Este ADR **autoriza** a intenção editorial (rótulos de UF em mono sobre o mapa nacional, como no protótipo), mas não decide a implementação — isso é escopo do `map-builder`, que precisa primeiro resolver a hospedagem dos glyphs PBF (ver Contexto e Consequências) antes de qualquer código de rótulo ser escrito. Até lá, o mapa segue sem rótulos textuais, sem regressão em relação a hoje.

**9. Constituição § 1 — rótulo "não oficial" é inegociável, sobrevive à recomposição.** Toda superfície onde a nova composição exibe `showProj`/projeção (o painel de resultado, os termômetros, o `VoteBar`) mantém o rótulo "não oficial" já em uso hoje (kicker "Projeção Atlas Menna · não oficial"). O rodapé constitucional ("Não oficial. Fonte: TSE." + link) permanece de posse da página (invariante 4 do handoff — `Footer` não migra para o shell), com o texto vigente — **não** o texto de protótipo do kit ("Protótipo com dados simulados..."). O wordmark do `TopBar` é `"AtlasMenna"`, nunca `"Atlas Menna"` (o nome do kit é interno, de design system — não é marca de produto).

### Texto de frontmatter a aplicar (após revisão, fora deste ADR)

Em `0018-termometros-hero-1t.md`, no frontmatter:
```yaml
amended_by: ADR-0029  # posição do hero no fluxo da página; conteúdo e denominadores inalterados
```
E, na seção `## Status`, acrescentar após o parágrafo existente:
> **Nota 2026-09-07 (ADR-0029).** A posição de `<ProjectionThermometers />` no fluxo da página muda — passa a vir logo abaixo do bloco de mapa, não acima dele, como parte da recomposição "mapa primeiro" da home mobile-first. O conteúdo, os denominadores por categoria e o cálculo de IC por soma de resamples permanecem exatamente como decidido aqui.

Em `0017-transparencia-total-3-camadas.md`, no frontmatter:
```yaml
amended_by: ADR-0029  # formato de linha das Camadas 2/3 (parcial+projeção lado a lado); regra "sempre no DOM" reafirmada, usada para rejeitar toggle do kit Atlas Menna
```
E, na seção `## Status`, acrescentar:
> **Nota 2026-09-07 (ADR-0029).** As linhas de candidato das Camadas 2 e 3 adotam o formato visual do componente `CandidateRow` do kit Atlas Menna (parcial e projeção lado a lado, com delta), em vez do formato comprimido pct+IC anterior. A regra central deste ADR — todas as camadas sempre no DOM, sem collapsible — é reafirmada e usada explicitamente para **rejeitar** o botão "Mostrar todos os N candidatos" presente no componente equivalente do kit (`ResultPanel`), que violaria esta regra se copiado sem revisão.

Nenhuma mudança de frontmatter é proposta para `0012-edge-config-chaves-nomeadas.md`: o seletor de turno deste ADR usa exatamente o mecanismo que o ADR-0012 já define (chaves nomeadas + alias resolvido por calendário) e o padrão de chamador explícito que o ADR-0028 já formaliza — não há texto a alterar.

## Consequências

**Positivas**:
- Reduz a rolagem total da home mobile de ~6.770px para próximo dos ~3.129px medidos no protótipo (mesma densidade de conteúdo, ordem diferente) — menos scroll até o leitor ver o mapa, que é o elemento de maior valor informativo imediato da apuração.
- Resolve o bug real de hoje (Deputado Federal quebrando em duas linhas na navegação de cargo em 430px) sem esperar pela spec 017 — a navegação muda de padrão antes de o cargo existir.
- O achado do botão "Mostrar todos" evita que a adoção do kit introduza silenciosamente uma regressão de acessibilidade que o próprio ADR-0017 já havia descartado — é o tipo de erro que só aparece ao comparar decisão documentada contra código de referência, exatamente o que este ADR faz.
- O seletor de turno reaproveita 100% do mecanismo já existente (`readArchivedProjection`, ADR-0012, ADR-0028) — zero código novo de leitura de dado, só UI que já tem para onde apontar.
- Camadas 2/3 com parcial+projeção lado a lado dão ao leitor, pela primeira vez nessas camadas, o mesmo nível de transparência que a Camada 1 já tinha — atende com mais força a constituição § 8.

**Negativas**:
- **Assimetria de risco entre mobile e desktop não é eliminada, é redesenhada**: antes a divergência estava em qual componente aparecia (`HeadlineScore` vs. termômetros); agora a divergência está em qual navegação de cargo é a fonte de verdade visual (`TabBar` embaixo vs. `SegmentedControl` em cima) — dois componentes com o mesmo estado (`cargo` selecionado) precisam ficar sincronizados via a mesma prop/rota em ambos os breakpoints; um bug de sincronização entre os dois é uma classe de erro nova que não existia quando só havia `<Tabs>` no topo.
- **`<h1>` dentro de um `Panel` reutilizável** (item 5) é uma restrição de implementação que o `Panel` de hoje não tem — ele precisa aceitar `titleAs="h1"` (ou equivalente) só para o primeiro painel de cada página, sob risco de duplicar heading nível 1 se aplicado por engano em mais de um `Panel` da mesma página; gate de acessibilidade (`a11y-perf-auditor`) precisa checar exatamente um `<h1>` por página depois desta mudança.
- **Rótulos de mapa (item 8) ficam como intenção autorizada, não implementação decidida** — isso significa que a fidelidade visual ao protótipo fica incompleta até o `map-builder` resolver o pipeline de glyphs; se o simulado 1 (15–17/09) rodar antes disso, a home vai para o ar sem esse detalhe do protótipo, o que é aceitável (constituição não exige rótulos) mas é uma lacuna de fidelidade explícita, não implícita.
- **Correções factuais (Senado 1→2 vagas, wordmark, rodapé) são triviais individualmente, mas nenhuma delas está em teste hoje** — nada no repositório falha se alguém copiar `brand="Atlas Menna"` ou `' · 1 vaga'` do kit sem ler este ADR; a mitigação é o `constitution-guard`/`rf-coverage-checker` incluir essas strings na varredura antes de qualquer uma das quatro páginas (ou a spec 016) ser promovida a `shipped`.
- Mover o mapa para o topo da página **antes** do painel de resultado muda a ordem de LCP-candidate: hoje o maior elemento de conteúdo visível no first paint provavelmente é o hero de texto/termômetros (leve); com o mapa primeiro, o candidato a LCP passa a ser, potencialmente, o skeleton do mapa ou o próprio mapa — o mapa já é lazy (`next/dynamic({ ssr: false })`, ADR-0010), então o LCP real deve continuar sendo capturado pelo conteúdo acima da dobra que carrega no first paint (skeleton, `TopBar`, painel de resultado logo abaixo), mas isso precisa ser **remedido** pelo `a11y-perf-auditor` após a implementação — a garantia teórica de ADR-0010 não foi verificada com o mapa na posição 1 do fluxo.

## Cross-refs

- ADR-0017 (3 camadas fixas — formato de linha das Camadas 2/3 emendado; regra "sempre no DOM" reafirmada e usada para rejeitar o toggle do kit): [0017-transparencia-total-3-camadas.md](0017-transparencia-total-3-camadas.md)
- ADR-0018 (seis termômetros — conteúdo mantido, posição emendada): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- ADR-0019 (identidade por trilha — `<TrilhaKicker />` continua acima do `<h1>`, agora dentro do painel de resultado): [0019-identidade-visual-por-trilha.md](0019-identidade-visual-por-trilha.md)
- ADR-0012 (chaves nomeadas + alias por calendário — mecanismo reaproveitado pelo seletor de turno, sem alteração): [0012-edge-config-chaves-nomeadas.md](0012-edge-config-chaves-nomeadas.md)
- ADR-0028 (corrida explícita por rota — o seletor de turno é mais um chamador explícito, no mesmo espírito): [0028-corrida-explicita-por-rota.md](0028-corrida-explicita-por-rota.md)
- ADR-0025 (restyle-in-place — `TopBar`/`TabBar` como shell aditivo em `app/layout.tsx`, tokens `@theme static`): [0025-design-system-atlas-menna-restyle-in-place.md](0025-design-system-atlas-menna-restyle-in-place.md)
- ADR-0010 (mapa via `next/dynamic({ ssr: false })` — precisa de re-medição de LCP com o mapa na posição 1 do fluxo): [0010-mapa-dynamic-import.md](0010-mapa-dynamic-import.md)
- ADR-0003/ADR-0004 (PMTiles + MapLibre — rótulos de estado dependem de glyphs PBF hospedados, fora do escopo deste ADR): [0003-pmtiles-nao-geojson.md](0003-pmtiles-nao-geojson.md), [0004-maplibre-nao-mapbox.md](0004-maplibre-nao-mapbox.md)
- Constituição § 1 (rótulo "não oficial", rodapé regulatório — inegociável na recomposição), § 4 (acessibilidade — `<h1>` único por página, sem collapsible), § 8 (transparência — "o que está movendo o forecast"): [../../constitution.md](../../constitution.md)
- Handoff: `docs/_meta/handoff-2026-09-07-redesign.md` (D5, invariantes da migração)
- Kit de origem: `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx`, `components/layout/{TopBar,TabBar}.jsx`, `components/data/CandidateRow.jsx`
- Specs afetadas (frontmatter `adrs:`): `docs/specs/003-home-nacional/spec.md`, `docs/specs/004-pagina-uf-presidencial/spec.md`, `docs/specs/005-pagina-uf-governador/spec.md`, `docs/specs/006-grid-governadores/spec.md`, `docs/specs/016-senador/` (a criar — correção do rótulo de vagas), `docs/specs/017-deputado-federal/` (a criar)
- Pendente de propagação (spec-syncer, após aceite): `docs/_meta/index.json`, `docs/design-system/components.md` (`Panel.titleAs`, `TopBar`, `TabBar` responsivos por cargo), `docs/mapas/*` (glyphs PBF como item de pipeline pendente)
