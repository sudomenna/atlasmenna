/**
 * tests/unit/etiquetas/leitor.test.ts
 *
 * O leitor (spec 024, RF-231/232): Blob × cópia do build pela maior versão,
 * falha do Blob ⇒ cópia do build, chaves da cópia do build sempre desligadas,
 * junção por `sqcand` normalizado, e a resolução que a tela recebe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projetarNacional, proximaVersao } from "@/data-pipeline/etiquetas-publicar";
import { todasDesligadas, VISOES } from "@/lib/etiquetas/catalogo";
import type { ArquivoNacional, ArquivoUf } from "@/lib/etiquetas/formato";
import { isArquivoNacional, normalizarSqcand } from "@/lib/etiquetas/formato";
import {
  ETIQUETAS_BLOB_TIMEOUT_MS,
  ETIQUETAS_REVALIDATE_SECONDS,
  escolherMaisNovo,
  lerEtiquetas,
  lerJsonDoBlob,
  montarEtiquetas,
} from "@/lib/etiquetas/leitor";

import {
  compilarOk,
  csv,
  DEP_RJ_UNIAO,
  DEP_SP_PL,
  entrada,
  GOV_SP_PL,
  GOV_SP_PT,
  SEN_SP_PL,
  senadoTeste,
} from "./_fixtures";

function compilado() {
  return compilarOk(
    entrada(
      {
        "governador.csv": csv(
          { chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "esquerda" },
          { chave: GOV_SP_PT, categoria: "centrao", valor: "nao" },
        ),
        "partidos.csv": csv(
          { chave: "partido:PL", categoria: "relacao_governo", valor: "oposicao" },
          { chave: "partido:UNIAO", categoria: "centrao", valor: "sim" },
          { chave: "federacao:UNIÃO/PP", categoria: "centrao", valor: "sim" },
        ),
        "senado-2031.csv": csv({
          chave: "senado:5001",
          categoria: "impeachment_stf",
          valor: "a_favor",
        }),
      },
      { senado2031: senadoTeste() },
    ),
  );
}

describe("RF-231 — escolha da cópia", () => {
  const arq = (versao: number) => ({ meta: { versao } });

  it("Blob só vence com versão ESTRITAMENTE maior", () => {
    expect(escolherMaisNovo(arq(10), arq(9)).fonte).toBe("blob");
    expect(escolherMaisNovo(arq(9), arq(9)).fonte).toBe("embutido");
    expect(escolherMaisNovo(arq(8), arq(9)).fonte).toBe("embutido");
    expect(escolherMaisNovo(null, arq(9)).fonte).toBe("embutido");
  });

  it("revalidação de 60 s (casada com o cacheControlMaxAge do writer)", () => {
    expect(ETIQUETAS_REVALIDATE_SECONDS).toBe(60);
  });

  it("cópia do build ⇒ as chaves do publicar.json compilado (spec 025, emenda ao RF-231)", () => {
    // Até 29/09 a cópia do build era forçada a tudo desligado. Agora ela
    // carrega o `publicar.json` versionado — o mesmo que o publicador leva ao
    // Blob —, e o leitor honra o que ela diz, nos dois lados.
    const { nacional } = compilado();
    const comChaves: ArquivoNacional = {
      ...nacional,
      publicar: { ...nacional.publicar, v1: true, chips: true },
    };
    const e = montarEtiquetas(comChaves, "embutido", null);
    expect(e.viewLigada("v1")).toBe(true);
    expect(e.viewLigada("chips")).toBe(true);
    expect(e.viewLigada("v2")).toBe(false);
    const doBlob = montarEtiquetas(comChaves, "blob", null);
    expect(doBlob.viewLigada("v1")).toBe(true);
    expect(doBlob.viewLigada("v2")).toBe(false);
  });

  it("🔴 deploy depois da publicação NÃO apaga as visões que o publicar.json liga", () => {
    // A armadilha da open question 5 da spec 024, em três passos:
    //   1. o dono liga v1 no `publicar.json`, compila (build A) e publica
    //      (Blob B, versão > A);
    //   2. alguém compila etiquetas novas (build C, versão > B — o relógio
    //      andou) e faz deploy SEM publicar;
    //   3. C vence pela versão. Antes da emenda, C tinha as chaves forçadas a
    //      `false` e a V1 sumia da tela. Agora C carrega o mesmo `publicar.json`.
    const ligado = { ...todasDesligadas(), v1: true };
    const fontesA = {
      "partidos.csv": csv({ chave: "partido:PL", categoria: "relacao_governo", valor: "oposicao" }),
    };
    const a = compilarOk(entrada(fontesA, { publicar: ligado }));
    const t1 = new Date(a.nacional.meta.versao * 1000 + 3_600_000);
    const b = projetarNacional(
      a.nacional,
      { ...a.nacional.meta, versao: proximaVersao(t1, null, a.nacional.meta.versao), git_sha: "x" },
      ligado,
    );
    const c = compilarOk(
      entrada(
        {
          "partidos.csv": csv(
            { chave: "partido:PL", categoria: "relacao_governo", valor: "oposicao" },
            { chave: "partido:PSD", categoria: "relacao_governo", valor: "independente" },
          ),
        },
        {
          publicar: ligado,
          anterior: {
            nacional: a.nacional,
            ufs: new Map(Object.entries(a.ufs)),
            historico: a.historico,
          },
          agora: new Date(b.meta.versao * 1000 + 3_600_000),
        },
      ),
    );
    expect(c.nacional.meta.versao).toBeGreaterThan(b.meta.versao);

    const escolhido = escolherMaisNovo(b, c.nacional);
    expect(escolhido.fonte).toBe("embutido");
    expect(montarEtiquetas(escolhido.arquivo, escolhido.fonte, null).viewLigada("v1")).toBe(true);
    // E o Blob fora do ar dá o mesmo: a cópia do build diz o que o dono ligou.
    expect(montarEtiquetas(c.nacional, "embutido", null).viewLigada("v1")).toBe(true);
  });

  it("publicar.json todo desligado ⇒ cópia do build toda desligada", () => {
    const { nacional } = compilado();
    const e = montarEtiquetas(nacional, "embutido", null);
    for (const v of VISOES) expect(e.viewLigada(v), v).toBe(false);
  });

  it("chave publicada com valor não booleano não liga nada", () => {
    const { nacional } = compilado();
    const estranho = {
      ...nacional,
      publicar: { ...nacional.publicar, v1: "sim" },
    } as unknown as ArquivoNacional;
    expect(montarEtiquetas(estranho, "blob", null).viewLigada("v1")).toBe(false);
  });
});

describe("RF-232 — junção por sqcand normalizado", () => {
  it("number e string dão a MESMA resolução (deputado: sqcand é number no Blob)", () => {
    const r = compilado();
    const e = montarEtiquetas(r.nacional, "embutido", r.ufs.RJ as ArquivoUf);
    const comoTexto = e.resolver(DEP_RJ_UNIAO, 6, 1);
    const comoNumero = e.resolver(Number(DEP_RJ_UNIAO), 6, 1);
    expect(comoNumero).toEqual(comoTexto);
    expect(comoTexto.centrao.estado).toBe("classificado");
  });

  it("normalizarSqcand", () => {
    expect(normalizarSqcand(250002012345)).toBe("250002012345");
    expect(normalizarSqcand(" 250002012345 ")).toBe("250002012345");
    expect(normalizarSqcand(undefined)).toBeNull();
    expect(normalizarSqcand("")).toBeNull();
    expect(normalizarSqcand("abc")).toBeNull();
    expect(normalizarSqcand(1.5)).toBeNull();
    expect(normalizarSqcand(-3)).toBeNull();
  });
});

describe("resolução que a tela recebe", () => {
  it("individual, partido e federação; centrão 'nao' é classificado mas sem rótulo", () => {
    const r = compilado();
    const e = montarEtiquetas(r.nacional, "embutido", r.ufs.SP as ArquivoUf);
    const pt = e.resolver(GOV_SP_PT, 3, 1);
    expect(pt.campo_ideologico.estado).toBe("classificado");
    expect(pt.centrao.estado === "classificado" && pt.centrao.etiqueta.rotulo).toBeNull();
    expect(e.classificadas(GOV_SP_PT, 3, 1).map((x) => x.categoria)).toEqual([
      "campo_ideologico",
      "centrao",
    ]);
    expect(pt.impeachment_stf.estado).toBe("nao_se_aplica");

    const pl = e.resolver(GOV_SP_PL, 3, 1);
    expect(pl.relacao_governo.estado === "classificado" && pl.relacao_governo.etiqueta.origem).toBe(
      "partido",
    );
    const dep = e.resolver(DEP_SP_PL, 6, 1);
    expect(
      dep.relacao_governo.estado === "classificado" && dep.relacao_governo.etiqueta.valor,
    ).toBe("oposicao");
  });

  it("cargo errado não herda nada (sqcand de Governador consultado como Senador)", () => {
    const r = compilado();
    const e = montarEtiquetas(r.nacional, "embutido", null);
    const x = e.resolver(GOV_SP_PL, 5, 1);
    expect(x.relacao_governo.estado).toBe("a_classificar");
    expect(e.resolver(SEN_SP_PL, 5, 1).relacao_governo.estado).toBe("classificado");
  });

  it("deputado sem a UF carregada, sqcand ausente, ou desconhecido ⇒ a_classificar", () => {
    const r = compilado();
    const e = montarEtiquetas(r.nacional, "embutido", null);
    expect(e.resolver(DEP_SP_PL, 6, 1).relacao_governo.estado).toBe("a_classificar");
    expect(e.resolver(undefined, 3, 1).campo_ideologico.estado).toBe("a_classificar");
    expect(e.resolver("123", 3, 1).impeachment_stf.estado).toBe("nao_se_aplica");
  });

  it("senado2031, padrão do partido e da agremiação", () => {
    const r = compilado();
    const e = montarEtiquetas(r.nacional, "embutido", null);
    expect(e.senado2031.disponivel).toBe(true);
    expect(e.senado2031.codigos).toHaveLength(27);
    expect(e.senador2031("5001", 1).impeachment_stf.estado).toBe("classificado");
    expect(e.senador2031(5002, 1).impeachment_stf.estado).toBe("a_classificar");
    expect(e.padraoDoPartido("PP", 1).centrao.estado).toBe("classificado"); // cai na federação UNIÃO/PP
    expect(e.padraoDaAgremiacao("PP", "partido", 1).centrao.estado).toBe("a_classificar"); // sem herança aqui
    expect(e.padraoDaAgremiacao("UNIÃO/PP", "federacao", 1).centrao.estado).toBe("classificado");
  });

  it("valor que o catálogo não conhece (catálogo publicado mais novo) ⇒ a_classificar, sem texto cru", () => {
    const r = compilado();
    const n = structuredClone(r.nacional);
    const reg = n.candidatos[GOV_SP_PT]?.x?.campo_ideologico;
    if (!reg) throw new Error("fixture");
    reg.valor = "valor_do_futuro";
    const e = montarEtiquetas(n, "blob", null);
    expect(e.resolver(GOV_SP_PT, 3, 1).campo_ideologico.estado).toBe("a_classificar");
  });
});

describe("RF-231 — carga com Blob (fetch simulado)", () => {
  const salvo = process.env.BLOB_PUBLIC_BASE_URL;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.BLOB_PUBLIC_BASE_URL = "https://blob.exemplo.test";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (salvo === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
    else process.env.BLOB_PUBLIC_BASE_URL = salvo;
  });

  it("🔴 Blob fora do ar ⇒ cópia do build, sem lançar, chaves desligadas", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const e = await lerEtiquetas({ uf: "SP" });
    expect(e.fonte).toBe("embutido");
    expect(e.viewLigada("chips")).toBe(false);
    expect(e.uf).toBe("SP");
  });

  it("corpo inválido e 404 ⇒ cópia do build", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await lerEtiquetas()).fonte).toBe("embutido");
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect((await lerEtiquetas()).fonte).toBe("embutido");
  });

  it("Blob com versão maior vence e liga as visões publicadas; pede com revalidate 60", async () => {
    const r = compilado();
    const publicado: ArquivoNacional = {
      ...r.nacional,
      meta: { ...r.nacional.meta, versao: 9_999_999_999 },
      publicar: { ...r.nacional.publicar, v3: true },
    };
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/etiquetas/v1/nacional.json")
        ? new Response(JSON.stringify(publicado), { status: 200 })
        : new Response("", { status: 404 }),
    );
    const e = await lerEtiquetas();
    expect(e.fonte).toBe("blob");
    expect(e.viewLigada("v3")).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://blob.exemplo.test/etiquetas/v1/nacional.json",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ next: { revalidate: 60 } });
  });

  it("🔴 Blob pendurado ⇒ o teto corta a espera e vale a cópia do build (sem lançar)", async () => {
    // fetch que só termina quando o signal aborta — um Blob que nunca responde.
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_ok, falha) => {
          init?.signal?.addEventListener("abort", () => falha(init.signal?.reason));
        }),
    );
    const t0 = Date.now();
    const r = await lerJsonDoBlob("etiquetas/v1/nacional.json", isArquivoNacional, {
      timeoutMs: 50,
    });
    expect(r).toEqual({ status: "indisponivel", motivo: "fetch_error" });
    expect(Date.now() - t0).toBeLessThan(2_000);
    // O pedido leva o signal E o revalidate: o Data Cache continua ligado.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { next?: unknown };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.next).toEqual({ revalidate: ETIQUETAS_REVALIDATE_SECONDS });
  });

  it("o teto padrão é curto (≤ 3 s) e a carga inteira cai na cópia do build quando estoura", async () => {
    expect(ETIQUETAS_BLOB_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ETIQUETAS_BLOB_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.reject(init?.signal ? new DOMException("tempo", "TimeoutError") : new Error("x")),
    );
    const e = await lerEtiquetas({ uf: "SP" });
    expect(e.fonte).toBe("embutido");
    expect(e.uf).toBe("SP");
  });

  it("sem Blob configurado nem tenta a rede", async () => {
    delete process.env.BLOB_PUBLIC_BASE_URL;
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    try {
      const e = await lerEtiquetas();
      expect(e.fonte).toBe("embutido");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (token !== undefined) process.env.BLOB_READ_WRITE_TOKEN = token;
    }
  });
});
