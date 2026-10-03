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
 * ## Os cargos e as UFs vêm da tabela canônica
 *
 * Desde a frente T (spec 027) `lib/config/cargos.ts` conhece 7 e 8: o tipo é
 * o `CargoProporcional` de lá (derivado das linhas com `proporcional: true`),
 * as UFs de cada casa saem de `ufsDoCargo` (a `abrangencia` da tabela) e o
 * rótulo e o slug, de `cargoInfo`. Até 30/09 este arquivo mantinha cópias
 * locais das três coisas (`CargoDeputado`, `ufsDaCasa`, `ROTULO`/`SLUG`) —
 * a U-b as trocou pela tabela, para que não haja uma segunda lista de cargos
 * a esquecer de atualizar. Nada aqui ganha um ramo `default` que devolva o
 * federal para um cargo desconhecido: o conversor silencioso de enum é o
 * defeito que já mandou payload de Senador para a chave do Presidente.
 *
 * Funções puras, sem I/O (constituição § 9).
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import {
  CARGOS_PROPORCIONAIS,
  type CargoProporcional,
  cargoExisteNaUf,
  cargoInfo,
  ufsDoCargo,
} from "@/lib/config/cargos";
import { type SiglaNaFrase, siglaNaFrase } from "@/lib/utils/termo-territorio";

/** Os três proporcionais (6, 7, 8), na ordem da tabela — para iterar em teste e no seletor. */
export const CARGOS_DEPUTADO: readonly CargoProporcional[] = CARGOS_PROPORCIONAIS;

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

/**
 * Só a caixa — sem `trim`, de propósito: quem valida com {@link ufTemCasa} usa
 * a mesma string para montar caminho de Blob, e aceitar " SP" aqui deixaria o
 * espaço passar para lá.
 */
function normalizar(uf: string): string {
  return uf.toUpperCase();
}

/** "Deputado Federal" · "Deputado Estadual" · "Deputado Distrital". */
export function rotuloCargo(cargo: CargoProporcional): string {
  return cargoInfo(cargo).label;
}

/** Segmento de rota do cargo: `deputado-federal` · `deputado-estadual` · `deputado-distrital`. */
export function slugDoCargo(cargo: CargoProporcional): string {
  return cargoInfo(cargo).slug;
}

/** A UF tem corrida deste cargo? (sigla em qualquer caixa). */
export function ufTemCasa(cargo: CargoProporcional, uf: string): boolean {
  return cargoExisteNaUf(cargo, uf);
}

/**
 * As UFs em que o cargo tem casa — `ufsDoCargo` da tabela (27 · 26 sem o DF ·
 * só o DF). Reexportado aqui para quem monta tela não importar dois módulos.
 */
export { ufsDoCargo };

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
export function nomeDaCasa(cargo: CargoProporcional, uf: string): string {
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

// O termo do território ("estado" / "Distrito Federal") mora num módulo sem
// dependência nenhuma, para que componentes que vão ao bundle do cliente
// (`MarcaDeputado`, `deputado-marcas`) o usem sem puxar esta tabela.
export { type TermoDoTerritorio, termoDoTerritorio } from "@/lib/utils/termo-territorio";

/**
 * A sigla da UF numa frase da tela do cargo (spec 027, véspera 03/10): "no DF"
 * e "do DF" nas assembleias; o federal guarda o texto que sempre teve ("em
 * DF"). Siglas de estado saem iguais nos três cargos ("em SP", "de SP").
 */
export function siglaNaFraseDoCargo(cargo: CargoProporcional, uf: string): SiglaNaFrase {
  return siglaNaFrase(normalizar(uf), cargo !== 6);
}

/**
 * Onde as cadeiras da UF estão em disputa, para a frase do resumo
 * ("70 cadeiras em disputa em SP" · "94 cadeiras em disputa na Assembleia
 * Legislativa de São Paulo").
 *
 * No federal a casa é uma só para o país e a frase fala da UF, como sempre
 * falou; nas assembleias a casa É da UF, e o nome dela vai à frase (RF-284).
 */
export function localDaDisputa(cargo: CargoProporcional, uf: string): string {
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
export function hrefDaCasa(cargo: CargoProporcional, uf?: string | null): string {
  if (uf) return `/uf/${normalizar(uf)}/${slugDoCargo(cargo)}`;
  return cargo === 6 ? `/${slugDoCargo(6)}` : `/${slugDoCargo(7)}`;
}

/**
 * O endereço da lista desta casa nesta UF (spec 026 RF-260; spec 027
 * design § 7.2), ou `null` quando a casa não tem rota de lista.
 *
 * As três casas têm desde 03/10: no federal a rota devolve as posições 61+;
 * nas assembleias, tudo o que a página não levou ao documento (eleitos + 5,
 * mínimo 10 — `lib/deputado/lista-documento.ts`). Até 03/10 a Câmara
 * Legislativa do DF (8) devolvia `null` aqui: nenhuma agremiação passa de 60
 * candidaturas lá, e o objeto da UF ia inteiro ao documento. O `null` continua
 * no tipo para a casa que um dia não tiver rota. Sem `default`: cargo
 * proporcional novo sem decisão aqui é erro de compilação.
 */
export function rotaListaDaCasa(cargo: CargoProporcional, uf: string): string | null {
  switch (cargo) {
    case 6:
    case 7:
    case 8:
      return `${hrefDaCasa(cargo, uf)}/lista`;
    default: {
      const naoCoberto: never = cargo;
      throw new Error(`rotaListaDaCasa: cargo não coberto ${String(naoCoberto)}`);
    }
  }
}

/**
 * Para onde vai quem abre a página de uma assembleia na UF da OUTRA casa
 * (spec 027 RF-281, design § 7.1) — `null` quando não há troca a fazer.
 *
 *   - `/uf/DF/deputado-estadual` → `/uf/DF/deputado-distrital` (o DF não tem
 *     Assembleia; a casa dele é a Câmara Legislativa);
 *   - `/uf/SP/deputado-distrital` → `/uf/SP/deputado-estadual` (open question
 *     1 da spec: simétrico ao DF; o dono pode trocar por 404 aqui).
 *
 * Sigla que não existe em casa nenhuma (`ZZ`) não é troca: `null`, e a página
 * responde 404. O federal nunca troca (existe nas 27).
 */
export function destinoDaCasaTrocada(cargo: CargoProporcional, uf: string): string | null {
  if (ufTemCasa(cargo, uf)) return null;
  if (cargo === 7 && ufTemCasa(8, uf)) return hrefDaCasa(8, uf);
  if (cargo === 8 && ufTemCasa(7, uf)) return hrefDaCasa(7, uf);
  return null;
}
