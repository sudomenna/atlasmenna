// @vitest-environment happy-dom
/**
 * tests/unit/components/MunicipioExplorer.status.test.tsx
 *
 * 2026-10-04 (dono, dia do 1º turno) — a folha do município passou a dizer o
 * STATUS de cada candidato na corrida do ESTADO, conforme o seletor
 * Parcial/Projeção:
 *
 *   - o selo é EXATAMENTE o do cartão do `<ResultPanel>` da página para a
 *     mesma base (mesma regra, mesma ordem, anulada nunca);
 *   - ✓ + fundo cheio só para quem está em `eleitos_definidos` da linha
 *     `por_uf` desta UF (via `lib/state/por-uf-store.ts`), nas duas bases;
 *   - status no topo: "Matematicamente eleito(s)" ou "2º turno definido".
 *
 * Monta no cliente (`createRoot` + `act`) pelo mesmo motivo do
 * `MunicipioExplorer.test.tsx`: os stores de módulo só são observados assim.
 *
 * As corridas foram montadas para que as duas bases discordem de QUEM recebe
 * selo, não só do texto — é isso que mata a mutação "ignorar a base".
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MunicipioExplorer,
  type MunicipioExplorerProps,
} from "@/components/blocks/MunicipioExplorer";
import type { MunicipioRow } from "@/components/blocks/MunicipioTable";
import { ResultPanel } from "@/components/blocks/ResultPanel";
import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";
import type { EdgeUfCandidate, EdgeUfMunicipio, EdgeUfRow } from "@/lib/edge-config/types";
import { usePorUfStore } from "@/lib/state/por-uf-store";
import { __resetViewModeForTests, setViewMode } from "@/lib/state/view-mode-client";
import type { BaseSelo, OpcoesSelo } from "@/lib/utils/selo-resultado";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function cand(
  id: number,
  nome: string,
  partido: string,
  pctAtual: number,
  pctProjetado: number,
  over: Partial<EdgeUfCandidate> = {},
): EdgeUfCandidate {
  return {
    id,
    nome,
    partido,
    votos_atuais: Math.round(pctAtual * 1000),
    votos_projetados: Math.round(pctProjetado * 1000),
    pct_atual: pctAtual,
    pct_projetado: pctProjetado,
    ci95: { lower: pctProjetado - 1, upper: pctProjetado + 1 },
    ...over,
  };
}

/**
 * Corrida do estado — as duas bases discordam de quem é top-2:
 *
 *   parcial → Ana (45) · Célia (35) · Bruno (10) · Davi (5)
 *   proj    → Bruno (40) · Ana (38) · Célia (15) · Davi (4)
 *
 * Zeca é a candidatura ANULADA: maior percentual nas duas bases, nunca selo.
 */
const ANA = 10;
const BRUNO = 20;
const CELIA = 30;
const DAVI = 40;
const ZECA = 50;
/** Votou no município, mas não está em `candidatos` — "Candidato 99". */
const FORA = 99;

const CORRIDA: EdgeUfCandidate[] = [
  cand(ANA, "Ana Lima", "PT", 45, 38),
  cand(BRUNO, "Bruno Reis", "PL", 10, 40),
  cand(CELIA, "Célia Mota", "MDB", 35, 15),
  cand(DAVI, "Davi Nunes", "PSD", 5, 4),
  cand(ZECA, "Zeca Anulado", "NOVO", 60, 60, { destino: "anulado" }),
];

/** Mesma corrida, mas Ana passa de 50% na parcial (só ela, "Venceria…"). */
const MAIORIA: EdgeUfCandidate[] = [
  cand(ANA, "Ana Lima", "PT", 55, 38),
  cand(BRUNO, "Bruno Reis", "PL", 20, 40),
  cand(CELIA, "Célia Mota", "MDB", 15, 15),
  cand(DAVI, "Davi Nunes", "PSD", 10, 4),
];

const MUNICIPIO: EdgeUfMunicipio = {
  cod_ibge: "3550308",
  nome: "São Paulo",
  pct_apurado: 50,
  lider: { candidato_id: DAVI, partido: "PSD", votos: 900, margem_pp: 10 },
  // Davi lidera AQUI e mesmo assim não tem selo: o status é o do estado.
  votos_reportados: {
    [ANA]: 500,
    [BRUNO]: 400,
    [CELIA]: 300,
    [DAVI]: 900,
    [ZECA]: 950,
    [FORA]: 50,
  },
  eleitores: 1_000_000,
};

const ROWS: MunicipioRow[] = [
  {
    cod_ibge: MUNICIPIO.cod_ibge,
    nome: MUNICIPIO.nome,
    lider: DAVI,
    liderCor: "var(--party-psd)",
    liderNome: "PSD",
    margemPp: 10,
    pctApurado: 50,
    votosReportados: 3100,
  },
];

const GOV: OpcoesSelo = { regra: "turno", turno: 1 };
const SEN: OpcoesSelo = { regra: "vaga", vagas: 2 };
const PRES: OpcoesSelo = { regra: "nenhum" };

function linhaPorUf(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 50,
    lider: BRUNO,
    margem_atual: 2,
    margem_projetada: 2,
    margem_projetada_ci: [0, 4],
    chamada: false,
    top_candidatos: [ANA, BRUNO, CELIA, DAVI].map((id) => ({
      id,
      pct: 10,
      pct_atual: 10,
      nome: `C${id}`,
      partido: "PT",
    })),
    bucket: "indefinido",
    ...over,
  } as EdgeUfRow;
}

let container: HTMLElement;
let root: Root;

function montar(props: Partial<MunicipioExplorerProps>) {
  act(() => {
    root.render(
      <MunicipioExplorer
        ufSigla="SP"
        municipios={[MUNICIPIO]}
        rows={ROWS}
        candidatos={CORRIDA}
        {...props}
      />,
    );
  });
  act(() => {
    useMunicipioSheetStore.getState().select(MUNICIPIO.cod_ibge);
  });
}

function base(b: BaseSelo) {
  act(() => setViewMode(b));
}

const folha = () => container.querySelector('[data-testid="sheet"]');
const linhaDe = (nome: string) =>
  [...(folha()?.querySelectorAll('[data-testid="municipio-sheet-row"]') ?? [])].find((r) =>
    r.textContent?.includes(nome),
  );
const seloDe = (nome: string) =>
  linhaDe(nome)?.querySelector('[data-testid="municipio-sheet-selo"]')?.textContent ?? null;
const eleitoEm = (nome: string) =>
  linhaDe(nome)?.querySelector('[data-testid="municipio-sheet-eleito"]') ?? null;
const status = () =>
  folha()?.querySelector('[data-testid="municipio-sheet-status"]')?.textContent ?? null;
const todosOsSelos = () =>
  [...(folha()?.querySelectorAll('[data-testid="municipio-sheet-selo"]') ?? [])].map(
    (e) => e.textContent,
  );

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useMunicipioSheetStore.getState().clear();
  usePorUfStore.setState({ porCargo: {} });
  __resetViewModeForTests();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetViewModeForTests();
});

describe("Governador (regra turno) — selo da base ativa", () => {
  it("projeção: Bruno e Ana com '2º turno · projeção'; Célia (3ª no estado) sem selo", () => {
    montar({ selo: GOV, cargo: "gov" });
    base("proj");
    expect(seloDe("Bruno Reis")).toBe("2º turno · projeção");
    expect(seloDe("Ana Lima")).toBe("2º turno · projeção");
    expect(seloDe("Célia Mota")).toBeNull();
    expect(todosOsSelos()).toHaveLength(2);
  });

  it("parcial: Ana e Célia com '2º turno · na parcial'; Bruno sem selo", () => {
    montar({ selo: GOV, cargo: "gov" });
    base("parcial");
    expect(seloDe("Ana Lima")).toBe("2º turno · na parcial");
    expect(seloDe("Célia Mota")).toBe("2º turno · na parcial");
    expect(seloDe("Bruno Reis")).toBeNull();
  });

  it("trocar a base com a folha aberta troca o texto e QUEM tem selo", () => {
    montar({ selo: GOV, cargo: "gov" });
    base("proj");
    expect(seloDe("Bruno Reis")).toBe("2º turno · projeção");
    base("parcial");
    expect(seloDe("Bruno Reis")).toBeNull();
    expect(seloDe("Célia Mota")).toBe("2º turno · na parcial");
    base("proj");
    expect(seloDe("Célia Mota")).toBeNull();
  });

  it("maioria na parcial: só a líder, 'Venceria no 1º turno · na parcial'", () => {
    montar({ selo: GOV, cargo: "gov", candidatos: MAIORIA });
    base("parcial");
    expect(seloDe("Ana Lima")).toBe("Venceria no 1º turno · na parcial");
    expect(todosOsSelos()).toHaveLength(1);
    base("proj");
    expect(seloDe("Bruno Reis")).toBe("2º turno · projeção");
    expect(seloDe("Ana Lima")).toBe("2º turno · projeção");
  });

  it("anulada nunca recebe selo — nem sendo a mais votada nas duas bases", () => {
    montar({ selo: GOV, cargo: "gov" });
    for (const b of ["parcial", "proj"] as const) {
      base(b);
      expect(seloDe("Zeca Anulado")).toBeNull();
    }
  });

  it("candidato do município fora da corrida (e o líder local) ficam sem selo", () => {
    montar({ selo: GOV, cargo: "gov" });
    base("proj");
    expect(seloDe("Candidato 99")).toBeNull();
    expect(seloDe("Davi Nunes")).toBeNull();
  });

  it("2º turno ⇒ nenhum selo, em nenhuma base", () => {
    montar({ selo: { regra: "turno", turno: 2 }, cargo: "gov" });
    for (const b of ["parcial", "proj"] as const) {
      base(b);
      expect(todosOsSelos()).toEqual([]);
    }
  });
});

describe("Senador (regra vaga, 2 vagas)", () => {
  it("projeção: Bruno e Ana 'Vaga projetada'; parcial: Ana e Célia 'Vaga na parcial'", () => {
    montar({ selo: SEN, cargo: "sen" });
    base("proj");
    expect(seloDe("Bruno Reis")).toBe("Vaga projetada");
    expect(seloDe("Ana Lima")).toBe("Vaga projetada");
    expect(seloDe("Célia Mota")).toBeNull();
    base("parcial");
    expect(seloDe("Ana Lima")).toBe("Vaga na parcial");
    expect(seloDe("Célia Mota")).toBe("Vaga na parcial");
    expect(seloDe("Bruno Reis")).toBeNull();
    expect(seloDe("Zeca Anulado")).toBeNull();
  });
});

describe("Presidente na UF (regra nenhum)", () => {
  it("sem selo de base nas duas bases", () => {
    montar({ selo: PRES, cargo: "pres" });
    for (const b of ["parcial", "proj"] as const) {
      base(b);
      expect(todosOsSelos()).toEqual([]);
    }
  });

  it("sem a prop `selo` o default também é nenhum", () => {
    montar({ cargo: "pres" });
    expect(todosOsSelos()).toEqual([]);
  });
});

describe("o selo da folha é o do cartão do <ResultPanel> — mesma regra, mesma base", () => {
  function selosDoPainel(opcoes: OpcoesSelo, b: BaseSelo): Map<string, string> {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <ResultPanel
          candidatos={CORRIDA}
          pctApurado={50}
          selo={opcoes.regra}
          title="T"
          {...(opcoes.turno != null ? { turno: opcoes.turno } : {})}
          {...(opcoes.vagas != null ? { vagas: opcoes.vagas } : {})}
        />,
      ),
      "text/html",
    );
    const out = new Map<string, string>();
    for (const li of doc.querySelectorAll("li[data-ord]")) {
      const el = li.querySelector(
        `[data-view-only="${b}"] > [data-testid="result-selo"], [data-view-only="${b}"] > [data-testid="result-vaga-marker"]`,
      );
      const nome = CORRIDA.find((c) => li.textContent?.includes(c.nome.split(" ")[0] ?? ""))?.nome;
      if (el && nome) out.set(nome, el.textContent ?? "");
    }
    return out;
  }

  for (const [nomeCorrida, opcoes, cargo] of [
    ["Governador", GOV, "gov"],
    ["Senador", SEN, "sen"],
    ["Presidente", PRES, "pres"],
  ] as const) {
    for (const b of ["parcial", "proj"] as const) {
      it(`${nomeCorrida} · ${b}`, () => {
        const painel = selosDoPainel(opcoes, b);
        // Guarda contra a comparação vazia: com regra, o painel TEM 2 selos.
        expect(painel.size).toBe(opcoes.regra === "nenhum" ? 0 : 2);
        montar({ selo: opcoes, cargo });
        base(b);
        const daFolha = new Map<string, string>();
        for (const c of CORRIDA) {
          const s = seloDe(c.nome);
          if (s !== null) daFolha.set(c.nome, s);
        }
        expect(daFolha).toEqual(painel);
      });
    }
  }
});

describe("eleitos definidos (por_uf da moldura do mapa)", () => {
  function publicar(cargo: "pres" | "gov" | "sen", row: EdgeUfRow) {
    act(() => usePorUfStore.getState().publicarPorUf(cargo, [row]));
  }

  it("1 eleito: ✓ com rótulo acessível + fundo do chip do partido, e o status no topo — nas duas bases", () => {
    montar({ selo: GOV, cargo: "gov" });
    publicar("gov", linhaPorUf({ eleitos_definidos: [ANA] }));
    for (const b of ["parcial", "proj"] as const) {
      base(b);
      // 🔴 2026-10-04 (auditoria P1) — o município não elege: o texto diz o
      // escopo ("No estado: …"), no status e no rótulo do ✓.
      expect(status()).toBe("No estado: matematicamente eleito");
      const marca = eleitoEm("Ana Lima") as HTMLElement | null;
      expect(marca).not.toBeNull();
      expect(marca?.getAttribute("style")).toContain("var(--party-pt-chip)");
      expect(marca?.getAttribute("style")).toContain("var(--party-pt-ink)");
      const check = marca?.querySelector('[role="img"]');
      expect(check?.textContent).toBe("✓");
      expect(check?.getAttribute("aria-label")).toBe("No estado: matematicamente eleito");
      expect(eleitoEm("Bruno Reis")).toBeNull();
    }
  });

  it("2 eleitos (Senado): 'Matematicamente eleitos'", () => {
    montar({ selo: SEN, cargo: "sen" });
    publicar("sen", linhaPorUf({ eleitos_definidos: [ANA, BRUNO] }));
    expect(status()).toBe("No estado: matematicamente eleitos");
    // Senado: a conta é do AtlasMenna — a atribuição aparece com a marca.
    expect(folha()?.querySelector('[data-testid="municipio-sheet-atribuicao"]')?.textContent).toBe(
      "Cálculo do AtlasMenna sobre a contagem do TSE",
    );
    expect(eleitoEm("Ana Lima")).not.toBeNull();
    expect(eleitoEm("Bruno Reis")).not.toBeNull();
    expect(eleitoEm("Célia Mota")).toBeNull();
  });

  // 04/10 (para o 2º turno) — depois da totalização final a marca do Senado
  // é a do TSE (`definicao_oficial`), e a gaveta do município diz isso.
  it("🔴 Senado com definicao_oficial: 'Definição oficial do TSE' [mutação: ignorar `definicao_oficial`]", () => {
    montar({ selo: SEN, cargo: "sen" });
    publicar("sen", linhaPorUf({ eleitos_definidos: [ANA, BRUNO], definicao_oficial: true }));
    expect(status()).toBe("No estado: matematicamente eleitos");
    expect(folha()?.querySelector('[data-testid="municipio-sheet-atribuicao"]')?.textContent).toBe(
      "Definição oficial do TSE",
    );
  });

  it("2º turno definido: status sem fundo em ninguém", () => {
    montar({ selo: GOV, cargo: "gov" });
    publicar("gov", linhaPorUf({ segundo_turno_definido: true }));
    expect(status()).toBe("No estado: 2º turno definido");
    expect(folha()?.querySelectorAll('[data-testid="municipio-sheet-eleito"]')).toHaveLength(0);
    expect(folha()?.querySelector('[data-testid="municipio-sheet-atribuicao"]')).toBeNull();
  });

  it("Presidente: só lê o campo — eleito definido aparece mesmo sem selo de base", () => {
    montar({ selo: PRES, cargo: "pres" });
    publicar("pres", linhaPorUf({ eleitos_definidos: [BRUNO] }));
    // Presidente: quem decide é o país, não o estado nem o município.
    expect(status()).toBe("No país: matematicamente eleito");
    expect(folha()?.querySelector('[data-testid="municipio-sheet-atribuicao"]')).toBeNull();
    expect(eleitoEm("Bruno Reis")).not.toBeNull();
    expect(todosOsSelos()).toEqual([]);
  });

  it("🔴 'Sub judice' eleito: a etiqueta sobre a faixa herda a tinta dela (auditoria a11y 04/10) [mutação: tirar `sobreFaixa`]", () => {
    const sub = CORRIDA.map((c) =>
      c.id === ANA || c.id === BRUNO ? { ...c, destino: "sub_judice" as const } : c,
    );
    montar({ selo: GOV, cargo: "gov", candidatos: sub });
    publicar("gov", linhaPorUf({ eleitos_definidos: [ANA] }));
    const naFaixa = eleitoEm("Ana Lima")?.querySelector('[data-testid="destino-etiqueta"]');
    expect(naFaixa?.getAttribute("style")).toMatch(/color:\s*inherit/);
    const fora = linhaDe("Bruno Reis")?.querySelector('[data-testid="destino-etiqueta"]');
    expect(fora?.getAttribute("style")).toContain("var(--text-primary)");
  });

  it("linha de OUTRO cargo ou de OUTRA UF não marca nada", () => {
    montar({ selo: GOV, cargo: "gov" });
    publicar("pres", linhaPorUf({ eleitos_definidos: [ANA] }));
    publicar("gov", linhaPorUf({ sigla: "RJ", eleitos_definidos: [ANA] }));
    expect(status()).toBeNull();
    expect(eleitoEm("Ana Lima")).toBeNull();
  });

  it("sem eleitos nem 2º turno definido: sem status", () => {
    montar({ selo: GOV, cargo: "gov" });
    publicar("gov", linhaPorUf());
    expect(status()).toBeNull();
  });

  it("anulada nunca é marcada eleita, nem se o campo a trouxer", () => {
    montar({ selo: GOV, cargo: "gov" });
    publicar(
      "gov",
      linhaPorUf({
        eleitos_definidos: [ZECA],
        top_candidatos: [
          { id: ZECA, pct: 60, pct_atual: 60, nome: "Z", partido: "NOVO", destino: "anulado" },
        ],
      } as Partial<EdgeUfRow>),
    );
    expect(eleitoEm("Zeca Anulado")).toBeNull();
    expect(status()).toBeNull();
  });
});
