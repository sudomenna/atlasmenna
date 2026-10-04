// @vitest-environment happy-dom
/**
 * tests/integration/uf-governador-page.test.tsx
 *
 * Smoke da `/uf/[sigla]/governador` (spec 005 — drill-down UF Gov).
 *
 * Estratégia
 *   - Mocka `readUfProjection({cargo:"gov"})` retornando payload populado
 *     com municípios, mesorregiões opcional, e (em um caso) `model_fallback_tier`
 *     — hoje só para provar que ele NÃO gera mais banner (ADR-0021).
 *   - Renderiza via `renderToStaticMarkup`. Mapas via dynamic import com
 *     ssr:false expandem para placeholder em SSR.
 *
 * Cobertura
 *   - RFs 031..044 (espelho da spec 004 com cargo gov).
 *   - MunicipioWaffleGrid (Print 3), mesorregioes condicional, MunicipioTable
 *     top-by-eleitorado, ausência do antigo disclaimer de K-1.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import UFGovernadorPage from "@/app/(gov)/uf/[sigla]/governador/page";
import type { UfDetailBlob, UfDetailResult } from "@/lib/blob/uf-detail";
import { FASE_PRE_ELEICAO } from "@/lib/config/fase";
import type {
  EdgePayloadUf,
  EdgeSeriePorCandidato,
  EdgeUfMunicipio,
} from "@/lib/edge-config/types";

function makeMunicipio(i: number): EdgeUfMunicipio {
  const liderId = i % 2 === 0 ? 1 : 2;
  return {
    cod_ibge: `35${String(i).padStart(5, "0")}`,
    nome: `Município ${i + 1}`,
    pct_apurado: 60 + (i % 30),
    lider: {
      candidato_id: liderId,
      partido: liderId === 1 ? "REP" : "PSOL",
      votos: 10000 + i * 100,
      margem_pp: 10 + (i % 5),
    },
    votos_reportados: {
      1: liderId === 1 ? 15000 : 8000,
      2: liderId === 2 ? 15000 : 8000,
    },
    // 2026-09-11 (ADR-0035 D2): o payload publica eleitorado por município.
    // Decrescente com `i`, e o índice 0 é a capital.
    //
    // ⚠️ 2026-09-20: a capital deixou de ir para o topo por ser capital — a
    // lista ordena por eleitorado puro. Aqui os dois coincidem (o índice 0 é o
    // maior eleitorado E a capital), então nada neste arquivo distingue as duas
    // regras; quem as distingue é `MunicipioTable.ordem.test.tsx` (g), com uma
    // UF em que elas discordam.
    eleitores: 1_000_000 - i * 1000,
    ...(i === 0 ? { capital: true as const } : {}),
  };
}

function buildUfPayload(opts: {
  municipios: number;
  withMesorregioes: boolean;
  modelTier?: 1 | 2 | 3;
  /** S07/Fase 2 — corrida de 1T com mais de dois nomes (modo multi-1t). */
  multiCandidato?: boolean;
  comParticipacao?: boolean;
  turno?: 1 | 2;
}): EdgePayloadUf {
  const base: EdgePayloadUf = {
    uf: "SP",
    ts: "2026-10-04T17:30:00-03:00",
    cargo: 3,
    turno: 1,
    pct_apurado: 62,
    candidatos: [
      {
        id: 1,
        nome: "Tarcísio",
        partido: "REP",
        cor: "var(--color-cand-1)",
        votos_atuais: 6000000,
        votos_projetados: 9500000,
        pct_atual: 52,
        pct_projetado: 52,
        ci95: { lower: 50, upper: 54 },
      },
      {
        id: 2,
        nome: "Boulos",
        partido: "PSOL",
        cor: "var(--color-cand-2)",
        votos_atuais: 4400000,
        votos_projetados: 7000000,
        pct_atual: 38,
        pct_projetado: 38,
        ci95: { lower: 36, upper: 40 },
      },
    ],
    needle_position: 0.4,
    needle_band: "lean_a",
  };
  base.turno = opts.turno ?? 1;
  if (opts.multiCandidato) {
    base.candidatos = [
      ...base.candidatos,
      {
        id: 3,
        nome: "Marina",
        partido: "REDE",
        cor: "var(--color-cand-3)",
        votos_atuais: 700000,
        votos_projetados: 1100000,
        pct_atual: 6,
        pct_projetado: 6,
        ci95: { lower: 5, upper: 7 },
      },
      {
        id: 4,
        nome: "Datena",
        partido: "PSDB",
        cor: "var(--color-cand-4)",
        votos_atuais: 300000,
        votos_projetados: 500000,
        pct_atual: 3,
        pct_projetado: 3,
        ci95: { lower: 2, upper: 4 },
      },
    ];
  }
  if (opts.comParticipacao) {
    base.participacao = {
      abstencao: {
        pct_atual: 20.4,
        pct_projetado: 21.2,
        lower: 19.9,
        upper: 22.6,
        base: "eleitores_instalados",
      },
      brancos_nulos: {
        pct_atual: 7.1,
        pct_projetado: 7.5,
        lower: 6.8,
        upper: 8.3,
        base: "comparecimento",
      },
      outros: {
        pct_atual: 3.0,
        pct_projetado: 3.2,
        lower: 2.4,
        upper: 4.1,
        base: "votaveis",
        n_candidatos: 1,
      },
    };
  }
  if (opts.withMesorregioes) {
    base.mesorregioes = [
      {
        cod: "3515",
        nome: "Metropolitana de São Paulo",
        pct_apurado: 65,
        lider_candidato_id: 1,
        lider_pct: 51,
        margem: 13,
        delta_vs_2022: 2.4,
        num_municipios: 39,
      },
      {
        cod: "3501",
        nome: "São José do Rio Preto",
        pct_apurado: 60,
        lider_candidato_id: 1,
        lider_pct: 58,
        margem: 22,
        delta_vs_2022: null,
        num_municipios: 96,
      },
    ];
  }
  if (opts.modelTier != null) {
    return { ...base, model_fallback_tier: opts.modelTier };
  }
  return base;
}

const readUfProjectionMock = vi.fn();
/**
 * Spec 020 (RF-174d) — o ramo de espera desta rota passou a perguntar a FASE
 * ao payload NACIONAL desta corrida (`projection-current-gov-t1`), porque a
 * rota não tem payload próprio em fase pré: o semeador grava só as chaves
 * nacionais. Deixa de ser constante para que os DOIS estados possam ser
 * exercitados — nacional semeado e nacional ausente.
 */
const readProjectionMock = vi.fn(
  async (_opts?: { cargo?: string; turno?: number }): Promise<unknown> => null,
);
/**
 * RF-149 (spec 018) — o estado "aguardando dados" desta rota passou a ler a
 * fatia de candidaturas do Blob. Sem este mock o arquivo faz uma requisição de
 * REDE de verdade (`BLOB_PUBLIC_BASE_URL` vem do `.env.local`), que o happy-dom
 * bloqueia por CORS e que degrada para `fetch_error`: passaria, mas por
 * acidente, devagar e dependendo do mundo lá fora. `not_configured` é a
 * degradação declarada — a grade não renderiza, e o que este arquivo mede
 * continua sendo exatamente o que ele media antes.
 *
 * A grade em si é testada em `tests/unit/pages/aguardando-candidatos.test.tsx`.
 */
vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: (opts?: { cargo?: string; turno?: number }) => readProjectionMock(opts),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: (sigla: string, opts?: { cargo?: string }) => readUfProjectionMock(sigla, opts),
}));

/**
 * Desde o ADR-0032 esta página tem DOIS read paths: o resumo no Global Config
 * e o detalhe (municípios + séries) no Vercel Blob. Só `readUfDetail` é
 * mockado — `municipiosFrom`/`seriesFrom` seguem os reais, para o teste
 * exercitar a coalescência de verdade.
 *
 * O default é `unavailable`: sem detalhe explicitamente mockado, a página cai
 * no estado "detalhe indisponível", que é exatamente o comportamento a fixar.
 */
const readUfDetailMock = vi.fn(
  async (): Promise<UfDetailResult> => ({
    status: "unavailable",
    reason: "not_configured",
    url: null,
  }),
);
vi.mock("@/lib/blob/uf-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob/uf-detail")>()),
  readUfDetail: () => readUfDetailMock(),
}));

/** Detalhe de Blob com `n` municípios e séries vazias. */
function buildUfDetail(n: number): UfDetailBlob {
  return {
    ts: "2026-10-04T17:30:00-03:00",
    uf: "SP",
    cargo: "gov",
    turno: 1,
    municipios: Array.from({ length: n }, (_, i) => makeMunicipio(i)),
    series_temporais: { margem: [], p_vitoria: [], turnout: [] },
  };
}

/**
 * Spec 020, Fase 2 — série por candidatura para o Blob desta rota.
 *
 * A ordem do array é a do produtor e não é reproduzível por nenhum critério
 * (nem `apurado`, nem `projetado`, nem `id`), e a cadência DECLARADA (15) é
 * incoerente com o espaçamento real do eixo (5 min): as duas escolhas existem
 * para que um `sort` ou uma inferência no consumidor mudem o resultado.
 */
const SERIE_GOV: EdgeSeriePorCandidato = {
  eixo: ["2026-10-04T20:00:00-03:00", "2026-10-04T20:05:00-03:00", "2026-10-04T20:10:00-03:00"],
  cadencia_min: 15,
  candidatos: [
    {
      id: 30,
      nome: "Terceira Via",
      partido: "PSOL",
      apurado: [12, 11, 10],
      projetado: [12, 12, 12],
    },
    {
      id: 10,
      nome: "Primeira Colocada",
      partido: "PT",
      apurado: [30, null, 32],
      projetado: [31, 31, 31],
    },
    {
      id: 20,
      nome: "Segunda Colocada",
      partido: "PL",
      apurado: [25, 26, 27],
      projetado: [26, 26, 26],
    },
  ],
};

/** Enfileira os dois read paths de uma renderização — resumo e detalhe. */
function mockUf(opts: Parameters<typeof buildUfPayload>[0]): void {
  readUfProjectionMock.mockResolvedValueOnce(buildUfPayload(opts));
  readUfDetailMock.mockResolvedValueOnce({
    status: "ok",
    detail: buildUfDetail(opts.municipios),
    url: "https://example.test/municipios/uf/SP/gov/t1.json",
  });
}

describe("UFGovernadorPage (integration / smoke)", () => {
  it("(a) renderiza header e breadcrumb 'Governadores › SP' apontando pra /governador", async () => {
    mockUf({ municipios: 20, withMesorregioes: false });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

    // S07/Bloco 2 (ADR-0029 § 5): o `<h1>` saiu da primeira dobra e virou o
    // título do painel de resultado, alternando parcial/projeção por cascata.
    // Os dois textos ficam no DOM; o CSS revela um.
    const h1 = doc.querySelectorAll("h1");
    expect(h1).toHaveLength(1);
    expect(h1[0]?.textContent).toContain("Governador SP — Resultado parcial");
    expect(h1[0]?.textContent).toContain("Governador SP — Projeção Atlas Menna");
    // 2026-10-03 — e a bandeira da UF, UMA para os dois textos, decorativa.
    const bandeiras = h1[0]?.querySelectorAll("img") ?? [];
    expect(bandeiras).toHaveLength(1);
    expect(bandeiras[0]?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    expect(bandeiras[0]?.getAttribute("alt")).toBe("");
    // 2026-09-09 (decisão D23): o `<UFBreadcrumb>` (RF-031) saiu — não existe
    // no protótipo do kit. A volta para a grade das 27 corridas fica com o
    // `<CargoTabs>` do shell (`app/layout.tsx`), que este teste não monta.
    expect(doc.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
  });

  // 2026-09-08 — a grade de quadrados (`<MunicipioWaffleGrid>`) saiu desta
  // rota: não existe no protótipo do kit. O teste (b) que a exercitava foi
  // removido; a cobertura do componente segue em
  // `tests/unit/components/MunicipioWaffleGrid.test.tsx`.
  it("(b) a grade de quadrados NÃO está mais na página", async () => {
    mockUf({ municipios: 25, withMesorregioes: false });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain('data-testid="waffle-svg"');
    expect(html).not.toContain("Cada quadrado é um município");
  });

  // 2026-09-08 — o bloco "Apuração por mesorregião" saiu: não tem contraparte
  // no protótipo do kit. O teste (c), que fixava seu conteúdo com
  // `withMesorregioes: true`, foi removido. O que sobra é a invariante do
  // corte: nem com `mesorregioes` populado o bloco volta.
  it("(d) bloco mesorregião AUSENTE mesmo com `mesorregioes` populado", async () => {
    mockUf({ municipios: 20, withMesorregioes: true });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("Apuração por mesorregião");
    expect(html).not.toContain('data-testid="mesorregioes-table"');
  });

  it("(e) a lista paginada de municípios renderiza nesta rota", async () => {
    // 2026-09-20: o `mode="top-by-eleitorado"` (8 linhas, corte duro) saiu.
    // Esta rota passou a montar a MESMA lista das outras duas de estado —
    // ordenada por eleitorado, paginada em 20 + 40.
    mockUf({ municipios: 20, withMesorregioes: false });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

    expect(doc.querySelector('[data-testid="municipios-lista"]')).not.toBeNull();
    expect(doc.querySelector("#municipios-heading")?.textContent).toContain("Municípios (20)");
    // O título antigo do painel não pode voltar: ele afirmaria "maiores
    // colégios" numa lista que o leitor pode expandir até o último município.
    expect(renderToStaticMarkup(node)).not.toContain("Maiores colégios eleitorais");
  });

  it("(f) NÃO existe mais disclaimer de K-1, nem com model_fallback_tier >= 2", async () => {
    // ADR-0021 supersede o ADR-0015: a projeção não usa 2022 como insumo, logo
    // não existe "bloco político sem mapeamento histórico". O banner foi
    // removido em S07/Fase 5; o campo `model_fallback_tier` segue no payload
    // como @deprecated e não pode mais produzir texto na tela.
    mockUf({ municipios: 10, withMesorregioes: false, modelTier: 2 });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("Modelagem com prior limitado");
    expect(html).not.toContain("pesquisa pré-eleitoral");
  });

  it("(g) tier 3 também não produz texto de 'sem mapeamento histórico'", async () => {
    mockUf({ municipios: 10, withMesorregioes: false, modelTier: 3 });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("sem mapeamento histórico");
    // a página segue renderizando normalmente — a remoção não quebra o resto
    expect(html).toContain("Governador SP — Resultado parcial");
  });

  // -------------------------------------------------------------------------
  // S07/Fase 2 — ADR-0018 (hero 1T) + ADR-0019 (trilha gov).
  // -------------------------------------------------------------------------

  // 2026-09-09 (decisão D23): os seis termômetros do ADR-0018 SAÍRAM desta
  // rota — na coluna de 400px do `<AppShellSplit>` eles sobrepunham os
  // próprios números. Entrou o `<ResultPanel>` do kit, o MESMO componente da
  // home. Consequência declarada e aceita: brancos, nulos e abstenção saem
  // desta tela; o bloco continua obrigatório (ADR-0022) em `/governador`, onde
  // é testado.
  it("(i) 1T com mais de dois candidatos → `<ResultPanel>`, sem termômetros", async () => {
    mockUf({
      municipios: 10,
      withMesorregioes: false,
      multiCandidato: true,
      comParticipacao: true,
    });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

    expect(doc.querySelector('section[aria-labelledby="projecao-termometros-heading"]')).toBeNull();
    expect(doc.querySelectorAll('[id^="termometro-"]')).toHaveLength(0);
    expect(doc.body.textContent).not.toContain("Projeção do 1º turno — Governador SP");

    // O painel do kit: `<Figure>` "Apurado" + margem do líder, e uma linha por
    // candidato da corrida ESTADUAL.
    const figuras = [...doc.querySelectorAll('[data-testid="figure-label"]')].map(
      (f) => f.textContent,
    );
    expect(figuras).toContain("Apurado");
    expect(doc.querySelector('[data-testid="result-margem-parcial"]')).not.toBeNull();
    expect(
      doc.querySelectorAll('[data-testid="candidate-result-row"]').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("(j) duelo (2 candidatos) e 2º turno → sem termômetros", async () => {
    mockUf({ municipios: 10, withMesorregioes: false });
    const duelo = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    expect(renderToStaticMarkup(duelo)).not.toContain('id="termometro-');

    mockUf({
      municipios: 10,
      withMesorregioes: false,
      multiCandidato: true,
      turno: 2,
    });
    const segundoTurno = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(segundoTurno);
    expect(html).not.toContain('id="termometro-');
    // A agulha estadual saiu em 2026-09-08 (não está no protótipo); o que
    // resta como leitura da corrida em 2T são as linhas de candidato.
    expect(html).toContain('data-testid="candidate-result-row"');
  });

  // 2026-09-09 (D23): o `<TrilhaKicker>` (ADR-0019) saiu — não existe no
  // protótipo. Resta a identidade da trilha no `<main>`, que o CSS usa, e o
  // `<h1>` do painel, que nomeia cargo e UF.
  it("(k) trilha gov: main[data-trilha=gov], sem kicker de trilha", async () => {
    mockUf({ municipios: 10, withMesorregioes: false });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("gov");
    expect(doc.querySelector("[data-trilha-kicker]")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toContain("Governador SP");
  });

  it("(h) pré-eleição (payload null) renderiza fallback gentil", async () => {
    readUfProjectionMock.mockResolvedValueOnce(null);
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Aguardando dados");
    expect(html).toContain("Não oficial");
  });
});

// ---------------------------------------------------------------------------
// S07/Bloco 2 (ADR-0029) — "mapa primeiro" na rota de governador por UF.
// ---------------------------------------------------------------------------
describe("UFGovernadorPage — recomposição S07/Bloco 2 (ADR-0029)", () => {
  async function renderGov(): Promise<Document> {
    mockUf({ municipios: 12, withMesorregioes: true, multiCandidato: true });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  }

  it("spec 021 RF-192 emendado: 'Votação' traz o dado DA UF, antes de 'A corrida'", async () => {
    const opts = { municipios: 12, withMesorregioes: true, multiCandidato: true } as const;
    readUfProjectionMock.mockResolvedValueOnce({ ...buildUfPayload(opts), votacao: VOTACAO_UF });
    readUfDetailMock.mockResolvedValueOnce({
      status: "ok",
      detail: buildUfDetail(opts.municipios),
      url: "https://example.test/municipios/uf/SP/gov/t1.json",
    });
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel?.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe(
      "Governador · SP",
    );
    expect(
      painel?.querySelector('[data-testid="votacao-eleitorado"]')?.getAttribute("data-instalados"),
    ).toBe("900");
    expect(painel?.textContent ?? "").not.toMatch(/Brasil/);
    const corrida = doc.querySelector('[aria-labelledby="corrida-tres-circulos-heading"]');
    if (painel === null || corrida === null) throw new Error("painel ausente");
    // "A corrida" vem ANTES do "Votação" (dono, 2026-09-27).
    expect(corrida.compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("(l) o <Footer> continua DENTRO do <main data-trilha> desta página", async () => {
    const doc = await renderGov();
    const main = doc.querySelector("main[data-trilha]");
    expect(main).not.toBeNull();
    const footer = main?.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("Não oficial");
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
  });

  it("(m) o `<ResultPanel>` é o primeiro conteúdo — o mapa e o breadcrumb saíram desta página", async () => {
    // 2026-09-09 (map-builder): o coroplético "{sigla} · quem lidera cada
    // município" (`section[aria-labelledby="leader-map-heading"]`) MUDOU DE
    // ENDEREÇO — foi para a coluna do mapa (`<PersistentMapFrame>`,
    // ADR-0033 § 1), que não é renderizada por este teste (ele monta só
    // `<UFGovernadorPage>`, não o `layout.tsx` que hospeda a moldura).
    //
    // 2026-09-09 (D23): o `<UFBreadcrumb>` saiu, e com ele o que este teste
    // fixava como "primeiro conteúdo". O primeiro conteúdo passa a ser o
    // painel de resultado.
    const doc = await renderGov();
    expect(doc.querySelector('section[aria-labelledby="leader-map-heading"]')).toBeNull();
    expect(doc.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    expect(paineis[0]?.getAttribute("aria-labelledby")).toBe("resultado-heading");
  });

  it("(n) exatamente um <h1>, e ele é o título do painel de resultado", async () => {
    const doc = await renderGov();
    const h1s = doc.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.getAttribute("id")).toBe("resultado-heading");
  });

  it("(o) linhas de candidato com parcial e projeção lado a lado (ADR-0029 § 7)", async () => {
    const doc = await renderGov();
    const linhas = doc.querySelectorAll('[data-testid="candidate-result-row"]');
    expect(linhas.length).toBeGreaterThan(0);
    // 🔴 2026-09-20 (2ª rodada), refeito em 2026-09-27 (versão D): os dois
    // números continuam no HTML servido, cada um sob a sua visão.
    expect(linhas[0]?.querySelector('[data-view-only="parcial"]')?.textContent).toMatch(/%/);
    expect(linhas[0]?.querySelector('[data-view-only="proj"]')?.textContent).toMatch(
      /%.*apurado .*%/,
    );
    expect(linhas[0]?.querySelector("[data-view-cell]")).toBeNull();
    // Versão D — Governador por UF tem selo de turno (a disputa é do estado).
    expect(doc.querySelectorAll('[data-testid="result-selo"]').length).toBeGreaterThan(0);
  });

  it("(p) sem a grade, a tabela lista os municípios e é o caminho de teclado", async () => {
    const doc = await renderGov();

    // 2026-09-08 — a grade de quadrados saiu (não está no protótipo). Ela era
    // o caminho de PONTEIRO para abrir a folha; o caminho acessível sempre
    // foi a tabela, que permanece.
    expect(doc.querySelector('[data-testid="waffle-svg"]')).toBeNull();

    // ACHADO PRÉ-EXISTENTE, RESOLVIDO EM 2026-09-11: a tabela desta rota era
    // `mode="top-by-eleitorado"`, que filtrava `eleitorado != null`. Enquanto
    // `EdgeUfMunicipio` não publicava o campo, ela renderizava ZERO linhas e
    // esta rota (só ela) não tinha botão de município nenhum. `eleitores`
    // existe desde a migration 0006 (ADR-0035 D2), e desde 2026-09-20 o filtro
    // que sumia com a linha não existe mais em modo nenhum.
    //
    // `renderGov` monta 12 municípios — menos que a primeira leva de 20 —,
    // então todos aparecem e não há "mostrar mais".
    const linhas = doc.querySelectorAll('[data-testid="municipios-lista"] tbody tr');
    expect(linhas.length).toBe(12);
    expect(doc.querySelector('[data-testid="municipios-carregar-mais"]')).toBeNull();
    expect(doc.querySelector('[data-testid="municipios-status"]')?.textContent).toBe(
      "Mostrando 12 de 12 municípios.",
    );

    // Cada linha abre a folha por teclado: o nome é um `<button>`.
    expect(doc.querySelectorAll('[data-testid="municipio-open"]').length).toBe(12);

    // A capital está na 1ª linha porque é o MAIOR eleitorado desta fixture, e
    // não por ser capital (ver a nota em `makeMunicipio`). O kicker permanece.
    expect(linhas[0]?.textContent).toContain("· capital");
    // Subtítulo do eleitorado em cada linha — é a chave da ordenação.
    expect(doc.querySelectorAll('[data-testid="municipio-sub"]').length).toBe(12);
    expect(doc.querySelector('[data-testid="municipio-sub"]')?.textContent).toContain("eleitores");

    // O sheet começa fechado — abrir é interação, coberta em e2e.
    expect(doc.querySelector('[data-testid="sheet"]')).toBeNull();
  });

  it("(q) nenhum <Panel> fica vazio (filete órfão)", async () => {
    const doc = await renderGov();
    const panels = [...doc.querySelectorAll('[data-testid="panel"]')];
    // Eram >= 6 até 2026-09-08 (mapa, projeção, municípios, metodologia); em
    // 2026-09-09 o `<Panel>` do mapa saiu desta página (ver teste (m)) —
    // restam projeção, municípios e metodologia.
    expect(panels.length).toBeGreaterThanOrEqual(3);
    for (const p of panels) {
      expect((p.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  // 2026-09-08 — o teste (r) fixava que mesorregiões, waffle, agulha e séries
  // seguiam na página. Todos saíram (não estão no protótipo do kit); ele agora
  // fixa o CORTE, mais o que a constituição obriga a manter.
  it("(r) sobraram maiores municípios e metodologia; mesorregiões, waffle, agulha e séries saíram", async () => {
    const texto = (await renderGov()).body.textContent ?? "";
    // 2026-09-20: o painel "Maiores colégios eleitorais" virou a lista
    // completa de municípios, paginada e ordenada por eleitorado.
    expect(texto).toContain("Municípios (12)");
    expect(texto).toContain("Ordenados pelo eleitorado do município");
    // Constituição § 8 — o bloco de transparência fica em toda página com
    // projeção, esteja ou não no protótipo.
    expect(texto).toContain("O que está movendo o forecast");

    expect(texto).not.toContain("Apuração por mesorregião");
    expect(texto).not.toContain("Cada quadrado é um município");
    expect(texto).not.toContain("Forecast ao vivo — Governador SP");
    expect(texto).not.toContain("Margem ao longo do tempo");
  });

  /**
   * Spec 020 / RF-174 — o SLOT do bloco (T-04), não a presença dele.
   *
   * "Está no DOM" passaria com o bloco em qualquer posição, inclusive acima do
   * painel de resultado — o único lugar proibido, porque lá vive o `<h1>`.
   */
  it("(r2) a evolução da apuração é o 4º painel: depois do resultado, da corrida e da votação, antes dos municípios", async () => {
    const doc = await renderGov();
    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    const kickers = paineis.map(
      (p) => p.querySelector('[data-testid="panel-kicker"]')?.textContent ?? "",
    );
    // 🔴 O slot é localizado pelo KICKER, não pelo `testid` do gráfico: desde a
    // Fase 2 o painel pode conter o gráfico OU o estado "indisponível", e o que
    // este teste mede é a POSIÇÃO do painel.
    const iSerie = kickers.indexOf("Evolução da apuração");
    // Spec 022 RF-200 (2026-09-26) — "A corrida" entra IMEDIATAMENTE depois
    // do resultado, e a série desce uma posição. Continua entre o resultado e
    // os municípios, que é o slot que o RF-174 protege.
    const iCorrida = paineis.findIndex(
      (p) => p.getAttribute("aria-labelledby") === "corrida-tres-circulos-heading",
    );

    // Spec 021 RF-192 EMENDADO (2026-09-26, noite) — "Votação" DA UF entra
    // logo depois de "A corrida" (ordem invertida pelo dono em 2026-09-27);
    // a série desce mais uma posição. Ordem: resultado → A corrida → Votação →
    // evolução (spec 020).
    const iVotacao = paineis.findIndex(
      (p) => p.getAttribute("aria-labelledby") === "votacao-uf-heading",
    );

    expect(paineis[0]?.getAttribute("aria-labelledby")).toBe("resultado-heading");
    expect(iCorrida).toBe(1);
    expect(iVotacao).toBe(2);
    expect(iSerie).toBe(3);
    expect(kickers.indexOf("Municípios")).toBe(4);

    // Sem série no Blob deste caso: nenhum traçado.
    expect(doc.querySelectorAll("[data-traco]")).toHaveLength(0);

    // 🔴 A contagem de `<h1>` não muda.
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.getAttribute("id")).toBe("resultado-heading");
  });

  /**
   * Spec 020 / RF-174(d) — no ramo de espera a fase vem do payload NACIONAL
   * desta corrida. Os dois casos são o par que discrimina: `preEleicao` fixo
   * em `false` derruba o primeiro, fixo em `true` derruba o segundo.
   */
  /**
   * Spec 020, Fase 2 — as props REAIS nesta rota. Três mutações num teste só,
   * porque as três vivem na mesma linha de fiação: re-ordenar o elenco,
   * inferir a cadência do eixo e preencher o furo com zero.
   */
  it("(r4) a série do Blob chega à tela como foi emitida", async () => {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ municipios: 3, withMesorregioes: true, multiCandidato: true }),
    );
    readUfDetailMock.mockResolvedValueOnce({
      status: "ok",
      url: "https://example.test/municipios/uf/SP/gov/t1.json",
      detail: {
        ...buildUfDetail(3),
        series_temporais: { margem: [], p_vitoria: [], turnout: [], por_candidato: SERIE_GOV },
      },
    });
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) })),
      "text/html",
    );

    const figura = doc.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(figura).not.toBeNull();

    // (a) ordem de exibição = ordem emitida (RF-170c).
    const ordem = [...(figura?.querySelectorAll('g[data-cand][data-base="parcial"]') ?? [])]
      .map((g) => g.getAttribute("data-cand") ?? "")
      .filter((id, i, todos) => todos.indexOf(id) === i);
    expect(ordem).toEqual(["30", "10", "20"]);

    // (b) cadência DECLARADA (15), não a inferida do eixo (5).
    expect(figura?.querySelector("caption")?.textContent).toContain("a cada 15 minutos");

    // (c) o furo chega como furo, nunca como zero (RF-175b).
    const celulas = [
      ...(figura?.querySelectorAll('td[data-cand="10"][data-base="parcial"]') ?? []),
    ].map((td) => td.textContent ?? "");
    expect(celulas).toEqual(["30,0%", "sem medição", "32,0%"]);

    // (d) a cor por rank que o ADR-0024 aposentou não entra no bloco.
    expect(figura?.innerHTML ?? "").not.toContain("--color-cand-");

    // (e) o `<h1>` continua único — o bloco não é heading de página.
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
  });

  it("(r3) sem payload de UF, o estado do bloco vem da fase do NACIONAL", async () => {
    readUfProjectionMock.mockResolvedValueOnce(null);
    readProjectionMock.mockResolvedValueOnce({ fase: FASE_PRE_ELEICAO });
    const pre = new DOMParser().parseFromString(
      renderToStaticMarkup(await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) })),
      "text/html",
    );
    const blocoPre = pre.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(blocoPre?.getAttribute("data-estado")).toBe("antes-do-dia");
    expect(pre.body.textContent).toContain("disponível apenas no dia das eleições");
    expect(blocoPre?.textContent?.toLowerCase()).not.toContain("projeção");
    expect(pre.querySelectorAll("h1")).toHaveLength(1);

    readUfProjectionMock.mockResolvedValueOnce(null);
    readProjectionMock.mockResolvedValueOnce(null);
    const semNada = new DOMParser().parseFromString(
      renderToStaticMarkup(await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) })),
      "text/html",
    );
    // Sem fase pré, o bloco passa a dizer POR QUE a série não veio — com o
    // motivo da leitura do Blob, nunca um texto genérico (RF-175).
    expect(
      semNada.querySelector('[data-testid="detail-unavailable"]')?.getAttribute("data-reason"),
    ).toBe("not_configured");
    expect(semNada.querySelector('[data-testid="serie-apuracao-chart"]')).toBeNull();
    expect(semNada.querySelectorAll("h1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ADR-0032 — degradação por seção também nesta rota.
//
// A rota de governador tem estrutura própria (waffle + tabela top-15 num
// `<Panel>` que ANTES sumia quando não havia município). Depois do ADR-0032 a
// fonte desse bloco é o Blob, que falha independentemente do resumo — sumir
// diria "não existe" onde a verdade é "não chegou".
// ---------------------------------------------------------------------------
describe("UFGovernadorPage — degradação do detalhe municipal (ADR-0032)", () => {
  async function renderComDetalhe(detalhe: UfDetailResult): Promise<Document> {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ municipios: 0, withMesorregioes: true }),
    );
    readUfDetailMock.mockResolvedValueOnce(detalhe);
    const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "SP" }) });
    return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  }

  it("(s) Blob 404: o painel de municípios continua no DOM, com motivo explícito", async () => {
    const doc = await renderComDetalhe({
      status: "unavailable",
      reason: "not_found",
      url: "https://exemplo.test/municipios/uf/SP/gov/t1.json",
    });

    // O painel de municípios continua no DOM mesmo sem detalhe. O ÂNCORA
    // mudou em 2026-09-20: o `<Panel>` desta rota perdeu o título "Maiores
    // colégios eleitorais" (e com ele o `#municipios-heading`, que agora é do
    // `<h3>` da própria tabela — e a tabela não existe neste ramo). O que
    // prova a presença do painel é o kicker, que é o mesmo nas três rotas.
    const kickers = [...doc.querySelectorAll('[data-testid="panel-kicker"]')].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Municípios");
    const estados = [...doc.querySelectorAll('[data-testid="detail-unavailable"]')];
    expect(estados.map((e) => e.getAttribute("data-reason"))).toContain("not_found");
    expect(doc.body.textContent).toContain("O detalhe por município está indisponível");

    // O resumo vem da OUTRA fonte e segue inteiro. (A tabela de mesorregiões
    // que este teste também checava saiu da página em 2026-09-08.)
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]').length).toBeGreaterThan(0);
  });

  it("(t) com detalhe, some o estado de falha e a idade própria do Blob é exibida", async () => {
    const doc = await renderComDetalhe({
      status: "ok",
      url: "https://exemplo.test/municipios/uf/SP/gov/t1.json",
      detail: buildUfDetail(12),
    });

    // 🔴 Escopo no painel de municípios: desde a Fase 2 da spec 020 a página
    // tem DOIS blocos alimentados pelo mesmo Blob, e uma busca global pegaria o
    // estado do GRÁFICO achando que mede o da tabela.
    const painelMunicipios = [...doc.querySelectorAll('[data-testid="panel"]')].find(
      (el) => el.querySelector('[data-testid="panel-kicker"]')?.textContent === "Municípios",
    );
    expect(painelMunicipios).toBeDefined();
    expect(painelMunicipios?.querySelector('[data-testid="detail-unavailable"]')).toBeNull();
    expect(doc.querySelector('[data-testid="detail-freshness"]')).not.toBeNull();
    // A asserção sobre os 12 `<rect>` do waffle saiu com a grade (2026-09-08).
    expect(doc.querySelector('[data-testid="waffle-svg"]')).toBeNull();
  });
});

/**
 * Spec 021 RF-192 emendado (2026-09-26, noite) — um `votacao` de UF que FECHA
 * nas identidades do TSE (`c + a = esi`; `vv+vb+tvn+van+vansj = c`), com
 * números que não existem em nenhum outro lugar do payload: se a tela
 * mostrar `instalados = 900`, só pode ter vindo daqui.
 */
const VOTACAO_UF = {
  contagens: {
    aptos: 1000,
    instalados: 900,
    comparecimento: 700,
    abstencao: 200,
    validos: 600,
    brancos: 40,
    nulos: 30,
    anulados: 20,
    sub_judice: 10,
  },
  projetada: { validos: 700, brancos: 50, nulos: 40, abstencao: 150 },
};
