"use client";

/**
 * components/atoms/maps/ChoroplethMapUF.tsx
 *
 * RF-034 + RF-036 — Mapa coroplético do estado em granularidade de município.
 *   - mode='leader'   → cor do líder por município (RF-034).
 *   - mode='estimate' → cor da estimativa do que falta (RF-036).
 *
 * Implementação MapLibre GL + PMTiles (municipios.pmtiles ~10MB).
 * Coloração via setFeatureState (zero re-fetch).
 * Hover coordenado via hover-store (producer). Consumer: tabela de municípios (spec 008).
 *
 * ADR-0003: PMTiles (range requests), não GeoJSON.
 * ADR-0004: MapLibre GL, não Mapbox.
 * ADR-0010: Carregado via next/dynamic({ ssr: false }) por UfMapsLazy.
 * Constituição § 2: cores via CSS token (getComputedStyle), nunca hex oficial.
 *
 * 2026-09-18 (pedido do dono) — `<HoverCard>` no hover, mesmo átomo do mapa
 * NACIONAL (`components/atoms/overlays/HoverCard.tsx`), com uma diferença
 * deliberada: **sem coluna "Proj."**. Não é o município ser "mais fino" que a
 * zona — os dois são recortes que se CRUZAM, não um mais granular que o
 * outro (uma zona pode atravessar vários municípios). O motivo real:
 *   1. A projeção é extrapolação do APURADO POR ZONA eleitoral, nunca por
 *      município (ADR-0021 — `V_c(z) = vap_c·k`, `k = te/esi` calculado por
 *      zona; ADR-0007 fixa zona como granularidade do modelo).
 *   2. "Regra de três por município" foi avaliada e REJEITADA para esta
 *      janela (ADR-0021 § Alternativas rejeitadas): ~11.140 GETs por ciclo
 *      não cabem em `maxDuration=180`, e `snapshots` não tem coluna de
 *      granularidade municipal. Adiada para depois da eleição.
 *   3. A unidade mais fina que a ingestão publica é o PAR (município, zona)
 *      — `api/model/zona_merge.py` soma os pares de volta em zona ANTES do
 *      estimador (ADR-0035 D1/D2). Não existe, em nenhum ponto do pipeline,
 *      um `V_c` calculado por município.
 * Mostrar uma coluna "Proj." aqui seria inventar um número que o produto não
 * tem (constituição § 1) — por isso `HoverCardRow.proj` fica sempre
 * `undefined` em `buildMunicipioHoverRows`, e a coluna some sozinha (mesma
 * degradação de "Partido"/"Votos"/"Parcial", ver `hasColumn` em
 * `HoverCard.tsx`).
 *
 * 2026-09-20 (pedido do dono — "no toque só a gaveta") — o `mousemove`
 * abaixo passa a checar `useHasFinePointer()` (`lib/utils/use-has-fine-pointer.ts`)
 * antes de abrir o balão. O comentário do handler de `click` deste arquivo
 * afirmava "[o clique] é o que serve o tap-to-select do mobile, onde não há
 * mousemove" — **falso**: Safari e Chrome em toque disparam um `mousemove`
 * sintético imediatamente antes do `click`, e sem guarda ele abria o mesmo
 * `<HoverCard>` que o mouse abre, sem jeito de fechar (`mouseleave` não
 * dispara em toque) — preso na tela por cima da folha do município que o
 * clique abre. Mesmo remédio do mapa NACIONAL
 * (`_NationalChoroplethMapImpl.tsx`), sem prop: este átomo não tem um
 * wrapper que resolva a media query por ele, então chama o hook direto —
 * mesmo padrão que já usa para `prefers-reduced-motion` mais abaixo.
 */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  applyZoomLimits,
  attachInteractionMode,
  attachZoomControls,
  MAP_INTERACTION_OPTIONS,
  toLngLat,
  ZOOM_RESET_MS,
} from "@/components/atoms/maps/_map-interaction";
import {
  registerPmtilesProtocolOnce,
  resetPmtilesProtocol,
} from "@/components/atoms/maps/_pmtiles-protocol";
import { resolveCssColor, UF_BBOX, ufCodigoIbge } from "@/components/atoms/maps/_shared";
import { HoverCard, type HoverCardRow } from "@/components/atoms/overlays/HoverCard";
import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";
import { CODIGOS_IBGE_NAO_MUNICIPIO } from "@/lib/config/malha-ibge";
import type { EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { useHoverStore } from "@/lib/state/hover-store";
import { compete } from "@/lib/utils/destino-voto";
// 🔴 2026-09-20 — mesmo remédio do mapa nacional, ver
// `_NationalChoroplethMapImpl.tsx` e `lib/utils/hover-card-placement.ts`.
import {
  computeHoverCardPlacement,
  HOVER_CARD_FALLBACK_SIZE,
} from "@/lib/utils/hover-card-placement";
import { votosPorCandidatoMunicipio } from "@/lib/utils/municipio-votos";
import { textForParty } from "@/lib/utils/party-color";
import { useHasFinePointer } from "@/lib/utils/use-has-fine-pointer";

const PMTILES_BASE = "https://jbtu251tioj3y57z.public.blob.vercel-storage.com";

export interface ChoroplethMunicipio {
  cod_ibge: string;
  /** Cor do polígono (token CSS ou hex resolvido pelo caller). */
  cor: string;
  /** % apurado no município (0–100). */
  pctApurado: number;
}

export interface ChoroplethMapUFProps {
  ufSigla: string;
  municipios: ChoroplethMunicipio[];
  mode: "leader" | "estimate";
  /**
   * `number` (px) nas páginas de UF (hero fixo, ADR-0029 § 1). `"100%"` na
   * moldura persistente (`PersistentMapFrame`, ADR-0033 § 1), que preenche a
   * coluna do mapa inteira — mesmo padrão que `NationalChoroplethMap.height`
   * já aceita para o variant `frame`.
   */
  height?: number | string;
  /**
   * Dado completo por município (2026-09-18) — alimenta o `<HoverCard>`.
   * `municipios` acima só carrega o que a PINTURA do polígono precisa
   * (cor + % apurado); o balão precisa também de `nome`, `lider` e
   * `votos_reportados`, que só existem em `EdgeUfMunicipio`. Casa com
   * `municipios` por `cod_ibge`.
   *
   * Opcional e independente da pintura: ausente ⇒ hover continua colorindo,
   * filtrando o traço e escrevendo no `hover-store` normalmente — só o
   * balão fica de fora. Preferível a um balão pela metade (constituição § 1).
   */
  detalhe?: EdgeUfMunicipio[];
  /**
   * Candidatos da corrida NESTA UF — resolve nome/partido/cor de cada
   * entrada de `votos_reportados` para o balão.
   *
   * Por que resolver contra ESTA lista (a da UF) e não contra
   * `national.candidatos` (o bloco nacional): `EdgeUfCandidate.sqcand` vem em
   * **todo cargo**, porque este payload já é de uma UF só — o par
   * `(uf, numero)` que o resolve não é ambíguo (ADR-0042 item 2, RF-144). O
   * bloco nacional NÃO tem essa garantia fora do cargo 1: em Governador e
   * Senador ele é a união de 27 corridas sob o mesmo espaço de `id`
   * (RF-145) — foi exatamente essa ambiguidade que produziu o defeito
   * corrigido em `_NationalChoroplethMapImpl.buildHoverRows` hoje mais
   * cedo. Mesmo padrão que `votosPorCandidatoMunicipio`
   * (`lib/utils/municipio-votos.ts`) já usa para a folha do município.
   */
  candidatos?: EdgeUfCandidate[];
}

/**
 * Quantas candidaturas o balão do município nomeia antes de agregar o resto
 * na linha "Outros" (2026-09-19, pedido do dono — era 3, sem agregado).
 *
 * Constante nomeada e não `4` literal porque o número aparece em DOIS lugares
 * que têm de concordar: o corte do topo e o começo da cauda. Com dois
 * literais, mudar um e esquecer o outro não quebra nada visível — produz uma
 * candidatura contada duas vezes (topo 4, cauda a partir do 3) ou uma que
 * some da tela (topo 4, cauda a partir do 5), e a soma de "Outros" continua
 * parecendo plausível.
 *
 * Casa com `TOP_CANDIDATOS_POR_UF` (`api/model/project.py`), que define o
 * mesmo corte para o balão NACIONAL — mas por coincidência de decisão
 * editorial, não por contrato: lá quem corta é o produtor do payload, aqui é
 * este consumidor (o dado municipal chega inteiro). Um dos dois pode mudar
 * sem o outro.
 */
const MUNICIPIO_TOP_N = 4;

/**
 * Linhas do `<HoverCard>` do mapa municipal.
 *
 * 2026-09-18 (correção de rota do orquestrador) — o percentual e a
 * identidade de cada candidato NÃO são recalculados aqui: vêm de
 * `votosPorCandidatoMunicipio` (`lib/utils/municipio-votos.ts`), a MESMA
 * função que `MunicipioExplorer` (a folha, aberta no CLIQUE) usa para exibir
 * exatamente este município. Uma conta, dois consumidores — duas
 * implementações da mesma soma divergem cedo ou tarde, e o defeito que essa
 * decisão evita é "o mouse diz 28,7% e o clique diz 28,6% no mesmo
 * município". Ver a docstring daquela função para a prova de que o
 * denominador (`Σ votos_reportados`) é a mesma base "votáveis" que
 * `pct_atual` usa no resto do produto.
 *
 * O que ESTA função decide, que é específico do balão (não da conta):
 *   - corta em {@link MUNICIPIO_TOP_N} e agrega o resto numa linha "Outros"
 *     — a folha mostra TODOS, o balão não tem esse espaço nem essa vocação.
 *     🔴 Correção de 2026-09-19: até aqui esta docstring afirmava que o
 *     balão nacional cortava em 3 porque `top_candidatos` "já chega truncado
 *     do payload", e usava isso como justificativa para o `.slice(0, 3)`
 *     daqui. As duas metades estavam erradas juntas — o corte de lá é do
 *     PRODUTOR (`TOP_CANDIDATOS_POR_UF`, `api/model/project.py`), não do
 *     consumidor, e desde 2026-09-19 ele é 4, não 3. O corte daqui sempre
 *     foi decisão local desta função, e continua sendo: o payload municipal
 *     (`votosPorCandidatoMunicipio`) devolve a lista INTEIRA, ordenada, e a
 *     docstring dela diz literalmente "Sem corte: o CALLER decide";
 *   - soma a cauda ele mesmo (ver {@link MUNICIPIO_TOP_N});
 *   - resolve a COR pelo padrão de acessibilidade do `<HoverCard>`
 *     (RNF-035/SC 1.4.11: `textForParty` para TODA sigla — inclusive ausente,
 *     desconhecida ou de federação, que ele resolve em `--party-outros-text`,
 *     mesma variante legível que o balão NACIONAL usa para o mesmo ponto de
 *     8×8) — a folha usa `MunicipioVotoCandidato.cor` direto porque ali é
 *     uma barra decorativa, não um ponto de 8×8 isolado sobre fundo claro;
 *   - nunca preenche `proj` (sem projeção municipal, ver docstring do topo
 *     do arquivo) nem `winnerBackground`/`winnerInk`: município não tem o
 *     conceito de "chamada" (`EdgeUfRow.chamada` é campo de corrida
 *     MAJORITÁRIA nacional/estadual; `EdgeUfMunicipio` não o carrega) —
 *     inventar um limiar aqui declararia vencedor sem o fato que sustenta a
 *     faixa colorida no mapa nacional (constituição § 1).
 */
function buildMunicipioHoverRows(
  municipio: EdgeUfMunicipio,
  candidatos: EdgeUfCandidate[],
): HoverCardRow[] {
  const todos = votosPorCandidatoMunicipio(municipio, candidatos);
  // ADR-0053 / RF-213 — o corte de {@link MUNICIPIO_TOP_N} é entre quem
  // COMPETE; a anulada entra depois dele e antes de "Outros", sempre visível
  // e com etiqueta. Cortar a lista crua com ela no fim a esconderia dentro de
  // "Outros" — e "Outros" passaria a somar voto anulado junto com o de quem
  // disputa. Sem anulada, `competem` é `todos` e o balão é o de sempre.
  const competem = todos.filter(compete);
  const anuladas = todos.filter((v) => !compete(v));
  const linhas: HoverCardRow[] = [...competem.slice(0, MUNICIPIO_TOP_N), ...anuladas].map((v) => {
    return {
      name: v.nome,
      // 🔴 2026-09-20 — sem desvio: `textForParty` já resolve sigla ausente,
      // desconhecida ou de FEDERAÇÃO para `--party-outros-text`. O ramo antigo
      // caía em `v.cor`, que `lib/utils/municipio-votos.ts:113` copia do campo
      // `cor` do payload — e o produtor grava ali `var(--color-cand-N)`, a
      // paleta por COLOCAÇÃO. Era a porta pela qual o campo do payload, banido
      // de `components/` pela varredura de `cor-nunca-do-payload.test.ts`,
      // voltava à tela por dentro de `lib/`.
      color: textForParty(v.partido),
      partido: v.partido,
      votos: v.votos,
      // Emenda "opção A" — `null` é a anulada: sem percentual, só votos (o
      // `<HoverCard>` também apaga a célula pelo `destino`).
      ...(v.pct !== null ? { pct: v.pct } : {}),
      ...(v.destino ? { destino: v.destino } : {}),
    };
  });

  const cauda = competem.slice(MUNICIPIO_TOP_N);
  if (cauda.length === 0) return linhas;

  return [
    ...linhas,
    {
      kind: "outros",
      name: `Outros (${cauda.length})`,
      // 🔴 **A soma dos `pct` DAS LINHAS**, nunca `100 − Σ(top 4)` e nunca uma
      // segunda divisão sobre um denominador remontado aqui. `pct` de cada
      // entrada já é `votos / Σ votos_reportados × 100`
      // (`lib/utils/municipio-votos.ts`) — o MESMO denominador para todas —,
      // então somar os numeradores normalizados é exato por construção, sem
      // resíduo de fechamento. A subtração, ao contrário, empurraria para
      // dentro de "Outros" qualquer diferença de arredondamento das quatro
      // linhas de cima e a publicaria como voto de alguém.
      // `?? 0` nunca dispara: a cauda é só de quem compete (`competem`), e
      // só a anulada tem `pct === null`.
      pct: cauda.reduce((acc, v) => acc + (v.pct ?? 0), 0),
      // Votos absolutos: soma de inteiros, exata e conhecida. Deixá-la de
      // fora mostraria "—" na coluna "Votos" de uma linha cujo total o
      // produto sabe de cor.
      votos: cauda.reduce((acc, v) => acc + v.votos, 0),
      // Sem `proj` — não existe projeção municipal (ADR-0021, docstring do
      // topo deste arquivo). Nem `color`/`partido`: o agregado não tem
      // identidade.
      //
      // ⚠️ **Herdado, não novo**: com `Σ votos_reportados === 0` todos os
      // `pct` são `0` (ver `municipio-votos.ts:80-96`, questão aberta lá) e
      // esta linha mostrará "0,0%" como as quatro de cima — "não sabemos"
      // exibido como "medimos zero". Resolver aqui divergiria do que a FOLHA
      // já publicada mostra para o mesmo município, que é precisamente o
      // defeito que ter uma conta só existe para evitar. O conserto é lá,
      // para os dois consumidores ao mesmo tempo.
    },
  ];
}

interface MunicipioTooltipState {
  x: number;
  y: number;
  /** Vira o cartão pra esquerda perto da borda direita do mapa. */
  flip: boolean;
  /**
   * Vira o cartão pra CIMA perto da borda de baixo do mapa (2026-09-19).
   * **Obrigatório, não opcional** — pelo mesmo motivo que `flip`: um
   * `setTooltip` que esqueça o campo tem de ser erro de compilação, não um
   * `undefined` que cai no default `false` do `<HoverCard>` e reproduz em
   * silêncio o defeito que este campo corrige. Ver a nota sobre o predicado
   * e o limite dele no handler de `mousemove`, e a versão longa em
   * `_NationalChoroplethMapImpl.tsx`.
   */
  flipY: boolean;
  /**
   * SÓ o código — não o `EdgeUfMunicipio` inteiro (2026-09-18, 2ª correção de
   * rota do dia). `detalhe` (o prop com `votos_reportados`) chega por busca
   * assíncrona no componente pai (`PersistentMapFrame`, client-side,
   * `ufResumo`/`municipioDetalhe` começam `null`) — pode chegar DEPOIS do
   * primeiro hover. Guardar o objeto resolvido no momento do hover congelaria
   * esse "ainda não chegou" para sempre: o card só reapareceria no PRÓXIMO
   * `mousemove`, e alguém que hovera e para o mouse (o caso comum) nunca veria
   * o balão aparecer sozinho quando o dado enfim chegasse. Guardando só o
   * `codIbge`, a resolução para `EdgeUfMunicipio` acontece no RENDER (`detalheMap`
   * abaixo, `useMemo` sobre a prop `detalhe` atual) — a cada render em que
   * `detalhe` mudou, o card resolve de novo, sem precisar de um novo hover.
   */
  codIbge: string;
}

/** Throttle helper — evita flood de eventos mousemove */
function throttle<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  }) as T;
}

/** Ver `STYLE_LOAD_TIMEOUT_MS` em `_NationalChoroplethMapImpl.tsx` — mesma causa raiz (pmtiles@4.4.1). */
const STYLE_LOAD_TIMEOUT_MS = 10_000;

/**
 * Expression MapLibre equivalente a `Math.floor(f.id / 100000) === level` do
 * protótipo (`MapView.jsx:29`) — recorta só os municípios da UF `sigla`
 * (Bloco 2, 2026-09-09). `CD_MUN` é propriedade (não feature id, ver
 * `promoteId` no mount), daí o `["get", ...]`; `["to-number", ...]` porque
 * o tile pode entregar a propriedade como string.
 *
 * Composta sempre via `["all", ufFloorFilter(...), outraCondição]` — por
 * isso `outraCondição` também precisa estar em sintaxe de expression
 * (`["==", ["get", "CD_MUN"], v]`), nunca a sintaxe legada de 2 argumentos
 * (`["==", "CD_MUN", v]`). Medido em 2026-09-09: misturar as duas dentro do
 * mesmo `all` faz o validador do MapLibre tratar o `all` inteiro como filtro
 * legado e rejeitar a expression aninhada (`layers[2].filter[1][1]: string
 * expected, array found`) — o estilo nunca termina de carregar (mesmo
 * sintoma do bug de cache do pmtiles, mas causa totalmente diferente).
 *
 * 🔴 **O recorte por prefixo NÃO basta, e é por isso que há um segundo termo.**
 * A malha do IBGE traz corpos d'água como feições próprias, com código no
 * mesmo formato de município, e `Math.floor(4300001 / 100000)` é **43** — o
 * Rio Grande do Sul. Só com o `floor`, a Lagoa Mirim e a Lagoa dos Patos
 * entram no recorte do RS e viram municípios para todos os efeitos: pintadas
 * (cinza do `coalesce`, porque nunca recebem dado), com contorno e cursor
 * `pointer` no hover, escrevendo no `hover-store` um `codIbge` que a tabela de
 * municípios não conhece, e **abrindo a ficha de município no clique**.
 *
 * Na noite da apuração o efeito é editorial, não cosmético: às 23h, com o RS
 * inteiro colorido, duas manchas grandes — a Lagoa dos Patos é uma das maiores
 * formas do estado — ficam no mesmo cinza de "ainda não apurou", e ficam para
 * sempre. Quem lê o mapa conclui que pedaços grandes do estado não apuraram.
 *
 * Excluir aqui, e só aqui, cobre **todas** as superfícies de uma vez: os
 * quatro outros filtros deste arquivo compõem a partir desta função, e os
 * handlers de `mousemove`/`click` são registrados na camada `municipios-fill`,
 * então feição filtrada fora nem chega a eles. Ver `lib/config/malha-ibge.ts`.
 */
export function ufFloorFilter(sigla: string): maplibregl.ExpressionSpecification {
  const ufCodigo = ufCodigoIbge(sigla) ?? -1;
  return [
    "all",
    ["==", ["floor", ["/", ["to-number", ["get", "CD_MUN"]], 100000]], ufCodigo],
    // `to-number` pelo mesmo motivo do `floor` acima: o tile pode entregar
    // `CD_MUN` como string, e `["in", "4300002", [4300001, 4300002]]` não casa.
    ["!", ["in", ["to-number", ["get", "CD_MUN"]], ["literal", [...CODIGOS_IBGE_NAO_MUNICIPIO]]]],
  ];
}

export function ChoroplethMapUF({
  ufSigla,
  municipios,
  mode,
  height = 360,
  detalhe,
  candidatos,
}: ChoroplethMapUFProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const municipiosRef = useRef(municipios);

  /**
   * 2026-09-20 — "no toque só a gaveta" (pedido do dono). O `mount()` abaixo
   * roda uma vez (deps `[ufSigla, mode]`, ver o efeito) e fecha sobre uma
   * REF, nunca sobre `temPonteiroFino` direto: o valor nasce `true`
   * (`useHasFinePointer`, ver a docstring de lá) e um aparelho de toque real
   * só corrige isso um tick depois do `useEffect` do `matchMedia` — uma
   * closure congelaria o valor de montagem. Mesmo padrão de
   * `navegarNoCliqueRef` em `_NationalChoroplethMapImpl.tsx`.
   */
  const temPonteiroFino = useHasFinePointer();
  const bloqueiaBalaoNoToqueRef = useRef(!temPonteiroFino);
  useEffect(() => {
    bloqueiaBalaoNoToqueRef.current = !temPonteiroFino;
  }, [temPonteiroFino]);

  /**
   * Wrapper de medição do `<HoverCard>` + cache do último tamanho REAL
   * conhecido — mesmo par do mapa nacional (`_NationalChoroplethMapImpl.tsx`),
   * mesma razão: ver `lib/utils/hover-card-placement.ts` § "Onde a medição
   * mora". `display: "contents"` no wrapper, nenhum `ref`/`"use
   * client"`/`useLayoutEffect` no `<HoverCard>`.
   */
  const hoverCardBoxRef = useRef<HTMLDivElement>(null);
  const cardSizeRef = useRef<{ width: number; height: number }>(HOVER_CARD_FALLBACK_SIZE);

  useEffect(() => {
    municipiosRef.current = municipios;
  }, [municipios]);

  // `<HoverCard>` (2026-09-18, 2ª correção de rota) — `detalhe`/`candidatos`
  // só são lidos no RENDER, nunca de dentro do handler de `mousemove`: o
  // handler (nascido em `mount()`, efeito de deps `[ufSigla, mode]`) só
  // guarda `codIbge` no estado (ver docstring de `MunicipioTooltipState`).
  // Isso é o que faz o card aparecer sozinho quando `detalhe`/`candidatos`
  // chegam DEPOIS do hover (busca assíncrona no pai) — sem exigir um novo
  // `mousemove`: a prop muda, o componente re-renderiza, `detalheMap` e
  // `candidatosAtuais` resolvem de novo com o `codIbge` que já estava salvo.
  const detalheMap = useMemo(
    () => new Map((detalhe ?? []).map((m) => [m.cod_ibge, m] as const)),
    [detalhe],
  );
  const candidatosAtuais = candidatos ?? [];

  const [tooltip, setTooltip] = useState<MunicipioTooltipState | null>(null);
  // `null` sempre que `tooltip` é `null` OU `detalheMap` ainda não resolve o
  // `codIbge` guardado nele — junta as duas condições num só valor pra não
  // espalhar `tooltip?.x ?? 0` pelo JSX abaixo (TS não sabe correlacionar
  // "`municipioTooltip` truthy" com "`tooltip` não é null" sozinho).
  const municipioTooltip =
    tooltip && detalheMap.has(tooltip.codIbge)
      ? { pos: tooltip, municipio: detalheMap.get(tooltip.codIbge) as EdgeUfMunicipio }
      : null;

  // Hover consumer: reage ao hover externo (tabela → mapa)
  const hoveredIbge = useHoverStore((s) =>
    s.hovered?.type === "municipio" ? s.hovered.codIbge : null,
  );

  // Map init — runs on ufSigla or mode change. municipios colors handled by separate effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapa é ilha React; municipios gerido por efeito separado
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    registerPmtilesProtocolOnce();

    const bbox = UF_BBOX[ufSigla] ?? [-73.99, -33.75, -28.84, 5.27];

    // Bloco 2 (2026-09-09): recorta só os municípios da UF aberta, não os
    // 5.570 do Brasil inteiro (antes só a câmera enquadrava a UF; os
    // vizinhos ficavam desenhados em volta). Sigla não reconhecida (nunca
    // deveria acontecer, `ufSigla` vem de rota validada) cai em `-1` via
    // `ufFloorFilter` — filtro não casa nada, mesma postura defensiva do
    // fallback de bbox acima.
    const ufFilter = ufFloorFilter(ufSigla);

    // A11y RNF-026: respeita prefers-reduced-motion. Anula transição de
    // fill-color que anima trocas leader↔estimate.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fillTransition = prefersReducedMotion
      ? { duration: 0, delay: 0 }
      : { duration: 600, delay: 0 };

    let hangTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;
    // ADR-0071 — o que o mapa VIVO pendurou fora dele (listener de media query,
    // registro dos botões na store). Cai ANTES de `map.remove()` no retry do
    // self-heal e no unmount: controle apontando para mapa destruído é o erro
    // a evitar (trocar de UF recria o mapa).
    let detachInteraction: (() => void) | null = null;
    let detachZoomControls: (() => void) | null = null;
    function desligarDoMapaVivo() {
      detachInteraction?.();
      detachZoomControls?.();
      detachInteraction = null;
      detachZoomControls = null;
    }

    // Self-heal — mesma causa raiz do mapa nacional (ver
    // `_pmtiles-protocol.ts` e `_NationalChoroplethMapImpl.tsx`): uma
    // Promise de header/diretório do pmtiles que falhe ou nunca assente
    // fica cacheada pra sempre no `Protocol` (singleton de sessão de aba).
    function mount(): maplibregl.Map {
      attempt += 1;
      const map = new maplibregl.Map({
        container,
        style: {
          version: 8,
          sources: {
            municipios: {
              type: "vector",
              url: `pmtiles://${PMTILES_BASE}/municipios.pmtiles`,
              // `promoteId` é obrigatório para o `setFeatureState` abaixo
              // funcionar. Os tiles carregam o código IBGE na PROPRIEDADE
              // `CD_MUN` (é por ela que o hover filtra, mais abaixo), mas não
              // têm `id` de feature — e `setFeatureState({ id })` casa pelo id,
              // não por propriedade. Sem esta linha toda chamada de
              // `setFeatureState` é silenciosamente descartada, o
              // `["feature-state", "color"]` nunca resolve, e o `coalesce` pinta
              // o estado inteiro com o cinza de fallback. Medido em 2026-09-09
              // em `/uf/SP`: 269 municípios com dado, nenhum pintado.
              promoteId: "CD_MUN",
            },
          },
          layers: [
            {
              id: "municipios-fill",
              type: "fill",
              source: "municipios",
              "source-layer": "municipios",
              // Só os municípios da UF aberta (Bloco 2, ver `ufFilter` acima).
              filter: ufFilter,
              paint: {
                "fill-color": ["coalesce", ["feature-state", "color"], "#d9d9d9"],
                "fill-color-transition": fillTransition,
                "fill-opacity": 0.88,
              },
            },
            // RNF-035 (SC 1.4.11) — HALO, duas linhas, como o mapa nacional.
            //
            // Até 18/09 (3ª sessão) este mapa tinha UMA linha, `#ffffff`
            // **cravada no código** — não token. Medido nas 54 cores que ESTE
            // mapa realmente pinta (as 33 bases de partido + `--color-tossup`
            // + os 7 `--color-cand-*` + os 7 `--color-cand-band-*` de fallback
            // por rank — ele NÃO usa a escala de margem `-1..5`, que é do mapa
            // nacional; a cor vem de `municipios[].cor`, a cor-base do líder):
            //
            //   contra o `#ffffff` cravado ..... 14 reprovam 3:1 no claro,
            //                                    17 no escuro
            //   contra as DUAS linhas do halo ... 0 e 0
            //
            // Piores do claro: `--party-none` 1,28 · as seis faixas
            // `--color-cand-band-*` 1,43 a 1,63 · `--party-tie` 1,90. No escuro
            // é pior e por outro motivo: as cores de partido são mais CLARAS lá
            // (`--party-psol` #ffd47d mede 1,40 contra branco), e um traço
            // branco cravado num tema escuro é a única coisa da tela que não
            // sabe que o tema mudou.
            //
            // 🔴 Por isso o remédio é TOKEN, não outra cor cravada: no claro
            // `--map-stroke` é #fbfbfc e `--map-stroke-focus` é #14171b; no
            // escuro os dois **trocam de lado** (#14171b e #eceef1). É o mesmo
            // par do nacional (`ufs-stroke-halo` + `ufs-stroke`), e sempre uma
            // das duas alcança o piso.
            //
            // ⚠️ As espessuras NÃO são as do nacional (1,4 + 0,6). Município é
            // polígono pequeno e denso — 5.570 contra 27, e 645 só em SP — e o
            // traço do nacional deixaria o mapa sujo. Aqui é 0,9 + 0,35: mesma
            // proporção num traço mais fino, com o total perto do 0,5 anterior.
            {
              id: "municipios-stroke-halo",
              type: "line",
              source: "municipios",
              "source-layer": "municipios",
              filter: ufFilter,
              paint: {
                "line-color": resolveCssColor("var(--map-stroke, #fbfbfc)"),
                "line-width": 0.9,
              },
            },
            {
              id: "municipios-stroke",
              type: "line",
              source: "municipios",
              "source-layer": "municipios",
              filter: ufFilter,
              paint: {
                "line-color": resolveCssColor("var(--map-stroke-focus, #14171b)"),
                "line-width": 0.35,
              },
            },
            {
              id: "municipios-stroke-hover",
              type: "line",
              source: "municipios",
              "source-layer": "municipios",
              paint: {
                "line-color": resolveCssColor("var(--map-stroke-focus, #14171b)"),
                "line-width": 2.5,
              },
              // `["all", ufFilter, ...]` — o hover (abaixo) substitui esse
              // filtro inteiro via `setFilter`; sem re-incluir `ufFilter` a
              // cada chamada, o realce voltaria a poder casar um município
              // de fora da UF.
              filter: ["all", ufFilter, ["==", ["get", "CD_MUN"], ""]],
            },
          ],
        },
        bounds: bbox,
        fitBoundsOptions: { padding: 16 },
        attributionControl: false,
        // ADR-0071 (2026-10-03) — computador amplia com a roda; celular usa
        // gestos cooperativos (um dedo rola a página); duplo clique, rotação,
        // caixa de seleção e teclado no canvas desligados. Modo por largura
        // ligado logo abaixo (`attachInteractionMode`); ver `_map-interaction.ts`.
        ...MAP_INTERACTION_OPTIONS,
      });

      mapRef.current = map;

      hangTimer = window.setTimeout(() => {
        if (cancelled || map.isStyleLoaded()) return;
        if (attempt >= 2) {
          console.error(
            "[ChoroplethMapUF] estilo pmtiles não carregou após retry — ver components/atoms/maps/_pmtiles-protocol.ts",
          );
          return;
        }
        console.warn(
          "[ChoroplethMapUF] estilo não carregou em " +
            `${STYLE_LOAD_TIMEOUT_MS}ms — reinicializando protocolo pmtiles (retry ${attempt})`,
        );
        resetPmtilesProtocol();
        desligarDoMapaVivo();
        map.remove();
        mount();
      }, STYLE_LOAD_TIMEOUT_MS);

      // A11y (RNF-025 / docs/mapas/acessibilidade.md): MapLibre atribui
      // `aria-label="Map"` fixo ao `<canvas>` interno, e o canvas nasce
      // focável (`tabindex="0"`) — um leitor de tela chega a ele com um rótulo
      // genérico que ignora o `aria-label` real do container (`label`,
      // abaixo). O container já é `role="img"` com o rótulo correto; o canvas
      // não deve competir com ele por atenção do leitor de tela. `aria-hidden`
      // remove o canvas da árvore de acessibilidade — a alternativa textual
      // (lista paralela / tabela de municípios, spec 004) é o caminho de
      // teclado e leitor de tela, não o canvas em si.
      const canvas = map.getCanvas();
      canvas.setAttribute("aria-hidden", "true");
      canvas.removeAttribute("aria-label");
      canvas.tabIndex = -1;

      detachInteraction = attachInteractionMode(map);

      map.on("load", () => {
        window.clearTimeout(hangTimer);
        // ADR-0071 — limites DEPOIS do enquadramento inicial (o `fitBounds` do
        // construtor já rodou): piso = o próprio enquadramento da UF; teto = z11
        // (os tiles vão até z10, z11 é sobre-amostragem leve; nunca abaixo do
        // piso + 2, para UF minúscula numa tela grande); sem arrastar para
        // longe da UF.
        const enquadramento = { ...map.getCenter(), zoom: map.getZoom() };
        applyZoomLimits(map, {
          // Piso também nunca abaixo de z3, o primeiro nível dos tiles
          // municipais (contêiner 0×0 no `load` daria zoom ~0 e mapa em branco).
          minZoom: Math.max(enquadramento.zoom, 3),
          maxZoom: Math.max(11, enquadramento.zoom + 2),
          base: bbox,
        });
        // Botões +/−/⟲ (fora do chunk do mapa) via store. "Ver o estado
        // inteiro" refaz o mesmo `fitBounds` do construtor.
        detachZoomControls?.();
        detachZoomControls = attachZoomControls(map, {
          resetLabel: "Ver o estado inteiro",
          home: () => {
            const cam = map.cameraForBounds(bbox, { padding: 16 });
            return cam?.center != null && cam.zoom != null
              ? { ...toLngLat(cam.center), zoom: Math.max(cam.zoom, map.getMinZoom()) }
              : { lng: enquadramento.lng, lat: enquadramento.lat, zoom: enquadramento.zoom };
          },
          reset: () => {
            // Sem `essential: true`: sob `prefers-reduced-motion` o MapLibre
            // zera a duração e a câmera salta. `linear`: sem ele o `fitBounds`
            // usa `flyTo` (arco de afastar-e-aproximar), estranho em 400 ms; com
            // ele é o mesmo `easeTo` que o mapa do Brasil usa.
            map.fitBounds(bbox, { padding: 16, duration: ZOOM_RESET_MS, linear: true });
          },
        });
        // Aplica cores iniciais. `resolveCssColor` é obrigatório: `m.cor` chega
        // como token (`var(--color-cand-1)`) e o MapLibre não lê variável CSS —
        // sem resolver, todo município cai no cinza do `coalesce` acima.
        for (const m of municipiosRef.current) {
          map.setFeatureState(
            { source: "municipios", sourceLayer: "municipios", id: m.cod_ibge },
            { color: resolveCssColor(m.cor) },
          );
        }
      });

      // Hover producer + `<HoverCard>` (2026-09-18). Guarda só `codIbge` — a
      // resolução para `EdgeUfMunicipio` (via `detalheMap`, prop `detalhe`)
      // acontece no RENDER, não aqui (ver docstring de `MunicipioTooltipState`).
      // Sem `detalhe`/`candidatos`, o balão simplesmente não aparece (`
      // municipioTooltip` fica `undefined` no render) — hover-store e traço
      // continuam funcionando normalmente de qualquer jeito.
      //
      // 🔴 2026-09-20 — `bloqueiaBalaoNoToqueRef` é a PRIMEIRA linha. Sem
      // ponteiro fino, NADA abaixo roda (nem hover-store, nem o filtro de
      // traço, nem o balão): Safari/Chrome em toque disparam este
      // `mousemove` sintético ANTES do `click`, e como `mouseleave` nunca
      // dispara num tap, deixar o filtro de traço rodar aqui acenderia o
      // contorno do município tocado E NUNCA O APAGARIA — ficaria aceso por
      // baixo da folha que o `click` abre. Ver a docstring do topo do arquivo.
      const onMouseMove = throttle(
        (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (bloqueiaBalaoNoToqueRef.current) return;
          const feature = e.features?.[0];
          if (!feature) return;
          const codIbge = feature.properties?.CD_MUN as string | undefined;
          if (!codIbge) return;

          useHoverStore.getState().setHovered({ type: "municipio", codIbge }, "map");
          map.setFilter("municipios-stroke-hover", [
            "all",
            ufFilter,
            ["==", ["get", "CD_MUN"], codIbge],
          ]);
          map.getCanvas().style.cursor = "pointer";

          const rect = container.getBoundingClientRect();
          const x = e.originalEvent.clientX - rect.left;
          const y = e.originalEvent.clientY - rect.top;
          // 🔴 2026-09-20 — mesmo remédio do mapa nacional: `flip`/`flipY`
          // saem de "o cartão, do tamanho que ele TEM (`cardSizeRef`, medido
          // de verdade pelo `useLayoutEffect` abaixo), cabe daqui até a
          // borda?" — não mais do proxy "passou da metade do contêiner?".
          // Ver `lib/utils/hover-card-placement.ts`.
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
            codIbge,
          });
        },
        16,
      );

      map.on("mousemove", "municipios-fill", onMouseMove);

      map.on("mouseleave", "municipios-fill", () => {
        useHoverStore.getState().clear();
        map.setFilter("municipios-stroke-hover", ["all", ufFilter, ["==", ["get", "CD_MUN"], ""]]);
        map.getCanvas().style.cursor = "";
        setTooltip(null);
      });

      // ADR-0071 — o balão é ancorado em pixel de TELA; quando o mapa se move
      // por baixo dele (roda, pinça, botões, arraste) ficaria preso na posição
      // antiga, apontando para outro município. Fecha no começo do movimento; o
      // próximo `mousemove` reabre no lugar certo. Só limpa a store se o hover
      // era do mapa — o destaque vindo da tabela não é nosso para apagar.
      const fecharBalaoAoMover = () => {
        const doMapa = useHoverStore.getState().source === "map";
        if (doMapa) useHoverStore.getState().clear();
        setTooltip(null);
        // O contorno aceso pela tabela (hover externo) continua aceso; só o que
        // o próprio mapa acendeu é apagado.
        if (doMapa && map.isStyleLoaded()) {
          map.setFilter("municipios-stroke-hover", [
            "all",
            ufFilter,
            ["==", ["get", "CD_MUN"], ""],
          ]);
        }
        map.getCanvas().style.cursor = "";
      };
      map.on("movestart", fecharBalaoAoMover);
      map.on("zoomstart", fecharBalaoAoMover);

      // Clique no município: realça (era o único efeito até 2026-09-10, e é o
      // que serve o tap-to-select do mobile) E abre a folha do município — o
      // `MunSheet` do protótipo, aberto a partir do mapa
      // (`ui_kits/atlas-menna/App.jsx:311`).
      //
      // 🔴 2026-09-20 — correção de premissa: este comentário dizia "onde não
      // há `mousemove`" sobre o mobile. É FALSO (ver a docstring do topo do
      // arquivo) — Safari/Chrome disparam um `mousemove` sintético antes do
      // `click` em qualquer toque; a guarda `bloqueiaBalaoNoToqueRef` no
      // handler de `mousemove` acima é quem trata isso, não uma ausência de
      // evento. O clique em si sempre foi, e continua sendo, o único caminho
      // que ABRE a folha (o handler de `mousemove` nunca chamou
      // `useMunicipioSheetStore`).
      //
      // A folha em si é a que já existe, desenhada pelo `<MunicipioExplorer>`
      // da página de UF; aqui só se escreve o `cod_ibge` no store compartilhado
      // (`components/shared/municipio-sheet-store.ts`), que é o que atravessa
      // as duas colunas do `<AppShellSplit>`. Nenhuma segunda folha é criada.
      //
      // `getState()` e não o hook: este handler é registrado uma vez dentro do
      // `mount()` e sobrevive a re-renders — um `select` capturado por closure
      // envelheceria junto com ela.
      map.on("click", "municipios-fill", (e) => {
        const feature = e.features?.[0];
        const codIbge = feature?.properties?.CD_MUN as string | undefined;
        if (codIbge) {
          useHoverStore.getState().setHovered({ type: "municipio", codIbge }, "map");
          useMunicipioSheetStore.getState().select(codIbge);
        }
      });

      return map;
    }

    mount();

    // `mapRef.current` (não a variável local do 1º `mount()`) porque um
    // retry do self-heal troca a instância viva sem que este cleanup saiba —
    // ver mesmo comentário em `_NationalChoroplethMapImpl.tsx`.
    return () => {
      cancelled = true;
      window.clearTimeout(hangTimer);
      desligarDoMapaVivo();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ufSigla, mode]);

  // Update colors when municipios prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    for (const m of municipios) {
      map.setFeatureState(
        { source: "municipios", sourceLayer: "municipios", id: m.cod_ibge },
        { color: resolveCssColor(m.cor) },
      );
    }
  }, [municipios]);

  // Hover consumer: highlight feature when external source hovers.
  // Recalcula `ufFilter` aqui (não reusa o da montagem, closure separada) —
  // precisa do mesmo `["all", ufFilter, ...]` do producer (linhas acima)
  // pra não destacar um município fora da UF aberta (Bloco 2).
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    map.setFilter("municipios-stroke-hover", [
      "all",
      ufFloorFilter(ufSigla),
      ["==", ["get", "CD_MUN"], hoveredIbge ?? ""],
    ]);
  }, [hoveredIbge, ufSigla]);

  const label =
    mode === "estimate"
      ? `Mapa de estimativa por município — ${ufSigla}`
      : `Mapa de líder por município — ${ufSigla}`;

  /**
   * Mede o `<HoverCard>` de verdade e corrige `flip`/`flipY`/`x`/`y` antes do
   * navegador pintar — mesmo mecanismo, mesma docstring longa, do mapa
   * nacional (`_NationalChoroplethMapImpl.tsx`). Dependência em
   * `municipioTooltip?.municipio` (não em `tooltip` inteiro, e não em
   * `pos.x`/`pos.y`): é a MESMA referência enquanto o ponteiro continua sobre
   * o MESMO município — só muda quando o município hoverado troca, ou
   * `detalhe` é substituído (busca assíncrona, não movimento do mouse).
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: de propósito — ver a docstring acima
  useLayoutEffect(() => {
    const container = containerRef.current;
    const cardEl = hoverCardBoxRef.current?.firstElementChild as HTMLElement | null;
    if (!municipioTooltip || !container || !cardEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    cardSizeRef.current = { width: cardRect.width, height: cardRect.height };
    const containerRect = container.getBoundingClientRect();
    const { pos } = municipioTooltip;
    const placement = computeHoverCardPlacement({
      x: pos.x,
      y: pos.y,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
    });
    if (
      placement.flip !== pos.flip ||
      placement.flipY !== pos.flipY ||
      placement.x !== pos.x ||
      placement.y !== pos.y
    ) {
      setTooltip((prev) => (prev ? { ...prev, ...placement } : prev));
    }
  }, [municipioTooltip?.municipio]);

  return (
    <div style={{ position: "relative", height }}>
      <div ref={containerRef} role="img" aria-label={label} style={{ width: "100%", height }} />
      {/* `<HoverCard>` (2026-09-18) — mesmo átomo do mapa nacional, sem a
          coluna "Proj." (ver docstring do topo do arquivo).
          `municipioTooltip` (não `tooltip` sozinho) é a condição: sem
          `detalhe` resolvendo este `codIbge` (ainda não chegou, ou o
          município não está no payload), NENHUM cartão aparece — degradação
          honesta em vez de um balão pela metade.
          `display: "contents"` — wrapper de medição, ver `hoverCardBoxRef`
          acima. */}
      {municipioTooltip ? (
        <div ref={hoverCardBoxRef} style={{ display: "contents" }}>
          <HoverCard
            x={municipioTooltip.pos.x}
            y={municipioTooltip.pos.y}
            flip={municipioTooltip.pos.flip}
            flipY={municipioTooltip.pos.flipY}
            // Sem sufixo de UF (ao contrário do balão nacional, que escreve
            // "Minas Gerais (MG)"): ali a ambiguidade é real — o mapa cobre as
            // 27 UFs ao mesmo tempo. Aqui o mapa já está dentro de UMA UF
            // (`/uf/[sigla]`), o mesmo escopo em que a folha do clique
            // (`MunicipioExplorer`) também titula só pelo nome do município e
            // deixa a UF no kicker ("Município · SP") — repetir a UF no título
            // do balão seria ruído que a tela já resolveu de outro jeito.
            title={municipioTooltip.municipio.nome}
            // "Capital" no lugar de um "% apurado" redundante com o cabeçalho
            // abaixo — mesmo dado que o kicker da folha já mostra
            // (`MunicipioExplorer`, `Município · UF · capital`).
            kicker={municipioTooltip.municipio.capital ? "Capital" : undefined}
            // `pct_apurado` do MUNICÍPIO é a média ponderada pelo eleitorado
            // dos pares (município, zona) que caem nele — não um percentual
            // que o TSE publique pronto por município (ver
            // `fetch_municipio_aggregates`, `api/model/project.py`, e a nota
            // idêntica na folha, `MunicipioExplorer.tsx`).
            apurado={municipioTooltip.municipio.pct_apurado}
            rows={buildMunicipioHoverRows(municipioTooltip.municipio, candidatosAtuais)}
          />
        </div>
      ) : null}
    </div>
  );
}
