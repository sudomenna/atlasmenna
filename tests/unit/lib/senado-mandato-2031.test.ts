/**
 * tests/unit/lib/senado-mandato-2031.test.ts — spec 023, RF-215; ADR-0062.
 *
 * 🔴 Este é o portão DURO da foto do Senado. O carregador em execução não
 * lança (derrubaria `/senador`); quem reprova uma foto errada é este arquivo,
 * no PR — antes de ela chegar a alguém.
 *
 * Três partes:
 *   1. o arquivo VERSIONADO (`editorial/senado/`) cumpre as invariantes;
 *   2. o validador reprova cada violação, uma a uma (fixture FICTÍCIA);
 *   3. a data da foto sai no fuso do projeto.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  dataDaFoto,
  MANDATO_2031,
  partidoAceito,
  SEM_PARTIDO,
  UFS_DO_SENADO,
  validarMandato2027,
  validarMandato2031,
} from "@/lib/senado/mandato-2031";
import { normalizePartySlug } from "@/lib/utils/party-color";
import fixture from "@/tests/fixtures/senado/mandato-2031.fixture.json" with { type: "json" };

const RAIZ = path.resolve(__dirname, "../../..");

function lerEditorial(nome: string): unknown {
  return JSON.parse(readFileSync(path.join(RAIZ, "editorial/senado", nome), "utf8"));
}

type Foto = { senadores: Array<Record<string, unknown>> } & Record<string, unknown>;
const copia = (): Foto => structuredClone(fixture) as unknown as Foto;

describe("a foto VERSIONADA dos 27 mandatos até 2031 (editorial/senado/mandato-2031.json)", () => {
  const bruto = lerEditorial("mandato-2031.json");
  const v = validarMandato2031(bruto);

  it("passa em todas as invariantes", () => {
    expect(v.ok ? [] : v.erros).toEqual([]);
  });

  it("27 entradas, uma por UF, as 27 do país", () => {
    if (!v.ok) throw new Error("foto inválida");
    const ufs = v.mandato.senadores.map((s) => s.uf).sort();
    expect(ufs).toHaveLength(27);
    expect(ufs).toEqual([...UFS_DO_SENADO]);
  });

  it("todo partido é da paleta, ou exatamente 'S/Partido' — nenhum cai em 'outros' calado", () => {
    if (!v.ok) throw new Error("foto inválida");
    for (const s of v.mandato.senadores) {
      if (s.partido === SEM_PARTIDO) continue;
      expect(normalizePartySlug(s.partido), `${s.uf} ${s.partido}`).not.toBe("outros");
    }
  });

  it("é o que o carregador da página entrega (MANDATO_2031 vem deste arquivo)", () => {
    expect(MANDATO_2031).toEqual(v);
  });

  it("lista branca: nenhum nome civil, nascimento, contato nem bloco", () => {
    const texto = JSON.stringify(bruto);
    for (const proibido of ["nome_completo", "nascimento", "cpf", "email", "telefone", "bloco"]) {
      expect(texto.toLowerCase(), proibido).not.toContain(proibido);
    }
  });

  it("a data da foto aparece e é a de 29/09/2026 no fuso do projeto", () => {
    if (!v.ok) throw new Error("foto inválida");
    expect(dataDaFoto(v.mandato)).toBe("29/09/2026");
  });
});

describe("a foto VERSIONADA dos 54 que ocupam as vagas em disputa (mandato-2027.json)", () => {
  it("54 entradas, duas por UF, mandato terminando na legislatura 57", () => {
    const v = validarMandato2027(lerEditorial("mandato-2027.json"));
    expect(v.ok ? [] : v.erros).toEqual([]);
    if (!v.ok) return;
    expect(v.mandato.senadores).toHaveLength(54);
  });

  it("nenhum código de mandato se repete entre as duas fotos (81 distintos)", () => {
    const a = lerEditorial("mandato-2031.json") as Foto;
    const b = lerEditorial("mandato-2027.json") as Foto;
    const codigos = [...a.senadores, ...b.senadores].map((s) => s.codigo_mandato);
    expect(new Set(codigos).size).toBe(81);
  });
});

describe("validarMandato2031 — cada invariante reprova sozinha (fixture FICTÍCIA)", () => {
  it("a fixture passa", () => {
    const v = validarMandato2031(copia());
    expect(v.ok ? [] : v.erros).toEqual([]);
  });

  // 🔴 MUTAÇÃO: trocar a conferência "exatamente porUf por UF" por "pelo menos
  // uma" — uma foto de 26 passaria.
  it("26 entradas ⇒ recusa, nomeando a UF que falta e a contagem", () => {
    const f = copia();
    f.senadores = f.senadores.filter((s) => s.uf !== "AC");
    const v = validarMandato2031(f);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.erros.join("\n")).toContain("UF AC aparece 0 vez");
    expect(v.erros.join("\n")).toContain("26 entradas");
  });

  it("duas do mesmo estado (e nenhuma de outro) ⇒ recusa", () => {
    const f = copia();
    (f.senadores[1] as Record<string, unknown>).uf = "AC";
    const v = validarMandato2031(f);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.erros.join("\n")).toMatch(/UF AC aparece 2 vez/);
  });

  it("partido fora da paleta ⇒ recusa, com a dica da sigla do TSE", () => {
    const f = copia();
    (f.senadores[0] as Record<string, unknown>).partido = "PODEMOS";
    const v = validarMandato2031(f);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.erros.join("\n")).toContain('partido "PODEMOS"');
  });

  it("'S/Partido' EXATO é aceito; outra grafia não", () => {
    expect(partidoAceito("S/Partido")).toBe(true);
    for (const quase of ["S/ Partido", "s/partido", "Sem partido", "SEM PARTIDO"]) {
      expect(partidoAceito(quase), quase).toBe(false);
    }
    const f = copia();
    (f.senadores[0] as Record<string, unknown>).partido = "S/Partido";
    expect(validarMandato2031(f).ok).toBe(true);
  });

  it("campo fora da lista branca ⇒ recusa (nome civil, nascimento)", () => {
    for (const campo of ["nome_completo", "data_nascimento"]) {
      const f = copia();
      (f.senadores[0] as Record<string, unknown>)[campo] = "x";
      const v = validarMandato2031(f);
      expect(v.ok, campo).toBe(false);
    }
  });

  it("suplente sem titular ⇒ recusa", () => {
    const f = copia();
    const s = f.senadores.find((x) => x.participacao === "Suplente em exercício") as Record<
      string,
      unknown
    >;
    delete s.titular_do_mandato;
    expect(validarMandato2031(f).ok).toBe(false);
  });

  it("mandato que não termina em 2031 (legislatura 57) ⇒ recusa", () => {
    const f = copia();
    (f.senadores[0] as Record<string, unknown>).legislaturas = [56, 57];
    const v = validarMandato2031(f);
    expect(v.ok).toBe(false);
  });

  it("código de mandato repetido ⇒ recusa", () => {
    const f = copia();
    (f.senadores[1] as Record<string, unknown>).codigo_mandato = f.senadores[0]?.codigo_mandato;
    expect(validarMandato2031(f).ok).toBe(false);
  });

  it("sem data de consulta, sem versão, ou URL não-https ⇒ recusa", () => {
    for (const [campo, valor] of [
      ["consultado_em", "ontem"],
      ["versao_dataset", ""],
      ["fonte_url", "http://inseguro"],
    ] as const) {
      const f = copia();
      f[campo] = valor;
      expect(validarMandato2031(f).ok, campo).toBe(false);
    }
  });

  it("não lança com lixo — devolve o erro", () => {
    for (const lixo of [null, 42, "x", [], {}]) {
      expect(() => validarMandato2031(lixo)).not.toThrow();
      expect(validarMandato2031(lixo).ok).toBe(false);
    }
  });
});

describe("dataDaFoto — fuso do projeto, não do servidor", () => {
  it("04h47 UTC de 29/09 é 29/09 em Brasília; 02h00 UTC de 30/09 ainda é 29/09", () => {
    expect(dataDaFoto({ consultado_em: "2026-09-29T04:47:02Z" })).toBe("29/09/2026");
    expect(dataDaFoto({ consultado_em: "2026-09-30T02:00:00Z" })).toBe("29/09/2026");
  });
});
