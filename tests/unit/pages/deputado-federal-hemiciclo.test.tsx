// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-federal-hemiciclo.test.tsx
 *
 * A **fiação** do hemiciclo e da grade de bandeiras em `/deputado-federal`.
 *
 * 🔴 Este arquivo existe por causa de um erro de verificação, não de código: em
 * 2026-09-18 um recurso chegou "pronto" e não aparecia na tela porque ninguém
 * tinha ligado os dados. Um componente com 20 testes verdes e zero chamadas na
 * página é um componente que não existe para o leitor. Os testes do
 * `<CamaraHemiciclo>` medem o componente; estes medem que ele está **na tela**,
 * com o número que veio do payload.
 *
 * Os mocks e o `nacional()` espelham `tests/unit/pages/deputado-federal.test.tsx`
 * — inclusive o `total_cadeiras: 400`, deliberadamente diferente de 513.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeputadoFederalPage from "@/app/(dep)/deputado-federal/page";
import type { EdgeAgremiacaoBancada, EdgePayloadDeputado } from "@/lib/edge-config/types";
import { colorForParty, textForParty } from "@/lib/utils/party-color";

const readDeputadoProjectionMock = vi.fn();

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", () => ({
  // Spec 026 (RF-265) — as telas de Deputado leem o interruptor da projeção a
  // cada render. Ausente = desligado (falha fechada), o estado de antes da virada.
  readInterruptorProjecao: vi.fn(async () => ({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  })),
  readDeputadoProjection: () => readDeputadoProjectionMock(),
  readProjection: vi.fn(async () => null),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
}));

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function render(): Promise<Document> {
  return parse(renderToStaticMarkup(await DeputadoFederalPage()));
}

function agr(over: Partial<EdgeAgremiacaoBancada> = {}): EdgeAgremiacaoBancada {
  return {
    cod: "22",
    sigla: "PL",
    nome: "Partido Liberal",
    tipo: "partido",
    componentes: [],
    sigla_lider: "PL",
    cadeiras: 60,
    votos_nominais: 9_000_000,
    votos_legenda: 1_000_000,
    votos_validos: 10_000_000,
    pct_votos: 40,
    ...over,
  };
}

function nacional(over: Partial<EdgePayloadDeputado> = {}): EdgePayloadDeputado {
  return {
    ts: "2026-10-04T22:15:00-03:00",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 62.5,
    ufs_apuradas: 20,
    atualizacao_min: 7,
    bancada: {
      total_cadeiras: 400,
      cadeiras_atribuidas: 310,
      ufs_calculadas: 20,
      ufs_aguardando: 7,
      por_agremiacao: [
        agr(),
        agr({
          cod: "13",
          sigla: "FE BRASIL",
          nome: "Federação Brasil da Esperança",
          tipo: "federacao",
          componentes: ["PT", "PCdoB", "PV"],
          sigla_lider: "PT",
          cadeiras: 250,
          cadeiras_indefinidas: 2,
        }),
      ],
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 80,
        lugares_a_preencher: 70,
        quociente_eleitoral: 210_400,
        cadeiras_definidas: 70,
        vagas_nao_preenchidas: 0,
        empates_indeterminados: 0,
        lider: { cod: "22", sigla: "PL", cadeiras: 19 },
      },
      {
        sigla: "RR",
        pct_apurado: 0,
        lugares_a_preencher: null,
        quociente_eleitoral: null,
        cadeiras_definidas: 0,
        vagas_nao_preenchidas: 0,
        empates_indeterminados: 0,
        lider: null,
      },
    ],
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 1 },
    ...over,
  };
}

beforeEach(() => {
  readDeputadoProjectionMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("/deputado-federal — o hemiciclo está NA TELA, com o número do payload", () => {
  // 🔴 MUTAÇÃO: apagar `<CamaraHemiciclo .../>` do JSX da página. Os 20 testes
  // do componente continuam verdes e o leitor não vê nada.
  it("desenha `bancada.total_cadeiras` bolinhas — 400, não 513", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();

    const svg = doc.querySelector('[data-testid="camara-hemiciclo"] svg');
    expect(svg, "o hemiciclo não está montado na página").not.toBeNull();
    expect(svg?.querySelectorAll("circle")).toHaveLength(400);
    expect(svg?.getAttribute("data-total")).toBe("400");
  });

  it("muda junto com o payload — 431 cadeiras ⇒ 431 bolinhas", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: { ...p.bancada, total_cadeiras: 431 },
    });
    const doc = await render();
    expect(doc.querySelectorAll('[data-testid="camara-hemiciclo"] circle')).toHaveLength(431);
  });

  // 🔴 MUTAÇÃO: tirar o `id="bancada-agremiacoes"` da `<ul>`, ou renomeá-lo. O
  // `aria-describedby` passa a apontar para o nada — que é pior que não
  // apontar, porque parece resolvido e nenhum gate automático acusa.
  it("o `aria-describedby` do SVG tem alvo EXISTENTE no documento", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();

    const ids = (
      doc.querySelector('[data-testid="camara-hemiciclo"] svg')?.getAttribute("aria-describedby") ??
      ""
    )
      .split(" ")
      .filter(Boolean);

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(
        doc.getElementById(id),
        `aria-describedby aponta para "${id}", que não existe`,
      ).not.toBeNull();
    }
    expect(ids).toContain("bancada-agremiacoes");
  });

  it("as cadeiras indefinidas da federação aparecem marcadas, não chapadas", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();
    expect(doc.querySelectorAll('g[data-estado="indefinida"][data-cod="13"] circle')).toHaveLength(
      2,
    );
    expect(doc.querySelectorAll('g[data-estado="definida"][data-cod="13"] circle')).toHaveLength(
      248,
    );
  });

  it("sem payload a página não desenha plenário nenhum", async () => {
    // Sem dado, um hemiciclo de tamanho padrão seria número escrito à mão
    // (design 017 § D8) — e pior, um número que parece medido.
    readDeputadoProjectionMock.mockResolvedValue(null);
    const doc = await render();
    expect(doc.querySelector('[data-testid="camara-hemiciclo"]')).toBeNull();
  });
});

describe("/deputado-federal — o ponto de cor da lista usa a variante `-text`", () => {
  // 🔴 MUTAÇÃO: voltar `corIdentidadeDaAgremiacao` para `colorForParty`. É o
  // estado em que esta tela estava até 2026-09-18 — um `grep textForParty` não
  // achava este arquivo, e a correção de contraste do mesmo dia passou ao lado
  // dela.
  it("nenhum ponto de identidade pinta com a cor-base do partido", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: {
        ...p.bancada,
        por_agremiacao: [
          agr({ cod: "18", sigla: "PSOL/REDE", sigla_lider: "PSOL", cadeiras: 310 }),
        ],
      },
    });
    const doc = await render();

    const ponto = doc.querySelector('[data-testid="bancada-ponto"]');
    expect(ponto?.getAttribute("style")).toContain(textForParty("PSOL"));
    expect(ponto?.getAttribute("style"), "voltou para a cor-base (2,08:1)").not.toContain(
      `background:${colorForParty("PSOL")}`,
    );
  });

  it("a BARRA continua com a cor-base — o remédio dela é o contorno, não a cor", async () => {
    // RNF-035: preenchimento com extensão se conserta com `DATA_FILL_STROKE`,
    // não trocando o token. Se alguém "uniformizar" os dois consumidores, este
    // teste avisa que a distinção foi perdida.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();
    const html = doc.body.innerHTML;
    expect(html).toContain(colorForParty("PT"));
  });
});

describe("/deputado-federal — a grade de bandeiras não perdeu dado", () => {
  // 🔴 MUTAÇÃO: passar `resumos` vazio (ou não passar) para `<UfBandeirasGrid>`.
  // A grade fica bonita e o leitor perde maior bancada, empates e placar.
  it("os 27 estados aparecem, e SP mantém o resumo que a lista tinha", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();

    expect(doc.querySelectorAll('[data-testid="corrida-uf"]')).toHaveLength(27);
    const sp = doc.querySelector('[data-uf="SP"]');
    expect(sp?.textContent).toContain("maior bancada: PL (19)");
    expect(sp?.querySelector('[data-testid="corrida-vagas"]')?.textContent).toBe("70 de 70");
  });

  it("RR sem vagas publicadas continua dizendo isso, e não `0 de 0` (RF-124)", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();
    const rr = doc.querySelector('[data-uf="RR"] [data-testid="corrida-vagas"]')?.textContent ?? "";
    expect(rr).toMatch(/vagas não publicadas/i);
    expect(rr).not.toContain("0 de 0");
  });

  it("empate e vaga sem candidato elegível continuam visíveis", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      por_uf: [
        {
          ...(p.por_uf[0] as (typeof p.por_uf)[number]),
          empates_indeterminados: 3,
          vagas_nao_preenchidas: 1,
        },
      ],
    });
    const doc = await render();
    const sp = doc.querySelector('[data-uf="SP"]')?.textContent ?? "";
    expect(sp).toContain("3 em empate sem desempate previsto");
    expect(sp).toContain("1 vaga sem candidato elegível");
  });

  it("não há ícone quebrado: nenhum `<use>` sem `<symbol>` correspondente", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render();
    for (const uso of doc.querySelectorAll("use")) {
      const alvo = (uso.getAttribute("href") ?? "").replace(/^#/, "");
      expect(doc.getElementById(alvo), `<use> órfão para "${alvo}"`).not.toBeNull();
    }
  });
});
