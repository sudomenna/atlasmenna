// @vitest-environment happy-dom
/**
 * tests/unit/pages/aguardando-candidatos.test.tsx — T-14, RF-149.
 *
 * A grade de "quem está concorrendo" dentro do estado "aguardando dados" das
 * páginas de cargo. O que estes testes travam **não** é que a grade aparece —
 * é o conjunto de coisas que a grade poderia quebrar ao aparecer:
 *
 *   (a) **ORDEM no DOM.** O parágrafo honesto de espera vem PRIMEIRO; a grade
 *       depois. Um teste de presença (`o parágrafo existe`) passaria com a
 *       grade enfiada por cima dele — que é exatamente o modo de falha que o
 *       "acrescentar, nunca substituir" da spec 018 existe para impedir. O
 *       texto de espera já foi corrigido três vezes neste projeto.
 *   (b) **A grade some quando chega voto.** Ela é o preenchimento de um vazio,
 *       não um bloco permanente (RF-149, 2º critério).
 *   (c) **Blob fora do ar não derruba a página.** `readCandidatosUf` nunca
 *       lança por contrato; o que este arquivo prova é o degrau seguinte — a
 *       página renderiza só o texto de espera, com a moldura inteira
 *       (constituição § 7).
 *   (d) **O nome vem da FATIA, não do payload.** "LULA" e não `Candidato 13`:
 *       é o objetivo inteiro da spec 018, e a asserção é sobre o nome real
 *       E sobre a ausência do placeholder.
 *   (e) **A chave `(cargo, uf)` é a da rota.** `/uf/SP/senador` pede a fatia de
 *       cargo 5 em SP — nunca a de outro cargo, nunca a de outra UF. Um
 *       conversor de cargo com default silencioso já mordeu este repositório
 *       mais de uma vez (`docs/reference/risks.md`); aqui o argumento da
 *       chamada é asserido, não o resultado.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import UFDeputadoPage from "@/app/(dep)/uf/[sigla]/deputado-federal/page";
import UFGovernadorPage from "@/app/(gov)/uf/[sigla]/governador/page";
import HomePage from "@/app/(pres)/page";
import UFPresPage from "@/app/(pres)/uf/[sigla]/page";
import UFSenadorPage from "@/app/(sen)/uf/[sigla]/senador/page";
import type {
  CandidatoIdentidade,
  CandidatosUfResult,
  CandidatosUfSlice,
} from "@/lib/blob/candidatos";

// ---------------------------------------------------------------------------
// Mocks — todo reader de apuração devolve "nada publicado", que é o estado
// inteiro sob teste. O reader de candidaturas é a VARIÁVEL.
// ---------------------------------------------------------------------------

const readCandidatosUfMock = vi.fn<(sigla: string, cargo: string) => Promise<CandidatosUfResult>>();

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: (sigla: string, cargo: string) => readCandidatosUfMock(sigla, cargo),
}));

const readNationalProjectionMock = vi.fn();
const readUfProjectionMock = vi.fn();
const readDeputadoProjectionMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  // Spec 026 (RF-265) — as telas de Deputado leem o interruptor da projeção a
  // cada render. Ausente = desligado (falha fechada), o estado de antes da virada.
  readInterruptorProjecao: vi.fn(async () => ({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  })),
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: () => Promise.resolve(null),
  readUfProjection: (sigla: string, opts?: unknown) => readUfProjectionMock(sigla, opts),
  readDeputadoProjection: () => readDeputadoProjectionMock(),
  // Spec 020 (RF-174d): o ramo de espera das rotas de UF passou a perguntar a
  // FASE ao payload NACIONAL da corrida — essas rotas não têm payload próprio
  // em fase pré, porque o semeador só grava as chaves nacionais. Sem este
  // membro no mock, a página lança antes de renderizar e os casos (j)/(k)/(l)
  // falham por módulo ausente, não pelo que eles medem.
  readProjection: () => Promise.resolve(null),
}));

vi.mock("@/lib/blob/uf-detail", () => ({
  readUfDetail: () =>
    Promise.resolve({ status: "unavailable", reason: "not_found", url: null } as const),
  municipiosFrom: () => [],
  seriesFrom: () => null,
  // Spec 020 (Fase 2): as rotas de UF passaram a ler a série por candidatura
  // do MESMO resultado de `readUfDetail`. Com o mock devolvendo `unavailable`,
  // o acessor real responderia `null` — é o que este stub reproduz, e é o
  // estado que este arquivo mede ("Blob fora do ar").
  seriePorCandidatoFrom: () => null,
}));

vi.mock("@/lib/blob/deputado-uf", () => ({
  readDeputadoUfDetail: () =>
    Promise.resolve({ status: "unavailable", reason: "not_found", url: null } as const),
  ordenarAgremiacoes: (x: unknown) => x,
  ordenarCandidatos: (x: unknown) => x,
  agremiacoesFrom: () => [],
}));

const ORIGINAL_BASE = process.env.BLOB_PUBLIC_BASE_URL;
beforeAll(() => {
  process.env.BLOB_PUBLIC_BASE_URL = "https://exemplo.public.blob.vercel-storage.com";
});
afterAll(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
  else process.env.BLOB_PUBLIC_BASE_URL = ORIGINAL_BASE;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cand(over: Partial<CandidatoIdentidade> = {}): CandidatoIdentidade {
  return {
    sqcand: "250002553928",
    numero: 13,
    nome_urna: "LULA",
    nome: "Luiz Inácio Lula da Silva",
    partido: "PT",
    sob_ressalva: false,
    foto_ok: false,
    situacao_julgamento: "DEFERIDO",
    ...over,
  };
}

function slice(over: Partial<CandidatosUfSlice> = {}): CandidatosUfSlice {
  return {
    uf: "BR",
    cargo: "pres",
    fonte_ts: "2026-09-12T18:30:00.000Z",
    gerado_ts: "2026-09-13T02:00:00.000Z",
    candidatos: [cand(), cand({ sqcand: "250002553929", numero: 22, nome_urna: "MARINA" })],
    ...over,
  } as CandidatosUfSlice;
}

function ok(s: CandidatosUfSlice): CandidatosUfResult {
  return { status: "ok", slice: s, url: "https://exemplo/x.json" };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * "`b` vem depois de `a` na ordem do documento, e não dentro dele."
 *
 * `compareDocumentPosition` é a pergunta certa, e não `indexOf` no HTML: ele
 * é insensível a espaço em branco e a atributos, e distingue "depois" de
 * "aninhado". A checagem de `contains` está aqui porque um nó ANINHADO dentro
 * do parágrafo também reporta `FOLLOWING` — e substituir o parágrafo por um
 * invólucro da grade é justamente a mutação que este teste precisa pegar.
 */
function vemDepois(a: Element, b: Element): boolean {
  const DOCUMENT_POSITION_FOLLOWING = 4;
  if (a.contains(b)) return false;
  return (a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function grade(doc: Document): Element | null {
  return doc.querySelector('[data-testid="candidaturas-aguardando"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  readNationalProjectionMock.mockResolvedValue(null);
  readUfProjectionMock.mockResolvedValue(null);
  readDeputadoProjectionMock.mockResolvedValue(null);
  readCandidatosUfMock.mockResolvedValue(ok(slice()));
});

// ---------------------------------------------------------------------------
// Home nacional — `/`
// ---------------------------------------------------------------------------

describe("RF-149 — grade de candidaturas no estado aguardando (home)", () => {
  it("(a) o parágrafo honesto vem ANTES da grade no DOM", async () => {
    // Mutações que devem derrubá-lo:
    //   - mover `{grade}` para cima do `<Panel>` do parágrafo;
    //   - trocar o parágrafo pela grade (substituir em vez de acrescentar);
    //   - aninhar a grade dentro do parágrafo.
    const doc = parse(renderToStaticMarkup(await HomePage()));

    const aguardando = doc.querySelector('[data-testid="pres-aguardando"]');
    const g = grade(doc);

    expect(aguardando).not.toBeNull();
    expect(g).not.toBeNull();
    expect(vemDepois(aguardando as Element, g as Element)).toBe(true);
  });

  it("(a2) spec 020: a evolução da apuração existe NESTE ramo, e diz não saber", async () => {
    // 🔴 Este é o ramo que a PRODUÇÃO serve hoje: sem chave no Global Config a
    // home nunca chega ao ramo com payload. O widget entrou primeiro só no
    // outro ramo, e o resultado foi um bloco que passava nos testes e **não
    // existia no site** — conferido em https://salacofre.vercel.app em
    // 2026-09-17, com o deploy verde.
    //
    // Mutações que devem derrubá-lo:
    //   - remover o bloco deste ramo (o defeito original);
    //   - passar `preEleicao` aqui: este ramo é alcançado tanto antes de 04/10
    //     quanto por falha de leitura, e a tela não distingue os dois — afirmar
    //     o calendário seria dar uma causa que ninguém mediu.
    const doc = parse(renderToStaticMarkup(await HomePage()));

    const bloco = doc.querySelector('[data-testid="serie-apuracao-chart"]');
    expect(bloco, "o bloco da spec 020 sumiu do ramo que produção serve").not.toBeNull();
    expect(bloco?.getAttribute("data-estado")).toBe("indisponivel");
    expect(doc.body.textContent).not.toContain("disponível apenas no dia das eleições");
  });

  it("(b) sem payload, a grade traz o nome REAL da fatia — não `Candidato {n}`", async () => {
    // Mutação que deve derrubá-lo: montar a grade a partir de
    // `payload.national.candidatos` (que aqui nem existe) ou de um placeholder.
    // É o objetivo inteiro da spec 018: em 04/10 nenhuma tela pode dizer
    // "Candidato 13 lidera".
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const texto = doc.body.textContent ?? "";

    expect(texto).toContain("LULA");
    expect(texto).toContain("MARINA");
    expect(texto).not.toContain("Candidato 13");
  });

  it("(c) pede a fatia de cargo 1 sob `BR` — a corrida presidencial é nacional", async () => {
    // Mutação que deve derrubá-lo: passar a sigla da rota, ou o token de outro
    // cargo. `BR` é o que o CSV do TSE traz em `SG_UF` para candidatura
    // presidencial (design 018 § D1).
    await HomePage();
    expect(readCandidatosUfMock).toHaveBeenCalledWith("BR", "pres");
  });

  it("(d) a atribuição de licença e o carimbo saem do DADO, nunca do JSX", async () => {
    // RF-150 + design 018 § D8. Mutação que deve derrubá-lo: escrever a data à
    // mão, ou omitir "Fonte: TSE" na grade porque o footer já o traz — são
    // obrigações distintas (constituição § 1 vs. licença cc-by do ADR-0039).
    readCandidatosUfMock.mockResolvedValue(ok(slice({ fonte_ts: "2026-09-11T09:05:00.000Z" })));
    const doc = parse(renderToStaticMarkup(await HomePage()));

    const fonte = doc.querySelector('[data-testid="candidatos-fonte"]');
    expect(fonte?.textContent).toContain("Fonte: TSE");
    // 11/09 06:05 em Brasília (UTC−3). O número sai do `fonte_ts` injetado.
    expect(doc.querySelector('[data-testid="candidatos-fonte-ts"]')?.textContent).toBe(
      "11/09/2026, 06:05",
    );
  });

  it("(e) a grade leva a `/candidatos` com o filtro desta corrida na URL", async () => {
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const link = doc.querySelector('[data-testid="candidaturas-aguardando-link"]');
    expect(link?.getAttribute("href")).toBe("/candidatos?cargo=1&uf=BR");
  });

  it("(f) a grade diz, em texto, que NÃO é resultado", async () => {
    // Constituição § 8. Mutação que deve derrubá-lo: remover a ressalva — duas
    // listas com foto no mesmo produto, uma delas com percentual, e a que não
    // tem se lê como placar ordenado.
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const ressalva = doc.querySelector('[data-testid="candidaturas-aguardando-ressalva"]');
    expect(ressalva?.textContent).toContain("não é resultado");
  });
});

describe("RF-149 — degradação e desaparecimento", () => {
  for (const reason of ["not_found", "fetch_error", "not_configured", "invalid"] as const) {
    it(`(g) \`${reason}\`: a página mostra só o texto de espera e não quebra`, async () => {
      // Mutação que deve derrubá-lo: deixar `readCandidatosUf` lançar, ou
      // renderizar a grade vazia, ou anunciar o erro logo abaixo de "aguardando
      // o primeiro boletim" (dobrar a notícia de vazio).
      readCandidatosUfMock.mockResolvedValue({ status: "unavailable", reason, url: null });

      const doc = parse(renderToStaticMarkup(await HomePage()));

      expect(doc.querySelector('[data-testid="pres-aguardando"]')).not.toBeNull();
      expect(grade(doc)).toBeNull();
      // A moldura da página inteira continua de pé (constituição § 7).
      expect(doc.querySelectorAll("h1")).toHaveLength(1);
      expect(doc.querySelector("main")?.querySelector("footer")).not.toBeNull();
      expect(doc.body.textContent).toContain("Metodologia");
    });
  }

  it("(h) fatia publicada vazia: nenhuma grade, nenhum `0 candidaturas`", async () => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ candidatos: [] })));
    const doc = parse(renderToStaticMarkup(await HomePage()));

    expect(doc.querySelector('[data-testid="pres-aguardando"]')).not.toBeNull();
    expect(grade(doc)).toBeNull();
  });

  it("(i) chegou boletim: a grade SAI e o resultado entra", async () => {
    // Mutação que deve derrubá-lo: montar a grade fora do ramo "aguardando" —
    // ela é o preenchimento de um vazio, não um bloco permanente.
    const fixture = (
      await import("@/tests/fixtures/edge-config/projection-current.json", {
        with: { type: "json" },
      })
    ).default;
    readNationalProjectionMock.mockResolvedValue(fixture);

    const doc = parse(renderToStaticMarkup(await HomePage()));

    expect(doc.querySelector('[data-testid="pres-aguardando"]')).toBeNull();
    expect(grade(doc)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Páginas de UF — a chave `(cargo, uf)` é a da rota
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// O corte de 60 dentro da tela de apuração
// ---------------------------------------------------------------------------

describe("RF-149 — a grade de espera desenha no máximo 60", () => {
  /** 1.061 candidaturas em ordem DECRESCENTE de número — ver `muitos` em candidatos.test.tsx. */
  function muitos(n: number): CandidatoIdentidade[] {
    return Array.from({ length: n }, (_, i) => {
      const numero = n - i;
      return cand({
        sqcand: `2500${String(numero).padStart(8, "0")}`,
        numero,
        nome_urna: `CAND ${numero}`,
        nome: `Candidato ${numero}`,
        // `foto_ok: true` porque o custo medido é de `<img>`: o HTML de SP tinha
        // 1.061 cartões e 1.061 fotos. Com `false` o caso contaria zero imagens
        // e passaria sem provar nada sobre o que o corte de fato economiza.
        foto_ok: true,
      });
    });
  }

  async function spDep(): Promise<Document> {
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "SP", cargo: "dep" as never, candidatos: muitos(1061) })),
    );
    return parse(
      renderToStaticMarkup(await UFDeputadoPage({ params: Promise.resolve({ sigla: "sp" }) })),
    );
  }

  it("(m) `/uf/SP/deputado-federal` no estado de espera: 60 cartões, não 1.061", async () => {
    // Mutação que deve derrubá-lo: remover o `.slice(0, CANDIDATOS_POR_PAGINA)`.
    // É a página que media 4.015.398 bytes de HTML prerenderizado.
    const doc = await spDep();
    expect(doc.querySelectorAll('[data-testid="candidate-card"]')).toHaveLength(60);
    expect(doc.querySelectorAll("img")).toHaveLength(60);
  });

  it("(n) a contagem continua dizendo 1.061 — o corte é de exibição", async () => {
    // Mutação que deve derrubá-lo: passar `exibidos.length` como `total`. A
    // tela afirmaria que São Paulo elege deputado entre 60 candidatos.
    const doc = await spDep();
    const contagem = doc.querySelector('[data-testid="candidatos-grid-contagem"]');

    expect(contagem?.getAttribute("data-total")).toBe("1061");
    expect(contagem?.textContent).toBe("1.061 candidaturas");
  });

  it("(o) e diz, em texto, quantas ficaram de fora", async () => {
    // Mutação que deve derrubá-lo: cortar em silêncio. 60 cartões sem aviso se
    // leem como "são estes" (constituição § 8).
    const doc = await spDep();
    const corte = doc.querySelector('[data-testid="candidaturas-aguardando-corte"]');

    expect(corte?.getAttribute("data-mostrando")).toBe("60");
    expect(corte?.getAttribute("data-total")).toBe("1061");
    expect(corte?.textContent).toContain("Mostrando 60 de 1.061");
  });

  it("(p) as 60 são as de MENOR número — ordena antes de cortar", async () => {
    // Mutação que deve derrubá-lo: cortar `slice.candidatos` na ordem do Blob.
    // A fixture chega decrescente: sem ordenar, sairiam 1.061..1.002.
    const doc = await spDep();
    const ns = [...doc.querySelectorAll('[data-testid="candidate-card-numero"]')].map((el) =>
      Number(el.textContent),
    );
    expect(ns[0]).toBe(1);
    expect(ns[59]).toBe(60);
  });

  it("(q) NÃO expande dentro da apuração — só o link para `/candidatos`", async () => {
    // Mutação que deve derrubá-lo: reusar o "carregar mais" da rota
    // `/candidatos` aqui. Expandir mil cartões numa tela de apuração empurra o
    // resultado — a coisa pela qual o leitor veio — para baixo deles.
    const doc = await spDep();
    const bloco = doc.querySelector('[data-testid="candidaturas-aguardando"]');

    expect(bloco?.querySelector('[data-testid="candidatos-carregar-mais"]')).toBeNull();
    expect(bloco?.querySelector('[data-testid="candidatos-ver-todas"]')).toBeNull();
    expect(bloco?.querySelectorAll("button")).toHaveLength(0);
    expect(
      bloco?.querySelector('[data-testid="candidaturas-aguardando-link"]')?.getAttribute("href"),
    ).toBe("/candidatos?cargo=6&uf=SP");
  });

  it("(r) corrida menor que 60 não ganha a frase de corte", async () => {
    // Mutação que deve derrubá-lo: emitir a frase incondicionalmente —
    // "mostrando 2 de 2" é redundância que se lê como aviso.
    readCandidatosUfMock.mockResolvedValue(ok(slice()));
    const doc = parse(renderToStaticMarkup(await HomePage()));

    expect(doc.querySelector('[data-testid="candidaturas-aguardando"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="candidaturas-aguardando-corte"]')).toBeNull();
  });
});

describe("RF-149 — páginas de UF", () => {
  const casos = [
    {
      nome: "/uf/[sigla] (Presidente)",
      render: () => UFPresPage({ params: Promise.resolve({ sigla: "sp" }) }),
      paragrafo: "uf-aguardando",
      // Presidente: a corrida é a nacional, e a fatia mora sob `BR`.
      chamada: ["BR", "pres"] as const,
    },
    {
      nome: "/uf/[sigla]/governador",
      render: () => UFGovernadorPage({ params: Promise.resolve({ sigla: "sp" }) }),
      paragrafo: "uf-gov-aguardando",
      chamada: ["SP", "gov"] as const,
    },
    {
      nome: "/uf/[sigla]/senador",
      render: () => UFSenadorPage({ params: Promise.resolve({ sigla: "sp" }) }),
      paragrafo: "uf-sen-aguardando",
      chamada: ["SP", "sen"] as const,
    },
    {
      nome: "/uf/[sigla]/deputado-federal",
      render: () => UFDeputadoPage({ params: Promise.resolve({ sigla: "sp" }) }),
      paragrafo: "uf-dep-aguardando",
      chamada: ["SP", "dep"] as const,
    },
  ];

  for (const caso of casos) {
    it(`(j) ${caso.nome}: parágrafo primeiro, grade depois`, async () => {
      readCandidatosUfMock.mockResolvedValue(
        ok(slice({ uf: caso.chamada[0], cargo: caso.chamada[1] as never })),
      );

      const doc = parse(renderToStaticMarkup(await caso.render()));
      const aguardando = doc.querySelector(`[data-testid="${caso.paragrafo}"]`);
      const g = grade(doc);

      expect(aguardando).not.toBeNull();
      expect(g).not.toBeNull();
      expect(vemDepois(aguardando as Element, g as Element)).toBe(true);
      expect(doc.body.textContent).toContain("LULA");
    });

    it(`(k) ${caso.nome}: pede a fatia de ${caso.chamada[1]} em ${caso.chamada[0]}`, async () => {
      // Mutação que deve derrubá-lo: um `??`/ternário de cargo com default
      // silencioso, ou passar a UF de outra rota. Já mordeu três vezes.
      readCandidatosUfMock.mockResolvedValue(
        ok(slice({ uf: caso.chamada[0], cargo: caso.chamada[1] as never })),
      );
      await caso.render();
      expect(readCandidatosUfMock).toHaveBeenCalledWith(caso.chamada[0], caso.chamada[1]);
      expect(readCandidatosUfMock).toHaveBeenCalledTimes(1);
    });

    it(`(l) ${caso.nome}: Blob fora do ar deixa só o parágrafo`, async () => {
      readCandidatosUfMock.mockResolvedValue({
        status: "unavailable",
        reason: "fetch_error",
        url: null,
      });

      const doc = parse(renderToStaticMarkup(await caso.render()));
      expect(doc.querySelector(`[data-testid="${caso.paragrafo}"]`)).not.toBeNull();
      expect(grade(doc)).toBeNull();
      expect(doc.querySelector("main")?.querySelector("footer")).not.toBeNull();
    });
  }
});
