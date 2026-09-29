/**
 * tests/unit/scripts/edge-config-falso.test.ts
 *
 * O servidor falso de Global Config dos portões e2e (2026-09-26). O que
 * importa provar é o que tornaria o portão MENTIROSO se quebrasse:
 *
 *   - chave desconhecida vira 404, nunca um payload default;
 *   - o 404 de chave carrega o digest (o SDK lê como "ausente", não "falha");
 *   - ele recusa subir apontado para qualquer host que não seja 127.0.0.1;
 *   - a Medição A tira os blocos novos da RESPOSTA sem tocar o resto;
 *   - (29/09) o `start:e2e` recusa um `.next` que não saiu do `build:e2e` — sem
 *     isso, o portão mediu por dias a casca "Esta página ainda não recebeu
 *     dados" das rotas que leem o Global Config.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { blobUrlFor, deputadoUfBlobPathname, deputadoUfListaBlobPathname } from "@/lib/blob/paths";
import {
  currentProjectionKey,
  interruptorProjecaoDepKey,
  ufProjectionKey,
} from "@/lib/edge-config/keys";
import {
  conferirBaseDoBlob,
  conferirBuildE2e,
  gravarMarcaBuild,
  lerConexao,
  MARCA_BUILD_E2E,
  montarBlobs,
  montarChaves,
  PREFIXO_BLOB,
  responder,
  semBlocosNovosNacional,
  semBlocosNovosUf,
} from "@/scripts/edge-config-falso";

const ID = "ecfg_e2efalso";
const AUTH = "Bearer e2e";

describe("montarChaves — fixtures do simulado", () => {
  const chaves = montarChaves();

  it("serve exatamente 4 nacionais + 27 UFs × 3 cargos, e nada de turno 2 ou alias", () => {
    expect(chaves.size).toBe(4 + 27 * 3);
    for (const cargo of ["pres", "gov", "sen", "dep"] as const) {
      expect(chaves.has(currentProjectionKey(cargo, 1))).toBe(true);
      expect(chaves.has(currentProjectionKey(cargo, 2))).toBe(false);
    }
    expect(chaves.has("projection-current")).toBe(false);
    expect(chaves.has("projection-uf-SP")).toBe(false);
    // Deputado por UF mora no Blob, não numa chave.
    expect(
      [...chaves.keys()].some((k) => k.startsWith("projection-uf-") && k.endsWith("-dep-t1")),
    ).toBe(false);
  });

  it("o valor de cada chave de UF é o payload daquela UF", () => {
    const sp = chaves.get(ufProjectionKey("SP", "gov", 1)) as { uf?: string; cargo?: number };
    expect(sp.uf).toBe("SP");
    expect(sp.cargo).toBe(3);
  });

  it("Medição A: tira corrida/corrida_por_partido/destino_pendente e o votacao das UFs", () => {
    const a = montarChaves({ semBlocosNovos: true });
    const pres = a.get(currentProjectionKey("pres", 1)) as { votacao: Record<string, unknown> };
    const gov = a.get(currentProjectionKey("gov", 1)) as { votacao: Record<string, unknown> };
    expect(pres.votacao.corrida).toBeUndefined();
    expect(gov.votacao.corrida_por_partido).toBeUndefined();
    // O arco da spec 021 fica.
    expect(pres.votacao.contagens).toBeDefined();
    const ufSp = a.get(ufProjectionKey("SP", "pres", 1)) as Record<string, unknown>;
    expect(ufSp.votacao).toBeUndefined();
    expect(ufSp.candidatos).toBeDefined();
    // O modo completo continua com os blocos — a retirada é só na resposta A.
    const completo = chaves.get(currentProjectionKey("pres", 1)) as {
      votacao: Record<string, unknown>;
    };
    expect(completo.votacao.corrida).toBeDefined();
  });

  it("as funções de retirada não mutam a entrada", () => {
    const nac = { votacao: { contagens: 1, corrida: [1], destino_pendente: true } };
    expect(semBlocosNovosNacional(nac)).toEqual({ votacao: { contagens: 1 } });
    expect(nac.votacao.corrida).toEqual([1]);
    const uf = { uf: "SP", votacao: {} };
    expect(semBlocosNovosUf(uf)).toEqual({ uf: "SP" });
    expect(uf.votacao).toEqual({});
  });
});

describe("responder — contrato HTTP do SDK", () => {
  const chaves = new Map<string, unknown>([["projection-current-pres-t1", { cargo: 1 }]]);

  it("chave conhecida → 200 com o valor", () => {
    const r = responder(
      chaves,
      ID,
      "GET",
      `/${ID}/item/projection-current-pres-t1?version=1`,
      AUTH,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.corpo)).toEqual({ cargo: 1 });
  });

  it("chave desconhecida → 404 com digest, e corpo sem payload", () => {
    const r = responder(
      chaves,
      ID,
      "GET",
      `/${ID}/item/projection-current-pres-t2?version=1`,
      AUTH,
    );
    expect(r.status).toBe(404);
    expect(r.headers["x-edge-config-digest"]).toBeTruthy();
    expect(JSON.parse(r.corpo)).toEqual({ error: "not_found", key: "projection-current-pres-t2" });
  });

  it("id errado ou rota desconhecida → 404 SEM digest", () => {
    const r = responder(chaves, ID, "GET", "/ecfg_outro/item/projection-current-pres-t1", AUTH);
    expect(r.status).toBe(404);
    expect(r.headers["x-edge-config-digest"]).toBeUndefined();
  });

  it("sem Authorization → 401", () => {
    expect(
      responder(chaves, ID, "GET", `/${ID}/item/projection-current-pres-t1`, undefined).status,
    ).toBe(401);
  });
});

describe("lerConexao — só 127.0.0.1", () => {
  it("lê porta e id da connection string local", () => {
    expect(lerConexao(`http://127.0.0.1:3101/${ID}?token=e2e`)).toEqual({ porta: 3101, id: ID });
  });

  it("recusa produção, localhost por nome e ausência", () => {
    expect(() => lerConexao("https://edge-config.vercel.com/ecfg_abc?token=x")).toThrow(
      /127\.0\.0\.1/,
    );
    expect(() => lerConexao(`http://localhost:3101/${ID}?token=e2e`)).toThrow(/127\.0\.0\.1/);
    expect(() => lerConexao(undefined)).toThrow(/ausente/);
    expect(() => lerConexao("http://127.0.0.1:3101/sem-id?token=e2e")).toThrow(/ecfg_/);
  });
});

describe("build:e2e — a marca que o start:e2e exige (29/09)", () => {
  function distTemporario(buildId?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-marca-"));
    if (buildId) fs.writeFileSync(path.join(dir, "BUILD_ID"), buildId);
    return dir;
  }

  it("🔴 .next de um `pnpm build` comum (sem marca) ⇒ recusa, e diz por quê", () => {
    const r = conferirBuildE2e(distTemporario("abc123"));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.motivo).toMatch(/build:e2e/);
    expect(r.ok ? "" : r.motivo).toMatch(/ainda não recebeu dados/);
  });

  it("sem build nenhum ⇒ recusa", () => {
    expect(conferirBuildE2e(distTemporario()).ok).toBe(false);
  });

  it("marca gravada pelo build:e2e ⇒ aceita, e a marca não leva o token", () => {
    const dir = distTemporario("abc123");
    const marca = gravarMarcaBuild(dir, "http://127.0.0.1:3101/ecfg_e2efalso?token=segredo");
    expect(marca.build_id).toBe("abc123");
    expect(fs.readFileSync(path.join(dir, MARCA_BUILD_E2E), "utf8")).not.toContain("segredo");
    const r = conferirBuildE2e(dir);
    expect(r.ok).toBe(true);
  });

  it("🔴 `pnpm build` depois do build:e2e (BUILD_ID trocou) ⇒ recusa", () => {
    const dir = distTemporario("abc123");
    gravarMarcaBuild(dir, "http://127.0.0.1:3101/ecfg_e2efalso?token=e2e");
    fs.writeFileSync(path.join(dir, "BUILD_ID"), "outro999");
    const r = conferirBuildE2e(dir);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.motivo).toContain("outro999");
  });

  it("build:e2e e start:e2e raspam as MESMAS variáveis e apontam para o MESMO falso", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const build = pkg.scripts["build:e2e"] ?? "";
    const start = pkg.scripts["start:e2e"] ?? "";
    const ambiente = (cmd: string) => cmd.slice(0, cmd.indexOf(" tsx "));
    // A ÚNICA diferença: o build recolhe os dados das rotas de ingestão, e o
    // `neon()` lança com URL vazia — então ele leva um banco MORTO (porta 9 de
    // 127.0.0.1, sem ninguém escutando), nunca o do `.env.local`.
    const BANCO_MORTO = 'DATABASE_URL="postgresql://ninguem:nada@127.0.0.1:9/inexistente"';
    expect(ambiente(build)).toContain(BANCO_MORTO);
    expect(ambiente(build).replace(BANCO_MORTO, 'DATABASE_URL=""')).toBe(ambiente(start));
    // O mínimo que nunca pode faltar: as chaves de escrita.
    for (const v of ["BLOB_READ_WRITE_TOKEN", "EDGE_CONFIG_TOKEN", "CRON_SECRET", "POSTGRES_URL"]) {
      expect(ambiente(build)).toContain(`${v}=""`);
    }
    expect(ambiente(start)).toContain('DATABASE_URL=""');
    expect(ambiente(build)).toContain('EDGE_CONFIG="http://127.0.0.1:3101/');
    expect(build).toContain("--marcar-build -- next build");
    expect(start).toContain("--exigir-build-e2e -- next start -p 3100");
  });
});

// ---------------------------------------------------------------------------
// Spec 026 — o Blob de Deputado e o interruptor (2026-09-29)
// ---------------------------------------------------------------------------

describe("montarBlobs — o CDN do Blob, a partir das fixtures", () => {
  const blobs = montarBlobs();

  it("serve o detalhe de Deputado das 27 UFs, no caminho que o leitor monta", () => {
    for (const sigla of ["SP", "RR", "DF"]) {
      const d = blobs.get(deputadoUfBlobPathname(sigla)) as { uf?: string; agremiacoes?: unknown };
      expect(d?.uf).toBe(sigla);
      expect(Array.isArray(d?.agremiacoes)).toBe(true);
    }
    expect(
      [...blobs.keys()].filter((k) => k.startsWith("deputado/uf/") && k.endsWith(".json")),
    ).toHaveLength(27);
  });

  it("a lista 61+ só é servida quando a fixture existe — nunca inventada", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falso-blob-"));
    fs.writeFileSync(path.join(dir, "deputado-uf.json"), JSON.stringify({ SP: { uf: "SP" } }));
    expect([...montarBlobs({ dir }).keys()]).toEqual([deputadoUfBlobPathname("SP")]);

    fs.writeFileSync(
      path.join(dir, "deputado-uf-lista.json"),
      JSON.stringify({ SP: { uf: "SP", agremiacoes: [] } }),
    );
    const comLista = montarBlobs({ dir });
    expect(comLista.get(deputadoUfListaBlobPathname("SP"))).toEqual({ uf: "SP", agremiacoes: [] });
  });
});

describe("responder — o Blob é público e vem antes do 401", () => {
  const chaves = new Map<string, unknown>();
  const blobs = new Map<string, unknown>([[deputadoUfBlobPathname("SP"), { uf: "SP" }]]);

  it("objeto conhecido → 200, SEM exigir Authorization (o CDN real não exige)", () => {
    const r = responder(chaves, ID, "GET", `${PREFIXO_BLOB}deputado/uf/SP.json`, undefined, blobs);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.corpo)).toEqual({ uf: "SP" });
  });

  it("objeto desconhecido (foto, municípios) → 404, como o CDN para objeto não gravado", () => {
    for (const p of ["candidatos/foto/SP/250002553928.jpg", "municipios/uf/SP/pres/t1.json"]) {
      expect(responder(chaves, ID, "GET", `${PREFIXO_BLOB}${p}`, undefined, blobs).status).toBe(
        404,
      );
    }
  });

  it("a URL que o leitor monta com BLOB_PUBLIC_BASE_URL cai exatamente neste prefixo", () => {
    const antes = process.env.BLOB_PUBLIC_BASE_URL;
    process.env.BLOB_PUBLIC_BASE_URL = "http://127.0.0.1:3101/blob";
    try {
      const url = new URL(blobUrlFor(deputadoUfBlobPathname("SP")) as string);
      expect(responder(chaves, ID, "GET", url.pathname, undefined, blobs).status).toBe(200);
    } finally {
      if (antes === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
      else process.env.BLOB_PUBLIC_BASE_URL = antes;
    }
  });
});

describe("conferirBaseDoBlob — só este servidor", () => {
  it("aceita a base local na mesma porta (com ou sem barra final) e a ausência", () => {
    expect(() => conferirBaseDoBlob("http://127.0.0.1:3101/blob", 3101)).not.toThrow();
    expect(() => conferirBaseDoBlob("http://127.0.0.1:3101/blob/", 3101)).not.toThrow();
    expect(() => conferirBaseDoBlob(undefined, 3101)).not.toThrow();
  });

  it("recusa o Blob de produção, outra porta e outro prefixo", () => {
    expect(() =>
      conferirBaseDoBlob("https://jbtu251tioj3y57z.public.blob.vercel-storage.com", 3101),
    ).toThrow(/127\.0\.0\.1:3101\/blob/);
    expect(() => conferirBaseDoBlob("http://127.0.0.1:3102/blob", 3101)).toThrow();
    expect(() => conferirBaseDoBlob("http://127.0.0.1:3101/outro", 3101)).toThrow();
  });
});

describe("interruptor da projeção (ADR-0063) — só servido quando pedido", () => {
  it("sem flag e sem fixture: a chave fica AUSENTE (= desligada, a regra de produção)", () => {
    expect(montarChaves().has(interruptorProjecaoDepKey())).toBe(false);
  });

  it("--projecao-ligada / --projecao-desligada servem o valor explícito", () => {
    expect(montarChaves({ projecaoLigada: true }).get(interruptorProjecaoDepKey())).toMatchObject({
      ligada: true,
    });
    expect(montarChaves({ projecaoLigada: false }).get(interruptorProjecaoDepKey())).toMatchObject({
      ligada: false,
    });
  });

  it("build:e2e e start:e2e medem a página COM a projeção e com o Blob servido", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const nome of ["build:e2e", "start:e2e"]) {
      const cmd = pkg.scripts[nome] ?? "";
      expect(cmd, nome).toContain('BLOB_PUBLIC_BASE_URL="http://127.0.0.1:3101/blob"');
      expect(cmd, nome).toContain("--projecao-ligada");
      expect(cmd, nome).toContain('BLOB_READ_WRITE_TOKEN=""');
    }
  });
});
