// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoBlocos027.test.tsx — spec 027 (RF-281,
 * RF-284), frente U-a.
 *
 * Os blocos de deputado que diziam "Deputado Federal" no kicker passaram a
 * receber o cargo por prop OBRIGATÓRIA (`<DeputadoMaisVotados>`,
 * `<DeputadoPuxadores>`), e as grades de UF ganharam `ufs` e `hrefPorUf` para
 * a futura grade das 27 casas (o DF apontando para o distrital).
 *
 * Mutação aplicada à mão (29/09): o kicker de volta a "Deputado Federal ·" fixo
 * derruba os casos de 7 e 8; `hrefPorUf` ignorado derruba o do DF.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoPuxadores } from "@/components/blocks/DeputadoPuxadores";
import { UfBandeirasGrid } from "@/components/blocks/UfBandeirasGrid";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import type { EdgeDeputadoDestaque, EdgeDeputadoPuxador } from "@/lib/blob/deputado-uf";
import { ufsDoCargo } from "@/lib/utils/casa-legislativa";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function kicker(doc: Document): string | null | undefined {
  return doc.querySelector("[data-testid='panel-kicker']")?.textContent;
}

const LINHA: EdgeDeputadoDestaque = {
  uf: "SP",
  sqcand: 1,
  nome: "FULANA DE TAL",
  partido: "PL",
  cod: "22",
  sigla: "PL",
  numero: 2222,
  votos: 100_000,
  pct_validos: 1.5,
};

const PUXADOR: EdgeDeputadoPuxador = {
  ...LINHA,
  quociente_eleitoral: 30_000,
  quocientes: 3,
  excedente: 2,
};

describe("kicker pelo cargo — sem default de federal", () => {
  it("<DeputadoMaisVotados>: UF e país, nos três cargos", () => {
    const esperado = { 6: "Deputado Federal", 7: "Deputado Estadual", 8: "Deputado Distrital" };
    for (const cargo of [6, 7, 8] as const) {
      const uf = cargo === 8 ? "DF" : "SP";
      const naUf = parse(
        <DeputadoMaisVotados cargo={cargo} escopo="uf" uf={uf} linhas={[LINHA]} titleId="mv" />,
      );
      expect(kicker(naUf), String(cargo)).toBe(`${esperado[cargo]} · ${uf}`);
      const noPais = parse(
        <DeputadoMaisVotados cargo={cargo} escopo="pais" linhas={[LINHA]} titleId="mvp" />,
      );
      expect(kicker(noPais), String(cargo)).toBe(`${esperado[cargo]} · Brasil`);
    }
  });

  it("<DeputadoPuxadores>: o painel do país leva o rótulo do cargo", () => {
    expect(kicker(parse(<DeputadoPuxadores cargo={6} puxadores={[PUXADOR]} titleId="px" />))).toBe(
      "Deputado Federal · Brasil",
    );
    expect(kicker(parse(<DeputadoPuxadores cargo={7} puxadores={[PUXADOR]} titleId="px" />))).toBe(
      "Deputado Estadual · Brasil",
    );
  });
});

describe("grades de UF — `ufs` e `hrefPorUf` (a grade das 27 casas)", () => {
  const DF_DISTRITAL = { DF: "/uf/DF/deputado-distrital" };

  it("<UfBandeirasGrid> sem as props novas: as 27, destino do cargo (comportamento de antes)", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} />);
    const links = [...doc.querySelectorAll("[data-testid='corrida-uf']")];
    expect(links).toHaveLength(27);
    expect(doc.querySelector("[data-uf='DF']")?.getAttribute("href")).toBe(
      "/uf/DF/deputado-federal",
    );
  });

  it("<UfBandeirasGrid hrefPorUf>: o DF vai para o distrital; as outras 26 não mudam", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} hrefPorUf={DF_DISTRITAL} />);
    expect(doc.querySelectorAll("[data-testid='corrida-uf']")).toHaveLength(27);
    expect(doc.querySelector("[data-uf='DF']")?.getAttribute("href")).toBe(
      "/uf/DF/deputado-distrital",
    );
    expect(doc.querySelector("[data-uf='SP']")?.getAttribute("href")).toBe(
      "/uf/SP/deputado-federal",
    );
  });

  it("<UfBandeirasGrid ufs>: só as siglas pedidas, na ordem por NOME (não a da lista)", () => {
    const doc = parse(<UfBandeirasGrid cargo={6} ufs={["sp", "AC", "BA"]} />);
    expect(
      [...doc.querySelectorAll("[data-testid='corrida-uf']")].map((a) => a.getAttribute("data-uf")),
    ).toEqual(["AC", "BA", "SP"]);
    // As 26 assembleias: o DF fica fora.
    const est = parse(<UfBandeirasGrid cargo={6} ufs={ufsDoCargo(7)} />);
    expect(est.querySelectorAll("[data-testid='corrida-uf']")).toHaveLength(26);
    expect(est.querySelector("[data-uf='DF']")).toBeNull();
  });

  it("<UfLinksGrid>: mesmas duas props, mesmo comportamento padrão", () => {
    const padrao = parse(<UfLinksGrid cargo={6} />);
    expect(padrao.querySelectorAll("[data-testid='uf-links-grid-item']")).toHaveLength(27);

    const casas = parse(<UfLinksGrid cargo={6} hrefPorUf={DF_DISTRITAL} />);
    expect(casas.querySelector("[data-sigla='DF']")?.getAttribute("href")).toBe(
      "/uf/DF/deputado-distrital",
    );
    expect(casas.querySelector("[data-sigla='RJ']")?.getAttribute("href")).toBe(
      "/uf/RJ/deputado-federal",
    );

    const est = parse(<UfLinksGrid cargo={6} ufs={ufsDoCargo(7)} />);
    expect(est.querySelectorAll("[data-testid='uf-links-grid-item']")).toHaveLength(26);
    expect(est.querySelector("[data-sigla='DF']")).toBeNull();
  });
});
