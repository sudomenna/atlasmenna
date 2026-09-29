/**
 * tests/unit/data-pipeline/etiquetas-publicar.test.ts
 *
 * O publicador (spec 024, RF-230; ADR-0060, ADR-0062). Nenhum teste aqui toca
 * o Blob real: `@vercel/blob` está simulado, e a orquestração recebe
 * dependências falsas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn(async (pathname: string, _body: unknown, _opts: unknown) => ({
  url: `https://blob.exemplo.test/${pathname}`,
  pathname,
}));

vi.mock("@vercel/blob", () => ({
  put: (pathname: string, body: unknown, opts: unknown) => putMock(pathname, body, opts),
}));

const {
  lerChavesPublicacao,
  modoDaLinhaDeComando,
  projetarHistorico,
  projetarNacional,
  projetarUf,
  proximaVersao,
  publicarEtiquetas,
} = await import("@/data-pipeline/etiquetas-publicar");
const { putJson } = await import("@/lib/blob/write");

import type { DependenciasPublicacao } from "@/data-pipeline/etiquetas-publicar";
import { todasDesligadas } from "@/lib/etiquetas/catalogo";
import { isArquivoNacional, isArquivoUf, UFS } from "@/lib/etiquetas/formato";

import { compilarOk, csv, entrada, GOV_SP_PT } from "../etiquetas/_fixtures";

/**
 * Compilado com as chaves do `publicar.json` que `deps()` devolve
 * (`{ v1: true, chips: false }`): desde a spec 025 a cópia do build carrega o
 * mesmo `publicar.json`, e o publicador recusa quando os dois divergem.
 */
function gerado(publicar = { ...todasDesligadas(), v1: true }) {
  return compilarOk(
    entrada(
      {
        "governador.csv": csv({
          chave: GOV_SP_PT,
          categoria: "campo_ideologico",
          valor: "esquerda",
        }),
      },
      { publicar },
    ),
  );
}

function deps(over: Partial<DependenciasPublicacao> = {}) {
  const g = gerado();
  const escritas: Array<[string, unknown]> = [];
  const d: DependenciasPublicacao = {
    statusGit: async () => "",
    shaGit: async () => "abc123",
    atrasoDeOrigin: async () => 0,
    compilar: async () => ({
      ok: true,
      divergentes: [],
      nacional: g.nacional,
      ufs: g.ufs,
      historico: g.historico,
    }),
    lerPublicarJson: async () => ({ v1: true, chips: false }),
    versaoNoBlob: async () => null,
    escrever: async (p, v) => {
      escritas.push([p, v]);
      return "written";
    },
    agora: () => new Date("2026-09-29T15:00:00Z"),
    log: () => {},
    ...over,
  };
  return { d, escritas, g };
}

describe("RF-230 — o que o publicador recusa (sem gravar nada)", () => {
  it("🔴 árvore do git suja", async () => {
    const { d, escritas } = deps({
      statusGit: async () => " M editorial/etiquetas/governador.csv\n",
    });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("árvore do git suja");
    expect(escritas).toEqual([]);
  });

  it("HEAD atrás de origin/main", async () => {
    const { d, escritas } = deps({ atrasoDeOrigin: async () => 3 });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("3 commit(s) atrás");
    expect(escritas).toEqual([]);
  });

  it("sem referência origin/main: segue, com aviso", async () => {
    const log = vi.fn();
    const { d } = deps({ atrasoDeOrigin: async () => null, log });
    expect((await publicarEtiquetas(d, { dryRun: true })).ok).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toContain("sem referência origin/main");
  });

  it("🔴 validação falhou (o validador roda antes de subir)", async () => {
    const { d, escritas } = deps({
      compilar: async () => ({ ok: false, motivo: "validação falhou: x" }),
    });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("validação falhou");
    expect(escritas).toEqual([]);
  });

  it("gerado versionado divergente da recompilação", async () => {
    const { d, g, escritas } = deps();
    d.compilar = async () => ({
      ok: true,
      divergentes: ["nacional.generated.json"],
      nacional: g.nacional,
      ufs: g.ufs,
      historico: g.historico,
    });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("divergem");
    expect(escritas).toEqual([]);
  });

  it("🔴 publicar.json diverge da cópia do build (spec 025) ⇒ recusa", async () => {
    // O dono ligou uma visão no arquivo e não recompilou: Blob e build
    // passariam a discordar sobre o que está ligado.
    const { d, escritas } = deps({ lerPublicarJson: async () => ({ v1: true, v2: true }) });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("diverge da cópia do build nas visões v2");
    expect(escritas).toEqual([]);
  });

  it("publicar.json com visão desconhecida ou valor não booleano", async () => {
    expect(lerChavesPublicacao({ v9: true })).toMatchObject({
      erro: expect.stringContaining("v9"),
    });
    expect(lerChavesPublicacao({ v1: "sim" })).toMatchObject({
      erro: expect.stringContaining("true ou false"),
    });
    expect(lerChavesPublicacao([])).toMatchObject({ erro: expect.any(String) });
    expect(lerChavesPublicacao({ v1: true })).toEqual({ ...todasDesligadas(), v1: true });
  });

  it("versão do Blob ilegível ⇒ recusa (não dá para garantir monotonia)", async () => {
    const { d, escritas } = deps({
      versaoNoBlob: async () => {
        throw new Error("HTTP 503");
      },
    });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("HTTP 503");
    expect(escritas).toEqual([]);
  });
});

describe("RF-230 — versão, carimbo e ordem", () => {
  it("versão estritamente maior que Blob e build, nunca menor que o relógio", () => {
    const agora = new Date("2026-09-29T15:00:00Z");
    const relogio = Math.floor(agora.getTime() / 1000);
    expect(proximaVersao(agora, null, 1)).toBe(relogio);
    expect(proximaVersao(agora, relogio + 50, 1)).toBe(relogio + 51);
    expect(proximaVersao(agora, 3, relogio + 100)).toBe(relogio + 101);
  });

  it("🔴 escreve as 27 UFs e o histórico ANTES do nacional; carimba sha e versão", async () => {
    const { d, escritas, g } = deps({ versaoNoBlob: async () => 9_999_999_999 });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok).toBe(true);
    expect(escritas).toHaveLength(29);
    expect(escritas.map(([p]) => p).slice(0, 27)).toEqual(
      UFS.map((uf) => `etiquetas/v1/uf/${uf}.json`),
    );
    expect(escritas[27]?.[0]).toBe("etiquetas/v1/historico.json");
    expect(escritas[28]?.[0]).toBe("etiquetas/v1/nacional.json");
    const nac = escritas[28]?.[1];
    expect(isArquivoNacional(nac)).toBe(true);
    if (isArquivoNacional(nac)) {
      expect(nac.meta.versao).toBe(10_000_000_000);
      expect(nac.meta.git_sha).toBe("abc123");
      expect(nac.meta.conteudo_sha256).toBe(g.nacional.meta.conteudo_sha256);
      expect(nac.publicar).toEqual({ ...todasDesligadas(), v1: true });
    }
    const sp = escritas[25]?.[1];
    expect(isArquivoUf(sp, "SP") && sp.meta.versao).toBe(10_000_000_000);
  });

  it("dry-run confere tudo, não grava, e DIZ o que gravaria (29 caminhos, nacional por último)", async () => {
    const logs: string[] = [];
    const { d, escritas } = deps({ log: (m) => logs.push(m) });
    const r = await publicarEtiquetas(d, { dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, escritos: [] });
    expect(escritas).toEqual([]);
    const caminhos = logs.filter((l) => /^\s+etiquetas\/v1\//.test(l)).map((l) => l.trim());
    expect(caminhos).toHaveLength(UFS.length + 2);
    expect(caminhos.at(-1)).toBe("etiquetas/v1/nacional.json");
    expect(logs.some((l) => l.includes("gravaria"))).toBe(true);
    // Diz também quais derivados estão fora (sem aprovação do dono).
    expect(logs.some((l) => l.includes("derivados"))).toBe(true);
  });

  it("escrita pulada (sem credencial) interrompe antes do nacional", async () => {
    let n = 0;
    const { d } = deps({
      escrever: async () => {
        n++;
        return n > 3 ? "skipped" : "written";
      },
    });
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok === false && r.motivo).toContain("o nacional NÃO subiu");
    expect(n).toBe(4);
  });
});

describe("🔴 I1 — o padrão é NÃO gravar: escrever exige --confirmar", () => {
  it("sem argumento ⇒ só confere (dry-run)", () => {
    expect(modoDaLinhaDeComando([])).toEqual({ dryRun: true });
  });
  it("--dry-run continua aceito e é o mesmo que o padrão", () => {
    expect(modoDaLinhaDeComando(["--dry-run"])).toEqual({ dryRun: true });
  });
  it("--confirmar ⇒ grava", () => {
    expect(modoDaLinhaDeComando(["--confirmar"])).toEqual({ dryRun: false });
  });
  it("os dois juntos, ou argumento desconhecido, é erro — nunca adivinha", () => {
    expect(modoDaLinhaDeComando(["--confirmar", "--dry-run"])).toHaveProperty("erro");
    expect(modoDaLinhaDeComando(["--confirma"])).toHaveProperty("erro");
    expect(modoDaLinhaDeComando(["--force"])).toHaveProperty("erro");
  });
});

describe("ADR-0062 — lista branca nos arquivos públicos", () => {
  it("a data de aprovação do derivado e a medida do alinhamento passam; o resto fica", () => {
    const { g } = deps();
    const n = structuredClone(g.nacional) as unknown as Record<string, unknown>;
    (n.derivados as Record<string, unknown>).trajetoria_camara = {
      fonte_url: "https://x/",
      fonte_descricao: "X",
      data: "2026-09-26",
      revisado_em: "2026-09-28",
      por: "NOME DO REVISOR",
    };
    const cand = (n.candidatos as Record<string, Record<string, unknown>>)[GOV_SP_PT]!;
    cand.m = { votos: 40, taxa: 70.5, nome: "NÃO" };
    const pub = projetarNacional(n as never, g.nacional.meta, todasDesligadas());
    expect(pub.derivados.trajetoria_camara).toEqual({
      fonte_url: "https://x/",
      fonte_descricao: "X",
      data: "2026-09-26",
      revisado_em: "2026-09-28",
    });
    expect(pub.candidatos[GOV_SP_PT]?.m).toEqual({ votos: 40, taxa: 70.5 });
    expect(JSON.stringify(pub)).not.toContain("NOME DO REVISOR");

    const uf = structuredClone(g.ufs.SP) as unknown as Record<string, unknown>;
    uf.medidas = { "1": { votos: 30, taxa: 12.5, extra: 1 } };
    expect(projetarUf(uf as never, g.nacional.meta).medidas).toEqual({
      "1": { votos: 30, taxa: 12.5 },
    });
  });

  it("🔴 `nota` e qualquer campo fora do contrato ficam para trás", () => {
    const { g } = deps();
    const sujo = structuredClone(g.nacional) as unknown as Record<string, unknown>;
    const cand = (sujo.candidatos as Record<string, Record<string, unknown>>)[GOV_SP_PT]!;
    (
      (cand.x as Record<string, Record<string, unknown>>).campo_ideologico as Record<
        string,
        unknown
      >
    ).nota = "NOTA INTERNA";
    cand.nome_completo = "NOME CIVIL";
    sujo.extra = "lixo";
    const pub = projetarNacional(sujo as never, g.nacional.meta, todasDesligadas());
    const texto = JSON.stringify(pub);
    expect(texto).not.toContain("NOTA INTERNA");
    expect(texto).not.toContain("NOME CIVIL");
    expect(texto).not.toContain("lixo");
    expect(Object.keys(pub.candidatos[GOV_SP_PT]!.x!.campo_ideologico!).sort()).toEqual([
      "data",
      "fonte_descricao",
      "fonte_url",
      "revisado_em",
      "valor",
    ]);

    const uf = structuredClone(g.ufs.SP) as unknown as Record<string, unknown>;
    uf.cpf = "123";
    expect(JSON.stringify(projetarUf(uf as never, g.nacional.meta))).not.toContain("cpf");

    const hist = { ...g.historico, entradas: [{ ...g.historico.entradas[0], nota: "x" }] };
    expect(JSON.stringify(projetarHistorico(hist as never, g.nacional.meta))).not.toContain(
      '"nota"',
    );
  });
});

describe("escrita real (com @vercel/blob simulado)", () => {
  const salvo = process.env.BLOB_READ_WRITE_TOKEN;
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teste123_segredo456";
    putMock.mockClear();
  });
  afterEach(() => {
    if (salvo === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = salvo;
  });

  it("🔴 grava com cacheControlMaxAge 60 — corrigir em minutos depende disso", async () => {
    const { d } = deps();
    d.escrever = async (p, v) => (await putJson(p, v)).status;
    const r = await publicarEtiquetas(d, { dryRun: false });
    expect(r.ok).toBe(true);
    expect(putMock).toHaveBeenCalledTimes(29);
    for (const call of putMock.mock.calls) {
      expect(call[2]).toMatchObject({
        access: "public",
        cacheControlMaxAge: 60,
        allowOverwrite: true,
        addRandomSuffix: false,
      });
    }
    expect(putMock.mock.calls.at(-1)?.[0]).toBe("etiquetas/v1/nacional.json");
  });
});
