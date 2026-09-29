// @vitest-environment happy-dom
/**
 * tests/unit/components/etiquetas-grade-renovacao.test.tsx — duas superfícies
 * da spec 025 que os outros arquivos não renderizam: a grade de `/candidatos`
 * com etiquetas (RF-245/248) e o painel da renovação (RF-249).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CandidatosGrid } from "@/components/blocks/CandidatosGrid";
import { TEXTO_AVISO_ETIQUETAS } from "@/components/blocks/EtiquetasAviso";
import { RenovacaoPanel } from "@/components/blocks/RenovacaoPanel";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import { CATEGORIAS_CHIP } from "@/lib/etiquetas/catalogo";
import { etiquetasDaLista } from "@/lib/etiquetas/telas";
import { validarMandato2027 } from "@/lib/senado/mandato-2031";
import { cand, payloadSenado, ufRow } from "@/tests/fixtures/senado/payload-senado";

import { etiquetasDeTeste } from "../etiquetas/_visoes-fixtures";

function identidade(sqcand: string, numero: number, nome: string): CandidatoIdentidade {
  return {
    sqcand,
    numero,
    nome_urna: nome,
    nome,
    partido: "PT",
    situacao: "deferido",
  } as unknown as CandidatoIdentidade;
}

describe("RF-245 — etiquetas na grade de /candidatos", () => {
  const lista = [
    identidade("250000000001", 13, "FULANA"),
    identidade("250000000002", 22, "BELTRANO"),
  ];
  const universo = lista.map((c) => ({
    sqcand: c.sqcand,
    cargo: 3 as const,
    uf: "SP",
    partido: "PT",
    federacao: null,
  }));

  function grade(ligadas: "chips"[]) {
    const e = etiquetasDeTeste({
      universo,
      comFoto: false,
      ligadas,
      linhas: {
        "governador.csv": [
          { chave: "250000000002", categoria: "relacao_governo", valor: "oposicao" },
        ],
      },
    });
    return renderToStaticMarkup(
      <CandidatosGrid
        candidatos={lista}
        uf="SP"
        rotulo="Candidaturas a Governador em SP"
        textoVazio="—"
        etiquetas={etiquetasDaLista(e, lista, 3, 1, CATEGORIAS_CHIP)}
      />,
    );
  }

  it("ligada: chip sob o cartão de quem tem etiqueta, aviso sob a grade; ordem pelo número", () => {
    const d = new DOMParser().parseFromString(grade(["chips"]), "text/html");
    const cartoes = [...d.querySelectorAll("[data-testid='candidatos-grid-lista'] > li")];
    expect(cartoes).toHaveLength(2);
    expect(cartoes[0]?.querySelector("[data-testid='etiqueta-editorial']")).toBeNull();
    expect(cartoes[1]?.querySelector("[data-testid='etiqueta-editorial']")?.textContent).toContain(
      "Oposição",
    );
    expect(d.body.textContent).toContain(TEXTO_AVISO_ETIQUETAS);
  });

  it("desligada: grade idêntica à de antes (nem chip, nem aviso)", () => {
    const antes = renderToStaticMarkup(
      <CandidatosGrid
        candidatos={lista}
        uf="SP"
        rotulo="Candidaturas a Governador em SP"
        textoVazio="—"
      />,
    );
    expect(grade([])).toBe(antes);
  });
});

describe("RF-249 — <RenovacaoPanel>", () => {
  const payload = payloadSenado(
    [ufRow("AC", 100, [cand(111, "PL", 40), cand(222, "PT", 30), cand(333, "MDB", 20)])],
    [
      { partido: "PL", vagas: 1 },
      { partido: "PT", vagas: 1 },
    ],
  );
  const universo =
    payload.por_uf[0]?.top_candidatos.map((c) => ({
      sqcand: c.sqcand as string,
      cargo: 5 as const,
      uf: "AC",
      partido: c.partido as string,
      federacao: null,
    })) ?? [];
  const traj = ["tenta_reeleicao", "estreante", "tenta_reeleicao"];
  const etiquetas = etiquetasDeTeste({
    universo,
    comFoto: false,
    ligadas: ["v4"],
    linhas: {
      "senador.csv": universo.map((u, i) => ({
        chave: u.sqcand,
        categoria: "trajetoria_cargo",
        valor: traj[i] as string,
      })),
    },
  });
  const mandato2027 = validarMandato2027({ senadores: [] });

  it("mostra a pessoa que mudou, quem perdeu, e nunca 'eleito' solto", () => {
    const html = renderToStaticMarkup(
      <RenovacaoPanel payload={payload} mandato2027={mandato2027} etiquetas={etiquetas} />,
    );
    const d = new DOMParser().parseFromString(html, "text/html");
    expect(d.querySelector("#renovacao-heading")?.textContent).toBe(
      "Renovação: quem fica com as vagas",
    );
    expect(d.querySelector("[data-testid='renovacao-resumo']")?.textContent).toContain(
      "1 de 2 vagas",
    );
    expect(d.querySelector("[data-testid='renovacao-derrotados']")?.textContent).toContain(
      "Candidatura 333",
    );
    expect(html.toLowerCase()).not.toMatch(/\beleit/);
    expect(html).toContain(TEXTO_AVISO_ETIQUETAS);
  });

  it("chave desligada ⇒ nada", () => {
    const off = etiquetasDeTeste({ universo, comFoto: false });
    expect(
      renderToStaticMarkup(
        <RenovacaoPanel payload={payload} mandato2027={mandato2027} etiquetas={off} />,
      ),
    ).toBe("");
  });
});
