// @vitest-environment happy-dom
/**
 * tests/unit/pages/sobre-as-etiquetas-limite.test.tsx — `/sobre-as-etiquetas`
 * com MUITAS classificações no ar (auditoria de a11y/perf de 29/09):
 *
 *   - 🔴 A3: o documento tem peso FIXO. Até 29/09 a página listava as
 *     individuais e os padrões linha a linha — ~2,5 KB por linha, 2,6 MB e
 *     1.039 paradas de Tab com 1.018 linhas; agora mostra o resumo (tamanho do
 *     catálogo) e aponta o CSV;
 *   - 🔴 B6: com o V1 ligado, a seção do portão diz QUEM com mandato até 2031
 *     prende a visão — no máximo {@link PENDENCIAS_POR_VISAO_NA_PAGINA} nomes,
 *     o resto como "e mais N".
 *
 * Arquivo à parte porque troca `lerClassificacoesPublicadas` (o `vi.mock` vale
 * para o arquivo inteiro): as linhas sintéticas entram por cima da cópia do
 * build de verdade, e o resto da página segue o caminho normal.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LinhaPublicada } from "@/lib/etiquetas/metodologia";

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

const cenario = vi.hoisted(() => ({ linhas: 0, v1: false }));

function linha(i: number, origem: LinhaPublicada["origem"]): LinhaPublicada {
  const alvos = ["governador", "senador", "deputado", "senado2031"] as const;
  return {
    chave: origem === "partido" ? `partido:P${i}` : String(250000000000 + i),
    alvo: origem === "partido" ? "padrao" : (alvos[i % alvos.length] ?? "governador"),
    uf: "SP",
    partido: "PX",
    categoria: i % 2 === 0 ? "relacao_governo" : "trajetoria_cargo",
    turno: null,
    valor: i % 2 === 0 ? "base_governo" : "estreante",
    rotulo: i % 2 === 0 ? "Base do governo" : "Estreante",
    origem,
    fonte_url: `https://exemplo.org/fonte/${i}`,
    fonte_descricao: `Fonte de teste número ${i}, com o comprimento de uma descrição real de levantamento de imprensa conferido pelo responsável editorial.`,
    data: "2026-09-20",
    revisado_em: "2026-09-21",
  };
}

vi.mock("@/lib/etiquetas/lista-publica", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/lista-publica")>();
  return {
    ...m,
    lerClassificacoesPublicadas: async () => {
      const r = await m.lerClassificacoesPublicadas();
      const n = cenario.linhas;
      return {
        ...r,
        etiquetas: { ...r.etiquetas, viewLigada: (v: string) => cenario.v1 && v === "v1" },
        porLinha: Array.from({ length: n }, (_, i) =>
          linha(i, i % 3 === 0 ? "partido" : "individual"),
        ),
        derivadas: Array.from({ length: n * 3 }, (_, i) => linha(i, "derivado")),
      };
    },
  };
});

import SobreAsEtiquetasPage, {
  PENDENCIAS_POR_VISAO_NA_PAGINA,
} from "@/app/sobre-as-etiquetas/page";

async function render(linhas: number, v1 = false) {
  cenario.linhas = linhas;
  cenario.v1 = v1;
  const html = renderToStaticMarkup(await SobreAsEtiquetasPage());
  return { html, doc: new DOMParser().parseFromString(html, "text/html") };
}

describe("A3 — /sobre-as-etiquetas com peso fixo", () => {
  it("🔴 10 ou 5.000 linhas no ar: o documento tem o MESMO tamanho (± os dígitos das contagens)", async () => {
    const pouco = await render(10);
    const muito = await render(5_000);
    expect(Math.abs(muito.html.length - pouco.html.length)).toBeLessThan(200);
    // E nenhuma descrição de fonte das linhas vai para a página (elas estão no CSV).
    expect(muito.html).not.toContain("Fonte de teste número");
  });

  it("🔴 o resumo tem o tamanho do CATÁLOGO: ≤ uma linha por categoria, 3 colunas de origem", async () => {
    const { doc } = await render(5_000);
    const tabela = doc.querySelector("[data-testid='etiquetas-resumo']");
    const linhas = tabela?.querySelectorAll("tbody tr") ?? [];
    expect(linhas).toHaveLength(2); // as duas categorias das linhas sintéticas
    for (const tr of linhas) {
      expect(tr.firstElementChild?.tagName).toBe("TH");
      expect(tr.querySelectorAll("td")).toHaveLength(3);
    }
    // relacao_governo: 5.000/2 derivadas + (os índices pares de 0..4999) nas duas origens de linha.
    const relacao = [...linhas].find((tr) => tr.textContent?.includes("governo Lula"));
    expect(relacao?.textContent).toContain("7.500"); // 15.000 derivadas / 2
    expect(doc.querySelector("[data-testid='etiquetas-resumo-cargo']")?.textContent).toMatch(
      /Governador, [\d.]+ · Senador, [\d.]+/,
    );
  });

  it("🔴 paradas de Tab com 5.000 linhas: as mesmas de uma página vazia", async () => {
    const pouco = await render(0);
    const muito = await render(5_000);
    expect(muito.doc.querySelectorAll("a").length).toBe(pouco.doc.querySelectorAll("a").length);
    expect(muito.doc.querySelectorAll("a").length).toBeLessThan(80);
  });
});

describe("B6 — o que prende as visões do Senado de 2027", () => {
  it("V1 desligado ⇒ a seção não lista ninguém", async () => {
    const { doc } = await render(0, false);
    expect(doc.querySelector("[data-testid='etiquetas-pendencias']")).toBeNull();
  });

  it("🔴 V1 ligado e senadores sem classificação ⇒ nomes (limitados) + 'e mais N'", async () => {
    const { doc } = await render(0, true);
    const itens = [...doc.querySelectorAll("[data-testid='etiquetas-pendencia']")];
    // Só o V1 está ligado (o V2 nem tem critério publicado).
    expect(itens).toHaveLength(1);
    const texto = itens[0]?.textContent ?? "";
    expect(texto).toContain("Senado de 2027 por bloco");
    // Nome parlamentar, partido e UF da foto do Senado — e o teto de nomes.
    expect(texto).toMatch(/\([A-ZÇÃÉ ]+, [A-Z]{2}\)/);
    const nomes = texto.split(":").slice(1).join(":").split(";");
    expect(nomes.length).toBeLessThanOrEqual(PENDENCIAS_POR_VISAO_NA_PAGINA);
    expect(texto).toMatch(/e mais \d+\.$/);
  });
});
