/**
 * tests/unit/blob/paths.test.ts
 *
 * Esquema de caminho e URL determinística do Vercel Blob (ADR-0032, ADR-0026).
 *
 * O que estes testes existem para impedir:
 *   - Um pathname com dois-pontos voltar a entrar. Ele "funciona" no `put()`
 *     mas produz URL percent-encoded, e uma concatenação ingênua devolve 404
 *     só em produção — o modo de falha mais caro possível na noite da apuração.
 *   - A URL deixar de ser determinística. O read path monta a URL a partir do
 *     pathname, sem índice nem lookup; se essa premissa cair, o drill-down
 *     municipal para de existir sem nenhum erro em lugar nenhum.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertValidBlobSegment,
  blobPathname,
  blobPublicBaseUrl,
  blobUrlFor,
  candidatoFotoBlobPathname,
  candidatosIndexBlobPathname,
  candidatosUfBlobPathname,
  deputadoUfBlobPathname,
  deputadoUfListaBlobPathname,
  ufDetailBlobPathname,
} from "@/lib/blob/paths";

const ENV_KEYS = ["BLOB_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("esquema de caminho", () => {
  it("detalhe de UF usa os mesmos qualificadores da chave de Global Config", () => {
    expect(ufDetailBlobPathname("SP", "pres", 1)).toBe("municipios/uf/SP/pres/t1.json");
    expect(ufDetailBlobPathname("SP", "gov", 1)).toBe("municipios/uf/SP/gov/t1.json");
    expect(ufDetailBlobPathname("RJ", "pres", 2)).toBe("municipios/uf/RJ/pres/t2.json");
  });

  it("normaliza a sigla para maiúscula", () => {
    expect(ufDetailBlobPathname("sp", "pres", 1)).toBe("municipios/uf/SP/pres/t1.json");
  });

  it("Deputado (ADR-0026) sai do MESMO construtor de base — não de um segundo padrão", () => {
    expect(deputadoUfBlobPathname("SP")).toBe("deputado/uf/SP.json");
  });

  it("spec 026: a lista 61+ tem caminho PRÓPRIO, fora do prefixo do objeto da UF", () => {
    expect(deputadoUfListaBlobPathname("SP")).toBe("deputado/uf-lista/SP.json");
    expect(deputadoUfListaBlobPathname("sp")).toBe("deputado/uf-lista/SP.json");
    // `deputado/uf/SP` não pode casar os dois recursos.
    expect(deputadoUfListaBlobPathname("SP").startsWith("deputado/uf/SP")).toBe(false);
    expect(() => deputadoUfListaBlobPathname("S")).toThrow(/sigla/);
    expect(() => deputadoUfListaBlobPathname("../SP")).toThrow();
  });

  it("nenhum caminho carrega dois-pontos — a URL sairia percent-encoded", () => {
    const caminhos = [
      ufDetailBlobPathname("SP", "pres", 1),
      ufDetailBlobPathname("MG", "gov", 2),
      deputadoUfBlobPathname("BA"),
    ];
    for (const c of caminhos) {
      expect(c).not.toContain(":");
      // Só usa caracteres que sobrevivem intactos numa URL.
      expect(encodeURI(c)).toBe(c);
    }
  });

  it("recusa sigla malformada em vez de gerar um caminho que só falha em produção", () => {
    expect(() => ufDetailBlobPathname("SPP", "pres", 1)).toThrow(/sigla de UF inválida/);
    expect(() => ufDetailBlobPathname("", "pres", 1)).toThrow(/sigla de UF inválida/);
  });

  it("recusa segmento com dois-pontos e diz por quê", () => {
    expect(() => assertValidBlobSegment("uf:SP", "teste")).toThrow(/percent-encoded/);
    expect(() => blobPathname(["municipios", "uf:SP"], "teste")).toThrow(/inválido/);
  });
});

// ---------------------------------------------------------------------------
// Extensão parametrizada — ADR-0041 item 2
// ---------------------------------------------------------------------------

describe("extensão de arquivo (ADR-0041 item 2)", () => {
  it("SEM o 3º argumento o caminho continua terminando em .json", () => {
    // Chamada com DOIS argumentos, de propósito: é o contrato que os
    // chamadores anteriores ao ADR-0041 usam. Um default trocado para "" (ou
    // para qualquer outra coisa) reprova aqui.
    expect(blobPathname(["a"], "teste")).toBe("a.json");
    expect(blobPathname(["a", "b", "c"], "teste")).toBe("a/b/c.json");
  });

  it("os chamadores anteriores ao ADR-0041 produzem os MESMOS caminhos de antes", () => {
    // Literais, não derivados: se o default do 3º parâmetro regredir, estes
    // três valores mudam e o teste reprova. É a trava de compatibilidade que o
    // ADR-0041 prometeu ("preserva os três chamadores existentes byte a byte").
    expect(ufDetailBlobPathname("SP", "pres", 1)).toBe("municipios/uf/SP/pres/t1.json");
    expect(ufDetailBlobPathname("MG", "gov", 2)).toBe("municipios/uf/MG/gov/t2.json");
    expect(deputadoUfBlobPathname("BA")).toBe("deputado/uf/BA.json");
  });

  it("aceita extensão explícita com ponto", () => {
    expect(blobPathname(["a"], "teste", ".jpg")).toBe("a.jpg");
    expect(blobPathname(["a"], "teste", ".json")).toBe("a.json");
  });

  it("LANÇA quando a extensão vem sem o ponto — não corrige em silêncio", () => {
    // "jpg" corrigido caladamente viraria `ajpg` ou `a.jpg` por adivinhação; um
    // `return` no lugar do `throw` deixaria o caminho errado passar e virar 404
    // mudo do CDN. O erro precisa ser aqui.
    expect(() => blobPathname(["a"], "teste", "jpg")).toThrow(/extensão de Blob inválida/);
    expect(() => blobPathname(["a"], "teste", "jpg")).toThrow(/use "\.jpg", não "jpg"/);
  });

  it("recusa extensão malformada de outras formas", () => {
    expect(() => blobPathname(["a"], "teste", "")).toThrow(/extensão de Blob inválida/);
    expect(() => blobPathname(["a"], "teste", ".")).toThrow(/extensão de Blob inválida/);
    expect(() => blobPathname(["a"], "teste", ".JPG")).toThrow(/extensão de Blob inválida/);
    expect(() => blobPathname(["a"], "teste", ".tar.gz")).toThrow(/extensão de Blob inválida/);
  });
});

// ---------------------------------------------------------------------------
// Identidade de candidatura — spec 018 (ADR-0039 a ADR-0042)
// ---------------------------------------------------------------------------

describe("caminhos de identidade de candidatura", () => {
  it("fatia de UF × cargo", () => {
    expect(candidatosUfBlobPathname("SP", "dep")).toBe("candidatos/uf/SP/dep.json");
    expect(candidatosUfBlobPathname("RJ", "sen")).toBe("candidatos/uf/RJ/sen.json");
    expect(candidatosUfBlobPathname("MG", "pres")).toBe("candidatos/uf/MG/pres.json");
    expect(candidatosUfBlobPathname("BA", "gov")).toBe("candidatos/uf/BA/gov.json");
  });

  it("índice único", () => {
    expect(candidatosIndexBlobPathname()).toBe("candidatos/index.json");
  });

  it("foto: sigla normalizada, sqcand literal, extensão .jpg", () => {
    expect(candidatoFotoBlobPathname("sp", "250002553928")).toBe(
      "candidatos/foto/SP/250002553928.jpg",
    );
    expect(candidatoFotoBlobPathname("SP", "250002553928")).toBe(
      "candidatos/foto/SP/250002553928.jpg",
    );
  });

  it("sqcand atravessa como string, sem passar por number", () => {
    // 12 dígitos ainda cabem num double, mas o tipo no banco é bigint e o
    // trajeto inteiro é string de propósito: qualquer conversão intermediária
    // (Number(...) e volta) apareceria aqui como zero à esquerda comido ou
    // notação científica.
    expect(candidatoFotoBlobPathname("AC", "010001600745")).toBe(
      "candidatos/foto/AC/010001600745.jpg",
    );
    expect(candidatoFotoBlobPathname("AC", "999999999999999999999")).toBe(
      "candidatos/foto/AC/999999999999999999999.jpg",
    );
  });

  it("nenhum dos caminhos novos precisa de escape na URL", () => {
    const caminhos = [
      candidatosUfBlobPathname("sp", "dep"),
      candidatosIndexBlobPathname(),
      candidatoFotoBlobPathname("sp", "250002553928"),
    ];
    for (const c of caminhos) {
      expect(c).not.toContain(":");
      expect(encodeURI(c)).toBe(c);
    }
  });

  it("recusa sigla malformada em vez de gerar caminho que só falha em produção", () => {
    expect(() => candidatosUfBlobPathname("SPP", "dep")).toThrow(/sigla de UF inválida/);
    expect(() => candidatoFotoBlobPathname("", "250002553928")).toThrow(/sigla de UF inválida/);
  });

  it("recusa sqcand com caractere fora do padrão de segmento", () => {
    expect(() => candidatoFotoBlobPathname("SP", "2500/025539")).toThrow(
      /segmento de caminho de Blob inválido/,
    );
    expect(() => candidatoFotoBlobPathname("SP", "")).toThrow(/string vazia/);
  });
});

describe("URL determinística", () => {
  it("deriva o host do storeId embutido no BLOB_READ_WRITE_TOKEN", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_jbTu251tioj3y57Z_MtSegredo123";
    expect(blobPublicBaseUrl()).toBe("https://jbtu251tioj3y57z.public.blob.vercel-storage.com");
  });

  it("BLOB_PUBLIC_BASE_URL tem precedência e perde a barra final", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_jbTu251tioj3y57Z_MtSegredo123";
    process.env.BLOB_PUBLIC_BASE_URL = "https://exemplo.test/";
    expect(blobPublicBaseUrl()).toBe("https://exemplo.test");
  });

  it("a mesma UF/cargo/turno sempre produz a mesma URL", () => {
    process.env.BLOB_PUBLIC_BASE_URL = "https://exemplo.test";
    const a = blobUrlFor(ufDetailBlobPathname("SP", "pres", 1));
    const b = blobUrlFor(ufDetailBlobPathname("sp", "pres", 1));
    expect(a).toBe("https://exemplo.test/municipios/uf/SP/pres/t1.json");
    expect(b).toBe(a);
  });

  it("sem credencial nem override, não há URL — o caller degrada, não quebra", () => {
    expect(blobPublicBaseUrl()).toBeNull();
    expect(blobUrlFor("municipios/uf/SP/pres/t1.json")).toBeNull();
  });

  it("token fora do formato esperado não vira host inventado", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token_qualquer";
    expect(blobPublicBaseUrl()).toBeNull();
  });
});
