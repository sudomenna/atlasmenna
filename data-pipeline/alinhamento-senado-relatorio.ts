// data-pipeline/alinhamento-senado-relatorio.ts
//
// **Relatório de conferência** do alinhamento do Senado: como a regra do dono
// (ADR-0059 item 3) classificaria os 81 senadores em exercício com a taxa
// calculada. É INFORMATIVO — não escreve nada em `editorial/`, e a classificação
// que vai ao ar é da camada de etiquetas (spec 024), não daqui.
//
// ⚠️ Os três limiares abaixo espelham a regra do dono (≥ 65 Base, ≤ 35
// Oposição, entre → Independente, menos de 30 votos disputados → amostra
// insuficiente). A fonte única deles será `lib/etiquetas/catalogo.ts`; enquanto
// o catálogo não existe, ficam aqui, juntos, para o relatório não divergir de
// si mesmo. Se o catálogo mudar um valor, este relatório NÃO acompanha sozinho.
//
// Só código do parlamentar, partido e taxa: nenhum nome (civil ou de urna).

import type { AgregadoPartido, LinhaSenador } from "./alinhamento-senado.ts";
import { taxaComUmaCasa } from "./alinhamento-senado.ts";

export const LIMIAR_BASE = 65;
export const LIMIAR_OPOSICAO = 35;
export const AMOSTRA_MINIMA = 30;

export type RelacaoGoverno = "base" | "independente" | "oposicao" | "insuficiente";

export interface SenadorEmExercicio {
  codigo: number;
  partido: string | null;
}

export interface SenadorClassificado {
  codigo: number;
  partido: string;
  relacao: RelacaoGoverno;
  votosDisputadas: number;
  taxaDisputadas: number | null;
}

/**
 * A regra do dono sobre a taxa **publicada** (1 casa). Sem linha, ou com menos
 * de 30 votos disputados → `insuficiente`. `≥ 65` e `≤ 35` incluem o limiar.
 */
export function classificarRelacao(
  linha: Pick<LinhaSenador, "votosDisputadas" | "taxaDisputadas"> | undefined,
): RelacaoGoverno {
  if (!linha || linha.votosDisputadas < AMOSTRA_MINIMA) return "insuficiente";
  if (linha.taxaDisputadas >= LIMIAR_BASE) return "base";
  if (linha.taxaDisputadas <= LIMIAR_OPOSICAO) return "oposicao";
  return "independente";
}

export function classificarEmExercicio(
  emExercicio: readonly SenadorEmExercicio[],
  linhas: readonly LinhaSenador[],
): SenadorClassificado[] {
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  return emExercicio.map((s) => {
    const l = porCodigo.get(s.codigo);
    return {
      codigo: s.codigo,
      partido: s.partido ?? "(sem partido)",
      relacao: classificarRelacao(l),
      votosDisputadas: l?.votosDisputadas ?? 0,
      taxaDisputadas: l?.taxaDisputadas ?? null,
    };
  });
}

export type Contagem = Record<RelacaoGoverno, number>;

const vazia = (): Contagem => ({ base: 0, independente: 0, oposicao: 0, insuficiente: 0 });

export function contarRelacoes(classificados: readonly SenadorClassificado[]): Contagem {
  const c = vazia();
  for (const s of classificados) c[s.relacao]++;
  return c;
}

export interface LinhaPartidoAtual extends Contagem {
  partido: string;
  n: number;
}

/** Contagem por partido **atual** (o de hoje, não o da época do voto), do maior para o menor. */
export function porPartidoAtual(
  classificados: readonly SenadorClassificado[],
): LinhaPartidoAtual[] {
  const m = new Map<string, LinhaPartidoAtual>();
  for (const s of classificados) {
    const l = m.get(s.partido) ?? { partido: s.partido, n: 0, ...vazia() };
    l.n++;
    l[s.relacao]++;
    m.set(s.partido, l);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.partido.localeCompare(b.partido));
}

export interface LinhaPartidoDaEpoca {
  partido: string;
  votosDisputadas: number;
  taxa: number;
}

/** Taxa por partido **da época do voto**, ponderada pelos votos — o teste de sanidade PT × PL. */
export function taxaPorPartidoDaEpoca(
  agregados: readonly AgregadoPartido[],
): LinhaPartidoDaEpoca[] {
  return agregados
    .filter((a) => a.votosDisputadas > 0)
    .map((a) => ({
      partido: a.partido,
      votosDisputadas: a.votosDisputadas,
      taxa: taxaComUmaCasa(a.alinhadasDisputadas, a.votosDisputadas),
    }))
    .sort((a, b) => b.taxa - a.taxa || a.partido.localeCompare(b.partido));
}

/** Quantos senadores mudam de classe entre dois cálculos (sensibilidade). */
export function quantosMudaram(
  a: readonly SenadorClassificado[],
  b: readonly SenadorClassificado[],
): number {
  const rb = new Map(b.map((s) => [s.codigo, s.relacao]));
  return a.filter((s) => rb.get(s.codigo) !== s.relacao).length;
}

export function resumoDeVotos(classificados: readonly SenadorClassificado[]): {
  min: number;
  mediana: number;
  max: number;
} {
  const v = classificados.map((s) => s.votosDisputadas).sort((x, y) => x - y);
  if (v.length === 0) return { min: 0, mediana: 0, max: 0 };
  const meio = Math.floor(v.length / 2);
  const mediana =
    v.length % 2 === 1 ? (v[meio] as number) : ((v[meio - 1] as number) + (v[meio] as number)) / 2;
  return { min: v[0] as number, mediana, max: v[v.length - 1] as number };
}
