// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoListaAgremiacao.refresh.test.tsx
 *
 * A lista de uma agremiação acompanha props NOVAS com o componente montado —
 * o que passou a acontecer a cada minuto com `<AtualizacaoAutomatica>`
 * (`router.refresh()`, 04/10/2026).
 *
 * 🔴 O defeito que este arquivo guarda: até 04/10 as linhas moravam num
 * `useState(() => ordenarPorRank(linhasIniciais))`, e o inicializador só roda
 * no primeiro render. Um refresh trazia voto, rank e marcas novos e a lista
 * continuava mostrando os do carregamento — no telão, para sempre.
 *
 * Mutação que morre: voltar as linhas para o `useState` inicializado pelas
 * props (casos 1 e 2); guardar em `extras` só o que foi acrescentado e não
 * reunir com as props novas (caso 2).
 *
 * Arquivo separado de `DeputadoListaAgremiacao.test.tsx` de propósito: aquele
 * é editado por outra frente no mesmo dia.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _limparCacheListas,
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import type { DeputadoUfLinha, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import {
  L,
  type LinhaCompacta,
  paraLinhaCompacta,
  projecaoVisivel,
} from "@/lib/utils/deputado-marcas";
import { formatVotes } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import contratoLista from "@/tests/fixtures/contrato/deputado-uf-lista.json" with { type: "json" };
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface UfFixture {
  ts: string;
  totalizacao_final: boolean;
  projecao: { estado: string };
  lista?: { restantes: number };
  agremiacoes: Array<{
    cod: string;
    sigla: string;
    tipo: "partido" | "federacao";
    total_candidatos?: number;
    candidatos: DeputadoUfLinha[];
  }>;
}
const SP = (contratoUf as unknown as Record<string, UfFixture>).SP as UfFixture;
const LISTA_SP = (contratoLista as unknown as Record<string, DeputadoUfLista>)
  .SP as DeputadoUfLista;

/** SP/PL (cod 22) como a página monta: 60 linhas no documento, 71 no total. */
function propsSpPl(): DeputadoListaAgremiacaoProps {
  const a = SP.agremiacoes.find((x) => x.cod === "22");
  if (!a) throw new Error("fixture sem SP/22");
  const ctx = {
    totalizacaoFinal: SP.totalizacao_final,
    projecaoVisivel: projecaoVisivel(SP.projecao, true),
  };
  const mostrarPartido = a.tipo === "federacao";
  return {
    uf: "SP",
    cod: "22",
    sigla: a.sigla,
    linhas: a.candidatos.map((l) =>
      paraLinhaCompacta(l, ctx, { nome: nomeExibicao, partido: siglaExibicao, mostrarPartido }),
    ),
    totalCandidatos: a.total_candidatos,
    haListaRestante: (SP.lista?.restantes ?? 0) > 0,
    rotaLista: "/uf/SP/deputado-federal/lista",
    corte: null,
    totalizacaoFinal: ctx.totalizacaoFinal,
    projecaoVisivel: ctx.projecaoVisivel,
    mostrarPartido,
    tsDetalhe: SP.ts,
  };
}

/**
 * O "refresh": as mesmas linhas, com os dois primeiros TROCADOS de posição
 * (rank 1 ↔ 2) e o voto do novo 1º alterado para um valor que não existe na
 * fixture. Array novo, tuplas novas — como chegam do payload RSC.
 */
function refrescar(p: DeputadoListaAgremiacaoProps): {
  props: DeputadoListaAgremiacaoProps;
  sqNovoPrimeiro: number;
  votosNovos: number;
} {
  const r1 = p.linhas.find((l) => l[L.RANK] === 1) as LinhaCompacta;
  const r2 = p.linhas.find((l) => l[L.RANK] === 2) as LinhaCompacta;
  const votosNovos = 987_654_321;
  const linhas = p.linhas.map((l): LinhaCompacta => {
    if (l === r1) return [2, ...l.slice(1)] as unknown as LinhaCompacta;
    if (l === r2) {
      const nova = [...l] as unknown as number[];
      nova[L.RANK] = 1;
      nova[L.VOTOS] = votosNovos;
      return nova as unknown as LinhaCompacta;
    }
    return [...l] as unknown as LinhaCompacta;
  });
  return { props: { ...p, linhas }, sqNovoPrimeiro: r2[L.SQCAND], votosNovos };
}

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

async function render(p: DeputadoListaAgremiacaoProps) {
  await act(async () => {
    root.render(<DeputadoListaAgremiacao {...p} />);
  });
}

const linhasDoc = () => [...container.querySelectorAll<HTMLLIElement>("li[data-rank]")];

async function esperar(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(cond()).toBe(true);
}

describe("DeputadoListaAgremiacao — props novas com o componente montado (refresh)", () => {
  it("🔴 a lista acompanha as props novas: ordem, voto e posição", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const inicial = propsSpPl();
    await render(inicial);
    expect(linhasDoc()[0]?.dataset.rank).toBe("1");
    const textoAntigoPrimeiro = linhasDoc()[0]?.textContent ?? "";

    const { props, votosNovos } = refrescar(inicial);
    await render(props);

    const primeira = linhasDoc()[0];
    expect(primeira?.dataset.rank).toBe("1");
    expect(primeira?.textContent).toContain(formatVotes(votosNovos));
    // A antiga 1ª agora é a 2ª.
    expect(linhasDoc()[1]?.textContent).toBe(textoAntigoPrimeiro.replace(/^1º/, "2º"));
    expect(linhasDoc()).toHaveLength(60);
  });

  it("🔴 depois de 'mostrar todos', um refresh atualiza as linhas da página e MANTÉM as 61+", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(LISTA_SP), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const inicial = propsSpPl();
    await render(inicial);
    const botao = container.querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']");
    await act(async () => botao?.click());
    await esperar(() => linhasDoc().length === 71);

    const { props, sqNovoPrimeiro, votosNovos } = refrescar(inicial);
    await render(props);

    const ranks = linhasDoc().map((l) => Number(l.dataset.rank));
    expect(ranks).toEqual(Array.from({ length: 71 }, (_, i) => i + 1));
    expect(linhasDoc()[0]?.textContent).toContain(formatVotes(votosNovos));
    expect(container.querySelector("li[data-rank='61']")).not.toBeNull();
    expect(container.querySelector("li[data-rank='71']")).not.toBeNull();
    // Sem duplicata por sqcand: o novo 1º aparece uma vez só.
    const nomeNovoPrimeiro = props.linhas.find((l) => l[L.SQCAND] === sqNovoPrimeiro)?.[L.NOME];
    expect(
      linhasDoc().filter((li) => li.querySelector("b")?.textContent === nomeNovoPrimeiro),
    ).toHaveLength(1);
    // O botão de busca continua fora (a busca já está pronta) — o refresh não
    // reabre a faixa 3.
    expect(container.querySelector("[data-testid='dep-mostrar-todos']")).toBeNull();
  });
});
