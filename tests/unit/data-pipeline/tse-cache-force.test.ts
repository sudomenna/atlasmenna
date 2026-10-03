// Regressão do cache de `build/tse-archives/` (data-pipeline/_tse-common.ts) e
// da trava de cache velho de `candidatos-import.ts` (data-pipeline/candidatos-parse.ts).
//
// Em 03/10/2026, véspera da eleição, `pnpm candidatos:import --force` leu o ZIP
// de 12/09 que estava em cache: a flag prometia re-baixar e `downloadCached` não
// tinha como ignorar o cache; `unzipTo` também pulava a extração. O resumo
// carimbava `fonte_ts` com o Last-Modified remoto de 03/10 sobre dado de 12/09 —
// só o `DT_GERACAO` declarado no CSV entregava.
//
// Tudo aqui roda num diretório temporário (`cacheDir`), nunca no cache real.

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCached, unzipTo } from "@/data-pipeline/_tse-common.ts";
import {
  avaliarFrescorCache,
  decidirFrescor,
  FOLGA_CACHE_VELHO_MS,
  geracaoParaData,
} from "@/data-pipeline/candidatos-parse.ts";

const URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip";
const ANTIGO = "A".repeat(4096); // conteúdo "de 12/09"
const NOVO = "N".repeat(8192); // conteúdo "de 03/10"

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tse-cache-force-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function fetchDevolvendo(corpo: string) {
  const f = vi.fn(async () => new Response(corpo, { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}

/** Sobras de download/extração interrompidos (`*.part-*`) no diretório. */
function sobras(): string[] {
  return readdirSync(dir).filter((f) => f.includes(".part-"));
}

describe("downloadCached — force", () => {
  it("sem force, cache válido é usado e a rede não é tocada", async () => {
    writeFileSync(join(dir, "c.zip"), ANTIGO);
    const f = fetchDevolvendo(NOVO);

    const p = await downloadCached(URL, "c.zip", { cacheDir: dir });

    expect(f).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe(ANTIGO);
  });

  it("com force, re-baixa mesmo com cache válido e substitui o arquivo", async () => {
    writeFileSync(join(dir, "c.zip"), ANTIGO);
    const f = fetchDevolvendo(NOVO);

    const p = await downloadCached(URL, "c.zip", { cacheDir: dir, force: true });

    expect(f).toHaveBeenCalledTimes(1);
    expect(p).toBe(join(dir, "c.zip"));
    expect(readFileSync(p, "utf8")).toBe(NOVO);
    expect(sobras()).toEqual([]);
  });

  it("com force e HTTP de erro, o cache antigo fica intacto", async () => {
    writeFileSync(join(dir, "c.zip"), ANTIGO);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bloqueado", { status: 403, statusText: "Forbidden" })),
    );

    await expect(downloadCached(URL, "c.zip", { cacheDir: dir, force: true })).rejects.toThrow(
      /HTTP 403/,
    );
    expect(readFileSync(join(dir, "c.zip"), "utf8")).toBe(ANTIGO);
    expect(sobras()).toEqual([]);
  });

  it("com force e corpo que quebra no meio do download, o cache antigo fica intacto", async () => {
    writeFileSync(join(dir, "c.zip"), ANTIGO);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const corpo = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode("N".repeat(2000)));
            ctrl.error(new Error("conexão caiu"));
          },
        });
        return new Response(corpo, { status: 200 });
      }),
    );

    await expect(downloadCached(URL, "c.zip", { cacheDir: dir, force: true })).rejects.toThrow(
      /conexão caiu/,
    );
    expect(readFileSync(join(dir, "c.zip"), "utf8")).toBe(ANTIGO);
    expect(sobras()).toEqual([]);
  });

  it("com force e download abaixo de minBytes (página de WAF), o cache antigo fica intacto", async () => {
    writeFileSync(join(dir, "c.zip"), ANTIGO);
    fetchDevolvendo("<html>erro</html>");

    await expect(
      downloadCached(URL, "c.zip", { cacheDir: dir, force: true, minBytes: 1024 }),
    ).rejects.toThrow(/abaixo do mínimo/);
    expect(readFileSync(join(dir, "c.zip"), "utf8")).toBe(ANTIGO);
    expect(sobras()).toEqual([]);
  });

  it("sem cache, baixa normalmente (com ou sem force)", async () => {
    fetchDevolvendo(NOVO);
    const p = await downloadCached(URL, "novo.zip", { cacheDir: dir });
    expect(readFileSync(p, "utf8")).toBe(NOVO);
  });
});

const temZip =
  spawnSync("which", ["zip"]).status === 0 && spawnSync("which", ["unzip"]).status === 0;

describe.skipIf(!temZip)("unzipTo — force", () => {
  /** Monta um ZIP com os arquivos dados (nome → conteúdo) em `zipPath`. */
  function montarZip(zipPath: string, arquivos: Record<string, string>) {
    const origem = mkdtempSync(join(dir, "origem-"));
    const caminhos = Object.entries(arquivos).map(([nome, conteudo]) => {
      const p = join(origem, nome);
      writeFileSync(p, conteudo);
      return p;
    });
    rmSync(zipPath, { force: true });
    execFileSync("zip", ["-q", "-j", zipPath, ...caminhos]);
    rmSync(origem, { recursive: true, force: true });
  }

  let cache: string;
  let zip: string;
  beforeEach(() => {
    cache = join(dir, "cache");
    mkdirSync(cache);
    zip = join(dir, "c.zip");
    montarZip(zip, { "cand_12_09.csv": "velho" });
  });

  it("sem force, pasta já extraída é reaproveitada mesmo com ZIP novo", async () => {
    await unzipTo(zip, "cand", { cacheDir: cache });
    montarZip(zip, { "cand_03_10.csv": "novo" });

    const out = await unzipTo(zip, "cand", { cacheDir: cache });

    expect(readdirSync(out)).toEqual(["cand_12_09.csv"]);
  });

  it("com force, re-extrai e o CSV velho não fica ao lado do novo", async () => {
    await unzipTo(zip, "cand", { cacheDir: cache });
    montarZip(zip, { "cand_03_10.csv": "novo" });

    const out = await unzipTo(zip, "cand", { cacheDir: cache, force: true });

    expect(out).toBe(join(cache, "cand"));
    expect(readdirSync(out)).toEqual(["cand_03_10.csv"]);
    expect(readFileSync(join(out, "cand_03_10.csv"), "utf8")).toBe("novo");
    expect(readdirSync(cache)).toEqual(["cand"]);
  });

  it("com force e ZIP corrompido, a extração anterior fica intacta", async () => {
    await unzipTo(zip, "cand", { cacheDir: cache });
    writeFileSync(zip, "isto não é um zip");

    await expect(unzipTo(zip, "cand", { cacheDir: cache, force: true })).rejects.toThrow();

    expect(readdirSync(join(cache, "cand"))).toEqual(["cand_12_09.csv"]);
    expect(readdirSync(cache)).toEqual(["cand"]);
  });

  it("com force, recusa subdir que não seja pasta direta do cache (nunca apaga o cache inteiro)", async () => {
    writeFileSync(join(cache, "backup.zip"), "backup");
    for (const sub of ["", ".", "..", "../fora", "a/b"]) {
      await expect(unzipTo(zip, sub, { cacheDir: cache, force: true })).rejects.toThrow(
        /subdir inválido/,
      );
    }
    expect(existsSync(join(cache, "backup.zip"))).toBe(true);
  });
});

describe("trava de cache velho — avaliarFrescorCache", () => {
  // Os números de 03/10: CSV lido com DT_GERACAO 12/09/2026 19:31:30 (BRT) e o
  // CDN respondendo Last-Modified de 03/10.
  const lido1209 = geracaoParaData("12/09/2026 19:31:30");
  const remoto0310 = new Date("Sat, 03 Oct 2026 10:12:00 GMT");

  it("DT_GERACAO é lido em horário de Brasília (UTC−3)", () => {
    expect(lido1209?.toISOString()).toBe("2026-09-12T22:31:30.000Z");
    expect(geracaoParaData("lixo")).toBeNull();
    expect(geracaoParaData(null)).toBeNull();
  });

  it("12/09 lido × 03/10 remoto → velho, com as duas datas", () => {
    const r = avaliarFrescorCache(lido1209, remoto0310);
    expect(r.estado).toBe("velho");
    if (r.estado !== "velho") return;
    expect(r.lido.toISOString()).toBe("2026-09-12T22:31:30.000Z");
    expect(r.remoto.toISOString()).toBe("2026-10-03T10:12:00.000Z");
    expect(r.defasagemMs).toBeGreaterThan(20 * 86_400_000);
  });

  it("mesmo arquivo (DT_GERACAO 19:31 BRT × Last-Modified 22:35 GMT do mesmo dia) → ok", () => {
    const r = avaliarFrescorCache(lido1209, new Date("Sat, 12 Sep 2026 22:35:00 GMT"));
    expect(r.estado).toBe("ok");
  });

  it("limite: exatamente 24 h → ok; 24 h + 1 s → velho", () => {
    const lido = new Date("2026-10-02T12:00:00Z");
    expect(avaliarFrescorCache(lido, new Date(lido.getTime() + FOLGA_CACHE_VELHO_MS)).estado).toBe(
      "ok",
    );
    expect(
      avaliarFrescorCache(lido, new Date(lido.getTime() + FOLGA_CACHE_VELHO_MS + 1000)).estado,
    ).toBe("velho");
  });

  it("arquivo lido MAIS NOVO que o remoto não é velho", () => {
    expect(avaliarFrescorCache(remoto0310, lido1209).estado).toBe("ok");
  });

  it("sem uma das datas → indeterminado (não trava, mas não afirma frescor)", () => {
    expect(avaliarFrescorCache(lido1209, null).estado).toBe("indeterminado");
    expect(avaliarFrescorCache(null, remoto0310).estado).toBe("indeterminado");
  });
});

describe("trava de cache velho — decidirFrescor (abortar × seguir, e o fonte_ts honesto)", () => {
  const lido = new Date("2026-09-12T22:31:30Z");
  const remoto = new Date("2026-10-03T10:12:00Z");
  const velho = avaliarFrescorCache(lido, remoto);

  it("cache velho sem --aceitar-cache-velho → aborta", () => {
    expect(decidirFrescor(velho, remoto, lido, false).abortar).toBe(true);
  });

  it("cache velho com --aceitar-cache-velho → segue, com fonte_ts = DT_GERACAO lido (nunca o remoto)", () => {
    const d = decidirFrescor(velho, remoto, lido, true);
    expect(d.abortar).toBe(false);
    expect(d.fonteTs?.toISOString()).toBe("2026-09-12T22:31:30.000Z");
    expect(d.fonteTsOrigem).toBe("DT_GERACAO do arquivo lido");
  });

  it("arquivo fresco → segue com o Last-Modified remoto, como sempre", () => {
    const lidoHoje = new Date("2026-10-03T09:50:00Z");
    const d = decidirFrescor(avaliarFrescorCache(lidoHoje, remoto), remoto, lidoHoje, false);
    expect(d).toEqual({ abortar: false, fonteTs: remoto, fonteTsOrigem: "Last-Modified remoto" });
  });

  it("CDN sem Last-Modified → segue com DT_GERACAO", () => {
    const d = decidirFrescor(avaliarFrescorCache(lido, null), null, lido, false);
    expect(d).toEqual({
      abortar: false,
      fonteTs: lido,
      fonteTsOrigem: "DT_GERACAO do arquivo lido",
    });
  });
});
