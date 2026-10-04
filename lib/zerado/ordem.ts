/**
 * lib/zerado/ordem.ts
 *
 * Ordem SORTEADA, fixa no dia, para o placar zerado (ADR-0076).
 *
 * Decisão do dono em 04/10/2026: antes do primeiro boletim, todas as telas
 * abrem no layout da apuração com tudo em zero, e a ordem das candidaturas
 * (e das agremiações, nas listas de deputado) é um sorteio — o mesmo para
 * todo leitor e para toda carga da página, para a lista não "pular" a cada
 * atualização automática (ADR-0074). Ninguém fica em primeiro por número de
 * urna nem por ordem alfabética.
 *
 * Determinismo (constituição § 6): sem `Math.random`, sem `Date`. O sorteio é
 * um hash estável (FNV-1a 32 bits) de `semente + "|" + chave`; a semente é a
 * data do turno, então o 2º turno sorteia de novo sozinho.
 */

/** Semente do 1º turno de 2026. */
export const SEMENTE_1T_2026 = "2026-10-04";
/** Semente do 2º turno de 2026. */
export const SEMENTE_2T_2026 = "2026-10-25";

/** Semente do turno pedido. */
export function sementeDoTurno(turno: 1 | 2): string {
  return turno === 2 ? SEMENTE_2T_2026 : SEMENTE_1T_2026;
}

/** FNV-1a 32 bits sobre os code units da string. */
export function pesoSorteado(chave: string, semente: string): number {
  const s = `${semente}|${chave}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Devolve uma CÓPIA de `itens` na ordem sorteada. `chaveDe` deve ser estável
 * e única por item (ex.: `sqcand` para candidatura, sigla para agremiação).
 * Empate de hash (raríssimo) desempata pela própria chave, para a ordem ser
 * total e reprodutível.
 */
export function ordemSorteada<T>(
  itens: readonly T[],
  chaveDe: (item: T) => string,
  semente: string,
): T[] {
  return itens
    .map((item) => {
      const chave = chaveDe(item);
      return { item, chave, peso: pesoSorteado(chave, semente) };
    })
    .sort((a, b) =>
      a.peso !== b.peso ? a.peso - b.peso : a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0,
    )
    .map((x) => x.item);
}
