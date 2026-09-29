/**
 * tests/unit/etiquetas/_fixtures.ts
 *
 * Universo sintético e fontes em texto para os testes da spec 024. Pequeno de
 * propósito: cada candidatura existe para exercitar uma regra.
 */

import type { Senado2031Insumo } from "@/data-pipeline/etiquetas-insumos";
import {
  type AnteriorCompilado,
  compilarEtiquetas,
  type EntradaCompilacao,
  type InsumosDerivadosEntrada,
  semDerivados,
} from "@/data-pipeline/etiquetas-nucleo";
import { type CandidaturaUniverso, montarUniverso } from "@/data-pipeline/etiquetas-universo";
import { ARQUIVOS_FONTE, type ArquivoFonte, COLUNAS_FONTE } from "@/lib/etiquetas/catalogo";

export const CABECALHO = COLUNAS_FONTE.join(",");

// Governador (3), Senador (5) e Deputado (6) — SP e RJ.
export const GOV_SP_PT = "250002000001";
export const GOV_SP_PL = "250002000002";
export const GOV_RJ_PSD = "250002000003";
export const SEN_SP_PT = "250002000011";
export const SEN_SP_PL = "250002000012";
export const DEP_SP_PT = "250002000101";
export const DEP_SP_PV = "250002000102";
export const DEP_SP_PL = "250002000103";
export const DEP_RJ_UNIAO = "90002000104"; // 11 dígitos, de propósito

export function universoTeste(extra: CandidaturaUniverso[] = []) {
  const c = (
    sqcand: string,
    cargo: 3 | 5 | 6,
    uf: string,
    partido: string,
    federacao: string | null = null,
  ): CandidaturaUniverso => ({ sqcand, cargo, uf, partido, federacao });
  return montarUniverso([
    c(GOV_SP_PT, 3, "SP", "PT", "PT/PC DO B/PV"),
    c(GOV_SP_PL, 3, "SP", "PL"),
    c(GOV_RJ_PSD, 3, "RJ", "PSD"),
    c(SEN_SP_PT, 5, "SP", "PT", "PT/PC DO B/PV"),
    c(SEN_SP_PL, 5, "SP", "PL"),
    c(DEP_SP_PT, 6, "SP", "PT", "PT/PC DO B/PV"),
    c(DEP_SP_PV, 6, "SP", "PV", "PT/PC DO B/PV"),
    c(DEP_SP_PL, 6, "SP", "PL"),
    c(DEP_RJ_UNIAO, 6, "RJ", "UNIAO", "UNIAO/PP"),
    c("250002000105", 6, "RJ", "PP", "UNIAO/PP"),
    ...extra,
  ]);
}

export const AGORA = new Date("2026-09-29T15:00:00Z");

export interface LinhaTeste {
  chave: string;
  categoria: string;
  valor: string;
  turno?: string;
  fonte_url?: string;
  fonte_descricao?: string;
  data?: string;
  revisado?: string;
  revisado_em?: string;
  nota?: string;
}

function csvCampo(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function linha(l: LinhaTeste): string {
  const cheia = {
    turno: "",
    fonte_url: "https://exemplo.org/fonte",
    fonte_descricao: "Entrevista ao jornal X",
    data: "2026-09-20",
    revisado: "sim",
    revisado_em: "2026-09-28",
    nota: "",
    ...l,
  };
  return COLUNAS_FONTE.map((c) => csvCampo((cheia as Record<string, string>)[c] ?? "")).join(",");
}

export function csv(...linhas: LinhaTeste[]): string {
  return `${[CABECALHO, ...linhas.map(linha)].join("\n")}\n`;
}

export function fontesVazias(): Record<ArquivoFonte, string> {
  const out = {} as Record<ArquivoFonte, string>;
  for (const a of Object.keys(ARQUIVOS_FONTE) as ArquivoFonte[]) out[a] = `${CABECALHO}\n`;
  return out;
}

export function semAnterior(): AnteriorCompilado {
  return { nacional: null, ufs: new Map(), historico: null };
}

export function senadoTeste(n = 27): Senado2031Insumo {
  const ufs = [
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
  ];
  const senadores = new Map<string, { uf: string; partido: string | null }>();
  for (let i = 0; i < n; i++) {
    senadores.set(String(5000 + i), {
      uf: ufs[i] as string,
      partido: i === 18 ? null : i % 2 ? "PL" : "PT",
    });
  }
  return { completo: n === 27, foto: "2026-09-29", senadores };
}

export function entrada(
  fontes: Partial<Record<ArquivoFonte, string | null>> = {},
  opts: Partial<Omit<EntradaCompilacao, "fontes" | "derivados">> & {
    derivados?: Partial<InsumosDerivadosEntrada>;
  } = {},
): EntradaCompilacao {
  return {
    fontes: { ...fontesVazias(), ...fontes },
    universo: opts.universo ?? universoTeste(),
    senado2031: opts.senado2031 ?? null,
    derivados: { ...semDerivados(), ...opts.derivados },
    anterior: opts.anterior ?? semAnterior(),
    agora: opts.agora ?? AGORA,
    ...(opts.publicar ? { publicar: opts.publicar } : {}),
  };
}

/** Compila e falha o teste se não compilar. */
export function compilarOk(e: EntradaCompilacao) {
  const r = compilarEtiquetas(e);
  if (!r.ok)
    throw new Error(`esperava compilar, veio:\n${r.erros.map((x) => x.mensagem).join("\n")}`);
  return r;
}

export function mensagensDeErro(e: EntradaCompilacao): string[] {
  const r = compilarEtiquetas(e);
  return r.ok ? [] : r.erros.map((x) => x.mensagem);
}
