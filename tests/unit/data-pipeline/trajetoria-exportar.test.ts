// Exportação offline da trajetória na Câmara — `data-pipeline/trajetoria-exportar.ts`.
// Spec 018 RF-214, ADR-0058 item 5.
//
// O arquivo `editorial/derivados/trajetoria-camara.json` é CONTRATO com a
// camada de etiquetas editoriais (outra frente o consome): o formato exato,
// a presença de toda candidatura do universo (estreante inclusive), a contagem
// `universo` e a ausência de dado pessoal são provados aqui.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Trajetoria } from "@/data-pipeline/trajetoria-camara.ts";
import { calcularTrajetorias } from "@/data-pipeline/trajetoria-camara-calculo.ts";
import {
  CAMARA_DIR_PADRAO,
  compararSq,
  contarPorCategoria,
  type ExportacaoTrajetoria,
  montarExportacao,
  parseCli,
  SAIDA_PADRAO,
  serializarExportacao,
  TSE_DIR_PADRAO,
} from "@/data-pipeline/trajetoria-exportar.ts";
import {
  COMPLEMENTARES,
  H_COMPLEMENTAR,
  H_PRINCIPAL,
  indiceFixture,
  PRINCIPAIS,
  PROIBIDOS_NA_SAIDA,
} from "./_trajetoria-fixtures.ts";

const GERADO_EM = new Date("2026-09-29T12:00:00.000Z");
const CAMARA = "Câmara dos Deputados — Dados Abertos (dadosabertos.camara.leg.br): cache de teste";

function exportarFixture(): ExportacaoTrajetoria {
  const r = calcularTrajetorias(
    PRINCIPAIS,
    H_PRINCIPAL,
    COMPLEMENTARES,
    H_COMPLEMENTAR,
    indiceFixture(),
  );
  return montarExportacao({
    universo: r.universo,
    porSq: r.porSq,
    geracaoDeclarada: r.geracaoDeclarada,
    camara: CAMARA,
    geradoEm: GERADO_EM,
  });
}

const traj = (trajetoria: Trajetoria["trajetoria"], ids: number[] | null): Trajetoria => ({
  trajetoria,
  camaraIds: ids,
  modo: ids ? "exato" : "nenhum",
});

describe("montarExportacao — o contrato", () => {
  it("formato exato, chave a chave", () => {
    const e = exportarFixture();
    expect(Object.keys(e)).toEqual(["gerado_em", "fonte", "universo", "por_sqcand"]);
    expect(Object.keys(e.fonte)).toEqual(["tse_dt_geracao", "camara"]);
    expect(e.gerado_em).toBe("2026-09-29T12:00:00.000Z");
    expect(e.fonte).toEqual({ tse_dt_geracao: "12/09/2026 19:31:30", camara: CAMARA });
    for (const x of Object.values(e.por_sqcand)) {
      expect(Object.keys(x)).toEqual(["t", "camara_ids"]);
    }
  });

  // MUTAÇÃO ALVO: a exportação descartar os estreantes (só quem tem id) —
  // o consumidor passaria a inferir "estreante" pela ausência.
  it("TODA candidatura do universo está presente — estreante com camara_ids []", () => {
    const e = exportarFixture();
    expect(e.por_sqcand).toEqual({
      "90000000002": { t: "estreante", camara_ids: [] },
      "100000000004": { t: "mandato_anterior", camara_ids: [15] },
      "100000000005": { t: "legislatura_atual", camara_ids: [31] },
      "100000000006": { t: "estreante", camara_ids: [] },
      "250000000001": { t: "em_exercicio", camara_ids: [7] },
    });
  });

  // MUTAÇÃO ALVO: `universo` contado errado (ex.: só os com id, ou o arquivo
  // inteiro com Governador).
  it("universo é a contagem de candidaturas de cargo 6 e bate com as chaves", () => {
    const e = exportarFixture();
    expect(e.universo).toBe(5);
    expect(Object.keys(e.por_sqcand).length).toBe(e.universo);
    expect(contarPorCategoria(e)).toEqual({
      em_exercicio: 1,
      legislatura_atual: 1,
      mandato_anterior: 1,
      estreante: 2,
    });
  });

  it("chaves em ordem numérica crescente (11 dígitos antes de 12)", () => {
    expect(Object.keys(exportarFixture().por_sqcand)).toEqual([
      "90000000002",
      "100000000004",
      "100000000005",
      "100000000006",
      "250000000001",
    ]);
    expect(["12", "9", "100", "11"].sort(compararSq)).toEqual(["9", "11", "12", "100"]);
  });

  it("SQ do universo sem trajetória lança — 'ausente' nunca vira 'estreante'", () => {
    expect(() =>
      montarExportacao({
        universo: ["1", "2"],
        porSq: new Map([["1", traj("estreante", null)]]),
        geracaoDeclarada: "x",
        camara: CAMARA,
        geradoEm: GERADO_EM,
      }),
    ).toThrow(/sem trajetória/);
  });

  it("trajetória fora do universo, SQ repetido ou inválido lançam", () => {
    const base = { geracaoDeclarada: "x", camara: CAMARA, geradoEm: GERADO_EM };
    expect(() =>
      montarExportacao({
        ...base,
        universo: ["1"],
        porSq: new Map([
          ["1", traj("estreante", null)],
          ["2", traj("estreante", null)],
        ]),
      }),
    ).toThrow(/fora do universo/);
    expect(() =>
      montarExportacao({
        ...base,
        universo: ["1", "1"],
        porSq: new Map([["1", traj("estreante", null)]]),
      }),
    ).toThrow(/repetido/);
    expect(() =>
      montarExportacao({
        ...base,
        universo: ["01"],
        porSq: new Map([["01", traj("estreante", null)]]),
      }),
    ).toThrow(/inválido/);
  });

  it("estreante com id, ou categoria com mandato sem id, lança", () => {
    const base = { universo: ["1"], geracaoDeclarada: "x", camara: CAMARA, geradoEm: GERADO_EM };
    expect(() =>
      montarExportacao({ ...base, porSq: new Map([["1", traj("estreante", [7])]]) }),
    ).toThrow(/estreante com 1/);
    expect(() =>
      montarExportacao({ ...base, porSq: new Map([["1", traj("em_exercicio", null)]]) }),
    ).toThrow(/em_exercicio com 0/);
  });

  it("sem DT_GERACAO do TSE não exporta — proveniência obrigatória", () => {
    expect(() =>
      montarExportacao({
        universo: ["1"],
        porSq: new Map([["1", traj("estreante", null)]]),
        geracaoDeclarada: null,
        camara: CAMARA,
        geradoEm: GERADO_EM,
      }),
    ).toThrow(/DT_GERACAO/);
  });
});

describe("serializarExportacao — texto do arquivo", () => {
  it("é JSON que volta idêntico ao objeto", () => {
    const e = exportarFixture();
    expect(JSON.parse(serializarExportacao(e))).toEqual(e);
  });

  // MUTAÇÃO ALVO: qualquer campo de identificação (nome, nascimento, ocupação)
  // vazando para o arquivo exportado.
  it("não contém nome, data de nascimento nem ocupação — asserção negativa", () => {
    const s = serializarExportacao(exportarFixture());
    for (const proibido of PROIBIDOS_NA_SAIDA) expect(s).not.toContain(proibido);
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}(?!T)/); // só o ISO do gerado_em tem data
  });

  it("é determinístico: mesma entrada, mesmo texto", () => {
    expect(serializarExportacao(exportarFixture())).toBe(serializarExportacao(exportarFixture()));
  });

  it("uma candidatura por linha, dentro da largura do biome (100)", () => {
    const linhas = serializarExportacao(exportarFixture()).split("\n");
    for (const l of linhas) expect(l.length).toBeLessThanOrEqual(100);
    expect(linhas).toContain('    "90000000002": { "t": "estreante", "camara_ids": [] },');
    expect(linhas).toContain('    "250000000001": { "t": "em_exercicio", "camara_ids": [7] }');
  });

  it("linha que estouraria a largura sai expandida, como o biome faria", () => {
    const e = montarExportacao({
      universo: ["123456789012"],
      porSq: new Map([
        ["123456789012", traj("legislatura_atual", [111111, 222222, 333333, 444444, 555555])],
      ]),
      geracaoDeclarada: "x",
      camara: CAMARA,
      geradoEm: GERADO_EM,
    });
    const s = serializarExportacao(e);
    expect(s).toContain('    "123456789012": {\n      "t": "legislatura_atual",\n');
    expect(JSON.parse(s)).toEqual(e);
  });
});

describe("parseCli", () => {
  it("padrões relativos ao diretório de trabalho; saída em editorial/derivados", () => {
    const c = parseCli([]);
    expect(c.tseDir).toBe(resolve(TSE_DIR_PADRAO));
    expect(c.camaraDir).toBe(resolve(CAMARA_DIR_PADRAO));
    expect(c.saida).toBe(SAIDA_PADRAO);
    expect(SAIDA_PADRAO.endsWith("editorial/derivados/trajetoria-camara.json")).toBe(true);
    expect(c.camaraRefresh).toBe(false);
  });

  it("aceita os diretórios; recusa argumento desconhecido ou sem valor", () => {
    expect(parseCli(["--tse-dir", "/a", "--camara-dir", "/b"])).toMatchObject({
      tseDir: "/a",
      camaraDir: "/b",
    });
    expect(() => parseCli(["--x", "1"])).toThrow(/desconhecido/);
    expect(() => parseCli(["--tse-dir"])).toThrow(/sem valor/);
  });
});
