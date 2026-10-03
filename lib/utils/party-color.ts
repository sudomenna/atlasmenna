/**
 * lib/utils/party-color.ts
 *
 * Helper canônico para resolver cor de **partido/federação** por sigla.
 *
 * Princípios
 *   - Constituição § 2 (v1.3): paleta editorial própria do AtlasMenna, uma cor
 *     por partido, **ΔE76 ≥ 10** contra o hex oficial do partido (o gerador
 *     aplica um piso de 12, com 2 unidades de folga contra revisão de fonte, e
 *     mede contra **todos** os hexes oficiais documentados — primária,
 *     secundárias, fim de gradiente de manual e token de CSS do site). A cor é
 *     estável a noite inteira: "apenas a **intensidade** (claro↔saturado) pode
 *     variar com a margem projetada, nunca a matiz". Os tokens em
 *     `app/tokens-party.css` cumprem isso por construção — os 5 níveis de um
 *     partido têm matiz (h em CIE LCh) idêntica, só L* e C* mudam.
 *   - ADR-0024: mapeamento é por **sigla**, não por rank de apuração. Supersede
 *     o ADR-0013 (`lib/utils/cand-color.ts`), que fica como fallback até depois
 *     do 2º turno (25/10/2026) e **não deve ser usado em código novo**.
 *   - Determinismo (constituição § 6): mesma sigla → mesmo token, sempre. Sem
 *     `Math.random()`, sem estado global, sem dependência da ordem de apuração.
 *
 * Espelha `lib/utils/cand-color.ts` em forma (token → `var()`, hex resolvido
 * por `getComputedStyle` para o MapLibre, guarda de SSR), trocando o eixo:
 * sigla → token em vez de rank → token.
 *
 * Quem usa
 *   - **Componentes UI** — resolvem a cor a partir de `EdgeCandidate.partido`.
 *     O campo `EdgeCandidate.cor` do payload (hoje `var(--color-cand-N)`)
 *     continua no contrato por compatibilidade, mas o ADR-0024 manda **ignorá-lo**:
 *     nenhum componente novo deve consumir `c.cor` diretamente.
 *   - **Mapas (MapLibre)** — `setPaintProperty` não aceita `var()` em paint
 *     values; precisa do hex resolvido em runtime (ver `resolvePartyHex`).
 *
 * Cross-refs
 *   - Tokens: `app/tokens-party.css` (GERADO por `pnpm gen:party-scale`)
 *   - Gerador / colorimetria / ΔE76: `scripts/gen-party-scale.ts`
 *   - Hexes oficiais (com fonte): `scripts/data/party-official-hexes.json`
 *   - Gate de ΔE76 sobre o CSS commitado:
 *     `tests/unit/design-system/party-delta-e.test.ts`
 *   - Gate de contraste do par chip/tinta (§ 4):
 *     `tests/unit/design-system/party-chip-contrast.test.ts`
 *   - Gate de contraste da tinta de texto sobre o papel (§ 4):
 *     `tests/unit/design-system/party-text-contrast.test.ts`
 *   - ADR: `docs/architecture/adrs/0024-paleta-editorial-por-partido.md`
 */

import type { NeedleBand } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// Slugs conhecidos
// ---------------------------------------------------------------------------

/**
 * Partidos com token próprio em `app/tokens-party.css`.
 *
 * **Fonte da verdade é a tabela `PARTY_BASE` em `scripts/gen-party-scale.ts`**
 * (lá moram os hexes). Este set é a projeção dela para o runtime, e a sincronia
 * entre os dois é garantida por teste — `tests/unit/utils/party-color.test.ts`
 * lê o CSS gerado e confronta token a token, nos dois sentidos. Adicionar um
 * partido é: linha em `PARTY_BASE` → entrada em
 * `scripts/data/party-official-hexes.json` → `pnpm gen:party-scale` → sigla aqui.
 *
 * São os **30 partidos registrados para 2026** mais o fallback. Duas trocas de
 * nome que o TSE homologou e que valem para o leitor: `democrata` é o antigo
 * PMB (renomeado em 02/12/2025, nº 35) e `mobiliza` é o antigo PMN. As siglas
 * velhas não têm token e caem em `--party-outros` — se o feed do TSE ainda as
 * publicar, é aqui que um alias entraria.
 */
export const KNOWN_PARTY_SLUGS = new Set([
  "pt",
  "pl",
  "psd",
  "novo",
  "avante",
  "missao",
  "prtb",
  "up",
  "pco",
  "dc",
  "pstu",
  "pcb",
  "democrata",
  "republicanos",
  "psb",
  "rede",
  "pp",
  "pode",
  "cidadania",
  "agir",
  "psol",
  "mdb",
  "uniao",
  "prd",
  "pdt",
  "psdb",
  "pcdob",
  "pv",
  "solidariedade",
  "mobiliza",
  "ptb",
  "outros",
]);

/** Slug do fallback universal — sigla ausente, desconhecida ou de federação. */
export const PARTY_FALLBACK_SLUG = "outros";

/**
 * Hex de `--party-outros`, duplicado aqui só para o caminho de SSR (ver
 * `resolvePartyHex`). Mesmo padrão — e mesma justificativa — do `"#d9d9d9"`
 * em `resolveCandHex`: no servidor não há `getComputedStyle` para consultar.
 * Se mudar em `PARTY_BASE`, muda aqui; o teste de sincronia cobre.
 */
export const PARTY_FALLBACK_HEX = "#9aa0a8";

/** Níveis de intensidade por margem. 1 = disputa apertada, 5 = decisivo. */
export type PartyIntensity = 1 | 2 | 3 | 4 | 5;

/** Token CSS literal — usado direto em `style={{ background: ... }}`. */
export type PartyColorVar = `var(--party-${string})`;

// ---------------------------------------------------------------------------
// Normalização de sigla
// ---------------------------------------------------------------------------

/** Remove diacríticos: "MISSÃO" → "MISSAO", "PODEMOS" segue igual. */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Detecta se a sigla que chegou é de **federação** em vez de partido isolado.
 *
 * O ADR-0024 decidiu que federação usa a cor do **partido-líder** da federação
 * (o de mais votos/cadeiras dentro dela na corrida em questão) — e não uma cor
 * própria, para a paleta não se multiplicar a cada eleição conforme as
 * federações se reconfiguram.
 *
 * A composição de cada federação **vem no próprio feed do TSE**, não de uma
 * tabela deste repositório: o elemento `fed[]` do EA20 traz `com` (siglas dos
 * partidos componentes separadas por `/`) e `npar` (números dos partidos) —
 * ver `FederacaoSchema` em `lib/tse/ea20-schema.ts:135-146`. Nada aqui deve
 * hardcodar quem compõe qual federação: a composição muda a cada eleição e o
 * feed é a fonte.
 *
 * O que ainda falta é o passo de **eleger o líder** (o partido com mais
 * votos/cadeiras dentro da federação naquela corrida) e passar a sigla dele
 * para `colorForParty`. Enquanto o pipeline não entrega essa sigla resolvida,
 * federação cai em `--party-outros` em vez de receber um mapeamento inventado.
 *
 * A heurística é deliberadamente conservadora (palavra "federação"/"fed", ou
 * separador `/`/`+` entre siglas — "PT/PCdoB/PV", "PSOL + REDE"). Errar para
 * menos é inofensivo: uma federação não detectada também não está em
 * `KNOWN_PARTY_SLUGS` e cai no mesmo `--party-outros`. A função existe para
 * tornar o caso **legível** em log e teste, não para evitar um crash.
 */
export function isFederationSigla(sigla: string | null | undefined): boolean {
  const raw = (sigla ?? "").trim();
  if (raw.length === 0) return false;
  if (/[/+]/.test(raw)) return true;
  const ascii = deaccent(raw).toLowerCase();
  return ascii.includes("federacao") || /(^|\s)fed(\s|\.|$)/.test(ascii);
}

/**
 * Sigla do TSE → slug de token. Tolerante a caixa, espaço e pontuação, porque
 * o payload traz a sigla como o TSE a publica: `" pt "`, `"PT"`, `"PC do B"`,
 * `"União"` são todas formas plausíveis da mesma coisa.
 *
 * Sigla desconhecida, vazia, nula ou de federação → `"outros"`.
 *
 * Exemplos:
 *   normalizePartySlug("PT")        === "pt"
 *   normalizePartySlug("  MDB  ")   === "mdb"
 *   normalizePartySlug("Missão")    === "missao"
 *   normalizePartySlug("PC do B")   === "pcdob"
 *   normalizePartySlug("PT/PV")     === "outros"   (federação)
 *   normalizePartySlug(undefined)   === "outros"
 */
export function normalizePartySlug(sigla: string | null | undefined): string {
  if (sigla == null) return PARTY_FALLBACK_SLUG;
  if (isFederationSigla(sigla)) return PARTY_FALLBACK_SLUG;
  const slug = deaccent(sigla)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return KNOWN_PARTY_SLUGS.has(slug) ? slug : PARTY_FALLBACK_SLUG;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Cor base (identidade) do partido — a que vale em chip, barra, legenda e
 * qualquer superfície que não module por margem.
 *
 * Não é o mesmo que `intensityForParty(sigla, 4)`: desde 2026-09-07 os cinco
 * níveis são alvos fixos de L* / C* (é isso que faz a escala ordenar em toda
 * matiz), então o nível 4 é *vizinho* do base, não idêntico a ele. Identidade
 * → esta função; margem → `intensityForParty`.
 *
 *   colorForParty("PT")      === "var(--party-pt)"
 *   colorForParty("XYZ")     === "var(--party-outros)"
 */
export function colorForParty(sigla: string | null | undefined): PartyColorVar {
  return `var(--party-${normalizePartySlug(sigla)})`;
}

/**
 * Par pronto para uma superfície **sólida** com rótulo em cima — o caso de
 * `<PartyTag filled>`, e de qualquer chip/pílula que pinte o fundo com a cor do
 * partido e escreva por cima.
 *
 * **Por que um par, e não só a cor.** `colorForParty` devolve a identidade do
 * partido, que serve de contorno, ponto e legenda — mas não diz nada sobre que
 * tinta é legível em cima dela. Medido contra as duas tintas do kit (`--ink-0`
 * #14171b e `--paper-0` #fbfbfc), das 31 bases **19 pedem a tinta clara e 12
 * pedem a escura**: nenhuma tinta fixa serve, e um `color: var(--text-inverse)`
 * cravado no componente deixa PSOL (2,21:1), PSB (2,34:1), NOVO (2,89:1) e o
 * fallback cinza (2,55:1) abaixo do mínimo de 4,5:1 da constituição § 4.
 *
 * **Por que `background` não é sempre `colorForParty`.** Dois verdes de
 * meio-tom — MDB (#408a50: 4,25:1 contra o preto, 4,09:1 contra o branco) e
 * Rede (#3d8f3d: 4,45:1 e 3,91:1) — reprovam com as **duas** tintas. Para esses,
 * `--party-<slug>-chip` é a base escurecida na mesma matiz (o § 2 v1.3 permite
 * variar intensidade, nunca matiz), e o gerador mede o par resultante. Para os
 * outros 29, o chip **é** a base. Quem quer a identidade literal continua usando
 * `colorForParty`; quem vai escrever em cima usa este par.
 *
 * Os dois tokens andam juntos: usar `background` daqui com uma tinta de outro
 * lugar (ou vice-versa) desfaz a garantia que o gerador mediu.
 *
 * Sigla desconhecida, vazia ou de federação → o par de `outros`.
 *
 *   partyChipInk("PT")   // { background: "var(--party-pt-chip)",  ink: "var(--party-pt-ink)" }
 *   partyChipInk("XYZ")  // { background: "var(--party-outros-chip)", ink: "var(--party-outros-ink)" }
 */
export function partyChipInk(sigla: string | null | undefined): {
  background: PartyColorVar;
  ink: PartyColorVar;
} {
  const slug = normalizePartySlug(sigla);
  return {
    background: `var(--party-${slug}-chip)`,
    ink: `var(--party-${slug}-ink)`,
  };
}

/**
 * Cor do partido para **escrever texto sobre o papel** — o número grande de um
 * termômetro, o nome do líder numa lista, qualquer valor colorido por
 * identidade que seja texto e não área.
 *
 * **Por que não é `colorForParty`.** Aquela é a cor de *preenchimento*: serve de
 * contorno, ponto, barra e legenda, onde o que vale é a área. Como tinta sobre
 * `--surface-page` (#f3f4f6) quatro bases reprovam o piso de 4,5:1 da
 * constituição § 4 — PSOL 2,08:1, PSB 2,20:1, o fallback cinza 2,39:1 e NOVO
 * 2,72:1. Pintar texto com a base é a mesma classe de defeito que o
 * `a11y-perf-auditor` encontrou em `<ProjectionThermometer />` (o número em
 * `--color-cand-3`, 2,99:1), só que pelo eixo do partido.
 *
 * **Por que não é `partyChipInk().background`.** O chip é escolhido para
 * contrastar com uma das duas tintas do kit, e em 19 dos 31 partidos ele é uma
 * cor **clara** — o oposto do que serve como texto sobre papel claro.
 * `--party-psol-chip` é o próprio #d6a400.
 *
 * Onde a base já lê sobre o papel (17 dos 31), `--party-<slug>-text` **é** a
 * base. Nos outros 14 é a base escurecida na mesma matiz (§ 2 v1.3 permite
 * variar intensidade, nunca matiz), com o valor medido no comentário do CSS
 * gerado. O gate numérico está em
 * `tests/unit/design-system/party-text-contrast.test.ts`, que remede o CSS
 * commitado contra as duas superfícies.
 *
 * Sigla desconhecida, vazia ou de federação → o token de `outros`.
 *
 *   textForParty("PT")   === "var(--party-pt-text)"
 *   textForParty("XYZ")  === "var(--party-outros-text)"
 */
export function textForParty(sigla: string | null | undefined): PartyColorVar {
  return `var(--party-${normalizePartySlug(sigla)}-text)`;
}

/**
 * Cor do partido **na intensidade de um nível de margem** (1..5).
 * Nível fora de 1..5 (ou não inteiro) cai no nível 1 — o mais claro, que é a
 * leitura conservadora: na dúvida, "corrida apertada", nunca "decidida".
 *
 *   intensityForParty("MDB", 4) === "var(--party-mdb-4)"
 *   intensityForParty("XYZ", 2) === "var(--party-outros-2)"
 */
export function intensityForParty(
  sigla: string | null | undefined,
  nivel: PartyIntensity,
): PartyColorVar {
  const level = isValidIntensity(nivel) ? nivel : 1;
  return `var(--party-${normalizePartySlug(sigla)}-${level})`;
}

function isValidIntensity(n: number): n is PartyIntensity {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

// ---------------------------------------------------------------------------
// Margem → nível
// ---------------------------------------------------------------------------

/**
 * Limiares de margem (pp) que separam os 5 níveis. `[2, 5, 10, 15]` significa:
 * `<2` → 1, `[2,5)` → 2, `[5,10)` → 3, `[10,15)` → 4, `>=15` → 5.
 *
 * **De onde saiu cada número** (a constituição § 2 fala em "intensidade varia
 * com a margem", mas não fixa limiar; o produto já tinha os seus):
 *
 *   -  2 pp — teto do tossup. Literal de `marginToColor` em
 *      `components/blocks/_NationalChoroplethMapImpl.tsx` (`abs < 2` pinta
 *      `--color-tossup`). É a linha em que o produto já diz "isto é empate".
 *   -  5 pp — piso do "likely". **É o único valor novo desta tabela**: não há
 *      precedente de 5 pp no código. Fica a meio caminho entre os dois
 *      limiares fixados acima e abaixo dele, para não amontoar três níveis no
 *      intervalo 2–10.
 *   - 10 pp — piso do "very likely". Literal de `swingToColor` no mesmo
 *      arquivo (`abs >= 10` pinta `--color-band-very_likely`).
 *   - 15 pp — piso do "decisivo". Literal de `marginToColor` (`abs >= 15` troca
 *      a versão band pela cor sólida), que já é o ponto onde o produto para de
 *      hesitar visualmente.
 */
export const PARTY_INTENSITY_THRESHOLDS_PP = [2, 5, 10, 15] as const;

/**
 * Margem projetada (em pontos percentuais, sinal irrelevante) → nível 1..5.
 *
 * **Por que 5 níveis não mapeiam 1:1 nas 4 bandas de `NeedleBand`.**
 * `NeedleBand` tem 4 classes de magnitude — `tossup`, `lean`, `likely`,
 * `very_likely` — e a rampa do kit tem 5 intensidades. Elas não são a mesma
 * escala, e forçar bijeção seria inventar uma quinta banda que o modelo não
 * produz. O que existe de verdade no payload:
 *
 *   - níveis 1–4 **são** as 4 bandas, em ordem (ver `intensityLevelForBand`);
 *   - o nível 5 corresponde a um estado que o produto **já tem em campo
 *     separado**, não em `NeedleBand`: `EdgeUfRow.chamada === true` /
 *     `EdgeUfRow.bucket === "chamada" | "decidido_1t"` — a UF chamada para o
 *     líder. Ou seja, o nível 5 não é uma banda a mais: é o "já chamamos",
 *     que por construção fica acima de `very_likely`.
 *
 * Além disso `NeedleBand` é derivada de **probabilidade** (`|needle_position|`
 * com cortes 0,2 / 0,5 / 0,85, ver `docs/specs/002-modelo-estatistico/design.md`),
 * enquanto esta função recebe **margem em pp**. São eixos diferentes: 3 pp de
 * margem com 95% apurado é quase certeza, e com 2% apurado não é nada. Por isso
 * as duas funções coexistem — use `intensityLevelForBand` quando tiver a banda
 * do modelo (é a informação mais rica), e esta aqui quando só tiver a margem
 * (mapa de município, grid, tabela).
 *
 * Margem inválida (NaN, Infinity) → nível 1: sem margem confiável, a leitura
 * conservadora é "apertado", nunca "decidido".
 */
export function intensityLevelForMargin(margemPp: number): PartyIntensity {
  if (!Number.isFinite(margemPp)) return 1;
  const abs = Math.abs(margemPp);
  const [t1, t2, t3, t4] = PARTY_INTENSITY_THRESHOLDS_PP;
  if (abs < t1) return 1;
  if (abs < t2) return 2;
  if (abs < t3) return 3;
  if (abs < t4) return 4;
  return 5;
}

/**
 * Banda da agulha (`NeedleBand`, do modelo) → nível 1..4.
 *
 * Reaproveita a escala que o produto já publica no payload em vez de recomputar
 * a partir da margem. O sufixo `_a`/`_b` diz **quem** lidera e é descartado
 * aqui: a identidade vem da sigla, a banda só dá a intensidade — que é
 * exatamente a divisão de trabalho que a constituição § 2 exige.
 *
 * Nunca retorna 5: o "decisivo" não é uma banda da agulha, é o estado
 * `chamada`/`decidido_1t` da UF (ver `intensityLevelForMargin`). Componente que
 * tem esse sinal deve promover para 5 explicitamente:
 *
 *   const nivel = uf.chamada ? 5 : intensityLevelForBand(uf.needle_band);
 */
export function intensityLevelForBand(band: NeedleBand): 1 | 2 | 3 | 4 {
  switch (band) {
    case "tossup":
      return 1;
    case "lean_a":
    case "lean_b":
      return 2;
    case "likely_a":
    case "likely_b":
      return 3;
    case "very_likely_a":
    case "very_likely_b":
      return 4;
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Resolução para o MapLibre
// ---------------------------------------------------------------------------

/**
 * Resolve o hex (#rrggbb) em runtime no cliente. Necessário para
 * `MapLibre setPaintProperty`, que não aceita `var(--...)` em paint values —
 * precisa de string de cor literal.
 *
 * `nivel` omitido → token base do partido. Com `nivel`, o token de intensidade.
 *
 * SSR-safe: retorna `PARTY_FALLBACK_HEX` no servidor, onde não há `document` —
 * mesmo contrato de `resolveCandHex`. Componentes de mapa só renderizam no
 * cliente via `next/dynamic({ ssr: false })` (ADR-0010), então o caminho de SSR
 * não aparece em produção; ele existe para não quebrar `renderToStaticMarkup`
 * em teste/snapshot.
 *
 * Também cai no fallback quando `getComputedStyle` devolve string vazia — o que
 * acontece se `app/tokens-party.css` não estiver importado no `globals.css`, ou
 * se o `@theme` perder o `static` e o Tailwind podar os tokens. Sem esta
 * guarda o MapLibre receberia `""` e pintaria a camada de preto, em silêncio.
 */
export function resolvePartyHex(sigla: string | null | undefined, nivel?: PartyIntensity): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return PARTY_FALLBACK_HEX;
  }
  const slug = normalizePartySlug(sigla);
  const suffix = nivel !== undefined && isValidIntensity(nivel) ? `-${nivel}` : "";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--party-${slug}${suffix}`)
    .trim();
  return value === "" ? PARTY_FALLBACK_HEX : value;
}
