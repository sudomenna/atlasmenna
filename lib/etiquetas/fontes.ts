/**
 * lib/etiquetas/fontes.ts — as fontes de uma lista de classificações,
 * numeradas UMA vez (spec 025; auditoria de a11y/perf de 29/09, A2).
 *
 * As listas das visões (as 81 cadeiras do impeachment, as agremiações da
 * Câmara de 2027) repetiam a descrição da fonte em cada linha. Quando várias
 * linhas vêm do mesmo levantamento — o caso comum num placar de posição
 * pública ou num padrão de partido —, a mesma frase de ~300 caracteres saía
 * 81 vezes, e o Next a escreve duas (HTML e payload RSC). Numeradas, cada
 * linha leva o link e "fonte N", e a descrição sai uma vez, na lista de fontes.
 *
 * A numeração segue a ordem da PRIMEIRA aparição na lista — que é a ordem da
 * lista (por UF, por bancada), nunca a da classificação. Duas linhas só
 * dividem um número com a mesma URL E a mesma descrição.
 */

export interface FonteDeLinha {
  fonte_url: string;
  fonte_descricao: string;
}

export interface FonteNumerada extends FonteDeLinha {
  n: number;
}

export interface FontesNumeradas {
  /** O número da fonte de uma linha (`null` para linha sem fonte). */
  numero(f: FonteDeLinha | null | undefined): number | null;
  /** As fontes distintas, na ordem da primeira aparição. */
  lista: FonteNumerada[];
}

const chave = (f: FonteDeLinha) => `${f.fonte_url}\n${f.fonte_descricao}`;

export function numerarFontes(
  linhas: ReadonlyArray<FonteDeLinha | null | undefined>,
): FontesNumeradas {
  const porChave = new Map<string, FonteNumerada>();
  for (const f of linhas) {
    if (!f) continue;
    const k = chave(f);
    if (!porChave.has(k)) {
      porChave.set(k, {
        n: porChave.size + 1,
        fonte_url: f.fonte_url,
        fonte_descricao: f.fonte_descricao,
      });
    }
  }
  return {
    numero: (f) => (f ? (porChave.get(chave(f))?.n ?? null) : null),
    lista: [...porChave.values()],
  };
}
