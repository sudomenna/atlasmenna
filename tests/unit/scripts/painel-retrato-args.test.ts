/**
 * tests/unit/scripts/painel-retrato-args.test.ts
 *
 * A linha de comando de `pnpm painel:retrato` (ADR-0077). O que importa
 * travar: a janela padrão é a noite do 1º turno em BRT, e data sem fuso é lida
 * como BRT — lida como UTC, a janela andaria 3 horas sem erro nenhum.
 *
 * Importar o script não roda nada (o principal só roda quando ele é o
 * executável) e não lê `.env.local`.
 */

import { describe, expect, it } from "vitest";

import { lerArgs, lerData } from "@/scripts/painel-retrato";

describe("lerData", () => {
  it("sem fuso = BRT", () => {
    expect(new Date(lerData("2026-10-04T16:30")).toISOString()).toBe("2026-10-04T19:30:00.000Z");
    expect(new Date(lerData("2026-10-04T16:30:00")).toISOString()).toBe("2026-10-04T19:30:00.000Z");
  });
  it("com fuso explícito, respeita", () => {
    expect(new Date(lerData("2026-10-04T16:30:00Z")).toISOString()).toBe(
      "2026-10-04T16:30:00.000Z",
    );
  });
  it("lixo lança", () => {
    expect(() => lerData("ontem")).toThrow();
  });
});

describe("lerArgs", () => {
  it("padrões: 04/10 16h30 → 05/10 04h30 BRT, turno 1, sem escrever, saída sob build/", () => {
    const a = lerArgs([], "/repo");
    expect(new Date(a.deMs).toISOString()).toBe("2026-10-04T19:30:00.000Z");
    expect(new Date(a.ateMs).toISOString()).toBe("2026-10-05T07:30:00.000Z");
    expect(a.turno).toBe(1);
    expect(a.escrever).toBe(false);
    expect(a.saida).toBe("/repo/build/painel/retrato-1t-2026.json");
    expect(a.paradosCargos).toEqual([1, 3, 5, 6, 7, 8]);
    expect(a.deInsumos).toBeNull();
  });

  it("--escrever, --turno, --parados-cargos e janela própria", () => {
    const a = lerArgs(
      [
        "--escrever",
        "--turno",
        "2",
        "--parados-cargos",
        "1,3,99",
        "--de",
        "2026-10-25T16:00",
        "--ate",
        "2026-10-26T02:00",
      ],
      "/repo",
    );
    expect(a.escrever).toBe(true);
    expect(a.turno).toBe(2);
    expect(a.paradosCargos).toEqual([1, 3]);
    expect(new Date(a.deMs).toISOString()).toBe("2026-10-25T19:00:00.000Z");
  });

  it("recusa turno inválido e janela invertida", () => {
    expect(() => lerArgs(["--turno", "3"])).toThrow();
    expect(() => lerArgs(["--de", "2026-10-05T10:00", "--ate", "2026-10-05T09:00"])).toThrow();
  });
});
