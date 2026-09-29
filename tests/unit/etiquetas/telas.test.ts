/**
 * tests/unit/etiquetas/telas.test.ts — a junção etiqueta ↔ lista das capas e
 * das páginas de UF (spec 025, RF-245/247): quem ganha chip, os tokens do
 * filtro, as opções do `<select>`, e a invariância de ordem.
 */

import { describe, expect, it } from "vitest";

import { CATEGORIAS_CHIP, categoriaExibivel } from "@/lib/etiquetas/catalogo";
import {
  categoriasDoFiltroLiberadas,
  editorialDaCapa,
  etiquetasDaLista,
  etiquetasDasCorridas,
  opcoesDoFiltro,
  todosOsTokensDoCatalogo,
} from "@/lib/etiquetas/telas";
import { cand, payloadTresUfs, ufRow } from "@/tests/fixtures/senado/payload-senado";

import { etiquetasDeTeste, relacaoFixa, universoDoPayload } from "./_visoes-fixtures";

const payload = payloadTresUfs();
const universo = universoDoPayload(payload, 5);

describe("RF-245 — chips das capas: só quem tem chance, só com a chave ligada", () => {
  it("🔴 `chips` desligado ⇒ mapa vazio (a capa sai idêntica)", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa });
    expect(
      etiquetasDasCorridas(e, payload.por_uf, { cargo: 5, turno: 1, preEleicao: false }).size,
    ).toBe(0);
    expect(
      editorialDaCapa(e, payload.por_uf, { cargo: 5, turno: 1, preEleicao: false }).aviso,
    ).toBe(false);
  });

  it("ligado: chips para os com chance; o NOVO de MG (a 20 pontos da vaga) fica sem", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["chips"] });
    // Com o número da Parcial em todo candidato — sem ele, a regra do portão
    // ("sem número numa base, com chance") poria o NOVO para dentro.
    const mgComParcial = ufRow("MG", 40, [
      cand(151, "MDB", 35, { pct_atual: 35 }),
      cand(777, "PSOL", 30, { destino: "anulado", pct_atual: 30 }),
      cand(221, "PL", 25, { pct_atual: 25 }),
      cand(400, "NOVO", 5, { pct_atual: 5 }),
    ]);
    const m = etiquetasDasCorridas(e, [mgComParcial], {
      cargo: 5,
      turno: 1,
      preEleicao: false,
      vagasUf: 2,
    });
    const mg = m.get("MG");
    expect(mg).toBeDefined();
    const novo = cand(400, "NOVO", 5).sqcand as string;
    const pl = cand(221, "PL", 25).sqcand as string;
    expect(mg?.porSqcand.has(pl)).toBe(true);
    expect(mg?.porSqcand.has(novo)).toBe(false);
    // Sem o filtro, nenhum token vai ao HTML.
    expect(mg?.tokens).toBeUndefined();
    // Só categorias de chip com critério publicado.
    for (const r of mg?.porSqcand.values() ?? []) {
      for (const cat of Object.keys(r)) {
        expect(CATEGORIAS_CHIP).toContain(cat);
        expect(categoriaExibivel(cat)).toBe(true);
      }
    }
  });

  it("filtro ligado: tokens por corrida, na ordem do catálogo; opções só do que aparece", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["filtro"] });
    const capa = editorialDaCapa(e, payload.por_uf, {
      cargo: 5,
      turno: 1,
      preEleicao: false,
      vagasUf: 2,
    });
    // SP: PT (base), PL (oposição), MDB (independente, a 1 ponto da vaga).
    expect(capa.tokens("SP")).toBe(
      "relacao_governo:base_governo relacao_governo:oposicao relacao_governo:independente",
    );
    expect(capa.aviso).toBe(true);
    expect(capa.filtro.map((g) => g.categoria)).toEqual(["relacao_governo"]);
    expect(capa.filtro[0]?.opcoes.map((o) => o.rotulo)).toEqual([
      "Base do governo",
      "Oposição",
      "Independente",
    ]);
    // `chips()` nunca repete os tokens (no /senador eles vão no <li>).
    expect(capa.chips("SP")?.tokens).toBeUndefined();
  });

  it("tokens da corrida seguem o CATÁLOGO, não a ordem dos candidatos (permutar não muda nada)", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["filtro"] });
    const sp = payload.por_uf.find((r) => r.sigla === "SP");
    if (!sp) throw new Error("fixture sem SP");
    const invertida = { ...sp, top_candidatos: [...sp.top_candidatos].reverse() };
    const o = { cargo: 5 as const, turno: 1 as const, preEleicao: false, vagasUf: 2 };
    expect(etiquetasDasCorridas(e, [invertida], o).get("SP")?.tokens).toBe(
      etiquetasDasCorridas(e, [sp], o).get("SP")?.tokens,
    );
  });

  it("etiquetasDaLista: todo candidato, na ordem da lista; vazio com chips desligado", () => {
    const off = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa });
    expect(
      etiquetasDaLista(off, payload.por_uf[0]?.top_candidatos ?? [], 5, 1, CATEGORIAS_CHIP).size,
    ).toBe(0);
    const on = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["chips"] });
    const lista = payload.por_uf[0]?.top_candidatos ?? [];
    const m = etiquetasDaLista(on, lista, 5, 1, CATEGORIAS_CHIP);
    expect(m.size).toBe(lista.length);
    // `sqcand` numérico (Deputado no Blob) junta igual ao texto (RF-232).
    const num = etiquetasDaLista(
      on,
      lista.map((c) => ({ sqcand: Number(c.sqcand) })),
      5,
      1,
      CATEGORIAS_CHIP,
    );
    expect([...num.keys()]).toEqual([...m.keys()]);
  });
});

describe("🔴 § 2 (f) — o filtro passa pelo portão de cobertura, categoria a categoria", () => {
  const o = { cargo: 5 as const, turno: 1 as const, preEleicao: false, vagasUf: 2 };
  const todos = payload.por_uf.flatMap((r) => r.top_candidatos.map((c) => c.sqcand as string));

  it("um candidato COM chance sem classificação ⇒ a categoria não vira opção; nenhuma ⇒ sem filtro", () => {
    // NOVO de MG sem número na Parcial ⇒ conta como com chance; o partido fica sem padrão.
    const e = etiquetasDeTeste({
      universo,
      relacaoPorPartido: (s) => (s === "NOVO" ? null : relacaoFixa(s)),
      ligadas: ["filtro"],
    });
    expect(categoriasDoFiltroLiberadas(e, payload.por_uf, o)).toEqual([]);
    const capa = editorialDaCapa(e, payload.por_uf, o);
    expect(capa.filtro).toEqual([]);
    expect(capa.tokens("SP")).toBeUndefined();
    expect(capa.atributos("SP")).toEqual({});
    expect(capa.aviso).toBe(false);
  });

  it("o mesmo NOVO SEM chance (a 20 pontos da vaga na Parcial) não fecha o portão", () => {
    const e = etiquetasDeTeste({
      universo,
      relacaoPorPartido: (s) => (s === "NOVO" ? null : relacaoFixa(s)),
      ligadas: ["filtro"],
    });
    const mgComParcial = ufRow("MG", 40, [
      cand(151, "MDB", 35, { pct_atual: 35 }),
      cand(777, "PSOL", 30, { destino: "anulado", pct_atual: 30 }),
      cand(221, "PL", 25, { pct_atual: 25 }),
      cand(400, "NOVO", 5, { pct_atual: 5 }),
    ]);
    expect(categoriasDoFiltroLiberadas(e, [mgComParcial], o)).toEqual(["relacao_governo"]);
    expect(editorialDaCapa(e, [mgComParcial], o).filtro.map((g) => g.categoria)).toEqual([
      "relacao_governo",
    ]);
  });

  it("🔴 categoria com cobertura PARCIAL fica fora; a com cobertura total entra (mutação: tirar o portão)", () => {
    // Relação: todos classificados (padrão do partido). Trajetória: UMA linha
    // individual, no PT de SP — os demais com chance ficam sem.
    const pt = cand(131, "PT", 40).sqcand as string;
    const e = etiquetasDeTeste({
      universo,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["filtro"],
      linhas: {
        "senador.csv": [{ chave: pt, categoria: "trajetoria_cargo", valor: "estreante" }],
      },
    });
    expect(e.resolver(pt, 5, 1).trajetoria_cargo.estado).toBe("classificado");
    expect(categoriasDoFiltroLiberadas(e, payload.por_uf, o)).toEqual(["relacao_governo"]);
    const capa = editorialDaCapa(e, payload.por_uf, o);
    expect(capa.filtro.map((g) => g.categoria)).toEqual(["relacao_governo"]);
    expect(capa.tokens("SP")).not.toContain("trajetoria_cargo");

    // Com TODOS classificados na trajetória, ela passa a ser opção.
    const cheio = etiquetasDeTeste({
      universo,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["filtro"],
      linhas: {
        "senador.csv": todos.map((sq) => ({
          chave: sq,
          categoria: "trajetoria_cargo",
          valor: "estreante",
        })),
      },
    });
    expect(categoriasDoFiltroLiberadas(cheio, payload.por_uf, o)).toEqual([
      "relacao_governo",
      "trajetoria_cargo",
    ]);
    expect(editorialDaCapa(cheio, payload.por_uf, o).tokens("SP")).toContain(
      "trajetoria_cargo:estreante",
    );
  });

  it("sem corrida nenhuma na página ⇒ nada liberado", () => {
    const e = etiquetasDeTeste({ universo, relacaoPorPartido: relacaoFixa, ligadas: ["filtro"] });
    expect(categoriasDoFiltroLiberadas(e, [], o)).toEqual([]);
  });
});

describe("RF-247 — opções do filtro", () => {
  it("🔴 categoria sem critério publicado não vira opção, mesmo presente na página", () => {
    const grupos = opcoesDoFiltro([
      "impeachment_stf:a_favor campo_ideologico:esquerda relacao_governo:oposicao",
    ]);
    const cats = grupos.map((g) => g.categoria);
    expect(cats).toContain("relacao_governo");
    for (const c of cats) expect(categoriaExibivel(c)).toBe(true);
  });

  it("o universo de tokens do catálogo nunca inclui a sentinela nem 'centrão: não'", () => {
    const t = todosOsTokensDoCatalogo();
    expect(t).not.toContain("centrao:nao");
    expect(t.some((x) => x.includes("a_classificar"))).toBe(false);
    expect(t).toContain("impeachment_stf:a_favor");
  });
});
