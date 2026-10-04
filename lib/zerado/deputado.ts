/**
 * lib/zerado/deputado.ts — o placar ZERADO das telas de Deputado (ADR-0076).
 *
 * Decisão do dono em 04/10/2026: antes do primeiro boletim, as telas de
 * Deputado Federal (6), Estadual (7) e Distrital (8) abrem no layout normal da
 * apuração com tudo em zero — todas as agremiações, todas as candidaturas com
 * foto, 0 votos, 0 cadeiras de N, 0% apurado — em vez da tela de espera.
 *
 * Este módulo monta esses objetos nas FORMAS que as páginas já consomem
 * (`DeputadoUfDetail`, `DeputadoUfLinha`, `DeputadoUfLista`), a partir do
 * cadastro de candidaturas do Blob (`readCandidatosUf`). Nada aqui é gravado:
 * é só para a tela, e nunca sai para um writer.
 *
 * O que o objeto NÃO tem, de propósito: `fase`, `dado_ts`, `projecao`,
 * `regras`, `conferencia`, `mais_votados`, `puxadores`, marcas de eleito.
 * Ninguém tem voto, então nenhum desses blocos tem o que dizer.
 *
 * Ordem: o sorteio fixo do dia ({@link ordemSorteada}), por `sqcand` dentro da
 * agremiação e por sigla entre agremiações. Determinístico (constituição § 6).
 *
 * 🔴 Gatilho (quem decide é o chamador, não este módulo): chave AUSENTE, payload
 * na fase pré-eleição (`isPreEleicao`), ou payload real sem candidatura para a página.
 * NUNCA quando a leitura FALHOU — falha mantém a tela honesta sem número (regra
 * do dono: nunca fabricar zeros para cobrir uma falha).
 */

import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import type {
  DeputadoUfAgremiacao,
  DeputadoUfDetail,
  DeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import type { DeputadoUfLinha, EdgePayloadDeputado } from "@/lib/edge-config/types";

import { ordemSorteada, sementeDoTurno } from "./ordem";

/** Tamanho da Câmara dos Deputados (fixo; o PLP 177/2023 foi vetado). */
export const CAMARA_TOTAL_CADEIRAS = 513;

/** Cadeiras na Câmara dos Deputados por UF (LC 78/1993; mesmos números do produtor). */
// biome-ignore format: tabela
export const CADEIRAS_FEDERAL_POR_UF: Readonly<Record<string, number>> = {
  AC: 8, AL: 9, AM: 8, AP: 8, BA: 39, CE: 22, DF: 8, ES: 10, GO: 17, MA: 18, MG: 53, MS: 8,
  MT: 8, PA: 17, PB: 12, PE: 25, PI: 10, PR: 30, RJ: 46, RN: 8, RO: 8, RR: 8, RS: 31, SC: 16,
  SE: 8, SP: 70, TO: 8,
};

/** Cadeiras nas Assembleias Legislativas (CF art. 27). DF não tem (é a Câmara Legislativa). */
// biome-ignore format: tabela
export const CADEIRAS_ESTADUAL_POR_UF: Readonly<Record<string, number>> = {
  SP: 94, MG: 77, RJ: 70, BA: 63, RS: 55, PR: 54, PE: 49, CE: 46, MA: 42, GO: 41, PA: 41,
  SC: 40, PB: 36, ES: 30, PI: 30, AL: 27, AC: 24, AM: 24, AP: 24, MS: 24, MT: 24, RN: 24,
  RO: 24, RR: 24, SE: 24, TO: 24,
};

/** Câmara Legislativa do DF (CF art. 32 § 3º — 3 × 8 federais). */
export const CADEIRAS_DISTRITAL = 24;

/** Cadeiras a preencher na UF para a casa do cargo, ou `null` fora das UFs da casa. */
export function cadeirasDaCasaNaUf(cargo: CargoProporcional, sigla: string): number | null {
  const uf = sigla.toUpperCase();
  if (cargo === 6) return CADEIRAS_FEDERAL_POR_UF[uf] ?? null;
  if (cargo === 7) return CADEIRAS_ESTADUAL_POR_UF[uf] ?? null;
  return uf === "DF" ? CADEIRAS_DISTRITAL : null;
}

/** A sigla da agremiação de uma candidatura: a federação, se houver; senão o partido. */
export function siglaDaAgremiacao(c: Pick<CandidatoIdentidade, "federacao" | "partido">): string {
  return c.federacao ?? c.partido;
}

/**
 * O partido que dá a COR da federação a zero: sem voto não há "líder" medido
 * (ADR-0024), então vale o componente com MAIS candidaturas (desempate pela
 * sigla). Nunca o primeiro em ordem alfabética, que pintaria a federação com
 * a cor de um sócio menor.
 */
function liderPorCandidaturas(partidos: readonly string[]): string | undefined {
  const contagem = new Map<string, number>();
  for (const p of partidos) contagem.set(p, (contagem.get(p) ?? 0) + 1);
  return [...contagem.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
  )[0]?.[0];
}

function linhaZerada(c: CandidatoIdentidade, rank: number): DeputadoUfLinha {
  return {
    sqcand: Number(c.sqcand),
    nome: c.nome_urna || c.nome,
    partido: c.partido,
    numero: c.numero,
    votos: 0,
    rank,
    pct_validos: 0,
  };
}

/**
 * Agremiações da UF com TODAS as candidaturas, zeradas, na ordem sorteada.
 * `candidatos` vem inteiro (sem o corte de 60): quem corta é
 * {@link detalheZeradoUf}, que sabe o cargo.
 */
export function agremiacoesZeradas(
  candidatos: readonly CandidatoIdentidade[],
): DeputadoUfAgremiacao[] {
  const semente = sementeDoTurno(1);
  const porSigla = new Map<string, CandidatoIdentidade[]>();
  for (const c of candidatos) {
    const sigla = siglaDaAgremiacao(c);
    const grupo = porSigla.get(sigla);
    if (grupo) grupo.push(c);
    else porSigla.set(sigla, [c]);
  }
  const siglas = ordemSorteada([...porSigla.keys()], (s) => s, semente);
  return siglas.map((sigla) => {
    const grupo = ordemSorteada(porSigla.get(sigla) ?? [], (c) => c.sqcand, semente);
    const componentes = [...new Set(grupo.map((c) => c.partido))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
    const federacao = grupo.some((c) => c.federacao !== undefined);
    return {
      // Sem o número do partido no cadastro: a sigla é a chave (única na UF).
      cod: sigla,
      sigla,
      nome: sigla,
      tipo: federacao ? "federacao" : "partido",
      componentes: federacao ? componentes : [],
      sigla_lider: federacao ? (liderPorCandidaturas(grupo.map((c) => c.partido)) ?? sigla) : sigla,
      votos_nominais: 0,
      votos_legenda: 0,
      votos_validos: 0,
      pct_votos: 0,
      quociente_partidario: 0,
      cadeiras: 0,
      eleitos: [],
      suplentes: [],
      candidatos: grupo.map((c, i) => linhaZerada(c, i + 1)),
      total_candidatos: grupo.length,
    } satisfies DeputadoUfAgremiacao;
  });
}

/**
 * Federal zerado: quantas linhas por agremiação vão ao DOCUMENTO — o conjunto
 * visível por padrão ("eleitos + 7", com zero eleitos). O resto vem pela rota
 * da lista no "mostrar todos", com foto. Medido em 04/10 sobre o cadastro do
 * simulado de SP: com as 60 de sempre no documento E foto em toda linha, o HTML
 * de `/uf/SP/deputado-federal` passaria do teto de 576 KiB (+~200 KiB de
 * `<img>`); com 7, fica abaixo do da página com dado real.
 */
export const LINHAS_NO_DOCUMENTO_ZERADO_FEDERAL = 7;

/** Resultado de {@link detalheZeradoUf}: o objeto da página e, no federal, o resto (61+). */
export interface ZeradoUf {
  detail: DeputadoUfDetail;
  /** Federal: as linhas fora do documento, no envelope da rota da lista. `null` se não há. */
  lista: DeputadoUfLista | null;
}

/**
 * O detalhe ZERADO da UF, na forma do Blob (`DeputadoUfDetail`, contrato 2).
 *
 * Federal: só os ranks 1..{@link LINHAS_NO_DOCUMENTO_ZERADO_FEDERAL} vão ao
 * objeto da página; o resto vai em `lista` (servido pela rota `/lista`).
 * Assembleias: o objeto leva todos — a página corta em "eleitos + 7" e a rota
 * devolve o resto.
 *
 * `ts` vazio: não há gravação nenhuma para datar, e a tela zerada não mostra
 * relógio.
 */
export function detalheZeradoUf(
  cargo: CargoProporcional,
  sigla: string,
  candidatos: readonly CandidatoIdentidade[],
): ZeradoUf {
  const uf = sigla.toUpperCase();
  const todas = agremiacoesZeradas(candidatos);
  const cortar = cargo === 6;
  let restantes = 0;
  const listaAgr: DeputadoUfLista["agremiacoes"] = [];
  const agremiacoes = todas.map((a) => {
    if (!cortar) return a;
    const linhas = a.candidatos ?? [];
    const fora = linhas.filter((l) => l.rank > LINHAS_NO_DOCUMENTO_ZERADO_FEDERAL);
    if (fora.length === 0) return a;
    restantes += fora.length;
    listaAgr.push({ cod: a.cod, candidatos: fora });
    return {
      ...a,
      candidatos: linhas.filter((l) => l.rank <= LINHAS_NO_DOCUMENTO_ZERADO_FEDERAL),
    };
  });
  const detail: DeputadoUfDetail = {
    ts: "",
    cargo,
    turno: 1,
    uf,
    pct_apurado: 0,
    lugares_a_preencher: cadeirasDaCasaNaUf(cargo, uf),
    quociente_eleitoral: null,
    quociente_eleitoral_tse: null,
    totalizacao_final: false,
    divergencias: [],
    agremiacoes,
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    contrato: 2,
    ...(restantes > 0 ? { lista: { restantes } } : {}),
  };
  const lista: DeputadoUfLista | null =
    restantes > 0 ? { ts: "", cargo, turno: 1, contrato: 2, uf, agremiacoes: listaAgr } : null;
  return { detail, lista };
}

/**
 * O payload nacional ZERADO da Câmara (cargo 6), na forma de
 * `EdgePayloadDeputado`: 513 cadeiras, nenhuma atribuída, 27 UFs aguardando,
 * 0% apurado. Sem `fase`, sem `dado_ts`, sem mais votados nem puxadores.
 * `por_agremiacao` vem de fora (pode ser `[]`), já na ordem sorteada.
 */
export function nacionalZeradoCamara(
  porAgremiacao: EdgePayloadDeputado["bancada"]["por_agremiacao"] = [],
): EdgePayloadDeputado {
  return {
    ts: "",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 0,
    ufs_apuradas: 0,
    atualizacao_min: 0,
    bancada: {
      total_cadeiras: CAMARA_TOTAL_CADEIRAS,
      cadeiras_atribuidas: 0,
      ufs_calculadas: 0,
      ufs_aguardando: Object.keys(CADEIRAS_FEDERAL_POR_UF).length,
      por_agremiacao: porAgremiacao,
    },
    por_uf: [],
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 0 },
  };
}

/**
 * As agremiações do país a zero, a partir das candidaturas de várias UFs:
 * uma linha por sigla de agremiação (federação ou partido), na ordem sorteada.
 */
export function bancadaZerada(
  candidatos: Iterable<Pick<CandidatoIdentidade, "federacao" | "partido">>,
): EdgePayloadDeputado["bancada"]["por_agremiacao"] {
  const componentes = new Map<string, Set<string>>();
  const partidosPorSigla = new Map<string, string[]>();
  const federacoes = new Set<string>();
  for (const c of candidatos) {
    const sigla = siglaDaAgremiacao(c);
    if (c.federacao !== undefined) federacoes.add(sigla);
    const s = componentes.get(sigla) ?? new Set<string>();
    s.add(c.partido);
    componentes.set(sigla, s);
    const lista = partidosPorSigla.get(sigla) ?? [];
    lista.push(c.partido);
    partidosPorSigla.set(sigla, lista);
  }
  return ordemSorteada([...componentes.keys()], (s) => s, sementeDoTurno(1)).map((sigla) => {
    const federacao = federacoes.has(sigla);
    const comps = [...(componentes.get(sigla) ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      cod: sigla,
      sigla,
      nome: sigla,
      tipo: federacao ? ("federacao" as const) : ("partido" as const),
      componentes: federacao ? comps : [],
      sigla_lider: federacao
        ? (liderPorCandidaturas(partidosPorSigla.get(sigla) ?? []) ?? sigla)
        : sigla,
      cadeiras: 0,
      votos_nominais: 0,
      votos_legenda: 0,
      votos_validos: 0,
      pct_votos: 0,
    };
  });
}
