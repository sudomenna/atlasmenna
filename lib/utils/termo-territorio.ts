/**
 * lib/utils/termo-territorio.ts — spec 027 (RF-284).
 *
 * Como a prosa das telas de deputado se refere ao território da UF: "estado"
 * nos 26 estados; no DF, que não é estado, o próprio nome. Separado de
 * `casa-legislativa.ts` e SEM import nenhum de propósito: componentes que vão
 * ao bundle do cliente (`MarcaDeputado`, `lib/utils/deputado-marcas.ts`)
 * precisam do termo, e importar `casa-legislativa` em valor puxaria a tabela
 * de cargos e os nomes das 27 UFs para o navegador.
 *
 * Função pura, sem I/O (constituição § 9).
 */

/**
 * Como a prosa da tela se refere ao território da UF. Nos 26 estados é
 * "estado"; no DF, que não é estado, é o próprio nome. Cada campo é uma forma
 * gramatical — a tela escolhe a forma, nunca concatena "o " + nome.
 */
export interface TermoDoTerritorio {
  /** "estado" · "Distrito Federal" */
  nome: string;
  /** "este estado" · "o Distrito Federal" — objeto direto / depois de "para". */
  este: string;
  /** "deste estado" · "do Distrito Federal" */
  deste: string;
  /** "do estado" · "do Distrito Federal" */
  doTerritorio: string;
  /** "o estado" · "o Distrito Federal" — sujeito ("quantas cadeiras o estado elege"). */
  o: string;
  /** "num estado" · "no Distrito Federal" — a condição geral do método ("só aparece num estado com…"). */
  num: string;
  /** "neste estado" · "no Distrito Federal" */
  neste: string;
  /** "em cada estado" · "no Distrito Federal" */
  emCada: string;
  /** "por estado" · "para o Distrito Federal" — o boletim que o TSE publica. */
  porUnidade: string;
}

export const TERMO_ESTADO: TermoDoTerritorio = Object.freeze({
  nome: "estado",
  este: "este estado",
  deste: "deste estado",
  doTerritorio: "do estado",
  o: "o estado",
  num: "num estado",
  neste: "neste estado",
  emCada: "em cada estado",
  porUnidade: "por estado",
});

export const TERMO_DF: TermoDoTerritorio = Object.freeze({
  nome: "Distrito Federal",
  este: "o Distrito Federal",
  deste: "do Distrito Federal",
  doTerritorio: "do Distrito Federal",
  o: "o Distrito Federal",
  num: "no Distrito Federal",
  neste: "no Distrito Federal",
  emCada: "no Distrito Federal",
  porUnidade: "para o Distrito Federal",
});

/** O termo do território da UF — depende só da UF, não do cargo. */
export function termoDoTerritorio(uf: string): TermoDoTerritorio {
  return uf.toUpperCase() === "DF" ? TERMO_DF : TERMO_ESTADO;
}
