// tests/unit/data-pipeline/eleitorado-df-import.test.ts
//
// `data-pipeline/eleitorado-df-import.ts` — carga do eleitorado do DF a partir
// das fixtures reais do simulado TSE 2026 (2ª janela, `tests/fixtures/tse/
// 2026-sim/df/`), porque `eleitorado-import.ts` só cobre o CSV municipal de
// 2024 e o DF não elege prefeito.
//
// Estes testes são das funções PURAS do script (parse, validação, comparação)
// — nenhum toca disco além dos helpers de leitura de fixture explicitamente
// testados abaixo, e NENHUM abre conexão de banco. `getPool()` só é chamado
// dentro de `escrever()`, que não é exercitada aqui.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANO,
  buildRows,
  COD_MUNICIPIO_TSE,
  compararComExistentes,
  extrairAgregado,
  extrairZona,
  UF,
  ValidacaoDfError,
  validarAgregado,
  validarZonas,
  type ZonaLida,
  zonaFromFilename,
  zonasOficiaisDoEa12,
} from "@/data-pipeline/eleitorado-df-import.ts";

const FIXTURES_DIR = resolve(process.cwd(), "tests/fixtures/tse/2026-sim/df");
const EA12_PATH = resolve(process.cwd(), "tests/fixtures/tse/2026-sim/mun-e021270-cm.json");

async function lerFixtureZonas(): Promise<{ arquivo: string; raw: unknown }[]> {
  const arquivos = (await readdir(FIXTURES_DIR)).filter((f) => /^df97012-z\d{4}-/.test(f));
  const out: { arquivo: string; raw: unknown }[] = [];
  for (const f of arquivos.sort()) {
    out.push({ arquivo: f, raw: JSON.parse(await readFile(resolve(FIXTURES_DIR, f), "utf8")) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// zonaFromFilename
// ─────────────────────────────────────────────────────────────────────────────

describe("zonaFromFilename", () => {
  it("extrai o número da zona do nome oficial", () => {
    expect(zonaFromFilename("df97012-z0001-c0001-e021270-u.json")).toBe(1);
    expect(zonaFromFilename("df97012-z0021-c0001-e021270-u.json")).toBe(21);
  });

  it("devolve null para nome fora do padrão (outro município, outro cargo, sem zero-padding)", () => {
    expect(zonaFromFilename("ac01392-z0001-c0001-e021270-u.json")).toBeNull();
    expect(zonaFromFilename("df97012-z0001-c0003-e021270-u.json")).toBeNull();
    expect(zonaFromFilename("df97012-z1-c0001-e021270-u.json")).toBeNull();
    expect(zonaFromFilename("df-c0001-e021270-u.json")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extrairZona / extrairAgregado — contra as fixtures REAIS
// ─────────────────────────────────────────────────────────────────────────────

describe("extrairZona (fixtures reais)", () => {
  it("parseia as 19 zonas do DF sem lançar, todas com te > 0", async () => {
    const arquivos = await lerFixtureZonas();
    expect(arquivos.length).toBe(19);
    for (const { arquivo, raw } of arquivos) {
      const z = extrairZona(arquivo, raw);
      expect(z.te).toBeGreaterThan(0);
      expect(z.arquivo).toBe(arquivo);
    }
  });

  it("rejeita quando a zona do nome não bate com cdabr do envelope", async () => {
    const { raw } = (await lerFixtureZonas())[0]!;
    // Nome afirma zona 9999; o envelope real diz outra coisa.
    expect(() => extrairZona("df97012-z9999-c0001-e021270-u.json", raw)).toThrow(
      /não bate com cdabr/,
    );
  });

  it("rejeita tpabr diferente de 'zona'", async () => {
    const agregadoRaw = JSON.parse(
      await readFile(resolve(FIXTURES_DIR, "df-c0001-e021270-u.json"), "utf8"),
    );
    // Um envelope de UF sob um nome de arquivo de zona.
    expect(() => extrairZona("df97012-z0001-c0001-e021270-u.json", agregadoRaw)).toThrow(
      /tpabr esperado "zona"/,
    );
  });
});

describe("extrairAgregado (fixture real)", () => {
  it("lê o te do agregado df-c0001-e021270-u.json", async () => {
    const raw = JSON.parse(
      await readFile(resolve(FIXTURES_DIR, "df-c0001-e021270-u.json"), "utf8"),
    );
    const { te } = extrairAgregado(raw);
    expect(te).toBe(2187571);
  });

  it("rejeita cdabr diferente de 'df'", async () => {
    const raw = JSON.parse(
      await readFile(resolve(FIXTURES_DIR, "df-c0001-e021270-u.json"), "utf8"),
    );
    const alterado = { ...(raw as Record<string, unknown>), cdabr: "sp" };
    expect(() => extrairAgregado(alterado)).toThrow(/cdabr esperado "df"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// zonasOficiaisDoEa12 — contra o EA12 real (já presente no repo)
// ─────────────────────────────────────────────────────────────────────────────

describe("zonasOficiaisDoEa12", () => {
  it("lista exatamente as 19 zonas do município 97012, batendo com as fixtures", async () => {
    const ea12 = JSON.parse(await readFile(EA12_PATH, "utf8"));
    const zonas = zonasOficiaisDoEa12(ea12);
    expect(zonas.length).toBe(19);
    expect(zonas).toEqual([...zonas].sort((a, b) => a - b));
    // As zonas 0007 e 0012 não existem para este município no EA12 — não é
    // gap de coleta das fixtures, é ausência na fonte oficial.
    expect(zonas).not.toContain(7);
    expect(zonas).not.toContain(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validarZonas
// ─────────────────────────────────────────────────────────────────────────────

const zona = (codZona: number, te: number, arquivo = `f${codZona}.json`): ZonaLida => ({
  arquivo,
  codZona,
  te,
});

describe("validarZonas", () => {
  it("aceita quando o conjunto lido é exatamente o oficial e toda te > 0", () => {
    expect(() => validarZonas([zona(1, 100), zona(2, 200)], [1, 2])).not.toThrow();
  });

  it("rejeita zona faltando (oficial tem, lido não tem)", () => {
    expect(() => validarZonas([zona(1, 100)], [1, 2])).toThrow(ValidacaoDfError);
    expect(() => validarZonas([zona(1, 100)], [1, 2])).toThrow(/Faltando: \[2\]/);
  });

  it("rejeita zona sobrando (lido tem, oficial não tem)", () => {
    expect(() => validarZonas([zona(1, 100), zona(3, 50)], [1])).toThrow(/Sobrando: \[3\]/);
  });

  it("rejeita duplicata de zona", () => {
    expect(() => validarZonas([zona(1, 100, "a.json"), zona(1, 999, "b.json")], [1])).toThrow(
      /duplicada/,
    );
  });

  // Caso NO limiar — é o que discrimina "te > 0" de "te >= 0" (mutação de
  // operador). Zero é o valor mais provável de sobreviver a um `>=`.
  it("rejeita te == 0 (limiar exato, não só negativo)", () => {
    expect(() => validarZonas([zona(1, 0)], [1])).toThrow(/te=0, esperado > 0/);
  });

  it("aceita te == 1 (o menor valor válido, adjacente ao limiar)", () => {
    expect(() => validarZonas([zona(1, 1)], [1])).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validarAgregado
// ─────────────────────────────────────────────────────────────────────────────

describe("validarAgregado", () => {
  it("aceita quando a soma bate exatamente", () => {
    expect(() => validarAgregado([zona(1, 100), zona(2, 200)], 300)).not.toThrow();
  });

  it("rejeita quando a soma diverge por 1 (não é só desvio grosseiro)", () => {
    expect(() => validarAgregado([zona(1, 100), zona(2, 200)], 301)).toThrow(ValidacaoDfError);
    expect(() => validarAgregado([zona(1, 100), zona(2, 200)], 301)).toThrow(/diferença de -1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRows — nunca produz outra UF, sempre ano/município constantes
// ─────────────────────────────────────────────────────────────────────────────

describe("buildRows", () => {
  it("produz uma linha por zona, todas uf=DF, ano=2026, município=97012", () => {
    const rows = buildRows([zona(2, 200), zona(1, 100)]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.uf).toBe(UF);
      expect(r.uf).toBe("DF");
      expect(r.ano).toBe(ANO);
      expect(r.ano).toBe(2026);
      expect(r.codMunicipioTse).toBe(COD_MUNICIPIO_TSE);
      expect(r.codMunicipioTse).toBe(97012);
      expect(r.comparecimentoPctHistorico).toBeNull();
    }
  });

  it("ordena por cod_zona (saída determinística, independente da ordem de entrada)", () => {
    const rows = buildRows([zona(9, 1), zona(1, 2), zona(5, 3)]);
    expect(rows.map((r) => r.codZona)).toEqual([1, 5, 9]);
  });

  it("preserva eleitoresAptos = te de cada zona", () => {
    const rows = buildRows([zona(1, 74957)]);
    expect(rows[0]!.eleitoresAptos).toBe(74957);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compararComExistentes — o que decide se `--escrever` aborta ou segue
// ─────────────────────────────────────────────────────────────────────────────

describe("compararComExistentes", () => {
  it("devolve lista vazia quando banco e calculado são idênticos", () => {
    const rows = buildRows([zona(1, 100), zona(2, 200)]);
    const diffs = compararComExistentes(
      [
        { codZona: 1, eleitoresAptos: 100 },
        { codZona: 2, eleitoresAptos: 200 },
      ],
      rows,
    );
    expect(diffs).toEqual([]);
  });

  it("aponta a zona com valor diferente, sem listar as iguais", () => {
    const rows = buildRows([zona(1, 100), zona(2, 200)]);
    const diffs = compararComExistentes(
      [
        { codZona: 1, eleitoresAptos: 100 },
        { codZona: 2, eleitoresAptos: 999 },
      ],
      rows,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatch(/zona 2: banco=999, calculado=200/);
  });

  it("aponta zona que existe no banco mas não nas fixtures calculadas", () => {
    const rows = buildRows([zona(1, 100)]);
    const diffs = compararComExistentes([{ codZona: 7, eleitoresAptos: 50 }], rows);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatch(/zona 7: existe no banco/);
  });

  it("diferença de 1 eleitor também conta — não é comparação com tolerância", () => {
    const rows = buildRows([zona(1, 100)]);
    const diffs = compararComExistentes([{ codZona: 1, eleitoresAptos: 101 }], rows);
    expect(diffs).toHaveLength(1);
  });
});
