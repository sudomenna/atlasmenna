/**
 * tests/unit/painel/corrida.test.ts
 *
 * A corrida do Presidente em alta resolução (`lib/painel/corrida.ts`, pedido
 * do dono em 06/10/2026): a soma pela versão MAIS RECENTE de cada UF, a
 * projeção vigente num instante, a conferência com o modelo, os caminhos do
 * desenho e as funções de quadro do vídeo. Tudo sobre dados sintéticos.
 */

import { describe, expect, it } from "vitest";

import { montarCorrida } from "@/lib/painel/agregar";
import {
  caminhoDaFaixa,
  caminhoDePontos,
  caminhoEmDegraus,
  conferirComModelo,
  dominioY,
  escolherFormato,
  estadoNoInstante,
  instanteDoQuadro,
  instanteDoQuadroDoVideo,
  janelaDoVideo,
  nomeDoArquivoDoVideo,
  proximoInstante,
  type RodadaCorrida,
  segundosAteHoraBrt,
  serieCorrida,
  trocasDeLideranca,
  ultimoAte,
  type VersaoCorrida,
  VIDEO_FPS,
  VIDEO_QUADROS_PARADOS,
  VIDEO_SEGUNDOS_TOTAL,
  VIDEO_TOTAL_QUADROS,
} from "@/lib/painel/corrida";

const T0 = Date.parse("2026-10-04T20:24:00Z");
const S = 1000;

function uf(
  tsMs: number,
  sigla: string,
  votosA: number,
  votosB: number,
  vv: number,
  st = 1,
  tot = 10,
): VersaoCorrida {
  return {
    tsMs,
    uf: sigla,
    nivel: "uf",
    st: String(st),
    tot: String(tot),
    vv: String(vv),
    votos: [String(votosA), String(votosB)],
  };
}

describe("serieCorrida — soma pela versão mais recente de cada UF", () => {
  it("substitui a versão anterior da MESMA UF em vez de somar de novo", () => {
    const serie = serieCorrida(
      [
        uf(T0, "SP", 40, 60, 100),
        uf(T0 + S, "RJ", 50, 50, 100),
        // nova versão de SP: 400/600 de 1000 — a de 40/60 sai da conta
        uf(T0 + 2 * S, "SP", 400, 600, 1000),
      ],
      2,
    );
    expect(serie).toHaveLength(3);
    expect(serie[0]?.pct).toEqual([40, 60]);
    expect(serie[1]?.pct).toEqual([45, 55]);
    // (400 + 50) / (1000 + 100) e (600 + 50) / 1100
    expect(serie[2]?.pct[0]).toBeCloseTo((100 * 450) / 1100, 9);
    expect(serie[2]?.pct[1]).toBeCloseTo((100 * 650) / 1100, 9);
    expect(serie[2]?.votos).toEqual([450, 650]);
  });

  it("o arquivo `br` só entra no denominador do % apurado, nunca na soma de votos", () => {
    const serie = serieCorrida(
      [
        uf(T0, "SP", 40, 60, 100, 5, 10),
        {
          tsMs: T0 + S,
          uf: "BR",
          nivel: "br",
          st: "5",
          tot: "40",
          vv: "999999",
          votos: ["999", "1"],
        },
        uf(T0 + 2 * S, "RJ", 10, 10, 20, 2, 10),
      ],
      2,
    );
    expect(serie).toHaveLength(2); // o `br` não gera ponto
    expect(serie[0]?.apurado).toBe(50); // 5/10
    expect(serie[1]?.votos).toEqual([50, 70]);
    expect(serie[1]?.apurado).toBe(17.5); // (5+2) / max(20, 40)
  });

  it("sem voto válido ainda, não há ponto (nada de 0% inventado); versão ilegível é ignorada", () => {
    const serie = serieCorrida(
      [
        uf(T0, "AM", 0, 0, 0),
        { ...uf(T0 + S, "MG", 1, 1, 2), votos: ["1", null] },
        uf(T0 + 2 * S, "AC", 3, 1, 4),
      ],
      2,
    );
    expect(serie).toHaveLength(1);
    expect(serie[0]?.pct).toEqual([75, 25]);
  });

  it("um ponto por chegada, mesmo várias no mesmo segundo (a rajada da coleta)", () => {
    const serie = serieCorrida(
      [uf(T0, "SP", 1, 1, 2), uf(T0 + 10, "RJ", 1, 1, 2), uf(T0 + 20, "MG", 1, 1, 2)],
      2,
    );
    expect(serie).toHaveLength(3);
  });
});

describe("ultimoAte — o vigente no instante t", () => {
  const ts = [10, 20, 30];
  it.each([
    [5, -1],
    [10, 0],
    [19, 0],
    [20, 1],
    [29.9, 1],
    [30, 2],
    [999, 2],
  ])("t=%s → %s", (t, i) => {
    expect(ultimoAte(ts, t)).toBe(i);
  });
  it("lista vazia → −1", () => {
    expect(ultimoAte([], 5)).toBe(-1);
  });
});

describe("estadoNoInstante — a projeção vigente é a da última rodada ≤ t, sem interpolar", () => {
  const apuracao = {
    t: [100, 200],
    pct: [
      [40, 42],
      [60, 58],
    ],
    votos: [
      [4, 42],
      [6, 58],
    ],
    apurado: [1, 2],
  };
  const projecao = {
    t: [150, 300],
    pct: [
      [45, 46],
      [55, 54],
    ],
  };
  it("antes de tudo: nada", () => {
    const e = estadoNoInstante(apuracao, projecao, 50);
    expect(e).toMatchObject({
      iApuracao: -1,
      iProjecao: -1,
      apurado: null,
      pct: [null, null],
      projecao: [null, null],
    });
  });
  it("entre duas rodadas vale a anterior (299 → rodada das 150)", () => {
    const e = estadoNoInstante(apuracao, projecao, 299);
    expect(e.projecao).toEqual([45, 55]);
    expect(e.pct).toEqual([42, 58]);
    expect(e.apurado).toBe(2);
  });
  it("no segundo exato da rodada, ela já vale", () => {
    expect(estadoNoInstante(apuracao, projecao, 300).projecao).toEqual([46, 54]);
  });
});

describe("conferirComModelo", () => {
  const serie = serieCorrida([uf(T0, "SP", 40, 60, 100), uf(T0 + 60 * S, "SP", 41, 59, 100)], 2);
  const rodada = (
    tsMs: number,
    dadoTsMs: number | null,
    pctAtual: (number | null)[],
  ): RodadaCorrida => ({
    tsMs,
    dadoTsMs,
    pct: [null, null],
    lo: [null, null],
    hi: [null, null],
    pVitoria: [null, null],
    pctAtual,
    votosAtuais: [null, null],
  });
  it("compara no horário do BOLETIM que o modelo usou, e devolve a maior diferença", () => {
    // rodou às T0+90s com o boletim de T0+30s: compara com o ponto de T0 (40/60)
    const c = conferirComModelo(serie, [rodada(T0 + 90 * S, T0 + 30 * S, [40.2, 59.8])]);
    expect(c.instantes).toBe(1);
    expect(c.difMaxPp).toBeCloseTo(0.2, 6);
    // pela hora da rodada (sem boletim), compara com o ponto de T0+60 (41/59)
    const d = conferirComModelo(serie, [rodada(T0 + 90 * S, null, [40.2, 59.8])]);
    expect(d.difMaxPp).toBeCloseTo(0.8, 6);
  });
  it("rodada antes do primeiro ponto não conta", () => {
    expect(conferirComModelo(serie, [rodada(T0 - S, null, [1, 2])]).instantes).toBe(0);
  });
});

describe("trocasDeLideranca", () => {
  it("marca cada troca, ignora empate exato", () => {
    const serie = serieCorrida(
      [uf(T0, "SP", 60, 40, 100), uf(T0 + S, "RJ", 0, 20, 20), uf(T0 + 2 * S, "MG", 0, 40, 40)],
      2,
    );
    // 60/40 → 60/60 (empate, não conta) → 60/100 (troca para o 2º)
    expect(trocasDeLideranca(serie).map((t) => t.lider)).toEqual([1]);
  });
});

describe("caminhos do desenho (x = segundos, y = −%)", () => {
  it("degrau: o valor vale até o próximo instante; null interrompe", () => {
    expect(caminhoEmDegraus([0, 10, 20], [40, 41, null], 30)).toBe("M0 -40H10V-41H20");
    expect(caminhoEmDegraus([0, 10], [40, 41], 30)).toBe("M0 -40H10V-41H30");
  });
  it("pontos: um traço de comprimento zero por valor", () => {
    expect(caminhoDePontos([0, 10], [40, null])).toBe("M0 -40h0");
  });
  it("faixa: borda de cima ida, de baixo volta, fechada", () => {
    expect(caminhoDaFaixa([0, 10], [39, 40], [41, 42], 20)).toBe("M0 -41H10V-42H20V-40H10V-39H0Z");
  });
});

describe("dominioY", () => {
  const series = [{ t: [0, 10, 100, 200], v: [10, 90, 45, 47] }];
  it("ignora a rajada inicial e dá folga com marcas redondas", () => {
    const d = dominioY(series, 0, 300, 50);
    expect(d.min).toBeLessThan(45);
    expect(d.max).toBeGreaterThan(47);
    expect(d.max - d.min).toBeLessThan(5);
    expect(d.marcas[0]).toBe(d.min);
    expect(d.marcas.at(-1)).toBe(d.max);
  });
  it("sem a regra da rajada, a escala explode (o teste discrimina)", () => {
    const d = dominioY(series, 0, 300, 0);
    expect(d.max - d.min).toBeGreaterThan(70);
  });
  it("respeita a janela: só o que está à vista (e o degrau vigente no início)", () => {
    const d = dominioY([{ t: [0, 100, 200], v: [40, 50, 60] }], 150, 160, -1);
    // vigente em 150 é o 50; o 60 (t=200) está fora
    expect(d.max).toBeLessThan(55);
  });
});

describe("teclado e quadros do vídeo", () => {
  it("proximoInstante: do vazio vai ao início; End vai ao fim; limita à janela", () => {
    expect(proximoInstante(null, "ArrowRight", false, 100, 1000)).toBe(100);
    expect(proximoInstante(null, "End", false, 100, 1000)).toBe(1000);
    expect(proximoInstante(200, "ArrowRight", false, 100, 1000)).toBe(260);
    expect(proximoInstante(200, "ArrowRight", true, 100, 1000)).toBe(800);
    expect(proximoInstante(200, "PageDown", false, 100, 1000)).toBe(100);
    expect(proximoInstante(200, "Tab", false, 100, 1000)).toBeUndefined();
  });
  it("instanteDoQuadro: começa em tIni, chega a tFim no último quadro animado e congela", () => {
    const n = 420;
    const parados = 60;
    expect(instanteDoQuadro(0, n, parados, 1000, 2000)).toBe(1000);
    expect(instanteDoQuadro(n - parados - 1, n, parados, 1000, 2000)).toBe(2000);
    expect(instanteDoQuadro(n - 1, n, parados, 1000, 2000)).toBe(2000);
    expect(instanteDoQuadro(179, n, parados, 1000, 2000)).toBeCloseTo(1000 + (1000 * 179) / 359, 6);
  });
  it("escolherFormato prefere MP4 e cai para WebM; nada suportado → null", () => {
    expect(escolherFormato(() => true)).toMatch(/^video\/mp4/);
    expect(escolherFormato((f) => f.startsWith("video/webm"))).toMatch(/^video\/webm/);
    expect(escolherFormato(() => false)).toBeNull();
  });
  it("nomes de arquivo claros, um por gráfico", () => {
    expect(nomeDoArquivoDoVideo("apuracao", "mp4")).toBe("atlasmenna-presidente-1t-apuracao.mp4");
    expect(nomeDoArquivoDoVideo("projecao", "mp4")).toBe("atlasmenna-presidente-1t-projecao.mp4");
    expect(nomeDoArquivoDoVideo("ambos", "webm")).toBe(
      "atlasmenna-presidente-1t-apuracao-e-projecao.webm",
    );
  });
});

describe("vídeo: janela 17h22–23h00 e 15 s (2 parados) — constantes num lugar só", () => {
  // o eixo do retrato começa às 16h30 BRT de 04/10
  const inicioEixo = Date.parse("2026-10-04T16:30:00-03:00");
  const brt = (seg: number) =>
    new Date(inicioEixo + seg * 1000 - 3 * 3_600_000).toISOString().slice(11, 19);
  const apuracao = {
    t: [55 * 60, 120 * 60, 500 * 60],
    pct: [
      [42, 41, 45],
      [50, 51, 47],
    ],
    votos: [
      [1, 2, 3],
      [1, 2, 3],
    ],
    apurado: [2, 40, 100],
  };
  const projecao = {
    t: [60 * 60, 300 * 60],
    pct: [
      [44, 45],
      [48, 47],
    ],
  };

  it("as constantes: 15 s a 30 fps, os 2 últimos parados", () => {
    expect(VIDEO_SEGUNDOS_TOTAL).toBe(15);
    expect(VIDEO_FPS).toBe(30);
    expect(VIDEO_TOTAL_QUADROS).toBe(450);
    expect(VIDEO_QUADROS_PARADOS).toBe(60);
  });

  it("janela: 17h22 e 23h00 BRT, em segundos desde o início do eixo", () => {
    const { tIni, tFim } = janelaDoVideo(inicioEixo);
    expect(brt(tIni)).toBe("17:22:00");
    expect(brt(tFim)).toBe("23:00:00");
    expect(tIni).toBe(52 * 60);
    expect(tFim).toBe(390 * 60);
    // hora já passada no dia cai no dia seguinte
    expect(segundosAteHoraBrt(inicioEixo, 3)).toBe((10 * 60 + 30) * 60);
  });

  it("o 1º quadro é 17h22 e nada apareceu ainda; a apuração começa depois", () => {
    const t = instanteDoQuadroDoVideo(0, inicioEixo);
    expect(brt(t)).toBe("17:22:00");
    expect(estadoNoInstante(apuracao, projecao, t)).toMatchObject({ iApuracao: -1, iProjecao: -1 });
  });

  it("o último quadro animado é 23h00, e os 2 s finais ficam parados nele", () => {
    const ultimoAnimado = VIDEO_TOTAL_QUADROS - VIDEO_QUADROS_PARADOS - 1;
    expect(brt(instanteDoQuadroDoVideo(ultimoAnimado, inicioEixo))).toBe("23:00:00");
    const final = instanteDoQuadroDoVideo(VIDEO_TOTAL_QUADROS - 1, inicioEixo);
    expect(brt(final)).toBe("23:00:00");
    for (let q = ultimoAnimado; q < VIDEO_TOTAL_QUADROS; q++) {
      expect(instanteDoQuadroDoVideo(q, inicioEixo)).toBe(final);
    }
    // às 23h00 vale a chegada de 20h50 (a de 04h50 está fora da janela) e a rodada das 21h30
    const e = estadoNoInstante(apuracao, projecao, final);
    expect(e.pct).toEqual([41, 51]);
    expect(e.projecao).toEqual([45, 47]);
  });

  it("anima devagar e sem voltar: cada quadro animado avança ~45 s da noite", () => {
    const passos: number[] = [];
    for (let q = 1; q < VIDEO_TOTAL_QUADROS - VIDEO_QUADROS_PARADOS; q++) {
      passos.push(
        instanteDoQuadroDoVideo(q, inicioEixo) - instanteDoQuadroDoVideo(q - 1, inicioEixo),
      );
    }
    expect(Math.min(...passos)).toBeGreaterThan(0);
    expect(Math.max(...passos)).toBeLessThan(60);
  });
});

describe("montarCorrida — colunas enxutas", () => {
  it("segundos desde o início do eixo, % com 3 casas, colunas do mesmo tamanho", () => {
    const inicio = T0 - 600 * S;
    const c = montarCorrida(
      {
        candidatos: [
          { id: 13, nome: "A", partido: "PT" },
          { id: 22, nome: "B", partido: "PL" },
        ],
        versoes: [uf(T0, "SP", 1, 2, 3), uf(T0 + 1500, "RJ", 1, 1, 3)],
        rodadas: [
          {
            tsMs: T0 + 30 * S,
            dadoTsMs: T0,
            pct: [33.33333, 66.66666],
            lo: [30, 60],
            hi: [36, 70],
            pVitoria: [0, 1],
            pctAtual: [33.333, 66.667],
            votosAtuais: [1, 2],
          },
        ],
      },
      inicio,
      inicio,
      T0 + 3600 * S,
    );
    expect(c.apuracao.t).toEqual([600, 602]);
    expect(c.apuracao.pct[0]?.[0]).toBe(33.333);
    expect(c.apuracao.pct[0]).toHaveLength(2);
    expect(c.projecao.t).toEqual([630]);
    expect(c.projecao.tBoletim).toEqual([600]);
    expect(c.projecao.pct[1]).toEqual([66.667]);
    expect(c.conferencia.instantes).toBe(1);
  });
});
