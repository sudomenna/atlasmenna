/**
 * components/blocks/_palanques-capa.ts
 *
 * A LIGAÇÃO do mapa dos palanques (V3, `PalanquesMapa`) à capa `/governador`
 * — spec 025, RF-251. O componente e a lógica pura (`_palanques.ts`) são de
 * outra frente; aqui mora só o que a página precisa decidir antes de desenhar:
 *
 *   1. **as três portas** (constituição 1.6 § 2 (a) e (f)): a chave `v3`
 *      ligada, o critério de `palanque_presidencial` publicado
 *      (`categoriaExibivel`) e o portão de cobertura sobre os candidatos a
 *      governador COM CHANCE em cada UF, no turno da página;
 *   2. **a leitura extra do payload de Presidente** — só depois das três
 *      portas passarem. Com a visão desligada (o estado de hoje), a capa não
 *      paga leitura nenhuma a mais;
 *   3. a cola `palanquesDaBase` nas duas bases (Parcial e Projeção).
 *
 * Devolve `null` quando a visão não deve aparecer — e aí a página não desenha
 * nem o painel. Nunca lança: falha na leitura do Presidente vira ladrilhos com
 * "não se aplica" (o componente trata `presidente: null`), não um 500.
 *
 * ## Custo (LCP / ISR)
 *
 * `/governador` já é dinâmica (lê `searchParams` do filtro de status), então a
 * leitura extra não troca estático por dinâmico. É um GET do Global Config
 * (mesma infraestrutura do payload de Governador, ADR-0001), feito no servidor
 * antes do HTML sair — soma ao tempo de resposta, não ao LCP do cliente, e o
 * painel fica ABAIXO da dobra (depois do "1º ou 2º turno"). Zero JavaScript no
 * navegador: `PalanquesMapa` é SVG no servidor.
 */

import { isPreEleicao } from "@/lib/config/fase";
import { resultadoEleitoral, simulacaoNacional } from "@/lib/dev/simulacao";
import { readProjection } from "@/lib/edge-config/reader";
import type { EdgePayload } from "@/lib/edge-config/types";
import { categoriaExibivel } from "@/lib/etiquetas/catalogo";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { avaliarCorridas, corridaDeUfRow, type ResultadoPortao } from "@/lib/etiquetas/portao";
import { classificadoEm } from "@/lib/etiquetas/visoes";

import { type PalanquesUf, palanqueDaResolucao, palanquesDaBase } from "./_palanques";

export interface PalanquesDaCapa {
  parcial: PalanquesUf[];
  projecao: PalanquesUf[];
  turno: 1 | 2;
}

/**
 * O portão de cobertura do V3: nas corridas de Governador, os candidatos com
 * chance (as duas bases, unidas) classificados em palanque NO TURNO da página.
 */
export function portaoPalanques(gov: EdgePayload, etiquetas: Etiquetas): ResultadoPortao {
  const turno = gov.turno === 2 ? 2 : 1;
  return avaliarCorridas(
    (gov.por_uf ?? []).map((row) =>
      corridaDeUfRow(row, {
        cargo: 3,
        turno,
        preEleicao: isPreEleicao(gov),
        universo: etiquetas.universo(3, row.sigla),
      }),
    ),
    classificadoEm(etiquetas, 3, turno, "palanque_presidencial"),
  );
}

/** A leitura do payload nacional de Presidente, pelo mesmo caminho da home. */
async function lerPresidentePadrao(turno: 1 | 2): Promise<EdgePayload | null> {
  try {
    return await resultadoEleitoral(
      () => simulacaoNacional("pres"),
      async () => await readProjection({ cargo: "pres", turno }),
    );
  } catch {
    return null;
  }
}

export async function palanquesDaCapa(
  gov: EdgePayload,
  etiquetas: Etiquetas,
  lerPresidente: (turno: 1 | 2) => Promise<EdgePayload | null> = lerPresidentePadrao,
): Promise<PalanquesDaCapa | null> {
  if (!etiquetas.viewLigada("v3")) return null;
  if (!categoriaExibivel("palanque_presidencial")) return null;
  if (isPreEleicao(gov)) return null;
  if (!portaoPalanques(gov, etiquetas).ok) return null;

  const turno = gov.turno === 2 ? 2 : 1;
  const pres = await lerPresidente(turno);
  const palanqueDe = (sq: string) =>
    palanqueDaResolucao(etiquetas.resolver(sq, 3, turno).palanque_presidencial);
  const entrada = {
    turno,
    governador: gov.por_uf ?? [],
    presidente: pres?.por_uf ?? [],
    palanqueDe,
  } as const;
  return {
    parcial: palanquesDaBase({ ...entrada, base: "parcial" }),
    projecao: palanquesDaBase({ ...entrada, base: "proj" }),
    turno,
  };
}
