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

/**
 * A SIGLA da UF dentro de uma frase, com a preposição já contraída (spec 027,
 * véspera 03/10). Irmão do `TermoDoTerritorio`: aquele troca "estado" pelo
 * nome por extenso; este mantém a sigla e só acerta o artigo. "DF" pede artigo
 * ("no DF", "do DF", "o DF elege"); as siglas dos estados vão sem ("em SP",
 * "de SP") — a forma que a tela do federal sempre usou.
 */
export interface SiglaNaFrase {
  /** "SP" · "o DF" — sujeito ou objeto ("as cadeiras que o DF elege"). */
  o: string;
  /** "em SP" · "no DF" */
  em: string;
  /** "Em SP" · "No DF" — início de frase. */
  Em: string;
  /** "de SP" · "do DF" */
  de: string;
  /** "para SP" · "para o DF" */
  para: string;
}

/**
 * `comArtigo` decide se o DF ganha o artigo. As telas das assembleias (cargos
 * 7 e 8) passam `true`; o federal (cargo 6) passa `false` e guarda o texto que
 * sempre teve ("em DF") — mudança deliberadamente restrita às telas novas na
 * véspera. Siglas de estado saem iguais nos dois casos.
 */
export function siglaNaFrase(uf: string, comArtigo: boolean): SiglaNaFrase {
  if (comArtigo && uf.toUpperCase() === "DF") {
    return { o: `o ${uf}`, em: `no ${uf}`, Em: `No ${uf}`, de: `do ${uf}`, para: `para o ${uf}` };
  }
  return { o: uf, em: `em ${uf}`, Em: `Em ${uf}`, de: `de ${uf}`, para: `para ${uf}` };
}
