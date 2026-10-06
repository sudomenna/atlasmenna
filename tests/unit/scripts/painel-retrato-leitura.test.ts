/**
 * tests/unit/scripts/painel-retrato-leitura.test.ts
 *
 * Trava o modo SÓ LEITURA do gerador do retrato (`scripts/painel-retrato.ts`,
 * ADR-0077) contra o banco de PRODUÇÃO.
 *
 * ## O defeito que este teste impede de voltar
 *
 * A primeira versão (`a9413db`) fazia `neon(url, { readOnly: true })` e
 * `await sql.query(texto, params)`. Parece só leitura e não é: no driver
 * (`@neondatabase/serverless`, `index.mjs`) o cabeçalho `Neon-Batch-Read-Only`
 * só vai quando a consulta é um LOTE (array) — `sql.query()` avulsa ignora a
 * opção em silêncio. Achado pelo constitution-guard em 05/10.
 *
 * O teste simula o driver e exige duas coisas de TODA consulta do caminho de
 * leitura (`lerDoBanco`, não só do auxiliar):
 *
 *   1. ela passa por `sql.transaction([...], { readOnly: true })`;
 *   2. nenhuma `sql.query()` é aguardada sozinha — a consulta simulada não é
 *      "thenable", então aguardá-la direto devolveria o próprio objeto e o
 *      leitor quebraria tentando `.map` nele.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface ConsultaSimulada {
  texto: string;
  params: unknown[];
}

const estado = vi.hoisted(() => ({
  transacoes: [] as { consultas: unknown[]; opcoes: unknown }[],
  queries: 0,
  opcoesDoNeon: [] as unknown[],
  /** Linhas devolvidas por consulta, decididas pelo texto. */
  responder: (_texto: string): Record<string, unknown>[] => [],
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: (_url: string, opcoes?: unknown) => {
    estado.opcoesDoNeon.push(opcoes);
    return {
      query: (texto: string, params: unknown[]): ConsultaSimulada => {
        estado.queries += 1;
        return { texto, params };
      },
      transaction: async (consultas: ConsultaSimulada[], opcoes: unknown) => {
        estado.transacoes.push({ consultas, opcoes });
        return consultas.map((c) => estado.responder(c.texto));
      },
    };
  },
}));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

import { neon } from "@neondatabase/serverless";

import { consultarSoLeitura, lerArgs, lerDoBanco } from "@/scripts/painel-retrato";

beforeEach(() => {
  estado.transacoes = [];
  estado.queries = 0;
  estado.opcoesDoNeon = [];
  estado.responder = () => [];
});

describe("consultarSoLeitura", () => {
  it("embrulha a consulta numa transação com readOnly: true e devolve as linhas", async () => {
    estado.responder = () => [{ n: 1 }];
    const sql = neon("postgresql://u:p@h/db");
    const linhas = await consultarSoLeitura(
      sql as unknown as Parameters<typeof consultarSoLeitura>[0],
      "SELECT 1",
      [],
    );
    expect(linhas).toEqual([{ n: 1 }]);
    expect(estado.transacoes).toHaveLength(1);
    expect(estado.transacoes[0]?.opcoes).toEqual({ readOnly: true });
    expect(estado.transacoes[0]?.consultas).toEqual([{ texto: "SELECT 1", params: [] }]);
  });
});

describe("lerDoBanco — o caminho inteiro de leitura", () => {
  it("TODA consulta vai numa transação readOnly, e nenhuma é aguardada solta", async () => {
    // Uma versão de arquivo incompleta, para o leitor também buscar os nomes
    // dos municípios (a consulta que só roda nesse caso).
    estado.responder = (texto) => {
      if (texto.includes("max(id)")) return [{ cargo: 1, id: "10" }];
      if (texto.includes("SELECT id::text AS id")) return [{ id: "11" }];
      if (texto.includes("WHERE id = ANY")) {
        return [
          {
            ts: "2026-10-05T00:00:00Z",
            cargo: 1,
            nivel: "zona",
            uf: "MG",
            cod_municipio_tse: 41556,
            cod_zona: 72,
            st: "38",
            tot: "41",
          },
        ];
      }
      if (texto.includes("FROM municipios")) return [{ cod_municipio_tse: 41556, nome: "X" }];
      return [];
    };
    const args = lerArgs([], "/repo");
    const lido = await lerDoBanco("postgresql://u:p@h/db", args);

    expect(lido.versoes[0]?.municipio).toBe("X");
    // ingest_log, snapshots/minuto, rodadas, agregados do Presidente (ids + 1 lote),
    // rodadas da corrida, candidatos da corrida, últimos ids, 1 lote, municípios
    expect(estado.transacoes.length).toBe(10);
    expect(estado.queries).toBe(estado.transacoes.length);
    for (const t of estado.transacoes) {
      expect(t.opcoes).toEqual({ readOnly: true });
      expect(t.consultas).toHaveLength(1);
    }
  });

  it("só SELECT: nenhuma consulta escreve", async () => {
    await lerDoBanco("postgresql://u:p@h/db", lerArgs([], "/repo"));
    for (const t of estado.transacoes) {
      const { texto } = t.consultas[0] as ConsultaSimulada;
      expect(texto.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    }
  });
});

describe("--saida e --guardar-insumos só dentro de build/", () => {
  it("aceita caminho sob build/", () => {
    const a = lerArgs(
      ["--saida", "build/painel/x.json", "--guardar-insumos", "build/painel/i.json"],
      "/repo",
    );
    expect(a.saida).toBe("/repo/build/painel/x.json");
    expect(a.guardarInsumos).toBe("/repo/build/painel/i.json");
  });

  it.each([
    "retrato.json",
    "app/painel/retrato.json",
    "build/../retrato.json",
    "/tmp/retrato.json",
    "build",
    "buildx/retrato.json",
  ])("recusa %s", (caminho) => {
    expect(() => lerArgs(["--saida", caminho], "/repo")).toThrow(/build\//);
    expect(() => lerArgs(["--guardar-insumos", caminho], "/repo")).toThrow(/build\//);
  });
});
