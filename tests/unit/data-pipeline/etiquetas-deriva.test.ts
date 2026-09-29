/**
 * tests/unit/data-pipeline/etiquetas-deriva.test.ts
 *
 * Os gerados VERSIONADOS de `lib/data/etiquetas/` (spec 024, RF-228/229/231):
 *
 *   1. **Deriva** — recompilar as fontes versionadas (`editorial/`) dá
 *      exatamente os gerados versionados. Exige o cadastro do TSE em
 *      `build/tse-archives/consulta_cand_2026/` (ou `ETIQUETAS_TSE_CACHE`),
 *      que NÃO está no git (11 MB, baixado por `pnpm candidatos:import`). Sem
 *      ele — CI, worktree novo —, o teste é PULADO com o motivo no nome. A
 *      rede de segurança que sobra é o publicador: ele recompila e recusa
 *      publicar gerado divergente (`etiquetas-publicar.ts`), e só roda na
 *      máquina do dono, onde o cadastro existe.
 *   2. **Sem dado pessoal** — varredura dos gerados versionados por nome de
 *      campo e por forma de valor (CPF, data de nascimento, e-mail). Não
 *      depende do cadastro: roda sempre.
 *   3. **Contrato** — os 29 arquivos passam nas guardas do leitor, e a cópia
 *      do build tem as chaves de visão todas desligadas.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  caminhoHistorico,
  caminhoNacional,
  caminhosPadrao,
  caminhoUf,
  compilarDoDisco,
  divergencias,
  lerGerados,
} from "@/data-pipeline/etiquetas-compilar";
import { PADRAO_CAMPO_PESSOAL } from "@/data-pipeline/etiquetas-insumos";
import {
  isArquivoHistorico,
  isArquivoNacional,
  isArquivoUf,
  lerChavesPublicacao,
  UFS,
} from "@/lib/etiquetas/formato";

const c = caminhosPadrao(process.cwd());
const temCadastro = existsSync(c.tseCache);

describe("RF-228 — deriva: gerado versionado == recompilação das fontes versionadas", () => {
  it.skipIf(!temCadastro)(
    `recompila e compara${temCadastro ? "" : ` (PULADO: sem cadastro do TSE em ${c.tseCache})`}`,
    async () => {
      const { resultado } = await compilarDoDisco(c, new Date());
      if (!resultado.ok) {
        throw new Error(
          resultado.erros.map((e) => `${e.arquivo}:${e.linha} ${e.mensagem}`).join("\n"),
        );
      }
      expect(divergencias(resultado, await lerGerados(c.saida))).toEqual([]);
    },
    60_000,
  );
});

function todosOsGerados(): Array<[string, string]> {
  const arquivos = [
    caminhoNacional(c.saida),
    caminhoHistorico(c.saida),
    ...UFS.map((u) => caminhoUf(c.saida, u)),
  ];
  return arquivos.map((p) => [p, readFileSync(p, "utf8")]);
}

function chaves(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) chaves(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      chaves(x, out);
    }
  }
  return out;
}

describe("RF-229 — nenhum dado pessoal nos gerados versionados", () => {
  it("🔴 nenhum nome de campo pessoal, nenhum valor com forma de CPF, nascimento ou e-mail", () => {
    for (const [p, texto] of todosOsGerados()) {
      const nomes = chaves(JSON.parse(texto)).filter((k) => PADRAO_CAMPO_PESSOAL.test(k));
      expect(nomes, p).toEqual([]);
      expect(texto, p).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/); // CPF formatado
      expect(texto, p).not.toMatch(/\b\d{2}\/\d{2}\/(19|20)\d{2}\b/); // data do TSE (DD/MM/AAAA)
      expect(texto, p).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // e-mail
      expect(texto, p).not.toContain('"nota"');
    }
  });

  it("o próprio padrão reconhece os campos que precisa barrar", () => {
    for (const k of [
      "DT_NASCIMENTO",
      "dataNascimento",
      "NR_CPF_CANDIDATO",
      "cpf",
      "DS_EMAIL",
      "NM_SOCIAL_CANDIDATO",
      "nome_civil",
      "nome_social",
      "NR_TITULO_ELEITORAL_CANDIDATO",
      "nome",
    ]) {
      expect(PADRAO_CAMPO_PESSOAL.test(k), k).toBe(true);
    }
    for (const k of ["sqcand", "partido", "fonte_descricao", "valor", "uf", "senadores"]) {
      expect(PADRAO_CAMPO_PESSOAL.test(k), k).toBe(false);
    }
  });
});

describe("RF-231 — a cópia do build honra o contrato", () => {
  it("29 arquivos passam nas guardas do leitor; visões desligadas; mesma versão", () => {
    const nac: unknown = JSON.parse(readFileSync(caminhoNacional(c.saida), "utf8"));
    expect(isArquivoNacional(nac)).toBe(true);
    if (!isArquivoNacional(nac)) return;
    // Spec 025 (emenda ao RF-228/231): a cópia do build carrega o
    // `publicar.json` versionado — e só ele.
    const pub = lerChavesPublicacao(
      JSON.parse(readFileSync(resolve(c.editorial, "etiquetas", "publicar.json"), "utf8")),
    );
    expect("erro" in pub).toBe(false);
    expect(nac.publicar).toEqual(pub);
    expect(nac.meta.git_sha).toBeNull();
    for (const uf of UFS) {
      const u: unknown = JSON.parse(readFileSync(caminhoUf(c.saida, uf), "utf8"));
      expect(isArquivoUf(u, uf), uf).toBe(true);
      if (isArquivoUf(u, uf)) expect(u.meta.versao).toBe(nac.meta.versao);
    }
    expect(isArquivoHistorico(JSON.parse(readFileSync(caminhoHistorico(c.saida), "utf8")))).toBe(
      true,
    );
  });

  it("🔴 § 2 (b) — derivado na cópia do build SÓ com a aprovação do dono (e a data dela)", () => {
    // Emenda de 29/09 ao RF-223: derivado sem o carimbo `revisao` aprovado
    // entra como `null`; o que entra leva `revisado_em`. Vale para qualquer
    // estado futuro do `editorial/derivados/` — não só o de hoje (tudo pendente).
    const nac = JSON.parse(readFileSync(caminhoNacional(c.saida), "utf8")) as {
      derivados: Record<string, { revisado_em?: string } | null>;
    };
    for (const [insumo, fonte] of Object.entries(nac.derivados)) {
      const nome = `${insumo.replace("_", "-")}.json`;
      const bruto = JSON.parse(readFileSync(resolve(c.editorial, "derivados", nome), "utf8")) as {
        revisao?: { revisado?: string; revisado_em?: string | null };
      };
      if (bruto.revisao?.revisado !== "sim") {
        expect(fonte, `${insumo} sem aprovação não pode estar no build`).toBeNull();
      } else if (fonte !== null) {
        expect(fonte.revisado_em).toBe(bruto.revisao.revisado_em);
      }
    }
  });

  it("as fontes versionadas existem (os cinco CSVs e o publicar.json)", () => {
    for (const f of ["governador", "senador", "senado-2031", "partidos", "deputados-excecoes"]) {
      expect(existsSync(resolve(c.editorial, "etiquetas", `${f}.csv`)), f).toBe(true);
    }
    // O dono edita este arquivo para ligar visões (spec 025): o que se exige é
    // que ele seja válido, não que esteja todo desligado.
    const pub = lerChavesPublicacao(
      JSON.parse(readFileSync(resolve(c.editorial, "etiquetas", "publicar.json"), "utf8")),
    );
    expect("erro" in pub, JSON.stringify(pub)).toBe(false);
  });
});
