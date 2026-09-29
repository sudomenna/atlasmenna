// @vitest-environment happy-dom
/**
 * tests/unit/components/etiquetas-peso.test.tsx — o custo em HTML dos chips
 * editoriais nos cartões das capas (spec 025, RF-245). Zero JavaScript: o
 * custo é markup, e nenhum orçamento de RNF-007 enxerga HTML — por isso o teto
 * mora aqui (mesmo raciocínio do teste de peso do hemiciclo).
 *
 * Pior caso: as QUATRO linhas do cartão com chance, as cinco categorias de
 * chip classificadas e exibíveis (critério publicado forçado por mock — hoje
 * só duas têm critério). Na capa de /governador são 27 cartões.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/etiquetas/catalogo", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/catalogo")>();
  return { ...m, categoriaExibivel: () => true };
});

import { GovernorCard } from "@/components/blocks/GovernorCard";
import { CATEGORIAS_CHIP } from "@/lib/etiquetas/catalogo";
import type { Resolucao } from "@/lib/etiquetas/resolver";
import type { ResolucoesExibiveis } from "@/lib/etiquetas/telas";
import { cand, ufRow } from "@/tests/fixtures/senado/payload-senado";

const KIB = 1024;

/** Teto do ACRÉSCIMO por cartão, no pior caso — × 27 na capa. */
const TETO_ACRESCIMO_POR_CARTAO = 5 * KIB;

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

const valor: Record<string, string> = {
  campo_ideologico: "centro_esquerda",
  palanque_presidencial: "palanque_flavio_bolsonaro",
  relacao_governo: "base_governo",
  centrao: "sim",
  trajetoria_cargo: "tenta_reeleicao",
};

function todas(): ResolucoesExibiveis {
  const out: ResolucoesExibiveis = {};
  for (const c of CATEGORIAS_CHIP) {
    out[c] = {
      estado: "classificado",
      etiqueta: {
        categoria: c,
        valor: valor[c] as string,
        rotulo: "x",
        origem: "partido",
        chave_origem: "partido:X",
        fonte_url: "https://x",
        fonte_descricao: "x",
        data: "2026-09-29",
      },
    } as Resolucao;
  }
  return out;
}

describe("peso dos chips no cartão de UF", () => {
  it(`pior caso (4 linhas × ${CATEGORIAS_CHIP.length} chips + tokens): acréscimo < 5 KiB por cartão`, () => {
    const row = ufRow("MG", 50, [
      cand(10, "REPUBLICANOS", 30),
      cand(20, "PL", 29),
      cand(30, "PSD", 28),
      cand(40, "MDB", 27),
    ]);
    const semChips = bytes(renderToStaticMarkup(<GovernorCard uf={row} candidatos={[]} />));
    const porSqcand = new Map(row.top_candidatos.map((c) => [c.sqcand as string, todas()]));
    const comChips = bytes(
      renderToStaticMarkup(
        <GovernorCard
          uf={row}
          candidatos={[]}
          etiquetas={{
            porSqcand,
            tokens:
              "campo_ideologico:centro_esquerda palanque_presidencial:palanque_flavio_bolsonaro relacao_governo:base_governo centrao:sim trajetoria_cargo:tenta_reeleicao",
          }}
        />,
      ),
    );
    const acrescimo = comChips - semChips;
    expect(acrescimo, `acréscimo ${(acrescimo / KIB).toFixed(2)} KiB`).toBeLessThan(
      TETO_ACRESCIMO_POR_CARTAO,
    );
    expect(acrescimo).toBeGreaterThan(0);
  });
});
