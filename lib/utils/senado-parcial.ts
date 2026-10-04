/**
 * lib/utils/senado-parcial.ts
 *
 * As vagas do Senado **na Parcial** — "se a apuração parasse agora" (decisão
 * do dono, 04/10/2026). A capa `/senador` mostrava as 54 vagas, o hemiciclo
 * de 81 e os cartões por UF só pela projeção, nas duas posições da chave
 * "Parcial / Projeção". Este módulo é o ponto único da leitura parcial; a
 * da projeção continua em `lib/utils/senado-2027.ts` (`vagasDerivadas`) e em
 * `EdgePayload.composicao_vagas`, que o produtor publica.
 *
 * Função pura, sem I/O e sem relógio (constituição § 6): mesmo payload ⇒
 * mesma saída.
 *
 * ## A regra, UF a UF
 *
 * | caso | estado | quem ocupa as vagas |
 * |---|---|---|
 * | `pct_apurado >= 100` | `decidida` | os mesmos da projeção (`ocupantesDasVagas` sobre `top_candidatos` na ordem do array) |
 * | `pct_apurado` 0 ou ausente | `aguardando` | ninguém |
 * | falta `pct_atual` a alguém do corte | `aguardando` | ninguém |
 * | ocupante com `pct_atual <= 0` | `aguardando` | ninguém (seria desempate de zeros, não voto) |
 * | os ocupantes não são DEMONSTRÁVEIS (abaixo) | `aguardando` | ninguém |
 * | o resto | `parcial` | os `vagas` primeiros QUE DISPUTAM na ordem do apurado |
 *
 * - **`decidida` é a mesma nas duas bases.** UF com a apuração concluída tem
 *   o mesmo tratamento do hemiciclo de 2027 (`PCT_UF_CONCLUIDA`): um fato é
 *   um fato, e as duas visões não podem discordar sobre ele. Com 100%
 *   apurado o `pct_projetado` do modelo é o próprio apurado.
 * - **A ordem do apurado** é a de `ordenarTopCandidatosPorBase(…, "parcial")`
 *   (`lib/utils/lider-por-base.ts`): o comparador único `rankByParcial` —
 *   `pct_atual` desc → `pct_projetado` desc → `id` asc —, anuladas no fim.
 *   Nenhum comparador novo nasce aqui.
 * - **Anulada não ocupa vaga** (ADR-0053): `ocupantesDasVagas` a pula.
 * - **Nunca um zero fabricado** (decisão do dono, 14/09 — não começou / não
 *   sabemos / apurando são três estados). UF sem leitura parcial honesta é
 *   `aguardando`, nunca "0 vagas de alguém".
 *
 * ## 🔴 "Os 2 mais votados" estão mesmo em `top_candidatos`?
 *
 * `top_candidatos` é a UNIÃO das `TOP_CANDIDATOS_POR_UF` (4) primeiras pela
 * projeção com as `RESGATE_POR_APURADO` (2) primeiras pelo apurado
 * (`api/model/project.py:186,224` e `:7092-7101`). O resgate ordena a
 * corrida INTEIRA por `pct_atual` — **anulada incluída** — e pega as 2
 * primeiras. Daí:
 *
 *   1. **Sem anulada no corte**, as 2 primeiras do apurado da corrida inteira
 *      estão no array e nenhuma é anulada (se fosse, estaria no array) ⇒ são
 *      as 2 primeiras que disputam. **Garantido.**
 *   2. **Com anulada no corte**, ela pode ter ocupado um dos 2 lugares do
 *      resgate, e a 2ª que disputa pode ter ficado na cauda (`outros`), sem
 *      nome. **Não garantido.** Aqui o ocupante só conta se for demonstrável:
 *      `outros` ausente (a cauda que disputa está vazia), ou `pct_atual` do
 *      ocupante **estritamente maior** que `outros.pct_atual` — a SOMA da
 *      cauda, mesma base (votos em disputa), é teto de qualquer candidatura
 *      dela. Fora disso a UF fica `aguardando`.
 *   3. Menos ocupantes que vagas com `outros` presente ⇒ alguém da cauda
 *      poderia completar a conta ⇒ `aguardando`.
 *
 * ⚠️ Empate no limite: o resgate desempata por `id` e `rankByParcial` por
 * `pct_projetado` antes do `id`. Um empate EXATO de `pct_atual` entre a 2ª
 * do corte e alguém da cauda é empate de verdade (os dois são "o 2º mais
 * votado"); a escolha segue determinística.
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import { haAnulada } from "@/lib/utils/destino-voto";
import { ordenarTopCandidatosPorBase, type TopCandidatoUf } from "@/lib/utils/lider-por-base";
import { ocupantesDasVagas } from "@/lib/utils/vagas-eleitas";

/**
 * UF com a apuração concluída — o MESMO limiar de `PCT_UF_CONCLUIDA`
 * (`lib/utils/senado-2027.ts`). Repetido aqui como literal por um motivo de
 * dependência (este módulo não importa o de 2027, que importa este); o teste
 * `senado-parcial.test.ts` confere que os dois são iguais.
 */
export const PCT_UF_CONCLUIDA_PARCIAL = 100;

/** Marcador de partido não resolvido — o mesmo `"—"` do produtor e de `senado-2027.ts`. */
const PARTIDO_DESCONHECIDO = "—";

/** Estado de UMA UF na Parcial. */
export type EstadoUfParcial = "decidida" | "parcial" | "aguardando";

export interface UfNaParcial {
  estado: EstadoUfParcial;
  /** Quem ocupa as vagas, na ordem da base. Vazio em `aguardando`. */
  ocupantes: readonly TopCandidatoUf[];
}

type LinhaUf = Pick<EdgeUfRow, "pct_apurado" | "top_candidatos" | "outros">;

const AGUARDANDO: UfNaParcial = { estado: "aguardando", ocupantes: [] };

/**
 * Os ocupantes de uma UF na Parcial. Ver a tabela do cabeçalho.
 *
 * `vagas` vem da tabela canônica (`vagasDaCorrida(5)`) ou de
 * `composicao_vagas.vagas_por_uf` — nunca de literal.
 */
export function vagasDaUfNaParcial(row: LinhaUf, vagas: number): UfNaParcial {
  const top = row.top_candidatos ?? [];

  if (row.pct_apurado >= PCT_UF_CONCLUIDA_PARCIAL) {
    // Mesma conta de `vagasDerivadas` — a ordem do ARRAY (a da projeção), sem
    // reordenar por `pct` arredondado.
    const ocupantes = ocupantesDasVagas(top, vagas);
    return ocupantes.length > 0 ? { estado: "decidida", ocupantes } : AGUARDANDO;
  }

  if (!(row.pct_apurado > 0)) return AGUARDANDO;

  const { ordenados, usouParcial } = ordenarTopCandidatosPorBase(top, "parcial");
  // `usouParcial === false` ⇒ alguém do corte não tem `pct_atual`, e
  // `ordenados` está na ordem da PROJEÇÃO — publicá-la sob "se a apuração
  // parasse agora" seria o modelo com o rótulo da contagem.
  if (!usouParcial) return AGUARDANDO;

  const ocupantes = ocupantesDasVagas(ordenados, vagas);
  if (ocupantes.length === 0) return AGUARDANDO;
  if (ocupantes.some((c) => !(typeof c.pct_atual === "number" && c.pct_atual > 0))) {
    return AGUARDANDO;
  }

  const cauda = row.outros;
  if (cauda !== undefined) {
    // Caso 3 do cabeçalho: faltou gente para as vagas e há cauda que disputa.
    if (ocupantes.length < vagas) return AGUARDANDO;
    // Caso 2: com anulada no corte, só conta quem bate a SOMA da cauda.
    if (haAnulada(top)) {
      const tetoCauda = cauda.pct_atual;
      if (tetoCauda === undefined) return AGUARDANDO;
      if (ocupantes.some((c) => !((c.pct_atual as number) > tetoCauda))) return AGUARDANDO;
    }
  }

  return { estado: "parcial", ocupantes };
}

/** Uma vaga atribuída na Parcial, com a identidade de quem a ocupa. */
export interface VagaNaParcial {
  /** `decidida` = UF concluída (igual à projeção); `parcial` = a contagem de agora. */
  estado: "decidida" | "parcial";
  sigla: string;
  uf: string;
  id: number;
}

/**
 * As vagas atribuídas na Parcial, UF a UF, na ordem de {@link UFS_DO_SENADO}
 * (alfabética de sigla — estável entre ciclos). Só as 27 UFs, e cada uma UMA
 * vez (a primeira ocorrência em `porUf`): uma linha repetida ou uma 28ª sigla
 * não podem contar vaga a mais. UF ausente de `porUf` é `aguardando`.
 */
export function vagasNaParcial(porUf: readonly EdgeUfRow[], vagasPorUf: number): VagaNaParcial[] {
  const porSigla = new Map<string, EdgeUfRow>();
  for (const row of porUf) {
    if (!UFS_DO_SENADO.includes(row.sigla) || porSigla.has(row.sigla)) continue;
    porSigla.set(row.sigla, row);
  }
  const vagas: VagaNaParcial[] = [];
  for (const sigla of UFS_DO_SENADO) {
    const row = porSigla.get(sigla);
    if (!row) continue;
    const { estado, ocupantes } = vagasDaUfNaParcial(row, vagasPorUf);
    if (estado === "aguardando") continue;
    for (const c of ocupantes) {
      vagas.push({ estado, sigla: c.partido ?? PARTIDO_DESCONHECIDO, uf: sigla, id: c.id });
    }
  }
  return vagas;
}

/** A composição das vagas em disputa na Parcial — o gêmeo de `EdgeComposicaoVagas`. */
export interface ComposicaoNaParcial {
  /** Vagas atribuídas por partido: vagas desc → sigla asc (code unit). */
  porPartido: Array<{ partido: string; vagas: number }>;
  /** Σ `porPartido[].vagas`. */
  atribuidas: number;
  /** `vagasEmDisputa − atribuidas` — as que esperam apuração. Nunca negativo. */
  aguardando: number;
  vagasEmDisputa: number;
}

/**
 * Soma por partido das vagas na Parcial. A ordem é por CONTAGEM e depois pela
 * sigla em code units — a mesma do produtor (`por_partido`, "vagas desc,
 * sigla asc"), sem depender do locale (constituição § 6).
 */
export function composicaoNaParcial(
  porUf: readonly EdgeUfRow[],
  vagasPorUf: number,
  vagasEmDisputa: number,
): ComposicaoNaParcial {
  const vagas = vagasNaParcial(porUf, vagasPorUf);
  const soma = new Map<string, number>();
  for (const v of vagas) soma.set(v.sigla, (soma.get(v.sigla) ?? 0) + 1);
  const porPartido = [...soma.entries()]
    .map(([partido, n]) => ({ partido, vagas: n }))
    .sort((a, b) =>
      b.vagas !== a.vagas
        ? b.vagas - a.vagas
        : a.partido < b.partido
          ? -1
          : a.partido > b.partido
            ? 1
            : 0,
    );
  return {
    porPartido,
    atribuidas: vagas.length,
    aguardando: Math.max(0, vagasEmDisputa - vagas.length),
    vagasEmDisputa,
  };
}
