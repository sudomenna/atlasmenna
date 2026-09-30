/**
 * tests/unit/scripts/interruptor-projecao.test.ts
 *
 * `pnpm dep:projecao` — o operador do interruptor da projeção de Deputado
 * (spec 026 RF-265, ADR-0063 D4, design § 2.10). HTTP mockado: nada aqui fala
 * com a Vercel.
 *
 * O risco que o script existe para cortar é o STORE ERRADO: até a véspera, o
 * `.env.local` aponta para o store de ENSAIO, e um "desligar" gravado lá às
 * 21h de 04/10 deixaria a produção ligada com cara de desligada. Por isso:
 *
 *   - 🔴 recusa o store de ensaio (por id E por nome) sem `--ensaio`;
 *   - 🔴 com `--ensaio`, recusa qualquer outro;
 *   - 🔴 não grava sem a confirmação DIGITADA do id do alvo;
 *   - o alvo é o store do `EDGE_CONFIG` (o que o site LÊ), nunca o
 *     `EDGE_CONFIG_ID` (que desvia só a escrita do modelo);
 *   - do `.env.local` só entram três variáveis — nunca o `DATABASE_URL`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ArgsInterruptor,
  carregarEnvDoInterruptor,
  classificarStore,
  type Dependencias,
  ENV_DO_INTERRUPTOR,
  executar,
  interpretarArgs,
  montarValor,
  STORES_CONHECIDOS,
} from "@/scripts/interruptor-projecao";

const PRODUCAO = "ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl";
const ENSAIO = "ecfg_fdlfvusqgth3gc8eaxloahrvrsgh";
const AGORA = new Date("2026-10-03T18:00:00.000Z");

interface Chamada {
  metodo: string;
  caminho: string;
  corpo?: unknown;
}

/**
 * Uma API da Vercel de mentira: metadados do store, GET do item e PATCH. O
 * valor da chave vive em `estado.valor` e o PATCH o atualiza — a releitura do
 * script confere o que foi de fato gravado.
 */
function apiFalsa(opts: {
  id: string;
  slug: string;
  valor?: unknown;
  falharPatch?: boolean;
  falharMeta?: boolean;
  /** A chave que este store "tem". Default: a do federal. */
  chave?: string;
}) {
  const chave = opts.chave ?? "interruptor-projecao-dep";
  const estado: { valor: unknown } = { valor: opts.valor };
  const chamadas: Chamada[] = [];
  const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ metodo, caminho: u.pathname, corpo });
    if (u.pathname === `/v1/edge-config/${opts.id}` && metodo === "GET") {
      if (opts.falharMeta) return new Response("{}", { status: 500 });
      return Response.json({ id: opts.id, slug: opts.slug, sizeInBytes: 2 });
    }
    if (u.pathname === `/v1/edge-config/${opts.id}/item/${chave}`) {
      if (estado.valor === undefined) return new Response("{}", { status: 404 });
      return Response.json({ key: chave, value: estado.valor });
    }
    if (u.pathname === `/v1/edge-config/${opts.id}/items` && metodo === "PATCH") {
      if (opts.falharPatch) return new Response("boom", { status: 500 });
      estado.valor = (corpo as { items: Array<{ value: unknown }> }).items[0]?.value;
      return Response.json({ status: "ok" });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchFalso, chamadas, estado };
}

function deps(
  argv: string[],
  api: ReturnType<typeof apiFalsa>,
  env: Record<string, string | undefined> = {},
): Dependencias & { linhas: string[] } {
  const linhas: string[] = [];
  return {
    argv,
    env: {
      EDGE_CONFIG: `https://edge-config.vercel.com/${PRODUCAO}?token=leitura`,
      EDGE_CONFIG_TOKEN: "segredo-do-token",
      ...env,
    },
    fetch: api.fetchFalso as unknown as typeof fetch,
    agora: () => AGORA,
    escrever: (l) => linhas.push(l),
    linhas,
  };
}

const patches = (api: ReturnType<typeof apiFalsa>) =>
  api.chamadas.filter((c) => c.metodo === "PATCH");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("classificarStore — pelo id E pelo nome", () => {
  it("os dois stores do runbook", () => {
    expect(STORES_CONHECIDOS[PRODUCAO]?.papel).toBe("producao");
    expect(classificarStore(PRODUCAO, "salacofre-edge-config")).toBe("producao");
    expect(classificarStore(ENSAIO, "salacofre-edge-config-preview")).toBe("ensaio");
  });
  it("🔴 qualquer sinal de ensaio vence: id de produção com nome de preview é ENSAIO", () => {
    expect(classificarStore(PRODUCAO, "salacofre-edge-config-preview")).toBe("ensaio");
    expect(classificarStore("ecfg_novo", "algo-preview")).toBe("ensaio");
    expect(classificarStore(ENSAIO, null)).toBe("ensaio");
    expect(classificarStore("ecfg_novo", "salacofre-edge-config")).toBe("desconhecido");
  });
});

describe("interpretarArgs", () => {
  it("sem ação ⇒ status; ações e flags lidas", () => {
    expect(interpretarArgs([])).toMatchObject({ acao: "status", ensaio: false });
    expect(interpretarArgs(["--desligar", "--confirmar", PRODUCAO])).toMatchObject({
      acao: "desligar",
      confirmar: PRODUCAO,
    });
    expect(interpretarArgs(["--ligar", "--pct=40"])).toMatchObject({ acao: "ligar", pct: 40 });
    expect(interpretarArgs(["--pct", "30"])).toMatchObject({ acao: "ajustar", pct: 30 });
    expect(interpretarArgs(["--ensaio"])).toMatchObject({ ensaio: true });
    expect(interpretarArgs(["--store-ensaio"])).toMatchObject({ ensaio: true });
  });
  it("uso errado vira erro, nunca um palpite", () => {
    for (const argv of [
      ["--ligar", "--desligar"],
      ["--pct", "10"], // só SOBE: < 25 é recusado já no argumento
      ["--pct", "101"],
      ["--pct", "abc"],
      ["--pct", "40", "--sem-pct"],
      ["--desligar", "--pct", "40"],
      ["--confirmar"], // sem o id
      ["--confirmar", "sim"],
      ["--apagar"],
      ["--cargo"], // sem o nome
      ["--cargo", "municipal"],
      ["--cargo", "6"], // pelo NOME, não pelo código
    ]) {
      expect(interpretarArgs(argv), argv.join(" ")).toHaveProperty("erro");
    }
  });
});

describe("montarValor", () => {
  const base: ArgsInterruptor = { acao: "status", cargo: 6, semPct: false, ensaio: false };
  const agora = AGORA.toISOString();
  it("ligar/desligar gravam a decisão, com auditoria", () => {
    const ausente = { ligada: false, pct_minimo: 25, origem: "ausente" as const };
    expect(montarValor(ausente, { ...base, acao: "ligar" }, agora)).toEqual({
      ligada: true,
      em: agora,
      por: "pnpm dep:projecao",
    });
    expect(montarValor(ausente, { ...base, acao: "desligar", por: "dono" }, agora)).toEqual({
      ligada: false,
      em: agora,
      por: "dono",
    });
  });
  it("uma trava SUBIDA é preservada por ligar/desligar; `--sem-pct` a remove", () => {
    const subida = { ligada: true, pct_minimo: 40, origem: "chave" as const };
    expect(montarValor(subida, { ...base, acao: "desligar" }, agora)).toMatchObject({
      ligada: false,
      pct_minimo: 40,
    });
    expect(montarValor(subida, { ...base, acao: "ligar", semPct: true }, agora)).not.toHaveProperty(
      "pct_minimo",
    );
  });
  it("`--pct` sozinho mantém o `ligada` em vigor — e RECUSA quando ele não é confiável", () => {
    expect(
      montarValor(
        { ligada: true, pct_minimo: 25, origem: "chave" },
        { ...base, acao: "ajustar", pct: 50 },
        agora,
      ),
    ).toMatchObject({ ligada: true, pct_minimo: 50 });
    expect(
      montarValor(
        { ligada: false, pct_minimo: 25, origem: "falha" },
        { ...base, acao: "ajustar", pct: 50 },
        agora,
      ),
    ).toHaveProperty("erro");
  });
});

describe("executar — o store certo, ou nada", () => {
  it("status: mostra o store e o estado, e não grava", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    const d = deps([], api);
    expect(await executar(d)).toBe(0);
    expect(d.linhas.join("\n")).toContain(PRODUCAO);
    expect(d.linhas.join("\n")).toMatch(/PRODUÇÃO/);
    expect(d.linhas.join("\n")).toMatch(/AUSENTE ⇒ desligada/);
    expect(patches(api)).toHaveLength(0);
  });

  it("🔴 store de ENSAIO sem `--ensaio` ⇒ recusa (3), sem nem ler a chave", async () => {
    const api = apiFalsa({ id: ENSAIO, slug: "salacofre-edge-config-preview" });
    const d = deps(["--desligar", "--confirmar", ENSAIO], api, {
      EDGE_CONFIG: `https://edge-config.vercel.com/${ENSAIO}?token=x`,
    });
    expect(await executar(d)).toBe(3);
    expect(patches(api)).toHaveLength(0);
    expect(api.chamadas.some((c) => c.caminho.includes("/item/"))).toBe(false);
    expect(d.linhas.join("\n")).toMatch(/RECUSADO/);
  });

  it("🔴 `--ensaio` com o store de PRODUÇÃO ⇒ recusa (3)", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    expect(await executar(deps(["--ensaio", "--desligar", "--confirmar", PRODUCAO], api))).toBe(3);
    expect(patches(api)).toHaveLength(0);
  });

  it("`--ensaio` com o store de ensaio ⇒ grava lá (o ensaio de 03/10)", async () => {
    const api = apiFalsa({
      id: ENSAIO,
      slug: "salacofre-edge-config-preview",
      valor: { ligada: true },
    });
    const d = deps(["--ensaio", "--desligar", "--confirmar", ENSAIO], api, {
      EDGE_CONFIG: `https://edge-config.vercel.com/${ENSAIO}?token=x`,
    });
    expect(await executar(d)).toBe(0);
    expect(patches(api)).toHaveLength(1);
    expect(api.estado.valor).toMatchObject({ ligada: false });
  });

  it("🔴 sem `--confirmar <id>` ⇒ só mostra o valor e o comando exato; não grava", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    const d = deps(["--ligar"], api);
    expect(await executar(d)).toBe(0);
    expect(patches(api)).toHaveLength(0);
    expect(d.linhas.at(-1)).toContain(`--confirmar ${PRODUCAO}`);
  });

  it("🔴 id digitado diferente do alvo ⇒ recusa (3), não grava", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    expect(await executar(deps(["--ligar", "--confirmar", ENSAIO], api))).toBe(3);
    expect(patches(api)).toHaveLength(0);
  });

  it("ligar com confirmação ⇒ PATCH da chave certa, no store do EDGE_CONFIG, e releitura confere", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    const d = deps(["--ligar", "--por", "dono", "--confirmar", PRODUCAO], api, {
      // O `EDGE_CONFIG_ID` desvia a ESCRITA do modelo durante o simulado — o
      // interruptor tem de ir para o store que o site LÊ, e ignorá-lo.
      EDGE_CONFIG_ID: ENSAIO,
    });
    expect(await executar(d)).toBe(0);
    const [patch] = patches(api);
    expect(patch?.caminho).toBe(`/v1/edge-config/${PRODUCAO}/items`);
    expect(patch?.corpo).toEqual({
      items: [
        {
          operation: "upsert",
          key: "interruptor-projecao-dep",
          value: { ligada: true, em: AGORA.toISOString(), por: "dono" },
        },
      ],
    });
    expect(d.linhas.join("\n")).toMatch(
      /Gravado e conferido em interruptor-projecao-dep \(ecfg_\w+\): LIGADA/,
    );
    // O token nunca é impresso.
    expect(d.linhas.join("\n")).not.toContain("segredo-do-token");
  });

  it("falha do PATCH ⇒ 1, e nada de 'gravado'", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config", falharPatch: true });
    const d = deps(["--desligar", "--confirmar", PRODUCAO], api);
    expect(await executar(d)).toBe(1);
    expect(d.linhas.join("\n")).not.toMatch(/Gravado/);
  });

  it("sem conseguir ler o store ⇒ 1, sem gravar (o nome é a segunda trava)", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "x", falharMeta: true });
    expect(await executar(deps(["--desligar", "--confirmar", PRODUCAO], api))).toBe(1);
    expect(patches(api)).toHaveLength(0);
  });

  it("sem credencial ⇒ 2", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    expect(await executar(deps([], api, { EDGE_CONFIG_TOKEN: undefined }))).toBe(2);
    expect(await executar(deps([], api, { EDGE_CONFIG: undefined }))).toBe(2);
  });

  it("estado lido com `pct_minimo` abaixo do piso: mostra que foi IGNORADO", async () => {
    const api = apiFalsa({
      id: PRODUCAO,
      slug: "salacofre-edge-config",
      valor: { ligada: true, pct_minimo: 10, em: "2026-10-03T17:00:00Z", por: "dono" },
    });
    const d = deps([], api);
    expect(await executar(d)).toBe(0);
    const texto = d.linhas.join("\n");
    expect(texto).toMatch(/LIGADA/);
    expect(texto).toMatch(/IGNORADO/);
    expect(texto).toContain("por dono");
  });
});

describe("ambiente — lista BRANCA", () => {
  it("🔴 do `.env.local` entram só EDGE_CONFIG, EDGE_CONFIG_TOKEN e VERCEL_TEAM_ID", () => {
    expect([...ENV_DO_INTERRUPTOR]).toEqual(["EDGE_CONFIG", "EDGE_CONFIG_TOKEN", "VERCEL_TEAM_ID"]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-projecao-env-"));
    fs.writeFileSync(
      path.join(dir, ".env.local"),
      [
        'DATABASE_URL="postgres://producao"',
        'EDGE_CONFIG="https://edge-config.vercel.com/ecfg_x?token=a=="',
        "EDGE_CONFIG_TOKEN=tok",
        "EDGE_CONFIG_ID=ecfg_ensaio",
        "BLOB_READ_WRITE_TOKEN=blob",
      ].join("\n"),
    );
    const antes = { ...process.env };
    for (const k of [
      "DATABASE_URL",
      "EDGE_CONFIG",
      "EDGE_CONFIG_TOKEN",
      "EDGE_CONFIG_ID",
      "BLOB_READ_WRITE_TOKEN",
    ]) {
      delete process.env[k];
    }
    try {
      carregarEnvDoInterruptor(dir);
      expect(process.env.DATABASE_URL).toBeUndefined();
      expect(process.env.EDGE_CONFIG_ID).toBeUndefined();
      expect(process.env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
      expect(process.env.EDGE_CONFIG).toBe("https://edge-config.vercel.com/ecfg_x?token=a==");
      expect(process.env.EDGE_CONFIG_TOKEN).toBe("tok");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
      Object.assign(process.env, antes);
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 027 RF-287 — `--cargo estadual`: o interruptor das ASSEMBLEIAS
// ---------------------------------------------------------------------------

describe("--cargo — qual interruptor (spec 027 RF-287)", () => {
  it("sem --cargo é o federal (6); estadual e distrital são a MESMA chave", () => {
    expect(interpretarArgs([])).toMatchObject({ cargo: 6 });
    expect(interpretarArgs(["--cargo", "federal"])).toMatchObject({ cargo: 6 });
    expect(interpretarArgs(["--cargo", "estadual"])).toMatchObject({ cargo: 7 });
    expect(interpretarArgs(["--cargo=Distrital"])).toMatchObject({ cargo: 8 });
  });

  it("🔴 --cargo estadual lê e grava `interruptor-projecao-est` — e NUNCA toca a do federal", async () => {
    const api = apiFalsa({
      id: PRODUCAO,
      slug: "salacofre-edge-config",
      chave: "interruptor-projecao-est",
    });
    const d = deps(
      ["--cargo", "estadual", "--ligar", "--por", "dono", "--confirmar", PRODUCAO],
      api,
    );
    expect(await executar(d)).toBe(0);

    const [patch] = patches(api);
    expect(patch?.corpo).toEqual({
      items: [
        {
          operation: "upsert",
          key: "interruptor-projecao-est",
          value: { ligada: true, em: AGORA.toISOString(), por: "dono" },
        },
      ],
    });
    // Asserção NEGATIVA: nenhuma chamada — leitura ou escrita — na chave federal.
    expect(api.chamadas.some((c) => c.caminho.includes("interruptor-projecao-dep"))).toBe(false);
    expect(JSON.stringify(api.chamadas)).not.toContain("interruptor-projecao-dep");
  });

  it("a saída diz o NOME da chave e o store antes de qualquer confirmação", async () => {
    const api = apiFalsa({
      id: PRODUCAO,
      slug: "salacofre-edge-config",
      chave: "interruptor-projecao-est",
    });
    const d = deps(["--cargo", "distrital", "--desligar"], api);
    expect(await executar(d)).toBe(0);
    expect(patches(api)).toHaveLength(0);
    const texto = d.linhas.join("\n");
    expect(texto).toContain(`Store alvo: ${PRODUCAO}`);
    expect(texto).toContain("Chave: interruptor-projecao-est");
    expect(texto).toMatch(/ASSEMBLEIAS/);
    // O comando exato para gravar menciona a chave e o store.
    expect(d.linhas.at(-1)).toContain("interruptor-projecao-est");
    expect(d.linhas.at(-1)).toContain(`--confirmar ${PRODUCAO}`);
  });

  it("o federal continua dizendo a SUA chave (a outra metade da mesma trava)", async () => {
    const api = apiFalsa({ id: PRODUCAO, slug: "salacofre-edge-config" });
    const d = deps([], api);
    expect(await executar(d)).toBe(0);
    expect(d.linhas.join("\n")).toContain("Chave: interruptor-projecao-dep");
    expect(d.linhas.join("\n")).not.toContain("interruptor-projecao-est");
  });

  it("a trava do store de ensaio vale igual para a chave das assembleias", async () => {
    const api = apiFalsa({
      id: ENSAIO,
      slug: "salacofre-edge-config-preview",
      chave: "interruptor-projecao-est",
    });
    const d = deps(["--cargo", "estadual", "--desligar", "--confirmar", ENSAIO], api, {
      EDGE_CONFIG: `https://edge-config.vercel.com/${ENSAIO}?token=leitura`,
    });
    expect(await executar(d)).toBe(3);
    expect(patches(api)).toHaveLength(0);
  });
});
