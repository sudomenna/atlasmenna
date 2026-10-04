/**
 * tests/unit/leitura/ler.test.ts
 *
 * Read path da leitura da noite (ADR-0072): `filtrarParaTela` (pura) decide o
 * que vai para a tela; `lerLeituraParaTela` (I/O) nunca lança e cai em
 * `LEITURA_VAZIA` em qualquer falha.
 *
 * Os limites (20 min, 5 pp, 20:00 UTC, 60 min, 2 por veículo, 8 na tela) são
 * testados NOS DOIS LADOS da fronteira: um caso só do lado "some" não
 * discrimina um limite trocado por outro maior (20 → 200 passaria num teste
 * de "IA de 3 horas some").
 *
 * Sem rede: `@vercel/edge-config` e o `fetch` global são mocados.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@vercel/edge-config", () => ({
  get: (key: string) => getMock(key),
}));

const logWarnMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logWarn: (msg: string, ctx?: unknown) => logWarnMock(msg, ctx) };
});

import {
  filtrarParaTela,
  LEITURA_VAZIA,
  lerLeituraParaTela,
  NOTICIAS_TELA_MAX,
} from "@/lib/leitura/ler";
import type { InterruptorLeitura, LeituraNoite, Manchete } from "@/lib/leitura/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 19h de Brasília do dia do 1º turno — depois do início da divulgação. */
const AGORA = new Date("2026-10-04T22:00:00Z");
const MIN = 60_000;

function iso(msAntesDeAgora: number, agora: Date = AGORA): string {
  return new Date(agora.getTime() - msAntesDeAgora).toISOString();
}

function manchete(over: Partial<Manchete> = {}): Manchete {
  return {
    titulo: "Apuração avança no país",
    link: "https://exemplo.com.br/materia-1",
    veiculo: "Veículo A",
    publicado_em: iso(10 * MIN),
    feed: "veiculo-a",
    ...over,
  };
}

function leitura(over: Partial<LeituraNoite> = {}): LeituraNoite {
  return {
    versao: 1,
    turno: 1,
    atualizado_em: iso(1 * MIN),
    estado: null,
    historico: [
      {
        id: "marco-10",
        ts: iso(30 * MIN),
        head: "Apuração",
        text: "10% das seções apuradas.",
        tipo: "marco",
      },
    ],
    noticias: { em: iso(5 * MIN), itens: [manchete()] },
    ia: {
      frases: ["A projeção indica segundo turno."],
      modelo: "provedor/modelo",
      gerado_em: iso(10 * MIN),
      base_ts: iso(12 * MIN),
      base_pct: 40,
    },
    ia_tentativa: null,
    ...over,
  };
}

const LIGADO: InterruptorLeitura = { ia: true, noticias: true, historico: true };
const DESLIGADO: InterruptorLeitura = { ia: false, noticias: false, historico: false };
const CTX = { pctApuradoTotal: 42, turno: 1 as const, agora: AGORA };

function comIA(ia: Partial<NonNullable<LeituraNoite["ia"]>>): LeituraNoite {
  const base = leitura();
  return leitura({ ia: { ...(base.ia as NonNullable<LeituraNoite["ia"]>), ...ia } });
}

// ---------------------------------------------------------------------------
// filtrarParaTela
// ---------------------------------------------------------------------------

describe("filtrarParaTela — caminho feliz e portas fechadas", () => {
  it("(a) tudo ligado e fresco → as três peças aparecem", () => {
    const l = leitura();
    const r = filtrarParaTela(l, LIGADO, CTX);
    expect(r.ia).toEqual(l.ia);
    expect(r.noticias).toEqual(l.noticias.itens);
    expect(r.historico).toEqual(l.historico);
  });

  it("(b) leitura null → LEITURA_VAZIA", () => {
    expect(filtrarParaTela(null, LIGADO, CTX)).toEqual(LEITURA_VAZIA);
  });

  it("(c) interruptor todo desligado → tudo null", () => {
    expect(filtrarParaTela(leitura(), DESLIGADO, CTX)).toEqual({
      ia: null,
      noticias: null,
      historico: null,
    });
  });

  it("(d) cada chave liga só a sua peça", () => {
    const l = leitura();
    const soIa = filtrarParaTela(l, { ...DESLIGADO, ia: true }, CTX);
    expect(soIa.ia).not.toBeNull();
    expect(soIa.noticias).toBeNull();
    expect(soIa.historico).toBeNull();

    const soNoticias = filtrarParaTela(l, { ...DESLIGADO, noticias: true }, CTX);
    expect(soNoticias.ia).toBeNull();
    expect(soNoticias.noticias).not.toBeNull();
    expect(soNoticias.historico).toBeNull();

    const soHistorico = filtrarParaTela(l, { ...DESLIGADO, historico: true }, CTX);
    expect(soHistorico.ia).toBeNull();
    expect(soHistorico.noticias).toBeNull();
    expect(soHistorico.historico).not.toBeNull();
  });

  it("(e) leitura de OUTRO turno não mostra nada", () => {
    expect(filtrarParaTela(leitura({ turno: 2 }), LIGADO, CTX)).toEqual(LEITURA_VAZIA);
  });

  it("(f) historico vazio → null", () => {
    expect(filtrarParaTela(leitura({ historico: [] }), LIGADO, CTX).historico).toBeNull();
  });
});

describe("filtrarParaTela — análise por IA", () => {
  it("(g) IA de 21 min some; de 19 min aparece", () => {
    expect(filtrarParaTela(comIA({ gerado_em: iso(21 * MIN) }), LIGADO, CTX).ia).toBeNull();
    expect(filtrarParaTela(comIA({ gerado_em: iso(19 * MIN) }), LIGADO, CTX).ia).not.toBeNull();
  });

  it("(h) IA com exatamente 20 min já some (limite exclusivo)", () => {
    expect(filtrarParaTela(comIA({ gerado_em: iso(20 * MIN) }), LIGADO, CTX).ia).toBeNull();
  });

  it("(i) base a 6 pp do % apurado some; a 5 pp aparece — nos dois sentidos", () => {
    expect(filtrarParaTela(comIA({ base_pct: 36 }), LIGADO, CTX).ia).toBeNull();
    expect(filtrarParaTela(comIA({ base_pct: 48 }), LIGADO, CTX).ia).toBeNull();
    expect(filtrarParaTela(comIA({ base_pct: 37 }), LIGADO, CTX).ia).not.toBeNull();
    expect(filtrarParaTela(comIA({ base_pct: 47 }), LIGADO, CTX).ia).not.toBeNull();
  });

  it("(j) gerado_em ilegível ou muito no futuro → some", () => {
    expect(filtrarParaTela(comIA({ gerado_em: "ontem" }), LIGADO, CTX).ia).toBeNull();
    expect(filtrarParaTela(comIA({ gerado_em: iso(-60 * MIN) }), LIGADO, CTX).ia).toBeNull();
  });

  it("(k) % apurado NaN na página → some", () => {
    expect(
      filtrarParaTela(leitura(), LIGADO, { ...CTX, pctApuradoTotal: Number.NaN }).ia,
    ).toBeNull();
  });

  it("(l) sem análise no objeto → null", () => {
    expect(filtrarParaTela(leitura({ ia: null }), LIGADO, CTX).ia).toBeNull();
  });
});

describe("filtrarParaTela — manchetes", () => {
  it("(m) antes das 20:00 UTC do dia do turno → some; às 20:00 em ponto → aparece", () => {
    const antes = new Date("2026-10-04T19:59:59Z");
    const l1 = leitura({ noticias: { em: iso(5 * MIN, antes), itens: [manchete()] } });
    expect(filtrarParaTela(l1, LIGADO, { ...CTX, agora: antes }).noticias).toBeNull();

    const emPonto = new Date("2026-10-04T20:00:00Z");
    const l2 = leitura({ noticias: { em: iso(5 * MIN, emPonto), itens: [manchete()] } });
    expect(filtrarParaTela(l2, LIGADO, { ...CTX, agora: emPonto }).noticias).toHaveLength(1);
  });

  it("(n) turno 2 usa 25/10 20:00 UTC — no dia do 1º turno ainda não aparece", () => {
    const l = leitura({ turno: 2 });
    expect(filtrarParaTela(l, LIGADO, { ...CTX, turno: 2 }).noticias).toBeNull();
    const dia2 = new Date("2026-10-25T21:00:00Z");
    const l2 = leitura({ turno: 2, noticias: { em: iso(5 * MIN, dia2), itens: [manchete()] } });
    expect(filtrarParaTela(l2, LIGADO, { ...CTX, turno: 2, agora: dia2 }).noticias).toHaveLength(1);
  });

  it("(o) coleta de 61 min some; de 59 min aparece; em null some", () => {
    const velha = leitura({ noticias: { em: iso(61 * MIN), itens: [manchete()] } });
    expect(filtrarParaTela(velha, LIGADO, CTX).noticias).toBeNull();
    const fresca = leitura({ noticias: { em: iso(59 * MIN), itens: [manchete()] } });
    expect(filtrarParaTela(fresca, LIGADO, CTX).noticias).toHaveLength(1);
    const semData = leitura({ noticias: { em: null, itens: [manchete()] } });
    expect(filtrarParaTela(semData, LIGADO, CTX).noticias).toBeNull();
  });

  it("(p) sem manchete → null", () => {
    const l = leitura({ noticias: { em: iso(5 * MIN), itens: [] } });
    expect(filtrarParaTela(l, LIGADO, CTX).noticias).toBeNull();
  });

  it("(q) no máximo 2 por veículo, mais nova primeiro", () => {
    const itens = [
      manchete({ veiculo: "A", link: "https://a.com/1", publicado_em: iso(30 * MIN) }),
      manchete({ veiculo: "A", link: "https://a.com/2", publicado_em: iso(5 * MIN) }),
      manchete({ veiculo: "A", link: "https://a.com/3", publicado_em: iso(1 * MIN) }),
      manchete({ veiculo: "B", link: "https://b.com/1", publicado_em: iso(2 * MIN) }),
    ];
    const r = filtrarParaTela(leitura({ noticias: { em: iso(1 * MIN), itens } }), LIGADO, CTX);
    expect(r.noticias?.map((m) => m.link)).toEqual([
      "https://a.com/3",
      "https://b.com/1",
      "https://a.com/2",
    ]);
  });

  it("(r) no máximo 8 na tela; sem data vai para o fim; link repetido entra uma vez", () => {
    const itens: Manchete[] = [
      manchete({ veiculo: "Sem data", link: "https://x.com/sem", publicado_em: null }),
    ];
    for (let v = 0; v < 6; v++) {
      for (let k = 0; k < 2; k++) {
        itens.push(
          manchete({
            veiculo: `V${v}`,
            link: `https://v${v}.com/${k}`,
            publicado_em: iso((v * 2 + k + 1) * MIN),
          }),
        );
      }
    }
    itens.push(manchete({ veiculo: "V0", link: "https://v0.com/0", publicado_em: iso(0) }));
    const r = filtrarParaTela(leitura({ noticias: { em: iso(1 * MIN), itens } }), LIGADO, CTX);
    expect(r.noticias).toHaveLength(NOTICIAS_TELA_MAX);
    const links = r.noticias?.map((m) => m.link) ?? [];
    expect(new Set(links).size).toBe(links.length);
    expect(links).not.toContain("https://x.com/sem");
    expect(links[0]).toBe("https://v0.com/0");

    const poucas = [
      manchete({ veiculo: "Sem data", link: "https://x.com/sem", publicado_em: null }),
      manchete({ veiculo: "C", link: "https://c.com/1", publicado_em: iso(3 * MIN) }),
    ];
    const r2 = filtrarParaTela(
      leitura({ noticias: { em: iso(1 * MIN), itens: poucas } }),
      LIGADO,
      CTX,
    );
    expect(r2.noticias?.map((m) => m.link)).toEqual(["https://c.com/1", "https://x.com/sem"]);
  });
});

// ---------------------------------------------------------------------------
// lerLeituraParaTela
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

function resposta(status: number, corpo: unknown): Response {
  return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lerLeituraParaTela — nunca lança, cai em LEITURA_VAZIA", () => {
  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
    logWarnMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EDGE_CONFIG", "https://edge-config.vercel.com/ecfg_teste?token=t");
    vi.stubEnv("BLOB_PUBLIC_BASE_URL", "https://blob.teste");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("(s) sem EDGE_CONFIG → vazia, sem tocar Edge Config nem Blob", async () => {
    vi.stubEnv("EDGE_CONFIG", "");
    const r = await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA });
    expect(r).toEqual(LEITURA_VAZIA);
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(t) get que lança → vazia", async () => {
    getMock.mockRejectedValue(new Error("edge config fora"));
    const r = await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA });
    expect(r).toEqual(LEITURA_VAZIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(u) get que nunca responde → vazia em 2 s", async () => {
    vi.useFakeTimers();
    getMock.mockReturnValue(new Promise(() => {}));
    const p = lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toEqual(LEITURA_VAZIA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(v) interruptor ausente ou tudo desligado → nem busca o Blob", async () => {
    getMock.mockResolvedValue(undefined);
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    getMock.mockResolvedValue({ ia: "true", noticias: 1, historico: false });
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(w) Blob 404 → vazia", async () => {
    getMock.mockResolvedValue(LIGADO);
    fetchMock.mockResolvedValue(resposta(404, "not found"));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
  });

  it("(x) schema inválido → vazia (e avisa no log)", async () => {
    getMock.mockResolvedValue(LIGADO);
    fetchMock.mockResolvedValue(resposta(200, { ...leitura(), versao: 2 }));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    expect(logWarnMock).toHaveBeenCalled();
  });

  it("(y) link javascript: no objeto reprova o schema inteiro → vazia", async () => {
    getMock.mockResolvedValue(LIGADO);
    const l = leitura({
      noticias: { em: iso(5 * MIN), itens: [manchete({ link: "javascript:alert(1)" })] },
    });
    fetchMock.mockResolvedValue(resposta(200, l));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
  });

  it("(z) JSON ilegível, HTTP 500 e fetch que lança → vazia", async () => {
    getMock.mockResolvedValue(LIGADO);
    fetchMock.mockResolvedValueOnce(resposta(200, "{nao é json"));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    fetchMock.mockResolvedValueOnce(resposta(500, "erro"));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
  });

  it("(aa) sem Blob configurado → vazia, sem fetch", async () => {
    vi.stubEnv("BLOB_PUBLIC_BASE_URL", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    getMock.mockResolvedValue(LIGADO);
    expect(await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA })).toEqual(
      LEITURA_VAZIA,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(bb) caminho feliz: lê a chave certa, busca t1 com revalidate 60 e SEM signal", async () => {
    getMock.mockResolvedValue(LIGADO);
    const l = leitura();
    fetchMock.mockResolvedValue(resposta(200, l));
    const r = await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA });

    expect(getMock).toHaveBeenCalledWith("interruptor-leitura-noite");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: unknown }];
    expect(url).toBe("https://blob.teste/leitura/pres/t1.json");
    expect(init.next).toEqual({ revalidate: 60 });
    expect(init.signal).toBeUndefined();

    expect(r.ia?.frases).toEqual(l.ia?.frases);
    expect(r.noticias).toHaveLength(1);
    expect(r.historico).toHaveLength(1);
  });

  it("(cc) o filtro vale também aqui: IA velha some mesmo com o Blob válido", async () => {
    getMock.mockResolvedValue({ ia: true, noticias: false, historico: false });
    fetchMock.mockResolvedValue(resposta(200, comIA({ gerado_em: iso(25 * MIN) })));
    const r = await lerLeituraParaTela({ pctApuradoTotal: 42, turno: 1, agora: AGORA });
    expect(r).toEqual({ ia: null, noticias: null, historico: null });
  });
});
