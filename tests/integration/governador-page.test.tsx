// @vitest-environment happy-dom
/**
 * tests/integration/governador-page.test.tsx
 *
 * Smoke da `/governador` (spec 006 — grid nacional governadores).
 *
 * Estratégia
 *   - `readProjection({cargo:"gov"})` retorna `null` sem `EDGE_CONFIG` (dev/test)
 *     → page cai pro `emptyPayload()` graceful. Cobre estrutura mesmo sem dados.
 *   - Para validar grid populado, injetamos um payload via mock do reader.
 *
 * Cobertura
 *   - RFs 021/022/025/029 + RF-006.1 (RaceStatsCards) + RF-006.2 (filtros).
 *   - Estrutura: HexCartogram, GovernorCard, Footer. A navegação de cargo saiu
 *     daqui em S07/Bloco 1 (agora `<CargoTabs>` no shell, ADR-0025 § 2).
 *
 * Estes smokes NÃO testam a regressão `useRouter` SSR do mapa nacional
 * (que afeta `home-page.test.tsx`) — `/governador` não monta o mapa
 * MapLibre, só o hex cartogram (SVG inline).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GovernadorGridPage from "@/app/(gov)/governador/page";
import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";

const VAI_A_2T_DO_BUCKET: Record<EdgeUfRow["bucket"], boolean | null> = {
  chamada: false,
  decidido_1t: false,
  vai_2t: true,
  indefinido: null,
};

// Helper pra construir um payload de governador com bucket diverso.
function buildPayload(buckets: Array<EdgeUfRow["bucket"]>, comParticipacao = true): EdgePayload {
  const candidatos = [
    {
      id: 1,
      nome: "Tarcísio",
      partido: "REP",
      cor: "var(--color-cand-1)",
      votos_atuais: 0,
      votos_projetados: 0,
      pct_atual: 0,
      pct_projetado: 52,
      pct_projetado_lower: 50,
      pct_projetado_upper: 54,
      p_vitoria: 0.7,
      rank: 1,
      p_passa_2t: 1,
      p_fecha_1t: 0.4,
    },
    {
      id: 2,
      nome: "Boulos",
      partido: "PSOL",
      cor: "var(--color-cand-2)",
      votos_atuais: 0,
      votos_projetados: 0,
      pct_atual: 0,
      pct_projetado: 38,
      pct_projetado_lower: 36,
      pct_projetado_upper: 40,
      p_vitoria: 0.3,
      rank: 2,
      p_passa_2t: 1,
      p_fecha_1t: 0.0,
    },
  ];
  const SIGLAS = [
    "AC",
    "AL",
    "AM",
    "AP",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MG",
    "MS",
    "MT",
    "PA",
    "PB",
    "PE",
    "PI",
    "PR",
    "RJ",
    "RN",
    "RO",
    "RR",
    "RS",
    "SC",
    "SE",
    "SP",
    "TO",
  ];
  const por_uf: EdgeUfRow[] = SIGLAS.map((sigla, i) => ({
    sigla,
    pct_apurado: 50,
    lider: 1,
    margem_atual: 14,
    margem_projetada: 14,
    margem_projetada_ci: [10, 18] as [number, number],
    chamada: buckets[i % buckets.length] === "chamada",
    swing_vs_2022: 0,
    // Spec 018 / ADR-0042 — `nome`/`partido` viajam na PRÓPRIA linha da UF, e
    // é de lá que `<GovernorCard />` os lê. Antes desta spec a fixture os
    // omitia e o componente caía no índice sobre `national.candidatos` — que
    // em cargo 3 é a união de 27 corridas sob o mesmo espaço de `id`, ou seja,
    // exatamente o defeito que o ADR-0042 previne. Payload pós-018; o caso
    // pré-018 (campos ausentes → placeholder) tem teste dedicado em
    // `tests/unit/components/GovernorCard.test.tsx`, caso "(j)".
    top_candidatos: [
      { id: 1, pct: 52, nome: "Tarcísio", partido: "REP" },
      { id: 2, pct: 38, nome: "Boulos", partido: "PSOL" },
    ],
    // RF-006.8 (2026-09-27) — selo, filtro e placar leem `vai_a_2t`, não
    // `bucket`. O valor é o que o produtor grava para cada bucket; `null` em
    // tudo fazia a fixture descrever uma noite sem nenhum desfecho.
    vai_a_2t: VAI_A_2T_DO_BUCKET[buckets[i % buckets.length] ?? "indefinido"],
    bucket: buckets[i % buckets.length] ?? "indefinido",
  }));
  const payload: EdgePayload = {
    ts: "2026-10-04T17:30:00-03:00",
    cargo: 3,
    turno: 1,
    pct_apurado_total: 50,
    ufs_apuradas: 27,
    national: {
      candidatos,
      needle_position: 0.4,
      needle_band: "lean_a",
      candidato_a_id: 1,
      candidato_b_id: 2,
      p_segundo_turno_overall: 0.3,
      cenarios_2t: [],
      chamadas_recentes: [
        { ts: "2026-10-04T17:25:00-03:00", texto: "SP chamada para Tarcísio (REP)." },
      ],
    },
    por_uf,
    insights: [],
    composition: { pre_election: 0.4, model: 0.3, actual_results: 0.3 },
  };
  if (comParticipacao) {
    payload.national.participacao = {
      abstencao: {
        pct_atual: 21.6,
        pct_projetado: 22.4,
        lower: 20.9,
        upper: 23.9,
        base: "eleitores_instalados",
      },
      brancos_nulos: {
        pct_atual: 7.8,
        pct_projetado: 8.1,
        lower: 7.3,
        upper: 9.0,
        base: "comparecimento",
      },
    };
  }
  return payload;
}

/** Alternado por teste — permite exercitar o payload sem `participacao`. */
let comParticipacao = true;

/**
 * Qual payload o reader mockado devolve (spec 006, RF-006.6/7 — o painel
 * "1º ou 2º turno" só existe na fase normal do 1º turno):
 *   - `normal` — 1º turno, fase normal;
 *   - `pre`    — `fase: "pre_eleicao"` (RF-153);
 *   - `vazio`  — nenhum payload (ramo `AguardandoGovernadores`);
 *   - `turno2` — só a chave do 2º turno existe;
 *   - `chamada2t` — 27 UFs `bucket: "chamada"` com `vai_a_2t: true` (margem
 *     grande E 2º turno — ES, GO e MG do simulado de 26/09, RF-006.8).
 *   - `definidos` — o `normal` + SP com `eleitos_definidos: [1]` e RJ com
 *     `segundo_turno_definido` (faixa "AGORA", decisão do dono 04/10).
 */
let modo: "normal" | "pre" | "vazio" | "turno2" | "chamada2t" | "definidos" = "normal";

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: vi.fn(async (opts?: { cargo?: string; turno?: number }) => {
    if (opts?.cargo === "gov") {
      if (modo === "vazio") return null;
      if (modo === "chamada2t") {
        const p = buildPayload(["chamada"], comParticipacao);
        for (const uf of p.por_uf) uf.vai_a_2t = true;
        return p;
      }
      if (modo === "turno2") {
        if (opts.turno !== 2) return null;
        const p = buildPayload(["vai_2t"], comParticipacao);
        p.turno = 2;
        for (const uf of p.por_uf) uf.vai_a_2t = null;
        return p;
      }
      // 9 decidido_1t, 14 vai_2t, 4 indefinido como pedido no smoke mental.
      const buckets: Array<EdgeUfRow["bucket"]> = [];
      for (let i = 0; i < 9; i++) buckets.push("decidido_1t");
      for (let i = 0; i < 14; i++) buckets.push("vai_2t");
      for (let i = 0; i < 4; i++) buckets.push("indefinido");
      const p = buildPayload(buckets, comParticipacao);
      if (modo === "pre") p.fase = "pre_eleicao";
      if (modo === "definidos") {
        for (const uf of p.por_uf) {
          // `lider: 1` em toda UF; o definido em SP é o 2 — o nome tem de sair
          // do id definido, nunca do líder projetado.
          if (uf.sigla === "SP") uf.eleitos_definidos = [2];
          if (uf.sigla === "RJ") uf.segundo_turno_definido = true;
        }
      }
      return p;
    }
    return null;
  }),
  readNationalProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
}));

describe("GovernadorGridPage (integration / smoke)", () => {
  beforeEach(() => {
    comParticipacao = true;
    modo = "normal";
  });

  it("(a) renderiza header 'Governadores 2026'", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Governadores 2026");
  });

  it("(b) a navegação de cargo NÃO é mais desta página — é do shell global", async () => {
    // S07/Bloco 1: as abas de cargo (incluindo as desabilitadas) saíram do
    // `<RaceHeader>` e viraram `<CargoTabs>` dentro do `<TopBar>` de
    // `app/layout.tsx` (ADR-0025 § 2), renderizadas uma vez por documento em
    // vez de uma vez por página. RF-029 continua coberto — agora em
    // `tests/unit/components/CargoTabs.test.tsx`. O que este smoke garante é
    // que a página não duplica a navegação: duas listas de cargo na mesma
    // tela seriam dois landmarks disputando o mesmo papel.
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);

    expect(html).not.toContain('href="/"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("Assembleias");
  });

  // 2026-09-09 (decisão D23): `<RaceStatsCards>` saiu desta rota — não tem
  // contraparte no protótipo do kit. O componente segue no repositório e sua
  // cobertura própria segue em `tests/unit/components/RaceStatsCards.test.tsx`;
  // esta era a única página que o montava. O que este smoke passa a garantir é
  // que a contagem por status NÃO sumiu da tela: os filtros nomeiam os mesmos
  // estados e a linha logo abaixo diz quantas corridas cada um tem.
  it("(c) os stats cards saíram; a contagem por status fica com os filtros", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);

    expect(html).not.toContain('data-testid="stat-eleitos"');
    expect(html).not.toContain('data-testid="stat-2t"');
    expect(html).not.toContain('data-testid="stat-em-apuracao"');
    // Até 27/09 esta linha também proibia o TEXTO "Eleitos no 1º turno", como
    // guarda da remoção do `<RaceStatsCards>`. A contagem por desfecho voltou
    // com o placar da spec 006 RF-006.6 (bloco "1º ou 2º turno" abaixo), com
    // outro componente e outra regra — a guarda fica nos `data-testid` do
    // componente removido, que é o que ela sempre quis dizer.

    expect(html).toContain("1º turno pela projeção");
    expect(html).toContain("2º turno pela projeção");
    // 27 UFs na fixture, sem filtro aplicado.
    expect(html).toContain("27 corridas");
  });

  // ADR-0033 § 1: o `<HexCartogramBrasil>` saiu desta página e virou a coluna
  // persistente da moldura, montada por `app/(gov)/layout.tsx` — quem o fixa
  // agora é `tests/unit/shell/persistent-map-frame.test.tsx`. O que este smoke
  // passa a garantir é a AUSÊNCIA: um segundo cartograma na página seria o
  // mesmo mapa duas vezes na mesma tela.
  it("(d) o cartograma NÃO é mais desta página — é da moldura", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("Mapa hexagonal");
    expect(html).not.toContain('aria-labelledby="hex-cartogram-title"');
    // As 27 UFs continuam na página, pelos cards.
    expect(html).toContain("São Paulo");
    expect(html).toContain("Minas Gerais");
  });

  it("(e) renderiza 27 GovernorCards (1 por UF)", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    // Cada GovernorCard tem aria-label começando com nome da UF; conta SP/MG/RJ
    expect(html).toContain("São Paulo");
    expect(html).toContain("Minas Gerais");
    expect(html).toContain("Rio de Janeiro");
    // Líder Tarcísio aparece nos cards
    const matches = html.match(/Tarcísio/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(27);
  });

  it("(f) renderiza filtros e BreakingNewsTicker", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Em disputa");
    expect(html).toContain("1º turno pela projeção");
    expect(html).toContain("2º turno pela projeção");
    expect(html).toContain("Decididas pela projeção");
    // 🔴 2026-10-04 — o payload traz `chamadas_recentes` ("SP chamada para
    // Tarcísio") e nenhuma UF definida: a faixa "AGORA" não aparece.
    expect(html).not.toContain("SP chamada para Tarcísio");
    expect(html).not.toContain('data-testid="breaking-news-ticker"');
  });

  it("🔴 (f2) faixa AGORA: só UF matematicamente definida, nome pelo id definido, 2º turno definido", async () => {
    modo = "definidos";
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).toContain('data-testid="breaking-news-ticker"');
    // Rotativo no SSR: o primeiro item (ordem de sigla) é RJ.
    expect(html).toContain("RJ: 2º turno definido");
    expect(html).not.toContain("SP chamada para");
  });

  it("🔴 (f3) 27 UFs com `chamada` (projeção) e nenhuma definida: sem faixa AGORA", async () => {
    modo = "chamada2t";
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain('data-testid="breaking-news-ticker"');
    expect(html).not.toContain("chamada para");
  });

  it("(g) filtro decididos_1t restringe lista para 9 UFs", async () => {
    const node = await GovernadorGridPage({
      searchParams: Promise.resolve({ status: "decididos_1t" }),
    });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("9 corridas");
  });

  it("(h) renderiza Footer constitucional § 1", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Não oficial");
    expect(html).toContain("TSE");
  });

  // -------------------------------------------------------------------------
  // S07/Fase 2 — ADR-0018 (participação) + ADR-0019 (trilha gov).
  // -------------------------------------------------------------------------

  // 2026-09-09 (D23): o `<TrilhaKicker>` (ADR-0019) saiu — não existe no
  // protótipo. Resta a identidade da trilha no `<main>`, que o CSS usa, e o
  // `<h1>` que nomeia a corrida.
  it("(i) trilha governador: main[data-trilha=gov], sem kicker de trilha", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("gov");
    expect(doc.querySelector("[data-trilha-kicker]")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toBe("Governadores 2026");
  });

  it("🔴 (j) 'Participação do eleitorado' SAIU (dono, 2026-09-27) — com e sem dado", async () => {
    for (const com of [true, false]) {
      comParticipacao = com;
      const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
      const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

      expect(
        doc.querySelector('section[aria-labelledby="projecao-termometros-heading"]'),
      ).toBeNull();
      expect(doc.querySelector('[id^="termometro-"]')).toBeNull();
      expect(doc.querySelector('[data-testid="participacao-nacional-indisponivel"]')).toBeNull();
      expect(doc.body.textContent).not.toContain("Participação do eleitorado");
      expect(doc.body.textContent).not.toContain("Abstenção");

      // A grade das 27 corridas continua.
      expect(doc.body.textContent).toContain("São Paulo");
    }
  });
});

// ---------------------------------------------------------------------------
// S07/Bloco 2 (ADR-0029) — recomposição da grade de governadores.
// ---------------------------------------------------------------------------
describe("GovernadorGridPage — recomposição S07/Bloco 2 (ADR-0029)", () => {
  async function renderGrid(status?: string): Promise<Document> {
    comParticipacao = true;
    const node = await GovernadorGridPage({
      searchParams: Promise.resolve(status ? { status } : {}),
    });
    return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  }

  it("(m) o <Footer> continua DENTRO do <main data-trilha> desta página", async () => {
    const doc = await renderGrid();
    const main = doc.querySelector("main[data-trilha]");
    expect(main).not.toBeNull();
    const footer = main?.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("Não oficial");
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
  });

  // ADR-0033 § 1 substitui a asserção anterior deste teste ("o cartograma é o
  // primeiro conteúdo"). O mapa não é mais um bloco desta página: é a coluna
  // persistente do `<AppShellSplit>`, montada por `app/(gov)/layout.tsx`, e o
  // primeiro conteúdo do `<main>` passa a ser o painel de resultado.
  it("(n) o primeiro conteúdo do `<main>` é o painel de resultado", async () => {
    const doc = await renderGrid();
    const main = doc.querySelector("main[data-trilha='gov']");
    const painel = doc.querySelector("#resultado-heading");
    expect(main).not.toBeNull();
    expect(painel).not.toBeNull();
    expect(painel?.closest("main")).toBe(main);
    expect(doc.querySelector('section[aria-labelledby="hex-cartogram-heading"]')).toBeNull();
  });

  it("(o) exatamente um <h1> — 'Governadores 2026', título do painel", async () => {
    const doc = await renderGrid();
    const h1s = doc.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe("Governadores 2026");
    expect(h1s[0]?.getAttribute("id")).toBe("resultado-heading");
  });

  it("(p) os filtros de status têm alvo de toque de --tap-min (44px), não 28px", async () => {
    const doc = await renderGrid();
    const filtros = [...doc.querySelectorAll('[data-testid="governador-filtro"]')];
    expect(filtros).toHaveLength(5);
    for (const f of filtros) {
      const style = f.getAttribute("style") ?? "";
      expect(style).toContain("min-height:var(--tap-min)");
      // Nenhuma medida de padding vertical fixa reintroduzindo a altura antiga.
      expect(f.getAttribute("class")).not.toContain("py-1.5");
    }
  });

  it("(q) o filtro ativo não depende só de cor — carrega aria-current", async () => {
    const doc = await renderGrid("vai_2t");
    const ativos = [...doc.querySelectorAll('[data-testid="governador-filtro"]')].filter(
      (f) => f.getAttribute("aria-current") === "page",
    );
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.textContent).toBe("2º turno pela projeção");
    expect(ativos[0]?.getAttribute("data-active")).toBe("true");
  });

  it("(r) nenhum <Panel> fica vazio (filete órfão)", async () => {
    const doc = await renderGrid();
    const panels = [...doc.querySelectorAll('[data-testid="panel"]')];
    // Eram 4 até o ADR-0033 § 1; o `<Panel>` que embrulhava o cartograma saiu
    // com ele para a moldura persistente, que não é um `<Panel>`.
    expect(panels.length).toBeGreaterThanOrEqual(3);
    for (const p of panels) {
      expect((p.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("(s) o kicker da seção de resultado carrega o 'não oficial' (constituição § 1)", async () => {
    const doc = await renderGrid();
    const kickers = [...doc.querySelectorAll('[data-testid="panel-kicker"]')].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Projeção Atlas Menna · não oficial");
  });
});

describe("spec 021 RF-192 / spec 022 RF-200 emendados (2026-09-26, noite)", () => {
  it("🔴 /governador NÃO tem 'Votação' nem 'A corrida' — os dois vivem na tela de UF", async () => {
    const node = await GovernadorGridPage({ searchParams: Promise.resolve({}) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
    // O `<Panel>` destes blocos rendia SEMPRE (com dado ou `<DetailUnavailable>`),
    // então a ausência do heading discrimina independentemente do payload.
    expect(doc.querySelector('[aria-labelledby="votacao-eleitorado-heading"]')).toBeNull();
    expect(doc.querySelector('[aria-labelledby="corrida-tres-circulos-heading"]')).toBeNull();
    expect(doc.querySelector('[data-testid="votacao-eleitorado"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec 006 — RF-006.6 / RF-006.7 / RF-006.8 (2026-09-27, decisão do dono)
// ---------------------------------------------------------------------------
describe("GovernadorGridPage — painel '1º ou 2º turno' (RF-006.6/7/8)", () => {
  beforeEach(() => {
    comParticipacao = true;
    modo = "normal";
  });

  async function render(status?: string): Promise<Document> {
    const node = await GovernadorGridPage({
      searchParams: Promise.resolve(status ? { status } : {}),
    });
    return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  }

  it("(t) fase normal do 1º turno: o painel existe, com as DUAS bases e os dois gráficos", async () => {
    const doc = await render();
    const painel = doc.querySelector('[data-testid="desfecho-turno"]');
    expect(painel).not.toBeNull();
    expect(doc.querySelector("#desfecho-turno-heading")?.textContent).toBe("1º ou 2º turno");
    expect(doc.querySelector("#desfecho-projecao-heading")?.textContent).toBe("Pela projeção");
    expect(doc.querySelector("#desfecho-contagem-heading")?.textContent).toBe(
      "Se a apuração parasse agora",
    );
    const placares = [...doc.querySelectorAll('[data-testid="placar-turno"]')];
    expect(placares.map((p) => p.getAttribute("data-base"))).toEqual(["projecao", "contagem"]);
    const partidos = [...doc.querySelectorAll('[data-testid="por-partido"]')];
    expect(partidos.map((p) => p.getAttribute("data-base"))).toEqual(["projecao", "contagem"]);
    // Entre o painel de resultado e a grade das 27 corridas.
    const resultado = doc.querySelector("#resultado-heading");
    const filtros = doc.querySelector('nav[aria-label="Filtros por status"]');
    expect(
      resultado &&
        painel &&
        resultado.compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      painel &&
        filtros &&
        painel.compareDocumentPosition(filtros) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("🔴 (t2) cada leitura segue a chave: projeção só em 'Projeção', contagem só em 'Parcial' (dono, 2026-09-27)", async () => {
    const doc = await render();
    const baseDa = (headingId: string) =>
      doc.querySelector(`#${headingId}`)?.closest("section")?.getAttribute("data-view-only");
    expect(baseDa("desfecho-projecao-heading")).toBe("proj");
    expect(baseDa("desfecho-contagem-heading")).toBe("parcial");
    // Os dois gráficos de cada base moram DENTRO da seção da sua base.
    for (const [base, view] of [
      ["projecao", "proj"],
      ["contagem", "parcial"],
    ] as const) {
      for (const tid of ["placar-turno", "por-partido"]) {
        const el = doc.querySelector(`[data-testid="${tid}"][data-base="${base}"]`);
        expect(el?.closest("[data-view-only]")?.getAttribute("data-view-only")).toBe(view);
      }
    }
  });

  it("(u) o placar da projeção bate com o filtro 'Decididos no 1º turno' (9) e 'Vão a 2º turno' (14)", async () => {
    const doc = await render();
    const num = (d: string) =>
      doc.querySelector(
        `[data-testid="placar-turno"][data-base="projecao"] [data-desfecho="${d}"] [data-testid="placar-numero"]`,
      )?.textContent;
    expect(num("eleito_1t")).toBe("9");
    expect(num("segundo_turno")).toBe("14");
    expect(num("em_aberto")).toBe("4");
    expect((await render("decididos_1t")).body.textContent).toContain("9 corridas");
    expect((await render("vai_2t")).body.textContent).toContain("14 corridas");
    // em_disputa = tudo que não é eleito no 1º turno: 14 + 4.
    expect((await render("em_disputa")).body.textContent).toContain("18 corridas");
  });

  it("🔴 (u2) `chamada` + `vai_a_2t: true`: selo, filtro e placar dizem 2º turno, os três", async () => {
    modo = "chamada2t";
    const doc = await render();
    const texto = doc.body.textContent ?? "";
    // 2026-10-04 — o selo diz a base ("2º turno · projeção"); "eleito" só
    // com `eleitos_definidos` (auditoria P1).
    expect(texto).not.toMatch(/● ELEITO|Vence no 1º turno · projeção/);
    expect((texto.match(/2º turno · projeção/g) ?? []).length).toBeGreaterThanOrEqual(27);
    expect(
      doc.querySelector(
        '[data-testid="placar-turno"][data-base="projecao"] [data-desfecho="segundo_turno"] [data-testid="placar-numero"]',
      )?.textContent,
    ).toBe("27");
    // O filtro "Decididos no 1º turno" fica vazio; "Vão a 2º turno" traz as 27.
    expect((await render("decididos_1t")).body.textContent).toContain(
      "Nenhuma UF se encaixa no filtro",
    );
    expect((await render("vai_2t")).body.textContent).toContain("27 corridas");
    // "Chamadas" continua por `bucket` — margem decisiva, que é o que o nome diz.
    expect((await render("chamadas")).body.textContent).toContain("27 corridas");
  });

  it("(v) fase pré: o painel NÃO existe", async () => {
    modo = "pre";
    const doc = await render();
    expect(doc.querySelector('[data-testid="desfecho-turno"]')).toBeNull();
    expect(doc.querySelector('[data-testid="placar-turno"]')).toBeNull();
    expect(doc.querySelector('[data-testid="por-partido"]')).toBeNull();
  });

  it("(w) sem payload: o painel NÃO existe", async () => {
    modo = "vazio";
    const doc = await render();
    expect(doc.querySelector('[data-testid="gov-aguardando"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="desfecho-turno"]')).toBeNull();
  });

  it("(x) 2º turno: o painel NÃO existe — não há 'fecha no 1º turno' a contar", async () => {
    modo = "turno2";
    const doc = await render();
    // A página renderiza (a grade das corridas está lá)…
    expect(doc.querySelector('nav[aria-label="Filtros por status"]')).not.toBeNull();
    // …sem o painel.
    expect(doc.querySelector('[data-testid="desfecho-turno"]')).toBeNull();
  });

  // 04/10 (para o 2º turno, 25/10) — a página passa o turno ao cartão: em
  // turno 2 nenhum cartão diz "Vence(ria) no 1º turno" nem selo de base
  // nenhum. Controle: o mesmo `render` em turno 1 tem selos.
  it("🔴 (y) 2º turno: os cartões das UFs saem sem selo de turno [mutação: não passar `turno`]", async () => {
    const controle = await render();
    expect(controle.querySelectorAll("article b[data-s]").length).toBeGreaterThan(0);
    modo = "turno2";
    const doc = await render();
    expect(doc.querySelectorAll("article").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("article b[data-s]")).toHaveLength(0);
  });
});
