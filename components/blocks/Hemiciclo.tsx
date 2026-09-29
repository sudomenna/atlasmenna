/**
 * components/blocks/Hemiciclo.tsx — a PINTURA de um plenário, uma bolinha por
 * cadeira. Spec 023, design § D5.
 *
 * Extraído de `<CamaraHemiciclo>` em 2026-09-29, quando o Senado (spec 023)
 * passou a precisar do mesmo desenho com 81 cadeiras. O que ficou aqui é só o
 * que as duas casas têm em comum: o `<figure>`, o `<svg role="img">` com
 * `<title>`/`<desc>`, os trechos contíguos agrupados em `<g>` e a legenda.
 * **Quem decide o estado e a cor de cada cadeira é a casca** (`CamaraHemiciclo`,
 * `SenadoHemiciclo`) — este componente não conhece partido, bancada nem vaga.
 *
 * ## 🔴 A Câmara sai byte a byte igual
 *
 * `<CamaraHemiciclo>` foi retratado ANTES da extração
 * (`tests/fixtures/hemiciclo/camara-retrato.json`, sobre `a791e6d`), e
 * `tests/unit/components/camara-hemiciclo-retrato.test.tsx` compara a string.
 * Por isso a ordem dos atributos aqui é a de antes — `data-estado`, os
 * atributos de dado do trecho, `fill`, `stroke`, `stroke-width` — e o `<title>`
 * e o `<desc>` recebem um texto só. Reordenar um atributo derruba aquele teste.
 *
 * ## Server Component, zero JavaScript
 *
 * Mesmos argumentos do cabeçalho de `CamaraHemiciclo.tsx`: SVG inline, sem
 * estado, sem evento. O custo é HTML, e cada casca tem o seu teste de peso.
 *
 * ## Agrupamento por `<g>`
 *
 * Um `<g>` por trecho contíguo com a mesma pintura, e as bolinhas sem cor
 * própria. Repetir `fill`/`stroke` em cada `<circle>` custaria ~70 B por
 * cadeira (+37 KB na Câmara) — o teste de peso de cada casca pega.
 */

import type { CSSProperties, ReactNode } from "react";

import type { HemicicloLayout } from "@/lib/utils/hemiciclo";

/** Cinza de fundo das cadeiras que ainda não são de ninguém, ou não são firmes. */
export const CINZA_ASSENTO = "var(--surface-sunken)";

/** Anel neutro — ≥5,0:1 contra as 3 superfícies claras, gate do RNF-035. */
export const CONTORNO_NEUTRO = "var(--text-secondary)";

/**
 * Espessura do contorno, como fração do raio da bolinha. É o que faz o anel
 * (cadeira não firme) ler como anel, e não como borda fina.
 */
const FRACAO_CONTORNO = 0.42;

/** Um bloco contíguo de cadeiras com a mesma pintura — vira um `<g>`. */
export interface TrechoHemiciclo {
  /** Chave React estável (a casca monta com estado + dono + início). */
  chave: string;
  /** Vai para `data-estado` — é por ele que testes e estilos acham o trecho. */
  estado: string;
  fill: string;
  stroke: string;
  /**
   * Atributos `data-*` do trecho, na ordem em que devem sair no markup. Valor
   * `undefined` ⇒ o atributo não sai (React omite).
   */
  dados?: Record<`data-${string}`, string | undefined>;
  /** Índice da primeira cadeira do trecho na varredura esquerda → direita. */
  inicio: number;
  /** Índice seguinte à última (intervalo semiaberto). */
  fim: number;
  /**
   * Contorno tracejado (spec 025, visão por bloco: a cadeira ainda sem dono).
   * Ausente ⇒ o atributo nem sai — a Câmara e o Senado por partido ficam byte
   * a byte iguais.
   */
  tracejado?: boolean;
}

/**
 * Agrupa a fila de cadeiras em trechos contíguos. `mesmoTrecho` diz quando a
 * cadeira `a` continua o trecho da cadeira anterior `b`; `pintar` monta o
 * trecho novo a partir da primeira cadeira dele.
 */
export function agruparEmTrechos<A>(
  fila: readonly A[],
  mesmoTrecho: (anterior: A, atual: A) => boolean,
  pintar: (primeira: A, inicio: number) => Omit<TrechoHemiciclo, "inicio" | "fim">,
): TrechoHemiciclo[] {
  const trechos: TrechoHemiciclo[] = [];
  for (let i = 0; i < fila.length; i++) {
    const a = fila[i] as A;
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && mesmoTrecho(fila[i - 1] as A, a)) {
      ultimo.fim = i + 1;
      continue;
    }
    trechos.push({ ...pintar(a, i), inicio: i, fim: i + 1 });
  }
  return trechos;
}

/** Duas casas decimais — número de atributo de SVG, não de geometria. */
function arred2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface HemicicloProps {
  layout: HemicicloLayout;
  trechos: readonly TrechoHemiciclo[];
  /** Texto do `<title>` do SVG. */
  titulo: string;
  /** Texto do `<desc>` do SVG. */
  descricao: string;
  /**
   * `id` de um equivalente textual (lista) que também descreve o gráfico —
   * vai para o `aria-describedby`, depois do `<desc>` (constituição § 4). O
   * alvo precisa EXISTIR no documento.
   */
  descritoPorId?: string;
  /** Prefixo dos `id` internos, para duas instâncias não colidirem. */
  idPrefixo: string;
  /** `data-testid` do `<figure>`. */
  testId: string;
  /** Conteúdo do `<figcaption>`. */
  legenda: ReactNode;
  /** `data-testid` do `<figcaption>`. */
  legendaTestId: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Spec 025 (visão por bloco): folga do `viewBox`, em unidades, à esquerda, à
   * direita e em cima — para marcas FORA do arco externo. Ausente ⇒ o
   * `viewBox` de sempre (a Câmara sai byte a byte igual).
   */
  folga?: number;
  /** Spec 025: `<defs>` do SVG (padrões de hachura). Sai antes das cadeiras. */
  defs?: ReactNode;
  /** Spec 025: o que vai POR CIMA das cadeiras (marcas de limiar). */
  sobreposicao?: ReactNode;
}

export function Hemiciclo({
  layout,
  trechos,
  titulo,
  descricao,
  descritoPorId,
  idPrefixo,
  testId,
  legenda,
  legendaTestId,
  className,
  style,
  folga,
  defs,
  sobreposicao,
}: HemicicloProps) {
  const tituloId = `${idPrefixo}-title`;
  const descId = `${idPrefixo}-desc`;
  const f = folga && folga > 0 ? folga : 0;
  const viewBox =
    f > 0
      ? `${-f} ${-f} ${layout.width + 2 * f} ${layout.height + f}`
      : `0 0 ${layout.width} ${layout.height}`;

  return (
    <figure className={className} data-testid={testId} style={{ margin: 0, ...style }}>
      <svg
        role="img"
        aria-labelledby={tituloId}
        aria-describedby={[descId, descritoPorId].filter(Boolean).join(" ")}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        data-total={layout.total}
        data-arcos={layout.arcos}
      >
        <title id={tituloId}>{titulo}</title>
        <desc id={descId}>{descricao}</desc>
        {defs ? <defs>{defs}</defs> : null}
        {trechos.map((t) => (
          <g
            key={t.chave}
            data-estado={t.estado}
            {...t.dados}
            fill={t.fill}
            stroke={t.stroke}
            strokeWidth={layout.raioAssento * FRACAO_CONTORNO}
            strokeDasharray={
              t.tracejado
                ? `${arred2(layout.raioAssento * 0.5)} ${arred2(layout.raioAssento * 0.35)}`
                : undefined
            }
          >
            {layout.assentos.slice(t.inicio, t.fim).map((a) => (
              <circle key={a.i} cx={a.cx} cy={a.cy} r={layout.raioAssento} />
            ))}
          </g>
        ))}
        {sobreposicao}
      </svg>

      <figcaption
        data-testid={legendaTestId}
        className="max-w-prose"
        style={{
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          textWrap: "pretty",
          marginTop: "var(--space-2)",
        }}
      >
        {legenda}
      </figcaption>
    </figure>
  );
}
