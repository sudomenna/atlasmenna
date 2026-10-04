/**
 * tests/unit/tse/targets.test.ts
 *
 * Unit tests para lib/tse/targets.ts — hardening pré-simulado (2026-09-05).
 *
 * Cobre: RF-001 (descoberta de endpoints, agora com host configurável via
 * TSE_BASE_URL), validação de TSE_COD_ELEICAO, cache keyed por
 * env|codEleicao|baseUrl|granularidade, TSE_CARGOS e TSE_GRANULARIDADE.
 *
 * 2026-09-05 — REESCRITA (9 PDFs oficiais TSE 2026): o builder de URL
 * anterior tinha subpasta de município, ordem `-c-z` invertida e faltava o
 * sufixo `-u` (Divergência 1 do diagnóstico pré-simulado). Os testes de URL
 * abaixo conferem string EXATA contra os exemplos dos documentos oficiais
 * (tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt § 2,
 * tse-ea14-.../tse-ea15-... § 2) — ver docs/reference/tse-2026-leiautes.md.
 *
 * `@/lib/db` é mockado (vi.mock, hoisted) para que `listIngestTargets`
 * nunca toque o Neon real quando a granularidade é "zona" — o ponto do teste
 * é o cache/URL/env parsing, não o conteúdo da tabela `zonas`. O mock devolve
 * sempre `[]` (zero zonas); o que importa é QUANTAS VEZES `db.select` foi
 * chamado, não o resultado. Em granularidade "uf" (opt-in), `listIngestTargets`
 * NÃO toca o DB — as 27 UFs são uma lista estática.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const chain = {
    // `.from()` retorna um Promise REAL (não um objeto com uma prop `then`
    // fabricada) com `.where()` anexado — assim ele é "awaitable" tanto no
    // caminho de produção (sem `.where()`) quanto no de preview (com
    // `.where()`), e o biome não reclama de "then property" suspeita porque
    // `.then` aqui é herdado do protótipo de Promise, não uma prop própria.
    from: () => Object.assign(Promise.resolve([]), { where: () => Promise.resolve([]) }),
  };
  return {
    db: { select: vi.fn(() => chain) },
    schema: {
      zonas: { codZona: "cod_zona", codMunicipioTse: "cod_municipio_tse", uf: "uf" },
    },
  };
});

import { db } from "@/lib/db";
import type { Target } from "@/lib/tse/targets";
import {
  buildEA14Url,
  buildEA15Url,
  buildEA20Url,
  buildEA20UrlBr,
  buildEA20UrlMunicipio,
  buildEA20UrlUf,
  buildEA20UrlZona,
  clearTargetsCache,
  getActiveCargos,
  getCodEleicao,
  getGranularidade,
  getTseBaseUrl,
  listIngestTargets,
  sliceTargets,
} from "@/lib/tse/targets";

afterEach(() => {
  vi.unstubAllEnvs();
  clearTargetsCache();
  vi.mocked(db.select).mockClear();
});

// ---------------------------------------------------------------------------
// getTseBaseUrl
// ---------------------------------------------------------------------------

describe("getTseBaseUrl", () => {
  it("retorna o default de produção quando TSE_BASE_URL está ausente", () => {
    vi.stubEnv("TSE_BASE_URL", "");
    expect(getTseBaseUrl()).toBe("https://resultados.tse.jus.br/oficial");
  });

  it("aceita host https customizado (ex.: ambiente de simulado)", () => {
    vi.stubEnv("TSE_BASE_URL", "https://resultados-sim.tse.jus.br/oficial");
    expect(getTseBaseUrl()).toBe("https://resultados-sim.tse.jus.br/oficial");
  });

  it("aceita http://localhost (mock local)", () => {
    vi.stubEnv("TSE_BASE_URL", "http://localhost:8787/oficial");
    expect(getTseBaseUrl()).toBe("http://localhost:8787/oficial");
  });

  it("aceita http://127.0.0.1 (mock local)", () => {
    vi.stubEnv("TSE_BASE_URL", "http://127.0.0.1:8787/oficial");
    expect(getTseBaseUrl()).toBe("http://127.0.0.1:8787/oficial");
  });

  it("normaliza barra final", () => {
    vi.stubEnv("TSE_BASE_URL", "https://resultados.tse.jus.br/oficial/");
    expect(getTseBaseUrl()).toBe("https://resultados.tse.jus.br/oficial");
  });

  it("lança erro para http:// em host não-local (downgrade de TLS)", () => {
    vi.stubEnv("TSE_BASE_URL", "http://resultados.tse.jus.br/oficial");
    expect(() => getTseBaseUrl()).toThrow();
  });

  it("lança erro para valor que não é uma URL válida", () => {
    vi.stubEnv("TSE_BASE_URL", "não-é-url");
    expect(() => getTseBaseUrl()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// URL builders — string exata contra os exemplos dos documentos oficiais
// ---------------------------------------------------------------------------

const BASE = "https://x.test/oficial";
const COD_ELEICAO = "ele2026/999999"; // segmento numérico "999999" == exemplo dos PDFs

describe("buildEA20UrlZona", () => {
  it("monta a URL de zona no formato oficial (Instruções §5 + EA20 §2)", () => {
    const url = buildEA20UrlZona({
      codEleicao: COD_ELEICAO,
      uf: "sp",
      codMunicipioTse: 71072,
      codZona: 1,
      cargo: 3,
      baseUrl: BASE,
    });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/sp/sp71072-z0001-c0003-e999999-u.json`);
  });

  it("zero-pad município a 5 dígitos", () => {
    const url = buildEA20UrlZona({
      codEleicao: COD_ELEICAO,
      uf: "rj",
      codMunicipioTse: 555,
      codZona: 42,
      cargo: 1,
      baseUrl: BASE,
    });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/rj/rj00555-z0042-c0001-e999999-u.json`);
  });

  it("NÃO tem subpasta de município (dados/<uf> é pasta folha)", () => {
    const url = buildEA20UrlZona({
      codEleicao: COD_ELEICAO,
      uf: "sp",
      codMunicipioTse: 71072,
      codZona: 1,
      cargo: 3,
      baseUrl: BASE,
    });
    // Exatamente 1 segmento de UF entre "dados/" e o nome do arquivo.
    expect(url).not.toContain("dados/sp/sp71072/");
  });
});

describe("buildEA20UrlMunicipio", () => {
  it("monta a URL de município no formato oficial (EA20 §2)", () => {
    const url = buildEA20UrlMunicipio({
      codEleicao: COD_ELEICAO,
      uf: "sp",
      codMunicipioTse: 71072,
      cargo: 3,
      baseUrl: BASE,
    });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/sp/sp71072-c0003-e999999-u.json`);
  });
});

describe("buildEA20UrlUf", () => {
  it("monta a URL de UF agregada no formato oficial (EA20 §2)", () => {
    const url = buildEA20UrlUf({ codEleicao: COD_ELEICAO, uf: "sp", cargo: 3, baseUrl: BASE });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/sp/sp-c0003-e999999-u.json`);
  });
});

describe("buildEA20UrlBr", () => {
  it("monta a URL nacional agregada no formato oficial (EA20 §2)", () => {
    const url = buildEA20UrlBr({ codEleicao: COD_ELEICAO, cargo: 1, baseUrl: BASE });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/br/br-c0001-e999999-u.json`);
  });
});

describe("buildEA14Url", () => {
  it("monta a URL de acompanhamento Brasil — SEM cargo no nome (EA14 §2)", () => {
    const url = buildEA14Url({ codEleicao: COD_ELEICAO, baseUrl: BASE });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/br/br-e999999-ab.json`);
  });
});

describe("buildEA15Url", () => {
  it("monta a URL de acompanhamento por UF — SEM cargo no nome (EA15 §2)", () => {
    const url = buildEA15Url({ codEleicao: COD_ELEICAO, uf: "sp", baseUrl: BASE });
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/sp/sp-e999999-ab.json`);
  });
});

// ---------------------------------------------------------------------------
// buildEA20Url — alias legado, delega para buildEA20UrlZona
// ---------------------------------------------------------------------------

describe("buildEA20Url (legado — delega para buildEA20UrlZona)", () => {
  it("usa o baseUrl explícito e monta no formato oficial corrigido", () => {
    const url = buildEA20Url(COD_ELEICAO, "SP", 71072, 1, 3, BASE);
    expect(url).toBe(`${BASE}/${COD_ELEICAO}/dados/sp/sp71072-z0001-c0003-e999999-u.json`);
  });

  it("usa TSE_BASE_URL do ambiente quando baseUrl não é passado explicitamente", () => {
    vi.stubEnv("TSE_BASE_URL", "https://resultados-sim.tse.jus.br/oficial");
    const url = buildEA20Url("ele2026/1", "RJ", 12345, 2, 3);
    expect(url.startsWith("https://resultados-sim.tse.jus.br/oficial/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCodEleicao
// ---------------------------------------------------------------------------

describe("getCodEleicao", () => {
  /** Zera as três variáveis — cada caso liga só as que quer. */
  function limparEnvsDeEleicao(): void {
    vi.stubEnv("TSE_COD_ELEICAO", "");
    vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", "");
    vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", "");
  }

  beforeEach(limparEnvsDeEleicao);

  it("lança erro quando ausente", () => {
    expect(() => getCodEleicao("federal")).toThrow();
    expect(() => getCodEleicao("estadual")).toThrow();
  });

  it("lança erro para formato inválido (sem barra, sem dígitos, prefixo errado)", () => {
    for (const bad of ["2026/619", "ele2026-619", "ele26/619", "ele2026/abc", "ele2026/"]) {
      vi.stubEnv("TSE_COD_ELEICAO", bad);
      expect(() => getCodEleicao("federal"), `esperava throw para "${bad}"`).toThrow();
    }
  });

  it("aceita e retorna trimado o formato válido ele<AAAA>/<dígitos>", () => {
    vi.stubEnv("TSE_COD_ELEICAO", "  ele2026/619  ");
    expect(getCodEleicao("federal")).toBe("ele2026/619");
  });

  it("cada eleição lê a SUA variável específica", () => {
    vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", "ele2026/21270");
    vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", "ele2026/21272");
    expect(getCodEleicao("federal")).toBe("ele2026/21270");
    expect(getCodEleicao("estadual")).toBe("ele2026/21272");
  });

  it("o legado TSE_COD_ELEICAO supre as duas quando nenhuma específica existe", () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    expect(getCodEleicao("federal")).toBe("ele2026/619");
    expect(getCodEleicao("estadual")).toBe("ele2026/619");
  });

  it("a específica vence o legado", () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/999");
    vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", "ele2026/21270");
    expect(getCodEleicao("federal")).toBe("ele2026/21270");
    // Sem ESTADUAL própria, o legado ainda responde pela estadual.
    expect(getCodEleicao("estadual")).toBe("ele2026/999");
  });

  // O ponto mais importante deste bloco: uma eleição NUNCA supre a outra.
  // Se a estadual faltar, o certo é falhar alto — cair no código federal
  // publicaria Governador/Senador/Deputado sob o arquivo de Presidente, e o
  // TSE responderia 404 em massa (ou, pior, 200 com o conteúdo errado).
  it("não cruza: FEDERAL definida, ESTADUAL e legado ausentes → estadual lança", () => {
    vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", "ele2026/21270");
    expect(getCodEleicao("federal")).toBe("ele2026/21270");
    expect(() => getCodEleicao("estadual")).toThrow();
  });

  it("não cruza no sentido inverso: ESTADUAL definida, FEDERAL e legado ausentes → federal lança", () => {
    vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", "ele2026/21272");
    expect(getCodEleicao("estadual")).toBe("ele2026/21272");
    expect(() => getCodEleicao("federal")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Código de eleição POR CARGO (TSE 2026: 21270 federal / 21272 estadual)
// ---------------------------------------------------------------------------

describe("listIngestTargets — cada cargo usa o código da SUA eleição", () => {
  const FEDERAL = "ele2026/21270";
  const ESTADUAL = "ele2026/21272";
  const PARES = [
    { uf: "SP", codMunicipioTse: 71072, codZona: 1 },
    { uf: "MG", codMunicipioTse: 40177, codZona: 4 },
  ];

  beforeEach(() => {
    vi.stubEnv("TSE_COD_ELEICAO", ""); // sem legado: só as específicas valem
    vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", FEDERAL);
    vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", ESTADUAL);
  });

  it("Presidente (cargo 1) usa o código federal, e nenhuma URL cita o estadual", async () => {
    mockZonasRowsOnce([...PARES]);
    const targets = await listIngestTargets("production", { cargo: 1 });

    // RF-199 (spec 021): produção soma 27 UF + 1 BR (só cargo 1) aos alvos
    // de zona — não substitui nenhum. PARES.length continua a contagem de
    // zona, agora só uma parcela do total.
    // ADR-0045: o cargo 1 tem 28 unidades (27 UFs + o exterior `ZZ`).
    expect(targets).toHaveLength(PARES.length + 28 + 1);
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(PARES.length);
    expect(new Set(targets.map((t) => t.codEleicao))).toEqual(new Set([FEDERAL]));
    expect(targets.every((t) => t.url.includes(`/${FEDERAL}/dados/`))).toBe(true);
    expect(targets.every((t) => t.url.endsWith("-e021270-u.json"))).toBe(true);
    expect(targets.some((t) => t.url.includes("21272"))).toBe(false);
  });

  it.each([
    { cargo: 3, nome: "Governador" },
    { cargo: 5, nome: "Senador" },
    { cargo: 6, nome: "Deputado Federal" },
  ] as const)("cargo $cargo ($nome) usa o código estadual, e nenhuma URL cita o federal", async ({
    cargo,
  }) => {
    mockZonasRowsOnce([...PARES]);
    const targets = await listIngestTargets("production", { cargo });

    // RF-199 (spec 021): +27 UF agregadas, sem BR (só cargo 1 tem arquivo
    // nacional — `temArquivoBr`, lib/config/cargos.ts).
    expect(targets).toHaveLength(PARES.length + 27);
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(PARES.length);
    expect(new Set(targets.map((t) => t.codEleicao))).toEqual(new Set([ESTADUAL]));
    expect(targets.every((t) => t.url.includes(`/${ESTADUAL}/dados/`))).toBe(true);
    expect(targets.every((t) => t.url.endsWith("-e021272-u.json"))).toBe(true);
    // A asserção que mata a mutação "cargo 3 é federal" na tabela de cargos.
    expect(targets.some((t) => t.url.includes("21270"))).toBe(false);
  });

  it("um ciclo com os dois cargos produz alvos sob DOIS códigos distintos", async () => {
    vi.stubEnv("TSE_CARGOS", "1,3");
    mockZonasRowsOnce([...PARES]); // cargo 1
    mockZonasRowsOnce([...PARES]); // cargo 3

    const targets = await listIngestTargets("production", {});

    expect(new Set(targets.map((t) => t.codEleicao))).toEqual(new Set([FEDERAL, ESTADUAL]));
    for (const t of targets) {
      const esperado = t.cargo === 1 ? FEDERAL : ESTADUAL;
      expect(t.codEleicao, `cargo ${t.cargo} deveria usar ${esperado}`).toBe(esperado);
      expect(t.url).toContain(`/${esperado}/dados/`);
    }
  });

  it("trocar só o código estadual invalida o cache do cargo 3 sem tocar o do cargo 1", async () => {
    mockZonasRowsOnce([...PARES]);
    const pres1 = await listIngestTargets("production", { cargo: 1 });
    mockZonasRowsOnce([...PARES]);
    const gov1 = await listIngestTargets("production", { cargo: 3 });

    vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", "ele2026/21999");

    // Cargo 1: chave de cache inalterada — devolve o cacheado, sem novo SELECT.
    const pres2 = await listIngestTargets("production", { cargo: 1 });
    expect(pres2).toEqual(pres1);

    // Cargo 3: chave mudou — refaz e reflete o código novo.
    mockZonasRowsOnce([...PARES]);
    const gov2 = await listIngestTargets("production", { cargo: 3 });
    expect(gov1[0]?.codEleicao).toBe(ESTADUAL);
    expect(new Set(gov2.map((t) => t.codEleicao))).toEqual(new Set(["ele2026/21999"]));
  });
});

// ---------------------------------------------------------------------------
// getActiveCargos (TSE_CARGOS)
// ---------------------------------------------------------------------------

describe("getActiveCargos", () => {
  it("default [1, 3] quando TSE_CARGOS está ausente", () => {
    vi.stubEnv("TSE_CARGOS", "");
    expect(getActiveCargos()).toEqual([1, 3]);
  });

  it('TSE_CARGOS="1" → [1]', () => {
    vi.stubEnv("TSE_CARGOS", "1");
    expect(getActiveCargos()).toEqual([1]);
  });

  it('TSE_CARGOS="3" → [3]', () => {
    vi.stubEnv("TSE_CARGOS", "3");
    expect(getActiveCargos()).toEqual([3]);
  });

  it("ignora tokens inválidos e cai no default se nada sobrar", () => {
    vi.stubEnv("TSE_CARGOS", "2,9,abc");
    expect(getActiveCargos()).toEqual([1, 3]);
  });

  it("ignora tokens inválidos individuais mantendo os válidos", () => {
    // `2` (vice) — o `7` deixou de ser inválido com a spec 027.
    vi.stubEnv("TSE_CARGOS", "1,2");
    expect(getActiveCargos()).toEqual([1]);
  });

  it("RF-285: 7 e 8 são cargos válidos em TSE_CARGOS (a chave de desligamento os reconhece)", () => {
    vi.stubEnv("TSE_CARGOS", "1,3,5,6,7,8");
    expect(getActiveCargos()).toEqual([1, 3, 5, 6, 7, 8]);
  });
});

// ---------------------------------------------------------------------------
// getGranularidade (TSE_GRANULARIDADE)
// ---------------------------------------------------------------------------

describe("getGranularidade", () => {
  // Default `zona` desde 2026-09-05 (E4): o modelo precisa de dado por zona e o
  // modo `uf` está quebrado no modelo (peso 0 para `cod_zona = 0`). Se este teste
  // voltar a esperar "uf", produção passa a cair num modo quebrado quando a env
  // faltar — a mudança é deliberada, não regressão.
  it('default "zona" quando TSE_GRANULARIDADE está ausente', () => {
    vi.stubEnv("TSE_GRANULARIDADE", "");
    expect(getGranularidade()).toBe("zona");
  });

  it('"uf" continua aceito como opt-in explícito', () => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    expect(getGranularidade()).toBe("uf");
  });

  it('aceita "zona"', () => {
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    expect(getGranularidade()).toBe("zona");
  });

  it('aceita "uf" explícito e é case-insensitive', () => {
    vi.stubEnv("TSE_GRANULARIDADE", "UF");
    expect(getGranularidade()).toBe("uf");
  });

  it('cai no default "zona" para valor inválido', () => {
    vi.stubEnv("TSE_GRANULARIDADE", "municipio");
    expect(getGranularidade()).toBe("zona");
  });
});

// ---------------------------------------------------------------------------
// getGranularidade — interruptor específico do cargo 6 (TSE_DEPUTADO_GRANULARIDADE)
// ---------------------------------------------------------------------------

describe("getGranularidade — interruptor de emergência do cargo 6 (2026-09-13)", () => {
  it("estado 1/2 — ausente: cargo 6 segue o padrão da tabela (zona)", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "");
    expect(getGranularidade(6)).toBe("zona");
  });

  it("estado 2/2 — TSE_DEPUTADO_GRANULARIDADE=uf reverte só o cargo 6", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");
    expect(getGranularidade(6)).toBe("uf");
  });

  it("é case-insensitive, como TSE_GRANULARIDADE", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "UF");
    expect(getGranularidade(6)).toBe("uf");
  });

  it("NÃO afeta outros cargos — Presidente continua em zona", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");
    expect(getGranularidade(1)).toBe("zona");
    expect(getGranularidade(3)).toBe("zona");
    expect(getGranularidade(5)).toBe("zona");
  });

  it("o ESPECÍFICO vence o global quando os dois estão setados e discordam", () => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "zona");
    // Precedência: específico do cargo 6 > global > padrão da tabela.
    // O cargo 6 obedece ao seu próprio interruptor; os demais, ao global.
    expect(getGranularidade(6)).toBe("zona");
    expect(getGranularidade(1)).toBe("uf");
    expect(getGranularidade(3)).toBe("uf");
    expect(getGranularidade(5)).toBe("uf");
  });

  it("cenário real do preview: TSE_GRANULARIDADE=zona NÃO desativa o interruptor de emergência", () => {
    // Regressão de 2026-09-13. `TSE_GRANULARIDADE=zona` está setada no ambiente
    // `preview` da Vercel desde o armamento do simulado (verificado na API em
    // 13/09). Com a precedência anterior (global > específico) ela desativava em
    // SILÊNCIO o interruptor do cargo 6 — justamente no único ambiente onde ele
    // poderia ser exercitado com dado real antes de 04/10. O operador acionaria
    // a rede de segurança e nada mudaria, sem erro e sem aviso.
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");
    expect(getGranularidade(6)).toBe("uf");
    // E os outros três seguem o global, intocados pelo interruptor do cargo 6.
    expect(getGranularidade(1)).toBe("zona");
    expect(getGranularidade(5)).toBe("zona");
  });

  it("valor inválido é ignorado com warn, cai no padrão do cargo", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "municipio");
    expect(getGranularidade(6)).toBe("zona");
  });
});

// ---------------------------------------------------------------------------
// listIngestTargets — granularidade "uf" (default) — NÃO toca o DB
// ---------------------------------------------------------------------------

describe("listIngestTargets — granularidade uf (opt-in explícito)", () => {
  // Desde 2026-09-05 o default é "zona" (E4). Estes testes exercitam o caminho
  // `uf` — que continua existindo como opt-in — e por isso o pedem explicitamente.
  beforeEach(() => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
  });

  it("produção: 27 UFs × cargos ativos + 1 BR (só cargo 1) — zero chamadas ao DB", async () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_CARGOS", "1,3");

    const targets = await listIngestTargets("production");

    // ADR-0045: 28 do cargo 1 (com o exterior) + 27 do cargo 3 + 1 BR.
    expect(targets).toHaveLength(28 + 27 + 1);
    expect(targets.filter((t) => t.uf === "ZZ").map((t) => t.cargo)).toEqual([1]);
    expect(targets.every((t) => t.nivel === "uf" || t.nivel === "br")).toBe(true);
    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(1);
    expect(targets.find((t) => t.nivel === "br")?.cargo).toBe(1);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("produção: sem BR quando cargo 1 não está ativo", async () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_CARGOS", "3");

    const targets = await listIngestTargets("production");

    expect(targets).toHaveLength(27);
    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(0);
  });

  it("preview: 1 target de nível uf por entrada da whitelist", async () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1,RJ:3");

    const targets = await listIngestTargets("preview");

    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.nivel === "uf")).toBe(true);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("whitelist aceita os QUATRO cargos cobertos — não só 1 e 3 (regressão 2026-09-13)", async () => {
    // Até 13/09 a validação era literal (`cargoNum !== 1 && cargoNum !== 3`),
    // escrita quando a eleição tinha dois cargos. Senador (5) e Deputado (6)
    // entraram em 11/09 e os tokens deles eram DESCARTADOS com um console.warn
    // que ninguém lê num cron. Como a whitelist só vale em `preview` — o
    // ambiente do simulado oficial —, o efeito era que os dois cargos novos
    // não podiam ser exercitados no único ambiente com chance de testá-los
    // com dado real antes de 04/10. Quarta ocorrência da mesma família:
    // constante literal de cargo que envelhece quando a eleição cresce.
    // Senador e Deputado NÃO entram no ciclo genérico (getActiveCargos default
    // "1,3"); quem os pede é a rota própria — `/api/ingest/senador` e
    // `/api/ingest/deputado-federal/<fatia>` — via `opts.cargo`. É esse o
    // caminho exercitado aqui, porque é o único por onde eles passam.
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_CARGOS", "");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1,SP:3,SP:5,SP:6");

    const dep = await listIngestTargets("preview", { cargo: 6 });
    const sen = await listIngestTargets("preview", { cargo: 5 });

    // Antes da correção os dois vinham VAZIOS: `parseWhitelist` descartava
    // `SP:5` e `SP:6` com um console.warn, e o simulado não tinha como
    // exercitar nenhum dos dois cargos.
    expect(dep.map((t) => t.cargo)).toEqual([6]);
    expect(sen.map((t) => t.cargo)).toEqual([5]);
  });

  it("whitelist: cargo fora dos cobertos é descartado, e não derruba os válidos", async () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_CARGOS", "");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:99,SP:6");

    const targets = await listIngestTargets("preview", { cargo: 6 });

    // 99 não é cargo desta eleição — cai fora; o 6 sobrevive.
    expect(targets.map((t) => t.cargo)).toEqual([6]);
  });
});

// ---------------------------------------------------------------------------
// listIngestTargets — granularidade "zona" (opt-in) — cache keyed por
// env|codEleicao|baseUrl|granularidade
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// listIngestTargets — pares (município × zona), migration 0006 (ADR-0035 D1)
// e filtro por cargo (ADR-0035 D3 — cron por cargo)
// ---------------------------------------------------------------------------

/**
 * mockZonasRowsOnce — sobrescreve APENAS a próxima chamada de `db.select`
 * para devolver `rows` — usado para simular `zonas` com 2+ pares (mesma
 * zona, municípios distintos), o cenário real do TSE 2026 (migration 0006:
 * uma linha de `zonas` é um PAR, não mais "1 município por zona"). O objeto
 * devolvido é awaitable (Promise real) e também tem `.where()` — cobre tanto
 * `buildProductionTargetsZona` (sem `.where()`) quanto
 * `buildPreviewTargetsZona` (com `.where()`).
 */
function mockZonasRowsOnce(
  rows: Array<{ uf: string; codMunicipioTse: number; codZona: number }>,
): void {
  const awaitable = Object.assign(Promise.resolve(rows), {
    where: () => Promise.resolve(rows),
  });
  vi.mocked(db.select).mockReturnValueOnce({ from: () => awaitable } as never);
}

describe("listIngestTargets — granularidade por cargo (ADR-0026 + emenda (b))", () => {
  beforeEach(() => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    // Sem `TSE_GRANULARIDADE`: é o ponto do teste — cada cargo cai no padrão da
    // tabela canônica, e não num modo global.
  });

  // Lacuna apontada pelo `rf-coverage-checker` em 2026-09-11: existiam testes
  // que USAVAM 6.110 como constante (o de `maxDuration` no rate limiter) mas
  // nenhum que exigisse que a enumeração de fato produzisse um alvo por par.
  // Um erro na montagem dos pares — na migration 0006 ou na query de `zonas` —
  // passaria despercebido, que é exatamente o defeito de 10/09 (2.651 alvos em
  // vez de 6.110, sem um único 404).
  it.each([
    { cargo: 1, nome: "Presidente" },
    { cargo: 3, nome: "Governador" },
    { cargo: 5, nome: "Senador" },
    { cargo: 6, nome: "Deputado Federal" },
  ] as const)("cargo $cargo ($nome) enumera UM alvo de zona por par, sem perder nenhum", async ({
    cargo,
  }) => {
    const pares = [
      { uf: "SP", codMunicipioTse: 71072, codZona: 1 },
      { uf: "SP", codMunicipioTse: 12345, codZona: 1 },
      { uf: "MG", codMunicipioTse: 40177, codZona: 4 },
      { uf: "MG", codMunicipioTse: 49352, codZona: 4 },
      { uf: "MG", codMunicipioTse: 41319, codZona: 4 },
    ];
    mockZonasRowsOnce(pares);

    const targets = await listIngestTargets("production", { cargo });

    // Um alvo de ZONA por PAR — não por zona. Com a regra antiga (uma linha
    // por zona) isto daria 2, e é assim que 56% dos votos sumiam em silêncio.
    // RF-199 (spec 021) soma os 27 agregados de UF (+1 BR para cargo 1) por
    // cima — o total já não é mais só `pares.length`, mas a fatia de zona
    // continua intacta e é o que este teste protege.
    const zonaTargets = targets.filter((t) => t.nivel === "zona");
    expect(zonaTargets).toHaveLength(pares.length);
    expect(zonaTargets.every((t) => t.cargo === cargo)).toBe(true);
    expect(new Set(zonaTargets.map((t) => t.url)).size).toBe(pares.length);
    expect(zonaTargets.map((t) => t.codMunicipioTse).sort()).toEqual(
      pares.map((p) => p.codMunicipioTse).sort(),
    );

    const ufTargets = targets.filter((t) => t.nivel === "uf");
    // ADR-0045: o cargo 1 ganha o exterior (`ZZ`) — 28 UFs; os demais, 27.
    const nUfs = cargo === 1 ? 28 : 27;
    expect(ufTargets).toHaveLength(nUfs);
    expect(ufTargets.some((t) => t.uf === "ZZ")).toBe(cargo === 1);
    expect(ufTargets.every((t) => t.cargo === cargo)).toBe(true);
    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(cargo === 1 ? 1 : 0);
    expect(targets).toHaveLength(pares.length + nUfs + (cargo === 1 ? 1 : 0));
  });

  it("cargo 6 (Deputado Federal) com TSE_DEPUTADO_GRANULARIDADE=uf volta a enumerar 27 UFs, sem tocar o banco", async () => {
    // Interruptor de emergência específico do cargo 6 (2026-09-13) — o caminho
    // que era o PADRÃO antes desta tarefa, agora só acessível via opt-in.
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");

    const targets = await listIngestTargets("production", { cargo: 6 });

    expect(targets).toHaveLength(27);
    expect(targets.every((t) => t.nivel === "uf" && t.cargo === 6)).toBe(true);
    // Granularidade UF não lê `zonas` — se ler, o ciclo fatiado paga uma
    // consulta ao Postgres por nada.
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
    // E não há arquivo agregado `br-` para este cargo (só Presidente tem).
    expect(targets.some((t) => t.uf === "BR")).toBe(false);
  });

  it("cargo 5 saiu de UF para zona — a regressão de granularidade seria silenciosa", async () => {
    // Se alguém devolver o cargo 5 INTEIRO para `uf` (perdendo a zona), a
    // tela continua renderizando e o modelo continua rodando, mas `p_eleito`
    // volta a degenerar para 0%/100% porque o bootstrap fica com uma única
    // unidade de reamostragem por estado. Este teste protege que a zona
    // continua a granularidade efetiva do cargo 5.
    //
    // ⚠️ Antes do RF-199 (spec 021), este teste também afirmava "nenhum
    // alvo de nível uf" — isso deixou de ser verdade de propósito: produção
    // agora SOMA o agregado de UF aos de zona (não troca um pelo outro).
    // Um cargo em zona sem NENHUM alvo uf seria a regressão oposta: o
    // agregado que RF-199 pediu nunca chegaria a ser pedido ao TSE.
    mockZonasRowsOnce([{ uf: "SP", codMunicipioTse: 71072, codZona: 1 }]);

    const targets = await listIngestTargets("production", { cargo: 5 });

    expect(targets.some((t) => t.nivel === "zona")).toBe(true);
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(27);
  });

  it("cargo 6 saiu de UF para zona em 2026-09-13 — a regressão de granularidade seria silenciosa", async () => {
    // Mesmo raciocínio do teste do cargo 5, aplicado ao cargo 6: sem
    // TSE_DEPUTADO_GRANULARIDADE setada, o padrão da tabela é quem decide, e
    // desde 2026-09-13 esse padrão é "zona" — não "uf". E, desde o RF-199
    // (spec 021), o agregado de UF soma-se por cima — ver o comentário do
    // teste do cargo 5, acima, para o porquê da mudança de expectativa.
    mockZonasRowsOnce([{ uf: "SP", codMunicipioTse: 71072, codZona: 1 }]);

    const targets = await listIngestTargets("production", { cargo: 6 });

    expect(targets.some((t) => t.nivel === "zona")).toBe(true);
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(27);
  });
});

describe("listIngestTargets — pares (2 municípios na mesma zona)", () => {
  const PARES_MESMA_ZONA = [
    { uf: "SP", codMunicipioTse: 71072, codZona: 1 },
    { uf: "SP", codMunicipioTse: 12345, codZona: 1 },
  ] as const;

  beforeEach(() => {
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
  });

  it("2 pares da mesma zona × 1 cargo ativo → 2 targets com URLs distintas (por mun5)", async () => {
    vi.stubEnv("TSE_CARGOS", "1");
    mockZonasRowsOnce([...PARES_MESMA_ZONA]);

    const targets = await listIngestTargets("production");

    // RF-199 (spec 021): +28 UF (27 + exterior, ADR-0045) + 1 BR (cargo 1)
    // somados aos 2 de zona.
    expect(targets).toHaveLength(2 + 28 + 1);
    const zonaTargets = targets.filter((t) => t.nivel === "zona");
    expect(zonaTargets.every((t) => t.codZona === 1 && t.cargo === 1)).toBe(true);
    expect(zonaTargets).toHaveLength(2);
    expect(new Set(zonaTargets.map((t) => t.url)).size).toBe(2);
    expect(zonaTargets.map((t) => t.codMunicipioTse).sort()).toEqual([12345, 71072]);
    expect(zonaTargets.find((t) => t.codMunicipioTse === 71072)?.url).toContain("sp71072-");
    expect(zonaTargets.find((t) => t.codMunicipioTse === 12345)?.url).toContain("sp12345-");
  });

  it("opts.cargo restringe a um único cargo mesmo com TSE_CARGOS=1,3 (2 pares → 2 targets de zona, não 4)", async () => {
    vi.stubEnv("TSE_CARGOS", "1,3");
    mockZonasRowsOnce([...PARES_MESMA_ZONA]);

    const targets = await listIngestTargets("production", { cargo: 3 });

    // RF-199 (spec 021): +27 UF somados (cargo 3 não tem BR).
    expect(targets).toHaveLength(2 + 27);
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(2);
    expect(targets.every((t) => t.cargo === 3)).toBe(true);
  });

  it("opts.cargo pedido fora de TSE_CARGOS → lista vazia (sem fallback silencioso)", async () => {
    vi.stubEnv("TSE_CARGOS", "3");
    mockZonasRowsOnce([...PARES_MESMA_ZONA]);

    const targets = await listIngestTargets("production", { cargo: 1 });

    expect(targets).toHaveLength(0);
  });

  it("cache diferencia por cargo — opts.cargo=1 e opts.cargo=3 não reaproveitam a mesma entrada", async () => {
    vi.stubEnv("TSE_CARGOS", "1,3");
    mockZonasRowsOnce([...PARES_MESMA_ZONA]);
    await listIngestTargets("production", { cargo: 1 });
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);

    mockZonasRowsOnce([...PARES_MESMA_ZONA]);
    await listIngestTargets("production", { cargo: 3 });
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2);
  });
});

describe("listIngestTargets — granularidade zona (opt-in) — cache não cruza bases", () => {
  it("reaproveita cache no mesmo baseUrl, refaz query quando baseUrl muda", async () => {
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1");
    vi.stubEnv("TSE_BASE_URL", "https://mock-a.test/oficial");

    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);

    // Mesmo ambiente (mesma chave de cache) — não deve rodar query de novo.
    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);

    // baseUrl mudou — cache não pode ser reaproveitado (bug que motivou esta task).
    vi.stubEnv("TSE_BASE_URL", "https://mock-b.test/oficial");
    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2);
  });

  it("codEleicao diferente também invalida o cache", async () => {
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1");
    vi.stubEnv("TSE_BASE_URL", "https://mock-a.test/oficial");

    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);

    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/620");
    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2);
  });

  it("granularidade diferente também invalida o cache (uf vs zona)", async () => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1");
    vi.stubEnv("TSE_BASE_URL", "https://mock-a.test/oficial");

    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    const ufTargets = await listIngestTargets("preview");
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();

    vi.stubEnv("TSE_GRANULARIDADE", "zona");
    await listIngestTargets("preview");
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
    expect(ufTargets.every((t) => t.nivel === "uf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sliceTargets — fatiamento determinístico (cargo 6, ADR-0026 emenda 2026-09-13)
// ---------------------------------------------------------------------------

/** Gera `n` targets sintéticos com identidade (uf, codMunicipioTse, codZona)
 *  distinta — `codMunicipioTse` é único por item, então nenhum outro campo
 *  precisa variar pra garantir chaves canônicas distintas. */
function buildTargetsSinteticos(n: number): Target[] {
  const UFS = ["SP", "RJ", "MG", "BA", "RS", "PR"] as const;
  const targets: Target[] = [];
  for (let i = 0; i < n; i++) {
    targets.push({
      uf: UFS[i % UFS.length] as string,
      cargo: 6,
      nivel: "zona",
      codMunicipioTse: 10000 + i,
      codZona: (i % 40) + 1,
      url: `https://x.test/target-${i}.json`,
      codEleicao: "ele2026/619",
    });
  }
  return targets;
}

function chaveDoTarget(t: Target): string {
  return `${t.uf}|${t.codMunicipioTse}|${t.codZona}`;
}

describe("sliceTargets", () => {
  const TOTAL = 6110; // o número real de pares (uf, município, zona) — não decorativo.
  const NUM_FATIAS = 6;

  it("cobertura exata: a união das 6 fatias é EXATAMENTE o conjunto original, sem sobra", () => {
    const targets = buildTargetsSinteticos(TOTAL);
    const chavesOriginais = new Set(targets.map(chaveDoTarget));

    const uniao = new Set<string>();
    for (let fatia = 1; fatia <= NUM_FATIAS; fatia++) {
      for (const t of sliceTargets(targets, fatia, NUM_FATIAS)) {
        uniao.add(chaveDoTarget(t));
      }
    }

    expect(uniao.size).toBe(chavesOriginais.size);
    expect(uniao).toEqual(chavesOriginais);
  });

  it("disjunção par a par: nenhum target aparece em mais de uma fatia", () => {
    const targets = buildTargetsSinteticos(TOTAL);
    const fatiaPorChave = new Map<string, number>();

    for (let fatia = 1; fatia <= NUM_FATIAS; fatia++) {
      for (const t of sliceTargets(targets, fatia, NUM_FATIAS)) {
        const chave = chaveDoTarget(t);
        expect(
          fatiaPorChave.has(chave),
          `${chave} já apareceu na fatia ${fatiaPorChave.get(chave)}`,
        ).toBe(false);
        fatiaPorChave.set(chave, fatia);
      }
    }

    // Soma dos tamanhos == total — disjunção + cobertura juntas provam partição exata.
    expect(fatiaPorChave.size).toBe(TOTAL);
  });

  it("tamanhos batem com 6.110 / 6 = 1.018,33 → 2 fatias de 1.019 + 4 fatias de 1.018", () => {
    const targets = buildTargetsSinteticos(TOTAL);
    const tamanhos = Array.from(
      { length: NUM_FATIAS },
      (_, i) => sliceTargets(targets, i + 1, NUM_FATIAS).length,
    );

    expect(tamanhos.reduce((a, b) => a + b, 0)).toBe(TOTAL);
    expect(tamanhos.filter((n) => n === 1019)).toHaveLength(2);
    expect(tamanhos.filter((n) => n === 1018)).toHaveLength(4);
  });

  it("estabilidade: embaralhar a ordem de entrada NÃO muda a fatia de nenhum target", () => {
    const targets = buildTargetsSinteticos(1000);
    // Embaralho determinístico (Fisher-Yates com seed fixo) — não precisa ser
    // aleatório de verdade, só precisar ser uma ordem DIFERENTE da original.
    const embaralhados = [...targets];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = embaralhados.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = embaralhados[i];
      embaralhados[i] = embaralhados[j] as Target;
      embaralhados[j] = tmp as Target;
    }
    expect(embaralhados.map(chaveDoTarget).join(",")).not.toBe(
      targets.map(chaveDoTarget).join(","),
    );

    for (let fatia = 1; fatia <= NUM_FATIAS; fatia++) {
      const original = new Set(sliceTargets(targets, fatia, NUM_FATIAS).map(chaveDoTarget));
      const embaralhado = new Set(sliceTargets(embaralhados, fatia, NUM_FATIAS).map(chaveDoTarget));
      expect(embaralhado).toEqual(original);
    }
  });

  it("lança para fatia fora de 1..numFatias, em vez de degradar pra fatia 1", () => {
    const targets = buildTargetsSinteticos(10);
    expect(() => sliceTargets(targets, 0, 6)).toThrow();
    expect(() => sliceTargets(targets, 7, 6)).toThrow();
    expect(() => sliceTargets(targets, -1, 6)).toThrow();
    expect(() => sliceTargets(targets, 1.5, 6)).toThrow();
  });

  it("lança para numFatias inválido", () => {
    const targets = buildTargetsSinteticos(10);
    expect(() => sliceTargets(targets, 1, 0)).toThrow();
    expect(() => sliceTargets(targets, 1, -1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// listIngestTargets — opts.fatia (cargo 6 fatiado, ADR-0026 emenda 2026-09-13)
// ---------------------------------------------------------------------------

describe("listIngestTargets — opts.fatia", () => {
  beforeEach(() => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
  });

  function paresSinteticos(
    n: number,
  ): Array<{ uf: string; codMunicipioTse: number; codZona: number }> {
    const UFS = ["SP", "RJ", "MG", "BA", "RS", "PR"];
    return Array.from({ length: n }, (_, i) => ({
      uf: UFS[i % UFS.length] as string,
      codMunicipioTse: 20000 + i,
      codZona: (i % 40) + 1,
    }));
  }

  it("as 6 fatias combinadas cobrem todos os pares, sem sobra nem repetição", async () => {
    const pares = paresSinteticos(120);

    const uniao = new Set<string>();
    let ufVistas = 0;
    for (let fatia = 1; fatia <= 6; fatia++) {
      mockZonasRowsOnce(pares);
      const targets = await listIngestTargets("production", {
        cargo: 6,
        fatia: { indice: fatia, total: 6 },
      });
      for (const t of targets) {
        const chave = `${t.uf}|${t.codMunicipioTse}|${t.codZona}`;
        expect(uniao.has(chave), `par ${chave} apareceu em mais de uma fatia`).toBe(false);
        uniao.add(chave);
        if (t.nivel === "uf") ufVistas++;
      }
    }

    // RF-199 (spec 021): as 27 UFs agregadas entram no MESMO pool que é
    // fatiado — `sliceTargets` reparte cada UF em exatamente uma das 6
    // fatias (mesma garantia de cobertura/disjunção que já vale para zona),
    // então a varredura completa também as pede exatamente uma vez cada,
    // sem repetir o agregado 6× por rodada.
    expect(uniao.size).toBe(pares.length + 27);
    expect(ufVistas).toBe(27);
  });

  it("fatia entra na chave do cache — fatia 1 e fatia 2 não reaproveitam a mesma entrada", async () => {
    const pares = paresSinteticos(12);
    mockZonasRowsOnce(pares);
    const fatia1 = await listIngestTargets("production", {
      cargo: 6,
      fatia: { indice: 1, total: 6 },
    });
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);

    mockZonasRowsOnce(pares);
    const fatia2 = await listIngestTargets("production", {
      cargo: 6,
      fatia: { indice: 2, total: 6 },
    });
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(2);

    // Sem a fatia na chave do cache, fatia2 devolveria os MESMOS alvos que
    // fatia1 (cache hit espúrio) — este assert falharia nesse cenário.
    const chaves1 = new Set(fatia1.map((t) => `${t.uf}|${t.codMunicipioTse}|${t.codZona}`));
    const chaves2 = new Set(fatia2.map((t) => `${t.uf}|${t.codMunicipioTse}|${t.codZona}`));
    expect(chaves1).not.toEqual(chaves2);
  });

  it("cargo em UF (interruptor TSE_DEPUTADO_GRANULARIDADE=uf) ignora fatia — devolve o agregado completo sempre", async () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");

    const fatia1 = await listIngestTargets("production", {
      cargo: 6,
      fatia: { indice: 1, total: 6 },
    });
    const fatia2 = await listIngestTargets("production", {
      cargo: 6,
      fatia: { indice: 2, total: 6 },
    });

    expect(fatia1).toHaveLength(27);
    expect(fatia2).toHaveLength(27);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("sem opts.fatia, cargo 6 em zona devolve a lista INTEIRA de zona (comportamento inalterado) + o agregado de UF (RF-199)", async () => {
    const pares = paresSinteticos(12);
    mockZonasRowsOnce(pares);

    const targets = await listIngestTargets("production", { cargo: 6 });

    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(pares.length);
    // RF-199 (spec 021): sem fatia, nada é particionado — o agregado de UF
    // sai inteiro (27), como qualquer cargo não-fatiado.
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(27);
    expect(targets).toHaveLength(pares.length + 27);
  });
});

// ---------------------------------------------------------------------------
// listIngestTargets — RF-199 (spec 021): agregado UF/BR somado, aditivo,
// só em produção, sem depender de TSE_GRANULARIDADE
// ---------------------------------------------------------------------------

describe("listIngestTargets — RF-199: agregado UF/BR aditivo em produção", () => {
  beforeEach(() => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
    // Nenhuma das variáveis de granularidade é setada aqui de propósito — o
    // ponto do bloco é o caminho DEFAULT (nenhum opt-in, nenhuma escotilha
    // de diagnóstico), que é o que roda em produção real.
  });

  it("TSE_GRANULARIDADE ausente: cada cargo continua em zona, e só o agregado é a novidade", async () => {
    vi.stubEnv("TSE_GRANULARIDADE", "");
    vi.stubEnv("TSE_CARGOS", "1");
    mockZonasRowsOnce([{ uf: "SP", codMunicipioTse: 71072, codZona: 1 }]);

    const targets = await listIngestTargets("production");

    // A granularidade efetiva de zona não muda — continua "zona" (default
    // da tabela canônica). O único fato novo é a soma do agregado.
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(1);
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(28); // + exterior (ADR-0045)
    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(1);
  });

  it("preview NÃO ganha o agregado — RF-199 é escopo de produção (spec 021 § RF-199)", async () => {
    vi.stubEnv("TSE_TARGETS_WHITELIST", "SP:1");

    const targets = await listIngestTargets("preview");

    expect(targets.every((t) => t.nivel === "zona")).toBe(true);
    expect(targets.some((t) => t.nivel === "uf" || t.nivel === "br")).toBe(false);
  });

  it("TSE_GRANULARIDADE=uf (opt-in de diagnóstico) NÃO duplica o agregado — o branch uf já É o agregado", async () => {
    // Regressão distinta da anterior: se a soma fosse aplicada sem checar a
    // granularidade efetiva, um cargo já resolvido em "uf" ganharia 27 UFs
    // do branch original + mais 27 da soma = 54, silenciosamente.
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    vi.stubEnv("TSE_CARGOS", "1");

    const targets = await listIngestTargets("production");

    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(28); // + exterior (ADR-0045)
    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(1);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("cargo 3/5/6 nunca ganham BR — só Presidente tem arquivo agregado nacional", async () => {
    vi.stubEnv("TSE_CARGOS", "3");
    mockZonasRowsOnce([{ uf: "SP", codMunicipioTse: 71072, codZona: 1 }]);

    const targets = await listIngestTargets("production");

    expect(targets.filter((t) => t.nivel === "br")).toHaveLength(0);
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(27);
  });
});

// ---------------------------------------------------------------------------
// ADR-0045 — o exterior (`ZZ`) entra SÓ no cargo 1
// ---------------------------------------------------------------------------

describe("listIngestTargets — ADR-0045: exterior (ZZ) só no Presidente", () => {
  // A tabela `zonas` não depende de cargo: depois da carga do exterior ela tem
  // os pares ZZ ao lado dos das 27 UFs. Quem impede que Governador/Senador/
  // Deputado peçam `zz…-c0003-…` (arquivo que o TSE não publica — 404 em massa,
  // bloqueio de IP) é `ufsDoCargo`. Este bloco prova o filtro nos dois níveis.
  const PARES_COM_EXTERIOR = [
    { uf: "SP", codMunicipioTse: 71072, codZona: 1 },
    { uf: "ZZ", codMunicipioTse: 29254, codZona: 1 },
    { uf: "ZZ", codMunicipioTse: 99198, codZona: 1 },
  ];

  beforeEach(() => {
    vi.stubEnv("TSE_COD_ELEICAO", "ele2026/619");
  });

  it("cargo 1 recebe `zz-c0001` (UF) e os pares ZZ de zona, com a URL da pasta `zz`", async () => {
    mockZonasRowsOnce([...PARES_COM_EXTERIOR]);
    const targets = await listIngestTargets("production", { cargo: 1 });

    const zz = targets.filter((t) => t.uf === "ZZ");
    expect(zz.filter((t) => t.nivel === "uf")).toHaveLength(1);
    expect(zz.filter((t) => t.nivel === "zona").map((t) => t.codMunicipioTse)).toEqual([
      29254, 99198,
    ]);
    const ufZz = zz.find((t) => t.nivel === "uf");
    expect(ufZz?.url).toMatch(/\/dados\/zz\/zz-c0001-e\d+-u\.json$/);
    const parZz = zz.find((t) => t.codMunicipioTse === 29254);
    expect(parZz?.url).toMatch(/\/dados\/zz\/zz29254-z0001-c0001-e\d+-u\.json$/);
    // 3 pares de zona + 28 UFs (27 + ZZ) + 1 BR.
    expect(targets).toHaveLength(3 + 28 + 1);
  });

  it.each([
    3, 5, 6,
  ] as const)("cargo %i NUNCA recebe ZZ — nem UF nem par de zona", async (cargo) => {
    mockZonasRowsOnce([...PARES_COM_EXTERIOR]);
    const targets = await listIngestTargets("production", { cargo });

    expect(targets.some((t) => t.uf === "ZZ")).toBe(false);
    expect(targets.some((t) => t.url.includes("/zz/"))).toBe(false);
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(1);
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(27);
  });

  it.each([7, 8] as const)("cargo %i (granularidade uf) NUNCA recebe ZZ", async (cargo) => {
    const targets = await listIngestTargets("production", { cargo });
    expect(targets.some((t) => t.uf === "ZZ")).toBe(false);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("whitelist de preview: `ZZ:1` vale, `ZZ:3` é descartado", async () => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "ZZ:1,ZZ:3");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pres = await listIngestTargets("preview", { cargo: 1 });
      expect(pres.map((t) => t.uf)).toEqual(["ZZ"]);
      clearTargetsCache();
      const gov = await listIngestTargets("preview", { cargo: 3 });
      expect(gov.some((t) => t.uf === "ZZ")).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
