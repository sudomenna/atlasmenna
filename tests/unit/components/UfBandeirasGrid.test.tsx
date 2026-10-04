// @vitest-environment happy-dom
/**
 * tests/unit/components/UfBandeirasGrid.test.tsx — as 27 corridas com bandeira.
 *
 * Desde 2026-10-03 as 27 bandeiras existem, como `<img>` de arquivo estático
 * do próprio site (ADR-0070); o contrato do `<UfFlag>` em si (sigla
 * desconhecida ⇒ nada, tamanho dos arquivos) está em `UfFlag.test.tsx`.
 *
 * O fio condutor é que a grade **não pode perder dado**. Ela substituiu uma
 * lista textual que carregava maior bancada, empates, vagas sem candidato
 * elegível e placar de cadeiras; trocar isso por um ícone bonito é o defeito
 * que o ADR-0017 nomeia.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UfBandeirasGrid } from "@/components/blocks/UfBandeirasGrid";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

const resumos = {
  SP: { detalhe: "maior bancada: PL (19)", vagas: "70 de 70" },
  RR: { detalhe: "aguardando apuração", vagas: "vagas não publicadas" },
};

describe("UfBandeirasGrid — os 27 estados, sempre", () => {
  it("renderiza 27 links, inclusive os que não estão no payload", () => {
    // Geografia é identidade e fala; progresso de apuração é medição e cala.
    // Um estado ausente da grade se lê como estado que não elege ninguém.
    const doc = parse(<UfBandeirasGrid cargo={6} resumos={resumos} />);
    expect(doc.querySelectorAll('[data-testid="corrida-uf"]')).toHaveLength(27);
  });

  it("estado sem linha no payload diz que aguarda — nunca um zero (RF-124)", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} resumos={resumos} />);
    const ac = doc.querySelector('[data-uf="AC"]');
    expect(ac?.textContent).toContain("aguardando apuração");
    expect(ac?.textContent).toContain("vagas não publicadas");
    expect(ac?.textContent, "imprimiu um placar que ninguém mediu").not.toMatch(/\b0 de 0\b/);
  });

  // 🔴 MUTAÇÃO: apagar `resumos` do componente e deixar só bandeira + sigla —
  // que é literalmente o que o plano desta tarefa pedia ("27 links com bandeira
  // + sigla"). O teste morre: o dado que a lista anterior carregava sumiu.
  it("não perde nenhum dado que a lista de texto carregava", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} resumos={resumos} />);
    const sp = doc.querySelector('[data-uf="SP"]');
    expect(sp?.textContent).toContain("maior bancada: PL (19)");
    expect(sp?.querySelector('[data-testid="corrida-vagas"]')?.textContent).toBe("70 de 70");
    expect(doc.querySelector('[data-uf="RR"] [data-testid="corrida-vagas"]')?.textContent).toBe(
      "vagas não publicadas",
    );
  });

  it("o destino do link sai da tabela canônica de cargos, não de literal", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} resumos={resumos} />);
    expect(doc.querySelector('[data-uf="SP"]')?.getAttribute("href")).toBe(
      "/uf/SP/deputado-federal",
    );
    // Cargo 3 muda o slug — se o componente cravasse a rota, isto não mudaria.
    const gov = parse(<UfBandeirasGrid cargo={3} />);
    expect(gov.querySelector('[data-uf="SP"]')?.getAttribute("href")).toBe("/uf/SP/governador");
  });
});

describe("UfBandeirasGrid — a bandeira é acréscimo, o rótulo continua texto", () => {
  // 🔴 MUTAÇÃO (2026-10-03): tirar o `<UfFlag>` do item — (a) morre. Trocar o
  // `src` por um caminho que não existe — (a) morre no `src`.
  it("(a) um `<img>` decorativo por item, apontando para o arquivo da própria UF", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} resumos={resumos} />);
    expect(doc.querySelectorAll("img")).toHaveLength(27);
    const sp = doc.querySelector('[data-uf="SP"] img');
    expect(sp?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    expect(sp?.getAttribute("alt")).toBe("");
    expect(sp?.getAttribute("loading")).toBe("lazy");
    // O sprite `<symbol>` (até 2026-10-03) saiu inteiro: nada de `<svg>`/`<use>`.
    expect(doc.querySelectorAll("svg, use, symbol")).toHaveLength(0);
  });

  it("(b) com `ufs` filtrado, só as UFs mostradas ganham bandeira", () => {
    const doc = parse(<UfBandeirasGrid cargo={7} ufs={["SP", "RJ"]} />);
    const srcs = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs.sort()).toEqual(["/bandeiras/RJ.webp", "/bandeiras/SP.webp"]);
  });

  it("(c) nome por extenso e sigla continuam em TEXTO, nos 27", () => {
    // É isto que reconcilia a grade com RF-162/163: o rótulo é texto. A
    // bandeira é reconhecimento, não informação — por isso `alt=""`.
    const doc = parse(<UfBandeirasGrid cargo={6} />);
    const ac = doc.querySelector('[data-uf="AC"]');
    expect(ac?.textContent).toContain("Acre");
    expect(ac?.textContent).toContain("AC");
    expect(ac?.getAttribute("aria-label")).toBe("Acre (AC)");
    expect(doc.querySelector('[data-uf="SP"]')?.textContent).toContain("São Paulo");
  });
});
