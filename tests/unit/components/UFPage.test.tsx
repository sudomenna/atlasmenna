// @vitest-environment happy-dom
/**
 * Smoke tests da página de UF presidencial.
 *
 * Duas camadas:
 *   1. Composição dos blocos (histórico) — garante que o wireframe monta.
 *   2. SSR do `app/(pres)/uf/[sigla]/page.tsx` com o reader mockado.
 *
 * 2026-09-09 (decisão D23): a camada 2 mudou de objeto. O hero desta rota
 * deixou de ser o dispatch `binary` | `multi-1t` com os seis termômetros do
 * ADR-0018 e passou a ser o `<ResultPanel>` do kit — o MESMO componente da
 * home. Os testes que fixavam os termômetros, o `<TrilhaKicker>` (ADR-0019) e
 * o `<UFBreadcrumb>` (RF-031) passaram a fixar a AUSÊNCIA deles e a presença
 * do painel; a cobertura própria de cada componente segue nos seus arquivos.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import UFPage from "@/app/(pres)/uf/[sigla]/page";

import { NewsClippingPlaceholder } from "@/components/atoms/banners/NewsClippingPlaceholder";
import { WinnerBanner } from "@/components/atoms/banners/WinnerBanner";
import { Needle } from "@/components/atoms/needle/Needle";
import { CandidateRow } from "@/components/atoms/tables/CandidateRow";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { InsightCard } from "@/components/blocks/InsightCard";
import { MunicipioTable } from "@/components/blocks/MunicipioTable";
import { Footer } from "@/components/layout/Footer";
import type { UfDetailResult } from "@/lib/blob/uf-detail";
import { FASE_PRE_ELEICAO } from "@/lib/config/fase";
import type { EdgePayloadUf, EdgeUfCandidate } from "@/lib/edge-config/types";

const readUfProjectionMock = vi.fn();
/**
 * Spec 020 (RF-174d) — o ramo de espera desta rota passou a perguntar a FASE
 * ao payload NACIONAL, porque a rota não tem payload próprio em fase pré (o
 * semeador grava só as chaves nacionais). O mock deixa de ser constante para
 * que os DOIS estados possam ser exercitados: nacional semeado ("ainda não
 * começou") e nacional ausente ("não sabemos").
 */
const readNationalProjectionMock = vi.fn(async (): Promise<unknown> => null);
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
  readProjection: vi.fn(async () => null),
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: (sigla: string, opts?: { cargo?: string }) => readUfProjectionMock(sigla, opts),
}));

/**
 * Segundo read path (ADR-0032): o detalhe municipal e as séries vêm do Vercel
 * Blob, em paralelo com o resumo. Só `readUfDetail` é mockado — os acessores
 * `municipiosFrom`/`seriesFrom` seguem reais.
 *
 * Default `unavailable`: sem detalhe explícito, a página deve cair no estado
 * "detalhe indisponível" — que é o comportamento a fixar, não um efeito
 * colateral do mock.
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

function makeCand(id: number, nome: string, pct: number): EdgeUfCandidate {
  return {
    id,
    nome,
    partido: `P${id}`,
    cor: `var(--color-cand-${id})`,
    votos_atuais: pct * 1000,
    votos_projetados: pct * 2000,
    pct_atual: pct - 1,
    pct_projetado: pct,
    ci95: { lower: pct - 2, upper: pct + 2 },
  };
}

/** Payload de UF; `turno` + nº de candidatos definem o modo da página. */
function buildUfPayload(opts: {
  turno: 1 | 2;
  candidatos: EdgeUfCandidate[];
  comParticipacao?: boolean;
}): EdgePayloadUf {
  const payload: EdgePayloadUf = {
    uf: "SP",
    ts: "2026-10-04T18:00:00-03:00",
    cargo: 1,
    turno: opts.turno,
    pct_apurado: 42,
    candidatos: opts.candidatos,
    needle_position: 0.3,
    needle_band: "lean_a",
  };
  if (opts.comParticipacao) {
    payload.participacao = {
      abstencao: {
        pct_atual: 19.5,
        pct_projetado: 20.8,
        lower: 19.4,
        upper: 22.2,
        base: "eleitores_instalados",
      },
      brancos_nulos: {
        pct_atual: 6.2,
        pct_projetado: 6.6,
        lower: 5.9,
        upper: 7.4,
        base: "comparecimento",
      },
      outros: {
        pct_atual: 7.1,
        pct_projetado: 7.4,
        lower: 6.5,
        upper: 8.4,
        base: "votaveis",
        n_candidatos: 5,
      },
    };
  }
  return payload;
}

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("UF page composition (smoke)", () => {
  it("renderiza conjunto típico sem erro", () => {
    const node = (
      <main>
        <WinnerBanner candidato="Lula" partido="PT" ufSigla="SP" cor="var(--color-pt)" />
        <CandidateRow nome="Lula" partido="PT" cor="var(--color-pt)" votos={null} pct={54.1} />
        <CandidateRow nome="Bolsonaro" partido="PL" cor="var(--color-pl)" votos={null} pct={45.9} />
        <Needle
          needlePosition={0.5}
          pVitoria={0.78}
          candidatoA="Lula"
          candidatoB="Bolsonaro"
          variant="uf"
        />
        <MunicipioTable rows={[]} />
        <InsightCard
          frases={["Lula supera 2022 em SP por 2,1pp.", "Ganho expressivo em capitais."]}
          variant="uf"
        />
        <ForecastTransparency pctApurado={23.4} variant="uf" />
        <NewsClippingPlaceholder />
        <Footer />
      </main>
    );
    const doc = parse(node);
    expect(doc.body.textContent).toContain("Lula");
    expect(doc.body.textContent).toContain("Bolsonaro");
    expect(doc.body.textContent).toContain("Forecast estadual");
    expect(doc.body.textContent).toContain("Não oficial");
    expect(doc.body.textContent).toContain("Repercussão na imprensa");
  });
});

describe("UFPage SSR (S07/Fase 2 — ADR-0018 + ADR-0019)", () => {
  const oitoCandidatos = [
    makeCand(1, "Candidato A", 41),
    makeCand(2, "Candidato B", 33),
    makeCand(3, "Candidato C", 9),
    makeCand(4, "Candidato D", 5),
    makeCand(5, "Candidato E", 3),
  ];

  // 2026-09-09 (decisão D23): os seis termômetros do ADR-0018 SAÍRAM desta
  // rota — na coluna de 400px do `<AppShellSplit>` eles sobrepunham os
  // próprios números. O hero passou a ser o `<ResultPanel>` do kit, o MESMO
  // componente da home. O que (a) e (b) fixavam sobre os termômetros passa a
  // ser fixado sobre o painel que os substituiu; a cobertura do componente em
  // si segue em `tests/unit/components/ProjectionThermometers.test.tsx`.
  it("(a) 1T multi-candidato → `<ResultPanel>` no lugar dos seis termômetros", async () => {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 1, candidatos: oitoCandidatos, comParticipacao: true }),
    );
    const node = await UFPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = parse(node);

    expect(doc.querySelector('section[aria-labelledby="projecao-termometros-heading"]')).toBeNull();
    // Nenhum termômetro. (Os `role="meter"` que sobram na página são as três
    // barras de composição do `<ForecastTransparency>`, que a constituição § 8
    // mantém aqui — por isso a contagem é dos `#termometro-*`, não global.)
    expect(doc.querySelectorAll('[id^="termometro-"]')).toHaveLength(0);
    expect(doc.body.textContent).not.toContain("Projeção do 1º turno em SP");

    // O painel do kit: as duas `<Figure>` do topo e uma linha por candidato.
    const figuras = [...doc.querySelectorAll('[data-testid="figure-label"]')].map(
      (f) => f.textContent,
    );
    expect(figuras).toContain("Apurado");
    expect(figuras).toContain("Margem Candidato");
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(
      oitoCandidatos.length,
    );
  });

  // O rank exibido nas rotas de UF é DERIVADO: `EdgeUfCandidate` não tem a
  // chave `rank` do payload nacional, então a ordem do array que a página
  // passa ao `<ResultPanel>` é o ranking. O critério é `pct_atual` desc, com
  // `pct_projetado` desc como desempate — ver `rankByParcial` na página.
  it("(b) o rank vem de `pct_atual` desc, com `pct_projetado` como desempate", async () => {
    // `makeCand` produz `pct_atual = pct - 1`. Aqui o array chega FORA de
    // ordem e com dois empates em `pct_atual` (20 e 20), que só `pct_projetado`
    // separa.
    const foraDeOrdem: EdgeUfCandidate[] = [
      { ...makeCand(3, "Terceiro", 21), pct_atual: 20, pct_projetado: 21 },
      makeCand(1, "Primeiro", 41),
      { ...makeCand(4, "Quarto", 19), pct_atual: 20, pct_projetado: 19 },
      makeCand(2, "Segundo", 33),
    ];
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 1, candidatos: foraDeOrdem, comParticipacao: true }),
    );
    const doc = parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));

    // `[data-testid="candidate-result-name"]` e não `span.truncate`: desde
    // 14/09 a linha com avatar QUEBRA o nome em vez de truncá-lo, então a
    // classe deixou de identificar a célula — e um seletor que não casa devolve
    // `[undefined, undefined, …]`, que é uma falha barulhenta só por sorte.
    const nomes = [...doc.querySelectorAll('[data-testid="candidate-result-row"]')].map(
      (l) => l.querySelector('[data-testid="candidate-result-name"]')?.textContent,
    );
    expect(nomes).toEqual(["Primeiro", "Segundo", "Terceiro", "Quarto"]);

    // E a margem do painel é derivada do 1º sobre o 2º nessa mesma ordem:
    // 40,0 − 32,0 = 8,0pp na parcial.
    expect(doc.querySelector('[data-testid="result-margem-parcial"]')?.textContent).toContain(
      "8,0",
    );
  });

  // 2026-09-08 — o `<Panel>` "Forecast" (`<Needle>` + "Margem estimada") saiu
  // desta rota: não existe no protótipo do kit. O que este teste ainda fixa é
  // o dispatch de modo — em 2T não há termômetros, e as linhas de candidato
  // continuam sendo a leitura da corrida.
  it("(c) 2º turno (duelo) → sem termômetros", async () => {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 2, candidatos: oitoCandidatos.slice(0, 2) }),
    );
    const node = await UFPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = parse(node);

    expect(doc.querySelector('[id^="termometro-"]')).toBeNull();
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(2);
  });

  // 2026-09-09 (D23): `<TrilhaKicker>` (ADR-0019) e `<UFBreadcrumb>` (RF-031)
  // saíram — nenhum dos dois existe no protótipo do kit. O que resta desta
  // invariante é a identidade da trilha no `<main>`, que o CSS usa.
  it("(d) trilha presidencial: main[data-trilha=pres], sem kicker de trilha e sem breadcrumb", async () => {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 1, candidatos: oitoCandidatos, comParticipacao: true }),
    );
    const node = await UFPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = parse(node);

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("pres");
    expect(doc.querySelector("[data-trilha-kicker]")).toBeNull();
    expect(doc.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    // A UF continua nomeada — pelo `<h1>` do painel de resultado.
    expect(doc.querySelector("h1")?.textContent).toContain("SP");
  });

  // 2026-09-09 (D23): consequência declarada e aceita do corte dos termômetros
  // — brancos, nulos e abstenção SAEM desta tela, exatamente como saíram da
  // home em 09/09. O dado segue em `EdgePayloadUf.participacao`, e o bloco
  // continua obrigatório (ADR-0022) em `/governador`, onde é testado.
  it("(e) a participação do eleitorado não é mais renderizada nesta rota", async () => {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 1, candidatos: oitoCandidatos, comParticipacao: true }),
    );
    const node = await UFPage({ params: Promise.resolve({ sigla: "SP" }) });
    const doc = parse(node);

    expect(doc.querySelector("#termometro-brancos-nulos")).toBeNull();
    expect(doc.querySelector("#termometro-abstencao")).toBeNull();
    expect(doc.querySelector("#termometro-outros")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S07/Bloco 2 (ADR-0029) — "mapa primeiro" na rota de UF presidencial.
//
// O conteúdo não mudou; a ORDEM e o invólucro mudaram. Estes testes fixam a
// nova ordem e as duas invariantes estruturais da página (`Footer` dentro do
// `<main data-trilha>`; exatamente um `<h1>`).
// ---------------------------------------------------------------------------
describe("UFPage — recomposição S07/Bloco 2 (ADR-0029)", () => {
  const candidatos = [
    makeCand(1, "Candidato A", 41),
    makeCand(2, "Candidato B", 33),
    makeCand(3, "Candidato C", 9),
  ];

  async function renderUF(): Promise<Document> {
    readUfProjectionMock.mockResolvedValueOnce(
      buildUfPayload({ turno: 1, candidatos, comParticipacao: true }),
    );
    return parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
  }

  it("spec 021 RF-192 emendado: 'Votação' traz o dado DA UF, com kicker da UF e sem 'Brasil'", async () => {
    readUfProjectionMock.mockResolvedValueOnce({
      ...buildUfPayload({ turno: 1, candidatos, comParticipacao: true }),
      votacao: VOTACAO_UF,
    });
    const doc = parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel?.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe(
      "Presidente · SP",
    );
    expect(
      painel?.querySelector('[data-testid="votacao-eleitorado"]')?.getAttribute("data-instalados"),
    ).toBe("900");
    expect(painel?.textContent ?? "").not.toMatch(/Brasil/);
    // Um painel "Votação" só — `titleId` único na página.
    expect(doc.querySelectorAll('[data-testid="votacao-eleitorado"]')).toHaveLength(1);
    expect(doc.querySelectorAll("#votacao-uf-heading")).toHaveLength(1);
  });

  it("(f) o <Footer> continua DENTRO do <main data-trilha> desta página", async () => {
    const doc = await renderUF();
    const main = doc.querySelector("main[data-trilha]");
    expect(main).not.toBeNull();
    // O shell global (app/layout.tsx) não fornece nenhum dos dois.
    const footer = main?.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("Não oficial");
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
  });

  it("(g) exatamente um <h1>, dentro do painel de resultado, alternando parcial/projeção", async () => {
    const doc = await renderUF();
    const h1s = doc.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.getAttribute("id")).toBe("resultado-heading");
    expect(h1s[0]?.textContent).toContain("SP — Resultado parcial");
    expect(h1s[0]?.textContent).toContain("SP — Projeção Atlas Menna");
    // O `<TrilhaKicker>` acima do `<h1>` (ADR-0019) saiu em 09/09 (D23) — o
    // `<h1>` agora abre a página. A alternância continua sendo por cascata:
    // os dois textos ficam no DOM, marcados por `data-view-only`.
    const bases = [...h1s[0]!.querySelectorAll("[data-view-only]")].map((s) =>
      s.getAttribute("data-view-only"),
    );
    expect(bases).toEqual(["parcial", "proj"]);
  });

  it("(h) o `<ResultPanel>` é o primeiro conteúdo — o mapa e o breadcrumb saíram desta página", async () => {
    // 2026-09-09 (map-builder): o coroplético "{sigla} · quem lidera cada
    // município" (`section[aria-labelledby="leader-map-heading"]`) MUDOU DE
    // ENDEREÇO — foi para a coluna do mapa (`<PersistentMapFrame>`,
    // ADR-0033 § 1), que não é renderizada por este teste (ele monta só
    // `<UFPage>`, não o `layout.tsx` que hospeda a moldura).
    //
    // 2026-09-09 (D23): o `<UFBreadcrumb>` saiu, e com ele o que este teste
    // fixava como "primeiro conteúdo". O primeiro conteúdo passa a ser o
    // painel de resultado.
    const doc = await renderUF();
    expect(doc.querySelector('section[aria-labelledby="leader-map-heading"]')).toBeNull();
    expect(doc.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();

    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    expect(paineis[0]?.getAttribute("aria-labelledby")).toBe("resultado-heading");
  });

  it("(i) as linhas de candidato trazem parcial e projeção lado a lado (ADR-0029 § 7)", async () => {
    const doc = await renderUF();
    const linhas = doc.querySelectorAll('[data-testid="candidate-result-row"]');
    expect(linhas).toHaveLength(candidatos.length);
    // 🔴 2026-09-20 (2ª rodada) — os DOIS números continuam no HTML servido,
    // mas por mecanismos diferentes: o parcial em `data-view-cell` (sempre
    // visível, só a ênfase muda) e a projeção em `data-view-only`, que a
    // cascata esconde na visão Parcial. Era `data-view-cell` nos dois.
    expect(linhas[0]?.querySelector('[data-view-cell="parcial"]')).not.toBeNull();
    expect(linhas[0]?.querySelector('[data-view-cell="proj"]')).toBeNull();
    expect(linhas[0]?.querySelector('[data-view-only="proj"]')).not.toBeNull();
    // `pct_atual` do fixture é `pct - 1`; `pct_projetado` é `pct`.
    expect(linhas[0]?.querySelector('[data-view-cell="parcial"]')?.textContent).toContain("40,0%");
    expect(linhas[0]?.querySelector('[data-view-only="proj"]')?.textContent).toContain("41,0%");
  });

  it("(j) o kicker da 1ª seção de dado carrega o rótulo 'não oficial' (constituição § 1)", async () => {
    const doc = await renderUF();
    const kickers = [...doc.querySelectorAll('[data-testid="panel-kicker"]')].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Projeção Atlas Menna · não oficial");
  });

  it("(k) nenhum <Panel> fica vazio (filete órfão)", async () => {
    const doc = await renderUF();
    const panels = [...doc.querySelectorAll('[data-testid="panel"]')];
    // Eram >= 6 até 2026-09-08 (mapa, projeção, municípios, metodologia); em
    // 2026-09-09 o `<Panel>` do mapa saiu desta página (ver teste (h)) —
    // restam projeção, municípios e metodologia.
    expect(panels.length).toBeGreaterThanOrEqual(3);
    for (const p of panels) {
      expect((p.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * Spec 020 / RF-174 — o SLOT do bloco (T-03), não a presença dele.
   *
   * "Está no DOM" passaria com o bloco em qualquer posição, inclusive acima do
   * painel de resultado — o único lugar proibido, porque lá vive o `<h1>`.
   * Por isso as asserções são de ÍNDICE entre os painéis irmãos.
   */
  it("(k2) a evolução da apuração é o 4º painel: depois do resultado, da corrida e da votação, antes dos municípios", async () => {
    const doc = await renderUF();
    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    const kickers = paineis.map(
      (p) => p.querySelector('[data-testid="panel-kicker"]')?.textContent ?? "",
    );
    // 🔴 O slot é localizado pelo KICKER, não pelo `testid` do gráfico. Desde a
    // Fase 2 o painel pode conter o gráfico OU o estado "indisponível" — o que
    // não pode mudar é a POSIÇÃO do painel, que é o que este teste mede.
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

    // Sem série no Blob deste caso: nenhum traçado e nenhum percentual.
    expect(doc.querySelectorAll("[data-traco]")).toHaveLength(0);

    // 🔴 A contagem de `<h1>` não muda — o bloco não é heading de página.
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.getAttribute("id")).toBe("resultado-heading");
  });

  /**
   * Spec 020 / RF-174(d) — a fase, no ramo de espera, vem do payload NACIONAL.
   *
   * Os dois casos abaixo são o par que discrimina: um `preEleicao` fixo em
   * `false` derruba o primeiro, um fixo em `true` derruba o segundo, e ler a
   * data do calendário derruba os dois em algum dia do ano. "Não começou" e
   * "não sabemos" são estados diferentes e a tela diz qual é qual.
   */
  it("(k3) sem payload de UF, o estado do bloco vem da fase do NACIONAL", async () => {
    vi.stubEnv("NODE_ENV", "production");

    readUfProjectionMock.mockResolvedValueOnce(null);
    readNationalProjectionMock.mockResolvedValueOnce({ fase: FASE_PRE_ELEICAO });
    const pre = parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
    const blocoPre = pre.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(blocoPre?.getAttribute("data-estado")).toBe("antes-do-dia");
    expect(pre.body.textContent).toContain("disponível apenas no dia das eleições");
    // RF-174: a palavra "projeção" não ocorre em superfície nenhuma do bloco.
    expect(blocoPre?.textContent?.toLowerCase()).not.toContain("projeção");
    expect(pre.querySelectorAll("h1")).toHaveLength(1);

    readUfProjectionMock.mockResolvedValueOnce(null);
    readNationalProjectionMock.mockResolvedValueOnce(null);
    const semNada = parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
    // Sem fase pré, o bloco passa a dizer POR QUE a série não veio. O mock de
    // `readUfDetail` deste arquivo responde `not_configured` por padrão — e é
    // esse motivo, não um texto genérico, que precisa chegar à tela (RF-175).
    const semNadaEstado = semNada.querySelector('[data-testid="detail-unavailable"]');
    expect(semNadaEstado?.getAttribute("data-reason")).toBe("not_configured");
    expect(semNada.querySelector('[data-testid="serie-apuracao-chart"]')).toBeNull();
    expect(semNada.querySelectorAll("h1")).toHaveLength(1);

    vi.unstubAllEnvs();
  });

  // (l) removido em 2026-09-08: o `<ChancesPanel>` saiu desta rota — no
  // protótipo do kit ele é NACIONAL (`App.jsx:350`) e migrou para a home. A
  // cobertura do componente em si segue em
  // `tests/unit/components/ChancesPanel.test.tsx`.
});

// ---------------------------------------------------------------------------
// S07/Bloco 2 — a folha do município na rota presidencial.
//
// `renderToStaticMarkup` não executa eventos, então o que se pode fixar aqui é
// o CONTRATO: o botão existe, tem alvo de toque de 44px e carrega o
// `cod_ibge` que o handler devolve. A abertura em si é interação de browser.
// ---------------------------------------------------------------------------
describe("UFPage — folha do município (S07/Bloco 2)", () => {
  function makeMunicipio(i: number) {
    return {
      cod_ibge: `35${String(i).padStart(5, "0")}`,
      nome: `Município ${i + 1}`,
      pct_apurado: 60 + i,
      lider: { candidato_id: 1, partido: "P1", votos: 1000 + i, margem_pp: 5 },
      votos_reportados: { 1: 1000 + i, 2: 800 },
    };
  }

  async function renderComMunicipios(): Promise<Document> {
    const payload = buildUfPayload({
      turno: 1,
      candidatos: [makeCand(1, "Candidato A", 41), makeCand(2, "Candidato B", 33)],
      comParticipacao: true,
    });
    readUfProjectionMock.mockResolvedValueOnce(payload);
    readUfDetailMock.mockResolvedValueOnce({
      status: "ok",
      detail: {
        ts: "2026-10-04T18:00:00-03:00",
        uf: "SP",
        cargo: "pres",
        turno: 1,
        municipios: [makeMunicipio(0), makeMunicipio(1), makeMunicipio(2)],
        series_temporais: null,
      },
      url: "https://example.test/municipios/uf/SP/pres/t1.json",
    });
    return parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
  }

  it("(m) cada município da tabela é um botão de 44px que devolve o cod_ibge", async () => {
    const doc = await renderComMunicipios();
    const botoes = [...doc.querySelectorAll('[data-testid="municipio-open"]')];
    expect(botoes.length).toBeGreaterThan(0);
    expect(botoes[0]?.tagName.toLowerCase()).toBe("button");
    expect(botoes[0]?.getAttribute("style")).toContain("min-height:var(--tap-min)");
    expect(botoes.map((b) => b.getAttribute("data-cod"))).toContain("3500000");
  });

  it("(n) o sheet começa fechado — nada de diálogo no primeiro paint", async () => {
    const doc = await renderComMunicipios();
    expect(doc.querySelector('[data-testid="sheet"]')).toBeNull();
    expect(doc.querySelector('[role="dialog"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ADR-0032 — dois read paths, degradação POR SEÇÃO.
//
// O resumo (Global Config) e o detalhe municipal (Vercel Blob) falham
// independentemente. Quando o Blob não responde, as seções de detalhe precisam
// continuar no DOM com um estado explícito — nunca sumir, nunca ficar vazias em
// silêncio (ADR-0017 aplicado a uma fonte de dado).
// ---------------------------------------------------------------------------
describe("UFPage — degradação do detalhe municipal (ADR-0032)", () => {
  /**
   * O `<DetailUnavailable>` de UM painel, identificado pelo kicker.
   *
   * 🔴 Escopo, e não `doc.querySelector(...)` global: desde a Fase 2 da spec
   * 020 a página tem DOIS blocos alimentados pelo mesmo Blob — municípios e a
   * evolução da apuração —, e uma busca global devolve o primeiro do documento.
   * Sem o escopo, `(q)` passaria a medir o estado do gráfico achando que mede o
   * da tabela, e `(r)` falharia por um motivo que não é o dele.
   */
  function estadoDoPainel(doc: Document, kicker: string): Element | null {
    const painel = [...doc.querySelectorAll('[data-testid="panel"]')].find(
      (el) => el.querySelector('[data-testid="panel-kicker"]')?.textContent === kicker,
    );
    return painel?.querySelector('[data-testid="detail-unavailable"]') ?? null;
  }

  function payloadPadrao(): EdgePayloadUf {
    return buildUfPayload({
      turno: 1,
      candidatos: [makeCand(1, "Candidato A", 41), makeCand(2, "Candidato B", 33)],
      comParticipacao: true,
    });
  }

  async function render(detalhe: UfDetailResult): Promise<Document> {
    readUfProjectionMock.mockResolvedValueOnce(payloadPadrao());
    readUfDetailMock.mockResolvedValueOnce(detalhe);
    return parse(await UFPage({ params: Promise.resolve({ sigla: "SP" }) }));
  }

  function detalheOk(municipios: number, ts = "2026-10-04T18:00:00-03:00"): UfDetailResult {
    return {
      status: "ok",
      url: "https://exemplo.test/municipios/uf/SP/pres/t1.json",
      detail: {
        ts,
        uf: "SP",
        cargo: "pres",
        turno: 1,
        municipios: Array.from({ length: municipios }, (_, i) => ({
          cod_ibge: `35${String(i).padStart(5, "0")}`,
          nome: `Município ${i + 1}`,
          pct_apurado: 60,
          lider: { candidato_id: 1, partido: "P1", votos: 1000, margem_pp: 5 },
          votos_reportados: { 1: 1000, 2: 800 },
        })),
        series_temporais: null,
      },
    };
  }

  it("(o) Blob 404: o bloco de municípios CONTINUA no DOM, com motivo explícito", async () => {
    const doc = await render({
      status: "unavailable",
      reason: "not_found",
      url: "https://exemplo.test/municipios/uf/SP/pres/t1.json",
    });

    const estados = [...doc.querySelectorAll('[data-testid="detail-unavailable"]')];
    expect(estados.length).toBeGreaterThan(0);
    expect(estados.map((e) => e.getAttribute("data-reason"))).toContain("not_found");
    expect(doc.body.textContent).toContain("O detalhe por município está indisponível");
    // E o resumo, que vem da OUTRA fonte, segue inteiro.
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]').length).toBeGreaterThan(0);
  });

  it("(p) erro de rede no Blob: as séries também declaram indisponibilidade", async () => {
    const doc = await render({ status: "unavailable", reason: "fetch_error", url: null });
    // Fora os painéis "A corrida" (spec 022) e "Votação" (spec 021 RF-192
    // emendado): a indisponibilidade deles é do
    // PAYLOAD (`votacao` ausente ⇒ "not_found"), não do Blob que este caso
    // derruba — misturá-los aqui mediria outra fonte.
    const razoes = [...doc.querySelectorAll('[data-testid="detail-unavailable"]')]
      .filter(
        (e) =>
          !e.closest('[aria-labelledby="corrida-tres-circulos-heading"]') &&
          !e.closest('[aria-labelledby="votacao-uf-heading"]'),
      )
      .map((e) => e.getAttribute("data-reason"));
    expect(razoes.every((r) => r === "fetch_error")).toBe(true);
    // A asserção sobre "A evolução ao longo da noite" saiu com o `<Panel>` dos
    // três charts (cortes de 2026-09-08). O estado de falha do Blob continua
    // sendo declarado pelas seções de município que restaram.
    expect(razoes.length).toBeGreaterThan(0);
  });

  it("(q) Blob OK e vazio é `empty`, não `not_found` — são notícias diferentes", async () => {
    const doc = await render(detalheOk(0));
    expect(estadoDoPainel(doc, "Municípios")?.getAttribute("data-reason")).toBe("empty");
    // Spec 020 — o MESMO Blob, respondido com sucesso, produz motivos
    // diferentes nos dois blocos: "não há município apurado" e "o produtor não
    // publicou a série". Colapsá-los manda quem opera caçar a causa errada.
    expect(estadoDoPainel(doc, "Evolução da apuração")?.getAttribute("data-reason")).toBe(
      "sem_serie",
    );
  });

  it("(r) com detalhe, a seção mostra a idade PRÓPRIA do Blob e nenhum estado de falha", async () => {
    const doc = await render(detalheOk(3));
    expect(estadoDoPainel(doc, "Municípios")).toBeNull();
    const frescor = doc.querySelector('[data-testid="detail-freshness"]');
    expect(frescor).not.toBeNull();
    expect(frescor?.textContent).toContain("Detalhe atualizado às");
    expect(doc.querySelectorAll('[data-testid="municipio-open"]').length).toBeGreaterThan(0);
  });

  it("(s) detalhe atrasado em relação ao resumo: a defasagem é dita, não silenciada", async () => {
    // Resumo às 18:00 (fixture), detalhe às 17:51 → 9 min de defasagem.
    const doc = await render(detalheOk(2, "2026-10-04T17:51:00-03:00"));
    const frescor = doc.querySelector('[data-testid="detail-freshness"]');
    expect(frescor?.getAttribute("data-lag-minutes")).toBe("9");
    expect(frescor?.textContent).toContain("9 min mais antigo que o resumo");
  });
});

/**
 * ===================================================================
 * `/uf/[sigla]` em PRODUÇÃO com o Global Config vazio
 * ===================================================================
 *
 * Rota irmã da home na trilha presidencial, e a única outra que tem fixture no
 * caminho de fallback (`synthesizeUfFromNational`, que deriva de
 * `tests/fixtures/edge-config/projection-current.json` — a MESMA fixture cujos
 * números vazaram para `salacofre.vercel.app` pela home em 13/09/2026).
 *
 * Esta rota já barrava produção antes da correção (`NODE_ENV !== "production"`),
 * então aqui não havia vazamento. O que os testes abaixo fazem é FIXAR isso:
 * até 13/09 nenhum teste provava a direção, e o portão sobrevivia por acaso.
 * A mudança de `!== "production"` para `=== "development"` alinhou as cinco
 * rotas de cargo ao mesmo portão.
 */
describe("UFPage — produção sem Global Config (defeito 2026-09-13)", () => {
  /** Os números que a home publicou; todos vêm da fixture nacional. */
  const NUMEROS_DA_FIXTURE = ["Candidato PT", "Candidato PL", "15.240.321", "43,5"];

  async function renderUf(sigla = "SP"): Promise<Document> {
    return parse(await UFPage({ params: Promise.resolve({ sigla }) }));
  }

  /** Um resumo genuíno vindo do Global Config — o caminho feliz. */
  function payloadGenuino(): EdgePayloadUf {
    return buildUfPayload({
      turno: 1,
      candidatos: [makeCand(1, "Candidato A", 41), makeCand(2, "Candidato B", 33)],
      comParticipacao: true,
    });
  }

  it("(z1) reader vazio: nenhum número da fixture nacional chega ao HTML", async () => {
    // Mutação que deve derrubá-lo: tirar a guarda de `synthesizeUfFromNational`.
    vi.stubEnv("NODE_ENV", "production");
    readUfProjectionMock.mockResolvedValueOnce(null);

    const doc = await renderUf();
    const html = doc.body.innerHTML;
    for (const numero of NUMEROS_DA_FIXTURE) {
      expect(html).not.toContain(numero);
    }
    vi.unstubAllEnvs();
  });

  it("(z2) reader vazio: a página diz, em texto, que está aguardando", async () => {
    // Mutação que deve derrubá-lo: render vazio sem mensagem.
    vi.stubEnv("NODE_ENV", "production");
    readUfProjectionMock.mockResolvedValueOnce(null);

    const doc = await renderUf("MG");
    const aviso = doc.querySelector('[data-testid="uf-aguardando"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toContain("quando o TSE divulgar");
    // O <h1> nomeia a UF consultada, e não um estado genérico.
    expect(doc.querySelector("h1")?.textContent).toContain("MG");
    // Constituição §§ 1 e 3: a página não some e continua rotulada.
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("pres");
    expect(doc.querySelector("main footer")).not.toBeNull();
    vi.unstubAllEnvs();
  });

  it("(z3) `NODE_ENV=development` com reader vazio: a fixture CONTINUA entrando", async () => {
    // Mutação que deve derrubá-lo: guardar por algo que também bloqueie dev.
    // `pnpm dev` sem credencial Vercel precisa continuar inspecionável.
    vi.stubEnv("NODE_ENV", "development");
    readUfProjectionMock.mockResolvedValueOnce(null);

    const doc = await renderUf("SP");
    expect(doc.querySelector('[data-testid="uf-aguardando"]')).toBeNull();
    expect(doc.body.textContent).toContain("Candidato PT");
    vi.unstubAllEnvs();
  });

  it("(z4) reader COM payload: produção não muda nada no caminho feliz", async () => {
    // Mutação que deve derrubá-lo: uma guarda que bloqueie o dado real junto
    // com a fixture.
    vi.stubEnv("NODE_ENV", "production");
    readUfProjectionMock.mockResolvedValueOnce(payloadGenuino());

    const doc = await renderUf("SP");
    expect(doc.querySelector('[data-testid="uf-aguardando"]')).toBeNull();
    expect(
      doc.querySelectorAll('[data-testid="candidate-result-row"]').length,
    ).toBeGreaterThanOrEqual(2);
    vi.unstubAllEnvs();
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
