// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-federal.test.tsx — spec 017, as duas telas.
 *
 * `/deputado-federal` (T-11) e `/uf/[sigla]/deputado-federal` (T-12),
 * renderizadas por SSR com os dois readers mockados — mesmo padrão de
 * `tests/unit/pages/senador.test.tsx`.
 *
 * O fio condutor é a decisão D8 do design 017: **prosa derivada, nunca
 * literal**. Em 2026-09-11 quatro frases da tela de Senador viraram falsas
 * quando a granularidade do cargo mudou, e uma delas atribuía ao TSE uma
 * limitação que era escolha nossa. Por isso boa parte destas asserções é
 * NEGATIVA — elas falham se a tela voltar a imprimir um 513, um "15 minutos"
 * ou um total de cadeiras que não veio do payload. Uma asserção só positiva
 * ("a tela mostra 513") passaria com o número cravado no JSX, que é exatamente
 * o defeito.
 *
 * `NODE_ENV` aqui é `test`, então o atalho de fixture das páginas (que só roda
 * em `development`) fica fora do caminho: o que se mede é o comportamento com
 * o que os readers devolvem, inclusive o `null`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeputadoFederalPage from "@/app/(dep)/deputado-federal/page";
import UFDeputadoFederalPage from "@/app/(dep)/uf/[sigla]/deputado-federal/page";
import type { DeputadoUfDetail, DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import type { EdgeAgremiacaoBancada, EdgePayloadDeputado } from "@/lib/edge-config/types";
import depUfV1 from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import contratoNacional from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

/** Spec 026 — o objeto v2 da UF, da fixture de contrato (formato de produção). */
function v2(uf: "AC" | "AP" | "RR" | "SP"): DeputadoUfDetail {
  return structuredClone(
    (contratoUf as unknown as Record<string, DeputadoUfDetail>)[uf],
  ) as DeputadoUfDetail;
}

/** O objeto v1 de sempre (`tests/fixtures/blob/dep-uf.json`, intocado — RF-276). */
function v1(uf: string): DeputadoUfDetail {
  return structuredClone(
    (depUfV1 as unknown as Record<string, DeputadoUfDetail>)[uf],
  ) as DeputadoUfDetail;
}

/**
 * RF-266 — toda ocorrência de "projeção"/"projetad" FORA da metodologia tem de
 * estar no mesmo elemento que "não oficial". Devolve as que não estão (vazio =
 * cumpre) e quantas ocorrências havia ao todo (para o controle positivo).
 */
function projecaoForaDaMetodologia(doc: Document): { soltas: string[]; total: number } {
  const metodologia = doc.querySelector("[data-testid='dep-metodologia']");
  const soltas: string[] = [];
  let total = 0;
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? "";
    if (!/proje(ção|tad)/i.test(t)) continue;
    if (metodologia?.contains(n)) continue;
    total++;
    const dono = n.parentElement?.closest("p, li, span, h1, h2, h3, h4, div") ?? n.parentElement;
    if (!(dono?.textContent ?? "").includes("não oficial")) soltas.push(t.trim().slice(0, 80));
  }
  return { soltas, total };
}

function paramsDe(sigla: string) {
  return { params: Promise.resolve({ sigla }) };
}

/** "eleito" que não é uma das três marcas nem a citação literal do TSE (RF-266). */
const ELEITO_SOLTO =
  /(?<!\p{L})eleito(?!\p{L})(?!\s+(na parcial|na projeção|\(TSE\)|por QP|por média))/giu;

const readDeputadoProjectionMock = vi.fn();
const readDeputadoUfDetailMock = vi.fn();
/** Spec 026 (RF-265) — o interruptor lido no render. Padrão: ausente = desligado. */
const readInterruptorProjecaoMock = vi.fn();
const DESLIGADO = { ligada: false, pct_minimo: 25, origem: "ausente" } as const;
const LIGADO = { ligada: true, pct_minimo: 25, origem: "chave" } as const;

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
  readDeputadoProjection: () => readDeputadoProjectionMock(),
  readInterruptorProjecao: () => readInterruptorProjecaoMock(),
  readProjection: vi.fn(async () => null),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
}));

// `importOriginal`: a página também usa `ordenarAgremiacoes` e
// `ordenarCandidatos` deste módulo, e são justamente elas que garantem o
// determinismo que um dos testes mede. Só a leitura é substituída.
vi.mock("@/lib/blob/deputado-uf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/deputado-uf")>();
  return { ...real, readDeputadoUfDetail: (sigla: string) => readDeputadoUfDetailMock(sigla) };
});

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function render(node: Promise<React.ReactElement> | React.ReactElement): Promise<Document> {
  return parse(renderToStaticMarkup(await node));
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

function agr(over: Partial<EdgeAgremiacaoBancada> = {}): EdgeAgremiacaoBancada {
  return {
    cod: "22",
    sigla: "PL",
    nome: "Partido Liberal",
    tipo: "partido",
    componentes: [],
    // Partido isolado: o líder É a própria sigla. É essa igualdade que
    // dispensa ramo por `tipo` na tela (design 017 § D5).
    sigla_lider: "PL",
    cadeiras: 60,
    votos_nominais: 9_000_000,
    votos_legenda: 1_000_000,
    votos_validos: 10_000_000,
    pct_votos: 40,
    ...over,
  };
}

/**
 * Deliberadamente **não** usa 513, nem 15 minutos: os números do payload
 * precisam ser diferentes dos plausíveis para que uma constante cravada no
 * JSX apareça como divergência, e não como coincidência.
 */
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
          // O líder da federação NÃO é a sigla dela — é o que separa um teste
          // que mede a derivação de um que passa por coincidência.
          sigla_lider: "PT",
          cadeiras: 250,
          votos_nominais: 12_000_000,
          votos_legenda: 800_000,
          votos_validos: 12_800_000,
          pct_votos: 51.2,
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
    // D10 — os dois são o estado real do dia 15: sem templates e sem modelo.
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 1 },
    ...over,
  };
}

function detalhe(over: Partial<DeputadoUfDetail> = {}): DeputadoUfDetail {
  return {
    ts: "2026-10-04T22:14:00-03:00",
    cargo: 6,
    turno: 1,
    uf: "SP",
    pct_apurado: 80,
    lugares_a_preencher: 70,
    quociente_eleitoral: 210_400,
    quociente_eleitoral_tse: 210_400,
    totalizacao_final: false,
    divergencias: [],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    agremiacoes: [
      {
        cod: "13",
        sigla: "FE BRASIL",
        nome: "Federação Brasil da Esperança",
        tipo: "federacao",
        componentes: ["PT", "PCdoB", "PV"],
        sigla_lider: "PT",
        votos_nominais: 3_000_000,
        votos_legenda: 250_000,
        votos_validos: 3_250_000,
        pct_votos: 30,
        quociente_partidario: 15,
        cadeiras: 2,
        eleitos: [
          { sqcand: 111, nome: "Ana Lima", partido: "PT", votos: 500_000, ordem: 1 },
          {
            sqcand: 222,
            nome: "Bruno Reis",
            partido: "PCdoB",
            votos: 90_000,
            ordem: 2,
            indefinido: true,
          },
        ],
        suplentes: [{ sqcand: 333, nome: "Célia Mota", partido: "PV", votos: 80_000, ordem: 3 }],
      },
      {
        cod: "22",
        sigla: "PL",
        nome: "Partido Liberal",
        tipo: "partido",
        componentes: [],
        sigla_lider: "PL",
        votos_nominais: 2_000_000,
        votos_legenda: 400_000,
        votos_validos: 2_400_000,
        pct_votos: 22,
        quociente_partidario: 11,
        cadeiras: 1,
        eleitos: [{ sqcand: 444, nome: "Davi Nunes", partido: "PL", votos: 700_000, ordem: 1 }],
        suplentes: [{ sqcand: 555, nome: "Eva Prado", partido: "PL", votos: 60_000, ordem: 2 }],
      },
    ],
    ...over,
  };
}

function ok(detail: DeputadoUfDetail): DeputadoUfDetailResult {
  return { status: "ok", detail, url: "https://exemplo.test/deputado/uf/SP.json" };
}

function indisponivel(reason: "not_found" | "fetch_error"): DeputadoUfDetailResult {
  return { status: "unavailable", reason, url: "https://exemplo.test/deputado/uf/SP.json" };
}

beforeEach(() => {
  readDeputadoProjectionMock.mockReset();
  readDeputadoUfDetailMock.mockReset();
  readInterruptorProjecaoMock.mockReset();
  readInterruptorProjecaoMock.mockResolvedValue(DESLIGADO);
});

// ---------------------------------------------------------------------------
// T-11 — /deputado-federal
// ---------------------------------------------------------------------------

describe("/deputado-federal (T-11)", () => {
  it("(a) lê a chave do cargo 6 pela função própria, não por readProjection", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    await render(DeputadoFederalPage());

    expect(readDeputadoProjectionMock).toHaveBeenCalledTimes(1);
  });

  it("(b) RF-124/D8: o total de cadeiras vem do payload — e a tela NUNCA imprime 513", async () => {
    // O payload declara 400. Um `513` cravado no JSX apareceria aqui.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    expect(doc.querySelector("[data-testid='dep-cadeiras-label']")?.textContent).toContain(
      "400 cadeiras",
    );
    expect(doc.body.textContent).not.toContain("513");
  });

  it("(b2) mudar o total no payload muda a tela — a derivação é real", async () => {
    // Contraprova de (b): sem isto, (b) passaria com qualquer número cravado
    // que não fosse 513.
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({
        bancada: { ...nacional().bancada, total_cadeiras: 372, cadeiras_atribuidas: 300 },
      }),
    );
    const doc = await render(DeputadoFederalPage());

    expect(doc.body.textContent).toContain("372");
    expect(doc.body.textContent).not.toContain("400 cadeiras");
  });

  it("(c3) sem payload, a tela NÃO afirma granularidade nenhuma — nem a antiga, nem a nova", async () => {
    // Defeito publicado em produção em 13/09 e corrigido no mesmo dia: a
    // primeira versão de `temIntervalo` tinha dois ramos, e o estado "não há
    // dado algum" caía no ramo "sem faixa", fazendo a tela dizer "lemos o
    // boletim que o TSE publica por estado". Falso: aqui não se leu nada. São
    // três estados. Asserção negativa sobre os DOIS textos de granularidade.
    readDeputadoProjectionMock.mockResolvedValue(null);
    const doc = await render(DeputadoFederalPage());
    const metodologia = doc.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";

    expect(metodologia).not.toMatch(/boletim que o TSE publica por estado/);
    expect(metodologia).not.toMatch(/zonas eleitorais/);
    // Spec 026 (reescrita): continua dizendo que a CONTA não é projeção — e,
    // sem payload, também não relata estado de projeção nenhum: nem trava, nem
    // interruptor, nem "o que está movendo" (não há o que relatar).
    expect(metodologia).toMatch(/não são uma projeção/);
    expect(metodologia).not.toMatch(/desligada|interruptor|trava|25%|o que está movendo/i);
    expect(doc.querySelector("[data-testid='dep-metodologia-projecao']")).toBeNull();
  });

  it("(c0) a11y: a contagem e a faixa têm rótulo próprio — não se distinguem só por posição", async () => {
    // Achado do gate de a11y de 2026-09-13. A linha mostra dois números —
    // "89" (cadeiras agora) e "85 a 93" (a faixa). Para quem enxerga, a coluna
    // resolve. Para quem ouve, "89 ... 85 a 93" sem rótulo é adivinhação:
    // significado transmitido só por posição, WCAG 1.3.1. O axe não pega isso
    // porque não é regra técnica — por isso o teste existe aqui.
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({
        bancada: {
          ...nacional().bancada,
          por_agremiacao: [agr({ cadeiras: 89, cadeiras_ci95: [85, 93] })],
        },
      }),
    );
    const doc = await render(DeputadoFederalPage());

    // O rótulo é IRMÃO do número (o `data-testid` continua valendo só o texto
    // visível, porque RF-125.1 afirma sobre ele). Então a leitura acessível é a
    // da célula inteira — que é o que o leitor de tela percorre.
    const celulaCadeiras = doc.querySelector("[data-testid='bancada-cadeiras']")?.parentElement;
    const celulaFaixa = doc.querySelector("[data-testid='bancada-intervalo']")?.parentElement;

    expect(celulaCadeiras?.textContent).toMatch(/89\s*cadeiras conquistadas/);
    expect(celulaFaixa?.textContent).toMatch(/faixa provável:\s*85 a 93 cadeiras/);
    // E o número visível segue intocado — o rótulo não vaza para a tela.
    expect(doc.querySelector("[data-testid='bancada-cadeiras']")?.textContent).toBe("89");
  });

  it("(c0b) a11y: sem faixa, o travessão não fica mudo para o leitor de tela", async () => {
    // "—" sozinho é lido como travessão ou silêncio: o leitor não saberia que
    // existe uma coluna de faixa e que ela está vazia. Esse é o estado do modo
    // de emergência e do começo da noite, então não é caso de borda raro.
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({ bancada: { ...nacional().bancada, por_agremiacao: [agr()] } }),
    );
    const doc = await render(DeputadoFederalPage());
    const faixa = doc.querySelector("[data-testid='bancada-intervalo']");

    expect(faixa?.parentElement?.textContent).toMatch(/faixa não disponível/);
    // O travessão continua sendo o que a tela mostra — o rótulo é só para quem ouve.
    expect(faixa?.textContent).toBe("—");
  });

  it("(c1) RF-127/§8: com faixa no payload, a tela NÃO afirma que lê o boletim do estado", async () => {
    // Regressão de 2026-09-13, achada pelo gate constitucional. Até aquele dia
    // este bloco afirmava, sem condição, "Lemos o boletim que o TSE publica por
    // estado, e não os de cada zona eleitoral". O ADR-0036 inverteu o fato e a
    // frase virou falsa NA TELA DO LEITOR — o componente não foi tocado por
    // nenhum dos 5 commits daquela madrugada. Asserção NEGATIVA de propósito:
    // um teste que só confirmasse o texto novo passaria com o velho ainda lá.
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({
        bancada: {
          ...nacional().bancada,
          por_agremiacao: [agr({ cadeiras_ci95: [57, 63] })],
        },
      }),
    );
    const doc = await render(DeputadoFederalPage());
    const metodologia = doc.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";

    expect(metodologia).not.toMatch(/não os de cada zona eleitoral/);
    expect(metodologia).not.toMatch(/não há mapa de municípios/);
    // E diz o que a faixa mede — e o que ela não mede (constituição § 8).
    expect(metodologia).toMatch(/zonas eleitorais/);
    expect(metodologia).toMatch(/indefinidas/);
  });

  it("(c2) modo de emergência: sem faixa no payload, a tela explica por que não há intervalo", async () => {
    // O outro lado do interruptor `TSE_DEPUTADO_GRANULARIDADE=uf` (ADR-0036):
    // sem zonas não há faixa, e aí a frase sobre ler o boletim do estado volta
    // a ser verdadeira. É por isso que o texto é derivado do payload e não fixo.
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({
        bancada: { ...nacional().bancada, por_agremiacao: [agr()] },
      }),
    );
    const doc = await render(DeputadoFederalPage());
    const metodologia = doc.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";

    expect(metodologia).toMatch(/boletim que o TSE publica por estado/);
    expect(metodologia).toMatch(/não há\s+intervalo/);
  });

  it("(c) RF-128: a cadência sai de `atualizacao_min`, e a tela não diz '15 minutos'", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const cadencia = doc.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";

    expect(cadencia).toContain("a cada 7 minutos");
    expect(doc.body.textContent).not.toMatch(/a cada 15 minutos/);
    // E o `ts` do payload, que é a outra metade de RF-128.
    expect(doc.querySelector("[data-testid='dep-atualizacao']")?.textContent).toMatch(
      /Atualizado às \d{2}:\d{2}:\d{2}/,
    );
  });

  it("(d) RF-130: nominal e legenda são dois números distinguíveis, nunca só a soma", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const votos = [...doc.querySelectorAll("[data-testid='bancada-votos']")]
      .map((el) => el.textContent ?? "")
      .join(" ");

    expect(votos).toContain("9.000.000");
    expect(votos).toContain("1.000.000");
    expect(votos).toMatch(/nominais/);
    expect(votos).toMatch(/legenda/);
    // Somar em silêncio esconde um fato que decide cadeira: os 10.000.000 não
    // podem aparecer no lugar dos dois.
    expect(votos).not.toContain("10.000.000");
  });

  it("(e) RF-122: a federação tem identidade própria E os componentes legíveis", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const fed = doc.querySelector("[data-testid='bancada-federacao']")?.textContent ?? "";

    expect(fed).toContain("Federação Brasil da Esperança");
    for (const sigla of ["PT", "PCdoB", "PV"]) expect(fed).toContain(sigla);
    // Uma agremiação por linha: a federação NÃO pode virar três linhas de
    // partido (seriam três quocientes partidários, não um).
    expect(doc.querySelectorAll("[data-testid='bancada-linha']").length).toBe(2);
  });

  it("(f) RF-125.1: a contagem exibida é `cadeiras` — `vagas_obtidas` não existe na tela", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const contagens = [...doc.querySelectorAll("[data-testid='bancada-cadeiras']")].map(
      (el) => el.textContent,
    );

    // Ordem: FE BRASIL (250) e depois PL (60).
    expect(contagens).toEqual(["250", "60"]);
    expect(doc.documentElement.innerHTML).not.toContain("vagas_obtidas");
  });

  it("(g) RF-127 SEM `cadeiras_ci95`: nenhum intervalo é inventado, e a indefinição aparece", async () => {
    // Estado provável em 15/09 (design 017 § D7): o ponto central publica, o
    // intervalo não. A tela tem de funcionar assim.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    const intervalos = [...doc.querySelectorAll("[data-testid='bancada-intervalo']")].map(
      (el) => el.textContent,
    );
    expect(intervalos).toEqual(["—", "—"]);
    // A metade de RF-127 que não depende de D7 sai agora.
    expect(doc.querySelector("[data-testid='bancada-indefinidas']")?.textContent).toMatch(
      /2 dessas cadeiras ainda estão indefinidas/,
    );
  });

  it("(h) RF-127 COM `cadeiras_ci95`: o intervalo aparece sem mudar mais nada", async () => {
    const p = nacional();
    const comCi: EdgePayloadDeputado = {
      ...p,
      bancada: {
        ...p.bancada,
        por_agremiacao: p.bancada.por_agremiacao.map((a) =>
          a.cod === "22" ? { ...a, cadeiras_ci95: [54, 67] as [number, number] } : a,
        ),
      },
    };
    readDeputadoProjectionMock.mockResolvedValue(comCi);
    const doc = await render(DeputadoFederalPage());

    const intervalos = [...doc.querySelectorAll("[data-testid='bancada-intervalo']")].map(
      (el) => el.textContent,
    );
    expect(intervalos).toContain("54 a 67 cadeiras");
  });

  it("(i) D3/constituição § 8: a nota diz que o nacional é soma nossa, não dado do TSE", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const nota = doc.querySelector("[data-testid='bancada-nota']")?.textContent ?? "";

    expect(nota).toMatch(/soma das 27 corridas/i);
    expect(nota).toMatch(/não publica um arquivo nacional/i);
    // ⚠️ 2026-09-19 — esta asserção era `/não de uma tabela guardada aqui/i`,
    // e a frase que ela media ("o total de N cadeiras também vem do dado
    // publicado, estado a estado … a redistribuição pelo Censo de 2022 ainda
    // não tem desfecho") ficou falsa nas duas metades: o total deixou de ser
    // derivado do dado publicado, e o Censo 2022 tem desfecho (PLP 177/2023
    // vetado em julho/2025, STF mantendo 513). O que a nota precisa separar
    // agora são DUAS proveniências diferentes na mesma frase.
    expect(nota).toMatch(/não é soma nenhuma/i);
    expect(nota).toMatch(/tamanho da Câmara/i);
    expect(nota).toMatch(/quantas cada estado elege continua vindo do dado/i);
    expect(nota).not.toMatch(/tabela guardada aqui/i);
    expect(nota).not.toMatch(/censo/i);
  });

  it("(i2) o total exibido é o do payload — 400, não 513 cravado no JSX", async () => {
    // 🔴 A trava contra o conserto errado. O defeito corrigido em 2026-09-19
    // era o total derivado da soma das UFs presentes; o conserto **não** é
    // escrever 513 nesta tela — é o produtor do dado publicar o fato fixo
    // (`api/model/cargos.py`). A fixture usa 400 de propósito.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    expect(doc.querySelector("[data-testid='dep-cadeiras-label']")?.textContent).toContain(
      "400 cadeiras",
    );
    expect(doc.body.textContent).not.toContain("513");
  });

  it("(j) as cadeiras que faltam são nomeadas — senão o leitor conclui que sumiram", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    // 400 − 310 = 90.
    expect(doc.querySelector("[data-testid='bancada-aguardando']")?.textContent).toContain("90");
    expect(doc.querySelector("[data-testid='bancada-aguardando']")?.textContent).toContain("7");
  });

  it("(k) determinismo: a ordem é cadeiras desc → sigla asc, mesmo com o payload fora de ordem", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: {
        ...p.bancada,
        por_agremiacao: [
          agr({ cod: "1", sigla: "ZZZ", cadeiras: 10 }),
          agr({ cod: "2", sigla: "AAA", cadeiras: 10 }),
          agr({ cod: "3", sigla: "MMM", cadeiras: 40 }),
        ],
      },
    });
    const doc = await render(DeputadoFederalPage());

    expect(
      [...doc.querySelectorAll("[data-testid='bancada-linha']")].map((el) => el.textContent),
    ).toHaveLength(3);
    expect(
      [...doc.querySelectorAll("[data-testid='bancada-linha']")].map((el) =>
        el.getAttribute("data-cod"),
      ),
    ).toEqual(["3", "2", "1"]);
  });

  it("(l) RF-124: UF sem vagas publicadas diz isso — não imprime zero", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const rr = doc.querySelector("[data-uf='RR'] [data-testid='corrida-vagas']")?.textContent ?? "";

    expect(rr).toMatch(/vagas não publicadas/i);
    expect(rr).not.toContain("0 de 0");
  });

  it("(m) a tela não usa a gramática majoritária, que aqui não tem referente", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const texto = doc.body.textContent ?? "";

    expect(texto).not.toMatch(/2º turno|segundo turno/i);
    expect(texto).not.toMatch(/chance de vitória/i);
    // "líder da corrida" não existe numa eleição proporcional — o que existe
    // é a maior bancada de cada estado.
    expect(texto).not.toMatch(/líder da corrida/i);
  });

  it("(m2) ADR-0024: a cor da federação vem de `sigla_lider`, não da sigla dela", async () => {
    // A federação declara `sigla_lider: "PT"`. A cor tem de ser a do PT —
    // NÃO `--party-outros` (o fallback de antes de 12/09) nem
    // `--party-fe-brasil` (que não existe). O PL, partido isolado, prova que o
    // mesmo caminho serve aos dois: `sigla_lider === sigla`.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const cores = [...doc.querySelectorAll("[data-testid='bancada-linha'] span[aria-hidden]")].map(
      (el) => el.getAttribute("style") ?? "",
    );

    // ⚠️ 2026-09-18 — o PONTO passou a usar a variante `-text` (RNF-035: ele é
    // marcador de identidade, e as cores-base reprovam 3:1 em tema claro). O
    // que este teste mede continua sendo a DERIVAÇÃO — de onde sai a sigla —,
    // não qual token dela: `-pt-text` e `-pl-text` provam `sigla_lider` do
    // mesmo jeito que `-pt` e `-pl` provavam.
    expect(cores.join(" ")).toContain("var(--party-pt-text)");
    expect(cores.join(" ")).toContain("var(--party-pl-text)");
    expect(cores.join(" ")).not.toContain("var(--party-outros");

    // E a distinção dos dois remédios do RNF-035 fica travada aqui: a BARRA é
    // preenchimento com extensão e continua na cor-base (o remédio dela é o
    // contorno, `DATA_FILL_STROKE`). Uniformizar os dois consumidores — para
    // qualquer um dos lados — derruba este teste.
    const segmentos = [...doc.querySelectorAll("[data-testid='vote-bar-segment']")].map(
      (el) => el.getAttribute("style") ?? "",
    );
    expect(segmentos.join(" ")).toContain("var(--party-pt)");
    expect(cores.join(" "), "o ponto voltou para a cor-base").not.toMatch(
      /background:var\(--party-pt\)/,
    );
  });

  it("(m3) trocar `sigla_lider` troca a cor — e a barra segue o mesmo campo", async () => {
    // Contraprova de (m2): sem isto, (m2) passaria com a cor derivada de
    // `componentes[0]`, que por acaso também é PT.
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: {
        ...p.bancada,
        por_agremiacao: p.bancada.por_agremiacao.map((a) =>
          a.cod === "13" ? { ...a, sigla_lider: "PSOL" } : a,
        ),
      },
    });
    const doc = await render(DeputadoFederalPage());
    const markup = doc.documentElement.innerHTML;

    expect(markup).toContain("var(--party-psol-text)");
    expect(markup).toContain("var(--party-psol)");
    // Nem a cor-base do PT (na barra) nem a variante dele (no ponto) sobrevivem
    // à troca de líder: as duas superfícies leem o MESMO campo.
    expect(markup).not.toContain("var(--party-pt)");
    expect(markup).not.toContain("var(--party-pt-text)");
    // A barra e o ponto da lista leem o MESMO campo: se divergirem, a legenda
    // deixa de explicar a barra.
    const segmentos = [...doc.querySelectorAll("[data-testid='vote-bar-segment']")].map(
      (el) => el.getAttribute("style") ?? "",
    );
    expect(segmentos.join(" ")).toContain("var(--party-psol)");
  });

  it("(m4) sigla sem token cai em --party-outros — sigla nova nunca vira cor ausente", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: {
        ...p.bancada,
        por_agremiacao: [
          agr({ cod: "99", sigla: "XPTO", sigla_lider: "PARTIDO QUE NAO EXISTE", cadeiras: 5 }),
          // Envelope degradado: o campo simplesmente não veio.
          {
            ...agr({ cod: "98", sigla: "YYY", cadeiras: 3 }),
            sigla_lider: undefined as unknown as string,
          },
        ],
      },
    });
    const doc = await render(DeputadoFederalPage());
    const cores = [...doc.querySelectorAll("[data-testid='bancada-linha'] span[aria-hidden]")].map(
      (el) => el.getAttribute("style") ?? "",
    );

    // Os dois casos resolvem para o fallback, e nenhum deixa `background`
    // vazio ou `undefined` no atributo de estilo.
    expect(cores).toHaveLength(2);
    for (const cor of cores) {
      // `-outros-text` — o mesmo fallback, na variante que o ponto usa desde
      // 2026-09-18. O que o teste protege é a AUSÊNCIA de cor vazia, não o
      // nome do token.
      expect(cor).toContain("var(--party-outros-text)");
      expect(cor).not.toContain("undefined");
    }
  });

  it("(m5) spec 026: 'projeção' só junto de 'não oficial'; a bancada nunca é chamada de projeção", async () => {
    // Reescrito pela spec 026 (o D9 do design 017 caiu, ADR-0063). A palavra
    // passa a ser permitida FORA da metodologia só no mesmo elemento que "não
    // oficial" (RF-266), e só com o interruptor LIGADO; o número da bancada
    // continua sendo a parcial e continua nunca sendo chamado de projeção.
    const payload = contratoNacional as unknown as EdgePayloadDeputado;

    // Interruptor desligado: nenhuma ocorrência fora da metodologia.
    readDeputadoProjectionMock.mockResolvedValue(payload);
    const desligado = await render(DeputadoFederalPage());
    expect(projecaoForaDaMetodologia(desligado).total).toBe(0);
    expect(desligado.body.textContent).not.toMatch(/forecast/i);

    // Ligado: o selo por UF aparece (controle positivo) — e toda ocorrência
    // está com "não oficial".
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const ligado = await render(DeputadoFederalPage());
    const { soltas, total } = projecaoForaDaMetodologia(ligado);
    expect(total).toBeGreaterThan(0);
    expect(soltas).toEqual([]);

    // O painel da bancada (a parcial) nunca se chama projeção — kicker e título.
    const bancada = ligado.querySelector("[aria-labelledby='bancada-heading']");
    const rotulos = [...(bancada?.querySelectorAll("h2, [data-testid='panel-kicker']") ?? [])]
      .map((el) => el.textContent ?? "")
      .join(" | ");
    expect(rotulos).not.toMatch(/proje(ção|tad)/i);

    const metodologia = ligado.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";
    expect(metodologia).toMatch(/não são uma projeção/i);
    expect(metodologia).toMatch(/já apurados/i);
  });

  it("(m6) D10: a barra 'Modelo x%' não existe — não há modelo por trás do número", async () => {
    // O `<ForecastTransparency>` das outras rotas desenha `100 − pctApurado`
    // como "Modelo". Com 62,5% apurado imprimiria "Modelo 37,5%", atribuindo
    // 37,5% da bancada a um modelo que não rodou (composition = {0,0,1}).
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());
    const texto = doc.body.textContent ?? "";

    expect(texto).not.toMatch(/\bModelo\b/);
    expect(texto).not.toContain("37,5%");
  });

  it("(m7) D10: `insights` vazio não vira painel vazio — é o estado do dia 15", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    expect(doc.querySelector("[data-testid='dep-insights']")).toBeNull();
    expect(doc.body.textContent).not.toMatch(/destaques/i);
  });

  it("(m8) D10: com insights, o painel aparece — a lista vazia não é um bloco morto", async () => {
    readDeputadoProjectionMock.mockResolvedValue(
      nacional({ insights: ["O PL tem a maior bancada com 62,5% apurado."] }),
    );
    const doc = await render(DeputadoFederalPage());

    expect(doc.querySelector("[data-testid='dep-insights']")?.textContent).toContain(
      "maior bancada",
    );
  });

  it("(m9) D9.1: sem `lugares_a_preencher` em nenhuma UF, a tela não diz '0 cadeiras'", async () => {
    // O § D9.1 retirou do contrato a afirmação de que `carg[].nv` chega desde o
    // primeiro ciclo — os únicos registros com o campo no banco são do nosso
    // mock. Se o TSE não publicar, `total_cadeiras` é 0, e "0 cadeiras em
    // disputa" é tão falso quanto cravar 513.
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      bancada: {
        ...p.bancada,
        total_cadeiras: 0,
        cadeiras_atribuidas: 0,
        ufs_calculadas: 0,
        ufs_aguardando: 27,
      },
      por_uf: p.por_uf.map((u) => ({ ...u, lugares_a_preencher: null, quociente_eleitoral: null })),
    } as EdgePayloadDeputado);
    const doc = await render(DeputadoFederalPage());
    const rotulo = doc.querySelector("[data-testid='dep-cadeiras-label']")?.textContent ?? "";

    expect(rotulo).toMatch(/ainda não publicou quantas cadeiras/i);
    expect(rotulo).not.toMatch(/\b0 cadeiras\b/);
    expect(doc.body.textContent).not.toContain("513");
    // E a estrutura continua inteira (constituição § 3).
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("(n) trilha `dep`, exatamente um <h1> e o rodapé DENTRO do <main>", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const doc = await render(DeputadoFederalPage());

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("main footer")).not.toBeNull();
  });

  it("(o) sem payload a página não some — e não inventa nenhuma contagem", async () => {
    readDeputadoProjectionMock.mockResolvedValue(null);
    const doc = await render(DeputadoFederalPage());
    const texto = doc.body.textContent ?? "";

    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("[data-testid='dep-aguardando']")).not.toBeNull();
    // A asserção que importa: sem payload NÃO sabemos quantas cadeiras o TSE
    // publicou. Nem 513, nem 0.
    expect(texto).not.toContain("513");
    expect(texto).not.toMatch(/\b0 cadeiras\b/);
    // Nem a cadência, que também viria do payload.
    expect(texto).not.toMatch(/a cada \d+ minutos/);
    // Mas o bloco de transparência continua (constituição § 8).
    expect(doc.querySelector("main footer")).not.toBeNull();
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
  });
});

// ---------------------------------------------------------------------------
// T-12 — /uf/[sigla]/deputado-federal
// ---------------------------------------------------------------------------

const PARAMS_SP = { params: Promise.resolve({ sigla: "SP" }) };

describe("/uf/[sigla]/deputado-federal (T-12)", () => {
  it("(p) lê o resumo do Global Config e o detalhe do Blob, pela sigla", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    await render(UFDeputadoFederalPage(PARAMS_SP));

    expect(readDeputadoProjectionMock).toHaveBeenCalledTimes(1);
    expect(readDeputadoUfDetailMock).toHaveBeenCalledWith("SP");
  });

  it("(q) RF-129: Blob fora do ar → detalhe indisponível COM motivo, e o resumo sobrevive", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("fetch_error"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    const bloco = doc.querySelector("[data-testid='uf-detalhe-indisponivel']");
    expect(bloco).not.toBeNull();
    expect(bloco?.getAttribute("data-reason")).toBe("fetch_error");
    // ...e o resumo continua na tela. É literalmente a aceitação de RF-129:
    // se ele dependesse do Blob, uma falha de CDN apagaria a página inteira.
    expect(doc.querySelector("[data-testid='uf-vagas-label']")?.textContent).toContain(
      "70 cadeiras",
    );
    expect(doc.querySelector("[data-testid='uf-resumo']")?.textContent).toContain("80,0%");
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("(q2) o motivo muda o texto — 404 não é a mesma notícia que falha de rede", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("not_found"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    const bloco = doc.querySelector("[data-testid='uf-detalhe-indisponivel']");
    expect(bloco?.getAttribute("data-reason")).toBe("not_found");
    expect(bloco?.textContent).toMatch(/ainda não há um detalhe publicado/i);
    expect(bloco?.textContent).not.toMatch(/não conseguimos buscar/i);
  });

  it("(q3) nenhum texto de indisponibilidade afirma nada sobre a APURAÇÃO", async () => {
    // O payload diz 80% apurado; o Blob responde 404. A combinação acontece —
    // o Global Config gravou e a escrita do Blob falhou naquele ciclo — e uma
    // frase como "este estado ainda não teve boletim publicado" vira falsa
    // exatamente aí. É a mesma classe do defeito de 2026-09-11 no Senador:
    // uma frase que fala por uma fonte que ela não leu.
    readDeputadoProjectionMock.mockResolvedValue(nacional());

    for (const motivo of ["not_found", "fetch_error"] as const) {
      readDeputadoUfDetailMock.mockResolvedValue(indisponivel(motivo));
      const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
      const bloco = doc.querySelector("[data-testid='uf-detalhe-indisponivel']")?.textContent ?? "";

      expect(bloco, motivo).not.toMatch(/não teve boletim/i);
      expect(bloco, motivo).not.toMatch(/não começou a apuração/i);
      expect(bloco, motivo).not.toMatch(/nenhum voto/i);
      // ...e diz o que de fato sabe: o resumo acima continua valendo.
      expect(bloco, motivo).toMatch(/resumo acima/i);
    }
  });

  it("(r) com o Blob: agremiações, eleitos na parcial e o partido de cada um dentro da federação", async () => {
    // Spec 026: o markup da lista mudou (três faixas, tuplas), a exigência não.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    expect(doc.querySelectorAll("[data-testid='uf-agremiacao']").length).toBe(2);
    // Objeto v1: os eleitos são a parcial — marcados "eleito na parcial".
    expect(
      doc.querySelectorAll("[data-testid='uf-agremiacao'] li[data-rank] [data-marca='parcial']")
        .length,
    ).toBe(3);
    const federacao = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='13']");
    const texto = federacao?.textContent ?? "";
    expect(texto).toContain("Ana Lima");
    // RF-122: dentro da federação, o eleito continua sendo de um partido.
    const partidos = [...(federacao?.querySelectorAll("li[data-rank] small") ?? [])].map(
      (el) => el.textContent,
    );
    expect(partidos).toEqual(expect.arrayContaining(["PT", "PCdoB"]));
  });

  it("(s) RF-127: cadeira decidida em sobra é legível como apertada, não com firmeza falsa", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    const linhas = [...doc.querySelectorAll("li[data-rank]")];
    const bruno = linhas.find((l) => l.textContent?.includes("Bruno Reis"));
    // A marcação é TEXTO, não só um atributo ou uma cor (WCAG 1.4.1).
    expect(bruno?.querySelector("[data-marca='parcial']")?.textContent).toMatch(/sobra apertada/);
    const apertadas = linhas.filter((l) => l.textContent?.includes("sobra apertada"));
    expect(apertadas).toHaveLength(1);
  });

  it("(t) spec 026: a lista inteira vai à tela, na ordem do voto, em três faixas; 'suplente' só com o TSE", async () => {
    // Reescrito pela spec 026: a suplência nominal saiu de "Fora". Quem não se
    // elegeu aparece — como a linha seguinte, sem rótulo: a palavra
    // "suplente" é do TSE e só teria lugar com a totalização final.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const v1doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const textoV1 = v1doc.body.textContent ?? "";
    expect(textoV1).toContain("Célia Mota");
    expect(textoV1).toContain("Eva Prado");
    expect(textoV1).not.toMatch(/suplente/i);

    // v2 de SP: PL com 71 candidatos — 60 no documento, na ordem do rank, 20
    // visíveis e 40 recortadas; o resto só no clique.
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='22']");
    const linhas = [...(pl?.querySelectorAll("li[data-rank]") ?? [])];
    expect(linhas.map((l) => Number(l.getAttribute("data-rank")))).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    expect(linhas.filter((l) => !l.hasAttribute("data-f"))).toHaveLength(20);
    const votos = linhas.map((l) =>
      Number((l.children[2]?.firstChild?.textContent ?? "").replace(/\./g, "")),
    );
    expect(votos).toEqual([...votos].sort((a, b) => b - a));
    expect(pl?.querySelector("[data-testid='dep-mostrar-todos']")?.textContent).toBe(
      "Mostrar todos os 71 candidatos de PL",
    );
    expect(doc.body.textContent).not.toMatch(/suplente/i);
  });

  it("(t2) ADR-0024: a cor na UF também vem de `sigla_lider` desta UF", async () => {
    // Lacuna encontrada por mutação em 12/09: `colorForParty("PL")` cravado
    // nesta página passava nos 40 testes. A cor da UF não tinha cobertura
    // nenhuma — só a da tela nacional tinha.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const cores = [...doc.querySelectorAll("[data-testid='uf-agremiacao'] span[aria-hidden]")].map(
      (el) => el.getAttribute("style") ?? "",
    );

    // FE BRASIL declara `sigla_lider: "PT"`; PL é partido isolado.
    expect(cores.join(" ")).toContain("var(--party-pt)");
    expect(cores.join(" ")).toContain("var(--party-pl)");
    expect(cores.join(" ")).not.toContain("var(--party-outros)");
  });

  it("(t3) o líder da UF pode diferir do nacional — a tela segue o da UF", async () => {
    // Contraprova de (t2): a mesma federação tem `sigla_lider: "PT"` no
    // nacional. Aqui, nesta UF, o líder é o PSOL. O design 017 § D6 diz que
    // divergir é esperado; a tela tem de seguir o campo LOCAL, não o nacional.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const d = detalhe();
    readDeputadoUfDetailMock.mockResolvedValue(
      ok({
        ...d,
        agremiacoes: d.agremiacoes.map((a) => (a.cod === "13" ? { ...a, sigla_lider: "PSOL" } : a)),
      }),
    );
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const cores = [...doc.querySelectorAll("[data-testid='uf-agremiacao'] span[aria-hidden]")].map(
      (el) => el.getAttribute("style") ?? "",
    );

    expect(cores.join(" ")).toContain("var(--party-psol)");
    expect(cores.join(" ")).not.toContain("var(--party-pt)");
  });

  it("(t4) sigla sem token na UF cai em --party-outros, sem cor ausente", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const d = detalhe();
    readDeputadoUfDetailMock.mockResolvedValue(
      ok({ ...d, agremiacoes: d.agremiacoes.map((a) => ({ ...a, sigla_lider: "NAO EXISTE" })) }),
    );
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const cores = [...doc.querySelectorAll("[data-testid='uf-agremiacao'] span[aria-hidden]")].map(
      (el) => el.getAttribute("style") ?? "",
    );

    expect(cores.length).toBeGreaterThan(0);
    for (const cor of cores) {
      expect(cor).toContain("var(--party-outros)");
      expect(cor).not.toContain("undefined");
    }
  });

  it("(t5) spec 026: na UF, 'projeção' só junto de 'não oficial' — e só com o interruptor ligado", async () => {
    // Reescrito pela spec 026 (ver (m5)). RR é `liberada` na fixture.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("RR")));

    const desligado = await render(UFDeputadoFederalPage(paramsDe("RR")));
    expect(projecaoForaDaMetodologia(desligado).total).toBe(0);
    expect(desligado.body.textContent).not.toMatch(/\bModelo\b/);

    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const ligado = await render(UFDeputadoFederalPage(paramsDe("RR")));
    const { soltas, total } = projecaoForaDaMetodologia(ligado);
    expect(total).toBeGreaterThan(0);
    expect(soltas).toEqual([]);
    expect(ligado.body.textContent).not.toMatch(/forecast/i);

    const metodologia = ligado.querySelector("[data-testid='dep-metodologia']")?.textContent ?? "";
    expect(metodologia).toMatch(/não são uma projeção/i);
  });

  it("(u) RF-130: nominal e legenda separados também na UF", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const votos = [...doc.querySelectorAll("[data-testid='uf-votos']")]
      .map((el) => el.textContent ?? "")
      .join(" ");

    expect(votos).toContain("3.000.000");
    expect(votos).toContain("250.000");
    expect(votos).toMatch(/nominais/);
    expect(votos).toMatch(/legenda/);
  });

  it("(v) RF-124: sem `lugares_a_preencher` a tela diz isso, e não imprime um número", async () => {
    const p = nacional();
    readDeputadoProjectionMock.mockResolvedValue({
      ...p,
      por_uf: [{ ...p.por_uf[0], lugares_a_preencher: null, quociente_eleitoral: null }],
    } as EdgePayloadDeputado);
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("not_found"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const rotulo = doc.querySelector("[data-testid='uf-vagas-label']")?.textContent ?? "";

    expect(rotulo).toMatch(/ainda não foi publicado pelo TSE/i);
    expect(rotulo).not.toMatch(/\d+ cadeiras em disputa/);
    // E a razão de não usarmos tabela própria fica dita (RF-124).
    expect(rotulo).toMatch(/não usamos tabela própria/i);
  });

  it("(w) constituição § 8: a conferência contra o TSE aparece, com e sem divergência", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(
      ok(
        detalhe({
          quociente_eleitoral_tse: 210_401,
          divergencias: [
            {
              o_que: "quociente_eleitoral",
              nosso: 210_400,
              tse: 210_401,
              detalhe: "1 voto de diferença no total de válidos.",
            },
          ],
        }),
      ),
    );
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    expect(doc.querySelector("[data-testid='uf-conferencia']")?.textContent).toMatch(
      /uma divergência/i,
    );
    // Sem totalização final, a divergência é ESPERADA — e dizer isso evita
    // que o leitor a interprete como erro nosso.
    expect(doc.querySelector("[data-testid='uf-conferencia']")?.textContent).toMatch(
      /ainda não é a totalização final/i,
    );
    const lista = doc.querySelector("[data-testid='uf-divergencias']")?.textContent ?? "";
    expect(lista).toContain("210.401");
    // O bloco existe para transparência (constituição § 8). Entregar o nome
    // do campo em snake_case é dizer "houve divergência" em jargão — meio
    // caminho para não dizer nada.
    expect(lista).toContain("Quociente eleitoral");
    expect(lista).not.toContain("quociente_eleitoral");
  });

  it("(w2) divergência de tipo desconhecido aparece feia, em vez de sumir", async () => {
    // Chave fora do mapa de rótulos: o fallback preserva o texto. Um
    // `?? ""` silencioso aqui apagaria uma divergência nova justamente no dia
    // em que ela surgisse.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(
      ok(
        detalhe({
          divergencias: [
            { o_que: "campo_que_ninguem_mapeou", nosso: 1, tse: 2, detalhe: "surgiu no simulado." },
          ],
        }),
      ),
    );
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    expect(doc.querySelector("[data-testid='uf-divergencias']")?.textContent).toContain(
      "campo que ninguem mapeou",
    );
  });

  it("(x) empate que sobrevive aos dois desempates é marcado, nunca decidido", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(
      ok(detalhe({ empates_indeterminados: ["12", "50"] })),
    );
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const texto = doc.querySelector("[data-testid='uf-empates']")?.textContent ?? "";

    expect(texto).toMatch(/2 cadeiras estão em empate/i);
    expect(texto).toMatch(/não prevê sorteio/i);
    expect(texto).toMatch(/não escolhemos/i);
  });

  it("(y) RF-128: a cadência da UF também sai do payload, não do JSX", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    expect(doc.querySelector("[data-testid='dep-metodologia']")?.textContent).toContain(
      "a cada 7 minutos",
    );
    expect(doc.body.textContent).not.toMatch(/a cada 15 minutos/);
  });

  it("(z) trilha `dep`, um <h1>, rodapé dentro do <main> e nada de mapa ou 2º turno", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const texto = doc.body.textContent ?? "";

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("main footer")).not.toBeNull();
    // Este cargo não tem dado municipal (ADR-0026 item 1): prometer mapa ou
    // "maiores colégios" seria afirmar que o dado existe e não chegou.
    expect(texto).not.toMatch(/maiores colégios/i);
    expect(texto).not.toMatch(/2º turno|segundo turno/i);
  });

  it("(aa) sem resumo E sem detalhe: a página degrada, sem inventar vaga nenhuma", async () => {
    readDeputadoProjectionMock.mockResolvedValue(null);
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("not_found"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const texto = doc.body.textContent ?? "";

    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(texto).toContain("Aguardando dados");
    expect(texto).not.toMatch(/\d+ cadeiras em disputa/);
  });

  it("(bb) resumo presente e Blob fora: o resumo NÃO cai no zero silencioso", async () => {
    // Contraprova de (q): se a página derivasse o resumo do Blob, esta
    // combinação imprimiria 0% apurado e 0 cadeiras — números falsos com cara
    // de verdadeiros.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("fetch_error"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const resumo = doc.querySelector("[data-testid='uf-resumo']")?.textContent ?? "";

    expect(resumo).toContain("70 de 70");
    expect(resumo).not.toContain("0 de 0");
  });
});

// ---------------------------------------------------------------------------
// ADR-0038 — os dois relógios nas duas telas de Deputado Federal
// ---------------------------------------------------------------------------

/**
 * O carimbo destas telas media a hora em que o **modelo** rodou e a chamava de
 * "Atualizado às". Nesta trilha a diferença é a maior do produto: a varredura é
 * fatiada em 6, uma fatia a cada 5 min, e a volta completa leva 30 min
 * (ADR-0036) — o modelo carimba muitas vezes mais do que o conjunto do dado se
 * renova.
 *
 * A tela de UF tinha ainda um segundo defeito, este achado na leitura do
 * ADR-0038: `nacional?.ts ?? detail?.ts` punha num `??` o relógio de escrita do
 * RESUMO (Global Config) e o do DETALHE (Blob) — duas escritas independentes,
 * não atômicas — sob um rótulo só.
 */
describe("ADR-0038 — hora do dado, e um relógio por frase", () => {
  const AGORA = Date.parse("2026-10-04T22:20:00-03:00");

  function comDadoTs(dadoTs: string | null | undefined) {
    const base = nacional();
    if (dadoTs === undefined) {
      // Payload pré-ADR: a CHAVE não existe, e é diferente de existir valendo
      // `null`. Deletar é a única forma de reproduzir o canary de verdade.
      const { dado_ts: _omitido, ...semCampo } = { ...base, dado_ts: null };
      return semCampo as EdgePayloadDeputado;
    }
    return { ...base, dado_ts: dadoTs };
  }

  // O gatilho do banner compara `dado_ts` contra a hora do SERVIDOR (ADR-0038
  // D4). Sem congelar o relógio, estes testes passariam hoje e virariam
  // "parado" amanhã — a classe de teste que só falha quando ninguém está
  // olhando.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(cc) nacional: `dado_ts` fresco → o carimbo é a hora do TSE, não a do modelo", async () => {
    // `ts` do payload é 22:15:00; o dado é de 22:18:30.
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs("2026-10-04T22:18:30-03:00"));
    const doc = await render(DeputadoFederalPage());
    const carimbo = doc.querySelector("[data-testid='dep-atualizacao']")?.textContent ?? "";

    expect(carimbo).toContain("Dado do TSE às 22:18:30");
    expect(carimbo).not.toContain("22:15:00");
    expect(carimbo).not.toContain("Atualizado às");
    // A cadência de RF-128 continua saindo do payload, ao lado do relógio novo.
    expect(carimbo).toContain("a cada 7 minutos");
  });

  it("(dd) nacional: `dado_ts` null → diz que não sabe, e não cai para `ts`", async () => {
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs(null));
    const doc = await render(DeputadoFederalPage());
    const carimbo = doc.querySelector("[data-testid='dep-atualizacao']")?.textContent ?? "";

    expect(carimbo).toContain("Hora do dado indisponível neste ciclo");
    expect(carimbo).not.toContain("22:15:00");
    expect(carimbo).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("(ee) nacional: chave ausente → a tela se comporta como antes do ADR", async () => {
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs(undefined));
    const doc = await render(DeputadoFederalPage());
    const carimbo = doc.querySelector("[data-testid='dep-atualizacao']")?.textContent ?? "";

    expect(carimbo).toContain("Atualizado às 22:15:00");
    expect(carimbo).not.toContain("Dado do TSE");
    expect(carimbo).not.toContain("indisponível");
    // E nenhum banner novo durante o canary.
    expect(doc.querySelector("[data-testid='dado-parado-banner']")).toBeNull();
  });

  it("(ff) nacional: o banner usa os 90 min do cargo 6, não os 3 min do Presidente", async () => {
    // 40 minutos parados: incidente em qualquer corrida majoritária, ciclo
    // perfeitamente normal aqui.
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs("2026-10-04T21:40:00-03:00"));
    const quarentaMin = await render(DeputadoFederalPage());
    expect(quarentaMin.querySelector("[data-testid='dado-parado-banner']")).toBeNull();

    // 100 minutos: passou das três voltas completas, acende.
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs("2026-10-04T20:40:00-03:00"));
    const cemMin = await render(DeputadoFederalPage());
    const banner = cemMin.querySelector("[data-testid='dado-parado-banner']");

    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("data-limiar-seconds")).toBe("5400");
    expect(banner?.textContent).toContain("a cada 30 minutos");
    // E a página NÃO some: o último apurado conhecido continua inteiro na tela
    // (constituição § 7, RNF-010/012).
    expect(cemMin.querySelector("[data-testid='dep-cadeiras-label']")).not.toBeNull();
    expect(cemMin.body.textContent).toContain("400 cadeiras");
  });

  it("(gg) UF: só o Blob respondeu → a frase diz que o carimbo é DO DETALHE", async () => {
    // Era aqui que o `??` mentia: sem resumo, a tela mostrava a hora de
    // gravação do Blob sob o mesmo "Atualizado às" que descreve o resumo.
    readDeputadoProjectionMock.mockResolvedValue(null);
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const carimbo = doc.querySelector("[data-testid='dep-atualizacao']")?.textContent ?? "";

    expect(carimbo).toContain("Detalhe deste estado gravado às 22:14:00");
    expect(carimbo).toContain("O resumo nacional não chegou neste ciclo");
    expect(carimbo).not.toMatch(/^Atualizado às/);
    expect(carimbo).not.toContain("Dado do TSE");
    // Sem resumo não há `dado_ts`, e um banner de "parado" montado sobre a
    // ausência da fonte seria alarme fabricado.
    expect(doc.querySelector("[data-testid='dado-parado-banner']")).toBeNull();
  });

  it("(hh) UF: com resumo, o carimbo é o do resumo — e nunca o do Blob", async () => {
    readDeputadoProjectionMock.mockResolvedValue(comDadoTs("2026-10-04T22:18:30-03:00"));
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const carimbo = doc.querySelector("[data-testid='dep-atualizacao']")?.textContent ?? "";

    expect(carimbo).toContain("Dado do TSE às 22:18:30");
    // 22:14:00 é o `ts` do Blob. Um `??` entre as duas fontes o traria de volta.
    expect(carimbo).not.toContain("22:14:00");
    expect(carimbo).not.toContain("Detalhe deste estado");
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

describe("spec 021 RF-192 emendado (2026-09-26, noite) — Deputado", () => {
  it("🔴 /deputado-federal NÃO tem 'Votação' — mesmo com `votacao` no payload", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional({ votacao: VOTACAO_UF }));
    const doc = await render(DeputadoFederalPage());
    expect(doc.querySelector('[aria-labelledby="votacao-eleitorado-heading"]')).toBeNull();
    expect(doc.querySelector('[data-testid="votacao-eleitorado"]')).toBeNull();
  });

  it("/uf/SP/deputado-federal tem 'Votação' do detalhe DA UF, depois do resumo e antes da bancada, sem 'A corrida'", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe({ votacao: VOTACAO_UF })));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')].map((p) =>
      p.getAttribute("aria-labelledby"),
    );
    expect(paineis.slice(0, 3)).toEqual([
      "resumo-heading",
      "votacao-uf-heading",
      "bancada-uf-heading",
    ]);
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel?.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe(
      "Deputado Federal · SP",
    );
    expect(
      painel?.querySelector('[data-testid="votacao-eleitorado"]')?.getAttribute("data-instalados"),
    ).toBe("900");
    expect(painel?.textContent ?? "").not.toMatch(/Brasil/);
    expect(doc.querySelector('[aria-labelledby="corrida-tres-circulos-heading"]')).toBeNull();
  });

  it("/uf/SP/deputado-federal com Blob fora do ar: 'Votação' fica no DOM, indisponível (RF-198)", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(indisponivel("fetch_error"));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel).not.toBeNull();
    expect(painel?.querySelector('[data-testid="detail-unavailable"]')).not.toBeNull();
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("/uf/SP/deputado-federal com detalhe anterior à emenda (sem `votacao`): indisponível, não quebra", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(detalhe()));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel?.querySelector('[data-testid="detail-unavailable"]')).not.toBeNull();
    expect(doc.querySelector("[data-testid='uf-agremiacoes']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec 026 — listas, marcas, projeção com trava, extras e correções
// ---------------------------------------------------------------------------

describe("spec 026 — /uf/[sigla]/deputado-federal", () => {
  function paineis(doc: Document): (string | null)[] {
    return [...doc.querySelectorAll('[data-testid="panel"]')].map((p) =>
      p.getAttribute("aria-labelledby"),
    );
  }

  it("§ Telas — a ordem dos blocos (objeto v2 de SP)", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    expect(paineis(doc)).toEqual([
      "resumo-heading",
      "votacao-uf-heading",
      "mais-votados-uf-heading",
      "bancada-uf-heading",
      "regras-heading",
      "conferencia-heading",
      "metodologia-heading",
    ]);
    // Um título por agremiação (ADR-0065: navegar por cabeçalhos).
    expect(doc.querySelectorAll("[data-testid='uf-agremiacao'] h3").length).toBe(
      v2("SP").agremiacoes.length,
    );
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  it("RF-276 — o v1 de sempre (dep-uf.json) renderiza: lista de eleitos + suplentes, sem os blocos v2", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v1("SP")));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));

    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='22']");
    // 14 eleitos + 5 suplentes, eleitos primeiro.
    expect(pl?.querySelectorAll("li[data-rank]").length).toBe(19);
    expect(pl?.querySelectorAll("li[data-rank] [data-marca='parcial']").length).toBe(14);
    for (const l of pl?.querySelectorAll("li[data-rank]") ?? [])
      expect(l.textContent).not.toMatch(/\d%/);
    for (const id of ["mais-votados-uf-heading", "regras-heading"]) {
      expect(paineis(doc)).not.toContain(id);
    }
    expect(doc.querySelector("[data-testid='uf-corte-cabecalho']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-corte']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-puxadores-agremiacao']")).toBeNull();
    expect(doc.querySelector("[data-testid='uf-projecao-estado']")).toBeNull();
    expect(doc.querySelector("[data-marca='projecao']")).toBeNull();
    // Conferência do v1: nunca o "batem" antigo.
    expect(doc.querySelector("[data-testid='uf-conferencia']")?.textContent).not.toContain(
      "batem com os que o TSE publica",
    );
  });

  it("🔴 M30 — RR liberada + interruptor DESLIGADO: nenhuma marca, número, selo ou bloco de projeção", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("RR")));
    const doc = await render(UFDeputadoFederalPage(paramsDe("RR")));
    expect(doc.querySelector("[data-marca='projecao']")).toBeNull();
    expect(doc.querySelector("[data-testid='uf-cadeiras-projetadas']")).toBeNull();
    expect(doc.querySelector("[data-testid='uf-projecao-estado']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-movendo']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-metodologia']")?.textContent).toContain(
      "a projeção está desligada no site",
    );
    // A parcial fica.
    expect(
      doc.querySelectorAll("[data-testid='uf-agremiacao'] li[data-rank] [data-marca='parcial']")
        .length,
    ).toBe(8);
  });

  it("RR liberada + interruptor LIGADO: marcas, cadeiras projetadas e o 'o que está movendo'", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("RR")));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(UFDeputadoFederalPage(paramsDe("RR")));
    expect(
      doc.querySelectorAll("[data-testid='uf-agremiacao'] li[data-rank] [data-marca='projecao']")
        .length,
    ).toBe(8);
    const mdb = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='15']");
    expect(mdb?.querySelector("[data-testid='uf-cadeiras-projetadas']")?.textContent).toBe(
      "2 cadeiras · projeção pontual · não oficial",
    );
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='22']");
    expect(pl?.querySelector("[data-testid='uf-cadeiras-projetadas']")?.textContent).toBe(
      "4 cadeiras na projeção · não oficial (faixa provável da projeção: 2 a 4)",
    );
    expect(doc.querySelector("[data-testid='uf-projecao-estado']")?.textContent).toContain(
      "Projeção liberada · não oficial",
    );
    const movendo = doc.querySelector("[data-testid='dep-movendo']")?.textContent ?? "";
    expect(movendo).toContain("MDB, 1 cadeira na parcial e 2 na projeção");
  });

  it("🔴 ADR-0063 D8 (emenda) — a faixa da PARCIAL nunca aparece como faixa da projeção", async () => {
    // Sem `cadeiras_projetadas_ci95` (adiada), o número projetado é PONTUAL e
    // a faixa ao lado leva o nome "faixa da parcial" VISÍVEL — antes o nome
    // era só `sr-only`, e "13 cadeiras na projeção" ao lado de "12 a 15
    // cadeiras" se lia como o intervalo da projeção.
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    const d = v2("RR");
    const semFaixaProjetada = {
      ...d,
      agremiacoes: d.agremiacoes.map((a) => {
        const { cadeiras_projetadas_ci95: _ci, ...resto } = a as typeof a & {
          cadeiras_projetadas_ci95?: [number, number];
        };
        return { ...resto, cadeiras_ci95: [1, 3] as [number, number] };
      }),
    };
    readDeputadoUfDetailMock.mockResolvedValue(ok(semFaixaProjetada));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(UFDeputadoFederalPage(paramsDe("RR")));
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='22']");
    const projetada =
      pl?.querySelector("[data-testid='uf-cadeiras-projetadas']")?.textContent ?? "";
    expect(projetada).toBe("4 cadeiras · projeção pontual · não oficial");
    expect(projetada).not.toMatch(/faixa/);
    expect(projetada).not.toContain("1 a 3");
    // A faixa da parcial: rótulo VISÍVEL (não `sr-only`) junto do número.
    const rotulo = pl?.querySelector("[data-testid='uf-intervalo-rotulo']");
    expect(rotulo?.textContent?.trim()).toBe("faixa da parcial");
    expect(rotulo?.closest(".sr-only")).toBeNull();
    expect(rotulo?.className ?? "").not.toContain("sr-only");
    expect(pl?.querySelector("[data-testid='uf-intervalo']")?.textContent).toBe("1 a 3 cadeiras");
  });

  it("🔴 M28 — RR: a ordem das linhas é a mesma com o interruptor ligado e desligado", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("RR")));
    const ordem = (d: Document) =>
      [...d.querySelectorAll("[data-testid='uf-agremiacao']")].map((a) =>
        [...a.querySelectorAll("li[data-rank] b")].map((b) => b.textContent).join(","),
      );
    const desligado = ordem(await render(UFDeputadoFederalPage(paramsDe("RR"))));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const ligado = ordem(await render(UFDeputadoFederalPage(paramsDe("RR"))));
    expect(ligado).toEqual(desligado);
  });

  it("interruptor ilegível (`falha`): desligada, e a metodologia diz que não foi possível ler", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("RR")));
    readInterruptorProjecaoMock.mockResolvedValue({
      ligada: false,
      pct_minimo: 25,
      origem: "falha",
    });
    const doc = await render(UFDeputadoFederalPage(paramsDe("RR")));
    expect(doc.querySelector("[data-marca='projecao']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-metodologia']")?.textContent).toContain(
      "não foi possível ler o interruptor da projeção",
    );
  });

  it("SP aguardando (18,7%) + ligado: a linha do resumo diz o que falta, com 'não oficial'", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const linha = doc.querySelector("[data-testid='uf-projecao-estado']")?.textContent ?? "";
    expect(linha).toContain("não oficial");
    expect(linha).toContain("aparece a partir de 25% do eleitorado apurado (agora 18,7%)");
    expect(doc.querySelector("[data-marca='projecao']")).toBeNull();
  });

  it("RF-267 — AC com totalização final: só 'Eleito (TSE)' e nenhuma marca da nossa conta", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("AC")));
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(UFDeputadoFederalPage(paramsDe("AC")));
    expect(
      doc.querySelectorAll("[data-testid='uf-agremiacao'] li[data-rank] [data-marca='tse']").length,
    ).toBe(8);
    expect(doc.querySelector("[data-marca='parcial']")).toBeNull();
    expect(doc.querySelector("[data-marca='projecao']")).toBeNull();
    // O corte é da parcial — com o TSE final, não há linha de corte.
    expect(doc.querySelector("[data-testid='uf-corte-cabecalho']")).toBeNull();
  });

  it("🔴 M31 — nenhum 'eleito' solto na página inteira, nas 4 UFs, ligado e desligado", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    for (const uf of ["AC", "AP", "RR", "SP"] as const) {
      for (const inter of [DESLIGADO, LIGADO]) {
        readDeputadoUfDetailMock.mockResolvedValue(ok(v2(uf)));
        readInterruptorProjecaoMock.mockResolvedValue(inter);
        const doc = await render(UFDeputadoFederalPage(paramsDe(uf)));
        expect(
          (doc.body.textContent ?? "").match(ELEITO_SOLTO),
          `${uf}/${inter.origem}`,
        ).toBeNull();
      }
    }
  });

  it("RF-270 — mais votados de SP, do próprio objeto da UF", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const itens = [...doc.querySelectorAll("[data-testid='dep-mais-votados-uf'] > li")];
    expect(itens).toHaveLength(10);
    expect(itens[0]?.textContent).toContain("Araújo SP-22-01");
  });

  it("🔴 M36 — RF-272: o corte do PL (depois do 25º, na faixa recortada) está repetido no cabeçalho", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='22']");
    expect(pl?.querySelector("[data-testid='dep-corte']")?.hasAttribute("data-f")).toBe(true);
    expect(pl?.querySelector("[data-testid='uf-corte-cabecalho']")?.textContent).toBe(
      "Corte: 599 votos entre o último eleito na parcial e o primeiro de fora.",
    );
  });

  it("RF-273 / RF-274 — puxadores do PL de SP e as regras com os números de SP", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const pux = doc.querySelector("[data-testid='dep-puxadores-agremiacao']")?.textContent ?? "";
    expect(pux).toContain("Araújo SP-22-01 fez 3 quocientes eleitorais de SP sozinho");
    expect(doc.querySelector("[data-testid='dep-regras-qe']")?.textContent).toBe("62.284 votos");
    expect(doc.querySelector("[data-testid='dep-regras-piso-candidato']")?.textContent).toBe(
      "6.229 votos",
    );
  });

  it("🔴 M35 — RF-269: SP sem dado do TSE — a Conferência não afirma que bate", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("SP")));
    const doc = await render(UFDeputadoFederalPage(PARAMS_SP));
    const t = doc.querySelector("[data-testid='uf-conferencia']")?.textContent ?? "";
    expect(t.replace("não dizemos que os números batem", "")).not.toMatch(/bat(em|e)\b/);
    expect(t).not.toContain("Conferimos");
  });

  it("RF-269 — AP: a Conferência dá o eleitorado 19,5% abaixo do TSE, com os dois números", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("AP")));
    const doc = await render(UFDeputadoFederalPage(paramsDe("AP")));
    const item = doc.querySelector("[data-o-que='eleitorado']")?.textContent ?? "";
    expect(item).toContain("505.610");
    expect(item).toContain("628.071");
    expect(item).toContain("19,5% abaixo");
  });

  it("RF-261 — chapa inteira sub judice (AGIR do AP): votos, destino escrito, nenhum %", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readDeputadoUfDetailMock.mockResolvedValue(ok(v2("AP")));
    const doc = await render(UFDeputadoFederalPage(paramsDe("AP")));
    const agir = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='36']");
    const linhas = [...(agir?.querySelectorAll("li[data-rank]") ?? [])];
    expect(linhas).toHaveLength(5);
    for (const l of linhas) {
      expect(l.textContent).toContain("sub judice — fora da conta");
      expect(l.textContent).not.toMatch(/\d%/);
    }
  });
});

describe("spec 026 — /deputado-federal (capa)", () => {
  const payloadV2 = () => structuredClone(contratoNacional) as unknown as EdgePayloadDeputado;

  it("🔴 M34 — RF-271: a capa NUNCA lê o Blob de UF, e mostra os mais votados e os puxadores do país", async () => {
    readDeputadoProjectionMock.mockResolvedValue(payloadV2());
    const doc = await render(DeputadoFederalPage());
    expect(readDeputadoUfDetailMock).not.toHaveBeenCalled();
    const mv = [...doc.querySelectorAll("[data-testid='dep-mais-votados-pais'] > li")];
    expect(mv).toHaveLength(10);
    expect(mv[0]?.textContent).toContain("dos válidos de SP");
    expect(doc.querySelectorAll("[data-testid='dep-puxadores-pais'] > li").length).toBe(3);
  });

  it("selo da projeção por UF: só com o interruptor ligado, e sempre com 'não oficial'", async () => {
    readDeputadoProjectionMock.mockResolvedValue(payloadV2());
    const desligado = await render(DeputadoFederalPage());
    expect(desligado.querySelector("[data-testid='corrida-projecao']")).toBeNull();

    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const ligado = await render(DeputadoFederalPage());
    const selo = (uf: string) =>
      ligado.querySelector(`[data-uf='${uf}'] [data-testid='corrida-projecao']`)?.textContent;
    expect(selo("RR")).toBe("projeção liberada · não oficial");
    expect(selo("SP")).toBe("projeção · não oficial: aguarda 25%");
    expect(selo("AP")).toBe("projeção · não oficial: indisponível");
    // UF sem estado publicado (fora do payload) não ganha selo.
    expect(selo("MG")).toBeUndefined();
  });

  it("payload anterior à spec 026 (sem os campos): os blocos novos não aparecem e nada quebra", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacional());
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await render(DeputadoFederalPage());
    expect(doc.querySelector("[data-testid='dep-mais-votados-pais']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-puxadores-pais']")).toBeNull();
    expect(doc.querySelector("[data-testid='corrida-projecao']")).toBeNull();
    // Sem selo na tela, sem o bloco do § 8 da projeção na capa.
    expect(doc.querySelector("[data-testid='dep-movendo']")).toBeNull();
  });

  it("🔴 constituição § 8 — com selo de projeção na capa, o 'o que está movendo a projeção · não oficial' aparece", async () => {
    // Interruptor desligado: nenhum selo, nenhum bloco.
    readDeputadoProjectionMock.mockResolvedValue(payloadV2());
    const desligado = await render(DeputadoFederalPage());
    expect(desligado.querySelector("[data-testid='corrida-projecao']")).toBeNull();
    expect(desligado.querySelector("[data-testid='dep-movendo']")).toBeNull();

    // Ligado: os selos aparecem — e o bloco junto, com "não oficial" no
    // TÍTULO e no PARÁGRAFO (quem cita um leva o rótulo).
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const ligado = await render(DeputadoFederalPage());
    expect(ligado.querySelector("[data-testid='corrida-projecao']")).not.toBeNull();
    const bloco = ligado.querySelector("[data-testid='dep-movendo']");
    expect(bloco?.querySelector("h3")?.textContent).toBe(
      "O que está movendo a projeção · não oficial",
    );
    const paragrafo = (bloco?.querySelector("p")?.textContent ?? "").replace(/\s+/g, " ");
    expect(paragrafo).toContain("não oficial");
    // AC (100%, totalização final) e RR são as UFs liberadas da fixture nacional
    // de contrato; SP aguarda e AP está indisponível.
    expect(paragrafo).toMatch(/liberada em 2 de 27 estados \(AC, RR\)/);
    // O bloco vive dentro da metodologia (o § 8 da capa) e nunca soma projeções.
    expect(bloco?.closest("[data-testid='dep-metodologia']")).not.toBeNull();
    expect(paragrafo).not.toMatch(/bancada nacional projetada|\d+ cadeiras na projeção/);
  });
});
