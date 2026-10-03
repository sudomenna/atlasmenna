/**
 * tests/unit/dev/assembleias-fixtures.test.ts — spec 027, frente S (RF-280,
 * RF-285, RF-289): o simulado das assembleias que `pnpm dev:sim` e os portões
 * e2e servem, gerado por `data-pipeline/simulacao-assembleias.py` (o modelo
 * Python real sobre EA20 do simulado do TSE — sem banco, sem rede).
 *
 * É o VALIDADOR do gerador (tasks M39/M40): o que tornaria o portão de peso ou
 * a tela de revisão mentirosos se a fixture derivasse.
 *
 *   - Fase 1: `granularidade: "uf"`, nenhum `projecao` em lugar nenhum, e a
 *     Conferência declarando o eleitorado NÃO comparado;
 *   - M39: o cargo 7 nunca traz o DF, o 8 só traz o DF;
 *   - M40: o total é o fixo da casa (1.035 / 24), nunca a soma das presentes;
 *   - o pior caso de SP que o teto do portão mede de fato está lá: 94
 *     lugares, agremiações de 95, 60 linhas por agremiação no documento, nomes
 *     de 30 caracteres acentuados, e a lista 61+;
 *   - os sanitizadores de produção (`sanearDeputadoUfDetail`/`…Lista`) não
 *     derrubam campo nenhum — senão a tela mostraria menos do que o portão
 *     pensa medir.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const logWarnMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logWarn: (msg: string, ctx?: unknown) => logWarnMock(msg, ctx) };
});

import {
  _reiniciarAvisosDeDescarte,
  type DeputadoUfDetail,
  type DeputadoUfLista,
  sanearDeputadoUfDetail,
  sanearDeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import { ufsDoCargo } from "@/lib/config/cargos";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import disNacional from "@/tests/fixtures/simulacao/deputado-distrital.json" with { type: "json" };
import disUf from "@/tests/fixtures/simulacao/deputado-distrital-uf.json" with { type: "json" };
import estNacional from "@/tests/fixtures/simulacao/deputado-estadual.json" with { type: "json" };
import estUf from "@/tests/fixtures/simulacao/deputado-estadual-uf.json" with { type: "json" };
import estLista from "@/tests/fixtures/simulacao/deputado-estadual-uf-lista.json" with {
  type: "json",
};

const est = estNacional as unknown as EdgePayloadDeputado;
const dis = disNacional as unknown as EdgePayloadDeputado;
const estPorUf = estUf as unknown as Record<string, DeputadoUfDetail>;
const disPorUf = disUf as unknown as Record<string, DeputadoUfDetail>;
const listas = estLista as unknown as Record<string, DeputadoUfLista>;

beforeEach(() => {
  logWarnMock.mockReset();
  _reiniciarAvisosDeDescarte();
});

describe("M39 — cada casa só nas UFs dela", () => {
  it("o 7 tem só UFs de Assembleia (nunca o DF); o 8, só o DF", () => {
    const do7 = new Set<string>(ufsDoCargo(7));
    expect(do7.has("DF")).toBe(false);
    expect(Object.keys(estPorUf).filter((uf) => !do7.has(uf))).toEqual([]);
    expect(est.por_uf.map((l) => l.sigla).filter((uf) => !do7.has(uf))).toEqual([]);
    expect(Object.keys(listas).filter((uf) => !do7.has(uf))).toEqual([]);
    expect(Object.keys(disPorUf)).toEqual(["DF"]);
    expect(dis.por_uf.map((l) => l.sigla)).toEqual(["DF"]);
  });

  it("todo objeto declara o SEU cargo", () => {
    expect([est.cargo, dis.cargo]).toEqual([7, 8]);
    for (const [uf, d] of Object.entries(estPorUf)) expect(d.cargo, uf).toBe(7);
    for (const [uf, l] of Object.entries(listas)) expect(l.cargo, uf).toBe(7);
    expect(disPorUf.DF?.cargo).toBe(8);
  });
});

describe("M40 — o total é o da casa, nunca a soma das presentes", () => {
  it("estadual: 1.035 com casas faltando, e calculadas + aguardando = 26", () => {
    const b = est.bancada;
    expect(b.total_cadeiras).toBe(1035);
    expect(b.ufs_calculadas + b.ufs_aguardando).toBe(26);
    // As casas faltam de propósito (RO e TO sem linha; AC e AP a 0%) — é o
    // que faz o "total fixo" discriminar a "soma das presentes".
    expect(b.ufs_aguardando).toBeGreaterThan(0);
    const somaPresentes = est.por_uf.reduce((s, l) => s + (l.lugares_a_preencher ?? 0), 0);
    expect(somaPresentes).toBeLessThan(1035);
    expect(b.cadeiras_atribuidas).toBeLessThan(b.total_cadeiras);
  });

  it("distrital: 24 lugares (o simulado do TSE publica 28; a casa real tem 24)", () => {
    expect(dis.bancada.total_cadeiras).toBe(24);
    expect(disPorUf.DF?.lugares_a_preencher).toBe(24);
  });
});

describe("Fase 1 — resumo do estado, sem projeção, Conferência honesta (RF-285)", () => {
  const todos = [...Object.entries(estPorUf), ...Object.entries(disPorUf)];

  it("granularidade `uf` e nenhum `projecao` em objeto nenhum, nem no nacional", () => {
    for (const [uf, d] of todos) {
      expect(d.granularidade, uf).toBe("uf");
      expect("projecao" in d, uf).toBe(false);
    }
    const serial = JSON.stringify([est, dis]);
    expect(serial).not.toContain('"projecao"');
    expect(serial).not.toContain("cadeiras_projetadas");
  });

  it("a Conferência declara o eleitorado NÃO comparado (o agregado não se compara consigo)", () => {
    for (const [uf, d] of todos) {
      expect(d.conferencia?.nao_comparou, uf).toContainEqual({
        comparacao: "eleitorado",
        motivo: "granularidade_uf",
      });
      expect(d.conferencia?.comparou ?? [], uf).not.toContain("eleitorado");
    }
  });

  it("os três estados existem: apurando, não começou (0%) e aguardando (sem linha)", () => {
    const pct = new Map(Object.entries(estPorUf).map(([uf, d]) => [uf, d.pct_apurado]));
    expect([...pct.values()].some((p) => (p ?? 0) > 0)).toBe(true);
    expect(pct.get("AC")).toBe(0);
    expect(pct.has("RO")).toBe(false);
  });

  it("nenhum texto da Câmara dos Deputados nos objetos das assembleias", () => {
    const serial = JSON.stringify([est, dis, estPorUf, disPorUf]);
    expect(serial).not.toContain("Câmara");
    expect(serial).not.toContain("Deputado Federal");
  });
});

describe("RF-289 — SP no pior caso de peso", () => {
  const sp = estPorUf.SP as DeputadoUfDetail;

  it("94 lugares, agremiações de 95 candidatos, até 60 no documento", () => {
    expect(sp.lugares_a_preencher).toBe(94);
    const totais = sp.agremiacoes.map((a) => a.total_candidatos ?? 0);
    expect(Math.max(...totais)).toBe(95);
    const noDocumento = sp.agremiacoes.map((a) => a.candidatos?.length ?? 0);
    expect(Math.max(...noDocumento)).toBe(60);
  });

  it("todo nome de urna com 30 caracteres e acento (bytes, não glifos)", () => {
    const nomes = sp.agremiacoes.flatMap((a) => (a.candidatos ?? []).map((c) => c.nome));
    expect(nomes.length).toBeGreaterThan(1000);
    expect(nomes.filter((n) => [...n].length !== 30)).toEqual([]);
    expect(nomes.filter((n) => Buffer.byteLength(n) === n.length)).toEqual([]);
  });

  it("a lista 61+ de SP tem as posições 61–95 e só elas", () => {
    const lista = listas.SP as DeputadoUfLista;
    const ranks = lista.agremiacoes.flatMap((a) => a.candidatos.map((c) => c.rank));
    expect(Math.min(...ranks)).toBe(61);
    expect(Math.max(...ranks)).toBe(95);
    expect(Object.keys(listas).sort()).toEqual(["BA", "MG", "RJ", "SP"]);
  });
});

describe("os sanitizadores de produção não derrubam nada", () => {
  it("detalhe de cada UF (7 e 8) passa intacto", () => {
    for (const [uf, d] of [...Object.entries(estPorUf), ...Object.entries(disPorUf)]) {
      expect(sanearDeputadoUfDetail(d), uf).toEqual(d);
    }
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("lista 61+ passa intacta", () => {
    for (const [uf, l] of Object.entries(listas)) {
      expect(sanearDeputadoUfLista(l), uf).toEqual(l);
    }
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
