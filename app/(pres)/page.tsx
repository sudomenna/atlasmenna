/**
 * app/(pres)/page.tsx
 *
 * Home Nacional Presidencial (T-01). Spec 003 + S05/F4 (ADR-0013, ADR-0014,
 * ADR-0017 — multi-candidato) + S07/Fase 2 (ADR-0018 hero de seis
 * termômetros em 1T, ADR-0019 identidade de trilha).
 *
 * Server Component — lê Global Config (`projection-current`) server-side via
 * `readNationalProjection()` (ADR-0001) e passa o payload como `fallbackData`
 * para o SWR client que mantém polling vivo (RF-027).
 *
 * Em `pnpm dev` sem `EDGE_CONFIG`, o reader retorna null e o /api/projection
 * cai num fixture local — aqui também, para manter a rota inspecionável. Fora
 * do `pnpm dev` a fixture NUNCA é lida: sem payload a página renderiza
 * `<AguardandoNacional />`. Ver o docstring de `fixturePayload()` para o
 * defeito de 13/09/2026 que essa guarda corrige.
 *
 * Mode dispatch (S05/F4)
 *   - `mode = "binary"` quando `payload.turno === 2` ou `candidatos.length === 2`.
 *   - `mode = "multi-1t"` quando `payload.turno === 1` com >2 candidatos.
 *
 * ===== S07/Bloco 1 — gramática editorial (ADR-0025) =====
 * A página deixou de ser uma pilha de cards e passou a ser uma sequência de
 * seções separadas por filete. Cada seção é um `<Panel>`: filete duplo no
 * topo, kicker em caixa alta, título em serifa. Nenhum bloco saiu da página
 * no Bloco 1 — todos os blocos RF-bound viraram conteúdo de `Panel` (decisão
 * D3 do usuário: shell novo, blocos atuais restilizados). Os cortes vieram
 * depois, em 2026-09-08; ver a seção do protótipo mais abaixo.
 *
 * Regra de composição usada aqui: quando o bloco já emite o próprio `<h2>`
 * (`ProjectionThermometers`, `StateGroupedTable`), o
 * `Panel` recebe **só o kicker** — dois títulos para a mesma seção seriam
 * ruído visual e outline duplicado no leitor de tela. Quando o bloco não tem
 * heading próprio, o `Panel` fornece `title` + `titleId`.
 *
 * ===== S07/Bloco 2 — mapa primeiro (ADR-0029) =====
 * O usuário comparou esta página com o protótipo do kit em 430px e mediu oito
 * diferenças estruturais; o ADR-0029 resolveu sete delas. Para esta página, a
 * mudança é de ORDEM, não de conteúdo: **nenhum bloco RF-bound saiu**.
 *
 *   1. O mapa passou de meio da página para PRIMEIRO conteúdo, com altura de
 *      viewport (`variant="hero"`). O leitor vê o elemento de maior valor
 *      informativo imediato antes de qualquer texto.
 *   2. `BreakingNewsTicker` virou faixa fina entre o shell e o mapa;
 *      `NationalWinnerBanner` (condicional) desceu para logo abaixo do mapa.
 *   3. O `<RaceHeader>` com `<h1>` grande saiu da primeira dobra. O `<h1>`
 *      continua existindo e continua único — virou o TÍTULO DO PAINEL de
 *      resultado, na escala de qualquer outra seção (ADR-0029 § 5), com o
 *      `<TrilhaKicker>` (ADR-0019) logo acima e os badges de estado ao lado.
 *   4. Os seis termômetros do ADR-0018 PERMANECEM, com o mesmo conteúdo, os
 *      mesmos três denominadores e o mesmo IC — só mudaram de posição, para
 *      logo abaixo do mapa (ADR-0029 § 6). O duelo top-2 do protótipo foi
 *      rejeitado pelas mesmas quatro razões do ADR-0018.
 *   5. `<MinorCandidatesList>` passou ao formato parcial+projeção lado a lado
 *      (ADR-0029 § 7), **sem** o botão "Mostrar todos" do kit — que violaria
 *      o ADR-0017.
 *
 * Layout em modo `multi-1t` (ADR-0018 + ADR-0029 + o ResultPanel de 09/09)
 *   [shell: TopBar + controles + CargoTabs vêm do layout]  RF-029, ADR-0025 § 2
 *   <style> --live-pct-label (alimenta o selo do TopBar)    ADR-0029 § 4
 *   BreakingNewsTicker (faixa fina)                  S06/F4d
 *   [o mapa saiu para app/(pres)/layout.tsx]         RF-030.1-4, ADR-0033 § 1
 *   NationalWinnerBanner                             S06/F4d
 *   TrilhaKicker                                     ADR-0019
 *   ResultPanel "Projeção Atlas Menna · não oficial" constituição § 1
 *   ├── <h1> "Resultado parcial" / "Projeção Atlas Menna"  ADR-0029 § 5
 *   ├── badges (TurnoBadge · RaceTypeIndicator)      RF-028
 *   ├── Figure "Apurado" + Figure "Margem <líder>"   RF-026, RF-023
 *   ├── VoteBar com marcador em 50%                  RF-022, RF-023
 *   ├── lista COMPLETA de candidatos, 6 visíveis     RF-022, RF-023, RF-030.8
 *   │   e o resto clipado por CSS (D21 — nada sai do DOM, ADR-0017)
 *   ChancesPanel (P(2T) global — RF-030.7)           App.jsx:350
 *   StrongholdsPanel                                 RF-024, RF-030.6
 *   RemainingPanel                                   RF-024, RF-026
 *   BulletinPanel                                    RF-026, RF-044
 *   Panel "Placar por estado" → StateGroupedTable    RF-030.6
 *   Panel "Metodologia" → ForecastTransparency       RF-043
 *   Panel "Leitura do modelo" → InsightCard          RF-044
 *   Footer                                           constituição § 1
 *
 * ===== 2026-09-08 — a home passa a seguir o protótipo do kit =====
 * Decisão do usuário: a ordem dos painéis é a de
 * `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:349-355` —
 * Result → Chances → Strongholds → Remaining → Bulletin. O que não está no
 * protótipo saiu, com três exceções declaradas:
 *
 *   - "Placar por estado" (`StateGroupedTable`) FICA, por decisão explícita
 *     do usuário, reposicionado ao fim da sequência.
 *   - "Composição de Outros" (`MinorCandidatesList`) FICA: cortá-la apagaria
 *     os candidatos de rank >= 4 do DOM, o que o ADR-0017 proíbe. (Em
 *     09/09 o bloco deixou de existir como seção: os mesmos candidatos
 *     continuam no DOM, agora como linhas da lista do `<ResultPanel>` — ver
 *     mais abaixo.)
 *   - `ForecastTransparency` e `Footer` FICAM em toda página com projeção —
 *     constituição § 8 e § 1, respectivamente.
 *
 * Saíram: `TwoRoundIndicator` (duplicava P(2T) do ChancesPanel), `Panel "Cenários"` → `<RunoffScenarios />` (RF-030.9)
 * e `Panel "Unidades federativas"` → `<DecisiveUFsGrid />` (RF-024). Os dois
 * componentes continuam no repositório, sem call site nesta rota. Entrou:
 * `<ChancesPanel />`, que era exclusivo das rotas de UF e no protótipo é
 * NACIONAL.
 *
 * A ordem acima vale para os DOIS breakpoints: o ADR-0029 rejeitou
 * explicitamente o grid de duas colunas que o protótipo usa no desktop. O que
 * muda por breakpoint é só a posição da navegação de cargo (shell) e a altura
 * máxima do mapa.
 *
 * ===== 2026-09-09 — o hero de `multi-1t` vira o `<ResultPanel>` do kit =====
 * Ordem explícita do usuário: o hero da home passa a ser o `ResultPanel` do
 * protótipo (`App.jsx:20-43`), campo a campo. Saem daqui, **só nesta rota e
 * só em `multi-1t`**, três blocos que o protótipo resolve dentro do mesmo
 * painel:
 *
 *   - `<ApuracaoMeta>`   → vira a `<Figure>` "Apurado", com a nota "X de Y
 *                          votos válidos". Continua em `binary`.
 *   - `<ProjectionThermometers>` (ADR-0018) → sai. Continua nas três outras
 *                          rotas (`/governador`, `/uf/[sigla]`,
 *                          `/uf/[sigla]/governador`), intocado.
 *   - "Composição de Outros" (`<MinorCandidatesList>`) → sai como bloco
 *                          separado: os candidatos de rank >= 4 passam a ser
 *                          linhas da MESMA lista, que é como o kit faz.
 *
 * Consequência declarada e aceita pelo usuário: **brancos/nulos e abstenção
 * saem da tela da home** — o dado segue em `EdgeParticipacao`, e os
 * termômetros seguem existindo nas outras rotas. Isto emenda de fato o
 * ADR-0018 nesta rota; a formalização é trabalho de `adr-author`.
 *
 * Decisão D21 do usuário sobre o botão "Todos os N candidatos": ele FICA,
 * mas como colapso **puramente visual**. Os ADRs 0017, 0029 § 7 e 0033 § 2
 * rejeitam o botão do kit porque lá ele REMOVE nós (`rows.slice(0, limit)`);
 * aqui nenhum candidato sai do DOM, da árvore de acessibilidade ou da busca
 * da página em nenhum estado — ver `components/blocks/ResultPanel.module.css`.
 * Também isto precisa de emenda formal nos três ADRs (`adr-author`).
 *
 * O que ADR-0018 dizia sobre `multi-1t` — substituir `HeadlineScore` +
 * `CandidateRanking` + `NationalNeedle variant="national-1t"` pelos
 * termômetros — continua valendo para as outras rotas. A agulha `national-1t`
 * segue fora desta página, e por isso `<NationalNeedle>` só aparece em
 * `binary`.
 *
 * Layout em modo `binary` (2T ou 1T com 2 cands): comportamento S04/S06
 * preservado **integralmente** — HeadlineScore como camada 1, recap do 1T
 * (ADR-0016), agulha em variant=national-2t, sem termômetros. O que mudou é
 * só o invólucro editorial (Panel), não a composição.
 *
 * `<Footer>` e `<main data-trilha="pres">` ficam **nesta página**, com o
 * footer dentro do `<main>` — `tests/integration/home-page.test.tsx` fixa
 * isso, e o shell global (`app/layout.tsx`) não os fornece.
 *
 * Cobertura: RF-021..030.9, RF-043, RF-044, RNF-002, RNF-007, RNF-022..028.
 */

import type { Metadata } from "next";

import { RaceTypeIndicator } from "@/components/atoms/badges/RaceTypeIndicator";
import { TurnoBadge } from "@/components/atoms/badges/TurnoBadge";
import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { FasePreEleicaoBanner } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { SerieApuracaoChart } from "@/components/atoms/charts/SerieApuracaoChart";
import { TrilhaKicker } from "@/components/atoms/nav/TrilhaKicker";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateColor as candidateColorDoPartido } from "@/components/blocks/_candidateColor";
import { ApuracaoMeta } from "@/components/blocks/ApuracaoMeta";
import { BreakingNewsTicker } from "@/components/blocks/BreakingNewsTicker";
import { BulletinPanel } from "@/components/blocks/BulletinPanel";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { ChancesPanel } from "@/components/blocks/ChancesPanel";
import { CorridaTresCirculos } from "@/components/blocks/CorridaTresCirculos";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { HeadlineScore } from "@/components/blocks/HeadlineScore";
import { InsightCard } from "@/components/blocks/InsightCard";
import { NaImprensaPanel } from "@/components/blocks/NaImprensaPanel";
import { NationalNeedle } from "@/components/blocks/NationalNeedle";
import { NationalWinnerBanner } from "@/components/blocks/NationalWinnerBanner";
import { RegiaoConsolidada } from "@/components/blocks/RegiaoConsolidada";
import { RemainingPanel } from "@/components/blocks/RemainingPanel";
import { ResultPanel } from "@/components/blocks/ResultPanel";
import { StateGroupedTable } from "@/components/blocks/StateGroupedTable";
import { StrongholdsPanel } from "@/components/blocks/StrongholdsPanel";
import { TurnoOneRecap } from "@/components/blocks/TurnoOneRecap";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import { Footer } from "@/components/layout/Footer";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { currentPresidentialTurno, primeiroTurnoEncerrado } from "@/lib/config/calendar";
import { isExterior, unidadesDeApuracao } from "@/lib/config/cargos";
import { avaliarFrescorDado } from "@/lib/config/dado-freshness";
import { isPreEleicao } from "@/lib/config/fase";
import { agruparPorRegiao } from "@/lib/config/regioes";
import { resultadoEleitoral, simulacaoLigada, simulacaoNacional } from "@/lib/dev/simulacao";
import { readArchivedProjection, readNationalProjection } from "@/lib/edge-config/reader";
import type { EdgePayload } from "@/lib/edge-config/types";
import { insightsPresidenteDoPayload } from "@/lib/insights/presidente";
import { LEITURA_VAZIA, lerLeituraParaTela } from "@/lib/leitura/ler";
import { itensFaixaAgora } from "@/lib/utils/anuncios-definidos";
import { queCompetem } from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { rankByParcial } from "@/lib/utils/rank-parcial";
import { resolverModoNacional } from "@/lib/zerado/majoritario";
import nationalFixture from "@/tests/fixtures/edge-config/projection-current.json" with {
  type: "json",
};
import nationalFixturePre from "@/tests/fixtures/edge-config/projection-current-pre.json" with {
  type: "json",
};
import nationalFixtureT2 from "@/tests/fixtures/edge-config/projection-current-t2.json" with {
  type: "json",
};

/**
 * RNF-028 — Meta/OG tags. Imagens dinâmicas OG (RF-051) ficam para spec 009;
 * aqui injetamos apenas os campos textuais para sharing previews em redes
 * sociais. `siteName` e `locale` aplicam o padrão pt_BR.
 */
/**
 * 60 segundos — a mesma cadência das três páginas de cargo irmãs
 * (`(gov)/governador`, `(sen)/senador`, `(dep)/deputado-federal`, todas com
 * `export const revalidate = 60`) e do ciclo de apuração do ADR-0011.
 *
 * ⚠️ **Esta declaração faltava, e a home era a única sem ela.** Consequência
 * medida em 13/09 no `pnpm build`: a coluna `Revalidate` de `┌ ○ /` vinha
 * VAZIA — a página era estática congelada no build, enquanto as irmãs
 * mostravam `1m`. O painel da esquerda (`<ResultPanel>`, `<HeadlineScore>`) é
 * Server Component sem polling: quem o atualiza é a regeneração da rota.
 * Congelada, ele serviria na noite de 04/10 o dado do último deploy.
 *
 * O mapa não sofria do mesmo mal porque `<PersistentMapFrame>` é Client
 * Component e busca `/api/projection` a cada 5 s — foi isso que mascarou o
 * defeito: a metade direita da tela se movia e a esquerda não.
 *
 * O achado veio de rebote: ao compor a grade de candidaturas, o `fetch` de
 * `readCandidatosUf` (12 h) passou a ser o único com cadência declarada na
 * rota, e a home herdou `Revalidate 12h`. Melhor que congelada, e ainda assim
 * 720× pior que as irmãs. Daí a declaração explícita.
 *
 * Não conflita com as 12 h da fatia de candidaturas: a rota regenera a cada
 * 60 s, e o `fetch` do cadastro mantém o cache próprio.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "AtlasMenna — Apuração presidencial 2026",
  description:
    "Apuração presidencial 2026 em tempo real e projeção estatística do resultado final. Não oficial. Fonte: TSE.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "AtlasMenna — Apuração presidencial 2026",
    description:
      "Apuração presidencial 2026 em tempo real e projeção estatística do resultado final.",
    type: "website",
    locale: "pt_BR",
    siteName: "AtlasMenna",
  },
  twitter: {
    card: "summary_large_image",
    title: "AtlasMenna — Apuração presidencial 2026",
    description:
      "Apuração presidencial 2026 em tempo real e projeção estatística do resultado final.",
  },
};

/**
 * Fixture de DESENVOLVIMENTO — números inventados, e só eles.
 * `FIXTURE_VARIANT=t2` troca para o payload de 2º turno.
 *
 * ## Por que o chamador precisa de uma guarda (2026-09-13)
 *
 * O docstring anterior afirmava que em produção "o reader responde antes e a
 * fixture nunca é lida". **Era falso**, e foi essa premissa que escondeu o
 * defeito: `getInitialPayload()` caía aqui de forma INCONDICIONAL, e enquanto
 * o Global Config de produção estivesse vazio — que é o estado normal até o
 * primeiro boletim de 04/10/2026 — `atlasmenna.online` publicava os números
 * desta fixture como se fossem apuração ("Candidato PT — 15.240.321 votos —
 * 43,5%", "23,4% APURADO"). Um site público de eleição inventando resultado é
 * a pior falha que este projeto pode ter (constituição §§ 1 e 8).
 *
 * O reader devolver `null` é o caminho ESPERADO, não a exceção: pré-eleição,
 * chave ainda não gravada, credencial ausente. Uma rede de segurança que, na
 * falta de dado, fabrica dado com cara de verdadeiro é pior que não ter rede.
 *
 * Por isso a fixture agora só entra sob `NODE_ENV === "development"` — o mesmo
 * portão que `/governador`, `/senador` e `/deputado-federal` já usavam. Fora do
 * `pnpm dev` o caminho honesto (`<AguardandoNacional />`) é o que renderiza,
 * inclusive em teste, onde ele passa a ser exercitado.
 *
 * Por que uma env var e não um parâmetro: a página é um Server Component sem
 * props, e o smoke SSR precisa exercitar o modo `binary` (que só existe com
 * `turno === 2`). Injetar por env mantém a página com a mesma forma em
 * produção, em vez de reestruturá-la só para testar. Em produção a env não é
 * definida — e, desde a guarda acima, nem seria lida se fosse.
 */
function fixturePayload(): EdgePayload {
  const variant = process.env.FIXTURE_VARIANT;
  // `pre` serve o payload que `data-pipeline/projection-seed.ts` grava: as 12
  // candidaturas presidenciais reais do cadastro do TSE, o campo `fase` com o
  // valor de `FASE_PRE_ELEICAO` (`lib/config/fase.ts`, o dono do literal),
  // `pct_apurado_total: 0` e `por_uf: []`. É a única forma de VER as telas
  // T-15/T-16 em `pnpm dev` sem semear o Global Config de verdade, o que
  // publicaria a tela no site público — decisão de produto que ainda não foi
  // tomada (spec 019, open question 5).
  //
  // ⚠️ Corrigido em 2026-09-26: este comentário dizia que "`EDGE_CONFIG` não
  // existe em `.env.local`". **Existe** — é a string de LEITURA do Global
  // Config de produção, e o Next carrega o `.env.local` sozinho. Então, em
  // `pnpm dev`, o reader lê PRODUÇÃO primeiro, e esta fixture só aparece
  // quando a chave de produção está vazia. Para ver a fixture com certeza,
  // rode com `EDGE_CONFIG= FIXTURE_VARIANT=pre pnpm dev`.
  //
  //     FIXTURE_VARIANT=pre pnpm dev
  const fixture =
    variant === "t2" ? nationalFixtureT2 : variant === "pre" ? nationalFixturePre : nationalFixture;
  return fixture as unknown as EdgePayload;
}

/**
 * Publica o rótulo do selo de apuração do `<TopBar>` (ADR-0029 § 4).
 *
 * O shell não pode ler dado — `app/layout.tsx` é irmão anterior de
 * `{children}` e qualquer leitura ali tiraria a home e as 54 páginas de UF do
 * pré-render estático (ADR-0025 § 2 e § 5). A ponte é uma custom property em
 * `:root`, que herda para o documento inteiro, inclusive para trás, para a
 * barra do topo. Ver `components/layout/ShellLiveBadge.tsx`.
 *
 * O valor de uma custom property usada em `content` precisa ser uma string
 * CSS **com aspas**; elas fazem parte do valor. Aspas e contrabarras são
 * removidas do texto antes de entrar — `formatPercent` só produz dígitos,
 * vírgula e `%`, mas isto aqui vira CSS, e sanitizar na fronteira é mais
 * barato que confiar no formatador para sempre.
 */
function LivePctLabelStyle({
  pctApurado,
  zerado = false,
}: {
  pctApurado: number;
  /** ADR-0076 — placar zerado: o selo mostra "0,0% apurado" de propósito. */
  zerado?: boolean;
}) {
  // Nada medido ainda ⇒ o selo não vai à tela. Todas as custom properties do
  // `<ShellLiveBadge>` têm o silêncio como default, então publicar nada é
  // publicar "não afirmo coisa alguma" — que é o oposto do `"ao vivo"` que
  // este mesmo ramo emitia até 13/09, por cima do parágrafo que dizia ao
  // leitor que o primeiro boletim não tinha chegado.
  //
  // ⚠️ Este `> 0` decide **o rótulo**, nunca a fase. Ele erra sempre para o
  // lado do silêncio: às 20h01 de 04/10 o percentual real é 0,01 e o selo
  // acende normalmente; num payload real de percentual exatamente 0 o selo
  // some, que é calar, não mentir. A fase da página vem do campo `fase` do
  // payload e de nenhum percentual (ADR-0043 D5).
  if (!zerado && !(pctApurado > 0)) return null;

  const seguro = `${formatPercent(pctApurado, 1)} apurado`.replace(/["\\]/g, "");
  return (
    <style>
      {`:root{--live-badge-display:inline-flex;--live-pct-label:"${seguro}";--live-dot-state:running;--live-sr-ao-vivo:inline}`}
    </style>
  );
}

/**
 * Título do painel de resultado — e, em `multi-1t`, o `<h1>` da página
 * (ADR-0029 § 5).
 *
 * Os dois títulos ficam no HTML; `data-view-only` (cascata em
 * `app/globals.css`) revela o da base ativa e esconde o outro com
 * `display: none`, que também o tira da árvore de acessibilidade — o leitor
 * de tela ouve um título, não dois. Alternar em JavaScript exigiria tornar o
 * `<h1>` client, o que custaria bundle acima da dobra por um texto.
 */
function ResultTitle({ encerrado = false }: { encerrado?: boolean }) {
  return (
    <>
      <span data-view-only="parcial">{encerrado ? "Resultado final" : "Resultado parcial"}</span>
      <span data-view-only="proj">Projeção Atlas Menna</span>
    </>
  );
}

/**
 * Estado da home quando não há projeção publicada — pré-eleição, chave ainda
 * não gravada, Global Config vazio.
 *
 * A página **não some** (constituição § 3) e **não inventa número**: nenhuma
 * contagem, nenhum percentual, nenhum relógio. O que existe aqui é a promessa
 * do que vai aparecer e de onde ele vem.
 *
 * Mesma forma do `<AguardandoNacional />` de `/deputado-federal` e do ramo
 * `if (!payload)` do irmão desta trilha, `app/(pres)/uf/[sigla]/page.tsx`: um
 * `<main data-trilha="pres">` com o `<Footer>` DENTRO dele (o shell global não
 * os fornece), e o bloco de metodologia, que a constituição § 8 exige em toda
 * página de apuração — inclusive quando ainda não há o que apurar.
 *
 * Não é uma violação do ADR-0017: aquele ADR proíbe que um BLOCO suma quando a
 * FONTE DELE falha dentro de uma página que tem payload — é o caso do
 * `<DetailUnavailable>` na rota de UF. Aqui não há payload nenhum, e não existe
 * bloco a preservar; preservar a página inteira preenchida de zeros seria
 * publicar medição onde não houve medição.
 *
 * ⚠️ **Emenda de 2026-09-14.** Este docstring dizia que
 * `<ForecastTransparency pctApurado={0}>` era "o único número da tela, e o
 * verdadeiro: zero por cento apurado". Era falso das duas formas. O bloco não
 * imprimia um número, imprimia **quatro** — "Modelo", 100%, "Apuração", 0% —
 * e nenhum deles foi medido: sem payload não sabemos se a apuração está em 0%
 * ou se o Global Config caiu com a apuração em curso. O bloco continua na tela
 * (constituição § 8) e agora vai a prosa, no ramo `variante="sem_dados"`.
 *
 * A tela inteira, hoje, não imprime número algum — a faixa e o bloco falam do
 * que **nós** sabemos, e a única data que aparece é a da votação.
 */
async function AguardandoNacional() {
  // RF-149 — a grade de "quem está concorrendo", ABAIXO do parágrafo honesto.
  //
  // Resolvida aqui, e não montada como `<CandidaturasAguardando />` na árvore,
  // por uma razão de renderizador: `renderToStaticMarkup` (o que os testes de
  // integração usam) não renderiza componentes assíncronos. Resolver o nó antes
  // de devolver a árvore funciona nos dois mundos — RSC e teste — e mantém o
  // teste de ORDEM possível sem um harness de streaming.
  const grade = await CandidaturasAguardando({ cargo: 1, uf: "BR" });

  return (
    <main
      data-trilha="pres"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* 🔴 RF-160, emenda de 2026-09-14 — PRIMEIRO FILHO do `<main>`, antes do
          kicker e do `<h1>`. Teste de ORDEM, não de presença: uma faixa
          enterrada no meio da página é a versão inútil dela (lição do RF-149).

          Esta era a última das quatro telas de cargo sem aviso nenhum no ramo
          de espera — `/governador`, `/senador` e `/deputado-federal` já
          avisavam. A faixa é incondicional aqui, porque o ramo inteiro já
          significa "não há apuração": nada a sincronizar com uma segunda
          condição que possa sair de sintonia.

          `variante="sem_dados"` e não `"nao_comecou"`: chegar aqui significa
          "o reader não devolveu payload" OU "a lista de candidaturas veio
          vazia", e nenhum dos dois mede o calendário eleitoral. A faixa fala
          sobre nós e põe a data ao lado sem ligar uma coisa à outra.

          ⚠️ **Emenda de 2026-09-14, segunda rodada.** Este ramo passou a
          montar `<SeloFasePreStyle variante="sem_dados">`, logo abaixo. A
          versão anterior deste comentário dizia que ele não montava nada, e a
          razão estava certa — aquele componente publicava, num pacote só, o
          rótulo "antes da votação" e o `sr-only` "A eleição ainda não começou",
          que é a afirmação de causa que este ramo não pode fazer. O que estava
          errado era o remédio: não montar nada deixava também de apagar o
          segmentado "Parcial / Projeção" do shell, e esta era a única das
          quatro telas em que aquele controle aparecia sem dado nenhum por trás.
          A variante separa as duas coisas; ver o bloco seguinte. */}
      <FasePreEleicaoBanner corrida="a Presidência" variante="sem_dados" />

      {/* 🔴 RF-159 + RF-161, emenda de 2026-09-14 — o que esta tela tem a dizer
          ao shell é **uma coisa só**: apague o segmentado "Parcial / Projeção".

          As três propriedades do selo ficam sem publicar, e o selo cai no
          default silencioso (`--live-badge-display: none`) — o mesmo resultado
          visível de antes, quando este ramo não montava componente nenhum.
          O que muda é o segmentado: um controle que alterna a ênfase entre
          duas colunas de percentual que aqui não existem, e cujo rótulo
          carrega a palavra que o RF-161 proíbe.

          `variante="sem_dados"` pela razão de sempre neste ramo: chegar aqui é
          "não recebemos dados", nunca uma medição do calendário eleitoral. */}
      <SeloFasePreStyle variante="sem_dados" />

      <TrilhaKicker trilha="pres" crumbs={["Brasil"]} className="-mb-4" />

      <Panel
        headingLevel={1}
        // 🔴 "Atlas Menna · não oficial", sem "Projeção" — igual às outras três
        // rotas (`(gov):269`, `(sen):146`, `(dep):739`). Esta era a última das
        // quatro em que o kicker rotulava o painel como uma projeção numa tela
        // que não tem projeção nenhuma. Alcançável em produção sempre que o
        // Global Config não responde.
        //
        // O parágrafo abaixo MANTÉM a palavra de propósito: ele diz, no futuro,
        // o que vai aparecer aqui quando houver boletim — que é a mesma licença
        // que o RF-158 dá ao bloco de transparência. O que não se pode é
        // ROTULAR de projeção uma caixa onde não há uma.
        kicker="Atlas Menna · não oficial"
        rule="none"
        title="Presidência 2026"
        titleId="resultado-heading"
      >
        <p
          className="max-w-prose"
          data-testid="pres-aguardando"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          {/*
            ⚠️ Emenda de UMA oração, em 2026-09-13, e só porque o RF-149 a
            tornou falsa. O texto dizia "a lista de candidaturas também vem do
            dado publicado, e por isso ainda não há nomes nem números nesta
            tela" — verdade enquanto a tela era só este parágrafo, mentira no
            instante em que a grade de 12 candidaturas passou a renderizar logo
            abaixo, com nome e número. Deixá-la seria publicar, na mesma tela,
            uma frase desmentida pelo bloco seguinte (constituição § 8).

            O que a emenda NÃO fez: mexer nas outras orações. "Aguardando o
            primeiro boletim", o "não oficial" e a "Fonte: TSE" são as partes
            que os testes travam e que três correções anteriores acertaram.
          */}
          Aguardando o primeiro boletim. O placar, a projeção e o mapa por estado aparecem aqui
          assim que o TSE divulgar a apuração — nenhum voto foi contado ainda, então não há
          percentual nem liderança nesta tela. Não oficial. Fonte: TSE.
        </p>
      </Panel>

      {/* RF-149 — acrescentar, nunca substituir: a grade vem DEPOIS do
          parágrafo acima, e é `null` quando o Blob não responde. */}
      {grade}

      {/* Spec 020 — a evolução da apuração também neste ramo, e é ele que
          PRODUÇÃO serve hoje: sem chave no Global Config a home nunca chega ao
          ramo com payload, e o bloco simplesmente não existiria na tela real.

          🔴 `preEleicao={false}` é DECISÃO, não esquecimento. Este ramo é
          alcançado tanto antes de 04/10 quanto por uma falha de leitura do
          Global Config, e a tela **não distingue os dois** — é a mesma razão
          que pôs `variante="sem_dados"` no bloco de metodologia logo abaixo.
          Afirmar "disponível apenas no dia das eleições" aqui seria dar uma
          causa que ninguém mediu. O componente cai no estado "não sabemos",
          que é o terceiro estado e o honesto para este ramo.

          🔴 E as props seguem VAZIAS depois da Fase 2, também por decisão: os
          dois gatilhos deste ramo são "não há payload" e "o payload veio com
          `candidatos: []`". No primeiro não existe série para ler; no segundo
          o elenco das quatro linhas sai do ranking dessas candidaturas, e uma
          lista vazia não produz elenco nenhum. Passar série aqui exigiria
          carregar o payload para dentro desta função para nunca ter o que
          desenhar. */}
      <Panel kicker="Evolução da apuração">
        <SerieApuracaoChart
          eixo={[]}
          cadenciaMin={5}
          candidatos={[]}
          escopo="Brasil"
          titleId="serie-apuracao-aguardando-titulo"
        />
      </Panel>

      {/* 🔴 RF-158, emenda de 2026-09-14 — o bloco FICA e vai a PROSA.
          Até hoje ele entrava aqui como `<ForecastTransparency pctApurado={0}>`
          e publicava, neste ramo, a decomposição numérica do forecast:
          "Modelo 100%" e "Apuração 0%". Nada disso foi medido — é a mesma
          classe de zero fabricado que saiu de `/governador` e `/senador`.

          Houve uma dúvida legítima sobre se o bloco era obrigatório aqui: a
          constituição § 8 o exige "em toda página com projeção", e uma página
          sem payload não tem projeção. As duas leituras ficam satisfeitas ao
          mesmo tempo — o bloco continua na tela, e o que sai é só o número.

          `variante="sem_dados"` pela mesma razão da faixa lá em cima: este
          ramo é alcançado tanto antes de 04/10 quanto por uma falha de leitura
          do Global Config, e a tela não distingue os dois. Dizer "nenhum voto
          foi contado ainda" seria afirmar uma causa que não medimos. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={0} preEleicao variante="sem_dados" />
      </Panel>

      <Footer />
    </main>
  );
}

/**
 * O RSC fornece o estado inicial dos painéis; o mapa da moldura busca o seu.
 *
 * `null` do reader é o caminho esperado (ver o docstring de `fixturePayload`),
 * e a partir daqui ele NUNCA mais vira dado de fixture fora do `pnpm dev`.
 */
async function getInitialPayload(): Promise<EdgePayload | null> {
  // `FIXTURE_VARIANT=sim` — o estado de simulação, revisado antes do simulado
  // oficial do TSE. Vem ANTES da leitura remota, e é EXCLUSIVO: com o modo
  // ligado, o Global Config nem é consultado, e um arquivo ausente cai no
  // estado honesto em vez de na fixture de sempre — a home nunca conta uma
  // história enquanto o mapa da moldura conta outra.
  //
  // A ordem importa desde 2026-09-15: naquele dia o Blob de produção,
  // respondendo `ok` com lista vazia, ganhou da simulação na rota de
  // municípios. Uma resposta vazia é uma resposta, e por isso a condição não
  // pode ser "o reader não trouxe nada". Ver `resultadoEleitoral` em
  // `lib/dev/simulacao.ts`; os dois portões do modo ficam lá, não aqui.
  return await resultadoEleitoral(
    () => simulacaoNacional("pres"),
    async () =>
      (await readNationalProjection()) ??
      (process.env.NODE_ENV === "development" ? fixturePayload() : null),
  );
}

export default async function HomePage() {
  const lido = await getInitialPayload();

  // 🔴 ADR-0076 — modo zerado. Chave ausente, fase pré ou lista vazia ⇒ o
  // layout da apuração com todas as candidaturas em 0 (cadastro do Blob, ordem
  // sorteada do dia). Leitura que FALHOU nunca entra aqui: segue para o ramo
  // honesto abaixo, sem número. Fora da simulação local, que tem fixture.
  const { payload, zerado } = simulacaoLigada()
    ? { payload: lido, zerado: false }
    : await resolverModoNacional(lido, "pres", currentPresidentialTurno());

  // Dois estados caem na mesma tela honesta, e o segundo não é hipotético:
  //
  //   - `null` — o reader não tem o que devolver (pré-eleição, chave ainda não
  //     gravada, sem credencial fora do `pnpm dev`). É o defeito de 13/09.
  //   - payload publicado com `candidatos: []` — o orchestrator gravou o
  //     envelope antes de a lista de candidaturas estar resolvida. O placar
  //     renderizaria a estrutura do kit com zero linhas dentro: "Apurado 0%",
  //     barra de maioria vazia, "Boletim HH:MM:SS" com a hora do ciclo. Forma
  //     de medição sem medição nenhuma.
  //
  // O gate é a AUSÊNCIA DE LISTA, não um percentual em zero: 0% apurado COM
  // candidaturas publicadas é um estado legítimo da noite eleitoral (a corrida
  // existe, ninguém apurou ainda) e continua caindo no fluxo normal.
  // `await` em vez de `<AguardandoNacional />`: o ramo aguardando lê o Blob de
  // candidaturas (RF-149) e precisa devolver a árvore já resolvida — ver o
  // comentário dentro da função.
  if (!payload || payload.national.candidatos.length === 0) return await AguardandoNacional();

  // 🔴 RF-153 — o ÚNICO gatilho de fase. `isPreEleicao` lê o campo `fase` e
  // nada mais: não `pct_apurado_total === 0`, não `por_uf.length === 0`, não
  // `composition.pre_election`, não data de calendário. Às 20h01 de 04/10 o
  // percentual real é 0,01 — e por alguns minutos antes disso ele passa por 0
  // com o orchestrator já rodando; qualquer um dos quatro gates proibidos
  // poria esta tela em modo pré-eleição COM A APURAÇÃO EM ANDAMENTO
  // (ADR-0043 D5, design 019 § D9 mutação M1).
  const pre = isPreEleicao(payload);
  // "Identidade fala, medição cala": no zerado tudo que MEDE sai, como na
  // fase pré — mas o layout é o da apuração (painel de resultado com 0,0%).
  const cala = pre || zerado;
  // 05/10/2026 — 1º turno encerrado: TSE totalizou, a tela é o resultado final.
  const encerrado = primeiroTurnoEncerrado();

  const { national, por_uf, pct_apurado_total, ufs_apuradas, ts, insights, composition, turno } =
    payload;
  // ADR-0045 — a linha do exterior (`ZZ`), quando o produtor a publica. Fica
  // fora do agrupamento por região (não é região) e entra como cartão avulso.
  const exteriorRow = por_uf.find((r) => isExterior(r.sigla));

  /**
   * ADR-0072 — "leitura da noite": análise por IA, manchetes da imprensa e
   * histórico do Boletim, gravados no Blob pelo cron `/api/internal/leitura-noite`
   * e ligados pelo interruptor `interruptor-leitura-noite` (sem deploy).
   *
   * Só depois de começar a apuração (fase ≠ pré e `pct > 0`): antes disso não
   * há o que ler, e a página não paga a leitura. `lerLeituraParaTela` nunca
   * lança; o `.catch` é a segunda barreira — numa publicação nova não há página
   * em cache para servir, e um erro aqui viraria 500 na home.
   */
  const leitura =
    !pre && pct_apurado_total > 0
      ? await lerLeituraParaTela({ pctApuradoTotal: pct_apurado_total, turno }).catch(
          () => LEITURA_VAZIA,
        )
      : LEITURA_VAZIA;
  // Reserva por regra fixa quando a IA está desligada, falhou ou ficou velha.
  // O orchestrator grava `insights: []` (api/model/project.py) — sem esta
  // reserva a caixa "Análise" nunca aparecia em produção.
  const frasesRegra = insights.length > 0 ? insights : insightsPresidenteDoPayload(payload);
  const faixaAgora = itensFaixaAgora(payload);
  const analiseIA = leitura.ia;

  /**
   * Spec 020 (RF-168 a RF-171) — a série por candidatura do escopo NACIONAL.
   *
   * Vem do payload que esta página já leu; nenhuma leitura nova entra no read
   * path (RNF-002). Diferente das rotas de UF, aqui não há Blob: o ADR-0046 D3
   * pôs o nacional na própria chave de Global Config, e por isso não existe o
   * par de estados "a fonte não respondeu" / "respondeu sem a série" — ou o
   * payload veio com o campo, ou não veio.
   *
   * 🔴 O objeto é repassado **como veio**. Nada de re-ordenar `candidatos` (a
   * ordem é contrato do produtor, ADR-0046 D4 / RF-170c), nada de `?? 0` nos
   * furos de `apurado`/`projetado` (RF-175b) e nada de inferir a cadência de
   * `eixo[1] - eixo[0]` — ela é declarada em `cadencia_min` justamente porque o
   * primeiro intervalo pode conter um ciclo perdido.
   */
  const serieNacional = payload.serie_por_candidato ?? null;

  // RF-149 re-pendurado no ramo de fase pré (design 019 § D5, último bloco).
  //
  // O gatilho da grade de "quem está concorrendo" (T-14, spec 018) era "não há
  // payload". Para Presidente o semeador FAZ o payload existir, então a página
  // sai do ramo de espera e a grade deixaria de ser montada pelo caminho
  // atual — a spec 018 perderia a tela dela sem que nada nela tivesse mudado.
  // O componente é o mesmo e o comportamento observável dele é o mesmo; muda
  // só DE ONDE ele é chamado. É também de onde vêm a FOTO e o número na urna
  // de cada candidatura (RF-155), que o `<ResultPanel>` não exibe.
  //
  // `await` fora da árvore pela mesma razão do ramo `AguardandoNacional`:
  // `renderToStaticMarkup` não renderiza componentes assíncronos, e resolver o
  // nó antes mantém o teste de ordem possível sem harness de streaming.
  const gradeCandidaturas = pre ? await CandidaturasAguardando({ cargo: 1, uf: "BR" }) : null;

  // ADR-0038 D4 — o relógio do DADO, não o da escrita. `payload.dado_ts` entra
  // cru: `undefined` (payload pré-ADR, em voo durante o canary) e `null` (o
  // ciclo não teve `dg`/`hg` parseável) são estados diferentes, e quem os
  // separa é `avaliarFrescorDado`. Cálculo de servidor sobre um número que já
  // veio no JSON — nenhuma chamada nova ao TSE, nenhuma query nova.
  //
  // O cargo sai do PAYLOAD, não de um `1` literal: o limiar é por cargo (D3) e
  // um literal aqui seria a mesma classe de constante cravada no JSX que o
  // design 017 § D8 proíbe.
  const frescorDado = avaliarFrescorDado(payload.dado_ts, payload.cargo);

  // Mode dispatch (S05/F4). `turno === 2` força binary; 1T com 2 cands
  // também cai em binary (defensivo). 1T multi-candidato → multi-1t.
  const mode: "binary" | "multi-1t" =
    turno === 2 || national.candidatos.length === 2 ? "binary" : "multi-1t";

  // 🔴 spec 019 — A FASE É MAIS FORTE QUE O MODO. Em fase pré **não existe**
  // ramo `binary`.
  //
  // `mode` responde "que forma tem esta corrida": duelo de dois, ou 1T
  // multi-candidato. Em fase pré a pergunta não tem resposta — não há duelo
  // porque não há voto —, e o layout `binary` é medição de ponta a ponta:
  // kicker "Projeção Atlas Menna · não oficial" (a palavra que o RF-161
  // proíbe na tela inteira), `<ApuracaoMeta>` com "Apurado 0,0%" e "UFs
  // apuradas 0/27" (dois números fabricados), e o `<HeadlineScore>` com a
  // barra de maioria. Nenhuma dessas superfícies identifica ninguém — e a
  // linha de identidade do RF-155 sequer é montada ali (design 019 § D0:
  // mede ⇒ cala; identifica ⇒ fala).
  //
  // ## O defeito que esta linha fecha, medido em 2026-09-14
  //
  // A supressão inteira da spec 019 morava **só** no ramo `multi-1t`, e os
  // dois gatilhos de `binary` são alcançáveis em fase pré:
  //
  //   1. `national.candidatos.length === 2` — indeferimento por recurso e
  //      substituição continuam DEPOIS do prazo de julgamento (é por isso que
  //      o cadastro é reimportado em 02–03/10). Se as publicáveis à
  //      Presidência chegarem a exatamente duas, a home troca de layout e a
  //      supressão evapora sem uma linha de código mudar;
  //   2. `turno === 2` — a fase pré de 2º turno não está no escopo hoje, mas
  //      o ramo é o mesmo e o gatilho não olha a fase.
  //
  // O modo de falha era silencioso e total: nenhum teste vermelho, nenhum
  // alarme, e a tela de volta a dizer exatamente o que a spec foi escrita para
  // impedir. A causa-raiz é de TESTE, não de código: a matriz tinha uma
  // dimensão faltando — todos os casos da spec 019 usavam 12 candidaturas,
  // logo exercitavam um ramo só. Ver a matriz em
  // `tests/unit/pages/fase-pre-eleicao.test.tsx`, bloco (F).
  //
  // `mode` continua intocado de propósito: ele é um fato sobre a corrida, e
  // sobrescrevê-lo faria `NationalNeedle`, `StateGroupedTable` e
  // `HeadlineScore` lerem uma corrida que não é a que chegou no payload. O
  // que a fase decide é o LAYOUT, e é isso que esta constante nomeia.
  const painelDeIdentidade = pre || zerado || mode === "multi-1t";

  // S06/F4d (Fase 4) — Mode 2T: lê archive do 1T para `<TurnoOneRecap />`
  // (ADR-0016). `readArchivedProjection` retorna null se a chave ainda
  // não foi gravada (pré-virada de turno) — degrade gracioso.
  const recap1T = turno === 2 ? await readArchivedProjection({ cargo: "pres", turno: 1 }) : null;

  // 🔴 2026-10-04 (ADR-0075) — o `vaiA2tNacional` que vivia aqui (derivado de
  // `national.vai_a_2t_nacional` / `p_segundo_turno_overall`, leitura da
  // PROJEÇÃO) só alimentava o gate do `<NationalWinnerBanner />`. A faixa
  // agora só aparece com `EdgeUfRow.eleitos_definidos`; a variável saiu.

  // O mapping `candidato_id → rank` (paleta N-way, ADR-0013) era construído
  // aqui e passado ao mapa. Com o mapa na moldura (ADR-0033 § 1), quem o
  // constrói é o `<PersistentMapFrame />`, a partir do payload que ele mesmo
  // busca. Esta página não tem mais consumidor para ele.

  // Para tabela e indicadores que precisam do nome do líder.
  //
  // 🔴 `rank` é o rank de **PROJEÇÃO**: quem o escreve é o produtor
  // (`api/model/project.py`, `sorted(key=-point, id)`), e é essa a ordem que
  // `EdgeNational.candidatos` já chega. Ou seja, `lider`/`segundo` são "quem o
  // MODELO põe na frente" — que é exatamente o que a tabela por estado
  // (candidato A/B) e a agulha querem, e por isso eles seguem intocados.
  //
  // 🔴 ADR-0053 / RF-213 — `rank` é publicado sobre `vvc` e CONTA a
  // candidatura anulada; o modelo tira a anulada só das decisões
  // (`candidato_a_id`, agulha, `p_*`). Por isso o líder aqui é o de MENOR
  // `rank` entre as que COMPETEM, não "quem tem `rank === 1`" — que seria a
  // anulada, com `p_fecha_1t = 0`, nomeada no painel de chances e na tabela
  // por estado. Sem anulada, dá exatamente o `rank` 1 e o 2 de sempre.
  const porRankQueCompete = queCompetem(national.candidatos)
    .slice()
    .sort((a, b) => (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY));
  const lider = porRankQueCompete[0] ?? national.candidatos[0];
  const segundo = porRankQueCompete[1] ?? national.candidatos[1];

  // ...e quem a CONTAGEM põe na frente, que desde 2026-09-20 é uma pergunta
  // diferente NA TELA: com "tudo acompanha a base ativa", o `<ResultPanel>`
  // logo acima reordena por apurado quando o leitor troca para "Parcial".
  // Enquanto o painel de chances nomeava só `lider`, a home podia listar B em
  // primeiro e, duas seções abaixo, dizer "A vence no 1º turno" — dois blocos
  // vizinhos discordando sobre quem está na disputa, na corrida de maior
  // audiência do produto.
  //
  // `rankByParcial` é o MESMO comparador que o `<ResultPanel>` usa
  // (`lib/utils/rank-parcial.ts`, ponto único das duas ordens): se a lista e
  // este nome divergirem algum dia, será porque o comparador mudou, não porque
  // há dois critérios na mesma página.
  //
  // ADR-0053 — o 1º da contagem QUE COMPETE (a lista põe a anulada no fim;
  // este nome tem de concordar com ela).
  const liderParcial = rankByParcial(queCompetem(national.candidatos))[0] ?? lider;

  // Badges de estado ao lado do título do painel de resultado (RF-028). São
  // os mesmos nos dois modos — por isso saíram do JSX de cada ramo.
  const badgesDeEstado = (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
      <TurnoBadge turno={turno} />
      {/* RF-156 — em fase pré a contagem vem de `candidatos.length`, sem o
          limiar de 0,5% de `pct_projetado`, que num payload zerado zera a
          contagem inteira e produz "Disputa entre 0 candidatos" ao lado de
          doze nomes visíveis. */}
      {zerado ? null : (
        <RaceTypeIndicator candidatos={national.candidatos} preEleicao={pre} turno={turno} />
      )}
    </div>
  );

  // RF-161 — a ordem das candidaturas em fase pré é a do NÚMERO NA URNA,
  // crescente e estável entre recarregamentos.
  //
  // `candidatos[]` chega ordenado por `pct_projetado` desc. Com todo mundo em
  // zero essa ordenação não ordena por nada — pior: ela ordena pelo desempate
  // (`candidato_id` ASC, ver `EdgeCandidate.rank`), e o resultado é uma lista
  // estável que o leitor lê como ranking. Falso favoritismo estável é
  // exatamente o que a constituição § 2 proíbe ("sempre na mesma ordem dentro
  // de uma mesma corrida").
  //
  // `id` É o número na urna no payload nacional (é a chave que o TSE usa e a
  // que o leitor reconhece da própria urna). `slice()` antes do `sort` porque
  // `sort` muta, e este array é o do payload.
  const candidatosDoPainel = pre
    ? national.candidatos.slice().sort((a, b) => a.id - b.id)
    : national.candidatos;

  // O mapa não está mais nesta página (ADR-0033 § 1): quem o monta é
  // `app/(pres)/layout.tsx`, na coluna persistente do `<AppShellSplit>`. Esta
  // página emite só os painéis — a coluna que rola.
  return (
    <main
      data-trilha="pres"
      className="mx-auto flex max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      // `--space-8` (32px) e não `--space-12` (48px): com 12 seções, o
      // espaçamento entre blocos sozinho valia 576px de rolagem em 430px —
      // 8% da página inteira gasta em ar. A separação editorial entre seções
      // é feita pelo filete duplo e pelo kicker do `<Panel>` (ADR-0025), não
      // pela distância; 32px continua sendo a maior medida de espaço da
      // página e é o valor que `/governador` e `/uf/[sigla]` já usam na mesma
      // posição (elas nunca receberam os 48px). Nenhum bloco saiu.
      style={{ gap: "var(--space-8)" }}
    >
      {/* 🔴 RF-160 — PRIMEIRO FILHO do `<main>`, e a posição é o requisito.
          Antes do kicker, antes do `<h1>`, antes de qualquer painel. O teste é
          de ORDEM, não de presença: um teste de presença passaria com a faixa
          enterrada no rodapé, que é a versão inútil dela (mesma lição do
          RF-149 da spec 018). Em fase normal ela não existe no DOM e o
          primeiro filho volta a ser o `<style>` do selo, como sempre foi. */}
      {pre ? <FasePreEleicaoBanner corrida="a Presidência" /> : null}

      {/* Alimenta o selo do `<TopBar>` (ADR-0029 § 4) — "23,4% APURADO" na
          noite da apuração, "ANTES DA VOTAÇÃO" antes dela (RF-159). */}
      {pre ? (
        <SeloFasePreStyle />
      ) : (
        <LivePctLabelStyle pctApurado={pct_apurado_total} zerado={zerado} />
      )}

      {/* ADR-0038 D4 — "o dado do TSE não anda". Primeiro de tudo, e fora de
          `<Panel>`: é uma faixa de estado sobre a página inteira, como o
          `<NationalWinnerBanner>` e o ticker logo abaixo (ADR-0029 § 1). Acima
          do ticker de propósito — quando o dado está parado, saber disso
          precede ler as chamadas, que também estão paradas.

          Ele só ACRESCENTA: nada abaixo desta linha muda de comportamento por
          causa dele, e a página continua exibindo o último payload conhecido
          inteiro (constituição § 7, RNF-010/012). Nos outros três estados de
          `dado_ts` o componente devolve `null`.

          `frescorDado` é a SEMENTE, não a palavra final: esta rota não declara
          `revalidate` nem `dynamic`, então o veredito do servidor vale para um
          instante só. Quem abriu a página às 20h precisa ver o aviso se a
          ingestão morrer às 20h30, sem recarregar — e o banner faz isso lendo o
          `dado_ts` que a moldura do mapa já busca a cada 60 s (escopo nacional,
          o mesmo recorte deste payload). Ver o docstring do componente. */}
      {/* `!pre`: "o dado do TSE não anda há 14 minutos" mede a defasagem de uma
          ingestão que, em fase pré, ainda não deveria estar andando. O
          semeador não grava `dado_ts` e o banner cairia sozinho no estado
          "ausente"; a guarda é o que impede um alarme falso no dia em que ele
          gravar. RNF-010: fase pré **não** é degradação, e as duas não devem
          se falar. */}
      {!cala && <DadoParadoBanner frescor={frescorDado} />}

      {/* S06/F4d — Breaking news ticker. ADR-0029 § 1: faixa fina entre o
          shell e o mapa. É conteúdo ambiente, não hero — por isso continua
          fora de `<Panel>` e acima de tudo. Renderiza só se há chamadas. */}
      {/* `!pre`: uma "chamada" é a declaração de que uma corrida está decidida
          — medição, e da mais forte que o produto emite. O semeador não grava
          nenhuma, mas a guarda é o que protege contra um payload semeado a
          mais no futuro (spec 019 § D7: as duas defesas coexistem de
          propósito). */}
      {/* 🔴 2026-10-04 (dono) — a faixa só anuncia o que está MATEMATICAMENTE
          definido (`lib/utils/anuncios-definidos.ts`): no Presidente, um item
          nacional quando o Brasil inteiro definiu. `national.chamadas_recentes`
          não é mais lido — o texto dele saía da `chamada` da projeção. */}
      {!cala && faixaAgora.length > 0 && <BreakingNewsTicker chamadas={faixaAgora} />}

      {/* O mapa NÃO está mais aqui (ADR-0033 § 1). Ele é a coluna persistente
          do `<AppShellSplit>` — à direita no desktop, faixa de 52vh acima dos
          painéis no mobile — montada por `app/(pres)/layout.tsx`, e sobrevive
          à navegação para `/uf/[sigla]` e de volta. */}

      {/* S06/F4d — faixa nacional do eleito. 🔴 2026-10-04 (ADR-0075): só
          aparece quando o Brasil está MATEMATICAMENTE definido
          (`EdgeUfRow.eleitos_definidos`, via `eleitosNacionais`) — nunca por
          `p_vitoria` nem por % apurado. Fica fora de `<Panel>`: é uma faixa de
          estado, não uma seção editorial — e se auto-anula, o que deixaria um
          filete órfão. ADR-0029 § 1: logo abaixo do mapa, antes do painel de
          resultado. */}
      {/* `!pre`: a faixa é a proclamação de um vencedor. */}
      {!cala && (
        <NationalWinnerBanner candidatos={national.candidatos} porUf={por_uf} turno={turno} />
      )}

      {/* Kicker de trilha (ADR-0019). Fica FORA do `<Panel>` e imediatamente
          acima dele porque a regra do ADR é "TrilhaKicker acima do `<h1>`" —
          e o `<h1>` agora é o título do painel (ADR-0029 § 5). O `<Panel>`
          não tem slot antes do próprio cabeçalho. */}
      {/* `-mb-4` acompanha o `gap` do `<main>`: a margem negativa existe só
          para colar o kicker no painel que ele encabeça, e vale metade do
          espaçamento entre seções. Com o gap em 32px, -16px deixa os mesmos
          16px de respiro que havia quando o gap era 48px e a margem, -32px. */}
      <TrilhaKicker trilha="pres" crumbs={["Brasil"]} className="-mb-4" />

      {/* Seção 2 — a projeção. O kicker carrega o rótulo "não oficial"
          exigido pela constituição § 1 já no topo da primeira seção de dado.
          Em multi-1t o `title` é o `<h1>` da página, na escala de qualquer
          outra seção (ADR-0029 § 5). Em binary o `<h1>` continua vindo do
          `<HeadlineScore />` (ADR-0017 intocado para 2T) e o painel fica sem
          título, como antes — duas `<h1>` seriam regressão de a11y. */}
      {/* `rule="none"` nos dois ramos: o filete desta seção é o do
          `<TrilhaKicker>` logo acima (3px sólido, na cor da trilha —
          ADR-0019). O filete duplo padrão do `<Panel>` desenharia uma segunda
          régua a 16px da primeira, e o cabeçalho da página abriria com duas
          linhas paralelas em vez de uma. */}
      {/* 🔴 `painelDeIdentidade`, e NÃO `mode === "multi-1t"`: em fase pré os
          dois modos convergem para o mesmo painel de identidade. Ver a
          constante lá em cima para o defeito de 14/09 que esta troca fecha —
          com duas candidaturas, ou em `turno === 2`, o ramo de baixo devolvia
          a tela inteira ao vocabulário de medição. */}
      {painelDeIdentidade ? (
        /* O painel de resultado do protótipo (`App.jsx:20-43`), inteiro:
           "Apurado" + "Margem <líder>" como as duas figuras do topo, barra de
           maioria com marcador em 50%, e UMA lista com TODOS os candidatos —
           é assim que o kit trata os candidatos menores, em vez de um bloco
           "Composição de Outros" à parte. O `<h1>` da página é o título deste
           painel (ADR-0029 § 5) e continua único. */
        /* RF-155 + RF-161 — em fase pré o painel troca de papel, e o kicker, o
           `<h1>` e a `note` trocam de texto junto com ele.

           O kicker de sempre ("Projeção Atlas Menna · não oficial") não pode
           ficar por duas razões independentes: ele contém a palavra que o
           RF-161 proíbe em toda a tela, e ele rotula como não-oficial uma
           projeção que não existe — o "não oficial" da constituição § 1 é
           obrigação sobre a superfície ONDE a projeção aparece, e aqui ela não
           aparece (o `<Footer>` continua carregando "Não oficial. Fonte: TSE."
           em toda página, como sempre).

           O `<h1>` deixa de alternar Parcial/Projeção e passa a ser
           "Quem está concorrendo" — nunca "Apuração" nem "Resultado". */
        <ResultPanel
          action={badgesDeEstado}
          candidatos={candidatosDoPainel}
          headingLevel={1}
          kicker={
            pre
              ? "Candidaturas registradas no TSE"
              : encerrado
                ? "Resultado final · 1º turno · não oficial"
                : "Projeção Atlas Menna · não oficial"
          }
          note={
            pre
              ? "Esta é a lista de candidaturas registradas pelo TSE para a Presidência, na ordem do número na urna. Nenhum voto foi contado: a votação é em 4 de outubro de 2026."
              : encerrado
                ? "Contagem final do TSE, com a totalização encerrada. Não oficial."
                : "Projeção por regra de três: votos apurados ÷ % apurado em cada município, somados por UF e país. O % apurado do Brasil é a soma dos estados publicados pelo TSE — a tela “Brasil” do site do TSE às vezes atualiza com atraso em relação aos estados, e por isso pode mostrar um número menor."
          }
          pctApurado={pct_apurado_total}
          rule="none"
          // Versão D (2026-09-27) — "2º turno · …" / "Vence(ria) no 1º turno · …"
          // nos dois cartões. Na fase pré (`identidade`) o painel ignora.
          selo="turno"
          title={pre ? "Quem está concorrendo" : <ResultTitle encerrado={encerrado} />}
          titleId="resultado-heading"
          turno={turno}
          variant={pre ? "identidade" : zerado ? "zerado" : "medicao"}
        />
      ) : (
        <Panel
          action={badgesDeEstado}
          headingLevel={1}
          kicker={
            encerrado
              ? "Resultado final · 1º turno · não oficial"
              : "Projeção Atlas Menna · não oficial"
          }
          rule="none"
        >
          {/* `--space-6` dentro do painel: 24px separa sub-blocos de uma MESMA
              seção; 32px é a medida entre seções (o `gap` do `<main>`). */}
          <div className="flex flex-col" style={{ gap: "var(--space-6)" }}>
            {/* `dado_ts` cru e `cargo` do payload — ADR-0038 D1. A terceira
                figura passa a carregar a hora do TSE em vez da hora em que o
                modelo rodou; `ts` só volta a aparecer nela no estado
                "ausente", durante o canary de um deploy. */}
            <ApuracaoMeta
              cargo={payload.cargo}
              dadoTs={payload.dado_ts}
              pctApurado={pct_apurado_total}
              ts={ts}
              ufsApuradas={ufs_apuradas}
              // ADR-0045 — 27 UFs + o exterior: o denominador vem da tabela.
              totalUfs={unidadesDeApuracao(1)}
            />

            {/* Camada 1 do 2T: `<HeadlineScore />` intocado, com o recap do 1T
                injetado acima (ADR-0016). O ADR-0017 vale aqui sem nenhuma
                alteração, e o `<h1>` desta rota continua vindo dele. */}
            <HeadlineScore
              candidatos={national.candidatos}
              mode={mode}
              turno={turno}
              recap={turno === 2 ? <TurnoOneRecap recap={recap1T} /> : null}
            />
          </div>
        </Panel>
      )}

      {/* Spec 022 (RF-200/201) — "A corrida": a disputa em três círculos
          (válidos → quem votou → eleitorado apto), IMEDIATAMENTE depois do
          painel de resultado e ANTES do "Votação" (ordem invertida pelo dono
          em 2026-09-27: primeiro quem está ganhando, depois como o eleitorado
          se comportou). Uma corrida só ⇒ fatias por
          CANDIDATURA; o nome sai de `national.candidatos`, cruzado por `id`.
          Sem `votacao.corrida` ⇒ `<DetailUnavailable>` (RF-207). */}
      {zerado ? null : (
        <CorridaTresCirculos
          kicker="Presidente · Brasil"
          modo="candidatura"
          votacao={payload.votacao}
          candidatos={payload.national.candidatos}
          titleId="corrida-tres-circulos-heading"
        />
      )}

      {/* Spec 021 (RF-192) — "Votação": o eleitorado inteiro em três círculos,
          em `<Panel>` PRÓPRIO, logo depois de "A corrida" (dono, 2026-09-27 —
          até então vinha antes dela).

          🔴 Painel próprio, e não um apêndice do painel acima: aquele responde
          "quem está ganhando", este responde "como o eleitorado se comportou".
          São perguntas diferentes e o dono pediu a separação visual.

          `payload.votacao` é opcional — sem ele o componente renderiza
          `<DetailUnavailable>` (RF-198), nunca zeros. Os três estados que ele
          distingue (ausente / "não começou" / apurando) estão no RF-193b. */}
      {zerado ? null : <VotacaoEleitorado kicker="Presidente · Brasil" votacao={payload.votacao} />}

      {/* Seção 3 — chances (`ChancesPanel` do protótipo, 2º painel de
          conteúdo em `App.jsx:350`). Aqui, ao contrário das rotas de UF, o
          payload nacional TEM as duas probabilidades prontas do bootstrap:
          `p_segundo_turno_overall` e o `p_fecha_1t` do líder. Nada é
          recalculado na UI (constituição § 6).

          Gate `multi-1t && turno !== 2` — o mesmo do `<TwoRoundIndicator />`
          logo acima: em 2T `p_fecha_1t` é sempre 0.0 por construção ("vazio
          de semântica", `lib/edge-config/types.ts`) e o painel exibiria 0%
          como se fosse leitura do modelo. */}
      {/* 🔴 RF-154 — `!pre` no CHAMADOR, nunca um `return null` dentro do
          painel. Um `if (fase) return null` em `ChancesPanel` poria a regra de
          fase em quatro arquivos e desfaria o ponto único do RF-153 — foi
          exatamente assim que a guarda de zero do mapa nacional acabou dentro
          do ramo `viewMode === "parcial"`, cobrindo uma das seis combinações.

          Este painel mede probabilidade, e a guarda que ele já tem não alcança
          este caso: `has(p)` funciona para `null`, mas `p_fecha_1t` é
          declarado `number` não-anulável, então o que chega do payload zerado
          é `0`, e `has(0)` é `true`. O painel renderizaria "Fulano vence no 1º
          turno — 0%" com a barra vazia. */}
      {!cala && !encerrado && mode === "multi-1t" && turno !== 2 && (
        <ChancesPanel
          title="Segundo turno?"
          pSegundoTurno={national.p_segundo_turno_overall}
          /* 🔴 As props `lider*` soltas descrevem a base PARCIAL e `liderProj`
             a base PROJEÇÃO — a mesma convenção de `eleitos`/`eleitosProj`.
             Cada lado leva o registro INTEIRO de UMA candidatura: nome,
             `p_fecha_1t` e `pct_projetado` da mesma pessoa. Trocar só o nome
             produziria "B vence no 1º turno — 31%" com a probabilidade de A,
             que é uma frase falsa costurada com dois fatos verdadeiros.
             Quando as duas bases nomeiam a mesma pessoa — o caso comum — o
             painel emite um medidor só e o DOM é o de antes. */
          liderNome={
            liderParcial ? nomeExibicao(liderParcial.nome, liderParcial.sqcand) : undefined
          }
          liderPFecha1t={liderParcial?.p_fecha_1t}
          liderPctProjetado={liderParcial?.pct_projetado}
          liderProj={{
            nome: lider ? nomeExibicao(lider.nome, lider.sqcand) : undefined,
            pFecha1t: lider?.p_fecha_1t,
            pctProjetado: lider?.pct_projetado,
          }}
          pctApurado={pct_apurado_total}
        />
      )}

      {/* RF-149 re-pendurado (design 019 § D5): a grade de "quem está
          concorrendo" — com foto, número na urna e link para `/candidatos` —
          entra logo abaixo do painel de identidade, que é onde o leitor já
          está olhando. Vale `null` quando o Blob de candidaturas não responde,
          e a página segue de pé (constituição § 7). */}
      {gradeCandidaturas}

      {/* Seção 3c — spec 020 (RF-174): a evolução da apuração.

          Slot do design 020 § Telas (T-01): entre o painel de chances e o de
          redutos. Fica DEPOIS da grade de candidaturas para não separar o
          `{gradeCandidaturas}` do painel de identidade a que o RF-149 o
          pendurou.

          Fase 2 — as props são as do payload (`serieNacional`). Sem série
          publicada, `eixo` e `candidatos` vão vazios de propósito, nunca com
          zeros de enfeite: em fase pré o componente desenha os eixos e diz que
          o gráfico vale só no dia da eleição; fora dela, diz que a série ainda
          não chegou. Nos dois casos o bloco PERMANECE no DOM (ADR-0017,
          ADR-0032 item 3).

          🔴 `preEleicao` vem de `pre`, que é o `isPreEleicao(payload)` do
          RF-153 — o mesmo e único gatilho de fase da página, nunca uma
          segunda leitura nem uma data de calendário. O componente não decide
          fase; quem decide é este chamador.

          🔴 `cadenciaMin` sai de `cadencia_min` do payload, **nunca** de
          `eixo[1] - eixo[0]`. O 5 do ramo sem série é inerte: a cadência só é
          impressa na legenda da tabela, que existe apenas no estado com dado. */}
      <Panel kicker="Evolução da apuração">
        <SerieApuracaoChart
          cadenciaMin={serieNacional ? serieNacional.cadencia_min : 5}
          candidatos={serieNacional ? serieNacional.candidatos : []}
          eixo={serieNacional ? serieNacional.eixo : []}
          escopo="Brasil"
          preEleicao={pre}
          zerado={zerado}
          titleId="serie-apuracao-heading"
        />
      </Panel>

      {/* Seção 4 — redutos por candidato (S07/Bloco 1).

          `!pre`: "onde cada candidato é mais forte" responde a uma pergunta
          sobre votos contados. Não está nos quatro painéis nomeados pelo
          RF-154 — está aqui pela mesma pergunta única do design 019 § D0, que
          classifica também os blocos que a spec não enumerou: mede, cala. */}
      {!cala && <StrongholdsPanel candidatos={national.candidatos} rows={por_uf} />}

      {/* Seção 5 — o que falta apurar (S07/Bloco 1).

          🔴 RF-154 — com `por_uf: []` este painel afirma, em caixa alta e no
          topo de si mesmo, **"Todas as unidades federativas estão com a
          apuração concluída."** A lista `pendentes` fica vazia quando todo
          `pct_apurado` é zero, e o componente lê isso como "nada falta", não
          como "nada começou": é o oposto exato do que o número quer dizer. */}
      {!cala && !encerrado && (
        <RemainingPanel
          rows={por_uf}
          candidatos={national.candidatos}
          pctApuradoTotal={pct_apurado_total}
          ufsApuradas={ufs_apuradas}
          totalUfs={unidadesDeApuracao(1)}
        />
      )}

      {/* Seção 6 — boletim do momento (S07/Bloco 1). Templates
          determinísticos, nunca LLM (ADR-0005). Último painel de conteúdo do
          protótipo (`App.jsx:355`).

          🔴 RF-154 — é um diário de eventos que não ocorreram: cinco linhas
          carimbadas com `HH:MM:SS` ao lado de zero voto, e um intervalo de
          confiança de 95% `[0,0; 0,0]`, que é a forma tipográfica da certeza
          absoluta. */}
      {!cala && !encerrado && (
        <BulletinPanel
          national={national}
          rows={por_uf}
          pctApuradoTotal={pct_apurado_total}
          ufsApuradas={ufs_apuradas}
          totalUfs={unidadesDeApuracao(1)}
          ts={ts}
          turno={turno}
          historico={leitura.historico}
        />
      )}

      {/* ADR-0072 — manchetes de feeds públicos (só título, veículo, hora e
          link). `noticias` já vem `null` antes das 17h e com o interruptor
          desligado (`filtrarParaTela`). */}
      {!cala && leitura.noticias && <NaImprensaPanel itens={leitura.noticias} />}

      {/* 🔴 ADR-0057 item 6 (2026-09-28, decisão do dono) — os 27 estados
          agrupados por REGIÃO, com o consolidado da região no topo. Entra
          ALÉM do "Placar por estado" e logo antes dele.

          Presidente é uma corrida só: o consolidado soma POR CANDIDATO (o
          número de urna é o mesmo nas 27 UFs), não por partido. Os cartões
          são o `<GovernorCard cargo="pres">` — sem selo de turno (ADR-0055:
          o 2º turno de Presidente é fato nacional) — e cada um é o link para
          a tela do estado.

          `!pre` pela mesma razão do Placar logo abaixo (RF-154/RF-161): em
          fase pré não há voto a consolidar nem a mostrar por estado. O
          `titleId` é próprio — o `state-grouped-table-heading` do Placar é o
          alvo do `aria-describedby` do mapa e não pode duplicar. */}
      {!cala && (
        <Panel
          kicker="Estado a estado · não oficial"
          title="Por região"
          titleId="regioes-presidente-heading"
        >
          <ul
            aria-label="Corridas estaduais de presidente, por região"
            className="grid grid-cols-1 gap-3"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {agruparPorRegiao(por_uf).map((grupo) =>
              grupo.rows.length > 0 ? (
                <li key={grupo.regiao.id}>
                  <RegiaoConsolidada
                    regiao={grupo.regiao}
                    ufs={grupo.rows}
                    chave="candidato"
                    nivel={3}
                  >
                    <ul
                      aria-label={`Estados do ${grupo.regiao.nome}`}
                      className="grid grid-cols-1 gap-3"
                      style={{ listStyle: "none", margin: 0, padding: 0 }}
                    >
                      {grupo.rows.map((uf) => (
                        <li key={uf.sigla}>
                          <a
                            href={`/uf/${uf.sigla}`}
                            data-testid="corrida-uf-pres"
                            data-uf={uf.sigla}
                            className="block"
                            style={{ color: "inherit", textDecoration: "none" }}
                          >
                            {/* 🔴 04/10/2026 (dono) — `duasBases`: o cartão
                                acompanha a chave "Parcial / Projeção", como os
                                de `/governador` e `/senador`. Até aqui ele
                                mostrava SÓ a projeção (`pct`, em ocre) logo
                                abaixo do resumo "Parcial · …" da região — o
                                leitor via, na visão Parcial, um número que não
                                era a parcial. Agora: Parcial ⇒ `pct_atual`, cor
                                `--color-pct-votos`, ordem do apurado; Projeção
                                ⇒ a lista de sempre, em `--color-pct-proj`. */}
                            <GovernorCard
                              uf={uf}
                              candidatos={national.candidatos}
                              cargo="pres"
                              nivelTitulo={4}
                              duasBases
                              turno={turno}
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </RegiaoConsolidada>
                </li>
              ) : null,
            )}
            {/* ADR-0045 item 7 — o exterior não é região: `agruparPorRegiao`
                o descarta, e ele entra aqui, por último, como cartão avulso
                com link para `/uf/ZZ`. Só aparece quando o produtor publicou
                a linha `ZZ` em `por_uf`. */}
            {exteriorRow ? (
              <li key={exteriorRow.sigla}>
                <a
                  href={`/uf/${exteriorRow.sigla}`}
                  data-testid="corrida-uf-pres"
                  data-uf={exteriorRow.sigla}
                  className="block"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <GovernorCard
                    uf={exteriorRow}
                    candidatos={national.candidatos}
                    cargo="pres"
                    nivelTitulo={3}
                    duasBases
                    turno={turno}
                  />
                </a>
              </li>
            ) : null}
          </ul>
        </Panel>
      )}

      {/* Seção 7 — placar por estado. NÃO existe no protótipo; é acréscimo
          desta implementação, mantido por decisão do usuário. Por isso vem
          depois de toda a sequência do kit, antes da metodologia.

          🔴 RF-154 — agrupa 27 UFs por status de uma apuração que não começou.
          Quem leva o leitor às páginas de estado em fase pré é o `<UfPicker>`
          da moldura do mapa, que permanece (RF-157). */}
      {!cala && (
        <Panel kicker="Placar por estado">
          {/* 🔴 `corA`/`corB` saem da SIGLA (ADR-0024). Até 19/09 vinham de
              `lider.cor`, a paleta por COLOCAÇÃO — e aqui o efeito era literal:
              as duas faixas da tabela por estado TROCAVAM de cor numa
              ultrapassagem, enquanto o mapa ao lado não trocava. */}
          <StateGroupedTable
            rows={por_uf}
            mode={mode}
            candidatos={national.candidatos}
            candidatoAId={national.candidato_a_id}
            candidatoAName={lider ? nomeExibicao(lider.nome, lider.sqcand) : "Líder A"}
            candidatoBName={segundo ? nomeExibicao(segundo.nome, segundo.sqcand) : "Líder B"}
            corA={candidateColorDoPartido(lider?.partido, 1)}
            corB={candidateColorDoPartido(segundo?.partido, 2)}
          />
        </Panel>
      )}

      <Panel kicker="Metodologia">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto]" style={{ gap: "var(--space-8)" }}>
          {/* Agulha — só em binary (2T). Em multi-1t a agulha `national-1t`
              media P(2T), a mesma métrica do `<TwoRoundIndicator />` acima:
              ADR-0018 tirou a duplicata do fluxo. */}
          {!cala && mode === "binary" && (
            <NationalNeedle
              national={national}
              variant="national-2t"
              pSegundoTurno={national.p_segundo_turno_overall}
              liderNome={lider ? nomeExibicao(lider.nome, lider.sqcand) : undefined}
            />
          )}
          {/* RF-158 — este é o ÚNICO bloco da tabela de mentiras que NÃO pode
              sumir: a constituição § 8 exige "O que está movendo o forecast"
              em toda página com projeção, e princípio constitucional está
              acima de regra de design desta spec. Fica, e vira prosa no
              futuro — sem fração, sem barra, sem percentual. É também a única
              superfície onde a palavra "projeção" é autorizada em fase pré. */}
          <ForecastTransparency pctApurado={pct_apurado_total} preEleicao={cala} />
        </div>
      </Panel>

      {/* `!pre`: a análise é leitura do modelo sobre o que foi contado.
          ADR-0072: texto da IA quando o interruptor está ligado e o texto é
          fresco; senão, as frases de regra fixa (`frasesRegra`). */}
      {!cala && !encerrado && analiseIA && (
        <Panel kicker="Análise por IA · não oficial">
          <InsightCard
            frases={analiseIA.frases}
            heading="Análise"
            origem="ia"
            atualizadoEm={analiseIA.gerado_em}
          />
        </Panel>
      )}
      {!cala && !encerrado && !analiseIA && frasesRegra.length > 0 && (
        <Panel kicker="Leitura do modelo">
          <InsightCard frases={frasesRegra} heading="Análise" origem="regra" />
        </Panel>
      )}

      {/* `composition` reservado para futuras melhorias do ForecastTransparency */}
      {/* FIX 2026-09-05 (a11y-perf-auditor): --color-text-faint (#999999)
          mede ~2.85:1 sobre branco — falha RNF-022 (4.5:1). Só aparece em
          dev (NODE_ENV==="development"), mas axe-core não distingue isso;
          trocado por --color-text-muted (~5.7:1). */}
      {process.env.NODE_ENV === "development" && (
        <details className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          <summary>debug: composition</summary>
          <pre>{JSON.stringify(composition, null, 2)}</pre>
        </details>
      )}

      <Footer />
    </main>
  );
}
