// @vitest-environment happy-dom
/**
 * tests/unit/components/AvatarEleito.test.tsx — spec 026 RF-291 (decisão do
 * dono de 03/10): a mini-foto ao lado do nome SÓ de quem está sendo eleito,
 * nas páginas de UF de Deputado Federal, Estadual e Distrital.
 *
 * Três camadas, cada uma com o caso que a derruba:
 *
 *   1. `fotosDosEleitos` (servidor) — só eleito COM `foto_ok` entra no mapa, e
 *      a URL é a do construtor único (`candidatoFotoUrl`);
 *   2. `<AvatarEleito>` (a regra) — sem mapa: nada; não eleito: nada; projeção
 *      sozinha: nada; eleito na parcial ou pelo TSE: foto, ou iniciais quando o
 *      `sqcand` não está no mapa;
 *   3. as duas listas — `<DeputadoListaAgremiacao>` e `<DeputadoMaisVotados>` —
 *      põem o avatar nas linhas eleitas e em NENHUMA outra; sem `fotos`
 *      (a capa nacional) nada muda.
 *
 * Mutação aplicada à mão (03/10): `ehEleitoNosBits` devolvendo `true` para o
 * bit de PROJEÇÃO (`BIT_MARCA.PARCIAL | BIT_MARCA.PROJECAO | BIT_MARCA.TSE`)
 * derruba "projeção sozinha não ganha avatar" e o caso da lista.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AVATAR_ELEITO_PX, AvatarEleito } from "@/components/blocks/AvatarEleito";
import { DeputadoListaAgremiacao } from "@/components/blocks/DeputadoListaAgremiacao";
import {
  DeputadoMaisVotados,
  type LinhaMaisVotados,
} from "@/components/blocks/DeputadoMaisVotados";
import { fotosDosEleitos } from "@/lib/deputado/fotos-eleitos";
import { BIT_MARCA, ehEleitoNosBits, type LinhaCompacta } from "@/lib/utils/deputado-marcas";

const BASE = "https://exemplo.public.blob.vercel-storage.com";
const ORIGINAL_BASE = process.env.BLOB_PUBLIC_BASE_URL;
const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
});
afterEach(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
  else process.env.BLOB_PUBLIC_BASE_URL = ORIGINAL_BASE;
  if (ORIGINAL_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
});

function doc(el: React.ReactElement): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = renderToStaticMarkup(el);
  return d;
}

const PARCIAL = BIT_MARCA.PARCIAL;
const PARCIAL_E_PROJECAO = BIT_MARCA.PARCIAL | BIT_MARCA.PROJECAO;
const SO_PROJECAO = BIT_MARCA.PROJECAO | BIT_MARCA.PROJECAO_SOBRA;
const TSE = BIT_MARCA.TSE | BIT_MARCA.TSE_QP;

const urlFoto = (uf: string, sq: number) => `${BASE}/candidatos/foto/${uf}/${sq}.jpg`;

describe("ehEleitoNosBits — quem conta como 'sendo eleito'", () => {
  it("parcial e TSE contam; projeção sozinha e nenhuma marca não", () => {
    expect(ehEleitoNosBits(PARCIAL)).toBe(true);
    expect(ehEleitoNosBits(PARCIAL_E_PROJECAO)).toBe(true);
    expect(ehEleitoNosBits(TSE)).toBe(true);
    expect(ehEleitoNosBits(SO_PROJECAO)).toBe(false);
    expect(ehEleitoNosBits(0)).toBe(false);
  });
});

describe("fotosDosEleitos — o mapa que o servidor manda", () => {
  it("só eleito com foto_ok entra, com a URL do construtor único", () => {
    const fotos = fotosDosEleitos(
      "SP",
      [
        [250002553928, PARCIAL], // eleito, com foto
        [250002553929, PARCIAL], // eleito, sem foto_ok
        [250002553930, 0], // não eleito, com foto
        [250002553931, SO_PROJECAO], // só projeção, com foto
        [250002553932, TSE], // eleito pelo TSE, com foto
      ],
      new Set(["250002553928", "250002553930", "250002553931", "250002553932"]),
    );
    expect(fotos).toEqual({
      "250002553928": urlFoto("SP", 250002553928),
      "250002553932": urlFoto("SP", 250002553932),
    });
  });

  it("ambiente sem Blob ⇒ mapa vazio (iniciais), nunca URL quebrada", () => {
    delete process.env.BLOB_PUBLIC_BASE_URL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(fotosDosEleitos("SP", [[250002553928, PARCIAL]], new Set(["250002553928"]))).toEqual({});
  });
});

describe("<AvatarEleito> — a regra", () => {
  const sq = 250002553928;
  const fotos = { [String(sq)]: urlFoto("SP", sq) };
  const html = (marcas: number, f: Record<string, string> | undefined, s = sq) =>
    renderToStaticMarkup(<AvatarEleito nome="Fulana Tal" sqcand={s} marcas={marcas} fotos={f} />);

  it("eleito com foto ⇒ <img> decorativa, 28×28, lazy, com a URL do mapa", () => {
    const d = doc(<AvatarEleito nome="Fulana Tal" sqcand={sq} marcas={PARCIAL} fotos={fotos} />);
    const img = d.querySelector("img");
    expect(img?.getAttribute("src")).toBe(urlFoto("SP", sq));
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("width")).toBe(String(AVATAR_ELEITO_PX));
    expect(img?.getAttribute("height")).toBe(String(AVATAR_ELEITO_PX));
    // Nenhum `style` por linha — e nunca a cor da agremiação.
    expect(img?.hasAttribute("style")).toBe(false);
  });

  it("eleito pelo TSE (totalização final) também ganha", () => {
    expect(html(TSE, fotos)).toContain("<img");
  });

  it("eleito sem foto no mapa ⇒ iniciais no mesmo círculo", () => {
    const d = doc(<AvatarEleito nome="Fulana Tal" sqcand={sq} marcas={PARCIAL} fotos={{}} />);
    expect(d.querySelector("img")).toBeNull();
    const fb = d.querySelector('[data-testid="candidate-avatar-fallback"]');
    expect(fb?.textContent).toBe("FT");
    expect(fb?.getAttribute("aria-hidden")).toBe("true");
  });

  it("não eleito, ou só na projeção ⇒ nada, mesmo com foto no mapa", () => {
    expect(html(0, fotos)).toBe("");
    expect(html(SO_PROJECAO, fotos)).toBe("");
  });

  it("sem mapa (capa nacional) ⇒ nada, mesmo eleito", () => {
    expect(html(PARCIAL, undefined)).toBe("");
  });
});

describe("as listas — avatar nas linhas eleitas e em nenhuma outra", () => {
  const linha = (rank: number, sq: number, nome: string, marcas: number): LinhaCompacta =>
    [rank, sq, nome, "", 10_000 + rank, 50_000 - rank, 5.5 - rank / 10, marcas, 0] as const;
  const linhas: LinhaCompacta[] = [
    linha(1, 101, "Ana Primeira", PARCIAL_E_PROJECAO),
    linha(2, 102, "Bruno Segundo", PARCIAL),
    linha(3, 103, "Carla Terceira", SO_PROJECAO),
    linha(4, 104, "Davi Quarto", 0),
  ];
  const props = {
    uf: "SP",
    cod: "22",
    sigla: "PL",
    linhas,
    totalCandidatos: 4,
    haListaRestante: false,
    rotaLista: null,
    totalizacaoFinal: false,
    projecaoVisivel: true,
    mostrarPartido: false,
    tsDetalhe: "2026-10-04T21:00:00Z",
  };

  it("<DeputadoListaAgremiacao> com fotos: 101 foto, 102 iniciais, 103 e 104 nada", () => {
    const d = doc(<DeputadoListaAgremiacao {...props} fotos={{ "101": urlFoto("SP", 101) }} />);
    const li = (sq: number) =>
      [...d.querySelectorAll("li[data-rank]")].find((el) =>
        el.textContent?.includes(linhas.find((l) => l[1] === sq)?.[2] ?? "?"),
      );
    expect(li(101)?.querySelector("img")?.getAttribute("src")).toBe(urlFoto("SP", 101));
    expect(li(102)?.querySelector("img")).toBeNull();
    expect(li(102)?.querySelector('[data-testid="candidate-avatar-fallback"]')?.textContent).toBe(
      "BS",
    );
    for (const sq of [103, 104]) {
      expect(li(sq)?.querySelector('[data-testid^="candidate-avatar"]')).toBeNull();
    }
    // O avatar vem ANTES do nome, dentro da célula do nome.
    expect(li(101)?.querySelector("span:nth-child(2) > :first-child")?.tagName).toBe("IMG");
  });

  it("<DeputadoListaAgremiacao> sem fotos: nenhuma linha muda (zero avatares)", () => {
    const d = doc(<DeputadoListaAgremiacao {...props} />);
    expect(d.querySelectorAll('[data-testid^="candidate-avatar"]')).toHaveLength(0);
  });

  const destaque = (sq: number, nome: string, marcas: number): LinhaMaisVotados => ({
    uf: "SP",
    sqcand: sq,
    nome,
    partido: "PL",
    cod: "22",
    sigla: "PL",
    numero: 2222,
    votos: 100_000 - sq,
    pct_validos: 1.5,
    marcas,
  });
  const top = [
    destaque(201, "Eva Eleita", PARCIAL),
    destaque(202, "Fabio Fora", 0),
    destaque(203, "Gil Projetado", SO_PROJECAO),
  ];

  it("<DeputadoMaisVotados> na UF com fotos: só a eleita tem avatar", () => {
    const d = doc(
      <DeputadoMaisVotados
        cargo={7}
        escopo="uf"
        uf="SP"
        linhas={top}
        fotos={{ "201": urlFoto("SP", 201) }}
        titleId="t"
      />,
    );
    const avatares = d.querySelectorAll('[data-testid^="candidate-avatar"]');
    expect(avatares).toHaveLength(1);
    expect(avatares[0]?.getAttribute("src")).toBe(urlFoto("SP", 201));
    expect(avatares[0]?.closest("li")?.getAttribute("data-rank")).toBe("1");
  });

  it("<DeputadoMaisVotados> no país: a regra de eleito NÃO vale — toda linha tem avatar (04/10)", () => {
    // A capa não tem marca de eleito; desde a decisão do dono de 04/10 ela
    // põe o avatar em todas as linhas (`<AvatarDestaque>`). O detalhe está em
    // `AvatarDestaque.test.tsx`.
    const d = doc(<DeputadoMaisVotados cargo={6} escopo="pais" linhas={top} titleId="t" />);
    expect(d.querySelectorAll('[data-testid^="candidate-avatar"]')).toHaveLength(top.length);
  });
});
