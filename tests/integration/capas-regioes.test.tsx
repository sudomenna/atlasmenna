// @vitest-environment happy-dom
/**
 * tests/integration/capas-regioes.test.tsx — ADR-0057 (2026-09-28).
 *
 * Teste de FIO das três capas agrupadas por região — `/governador`,
 * `/senador` e a home de Presidente —, renderizadas por SSR com o reader
 * mockado devolvendo as fixtures do modo simulado
 * (`tests/fixtures/simulacao/`), que é o que o dono vê em `pnpm dev:sim`.
 *
 * O consolidado esperado é recalculado AQUI, direto das linhas da fixture, com
 * um laço próprio — não com `consolidarRegiao`. Se a página e a função
 * concordarem num número errado, este arquivo discorda das duas.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GovernadorGridPage from "@/app/(gov)/governador/page";
import HomePage from "@/app/(pres)/page";
import SenadoPage from "@/app/(sen)/senador/page";
import { DATA_FILL_STROKE } from "@/components/blocks/_candidateColor";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { RegiaoRecolhivel } from "@/components/blocks/RegiaoRecolhivel";
import { REGIOES } from "@/lib/config/regioes";
import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { formatPercentTrim, formatVotesCompact } from "@/lib/utils/format";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import govSim from "@/tests/fixtures/simulacao/governador.json" with { type: "json" };
import presSim from "@/tests/fixtures/simulacao/presidente.json" with { type: "json" };
import senSim from "@/tests/fixtures/simulacao/senador.json" with { type: "json" };

// biome-ignore lint/suspicious/noExplicitAny: flag global do React para `act`.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let gov: EdgePayload;
let sen: EdgePayload;
let pres: EdgePayload;

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));
vi.mock("@/lib/blob/uf-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob/uf-detail")>()),
  readUfDetail: async () => ({ status: "unavailable", reason: "not_configured", url: null }),
}));
vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: async (opts?: { cargo?: string; turno?: number }) => {
    if (opts?.turno !== 1) return null;
    if (opts?.cargo === "gov") return gov;
    if (opts?.cargo === "sen") return sen;
    return null;
  },
  readNationalProjection: async () => pres,
  readArchivedProjection: async () => null,
  readUfProjection: async () => null,
}));

beforeEach(() => {
  gov = clone(govSim as unknown as EdgePayload);
  sen = clone(senSim as unknown as EdgePayload);
  pres = clone(presSim as unknown as EdgePayload);
});

async function render(node: Promise<React.ReactElement> | React.ReactElement): Promise<Document> {
  return new DOMParser().parseFromString(renderToStaticMarkup(await node), "text/html");
}

const govPage = (status?: string) =>
  render(GovernadorGridPage({ searchParams: Promise.resolve(status ? { status } : {}) }));

/** Consolidado por partido recalculado à mão: [rótulo, %] das 6 + Outros. */
function esperado(
  rows: readonly EdgeUfRow[],
  base: "parcial" | "proj",
  chave: (t: EdgeUfRow["top_candidatos"][number]) => string | undefined,
): string[] {
  const soma = new Map<string, number>();
  let outros = 0;
  for (const u of rows) {
    const tot = u.votos_disputa_projetados ?? Number.NaN;
    for (const t of u.top_candidatos) {
      if (t.destino === "anulado") continue;
      const v = base === "parcial" ? (t.votos_atuais as number) : (t.pct / 100) * tot;
      const k = chave(t);
      if (k === undefined) outros += v;
      else soma.set(k, (soma.get(k) ?? 0) + v);
    }
    if (u.outros) {
      outros += base === "parcial" ? (u.outros.votos_atuais as number) : (u.outros.pct / 100) * tot;
    }
  }
  const ord = [...soma].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  const total = ord.reduce((a, [, v]) => a + v, 0) + outros;
  const resto = ord.slice(6).reduce((a, [, v]) => a + v, 0) + outros;
  return [
    ...ord.slice(0, 6).map(([k, v]) => `${k} ${formatPercentTrim((v / total) * 100)}`),
    `Outros ${formatPercentTrim((resto / total) * 100)}`,
  ];
}

/**
 * As duas bases do CONSOLIDADO da região. Desde 04/10/2026 os cartões
 * (`<GovernorCard duasBases>`) também têm `[data-view-only]` — o filtro por
 * `article` mantém este seletor sobre o resumo da região, não sobre as listas
 * dos cartões.
 */
function foraDoCartao<T extends Element>(lista: Iterable<T>): T[] {
  return [...lista].filter((e) => e.closest("article") === null);
}

function legenda(doc: Document, regiao: string, base: "parcial" | "proj"): string[] {
  const itens = foraDoCartao(
    doc.querySelectorAll(`[data-regiao="${regiao}"] [data-view-only="${base}"] > ul > li`),
  );
  return itens.map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim());
}

const rowsDe = (p: EdgePayload, regiao: string) => {
  const siglas = REGIOES.find((r) => r.id === regiao)?.siglas ?? [];
  return p.por_uf.filter((u) => siglas.includes(u.sigla));
};

const porPartido = (t: { partido?: string }) => (t.partido ? siglaExibicao(t.partido) : undefined);

describe("/governador — agrupado por região", () => {
  it("as 5 regiões na ordem do IBGE, e os cartões de cada uma em ordem de sigla", async () => {
    const doc = await govPage();
    const regioes = [...doc.querySelectorAll("[data-regiao]")];
    expect(regioes.map((r) => r.getAttribute("data-regiao"))).toEqual(REGIOES.map((r) => r.id));
    for (const [i, r] of REGIOES.entries()) {
      const titulos = [...(regioes[i]?.querySelectorAll("article h3") ?? [])].map((h) =>
        (h.textContent ?? "").replace(/.*·\s*/, "").trim(),
      );
      expect(titulos).toEqual([...r.siglas]);
    }
    // O título da região é h2 aqui (o painel não tem título) e o cartão segue h3.
    expect(regioes[0]?.querySelector("h2 button")?.textContent).toMatch(/^Norte, 7 estados/);
  });

  it("🔴 Parcial do Sudeste = Σ votos_atuais dos 4 estados, por partido (conferido à mão)", async () => {
    const doc = await govPage();
    const mao = esperado(rowsDe(gov, "sudeste"), "parcial", porPartido);
    expect(legenda(doc, "sudeste", "parcial")).toEqual(mao);
    // No simulado de 28/09 isto é "PT 25,8%" — o mesmo número que o
    // protótipo conferiu (25,81%).
    const lider = doc.querySelector(
      '[data-regiao="sudeste"] [data-view-only="parcial"] [data-testid="regiao-lider"]',
    );
    expect(lider?.textContent).toBe(mao[0]);
  });

  it("🔴 Parcial NUNCA mostra o % derivado do total projetado — mostra os votos contados", async () => {
    // Decisão do dono de 20/09: a visão Parcial não mostra leitura do modelo.
    // O "% apurado" da região divide pelo `votos_disputa_projetados`, que é
    // saída do modelo — só pode aparecer na base Projeção.
    const doc = await govPage();
    for (const r of REGIOES) {
      const rows = rowsDe(gov, r.id);
      let contado = 0;
      let projetado = 0;
      for (const u of rows) {
        for (const t of u.top_candidatos) {
          if (t.destino !== "anulado") contado += t.votos_atuais as number;
        }
        contado += u.outros?.votos_atuais ?? 0;
        projetado += u.votos_disputa_projetados as number;
      }
      const pctModelo = formatPercentTrim((contado / projetado) * 100);
      const parcial = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="parcial"]`);
      const proj = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="proj"]`);
      expect(parcial?.querySelector('[data-testid="regiao-andamento"]')?.textContent).toBe(
        `${formatVotesCompact(contado)} votos contados`,
      );
      // A linha "↓ X% proj" ao lado do líder (emenda do dono, 2026-10-03) é a
      // ÚNICA leitura do modelo admitida na Parcial — e a fala dela diz "acima
      // do apurado". Fora dela, a regra de 20/09 segue valendo.
      const semIndicador = parcial?.cloneNode(true) as Element | undefined;
      semIndicador?.querySelector('[data-testid="projecao-indicador"]')?.remove();
      expect(semIndicador?.textContent).not.toContain("apurado");
      expect(semIndicador?.textContent).not.toContain(pctModelo);
      expect(proj?.querySelector('[data-testid="regiao-andamento"]')?.textContent).toBe(
        `${pctModelo} apurado`,
      );
    }
  });

  it("🔴 Parcial: ao lado do líder, a projeção PEQUENA do mesmo partido (2026-10-03); Projeção: nenhuma", async () => {
    const doc = await govPage();
    for (const r of REGIOES) {
      const parcial = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="parcial"]`);
      const proj = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="proj"]`);
      expect(proj?.querySelector('[data-testid="projecao-indicador"]')).toBeNull();
      const ind = parcial?.querySelector('[data-testid="projecao-indicador"]');
      // O líder da Parcial, e o % que a legenda da Projeção dá a ele.
      const lider = (parcial?.querySelector('[data-testid="regiao-lider"]')?.textContent ?? "")
        .replace(/\s+\d.*$/, "")
        .trim();
      const naProj = legenda(doc, r.id, "proj").find((l) => l.startsWith(`${lider} `));
      if (naProj === undefined) {
        // Fora das 6 da Projeção ⇒ sem número para mostrar ⇒ nada.
        expect(ind).toBeNull();
        continue;
      }
      const pctProj = Number(
        naProj
          .slice(lider.length + 1)
          .replace("%", "")
          .replace(",", "."),
      );
      const desenhado = ind?.querySelector('[aria-hidden="true"]')?.textContent ?? "";
      expect(desenhado).toMatch(/^([↑↓] )?\d+,\d% proj$/);
      const noIndicador = Number(
        desenhado
          .replace(/^[↑↓] /, "")
          .replace("% proj", "")
          .replace(",", "."),
      );
      expect(Math.abs(noIndicador - pctProj)).toBeLessThanOrEqual(0.05);
    }
  });

  it("🔴 região sem total projetado ⇒ Parcial SEM o indicador (nunca um número de resgate)", async () => {
    const semCampo = gov.por_uf.find((u) => u.sigla === "SP");
    if (semCampo) delete semCampo.votos_disputa_projetados;
    const doc = await govPage();
    const parcial = doc.querySelector('[data-regiao="sudeste"] [data-view-only="parcial"]');
    expect(parcial?.querySelector('[data-testid="regiao-lider"]')?.textContent).toMatch(/\d/);
    expect(parcial?.querySelector('[data-testid="projecao-indicador"]')).toBeNull();
    // As outras regiões seguem com ele.
    expect(
      doc.querySelector(
        '[data-regiao="sul"] [data-view-only="parcial"] [data-testid="projecao-indicador"]',
      ),
    ).not.toBeNull();
  });

  it("🔴 Projeção: '≈ N votos projetados' = Σ pct × votos_disputa_projetados (2026-10-03); Parcial: nenhum", async () => {
    // Decisão do dono, 2026-10-03: ao trocar para Projeção, a contagem de votos
    // vira a PROJETADA. Na região é o total do consolidado da projeção — a
    // mesma soma que dá os % da legenda —, nunca `contado ÷ % apurado`.
    const doc = await govPage();
    for (const r of REGIOES) {
      let total = 0;
      for (const u of rowsDe(gov, r.id)) {
        const tot = u.votos_disputa_projetados as number;
        for (const t of u.top_candidatos) {
          if (t.destino !== "anulado") total += (t.pct / 100) * tot;
        }
        if (u.outros) total += (u.outros.pct / 100) * tot;
      }
      const proj = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="proj"]`);
      const parcial = doc.querySelector(`[data-regiao="${r.id}"] [data-view-only="parcial"]`);
      const vp = proj?.querySelector('[data-testid="votos-projetados"]');
      expect(vp?.querySelector(':scope > [aria-hidden="true"]')?.textContent).toBe(
        `≈ ${formatVotesCompact(total)} votos projetados`,
      );
      // Já dentro do resumo da Projeção: não repete o `data-view-only`.
      expect(vp?.hasAttribute("data-view-only")).toBe(false);
      // O "% apurado" da Projeção continua lá.
      expect(proj?.querySelector('[data-testid="regiao-andamento"]')?.textContent).toMatch(
        /apurado$/,
      );
      expect(parcial?.querySelector('[data-testid="votos-projetados"]')).toBeNull();
    }
  });

  it("🔴 região sem total projetado ⇒ Projeção SEM votos projetados (nunca um número de resgate)", async () => {
    const semCampo = gov.por_uf.find((u) => u.sigla === "SP");
    if (semCampo) delete semCampo.votos_disputa_projetados;
    const doc = await govPage();
    expect(
      doc.querySelector(
        '[data-regiao="sudeste"] [data-view-only="proj"] [data-testid="votos-projetados"]',
      ),
    ).toBeNull();
    expect(
      doc.querySelector(
        '[data-regiao="sul"] [data-view-only="proj"] [data-testid="votos-projetados"]',
      ),
    ).not.toBeNull();
  });

  it("Projeção de cada região = Σ pct × votos_disputa_projetados", async () => {
    const doc = await govPage();
    for (const r of REGIOES) {
      expect(legenda(doc, r.id, "proj")).toEqual(esperado(rowsDe(gov, r.id), "proj", porPartido));
    }
  });

  it("🔴 sem votos_disputa_projetados numa UF da região ⇒ Projeção '—', Parcial intacta", async () => {
    const semCampo = gov.por_uf.find((u) => u.sigla === "SP");
    if (semCampo) delete semCampo.votos_disputa_projetados;
    const doc = await govPage();
    const proj = doc.querySelector('[data-regiao="sudeste"] [data-view-only="proj"]');
    expect(proj?.querySelector('[data-testid="regiao-lider"]')?.textContent).toBe("—");
    expect(proj?.querySelector(":scope > div[aria-hidden]")).toBeNull();
    expect(proj?.querySelector('[data-testid="regiao-indisponivel"]')).not.toBeNull();
    expect(proj?.textContent).not.toMatch(/\d%/);
    // A Parcial do Sudeste continua com número; as outras regiões, intactas.
    expect(legenda(doc, "sudeste", "parcial").length).toBeGreaterThan(0);
    expect(legenda(doc, "sul", "proj").length).toBeGreaterThan(0);
  });

  it("🔴 anulada FORA: dar-lhe um mar de votos não muda o consolidado", async () => {
    const antes = legenda(await govPage(), "norte", "parcial");
    const anuladas = gov.por_uf
      .filter((u) => rowsDe(gov, "norte").includes(u))
      .flatMap((u) => u.top_candidatos.filter((t) => t.destino === "anulado"));
    expect(anuladas.length).toBeGreaterThan(0); // a fixture tem anulada no Norte (RO)
    for (const t of anuladas) t.votos_atuais = 1e9;
    expect(legenda(await govPage(), "norte", "parcial")).toEqual(antes);
  });

  it("🔴 filtro de status muda os cartões, NUNCA o consolidado", async () => {
    const todas = await govPage();
    const filtrada = await govPage("decididos_1t");
    const resumo = (d: Document) =>
      foraDoCartao(d.querySelectorAll("[data-regiao] [data-view-only]")).map((e) => e.outerHTML);
    expect(resumo(filtrada)).toEqual(resumo(todas));
    const n = (d: Document) => d.querySelectorAll("[data-regiao] article").length;
    expect(n(todas)).toBe(27);
    expect(n(filtrada)).toBeLessThan(27);
    // Região sem nenhum cartão no filtro: fica, recolhida, com o aviso.
    const vazias = [...filtrada.querySelectorAll("[data-regiao]")].filter(
      (r) => r.querySelectorAll("article").length === 0,
    );
    expect(filtrada.querySelectorAll("[data-regiao]")).toHaveLength(5);
    for (const r of vazias) {
      expect(r.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
      expect(r.querySelector('[data-testid="regiao-filtro-vazio"]')).not.toBeNull();
    }
  });

  it("regiões vêm ABERTAS, com as duas bases no DOM, e o kicker diz 'não oficial'", async () => {
    const doc = await govPage();
    for (const r of doc.querySelectorAll("[data-regiao]")) {
      expect(r.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
      expect(r.querySelector('[data-testid="regiao-corpo"]')?.getAttribute("data-fechado")).toBe(
        "false",
      );
      expect(r.querySelector('[data-view-only="proj"]')).not.toBeNull();
      expect(r.querySelector('[data-view-only="parcial"]')).not.toBeNull();
    }
    const kickers = [...doc.querySelectorAll('[data-testid="panel-kicker"]')].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Corridas estaduais · não oficial");
  });
});

describe("/governador — cartões nas duas bases (04/10/2026)", () => {
  const linhas = (el: Element | null | undefined) =>
    [...(el?.querySelectorAll("li") ?? [])].map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

  it("🔴 cada cartão: Projeção com `pct`; Parcial com `pct_atual`, na ordem do apurado", async () => {
    const doc = await govPage();
    const cartoes = [...doc.querySelectorAll("[data-regiao] article")];
    expect(cartoes).toHaveLength(27);
    for (const art of cartoes) {
      expect(art.querySelectorAll(":scope > [data-view-only='proj'] > ul")).toHaveLength(1);
      expect(art.querySelectorAll(":scope > [data-view-only='parcial'] > ul")).toHaveLength(1);
    }
    // AC no simulado: a projeção põe Tião Bocalom à frente; o apurado, Alan Rick.
    const ac = gov.por_uf.find((u) => u.sigla === "AC") as EdgeUfRow;
    const art = cartoes.find((a) => a.querySelector("h3")?.textContent?.includes("· AC"));
    const proj = linhas(art?.querySelector("[data-view-only='proj']"));
    const parcial = linhas(art?.querySelector("[data-view-only='parcial']"));
    const porProj = [...ac.top_candidatos].slice(0, 4);
    const porAtual = [...ac.top_candidatos].sort(
      (a, b) => (b.pct_atual as number) - (a.pct_atual as number) || b.pct - a.pct || a.id - b.id,
    );
    expect(porProj[0]?.id).not.toBe(porAtual[0]?.id); // a fixture discrimina
    expect(proj[0]).toContain(formatPercentTrim(porProj[0]?.pct as number));
    expect(parcial[0]).toContain(formatPercentTrim(porAtual[0]?.pct_atual as number));
    expect(parcial[0]).toMatch(/2º turno · na parcial|Venceria no 1º turno · na parcial/);
    expect(parcial.join(" ")).not.toMatch(/eleito|projeção|EM APURAÇÃO/i);
    // O filtro por etiqueta conta `[data-etq]` por cartão: continua 1 por UF.
    expect(doc.querySelectorAll("[data-regiao] article").length).toBe(27);
  });
});

describe("/senador — agrupado por região", () => {
  it("regiões em ordem, 27 links, consolidado por partido em '% dos votos'", async () => {
    const doc = await render(SenadoPage());
    expect(
      [...doc.querySelectorAll("[data-regiao]")].map((r) => r.getAttribute("data-regiao")),
    ).toEqual(REGIOES.map((r) => r.id));
    expect(doc.querySelectorAll('a[data-testid="corrida-uf"]')).toHaveLength(27);
    const bases = foraDoCartao(doc.querySelectorAll("[data-regiao] [data-view-only]")).map(
      (e) => e.textContent,
    );
    for (const b of bases) {
      expect(b).toMatch(/· % dos votos$/);
      expect(b).not.toContain("válidos em disputa");
    }
    // O alvo do `aria-describedby` do mapa do Senado continua lá, uma vez só.
    expect(doc.querySelectorAll("#corridas-heading")).toHaveLength(1);
    // Cartão dentro da região: título h4 (região é h3, painel h2).
    expect(doc.querySelector('[data-uf="SP"] article h4')?.textContent).toContain("São Paulo");
  });

  it("🔴 Parcial do Sul = Σ votos_atuais por partido (dois candidatos do PL em SC somam)", async () => {
    const doc = await render(SenadoPage());
    for (const base of ["parcial", "proj"] as const) {
      expect(legenda(doc, "sul", base)).toEqual(esperado(rowsDe(sen, "sul"), base, porPartido));
    }
  });
});

describe("home de Presidente — seção por região", () => {
  it("entra ANTES do Placar por estado, sem duplicar o id do Placar", async () => {
    const doc = await render(HomePage());
    const regioes = doc.getElementById("regioes-presidente-heading");
    const placar = doc.getElementById("state-grouped-table-heading");
    expect(regioes).not.toBeNull();
    expect(placar).not.toBeNull();
    expect(
      (regioes as Element).compareDocumentPosition(placar as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(doc.querySelectorAll("#state-grouped-table-heading")).toHaveLength(1);
  });

  it("🔴 consolidado por CANDIDATO (número de urna), 27 cartões sem selo, link para /uf/X", async () => {
    const doc = await render(HomePage());
    const links = [...doc.querySelectorAll('a[data-testid="corrida-uf-pres"]')];
    expect(links).toHaveLength(27);
    expect(links[0]?.getAttribute("href")).toBe("/uf/AC");
    for (const a of links) {
      expect(a.textContent).not.toMatch(/VAI A 2T|ELEITO|EM APURAÇÃO/);
      expect(a.querySelector("article")?.getAttribute("aria-label")).not.toMatch(/eleito/i);
    }
    // Legenda por candidato: rótulos são NOMES, e a soma por id bate com a mão.
    const porId = (t: { id: number }) => String(t.id);
    const mao = esperado(rowsDe(pres, "sudeste"), "parcial", porId);
    const tela = legenda(doc, "sudeste", "parcial");
    expect(tela).toHaveLength(mao.length);
    expect(tela.map((l) => l.replace(/^.* /, ""))).toEqual(mao.map((l) => l.replace(/^.* /, "")));
    expect(tela[0]).not.toMatch(/^\d/);
  });

  it("fase pré: a seção não existe (RF-154/161)", async () => {
    pres.fase = "pre_eleicao";
    const doc = await render(HomePage());
    expect(doc.getElementById("regioes-presidente-heading")).toBeNull();
    expect(doc.querySelectorAll("[data-regiao]")).toHaveLength(0);
  });
});

/**
 * A cor que `GovernorCard.module.css` dá a um nó — cascata EMULADA: das regras
 * com `color` cujo seletor casa com o nó (`.c` vira `[class*="_c_"]`, o nome
 * que o vitest dá à classe do módulo), vale a de MAIOR especificidade e, no
 * empate, a última. O happy-dom não aplica a folha do módulo, então quem
 * decide é este laço — e ele usa `Element.matches` com o seletor REAL do
 * arquivo, não uma cópia escrita no teste.
 */
function corDoCartao(el: Element): string | undefined {
  const css = readFileSync(
    resolve(__dirname, "../../components/blocks/GovernorCard.module.css"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");
  const especificidade = (sel: string): number => {
    const attrs = (sel.match(/\[[^\]]+\]/g) ?? []).length;
    const semAttr = sel.replace(/\[[^\]]+\]/g, "");
    const classes = (semAttr.match(/\.[\w-]+/g) ?? []).length;
    const pseudos = (semAttr.match(/:(?!:)[\w-]+/g) ?? []).length;
    const tipos = (
      semAttr.replace(/:[\w-]+(\([^)]*\))?/g, "").match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []
    ).length;
    return (attrs + classes + pseudos) * 100 + tipos;
  };
  let melhor: { esp: number; cor: string } | undefined;
  for (const m of css.matchAll(/(?<=^|\}) ?([^{}@]+?) ?\{([^}]*)\}/g)) {
    const cor = /(?:^|;) ?color: ([^;]+?) ?(?:;|$)/.exec(m[2] ?? "")?.[1];
    if (!cor) continue;
    for (const sel of (m[1] ?? "").split(",").map((s) => s.trim())) {
      const real = sel.replace(/\.c(?![\w-])/g, '[class*="_c_"]');
      let casa = false;
      try {
        casa = el.matches(real);
      } catch {
        casa = false;
      }
      if (!casa) continue;
      const esp = especificidade(sel);
      if (!melhor || esp >= melhor.esp) melhor = { esp, cor: cor.trim() };
    }
  }
  return melhor?.cor;
}

describe("home de Presidente — cartões nas duas bases (04/10/2026, à tarde)", () => {
  // O defeito da captura do dono: sob o resumo "Parcial · % dos votos válidos
  // em disputa" da região, cada cartão de UF listava LULA 44,4%, FLAVIO
  // 32,5% (AL) — a PROJEÇÃO (`pct`), em ocre. O apurado de AL na fixture é
  // 41,31% / 35,87%. Na visão Parcial o cartão tem de mostrar o apurado, na
  // cor da parcial; na Projeção, a projeção, na cor da projeção.
  const pctsDe = (el: Element | null | undefined) =>
    [...(el?.querySelectorAll(":scope > ul > li > span:nth-child(4)") ?? [])] as Element[];

  it("🔴 os 27 cartões: Parcial com `pct_atual` (ordem do apurado), Projeção com `pct`", async () => {
    const doc = await render(HomePage());
    const links = [...doc.querySelectorAll('a[data-testid="corrida-uf-pres"]')];
    expect(links).toHaveLength(27);
    for (const a of links) {
      const art = a.querySelector("article");
      expect(art?.querySelectorAll(":scope > [data-view-only='proj'] > ul")).toHaveLength(1);
      expect(art?.querySelectorAll(":scope > [data-view-only='parcial'] > ul")).toHaveLength(1);
    }
    const al = pres.por_uf.find((u) => u.sigla === "AL") as EdgeUfRow;
    const art = doc.querySelector('a[data-uf="AL"] article');
    const proj = pctsDe(art?.querySelector(":scope > [data-view-only='proj']"));
    const parcial = pctsDe(art?.querySelector(":scope > [data-view-only='parcial']"));
    const porAtual = [...al.top_candidatos]
      .filter((t) => t.destino !== "anulado")
      .sort(
        (a, b) => (b.pct_atual as number) - (a.pct_atual as number) || b.pct - a.pct || a.id - b.id,
      );
    // a fixture discrimina: projetado ≠ apurado no líder de AL
    expect(al.top_candidatos[0]?.pct).not.toBe(al.top_candidatos[0]?.pct_atual);
    expect(proj[0]?.textContent).toBe(formatPercentTrim(al.top_candidatos[0]?.pct as number));
    expect(parcial[0]?.textContent).toBe(formatPercentTrim(porAtual[0]?.pct_atual as number));
    // Presidente segue sem selo de UF também na Parcial (ADR-0055).
    expect(art?.textContent).not.toMatch(
      /VAI A 2T|ELEITO|EM APURAÇÃO|FECHARIA|IRIA AO 2T|turno|Vaga/,
    );
    expect(
      art?.querySelector(":scope > [data-view-only='parcial'] > ul")?.getAttribute("aria-label"),
    ).toMatch(/^Na parcial, na frente no estado: /);
  });

  it("🔴 a cor segue o número: Parcial ⇒ `--color-pct-votos`; Projeção ⇒ `--color-pct-proj`", async () => {
    const doc = await render(HomePage());
    const arts = [...doc.querySelectorAll('a[data-testid="corrida-uf-pres"] article')];
    let medidos = 0;
    for (const art of arts) {
      for (const el of pctsDe(art.querySelector(":scope > [data-view-only='parcial']"))) {
        expect(corDoCartao(el), `${art.getAttribute("aria-label")}: parcial`).toBe(
          "var(--color-pct-votos)",
        );
        medidos++;
      }
      for (const el of pctsDe(art.querySelector(":scope > [data-view-only='proj']"))) {
        expect(corDoCartao(el), `${art.getAttribute("aria-label")}: projeção`).toBe(
          "var(--color-pct-proj)",
        );
        medidos++;
      }
    }
    // 27 UFs × (4 + Outros) × 2 bases — o laço mediu de verdade.
    expect(medidos).toBeGreaterThanOrEqual(27 * 4 * 2);
  });
});

describe("<GovernorCard cargo='pres'>", () => {
  it("sem selo e sem status no aria-label; gov no mesmo dado tem selo", () => {
    const uf = clone(gov.por_uf.find((u) => u.vai_a_2t === true) as EdgeUfRow);
    const pres = renderToStaticMarkup(<GovernorCard uf={uf} candidatos={[]} cargo="pres" />);
    const govHtml = renderToStaticMarkup(<GovernorCard uf={uf} candidatos={[]} />);
    expect(govHtml).toContain("2º turno · projeção");
    expect(pres).not.toMatch(/VAI A 2T|ELEITO|EM APURAÇÃO|turno|eleito/i);
    expect(pres).not.toMatch(/vai ao segundo turno|em apuração/);
    expect(pres).toMatch(/aria-label="[^"]*na frente no estado: /);
  });
});

describe("<GovernorCard> — markup enxuto (2026-09-28)", () => {
  it("o selo sai no líder que compete — e, no 2º turno pela projeção, também no 2º", () => {
    // 2026-10-04 (auditoria P1) — "2º turno · projeção" marca os DOIS
    // finalistas (o par do `<ResultPanel>`); os demais desfechos, só o líder.
    for (const uf of gov.por_uf) {
      const doc = new DOMParser().parseFromString(
        renderToStaticMarkup(<GovernorCard uf={uf} candidatos={[]} />),
        "text/html",
      );
      const selos = [...doc.querySelectorAll("b[data-s]")];
      const posicoes = selos.map((b) => b.closest("li")?.firstElementChild?.textContent);
      if (uf.vai_a_2t === true) expect(posicoes).toEqual(["1°", "2°"]);
      else expect(posicoes).toEqual(["1°"]);
    }
  });

  it("só dado no style: cada trilho carrega --w e --cor, e nada mais tem style", () => {
    const uf = gov.por_uf[0] as EdgeUfRow;
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<GovernorCard uf={uf} candidatos={[]} />),
      "text/html",
    );
    const comStyle = [...doc.querySelectorAll("[style]")].filter(
      (e) => e.getAttribute("data-destino") === null, // `<DestinoEtiqueta>` é átomo compartilhado
    );
    expect(comStyle.length).toBeGreaterThan(0);
    for (const e of comStyle) {
      expect(e.tagName).toBe("I");
      expect(e.getAttribute("style")).toMatch(/^--w:[\d.]+%;--cor:var\(--[a-z-]+\)$/);
    }
  });
});

describe("<RegiaoRecolhivel> — abrir/fechar recolhe a altura, nunca remove", () => {
  it("clicar alterna aria-expanded e data-fechado; os cartões seguem no DOM", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <RegiaoRecolhivel
          nome="Norte"
          contagem="7 estados"
          nivel={3}
          regiaoId="norte"
          resumo={<p>r</p>}
        >
          <article>AC</article>
          <article>AM</article>
        </RegiaoRecolhivel>,
      ),
    );
    const btn = container.querySelector("h3 button") as HTMLButtonElement;
    const corpo = container.querySelector('[data-testid="regiao-corpo"]') as HTMLElement;
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe(corpo.id);
    expect(corpo.dataset.fechado).toBe("false");

    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(corpo.dataset.fechado).toBe("true");
    expect(corpo.querySelectorAll("article")).toHaveLength(2);

    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    act(() => root.unmount());
    container.remove();
  });
});

describe("RegiaoConsolidada.module.css — o contrato que o happy-dom não mede", () => {
  const css = readFileSync(
    resolve(__dirname, "../../components/blocks/RegiaoConsolidada.module.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("fechar recolhe a ALTURA — nunca display:none/visibility (ADR-0017 / ADR-0034 D21)", () => {
    const regra = /\.corpo\[data-fechado="true"\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(regra).toMatch(/height:\s*0/);
    expect(regra).toMatch(/overflow:\s*hidden/);
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    // com foco de teclado dentro, o corpo reabre
    expect(css).toMatch(/\.corpo\[data-fechado="true"\]:not\(:focus-within\)/);
  });

  it("contorno da barra e das amostras = DATA_FILL_STROKE", () => {
    for (const sel of [".resumo > div", ".resumo > ul > li > i"]) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
      const regra = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(regra).toContain(`border: ${DATA_FILL_STROKE}`);
    }
  });
});
