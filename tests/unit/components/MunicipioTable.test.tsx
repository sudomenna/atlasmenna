// @vitest-environment happy-dom
/**
 * tests/unit/components/MunicipioTable.test.tsx
 *
 * RF-037 — a **paginação** da lista de municípios (2026-09-20, pedido do dono:
 * "os 20 maiores municípios em número de eleitores e depois disso abre de 40 em
 * 40 tocando em carregar mais").
 *
 * A **ordem** — a outra metade do pedido — está em `MunicipioTable.ordem.test.tsx`.
 *
 * ## Por que metade deste arquivo monta de verdade
 *
 * "Carregar mais" é estado de cliente. `renderToStaticMarkup` só alcança o
 * primeiro quadro (que é o que o leitor recebe do servidor, e por isso os casos
 * de leva inicial ficam nele, mais baratos); o clique, o rótulo que muda e o
 * foco depois do último lote exigem `createRoot` + `act`, como em
 * `MunicipioExplorer.test.tsx`.
 *
 * ⚠️ `getBoundingClientRect()` devolve ZERO no happy-dom: nada aqui finge medir
 * layout. O que se mede é contagem de nós e texto.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type MunicipioRow, MunicipioTable } from "@/components/blocks/MunicipioTable";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** Eleitorado decrescente garantido: i=0 é o maior. */
function makeRows(n: number): MunicipioRow[] {
  return Array.from({ length: n }, (_, i) => ({
    cod_ibge: `35${String(i).padStart(5, "0")}`,
    nome: `Município ${i + 1}`,
    lider: i % 2 === 0 ? 13 : 22,
    liderCor: i % 2 === 0 ? "var(--color-pt)" : "var(--color-pl)",
    liderNome: i % 2 === 0 ? "Lula" : "Bols",
    margemPp: 5 + (i % 10),
    pctApurado: 100,
    votosReportados: 10_000 + i * 137,
    eleitorado: 9_000_000 - i * 1_000,
  }));
}

function linhas(doc: Document | HTMLElement): number {
  return doc.querySelectorAll("tbody tr").length;
}

describe("<MunicipioTable /> — primeiro quadro, do servidor", () => {
  it("(a) o cabeçalho traz o total REAL, não o carregado", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    expect(doc.querySelector("h3")?.textContent).toContain("645");
  });

  it("(b) 🔴 a primeira leva é de 20 municípios — nem 19, nem 21, nem 645", () => {
    // Mutação que morre aqui: trocar `MUNICIPIOS_PRIMEIRA_LEVA` (20) por
    // qualquer outro número. É o número que o dono pediu por escrito.
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    expect(linhas(doc)).toBe(20);
  });

  it("(c) 🔴 `aria-rowcount` é o total da UF, não o que está carregado", () => {
    // Mutação que morre aqui: `aria-rowcount={visiveis}`. Quem usa leitor de
    // tela precisa saber que a lista tem 645, mesmo vendo 20.
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    expect(doc.querySelector("table")?.getAttribute("aria-rowcount")).toBe("645");
    expect(linhas(doc)).toBe(20);
  });

  it("(d) `aria-rowindex` é 1-based com o cabeçalho ocupando o índice 1", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    const idx = [...doc.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("aria-rowindex"));
    expect(idx[0]).toBe("2");
    expect(idx[19]).toBe("21");
  });

  it("(e) 🔴 o botão diz quantos faltam, em número", () => {
    // Mutação que morre aqui: rótulo genérico ("Carregar mais") ou lote
    // trocado. 645 − 20 = 625 restantes, e o próximo lote é 40.
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    const botao = doc.querySelector('[data-testid="municipios-carregar-mais"]');
    expect(botao?.textContent).toContain("40");
    expect(botao?.textContent).toContain("625");
  });

  it("(f) a linha de status declara carregados e total", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} />);
    expect(doc.querySelector('[data-testid="municipios-status"]')?.textContent).toBe(
      "Mostrando 20 de 645 municípios.",
    );
  });

  it("(g) lista menor que a primeira leva não ganha botão nenhum", () => {
    const doc = parse(<MunicipioTable rows={makeRows(5)} />);
    expect(linhas(doc)).toBe(5);
    expect(doc.querySelector('[data-testid="municipios-carregar-mais"]')).toBeNull();
    expect(doc.querySelector('[data-testid="municipios-status"]')?.textContent).toBe(
      "Mostrando 5 de 5 municípios.",
    );
  });

  it("(h) exatamente 20 municípios: mostra os 20 e não oferece 'mostrar mais'", () => {
    const doc = parse(<MunicipioTable rows={makeRows(20)} />);
    expect(linhas(doc)).toBe(20);
    expect(doc.querySelector('[data-testid="municipios-carregar-mais"]')).toBeNull();
  });

  it("(i) lista vazia: cabeçalho com 0, nenhuma linha, nenhum botão", () => {
    const doc = parse(<MunicipioTable rows={[]} />);
    expect(doc.querySelector("h3")?.textContent).toContain("0");
    expect(linhas(doc)).toBe(0);
    expect(doc.querySelector('[data-testid="municipios-carregar-mais"]')).toBeNull();
  });

  it("(j) `inicial` e `lote` são do call site quando ele os declara", () => {
    const doc = parse(<MunicipioTable rows={makeRows(100)} inicial={5} lote={7} />);
    expect(linhas(doc)).toBe(5);
    const botao = doc.querySelector('[data-testid="municipios-carregar-mais"]');
    expect(botao?.textContent).toContain("7");
    expect(botao?.textContent).toContain("95");
  });

  it("(k) formata margem e percentual em pt-BR", () => {
    const doc = parse(<MunicipioTable rows={makeRows(3)} />);
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("Lula");
    expect(texto).toContain("100%");
    expect(texto).toContain("9.000.000 eleitores");
  });

  it("(l) sem `onSelect` não existe nó interativo de município", () => {
    const doc = parse(<MunicipioTable rows={makeRows(30)} />);
    expect(doc.querySelectorAll('[data-testid="municipio-open"]').length).toBe(0);
  });

  it("(m) com `onSelect` cada linha carregada vira um botão — 20, não 645", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} onSelect={() => {}} />);
    expect(doc.querySelectorAll('[data-testid="municipio-open"]').length).toBe(20);
  });

  /**
   * O pedido do dono tinha duas metades, e esta é a de CARREGAMENTO. O número
   * abaixo é a linha de base medida em 2026-09-20 com 645 municípios (SP) e
   * `onSelect` presente, que é o call site real das três rotas de estado.
   *
   * Não é um teste de layout (o happy-dom não faz layout): é contagem de
   * elementos no HTML que o servidor manda, que é o que o navegador tem de
   * construir antes de pintar a primeira tela.
   *
   * ⚠️ Contagem real em 2026-09-20, depois da volta dos votos: **176** contra
   * o teto de 180. Eram 156 antes — a segunda linha do subtítulo custa um nó
   * por município (`MunicipioTable.votos.test.tsx`). **Sobram 4.** Quem for
   * acrescentar mais um elemento por linha vai estourar aqui, e deve subir o
   * teto de propósito e com motivo, não por reflexo: o orçamento existe porque
   * a primeira tela é o que o leitor espera na noite da apuração.
   */
  it("(n) o HTML inicial de SP cabe num orçamento de nós", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} onSelect={() => {}} />);
    const elementos = doc.body.querySelectorAll("*").length;
    expect(elementos).toBeLessThanOrEqual(180);
    expect(linhas(doc)).toBe(20);
  });
});

describe("<MunicipioTable /> — 'mostrar mais', no cliente", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function montar(rows: MunicipioRow[], props: { inicial?: number; lote?: number } = {}) {
    act(() => {
      root.render(<MunicipioTable rows={rows} {...props} />);
    });
  }

  function botao() {
    return container.querySelector<HTMLButtonElement>('[data-testid="municipios-carregar-mais"]');
  }

  function clicar() {
    act(() => {
      botao()?.click();
    });
  }

  function status() {
    return container.querySelector<HTMLElement>('[data-testid="municipios-status"]');
  }

  it("(o) 🔴 cada toque acrescenta 40 — 20 → 60 → 100", () => {
    // Mutação que morre aqui: `MUNICIPIOS_POR_LOTE` de 40 para qualquer outro
    // número, ou `visiveis + lote` virando `visiveis + inicial`.
    montar(makeRows(645));
    expect(linhas(container)).toBe(20);
    clicar();
    expect(linhas(container)).toBe(60);
    clicar();
    expect(linhas(container)).toBe(100);
  });

  it("(p) o rótulo do botão recalcula quantos faltam a cada toque", () => {
    montar(makeRows(645));
    expect(botao()?.textContent).toContain("625");
    clicar();
    expect(botao()?.textContent).toContain("585");
    expect(status()?.textContent).toBe("Mostrando 60 de 645 municípios.");
  });

  it("(q) o último toque traz o RESTO (menos que um lote cheio) e o botão some", () => {
    // 65 municípios: 20 + 40 = 60, e sobram 5 — o último lote é parcial.
    montar(makeRows(65));
    clicar();
    expect(linhas(container)).toBe(60);
    expect(botao()?.textContent).toContain("Mostrar mais 5");
    expect(botao()?.textContent).toContain("faltam 5");
    clicar();
    expect(linhas(container)).toBe(65);
    expect(botao()).toBeNull();
    expect(status()?.textContent).toBe("Mostrando 65 de 65 municípios.");
  });

  it("(r) `aria-rowcount` continua sendo o total em TODOS os estados da paginação", () => {
    montar(makeRows(65));
    const rowcount = () => container.querySelector("table")?.getAttribute("aria-rowcount");
    expect(rowcount()).toBe("65");
    clicar();
    expect(rowcount()).toBe("65");
    clicar();
    expect(rowcount()).toBe("65");
  });

  it("(s) enquanto sobram municípios, o foco fica no próprio botão", () => {
    montar(makeRows(645));
    act(() => botao()?.focus());
    clicar();
    // O botão não é desmontado — só o rótulo muda —, então o foco não se move.
    expect(document.activeElement).toBe(botao());
  });

  it("(t) no toque que esgota a lista, o foco vai para a linha de status", () => {
    // Sem isto o foco cairia no `<body>`: o botão sai do DOM justamente no
    // clique que o usuário acabou de dar.
    montar(makeRows(30));
    act(() => botao()?.focus());
    clicar();
    expect(botao()).toBeNull();
    expect(document.activeElement).toBe(status());
    expect(status()?.textContent).toBe("Mostrando 30 de 30 municípios.");
  });

  it("(u) trocar de UF devolve a lista à primeira leva", () => {
    // O App Router preserva a árvore entre `/uf/SP` e `/uf/MG`: sem o reajuste
    // de estado, MG abriria já com os 60 que o leitor carregou em SP.
    const sp = makeRows(645);
    const mg = makeRows(853).map((r) => ({ ...r, cod_ibge: `31${r.cod_ibge.slice(2)}` }));
    montar(sp);
    clicar();
    expect(linhas(container)).toBe(60);
    montar(mg);
    expect(linhas(container)).toBe(20);
    expect(container.querySelector("h3")?.textContent).toContain("853");
  });
});

/**
 * 2026-10-03 — teto duro (`limite`), pedido do dono para a rota de governador:
 * "traga apenas a lista dos 25 primeiros municípios rankeados por maiores
 * colégios eleitorais". Sem "mostrar mais"; cabeçalho e status dizem o recorte.
 */
describe("<MunicipioTable limite /> — recorte dos N maiores", () => {
  /** Embaralha de forma determinística para que "os maiores" não seja "os primeiros". */
  function embaralhadas(n: number): MunicipioRow[] {
    const r = makeRows(n);
    return r.map((_, i) => r[(i * 7) % n] as MunicipioRow);
  }

  it("(l1) 🔴 645 municípios com limite 25: 25 linhas, os 25 MAIORES, sem botão", () => {
    // 645 e 7 são coprimos, então `embaralhadas` é permutação.
    const doc = parse(<MunicipioTable rows={embaralhadas(645)} limite={25} />);
    expect(linhas(doc)).toBe(25);
    expect(doc.querySelector('[data-testid="municipios-carregar-mais"]')).toBeNull();
    // makeRows: i=0 é o maior eleitorado → "Município 1" … "Município 25".
    const nomes = [...doc.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td")?.textContent ?? "",
    );
    expect(nomes[0]).toContain("Município 1");
    expect(nomes[24]).toContain("Município 25");
    expect(nomes.some((n) => n.includes("Município 26"))).toBe(false);
  });

  it("(l2) cabeçalho, legenda e status declaram o recorte e o total da UF", () => {
    const doc = parse(<MunicipioTable rows={makeRows(645)} limite={25} />);
    expect(doc.querySelector("h3")?.textContent).toBe("Municípios — 25 maiores de 645");
    expect(doc.querySelector('[data-testid="municipios-ordem"]')?.textContent).toContain(
      "25 maiores colégios eleitorais",
    );
    expect(doc.querySelector('[data-testid="municipios-status"]')?.textContent).toBe(
      "Mostrando 25 de 645 municípios.",
    );
    // A tabela contém 25 linhas de dado — é isso que ela anuncia.
    expect(doc.querySelector("table")?.getAttribute("aria-rowcount")).toBe("25");
  });

  it("(l3) o limite vale mesmo acima da primeira leva padrão (20)", () => {
    const doc = parse(<MunicipioTable rows={makeRows(100)} limite={25} />);
    expect(linhas(doc)).toBe(25);
  });

  it("(l4) UF com menos municípios que o limite: lista inteira, sem texto de recorte", () => {
    const doc = parse(<MunicipioTable rows={makeRows(15)} limite={25} />);
    expect(linhas(doc)).toBe(15);
    expect(doc.querySelector("h3")?.textContent).toBe("Municípios (15)");
    expect(doc.querySelector('[data-testid="municipios-ordem"]')?.textContent).not.toContain(
      "maiores",
    );
  });

  it("(l5) sem eleitorado publicado, o recorte NÃO promete 'maiores'", () => {
    const semEleitorado = makeRows(40).map(({ eleitorado: _e, ...r }) => r);
    const doc = parse(<MunicipioTable rows={semEleitorado} limite={25} />);
    expect(linhas(doc)).toBe(25);
    expect(doc.querySelector('[data-testid="municipios-ordem"]')?.textContent).not.toContain(
      "maiores colégios",
    );
  });
});
