/**
 * tests/unit/leitura/interruptor-script.test.ts — `scripts/interruptor-leitura.ts`.
 *
 * A parte pura (flags e mescla) e duas travas do `executar` com `fetch` FALSO:
 * o store de ensaio é recusado e nada é gravado sem `--confirmar`. Nenhuma
 * chamada sai da máquina.
 */

import { describe, expect, it, vi } from "vitest";
import { INTERRUPTOR_DESLIGADO, type InterruptorLeitura } from "@/lib/leitura/types";
import {
  executar,
  interpretarArgsLeitura,
  mesclarInterruptor,
  temMudancas,
} from "@/scripts/interruptor-leitura";

const AGORA_ISO = "2026-10-04T23:00:00.000Z";

describe("interpretarArgsLeitura", () => {
  it("sem flags: nenhuma mudança (só mostra)", () => {
    const r = interpretarArgsLeitura([]);
    expect(r).toEqual({ mudancas: {} });
    expect(temMudancas((r as { mudancas: object }).mudancas)).toBe(false);
  });

  it("on/off das três partes, com espaço ou com =", () => {
    expect(interpretarArgsLeitura(["--noticias", "on", "--historico=on", "--ia", "OFF"])).toEqual({
      mudancas: { noticias: true, historico: true, ia: false },
    });
  });

  it("--modelo aceita slug provedor/modelo e 'padrao' (remove)", () => {
    expect(interpretarArgsLeitura(["--modelo", "anthropic/claude-sonnet-5.5"])).toEqual({
      mudancas: { modelo: "anthropic/claude-sonnet-5.5" },
    });
    expect(interpretarArgsLeitura(["--modelo", "padrao"])).toEqual({ mudancas: { modelo: null } });
  });

  it("--confirmar e --por", () => {
    expect(
      interpretarArgsLeitura(["--ia", "on", "--confirmar", "ecfg_abc123", "--por", "plantao"]),
    ).toEqual({ mudancas: { ia: true }, confirmar: "ecfg_abc123", por: "plantao" });
  });

  it("erros: valor que não é on/off, slug inválido, confirmar sem id, flag desconhecida", () => {
    for (const argv of [
      ["--ia", "sim"],
      ["--ia"],
      ["--noticias", "true"],
      ["--modelo", "Claude Sonnet"],
      ["--modelo"],
      ["--confirmar", "abc"],
      ["--ligar"],
    ]) {
      expect(interpretarArgsLeitura(argv), argv.join(" ")).toHaveProperty("erro");
    }
  });
});

describe("mesclarInterruptor", () => {
  const atual: InterruptorLeitura = {
    ia: false,
    noticias: true,
    historico: true,
    modelo: "anthropic/claude-sonnet-5.5",
    em: "2026-10-04T22:00:00Z",
    por: "antes",
  };

  it("flag omitida mantém o valor atual; ligar a IA não mexe nas outras", () => {
    expect(mesclarInterruptor(atual, { ia: true }, AGORA_ISO)).toEqual({
      ia: true,
      noticias: true,
      historico: true,
      modelo: "anthropic/claude-sonnet-5.5",
      em: AGORA_ISO,
      por: "pnpm leitura:interruptor",
    });
  });

  it("parte de tudo desligado quando a chave está ausente", () => {
    expect(
      mesclarInterruptor(
        { ...INTERRUPTOR_DESLIGADO },
        { noticias: true, historico: true },
        AGORA_ISO,
        "eu",
      ),
    ).toEqual({ ia: false, noticias: true, historico: true, em: AGORA_ISO, por: "eu" });
  });

  it("modelo null remove o slug; modelo novo troca", () => {
    expect(mesclarInterruptor(atual, { modelo: null }, AGORA_ISO).modelo).toBeUndefined();
    expect(mesclarInterruptor(atual, { modelo: "openai/gpt-x" }, AGORA_ISO).modelo).toBe(
      "openai/gpt-x",
    );
  });

  it("desligar a IA é só a IA", () => {
    const r = mesclarInterruptor({ ...atual, ia: true }, { ia: false }, AGORA_ISO);
    expect(r).toMatchObject({ ia: false, noticias: true, historico: true });
  });
});

describe("executar — travas (fetch falso)", () => {
  const PROD = "ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl";
  const ENSAIO = "ecfg_fdlfvusqgth3gc8eaxloahrvrsgh";

  function fetchFalso(slug: string) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") !== "GET") throw new Error(`gravação inesperada: ${u}`);
      if (/\/item\//.test(u)) return new Response(null, { status: 204 });
      return Response.json({ slug });
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it("recusa o store de ensaio, mesmo com --confirmar", async () => {
    const linhas: string[] = [];
    const f = fetchFalso("salacofre-edge-config-preview");
    const codigo = await executar({
      argv: ["--ia", "on", "--confirmar", ENSAIO],
      env: {
        EDGE_CONFIG: `https://edge-config.vercel.com/${ENSAIO}?token=x`,
        EDGE_CONFIG_TOKEN: "t",
      },
      fetch: f,
      agora: () => new Date(AGORA_ISO),
      escrever: (l) => linhas.push(l),
    });
    expect(codigo).toBe(3);
    expect(linhas.join("\n")).toMatch(/RECUSADO/);
  });

  it("sem --confirmar mostra o valor e não grava", async () => {
    const linhas: string[] = [];
    const f = fetchFalso("salacofre-edge-config");
    const codigo = await executar({
      argv: ["--noticias", "on", "--historico", "on"],
      env: {
        EDGE_CONFIG: `https://edge-config.vercel.com/${PROD}?token=x`,
        EDGE_CONFIG_TOKEN: "t",
      },
      fetch: f,
      agora: () => new Date(AGORA_ISO),
      escrever: (l) => linhas.push(l),
    });
    expect(codigo).toBe(0);
    const saida = linhas.join("\n");
    expect(saida).toMatch(/AUSENTE ⇒ tudo desligado/);
    expect(saida).toContain('"noticias":true');
    expect(saida).toContain('"ia":false');
    expect(saida).toMatch(/Nada gravado/);
  });
});
