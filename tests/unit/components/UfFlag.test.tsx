// @vitest-environment happy-dom
/**
 * tests/unit/components/UfFlag.test.tsx — a bandeira de UF como `<img>` de
 * arquivo estático do próprio site (ADR-0070, decisão do dono de 2026-10-03).
 *
 * Dois contratos:
 *   1. **O componente** — `src` em `/bandeiras/<SIGLA>.webp`, `alt=""`
 *      (decorativa: nome/sigla sempre em texto ao lado), `width`/`height`
 *      declarados (sem salto de layout), `lazy` por padrão e `eager` só quando
 *      pedido, e `null` para qualquer sigla fora das 27.
 *   2. **Os arquivos** — `public/bandeiras/` tem EXATAMENTE os 27 `.webp`, cada
 *      um ≤ 3 KB. É o portão que substitui os tetos de 4 KB/60 KB do gerador de
 *      sprite removido: impede tanto a bandeira que falta (que viraria ícone
 *      quebrado ao lado de um resultado) quanto o arquivo de 200 KB colado sem
 *      ninguém perceber.
 *
 * Mutações aplicadas à mão em 2026-10-03 (todas mataram ≥ 1 caso, revertidas):
 *   - `ufFlagSrc` devolvendo `.png` → (a) e o teste dos arquivos morrem;
 *   - guarda `if (!temBandeira(sigla)) return null` removida → (c) morre;
 *   - `sigla.toUpperCase()` removido da guarda → (d) morre;
 *   - `alt=""` trocado por `alt={sigla}` → (a) morre;
 *   - `loading` sempre `lazy` → (e) morre;
 *   - teto de 3 KB baixado para 1 KB → o teste de tamanho morre (16 das 27 passam);
 *   - `BR.webp` copiado para `public/bandeiras/` → o teste de contagem morre.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UfFlag, ufFlagSrc } from "@/components/atoms/data/UfFlag";
import { UF_NOMES } from "@/components/atoms/maps/_shared";

function img(node: React.ReactElement): HTMLImageElement | null {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  return doc.querySelector("img");
}

const SIGLAS = Object.keys(UF_NOMES).sort();
const DIR = path.join(process.cwd(), "public", "bandeiras");
/** Teto por arquivo. O maior em 2026-10-03 é PR, com 1.864 B. */
const TETO_BYTES = 3 * 1024;

describe("<UfFlag> — o `<img>`", () => {
  it("(a) aponta para o arquivo do próprio site, decorativa, com caixa declarada", () => {
    const el = img(<UfFlag sigla="SP" />);
    expect(el?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    // `alt=""` — e não ausente: sem o atributo, o leitor de tela lê o nome do
    // arquivo. Vazio tira a imagem da árvore de acessibilidade.
    expect(el?.hasAttribute("alt")).toBe(true);
    expect(el?.getAttribute("alt")).toBe("");
    expect(el?.getAttribute("width")).toBe("21");
    expect(el?.getAttribute("height")).toBe("15");
    expect(el?.getAttribute("decoding")).toBe("async");
  });

  it("(b) largura e altura vêm das props", () => {
    const el = img(<UfFlag sigla="RJ" width={25} height={18} />);
    expect(el?.getAttribute("width")).toBe("25");
    expect(el?.getAttribute("height")).toBe("18");
  });

  it("(c) sigla fora das 27 ⇒ nada — nem `<img>` para arquivo que não existe", () => {
    for (const sigla of ["BR", "ZZ", "", "S", "SPX", "toString", "__proto__"]) {
      expect(renderToStaticMarkup(<UfFlag sigla={sigla} />), `sigla "${sigla}"`).toBe("");
    }
  });

  it("(d) não liga para caixa: 'sp' e 'Sp' viram o arquivo SP.webp", () => {
    expect(img(<UfFlag sigla="sp" />)?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    expect(img(<UfFlag sigla="Df" />)?.getAttribute("src")).toBe("/bandeiras/DF.webp");
  });

  it("(e) `lazy` por padrão; `eager` (título acima da dobra) não declara `loading`", () => {
    expect(img(<UfFlag sigla="SP" />)?.getAttribute("loading")).toBe("lazy");
    expect(img(<UfFlag sigla="SP" eager />)?.hasAttribute("loading")).toBe(false);
  });

  it("(f) `inline` e `className` somam classe; sem eles, uma classe só", () => {
    const base =
      img(<UfFlag sigla="SP" />)
        ?.className.split(/\s+/)
        .filter(Boolean) ?? [];
    expect(base).toHaveLength(1);
    const cheio =
      img(<UfFlag sigla="SP" inline className="extra" />)
        ?.className.split(/\s+/)
        .filter(Boolean) ?? [];
    expect(cheio).toHaveLength(3);
    expect(cheio).toContain("extra");
  });
});

describe("public/bandeiras/ — os 27 arquivos, e só eles", () => {
  it("há exatamente um `.webp` por UF — nenhum faltando, nenhum a mais (nem BR)", () => {
    const arquivos = readdirSync(DIR).sort();
    expect(arquivos).toEqual(SIGLAS.map((s) => `${s}.webp`));
    expect(arquivos).toHaveLength(27);
    expect(arquivos).not.toContain("BR.webp");
  });

  it("o `src` do componente bate com um arquivo de verdade, para as 27", () => {
    for (const sigla of SIGLAS) {
      const src = ufFlagSrc(sigla);
      const disco = path.join(process.cwd(), "public", src);
      expect(statSync(disco, { throwIfNoEntry: false })?.isFile(), src).toBe(true);
    }
  });

  it(`cada arquivo tem no máximo ${TETO_BYTES} bytes`, () => {
    const grandes = readdirSync(DIR)
      .map((f) => ({ f, bytes: statSync(path.join(DIR, f)).size }))
      .filter(({ bytes }) => bytes > TETO_BYTES);
    expect(grandes).toEqual([]);
  });
});
