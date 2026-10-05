/**
 * tests/unit/painel/agregar.test.ts
 *
 * A lógica do retrato do painel privado (ADR-0077) — `lib/painel/agregar.ts`.
 * Tudo sobre dados sintéticos; nenhum teste toca banco.
 *
 * Os casos são escolhidos para DISCRIMINAR (memória do projeto: "teste que não
 * discrimina"): cada um tem um vizinho que passaria com o código errado —
 * limiar exatamente no limite, ciclos sobrepostos que um pareamento por ordem
 * erraria, bloqueio relatado em dobro pelo mesmo processo.
 */

import { describe, expect, it } from "vitest";

import {
  agruparBloqueios,
  type CicloBruto,
  detectarArquivosParados,
  detectarBuracosCiclos,
  detectarBuracosProjecao,
  espalharPorMinuto,
  isoBrt,
  type LinhaIngestLog,
  mediana,
  montarRetrato,
  numeroTse,
  parearCiclos,
  serieApuradoPresidente,
} from "@/lib/painel/agregar";

const T0 = Date.parse("2026-10-04T19:30:00Z"); // 16h30 BRT
const MIN = 60_000;

function inicio(tsMs: number, cargo: number, extra: Record<string, unknown> = {}): LinhaIngestLog {
  return {
    tsMs,
    durationMs: 0,
    filesFetched: 0,
    filesChanged: 0,
    errors: 0,
    notes: JSON.stringify({ running: true, turno: 1, env: "production", cargo, ...extra }),
  };
}

function fim(
  tsMs: number,
  cargo: number,
  durMs: number,
  extra: Record<string, unknown> = {},
  metricas: Partial<LinhaIngestLog> = {},
): LinhaIngestLog {
  return {
    tsMs,
    durationMs: durMs,
    filesFetched: 6000,
    filesChanged: 100,
    errors: 0,
    ...metricas,
    notes: JSON.stringify({
      running: false,
      turno: 1,
      env: "production",
      cargo,
      unchanged: 5900,
      not_found: 0,
      rateLimited: 0,
      waitedMs: 1000,
      ...extra,
    }),
  };
}

describe("isoBrt", () => {
  it("escreve em BRT com o deslocamento explícito", () => {
    expect(isoBrt(Date.parse("2026-10-04T22:07:12.900Z"))).toBe("2026-10-04T19:07:12-03:00");
    // e atravessa a meia-noite no dia certo
    expect(isoBrt(Date.parse("2026-10-05T03:51:00Z"))).toBe("2026-10-05T00:51:00-03:00");
  });
});

describe("espalharPorMinuto", () => {
  it("divide o total na proporção do tempo em cada minuto e preserva a soma", () => {
    const acc = new Array<number>(10).fill(0);
    // de 0:30 a 3:30 → meio minuto, 2 minutos cheios, meio minuto
    const dentro = espalharPorMinuto(acc, T0, T0 + 30_000, T0 + 3 * MIN + 30_000, 600);
    expect(acc.slice(0, 5)).toEqual([100, 200, 200, 100, 0]);
    expect(dentro).toBeCloseTo(600);
  });

  it("duração zero põe tudo no minuto do fim (não divide por zero)", () => {
    const acc = new Array<number>(5).fill(0);
    espalharPorMinuto(acc, T0, T0 + 2 * MIN + 5, T0 + 2 * MIN + 5, 7);
    expect(acc).toEqual([0, 0, 7, 0, 0]);
  });

  it("descarta o pedaço fora do eixo", () => {
    const acc = new Array<number>(2).fill(0);
    const dentro = espalharPorMinuto(acc, T0, T0 - MIN, T0 + MIN, 100);
    expect(acc).toEqual([50, 0]);
    expect(dentro).toBeCloseTo(50);
  });
});

describe("parearCiclos", () => {
  it("pareia pela duração, não pela ordem — ciclos sobrepostos não viram 'interrompidos'", () => {
    // A começa em 0 e dura 7 min; B começa em 5 e dura 4 min. Em ordem de
    // tempo: início A, início B, fim A (7), fim B (9). Parear por ordem
    // marcaria A como interrompido e daria a B o fim de A.
    const linhas = [
      inicio(T0, 1),
      inicio(T0 + 5 * MIN, 1),
      fim(T0 + 7 * MIN, 1, 7 * MIN),
      fim(T0 + 9 * MIN, 1, 4 * MIN),
    ];
    const { ciclos } = parearCiclos(linhas, { turno: 1, ambiente: "production" });
    expect(ciclos).toHaveLength(2);
    expect(ciclos.every((c) => c.fimMs !== null)).toBe(true);
    expect(ciclos.map((c) => c.inicioMs)).toEqual([T0, T0 + 5 * MIN]);
  });

  it("marcador sem fim vira ciclo interrompido, com métricas nulas (nunca zero)", () => {
    const linhas = [inicio(T0, 3), inicio(T0 + 5 * MIN, 3), fim(T0 + 9 * MIN, 3, 4 * MIN)];
    const { ciclos } = parearCiclos(linhas, { turno: 1, ambiente: "production" });
    const interrompidos = ciclos.filter((c) => c.fimMs === null);
    expect(interrompidos).toHaveLength(1);
    expect(interrompidos[0]).toMatchObject({ inicioMs: T0, pedidos: null, erros: null });
  });

  it("fatias são sequências separadas", () => {
    const linhas = [
      inicio(T0, 6, { fatia: 1 }),
      inicio(T0 + 1000, 6, { fatia: 2 }),
      fim(T0 + 4 * MIN, 6, 4 * MIN, { fatia: 1 }),
      fim(T0 + 4 * MIN + 1000, 6, 4 * MIN, { fatia: 2 }),
    ];
    const { ciclos } = parearCiclos(linhas, { turno: 1, ambiente: "production" });
    expect(ciclos.map((c) => c.fatia).sort()).toEqual([1, 2]);
    expect(ciclos.every((c) => c.fimMs !== null)).toBe(true);
  });

  it("ignora notes ilegível, outro turno, outro ambiente e cargo fora dos seis", () => {
    const linhas: LinhaIngestLog[] = [
      { ...fim(T0, 1, 1000), notes: "não é json" },
      fim(T0, 1, 1000, { turno: 2 }),
      fim(T0, 1, 1000, { env: "preview" }),
      fim(T0, 2, 1000),
      fim(T0, 1, 1000),
    ];
    const { ciclos, ignoradas } = parearCiclos(linhas, { turno: 1, ambiente: "production" });
    expect(ignoradas).toBe(4);
    expect(ciclos).toHaveLength(1);
  });

  it("lê as métricas das notas e o modelo acionado só para o próprio cargo", () => {
    const { ciclos } = parearCiclos(
      [
        fim(T0 + 4 * MIN, 1, 4 * MIN, {
          not_found: 3,
          rateLimited: 9,
          waitedMs: 2500,
          model_triggered: [1],
        }),
        fim(T0 + 4 * MIN, 3, 4 * MIN, { model_triggered: [1] }),
      ],
      { turno: 1, ambiente: "production" },
    );
    const pres = ciclos.find((c) => c.cargo === 1) as CicloBruto;
    const gov = ciclos.find((c) => c.cargo === 3) as CicloBruto;
    expect(pres).toMatchObject({
      naoEncontrados: 3,
      bloqueios: 9,
      esperaMs: 2500,
      modeloAcionado: true,
    });
    expect(gov.modeloAcionado).toBe(false);
  });
});

describe("detectarBuracosProjecao", () => {
  const rodadas = (cargo: 1 | 3 | 5, minutos: number[]) =>
    minutos.map((m) => ({ cargo, tsMs: T0 + m * MIN }));

  it("limiar estrito: 10 min exatos não é buraco; 10 min e 1 s é", () => {
    const r = [...rodadas(1, [0, 10]), ...rodadas(3, [0])];
    r.push({ cargo: 3, tsMs: T0 + 10 * MIN + 1000 });
    const b = detectarBuracosProjecao(r, []);
    expect(b.map((x) => x.cargo)).toEqual([3]);
  });

  it("classifica FALHA quando o modelo foi chamado e não gravou, e SEM NOVIDADE quando ninguém chamou", () => {
    const r = [...rodadas(1, [0, 30]), ...rodadas(5, [0, 30])];
    // Presidente: 5 acionamentos dentro do buraco, nenhum com rodada perto.
    // O acionamento a 2 s da rodada final é o que a PRODUZIU e não conta.
    const acion = [5, 10, 15, 20, 25].map((m) => ({ cargo: 1 as const, tsMs: T0 + m * MIN }));
    acion.push({ cargo: 1, tsMs: T0 + 30 * MIN - 2000 });
    const b = detectarBuracosProjecao(r, acion);
    const pres = b.find((x) => x.cargo === 1);
    const sen = b.find((x) => x.cargo === 5);
    expect(pres).toMatchObject({ tipo: "falha", acionamentos: 5, acionamentosSemRodada: 5 });
    expect(sen).toMatchObject({ tipo: "sem-novidade", acionamentos: 0 });
  });

  it("acionamento cuja rodada saiu (mesmo atrasada até 4 min) não é falha", () => {
    // Buraco de 0 a 13 min; o acionamento aos 10 min foi respondido pela
    // rodada dos 13 min (3 min depois) — conta como acionamento, não como falha.
    const r = rodadas(3, [0, 13]);
    const b = detectarBuracosProjecao(r, [{ cargo: 3, tsMs: T0 + 10 * MIN }]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ tipo: "sem-novidade", acionamentos: 1, acionamentosSemRodada: 0 });
  });

  it("não há buraco antes da primeira nem depois da última rodada", () => {
    expect(detectarBuracosProjecao(rodadas(1, [100]), [])).toEqual([]);
  });
});

describe("detectarBuracosCiclos", () => {
  const ciclo = (fimMin: number, fatia: number | null = null): CicloBruto => ({
    inicioMs: T0 + (fimMin - 4) * MIN,
    fimMs: T0 + fimMin * MIN,
    cargo: 6,
    fatia,
    duracaoMs: 4 * MIN,
    pedidos: 1000,
    novidades: 1,
    inalterados: 999,
    naoEncontrados: 0,
    erros: 0,
    bloqueios: 0,
    esperaMs: 0,
    modeloAcionado: false,
    abortado: null,
  });

  it("mais que o dobro da mediana (com 1 min de folga) é buraco", () => {
    const b = detectarBuracosCiclos([0, 15, 30, 45, 87, 102].map((m) => ciclo(m, 3)));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ fatia: 3, minutos: 42, medianaMinutos: 15 });
  });

  it("o dobro exato da mediana (troca de cadência, relógio) NÃO é buraco", () => {
    expect(detectarBuracosCiclos([0, 15, 30, 60, 75].map((m) => ciclo(m)))).toEqual([]);
  });

  it("sequência com menos de 3 ciclos não gera buraco", () => {
    expect(detectarBuracosCiclos([ciclo(0), ciclo(90)])).toEqual([]);
  });
});

describe("agruparBloqueios", () => {
  const base = {
    novidades: 0,
    inalterados: 0,
    naoEncontrados: 0,
    erros: 0,
    esperaMs: 0,
    modeloAcionado: false,
    abortado: null,
    pedidos: 6000,
    fatia: null,
  };
  it("ciclos sobrepostos viram UM episódio com a faixa [maior, soma]", () => {
    const ciclos: CicloBruto[] = [
      {
        ...base,
        cargo: 6,
        fatia: 6,
        inicioMs: T0,
        fimMs: T0 + 4 * MIN,
        duracaoMs: 4 * MIN,
        bloqueios: 1206,
      },
      {
        ...base,
        cargo: 3,
        inicioMs: T0 + MIN,
        fimMs: T0 + 5 * MIN,
        duracaoMs: 4 * MIN,
        bloqueios: 1206,
      },
      {
        ...base,
        cargo: 1,
        inicioMs: T0 + 30 * MIN,
        fimMs: T0 + 34 * MIN,
        duracaoMs: 4 * MIN,
        bloqueios: 3,
      },
    ];
    const e = agruparBloqueios(ciclos);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ minimo: 1206, maximo: 2412 });
    expect(e[0]?.ciclos).toHaveLength(2);
    expect(e[1]).toMatchObject({ minimo: 3, maximo: 3 });
  });
});

describe("serieApuradoPresidente", () => {
  it("soma as UFs, usa o total do arquivo Brasil no denominador e nunca lê psa", () => {
    const m = (min: number) => T0 + min * MIN;
    const s = serieApuradoPresidente([
      { tsMs: m(1), uf: "SP", nivel: "uf", st: "50", tot: "100" },
      // antes do Brasil chegar, o denominador é a soma das UFs que já vieram
      { tsMs: m(2), uf: "BR", nivel: "br", st: "10", tot: "400" },
      { tsMs: m(3), uf: "rj", nivel: "uf", st: "100", tot: "100" },
      // nova versão de SP substitui a anterior (não soma de novo)
      { tsMs: m(4), uf: "SP", nivel: "uf", st: "100", tot: "100" },
    ]);
    expect(s.somaDosEstados.map((p) => p.pct)).toEqual([50, 12.5, 37.5, 50]);
    expect(s.arquivoBrasil).toEqual([{ tsMs: m(2), pct: 2.5 }]);
  });

  it("um ponto por minuto: o último valor do minuto vence", () => {
    const s = serieApuradoPresidente([
      { tsMs: T0 + 1000, uf: "AC", nivel: "uf", st: "1", tot: "10" },
      { tsMs: T0 + 2000, uf: "AC", nivel: "uf", st: "5", tot: "10" },
    ]);
    expect(s.somaDosEstados).toEqual([{ tsMs: T0, pct: 50 }]);
  });
});

describe("detectarArquivosParados", () => {
  it("só entra arquivo cuja última versão ficou abaixo do total de seções", () => {
    const v = (st: string, tot: string, cargo = 1) => ({
      tsMs: T0,
      cargo,
      nivel: "zona",
      uf: "mg",
      codMunicipioTse: 41556,
      codZona: 72,
      st,
      tot,
      municipio: "Bom Jesus do Galho",
    });
    const p = detectarArquivosParados([
      v("38", "41"),
      v("41", "41"),
      v("0", "0"),
      v("x", "4"),
      v("1", "2", 2),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ uf: "MG", secoesTotalizadas: 38, secoesTotal: 41, zona: 72 });
  });
});

describe("numeroTse e mediana", () => {
  it("numeroTse lê vírgula decimal e rejeita lixo", () => {
    expect(numeroTse("12,5")).toBe(12.5);
    expect(numeroTse("472075")).toBe(472075);
    expect(numeroTse(null)).toBeNull();
    expect(numeroTse("abc")).toBeNull();
  });
  it("mediana par e ímpar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe("montarRetrato", () => {
  const nomes = {
    1: "Presidente",
    3: "Governador",
    5: "Senador",
    6: "Deputado Federal",
    7: "Deputado Estadual",
    8: "Deputado Distrital",
  } as const;

  const retrato = montarRetrato({
    deMs: T0,
    ateMs: T0 + 60 * MIN,
    turno: 1,
    ambiente: "production",
    geradoEmMs: T0 + 24 * 60 * MIN,
    nomes,
    ingest: [inicio(T0 + 5 * MIN, 1), fim(T0 + 9 * MIN, 1, 4 * MIN, { model_triggered: [1] })],
    novidades: [
      { minutoMs: T0 + 6 * MIN, cargo: 1, n: 40 },
      { minutoMs: T0 + 6 * MIN, cargo: 3, n: 2 },
      { minutoMs: T0 + 6 * MIN, cargo: 99, n: 1000 },
    ],
    rodadas: [{ cargo: 1, tsMs: T0 + 9 * MIN + 2000, dadoTsMs: null }],
    agregadosPresidente: [],
    ultimasVersoes: [],
    commits: [
      { hash: "aaaaaaa", tsMs: T0 + 10 * MIN, titulo: "fix: dentro" },
      { hash: "bbbbbbb", tsMs: T0 - 10 * MIN, titulo: "fix: fora" },
    ],
    gitRef: "origin/main",
    correcoesDeMs: T0,
    correcoesAteMs: T0 + 60 * MIN,
  });

  it("toda série por minuto tem o tamanho do eixo, para os seis cargos", () => {
    expect(retrato.eixo).toEqual({ inicio: "2026-10-04T16:30:00-03:00", minutos: 60 });
    for (const serie of Object.values(retrato.porMinuto)) {
      expect(Object.keys(serie).sort()).toEqual(["1", "3", "5", "6", "7", "8"]);
      for (const v of Object.values(serie)) expect(v).toHaveLength(60);
    }
  });

  it("pedidos estimados somam o total do ciclo; contagens caem no minuto do fim", () => {
    const pedidos = retrato.porMinuto.pedidosEstimados["1"];
    expect(pedidos.reduce((a, b) => a + b, 0)).toBe(6000);
    expect(pedidos.slice(5, 9)).toEqual([1500, 1500, 1500, 1500]);
    expect(retrato.porMinuto.ciclosConcluidos["1"][9]).toBe(1);
    expect(retrato.porMinuto.novidades["1"][6]).toBe(40);
    expect(retrato.porMinuto.rodadasProjecao["1"][9]).toBe(1);
  });

  it("totais por cargo, cargo desconhecido ignorado e correções só da janela", () => {
    const pres = retrato.totais.find((t) => t.cargo === 1);
    expect(pres).toMatchObject({ ciclos: 1, pedidos: 6000, novidades: 40, rodadas: 1 });
    expect(retrato.totais.find((t) => t.cargo === 6)?.rodadas).toBeNull();
    expect(retrato.totais.reduce((a, t) => a + t.novidades, 0)).toBe(42);
    expect(retrato.correcoes.map((c) => c.hash)).toEqual(["aaaaaaa"]);
    expect(retrato.geradoEm).toBe("2026-10-05T16:30:00-03:00");
  });
});
