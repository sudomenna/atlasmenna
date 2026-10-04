/**
 * tests/unit/leitura/ia.test.ts — `lib/leitura/ia.ts` (ADR-0072).
 *
 * Sem rede: `ai` é mockado (qualquer chamada real lança), e a geração entra
 * pelo `gerar` injetável.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(async () => {
    throw new Error("rede proibida em teste");
  }),
  Output: { object: vi.fn((x: unknown) => x) },
}));

import type { EdgeCandidate, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import {
  ENTRADA_MAX_BYTES,
  FRASE_MAX,
  type GerarFn,
  gerarAnaliseIA,
  INSTRUCAO_SISTEMA,
  limparFrases,
  MODELO_PADRAO,
  montarEntradaIA,
} from "@/lib/leitura/ia";
import type { AnaliseIA, EventoBoletim } from "@/lib/leitura/types";
import base from "@/tests/fixtures/edge-config/projection-current.json" with { type: "json" };

const AGORA = new Date("2026-10-05T00:30:00Z"); // 21:30 de Brasília

function payloadBase(): EdgePayload {
  return structuredClone(base) as unknown as EdgePayload;
}

const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;

/** Pior caso de CADA campo: nomes longos e acentuados, 12 candidatos, 27 UFs. */
function payloadPiorCaso(): EdgePayload {
  const p = payloadBase();
  const nomeLongo = (i: number) =>
    `Maria Conceição Gonçalves Araújo Brandão Ribeiro Lusitânia Pêssego ${i}`;
  const cand = (i: number): EdgeCandidate => ({
    id: 2000 + i,
    nome: nomeLongo(i),
    partido: "SOLIDARIEDADE",
    destino: i === 12 ? "sub_judice" : "valido",
    votos_atuais: 123_456_789,
    votos_projetados: 123_456_789,
    pct_atual: 33.333333,
    pct_projetado: 33.333333,
    pct_projetado_lower: 31.111111,
    pct_projetado_upper: 35.555555,
    p_vitoria: 0.123456,
    rank: i,
    p_passa_2t: 0.987654,
    p_fecha_1t: 0.012345,
  });
  p.national.candidatos = Array.from({ length: 12 }, (_, k) => cand(k + 1));
  p.national.cenarios_2t = [
    { par: [2001, 2002], prob: 0.5 },
    { par: [2001, 2003], prob: 0.3 },
    { par: [2002, 2003], prob: 0.1 },
    { par: [2003, 2004], prob: 0.05 },
  ];
  p.national.p_segundo_turno_overall = 0.876543;
  const ufs = p.por_uf as EdgeUfRow[];
  for (const u of ufs) {
    u.lider = 2001;
    u.pct_apurado = 99.999;
    u.margem_projetada = 12.345678;
  }
  p.dado_ts = "2026-10-05T00:29:10Z";
  return p;
}

function eventosLongos(n: number): EventoBoletim[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `marco-${i}`,
    ts: new Date(AGORA.getTime() - i * 60_000).toISOString(),
    head: "Ação de apuração — atualização ".repeat(4),
    text: "Votação em São Paulo, Paraná e Amapá avança; ".repeat(12),
    tipo: "marco" as const,
  }));
}

function anteriorLonga(): AnaliseIA {
  const frase = "É informação não verificável à exaustão ".repeat(12).slice(0, FRASE_MAX);
  return {
    frases: [frase, frase, frase, frase],
    modelo: MODELO_PADRAO,
    gerado_em: "2026-10-05T00:20:00Z",
    base_ts: "2026-10-05T00:19:00Z",
    base_pct: 30,
  };
}

describe("montarEntradaIA", () => {
  it("fica abaixo de 8 KB no pior caso (27 UFs, 12 candidatos, 40 eventos, 4 frases de 400)", () => {
    const p = payloadPiorCaso();
    expect(p.por_uf).toHaveLength(27);
    const entrada = montarEntradaIA(p, eventosLongos(40), anteriorLonga(), AGORA);
    expect(bytes(entrada)).toBeLessThan(ENTRADA_MAX_BYTES);
    expect(entrada.candidatos).toHaveLength(6);
    expect(entrada.ufs).toHaveLength(27);
    expect((entrada.eventos_recentes as unknown[]).length).toBeGreaterThan(0);
    expect((entrada.eventos_recentes as unknown[]).length).toBeLessThanOrEqual(8);
    expect(
      (entrada.nacional as { cenarios_2t_projetados: unknown[] }).cenarios_2t_projetados,
    ).toHaveLength(3);
  });

  it("separa apurado de projeção, converte probabilidades em % e ordena por rank", () => {
    const p = payloadBase();
    p.national.candidatos.reverse(); // ordem do array não importa: vale o rank
    const entrada = montarEntradaIA(p, [], null, AGORA);
    const [c1] = entrada.candidatos as Array<Record<string, unknown>>;
    expect(c1?.rank).toBe(1);
    expect(c1?.apurado_pct).toBe(43.5);
    expect(c1?.apurado_votos).toBe(15240321);
    expect(c1?.projecao_pct).toBe(43.2);
    expect(c1?.projecao_ic95_pct).toEqual([41.8, 44.6]);
    expect(c1?.prob_vitoria_pct).toBe(72);
    expect(c1?.prob_ir_ao_2t_pct).toBe(99.8);
    expect(c1?.prob_vencer_no_1t_pct).toBe(5);
    const geral = entrada.geral as Record<string, unknown>;
    expect(geral.hora_brasilia).toBe("21:30");
    expect(geral.apurado_total_pct).toBe(23.4);
    expect(geral.ufs_com_apuracao_iniciada).toBe(p.ufs_apuradas);
    expect((entrada.nacional as Record<string, unknown>).prob_haver_2t_pct).toBe(65);
  });

  it("traz as 27 UFs em tabela: sigla, apurado, líder da projeção por nome e margem — sem `chamada`", () => {
    const entrada = montarEntradaIA(payloadBase(), [], null, AGORA);
    expect(entrada.ufs_colunas).toEqual([
      "uf",
      "apurado_pct",
      "lider_projecao",
      "margem_projecao_pp",
    ]);
    const ufs = entrada.ufs as unknown[][];
    expect(ufs).toHaveLength(27);
    const ac = ufs.find((u) => u[0] === "AC");
    expect(ac).toHaveLength(4);
    expect(ac?.[1]).toBe(18);
    expect(ac?.[3]).toBe(10.5);
    expect(typeof ac?.[2]).toBe("string");
    expect(String(ac?.[2])).not.toMatch(/^candidato \d+$/);
  });

  it("🔴 2026-10-04 — `chamada` nas UFs sem eleito definido: nada de definição vai para a IA", () => {
    const p = payloadBase();
    for (const u of p.por_uf) u.chamada = true;
    const entrada = montarEntradaIA(p, [], null, AGORA);
    expect((entrada.nacional as Record<string, unknown>).eleitos_matematicamente).toBeUndefined();
    expect(JSON.stringify(entrada)).not.toMatch(/chamad/i);
  });

  it("Brasil definido: `nacional.eleitos_matematicamente` traz o nome pelo id definido", () => {
    const p = payloadBase();
    const segundo = [...p.national.candidatos].sort((a, b) => a.rank - b.rank)[1] as EdgeCandidate;
    for (const u of p.por_uf) {
      u.top_candidatos = [
        ...(u.top_candidatos ?? []).filter((t) => t.id !== segundo.id),
        { id: segundo.id, pct: 1, nome: segundo.nome, partido: segundo.partido },
      ] as EdgeUfRow["top_candidatos"];
      u.eleitos_definidos = [segundo.id];
    }
    const entrada = montarEntradaIA(p, [], null, AGORA);
    const eleitos = (entrada.nacional as Record<string, unknown>).eleitos_matematicamente;
    expect(eleitos).toHaveLength(1);
    expect(String((eleitos as string[])[0])).not.toMatch(/^candidato \d+$/);
  });

  it("eventos legados `chamada_uf` do histórico gravado não vão para a IA", () => {
    const hist: EventoBoletim[] = [
      {
        id: "chamada_uf-SP",
        ts: "2026-10-04T21:00:00.000Z",
        head: "Chamada",
        text: "A projeção chama SP para X.",
        tipo: "chamada_uf",
      },
      {
        id: "marco-25",
        ts: "2026-10-04T20:59:00.000Z",
        head: "Apuração",
        text: "25,0% das seções apuradas.",
        tipo: "marco",
      },
    ];
    const entrada = montarEntradaIA(payloadBase(), hist, null, AGORA);
    const ev = entrada.eventos_recentes as Array<{ titulo: string }>;
    expect(ev.map((e) => e.titulo)).toEqual(["Apuração"]);
  });

  it("hora do dado do TSE em Brasília quando há dado_ts; ausente quando não há", () => {
    const p = payloadBase();
    expect(
      (montarEntradaIA(p, [], null, AGORA).geral as Record<string, unknown>).hora_do_dado_tse,
    ).toBeUndefined();
    p.dado_ts = "2026-10-05T00:29:10Z";
    expect(
      (montarEntradaIA(p, [], null, AGORA).geral as Record<string, unknown>).hora_do_dado_tse,
    ).toBe("21:29");
  });

  it("deixa de fora votacao, municípios e séries", () => {
    const p = payloadBase() as EdgePayload & Record<string, unknown>;
    p.votacao = { marcador_votacao: true } as never;
    p.serie_por_candidato = { marcador_serie: true } as never;
    const json = JSON.stringify(montarEntradaIA(p, [], null, AGORA));
    expect(json).not.toContain("marcador_votacao");
    expect(json).not.toContain("marcador_serie");
    expect(json).not.toMatch(/municip/i);
  });

  it("leva os 8 eventos mais recentes e as frases anteriores (tamanho real de evento)", () => {
    const eventos = eventosLongos(12)
      .map((e) => ({ ...e, head: "Marco de apuração", text: "Apuração passa de 50% das seções." }))
      .reverse(); // ordem de entrada embaralhada
    const entrada = montarEntradaIA(payloadBase(), eventos, anteriorLonga(), AGORA);
    const ev = entrada.eventos_recentes as Array<{ hora: string }>;
    expect(ev).toHaveLength(8);
    expect(ev[0]?.hora).toBe("21:30");
    expect(entrada.frases_anteriores).toHaveLength(4);
  });
});

describe("limparFrases", () => {
  it("tira markdown, colapsa espaços e corta em 400", () => {
    expect(
      limparFrases([
        "**Lula** lidera   o apurado\n com 43,5%.",
        "# Título solto aqui",
        "- item de lista com texto",
        "x".repeat(500),
        "   ",
        "**",
      ]),
    ).toEqual([
      "Lula lidera o apurado com 43,5%.",
      "Título solto aqui",
      "item de lista com texto",
      "x".repeat(400),
    ]);
  });

  it("não mexe em conteúdo: hífen no meio e números ficam", () => {
    expect(limparFrases(["Bolsonaro-Lula: 36,8% a 35,1% (1,7 pp)."])).toEqual([
      "Bolsonaro-Lula: 36,8% a 35,1% (1,7 pp).",
    ]);
  });
});

describe("gerarAnaliseIA", () => {
  const frasesOk = [
    "Com 23,4% das urnas apuradas, Candidato PT tem 43,5% dos votos válidos no apurado.",
    "Na projeção não oficial do AtlasMenna, a chance de haver 2º turno é de 65%.",
  ];

  it("sucesso: devolve a análise com modelo padrão, base do payload e frases limpas", async () => {
    const gerar = vi.fn<GerarFn>(async () => [`**${frasesOk[0]}**`, frasesOk[1] as string]);
    const p = payloadBase();
    const r = await gerarAnaliseIA({
      payload: p,
      historico: [],
      anterior: null,
      agora: AGORA,
      gerar,
    });
    expect(r).toEqual({
      frases: frasesOk,
      modelo: MODELO_PADRAO,
      gerado_em: AGORA.toISOString(),
      base_ts: p.ts,
      base_pct: 23.4,
    });
    expect(gerar).toHaveBeenCalledTimes(1);
    const chamada = gerar.mock.calls[0]?.[0];
    expect(chamada?.modelo).toBe("anthropic/claude-sonnet-5.5");
    expect(chamada?.system).toBe(INSTRUCAO_SISTEMA);
    expect(chamada?.prompt).toContain('"apurado_total_pct":23.4');
  });

  it("usa o modelo pedido", async () => {
    const gerar = vi.fn<GerarFn>(async () => frasesOk);
    const r = await gerarAnaliseIA({
      payload: payloadBase(),
      historico: [],
      anterior: null,
      modelo: "openai/gpt-x",
      agora: AGORA,
      gerar,
    });
    expect(r.modelo).toBe("openai/gpt-x");
    expect(gerar.mock.calls[0]?.[0].modelo).toBe("openai/gpt-x");
  });

  it("vazio lança (lista vazia, ou só markdown)", async () => {
    for (const vazio of [[], ["**", "  ", "#"]]) {
      await expect(
        gerarAnaliseIA({
          payload: payloadBase(),
          historico: [],
          anterior: null,
          agora: AGORA,
          gerar: async () => vazio,
        }),
      ).rejects.toThrow(/vazia/);
    }
  });

  it("erro da geração lança o próprio erro", async () => {
    await expect(
      gerarAnaliseIA({
        payload: payloadBase(),
        historico: [],
        anterior: null,
        agora: AGORA,
        gerar: async () => {
          throw new Error("gateway 503");
        },
      }),
    ).rejects.toThrow("gateway 503");
  });

  it("a instrução carrega as travas: só números do JSON, nunca eleito, sem adjetivos de mérito", () => {
    expect(INSTRUCAO_SISTEMA).toMatch(/SOMENTE números que estão no JSON/);
    expect(INSTRUCAO_SISTEMA).toMatch(/Nunca declare ninguém eleito/);
    expect(INSTRUCAO_SISTEMA).toMatch(/Sem adjetivos de mérito sobre candidatos/);
    expect(INSTRUCAO_SISTEMA).toMatch(/projeção não oficial do AtlasMenna/);
  });
});

describe("guarda: `ai` não chega a nada que uma página importe", () => {
  const RAIZ = join(__dirname, "..", "..", "..");
  function fontes(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) out.push(...fontes(rel));
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const todos = ["app", "components", "lib", "scripts"].flatMap(fontes);
  const quemImporta = (re: RegExp) =>
    todos.filter((f) => re.test(readFileSync(join(RAIZ, f), "utf8"))).map((f) => relative(".", f));

  it("só lib/leitura/ia.ts importa o pacote `ai`", () => {
    expect(quemImporta(/from\s+["']ai["']/)).toEqual(["lib/leitura/ia.ts"]);
  });

  it("ia.ts só é importado pela ligação de produção, e esta só pela rota do cron", () => {
    expect(quemImporta(/from\s+["']@\/lib\/leitura\/ia["']|from\s+["']\.\/ia["']/)).toEqual([
      "lib/leitura/ciclo-producao.ts",
    ]);
    expect(quemImporta(/leitura\/ciclo-producao["']/)).toEqual([
      "app/api/internal/leitura-noite/route.ts",
    ]);
  });
});
