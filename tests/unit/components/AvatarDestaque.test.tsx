// @vitest-environment happy-dom
/**
 * tests/unit/components/AvatarDestaque.test.tsx — decisão do dono de 04/10:
 * "na capa dos deputados precisa trazer o avatar dos candidatos também".
 *
 * As duas listas nacionais das capas `/deputado-federal` e
 * `/deputado-estadual` — "Mais votados do país" (`<DeputadoMaisVotados
 * escopo="pais">`) e "Puxadores de voto" (`<DeputadoPuxadores>`) — põem a
 * mini-foto em TODA linha, com a URL derivada de `(uf, sqcand)` pelo
 * construtor único (`candidatoFotoUrl`): a capa não lê Blob (RF-271/RF-273).
 *
 * Casos que derrubam a regra:
 *   - com Blob: uma `<img>` por linha, URL da UF DO CANDIDATO (não da capa),
 *     decorativa (`alt=""` + `aria-hidden`), 28×28, `lazy`, sem `style`, com a
 *     mesma classe do avatar da lista de UF;
 *   - sem Blob: as iniciais no mesmo círculo, uma por linha;
 *   - o avatar vem ANTES do nome, dentro da célula do nome — a coluna do
 *     avatar é a única mudança da linha (posição e votos intactos).
 *
 * Mutação aplicada à mão (04/10): tirar o `<AvatarDestaque>` de
 * `<DeputadoPuxadores>` reprova os casos de puxadores; trocar o ramo `noPais`
 * do `<DeputadoMaisVotados>` por `<AvatarEleito>` (a regra antiga) reprova os
 * casos de mais votados.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AvatarDestaque } from "@/components/blocks/AvatarDestaque";
import { AVATAR_ELEITO_PX, AvatarEleito } from "@/components/blocks/AvatarEleito";
import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoPuxadores } from "@/components/blocks/DeputadoPuxadores";
import type { EdgeDeputadoDestaque, EdgeDeputadoPuxador } from "@/lib/edge-config/types";
import { BIT_MARCA } from "@/lib/utils/deputado-marcas";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import federal from "@/tests/fixtures/simulacao/deputado.json" with { type: "json" };
import estadual from "@/tests/fixtures/simulacao/deputado-estadual.json" with { type: "json" };

const BASE = "https://exemplo.public.blob.vercel-storage.com";
const ORIGINAL_BASE = process.env.BLOB_PUBLIC_BASE_URL;
const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function comBlob() {
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
}
function semBlob() {
  delete process.env.BLOB_PUBLIC_BASE_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
}

beforeEach(comBlob);
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

const urlFoto = (uf: string, sq: number) => `${BASE}/candidatos/foto/${uf}/${sq}.jpg`;

const FED_MV = federal.mais_votados as unknown as EdgeDeputadoDestaque[];
const FED_PX = federal.puxadores as unknown as EdgeDeputadoPuxador[];
const EST_MV = estadual.mais_votados as unknown as EdgeDeputadoDestaque[];
const EST_PX = estadual.puxadores as unknown as EdgeDeputadoPuxador[];

/** A classe que a lista de UF usa — tirada do próprio `<AvatarEleito>`. */
function classeDoAvatarDaUf(): string {
  const d = doc(<AvatarEleito nome="X Y" sqcand={1} marcas={BIT_MARCA.PARCIAL} fotos={{}} />);
  const cls = d.querySelector('[data-testid="candidate-avatar-fallback"]')?.getAttribute("class");
  // O fallback acrescenta utilitários de flex; a classe do módulo é a última.
  return (cls ?? "").split(" ").at(-1) ?? "";
}

describe("<AvatarDestaque> — o átomo da capa", () => {
  it("com Blob ⇒ <img> decorativa 28×28, lazy, sem style, URL de (uf, sqcand)", () => {
    const d = doc(<AvatarDestaque nome="Fulana Tal" uf="MG" sqcand={130002345678} />);
    const img = d.querySelector("img");
    expect(img?.getAttribute("src")).toBe(urlFoto("MG", 130002345678));
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("width")).toBe(String(AVATAR_ELEITO_PX));
    expect(img?.getAttribute("height")).toBe(String(AVATAR_ELEITO_PX));
    expect(img?.hasAttribute("style")).toBe(false);
    // Mesmo círculo da lista de UF: a mesma classe do módulo.
    expect(img?.getAttribute("class")).toBe(classeDoAvatarDaUf());
  });

  it("sem Blob ⇒ iniciais decorativas no mesmo círculo, nenhuma <img>", () => {
    semBlob();
    const d = doc(<AvatarDestaque nome="Fulana Tal" uf="MG" sqcand={130002345678} />);
    expect(d.querySelector("img")).toBeNull();
    const fb = d.querySelector('[data-testid="candidate-avatar-fallback"]');
    expect(fb?.textContent).toBe("FT");
    expect(fb?.getAttribute("aria-hidden")).toBe("true");
    expect(fb?.getAttribute("class")).toContain(classeDoAvatarDaUf());
  });
});

type Caso = {
  capa: string;
  cargo: 6 | 7;
  maisVotados: EdgeDeputadoDestaque[];
  puxadores: EdgeDeputadoPuxador[];
};
const CAPAS: Caso[] = [
  { capa: "/deputado-federal", cargo: 6, maisVotados: FED_MV, puxadores: FED_PX },
  { capa: "/deputado-estadual", cargo: 7, maisVotados: EST_MV, puxadores: EST_PX },
];

/** Cada linha: o avatar é o 1º filho da célula do nome, com a URL da UF da linha. */
function confereLinhas(
  d: Document,
  testid: string,
  linhas: readonly EdgeDeputadoDestaque[],
  modo: "foto" | "iniciais",
) {
  const lis = [...d.querySelectorAll(`[data-testid='${testid}'] > li`)];
  expect(lis).toHaveLength(linhas.length);
  lis.forEach((li, i) => {
    const l = linhas[i];
    if (!l) throw new Error("linha ausente");
    const primeiro = li.querySelector(":scope > span:nth-child(2) > :first-child");
    expect(li.querySelectorAll('[data-testid^="candidate-avatar"]')).toHaveLength(1);
    if (modo === "foto") {
      expect(primeiro?.tagName).toBe("IMG");
      expect(primeiro?.getAttribute("src")).toBe(urlFoto(l.uf, l.sqcand));
    } else {
      expect(primeiro?.getAttribute("data-testid")).toBe("candidate-avatar-fallback");
      expect(primeiro?.textContent).toMatch(/^[A-ZÀ-Ý?]{1,2}$/u);
    }
    // O nome vem logo depois, intacto; a posição e os votos não mudaram de célula.
    expect(primeiro?.nextElementSibling?.tagName).toBe("B");
    expect(primeiro?.nextElementSibling?.textContent).toBe(nomeExibicao(l.nome, String(l.sqcand)));
    expect(li.querySelector(":scope > span:first-child")?.textContent).toBe(`${i + 1}º`);
    expect(li.children).toHaveLength(3);
  });
}

describe.each(CAPAS)("capa $capa", ({ cargo, maisVotados, puxadores }) => {
  it("os dados de teste cobrem as duas listas, e de mais de uma UF", () => {
    expect(maisVotados.length).toBe(10);
    expect(puxadores.length).toBeGreaterThan(0);
    expect(new Set([...maisVotados, ...puxadores].map((l) => l.uf)).size).toBeGreaterThan(1);
  });

  it("Mais votados do país — foto em toda linha, da UF de cada candidato", () => {
    const d = doc(
      <DeputadoMaisVotados cargo={cargo} escopo="pais" linhas={maisVotados} titleId="mv" />,
    );
    confereLinhas(d, "dep-mais-votados-pais", maisVotados, "foto");
  });

  it("Mais votados do país — sem Blob, iniciais em toda linha", () => {
    semBlob();
    const d = doc(
      <DeputadoMaisVotados cargo={cargo} escopo="pais" linhas={maisVotados} titleId="mv" />,
    );
    expect(d.querySelector("img")).toBeNull();
    confereLinhas(d, "dep-mais-votados-pais", maisVotados, "iniciais");
  });

  it("Puxadores de voto — foto em toda linha, da UF de cada candidato", () => {
    const d = doc(<DeputadoPuxadores cargo={cargo} puxadores={puxadores} titleId="px" />);
    confereLinhas(d, "dep-puxadores-pais", puxadores, "foto");
  });

  it("Puxadores de voto — sem Blob, iniciais em toda linha", () => {
    semBlob();
    const d = doc(<DeputadoPuxadores cargo={cargo} puxadores={puxadores} titleId="px" />);
    expect(d.querySelector("img")).toBeNull();
    confereLinhas(d, "dep-puxadores-pais", puxadores, "iniciais");
  });
});

describe("a página de UF NÃO muda", () => {
  it("<DeputadoMaisVotados escopo='uf'> continua só com a regra de eleito", () => {
    const linhas = FED_MV.map((l) => ({ ...l, marcas: 0 }));
    const d = doc(
      <DeputadoMaisVotados
        cargo={6}
        escopo="uf"
        uf="SP"
        linhas={linhas}
        fotos={Object.fromEntries(linhas.map((l) => [String(l.sqcand), urlFoto(l.uf, l.sqcand)]))}
        titleId="mv"
      />,
    );
    // Ninguém eleito ⇒ nenhum avatar, mesmo com o mapa cheio.
    expect(d.querySelectorAll('[data-testid^="candidate-avatar"]')).toHaveLength(0);
  });

  it("puxadores vazios: nenhum avatar, a frase de vazio continua", () => {
    const d = doc(<DeputadoPuxadores cargo={6} puxadores={[]} titleId="px" />);
    expect(d.querySelectorAll('[data-testid^="candidate-avatar"]')).toHaveLength(0);
    expect(d.querySelector("[data-testid='dep-puxadores-vazio']")).not.toBeNull();
  });
});
