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
 *
 * 2026-10-03 (spec 008, RF-294): o realce por partido acrescentou o invólucro
 * e um `<style>` com uma regra por partido — 1.663 B de CSS no pior caso
 * (13 grupos). Painel = 17.362 B (17,0 KiB), folga de ~1 KiB. O teto NÃO
 * subiu: é por isso que o CSS tem uma regra por chave, e não três
 * (`lib/utils/realce-hemiciclo.ts`).
 *
 * 🔴 2026-10-04 (dono): o painel passou a desenhar o Senado nas DUAS bases da
 * chave "Parcial / Projeção" (cada uma sob `data-view-only`) — a da Parcial é
 * um segundo hemiciclo completo, com legenda, lista e realce próprios. O
 * custo dobra por construção, e o teto passou a ser POR VERSÃO (18 KiB × 2).
 * O pior caso agora traz `pct_atual` em toda candidatura, para que a versão
 * da Parcial também atribua as 54 vagas (sem `pct_atual` ela sairia quase
 * vazia e o teste mediria menos do que a página pode servir).
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
const TETO_PAINEL_BYTES = 2 * 18 * KIB;

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
      cand(i * 10 + 1, a, 40, { pct_atual: 38 }),
      cand(i * 10 + 2, b, 30, { pct_atual: 31 }),
      cand(i * 10 + 3, "PCO", 5, { pct_atual: 6 }),
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
    // As duas versões estão lá — senão o teto mediria só metade do painel.
    expect((markup.match(/data-testid="senado-hemiciclo-figura"/g) ?? []).length).toBe(2);
    const peso = bytes(markup);
    expect(peso, `painel em ${(peso / KIB).toFixed(1)} KiB`).toBeLessThan(TETO_PAINEL_BYTES);
  });

  it("🔴 o agrupamento por `<g>` existe, e é ele que segura o peso", () => {
    const markup = renderToStaticMarkup(
      <SenadoHemicicloPanel payload={piorCaso()} mandato={MANDATO_2031} />,
    );
    // A primeira figura é a da projeção (a Parcial vem depois, no DOM).
    const svg = markup.slice(markup.indexOf("<svg role"), markup.indexOf("</svg>"));
    const circles = (svg.match(/<circle/g) ?? []).length;
    const grupos = (svg.match(/<g /g) ?? []).length;
    expect(circles).toBe(81);
    expect(grupos, "um <g> por cadeira — o agrupamento se perdeu").toBeLessThan(circles / 1.5);
    expect(svg).not.toMatch(/<circle[^>]*fill=/);
  });
});
