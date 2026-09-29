/**
 * lib/utils/hemiciclo-bloco.ts — a geometria da VISÃO POR BLOCO (spec 025,
 * RF-240/RF-241; ADR-0061 item 4): a ordem de varredura em que os blocos são
 * pintados e as marcas de limiar (maioria absoluta, três quintos, dois terços)
 * fora do arco externo.
 *
 * Sem React, sem relógio, sem estado (constituição § 6). O desenho mora em
 * `components/blocks/HemicicloPorBloco.tsx`.
 *
 * ## Por que uma varredura PRÓPRIA, e não a de `layoutHemiciclo`
 *
 * A varredura de `layoutHemiciclo` ordena por θ decrescente e, no empate,
 * "pelo arco, interno primeiro" — mas o empate é decidido pelo ÚLTIMO BIT do
 * θ em ponto flutuante (design 023 § D7): na coluna central da Câmara a
 * leitura percorre os arcos 7, 0, 2, 3, 9, 11, 5, não 0, 2, 3, 5, 7, 9, 11.
 * Na visão por partido isso é invisível e não pode mudar (a Câmara sai byte a
 * byte igual). Na visão por bloco é visível: a marca de 257 cai exatamente
 * nessa coluna, e com a ordem do último bit as cadeiras "antes da marca"
 * ficam intercaladas com as "depois" (arcos 7, 0, 2, 3 antes; 9, 11, 5
 * depois) — nenhum traço honesto separa os dois grupos.
 *
 * Aqui a varredura é a MESMA geometria (mesmas cadeiras, mesmos pontos), com o
 * desempate que o comentário de `layoutHemiciclo` promete, feito com
 * tolerância: θ arredondado a 1e-9 rad (a distância real entre colunas é da
 * ordem de 1e-3; o ruído de ponto flutuante, de 1e-16), e dentro da mesma
 * coluna o arco interno primeiro. Consequência: numa coluna partida por uma
 * marca, as cadeiras "antes" são sempre as de DENTRO e as "depois", as de
 * FORA — contíguas no raio, e um traço tangencial entre os dois arcos separa
 * as duas partes sem mentir ({@link marcaDoBloco}).
 *
 * ## Os limiares saem do TOTAL, nunca de literal
 *
 * Maioria absoluta = ⌊N/2⌋ + 1; três quintos = ⌈3N/5⌉; dois terços = ⌈2N/3⌉.
 * Com N = 81: 41, 49, 54. Com N = 513: 257, 308, 342. Nenhum desses números
 * está escrito neste arquivo (mesma regra de `hemiciclo.ts`: nada assume 513
 * nem 81) — o teste é que os confere.
 */

import {
  type HemicicloLayout,
  layoutHemiciclo,
  type MarcaDeLimiar,
  marcaDeLimiar,
  RAIO_EXTERNO,
} from "@/lib/utils/hemiciclo";

/** Quantização do ângulo para o desempate por arco — ver o cabeçalho. */
const QUANTUM_ANGULO = 1e9;

/**
 * O layout de {@link layoutHemiciclo} com a varredura esquerda → direita
 * refeita com desempate TOLERANTE por arco (interno primeiro). Mesmas
 * cadeiras, mesmos pontos; só a ordem (e o `i`) muda.
 */
export function layoutPorBloco(total: number, arcos: number): HemicicloLayout {
  const base = layoutHemiciclo(total, { arcos });
  const chave = (theta: number) => Math.round(theta * QUANTUM_ANGULO);
  const ordenados = [...base.assentos].sort((a, b) => {
    const ka = chave(a.theta);
    const kb = chave(b.theta);
    if (ka !== kb) return kb - ka;
    return a.arco - b.arco;
  });
  return { ...base, assentos: ordenados.map((a, i) => ({ ...a, i })) };
}

export type NomeLimiar = "maioria_absoluta" | "tres_quintos" | "dois_tercos";

export interface Limiar {
  id: NomeLimiar;
  /** Cadeiras necessárias. */
  k: number;
}

/**
 * Os três limiares de votação de uma casa de `total` cadeiras, em ordem
 * crescente. Casa pequena demais (menos de 3 cadeiras) não tem limiar a
 * desenhar.
 */
export function limiaresDaCasa(total: number): Limiar[] {
  if (!Number.isInteger(total) || total < 3) return [];
  return [
    { id: "maioria_absoluta", k: Math.floor(total / 2) + 1 },
    { id: "tres_quintos", k: Math.ceil((3 * total) / 5) },
    { id: "dois_tercos", k: Math.ceil((2 * total) / 3) },
  ];
}

/** Uma marca pronta para desenhar. */
export interface MarcaBloco extends MarcaDeLimiar {
  id: NomeLimiar;
  /**
   * Só em empate: o raio (unidades do `viewBox`) entre o último arco que fica
   * ANTES da marca e o primeiro que fica DEPOIS, na coluna partida. É onde o
   * traço tangencial corta a coluna. `null` sem empate.
   */
  raioCorte: number | null;
  /** Em empate: quantas cadeiras da coluna ficam antes e quantas depois. */
  colunaAntes: number;
  colunaDepois: number;
}

/**
 * A marca do limiar `k` na varredura por bloco. Sem empate, é a de
 * `marcaDeLimiar`. Com empate (a marca cai dentro de uma coluna — a maioria
 * absoluta, no Senado e na Câmara), a varredura por bloco garante que os
 * arcos de antes são todos internos aos de depois, e a marca ganha o raio do
 * corte entre eles.
 *
 * `null` quando `marcaDeLimiar` não tem marca (k fora de 1..total−1) — ou, por
 * defesa, quando o empate NÃO separa por raio (inalcançável com
 * {@link layoutPorBloco}; um layout de outra origem cairia aqui, e a tela
 * prefere não desenhar a marca a desenhá-la cortando a coluna no lugar errado).
 */
export function marcaDoBloco(layout: HemicicloLayout, limiar: Limiar): MarcaBloco | null {
  const m = marcaDeLimiar(layout, limiar.k);
  if (!m) return null;
  if (!m.empate) {
    return { ...m, id: limiar.id, raioCorte: null, colunaAntes: 0, colunaDepois: 0 };
  }
  const ultimoAntes = Math.max(...m.arcosAntes);
  const primeiroDepois = Math.min(...m.arcosDepois);
  if (!(ultimoAntes < primeiroDepois)) return null;
  const rA = layout.raios[ultimoAntes] as number;
  const rD = layout.raios[primeiroDepois] as number;
  return {
    ...m,
    id: limiar.id,
    raioCorte: (rA + rD) / 2,
    colunaAntes: m.arcosAntes.length,
    colunaDepois: m.arcosDepois.length,
  };
}

/**
 * Folga do `viewBox` (unidades) para as marcas e seus números caberem fora do
 * arco externo. Constante de desenho: a mesma nas duas casas, porque o raio
 * externo é o mesmo (a escala do desenho).
 */
export const FOLGA_MARCAS = 24;

/** Onde a marca começa e termina (raio), a partir do raio da bolinha. */
export function raiosDaMarca(layout: HemicicloLayout): {
  inicio: number;
  fim: number;
  rotulo: number;
} {
  const inicio = RAIO_EXTERNO + layout.raioAssento + 1.5;
  return { inicio, fim: inicio + 7, rotulo: inicio + 14 };
}
