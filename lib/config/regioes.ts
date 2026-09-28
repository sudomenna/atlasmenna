/**
 * lib/config/regioes.ts
 *
 * As cinco grandes regiões do IBGE e a UF de cada uma — o agrupamento das
 * capas `/governador`, `/senador` e da home de Presidente (ADR-0057, decisão do
 * dono de 2026-09-28; protótipo em
 * `docs/design-system/prototipos/capas-regioes-2026-09-28/`).
 *
 * Tabela ESTÁTICA, de propósito. A divisão regional do IBGE é de 1969/1988 e
 * não muda entre eleições; derivá-la de um arquivo de malha ou de um campo do
 * payload criaria uma dependência de dado para um fato de geografia. É
 * identidade, não medição (a mesma regra dos 27 links de `<UfLinksGrid>`).
 *
 * A ORDEM também é fixa e é a ordem de exibição: Norte → Nordeste →
 * Centro-Oeste → Sudeste → Sul (a do IBGE, de cima para baixo no mapa). Não é
 * ordem por voto, por eleitorado nem por resultado — nenhuma região "vem
 * primeiro" porque alguém liderou nela (constituição § 2, ordem neutra).
 * Dentro de cada região as siglas estão em ordem alfabética, que é a ordem em
 * que as capas listavam os 27 cartões antes do agrupamento.
 */

export type RegiaoId = "norte" | "nordeste" | "centro_oeste" | "sudeste" | "sul";

export interface Regiao {
  id: RegiaoId;
  /** Nome de exibição, com acento. */
  nome: string;
  /** Siglas das UFs da região, em ordem alfabética. */
  siglas: readonly string[];
}

export const REGIOES: readonly Regiao[] = Object.freeze([
  { id: "norte", nome: "Norte", siglas: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"] },
  {
    id: "nordeste",
    nome: "Nordeste",
    siglas: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  },
  { id: "centro_oeste", nome: "Centro-Oeste", siglas: ["DF", "GO", "MS", "MT"] },
  { id: "sudeste", nome: "Sudeste", siglas: ["ES", "MG", "RJ", "SP"] },
  { id: "sul", nome: "Sul", siglas: ["PR", "RS", "SC"] },
] as const satisfies readonly Regiao[]);

/** UF → região. Sigla fora das 27 não tem região (`undefined`). */
export const REGIAO_DA_UF: Readonly<Record<string, RegiaoId>> = Object.freeze(
  Object.fromEntries(REGIOES.flatMap((r) => r.siglas.map((s) => [s, r.id] as const))),
);

export interface GrupoRegiao<T> {
  regiao: Regiao;
  /** As linhas desta região, na ordem de `regiao.siglas` (alfabética). */
  rows: T[];
}

/**
 * Agrupa linhas por região, na ordem de {@link REGIOES}. **As cinco regiões
 * sempre saem**, mesmo sem nenhuma linha — quem chama decide o que uma região
 * vazia significa na sua tela (em `/governador`, por exemplo, o filtro pode
 * esvaziar uma região e o consolidado dela continua valendo).
 *
 * Sigla fora das 27 é descartada, e sigla repetida entra uma vez só (a
 * primeira): cada estado é uma corrida.
 */
export function agruparPorRegiao<T extends { sigla: string }>(
  rows: readonly T[],
): GrupoRegiao<T>[] {
  const porSigla = new Map<string, T>();
  for (const row of rows) {
    if (!porSigla.has(row.sigla)) porSigla.set(row.sigla, row);
  }
  return REGIOES.map((regiao) => ({
    regiao,
    rows: regiao.siglas.flatMap((s) => {
      const row = porSigla.get(s);
      return row ? [row] : [];
    }),
  }));
}
