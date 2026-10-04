/**
 * lib/leitura/eventos.ts
 *
 * Histórico do Boletim da "leitura da noite" (ADR-0072): compara o payload
 * `projection-current-pres-t<turno>` com o resumo do ciclo anterior e devolve
 * as linhas que mudaram. Regra fixa, sem IA.
 *
 * PURO: sem rede, sem relógio. A hora entra por parâmetro (`agoraIso`) e é a
 * hora em que o cron VIU a mudança — nunca a do TSE.
 *
 * Linguagem (constituição § 2): descreve, não julga. Nada de "expressiva",
 * "esmagadora", "consolida". O tom imita `buildBulletin`
 * (`components/blocks/BulletinPanel.tsx`).
 */

import { unidadesDeApuracao } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import type { EdgeCandidate, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { eleitosNacionais, fraseEleitos } from "@/lib/utils/anuncios-definidos";
import { compete } from "@/lib/utils/destino-voto";
import { formatCI, formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { type EstadoResumo, type EventoBoletim, HISTORICO_MAX } from "./types";

/** Marcos de % apurado que viram linha no histórico (um por ciclo, o maior). */
export const MARCOS = [1, 5, 10, 25, 50, 75, 90, 95, 99, 100] as const;

// ADR-0045 — o Presidente tem 28 unidades de apuração: as 27 UFs e o
// exterior (`ZZ`). `ufs_apuradas` (produtor) conta a linha ZZ quando ela tem
// boletim, então o denominador tem de contá-la também.
const TOTAL_UFS = unidadesDeApuracao(1);

/** Limiares de P(2º turno) que viram linha quando cruzados PARA CIMA. */
const LIMIARES_2T_SOBE = [0.5, 0.9, 0.99] as const;
/** Limiares de P(2º turno) que viram linha quando cruzados PARA BAIXO. */
const LIMIARES_2T_DESCE = [0.5] as const;

// ---------------------------------------------------------------------------
// Leitura do payload
// ---------------------------------------------------------------------------

/** Há apuração para descrever? Pré-eleição (RF-153, mesma regra da home) ou 0% = não. */
function semApuracao(payload: EdgePayload): boolean {
  return isPreEleicao(payload) || !(payload.pct_apurado_total > 0);
}

function rankDe(c: EdgeCandidate, i: number): number {
  return Number.isFinite(c.rank) ? c.rank : i + 1;
}

/** Líder da CONTAGEM: mais votos apurados entre quem compete; null sem voto algum. */
function liderApurado(candidatos: readonly EdgeCandidate[] | undefined): EdgeCandidate | null {
  const lista = (candidatos ?? []).filter(compete);
  if (lista.length === 0) return null;
  const ordenados = [...lista].sort(
    (a, b) =>
      (b.votos_atuais ?? 0) - (a.votos_atuais ?? 0) ||
      (b.pct_atual ?? 0) - (a.pct_atual ?? 0) ||
      a.id - b.id,
  );
  const top = ordenados[0] as EdgeCandidate;
  if (!((top.votos_atuais ?? 0) > 0 || (top.pct_atual ?? 0) > 0)) return null;
  return top;
}

/** Líder da PROJEÇÃO: rank 1 (desempate por maior `pct_projetado`) entre quem compete. */
function liderProjecao(candidatos: readonly EdgeCandidate[] | undefined): EdgeCandidate | null {
  const lista = (candidatos ?? [])
    .map((c, i) => ({ c, r: rankDe(c, i) }))
    .filter(({ c }) => compete(c));
  if (lista.length === 0) return null;
  lista.sort(
    (a, b) => a.r - b.r || (b.c.pct_projetado ?? 0) - (a.c.pct_projetado ?? 0) || a.c.id - b.c.id,
  );
  return (lista[0] as { c: EdgeCandidate }).c;
}

/**
 * LEGADO — só alimenta `EstadoResumo.chamadas`, mantido com a regra de sempre
 * para o estado gravado continuar no formato que uma versão anterior do cron
 * sabe ler (rollback sem rajada). **Não gera evento nem texto** desde
 * 2026-10-04: quem dispara linha é `eleitosNacionais` (abaixo).
 */
function siglasChamadas(porUf: readonly EdgeUfRow[] | undefined): string[] {
  return (porUf ?? []).filter((r) => r.chamada === true).map((r) => r.sigla);
}

function uniaoOrdenada<T extends string | number>(a: readonly T[], b: readonly T[]): T[] {
  const s = [...new Set([...a, ...b])];
  return s.sort((x, y) =>
    typeof x === "number" && typeof y === "number" ? x - y : String(x) < String(y) ? -1 : 1,
  );
}

function marcosCruzados(pct: number): number[] {
  return MARCOS.filter((m) => m <= pct);
}

/**
 * Resume o payload para o próximo ciclo comparar. `marcos`, `definidos` e o
 * legado `chamadas` são cumulativos: nunca perdem item (um marco anunciado não se "desanuncia").
 * Sem apuração (pré-eleição ou 0%), os dois ficam exatamente como o anterior.
 */
export function resumirEstado(payload: EdgePayload, anterior: EstadoResumo | null): EstadoResumo {
  const sem = semApuracao(payload);
  const pct = Number.isFinite(payload.pct_apurado_total) ? payload.pct_apurado_total : 0;
  const marcosAnt = anterior?.marcos ?? [];
  const chamadasAnt = anterior?.chamadas ?? [];
  const definidosAnt = anterior?.definidos ?? [];
  const p2t = payload.national?.p_segundo_turno_overall;
  return {
    ts: payload.ts,
    pct,
    ufs_apuradas: Number.isFinite(payload.ufs_apuradas) ? payload.ufs_apuradas : 0,
    lider_apurado_id: sem ? null : (liderApurado(payload.national?.candidatos)?.id ?? null),
    lider_projecao_id: sem ? null : (liderProjecao(payload.national?.candidatos)?.id ?? null),
    p2t: typeof p2t === "number" && Number.isFinite(p2t) ? p2t : null,
    chamadas: sem ? [...chamadasAnt] : uniaoOrdenada(chamadasAnt, siglasChamadas(payload.por_uf)),
    definidos: sem
      ? [...definidosAnt]
      : uniaoOrdenada(definidosAnt, eleitosNacionais(payload.por_uf)),
    marcos: sem ? [...marcosAnt] : uniaoOrdenada(marcosAnt, marcosCruzados(pct)),
  };
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

function rotulo(nome: string | undefined, partido: string | undefined, sqcand?: string): string {
  const n = nomeExibicao(nome ?? "", sqcand);
  return partido ? `${n} (${partido})` : n;
}

function textoApuracao(pct: number, ufs: number): string {
  return `${formatPercent(pct, 1)} das seções apuradas, com boletim em ${ufs} de ${TOTAL_UFS} unidades de apuração (27 UFs e o exterior).`;
}

// ---------------------------------------------------------------------------
// Derivação
// ---------------------------------------------------------------------------

export function derivarEventos(
  anterior: EstadoResumo | null,
  payload: EdgePayload,
  agoraIso: string,
): { eventos: EventoBoletim[]; estado: EstadoResumo } {
  const estado = resumirEstado(payload, anterior);
  if (semApuracao(payload)) return { eventos: [], estado };

  const eventos: EventoBoletim[] = [];
  const ts = agoraIso;
  const pct = estado.pct;

  // inicio — o anterior não tinha apuração.
  const comecou = anterior === null || !(anterior.pct > 0);
  if (comecou) {
    eventos.push({
      id: "inicio",
      ts,
      head: "Apuração",
      text: "O TSE começou a divulgar os boletins de urna desta eleição.",
      tipo: "inicio",
    });
  }

  // marco — só o maior cruzado e ainda não anunciado.
  const jaAnunciados = new Set(anterior?.marcos ?? []);
  const novosMarcos = marcosCruzados(pct).filter((m) => !jaAnunciados.has(m));
  const maiorMarco = novosMarcos.length > 0 ? Math.max(...novosMarcos) : null;
  if (maiorMarco !== null) {
    eventos.push({
      id: `marco-${maiorMarco}`,
      ts,
      head: "Apuração",
      text: textoApuracao(pct, estado.ufs_apuradas),
      tipo: "marco",
    });
  }

  // Blob perdido no meio da noite: só `inicio` + maior marco. Os definidos (e o
  // legado `chamadas`) já estão no `estado` (resumirEstado) e não viram linha.
  if (anterior === null) return { eventos, estado };

  const candidatos = payload.national?.candidatos ?? [];
  const porId = (id: number) => candidatos.find((c) => c.id === id);

  // lideranca_apurado
  if (
    anterior.lider_apurado_id !== null &&
    estado.lider_apurado_id !== null &&
    anterior.lider_apurado_id !== estado.lider_apurado_id
  ) {
    const c = porId(estado.lider_apurado_id);
    if (c) {
      eventos.push({
        id: `lideranca_apurado-${c.id}-${payload.ts}`,
        ts,
        head: "Liderança",
        text: `${rotulo(c.nome, c.partido, c.sqcand)} passa à frente na contagem, com ${formatPercent(c.pct_atual, 1)} dos votos apurados.`,
        tipo: "lideranca_apurado",
      });
    }
  }

  // lideranca_projecao
  if (
    anterior.lider_projecao_id !== null &&
    estado.lider_projecao_id !== null &&
    anterior.lider_projecao_id !== estado.lider_projecao_id
  ) {
    const c = porId(estado.lider_projecao_id);
    if (c) {
      eventos.push({
        id: `lideranca_projecao-${c.id}-${payload.ts}`,
        ts,
        head: "Projeção",
        text: `${rotulo(c.nome, c.partido, c.sqcand)} passa a liderar a projeção, com ${formatPercent(c.pct_projetado, 1)} e intervalo de 95% ${formatCI(c.pct_projetado_lower, c.pct_projetado_upper)}.`,
        tipo: "lideranca_projecao",
      });
    }
  }

  // eleito_definido — 🔴 2026-10-04 (dono): substitui `chamada_uf`. O
  // histórico só anuncia o que está MATEMATICAMENTE definido, a mesma regra do
  // balão do mapa; nunca a `chamada` da projeção. No Presidente o eleito só
  // existe quando o Brasil inteiro definiu, então é UMA linha nacional, não
  // uma por UF. Estado antigo sem `definidos` conta como `[]`: no pior caso,
  // UMA linha (verdadeira) no primeiro ciclo — nunca uma rajada.
  const definidosAnt = new Set(anterior.definidos ?? []);
  const definidos = estado.definidos ?? [];
  if (definidos.some((id) => !definidosAnt.has(id))) {
    const frase = fraseEleitos(definidos, payload.por_uf ?? [], payload.national);
    if (frase) {
      eventos.push({
        id: `eleito_definido-${definidos.join("-")}`,
        ts,
        head: "Definido",
        text: `${frase} pela contagem oficial do TSE.`,
        tipo: "eleito_definido",
      });
    }
  }

  // segundo_turno — só no 1º turno; um evento por ciclo (o limiar mais alto cruzado).
  if (payload.turno === 1 && anterior.p2t !== null && estado.p2t !== null) {
    const antes = anterior.p2t;
    const agora = estado.p2t;
    const sobe = LIMIARES_2T_SOBE.filter((l) => antes < l && agora >= l);
    const desce = LIMIARES_2T_DESCE.filter((l) => antes >= l && agora < l);
    const limiar =
      sobe.length > 0 ? Math.max(...sobe) : desce.length > 0 ? Math.min(...desce) : null;
    if (limiar !== null) {
      const dir = sobe.length > 0 ? "sobe" : "desce";
      eventos.push({
        id: `segundo_turno-${limiar}-${dir}`,
        ts,
        head: "Segundo turno",
        text: `A projeção passa a indicar ${formatPercent(agora * 100, 1)} de chance de segundo turno (${dir === "sobe" ? "acima" : "abaixo"} de ${formatPercent(limiar * 100, 0)}).`,
        tipo: "segundo_turno",
      });
    }
  }

  // todas_ufs
  if (anterior.ufs_apuradas < TOTAL_UFS && estado.ufs_apuradas >= TOTAL_UFS) {
    eventos.push({
      id: "todas_ufs",
      ts,
      head: "Apuração",
      text: "As 27 unidades federativas e o exterior já têm boletim de urna na contagem.",
      tipo: "todas_ufs",
    });
  }

  return { eventos, estado };
}

// ---------------------------------------------------------------------------
// Mesclagem
// ---------------------------------------------------------------------------

function msDe(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Junta o histórico gravado com os eventos novos. Id repetido = mesmo fato:
 * fica o de `ts` mais ANTIGO (a primeira vez que o cron viu). Ordem: mais
 * novo primeiro; empate de `ts` desempata por id (ordem de código, sem
 * locale). Corta em {@link HISTORICO_MAX}.
 */
export function mesclarHistorico(
  existente: EventoBoletim[],
  novos: EventoBoletim[],
): EventoBoletim[] {
  const porId = new Map<string, EventoBoletim>();
  for (const e of [...existente, ...novos]) {
    const atual = porId.get(e.id);
    if (!atual || msDe(e.ts) < msDe(atual.ts)) porId.set(e.id, e);
  }
  return [...porId.values()]
    .sort((a, b) => msDe(b.ts) - msDe(a.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, HISTORICO_MAX);
}
