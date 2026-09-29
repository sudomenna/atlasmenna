// @vitest-environment happy-dom
/**
 * tests/unit/pages/visoes-editoriais-paginas.test.tsx — as capas com as
 * etiquetas da spec 025 LIGADAS e DESLIGADAS, renderizadas por SSR com o
 * leitor de etiquetas substituído por um `Etiquetas` compilado de verdade.
 *
 *   - desligadas (o estado de hoje): nada editorial no HTML;
 *   - ligadas: chips, filtro, V1 e Câmara 2027 aparecem, com o aviso;
 *   - 🔴 ligar as etiquetas NUNCA muda a ordem das corridas nem das linhas;
 *   - 🔴 o V3 desligado (ou sem critério) não lê o payload de Presidente.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgePayload, EdgePayloadDeputado } from "@/lib/edge-config/types";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { mandatoDeTeste, payloadTresUfs } from "@/tests/fixtures/senado/payload-senado";

import { etiquetasDeTeste, relacaoFixa, universoDoPayload } from "../etiquetas/_visoes-fixtures";

const estado = vi.hoisted(() => ({
  etiquetas: null as Etiquetas | null,
  gov: null as unknown,
  sen: null as unknown,
  dep: null as unknown,
  chamadas: [] as string[],
}));

vi.mock("@/lib/etiquetas/leitor", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/leitor")>();
  return {
    ...m,
    lerEtiquetas: async (o?: { uf?: string | null }) =>
      estado.etiquetas ?? (await m.lerEtiquetas(o)),
  };
});

vi.mock("@/lib/senado/mandato-2031", async (orig) => {
  const m = await orig<typeof import("@/lib/senado/mandato-2031")>();
  const { validarMandato2031 } = m;
  const fixture = (await import("@/tests/fixtures/senado/mandato-2031.fixture.json")).default;
  return { ...m, MANDATO_2031: validarMandato2031(structuredClone(fixture)) };
});

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: async (opts: { cargo?: string; turno?: number }) => {
    estado.chamadas.push(`${opts.cargo}:${opts.turno}`);
    if (opts.cargo === "gov" && opts.turno === 1) return estado.gov;
    if (opts.cargo === "sen") return estado.sen;
    return null;
  },
  readDeputadoProjection: async () => estado.dep,
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
}));

const SenadoPage = (await import("@/app/(sen)/senador/page")).default;
const GovernadorPage = (await import("@/app/(gov)/governador/page")).default;
const DeputadoPage = (await import("@/app/(dep)/deputado-federal/page")).default;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const sen = payloadTresUfs();
const universoSen = universoDoPayload(sen, 5);
const gov = { ...payloadTresUfs(), cargo: 3 } as unknown as EdgePayload;
const universoGov = universoDoPayload(gov, 3);

beforeEach(() => {
  estado.etiquetas = null;
  estado.sen = sen;
  estado.gov = gov;
  estado.chamadas = [];
  void mandatoDeTeste;
});

describe("/senador — etiquetas desligadas e ligadas", () => {
  it("desligadas (cópia do build de hoje): nada editorial no HTML", async () => {
    const html = renderToStaticMarkup(await SenadoPage());
    expect(html).not.toContain('data-testid="etiqueta-editorial"');
    expect(html).not.toContain('data-testid="etiqueta-filtro"');
    expect(html).not.toContain("data-etq");
    expect(html).not.toContain("Senado de 2027: quem terá maioria");
    expect(html).not.toContain("sobre-as-etiquetas");
  });

  it("ligadas: V1 depois do hemiciclo por partido, filtro, chips, aviso — e a MESMA ordem", async () => {
    const antes = parse(renderToStaticMarkup(await SenadoPage()));
    estado.etiquetas = etiquetasDeTeste({
      universo: universoSen,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["chips", "filtro", "v1"],
    });
    const html = renderToStaticMarkup(await SenadoPage());
    const d = parse(html);
    // V1 logo depois do painel de 81 por partido.
    const titulos = [...d.querySelectorAll("h2")].map((h) => h.textContent);
    const i81 = titulos.indexOf("As 81 cadeiras");
    expect(i81).toBeGreaterThanOrEqual(0);
    expect(titulos[i81 + 1]).toBe("Senado de 2027: quem terá maioria");
    // Filtro, com esconder-região.
    expect(d.querySelector("[data-testid='etiqueta-filtro']")?.getAttribute("data-regioes")).toBe(
      "esconder",
    );
    // Tokens no <li> de cada corrida, chips dentro dos cartões.
    expect(d.querySelectorAll("li[data-etq]").length).toBe(3);
    expect(d.querySelectorAll("article[data-etq]").length).toBe(0);
    expect(d.querySelectorAll("a [data-testid='etiqueta-editorial']").length).toBeGreaterThan(0);
    expect(html).toContain("/sobre-as-etiquetas");
    expect(html.toLowerCase()).not.toContain("a classificar");
    // 🔴 A ordem das corridas e das linhas é a mesma de antes.
    const ordem = (doc: Document) =>
      [...doc.querySelectorAll("[data-testid='corrida-uf']")].map((a) => [
        a.getAttribute("data-uf"),
        ...[...a.querySelectorAll("article li > span:nth-child(2)")].map(
          (s) => s.childNodes[0]?.textContent,
        ),
      ]);
    expect(ordem(d)).toEqual(ordem(antes));
  });
});

describe("/governador — filtro junto do de status; V3 sem critério não lê Presidente", () => {
  it("🔴 chips e filtro ligados, V3 ligado mas sem critério ⇒ nenhuma leitura de Presidente", async () => {
    estado.etiquetas = etiquetasDeTeste({
      universo: universoGov,
      comFoto: false,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["chips", "filtro", "v3"],
    });
    const html = renderToStaticMarkup(await GovernadorPage({ searchParams: Promise.resolve({}) }));
    const d = parse(html);
    const nav = d.querySelector("nav[aria-label='Filtros por status']");
    expect(nav?.nextElementSibling?.getAttribute("data-testid")).toBe("etiqueta-filtro");
    expect(
      d.querySelector("[data-testid='etiqueta-filtro']")?.getAttribute("data-regioes"),
    ).toBeNull();
    expect(d.querySelectorAll("article[data-etq]").length).toBe(3);
    expect(html).toContain("/sobre-as-etiquetas");
    // Palanque sem critério publicado ⇒ V3 nem tenta.
    expect(d.querySelector("#palanques-heading")).toBeNull();
    expect(estado.chamadas.some((c) => c.startsWith("pres"))).toBe(false);
  });

  it("desligadas: página sem nada editorial", async () => {
    const html = renderToStaticMarkup(await GovernadorPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("data-etq");
    expect(html).not.toContain('data-testid="etiqueta-filtro"');
  });
});

describe("/deputado-federal — Câmara 2027", () => {
  const dep = {
    ts: "2026-10-04T22:15:00-03:00",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 50,
    ufs_apuradas: 10,
    atualizacao_min: 7,
    bancada: {
      total_cadeiras: 12,
      cadeiras_atribuidas: 10,
      ufs_calculadas: 10,
      ufs_aguardando: 17,
      por_agremiacao: [
        {
          cod: "22",
          sigla: "PL",
          nome: "PL",
          tipo: "partido",
          componentes: [],
          sigla_lider: "PL",
          cadeiras: 6,
          votos_nominais: 1,
          votos_legenda: 0,
          votos_validos: 1,
          pct_votos: 60,
        },
        {
          cod: "13",
          sigla: "PT",
          nome: "PT",
          tipo: "partido",
          componentes: [],
          sigla_lider: "PT",
          cadeiras: 4,
          votos_nominais: 1,
          votos_legenda: 0,
          votos_validos: 1,
          pct_votos: 40,
        },
      ],
    },
    por_uf: [],
    insights: [],
  } as unknown as EdgePayloadDeputado;

  it("ligada: painel depois do plenário por partido, que segue SEM marca de limiar", async () => {
    estado.dep = dep;
    estado.etiquetas = etiquetasDeTeste({
      universo: [
        { sqcand: "250000000001", cargo: 6, uf: "SP", partido: "PL", federacao: null },
        { sqcand: "250000000002", cargo: 6, uf: "SP", partido: "PT", federacao: null },
      ],
      comFoto: false,
      relacaoPorPartido: relacaoFixa,
      ligadas: ["camara2027"],
    });
    const d = parse(renderToStaticMarkup(await DeputadoPage()));
    const titulos = [...d.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(titulos.indexOf("Câmara de 2027: quem terá maioria")).toBe(
      titulos.indexOf("Câmara dos Deputados 2026") + 1,
    );
    // A visão por partido não ganhou marca (ADR-0049 item 6 vale para ela);
    // as marcas moram só na visão por bloco.
    const porPartido = d.querySelector("[data-testid='camara-hemiciclo']");
    expect(porPartido).not.toBeNull();
    expect(porPartido?.querySelectorAll("[data-limiar]").length).toBe(0);
    expect(
      d.querySelectorAll("[data-testid='hemiciclo-por-bloco'] svg g[data-limiar]").length,
    ).toBe(3);
  });

  it("desligada: nada", async () => {
    estado.dep = dep;
    const html = renderToStaticMarkup(await DeputadoPage());
    expect(html).not.toContain("Câmara de 2027");
  });
});
