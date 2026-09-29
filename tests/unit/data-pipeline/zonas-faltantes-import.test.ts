// tests/unit/data-pipeline/zonas-faltantes-import.test.ts
//
// `data-pipeline/zonas-faltantes-nucleo.ts` (lógica pura) e a costura de
// `zonas-faltantes-import.ts` (`executar`, com um cliente de banco FALSO).
// NENHUM teste abre conexão real ou toca a rede: o banco de produção é o alvo do
// script, e a garantia de que a simulação nunca escreve é justamente um teste
// aqui (o cliente falso registra todo SQL e a simulação só pode emitir leitura).
//
// Os números de AP e PE vêm de uma MEDIÇÃO real de 29/09 contra produção
// (somente SELECT), guardada em
// `tests/fixtures/tse/2026-sim/zonas-faltantes/medidas-2026-09-29.json`; o EA12 é
// o real do simulado (`mun-e021270-cm.json`), e o arquivo de zona é um EA20 real
// do DF (o formato é o mesmo do de AP/PE, que ainda não foram baixados).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BloqueadoError,
  type Consulta,
  executar,
  SQL_AGREGADOS,
  SQL_CONTA_ZONAS_UF,
  SQL_INSERT_PESOS,
  SQL_INSERT_ZONAS,
  SQL_MUNICIPIOS,
  SQL_PESOS,
  SQL_SOMA_UF,
  SQL_TE_ZONAS,
  SQL_ZONAS,
} from "@/data-pipeline/zonas-faltantes-import.ts";
import {
  type Cli,
  chaveDoPar,
  desviosDePeso,
  diffPares,
  type EntradaPlano,
  extrairTeDeArquivoZona,
  lerParesDoEa12,
  nomeArquivoZona,
  type Par,
  type ParEa12,
  type Peso,
  parseCli,
  parseNomeArquivoZona,
  planejar,
  resolverTeDosFaltantes,
  tabelaPorUf,
  ValidacaoError,
  verificarTotais,
} from "@/data-pipeline/zonas-faltantes-nucleo.ts";

const RAIZ = process.cwd();
const EA12_PATH = resolve(RAIZ, "tests/fixtures/tse/2026-sim/mun-e021270-cm.json");
const MEDIDAS_PATH = resolve(
  RAIZ,
  "tests/fixtures/tse/2026-sim/zonas-faltantes/medidas-2026-09-29.json",
);
const DF_ZONA_1 = "tests/fixtures/tse/2026-sim/df/df97012-z0001-c0001-e021270-u.json";

const ea12Raw = JSON.parse(readFileSync(EA12_PATH, "utf8")) as {
  abr: { cd: string }[];
  [k: string]: unknown;
};

interface ParMedido {
  uf: string;
  mun: number;
  zona: number;
  peso: number | null;
  te: number | null;
}
interface Medidas {
  agregadoTe: Record<string, number>;
  pares: ParMedido[];
}
const medidas = JSON.parse(readFileSync(MEDIDAS_PATH, "utf8")) as Medidas;

/** EA12 real restrito a AP e PE — o mesmo recorte da medição. */
function ea12Recortado(ufs: string[]): unknown {
  return { ...ea12Raw, abr: ea12Raw.abr.filter((a) => ufs.includes(a.cd.toUpperCase())) };
}

const ea12 = lerParesDoEa12(ea12Recortado(["AP", "PE"])).pares;
const zonasBanco: Par[] = medidas.pares.map((p) => ({
  uf: p.uf,
  codMunicipioTse: p.mun,
  codZona: p.zona,
}));
const pesosBanco: Peso[] = medidas.pares
  .filter((p) => p.peso !== null)
  .map((p) => ({
    uf: p.uf,
    codMunicipioTse: p.mun,
    codZona: p.zona,
    eleitoresAptos: p.peso as number,
  }));
const teSnapshots = new Map<string, number>(
  medidas.pares
    .filter((p) => p.te !== null)
    .map((p) => [
      chaveDoPar({ uf: p.uf, codMunicipioTse: p.mun, codZona: p.zona }),
      p.te as number,
    ]),
);
const agregados = new Map(Object.entries(medidas.agregadoTe));

const OPCOES = { escrever: false, ufs: [], aceitarTeDerivado: false, exigirSomaExata: false };
const AP_14: Par = { uf: "AP", codMunicipioTse: 6050, codZona: 14 };
const PE_NORONHA_4: Par = { uf: "PE", codMunicipioTse: 30015, codZona: 4 };

function entrada(sobre: Partial<EntradaPlano> = {}): EntradaPlano {
  return {
    ea12,
    zonas: zonasBanco,
    pesos: pesosBanco,
    agregadoPorUf: agregados,
    teZonaSnapshots: teSnapshots,
    teArquivos: new Map(),
    municipiosExistentes: new Set([6050, 30015]),
    opcoes: OPCOES,
    ...sobre,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EA12 → pares
// ─────────────────────────────────────────────────────────────────────────────

describe("lerParesDoEa12 (EA12 real do simulado)", () => {
  const { pares, meta } = lerParesDoEa12(ea12Raw);

  it("lê os 6.105 pares do território nacional, sem o exterior e sem duplicata", () => {
    expect(pares).toHaveLength(6105);
    expect(pares.some((p) => p.uf === "ZZ")).toBe(false);
    expect(new Set(pares.map(chaveDoPar)).size).toBe(6105);
    expect(meta.f).toBe("s");
  });

  it("lista Macapá zona 14 e Fernando de Noronha zona 4 — os dois pares que faltam em `zonas`", () => {
    const k = new Set(pares.map(chaveDoPar));
    expect(k.has(chaveDoPar(AP_14))).toBe(true);
    expect(k.has(chaveDoPar(PE_NORONHA_4))).toBe(true);
  });

  it("recusa EA12 com código malformado (par perdido em silêncio é a falha que se quer achar)", () => {
    const ruim = {
      dg: "01/01/2026",
      hg: "00:00:00",
      idg: "1",
      f: "s",
      abr: [{ cd: "ap", mu: [{ cd: "06050", nm: "MACAPA", z: ["0002", "abc"] }] }],
    };
    expect(() => lerParesDoEa12(ruim)).toThrow(/malformado/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffPares / tabelaPorUf
// ─────────────────────────────────────────────────────────────────────────────

describe("diffPares", () => {
  const mk = (uf: string, m: number, z: number): ParEa12 => ({
    uf,
    codMunicipioTse: m,
    codZona: z,
    nomeMunicipio: "X",
  });
  const peso = (uf: string, m: number, z: number, w = 10): Peso => ({
    uf,
    codMunicipioTse: m,
    codZona: z,
    eleitoresAptos: w,
  });

  it("separa faltando, sobrando, sem peso e peso fora do EA12", () => {
    const e = [mk("AA", 1, 1), mk("AA", 1, 2), mk("AA", 2, 1)];
    const zonas: Par[] = [mk("AA", 1, 1), mk("AA", 2, 1), mk("AA", 9, 9)];
    const pesos = [peso("AA", 1, 1), peso("AA", 7, 7)];
    const d = diffPares(e, zonas, pesos);
    expect(d.faltandoEmZonas.map(chaveDoPar)).toEqual(["AA|1|2"]);
    expect(d.sobrandoEmZonas.map(chaveDoPar)).toEqual(["AA|9|9"]);
    expect(d.zonasSemPeso.map(chaveDoPar)).toEqual(["AA|2|1", "AA|9|9"]);
    expect(d.ea12SemPeso.map(chaveDoPar)).toEqual(["AA|1|2", "AA|2|1"]);
    expect(d.pesosForaDoEa12.map(chaveDoPar)).toEqual(["AA|7|7"]);
  });

  it("na medição real de AP e PE: 1 par faltando em cada UF; PE tem 1 par de Recife que o EA12 não lista", () => {
    const d = diffPares(ea12, zonasBanco, pesosBanco);
    expect(d.faltandoEmZonas.map(chaveDoPar)).toEqual([
      chaveDoPar(AP_14),
      chaveDoPar(PE_NORONHA_4),
    ]);
    expect(d.sobrandoEmZonas.map(chaveDoPar)).toEqual(["PE|25313|1"]);
    expect(d.pesosForaDoEa12.map((p) => [chaveDoPar(p), p.eleitoresAptos])).toEqual([
      ["PE|25313|1", 115861],
    ]);
  });
});

describe("tabelaPorUf", () => {
  it("conta pares e mede o Δ da soma dos pesos contra o agregado (AP −9,05% · PE −3,28%)", () => {
    const t = tabelaPorUf(ea12, zonasBanco, pesosBanco, agregados);
    const ap = t.find((l) => l.uf === "AP")!;
    const pe = t.find((l) => l.uf === "PE")!;
    expect([ap.ea12, ap.zonas, ap.faltam, ap.sobram]).toEqual([18, 17, 1, 0]);
    expect(ap.somaPesos).toBe(571248);
    expect(ap.gapPct).toBeCloseTo(-9.0472, 3);
    expect([pe.faltam, pe.sobram, pe.pesosForaDoEa12, pe.somaPesosForaDoEa12]).toEqual([
      1, 1, 1, 115861,
    ]);
    expect(pe.gapPct).toBeCloseTo(-3.2826, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arquivo de zona
// ─────────────────────────────────────────────────────────────────────────────

describe("nome do arquivo de zona", () => {
  it("monta e decompõe o nome oficial (ida e volta)", () => {
    const nome = nomeArquivoZona(AP_14, "21270");
    expect(nome).toBe("ap06050-z0014-c0001-e021270-u.json");
    expect(parseNomeArquivoZona(nome)).toEqual({ par: AP_14, eleicao: 21270 });
    expect(nomeArquivoZona(PE_NORONHA_4, "21270")).toBe("pe30015-z0004-c0001-e021270-u.json");
  });

  it("rejeita nome fora do padrão (cargo ≠ 0001, sem zero-padding, agregado)", () => {
    expect(parseNomeArquivoZona("ap06050-z0014-c0003-e021270-u.json")).toBeNull();
    expect(parseNomeArquivoZona("ap6050-z14-c0001-e021270-u.json")).toBeNull();
    expect(parseNomeArquivoZona("ap-c0001-e021270-u.json")).toBeNull();
  });
});

describe("extrairTeDeArquivoZona (EA20 real de zona)", () => {
  const raw = JSON.parse(readFileSync(resolve(RAIZ, DF_ZONA_1), "utf8"));
  const NOME = "df97012-z0001-c0001-e021270-u.json";

  it("lê e.te do envelope e o par do nome", () => {
    expect(extrairTeDeArquivoZona(NOME, raw)).toEqual({
      par: { uf: "DF", codMunicipioTse: 97012, codZona: 1 },
      te: 74957,
      eleicao: 21270,
    });
  });

  it("rejeita quando a zona do nome não bate com cdabr do envelope", () => {
    expect(() => extrairTeDeArquivoZona("df97012-z0002-c0001-e021270-u.json", raw)).toThrow(
      /não bate com cdabr/,
    );
  });

  it("rejeita quando a eleição do nome não bate com `ele` do envelope", () => {
    expect(() => extrairTeDeArquivoZona("df97012-z0001-c0001-e021272-u.json", raw)).toThrow(
      /eleição do nome/,
    );
  });

  it("rejeita nome fora do padrão e tpabr ≠ zona", () => {
    expect(() => extrairTeDeArquivoZona("qualquer.json", raw)).toThrow(ValidacaoError);
    expect(() => extrairTeDeArquivoZona(NOME, { ...raw, tpabr: "uf" })).toThrow(/tpabr esperado/);
  });

  it("rejeita te zero ou não inteiro", () => {
    expect(() => extrairTeDeArquivoZona(NOME, { ...raw, e: { ...raw.e, te: "0" } })).toThrow(
      /inteiro > 0/,
    );
    expect(() => extrairTeDeArquivoZona(NOME, { ...raw, e: { ...raw.e, te: "12,5" } })).toThrow(
      /inteiro > 0/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// te dos faltantes
// ─────────────────────────────────────────────────────────────────────────────

describe("resolverTeDosFaltantes", () => {
  const faltantes = diffPares(ea12, zonasBanco, pesosBanco).faltandoEmZonas;
  const base = { ea12, faltantes, agregadoPorUf: agregados, teZonaSnapshots: teSnapshots };

  it("deriva o te dos dois faltantes pelo agregado (AP 122.461 · Noronha 4.954)", () => {
    const { resolvidos, problemas } = resolverTeDosFaltantes({ ...base, teArquivos: new Map() });
    expect(problemas).toEqual([]);
    expect(resolvidos.map((r) => [chaveDoPar(r), r.te, r.fonte, r.residuoUf])).toEqual([
      [chaveDoPar(AP_14), 122461, "derivado", 122461],
      [chaveDoPar(PE_NORONHA_4), 4954, "derivado", 4954],
    ]);
  });

  it("prefere o arquivo de zona quando ele fecha com o agregado", () => {
    const { resolvidos, problemas } = resolverTeDosFaltantes({
      ...base,
      teArquivos: new Map([[chaveDoPar(AP_14), 122461]]),
    });
    expect(problemas).toEqual([]);
    expect(resolvidos.find((r) => r.uf === "AP")).toMatchObject({
      te: 122461,
      fonte: "arquivo-zona",
    });
    expect(resolvidos.find((r) => r.uf === "PE")).toMatchObject({ te: 4954, fonte: "derivado" });
  });

  it("acusa quando o arquivo de zona NÃO fecha com o agregado (conferência cruzada)", () => {
    const { problemas } = resolverTeDosFaltantes({
      ...base,
      teArquivos: new Map([[chaveDoPar(AP_14), 122460]]),
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatch(
      /AP: Σ te dos arquivos de zona \(122\.460\) ≠ agregado − Σ demais pares \(122\.461\)/,
    );
  });

  it("recusa derivar quando um par oficial não-faltante não tem te no banco (resíduo incalculável)", () => {
    const semUm = new Map(teSnapshots);
    semUm.delete("AP|6017|1");
    const { resolvidos, problemas } = resolverTeDosFaltantes({
      ...base,
      teZonaSnapshots: semUm,
      teArquivos: new Map(),
    });
    expect(resolvidos.find((r) => r.uf === "AP")).toBeUndefined();
    expect(problemas.some((p) => p.startsWith("AP: 1 par(es) oficial(is) sem te de zona"))).toBe(
      true,
    );
    expect(problemas.some((p) => p.includes("incalculável"))).toBe(true);
    // PE não foi afetada
    expect(resolvidos.find((r) => r.uf === "PE")?.te).toBe(4954);
  });

  it("dois faltantes na mesma UF: sem arquivo não separa; com um arquivo, deriva o outro", () => {
    const outro: ParEa12 = {
      uf: "AP",
      codMunicipioTse: 6157,
      codZona: 99,
      nomeMunicipio: "SANTANA",
    };
    const ea12Mais = [...ea12, outro];
    const dois = [AP_14 as ParEa12, outro].map((p) => ({ ...p, nomeMunicipio: "X" }));
    const semArquivo = resolverTeDosFaltantes({
      ea12: ea12Mais,
      faltantes: dois,
      agregadoPorUf: agregados,
      teZonaSnapshots: teSnapshots,
      teArquivos: new Map(),
    });
    expect(semArquivo.resolvidos).toEqual([]);
    expect(semArquivo.problemas[0]).toMatch(
      /2 par\(es\) faltante\(s\) sem arquivo de zona.*não separa/,
    );

    const comUm = resolverTeDosFaltantes({
      ea12: ea12Mais,
      faltantes: dois,
      agregadoPorUf: agregados,
      teZonaSnapshots: teSnapshots,
      teArquivos: new Map([[chaveDoPar(AP_14), 100000]]),
    });
    expect(comUm.problemas).toEqual([]);
    expect(comUm.resolvidos.map((r) => [chaveDoPar(r), r.te, r.fonte])).toEqual([
      [chaveDoPar(AP_14), 100000, "arquivo-zona"],
      [chaveDoPar(outro), 22461, "derivado"],
    ]);
  });

  it("recusa te derivado ≤ 0 (agregado menor que a soma dos demais)", () => {
    const { resolvidos, problemas } = resolverTeDosFaltantes({
      ...base,
      agregadoPorUf: new Map([
        ["AP", 505610],
        ["PE", 7395633],
      ]),
      teArquivos: new Map(),
    });
    expect(resolvidos.find((r) => r.uf === "AP")).toBeUndefined();
    expect(problemas.some((p) => p.includes("esperado > 0"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verificarTotais
// ─────────────────────────────────────────────────────────────────────────────

describe("verificarTotais", () => {
  const novos = (te: number): (ParEa12 & { te: number; fonte: "derivado"; residuoUf: null })[] => [
    { ...AP_14, nomeMunicipio: "MACAPÁ", te, fonte: "derivado", residuoUf: null },
  ];
  const um = (soma: number): Peso[] => [
    { uf: "AP", codMunicipioTse: 1, codZona: 1, eleitoresAptos: soma },
  ];
  const agg = (n: number) => new Map([["AP", n]]);

  it("AP real: inserir Macapá 14 sem corrigir 2 e 10 conta Macapá duas vezes → PIORA (+65.638 contra −56.823)", () => {
    const [v] = verificarTotais({
      pesosAtuais: pesosBanco,
      novosPesos: [
        {
          ...ea12.find((p) => chaveDoPar(p) === chaveDoPar(AP_14))!,
          te: 122461,
          fonte: "derivado",
          residuoUf: 122461,
        },
      ],
      agregadoPorUf: agregados,
    });
    expect(v).toMatchObject({
      uf: "AP",
      agregadoTe: 628071,
      somaPesosAntes: 571248,
      somaPesosDepois: 693709,
      gapAntes: -56823,
      gapDepois: 65638,
      situacao: "PIORA",
    });
  });

  it("PE real: Noronha (4.954) não fecha, mas aproxima o total do agregado → MELHORA", () => {
    const [v] = verificarTotais({
      pesosAtuais: pesosBanco,
      novosPesos: [
        {
          ...ea12.find((p) => chaveDoPar(p) === chaveDoPar(PE_NORONHA_4))!,
          te: 4954,
          fonte: "derivado",
          residuoUf: 4954,
        },
      ],
      agregadoPorUf: agregados,
    });
    expect(v).toMatchObject({
      uf: "PE",
      somaPesosAntes: 7152871,
      somaPesosDepois: 7157825,
      gapAntes: -242762,
      gapDepois: -237808,
      situacao: "MELHORA",
    });
  });

  it("FECHA só quando a soma é exatamente o agregado", () => {
    expect(
      verificarTotais({
        pesosAtuais: um(900),
        novosPesos: novos(100),
        agregadoPorUf: agg(1000),
      })[0]!.situacao,
    ).toBe("FECHA");
    expect(
      verificarTotais({ pesosAtuais: um(900), novosPesos: novos(99), agregadoPorUf: agg(1000) })[0]!
        .situacao,
    ).toBe("MELHORA");
  });

  it("no limiar: distância IGUAL não é melhora (>= → PIORA); cruzar o zero conta pela distância", () => {
    // antes −100; depois +100 → mesma distância → PIORA
    expect(
      verificarTotais({
        pesosAtuais: um(900),
        novosPesos: novos(200),
        agregadoPorUf: agg(1000),
      })[0]!.situacao,
    ).toBe("PIORA");
    // antes −100; depois +90 → distância 90 < 100 → MELHORA
    expect(
      verificarTotais({
        pesosAtuais: um(900),
        novosPesos: novos(190),
        agregadoPorUf: agg(1000),
      })[0]!.situacao,
    ).toBe("MELHORA");
    // antes −100; depois +101 → PIORA
    expect(
      verificarTotais({
        pesosAtuais: um(900),
        novosPesos: novos(201),
        agregadoPorUf: agg(1000),
      })[0]!.situacao,
    ).toBe("PIORA");
  });

  it("sem agregado da UF: erro, não silêncio", () => {
    expect(() =>
      verificarTotais({ pesosAtuais: um(900), novosPesos: novos(100), agregadoPorUf: new Map() }),
    ).toThrow(/sem agregado/);
  });
});

describe("desviosDePeso", () => {
  it("só devolve par com diferença > 10% E > 1.000 eleitores, do maior para o menor", () => {
    const pesos: Peso[] = [
      { uf: "AA", codMunicipioTse: 1, codZona: 1, eleitoresAptos: 176626 },
      { uf: "AA", codMunicipioTse: 1, codZona: 2, eleitoresAptos: 134192 },
      { uf: "AA", codMunicipioTse: 1, codZona: 3, eleitoresAptos: 4308 }, // 28 de diferença
      { uf: "AA", codMunicipioTse: 1, codZona: 4, eleitoresAptos: 1500 }, // 50% mas só 500
      { uf: "AA", codMunicipioTse: 1, codZona: 5, eleitoresAptos: 5000 }, // sem te → ignorado
      { uf: "AA", codMunicipioTse: 1, codZona: 6, eleitoresAptos: 105000 }, // 5.000 mas só 5%
    ];
    const te = new Map([
      ["AA|1|1", 112346],
      ["AA|1|2", 84450],
      ["AA|1|3", 4280],
      ["AA|1|4", 1000],
      ["AA|1|6", 100000],
    ]);
    expect(desviosDePeso(pesos, te).map((d) => [chaveDoPar(d.par), d.diferenca])).toEqual([
      ["AA|1|1", 64280],
      ["AA|1|2", 49742],
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planejar — plano completo sobre a medição real
// ─────────────────────────────────────────────────────────────────────────────

describe("planejar (AP + PE reais)", () => {
  it("padrão: bloqueia AP (PIORA) e bloqueia os dois por te derivado sem aval", () => {
    const p = planejar(entrada());
    expect(p.insercoesZonas.map(chaveDoPar)).toEqual([chaveDoPar(AP_14), chaveDoPar(PE_NORONHA_4)]);
    expect(p.insercoesZonas.every((z) => z.fonte === "ea12")).toBe(true);
    expect(p.bloqueios.some((b) => b.startsWith("2 par(es) com te DERIVADO"))).toBe(true);
    expect(p.bloqueios.some((b) => b.startsWith("AP: inserir os pesos PIORA"))).toBe(true);
    expect(p.bloqueios.some((b) => b.startsWith("PE: inserir os pesos PIORA"))).toBe(false);
    expect(
      p.avisos.some((a) => a.startsWith("PE: Σ pesos após a inserção") && a.includes("MELHORA")),
    ).toBe(true);
  });

  it("--uf PE --aceitar-te-derivado: sem bloqueio; grava só Noronha com 4.954", () => {
    const p = planejar(entrada({ opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true } }));
    expect(p.bloqueios).toEqual([]);
    expect(p.insercoesPesos.map((r) => [chaveDoPar(r), r.te])).toEqual([
      [chaveDoPar(PE_NORONHA_4), 4954],
    ]);
    expect(p.insercoesZonas.map(chaveDoPar)).toEqual([chaveDoPar(PE_NORONHA_4)]);
    // AP fica fora do escopo e é lembrado
    expect(
      p.avisos.some((a) => a.includes("fora do escopo --uf") && a.includes("AP 06050×0014")),
    ).toBe(true);
  });

  it("--exigir-soma-exata bloqueia PE mesmo melhorando (não fecha)", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true, exigirSomaExata: true },
      }),
    );
    expect(p.bloqueios).toHaveLength(1);
    expect(p.bloqueios[0]).toMatch(
      /PE: --exigir-soma-exata — Σ pesos após \(7\.157\.825\) ≠ agregado \(7\.395\.633\)/,
    );
  });

  it("FK: município ausente de `municipios` bloqueia (a FK de zonas rejeitaria)", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true },
        municipiosExistentes: new Set([6050]),
      }),
    );
    expect(
      p.bloqueios.some((b) => b.includes("30015") && b.includes("não existe em `municipios`")),
    ).toBe(true);
  });

  it("peso já existente IDÊNTICO: pula o insert de eleitorado, mantém o de zonas; DIFERENTE: bloqueia", () => {
    const opcoes = { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true };
    const idem = planejar(
      entrada({ opcoes, pesos: [...pesosBanco, { ...PE_NORONHA_4, eleitoresAptos: 4954 }] }),
    );
    expect(idem.bloqueios).toEqual([]);
    expect(idem.insercoesPesos).toEqual([]);
    expect(idem.insercoesZonas.map(chaveDoPar)).toEqual([chaveDoPar(PE_NORONHA_4)]);
    expect(idem.pesosJaExistentes).toHaveLength(1);

    const dif = planejar(
      entrada({ opcoes, pesos: [...pesosBanco, { ...PE_NORONHA_4, eleitoresAptos: 3000 }] }),
    );
    expect(
      dif.bloqueios.some((b) =>
        b.includes("já existe peso em eleitorado (3.000) DIFERENTE do te calculado (4.954)"),
      ),
    ).toBe(true);
  });

  it("com o arquivo de zona de AP no lugar do derivado, o te-derivado deixa de ser bloqueio (a PIORA continua)", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["AP"] },
        teArquivos: new Map([[chaveDoPar(AP_14), 122461]]),
      }),
    );
    expect(p.resolvidos[0]).toMatchObject({ fonte: "arquivo-zona", te: 122461 });
    expect(p.bloqueios.some((b) => b.includes("DERIVADO"))).toBe(false);
    expect(p.bloqueios.some((b) => b.startsWith("AP: inserir os pesos PIORA"))).toBe(true);
  });

  it("nada faltando: plano vazio, sem bloqueio", () => {
    const cheio = [...zonasBanco, AP_14, PE_NORONHA_4];
    const p = planejar(entrada({ zonas: cheio }));
    expect(p.faltantes).toEqual([]);
    expect(p.insercoesZonas).toEqual([]);
    expect(p.bloqueios).toEqual([]);
  });

  it("avisa (sem bloquear) o que só relata: par que o EA12 não lista e par do EA12 sem peso", () => {
    const p = planejar(entrada({ opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true } }));
    expect(p.avisos.some((a) => a.includes("EA12 NÃO lista") && a.includes("PE 25313×0001"))).toBe(
      true,
    );
    const semPeso = pesosBanco.filter(
      (x) => !(x.uf === "PE" && x.codMunicipioTse === 25313 && x.codZona === 2),
    );
    const q = planejar(
      entrada({ opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true }, pesos: semPeso }),
    );
    expect(q.avisos.some((a) => a.includes("SEM peso") && a.includes("PE 25313×0002"))).toBe(true);
    expect(q.bloqueios).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCli
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCli", () => {
  it("padrão = simulação, eleição federal 21270", () => {
    expect(parseCli([])).toMatchObject({
      escrever: false,
      ufs: [],
      aceitarTeDerivado: false,
      exigirSomaExata: false,
      ea12: null,
      zonasDir: null,
      eleicao: "21270",
    });
  });

  it("aceita o `--` que o pnpm repassa (medido em 27/09) e lê todas as flags", () => {
    expect(
      parseCli([
        "--",
        "--escrever",
        "--uf",
        "pe, ap",
        "--aceitar-te-derivado",
        "--exigir-soma-exata",
        "--zonas-dir",
        "x",
        "--ea12",
        "y.json",
        "--eleicao",
        "21272",
      ]),
    ).toMatchObject({
      escrever: true,
      ufs: ["PE", "AP"],
      aceitarTeDerivado: true,
      exigirSomaExata: true,
      zonasDir: "x",
      ea12: "y.json",
      eleicao: "21272",
    });
  });

  it("recusa flag desconhecida, URL no --ea12 (o script não faz rede), UF e eleição inválidas, valor ausente", () => {
    expect(() => parseCli(["--foo"])).toThrow(/Flag desconhecida: --foo/);
    expect(() => parseCli(["--ea12", "https://resultados-sim.tse.jus.br/x.json"])).toThrow(
      /não faz rede/,
    );
    expect(() => parseCli(["--uf", "AP,XYZ"])).toThrow(/--uf inválida: "XYZ"/);
    expect(() => parseCli(["--eleicao", "ele2026/21270"])).toThrow(/--eleicao inválida/);
    expect(() => parseCli(["--uf"])).toThrow(/exige um valor/);
    expect(() => parseCli(["--uf", "--escrever"])).toThrow(/exige um valor/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executar — com cliente de banco FALSO que registra todo SQL
// ─────────────────────────────────────────────────────────────────────────────

interface EstadoFalso {
  zonas: Par[];
  pesos: Peso[];
}

/**
 * Banco falso em memória com semântica de transação (BEGIN copia, ROLLBACK
 * restaura, COMMIT confirma) e respostas dependentes do SQL EXATO exportado
 * por `zonas-faltantes-import.ts` — se o script trocar um SQL, o teste avisa.
 */
function bancoFalso(
  opts: {
    somaAposInsert?: (real: number) => number;
    zonasAposInsert?: (real: number) => number;
  } = {},
) {
  const log: string[] = [];
  const params: { sql: string; params: unknown[] | undefined }[] = [];
  let real: EstadoFalso = { zonas: [...zonasBanco], pesos: [...pesosBanco] };
  let copia: EstadoFalso | null = null;
  const client: Consulta = {
    async query(sql: string, p?: unknown[]) {
      const s = sql.trim();
      log.push(s.split("\n")[0]!.trim());
      params.push({ sql, params: p });
      if (s.startsWith("BEGIN")) {
        copia = { zonas: [...real.zonas], pesos: [...real.pesos] };
        return { rows: [] };
      }
      if (s === "ROLLBACK") {
        if (copia) real = copia;
        copia = null;
        return { rows: [] };
      }
      if (s === "COMMIT") {
        copia = null;
        return { rows: [] };
      }
      if (sql === SQL_ZONAS) {
        return {
          rows: real.zonas.map((z) => ({
            uf: z.uf,
            cod_municipio_tse: z.codMunicipioTse,
            cod_zona: z.codZona,
          })),
        };
      }
      if (sql === SQL_PESOS) {
        return {
          rows: real.pesos.map((z) => ({
            uf: z.uf,
            cod_municipio_tse: z.codMunicipioTse,
            cod_zona: z.codZona,
            eleitores_aptos: z.eleitoresAptos,
          })),
        };
      }
      if (sql === SQL_AGREGADOS) {
        return { rows: [...agregados].map(([uf, te]) => ({ uf, te: String(te) })) };
      }
      if (sql === SQL_TE_ZONAS) {
        const [ufs, muns, zs] = p as [string[], number[], number[]];
        const rows: unknown[] = [];
        for (const [i, uf] of ufs.entries()) {
          const te = teSnapshots.get(`${uf}|${muns[i]}|${zs[i]}`);
          if (te !== undefined) {
            rows.push({ uf, cod_municipio_tse: muns[i], cod_zona: zs[i], te: String(te) });
          }
        }
        return { rows };
      }
      if (sql === SQL_MUNICIPIOS) {
        const [cods] = p as [number[]];
        return {
          rows: cods
            .filter((c) => c === 6050 || c === 30015)
            .map((c) => ({ cod_municipio_tse: c })),
        };
      }
      if (sql === SQL_INSERT_ZONAS) {
        const [ufs, muns, zs] = p as [string[], number[], number[]];
        for (const [i, uf] of ufs.entries()) {
          real.zonas.push({ uf, codMunicipioTse: muns[i]!, codZona: zs[i]! });
        }
        return { rows: [] };
      }
      if (sql === SQL_INSERT_PESOS) {
        const [, ufs, muns, zs, tes] = p as [number[], string[], number[], number[], number[]];
        for (const [i, uf] of ufs.entries()) {
          real.pesos.push({
            uf,
            codMunicipioTse: muns[i]!,
            codZona: zs[i]!,
            eleitoresAptos: tes[i]!,
          });
        }
        return { rows: [] };
      }
      if (sql === SQL_SOMA_UF) {
        const uf = (p as [number, string])[1];
        const soma = real.pesos
          .filter((x) => x.uf === uf)
          .reduce((a, x) => a + x.eleitoresAptos, 0);
        return {
          rows: [{ soma: String(opts.somaAposInsert ? opts.somaAposInsert(soma) : soma), n: "0" }],
        };
      }
      if (sql === SQL_CONTA_ZONAS_UF) {
        const uf = (p as [string])[0];
        const n = real.zonas.filter((x) => x.uf === uf).length;
        return { rows: [{ n: String(opts.zonasAposInsert ? opts.zonasAposInsert(n) : n) }] };
      }
      throw new Error(`SQL não previsto no banco falso: ${s.slice(0, 80)}`);
    },
  };
  return { client, log, params, estado: () => real };
}

const cliDe = (sobre: Partial<Cli> = {}): Cli => ({
  ...OPCOES,
  ea12: null,
  zonasDir: null,
  eleicao: "21270",
  ...sobre,
});
const entradas = { ea12Raw: ea12Recortado(["AP", "PE"]), arquivosZona: new Map() };
const mudo = () => {};

describe("executar — simulação", () => {
  it("SÓ lê: todo SQL emitido é BEGIN TRANSACTION READ ONLY, SELECT ou ROLLBACK — nunca INSERT/UPDATE/DELETE", async () => {
    const b = bancoFalso();
    const r = await executar(b.client, cliDe(), entradas, mudo);
    expect(r.escreveu).toBe(false);
    expect(b.params[0]!.sql).toBe("BEGIN TRANSACTION READ ONLY");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    for (const { sql } of b.params) {
      expect(sql.trim()).toMatch(/^(BEGIN TRANSACTION READ ONLY|ROLLBACK|SELECT|WITH)/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    }
    expect(b.estado().zonas).toHaveLength(zonasBanco.length);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
  });

  it("imprime o diff, o te de cada faltante, as linhas e a verificação (AP PIORA, PE MELHORA)", async () => {
    const b = bancoFalso();
    const linhas: string[] = [];
    await executar(b.client, cliDe(), entradas, (s) => linhas.push(s));
    const saida = linhas.join("\n");
    expect(saida).toContain("=== 1. Diff nacional");
    expect(saida).toContain("AP 06050×0014 MACAPÁ");
    expect(saida).toContain("PE 30015×0004 FERNANDO DE NORONHA");
    expect(saida).toContain("('AP', 6050, 14, NULL, 'ea12')");
    expect(saida).toContain("(2026, 'AP', 6050, 14, 122461, NULL)");
    expect(saida).toContain("(2026, 'PE', 30015, 4, 4954, NULL)");
    expect(saida).toMatch(
      /AP: agregado=628\.071 · Σ antes=571\.248 \(-56\.823\) · Σ depois=693\.709 \(\+65\.638\) → PIORA/,
    );
    expect(saida).toMatch(/PE: .* → MELHORA/);
    expect(saida).toContain("[modo simulação — nada foi escrito");
  });

  it("não consulta te de zona nem municípios quando não há par faltante", async () => {
    const b = bancoFalso();
    b.estado().zonas.push(AP_14, PE_NORONHA_4);
    await executar(b.client, cliDe(), entradas, mudo);
    expect(b.params.some((x) => x.sql === SQL_TE_ZONAS)).toBe(false);
    expect(b.params.some((x) => x.sql === SQL_MUNICIPIOS)).toBe(false);
  });
});

describe("executar — --escrever", () => {
  it("BLOQUEADO (padrão): lança, faz ROLLBACK e não emite nenhum INSERT", async () => {
    const b = bancoFalso();
    await expect(
      executar(b.client, cliDe({ escrever: true }), entradas, mudo),
    ).rejects.toBeInstanceOf(BloqueadoError);
    expect(b.params.some((x) => /INSERT/.test(x.sql))).toBe(false);
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
  });

  it("PE liberado: insere Noronha em zonas E em eleitorado (arrays certos), confere e faz COMMIT", async () => {
    const b = bancoFalso();
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    const r = await executar(b.client, cli, entradas, mudo);
    expect(r.escreveu).toBe(true);

    const insZ = b.params.find((x) => x.sql === SQL_INSERT_ZONAS)!;
    expect(insZ.params).toEqual([["PE"], [30015], [4], [null], ["ea12"]]);
    const insP = b.params.find((x) => x.sql === SQL_INSERT_PESOS)!;
    expect(insP.params).toEqual([[2026], ["PE"], [30015], [4], [4954], [null]]);

    // ordem: BEGIN → leituras → INSERTs → conferências → COMMIT
    const ordem = b.params.map((x) => x.sql);
    const iZ = ordem.indexOf(SQL_INSERT_ZONAS);
    const iP = ordem.indexOf(SQL_INSERT_PESOS);
    const iSoma = ordem.indexOf(SQL_SOMA_UF);
    expect(ordem[0]).toBe("BEGIN");
    expect(iZ).toBeGreaterThan(ordem.indexOf(SQL_PESOS));
    expect(iP).toBeGreaterThan(iZ);
    expect(iSoma).toBeGreaterThan(iP);
    expect(ordem.at(-1)).toBe("COMMIT");

    // estado final: exatamente 1 linha nova em cada tabela; AP intocada; nada de UPDATE/DELETE
    expect(b.estado().zonas).toHaveLength(zonasBanco.length + 1);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length + 1);
    expect(b.estado().zonas.filter((z) => z.uf === "AP")).toHaveLength(17);
    expect(b.params.some((x) => /\b(UPDATE|DELETE)\b/i.test(x.sql))).toBe(false);
  });

  it("conferência pós-inserção divergente → ROLLBACK e nada fica no banco", async () => {
    const b = bancoFalso({ somaAposInsert: (real) => real + 1 });
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    await expect(executar(b.client, cli, entradas, mudo)).rejects.toThrow(
      /Σ eleitorado após a inserção/,
    );
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(b.estado().zonas).toHaveLength(zonasBanco.length);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
  });

  it("contagem de zonas após a inserção divergente → ROLLBACK", async () => {
    const b = bancoFalso({ zonasAposInsert: (n) => n + 1 });
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    await expect(executar(b.client, cli, entradas, mudo)).rejects.toThrow(
      /count\(zonas\) após a inserção/,
    );
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.estado().zonas).toHaveLength(zonasBanco.length);
  });

  it("os dois INSERTs são ON CONFLICT DO NOTHING — nunca sobrescrevem linha existente", () => {
    expect(SQL_INSERT_ZONAS).toMatch(/ON CONFLICT \(uf, cod_municipio_tse, cod_zona\) DO NOTHING/);
    expect(SQL_INSERT_PESOS).toMatch(
      /ON CONFLICT \(ano, uf, cod_municipio_tse, cod_zona\) DO NOTHING/,
    );
    expect(SQL_INSERT_ZONAS + SQL_INSERT_PESOS).not.toMatch(/DO UPDATE/);
  });

  it("segunda execução (idempotência): banco já tem os pares → 'nada a inserir', sem INSERT", async () => {
    const b = bancoFalso();
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    await executar(b.client, cli, entradas, mudo);
    const antes = b.params.length;
    const linhas: string[] = [];
    const r = await executar(b.client, cli, entradas, (s) => linhas.push(s));
    expect(r.escreveu).toBe(false);
    expect(linhas.join("\n")).toContain("nada a inserir");
    expect(b.params.slice(antes).some((x) => /INSERT/.test(x.sql))).toBe(false);
  });

  it("arquivo de zona de um par que NÃO está faltando é ignorado com aviso (nunca vira peso)", async () => {
    const b = bancoFalso();
    const arquivosZona = new Map([
      ["AP|6017|1", { te: 1, arquivo: "ap06017-z0001-c0001-e021270-u.json" }],
    ]);
    const linhas: string[] = [];
    await executar(
      b.client,
      cliDe({ ufs: ["PE"], aceitarTeDerivado: true }),
      { ea12Raw: ea12Recortado(["AP", "PE"]), arquivosZona },
      (s) => linhas.push(s),
    );
    expect(linhas.join("\n")).toContain("ignorado: o par não está entre os faltantes");
  });
});
