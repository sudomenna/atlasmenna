// Os dois arquivos derivados VERSIONADOS em `editorial/derivados/` — o que
// está no repositório, não o que o gerador produziria. ADR-0058 item 5
// (trajetória) e ADR-0062 item 2 (alinhamento).
//
// Estes testes travam o contrato que a camada de etiquetas consome e a
// ausência de dado pessoal no que foi de fato commitado: um arquivo
// regenerado por um gerador alterado, ou editado à mão, reprova aqui. Só
// invariantes estruturais — as contagens mudam legitimamente a cada nova
// exportação (posse de suplente, novo cadastro do TSE).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRAJETORIAS } from "@/data-pipeline/trajetoria-camara.ts";

const RAIZ = resolve(__dirname, "../../..");
const TEXTO_TRAJETORIA = readFileSync(
  resolve(RAIZ, "editorial/derivados/trajetoria-camara.json"),
  "utf8",
);
const TEXTO_ALINHAMENTO = readFileSync(
  resolve(RAIZ, "editorial/derivados/alinhamento-camara.json"),
  "utf8",
);

// Palavras que denunciariam dado pessoal ou identificação no arquivo.
const PROIBIDOS = /nascimento|cpf|nome|civil|email|titulo/i;

describe("editorial/derivados/trajetoria-camara.json", () => {
  const e = JSON.parse(TEXTO_TRAJETORIA) as {
    gerado_em: string;
    fonte: { tse_dt_geracao: string; camara: string };
    universo: number;
    por_sqcand: Record<string, { t: string; camara_ids: number[] }>;
  };

  it("formato exato no topo", () => {
    expect(Object.keys(e)).toEqual(["gerado_em", "fonte", "universo", "por_sqcand"]);
    expect(Object.keys(e.fonte)).toEqual(["tse_dt_geracao", "camara"]);
    expect(new Date(e.gerado_em).toISOString()).toBe(e.gerado_em);
    expect(e.fonte.tse_dt_geracao).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it("universo é a contagem de chaves — nenhuma candidatura ausente", () => {
    expect(Object.keys(e.por_sqcand).length).toBe(e.universo);
    expect(e.universo).toBeGreaterThan(7000);
  });

  it("cada entrada: só `t` e `camara_ids`; categoria conhecida; estreante ↔ sem id", () => {
    const cats = new Set<string>(TRAJETORIAS);
    for (const [sq, x] of Object.entries(e.por_sqcand)) {
      expect(sq).toMatch(/^[1-9]\d*$/);
      expect(Object.keys(x)).toEqual(["t", "camara_ids"]);
      expect(cats.has(x.t)).toBe(true);
      expect(x.camara_ids.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true);
      expect(x.t === "estreante").toBe(x.camara_ids.length === 0);
    }
  });

  it("as quatro categorias estão presentes e os estreantes também", () => {
    const vistos = new Set(Object.values(e.por_sqcand).map((x) => x.t));
    expect([...vistos].sort()).toEqual([...TRAJETORIAS].sort());
  });

  it("chaves em ordem numérica crescente", () => {
    const ks = Object.keys(e.por_sqcand);
    for (let i = 1; i < ks.length; i++) {
      const [a, b] = [ks[i - 1] as string, ks[i] as string];
      expect(a.length < b.length || (a.length === b.length && a < b)).toBe(true);
    }
  });

  it("nenhum dado pessoal no arquivo — asserção negativa sobre o texto", () => {
    expect(TEXTO_TRAJETORIA).not.toMatch(PROIBIDOS);
    // A única data do corpo é o carimbo de geração do TSE, no cabeçalho.
    const corpo = TEXTO_TRAJETORIA.slice(TEXTO_TRAJETORIA.indexOf('"por_sqcand"'));
    expect(corpo).not.toMatch(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    // Tirando as chaves e as quatro categorias, o corpo não tem letra nenhuma.
    const resto = corpo.replace(
      /"(por_sqcand|t|camara_ids|em_exercicio|legislatura_atual|mandato_anterior|estreante)"/g,
      "",
    );
    expect(resto).not.toMatch(/[A-Za-zÀ-ú]/);
  });
});

describe("editorial/derivados/alinhamento-camara.json", () => {
  const e = JSON.parse(TEXTO_ALINHAMENTO) as {
    corte: string;
    fonte: { descricao: string; url: string; sha256: string };
    por_deputado: Record<string, { votos_disputadas: number; taxa_disputadas: number }>;
  };

  it("formato exato; corte de 03/09/2026; hash do CSV de entrada", () => {
    expect(Object.keys(e)).toEqual(["corte", "fonte", "por_deputado"]);
    expect(Object.keys(e.fonte)).toEqual(["descricao", "url", "sha256"]);
    expect(e.corte).toBe("2026-09-03");
    expect(e.fonte.url).toBe("https://dadosabertos.camara.leg.br");
    expect(e.fonte.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cada deputado: só votos e taxa das disputadas, taxa em percentual 0–100", () => {
    const valores = Object.values(e.por_deputado);
    expect(valores.length).toBeGreaterThan(500);
    for (const [id, x] of Object.entries(e.por_deputado)) {
      expect(id).toMatch(/^[1-9]\d*$/);
      expect(Object.keys(x)).toEqual(["votos_disputadas", "taxa_disputadas"]);
      expect(Number.isSafeInteger(x.votos_disputadas) && x.votos_disputadas >= 0).toBe(true);
      expect(x.taxa_disputadas >= 0 && x.taxa_disputadas <= 100).toBe(true);
    }
    // Escala: em fração (0–1) o máximo seria ≤ 1.
    expect(Math.max(...valores.map((x) => x.taxa_disputadas))).toBeGreaterThan(1);
  });

  it("nenhum dado pessoal no arquivo — asserção negativa sobre o texto", () => {
    expect(TEXTO_ALINHAMENTO).not.toMatch(PROIBIDOS);
    const corpo = TEXTO_ALINHAMENTO.slice(TEXTO_ALINHAMENTO.indexOf('"por_deputado"'));
    // Tirando as chaves, o corpo só tem números — nenhum nome, partido ou UF.
    const resto = corpo.replace(/"(por_deputado|votos_disputadas|taxa_disputadas)"/g, "");
    expect(resto).not.toMatch(/[A-Za-zÀ-ú]/);
  });

  it("a ponte com a trajetória existe: ids da Câmara do arquivo de trajetória acham linha aqui", () => {
    const t = JSON.parse(TEXTO_TRAJETORIA) as {
      por_sqcand: Record<string, { t: string; camara_ids: number[] }>;
    };
    const emExercicio = Object.values(t.por_sqcand).filter((x) => x.t === "em_exercicio");
    const comLinha = emExercicio.filter((x) => String(x.camara_ids[0]) in e.por_deputado);
    // Quase todo deputado em exercício votou até o corte; a falta de um
    // punhado (suplente recém-empossado) é esperada, a de muitos não.
    expect(comLinha.length / emExercicio.length).toBeGreaterThan(0.95);
  });
});
