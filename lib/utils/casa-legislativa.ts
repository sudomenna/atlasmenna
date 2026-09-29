/**
 * lib/utils/casa-legislativa.ts — spec 027 (RF-284), frente U-a.
 *
 * O nome de cada casa legislativa que elege deputado em 2026, o rótulo do
 * cargo, o segmento de rota e o termo do território — para que as telas de
 * deputado (federal hoje; estadual e distrital depois da frente U-b) não
 * carreguem literal nenhum de "Câmara", "Deputado Federal" ou "estado".
 *
 * ## Por que tabela explícita e nenhuma heurística
 *
 * A preposição do nome da UF não se deduz da grafia: "de São Paulo", "do Rio
 * de Janeiro", "da Bahia", "de Mato Grosso" (sem artigo), "do Tocantins" (com).
 * Uma regra do tipo "termina em -a ⇒ da" erra Roraima, Goiás e Alagoas. Por
 * isso cada uma das 26 UFs com Assembleia tem a sua entrada aqui, e o teste
 * confere as 26 contra a lista escrita à mão.
 *
 * ## `CargoDeputado` é provisório
 *
 * `CargoTse` (`lib/config/cargos.ts`) ainda não conhece 7 e 8 neste ramo — a
 * frente T os acrescenta. Até lá o tipo dos cargos proporcionais mora aqui; a
 * U-b troca {@link CargoDeputado} pelo `CargoProporcional` da T e
 * {@link ufsDaCasa} pelo `ufsDoCargo` de lá. Nada aqui deve ganhar um ramo
 * `default` que devolva o federal para um cargo desconhecido: o conversor
 * silencioso de enum é o defeito que já mandou payload de Senador para a chave
 * do Presidente.
 *
 * Funções puras, sem I/O (constituição § 9).
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";

/** Código do TSE dos cargos proporcionais: 6 federal, 7 estadual, 8 distrital. */
export type CargoDeputado = 6 | 7 | 8;

/** Os três, na ordem do código — para iterar em teste e no seletor. */
export const CARGOS_DEPUTADO: readonly CargoDeputado[] = [6, 7, 8];

/** As 27 unidades da federação, em ordem de sigla (a mesma das rotas de UF). */
const UFS_27 = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

/**
 * A preposição (já contraída com o artigo, quando há) antes do nome de cada UF
 * que tem Assembleia Legislativa. O DF não entra: lá a casa é a Câmara
 * Legislativa, e o nome dela não se monta por esta tabela.
 */
const PREPOSICAO_DA_UF: Readonly<Record<string, "de" | "do" | "da">> = {
  AC: "do",
  AL: "de",
  AM: "do",
  AP: "do",
  BA: "da",
  CE: "do",
  ES: "do",
  GO: "de",
  MA: "do",
  MG: "de",
  MS: "de",
  MT: "de",
  PA: "do",
  PB: "da",
  PE: "de",
  PI: "do",
  PR: "do",
  RJ: "do",
  RN: "do",
  RO: "de",
  RR: "de",
  RS: "do",
  SC: "de",
  SE: "de",
  SP: "de",
  TO: "do",
};

const NOME_CAMARA_DOS_DEPUTADOS = "Câmara dos Deputados";
const NOME_CAMARA_LEGISLATIVA_DF = "Câmara Legislativa do Distrito Federal";

const ROTULO: Readonly<Record<CargoDeputado, string>> = {
  6: "Deputado Federal",
  7: "Deputado Estadual",
  8: "Deputado Distrital",
};

const SLUG: Readonly<Record<CargoDeputado, string>> = {
  6: "deputado-federal",
  7: "deputado-estadual",
  8: "deputado-distrital",
};

/**
 * Só a caixa — sem `trim`, de propósito: quem valida com {@link ufTemCasa} usa
 * a mesma string para montar caminho de Blob, e aceitar " SP" aqui deixaria o
 * espaço passar para lá.
 */
function normalizar(uf: string): string {
  return uf.toUpperCase();
}

/** "Deputado Federal" · "Deputado Estadual" · "Deputado Distrital". */
export function rotuloCargo(cargo: CargoDeputado): string {
  return ROTULO[cargo];
}

/** Segmento de rota do cargo: `deputado-federal` · `deputado-estadual` · `deputado-distrital`. */
export function slugDoCargo(cargo: CargoDeputado): string {
  return SLUG[cargo];
}

/**
 * As UFs em que o cargo tem corrida: federal nas 27; estadual nas 26 com
 * Assembleia (sem o DF); distrital só no DF. Ordem de sigla.
 */
export function ufsDaCasa(cargo: CargoDeputado): readonly string[] {
  if (cargo === 6) return UFS_27;
  if (cargo === 7) return UFS_27.filter((uf) => uf !== "DF");
  return ["DF"];
}

/** A UF tem corrida deste cargo? (sigla em qualquer caixa). */
export function ufTemCasa(cargo: CargoDeputado, uf: string): boolean {
  return ufsDaCasa(cargo).includes(normalizar(uf));
}

/**
 * O nome da casa que o cargo elege, na UF dada.
 *
 *   - 6 → "Câmara dos Deputados" (a UF só diz de onde vem a bancada);
 *   - 7 → "Assembleia Legislativa de São Paulo", "… do Rio de Janeiro", "… da Bahia";
 *   - 8 → "Câmara Legislativa do Distrito Federal".
 *
 * Lança para combinação que não existe (cargo 7 no DF, cargo 8 fora do DF,
 * sigla desconhecida): devolver um nome plausível ali imprimiria na tela uma
 * casa que não elege ninguém.
 */
export function nomeDaCasa(cargo: CargoDeputado, uf: string): string {
  const sigla = normalizar(uf);
  if (!ufTemCasa(cargo, sigla)) {
    throw new Error(`nomeDaCasa: o cargo ${cargo} não tem casa em "${uf}"`);
  }
  if (cargo === 6) return NOME_CAMARA_DOS_DEPUTADOS;
  if (cargo === 8) return NOME_CAMARA_LEGISLATIVA_DF;
  const preposicao = PREPOSICAO_DA_UF[sigla];
  const nome = UF_NOMES[sigla];
  if (!preposicao || !nome) {
    throw new Error(`nomeDaCasa: sem preposição ou nome para "${uf}"`);
  }
  return `Assembleia Legislativa ${preposicao} ${nome}`;
}

/**
 * Como a prosa da tela se refere ao território da UF. Nos 26 estados é
 * "estado"; no DF, que não é estado, é o próprio nome.
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
}

const TERMO_ESTADO: TermoDoTerritorio = {
  nome: "estado",
  este: "este estado",
  deste: "deste estado",
  doTerritorio: "do estado",
};

const TERMO_DF: TermoDoTerritorio = {
  nome: "Distrito Federal",
  este: "o Distrito Federal",
  deste: "do Distrito Federal",
  doTerritorio: "do Distrito Federal",
};

/** O termo do território da UF — depende só da UF, não do cargo. */
export function termoDoTerritorio(uf: string): TermoDoTerritorio {
  return normalizar(uf) === "DF" ? TERMO_DF : TERMO_ESTADO;
}

/**
 * Onde as cadeiras da UF estão em disputa, para a frase do resumo
 * ("70 cadeiras em disputa em SP" · "94 cadeiras em disputa na Assembleia
 * Legislativa de São Paulo").
 *
 * No federal a casa é uma só para o país e a frase fala da UF, como sempre
 * falou; nas assembleias a casa É da UF, e o nome dela vai à frase (RF-284).
 */
export function localDaDisputa(cargo: CargoDeputado, uf: string): string {
  const sigla = normalizar(uf);
  if (cargo === 6) return `em ${sigla}`;
  return `na ${nomeDaCasa(cargo, sigla)}`;
}

/**
 * O endereço da página do cargo — na UF, quando dada; senão, a capa.
 *
 * A capa do distrital não existe: o DF entra na capa das assembleias
 * (`/deputado-estadual`, decisão do dono de 29/09 — as 27 casas numa grade
 * só), então o cargo 8 sem UF leva para lá.
 */
export function hrefDaCasa(cargo: CargoDeputado, uf?: string | null): string {
  if (uf) return `/uf/${normalizar(uf)}/${slugDoCargo(cargo)}`;
  return cargo === 6 ? `/${slugDoCargo(6)}` : `/${slugDoCargo(7)}`;
}
