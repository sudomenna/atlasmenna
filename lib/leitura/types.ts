/**
 * lib/leitura/types.ts
 *
 * Contrato da "leitura da noite" (ADR-0072): o objeto que o cron
 * `/api/internal/leitura-noite` grava no Blob e a home lê.
 *
 * Três partes independentes, cada uma com o seu interruptor:
 *   - `historico` — linhas do Boletim, uma por mudança detectada, com a hora
 *     real em que o cron a viu (regra fixa, sem IA);
 *   - `noticias`  — manchetes de feeds públicos de veículos (só título,
 *     veículo, hora e link — nunca o texto da matéria);
 *   - `ia`        — 2 a 4 frases de análise escritas por LLM a partir do
 *     payload da projeção (revoga o ADR-0005 só para a caixa "Análise").
 *
 * Vive fora de `lib/edge-config/types.ts` porque NÃO é Edge Config: o objeto
 * vai para o Blob (`leitura/pres/t<turno>.json`). No Edge Config fica só o
 * interruptor (`interruptor-leitura-noite`, ~100 bytes).
 */

import { z } from "zod";

/** Máximo de linhas do histórico guardadas (mais novo primeiro). */
export const HISTORICO_MAX = 40;
/** Máximo de manchetes guardadas. */
export const NOTICIAS_MAX = 20;

/** Valor da chave `interruptor-leitura-noite` no Edge Config, já interpretado. */
export interface InterruptorLeitura {
  ia: boolean;
  noticias: boolean;
  historico: boolean;
  /** Slug "provedor/modelo" do AI Gateway; ausente = padrão do código. */
  modelo?: string;
  /** ISO de quando foi gravado (informativo). */
  em?: string;
  /** Quem gravou (informativo). */
  por?: string;
}

/** Interruptor quando a chave está ausente, inválida ou a leitura falhou. */
export const INTERRUPTOR_DESLIGADO: InterruptorLeitura = {
  ia: false,
  noticias: false,
  historico: false,
};

export type TipoEventoBoletim =
  | "inicio"
  | "marco"
  | "lideranca_apurado"
  | "lideranca_projecao"
  /**
   * LEGADO (até 2026-10-04): "A projeção chama <UF> para …", disparado por
   * `EdgeUfRow.chamada`. O cron não emite mais (decisão do dono — só se
   * anuncia o que está matematicamente definido); o valor fica no enum para
   * um histórico já gravado continuar válido no schema, e a tela/IA o filtram
   * (`EVENTOS_LEGADOS_OCULTOS`).
   */
  | "chamada_uf"
  /** Brasil matematicamente definido (`EdgeUfRow.eleitos_definidos`). */
  | "eleito_definido"
  | "segundo_turno"
  | "todas_ufs";

/**
 * Tipos que continuam válidos num histórico gravado mas NÃO vão para a tela
 * nem para a IA. Filtro só de leitura: o Blob não é reescrito por isso.
 */
export const EVENTOS_LEGADOS_OCULTOS: ReadonlySet<TipoEventoBoletim> = new Set(["chamada_uf"]);

/**
 * Uma linha do histórico do Boletim. Os quatro primeiros campos são os de
 * `BulletinItem` (`components/blocks/BulletinPanel.tsx`) — o painel renderiza
 * um `EventoBoletim` sem conversão.
 *
 * `id` é DETERMINÍSTICO (ex. `marco-50`, `chamada_uf-SP`): dois ciclos que
 * detectam o mesmo evento produzem o mesmo id, e a mesclagem fica com o
 * primeiro (o horário mais antigo).
 */
export interface EventoBoletim {
  id: string;
  /** ISO 8601 — hora em que o cron detectou a mudança. */
  ts: string;
  head: string;
  text: string;
  tipo: TipoEventoBoletim;
}

export interface Manchete {
  titulo: string;
  /** Só http(s). */
  link: string;
  veiculo: string;
  /** ISO 8601 ou null quando o feed não traz data legível. */
  publicado_em: string | null;
  /** Identificador do feed de origem (ex. "g1-politica"). */
  feed: string;
}

export interface AnaliseIA {
  frases: string[];
  /** Slug do modelo que escreveu. */
  modelo: string;
  /** ISO de quando a IA respondeu. */
  gerado_em: string;
  /** `ts` do payload da projeção usado como base. */
  base_ts: string;
  /** `pct_apurado_total` do payload usado como base (0–100). */
  base_pct: number;
}

/**
 * O resumo do último payload visto pelo cron — a "memória" que permite
 * detectar mudanças entre um ciclo e o seguinte.
 */
export interface EstadoResumo {
  /** `ts` do payload. */
  ts: string;
  /** `pct_apurado_total` (0–100). */
  pct: number;
  ufs_apuradas: number;
  /** id do candidato que lidera a contagem (votos apurados); null sem dado. */
  lider_apurado_id: number | null;
  /** id do candidato que lidera a projeção; null sem dado. */
  lider_projecao_id: number | null;
  /** `national.p_segundo_turno_overall` (0–1) ou null. */
  p2t: number | null;
  /**
   * LEGADO — siglas das UFs com `EdgeUfRow.chamada` já vista. Continua gravado
   * (mesma regra de antes) só para o estado manter o formato que uma versão
   * anterior do cron sabe ler; **não gera evento nem texto** desde 2026-10-04.
   */
  chamadas: string[];
  /**
   * Ids já anunciados como MATEMATICAMENTE eleitos no Brasil
   * (`lib/utils/anuncios-definidos.ts` → `eleitosNacionais`). Cumulativo.
   * Opcional: estado gravado antes de 2026-10-04 não tem o campo (⇒ `[]`).
   */
  definidos?: number[];
  /** Marcos de % apurado já anunciados (ex. [10, 25]). */
  marcos: number[];
}

export interface LeituraNoite {
  versao: 1;
  turno: 1 | 2;
  /** ISO da última gravação. */
  atualizado_em: string;
  estado: EstadoResumo | null;
  /** Mais novo primeiro, no máximo {@link HISTORICO_MAX}. */
  historico: EventoBoletim[];
  noticias: {
    /** ISO da última busca bem-sucedida de ao menos um feed. */
    em: string | null;
    /** Mais nova primeiro, no máximo {@link NOTICIAS_MAX}. */
    itens: Manchete[];
  };
  ia: AnaliseIA | null;
  ia_tentativa: { em: string; ok: boolean; erro?: string } | null;
}

// ---------------------------------------------------------------------------
// Schema zod — validação na LEITURA (Blob é rede: tudo pode vir torto)
// ---------------------------------------------------------------------------

const isoString = z.string().min(1);

export const EventoBoletimSchema = z.object({
  id: z.string().min(1),
  ts: isoString,
  head: z.string(),
  text: z.string(),
  tipo: z.enum([
    "inicio",
    "marco",
    "lideranca_apurado",
    "lideranca_projecao",
    "chamada_uf",
    "eleito_definido",
    "segundo_turno",
    "todas_ufs",
  ]),
});

export const MancheteSchema = z.object({
  titulo: z.string().min(1),
  link: z.string().regex(/^https?:\/\//),
  veiculo: z.string().min(1),
  publicado_em: isoString.nullable(),
  feed: z.string(),
});

export const AnaliseIASchema = z.object({
  frases: z.array(z.string().min(1)).min(1),
  modelo: z.string(),
  gerado_em: isoString,
  base_ts: isoString,
  base_pct: z.number(),
});

export const EstadoResumoSchema = z.object({
  ts: isoString,
  pct: z.number(),
  ufs_apuradas: z.number(),
  lider_apurado_id: z.number().nullable(),
  lider_projecao_id: z.number().nullable(),
  p2t: z.number().nullable(),
  chamadas: z.array(z.string()),
  definidos: z.array(z.number()).optional(),
  marcos: z.array(z.number()),
});

export const LeituraNoiteSchema = z.object({
  versao: z.literal(1),
  turno: z.union([z.literal(1), z.literal(2)]),
  atualizado_em: isoString,
  estado: EstadoResumoSchema.nullable(),
  historico: z.array(EventoBoletimSchema),
  noticias: z.object({
    em: isoString.nullable(),
    itens: z.array(MancheteSchema),
  }),
  ia: AnaliseIASchema.nullable(),
  ia_tentativa: z
    .object({ em: isoString, ok: z.boolean(), erro: z.string().optional() })
    .nullable(),
});

/** Objeto vazio — ponto de partida do primeiro ciclo da noite. */
export function leituraVazia(turno: 1 | 2, agoraIso: string): LeituraNoite {
  return {
    versao: 1,
    turno,
    atualizado_em: agoraIso,
    estado: null,
    historico: [],
    noticias: { em: null, itens: [] },
    ia: null,
    ia_tentativa: null,
  };
}
