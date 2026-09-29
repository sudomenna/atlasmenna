// Cálculo da trajetória na Câmara a partir dos caches locais —
// `data-pipeline/trajetoria-camara-calculo.ts`. Spec 018 RF-214, ADR-0058.
//
// Três coisas são provadas aqui:
//  1. o universo é o MESMO recorte do import (cargo 6, via `unirCandidaturas`)
//     e cada candidatura dele recebe exatamente uma trajetória;
//  2. `trajetoriaDaLinha` é o ÚNICO ponto que lê `DT_NASCIMENTO` e
//     `NM_SOCIAL_CANDIDATO`, e nada do que ela devolve carrega esses valores;
//  3. o caminho de cálculo é offline: só cache, sem banco, e o import de
//     produção (`candidatos-import.ts`/`candidatos-parse.ts`) não foi tocado.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirIndiceCamara } from "@/data-pipeline/trajetoria-camara.ts";
import {
  calcularTrajetorias,
  calcularTrajetoriasDoCache,
  trajetoriaDaLinha,
} from "@/data-pipeline/trajetoria-camara-calculo.ts";
import {
  COMPLEMENTARES,
  DEPUTADOS,
  ESPERADO,
  gravarCacheCamara,
  gravarCacheTse,
  H_COMPLEMENTAR,
  H_PRINCIPAL,
  indiceFixture,
  linhaComplementar,
  linhaPrincipal,
  PRINCIPAIS,
  PROIBIDOS_NA_SAIDA,
} from "./_trajetoria-fixtures.ts";

const calcular = (principais = PRINCIPAIS, complementares = COMPLEMENTARES) =>
  calcularTrajetorias(principais, H_PRINCIPAL, complementares, H_COMPLEMENTAR, indiceFixture());

describe("calcularTrajetorias — universo e categorias", () => {
  it("cada candidatura de cargo 6 recebe exatamente a trajetória esperada", () => {
    const r = calcular();
    const obtido = Object.fromEntries(
      [...r.porSq].map(([sq, t]) => [sq, { trajetoria: t.trajetoria, camaraIds: t.camaraIds }]),
    );
    expect(obtido).toEqual(ESPERADO);
  });

  // MUTAÇÃO ALVO: tirar o filtro de cargo — a mesma pessoa concorrendo a
  // Governador entraria no universo de Deputado Federal.
  it("o universo é só cargo 6, na ordem do arquivo — a candidatura a Governador fica fora", () => {
    const r = calcular();
    expect(r.universo).toEqual([
      "250000000001",
      "90000000002",
      "100000000004",
      "100000000005",
      "100000000006",
    ]);
    expect(r.porSq.has("250000000003")).toBe(false);
    expect(r.candidaturas.get("250000000001")?.cargo).toBe(6);
  });

  it("deputado ESTADUAL com ocupação DEPUTADO e sem registro na Câmara é estreante", () => {
    expect(calcular().porSq.get("90000000002")).toMatchObject({ trajetoria: "estreante" });
  });

  it("sem data de nascimento legível não casa — estreante, nunca 'ausente'", () => {
    expect(calcular().porSq.get("100000000006")).toMatchObject({
      trajetoria: "estreante",
      camaraIds: null,
      modo: "nenhum",
    });
  });

  it("SQ repetido no arquivo conta como duplicada e vale a primeira linha", () => {
    const repetida = linhaPrincipal({
      SQ_CANDIDATO: "90000000002",
      NM_CANDIDATO: "FULANO DE TAL",
      DT_NASCIMENTO: "02/01/1970",
    });
    const r = calcular([...PRINCIPAIS, repetida], [...COMPLEMENTARES]);
    expect(r.duplicadas).toBe(1);
    expect(r.universo.length).toBe(5);
    expect(r.porSq.get("90000000002")?.trajetoria).toBe("estreante");
  });

  // O join 1:1 do RF-140 estoura aqui também: uma candidatura sem par no
  // complementar não pode sumir do arquivo e virar "estreante" por ausência.
  it("candidatura de cargo 6 sem par no complementar lança", () => {
    expect(() => calcular(PRINCIPAIS, COMPLEMENTARES.slice(1))).toThrow(/Join quebrado/);
  });

  it("devolve a DT_GERACAO do arquivo principal (proveniência do arquivo exportado)", () => {
    expect(calcular().geracaoDeclarada).toBe("12/09/2026 19:31:30");
  });
});

describe("trajetoriaDaLinha — o único ponto que lê nascimento e nome social", () => {
  // MUTAÇÃO ALVO: ler a data de outra coluna (ou não ler): a mesma linha com
  // outra data de nascimento deixa de casar.
  it("a data de nascimento vem de DT_NASCIMENTO", () => {
    const idx = indiceFixture();
    const linha = PRINCIPAIS[0] as string[];
    expect(trajetoriaDaLinha(linha, H_PRINCIPAL, idx).trajetoria).toBe("em_exercicio");
    const outraData = linhaPrincipal({
      SQ_CANDIDATO: "250000000001",
      NM_CANDIDATO: "FULANO DE TAL",
      NM_URNA_CANDIDATO: "FULANO",
      DT_NASCIMENTO: "03/01/1970",
    });
    expect(trajetoriaDaLinha(outraData, H_PRINCIPAL, idx).trajetoria).toBe("estreante");
  });

  // MUTAÇÃO ALVO: não ler NM_SOCIAL_CANDIDATO — a regra (c) pelo nome social
  // é o único caminho que casa esta linha.
  it("o nome social vem de NM_SOCIAL_CANDIDATO, e o sentinela #NULO vira ausência", () => {
    const idx = indiceFixture();
    expect(trajetoriaDaLinha(PRINCIPAIS[3] as string[], H_PRINCIPAL, idx)).toMatchObject({
      trajetoria: "mandato_anterior",
      modo: "aproximado",
    });
    const semSocial = linhaPrincipal({
      SQ_CANDIDATO: "100000000004",
      NM_CANDIDATO: "RAFAELA MOTA DUARTE",
      NM_URNA_CANDIDATO: "RAFAELA DUARTE",
      NM_SOCIAL_CANDIDATO: "#NULO",
      DT_NASCIMENTO: "04/04/1990",
    });
    expect(trajetoriaDaLinha(semSocial, H_PRINCIPAL, idx).trajetoria).toBe("estreante");
  });

  it("o que sai do cálculo não carrega data, nome nem ocupação — asserção negativa", () => {
    const r = calcular();
    const s = JSON.stringify({ universo: r.universo, porSq: [...r.porSq] });
    for (const proibido of PROIBIDOS_NA_SAIDA) expect(s).not.toContain(proibido);
  });
});

// ---------------------------------------------------------------------------
// Do cache em disco — offline
// ---------------------------------------------------------------------------

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "trajetoria-calc-"));
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const mkdir = (p: string) => mkdirSync(p, { recursive: true });

describe("calcularTrajetoriasDoCache — só cache, sem rede nem banco", () => {
  it("lê os dois caches e produz o mesmo resultado do cálculo puro", async () => {
    const tseDir = join(raiz, "tse");
    const camaraDir = join(raiz, "camara");
    gravarCacheTse(tseDir, mkdir);
    mkdir(camaraDir);
    gravarCacheCamara(camaraDir);
    const r = await calcularTrajetoriasDoCache({ tseDir, camaraDir, log: () => {} });
    expect(r.universo.length).toBe(5);
    expect(
      Object.fromEntries(
        [...r.porSq].map(([sq, t]) => [sq, { trajetoria: t.trajetoria, camaraIds: t.camaraIds }]),
      ),
    ).toEqual(ESPERADO);
    expect(r.camara.origemDeputados).toBe("cache");
    expect(r.camara.indice.totalDeputados).toBe(DEPUTADOS.length + 7000);
  });

  // MUTAÇÃO ALVO: a exportação cair no download (ou criar o diretório) quando
  // o cache da Câmara falta — ausência é "não calculado", e nunca rede.
  it("cache da Câmara ausente lança e não cria nada", async () => {
    const tseDir = join(raiz, "tse");
    gravarCacheTse(tseDir, mkdir);
    const camaraDir = join(raiz, "camara-inexistente");
    await expect(calcularTrajetoriasDoCache({ tseDir, camaraDir, log: () => {} })).rejects.toThrow(
      /cache da Câmara ausente/,
    );
    expect(existsSync(camaraDir)).toBe(false);
  });

  it("cache do TSE ausente lança", async () => {
    await expect(
      calcularTrajetoriasDoCache({ tseDir: join(raiz, "nada"), camaraDir: raiz, log: () => {} }),
    ).rejects.toThrow(/cache do TSE ausente/);
  });

  it("uma linha do complementar a mais (outro cargo) não muda o universo", async () => {
    const tseDir = join(raiz, "tse");
    const camaraDir = join(raiz, "camara");
    gravarCacheTse(tseDir, mkdir, PRINCIPAIS, [...COMPLEMENTARES, linhaComplementar("999")]);
    mkdir(camaraDir);
    gravarCacheCamara(camaraDir);
    const r = await calcularTrajetoriasDoCache({ tseDir, camaraDir, log: () => {} });
    expect(r.universo.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Fios: um único ponto de leitura; o import de produção intocado; sem banco
// ---------------------------------------------------------------------------

const RAIZ_REPO = resolve(__dirname, "../../..");

function arquivosDeCodigo(dir: string): string[] {
  const abs = join(RAIZ_REPO, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const visitar = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) visitar(p);
      else if (/\.(ts|tsx|mts|js|mjs|py)$/.test(e.name)) out.push(p);
    }
  };
  visitar(abs);
  return out;
}

describe("fios do ADR-0058 (entrega dividida + exceção estrita de PII)", () => {
  // MUTAÇÃO ALVO: um segundo ponto de leitura (ex.: o import voltando a ler a
  // data de nascimento, como no worktree de 26/09).
  it("só trajetoria-camara-calculo.ts lê as colunas DT_NASCIMENTO e NM_SOCIAL_CANDIDATO", () => {
    const leitores: string[] = [];
    for (const dir of ["app", "api", "components", "data-pipeline", "lib", "scripts"]) {
      for (const f of arquivosDeCodigo(dir)) {
        const s = readFileSync(f, "utf8");
        if (/["']DT_NASCIMENTO["']|["']NM_SOCIAL_CANDIDATO["']/.test(s)) {
          leitores.push(relative(RAIZ_REPO, f));
        }
      }
    }
    expect(leitores).toEqual(["data-pipeline/trajetoria-camara-calculo.ts"]);
  });

  // A perna estacionada (0011 + import + backfill) fica fora da `main` até
  // depois de 25/10: o import de 03/10 roda contra produção.
  it("o import de candidaturas não conhece a trajetória", () => {
    for (const f of ["data-pipeline/candidatos-import.ts", "data-pipeline/candidatos-parse.ts"]) {
      const s = readFileSync(join(RAIZ_REPO, f), "utf8");
      expect(s, f).not.toMatch(/trajetoria|camara_ids/i);
    }
    expect(
      existsSync(join(RAIZ_REPO, "data-pipeline/migrations/0011_candidatos_trajetoria_camara.ts")),
    ).toBe(false);
    const schema = readFileSync(join(RAIZ_REPO, "lib/db/schema.ts"), "utf8");
    expect(schema).not.toMatch(/trajetoria_camara|camara_ids/);
  });

  it("o caminho de cálculo/exportação não abre banco nem carrega .env.local", () => {
    for (const f of [
      "data-pipeline/trajetoria-camara.ts",
      "data-pipeline/trajetoria-camara-fonte.ts",
      "data-pipeline/trajetoria-camara-calculo.ts",
      "data-pipeline/trajetoria-camara-paridade.ts",
      "data-pipeline/trajetoria-exportar.ts",
      "data-pipeline/alinhamento-importar.ts",
    ]) {
      const s = readFileSync(join(RAIZ_REPO, f), "utf8");
      expect(s, f).not.toMatch(/getPool\(|DATABASE_URL|\.env\.local|@neondatabase|drizzle/);
    }
  });
});

// Sanidade da própria fixture: o deputado da 57ª não pode estar em exercício,
// senão o caso `legislatura_atual` deixaria de discriminar.
it("fixture: o deputado 31 é da 57ª e não está em exercício", () => {
  const idx = construirIndiceCamara(DEPUTADOS, [7]);
  expect(idx.emExercicio.has(31)).toBe(false);
});
