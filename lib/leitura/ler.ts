/**
 * lib/leitura/ler.ts
 *
 * Read path da "leitura da noite" (ADR-0072) na home presidencial: lê o
 * interruptor no Edge Config, busca o objeto `LeituraNoite` no Blob e devolve
 * SÓ o que pode ir para a tela agora.
 *
 * Duas funções, de propósito separadas:
 *
 *   - {@link filtrarParaTela} — PURA. Decide, peça a peça, o que aparece:
 *     interruptor ligado, idade do dado e coerência com o payload que a página
 *     está mostrando. É aqui que mora a regra; é aqui que o teste de mutação
 *     mira.
 *   - {@link lerLeituraParaTela} — I/O. **Nunca lança.** Qualquer falha (sem
 *     `EDGE_CONFIG`, Edge Config lento ou fora, Blob 404, JSON torto, schema
 *     inválido) vira {@link LEITURA_VAZIA}, e a página renderiza como se a
 *     leitura da noite não existisse — o Boletim volta ao `buildBulletin`, a
 *     caixa Análise volta às frases de regra, o painel "Na imprensa" some.
 *
 * ⚠️ NÃO importa nada de `@/lib/edge-config/reader`: três testes de página
 * mocam esse módulo com uma lista FECHADA de funções, e uma importação nova
 * daqui viraria `undefined` lá. O `get` do SDK é chamado direto, com o mesmo
 * teto de tempo do `getComTeto` de lá (copiado, não importado).
 *
 * Falha fechada em todas as portas: sem interruptor lido com sucesso, nada
 * liga (`interpretarInterruptorLeitura` — só `=== true` liga).
 */

import { get } from "@vercel/edge-config";

import { blobUrlFor, leituraNoiteBlobPathname } from "@/lib/blob/paths";
import { interruptorLeituraNoiteKey } from "@/lib/edge-config/keys";
import { logWarn } from "@/lib/tse/log";

import { interpretarInterruptorLeitura } from "./interruptor";
import {
  type AnaliseIA,
  EVENTOS_LEGADOS_OCULTOS,
  type EventoBoletim,
  type InterruptorLeitura,
  type LeituraNoite,
  LeituraNoiteSchema,
  type Manchete,
} from "./types";

// ---------------------------------------------------------------------------
// Contrato com a página
// ---------------------------------------------------------------------------

/** O que a página recebe. `null` = a peça não aparece (bloco some ou cai no padrão). */
export interface LeituraParaTela {
  ia: AnaliseIA | null;
  noticias: Manchete[] | null;
  historico: EventoBoletim[] | null;
}

/** Tudo desligado — o estado de qualquer falha. Congelado: é compartilhado. */
export const LEITURA_VAZIA: LeituraParaTela = Object.freeze({
  ia: null,
  noticias: null,
  historico: null,
});

// ---------------------------------------------------------------------------
// Regras de exibição
// ---------------------------------------------------------------------------

/** Análise por IA mais velha que isso não aparece (a corrida anda rápido). */
export const IA_IDADE_MAX_MS = 20 * 60_000;
/**
 * Distância máxima, em pp, entre o `% apurado` em que a IA escreveu e o que a
 * página mostra. Acima disso o texto descreve outra noite.
 */
export const IA_DISTANCIA_MAX_PP = 5;
/**
 * Folga para relógio adiantado do cron: um `gerado_em` no futuro além disso é
 * tratado como inválido — sem ela, um carimbo errado no futuro deixaria a
 * análise "fresca" para sempre.
 */
export const FOLGA_RELOGIO_MS = 2 * 60_000;

/** Coleta de manchetes mais velha que isso não aparece. */
export const NOTICIAS_IDADE_MAX_MS = 60 * 60_000;
/** Máximo de manchetes na tela. */
export const NOTICIAS_TELA_MAX = 8;
/** Máximo de manchetes do MESMO veículo na tela — nenhum veículo domina o painel. */
export const NOTICIAS_POR_VEICULO_MAX = 2;

/**
 * Início da divulgação dos resultados — 17h de Brasília (UTC−3, sem horário de
 * verão) do dia de cada turno. Antes disso não há apuração para comentar, e o
 * painel de imprensa não aparece. `lib/config/calendar.ts` só guarda a virada
 * do turno (00h), não o horário da divulgação — por isso as constantes vivem
 * aqui.
 */
export const INICIO_DIVULGACAO: Readonly<Record<1 | 2, string>> = Object.freeze({
  1: "2026-10-04T20:00:00Z",
  2: "2026-10-25T20:00:00Z",
});

/** `Date.parse` que devolve `null` em vez de `NaN`. */
function instante(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function filtrarIA(
  ia: AnaliseIA | null,
  ligado: boolean,
  pctApuradoTotal: number,
  agoraMs: number,
): AnaliseIA | null {
  if (!ligado || !ia || ia.frases.length === 0) return null;
  const gerado = instante(ia.gerado_em);
  if (gerado === null) return null;
  const idade = agoraMs - gerado;
  if (idade >= IA_IDADE_MAX_MS || idade < -FOLGA_RELOGIO_MS) return null;
  if (!Number.isFinite(pctApuradoTotal) || !Number.isFinite(ia.base_pct)) return null;
  if (Math.abs(pctApuradoTotal - ia.base_pct) > IA_DISTANCIA_MAX_PP) return null;
  return ia;
}

/**
 * Até {@link NOTICIAS_TELA_MAX} manchetes, no máximo
 * {@link NOTICIAS_POR_VEICULO_MAX} por veículo, da mais nova para a mais
 * antiga. Sem data legível vai para o fim (na ordem em que veio). Link
 * repetido entra uma vez só.
 */
export function selecionarManchetes(itens: readonly Manchete[]): Manchete[] {
  const ordenadas = itens
    .map((m, i) => ({ m, i, t: instante(m.publicado_em) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return b.t - a.t || a.i - b.i;
    });

  const porVeiculo = new Map<string, number>();
  const links = new Set<string>();
  const saida: Manchete[] = [];
  for (const { m } of ordenadas) {
    if (saida.length >= NOTICIAS_TELA_MAX) break;
    if (!/^https?:\/\//i.test(m.link) || links.has(m.link)) continue;
    const veiculo = m.veiculo.trim().toLocaleLowerCase("pt-BR");
    const n = porVeiculo.get(veiculo) ?? 0;
    if (n >= NOTICIAS_POR_VEICULO_MAX) continue;
    porVeiculo.set(veiculo, n + 1);
    links.add(m.link);
    saida.push(m);
  }
  return saida;
}

function filtrarNoticias(
  noticias: LeituraNoite["noticias"],
  ligado: boolean,
  turno: 1 | 2,
  agoraMs: number,
): Manchete[] | null {
  if (!ligado) return null;
  const inicio = instante(INICIO_DIVULGACAO[turno]);
  if (inicio === null || agoraMs < inicio) return null;
  const em = instante(noticias.em);
  if (em === null) return null;
  const idade = agoraMs - em;
  if (idade >= NOTICIAS_IDADE_MAX_MS || idade < -FOLGA_RELOGIO_MS) return null;
  if (noticias.itens.length === 0) return null;
  const selecionadas = selecionarManchetes(noticias.itens);
  return selecionadas.length > 0 ? selecionadas : null;
}

/**
 * 🔴 2026-10-04 (dono) — linhas de tipo legado ({@link EVENTOS_LEGADOS_OCULTOS}:
 * "A projeção chama <UF> para …") não vão para a tela: a tela só anuncia o que
 * está matematicamente definido. Filtro SÓ de leitura — o Blob não é
 * reescrito, e o cron mescla o histórico gravado inteiro como sempre.
 */
function filtrarHistorico(historico: EventoBoletim[], ligado: boolean): EventoBoletim[] | null {
  if (!ligado) return null;
  const visiveis = historico.filter((e) => !EVENTOS_LEGADOS_OCULTOS.has(e.tipo));
  return visiveis.length === 0 ? null : visiveis;
}

/**
 * Decide o que da leitura vai para a tela. **Pura** — `agora` entra pelo
 * contexto, nunca `Date.now()` aqui dentro.
 *
 * - `ia`: interruptor `ia`, análise presente, escrita há menos de
 *   {@link IA_IDADE_MAX_MS} e com `base_pct` a no máximo
 *   {@link IA_DISTANCIA_MAX_PP} pp do `% apurado` da página.
 * - `noticias`: interruptor `noticias`, `agora` depois do
 *   {@link INICIO_DIVULGACAO} do turno, coleta (`noticias.em`) com menos de
 *   {@link NOTICIAS_IDADE_MAX_MS} e ao menos 1 manchete
 *   (ver {@link selecionarManchetes}).
 * - `historico`: interruptor `historico` e ao menos 1 evento.
 *
 * Leitura de OUTRO turno (objeto trocado no Blob) não mostra nada.
 */
export function filtrarParaTela(
  leitura: LeituraNoite | null,
  interruptor: InterruptorLeitura,
  ctx: { pctApuradoTotal: number; turno: 1 | 2; agora: Date },
): LeituraParaTela {
  if (!leitura || leitura.turno !== ctx.turno) return LEITURA_VAZIA;
  const agoraMs = ctx.agora.getTime();
  if (!Number.isFinite(agoraMs)) return LEITURA_VAZIA;
  return {
    ia: filtrarIA(leitura.ia, interruptor.ia, ctx.pctApuradoTotal, agoraMs),
    noticias: filtrarNoticias(leitura.noticias, interruptor.noticias, ctx.turno, agoraMs),
    historico: filtrarHistorico(leitura.historico, interruptor.historico),
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Teto da leitura do interruptor — o mesmo de `TIMEOUT_INTERRUPTOR_MS` (reader). */
export const TIMEOUT_INTERRUPTOR_LEITURA_MS = 2_000;
/** Revalidação do `fetch` do Blob no Data Cache do Next. */
export const LEITURA_REVALIDATE_SECONDS = 60;

/**
 * `get` com teto de tempo — cópia de `getComTeto` (`lib/edge-config/reader.ts`),
 * que não é importado (ver o cabeçalho). O timer é limpo em qualquer desfecho;
 * `Promise.race` inscreve-se nas duas promessas, então a rejeição tardia do
 * `get` que perdeu a corrida não vira `unhandledRejection`.
 */
async function getComTeto(chave: string, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const esgotado = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`${chave} sem resposta em ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([get<unknown>(chave), esgotado]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca e valida o objeto do Blob. `null` em qualquer falha — 404 é o estado
 * normal antes do primeiro ciclo do cron e não loga.
 *
 * Sem `AbortSignal` de propósito, como em `readUfDetail`
 * (`lib/blob/uf-detail.ts`): um `signal` desliga o Data Cache do Next para
 * este `fetch`, trocando proteção de latência por uma ida à origem a cada
 * request na noite da apuração. O `revalidate` limita a exposição.
 */
async function lerDoBlob(turno: 1 | 2): Promise<LeituraNoite | null> {
  const url = blobUrlFor(leituraNoiteBlobPathname(turno));
  if (!url) return null;

  let resposta: Response;
  try {
    resposta = await fetch(url, { next: { revalidate: LEITURA_REVALIDATE_SECONDS } });
  } catch (erro) {
    logWarn("leitura da noite: falha ao buscar o Blob", {
      fn: "lerLeituraParaTela",
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
  if (resposta.status === 404) return null;
  if (!resposta.ok) {
    logWarn("leitura da noite: Blob respondeu com erro", {
      fn: "lerLeituraParaTela",
      status: resposta.status,
    });
    return null;
  }

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    logWarn("leitura da noite: Blob com JSON ilegível", { fn: "lerLeituraParaTela" });
    return null;
  }

  const lido = LeituraNoiteSchema.safeParse(corpo);
  if (!lido.success) {
    logWarn("leitura da noite: objeto do Blob fora do schema", {
      fn: "lerLeituraParaTela",
      problemas: lido.error.issues.slice(0, 3).map((p) => `${p.path.join(".")}: ${p.message}`),
    });
    return null;
  }
  return lido.data as LeituraNoite;
}

/**
 * Lê o interruptor e, se alguma peça estiver ligada, o objeto do Blob, e
 * devolve o que pode ir para a tela ({@link filtrarParaTela}).
 *
 * **Nunca lança** e nunca espera o Edge Config mais que
 * {@link TIMEOUT_INTERRUPTOR_LEITURA_MS}. Sem `EDGE_CONFIG`, com tudo
 * desligado ou em qualquer falha: {@link LEITURA_VAZIA} — e com tudo desligado
 * o Blob nem é consultado.
 */
export async function lerLeituraParaTela(ctx: {
  pctApuradoTotal: number;
  turno: 1 | 2;
  agora?: Date;
}): Promise<LeituraParaTela> {
  try {
    if (!process.env.EDGE_CONFIG) return LEITURA_VAZIA;

    let bruto: unknown;
    try {
      bruto = await getComTeto(interruptorLeituraNoiteKey(), TIMEOUT_INTERRUPTOR_LEITURA_MS);
    } catch (erro) {
      logWarn("leitura da noite: interruptor ilegível — tudo DESLIGADO", {
        fn: "lerLeituraParaTela",
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      return LEITURA_VAZIA;
    }

    const interruptor = interpretarInterruptorLeitura(bruto);
    if (!interruptor.ia && !interruptor.noticias && !interruptor.historico) return LEITURA_VAZIA;

    const leitura = await lerDoBlob(ctx.turno);
    if (!leitura) return LEITURA_VAZIA;

    return filtrarParaTela(leitura, interruptor, {
      pctApuradoTotal: ctx.pctApuradoTotal,
      turno: ctx.turno,
      agora: ctx.agora ?? new Date(),
    });
  } catch {
    return LEITURA_VAZIA;
  }
}
