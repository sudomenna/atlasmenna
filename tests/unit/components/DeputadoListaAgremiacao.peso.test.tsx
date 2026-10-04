// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoListaAgremiacao.peso.test.tsx — spec 026
 * (RF-277, RNF-002/RNF-003), ADR-0065 D5, design 026 § 10.
 *
 * O peso que as listas põem no documento de `/uf/SP/deputado-federal`, medido
 * ANTES do portão e2e (que precisa do Blob servido, frente T). O teto da
 * página é 480 KiB de documento; as listas são a maior parte dele.
 *
 * O documento carrega cada linha DUAS vezes, por construção do App Router: o
 * HTML que o servidor renderiza e o payload RSC com as props do componente
 * cliente (as tuplas), embutido como string num `<script>`. Os dois somam.
 *
 * 🔴 **Pior caso de CADA campo, não amostra** (regra de medição de 21/09: a
 * amostra aleatória mentiu três vezes). ~1.000 linhas em 17 agremiações
 * (16 × 60 + 40 — o que SP pode ter no documento: 60 por agremiação), todas
 * federação (a coluna de partido existe), nome de urna de 30 caracteres com
 * acentos (cada acentuado são 2 bytes em UTF-8), número de urna de 5 dígitos,
 * votos de 7 dígitos, % com 5 casas, e 70 linhas com as duas marcas
 * (parcial + projeção, com via e "apertada").
 *
 * O teto daqui (360 KiB para listas, HTML + RSC) deixa 120 KiB para o resto
 * da página dentro dos 480 KiB. Se estourar, o conserto é no markup da linha —
 * não no número deste teste (ADR-0065: teto muda por ADR).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import { BIT_MARCA, type LinhaCompacta } from "@/lib/utils/deputado-marcas";

const KIB = 1024;
/**
 * Teto das listas no documento de SP: HTML + payload RSC das tuplas.
 *
 * 360 → **384 KiB** em 03/10 — decisão do dono, 03/10: avatares dos eleitos
 * (spec 026 RF-291), com a instrução expressa de não se preocupar com o peso.
 * Medido neste pior caso: 343,4 KiB sem as fotos, **368,2 KiB** com as 69
 * linhas eleitas levando `<img>` no HTML e a URL no RSC (+24,8 KiB, ~368 B por
 * eleito). A folga que sobra (~16 KiB) é a mesma ordem da de antes.
 *
 * 04/10 — spec 026 RF-297 (decisão do dono: voto projetado nos eleitos + 7):
 * **379,2 KiB** medido neste pior caso, com 188 linhas levando "projeção ≈
 * 999 mil · não oficial" (+11,0 KiB, ~60 B por linha entre HTML e RSC). Cabe
 * no teto de 384 KiB sem mexer nele; a folga cai para ~4,8 KiB.
 *
 * 04/10 — emenda "eleitos + 7" (decisão do dono: o visível por padrão deixa de
 * ser 1–20 e passa a ser maior rank eleito + 7): as linhas no documento são as
 * MESMAS (1–60); muda só quem leva `data-f=""` (10 B) e quais agremiações
 * pequenas ganham o botão "Mais N". Neste pior caso: 379,2 → **380,7 KiB**
 * (+1,5 KiB — as 14 agremiações sem eleito recolhem do 8º em vez do 21º).
 * Folga ~3,3 KiB.
 */
const TETO_LISTAS_BYTES = 384 * KIB;

/** 30 caracteres, 10 deles acentuados — o nome de urna mais pesado plausível. */
const NOME_PIOR = "JOÃO CONCEIÇÃO MAGALHÃES ÁVILA";

/**
 * Spec 026 RF-297 — o voto projetado no pior caso de bytes: "999 mil" é o
 * texto compacto mais longo (7 caracteres; "1,2 mi" tem 6) e 999.499 tem 6
 * dígitos no RSC — "999 mil" + 6 dígitos empata com "1,2 mi" + 7 dígitos.
 */
const VOTOS_PROJ_PIOR = 999_499;
/** Decisão do dono, 04/10: maior rank eleito + 7, por agremiação (o visível por padrão). */
const NAO_ELEITOS_COM_PROJ = 7;

function agremiacao(i: number, n: number): DeputadoListaAgremiacaoProps {
  const marcadas = i < 3 ? 23 : 0; // 69 linhas com as duas marcas
  const linhas: LinhaCompacta[] = Array.from({ length: n }, (_, k) => {
    const rank = k + 1;
    const marcada = rank <= marcadas;
    const marcas = marcada
      ? BIT_MARCA.PARCIAL |
        BIT_MARCA.PARCIAL_SOBRA |
        BIT_MARCA.PARCIAL_APERTADA |
        BIT_MARCA.PROJECAO |
        BIT_MARCA.PROJECAO_SOBRA |
        BIT_MARCA.PROJECAO_APERTADA
      : 0;
    const base = [
      rank,
      10_002_630_000 + i * 100 + rank,
      NOME_PIOR,
      "PC do B",
      99_999,
      1_234_567,
      12.34567,
      marcas,
      0,
    ] as const;
    // Eleitos + 7 levam a posição 9 (69 + 17 × 7 = 188 linhas).
    return rank <= marcadas + NAO_ELEITOS_COM_PROJ ? [...base, VOTOS_PROJ_PIOR] : base;
  });
  return {
    uf: "SP",
    cod: String(10 + i),
    sigla: "PT/PC do B/PV",
    linhas,
    totalCandidatos: n + 11,
    haListaRestante: true,
    rotaLista: "/uf/SP/deputado-federal/lista",
    corte: {
      ultimoEleito: linhas[22]?.[1] ?? 0,
      primeiroFora: 0,
      diferenca: 1_234_567,
      abaixoPiso10: true,
    },
    totalizacaoFinal: false,
    projecaoVisivel: true,
    mostrarPartido: true,
    tsDetalhe: "2026-10-04T23:41:07.312Z",
    // Spec 026 RF-291 (decisão do dono, 03/10: avatares dos eleitos) — os 69
    // eleitos com foto, URL do store real (host de 16 caracteres + `sqcand` de
    // 12 dígitos): o pior caso de cada linha eleita é a `<img>` no HTML e a
    // URL no RSC.
    fotos: Object.fromEntries(
      linhas
        .filter((l) => (l[7] & BIT_MARCA.PARCIAL) !== 0)
        .map((l) => [
          String(l[1]),
          `https://jbtu251tioj3y57z.public.blob.vercel-storage.com/candidatos/foto/SP/25000${l[1]}.jpg`,
        ]),
    ),
  };
}

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

describe("peso das listas de SP no documento (RF-277, ADR-0065 D5)", () => {
  const listas = [...Array.from({ length: 16 }, (_, i) => agremiacao(i, 60)), agremiacao(16, 40)];
  const totalLinhas = listas.reduce((s, p) => s + p.linhas.length, 0);

  it("~1.000 linhas no pior caso cabem no teto das listas (HTML + RSC)", () => {
    expect(totalLinhas).toBe(1000);
    // RF-297 — o pior caso inclui o voto projetado nas 188 linhas "eleitos + 7".
    expect(listas.flatMap((p) => p.linhas).filter((l) => l[9] !== undefined)).toHaveLength(188);
    const html = listas
      .map((p) => renderToStaticMarkup(<DeputadoListaAgremiacao {...p} />))
      .join("");
    // O payload RSC leva as props serializadas; no documento ele vai como
    // string JS, com as aspas escapadas — `JSON.stringify` duas vezes é a
    // aproximação conservadora disso.
    const rsc = listas.map((p) => JSON.stringify(JSON.stringify(p))).join("");
    const bHtml = bytes(html);
    const bRsc = bytes(rsc);
    // Registro do que foi medido — o relatório da frente U cita estes números.
    console.info(
      `[peso SP] linhas=${totalLinhas} html=${(bHtml / KIB).toFixed(1)}KiB rsc=${(bRsc / KIB).toFixed(1)}KiB total=${((bHtml + bRsc) / KIB).toFixed(1)}KiB teto=${TETO_LISTAS_BYTES / KIB}KiB por_linha_html=${(bHtml / totalLinhas).toFixed(0)}B`,
    );
    expect(bHtml + bRsc).toBeLessThanOrEqual(TETO_LISTAS_BYTES);
  });

  it("a linha não carrega classe de CSS nem estilo inline (o peso que o módulo evita)", () => {
    const html = renderToStaticMarkup(<DeputadoListaAgremiacao {...agremiacao(5, 60)} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const linhas = [...doc.querySelectorAll("li[data-rank]")];
    expect(linhas).toHaveLength(60);
    for (const l of linhas) {
      expect(l.hasAttribute("class")).toBe(false);
      expect(l.hasAttribute("style")).toBe(false);
      for (const filho of l.querySelectorAll(
        ":scope > span, :scope > span > b, :scope > span > small",
      )) {
        expect(filho.hasAttribute("class")).toBe(false);
        expect(filho.hasAttribute("style")).toBe(false);
      }
    }
  });
});
