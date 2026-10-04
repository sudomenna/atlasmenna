// @vitest-environment happy-dom
/**
 * ADR-0045 item 7 — o exterior (sigla `ZZ` do TSE) aparece ao leitor como
 * "Exterior", nunca como "ZZ", e os contadores do Presidente passam a 28.
 * `UF_NOMES` NÃO ganha o exterior (ele alimenta seletores de Governador/Senador).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NOME_EXTERIOR,
  nomeDaUnidade,
  rotuloDaUnidade,
  UF_NOMES,
} from "@/components/atoms/maps/_shared";
import { ApuracaoMeta } from "@/components/blocks/ApuracaoMeta";
import { StateGroupedTable } from "@/components/blocks/StateGroupedTable";
import { unidadesDeApuracao } from "@/lib/config/cargos";
import type { EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

const mkRow = (sigla: string, lider: number, margem: number): EdgeUfRow => ({
  sigla,
  pct_apurado: 30,
  lider,
  margem_atual: margem,
  margem_projetada: margem,
  margem_projetada_ci: [margem - 2, margem + 2],
  chamada: false,
  swing_vs_2022: 1,
  top_candidatos: [
    { id: lider, pct: 50 + margem / 2 },
    { id: lider === 13 ? 22 : 13, pct: 50 - margem / 2 },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
});

describe("nomeDaUnidade / rotuloDaUnidade", () => {
  it("ZZ vira 'Exterior' (qualquer caixa); UFs seguem como antes", () => {
    expect(nomeDaUnidade("ZZ")).toBe(NOME_EXTERIOR);
    expect(nomeDaUnidade("zz")).toBe("Exterior");
    expect(nomeDaUnidade("SP")).toBe("São Paulo");
    expect(rotuloDaUnidade("ZZ")).toBe("Exterior");
    expect(rotuloDaUnidade("SP")).toBe("SP");
  });

  it("🔴 UF_NOMES continua com 27 e sem o exterior", () => {
    expect(Object.keys(UF_NOMES)).toHaveLength(27);
    expect(UF_NOMES.ZZ).toBeUndefined();
  });
});

describe("<ApuracaoMeta /> com o denominador do Presidente", () => {
  it("mostra N/28 e explica que o 28º é o exterior", () => {
    const doc = parse(
      <ApuracaoMeta
        pctApurado={23.4}
        ufsApuradas={14}
        ts="2026-10-04T17:23:42-03:00"
        totalUfs={unidadesDeApuracao(1)}
      />,
    );
    const text = doc.body.textContent ?? "";
    expect(text).toContain("14/28");
    expect(text).toContain("27 UFs e o exterior");
  });

  it("sem o exterior (default 27) não ganha a nota", () => {
    const doc = parse(
      <ApuracaoMeta pctApurado={23.4} ufsApuradas={14} ts="2026-10-04T17:23:42-03:00" />,
    );
    expect(doc.body.textContent ?? "").not.toContain("exterior");
  });
});

describe("<StateGroupedTable /> com a linha do exterior", () => {
  it("rótulo 'Exterior', link /uf/ZZ, e nenhum 'ZZ' visível", () => {
    const doc = parse(
      <StateGroupedTable
        rows={[mkRow("SP", 13, 12), mkRow("ZZ", 22, 20)]}
        candidatoAId={13}
        candidatoAName="A"
        candidatoBName="B"
      />,
    );
    const link = doc.querySelector('a[href="/uf/ZZ"]');
    expect(link).not.toBeNull();
    expect(link?.textContent ?? "").toContain("Exterior");
    expect(doc.body.textContent ?? "").not.toMatch(/\bZZ\b/);
    expect(doc.querySelector("caption")?.textContent ?? "").toContain("27 UFs e o exterior");
  });
});
