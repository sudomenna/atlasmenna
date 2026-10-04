// @vitest-environment happy-dom
/**
 * tests/unit/pages/senador.test.tsx — spec 016, as duas telas.
 *
 * `/senador` (T-09) e `/uf/[sigla]/senador` (T-10), renderizadas por SSR com
 * o reader mockado — o mesmo padrão de `tests/unit/components/UFPage.test.tsx`.
 *
 * O fio condutor de todos os casos é o mesmo da spec: **são duas vagas, e
 * quase toda a gramática das outras telas descreve uma só.** Por isso boa
 * parte dos asserts é negativa — eles falham se a tela voltar a falar de
 * "líder", de "margem do 1º sobre o 2º" ou de "1 vaga".
 *
 * `NODE_ENV` aqui é `test`, então o atalho de fixture das páginas (que só roda
 * em `development`) fica fora do caminho: o que se mede é o comportamento com
 * o payload que o reader devolve, inclusive o `null`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SenadoPage from "@/app/(sen)/senador/page";
import UFSenadorPage from "@/app/(sen)/uf/[sigla]/senador/page";
import type { UfDetailResult } from "@/lib/blob/uf-detail";
import { FASE_PRE_ELEICAO } from "@/lib/config/fase";
import type {
  EdgeCandidate,
  EdgePayload,
  EdgePayloadUf,
  EdgeSeriePorCandidato,
  EdgeUfCandidate,
  EdgeUfMunicipio,
  EdgeUfRow,
} from "@/lib/edge-config/types";
import senCurrent from "@/tests/fixtures/edge-config/sen-current.json" with { type: "json" };
import simulacao from "@/tests/fixtures/simulacao/senador.json" with { type: "json" };

const readProjectionMock = vi.fn();
const readUfProjectionMock = vi.fn();

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
 * Spec 020, Fase 2 — esta rota passou a ler o Vercel Blob EM PARALELO com o
 * resumo, porque é lá que mora a série por candidatura (ADR-0046 D3).
 *
 * Sem este mock o arquivo faria uma requisição de REDE de verdade
 * (`BLOB_PUBLIC_BASE_URL` vem do `.env.local`), que o happy-dom bloqueia por
 * CORS e que degrada para `fetch_error`: passaria, mas por acidente, devagar e
 * dependendo do mundo lá fora — a mesma armadilha que o mock de
 * `@/lib/blob/candidatos` acima já evitava.
 *
 * `importOriginal`: `seriePorCandidatoFrom` segue REAL. Só a ida à rede é
 * substituída, e `not_configured` é a degradação declarada.
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

/**
 * Duas vagas por estado — a regra da eleição (RF-106), escrita aqui como
 * LITERAL de propósito. A página lê o número de `lib/config/cargos.ts`; se o
 * teste lesse de lá também, os dois mudariam juntos e uma alteração daquela
 * tabela passaria sem ninguém reclamar. O que este arquivo mede é a regra, não
 * a coerência do código consigo mesmo.
 */
const VAGAS_SENADO = 2;

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function render(node: Promise<React.ReactElement> | React.ReactElement): Promise<Document> {
  return parse(renderToStaticMarkup(await node));
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * Quantas LINHAS carregam marcador de vaga. Versão D (2026-09-27): quem ocupa
 * vaga nas duas bases leva DOIS selos (um por base, cada um sob o seu
 * `data-view-only`), então contar os marcadores dobraria a conta — a intenção
 * destes casos é "quantas candidaturas a tela marca", e é isso que se conta.
 */
function linhasComVaga(doc: Document): number {
  return [...doc.querySelectorAll("li")].filter(
    (li) => li.querySelector("[data-testid='result-vaga-marker']") != null,
  ).length;
}

/**
 * RF-301 — as pílulas de "As 54 vagas" (os `<li>` FILHOS do `<ul>`), pelo
 * texto VISÍVEL: o do `<summary>` sem o `.sr-only`, ou o do próprio `<li>`
 * quando ele não abre. Os nomes de dentro do `<details>` ficam de fora.
 */
function pilulas(ul: Element | null | undefined): string[] {
  return [...(ul?.children ?? [])].map((li) => {
    const details = li.firstElementChild?.tagName === "DETAILS" ? li.firstElementChild : null;
    const alvo = (details?.querySelector("summary") ?? li).cloneNode(true) as Element;
    for (const s of [...alvo.querySelectorAll(".sr-only")]) s.remove();
    return (alvo.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

/** RF-301 — a pílula (`<li>` filho) cujo texto visível é `rotulo` ("9 PL"). */
function pilula(ul: Element | null | undefined, rotulo: string): Element | undefined {
  const lis = [...(ul?.children ?? [])];
  return lis[pilulas(ul).indexOf(rotulo)];
}

/** RF-301 — os nomes que uma pílula abre (`<ol> > <li>`), ou `null` se ela não abre. */
function nomesDaPilula(li: Element | undefined): string[] | null {
  const ol = li?.querySelector("details > ol");
  return ol ? [...ol.children].map((n) => (n.textContent ?? "").trim()) : null;
}

function ufCand(
  id: number,
  nome: string,
  partido: string,
  pct: number,
  over: Partial<EdgeUfCandidate> = {},
): EdgeUfCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${id})`,
    votos_atuais: Math.round(pct * 10_000),
    votos_projetados: Math.round(pct * 20_000),
    pct_atual: pct,
    pct_projetado: pct,
    // IC com largura > 0 ⇒ há incerteza medida e o painel de chances aparece.
    ci95: { lower: pct - 2, upper: pct + 2 },
    ...over,
  };
}

/** SP: 40 / 30 / 29 / 1 — o cenário literal da aceitação do RF-104. */
function ufPayload(over: Partial<EdgePayloadUf> = {}): EdgePayloadUf {
  return {
    uf: "SP",
    ts: "2026-10-04T21:00:00Z",
    cargo: 5,
    turno: 1,
    pct_apurado: 62,
    candidatos: [
      ufCand(1, "Ana Lima", "PT", 40, { p_eleito: 0.97 }),
      ufCand(2, "Bruno Reis", "PL", 30, { p_eleito: 0.61 }),
      ufCand(3, "Célia Mota", "MDB", 29, { p_eleito: 0.39 }),
      ufCand(4, "Davi Nunes", "PSOL", 1, { p_eleito: 0.03 }),
    ],
    needle_position: 0,
    needle_band: "tossup",
    vagas: 2,
    granularidade: "uf",
    ...over,
  };
}

function natCand(id: number, nome: string, partido: string, pct: number): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${id})`,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: pct,
    pct_projetado: pct,
    pct_projetado_lower: pct - 2,
    pct_projetado_upper: pct + 2,
    p_vitoria: 0,
    rank: id,
    p_passa_2t: 0,
    p_fecha_1t: 0,
  };
}

function nacional(over: Partial<EdgePayload> = {}): EdgePayload {
  return {
    ts: "2026-10-04T21:00:00Z",
    cargo: 5,
    turno: 1,
    pct_apurado_total: 55.5,
    ufs_apuradas: 2,
    national: {
      candidatos: [
        natCand(1, "Ana Lima", "PT", 40),
        natCand(2, "Bruno Reis", "PL", 30),
        natCand(3, "Célia Mota", "MDB", 29),
        natCand(11, "Eva Prado", "PSD", 45),
        natCand(12, "Fábio Cruz", "PP", 28),
        natCand(13, "Gil Souza", "PDT", 20),
      ],
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: null,
      cenarios_2t: [],
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 62,
        lider: 1,
        margem_atual: 1,
        margem_projetada: 1,
        margem_projetada_ci: [-1, 3],
        chamada: false,
        swing_vs_2022: null,
        // Spec 018 / ADR-0042 — nome e partido vêm da linha da UF, não mais
        // do índice sobre `national.candidatos` (que no Senado é a união de
        // 27 corridas sob o mesmo espaço de `id`). Payload pós-018; o caso
        // pré-018 tem teste dedicado — "(g2)".
        top_candidatos: [
          { id: 1, pct: 40, nome: "Ana Lima", partido: "PT", sqcand: "250002553928" },
          { id: 2, pct: 30, nome: "Bruno Reis", partido: "PL", sqcand: "250002553929" },
          { id: 3, pct: 29, nome: "Célia Mota", partido: "MDB", sqcand: "50002553930" },
        ],
        vai_a_2t: null,
        bucket: "indefinido",
      },
      {
        sigla: "RJ",
        pct_apurado: 48,
        lider: 11,
        margem_atual: 8,
        margem_projetada: 8,
        margem_projetada_ci: [6, 10],
        chamada: false,
        swing_vs_2022: null,
        top_candidatos: [
          { id: 11, pct: 45, nome: "Eva Prado", partido: "PSD", sqcand: "250002553931" },
          { id: 12, pct: 28, nome: "Fábio Cruz", partido: "PP", sqcand: "250002553932" },
          { id: 13, pct: 20, nome: "Gil Souza", partido: "PDT", sqcand: "50002553933" },
        ],
        vai_a_2t: null,
        bucket: "indefinido",
      },
    ],
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
    composicao_vagas: {
      vagas_em_disputa: 54,
      total_cadeiras: 81,
      vagas_por_uf: 2,
      ufs_projetadas: 2,
      ufs_aguardando: 25,
      vagas_projetadas: 4,
      por_partido: [
        { partido: "PL", vagas: 1 },
        { partido: "PP", vagas: 1 },
        { partido: "PSD", vagas: 1 },
        { partido: "PT", vagas: 1 },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  readProjectionMock.mockReset();
  readUfProjectionMock.mockReset();
});

// ---------------------------------------------------------------------------
// T-09 — /senador
// ---------------------------------------------------------------------------

describe("/senador (T-09)", () => {
  it("(a) lê a chave do cargo 5 com cargo E turno explícitos (ADR-0028)", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    await render(SenadoPage());

    expect(readProjectionMock).toHaveBeenCalledWith({ cargo: "sen", turno: 1 });
  });

  it("(b) RF-106: diz '2 vagas por estado' junto ao título — e nunca '1 vaga'", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    expect(doc.querySelector("[data-testid='senado-vagas-label']")?.textContent).toContain(
      "2 vagas por estado",
    );
    // O kit rotula "1 vaga" (ADR-0029). Herdar esse rótulo aqui seria um erro
    // de fato sobre a eleição.
    expect(doc.body.textContent).not.toMatch(/\b1 vaga\b/);
  });

  it("(c) RF-107: o denominador é 54, e as 81 cadeiras são distinguidas dele", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const nota = doc.querySelector("[data-testid='composicao-nota']")?.textContent ?? "";

    expect(doc.body.textContent).toContain("54");
    expect(nota).toContain("81 cadeiras");
    expect(nota).toMatch(/renova dois terços/i);
    // As 27 que não estão em disputa precisam ser nomeadas — senão o leitor
    // soma 54 e conclui que o Senado tem 54 cadeiras.
    expect(nota).toContain("27");
    expect(nota).toMatch(/eleitos em 2022/i);
  });

  it("(d) RF-107: conta vagas por partido e nomeia o que ainda falta apurar", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const lista = doc.querySelector("[data-testid='composicao-partidos']")?.textContent ?? "";

    for (const sigla of ["PT", "PL", "PSD", "PP"]) {
      expect(lista).toContain(sigla);
    }
    // 54 em disputa − 4 projetadas = 50 aguardando. Sem esse número a soma
    // não fecha e o leitor conclui que sumiram vagas.
    expect(doc.querySelector("[data-testid='composicao-aguardando']")?.textContent).toContain("50");
  });

  it("(e) RF-107: a nota declara que o total é soma nossa, não dado nacional do TSE", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const nota = doc.querySelector("[data-testid='composicao-nota']")?.textContent ?? "";

    expect(nota).toMatch(/soma das 27 corridas/i);
    expect(nota).toMatch(/não publica um arquivo nacional/i);
  });

  // 🔴 2026-09-27 (decisão do dono) — a capa passou a usar o cartão de
  // `/governador` (`<GovernorCard cargo="sen">`): 4 posições + "Outros", em %
  // dos votos válidos. Os casos antigos (f) "margem p/ 2ª vaga", (g) "os DOIS
  // ocupantes sem ordinal", (g4)/(g5) "Fora das vagas" descreviam a lista de
  // 19/09 e saíram com ela. A margem da 2ª vaga segue na tela do estado — (n).

  /** As linhas do cartão de uma UF, texto normalizado. */
  function linhasDoCartao(doc: Document, sigla: string): string[] {
    return [...doc.querySelectorAll(`[data-uf='${sigla}'] article li`)].map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
  }

  it("🔴 (f) cada estado é o cartão de governador: posições 1° a 4°, em % dos votos válidos", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const sp = linhasDoCartao(doc, "SP");

    expect(sp[0]).toMatch(/^1° ?Ana Lima ?PT.*40%$/);
    expect(sp[1]).toMatch(/^2° ?Bruno Reis ?PL.*30%$/);
    expect(sp[2]).toMatch(/^3° ?Célia Mota ?MDB.*29%$/);
    // O cabeçalho do cartão: nome do estado e o apurado, como em /governador.
    const cartao = doc.querySelector("[data-uf='SP'] article");
    // h4 desde 2026-09-28 (ADR-0057): o cartão vive dentro da região (h3),
    // que vive no painel "Estado a estado" (h2).
    expect(cartao?.querySelector("h4")?.textContent).toContain("São Paulo");
    expect(cartao?.textContent).toContain("62% apur");
    // O cartão continua sendo o link para a tela do estado.
    expect(doc.querySelector("a[data-uf='SP']")?.getAttribute("href")).toBe("/uf/SP/senador");
  });

  it("🔴 (g) 'Vaga projetada' nos DOIS ocupantes de vaga, nunca no 3º; sem selo de turno nem 'eleito'", async () => {
    // 🔴 2026-10-04 (dono, auditoria P1) — o selo de 29/09 dizia "● ELEITO"
    // pela projeção; virou "Vaga projetada" (a base dita). "Matematicamente
    // eleito" só com `eleitos_definidos` (`GovernorCard.eleitosDefinidos`).
    // 2026-09-29 (dono: "são 2 senadores eleitos") — até esta data este caso
    // afirmava o CONTRÁRIO (nenhum "ELEITO" no cartão): a decisão de 27/09
    // tirou o selo porque ele só existia no líder. Agora ele volta nos dois.
    // Mutações alvo: selo só no rank 1 (Bruno perde); `vagas = 1` no Senado
    // (idem); selo de turno vazando (VAI A 2T / EM APURAÇÃO).
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const lista = doc.querySelector("ul[aria-label='Corridas estaduais de senador']");
    expect(lista).not.toBeNull();
    expect(lista?.textContent ?? "").not.toMatch(/VAI A 2T|EM APURAÇÃO/);

    const sp = linhasDoCartao(doc, "SP");
    expect(sp[0]).toMatch(/Ana Lima.*Vaga projetada/);
    expect(sp[1]).toMatch(/Bruno Reis.*Vaga projetada/);
    expect(sp[2]).not.toContain("Vaga");
    expect(doc.querySelectorAll("[data-uf='SP'] article b[data-s='e']")).toHaveLength(0);
    expect(lista?.textContent ?? "").not.toMatch(/eleito/i);

    // O rótulo acessível diz "eleitos" e nomeia os DOIS, não "o líder".
    // Desde 04/10/2026 (cartão nas duas bases) a descrição da projeção mora na
    // `<ul>` da visão Projeção; o `<article>` diz só UF e apurado.
    const aria =
      doc
        .querySelector("[data-uf='SP'] article [data-view-only='proj'] > ul")
        ?.getAttribute("aria-label") ?? "";
    expect(aria).toMatch(/vaga projetada: Ana Lima .* e Bruno Reis /);
    expect(aria).not.toMatch(/eleito/i);
    expect(aria).not.toContain("Célia Mota");
    expect(aria).not.toMatch(/líder/);
  });

  it("(g2) payload PRÉ-018 (sem `nome` em top_candidatos) → placeholder, nunca o nome do índice nacional", async () => {
    // Spec 018 / ADR-0042. Mutação alvo: remover o fallback, ou fazê-lo voltar
    // a `porId` sobre `national.candidatos` — que no Senado é a união de 27
    // corridas sob o mesmo espaço de `id`, e devolveria "Ana Lima" em
    // qualquer estado só porque o número bate.
    const base = nacional();
    readProjectionMock.mockResolvedValue({
      ...base,
      por_uf: base.por_uf.map((uf) => ({
        ...uf,
        top_candidatos: uf.top_candidatos.map((t) => ({ id: t.id, pct: t.pct })),
      })),
    });
    const doc = await render(SenadoPage());
    const sp = doc.querySelector("[data-uf='SP']")?.textContent ?? "";

    // Placeholder do `<GovernorCard>` (2026-09-27: a capa usa o cartão).
    expect(sp).toContain("Cand 1");
    expect(sp).not.toContain("Ana Lima");
    expect(sp).not.toContain("Bruno Reis");
  });

  it("(g3) duas UFs com o MESMO número exibem nomes diferentes", async () => {
    // Em cargo majoritário o número na urna é o número do partido, então o
    // mesmo número concorre em todos os estados. A fixture já tem "Eva Prado"
    // (id 11) liderando o RJ; damos a SP um 11 com outro nome — os dois
    // ocupando vaga, para que ambos apareçam — e conferimos que os cards não
    // se contaminam.
    const base = nacional();
    readProjectionMock.mockResolvedValue({
      ...base,
      por_uf: base.por_uf.map((uf) =>
        uf.sigla === "SP"
          ? {
              ...uf,
              top_candidatos: [
                { id: 11, pct: 40, nome: "Helena de SP", partido: "PSD" },
                ...uf.top_candidatos.slice(1),
              ],
            }
          : uf,
      ),
    });
    const doc = await render(SenadoPage());
    const sp = doc.querySelector("[data-uf='SP']")?.textContent ?? "";
    const rj = doc.querySelector("[data-uf='RJ']")?.textContent ?? "";

    expect(sp).toContain("Helena de SP");
    expect(sp).not.toContain("Eva Prado");
    expect(rj).toContain("Eva Prado");
    expect(rj).not.toContain("Helena de SP");
  });

  // --- 2026-09-19: a segunda linha, "Fora das vagas" ----------------------
  //
  // O balão de hover dos mapas (`<HoverCard>`) mostra quatro candidaturas por
  // UF mais a cauda somada, e é `aria-hidden` por construção — ele espelha o
  // que um ponteiro revelou, e quem navega por teclado não tem ponteiro. Esta
  // lista é o alvo do `aria-describedby` do mapa nacional de Senador, então o
  // que ela cala não existe para leitor de tela nenhum.

  /** A fixture nacional com a cauda somada na linha de SP. */
  function comCaudaEmSP(over: Partial<NonNullable<EdgeUfRow["outros"]>> = {}) {
    const base = nacional();
    return {
      ...base,
      por_uf: base.por_uf.map((uf) =>
        uf.sigla === "SP"
          ? {
              ...uf,
              outros: { pct: 8.1, pct_atual: 6.4, votos_atuais: 12_345, n_candidatos: 7, ...over },
            }
          : uf,
      ),
    };
  }

  it("(g4) 'Outros' vem do CAMPO somado, nunca de 100 − Σ(top)", async () => {
    // Mutação alvo: trocar `outros.pct` por `100 − Σ(top)`. A fixture de SP
    // soma 40 + 30 + 29 = 99, então a subtração daria 1% e não 8,1%.
    readProjectionMock.mockResolvedValue(comCaudaEmSP());
    const doc = await render(SenadoPage());
    const outros = linhasDoCartao(doc, "SP").find((l) => l.startsWith("Outros"));
    expect(outros).toMatch(/^Outros.*8,1%$/);
    expect(outros).not.toMatch(/ 1%$/);
  });

  it("(g6) cauda AUSENTE ⇒ nenhuma linha de 'Outros'", async () => {
    // Campo ausente significa "não há mais ninguém" (UF com ≤ 4 candidaturas),
    // não "os demais somam zero".
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const sp = linhasDoCartao(doc, "SP");
    expect(sp.some((l) => l.includes("Célia Mota"))).toBe(true);
    expect(sp.some((l) => l.startsWith("Outros"))).toBe(false);
  });

  it("(h) RF-108: cadência em texto, e SEM a afirmação de nível de estado", async () => {
    // Até 2026-09-11 esta asserção era invertida: exigia o texto "esta projeção
    // é feita no nível do estado — o TSE publica um boletim agregado por UF
    // para este cargo, e não um por zona eleitoral". Isso deixou de ser verdade
    // quando o cargo 5 passou a ser ingerido por ZONA (emenda (b) do ADR-0026),
    // e uma tela que afirma isso mente sobre a própria metodologia
    // (constituição § 8). A granularidade agora sai de `lib/config/cargos.ts`,
    // não de literal na página — se alguém voltar a fixá-la, este teste cai.
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const nota = doc.querySelector("[data-testid='forecast-cadencia']")?.textContent ?? "";

    expect(nota).toContain("a cada 5 minutos");
    expect(nota).not.toMatch(/nível do estado/i);
    expect(nota).not.toMatch(/não um por zona eleitoral/i);
  });

  it("(i) trilha `sen` e exatamente um <h1> (a aba do shell depende do atributo)", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("sen");
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  /**
   * ⚠️ **Reescrito em 2026-09-14, e o teste anterior travava o defeito.**
   *
   * Ele exigia, com o reader devolvendo `null`, que a tela contivesse "54 vagas
   * em disputa", "nenhum estado apurado" e o bloco `forecast-cadencia`. Todas as
   * três vinham do `emptyPayload()` — um `EdgePayload` completo **de zeros** que
   * a página renderizava como se fosse resultado. O teste passava e o produto
   * mentia: era a mentira nº 10 da tabela do design 019 § D2.
   *
   * O que o teste mede agora é a regra que substituiu aquele fallback:
   * **sem número conhecido, a tela não mostra número.** A estrutura continua de
   * pé (a página não some — constituição § 3), e o que fica nela é identidade:
   * o `<h1>`, a frase sobre nós, e os 27 estados como links.
   *
   * A exigência da constituição § 8 saiu junto, e não por descuido: o bloco "O
   * que está movendo o forecast" é obrigatório em "toda página **com
   * projeção**", e uma página sem payload não tem projeção nenhuma a decompor —
   * `forecast-cadencia` ali imprimia a decomposição de coisa nenhuma.
   */
  it("(j) sem payload a página não some — e não mostra número nenhum", async () => {
    readProjectionMock.mockResolvedValue(null);
    const doc = await render(SenadoPage());

    // A estrutura fica de pé.
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("sen");
    expect(doc.querySelector("main footer")).not.toBeNull();
    expect(doc.querySelector("[data-testid='sen-aguardando']")).not.toBeNull();
    expect(doc.querySelectorAll("[data-testid='uf-links-grid-item']").length).toBe(27);

    // E nenhuma das três afirmações que o `emptyPayload()` produzia.
    expect(doc.body.textContent).not.toMatch(/nenhum estado apurado/i);
    expect(doc.body.textContent).not.toMatch(/apuração concluída/i);
    expect(doc.querySelector("[data-testid='forecast-cadencia']")).toBeNull();
  });

  it("(k) o rodapé constitucional continua DENTRO do <main>", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    expect(doc.querySelector("main footer")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec 023 — o Senado de 2027 em /senador (RF-216..RF-219)
// ---------------------------------------------------------------------------

describe("/senador — spec 023: as 81 cadeiras e a barra na paleta de partido", () => {
  /** Os `<section>` de painel do `<main>`, pelo id do título. */
  function ordemDosPaineis(doc: Document): string[] {
    return [...doc.querySelectorAll("main > section[aria-labelledby]")].map(
      (s) => s.getAttribute("aria-labelledby") as string,
    );
  }

  const hemiciclo = (doc: Document) => doc.querySelector("[data-testid='senado-hemiciclo']");

  it("RF-216: o hemiciclo vem logo DEPOIS das 54 vagas, e a barra das 54 FICA", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    const ordem = ordemDosPaineis(doc);
    const i = ordem.indexOf("composicao-heading");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ordem[i + 1]).toBe("senado-2027-heading");
    expect(ordem[i + 2]).toBe("corridas-heading");
    expect(doc.querySelector("[data-testid='vote-bar']")).not.toBeNull();
  });

  it("RF-216: 81 bolinhas com a foto versionada do Senado, e a data dela visível", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    const h = hemiciclo(doc);
    expect(
      h?.querySelectorAll("[data-testid='senado-hemiciclo-figura'] > svg circle"),
    ).toHaveLength(81);
    expect(h?.getAttribute("data-fase")).toBe("normal");
    // As 4 vagas do fixture (SP e RJ) estão projetadas; as 50 restantes, aguardando.
    expect(h?.querySelectorAll("svg g[data-estado='projetada'] circle")).toHaveLength(4);
    expect(h?.querySelectorAll("svg g[data-estado='aguardando'] circle")).toHaveLength(50);
    expect(h?.querySelectorAll("svg g[data-estado='continua_2031'] circle")).toHaveLength(27);
    expect(doc.querySelector("[data-testid='senado-hemiciclo-foto']")?.textContent).toMatch(
      /conforme o Senado em \d{2}\/\d{2}\/\d{4}/,
    );
  });

  it("RF-218: o bloco inteiro não diz 'eleito' — e o resto da página segue dizendo 'eleitos em 2022' na nota das 54", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    const painel = doc.querySelector("section[aria-labelledby='senado-2027-heading']");
    expect(painel?.textContent ?? "").not.toMatch(/eleit/i);
    expect(painel?.innerHTML ?? "").not.toMatch(/eleit/i);
  });

  // 🔴 MUTAÇÃO: voltar a barra para `var(--color-cand-${i + 1})` — os dois
  // casos abaixo caem.
  it("RF-219: cada segmento da barra das 54 tem a cor `-text` do PARTIDO, nunca a de rank", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    const segmentos = [...doc.querySelectorAll("[data-testid='vote-bar-segment']")];
    expect(segmentos.length).toBe(4);
    const fundos = segmentos.map((s) => (s as HTMLElement).getAttribute("style") ?? "");
    for (const [i, partido] of ["pl", "pp", "psd", "pt"].entries()) {
      expect(fundos[i], partido).toContain(`var(--party-${partido}-text)`);
    }
    expect(fundos.join(" ")).not.toContain("--color-cand-");
  });

  it("RF-219: o mesmo partido tem a MESMA cor na barra e no hemiciclo", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());

    const corNaBarra = (sigla: string) => {
      const seg = [...doc.querySelectorAll("[data-testid='vote-bar-segment']")].find((s) =>
        (s.getAttribute("style") ?? "").includes(`--party-${sigla.toLowerCase()}-text`),
      );
      return /background:\s*(var\([^)]+\))/.exec(seg?.getAttribute("style") ?? "")?.[1];
    };
    for (const sigla of ["PT", "PL", "PSD", "PP"]) {
      const g = doc.querySelector(
        `[data-testid='senado-hemiciclo'] svg g[data-partido='${sigla}'][data-estado='projetada']`,
      );
      expect(g, sigla).not.toBeNull();
      expect(corNaBarra(sigla), sigla).toBe(g?.getAttribute("stroke"));
    }
  });

  it("RF-217: composição que não fecha com os `top_candidatos` ⇒ sem hemiciclo, barra intacta", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = nacional();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).por_partido = [
      { partido: "PL", vagas: 2 },
      { partido: "PT", vagas: 2 },
    ];
    readProjectionMock.mockResolvedValue(p);
    const doc = await render(SenadoPage());

    expect(hemiciclo(doc)).toBeNull();
    expect(doc.querySelector("section[aria-labelledby='senado-2027-heading']")).toBeNull();
    expect(doc.querySelector("[data-testid='vote-bar']")).not.toBeNull();
    expect(aviso.mock.calls.some((c) => String(c[0]).startsWith("[senado-2027]"))).toBe(true);
    aviso.mockRestore();
  });

  it("fase pré: 27 que continuam + 54 cinzas, sem vocabulário de medição", async () => {
    readProjectionMock.mockResolvedValue(nacional({ fase: FASE_PRE_ELEICAO }));
    const doc = await render(SenadoPage());

    const h = hemiciclo(doc);
    expect(h?.getAttribute("data-fase")).toBe("pre");
    expect(h?.querySelectorAll("svg g[data-estado='continua_2031'] circle")).toHaveLength(27);
    expect(h?.querySelectorAll("svg g[data-estado='aguardando'] circle")).toHaveLength(54);
    expect((h?.innerHTML ?? "").toLowerCase()).not.toContain("projeç");
  });

  it("sem payload: o ramo de espera NÃO ganha o hemiciclo (design 023 § D6)", async () => {
    readProjectionMock.mockResolvedValue(null);
    const doc = await render(SenadoPage());

    expect(hemiciclo(doc)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// /senador — a chave "Parcial / Projeção" (decisão do dono, 04/10/2026)
// ---------------------------------------------------------------------------

describe("/senador — Parcial × Projeção (04/10)", () => {
  /**
   * SP com o apurado em ordem OUTRA que a da projeção: projeção Ana (PT) >
   * Bruno (PL) > Célia (MDB); apurado Bruno 35 > Célia 33 > Ana 25. RJ sem
   * `pct_atual` (não medido) ⇒ aguardando na Parcial.
   */
  function comApurado(): EdgePayload {
    const p = nacional();
    const sp = p.por_uf[0] as EdgeUfRow;
    const atual: Record<number, number> = { 1: 25, 2: 35, 3: 33 };
    sp.top_candidatos = sp.top_candidatos.map((t) => ({ ...t, pct_atual: atual[t.id] }));
    return p;
  }

  const itens = (el: Element | null | undefined) =>
    [...(el?.querySelectorAll("li") ?? [])].map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

  it("🔴 'As 54 vagas': Projeção = `composicao_vagas`; Parcial = os 2 mais votados até aqui", async () => {
    readProjectionMock.mockResolvedValue(comApurado());
    const doc = await render(SenadoPage());
    const proj = doc.querySelector("[data-view-only='proj'] [data-testid='composicao-partidos']");
    const parcial = doc.querySelector(
      "[data-view-only='parcial'] [data-testid='composicao-partidos-parcial']",
    );
    // A projeção é a de sempre — o payload, intocado. (RF-301: só as pílulas,
    // o texto VISÍVEL de cada uma; os nomes que abrem têm caso próprio.)
    expect(pilulas(proj)).toEqual(["1 PL", "1 PP", "1 PSD", "1 PT", "50 aguardando apuração"]);
    // A Parcial: SP pelo apurado (PL, MDB); RJ sem medida ⇒ aguardando.
    expect(pilulas(parcial)).toEqual(["1 MDB", "1 PL", "52 aguardando apuração"]);
    // O rótulo do precedente de /governador, só na Parcial.
    const titulo = doc.getElementById("composicao-parcial-heading");
    expect(titulo?.textContent).toBe("Se a apuração parasse agora");
    expect(titulo?.closest("[data-view-only]")?.getAttribute("data-view-only")).toBe("parcial");
    // Barra da Parcial: cor do PARTIDO (mesma regra da projeção), soma ≤ 54.
    const trilho = doc.querySelector("[data-view-only='parcial'] [data-testid='vote-bar-track']");
    expect(trilho?.getAttribute("aria-label")).toBe(
      "Vagas em disputa se a apuração parasse agora: MDB 1, PL 1; 52 aguardando apuração",
    );
    const segs = [
      ...(trilho?.querySelectorAll("[data-testid='vote-bar-segment']") ?? []),
    ] as HTMLElement[];
    expect(segs).toHaveLength(2);
    // Um `<h2>` só para o painel — a versão escondida não duplica o título.
    expect(doc.querySelectorAll("#composicao-heading")).toHaveLength(1);
  });

  it("🔴 nada apurado ⇒ a Parcial diz que não tem, sem número nenhum", async () => {
    readProjectionMock.mockResolvedValue(nacional());
    const doc = await render(SenadoPage());
    const bloco = doc.querySelector("[data-testid='composicao-parcial']");
    expect(bloco?.querySelector("[data-testid='composicao-parcial-vazia']")).not.toBeNull();
    expect(bloco?.querySelector("[data-testid='composicao-partidos-parcial']")).toBeNull();
    expect(bloco?.querySelector("[data-testid='vote-bar']")).toBeNull();
  });

  it("🔴 'As 81 cadeiras': o hemiciclo da Parcial pinta as 54 pelo apurado; o da Projeção, o de sempre", async () => {
    readProjectionMock.mockResolvedValue(comApurado());
    const doc = await render(SenadoPage());
    const proj = doc.querySelector("[data-view-only='proj'] [data-testid='senado-hemiciclo']");
    const parcial = doc.querySelector(
      "[data-view-only='parcial'] [data-testid='senado-hemiciclo']",
    );
    const n = (h: Element | null, estado: string) =>
      h?.querySelectorAll(`svg g[data-estado='${estado}'] circle`).length;
    expect([n(proj, "continua_2031"), n(proj, "projetada"), n(proj, "aguardando")]).toEqual([
      27, 4, 50,
    ]);
    expect([
      n(parcial, "continua_2031"),
      n(parcial, "projetada"),
      n(parcial, "aguardando"),
    ]).toEqual([27, 2, 52]);
    // As 2 da Parcial são PL e MDB (anel na cor do partido), nenhuma PT/PP/PSD.
    const partidos = [...(parcial?.querySelectorAll("svg g[data-estado='projetada']") ?? [])].map(
      (g) => g.getAttribute("data-partido"),
    );
    expect(partidos.sort()).toEqual(["MDB", "PL"]);
    // Texto da base certa, e nunca "eleito".
    expect(parcial?.textContent).toContain("se a apuração parasse agora");
    expect(parcial?.textContent).not.toContain("pela projeção");
    expect(parcial?.textContent?.toLowerCase()).not.toContain("eleit");
    // `id`s internos não colidem entre as duas figuras.
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Um título só para o painel.
    expect(doc.querySelectorAll("#senado-2027-heading")).toHaveLength(1);
  });

  it("🔴 cartões: Projeção com 'Vaga projetada' e % projetado; Parcial com o apurado e 'Vaga na parcial'", async () => {
    readProjectionMock.mockResolvedValue(comApurado());
    const doc = await render(SenadoPage());
    const cartao = doc.querySelector("[data-uf='SP'] article");
    const proj = itens(cartao?.querySelector("[data-view-only='proj']"));
    const parcial = itens(cartao?.querySelector("[data-view-only='parcial']"));
    expect(proj[0]).toMatch(/^1° ?Ana Lima ?PT.*Vaga projetada.*40%$/);
    expect(proj[1]).toMatch(/^2° ?Bruno Reis ?PL.*Vaga projetada.*30%$/);
    expect(parcial[0]).toMatch(/^1° ?Bruno Reis ?PL.*Vaga na parcial.*35%$/);
    expect(parcial[1]).toMatch(/^2° ?Célia Mota ?MDB.*Vaga na parcial.*33%$/);
    expect(parcial[2]).toMatch(/^3° ?Ana Lima ?PT.*25%$/);
    expect([...proj, ...parcial].join(" ")).not.toMatch(/eleito/i);
    // RJ sem `pct_atual`: ordem da projeção, "—", nenhum selo.
    const rj = itens(doc.querySelector("[data-uf='RJ'] article [data-view-only='parcial']"));
    expect(rj.every((l) => l.endsWith("—"))).toBe(true);
    expect(rj.join(" ")).not.toContain("Vaga");
    // O texto acima da lista segue a base.
    const textos = [...doc.querySelectorAll("p[data-view-only]")].map((p) => [
      p.getAttribute("data-view-only"),
      p.textContent ?? "",
    ]);
    expect(textos.find(([b]) => b === "proj")?.[1]).toContain('selo "vaga projetada"');
    expect(textos.find(([b]) => b === "proj")?.[1]).not.toContain("eleito pela projeção");
    expect(textos.find(([b]) => b === "parcial")?.[1]).toContain("Se a apuração parasse agora");
  });

  it("fase pré: nada é duplicado — o hemiciclo e a composição saem uma vez só", async () => {
    readProjectionMock.mockResolvedValue(nacional({ fase: FASE_PRE_ELEICAO }));
    const doc = await render(SenadoPage());
    expect(doc.querySelectorAll("[data-testid='senado-hemiciclo']")).toHaveLength(1);
    expect(doc.querySelector("[data-testid='composicao-parcial']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RF-301 (04/10/2026, dono) — cada partido de "As 54 vagas" abre com os nomes
// ---------------------------------------------------------------------------

describe("/senador — RF-301: quem ocupa as vagas de cada partido", () => {
  const PROJ = "[data-view-only='proj'] [data-testid='composicao-partidos']";
  const PARCIAL = "[data-view-only='parcial'] [data-testid='composicao-partidos-parcial']";

  /**
   * RJ passa a dar a 1ª vaga ao PL (Zeca Lima): o PL tem nomes em DUAS UFs.
   * Por UF: RJ Zeca, SP Bruno. Por nome: Bruno, Zeca. Na ordem de `por_uf`
   * (SP vem antes): SP, RJ. Só a ordem por UF dá RJ primeiro.
   */
  function plEmDuasUfs(): EdgePayload {
    const p = nacional();
    const rj = p.por_uf[1] as EdgeUfRow;
    rj.top_candidatos = [
      { id: 11, pct: 45, nome: "Zeca Lima", partido: "PL", sqcand: "250002553931" },
      { id: 12, pct: 28, nome: "Fábio Cruz", partido: "PP", sqcand: "250002553932" },
      { id: 13, pct: 20, nome: "Gil Souza", partido: "PDT", sqcand: "50002553933" },
    ];
    p.composicao_vagas = {
      ...(p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>),
      por_partido: [
        { partido: "PL", vagas: 2 },
        { partido: "PP", vagas: 1 },
        { partido: "PT", vagas: 1 },
      ],
    };
    return p;
  }

  /** SP com apurado em ordem OUTRA que a projeção; RJ sem `pct_atual`. */
  function comApurado(): EdgePayload {
    const p = nacional();
    const sp = p.por_uf[0] as EdgeUfRow;
    const atual: Record<number, number> = { 1: 25, 2: 35, 3: 33 };
    sp.top_candidatos = sp.top_candidatos.map((t) => ({ ...t, pct_atual: atual[t.id] }));
    return p;
  }

  const textoSemSr = (el: Element | null | undefined) => {
    const c = el?.cloneNode(true) as Element | undefined;
    for (const s of [...(c?.querySelectorAll(".sr-only") ?? [])]) s.remove();
    return (c?.textContent ?? "").replace(/\s+/g, " ").trim();
  };

  it("🔴 Projeção: cada partido abre com os nomes certos, por SIGLA DE UF; Σ = 54 − aguardando", async () => {
    readProjectionMock.mockResolvedValue(plEmDuasUfs());
    const doc = await render(SenadoPage());
    const ul = doc.querySelector(PROJ);

    expect(pilulas(ul)).toEqual(["2 PL", "1 PP", "1 PT", "50 aguardando apuração"]);
    // (c) — por UF (RJ antes de SP), não por nome nem na ordem de `por_uf`.
    expect(nomesDaPilula(pilula(ul, "2 PL"))).toEqual(["RJ · Zeca Lima", "SP · Bruno Reis"]);
    expect(nomesDaPilula(pilula(ul, "1 PP"))).toEqual(["RJ · Fábio Cruz"]);
    expect(nomesDaPilula(pilula(ul, "1 PT"))).toEqual(["SP · Ana Lima"]);

    // Cada pílula abre com EXATAMENTE tantos nomes quantos conta; Σ = 54 − 50.
    let soma = 0;
    for (const rotulo of ["2 PL", "1 PP", "1 PT"]) {
      const n = nomesDaPilula(pilula(ul, rotulo));
      expect(n).toHaveLength(Number(rotulo.split(" ")[0]));
      soma += n?.length ?? 0;
    }
    expect(soma).toBe(54 - 50);

    // O selo da base, uma vez por partido — nunca "eleito".
    const selos = [...(ul?.querySelectorAll("details > p") ?? [])].map((p) => p.textContent);
    expect(selos.slice(0, 3)).toEqual(Array(3).fill("Vaga projetada · não oficial"));
    expect((ul?.textContent ?? "").toLowerCase()).not.toContain("eleit");

    // "aguardando apuração" abre com as 25 UFs que faltam (nem RJ nem SP).
    const ag = doc.querySelector(`${PROJ} [data-testid='composicao-aguardando']`);
    const ufs = (ag?.querySelector("details > p")?.textContent ?? "").split(", ");
    expect(ufs).toHaveLength(25);
    expect(ufs).not.toContain("RJ");
    expect(ufs).not.toContain("SP");
    expect(ufs[0]).toBe("AC");

    // A nota convida a abrir — só porque há o que abrir.
    expect(doc.querySelector("[data-testid='composicao-nota']")?.textContent).toContain(
      "Abra um partido para ver os nomes.",
    );
  });

  it("🔴 Parcial: nome pelo `id`; UF aguardando fora dos nomes e listada; nunca zero", async () => {
    readProjectionMock.mockResolvedValue(comApurado());
    const doc = await render(SenadoPage());
    const ul = doc.querySelector(PARCIAL);

    expect(pilulas(ul)).toEqual(["1 MDB", "1 PL", "52 aguardando apuração"]);
    // (a) — SP pelo apurado: Bruno (PL) e Célia (MDB); Ana (PT, 1ª na
    // projeção) fora. Com a lista da projeção, o MDB não abriria.
    expect(nomesDaPilula(pilula(ul, "1 MDB"))).toEqual(["SP · Célia Mota"]);
    expect(nomesDaPilula(pilula(ul, "1 PL"))).toEqual(["SP · Bruno Reis"]);
    // (b) — RJ não tem `pct_atual`: nenhum nome de lá, nem "Cand N".
    const nomes = [...(ul?.querySelectorAll("details > ol > li") ?? [])].map((l) => l.textContent);
    expect(nomes).toEqual(["SP · Célia Mota", "SP · Bruno Reis"]);
    for (const quem of ["Ana Lima", "Eva Prado", "Fábio Cruz", "Gil Souza", "Cand"]) {
      expect(ul?.textContent).not.toContain(quem);
    }
    // RJ está na linha "aguardando" — 26 UFs × 2 = 52, sem zero inventado.
    const ag = doc.querySelector(`${PARCIAL} [data-testid='composicao-aguardando-parcial']`);
    const ufs = (ag?.querySelector("details > p")?.textContent ?? "").split(", ");
    expect(ufs).toContain("RJ");
    expect(ufs).not.toContain("SP");
    expect(ufs).toHaveLength(26);
    expect(ul?.textContent).not.toMatch(/(^|\D)0 /);

    const selos = [...(ul?.querySelectorAll("details > p") ?? [])].map((p) => p.textContent);
    expect(selos.slice(0, 2)).toEqual(Array(2).fill("Vaga na parcial · não oficial"));
  });

  it("sem `nome` no payload ⇒ o mesmo `Cand <id>` do cartão, nas duas bases", async () => {
    const p = comApurado();
    for (const row of p.por_uf) {
      row.top_candidatos = row.top_candidatos.map(({ nome: _n, ...t }) => t);
    }
    readProjectionMock.mockResolvedValue(p);
    const doc = await render(SenadoPage());

    expect(nomesDaPilula(pilula(doc.querySelector(PROJ), "1 PT"))).toEqual(["SP · Cand 1"]);
    expect(nomesDaPilula(pilula(doc.querySelector(PARCIAL), "1 PL"))).toEqual(["SP · Cand 2"]);
    // O cartão de SP escreve exatamente o mesmo nome.
    const cartao = doc.querySelector("[data-uf='SP'] article [data-view-only='proj'] li");
    expect(cartao?.textContent).toContain("Cand 1");
  });

  it("🔴 payload sem `partido` (sen-current.json) ⇒ as pílulas não abrem, e a nota não convida", async () => {
    readProjectionMock.mockResolvedValue(senCurrent as unknown as EdgePayload);
    const doc = await render(SenadoPage());
    const ul = doc.querySelector(PROJ);

    // A contagem publicada continua — só sem nomes (falha fechada, RF-217).
    expect(pilulas(ul)[0]).toBe("7 PL");
    expect(ul?.querySelector("details")).toBeNull();
    expect(doc.querySelector("[data-testid='composicao-nota']")?.textContent).not.toContain(
      "Abra um partido",
    );
    // Sem `pct_atual` em lugar nenhum: a Parcial diz que não tem.
    expect(doc.querySelector("[data-testid='composicao-parcial-vazia']")).not.toBeNull();
    expect(doc.querySelector(PARCIAL)).toBeNull();
  });

  it("🔴 simulação (nomes reais, 27 UFs): toda pílula abre, Σ fecha, ordem por UF, nome = o do cartão", async () => {
    readProjectionMock.mockResolvedValue(simulacao as unknown as EdgePayload);
    const doc = await render(SenadoPage());

    for (const [sel, testAg] of [
      [PROJ, "composicao-aguardando"],
      [PARCIAL, "composicao-aguardando-parcial"],
    ] as const) {
      const ul = doc.querySelector(sel);
      const lis = [...(ul?.children ?? [])].filter((li) => !li.hasAttribute("data-ag"));
      expect(lis.length).toBeGreaterThan(0);
      let soma = 0;
      for (const li of lis) {
        const n = nomesDaPilula(li) as string[];
        expect(n).not.toBeNull();
        expect(n).toHaveLength(Number(pilulas(ul)[lis.indexOf(li)]?.split(" ")[0]));
        const ufs = n.map((x) => x.slice(0, 2));
        expect(ufs).toEqual([...ufs].sort());
        // Cada nome está no cartão daquela UF.
        for (const linha of n) {
          const [uf, nome] = linha.split(" · ") as [string, string];
          expect(doc.querySelector(`[data-uf='${uf}'] article`)?.textContent).toContain(nome);
        }
        soma += n.length;
      }
      const ag = doc.querySelector(`[data-testid='${testAg}']`);
      const aguardando = ag ? Number(textoSemSr(ag.querySelector("b"))) : 0;
      expect(soma + aguardando).toBe(54);
    }
  });

  it("acessibilidade: `<summary>` começa pelo texto visível e diz o que abre; sigla inteira dita", async () => {
    readProjectionMock.mockResolvedValue(simulacao as unknown as EdgePayload);
    const doc = await render(SenadoPage());
    const ul = doc.querySelector(PROJ);
    const summaries = [...(ul?.querySelectorAll("summary") ?? [])];
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      const todo = (s.textContent ?? "").replace(/\s+/g, " ").trim();
      // WCAG 2.5.3: o nome acessível COMEÇA pelo rótulo visível.
      expect(todo.startsWith(textoSemSr(s))).toBe(true);
      expect(todo).toMatch(/, ver (o nome|os nomes)$/);
    }
    // REPUBLICANOS: desenhado "REP", dito inteiro.
    const rep = summaries.find((s) => textoSemSr(s).endsWith(" REP"));
    expect(rep?.textContent).toContain("REPUBLICANOS");
    // Lista de verdade, e nenhum título novo: o `<h2>` do painel segue único.
    expect(ul?.querySelectorAll("details > ol").length).toBe(summaries.length);
    expect(ul?.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(doc.querySelectorAll("#composicao-heading")).toHaveLength(1);
  });

  it("fase pré: o bloco não tem o que abrir (não há quem nomear)", async () => {
    readProjectionMock.mockResolvedValue(nacional({ fase: FASE_PRE_ELEICAO }));
    const doc = await render(SenadoPage());
    const painel = doc.getElementById("composicao-heading")?.closest("section");
    expect(painel).not.toBeNull();
    expect(painel?.querySelector("details")).toBeNull();
    expect(painel?.textContent).not.toMatch(/ver os? nomes?|Abra um partido/);
  });
});

// ---------------------------------------------------------------------------
// T-10 — /uf/[sigla]/senador
// ---------------------------------------------------------------------------

const PARAMS_SP = { params: Promise.resolve({ sigla: "SP" }) };

/**
 * Spec 020, Fase 2 — série por candidatura do Senado de SP.
 *
 * Quatro linhas (D4 do dono). A ordem é a do produtor e não é reproduzível por
 * nenhum critério: por `apurado` final seria 10, 20, 30, 40; por `id`, a mesma
 * coisa. A emitida é 30, 10, 20, 40 — e são as DUAS PRIMEIRAS DELA que ocupam
 * vaga, não as de maior percentual. É essa diferença que faz o teste
 * discriminar um `sort` no consumidor.
 *
 * A candidatura 10 carrega um furo no meio (`null`), e `cadencia_min` (15) é
 * incoerente com o espaçamento real do eixo (5 min), de propósito.
 */
const SERIE_SEN: EdgeSeriePorCandidato = {
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
    { id: 40, nome: "Quarta Colocada", partido: "MDB", apurado: [8, 9, 9], projetado: [9, 9, 9] },
  ],
};

/** Objeto de Blob desta corrida, com ou sem a série. */
function blobSenadorCom(serie: EdgeSeriePorCandidato | null): UfDetailResult {
  return {
    status: "ok",
    url: "https://exemplo.test/municipios/uf/SP/sen/t1.json",
    detail: {
      ts: "2026-10-04T20:10:00-03:00",
      uf: "SP",
      cargo: "sen",
      turno: 1,
      municipios: [],
      series_temporais: serie
        ? { margem: [], p_vitoria: [], turnout: [], por_candidato: serie }
        : null,
    },
  };
}

describe("/uf/[sigla]/senador (T-10)", () => {
  it("(l) lê a chave da UF com cargo e turno explícitos (ADR-0028)", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    await render(UFSenadorPage(PARAMS_SP));

    expect(readUfProjectionMock).toHaveBeenCalledWith("SP", { cargo: "sen", turno: 1 });
  });

  it("(m) RF-105: exatamente 2 linhas carregam o marcador de vaga", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(linhasComVaga(doc)).toBe(2);
    expect(doc.querySelectorAll("[data-testid='candidate-result-row']").length).toBe(4);
  });

  it("(n) RF-104: a margem exibida é 1 pp (2º→3º), não 10 pp (1º→2º)", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const margem = doc.querySelector("[data-testid='result-margem-parcial']")?.textContent ?? "";

    expect(margem).toContain("1,0");
    expect(margem).not.toContain("10,0");
    expect(margem).toMatch(/margem para a 2ª vaga/i);
  });

  it("(o) RF-106: a nota do painel diz 2 vagas por estado, e a tela nunca diz '1 vaga'", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.body.textContent).toContain("2 vagas por estado");
    expect(doc.body.textContent).not.toMatch(/\b1 vaga\b/);
  });

  it("(p) RF-103: os medidores de p_eleito aparecem quando há incerteza medida", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    // Os `vagas + 1` primeiros: quem entra e quem está na porta. O seletor é
    // escopado ao painel de chances — o `<ForecastTransparency>` da mesma
    // página também usa `role="meter"` nas duas barras dele.
    expect(doc.querySelectorAll("[data-testid='chances-panel-meters'] [role='meter']").length).toBe(
      3,
    );
    expect(doc.body.textContent).toContain("Célia Mota se elege em SP");
  });

  it("(q) IC de largura zero: nada de 'chance' — o bloco explica por quê", async () => {
    // Até 2026-09-11 este era o caso PERMANENTE do cargo (um boletim por
    // estado). Com a ingestão por zona (emenda (b) do ADR-0026) virou
    // TRANSITÓRIO: vale enquanto só uma zona do estado estiver apurada — que é
    // justamente o começo da noite, quando o leitor mais olha. Publicar "100%"
    // ali afirmaria uma certeza que o modelo não tem.
    const degenerado = ufPayload({
      candidatos: [
        ufCand(1, "Ana Lima", "PT", 40, { p_eleito: 1, ci95: { lower: 40, upper: 40 } }),
        ufCand(2, "Bruno Reis", "PL", 30, { p_eleito: 1, ci95: { lower: 30, upper: 30 } }),
        ufCand(3, "Célia Mota", "MDB", 29, { p_eleito: 0, ci95: { lower: 29, upper: 29 } }),
      ],
    });
    readUfProjectionMock.mockResolvedValue(degenerado);
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.querySelectorAll("[data-testid='chances-panel-meters']").length).toBe(0);
    // O bloco NÃO some (ADR-0017) — ele diz o que o modelo sabe e o que não.
    const explicacao = doc.querySelector("[data-testid='chances-sem-incerteza']")?.textContent;
    expect(explicacao).toMatch(/uma única zona eleitoral apurada/i);
    // A explicação tem de dizer que é transitório. Afirmar que "o TSE publica um
    // boletim por estado para este cargo" deixou de ser verdade em 11/09.
    expect(explicacao).not.toMatch(/um único boletim por estado/i);
    expect(doc.body.textContent).not.toContain("100%");
  });

  it("(r) RF-108: cadência de 5 min no bloco de metodologia", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const nota = doc.querySelector("[data-testid='forecast-cadencia']")?.textContent ?? "";

    expect(nota).toMatch(/nível do estado/i);
    expect(nota).toContain("a cada 5 minutos");
  });

  it("(s) a tela não promete o que este cargo não tem: município e 2º turno", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const texto = doc.body.textContent ?? "";

    expect(texto).not.toMatch(/maiores colégios/i);
    expect(texto).not.toMatch(/2º turno|segundo turno/i);
  });

  it("(t) trilha `sen`, um <h1> e o rodapé dentro do <main>", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("sen");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("main footer")).not.toBeNull();
    // 2026-10-03 — a bandeira da UF no `<h1>`: uma só, decorativa, sem `lazy`.
    const bandeiras = doc.querySelectorAll("h1 img");
    expect(bandeiras).toHaveLength(1);
    expect(bandeiras[0]?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    expect(bandeiras[0]?.getAttribute("alt")).toBe("");
    expect(bandeiras[0]?.hasAttribute("loading")).toBe(false);
  });

  it("(u) payload sem `vagas` (gravado antes da spec 016) cai na tabela canônica", async () => {
    const semVagas = ufPayload();
    delete (semVagas as Partial<EdgePayloadUf>).vagas;
    readUfProjectionMock.mockResolvedValue(semVagas);
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(linhasComVaga(doc)).toBe(2);
  });

  it("(v) sem payload, o estado de espera já diz quantas vagas estão em jogo", async () => {
    readUfProjectionMock.mockResolvedValue(null);
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.body.textContent).toContain("Aguardando dados");
    expect(doc.body.textContent).toContain("2 vagas por estado");
  });

  /**
   * Spec 020 / RF-174 + RF-173 — o SLOT do bloco (T-10), não a presença dele.
   *
   * "Está no DOM" passaria com o bloco em qualquer posição, inclusive acima do
   * painel de resultado — o único lugar proibido, porque lá vive o `<h1>`.
   */
  it("(x) a evolução da apuração fica entre as chances e a metodologia", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    const kickers = paineis.map(
      (p) => p.querySelector('[data-testid="panel-kicker"]')?.textContent ?? "",
    );
    // 🔴 O slot é localizado pelo KICKER, não pelo `testid` do gráfico: desde a
    // Fase 2 o painel pode conter o gráfico OU o estado "indisponível", e o que
    // este teste mede é a POSIÇÃO do painel.
    const iSerie = kickers.indexOf("Evolução da apuração");

    expect(paineis[0]?.getAttribute("aria-labelledby")).toBe("resultado-heading");
    expect(kickers[iSerie - 1]).toBe("Modelo Atlas Menna");
    // 2026-09-20: o painel de municípios entrou ENTRE a série e a metodologia,
    // que é a ordem das outras duas rotas de estado (resultado → série →
    // municípios → metodologia). A série não se moveu.
    expect(kickers[iSerie + 1]).toBe("Municípios");
    expect(kickers[iSerie + 2]).toBe("Metodologia");
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
    expect(iCorrida).toBe(1);
    expect(iVotacao).toBe(2);
    expect(iSerie).toBe(4);

    // Sem série no Blob deste caso: nenhum traçado.
    expect(doc.querySelectorAll("[data-traco]")).toHaveLength(0);

    // 🔴 A contagem de `<h1>` não muda.
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  /**
   * Spec 020, Fase 2 — a série do Blob chega à tela desta rota, e com ela o
   * RF-173 (duas vagas) finalmente pode renderizar COM DADO.
   *
   * A fixture é incoerente de propósito: o eixo é espaçado de 5 minutos e
   * `cadencia_min` declara 15, de modo que inferir a cadência de
   * `eixo[1] - eixo[0]` dê um número diferente. E a ordem emitida (30, 10, 20)
   * não é reproduzível por `apurado`, `projetado` nem `id`: qualquer `sort` no
   * consumidor muda a tela — e, aqui, mudaria QUEM a tela diz que ocupa vaga.
   */
  it("(x2) RF-173: com série, as duas primeiras posições são as que elegem", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    readUfDetailMock.mockResolvedValueOnce(blobSenadorCom(SERIE_SEN));
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const figura = doc.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(figura).not.toBeNull();

    // (a) ordem de exibição = ordem emitida (RF-170c).
    const ordem = [...(figura?.querySelectorAll('g[data-cand][data-base="parcial"]') ?? [])]
      .map((g) => g.getAttribute("data-cand") ?? "")
      .filter((id, i, todos) => todos.indexOf(id) === i);
    expect(ordem).toEqual(["30", "10", "20", "40"]);

    // (b) RF-173: o destaque é ESPESSURA, e ele segue a ordem recebida — as
    // duas PRIMEIRAS do array, não as de maior percentual.
    const espessura = (id: number) =>
      figura
        ?.querySelector(`path[data-traco][data-cand="${id}"][data-base="parcial"]`)
        ?.getAttribute("stroke-width");
    expect(espessura(30)).toBe("2.5");
    expect(espessura(10)).toBe("2.5");
    expect(espessura(20)).toBe("1.5");
    expect(espessura(40)).toBe("1.5");

    // (c) RF-173(b): NUNCA opacidade — ela derrubou 16 nós para 2,27:1 no axe
    // em 2026-09-08, e está registrada em `app/globals.css`.
    expect(figura?.innerHTML ?? "").not.toContain("opacity");

    // (d) a régua de corte da 2ª vaga existe, numa base e na outra.
    expect(figura?.querySelectorAll('[data-testid="serie-regua-vaga"]')).toHaveLength(2);

    // (e) RF-173(d): a informação existe em TEXTO para quem não vê o gráfico,
    // e nomeia as MESMAS duas.
    const legenda = figura?.querySelector("caption")?.textContent ?? "";
    expect(legenda).toContain("Esta corrida elege 2 vagas");
    expect(legenda).toContain("Terceira Via e Primeira Colocada");

    // (f) cadência DECLARADA (15), não a inferida do eixo (5).
    expect(legenda).toContain("a cada 15 minutos");

    // (g) o furo chega como furo, nunca como zero (RF-175b).
    const celulas = [
      ...(figura?.querySelectorAll('td[data-cand="10"][data-base="parcial"]') ?? []),
    ].map((td) => td.textContent ?? "");
    expect(celulas).toEqual(["30,0%", "sem medição", "32,0%"]);

    // (h) a cor por rank que o ADR-0024 aposentou não entra no bloco.
    expect(figura?.innerHTML ?? "").not.toContain("--color-cand-");

    // (i) o `<h1>` continua único.
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  /**
   * RF-175 — o par que discrimina, também nesta rota. "A rede caiu" e "o
   * produtor não publicou" têm correções opostas.
   *
   * E, sobretudo: um Blob ausente **não derruba a página**. Esta rota viveu
   * sem Blob até a Fase 2, e passar a lê-lo não pode ter tornado o resumo
   * refém dele.
   */
  it("(x3) sem série, o bloco fica no DOM com o motivo certo — e a página inteira de pé", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    // Escopado ao painel da série: desde a spec 021 RF-192 emendado
    // (2026-09-26, noite) o painel "Votação" da UF vem ANTES dela, e sem
    // `votacao` no payload ele tem o próprio `<DetailUnavailable>`
    // ("not_found", do PAYLOAD) — o primeiro do documento deixou de ser o da
    // série.
    const estadoDaSerie = (doc: Document) =>
      [...doc.querySelectorAll('[data-testid="panel"]')]
        .find(
          (p) =>
            p.querySelector('[data-testid="panel-kicker"]')?.textContent === "Evolução da apuração",
        )
        ?.querySelector('[data-testid="detail-unavailable"]');

    readUfDetailMock.mockResolvedValueOnce(blobSenadorCom(null));
    const semSerie = await render(UFSenadorPage(PARAMS_SP));
    expect(estadoDaSerie(semSerie)?.getAttribute("data-reason")).toBe("sem_serie");

    readUfDetailMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "fetch_error",
      url: null,
    });
    const semBlob = await render(UFSenadorPage(PARAMS_SP));
    expect(estadoDaSerie(semBlob)?.getAttribute("data-reason")).toBe("fetch_error");

    // O resumo vem da OUTRA fonte e segue inteiro nos dois casos.
    for (const doc of [semSerie, semBlob]) {
      expect(linhasComVaga(doc)).toBe(2);
      expect(doc.querySelectorAll("h1").length).toBe(1);
      const kickers = [...doc.querySelectorAll('[data-testid="panel-kicker"]')].map(
        (k) => k.textContent ?? "",
      );
      expect(kickers).toContain("Evolução da apuração");
      expect(kickers).toContain("Metodologia");
    }
  });

  /**
   * Spec 020, Fase 2 — os dois read paths desta rota disparam EM PARALELO.
   *
   * ## Por que este teste precisa existir
   *
   * Trocar o `Promise.all` por dois `await` sequenciais **não muda nenhum
   * resultado**: a mesma tela, o mesmo HTML, os mesmos números. O que muda é o
   * tempo de parede — a soma das duas idas à rede em vez do máximo — e é
   * invisível para qualquer asserção sobre o DOM. Sem este teste, a única
   * defesa contra o refactor inocente que serializa a rota seria o comentário.
   *
   * ## Como ele discrimina, sem medir tempo
   *
   * Cronômetro em teste é instável. O que se mede aqui é uma ORDEM causal: o
   * resumo só resolve num macrotask posterior, e no instante em que resolve
   * pergunta-se se a leitura do Blob **já foi chamada**.
   *
   *   - Com `Promise.all`, as duas chamadas partem antes de qualquer `await`:
   *     no momento em que o resumo resolve, o Blob já foi chamado → `true`.
   *   - Com `await` sequencial, o Blob só é chamado DEPOIS de o resumo
   *     resolver → `false`.
   *
   * A ordem do array de chamadas, sozinha, NÃO discrimina: nas duas formas ela
   * é ["resumo", "detalhe"]. É o instante que separa as duas.
   */
  it("(x5) os dois read paths partem juntos — nunca um depois do outro", async () => {
    const chamadas: string[] = [];
    let blobJaChamadoQuandoOResumoResolveu = false;

    readUfProjectionMock.mockImplementationOnce(async () => {
      chamadas.push("resumo");
      // Cede o controle: só volta num macrotask posterior.
      await new Promise((resolve) => setTimeout(resolve, 0));
      blobJaChamadoQuandoOResumoResolveu = chamadas.includes("detalhe");
      return ufPayload();
    });
    readUfDetailMock.mockImplementationOnce(async () => {
      chamadas.push("detalhe");
      return blobSenadorCom(SERIE_SEN);
    });

    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(chamadas).toEqual(["resumo", "detalhe"]);
    expect(blobJaChamadoQuandoOResumoResolveu).toBe(true);
    // E o resultado é o mesmo das outras renderizações — a paralelização não
    // pode ter custado nada em correção.
    expect(doc.querySelector('[data-testid="serie-apuracao-chart"]')).not.toBeNull();
  });

  /**
   * O ramo de ESPERA é um call site próprio, e o quarto defeito do handoff de
   * 2026-09-17 nasceu de um bloco que entrou num ramo e não no outro.
   *
   * Sem payload de UF e COM série no Blob é combinação real: desde o ADR-0032
   * os dois read paths falham de forma independente, e o Blob pode responder
   * enquanto a chave de Global Config ainda não existe.
   */
  it("(x4) o ramo de ESPERA também recebe a série, e na ordem emitida", async () => {
    readUfProjectionMock.mockResolvedValueOnce(null);
    readProjectionMock.mockResolvedValueOnce(null);
    readUfDetailMock.mockResolvedValueOnce(blobSenadorCom(SERIE_SEN));
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const figura = doc.querySelector('[data-testid="serie-apuracao-chart"]');
    const ordem = [...(figura?.querySelectorAll('g[data-cand][data-base="parcial"]') ?? [])]
      .map((g) => g.getAttribute("data-cand") ?? "")
      .filter((id, i, todos) => todos.indexOf(id) === i);
    expect(ordem).toEqual(["30", "10", "20", "40"]);

    // RF-173 vale também aqui: a corrida elege 2 com ou sem payload de resumo.
    expect(
      figura
        ?.querySelector('path[data-traco][data-cand="30"][data-base="parcial"]')
        ?.getAttribute("stroke-width"),
    ).toBe("2.5");
    expect(figura?.querySelector("caption")?.textContent ?? "").toContain("a cada 15 minutos");
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });

  /**
   * Spec 020 / RF-174(d) — no ramo de espera a fase vem do payload NACIONAL
   * do Senado. Os dois casos são o par que discrimina: `preEleicao` fixo em
   * `false` derruba o primeiro, fixo em `true` derruba o segundo.
   */
  it("(y) sem payload de UF, o estado do bloco vem da fase do NACIONAL", async () => {
    readUfProjectionMock.mockResolvedValueOnce(null);
    readProjectionMock.mockResolvedValueOnce({ fase: FASE_PRE_ELEICAO });
    const pre = await render(UFSenadorPage(PARAMS_SP));
    const blocoPre = pre.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(blocoPre?.getAttribute("data-estado")).toBe("antes-do-dia");
    expect(pre.body.textContent).toContain("disponível apenas no dia das eleições");
    expect(blocoPre?.textContent?.toLowerCase()).not.toContain("projeção");
    expect(pre.querySelectorAll("h1").length).toBe(1);
    // A fase é perguntada ao nacional DESTA corrida, com cargo e turno
    // explícitos (ADR-0028) — nunca ao presidencial nem a uma data.
    expect(readProjectionMock).toHaveBeenCalledWith({ cargo: "sen", turno: 1 });

    readUfProjectionMock.mockResolvedValueOnce(null);
    readProjectionMock.mockResolvedValueOnce(null);
    const semNada = await render(UFSenadorPage(PARAMS_SP));
    // Sem fase pré, o bloco passa a dizer POR QUE a série não veio — com o
    // motivo da leitura do Blob, nunca um texto genérico (RF-175).
    expect(
      semNada.querySelector('[data-testid="detail-unavailable"]')?.getAttribute("data-reason"),
    ).toBe("not_configured");
    expect(semNada.querySelector('[data-testid="serie-apuracao-chart"]')).toBeNull();
    expect(semNada.querySelectorAll("h1").length).toBe(1);
  });

  it("(w) a ordem exibida acompanha a base ativa — nas duas bases", async () => {
    // 🔴 Reescrito em 2026-09-20. Até aqui este teste afirmava que a ordem
    // exibida era SEMPRE a do apurado — que é metade da verdade nova: o
    // apurado manda quando o leitor está em "Parcial", e a projeção quando
    // está em "Projeção" (decisão do dono, "tudo acompanha a base ativa").
    //
    // A fixture inverte as duas ordens de ponta a ponta:
    //   por `pct_atual`     → Célia (60) · Bruno (20) · Ana (10)
    //   por `pct_projetado` → Ana (40)   · Bruno (30) · Célia (29)
    //
    // A ordem do DOM é a da PROJEÇÃO; a da parcial vem de `order`, que o
    // happy-dom não resolve (ele não faz layout). Por isso o que se afirma
    // aqui é o CONTRATO que a cascata lê: `--ord-parcial` / `--ord-proj` por
    // linha, mais os dois números e o marcador de vaga de cada base.
    const invertido = ufPayload({
      candidatos: [
        ufCand(1, "Ana Lima", "PT", 40, { pct_atual: 10, p_eleito: 0.5 }),
        ufCand(2, "Bruno Reis", "PL", 30, { pct_atual: 20, p_eleito: 0.5 }),
        ufCand(3, "Célia Mota", "MDB", 29, { pct_atual: 60, p_eleito: 1 }),
      ],
    });
    readUfProjectionMock.mockResolvedValue(invertido);
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const linhas = [...doc.querySelectorAll("ol > li")];

    // DOM = projeção, e o atributo declara isso.
    expect(linhas[0]?.textContent).toContain("Ana Lima");
    expect(linhas[2]?.textContent).toContain("Célia Mota");
    expect(linhas[0]?.getAttribute("data-ord")).toBe("proj");

    const ord = (li: Element | undefined) => li?.getAttribute("style") ?? "";
    // Ana: 1ª na projeção, 3ª na parcial. Célia: o inverso.
    expect(ord(linhas[0])).toContain("--ord-proj:0");
    expect(ord(linhas[0])).toContain("--ord-parcial:2");
    expect(ord(linhas[2])).toContain("--ord-proj:2");
    expect(ord(linhas[2])).toContain("--ord-parcial:0");

    // 🔴 A ocupação de vaga acompanha a base — e é isto que faz a tela dizer
    // coisas diferentes sobre quem se elege em cada visualização. Com 2 vagas,
    // na projeção entram Ana e Bruno; na parcial, Célia e Bruno. Bruno é o
    // único que entra nas duas.
    expect(linhas[0]?.getAttribute("data-vaga")).toBe("proj");
    expect(linhas[1]?.getAttribute("data-vaga")).toBe("true");
    expect(linhas[2]?.getAttribute("data-vaga")).toBe("parcial");

    // E o RÓTULO concorda com a base que está na tela: quem só ocupa na
    // parcial não pode ser anunciado como "projetada".
    const marcadorCelia = linhas[2]?.querySelector("[data-testid='result-vaga-marker']");
    expect(marcadorCelia?.textContent?.toLowerCase()).toContain("parcial");
    expect(marcadorCelia?.textContent?.toLowerCase()).not.toContain("projetada");
  });

  // -------------------------------------------------------------------------
  // RF-103 + decisão do dono de 2026-09-20 — o ELENCO do painel de chances
  // acompanha a base ativa, como a lista logo acima já fazia.
  //
  // O defeito que estes casos fecham: o painel recortava `vagas + 1` SEMPRE
  // pela ordem do apurado, então na visualização "Projeção" a lista podia
  // marcar A e B como ocupantes de vaga enquanto os medidores logo abaixo
  // falavam de B e C.
  //
  // A fixture põe UMA candidatura em cada base e nenhuma nas duas, que é o
  // único formato que discrimina: com os mesmos três nomes nas duas listas
  // (só que em ordem diferente), um painel que ignorasse a base continuaria
  // dizendo a coisa certa por acidente.
  //
  //   por `pct_atual`     → Célia (60) · Bruno (20) · Ana (10) · Davi (1)
  //   por `pct_projetado` → Ana (40)   · Bruno (30) · Davi (29) · Célia (5)
  //
  // Recorte de 3 (`vagas + 1`): parcial = Célia/Bruno/Ana, projeção =
  // Ana/Bruno/Davi. Célia só entra numa; Davi só na outra.
  // -------------------------------------------------------------------------
  const elencosDivergentes = (over: Partial<EdgeUfCandidate>[] = []) =>
    ufPayload({
      candidatos: [
        ufCand(1, "Ana Lima", "PT", 40, { pct_atual: 10, p_eleito: 0.5, ...over[0] }),
        ufCand(2, "Bruno Reis", "PL", 30, { pct_atual: 20, p_eleito: 0.5, ...over[1] }),
        ufCand(3, "Célia Mota", "MDB", 5, { pct_atual: 60, p_eleito: 0.9, ...over[2] }),
        ufCand(4, "Davi Nunes", "PSOL", 29, { pct_atual: 1, p_eleito: 0.13, ...over[3] }),
      ],
    });

  /** Os medidores de UMA base dentro do painel de chances. */
  function chancesDaBase(doc: Document, base: "parcial" | "proj"): Element | null {
    return doc.querySelector(`[data-testid='chances-panel-meters'] [data-view-only='${base}']`);
  }

  it("(w2) o elenco do painel de chances acompanha a base — quem tem selo é quem tem medidor", async () => {
    readUfProjectionMock.mockResolvedValue(elencosDivergentes());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const parcial = chancesDaBase(doc, "parcial");
    const proj = chancesDaBase(doc, "proj");
    expect(parcial, "grupo da base parcial").not.toBeNull();
    expect(proj, "grupo da base projeção").not.toBeNull();

    // Parcial: o recorte do APURADO. Célia lidera a contagem e está aqui;
    // Davi, que só existe na projeção, não pode estar.
    expect(parcial?.querySelectorAll("[role='meter']").length).toBe(3);
    expect(parcial?.textContent).toContain("Célia Mota se elege em SP");
    expect(parcial?.textContent).not.toContain("Davi Nunes");

    // Projeção: o recorte do PROJETADO. Simétrico, e é esta metade que o
    // defeito de hoje errava.
    expect(proj?.querySelectorAll("[role='meter']").length).toBe(3);
    expect(proj?.textContent).toContain("Davi Nunes se elege em SP");
    expect(proj?.textContent).not.toContain("Célia Mota");

    // 🔴 E o painel concorda com a LISTA de cima na mesma base: quem tem selo
    // de vaga na projeção é quem tem medidor na projeção. Sem este par de
    // asserts, os dois blocos poderiam voltar a divergir sem quebrar nada —
    // que é exatamente o defeito de origem.
    const comVagaNaProj = [...doc.querySelectorAll("ol > li")]
      .filter((li) => ["true", "proj"].includes(li.getAttribute("data-vaga") ?? ""))
      .map((li) => li.textContent ?? "");
    expect(comVagaNaProj.some((t) => t.includes("Ana Lima"))).toBe(true);
    expect(comVagaNaProj.some((t) => t.includes("Bruno Reis"))).toBe(true);
    for (const nome of ["Ana Lima", "Bruno Reis"]) {
      expect(proj?.textContent, `${nome} tem selo na projeção e precisa de medidor`).toContain(
        nome,
      );
    }
  });

  it("(w3) bases que escolhem o MESMO elenco não duplicam nada no DOM", async () => {
    // A fixture padrão tem `pct_atual === pct_projetado` em todo mundo, então
    // as duas ordenações coincidem — o caso comum de uma noite eleitoral.
    // Contraprova de (w2): o custo em nós só existe quando há divergência.
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const painel = doc.querySelector("[data-testid='chances-panel-meters']");
    expect(painel?.querySelectorAll("[role='meter']").length).toBe(3);
    expect(painel?.querySelectorAll("[data-view-only]").length).toBe(0);
  });

  it("(w4) candidatura sem `p_eleito` não vira medidor em base nenhuma — nem com 0%", async () => {
    // Davi entra no recorte da PROJEÇÃO (3º projetado) e o modelo não publicou
    // `p_eleito` para ele. O painel tem de simplesmente não desenhá-lo: um
    // medidor em 0% afirmaria que ele não se elege, que é uma conclusão que o
    // payload não sustenta.
    readUfProjectionMock.mockResolvedValue(
      elencosDivergentes([{}, {}, {}, { p_eleito: undefined }]),
    );
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const proj = chancesDaBase(doc, "proj");
    expect(proj?.querySelectorAll("[role='meter']").length).toBe(2);
    expect(proj?.textContent).not.toContain("Davi Nunes");
    // E ninguém foi promovido para o lugar dele: o recorte é dos 3 primeiros,
    // não "os 3 primeiros com dado".
    expect(proj?.textContent).not.toContain("Célia Mota");

    const zeros = [
      ...(doc.querySelectorAll("[data-testid='chances-panel-meters'] [role='meter']") ?? []),
    ].map((m) => m.getAttribute("aria-valuenow"));
    expect(zeros).not.toContain("0");
  });

  it("(w5) o número do medidor é o do payload — o painel não recalcula probabilidade", async () => {
    // Constituição § 6: `p_eleito` sai do bootstrap (ADR-0014) e a UI só
    // imprime. A fixture desalinha de propósito a probabilidade do percentual
    // (Davi projeta 29% e tem 13% de chance; Célia projeta 5% e tem 90%), de
    // modo que qualquer número derivado de `pct_projetado` na tela erraria.
    readUfProjectionMock.mockResolvedValue(elencosDivergentes());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const valor = (base: "parcial" | "proj", nome: string) =>
      [...(chancesDaBase(doc, base)?.querySelectorAll("[role='meter']") ?? [])]
        .find((m) => m.getAttribute("aria-label")?.startsWith(nome))
        ?.getAttribute("aria-valuenow");

    expect(valor("proj", "Davi Nunes")).toBe("13");
    expect(valor("parcial", "Célia Mota")).toBe("90");
  });
});

// ---------------------------------------------------------------------------
// Os dois ramos que ninguém alcançava — lacuna apontada pelo
// `a11y-perf-auditor` em 2026-09-11: as UFs da fixture tinham todas IC95 de
// ~4,8 pp e no máximo 4 candidatos, então nem o painel substituto de chances
// nem o colapso da lista eram exercitáveis numa tela de Senador. A fixture de
// dev (`sen-uf.json`) ganhou RR e AP com esses formatos, para a inspeção
// visual; aqui o payload é injetado direto, que é como o resto do arquivo faz.
// ---------------------------------------------------------------------------

describe("/uf/[sigla]/senador — os dois ramos de borda", () => {
  it("(s) IC de largura zero: mostra a explicação, nunca '100%' de chance", async () => {
    // Com uma única zona apurada o bootstrap devolve réplicas idênticas e o IC
    // fecha num ponto. `p_eleito` vale 1,0 no payload, e publicá-lo como
    // probabilidade afirmaria certeza que o modelo não tem (constituição § 6).
    readUfProjectionMock.mockResolvedValue(
      ufPayload({
        uf: "RR",
        pct_apurado: 6,
        candidatos: [
          ufCand(1, "Ana Lima", "PT", 41, { p_eleito: 1, ci95: { lower: 41, upper: 41 } }),
          ufCand(2, "Bruno Reis", "PL", 33, { p_eleito: 1, ci95: { lower: 33, upper: 33 } }),
          ufCand(3, "Célia Mota", "MDB", 26, { p_eleito: 0, ci95: { lower: 26, upper: 26 } }),
        ],
      }),
    );
    const doc = await render(UFSenadorPage({ params: Promise.resolve({ sigla: "RR" }) }));
    const texto = doc.body.textContent ?? "";

    // Escopado ao painel de chances: a página tem outro `role="meter"`
    // legítimo, o da barra de apuração em `ForecastTransparency`.
    expect(doc.querySelector("[data-testid='chances-panel-meters']")).toBeNull();
    expect(texto).not.toContain("100%");
    // E a tela explica — não fica muda (constituição § 7 e § 8).
    expect(texto).toMatch(/uma única zona eleitoral apurada/i);
    // E a explicação diz que é transitório — não que o cargo é assim por
    // natureza, o que deixou de ser verdade com a ingestão por zona.
    expect(texto).toMatch(/segunda zona/i);
    expect(texto).not.toMatch(/um único boletim por estado/i);
  });

  it("(t) com IC medido, os medidores de chance voltam — a guarda não é permanente", async () => {
    // Contraprova de (s): se o painel sumisse sempre, (s) passaria por acidente.
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.querySelector("[data-testid='chances-panel-meters']")).not.toBeNull();
  });

  it("(u) UF com mais candidatos que o limite exibe o colapso, e as vagas ficam no DOM", async () => {
    const siglas = ["PT", "PL", "MDB", "PSD", "PP", "UNIÃO", "PDT", "PSOL"];
    const pcts = [28, 24, 15, 11, 8, 6, 5, 3];
    readUfProjectionMock.mockResolvedValue(
      ufPayload({
        uf: "AP",
        candidatos: siglas.map((sg, i) =>
          ufCand(i + 1, `Cand ${sg}`, sg, pcts[i] as number, {
            p_eleito: i === 0 ? 1 : i === 1 ? 0.62 : i === 2 ? 0.34 : 0,
          }),
        ),
      }),
    );
    const doc = await render(UFSenadorPage({ params: Promise.resolve({ sigla: "AP" }) }));

    const botao = doc.querySelector("[aria-expanded]");
    expect(botao, "8 candidatos deviam render o colapso da lista").not.toBeNull();
    expect(botao?.getAttribute("aria-controls")).toBeTruthy();
    // Mesmo colapsada, as duas linhas de vaga permanecem no DOM (ADR-0017).
    expect(linhasComVaga(doc)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2026-09-20 — a lista de municípios (e, com ela, a folha do município)
// chegaram a esta rota. Até aqui `/uf/[sigla]/senador` era a única das três
// rotas de estado sem nenhuma das duas: o clique num município do mapa da
// moldura escrevia em `useMunicipioSheetStore` e **nada acontecia**, porque
// `<MunicipioExplorer>` — o leitor daquele store — não era montado.
// ---------------------------------------------------------------------------

/** Municípios de SP para o Blob desta corrida, em eleitorado decrescente. */
function municipiosSen(n: number): EdgeUfMunicipio[] {
  return Array.from({ length: n }, (_, i) => ({
    cod_ibge: `35${String(i).padStart(5, "0")}`,
    nome: `Município ${i + 1}`,
    pct_apurado: 60,
    lider: {
      candidato_id: i % 2 === 0 ? 1 : 2,
      partido: i % 2 === 0 ? "PT" : "PL",
      votos: 10_000 + i,
      margem_pp: 7,
    },
    votos_reportados: { 1: 10_000, 2: 8_000 },
    eleitores: 9_000_000 - i * 1_000,
    ...(i === 0 ? { capital: true as const } : {}),
  }));
}

function blobSenadorComMunicipios(municipios: EdgeUfMunicipio[]): UfDetailResult {
  return {
    status: "ok",
    url: "https://exemplo.test/municipios/uf/SP/sen/t1.json",
    detail: {
      ts: "2026-10-04T20:10:00-03:00",
      uf: "SP",
      cargo: "sen",
      turno: 1,
      municipios,
      series_temporais: null,
    },
  };
}

describe("/uf/[sigla]/senador — os municípios (2026-09-20)", () => {
  beforeEach(() => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
  });

  it("(v) 🔴 a lista existe nesta rota — só os 25 maiores, sem 'mostrar mais' (03/10)", async () => {
    // 2026-10-03, pedido do dono: o mesmo recorte do governador. Mutação que
    // morre aqui: tirar `limiteLista={25}` da página (volta a 20 + botão).
    readUfDetailMock.mockResolvedValueOnce(blobSenadorComMunicipios(municipiosSen(645)));
    const doc = await render(UFSenadorPage(PARAMS_SP));

    expect(doc.querySelector("[data-testid='municipios-lista']")).not.toBeNull();
    expect(doc.querySelector("#municipios-heading")?.textContent).toBe(
      "Municípios — 25 maiores de 645",
    );
    expect(doc.querySelectorAll("[data-testid='municipios-lista'] tbody tr")).toHaveLength(25);
    expect(doc.querySelector("table[aria-rowcount='25']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='municipios-carregar-mais']")).toBeNull();
    expect(doc.querySelector("[data-testid='municipios-status']")?.textContent).toBe(
      "Mostrando 25 de 645 municípios.",
    );
  });

  it("(w) 🔴 cada município é um botão — é o gatilho da folha que faltava aqui", async () => {
    readUfDetailMock.mockResolvedValueOnce(blobSenadorComMunicipios(municipiosSen(30)));
    const doc = await render(UFSenadorPage(PARAMS_SP));

    // 25 botões = o recorte dos 25 maiores (03/10; era a leva de 20). Antes
    // de 20/09 eram ZERO nesta rota.
    expect(doc.querySelectorAll("[data-testid='municipio-open']")).toHaveLength(25);
    // A folha começa fechada; abri-la é interação (e2e / MunicipioExplorer).
    expect(doc.querySelector("[data-testid='sheet']")).toBeNull();
  });

  it("(x) sem município no Blob, o painel fica no DOM e diz por quê (ADR-0017)", async () => {
    readUfDetailMock.mockResolvedValueOnce(blobSenadorComMunicipios([]));
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const kickers = [...doc.querySelectorAll("[data-testid='panel-kicker']")].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Municípios");
    const estados = [...doc.querySelectorAll("[data-testid='detail-unavailable']")].map((e) =>
      e.getAttribute("data-reason"),
    );
    expect(estados).toContain("empty");
    expect(doc.querySelector("[data-testid='municipios-lista']")).toBeNull();
  });

  it("(y) Blob indisponível: o motivo da fonte, não 'vazio' — e a página não cai", async () => {
    readUfDetailMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "not_found",
      url: "https://exemplo.test/municipios/uf/SP/sen/t1.json",
    });
    const doc = await render(UFSenadorPage(PARAMS_SP));

    const estados = [...doc.querySelectorAll("[data-testid='detail-unavailable']")].map((e) =>
      e.getAttribute("data-reason"),
    );
    expect(estados).toContain("not_found");
    // O resumo vem da OUTRA fonte e segue inteiro (ADR-0032 item 3).
    expect(doc.querySelectorAll("[data-testid='candidate-result-row']").length).toBeGreaterThan(0);
  });

  it("(z) a lista NÃO lê nada além do que a série já leu — um só `readUfDetail`", async () => {
    // RNF-002: a seção de municípios reaproveita o MESMO resultado do Blob que
    // o gráfico de evolução consome. Uma segunda leitura aqui somaria uma ida
    // à rede ao caminho crítico da rota de maior tráfego.
    readUfDetailMock.mockClear();
    readUfDetailMock.mockResolvedValueOnce(blobSenadorComMunicipios(municipiosSen(5)));
    await render(UFSenadorPage(PARAMS_SP));

    expect(readUfDetailMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spec 021 RF-192 emendado (2026-09-26, noite) — um `votacao` de UF que FECHA
 * nas identidades do TSE, com números que não existem em nenhum outro lugar
 * do payload: se a tela mostrar `instalados = 900`, só pode ter vindo daqui.
 *
 * 🔴 Reescrito em 2026-09-27 (spec 022 RF-210): é o SENADO, e o Senado conta
 * dois votos por eleitor — `tv == 2 × c` nas capturas reais do simulado. Os
 * campos de voto somam `2 × comparecimento` (1.400), não `comparecimento`
 * (700); `c + a = esi` segue em pessoas. A versão anterior era de UMA vaga e
 * só "passava" porque nenhum teste olhava se os arcos fechavam.
 * A corrida: Σ válidas = 1.200 = `validos`; a candidatura 9 é sub judice.
 */
const VOTACAO_UF = {
  contagens: {
    aptos: 1000,
    instalados: 900,
    comparecimento: 700,
    abstencao: 200,
    validos: 1200,
    brancos: 80,
    nulos: 60,
    anulados: 40,
    sub_judice: 20,
  },
  corrida: [
    { id: 1, partido: "PT", votos: 500, destino: "valido" as const },
    { id: 2, partido: "PL", votos: 400, destino: "valido" as const },
    { id: 3, partido: "MDB", votos: 300, destino: "valido" as const },
    { id: 9, partido: "PCO", votos: 20, destino: "sub_judice" as const },
  ],
  // Votos em votos; abstenção em pessoas: 1400 + 100 + 80 + 2×150 = 1880 ≤ 2000.
  projetada: { validos: 1400, brancos: 100, nulos: 80, abstencao: 150 },
};

describe("spec 021 RF-192 / spec 022 RF-200 emendados (2026-09-26, noite)", () => {
  it("🔴 /senador NÃO tem 'Votação' nem 'A corrida' — mesmo com `votacao` no payload", async () => {
    readProjectionMock.mockResolvedValue(nacional({ votacao: VOTACAO_UF }));
    const doc = await render(SenadoPage());
    expect(doc.querySelector('[aria-labelledby="votacao-eleitorado-heading"]')).toBeNull();
    expect(doc.querySelector('[aria-labelledby="corrida-tres-circulos-heading"]')).toBeNull();
    expect(doc.querySelector('[data-testid="votacao-eleitorado"]')).toBeNull();
  });

  it("/uf/SP/senador tem 'Votação' com o dado DA UF, e nada nele diz 'Brasil'", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload({ votacao: VOTACAO_UF }));
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel).not.toBeNull();
    expect(painel?.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe("Senador · SP");
    expect(
      painel?.querySelector('[data-testid="votacao-eleitorado"]')?.getAttribute("data-instalados"),
    ).toBe("900");
    expect(painel?.textContent ?? "").not.toMatch(/Brasil/);
    // O arco 3 da UF desenha (há `projetada`), não fica em "aguardando".
    expect(painel?.querySelector('[data-testid="votacao-circulo-3-aguardando"]')).toBeNull();
  });

  it("/uf/SP/senador sem `votacao` no payload: o painel fica no DOM, indisponível (RF-198)", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload());
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const painel = doc.querySelector('[aria-labelledby="votacao-uf-heading"]');
    expect(painel?.querySelector('[data-testid="detail-unavailable"]')).not.toBeNull();
    expect(doc.querySelectorAll("h1").length).toBe(1);
  });
});

/**
 * Spec 022 RF-210 / spec 021 RF-195c (decisão do dono, 2026-09-27) — o Senado
 * contado em VOTOS, com `votosPorEleitor` lido de `payload.vagas`, e SEM
 * default: sem `vagas` confiável, os dois painéis ficam indisponíveis.
 */
describe("/uf/[sigla]/senador — RF-210: votos por eleitor vêm de `vagas`, sem supor", () => {
  const painelDe = (doc: Document, titleId: string) =>
    doc.querySelector(`[aria-labelledby="${titleId}"]`);

  it("🔴 `vagas: 2` ⇒ os arcos do 'Votação' e os círculos da corrida FECHAM, em votos", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload({ votacao: VOTACAO_UF }));
    const doc = await render(UFSenadorPage(PARAMS_SP));
    const votacao = painelDe(doc, "votacao-uf-heading");
    const corrida = painelDe(doc, "corrida-tres-circulos-heading");
    for (const n of [1, 2, 3] as const) {
      expect(
        votacao?.querySelector(`[data-testid="votacao-circulo-${n}-inconsistente"]`),
      ).toBeNull();
      expect(corrida?.querySelector(`[data-testid="corrida-circulo-${n}-nao-fecha"]`)).toBeNull();
      expect(corrida?.querySelector(`[data-testid="corrida-circulo-${n}"] svg`)).not.toBeNull();
    }
    expect(
      votacao?.querySelector('[data-testid="votacao-circulo-1"]')?.getAttribute("data-total"),
    ).toBe("2000");
    expect(votacao?.querySelector('[data-testid="votacao-circulo-1-base"]')?.textContent).toContain(
      "votos (2 por eleitor)",
    );
    expect(
      corrida?.querySelector('[data-testid="corrida-circulo-2"]')?.getAttribute("data-total"),
    ).toBe("1400");
    // O "aguardando Senado" de 26/09 não existe mais.
    expect(doc.body.innerHTML).not.toContain("aguardando-senado");
  });

  it("🔴 payload SEM `vagas` ⇒ os dois painéis indisponíveis — nunca supor 2 (nem 1)", async () => {
    const semVagas = ufPayload({ votacao: VOTACAO_UF });
    delete (semVagas as Partial<EdgePayloadUf>).vagas;
    readUfProjectionMock.mockResolvedValue(semVagas);
    const doc = await render(UFSenadorPage(PARAMS_SP));
    for (const id of ["votacao-uf-heading", "corrida-tres-circulos-heading"]) {
      const painel = painelDe(doc, id);
      expect(
        painel?.querySelector('[data-testid="detail-unavailable"]')?.getAttribute("data-reason"),
      ).toBe("invalid");
      expect(painel?.querySelector("svg")).toBeNull();
    }
    // A posição dos painéis não muda: resultado → A corrida → Votação
    // (ordem invertida pelo dono em 2026-09-27).
    const paineis = [...doc.querySelectorAll('[data-testid="panel"]')];
    const ids = paineis.map((p) => p.getAttribute("aria-labelledby"));
    expect(ids.indexOf("corrida-tres-circulos-heading")).toBe(1);
    expect(ids.indexOf("votacao-uf-heading")).toBe(2);
    // E o resto da página segue de pé (o marcador de vaga ainda cai na tabela).
    expect(linhasComVaga(doc)).toBe(VAGAS_SENADO);
  });

  it("🔴 `vagas` fora de 1..2 (3, 1.5, 0) ⇒ indisponível", async () => {
    for (const vagas of [3, 1.5, 0]) {
      readUfProjectionMock.mockResolvedValue(ufPayload({ votacao: VOTACAO_UF, vagas }));
      const doc = await render(UFSenadorPage(PARAMS_SP));
      for (const id of ["votacao-uf-heading", "corrida-tres-circulos-heading"]) {
        expect(
          painelDe(doc, id)?.querySelector('[data-testid="detail-unavailable"]'),
        ).not.toBeNull();
      }
    }
  });

  it("`vagas: 1` (um terço do Senado) ⇒ 1 por eleitor, sem frase do Senado", async () => {
    readUfProjectionMock.mockResolvedValue(ufPayload({ votacao: VOTACAO_UF, vagas: 1 }));
    const doc = await render(UFSenadorPage(PARAMS_SP));
    expect(
      doc
        .querySelector('[data-testid="votacao-eleitorado"]')
        ?.getAttribute("data-votos-por-eleitor"),
    ).toBe("1");
    expect(doc.querySelector('[data-testid="votacao-metodologia-votos"]')).toBeNull();
  });
});

/**
 * Spec 022 RF-210, achado do produtor (2026-09-27) — no Senado,
 * `participacao.brancos_nulos` e a base "comparecimento" dos candidatos são
 * VOTOS sobre VOTOS (`(vb+tvn)/tv`), e o rótulo "% do comparecimento" seria
 * falso no cargo 5. Medido em 2026-09-27: NENHUMA rota de Senado desenha esse
 * rótulo hoje — `ProjectionThermometers` (o único que o escreve) só entra nas
 * rotas de Presidente e Governador. Este caso trava isso: quem puser o bloco
 * aqui terá de resolver a unidade antes.
 */
describe("/uf/[sigla]/senador — RF-210: nada rotulado 'do comparecimento'", () => {
  it("🔴 com `participacao.brancos_nulos` e `comparecimento` nos candidatos, a tela não diz 'comparecimento'", async () => {
    const participacao = {
      brancos_nulos: {
        pct_atual: 5.91,
        pct_projetado: 5.91,
        lower: 5.8,
        upper: 6.0,
        base: "comparecimento" as const,
      },
      abstencao: {
        pct_atual: 14.8,
        pct_projetado: 14.8,
        lower: 14.6,
        upper: 15.0,
        base: "eleitores_instalados" as const,
      },
    };
    const base = ufPayload();
    readUfProjectionMock.mockResolvedValue(
      ufPayload({
        votacao: VOTACAO_UF,
        participacao,
        candidatos: base.candidatos.map((c) => ({
          ...c,
          comparecimento: { pct_atual: 20, pct_projetado: 20, lower: 19, upper: 21 },
        })),
      }),
    );
    const doc = await render(UFSenadorPage(PARAMS_SP));
    expect(doc.body.textContent ?? "").not.toMatch(/comparecimento/i);
  });
});
