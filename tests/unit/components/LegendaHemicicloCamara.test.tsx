// @vitest-environment happy-dom
/**
 * tests/unit/components/LegendaHemicicloCamara.test.tsx — a legenda compacta do
 * plenário da Câmara (spec 008, RF-294): mesma ordem das cunhas, só quem tem
 * cadeira, sigla inteira, mesma cor das cadeiras, `aria-hidden`, e o teto de
 * peso da legenda + `<style>` do realce.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CamaraHemiciclo } from "@/components/blocks/CamaraHemiciclo";
import {
  agremiacoesDaLegenda,
  LegendaHemicicloCamara,
} from "@/components/blocks/LegendaHemicicloCamara";
import { RealceHemiciclo } from "@/components/blocks/RealceHemiciclo";
import type { EdgeAgremiacaoBancada, EdgeBancadaNacional } from "@/lib/edge-config/types";
import { textForParty } from "@/lib/utils/party-color";
import depSim from "@/tests/fixtures/simulacao/deputado.json" with { type: "json" };

const KIB = 1024;
const bancadaSim = (depSim as unknown as { bancada: EdgeBancadaNacional }).bancada;

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

function legenda(bancada: EdgeBancadaNacional) {
  return parse(renderToStaticMarkup(<LegendaHemicicloCamara bancada={bancada} />));
}

describe("RF-294 — <LegendaHemicicloCamara>", () => {
  it("🔴 mesma ordem das cunhas do plenário (a ordem dos `data-cod` nos <g>)", () => {
    // Entrada EMBARALHADA: a ordem da saída não pode depender dela.
    const embaralhada = {
      ...bancadaSim,
      por_agremiacao: [...bancadaSim.por_agremiacao].reverse(),
    };
    const plenario = parse(renderToStaticMarkup(<CamaraHemiciclo bancada={embaralhada} />));
    const cunhas: string[] = [];
    for (const g of plenario.querySelectorAll("svg g[data-cod]")) {
      const cod = g.getAttribute("data-cod") ?? "";
      if (cunhas[cunhas.length - 1] !== cod) cunhas.push(cod);
    }
    const linhas = [...legenda(embaralhada).querySelectorAll("li")].map((li) =>
      li.getAttribute("data-cod"),
    );
    expect(cunhas.length).toBe(11);
    expect(linhas).toEqual(cunhas);
  });

  it("só quem tem cadeira — as 11 agremiações de 22 da fixture", () => {
    const doc = legenda(bancadaSim);
    expect(doc.querySelectorAll("li")).toHaveLength(11);
    expect(doc.querySelector('li[data-cod="36"]')).toBeNull(); // AGIR, 0 cadeiras
    expect(agremiacoesDaLegenda(bancadaSim).every((a) => a.cadeiras > 0)).toBe(true);
  });

  it("sigla INTEIRA e o número de cadeiras", () => {
    const doc = legenda(bancadaSim);
    const fe = doc.querySelector('li[data-cod="13"]');
    expect(fe?.textContent).toBe("PT/PC do B/PV120");
    const prd = doc.querySelector('li[data-cod="25"]');
    expect(prd?.textContent).toBe("PRD/SOLIDARIEDADE3");
  });

  it("a bolinha tem a cor das cadeiras dela: textForParty(sigla_lider)", () => {
    const plenario = parse(renderToStaticMarkup(<CamaraHemiciclo bancada={bancadaSim} />));
    const doc = legenda(bancadaSim);
    for (const agr of agremiacoesDaLegenda(bancadaSim)) {
      const bolinha = doc.querySelector(`li[data-cod="${agr.cod}"] > span`) as HTMLElement | null;
      const cor = textForParty(agr.sigla_lider);
      expect(bolinha?.getAttribute("style") ?? "").toContain(cor);
      const g = plenario.querySelector(`g[data-estado="definida"][data-cod="${agr.cod}"]`);
      expect(g?.getAttribute("fill")).toBe(cor);
    }
  });

  it("`aria-hidden` — o equivalente textual é `#bancada-agremiacoes`, não esta lista", () => {
    const ul = legenda(bancadaSim).querySelector("ul");
    expect(ul?.getAttribute("aria-hidden")).toBe("true");
  });

  it("sem cadeira atribuída, não desenha nada", () => {
    const vazia = {
      ...bancadaSim,
      por_agremiacao: bancadaSim.por_agremiacao.map((a) => ({ ...a, cadeiras: 0 })),
    };
    expect(renderToStaticMarkup(<LegendaHemicicloCamara bancada={vazia} />)).toBe("");
  });
});

/**
 * Teto da legenda + `<style>` do realce da Câmara, no pior caso: as 22
 * agremiações da fixture TODAS com cadeira, sigla longa e código de federação
 * (`fed:NNN`). É HTML servido em toda visita a `/deputado-federal`, e o Next o
 * escreve duas vezes no documento (HTML + payload RSC).
 *
 * Medição de 2026-10-03 (`renderToStaticMarkup`, UTF-8, classes com o
 * tamanho de produção): pior caso = 6.023 B (5,9 KiB), dos quais 2.721 B são o
 * `<style>`; fixture do simulado (11 agremiações) = 2.741 B. Teto 8 KiB.
 */
const TETO_LEGENDA_E_REALCE_BYTES = 8 * KIB;

function piorCaso(): EdgeBancadaNacional {
  const por_agremiacao: EdgeAgremiacaoBancada[] = bancadaSim.por_agremiacao.map((a, i) => ({
    ...a,
    cod: `fed:${100 + i}`,
    sigla: `${a.sigla}/SOLIDARIEDADE`.slice(0, 28),
    sigla_lider: "SOLIDARIEDADE",
    cadeiras: 23 - i,
  }));
  return { ...bancadaSim, por_agremiacao };
}

/**
 * Em produção a classe de módulo CSS sai como
 * `LegendaHemicicloCamara-module__xxxxxx__lista` (~45 B); no Vitest, como
 * `_lista_abc123`. O peso é medido com cada classe trocada por 45 caracteres,
 * para o teto valer para o que é servido.
 */
function comClasseDeProducao(markup: string): string {
  return markup.replace(
    /class="([^"]*)"/g,
    (_, c: string) =>
      `class="${c
        .split(" ")
        .map(() => "x".repeat(45))
        .join(" ")}"`,
  );
}

function legendaERealce(bancada: EdgeBancadaNacional): string {
  return comClasseDeProducao(
    renderToStaticMarkup(
      <RealceHemiciclo
        raiz="camara"
        atributo="data-cod"
        chaves={agremiacoesDaLegenda(bancada).map((a) => a.cod)}
      >
        <LegendaHemicicloCamara bancada={bancada} />
      </RealceHemiciclo>,
    ),
  );
}

describe("RF-294 — peso da legenda + realce da Câmara", () => {
  it("o pior caso (22 agremiações, siglas longas, federações) cabe no teto", () => {
    const markup = legendaERealce(piorCaso());
    expect(parse(markup).querySelectorAll("li")).toHaveLength(22);
    const peso = Buffer.byteLength(markup, "utf8");
    expect(peso, `legenda + realce em ${(peso / KIB).toFixed(1)} KiB`).toBeLessThan(
      TETO_LEGENDA_E_REALCE_BYTES,
    );
  });

  it("a fixture do simulado cabe com folga", () => {
    const peso = Buffer.byteLength(legendaERealce(bancadaSim), "utf8");
    expect(peso).toBeLessThan(TETO_LEGENDA_E_REALCE_BYTES / 2);
  });
});
