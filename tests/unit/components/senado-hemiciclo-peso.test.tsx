// @vitest-environment happy-dom
/**
 * tests/unit/components/senado-hemiciclo-peso.test.tsx — spec 023, RF-218 (f).
 *
 * Irmão de `camara-hemiciclo-peso.test.tsx`, pelo mesmo motivo: o hemiciclo é
 * zero JavaScript, então os orçamentos de RNF-007 (que somam `script`) não o
 * enxergam. O custo é HTML servido em toda visita a `/senador`.
 *
 * O pior caso medido: a foto REAL de 29/09 (`editorial/senado/`) e as 27 UFs
 * com vaga atribuída, partidos alternando entre 12 siglas e UFs alternando
 * entre concluída e projetada — o máximo de trechos (`<g>`) que a página pode
 * produzir, e a lista textual mais longa.
 *
 * Medição de 2026-09-29 (`renderToStaticMarkup`, UTF-8, sem compressão):
 * painel inteiro no pior caso = 15.641 B (15,3 KiB); teto 18 KiB (18.432 B,
 * ~18% de folga).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SenadoHemicicloPanel } from "@/components/blocks/SenadoHemiciclo";
import { MANDATO_2031, UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import { cand, payloadSenado, ufRow } from "@/tests/fixtures/senado/payload-senado";

const KIB = 1024;

/**
 * Teto do painel (título, texto, hemiciclo, legenda, lista, nota da foto).
 * Pega as duas regressões prováveis: perder o agrupamento por `<g>` (+~70 B
 * por cadeira ⇒ ~21,3 KiB) e um `<title>` por bolinha (+~40 B × 81 ⇒
 * ~18,4 KiB, no limite — por isso a folga é curta de propósito).
 */
const TETO_PAINEL_BYTES = 18 * KIB;

const SIGLAS = [
  "PL",
  "PT",
  "PSD",
  "MDB",
  "PP",
  "UNIÃO",
  "REPUBLICANOS",
  "PSB",
  "PDT",
  "PODE",
  "PSDB",
  "NOVO",
];

function piorCaso() {
  const contagem = new Map<string, number>();
  const rows = UFS_DO_SENADO.map((uf, i) => {
    const a = SIGLAS[i % SIGLAS.length] as string;
    const b = SIGLAS[(i + 5) % SIGLAS.length] as string;
    for (const s of [a, b]) contagem.set(s, (contagem.get(s) ?? 0) + 1);
    return ufRow(uf, i % 2 === 0 ? 100 : 55, [
      cand(i * 10 + 1, a, 40),
      cand(i * 10 + 2, b, 30),
      cand(i * 10 + 3, "PCO", 5),
    ]);
  });
  return payloadSenado(
    rows,
    [...contagem.entries()].map(([partido, vagas]) => ({ partido, vagas })),
  );
}

function bytes(markup: string): number {
  return Buffer.byteLength(markup, "utf8");
}

describe("SenadoHemiciclo — peso do markup (o gate que o RNF-007 não dá)", () => {
  it("o pior caso cabe no teto", () => {
    const markup = renderToStaticMarkup(
      <SenadoHemicicloPanel payload={piorCaso()} mandato={MANDATO_2031} />,
    );
    expect(markup.length, "o painel não foi desenhado — o caso não mede nada").toBeGreaterThan(
      1000,
    );
    const peso = bytes(markup);
    expect(peso, `painel em ${(peso / KIB).toFixed(1)} KiB`).toBeLessThan(TETO_PAINEL_BYTES);
  });

  it("🔴 o agrupamento por `<g>` existe, e é ele que segura o peso", () => {
    const markup = renderToStaticMarkup(
      <SenadoHemicicloPanel payload={piorCaso()} mandato={MANDATO_2031} />,
    );
    const svg = markup.slice(markup.indexOf("<svg role"), markup.indexOf("</svg>"));
    const circles = (svg.match(/<circle/g) ?? []).length;
    const grupos = (svg.match(/<g /g) ?? []).length;
    expect(circles).toBe(81);
    expect(grupos, "um <g> por cadeira — o agrupamento se perdeu").toBeLessThan(circles / 1.5);
    expect(svg).not.toMatch(/<circle[^>]*fill=/);
  });
});
