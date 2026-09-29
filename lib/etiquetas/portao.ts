/**
 * lib/etiquetas/portao.ts
 *
 * O **portão de cobertura** das visões agregadas (spec 024, RF-233): uma visão
 * que resume uma categoria — "Senado 2027 por bloco", "placar do
 * impeachment", "mapa dos palanques", "Câmara 2027" — só aparece quando
 * **todo candidato com chance** está classificado nela. Função pura; quem
 * decide o que fazer com o resultado é a tela (esconde a visão) e o vigia
 * (avisa quem falta classificar).
 *
 * ## Quem tem chance, por corrida
 *
 *   1. As posições que elegem ({@link posicoesQueElegem}): Governador no 1º
 *      turno, os 2 primeiros (os que vão ao 2º turno ou decidem no 1º); no
 *      2º turno, os 2 finalistas; Senado, as vagas da UF.
 *   2. Mais quem estiver a até `PORTAO_MARGEM_PP` pontos da **última posição
 *      que elege** — inclusive, e com tolerância de ponto flutuante. O
 *      colchão é por margem, não por posição: uma corrida embolada inclui
 *      mais gente, uma decidida não inclui ninguém além das vagas.
 *   3. Calculado em **Parcial** (`pct_atual`) e em **Projeção**
 *      (`pct_projetado`), e **unido**. O leitor alterna as duas bases na tela
 *      (constituição § 2, exceção de 1.5) — uma visão liberada numa base não
 *      pode esconder um não-classificado que lidera na outra.
 *
 * Regras de contagem:
 *   - candidatura `destino === "anulado"` fica de fora (não compete — ADR-0053);
 *     `sub_judice` e ausente competem.
 *   - `sqcand` ausente conta como **não classificado** (não há como juntar).
 *   - Parcial só entra com a corrida já apurando (`pctApurado > 0`): com zero
 *     apurado, todos têm 0% e o "a até 5 pontos" incluiria a corrida inteira
 *     por um empate que não é medição.
 *   - candidato sem número numa base conta como "com chance" nela (não dá
 *     para descartá-lo — mesma regra de "ausente nunca vira zero").
 *   - a **cauda** (`EdgeUfRow.outros`, quem ficou fora da lista publicada) é
 *     uma SOMA; se ela alcança o colchão, algum membro dela pode alcançar —
 *     aí o portão exige a corrida inteira (`universo`) classificada, e sem
 *     `universo` bloqueia.
 *
 * ## Fase pré-eleição
 *
 * Não há voto: os percentuais são zeros estruturais (spec 019) e a ordem é o
 * número de urna. "Com chance" não é mensurável, então o conjunto é **a
 * corrida inteira** — a visão só aparece antes da apuração se o campo todo
 * estiver classificado.
 *
 * ## Ordem
 *
 * Toda lista devolvida está na **ordem de entrada** e nunca depende de quem
 * está classificado (RF-238): o portão responde "quem", nunca reordena.
 */

import type { EdgeDestinoVoto, EdgeUfRow } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";

import { PORTAO_MARGEM_PP } from "./catalogo";
import { normalizarSqcand } from "./formato";

/** Tolerância de ponto flutuante na comparação com o colchão. */
const EPS = 1e-9;

export interface CandidatoNaCorrida {
  sqcand?: string | number | null;
  /** Número de urna — só para identificar no relatório. */
  id?: number | null;
  nome?: string | null;
  /** Projeção (0–100). Em `EdgeUfRow.top_candidatos` é o campo `pct`. */
  pct_projetado?: number | null;
  /** Parcial (0–100). Ausente ≠ zero. */
  pct_atual?: number | null;
  destino?: EdgeDestinoVoto;
}

export interface CorridaPortao {
  /** Identifica a corrida no relatório (ex.: "SP"). */
  chave: string;
  /** Quantas posições elegem ({@link posicoesQueElegem}). */
  posicoes: number;
  preEleicao: boolean;
  /** % apurado da corrida; Parcial só entra com > 0. */
  pctApurado: number | null;
  candidatos: readonly CandidatoNaCorrida[];
  /** Agregado da cauda fora da lista publicada. */
  cauda?: { pct?: number | null; pct_atual?: number | null } | null;
  /** Todos os `sqcand` da corrida — exigido quando a cauda pode ter chance, e na pré-eleição. */
  universo?: readonly (string | number)[] | null;
}

export type MotivoBloqueio =
  | "a_classificar"
  | "sem_sqcand"
  | "cauda_sem_universo"
  | "senado2031_indisponivel"
  | "agremiacao_a_classificar"
  | "universo_indisponivel";

export interface Bloqueante {
  corrida: string;
  /** `sqcand`, `senado:X`, ou `null` (sem identidade / agremiação / cauda). */
  chave: string | null;
  id?: number | null;
  nome?: string | null;
  motivo: MotivoBloqueio;
}

export interface ResultadoPortao {
  ok: boolean;
  bloqueantes: Bloqueante[];
}

/**
 * Posições que elegem numa corrida majoritária. Governador: 2 nos dois
 * turnos (no 1º, quem vai ao 2º turno ou decide; no 2º, os finalistas).
 * Senado: as vagas da UF (2 em 2026), vindas do payload quando houver.
 */
export function posicoesQueElegem(cargo: 3 | 5, _turno: 1 | 2, vagasUf?: number | null): number {
  if (cargo === 5) return vagasUf && vagasUf > 0 ? vagasUf : 2;
  return 2;
}

function finito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Os candidatos com chance de UMA corrida, na ordem de entrada, e se a cauda
 * (ou a fase) exige a corrida inteira.
 */
export function comChance(corrida: CorridaPortao): {
  membros: CandidatoNaCorrida[];
  exigeUniverso: boolean;
} {
  const competem = corrida.candidatos.filter((c) => compete(c));
  if (corrida.preEleicao) return { membros: competem, exigeUniverso: true };

  const escolhidos = new Set<CandidatoNaCorrida>();
  let exigeUniverso = false;
  const k = Math.max(1, corrida.posicoes);

  const bases = [
    {
      valor: (c: CandidatoNaCorrida) => c.pct_projetado,
      cauda: corrida.cauda?.pct,
      usar: true,
    },
    {
      valor: (c: CandidatoNaCorrida) => c.pct_atual,
      cauda: corrida.cauda?.pct_atual,
      usar: finito(corrida.pctApurado) && corrida.pctApurado > 0,
    },
  ];

  for (const base of bases) {
    if (!base.usar) continue;
    const conhecidos: CandidatoNaCorrida[] = [];
    for (const c of competem) {
      if (finito(base.valor(c))) conhecidos.push(c);
      else escolhidos.add(c); // sem número nesta base: não dá para descartar
    }
    if (conhecidos.length <= k) {
      for (const c of conhecidos) escolhidos.add(c);
      // Lista menor que as vagas: se há cauda, alguém dela está elegendo.
      if (corrida.cauda) exigeUniverso = true;
      continue;
    }
    const ordenados = [...conhecidos].sort(
      (a, b) => (base.valor(b) as number) - (base.valor(a) as number),
    );
    const corte = base.valor(ordenados[k - 1] as CandidatoNaCorrida) as number;
    for (const c of conhecidos) {
      if (corte - (base.valor(c) as number) <= PORTAO_MARGEM_PP + EPS) escolhidos.add(c);
    }
    if (finito(base.cauda) && corte - base.cauda <= PORTAO_MARGEM_PP + EPS) exigeUniverso = true;
  }

  return { membros: competem.filter((c) => escolhidos.has(c)), exigeUniverso };
}

/**
 * Avalia o portão sobre um conjunto de corridas para UMA categoria.
 * `classificado(sqcand)` responde se o candidato tem a categoria resolvida.
 */
export function avaliarCorridas(
  corridas: readonly CorridaPortao[],
  classificado: (sqcand: string) => boolean,
): ResultadoPortao {
  const bloqueantes: Bloqueante[] = [];
  for (const corrida of corridas) {
    const { membros, exigeUniverso } = comChance(corrida);
    const vistos = new Set<string>();
    for (const m of membros) {
      const sq = normalizarSqcand(m.sqcand);
      if (!sq) {
        bloqueantes.push({
          corrida: corrida.chave,
          chave: null,
          id: m.id,
          nome: m.nome,
          motivo: "sem_sqcand",
        });
        continue;
      }
      vistos.add(sq);
      if (!classificado(sq)) {
        bloqueantes.push({
          corrida: corrida.chave,
          chave: sq,
          id: m.id,
          nome: m.nome,
          motivo: "a_classificar",
        });
      }
    }
    if (!exigeUniverso) continue;
    if (!corrida.universo) {
      bloqueantes.push({ corrida: corrida.chave, chave: null, motivo: "cauda_sem_universo" });
      continue;
    }
    const anuladas = new Set(
      corrida.candidatos
        .filter((c) => !compete(c))
        .map((c) => normalizarSqcand(c.sqcand))
        .filter((s): s is string => s !== null),
    );
    for (const u of corrida.universo) {
      const sq = normalizarSqcand(u);
      if (!sq || vistos.has(sq) || anuladas.has(sq)) continue;
      vistos.add(sq);
      if (!classificado(sq)) {
        bloqueantes.push({ corrida: corrida.chave, chave: sq, motivo: "a_classificar" });
      }
    }
  }
  return { ok: bloqueantes.length === 0, bloqueantes };
}

/**
 * Os 27 que seguem até 2031 (V1, V2): a foto tem de estar disponível com
 * exatamente 27, e todos classificados.
 */
export function avaliarSenado2031(
  senado: { disponivel: boolean; codigos: readonly string[] },
  classificado: (codigo: string) => boolean,
): ResultadoPortao {
  if (!senado.disponivel || senado.codigos.length !== 27) {
    return {
      ok: false,
      bloqueantes: [{ corrida: "senado2031", chave: null, motivo: "senado2031_indisponivel" }],
    };
  }
  const bloqueantes: Bloqueante[] = senado.codigos
    .filter((c) => !classificado(c))
    .map((c) => ({
      corrida: "senado2031",
      chave: `senado:${c}`,
      motivo: "a_classificar" as const,
    }));
  return { ok: bloqueantes.length === 0, bloqueantes };
}

/** Câmara 2027: toda agremiação com cadeira > 0 precisa de padrão classificado. */
export function avaliarCamara2027(
  agremiacoes: readonly { sigla: string; tipo: "partido" | "federacao"; cadeiras: number }[],
  classificado: (sigla: string, tipo: "partido" | "federacao") => boolean,
): ResultadoPortao {
  const bloqueantes: Bloqueante[] = agremiacoes
    .filter((a) => a.cadeiras > 0 && !classificado(a.sigla, a.tipo))
    .map((a) => ({
      corrida: "camara2027",
      chave: null,
      nome: a.sigla,
      motivo: "agremiacao_a_classificar" as const,
    }));
  return { ok: bloqueantes.length === 0, bloqueantes };
}

/**
 * Uma corrida INTEIRA classificada (spec 025, V4 — renovação): quando a visão
 * precisa de toda candidatura da corrida, e não só de quem tem chance — "quem
 * tentou a reeleição e perdeu" só é uma lista completa se ninguém ficou
 * `a_classificar`. Universo vazio bloqueia (não há como provar cobertura), e a
 * ordem dos bloqueantes é a do universo (RF-238).
 */
export function avaliarUniverso(
  chave: string,
  universo: readonly (string | number)[] | null | undefined,
  classificado: (sqcand: string) => boolean,
): ResultadoPortao {
  if (!universo || universo.length === 0) {
    return {
      ok: false,
      bloqueantes: [{ corrida: chave, chave: null, motivo: "universo_indisponivel" }],
    };
  }
  const bloqueantes: Bloqueante[] = [];
  const vistos = new Set<string>();
  for (const u of universo) {
    const sq = normalizarSqcand(u);
    if (!sq || vistos.has(sq)) continue;
    vistos.add(sq);
    if (!classificado(sq)) bloqueantes.push({ corrida: chave, chave: sq, motivo: "a_classificar" });
  }
  return { ok: bloqueantes.length === 0, bloqueantes };
}

/** Junta resultados parciais (várias corridas + senado2031, por exemplo). */
export function juntarPortoes(...partes: readonly ResultadoPortao[]): ResultadoPortao {
  const bloqueantes = partes.flatMap((p) => p.bloqueantes);
  return { ok: partes.every((p) => p.ok), bloqueantes };
}

/**
 * Adaptador de uma linha do payload nacional de Governador/Senador
 * (`EdgePayload.por_uf[]`) para o portão.
 */
export function corridaDeUfRow(
  row: EdgeUfRow,
  opts: {
    cargo: 3 | 5;
    turno: 1 | 2;
    preEleicao: boolean;
    vagasUf?: number | null;
    universo?: readonly (string | number)[] | null;
  },
): CorridaPortao {
  return {
    chave: row.sigla,
    posicoes: posicoesQueElegem(opts.cargo, opts.turno, opts.vagasUf),
    preEleicao: opts.preEleicao,
    pctApurado: row.pct_apurado,
    candidatos: row.top_candidatos.map((c) => ({
      sqcand: c.sqcand ?? null,
      id: c.id,
      nome: c.nome ?? null,
      pct_projetado: c.pct,
      pct_atual: c.pct_atual ?? null,
      destino: c.destino,
    })),
    cauda: row.outros ? { pct: row.outros.pct, pct_atual: row.outros.pct_atual ?? null } : null,
    universo: opts.universo ?? null,
  };
}
