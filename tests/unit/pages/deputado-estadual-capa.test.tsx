// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-estadual-capa.test.tsx — spec 027 T-17 (RF-280,
 * RF-282, RF-283, RF-284): a capa `/deputado-estadual`, das 27 casas.
 *
 * Os leitores de dado são simulados CONTANDO chamadas: o nacional por cargo, o
 * Blob de UF (detalhe e lista, de qualquer cargo) e o `fetch` global — a capa
 * não pode ler Blob de UF nenhum (RF-282), e a prova é contar zero.
 *
 * Mutações aplicadas à mão (30/09, frente U-b) e que estes casos derrubam:
 *   - M30: a capa lendo `readDeputadoUfDetail(7, "SP")` — cai "0 leituras de Blob";
 *   - M31: total 1.035 com `dis` ausente — cai "só est: 1.059";
 *   - M32: um "atualizado às" único (só o `est`) — cai "as duas cadências";
 *   - M38: `<CamaraHemiciclo>` na capa — cai "sem plenário".
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeputadoEstadualPage from "@/app/(dep)/deputado-estadual/page";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { cascaVaziaNoDocumento } from "@/tests/e2e/_apoio-local";

import { agremiacao, destaque, linhaUf, payloadCasa, puxador } from "../deputado/_payload-casa";

const readDeputadoProjectionMock = vi.fn();
const readInterruptorProjecaoMock = vi.fn();
const readDeputadoUfDetailMock = vi.fn();
const readDeputadoUfListaMock = vi.fn();
const fetchSpy = vi.fn();

const DESLIGADO = { ligada: false, pct_minimo: 25, origem: "ausente" } as const;

vi.mock("@/lib/edge-config/reader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edge-config/reader")>();
  return {
    ...real,
    readDeputadoProjection: (cargo: number) => readDeputadoProjectionMock(cargo),
    readInterruptorProjecao: (cargo: number) => readInterruptorProjecaoMock(cargo),
  };
});

vi.mock("@/lib/blob/deputado-uf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/deputado-uf")>();
  return {
    ...real,
    readDeputadoUfDetail: (...a: unknown[]) => readDeputadoUfDetailMock(...a),
    readDeputadoUfLista: (...a: unknown[]) => readDeputadoUfListaMock(...a),
  };
});

function porCargo(est: EdgePayloadDeputado | null, dis: EdgePayloadDeputado | null) {
  readDeputadoProjectionMock.mockImplementation(async (cargo: number) =>
    cargo === 7 ? est : cargo === 8 ? dis : null,
  );
}

async function render(): Promise<Document> {
  const markup = renderToStaticMarkup(await DeputadoEstadualPage());
  return new DOMParser().parseFromString(markup, "text/html");
}

function textoDe(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function est() {
  return payloadCasa(7, {
    agremiacoes: [
      agremiacao("22", "PL", 60, { cadeiras_ci95: [55, 66], cadeiras_indefinidas: 2 }),
      agremiacao("13", "PT", 40),
    ],
    porUf: [
      linhaUf("SP", { lugares_a_preencher: 94, cadeiras_definidas: 70 }),
      linhaUf("RR", { lugares_a_preencher: 24, cadeiras_definidas: 24 }),
    ],
    maisVotados: [destaque("SP", 1, 90_000), destaque("SP", 2, 80_000)],
    puxadores: [puxador("SP", 1, 90_000, 3)],
    atualizacaoMin: 60,
    dadoTs: "2026-10-04T23:10:00Z",
  });
}

function dis() {
  return payloadCasa(8, {
    agremiacoes: [agremiacao("22", "PL", 7), agremiacao("50", "PSOL", 3)],
    porUf: [linhaUf("DF", { lugares_a_preencher: 24, cadeiras_definidas: 10 })],
    maisVotados: [destaque("DF", 9, 85_000, { numero: 50123 })],
    atualizacaoMin: 5,
    dadoTs: "2026-10-04T23:35:00Z",
  });
}

beforeEach(() => {
  for (const m of [
    readDeputadoProjectionMock,
    readInterruptorProjecaoMock,
    readDeputadoUfDetailMock,
    readDeputadoUfListaMock,
    fetchSpy,
  ]) {
    m.mockReset();
  }
  readInterruptorProjecaoMock.mockResolvedValue(DESLIGADO);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RF-282 — o que a capa lê", () => {
  it("🔴 M30 — lê SÓ os dois payloads (7 e 8) e o interruptor das assembleias; 0 leituras de Blob", async () => {
    porCargo(est(), dis());
    await render();
    expect(readDeputadoProjectionMock.mock.calls.map((c) => c[0]).sort()).toEqual([7, 8]);
    expect(readInterruptorProjecaoMock.mock.calls).toEqual([[7]]);
    expect(readDeputadoUfDetailMock).not.toHaveBeenCalled();
    expect(readDeputadoUfListaMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("RF-280 — a soma sobre 1.059, com o aviso no mesmo painel", () => {
  it("as duas casas: soma pela chave estável, aguardando = total − Σ, aviso DENTRO do painel da soma", async () => {
    porCargo(est(), dis());
    const doc = await render();
    const painel = doc.querySelector("[aria-labelledby='bancada-heading']");
    expect(painel).not.toBeNull();
    // O aviso está no mesmo painel que a soma.
    expect(painel?.querySelector("[data-testid='soma-aviso']")?.textContent).toContain(
      "soma de 27 casas separadas",
    );
    const linhas = [...(painel?.querySelectorAll("[data-testid='bancada-linha']") ?? [])];
    expect(linhas.map((l) => l.getAttribute("data-cod"))).toEqual(["22", "13", "50"]);
    expect(textoDe(linhas[0]?.querySelector("[data-testid='bancada-cadeiras']"))).toBe("67");
    // 1.059 − 110 = 949.
    expect(textoDe(painel?.querySelector("[data-testid='bancada-aguardando']"))).toMatch(/^949/);
    expect(textoDe(doc.querySelector("[data-testid='casas-cadeiras-label']"))).toContain(
      "1.059 cadeiras",
    );
  });

  it("🔴 M31 — só `est`: total 1.059 (nunca 1.035), e o DF aparece 'aguardando apuração' na grade", async () => {
    porCargo(est(), null);
    const doc = await render();
    expect(textoDe(doc.querySelector("[data-testid='casas-cadeiras-label']"))).toContain(
      "1.059 cadeiras",
    );
    // 1.059 − 100 = 959 aguardando.
    expect(textoDe(doc.querySelector("[data-testid='bancada-aguardando']"))).toMatch(/^959/);
    const df = doc.querySelector("[data-testid='corrida-uf'][data-uf='DF']");
    expect(df?.getAttribute("href")).toBe("/uf/DF/deputado-distrital");
    expect(textoDe(df)).toContain("aguardando apuração");
    // A linha do DF no frescor diz que espera — sem hora inventada.
    expect(
      textoDe(doc.querySelector("[data-testid='casas-atualizacao'] [data-cargo='8']")),
    ).toMatch(/aguardando o primeiro boletim/);
  });

  it("só `dis`: o DF aparece com dado, e as 26 Assembleias estão 'aguardando'", async () => {
    porCargo(null, dis());
    const doc = await render();
    const grade = [...doc.querySelectorAll("[data-testid='corrida-uf']")];
    expect(grade).toHaveLength(27);
    const aguardando = grade.filter((a) => textoDe(a).includes("aguardando apuração"));
    expect(aguardando).toHaveLength(26);
    expect(textoDe(doc.querySelector("[data-testid='corrida-uf'][data-uf='DF']"))).toContain(
      "maior bancada: PL",
    );
  });

  it("sem faixa de cadeiras na soma, mas a 'sobra apertada' fica na linha", async () => {
    porCargo(est(), dis());
    const doc = await render();
    expect(doc.querySelectorAll("[data-testid='bancada-intervalo']")).toHaveLength(0);
    expect(textoDe(doc.querySelector("[data-testid='bancada-indefinidas']"))).toMatch(
      /^2 dessas cadeiras/,
    );
  });
});

describe("RF-282 — frescor por fonte, listas do país, grade, sem plenário", () => {
  it("🔴 M32 — as duas cadências e os dois horários, cada um na linha da sua casa", async () => {
    porCargo(est(), dis());
    const doc = await render();
    const a = textoDe(doc.querySelector("[data-testid='casas-atualizacao'] [data-cargo='7']"));
    const d = textoDe(doc.querySelector("[data-testid='casas-atualizacao'] [data-cargo='8']"));
    expect(a).toMatch(/^Assembleias Legislativas: .*20:10:00, a cada 60 minutos\.$/);
    expect(d).toMatch(/^Câmara Legislativa do Distrito Federal: .*20:35:00, a cada 5 minutos\.$/);
  });

  it("mais votados unem os dois payloads (o DF entra), com o % 'dos válidos de SP' · 'do DF' e o número de 5 dígitos inteiro", async () => {
    porCargo(est(), dis());
    const doc = await render();
    const itens = [...doc.querySelectorAll("[data-testid='dep-mais-votados-pais'] li")];
    expect(itens.map((li) => li.getAttribute("data-uf"))).toEqual(["SP", "DF", "SP"]);
    expect(textoDe(itens[1])).toContain("dos válidos do DF");
    expect(textoDe(itens[1])).toContain("nº 50123");
    expect(textoDe(doc.querySelector("[data-testid='dep-puxadores-pais']"))).toContain("SP");
  });

  it("🔴 M38 — sem plenário nem Câmara 2027; grade das 27 com o DF no distrital", async () => {
    porCargo(est(), dis());
    const doc = await render();
    expect(doc.querySelector("[data-testid^='camara-hemiciclo']")).toBeNull();
    expect(doc.querySelector("svg[aria-labelledby*='hemiciclo']")).toBeNull();
    const grade = [...doc.querySelectorAll("[data-testid='corrida-uf']")];
    expect(grade).toHaveLength(27);
    for (const a of grade) {
      const uf = a.getAttribute("data-uf");
      expect(a.getAttribute("href")).toBe(
        uf === "DF" ? "/uf/DF/deputado-distrital" : `/uf/${uf}/deputado-estadual`,
      );
    }
  });

  it("RF-283 / RF-284 — aba de deputado, seletor no estadual, e nada de Câmara dos Deputados", async () => {
    porCargo(est(), dis());
    const doc = await render();
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
    const atual = doc.querySelector("[data-testid='seletor-deputado'] [aria-current='page']");
    expect(atual?.textContent).toBe("Estadual");
    expect(atual?.getAttribute("href")).toBe("/deputado-estadual");
    const t = textoDe(doc.body);
    expect(t).not.toContain("Câmara dos Deputados");
    expect(t).not.toContain("Deputado Federal");
    expect(doc.querySelector("h1")?.textContent).toContain("Assembleias Legislativas");
  });
});

describe("nenhum payload — três estados, nunca zeros", () => {
  it("diz que aguarda os dados, mostra as 27 casas em links, e não imprime número de cadeira", async () => {
    porCargo(null, null);
    const doc = await render();
    expect(doc.querySelector("[data-testid='casas-aguardando']")?.textContent).toContain(
      "Aguardando os dados",
    );
    const links = [...doc.querySelectorAll("[data-testid='uf-links-grid'] a, nav a[href^='/uf/']")];
    const hrefs = new Set(links.map((a) => a.getAttribute("href")));
    expect(hrefs.has("/uf/DF/deputado-distrital")).toBe(true);
    expect(hrefs.has("/uf/SP/deputado-estadual")).toBe(true);
    expect(hrefs.has("/uf/DF/deputado-estadual")).toBe(false);
    const t = textoDe(doc.body);
    expect(t).not.toMatch(/1\.059|1\.035|\b0 cadeiras/);
    expect(doc.querySelector("[data-testid='bancada-linha']")).toBeNull();
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
  });
});

describe("🔴 portões e2e (RF-289) — o detector de casca conhece a capa sem dado", () => {
  // `cascaVaziaNoDocumento` é o alarme dos portões de peso e de axe para
  // "mediu a página errada". A casca da capa das assembleias não diz nenhuma
  // das frases antigas ("Aguardando os dados." ≠ "Aguardando dados…") — sem
  // a marca `data-testid="casas-aguardando"`, o portão mediria a casca verde.
  const LOCAL = "http://localhost:3100";

  it("sem nenhum payload ⇒ o detector acusa a marca da capa", async () => {
    porCargo(null, null);
    const markup = renderToStaticMarkup(await DeputadoEstadualPage());
    expect(cascaVaziaNoDocumento(markup, LOCAL)).toContain('data-testid="casas-aguardando"');
  });

  it("com os dois payloads ⇒ o detector não acusa nada (o caso normal do portão)", async () => {
    porCargo(est(), dis());
    const markup = renderToStaticMarkup(await DeputadoEstadualPage());
    expect(cascaVaziaNoDocumento(markup, LOCAL)).toEqual([]);
  });
});

describe("spec 027 (véspera 03/10) — a frase das figuras e o DF nas listas do país", () => {
  // Mutações aplicadas à mão e desfeitas (03/10), que estes casos derrubam:
  //   - M-S7: a nota da figura de volta a "de 1.059, somadas as 27 casas" — cai "figuras";
  //   - M-S8: `comArtigo` do `<DeputadoMaisVotados>` fixo em `false` — cai "dos válidos do DF".
  it("🔴 figuras: cadeiras já distribuídas sobre as 1.059 das 27 casas, e casas com a conta feita", async () => {
    porCargo(est(), dis());
    const doc = await render();
    const figuras = [
      ...doc.querySelectorAll("[data-testid='casas-figuras'] [data-testid='figure']"),
    ];
    expect(figuras).toHaveLength(2);
    const [cadeiras, casas] = figuras.map((f) => ({
      label: textoDe(f.querySelector("[data-testid='figure-label']")),
      value: textoDe(f.querySelector("[data-testid='figure-value']")),
      note: textoDe(f.querySelector("[data-testid='figure-note']")),
    }));
    expect(cadeiras?.label).toBe("Cadeiras já distribuídas");
    expect(cadeiras?.note).toBe("das 1.059 cadeiras das 27 casas");
    expect(casas?.label).toBe("Casas com a conta feita");
    expect(casas?.note).toMatch(/^das 27, com os votos já apurados/);
    const tudo = textoDe(doc.querySelector("[data-testid='casas-figuras']"));
    expect(tudo).not.toContain("somadas as");
    expect(tudo).not.toMatch(/\beleit/i);
  });

  it("🔴 mais votados do país: o distrital é 'dos válidos do DF', o estadual 'de SP'", async () => {
    porCargo(est(), dis());
    const doc = await render();
    const lista = doc.querySelector("[data-testid='dep-mais-votados-pais']");
    const df = textoDe(lista?.querySelector("[data-uf='DF']"));
    const sp = textoDe(lista?.querySelector("[data-uf='SP']"));
    expect(df).toContain("dos válidos do DF");
    expect(df).not.toContain("de DF");
    expect(sp).toContain("dos válidos de SP");
  });
});
