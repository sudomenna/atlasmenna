/**
 * tests/unit/scripts/dev-fixture-sem-credencial.test.ts
 *
 * 🔴 `pnpm dev:sim` (e os irmãos `dev:pre`, `dev:sim-velho`) sobem `next dev`,
 * e o Next carrega o `.env.local` sozinho — cujas chaves de ESCRITA são as de
 * PRODUÇÃO (`DATABASE_URL` primeiro). O modo simulado só lê fixtures
 * (`lib/dev/simulacao.ts`), mas o servidor de pé com as credenciais carregadas
 * já publicou resultado inventado no site público uma vez (14/09: `pnpm dev`
 * na 3000 + a suíte chamando `post_edge_write`). Em 29/09 um agente subiu o
 * `dev:sim` pelo `.claude/launch.json` (`salacofre-dev-sim`) com as mesmas
 * chaves no processo.
 *
 * O conserto é o do `start:e2e`: declarar VAZIAS, no próprio script, as chaves
 * de escrita. O `@next/env` não sobrescreve variável que já existe no ambiente
 * — e `""` existe (ele só preenche o que é `undefined`). Este teste trava a
 * lista: as MESMAS chaves que o `start:e2e` raspa, nos três scripts.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** As chaves de escrita — banco, Blob, Global Config, segredos de rota e deploy hook. */
const CHAVES_DE_ESCRITA = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NO_SSL",
  "PGPASSWORD",
  "POSTGRES_PASSWORD",
  "BLOB_READ_WRITE_TOKEN",
  "EDGE_CONFIG_TOKEN",
  "CRON_SECRET",
  "MODEL_SECRET",
  "VERCEL_DEPLOY_HOOK_URL",
  "EDGE_CONFIG_ID",
] as const;

/** `KEY=""` declarados ANTES do comando (o trecho de ambiente do script). */
function raspadas(script: string, comando: string): Set<string> {
  const i = script.indexOf(comando);
  expect(i, `"${comando}" não está no script`).toBeGreaterThan(0);
  return new Set([...script.slice(0, i).matchAll(/\b([A-Z_]+)=""/g)].map((m) => m[1] as string));
}

describe("scripts de dev com fixture — nenhuma chave de escrita do .env.local", () => {
  it("o `start:e2e` raspa exatamente as chaves de escrita (a referência)", () => {
    const e2e = raspadas(pkg.scripts["start:e2e"] ?? "", " tsx ");
    expect([...e2e].sort()).toEqual([...CHAVES_DE_ESCRITA].sort());
  });

  for (const nome of ["dev:sim", "dev:pre", "dev:sim-velho"]) {
    it(`🔴 \`${nome}\` raspa as MESMAS chaves que o \`start:e2e\`, antes do \`next dev\``, () => {
      const script = pkg.scripts[nome] ?? "";
      expect(script, nome).toMatch(/^FIXTURE_VARIANT=[a-z-]+ /);
      expect(script.endsWith(" next dev"), nome).toBe(true);
      const dev = raspadas(script, " next dev");
      const e2e = raspadas(pkg.scripts["start:e2e"] ?? "", " tsx ");
      for (const chave of CHAVES_DE_ESCRITA) expect(dev.has(chave), `${nome}: ${chave}`).toBe(true);
      expect([...dev].sort()).toEqual([...e2e].sort());
    });
  }

  it("o `dev:sim` NÃO raspa o que o simulado precisa ler (o read path segue com o `.env.local`)", () => {
    // Resultado, no simulado, NUNCA vem de fonte remota; identidade de
    // candidatura (`readCandidatosUf` — nome, partido, foto) sempre pode
    // (`lib/dev/simulacao.ts`, "O que é resultado, e o que não é"). As duas
    // chaves de LEITURA ficam: raspá-las tiraria a identidade real da tela que
    // o dono revisa, e nenhuma delas escreve nada.
    const dev = raspadas(pkg.scripts["dev:sim"] ?? "", " next dev");
    expect(dev.has("EDGE_CONFIG")).toBe(false);
    expect(dev.has("BLOB_PUBLIC_BASE_URL")).toBe(false);
  });

  it("o launcher do app (`salacofre-dev-sim`) chama o `dev:sim` — o mesmo script travado acima", () => {
    const launch = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), ".claude/launch.json"), "utf8"),
    ) as { configurations: Array<{ name: string; runtimeArgs?: string[] }> };
    const sim = launch.configurations.find((c) => c.name === "salacofre-dev-sim");
    expect(sim?.runtimeArgs).toEqual(["dev:sim"]);
  });
});
