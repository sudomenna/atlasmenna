/**
 * lib/leitura/feeds.ts
 *
 * Manchetes da "leitura da noite" (ADR-0072): busca feeds RSS públicos de
 * veículos e devolve só título, veículo, hora e link — nunca o texto da
 * matéria.
 *
 * Sem dependência nova: o extrator RSS é mínimo e feito à mão (regex sobre
 * blocos `<item>`). As funções de parse são PURAS; só `buscarFeeds` faz rede,
 * e pelo `fetchFn` que recebe (o teste passa um falso). `buscarFeeds` nunca
 * lança e nunca espera mais que o prazo por feed.
 */

import { type Manchete, NOTICIAS_MAX } from "./types";

export interface FonteFeed {
  id: string;
  veiculo: string;
  url: string;
}

const GOOGLE_NEWS_ID = "google-news";

export const FEEDS: readonly FonteFeed[] = [
  { id: "g1-politica", veiculo: "G1", url: "https://g1.globo.com/rss/g1/politica/" },
  {
    id: "folha-emcimadahora",
    veiculo: "Folha",
    url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
  },
  {
    id: "estadao-politica",
    veiculo: "Estadão",
    url: "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/",
  },
  { id: "uol-noticias", veiculo: "UOL", url: "https://rss.uol.com.br/feed/noticias.xml" },
  { id: "poder360", veiculo: "Poder360", url: "https://www.poder360.com.br/feed/" },
  { id: "cnn-brasil", veiculo: "CNN Brasil", url: "https://www.cnnbrasil.com.br/feed/" },
  {
    id: "agencia-brasil",
    veiculo: "Agência Brasil",
    url: "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml",
  },
  {
    id: "bbc-brasil",
    veiculo: "BBC News Brasil",
    url: "https://feeds.bbci.co.uk/portuguese/rss.xml",
  },
  { id: "metropoles", veiculo: "Metrópoles", url: "https://www.metropoles.com/feed" },
  {
    id: GOOGLE_NEWS_ID,
    // Fallback: o veículo real sai de `<source>` ou do sufixo " - Veículo" do título.
    veiculo: "Google Notícias",
    url: "https://news.google.com/rss/search?q=apura%C3%A7%C3%A3o+elei%C3%A7%C3%A3o+2026&hl=pt-BR&gl=BR&ceid=BR:pt-419",
  },
];

const USER_AGENT = "AtlasMenna/1.0 (+https://www.atlasmenna.online)";
const TIMEOUT_PADRAO_MS = 4000;

// ---------------------------------------------------------------------------
// Decodificação do corpo
// ---------------------------------------------------------------------------

function decoderPara(label: string | null | undefined): TextDecoder {
  if (label) {
    try {
      return new TextDecoder(label.trim().toLowerCase());
    } catch {
      // rótulo desconhecido → utf-8
    }
  }
  return new TextDecoder("utf-8");
}

/**
 * Charset do `content-type`; senão o da declaração `<?xml ... encoding="...">`
 * (lida nos primeiros bytes como latin1); senão utf-8.
 */
export function decodificarCorpo(bytes: ArrayBuffer, contentType: string | null): string {
  const doHeader = contentType ? /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1] : null;
  if (doHeader) return decoderPara(doHeader).decode(bytes);
  const cabeca = new TextDecoder("latin1").decode(bytes.slice(0, 512));
  const doXml = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(cabeca)?.[1];
  return decoderPara(doXml).decode(bytes);
}

// ---------------------------------------------------------------------------
// Texto: CDATA, entidades, tags
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  middot: "·",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  ccedil: "ç",
  Ccedil: "Ç",
};
// Vogais acentuadas: &aacute; &Atilde; &ecirc; ... (forma nomeada usual em feeds HTML-ish).
for (const [sufixo, combinante] of [
  ["acute", "́"],
  ["grave", "̀"],
  ["circ", "̂"],
  ["tilde", "̃"],
  ["uml", "̈"],
] as const) {
  for (const v of ["a", "e", "i", "o", "u", "A", "E", "I", "O", "U", "n", "N"]) {
    ENTIDADES[`${v}${sufixo}`] = `${v}${combinante}`.normalize("NFC");
  }
}

function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (todo, corpo: string) => {
    if (corpo[0] === "#") {
      const n =
        corpo[1] === "x" || corpo[1] === "X"
          ? Number.parseInt(corpo.slice(2), 16)
          : Number.parseInt(corpo.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
        return todo;
      return String.fromCodePoint(n);
    }
    return ENTIDADES[corpo] ?? todo;
  });
}

/** Conteúdo textual de um elemento: tira CDATA, decodifica entidades, remove tags HTML. */
function textoLimpo(bruto: string): string {
  let t = bruto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = decodificarEntidades(t);
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  // 2ª passada: feeds que escapam duas vezes (`&amp;quot;`).
  t = decodificarEntidades(t);
  return t.replace(/\s+/g, " ").trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lerTag(bloco: string, nome: string): string | null {
  const re = new RegExp(
    `<${escaparRegex(nome)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaparRegex(nome)}>`,
    "i",
  );
  const m = re.exec(bloco);
  return m ? (m[1] as string) : null;
}

/** Só http(s); devolve a URL normalizada (esquema em minúsculas) ou null. */
function linkSeguro(bruto: string | null): string | null {
  if (!bruto) return null;
  const t = textoLimpo(bruto);
  try {
    const u = new URL(t);
    const ok = u.protocol === "http:" || u.protocol === "https:";
    return ok ? u.href : null;
  } catch {
    return null;
  }
}

function dataIso(bruto: string | null): string | null {
  if (!bruto) return null;
  const ms = Date.parse(textoLimpo(bruto));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

export function extrairItensRss(xml: string, fonte: FonteFeed): Manchete[] {
  const out: Manchete[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const bloco = m[1] as string;
    let titulo = textoLimpo(lerTag(bloco, "title") ?? "");
    const link = linkSeguro(lerTag(bloco, "link")) ?? linkSeguro(lerTag(bloco, "guid"));
    if (!titulo || !link) continue;

    let veiculo = fonte.veiculo;
    if (fonte.id === GOOGLE_NEWS_ID) {
      const fonteTag = textoLimpo(lerTag(bloco, "source") ?? "");
      const corte = titulo.lastIndexOf(" - ");
      if (fonteTag) {
        veiculo = fonteTag;
        if (titulo.endsWith(` - ${fonteTag}`)) {
          titulo = titulo.slice(0, -(fonteTag.length + 3)).trim();
        }
      } else if (corte > 0) {
        const sufixo = titulo.slice(corte + 3).trim();
        if (sufixo) {
          veiculo = sufixo;
          titulo = titulo.slice(0, corte).trim();
        }
      }
      if (!titulo) continue;
    }

    out.push({
      titulo,
      link,
      veiculo,
      publicado_em: dataIso(lerTag(bloco, "pubDate") ?? lerTag(bloco, "dc:date")),
      feed: fonte.id,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filtro e mesclagem
// ---------------------------------------------------------------------------

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const RELEVANTE = /eleic|apurac|urna|tse|presiden|turno|voto|candidat|governad|senad/;

export function filtrarRelevantes(
  itens: Manchete[],
  opts: { desde: Date; termosExtras?: string[] },
): Manchete[] {
  const desdeMs = opts.desde.getTime();
  const extras = (opts.termosExtras ?? []).map((t) => normalizar(t).trim()).filter(Boolean);
  return itens.filter((it) => {
    if (it.publicado_em === null) return false;
    const ms = Date.parse(it.publicado_em);
    if (!Number.isFinite(ms) || ms < desdeMs) return false;
    const t = normalizar(it.titulo);
    return RELEVANTE.test(t) || extras.some((e) => t.includes(e));
  });
}

function chaveTitulo(s: string): string {
  return normalizar(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Junta manchetes guardadas e novas. Repetido por link OU por título
 * normalizado: fica a primeira ocorrência (as existentes vêm antes). Ordena
 * da mais nova para a mais antiga (sem data no fim) e corta em `max`.
 */
export function mesclarManchetes(
  existentes: Manchete[],
  novas: Manchete[],
  max: number = NOTICIAS_MAX,
): Manchete[] {
  const links = new Set<string>();
  const titulos = new Set<string>();
  const unicas: Manchete[] = [];
  for (const m of [...existentes, ...novas]) {
    const ct = chaveTitulo(m.titulo);
    if (links.has(m.link) || (ct && titulos.has(ct))) continue;
    links.add(m.link);
    if (ct) titulos.add(ct);
    unicas.push(m);
  }
  const ms = (m: Manchete) => {
    const v = m.publicado_em ? Date.parse(m.publicado_em) : Number.NaN;
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  };
  return unicas
    .map((m, i) => ({ m, i, t: ms(m) }))
    .sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1))
    .slice(0, Math.max(0, max))
    .map((x) => x.m);
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`prazo de ${ms} ms estourado`)), ms);
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(timer));
}

async function buscarUm(fetchFn: typeof fetch, fonte: FonteFeed, timeoutMs: number) {
  const res = await fetchFn(fonte.url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = decodificarCorpo(await res.arrayBuffer(), res.headers.get("content-type"));
  if (!/<(rss|channel|rdf:RDF)\b/i.test(xml)) throw new Error("corpo não é RSS");
  return extrairItensRss(xml, fonte);
}

/**
 * Busca todos os feeds em paralelo. Um feed que falha (rede, status não-2xx,
 * prazo, corpo que não é RSS) vira `"erro"` em `porFeed` e não derruba os
 * outros. Nunca lança.
 */
export async function buscarFeeds(
  fetchFn: typeof fetch,
  opts?: { timeoutMs?: number; fontes?: readonly FonteFeed[] },
): Promise<{ itens: Manchete[]; porFeed: Record<string, number | "erro"> }> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const fontes = opts?.fontes ?? FEEDS;
  const itens: Manchete[] = [];
  const porFeed: Record<string, number | "erro"> = {};
  try {
    const resultados = await Promise.allSettled(
      fontes.map((f) => comPrazo(buscarUm(fetchFn, f, timeoutMs), timeoutMs + 250)),
    );
    resultados.forEach((r, i) => {
      const f = fontes[i] as FonteFeed;
      if (r.status === "fulfilled") {
        porFeed[f.id] = r.value.length;
        itens.push(...r.value);
      } else {
        porFeed[f.id] = "erro";
      }
    });
  } catch {
    // allSettled não rejeita; guarda para o "nunca lança" valer mesmo assim.
  }
  return { itens, porFeed };
}
