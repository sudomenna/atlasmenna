// @vitest-environment happy-dom
/**
 * tests/unit/pages/candidatos.test.tsx — T-13, spec 018 (RF-146 a RF-151).
 *
 * `/candidatos` renderizada por SSR com `readCandidatosUf` mockado. O reader
 * **nunca lança** por contrato (`lib/blob/candidatos.ts`), então o que estes
 * testes travam não é "o caminho feliz funciona" — é que os caminhos infelizes
 * produzem notícia honesta em vez de 500 ou de silêncio:
 *
 *   - fatia ausente (`not_found`) → estado nomeado, moldura da página inteira
 *     (constituição § 7);
 *   - `?cargo=99`, `?uf=ZZ`, `?cargo=7` → estado vazio **nomeado**, nunca a
 *     lista inteira em silêncio (RF-147). O cargo 7 (Deputado Estadual) existe
 *     no TSE e não no produto: a rota não revela cargos que não cobre;
 *   - "Fonte: TSE" **sempre** no DOM — obrigação da licença cc-by, não escolha
 *     editorial (RF-150). Um único teste é o que mantém viva uma obrigação de
 *     licença;
 *   - `fonte_ts` sai do dado, nunca literal do JSX (design 018 § D8 — a lição
 *     que custou quatro frases falsas de uma vez na spec 017).
 *
 * Zero JS de aplicação: o filtro é `<form method="get">`, e o caso (j) trava
 * isso estruturalmente (RF-146/RF-147 — "funciona com JavaScript desligado").
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import CandidatosPage from "@/app/(cand)/candidatos/page";
import type {
  CandidatoIdentidade,
  CandidatosUfResult,
  CandidatosUfSlice,
} from "@/lib/blob/candidatos";

const readCandidatosUfMock = vi.fn<(sigla: string, cargo: string) => Promise<CandidatosUfResult>>();

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: (sigla: string, cargo: string) => readCandidatosUfMock(sigla, cargo),
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
    // O corpo da fatia carrega o TOKEN do cargo (design 018 § D2, reconciliado
    // em 13/09) — a página não o lê, mas o fixture precisa ser fiel ao contrato.
    cargo: "pres",
    fonte_ts: "2026-09-12T18:30:00.000Z",
    gerado_ts: "2026-09-13T02:00:00.000Z",
    candidatos: [cand()],
    ...over,
  } as CandidatosUfSlice;
}

function ok(s: CandidatosUfSlice): CandidatosUfResult {
  return { status: "ok", slice: s, url: "https://exemplo/x.json" };
}

async function render(
  params: Record<string, string> = {},
): Promise<{ doc: Document; markup: string }> {
  const markup = renderToStaticMarkup(
    await CandidatosPage({ searchParams: Promise.resolve(params) }),
  );
  return { doc: new DOMParser().parseFromString(markup, "text/html"), markup };
}

beforeEach(() => {
  readCandidatosUfMock.mockReset();
  readCandidatosUfMock.mockResolvedValue(ok(slice()));
});

// ---------------------------------------------------------------------------

describe("revalidate do segmento × CANDIDATOS_REVALIDATE_SECONDS", () => {
  it("o literal da rota bate com a constante do leitor", async () => {
    // Os dois números TÊM que ser iguais, e não dá para importar um no outro:
    // o Next exige literal estaticamente analisável no `export const
    // revalidate` e o build falha com "Invalid segment configuration export
    // detected" se a gente tentar (medido em 2026-09-13).
    //
    // Já divergiram uma vez — a constante foi para 43.200 s e o literal ficou
    // em 3.600, com um comentário dizendo que eram "o mesmo". Este teste é o
    // que substitui o import que a plataforma não deixa fazer: se alguém mexer
    // num e esquecer o outro, reprova aqui, não em produção doze horas depois.
    const rota = await import("@/app/(cand)/candidatos/page");
    // `importActual`: este arquivo mocka `@/lib/blob/candidatos`, e comparar o
    // literal da rota contra o dublê não provaria nada.
    const { CANDIDATOS_REVALIDATE_SECONDS } =
      await vi.importActual<typeof import("@/lib/blob/candidatos")>("@/lib/blob/candidatos");

    expect(rota.revalidate).toBe(CANDIDATOS_REVALIDATE_SECONDS);
    // Literal dos dois lados: se ambos forem alterados juntos por engano
    // (ex. alinhar com os 60 s dos leitores de apuração), esta linha reprova.
    expect(rota.revalidate).toBe(43_200);
  });
});

describe("/candidatos — default e leitura de UMA fatia (RF-146)", () => {
  it("(a) sem filtro, lê Presidente em BR — uma fatia, nunca as 27×4", () => {
    return render().then(({ doc }) => {
      expect(readCandidatosUfMock).toHaveBeenCalledTimes(1);
      expect(readCandidatosUfMock).toHaveBeenCalledWith("BR", "pres");
      expect(doc.querySelector("[data-testid='candidatos-grid-lista']")).not.toBeNull();
    });
  });

  it("(b) `?cargo=6&uf=BA` lê exatamente a fatia daquela corrida (RF-147)", async () => {
    await render({ cargo: "6", uf: "BA" });
    expect(readCandidatosUfMock).toHaveBeenCalledWith("BA", "dep");
  });

  it("(c) a rota NÃO emite `main[data-trilha]` — nenhuma aba se marca como atual", async () => {
    const { doc } = await render();
    const main = doc.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("data-trilha")).toBeNull();
  });
});

describe("/candidatos — entrada inválida degrada fechado (RF-147)", () => {
  it("(d) `?cargo=99` → estado nomeado, sem ir ao Blob e sem a lista inteira", async () => {
    const { doc } = await render({ cargo: "99" });

    expect(readCandidatosUfMock).not.toHaveBeenCalled();
    expect(doc.querySelector("[data-testid='candidatos-filtro-invalido']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-grid-lista']")).toBeNull();
  });

  it("(e) `?uf=ZZ` → mesmo caminho", async () => {
    const { doc } = await render({ uf: "ZZ" });
    expect(readCandidatosUfMock).not.toHaveBeenCalled();
    expect(doc.querySelector("[data-testid='candidatos-filtro-invalido']")).not.toBeNull();
  });

  it("(f) `?cargo=2` (Vice-Presidente) → a rota não revela cargo fora do produto", async () => {
    // Até 29/09 o exemplo era `?cargo=7`; desde a spec 027 o 7 é do produto.
    const { doc, markup } = await render({ cargo: "2" });

    expect(readCandidatosUfMock).not.toHaveBeenCalled();
    expect(doc.querySelector("[data-testid='candidatos-filtro-invalido']")).not.toBeNull();
    // Asserção NEGATIVA: nem o rótulo do cargo que não cobrimos aparece.
    expect(markup).not.toContain("Vice");
  });

  it.each([
    { cargo: "7", uf: "SP", token: "est", rotulo: "Deputado Estadual" },
    { cargo: "8", uf: "DF", token: "dis", rotulo: "Deputado Distrital" },
    { cargo: "deputado-estadual", uf: "RJ", token: "est", rotulo: "Deputado Estadual" },
  ] as const)("(f2) RF-288: `?cargo=$cargo&uf=$uf` é aceito e lê a fatia `$token` — nunca a do federal", async ({
    cargo,
    uf,
    token,
    rotulo,
  }) => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ uf, cargo: token })));
    const { doc, markup } = await render({ cargo, uf });

    expect(doc.querySelector("[data-testid='candidatos-filtro-invalido']")).toBeNull();
    // O token é o da casa pedida — a trava que separa SP estadual de SP federal.
    expect(readCandidatosUfMock).toHaveBeenCalledWith(uf, token);
    expect(readCandidatosUfMock).not.toHaveBeenCalledWith(uf, "dep");
    // O seletor oferece a casa, com o rótulo da tabela canônica.
    expect(markup).toContain(rotulo);
  });
});

describe("/candidatos — fatia indisponível não quebra a página (RF-146)", () => {
  const motivos = ["not_found", "not_configured", "fetch_error", "invalid"] as const;

  for (const reason of motivos) {
    it(`(g:${reason}) responde com a moldura inteira e a notícia própria do motivo`, async () => {
      readCandidatosUfMock.mockResolvedValue({ status: "unavailable", reason, url: null });
      const { doc } = await render({ cargo: "6", uf: "BA" });

      // A moldura permanece: título, formulário, atribuição e footer.
      expect(doc.querySelector("h1")?.textContent).toContain("Quem está concorrendo");
      expect(doc.querySelector("[data-testid='candidatos-filtros']")).not.toBeNull();
      expect(doc.querySelector("[data-testid='candidatos-fonte']")?.textContent).toContain(
        "Fonte: TSE",
      );

      const aviso = doc.querySelector("[data-testid='candidatos-indisponivel']");
      expect(aviso?.getAttribute("data-reason")).toBe(reason);
      expect((aviso?.textContent ?? "").length).toBeGreaterThan(20);
    });
  }

  it("(h) os quatro motivos produzem textos DIFERENTES entre si", async () => {
    const textos = new Set<string>();
    for (const reason of motivos) {
      readCandidatosUfMock.mockResolvedValue({ status: "unavailable", reason, url: null });
      const { doc } = await render({ cargo: "6", uf: "BA" });
      textos.add(doc.querySelector("[data-testid='candidatos-indisponivel']")?.textContent ?? "");
    }
    // "não publicamos ainda" e "não conseguimos falar com o armazenamento" são
    // notícias diferentes (constituição § 8). Um texto genérico único passaria
    // no caso (g) e falha aqui.
    expect(textos.size).toBe(motivos.length);
  });

  it("(i) fatia publicada porém VAZIA → estado honesto, não uma grade vazia muda", async () => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ uf: "BA", cargo: "dep", candidatos: [] })));
    const { doc } = await render({ cargo: "6", uf: "BA" });

    expect(doc.querySelector("[data-testid='candidatos-grid-lista']")).toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-grid-vazio']")?.textContent).toBeTruthy();
  });
});

describe("/candidatos — filtro sem JavaScript (RF-147)", () => {
  it("(j) o filtro é um <form method=get>, com <label> visível em cada campo", async () => {
    const { doc } = await render();
    const form = doc.querySelector("[data-testid='candidatos-filtros']");

    expect(form?.tagName).toBe("FORM");
    expect(form?.getAttribute("method")).toBe("get");
    // `action` ausente = submete para a própria rota. Um `onSubmit` exigiria
    // ilha client, que RNF-007a (148,7 de 150 KiB) não comporta.
    expect(form?.getAttribute("onsubmit")).toBeNull();

    for (const id of ["filtro-cargo", "filtro-uf", "filtro-busca"]) {
      const rotulo = doc.querySelector(`label[for='${id}']`);
      expect(rotulo, `campo ${id} sem <label for>`).not.toBeNull();
      expect(rotulo?.classList.contains("sr-only")).toBe(false);
      expect((rotulo?.textContent ?? "").trim().length).toBeGreaterThan(0);
    }

    expect(doc.querySelector("[data-testid='filtro-submit']")?.getAttribute("type")).toBe("submit");
  });

  it("(k) os campos têm `name` — sem ele o filtro não seria submetido", async () => {
    const { doc } = await render();
    expect(doc.querySelector("#filtro-cargo")?.getAttribute("name")).toBe("cargo");
    expect(doc.querySelector("#filtro-uf")?.getAttribute("name")).toBe("uf");
    expect(doc.querySelector("#filtro-busca")?.getAttribute("name")).toBe("q");
  });

  it("(l) os valores submetidos voltam preenchidos no formulário (RF-148)", async () => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ uf: "BA", cargo: "dep" })));
    const { doc } = await render({ cargo: "6", uf: "BA", q: "marli" });

    // `renderToStaticMarkup` materializa `defaultValue` como `selected`/`value`.
    expect(doc.querySelector("#filtro-cargo option[selected]")?.getAttribute("value")).toBe("6");
    expect(doc.querySelector("#filtro-uf option[selected]")?.getAttribute("value")).toBe("BA");
    expect(doc.querySelector("#filtro-busca")?.getAttribute("value")).toBe("marli");
  });
});

describe("/candidatos — busca por nome (RF-148)", () => {
  const tres = [
    cand({ sqcand: "1", numero: 13, nome_urna: "LULA", nome: "Luiz Inácio Lula da Silva" }),
    cand({ sqcand: "2", numero: 22, nome_urna: "JOSÉ", nome: "José da Silva" }),
    cand({ sqcand: "3", numero: 50, nome_urna: "MARINA", nome: "Marina Souza" }),
  ];

  beforeEach(() => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ candidatos: tres })));
  });

  it("(m) `jose` casa com `JOSÉ` e com `José da Silva` — sem acento, sem caixa", async () => {
    const { doc } = await render({ q: "jose" });
    const nomes = [...doc.querySelectorAll("[data-testid='candidate-card-nome']")].map(
      (el) => el.textContent,
    );
    expect(nomes).toEqual(["JOSÉ"]);
  });

  it("(n) casa contra o nome COMPLETO, não só o de urna", async () => {
    // "Luiz Inácio" não aparece em lugar nenhum do card — só no campo `nome`.
    // Sem ele, a busca fica cega para metade das formas pelas quais o eleitor
    // conhece o candidato.
    const { doc } = await render({ q: "luiz inacio" });
    const nomes = [...doc.querySelectorAll("[data-testid='candidate-card-nome']")].map(
      (el) => el.textContent,
    );
    expect(nomes).toEqual(["LULA"]);
  });

  it("(o) busca vazia ou só espaços equivale a SEM filtro, não a zero resultado", async () => {
    for (const q of ["", "   "]) {
      const { doc } = await render({ q });
      expect(doc.querySelectorAll("[data-testid='candidate-card']")).toHaveLength(3);
    }
  });

  it("(p) busca sem resultado → estado nomeado, distinto de 'nada publicado'", async () => {
    const { doc } = await render({ q: "zzzzz" });
    const vazio = doc.querySelector("[data-testid='candidatos-grid-vazio']")?.textContent ?? "";
    expect(vazio).toContain("busca");

    readCandidatosUfMock.mockResolvedValue(ok(slice({ candidatos: [] })));
    const semPublicacao =
      (await render()).doc.querySelector("[data-testid='candidatos-grid-vazio']")?.textContent ??
      "";
    expect(semPublicacao).not.toBe(vazio);
  });
});

describe("/candidatos — atribuição e frescor (RF-150)", () => {
  it("(q) 'Fonte: TSE' está no bloco de atribuição da GRADE, não só no footer", async () => {
    const { doc } = await render();

    // ⚠️ A asserção é ESCOPADA de propósito. `body.textContent` conteria
    // "Fonte: TSE" mesmo com o bloco removido, porque o footer global já diz
    // "Não oficial. Fonte: TSE." — medido: apagar a atribuição da grade deixava
    // este arquivo inteiro verde. O RF-150 é explícito em que a atribuição da
    // grade é **adicional** à do footer, e fica junto do dado.
    expect(doc.querySelector("[data-testid='candidatos-fonte']")?.textContent).toContain(
      "Fonte: TSE",
    );
  });

  it("(q2) e continua lá quando a fatia não veio", async () => {
    readCandidatosUfMock.mockResolvedValue({
      status: "unavailable",
      reason: "not_found",
      url: null,
    });
    const { doc } = await render();
    expect(doc.querySelector("[data-testid='candidatos-fonte']")?.textContent).toContain(
      "Fonte: TSE",
    );
  });

  it("(r) o carimbo sai do `fonte_ts` injetado — nunca literal no JSX", async () => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ fonte_ts: "2026-09-12T18:30:00.000Z" })));
    const a = (await render()).doc.querySelector(
      "[data-testid='candidatos-fonte-ts']",
    )?.textContent;

    readCandidatosUfMock.mockResolvedValue(ok(slice({ fonte_ts: "2026-10-01T09:05:00.000Z" })));
    const b = (await render()).doc.querySelector(
      "[data-testid='candidatos-fonte-ts']",
    )?.textContent;

    // Dois valores distintos → dois carimbos distintos. Um número cravado no
    // JSX passaria em qualquer asserção de igualdade contra si mesmo.
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    // Fuso de Brasília: 18:30Z é 15:30 local, não 18:30.
    expect(a).toContain("12/09/2026");
    expect(a).toContain("15:30");
  });

  it("(s) `fonte_ts` impresentável omite o carimbo, mas não a atribuição", async () => {
    readCandidatosUfMock.mockResolvedValue(ok(slice({ fonte_ts: "não é data" })));
    const { doc } = await render();

    expect(doc.querySelector("[data-testid='candidatos-fonte-ts']")).toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-fonte']")?.textContent).toContain(
      "Fonte: TSE",
    );
    expect(doc.body.textContent).not.toContain("Invalid Date");
  });

  it("(t) a tela avisa que a lista muda até o fim da apuração (RF-141)", async () => {
    const { doc } = await render();
    expect(doc.querySelector("[data-testid='candidatos-fonte']")?.textContent).toContain(
      "muda até o fim da apuração",
    );
  });

  it("(u) o footer global continua trazendo 'Não oficial' (constituição § 1)", async () => {
    const { doc } = await render();
    expect(doc.body.textContent).toContain("Não oficial");
  });
});

// ---------------------------------------------------------------------------
// Paginação de exibição — 60 por vez, "carregar mais" sem JavaScript
// ---------------------------------------------------------------------------

/**
 * `n` candidaturas com números 1..n, **entregues em ordem decrescente**.
 *
 * A inversão não é decorativa: se a página cortar antes de ordenar, as 60
 * exibidas serão as de MAIOR número (1.061..1.002) em vez das 60 primeiras.
 * Uma fixture já ordenada deixaria essa mutação passar sem ser vista.
 */
function muitos(n: number): CandidatoIdentidade[] {
  return Array.from({ length: n }, (_, i) => {
    const numero = n - i;
    return cand({
      sqcand: `2500${String(numero).padStart(8, "0")}`,
      numero,
      nome_urna: `CAND ${numero}`,
      nome: `Candidato ${numero}`,
    });
  });
}

/** A fatia real que motivou o corte: cargo 6 em SP, 1.061 publicáveis. */
function sp1061(): CandidatosUfResult {
  return ok(slice({ uf: "SP", cargo: "dep", candidatos: muitos(1061) }));
}

function cartoes(doc: Document): number {
  return doc.querySelectorAll("[data-testid='candidate-card']").length;
}

function numeros(doc: Document): number[] {
  return [...doc.querySelectorAll("[data-testid='candidate-card-numero']")].map((el) =>
    Number(el.textContent),
  );
}

describe("/candidatos — corte de exibição de 60", () => {
  beforeEach(() => {
    readCandidatosUfMock.mockResolvedValue(sp1061());
  });

  it("(w) SP/dep sem `limite` desenha EXATAMENTE 60 cartões, não 1.061", async () => {
    // Mutação que deve derrubá-lo: remover o `.slice(0, filtros.limite)`.
    // O HTML de 1.061 cartões media 4.015.398 bytes no build de produção.
    const { doc } = await render({ cargo: "6", uf: "SP" });
    expect(cartoes(doc)).toBe(60);
  });

  it("(x) a contagem na tela é 1.061 — o total REAL, nunca o da fatia cortada", async () => {
    // Mutação que deve derrubá-lo: passar `exibidos.length` como `total` à
    // grade (ou não passar `total` nenhum). A tela diria "60 candidaturas"
    // numa corrida de 1.061 — mentira por generalização, constituição § 8.
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const contagem = doc.querySelector("[data-testid='candidatos-grid-contagem']");

    expect(contagem?.getAttribute("data-total")).toBe("1061");
    expect(contagem?.textContent).toBe("1.061 candidaturas");
    // Asserção NEGATIVA: o número da fatia não pode aparecer como se fosse o
    // tamanho da corrida.
    expect(contagem?.textContent).not.toContain("60 candidaturas");
  });

  it("(x2) o texto abaixo da grade diz mostrando E total, os dois do dado", async () => {
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const p = doc.querySelector("[data-testid='candidatos-paginacao-contagem']");

    expect(p?.getAttribute("data-mostrando")).toBe("60");
    expect(p?.getAttribute("data-total")).toBe("1061");
    expect(p?.textContent).toContain("Mostrando 60 de 1.061");
  });

  it("(y) `?limite=120` desenha 120 — o parâmetro é obedecido", async () => {
    // Mutação que deve derrubá-lo: ignorar `params.limite` e cortar sempre em
    // `CANDIDATOS_POR_PAGINA`.
    const { doc } = await render({ cargo: "6", uf: "SP", limite: "120" });
    expect(cartoes(doc)).toBe(120);
  });

  it("(z) entrada inválida em `limite` degrada FECHADO para 60", async () => {
    // Mutação que deve derrubá-lo: `Number.parseInt` sem guarda (aceitaria
    // `60abc`), ou `Number(x) || 60` (aceitaria `-5`, que vira lista vazia).
    for (const limite of ["abc", "-5", "0", "1.5", "60abc", " ", "+120", "1e9"]) {
      const { doc } = await render({ cargo: "6", uf: "SP", limite });
      expect(cartoes(doc), `?limite=${limite} deveria cair no default`).toBe(60);
    }
  });

  it("(z2) `?limite=999999999` é limitado ao teto de sanidade", async () => {
    // Mutação que deve derrubá-lo: não validar o teto. A fatia tem 2.100 para
    // que o teto (2.000) seja o que corta — com 1.061, os dois caminhos
    // renderizariam o mesmo e o caso não provaria nada.
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "SP", cargo: "dep", candidatos: muitos(2100) })),
    );
    const { doc } = await render({ cargo: "6", uf: "SP", limite: "999999999" });

    expect(cartoes(doc)).toBe(2000);
    // E a tela continua honesta sobre o tamanho real da corrida.
    expect(
      doc
        .querySelector("[data-testid='candidatos-paginacao-contagem']")
        ?.getAttribute("data-total"),
    ).toBe("2100");
  });

  it("(z3) as 60 exibidas são as de MENOR número — ordena antes de cortar", async () => {
    // Mutação que deve derrubá-lo: `visiveis.slice(0, limite)` antes de
    // ordenar, ou ordenar por nome/partido. A fixture chega em ordem
    // decrescente: cortar sem ordenar entregaria 1.061..1.002.
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const ns = numeros(doc);

    expect(ns).toHaveLength(60);
    expect(ns[0]).toBe(1);
    expect(ns[59]).toBe(60);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
  });
});

describe("/candidatos — 'carregar mais' é link, não botão (RF-146)", () => {
  beforeEach(() => {
    readCandidatosUfMock.mockResolvedValue(sp1061());
  });

  it("(aa) é um <a href> com fragmento `#c-60`, e não existe <button> novo", async () => {
    // Mutação que deve derrubá-lo: virar `<button onClick>` (exigiria ilha
    // client, e a rota é zero de aplicação), ou perder o fragmento.
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const mais = doc.querySelector("[data-testid='candidatos-carregar-mais']");

    expect(mais?.tagName).toBe("A");
    const href = mais?.getAttribute("href") ?? "";
    expect(href).toContain("limite=120");
    expect(href.endsWith("#c-60")).toBe(true);

    // O único `<button>` da página continua sendo o submit do filtro.
    const botoes = [...doc.querySelectorAll("button")];
    expect(botoes.map((b) => b.getAttribute("data-testid"))).toEqual(["filtro-submit"]);
  });

  it("(bb) a âncora aponta para um elemento QUE EXISTE na página de destino", async () => {
    // ⚠️ O caso que justifica o arquivo. Um `href="#c-60"` sem elemento de
    // `id="c-60"` **não dá erro**: o navegador simplesmente não rola, e o
    // leitor volta ao topo achando que o produto quebrou. Só um teste pega.
    //
    // Mutação que deve derrubá-lo: remover o `id` do `<li>`, ou mudar o formato
    // da âncora num dos dois lados (`ancoraCandidato` existe para que não haja
    // dois lados).
    const primeira = await render({ cargo: "6", uf: "SP" });
    const href =
      primeira.doc
        .querySelector("[data-testid='candidatos-carregar-mais']")
        ?.getAttribute("href") ?? "";

    const corte = href.indexOf("#");
    expect(corte, `href sem fragmento: ${href}`).toBeGreaterThan(-1);
    const query = href.slice(0, corte);
    const fragmento = href.slice(corte + 1);
    expect(fragmento).toBeTruthy();

    const params = Object.fromEntries(new URLSearchParams(query.replace(/^\?/, "")));
    const segunda = await render(params as Record<string, string>);

    const alvo = segunda.doc.getElementById(fragmento);
    expect(alvo, `nenhum elemento com id="${fragmento}" na página de destino`).not.toBeNull();
    expect(alvo?.tagName).toBe("LI");
    // E é de fato a PRIMEIRA candidatura da fatia nova — número 61, porque a
    // ordem é por número e as 60 anteriores são 1..60.
    expect(alvo?.querySelector("[data-testid='candidate-card-numero']")?.textContent).toBe("61");
  });

  it("(cc) 'ver todas' carrega a corrida inteira num clique só", async () => {
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const todas = doc.querySelector("[data-testid='candidatos-ver-todas']");

    expect(todas?.tagName).toBe("A");
    expect(todas?.getAttribute("href")).toContain("limite=1061");
    expect(todas?.textContent).toContain("1.061");
  });

  it("(dd) os links preservam cargo, UF e busca — não jogam o leitor no default", async () => {
    // Mutação que deve derrubá-lo: montar o href só com `limite`. O clique
    // devolveria Presidente/BR, que é o filtro de outra pessoa.
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "SP", cargo: "dep", candidatos: muitos(200) })),
    );
    const { doc } = await render({ cargo: "6", uf: "SP", q: "cand" });
    const href =
      doc.querySelector("[data-testid='candidatos-carregar-mais']")?.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.slice(0, href.indexOf("#")).replace(/^\?/, ""));

    expect(params.get("cargo")).toBe("6");
    expect(params.get("uf")).toBe("SP");
    expect(params.get("q")).toBe("cand");
  });

  it("(ee) sem busca, a URL não carrega um `q=` vazio", async () => {
    const { doc } = await render({ cargo: "6", uf: "SP" });
    const href =
      doc.querySelector("[data-testid='candidatos-carregar-mais']")?.getAttribute("href") ?? "";
    expect(href).not.toContain("q=");
  });
});

describe("/candidatos — corrida pequena não ganha paginação", () => {
  it("(ff) UF com menos de 60 não mostra link nenhum, nem o texto de corte", async () => {
    // Mutação que deve derrubá-lo: emitir o bloco incondicionalmente. Um
    // "carregar mais" que não carrega nada é ruído, e um "mostrando 12 de 12"
    // é redundância que pede para ser lida como aviso.
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "BR", cargo: "pres", candidatos: muitos(12) })),
    );
    const { doc } = await render();

    expect(cartoes(doc)).toBe(12);
    expect(doc.querySelector("[data-testid='candidatos-paginacao']")).toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-carregar-mais']")).toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-ver-todas']")).toBeNull();
    // O total continua na tela — o que sai é o aparato, não a informação.
    expect(doc.querySelector("[data-testid='candidatos-grid-contagem']")?.textContent).toBe(
      "12 candidaturas",
    );
  });

  it("(gg) exatamente 60 também não paginam — a fronteira é `>`, não `>=`", async () => {
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "SP", cargo: "dep", candidatos: muitos(60) })),
    );
    const { doc } = await render({ cargo: "6", uf: "SP" });

    expect(cartoes(doc)).toBe(60);
    expect(doc.querySelector("[data-testid='candidatos-paginacao']")).toBeNull();
  });

  it("(hh) `?limite=` que cobre o total apaga os links, sem apagar o total", async () => {
    readCandidatosUfMock.mockResolvedValue(
      ok(slice({ uf: "SP", cargo: "dep", candidatos: muitos(120) })),
    );
    const { doc } = await render({ cargo: "6", uf: "SP", limite: "120" });

    expect(cartoes(doc)).toBe(120);
    expect(doc.querySelector("[data-testid='candidatos-paginacao']")).toBeNull();
    expect(doc.querySelector("[data-testid='candidatos-grid-contagem']")?.textContent).toBe(
      "120 candidaturas",
    );
  });
});

describe("/candidatos — o corte é de exibição, e a busca vem antes dele", () => {
  it("(ii) a busca filtra a corrida INTEIRA, não os 60 desenhados", async () => {
    // Mutação que deve derrubá-lo: cortar antes de `filtrarPorNome`. Quem
    // procurasse o número 900 numa corrida de 1.061 receberia "nenhum
    // resultado" — a busca ficaria cega para 94% da lista.
    readCandidatosUfMock.mockResolvedValue(sp1061());
    const { doc } = await render({ cargo: "6", uf: "SP", q: "CAND 900" });

    expect(numeros(doc)).toEqual([900]);
    expect(doc.querySelector("[data-testid='candidatos-grid-contagem']")?.textContent).toBe(
      "1 candidatura",
    );
  });
});

describe("/candidatos — ressalva na tela (RF-141)", () => {
  it("(v) candidatura sob recurso aparece, com a situação ao lado", async () => {
    readCandidatosUfMock.mockResolvedValue(
      ok(
        slice({
          uf: "BA",
          cargo: "dep",
          candidatos: [
            cand({
              sqcand: "9",
              numero: 2727,
              nome_urna: "MARLI LIMA",
              nome: "Marli Lima",
              sob_ressalva: true,
              situacao_julgamento: "INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO",
            }),
          ],
        }),
      ),
    );
    const { doc } = await render({ cargo: "6", uf: "BA" });

    // Ela APARECE — excluí-la mentiria por omissão sobre quem recebe voto.
    expect(doc.querySelectorAll("[data-testid='candidate-card']")).toHaveLength(1);
    expect(doc.querySelector("[data-testid='candidate-card-ressalva']")?.textContent).toContain(
      "INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO",
    );
  });
});
