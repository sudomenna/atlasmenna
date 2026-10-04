// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-casa-rotas.test.tsx — spec 027 T-18 (RF-281): as
 * cascas de rota `/uf/[sigla]/deputado-estadual`, `/uf/[sigla]/deputado-distrital`
 * e `/uf/[sigla]/deputado-estadual/lista`, com o adaptador e os leitores
 * REAIS — só a borda é simulada: o Global Config (`get` de
 * `@vercel/edge-config`) e o `fetch` do Blob, contando CHAVE e CAMINHO.
 *
 * É a aceitação do RF-281 ao pé da letra: "leu `projection-current-est-t1` e
 * `deputado-estadual/uf/SP.json`, e nada do federal".
 *
 * Mutações aplicadas à mão (30/09, frente U-b) e que estes casos derrubam:
 *   - M24: `lerDadosDaCasa` lendo `readDeputadoProjection(6)` — cai "SP estadual lê só o estadual";
 *   - M25: o `permanentRedirect` do DF removido da casca do estadual — cai "DF → 308";
 *   - M26: `responderListaDeputado` aceitando o DF no 7 — cai "lista do 7 no DF: 404";
 *   - open question 1: o 308 do distrital fora do DF removido — cai "SP distrital → 308".
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UFDeputadoDistritalPage, {
  generateMetadata as metadataDistrital,
  generateStaticParams as paramsDistrital,
} from "@/app/(dep)/uf/[sigla]/deputado-distrital/page";
import { GET as listaEstadual } from "@/app/(dep)/uf/[sigla]/deputado-estadual/lista/route";
import UFDeputadoEstadualPage, {
  generateMetadata as metadataEstadual,
  generateStaticParams as paramsEstadual,
} from "@/app/(dep)/uf/[sigla]/deputado-estadual/page";

const getMock = vi.fn();
const fetchSpy = vi.fn();

vi.mock("@vercel/edge-config", () => ({
  get: (chave: string) => getMock(chave),
}));

const salvo = {
  EDGE_CONFIG: process.env.EDGE_CONFIG,
  BLOB_PUBLIC_BASE_URL: process.env.BLOB_PUBLIC_BASE_URL,
};

beforeEach(() => {
  getMock.mockReset();
  fetchSpy.mockReset();
  // Nada gravado em lugar nenhum: a página cai no "aguardando" — o que se
  // mede aqui é o que ela PEDIU, não o que recebeu.
  getMock.mockResolvedValue(undefined);
  fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
  vi.stubGlobal("fetch", fetchSpy);
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_teste?token=t";
  process.env.BLOB_PUBLIC_BASE_URL = "https://blob.teste";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(salvo)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function params(sigla: string) {
  return { params: Promise.resolve({ sigla }) };
}

function chavesLidas(): string[] {
  return getMock.mock.calls.map((c) => String(c[0]));
}

function urlsLidas(): string[] {
  return fetchSpy.mock.calls.map((c) => String(c[0]));
}

/** O erro de controle que `permanentRedirect`/`notFound` lançam, com o digest do Next. */
async function erroDe(p: Promise<unknown>): Promise<{ digest: string }> {
  try {
    await p;
  } catch (e) {
    return e as { digest: string };
  }
  throw new Error("esperava um redirect ou um 404, e a página renderizou");
}

describe("🔴 M24 — /uf/SP/deputado-estadual lê o estadual, e nada do federal", () => {
  it("chave `projection-current-est-t1`, interruptor `-est`, Blob `deputado-estadual/uf/SP.json`", async () => {
    const pagina = await UFDeputadoEstadualPage(params("SP"));
    renderToStaticMarkup(pagina);

    const chaves = chavesLidas();
    expect(chaves).toContain("projection-current-est-t1");
    expect(chaves).toContain("interruptor-projecao-est");
    expect(chaves.filter((k) => /-dep\b|-dep-/.test(k))).toEqual([]);

    const deputado = urlsLidas().filter((u) => u.includes("deputado"));
    expect(deputado).toEqual(["https://blob.teste/deputado-estadual/uf/SP.json"]);
    expect(urlsLidas().some((u) => u.includes("/deputado/uf/"))).toBe(false);
  });

  it("/uf/DF/deputado-distrital lê `projection-current-dis-t1` e `deputado-distrital/uf/DF.json`", async () => {
    renderToStaticMarkup(await UFDeputadoDistritalPage(params("DF")));
    expect(chavesLidas()).toContain("projection-current-dis-t1");
    expect(chavesLidas()).toContain("interruptor-projecao-est");
    expect(urlsLidas().filter((u) => u.includes("deputado"))).toEqual([
      "https://blob.teste/deputado-distrital/uf/DF.json",
    ]);
  });
});

describe("RF-281 — redirecionamentos e 404, ANTES de qualquer leitura", () => {
  it("🔴 M25 — /uf/DF/deputado-estadual → 308 para /uf/DF/deputado-distrital", async () => {
    const e = await erroDe(UFDeputadoEstadualPage(params("DF")));
    expect(e.digest).toMatch(/^NEXT_REDIRECT;replace;\/uf\/DF\/deputado-distrital;308;/);
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("minúscula também: /uf/df/deputado-estadual → 308", async () => {
    const e = await erroDe(UFDeputadoEstadualPage(params("df")));
    expect(e.digest).toMatch(/\/uf\/DF\/deputado-distrital;308;/);
  });

  it("open question 1 — /uf/SP/deputado-distrital → 308 para /uf/SP/deputado-estadual", async () => {
    const e = await erroDe(UFDeputadoDistritalPage(params("SP")));
    expect(e.digest).toMatch(/^NEXT_REDIRECT;replace;\/uf\/SP\/deputado-estadual;308;/);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("sigla que não existe em casa nenhuma ⇒ 404 nos dois (nunca redirect para o vazio)", async () => {
    for (const pagina of [UFDeputadoEstadualPage, UFDeputadoDistritalPage]) {
      const e = await erroDe(pagina(params("ZZ")));
      expect(e.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    }
    expect(getMock).not.toHaveBeenCalled();
  });

  it("generateStaticParams: 26 sem o DF · só o DF", () => {
    const est = paramsEstadual().map((p) => p.sigla);
    expect(est).toHaveLength(26);
    expect(est).not.toContain("DF");
    expect(paramsDistrital()).toEqual([{ sigla: "DF" }]);
  });

  it("metadata nomeia a casa (RF-284); combinação inexistente ⇒ metadado vazio, sem casa inventada", async () => {
    const sp = await metadataEstadual(params("sp"));
    expect(String(sp.title)).toContain("Assembleia Legislativa de São Paulo");
    expect(String(sp.description)).toContain("Assembleia Legislativa de São Paulo");
    expect(String(sp.title)).not.toContain("Deputado Federal");
    const df = await metadataDistrital(params("DF"));
    expect(String(df.title)).toContain("Câmara Legislativa do Distrito Federal");
    expect(await metadataEstadual(params("DF"))).toEqual({});
    expect(await metadataDistrital(params("SP"))).toEqual({});
  });
});

describe("RF-281 — GET /uf/<UF>/deputado-estadual/lista", () => {
  it("🔴 M26 — DF (sem Assembleia) ⇒ 404 `no-store`, sem tocar o Blob", async () => {
    const res = await listaEstadual(
      new Request("http://x/uf/DF/deputado-estadual/lista"),
      params("DF"),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("SP ⇒ lê `deputado-estadual/uf/SP.json` (nunca o do federal)", async () => {
    // Desde 03/10 a rota do estadual devolve o resto do DOCUMENTO (eleitos +
    // 5, mínimo 10), e o corte sai do objeto da UF — que é lido primeiro. Com
    // ele em 404, o de lista nem é pedido. A costura completa está em
    // `tests/unit/api/deputado-lista-assembleia-route.test.ts`.
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(404); // o Blob simulado responde 404
    // ADR-0076: com o objeto em 404 a rota consulta o cadastro de candidaturas
    // (placar zerado) — que aqui também responde 404, e a rota segue em 404.
    // O primeiro pedido continua sendo o da casa certa, e nenhum é do federal.
    expect(urlsLidas()[0]).toBe("https://blob.teste/deputado-estadual/uf/SP.json");
    expect(urlsLidas().some((u) => u.includes("/deputado/uf/"))).toBe(false);
  });
});
