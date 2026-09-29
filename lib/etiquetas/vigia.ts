/**
 * lib/etiquetas/vigia.ts
 *
 * A avaliação **pura** do vigia das etiquetas (spec 024, RF-234). A casca de
 * I/O é `scripts/etiquetas-vigia.ts` — que lê o Edge Config e as etiquetas e
 * chama {@link avaliarVigiaEtiquetas}.
 *
 * ## O que ele procura
 *
 * O portão (RF-233) esconde uma visão quando alguém com chance não está
 * classificado. O vigia chega **antes**: avisa quando um candidato sem
 * classificação entra entre os {@link TOP_VIGIADO} primeiros de qualquer
 * corrida — em qualquer das duas bases (Projeção e, com apuração em curso,
 * Parcial) —, para dar tempo de classificar e publicar pelo Blob antes que o
 * portão feche. Candidatura anulada não conta.
 *
 * Deputado Federal não tem "top-4" por candidato (é proporcional por
 * agremiação): o vigia avisa quando uma agremiação com cadeira projetada não
 * tem padrão classificado.
 *
 * ## Quais categorias
 *
 * Por padrão, as que alimentam visão com portão na noite da eleição
 * ({@link CATEGORIAS_VIGIADAS_PADRAO}); a casca aceita outra lista. Cada
 * alerta diz QUAIS categorias faltam, na ordem do catálogo.
 *
 * ## Fase pré-eleição
 *
 * Sem voto, "top-4" é a ordem do número de urna — o vigia fica em silêncio
 * (`nao_comecou`), como `vigia:ciclo`.
 */

import { isPreEleicao } from "@/lib/config/fase";
import type { EdgePayload, EdgePayloadDeputado, EdgeUfRow } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";

import { type AlvoEtiqueta, aplicaA, type CategoriaId, ORDEM_CATEGORIAS } from "./catalogo";
import type { Etiquetas } from "./leitor";
import type { CandidatoNaCorrida } from "./portao";

export const TOP_VIGIADO = 4;

/**
 * Relação com o governo (V1, Câmara 2027), palanque (V3) e impeachment (V2,
 * só Senado). Trajetória (V4) entra depois do resultado e não é vigiada aqui.
 */
export const CATEGORIAS_VIGIADAS_PADRAO: readonly CategoriaId[] = [
  "relacao_governo",
  "palanque_presidencial",
  "impeachment_stf",
];

export interface AlertaEtiqueta {
  cargo: 3 | 5 | 6;
  corrida: string;
  /** `sqcand`, sigla da agremiação, ou `null` (candidato sem sqcand no payload). */
  chave: string | null;
  id?: number | null;
  nome?: string | null;
  faltam: CategoriaId[];
  motivo: "a_classificar" | "sem_sqcand" | "agremiacao";
}

export interface VeredictoVigiaEtiquetas {
  estado: "ok" | "alerta" | "nao_comecou";
  alertas: AlertaEtiqueta[];
}

function finito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Os N primeiros de uma corrida em QUALQUER das duas bases, unidos, na ordem
 * de entrada. Parcial só conta com a corrida apurando.
 */
export function topNasDuasBases(
  candidatos: readonly CandidatoNaCorrida[],
  n: number,
  pctApurado: number | null,
): CandidatoNaCorrida[] {
  const competem = candidatos.filter((c) => compete(c));
  const escolhidos = new Set<CandidatoNaCorrida>();
  const bases: Array<(c: CandidatoNaCorrida) => number | null | undefined> = [
    (c) => c.pct_projetado,
  ];
  if (finito(pctApurado) && pctApurado > 0) bases.push((c) => c.pct_atual);
  for (const valor of bases) {
    const ordenados = competem
      .filter((c) => finito(valor(c)))
      .sort((a, b) => (valor(b) as number) - (valor(a) as number));
    for (const c of ordenados.slice(0, n)) escolhidos.add(c);
  }
  return competem.filter((c) => escolhidos.has(c));
}

function candidatosDaLinha(row: EdgeUfRow): CandidatoNaCorrida[] {
  return row.top_candidatos.map((c) => ({
    sqcand: c.sqcand ?? null,
    id: c.id,
    nome: c.nome ?? null,
    pct_projetado: c.pct,
    pct_atual: c.pct_atual ?? null,
    destino: c.destino,
  }));
}

export function avaliarVigiaEtiquetas(e: {
  gov: EdgePayload | null;
  sen: EdgePayload | null;
  dep: EdgePayloadDeputado | null;
  turnoGov: 1 | 2;
  etiquetas: Etiquetas;
  categorias?: readonly CategoriaId[];
}): VeredictoVigiaEtiquetas {
  const categorias = e.categorias ?? CATEGORIAS_VIGIADAS_PADRAO;
  const payloads = [e.gov, e.sen, e.dep].filter((p) => p !== null);
  if (payloads.length > 0 && payloads.every((p) => isPreEleicao(p))) {
    return { estado: "nao_comecou", alertas: [] };
  }

  const alertas: AlertaEtiqueta[] = [];
  const corridas: Array<[3 | 5, EdgePayload | null, 1 | 2]> = [
    [3, e.gov, e.turnoGov],
    [5, e.sen, 1],
  ];
  for (const [cargo, payload, turno] of corridas) {
    if (!payload || isPreEleicao(payload)) continue;
    const vigiadas = ORDEM_CATEGORIAS.filter(
      (c) => categorias.includes(c) && aplicaA(c, cargo as AlvoEtiqueta),
    );
    for (const row of payload.por_uf) {
      for (const c of topNasDuasBases(candidatosDaLinha(row), TOP_VIGIADO, row.pct_apurado)) {
        const sq = c.sqcand == null ? null : String(c.sqcand);
        if (!sq) {
          alertas.push({
            cargo,
            corrida: row.sigla,
            chave: null,
            id: c.id,
            nome: c.nome,
            faltam: [...vigiadas],
            motivo: "sem_sqcand",
          });
          continue;
        }
        const r = e.etiquetas.resolver(sq, cargo, turno);
        const faltam = vigiadas.filter((cat) => r[cat].estado !== "classificado");
        if (faltam.length > 0) {
          alertas.push({
            cargo,
            corrida: row.sigla,
            chave: sq,
            id: c.id,
            nome: c.nome,
            faltam,
            motivo: "a_classificar",
          });
        }
      }
    }
  }

  if (e.dep && !isPreEleicao(e.dep)) {
    const vigiadas = ORDEM_CATEGORIAS.filter((c) => categorias.includes(c) && aplicaA(c, 6));
    for (const a of e.dep.bancada.por_agremiacao) {
      if (a.cadeiras <= 0) continue;
      const r = e.etiquetas.padraoDaAgremiacao(a.sigla, a.tipo, 1);
      const faltam = vigiadas.filter((cat) => r[cat].estado !== "classificado");
      if (faltam.length > 0) {
        alertas.push({
          cargo: 6,
          corrida: "BR",
          chave: a.sigla,
          nome: a.nome,
          faltam,
          motivo: "agremiacao",
        });
      }
    }
  }

  return { estado: alertas.length > 0 ? "alerta" : "ok", alertas };
}

/** Uma linha legível por alerta — o que vai para o stdout do agendador. */
export function formatarAlerta(a: AlertaEtiqueta): string {
  const cargo = a.cargo === 3 ? "Governador" : a.cargo === 5 ? "Senador" : "Deputado Federal";
  const quem =
    a.motivo === "agremiacao"
      ? `agremiação ${a.chave}`
      : `${a.nome ?? "(sem nome)"}${a.id != null ? ` nº ${a.id}` : ""}${a.chave ? ` [${a.chave}]` : " [SEM sqcand]"}`;
  return `🔴 ${cargo} ${a.corrida}: ${quem} — falta ${a.faltam.join(", ")}`;
}
