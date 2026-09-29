// @vitest-environment happy-dom
/**
 * tests/unit/components/etiquetas-nas-listas.test.tsx — os chips editoriais
 * nas LISTAS da spec 025 (RF-245/246/247): o cartão de UF das capas
 * (`GovernorCard`), o painel de resultado das páginas de UF (`ResultPanel`) e
 * a grade de `/candidatos`.
 *
 *   - nunca mudam a ordem das linhas (auxiliar de invariância, RF-238);
 *   - nunca interativos (no /senador o cartão mora dentro de um `<a>`);
 *   - sem chips ⇒ o componente sai idêntico ao de antes;
 *   - `data-etq` só com o filtro ligado.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEXTO_AVISO_ETIQUETAS } from "@/components/blocks/EtiquetasAviso";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { ResultPanel } from "@/components/blocks/ResultPanel";
import type { EdgeUfCandidate } from "@/lib/edge-config/types";
import { CATEGORIAS_CHIP } from "@/lib/etiquetas/catalogo";
import { editorialDaCapa, etiquetasDaLista } from "@/lib/etiquetas/telas";
import { cand, ufRow } from "@/tests/fixtures/senado/payload-senado";

import { etiquetasDeTeste, universoDoPayload } from "../etiquetas/_visoes-fixtures";
import { expectOrdemInvariante } from "../etiquetas/ordem-invariante";

const row = ufRow("SP", 60, [
  cand(13, "PT", 38, { pct_atual: 38 }),
  cand(22, "PL", 36, { pct_atual: 36 }),
  cand(15, "MDB", 20, { pct_atual: 20 }),
  cand(55, "PSD", 6, { pct_atual: 6 }),
]);
const payload = { por_uf: [row] } as never;
const universo = universoDoPayload(payload, 3);
const ids = row.top_candidatos.map((c) => c.sqcand as string);

function etq(classificado: (sq: string) => boolean, ligadas: ("chips" | "filtro")[]) {
  return etiquetasDeTeste({
    universo,
    comFoto: false,
    ligadas,
    linhas: {
      "governador.csv": ids
        .filter(classificado)
        .map((sq) => ({ chave: sq, categoria: "relacao_governo", valor: "independente" })),
    },
  });
}

function cartao(
  classificado: (sq: string) => boolean,
  ligadas: ("chips" | "filtro")[] = ["chips"],
) {
  const capa = editorialDaCapa(etq(classificado, ligadas), [row], {
    cargo: 3,
    turno: 1,
    preEleicao: false,
  });
  return renderToStaticMarkup(
    <a href="/uf/SP/senador">
      <GovernorCard uf={row} candidatos={[]} etiquetas={capa.cartao("SP")} />
    </a>,
  );
}

function nomesDasLinhas(html: string): string[] {
  const d = new DOMParser().parseFromString(html, "text/html");
  return [...d.querySelectorAll("article li > span:nth-child(2)")].map(
    (s) => s.childNodes[0]?.textContent ?? "",
  );
}

describe("RF-245 — chips no cartão de UF (GovernorCard)", () => {
  it("🔴 etiqueta presente, ausente ou parcial NUNCA muda a ordem das linhas", () => {
    expectOrdemInvariante({ ids, ordenar: (f) => nomesDasLinhas(cartao(f)) });
  });

  it("sem etiquetas o cartão sai IDÊNTICO ao de antes (nem data-etq)", () => {
    const antes = renderToStaticMarkup(<GovernorCard uf={row} candidatos={[]} />);
    const semChave = renderToStaticMarkup(
      <GovernorCard
        uf={row}
        candidatos={[]}
        etiquetas={editorialDaCapa(
          etq(() => true, []),
          [row],
          { cargo: 3, turno: 1, preEleicao: false },
        ).cartao("SP")}
      />,
    );
    expect(semChave).toBe(antes);
  });

  it("🔴 chip dentro do nome, texto puro — nada interativo dentro do <a>", () => {
    const html = cartao(() => true);
    const d = new DOMParser().parseFromString(html, "text/html");
    const chips = d.querySelectorAll("[data-testid='etiqueta-editorial']");
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) {
      expect(c.closest("li > span:nth-child(2)")).not.toBeNull();
      expect(c.querySelectorAll("a,button,input,select,[tabindex],[role]")).toHaveLength(0);
    }
    expect(d.querySelectorAll("a a, a button, a select")).toHaveLength(0);
  });

  it("filtro ligado ⇒ `data-etq` no <article> com os tokens da corrida", () => {
    const html = cartao(() => true, ["filtro"]);
    const d = new DOMParser().parseFromString(html, "text/html");
    expect(d.querySelector("article")?.getAttribute("data-etq")).toBe(
      "relacao_governo:independente",
    );
    // Filtro sem chips: nenhum chip na tela.
    expect(d.querySelectorAll("[data-testid='etiqueta-editorial']")).toHaveLength(0);
  });
});

describe("RF-245 — chips no painel de UF (ResultPanel) e o aviso", () => {
  const candidatos: EdgeUfCandidate[] = row.top_candidatos.map((c, i) => ({
    id: c.id,
    nome: c.nome ?? "",
    partido: c.partido ?? "",
    cor: "#000000",
    pct_atual: c.pct_atual ?? 0,
    pct_projetado: c.pct,
    votos_atuais: 1000 - i,
    ic_95: [0, 0],
    sqcand: c.sqcand,
  })) as unknown as EdgeUfCandidate[];

  function painel(classificado: (sq: string) => boolean) {
    const m = etiquetasDaLista(etq(classificado, ["chips"]), candidatos, 3, 1, CATEGORIAS_CHIP);
    return renderToStaticMarkup(
      <ResultPanel candidatos={candidatos} pctApurado={60} etiquetas={m} ufDaFoto="SP" />,
    );
  }

  it("🔴 ordem das linhas invariante com etiquetas", () => {
    expectOrdemInvariante({
      ids,
      ordenar: (f) => {
        const d = new DOMParser().parseFromString(painel(f), "text/html");
        return [...d.querySelectorAll("[data-testid='candidate-result-name']")].map(
          (n) => n.textContent ?? "",
        );
      },
    });
  });

  it("chip sob o nome, e o aviso com link só quando há etiqueta", () => {
    const com = painel(() => true);
    expect(com).toContain("candidate-result-etiquetas");
    expect(com).toContain(TEXTO_AVISO_ETIQUETAS);
    const sem = painel(() => false);
    expect(sem).not.toContain("candidate-result-etiquetas");
    expect(sem).not.toContain(TEXTO_AVISO_ETIQUETAS);
    expect(sem).toBe(
      renderToStaticMarkup(<ResultPanel candidatos={candidatos} pctApurado={60} ufDaFoto="SP" />),
    );
  });
});
