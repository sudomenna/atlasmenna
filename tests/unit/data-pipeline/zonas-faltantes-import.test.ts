// tests/unit/data-pipeline/zonas-faltantes-import.test.ts
//
// `data-pipeline/zonas-faltantes-nucleo.ts` (lógica pura) e a costura de
// `zonas-faltantes-import.ts` (`executar`, com um cliente de banco FALSO).
// NENHUM teste abre conexão real ou toca a rede: o banco de produção é o alvo do
// script, e a garantia de que a simulação nunca escreve é justamente um teste
// aqui (o cliente falso registra todo SQL e a simulação só pode emitir leitura).
//
// Além da inserção (o escopo original), cobre os dois modos opt-in de 29/09:
// `--recalcular-pesos-uf` (UPDATE dos pesos da UF para o te 2026) e
// `--remover-fantasmas` (DELETE da lista fechada de pares fora do EA12), com a
// transação única, o backup ANTES da escrita e o SQL de desfazer.
//
// Os números de AP e PE vêm de uma MEDIÇÃO real de 29/09 contra produção
// (somente SELECT), guardada em
// `tests/fixtures/tse/2026-sim/zonas-faltantes/medidas-2026-09-29.json`; o EA12 é
// o real do simulado (`mun-e021270-cm.json`), e o arquivo de zona é um EA20 real
// do DF (o formato é o mesmo do de AP/PE, que ainda não foram baixados).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Backup,
  BloqueadoError,
  type Consulta,
  type Escrita,
  escritasDoPlano,
  executar,
  executarPesosOficiais,
  nomeDoBackup,
  SQL_AGREGADOS,
  SQL_ANOS_ELEITORADO,
  SQL_CONTA_ZONAS_UF,
  SQL_DELETE_PESOS,
  SQL_DELETE_ZONAS,
  SQL_INSERT_PESOS,
  SQL_INSERT_ZONAS,
  SQL_LINHAS_ELEITORADO,
  SQL_LINHAS_ZONAS,
  SQL_MUNICIPIOS,
  SQL_PESOS,
  SQL_SNAPSHOTS_POR_PAR,
  SQL_SOMA_UF,
  SQL_TE_ZONAS,
  SQL_UPDATE_PESOS,
  SQL_ZONAS,
  salvarBackupEmDisco,
} from "@/data-pipeline/zonas-faltantes-import.ts";
import {
  alvosDeTe,
  type Cli,
  COLUNAS_OFICIAIS_PADRAO,
  chaveDoPar,
  desviosDePeso,
  diferencasDeEstado,
  diffPares,
  type EntradaPlano,
  estadoFinal,
  extrairTeDeArquivoZona,
  FANTASMAS_AUTORIZADOS,
  faltantesNoEscopo,
  lerParesDoEa12,
  nomeArquivoZona,
  type Par,
  type ParEa12,
  type Peso,
  parseCli,
  parseNomeArquivoZona,
  planejar,
  planejarFantasmas,
  resolverTeDosFaltantes,
  resumoPorUf,
  sqlDesfazer,
  tabelaPorUf,
  ValidacaoError,
  verificarTotais,
} from "@/data-pipeline/zonas-faltantes-nucleo.ts";
import {
  agregarPerfil,
  type ContagemOficial,
  type EntradaPlanoOficial,
  estadoFinalOficial,
  lerPerfilOficial,
  planejarPesosOficiais,
} from "@/data-pipeline/zonas-pesos-oficiais.ts";

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

const OPCOES = {
  escrever: false,
  ufs: [],
  aceitarTeDerivado: false,
  exigirSomaExata: false,
  recalcularPesosUf: [],
  removerFantasmas: false,
  soEstrutural: false,
};
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
// Modos opt-in de 29/09 — fixtures comuns
// ─────────────────────────────────────────────────────────────────────────────

const chaveDe = (p: Par): string => chaveDoPar(p);
/** Os 6 fantasmas de PI/SP: em `zonas`, sem peso (o PE 25313×1 já está na medição, com peso). */
const SEIS_FANTASMAS: Par[] = FANTASMAS_AUTORIZADOS.filter((g) => g.uf !== "PE");
const zonasComFantasmas: Par[] = [...zonasBanco, ...SEIS_FANTASMAS];
const zeroSnapshots = new Map<string, number>(FANTASMAS_AUTORIZADOS.map((g) => [chaveDe(g), 0]));
const OPC_AP = { ...OPCOES, recalcularPesosUf: ["AP"], aceitarTeDerivado: true };
const OPC_TUDO = { ...OPC_AP, removerFantasmas: true };

// ─────────────────────────────────────────────────────────────────────────────
// planejarFantasmas
// ─────────────────────────────────────────────────────────────────────────────

describe("planejarFantasmas", () => {
  const base = () => ({
    ea12,
    zonas: zonasComFantasmas,
    pesos: pesosBanco,
    snapshotsPorPar: zeroSnapshots,
    ufsEscopo: new Set<string>(),
  });

  it("a lista autorizada é FECHADA: exatamente os 7 pares que o dono nomeou", () => {
    expect(FANTASMAS_AUTORIZADOS.map(chaveDe)).toEqual([
      "PE|25313|1",
      "PI|10170|92",
      "PI|11118|75",
      "PI|11452|83",
      "PI|11495|31",
      "PI|11614|55",
      "SP|71072|398",
    ]);
  });

  it("remove os 7 de `zonas` e, de `eleitorado`, só o PE 25313×1 (os outros 6 não têm peso)", () => {
    const f = planejarFantasmas(base());
    expect(f.bloqueios).toEqual([]);
    expect(f.remocoesZonas.map(chaveDe)).toEqual(FANTASMAS_AUTORIZADOS.map(chaveDe));
    expect(f.remocoesPesos.map((p) => [chaveDe(p), p.eleitoresAptos])).toEqual([
      ["PE|25313|1", 115861],
    ]);
    expect(f.naoAutorizados).toEqual([]);
    expect(f.jaRemovidos).toEqual([]);
  });

  it("RECUSA o par que tem snapshot (par com histórico nunca sai — snapshots são append-only)", () => {
    const f = planejarFantasmas({
      ...base(),
      snapshotsPorPar: new Map([...zeroSnapshots, ["PI|11118|75", 3]]),
    });
    expect(f.bloqueios).toHaveLength(1);
    expect(f.bloqueios[0]).toMatch(/PI 11118×0075: tem 3 snapshot\(s\).*append-only/);
    expect(f.remocoesZonas.map(chaveDe)).not.toContain("PI|11118|75");
    expect(f.remocoesZonas).toHaveLength(6);
  });

  it("um ÚNICO snapshot já basta para recusar (limiar: 0 remove, 1 recusa)", () => {
    const um = planejarFantasmas({
      ...base(),
      snapshotsPorPar: new Map([...zeroSnapshots, ["PE|25313|1", 1]]),
    });
    expect(um.bloqueios).toHaveLength(1);
    expect(um.bloqueios[0]).toMatch(/PE 25313×0001: tem 1 snapshot\(s\)/);
    expect(um.remocoesPesos).toEqual([]); // o par com histórico leva o peso junto: nada sai dele
    const zero = planejarFantasmas(base());
    expect(zero.bloqueios).toEqual([]);
  });

  it("RECUSA o par que o EA12 passou a listar (deixou de ser fantasma)", () => {
    const ea12Com: ParEa12[] = [
      ...ea12,
      { uf: "PI", codMunicipioTse: 11118, codZona: 75, nomeMunicipio: "X" },
    ];
    const f = planejarFantasmas({ ...base(), ea12: ea12Com });
    expect(f.bloqueios).toHaveLength(1);
    expect(f.bloqueios[0]).toMatch(/PI 11118×0075: o EA12 agora LISTA este par/);
    expect(f.remocoesZonas.map(chaveDe)).not.toContain("PI|11118|75");
  });

  it("RECUSA quando a contagem de snapshots do par não foi lida (sem prova, sem remoção)", () => {
    const f = planejarFantasmas({ ...base(), snapshotsPorPar: new Map() });
    expect(f.bloqueios).toHaveLength(7);
    expect(f.bloqueios.every((b) => b.includes("contagem de snapshots não lida"))).toBe(true);
    expect(f.remocoesZonas).toEqual([]);
    expect(f.remocoesPesos).toEqual([]);
  });

  it("reexecução: par que já não está em `zonas` nem em `eleitorado` não é erro", () => {
    const kAut = new Set(FANTASMAS_AUTORIZADOS.map(chaveDe));
    const f = planejarFantasmas({
      ...base(),
      zonas: zonasComFantasmas.filter((z) => !kAut.has(chaveDe(z))),
      pesos: pesosBanco.filter((p) => !kAut.has(chaveDe(p))),
      snapshotsPorPar: new Map(),
    });
    expect(f.jaRemovidos).toHaveLength(7);
    expect(f.bloqueios).toEqual([]);
    expect(f.remocoesZonas).toEqual([]);
  });

  it("par fora da lista nunca é removido, só apontado (um EA12 truncado não vira faxina)", () => {
    const extra: Par = { uf: "MG", codMunicipioTse: 1, codZona: 1 };
    const f = planejarFantasmas({ ...base(), zonas: [...zonasComFantasmas, extra] });
    expect(f.naoAutorizados.map(chaveDe)).toEqual(["MG|1|1"]);
    expect(f.remocoesZonas.map(chaveDe)).not.toContain("MG|1|1");
  });

  it("--uf restringe a remoção às UFs pedidas", () => {
    const f = planejarFantasmas({ ...base(), ufsEscopo: new Set(["PI"]) });
    expect(f.remocoesZonas.map(chaveDe)).toEqual([
      "PI|10170|92",
      "PI|11118|75",
      "PI|11452|83",
      "PI|11495|31",
      "PI|11614|55",
    ]);
    expect(f.remocoesPesos).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// faltantesNoEscopo / alvosDeTe
// ─────────────────────────────────────────────────────────────────────────────

describe("faltantesNoEscopo / alvosDeTe", () => {
  it("as UFs de --recalcular-pesos-uf entram no escopo mesmo fora de --uf (senão a soma não fecha)", () => {
    const f = faltantesNoEscopo(ea12, zonasBanco, { ufs: ["PE"], recalcularPesosUf: ["AP"] });
    expect(f.map(chaveDe)).toEqual([chaveDe(AP_14), chaveDe(PE_NORONHA_4)]);
    const soPe = faltantesNoEscopo(ea12, zonasBanco, { ufs: ["PE"], recalcularPesosUf: [] });
    expect(soPe.map(chaveDe)).toEqual([chaveDe(PE_NORONHA_4)]);
  });

  it("alvosDeTe = faltantes + pares de UF recalculada sem te em snapshot; UF comum não ganha alvo extra", () => {
    const semUm = new Map(teSnapshots);
    semUm.delete("AP|6017|1");
    semUm.delete("PE|23000|98"); // PE não é recalculada: não vira alvo
    const alvos = alvosDeTe(ea12, zonasBanco, { ufs: [], recalcularPesosUf: ["AP"] }, semUm);
    expect(alvos.map(chaveDe)).toEqual(["AP|6017|1", chaveDe(AP_14), chaveDe(PE_NORONHA_4)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verificarTotais com atualizações e remoções
// ─────────────────────────────────────────────────────────────────────────────

describe("verificarTotais — atualizações e remoções", () => {
  it("separa o efeito das INSERÇÕES do efeito das remoções: PE piora pela remoção, melhora pela inserção", () => {
    const orfao: Peso = { uf: "PE", codMunicipioTse: 25313, codZona: 1, eleitoresAptos: 115861 };
    const [v] = verificarTotais({
      pesosAtuais: pesosBanco,
      novosPesos: [
        {
          ...ea12.find((p) => chaveDe(p) === chaveDe(PE_NORONHA_4))!,
          te: 4954,
          fonte: "derivado",
          residuoUf: 4954,
        },
      ],
      removidos: [orfao],
      agregadoPorUf: agregados,
    });
    expect(v).toMatchObject({
      uf: "PE",
      somaPesosAntes: 7152871,
      somaPesosAntesDasInsercoes: 7037010,
      somaPesosDepois: 7041964,
      gapAntes: -242762,
      gapAntesDasInsercoes: -358623,
      gapDepois: -353669,
      situacao: "PIORA", // final × antes de tudo
      situacaoInsercao: "MELHORA", // a inserção sozinha aproxima
    });
  });

  it("atualizações entram como Δ (para − de); recálculo do AP com o par novo FECHA no agregado", () => {
    const atualizacoes = medidas.pares
      .filter((p) => p.uf === "AP")
      .map((p) => ({
        par: {
          uf: p.uf,
          codMunicipioTse: p.mun,
          codZona: p.zona,
          nomeMunicipio: "X",
        },
        de: p.peso as number,
        para: p.te as number,
        fonte: "snapshot" as const,
      }));
    const [v] = verificarTotais({
      pesosAtuais: pesosBanco,
      novosPesos: [
        {
          ...ea12.find((p) => chaveDe(p) === chaveDe(AP_14))!,
          te: 122461,
          fonte: "derivado",
          residuoUf: 122461,
        },
      ],
      atualizacoes,
      agregadoPorUf: agregados,
    });
    expect(v).toMatchObject({
      uf: "AP",
      somaPesosAntes: 571248,
      somaPesosAntesDasInsercoes: 505610,
      somaPesosDepois: 628071,
      gapDepois: 0,
      situacao: "FECHA",
    });
  });

  it("ufsExtras verifica a UF mesmo sem nenhuma linha nova (recálculo que já estava fechado)", () => {
    const r = verificarTotais({
      pesosAtuais: [{ uf: "AP", codMunicipioTse: 1, codZona: 1, eleitoresAptos: 1000 }],
      novosPesos: [],
      agregadoPorUf: new Map([["AP", 1000]]),
      ufsExtras: ["AP"],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ situacao: "FECHA", gapDepois: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planejar — recálculo dos pesos do AP (medição real)
// ─────────────────────────────────────────────────────────────────────────────

describe("planejar — --recalcular-pesos-uf AP (medição real de 29/09)", () => {
  it("regrava os 17 pesos com o te 2026 e insere Macapá 14 (derivado): Σ == agregado 628.071 (FECHA), sem bloqueio", () => {
    const p = planejar(entrada({ opcoes: OPC_AP }));
    expect(p.bloqueios).toEqual([]);
    expect(p.atualizacoesPesos).toHaveLength(17);
    const m2 = p.atualizacoesPesos.find((a) => chaveDe(a.par) === "AP|6050|2")!;
    const m10 = p.atualizacoesPesos.find((a) => chaveDe(a.par) === "AP|6050|10")!;
    expect([m2.de, m2.para, m2.fonte]).toEqual([176626, 112346, "snapshot"]);
    expect([m10.de, m10.para, m10.fonte]).toEqual([134192, 84450, "snapshot"]);
    expect(
      p.insercoesPesos.filter((r) => r.uf === "AP").map((r) => [chaveDe(r), r.te, r.fonte]),
    ).toEqual([["AP|6050|14", 122461, "derivado"]]);
    expect(p.insercoesZonas.filter((z) => z.uf === "AP").map(chaveDe)).toEqual(["AP|6050|14"]);
    expect(p.verificacoes.find((v) => v.uf === "AP")).toMatchObject({
      agregadoTe: 628071,
      somaPesosAntes: 571248,
      somaPesosDepois: 628071,
      gapDepois: 0,
      situacao: "FECHA",
    });
    // PE não foi pedida no recálculo: continua só inserindo Noronha, sem tocar nos vizinhos
    expect(p.atualizacoesPesos.some((a) => a.par.uf === "PE")).toBe(false);
  });

  it("o recálculo NÃO contorna o aval do te derivado", () => {
    const p = planejar(entrada({ opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"] } }));
    expect(p.bloqueios.some((b) => b.startsWith("1 par(es) com te DERIVADO (AP 06050×0014)"))).toBe(
      true,
    );
  });

  it("com o arquivo-zona de Macapá 14 (122.461) o te vem da fonte oficial e fecha sem aval", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"] },
        teArquivos: new Map([[chaveDe(AP_14), 122461]]),
      }),
    );
    expect(p.bloqueios).toEqual([]);
    expect(p.insercoesPesos[0]).toMatchObject({ fonte: "arquivo-zona", te: 122461 });
    expect(p.verificacoes[0]).toMatchObject({ uf: "AP", situacao: "FECHA" });
  });

  it("arquivo-zona que NÃO fecha com o agregado bloqueia duas vezes: conferência cruzada e soma final", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"] },
        teArquivos: new Map([[chaveDe(AP_14), 122000]]),
      }),
    );
    expect(
      p.bloqueios.some((b) =>
        b.includes("AP: Σ te dos arquivos de zona (122.000) ≠ agregado − Σ demais pares (122.461)"),
      ),
    ).toBe(true);
    expect(
      p.bloqueios.some((b) =>
        b.includes("AP: recalcular os pesos NÃO fecha com o agregado do TSE (Σ pesos 627.610"),
      ),
    ).toBe(true);
  });

  it("um segundo par de AP sem te em snapshot: dois pares sem arquivo não se separam → bloqueio (nunca recálculo parcial)", () => {
    const semUm = new Map(teSnapshots);
    semUm.delete("AP|6017|1");
    const p = planejar(entrada({ opcoes: OPC_AP, teZonaSnapshots: semUm }));
    expect(
      p.bloqueios.some((b) =>
        /AP: 2 par\(es\) faltante\(s\) sem arquivo de zona \(AP 06017×0001, AP 06050×0014\)/.test(
          b,
        ),
      ),
    ).toBe(true);
  });

  it("depois de gravar (par em `zonas`, ainda sem te em snapshot): deriva o mesmo resíduo e NADA muda", () => {
    const aposZonas = [...zonasBanco, AP_14];
    const aposPesos: Peso[] = pesosBanco
      .map((p) =>
        p.uf === "AP" ? { ...p, eleitoresAptos: teSnapshots.get(chaveDe(p)) as number } : p,
      )
      .concat([{ ...AP_14, eleitoresAptos: 122461 }]);
    const p = planejar(
      entrada({
        zonas: aposZonas,
        pesos: aposPesos,
        opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"], aceitarTeDerivado: true },
      }),
    );
    expect(p.bloqueios).toEqual([]);
    expect(p.atualizacoesPesos).toEqual([]);
    expect(p.insercoesPesos).toEqual([]);
    expect(p.insercoesZonas).toEqual([]);
    expect(p.inalteradosNoRecalculo).toBe(18);
    expect(p.verificacoes.find((v) => v.uf === "AP")).toMatchObject({
      situacao: "FECHA",
      gapDepois: 0,
    });
  });

  it("peso órfão numa UF recalculada que ninguém remove → bloqueio (a soma não fecharia)", () => {
    const p = planejar(
      entrada({
        opcoes: OPC_AP,
        pesos: [
          ...pesosBanco,
          { uf: "AP", codMunicipioTse: 9999, codZona: 1, eleitoresAptos: 500 },
        ],
      }),
    );
    expect(
      p.bloqueios.some((b) =>
        b.includes("AP: 1 linha(s) de peso de par que o EA12 não lista (AP 09999×0001: 500)"),
      ),
    ).toBe(true);
  });

  it("agregado que não fecha (adulterado) → bloqueio com o desvio; sem agregado → bloqueio", () => {
    const naoFecha = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"] },
        teArquivos: new Map([[chaveDe(AP_14), 122461]]),
        agregadoPorUf: new Map([
          ["AP", 628072],
          ["PE", 7395633],
        ]),
      }),
    );
    expect(
      naoFecha.bloqueios.some((b) =>
        b.includes("AP: recalcular os pesos NÃO fecha com o agregado do TSE"),
      ),
    ).toBe(true);
    const semAgg = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["AP"], recalcularPesosUf: ["AP"] },
        teArquivos: new Map([[chaveDe(AP_14), 122461]]),
        agregadoPorUf: new Map([["PE", 7395633]]),
      }),
    );
    expect(semAgg.bloqueios.some((b) => b.startsWith("AP: sem agregado de UF"))).toBe(true);
  });

  it("UF pedida que não existe no EA12 → bloqueio", () => {
    const p = planejar(entrada({ opcoes: { ...OPCOES, recalcularPesosUf: ["XX"] } }));
    expect(
      p.bloqueios.some((b) => b.startsWith("XX: --recalcular-pesos-uf sem nenhum par no EA12")),
    ).toBe(true);
  });

  it("sem o flag nada é atualizado: peso existente diferente continua bloqueando (comportamento de antes)", () => {
    const p = planejar(
      entrada({
        opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true },
        pesos: [...pesosBanco, { ...PE_NORONHA_4, eleitoresAptos: 3000 }],
      }),
    );
    expect(p.atualizacoesPesos).toEqual([]);
    expect(p.bloqueios.some((b) => b.includes("--recalcular-pesos-uf PE"))).toBe(true);
  });

  it("--exigir-soma-exata: o AP recalculado passa; só o PE (que não fecha) bloqueia", () => {
    const p = planejar(entrada({ opcoes: { ...OPC_AP, exigirSomaExata: true } }));
    expect(p.bloqueios).toHaveLength(1);
    expect(p.bloqueios[0]).toMatch(/^PE: --exigir-soma-exata/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planejar — remoção dos fantasmas
// ─────────────────────────────────────────────────────────────────────────────

describe("planejar — --remover-fantasmas", () => {
  it("PE: a remoção AFASTA a soma do agregado, a inserção a aproxima — vira aviso explícito, não bloqueio", () => {
    const p = planejar(
      entrada({
        zonas: zonasComFantasmas,
        snapshotsPorPar: zeroSnapshots,
        opcoes: { ...OPCOES, ufs: ["PE"], removerFantasmas: true, aceitarTeDerivado: true },
      }),
    );
    expect(p.bloqueios).toEqual([]);
    expect(p.fantasmas.remocoesZonas.map(chaveDe)).toEqual(["PE|25313|1"]); // --uf PE
    const v = p.verificacoes.find((x) => x.uf === "PE")!;
    expect(v).toMatchObject({
      somaPesosAntes: 7152871,
      somaPesosDepois: 7041964,
      situacao: "PIORA",
      situacaoInsercao: "MELHORA",
    });
    expect(
      p.avisos.some(
        (a) =>
          a.includes("PE: remover PE 25313×0001 tira 115.861 eleitores da soma e a AFASTA") &&
          a.includes("--recalcular-pesos-uf PE"),
      ),
    ).toBe(true);
  });

  it("os 7 juntos com o recálculo do AP: sem bloqueio; remove 7 linhas de zonas e 1 de eleitorado", () => {
    const p = planejar(
      entrada({ zonas: zonasComFantasmas, snapshotsPorPar: zeroSnapshots, opcoes: OPC_TUDO }),
    );
    expect(p.bloqueios).toEqual([]);
    expect(p.fantasmas.remocoesZonas).toHaveLength(7);
    expect(p.fantasmas.remocoesPesos).toHaveLength(1);
  });

  it("um fantasma com snapshot bloqueia o plano inteiro (nunca remoção parcial)", () => {
    const p = planejar(
      entrada({
        zonas: zonasComFantasmas,
        snapshotsPorPar: new Map([...zeroSnapshots, ["SP|71072|398", 12]]),
        opcoes: OPC_TUDO,
      }),
    );
    expect(p.bloqueios.some((b) => b.startsWith("SP 71072×0398: tem 12 snapshot(s)"))).toBe(true);
  });

  it("sem --remover-fantasmas nada é removido; os 7 seguem como aviso", () => {
    const p = planejar(entrada({ zonas: zonasComFantasmas, opcoes: OPC_AP }));
    expect(p.fantasmas.remocoesZonas).toEqual([]);
    expect(p.avisos.some((a) => a.includes("sem --remover-fantasmas este script não remove"))).toBe(
      true,
    );
  });

  it("what-if do dono: recalcular o PE junto FECHA a soma do PE no agregado (7.395.633)", () => {
    const p = planejar(
      entrada({
        zonas: zonasComFantasmas,
        snapshotsPorPar: zeroSnapshots,
        opcoes: { ...OPC_TUDO, recalcularPesosUf: ["AP", "PE"] },
      }),
    );
    expect(p.bloqueios).toEqual([]);
    expect(p.verificacoes.find((v) => v.uf === "PE")).toMatchObject({
      somaPesosDepois: 7395633,
      gapDepois: 0,
      situacao: "FECHA",
    });
    // o peso órfão do Recife sai e o par novo entra: nenhum peso de PE fica sem par no EA12
    expect(p.avisos.some((a) => a.includes("AFASTA"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estadoFinal / resumoPorUf / diferencasDeEstado
// ─────────────────────────────────────────────────────────────────────────────

describe("estadoFinal / resumoPorUf / diferencasDeEstado", () => {
  const antes = { zonas: zonasComFantasmas, pesos: pesosBanco };
  const plano = () =>
    planejar(
      entrada({ zonas: zonasComFantasmas, snapshotsPorPar: zeroSnapshots, opcoes: OPC_TUDO }),
    );

  it("aplica inserções, atualizações e remoções: AP 18 pares fechando em 628.071; zonas 231 → 226", () => {
    const depois = estadoFinal(antes, plano());
    expect(depois.zonas).toHaveLength(231 + 2 - 7);
    expect(
      depois.zonas.some((z) => FANTASMAS_AUTORIZADOS.some((g) => chaveDe(g) === chaveDe(z))),
    ).toBe(false);
    const r = resumoPorUf(antes, depois, agregados, ["AP", "PE", "AP"]);
    expect(r.map((x) => x.uf)).toEqual(["AP", "PE"]); // sem duplicata, ordenado
    expect(r[0]).toMatchObject({
      zonasAntes: 17,
      zonasDepois: 18,
      pesosAntes: 17,
      pesosDepois: 18,
      somaAntes: 571248,
      somaDepois: 628071,
      agregadoTe: 628071,
    });
    expect(r[1]).toMatchObject({
      zonasAntes: 208,
      zonasDepois: 208, // −Recife 1 +Noronha 4
      pesosAntes: 208,
      pesosDepois: 208,
      somaAntes: 7152871,
      somaDepois: 7041964,
    });
  });

  it("idempotência: replanejar sobre o estado final não tem nada a inserir, atualizar nem remover", () => {
    const final = estadoFinal(antes, plano());
    const p2 = planejar(
      entrada({
        zonas: final.zonas,
        pesos: final.pesos,
        snapshotsPorPar: new Map(),
        opcoes: OPC_TUDO,
      }),
    );
    expect(p2.bloqueios).toEqual([]);
    expect(p2.insercoesZonas).toEqual([]);
    expect(p2.insercoesPesos).toEqual([]);
    expect(p2.atualizacoesPesos).toEqual([]);
    expect(p2.fantasmas.remocoesZonas).toEqual([]);
    expect(p2.fantasmas.remocoesPesos).toEqual([]);
    expect(p2.fantasmas.jaRemovidos).toHaveLength(7);
    expect(p2.verificacoes.find((v) => v.uf === "AP")).toMatchObject({ situacao: "FECHA" });
  });

  it("diferencasDeEstado: idêntico → []; acusa peso diferente, linha ausente e linha a mais", () => {
    const e = estadoFinal(antes, plano());
    expect(diferencasDeEstado(e, e)).toEqual([]);
    const lido = {
      zonas: [...e.zonas.slice(1), { uf: "ZZ", codMunicipioTse: 1, codZona: 1 }],
      pesos: e.pesos.map((p, i) => (i === 0 ? { ...p, eleitoresAptos: p.eleitoresAptos + 1 } : p)),
    };
    const d = diferencasDeEstado(e, lido, 50);
    expect(
      d.some((x) => x.startsWith("zonas: ") && x.includes("esperado e ausente no banco")),
    ).toBe(true);
    expect(d.some((x) => x.includes("ZZ 00001×0001 presente no banco e não esperado"))).toBe(true);
    expect(d.some((x) => x.startsWith("eleitorado: ") && x.includes("esperado"))).toBe(true);
    expect(diferencasDeEstado(e, lido, 1)).toHaveLength(1); // respeita o limite
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sqlDesfazer
// ─────────────────────────────────────────────────────────────────────────────

describe("sqlDesfazer", () => {
  const entradaSql = {
    zonasRemovidas: [
      { uf: "PI", cod_municipio_tse: 10170, cod_zona: 92, nome: "O'Brien", fonte: "historico" },
    ],
    pesosRemovidos: [
      {
        ano: 2026,
        uf: "PE",
        cod_municipio_tse: 25313,
        cod_zona: 1,
        eleitores_aptos: 115861,
        comparecimento_pct_historico: "0.7812",
      },
    ],
    pesosAtualizados: [
      {
        ano: 2026,
        uf: "AP",
        cod_municipio_tse: 6050,
        cod_zona: 2,
        eleitores_aptos: 176626,
        comparecimento_pct_historico: null,
      },
    ],
    zonasInseridas: [AP_14],
    pesosInseridos: [AP_14],
  };

  it("nada a desfazer → []", () => {
    expect(
      sqlDesfazer({
        zonasRemovidas: [],
        pesosRemovidos: [],
        pesosAtualizados: [],
        zonasInseridas: [],
        pesosInseridos: [],
      }),
    ).toEqual([]);
  });

  it("uma transação, na ordem: recolocar o que saiu → devolver os pesos → apagar o que entrou", () => {
    const sql = sqlDesfazer(entradaSql);
    const txt = sql.join("\n");
    expect(sql[0]).toBe("BEGIN;");
    expect(sql.at(-1)).toBe("COMMIT;");
    const i = (trecho: string) => txt.indexOf(trecho);
    expect(i("INSERT INTO zonas")).toBeGreaterThan(0);
    expect(i("INSERT INTO eleitorado")).toBeGreaterThan(i("INSERT INTO zonas"));
    expect(i("UPDATE eleitorado e SET eleitores_aptos = v.antigo")).toBeGreaterThan(
      i("INSERT INTO eleitorado"),
    );
    expect(i("DELETE FROM eleitorado WHERE ano = 2026")).toBeGreaterThan(i("UPDATE eleitorado"));
    expect(i("DELETE FROM zonas WHERE")).toBeGreaterThan(i("DELETE FROM eleitorado"));
    // valores exatos do estado ANTERIOR
    expect(txt).toContain("('PI', 10170, 92, 'O''Brien', 'historico')"); // aspas escapadas
    expect(txt).toContain("(2026, 'PE', 25313, 1, 115861, 0.7812)");
    expect(txt).toContain("('AP', 6050, 2, 176626)");
    expect(txt).toContain("(uf, cod_municipio_tse, cod_zona) IN (('AP', 6050, 14))");
  });

  it("recusa numeric que não é número (nada de texto solto dentro do SQL) e UPDATE de anos misturados", () => {
    expect(() =>
      sqlDesfazer({
        ...entradaSql,
        pesosRemovidos: [
          { ...entradaSql.pesosRemovidos[0]!, comparecimento_pct_historico: "0.7'; DROP TABLE x" },
        ],
      }),
    ).toThrow(/numeric inesperado/);
    expect(() =>
      sqlDesfazer({
        ...entradaSql,
        pesosAtualizados: [
          ...entradaSql.pesosAtualizados,
          { ...entradaSql.pesosAtualizados[0]!, ano: 2024 },
        ],
      }),
    ).toThrow(/mais de um ano/);
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
      recalcularPesosUf: [],
      removerFantasmas: false,
      soEstrutural: false,
      pesosOficiais: null,
      totalUf: {},
      colunas: {
        uf: "SG_UF",
        municipio: "CD_MUNICIPIO",
        zona: "NR_ZONA",
        qt: "QT_ELEITORES_PERFIL",
      },
      ea12: null,
      zonasDir: null,
      eleicao: "21270",
    });
  });

  it("--recalcular-pesos-uf aceita uma ou mais UFs (sem duplicata, maiúsculas) e --remover-fantasmas é um interruptor", () => {
    expect(parseCli(["--recalcular-pesos-uf", "ap"]).recalcularPesosUf).toEqual(["AP"]);
    expect(parseCli(["--recalcular-pesos-uf", "ap, pe,AP"]).recalcularPesosUf).toEqual([
      "AP",
      "PE",
    ]);
    expect(parseCli(["--remover-fantasmas"]).removerFantasmas).toBe(true);
    // opt-in: nada disso liga sozinho
    expect(parseCli(["--escrever"])).toMatchObject({
      recalcularPesosUf: [],
      removerFantasmas: false,
    });
  });

  it("recusa --recalcular-pesos-uf sem valor, vazio ou com UF inválida", () => {
    expect(() => parseCli(["--recalcular-pesos-uf"])).toThrow(/exige um valor/);
    expect(() => parseCli(["--recalcular-pesos-uf", "--escrever"])).toThrow(/exige um valor/);
    expect(() => parseCli(["--recalcular-pesos-uf", ","])).toThrow(/exige uma UF/);
    expect(() => parseCli(["--recalcular-pesos-uf", "AP,BRASIL"])).toThrow(
      /--recalcular-pesos-uf inválida: "BRASIL"/,
    );
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
// --so-estrutural e a guarda contra te de simulado (decisão do dono, 29/09)
// ─────────────────────────────────────────────────────────────────────────────

const OPC_ESTR = { ...OPCOES, soEstrutural: true };

describe("planejar — --so-estrutural", () => {
  const estrutural = (sobre: Partial<EntradaPlano> = {}) =>
    planejar(
      entrada({
        opcoes: OPC_ESTR,
        ea12Simulado: true,
        teZonaSnapshots: new Map(),
        agregadoPorUf: new Map(),
        ...sobre,
      }),
    );

  it("insere os 2 pares SÓ em zonas: nenhuma linha de eleitorado, nenhum te, sem aval de te derivado, sem bloqueio — mesmo com EA12 do simulado", () => {
    const p = estrutural();
    expect(p.bloqueios).toEqual([]);
    expect(p.insercoesZonas.map(chaveDe)).toEqual([chaveDe(AP_14), chaveDe(PE_NORONHA_4)]);
    expect(p.insercoesZonas.every((z) => z.fonte === "ea12")).toBe(true);
    expect(p.insercoesPesos).toEqual([]);
    expect(p.atualizacoesPesos).toEqual([]);
    expect(p.resolvidos).toEqual([]);
    expect(p.verificacoes).toEqual([]); // o agregado do simulado não é critério
    expect(p.pesosJaExistentes).toEqual([]);
  });

  it("avisa que os pares entram SEM peso: AP 14 (zona sem nenhum peso → votos descartados) e PE 4 (segue com o peso do Recife)", () => {
    const p = estrutural();
    const aviso = p.avisos.find((a) =>
      a.startsWith("modo estrutural: 2 par(es) entram em zonas SEM peso"),
    );
    expect(aviso).toBeDefined();
    expect(aviso).toContain(
      "AP 06050×0014 → zona SEM nenhum peso (peso 0): o modelo DESCARTA os votos dela",
    );
    const wPe4 = pesosBanco
      .filter((x) => x.uf === "PE" && x.codZona === 4)
      .reduce((a, x) => a + x.eleitoresAptos, 0);
    expect(wPe4).toBeGreaterThan(0);
    expect(aviso).toContain(
      `PE 30015×0004 → a zona segue com o peso de ${wPe4.toLocaleString("pt-BR")} dos outros pares, sem a fatia deste`,
    );
  });

  it("nem o te nem o agregado são consultados: com mapas vazios o plano é idêntico", () => {
    const com = estrutural({ teZonaSnapshots: teSnapshots, agregadoPorUf: agregados });
    const sem = estrutural();
    expect(com.insercoesZonas).toEqual(sem.insercoesZonas);
    expect(com.bloqueios).toEqual([]);
  });

  it("com --remover-fantasmas: 7 saem de zonas, 1 peso sai; o aviso do PE mostra o quanto some da soma (sem falar de agregado)", () => {
    const p = estrutural({
      zonas: zonasComFantasmas,
      snapshotsPorPar: zeroSnapshots,
      opcoes: { ...OPC_ESTR, removerFantasmas: true },
    });
    expect(p.bloqueios).toEqual([]);
    expect(p.fantasmas.remocoesZonas).toHaveLength(7);
    expect(p.fantasmas.remocoesPesos.map((x) => [chaveDe(x), x.eleitoresAptos])).toEqual([
      ["PE|25313|1", 115861],
    ]);
    const aviso = p.avisos.find((a) => a.startsWith("PE: remover PE 25313×0001 tira 115.861"));
    expect(aviso).toContain("Σ 7.152.871 → 7.037.010");
    expect(aviso).not.toMatch(/agregado/);
    expect(p.verificacoes).toEqual([]);
  });

  it("FK continua valendo: município ausente de `municipios` bloqueia mesmo sem peso", () => {
    const p = estrutural({ municipiosExistentes: new Set([6050]) });
    expect(
      p.bloqueios.some((b) => b.includes("30015") && b.includes("não existe em `municipios`")),
    ).toBe(true);
  });

  it("fantasma com snapshot continua recusado no estrutural", () => {
    const p = estrutural({
      zonas: zonasComFantasmas,
      snapshotsPorPar: new Map([...zeroSnapshots, ["PI|11118|75", 1]]),
      opcoes: { ...OPC_ESTR, removerFantasmas: true },
    });
    expect(p.bloqueios.some((b) => b.startsWith("PI 11118×0075: tem 1 snapshot(s)"))).toBe(true);
  });

  it("--uf restringe a inserção (AP fica de fora, e é lembrado)", () => {
    const p = estrutural({ opcoes: { ...OPC_ESTR, ufs: ["PE"] } });
    expect(p.insercoesZonas.map(chaveDe)).toEqual([chaveDe(PE_NORONHA_4)]);
    expect(
      p.avisos.some((a) => a.includes("fora do escopo --uf") && a.includes("AP 06050×0014")),
    ).toBe(true);
  });

  it("idempotência: replanejar sobre o estado final não tem nada a inserir nem remover", () => {
    const antes = { zonas: zonasComFantasmas, pesos: pesosBanco };
    const p1 = estrutural({
      zonas: zonasComFantasmas,
      snapshotsPorPar: zeroSnapshots,
      opcoes: { ...OPC_ESTR, removerFantasmas: true },
    });
    const final = estadoFinal(antes, p1);
    expect(final.zonas).toHaveLength(231 + 2 - 7);
    expect(final.pesos).toHaveLength(pesosBanco.length - 1); // só o peso órfão saiu
    const p2 = estrutural({
      zonas: final.zonas,
      pesos: final.pesos,
      snapshotsPorPar: new Map(),
      opcoes: { ...OPC_ESTR, removerFantasmas: true },
    });
    expect(p2.insercoesZonas).toEqual([]);
    expect(p2.fantasmas.remocoesZonas).toEqual([]);
    expect(p2.fantasmas.jaRemovidos).toHaveLength(7);
    expect(p2.bloqueios).toEqual([]);
  });
});

describe("planejar — guarda: nenhum te do SIMULADO vira peso", () => {
  it("EA12 do simulado + inserção com te derivado → bloqueio explicando o porquê", () => {
    const p = planejar(
      entrada({ ea12Simulado: true, opcoes: { ...OPCOES, aceitarTeDerivado: true, ufs: ["PE"] } }),
    );
    expect(p.bloqueios).toHaveLength(1);
    expect(p.bloqueios[0]).toMatch(/1 linha\(s\) de peso viriam do te do SIMULADO/);
    expect(p.bloqueios[0]).toContain("TRE-AP 577.534");
    expect(p.bloqueios[0]).toContain("--so-estrutural");
    expect(p.bloqueios[0]).toContain("--pesos-oficiais");
  });

  it("EA12 do simulado + recálculo do AP → bloqueio (17 atualizações + 1 inserção)", () => {
    const p = planejar(entrada({ ea12Simulado: true, opcoes: { ...OPC_AP, ufs: ["AP"] } }));
    expect(
      p.bloqueios.some((b) => b.startsWith("18 linha(s) de peso viriam do te do SIMULADO")),
    ).toBe(true);
  });

  it("a guarda só liga com EA12 do simulado (sem ela, o caminho legado te → peso segue como antes)", () => {
    const sem = planejar(entrada({ opcoes: OPC_AP }));
    expect(sem.bloqueios).toEqual([]);
    const falso = planejar(entrada({ ea12Simulado: false, opcoes: OPC_AP }));
    expect(falso.bloqueios).toEqual([]);
  });

  it("o modo estrutural nunca aciona a guarda (não grava peso)", () => {
    const p = planejar(
      entrada({ ea12Simulado: true, teZonaSnapshots: new Map(), opcoes: OPC_ESTR }),
    );
    expect(p.bloqueios.some((b) => b.includes("SIMULADO"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCli — modos novos
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCli — --so-estrutural e --pesos-oficiais", () => {
  it("--so-estrutural é um interruptor e convive com --remover-fantasmas, --uf e --escrever", () => {
    expect(parseCli(["--so-estrutural"]).soEstrutural).toBe(true);
    expect(parseCli([]).soEstrutural).toBe(false);
    expect(
      parseCli(["--so-estrutural", "--remover-fantasmas", "--uf", "AP,PE", "--escrever"]),
    ).toMatchObject({
      soEstrutural: true,
      removerFantasmas: true,
      ufs: ["AP", "PE"],
      escrever: true,
    });
  });

  it("--so-estrutural NUNCA combina com nada que grave peso", () => {
    expect(() => parseCli(["--so-estrutural", "--recalcular-pesos-uf", "AP"])).toThrow(
      /--so-estrutural .* não combina com --recalcular-pesos-uf/,
    );
    expect(() => parseCli(["--so-estrutural", "--aceitar-te-derivado"])).toThrow(
      /não combina com --aceitar-te-derivado/,
    );
    expect(() => parseCli(["--so-estrutural", "--exigir-soma-exata"])).toThrow(
      /não combina com --exigir-soma-exata/,
    );
    expect(() => parseCli(["--so-estrutural", "--pesos-oficiais", "x.zip", "--uf", "AP"])).toThrow(
      /não combina com --pesos-oficiais/,
    );
  });

  it("--pesos-oficiais lê caminho e exige --uf explícito (nunca 'todas'); recusa URL e ZZ", () => {
    const cli = parseCli([
      "--pesos-oficiais",
      "/tmp/perfil_eleitorado_2026.zip",
      "--uf",
      "ap, pe",
      "--total-uf",
      "AP=577534, pe=7000000",
      "--escrever",
    ]);
    expect(cli).toMatchObject({
      pesosOficiais: "/tmp/perfil_eleitorado_2026.zip",
      ufs: ["AP", "PE"],
      totalUf: { AP: 577534, PE: 7000000 },
      escrever: true,
    });
    expect(() => parseCli(["--pesos-oficiais", "x.zip"])).toThrow(/exige --uf explícito/);
    expect(() =>
      parseCli(["--pesos-oficiais", "https://dadosabertos.tse.jus.br/x.zip", "--uf", "AP"]),
    ).toThrow(/só CAMINHO de arquivo local/);
    expect(() => parseCli(["--pesos-oficiais", "x.zip", "--uf", "ZZ"])).toThrow(/exterior/);
    expect(() => parseCli(["--pesos-oficiais"])).toThrow(/exige um valor/);
  });

  it("--pesos-oficiais não combina com os modos que mexem em te/estrutura (roda separado, depois do estrutural)", () => {
    const base = ["--pesos-oficiais", "x.zip", "--uf", "AP"];
    expect(() => parseCli([...base, "--remover-fantasmas"])).toThrow(
      /não combina com --remover-fantasmas/,
    );
    expect(() => parseCli([...base, "--recalcular-pesos-uf", "AP"])).toThrow(
      /não combina com --recalcular-pesos-uf/,
    );
    expect(() => parseCli([...base, "--aceitar-te-derivado"])).toThrow(
      /não combina com --aceitar-te-derivado/,
    );
    expect(() => parseCli([...base, "--exigir-soma-exata"])).toThrow(
      /não combina com --exigir-soma-exata/,
    );
  });

  it("--total-uf e --col-* só valem com --pesos-oficiais; --total-uf valida UF=total", () => {
    expect(() => parseCli(["--total-uf", "AP=1"])).toThrow(/só vale junto com --pesos-oficiais/);
    expect(() => parseCli(["--col-qt", "QT_X"])).toThrow(/só valem com --pesos-oficiais/);
    const base = ["--pesos-oficiais", "x.zip", "--uf", "AP"];
    expect(() => parseCli([...base, "--total-uf", "AP"])).toThrow(/--total-uf inválido/);
    expect(() => parseCli([...base, "--total-uf", "AP=0"])).toThrow(/--total-uf inválido/);
    expect(() => parseCli([...base, "--total-uf", "AP=1a"])).toThrow(/--total-uf inválido/);
  });

  it("nomes das colunas do arquivo oficial são configuráveis; o padrão é o do dataset do TSE", () => {
    expect(parseCli(["--pesos-oficiais", "x.zip", "--uf", "AP"]).colunas).toEqual({
      uf: "SG_UF",
      municipio: "CD_MUNICIPIO",
      zona: "NR_ZONA",
      qt: "QT_ELEITORES_PERFIL",
    });
    expect(
      parseCli([
        "--pesos-oficiais",
        "x.zip",
        "--uf",
        "AP",
        "--col-uf",
        "UF",
        "--col-municipio",
        "COD_MUN",
        "--col-zona",
        "ZONA",
        "--col-qt",
        "QT",
      ]).colunas,
    ).toEqual({ uf: "UF", municipio: "COD_MUN", zona: "ZONA", qt: "QT" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arquivo oficial: leitura e agregação
// ─────────────────────────────────────────────────────────────────────────────

const CAB_OFICIAL = new Map(
  [
    "DT_GERACAO",
    "ANO_ELEICAO",
    "SG_UF",
    "CD_MUNICIPIO",
    "NM_MUNICIPIO",
    "NR_ZONA",
    "DS_GENERO",
    "QT_ELEITORES_PERFIL",
  ].map((c, i) => [c, i]),
);
/** linha no leiaute de CAB_OFICIAL: [dt, ano, uf, mun, nome, zona, genero, qt] */
const linhaOficial = (
  uf: string,
  mun: number | string,
  zona: number | string,
  qt: number | string,
) => ["29/09/2026", "2026", uf, String(mun), "NOME", String(zona), "FEMININO", String(qt)];

describe("agregarPerfil (arquivo oficial de eleitorado)", () => {
  const ufsAp = new Set(["AP"]);

  it("soma QT_ELEITORES_PERFIL por (UF, município, zona) através das linhas de perfil e totaliza a UF", async () => {
    const r = await agregarPerfil(
      CAB_OFICIAL,
      [
        linhaOficial("AP", 6050, 2, 100),
        linhaOficial("AP", 6050, 2, 50), // outro perfil do mesmo par: soma
        linhaOficial("AP", 6050, 10, 30),
        linhaOficial("AP", 6009, 1, 7),
        linhaOficial("SP", 71072, 1, 999), // outra UF: fora
        linhaOficial("ZZ", 99999, 1, 5), // exterior: ignorado
      ],
      ufsAp,
      COLUNAS_OFICIAIS_PADRAO,
    );
    expect(r.porPar.get("AP|6050|2")).toBe(150);
    expect(r.porPar.get("AP|6050|10")).toBe(30);
    expect(r.porPar.get("AP|6009|1")).toBe(7);
    expect(r.porPar.has("SP|71072|1")).toBe(false);
    expect(r.totalPorUf.get("AP")).toBe(187);
    expect(r.totalPorUf.has("SP")).toBe(false);
    expect([r.linhasLidas, r.linhasDasUfs, r.linhasExterior]).toEqual([6, 4, 1]);
  });

  it("aceita iterável assíncrono (o `iterCsv` real) e espaços/minúsculas na UF", async () => {
    async function* gerar() {
      yield linhaOficial(" ap ", 6050, 2, 10);
      yield linhaOficial("AP", 6050, 2, 5);
    }
    const r = await agregarPerfil(CAB_OFICIAL, gerar(), ufsAp, COLUNAS_OFICIAIS_PADRAO);
    expect(r.porPar.get("AP|6050|2")).toBe(15);
  });

  it("cabeçalho sem a coluna esperada é ERRO (lista o que existe e aponta a flag), não zero em silêncio", async () => {
    const semQt = new Map([...CAB_OFICIAL].filter(([c]) => c !== "QT_ELEITORES_PERFIL"));
    await expect(agregarPerfil(semQt, [], ufsAp, COLUNAS_OFICIAIS_PADRAO)).rejects.toThrow(
      /coluna "QT_ELEITORES_PERFIL" ausente.*encontrei: DT_GERACAO, ANO_ELEICAO, SG_UF.*--col-qt/,
    );
    await expect(
      agregarPerfil(CAB_OFICIAL, [], ufsAp, { ...COLUNAS_OFICIAIS_PADRAO, zona: "ZONA" }),
    ).rejects.toThrow(/coluna "ZONA" ausente.*--col-zona/);
  });

  it("nomes de coluna alternativos funcionam (--col-*)", async () => {
    const cab = new Map(["UF", "COD_MUN", "ZONA", "QT"].map((c, i) => [c, i]));
    const r = await agregarPerfil(cab, [["AP", "6050", "2", "40"]], ufsAp, {
      uf: "UF",
      municipio: "COD_MUN",
      zona: "ZONA",
      qt: "QT",
    });
    expect(r.porPar.get("AP|6050|2")).toBe(40);
  });

  it("valor inválido é erro com o número da linha: quantidade negativa/decimal/vazia, zona 0, município texto", async () => {
    const roda = (linha: string[]) =>
      agregarPerfil(
        CAB_OFICIAL,
        [linhaOficial("AP", 6009, 1, 1), linha],
        ufsAp,
        COLUNAS_OFICIAIS_PADRAO,
      );
    await expect(roda(linhaOficial("AP", 6050, 2, -3))).rejects.toThrow(
      /linha de dados 2: QT_ELEITORES_PERFIL="-3"/,
    );
    await expect(roda(linhaOficial("AP", 6050, 2, "12,5"))).rejects.toThrow(
      /QT_ELEITORES_PERFIL="12,5"/,
    );
    await expect(roda(linhaOficial("AP", 6050, 2, ""))).rejects.toThrow(/QT_ELEITORES_PERFIL=""/);
    await expect(roda(linhaOficial("AP", 6050, 0, 5))).rejects.toThrow(/NR_ZONA="0"/);
    await expect(roda(linhaOficial("AP", "ABC", 1, 5))).rejects.toThrow(/CD_MUNICIPIO="ABC"/);
  });

  it("linha de outra UF com lixo NÃO derruba a leitura (só as UFs pedidas são validadas)", async () => {
    const r = await agregarPerfil(
      CAB_OFICIAL,
      [linhaOficial("SP", "lixo", "lixo", "lixo"), linhaOficial("AP", 6050, 2, 3)],
      ufsAp,
      COLUNAS_OFICIAIS_PADRAO,
    );
    expect(r.totalPorUf.get("AP")).toBe(3);
  });
});

describe("lerPerfilOficial (CSV e ZIP em disco)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });
  const temZip =
    spawnSync("which", ["zip"]).status === 0 && spawnSync("which", ["unzip"]).status === 0;

  /** CSV no leiaute do dataset: latin1, `;`, aspas nos textos, acento no nome do município. */
  const csvOficial = [
    '"DT_GERACAO";"HH_GERACAO";"ANO_ELEICAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"DS_GENERO";"QT_ELEITORES_PERFIL"',
    '"29/09/2026";"10:00:00";2026;"AP";"06050";"MACAPÁ";2;"FEMININO";100',
    '"29/09/2026";"10:00:00";2026;"AP";"06050";"MACAPÁ";2;"MASCULINO";50',
    '"29/09/2026";"10:00:00";2026;"AP";"06050";"MACAPÁ";14;"FEMININO";20',
    '"29/09/2026";"10:00:00";2026;"SP";"71072";"SÃO PAULO";1;"FEMININO";900',
    '"29/09/2026";"10:00:00";2026;"ZZ";"99999";"EXTERIOR";1;"FEMININO";4',
    "",
  ].join("\r\n");

  async function pasta(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "pesos-oficiais-teste-"));
    dirs.push(d);
    return d;
  }

  it("CSV extraído: latin1, ';', aspas, acento — soma por par e ignora ZZ e outras UFs", async () => {
    const d = await pasta();
    const csv = join(d, "perfil_eleitorado_2026.csv");
    await writeFile(csv, Buffer.from(csvOficial, "latin1"));
    const r = await lerPerfilOficial(csv, ["AP"], COLUNAS_OFICIAIS_PADRAO);
    expect(r.porPar.get("AP|6050|2")).toBe(150);
    expect(r.porPar.get("AP|6050|14")).toBe(20);
    expect(r.totalPorUf.get("AP")).toBe(170);
    expect(r.porPar.size).toBe(2);
    expect(r.linhasLidas).toBe(5);
    expect(r.linhasExterior).toBe(1);
  });

  it("CSV com cabeçalho diferente falha listando as colunas que encontrou", async () => {
    const d = await pasta();
    const csv = join(d, "outro.csv");
    await writeFile(csv, Buffer.from('"UF";"MUN";"ZONA";"QT"\n"AP";"6050";"2";"1"\n', "latin1"));
    await expect(lerPerfilOficial(csv, ["AP"], COLUNAS_OFICIAIS_PADRAO)).rejects.toThrow(
      /coluna "SG_UF" ausente.*encontrei: UF, MUN, ZONA, QT/,
    );
  });

  it.skipIf(!temZip)("ZIP: extrai com `unzip` e lê o CSV de perfil de dentro", async () => {
    const d = await pasta();
    const csv = join(d, "perfil_eleitorado_2026.csv");
    await writeFile(csv, Buffer.from(csvOficial, "latin1"));
    const zip = join(d, "perfil_eleitorado_2026_teste.zip");
    execFileSync("zip", ["-q", "-j", zip, csv]);
    // base de extração que AINDA NÃO EXISTE (como build/tse-archives num clone novo): a
    // extração tem de criá-la — e o teste não suja o build/ do repositório
    const base = join(d, "nao-existe-ainda", "cache");
    const r = await lerPerfilOficial(zip, ["AP"], COLUNAS_OFICIAIS_PADRAO, base);
    expect(r.totalPorUf.get("AP")).toBe(170);
  });

  it.skipIf(!temZip)(
    "ZIP com dois CSVs que não são de perfil → erro pedindo para extrair à mão",
    async () => {
      const d = await pasta();
      const a = join(d, "a.csv");
      const b = join(d, "b.csv");
      await writeFile(a, "x\n");
      await writeFile(b, "y\n");
      const zip = join(d, "ambiguo_teste.zip");
      execFileSync("zip", ["-q", "-j", zip, a, b]);
      await expect(
        lerPerfilOficial(zip, ["AP"], COLUNAS_OFICIAIS_PADRAO, join(d, "cache")),
      ).rejects.toThrow(/esperava exatamente 1 CSV/);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// planejarPesosOficiais
// ─────────────────────────────────────────────────────────────────────────────

/** Monta a contagem do arquivo a partir de (par, quantidade). */
function contagem(pares: [Par, number][]): ContagemOficial {
  const porPar = new Map<string, number>();
  const totalPorUf = new Map<string, number>();
  for (const [p, qt] of pares) {
    porPar.set(chaveDe(p), (porPar.get(chaveDe(p)) ?? 0) + qt);
    totalPorUf.set(p.uf, (totalPorUf.get(p.uf) ?? 0) + qt);
  }
  return {
    porPar,
    totalPorUf,
    linhasLidas: pares.length,
    linhasDasUfs: pares.length,
    linhasExterior: 0,
  };
}

const pesosAp = pesosBanco.filter((p) => p.uf === "AP");
/** Estrutura já gravada: AP com 18 pares em zonas (a 14 ainda sem peso). */
const zonasAp18: Par[] = [...zonasBanco.filter((z) => z.uf === "AP"), AP_14];
/**
 * Arquivo "oficial" de teste: cada par atual +1 e Macapá 14 com 6.269 — soma EXATAMENTE os
 * 577.534 que o TRE-AP publicou (571.248 + 17 + 6.269).
 */
const oficialAp = contagem([
  ...pesosAp.map((p): [Par, number] => [p, p.eleitoresAptos + 1]),
  [AP_14, 6269],
]);

function entradaOficial(sobre: Partial<EntradaPlanoOficial> = {}): EntradaPlanoOficial {
  return {
    ufs: ["AP"],
    zonas: zonasAp18,
    pesos: pesosAp,
    oficial: oficialAp,
    totaisPublicados: { AP: 577534 },
    ...sobre,
  };
}

describe("planejarPesosOficiais (AP, arquivo de teste = 577.534)", () => {
  it("caminho feliz: 17 atualizações (+1 cada), Macapá 14 inserida, Σ == arquivo == publicado", () => {
    const p = planejarPesosOficiais(entradaOficial());
    expect(p.bloqueios).toEqual([]);
    expect(p.avisos).toEqual([]);
    expect(p.atualizacoes).toHaveLength(17);
    expect(p.atualizacoes.every((a) => a.para === a.de + 1)).toBe(true);
    const m2 = p.atualizacoes.find((a) => chaveDe(a.par) === "AP|6050|2")!;
    expect([m2.de, m2.para]).toEqual([176626, 176627]);
    expect(p.insercoes.map((x) => [chaveDe(x), x.eleitoresAptos])).toEqual([["AP|6050|14", 6269]]);
    expect(p.inalterados).toBe(0);
    expect(p.verificacoes).toEqual([
      {
        uf: "AP",
        pares: 18,
        totalArquivo: 577534,
        somaAntes: 571248,
        somaDepois: 577534,
        publicado: 577534,
      },
    ]);
  });

  it("sem --total-uf: só um aviso (a soma foi conferida contra o próprio arquivo), sem bloqueio", () => {
    const p = planejarPesosOficiais(entradaOficial({ totaisPublicados: {} }));
    expect(p.bloqueios).toEqual([]);
    expect(p.avisos).toHaveLength(1);
    expect(p.avisos[0]).toMatch(/AP: sem --total-uf AP=<total publicado>/);
  });

  it("total publicado ≠ soma do arquivo → BLOQUEIO (arquivo errado, de outra data ou coluna trocada)", () => {
    const p = planejarPesosOficiais(entradaOficial({ totaisPublicados: { AP: 577535 } }));
    expect(p.bloqueios).toHaveLength(1);
    expect(p.bloqueios[0]).toMatch(
      /AP: o arquivo oficial soma 577\.534 e o total publicado é 577\.535 \(-1\)/,
    );
  });

  it("par em `zonas` SEM contagem oficial → bloqueio nomeando o par", () => {
    const p = planejarPesosOficiais(
      entradaOficial({
        oficial: contagem(pesosAp.map((x): [Par, number] => [x, x.eleitoresAptos + 1])),
        totaisPublicados: {},
      }),
    );
    expect(p.semOficial.map(chaveDe)).toEqual(["AP|6050|14"]);
    expect(p.bloqueios).toHaveLength(1);
    expect(p.bloqueios[0]).toMatch(
      /AP: 1 par\(es\) em `zonas` SEM contagem no arquivo oficial \(AP 06050×0014\)/,
    );
  });

  it("par do arquivo que não está em `zonas` → bloqueio mandando rodar o --so-estrutural antes (e a soma não fecha)", () => {
    const p = planejarPesosOficiais(
      entradaOficial({ zonas: zonasAp18.filter((z) => chaveDe(z) !== chaveDe(AP_14)) }),
    );
    expect(p.foraDeZonas.map((x) => [chaveDe(x), x.qt])).toEqual([["AP|6050|14", 6269]]);
    expect(
      p.bloqueios.some((b) => b.includes("NÃO estão em `zonas`") && b.includes("--so-estrutural")),
    ).toBe(true);
    expect(
      p.bloqueios.some((b) =>
        b.includes(
          "Σ dos pesos depois do plano (571.265) ≠ total que o arquivo implica (577.534; -6.269)",
        ),
      ),
    ).toBe(true);
  });

  it("peso órfão (linha de eleitorado de par fora de `zonas`) → bloqueio; a soma não fecharia", () => {
    const orfao: Peso = { uf: "AP", codMunicipioTse: 9999, codZona: 1, eleitoresAptos: 500 };
    const p = planejarPesosOficiais(entradaOficial({ pesos: [...pesosAp, orfao] }));
    expect(p.orfaos.map(chaveDe)).toEqual(["AP|9999|1"]);
    expect(
      p.bloqueios.some((b) =>
        b.includes("1 linha(s) de peso de par fora de `zonas` (AP 09999×0001: 500)"),
      ),
    ).toBe(true);
    expect(p.verificacoes[0]!.somaDepois).toBe(578034);
  });

  it("contagem oficial zero → bloqueio", () => {
    const o = contagem([...pesosAp.map((x): [Par, number] => [x, x.eleitoresAptos]), [AP_14, 0]]);
    const p = planejarPesosOficiais(entradaOficial({ oficial: o, totaisPublicados: {} }));
    expect(p.bloqueios.some((b) => b.startsWith("AP 06050×0014: contagem oficial 0"))).toBe(true);
  });

  it("UF sem par em zonas, UF ausente do arquivo e --total-uf de UF fora de --uf → bloqueios", () => {
    const semZonas = planejarPesosOficiais(entradaOficial({ ufs: ["XX"], totaisPublicados: {} }));
    expect(semZonas.bloqueios[0]).toMatch(/XX: nenhum par em `zonas`/);
    const semArquivo = planejarPesosOficiais(
      entradaOficial({ oficial: contagem([]), totaisPublicados: {} }),
    );
    expect(semArquivo.bloqueios[0]).toMatch(/AP: o arquivo oficial não tem nenhuma linha desta UF/);
    const foraDeUf = planejarPesosOficiais(
      entradaOficial({ totaisPublicados: { AP: 577534, PE: 1 } }),
    );
    expect(
      foraDeUf.bloqueios.some((b) => b.startsWith("--total-uf PE: a UF não está em --uf")),
    ).toBe(true);
  });

  it("outras UFs não são tocadas: pesos de PE ficam intactos mesmo presentes no banco", () => {
    const p = planejarPesosOficiais(
      entradaOficial({ pesos: pesosBanco, zonas: [...zonasBanco, AP_14] }),
    );
    expect(p.atualizacoes.every((a) => a.par.uf === "AP")).toBe(true);
    expect(p.insercoes.every((x) => x.uf === "AP")).toBe(true);
  });

  it("idempotência: replanejar sobre o estado final não muda nada e continua fechando", () => {
    const p1 = planejarPesosOficiais(entradaOficial());
    const depois = estadoFinalOficial({ zonas: zonasAp18, pesos: pesosAp }, p1);
    expect(depois.zonas).toEqual(zonasAp18); // zonas não é tocada
    expect(depois.pesos).toHaveLength(18);
    const p2 = planejarPesosOficiais(entradaOficial({ pesos: depois.pesos }));
    expect(p2.bloqueios).toEqual([]);
    expect(p2.atualizacoes).toEqual([]);
    expect(p2.insercoes).toEqual([]);
    expect(p2.inalterados).toBe(18);
    expect(p2.verificacoes[0]).toMatchObject({ somaAntes: 577534, somaDepois: 577534 });
  });

  it("várias UFs: cada uma tem a sua verificação e o seu total", () => {
    const pe: [Par, number][] = pesosBanco
      .filter((p) => p.uf === "PE")
      .map((p) => [p, p.eleitoresAptos]);
    const p = planejarPesosOficiais({
      ufs: ["PE", "AP"],
      zonas: [...zonasBanco, AP_14],
      pesos: pesosBanco,
      oficial: contagem(
        [...oficialAp.porPar]
          .map(([k, qt]): [Par, number] => {
            const [uf, m, z] = k.split("|");
            return [{ uf: uf!, codMunicipioTse: Number(m), codZona: Number(z) }, qt];
          })
          .concat(pe),
      ),
      totaisPublicados: { AP: 577534 },
    });
    expect(p.verificacoes.map((v) => v.uf)).toEqual(["AP", "PE"]);
    expect(p.verificacoes[1]).toMatchObject({
      uf: "PE",
      somaAntes: 7152871,
      totalArquivo: 7152871,
    });
    expect(p.bloqueios).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executar — com cliente de banco FALSO que registra todo SQL
// ─────────────────────────────────────────────────────────────────────────────

interface EstadoFalso {
  zonas: Par[];
  pesos: Peso[];
}

interface OpcoesDoFalso {
  /** Distorce o Σ devolvido por `SQL_SOMA_UF` (simula divergência pós-escrita). */
  somaAposInsert?: (real: number, uf: string) => number;
  zonasAposInsert?: (real: number) => number;
  /** Acrescenta ao banco os 6 fantasmas de PI/SP (o de PE já está na medição). */
  fantasmas?: boolean;
  /** Snapshots por chave de par (qualquer cargo) — o padrão é zero para todos. */
  snapshotsFantasma?: Record<string, number>;
  /** Quantas linhas o UPDATE de `eleitorado` "afeta" (padrão: todas as que casam). */
  updateAfeta?: (n: number) => number;
  /** Depois do UPDATE, troca +1/−1 entre dois pesos de AP: o Σ se mantém, o estado não. */
  corromperAposUpdate?: boolean;
  /** O servidor recusa planejar o EXPLAIN do UPDATE (simula coluna/tipo errado no pré-voo). */
  explainFalha?: boolean;
  /** Pares acrescentados a `zonas` (ex.: a estrutura já gravada: AP 06050×0014, sem peso). */
  zonasExtra?: Par[];
}

/**
 * Banco falso em memória com semântica de transação (BEGIN copia, ROLLBACK
 * restaura, COMMIT confirma) e respostas dependentes do SQL EXATO exportado
 * por `zonas-faltantes-import.ts` — se o script trocar um SQL, o teste avisa.
 * A cópia é PROFUNDA: UPDATE/DELETE mexem em linhas, e o ROLLBACK tem de devolver
 * as originais.
 */
function bancoFalso(opts: OpcoesDoFalso = {}) {
  const log: string[] = [];
  const params: { sql: string; params: unknown[] | undefined }[] = [];
  const clonar = (e: EstadoFalso): EstadoFalso => ({
    zonas: e.zonas.map((z) => ({ ...z })),
    pesos: e.pesos.map((p) => ({ ...p })),
  });
  let real: EstadoFalso = clonar({
    zonas: [...(opts.fantasmas ? zonasComFantasmas : zonasBanco), ...(opts.zonasExtra ?? [])],
    pesos: pesosBanco,
  });
  let copia: EstadoFalso | null = null;
  const casa = (p: Par, uf: string, mun: number, zona: number) =>
    p.uf === uf && p.codMunicipioTse === mun && p.codZona === zona;
  const client: Consulta = {
    async query(sql: string, p?: unknown[]) {
      const s = sql.trim();
      log.push(s.split("\n")[0]!.trim());
      params.push({ sql, params: p });
      if (s.startsWith("BEGIN")) {
        copia = clonar(real);
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
      if (s.startsWith("SET LOCAL")) return { rows: [] };
      if (s.startsWith("EXPLAIN ")) {
        // planeja, NÃO executa: o estado não muda
        if (opts.explainFalha && s.includes("UPDATE eleitorado")) {
          throw new Error('column "eleitores_apto" of relation "eleitorado" does not exist');
        }
        return { rows: [{ "QUERY PLAN": "plano" }] };
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
      if (sql === SQL_ANOS_ELEITORADO) {
        return { rows: [{ ano: 2026, n: String(real.pesos.length) }] };
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
      if (sql === SQL_SNAPSHOTS_POR_PAR) {
        const [ufs, muns, zs] = p as [string[], number[], number[]];
        const rows: unknown[] = [];
        for (const [i, uf] of ufs.entries()) {
          const n = opts.snapshotsFantasma?.[`${uf}|${muns[i]}|${zs[i]}`] ?? 0;
          if (n > 0) rows.push({ uf, cod_municipio_tse: muns[i], cod_zona: zs[i], n: String(n) });
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
      if (sql === SQL_LINHAS_ELEITORADO) {
        const [, ufs, muns, zs] = p as [number, string[], number[], number[]];
        return {
          rows: real.pesos
            .filter((x) => ufs.some((uf, i) => casa(x, uf, muns[i]!, zs[i]!)))
            .map((x) => ({
              ano: 2026,
              uf: x.uf,
              cod_municipio_tse: x.codMunicipioTse,
              cod_zona: x.codZona,
              eleitores_aptos: x.eleitoresAptos,
              comparecimento_pct_historico: "0.7500",
            })),
        };
      }
      if (sql === SQL_LINHAS_ZONAS) {
        const [ufs, muns, zs] = p as [string[], number[], number[]];
        return {
          rows: real.zonas
            .filter((x) => ufs.some((uf, i) => casa(x, uf, muns[i]!, zs[i]!)))
            .map((x) => ({
              uf: x.uf,
              cod_municipio_tse: x.codMunicipioTse,
              cod_zona: x.codZona,
              nome: null,
              fonte: "historico",
            })),
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
      if (sql === SQL_UPDATE_PESOS) {
        const [, ufs, muns, zs, antigos, novos] = p as [
          number,
          string[],
          number[],
          number[],
          number[],
          number[],
        ];
        const afetadas: unknown[] = [];
        for (const [i, uf] of ufs.entries()) {
          const alvo = real.pesos.find(
            (x) => casa(x, uf, muns[i]!, zs[i]!) && x.eleitoresAptos === antigos[i],
          );
          if (alvo) {
            alvo.eleitoresAptos = novos[i]!;
            afetadas.push({ uf, cod_municipio_tse: muns[i], cod_zona: zs[i] });
          }
        }
        if (opts.corromperAposUpdate) {
          const ap = real.pesos.filter((x) => x.uf === "AP");
          ap[0]!.eleitoresAptos += 1;
          ap[1]!.eleitoresAptos -= 1;
        }
        return {
          rows: opts.updateAfeta ? afetadas.slice(0, opts.updateAfeta(afetadas.length)) : afetadas,
        };
      }
      if (sql === SQL_DELETE_PESOS) {
        const [, ufs, muns, zs] = p as [number, string[], number[], number[]];
        const fora = real.pesos.filter((x) => ufs.some((uf, i) => casa(x, uf, muns[i]!, zs[i]!)));
        real.pesos = real.pesos.filter((x) => !fora.includes(x));
        return { rows: fora.map((x) => ({ uf: x.uf })) };
      }
      if (sql === SQL_DELETE_ZONAS) {
        const [ufs, muns, zs] = p as [string[], number[], number[]];
        const fora = real.zonas.filter((x) => ufs.some((uf, i) => casa(x, uf, muns[i]!, zs[i]!)));
        real.zonas = real.zonas.filter((x) => !fora.includes(x));
        return { rows: fora.map((x) => ({ uf: x.uf })) };
      }
      if (sql === SQL_SOMA_UF) {
        const uf = (p as [number, string])[1];
        const doUf = real.pesos.filter((x) => x.uf === uf);
        const soma = doUf.reduce((a, x) => a + x.eleitoresAptos, 0);
        return {
          rows: [
            {
              soma: String(opts.somaAposInsert ? opts.somaAposInsert(soma, uf) : soma),
              n: String(doUf.length),
            },
          ],
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
  pesosOficiais: null,
  totalUf: {},
  colunas: { ...COLUNAS_OFICIAIS_PADRAO },
  ...sobre,
});
/**
 * EA12 recortado e marcado como NÃO-simulado (`f: "r"`) só para exercitar o caminho legado
 * `te → peso`: a guarda de `planejar` recusa peso vindo de EA12 do simulado (`f = "s"`).
 */
const entradas = {
  ea12Raw: { ...(ea12Recortado(["AP", "PE"]) as object), f: "r" },
  arquivosZona: new Map(),
};
/** O EA12 REAL do simulado (`f = "s"`), como está em produção — o do modo estrutural. */
const entradasSimulado = { ea12Raw: ea12Recortado(["AP", "PE"]), arquivosZona: new Map() };
const mudo = () => {};

/** Entradas com um gravador de backup FALSO (nunca escreve em disco) e o registro do que recebeu. */
function comBackupFalso(
  b: { log: string[] },
  falha?: Error,
  base: { ea12Raw: unknown; arquivosZona: Map<string, { te: number; arquivo: string }> } = entradas,
) {
  const backups: Backup[] = [];
  return {
    backups,
    entradas: {
      ...base,
      salvarBackup: async (bk: Backup): Promise<string> => {
        b.log.push("BACKUP");
        if (falha) throw falha;
        backups.push(bk);
        return "build/zonas-backup-falso.json";
      },
    },
  };
}

const ESCRITA = /^(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i;
const VERBOS_DE_ESCRITA = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i;
const ESCRITAS_CONHECIDAS = [
  SQL_DELETE_PESOS,
  SQL_DELETE_ZONAS,
  SQL_INSERT_ZONAS,
  SQL_INSERT_PESOS,
  SQL_UPDATE_PESOS,
];
/**
 * A invariante da simulação: cada SQL emitido é leitura pura OU o `EXPLAIN` de uma das cinco
 * escritas conhecidas (o servidor planeja e não executa). Nada mais.
 */
function soLeituraOuPreVoo(sql: string): boolean {
  const t = sql.trim();
  if (t.startsWith("EXPLAIN ")) return ESCRITAS_CONHECIDAS.includes(t.slice("EXPLAIN ".length));
  return (
    /^(BEGIN TRANSACTION READ ONLY|ROLLBACK|SET LOCAL statement_timeout|SELECT|WITH)/.test(t) &&
    !VERBOS_DE_ESCRITA.test(sql)
  );
}
const CLI_TUDO = {
  ufs: [] as string[],
  aceitarTeDerivado: true,
  recalcularPesosUf: ["AP"],
  removerFantasmas: true,
};

describe("executar — simulação", () => {
  it("SÓ lê: todo SQL emitido é BEGIN TRANSACTION READ ONLY, SET LOCAL de timeout, SELECT, ROLLBACK ou o EXPLAIN de uma escrita conhecida — nunca INSERT/UPDATE/DELETE de verdade", async () => {
    const b = bancoFalso();
    const r = await executar(b.client, cliDe(), entradas, mudo);
    expect(r.escreveu).toBe(false);
    expect(b.params[0]!.sql).toBe("BEGIN TRANSACTION READ ONLY");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    for (const { sql } of b.params) expect(soLeituraOuPreVoo(sql)).toBe(true);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.estado().zonas).toHaveLength(zonasBanco.length);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
  });

  it("com TODOS os modos ligados continua só lendo, não grava backup e não mexe no banco", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    const antesZ = b.estado().zonas.map((z) => ({ ...z }));
    const antesP = b.estado().pesos.map((z) => ({ ...z }));
    const r = await executar(b.client, cliDe(CLI_TUDO), bk.entradas, mudo);
    expect(r.escreveu).toBe(false);
    expect(r.backup).toBeNull();
    expect(bk.backups).toEqual([]); // simulação nunca grava backup
    expect(b.log).not.toContain("BACKUP");
    expect(b.params[0]!.sql).toBe("BEGIN TRANSACTION READ ONLY");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    for (const { sql } of b.params) {
      expect(soLeituraOuPreVoo(sql)).toBe(true);
      expect(sql.trim()).not.toMatch(ESCRITA);
      expect(sql.trim()).not.toMatch(/^SET LOCAL lock_timeout/); // só a escrita espera lock
    }
    expect(b.estado().zonas).toEqual(antesZ);
    expect(b.estado().pesos).toEqual(antesP);
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

  it("modos ligados: imprime cada linha ATUALIZADA (antigo → novo), as REMOVIDAS, os totais antes → depois e o SQL de desfazer", async () => {
    const b = bancoFalso({ fantasmas: true });
    const linhas: string[] = [];
    await executar(b.client, cliDe(CLI_TUDO), entradas, (s) => linhas.push(s));
    const saida = linhas.join("\n");
    expect(saida).toContain(
      "modos: inserção de pares faltantes + recalcular pesos de AP + remover fantasmas",
    );
    expect(saida).toContain("eleitorado por ano: 2026=");
    // 3b — cada linha atualizada, antigo → novo
    expect(saida).toContain("=== 3b. Linhas que seriam ATUALIZADAS");
    expect(saida).toContain("AP 06050×0002 MACAPÁ: 176.626 → 112.346 (-64.280)  fonte=snapshot");
    expect(saida).toContain("AP 06050×0010 MACAPÁ: 134.192 → 84.450 (-49.742)  fonte=snapshot");
    expect(saida).toContain("(17 alterada(s); 0 par(es) de AP já estavam com o te 2026)");
    // 3c — remoções, com a prova dos snapshots
    expect(saida).toContain("=== 3c. Linhas que seriam REMOVIDAS");
    expect(saida).toContain(
      "zonas ('PE', 25313, 1) nome=NULL fonte='historico' · eleitorado: 115.861 eleitores · snapshots (qualquer cargo): 0",
    );
    expect(saida).toContain("zonas ('SP', 71072, 398)");
    expect(saida).toContain("total: 7 linha(s) de zonas · 1 de eleitorado (115.861 eleitores)");
    // 4 — o AP fecha no agregado; contagens antes → depois
    expect(saida).toMatch(
      /AP: agregado=628\.071 · Σ antes=571\.248 \(-56\.823\) · Σ depois=628\.071 \(0\) → FECHA/,
    );
    expect(saida).toContain(
      "AP: zonas 17 → 18 · eleitorado 17 → 18 · Σ 571.248 → 628.071  (agregado 628.071; FECHA exato)",
    );
    expect(saida).toMatch(/AP 06050 MACAPÁ\s+310\.818 →\s+319\.257 \(\+2,72%\)/);
    // 6 — o aviso do PE (a remoção afasta) não bloqueia
    expect(saida).toContain("bloqueios: nenhum");
    expect(saida).toMatch(/AVISO: PE: remover PE 25313×0001 tira 115\.861 eleitores/);
    // 7 — resumo nacional e a contagem do list-targets
    expect(saida).toContain("zonas (pares): 231 → 226");
    expect(saida).toContain(
      "list-targets (cargo 1) esperado: Total de alvos = 226 zonas + 28 (27 UFs + 1 nacional) = 254  (antes: 231 + 28 = 259)",
    );
    // 8 — backup e desfazer
    expect(saida).toContain(
      "backup (só com --escrever, em build/zonas-backup-<timestamp>.json): 25 linha(s)",
    );
    expect(saida).toContain("UPDATE eleitorado e SET eleitores_aptos = v.antigo");
    expect(saida).toContain("('AP', 6050, 2, 176626)");
    expect(saida).toContain("(2026, 'PE', 25313, 1, 115861, 0.7500)");
  });

  it("não consulta te de zona nem municípios quando não há par faltante", async () => {
    const b = bancoFalso();
    b.estado().zonas.push(AP_14, PE_NORONHA_4);
    await executar(b.client, cliDe(), entradas, mudo);
    expect(b.params.some((x) => x.sql === SQL_TE_ZONAS)).toBe(false);
    expect(b.params.some((x) => x.sql === SQL_MUNICIPIOS)).toBe(false);
  });

  it("sem --remover-fantasmas não conta snapshots (a varredura só existe para provar a remoção)", async () => {
    const b = bancoFalso({ fantasmas: true });
    await executar(b.client, cliDe(), entradas, mudo);
    expect(b.params.some((x) => x.sql === SQL_SNAPSHOTS_POR_PAR)).toBe(false);
    const c = bancoFalso({ fantasmas: true });
    await executar(c.client, cliDe({ removerFantasmas: true }), entradas, mudo);
    const q = c.params.find((x) => x.sql === SQL_SNAPSHOTS_POR_PAR)!;
    expect(q.params).toEqual([
      ["PE", "PI", "PI", "PI", "PI", "PI", "SP"],
      [25313, 10170, 11118, 11452, 11495, 11614, 71072],
      [1, 92, 75, 83, 31, 55, 398],
    ]);
  });
});

describe("executar — pré-voo do SQL de escrita (só na simulação)", () => {
  it("pede o EXPLAIN de CADA escrita do plano, na ordem, com os parâmetros exatos — e não executa nenhuma", async () => {
    const b = bancoFalso({ fantasmas: true });
    const linhas: string[] = [];
    const r = await executar(b.client, cliDe(CLI_TUDO), entradas, (s) => linhas.push(s));
    const esperadas = escritasDoPlano(r.plano);
    expect(esperadas.map((w) => w.nome)).toEqual([
      "DELETE em eleitorado",
      "DELETE em zonas",
      "INSERT em zonas",
      "INSERT em eleitorado",
      "UPDATE em eleitorado",
    ]);
    const emitidas = b.params.filter((x) => x.sql.trim().startsWith("EXPLAIN "));
    expect(emitidas.map((x) => x.sql.trim())).toEqual(esperadas.map((w) => `EXPLAIN ${w.sql}`));
    expect(emitidas.map((x) => x.params)).toEqual(esperadas.map((w) => w.params));
    // nenhuma escrita foi executada: o banco está como estava
    expect(b.estado().zonas).toHaveLength(231);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
    const saida = linhas.join("\n");
    expect(saida).toContain(
      "=== 9. Pré-voo do SQL de escrita (EXPLAIN: o servidor planeja, não executa) ===",
    );
    expect(saida).toContain("✓ DELETE em zonas — planejado pelo servidor (7 linha(s))");
    expect(saida).toContain("✓ UPDATE em eleitorado — planejado pelo servidor (17 linha(s))");
    // o EXPLAIN vem DEPOIS de todas as leituras e o ROLLBACK fecha
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });

  it("o que o pré-voo planeja é EXATAMENTE o que a escrita real executa (mesma lista, mesmos parâmetros)", async () => {
    const sim = bancoFalso({ fantasmas: true });
    await executar(sim.client, cliDe(CLI_TUDO), entradas, mudo);
    const explains = sim.params
      .filter((x) => x.sql.trim().startsWith("EXPLAIN "))
      .map((x) => ({ sql: x.sql.trim().slice("EXPLAIN ".length), params: x.params }));

    const real = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(real);
    await executar(real.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo);
    const escritas = real.params
      .filter((x) => ESCRITAS_CONHECIDAS.includes(x.sql))
      .map((x) => ({ sql: x.sql, params: x.params }));
    expect(escritas).toEqual(explains);
  });

  it("a escrita real NUNCA emite EXPLAIN (ela executa de verdade)", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    await executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo);
    expect(b.params.some((x) => x.sql.trim().startsWith("EXPLAIN"))).toBe(false);
  });

  it("servidor recusa planejar o UPDATE (coluna/tipo errado): a simulação FALHA, mostra qual e faz ROLLBACK", async () => {
    const b = bancoFalso({ fantasmas: true, explainFalha: true });
    const linhas: string[] = [];
    await expect(
      executar(b.client, cliDe(CLI_TUDO), entradas, (s) => linhas.push(s)),
    ).rejects.toThrow(/pré-voo do SQL de escrita FALHOU \(UPDATE em eleitorado\)/);
    const saida = linhas.join("\n");
    expect(saida).toContain(
      '⛔ UPDATE em eleitorado — column "eleitores_apto" of relation "eleitorado" does not exist',
    );
    expect(saida).toContain("✓ DELETE em zonas");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.estado().zonas).toHaveLength(231);
  });

  it("plano sem escrita (banco já corrigido): diz que não há o que planejar e não emite EXPLAIN", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    await executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo); // corrige
    const n = b.params.length;
    const linhas: string[] = [];
    await executar(b.client, cliDe(CLI_TUDO), entradas, (s) => linhas.push(s)); // simula de novo
    expect(linhas.join("\n")).toContain("(o plano não tem nenhuma escrita)");
    expect(b.params.slice(n).some((x) => x.sql.trim().startsWith("EXPLAIN"))).toBe(false);
  });

  it("escritasDoPlano: só as instruções que o plano usa, com o nº de linhas e o RETURNING previsto", () => {
    const soInserir = planejar(
      entrada({ opcoes: { ...OPCOES, ufs: ["PE"], aceitarTeDerivado: true } }),
    );
    const ws = escritasDoPlano(soInserir);
    expect(ws.map((w: Escrita) => [w.nome, w.linhas, w.previstoLinhas])).toEqual([
      ["INSERT em zonas", 1, null],
      ["INSERT em eleitorado", 1, null],
    ]);
    const tudo = planejar(
      entrada({ zonas: zonasComFantasmas, snapshotsPorPar: zeroSnapshots, opcoes: OPC_TUDO }),
    );
    expect(escritasDoPlano(tudo).map((w: Escrita) => [w.nome, w.linhas, w.previstoLinhas])).toEqual(
      [
        ["DELETE em eleitorado", 1, 1],
        ["DELETE em zonas", 7, 7],
        ["INSERT em zonas", 2, null],
        ["INSERT em eleitorado", 2, null],
        ["UPDATE em eleitorado", 17, 17],
      ],
    );
    expect(
      escritasDoPlano(planejar(entrada({ zonas: [...zonasBanco, AP_14, PE_NORONHA_4] }))),
    ).toEqual([]);
  });
});

describe("executar — --escrever (inserção, como antes)", () => {
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
    expect(r.backup).toBeNull(); // só inseriu: não há linha que UPDATE/DELETE perca

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
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()) && !/^INSERT/i.test(x.sql.trim()))).toBe(
      false,
    );
  });

  it("conferência pós-escrita divergente → ROLLBACK e nada fica no banco", async () => {
    const b = bancoFalso({ somaAposInsert: (real) => real + 1 });
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    await expect(executar(b.client, cli, entradas, mudo)).rejects.toThrow(
      /Σ eleitorado após a escrita/,
    );
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(b.estado().zonas).toHaveLength(zonasBanco.length);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
  });

  it("contagem de zonas após a escrita divergente → ROLLBACK", async () => {
    const b = bancoFalso({ zonasAposInsert: (n) => n + 1 });
    const cli = cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true });
    await expect(executar(b.client, cli, entradas, mudo)).rejects.toThrow(
      /count\(zonas\) após a escrita/,
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

describe("executar — --escrever com recálculo do AP + remoção dos fantasmas (uma transação)", () => {
  it("grava tudo: ordem das escritas, backup ANTES da primeira escrita, AP fecha no agregado, estado == esperado, COMMIT", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    const antes = {
      zonas: b.estado().zonas.map((z) => ({ ...z })),
      pesos: b.estado().pesos.map((z) => ({ ...z })),
    };
    const linhas: string[] = [];
    const r = await executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, (s) =>
      linhas.push(s),
    );
    expect(r.escreveu).toBe(true);
    expect(r.backup).toBe("build/zonas-backup-falso.json");

    // uma transação só, com lock_timeout só na escrita
    const ordem = b.params.map((x) => x.sql);
    expect(ordem[0]).toBe("BEGIN");
    expect(ordem.at(-1)).toBe("COMMIT");
    expect(ordem.filter((s) => s === "BEGIN" || s === "COMMIT")).toHaveLength(2);
    expect(ordem.some((s) => s.trim().startsWith("SET LOCAL lock_timeout"))).toBe(true);

    // ordem das escritas: DELETE pesos → DELETE zonas → INSERT zonas → INSERT pesos → UPDATE → conferência
    const idx = (sql: string) => ordem.indexOf(sql);
    expect(idx(SQL_DELETE_PESOS)).toBeGreaterThan(0);
    expect(idx(SQL_DELETE_ZONAS)).toBeGreaterThan(idx(SQL_DELETE_PESOS));
    expect(idx(SQL_INSERT_ZONAS)).toBeGreaterThan(idx(SQL_DELETE_ZONAS));
    expect(idx(SQL_INSERT_PESOS)).toBeGreaterThan(idx(SQL_INSERT_ZONAS));
    expect(idx(SQL_UPDATE_PESOS)).toBeGreaterThan(idx(SQL_INSERT_PESOS));
    expect(idx(SQL_SOMA_UF)).toBeGreaterThan(idx(SQL_UPDATE_PESOS));

    // o backup é gravado ANTES da primeira instrução de escrita
    const iBackup = b.log.indexOf("BACKUP");
    const iPrimeiraEscrita = b.log.findIndex((l) => ESCRITA.test(l));
    expect(iBackup).toBeGreaterThan(-1);
    expect(iBackup).toBeLessThan(iPrimeiraEscrita);
    expect(b.log.filter((l) => l === "BACKUP")).toHaveLength(1);

    // parâmetros exatos
    const del = b.params.find((x) => x.sql === SQL_DELETE_PESOS)!;
    expect(del.params).toEqual([2026, ["PE"], [25313], [1]]);
    const delZ = b.params.find((x) => x.sql === SQL_DELETE_ZONAS)!;
    expect(delZ.params).toEqual([
      ["PE", "PI", "PI", "PI", "PI", "PI", "SP"],
      [25313, 10170, 11118, 11452, 11495, 11614, 71072],
      [1, 92, 75, 83, 31, 55, 398],
    ]);
    const upd = b.params.find((x) => x.sql === SQL_UPDATE_PESOS)!.params as [
      number,
      string[],
      number[],
      number[],
      number[],
      number[],
    ];
    expect(upd[0]).toBe(2026);
    expect(upd[1]).toHaveLength(17);
    expect(upd[1].every((uf) => uf === "AP")).toBe(true);
    const i2 = upd[2].findIndex((m, i) => m === 6050 && upd[3][i] === 2);
    expect([upd[4][i2], upd[5][i2]]).toEqual([176626, 112346]); // antigo → novo
    const insP = b.params.find((x) => x.sql === SQL_INSERT_PESOS)!.params as [
      number[],
      string[],
      number[],
      number[],
      number[],
      unknown[],
    ];
    expect(insP[1].slice().sort()).toEqual(["AP", "PE"]);
    expect(insP[4]).toEqual(expect.arrayContaining([122461, 4954]));

    // estado final
    const est = b.estado();
    expect(est.zonas).toHaveLength(226); // 231 + 2 − 7
    expect(
      est.zonas.some((z) => FANTASMAS_AUTORIZADOS.some((g) => chaveDe(g) === chaveDe(z))),
    ).toBe(false);
    expect(est.pesos.some((p) => chaveDe(p) === "PE|25313|1")).toBe(false);
    const somaAp = est.pesos.filter((p) => p.uf === "AP").reduce((a, p) => a + p.eleitoresAptos, 0);
    expect(somaAp).toBe(628071); // == agregado, EXATO
    expect(est.pesos.filter((p) => p.uf === "AP")).toHaveLength(18);
    expect(est.pesos.find((p) => chaveDe(p) === "PE|30015|4")?.eleitoresAptos).toBe(4954);
    // nada além do plano mudou: o que sobrou é o estado esperado
    expect(diferencasDeEstado(estadoFinal(antes, r.plano), est)).toEqual([]);
    // PE (fora do recálculo) manteve os pesos dos vizinhos
    const pe = (e: { pesos: Peso[] }) =>
      new Map(e.pesos.filter((p) => p.uf === "PE").map((p) => [chaveDe(p), p.eleitoresAptos]));
    const peAntes = pe(antes);
    const peDepois = pe(est);
    for (const [k, v] of peDepois) {
      if (k !== "PE|30015|4") expect(peAntes.get(k)).toBe(v);
    }

    // backup: exatamente as linhas que UPDATE/DELETE perdem, no estado de ANTES
    const backup = bk.backups[0]!;
    expect(backup.resumo).toEqual({
      eleitorado_atualizadas: 17,
      eleitorado_removidas: 1,
      zonas_removidas: 7,
      zonas_inseridas: 2,
      eleitorado_inseridas: 2,
    });
    expect(
      backup.eleitorado_atualizadas.find((x) => x.cod_municipio_tse === 6050 && x.cod_zona === 2)
        ?.eleitores_aptos,
    ).toBe(176626);
    expect(backup.eleitorado_removidas[0]).toMatchObject({
      uf: "PE",
      cod_municipio_tse: 25313,
      cod_zona: 1,
      eleitores_aptos: 115861,
    });
    expect(
      backup.zonas_removidas.map((z) => `${z.uf}|${z.cod_municipio_tse}|${z.cod_zona}`),
    ).toEqual(FANTASMAS_AUTORIZADOS.map(chaveDe));
    expect(backup.desfazerSql[0]).toBe("BEGIN;");
    expect(backup.desfazerSql.at(-1)).toBe("COMMIT;");
    expect(backup._aviso).toContain("só houve mudança no banco se a execução imprimiu COMMIT");

    const saida = linhas.join("\n");
    expect(saida).toContain(
      "[escrever] backup gravado ANTES da escrita: build/zonas-backup-falso.json",
    );
    expect(saida).toContain("[escrever] COMMIT — zonas: +2 −7; eleitorado: +2 ~17 −1.");
    expect(saida).toContain("AP == agregado exato");
  });

  it("idempotência: reexecutar depois do COMMIT não escreve nada nem grava outro backup", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    const cli = cliDe({ escrever: true, ...CLI_TUDO });
    await executar(b.client, cli, bk.entradas, mudo);
    const estadoDepois1 = JSON.stringify(b.estado());
    const n = b.params.length;
    const linhas: string[] = [];
    const r = await executar(b.client, cli, bk.entradas, (s) => linhas.push(s));
    expect(r.escreveu).toBe(false);
    expect(r.backup).toBeNull();
    expect(linhas.join("\n")).toContain(
      "nada a inserir, atualizar nem remover — o banco já está como o plano quer",
    );
    expect(b.params.slice(n).some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(bk.backups).toHaveLength(1); // o da primeira execução, e só
    expect(JSON.stringify(b.estado())).toBe(estadoDepois1);
    // e a varredura de snapshots não foi refeita: os 7 já saíram do banco
    expect(b.params.slice(n).some((x) => x.sql === SQL_SNAPSHOTS_POR_PAR)).toBe(false);
  });

  it("RECUSA (bloqueio, zero escrita, zero backup) quando um fantasma tem snapshot em qualquer cargo", async () => {
    const b = bancoFalso({ fantasmas: true, snapshotsFantasma: { "PI|11118|75": 2 } });
    const bk = comBackupFalso(b);
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
    ).rejects.toThrow(/PI 11118×0075: tem 2 snapshot\(s\)/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.log).not.toContain("BACKUP");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.estado().zonas).toHaveLength(231);
  });

  it("RECUSA sem --aceitar-te-derivado (o te de Macapá 14 e de Noronha é resíduo, não arquivo)", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    await expect(
      executar(
        b.client,
        cliDe({ escrever: true, ...CLI_TUDO, aceitarTeDerivado: false }),
        bk.entradas,
        mudo,
      ),
    ).rejects.toBeInstanceOf(BloqueadoError);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.log).not.toContain("BACKUP");
  });

  it("RECUSA o recálculo parcial: um segundo par do AP sem te → bloqueio, nenhum UPDATE", async () => {
    // par de AP existente no banco e no EA12, mas sem te em snapshot
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b);
    teSnapshots.delete("AP|6017|1");
    try {
      await expect(
        executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
      ).rejects.toThrow(/AP: 2 par\(es\) faltante\(s\) sem arquivo de zona/);
    } finally {
      teSnapshots.set("AP|6017|1", 14161);
    }
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.params.some((x) => x.sql === SQL_UPDATE_PESOS)).toBe(false);
  });

  it("UPDATE que afeta MENOS linhas que o previsto (peso mudou por fora) → ROLLBACK total; backup já existe, banco intacto", async () => {
    const b = bancoFalso({ fantasmas: true, updateAfeta: (n) => n - 1 });
    const bk = comBackupFalso(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
    ).rejects.toThrow(/UPDATE em eleitorado afetou 16 linha\(s\); previsto 17 — revertendo/);
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(JSON.stringify(b.estado())).toBe(antes); // DELETEs e INSERTs também foram desfeitos
    expect(bk.backups).toHaveLength(1);
  });

  it("estado do banco ≠ esperado (mesmo com o Σ igual) → ROLLBACK total", async () => {
    const b = bancoFalso({ fantasmas: true, corromperAposUpdate: true });
    const bk = comBackupFalso(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
    ).rejects.toThrow(/zonas\/eleitorado depois da escrita ≠ estado esperado — revertendo/);
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("Σ do AP depois da escrita divergente → ROLLBACK total", async () => {
    const b = bancoFalso({
      fantasmas: true,
      somaAposInsert: (real, uf) => (uf === "AP" ? real + 1 : real),
    });
    const bk = comBackupFalso(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
    ).rejects.toThrow(/AP: Σ eleitorado após a escrita = 628\.072, previsto 628\.071/);
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("falha ao gravar o backup → aborta ANTES de qualquer escrita (sem backup não se escreve)", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, new Error("disco cheio"));
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_TUDO }), bk.entradas, mudo),
    ).rejects.toThrow(/disco cheio/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    expect(b.estado().zonas).toHaveLength(231);
  });

  it("os SQL de UPDATE e DELETE só casam o que o plano nomeou (ano, par e valor lido) e devolvem RETURNING", () => {
    expect(SQL_UPDATE_PESOS).toMatch(/WHERE e\.ano = \$1 AND e\.uf = v\.uf/);
    expect(SQL_UPDATE_PESOS).toMatch(/AND e\.eleitores_aptos = v\.antigo/);
    expect(SQL_UPDATE_PESOS).toMatch(/RETURNING/);
    expect(SQL_DELETE_PESOS).toMatch(/WHERE e\.ano = \$1 AND e\.uf = v\.uf/);
    expect(SQL_DELETE_PESOS).toMatch(/RETURNING/);
    expect(SQL_DELETE_ZONAS).toMatch(/USING UNNEST/);
    expect(SQL_DELETE_ZONAS).toMatch(/RETURNING/);
    for (const sql of [SQL_UPDATE_PESOS, SQL_DELETE_PESOS, SQL_DELETE_ZONAS]) {
      // nunca um UPDATE/DELETE sem WHERE, nunca TRUNCATE
      expect(sql).toMatch(/WHERE/);
      expect(sql).not.toMatch(/TRUNCATE/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backup em disco
// ─────────────────────────────────────────────────────────────────────────────

describe("backup em disco", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("nome com timestamp UTC sem separadores: zonas-backup-<AAAAMMDDTHHMMSSZ>.json", () => {
    expect(nomeDoBackup(new Date("2026-09-29T17:05:09.123Z"))).toBe(
      "zonas-backup-20260929T170509Z.json",
    );
  });

  it("grava JSON legível e NUNCA sobrescreve um backup existente", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zonas-backup-teste-"));
    dirs.push(dir);
    const backup = { _aviso: "x", desfazerSql: ["BEGIN;", "COMMIT;"] } as unknown as Backup;
    const quando = new Date("2026-09-29T17:05:09Z");
    const caminho = await salvarBackupEmDisco(backup, join(dir, "sub", "build"), quando);
    expect(caminho.endsWith("zonas-backup-20260929T170509Z.json")).toBe(true);
    expect(JSON.parse(await readFile(caminho, "utf8"))).toEqual(backup);
    await expect(salvarBackupEmDisco(backup, join(dir, "sub", "build"), quando)).rejects.toThrow(
      /EEXIST/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executar — --so-estrutural (o que será gravado agora)
// ─────────────────────────────────────────────────────────────────────────────

const CLI_ESTR = { soEstrutural: true, removerFantasmas: true };

describe("executar — --so-estrutural --remover-fantasmas", () => {
  it("simulação: não lê agregado nem te, só emite leitura + EXPLAIN das 3 escritas estruturais, sem nenhuma escrita de peso", async () => {
    const b = bancoFalso({ fantasmas: true });
    const linhas: string[] = [];
    const r = await executar(b.client, cliDe(CLI_ESTR), entradasSimulado, (s) => linhas.push(s));
    expect(r.escreveu).toBe(false);
    expect(r.plano.bloqueios).toEqual([]);
    for (const { sql } of b.params) expect(soLeituraOuPreVoo(sql)).toBe(true);
    expect(b.params.some((x) => x.sql === SQL_AGREGADOS)).toBe(false);
    expect(b.params.some((x) => x.sql === SQL_TE_ZONAS)).toBe(false);
    const explains = b.params
      .filter((x) => x.sql.trim().startsWith("EXPLAIN "))
      .map((x) => x.sql.trim().slice("EXPLAIN ".length));
    expect(explains).toEqual([SQL_DELETE_PESOS, SQL_DELETE_ZONAS, SQL_INSERT_ZONAS]);
    // nada mudou
    expect(b.estado().zonas).toHaveLength(231);
    expect(b.estado().pesos).toHaveLength(pesosBanco.length);
    const saida = linhas.join("\n");
    expect(saida).toContain(
      "modos: SÓ ESTRUTURA (insere em zonas; nenhum peso é gravado) + remover fantasmas",
    );
    expect(saida).toContain("agregado do simulado NÃO lido (não é critério");
    expect(saida).toContain(
      "(modo estrutural: nenhum te é lido nem gravado — o peso virá de --pesos-oficiais)",
    );
    expect(saida).toContain(
      "AP 06050×0014 → zona SEM nenhum peso (peso 0): o modelo DESCARTA os votos dela",
    );
    expect(saida).toContain("eleitorado (0):"); // nenhuma linha de eleitorado a inserir
    expect(saida).toContain("(não se aplica ao modo estrutural");
    expect(saida).toContain("zonas (pares): 231 → 226");
    expect(saida).toContain("eleitorado (linhas ano=2026): 225 → 224");
    expect(saida).toContain("Total de alvos = 226 zonas + 28 (27 UFs + 1 nacional) = 254");
    expect(saida).toContain("✓ INSERT em zonas — planejado pelo servidor (2 linha(s))");
    expect(saida).not.toContain("INSERT em eleitorado");
  });

  it("com EA12 do simulado NÃO exige --aceitar-te-derivado e NÃO é bloqueado (a guarda não vale para o estrutural)", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    const r = await executar(
      b.client,
      cliDe({ escrever: true, ...CLI_ESTR, aceitarTeDerivado: false }),
      bk.entradas,
      mudo,
    );
    expect(r.escreveu).toBe(true);
  });

  it("escreve: zonas +2 −7, eleitorado SÓ −1 (o órfão); nenhum INSERT/UPDATE de peso; backup antes; COMMIT; estado == esperado", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    const antes = {
      zonas: b.estado().zonas.map((z) => ({ ...z })),
      pesos: b.estado().pesos.map((z) => ({ ...z })),
    };
    const linhas: string[] = [];
    const r = await executar(b.client, cliDe({ escrever: true, ...CLI_ESTR }), bk.entradas, (s) =>
      linhas.push(s),
    );
    expect(r.escreveu).toBe(true);

    // só as 3 escritas estruturais, na ordem
    const escritas = b.params.filter((x) => ESCRITAS_CONHECIDAS.includes(x.sql)).map((x) => x.sql);
    expect(escritas).toEqual([SQL_DELETE_PESOS, SQL_DELETE_ZONAS, SQL_INSERT_ZONAS]);
    expect(b.params.some((x) => x.sql === SQL_INSERT_PESOS || x.sql === SQL_UPDATE_PESOS)).toBe(
      false,
    );
    expect(b.params.some((x) => x.sql.trim().startsWith("EXPLAIN"))).toBe(false);
    expect(b.params.some((x) => x.sql === SQL_AGREGADOS || x.sql === SQL_TE_ZONAS)).toBe(false);

    // backup ANTES da primeira escrita
    expect(b.log.indexOf("BACKUP")).toBeGreaterThan(-1);
    expect(b.log.indexOf("BACKUP")).toBeLessThan(b.log.findIndex((l) => ESCRITA.test(l)));
    expect(bk.backups[0]!.resumo).toEqual({
      eleitorado_atualizadas: 0,
      eleitorado_removidas: 1,
      zonas_removidas: 7,
      zonas_inseridas: 2,
      eleitorado_inseridas: 0,
    });
    expect(bk.backups[0]!.opcoes).toMatchObject({ soEstrutural: true, removerFantasmas: true });
    // o desfazer apaga só o que entrou em `zonas` (não há peso inserido para apagar)
    const desfazer = bk.backups[0]!.desfazerSql.join("\n");
    expect(desfazer).toContain(
      "DELETE FROM zonas WHERE (uf, cod_municipio_tse, cod_zona) IN (('AP', 6050, 14), ('PE', 30015, 4));",
    );
    expect(desfazer).not.toContain("DELETE FROM eleitorado");
    expect(desfazer).toContain("(2026, 'PE', 25313, 1, 115861, 0.7500)");

    // estado final
    const est = b.estado();
    expect(est.zonas).toHaveLength(226);
    expect(est.zonas.some((z) => chaveDe(z) === chaveDe(AP_14))).toBe(true);
    expect(est.zonas.some((z) => chaveDe(z) === chaveDe(PE_NORONHA_4))).toBe(true);
    expect(est.pesos).toHaveLength(antes.pesos.length - 1);
    // os 2 pares novos NÃO têm peso (só o pesos-oficiais os pesa)
    expect(
      est.pesos.some((p) => chaveDe(p) === chaveDe(AP_14) || chaveDe(p) === chaveDe(PE_NORONHA_4)),
    ).toBe(false);
    // demais pesos intactos: AP inteira, e PE menos o órfão
    const chaveVal = (ps: Peso[]) =>
      JSON.stringify(ps.map((p) => [chaveDe(p), p.eleitoresAptos]).sort());
    expect(chaveVal(est.pesos)).toBe(
      chaveVal(antes.pesos.filter((p) => chaveDe(p) !== "PE|25313|1")),
    );
    expect(diferencasDeEstado(estadoFinal(antes, r.plano), est)).toEqual([]);
    expect(linhas.join("\n")).toContain("[escrever] COMMIT — zonas: +2 −7; eleitorado: +0 ~0 −1.");
    expect(b.params.at(-1)!.sql).toBe("COMMIT");
  });

  it("idempotência: reexecutar depois do COMMIT não escreve nada", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    const cli = cliDe({ escrever: true, ...CLI_ESTR });
    await executar(b.client, cli, bk.entradas, mudo);
    const n = b.params.length;
    const linhas: string[] = [];
    const r = await executar(b.client, cli, bk.entradas, (s) => linhas.push(s));
    expect(r.escreveu).toBe(false);
    expect(linhas.join("\n")).toContain("nada a inserir, atualizar nem remover");
    expect(b.params.slice(n).some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(bk.backups).toHaveLength(1);
  });

  it("fantasma com snapshot → BLOQUEIO, zero escrita, zero backup (mesmo no estrutural)", async () => {
    const b = bancoFalso({ fantasmas: true, snapshotsFantasma: { "SP|71072|398": 4 } });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_ESTR }), bk.entradas, mudo),
    ).rejects.toThrow(/SP 71072×0398: tem 4 snapshot\(s\)/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.log).not.toContain("BACKUP");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });

  it("contagem de zonas divergente depois da escrita → ROLLBACK total", async () => {
    const b = bancoFalso({ fantasmas: true, zonasAposInsert: (n) => n + 1 });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    const antes = JSON.stringify(b.estado());
    await expect(
      executar(b.client, cliDe({ escrever: true, ...CLI_ESTR }), bk.entradas, mudo),
    ).rejects.toThrow(/count\(zonas\) após a escrita/);
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("DELETE de zonas afeta MENOS linhas que o previsto (um fantasma já saiu por fora) → ROLLBACK total", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    // um fantasma já saiu por fora entre a leitura e a escrita: o DELETE afeta 6, não 7
    const clienteOriginal = b.client;
    let apagou = false;
    const client: Consulta = {
      async query(sql, p) {
        if (sql === SQL_DELETE_ZONAS && !apagou) {
          apagou = true;
          const [ufs, muns, zs] = p as [string[], number[], number[]];
          return clienteOriginal.query(sql, [ufs.slice(1), muns.slice(1), zs.slice(1)]);
        }
        return clienteOriginal.query(sql, p);
      },
    };
    const antes = JSON.stringify(b.estado());
    await expect(
      executar(client, cliDe({ escrever: true, ...CLI_ESTR }), bk.entradas, mudo),
    ).rejects.toThrow(/DELETE em zonas afetou 6 linha\(s\); previsto 7 — revertendo/);
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("falha do pré-voo na simulação estrutural derruba a simulação (o --escrever também falharia)", async () => {
    const b = bancoFalso({ fantasmas: true });
    const falho: Consulta = {
      async query(sql, p) {
        if (/^EXPLAIN\s+INSERT INTO zonas/.test(sql.trim())) {
          throw new Error('column "nome_x" of relation "zonas" does not exist');
        }
        return b.client.query(sql, p);
      },
    };
    await expect(executar(falho, cliDe(CLI_ESTR), entradasSimulado, mudo)).rejects.toThrow(
      /pré-voo do SQL de escrita FALHOU \(INSERT em zonas\)/,
    );
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });
});

describe("executar — a guarda contra te do simulado vale no --escrever legado", () => {
  it("EA12 do simulado + --aceitar-te-derivado → BloqueadoError, nenhuma escrita, nenhum backup", async () => {
    const b = bancoFalso({ fantasmas: true });
    const bk = comBackupFalso(b, undefined, entradasSimulado);
    await expect(
      executar(
        b.client,
        cliDe({ escrever: true, ufs: ["PE"], aceitarTeDerivado: true }),
        bk.entradas,
        mudo,
      ),
    ).rejects.toThrow(/viriam do te do SIMULADO/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.log).not.toContain("BACKUP");
  });

  it("a simulação mostra o aviso do EA12 do simulado e o bloqueio", async () => {
    const b = bancoFalso();
    const linhas: string[] = [];
    await executar(
      b.client,
      cliDe({ ufs: ["PE"], aceitarTeDerivado: true }),
      entradasSimulado,
      (s) => linhas.push(s),
    );
    const saida = linhas.join("\n");
    expect(saida).toContain("EA12 do SIMULADO (f='s'): peso vindo de te de EA20 é recusado");
    expect(saida).toContain("⛔ BLOQUEIO: 1 linha(s) de peso viriam do te do SIMULADO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executar — --pesos-oficiais (o modo de depois)
// ─────────────────────────────────────────────────────────────────────────────

const CLI_OFICIAL = {
  ufs: ["AP"],
  pesosOficiais: "perfil_eleitorado_2026.zip",
  totalUf: { AP: 577534 },
};
/** Banco com a ESTRUTURA já gravada: AP 06050×0014 em `zonas`, ainda sem peso. */
const bancoAposEstrutura = (extra: OpcoesDoFalso = {}) =>
  bancoFalso({ ...extra, zonasExtra: [AP_14] });
const entradasOficial = (b: { log: string[] }, oficial = oficialAp, falha?: Error) => {
  const backups: Backup[] = [];
  return {
    backups,
    entradas: {
      oficial,
      arquivo: "perfil_eleitorado_2026.zip",
      salvarBackup: async (bk: Backup): Promise<string> => {
        b.log.push("BACKUP");
        if (falha) throw falha;
        backups.push(bk);
        return "build/zonas-backup-falso.json";
      },
    },
  };
};

describe("executarPesosOficiais", () => {
  it("simulação: só leitura + EXPLAIN de INSERT/UPDATE de eleitorado; imprime cada linha antigo → novo e fecha com o total publicado", async () => {
    const b = bancoAposEstrutura();
    const eo = entradasOficial(b);
    const linhas: string[] = [];
    const r = await executarPesosOficiais(b.client, cliDe(CLI_OFICIAL), eo.entradas, (s) =>
      linhas.push(s),
    );
    expect(r.escreveu).toBe(false);
    expect(r.backup).toBeNull();
    expect(r.plano.bloqueios).toEqual([]);
    expect(b.params[0]!.sql).toBe("BEGIN TRANSACTION READ ONLY");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
    for (const { sql } of b.params) expect(soLeituraOuPreVoo(sql)).toBe(true);
    expect(b.log).not.toContain("BACKUP");
    expect(b.estado().pesos).toHaveLength(pesosAp.length + (pesosBanco.length - pesosAp.length));
    const saida = linhas.join("\n");
    expect(saida).toContain("[pesos-oficiais] arquivo: perfil_eleitorado_2026.zip");
    expect(saida).toContain(
      "colunas: UF=SG_UF · município=CD_MUNICIPIO · zona=NR_ZONA · quantidade=QT_ELEITORES_PERFIL",
    );
    expect(saida).toContain("AP 06050×0002: 176.626 → 176.627 (+1)");
    expect(saida).toContain("(2026, 'AP', 6050, 14, 6269, NULL)");
    expect(saida).toContain("(17 alterada(s); 0 par(es) já estavam com a contagem oficial)");
    expect(saida).toMatch(
      /AP: 18 pares em zonas · total do arquivo=577\.534 · publicado=577\.534 · Σ pesos antes=571\.248 \(-1,09% do arquivo\) · Σ depois=577\.534 → FECHA com o arquivo · arquivo × publicado: IGUAL/,
    );
    expect(saida).toContain("bloqueios: nenhum");
    expect(saida).toContain("(este modo não toca zonas)");
    expect(saida).toContain("✓ INSERT em eleitorado — planejado pelo servidor (1 linha(s))");
    expect(saida).toContain("✓ UPDATE em eleitorado — planejado pelo servidor (17 linha(s))");
    expect(saida).toContain("UPDATE eleitorado e SET eleitores_aptos = v.antigo");
  });

  it("escreve: INSERT depois UPDATE, backup ANTES, Σ do AP == total do arquivo, zonas intocada, estado == esperado, COMMIT", async () => {
    const b = bancoAposEstrutura();
    const eo = entradasOficial(b);
    const antes = {
      zonas: b.estado().zonas.map((z) => ({ ...z })),
      pesos: b.estado().pesos.map((z) => ({ ...z })),
    };
    const linhas: string[] = [];
    const r = await executarPesosOficiais(
      b.client,
      cliDe({ escrever: true, ...CLI_OFICIAL }),
      eo.entradas,
      (s) => linhas.push(s),
    );
    expect(r.escreveu).toBe(true);
    expect(r.backup).toBe("build/zonas-backup-falso.json");

    const ordem = b.params.map((x) => x.sql);
    expect(ordem[0]).toBe("BEGIN");
    expect(ordem.at(-1)).toBe("COMMIT");
    expect(ordem.filter((s) => ESCRITAS_CONHECIDAS.includes(s))).toEqual([
      SQL_INSERT_PESOS,
      SQL_UPDATE_PESOS,
    ]);
    expect(ordem.some((s) => s.trim().startsWith("SET LOCAL lock_timeout"))).toBe(true);
    expect(b.log.indexOf("BACKUP")).toBeLessThan(b.log.findIndex((l) => ESCRITA.test(l)));
    expect(b.params.some((x) => x.sql.trim().startsWith("EXPLAIN"))).toBe(false);

    const est = b.estado();
    const apPesos = est.pesos.filter((p) => p.uf === "AP");
    expect(apPesos).toHaveLength(18);
    expect(apPesos.reduce((a, p) => a + p.eleitoresAptos, 0)).toBe(577534);
    expect(est.pesos.find((p) => chaveDe(p) === chaveDe(AP_14))?.eleitoresAptos).toBe(6269);
    expect(est.zonas).toEqual(antes.zonas); // zonas intocada
    // as outras UFs não mudaram
    expect(JSON.stringify(est.pesos.filter((p) => p.uf !== "AP"))).toBe(
      JSON.stringify(antes.pesos.filter((p) => p.uf !== "AP")),
    );
    expect(diferencasDeEstado(estadoFinalOficial(antes, r.plano), est)).toEqual([]);

    const bk = eo.backups[0]!;
    expect(bk.resumo).toEqual({
      eleitorado_atualizadas: 17,
      eleitorado_removidas: 0,
      zonas_removidas: 0,
      zonas_inseridas: 0,
      eleitorado_inseridas: 1,
    });
    expect(bk.opcoes).toMatchObject({ pesosOficiais: "perfil_eleitorado_2026.zip" });
    expect(
      bk.eleitorado_atualizadas.find((x) => x.cod_municipio_tse === 6050 && x.cod_zona === 2)
        ?.eleitores_aptos,
    ).toBe(176626);
    const desfazer = bk.desfazerSql.join("\n");
    expect(desfazer).toContain("('AP', 6050, 2, 176626)");
    expect(desfazer).toContain(
      "DELETE FROM eleitorado WHERE ano = 2026 AND (uf, cod_municipio_tse, cod_zona) IN (('AP', 6050, 14));",
    );
    expect(desfazer).not.toContain("DELETE FROM zonas");

    const saida = linhas.join("\n");
    expect(saida).toContain("[escrever] COMMIT — eleitorado: +1 ~17; zonas intocada.");
    expect(saida).toContain("AP == total do arquivo oficial");
  });

  it("RECUSA (zero escrita, zero backup) quando o total publicado não bate com o arquivo", async () => {
    const b = bancoAposEstrutura();
    const eo = entradasOficial(b);
    await expect(
      executarPesosOficiais(
        b.client,
        cliDe({ escrever: true, ...CLI_OFICIAL, totalUf: { AP: 628071 } }),
        eo.entradas,
        mudo,
      ),
    ).rejects.toThrow(/AP: o arquivo oficial soma 577\.534 e o total publicado é 628\.071/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.log).not.toContain("BACKUP");
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });

  it("RECUSA se a estrutura ainda não foi gravada (par do arquivo fora de `zonas`)", async () => {
    const b = bancoFalso(); // AP 06050×0014 NÃO está em zonas
    const eo = entradasOficial(b);
    await expect(
      executarPesosOficiais(b.client, cliDe({ escrever: true, ...CLI_OFICIAL }), eo.entradas, mudo),
    ).rejects.toThrow(/NÃO estão em `zonas`.*--so-estrutural/s);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
  });

  it("RECUSA se os fantasmas ainda não saíram (PE 25313×1 segue em `zonas` e não tem contagem oficial)", async () => {
    // PE inteiro no arquivo, mas o par fantasma (em zonas E em eleitorado) não tem contagem oficial
    const b = bancoAposEstrutura();
    const pe: [Par, number][] = pesosBanco
      .filter((p) => p.uf === "PE")
      .map((p) => [p, p.eleitoresAptos]);
    const eo = entradasOficial(
      b,
      contagem(
        [...oficialAp.porPar]
          .map(([k, qt]): [Par, number] => {
            const [uf, m, z] = k.split("|");
            return [{ uf: uf!, codMunicipioTse: Number(m), codZona: Number(z) }, qt];
          })
          .concat(pe.filter(([p]) => chaveDe(p) !== "PE|25313|1")),
      ),
    );
    await expect(
      executarPesosOficiais(
        b.client,
        cliDe({
          escrever: true,
          ufs: ["AP", "PE"],
          pesosOficiais: "x.zip",
          totalUf: { AP: 577534 },
        }),
        eo.entradas,
        mudo,
      ),
    ).rejects.toThrow(
      /PE: 1 par\(es\) em `zonas` SEM contagem no arquivo oficial \(PE 25313×0001\)/,
    );
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
  });

  it("UPDATE que afeta MENOS linhas que o previsto → ROLLBACK total (o INSERT também é desfeito); backup já existe", async () => {
    const b = bancoAposEstrutura({ updateAfeta: (n) => n - 1 });
    const eo = entradasOficial(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executarPesosOficiais(b.client, cliDe({ escrever: true, ...CLI_OFICIAL }), eo.entradas, mudo),
    ).rejects.toThrow(/UPDATE em eleitorado afetou 16 linha\(s\); previsto 17 — revertendo/);
    expect(b.params.some((x) => x.sql === "COMMIT")).toBe(false);
    expect(JSON.stringify(b.estado())).toBe(antes);
    expect(eo.backups).toHaveLength(1);
  });

  it("Σ da UF depois da escrita ≠ total do arquivo → ROLLBACK total", async () => {
    const b = bancoAposEstrutura({ somaAposInsert: (real, uf) => (uf === "AP" ? real + 1 : real) });
    const eo = entradasOficial(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executarPesosOficiais(b.client, cliDe({ escrever: true, ...CLI_OFICIAL }), eo.entradas, mudo),
    ).rejects.toThrow(
      /AP: Σ eleitorado após a escrita = 577\.535, esperado 577\.534 \(o total do arquivo oficial\)/,
    );
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("estado ≠ esperado (Σ igual, linhas trocadas) → ROLLBACK total", async () => {
    const b = bancoAposEstrutura({ corromperAposUpdate: true });
    const eo = entradasOficial(b);
    const antes = JSON.stringify(b.estado());
    await expect(
      executarPesosOficiais(b.client, cliDe({ escrever: true, ...CLI_OFICIAL }), eo.entradas, mudo),
    ).rejects.toThrow(/zonas\/eleitorado depois da escrita ≠ estado esperado — revertendo/);
    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it("falha ao gravar o backup → aborta ANTES de qualquer escrita", async () => {
    const b = bancoAposEstrutura();
    const eo = entradasOficial(b, oficialAp, new Error("disco cheio"));
    await expect(
      executarPesosOficiais(b.client, cliDe({ escrever: true, ...CLI_OFICIAL }), eo.entradas, mudo),
    ).rejects.toThrow(/disco cheio/);
    expect(b.params.some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });

  it("idempotência: reexecutar com os mesmos pesos oficiais não escreve nada nem grava outro backup", async () => {
    const b = bancoAposEstrutura();
    const eo = entradasOficial(b);
    const cli = cliDe({ escrever: true, ...CLI_OFICIAL });
    await executarPesosOficiais(b.client, cli, eo.entradas, mudo);
    const n = b.params.length;
    const linhas: string[] = [];
    const r = await executarPesosOficiais(b.client, cli, eo.entradas, (s) => linhas.push(s));
    expect(r.escreveu).toBe(false);
    expect(linhas.join("\n")).toContain(
      "nada a inserir nem atualizar — os pesos já são os do arquivo oficial",
    );
    expect(b.params.slice(n).some((x) => ESCRITA.test(x.sql.trim()))).toBe(false);
    expect(eo.backups).toHaveLength(1);
  });

  it("falha do pré-voo na simulação → erro e ROLLBACK", async () => {
    const b = bancoAposEstrutura({ explainFalha: true });
    const eo = entradasOficial(b);
    await expect(
      executarPesosOficiais(b.client, cliDe(CLI_OFICIAL), eo.entradas, mudo),
    ).rejects.toThrow(/pré-voo do SQL de escrita FALHOU \(UPDATE em eleitorado\)/);
    expect(b.params.at(-1)!.sql).toBe("ROLLBACK");
  });
});
