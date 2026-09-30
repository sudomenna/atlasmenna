/**
 * tests/unit/blob/deputado-uf-v2.test.ts
 *
 * Spec 026 — o contrato v2 do detalhe de Deputado no lado de LEITURA
 * (design § 2):
 *
 *   1. **Leitor tolerante (RF-276).** Objeto v1 sai idêntico; objeto v2 bem
 *      formado — inclusive a fixture de CONTRATO inteira — sai idêntico e sem
 *      aviso; campo v2 malformado sai do objeto — nunca lança — com UM aviso
 *      por campo por processo.
 *   2. **A lista 61+ (RF-260, ADR-0065).** Leitura no caminho próprio, com os
 *      mesmos motivos de degradação do objeto da UF.
 *   3. **`maisVotadosDaUf` (RF-270).** As referências resolvem para o formato
 *      do destaque nacional.
 *   4. **O interruptor no render (RF-265, ADR-0063 D4).** Desligado, ausente ou
 *      ilegível ⇒ NENHUM campo de projeção sobra no objeto que a tela recebe.
 *
 * As asserções de "nenhum campo sobra" são feitas sobre o JSON serializado —
 * é o que chega ao HTML —, não sobre um campo escolhido.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logWarnMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logWarn: (msg: string, ctx?: unknown) => logWarnMock(msg, ctx) };
});

import {
  _reiniciarAvisosDeDescarte,
  agremiacoesDaListaRestante,
  aplicarInterruptorNoNacional,
  aplicarInterruptorProjecao,
  type DeputadoUfDetail,
  type DeputadoUfLista,
  efeitoDoInterruptor,
  maisVotadosDaUf,
  readDeputadoUfDetail,
  readDeputadoUfLista,
  sanearDeputadoUfDetail,
  sanearDeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import listaContrato from "@/tests/fixtures/contrato/deputado-uf-lista.json" with { type: "json" };
import ufContrato from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };
import simulacaoUf from "@/tests/fixtures/simulacao/deputado-uf.json" with { type: "json" };

const BASE = "https://exemplo.test";

const LIGADO: InterruptorProjecaoLido = { ligada: true, pct_minimo: 25, origem: "chave" };
const DESLIGADO: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "chave" };
const AUSENTE: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "ausente" };
const FALHA: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "falha" };
const INVALIDA: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "invalida" };

const CONTRATO = ufContrato as unknown as Record<string, DeputadoUfDetail>;

/** Cópia profunda — os testes mutam o objeto. */
function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** RR da fixture de contrato: projeção LIBERADA, marcas, destino, puxador, corte. */
function rr(): DeputadoUfDetail {
  return copia(CONTRATO.RR as DeputadoUfDetail);
}

/** Todo vestígio de projeção que a tela poderia desenhar, no JSON serializado. */
function vestigiosDeProjecao(objeto: unknown): string[] {
  const json = JSON.stringify(objeto);
  return [
    '"projecao":"',
    '"projecao_apertada"',
    '"cadeiras_projetadas"',
    '"cadeiras_projetadas_ci95"',
    '"votos_projetados"',
  ].filter((marca) => json.includes(marca));
}

beforeEach(() => {
  logWarnMock.mockReset();
  _reiniciarAvisosDeDescarte();
});

// ---------------------------------------------------------------------------
// 1. Leitor tolerante
// ---------------------------------------------------------------------------

describe("sanearDeputadoUfDetail — v1 e v2 bem formados saem idênticos, sem aviso", () => {
  it("v1 da fixture de desenvolvimento (intocada para sempre, design § 9)", () => {
    for (const [uf, d] of Object.entries(
      depUfFixture as unknown as Record<string, DeputadoUfDetail>,
    )) {
      expect(sanearDeputadoUfDetail(d), uf).toEqual(d);
    }
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("v2 do modo simulado (27 UFs, o que o e2e mede — v2 desde a frente S)", () => {
    for (const [uf, d] of Object.entries(
      simulacaoUf as unknown as Record<string, DeputadoUfDetail>,
    )) {
      expect(sanearDeputadoUfDetail(d), uf).toEqual(d);
    }
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("🔴 a fixture de CONTRATO v2 inteira (AC, AP, RR, SP) — nenhum campo cai", () => {
    for (const [uf, d] of Object.entries(CONTRATO)) {
      expect(sanearDeputadoUfDetail(d), uf).toEqual(d);
    }
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("a lista 61+ de contrato também passa intacta", () => {
    const l = (listaContrato as unknown as Record<string, DeputadoUfLista>).SP as DeputadoUfLista;
    expect(sanearDeputadoUfLista(l)).toEqual(l);
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});

describe("sanearDeputadoUfDetail — campo v2 malformado sai, nunca lança", () => {
  function primeiraLinha(d: DeputadoUfDetail): Record<string, unknown> {
    return d.agremiacoes[0]?.candidatos?.[0] as unknown as Record<string, unknown>;
  }

  it("marca fora do vocabulário sai; a LINHA fica", () => {
    const d = rr();
    primeiraLinha(d).parcial = "QP";
    primeiraLinha(d).destino = "valido"; // ausente = válido; "valido" não existe
    primeiraLinha(d).projecao_apertada = false; // booleano opcional só como `true`
    const linha = sanearDeputadoUfDetail(d).agremiacoes[0]?.candidatos?.[0];
    expect(linha?.sqcand).toBe(primeiraLinha(rr()).sqcand);
    expect(linha).not.toHaveProperty("parcial");
    expect(linha).not.toHaveProperty("destino");
    expect(linha).not.toHaveProperty("projecao_apertada");
    expect(linha?.projecao).toBe("qp");
  });

  it("linha sem campo obrigatório (inclusive `rank` e `pct_validos`) sai; as outras ficam", () => {
    const d = rr();
    const n = d.agremiacoes[0]?.candidatos?.length ?? 0;
    const lista = d.agremiacoes[0]?.candidatos as unknown[];
    lista.push({ sqcand: 1, nome: "Sem rank", partido: "PL", votos: 1, pct_validos: 0 });
    lista.push({ sqcand: 2, nome: "Sem pct", partido: "PL", votos: 1, rank: 99 });
    expect(sanearDeputadoUfDetail(d).agremiacoes[0]?.candidatos).toHaveLength(n);
  });

  it("blocos de UF e de agremiação com forma errada saem inteiros; o v1 fica", () => {
    const bruto = {
      ...rr(),
      regras: { quociente_eleitoral: 1 },
      projecao: {
        estado: "liberada",
        motivo: "outro",
        pct_minimo: 25,
        zonas_apuradas: 1,
        zonas_total: 1,
      },
      conferencia: { ...rr().conferencia, comparou: ["tudo"] },
      lista: { restantes: "11" },
      contrato: "2",
      dado_ts: 123,
    } as unknown as DeputadoUfDetail;
    const agr = bruto.agremiacoes[0] as unknown as Record<string, unknown>;
    agr.candidatos = { a: 1 };
    agr.corte = { ultimo_eleito: null, primeiro_fora: 2, diferenca: 3 };
    agr.puxadores = [{ sqcand: 1 }];
    agr.cadeiras_projetadas_ci95 = [1];

    const s = sanearDeputadoUfDetail(bruto);
    for (const campo of ["regras", "projecao", "conferencia", "lista", "contrato", "dado_ts"]) {
      expect(s, campo).not.toHaveProperty(campo);
    }
    for (const campo of ["candidatos", "corte", "puxadores", "cadeiras_projetadas_ci95"]) {
      expect(s.agremiacoes[0], campo).not.toHaveProperty(campo);
    }
    expect(s.agremiacoes[0]?.cadeiras).toBe(rr().agremiacoes[0]?.cadeiras);
    expect(s.agremiacoes[0]?.eleitos).toEqual(rr().agremiacoes[0]?.eleitos);
  });

  it("`mais_votados` é de REFERÊNCIAS: a referência ruim sai, as boas ficam", () => {
    const d = rr();
    const refs = d.mais_votados as unknown[];
    const boas = refs.length;
    refs.push({ cod: 22, sqcand: 1 });
    expect(sanearDeputadoUfDetail(d).mais_votados).toHaveLength(boas);
  });

  it("`lista_restante` (transporte) que vazar até o leitor é removido", () => {
    const bruto = { ...rr(), lista_restante: [{ cod: "22", candidatos: [] }] };
    expect(sanearDeputadoUfDetail(bruto)).not.toHaveProperty("lista_restante");
  });

  it("lixo estrutural não lança: agremiação não-objeto sai, `eleitos` ausente vira []", () => {
    const bruto = { ts: "x", uf: "SP", agremiacoes: [null, 1, "x", { cod: "22" }] };
    const s = sanearDeputadoUfDetail(bruto as unknown as DeputadoUfDetail);
    expect(s.agremiacoes).toHaveLength(1);
    expect(s.agremiacoes[0]?.eleitos).toEqual([]);
    expect(s.agremiacoes[0]?.suplentes).toEqual([]);
  });

  it("campo desconhecido fica intocado — o produtor pode avançar sem quebrar o leitor", () => {
    const bruto = { ...rr(), campo_do_futuro: { a: 1 } };
    expect(sanearDeputadoUfDetail(bruto)).toHaveProperty("campo_do_futuro", { a: 1 });
  });

  it("🔴 o descarte AVISA — um aviso por campo por processo, não por render", () => {
    for (let i = 0; i < 3; i++) {
      const d = rr();
      primeiraLinha(d).parcial = "QP";
      sanearDeputadoUfDetail(d);
    }
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock.mock.calls[0]?.[1]).toMatchObject({
      campo: "agremiacoes[].candidatos.parcial",
      uf: "RR",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Leitura do Blob — objeto da UF saneado, e a lista 61+
// ---------------------------------------------------------------------------

describe("leitura do Blob (v2)", () => {
  const savedBase = process.env.BLOB_PUBLIC_BASE_URL;
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    process.env.BLOB_PUBLIC_BASE_URL = BASE;
  });
  afterEach(() => {
    if (savedBase === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
    else process.env.BLOB_PUBLIC_BASE_URL = savedBase;
    if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    vi.restoreAllMocks();
  });

  function mockFetch(impl: () => Promise<Response>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
  }

  function lista(uf = "SP"): DeputadoUfLista {
    const l = copia(
      (listaContrato as unknown as Record<string, DeputadoUfLista>).SP as DeputadoUfLista,
    );
    return { ...l, uf };
  }

  it("readDeputadoUfDetail aplica o leitor tolerante ao que chega do CDN", async () => {
    const d = { ...rr(), uf: "SP" };
    (d.agremiacoes[0]?.candidatos?.[0] as unknown as Record<string, unknown>).parcial = "QP";
    mockFetch(async () => new Response(JSON.stringify(d), { status: 200 }));
    const r = await readDeputadoUfDetail(6, "SP");
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.detail.agremiacoes[0]?.candidatos?.[0]).not.toHaveProperty("parcial");
  });

  it("lista: caminho próprio, mesma revalidação de 60 s", async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify(lista()), { status: 200 }));
    const r = await readDeputadoUfLista(6, "sp");
    expect(spy).toHaveBeenCalledWith(`${BASE}/deputado/uf-lista/SP.json`, {
      next: { revalidate: 60 },
    });
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.lista).toEqual(lista());
  });

  it("lista: 404 → not_found; 5xx e rede → fetch_error; lixo e UF trocada → invalid", async () => {
    mockFetch(async () => new Response("nope", { status: 404 }));
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "not_found" });
    vi.restoreAllMocks();

    mockFetch(async () => new Response("x", { status: 503 }));
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "fetch_error" });
    vi.restoreAllMocks();

    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "fetch_error" });
    vi.restoreAllMocks();

    mockFetch(async () => new Response("{nao-json", { status: 200 }));
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "invalid" });
    vi.restoreAllMocks();

    mockFetch(async () => new Response(JSON.stringify(lista("RJ")), { status: 200 }));
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "invalid" });
  });

  it("lista: sem Blob configurado → not_configured, sem tentar a rede", async () => {
    delete process.env.BLOB_PUBLIC_BASE_URL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const spy = mockFetch(async () => new Response("{}"));
    expect(await readDeputadoUfLista(6, "SP")).toMatchObject({ reason: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("lista: linha sem campo obrigatório sai; agremiação sem `cod` sai", async () => {
    const l = lista() as unknown as { agremiacoes: Array<{ candidatos: unknown[] }> };
    const n = l.agremiacoes[0]?.candidatos.length ?? 0;
    l.agremiacoes[0]?.candidatos.push({ sqcand: 63 });
    (l.agremiacoes as unknown[]).push({ candidatos: [] });
    mockFetch(async () => new Response(JSON.stringify(l), { status: 200 }));
    const r = await readDeputadoUfLista(6, "SP");
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.lista.agremiacoes).toHaveLength(1);
    expect(r.lista.agremiacoes[0]?.candidatos).toHaveLength(n);
  });
});

describe("agremiacoesDaListaRestante — o campo de transporte", () => {
  it("a lista de agremiações do design § 2.5 é aceita como veio", () => {
    const agr = [{ cod: "22", candidatos: [] }];
    expect(agremiacoesDaListaRestante(agr)).toBe(agr);
  });
  it("ausente ou malformado ⇒ null (nada é gravado)", () => {
    expect(agremiacoesDaListaRestante(undefined)).toBeNull();
    expect(agremiacoesDaListaRestante({ agremiacoes: [] })).toBeNull();
    expect(agremiacoesDaListaRestante([{ cod: 22, candidatos: [] }])).toBeNull();
    expect(agremiacoesDaListaRestante([{ cod: "22" }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Mais votados da UF
// ---------------------------------------------------------------------------

describe("maisVotadosDaUf — referências resolvidas no formato do destaque nacional", () => {
  it("as 10 referências de SP resolvem, na ordem, com a sigla da AGREMIAÇÃO", () => {
    const sp = CONTRATO.SP as DeputadoUfDetail;
    const destaques = maisVotadosDaUf(sp);
    expect(destaques).toHaveLength(sp.mais_votados?.length ?? -1);
    expect(destaques.map((d) => d.sqcand)).toEqual(sp.mais_votados?.map((r) => r.sqcand));
    const primeiro = destaques[0];
    const agr = sp.agremiacoes.find((a) => a.cod === sp.mais_votados?.[0]?.cod);
    expect(primeiro).toMatchObject({ uf: "SP", cod: agr?.cod, sigla: agr?.sigla });
    expect(typeof primeiro?.nome).toBe("string");
  });

  it("referência que não resolve é pulada; objeto v1 ⇒ []", () => {
    const sp = copia(CONTRATO.SP as DeputadoUfDetail);
    sp.mais_votados = [{ cod: "99", sqcand: 1 }, ...(sp.mais_votados ?? []).slice(0, 1)];
    expect(maisVotadosDaUf(sp)).toHaveLength(1);
    const v1 = (depUfFixture as unknown as Record<string, DeputadoUfDetail>).SP as DeputadoUfDetail;
    expect(maisVotadosDaUf(v1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. O interruptor no render
// ---------------------------------------------------------------------------

describe("efeitoDoInterruptor — falha fechada (ADR-0063 D4)", () => {
  it("ligado (lido da chave) e trava satisfeita ⇒ nada", () => {
    expect(efeitoDoInterruptor(LIGADO, 60, "liberada")).toBeNull();
  });
  it("🔴 desligado, ausente, ilegível e inválido ⇒ indisponível por `interruptor`", () => {
    for (const i of [DESLIGADO, AUSENTE, FALHA, INVALIDA]) {
      expect(efeitoDoInterruptor(i, 60, "liberada"), i.origem).toEqual({
        estado: "indisponivel",
        motivo: "interruptor",
      });
    }
  });
  it("trava SUBIDA: UF liberada abaixo dela ⇒ aguardando por `pct_minimo`", () => {
    const subida: InterruptorProjecaoLido = { ...LIGADO, pct_minimo: 40 };
    expect(efeitoDoInterruptor(subida, 30, "liberada")).toEqual({
      estado: "aguardando",
      motivo: "pct_minimo",
      pct_minimo: 40,
    });
    // No limiar exato, a trava está satisfeita.
    expect(efeitoDoInterruptor(subida, 40, "liberada")).toBeNull();
    // UF que o modelo já segurou por outro motivo mantém o motivo do modelo.
    expect(efeitoDoInterruptor(subida, 30, "indisponivel")).toBeNull();
  });
});

describe("aplicarInterruptorProjecao — desligado, nada de projeção chega à tela", () => {
  it("ligado ⇒ o MESMO objeto (sem cópia no caminho feliz)", () => {
    const d = rr();
    expect(aplicarInterruptorProjecao(d, LIGADO)).toBe(d);
  });

  for (const interruptor of [DESLIGADO, AUSENTE, FALHA, INVALIDA]) {
    it(`${interruptor.origem} ⇒ nenhum vestígio de projeção no JSON, e o estado diz por quê`, () => {
      const d = rr();
      expect(vestigiosDeProjecao(d).length).toBeGreaterThan(0); // o caso tem o que apagar
      const s = aplicarInterruptorProjecao(d, interruptor);
      expect(vestigiosDeProjecao(s)).toEqual([]);
      expect(s.projecao).toMatchObject({ estado: "indisponivel", motivo: "interruptor" });
      // O que NÃO é projeção fica: parcial, destino, corte, regras, Conferência.
      const json = JSON.stringify(s);
      expect(json).toContain('"parcial":"qp"');
      expect(json).toContain('"destino":"sub_judice"');
      expect(s.agremiacoes[0]?.corte).toEqual(d.agremiacoes[0]?.corte);
      expect(s.regras).toEqual(d.regras);
      expect(s.conferencia).toEqual(d.conferencia);
      // E a entrada não foi mutada.
      expect(vestigiosDeProjecao(d).length).toBeGreaterThan(0);
    });
  }

  it("trava subida acima do % apurado ⇒ aguardando, sem marcas", () => {
    const s = aplicarInterruptorProjecao(rr(), { ...LIGADO, pct_minimo: 70 });
    expect(s.projecao).toMatchObject({
      estado: "aguardando",
      motivo: "pct_minimo",
      pct_minimo: 70,
    });
    expect(vestigiosDeProjecao(s)).toEqual([]);
  });

  it("objeto v1 (sem `projecao`) não ganha o campo — continua 'não sabemos'", () => {
    const v1 = (depUfFixture as unknown as Record<string, DeputadoUfDetail>).SP as DeputadoUfDetail;
    const s = aplicarInterruptorProjecao(v1, DESLIGADO);
    expect(s).not.toHaveProperty("projecao");
    expect(s).toEqual(v1);
  });
});

describe("aplicarInterruptorNoNacional — o selo por UF da capa", () => {
  function pn(): EdgePayloadDeputado {
    return {
      ts: "t",
      cargo: 6,
      turno: 1,
      pct_apurado_total: 40,
      ufs_apuradas: 2,
      atualizacao_min: 30,
      bancada: {
        total_cadeiras: 513,
        cadeiras_atribuidas: 16,
        ufs_calculadas: 2,
        ufs_aguardando: 25,
        por_agremiacao: [],
      },
      por_uf: [
        {
          sigla: "RR",
          pct_apurado: 62,
          lugares_a_preencher: 8,
          quociente_eleitoral: 1,
          cadeiras_definidas: 8,
          vagas_nao_preenchidas: 0,
          empates_indeterminados: 0,
          lider: null,
          projecao: { estado: "liberada", pct_minimo: 25, zonas_apuradas: 13, zonas_total: 16 },
        },
        {
          sigla: "AC",
          pct_apurado: 30,
          lugares_a_preencher: 8,
          quociente_eleitoral: 1,
          cadeiras_definidas: 8,
          vagas_nao_preenchidas: 0,
          empates_indeterminados: 0,
          lider: null,
          projecao: { estado: "liberada", pct_minimo: 25, zonas_apuradas: 5, zonas_total: 31 },
        },
        {
          sigla: "SP",
          pct_apurado: 18,
          lugares_a_preencher: 70,
          quociente_eleitoral: 1,
          cadeiras_definidas: 70,
          vagas_nao_preenchidas: 0,
          empates_indeterminados: 0,
          lider: null,
        },
      ],
      insights: [],
      composition: { pre_election: 0, model: 0, actual_results: 1 },
    };
  }

  it("ligado e sem trava subida ⇒ o mesmo objeto", () => {
    const n = pn();
    expect(aplicarInterruptorNoNacional(n, LIGADO)).toBe(n);
  });

  it("desligado ⇒ todo selo vira indisponível; linha sem selo (v1) continua sem", () => {
    const s = aplicarInterruptorNoNacional(pn(), AUSENTE);
    expect(s.por_uf.map((r) => r.projecao?.estado)).toEqual([
      "indisponivel",
      "indisponivel",
      undefined,
    ]);
  });

  it("trava subida para 40%: só a UF abaixo (AC, 30%) sai de `liberada`", () => {
    const s = aplicarInterruptorNoNacional(pn(), { ...LIGADO, pct_minimo: 40 });
    expect(s.por_uf[0]?.projecao?.estado).toBe("liberada");
    expect(s.por_uf[1]?.projecao).toMatchObject({ estado: "aguardando", motivo: "pct_minimo" });
  });
});
