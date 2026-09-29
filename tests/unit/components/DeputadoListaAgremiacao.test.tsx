// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoListaAgremiacao.test.tsx — spec 026 (RF-260,
 * RF-261, RF-272), ADR-0065, design 026 § 8.2–8.3.
 *
 * Duas metades, como `UfPicker.test.tsx`: `renderToStaticMarkup` para o que o
 * documento carrega ANTES de qualquer clique (faixas, recorte, nenhuma busca),
 * e `createRoot` + `act` para o que só existe depois do clique (ver mais,
 * busca da faixa 3, erro e "tentar de novo", foco, cache).
 *
 * As linhas saem da fixture de contrato (`tests/fixtures/contrato/`) pela MESMA
 * `paraLinhaCompacta` que a página usa — o teste não monta tupla à mão onde o
 * contrato existe.
 *
 * Mutações que estes testes derrubam (tasks 026): M28 (lista reordenada pela
 * projeção), M31 ("eleito" sozinho), M32 (faixa 21–60 removida do DOM), M33
 * (segundo "mostrar todos" refaz o fetch).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _limparCacheListas,
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import type { DeputadoUfLinha, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import {
  type LinhaCompacta,
  paraLinhaCompacta,
  projecaoVisivel,
} from "@/lib/utils/deputado-marcas";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import contratoLista from "@/tests/fixtures/contrato/deputado-uf-lista.json" with { type: "json" };
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

interface AgrFixture {
  cod: string;
  sigla: string;
  tipo: "partido" | "federacao";
  total_candidatos?: number;
  corte?: {
    ultimo_eleito: number;
    primeiro_fora: number;
    diferenca: number;
    primeiro_fora_abaixo_piso_10?: true;
  };
  candidatos: DeputadoUfLinha[];
}
interface UfFixture {
  ts: string;
  totalizacao_final: boolean;
  projecao: { estado: string };
  lista?: { restantes: number };
  agremiacoes: AgrFixture[];
}
const UFS = contratoUf as unknown as Record<string, UfFixture>;
const LISTA_SP = (contratoLista as unknown as Record<string, DeputadoUfLista>)
  .SP as DeputadoUfLista;

function agr(uf: string, cod: string): AgrFixture {
  const a = UFS[uf]?.agremiacoes.find((x) => x.cod === cod);
  if (!a) throw new Error(`fixture sem ${uf}/${cod}`);
  return a;
}

/** Props como a página as monta, a partir do objeto da UF e do interruptor. */
function props(
  uf: string,
  cod: string,
  interruptor = true,
  over: Partial<DeputadoListaAgremiacaoProps> = {},
): DeputadoListaAgremiacaoProps {
  const d = UFS[uf] as UfFixture;
  const a = agr(uf, cod);
  const ctx = {
    totalizacaoFinal: d.totalizacao_final,
    projecaoVisivel: projecaoVisivel(d.projecao, interruptor),
  };
  const mostrarPartido = a.tipo === "federacao";
  const linhas: LinhaCompacta[] = a.candidatos.map((l) =>
    paraLinhaCompacta(l, ctx, { nome: nomeExibicao, partido: siglaExibicao, mostrarPartido }),
  );
  return {
    uf,
    cod,
    sigla: a.sigla,
    linhas,
    totalCandidatos: a.total_candidatos,
    haListaRestante: (d.lista?.restantes ?? 0) > 0,
    corte:
      a.corte && !d.totalizacao_final
        ? {
            ultimoEleito: a.corte.ultimo_eleito,
            primeiroFora: a.corte.primeiro_fora,
            diferenca: a.corte.diferenca,
            abaixoPiso10: a.corte.primeiro_fora_abaixo_piso_10 === true,
          }
        : null,
    totalizacaoFinal: ctx.totalizacaoFinal,
    projecaoVisivel: ctx.projecaoVisivel,
    mostrarPartido,
    tsDetalhe: d.ts,
    ...over,
  };
}

function estatico(p: DeputadoListaAgremiacaoProps): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<DeputadoListaAgremiacao {...p} />),
    "text/html",
  );
}

function linhasDoc(root: ParentNode): HTMLLIElement[] {
  return [...root.querySelectorAll<HTMLLIElement>("li[data-rank]")];
}

/**
 * "eleito" que não é uma das três marcas nem a citação literal do TSE (RF-266).
 *
 * ⚠️ Sem `\b`: o `textContent` cola nós vizinhos ("nº 2201" + "eleito…" vira
 * "2201eleito"), e `\b` entre dígito e letra não existe — a primeira versão
 * desta regex deixou a mutação M31 sobreviver por isso. A fronteira é "não é
 * letra", por lookaround Unicode.
 */
const ELEITO_SOLTO =
  /(?<!\p{L})eleito(?!\p{L})(?!\s+(na parcial|na projeção|\(TSE\)|por QP|por média))/giu;

// ---------------------------------------------------------------------------
// Antes de qualquer clique — o documento
// ---------------------------------------------------------------------------

describe("DeputadoListaAgremiacao — o documento antes do clique (RF-260)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("🔴 M32 — SP/PL (71 candidatos): as 60 linhas estão no DOM, 20 fora do recorte, e nenhuma busca", () => {
    const doc = estatico(props("SP", "22"));
    const ls = linhasDoc(doc);
    expect(ls).toHaveLength(60);
    expect(ls.map((l) => Number(l.dataset.rank))).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    // Recorte: as 20 primeiras sem `data-f`, as 40 seguintes com.
    expect(ls.filter((l) => !l.hasAttribute("data-f"))).toHaveLength(20);
    expect(ls.filter((l) => l.hasAttribute("data-f"))).toHaveLength(40);
    expect(doc.querySelector("ol")?.getAttribute("data-collapsed")).toBe("true");
    // O recorte é por CSS — nenhum mecanismo que tira da árvore.
    expect(doc.querySelector("details, [hidden]")).toBeNull();
    expect(doc.body.innerHTML).not.toMatch(/display:\s*none/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a11y: lista com nome, botão 'ver mais' com aria-expanded/aria-controls apontando para ela", () => {
    const doc = estatico(props("SP", "22"));
    const ol = doc.querySelector("ol");
    expect(ol?.getAttribute("aria-label")).toBe("Candidatos de PL em SP, por votos apurados");
    const ver = doc.querySelector("[data-testid='dep-ver-mais']");
    expect(ver?.getAttribute("aria-expanded")).toBe("false");
    expect(ver?.getAttribute("aria-controls")).toBe(ol?.id);
    expect(ver?.textContent).toBe("Ver mais 40 candidatos de PL");
    const todos = doc.querySelector("[data-testid='dep-mostrar-todos']");
    expect(todos?.textContent).toBe("Mostrar todos os 71 candidatos de PL");
    // Região viva existe antes de ter texto — senão o anúncio se perde.
    expect(doc.querySelector("[role='status']")).not.toBeNull();
  });

  it("até 20 candidatos: nenhum botão", () => {
    const doc = estatico(props("RR", "22"));
    expect(linhasDoc(doc)).toHaveLength(9);
    expect(doc.querySelector("button")).toBeNull();
  });

  it("entre 21 e 60 sem lista 61+: só o 'ver mais'", () => {
    const doc = estatico(props("SP", "13")); // federação com 40
    expect(linhasDoc(doc)).toHaveLength(40);
    expect(doc.querySelector("[data-testid='dep-ver-mais']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='dep-mostrar-todos']")).toBeNull();
  });

  it("RF-261 — posição, nome, número, votos e % com duas casas; partido só em federação", () => {
    const doc = estatico(props("AP", "13"));
    const primeira = linhasDoc(doc)[0] as HTMLLIElement;
    expect(primeira.textContent).toContain("1º");
    expect(primeira.textContent).toContain("nº 1301");
    expect(primeira.textContent).toContain("39.158");
    expect(primeira.textContent).toContain("10,93%");
    expect(primeira.textContent).toContain("PT");
    // Partido isolado: a coluna não existe.
    const pl = linhasDoc(estatico(props("AP", "22")))[0] as HTMLLIElement;
    expect(pl.querySelector("small")?.textContent).toBe("nº 2201");
  });

  it("RF-261 — sem `numero` a linha sai sem número, nunca 'undefined'", () => {
    const doc = estatico(props("AC", "22"));
    expect(doc.body.textContent).not.toContain("undefined");
    expect(doc.body.textContent).not.toContain("nº");
  });

  it("RF-261 — destino: votos aparecem, o % dá lugar ao texto e nunca '0,00%'", () => {
    const doc = estatico(props("AP", "36")); // chapa inteira sub judice
    for (const l of linhasDoc(doc)) {
      expect(l.textContent).toContain("sub judice — fora da conta");
      expect(l.textContent).not.toMatch(/\d%/);
      expect(l.querySelector("[data-marca]")).toBeNull();
    }
    const rr = estatico(props("RR", "15"));
    const anulado = linhasDoc(rr).find((l) => l.dataset.rank === "3");
    expect(anulado?.textContent).toContain("votos anulados");
    expect(anulado?.textContent).not.toMatch(/\d%/);
    expect(rr.body.textContent).not.toContain("0,00%");
  });

  it('🔴 RF-261 / ADR-0064 (emenda) — "Válido (legenda)": o % aparece NUMÉRICO, com o destino ao lado', () => {
    // O voto é válido e o % é verdadeiro; `—` e a ausência de % são só de
    // anulado e sub judice. Fixture de contrato: RR/UNIÃO, 4º, 2,25125%.
    const rr = estatico(props("RR", "44"));
    const legenda = linhasDoc(rr).find((l) => l.dataset.rank === "4");
    expect(legenda?.textContent).toContain(`${formatPercent(2.25125, 2)} · votos para a legenda`);
    expect(legenda?.textContent).not.toContain("—");
    expect(legenda?.querySelector("[data-marca]")).toBeNull();
  });

  it("🔴 M31 — nenhum 'eleito' solto em lista nenhuma da fixture", () => {
    for (const [uf, d] of Object.entries(UFS)) {
      for (const a of d.agremiacoes) {
        const texto = estatico(props(uf, a.cod)).body.textContent ?? "";
        expect(texto.match(ELEITO_SOLTO), `${uf}/${a.cod}`).toBeNull();
      }
    }
  });

  it("RF-267 — AC (totalização final): só 'Eleito (TSE)', citando o rótulo do TSE; nada de parcial", () => {
    const doc = estatico(props("AC", "15"));
    const texto = doc.body.textContent ?? "";
    expect(texto).not.toContain("eleito na parcial");
    expect(texto).not.toContain("eleito na projeção");
    expect(doc.querySelectorAll("[data-marca='tse']")).toHaveLength(1);
    expect(texto).toContain("“Eleito por QP”");
    // A nossa conta elegia 10002610019 (rank 2) e o TSE não: linha sem marca.
    const r2 = linhasDoc(doc).find((l) => l.dataset.rank === "2");
    expect(r2?.querySelector("[data-marca]")).toBeNull();
  });

  it("marca de projeção só com a projeção visível (estado liberada E interruptor ligado)", () => {
    const ligado = estatico(props("RR", "22", true));
    expect(ligado.querySelectorAll("[data-marca='projecao']")).toHaveLength(4);
    expect(ligado.body.textContent).toContain("eleito na projeção · não oficial");

    const desligado = estatico(props("RR", "22", false));
    expect(desligado.querySelectorAll("[data-marca='projecao']")).toHaveLength(0);
    expect(desligado.body.textContent).not.toMatch(/proje/i);
    // A parcial continua.
    expect(desligado.querySelectorAll("[data-marca='parcial']")).toHaveLength(4);

    // SP aguardando: interruptor ligado não basta.
    const sp = estatico(props("SP", "22", true));
    expect(sp.querySelectorAll("[data-marca='projecao']")).toHaveLength(0);
  });

  it("🔴 M28 — a ordem é a do voto apurado, idêntica com e sem projeção", () => {
    for (const cod of ["22", "44", "15", "13"]) {
      const com = linhasDoc(estatico(props("RR", cod, true))).map((l) =>
        l.textContent?.slice(0, 40),
      );
      const sem = linhasDoc(estatico(props("RR", cod, false))).map((l) =>
        l.textContent?.slice(0, 40),
      );
      expect(com.map((t) => t?.split("º")[0])).toEqual(sem.map((t) => t?.split("º")[0]));
      const ranks = linhasDoc(estatico(props("RR", cod, true))).map((l) => Number(l.dataset.rank));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    // RR/MDB: o rank 2 (Magalhães) é eleito na PROJEÇÃO e não na parcial — e
    // continua em 2º, abaixo do rank 1. A projeção nunca sobe ninguém.
    const mdb = linhasDoc(estatico(props("RR", "15", true)));
    expect(mdb[1]?.querySelector("[data-marca='projecao']")).not.toBeNull();
    expect(mdb[1]?.dataset.rank).toBe("2");
  });

  it("🔴 M28 — mesmo com as linhas chegando fora de ordem, a tela segue o rank", () => {
    const p = props("RR", "22");
    const doc = estatico({ ...p, linhas: [...p.linhas].reverse() });
    expect(linhasDoc(doc).map((l) => Number(l.dataset.rank))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("RF-272 — linha de corte logo depois do último eleito na parcial; com piso de 10% quando for o caso", () => {
    const doc = estatico(props("RR", "13"));
    const corte = doc.querySelector("[data-testid='dep-corte']");
    expect(corte?.previousElementSibling?.getAttribute("data-rank")).toBe("2");
    expect(corte?.textContent).toContain("9.550 votos separam o último eleito na parcial");
    expect(corte?.textContent).toContain("abaixo do piso de 10% do quociente eleitoral");
    // Não conta como candidato.
    expect(corte?.hasAttribute("data-rank")).toBe(false);
  });

  it("RF-272 — SP/PL: o corte (depois do 25º) fica na faixa recortada", () => {
    const doc = estatico(props("SP", "22"));
    const corte = doc.querySelector("[data-testid='dep-corte']");
    expect(corte?.previousElementSibling?.getAttribute("data-rank")).toBe("25");
    expect(corte?.hasAttribute("data-f")).toBe(true);
  });

  it("RF-276 — v1 (sem %): a legenda da coluna não promete percentual", () => {
    const p = props("RR", "22", true, { semPercentual: true, totalCandidatos: undefined });
    const doc = estatico({
      ...p,
      linhas: p.linhas.map((l) => [...l.slice(0, 6), null, ...l.slice(7)] as never),
    });
    expect(doc.body.textContent).toContain("Por votos apurados: posição, candidato e votos.");
    expect(doc.body.textContent).not.toMatch(/\d%/);
    expect(doc.body.textContent).not.toContain("—");
  });
});

// ---------------------------------------------------------------------------
// Depois do clique — montado de verdade
// ---------------------------------------------------------------------------

describe("DeputadoListaAgremiacao — cliques (RF-260)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    _limparCacheListas();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function montar(...listas: DeputadoListaAgremiacaoProps[]) {
    await act(async () => {
      root.render(
        <>
          {listas.map((p) => (
            <DeputadoListaAgremiacao key={p.cod} {...p} />
          ))}
        </>,
      );
    });
  }

  async function esperar(cond: () => boolean) {
    for (let i = 0; i < 50 && !cond(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(cond()).toBe(true);
  }

  function resposta(corpo: unknown, status = 200): Response {
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function lista(cod = "22"): HTMLElement {
    return container.querySelector(
      `[data-testid='dep-lista-agremiacao'][data-cod='${cod}']`,
    ) as HTMLElement;
  }

  it("'ver mais' abre a faixa 21–60 e 'mostrar menos' fecha — sem busca", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await montar(props("SP", "22"));
    const ver = lista().querySelector<HTMLButtonElement>("[data-testid='dep-ver-mais']");
    await act(async () => ver?.click());
    expect(ver?.getAttribute("aria-expanded")).toBe("true");
    expect(lista().querySelector("ol")?.getAttribute("data-collapsed")).toBe("false");
    expect(ver?.textContent).toBe("Mostrar menos");
    await act(async () => ver?.click());
    expect(ver?.getAttribute("aria-expanded")).toBe("false");
    expect(linhasDoc(lista())).toHaveLength(60);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("'mostrar todos': aria-busy durante, região viva conta, foco no 61º, lista aberta e sem duplicata", async () => {
    let soltar: (r: Response) => void = () => {};
    const fetchSpy = vi.fn((_url: string) => new Promise<Response>((r) => (soltar = r)));
    vi.stubGlobal("fetch", fetchSpy);
    await montar(props("SP", "22"));
    const botao = lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']");
    await act(async () => botao?.click());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/uf/SP/deputado-federal/lista");
    await esperar(() => lista().querySelector("ol")?.getAttribute("aria-busy") === "true");
    expect(lista().querySelector("[role='status']")?.textContent).toMatch(/Carregando/);

    await act(async () => soltar(resposta(LISTA_SP)));
    await esperar(() => linhasDoc(lista()).length === 71);

    const ranks = linhasDoc(lista()).map((l) => Number(l.dataset.rank));
    expect(ranks).toEqual(Array.from({ length: 71 }, (_, i) => i + 1));
    expect(new Set(ranks).size).toBe(71);
    expect(lista().querySelector("ol")?.hasAttribute("aria-busy")).toBe(false);
    expect(lista().querySelector("ol")?.getAttribute("data-collapsed")).toBe("false");
    expect(lista().querySelector("[role='status']")?.textContent).toBe("11 candidatos carregados.");
    const r61 = lista().querySelector<HTMLLIElement>("li[data-rank='61']");
    expect(r61?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(r61);
    // As linhas novas também se recolhem com "mostrar menos" (faixa 3).
    expect(r61?.hasAttribute("data-f")).toBe(true);
    // O botão de busca some — não há o que buscar.
    expect(lista().querySelector("[data-testid='dep-mostrar-todos']")).toBeNull();
    // Nome passou pela mesma função de exibição da página.
    expect(r61?.textContent).toContain(nomeExibicao("Brandão SP-22-61", "10002630061"));
    // A faixa 3 nunca traz marca.
    expect(r61?.querySelector("[data-marca]")).toBeNull();
  });

  it("🔴 M33 — duas agremiações da mesma UF: UMA requisição (cache em memória por UF)", async () => {
    const fetchSpy = vi.fn(async () => resposta(LISTA_SP));
    vi.stubGlobal("fetch", fetchSpy);
    // Uma segunda agremiação de SP com 61+ — a fixture só tem o PL; o PT recebe
    // um total fictício para ganhar o botão. A rota devolve 0 linha para ele.
    await montar(props("SP", "22"), props("SP", "13", true, { totalCandidatos: 45 }));

    await act(async () =>
      lista("22").querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    await esperar(() => linhasDoc(lista("22")).length === 71);
    await act(async () =>
      lista("13").querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    await esperar(
      () =>
        lista("13").querySelector("[role='status']")?.textContent !==
          "Carregando os demais candidatos…" &&
        lista("13").querySelector("[role='status']")?.textContent !== "",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lista("13").querySelector("[role='status']")?.textContent).toBe(
      "Nenhum candidato a mais de PT/PC do B/PV para mostrar.",
    );
  });

  it("🔴 busca que NÃO acrescenta linha: o foco vai para a lista, nunca para o <body>", async () => {
    // O botão "mostrar todos" sai do documento quando a busca termina. Com o
    // foco nele e nenhuma linha nova para recebê-lo, o foco caía no <body> —
    // o leitor de teclado voltava ao topo da página sem aviso.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(LISTA_SP)),
    );
    await montar(props("SP", "13", true, { totalCandidatos: 45 }));
    const botao = lista("13").querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']");
    botao?.focus();
    expect(document.activeElement).toBe(botao);
    await act(async () => botao?.click());
    await esperar(() => lista("13").querySelector("[data-testid='dep-mostrar-todos']") === null);

    const ol = lista("13").querySelector("ol");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(ol);
    expect(ol?.getAttribute("tabindex")).toBe("-1");
    expect(lista("13").querySelector("[role='status']")?.textContent).toMatch(
      /^Nenhum candidato a mais/,
    );
  });

  it("🔴 durante a busca o botão fica `aria-disabled` (não `disabled`): o foco fica nele e o clique é ignorado", async () => {
    let soltar: (r: Response) => void = () => {};
    const fetchSpy = vi.fn(() => new Promise<Response>((r) => (soltar = r)));
    vi.stubGlobal("fetch", fetchSpy);
    await montar(props("SP", "22"));
    const botao = lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']");
    botao?.focus();
    await act(async () => botao?.click());
    await esperar(() => lista().querySelector("ol")?.getAttribute("aria-busy") === "true");

    expect(botao?.disabled).toBe(false);
    expect(botao?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(botao);
    // Segundo clique durante a busca: nada acontece.
    await act(async () => botao?.click());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lista().querySelector("[role='status']")?.textContent).toMatch(/Carregando/);

    await act(async () => soltar(resposta(LISTA_SP)));
    await esperar(() => linhasDoc(lista()).length === 71);
    expect(document.activeElement).toBe(lista().querySelector("li[data-rank='61']"));
  });

  it("erro: mensagem + 'tentar de novo', as 60 ficam; o erro não vai para o cache", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(resposta({ erro: "x" }, 502))
      .mockResolvedValueOnce(resposta(LISTA_SP));
    vi.stubGlobal("fetch", fetchSpy);
    await montar(props("SP", "22"));
    const botao = () =>
      lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']");

    await act(async () => botao()?.click());
    await esperar(() => botao()?.textContent === "Tentar de novo");
    expect(lista().querySelector("[role='status']")?.textContent).toMatch(
      /Não conseguimos carregar os demais candidatos/,
    );
    expect(linhasDoc(lista())).toHaveLength(60);
    expect(lista().querySelector("ol")?.hasAttribute("aria-busy")).toBe(false);

    await act(async () => botao()?.click());
    await esperar(() => linhasDoc(lista()).length === 71);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("corpo fora do contrato (UF trocada) é erro, não lista", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta({ ...LISTA_SP, uf: "RJ" })),
    );
    await montar(props("SP", "22"));
    await act(async () =>
      lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    await esperar(
      () =>
        lista().querySelector("[data-testid='dep-mostrar-todos']")?.textContent ===
        "Tentar de novo",
    );
    expect(linhasDoc(lista())).toHaveLength(60);
  });

  it("ADR-0065 D4 — lista 61+ de outro ciclo: a tela diz as duas horas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta({ ...LISTA_SP, ts: "2026-10-04T23:11:00Z" })),
    );
    await montar(props("SP", "22"));
    await act(async () =>
      lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    await esperar(() => linhasDoc(lista()).length === 71);
    expect(lista().textContent).toMatch(/a partir da 61ª vêm do cálculo gravado às 20:11:00/);
  });

  it("mesmo ciclo: nenhum aviso de horas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta(LISTA_SP)),
    );
    await montar(props("SP", "22"));
    await act(async () =>
      lista().querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    await esperar(() => linhasDoc(lista()).length === 71);
    expect(lista().textContent).not.toMatch(/cálculo gravado às/);
  });
});
