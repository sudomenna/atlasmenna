"use client";

/**
 * components/blocks/_NationalChoroplethMapImpl.tsx
 *
 * Implementação MapLibre GL + PMTiles do mapa hero Brasil.
 * Carregada APENAS via next/dynamic({ ssr: false }) por NationalChoroplethMap.tsx.
 * NUNCA importe diretamente — use o wrapper público.
 *
 * RF-030.1 (mapa hero), RF-030.2 (4 views via setFeatureState), RF-030.3
 * (hover tooltip + click → folha `<StateResultSheet>`, ver nota 2026-09-08
 * abaixo), RF-030.4 (hachura flip — Skip).
 *
 * ADR-0003: PMTiles (ufs.pmtiles ~462KB).
 * ADR-0004: MapLibre GL.
 * Constituição § 2: cores via getComputedStyle(CSS tokens), nunca hex oficial.
 *
 * S07/Bloco 1 (ADR-0025, design system Atlas Menna):
 *   - Cor por partido (ADR-0024) via `resolvePartyHex`/`textForParty` (RNF-035) quando
 *     `EdgeCandidate.partido` do líder é conhecido; fallback pro mecanismo
 *     de rank pré-existente (`cand-color.ts`, ADR-0013 superseded) quando
 *     não é — nunca uma UF sem cor.
 *   - Traço em `--map-stroke`/`--map-stroke-focus`, "sem apuração" em
 *     `--map-uncounted` (no lugar dos hex literais `#ffffff`/`#222222` e do
 *     `--color-tossup` emprestado do fallback binário S04).
 *   - `<HoverCard>` no lugar do tooltip inline; hover também emite pro
 *     `useHoverStore` (producer, `type: "uf"`) — a store já suportava essa
 *     entidade (ver `lib/state/hover-store.ts`) mas nada aqui a alimentava
 *     ainda; nenhum consumidor existe hoje (grep confirmado), então isto é
 *     aditivo/forward-compat, não uma migração de contrato quebrado.
 *
 * ## O clique numa UF — duas decisões, nesta ordem
 *
 * **2026-09-08 (decisão do usuário)**: clique/toque numa UF deixou de navegar
 * direto para `/uf/[sigla]` e passou a abrir a `<StateResultSheet>` (folha,
 * ver `NationalChoroplethMap.tsx`) via o callback `onSelectUf`. A navegação
 * real para `/uf/[sigla]` passou a viver só no botão "Ver detalhes do estado"
 * dentro da folha (link `<a href>` de verdade, não `router.push`), e
 * `useRouter` SAIU deste arquivo — ele deixou de navegar sozinho. Esta nota
 * fica porque explica por que o código esteve assim por onze dias, e por que
 * `onSelectUf` existe.
 *
 * **2026-09-19 (decisão do usuário, ADR-0050 — reverte a anterior só no
 * DESKTOP)**: o clique volta a NAVEGAR, mas apenas onde há espaço para a página de estado —
 * `navegarNoClique` (prop nova, default `false`) é ligada pelo wrapper quando
 * a media query de desktop casa. No mobile nada muda: `navegarNoClique` fica
 * falso, o clique continua chamando `onSelectUf` e a folha continua sendo o
 * caminho. Quem decide o breakpoint é o wrapper (`NationalChoroplethMap.tsx`,
 * `useIsDesktop`); quem navega é este arquivo, porque `useRouter` não pode
 * subir para o wrapper — ver a docstring dele, que é eager e é renderizado
 * por `renderToStaticMarkup` em `tests/integration/home-page.test.tsx` sem
 * nenhum mock de `next/navigation`. Aqui o `ssr: false` do `next/dynamic`
 * garante que `useRouter` nunca vê SSR — que é exatamente onde ele morava
 * antes de 08/09.
 *
 * Vale nos três cargos e em TODA fase, inclusive pré-eleição (decisão do dono
 * em 19/09): a página do estado mostra quem concorre ali
 * (`<CandidaturasAguardando>`, RF-149), então navegar antes do pleito leva a
 * conteúdo útil, não a tela vazia — e o comportamento não muda de um dia para
 * o outro. Nenhuma condição de fase no handler.
 *
 * A `<StateResultSheet>` NÃO morreu: continua sendo o caminho de mobile, e no
 * desktop simplesmente nunca é aberta (`selectedSigla` fica `null`). Toda a
 * fiação dela segue intacta no wrapper.
 *
 * Isto devolve o código ao que `docs/specs/003-home-nacional/spec.md:139-142`
 * (RF-030.3) sempre disse — aquela linha nunca foi emendada em 08/09. A
 * ressalva desktop/mobile entra na spec num passo separado.
 *
 * **2026-09-20 (decisão do usuário — corrige o predicado de 19/09, não o
 * comportamento; e fecha um defeito adjacente no toque)**: duas mudanças.
 *
 *   1. `navegarNoClique` deixa de vir de "a tela é larga?" (`useIsDesktop`,
 *      `min-width: 960px`) e passa a vir de "este aparelho tem mouse?"
 *      (`useHasFinePointer`, `(hover: hover) and (pointer: fine)`,
 *      `lib/utils/use-has-fine-pointer.ts`). Um iPad Pro a 1024px casava com
 *      a largura de desktop e por isso NAVEGAVA no toque — o oposto do
 *      pedido do dono ("no toque só a gaveta"). O nome da prop e o
 *      comportamento por trás dela (navega com ponteiro fino, abre a folha
 *      sem ele) não mudaram — só a PERGUNTA que decide qual dos dois é.
 *   2. Nova prop `bloqueiaBalaoNoToque` (ver a interface abaixo) fecha um
 *      defeito que já existia mesmo sem a troca de predicado acima: Safari e
 *      Chrome em toque disparam um `mousemove` SINTÉTICO antes do `click`, e
 *      nada neste arquivo distinguia esse sintético de um mouse de verdade —
 *      o balão (`<HoverCard>`) abria no toque, e como não existe
 *      `mouseleave` de um tap, ficava preso na tela por cima da folha que o
 *      `click` seguinte abre.
 */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// 🔴 `useRouter` mora AQUI, e não no wrapper eager (`NationalChoroplethMap.tsx`),
// de propósito — ver a docstring do topo deste arquivo e a do wrapper. Este
// módulo só existe atrás de `next/dynamic({ ssr: false })`, então este hook
// nunca é avaliado num render de servidor.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MapView } from "@/components/atoms/controls/MapViewToggle";
import {
  registerPmtilesProtocolOnce,
  resetPmtilesProtocol,
} from "@/components/atoms/maps/_pmtiles-protocol";
import { UF_BBOX, UF_NOMES } from "@/components/atoms/maps/_shared";
import { HoverCard, type HoverCardRow } from "@/components/atoms/overlays/HoverCard";
import { FILL_OPACITY, fillOpacityExpression, swingToColor } from "@/components/blocks/_swingRamp";
// 🔴 `ariaRessalvaVagas`/`margemSegundaVaga` vêm de `lib/utils/margem-senado`,
// e `ufHref` vem de `lib/utils/uf-href` — NÃO de `@/components/layout/UfPicker`.
// Este arquivo é o chunk lazy do MapLibre (RNF-007b, 14,7 KiB de margem no
// orçamento medido pelo `a11y-perf-auditor` em 18/09) e `UfPicker.tsx` é
// `"use client"` com `<UfPicker>`/`<UfPickerGrid>` no MESMO módulo
// (`<Button>`, `<Sheet>`, `next/link`). Um import em RUNTIME dali arriscaria
// puxar esse peso para dentro do chunk que menos tem margem. `type
// UfPickerCargo` abaixo é type-only (erasado na compilação) e não tem este
// custo — só os TRÊS valores de runtime precisam de módulo puro. Ver
// docstrings completas em `lib/utils/margem-senado.ts` e `lib/utils/uf-href.ts`.
import type { UfPickerCargo } from "@/components/layout/UfPicker";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { useHoverStore } from "@/lib/state/hover-store";
import type { ViewMode } from "@/lib/state/view-mode";
import { compete } from "@/lib/utils/destino-voto";
// (Nada de `@/lib/utils/cand-color` aqui desde 2026-09-20: nenhuma cor deste
// mapa deriva mais da COLOCAÇÃO do líder — ver `resolveColor` e
// `buildHoverRows` abaixo, e o topo de `components/blocks/_candidateColor.ts`.)
// 🔴 2026-09-20 — `computeHoverCardPlacement` substitui o proxy
// `x > rect.width / 2` (ver a docstring do módulo). Continua puro/sem DOM;
// quem MEDE o cartão de verdade é este arquivo (`cardSizeRef` +
// `useLayoutEffect` abaixo), nunca o `<HoverCard>` — ver
// `lib/utils/hover-card-placement.ts` § "Onde a medição mora".
import {
  computeHoverCardPlacement,
  HOVER_CARD_FALLBACK_SIZE,
} from "@/lib/utils/hover-card-placement";
import {
  liderIdPorBase,
  margemPorBase,
  ordenarTopCandidatosPorBase,
} from "@/lib/utils/lider-por-base";
import { ariaRessalvaVagas, margemSegundaVaga } from "@/lib/utils/margem-senado";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import {
  intensityLevelForMargin,
  partyChipInk,
  resolvePartyHex,
  textForParty,
} from "@/lib/utils/party-color";
import { ufHref } from "@/lib/utils/uf-href";

const PMTILES_BASE = "https://jbtu251tioj3y57z.public.blob.vercel-storage.com";

/** Bbox de Brasil usado pelo `fitBounds` inicial — mesmo valor de sempre,
 * agora nomeado porque `computeFrameCamera` (abaixo) também precisa dele. */
const BRAZIL_BOUNDS: [number, number, number, number] = [-73.99, -33.75, -28.84, 5.27];

export interface NationalChoroplethMapImplProps {
  rows: EdgeUfRow[];
  candidatoAId: number | null;
  view: MapView;
  /**
   * Mapping `candidato_id → rank nacional` (S05/F3B). Permite ao mapa
   * pintar UFs N-way em vez de binário (PT/PL): UF com líder rank 1 usa
   * `--color-cand-1`, rank 3 usa `--color-cand-3` (âmbar), etc. Rank > 6
   * cai em `--color-cand-other` (cinza). Construído na page a partir do
   * `national.candidatos[]` (1 lookup O(1) por UF).
   *
   * S07/Bloco 1: vira o fallback (ver `candidatos` abaixo) quando o
   * `partido` do líder é desconhecido.
   */
  rankByLider?: Record<number, number>;
  /**
   * Lista nacional de candidatos (S07/Bloco 1 — ADR-0024). Dirige a cor por
   * partido e o nome exibido no `<HoverCard>`. Ver docstring completa em
   * `NationalChoroplethMap.tsx`.
   */
  candidatos?: EdgeCandidate[];
  /**
   * Base de leitura do choropleth (ADR-0029 § 2). `"proj"` (default) pinta a
   * projeção; `"parcial"` pinta o apurado de agora. Não muda a requisição —
   * os dois números já vêm no mesmo `EdgeUfRow`.
   */
  viewMode?: ViewMode;
  /**
   * **RF-157 (spec 019)** — fase pré-eleição: as 27 UFs saem `--map-uncounted`,
   * em TODAS as seis combinações de `viewMode` × `view`.
   *
   * A guarda que já existia (`parcial && row.pct_apurado === 0`, mais abaixo)
   * **continua valendo e não é substituída** — esta prop ACRESCENTA uma. A
   * antiga cobre uma das seis combinações, e é exatamente por isso que ela não
   * resolve este caso: o default do controle é `proj` + `winner`, e nesse ramo
   * a cor sai de `top_candidatos[0]`, que num payload zerado é um candidato
   * qualquer com 0%. O leitor veria o Brasil inteiro pintado com a identidade
   * partidária de quem calhou de ser o primeiro item do array.
   *
   * Quem decide é o chamador — `PersistentMapFrame`, que é quem tem o payload
   * e quem chama `isPreEleicao` (`lib/config/fase.ts`).
   */
  preEleicao?: boolean;
  /** Número → px; string → qualquer comprimento CSS (ADR-0029 § 1). */
  height?: number | string;
  /**
   * Chamado no click/tap sobre uma UF (2026-09-08, decisão do usuário) — a
   * folha (`<StateResultSheet>`) é responsabilidade do wrapper
   * (`NationalChoroplethMap.tsx`), não deste arquivo. Este componente só
   * reporta a sigla selecionada.
   *
   * 2026-09-19: continua sendo o caminho de MOBILE. No desktop
   * (`navegarNoClique`, abaixo) o clique navega e este callback não é
   * chamado — a folha nunca abre porque `selectedSigla` nunca muda.
   */
  onSelectUf?: (sigla: string) => void;
  /**
   * O clique numa UF navega para a página daquele estado em vez de chamar
   * `onSelectUf` (2026-09-19, decisão do usuário, ADR-0050 — reverte a de
   * 08/09 só no desktop; ver a docstring do topo do arquivo).
   *
   * **Default `false` de propósito**: o comportamento vigente desde 08/09 (o
   * clique abre a folha) é o default, não um palpite. Quem liga isto é o
   * wrapper, e só quando a media query de desktop casa — nenhum outro caller
   * precisa saber que esta prop existe.
   *
   * 🔴 Lida de uma REF dentro do handler de clique, nunca de closure: o
   * efeito que registra o handler roda UMA vez, na montagem, e o wrapper
   * começa com `false` (o `matchMedia` só resolve no `useEffect` dele). Uma
   * closure congelaria esse `false` inicial e o desktop nunca navegaria.
   */
  navegarNoClique?: boolean;
  /**
   * Bloqueia o balão do `mousemove` (2026-09-20, pedido do dono: "no toque só
   * a gaveta"). **Default `false` de propósito**: preserva o comportamento
   * histórico (balão sempre abre no `mousemove`) para todo caller que não
   * conhece esta prop — em especial os testes que montam este impl
   * DIRETAMENTE (sem passar pelo wrapper), que são a maioria da suíte de
   * hover deste arquivo.
   *
   * Quem liga é `NationalChoroplethMap.tsx`, e só quando
   * `useHasFinePointer()` resolve `false` — ou seja, exatamente quando o
   * aparelho NÃO tem mouse/trackpad, largura da tela à parte (ver a
   * docstring de `useHasFinePointer`, `lib/utils/use-has-fine-pointer.ts`,
   * para o argumento completo de por que largura era o predicado errado).
   *
   * **Por que existe**: Safari e Chrome em aparelhos de toque emitem um
   * `mousemove` SINTÉTICO imediatamente ANTES do `click` — a premissa
   * contrária ("em touch não há mousemove antes do tap") estava cravada no
   * comentário do handler de clique logo abaixo, e era falsa. Sem esta
   * guarda, esse `mousemove` sintético chamava `setTooltip` e abria o
   * `<HoverCard>`; como `mouseleave` nunca dispara em toque (não existe
   * "sair" de um tap), o balão ficava preso na tela, por cima da
   * `<StateResultSheet>` que o `click` seguinte abre via `onSelectUf`.
   *
   * **O que NÃO bloqueia**: o caminho de TECLADO (`siglaFocoTabela`, efeito
   * abaixo) — foco não é toque, e WCAG SC 1.4.13 (entregue 2026-09-20, ver a
   * docstring daquele efeito) exige que o balão continue alcançável sem
   * ponteiro nenhum. Esta prop só existe dentro do `onMouseMove`.
   *
   * Lida de uma REF, nunca de closure — mesmo motivo de `navegarNoCliqueRef`
   * logo abaixo: o handler é registrado uma vez, na montagem, e o wrapper
   * pode ligar/desligar isto depois (media query mudando de `pointer: fine`
   * para `pointer: coarse` num aparelho híbrido).
   */
  bloqueiaBalaoNoToque?: boolean;
  /**
   * Qual corrida este mapa mostra (2026-09-18; estendido a `"sen"` em
   * 2026-09-18) — hoje só decide o alvo do `aria-describedby` (ver o atributo
   * logo abaixo). Default `"pres"`: o único caller anterior a esta prop
   * (`NationalMapBlock` na trilha Presidente) nunca a passava, e "pres" é
   * exatamente o comportamento que ele sempre teve — não é um palpite novo, é
   * o valor que já estava cravado no código antes de virar prop.
   */
  cargo?: UfPickerCargo;
}

interface TooltipState {
  x: number;
  y: number;
  /** Vira o cartão pra esquerda quando o ponteiro está na metade direita do mapa. */
  flip: boolean;
  /**
   * Vira o cartão pra CIMA quando o ponteiro está na metade de baixo do mapa
   * (2026-09-19). **Obrigatório, não opcional**: um `setTooltip` que esqueça
   * o campo tem de ser erro de compilação, não `undefined` silencioso
   * chegando ao `<HoverCard>` e caindo no default `false` — que é
   * exatamente o comportamento defeituoso que este campo existe para
   * corrigir. Mesma razão para `flip` nunca ter sido opcional aqui.
   */
  flipY: boolean;
  sigla: string;
  row: EdgeUfRow;
}

/** Lê token CSS do :root em runtime (seguro só no cliente). */
function getCssVar(name: string): string {
  if (typeof window === "undefined") return "#e1e4e8";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Throttle helper — evita flood de eventos mousemove (mesmo padrão de ChoroplethMapUF.tsx). */
function throttle<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  }) as T;
}

/**
 * "Nome por extenso (SIGLA)" para o título do `<HoverCard>` (2026-09-18,
 * pedido do dono — coluna 1 das sete: "Nome do Estado (Sigla)"). `UF_NOMES`
 * vem de `components/atoms/maps/_shared.ts` — a MESMA tabela que
 * `<UfPicker>` usa; não é uma quarta cópia (ver o comentário de
 * `UF_NOMES` sobre as outras duas em `StateResultSheet.tsx`/
 * `GovernorCard.tsx`, nenhuma das quais este arquivo importa). Sigla
 * desconhecida (não deveria acontecer — vem de `SIGLA_UF` do próprio
 * PMTiles) cai na sigla nua, nunca quebra o balão por um nome ausente.
 */
function ufTitleFor(sigla: string): string {
  const nome = UF_NOMES[sigla];
  return nome ? `${nome} (${sigla})` : sigla;
}

/**
 * Resolve a cor de uma UF por view. S07/Bloco 1 (ADR-0024): quando o
 * `partido` do líder tem token próprio (`partidoIsMapped`), a identidade
 * vem do partido (`resolvePartyHex`) nas views "quem lidera"
 * (winner/margin/turnout) — e desde 2026-09-20 vem SÓ do partido: sem sigla
 * mapeada (o caso real é federação) a UF recebe `PARTY_FALLBACK_HEX`, estável,
 * em vez do desvio antigo para `cand-color.ts`, que a pintava pela COLOCAÇÃO
 * do líder e a fazia trocar de cor a cada ciclo (constituição § 2).
 *
 * ⚠️ `_rankByLider` ficou **vestigial** aqui e em {@link buildHoverRows}: nada
 * mais deriva cor de rank neste arquivo. A `prop` pública `rankByLider` (e a
 * cadeia de refs que a acompanha) só não foi removida junto porque isso muda a
 * API de `<NationalChoroplethMap>` e dos seus callers — limpeza recomendada,
 * fora do escopo desta correção.
 */
function resolveColor(
  row: EdgeUfRow,
  view: MapView,
  _rankByLider: Record<number, number> | undefined,
  candidatosById: Map<number, EdgeCandidate>,
  viewMode: ViewMode = "proj",
  preEleicao = false,
  cargo: UfPickerCargo = "pres",
): string {
  // 🔴 RF-157 — PRIMEIRA LINHA, e a posição é o requisito.
  //
  // Antes do `switch`, antes de ler `viewMode` e antes da linha que resolve
  // `liderId` a partir de `top_candidatos[0]`. Se esta guarda ficasse depois do
  // `switch`, três dos quatro casos já teriam lido a identidade do "líder" de
  // uma corrida que não começou, e um refactor futuro que reordenasse os ramos
  // reintroduziria a cor sem tocar nela — que é precisamente como a guarda de
  // zero logo abaixo acabou dentro do ramo `parcial`, cobrindo uma das seis
  // combinações e sumindo nas outras cinco.
  if (preEleicao) return getCssVar("--map-uncounted") || "#e1e4e8";
  const parcial = viewMode === "parcial";
  // Em "Parcial" a UF sem nenhum boletim não tem líder apurado — pintar o
  // líder projetado sob o rótulo "parcial" seria mostrar um número de outro
  // universo. `--map-uncounted` é a resposta honesta (mesma cor do fallback
  // de UF sem row).
  if (parcial && row.pct_apurado === 0) return getCssVar("--map-uncounted") || "#e1e4e8";
  // 🔴 2026-09-20 — `liderIdPorBase`, e NÃO mais `parcial ? row.lider : ...`.
  //
  // O ternário antigo dizia respeitar a base (comentário removido: "`row.lider`
  // é o líder APURADO, `top_candidatos[0]` é o topo por `pct_projetado`"), mas
  // media a coisa errada: `api/model/project.py` constrói `row.lider` E
  // `top_candidatos[0].id` a partir do MESMO `ordered[0]` — a lista ordenada
  // por `pct_projetado` desc (linhas ~5033–5266). Os dois braços do ternário
  // avaliavam para o MESMO candidato em TODO caso; a cor nunca de fato mudava
  // de partido ao trocar Parcial/Projeção (fora do `return` de zero apurado
  // logo acima). `liderIdPorBase` (`lib/utils/lider-por-base.ts`, docstring
  // completa lá) deriva o líder parcial de verdade, reordenando
  // `top_candidatos` por `pct_atual` com o MESMO comparador de
  // `rankByParcial` — o ponto único que `buildHoverRows`, mais abaixo, também
  // usa. É o que mantém a cor do estado e a ordem do balão CONCORDANDO na
  // mesma base — a falta disso é o defeito CAIADO de 19/09.
  const liderId = liderIdPorBase(row, viewMode);
  // 🔴 RF-104 — em Senado (2 vagas) a margem que decide a corrida é a do 2º
  // para o 3º, não a de `row.margem_atual`/`row.margem_projetada` (sempre
  // 1º−2º). Sem esta troca, a view "margin" pintaria uma UF como "decidida"
  // (alta intensidade) exatamente quando a disputa pela 2ª vaga está viva —
  // o problema que RF-104 existe para prevenir, só que na COR em vez do
  // texto.
  //
  // As duas bases (`parcial`/`proj`) usam a MESMA conta em Senado, e isso não
  // é uma simplificação — é o teto do dado disponível: `top_candidatos[].pct`
  // é SEMPRE `pct_projetado` (nunca por-candidato "atual", ver docstring de
  // `buildHoverRows` acima), então não há como medir uma margem de 2º→3º
  // "apurada" sem um campo novo em `api/model/project.py`. `margemSegundaVaga`
  // devolve `NaN` com menos de 3 candidatos no top-3 (UF ainda sem dado
  // suficiente) — `intensityLevelForMargin`/`marginToRankColor` já tratam
  // `NaN` como "sem margem confiável", nunca como zero.
  // 🔴 2026-09-20 — `margemPorBase`, e NÃO `parcial ? row.margem_atual : ...`.
  //
  // Segundo braço do MESMO achado que trocou `liderId` acima:
  // `api/model/project.py:5267-5268` grava `margem_atual` e `margem_projetada`
  // com a MESMA variável, calculada sobre `pct_projetado`. O ternário antigo
  // tinha os dois braços idênticos em todo payload — enquanto a MATIZ do mapa
  // nunca trocava de partido, a INTENSIDADE nunca trocava de número. As duas
  // metades da view "margin" eram cegas ao seletor, por motivos irmãos.
  //
  // `margemPorBase` deriva a margem parcial dos `pct_atual` por candidato (o
  // único apurado por-candidato que o payload publica) e degrada para a
  // projetada quando não há leitura completa — nunca inventa zero.
  const margem = cargo === "sen" ? margemSegundaVaga(row) : margemPorBase(row, viewMode);
  const partido = candidatosById.get(liderId)?.partido;
  switch (view) {
    case "winner":
      // Identidade pura (sem gradiente de margem) — `resolvePartyHex` sem
      // `nivel` resolve `--party-<slug>`, que por construção do gerador
      // (scripts/gen-party-scale.ts) é o mesmo hex do nível 4.
      //
      // 🔴 2026-09-20 — sem desvio de rank. `resolvePartyHex` já devolve
      // `PARTY_FALLBACK_HEX` para sigla ausente, desconhecida ou de FEDERAÇÃO,
      // que é o caso real deste caminho. O desvio antigo
      // (`useParty ? … : resolveCandHex(rank)`) pintava a UF pela COLOCAÇÃO do
      // líder — e como o rank não é congelado em lugar nenhum, uma federação
      // que subisse um lugar trocava a cor do estado entre dois ciclos
      // (constituição § 2). Mesma correção de `_candidateColor.ts`; manter as
      // duas em pé é o que impede o estado de sair de uma cor no mapa e de
      // outra na lista ao lado — o defeito CAIADO de 19/09.
      return resolvePartyHex(partido);
    case "margin":
      // ⚠️ **Achado medido em 2026-09-20, NÃO consertado aqui** — o nível 1
      // desta rampa colide com `--map-uncounted` (#e1e4e8), que é a cor de
      // "sem dado" nesta MESMA view. Medido em ΔE76 no tema claro:
      // `--party-outros-1` (#e2e2e2) fica a **2,39** do neutro de ausência —
      // abaixo do limiar de percepção —, e **15 dos 31** tokens de nível 1
      // ficam abaixo de 10 (o pior partido real é `--party-dc-1`, a 7,44).
      // Ou seja: uma UF em empate técnico e uma UF que não publicou nada
      // podem sair do mesmo tom, e a decisão do dono de 14/09 ("não começou /
      // não sabemos / apurando são TRÊS estados") pede que não saiam.
      //
      // Não é regressão desta correção em geral — a colisão já valia para
      // metade da paleta —, mas o caso `outros` PIOROU: antes ele não entrava
      // na rampa, caía em `--color-tossup` (#d9d9d9), a 4,43 do neutro. A
      // saída não é escolher outro cinza por conta própria: o piso de
      // separação é gate do ADR-0031 (`PARTY_SEPARATION_FLOOR = 12`), que hoje
      // mede a paleta contra ela mesma e **não** contra `--map-uncounted`.
      // Estender esse gate — ou resolver por ausência de preenchimento, como
      // o case "swing" logo abaixo já faz — é trabalho de `map-builder`.
      return resolvePartyHex(partido, intensityLevelForMargin(margem));
    case "swing":
      // 🔴 O `?? 0` daqui pintava "SEM COMPARAÇÃO" com a cor de "NÃO MUDOU".
      // Enquanto `swing_vs_2022` era `None` em toda UF isso era inofensivo —
      // o mapa inteiro era neutro. A partir do commit que ligou o número real
      // os dois estados convivem na mesma tela, e viraram indistinguíveis:
      // exatamente o erro que a decisão do dono de 14/09 já nomeia ("não
      // começou / não sabemos / apurando são TRÊS estados").
      //
      // A cor devolvida aqui para `null` é irrelevante: `applyOpacity` abaixo
      // zera o preenchimento dessas UFs, e elas ficam como CONTORNO VAZIO. Foi
      // a única saída — medido em ΔE76, nenhum token da paleta fica a 10 do
      // neutro da rampa (`--map-uncounted` × `--color-tossup` = 4,4 no claro e
      // 6,8 no escuro). "Sem comparação" não cabia em cor; cabe em ausência.
      return row.swing_vs_2022 === null
        ? getCssVar("--map-uncounted")
        : swingToColor(row.swing_vs_2022, getCssVar);
    case "turnout":
      if (row.pct_apurado === 0) return getCssVar("--color-tossup");
      // 🔴 2026-09-20 — idem. A intensidade continua vindo do apurado (é a
      // semântica desta view), mas a matiz vem da sigla nos dois casos, e não
      // do rank no caso não mapeado.
      return resolvePartyHex(partido, row.pct_apurado >= 80 ? 5 : 2);
  }
}

/**
 * Aplica cores via expression `["match", ["get", "SIGLA_UF"], ...]` em vez de
 * `setFeatureState`. Razão: tippecanoe gera IDs numéricos sequenciais por
 * default — `setFeatureState({ id: "SP" })` não casa com feature id numérico
 * (e nosso PMTiles foi gerado assim). Match por property `SIGLA_UF` é robusto
 * independente do feature id. Custo: rebuild de expression a cada mudança de
 * view (27 entries — trivial).
 *
 * Fallback da expression (UF sem row, ou payload vazio antes do 1º load) usa
 * `--map-uncounted` (S07/Bloco 1) — era `--color-tossup` (semântica errada:
 * "empate técnico" não é o mesmo que "sem apuração/sem dado").
 */
function applyColors(
  map: maplibregl.Map,
  rows: EdgeUfRow[],
  view: MapView,
  rankByLider: Record<number, number> | undefined,
  candidatosById: Map<number, EdgeCandidate>,
  viewMode: ViewMode = "proj",
  preEleicao = false,
  cargo: UfPickerCargo = "pres",
) {
  if (rows.length === 0) return;
  const fallback = getCssVar("--map-uncounted") || "#e1e4e8";
  // ["match", ["get", "SIGLA_UF"], "SP", "#...", "RJ", "#...", ..., fallback]
  const expression: (string | number | unknown[])[] = ["match", ["get", "SIGLA_UF"]];
  for (const row of rows) {
    expression.push(
      row.sigla,
      resolveColor(row, view, rankByLider, candidatosById, viewMode, preEleicao, cargo),
    );
  }
  expression.push(fallback);
  map.setPaintProperty("ufs-fill", "fill-color", expression as unknown as string);
  map.setPaintProperty(
    "ufs-fill",
    "fill-opacity",
    fillOpacityExpression(view, rows) as unknown as string,
  );
}

/**
 * Linhas do `<HoverCard>` — um candidato do top-3 por UF (`EdgeUfRow.top_candidatos`).
 *
 * `proj` é real: `top_candidatos[].pct` é literalmente `pct_projetado` por
 * candidato (ver docstring do campo em `lib/edge-config/types.ts`).
 *
 * 🔴 2026-09-18 (pedido do dono — balão estilo NYT): `pct`/`votos` também
 * passam a ser reais, de `top_candidatos[].pct_atual`/`.votos_atuais`
 * (`api/model/project.py`, mesmo dia). Até aqui `pct` era SEMPRE
 * `Number.NaN` — o payload só tinha parcial agregada por UF
 * (`row.pct_apurado`), nunca por candidato; `row.margem_atual` dava só a
 * distância líder↔2º, não o share de cada um (que em corrida N-way não soma
 * 100 entre os dois primeiros), então inventar uma fração dali mostraria
 * número errado. Os dois campos novos são OPCIONAIS (payload pré-migração,
 * ou UF imputada do nacional sem `pct_atual` por candidato — ver docstring
 * do campo): `undefined` passa direto para `HoverCardRow`, que já trata
 * ausência como "—", nunca `0`.
 *
 * 🔴 **A identidade vem PRIMEIRO da própria linha (`tc`), nunca de
 * `candidatosById` como fonte primária.** `EdgeUfRow.top_candidatos[]` sabe de
 * que UF é (ADR-0042 item 3 / RF-144) e carrega `nome`/`partido`/`sqcand` já
 * resolvidos por ela em TODO cargo. `national.candidatos` (a origem de
 * `candidatosById`) não tem essa garantia: em cargo 3 (Governador) e 5
 * (Senador) aquele bloco é a UNIÃO de 27 corridas sob o mesmo espaço de `id`
 * (RF-145) — `id === 13` ali não é uma pessoa, é "o número 13 nalguma UF" — e
 * `api/model/project.py` (ver comentário lá) escreve um placeholder
 * (`"Candidato {id}"`) em `national.candidatos[].nome` fora do cargo 1.
 * Resolver o nome por `candidatosById` como PRIMEIRA fonte faria o balão do
 * mapa de Governador dizer "Candidato 13" com o nome real disponível ao lado,
 * em `tc.nome` — e o teste `NationalChoroplethMap.hoverIdentidadePorUf.test.tsx`
 * é quem grita se isso regredir.
 *
 * `candidatosById` continua como FALLBACK — necessário para payloads
 * pré-ADR-0042 (ex. `tests/fixtures/edge-config/gov-current.json`, onde
 * `top_candidatos` só tem `id`+`pct`) e para Presidente antes desta safra de
 * payloads, onde o nome só existia no bloco nacional.
 *
 * 🔴 **Tratamento de "vencedor" (fundo cheio + ✓) é sobre a IDENTIDADE do
 * líder PROJETADO, nunca sobre a posição 0 da lista exibida.** `row.chamada`
 * é calculado no produtor a partir da margem PROJETADA
 * (`api/model/project.py`, `chamada = margem > 10.0`, onde `margem` vem de
 * `pct_projetado`) — é uma leitura do MODELO, não do apurado. Até
 * 2026-09-20 isto colava com "índice 0" porque o balão só existia numa ordem
 * (a de projeção); agora que `ordenados` pode vir em ordem PARCIAL (ver
 * `viewMode` abaixo), o líder projetado pode estar em qualquer posição da
 * lista exibida, e o ✓ tem que segui-lo — nunca a linha do topo. `liderProjId`
 * fixa essa identidade ANTES de reordenar. Sem esta correção, alternar para
 * "Parcial" moveria o ✓ para quem quer que a apuração esteja favorecendo
 * agora — inventando uma "chamada" que o modelo nunca fez. Mesmo assim,
 * `isCalledWinner` marca no máximo UMA linha (`tc.id === liderProjId` só é
 * verdadeiro pra um `id`): a constituição § 1 continua proibindo publicar como
 * decidido o que não foi (2º e 3º colocados). O par (fundo, tinta) é resolvido
 * AQUI, não em `<HoverCard>`: o átomo não conhece partido (teste (h) de
 * `HoverCard.test.tsx`) — `partyChipInk` já vem com o contraste medido
 * (≥4,5:1, docstring dele), inclusive para o par de `outros`.
 *
 * 🔴 **2026-09-20 — `viewMode` reordena as linhas (pedido do dono: "reordenar
 * a posição dos candidatos conforme o seletor").** `ordenarTopCandidatosPorBase`
 * (`lib/utils/lider-por-base.ts`) é o MESMO ponto único que `resolveColor`
 * usa para escolher a cor do estado — reaproveitado aqui, não duplicado, para
 * que a cor do estado e a ordem do balão NUNCA discordem sobre quem lidera
 * (o defeito CAIADO de 19/09 era exatamente essa discordância entre duas
 * superfícies vizinhas). Em `"proj"`, ou quando falta `pct_atual` em algum
 * candidato do corte (`usouParcial === false` — ver a docstring daquela
 * função), a ordem é a mesma de sempre (a de `top_candidatos`, por
 * `pct_projetado`).
 *
 * ⚠️ `_rankByLider` é vestigial — ver {@link resolveColor}.
 */
function buildHoverRows(
  row: EdgeUfRow,
  candidatosById: Map<number, EdgeCandidate>,
  _rankByLider: Record<number, number> | undefined,
  viewMode: ViewMode = "proj",
): HoverCardRow[] {
  const { ordenados } = ordenarTopCandidatosPorBase(row.top_candidatos, viewMode);
  // Ver o comentário grande acima: o ✓ segue a IDENTIDADE do líder projetado,
  // não a posição 0 pós-reordenação.
  //
  // ADR-0053 / RF-213 — o 1º do corte QUE COMPETE, nunca `top_candidatos[0]`
  // cru: o corte chega por `pct_projetado` sobre `vvc`, e uma anulada pode
  // estar no topo dele. O modelo nunca a chama (`chamada` já a exclui), mas
  // sem o filtro o ✓ não cairia em ninguém — ou, pior, na anulada.
  const liderProjId = row.top_candidatos.find(compete)?.id ?? row.lider;
  const linhas: HoverCardRow[] = ordenados.map((tc) => {
    const cand = candidatosById.get(tc.id);
    const nomeBruto = tc.nome ?? cand?.nome;
    const partido = tc.partido ?? cand?.partido;
    const sqcand = tc.sqcand ?? cand?.sqcand;
    const isCalledWinner = tc.id === liderProjId && row.chamada === true;
    // 🔴 2026-09-20 — `partyChipInk` sem desvio de rank. Ele já devolve o par
    // MEDIDO de `outros` (`--party-outros-chip` / `--party-outros-ink`) para
    // sigla ausente, desconhecida ou de federação; o desvio antigo caía em
    // `strongForRank(rank)` + `--text-inverse`, um par escolhido pela COLOCAÇÃO
    // e cujo contraste ninguém mediu para este caso.
    const winnerPair = isCalledWinner ? partyChipInk(partido) : undefined;
    return {
      // `HoverCardRow.name` é string e o tooltip não tem como voltar ao
      // candidato: o nome de exibição sai daqui, senão o balão do mapa diria
      // "RONALDO CAIADO" e o painel ao lado, "CAIADO", sobre o mesmo estado.
      name: nomeBruto ? nomeExibicao(nomeBruto, sqcand) : `#${tc.id}`,
      // RNF-035 / WCAG SC 1.4.11 — `textForParty`, não `colorForParty`.
      // Este `color` vira um quadradinho de 8×8 no `<HoverCard>`
      // (`components/atoms/overlays/HoverCard.tsx`): marcador de
      // IDENTIDADE, sem extensão a perder, então o remédio é a variante
      // legível e não o contorno. Mesma decisão do ADR-0047 D1 para a linha do
      // gráfico — e é o que mantém a MESMA cor para o mesmo partido nos dois
      // lugares da tela.
      //
      // Medido em 18/09 no tema claro: PSOL 2,08 · PSB 2,19 · outros 2,39 ·
      // NOVO 2,72 contra o piso de 3:1. A variante `-text` passa nas 4
      // superfícies e nos 2 temas para os 31 partidos, e em 17 deles ELA É a
      // cor base — a maioria dos estados não muda um pixel.
      //
      // 🔴 2026-09-20 — sem desvio de rank: `textForParty` já resolve sigla
      // ausente, desconhecida ou de federação para `--party-outros-text`. É a
      // MESMA regra de `candidateMarkerColor` em `_candidateColor.ts`, e é o
      // que mantém o ponto do balão igual ao ponto da lista para a mesma
      // candidatura — inclusive federação, que era justamente quem caía no
      // rank e trocava de cor entre dois ciclos.
      color: textForParty(partido),
      // % de votos válidos APURADOS deste candidato — real desde 2026-09-18
      // (ver docstring acima). Ausente ⇒ `<HoverCard>` mostra "—", nunca 0.
      pct: tc.pct_atual,
      proj: tc.pct,
      partido,
      votos: tc.votos_atuais,
      winnerBackground: winnerPair?.background,
      winnerInk: winnerPair?.ink,
      // ADR-0053 — etiqueta "Anulado"/"Sub judice" no balão. A ORDEM (anulada
      // no fim, antes de "Outros") já vem de `ordenarTopCandidatosPorBase`.
      ...(tc.destino ? { destino: tc.destino } : {}),
    };
  });

  // 🔴 **A linha "Outros"** (2026-09-19, pedido do dono). `row.outros` é o
  // agregado de TODAS as candidaturas fora de `top_candidatos` — somado no
  // produtor (`api/model/project.py`), candidato a candidato, NUNCA aqui e
  // nunca como `100 − Σ(top 4)` (ver a docstring do campo em
  // `lib/edge-config/types.ts`: os pontos de uma UF não fecham em 100, e a
  // subtração publicaria o resíduo de fechamento como se fosse voto de
  // alguém).
  //
  // **Ausente ⇒ nenhuma linha.** Campo faltando significa "a cauda é vazia"
  // (UF com ≤ 4 candidaturas no cargo), não "os demais somam zero" — escrever
  // "Outros 0,0%" numa corrida de três seria uma linha falsa.
  const outros = row.outros;
  if (outros) {
    linhas.push({
      kind: "outros",
      // `n_candidatos` é a razão de este agregado não caber dentro de
      // `top_candidatos[]`: candidatura nenhuma tem esse campo.
      name: `Outros (${outros.n_candidatos})`,
      // Sem `color` e sem `partido`: o agregado junta partidos de cores
      // diferentes e não tem identidade própria. O `<HoverCard>` põe um
      // espaçador invisível no lugar do ponto de 8×8 — ver lá.
      //
      // 🔴 **Os nomes de `pct` são TROCADOS entre o payload e o componente, e
      // este é o cruzamento mais fácil de errar deste arquivo.** No payload
      // (`EdgeUfRow`), `pct` é a PROJEÇÃO e `pct_atual` é a PARCIAL. No
      // `HoverCardRow`, é o contrário: `pct` é a PARCIAL e `proj` é a
      // PROJEÇÃO. As quatro linhas acima já fazem exatamente este cruzamento
      // (`pct: tc.pct_atual` / `proj: tc.pct`); esta o repete. Trocar os dois
      // aqui mostraria a projeção sob o rótulo "Parcial" — número plausível,
      // em coluna errada, sem nenhum sintoma visual.
      pct: outros.pct_atual,
      proj: outros.pct,
      votos: outros.votos_atuais,
    });
  }
  return linhas;
}

/**
 * Prazo pra `map.isStyleLoaded()` virar `true` antes de tratarmos o mapa
 * como travado e acionar o self-heal (`resetPmtilesProtocol`). 10s é
 * generoso pra um fetch de header de ~500KB (ufs.pmtiles) mesmo em rede
 * ruim — ver docstring de `_pmtiles-protocol.ts` pra causa raiz.
 */
const STYLE_LOAD_TIMEOUT_MS = 10_000;

/**
 * `minZoom` do próprio `ufs.pmtiles`, medido direto do header do arquivo
 * (`new PMTiles(url).getHeader()`, ver relatório do map-builder de
 * 2026-09-14) — não é o `minZoom` do `<Map>` (que não configuramos, fica no
 * default 0), é o do DATASET vetorial. Abaixo dele o MapLibre não pede
 * NENHUM tile — zero requisição, zero evento `error`, zero log — e o canvas
 * fica em branco pra sempre, do tamanho certo, sem nenhum sinal de que algo
 * deu errado. Confirmado empiricamente: `zoom=1.99` não desenha nada e não
 * busca tile nenhum; `zoom=2.00` busca e desenha o país inteiro.
 *
 * É um segundo fundo de poço, mais raso que "padding maior que o container"
 * (que o `Math.min` abaixo já evita): mesmo um padding que cabe folgado
 * dentro do container pode empurrar o zoom do `fitBounds` pra baixo desse
 * piso, porque o Brasil é ALTO em graus de latitude (a dimensão que mais
 * limita o zoom aqui, medido: a container mobile de ~467px de altura com o
 * cabeçalho de 3 linhas + a legenda de 3 candidatos consumindo ~250px de
 * padding vertical já é o suficiente pra cruzar essa linha).
 */
const UFS_PMTILES_MIN_ZOOM = 2;

/** Folga acima do piso — absorve a diferença entre o `cameraForBounds` daqui
 * e o `fitBounds` real do MapLibre (mesma fonte, mas funções diferentes; a
 * folga cobre arredondamento, não incerteza grande). */
const ZOOM_SAFETY_MARGIN = 0.15;

/** Fração de encolhimento por rodada do laço de segurança abaixo. */
const PADDING_SHRINK_FACTOR = 0.85;

/** Limite de rodadas do laço — cálculo puro e síncrono (`cameraForBounds` não
 * toca rede nem layout), 20 rodadas custa microssegundos e já é mais do que
 * o necessário: de padding cheio a zero o zoom sobe de ~1,68 pra ~2,74
 * (medido), e cada rodada aproxima geometricamente. */
const MAX_SHRINK_ROUNDS = 20;

interface FramePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Padding assimétrico inicial — dá lugar à moldura flutuante que fica POR
 * CIMA do mapa na variante `frame` (a que a home usa): a barra "Por vencedor
 * / Margem / Swing vs 2022 / % apurado" + "Escolher UF" no topo, e a
 * `<CandidateLegendGroup>` (até 3 rampas por candidato + 1 chave "sem
 * apuração") no canto inferior esquerdo. `padding: 20` uniforme (valor
 * antigo) não sabia da moldura: o Brasil inteiro era ajustado à área BRUTA do
 * container, e o norte ficava atrás da barra de abas, o sul (RS) encostava na
 * legenda, e o oeste (AC/AM) raspava a borda esquerda — medido pelo dono em
 * captura de 2026-09-14.
 *
 * Os números-teto vêm de medição real (Playwright, `section[aria-label="Mapa
 * coroplético do Brasil"]`, variante `frame`, larguras 375–1280px — ver
 * relatório do map-builder de 2026-09-14), não de chute:
 *   - topo: pior caso (<900px de largura de TELA — não deste container — o
 *     cabeçalho quebra em 3 linhas: rótulo, toggle de view, "Escolher UF")
 *     mede 142px do topo do container até o fim da 3ª linha. +18px de
 *     respiro → 160.
 *   - base: a legenda por candidato mede 87px de altura e começa a 108px do
 *     fundo do container em toda largura testada. +12px de respiro → 120.
 *   - laterais: nada flutua nas bordas esquerda/direita da variante `frame` —
 *     a folga aqui é só respiro visual, pra nenhuma UF raspar a moldura.
 *
 * 🔴 Armadilha relatada pelo dono: padding fixo maior que o container produz
 * bbox inválido no MapLibre e o mapa fica em branco, em silêncio. Por isso
 * cada lado começa como uma FRAÇÃO da dimensão correspondente DESTE
 * container (não da tela): `top+bottom` nunca passa de 70% da altura,
 * `left+right` nunca passa de 30% da largura, mesmo num container
 * patologicamente raso ou estreito — os 160/120/32 acima são o teto, não o
 * valor fixo. Isto sozinho evita o bbox inválido; NÃO evita cruzar o piso de
 * zoom do dataset (ver `computeFrameCamera` abaixo, que é quem de fato
 * decide o padding usado).
 */
function initialFramePadding(containerWidth: number, containerHeight: number): FramePadding {
  // Guarda defensiva: um container com 0×0 (ex. ainda não fez layout) não
  // deve produzir padding 0 — cairia na mesma degradação silenciosa que esta
  // função existe para evitar. 400 é o piso de altura já usado noutros
  // pontos do mapa (`NationalChoroplethMapImplProps.height` default).
  const w = containerWidth > 0 ? containerWidth : 400;
  const h = containerHeight > 0 ? containerHeight : 400;
  return {
    top: Math.min(160, h * 0.35),
    bottom: Math.min(120, h * 0.35),
    left: Math.min(32, w * 0.15),
    right: Math.min(32, w * 0.15),
  };
}

/** Centro/zoom de reserva — usado só se `cameraForBounds` devolver `undefined`
 * (bounds degenerado; não deve acontecer com o array fixo de Brasil, mas o
 * tipo do MapLibre é `CameraForBoundsResult | undefined`). Centro geométrico
 * do bbox de Brasil, zoom = o mesmo "zero padding" medido (ver docstring
 * acima da constante de piso). */
const FALLBACK_CAMERA = { center: [-51.415, -14.24] as [number, number], zoom: 3 };

/**
 * Decide o padding e a câmera (`center`/`zoom`) que o `fitBounds` inicial vai
 * usar. Parte do teto "moldura cheia" (`initialFramePadding`) e, SE o zoom
 * resultante cruzar o piso do dataset (`UFS_PMTILES_MIN_ZOOM`, ver acima),
 * encolhe o padding vertical em rodadas até o zoom voltar a ficar seguro.
 *
 * A troca é deliberada: num container baixo o bastante (medido: ~467px, o
 * caso real da variante `frame` <900px de tela), a moldura cheia (cabeçalho
 * de 3 linhas + legenda de 3 candidatos, ~250px) SOMADA ao Brasil no zoom
 * mínimo do dataset não cabe no mesmo espaço — as contas não fecham. Entre
 * "Brasil parcialmente atrás do cabeçalho/legenda" e "mapa inteiramente em
 * branco", a primeira é estritamente melhor: é a mesma filosofia de
 * degradação do resto do produto (ex. `resolveColor` — nunca uma UF sem cor,
 * mesmo que a cor seja o fallback).
 */
function computeFrameCamera(
  map: maplibregl.Map,
  bounds: maplibregl.LngLatBoundsLike,
  containerWidth: number,
  containerHeight: number,
): { center: maplibregl.LngLatLike; zoom: number } {
  const padding = initialFramePadding(containerWidth, containerHeight);
  let camera = map.cameraForBounds(bounds, { padding });
  for (
    let round = 0;
    round < MAX_SHRINK_ROUNDS &&
    (camera?.zoom == null || camera.zoom < UFS_PMTILES_MIN_ZOOM + ZOOM_SAFETY_MARGIN);
    round += 1
  ) {
    padding.top *= PADDING_SHRINK_FACTOR;
    padding.bottom *= PADDING_SHRINK_FACTOR;
    padding.left *= PADDING_SHRINK_FACTOR;
    padding.right *= PADDING_SHRINK_FACTOR;
    camera = map.cameraForBounds(bounds, { padding });
  }
  // `cameraForBounds` tipa `center`/`zoom` como opcionais (a assinatura serve
  // também pra bearing/pitch-only updates) — na prática, com `bounds` válido
  // (o array fixo de Brasil, nunca vazio/degenerado), os dois sempre vêm
  // preenchidos. O `?? FALLBACK` é só pro tipo, não um caminho esperado.
  return camera?.center != null && camera?.zoom != null
    ? { center: camera.center, zoom: camera.zoom }
    : FALLBACK_CAMERA;
}

export function NationalChoroplethMapImpl({
  rows,
  candidatoAId,
  view,
  rankByLider,
  candidatos,
  viewMode = "proj",
  preEleicao = false,
  height = 420,
  onSelectUf,
  navegarNoClique = false,
  bloqueiaBalaoNoToque = false,
  cargo = "pres",
}: NationalChoroplethMapImplProps) {
  const router = useRouter();
  // Backward-compat: caller pré-S05 só passa `candidatoAId`; sintetizamos um
  // rankByLider mínimo `{ [candidatoAId]: 1 }` pra manter o líder em
  // `--color-cand-1` (= --color-pt, mesmo hex). Líderes "diferentes" caem
  // em rank 99 → cor "other" (cinza). É degradação cuidadosa: melhor que
  // tudo cinza, ainda destaca o líder global.
  const effectiveRankByLider: Record<number, number> | undefined =
    rankByLider ?? (candidatoAId != null ? { [candidatoAId]: 1 } : undefined);
  // `id → EdgeCandidate` (nome + partido) — S07/Bloco 1. Memoizado: usado no
  // render (HoverCard) e nos efeitos abaixo; reconstruir só quando a lista
  // nacional de candidatos muda (não a cada mousemove).
  const candidatosById = useMemo(
    () => new Map((candidatos ?? []).map((c) => [c.id, c])),
    [candidatos],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  /**
   * 🔴 **2026-09-20** — envolve o `<HoverCard>` renderizado, só para o
   * `useLayoutEffect` abaixo conseguir medi-lo de verdade
   * (`getBoundingClientRect`). `display: "contents"` faz este `<div>` não
   * gerar caixa própria nenhuma — não participa do layout, não desloca nada
   * — só existe como um lugar de onde pegar `firstElementChild`. O
   * `<HoverCard>` em si não ganhou `ref`/`"use client"`/`useLayoutEffect`
   * nenhum: ver `lib/utils/hover-card-placement.ts` § "Onde a medição mora".
   */
  const hoverCardBoxRef = useRef<HTMLDivElement>(null);

  /**
   * Último tamanho REAL conhecido do cartão — atualizado só pelo
   * `useLayoutEffect` de medição (quando o CONTEÚDO do balão muda), nunca a
   * cada `mousemove`. `onMouseMove`/o efeito de foco da tabela leem este
   * `ref` para decidir `flip`/`flipY` em aritmética pura (sem tocar o DOM) a
   * cada movimento — é o que mantém os 60Hz do `mousemove` sem nenhum
   * `getBoundingClientRect` novo por frame.
   *
   * Nasce no fallback documentado (`HOVER_CARD_FALLBACK_SIZE`): o 1º hover
   * de cada sessão decide com uma estimativa, e o mesmo `useLayoutEffect` a
   * corrige ANTES do navegador pintar (mesmo frame) se tiver errado — ver a
   * docstring de `computeHoverCardPlacement`.
   */
  const cardSizeRef = useRef<{ width: number; height: number }>(HOVER_CARD_FALLBACK_SIZE);

  /**
   * 🔴 **Quem abriu o balão que está na tela** — `"map"` (ponteiro) ou
   * `"table"` (foco de teclado numa célula de `<StateGroupedTable>`).
   *
   * Existe por uma razão só, e ela é uma corrida real: o efeito de foco
   * (abaixo) fecha o balão quando a store deixa de apontar para uma UF vinda
   * da tabela. Sem esta marca, sair do foco da tabela **enquanto o ponteiro já
   * está sobre o mapa** apagaria o balão que o `mousemove` acabou de abrir —
   * o `mousemove` escreve `source: "map"` na store, o selector abaixo resolve
   * para `null`, e o efeito interpretaria isso como "a tabela pediu para
   * fechar". Com a marca, o efeito só fecha o que ele mesmo abriu.
   *
   * Ref e não estado: ninguém renderiza a partir daqui, e um `useState` extra
   * faria o componente re-renderizar a cada `mousemove` (throttled a 16ms).
   */
  const origemTooltipRef = useRef<"map" | "table" | null>(null);

  /**
   * A UF que a TABELA pediu para destacar, ou `null`.
   *
   * 🔴 **Selector fino, devolvendo uma string** — a regra do topo de
   * `lib/state/hover-store.ts`. Um selector que devolvesse `s.hovered` inteiro
   * re-renderizaria o mapa a cada emissão de qualquer entidade; este resolve
   * para o MESMO `null` durante todo o hover de ponteiro (`source === "map"`),
   * então o caminho do mouse não ganha nenhum render novo.
   *
   * O filtro por `source` também é o que impede o laço: este componente é
   * PRODUTOR da store (`setHovered(..., "map")` no `mousemove`). Consumir as
   * próprias emissões seria realimentação.
   */
  const siglaFocoTabela = useHoverStore((s) =>
    s.source === "table" && s.hovered?.type === "uf" ? s.hovered.sigla : null,
  );

  // Keep rows lookup fresh for tooltip without remounting map
  const rowsMapRef = useRef<Map<string, EdgeUfRow>>(new Map());
  useEffect(() => {
    rowsMapRef.current = new Map(rows.map((r) => [r.sigla, r]));
  }, [rows]);

  // Map init — runs once on mount. O efeito de re-color (rows/view/rankByLider)
  // mora abaixo e usa refs pro handler de `map.on("load")`, garantindo que o
  // mapa é "ilha React" e não remonta a cada mudança de prop.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    registerPmtilesProtocolOnce();

    // A11y RNF-026: respeita prefers-reduced-motion (constituição § 4).
    // Anula a transição de fill-color que anima trocas de view (winner→margin etc).
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fillTransition = prefersReducedMotion
      ? { duration: 0, delay: 0 }
      : { duration: 600, delay: 0 };

    let hangTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;

    // Self-heal (2026-09-09, ver `_pmtiles-protocol.ts`): pmtiles@4.4.1
    // cacheia pra sempre uma Promise de header/diretório que falhe ou nunca
    // assente, e o `Protocol` registrado por `registerPmtilesProtocolOnce`
    // vive pela sessão inteira da aba — uma única falha de rede na 1ª vez
    // que ALGUM mapa pediu `ufs.pmtiles` nessa aba trava esse mapa (e
    // qualquer outro que reuse a mesma URL) pra sempre, sem emitir `error`.
    // `mount()` é reentrante: se o estilo não carregar em
    // `STYLE_LOAD_TIMEOUT_MS`, descartamos o `Protocol` poluído e tentamos
    // de novo (uma única vez) com cache limpo.
    function mount(): maplibregl.Map {
      attempt += 1;
      // Medido no momento do mount — não antes (SSR não tem `container`) nem
      // via prop: o `height` que o pai passa pode ser string CSS (`"100%"`,
      // `clamp(...)`) e só o layout já resolvido sabe o valor em pixel real.
      const rect = container.getBoundingClientRect();
      const map = new maplibregl.Map({
        container,
        style: {
          version: 8,
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          sources: {
            ufs: {
              type: "vector",
              url: `pmtiles://${PMTILES_BASE}/ufs.pmtiles`,
            },
          },
          layers: [
            {
              id: "ufs-fill",
              type: "fill",
              source: "ufs",
              "source-layer": "ufs",
              paint: {
                // Cor inicial "sem apuração" (S07/Bloco 1: era --color-tossup,
                // semântica errada pro estado "ainda sem dado"); applyColors
                // substitui via setPaintProperty com expression
                // `["match", ["get", "SIGLA_UF"], ...]` assim que `rows` chega.
                "fill-color": getCssVar("--map-uncounted") || "#e1e4e8",
                "fill-color-transition": fillTransition,
                "fill-opacity": FILL_OPACITY,
              },
            },
            // RNF-035 (SC 1.4.11) — HALO, duas linhas, não uma.
            //
            // Uma UF é um "preenchimento com extensão" (RNF-035 § remédios): o
            // contorno é o remédio certo, não a variante `-text` — que nem
            // existe para os níveis de margem (`--party-<sigla>-1..5`, usados
            // pela view "margin"/"turnout") e QUEBRARIA a escala se existisse
            // (constituição § 2: só a intensidade varia com a margem — forçar
            // o nível 1, "disputa apertada", a escurecer destruiria o próprio
            // sinal que a escala existe para dar).
            //
            // Mas um contorno de UMA cor não fecha a conta: medido em 18/09,
            // `--map-stroke` sozinho (quase-papel) reprova 3:1 contra 62 dos
            // 155 tokens de nível no claro (e 93/155 no escuro) — exatamente os
            // níveis PÁLIDOS (1–2 claro, 1–3 escuro), que por definição da
            // escala ficam perto da própria luminância do papel. Trocar por um
            // contorno escuro (`--map-stroke-focus`) sozinho resolve os pálidos
            // e QUEBRA os saturados (8 a 21 dos 33 tokens-base a depender do
            // candidato testado) — os dois extremos de luminância não cabem
            // numa cor só.
            //
            // O HALO fecha: duas linhas, uma clara (`--map-stroke`, por baixo,
            // mais larga) e uma escura (`--map-stroke-focus`, por cima, mais
            // fina) — a técnica cartográfica padrão pra rótulo/traço sobre fundo
            // variável (ver `docs/mapas/acessibilidade.md`). Medido: das 186
            // combinações reais de preenchimento (33 bases + 155 níveis − tie/
            // none, que o mapa nunca pinta) em CADA tema, e também
            // `--map-uncounted`, `--color-tossup`, os 7 tokens `--color-cand-*`
            // e os 7 `--color-cand-band-*` (fallback pré-ADR-0024 por rank) —
            // ZERO ficam abaixo de 3:1 contra AS DUAS linhas ao mesmo tempo.
            // Sempre uma das duas alcança o piso.
            {
              id: "ufs-stroke-halo",
              type: "line",
              source: "ufs",
              "source-layer": "ufs",
              paint: {
                "line-color": getCssVar("--map-stroke") || "#fbfbfc",
                "line-width": 1.4,
              },
            },
            {
              id: "ufs-stroke",
              type: "line",
              source: "ufs",
              "source-layer": "ufs",
              paint: {
                "line-color": getCssVar("--map-stroke-focus") || "#14171b",
                "line-width": 0.6,
              },
            },
            {
              id: "ufs-stroke-hover",
              type: "line",
              source: "ufs",
              "source-layer": "ufs",
              paint: {
                "line-color": getCssVar("--map-stroke-focus") || "#14171b",
                "line-width": 2.5,
              },
              filter: ["==", "SIGLA_UF", ""],
            },
          ],
        },
        // `center`/`zoom` aqui são só o chute inicial — substituídos por
        // `map.jumpTo(camera)` logo abaixo, ainda no mesmo tick síncrono
        // (antes do 1º paint), então não há flash de enquadramento errado.
        // NÃO usamos `bounds`/`fitBoundsOptions` do construtor: aquele
        // caminho não tem como consultar `computeFrameCamera` antes de
        // decidir a câmera, e é exatamente essa consulta que evita o zoom
        // cruzar o piso silencioso do dataset (ver docstring de
        // `computeFrameCamera`).
        center: FALLBACK_CAMERA.center,
        zoom: FALLBACK_CAMERA.zoom,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        // UX: scroll do mouse na página NÃO deve dar zoom no mapa embedded —
        // usuário rolando vê página rolar, não mapa ampliar. Pinch em mobile
        // continua funcionando via touchZoom (default true).
        scrollZoom: false,
      });

      mapRef.current = map;
      map.jumpTo(computeFrameCamera(map, BRAZIL_BOUNDS, rect.width, rect.height));

      hangTimer = window.setTimeout(() => {
        if (cancelled || map.isStyleLoaded()) return;
        if (attempt >= 2) {
          console.error(
            "[NationalChoroplethMap] estilo pmtiles não carregou após retry — ver components/atoms/maps/_pmtiles-protocol.ts",
          );
          return;
        }
        console.warn(
          "[NationalChoroplethMap] estilo não carregou em " +
            `${STYLE_LOAD_TIMEOUT_MS}ms — reinicializando protocolo pmtiles (retry ${attempt})`,
        );
        resetPmtilesProtocol();
        map.remove();
        mount();
      }, STYLE_LOAD_TIMEOUT_MS);

      map.on("load", () => {
        window.clearTimeout(hangTimer);
        // Use latest refs at load time
        applyColors(
          map,
          Array.from(rowsMapRef.current.values()),
          viewRef.current,
          rankByLiderRef.current,
          candidatosByIdRef.current,
          viewModeRef.current,
          preEleicaoRef.current,
          cargoRef.current,
        );
      });

      // Hover: highlight + tooltip (RF-030.3) + brushing (hover-store producer,
      // `type: "uf"` — S07/Bloco 1). Throttle: mesmo padrão de ChoroplethMapUF.tsx.
      //
      // 🔴 2026-09-20 — `bloqueiaBalaoNoToqueRef` é a PRIMEIRA linha, de
      // propósito: Safari/Chrome em toque emitem este `mousemove` sintético
      // ANTES do `click`, e nada aqui embaixo (hover-store, filtro de traço,
      // `setTooltip`, cursor) deve rodar nesse caminho — ver a docstring da
      // prop `bloqueiaBalaoNoToque` na interface acima para o porquê completo
      // (inclui por que `mouseleave`, mais abaixo, NUNCA limparia isto
      // sozinho em toque).
      const onMouseMove = throttle(
        (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (bloqueiaBalaoNoToqueRef.current) return;
          const feature = e.features?.[0];
          if (!feature) return;
          const sigla = feature.properties?.SIGLA_UF as string | undefined;
          if (!sigla) return;

          useHoverStore.getState().setHovered({ type: "uf", sigla }, "map");
          map.setFilter("ufs-stroke-hover", ["==", "SIGLA_UF", sigla]);
          const row = rowsMapRef.current.get(sigla);
          if (row) {
            // Quem abriu o balão que está na tela agora. Ver `origemTooltipRef`.
            origemTooltipRef.current = "map";
            const rect = container.getBoundingClientRect();
            const x = e.originalEvent.clientX - rect.left;
            const y = e.originalEvent.clientY - rect.top;
            // 🔴 2026-09-20 — `computeHoverCardPlacement` troca o proxy
            // "passou da metade do contêiner?" por "o cartão, do tamanho que
            // ele TEM (`cardSizeRef`, medido de verdade pelo
            // `useLayoutEffect` abaixo — nunca o `<HoverCard>` se
            // medindo), cabe daqui até a borda?". Aritmética pura, sem
            // `getBoundingClientRect` do cartão neste handler — só do
            // `container`, que já era lido aqui antes. Ver
            // `lib/utils/hover-card-placement.ts` para o defeito medido (RS
            // a 1024px de janela) que este cálculo substitui.
            const placement = computeHoverCardPlacement({
              x,
              y,
              containerWidth: rect.width,
              containerHeight: rect.height,
              cardWidth: cardSizeRef.current.width,
              cardHeight: cardSizeRef.current.height,
            });
            setTooltip({
              x: placement.x,
              y: placement.y,
              flip: placement.flip,
              flipY: placement.flipY,
              sigla,
              row,
            });
          }
          map.getCanvas().style.cursor = "pointer";
        },
        16,
      );
      map.on("mousemove", "ufs-fill", onMouseMove);

      map.on("mouseleave", "ufs-fill", () => {
        useHoverStore.getState().clear();
        map.setFilter("ufs-stroke-hover", ["==", "SIGLA_UF", ""]);
        origemTooltipRef.current = null;
        setTooltip(null);
        map.getCanvas().style.cursor = "";
      });

      // Click (RF-030.3) — dois destinos, ver a docstring do topo do arquivo:
      // com PONTEIRO FINO navega para a página do estado (decisão
      // 2026-09-19, predicado corrigido 2026-09-20); sem ele (toque) abre a
      // folha de resumo via `onSelectUf` (decisão 2026-09-08). Emite pro
      // hover-store nos dois casos (mesmo padrão de tap-to-select do
      // ChoroplethMapUF.tsx).
      //
      // 🔴 2026-09-20 — correção de premissa: este comentário afirmava "em
      // touch não há mousemove antes do tap". É FALSO — Safari e Chrome
      // disparam um `mousemove` sintético imediatamente antes do `click` em
      // qualquer aparelho de toque (é esse sintético que abria o balão por
      // cima da gaveta antes da guarda `bloqueiaBalaoNoToque`, acima). O que
      // é verdade, e o que de fato importa aqui, é mais simples: com ou sem
      // esse sintético, a UF sob o dedo/ponteiro no momento do `click` é a
      // mesma que este handler lê de `e.features` — a emissão ao hover-store
      // não depende de o `mousemove` ter rodado antes.
      //
      // 🔴 TUDO que este handler lê vem de REF, nunca de closure: este efeito
      // roda só na montagem. `navegarNoCliqueRef` em especial — ele NASCE
      // `false` no wrapper e só vira o valor real depois do `useEffect` do
      // `matchMedia`; uma closure congelaria o `false` e o ponteiro fino
      // nunca navegaria. Mesmo motivo de `onSelectUfRef`, `cargoRef` e
      // `routerRef`.
      map.on("click", "ufs-fill", (e) => {
        const sigla = e.features?.[0]?.properties?.SIGLA_UF as string | undefined;
        if (!sigla) return;
        useHoverStore.getState().setHovered({ type: "uf", sigla }, "map");
        if (navegarNoCliqueRef.current) {
          // `router.push` e NÃO `<a href>`/`location.assign`: `/` e
          // `/uf/[sigla]` são irmãos sob o MESMO `layout.tsx` de grupo, que
          // hospeda a moldura persistente do mapa. A navegação soft preserva
          // a instância MapLibre viva; um link cru remontaria o mapa do zero
          // — exatamente o defeito que o ADR-0033 § 1 existe para evitar.
          //
          // `ufHref` (módulo puro `lib/utils/uf-href`) é a fonte ÚNICA do
          // destino por cargo — um template escrito à mão aqui seria a quarta
          // ocorrência do default silencioso de cargo neste repositório.
          routerRef.current.push(ufHref(cargoRef.current, sigla));
          return;
        }
        onSelectUfRef.current?.(sigla);
      });

      return map;
    }

    mount();

    // `mapRef.current` (não a variável local do 1º `mount()`) porque um
    // retry do self-heal troca a instância viva sem que este cleanup saiba —
    // remover a instância antiga (já destruída dentro do próprio retry)
    // seria um `map.remove()` duplicado.
    return () => {
      cancelled = true;
      window.clearTimeout(hangTimer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Stable ref a onSelectUf pra não re-montar o mapa quando o callback muda
  // de identidade (o pai passa uma closure inline).
  const onSelectUfRef = useRef(onSelectUf);
  useEffect(() => {
    onSelectUfRef.current = onSelectUf;
  }, [onSelectUf]);

  // 2026-09-19 — o par do clique-navega. `routerRef` porque o objeto do
  // `useRouter` pode trocar de identidade entre renders e o handler de clique
  // é registrado uma vez só; `navegarNoCliqueRef` porque o valor NASCE `false`
  // e vira `true` um tick depois (o `matchMedia` do wrapper só resolve no
  // `useEffect` dele) — ver a docstring da prop.
  const routerRef = useRef(router);
  const navegarNoCliqueRef = useRef(navegarNoClique);
  useEffect(() => {
    routerRef.current = router;
    navegarNoCliqueRef.current = navegarNoClique;
  }, [router, navegarNoClique]);

  // 2026-09-20 — mesma razão de `navegarNoCliqueRef` acima: o handler de
  // `mousemove` é registrado uma vez, na montagem, e o wrapper pode ligar
  // isto depois de resolver `useHasFinePointer()`. Ver a docstring da prop
  // `bloqueiaBalaoNoToque` na interface.
  const bloqueiaBalaoNoToqueRef = useRef(bloqueiaBalaoNoToque);
  useEffect(() => {
    bloqueiaBalaoNoToqueRef.current = bloqueiaBalaoNoToque;
  }, [bloqueiaBalaoNoToque]);

  // Refs for view/rankByLider/candidatosById used in load handler
  const viewRef = useRef(view);
  const viewModeRef = useRef(viewMode);
  const rankByLiderRef = useRef(effectiveRankByLider);
  const candidatosByIdRef = useRef(candidatosById);
  // RF-157 — a fase precisa chegar ao handler de `load`, que roda uma vez e
  // fecha sobre as refs. Sem ela aqui, a primeira pintura do mapa (a única que
  // acontece quando `rows` nunca muda) ignoraria a fase.
  const preEleicaoRef = useRef(preEleicao);
  // RF-104 (3ª rodada) — `cargo` decide a margem usada em `resolveColor`
  // (`case "margin"`); mesma razão de `preEleicaoRef` acima: o handler de
  // `load` roda uma vez e fecha sobre as refs.
  const cargoRef = useRef(cargo);
  useEffect(() => {
    viewRef.current = view;
    viewModeRef.current = viewMode;
    rankByLiderRef.current = effectiveRankByLider;
    candidatosByIdRef.current = candidatosById;
    preEleicaoRef.current = preEleicao;
    cargoRef.current = cargo;
  }, [view, viewMode, effectiveRankByLider, candidatosById, preEleicao, cargo]);

  // Recolor when view, rows, rankByLider, candidatos or cargo change (zero re-fetch)
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    applyColors(map, rows, view, effectiveRankByLider, candidatosById, viewMode, preEleicao, cargo);
  }, [view, viewMode, rows, effectiveRankByLider, candidatosById, preEleicao, cargo]);

  /**
   * 🔴 **2026-09-20 — WCAG SC 1.4.13: o balão também abre no FOCO.**
   *
   * Tabular até uma célula de UF na `<StateGroupedTable>` acende o estado e
   * abre o mesmo `<HoverCard>` que o ponteiro abre. Quem emite é
   * `<UfHoverLink>` (`components/atoms/tables/UfHoverLink.tsx`), com
   * `source: "table"`; aqui só obedecemos.
   *
   * **O mapa continua SEM `tabIndex`, e isso é decisão, não esquecimento**:
   * tornar as 27 UFs focáveis duplicaria as 27 paradas de tabulação que a
   * tabela já oferece. O desenho fica como está — o mapa é `role="img"`
   * descrito pela tabela, e a tabela é quem tem o foco.
   *
   * ## O posicionamento, que é o ponto difícil
   *
   * O caminho do mouse ancora o cartão no PONTEIRO (`clientX/clientY` menos o
   * retângulo do contêiner). Vindo da tabela não há ponteiro — ela fica do
   * outro lado da tela. Ancorar no canto, ou na última posição conhecida do
   * cursor, apontaria para o estado errado.
   *
   * A âncora certa é o próprio estado no mapa, e o mapa sabe convertê-la:
   * `map.project(lngLat)` devolve pixel NO MESMO referencial do contêiner que
   * o caminho do mouse usa — as duas origens produzem o mesmo tipo de
   * coordenada, e `flip`/`flipY` continuam saindo do mesmo predicado
   * (metade direita ⇒ vira de lado; metade de baixo ⇒ vira para cima).
   *
   * O `lngLat` sai do centro de `UF_BBOX[sigla]`
   * (`components/atoms/maps/_shared.ts`) — a MESMA tabela que enquadra os
   * mapas estaduais, já importada por este arquivo (`UF_NOMES` é a vizinha
   * dela) e server-safe. Deliberadamente NÃO usamos
   * `querySourceFeatures`/`queryRenderedFeatures` para achar a geometria: a
   * feature de uma UF chega recortada e repetida por tile, o resultado depende
   * de quais tiles já carregaram, e uma UF fora do viewport não retorna nada —
   * três formas de o balão abrir no lugar errado, ou não abrir, sem sintoma.
   * O centro do bbox é aproximado (é o centro do RETÂNGULO, não o centroide do
   * polígono) e isso basta: o cartão tem 12px de deslocamento e ~220px de
   * largura, não é uma ponta de seta.
   *
   * ## Por que a ref de "anterior", e não um `if` simples
   *
   * Este efeito roda em TODA mudança de `siglaFocoTabela` — inclusive na
   * montagem, quando ele já nasce `null`. Fechar incondicionalmente no ramo
   * `null` apagaria o balão do mouse a cada render. Só a TRANSIÇÃO
   * não-nulo → nulo é um pedido de fechar, e mesmo ela só vale se o balão na
   * tela for o nosso (`origemTooltipRef`).
   */
  const focoAnteriorRef = useRef<string | null>(null);
  useEffect(() => {
    const anterior = focoAnteriorRef.current;
    focoAnteriorRef.current = siglaFocoTabela;
    const map = mapRef.current;

    if (siglaFocoTabela === null) {
      // Nunca houve foco de tabela, ou o balão da tela é do ponteiro: não é
      // conosco. Ver a docstring acima.
      if (anterior === null || origemTooltipRef.current !== "table") return;
      origemTooltipRef.current = null;
      setTooltip(null);
      if (map?.isStyleLoaded()) map.setFilter("ufs-stroke-hover", ["==", "SIGLA_UF", ""]);
      return;
    }

    const row = rows.find((r) => r.sigla === siglaFocoTabela);
    const bbox = UF_BBOX[siglaFocoTabela];
    const container = containerRef.current;
    // Sem mapa montado, sem linha para aquela UF ou sem bbox conhecido, não há
    // balão honesto a mostrar — e o destaque de contorno sozinho apontaria
    // para um estado sem dizer nada sobre ele.
    if (!map || !row || !bbox || !container) return;

    const ponto = map.project([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]);
    const rect = container.getBoundingClientRect();
    origemTooltipRef.current = "table";
    if (map.isStyleLoaded()) {
      map.setFilter("ufs-stroke-hover", ["==", "SIGLA_UF", siglaFocoTabela]);
    }
    // Mesmo cálculo do `onMouseMove` (ver a nota lá) — o caminho de teclado
    // não pode ter um limite diferente do caminho do mouse para o MESMO
    // defeito (RS a 1024px de janela também é alcançável tabulando até a
    // célula de RS na tabela).
    const placement = computeHoverCardPlacement({
      x: ponto.x,
      y: ponto.y,
      containerWidth: rect.width,
      containerHeight: rect.height,
      cardWidth: cardSizeRef.current.width,
      cardHeight: cardSizeRef.current.height,
    });
    setTooltip({
      x: placement.x,
      y: placement.y,
      flip: placement.flip,
      flipY: placement.flipY,
      sigla: siglaFocoTabela,
      row,
    });
  }, [siglaFocoTabela, rows]);

  /**
   * 🔴 **2026-09-20 — mede o `<HoverCard>` DE VERDADE e corrige a estimativa,
   * antes do navegador pintar.** `onMouseMove`/o efeito de foco acima decidem
   * `flip`/`flipY` com o ÚLTIMO tamanho conhecido (`cardSizeRef`), sem tocar o
   * DOM — este efeito é quem MANTÉM `cardSizeRef` correto, e só ele lê
   * `getBoundingClientRect()` do cartão.
   *
   * **Depende só de `tooltip?.row`, nunca de `tooltip?.x`/`tooltip?.y`.** É a
   * peça central de não tremer a 60Hz (`mousemove` é throttled a 16ms, ver a
   * nota em `lib/utils/hover-card-placement.ts`): `row` é a MESMA referência
   * (vem de `rowsMapRef.current.get(sigla)`) enquanto o ponteiro continua
   * sobre a MESMA UF — só muda quando a UF hoverada troca, ou quando `rows`
   * é substituído (revalidação de dado, não movimento do mouse). Sem `x`/`y`
   * nas deps, mover o mouse dentro do mesmo estado NUNCA reexecuta este
   * efeito — só o `setTooltip` de cima roda, com aritmética pura.
   *
   * **`useLayoutEffect`, não `useEffect`**: dispara sincronamente depois do
   * `<HoverCard>` ter comitado ao DOM e ANTES do navegador pintar. Se a
   * estimativa usada no `setTooltip` de cima estava errada (1ª vez que este
   * conteúdo aparece — `cardSizeRef` ainda no fallback, ou o conteúdo mudou
   * de tamanho desde a última medição), o `setTooltip` daqui troca de commit
   * no MESMO frame — o usuário nunca vê o cartão no lugar errado, só no
   * corrigido.
   *
   * Como o `<HoverCard>` nunca ganhou `ref`/`"use client"`/`useLayoutEffect"
   * (ver `lib/utils/hover-card-placement.ts` § "Onde a medição mora"), este
   * efeito lê o nó real através do wrapper `display:contents`
   * (`hoverCardBoxRef.current.firstElementChild`) — o próprio `<HoverCard>`
   * continua sem saber que está sendo medido. Deps de propósito incompletas
   * (sem `tooltip` inteiro/`x`/`y`/`flip`/`flipY`) — ver o parágrafo acima.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: de propósito — ver a docstring acima
  useLayoutEffect(() => {
    const container = containerRef.current;
    const cardEl = hoverCardBoxRef.current?.firstElementChild as HTMLElement | null;
    if (!tooltip || !container || !cardEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    cardSizeRef.current = { width: cardRect.width, height: cardRect.height };
    const containerRect = container.getBoundingClientRect();
    const placement = computeHoverCardPlacement({
      x: tooltip.x,
      y: tooltip.y,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
    });
    if (
      placement.flip !== tooltip.flip ||
      placement.flipY !== tooltip.flipY ||
      placement.x !== tooltip.x ||
      placement.y !== tooltip.y
    ) {
      setTooltip((prev) => (prev ? { ...prev, ...placement } : prev));
    }
  }, [tooltip?.row, tooltip?.sigla]);

  return (
    // `height` também aqui, e não só no container do MapLibre: com a moldura
    // persistente (ADR-0033 § 1) o mapa recebe `height="100%"`, e 100% de um
    // pai de altura automática resolve para zero — o mapa montava, o canvas
    // existia e nada aparecia (medido em 08/09). Com altura numérica o efeito
    // é nulo: o pai passa a ter a mesma altura que o filho já tinha.
    <div style={{ position: "relative", height }}>
      <div
        ref={containerRef}
        // 🔴 2026-09-20 — este `role="img"` continua SEM `tabIndex`, e por
        // decisão: 27 UFs focáveis duplicariam as 27 paradas de tabulação que
        // a `<StateGroupedTable>` já oferece. O que mudou naquele dia é que o
        // foco naquelas células passou a ABRIR O BALÃO daqui (WCAG SC 1.4.13)
        // — ver o efeito `siglaFocoTabela` acima. O caminho de teclado segue
        // sendo a tabela e o `<UfPicker>`, não o canvas.
        //
        // 🔴 2026-09-19 — trocar o clique→folha por clique→navegação no
        // desktop NÃO é regressão de acessibilidade, e isto foi CONFERIDO no
        // código, não presumido: este `role="img"` não tem `tabIndex`, e na
        // data em que a nota foi escrita não havia handler de teclado nenhum
        // neste arquivo. O canvas do MapLibre nunca esteve na ordem
        // de tabulação, logo a `<StateResultSheet>` que o clique abria também
        // nunca foi alcançável por teclado — não se perde um caminho que não
        // existia. O caminho de teclado para chegar a um estado é, e continua
        // sendo, o `<UfPicker>`: 27 `<Link>` de verdade (`UfPicker.tsx:232`,
        // `ufsPorNome()`), montado em TODOS os ramos de
        // `PersistentMapFrame.tsx` (pres, gov e sen, com e sem `sigla`) — e
        // agora ele leva ao MESMO destino que o clique no mapa, porque os dois
        // derivam de `ufHref`.
        //
        // O `aria-describedby` logo abaixo também não precisou mudar: ele
        // aponta para a lista textual paralela (`<StateGroupedTable>` em
        // Presidente, o painel "Estado a estado" em Senador) — nunca descreveu
        // a folha nem o efeito do clique.
        role="img"
        // RF-161 — "projeção" não ocorre em nenhuma das quatro telas em fase
        // pré, fora do bloco de transparência (RF-158). A métrica da spec é
        // medida sobre o HTML, e `aria-label` é HTML: é por aqui, por `title`
        // e por legenda que a palavra vaza sem passar por revisão.
        //
        // 🔴 2026-09-18 (achado do `a11y-perf-auditor`, RNF-025/WCAG SC 4.1.2)
        // — `ariaRessalvaVagas(cargo)` some para "" em `"pres"`/`"gov"` (as
        // duas strings abaixo ficam byte a byte iguais a antes desta
        // mudança) e vira " — Senado: 2 vagas por estado" em `"sen"`. Sem
        // isso, quem pula direto para este `role="img"` (atalho comum de
        // leitor de tela) nunca ouvia a ressalva sob a qual o dono aceitou
        // pintar o mapa pelo 1º colocado de cada UF — ver a mesma
        // qualificação no `role="region"` que envolve este mapa
        // (`NationalChoroplethMap.tsx`, `viewLabelForCargo`/
        // `ariaRessalvaVagas`), fonte única para as duas camadas.
        aria-label={
          (preEleicao
            ? "Mapa interativo do Brasil — as 27 unidades federativas, nenhuma com voto contado"
            : "Mapa interativo do Brasil — UFs coloridas por projeção") + ariaRessalvaVagas(cargo)
        }
        // S05 carry-over (constitution P3 MEDIUM): liga o mapa semanticamente à
        // tabela `<StateGroupedTable>` que vive abaixo na mesma página. Leitores
        // de tela anunciam "descrito por: Resultados por estado" — quem não
        // enxerga o choropleth pode ir direto à tabela equivalente (a11y RNF-022).
        // O id "state-grouped-table-heading" é declarado no <h2> da tabela.
        //
        // 🔴 2026-09-18 — só existe em cargo `"pres"`. `<StateGroupedTable>`
        // só é montada em `app/(pres)/page.tsx`; a trilha `"gov"` não tem
        // equivalente hoje (o painel "Corridas estaduais" da grade de
        // `<GovernorCard>` não tem heading com id). Um `aria-describedby`
        // apontando pra um id que não existe no documento é RNF-022 quebrado
        // em silêncio — pior que não descrever nada. Quando a trilha gov
        // ganhar um heading equivalente, troque aqui, não invente um id que
        // não existe só para preencher o atributo.
        //
        // 🔴 2026-09-18 (2ª rodada) — `"sen"` GANHA alvo, ao contrário de
        // `"gov"`: `app/(sen)/senador/page.tsx` monta
        // `<Panel kicker="Corridas estaduais" title="Estado a estado"
        // titleId="corridas-heading">` com a lista textual completa das 27
        // corridas (nome + margem para a 2ª vaga) — o mesmo papel que
        // `<StateGroupedTable>` cumpre em Presidente. Este mapa só é montado
        // no nível Brasil de Senador (`PersistentMapFrame`, ramo `cargo ===
        // "sen"` sem `sigla`); `/uf/[sigla]/senador` não tem esse heading, mas
        // também nunca monta este componente (spec 016 § Escopo/Fora — sem
        // mapa municipal), então o id sempre existe quando este atributo é
        // lido.
        aria-describedby={
          cargo === "pres"
            ? "state-grouped-table-heading"
            : cargo === "sen"
              ? "corridas-heading"
              : undefined
        }
        style={{ width: "100%", height }}
      />
      {/* HoverCard RF-030.3 — design system Atlas Menna (S07/Bloco 1).
          `display: "contents"` — wrapper de medição, ver `hoverCardBoxRef`
          acima; não gera caixa própria nem afeta o layout do cartão. */}
      {tooltip && (
        <div ref={hoverCardBoxRef} style={{ display: "contents" }}>
          <HoverCard
            x={tooltip.x}
            y={tooltip.y}
            flip={tooltip.flip}
            flipY={tooltip.flipY}
            title={ufTitleFor(tooltip.sigla)}
            kicker={tooltip.row.chamada ? "Chamada" : undefined}
            apurado={tooltip.row.pct_apurado}
            rows={buildHoverRows(tooltip.row, candidatosById, effectiveRankByLider, viewMode)}
          />
        </div>
      )}
    </div>
  );
}
