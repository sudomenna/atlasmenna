/**
 * components/atoms/maps/_shared.ts
 *
 * Utilitários compartilhados entre componentes de mapa (BubbleMap,
 * ChoroplethMap, SwingArrowMap, NationalChoroplethMap, etc.).
 *
 * Mantido leve a propósito — qualquer dep MapLibre/PMTiles deve ser
 * importada SÓ dentro do componente client que ativa, NUNCA daqui. Este
 * módulo deve ser server-safe.
 */

/**
 * Bounding box aproximada de cada UF — usado para enquadrar mapas estaduais
 * (BubbleMap, ChoroplethMap nível UF). Fonte: limites territoriais IBGE
 * aproximados (lon_min, lat_min, lon_max, lat_max).
 *
 * Estes números são "good enough" para o viewport inicial; o map-builder
 * pode refiná-los quando trocar para PMTiles reais.
 */
export const UF_BBOX: Record<string, [number, number, number, number]> = {
  AC: [-73.99, -11.15, -66.62, -7.11],
  AL: [-38.24, -10.5, -35.15, -8.81],
  AM: [-73.81, -9.82, -56.1, 2.25],
  AP: [-54.88, -1.23, -49.88, 4.43],
  BA: [-46.62, -18.35, -37.34, -8.53],
  CE: [-41.42, -7.86, -37.25, -2.78],
  DF: [-48.28, -16.05, -47.31, -15.5],
  ES: [-41.88, -21.31, -39.66, -17.89],
  GO: [-53.25, -19.5, -45.91, -12.4],
  MA: [-48.75, -10.27, -41.79, -1.04],
  MG: [-51.05, -22.93, -39.86, -14.23],
  MS: [-58.17, -24.07, -50.92, -17.16],
  MT: [-61.63, -18.04, -50.22, -7.35],
  PA: [-58.9, -9.84, -46.06, 2.59],
  PB: [-38.77, -8.3, -34.79, -6.03],
  PE: [-41.36, -9.48, -34.81, -7.32],
  PI: [-45.99, -10.93, -40.37, -2.74],
  PR: [-54.62, -26.72, -48.02, -22.52],
  RJ: [-44.89, -23.37, -40.96, -20.76],
  RN: [-38.59, -6.97, -34.96, -4.83],
  RO: [-66.81, -13.69, -59.78, -7.97],
  RR: [-64.82, -1.58, -58.89, 5.27],
  RS: [-57.65, -33.75, -49.69, -27.08],
  SC: [-53.84, -29.36, -48.36, -25.96],
  SE: [-38.25, -11.57, -36.39, -9.51],
  SP: [-53.11, -25.31, -44.16, -19.78],
  TO: [-50.74, -13.47, -45.69, -5.17],
};

/**
 * Total de municípios por UF — contagem IBGE, estável (não muda com a
 * eleição). Soma 5.570, o total nacional oficial. Usado pelo chip que a
 * moldura persistente do mapa sobrepõe ao coroplético municipal
 * (`components/layout/PersistentMapFrame.tsx`, ADR-0033 § 1) — mesmo texto
 * do protótipo (`App.jsx:314`, `sigla + ' · ' + n + ' mun.'`), onde `n` é o
 * total de municípios da UF, não quantos têm dado apurado.
 */
export const MUNICIPIOS_POR_UF: Record<string, number> = {
  AC: 22,
  AL: 102,
  AM: 62,
  AP: 16,
  BA: 417,
  CE: 184,
  DF: 1,
  ES: 78,
  GO: 246,
  MA: 217,
  MG: 853,
  MS: 79,
  MT: 141,
  PA: 144,
  PB: 223,
  PE: 185,
  PI: 224,
  PR: 399,
  RJ: 92,
  RN: 167,
  RO: 52,
  RR: 15,
  RS: 497,
  SC: 295,
  SE: 75,
  SP: 645,
  TO: 139,
};

/** Total de municípios da UF, ou `0` se a sigla não é reconhecida. */
export function municipiosTotalFor(sigla: string): number {
  return MUNICIPIOS_POR_UF[sigla.toUpperCase()] ?? 0;
}

/**
 * Código IBGE de UF (2 dígitos) — os 2 primeiros dígitos de qualquer código
 * de município de 7 dígitos (`CD_MUN`) da UF. Tabela oficial IBGE, estável.
 *
 * Usado pelo filtro de `ChoroplethMapUF` (Bloco 2, 2026-09-09): o protótipo
 * (`docs/design-system/atlas-menna/ui_kits/atlas-menna/MapView.jsx:29`) filtra
 * `Math.floor(f.id / 100000) === level`, onde `level` é este código — aqui a
 * mesma lógica vira uma expression MapLibre (`floor(CD_MUN / 100000) === N`)
 * pra desenhar só os municípios da UF aberta, não os 5.570 do Brasil inteiro.
 */
export const UF_CODIGO_IBGE: Record<string, number> = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
};

/** Código IBGE de UF (2 dígitos), ou `undefined` se a sigla não é reconhecida. */
export function ufCodigoIbge(sigla: string): number | undefined {
  return UF_CODIGO_IBGE[sigla.toUpperCase()];
}

/**
 * Nome por extenso de cada UF — o rótulo do seletor de UF
 * (`components/layout/UfPicker.tsx`), que o protótipo ordena por NOME e não
 * por sigla (`AM.UF.slice().sort((a, b) => a.nome.localeCompare(b.nome))`,
 * `ui_kits/atlas-menna/App.jsx:364`).
 *
 * Terceira cópia desta tabela no repositório — as outras duas estão em
 * `components/blocks/StateResultSheet.tsx:54` e
 * `components/blocks/GovernorCard.tsx`, cada uma com o comentário "sem módulo
 * compartilhado pra este propósito, então repetida aqui". Agora há: este.
 * Unificar as três é limpeza pendente (não feita aqui para não mexer em dois
 * blocos fora do escopo da mudança que trouxe o seletor).
 */
export const UF_NOMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

/**
 * Nome do EXTERIOR (sigla `ZZ` do TSE) para o leitor — ADR-0045 item 7.
 *
 * Fica FORA de `UF_NOMES` de propósito: aquela tabela alimenta o seletor de
 * UF, a grade de links, o placar zerado de Governador/Senador e o desfecho de
 * governador — superfícies em que o exterior não existe (só vota para
 * Presidente). Quem precisa do nome de uma unidade de apuração PRESIDENCIAL
 * usa {@link nomeDaUnidade}.
 */
export const NOME_EXTERIOR = "Exterior";

/**
 * Nome por extenso de uma unidade de apuração: a UF (`"SP"` → `"São Paulo"`)
 * ou o exterior (`"ZZ"` → `"Exterior"`). Sigla desconhecida volta como veio —
 * mas `"ZZ"` cru NUNCA chega ao leitor por aqui. Caixa indiferente.
 */
export function nomeDaUnidade(sigla: string): string {
  const s = sigla.toUpperCase();
  if (s === "ZZ") return NOME_EXTERIOR;
  return UF_NOMES[s] ?? sigla;
}

/**
 * Rótulo CURTO de uma unidade de apuração, para onde a tela mostra a sigla
 * (tabelas, cartões): a própria sigla para as 27 UFs e `"Exterior"` para `ZZ`.
 */
export function rotuloDaUnidade(sigla: string): string {
  return sigla.toUpperCase() === "ZZ" ? NOME_EXTERIOR : sigla;
}

/**
 * As 27 UFs `{ sigla, nome }` ordenadas por NOME em pt-BR — a ordem do
 * seletor do protótipo. Determinístico (constituição § 6): mesma entrada,
 * mesma saída, sem depender do locale do runtime (o `"pt-BR"` é explícito).
 */
export function ufsPorNome(): Array<{ sigla: string; nome: string }> {
  return Object.entries(UF_NOMES)
    .map(([sigla, nome]) => ({ sigla, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Centro geográfico aproximado da UF (lon, lat). */
export function ufCenter(sigla: string): [number, number] {
  const box = UF_BBOX[sigla];
  if (!box) return [-50, -15]; // fallback: centro do Brasil
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

/**
 * Token semântico de cor por candidato — wrapper que mapeia o `id` do
 * candidato à variável CSS correspondente. NUNCA cor partidária oficial
 * (constituição § 2).
 *
 * Convenção: o caller decide o mapping `id → token`. Este helper só
 * formaliza o tipo do retorno.
 */
export type CandidateColorMap = Record<number, string>;

/**
 * Cinza de "sem cor resolvível" — o mesmo `#d9d9d9` que os mapas já usam como
 * fallback de `fill-color`, para que um token ausente não vire uma cor
 * inventada.
 */
const UNRESOLVED_FILL = "#d9d9d9";

/**
 * Resolve `var(--token)` para o hex literal do `:root` em runtime.
 *
 * **Por que existe** (bug medido em 2026-09-09): o payload entrega cor de
 * candidato como token — `cor: "var(--color-cand-1)"` — porque a constituição
 * § 2 proíbe hex partidário oficial cravado no código. Mas o MapLibre **não
 * interpreta variável CSS**: `setFeatureState({ color: "var(--x)" })` produz um
 * valor que a expressão `fill-color` não consegue ler, e o `coalesce` cai no
 * cinza de fallback. O sintoma é um estado inteiro com os municípios
 * desenhados e nenhum pintado — foi exatamente isso que apareceu em
 * `/uf/SP`.
 *
 * O mapa nacional já resolvia por conta própria (`_NationalChoroplethMapImpl`,
 * `getCssVar`); o de município não. Este helper é o ponto único, para os dois
 * não divergirem de novo.
 *
 * Aceita as três formas que aparecem no payload: hex literal (devolve como
 * está), `var(--token)` e `var(--token, #fallback)`.
 */
export function resolveCssColor(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return UNRESOLVED_FILL;
  if (!raw.startsWith("var(")) return raw;

  const inner = raw.slice(4, raw.lastIndexOf(")"));
  const comma = inner.indexOf(",");
  const token = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  const declaredFallback = comma === -1 ? "" : inner.slice(comma + 1).trim();

  // SSR: não há `:root` para consultar. O fallback declarado é melhor que nada.
  if (typeof window === "undefined") return declaredFallback || UNRESOLVED_FILL;

  const resolved = getComputedStyle(document.documentElement).getPropertyValue(token).trim();

  // Um token pode resolver para outro token (encadeamento de temas).
  if (resolved.startsWith("var(")) return resolveCssColor(resolved);
  return resolved || declaredFallback || UNRESOLVED_FILL;
}
