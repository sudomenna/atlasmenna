// @vitest-environment happy-dom
/**
 * tests/unit/pages/fase-pre-eleicao.test.tsx — spec 019, as quatro telas.
 *
 * Escrito a partir do texto dos RFs, não do código: cada `it` cita o RF e, onde
 * o design § D9 nomeia uma mutação, o id dela.
 *
 * ## Três regras que governam este arquivo
 *
 * 1. **Todo teste de supressão tem par em modo normal.** Suprimir é fácil de
 *    implementar e fácil de implementar demais; a regressão barata desta spec é
 *    apagar um painel na noite de 04/10 (M6).
 * 2. **Asserção negativa por `queryBy…` devolvendo `null`**, nunca
 *    `toBeEmptyDOMElement()` — um painel presente e vazio ocupa espaço, tem
 *    borda e tem título (M4).
 * 3. 🔴 **Um seletor que devolve `null` porque o nome está errado passa em
 *    qualquer asserção negativa.** Por isso {@link SELETORES_DOS_PAINEIS} é
 *    verificado **não-nulo em modo normal** antes de qualquer uso negativo, e
 *    essa verificação é um teste próprio.
 *
 * ## O limite da métrica do RF-161, e por que ele fica onde fica
 *
 * A varredura de vocabulário roda sobre o `<main>` de cada página, que é o que
 * estes testes renderizam. Ela **não** alcança `app/layout.tsx` — o shell, com
 * o segmentado "Parcial / Projeção", não faz parte do render de uma página.
 *
 * Isso não é só uma conveniência do harness: no browser, a palavra "Projeção"
 * continua no HTML **bruto** daquele controle mesmo em fase pré, porque
 * `SeloFasePreStyle` o esconde com `display: none` — o que o remove da
 * renderização e da árvore de acessibilidade, mas não do `innerHTML`. Não há
 * conserto dentro do desenho vigente: `app/layout.tsx` não pode ler a fase sem
 * tirar a home e as 54 páginas de UF do pré-render (ADR-0025 §§ 2 e 5). Em
 * e2e, meça sobre `<main>` / `innerText`, nunca sobre `page.content()`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  candidatosComProjecao,
  candidatosZerados,
  candidatoZerado,
  NOMES_PRESIDENCIAIS,
  payloadNormalApurando,
  payloadNormalPrimeiroBoletim,
  payloadNormalZerado,
  payloadPreEleicao,
} from "@/tests/fixtures/spec-019/payloads";

// ---------------------------------------------------------------------------
// Mocks de borda
// ---------------------------------------------------------------------------

const readNationalProjectionMock = vi.fn();
const readProjectionMock = vi.fn();
const readCandidatosUfMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  // Spec 026 (RF-265) — as telas de Deputado leem o interruptor da projeção a
  // cada render. Ausente = desligado (falha fechada), o estado de antes da virada.
  readInterruptorProjecao: vi.fn(async () => ({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  })),
  readProjection: (opts?: { cargo?: string; turno?: number }) => readProjectionMock(opts),
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  // 🔴 RF-163 — Deputado Federal **não é semeado**. O `null` aqui não é
  // preguiça de fixture: é o estado que a spec exige, e o ramo
  // `AguardandoNacional` é o que ela manda testar.
  readDeputadoProjection: vi.fn(async () => null),
}));

vi.mock("@/lib/blob/candidatos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/candidatos")>();
  return {
    ...real,
    readCandidatosUf: (uf: string, cargo: string) => readCandidatosUfMock(uf, cargo),
  };
});

import DeputadoFederalPage from "@/app/(dep)/deputado-federal/page";
import GovernadorPage from "@/app/(gov)/governador/page";
import HomePage from "@/app/(pres)/page";
import SenadoPage from "@/app/(sen)/senador/page";
import type { EdgeCandidate, EdgePayload } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function renderNode(node: Promise<React.ReactElement> | React.ReactElement) {
  return parse(renderToStaticMarkup(await node));
}

/** O `<main>` da página — o recorte sobre o qual a métrica do RF-161 é medida. */
function main(doc: Document): HTMLElement {
  const el = doc.querySelector("main");
  if (!el) throw new Error("a página não renderizou <main>");
  return el as HTMLElement;
}

/** Texto visível concatenado — o que o leitor lê, sem markup. */
function texto(doc: Document): string {
  return main(doc).textContent ?? "";
}

/** HTML do `<main>` — inclui `aria-label`, `title`, `alt` e legendas. */
function html(doc: Document): string {
  return main(doc).innerHTML;
}

async function pres(payload: EdgePayload | null) {
  readNationalProjectionMock.mockResolvedValue(payload);
  return renderNode(HomePage());
}

async function gov(payload: EdgePayload | null) {
  readProjectionMock.mockResolvedValue(payload);
  return renderNode(GovernadorPage({ searchParams: Promise.resolve({}) }));
}

async function sen(payload: EdgePayload | null) {
  readProjectionMock.mockResolvedValue(payload);
  return renderNode(SenadoPage());
}

async function dep() {
  readProjectionMock.mockResolvedValue(null);
  return renderNode(DeputadoFederalPage());
}

/**
 * Base pública do Blob no harness — mesmo override de
 * `tests/unit/components/ResultPanelAvatar.test.tsx`.
 *
 * `blobPublicBaseUrl()` resolve nesta ordem: `BLOB_PUBLIC_BASE_URL`, depois o
 * `storeId` embutido no `BLOB_READ_WRITE_TOKEN`, depois `null`. Em teste não há
 * token e o `vitest.config.ts` não carrega dotenv — então, sem a linha abaixo,
 * a resolução cai em `null`, `candidatoFotoUrl` devolve `null` e o
 * `<CandidateAvatar>` cai nas iniciais: nenhum `<img>` chega a ser renderizado.
 *
 * Isso quebra o bloco (G) nas DUAS direções, e a segunda é a que passa
 * despercebida:
 *
 *   1. as asserções que exigem foto falham — ruidoso, e portanto inofensivo;
 *   2. a asserção "(par)" que exige AUSÊNCIA de foto sem `sqcand` passaria
 *      VAZIA, medindo o ambiente em vez da regra. É o defeito de teste que não
 *      discrimina, e é a razão de o override morar aqui em cima, valendo para o
 *      arquivo inteiro, em vez de dentro do `describe` que hoje precisa dele:
 *      a próxima asserção sobre `<img>` escrita em qualquer outro bloco nasce
 *      medindo a regra, não o fallback.
 *
 * O override é o caminho previsto pelo próprio `lib/blob/paths.ts` ("o que os
 * testes usam"), não um atalho deste arquivo.
 */
const BLOB_BASE = "https://teste123.public.blob.vercel-storage.com";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BLOB_PUBLIC_BASE_URL = BLOB_BASE;
  readCandidatosUfMock.mockResolvedValue({
    status: "unavailable",
    reason: "not_configured",
    url: null,
  });
});

// ---------------------------------------------------------------------------
// RF-154 — os quatro painéis de medição
// ---------------------------------------------------------------------------

/**
 * Os quatro painéis do RF-154, cada um endereçado pelo nó que só ele emite.
 *
 * `StateGroupedTable` não tem `data-testid`; o `id` do `<h2>` dela é a única
 * âncora estável e é o mesmo que o `aria-describedby` do mapa aponta.
 */
const SELETORES_DOS_PAINEIS: ReadonlyArray<[string, string]> = [
  ["RemainingPanel", '[data-testid="remaining-nota"]'],
  ["ChancesPanel", '[data-testid="chances-panel-meters"]'],
  ["BulletinPanel", '[data-testid="bulletin-list"]'],
  ["StateGroupedTable", "#state-grouped-table-heading"],
];

describe("RF-154 — os quatro painéis de medição", () => {
  it("🔴 (controle) em modo NORMAL os quatro seletores devolvem NÃO-NULO", async () => {
    // Sem este controle, os quatro `queryBy… === null` do teste seguinte
    // passariam com qualquer nome de seletor inventado.
    const doc = await pres(payloadNormalApurando());
    for (const [nome, seletor] of SELETORES_DOS_PAINEIS) {
      expect(main(doc).querySelector(seletor), `${nome} (${seletor})`).not.toBeNull();
    }
  });

  it("(M4) em fase pré os quatro painéis NÃO EXISTEM no DOM", async () => {
    const doc = await pres(payloadPreEleicao());
    for (const [nome, seletor] of SELETORES_DOS_PAINEIS) {
      expect(main(doc).querySelector(seletor), `${nome} (${seletor})`).toBeNull();
    }
  });

  it("(M6) em modo normal ZERADO (sem `fase`) os quatro painéis continuam lá", async () => {
    // O par que impede a supressão de vazar para 04/10 pelo lado do payload
    // que mais se parece com um semeado: `pct: 0`, `por_uf: []`.
    const doc = await pres(payloadNormalPrimeiroBoletim());
    for (const [nome, seletor] of SELETORES_DOS_PAINEIS) {
      expect(main(doc).querySelector(seletor), `${nome} (${seletor})`).not.toBeNull();
    }
  });

  it("(M5) as quatro frases da tabela de mentiras não ocorrem no HTML em fase pré", async () => {
    // Asserção sobre o TEXTO, não sobre o componente: um refactor que mova a
    // frase para outro bloco deve derrubar o teste.
    const doc = await pres(payloadPreEleicao());
    const h = html(doc).toLowerCase();
    for (const frase of [
      "apuração concluída",
      "vence no 1º turno",
      "líder projetado",
      "combina apuração pendente",
    ]) {
      expect(h, frase).not.toContain(frase);
    }
  });

  it("(M5, controle) a frase de `RemainingPanel` de fato aparece quando ela deve", async () => {
    // Se nenhuma UF está pendente, o painel diz "apuração concluída". É o
    // caso #1 da tabela de mentiras, e ele precisa ser alcançável — senão a
    // asserção negativa acima não prova nada.
    const p = payloadNormalApurando();
    const doc = await pres({
      ...p,
      por_uf: p.por_uf.map((r) => ({ ...r, pct_apurado: 100 })),
      pct_apurado_total: 100,
      ufs_apuradas: 27,
    });
    expect(texto(doc).toLowerCase()).toContain("apuração concluída");
  });
});

// ---------------------------------------------------------------------------
// RF-155 — ResultPanel em modo identidade
// ---------------------------------------------------------------------------

describe("RF-155 — `ResultPanel` sem barra, sem margem, sem rank", () => {
  it("nenhum `<VoteBar>` existe em fase pré", async () => {
    const doc = await pres(payloadPreEleicao());
    expect(main(doc).querySelector('[data-testid="vote-bar"]')).toBeNull();
    expect(main(doc).querySelector('[data-testid="vote-bar-marker"]')).toBeNull();
  });

  it("(controle) em modo normal o `<VoteBar>` está lá", async () => {
    const doc = await pres(payloadNormalApurando());
    expect(main(doc).querySelector('[data-testid="vote-bar"]')).not.toBeNull();
  });

  it('as strings "pp", "Margem" e "+0,0" não ocorrem em fase pré', async () => {
    const doc = await pres(payloadPreEleicao());
    const h = html(doc);
    expect(h).not.toContain("Margem");
    expect(h).not.toContain("+0,0");
    // "pp" como palavra — evitar casar com `snappy`, `app` etc.
    expect(/\bpp\b/.test(texto(doc))).toBe(false);
    expect(main(doc).querySelector('[data-testid="result-margem-proj"]')).toBeNull();
    expect(main(doc).querySelector('[data-testid="result-margem-parcial"]')).toBeNull();
  });

  it("(controle) em modo normal margem e `pp` estão lá", async () => {
    const doc = await pres(payloadNormalApurando());
    expect(main(doc).querySelector('[data-testid="result-margem-proj"]')).not.toBeNull();
    expect(html(doc)).toContain("Margem");
  });

  it("nenhuma linha de candidatura exibe posição ordinal em fase pré", async () => {
    const doc = await pres(payloadPreEleicao());
    const linhas = [...main(doc).querySelectorAll('[data-testid="candidatura-identidade-row"]')];
    expect(linhas).toHaveLength(NOMES_PRESIDENCIAIS.length);
    for (const linha of linhas) {
      const t = (linha.textContent ?? "").trim();
      // Nem "1." nem "1º" nem um algarismo solto à esquerda do nome.
      expect(/^\s*\d+[.ºo)\s]/.test(t), t).toBe(false);
    }
    // E a lista não é `<ol>` — lista ordenada é anunciada com índice.
    const lista = main(doc).querySelector('[data-testid="result-identidade-lista"]');
    expect(lista).not.toBeNull();
    expect(lista?.tagName.toLowerCase()).toBe("ul");
  });

  it("(controle) em modo normal a lista de resultado é ordinal", async () => {
    const doc = await pres(payloadNormalApurando());
    expect(main(doc).querySelector('[data-testid="result-identidade-lista"]')).toBeNull();
    expect(main(doc).querySelector("ol")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RF-156 — RaceTypeIndicator na página
// ---------------------------------------------------------------------------

describe("RF-156 — a contagem vem de quem concorre", () => {
  it('em fase pré a home diz "Disputa entre 12 candidatos"', async () => {
    const doc = await pres(payloadPreEleicao());
    expect(texto(doc)).toContain(`Disputa entre ${NOMES_PRESIDENCIAIS.length} candidatos`);
  });

  it("(M7, na página) o mesmo array em modo normal produz número MENOR", async () => {
    const candidatos = candidatosComProjecao();
    const doc = await pres(payloadNormalApurando({ candidatos }));
    const acimaDoLimiar = candidatos.filter((c) => c.pct_projetado >= 0.5).length;
    expect(acimaDoLimiar).toBeLessThan(candidatos.length);
    expect(texto(doc)).toContain(`Disputa entre ${acimaDoLimiar} candidatos`);
    expect(texto(doc)).not.toContain(`Disputa entre ${candidatos.length} candidatos`);
  });
});

// ---------------------------------------------------------------------------
// RF-158 — ForecastTransparency
// ---------------------------------------------------------------------------

describe("RF-158 — o bloco que não some", () => {
  it("(M10) presente nas três telas semeadas em fase pré, sem fração, barra nem percentual", async () => {
    for (const doc of [
      await pres(payloadPreEleicao()),
      await gov(payloadPreEleicao({ cargo: 3 })),
      await sen(payloadPreEleicao({ cargo: 5 })),
    ]) {
      const bloco = main(doc).querySelector("#forecast-transparency-heading");
      expect(bloco).not.toBeNull();
      const secao = bloco?.closest("section");
      expect(secao).not.toBeNull();
      const corpo = secao?.textContent ?? "";
      expect(corpo).not.toMatch(/\d+([.,]\d+)?\s*%/);
      expect(corpo.toLowerCase()).not.toContain("apuração");
      expect(secao?.querySelector('[data-testid="vote-bar"]')).toBeNull();
      // Futuro, nunca presente.
      expect(corpo.toLowerCase()).toContain("quando");
    }
  });

  it("(RF-158, constituição § 8) `/deputado-federal` tem o bloco de metodologia dele", async () => {
    // ⚠️ **Divergência com a lista de componentes da spec**: esta rota NÃO
    // monta `<ForecastTransparency>` — ela tem `<DeputadoMetodologia>`, que é
    // o bloco equivalente do cargo 6 (a cadeira não é estimativa de modelo;
    // é a aritmética do ADR-0027 sobre voto apurado, e o § D9 da spec 017 é
    // literal: "a tela não pode chamar isso de projeção"). O princípio da
    // constituição § 8 é cumprido — por outro componente.
    const doc = await dep();
    expect(main(doc).querySelector("#forecast-transparency-heading")).toBeNull();
    expect(texto(doc).toLowerCase()).toContain("metodologia");
  });

  it("(controle) em modo normal a decomposição numérica volta", async () => {
    const doc = await pres(payloadNormalApurando());
    const secao = main(doc).querySelector("#forecast-transparency-heading")?.closest("section");
    expect(secao).not.toBeNull();
    expect(secao?.textContent ?? "").toMatch(/\d+([.,]\d+)?\s*%/);
  });
});

// ---------------------------------------------------------------------------
// RF-160 — a faixa
// ---------------------------------------------------------------------------

describe("RF-160 — a faixa é o primeiro filho do `<main>`", () => {
  const telas: Array<[string, () => Promise<Document>]> = [
    ["/ (Presidente)", () => pres(payloadPreEleicao())],
    ["/governador", () => gov(payloadPreEleicao({ cargo: 3 }))],
    ["/senador", () => sen(payloadPreEleicao({ cargo: 5 }))],
    ["/deputado-federal", () => dep()],
  ];

  for (const [rota, render] of telas) {
    it(`(M12) ${rota}: a faixa é \`firstElementChild\` do \`<main>\``, async () => {
      const doc = await render();
      const primeiro = main(doc).firstElementChild;
      expect(primeiro, rota).not.toBeNull();
      expect(primeiro?.getAttribute("data-testid"), rota).toBe("fase-pre-eleicao-banner");
    });

    it(`(M13) ${rota}: \`<section aria-labelledby>\`, sem \`role="alert"\` e sem foco`, async () => {
      const doc = await render();
      const faixa = main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]');
      expect(faixa, rota).not.toBeNull();
      expect(faixa?.tagName.toLowerCase()).toBe("section");
      expect(faixa?.getAttribute("aria-labelledby")).toBeTruthy();
      const rotuloId = faixa?.getAttribute("aria-labelledby") ?? "";
      expect(
        doc.getElementById(rotuloId),
        "o `aria-labelledby` aponta para nó existente",
      ).not.toBeNull();
      expect(faixa?.getAttribute("role")).toBeNull();
      expect(main(doc).querySelector('[role="alert"]')).toBeNull();
      // Nenhum controle: nem botão de fechar, nem `tabindex`, nem link.
      expect(faixa?.querySelector('button, a, [tabindex], input, [role="button"]')).toBeNull();
    });

    /**
     * ⚠️ **Emenda de 2026-09-14 — a data é comum, a afirmação NÃO.**
     *
     * O teste original exigia "ainda não começou" nas quatro rotas. Isso estava
     * certo para as três telas **semeadas**, cujo payload traz o campo de fase,
     * e errado para `/deputado-federal`: aquele ramo não tem payload nenhum e é
     * alcançado tanto antes de 04/10 quanto durante uma queda do Global Config.
     * Afirmar ali um fato sobre o calendário é transformar falha de rede em
     * declaração sobre o mundo — a armadilha do RNF-010.
     *
     * O que é comum às quatro: a data por extenso e a ausência do vocabulário
     * de máquina. O que diverge está no teste dedicado, logo abaixo, que mede os
     * dois lados sobre o mesmo componente — porque um teste só do ramo de espera
     * passaria com a frase removida de vez.
     */
    it(`${rota}: a faixa traz a data e não fala como máquina`, async () => {
      const doc = await render();
      const t =
        main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]')?.textContent ?? "";
      expect(t).toContain("4 de outubro de 2026");
      for (const palavra of ["aguardando", "carregando", "em breve"]) {
        expect(t.toLowerCase(), palavra).not.toContain(palavra);
      }
    });
  }

  /**
   * 🔴 **A afirmação de calendário só aparece onde ela foi medida.**
   *
   * Os dois lados, sobre o mesmo componente, no mesmo teste — de propósito. Só
   * o lado negativo passaria com a frase apagada do componente inteiro; só o
   * positivo passaria com a frase incondicional, que é o estado de 13/09.
   */
  it('(C) "a eleição ainda não começou" só nas telas SEMEADAS, nunca no ramo de espera', async () => {
    const faixa = (doc: Document) =>
      (
        main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]')?.textContent ?? ""
      ).toLowerCase();

    // Semeadas — o payload AFIRMA a fase, então a tela pode afirmá-la também.
    for (const [rota, doc] of [
      ["/", await pres(payloadPreEleicao())],
      ["/governador", await gov(payloadPreEleicao({ cargo: 3 }))],
      ["/senador", await sen(payloadPreEleicao({ cargo: 5 }))],
    ] as Array<[string, Document]>) {
      expect(faixa(doc), rota).toContain("a eleição ainda não começou");
      expect(faixa(doc), rota).not.toContain("não recebeu dados");
    }

    // Ramo de espera — ninguém mediu nada, então a tela fala sobre si mesma.
    const espera = await dep();
    expect(faixa(espera)).toContain("não recebeu dados de apuração");
    expect(faixa(espera)).not.toContain("ainda não começou");
    // E a data continua lá: o fato de calendário é verdadeiro em qualquer dia,
    // o que ele não pode é ser apresentado como CAUSA de não termos dados.
    expect(faixa(espera)).toContain("4 de outubro de 2026");
  });

  it("em fase normal a faixa não existe no DOM em rota nenhuma", async () => {
    for (const doc of [
      await pres(payloadNormalApurando()),
      await pres(payloadNormalZerado()),
      await gov(payloadNormalApurando({ cargo: 3 })),
      await sen(payloadNormalApurando({ cargo: 5 })),
    ]) {
      expect(main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]')).toBeNull();
    }
  });

  it("(RF-163) em `/deputado-federal` a faixa está ACIMA do parágrafo honesto, que continua lá", async () => {
    const doc = await dep();
    const faixa = main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]');
    const paragrafo = main(doc).querySelector('[data-testid="dep-aguardando"]');
    expect(faixa).not.toBeNull();
    expect(paragrafo).not.toBeNull();
    expect(paragrafo?.textContent ?? "").toContain("Aguardando o primeiro boletim");
    // `compareDocumentPosition` devolve uma máscara de bits; `FOLLOWING` é
    // "o argumento vem DEPOIS do nó", que é exatamente a ordem exigida.
    const posicao = (faixa as Element).compareDocumentPosition(paragrafo as Element);
    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// RF-161 — a lista negra de vocabulário e a ordem
// ---------------------------------------------------------------------------

/**
 * A lista negra do RF-161, varrida sobre o **HTML** do `<main>` — `aria-label`,
 * `title` e legenda incluídos, que é por onde a palavra vaza sem revisão.
 *
 * `projeç`/`projec` é medida à parte porque tem UMA exceção registrada: o bloco
 * do RF-158.
 */
const VOCABULARIO_DE_MEDICAO = [
  "apurado",
  "apuradas",
  "boletim",
  "intervalo de confiança",
  "chance de",
];

/** Remove do HTML a única superfície onde "projeção" é autorizada (RF-158). */
function semBlocoDeTransparencia(doc: Document): string {
  const clone = main(doc).cloneNode(true) as HTMLElement;
  for (const h of [...clone.querySelectorAll("#forecast-transparency-heading")]) {
    h.closest("section")?.remove();
  }
  return clone.innerHTML;
}

describe("RF-161 — vocabulário de medição e ordem das candidaturas", () => {
  /**
   * As **três telas semeadas**. `/deputado-federal` fica fora e tem teste
   * próprio, abaixo — ver a divergência registrada lá.
   */
  const telas: Array<[string, () => Promise<Document>]> = [
    ["/ (Presidente)", () => pres(payloadPreEleicao())],
    ["/governador", () => gov(payloadPreEleicao({ cargo: 3 }))],
    ["/senador", () => sen(payloadPreEleicao({ cargo: 5 }))],
  ];

  for (const [rota, render] of telas) {
    it(`(M14) ${rota}: "projeç"/"projec" ocorre ZERO vezes fora do bloco do RF-158`, async () => {
      const doc = await render();
      const fora = semBlocoDeTransparencia(doc).toLowerCase();
      expect(fora, rota).not.toContain("projeç");
      expect(fora, rota).not.toContain("projec");
    });

    it(`${rota}: a lista negra de medição não ocorre`, async () => {
      const doc = await render();
      const fora = semBlocoDeTransparencia(doc).toLowerCase();
      for (const palavra of VOCABULARIO_DE_MEDICAO) {
        expect(fora, `${rota} — "${palavra}"`).not.toContain(palavra);
      }
    });
  }

  /**
   * 🔴 **Divergência registrada — `/deputado-federal` NÃO cumpre o RF-161.**
   *
   * O RF-161 diz "nenhuma das **quatro** telas em fase pré", e T-16 inclui
   * `/deputado-federal`. Mas o RF-163, mais específico, manda o parágrafo
   * `dep-aguardando` continuar "presente e **não reescrito**" — e ele começa
   * com "Aguardando o primeiro **boletim**". Os dois RFs da mesma spec se
   * contradizem sobre a mesma tela.
   *
   * ✅ **Emenda de 2026-09-14.** Eram quatro ocorrências e uma delas não tinha
   * defesa nenhuma: 🔴 "Nenhum estado apurado ainda", no painel "Corridas
   * estaduais". Ela **saiu** — no lugar ficaram os 27 links, pela regra da
   * própria spec: progresso é medição e cala, geografia é identidade e fala.
   * Restaram três, todas com defesa nomeada abaixo.
   *
   * Este teste **não** abençoa as três — ele as congela: a contagem é exata,
   * então qualquer palavra nova da lista negra que apareça nesta rota derruba
   * o teste, e o retorno da que saiu também.
   */
  it("(divergência) `/deputado-federal`: as ocorrências da lista negra são exatamente estas três", async () => {
    const doc = await dep();
    const h = html(doc).toLowerCase();
    const contagem = (p: string) => h.split(p).length - 1;

    // (1) protegida pelo RF-163 — o parágrafo não pode ser reescrito.
    expect(contagem("boletim")).toBe(1);
    expect(
      (main(doc).querySelector('[data-testid="dep-aguardando"]')?.textContent ?? "").toLowerCase(),
    ).toContain("boletim");

    // (2) e (3) dentro de `<DeputadoMetodologia>` — o bloco equivalente ao do
    // RF-158, onde a palavra "projeção" é autorizada. Aqui ela aparece como
    // NEGAÇÃO ("não são uma projeção"), que é o oposto de afirmar medição.
    expect(contagem("projeç")).toBe(1);
    expect(h).toContain("não são uma projeção");

    // (3) — "apurado" UMA vez, dentro de `<DeputadoMetodologia>` ("votos já
    // apurados"), pelo mesmo argumento do item anterior: descreve o MÉTODO
    // desta tela, que é verdadeiro em qualquer dia do calendário.
    //
    // ⚠️ **Este número era 2 até 2026-09-14, e a segunda ocorrência saiu.**
    // Era "Com 0% apurado, ela ainda muda" — a única frase deste bloco que
    // carrega um NÚMERO, imprimindo o `pctApurado={0}` que a página passa por
    // falta de coisa melhor. Sem payload esse zero não foi medido: não
    // sabemos se a apuração está parada em zero ou se a leitura do Global
    // Config falhou com a contagem em curso. O teste foi corrigido porque o
    // CÓDIGO ficou mais honesto, não o contrário — a asserção negativa logo
    // abaixo é o que impede a frase de voltar.
    //
    // 🔴 A terceira ocorrência — "Nenhum estado apurado ainda", no painel
    // "Corridas estaduais" — saiu mais cedo no mesmo dia. Ela era a única
    // desta rota fora dos dois blocos protegidos, e era o placar de um
    // processo que este ramo não sabe nem se começou.
    expect(contagem("apurado")).toBe(1);
    expect(h).not.toContain("nenhum estado apurado ainda");
    // A frase com o percentual, nomeada pelo que ela tem de errado: o número.
    expect(h).not.toContain("ela ainda muda");
    expect(h, "nenhum percentual em `/deputado-federal` sem payload").not.toContain("%");
    // E o que ficou no lugar dela: os 27 estados como links.
    expect(main(doc).querySelectorAll('[data-testid="uf-links-grid-item"]').length).toBe(27);

    // O que NÃO sobrevive, e continua não podendo aparecer:
    for (const palavra of ["intervalo de confiança", "chance de", "apuradas"]) {
      expect(h, palavra).not.toContain(palavra);
    }
  });

  it("(M14, controle) em modo normal a palavra volta a ocorrer", async () => {
    const doc = await pres(payloadNormalApurando());
    expect(semBlocoDeTransparencia(doc).toLowerCase()).toContain("projeç");
    expect(semBlocoDeTransparencia(doc).toLowerCase()).toContain("apurado");
  });

  it('o `<h1>` em fase pré diz "Quem está concorrendo", nunca "Apuração" nem "Resultado"', async () => {
    for (const [rota, doc] of [
      ["/", await pres(payloadPreEleicao())],
      ["/governador", await gov(payloadPreEleicao({ cargo: 3 }))],
      ["/senador", await sen(payloadPreEleicao({ cargo: 5 }))],
    ] as Array<[string, Document]>) {
      const h1 = main(doc).querySelector("h1");
      expect(h1, rota).not.toBeNull();
      const t = h1?.textContent ?? "";
      expect(t, rota).toContain("Quem está concorrendo");
      expect(t.toLowerCase(), rota).not.toContain("apuração");
      expect(t.toLowerCase(), rota).not.toContain("resultado");
    }
  });

  it("a `note` do `ResultPanel` explica que a lista é de registro e que ninguém votou", async () => {
    const doc = await pres(payloadPreEleicao());
    const t = texto(doc).toLowerCase();
    expect(t).toContain("candidaturas registradas");
    expect(t).toContain("nenhum voto foi contado");
  });

  it("(M15) a ordem é por NÚMERO NA URNA, crescente — e o payload chega desordenado", async () => {
    // O payload nacional chega ordenado por `pct_projetado` desc; com todo
    // mundo em zero essa ordem é a do desempate, que o leitor lê como ranking.
    const desordenado = candidatosZerados();
    expect(desordenado[0]?.id).toBeGreaterThan(desordenado[2]?.id ?? 0);

    const doc = await pres(payloadPreEleicao({ candidatos: desordenado }));
    // Cada linha é identificada pelo NÚMERO da candidatura que ela nomeia —
    // asserção sobre a ordem observável, não sobre o array de entrada.
    const numeros = [
      ...main(doc).querySelectorAll('[data-testid="candidatura-identidade-row"]'),
    ].map((l) => NOMES_PRESIDENCIAIS.find(([, nome]) => (l.textContent ?? "").includes(nome))?.[0]);
    const crescente = NOMES_PRESIDENCIAIS.map(([n]) => n).sort((a, b) => a - b);
    expect(numeros).toEqual(crescente);
  });

  it("(M15) a ordem é ESTÁVEL entre renders", async () => {
    const primeira = await pres(payloadPreEleicao());
    const segunda = await pres(payloadPreEleicao());
    const ordem = (d: Document) =>
      [...main(d).querySelectorAll('[data-testid="candidatura-identidade-row"]')].map(
        (l) => l.textContent,
      );
    expect(ordem(primeira)).toEqual(ordem(segunda));
  });

  it("(controle) em modo normal a ordem volta a ser a do payload (`pct_projetado`)", async () => {
    const candidatos = candidatosComProjecao();
    const doc = await pres(payloadNormalApurando({ candidatos }));
    const linhas = [...main(doc).querySelectorAll("ol > li")];
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas[0]?.textContent ?? "").toContain(candidatos[0]?.nome ?? "—");
  });
});

// ---------------------------------------------------------------------------
// RF-162 / RF-163 — as três telas sem grade
// ---------------------------------------------------------------------------

describe("RF-162 / RF-163 — 27 links, nenhum nome", () => {
  const telas: Array<[string, () => Promise<Document>]> = [
    ["/governador", () => gov(payloadPreEleicao({ cargo: 3, candidatos: candidatosZerados() }))],
    ["/senador", () => sen(payloadPreEleicao({ cargo: 5, candidatos: candidatosZerados() }))],
    ["/deputado-federal", () => dep()],
  ];

  for (const [rota, render] of telas) {
    it(`(M16) ${rota}: exatamente 27 links de UF`, async () => {
      const doc = await render();
      const itens = [...main(doc).querySelectorAll('[data-testid="uf-links-grid-item"]')];
      expect(itens, rota).toHaveLength(27);
      const siglas = itens.map((a) => a.getAttribute("data-sigla"));
      expect(new Set(siglas).size, rota).toBe(27);
      for (const a of itens) {
        expect(a.getAttribute("href"), rota).toMatch(/^\/uf\/[A-Z]{2}(\/[a-z-]+)?$/);
        // RNF-023: o nome da UF em texto, não só a sigla.
        expect((a.textContent ?? "").trim().length, rota).toBeGreaterThan(3);
      }
      // RNF-024: lista semântica navegável por teclado, em ordem de documento.
      expect(main(doc).querySelector('[data-testid="uf-links-grid"] ul'), rota).not.toBeNull();
    });

    it(`(M16 🔴) ${rota}: NENHUM nome de candidatura no documento`, async () => {
      const doc = await render();
      const h = html(doc);
      for (const [, nome] of NOMES_PRESIDENCIAIS) {
        expect(h, `${rota} — ${nome}`).not.toContain(nome);
      }
    });
  }

  it("(RF-163) o semeador não alimenta `/deputado-federal`: a tela continua sem payload", async () => {
    // Se algum dia a tela de Deputado passar a receber payload semeado, ela
    // sai deste ramo e este teste cai — que é o alarme certo.
    const doc = await dep();
    expect(main(doc).querySelector('[data-testid="dep-aguardando"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 (A) O ramo de espera de `/governador` e `/senador` — emenda de 2026-09-14
// ---------------------------------------------------------------------------

/**
 * ## O defeito que este bloco fecha
 *
 * Até 13/09 estas duas páginas, quando o reader devolvia `null`, fabricavam um
 * `EdgePayload` **estruturalmente completo e cheio de zeros** (`emptyPayload()`)
 * e o renderizavam como se fosse resultado. Em produção, hoje, sem aviso: "Todas
 * as unidades federativas estão com a apuração concluída" e "Nenhuma UF se
 * encaixa no filtro Todas no momento" — as mentiras nº 1 e nº 10 da tabela do
 * design 019 § D2. Era a única superfície desta spec que **regredia de fato**.
 *
 * ## A forma da asserção, e por que ela é negativa
 *
 * A positiva ("o texto de espera está lá") passaria com o placar zerado logo
 * abaixo — foi exatamente essa a lição dos RF-140/RF-145 da spec 018. O que
 * discrimina é a ausência de **número**: todo zero fabricado chega à tela como
 * um `0` solto ("0 corridas", "0 de 27") ou como percentual ("0,0%",
 * "Apuração 0%"), e nenhum dos dois sobrevive às duas varreduras abaixo.
 *
 * 🔴 **Anti-vácuo**: as três varreduras têm controle positivo em modo normal,
 * no último `it` deste bloco. Um seletor com o nome errado devolve vazio e
 * passa em qualquer asserção negativa — foi assim que um teste desta base
 * passou sem provar nada.
 */
const SEM_PAYLOAD: ReadonlyArray<[string, () => Promise<Document>]> = [
  ["/governador", () => gov(null)],
  ["/senador", () => sen(null)],
];

/** Percentuais — a forma mais comum do zero fabricado. */
function temPercentual(doc: Document): boolean {
  return html(doc).includes("%");
}

/**
 * Zeros que não fazem parte de outro número: "0%", "0,0", "0 de 27". Não casa
 * com "2026", "100%" nem "27".
 *
 * ⚠️ **Não** usa `\b`. `textContent` concatena nós vizinhos sem espaço, e o
 * rótulo do bloco de transparência chega como a string `"Apuração0%"` — ali o
 * caractere antes do zero é uma LETRA, que é word char, e `\b0\b` não casa.
 * Uma varredura assim passaria em silêncio exatamente sobre o zero fabricado
 * que ela existe para achar. O controle no fim deste bloco é o que pegou isso.
 */
function zerosSoltos(doc: Document): string[] {
  return [...texto(doc).matchAll(/(?<!\d)0(?!\d)/g)].map((m) => m[0]);
}

describe("(A) sem payload, `/governador` e `/senador` não mostram número nenhum", () => {
  for (const [rota, render] of SEM_PAYLOAD) {
    it(`${rota}: nenhum percentual e nenhum zero solto no documento`, async () => {
      const doc = await render();
      expect(temPercentual(doc), `${rota} — percentual na tela`).toBe(false);
      expect(zerosSoltos(doc), `${rota} — zero fabricado na tela`).toEqual([]);
    });

    it(`${rota}: as duas frases do \`emptyPayload()\` não ocorrem`, async () => {
      const doc = await render();
      const t = texto(doc).toLowerCase();
      expect(t, rota).not.toContain("apuração concluída");
      expect(t, rota).not.toContain("se encaixa no filtro");
    });

    it(`${rota}: a estrutura fica de pé — a página não some (constituição § 3)`, async () => {
      const doc = await render();
      expect(main(doc).querySelectorAll("h1").length, rota).toBe(1);
      expect(main(doc).querySelector("footer"), rota).not.toBeNull();
      // Geografia é identidade e fala: os 27 estados, que são verdadeiros em
      // qualquer dia do calendário.
      expect(main(doc).querySelectorAll('[data-testid="uf-links-grid-item"]').length, rota).toBe(
        27,
      );
    });

    it(`${rota}: a faixa é o primeiro filho e NÃO afirma causa que não medimos`, async () => {
      const doc = await render();
      const faixa = main(doc).firstElementChild;
      expect(faixa?.getAttribute("data-testid"), rota).toBe("fase-pre-eleicao-banner");
      const t = (faixa?.textContent ?? "").toLowerCase();
      expect(t, rota).toContain("não recebeu dados de apuração");
      // 🔴 A armadilha nomeada no RNF-010: fazer o fallback carregar o campo de
      // fase teria sido a correção mais curta, e transformaria falha de rede em
      // afirmação sobre o calendário.
      expect(t, rota).not.toContain("ainda não começou");
      // O fato de calendário continua lá — o que ele não pode é virar a CAUSA.
      expect(faixa?.textContent, rota).toContain("4 de outubro de 2026");
    });
  }

  it("🔴 (controle) o payload que o `emptyPayload()` produzia dispara TODAS as varreduras", async () => {
    // Este é o controle que vale: `payloadNormalZerado` é, campo a campo, o que
    // o `emptyPayload()` apagado montava — `pct_apurado_total: 0`, `por_uf: []`,
    // sem `fase`. Se alguém o ressuscitar, é exatamente este render que a página
    // volta a produzir, e as quatro asserções abaixo são as que ficariam
    // vermelhas do outro lado.
    //
    // Sem este controle, um seletor com nome errado ou uma regex que nunca casa
    // fariam o bloco inteiro acima passar sem olhar nada.
    const comoEra = await gov(payloadNormalZerado({ cargo: 3 }));

    expect(temPercentual(comoEra), "o fallback estrutural imprimia percentual").toBe(true);
    expect(zerosSoltos(comoEra).length, "e imprimia zero solto").toBeGreaterThan(0);
    expect(texto(comoEra).toLowerCase(), "a mentira nº 10, literal").toContain(
      "se encaixa no filtro",
    );
    expect(main(comoEra).querySelectorAll('[data-testid="governador-filtro"]').length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 🔴 (B) Os quatro ramos de espera — emenda de 2026-09-14
// ---------------------------------------------------------------------------

/**
 * ## Os três últimos lugares onde uma tela sem dado fabricava um número
 *
 * O bloco (A) acima fechou `/governador` e `/senador`. Sobraram três:
 *
 * | # | onde | o que era impresso |
 * |---|---|---|
 * | 1 | `AguardandoNacional` da home | `<ForecastTransparency pctApurado={0}>` publicava a decomposição: **"Modelo 100% / Apuração 0%"** |
 * | 2 | `AguardandoNacional` de `/deputado-federal` | `<DeputadoMetodologia>` dizia **"Com 0% apurado, ela ainda muda"** |
 * | 3 | `AguardandoNacional` da home | era a única das quatro telas de cargo **sem faixa nenhuma** no ramo de espera |
 *
 * ## A forma da asserção do item 1, e por que ela tem DOIS lados
 *
 * Houve uma dúvida legítima sobre se o bloco de transparência era obrigatório
 * num ramo sem payload: a constituição
 * [§ 8](../../../docs/constitution.md#8-transparência-metodológica) o exige "em
 * toda página com **projeção**", e uma página sem payload não tem projeção. A
 * decisão do dono foi **satisfazer as duas leituras** — o bloco fica na tela e
 * vai a prosa.
 *
 * Por isso cada teste abaixo afirma as duas coisas juntas:
 *
 *   - **presença** do bloco — sozinha, ela passa com "Apuração 0%" na tela;
 *   - **zero número** no documento — sozinha, ela passa com o bloco apagado.
 *
 * Só as duas juntas descrevem o estado que a emenda produziu.
 *
 * 🔴 **Anti-vácuo.** Um seletor com nome errado devolve `null` e passa em
 * qualquer asserção negativa; uma regex que nunca casa passa em qualquer
 * varredura. Os dois controles positivos deste bloco rodam **sobre as mesmas
 * rotas** com um payload que TEM número, e exigem que o seletor devolva
 * não-nulo e que a varredura de zero ache o zero.
 */
const ESPERA_COM_BLOCO: ReadonlyArray<[string, () => Promise<Document>]> = [
  ["/ (Presidente)", () => pres(null)],
  ["/governador", () => gov(null)],
  ["/senador", () => sen(null)],
];

/** O `<section>` do bloco de transparência, ou `null`. */
function blocoDeTransparencia(doc: Document): HTMLElement | null {
  const h3 = main(doc).querySelector("#forecast-transparency-heading");
  return (h3?.closest("section") as HTMLElement | null) ?? null;
}

describe("(B) o bloco de transparência nos ramos de espera (constituição § 8)", () => {
  for (const [rota, render] of ESPERA_COM_BLOCO) {
    it(`${rota}: o bloco ESTÁ na tela E o documento não tem número nenhum`, async () => {
      const doc = await render();

      // Lado 1 — o bloco não some. Mutação que derruba: apagar o
      // `<ForecastTransparency>` do ramo de espera.
      const secao = blocoDeTransparencia(doc);
      expect(secao, `${rota} — o bloco de transparência sumiu`).not.toBeNull();

      // Lado 2 — e não trouxe número junto. Mutação que derruba: voltar a
      // `<ForecastTransparency pctApurado={0} />` sem prosa.
      expect(temPercentual(doc), `${rota} — percentual na tela`).toBe(false);
      expect(zerosSoltos(doc), `${rota} — zero fabricado na tela`).toEqual([]);
      // E nem um dígito dentro do próprio bloco: "100", "0", "1º" — nada.
      expect(secao?.textContent ?? "", `${rota} — dígito dentro do bloco`).not.toMatch(/\d/);
    });

    it(`${rota}: a prosa é a do estado "não sabemos", não a do calendário`, async () => {
      const doc = await render();
      const p = main(doc).querySelector('[data-testid="forecast-transparency-pre"]');

      expect(p, `${rota} — o ramo de prosa não renderizou`).not.toBeNull();
      expect(p?.getAttribute("data-variante"), rota).toBe("sem_dados");

      const t = (p?.textContent ?? "").toLowerCase();
      // 🔴 A afirmação que este ramo não pode fazer: ele é alcançado tanto
      // antes de 04/10 quanto por uma queda do Global Config às 21h daquele
      // dia, e a tela não distingue os dois. Mutação que derruba: passar
      // `variante="nao_comecou"` (ou omitir a prop) no ramo de espera.
      expect(t, `${rota} — afirma uma causa que não medimos`).not.toContain(
        "nenhum voto foi contado",
      );
      // O que ele PODE dizer: o que sabemos de nós, e o futuro.
      expect(t, rota).toContain("não receber dado nenhum");
      expect(t, rota).toContain("quando");
    });
  }

  it("🔴 (controle) na home com payload, o seletor devolve NÃO-NULO e a varredura ACHA o zero", async () => {
    // Sem este controle, os dois testes acima passariam com `#forecast-
    // transparency-heading` escrito errado (o `closest` devolveria `null` e a
    // asserção de dígito receberia string vazia) e com uma regex de zero que
    // nunca casa. `payloadNormalZerado` é, campo a campo, o que a decomposição
    // numérica recebia: ele tem candidaturas, então a home vai para o fluxo
    // normal e o bloco volta a imprimir "Modelo 100% / Apuração 0%".
    const comNumero = await pres(payloadNormalZerado());

    const secao = blocoDeTransparencia(comNumero);
    expect(secao, "o seletor do bloco não acha o bloco nem quando ele existe").not.toBeNull();
    expect(secao?.textContent ?? "", "o bloco numérico não tem dígito?").toMatch(/\d/);
    expect(temPercentual(comNumero), "a varredura de percentual não vê o percentual").toBe(true);
    expect(zerosSoltos(comNumero).length, "a varredura de zero não vê o zero").toBeGreaterThan(0);
  });

  it("🔴 (controle) a varredura de zero acha o zero DENTRO do bloco, colado na letra", async () => {
    // A armadilha medida nesta spec: `textContent` concatena nós vizinhos sem
    // espaço e o rótulo chega como "Apuração0%". O caractere antes do zero é
    // uma LETRA — word char —, então `\b0\b` NÃO casa e a varredura passa em
    // silêncio exatamente sobre o zero que ela existe para achar.
    const comNumero = await pres(payloadNormalZerado());
    const corpo = blocoDeTransparencia(comNumero)?.textContent ?? "";

    expect(corpo, "o rótulo colado não está mais nesta forma").toContain("Apuração0%");
    expect(/\b0\b/.test(corpo), "🔴 `\\b0\\b` casaria — a armadilha sumiu, reveja a regex").toBe(
      false,
    );
    expect([...corpo.matchAll(/(?<!\d)0(?!\d)/g)].length, "a regex boa acha").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (C) A faixa da home no ramo de espera — RF-160
// ---------------------------------------------------------------------------

describe("(C) `/` em espera: a faixa é o primeiro filho do `<main>`", () => {
  it("a faixa é `firstElementChild`, antes do kicker e do `<h1>`", async () => {
    // Teste de ORDEM, não de presença: `/` era a única das quatro telas de
    // cargo sem aviso nenhum neste ramo. Mutações que derrubam: não montar a
    // faixa; montá-la depois do `<TrilhaKicker>`; montá-la dentro do `<Panel>`.
    const doc = await pres(null);
    const faixa = main(doc).firstElementChild;

    expect(faixa?.getAttribute("data-testid")).toBe("fase-pre-eleicao-banner");
    // O parágrafo honesto continua abaixo dela, não no lugar dela.
    expect(main(doc).querySelector('[data-testid="pres-aguardando"]')).not.toBeNull();
  });

  it('a faixa diz "sem dados" e NÃO "ainda não começou"', async () => {
    const doc = await pres(null);
    const faixa = main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]');
    const p = faixa?.querySelector('[data-testid="fase-pre-eleicao-texto"]');

    expect(p?.getAttribute("data-variante")).toBe("sem_dados");

    const t = (faixa?.textContent ?? "").toLowerCase();
    expect(t).toContain("não recebeu dados de apuração");
    // 🔴 Mutação que derruba: omitir `variante` (o default é `"nao_comecou"`)
    // ou passá-la como `"nao_comecou"`. Sem esta asserção, a de presença acima
    // passaria com a faixa afirmando um fato de calendário que não medimos.
    expect(t).not.toContain("ainda não começou");
    // O fato de calendário fica — o que ele não pode é virar a CAUSA.
    expect(faixa?.textContent).toContain("4 de outubro de 2026");
  });

  it("🔴 a faixa NÃO promete uma lista de estados que a home não tem", async () => {
    // A redação de `"sem_dados"` estreou nas três telas que montam
    // `<UfLinksGrid>` logo abaixo, e terminava — sem condição — em "abaixo
    // estão os estados". Ao alcançar a home em 2026-09-14 a oração viria
    // junto, e ali ela é FALSA: o ramo de espera da home tem a grade de
    // candidaturas e nenhum estado.
    //
    // Mutação que derruba: `listaDeEstadosAbaixo = true` como default do
    // componente, ou a oração de volta incondicional.
    const home = await pres(null);
    const faixaHome = main(home).querySelector('[data-testid="fase-pre-eleicao-banner"]');

    expect(faixaHome?.textContent ?? "").not.toContain("abaixo estão os estados");
    expect(main(home).querySelectorAll('[data-testid="uf-links-grid-item"]')).toHaveLength(0);
  });

  it("🔴 (controle) onde os estados EXISTEM, a faixa continua prometendo-os", async () => {
    // Sem este par, a asserção negativa acima passaria com a oração apagada de
    // vez — e as três telas que de fato têm os 27 links perderiam a frase que
    // diz ao leitor o que ele está vendo no lugar do placar.
    const g = await gov(null);
    const faixaGov = main(g).querySelector('[data-testid="fase-pre-eleicao-banner"]');

    expect(faixaGov?.textContent ?? "").toContain("abaixo estão os estados");
    expect(main(g).querySelectorAll('[data-testid="uf-links-grid-item"]')).toHaveLength(27);
  });

  it("🔴 (controle) o seletor da faixa acha a faixa quando ela é a outra", async () => {
    // Prova que `[data-testid="fase-pre-eleicao-banner"]` não é um nome
    // inventado e que a asserção negativa acima discrimina: na home SEMEADA a
    // mesma faixa existe e diz exatamente a frase proibida no ramo de espera.
    const doc = await pres(payloadPreEleicao());
    const faixa = main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]');

    expect(faixa).not.toBeNull();
    expect((faixa?.textContent ?? "").toLowerCase()).toContain("ainda não começou");
  });
});

// ---------------------------------------------------------------------------
// 🔴 (D) O que cada rota publica ao SHELL — emenda de 2026-09-14
// ---------------------------------------------------------------------------

/**
 * ## O defeito que este bloco fecha
 *
 * `<SeloFasePreStyle>` publicava **quatro** custom properties num pacote só, e
 * elas não são a mesma coisa: três afirmam ("o selo existe", o rótulo "antes da
 * votação", o `sr-only` "A eleição ainda não começou") e a quarta apenas apaga
 * o segmentado "Parcial / Projeção", que sem dado alterna entre duas vistas
 * idênticas.
 *
 * Como saíam juntas, **cada rota acertava metade**: `/governador`, `/senador` e
 * `/deputado-federal` escondiam o controle e afirmavam a causa; a home não
 * afirmava nada e era a única em que o controle aparecia sem dado por trás.
 *
 * A regra do dono é que a tela nunca afirme uma causa que não mediu. Um ramo de
 * espera significa "não recebemos dados", que às 21h de 04/10 pode ser falha de
 * rede — a faixa dentro do `<main>` já se recusava a dizer aquela frase, e o
 * selo, uma camada acima, continuava dizendo a MESMA frase na MESMA tela.
 *
 * ## Por que a medição é na PÁGINA e não no componente
 *
 * 🔴 O defeito era de **fiação** — qual variante cada chamador passa. Um teste
 * só sobre `<SeloFasePreStyle>` isolado (existe, em `ShellLiveBadge.test.tsx`)
 * passa com as quatro rotas fiadas erradas. O que discrimina é ler as regras
 * `:root { … }` que **a página** emite.
 *
 * ## Por que o par semeado é obrigatório
 *
 * As asserções do ramo de espera são todas negativas, e três negativas passam
 * com a variante `"nao_comecou"` apagada do componente de vez. O par semeado
 * exige as quatro propriedades de volta onde a fase **foi** medida.
 */

/** As regras `:root { … }` que a página publica — de dentro do `<main>`. */
function declaracoes(doc: Document): string {
  return [...main(doc).querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
}

/** As três que AFIRMAM. A quarta, `--shell-viewmode-display`, não afirma nada. */
const PROPRIEDADES_DO_SELO = ["--live-badge-display", "--live-pct-label", "--live-sr-pre"] as const;

const ESPERA_SHELL: ReadonlyArray<[string, () => Promise<Document>]> = [
  ["/", () => pres(null)],
  ["/governador", () => gov(null)],
  ["/senador", () => sen(null)],
  ["/deputado-federal", () => dep()],
];

const SEMEADAS_SHELL: ReadonlyArray<[string, () => Promise<Document>]> = [
  ["/", () => pres(payloadPreEleicao())],
  ["/governador", () => gov(payloadPreEleicao({ cargo: 3 }))],
  ["/senador", () => sen(payloadPreEleicao({ cargo: 5 }))],
];

describe("(D) RF-159/RF-161 — o pacote que cada rota publica ao shell", () => {
  for (const [rota, render] of ESPERA_SHELL) {
    it(`${rota} em espera: o selo fica silencioso — nenhuma das três propriedades que afirmam`, async () => {
      const publicado = declaracoes(await render());
      for (const prop of PROPRIEDADES_DO_SELO) {
        expect(publicado, `${rota} publica ${prop}`).not.toContain(prop);
      }
      // E a frase, por escrito: o rótulo visível é `content` de CSS, então ela
      // vazaria pelo próprio texto da declaração mesmo se o nome mudasse.
      expect(publicado.toLowerCase()).not.toContain("antes da votação");
      expect(publicado.toLowerCase()).not.toContain("ao vivo");
    });

    it(`${rota} em espera: o segmentado "Parcial / Projeção" É apagado (RF-161)`, async () => {
      // Esta era a metade que a home errava — única rota em que o controle
      // aparecia sem dado nenhum por trás.
      expect(declaracoes(await render()), rota).toContain("--shell-viewmode-display:none");
    });
  }

  for (const [rota, render] of SEMEADAS_SHELL) {
    it(`🔴 (par semeado) ${rota} com \`fase\` no payload publica as QUATRO`, async () => {
      // Sem este par, apagar a variante `nao_comecou` de vez passaria nos oito
      // testes acima — e o selo do topo sumiria também das telas em que a fase
      // foi de fato medida e pode ser afirmada.
      const publicado = declaracoes(await render());
      for (const prop of PROPRIEDADES_DO_SELO) {
        expect(publicado, `${rota} deixou de publicar ${prop}`).toContain(prop);
      }
      expect(publicado, rota).toContain('--live-pct-label:"antes da votação"');
      expect(publicado, rota).toContain("--shell-viewmode-display:none");
    });
  }

  it("🔴 (controle) o helper `declaracoes` de fato lê o que a página publica", async () => {
    // Anti-vácuo: se `main > style` não achasse nada, as onze asserções
    // negativas acima passariam medindo uma string vazia. Em modo NORMAL a home
    // publica o rótulo de percentual, e ele tem de aparecer aqui.
    const publicado = declaracoes(await pres(payloadNormalApurando()));
    expect(publicado).toContain("--live-pct-label");
    expect(publicado.toLowerCase()).toContain("apurado");
    // E em modo normal o segmentado NÃO é apagado — o controle controla algo.
    expect(publicado).not.toContain("--shell-viewmode-display:none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (E) A cor do partido no placar de identidade — achado do portão da
//     constituição, 2026-09-14.
//
// O dono pediu quatro coisas no placar zerado: **nome, foto, partido e COR**.
// A linha de identidade do `<ResultPanel>` lia `candidato.cor` direto do
// payload — e o semeador grava `colorForRank(0)`, cinza neutro, em TODA
// candidatura de propósito (aquele campo carrega a tinta do LÍDER, e em fase
// pré não há líder). Resultado: os 12 chips de partido saíam do mesmo cinza,
// e uma das quatro coisas pedidas não chegava à tela.
//
// A correção lê pela **sigla** (`candidateColor`), que é identidade e não
// colocação. Estes dois testes são um par: o primeiro exige a cor do partido
// mapeado, o segundo exige que o neutro continue existindo para quem não está
// na paleta. Sem o segundo, "pinta tudo de qualquer cor" passaria.
// ─────────────────────────────────────────────────────────────────────────────
// (E) A cor do partido no placar de identidade — achado do portão da
//     constituição, 2026-09-14.
//
// O dono pediu quatro coisas no placar zerado: **nome, foto, partido e COR**.
// A linha de identidade do `<ResultPanel>` lia `candidato.cor` direto do
// payload — e o semeador grava `colorForRank(0)`, cinza neutro, em TODA
// candidatura de propósito (aquele campo carrega a tinta do LÍDER, e em fase
// pré não há líder). Resultado: os 12 chips de partido saíam do mesmo cinza, e
// uma das quatro coisas pedidas não chegava à tela. Nenhum teste pegou, porque
// todos mediam ausência de número — ninguém mediu presença de identidade.
//
// A correção lê pela **sigla** (`candidateColor`), que é identidade e não
// colocação. Seguro aqui porque esta linha usa a variante de CONTORNO do
// `<PartyTag>`: a cor vira só a borda e o texto é `--text-primary` (≥ 15:1).
// ⚠️ Se alguém acrescentar `filled` a esta linha, o aviso do cabeçalho de
// `PartyTag.tsx` passa a valer e o par tem de vir de `partyChipInk(sigla)`.
//
// Os dois testes são um PAR: o primeiro exige a cor do partido mapeado, o
// segundo exige que o neutro continue existindo para quem não está na paleta.
// Sem o segundo, "pinta tudo de qualquer cor" passaria.
// ─────────────────────────────────────────────────────────────────────────────
describe("(E) fase pré: o chip de partido usa a cor da SIGLA, não a do payload", () => {
  function comPartidos(partidos: readonly string[]): EdgePayload {
    return payloadPreEleicao({
      candidatos: partidos.map((partido, i) => ({
        ...candidatoZerado(10 + i, `CANDIDATURA ${partido}`, partido),
        // exatamente o que o semeador grava: cinza neutro para TODOS
        cor: "var(--color-cand-other)",
      })),
    });
  }

  function bordasDosChips(doc: Document): string[] {
    const chips = [...main(doc).querySelectorAll('[data-testid="party-tag"]')];
    expect(chips.length, "os chips de partido precisam existir na tela").toBeGreaterThan(0);
    return chips.map((c) => c.getAttribute("style") ?? "");
  }

  // ⚠️ TRÊS partidos, nunca dois: com `candidatos.length === 2` a home cai no
  // modo `binary` (`app/(pres)/page.tsx:556`), que é outro layout e não monta
  // a lista de identidade. Um teste de dois candidatos mediria outra tela.
  it("partido da paleta editorial (ADR-0024) recebe a tinta DELE, não o cinza do payload", async () => {
    const estilos = bordasDosChips(await pres(comPartidos(["PT", "PL", "PSD"])));
    for (const [i, estilo] of estilos.entries()) {
      expect(
        estilo,
        `chip ${i} saiu com o cinza do payload em vez da cor do partido`,
      ).not.toContain("--color-cand-other");
    }
    // Era este o sintoma: 12 chips idênticos.
    expect(new Set(estilos).size, "PT e PL saíram da mesma cor").toBeGreaterThan(1);
  });

  it("(par) partido FORA da paleta continua caindo no neutro — o fallback não morreu", async () => {
    const estilos = bordasDosChips(await pres(comPartidos(["ZZZ", "YYY", "WWW"])));
    expect(new Set(estilos).size, "siglas não mapeadas devem compartilhar o neutro").toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 (F) A DIMENSÃO QUE FALTAVA NA MATRIZ — emenda de 2026-09-14
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ## O defeito, e por que nenhum teste desta suíte o viu
 *
 * A home tem **dois layouts**, e o despacho entre eles não olhava a fase
 * (`app/(pres)/page.tsx`):
 *
 * ```ts
 * const mode: "binary" | "multi-1t" =
 *   turno === 2 || national.candidatos.length === 2 ? "binary" : "multi-1t";
 * ```
 *
 * **Toda** a supressão da spec 019 — kicker, `<h1>`, `note`, lista de
 * identidade, ausência de `<ApuracaoMeta>` — morava dentro do ramo `multi-1t`.
 * No ramo `binary`, em plena fase pré, o `<main>` continha literalmente:
 *
 * > … Projeção Atlas Menna · não oficial · 1º turno · Disputa entre 2
 * > candidatos · **Apurado 0,0%** · **UFs apuradas 0/27** …
 *
 * Quatro coisas que esta spec existe para impedir, de uma vez: a palavra
 * proibida pelo RF-161, dois números fabricados (a regra do dono: nunca
 * fabricar zeros), e a linha de identidade do RF-155 **não montada** —
 * zero chips.
 *
 * ## Por que é alcançável, e não hipótese de laboratório
 *
 * 1. **As candidaturas caem para duas.** Indeferimento por recurso e
 *    substituição continuam depois do prazo de julgamento — é por isso que o
 *    cadastro é reimportado em 02–03/10. Chegando a exatamente duas
 *    publicáveis à Presidência, a home troca de layout e a supressão evapora
 *    sem ninguém tocar numa linha de código.
 * 2. **`turno === 2` força `binary` pelo outro caminho.**
 *
 * ## 🔴 A causa-raiz é DESTE ARQUIVO, não daquele
 *
 * Todos os casos acima usam **doze** candidaturas, logo exercitam um ramo só.
 * O outro era invisível por construção — e o bloco (E) chegou a **registrar**
 * a existência dele num comentário ("TRÊS partidos, nunca dois") e a desviar,
 * em vez de cobri-lo.
 *
 * Por isso a correção não é um caso a mais: é **parametrizar pelo número de
 * candidaturas**. Uma dimensão que falta numa matriz de teste não some quando
 * o bug é consertado — ela volta a esconder o próximo.
 *
 * ## A regra de ouro deste bloco
 *
 * Todo seletor usado em asserção **negativa** é verificado **não-nulo no
 * estado oposto**, na mesma tabela, para o mesmo N. Um `querySelector` que
 * devolve `null` porque o nome está errado passa em qualquer negativa e prova
 * nada — foi exatamente assim que o defeito acima foi encontrado.
 */

/** As duas âncoras do layout `binary`, que em fase pré não podem existir. */
const ANCORA_APURACAO_META = '[aria-label="Resumo da apuração"]';
/** A âncora do layout de identidade (RF-155). */
const ANCORA_LISTA_IDENTIDADE = '[data-testid="result-identidade-lista"]';

/** `[nº de candidaturas, turno]` — a matriz que faltava. */
const MATRIZ: ReadonlyArray<[number, 1 | 2]> = [
  [2, 1], //  🔴 o caso do defeito: dois candidatos ⇒ `binary`
  [3, 1], //  o menor N que já caía em `multi-1t`
  [12, 1], // o N de todos os testes anteriores
  [2, 2], //  🔴 os dois gatilhos de `binary` ao mesmo tempo
  [12, 2], // 🔴 só `turno === 2` ⇒ `binary`, com N alto
];

function recorte(n: number): EdgeCandidate[] {
  return NOMES_PRESIDENCIAIS.slice(0, n).map(([id, nome, partido]) =>
    candidatoZerado(id, nome, partido),
  );
}

describe("(F) fase pré vale nos DOIS layouts da home (`binary` e `multi-1t`)", () => {
  for (const [n, turno] of MATRIZ) {
    const rotulo = `${n} candidaturas, ${turno}º turno`;
    const semeado = () => ({ ...payloadPreEleicao({ candidatos: recorte(n) }), turno });
    const real = () => ({ ...payloadNormalApurando({ candidatos: recorte(n) }), turno });

    // ── fase pré ───────────────────────────────────────────────────────────
    it(`${rotulo} — fase pré: a lista de identidade tem ${n} linhas (RF-155)`, async () => {
      const doc = await pres(semeado());
      const lista = main(doc).querySelector(ANCORA_LISTA_IDENTIDADE);
      expect(lista, `${rotulo}: o layout de identidade não foi montado`).not.toBeNull();
      expect(lista?.tagName.toLowerCase()).toBe("ul");
      expect(
        main(doc).querySelectorAll('[data-testid="candidatura-identidade-row"]').length,
        rotulo,
      ).toBe(n);
      // E os nomes estão de fato lá — presença de identidade, não só ausência
      // de número. Com `n = 2` isto valia ZERO antes desta emenda.
      for (const [, nome] of NOMES_PRESIDENCIAIS.slice(0, n)) {
        expect(texto(doc), `${rotulo} — ${nome}`).toContain(nome);
      }
    });

    it(`${rotulo} — fase pré: "projeç"/"projec" ZERO vezes fora do RF-158 (RF-161, M14)`, async () => {
      const fora = semBlocoDeTransparencia(await pres(semeado())).toLowerCase();
      expect(fora, rotulo).not.toContain("projeç");
      expect(fora, rotulo).not.toContain("projec");
    });

    it(`${rotulo} — fase pré: nenhum percentual e nenhum "apurado" fabricados`, async () => {
      const doc = await pres(semeado());
      const fora = semBlocoDeTransparencia(doc).toLowerCase();
      // 🔴 DECISÃO DO DONO, 2026-09-17 — a proibição do caractere "%" saiu daqui.
      //
      // Ela nunca esteve no texto do RF-161 (que proíbe PALAVRAS) nem em
      // nenhum outro requisito: era uma rede acrescentada no teste para
      // impedir a volta de dois números medidos em 13/09. O argumento do dono
      // ao removê-la: **"0% apurado" é uma verdade antes da eleição**, e o
      // leitor pode recebê-la. O que era falso naquele dia não era o zero — era
      // afirmar conclusão, vitória e certeza sobre ele.
      //
      // Os três casos que a motivavam continuam cobertos, e por guardas que
      // medem a AFIRMAÇÃO em vez do símbolo:
      //   "Apurado 0,0%"                  → palavra "apurado" (lista abaixo)
      //   "UFs apuradas 0/27"             → palavra "apuradas" + o "/27" logo abaixo
      //   "Fulano vence no 1º turno — 0%" → frase "vence no 1º turno" (RF-154)
      //
      // Consequência aceita: a escala de um eixo ("0%", "50%") deixa de
      // reprovar. Se algum dia um NÚMERO DE RESULTADO voltar a vazar com "%" e
      // sem nenhuma dessas palavras, é aqui que a rede precisa voltar — mas
      // então com o alvo nomeado, não com o caractere.
      expect(fora, `${rotulo} — "0/27" na tela`).not.toContain("/27");
      for (const palavra of VOCABULARIO_DE_MEDICAO) {
        expect(fora, `${rotulo} — "${palavra}"`).not.toContain(palavra);
      }
      // O bloco inteiro que os emitia não existe.
      expect(main(doc).querySelector(ANCORA_APURACAO_META), rotulo).toBeNull();
    });

    it(`${rotulo} — fase pré: os quatro painéis de medição não existem (RF-154, M4)`, async () => {
      const doc = await pres(semeado());
      for (const [nome, seletor] of SELETORES_DOS_PAINEIS) {
        expect(main(doc).querySelector(seletor), `${rotulo} — ${nome}`).toBeNull();
      }
    });

    it(`${rotulo} — fase pré: um \`<h1>\` só, "Quem está concorrendo" (RF-161)`, async () => {
      const doc = await pres(semeado());
      const h1s = [...main(doc).querySelectorAll("h1")];
      expect(h1s.length, `${rotulo} — número de <h1>`).toBe(1);
      expect(h1s[0]?.textContent ?? "", rotulo).toContain("Quem está concorrendo");
    });

    it(`${rotulo} — fase pré: a faixa continua sendo o primeiro filho (RF-160, M12)`, async () => {
      const doc = await pres(semeado());
      expect(main(doc).firstElementChild?.getAttribute("data-testid"), rotulo).toBe(
        "fase-pre-eleicao-banner",
      );
    });

    it(`${rotulo} — fase pré: \`RaceTypeIndicator\` conta quem concorre (RF-156)`, async () => {
      const t = texto(await pres(semeado()));
      if (turno === 2) {
        // RF-156, 3º critério: 2T cai no ramo já existente — não existe
        // segundo turno antes do primeiro, e a spec não abre caso novo.
        expect(t, rotulo).toContain("Segundo turno");
        expect(t, rotulo).not.toContain("Disputa entre");
      } else {
        // O número vem de `candidatos.length`, não de literal no JSX: ele
        // ACOMPANHA o N da linha da matriz.
        expect(t, rotulo).toContain(`Disputa entre ${n} candidato${n === 1 ? "" : "s"}`);
      }
    });

    // ── o par em modo normal, para o MESMO N ──────────────────────────────
    it(`🔴 ${rotulo} — M1/M2 no layout \`binary\`: sem \`fase\`, zerado, é modo NORMAL`, async () => {
      // 🔴 A mutação que a spec mais teme (§ Riscos R4, design § D9 M1/M2):
      // trocar `isPreEleicao(p)` por `p.pct_apurado_total === 0` ou por
      // `!p.por_uf.length`. Ela só era testada com DOZE candidaturas, ou seja,
      // só no layout `multi-1t` — no `binary` passava sem resistência.
      //
      // Este payload é, campo a campo, o que `emptyPayload()` produzia:
      // `pct_apurado_total: 0`, `por_uf: []`, `composition.pre_election: 1`,
      // e **sem** `fase`. O único campo que decide é `fase`, e ele não está
      // aqui — logo, modo normal, nos dois layouts.
      const doc = await pres({ ...payloadNormalZerado({ candidatos: recorte(n) }), turno });

      expect(
        main(doc).querySelector('[data-testid="fase-pre-eleicao-banner"]'),
        `${rotulo} — a faixa de fase pré apareceu num payload SEM \`fase\``,
      ).toBeNull();
      expect(
        main(doc).querySelector(ANCORA_LISTA_IDENTIDADE),
        `${rotulo} — o layout de identidade vazou para um payload sem \`fase\``,
      ).toBeNull();
      // E os painéis de medição continuam lá, zerados — que é o estado
      // legítimo de "a corrida existe e ninguém apurou ainda".
      for (const [nome, seletor] of SELETORES_DOS_PAINEIS) {
        // `ChancesPanel` é gateado por `multi-1t && turno !== 2` desde S05/F4:
        // no layout `binary` a ausência dele não é efeito da fase.
        if (nome === "ChancesPanel" && (turno === 2 || n === 2)) continue;
        expect(main(doc).querySelector(seletor), `${rotulo} — ${nome}`).not.toBeNull();
      }
    });

    it(`🔴 ${rotulo} — modo NORMAL: os números e os painéis VOLTAM`, async () => {
      // Sem este par, "apagar tudo sempre" passaria em todas as asserções
      // negativas acima — e a regressão barata desta spec é sumir com um
      // painel na noite de 04/10 (M6).
      const doc = await pres(real());
      const fora = semBlocoDeTransparencia(doc).toLowerCase();

      expect(fora, `${rotulo} — percentual sumiu do modo normal`).toContain("%");
      expect(fora, `${rotulo} — "apurado" sumiu do modo normal`).toContain("apurado");
      // `RemainingPanel` e `BulletinPanel` são os dois painéis que renderizam
      // nos DOIS layouts; `ChancesPanel` é gateado por `multi-1t && turno !== 2`
      // desde S05/F4 e por isso não entra nesta asserção comum.
      for (const seletor of [
        '[data-testid="remaining-nota"]',
        '[data-testid="bulletin-list"]',
        "#state-grouped-table-heading",
      ]) {
        expect(main(doc).querySelector(seletor), `${rotulo} — ${seletor}`).not.toBeNull();
      }
      // E o layout de identidade NÃO vaza para a noite de apuração.
      expect(main(doc).querySelector(ANCORA_LISTA_IDENTIDADE), rotulo).toBeNull();
      expect(main(doc).querySelectorAll("h1").length, rotulo).toBe(1);
    });

    it(`🔴 ${rotulo} — modo NORMAL: o seletor de \`<ApuracaoMeta>\` discrimina`, async () => {
      // Anti-vácuo do `toBeNull()` lá em cima: no layout `binary` o bloco
      // EXISTE em modo normal, e é este `it` que prova que
      // `[aria-label="Resumo da apuração"]` não é um nome inventado. No
      // layout `multi-1t` ele legitimamente não existe (as três figuras
      // viraram a `<Figure>` "Apurado" do `<ResultPanel>`, 2026-09-09), e
      // quem faz o papel do controle ali é a asserção de `%`/"apurado" acima.
      const doc = await pres(real());
      const binario = turno === 2 || n === 2;
      if (binario) {
        expect(main(doc).querySelector(ANCORA_APURACAO_META), rotulo).not.toBeNull();
      } else {
        expect(
          main(doc).querySelector('[data-testid="result-margem-proj"]'),
          rotulo,
        ).not.toBeNull();
      }
    });
  }

  it("🔴 (controle) o despacho de layout DE FATO muda com o N — senão a matriz é uma só coluna", async () => {
    // Se `binary` e `multi-1t` produzissem a mesma árvore, os cinco casos
    // acima seriam cinco cópias do mesmo teste. Este `it` mede a diferença em
    // MODO NORMAL, onde os dois layouts continuam divergindo de propósito.
    const doisNormal = await pres(payloadNormalApurando({ candidatos: recorte(2) }));
    const dozeNormal = await pres(payloadNormalApurando({ candidatos: recorte(12) }));

    expect(
      main(doisNormal).querySelector(ANCORA_APURACAO_META),
      "com 2 candidaturas a home deveria estar no layout `binary`",
    ).not.toBeNull();
    expect(
      main(dozeNormal).querySelector(ANCORA_APURACAO_META),
      "com 12 candidaturas a home deveria estar no layout `multi-1t`",
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (G) A foto na linha de identidade — pedido do dono, 2026-09-14.
//
// "Coloque a foto no formato circular, bem pequena para não alargar a linha."
// As duas metades do pedido viram duas asserções diferentes, e a segunda é a
// que costuma ser esquecida: a foto aparecer é fácil; ela caber é o requisito.
//
// A geometria, medida no navegador e não escolhida por gosto: a linha é
// `border-box` com `min-height: var(--tap-min)` (44px), 8px de padding em cima
// e embaixo e 1px de filete — sobram **27px** de caixa de conteúdo. Um avatar
// de 28px empurrou a linha para 45px na primeira tentativa. 26 cabe.
//
// jsdom não faz layout, então a altura não é testável aqui; o que é testável —
// e o que impede a regressão — é o NÚMERO que a geometria permite.
// ─────────────────────────────────────────────────────────────────────────────
describe("(G) fase pré: cada candidatura tem foto circular que cabe na linha", () => {
  const LIMITE_PX = 27; // --tap-min (44) − 2×padding (16) − filete (1)

  it("as 12 linhas têm foto, e a URL é derivada do `sqcand` — não é literal", async () => {
    const doc = await pres(payloadPreEleicao());
    const linhas = [...main(doc).querySelectorAll('[data-testid="candidatura-identidade-row"]')];
    expect(linhas.length, "as linhas de identidade precisam existir").toBe(12);

    const fotos = linhas.map((l) => l.querySelector('[data-testid="candidate-avatar-photo"]'));
    expect(fotos.filter(Boolean).length, "toda linha precisa de foto").toBe(12);

    // Derivada, não literal: o conjunto de `sqcand` nas URLs é exatamente o do
    // payload. Comparo CONJUNTOS e não índices de propósito — a lista é
    // reordenada por número de urna (RF-161), então casar por posição testaria
    // a ordem do array da fixture, que não é o que este teste afirma.
    const esperados = new Set(payloadPreEleicao().national.candidatos.map((c) => String(c.sqcand)));
    expect(esperados.size, "a fixture precisa ter um sqcand por candidatura").toBe(12);
    const obtidos = new Set(
      fotos.map((f) => (f?.getAttribute("src") ?? "").replace(/^.*\/(\d+)\.jpg$/, "$1")),
    );
    expect(obtidos).toEqual(esperados);
  });

  it("o avatar cabe na altura que a linha JÁ tinha — 26px, teto de 27", async () => {
    const doc = await pres(payloadPreEleicao());
    const foto = main(doc).querySelector('[data-testid="candidate-avatar-photo"]');
    const w = Number(foto?.getAttribute("width"));
    const h = Number(foto?.getAttribute("height"));

    expect(w, "largura precisa estar declarada").toBeGreaterThan(0);
    expect(w, "quadrado, senão o círculo vira elipse").toBe(h);
    // 🔴 A asserção do pedido: acima de 27 a linha cresce.
    expect(w, `avatar de ${w}px alarga a linha (teto ${LIMITE_PX}px)`).toBeLessThanOrEqual(
      LIMITE_PX,
    );

    // Circular: o átomo aplica `--radius-pill` sob `rounded`.
    expect(foto?.getAttribute("style") ?? "").toContain("--radius-pill");
  });

  it("(par) candidatura SEM `sqcand` cai nas iniciais, com a MESMA caixa", async () => {
    const doc = await pres(
      payloadPreEleicao({
        candidatos: ["PT", "PL", "PSD"].map((partido, i) => {
          const c = candidatoZerado(10 + i, `CANDIDATURA ${partido}`, partido);
          const { sqcand: _descartado, ...semSqcand } = c;
          return semSqcand;
        }),
      }),
    );
    const linhas = [...main(doc).querySelectorAll('[data-testid="candidatura-identidade-row"]')];
    expect(linhas.length).toBe(3);
    expect(
      main(doc).querySelectorAll('[data-testid="candidate-avatar-photo"]').length,
      "sem sqcand não há foto",
    ).toBe(0);
    expect(
      main(doc).querySelectorAll('[data-testid="candidate-avatar-fallback"]').length,
      "e o fallback de iniciais ocupa o lugar, para a linha não encolher",
    ).toBe(3);
  });
});
