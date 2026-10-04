"use client";

/**
 * components/blocks/NationalChoroplethMap.tsx
 *
 * Mapa coroplético do Brasil hero (spec 003).
 * Cobertura: RF-030.1, RF-030.2, RF-030.3, RF-030.4 (Skip — hachura omitida).
 *
 * Arquitetura de dois níveis (ADR-0010):
 *   - Este arquivo: thin wrapper com `next/dynamic({ ssr: false })` que expõe
 *     a interface pública congelada. SSR-safe (renderiza MapSkeleton).
 *   - `./_NationalChoroplethMapImpl.tsx`: implementação MapLibre + PMTiles.
 *     Carregada apenas no cliente, NUNCA no servidor.
 *
 * Por quê dois níveis?
 *   `NationalMapBlock.tsx` é Client Component, mas o test `home-page.test.tsx`
 *   usa `renderToStaticMarkup` que chama `useRouter()` (só válido no App Router
 *   montado). Separar o impl em dynamic import garante que nenhum hook de
 *   navegação/browser escapa para o contexto SSR dos testes. Este wrapper
 *   ganhou `useState`/`useEffect` em 2026-09-08 (folha de UF, ver abaixo) —
 *   nenhum dos dois é hook de navegação, `renderToStaticMarkup` continua
 *   seguro (SSR nunca roda `useEffect`; `useState` só devolve o valor
 *   inicial).
 *
 *   🔴 É por isso que `useRouter` NÃO subiu para cá em 2026-09-19, quando o
 *   clique voltou a navegar (ver abaixo): este arquivo é EAGER e é renderizado
 *   por `renderToStaticMarkup` em `tests/integration/home-page.test.tsx`, que
 *   não declara nenhum `vi.mock("next/navigation")` (conferido). `useRouter`
 *   aqui quebraria aquele teste na hora. O breakpoint é decidido AQUI; a
 *   navegação acontece no impl, onde `ssr: false` garante que o hook nunca vê
 *   um render de servidor.
 *
 * A11y: lista textual paralela fica em <StateGroupedTable /> (irmão no shell).
 * O caminho de teclado para um estado é o `<UfPicker>` (27 `<Link>` reais),
 * nunca o canvas — que não tem `tabIndex`. Ver a nota junto ao `role="img"` em
 * `_NationalChoroplethMapImpl.tsx`.
 *
 * ## O clique numa UF — duas decisões, nesta ordem
 *
 * **2026-09-08 (decisão do usuário)**: clique/toque numa UF do mapa deixou de
 * navegar direto para `/uf/[sigla]` e passou a abrir `<StateResultSheet>`
 * (scrim modal no mobile, cartão lateral não-modal no desktop, `Sheet.side`).
 * O estado da UF selecionada mora AQUI, não em `_NationalChoroplethMapImpl.tsx`
 * nem em `app/`: este wrapper já é client e já é carregado eager (fora do
 * chunk lazy do MapLibre), então a folha soma ao orçamento de aplicação
 * (RNF-007a, headroom grande hoje) em vez de inflar o chunk do mapa
 * (RNF-007b, 285 KiB de 300 KiB — sem margem pra mais JS).
 *
 * **2026-09-19 (decisão do usuário, ADR-0050 — reverte a anterior só no
 * DESKTOP)**: no desktop o clique volta a NAVEGAR para a página do estado; no
 * mobile continua abrindo a folha. Divisão de trabalho entre os dois níveis:
 *
 *   - aqui: `useIsDesktop()` resolve a media query e passa
 *     `navegarNoClique={isDesktop}` ao impl;
 *   - lá: o handler de clique lê essa prop de uma ref e chama
 *     `router.push(ufHref(cargo, sigla))`.
 *
 * A folha NÃO morre — ela é o caminho de mobile, e no desktop simplesmente
 * nunca abre (`selectedSigla` fica `null`, porque `onSelectUf` não é chamado).
 * Toda a fiação dela (`open`, `onClose`, `row`, `side`, `cargo`) fica intacta
 * de propósito: é o que permite um gatilho de desktop futuro sem refazer nada.
 *
 * Consequência registrada fora daqui: `docs/reference/risks.md` nomeava a
 * folha como "única saída" de quem depende de cor nos mapas de Governador e
 * Senador (que não têm legenda). Essa linha foi atualizada no mesmo commit —
 * o `<HoverCard>` carrega a coluna "Part." por candidato desde 18/09.
 *
 * **2026-09-20 (decisão do usuário — corrige o predicado de 19/09, não o
 * comportamento)**: `navegarNoClique` deixa de vir de `useIsDesktop()`
 * (largura) e passa a vir de `useHasFinePointer()` (`lib/utils/use-has-fine-pointer.ts`,
 * `(hover: hover) and (pointer: fine)`). Motivo: largura mede o TAMANHO da
 * tela, não se ela tem mouse — um iPad Pro a 1024px casava com
 * `min-width: 960px` e por isso NAVEGAVA no toque, quando o pedido é
 * justamente o oposto ("no toque só a gaveta"). `useIsDesktop()` não morreu:
 * segue sendo lido logo abaixo, agora só para a FORMA da folha (`side`,
 * cartão lateral vs. modal de baixo) — uma decisão de espaço disponível, que
 * continua fazendo sentido por largura. Ver a docstring de
 * `useHasFinePointer` para o argumento completo, e
 * `_NationalChoroplethMapImpl.tsx` para a mesma correção do lado do balão
 * (`bloqueiaBalaoNoToque`).
 */

import dynamic from "next/dynamic";
import { type CSSProperties, useEffect, useState } from "react";

import type { MapView } from "@/components/atoms/controls/MapViewToggle";
import { type CandidateLegendEntry, CandidateLegendGroup } from "@/components/atoms/maps/MapLegend";
import { MapSkeleton } from "@/components/atoms/maps/MapSkeleton";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import {
  ariaRessalvaVagas,
  MARGEM_2A_VAGA_LABEL,
  type UfPickerCargo,
} from "@/components/layout/UfPicker";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import type { ViewMode } from "@/lib/state/view-mode";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { intensityForParty, type PartyIntensity } from "@/lib/utils/party-color";
import { useHasFinePointer } from "@/lib/utils/use-has-fine-pointer";

/**
 * Teto de padding do `fitBounds` inicial quando o mapa `frame` está SEM
 * cromo sobreposto (celular, 2026-09-27 — versão B do protótipo). 16–24px de
 * respiro visual, nada de reservar espaço para cabeçalho/legenda: eles
 * moraram embaixo do mapa, em fluxo, desde esta mudança. Ver
 * `_NationalChoroplethMapImpl.tsx`, prop `framePaddingCeiling`.
 */
const MOBILE_FRAME_PADDING_CEILING = { top: 24, bottom: 24, left: 16, right: 16 };

/**
 * Breakpoint desktop — mesmo valor de `ADR-0029` (mobile <960px).
 * Sem hook compartilhado em `lib/utils/**` pra este propósito hoje (o mais
 * próximo, `BreakingNewsTicker.tsx`, resolve `prefers-reduced-motion`, outra
 * media query) — local e pequeno, como o padrão já usado em `UF_NAMES`
 * (`GovernorCard.tsx`, `StateResultSheet.tsx`).
 */
const DESKTOP_QUERY = "(min-width: 960px)";

/**
 * Estamos num viewport de desktop?
 *
 * Chamava-se `useIsDesktopSheet` até 2026-09-19, quando governava uma coisa só
 * — a FORMA da folha (`Sheet.side`: cartão lateral no desktop, scrim modal no
 * mobile). Entre 19/09 e 20/09 também decidiu se o clique navegava — mas
 * largura estava respondendo a pergunta errada para isso (ver
 * `useHasFinePointer`, `lib/utils/use-has-fine-pointer.ts`): um iPad Pro
 * largo e sensível a toque navegava quando deveria abrir a gaveta. Desde
 * 2026-09-20 este hook voltou a governar UMA coisa só — de novo a forma da
 * folha —, e é por isso que o nome sem sufixo ficou, mesmo tendo perdido o
 * segundo uso: continua sendo o predicado certo para "há espaço pra um
 * cartão lateral", só não é mais o predicado certo para "há mouse".
 *
 * 🔴 Começa `false` em TODO viewport e só vira `true` depois do `useEffect`
 * — `window.matchMedia` não existe no render de servidor. Quem consome o valor
 * num handler registrado uma vez só (o impl do mapa) tem de lê-lo de uma ref
 * sincronizada, nunca de closure.
 */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export interface NationalChoroplethMapProps {
  rows: EdgeUfRow[];
  candidatoAId: number | null;
  view: MapView;
  /**
   * Mapping `candidato_id → rank nacional` (S05/F3B). Habilita paleta N-way
   * via `colorForRank()`/`resolveCandHex()`. Quando omitido, o impl degrada
   * para "líder = rank 1 (cand-1 vermelho)" mantendo o look S04. Construído
   * em `app/page.tsx` a partir de `national.candidatos[]` (`Object.fromEntries(
   * candidatos.map(c => [c.id, c.rank]))`).
   *
   * S07/Bloco 1 (ADR-0024): continua sendo o **fallback** de cor — usado
   * quando `candidatos[].partido` está ausente ou não tem token próprio
   * (ver prop `candidatos` abaixo).
   */
  rankByLider?: Record<number, number>;
  /**
   * Lista nacional de candidatos (S07/Bloco 1 — ADR-0024, design system
   * Atlas Menna). Fornece `partido` para colorir cada UF pelo partido do
   * líder (`intensityForParty`/`resolvePartyHex`) em vez do rank, e `nome`
   * para o `<HoverCard>` e a `<MapLegend>` dos dois primeiros colocados.
   *
   * Mesmo shape de `StateGroupedTable.candidatos` — construído em
   * `app/page.tsx` a partir de `national.candidatos`. Ausente, ou sem
   * `partido` mapeado (`normalizePartySlug` cai em `"outros"`) para o
   * líder de uma UF → aquela UF degrada para o fallback de rank
   * (`rankByLider` + `cand-color.ts`), nunca fica sem cor.
   */
  candidatos?: EdgeCandidate[];
  /**
   * Base de leitura do choropleth (ADR-0029 § 2) — `"proj"` (default) pinta a
   * projeção, `"parcial"` pinta o apurado. Vem do controle do shell via
   * `components/blocks/NationalMapBlock.tsx`; zero requisição nova, os dois números já estão
   * no mesmo `EdgeUfRow`.
   */
  viewMode?: ViewMode;
  /**
   * **RF-157 (spec 019)** — fase pré-eleição. Repassado ao impl (todas as UFs
   * em `--map-uncounted`) e troca a legenda: a rampa divergente por partido dá
   * lugar a uma legenda de **geografia**.
   *
   * A legenda de partido não é só inútil aqui — ela é uma afirmação. Ela
   * nomeia dois candidatos, imprime as duas rampas de cor de identidade e
   * rotula uma escala de margem em pontos percentuais, tudo sobre um mapa
   * inteiramente cinza. O leitor procuraria no mapa as cores que a legenda
   * promete e concluiria que ainda não apareceram — que é o oposto do fato.
   */
  preEleicao?: boolean;
  /**
   * Altura do mapa. Número → px. String → qualquer comprimento CSS — o mapa
   * hero da home usa `clamp(400px, 52vh, ...)` desde o ADR-0029 § 1.
   */
  height?: number | string;
  /**
   * Onde a `<MapLegend>` fica (ADR-0033 § 1).
   *
   * `"below"` (default) — no fluxo, logo abaixo do mapa. É o formato de
   * quando o mapa é um bloco de página com altura fixa.
   *
   * `"overlay"` — caixa flutuante no canto inferior esquerdo, sobre o mapa,
   * como no kit (`App.jsx`, o bloco `position: absolute; left: 12; bottom:
   * 12; width: 200` dentro de `mapBlock`). É o formato obrigatório quando o
   * mapa PREENCHE o container (`height="100%"`): com a legenda no fluxo, ela
   * seria empurrada para fora da moldura e cortada pelo `overflow: hidden`.
   */
  legendPlacement?: "below" | "overlay";
  /**
   * Qual corrida este mapa mostra (2026-09-18, ADR-0042/RF-144-145; estendido
   * a `"sen"` em 2026-09-18). Decide três coisas, e as três são sobre
   * `national.candidatos` não ser uma corrida única fora do cargo 1:
   *
   *   1. A legenda por candidato (`buildCandidateLegendEntries`) só existe
   *      em `"pres"`. Em `"gov"` e `"sen"` `national.candidatos` é a UNIÃO de
   *      27 corridas sob o mesmo espaço de `id`, com `rank` reiniciando a
   *      cada UF — `.find(c => c.rank === 1)` devolveria os três primeiros
   *      colocados do Acre como se fossem o pódio nacional.
   *   2. O destino do CTA da `<StateResultSheet>` (`ufHref`).
   *   3. O rótulo das views "margin"/"winner" (ver `viewLabelForCargo`
   *      abaixo) e o NOME ACESSÍVEL do `role="region"` que envolve o mapa
   *      (`ariaRessalvaVagas`): em Senador a margem que decide a corrida é a
   *      do 2º para o 3º (RF-104), não a do 1º para o 2º, e a corrida elege
   *      2 por estado, não 1 — "Margem"/"Por vencedor" sem qualificação
   *      afirmariam o contrário.
   *
   * Default `"pres"`: o único caller anterior a esta prop nunca a passava, e
   * "pres" é o comportamento que ele sempre teve.
   */
  cargo?: UfPickerCargo;
  /**
   * Turno da corrida (`EdgePayload.turno`) — 2026-10-04. Repassado ao balão e
   * à gaveta só para os selos de base (`selosDaBase` desliga todo selo no 2º
   * turno). Ausente ⇒ tratado como 1º turno, o default de `selosDaBase`.
   */
  turno?: number | null;
  className?: string;
}

const VIEW_LABEL: Record<MapView, string> = {
  winner: "Por vencedor",
  margin: "Margem",
  swing: "Swing vs 2022",
  turnout: "% apurado",
};

/**
 * Rótulo de "por líder" qualificado em Senador — irmão de
 * `MARGEM_2A_VAGA_LABEL` (`UfPicker.tsx`) para a view "winner".
 *
 * 🔴 2026-09-18 (item d) — "Por vencedor" (default, `VIEW_LABEL.winner`)
 * descreve mal uma corrida que elege 2 por estado: "vencedor" é singular.
 * Mas qualificar para algo como "Por eleitos" seria PIOR, não melhor: a cor
 * pintada nesta view (`resolveColor`, case "winner") é sempre a identidade
 * do 1º colocado local (`top_candidatos[0]`) — o mapa não sabe nem afirma
 * nada sobre quem fica com a 2ª vaga. "Eleitos" prometeria informação que o
 * mapa não tem, a MESMA classe de erro que RF-104 já corrigiu para "margem"
 * (rotular um número como o que ele não é). "Por líder" é o rótulo honesto:
 * descreve exatamente o que está pintado — o candidato à frente hoje/na
 * projeção —, sem alegar que a eleição já tem vencedor. Presidente e
 * Governador (1 vaga, onde líder = vencedor) continuam com "Por vencedor".
 */
export const SEN_WINNER_LABEL = "Por líder";

/**
 * Rótulo de uma `view` do mapa, qualificado por cargo — fonte ÚNICA para o
 * `aria-label` do `role="region"` (abaixo) e para o `<MapViewToggle>`
 * (`NationalMapBlock.tsx`, que importa `MARGEM_2A_VAGA_LABEL`/
 * `SEN_WINNER_LABEL` diretamente). Ter duas fontes para o mesmo rótulo foi
 * exatamente o que atrasou a correção de RF-104 por uma rodada inteira (o
 * seletor foi qualificado, a ficha de estado não).
 *
 * Só "margin" e "winner" mudam em Senador — "swing" e "turnout" não têm
 * leitura de vaga (não descrevem "quem lidera", ver `resolveColor`).
 *
 * Exportada desde 2026-09-27: `NationalMapBlock.tsx` (cromo do celular)
 * precisa do MESMO rótulo para o título "Legenda · <vista>" da folha "Ver
 * legenda" — uma segunda cópia deste `if` teria sido exatamente o defeito
 * que este comentário já nomeia acima ("ter duas fontes para o mesmo rótulo
 * foi o que atrasou a correção de RF-104").
 */
export function viewLabelForCargo(view: MapView, cargo: UfPickerCargo): string {
  if (cargo === "sen") {
    if (view === "margin") return MARGEM_2A_VAGA_LABEL;
    if (view === "winner") return SEN_WINNER_LABEL;
  }
  return VIEW_LABEL[view];
}

/**
 * O esqueleto precisa reservar a MESMA altura que o mapa vai ocupar, senão o
 * chunk do MapLibre chegando empurra o resto da página (CLS) — e desde o
 * ADR-0029 § 1 essa altura é variável (`clamp(400px, 52vh, ...)` no hero da
 * home), não mais a constante 420. Como `next/dynamic` não repassa props para
 * o `loading`, a altura viaja por custom property: o wrapper a publica em
 * `--map-height` e o esqueleto a lê, com 420px de fallback para quem não
 * passa `height`.
 */
const NationalChoroplethMapImpl = dynamic(
  () =>
    import("@/components/blocks/_NationalChoroplethMapImpl").then(
      (m) => m.NationalChoroplethMapImpl,
    ),
  {
    ssr: false,
    loading: ({ error }) => (error ? null : <MapSkeleton height="var(--map-height, 420px)" />),
  },
);

/** Degraus da rampa, borda→centro (mais forte→mais fraco) — mesma ordem do kit. */
const LEGEND_LEVELS: readonly PartyIntensity[] = [5, 4, 3, 2, 1];

/**
 * A caixa flutuante da legenda quando o mapa PREENCHE a moldura
 * (`legendPlacement="overlay"`, ADR-0033 § 1) — canto inferior esquerdo, sobre
 * o mapa, como no kit. Extraída para constante quando a fase pré-eleição
 * passou a ter uma legenda própria (RF-157): duas caixas com a mesma âncora
 * escritas em dois lugares sairiam de sincronia no primeiro ajuste.
 */
const LEGEND_OVERLAY_BOX: CSSProperties = {
  position: "absolute",
  left: "var(--space-3)",
  bottom: "var(--space-3)",
  width: 200,
  background: "var(--surface-card)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2)",
  pointerEvents: "none",
};

/**
 * Uma rampa por colocado (rank 1, 2 e 3) — não mais um duelo top-2. O
 * choropleth já pinta cada UF pela identidade do LÍDER LOCAL com intensidade
 * por margem (`intensityForParty`, ADR-0024), qualquer que seja o rank dele:
 * uma UF liderada pelo 3º colocado nacional já recebe a cor do 3º colocado. A
 * legenda anterior (`buildPartyLegend`, um duelo rank1×rank2) não tinha como
 * nomear essa cor — o 3º colocado pintava o mapa sem aparecer em legenda
 * nenhuma. Três legendas separadas descrevem o mapa que de fato está na tela.
 *
 * Só faz sentido nas views "quem lidera" (`winner`/`margin`); `swing`/
 * `turnout` não têm identidade partidária natural (ver comentários em
 * `_NationalChoroplethMapImpl.tsx`) e não ganham legenda — comportamento
 * herdado sem mudança.
 *
 * Degrada por quantidade: renderiza uma entrada por rank de 1 a 3 que EXISTIR
 * no payload — nunca inventa um 3º colocado que não veio. Sem `candidatos`
 * (fallback pré-S07), ou sem nenhum dos três ranks identificado, retorna
 * `null` — melhor nenhuma legenda do que uma incorreta.
 *
 * 🔴 2026-09-18 (RF-144/RF-145) — `cargo === "gov"` também devolve `null`,
 * **antes** de tocar em `candidatos`. Fora do cargo 1, `national.candidatos`
 * é a UNIÃO de 27 corridas estaduais sob o mesmo espaço de `id`, e `rank`
 * REINICIA a cada UF (medido: 27 candidatos com `rank === 1` no payload de
 * governador). `.find(c => c.rank === 1)` devolveria o líder do Acre (ou de
 * qualquer UF que calhe de vir primeiro no array) rotulado como o 1º colocado
 * NACIONAL — a mesma classe de erro que o `<ResultPanel>` já foi barrado de
 * cometer nesta rota (ver `app/(gov)/governador/page.tsx`, "Por que esta rota
 * NÃO recebeu o `<ResultPanel>` do kit"). O gate é por `cargo`, um valor
 * explícito que o caller passa — nunca inferido do formato do array.
 *
 * 🔴 2026-09-18 (2ª rodada) — `cargo === "sen"` entra no MESMO ramo, pela
 * MESMA razão: cargo 5 é a segunda corrida (depois de governador) em que o
 * bloco nacional é união de 27 UFs (RF-145 cobre os dois cargos 3 e 5
 * explicitamente).
 */
/**
 * Os candidatos rank 1..3 elegíveis para legenda — ponto único que
 * {@link buildCandidateLegendEntries} (rampa completa, overlay do desktop) e
 * {@link buildCandidateLegendSummary} (bolinha + nome, resumo do celular)
 * compartilham. Exportada só a decisão "quem entra"; as duas formas de
 * desenhar cada candidato continuam em funções separadas, cada uma com sua
 * própria API pública.
 */
function porRankCandidates(
  candidatos: EdgeCandidate[] | undefined,
  view: MapView,
  cargo: UfPickerCargo,
): EdgeCandidate[] | null {
  if (view !== "winner" && view !== "margin") return null;
  if (cargo === "gov" || cargo === "sen") return null;
  if (!candidatos || candidatos.length === 0) return null;
  const porRank = [1, 2, 3]
    .map((rank) => candidatos.find((c) => c.rank === rank))
    .filter((c): c is EdgeCandidate => c != null);
  return porRank.length > 0 ? porRank : null;
}

/**
 * Exportada desde 2026-09-27: `NationalMapBlock.tsx` monta a MESMA rampa
 * completa dentro da folha "Ver legenda" do celular (`<CandidateLegendGroup>`,
 * `MapLegend.tsx`) — uma segunda implementação deste filtro divergiria da
 * legenda overlay do desktop na primeira mudança de regra de cargo.
 */
export function buildCandidateLegendEntries(
  candidatos: EdgeCandidate[] | undefined,
  view: MapView,
  cargo: UfPickerCargo,
): CandidateLegendEntry[] | null {
  const porRank = porRankCandidates(candidatos, view, cargo);
  if (!porRank) return null;
  return porRank.map((c) => ({
    label: nomeExibicao(c.nome, c.sqcand),
    colors: LEGEND_LEVELS.map((level) => intensityForParty(c.partido, level)),
  }));
}

/** Uma entrada da legenda RESUMIDA do celular — bolinha + nome, sem a rampa. */
export interface CandidateLegendSummaryEntry {
  label: string;
  /** Cor do PONTO (não da barra) — `candidateMarkerColor`, já escurecida o
   * bastante para 3:1 nos 4 partidos pálidos (PSOL/PSB/Outros/NOVO), ver
   * `_candidateColor.ts`. Nunca a cor de preenchimento do mapa: aquela
   * exige o contorno `DATA_FILL_STROKE` porque tem EXTENSÃO; um ponto de
   * 10px não tem extensão a contornar. */
  dotColor: string;
}

/**
 * A linha "● Lula ● Flávio ● Caiado · mais forte = mais vantagem" do rodapé
 * do mapa no celular (versão B do protótipo, 2026-09-27) — MESMO filtro de
 * {@link buildCandidateLegendEntries} (rank 1..3, `winner`/`margin`, fora de
 * Gov/Sen), forma diferente: um ponto por candidato, não uma rampa de 5
 * degraus (a rampa completa mora na folha "Ver legenda", ver
 * `NationalMapBlock.tsx`).
 */
export function buildCandidateLegendSummary(
  candidatos: EdgeCandidate[] | undefined,
  view: MapView,
  cargo: UfPickerCargo,
): CandidateLegendSummaryEntry[] | null {
  const porRank = porRankCandidates(candidatos, view, cargo);
  if (!porRank) return null;
  return porRank.map((c) => ({
    label: nomeExibicao(c.nome, c.sqcand),
    dotColor: candidateMarkerColor(c.partido),
  }));
}

/**
 * A legenda de **geografia** que substitui a de partidos em fase pré-eleição
 * (RF-157).
 *
 * Uma chave só, porque o mapa tem uma cor só. Não cita partido, não cita
 * candidato e não desenha faixa de margem — diz o que o mapa de fato mostra:
 * as unidades federativas do país, nenhuma delas com voto contado.
 *
 * `role="img"` + `aria-label` pelo mesmo motivo do `<MapLegend>`: um quadrado
 * colorido não diz nada a leitor de tela (RNF-022/023).
 *
 * Exportada desde 2026-09-27: o rodapé do celular (`NationalMapBlock.tsx`)
 * mostra a MESMA legenda em fluxo, fora do overlay do desktop.
 */
export function GeografiaLegend({ className }: { className?: string }) {
  const texto =
    "As 27 unidades federativas. Nenhuma tem voto contado: a votação ainda não começou.";
  return (
    <div
      aria-label={texto}
      className={className}
      data-testid="map-legend-geografia"
      role="img"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        font: "var(--type-data)",
        color: "var(--text-secondary)",
      }}
    >
      <span
        aria-hidden="true"
        className="flex-none"
        style={{
          width: 12,
          height: 10,
          background: "var(--map-uncounted)",
          border: "1px solid var(--border-hairline)",
        }}
      />
      <span aria-hidden="true">{texto}</span>
    </div>
  );
}

export function NationalChoroplethMap({
  rows,
  candidatoAId,
  view,
  rankByLider,
  candidatos,
  viewMode = "proj",
  preEleicao = false,
  height = 420,
  legendPlacement = "below",
  cargo = "pres",
  turno,
  className,
}: NationalChoroplethMapProps) {
  // RF-157 — a legenda de partido não é construída em fase pré. A decisão é
  // aqui, no chamador da legenda, e não dentro do `<CandidateLegendGroup>`:
  // aquele átomo não tem opinião sobre partido nem sobre fase, e não deve
  // ganhar uma.
  const legendEntries = preEleicao ? null : buildCandidateLegendEntries(candidatos, view, cargo);
  const [selectedSigla, setSelectedSigla] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  // 2026-09-27 — mapa `frame` (moldura persistente) SEM cromo sobreposto no
  // celular: o `fitBounds` inicial não precisa mais reservar folga para um
  // cabeçalho/legenda que não existem mais ali (ver `NationalMapBlock.tsx`,
  // o cromo virou fluxo abaixo do mapa). Só se aplica a `legendPlacement ===
  // "overlay"` — a única forma que já significava "cromo por cima do mapa";
  // `"below"` nunca teve essa folga extra.
  const chromeless = legendPlacement === "overlay" && !isDesktop;
  // 2026-09-20 — fonte do clique-navega E da guarda do balão no toque. Ver a
  // docstring do topo do arquivo e `lib/utils/use-has-fine-pointer.ts`.
  const temPonteiroFino = useHasFinePointer();
  const selectedRow = selectedSigla ? (rows.find((r) => r.sigla === selectedSigla) ?? null) : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: role=region + aria-label correto para div-container de mapa interativo
    <div
      role="region"
      // RF-161 — o `aria-label` é um dos lugares por onde vocabulário de
      // medição vaza sem ninguém revisar: "modo Por vencedor" nomeia um
      // vencedor numa corrida que não começou.
      //
      // 🔴 2026-09-18 (achado do `a11y-perf-auditor`, RNF-025/WCAG SC 4.1.2)
      // — `ariaRessalvaVagas(cargo)` soma "" em `"pres"`/`"gov"` (as duas
      // strings abaixo ficam byte a byte iguais a antes desta mudança) e
      // " — Senado: 2 vagas por estado" em `"sen"`. O cabeçalho VISUAL da
      // moldura já diz "· 2 vagas" (`PersistentMapFrame.tsx`), mas é
      // elemento IRMÃO deste mapa — sem a ressalva também aqui, quem pula
      // direto para o mapa (atalho comum de leitor de tela) nunca a ouve.
      aria-label={
        (preEleicao
          ? "Mapa do Brasil — as 27 unidades federativas, nenhuma com voto contado"
          : `Mapa coroplético do Brasil — modo ${viewLabelForCargo(view, cargo)}`) +
        ariaRessalvaVagas(cargo)
      }
      className={["relative w-full", className].filter(Boolean).join(" ")}
      style={
        { "--map-height": typeof height === "number" ? `${height}px` : height } as CSSProperties
      }
    >
      <NationalChoroplethMapImpl
        rows={rows}
        candidatoAId={candidatoAId}
        view={view}
        rankByLider={rankByLider}
        candidatos={candidatos}
        viewMode={viewMode}
        preEleicao={preEleicao}
        height={height}
        // 🔴 Os dois juntos, e não um OU outro: `navegarNoClique` decide qual
        // dos dois caminhos o impl toma, e `onSelectUf` continua sendo o
        // caminho de TOQUE/mobile (quando `temPonteiroFino` é falso). Remover
        // `onSelectUf` "porque o mouse navega" mataria a gaveta no toque, que
        // é onde a decisão de 08/09 continua valendo inteira.
        //
        // 2026-09-20 — `temPonteiroFino` (capacidade de ponteiro), não mais
        // `isDesktop` (largura): ver a docstring do topo do arquivo.
        navegarNoClique={temPonteiroFino}
        // 2026-09-20 — o balão do `mousemove` só é permitido com ponteiro
        // fino. Sem isto, o `mousemove` sintético que Safari/Chrome disparam
        // ANTES do `click` em qualquer toque abriria o balão por cima da
        // gaveta que o clique seguinte abre (`mouseleave`, que fecharia o
        // balão, nunca dispara em toque). Ver `_NationalChoroplethMapImpl.tsx`.
        bloqueiaBalaoNoToque={!temPonteiroFino}
        onSelectUf={setSelectedSigla}
        cargo={cargo}
        turno={turno}
        framePaddingCeiling={chromeless ? MOBILE_FRAME_PADDING_CEILING : undefined}
      />
      {preEleicao ? (
        legendPlacement === "overlay" ? (
          // 2026-09-27 — só DESKTOP: no celular esta legenda mudou de lugar
          // (fluxo, abaixo do mapa — ver `NationalMapBlock.tsx`), nunca por
          // cima dele.
          <div
            className={mapFrameStyles.desktopOverlay}
            style={{ ...LEGEND_OVERLAY_BOX, width: 220 }}
          >
            <GeografiaLegend />
          </div>
        ) : (
          <GeografiaLegend className="mt-2" />
        )
      ) : null}
      {legendEntries ? (
        legendPlacement === "overlay" ? (
          // 2026-09-27 — idem: a versão do celular é o resumo + "Ver legenda"
          // de `NationalMapBlock.tsx`, não esta caixa flutuante.
          <div className={mapFrameStyles.desktopOverlay} style={LEGEND_OVERLAY_BOX}>
            <CandidateLegendGroup entries={legendEntries} />
          </div>
        ) : (
          <CandidateLegendGroup entries={legendEntries} className="mt-2" />
        )
      ) : null}
      {/*
       * Caminho de MOBILE desde 2026-09-19 (ver a docstring do topo). No
       * desktop o clique navega, `setSelectedSigla` nunca é chamado e esta
       * folha fica permanentemente fechada — mas a fiação inteira continua
       * montada de propósito, para que um gatilho de desktop futuro (um botão,
       * um atalho) não precise refazer nada. `side={isDesktop}` segue valendo
       * para o dia em que isso acontecer.
       */}
      <StateResultSheet
        open={selectedSigla != null}
        onClose={() => setSelectedSigla(null)}
        row={selectedRow}
        candidatos={candidatos ?? []}
        side={isDesktop}
        cargo={cargo}
        // 2026-09-21 — a folha reordena pela base ativa e o `<VagaBadge>` de
        // Senador segue junto (dívida 2). `viewMode` chega aqui de
        // `NationalMapBlock.tsx:179` (`useViewMode()`), a mesma assinatura viva
        // que já alimenta o coroplético: uma fonte, três superfícies.
        viewMode={viewMode}
        turno={turno}
      />
    </div>
  );
}
