"use client";

/**
 * components/painel/GraficoPorMinuto.tsx
 *
 * Gráfico minuto a minuto do painel privado (ADR-0077): áreas empilhadas ou
 * linhas em degrau sobre o eixo do tempo da noite, com leitura ao toque
 * (passar o dedo/mouse mostra o minuto e os valores de cada série).
 *
 * 🔴 Componente de CLIENTE: recebe tudo por props do componente de servidor.
 * NUNCA importe aqui `lib/painel/ler.ts` nem o JSON do retrato — iria para um
 * chunk público em `/_next/static` (trava em
 * `tests/unit/painel/retrato-fora-do-cliente.test.ts`). Só `lib/painel/eixo.ts`
 * (aritmética de tempo, sem dado) é permitido.
 *
 * Geometria: o SVG usa `viewBox` em MINUTOS × 100 e `preserveAspectRatio="none"`
 * — estica para qualquer largura sem recalcular nada. Por isso nenhum texto
 * mora dentro do SVG (sairia deformado): rótulos de eixo, de referência e a
 * leitura são HTML posicionado em porcentagem. Os traços usam
 * `vector-effect: non-scaling-stroke` para não engrossar ao esticar.
 */

import { type KeyboardEvent, type PointerEvent, useCallback, useState } from "react";

import { fmtNum, horaCurta, marcasDeHora } from "@/lib/painel/eixo";

import s from "./painel.module.css";

export interface SerieDoGrafico {
  chave: string;
  rotulo: string;
  /** Cor CSS (`var(--painel-cargo-1)`) — nunca hex solto. */
  cor: string;
  /** Um valor por minuto do eixo; `null` = sem dado naquele minuto (linhas). */
  valores: (number | null)[];
  tracejado?: boolean;
}

export interface MarcaNoTempo {
  /** Minuto (fracionário) no eixo. */
  minuto: number;
  rotulo: string;
}

export interface GraficoPorMinutoProps {
  inicioMs: number;
  minutos: number;
  series: SerieDoGrafico[];
  /**
   * `"empilhado"`: áreas em degrau (séries densas). `"barras"`: um traço
   * vertical de largura fixa por minuto com valor — para séries ESPARSAS
   * (erros, bloqueios), onde um minuto em 720 viraria um fio invisível.
   * `"linhas"`: linhas em degrau, sem empilhar.
   */
  modo: "empilhado" | "barras" | "linhas";
  /** Topo da régua, já na unidade exibida. */
  yMax: number;
  /** Multiplica o valor cru antes de exibir (ex.: 1/60 para "por segundo"). */
  fator?: number;
  /** Unidade exibida na leitura ("pedidos por segundo"). */
  unidade: string;
  casas?: number;
  /** Valores da régua (unidade exibida). */
  marcasY: number[];
  referencia?: { valor: number; rotulo: string } | null;
  marcas?: MarcaNoTempo[];
  alturaPx?: number;
  /** Resumo do gráfico para leitor de tela (vai no `aria-label` do SVG). */
  rotulo: string;
  /** Mostra a soma das séries na leitura (faz sentido no empilhado). */
  mostrarTotal?: boolean;
}

const H = 100;

function yDe(valor: number, yMax: number): number {
  const v = Math.max(0, Math.min(yMax, valor));
  return Math.round((H - (v / yMax) * H) * 10) / 10;
}

/** Caminho em degrau ao longo de `ys` (um y por minuto), da esquerda para a direita. */
function degrauIda(ys: number[]): string {
  let d = "";
  let yAnt = Number.NaN;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i] as number;
    if (y !== yAnt) {
      d += `${i === 0 ? "" : `H${i}`}V${y}`;
      yAnt = y;
    }
  }
  return `${d}H${ys.length}`;
}

/** O mesmo degrau, da direita para a esquerda. */
function degrauVolta(ys: number[]): string {
  let d = "";
  let yAnt = Number.NaN;
  for (let i = ys.length - 1; i >= 0; i--) {
    const y = ys[i] as number;
    if (y !== yAnt) {
      d += `${i === ys.length - 1 ? "" : `H${i + 1}`}V${y}`;
      yAnt = y;
    }
  }
  return `${d}H0`;
}

function caminhosEmpilhados(series: SerieDoGrafico[], fator: number, yMax: number): string[] {
  const n = series[0]?.valores.length ?? 0;
  let base = new Array<number>(n).fill(0);
  return series.map((serie) => {
    const topo = base.map((b, i) => b + (serie.valores[i] ?? 0) * fator);
    const ysTopo = topo.map((v) => yDe(v, yMax));
    const ysBase = base.map((v) => yDe(v, yMax));
    base = topo;
    return `M0 ${ysBase[0] ?? H}${degrauIda(ysTopo)}${degrauVolta(ysBase)}Z`;
  });
}

/**
 * Barras empilhadas só nos minutos com valor: para cada série, um caminho com
 * um segmento vertical por minuto (do topo da série anterior ao seu topo).
 * Desenhado com traço de largura FIXA em pixels (`non-scaling-stroke`), para
 * que um minuto isolado continue visível em qualquer largura de tela.
 */
function caminhosDeBarras(series: SerieDoGrafico[], fator: number, yMax: number): string[] {
  const n = series[0]?.valores.length ?? 0;
  const base = new Array<number>(n).fill(0);
  return series.map((serie) => {
    let d = "";
    for (let i = 0; i < n; i++) {
      const v = (serie.valores[i] ?? 0) * fator;
      if (!(v > 0)) continue;
      const b = base[i] as number;
      d += `M${i + 0.5} ${yDe(b, yMax)}V${yDe(b + v, yMax)}`;
      base[i] = b + v;
    }
    return d;
  });
}

function caminhoDeLinha(valores: (number | null)[], fator: number, yMax: number): string {
  let d = "";
  let aberto = false;
  let yAnt = Number.NaN;
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (v === null || v === undefined) {
      if (aberto) d += `H${i}`;
      aberto = false;
      continue;
    }
    const y = yDe(v * fator, yMax);
    if (!aberto) {
      d += `M${i} ${y}`;
      aberto = true;
    } else if (y !== yAnt) {
      d += `H${i}V${y}`;
    }
    yAnt = y;
  }
  if (aberto) d += `H${valores.length}`;
  return d;
}

export function GraficoPorMinuto({
  inicioMs,
  minutos,
  series,
  modo,
  yMax,
  fator = 1,
  unidade,
  casas = 0,
  marcasY,
  referencia = null,
  marcas = [],
  alturaPx = 180,
  rotulo,
  mostrarTotal = false,
}: GraficoPorMinutoProps) {
  const [indice, setIndice] = useState<number | null>(null);

  const aoMover = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const caixa = e.currentTarget.getBoundingClientRect();
      if (caixa.width <= 0) return;
      const frac = (e.clientX - caixa.left) / caixa.width;
      setIndice(Math.max(0, Math.min(minutos - 1, Math.floor(frac * minutos))));
    },
    [minutos],
  );

  const aoTeclar = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const passo = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setIndice((atual) => {
          const base = atual ?? 0;
          const prox = e.key === "ArrowRight" ? base + passo : base - passo;
          return Math.max(0, Math.min(minutos - 1, prox));
        });
      } else if (e.key === "Escape") {
        setIndice(null);
      }
    },
    [minutos],
  );

  const caminhos =
    modo === "empilhado"
      ? caminhosEmpilhados(series, fator, yMax)
      : modo === "barras"
        ? caminhosDeBarras(series, fator, yMax)
        : series.map((sr) => caminhoDeLinha(sr.valores, fator, yMax));
  const horas = marcasDeHora(inicioMs, minutos, 1);
  const pct = (minuto: number) => `${(minuto / minutos) * 100}%`;
  const pctY = (valor: number) => `${(yDe(valor, yMax) / H) * 100}%`;

  const leitura =
    indice === null
      ? null
      : series.map((sr) => ({
          chave: sr.chave,
          rotulo: sr.rotulo,
          cor: sr.cor,
          valor: sr.valores[indice] ?? null,
        }));
  const total = leitura?.reduce((acc, l) => acc + (l.valor === null ? 0 : l.valor * fator), 0) ?? 0;
  const marcasPerto =
    indice === null ? [] : marcas.filter((m) => Math.abs(m.minuto - (indice + 0.5)) <= 1.5);
  const leituraADireita = indice !== null && indice < minutos * 0.55;
  const textoDaLeitura =
    indice === null || !leitura
      ? "nenhum minuto selecionado"
      : `${horaCurta(inicioMs + indice * 60_000)}: ${leitura
          .map(
            (l) => `${l.rotulo} ${l.valor === null ? "sem dado" : fmtNum(l.valor * fator, casas)}`,
          )
          .join(", ")}${mostrarTotal ? `; total ${fmtNum(total, casas)}` : ""} ${unidade}`;

  return (
    <div className={s.grafico}>
      <ul className={s.legenda} aria-hidden="true">
        {series.map((sr) => (
          <li key={sr.chave}>
            <span
              className={sr.tracejado ? s.amostraTracejada : s.amostra}
              style={{ background: sr.tracejado ? undefined : sr.cor, borderColor: sr.cor }}
            />
            {sr.rotulo}
          </li>
        ))}
      </ul>
      <div className={s.plot} style={{ height: alturaPx }}>
        <div className={s.reguaY} aria-hidden="true">
          {marcasY.map((v) => (
            <span key={v} style={{ top: pctY(v) }}>
              {fmtNum(v, casas)}
            </span>
          ))}
        </div>
        <div className={s.areaDoPlot}>
          <svg
            className={s.svg}
            viewBox={`0 0 ${minutos} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={rotulo}
          >
            {marcasY.map((v) => (
              <line
                key={v}
                x1={0}
                x2={minutos}
                y1={yDe(v, yMax)}
                y2={yDe(v, yMax)}
                className={s.grade}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {horas.map((h) => (
              <line
                key={h.minuto}
                x1={h.minuto}
                x2={h.minuto}
                y1={0}
                y2={H}
                className={s.gradeVertical}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {caminhos.map((d, i) => {
              const sr = series[i] as SerieDoGrafico;
              if (modo === "barras") {
                return d ? (
                  <path
                    key={sr.chave}
                    d={d}
                    fill="none"
                    stroke={sr.cor}
                    strokeWidth={4}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null;
              }
              return modo === "empilhado" ? (
                <path
                  key={sr.chave}
                  d={d}
                  fill={sr.cor}
                  className={s.areaEmpilhada}
                  shapeRendering="crispEdges"
                />
              ) : (
                <path
                  key={sr.chave}
                  d={d}
                  fill="none"
                  stroke={sr.cor}
                  strokeWidth={2}
                  strokeDasharray={sr.tracejado ? "5 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {referencia ? (
              <line
                x1={0}
                x2={minutos}
                y1={yDe(referencia.valor, yMax)}
                y2={yDe(referencia.valor, yMax)}
                className={s.referencia}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {marcas.map((m) => (
              <line
                key={`${m.minuto}-${m.rotulo}`}
                x1={m.minuto}
                x2={m.minuto}
                y1={H - 6}
                y2={H}
                className={s.marcaCorrecao}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {indice !== null ? (
              <line
                x1={indice + 0.5}
                x2={indice + 0.5}
                y1={0}
                y2={H}
                className={s.cursor}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {referencia ? (
            <span
              className={s.rotuloReferencia}
              style={{ top: pctY(referencia.valor) }}
              aria-hidden="true"
            >
              {referencia.rotulo}
            </span>
          ) : null}
          <div className={s.reguaX} aria-hidden="true">
            {horas.map((h) => (
              <span key={h.minuto} style={{ left: pct(h.minuto) }}>
                {h.rotulo}
              </span>
            ))}
          </div>
          {/* A camada de leitura é um controle deslizante: o valor é o minuto
              lido. Ponteiro e setas do teclado (Shift = 10 min) movem a leitura;
              Esc fecha. O mesmo dado está em "Ver em tabela", logo abaixo. */}
          <div
            className={s.camadaDeLeitura}
            role="slider"
            tabIndex={0}
            aria-label={`Leitura do gráfico, minuto a minuto. ${rotulo}`}
            aria-valuemin={0}
            aria-valuemax={minutos - 1}
            aria-valuenow={indice ?? 0}
            aria-valuetext={textoDaLeitura}
            onPointerMove={aoMover}
            onPointerDown={aoMover}
            // No toque, o dedo "sai" assim que levanta: a leitura fica até
            // tocar fora (onBlur). Com mouse, some quando o ponteiro sai.
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setIndice(null);
            }}
            onKeyDown={aoTeclar}
            onBlur={() => setIndice(null)}
          />
          {leitura && indice !== null ? (
            <div
              className={s.leitura}
              style={
                leituraADireita
                  ? { left: `calc(${pct(indice + 0.5)} + 8px)` }
                  : { right: `calc(${pct(minutos - indice - 0.5)} + 8px)` }
              }
            >
              <strong>{horaCurta(inicioMs + indice * 60_000)}</strong>
              <ul>
                {leitura.map((l) => (
                  <li key={l.chave}>
                    <span className={s.amostra} style={{ background: l.cor }} />
                    {l.rotulo}: {l.valor === null ? "—" : fmtNum(l.valor * fator, casas)}
                  </li>
                ))}
              </ul>
              {mostrarTotal ? (
                <p>
                  Total: {fmtNum(total, casas)} {unidade}
                </p>
              ) : (
                <p>{unidade}</p>
              )}
              {marcasPerto.map((m) => (
                <p key={m.rotulo} className={s.leituraCorrecao}>
                  Correção registrada: {m.rotulo}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
