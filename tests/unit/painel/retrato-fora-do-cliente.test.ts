/**
 * tests/unit/painel/retrato-fora-do-cliente.test.ts
 *
 * Trava do ADR-0077: **nenhum arquivo `"use client"` alcança o módulo de
 * leitura do retrato (`lib/painel/ler.ts`) nem um JSON de retrato** — nem
 * direto, nem por um módulo intermediário.
 *
 * ## Por que existe
 *
 * O retrato do painel privado é o registro operacional da noite. Ele vive no
 * Vercel Blob PRIVADO e a página fica atrás de senha. Mas tudo que um
 * componente de cliente importa vira um chunk em `/_next/static/...` — e
 * esses arquivos são servidos a QUALQUER UM, sem passar pelo `proxy.ts`. Um
 * `import { lerRetrato } from "@/lib/painel/ler"` num `"use client"` (ou um
 * `import retrato from "build/painel/retrato-1t-2026.json"`) poria o código de
 * leitura, ou os dados, num arquivo público. A senha continuaria pedida na
 * página e não protegeria nada.
 *
 * ## Como
 *
 * Varre `app/`, `components/` e `lib/` atrás dos arquivos cuja primeira
 * instrução é `"use client"` e percorre o grafo de imports de cada um
 * (`@/…` e caminhos relativos; pacotes de `node_modules` ficam de fora — o
 * retrato não mora lá). Reprova se algum caminho chegar a `lib/painel/ler.ts`
 * ou a um `.json` com "retrato" no nome.
 *
 * `import type` é ignorado: some na compilação e não leva nada ao navegador.
 *
 * A função de varredura é exercitada também sobre um grafo SINTÉTICO (o caso
 * "intermediário"), para provar que ela acha o que procura — uma varredura que
 * nunca acha nada passaria sempre (memória do projeto: "teste que não
 * discrimina").
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const PASTAS = ["app", "components", "lib"];
const PROIBIDO_LER = "lib/painel/ler.ts";

/** Arquivo é PROIBIDO no cliente? */
function proibido(caminhoRelativo: string): boolean {
  return caminhoRelativo === PROIBIDO_LER || /retrato[^/]*\.json$/i.test(caminhoRelativo);
}

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosFonte(p, acc);
    else if (/\.(tsx?|jsx?|mjs)$/.test(nome)) acc.push(p);
  }
  return acc;
}

/** `true` quando a primeira instrução do arquivo é a diretiva `"use client"`. */
function ehCliente(fonte: string): boolean {
  const semComentario = fonte.replace(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^\s*["']use client["']/.test(semComentario);
}

/** Especificadores importados em tempo de execução (sem `import type`). */
function importsDe(fonte: string): string[] {
  const out: string[] = [];
  const re =
    /(?:^|[\s;])(?:import|export)\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of fonte.matchAll(re)) {
    const esp = m[1] ?? m[2] ?? m[3];
    if (esp) out.push(esp);
  }
  return out;
}

/** Resolve `@/x` e `./x` para um arquivo do repositório; `null` para pacote. */
function resolver(espec: string, deArquivo: string): string | null {
  let base: string;
  if (espec.startsWith("@/")) base = resolve(RAIZ, espec.slice(2));
  else if (espec.startsWith(".")) base = resolve(dirname(deArquivo), espec);
  else return null;
  const candidatos = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * A partir de `inicio`, percorre o grafo e devolve o primeiro caminho até um
 * arquivo proibido (lista de arquivos relativos), ou `null`.
 */
function caminhoAteProibido(
  inicio: string,
  ler: (arquivo: string) => string,
  resolve_: (espec: string, de: string) => string | null,
  rel: (arquivo: string) => string,
): string[] | null {
  const visitados = new Set<string>();
  const fila: { arquivo: string; trilha: string[] }[] = [
    { arquivo: inicio, trilha: [rel(inicio)] },
  ];
  while (fila.length > 0) {
    const { arquivo, trilha } = fila.shift() as { arquivo: string; trilha: string[] };
    if (visitados.has(arquivo)) continue;
    visitados.add(arquivo);
    if (proibido(rel(arquivo))) return trilha;
    if (!/\.(tsx?|jsx?|mjs)$/.test(arquivo)) continue;
    for (const esp of importsDe(ler(arquivo))) {
      const alvo = resolve_(esp, arquivo);
      if (alvo && !visitados.has(alvo))
        fila.push({ arquivo: alvo, trilha: [...trilha, rel(alvo)] });
    }
  }
  return null;
}

const relDaRaiz = (a: string) => relative(RAIZ, a).split("\\").join("/");

describe("retrato do painel nunca alcança um componente de cliente", () => {
  const todos = PASTAS.flatMap((p) => arquivosFonte(join(RAIZ, p)));
  const clientes = todos.filter((a) => ehCliente(readFileSync(a, "utf8")));

  it("acha os arquivos que importam (guarda contra varrer o nada)", () => {
    expect(clientes.length).toBeGreaterThan(10);
    expect(clientes.map(relDaRaiz)).toContain("components/painel/GraficoPorMinuto.tsx");
    expect(existsSync(join(RAIZ, PROIBIDO_LER))).toBe(true);
    // e o servidor de fato usa o módulo — senão a trava protegeria um fantasma
    expect(importsDe(readFileSync(join(RAIZ, "app/painel/page.tsx"), "utf8"))).toContain(
      "@/lib/painel/ler",
    );
  });

  it('nenhum `"use client"` chega a lib/painel/ler.ts nem a um JSON de retrato', () => {
    const infracoes: string[] = [];
    for (const c of clientes) {
      const trilha = caminhoAteProibido(c, (a) => readFileSync(a, "utf8"), resolver, relDaRaiz);
      if (trilha) infracoes.push(trilha.join(" → "));
    }
    expect(
      infracoes,
      `Leitura do retrato alcançada por componente de cliente:\n${infracoes.join("\n")}`,
    ).toEqual([]);
  });

  it("a página do painel NÃO é cliente (é ela quem lê o retrato)", () => {
    expect(ehCliente(readFileSync(join(RAIZ, "app/painel/page.tsx"), "utf8"))).toBe(false);
  });
});

describe("a varredura acha o que procura (grafo sintético)", () => {
  const arquivos: Record<string, string> = {
    "/r/components/X.tsx": `"use client";\nimport { meio } from "@/lib/meio";\n`,
    "/r/lib/meio.ts": `export { lerRetrato } from "./painel/ler";\n`,
    "/r/lib/painel/ler.ts": `export async function lerRetrato() {}\n`,
    "/r/components/Y.tsx": `"use client";\nimport type { RetratoPainel } from "@/lib/painel/ler";\n`,
    "/r/components/Z.tsx": `"use client";\nimport dados from "../build/painel/retrato-1t-2026.json";\n`,
    "/r/build/painel/retrato-1t-2026.json": "{}",
  };
  const rel = (a: string) => a.replace("/r/", "");
  const res = (esp: string, de: string): string | null => {
    const base = esp.startsWith("@/")
      ? `/r/${esp.slice(2)}`
      : join(dirname(de), esp).split("\\").join("/");
    for (const c of [base, `${base}.ts`, `${base}.tsx`]) if (c in arquivos) return c;
    return null;
  };
  const ler = (a: string) => arquivos[a] ?? "";

  it("reprova o import INDIRETO (cliente → módulo intermediário → ler.ts)", () => {
    expect(caminhoAteProibido("/r/components/X.tsx", ler, res, rel)).toEqual([
      "components/X.tsx",
      "lib/meio.ts",
      "lib/painel/ler.ts",
    ]);
  });

  it("reprova o JSON do retrato importado direto", () => {
    expect(caminhoAteProibido("/r/components/Z.tsx", ler, res, rel)).not.toBeNull();
  });

  it("aceita `import type` (some na compilação)", () => {
    expect(caminhoAteProibido("/r/components/Y.tsx", ler, res, rel)).toBeNull();
  });

  it("reconhece a diretiva mesmo depois de comentário", () => {
    expect(ehCliente(`/** doc */\n// linha\n"use client";\n`)).toBe(true);
    expect(ehCliente(`import x from "y";\n"use client";\n`)).toBe(false);
  });
});
