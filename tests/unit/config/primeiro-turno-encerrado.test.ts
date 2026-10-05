/**
 * 1º turno encerrado (05/10/2026, ordem do dono: "colocar o 1º turno como
 * encerrado").
 *
 * O setup global (`tests/setup/modo-ao-vivo.ts`) fixa `primeiroTurnoEncerrado`
 * em `false`; aqui a regra de datas é testada com `vi.importActual`, e os
 * pontos que dependem dela ligam o mock explicitamente.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellControls } from "@/components/layout/ShellControls";
import type * as Calendario from "@/lib/config/calendar";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import {
  avaliarFrescorDado,
  dataHoraCurta,
  fraseFrescorDado,
  rotuloFrescorDado,
} from "@/lib/config/dado-freshness";
import {
  avisoSemProjecao,
  fraseCorte,
  projecaoVisivel,
  TEXTO_MARCA,
  textoDaMarca,
} from "@/lib/utils/deputado-marcas";
import { definicaoDaUf } from "@/lib/utils/eleitos-definidos";
import { rotuloTurno, rotuloVaga, SELO_FINAL, selosDaBase } from "@/lib/utils/selo-resultado";

const encerrar = (sim: boolean) => vi.mocked(primeiroTurnoEncerrado).mockReturnValue(sim);

afterEach(() => {
  encerrar(false);
});

describe("primeiroTurnoEncerrado — a regra de datas", () => {
  it("vale de 05/10 03h (BRT) até o início do 2º turno, exclusive nas duas pontas certas", async () => {
    const real = await vi.importActual<typeof Calendario>("@/lib/config/calendar");
    const em = (iso: string) => real.primeiroTurnoEncerrado(new Date(iso));

    expect(real.ENCERRAMENTO_1T_2026).toBe("2026-10-05T03:00:00-03:00");
    // Noite da apuração: ao vivo.
    expect(em("2026-10-04T22:00:00-03:00")).toBe(false);
    expect(em("2026-10-05T02:59:59-03:00")).toBe(false);
    // Encerrado.
    expect(em("2026-10-05T03:00:00-03:00")).toBe(true);
    expect(em("2026-10-15T12:00:00-03:00")).toBe(true);
    expect(em("2026-10-24T23:59:59-03:00")).toBe(true);
    // 2º turno: comportamento de apuração volta, sem mudança.
    expect(em("2026-10-25T00:00:00-03:00")).toBe(false);
    expect(em("2026-10-25T20:00:00-03:00")).toBe(false);
  });

  it("a suíte roda em modo ao vivo por padrão (setup global)", () => {
    expect(primeiroTurnoEncerrado()).toBe(false);
  });
});

describe("frescor — estado 'encerrado'", () => {
  const DADO = "2026-10-05T01:23:45-03:00";
  const DEPOIS = Date.parse("2026-10-05T12:00:00-03:00");

  it("ao vivo, dado de 10h atrás é 'parado' (o par que prova que o mock decide)", () => {
    expect(avaliarFrescorDado(DADO, 1, DEPOIS).estado).toBe("parado");
  });

  it("encerrado: nunca 'parado', e a frase é a do resultado final, sem cadência", () => {
    encerrar(true);
    const f = avaliarFrescorDado(DADO, 1, DEPOIS);
    expect(f.estado).toBe("encerrado");
    expect(fraseFrescorDado(f, DADO)).toBe(
      "Resultado final do TSE · totalização encerrada em 05/10 às 01:23",
    );
    expect(fraseFrescorDado(f, DADO)).not.toContain("a cada");
    expect(rotuloFrescorDado(f, DADO)).toEqual({
      label: "Totalização encerrada",
      value: "05/10 às 01:23",
    });
  });

  it("dataHoraCurta fala no fuso de Brasília, à meia-noite inclusive", () => {
    expect(dataHoraCurta("2026-10-05T03:05:00Z")).toBe("05/10 às 00:05");
  });
});

describe("selos — vocabulário final", () => {
  const cand = (id: number, pct: number) => ({ id, pct_atual: pct, pct_projetado: pct });

  it("ao vivo: 'na parcial'", () => {
    expect(rotuloVaga("parcial")).toBe("Vaga na parcial");
    const s = selosDaBase([cand(1, 45), cand(2, 30), cand(3, 25)], "parcial", { regra: "turno" });
    expect(s.get(1)).toBe("2º turno · na parcial");
  });

  it("encerrado: Eleito / Eleito no 1º turno / Vai ao 2º turno — sem base", () => {
    encerrar(true);
    expect(rotuloVaga("parcial")).toBe(SELO_FINAL.vaga);
    expect(rotuloVaga("proj")).toBe("Eleito");
    expect(rotuloTurno("primeiro", "parcial")).toBe("Eleito no 1º turno");

    const turno = selosDaBase([cand(1, 45), cand(2, 30), cand(3, 25)], "parcial", {
      regra: "turno",
    });
    expect(turno.get(1)).toBe("Vai ao 2º turno");
    expect(turno.get(2)).toBe("Vai ao 2º turno");
    expect(turno.has(3)).toBe(false);

    const vence = selosDaBase([cand(1, 55), cand(2, 45)], "parcial", { regra: "turno" });
    expect(vence.get(1)).toBe("Eleito no 1º turno");

    const vaga = selosDaBase([cand(1, 40), cand(2, 35), cand(3, 25)], "parcial", {
      regra: "vaga",
      vagas: 2,
    });
    expect([...vaga.values()]).toEqual(["Eleito", "Eleito"]);
  });

  it("encerrado: definição do estado sem o 'matematicamente'", () => {
    const row = {
      top_candidatos: [{ id: 7, pct: 60 }],
      eleitos_definidos: [7],
    } as unknown as Parameters<typeof definicaoDaUf>[0];
    expect(definicaoDaUf(row).rotulo).toBe("Matematicamente eleito");
    encerrar(true);
    expect(definicaoDaUf(row).rotulo).toBe("Eleito");
  });
});

describe("Deputado — marcas da contagem final", () => {
  it("encerrado: 'Eleito', sem projeção visível, sem aviso, corte sem 'na parcial'", () => {
    const marca = { tipo: "parcial", via: "qp", apertada: false } as const;
    expect(textoDaMarca(marca).principal).toBe(TEXTO_MARCA.parcial);
    expect(projecaoVisivel({ estado: "liberada" }, true)).toBe(true);

    encerrar(true);
    expect(textoDaMarca(marca).principal).toBe("Eleito");
    expect(projecaoVisivel({ estado: "liberada" }, true)).toBe(false);
    expect(avisoSemProjecao(true, { totalizacaoFinal: false, projecaoVisivel: false })).toBeNull();
    expect(fraseCorte({ diferenca: 10 })).toBe(
      "Linha de corte: 10 votos separam o último eleito do primeiro de fora.",
    );
  });
});

describe("<ShellControls> — rótulo fixo no lugar do controle", () => {
  it("ao vivo: o controle Parcial / Projeção", () => {
    const html = renderToStaticMarkup(createElement(ShellControls, {}));
    expect(html).toContain('data-testid="view-mode-switch"');
    expect(html).not.toContain("Resultado final");
  });

  it("encerrado: 'Resultado final', sem controle e sem a palavra projeção", () => {
    const html = renderToStaticMarkup(createElement(ShellControls, { encerrado: true }));
    expect(html).toContain('data-testid="shell-resultado-final"');
    expect(html).toContain("Resultado final");
    expect(html).not.toContain('data-testid="view-mode-switch"');
    expect(html.toLowerCase()).not.toContain("projeção");
  });
});
