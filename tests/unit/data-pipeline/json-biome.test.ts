// `data-pipeline/_json-biome.ts` — JSON já no formato do `biome format`.
//
// O teste decisivo é o último: o próprio `biome format` não muda nada do que o
// serializador emitiu. Sem ele, "compatível com o biome" seria só uma alegação.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonNoFormatoDoBiome } from "@/data-pipeline/_json-biome.ts";

describe("jsonNoFormatoDoBiome", () => {
  it("objeto expandido, uma chave por linha, indentação de 2, quebra de linha final", () => {
    expect(jsonNoFormatoDoBiome({ a: 1, b: { c: "x" } })).toBe(
      '{\n  "a": 1,\n  "b": {\n    "c": "x"\n  }\n}\n',
    );
  });

  it("lista de primitivos numa linha só; vazios ficam {} e []", () => {
    expect(jsonNoFormatoDoBiome({ codigos: [1, 22, 333], vazio: [], obj: {} })).toBe(
      '{\n  "codigos": [1, 22, 333],\n  "vazio": [],\n  "obj": {}\n}\n',
    );
  });

  it("lista com objeto dentro: um elemento por linha", () => {
    expect(jsonNoFormatoDoBiome({ xs: [{ a: 1 }, { a: 2 }] })).toBe(
      '{\n  "xs": [\n    {\n      "a": 1\n    },\n    {\n      "a": 2\n    }\n  ]\n}\n',
    );
  });

  it("lista de primitivos acima da largura lança (o formatador a quebraria em fill)", () => {
    expect(() =>
      jsonNoFormatoDoBiome({ xs: Array.from({ length: 40 }, (_, i) => 100000 + i) }),
    ).toThrow(/acima da largura/);
  });

  it("número não finito lança", () => {
    expect(() => jsonNoFormatoDoBiome({ x: Number.NaN })).toThrow(/não finito/);
  });

  it("é JSON válido: o round-trip devolve o mesmo valor", () => {
    const v = {
      corte: "2026-07-15",
      n: 33.3,
      xs: [1, 2],
      o: { "12": { a: "ç" } },
      t: true,
      z: null,
    };
    expect(JSON.parse(jsonNoFormatoDoBiome(v))).toEqual(v);
  });

  const biome = resolve(process.cwd(), "node_modules/.bin/biome");
  it.skipIf(!existsSync(biome))("o `biome format` não muda nada do que ele emite", () => {
    const v = {
      fonte: {
        descricao: "Senado Federal — Dados Abertos",
        url: "https://legis.senado.leg.br/dadosabertos/",
      },
      universo: 4,
      por_sqcand: {
        "250000000003": { t: "mandato_anterior", senado_codigos: [9107] },
        "250000000012": { t: "estreante", senado_codigos: [] },
        "1000000000007": { t: "em_exercicio", senado_codigos: [9101, 9107] },
      },
      por_senador: { "22": { votos_disputadas: 36, taxa_disputadas: 5.6 } },
    };
    const emitido = jsonNoFormatoDoBiome(v);
    const formatado = execFileSync(biome, ["format", "--stdin-file-path=x.json"], {
      input: emitido,
      encoding: "utf8",
    });
    expect(formatado).toBe(emitido);
  });
});
