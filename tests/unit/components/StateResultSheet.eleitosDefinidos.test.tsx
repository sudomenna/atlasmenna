// @vitest-environment happy-dom
/**
 * tests/unit/components/StateResultSheet.eleitosDefinidos.test.tsx
 *
 * 2026-10-04 (dono, dia do 1º turno) — a gaveta do estado no celular ganha:
 *
 *  1. A MESMA marca de vencedor do balão do desktop (faixa com o par
 *     `partyChipInk` + ✓ no lugar do ponto), e só para os ids de
 *     `eleitos_definidos` (matematicamente eleito) — igual nas duas bases do
 *     seletor, seguindo o `id`, nunca a posição, nunca `chamada`.
 *  2. O texto de status no topo ("Matematicamente eleito(s)" / "2º turno
 *     definido"), do mesmo ponto único (`definicaoDaUf`).
 *  3. Os selos de BASE dos cartões das páginas (`selosDaBase`): Governador ⇒
 *     turno; Senador ⇒ vaga; Presidente na UF ⇒ nenhum; 2º turno ⇒ nenhum.
 *
 * Fixture com as duas ordens DIFERENTES por construção: ALFA lidera a projeção
 * (55%, maioria), DELTA lidera a parcial (48%). Um código que marque pela
 * posição ou que leia a base errada produz a gaveta errada em pelo menos um
 * caso.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import type { EdgeUfRow } from "@/lib/edge-config/types";

const FIXTURE = [
  { id: 100, nome: "ALFA", partido: "PT", proj: 55, atual: 30 },
  { id: 101, nome: "BETA", partido: "PL", proj: 25, atual: 15 },
  { id: 102, nome: "GAMA", partido: "PSOL", proj: 12, atual: 7 },
  { id: 103, nome: "DELTA", partido: "NOVO", proj: 8, atual: 48 },
] as const;

function mkRow(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "MT",
    pct_apurado: 27,
    lider: 100,
    margem_atual: 30,
    margem_projetada: 30,
    margem_projetada_ci: [25, 35],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos: FIXTURE.map((c) => ({
      id: c.id,
      pct: c.proj,
      pct_atual: c.atual,
      nome: c.nome,
      partido: c.partido,
      sqcand: `${c.id}`,
    })),
    vai_a_2t: null,
    bucket: "chamada",
    ...over,
  };
}

function render(opts: {
  row: EdgeUfRow;
  cargo: "pres" | "gov" | "sen";
  viewMode?: "parcial" | "proj";
  turno?: number;
}): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <StateResultSheet
      open
      onClose={() => {}}
      row={opts.row}
      candidatos={[]}
      cargo={opts.cargo}
      viewMode={opts.viewMode}
      turno={opts.turno}
    />,
  );
  return host;
}

/** Por nome: a linha está marcada como eleita? qual selo leva? */
function linhas(host: HTMLElement) {
  const out = new Map<
    string,
    { eleito: boolean; check: boolean; selo: string | null; html: string }
  >();
  for (const li of host.querySelectorAll("[data-testid='state-sheet-candidatos'] li")) {
    const nome =
      li.querySelector("[data-testid='state-sheet-cand-nome']")?.firstChild?.textContent ?? "";
    const ident = li.querySelector("[data-testid='state-sheet-cand-identidade']");
    out.set(nome, {
      eleito: ident?.getAttribute("data-eleito") === "true",
      check: li.querySelector("[data-testid='state-sheet-cand-check']") != null,
      selo:
        li.querySelector("[data-testid='state-sheet-selo'], [data-testid='result-vaga-marker']")
          ?.textContent ?? null,
      html: ident?.outerHTML ?? "",
    });
  }
  return out;
}

const status = (host: HTMLElement) =>
  host.querySelector("[data-testid='state-sheet-status']")?.textContent ?? null;

describe("gaveta — marca de eleito só por eleitos_definidos", () => {
  it("🔴 chamada: true SEM eleitos_definidos (MT 27%) ⇒ nenhuma faixa, nenhum ✓, nenhum status [mutação: voltar a ler `chamada`]", () => {
    const h = render({ row: mkRow(), cargo: "sen" });
    const l = linhas(h);
    expect([...l.values()].some((x) => x.eleito || x.check)).toBe(false);
    expect(h.innerHTML).not.toContain("-chip)");
    expect(status(h)).toBeNull();
    expect(h.textContent).not.toContain("Chamada");
  });

  it("1 eleito ⇒ faixa com o par partyChipInk + ✓ só nele, status 'Matematicamente eleito'", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [100] }), cargo: "gov" });
    const l = linhas(h);
    expect(l.get("ALFA")?.eleito).toBe(true);
    expect(l.get("ALFA")?.check).toBe(true);
    expect(l.get("ALFA")?.html).toContain("var(--party-pt-chip)");
    expect(l.get("ALFA")?.html).toContain("var(--party-pt-ink)");
    expect([...l.entries()].filter(([, x]) => x.check).map(([n]) => n)).toEqual(["ALFA"]);
    expect(status(h)).toBe("Matematicamente eleito");
    // Leitor de tela ouve a marca, que o ✓ (aria-hidden) não carrega.
    expect(h.textContent).toContain("matematicamente eleito");
  });

  it("2 eleitos (Senado) ⇒ duas faixas e status no plural", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [100, 101] }), cargo: "sen" });
    const l = linhas(h);
    expect([...l.entries()].filter(([, x]) => x.check).map(([n]) => n)).toEqual(["ALFA", "BETA"]);
    expect(l.get("BETA")?.html).toContain("var(--party-pl-chip)");
    expect(status(h)).toBe("Matematicamente eleitos");
  });

  it("id fora das linhas ⇒ ignorado (nem faixa, nem status)", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [999] }), cargo: "gov" });
    expect([...linhas(h).values()].some((x) => x.check)).toBe(false);
    expect(status(h)).toBeNull();
  });

  it("Parcial (DELTA lidera) ⇒ a faixa continua em ALFA, pelo id — não na 1ª linha", () => {
    const h = render({
      row: mkRow({ eleitos_definidos: [100] }),
      cargo: "gov",
      viewMode: "parcial",
    });
    const l = linhas(h);
    expect([...l.keys()][0]).toBe("DELTA");
    expect(l.get("DELTA")?.check).toBe(false);
    expect(l.get("ALFA")?.check).toBe(true);
    expect(status(h)).toBe("Matematicamente eleito");
  });

  it("segundo_turno_definido ⇒ status '2º turno definido' e nenhuma faixa", () => {
    const h = render({ row: mkRow({ segundo_turno_definido: true }), cargo: "gov" });
    expect(status(h)).toBe("2º turno definido");
    expect([...linhas(h).values()].some((x) => x.eleito || x.check)).toBe(false);
  });
});

describe("gaveta — selos de base (selosDaBase), por cargo", () => {
  it("Governador em Projeção: ALFA 55% ⇒ só ele, 'Vence no 1º turno · projeção'", () => {
    const l = linhas(render({ row: mkRow(), cargo: "gov", viewMode: "proj" }));
    expect(l.get("ALFA")?.selo).toBe("Vence no 1º turno · projeção");
    expect([...l.values()].filter((x) => x.selo != null)).toHaveLength(1);
  });

  it("Governador em Parcial: DELTA 48% ⇒ DELTA e ALFA, '2º turno · na parcial'", () => {
    const l = linhas(render({ row: mkRow(), cargo: "gov", viewMode: "parcial" }));
    expect(l.get("DELTA")?.selo).toBe("2º turno · na parcial");
    expect(l.get("ALFA")?.selo).toBe("2º turno · na parcial");
    expect(l.get("BETA")?.selo).toBeNull();
  });

  it("Governador: linha eleita mantém o selo de base junto do ✓", () => {
    const l = linhas(render({ row: mkRow({ eleitos_definidos: [100] }), cargo: "gov" }));
    expect(l.get("ALFA")?.check).toBe(true);
    expect(l.get("ALFA")?.selo).toBe("Vence no 1º turno · projeção");
  });

  it("Senador: 'Vaga projetada' / 'Vaga na parcial' nos ocupantes da base", () => {
    const proj = linhas(render({ row: mkRow(), cargo: "sen", viewMode: "proj" }));
    expect(proj.get("ALFA")?.selo).toBe("Vaga projetada");
    expect(proj.get("BETA")?.selo).toBe("Vaga projetada");
    expect(proj.get("DELTA")?.selo).toBeNull();
    const parcial = linhas(render({ row: mkRow(), cargo: "sen", viewMode: "parcial" }));
    expect(parcial.get("DELTA")?.selo).toBe("Vaga na parcial");
    expect(parcial.get("ALFA")?.selo).toBe("Vaga na parcial");
    expect(parcial.get("BETA")?.selo).toBeNull();
  });

  it("Presidente na UF ⇒ nenhum selo de base (decisão de 27/09)", () => {
    const l = linhas(render({ row: mkRow(), cargo: "pres" }));
    expect([...l.values()].some((x) => x.selo != null)).toBe(false);
  });

  it("2º turno ⇒ nenhum selo, nem de Governador", () => {
    const l = linhas(render({ row: mkRow(), cargo: "gov", turno: 2 }));
    expect([...l.values()].some((x) => x.selo != null)).toBe(false);
  });
});

// 2026-10-04 (auditoria constitucional P1/P8 + a11y) — escopo, atribuição e a
// etiqueta de destino sobre a faixa.
describe("gaveta — escopo do status e atribuição do Senado", () => {
  const atribuicao = (host: HTMLElement) =>
    host.querySelector("[data-testid='state-sheet-atribuicao']")?.textContent ?? null;

  it("Presidente: 'No país: matematicamente eleito' (quem decide é o Brasil), sem atribuição", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [100] }), cargo: "pres" });
    expect(status(h)).toBe("No país: matematicamente eleito");
    expect(h.querySelector(".sr-only")?.parentElement?.textContent).toContain(
      ", no país: matematicamente eleito",
    );
    expect(atribuicao(h)).toBeNull();
  });

  it("Governador: sem prefixo e sem atribuição (a fonte é o aviso do TSE)", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [100] }), cargo: "gov" });
    expect(status(h)).toBe("Matematicamente eleito");
    expect(atribuicao(h)).toBeNull();
  });

  it("🔴 Senado com eleito: a atribuição 'Cálculo do AtlasMenna sobre a contagem do TSE'", () => {
    const h = render({ row: mkRow({ eleitos_definidos: [100, 101] }), cargo: "sen" });
    expect(status(h)).toBe("Matematicamente eleitos");
    expect(atribuicao(h)).toBe("Cálculo do AtlasMenna sobre a contagem do TSE");
  });

  // 04/10 (para o 2º turno) — depois da totalização final a marca do Senado
  // é a do TSE (`definicao_oficial`).
  it("🔴 Senado com definicao_oficial: 'Definição oficial do TSE' [mutação: ignorar `definicao_oficial`]", () => {
    const h = render({
      row: mkRow({ eleitos_definidos: [100, 101], definicao_oficial: true }),
      cargo: "sen",
    });
    expect(status(h)).toBe("Matematicamente eleitos");
    expect(atribuicao(h)).toBe("Definição oficial do TSE");
  });

  it("Governador com definicao_oficial: continua sem atribuição", () => {
    const h = render({
      row: mkRow({ eleitos_definidos: [100], definicao_oficial: true }),
      cargo: "gov",
    });
    expect(atribuicao(h)).toBeNull();
  });

  it("Senado SEM eleito: nem status nem atribuição", () => {
    const h = render({ row: mkRow(), cargo: "sen" });
    expect(status(h)).toBeNull();
    expect(atribuicao(h)).toBeNull();
  });

  it("🔴 'Sub judice' eleito: a etiqueta herda a tinta da faixa; fora da faixa, a de sempre [mutação: tirar `sobreFaixa`]", () => {
    const row = mkRow({ eleitos_definidos: [100] });
    row.top_candidatos = row.top_candidatos.map((t) => ({ ...t, destino: "sub_judice" as const }));
    const l = linhas(render({ row, cargo: "gov" }));
    expect(l.get("ALFA")?.html).toMatch(/data-testid="destino-etiqueta"[^>]*color:\s*inherit/);
    expect(l.get("BETA")?.html).toMatch(
      /data-testid="destino-etiqueta"[^>]*color:\s*var\(--text-primary\)/,
    );
  });
});
