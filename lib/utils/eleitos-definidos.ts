/**
 * lib/utils/eleitos-definidos.ts
 *
 * Ponto ÚNICO de "quem está MATEMATICAMENTE eleito nesta UF, e o que o
 * cabeçalho diz" — decisão do dono em 2026-10-04 (dia do 1º turno).
 *
 * ## O defeito que isto fecha
 *
 * O balão do mapa nacional (Presidente, Governador, Senador) pintava fundo
 * cheio + ✓ e escrevia "Chamada" quando `EdgeUfRow.chamada === true` — uma
 * leitura da PROJEÇÃO (margem projetada > 10 pp), independente do seletor
 * Parcial/Projeção. Mato Grosso a 27% apurado aparecia com dois senadores
 * "eleitos". Constituição § 1: a tela não proclama o que não está decidido.
 *
 * ## A regra
 *
 * 1. **Fonte única: `EdgeUfRow.eleitos_definidos`**, emitido pelo produtor
 *    (`api/model/`) só quando a eleição está matematicamente decidida (ver a
 *    docstring do campo em `lib/edge-config/types.ts`). Nada aqui olha
 *    `chamada`, margem, `pct`, posição ou base do seletor — por isso o
 *    resultado é IGUAL nas duas bases.
 * 2. **Identidade, nunca posição.** A saída é um conjunto de `id`; quem marca
 *    linha a linha casa pelo `id`, onde quer que a linha caia depois de
 *    reordenada pela base ativa.
 * 3. **Só conta quem está nas linhas e disputa.** Id ausente de
 *    `top_candidatos` é ignorado (não há linha onde pôr o ✓, e o cabeçalho não
 *    pode anunciar um eleito invisível); anulada nunca é eleita (ADR-0053,
 *    defensivo — o produtor não a emite).
 * 4. **Cabeçalho**: 1 eleito ⇒ "Matematicamente eleito"; 2+ ⇒
 *    "Matematicamente eleitos"; nenhum eleito e `segundo_turno_definido` ⇒
 *    "2º turno definido" (sem fundo em ninguém); senão nada.
 *
 * Função pura, sem React e sem I/O — cabe no chunk do mapa (RNF-007b): importa
 * só `destino-voto`, que já está lá.
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";

export const ROTULO_ELEITO = "Matematicamente eleito";
export const ROTULO_ELEITOS = "Matematicamente eleitos";
export const ROTULO_SEGUNDO_TURNO = "2º turno definido";

export interface DefinicaoDaUf {
  /** Ids (de `top_candidatos[].id`) que recebem fundo cheio + ✓. */
  eleitos: ReadonlySet<number>;
  /** Texto do cabeçalho do balão / status da gaveta; `undefined` ⇒ nenhum. */
  rotulo: string | undefined;
}

const NINGUEM: ReadonlySet<number> = new Set();

export function definicaoDaUf(
  row: Pick<EdgeUfRow, "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido">,
): DefinicaoDaUf {
  const declarados = Array.isArray(row.eleitos_definidos) ? row.eleitos_definidos : [];
  const eleitos = new Set<number>();
  if (declarados.length > 0) {
    for (const tc of row.top_candidatos ?? []) {
      if (declarados.includes(tc.id) && compete(tc)) eleitos.add(tc.id);
    }
  }
  if (eleitos.size === 1) return { eleitos, rotulo: ROTULO_ELEITO };
  if (eleitos.size > 1) return { eleitos, rotulo: ROTULO_ELEITOS };
  if (row.segundo_turno_definido === true) {
    return { eleitos: NINGUEM, rotulo: ROTULO_SEGUNDO_TURNO };
  }
  return { eleitos: NINGUEM, rotulo: undefined };
}

// ===========================================================================
// 2026-10-04 (dono, auditoria constitucional P1/P8) — ESCOPO e ATRIBUIÇÃO
// ===========================================================================
//
// As constantes acima ficam INTACTAS (outra frente as importa). O que muda é
// o texto que cada SUPERFÍCIE escreve a partir delas:
//
//  - **Escopo.** Na gaveta de um MUNICÍPIO, "Matematicamente eleito" sozinho
//    leria como "eleito neste município" — e município não elege ninguém. Lá o
//    texto diz "No estado: …". Em Presidente quem decide é o país inteiro (o
//    produtor só emite o campo com o `md='e'` do arquivo NACIONAL), então em
//    toda superfície — balão, gaveta do estado, gaveta do município, cartão por
//    UF — o texto diz "No país: …". Nas superfícies de UM estado de
//    Governador/Senador (balão, gaveta do estado, cartão), o próprio título já
//    é o estado: sem prefixo.
//  - **Atribuição.** O TSE não publica a marca de eleito do Senado durante a
//    apuração; a conta é do AtlasMenna (`api/model/definidos.py`). Onde a
//    marca de Senado aparece, a superfície diz de quem é a conta
//    (constituição § 8, transparência metodológica).

/** O cargo da corrida, no vocabulário das superfícies (`UfPickerCargo`). */
export type CargoDefinicao = "pres" | "gov" | "sen";

/**
 * Onde o texto vai: `"estado"` — balão do mapa nacional, gaveta do estado,
 * cartão de UF (o título já nomeia o estado); `"municipio"` — gaveta de um
 * município.
 */
export type SuperficieDefinicao = "estado" | "municipio";

export interface OpcoesEscopo {
  cargo: CargoDefinicao;
  superficie: SuperficieDefinicao;
}

export const PREFIXO_PAIS = "No país";
export const PREFIXO_ESTADO = "No estado";

/**
 * Atribuição da marca de Senado — a conta é do AtlasMenna, sobre os números
 * que o TSE publica.
 */
export const ATRIBUICAO_SENADO = "Cálculo do AtlasMenna sobre a contagem do TSE";

/** O prefixo de escopo de uma superfície; `undefined` ⇒ sem prefixo. */
function prefixoDe({ cargo, superficie }: OpcoesEscopo): string | undefined {
  if (cargo === "pres") return PREFIXO_PAIS;
  if (superficie === "municipio") return PREFIXO_ESTADO;
  return undefined;
}

/**
 * Um texto de definição com o escopo da superfície: `"Matematicamente eleito"`
 * ⇒ `"No estado: matematicamente eleito"` (município de Gov/Sen) ou
 * `"No país: matematicamente eleito"` (Presidente, qualquer superfície). Sem
 * prefixo, o texto sai intacto.
 */
export function comEscopo(texto: string, opcoes: OpcoesEscopo): string {
  const prefixo = prefixoDe(opcoes);
  if (prefixo === undefined) return texto;
  return `${prefixo}: ${texto.charAt(0).toLocaleLowerCase("pt-BR")}${texto.slice(1)}`;
}

/**
 * {@link DefinicaoDaUf.rotulo} com o escopo da superfície. `undefined` quando
 * não há definição — nunca um texto vazio.
 */
export function rotuloComEscopo(
  definicao: Pick<DefinicaoDaUf, "rotulo">,
  opcoes: OpcoesEscopo,
): string | undefined {
  return definicao.rotulo === undefined ? undefined : comEscopo(definicao.rotulo, opcoes);
}

/**
 * A atribuição a escrever perto da marca de eleito: só no Senado, e só quando
 * HÁ marca (alguém em `eleitos`). Governador e Presidente seguem o aviso do
 * próprio TSE — sem nota.
 */
export function atribuicaoDaDefinicao(
  cargo: CargoDefinicao,
  definicao: Pick<DefinicaoDaUf, "eleitos">,
): string | undefined {
  return cargo === "sen" && definicao.eleitos.size > 0 ? ATRIBUICAO_SENADO : undefined;
}
