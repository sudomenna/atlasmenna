/**
 * tests/unit/leitura/ciclo.test.ts — `executarCicloLeitura` (ADR-0072).
 *
 * Toda a I/O entra por `DepsCiclo` (falsos aqui); as funções puras do agente A
 * (`eventos.ts`, `feeds.ts`) são mockadas para o teste controlar o que o
 * ciclo "detecta". Sem rede, sem gravação real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/leitura/eventos", () => ({
  derivarEventos: vi.fn(),
  mesclarHistorico: vi.fn(),
}));
vi.mock("@/lib/leitura/feeds", () => ({
  filtrarRelevantes: vi.fn(),
  mesclarManchetes: vi.fn(),
}));

import { FASE_PRE_ELEICAO } from "@/lib/config/fase";
import type { EdgePayload } from "@/lib/edge-config/types";
import { type DepsCiclo, executarCicloLeitura, sobrenomesDoPayload } from "@/lib/leitura/ciclo";
import { derivarEventos, mesclarHistorico } from "@/lib/leitura/eventos";
import { filtrarRelevantes, mesclarManchetes } from "@/lib/leitura/feeds";
import {
  type AnaliseIA,
  type EstadoResumo,
  type EventoBoletim,
  INTERRUPTOR_DESLIGADO,
  type InterruptorLeitura,
  type LeituraNoite,
  leituraVazia,
  type Manchete,
} from "@/lib/leitura/types";
import base from "@/tests/fixtures/edge-config/projection-current.json" with { type: "json" };

const AGORA = new Date("2026-10-05T00:30:00Z");
const MIN = 60_000;
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

const ESTADO: EstadoResumo = {
  ts: "2026-10-05T00:29:00Z",
  pct: 23.4,
  ufs_apuradas: 27,
  lider_apurado_id: 1001,
  lider_projecao_id: 1001,
  p2t: 0.65,
  chamadas: [],
  marcos: [10],
};

function evento(id: string, ts = AGORA.toISOString()): EventoBoletim {
  return { id, ts, head: `head ${id}`, text: `texto ${id}`, tipo: "marco" };
}

function manchete(link: string, titulo = `Eleição: ${link}`): Manchete {
  return {
    titulo,
    link: `https://exemplo.com.br/${link}`,
    veiculo: "Exemplo",
    publicado_em: "2026-10-04T22:00:00Z",
    feed: "exemplo",
  };
}

function payload(over: Partial<EdgePayload> = {}): EdgePayload {
  return { ...(structuredClone(base) as unknown as EdgePayload), ...over };
}

function analise(over: Partial<AnaliseIA> = {}): AnaliseIA {
  return {
    frases: ["Frase anterior número um, longa o bastante.", "Frase anterior dois, também longa."],
    modelo: "anthropic/claude-sonnet-5.5",
    gerado_em: antes(5 * MIN),
    base_ts: "2026-10-05T00:24:00Z",
    base_pct: 23.0,
    ...over,
  };
}

/** Leitura anterior recente (gravada há 1 min), com a IA e as notícias dadas. */
function anterior(over: Partial<LeituraNoite> = {}): LeituraNoite {
  return {
    ...leituraVazia(1, antes(1 * MIN)),
    estado: ESTADO,
    historico: [evento("inicio", antes(60 * MIN))],
    noticias: { em: antes(1 * MIN), itens: [manchete("velha")] },
    ...over,
  };
}

const LIGADO: InterruptorLeitura = { ia: true, noticias: true, historico: true };

function deps(over: Partial<DepsCiclo> = {}) {
  const d = {
    agora: vi.fn(() => AGORA),
    lerInterruptor: vi.fn(async () => ({ ...INTERRUPTOR_DESLIGADO })),
    lerPayload: vi.fn(async (): Promise<EdgePayload | null> => payload()),
    lerAnterior: vi.fn(async (): Promise<LeituraNoite | null> => null),
    buscarFeeds: vi.fn(async () => ({
      itens: [manchete("nova")],
      porFeed: { exemplo: 1 } as Record<string, number | "erro">,
    })),
    gerarAnalise: vi.fn(
      async (args: { payload: EdgePayload; modelo?: string; agora: Date }): Promise<AnaliseIA> => ({
        frases: ["Frase nova da IA, com números do JSON.", "Segunda frase nova da IA."],
        modelo: args.modelo ?? "anthropic/claude-sonnet-5.5",
        gerado_em: args.agora.toISOString(),
        base_ts: args.payload.ts,
        base_pct: args.payload.pct_apurado_total,
      }),
    ),
    gravar: vi.fn(async (_l: LeituraNoite) => {}),
    ...over,
  };
  return d;
}

beforeEach(() => {
  vi.mocked(derivarEventos).mockReset();
  vi.mocked(derivarEventos).mockImplementation(() => ({ eventos: [], estado: ESTADO }));
  vi.mocked(mesclarHistorico).mockReset();
  vi.mocked(mesclarHistorico).mockImplementation((existente, novos) => {
    const ids = new Set(existente.map((e) => e.id));
    return [...novos.filter((e) => !ids.has(e.id)), ...existente];
  });
  vi.mocked(filtrarRelevantes).mockReset();
  vi.mocked(filtrarRelevantes).mockImplementation((itens) => itens);
  vi.mocked(mesclarManchetes).mockReset();
  vi.mocked(mesclarManchetes).mockImplementation((existentes, novas) => {
    const links = new Set(existentes.map((m) => m.link));
    return [...novas.filter((m) => !links.has(m.link)), ...existentes];
  });
});

describe("executarCicloLeitura — tudo desligado", () => {
  it("não chama feeds nem IA, mas grava o histórico", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => ({
      eventos: [evento("marco-25")],
      estado: ESTADO,
    }));
    const d = deps({ lerAnterior: vi.fn(async () => anterior()) });
    const r = await executarCicloLeitura(d);

    expect(d.buscarFeeds).not.toHaveBeenCalled();
    expect(d.gerarAnalise).not.toHaveBeenCalled();
    expect(r.gravou).toBe(true);
    expect(r.eventosNovos).toBe(1);
    expect(r.ia.tentou).toBe(false);
    expect(r.noticias.buscou).toBe(false);
    expect(d.gravar).toHaveBeenCalledTimes(1);
    const gravada = vi.mocked(d.gravar).mock.calls[0]?.[0] as LeituraNoite;
    expect(gravada.historico.map((e) => e.id)).toEqual(["marco-25", "inicio"]);
    expect(gravada.estado).toEqual(ESTADO);
    expect(gravada.atualizado_em).toBe(AGORA.toISOString());
    // O que já havia de notícias e IA atravessa intacto.
    expect(gravada.noticias.itens.map((m) => m.link)).toEqual(["https://exemplo.com.br/velha"]);
    expect(derivarEventos).toHaveBeenCalledWith(ESTADO, expect.anything(), AGORA.toISOString());
  });

  it("primeiro ciclo da noite (sem anterior) grava mesmo sem evento", async () => {
    const d = deps();
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(true);
    expect(derivarEventos).toHaveBeenCalledWith(null, expect.anything(), AGORA.toISOString());
  });

  it("sem evento e com gravação recente, não grava; com gravação de 11 min, regrava", async () => {
    const d1 = deps({ lerAnterior: vi.fn(async () => anterior()) });
    const r1 = await executarCicloLeitura(d1);
    expect(r1.gravou).toBe(false);
    expect(r1.motivo).toMatch(/nada mudou/);
    expect(d1.gravar).not.toHaveBeenCalled();

    const d2 = deps({
      lerAnterior: vi.fn(async () => ({ ...anterior(), atualizado_em: antes(11 * MIN) })),
    });
    expect((await executarCicloLeitura(d2)).gravou).toBe(true);
  });

  it("evento já presente no histórico não conta como novo", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => ({
      eventos: [evento("inicio")],
      estado: ESTADO,
    }));
    const d = deps({ lerAnterior: vi.fn(async () => anterior()) });
    const r = await executarCicloLeitura(d);
    expect(r.eventosNovos).toBe(0);
    expect(r.gravou).toBe(false);
  });
});

describe("executarCicloLeitura — ritmo da IA", () => {
  const comIA = (ant: LeituraNoite, p: EdgePayload = payload()) =>
    deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO })),
      lerAnterior: vi.fn(async () => ant),
      lerPayload: vi.fn(async () => p),
    });

  it("última tentativa há 3 min: não tenta, mesmo com o apurado tendo andado 5 pp", async () => {
    const d = comIA(
      anterior({
        ia: analise({ base_pct: 18 }),
        ia_tentativa: { em: antes(3 * MIN), ok: true },
      }),
    );
    const r = await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
    expect(r.ia.tentou).toBe(false);
  });

  it("tentativa há 5 min, mas o apurado andou só 0,4 pp, sem evento e texto de 5 min: não tenta", async () => {
    const d = comIA(
      anterior({ ia: analise({ base_pct: 23.0 }), ia_tentativa: { em: antes(5 * MIN), ok: true } }),
    );
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
  });

  it("andou exatamente 2 pp: tenta", async () => {
    const d = comIA(
      anterior({ ia: analise({ base_pct: 21.4 }), ia_tentativa: { em: antes(5 * MIN), ok: true } }),
    );
    const r = await executarCicloLeitura(d);
    expect(d.gerarAnalise).toHaveBeenCalledTimes(1);
    expect(r.ia).toMatchObject({ tentou: true, ok: true });
    expect(r.gravou).toBe(true);
    const gravada = vi.mocked(d.gravar).mock.calls[0]?.[0] as LeituraNoite;
    expect(gravada.ia?.base_pct).toBe(23.4);
    expect(gravada.ia_tentativa).toEqual({ em: AGORA.toISOString(), ok: true });
  });

  it("andou 1,99 pp: não tenta", async () => {
    const d = comIA(
      anterior({
        ia: analise({ base_pct: 21.41 }),
        ia_tentativa: { em: antes(5 * MIN), ok: true },
      }),
    );
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
  });

  it("texto com 11 min: tenta", async () => {
    const d = comIA(
      anterior({
        ia: analise({ gerado_em: antes(11 * MIN) }),
        ia_tentativa: { em: antes(11 * MIN), ok: true },
      }),
    );
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).toHaveBeenCalledTimes(1);
  });

  it("texto com 11 min mas apurado parado (mesmo pct da base): não tenta", async () => {
    const d = comIA(
      anterior({
        ia: analise({ gerado_em: antes(11 * MIN), base_pct: 23.4 }),
        ia_tentativa: { em: antes(11 * MIN), ok: true },
      }),
    );
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
  });

  it("evento novo neste ciclo: tenta", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => ({
      eventos: [evento("chamada_uf-SP")],
      estado: ESTADO,
    }));
    const d = comIA(anterior({ ia: analise(), ia_tentativa: { em: antes(5 * MIN), ok: true } }));
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).toHaveBeenCalledTimes(1);
  });

  it("sem IA anterior: tenta, e passa o modelo do interruptor", async () => {
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, modelo: "openai/gpt-x" })),
      lerAnterior: vi.fn(async () => anterior()),
    });
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.gerarAnalise).mock.calls[0]?.[0].modelo).toBe("openai/gpt-x");
  });

  it("pré-eleição ou apurado zero: não tenta", async () => {
    const pre = comIA(anterior(), payload({ fase: FASE_PRE_ELEICAO }));
    await executarCicloLeitura(pre);
    expect(pre.gerarAnalise).not.toHaveBeenCalled();

    const zero = comIA(anterior(), payload({ pct_apurado_total: 0 }));
    await executarCicloLeitura(zero);
    expect(zero.gerarAnalise).not.toHaveBeenCalled();
  });

  it("interruptor da IA desligado: não tenta", async () => {
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, ia: false })),
      lerAnterior: vi.fn(async () => anterior()),
    });
    await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
  });

  it("ciclo que já gastou mais de 25 s pula a IA", async () => {
    let chamadas = 0;
    const d = comIA(anterior());
    d.agora = vi.fn(() => (chamadas++ === 0 ? AGORA : new Date(AGORA.getTime() + 26_000)));
    const r = await executarCicloLeitura(d);
    expect(d.gerarAnalise).not.toHaveBeenCalled();
    expect(r.ia.tentou).toBe(false);
    expect(r.motivo).toMatch(/IA pulada/);
  });
});

describe("executarCicloLeitura — falha da IA", () => {
  it("mantém o texto anterior, marca ok:false com erro curto e grava a tentativa", async () => {
    const iaVelha = analise({ base_pct: 10 });
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO })),
      lerAnterior: vi.fn(async () =>
        anterior({ ia: iaVelha, ia_tentativa: { em: antes(5 * MIN), ok: true } }),
      ),
      gerarAnalise: vi.fn(async () => {
        throw new Error("gateway 503 em https://ai-gateway.vercel.sh/v1/x");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(r.ia.tentou).toBe(true);
    expect(r.ia.ok).toBe(false);
    expect(r.ia.erro).toMatch(/gateway 503/);
    expect(r.ia.erro).not.toMatch(/https?:/);
    expect(r.gravou).toBe(true);
    const gravada = vi.mocked(d.gravar).mock.calls[0]?.[0] as LeituraNoite;
    expect(gravada.ia).toEqual(iaVelha);
    expect(gravada.ia_tentativa).toMatchObject({ em: AGORA.toISOString(), ok: false });
    expect(gravada.ia_tentativa?.erro?.length ?? 0).toBeLessThanOrEqual(160);
  });
});

describe("executarCicloLeitura — ensaio", () => {
  it("força notícias e IA com tudo desligado e NUNCA grava; devolve a leitura", async () => {
    const d = deps({
      ensaio: true,
      lerAnterior: vi.fn(async () =>
        anterior({ ia_tentativa: { em: antes(1 * MIN), ok: true }, ia: analise() }),
      ),
    });
    const r = await executarCicloLeitura(d);
    expect(d.buscarFeeds).toHaveBeenCalledTimes(1);
    expect(d.gerarAnalise).toHaveBeenCalledTimes(1);
    expect(d.gravar).not.toHaveBeenCalled();
    expect(r.gravou).toBe(false);
    expect(r.leitura?.ia?.frases[0]).toMatch(/Frase nova/);
    expect(r.leitura?.noticias.itens.map((m) => m.link)).toContain("https://exemplo.com.br/nova");
    expect(r.motivo).toMatch(/ensaio/);
  });

  it("ensaio sem anterior (o caso que mais gravaria) também não grava", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => ({
      eventos: [evento("inicio")],
      estado: ESTADO,
    }));
    const d = deps({ ensaio: true });
    const r = await executarCicloLeitura(d);
    expect(d.gravar).not.toHaveBeenCalled();
    expect(r.gravou).toBe(false);
    expect(r.leitura?.historico).toHaveLength(1);
  });
});

describe("executarCicloLeitura — notícias", () => {
  it("busca a cada 5 min no máximo, filtra desde 04/10 00h de Brasília com os sobrenomes", async () => {
    const recente = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, ia: false })),
      lerAnterior: vi.fn(async () => anterior({ noticias: { em: antes(3 * MIN), itens: [] } })),
    });
    await executarCicloLeitura(recente);
    expect(recente.buscarFeeds).not.toHaveBeenCalled();

    const velha = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, ia: false })),
      lerAnterior: vi.fn(async () => anterior({ noticias: { em: antes(6 * MIN), itens: [] } })),
    });
    const r = await executarCicloLeitura(velha);
    expect(velha.buscarFeeds).toHaveBeenCalledTimes(1);
    expect(r.noticias).toMatchObject({ buscou: true, porFeed: { exemplo: 1 }, total: 1 });
    expect(r.gravou).toBe(true);
    const opts = vi.mocked(filtrarRelevantes).mock.calls[0]?.[1];
    expect(opts?.desde.toISOString()).toBe("2026-10-04T03:00:00.000Z");
    expect(opts?.termosExtras).toEqual(sobrenomesDoPayload(payload()));
    const gravada = vi.mocked(velha.gravar).mock.calls[0]?.[0] as LeituraNoite;
    expect(gravada.noticias.em).toBe(AGORA.toISOString());
  });

  it("2º turno filtra desde 25/10 00h de Brasília", async () => {
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, ia: false })),
      lerPayload: vi.fn(async () => payload({ turno: 2 })),
    });
    await executarCicloLeitura(d);
    expect(vi.mocked(filtrarRelevantes).mock.calls[0]?.[1].desde.toISOString()).toBe(
      "2026-10-25T03:00:00.000Z",
    );
    expect((vi.mocked(d.gravar).mock.calls[0]?.[0] as LeituraNoite).turno).toBe(2);
  });

  it("todos os feeds falharam: mantém a lista e o carimbo anteriores", async () => {
    const ant = anterior({ noticias: { em: antes(6 * MIN), itens: [manchete("velha")] } });
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO, ia: false })),
      lerAnterior: vi.fn(async () => ant),
      buscarFeeds: vi.fn(async () => ({
        itens: [],
        porFeed: { a: "erro", b: "erro" } as Record<string, number | "erro">,
      })),
    });
    const r = await executarCicloLeitura(d);
    expect(r.noticias.buscou).toBe(true);
    expect(r.gravou).toBe(false);
    expect(mesclarManchetes).not.toHaveBeenCalled();
  });
});

describe("executarCicloLeitura — falhas isoladas", () => {
  it("interruptor que lança vira tudo desligado, e o histórico segue", async () => {
    const d = deps({
      lerInterruptor: vi.fn(async () => {
        throw new Error("edge config fora");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(true);
    expect(d.buscarFeeds).not.toHaveBeenCalled();
    expect(d.gerarAnalise).not.toHaveBeenCalled();
    expect(r.motivo).toMatch(/interruptor/);
  });

  it("feeds que lançam não derrubam o ciclo; a IA ainda roda", async () => {
    const d = deps({
      lerInterruptor: vi.fn(async () => ({ ...LIGADO })),
      buscarFeeds: vi.fn(async () => {
        throw new Error("rede");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(r.noticias.buscou).toBe(true);
    expect(r.ia).toMatchObject({ tentou: true, ok: true });
    expect(r.gravou).toBe(true);
  });

  it("derivarEventos que lança mantém o estado anterior e segue", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => {
      throw new Error("payload estranho");
    });
    const d = deps({
      lerAnterior: vi.fn(async () => ({ ...anterior(), atualizado_em: antes(11 * MIN) })),
    });
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(true);
    expect((vi.mocked(d.gravar).mock.calls[0]?.[0] as LeituraNoite).estado).toEqual(ESTADO);
    expect(r.motivo).toMatch(/eventos/);
  });

  it("gravar que lança devolve gravou:false com o motivo — sem lançar", async () => {
    const d = deps({
      gravar: vi.fn(async () => {
        throw new Error("blob 500");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(false);
    expect(r.motivo).toMatch(/falha ao gravar.*blob 500/);
  });

  it("leitura anterior que FALHA (≠ ausente) não grava, para não apagar o histórico", async () => {
    vi.mocked(derivarEventos).mockImplementation(() => ({
      eventos: [evento("marco-50")],
      estado: ESTADO,
    }));
    const d = deps({
      lerAnterior: vi.fn(async () => {
        throw new Error("Blob respondeu HTTP 503");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(d.gravar).not.toHaveBeenCalled();
    expect(r.gravou).toBe(false);
    expect(r.motivo).toMatch(/histórico/);
  });

  it("agora() que lança: devolve resultado, nunca lança", async () => {
    const d = deps({
      agora: vi.fn(() => {
        throw new Error("relógio");
      }),
    });
    await expect(executarCicloLeitura(d)).resolves.toMatchObject({ gravou: false });
  });
});

describe("executarCicloLeitura — sem payload", () => {
  it("payload null: sai sem gravar e sem chamar nada", async () => {
    const d = deps({ lerPayload: vi.fn(async () => null) });
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(false);
    expect(r.motivo).toMatch(/sem payload/);
    expect(d.gravar).not.toHaveBeenCalled();
    expect(derivarEventos).not.toHaveBeenCalled();
  });

  it("payload que lança: idem, com o motivo", async () => {
    const d = deps({
      lerPayload: vi.fn(async () => {
        throw new Error("edge config 500");
      }),
    });
    const r = await executarCicloLeitura(d);
    expect(r.gravou).toBe(false);
    expect(r.motivo).toMatch(/edge config 500/);
    expect(d.gravar).not.toHaveBeenCalled();
  });
});

describe("sobrenomesDoPayload", () => {
  it("último nome com 4+ letras, pulando sufixos; descarta termos curtos", () => {
    const p = payload();
    p.national.candidatos = [
      { ...p.national.candidatos[0], nome: "Ratinho Júnior" },
      { ...p.national.candidatos[0], nome: "Candidato PT" },
      { ...p.national.candidatos[0], nome: "Ciro Gomes" },
    ] as EdgePayload["national"]["candidatos"];
    expect(sobrenomesDoPayload(p)).toEqual(["Ratinho", "Gomes"]);
  });
});
