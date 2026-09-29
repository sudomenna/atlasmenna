/**
 * tests/unit/etiquetas/_visoes-fixtures.ts
 *
 * Um `Etiquetas` COMPILADO de verdade (compilador + leitor, sem atalho) para
 * as telas da spec 025: o universo sai do payload de teste, a foto dos 27 sai
 * da foto fictícia do Senado (`tests/fixtures/senado/mandato-2031.fixture.json`)
 * e as linhas-fonte são CSV de verdade — então o que a tela recebe passou pela
 * mesma validação, precedência e resolução que produção.
 */

import type { Senado2031Insumo } from "@/data-pipeline/etiquetas-insumos";
import type { CandidaturaUniverso } from "@/data-pipeline/etiquetas-universo";
import { montarUniverso } from "@/data-pipeline/etiquetas-universo";
import type { EdgePayload } from "@/lib/edge-config/types";
import { type ChavesPublicacao, todasDesligadas, type Visao } from "@/lib/etiquetas/catalogo";
import { normalizarSigla } from "@/lib/etiquetas/formato";
import { type Etiquetas, montarEtiquetas } from "@/lib/etiquetas/leitor";
import mandatoFixture from "@/tests/fixtures/senado/mandato-2031.fixture.json" with {
  type: "json",
};

import { compilarOk, csv, entrada, type LinhaTeste } from "./_fixtures";

/** A foto fictícia dos 27 como insumo do compilador. */
export function senado2031DaFoto(): Senado2031Insumo {
  const senadores = new Map<string, { uf: string; partido: string | null }>();
  for (const s of mandatoFixture.senadores) {
    senadores.set(s.codigo, {
      uf: s.uf,
      partido: s.partido === "S/Partido" ? null : normalizarSigla(s.partido),
    });
  }
  return { completo: true, foto: "2026-09-29", senadores };
}

/** Os códigos da foto fictícia, na ordem do arquivo. */
export const CODIGOS_2031: readonly string[] = mandatoFixture.senadores.map((s) => s.codigo);

/** Universo de UM cargo a partir do `top_candidatos` de um payload. */
export function universoDoPayload(payload: EdgePayload, cargo: 3 | 5): CandidaturaUniverso[] {
  const out: CandidaturaUniverso[] = [];
  for (const row of payload.por_uf ?? []) {
    for (const c of row.top_candidatos ?? []) {
      if (!c.sqcand) continue;
      out.push({
        sqcand: c.sqcand,
        cargo,
        uf: row.sigla,
        partido: normalizarSigla(c.partido ?? "SEMPARTIDO"),
        federacao: null,
      });
    }
  }
  return out;
}

/** Todas as siglas (normalizadas) de um universo + as da foto. */
function siglas(universo: readonly CandidaturaUniverso[], comFoto: boolean): string[] {
  const s = new Set(universo.map((c) => c.partido));
  if (comFoto) {
    for (const x of senado2031DaFoto().senadores.values()) if (x.partido) s.add(x.partido);
  }
  return [...s].sort();
}

export interface OpcoesEtiquetasTeste {
  universo?: CandidaturaUniverso[];
  /** Padrão por partido (`relacao_governo`) para cada sigla do universo — valor por sigla. */
  relacaoPorPartido?: (sigla: string) => string | null;
  /** Linhas extras em cada arquivo. */
  linhas?: Partial<
    Record<"governador.csv" | "senador.csv" | "senado-2031.csv" | "partidos.csv", LinhaTeste[]>
  >;
  comFoto?: boolean;
  ligadas?: readonly Visao[];
  uf?: string;
}

/**
 * Compila e monta. `relacaoPorPartido` escreve `partido:SIGLA relacao_governo`
 * para cada sigla — com isso toda candidatura e todo senador com partido fica
 * classificado em relação ao governo (herança), que é o caso "portão aberto".
 */
export function etiquetasDeTeste(o: OpcoesEtiquetasTeste = {}): Etiquetas {
  const universo = o.universo ?? [];
  const comFoto = o.comFoto ?? true;
  const partidos: LinhaTeste[] = [...(o.linhas?.["partidos.csv"] ?? [])];
  if (o.relacaoPorPartido) {
    for (const sigla of siglas(universo, comFoto)) {
      const valor = o.relacaoPorPartido(sigla);
      if (valor) partidos.push({ chave: `partido:${sigla}`, categoria: "relacao_governo", valor });
    }
  }
  const publicar: ChavesPublicacao = { ...todasDesligadas() };
  for (const v of o.ligadas ?? []) publicar[v] = true;
  const r = compilarOk(
    entrada(
      {
        "partidos.csv": csv(...partidos),
        "governador.csv": csv(...(o.linhas?.["governador.csv"] ?? [])),
        "senador.csv": csv(...(o.linhas?.["senador.csv"] ?? [])),
        "senado-2031.csv": csv(...(o.linhas?.["senado-2031.csv"] ?? [])),
      },
      {
        universo: montarUniverso(universo),
        senado2031: comFoto ? senado2031DaFoto() : null,
        publicar,
      },
    ),
  );
  return montarEtiquetas(r.nacional, "embutido", o.uf ? (r.ufs[o.uf] ?? null) : null);
}

/**
 * Relação por partido, simétrica e fixa para os testes: dois partidos de
 * base, dois de oposição, o resto independente.
 */
export function relacaoFixa(sigla: string): string {
  if (sigla === "PT" || sigla === "PSB" || sigla === "PDT" || sigla === "PSOL")
    return "base_governo";
  if (sigla === "PL" || sigla === "NOVO" || sigla === "PP") return "oposicao";
  return "independente";
}
