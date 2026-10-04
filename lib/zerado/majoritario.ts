/**
 * lib/zerado/majoritario.ts
 *
 * "Modo zerado" das corridas majoritárias (Presidente, Governador, Senador) —
 * ADR-0076, decisão do dono em 04/10/2026.
 *
 * Antes do primeiro boletim, a tela abre no layout NORMAL da apuração com
 * tudo em zero (todas as candidaturas com avatar e 0,0%, "Apurado 0,0%", mapa
 * cinza), em vez da tela de espera. Este módulo monta, a partir do cadastro de
 * candidaturas publicado no Blob (`readCandidatosUf`), payloads zerados nas
 * MESMAS formas do Edge Config (`EdgePayload`, `EdgePayloadUf`, `EdgeUfRow`).
 *
 * ## Gatilho — três estados, e só eles
 *
 *   (a) a leitura devolveu "chave ausente" (`LeituraEdge.estado === "ausente"`);
 *   (b) o payload tem `fase` com o valor de `FASE_PRE_ELEICAO` (`isPreEleicao`);
 *   (c) payload real com a lista de candidaturas vazia (o 1º ciclo do modelo,
 *       com zero voto, grava lista vazia).
 *
 * 🔴 NUNCA quando a leitura FALHOU (`estado === "falha"`): falha mantém a tela
 * honesta de "não recebemos dados", sem número nenhum (regra do dono de 14/09:
 * nunca fabricar zeros para cobrir uma falha). Sem gatilho por relógio.
 *
 * ## O que o payload zerado é e não é
 *
 * - Medição toda em 0; `id` = número na urna; `sqcand` preservado (foto).
 * - Ordem = SORTEIO fixo do dia (`lib/zerado/ordem.ts`) — nunca por número de
 *   urna nem por nome; `rank` = posição nesse sorteio.
 * - SEM `eleitos_definidos`, SEM `dado_ts`, SEM `fase`.
 * - 🔴 Só de TELA. Nunca é entregue a um escritor (Edge Config, Blob, banco):
 *   este módulo não importa nenhum, e o marcador `zerado: true` vive no
 *   invólucro {@link ResultadoZerado}, fora do payload.
 *
 * Zero I/O nas funções de montagem (puras); a única leitura é
 * {@link lerCandidaturasZerado}, que lê o Blob pelo reader existente e nunca
 * lança.
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import { type CandidatoIdentidade, readCandidatosUf } from "@/lib/blob/candidatos";
import type { Cargo as CargoToken } from "@/lib/config/calendar";
import { isPreEleicao } from "@/lib/config/fase";
import {
  type LeituraEdge,
  readProjectionResult,
  readUfProjectionResult,
} from "@/lib/edge-config/reader";
import type {
  Cargo,
  EdgeCandidate,
  EdgePayload,
  EdgePayloadUf,
  EdgeUfCandidate,
  EdgeUfRow,
  Turno,
} from "@/lib/edge-config/types";
import { ordemSorteada, sementeDoTurno } from "./ordem";

/** Os três cargos majoritários. */
export type CargoMajoritarioZerado = "pres" | "gov" | "sen";

/** As 27 siglas em ordem de sigla (code units — determinístico). */
export const SIGLAS_UF_ZERADO: readonly string[] = Object.keys(UF_NOMES).sort();

const CODIGO_TSE: Record<CargoMajoritarioZerado, Cargo> = { pres: 1, gov: 3, sen: 5 } as Record<
  CargoMajoritarioZerado,
  Cargo
>;

/**
 * O payload que a tela vai usar e se ele é zerado. O marcador fica FORA do
 * payload de propósito: um `zerado` dentro dele poderia, por descuido, ser
 * serializado para um escritor.
 */
export interface ResultadoZerado<T> {
  payload: T;
  zerado: boolean;
}

/** Algo com lista de candidaturas — nacional (`national.candidatos`) ou UF (`candidatos`). */
type ComLista = { fase?: string | null } & (
  | { national: { candidatos: readonly unknown[] } }
  | { candidatos: readonly unknown[] }
);

function listaDe(p: ComLista): readonly unknown[] {
  return "national" in p ? p.national.candidatos : p.candidatos;
}

/**
 * O payload existente pede o modo zerado? (b) fase pré, ou (c) lista vazia.
 * `null` NÃO responde aqui — ausência × falha só a {@link LeituraEdge} sabe.
 */
export function payloadPedeZerado(payload: ComLista): boolean {
  return isPreEleicao(payload) || listaDe(payload).length === 0;
}

/**
 * Decisão do gatilho sobre uma leitura do Edge Config.
 *
 *   - `"real"`   — payload real com candidaturas: renderiza como sempre.
 *   - `"zerado"` — ausente, fase pré ou lista vazia: monta o placar zerado.
 *   - `"falha"`  — a leitura falhou: tela honesta, sem número.
 */
export function decidirModo<T extends ComLista>(
  leitura: LeituraEdge<T>,
): "real" | "zerado" | "falha" {
  if (leitura.estado === "falha") return "falha";
  if (leitura.estado === "ausente") return "zerado";
  return payloadPedeZerado(leitura.valor) ? "zerado" : "real";
}

/** As candidaturas na ordem sorteada do turno. Cópia; não muta a entrada. */
export function ordenarParaZerado<T extends { sqcand: string }>(
  candidatos: readonly T[],
  turno: Turno,
): T[] {
  return ordemSorteada(candidatos, (c) => String(c.sqcand), sementeDoTurno(turno));
}

/** `EdgeCandidate` zerado de uma candidatura do cadastro. */
export function candidatoNacionalZerado(c: CandidatoIdentidade, rank: number): EdgeCandidate {
  return {
    id: c.numero,
    nome: c.nome_urna,
    partido: c.partido,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    pct_projetado_lower: 0,
    pct_projetado_upper: 0,
    p_vitoria: 0,
    rank,
    p_passa_2t: 0,
    p_fecha_1t: 0,
    sqcand: c.sqcand,
  };
}

/** `EdgeUfCandidate` zerado de uma candidatura do cadastro. */
export function candidatoUfZerado(c: CandidatoIdentidade): EdgeUfCandidate {
  return {
    id: c.numero,
    nome: c.nome_urna,
    partido: c.partido,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    ci95: { lower: 0, upper: 0 },
    sqcand: c.sqcand,
  };
}

/** Uma linha de UF zerada, com todas as candidaturas DAQUELA UF em `top_candidatos`. */
export function linhaUfZerada(
  sigla: string,
  candidatos: readonly CandidatoIdentidade[],
): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 0,
    lider: 0,
    margem_atual: 0,
    margem_projetada: 0,
    margem_projetada_ci: [0, 0],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: candidatos.map((c) => ({
      id: c.numero,
      pct: 0,
      nome: c.nome_urna,
      partido: c.partido,
      sqcand: c.sqcand,
      votos_atuais: 0,
      pct_atual: 0,
    })),
    vai_a_2t: null,
    bucket: "indefinido",
    // 0, e não ausente: o consolidado da região (`consolidarRegiao`) lê
    // ausência como "falta o total projetado" (falha) e 0 como "ainda não há
    // votos" — que é o fato antes do 1º boletim.
    votos_disputa_projetados: 0,
  } as EdgeUfRow;
}

/**
 * Payload NACIONAL zerado.
 *
 * @param nacionais  candidaturas da lista nacional (`national.candidatos`):
 *                   Presidente = fatia `BR`; Governador/Senador = vazio (não
 *                   há corrida nacional, o que importa é `por_uf`).
 * @param porUf      candidaturas de cada UF (`top_candidatos` das 27 linhas).
 */
export function payloadNacionalZerado(opts: {
  cargo: CargoMajoritarioZerado;
  turno: Turno;
  nacionais: readonly CandidatoIdentidade[];
  porUf: ReadonlyMap<string, readonly CandidatoIdentidade[]>;
  ts?: string;
}): EdgePayload {
  const { cargo, turno } = opts;
  const nacionais = ordenarParaZerado(opts.nacionais, turno);
  return {
    ts: opts.ts ?? "",
    cargo: CODIGO_TSE[cargo],
    turno,
    pct_apurado_total: 0,
    ufs_apuradas: 0,
    national: {
      candidatos: nacionais.map((c, i) => candidatoNacionalZerado(c, i + 1)),
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: null,
      cenarios_2t: [],
    },
    por_uf: SIGLAS_UF_ZERADO.map((sigla) =>
      linhaUfZerada(sigla, ordenarParaZerado(opts.porUf.get(sigla) ?? [], turno)),
    ),
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 0 },
    // Senado: 54 vagas em disputa (2 por UF), nenhuma atribuída — as 27 de
    // 2022 seguem fora do jogo (`lib/utils/senado-2027.ts`).
    ...(cargo === "sen"
      ? {
          composicao_vagas: {
            vagas_em_disputa: 54,
            total_cadeiras: 81,
            vagas_por_uf: 2,
            ufs_projetadas: 0,
            ufs_aguardando: 27,
            vagas_projetadas: 0,
            por_partido: [],
          },
        }
      : {}),
  } as EdgePayload;
}

/** Payload de UF zerado (`/uf/[sigla]/...`). */
export function payloadUfZerado(opts: {
  cargo: CargoMajoritarioZerado;
  turno: Turno;
  uf: string;
  candidatos: readonly CandidatoIdentidade[];
  vagas?: number;
  ts?: string;
}): EdgePayloadUf {
  const ordenados = ordenarParaZerado(opts.candidatos, opts.turno);
  return {
    uf: opts.uf.toUpperCase(),
    ts: opts.ts ?? "",
    cargo: CODIGO_TSE[opts.cargo],
    turno: opts.turno,
    pct_apurado: 0,
    candidatos: ordenados.map(candidatoUfZerado),
    needle_position: 0,
    needle_band: "tossup",
    ...(opts.vagas != null ? { vagas: opts.vagas } : {}),
    municipios: [],
  } as unknown as EdgePayloadUf;
}

/** Lê as candidaturas de UMA UF no Blob; `null` quando o Blob não respondeu. */
export async function lerCandidaturasZerado(
  sigla: string,
  cargo: CargoToken,
): Promise<CandidatoIdentidade[] | null> {
  const r = await readCandidatosUf(sigla, cargo);
  return r.status === "ok" ? r.slice.candidatos : null;
}

/**
 * Monta o payload nacional zerado lendo o Blob (pres: `BR` + 27 UFs; gov/sen:
 * 27 UFs). Devolve `null` quando NENHUMA lista foi lida — sem cadastro não há
 * o que mostrar, e a página cai na tela de espera de sempre.
 */
export async function montarNacionalZerado(
  cargo: CargoMajoritarioZerado,
  turno: Turno,
): Promise<EdgePayload | null> {
  const nacionaisP: Promise<CandidatoIdentidade[] | null> =
    cargo === "pres" ? lerCandidaturasZerado("BR", "pres") : Promise.resolve([]);
  const porUfP =
    cargo === "pres"
      ? Promise.resolve<Array<CandidatoIdentidade[] | null>>([])
      : Promise.all(SIGLAS_UF_ZERADO.map((s) => lerCandidaturasZerado(s, cargo)));
  const [nacionais, listas] = await Promise.all([nacionaisP, porUfP]);

  const porUf = new Map<string, readonly CandidatoIdentidade[]>();
  if (cargo === "pres") {
    // A cédula presidencial é a mesma nas 27 UFs.
    if (!nacionais || nacionais.length === 0) return null;
    for (const s of SIGLAS_UF_ZERADO) porUf.set(s, nacionais);
  } else {
    let algum = false;
    SIGLAS_UF_ZERADO.forEach((s, i) => {
      const l = listas[i];
      if (l && l.length > 0) {
        algum = true;
        porUf.set(s, l);
      }
    });
    if (!algum) return null;
  }
  return payloadNacionalZerado({ cargo, turno, nacionais: nacionais ?? [], porUf });
}

/** Monta o payload de UF zerado lendo o Blob; `null` sem cadastro. */
export async function montarUfZerado(
  cargo: CargoMajoritarioZerado,
  turno: Turno,
  uf: string,
  vagas?: number,
): Promise<EdgePayloadUf | null> {
  const lista = await lerCandidaturasZerado(cargo === "pres" ? "BR" : uf, cargo);
  if (!lista || lista.length === 0) return null;
  return payloadUfZerado({ cargo, turno, uf, candidatos: lista, vagas });
}

/**
 * Leitura de uma corrida já colapsada (`readProjection*` devolve `T | null`)
 * → decisão do modo zerado. Ponto único das páginas majoritárias.
 *
 * - `lido` não-nulo: zera se fase pré ou lista vazia (sem leitura extra).
 * - `lido` nulo: o colapso esconde ausência × falha, então RE-LÊ com
 *   `readProjectionResult` (só neste caminho, que é o de antes do 1º
 *   boletim). Falha — ou qualquer exceção — mantém a tela honesta de hoje.
 * - Sem cadastro no Blob o modo zerado não tem o que mostrar: devolve o
 *   `lido` intacto e a página segue o caminho de sempre.
 */
export async function resolverModoNacional(
  lido: EdgePayload | null,
  cargo: CargoMajoritarioZerado,
  turno: Turno,
  reler: () => Promise<LeituraEdge<EdgePayload>> = () => readProjectionResult({ cargo, turno }),
): Promise<ResultadoZerado<EdgePayload | null>> {
  if (lido && !payloadPedeZerado(lido)) return { payload: lido, zerado: false };
  if (!lido) {
    let leitura: LeituraEdge<EdgePayload>;
    try {
      leitura = await reler();
    } catch (erro) {
      leitura = { estado: "falha", erro };
    }
    const modo = decidirModo(leitura);
    if (modo === "falha") return { payload: null, zerado: false };
    if (modo === "real" && leitura.estado === "ok")
      return { payload: leitura.valor, zerado: false };
  }
  const z = await montarNacionalZerado(cargo, turno).catch(() => null);
  return z ? { payload: z, zerado: true } : { payload: lido, zerado: false };
}

/**
 * {@link resolverModoNacional} para as rotas de UF (`/uf/[sigla]/...`). Mesma
 * regra: payload real com candidaturas passa intacto; ausente, fase pré ou
 * lista vazia vira zerado; falha nunca.
 */
export async function resolverModoUf(
  lido: EdgePayloadUf | null,
  cargo: CargoMajoritarioZerado,
  turno: Turno,
  uf: string,
  opts: {
    vagas?: number;
    reler?: () => Promise<LeituraEdge<EdgePayloadUf>>;
  } = {},
): Promise<ResultadoZerado<EdgePayloadUf | null>> {
  if (lido && !payloadPedeZerado(lido)) return { payload: lido, zerado: false };
  if (!lido) {
    let leitura: LeituraEdge<EdgePayloadUf>;
    try {
      leitura = await (opts.reler ?? (() => readUfProjectionResult(uf, { cargo, turno })))();
    } catch (erro) {
      leitura = { estado: "falha", erro };
    }
    const modo = decidirModo(leitura);
    if (modo === "falha") return { payload: null, zerado: false };
    if (modo === "real" && leitura.estado === "ok")
      return { payload: leitura.valor, zerado: false };
  }
  const z = await montarUfZerado(cargo, turno, uf, opts.vagas).catch(() => null);
  return z ? { payload: z, zerado: true } : { payload: lido, zerado: false };
}
