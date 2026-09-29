// @vitest-environment happy-dom
/**
 * tests/unit/components/visoes-editoriais-paineis.test.tsx — os painéis das
 * visões agregadas da spec 025 (V1, V2, Câmara 2027, V4) como a página os
 * renderiza: fechados ⇒ NADA no HTML; abertos ⇒ o desenho, o texto e o aviso.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exibivelMock = vi.hoisted(() => ({ forcar: false }));
vi.mock("@/lib/etiquetas/catalogo", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/catalogo")>();
  return {
    ...m,
    categoriaExibivel: (c: string) => exibivelMock.forcar || m.categoriaExibivel(c),
  };
});

import { Camara2027Panel } from "@/components/blocks/Camara2027Panel";
import { TEXTO_AVISO_ETIQUETAS } from "@/components/blocks/EtiquetasAviso";
import { SenadoDe2027Panel } from "@/components/blocks/SenadoDe2027Panel";
import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { mandatoDeTeste, payloadTresUfs } from "@/tests/fixtures/senado/payload-senado";

import {
  CODIGOS_2031,
  etiquetasDeTeste,
  relacaoFixa,
  universoDoPayload,
} from "../etiquetas/_visoes-fixtures";

beforeEach(() => {
  exibivelMock.forcar = false;
});

function doc(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

const payload = payloadTresUfs();
const universo = universoDoPayload(payload, 5);

describe("RF-242 — V1 no painel do Senado de 2027", () => {
  it("🔴 chave desligada ⇒ HTML vazio (nem painel, nem 'a classificar')", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa });
    expect(
      renderToStaticMarkup(
        <SenadoDe2027Panel payload={payload} mandato={mandatoDeTeste()} etiquetas={e} />,
      ),
    ).toBe("");
  });

  it("🔴 chave ligada mas portão fechado ⇒ HTML vazio (e uma linha de log)", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = etiquetasDeTeste({
      universo,
      relacaoPorPartido: (s) => (s === "PT" ? null : relacaoFixa(s)),
      ligadas: ["v1"],
    });
    expect(
      renderToStaticMarkup(
        <SenadoDe2027Panel payload={payload} mandato={mandatoDeTeste()} etiquetas={e} />,
      ),
    ).toBe("");
    expect(aviso.mock.calls.flat().join(" ")).toContain("v1 escondida pelo portão");
    aviso.mockRestore();
  });

  it("aberta: título, hemiciclo por bloco com 81, 'governo Lula', aviso com link", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["v1"] });
    const html = renderToStaticMarkup(
      <SenadoDe2027Panel payload={payload} mandato={mandatoDeTeste()} etiquetas={e} />,
    );
    const d = doc(html);
    expect(d.querySelector("#senado-2027-blocos-heading")?.textContent).toBe(
      "Senado de 2027: quem terá maioria",
    );
    expect(
      d.querySelectorAll("[data-testid='hemiciclo-por-bloco-figura'] > svg circle"),
    ).toHaveLength(81);
    expect(html).toContain("governo Lula");
    expect(html).toContain(TEXTO_AVISO_ETIQUETAS);
    expect(d.querySelector("a[href='/sobre-as-etiquetas']")).not.toBeNull();
    expect(html.toLowerCase()).not.toContain("a classificar");
    // V2 fica de fora: sem critério de impeachment publicado.
    expect(d.querySelector("#impeachment-stf-heading")).toBeNull();
  });
});

describe("RF-243 — V2, impeachment", () => {
  function comImpeachment() {
    return etiquetasDeTeste({
      universo,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["v2"],
      linhas: {
        "senado-2031.csv": CODIGOS_2031.map((c, i) => ({
          chave: `senado:${c}`,
          categoria: "impeachment_stf",
          valor: i % 3 === 0 ? "contra" : "a_favor",
          fonte_url: `https://exemplo.org/s/${c}`,
          fonte_descricao: `Declaração pública ${c}`,
        })),
        "senador.csv": universo.map((u) => ({
          chave: u.sqcand,
          categoria: "impeachment_stf",
          valor: "sem_posicao_publica",
        })),
      },
    });
  }

  it("🔴 sem critério publicado ⇒ nada, mesmo com a chave ligada e tudo classificado", () => {
    expect(
      renderToStaticMarkup(
        <SenadoDe2027Panel
          payload={payload}
          mandato={mandatoDeTeste()}
          etiquetas={comImpeachment()}
        />,
      ),
    ).toBe("");
  });

  it("com critério: barra com marca em 54, lista de 81 com fonte, cabeçalho QUALIFICADO", () => {
    exibivelMock.forcar = true;
    const html = renderToStaticMarkup(
      <SenadoDe2027Panel
        payload={payload}
        mandato={mandatoDeTeste()}
        etiquetas={comImpeachment()}
      />,
    );
    const d = doc(html);
    expect(d.querySelector("#impeachment-stf-heading")?.textContent).toBe(
      "Impeachment de ministros do STF no Senado de 2027",
    );
    expect(d.querySelector("[data-testid='impeachment-barra']")?.textContent).toContain("54");
    const linhas = d.querySelectorAll("[data-testid='impeachment-lista'] tbody tr");
    expect(linhas).toHaveLength(81);
    const th = [...d.querySelectorAll("[data-testid='impeachment-lista'] th")].map(
      (t) => t.textContent,
    );
    expect(th).toContain("Posição pública sobre impeachment de ministros do STF");
    expect(d.querySelector("[data-testid='impeachment-placar']")?.textContent).toContain(
      "Posição pública sobre impeachment de ministros do STF: a favor",
    );
    expect(d.querySelector("a[href='https://exemplo.org/s/9001']")?.textContent).toBe(
      "Declaração pública 9001",
    );
    expect(html).toContain("art. 52");
  });
});

describe("RF-244 — Câmara 2027", () => {
  const bancada = {
    total_cadeiras: 10,
    cadeiras_atribuidas: 9,
    ufs_calculadas: 1,
    ufs_aguardando: 26,
    por_agremiacao: [
      { cod: "22", sigla: "PL", tipo: "partido", componentes: [], cadeiras: 5 },
      { cod: "55", sigla: "PSD", tipo: "partido", componentes: [], cadeiras: 4 },
    ],
  } as unknown as EdgeBancadaNacional;
  const universoDep = [
    { sqcand: "250000000001", cargo: 6 as const, uf: "SP", partido: "PL", federacao: null },
    { sqcand: "250000000002", cargo: 6 as const, uf: "SP", partido: "PSD", federacao: null },
  ];

  it("🔴 desligada ⇒ nada", () => {
    const e = etiquetasDeTeste({
      universo: universoDep,
      comFoto: false,
      relacaoPorPartido: relacaoFixa,
    });
    expect(renderToStaticMarkup(<Camara2027Panel bancada={bancada} etiquetas={e} />)).toBe("");
  });

  it("ligada e coberta: plenário por bloco, marcas do TOTAL, lista com fonte, aviso", () => {
    const e = etiquetasDeTeste({
      universo: universoDep,
      comFoto: false,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["camara2027"],
    });
    const d = doc(renderToStaticMarkup(<Camara2027Panel bancada={bancada} etiquetas={e} />));
    expect(d.querySelector("#camara-2027-heading")?.textContent).toBe(
      "Câmara de 2027: quem terá maioria",
    );
    expect(
      d.querySelectorAll("[data-testid='hemiciclo-por-bloco-figura'] > svg circle"),
    ).toHaveLength(10);
    // Limiares de 10 cadeiras (6, 6, 7) — do total, não 257/308/342 cravados.
    expect(
      [...d.querySelectorAll("[data-testid='hemiciclo-bloco-marcas'] > g")].map((g) =>
        g.getAttribute("data-k"),
      ),
    ).toEqual(["6", "6", "7"]);
    expect(
      [...d.querySelectorAll("[data-testid='camara-2027-agremiacoes'] li")].map((l) =>
        l.getAttribute("data-bloco"),
      ),
    ).toEqual(["oposicao", "independente"]);
  });
});
