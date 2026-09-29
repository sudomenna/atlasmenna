// Cliente do Senado — `data-pipeline/senado-fonte.ts`.
//
// Nenhum teste toca a rede: `fetchImpl`, o relógio e o `dormir` são injetados.
// O cache aponta para um diretório temporário que morre com o teste.

import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  criarClienteSenado,
  ErroSenado,
  esperaEntreTentativasMs,
  SENADO_USER_AGENT,
  urlDoPedido,
} from "@/data-pipeline/senado-fonte.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "senado-fonte-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Resposta {
  status: number;
  corpo?: string;
  headers?: Record<string, string>;
  erro?: Error;
}

/** `fetch` que devolve as respostas da fila, em ordem, e registra cada chamada. */
function fetchFalso(fila: Resposta[]) {
  const chamadas: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const r = fila.shift();
    if (!r) throw new Error("fila de respostas esgotada");
    if (r.erro) throw r.erro;
    return new Response(r.corpo ?? "", { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

/** Relógio falso: `dormir` avança o tempo, e as esperas ficam registradas. */
function relogioFalso() {
  let agora = 1_000_000;
  const esperas: number[] = [];
  return {
    agoraMs: () => agora,
    dormir: async (ms: number) => {
      esperas.push(ms);
      agora += ms;
    },
    esperas,
  };
}

const pedido = { caminho: "senador/lista/atual.json", chave: "lista_atual_2026-09-29" };

function cliente(fila: Resposta[], extra: Parameters<typeof criarClienteSenado>[0] = {}) {
  const f = fetchFalso(fila);
  const r = relogioFalso();
  const c = criarClienteSenado({
    cacheDir: dir,
    fetchImpl: f.impl,
    dormir: r.dormir,
    agoraMs: r.agoraMs,
    sorteio: () => 0,
    ...extra,
  });
  return { c, f, r };
}

describe("urlDoPedido", () => {
  it("junta a base, o caminho e a query", () => {
    expect(
      urlDoPedido({
        caminho: "votacao",
        consulta: { dataInicio: "2025-01-01", dataFim: "2025-06-30" },
        chave: "x",
      }),
    ).toBe(
      "https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2025-01-01&dataFim=2025-06-30",
    );
    expect(urlDoPedido({ caminho: "senador/5322.json", chave: "x" })).toBe(
      "https://legis.senado.leg.br/dadosabertos/senador/5322.json",
    );
  });
});

describe("esperaEntreTentativasMs", () => {
  // MUTAÇÃO ALVO: ignorar o retry-after (o servidor pede 15 s; menos que isso é insistir).
  it("respeita o retry-after, com piso de 15 s e teto de 30 s, mais jitter de até 5 s", () => {
    expect(esperaEntreTentativasMs("15", 0)).toBe(15_000);
    expect(esperaEntreTentativasMs("15", 1)).toBe(20_000);
    expect(esperaEntreTentativasMs("22", 0)).toBe(22_000);
    expect(esperaEntreTentativasMs("3", 0)).toBe(15_000);
    expect(esperaEntreTentativasMs("600", 0)).toBe(30_000);
  });

  it("sem retry-after numérico vale 15 s", () => {
    expect(esperaEntreTentativasMs(null, 0)).toBe(15_000);
    expect(esperaEntreTentativasMs("Wed, 21 Oct 2026 07:28:00 GMT", 0)).toBe(15_000);
  });
});

describe("criarClienteSenado — sucesso e cache", () => {
  it("baixa, devolve o JSON, manda o User-Agent identificável e grava o texto CRU no cache", async () => {
    const corpo = '{"a":  1}';
    const { c, f } = cliente([{ status: 200, corpo }]);
    expect(await c.obter(pedido)).toEqual({ a: 1 });
    expect(f.chamadas[0]?.headers["User-Agent"]).toBe(SENADO_USER_AGENT);
    expect(f.chamadas[0]?.headers.Accept).toBe("application/json");
    // Cru: nem reserializado, nem reformatado.
    expect(await readFile(join(dir, `${pedido.chave}.json`), "utf8")).toBe(corpo);
  });

  it("a segunda leitura sai do cache: nenhuma chamada nova", async () => {
    const { c, f } = cliente([{ status: 200, corpo: "[1]" }]);
    await c.obter(pedido);
    expect(await c.obter(pedido)).toEqual([1]);
    expect(f.chamadas).toHaveLength(1);
    expect(c.estatisticas()).toMatchObject({ chamadasDeRede: 1, acertosDeCache: 1 });
  });

  it("`atualizar` ignora o cache na leitura e regrava", async () => {
    await writeFile(join(dir, `${pedido.chave}.json`), '"velho"');
    const { c, f } = cliente([{ status: 200, corpo: '"novo"' }], { atualizar: true });
    expect(await c.obter(pedido)).toBe("novo");
    expect(f.chamadas).toHaveLength(1);
    expect(await readFile(join(dir, `${pedido.chave}.json`), "utf8")).toBe('"novo"');
  });

  it("cache truncado (JSON quebrado) é tratado como ausente e refeito", async () => {
    await writeFile(join(dir, `${pedido.chave}.json`), '{"a":');
    const { c, f } = cliente([{ status: 200, corpo: '{"a":1}' }]);
    expect(await c.obter(pedido)).toEqual({ a: 1 });
    expect(f.chamadas).toHaveLength(1);
  });

  it("escrita atômica: não sobra arquivo temporário", async () => {
    const { c } = cliente([{ status: 200, corpo: "{}" }]);
    await c.obter(pedido);
    expect(readdirSync(dir)).toEqual([`${pedido.chave}.json`]);
  });

  it("chave que sai do diretório de cache é recusada antes de qualquer chamada", async () => {
    const { c, f } = cliente([]);
    for (const chave of ["../fora", "a/b", "", ".oculto", "a..b"]) {
      await expect(c.obter({ caminho: "x", chave })).rejects.toThrow(/chave de cache inválida/);
    }
    expect(f.chamadas).toHaveLength(0);
  });
});

describe("criarClienteSenado — 503, retry e espaçamento", () => {
  // MUTAÇÃO ALVO: não repetir no 503 (lançaria na primeira falha).
  it("503 com retry-after: espera 15 s e tenta de novo até dar certo", async () => {
    const { c, f, r } = cliente([
      { status: 503, headers: { "retry-after": "15" }, corpo: '{"status":503}' },
      { status: 503, headers: { "retry-after": "15" } },
      { status: 200, corpo: '{"ok":true}' },
    ]);
    expect(await c.obter(pedido)).toEqual({ ok: true });
    expect(f.chamadas).toHaveLength(3);
    expect(r.esperas.filter((ms) => ms >= 15_000)).toEqual([15_000, 15_000]);
    expect(c.estatisticas()).toMatchObject({
      tentativasFalhas: 2,
      porStatus: { "503": 2, "200": 1 },
    });
  });

  it("uma resposta de erro nunca vai para o cache", async () => {
    const { c } = cliente([{ status: 503 }, { status: 200, corpo: "[]" }]);
    await c.obter(pedido);
    expect(await readFile(join(dir, `${pedido.chave}.json`), "utf8")).toBe("[]");
  });

  it("esgota as tentativas e lança com o último status", async () => {
    const { c, f } = cliente(
      Array.from({ length: 3 }, () => ({ status: 503, headers: { "retry-after": "15" } })),
      { tentativasMax: 3 },
    );
    const erro = (await c.obter(pedido).catch((e: unknown) => e)) as ErroSenado;
    expect(erro).toBeInstanceOf(ErroSenado);
    expect(erro.status).toBe(503);
    expect(f.chamadas).toHaveLength(3);
    expect(existsSync(join(dir, `${pedido.chave}.json`))).toBe(false);
  });

  it("falha de rede (timeout, queda) é transitória", async () => {
    const { c, f } = cliente([
      { status: 0, erro: new Error("The operation was aborted due to timeout") },
      { status: 200, corpo: "[7]" },
    ]);
    expect(await c.obter(pedido)).toEqual([7]);
    expect(f.chamadas).toHaveLength(2);
    expect(c.estatisticas().porStatus).toMatchObject({ "erro-de-rede": 1 });
  });

  it("200 com corpo que não é JSON é transitório e não é gravado", async () => {
    const { c } = cliente([
      { status: 200, corpo: "<html>manutenção</html>" },
      { status: 200, corpo: '{"ok":1}' },
    ]);
    expect(await c.obter(pedido)).toEqual({ ok: 1 });
    expect(c.estatisticas().porStatus).toMatchObject({ "json-invalido": 1 });
  });

  // MUTAÇÃO ALVO: tratar 404 como transitório (insistiria 8 vezes num endereço que não existe).
  it("404 é definitivo: lança na hora, sem repetir", async () => {
    const { c, f } = cliente([{ status: 404 }]);
    const erro = (await c.obter(pedido).catch((e: unknown) => e)) as ErroSenado;
    expect(erro).toBeInstanceOf(ErroSenado);
    expect(erro.status).toBe(404);
    expect(f.chamadas).toHaveLength(1);
  });

  // MUTAÇÃO ALVO: tirar o espaçamento (duas chamadas seguidas sem folga).
  it("espaça as chamadas em pelo menos 0,6 s", async () => {
    const { c, r } = cliente([
      { status: 200, corpo: "1" },
      { status: 200, corpo: "2" },
      { status: 200, corpo: "3" },
    ]);
    const inicio = r.agoraMs();
    await c.obter({ caminho: "a", chave: "a" });
    await c.obter({ caminho: "b", chave: "b" });
    await c.obter({ caminho: "c", chave: "c" });
    // A 1ª chamada sai na hora; a 2ª e a 3ª esperam o intervalo inteiro (o relógio só anda no `dormir`).
    expect(r.esperas).toEqual([600, 600]);
    expect(r.agoraMs() - inicio).toBe(1200);
  });
});
