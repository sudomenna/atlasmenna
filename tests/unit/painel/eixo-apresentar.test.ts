/**
 * tests/unit/painel/eixo-apresentar.test.ts
 *
 * O eixo do tempo (`lib/painel/eixo.ts`) e o texto das ocorrências
 * (`lib/painel/apresentar.ts`) do painel privado (ADR-0077).
 */

import { describe, expect, it } from "vitest";

import { montarRetrato } from "@/lib/painel/agregar";
import {
  cicloTemProblema,
  filtrarCiclos,
  lerFiltroCiclos,
  ocorrenciasDaNoite,
} from "@/lib/painel/apresentar";
import {
  degrausPorMinuto,
  escalaBonita,
  horaComDia,
  horaCurta,
  marcasDeHora,
  proximoMinuto,
  somarEmBlocos,
} from "@/lib/painel/eixo";
import type { CicloPainel } from "@/lib/painel/tipos";

const T0 = Date.parse("2026-10-04T19:30:00Z"); // 16h30 BRT
const MIN = 60_000;

describe("proximoMinuto (teclado do gráfico)", () => {
  const N = 720;
  it("do vazio, a PRIMEIRA seta vai ao minuto 0 (não ao 1), em qualquer direção", () => {
    for (const t of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]) {
      expect(proximoMinuto(null, t, false, N)).toBe(0);
      expect(proximoMinuto(null, t, true, N)).toBe(0);
    }
  });
  it("setas: ±1, com Shift ±10; cima = direita, baixo = esquerda", () => {
    expect(proximoMinuto(5, "ArrowRight", false, N)).toBe(6);
    expect(proximoMinuto(5, "ArrowUp", false, N)).toBe(6);
    expect(proximoMinuto(5, "ArrowLeft", false, N)).toBe(4);
    expect(proximoMinuto(5, "ArrowDown", false, N)).toBe(4);
    expect(proximoMinuto(5, "ArrowRight", true, N)).toBe(15);
  });
  it("Page Up / Page Down andam uma hora; Home e End vão às pontas", () => {
    expect(proximoMinuto(100, "PageUp", false, N)).toBe(160);
    expect(proximoMinuto(100, "PageDown", false, N)).toBe(40);
    expect(proximoMinuto(100, "Home", false, N)).toBe(0);
    expect(proximoMinuto(100, "End", false, N)).toBe(719);
    expect(proximoMinuto(null, "End", false, N)).toBe(719);
  });
  it("nunca sai do eixo", () => {
    expect(proximoMinuto(0, "ArrowLeft", false, N)).toBe(0);
    expect(proximoMinuto(30, "PageDown", false, N)).toBe(0);
    expect(proximoMinuto(700, "PageUp", false, N)).toBe(719);
  });
  it("tecla que não é de navegação: undefined (o navegador age — Tab, Enter…)", () => {
    expect(proximoMinuto(5, "Tab", false, N)).toBeUndefined();
    expect(proximoMinuto(null, "Enter", false, N)).toBeUndefined();
  });
});

describe("tabelas do painel: toda caixa que rola é focável", () => {
  it("a classe da caixa rolável só é usada dentro de TabelaRolavel", async () => {
    const { readFileSync } = await import("node:fs");
    const usos = [
      "app/painel/page.tsx",
      "components/painel/Tabelas.tsx",
      "components/painel/Faixas.tsx",
    ]
      .map((f) => readFileSync(f, "utf8").match(/s\.rolavel\b/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    // dois usos, ambos na linha do className de `TabelaRolavel`
    expect(usos).toBe(2);
    const tabelas = readFileSync("components/painel/Tabelas.tsx", "utf8");
    expect(tabelas).toMatch(/<section\s+className=\{alta \? `\$\{s\.rolavel\}/);
    expect(tabelas).toMatch(/tabIndex=\{0\}/);
  });
});

describe("eixo", () => {
  it("horaCurta e horaComDia falam BRT e marcam a virada do dia", () => {
    expect(horaCurta(T0)).toBe("16h30");
    expect(horaComDia(T0 + 8 * 60 * MIN, T0)).toBe("00h30 de 5/10");
    expect(horaComDia(T0 + 60 * MIN, T0)).toBe("17h30");
  });

  it("marcasDeHora: uma por hora cheia dentro do eixo, na posição certa", () => {
    const m = marcasDeHora(T0, 150);
    expect(m.map((x) => x.rotulo)).toEqual(["17h", "18h", "19h"]);
    expect(m.map((x) => x.minuto)).toEqual([30, 90, 150]);
  });

  it("somarEmBlocos soma, e o último bloco pode ser menor", () => {
    expect(somarEmBlocos([1, 2, 3, 4, 5], 2)).toEqual([3, 7, 5]);
  });

  it("degrausPorMinuto mantém o último valor e é null antes do primeiro ponto", () => {
    const s = degrausPorMinuto(
      [
        { ms: T0 + 2 * MIN + 10, valor: 10 },
        { ms: T0 + 4 * MIN, valor: 30 },
      ],
      T0,
      6,
    );
    expect(s).toEqual([null, null, 10, 10, 30, 30]);
  });

  it("escalaBonita dá um topo redondo acima do máximo", () => {
    expect(escalaBonita(133)).toEqual({ yMax: 150, marcas: [0, 50, 100, 150] });
    expect(escalaBonita(158)).toEqual({ yMax: 200, marcas: [0, 100, 200] });
    expect(escalaBonita(0)).toEqual({ yMax: 1, marcas: [0, 1] });
    for (const x of [1, 7, 42, 999, 1206, 3278]) {
      const e = escalaBonita(x);
      expect(e.yMax).toBeGreaterThanOrEqual(x);
      expect(e.marcas.at(-1)).toBe(e.yMax);
    }
  });
});

const cicloBase: CicloPainel = {
  inicio: "2026-10-04T18:00:00-03:00",
  fim: "2026-10-04T18:04:00-03:00",
  cargo: 1,
  fatia: null,
  duracaoS: 240,
  pedidos: 6000,
  novidades: 10,
  inalterados: 5990,
  naoEncontrados: 0,
  erros: 0,
  bloqueios: 0,
  esperaS: 230,
  modeloAcionado: true,
  abortado: null,
};

describe("filtro e problemas da tabela de coletas", () => {
  it("cicloTemProblema: cada sinal sozinho basta; um ciclo limpo não tem problema", () => {
    expect(cicloTemProblema(cicloBase)).toBe(false);
    expect(cicloTemProblema({ ...cicloBase, fim: null })).toBe(true);
    expect(cicloTemProblema({ ...cicloBase, erros: 1 })).toBe(true);
    expect(cicloTemProblema({ ...cicloBase, bloqueios: 1 })).toBe(true);
    expect(cicloTemProblema({ ...cicloBase, naoEncontrados: 1 })).toBe(true);
    expect(cicloTemProblema({ ...cicloBase, abortado: "janela" })).toBe(true);
    expect(cicloTemProblema({ ...cicloBase, duracaoS: 300 })).toBe(false);
    expect(cicloTemProblema({ ...cicloBase, duracaoS: 300.1 })).toBe(true);
  });

  it("lerFiltroCiclos: padrão é só problemas; ?so=todas mostra tudo; cargo inválido é ignorado", () => {
    expect(lerFiltroCiclos({})).toEqual({ cargo: null, soProblemas: true });
    expect(lerFiltroCiclos({ so: "todas", cargo: "3" })).toEqual({ cargo: 3, soProblemas: false });
    expect(lerFiltroCiclos({ cargo: "2" }).cargo).toBeNull();
    expect(lerFiltroCiclos({ cargo: ["5", "1"] }).cargo).toBe(5);
  });

  it("filtrarCiclos combina cargo e problema", () => {
    const lista = [
      cicloBase,
      { ...cicloBase, cargo: 3 as const, erros: 2 },
      { ...cicloBase, erros: 9 },
    ];
    expect(filtrarCiclos(lista, { cargo: null, soProblemas: false })).toHaveLength(3);
    expect(filtrarCiclos(lista, { cargo: 1, soProblemas: false })).toHaveLength(2);
    expect(filtrarCiclos(lista, { cargo: 1, soProblemas: true })).toHaveLength(1);
  });
});

describe("ocorrenciasDaNoite", () => {
  const nomes = {
    1: "Presidente",
    3: "Governador",
    5: "Senador",
    6: "Deputado Federal",
    7: "Deputado Estadual",
    8: "Deputado Distrital",
  } as const;
  const notas = (o: Record<string, unknown>) =>
    JSON.stringify({ turno: 1, env: "production", ...o });
  const r = montarRetrato({
    deMs: T0,
    ateMs: T0 + 120 * MIN,
    turno: 1,
    ambiente: "production",
    geradoEmMs: T0,
    nomes,
    ingest: [
      // coleta do Presidente que começou e não terminou
      {
        tsMs: T0 + 5 * MIN,
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: notas({ running: true, cargo: 1 }),
      },
      // coleta do Governador com 158 erros e bloqueio
      {
        tsMs: T0 + 30 * MIN,
        durationMs: 4 * MIN,
        filesFetched: 6133,
        filesChanged: 10,
        errors: 158,
        notes: notas({ running: false, cargo: 3, rateLimited: 1206, model_triggered: [3] }),
      },
      // coleta do Senador que pediu projeção aos 15 min — nenhuma rodada saiu
      {
        tsMs: T0 + 15 * MIN,
        durationMs: 4 * MIN,
        filesFetched: 6133,
        filesChanged: 5,
        errors: 0,
        notes: notas({ running: false, cargo: 5, model_triggered: [5] }),
      },
    ],
    novidades: [],
    rodadas: [
      // Senador: buraco de 30 min com um acionamento sem resposta → falha
      { cargo: 5, tsMs: T0, dadoTsMs: null },
      { cargo: 5, tsMs: T0 + 30 * MIN, dadoTsMs: null },
      // Presidente: buraco de 20 min sem ninguém pedir → NÃO é ocorrência
      { cargo: 1, tsMs: T0 + 40 * MIN, dadoTsMs: null },
      { cargo: 1, tsMs: T0 + 60 * MIN, dadoTsMs: null },
    ],
    agregadosPresidente: [],
    ultimasVersoes: [
      {
        tsMs: T0 + 90 * MIN,
        cargo: 1,
        nivel: "zona",
        uf: "MG",
        codMunicipioTse: 1,
        codZona: 72,
        st: "38",
        tot: "41",
        municipio: "A",
      },
      {
        tsMs: T0 + 95 * MIN,
        cargo: 1,
        nivel: "zona",
        uf: "BA",
        codMunicipioTse: 2,
        codZona: 9,
        st: "1",
        tot: "4",
        municipio: "B",
      },
    ],
    commits: [],
    gitRef: "origin/main",
    correcoesDeMs: T0,
    correcoesAteMs: T0 + 120 * MIN,
  });
  const o = ocorrenciasDaNoite(r);

  it("lista projeção parada por falha, coleta interrompida, bloqueio, erros e arquivos parados — em ordem", () => {
    const textos = o.map((x) => x.texto);
    expect(
      textos.some((t) =>
        t.startsWith("Projeção de Senador parada por 30 min: o modelo foi chamado 1 vez"),
      ),
    ).toBe(true);
    expect(textos.some((t) => t.includes("Presidente começou e não terminou"))).toBe(true);
    expect(textos.some((t) => t.includes("1.206 pedidos"))).toBe(true);
    expect(textos.some((t) => t.includes("158 erros"))).toBe(true);
    expect(textos.some((t) => t.startsWith("2 arquivos de Presidente pararam"))).toBe(true);
    const ms = o.map((x) => x.ms);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });

  it("buraco da projeção SEM NOVIDADE não vira ocorrência", () => {
    expect(r.buracosProjecao.find((b) => b.cargo === 1)?.tipo).toBe("sem-novidade");
    expect(o.some((x) => x.texto.startsWith("Projeção de Presidente"))).toBe(false);
  });
});
