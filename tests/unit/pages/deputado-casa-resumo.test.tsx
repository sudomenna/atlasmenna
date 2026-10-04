// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-casa-resumo.test.tsx — spec 027 (RF-281, RF-284,
 * RF-285): a página da casa com um objeto da Fase 1 — o cargo lido pelo
 * RESUMO da UF (`granularidade: "uf"`), sem `projecao` no objeto e com
 * `conferencia.nao_comparou`.
 *
 * O adaptador `_dados-da-casa.ts` é simulado (como em
 * `deputado-casa-uf.test.tsx`): o que se mede aqui é o que a tela ESCREVE.
 * O interruptor vem LIGADO de propósito: a linha do estado da projeção e o
 * "o que está movendo" têm de sumir pela ausência de `projecao` no objeto,
 * não por um interruptor desligado que os esconderia de qualquer jeito.
 *
 * Mutações aplicadas à mão (30/09, frente U-b) e que estes casos derrubam:
 *   - M28: a linha do estado da projeção com texto de reserva quando o objeto
 *     não tem `projecao` — cai "sem linha de projeção";
 *   - M29: `nao_comparou` somado ao `comparou` na Conferência (o "confere" do
 *     eleitorado) — cai "não comparado, nunca 'fecha'";
 *   - `termoDoTerritorio` fixo nos estados — cai a varredura do DF;
 *   - (até 03/10) `rotaListaDaCasa(8)` devolvendo a rota — caía "sem 'mostrar
 *     todos' no DF". Desde a decisão do dono de 03/10 o DF TEM rota de lista,
 *     e o caso se inverteu;
 *   - (03/10) o documento das assembleias sem o corte (60 por agremiação) ou
 *     com o mínimo de 10 removido — caía "eleitos + 5 (mínimo 10)". Desde a
 *     emenda de 04/10 (decisão do dono) a regra é "eleitos + 7", sem mínimo,
 *     e o caso cai com o corte removido ou com o 7 trocado.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderPaginaUfDeputado } from "@/app/(dep)/_pagina-uf-deputado";
import type { DeputadoUfDetail, DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

import { agremiacao, linhaUf, payloadCasa } from "../deputado/_payload-casa";

const lerDadosDaCasaMock = vi.fn();

vi.mock("@/app/(dep)/_dados-da-casa", () => ({
  lerDadosDaCasa: (cargo: number, sigla: string) => lerDadosDaCasaMock(cargo, sigla),
  lerCandidaturasAguardando: vi.fn(async () => null),
  // Spec 026 RF-291 — nenhuma foto publicada: as linhas eleitas saem com iniciais.
  lerFotosDaCasa: vi.fn(async () => new Set<string>()),
  lerListaDaCasa: vi.fn(),
}));

const LIGADO = { ligada: true, pct_minimo: 25, origem: "chave" } as const;

/**
 * Um objeto de UF da Fase 1, a partir do AC da fixture de contrato: sem
 * `projecao` (nem no objeto, nem nas agremiações, nem nas linhas), com
 * `granularidade: "uf"`, Conferência de resumo e números de urna de 5 dígitos.
 */
function objetoResumo(cargo: 7 | 8, uf: string): DeputadoUfDetail {
  const base = structuredClone(
    (contratoUf as unknown as Record<string, DeputadoUfDetail>).AC,
  ) as DeputadoUfDetail & Record<string, unknown>;
  const {
    projecao: _p,
    mais_votados: _m,
    ...semProjecao
  } = base as unknown as Record<string, unknown>;
  const d = semProjecao as unknown as DeputadoUfDetail;
  d.cargo = cargo;
  d.uf = uf;
  d.granularidade = "uf";
  d.totalizacao_final = false;
  d.lista = { restantes: 5 };
  d.conferencia = {
    estado: "confere",
    boletim_dado_ts: "2026-10-04T23:30:00Z",
    totalizacao_final: false,
    comparou: ["algoritmo", "eleitos"],
    divergencias: [],
    nao_comparou: [{ comparacao: "eleitorado", motivo: "granularidade_uf" }],
  };
  let n = 0;
  for (const a of d.agremiacoes) {
    delete a.cadeiras_projetadas;
    delete (a as { votos_projetados?: number }).votos_projetados;
    a.total_candidatos = (a.candidatos?.length ?? 0) + 5;
    for (const c of a.candidatos ?? []) {
      delete c.projecao;
      c.numero = 22_000 + n++;
    }
  }
  return d;
}

function dados(cargo: 7 | 8, uf: string) {
  const nacional = payloadCasa(cargo, {
    agremiacoes: [agremiacao("22", "PL", 3)],
    porUf: [linhaUf(uf, { lugares_a_preencher: 8, cadeiras_definidas: 8 })],
  });
  const detalhe: DeputadoUfDetailResult = {
    status: "ok",
    detail: objetoResumo(cargo, uf),
    url: `https://blob.teste/${uf}.json`,
  };
  return { nacional, detalhe, interruptor: LIGADO };
}

async function render(cargo: 7 | 8, uf: string): Promise<Document> {
  lerDadosDaCasaMock.mockResolvedValue(dados(cargo, uf));
  const markup = renderToStaticMarkup(await renderPaginaUfDeputado(cargo, uf));
  return new DOMParser().parseFromString(markup, "text/html");
}

function texto(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  lerDadosDaCasaMock.mockReset();
});

describe("RF-285 — modo resumo: nada de projeção, com o interruptor ligado", () => {
  it("🔴 M28 — sem `projecao` no objeto: nem a linha do estado da projeção, nem 'o que está movendo'", async () => {
    for (const [cargo, uf] of [
      [7, "SP"],
      [8, "DF"],
    ] as const) {
      const doc = await render(cargo, uf);
      expect(doc.querySelector("[data-testid='uf-projecao-estado']"), uf).toBeNull();
      expect(doc.querySelector("[data-testid='dep-movendo']"), uf).toBeNull();
      expect(doc.querySelector("[data-testid='uf-cadeiras-projetadas']"), uf).toBeNull();
      expect(doc.querySelector("[data-marca='projecao']"), uf).toBeNull();
      // A metodologia diz que o cargo é lido pelo resumo e que não há projeção
      // — em vez de "a projeção está ligada; só aparece quando…".
      const metodo = texto(doc.querySelector("[data-testid='dep-metodologia-projecao']"));
      expect(metodo).toContain("é lido pelo resumo");
      expect(metodo).not.toContain("A projeção está ligada no site");
    }
  });

  it("🔴 M29 — Conferência: 'não comparado' para o eleitorado, nunca 'fecha com o do boletim'", async () => {
    const doc = await render(7, "SP");
    const conf = doc.querySelector("[aria-labelledby='conferencia-heading']");
    const naoComparado = conf?.querySelector(
      "[data-testid='uf-nao-comparado'] [data-comparacao='eleitorado']",
    );
    expect(texto(naoComparado)).toContain("não comparado");
    expect(texto(naoComparado)).toContain("lido pelo resumo que o TSE publica por estado");
    const frase = texto(conf?.querySelector("[data-testid='uf-conferencia']"));
    // O que foi comparado aparece; o eleitorado, não.
    expect(frase).toContain("os eleitos são as mesmas pessoas");
    expect(frase).not.toContain("o eleitorado das zonas que lemos fecha");
  });
});

describe("RF-284 — o DF não é estado, e não tem Assembleia", () => {
  it("🔴 /uf/DF/deputado-distrital: 'Assembleia' e 'estado' (como unidade) não aparecem", async () => {
    const doc = await render(8, "DF");
    const t = texto(doc.body);
    expect(t).not.toContain("Assembleia");
    expect(t).not.toContain("Câmara dos Deputados");
    expect(t).not.toContain("Deputado Federal");
    // "estado" como NOME DA UNIDADE. "estado da projeção" (o status) não é
    // unidade — mas não deve nem aparecer em modo resumo; a varredura é total.
    const ocorrencias = [...t.matchAll(/.{0,40}\bestados?\b.{0,40}/giu)].map((m) => m[0]);
    expect(ocorrencias).toEqual([]);
    expect(t).toContain("Câmara Legislativa do Distrito Federal");
  });

  it("SP estadual: nada de Câmara dos Deputados nem Deputado Federal no corpo (só o seletor diz 'Federal')", async () => {
    const doc = await render(7, "SP");
    const t = texto(doc.body);
    expect(t).not.toContain("Câmara dos Deputados");
    expect(t).not.toContain("Deputado Federal");
    expect(t).toContain("Assembleia Legislativa de São Paulo");
  });
});

/**
 * O AC da fixture tem no máximo 9 candidaturas por agremiação — abaixo do
 * mínimo de 10, onde o corte nunca corta. Aqui a 1ª agremiação vai a 40
 * candidaturas (3 eleitos ⇒ 10 no documento) e a 2ª a 30, com 12 eleitos
 * (⇒ 17). A linha de corte acompanha o último eleito.
 */
function ampliado(d: DeputadoUfDetail): DeputadoUfDetail {
  const [a, b] = d.agremiacoes;
  for (const [agr, n, eleitos] of [
    [a, 40, 3],
    [b, 30, 12],
  ] as const) {
    if (!agr?.candidatos) throw new Error("fixture sem candidatos");
    const modelo = agr.candidatos[agr.candidatos.length - 1];
    const base = agr.candidatos.length;
    for (let i = base; i < n; i++) {
      agr.candidatos.push({
        ...structuredClone(modelo),
        sqcand: 90_000_000_000 + Number(agr.cod) * 1000 + i,
        nome: `Ampliado ${agr.cod} ${i + 1}`,
        rank: i + 1,
        votos: 10 - (i % 10),
        parcial: undefined,
      } as NonNullable<typeof agr.candidatos>[number]);
    }
    for (const c of agr.candidatos) {
      if (c.rank <= eleitos) c.parcial = "qp";
      else delete c.parcial;
    }
    agr.cadeiras = eleitos;
    agr.total_candidatos = n + 5;
    const ultimo = agr.candidatos.find((c) => c.rank === eleitos);
    const primeiro = agr.candidatos.find((c) => c.rank === eleitos + 1);
    if (agr.corte && ultimo && primeiro) {
      agr.corte = { ...agr.corte, ultimo_eleito: ultimo.sqcand, primeiro_fora: primeiro.sqcand };
    }
  }
  return d;
}

describe("listas: rota por casa e número de urna de 5 dígitos", () => {
  it("DF (rota de lista desde 03/10): 'mostrar todos' existe quando há candidatura fora do documento", async () => {
    const doc = await render(8, "DF");
    expect(doc.querySelector("[data-testid='dep-lista-agremiacao']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='dep-mostrar-todos']")).not.toBeNull();
  });

  it("🔴 assembleias: o documento leva eleitos + 7 por agremiação (emenda 04/10), tudo visível", async () => {
    for (const [cargo, uf] of [
      [7, "SP"],
      [8, "DF"],
    ] as const) {
      const d = ampliado(objetoResumo(cargo, uf));
      lerDadosDaCasaMock.mockResolvedValue({
        ...dados(cargo, uf),
        detalhe: { status: "ok", detail: d, url: "https://blob.teste/x.json" },
      });
      const markup = renderToStaticMarkup(await renderPaginaUfDeputado(cargo, uf));
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const cortadas: number[] = [];
      for (const agr of d.agremiacoes) {
        const eleitos = (agr.candidatos ?? []).filter((c) => c.parcial !== undefined);
        const ultimo = Math.max(0, ...eleitos.map((c) => c.rank));
        const esperado = Math.min(agr.candidatos?.length ?? 0, ultimo + 7);
        const lista = doc.querySelector(
          `[data-testid='dep-lista-agremiacao'][data-cod='${agr.cod}']`,
        );
        const ranks = [...(lista?.querySelectorAll("li[data-rank]") ?? [])].map((l) =>
          Number(l.getAttribute("data-rank")),
        );
        expect(ranks, `${uf}/${agr.cod}`).toEqual(
          Array.from({ length: esperado }, (_, i) => i + 1),
        );
        cortadas.push(ranks.length);
        // Nada recortado por CSS, e nunca "ver mais".
        expect(lista?.querySelector("[data-f]"), `${uf}/${agr.cod}`).toBeNull();
        expect(lista?.querySelector("[data-testid='dep-ver-mais']")).toBeNull();
        // O botão conta o que FALTA: total − no documento.
        const faltam = (agr.total_candidatos ?? 0) - esperado;
        const botao = lista?.querySelector("[data-testid='dep-mostrar-todos']");
        expect(texto(botao), `${uf}/${agr.cod}`).toBe(
          `Mostrar todos — mais ${faltam} ${faltam === 1 ? "candidato" : "candidatos"} de ${agr.sigla}`,
        );
      }
      // As duas ampliadas: 3 eleitos ⇒ 10 (de 40); 12 eleitos ⇒ 19 (de 30).
      expect(cortadas.slice(0, 2), uf).toEqual([10, 19]);
    }
  });

  it("SP estadual: 'mostrar todos' existe; o número de urna sai inteiro, com 5 dígitos", async () => {
    const doc = await render(7, "SP");
    expect(doc.querySelector("[data-testid='dep-mostrar-todos']")).not.toBeNull();
    const t = texto(doc.querySelector("[data-testid='dep-lista-agremiacao']"));
    expect(t).toContain("nº 22000");
    expect(t).not.toMatch(/nº 2200(?!\d)/);
  });
});
