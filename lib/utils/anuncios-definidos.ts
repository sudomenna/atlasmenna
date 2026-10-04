/**
 * lib/utils/anuncios-definidos.ts
 *
 * Os TEXTOS ao público sobre "quem já está decidido" — a faixa "AGORA" do
 * topo (`<BreakingNewsTicker>`), a linha de definição do Boletim, a frase de
 * regra da caixa Análise e o histórico da leitura da noite. Decisão do dono em
 * 2026-10-04 (dia do 1º turno): esses textos seguem A MESMA REGRA do balão do
 * mapa nacional — só anunciam quem está MATEMATICAMENTE eleito (ou, no
 * Governador, o 2º turno definido pelo TSE), nunca a `chamada` da projeção.
 *
 * ## Por que não `EdgeUfRow.chamada`
 *
 * `chamada` é leitura da PROJEÇÃO (margem projetada > 10 pp). A faixa "AGORA"
 * dizia "AP chamada para CLÉCIO (UNIÃO)" enquanto o balão do mesmo estado já
 * não marcava ninguém — duas telas contando histórias diferentes. Aqui a única
 * fonte é {@link definicaoDaUf} (`EdgeUfRow.eleitos_definidos` /
 * `segundo_turno_definido`), e o nome sai do(s) **id(s) definido(s)**, nunca
 * do líder projetado (`EdgeUfRow.lider`).
 *
 * ## Presidente
 *
 * Ninguém é eleito presidente "numa UF": o produtor só emite o campo quando o
 * Brasil inteiro está definido, e aí o eleito aparece em TODA UF onde está no
 * top. Por isso, no cargo 1, a saída é UM anúncio nacional
 * ({@link eleitosNacionais}), nunca 27.
 *
 * Funções puras, sem React e sem I/O. Textos sem a palavra "chamada".
 */

import type { EdgeNational, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import {
  definicaoDaUf,
  ROTULO_ELEITO,
  ROTULO_ELEITOS,
  ROTULO_SEGUNDO_TURNO,
} from "@/lib/utils/eleitos-definidos";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

/** Prefixo do anúncio nacional (Presidente). */
export const PREFIXO_BRASIL = "Brasil";

/** "Matematicamente eleito" → "matematicamente eleito" (dentro da frase). */
function minuscula(s: string): string {
  return s.charAt(0).toLocaleLowerCase("pt-BR") + s.slice(1);
}

/** "A", "A e B", "A, B e C". */
function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

type RowNome = Pick<EdgeUfRow, "top_candidatos">;

/**
 * "NOME (PARTIDO)" pelo **id**: `top_candidatos` das linhas dadas primeiro,
 * `national.candidatos` depois. `null` quando o id não tem nome em lugar
 * nenhum — quem chama descarta (nunca anunciar um eleito sem nome).
 */
export function rotuloPorId(
  id: number,
  rows: readonly RowNome[],
  national?: Pick<EdgeNational, "candidatos"> | null,
): string | null {
  for (const r of rows) {
    const t = (r.top_candidatos ?? []).find((x) => x.id === id);
    if (t?.nome) {
      const n = nomeExibicao(t.nome, t.sqcand);
      return t.partido ? `${n} (${t.partido})` : n;
    }
  }
  const c = (national?.candidatos ?? []).find((x) => x.id === id);
  if (c?.nome) {
    const n = nomeExibicao(c.nome, c.sqcand);
    return c.partido ? `${n} (${c.partido})` : n;
  }
  return null;
}

type RowDefinicao = Pick<
  EdgeUfRow,
  "sigla" | "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido"
>;

/**
 * Presidente: os ids matematicamente eleitos no Brasil — a união do que
 * {@link definicaoDaUf} reconhece em cada UF, em ordem crescente. Vazio
 * enquanto o Brasil não está definido.
 */
export function eleitosNacionais(porUf: readonly RowDefinicao[] | undefined): number[] {
  const ids = new Set<number>();
  for (const row of porUf ?? []) {
    for (const id of definicaoDaUf(row).eleitos) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * "NOME (P) matematicamente eleito" / "A (X) e B (Y) matematicamente eleitos".
 * `null` se nenhum dos ids tem nome.
 */
export function fraseEleitos(
  ids: readonly number[],
  rows: readonly RowNome[],
  national?: Pick<EdgeNational, "candidatos"> | null,
): string | null {
  const nomes = ids
    .map((id) => rotuloPorId(id, rows, national))
    .filter((n): n is string => n !== null);
  if (nomes.length === 0) return null;
  const rotulo = nomes.length === 1 ? ROTULO_ELEITO : ROTULO_ELEITOS;
  return `${juntarNomes(nomes)} ${minuscula(rotulo)}`;
}

export interface AnuncioDefinicao {
  /** Chave estável: `BR` (Presidente) ou a sigla da UF. */
  chave: string;
  texto: string;
}

/**
 * Um anúncio por corrida DEFINIDA:
 *
 * - **Presidente (cargo 1)**: no máximo UM, nacional —
 *   `"Brasil: NOME (P) matematicamente eleito"`.
 * - **Governador / Senador**: um por UF, na ordem das siglas —
 *   `"AP: NOME (P) matematicamente eleito"`,
 *   `"MT: A (X) e B (Y) matematicamente eleitos"` (Senado, duas vagas) ou,
 *   só no Governador, `"AP: 2º turno definido"`.
 *
 * Nada aqui olha `chamada`, margem, `lider` ou posição.
 */
export function anunciosDeDefinicao(
  payload: Pick<EdgePayload, "cargo" | "por_uf" | "national">,
): AnuncioDefinicao[] {
  const porUf = payload.por_uf ?? [];

  if (payload.cargo === 1) {
    const frase = fraseEleitos(eleitosNacionais(porUf), porUf, payload.national);
    return frase ? [{ chave: "BR", texto: `${PREFIXO_BRASIL}: ${frase}` }] : [];
  }

  const saida: AnuncioDefinicao[] = [];
  const ordenadas = [...porUf].sort((a, b) => (a.sigla < b.sigla ? -1 : a.sigla > b.sigla ? 1 : 0));
  for (const row of ordenadas) {
    const def = definicaoDaUf(row);
    if (def.eleitos.size > 0) {
      const frase = fraseEleitos([...def.eleitos], [row], payload.national);
      if (frase) saida.push({ chave: row.sigla, texto: `${row.sigla}: ${frase}` });
      continue;
    }
    if (def.rotulo === ROTULO_SEGUNDO_TURNO) {
      saida.push({ chave: row.sigla, texto: `${row.sigla}: ${ROTULO_SEGUNDO_TURNO}` });
    }
  }
  return saida;
}

/**
 * Os itens da faixa "AGORA" (`<BreakingNewsTicker>`). A hora é a do payload
 * (`EdgePayload.ts`, o ciclo do modelo que trouxe o estado) — a mesma que o
 * campo antigo `national.chamadas_recentes` carregava. Esse campo NÃO é mais
 * lido: o texto dele foi escrito pela regra da `chamada`.
 */
export function itensFaixaAgora(
  payload: Pick<EdgePayload, "cargo" | "por_uf" | "national" | "ts">,
): Array<{ ts: string; texto: string }> {
  return anunciosDeDefinicao(payload).map((a) => ({ ts: payload.ts, texto: a.texto }));
}
