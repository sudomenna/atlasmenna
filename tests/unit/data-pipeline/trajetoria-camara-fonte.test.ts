// I/O da trajetória na Câmara — `data-pipeline/trajetoria-camara-fonte.ts`.
// Spec 018 RF-214, ADR-0058. Sem rede: `fetch` é injetado; o cache vai para um
// diretório temporário.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARQ_DEPUTADOS,
  ARQ_EM_EXERCICIO,
  carregarFonteCamara,
  MAX_EM_EXERCICIO,
  MIN_DEPUTADOS_HISTORICO,
  URL_DEPUTADOS_CSV,
  URL_EM_EXERCICIO,
} from "@/data-pipeline/trajetoria-camara-fonte.ts";

function csvDeputados(n: number): string {
  const cab =
    '"uri";"nome";"idLegislaturaInicial";"idLegislaturaFinal";"nomeCivil";"cpf";"dataNascimento"';
  const linhas = Array.from(
    { length: n },
    (_, i) => `"https://x/deputados/${i + 1}";"D${i}";"50";"57";"PESSOA ${i}";"";"1970-01-01"`,
  );
  return `﻿${[cab, ...linhas].join("\n")}\n`;
}

function jsonEmExercicio(n: number): string {
  return JSON.stringify({
    dados: Array.from({ length: n }, (_, i) => ({ id: i + 1 })),
    links: [],
  });
}

type Resposta = { ok: boolean; status: number; text: () => Promise<string> };
const ok = (corpo: string): Resposta => ({ ok: true, status: 200, text: async () => corpo });

function fetchFalso(roteiro: Record<string, Array<Resposta | Error>>) {
  const chamadas: Array<{ url: string; signal: unknown }> = [];
  const impl = (async (url: string, init?: { signal?: unknown }) => {
    chamadas.push({ url, signal: init?.signal });
    const fila = roteiro[url];
    const prox = fila?.shift();
    if (!prox) throw new Error(`sem resposta roteirizada para ${url}`);
    if (prox instanceof Error) throw prox;
    return prox;
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

let dir: string;
const esperas: number[] = [];
const base = () => ({
  dir,
  esperar: async (ms: number) => {
    esperas.push(ms);
  },
  log: () => {},
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "camara-"));
  esperas.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("carregarFonteCamara", () => {
  it("baixa, valida, grava o cache e devolve o índice", async () => {
    const f = fetchFalso({
      [URL_DEPUTADOS_CSV]: [ok(csvDeputados(MIN_DEPUTADOS_HISTORICO))],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(MAX_EM_EXERCICIO))],
    });
    const r = await carregarFonteCamara({ ...base(), fetchImpl: f.impl });
    expect(r.indice.totalDeputados).toBe(MIN_DEPUTADOS_HISTORICO);
    expect(r.indice.emExercicio.size).toBe(MAX_EM_EXERCICIO);
    expect([r.origemDeputados, r.origemEmExercicio]).toEqual(["download", "download"]);
    expect(readdirSync(dir).sort()).toEqual([ARQ_DEPUTADOS, ARQ_EM_EXERCICIO].sort());
    // Toda requisição sai com um AbortSignal (o timeout por tentativa).
    for (const c of f.chamadas) expect(c.signal).toBeInstanceOf(AbortSignal);
  });

  it("com cache presente não toca a rede; `refresh` baixa de novo", async () => {
    const primeira = fetchFalso({
      [URL_DEPUTADOS_CSV]: [ok(csvDeputados(MIN_DEPUTADOS_HISTORICO))],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(MAX_EM_EXERCICIO))],
    });
    await carregarFonteCamara({ ...base(), fetchImpl: primeira.impl });

    const semRede = fetchFalso({});
    const r = await carregarFonteCamara({ ...base(), fetchImpl: semRede.impl });
    expect(semRede.chamadas).toEqual([]);
    expect([r.origemDeputados, r.origemEmExercicio]).toEqual(["cache", "cache"]);

    const refresh = fetchFalso({
      [URL_DEPUTADOS_CSV]: [ok(csvDeputados(MIN_DEPUTADOS_HISTORICO + 1))],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(MAX_EM_EXERCICIO))],
    });
    const r2 = await carregarFonteCamara({ ...base(), fetchImpl: refresh.impl, refresh: true });
    expect(refresh.chamadas.length).toBe(2);
    expect(r2.indice.totalDeputados).toBe(MIN_DEPUTADOS_HISTORICO + 1);
  });

  it("tenta de novo após falha, com espera crescente", async () => {
    const f = fetchFalso({
      [URL_DEPUTADOS_CSV]: [
        new Error("timeout"),
        { ok: false, status: 503, text: async () => "" },
        ok(csvDeputados(MIN_DEPUTADOS_HISTORICO)),
      ],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(MAX_EM_EXERCICIO))],
    });
    const r = await carregarFonteCamara({ ...base(), fetchImpl: f.impl });
    expect(r.origemDeputados).toBe("download");
    expect(esperas).toEqual([2000, 4000]);
  });

  it("esgotadas as tentativas, lança e não cria cache", async () => {
    const f = fetchFalso({ [URL_DEPUTADOS_CSV]: [1, 2, 3, 4].map(() => new Error("travou")) });
    await expect(carregarFonteCamara({ ...base(), fetchImpl: f.impl })).rejects.toThrow(
      /indisponível após 4 tentativas/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  // MUTAÇÃO ALVO: gravar o cache antes de validar. Uma lista em exercício
  // cortada viraria cache e rebaixaria deputados para `legislatura_atual`.
  it("lista em exercício cortada lança e NÃO vira cache", async () => {
    const f = fetchFalso({
      [URL_DEPUTADOS_CSV]: [ok(csvDeputados(MIN_DEPUTADOS_HISTORICO))],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(100))],
    });
    await expect(carregarFonteCamara({ ...base(), fetchImpl: f.impl })).rejects.toThrow(
      /100 ids distintos/,
    );
    expect(existsSync(join(dir, ARQ_EM_EXERCICIO))).toBe(false);
    expect(existsSync(join(dir, `${ARQ_EM_EXERCICIO}.tmp`))).toBe(false);
  });

  it("histórico truncado lança", async () => {
    const f = fetchFalso({ [URL_DEPUTADOS_CSV]: [ok(csvDeputados(10))] });
    await expect(carregarFonteCamara({ ...base(), fetchImpl: f.impl })).rejects.toThrow(
      /10 pessoas/,
    );
  });

  // ── Modo só-cache (a exportação offline e a paridade sem --camara-refresh) ──

  // MUTAÇÃO ALVO: o modo só-cache cair no download quando falta arquivo.
  it("somenteCache com cache ausente lança SEM tocar a rede e sem criar arquivo", async () => {
    const f = fetchFalso({});
    await expect(
      carregarFonteCamara({ ...base(), fetchImpl: f.impl, somenteCache: true }),
    ).rejects.toThrow(/cache da Câmara ausente/);
    expect(f.chamadas).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  // MUTAÇÃO ALVO: `mkdirSync` antes da checagem — apontada para o cache de
  // OUTRA árvore, a exportação não pode criar nada lá.
  it("somenteCache com diretório inexistente lança e NÃO cria o diretório", async () => {
    const inexistente = join(dir, "nao-existe");
    await expect(
      carregarFonteCamara({ ...base(), dir: inexistente, somenteCache: true }),
    ).rejects.toThrow(/diretório/);
    expect(existsSync(inexistente)).toBe(false);
  });

  it("somenteCache com cache presente lê do cache, sem rede", async () => {
    const primeira = fetchFalso({
      [URL_DEPUTADOS_CSV]: [ok(csvDeputados(MIN_DEPUTADOS_HISTORICO))],
      [URL_EM_EXERCICIO]: [ok(jsonEmExercicio(MAX_EM_EXERCICIO))],
    });
    await carregarFonteCamara({ ...base(), fetchImpl: primeira.impl });
    const semRede = fetchFalso({});
    const r = await carregarFonteCamara({ ...base(), fetchImpl: semRede.impl, somenteCache: true });
    expect(semRede.chamadas).toEqual([]);
    expect([r.origemDeputados, r.origemEmExercicio]).toEqual(["cache", "cache"]);
  });

  it("somenteCache + refresh é contradição e lança", async () => {
    await expect(
      carregarFonteCamara({ ...base(), somenteCache: true, refresh: true }),
    ).rejects.toThrow(/incompatíveis/);
  });
});
