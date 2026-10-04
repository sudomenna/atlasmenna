import { describe, expect, it } from "vitest";
import {
  buscarFeeds,
  decodificarCorpo,
  extrairItensRss,
  FEEDS,
  type FonteFeed,
  filtrarRelevantes,
  mesclarManchetes,
} from "@/lib/leitura/feeds";
import type { Manchete } from "@/lib/leitura/types";

const G1: FonteFeed = { id: "g1-politica", veiculo: "G1", url: "https://g1.example/rss" };
const GN: FonteFeed = {
  id: "google-news",
  veiculo: "Google Notícias",
  url: "https://gn.example/rss",
};

function rss(itens: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>${itens}</channel></rss>`;
}

describe("extrairItensRss", () => {
  it("trata CDATA, entidades nomeadas e numéricas e remove tags do título", () => {
    const xml = rss(`
      <item>
        <title><![CDATA[Apuração <b>avança</b> &amp; TSE divulga &#8220;boletim&#8221;]]></title>
        <link>https://g1.globo.com/politica/a.ghtml</link>
        <pubDate>Sun, 04 Oct 2026 20:10:00 -0300</pubDate>
      </item>
      <item>
        <title>Candidato diz &quot;ok&quot; &#x2019; &lt;i&gt;&aacute;rea&lt;/i&gt; &lt; 50%</title>
        <link>https://g1.globo.com/politica/b.ghtml</link>
        <dc:date>2026-10-04T23:15:00Z</dc:date>
      </item>`);
    const itens = extrairItensRss(xml, G1);
    expect(itens).toHaveLength(2);
    expect(itens[0]).toEqual({
      titulo: "Apuração avança & TSE divulga “boletim”",
      link: "https://g1.globo.com/politica/a.ghtml",
      veiculo: "G1",
      publicado_em: "2026-10-04T23:10:00.000Z",
      feed: "g1-politica",
    });
    expect(itens[1]?.titulo).toBe('Candidato diz "ok" ’ área < 50%');
    expect(itens[1]?.publicado_em).toBe("2026-10-04T23:15:00.000Z");
  });

  it("data inválida vira null", () => {
    const xml = rss(
      `<item><title>Eleição</title><link>https://a.example/x</link><pubDate>ontem</pubDate></item>`,
    );
    expect(extrairItensRss(xml, G1)[0]?.publicado_em).toBeNull();
  });

  it("recusa link que não é http(s)", () => {
    const xml = rss(`
      <item><title>Eleição 1</title><link>javascript:alert(1)</link></item>
      <item><title>Eleição 2</title><link>data:text/html,oi</link></item>
      <item><title>Eleição 3</title><link>ftp://a.example/x</link></item>
      <item><title>Eleição 4</title><link>http://a.example/ok</link></item>`);
    const itens = extrairItensRss(xml, G1);
    expect(itens.map((i) => i.titulo)).toEqual(["Eleição 4"]);
    expect(itens[0]?.link).toBe("http://a.example/ok");
  });

  it("Google News: veículo sai do sufixo do título (ou de <source>)", () => {
    const xml = rss(`
      <item><title>Lula e Flávio votam pela manhã - Folha de S.Paulo</title>
        <link>https://news.google.com/rss/articles/abc</link><pubDate>Sun, 04 Oct 2026 12:00:00 GMT</pubDate></item>
      <item><title>Apuração começa às 17h - Estadão</title>
        <link>https://news.google.com/rss/articles/def</link><source url="https://www.estadao.com.br">Estadão</source></item>`);
    const itens = extrairItensRss(xml, GN);
    expect(itens.map((i) => [i.titulo, i.veiculo])).toEqual([
      ["Lula e Flávio votam pela manhã", "Folha de S.Paulo"],
      ["Apuração começa às 17h", "Estadão"],
    ]);
  });
});

describe("decodificarCorpo", () => {
  // "Eleição" em ISO-8859-1: ç = 0xE7, ã = 0xE3
  const latin1 = (prefixo: string) => {
    const head = new TextEncoder().encode(prefixo);
    const corpo = new Uint8Array([0x45, 0x6c, 0x65, 0x69, 0xe7, 0xe3, 0x6f]);
    const out = new Uint8Array(head.length + corpo.length);
    out.set(head);
    out.set(corpo, head.length);
    return out.buffer;
  };

  it("usa o charset do content-type", () => {
    expect(decodificarCorpo(latin1(""), "text/xml; charset=ISO-8859-1")).toBe("Eleição");
  });

  it("sem charset no header, usa a declaração XML", () => {
    const s = decodificarCorpo(latin1('<?xml version="1.0" encoding="ISO-8859-1"?>'), "text/xml");
    expect(s.endsWith("Eleição")).toBe(true);
  });

  it("sem nenhum dos dois, utf-8", () => {
    const bytes = new TextEncoder().encode("Eleição").buffer;
    expect(decodificarCorpo(bytes as ArrayBuffer, null)).toBe("Eleição");
  });
});

describe("filtrarRelevantes", () => {
  const m = (titulo: string, publicado_em: string | null): Manchete => ({
    titulo,
    link: `https://a.example/${encodeURIComponent(titulo)}`,
    veiculo: "G1",
    publicado_em,
    feed: "g1-politica",
  });
  const desde = new Date("2026-10-04T20:00:00Z");

  it("casa por termo (sem acento, sem caixa) e por termo extra; corta antigo e sem data", () => {
    const itens = [
      m("APURAÇÃO chega a 50%", "2026-10-04T22:00:00Z"),
      m("Receita de bolo", "2026-10-04T22:00:00Z"),
      m("Bolsonaro vota no Rio", "2026-10-04T22:00:00Z"),
      m("Eleição: fila nas seções", "2026-10-04T19:59:59Z"),
      m("Eleição sem data", null),
      m("Eleição no limite", "2026-10-04T20:00:00Z"),
    ];
    expect(filtrarRelevantes(itens, { desde }).map((i) => i.titulo)).toEqual([
      "APURAÇÃO chega a 50%",
      "Eleição no limite",
    ]);
    expect(
      filtrarRelevantes(itens, { desde, termosExtras: ["BOLSONARO", ""] }).map((i) => i.titulo),
    ).toEqual(["APURAÇÃO chega a 50%", "Bolsonaro vota no Rio", "Eleição no limite"]);
  });
});

describe("mesclarManchetes", () => {
  const m = (titulo: string, link: string, publicado_em: string | null): Manchete => ({
    titulo,
    link,
    veiculo: "G1",
    publicado_em,
    feed: "g1-politica",
  });

  it("descarta repetidos por link e por título normalizado, ordena e corta", () => {
    const existentes = [m("Apuração chega a 10%", "https://a/1", "2026-10-04T21:00:00Z")];
    const novas = [
      m("Outro título", "https://a/1", "2026-10-04T23:00:00Z"), // link repetido
      m("APURACAO chega a 10% !", "https://b/9", "2026-10-04T23:00:00Z"), // título repetido
      m("Sem data", "https://c/1", null),
      m("Mais nova", "https://c/2", "2026-10-04T22:00:00Z"),
    ];
    expect(mesclarManchetes(existentes, novas).map((x) => x.titulo)).toEqual([
      "Mais nova",
      "Apuração chega a 10%",
      "Sem data",
    ]);
    expect(mesclarManchetes(existentes, novas, 1).map((x) => x.titulo)).toEqual(["Mais nova"]);
  });

  it("corta em 20 por padrão", () => {
    const muitas = Array.from({ length: 30 }, (_, i) =>
      m(`Eleição ${i}`, `https://a/${i}`, new Date(Date.UTC(2026, 9, 4, 20, i)).toISOString()),
    );
    expect(mesclarManchetes([], muitas)).toHaveLength(20);
  });
});

describe("buscarFeeds", () => {
  it("um feed com erro, outro que estoura o prazo, e o terceiro entra", async () => {
    const fontes: FonteFeed[] = [
      { id: "ok", veiculo: "OK", url: "https://ok.example/rss" },
      { id: "erro", veiculo: "Erro", url: "https://erro.example/rss" },
      { id: "lento", veiculo: "Lento", url: "https://lento.example/rss" },
      { id: "http500", veiculo: "500", url: "https://500.example/rss" },
      { id: "html", veiculo: "HTML", url: "https://html.example/rss" },
    ];
    const vistos: Array<{ url: string; ua: string | null }> = [];
    const fetchFalso = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      vistos.push({ url, ua: new Headers(init?.headers).get("user-agent") });
      if (url.includes("erro")) throw new TypeError("fetch failed");
      if (url.includes("lento")) {
        return new Promise<Response>((_, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        });
      }
      if (url.includes("500")) return new Response("x", { status: 500 });
      if (url.includes("html"))
        return new Response("<html><body>oi</body></html>", { status: 200 });
      return new Response(
        rss(
          `<item><title>Eleição</title><link>https://ok.example/a</link><pubDate>Sun, 04 Oct 2026 20:10:00 -0300</pubDate></item>`,
        ),
        { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" } },
      );
    }) as typeof fetch;

    const r = await buscarFeeds(fetchFalso, { timeoutMs: 50, fontes });
    expect(r.porFeed).toEqual({
      ok: 1,
      erro: "erro",
      lento: "erro",
      http500: "erro",
      html: "erro",
    });
    expect(r.itens.map((i) => [i.feed, i.titulo])).toEqual([["ok", "Eleição"]]);
    expect(vistos.every((v) => v.ua === "AtlasMenna/1.0 (+https://www.atlasmenna.online)")).toBe(
      true,
    );
  });

  it("não espera para sempre um fetch que ignora o sinal", async () => {
    const travado = (() => new Promise<Response>(() => {})) as typeof fetch;
    const r = await buscarFeeds(travado, { timeoutMs: 30, fontes: [G1] });
    expect(r).toEqual({ itens: [], porFeed: { "g1-politica": "erro" } });
  });

  it("FEEDS tem 10 fontes http(s) com ids únicos", () => {
    expect(FEEDS).toHaveLength(10);
    expect(new Set(FEEDS.map((f) => f.id)).size).toBe(10);
    for (const f of FEEDS) expect(f.url).toMatch(/^https:\/\//);
  });
});
