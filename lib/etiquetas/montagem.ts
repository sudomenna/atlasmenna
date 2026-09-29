/**
 * lib/etiquetas/montagem.ts
 *
 * Monta os {@link InsumosResolucao} de cada tipo de alvo a partir dos
 * arquivos de etiquetas. É a MESMA montagem para o compilador (relatório de
 * cobertura, histórico) e para o leitor (tela, portão, vigia) — dois
 * montadores seriam dois jeitos de ler o mesmo arquivo.
 */

import type { CategoriaId } from "./catalogo";
import type {
  ArquivoNacional,
  ArquivoUf,
  CandidatoNacional,
  Senador2031,
  ValoresDerivados,
} from "./formato";
import { derivadosDe, type InsumosResolucao, type Resolucao, resolverCategoria } from "./resolver";

/** Governador (3) ou Senador (5). Derivados só existem para o 5 (Senado). */
export function insumosMajoritario(
  nacional: ArquivoNacional,
  sqcand: string,
  c: CandidatoNacional,
): InsumosResolucao {
  return {
    alvo: c.cargo,
    chaveIndividual: sqcand,
    individuais: c.x,
    derivados: derivadosDe(c.d, nacional.derivados, "senado"),
    partido: c.partido,
    padroes: nacional.padroes,
    partidos: nacional.partidos,
  };
}

/** Um dos 27 que seguem até 2031. */
export function insumosSenador2031(
  nacional: ArquivoNacional,
  codigo: string,
  s: Senador2031,
): InsumosResolucao {
  return {
    alvo: "senado2031",
    chaveIndividual: `senado:${codigo}`,
    individuais: s.x,
    derivados: derivadosDe(s.d, nacional.derivados, "senado"),
    partido: s.partido,
    padroes: nacional.padroes,
    partidos: nacional.partidos,
  };
}

/** Valores derivados de cada deputado de uma UF, a partir dos grupos do arquivo. */
export function derivadosDaUf(uf: ArquivoUf): Map<string, ValoresDerivados> {
  const out = new Map<string, ValoresDerivados>();
  for (const [valor, lista] of Object.entries(uf.trajetoria)) {
    for (const sq of lista ?? []) out.set(sq, { ...out.get(sq), trajetoria_cargo: valor });
  }
  for (const [valor, lista] of Object.entries(uf.alinhamento)) {
    for (const sq of lista ?? []) out.set(sq, { ...out.get(sq), relacao_governo: valor });
  }
  return out;
}

/** Índice `sqcand` → insumos de TODAS as candidaturas a Deputado Federal de uma UF. */
export function indiceDeputadosDaUf(
  uf: ArquivoUf,
  nacional: ArquivoNacional,
): Map<string, InsumosResolucao> {
  const der = derivadosDaUf(uf);
  const out = new Map<string, InsumosResolucao>();
  for (const [partido, lista] of Object.entries(uf.por_partido)) {
    for (const sq of lista) {
      out.set(sq, {
        alvo: 6,
        chaveIndividual: sq,
        individuais: uf.excecoes[sq],
        derivados: derivadosDe(der.get(sq), nacional.derivados, "camara"),
        partido,
        padroes: nacional.padroes,
        partidos: nacional.partidos,
      });
    }
  }
  return out;
}

export function insumosDeputadosDaUf(uf: ArquivoUf, nacional: ArquivoNacional): InsumosResolucao[] {
  return [...indiceDeputadosDaUf(uf, nacional).values()];
}

/** Resolução de uma categoria de um deputado, fora do leitor (testes, relatório). */
export function resolverDeputado(
  uf: ArquivoUf,
  nacional: ArquivoNacional,
  sqcand: string,
  cat: CategoriaId,
  turno: 1 | 2,
): Resolucao {
  const i = indiceDeputadosDaUf(uf, nacional).get(sqcand);
  return i ? resolverCategoria(i, cat, turno) : { estado: "a_classificar" };
}
