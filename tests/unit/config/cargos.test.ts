/**
 * tests/unit/config/cargos.test.ts
 *
 * Trava a tabela canônica de cargos (`lib/config/cargos.ts`), criada em
 * 2026-09-11 para reunir o que estava espalhado por quatro lugares
 * independentes — todos travados em `1 | 3` e sem nada que forçasse sincronia
 * entre eles (ver o cabeçalho do módulo).
 *
 * Os números aqui não são decorativos: `vagasPorUf: 2` para Senador e os tetos
 * de `rpsMax` são decisões que, se regredirem em silêncio, produzem tela errada
 * (uma vaga a menos no Senado), ciclo acima do `maxDuration`, ou pico de
 * requisições acima do teto do TSE — que bloqueia o IP por 10 minutos.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CARGOS,
  CARGOS_PROPORCIONAIS,
  CARGOS_TSE,
  type CargoProporcional,
  type CargoTokenProporcional,
  cargoExisteNaUf,
  cargoFromToken,
  cargoInfo,
  cargoToken,
  eleicaoDoCargo,
  isCargoProporcional,
  isCargoTse,
  isExterior,
  parseCargoSegment,
  piorCasoAgregadoRps,
  SIGLA_EXTERIOR,
  UFS_COM_EXTERIOR,
  UFS_DA_ELEICAO,
  ufsDoCargo,
  unidadesDeApuracao,
} from "@/lib/config/cargos";

describe("tabela de cargos", () => {
  it("cobre Presidente, Governador, Senador e os três proporcionais (6, 7, 8)", () => {
    // 7 e 8 entraram em 2026-09-29 (spec 027, ADR-0066).
    expect(CARGOS_TSE).toEqual([1, 3, 5, 6, 7, 8]);
  });

  it("não cobre vices nem códigos que o TSE não usa nesta eleição", () => {
    // 2 = Vice-Presidente e 4 = Vice-Governador não têm votação própria;
    // 9/10 são suplentes de Senador (não têm votação própria no EA20).
    for (const foraDoEscopo of [0, 2, 4, 9, 10, 11, 13]) {
      expect(isCargoTse(foraDoEscopo), `cargo ${foraDoEscopo}`).toBe(false);
    }
  });

  it("Senador tem DUAS vagas por UF, não uma", () => {
    // O Senado renova 2/3 em 2026 → 2 por UF, 54 no total. O kit de UI rotula
    // "1 vaga" (ADR-0029) e a spec 016 não deve herdar esse rótulo.
    expect(cargoInfo(5).vagasPorUf).toBe(2);
    expect(CARGOS.filter((c) => c.vagasPorUf === 2)).toHaveLength(1);
  });

  it("os três proporcionais não têm nº fixo de vagas por UF", () => {
    // Federal 8 a 70; assembleias 24 a 94; distrital 24. O denominador do
    // quociente eleitoral vem do dado (`carg[].nv`), nunca hardcoded — errá-lo
    // corrompe a projeção inteira da UF.
    for (const cd of [6, 7, 8] as const) {
      expect(cargoInfo(cd).vagasPorUf, `cargo ${cd}`).toBeNull();
      expect(cargoInfo(cd).proporcional, `cargo ${cd}`).toBe(true);
    }
  });

  it("só Presidente tem arquivo agregado nacional no TSE", () => {
    expect(CARGOS.filter((c) => c.temArquivoBr).map((c) => c.cd)).toEqual([1]);
  });

  it("só Presidente e Governador admitem 2º turno", () => {
    expect(CARGOS.filter((c) => c.temSegundoTurno).map((c) => c.cd)).toEqual([1, 3]);
  });

  it("os quatro cargos de antes ingerem em zona — Deputado Federal migrou por último, em 2026-09-13", () => {
    // Senador saiu de "uf" para "zona" em 2026-09-11 (emenda ao ADR-0026 item 1,
    // decisão do usuário); Deputado Federal seguiu o mesmo caminho em
    // 2026-09-13, mesmo diagnóstico: com um boletim por estado o bootstrap tem
    // uma única unidade de reamostragem e `p_eleito`/o IC95 degeneram.
    expect(cargoInfo(1).granularidade).toBe("zona");
    expect(cargoInfo(3).granularidade).toBe("zona");
    expect(cargoInfo(5).granularidade).toBe("zona");
    expect(cargoInfo(6).granularidade).toBe("zona");
  });

  it("RF-285: as assembleias (7 e 8) nascem em UF — Fase 1, um resumo por casa (ADR-0067)", () => {
    // Fase 1 da spec 027: 26 resumos (7) + 1 (8) por rodada, sem mexer no ritmo
    // do federal. Se a Fase 2 subir, o 7 vai para "zona" aqui — e este teste
    // muda junto, de propósito.
    expect(cargoInfo(7).granularidade).toBe("uf");
    expect(cargoInfo(8).granularidade).toBe("uf");
    expect(CARGOS.filter((c) => c.granularidade === "uf").map((c) => c.cd)).toEqual([7, 8]);
  });

  it("o orçamento de rps fecha em 82 na Fase 1 — três pesados a 25, federal a 5, assembleias a 1 cada", () => {
    // A conta que mudou com Senador em zona: três pesados a 35 dariam 110 rps
    // agregados, acima do teto de 100 do TSE. A 25, o agregado volta a 80.
    // Deputado Federal foi para "zona" em 2026-09-13 mas NÃO ganhou rps —
    // continua em 5 (fatiado em 6 invocações em vez de subir a taxa por
    // invocação).
    //
    // ADR-0067 (spec 027, Fase 1): Deputado Estadual e Distrital entram a 1
    // rps CADA, lendo um resumo por casa — 80 → 82. O ADR-0036 já recusou 85;
    // a Fase 2 (7 intercalado na faixa de 5 rps do 6) volta a 81.
    const pesados = CARGOS.filter((c) => c.cd === 1 || c.cd === 3 || c.cd === 5);
    expect(pesados).toHaveLength(3);
    for (const c of pesados) expect(c.rpsMax, `cargo ${c.cd}`).toBe(25);
    expect(cargoInfo(6).rpsMax).toBe(5);
    expect(cargoInfo(7).rpsMax).toBe(1);
    expect(cargoInfo(8).rpsMax).toBe(1);
    expect(piorCasoAgregadoRps()).toBe(82);
    // E segue "bem abaixo" do teto de 100 do TSE (constituição § 1).
    expect(piorCasoAgregadoRps()).toBeLessThan(85);
  });

  it("token e código são conversíveis nos dois sentidos, sem colisão", () => {
    const tokens = CARGOS.map((c) => c.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const c of CARGOS) {
      expect(cargoToken(c.cd)).toBe(c.token);
      expect(cargoFromToken(c.token)).toBe(c.cd);
    }
  });

  it("slugs são únicos e não colidem com códigos", () => {
    const slugs = CARGOS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(Number.isNaN(Number(slug))).toBe(true);
  });
});

describe("parseCargoSegment", () => {
  it("aceita código e slug, case-insensitive, com espaço", () => {
    expect(parseCargoSegment("1")).toBe(1);
    expect(parseCargoSegment("presidente")).toBe(1);
    expect(parseCargoSegment("  Governador ")).toBe(3);
    expect(parseCargoSegment("SENADOR")).toBe(5);
    expect(parseCargoSegment("deputado-federal")).toBe(6);
    expect(parseCargoSegment("6")).toBe(6);
  });

  it("RF-285: os slugs das assembleias resolvem — é por eles que o cron chega ao cargo", () => {
    // `vercel.ts` aponta para `/api/ingest/deputado-estadual` e
    // `/api/ingest/deputado-distrital`; `app/api/ingest/[cargo]/route.ts`
    // resolve o segmento por aqui.
    expect(parseCargoSegment("deputado-estadual")).toBe(7);
    expect(parseCargoSegment("Deputado-Distrital")).toBe(8);
    expect(parseCargoSegment("7")).toBe(7);
    expect(parseCargoSegment("8")).toBe(8);
  });

  it("devolve null para tudo que não é cargo coberto", () => {
    for (const lixo of [
      "",
      "   ",
      "2",
      "4",
      "99",
      "-1",
      "1.5",
      "vereador",
      "deputado",
      "../etc/passwd",
    ]) {
      expect(parseCargoSegment(lixo), `segmento ${JSON.stringify(lixo)}`).toBeNull();
    }
  });

  it("não aceita o TOKEN de chave como segmento de rota", () => {
    // `"pres"`/`"gov"` nomeiam chaves do Global Config (ADR-0012), não rotas.
    // Aceitá-los aqui criaria dois caminhos para a mesma coisa.
    for (const token of CARGOS.map((c) => c.token)) {
      expect(parseCargoSegment(token), `token ${token}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Eleição por cargo (TSE 2026: pleito 17801 com DOIS códigos de eleição)
// ---------------------------------------------------------------------------

describe("eleicao / eleicaoDoCargo", () => {
  // O TSE 2026 publica Presidente sob a Eleição Ordinária Federal (21270) e
  // Governador/Senador/Deputado sob a Estadual (21272). Este literal é o que
  // impede a tabela de virar "tudo federal" ou "tudo estadual" em silêncio —
  // um erro aqui manda o cargo inteiro para o arquivo errado do CDN.
  it("trava o mapeamento cargo → eleição", () => {
    // 7 e 8 moram na MESMA eleição do TSE que o federal (21272), com o mesmo
    // leiaute "Proporcional | UF" (spec 027).
    expect(CARGOS.map((c) => [c.cd, c.eleicao])).toEqual([
      [1, "federal"],
      [3, "estadual"],
      [5, "estadual"],
      [6, "estadual"],
      [7, "estadual"],
      [8, "estadual"],
    ]);
  });

  it("Presidente é o ÚNICO cargo federal", () => {
    expect(CARGOS.filter((c) => c.eleicao === "federal").map((c) => c.cd)).toEqual([1]);
  });

  it("eleicaoDoCargo devolve o valor da tabela para todos os cargos cobertos", () => {
    for (const c of CARGOS) {
      expect(eleicaoDoCargo(c.cd), `cargo ${c.cd}`).toBe(c.eleicao);
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 027 — cargos proporcionais e UFs por cargo (RF-278, RF-279, ADR-0066)
// ---------------------------------------------------------------------------

describe("CargoProporcional — derivado da tabela, não listado à mão", () => {
  it("o tipo é exatamente 6 | 7 | 8, e os tokens dep | est | dis", () => {
    expectTypeOf<CargoProporcional>().toEqualTypeOf<6 | 7 | 8>();
    expectTypeOf<CargoTokenProporcional>().toEqualTypeOf<"dep" | "est" | "dis">();
  });

  it("isCargoProporcional lê o campo `proporcional` da tabela", () => {
    expect(CARGOS_PROPORCIONAIS).toEqual([6, 7, 8]);
    expect(CARGOS.filter((c) => isCargoProporcional(c.cd)).map((c) => c.cd)).toEqual(
      CARGOS.filter((c) => c.proporcional).map((c) => c.cd),
    );
    for (const n of [1, 3, 5, 2, 4, 9, 0, -6]) {
      expect(isCargoProporcional(n), `cargo ${n}`).toBe(false);
    }
  });

  it("RF-279: tokens e slugs dos três proporcionais são distintos — nenhuma chave colide", () => {
    // O mesmo token para os três faria SP estadual gravar por cima de SP
    // federal em `projection-current-dep-t1`.
    expect(CARGOS_PROPORCIONAIS.map((c) => cargoToken(c))).toEqual(["dep", "est", "dis"]);
    expect(CARGOS_PROPORCIONAIS.map((c) => cargoInfo(c).slug)).toEqual([
      "deputado-federal",
      "deputado-estadual",
      "deputado-distrital",
    ]);
    expect(cargoFromToken("est")).toBe(7);
    expect(cargoFromToken("dis")).toBe(8);
  });
});

describe("ADR-0045 — o exterior (ZZ) é a 28ª unidade, SÓ do Presidente", () => {
  it("`abrangeExterior` é true só no cargo 1", () => {
    for (const c of CARGOS) {
      expect(c.abrangeExterior, `cargo ${c.cd}`).toBe(c.cd === 1);
    }
  });

  it("🔴 ZZ NÃO entra na lista compartilhada das 27 (cargos 3/5/6 pediriam 404 ao TSE)", () => {
    expect(UFS_DA_ELEICAO).not.toContain("ZZ");
    for (const cd of [3, 5, 6, 7, 8] as const) {
      expect(ufsDoCargo(cd), `cargo ${cd}`).not.toContain("ZZ");
      expect(cargoExisteNaUf(cd, "ZZ"), `cargo ${cd}`).toBe(false);
      expect(cargoExisteNaUf(cd, "zz"), `cargo ${cd}`).toBe(false);
    }
  });

  it("cargo 1: 28 unidades, ZZ por último, lista congelada", () => {
    expect(ufsDoCargo(1)).toHaveLength(28);
    expect(ufsDoCargo(1).at(-1)).toBe(SIGLA_EXTERIOR);
    expect(UFS_COM_EXTERIOR).toEqual(ufsDoCargo(1));
    expect(Object.isFrozen(UFS_COM_EXTERIOR)).toBe(true);
    expect(cargoExisteNaUf(1, "zz")).toBe(true);
  });

  it("unidadesDeApuracao — o denominador dos contadores 'N de M'", () => {
    expect(unidadesDeApuracao(1)).toBe(28);
    expect(unidadesDeApuracao(3)).toBe(27);
    expect(unidadesDeApuracao(5)).toBe(27);
    expect(unidadesDeApuracao(6)).toBe(27);
    expect(unidadesDeApuracao(7)).toBe(26);
    expect(unidadesDeApuracao(8)).toBe(1);
  });

  it("isExterior — só ZZ, em qualquer caixa", () => {
    expect(isExterior("ZZ")).toBe(true);
    expect(isExterior("zz")).toBe(true);
    expect(isExterior("SP")).toBe(false);
    expect(isExterior("BR")).toBe(false);
  });
});

describe("RF-278 — em que UFs cada corrida existe (ufsDoCargo)", () => {
  it("as 27 UFs da eleição, sem repetição, com o DF", () => {
    expect(UFS_DA_ELEICAO).toHaveLength(27);
    expect(new Set(UFS_DA_ELEICAO).size).toBe(27);
    expect(UFS_DA_ELEICAO).toContain("DF");
  });

  it("os quatro cargos de antes existem nas 27 (o Presidente, também no exterior)", () => {
    for (const cd of [3, 5, 6] as const) {
      expect(ufsDoCargo(cd), `cargo ${cd}`).toEqual(UFS_DA_ELEICAO);
    }
    // ADR-0045 — o Presidente tem as 27 + o exterior.
    expect(ufsDoCargo(1)).toEqual([...UFS_DA_ELEICAO, "ZZ"]);
  });

  it("🔴 Deputado Estadual (7): as 26 UFs SEM o DF — o DF não tem assembleia", () => {
    const ufs = ufsDoCargo(7);
    expect(ufs).toHaveLength(26);
    expect(ufs).not.toContain("DF");
    expect([...ufs, "DF"].sort()).toEqual([...UFS_DA_ELEICAO].sort());
    expect(cargoExisteNaUf(7, "DF")).toBe(false);
    expect(cargoExisteNaUf(7, "sp")).toBe(true);
  });

  it("🔴 Deputado Distrital (8): SÓ o DF", () => {
    expect(ufsDoCargo(8)).toEqual(["DF"]);
    expect(cargoExisteNaUf(8, "df")).toBe(true);
    for (const uf of UFS_DA_ELEICAO.filter((u) => u !== "DF")) {
      expect(cargoExisteNaUf(8, uf), uf).toBe(false);
    }
  });

  it("as listas devolvidas não podem ser alteradas por quem as recebe", () => {
    expect(Object.isFrozen(ufsDoCargo(1))).toBe(true);
    expect(Object.isFrozen(ufsDoCargo(7))).toBe(true);
    expect(Object.isFrozen(ufsDoCargo(8))).toBe(true);
  });
});
