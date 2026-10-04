/**
 * lib/leitura/ciclo.ts
 *
 * Um ciclo do cron `/api/internal/leitura-noite` (ADR-0072): lê o payload da
 * projeção presidencial e a leitura anterior, e produz a nova "leitura da
 * noite" — histórico do Boletim, manchetes e análise por IA.
 *
 * Toda a I/O entra por {@link DepsCiclo}; este arquivo não importa `ai`, nem
 * `@vercel/blob`, nem `@vercel/edge-config` (a ligação real fica em
 * `lib/leitura/ciclo-producao.ts`). **Nunca lança**: o pior desfecho é
 * `{ gravou: false, motivo }`.
 *
 * Ordem e regras:
 *   1. lê em paralelo interruptor, payload e anterior, cada um isolado. Sem
 *      payload, sai sem gravar.
 *   2. histórico SEMPRE (mesmo com o interruptor desligado): é a memória da
 *      noite, e a hora de cada linha é a hora em que o cron a viu — não dá
 *      para reconstruir depois.
 *   3. notícias se ligadas (ou ensaio), no máximo a cada 5 min.
 *   4. IA se ligada, fora da pré-eleição, com apuração > 0, no máximo uma
 *      tentativa a cada 4 min, e só quando há o que dizer (2 pp a mais, evento
 *      novo, texto com mais de 10 min, ou nenhum texto ainda). Ensaio força.
 *   5. grava quando algo mudou ou quando a última gravação tem mais de
 *      10 min. Ensaio NUNCA grava.
 *
 * 🔴 Falha ao LER a leitura anterior (rede, 5xx) ≠ leitura anterior ausente:
 * na falha o ciclo NÃO grava — gravar por cima apagaria o histórico da noite
 * inteira por causa de um soluço de rede. Ausente (404) ou corrompida é
 * `null` e o ciclo recomeça do zero (decisão de `ciclo-producao.ts`).
 */

import { isPreEleicao } from "@/lib/config/fase";
import type { EdgePayload } from "@/lib/edge-config/types";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

import { derivarEventos, mesclarHistorico } from "./eventos";
import { filtrarRelevantes, mesclarManchetes } from "./feeds";
import {
  type AnaliseIA,
  type EstadoResumo,
  type EventoBoletim,
  INTERRUPTOR_DESLIGADO,
  type InterruptorLeitura,
  type LeituraNoite,
  type Manchete,
} from "./types";

export interface DepsCiclo {
  agora: () => Date;
  lerInterruptor: () => Promise<InterruptorLeitura>;
  lerPayload: () => Promise<EdgePayload | null>;
  lerAnterior: () => Promise<LeituraNoite | null>;
  buscarFeeds: () => Promise<{ itens: Manchete[]; porFeed: Record<string, number | "erro"> }>;
  gerarAnalise: (args: {
    payload: EdgePayload;
    historico: EventoBoletim[];
    anterior: AnaliseIA | null;
    modelo?: string;
    agora: Date;
  }) => Promise<AnaliseIA>;
  gravar: (leitura: LeituraNoite) => Promise<void>;
  /** true: força IA e notícias, NUNCA grava. */
  ensaio?: boolean;
}

export interface ResultadoCiclo {
  gravou: boolean;
  eventosNovos: number;
  noticias: { buscou: boolean; porFeed?: Record<string, number | "erro">; total?: number };
  ia: { tentou: boolean; ok?: boolean; erro?: string; frases?: string[] };
  motivo?: string;
  leitura?: LeituraNoite;
}

/** Intervalo mínimo entre duas buscas de feeds. */
export const NOTICIAS_INTERVALO_MS = 5 * 60_000;
/** Intervalo mínimo entre duas tentativas da IA (com ou sem sucesso). */
export const IA_INTERVALO_TENTATIVA_MS = 4 * 60_000;
/** O apurado andou isto (pp) desde o texto anterior ⇒ texto novo. */
export const IA_PASSO_PP = 2;
/** Texto da IA com mais que isto ⇒ texto novo. */
export const IA_IDADE_RENOVAR_MS = 10 * 60_000;
/** Sem mudança, regrava mesmo assim depois disto (o "batimento" do objeto). */
export const REGRAVAR_MS = 10 * 60_000;
/** Ciclo que já gastou isto não chama a IA (teto da função: 60 s; IA: 20 s). */
export const ORCAMENTO_ANTES_DA_IA_MS = 25_000;

/**
 * Meia-noite de Brasília do dia de cada turno, em UTC — o piso de data das
 * manchetes (mesmos instantes de `CALENDAR_2026`, `lib/config/calendar.ts`).
 */
export const INICIO_DO_TURNO_UTC: Readonly<Record<1 | 2, string>> = Object.freeze({
  1: "2026-10-04T03:00:00Z",
  2: "2026-10-25T03:00:00Z",
});

/** Sufixos que não identificam ninguém numa manchete. */
const SUFIXOS_DE_NOME = new Set(["junior", "júnior", "filho", "neto", "sobrinho", "segundo"]);

/**
 * Termos extras do filtro de manchetes: o último nome de exibição de cada
 * candidato (pulando sufixos como "Júnior"), com 4 letras ou mais — um termo
 * curto ("PT") casaria com metade das palavras da língua.
 */
export function sobrenomesDoPayload(payload: EdgePayload): string[] {
  const termos = new Set<string>();
  for (const c of payload.national?.candidatos ?? []) {
    let nome: string;
    try {
      nome = nomeExibicao(c.nome, c.sqcand ?? null);
    } catch {
      continue;
    }
    const tokens = nome
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ""))
      .filter(Boolean);
    while (tokens.length > 1 && SUFIXOS_DE_NOME.has((tokens.at(-1) as string).toLowerCase())) {
      tokens.pop();
    }
    const ultimo = tokens.at(-1);
    if (ultimo && ultimo.length >= 4) termos.add(ultimo);
  }
  return [...termos];
}

function msDe(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

/** Mais de `limiteMs` desde `iso`? Ausente ou ilegível conta como "sim". */
function passou(iso: string | null | undefined, agoraMs: number, limiteMs: number): boolean {
  const t = msDe(iso);
  return !Number.isFinite(t) || agoraMs - t > limiteMs;
}

/** Mensagem curta e sem URL — vai para o JSON PÚBLICO (`ia_tentativa.erro`). */
export function mensagemCurta(e: unknown): string {
  const bruta =
    e instanceof Error
      ? `${e.name}: ${e.message}`
      : typeof e === "string"
        ? e
        : "erro desconhecido";
  return bruta
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

async function seguro<T>(
  fn: () => Promise<T>,
  rotulo: string,
  falhas: string[],
): Promise<{ ok: true; valor: T } | { ok: false }> {
  try {
    return { ok: true, valor: await fn() };
  } catch (e) {
    falhas.push(`${rotulo}: ${mensagemCurta(e)}`);
    return { ok: false };
  }
}

export async function executarCicloLeitura(deps: DepsCiclo): Promise<ResultadoCiclo> {
  try {
    return await cicloInterno(deps);
  } catch (e) {
    return {
      gravou: false,
      eventosNovos: 0,
      noticias: { buscou: false },
      ia: { tentou: false },
      motivo: `erro inesperado no ciclo: ${mensagemCurta(e)}`,
    };
  }
}

async function cicloInterno(deps: DepsCiclo): Promise<ResultadoCiclo> {
  const ensaio = deps.ensaio === true;
  const inicio = deps.agora();
  const agoraMs = inicio.getTime();
  const agoraIso = inicio.toISOString();
  const falhas: string[] = [];

  // 1. Leituras em paralelo, cada uma isolada.
  const [rInterruptor, rPayload, rAnterior] = await Promise.all([
    seguro(deps.lerInterruptor, "interruptor", falhas),
    seguro(deps.lerPayload, "payload", falhas),
    seguro(deps.lerAnterior, "anterior", falhas),
  ]);
  const interruptor: InterruptorLeitura = rInterruptor.ok
    ? rInterruptor.valor
    : { ...INTERRUPTOR_DESLIGADO };
  const payload = rPayload.ok ? rPayload.valor : null;
  const anterior = rAnterior.ok ? rAnterior.valor : null;
  const anteriorFalhou = !rAnterior.ok;

  const vazio: ResultadoCiclo = {
    gravou: false,
    eventosNovos: 0,
    noticias: { buscou: false },
    ia: { tentou: false },
  };
  if (!payload) {
    return {
      ...vazio,
      motivo: rPayload.ok ? "sem payload da projeção" : `sem payload (${falhas.join("; ")})`,
    };
  }

  const turno: 1 | 2 = payload.turno === 2 ? 2 : 1;

  // 2. Histórico — SEMPRE.
  const historicoAnterior = anterior?.historico ?? [];
  let eventos: EventoBoletim[] = [];
  let estado: EstadoResumo | null = anterior?.estado ?? null;
  try {
    const r = derivarEventos(anterior?.estado ?? null, payload, agoraIso);
    eventos = r.eventos;
    estado = r.estado;
  } catch (e) {
    falhas.push(`eventos: ${mensagemCurta(e)}`);
  }
  let historico = historicoAnterior;
  try {
    historico = mesclarHistorico(historicoAnterior, eventos);
  } catch (e) {
    falhas.push(`historico: ${mensagemCurta(e)}`);
  }
  const idsAnteriores = new Set(historicoAnterior.map((e) => e.id));
  const eventosNovos = historico.filter((e) => !idsAnteriores.has(e.id)).length;

  // 3. Notícias.
  let noticias: LeituraNoite["noticias"] = anterior?.noticias ?? { em: null, itens: [] };
  const resultadoNoticias: ResultadoCiclo["noticias"] = { buscou: false };
  let noticiasMudaram = false;
  const querNoticias = ensaio || interruptor.noticias;
  if (querNoticias && (ensaio || passou(anterior?.noticias.em, agoraMs, NOTICIAS_INTERVALO_MS))) {
    const r = await seguro(deps.buscarFeeds, "feeds", falhas);
    resultadoNoticias.buscou = true;
    if (r.ok) {
      resultadoNoticias.porFeed = r.valor.porFeed;
      const algumRespondeu = Object.values(r.valor.porFeed).some((v) => v !== "erro");
      if (algumRespondeu) {
        try {
          const filtradas = filtrarRelevantes(r.valor.itens, {
            desde: new Date(INICIO_DO_TURNO_UTC[turno]),
            termosExtras: sobrenomesDoPayload(payload),
          });
          const itens = mesclarManchetes(noticias.itens, filtradas);
          noticias = { em: agoraIso, itens };
          // O carimbo da busca também conta como mudança: sem gravá-lo, o
          // próximo ciclo buscaria de novo em 1 min, e não em 5.
          noticiasMudaram = true;
        } catch (e) {
          falhas.push(`noticias: ${mensagemCurta(e)}`);
        }
      }
    }
    resultadoNoticias.total = noticias.itens.length;
  }

  // 4. IA.
  let ia: AnaliseIA | null = anterior?.ia ?? null;
  let iaTentativa: LeituraNoite["ia_tentativa"] = anterior?.ia_tentativa ?? null;
  const resultadoIA: ResultadoCiclo["ia"] = { tentou: false };
  const pct = payload.pct_apurado_total;
  const iaAnterior = anterior?.ia ?? null;
  const temGatilho =
    iaAnterior === null ||
    // Folga de 1e-9: 23,4 − 21,4 em ponto flutuante pode dar 1,9999999999999982.
    pct - iaAnterior.base_pct >= IA_PASSO_PP - 1e-9 ||
    eventosNovos > 0 ||
    // Renovação por idade só se a contagem andou: com a apuração parada (100%
    // ao fim da noite, ou as noites seguintes em que o cron segue rodando) a IA
    // não é chamada à toa — a tela cai nas frases de regra fixa após 20 min.
    (pct !== iaAnterior.base_pct && passou(iaAnterior.gerado_em, agoraMs, IA_IDADE_RENOVAR_MS));
  const deveTentarIA =
    ensaio ||
    (interruptor.ia &&
      !isPreEleicao(payload) &&
      Number.isFinite(pct) &&
      pct > 0 &&
      passou(anterior?.ia_tentativa?.em, agoraMs, IA_INTERVALO_TENTATIVA_MS) &&
      temGatilho);
  let motivoIA: string | undefined;
  if (deveTentarIA) {
    const gasto = deps.agora().getTime() - agoraMs;
    if (gasto > ORCAMENTO_ANTES_DA_IA_MS) {
      motivoIA = `IA pulada: o ciclo já gastou ${Math.round(gasto / 1000)} s`;
    } else {
      resultadoIA.tentou = true;
      try {
        const nova = await deps.gerarAnalise({
          payload,
          historico,
          anterior: iaAnterior,
          ...(interruptor.modelo ? { modelo: interruptor.modelo } : {}),
          agora: inicio,
        });
        ia = nova;
        iaTentativa = { em: agoraIso, ok: true };
        resultadoIA.ok = true;
        resultadoIA.frases = nova.frases;
      } catch (e) {
        const erro = mensagemCurta(e);
        iaTentativa = { em: agoraIso, ok: false, erro };
        resultadoIA.ok = false;
        resultadoIA.erro = erro;
      }
    }
  }

  // 5. Gravação.
  const leitura: LeituraNoite = {
    versao: 1,
    turno,
    atualizado_em: agoraIso,
    estado,
    historico,
    noticias,
    ia,
    ia_tentativa: iaTentativa,
  };

  const base: ResultadoCiclo = {
    gravou: false,
    eventosNovos,
    noticias: resultadoNoticias,
    ia: resultadoIA,
  };
  const juntarMotivo = (...partes: Array<string | undefined>) => {
    const m = [...partes, ...falhas].filter(Boolean).join("; ");
    return m ? { motivo: m } : {};
  };

  if (ensaio) {
    return { ...base, leitura, ...juntarMotivo("ensaio: nada gravado", motivoIA) };
  }
  if (anteriorFalhou) {
    return {
      ...base,
      ...juntarMotivo(
        "leitura anterior ilegível — não gravo para não apagar o histórico",
        motivoIA,
      ),
    };
  }

  const deveGravar =
    eventosNovos > 0 ||
    noticiasMudaram ||
    resultadoIA.tentou ||
    anterior === null ||
    passou(anterior.atualizado_em, agoraMs, REGRAVAR_MS);
  if (!deveGravar) {
    return { ...base, ...juntarMotivo("nada mudou", motivoIA) };
  }

  try {
    await deps.gravar(leitura);
  } catch (e) {
    return { ...base, ...juntarMotivo(`falha ao gravar: ${mensagemCurta(e)}`, motivoIA) };
  }
  return { ...base, gravou: true, ...juntarMotivo(motivoIA) };
}
