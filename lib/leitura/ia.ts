/**
 * lib/leitura/ia.ts
 *
 * A caixa "Análise" da leitura da noite (ADR-0072, que revoga o ADR-0005 só
 * para ela): 2 a 4 frases escritas por LLM a partir do payload da projeção
 * presidencial, publicadas sem revisão humana.
 *
 * 🔴 **É o ÚNICO arquivo do projeto que importa `ai`.** Quem chama é o cron
 * `/api/internal/leitura-noite` (via `lib/leitura/ciclo-producao.ts`); nada
 * que uma página importa pode chegar aqui — o pacote não entra no bundle do
 * leitor, e a tela lê só o JSON gravado no Blob.
 *
 * Três peças, separadas para teste:
 *   - {@link montarEntradaIA} — o JSON compacto (< 8 KB) que a IA lê. Só
 *     números do payload, já arredondados e já em %; nada de municípios,
 *     séries ou `votacao`.
 *   - {@link limparFrases} — tira markdown e corta em 400 caracteres. NÃO é
 *     verificador de conteúdo (decisão do dono: a única trava de conteúdo é a
 *     instrução "sem adjetivos de mérito sobre candidatos").
 *   - {@link gerarAnaliseIA} — chama a geração (injetável) e devolve a
 *     `AnaliseIA`. Lança se a geração falhar ou vier vazia; quem chama trata.
 *
 * API do AI SDK v7 (conferida em `node_modules/ai/docs`, 04/10/2026):
 *   - `generateText` + `output: Output.object({ schema })` — `generateObject`
 *     está obsoleto;
 *   - `instructions` é o nome atual da instrução de sistema (`system` está
 *     marcado como obsoleto na referência de `generateText`);
 *   - `maxOutputTokens` é o teto de tokens de saída; `maxRetries` e
 *     `abortSignal` são opções de requisição;
 *   - model id em string vai para o AI Gateway (provedor global padrão).
 *     Em produção a autenticação é por OIDC da Vercel ou `AI_GATEWAY_API_KEY`.
 */

import { generateText, Output } from "ai";
import { z } from "zod";

import { rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import type { EdgeCandidate, EdgePayload } from "@/lib/edge-config/types";
import { eleitosNacionais } from "@/lib/utils/anuncios-definidos";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

import { type AnaliseIA, EVENTOS_LEGADOS_OCULTOS, type EventoBoletim } from "./types";

/** Slug do AI Gateway usado quando o interruptor não traz `modelo`. */
export const MODELO_PADRAO = "anthropic/claude-sonnet-5.5";

/** Teto do JSON de entrada, em BYTES UTF-8 (nomes acentuados contam 2). */
export const ENTRADA_MAX_BYTES = 8_000;

/** Quantos candidatos entram, por `rank`. */
const CANDIDATOS_MAX = 6;
/** Quantos cenários de 2º turno entram, por probabilidade. */
const CENARIOS_MAX = 3;
/** Quantos eventos do histórico entram (os mais recentes). */
const EVENTOS_MAX = 8;
/** Teto de um nome de candidato na entrada (os reais têm bem menos). */
const NOME_MAX = 40;
/** Comprimento máximo de uma frase publicada. */
export const FRASE_MAX = 400;

/** Tempo máximo de uma geração (ms). */
export const TIMEOUT_IA_MS = 20_000;
/** Teto de tokens de saída — 4 frases de 400 caracteres cabem com folga. */
export const MAX_TOKENS_SAIDA = 600;

const FUSO_BRASILIA = "America/Sao_Paulo";

// ---------------------------------------------------------------------------
// Instrução de sistema
// ---------------------------------------------------------------------------

/**
 * A instrução de sistema. A regra "sem adjetivos de mérito sobre candidatos"
 * é a ÚNICA trava de conteúdo (decisão do dono, 04/10): não há verificador
 * depois da geração.
 */
export const INSTRUCAO_SISTEMA = [
  "Você escreve a análise jornalística da apuração da eleição presidencial brasileira para a página inicial de um site público, o AtlasMenna.",
  "Você recebe um JSON com o estado da apuração e da projeção. Escreva a análise com estas regras, todas obrigatórias:",
  "1. De 2 a 4 frases curtas, em português do Brasil, em tom sóbrio e informativo.",
  "2. Use SOMENTE números que estão no JSON. Não calcule, não estime, não arredonde de outro jeito e não traga nenhum dado de fora.",
  '3. Separe sempre o "apurado" (a contagem oficial do TSE, campos apurado_*) da "projeção não oficial do AtlasMenna" (campos projecao_* e prob_*). Ao citar um número da projeção, diga que é projeção do AtlasMenna.',
  "4. Nunca declare ninguém eleito e nunca diga que alguém venceu ou ganhou a eleição. Probabilidade não é resultado. Única exceção: a regra 9.",
  '5. Números em formato brasileiro: vírgula decimal (36,8%), e "pp" para pontos percentuais (3,2 pp).',
  "6. Não repita o texto das frases_anteriores. Traga o que mudou desde então; se pouco mudou, diga o essencial com outras palavras.",
  "7. Sem adjetivos de mérito sobre candidatos: não qualifique pessoas, campanhas ou partidos (nada de 'forte', 'fraco', 'brilhante', 'desastroso', 'surpreendente'). Descreva números e fatos.",
  "8. Texto corrido em cada frase: sem markdown, sem listas, sem títulos, sem emojis.",
  "9. nacional.eleitos_matematicamente, quando existe, lista quem a contagem oficial do TSE já garante matematicamente como eleito. Só esse nome pode ser dito matematicamente eleito, sempre atribuindo à contagem oficial do TSE. Sem esse campo, ninguém está eleito. ufs_com_apuracao_iniciada conta UFs com alguma urna apurada, não UFs com apuração concluída.",
  "A hora no JSON é a de Brasília.",
].join("\n");

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const r2 = (x: number): number => Math.round(x * 100) / 100;
/** Probabilidade 0–1 → % com 1 casa (a IA não precisa converter nada). */
const probPct = (p: number): number => Math.round(p * 1000) / 10;
const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function horaBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BRASILIA,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function horaBrasiliaIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? horaBrasilia(new Date(t)) : null;
}

function cortar(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function bytes(valor: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valor)).length;
}

/** Nome de exibição, com teto de {@link NOME_MAX} caracteres (pior caso de bytes). */
function nomeDe(c: { nome: string; sqcand?: string | null }): string {
  return cortar(nomeExibicao(c.nome, c.sqcand ?? null), NOME_MAX);
}

function candidatoParaIA(c: EdgeCandidate): Record<string, unknown> {
  const out: Record<string, unknown> = {
    rank: c.rank,
    nome: nomeDe(c),
    partido: c.partido,
  };
  if (c.destino && c.destino !== "valido") out.destino_dos_votos = c.destino;
  if (finito(c.pct_atual)) out.apurado_pct = r2(c.pct_atual);
  if (finito(c.votos_atuais)) out.apurado_votos = c.votos_atuais;
  if (finito(c.pct_projetado)) out.projecao_pct = r2(c.pct_projetado);
  if (finito(c.pct_projetado_lower) && finito(c.pct_projetado_upper)) {
    out.projecao_ic95_pct = [r2(c.pct_projetado_lower), r2(c.pct_projetado_upper)];
  }
  if (finito(c.p_vitoria)) out.prob_vitoria_pct = probPct(c.p_vitoria);
  if (finito(c.p_passa_2t)) out.prob_ir_ao_2t_pct = probPct(c.p_passa_2t);
  if (finito(c.p_fecha_1t)) out.prob_vencer_no_1t_pct = probPct(c.p_fecha_1t);
  return out;
}

/** Colunas de cada linha de `ufs` na entrada. */
export const UFS_COLUNAS = ["uf", "apurado_pct", "lider_projecao", "margem_projecao_pp"] as const;

interface OpcoesEnxugar {
  eventoTextoMax: number;
  eventosMax: number;
  fraseAnteriorMax: number;
}

const NIVEIS_ENXUGAR: readonly OpcoesEnxugar[] = [
  { eventoTextoMax: 200, eventosMax: EVENTOS_MAX, fraseAnteriorMax: FRASE_MAX },
  { eventoTextoMax: 120, eventosMax: EVENTOS_MAX, fraseAnteriorMax: FRASE_MAX },
  { eventoTextoMax: 120, eventosMax: 5, fraseAnteriorMax: 240 },
  { eventoTextoMax: 80, eventosMax: 3, fraseAnteriorMax: 160 },
  { eventoTextoMax: 60, eventosMax: 2, fraseAnteriorMax: 100 },
  { eventoTextoMax: 0, eventosMax: 0, fraseAnteriorMax: 0 },
];

/**
 * O JSON que a IA lê. Compacto (< {@link ENTRADA_MAX_BYTES} em bytes UTF-8):
 * quando passa, enxuga em degraus — primeiro o texto dos eventos, depois
 * quantos eventos e o tamanho das frases anteriores. Os números da corrida
 * (candidatos, cenários, UFs) nunca são cortados.
 *
 * Chaves nomeadas para a IA não confundir as duas leituras: `apurado_*` é a
 * contagem do TSE; `projecao_*` e `prob_*` são do modelo do AtlasMenna.
 * Probabilidades já vêm em % (0–100, 1 casa) para a IA não fazer conta.
 */
export function montarEntradaIA(
  payload: EdgePayload,
  historico: EventoBoletim[],
  anterior: AnaliseIA | null,
  agora: Date,
): Record<string, unknown> {
  const candidatos = [...(payload.national?.candidatos ?? [])];
  const nomePorId = new Map<number, string>();
  for (const c of candidatos) nomePorId.set(c.id, nomeDe(c));

  const topo = candidatos
    .filter((c) => finito(c.rank))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, CANDIDATOS_MAX)
    .map(candidatoParaIA);

  const nacional: Record<string, unknown> = {};
  const p2t = payload.national?.p_segundo_turno_overall;
  if (finito(p2t)) nacional.prob_haver_2t_pct = probPct(p2t);
  const cenarios = [...(payload.national?.cenarios_2t ?? [])]
    .filter((c) => finito(c.prob))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, CENARIOS_MAX)
    .map((c) => ({
      par: c.par.map((id) => nomePorId.get(id) ?? `candidato ${id}`),
      prob_pct: probPct(c.prob),
    }));
  if (cenarios.length > 0) nacional.cenarios_2t_projetados = cenarios;
  // 🔴 2026-10-04 (dono) — a coluna `chamada` das UFs (leitura da PROJEÇÃO)
  // saiu: a IA não deve dizer "chamada". O que vai é o FATO da contagem — quem
  // está matematicamente eleito no Brasil (`eleitos_definidos`), só quando há.
  const eleitosIds = eleitosNacionais(payload.por_uf);
  if (eleitosIds.length > 0) {
    nacional.eleitos_matematicamente = eleitosIds.map((id) => {
      const nome = nomePorId.get(id);
      if (nome) return nome;
      const t = (payload.por_uf ?? [])
        .flatMap((u) => u.top_candidatos ?? [])
        .find((c) => c.id === id);
      return t?.nome ? nomeDe({ nome: t.nome, sqcand: t.sqcand ?? null }) : `candidato ${id}`;
    });
  }

  // Em tabela (colunas + linhas): 27 objetos com as chaves repetidas custavam
  // ~2,7 KB; em linhas, ~1 KB.
  const ufs = (payload.por_uf ?? []).map((u) => {
    const lider =
      nomePorId.get(u.lider) ??
      (() => {
        const t = u.top_candidatos?.find((c) => c.id === u.lider);
        return t?.nome
          ? nomeDe({ nome: t.nome, sqcand: t.sqcand ?? null })
          : `candidato ${u.lider}`;
      })();
    return [
      // ADR-0045 — "Exterior", nunca "ZZ": o modelo escreveria a sigla crua.
      rotuloDaUnidade(u.sigla),
      finito(u.pct_apurado) ? r2(u.pct_apurado) : null,
      lider,
      finito(u.margem_projetada) ? r2(u.margem_projetada) : null,
    ];
  });

  const geral: Record<string, unknown> = {
    hora_brasilia: horaBrasilia(agora),
    turno: payload.turno,
    apurado_total_pct: r2(payload.pct_apurado_total),
    ufs_com_apuracao_iniciada: payload.ufs_apuradas,
  };
  const horaDado = horaBrasiliaIso(payload.dado_ts);
  if (horaDado) geral.hora_do_dado_tse = horaDado;

  const recentes = historico
    .filter((e) => !EVENTOS_LEGADOS_OCULTOS.has(e.tipo))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, EVENTOS_MAX);

  const montar = (o: OpcoesEnxugar): Record<string, unknown> => {
    const entrada: Record<string, unknown> = {
      geral,
      candidatos: topo,
      nacional,
      ufs_colunas: UFS_COLUNAS,
      ufs,
      eventos_recentes: recentes.slice(0, o.eventosMax).map((e) => ({
        hora: horaBrasiliaIso(e.ts),
        titulo: cortar(e.head, 60),
        texto: cortar(e.text, o.eventoTextoMax),
      })),
    };
    if (anterior && anterior.frases.length > 0 && o.fraseAnteriorMax > 0) {
      entrada.frases_anteriores = anterior.frases
        .slice(0, 4)
        .map((f) => cortar(f, o.fraseAnteriorMax));
      const h = horaBrasiliaIso(anterior.gerado_em);
      if (h) entrada.frases_anteriores_hora = h;
    }
    return entrada;
  };

  let entrada = montar(NIVEIS_ENXUGAR[0] as OpcoesEnxugar);
  for (const nivel of NIVEIS_ENXUGAR.slice(1)) {
    if (bytes(entrada) < ENTRADA_MAX_BYTES) break;
    entrada = montar(nivel);
  }
  return entrada;
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

/**
 * Tira markdown (`**`, `#` e `- ` no começo), colapsa espaços e corta em
 * {@link FRASE_MAX} caracteres. Descarta frase que fica vazia. **Não** é
 * verificador de conteúdo.
 */
export function limparFrases(frases: string[]): string[] {
  const out: string[] = [];
  for (const bruta of frases) {
    if (typeof bruta !== "string") continue;
    const limpa = bruta
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^-\s+/, "")
      .trim()
      .slice(0, FRASE_MAX)
      .trim();
    if (limpa.length > 0) out.push(limpa);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

/** Schema da saída estruturada. */
export const SaidaIASchema = z.object({
  frases: z.array(z.string().min(20).max(FRASE_MAX)).min(2).max(4),
});

export type GerarFn = (args: {
  modelo: string;
  system: string;
  prompt: string;
}) => Promise<string[]>;

/** Implementação real: AI Gateway via `generateText` + `Output.object`. */
const gerarPadrao: GerarFn = async ({ modelo, system, prompt }) => {
  const { output } = await generateText({
    model: modelo,
    instructions: system,
    prompt,
    output: Output.object({ schema: SaidaIASchema }),
    maxOutputTokens: MAX_TOKENS_SAIDA,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(TIMEOUT_IA_MS),
  });
  return output.frases;
};

/**
 * Gera a análise. **Lança** se a geração falhar ou vier vazia (depois da
 * limpeza) — quem chama mantém o texto anterior e registra a tentativa.
 *
 * `gerado_em` é o `agora` do ciclo (determinístico; a geração dura no
 * máximo {@link TIMEOUT_IA_MS}).
 */
export async function gerarAnaliseIA(args: {
  payload: EdgePayload;
  historico: EventoBoletim[];
  anterior: AnaliseIA | null;
  modelo?: string;
  agora: Date;
  gerar?: GerarFn;
}): Promise<AnaliseIA> {
  const modelo = args.modelo ?? MODELO_PADRAO;
  const gerar = args.gerar ?? gerarPadrao;
  const entrada = montarEntradaIA(args.payload, args.historico, args.anterior, args.agora);
  const prompt = `Estado da apuração presidencial (JSON):\n${JSON.stringify(entrada)}\n\nEscreva a análise seguindo as regras.`;

  const brutas = await gerar({ modelo, system: INSTRUCAO_SISTEMA, prompt });
  const frases = limparFrases(Array.isArray(brutas) ? brutas : []).slice(0, 4);
  if (frases.length === 0) {
    throw new Error("a IA devolveu uma análise vazia");
  }
  return {
    frases,
    modelo,
    gerado_em: args.agora.toISOString(),
    base_ts: args.payload.ts,
    base_pct: args.payload.pct_apurado_total,
  };
}
