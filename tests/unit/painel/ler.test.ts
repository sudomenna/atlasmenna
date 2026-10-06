/**
 * tests/unit/painel/ler.test.ts
 *
 * Leitura do retrato (`lib/painel/ler.ts`, ADR-0077, plano B): a validação de
 * forma e o `fetch` da URL secreta (`PAINEL_RETRATO_URL`), com `fetch`
 * simulado — nenhum teste vai à rede. O caminho do arquivo local
 * (`NODE_ENV=development`) é o que o `pnpm dev` usa e foi conferido no navegador.
 *
 * O que importa travar além do caminho feliz: a URL é o segredo, e ela não
 * pode aparecer no resultado (a página mostra o `motivo`) nem no log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarRetrato } from "@/lib/painel/agregar";
import { lerRetrato, validarRetrato } from "@/lib/painel/ler";

const URL_SECRETA = `https://loja.public.blob.vercel-storage.com/painel/${"ab".repeat(32)}/retrato-1t-2026.json`;
const SEGREDO = "ab".repeat(32);
const fetchSimulado = vi.fn();

const T0 = Date.parse("2026-10-04T19:30:00Z");

function retratoValido() {
  return montarRetrato({
    deMs: T0,
    ateMs: T0 + 30 * 60_000,
    turno: 1,
    ambiente: "production",
    geradoEmMs: T0,
    nomes: {
      1: "Presidente",
      3: "Governador",
      5: "Senador",
      6: "Deputado Federal",
      7: "Deputado Estadual",
      8: "Deputado Distrital",
    },
    ingest: [],
    novidades: [],
    rodadas: [],
    agregadosPresidente: [],
    ultimasVersoes: [],
    commits: [],
    gitRef: "origin/main",
    correcoesDeMs: T0,
    correcoesAteMs: T0,
  });
}

beforeEach(() => {
  fetchSimulado.mockReset();
  vi.stubGlobal("fetch", fetchSimulado);
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Nada do resultado, serializado, pode conter o segredo. */
function semSegredo(resultado: unknown): void {
  expect(JSON.stringify(resultado)).not.toContain(SEGREDO);
}

describe("validarRetrato", () => {
  it("aceita o que montarRetrato produz", () => {
    const r = retratoValido();
    expect(validarRetrato(JSON.parse(JSON.stringify(r)))).not.toBeNull();
  });

  it("recusa outra versão, lista faltando e série com tamanho diferente do eixo", () => {
    const r = retratoValido();
    expect(validarRetrato({ ...r, versao: 1 })).toBeNull();
    expect(validarRetrato({ ...r, ciclos: undefined })).toBeNull();
    const truncado = JSON.parse(JSON.stringify(r));
    truncado.porMinuto.pedidosEstimados["6"].pop();
    expect(validarRetrato(truncado)).toBeNull();
    expect(validarRetrato(null)).toBeNull();
    expect(validarRetrato("texto")).toBeNull();
  });
});

describe("lerRetrato fora de desenvolvimento — URL secreta do Blob", () => {
  it("sem PAINEL_RETRATO_URL: 'ausente', sem ir à rede, com motivo que não revela nada", async () => {
    vi.stubEnv("PAINEL_RETRATO_URL", "");
    const r = await lerRetrato();
    expect(r.status).toBe("ausente");
    expect(fetchSimulado).not.toHaveBeenCalled();
    if (r.status === "ausente") expect(r.motivo).not.toMatch(/https?:|blob|painel\//i);
  });

  it("busca a URL do ambiente com cache: 'no-store' e valida", async () => {
    vi.stubEnv("PAINEL_RETRATO_URL", URL_SECRETA);
    fetchSimulado.mockResolvedValue(new Response(JSON.stringify(retratoValido())));
    const r = await lerRetrato();
    expect(r.status).toBe("ok");
    expect(fetchSimulado).toHaveBeenCalledWith(URL_SECRETA, { cache: "no-store" });
    semSegredo({ ...r, retrato: undefined });
  });

  it("404 vira 'ausente'; outro HTTP, JSON quebrado, formato errado e erro de rede viram 'erro' — nunca exceção, nunca a URL", async () => {
    vi.stubEnv("PAINEL_RETRATO_URL", URL_SECRETA);
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    const casos: [Response | Error, string][] = [
      [new Response("x", { status: 404 }), "ausente"],
      [new Response("x", { status: 403 }), "erro"],
      [new Response("{quebrado"), "erro"],
      [new Response(JSON.stringify({ versao: 99 })), "erro"],
      [new TypeError(`fetch failed: ${URL_SECRETA}`), "erro"],
    ];
    for (const [resposta, esperado] of casos) {
      if (resposta instanceof Error) fetchSimulado.mockRejectedValueOnce(resposta);
      else fetchSimulado.mockResolvedValueOnce(resposta);
      const r = await lerRetrato();
      expect(r.status).toBe(esperado);
      semSegredo(r);
    }
    // o log também não leva a URL (nem a mensagem do erro de rede, que a contém)
    semSegredo(avisos.mock.calls);
  });
});

describe("validarRetrato — a corrida do Presidente", () => {
  const corrida = () => ({
    candidatos: [
      { id: 13, nome: "A", partido: "PT" },
      { id: 22, nome: "B", partido: "PL" },
    ],
    apuracao: {
      t: [1, 2],
      pct: [
        [40, 41],
        [60, 59],
      ],
      votos: [
        [4, 41],
        [6, 59],
      ],
      apurado: [1, 2],
    },
    projecao: {
      t: [3],
      tBoletim: [2],
      pct: [[40], [60]],
      lo: [[39], [59]],
      hi: [[41], [61]],
      pVitoria: [[0], [1]],
    },
    conferencia: { instantes: 1, difMaxPp: 0.1, horaDaDifMax: null },
    trocas: [],
  });
  it("aceita a corrida bem formada e aceita `null` (retrato sem os dados)", () => {
    const r = JSON.parse(JSON.stringify(retratoValido()));
    expect(validarRetrato({ ...r, corridaPresidente: corrida() })).not.toBeNull();
    expect(validarRetrato({ ...r, corridaPresidente: null })).not.toBeNull();
  });
  it("recusa coluna de candidato mais curta que o eixo da série (deslocaria a linha no tempo)", () => {
    const r = JSON.parse(JSON.stringify(retratoValido()));
    const c = corrida();
    c.apuracao.pct[1]?.pop();
    expect(validarRetrato({ ...r, corridaPresidente: c })).toBeNull();
    const d = corrida();
    d.projecao.hi = [[41]];
    expect(validarRetrato({ ...r, corridaPresidente: d })).toBeNull();
    const { corridaPresidente: _, ...semCampo } = r;
    expect(validarRetrato(semCampo)).toBeNull();
  });
});
