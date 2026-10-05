/**
 * tests/unit/scripts/painel-retrato-publicar.test.ts
 *
 * A publicação do retrato no plano B do ADR-0077 (`scripts/painel-retrato.ts`,
 * `--escrever`): a store do projeto é pública e recusou `access: "private"`,
 * então o retrato vai PÚBLICO num endereço secreto — e o segredo é o endereço.
 *
 * Travado aqui, com `@vercel/blob` simulado (nenhum teste vai à rede):
 *   - `access: "public"`, sem sufixo aleatório, sobrescrevendo, cache de 60 s;
 *   - caminho `painel/<64 hex>/retrato-1t-2026.json`, segredo novo a cada vez;
 *   - a URL vai SÓ para `build/painel/url-retrato.txt`, sem quebra de linha;
 *   - a função devolve o caminho do arquivo, nunca a URL — e não imprime nada.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put }));

import { caminhoSecreto, novoSegredo, publicarRetrato } from "@/scripts/painel-retrato";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "painel-publicar-"));
  put.mockReset();
  put.mockImplementation(async (caminho: string) => ({
    url: `https://loja.public.blob.vercel-storage.com/${caminho}`,
    pathname: caminho,
  }));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("segredo e caminho", () => {
  it("novoSegredo: 32 bytes em hex (64 caracteres), diferente a cada chamada", () => {
    const a = novoSegredo();
    const b = novoSegredo();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("caminhoSecreto monta painel/<segredo>/retrato-1t-2026.json e recusa segredo curto", () => {
    const s = "0f".repeat(32);
    expect(caminhoSecreto(s)).toBe(`painel/${s}/retrato-1t-2026.json`);
    expect(() => caminhoSecreto("abc")).toThrow();
    expect(() => caminhoSecreto("")).toThrow();
  });
});

describe("publicarRetrato", () => {
  it("sobe PÚBLICO no endereço secreto, sem sufixo, sobrescrevendo, cache 60 s", async () => {
    await publicarRetrato("{}", "token-de-teste", cwd);
    expect(put).toHaveBeenCalledOnce();
    const [caminho, corpo, opcoes] = put.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(caminho).toMatch(/^painel\/[0-9a-f]{64}\/retrato-1t-2026\.json$/);
    expect(corpo).toBe("{}");
    expect(opcoes).toMatchObject({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      token: "token-de-teste",
    });
  });

  it("grava a URL só no arquivo (sem quebra de linha final), devolve o caminho e não imprime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const segredo = "c3".repeat(32);
    const devolvido = await publicarRetrato("{}", "t", cwd, segredo);

    const gravado = readFileSync(join(cwd, "build/painel/url-retrato.txt"), "utf8");
    expect(gravado).toBe(
      `https://loja.public.blob.vercel-storage.com/painel/${segredo}/retrato-1t-2026.json`,
    );
    expect(gravado.endsWith("\n")).toBe(false);
    expect(devolvido).toBe("build/painel/url-retrato.txt");
    expect(devolvido).not.toContain(segredo);
    expect(log).not.toHaveBeenCalled();
    expect(aviso).not.toHaveBeenCalled();
  });

  it("cada publicação sorteia um segredo novo", async () => {
    await publicarRetrato("{}", "t", cwd);
    await publicarRetrato("{}", "t", cwd);
    const [a, b] = put.mock.calls.map((c) => c[0] as string);
    expect(a).not.toBe(b);
  });
});
