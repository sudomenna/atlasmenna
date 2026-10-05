/**
 * lib/painel/eixo.ts
 *
 * Aritmética do eixo do tempo do painel privado (ADR-0077) — horários BRT,
 * marcas de hora, blocos de 10 minutos. Funções puras, sem dado do retrato:
 * este módulo PODE ser importado por componente `"use client"` (o gráfico com
 * leitura ao toque), ao contrário de `lib/painel/ler.ts`.
 */

import { BRT_OFFSET_MS } from "./tipos";

const MINUTO_MS = 60_000;

/** ISO com deslocamento (`2026-10-04T19:07:12-03:00`) → epoch ms. */
export function msDeIso(iso: string): number {
  return Date.parse(iso);
}

/** Epoch ms → "19h07" (BRT). */
export function horaCurta(ms: number): string {
  const d = new Date(ms - BRT_OFFSET_MS);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}h${m}`;
}

/** Epoch ms → "4/10" (dia/mês, BRT). */
export function diaCurto(ms: number): string {
  const d = new Date(ms - BRT_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/**
 * "19h07", ou "00h51 de 5/10" quando o dia é diferente do dia de referência —
 * a noite atravessa a meia-noite, e "01h00" sozinho seria ambíguo.
 */
export function horaComDia(ms: number, referenciaMs: number): string {
  return diaCurto(ms) === diaCurto(referenciaMs)
    ? horaCurta(ms)
    : `${horaCurta(ms)} de ${diaCurto(ms)}`;
}

/** Posição (em minutos, fracionária) de `ms` num eixo que começa em `inicioMs`. */
export function minutoNoEixo(ms: number, inicioMs: number): number {
  return (ms - inicioMs) / MINUTO_MS;
}

/** Marcas de hora cheia dentro do eixo, a cada `passoHoras`. */
export function marcasDeHora(
  inicioMs: number,
  minutos: number,
  passoHoras = 1,
): { minuto: number; rotulo: string }[] {
  const out: { minuto: number; rotulo: string }[] = [];
  const primeira = Math.ceil(inicioMs / (60 * MINUTO_MS)) * 60 * MINUTO_MS;
  for (let t = primeira; t <= inicioMs + minutos * MINUTO_MS; t += 60 * MINUTO_MS) {
    const hora = new Date(t - BRT_OFFSET_MS).getUTCHours();
    if (hora % passoHoras !== 0) continue;
    out.push({ minuto: minutoNoEixo(t, inicioMs), rotulo: `${String(hora).padStart(2, "0")}h` });
  }
  return out;
}

/**
 * Soma uma série por minuto em blocos de `tamanho` minutos — a tabela
 * acessível dos gráficos densos (720 linhas por gráfico não seriam lidas por
 * ninguém). O último bloco pode ser menor.
 */
export function somarEmBlocos(valores: readonly number[], tamanho = 10): number[] {
  const out: number[] = [];
  for (let i = 0; i < valores.length; i += tamanho) {
    let s = 0;
    for (let j = i; j < Math.min(valores.length, i + tamanho); j++) s += valores[j] ?? 0;
    out.push(Math.round(s * 10) / 10);
  }
  return out;
}

/**
 * Transforma pontos esparsos (`{ms, valor}` em ordem) numa série por minuto
 * que **mantém o último valor** até o próximo ponto; `null` antes do primeiro.
 * É o formato que o gráfico de linhas consome.
 */
export function degrausPorMinuto(
  pontos: readonly { ms: number; valor: number }[],
  inicioMs: number,
  minutos: number,
): (number | null)[] {
  const out = new Array<number | null>(minutos).fill(null);
  const ordenados = [...pontos].sort((a, b) => a.ms - b.ms);
  let j = 0;
  let atual: number | null = null;
  for (let i = 0; i < minutos; i++) {
    const fimDoMinuto = inicioMs + (i + 1) * MINUTO_MS;
    while (j < ordenados.length && (ordenados[j] as { ms: number }).ms < fimDoMinuto) {
      atual = (ordenados[j] as { valor: number }).valor;
      j++;
    }
    out[i] = atual;
  }
  return out;
}

/** Formato numérico pt-BR (milhar com ponto). */
export function fmtNum(n: number, casas = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Topo "redondo" da régua e as marcas intermediárias: 133 → topo 150 com
 * marcas 0, 50, 100, 150. Passos 1-2-5 × 10ⁿ, de 3 a 5 marcas.
 */
export function escalaBonita(maximo: number): { yMax: number; marcas: number[] } {
  if (!(maximo > 0)) return { yMax: 1, marcas: [0, 1] };
  const bruto = maximo / 3;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = ([1, 2, 5, 10].find((m) => m * potencia >= bruto) ?? 10) * potencia;
  const yMax = Math.ceil(maximo / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= yMax + passo / 2; v += passo) marcas.push(Math.round(v * 1000) / 1000);
  return { yMax, marcas };
}
