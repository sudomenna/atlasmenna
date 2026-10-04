// @vitest-environment happy-dom
/**
 * tests/unit/components/ReordenaListaPorBase.test.tsx
 *
 * **O gate do SC 1.3.2 na lista de candidatos** — a ordem do DOM acompanha a
 * ordem visual.
 *
 * ## O defeito que este arquivo fecha
 *
 * De `290b8de` (2026-09-20) até este commit, a lista reordenava só na PINTURA:
 * `app/globals.css` aplicava `order: var(--ord-<base>)` e o documento ficava
 * na ordem da Projeção. Leitor de tela, teclado, `Ctrl+F` e copiar-colar
 * recebiam a lista fora de ordem, com a numeração da base nova — WCAG
 * **SC 1.3.2 (Meaningful Sequence), nível A**.
 *
 * ⚠️ **Os 22 casos de `ResultPanel.ordemPorBase.test.tsx` não pegavam isso**,
 * e é a lição deste arquivo: eles mediam as custom properties e a existência
 * da regra CSS — a INTENÇÃO de reordenar. Nenhum media a ordem em que os nós
 * de fato estão. Removi a regra de `order` e os 22 continuaram verdes.
 *
 * Aqui a asserção é a ordem dos `<li>` no DOM, depois da troca de base.
 *
 * ## Por que não há teste de pixel
 *
 * `getBoundingClientRect()` devolve zero no happy-dom (armadilha já registrada
 * neste repositório), então "ordem visual" não se mede aqui. O que se mede é a
 * ordem do DOM — que, **desde que não exista regra de `order`**, É a ordem
 * visual. Por isso o caso (d) de `ResultPanel.ordemPorBase.test.tsx` guarda a
 * ausência daquela regra: é ele que sustenta a equivalência de que este
 * arquivo depende.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATRIBUTO_LISTA, reordenarLista } from "@/components/blocks/_lista-por-base";
import { ReordenaListaPorBase } from "@/components/blocks/ReordenaListaPorBase";
import { __resetViewModeForTests, setViewMode } from "@/lib/state/view-mode-client";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Fixture com as duas ordens OPOSTAS de propósito — só assim um teste que
 * ignore `--ord-parcial` (ou que não reordene nada) é discriminado.
 *
 *   linha   --ord-proj   --ord-parcial
 *   A            0             2
 *   B            1             1
 *   C            2             0
 */
function montarLista(): HTMLElement {
  const ol = document.createElement("ol");
  ol.setAttribute(ATRIBUTO_LISTA, "");
  for (const [nome, proj, parcial] of [
    ["A", 0, 2],
    ["B", 1, 1],
    ["C", 2, 0],
  ] as const) {
    const li = document.createElement("li");
    li.setAttribute("data-ord", "proj");
    li.style.setProperty("--ord-proj", String(proj));
    li.style.setProperty("--ord-parcial", String(parcial));
    const a = document.createElement("a");
    a.href = "#";
    a.id = `link-${nome}`;
    a.textContent = nome;
    li.appendChild(a);
    ol.appendChild(li);
  }
  document.body.appendChild(ol);
  return ol;
}

const ordem = (ol: HTMLElement) => [...ol.querySelectorAll("li")].map((li) => li.textContent);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => __resetViewModeForTests());
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  __resetViewModeForTests();
});

/**
 * 🔴 **O caso que faltava quando isto foi ao ar, e o defeito que ele guarda.**
 *
 * Na primeira versão, `ATRIBUTO_LISTA` era exportado de
 * `ReordenaListaPorBase.tsx`, que é `"use client"`, e `<ResultPanel>` (Server
 * Component) importava a constante de lá. **O Next transforma TODA exportação
 * de um módulo `"use client"` numa referência de cliente, inclusive uma
 * string**: no servidor a constante virava um stub que lança, o stub era usado
 * como NOME DE ATRIBUTO da `<ol>`, e o navegador acusava três erros em
 * sequência — `Invalid attribute name`, `React does not recognize the prop` e
 * um `hydration mismatch`. A lista não recebia o atributo e não reordenava.
 *
 * ⚠️ **Os 8 casos abaixo passavam com o defeito no ar**, e não podiam pegar:
 * no vitest não existe fronteira RSC — o import é um import normal e a
 * constante é a string. O defeito só existe sob o build/dev do Next, e foi o
 * DONO quem o viu, na tela.
 *
 * Este bloco é o que sobrou de verificável em teste: a separação de arquivos
 * que torna o erro impossível.
 */
describe("a fronteira servidor/cliente — o que não dá para testar com React", () => {
  const ler = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf-8");

  it("🔴 o módulo do CONTRATO não tem `use client`", () => {
    // Mutação que morre: acrescentar a diretiva em `_lista-por-base.ts`.
    const fonte = ler("components/blocks/_lista-por-base.ts");
    expect(fonte.split("\n").slice(0, 3).join("\n")).not.toContain("use client");
    expect(fonte).toContain("export const ATRIBUTO_LISTA");
  });

  it("🔴 nenhum Server Component importa VALOR do módulo cliente", () => {
    // Importar o COMPONENTE de um módulo `"use client"` é o padrão correto e
    // continua permitido. O que não pode é importar constante ou função.
    //
    // Mutação que morre: devolver o import de `ATRIBUTO_LISTA` para
    // `@/components/blocks/ReordenaListaPorBase` em qualquer dos dois.
    for (const arquivo of [
      "components/blocks/ResultPanel.tsx",
      "components/blocks/CandidateListCollapse.tsx",
    ]) {
      const fonte = ler(arquivo);
      const importaValorDoCliente =
        /import\s*\{[^}]*\b(ATRIBUTO_LISTA|reordenarLista)\b[^}]*\}\s*from\s*"@\/components\/blocks\/ReordenaListaPorBase"/.test(
          fonte,
        );
      expect({ arquivo, importaValorDoCliente }).toEqual({ arquivo, importaValorDoCliente: false });
    }

    // E o contrato vem mesmo do módulo sem diretiva.
    expect(ler("components/blocks/ResultPanel.tsx")).toContain(
      'from "@/components/blocks/_lista-por-base"',
    );
  });
});

describe("reordenarLista — a função pura", () => {
  it("🔴 na base `parcial` a ordem do DOM INVERTE: C, B, A", () => {
    // Mutação que morre: ler `--ord-proj` nos dois ramos.
    const ol = montarLista();
    expect(ordem(ol)).toEqual(["A", "B", "C"]);

    reordenarLista(ol, "parcial");
    expect(ordem(ol)).toEqual(["C", "B", "A"]);
  });

  it("na base `proj` volta a A, B, C", () => {
    const ol = montarLista();
    reordenarLista(ol, "parcial");
    reordenarLista(ol, "proj");
    expect(ordem(ol)).toEqual(["A", "B", "C"]);
  });

  it("é idempotente — duas chamadas na mesma base não mexem no DOM", () => {
    // É isto que permite montar o componente mais de uma vez por página sem
    // coordenação entre as instâncias.
    const ol = montarLista();
    reordenarLista(ol, "parcial");
    const antes = ol.querySelector("li");
    reordenarLista(ol, "parcial");
    expect(ordem(ol)).toEqual(["C", "B", "A"]);
    expect(ol.querySelector("li")).toBe(antes); // o MESMO nó, não um recriado
  });

  it("🔴 o foco sobrevive à reordenação", () => {
    // Medido no Chrome em 2026-09-20: mover o `<li>` que contém o elemento
    // focado joga o foco para o `<body>`. Sem o par guardar/devolver, quem
    // navega por teclado perde o lugar ao trocar de base.
    //
    // Mutação que morre: remover o `focus()` de restauração.
    const ol = montarLista();
    const alvo = document.getElementById("link-A") as HTMLAnchorElement;
    alvo.focus();
    expect(document.activeElement).toBe(alvo);

    reordenarLista(ol, "parcial"); // A vai da 1ª para a 3ª posição

    expect(ordem(ol)).toEqual(["C", "B", "A"]);
    expect(document.activeElement).toBe(alvo);
  });

  it("linha sem as propriedades vai para o fim, sem embaralhar as outras", () => {
    // `NaN` no comparador embaralharia a lista inteira em silêncio.
    const ol = montarLista();
    const orfa = document.createElement("li");
    orfa.textContent = "Z";
    ol.appendChild(orfa);

    reordenarLista(ol, "parcial");
    expect(ordem(ol)).toEqual(["C", "B", "A", "Z"]);
  });

  it("lista de uma linha só não é tocada", () => {
    const ol = document.createElement("ol");
    ol.setAttribute(ATRIBUTO_LISTA, "");
    const li = document.createElement("li");
    li.textContent = "único";
    ol.appendChild(li);
    document.body.appendChild(ol);

    reordenarLista(ol, "parcial");
    expect(ordem(ol)).toEqual(["único"]);
  });
});

describe("<ReordenaListaPorBase /> — ligado à store de base", () => {
  it("🔴 trocar a base no controle do shell reordena o DOM", () => {
    // O caso ponta a ponta: a store é o que o `<ViewModeSwitch>` escreve.
    // Mutação que morre: trocar a dependência do `useEffect` por `[]`.
    const ol = montarLista();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(<ReordenaListaPorBase />));
    expect(ordem(ol)).toEqual(["A", "B", "C"]); // default é `proj`

    act(() => setViewMode("parcial"));
    expect(ordem(ol)).toEqual(["C", "B", "A"]);

    act(() => setViewMode("proj"));
    expect(ordem(ol)).toEqual(["A", "B", "C"]);
  });

  it("uma lista SEM o atributo não é tocada — é a garantia da fase pré", () => {
    // A lista de identidade (fase pré) é ordenada pelo número na urna e não
    // segue base nenhuma: constituição § 2 v1.5, cuja exceção é expressa e
    // exige um controle de base que aquela tela não tem.
    //
    // Mutação que morre: trocar o seletor por `ol` ou `[data-ord]`.
    const ol = montarLista();
    ol.removeAttribute(ATRIBUTO_LISTA);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(<ReordenaListaPorBase />));
    act(() => setViewMode("parcial"));

    expect(ordem(ol)).toEqual(["A", "B", "C"]);
  });
});

/**
 * 🔴 **Refresh do servidor com a base "Parcial" ativa** (04/10/2026).
 *
 * Com `<AtualizacaoAutomatica>` (`router.refresh()` a cada minuto) o servidor
 * reemite o painel com dado novo — e `<ReordenaListaPorBase>` junto, como
 * elemento novo. Com o efeito preso a `[base]`, a base não mudava, o efeito
 * não rodava, e a lista ficava na ordem do refresh ANTERIOR (ou na que o
 * React deixou ao mover nós) até o leitor trocar de base.
 *
 * O `<Painel>` abaixo imita o que o RSC entrega: a `<ol>` marcada, `<li>` com
 * chave e as duas custom properties, e o componente como irmão — re-renderizado
 * pelo pai a cada "refresh".
 *
 * Mutação que morre: devolver `[base]` como dependência do efeito.
 */
describe("<ReordenaListaPorBase /> — refresh com dado novo (04/10)", () => {
  type Item = readonly [nome: string, proj: number, parcial: number];

  function Painel({ itens }: { itens: readonly Item[] }) {
    // Emitido na ordem da Projeção, como o `<ResultPanel>`.
    const emOrdem = [...itens].sort((a, b) => a[1] - b[1]);
    return (
      <>
        <ol {...{ [ATRIBUTO_LISTA]: "" }}>
          {emOrdem.map(([nome, proj, parcial]) => (
            <li
              key={nome}
              style={{ "--ord-proj": proj, "--ord-parcial": parcial } as React.CSSProperties}
            >
              {nome}
            </li>
          ))}
        </ol>
        <ReordenaListaPorBase />
      </>
    );
  }

  function montarPainel(itens: readonly Item[]): HTMLOListElement {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<Painel itens={itens} />));
    return host.querySelector("ol") as HTMLOListElement;
  }

  it("🔴 mesma ordem da Projeção, Parcial nova: a lista segue a Parcial nova", () => {
    const ol = montarPainel([
      ["A", 0, 2],
      ["B", 1, 1],
      ["C", 2, 0],
    ]);
    act(() => setViewMode("parcial"));
    expect(ordem(ol)).toEqual(["C", "B", "A"]);

    // Refresh: a Projeção não mudou; na Parcial, A passou à frente.
    act(() =>
      root?.render(
        <Painel
          itens={[
            ["A", 0, 0],
            ["B", 1, 2],
            ["C", 2, 1],
          ]}
        />,
      ),
    );
    expect(ordem(ol)).toEqual(["A", "C", "B"]);
  });

  it("🔴 a Projeção também mudou (o React move nós): a lista termina na ordem da Parcial", () => {
    const ol = montarPainel([
      ["A", 0, 2],
      ["B", 1, 1],
      ["C", 2, 0],
    ]);
    act(() => setViewMode("parcial"));
    expect(ordem(ol)).toEqual(["C", "B", "A"]);

    act(() =>
      root?.render(
        <Painel
          itens={[
            ["A", 2, 1],
            ["B", 0, 2],
            ["C", 1, 0],
          ]}
        />,
      ),
    );
    expect(ordem(ol)).toEqual(["C", "A", "B"]);

    // E voltar à Projeção segue a Projeção NOVA.
    act(() => setViewMode("proj"));
    expect(ordem(ol)).toEqual(["B", "C", "A"]);
  });
});
