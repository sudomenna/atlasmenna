/**
 * tests/unit/etiquetas/catalogo.test.ts
 *
 * O catálogo único (spec 024, RF-220). Os rótulos e a ordem são decisão do
 * dono (29/09) — afirmados em LITERAL, nunca derivados do próprio catálogo.
 */

import { describe, expect, it } from "vitest";

import {
  A_CLASSIFICAR,
  ALINHAMENTO_BASE_MIN,
  ALINHAMENTO_CORTE,
  ALINHAMENTO_MIN_VOTOS_DISPUTADAS,
  ALINHAMENTO_OPOSICAO_MAX,
  blocoDoHemiciclo,
  CATEGORIA_DA_VISAO,
  CATEGORIAS,
  categoriasDoAlvo,
  ORDEM_BLOCOS_HEMICICLO,
  ORDEM_CATEGORIAS,
  PORTAO_MARGEM_PP,
  rotuloDoValor,
  SEM_PARTIDO,
  TRAJETORIA_PARA_VALOR,
  todasDesligadas,
  VISOES,
  valorDoCatalogo,
} from "@/lib/etiquetas/catalogo";

const rotulos = (id: string) => CATEGORIAS.find((c) => c.id === id)?.valores.map((v) => v.rotulo);

describe("RF-220 — catálogo", () => {
  it("categorias na ordem fixa", () => {
    expect(ORDEM_CATEGORIAS).toEqual([
      "campo_ideologico",
      "palanque_presidencial",
      "relacao_governo",
      "centrao",
      "trajetoria_cargo",
      "impeachment_stf",
    ]);
  });

  it("rótulos exatamente como o dono decidiu, na ordem de exibição", () => {
    expect(rotulos("campo_ideologico")).toEqual([
      "Esquerda",
      "Centro-esquerda",
      "Centro",
      "Centro-direita",
      "Direita",
      "Sem posição clara",
    ]);
    expect(rotulos("palanque_presidencial")).toEqual([
      "Palanque de Lula",
      "Palanque de Flávio Bolsonaro",
      "Palanque duplo",
      "Sem palanque declarado",
    ]);
    expect(rotulos("relacao_governo")).toEqual(["Base do governo", "Oposição", "Independente"]);
    expect(rotulos("centrao")).toEqual(["Centrão", null]);
    expect(rotulos("trajetoria_cargo")).toEqual([
      "Tenta a reeleição",
      "Volta ao cargo",
      "Estreante no cargo",
    ]);
    expect(rotulos("impeachment_stf")).toEqual(["A favor", "Contra", "Sem posição pública"]);
  });

  it("ids em snake_case e únicos; `a_classificar` NUNCA é valor", () => {
    for (const c of CATEGORIAS) {
      const ids = c.valores.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(ids).not.toContain(A_CLASSIFICAR);
    }
  });

  it("matriz alvo × categoria e herança por partido", () => {
    expect(categoriasDoAlvo(3)).toEqual([
      "campo_ideologico",
      "palanque_presidencial",
      "relacao_governo",
      "centrao",
      "trajetoria_cargo",
    ]);
    expect(categoriasDoAlvo(5)).toContain("impeachment_stf");
    expect(categoriasDoAlvo(6)).not.toContain("impeachment_stf");
    expect(categoriasDoAlvo("senado2031")).toEqual([
      "campo_ideologico",
      "palanque_presidencial",
      "relacao_governo",
      "centrao",
      "impeachment_stf",
    ]);
    const herda = CATEGORIAS.filter((c) => c.herdaDoPartido).map((c) => c.id);
    expect(herda).toEqual([
      "campo_ideologico",
      "palanque_presidencial",
      "relacao_governo",
      "centrao",
    ]);
    expect(CATEGORIAS.filter((c) => c.porTurno).map((c) => c.id)).toEqual([
      "palanque_presidencial",
    ]);
  });

  it("limiares num único lugar", () => {
    expect([
      ALINHAMENTO_BASE_MIN,
      ALINHAMENTO_OPOSICAO_MAX,
      ALINHAMENTO_MIN_VOTOS_DISPUTADAS,
    ]).toEqual([65, 35, 30]);
    expect(PORTAO_MARGEM_PP).toBe(5);
    expect(ALINHAMENTO_CORTE).toBe("2026-09-03");
  });

  it("mapeamento da trajetória (decisão do dono)", () => {
    expect(TRAJETORIA_PARA_VALOR).toEqual({
      em_exercicio: "tenta_reeleicao",
      legislatura_atual: "tenta_reeleicao",
      mandato_anterior: "volta_ao_cargo",
      estreante: "estreante",
    });
  });

  it("🔴 rotuloDoValor nunca devolve texto para a sentinela, id desconhecido ou centrão 'nao'", () => {
    expect(rotuloDoValor("relacao_governo", A_CLASSIFICAR)).toBeNull();
    expect(rotuloDoValor("relacao_governo", "valor_do_futuro")).toBeNull();
    expect(rotuloDoValor("categoria_do_futuro", "x")).toBeNull();
    expect(rotuloDoValor("centrao", "nao")).toBeNull();
    expect(rotuloDoValor("centrao", "sim")).toBe("Centrão");
    expect(rotuloDoValor("relacao_governo", null)).toBeNull();
    expect(valorDoCatalogo("centrao", "nao")).not.toBeNull(); // é dado, só não é etiqueta
  });

  it("hemiciclo por bloco: base → independente → aguardando → oposição", () => {
    expect(ORDEM_BLOCOS_HEMICICLO).toEqual([
      "base_governo",
      "independente",
      "aguardando",
      "oposicao",
    ]);
    expect(blocoDoHemiciclo(A_CLASSIFICAR)).toBe("aguardando");
    expect(blocoDoHemiciclo(undefined)).toBe("aguardando");
    expect(blocoDoHemiciclo("oposicao")).toBe("oposicao");
  });

  it("visões e chaves", () => {
    expect([...VISOES]).toEqual(["chips", "filtro", "v1", "v2", "v3", "v4", "camara2027"]);
    expect(Object.values(todasDesligadas()).every((v) => v === false)).toBe(true);
    expect(Object.keys(CATEGORIA_DA_VISAO).sort()).toEqual([...VISOES].sort());
  });

  it("sem partido", () => {
    expect(SEM_PARTIDO.test("S/Partido")).toBe(true);
    expect(SEM_PARTIDO.test("PSD")).toBe(false);
  });
});
