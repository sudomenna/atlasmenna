/**
 * components/blocks/_palanques.ts
 *
 * A lógica PURA do mapa dos palanques (V3 do plano de 29/09, spec 025) — o que
 * `PalanquesMapa.tsx` desenha e a página alimenta. Sem React, sem I/O, sem
 * relógio (constituição § 6).
 *
 * Quatro coisas moram aqui, e só aqui:
 *
 *   1. o **contrato de dados** do componente (`PalanquesUf`);
 *   2. a regra **casado / dividido / não se aplica** (`casamento`);
 *   3. o mapeamento **líder presidencial → Lula / Flávio Bolsonaro / outro**
 *      (`presidenteDoTop`);
 *   4. a **cola** payload → props (`palanquesDaBase`), para a página não
 *      reescrever a leitura de "quem lidera" — o lugar onde o repositório já
 *      errou uma vez (ver o cabeçalho de `lib/utils/lider-por-base.ts`:
 *      `EdgeUfRow.lider` NÃO é o líder apurado).
 *
 * ## Casado / dividido — a regra do dono (29/09)
 *
 * Compara o palanque do governador que lidera a UF com quem lidera para
 * presidente na mesma UF, na mesma base e no mesmo turno:
 *
 *   - **casado**   — palanque de Lula com líder Lula; palanque de Flávio com
 *                    líder Flávio; e **palanque duplo com qualquer um dos dois**
 *                    (o candidato está nos dois palanques, então o líder
 *                    presidencial, seja qual for, está num deles);
 *   - **dividido** — palanque de Lula com líder Flávio, ou o contrário;
 *   - **não se aplica** — o líder presidencial não é Lula nem Flávio, OU o
 *                    palanque é `sem_palanque_declarado` / `a_classificar`
 *                    (nada a comparar), OU falta leitura de um dos lados.
 *
 * Não existe "duplo dividido": duplo é sempre casado com Lula ou Flávio. Está
 * escrito aqui, na legenda e nos testes, porque é a decisão editorial mais
 * fácil de inverter sem perceber.
 *
 * Toda entrada fora do catálogo cai em "não se aplica" — a direção que nunca
 * afirma nada. O contrário (cair em "dividido") acusaria um estado de votar
 * dividido por causa de um valor que este deploy não conhece.
 */

import { UF_LIST } from "@/lib/data/uf-hex-layout";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import { A_CLASSIFICAR, type ValorId, valorDoCatalogo } from "@/lib/etiquetas/catalogo";
import { normalizarSqcand } from "@/lib/etiquetas/formato";
import type { Resolucao } from "@/lib/etiquetas/resolver";
import type { ViewMode } from "@/lib/state/view-mode";
import { queCompetem } from "@/lib/utils/destino-voto";
import { ordenarTopCandidatosPorBase, type TopCandidatoUf } from "@/lib/utils/lider-por-base";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

// ---------------------------------------------------------------------------
// Contrato de dados
// ---------------------------------------------------------------------------

/** Os valores do catálogo (`palanque_presidencial`) mais a sentinela — que nunca vai à tela. */
export type PalanqueValor = ValorId<"palanque_presidencial"> | typeof A_CLASSIFICAR;

export type LiderPresidencial = "lula" | "flavio_bolsonaro" | "outro";

/** As duas bases da chave "Parcial / Projeção" (`data-view-only`). */
export type BasePalanques = ViewMode;

export interface CandidatoPalanque {
  /** `SQ_CANDIDATO` do TSE, texto decimal (`normalizarSqcand`). `null` = payload sem identidade. */
  sqcand: string | null;
  /** Nome de exibição (`nomeExibicao`). */
  nome: string;
  /** Sigla como veio no payload. */
  partido: string | null;
  /** Palanque resolvido NO TURNO da tela. `a_classificar` nunca é exibido. */
  palanque: PalanqueValor;
  /**
   * Só muda a palavra da lista textual: `"lidera"` (padrão) ou `"eleito"`. A
   * página só passa `"eleito"` quando a apuração já diz isso (o `bucket:
   * "chamada"` NÃO é eleito — `lib/utils/desfecho-governador.ts`).
   */
  papel?: "lidera" | "eleito";
}

export interface PresidentePalanque {
  lider: LiderPresidencial;
  /** Só para `lider: "outro"` — quem é. */
  nome?: string;
}

export interface PalanquesUf {
  /** Sigla de 2 letras (`"SP"`). Sigla fora das 27 é ignorada. */
  uf: string;
  /**
   * Quem dá o palanque ao ladrilho: o líder da corrida a governador na base
   * (1º turno) ou o eleito / líder do 2º turno. `null` = sem leitura nesta base.
   */
  governador: CandidatoPalanque | null;
  /**
   * 2º turno: os finalistas, na ordem em que a página os apresenta. Só entra
   * na lista textual — o ladrilho continua sendo de `governador`.
   */
  finalistas?: readonly CandidatoPalanque[];
  /** Quem lidera para presidente na UF, na mesma base e turno. `null` = sem leitura. */
  presidente: PresidentePalanque | null;
}

// ---------------------------------------------------------------------------
// Casado / dividido
// ---------------------------------------------------------------------------

export type Casamento = "casado" | "dividido" | "nao_se_aplica";

export function casamento(
  palanque: PalanqueValor | string | null | undefined,
  presidente: PresidentePalanque | null | undefined,
): Casamento {
  const lider = presidente?.lider;
  if (lider !== "lula" && lider !== "flavio_bolsonaro") return "nao_se_aplica";
  switch (palanque) {
    case "palanque_lula":
      return lider === "lula" ? "casado" : "dividido";
    case "palanque_flavio_bolsonaro":
      return lider === "flavio_bolsonaro" ? "casado" : "dividido";
    case "palanque_duplo":
      return "casado";
    default:
      // sem_palanque_declarado, a_classificar, ausente ou valor de um catálogo
      // mais novo que este deploy: nada a comparar.
      return "nao_se_aplica";
  }
}

/** Um valor de palanque que o catálogo deste deploy conhece — senão a sentinela. */
export function palanqueValido(v: string | null | undefined): PalanqueValor {
  if (!v || v === A_CLASSIFICAR) return A_CLASSIFICAR;
  return valorDoCatalogo("palanque_presidencial", v) ? (v as PalanqueValor) : A_CLASSIFICAR;
}

export interface ResumoCasamento {
  casado: number;
  dividido: number;
  /** Só estados COM palanque classificado — o estado sem classificação não entra em conta nenhuma. */
  naoSeAplica: number;
}

/**
 * Contagem para a linha-resumo. Estado sem leitura ou sem classificação fica
 * de fora dos três números: contá-lo como "não se aplica" esconderia a lacuna
 * de cobertura sob um rótulo que parece uma conclusão.
 */
export function resumoCasamento(ufs: readonly PalanquesUf[]): ResumoCasamento {
  const r: ResumoCasamento = { casado: 0, dividido: 0, naoSeAplica: 0 };
  const vistas = new Set<string>();
  for (const u of ufs) {
    const sigla = u.uf.toUpperCase();
    if (vistas.has(sigla) || !UF_LIST.includes(sigla)) continue;
    vistas.add(sigla);
    const palanque = palanqueValido(u.governador?.palanque);
    if (palanque === A_CLASSIFICAR) continue;
    const c = casamento(palanque, u.presidente);
    if (c === "casado") r.casado++;
    else if (c === "dividido") r.dividido++;
    else r.naoSeAplica++;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Líder presidencial → Lula / Flávio / outro
// ---------------------------------------------------------------------------

/**
 * Identidade por `SQ_CANDIDATO` (ADR-0042), nunca por nome ou partido. Conferido
 * em 29/09 no cadastro do TSE (`consulta_cand_2026_BRASIL.csv`, cargo
 * PRESIDENTE): LULA/PT nº 13 e FLAVIO BOLSONARO/PL nº 22.
 */
export const SQCAND_LULA = "280002542548";
export const SQCAND_FLAVIO_BOLSONARO = "280002551544";

/**
 * Mapeia a linha `top_candidatos` de quem lidera para presidente na UF.
 *
 * `null` quando não dá para dizer QUEM é (sem linha, ou sem `sqcand`): identidade
 * desconhecida NÃO vira "outro" — "outro" é uma afirmação (é alguém que não é
 * nenhum dos dois), e sem `sqcand` a linha pode muito bem ser o Lula.
 */
export function presidenteDoTop(
  top: Pick<TopCandidatoUf, "id" | "nome" | "sqcand"> | null | undefined,
): PresidentePalanque | null {
  if (!top) return null;
  const sq = normalizarSqcand(top.sqcand);
  if (!sq) return null;
  if (sq === SQCAND_LULA) return { lider: "lula" };
  if (sq === SQCAND_FLAVIO_BOLSONARO) return { lider: "flavio_bolsonaro" };
  return { lider: "outro", nome: nomeExibicao(top.nome ?? `Cand ${top.id}`, sq) };
}

// ---------------------------------------------------------------------------
// Cola payload → props
// ---------------------------------------------------------------------------

/**
 * O valor do palanque numa `Resolucao` do leitor
 * (`Etiquetas.resolver(sqcand, 3, turno).palanque_presidencial`). Qualquer coisa
 * que não seja `classificado` com valor do catálogo é `a_classificar`.
 */
export function palanqueDaResolucao(r: Resolucao | null | undefined): PalanqueValor {
  return r?.estado === "classificado" ? palanqueValido(r.etiqueta.valor) : A_CLASSIFICAR;
}

/**
 * Quem disputa a UF, NA ORDEM DA BASE, sem as anuladas — ou `null` quando a
 * base não tem leitura honesta:
 *
 *   - Projeção: a ordem do modelo (`pct`), sempre que houver `top_candidatos`;
 *   - Parcial: a ordem da contagem (`pct_atual`), e só com `pct_apurado > 0` e
 *     `pct_atual` em TODO o corte. `ordenarTopCandidatosPorBase` cai SILENCIOSAMENTE
 *     na ordem de projeção quando falta `pct_atual` (documentado lá) — aqui isso
 *     publicaria o líder do modelo sob o rótulo "contagem", então é `null`
 *     (mesma guarda de `ordemDaContagem`, `lib/utils/desfecho-governador.ts`).
 *
 * Nunca lê `row.lider`: ele é o líder por projeção nas duas bases, e sem
 * `top_candidatos` não há identidade (sqcand, nome) para carregar palanque.
 */
export function quemDisputaNaBase(
  row: Pick<EdgeUfRow, "pct_apurado" | "top_candidatos"> | null | undefined,
  base: BasePalanques,
): TopCandidatoUf[] | null {
  if (!row) return null;
  const top = row.top_candidatos ?? [];
  if (top.length === 0) return null;
  if (base === "parcial") {
    if (!(row.pct_apurado > 0)) return null;
    const { ordenados, usouParcial } = ordenarTopCandidatosPorBase(top, "parcial");
    if (!usouParcial) return null;
    const competem = queCompetem(ordenados);
    return competem.length > 0 ? competem : null;
  }
  const competem = queCompetem(ordenarTopCandidatosPorBase(top, "proj").ordenados);
  return competem.length > 0 ? competem : null;
}

function candidatoDoTop(
  top: TopCandidatoUf,
  palanqueDe: (sqcand: string) => PalanqueValor,
): CandidatoPalanque {
  const sq = normalizarSqcand(top.sqcand);
  return {
    sqcand: sq,
    nome: nomeExibicao(top.nome ?? `Cand ${top.id}`, sq),
    partido: top.partido ?? null,
    // `sqcand` ausente conta como não classificado (RF-233) — nunca herda nada.
    palanque: sq ? palanqueValido(palanqueDe(sq)) : A_CLASSIFICAR,
  };
}

export interface EntradaPalanquesBase {
  base: BasePalanques;
  turno: 1 | 2;
  /** `por_uf` do payload de GOVERNADOR. UF ausente = sem leitura. */
  governador: readonly EdgeUfRow[];
  /** `por_uf` do payload de PRESIDENTE (mesmo turno). UF ausente = sem leitura. */
  presidente: readonly EdgeUfRow[];
  /**
   * Palanque de um candidato a governador NO `turno` — a página liga isto ao
   * leitor: `(sq) => palanqueDaResolucao(etiquetas.resolver(sq, 3, turno).palanque_presidencial)`.
   */
  palanqueDe: (sqcand: string) => PalanqueValor;
}

/**
 * As 27 UFs de UMA base, prontas para o componente (UF ausente do payload vira
 * `governador: null` / `presidente: null`, nunca some — o mapa tem sempre 27
 * ladrilhos). A ordem é a canônica do layout; o componente reordena o que
 * precisa por sigla, e a ordem de entrada nunca decide nada.
 *
 * `finalistas` só no 2º turno: os dois primeiros que competem.
 */
export function palanquesDaBase(e: EntradaPalanquesBase): PalanquesUf[] {
  const gov = new Map(e.governador.map((r) => [r.sigla.toUpperCase(), r] as const));
  const pres = new Map(e.presidente.map((r) => [r.sigla.toUpperCase(), r] as const));
  return UF_LIST.map((uf) => {
    const disputamGov = quemDisputaNaBase(gov.get(uf), e.base);
    const lider = disputamGov?.[0];
    const finalistas =
      e.turno === 2 && disputamGov
        ? disputamGov.slice(0, 2).map((t) => candidatoDoTop(t, e.palanqueDe))
        : undefined;
    return {
      uf,
      governador: lider ? candidatoDoTop(lider, e.palanqueDe) : null,
      ...(finalistas ? { finalistas } : {}),
      presidente: presidenteDoTop(quemDisputaNaBase(pres.get(uf), e.base)?.[0]),
    };
  });
}
