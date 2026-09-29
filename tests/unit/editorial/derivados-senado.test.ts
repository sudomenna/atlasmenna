// Os DOIS arquivos derivados versionados em `editorial/derivados/`:
//   - alinhamento-senado.json  (`pnpm alinhamento:senado`)
//   - trajetoria-senado.json   (`pnpm trajetoria:senado`)
//
// Lê os arquivos GERADOS (não uma fixture) e reprova quando eles perdem a forma
// do contrato ou carregam dado pessoal. É a varredura que o ADR-0062 pede
// ("um teste que varre os arquivos gerados atrás de data de nascimento e CPF"):
// estrutural e por lista branca, porque uma varredura só por padrão de texto
// passa com o nome da pessoa ao lado.
//
// O teste NÃO regera nada nem toca a rede: refazer os arquivos é decisão do dono.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lerCarimboRevisao } from "@/data-pipeline/_revisao-derivado.ts";
import { FONTE_ALINHAMENTO_SENADO } from "@/data-pipeline/alinhamento-senado.ts";
import { FONTE_TRAJETORIA_SENADO, TRAJETORIAS_SENADO } from "@/data-pipeline/trajetoria-senado.ts";

const lerDerivado = (nome: string): unknown =>
  JSON.parse(readFileSync(resolve(process.cwd(), "editorial/derivados", nome), "utf8"));

const DATA = /\d{4}-\d{2}-\d{2}/;
const CHAVES_PROIBIDAS = /nasc|cpf|e-?mail|titulo|nome|partido|sigla|ocupacao|endereco|telefone/i;

/** Nomes de campo de um JSON em qualquer profundidade. Só para objetos cujas chaves são NOMES DE CAMPO. */
function chavesDeCampo(v: unknown, saida: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const x of v) chavesDeCampo(x, saida);
  } else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      saida.push(k);
      chavesDeCampo(x, saida);
    }
  }
  return saida;
}

describe("editorial/derivados/alinhamento-senado.json", () => {
  const a = lerDerivado("alinhamento-senado.json") as {
    revisao: unknown;
    corte: string;
    fonte: unknown;
    universo: { votacoes: number; disputadas: number; excluidas_sem_sequencial: number };
    por_senador: Record<string, { votos_disputadas: number; taxa_disputadas: number }>;
  };

  it("tem exatamente as chaves do contrato, e a fonte declarada no código", () => {
    expect(Object.keys(a)).toEqual(["revisao", "corte", "fonte", "universo", "por_senador"]);
    // O carimbo do dono (§ 2 (b)) existe e é bem formado — "nao" ou "sim" com data e nome.
    expect(lerCarimboRevisao(a, "alinhamento-senado.json").ok).toBe(true);
    expect(a.fonte).toEqual(FONTE_ALINHAMENTO_SENADO);
    expect(Object.keys(a.universo)).toEqual(["votacoes", "disputadas", "excluidas_sem_sequencial"]);
  });

  it("o corte é uma data da 57ª legislatura, não futura", () => {
    expect(a.corte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.corte >= "2023-02-01").toBe(true);
    expect(a.corte <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("universo coerente: disputadas ≤ votações, todos inteiros", () => {
    const u = a.universo;
    for (const n of Object.values(u)) expect(Number.isInteger(n)).toBe(true);
    expect(u.votacoes).toBeGreaterThan(0);
    expect(u.disputadas).toBeGreaterThan(0);
    expect(u.disputadas).toBeLessThanOrEqual(u.votacoes);
    expect(u.excluidas_sem_sequencial).toBeGreaterThanOrEqual(0);
  });

  it("por_senador: código numérico → { votos_disputadas, taxa_disputadas } e mais nada", () => {
    const entradas = Object.entries(a.por_senador);
    expect(entradas.length).toBeGreaterThan(0);
    for (const [codigo, v] of entradas) {
      expect(codigo).toMatch(/^\d+$/);
      expect(Object.keys(v)).toEqual(["votos_disputadas", "taxa_disputadas"]);
      expect(Number.isInteger(v.votos_disputadas)).toBe(true);
      expect(v.votos_disputadas).toBeGreaterThanOrEqual(1);
      // Ninguém vota em mais votações disputadas do que as que existiram.
      expect(v.votos_disputadas).toBeLessThanOrEqual(a.universo.disputadas);
      expect(v.taxa_disputadas).toBeGreaterThanOrEqual(0);
      expect(v.taxa_disputadas).toBeLessThanOrEqual(100);
      expect(Math.round(v.taxa_disputadas * 10) / 10).toBe(v.taxa_disputadas);
    }
  });

  it("sem dado pessoal: nenhum nome de campo suspeito e nenhuma data além do corte", () => {
    const { por_senador, ...resto } = a;
    expect(chavesDeCampo(resto).filter((k) => CHAVES_PROIBIDAS.test(k))).toEqual([]);
    // Os campos de cada senador são exatos no teste acima; aqui, os nomes que o
    // objeto `por_senador` tem por dentro (`votos_disputadas`, `taxa_disputadas`).
    const camposDeSenador = new Set(Object.values(por_senador).flatMap((v) => Object.keys(v)));
    expect([...camposDeSenador].sort()).toEqual(["taxa_disputadas", "votos_disputadas"]);
    // A data do carimbo do dono é a única outra data admitida — e fica fora da varredura.
    const { revisao: _carimbo, ...semCarimbo } = a;
    expect(JSON.stringify(semCarimbo).match(new RegExp(DATA, "g"))).toEqual([a.corte]);
  });
});

describe("editorial/derivados/trajetoria-senado.json", () => {
  const t = lerDerivado("trajetoria-senado.json") as {
    revisao: unknown;
    gerado_em: string;
    fonte: unknown;
    universo: number;
    por_sqcand: Record<string, { t: string; senado_codigos: number[] }>;
  };

  it("tem exatamente as chaves do contrato, e a fonte declarada no código", () => {
    expect(Object.keys(t)).toEqual(["revisao", "gerado_em", "fonte", "universo", "por_sqcand"]);
    expect(lerCarimboRevisao(t, "trajetoria-senado.json").ok).toBe(true);
    expect(t.fonte).toEqual(FONTE_TRAJETORIA_SENADO);
    expect(t.gerado_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Date.parse(t.gerado_em)).toBeLessThanOrEqual(Date.now());
  });

  // `universo` é o que permite afirmar "este sqcand não está no arquivo" em vez de
  // inferir "estreante" por ausência.
  it("universo = número de candidaturas; uma entrada por sqcand", () => {
    expect(t.universo).toBeGreaterThan(0);
    expect(Object.keys(t.por_sqcand)).toHaveLength(t.universo);
  });

  it("sqcand é texto numérico, em ordem numérica crescente", () => {
    const chaves = Object.keys(t.por_sqcand);
    for (const c of chaves) expect(c).toMatch(/^\d{9,15}$/);
    const ordenadas = [...chaves].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    expect(chaves).toEqual(ordenadas);
  });

  it("cada entrada é { t, senado_codigos } e mais nada; estreante ⇔ nenhum código", () => {
    for (const v of Object.values(t.por_sqcand)) {
      expect(Object.keys(v)).toEqual(["t", "senado_codigos"]);
      expect(TRAJETORIAS_SENADO as readonly string[]).toContain(v.t);
      expect(v.senado_codigos.every((c) => Number.isInteger(c) && c > 0)).toBe(true);
      expect([...v.senado_codigos].sort((a, b) => a - b)).toEqual(v.senado_codigos);
      expect(new Set(v.senado_codigos).size).toBe(v.senado_codigos.length);
      expect(v.t === "estreante").toBe(v.senado_codigos.length === 0);
    }
  });

  it("sem dado pessoal: nenhum nome de campo suspeito e nenhuma data além do carimbo", () => {
    const { por_sqcand, ...resto } = t;
    expect(chavesDeCampo(resto).filter((k) => CHAVES_PROIBIDAS.test(k))).toEqual([]);
    const camposDeEntrada = new Set(Object.values(por_sqcand).flatMap((v) => Object.keys(v)));
    expect([...camposDeEntrada].sort()).toEqual(["senado_codigos", "t"]);
    expect(JSON.stringify({ ...t, gerado_em: "", revisao: null })).not.toMatch(DATA);
  });
});
