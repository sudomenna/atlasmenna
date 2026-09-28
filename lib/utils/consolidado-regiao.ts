/**
 * lib/utils/consolidado-regiao.ts
 *
 * O consolidado de uma REGIÃO — a soma dos votos dos estados dela, agrupada
 * por partido (Governador, Senador) ou por candidato (Presidente), dividida
 * pelo total da região. ADR-0057 itens 3 e 4; regras no README do protótipo
 * `docs/design-system/prototipos/capas-regioes-2026-09-28/`.
 *
 * Função PURA e determinística (constituição § 6): mesmas linhas, mesma base,
 * mesma saída — sem data, sem aleatoriedade, sem leitura de rede.
 *
 * ## A base: votos em disputa
 *
 * Válidos + sub judice, com a candidatura ANULADA fora (ADR-0053) — a mesma
 * base dos `pct` de `top_candidatos[]` e de `outros.pct` quando há anulada no
 * escopo da UF. Sub judice compete e entra. No Senado os mesmos números são
 * "% dos votos" (cada eleitor vota duas vezes) — a conta não muda, só o rótulo,
 * que é da tela.
 *
 * ## As duas bases
 *
 *   - **Parcial** = Σ `votos_atuais` das candidaturas que competem + Σ
 *     `outros.votos_atuais` de cada UF.
 *   - **Projeção** = Σ `pct / 100 × votos_disputa_projetados` da UF, para as
 *     mesmas linhas. O total projetado da UF é o campo que o produtor passou a
 *     emitir em 2026-09-28 (ADR-0057 item 4). **Nunca** é estimado aqui a
 *     partir de `contado ÷ % apurado` — o protótipo fazia isso e só fechava
 *     porque o gerador do simulado apura as UFs no mesmo ritmo.
 *
 * O total da região é a SOMA das parcelas calculadas, não Σ
 * `votos_disputa_projetados`: os `pct` de uma UF não fecham exatamente em 100
 * (cada um é a média de um bootstrap próprio, ver `EdgeUfRow.outros`), e
 * dividir pelo total do produtor deixaria a legenda da região somando 99,x%.
 * Dividir pela soma das parcelas faz o consolidado fechar em 100 — e cada
 * parcela continua sendo exatamente o número do cartão vezes o total da UF.
 *
 * ## "Outros" da região
 *
 * Junta (a) as chaves além das {@link TOP_REGIAO} maiores e (b) a cauda
 * `outros` de cada UF: o payload nacional detalha só as primeiras candidaturas
 * de cada estado, e os votos da cauda não podem ser creditados ao partido de
 * origem. Candidatura do top SEM `partido` (payload legado) também vai para
 * "Outros" na agregação por partido — não há sigla a quem creditar.
 *
 * ## Indisponível ≠ zero (decisão do dono de 14/09)
 *
 * `disponivel: false` quando a conta não pode ser feita — a tela mostra "—",
 * nunca estimativa, nunca "0%":
 *
 *   - Projeção com ALGUMA UF da região sem `votos_disputa_projetados`
 *     (`motivo: "sem_total_projetado"`). Tudo-ou-nada: somar só as UFs que têm
 *     o campo publicaria o consolidado de uma região menor com o nome da
 *     inteira.
 *   - Parcial com ALGUMA candidatura que compete sem `votos_atuais`, ou alguma
 *     cauda `outros` sem `votos_atuais` (`motivo: "sem_contagem"`). É a mesma
 *     regra tudo-ou-nada de `EdgeUfRow.outros.pct_atual`: o campo só falta em
 *     payload legado ou sob `model_fallback_tier`, e aí falta para a UF
 *     inteira.
 *   - Total da região igual a zero (`motivo: "sem_votos"`): nenhum voto
 *     contado (ou projetado) ainda. Zero voto É um fato, mas "PT 0%" dividido
 *     por zero não é — a tela diz que não há o que consolidar.
 *
 * UF SEM APURAÇÃO (nenhuma zona chegou) mas com os campos presentes — em
 * cargo 1, `impute_uf_from_national` omite `pct_atual` e deixa `votos_atuais`
 * como o fato "zero boletim" — contribui ZERO voto contado na Parcial, e isso
 * é verdade: nada dela foi contado. Não torna a região indisponível. A região
 * só fica "—" se o total inteiro for zero.
 *
 * ## % apurado da região
 *
 * Σ votos em disputa contados ÷ Σ `votos_disputa_projetados`, nas UFs da
 * região. `null` ("—") se alguma UF não tem o total projetado, ou se a
 * contagem está indisponível. É o mesmo número nas duas bases — descreve o
 * andamento da contagem, não o resultado.
 *
 * ## Ordem neutra (constituição § 2)
 *
 * Votos desc; no empate, o rótulo (sigla ou nome) em collation pt-BR; por fim
 * a chave. É o padrão de `agregarPorPartido`
 * (`lib/utils/desfecho-governador.ts`). Nunca por espectro, cor ou colocação
 * nacional.
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";

export type BaseConsolidado = "parcial" | "proj";

/**
 * Como somar: por `"partido"` (Governador/Senador — cada estado tem candidatos
 * próprios) ou por `"candidato"` (Presidente — o mesmo candidato em todo o
 * país, identificado pelo número de urna `id`, que é igual em todas as UFs
 * justamente porque a corrida é uma só).
 */
export type ChaveConsolidado = "partido" | "candidato";

/** Quantas chaves ganham nome próprio antes de "Outros" (decisão do dono). */
export const TOP_REGIAO = 6;

export interface LinhaConsolidado {
  /** Sigla (agregação por partido) ou `String(id)` (por candidato). */
  chave: string;
  /** Sigla do partido — de onde sai a cor. `null` só se o payload não trouxe. */
  partido: string | null;
  /** Só na agregação por candidato: nome de urna cru e `sqcand` da 1ª UF. */
  nome?: string;
  sqcand?: string;
  votos: number;
  /** 0–100 sobre o total da região. */
  pct: number;
}

export type MotivoIndisponivel = "sem_total_projetado" | "sem_contagem" | "sem_votos";

export interface ConsolidadoRegiao {
  disponivel: boolean;
  motivo?: MotivoIndisponivel;
  /** As {@link TOP_REGIAO} maiores, em ordem neutra. Vazio se indisponível. */
  linhas: LinhaConsolidado[];
  /**
   * Chaves além das 6 + caudas `outros` das UFs. `null` quando não há mais
   * ninguém (nenhuma chave excedente e nenhuma cauda) — "não há mais ninguém"
   * e "os demais somam 0%" são estados diferentes, a mesma regra de
   * `EdgeUfRow.outros`.
   */
  outros: { votos: number; pct: number } | null;
  /** Σ das parcelas (a base dos `pct`). 0 se indisponível. */
  total: number;
  /**
   * 0–100, ou `null` quando não calculável. Igual nas duas bases — mas o
   * denominador (`votos_disputa_projetados`) é SAÍDA DO MODELO, então a tela
   * só o mostra na base Projeção (decisão do dono de 20/09: a visão Parcial
   * não mostra leitura do modelo nenhuma). A Parcial mostra
   * {@link ConsolidadoRegiao.votosContados}.
   */
  pctApurado: number | null;
  /**
   * Σ votos em disputa já contados na região (competem + caudas) — um fato
   * da apuração, sem modelo. `null` quando a contagem está indisponível
   * (`sem_contagem`); `0` é o fato "nada contado ainda". Igual nas duas bases.
   */
  votosContados: number | null;
  /** Quantas UFs entraram na conta. */
  nUfs: number;
}

type TopUf = EdgeUfRow["top_candidatos"][number];

function numero(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Contagem da UF (competem + cauda), ou `null` se falta algum `votos_atuais`. */
function contadoDaUf(row: EdgeUfRow): number | null {
  let soma = 0;
  for (const c of row.top_candidatos ?? []) {
    if (!compete(c)) continue;
    if (!numero(c.votos_atuais)) return null;
    soma += c.votos_atuais;
  }
  if (row.outros) {
    if (!numero(row.outros.votos_atuais)) return null;
    soma += row.outros.votos_atuais;
  }
  return soma;
}

function indisponivel(
  motivo: MotivoIndisponivel,
  nUfs: number,
  pctApurado: number | null,
  votosContados: number | null,
): ConsolidadoRegiao {
  return {
    disponivel: false,
    motivo,
    linhas: [],
    outros: null,
    total: 0,
    pctApurado,
    votosContados,
    nUfs,
  };
}

export function consolidarRegiao(
  rows: readonly EdgeUfRow[],
  base: BaseConsolidado,
  chave: ChaveConsolidado,
): ConsolidadoRegiao {
  // Cada estado é uma corrida: sigla repetida entra uma vez (a primeira).
  const vistas = new Set<string>();
  const ufs = rows.filter((r) => {
    if (vistas.has(r.sigla)) return false;
    vistas.add(r.sigla);
    return true;
  });
  const nUfs = ufs.length;

  // --- % apurado (igual nas duas bases) ---------------------------------
  const contados = ufs.map(contadoDaUf);
  const contagemOk = contados.every((c): c is number => c !== null);
  const totaisProj = ufs.map((r) => r.votos_disputa_projetados);
  const projOk = totaisProj.every(numero);
  const somaProj = projOk ? (totaisProj as number[]).reduce((a, b) => a + b, 0) : 0;
  const somaContado = contagemOk ? (contados as number[]).reduce((a, b) => a + b, 0) : 0;
  const pctApurado =
    projOk && contagemOk && somaProj > 0 ? Math.min(100, (somaContado / somaProj) * 100) : null;

  const votosContados = contagemOk ? somaContado : null;

  if (nUfs === 0) return indisponivel("sem_votos", 0, null, null);
  if (base === "proj" && !projOk) {
    return indisponivel("sem_total_projetado", nUfs, pctApurado, votosContados);
  }
  if (base === "parcial" && !contagemOk) {
    return indisponivel("sem_contagem", nUfs, pctApurado, votosContados);
  }

  // --- soma por chave ---------------------------------------------------
  const acc = new Map<string, LinhaConsolidado>();
  let cauda = 0;
  let haCauda = false;

  for (const row of ufs) {
    const totalUf = row.votos_disputa_projetados ?? 0;
    const valor = (c: { pct: number; votos_atuais?: number }) =>
      base === "proj" ? (c.pct / 100) * totalUf : (c.votos_atuais ?? 0);

    for (const c of row.top_candidatos ?? []) {
      // ADR-0053 — a anulada não compete: fora da soma e fora do total.
      if (!compete(c)) continue;
      const v = valor(c);
      const k = chaveDe(c, chave);
      if (k === null) {
        cauda += v;
        haCauda = true;
        continue;
      }
      const linha = acc.get(k);
      if (linha) {
        linha.votos += v;
      } else {
        acc.set(k, novaLinha(k, c, chave, v));
      }
    }
    if (row.outros) {
      cauda += valor(row.outros);
      haCauda = true;
    }
  }

  const ordenadas = [...acc.values()].sort(
    (a, b) =>
      b.votos - a.votos ||
      rotulo(a).localeCompare(rotulo(b), "pt-BR") ||
      a.chave.localeCompare(b.chave, "pt-BR"),
  );
  const top = ordenadas.slice(0, TOP_REGIAO);
  const excedente = ordenadas.slice(TOP_REGIAO);
  const votosOutros = excedente.reduce((a, l) => a + l.votos, 0) + cauda;
  const total = ordenadas.reduce((a, l) => a + l.votos, 0) + cauda;

  if (!(total > 0)) return indisponivel("sem_votos", nUfs, pctApurado, votosContados);

  return {
    disponivel: true,
    linhas: top.map((l) => ({ ...l, pct: (l.votos / total) * 100 })),
    outros:
      excedente.length > 0 || haCauda
        ? { votos: votosOutros, pct: (votosOutros / total) * 100 }
        : null,
    total,
    pctApurado,
    votosContados,
    nUfs,
  };
}

/** Chave de agregação; `null` ⇒ não dá para creditar a ninguém ("Outros"). */
function chaveDe(c: TopUf, chave: ChaveConsolidado): string | null {
  if (chave === "candidato") return String(c.id);
  return c.partido ? c.partido : null;
}

function novaLinha(k: string, c: TopUf, chave: ChaveConsolidado, votos: number): LinhaConsolidado {
  if (chave === "partido") return { chave: k, partido: c.partido ?? null, votos, pct: 0 };
  return {
    chave: k,
    partido: c.partido ?? null,
    ...(c.nome ? { nome: c.nome } : {}),
    ...(c.sqcand ? { sqcand: c.sqcand } : {}),
    votos,
    pct: 0,
  };
}

/** Rótulo de desempate: nome (candidato) ou sigla (partido). */
function rotulo(l: LinhaConsolidado): string {
  return l.nome ?? l.partido ?? l.chave;
}
