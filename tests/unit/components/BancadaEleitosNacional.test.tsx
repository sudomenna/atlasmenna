// @vitest-environment happy-dom
/**
 * tests/unit/components/BancadaEleitosNacional.test.tsx — spec 026 RF-299 e
 * RF-300 (ADR-0063, emenda de 04/10 (2)): as ilhas da bancada da capa
 * `/deputado-federal`, montadas DENTRO do `<DeputadoBancadaPanel>` de verdade.
 *
 * Duas metades, como `DeputadoListaAgremiacao.test.tsx`: `renderToStaticMarkup`
 * para o HTML que o servidor manda (nada de projeção, nenhuma busca, só a
 * reserva do botão) e `createRoot` + `act` para o que só existe no navegador
 * (o botão, a busca única, as duas bases, o foco, os erros).
 *
 * Mutações aplicadas à mão (04/10) — cada uma derruba ao menos um caso:
 *   - a ilha ignorando o interruptor da PÁGINA (`visaoDoCenario` com
 *     `ligadaNaPagina` sempre `true`);
 *   - a store sem o cache de 60 s (`garantirEleitosNacionais` buscando sempre);
 *   - o "Recolher" sem devolver o foco;
 *   - o rótulo do misto com o "27" escrito à mão.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", async () => {
  const mod = await import("@/components/blocks/BancadaEleitosNacionalLista");
  return { default: () => mod.BancadaEleitosNacionalLista };
});

import {
  _reiniciarEleitosNacionais,
  ROTA_ELEITOS_NACIONAIS,
} from "@/components/blocks/BancadaEleitosNacional";
import { DeputadoBancadaPanel } from "@/components/blocks/DeputadoBancadaPanel";
import type { EleitosNacionais, LinhaEleitoNacional } from "@/lib/deputado/eleitos-nacionais";
import {
  FRASE_NENHUMA_LIBERADA,
  FRASE_PROJECAO_DESLIGADA,
  rotuloDoMisto,
  visaoDoCenario,
} from "@/lib/deputado/eleitos-nacionais-visao";
import type { EdgeAgremiacaoBancada } from "@/lib/edge-config/types";
import { __resetViewModeForTests, setViewMode } from "@/lib/state/view-mode-client";
import { BIT_MARCA } from "@/lib/utils/deputado-marcas";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------

const UFS27 = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

const P = BIT_MARCA.PARCIAL;
const PJ = BIT_MARCA.PROJECAO;
const TSE = BIT_MARCA.TSE | BIT_MARCA.TSE_QP;
const FOTO_ANA = "https://exemplo.public.blob.vercel-storage.com/candidatos/foto/SP/1.jpg";

/**
 * PT (13): BA 1 na parcial; SP 2 na parcial e na projeção, mais 1 SÓ na
 * projeção. PL (22): AC pelo TSE, SP 1 só na parcial. "77" tem cadeira no
 * cenário e não tem linha no painel. SP liberada, BA travada, AC totalizada,
 * as outras 24 sem dado.
 */
function dados(over: Partial<EleitosNacionais> = {}): EleitosNacionais {
  const pt: LinhaEleitoNacional[] = [
    ["BA", 8, "BAIANO DA PARCIAL", "PT", 1302, 80_000, 3.1, P],
    ["SP", 1, "ANA PAULISTA", "PT", 1303, 500_000, 6.07, P | PJ, FOTO_ANA],
    ["SP", 2, "BRUNO PAULISTA", "PV", 4301, 400_000, 5.1, P | PJ],
    ["SP", 3, "CARLA SÓ PROJEÇÃO", "PC do B", 6501, 300_000, 4, PJ | BIT_MARCA.PROJECAO_SOBRA],
  ];
  const pl: LinhaEleitoNacional[] = [
    ["AC", 20, "DAVI DO TSE", "", 2201, 50_000, 20.5, TSE],
    ["SP", 21, "EVA SÓ PARCIAL", "", 2202, 90_000, 1.2, P],
  ];
  return {
    ts: "2026-10-04T22:00:00.000Z",
    projecao_desligada: false,
    ufs_total: 27,
    ufs_liberadas: ["SP"],
    ufs_parcial: ["BA"],
    ufs_tse: ["AC"],
    ufs_sem_dado: UFS27.filter((u) => !["SP", "BA", "AC"].includes(u)),
    agremiacoes: [
      { cod: "13", sigla: "PT/PC do B/PV", parcial: 3, cenario: 4, linhas: pt },
      { cod: "22", sigla: "PL", parcial: 2, cenario: 1, linhas: pl },
      { cod: "55", sigla: "PSD", parcial: 0, cenario: 0, linhas: [] },
      {
        cod: "77",
        sigla: "NOVO X",
        parcial: 0,
        cenario: 2,
        linhas: [["SP", 30, "FÁBIO NOVO", "", 7701, 70_000, 1, PJ]],
      },
    ],
    ...over,
  };
}

function bancada(cod: string, sigla: string, cadeiras: number): EdgeAgremiacaoBancada {
  return {
    cod,
    sigla,
    nome: `Agremiação ${sigla}`,
    tipo: cod === "13" ? "federacao" : "partido",
    componentes: cod === "13" ? ["PT", "PC do B", "PV"] : [],
    sigla_lider: cod === "13" ? "PT" : sigla,
    cadeiras,
    votos_nominais: 1_000_000,
    votos_legenda: 10_000,
    votos_validos: 1_010_000,
    pct_votos: 10,
  };
}

function Painel({
  ligada = true,
  cadeirasPt = 3,
  ocultar = false,
}: {
  ligada?: boolean;
  cadeirasPt?: number;
  ocultar?: boolean;
}) {
  return (
    <DeputadoBancadaPanel
      kicker="Bancada apurada"
      title="Quem fica com as cadeiras"
      titleId="bancada-heading"
      agremiacoes={[
        bancada("13", "PT/PC do B/PV", cadeirasPt),
        bancada("22", "PL", 2),
        bancada("55", "PSD", 0),
      ]}
      total={20}
      atribuidas={5}
      rotuloBarra="Bancada de 20 cadeiras"
      fraseAguardando={<>cadeiras ainda sem dono.</>}
      nota={<p>nota</p>}
      eleitosNacionais={{ projecaoLigada: ligada }}
      ocultarSemCadeira={ocultar}
    />
  );
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let agora = 1_000_000;

function responder(corpo: unknown, status = 200) {
  fetchSpy.mockImplementation(
    (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch,
  );
}

async function esperar(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function montar(el: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el);
  });
  await esperar();
  return host;
}

async function rerender(el: React.ReactElement): Promise<void> {
  await act(async () => {
    root?.render(el);
  });
  await esperar();
}

function botao(cod: string): HTMLButtonElement {
  const b = host?.querySelector<HTMLButtonElement>(
    `[data-cod="${cod}"] [data-testid="bancada-ver-eleitos"]`,
  );
  if (!b) throw new Error(`sem botão de ${cod}`);
  return b;
}

async function clicar(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
  await esperar();
}

function regiao(cod: string): HTMLElement {
  const id = botao(cod).getAttribute("aria-controls") ?? "";
  const el = host?.ownerDocument.getElementById(id);
  if (!el) throw new Error(`aria-controls de ${cod} aponta para o nada`);
  return el;
}

function chamadasDaRota(): number {
  return fetchSpy.mock.calls.filter(([u]: unknown[]) => String(u) === ROTA_ELEITOS_NACIONAIS)
    .length;
}

beforeEach(() => {
  _reiniciarEleitosNacionais();
  __resetViewModeForTests();
  agora = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => agora);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  responder(dados());
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const so = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// O HTML do servidor
// ---------------------------------------------------------------------------

describe("o HTML do servidor — a parcial de antes, sem projeção e sem busca", () => {
  it("só a reserva do botão por linha; nenhuma palavra de projeção; nenhum fetch", () => {
    const html = renderToStaticMarkup(<Painel />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const linhas = [...doc.querySelectorAll("[data-testid='bancada-linha']")];
    expect(linhas).toHaveLength(3);
    for (const li of linhas) {
      const reserva = li.querySelector("[data-acoes]");
      expect(reserva).not.toBeNull();
      expect(reserva?.innerHTML).toBe("");
    }
    expect(doc.querySelector("button")).toBeNull();
    expect(doc.body.textContent).not.toMatch(/proje(ção|tad)/i);
    expect(doc.querySelector("[data-testid='bancada-cadeiras']")?.textContent).toBe("3");
    // A célula do número é a de sempre (o (c0) da capa a mede).
    expect(
      so(doc.querySelector("[data-testid='bancada-cadeiras']")?.parentElement?.textContent),
    ).toBe("3 cadeiras conquistadas");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sem `eleitosNacionais` (a capa das assembleias) o painel é o de antes: sem reserva, sem classe", () => {
    const html = renderToStaticMarkup(
      <DeputadoBancadaPanel
        kicker="k"
        title="t"
        titleId="x"
        agremiacoes={[bancada("13", "PT/PC do B/PV", 3)]}
        total={10}
        atribuidas={3}
        rotuloBarra="r"
        fraseAguardando={<>a</>}
        nota={null}
      />,
    );
    expect(html).not.toContain("data-acoes");
    expect(html).not.toContain("bancada-cenario-legenda");
    expect(html).not.toMatch(/<ul[^>]*class=/);
  });
});

// ---------------------------------------------------------------------------
// RF-299 — a lista nacional por agremiação
// ---------------------------------------------------------------------------

describe("RF-299 — Ver os eleitos (base Parcial)", () => {
  beforeEach(() => {
    setViewMode("parcial");
  });

  it("botão com `aria-expanded` e `aria-controls`; nenhuma busca antes do clique", async () => {
    await montar(<Painel />);
    const b = botao("13");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(so(b.textContent)).toBe("Ver os eleitos de PT/PC do B/PV");
    expect(regiao("13").hidden).toBe(true);
    expect(chamadasDaRota()).toBe(0);
  });

  it("abre: grupos BA e SP nessa ordem, 'N eleitos na parcial em K estados'; quem é só da projeção fica fora", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    expect(botao("13").getAttribute("aria-expanded")).toBe("true");
    expect(so(botao("13").textContent)).toBe("Esconder os eleitos de PT/PC do B/PV");
    const r = regiao("13");
    expect(r.hidden).toBe(false);
    const grupos = [...r.querySelectorAll<HTMLElement>("[data-uf]")];
    expect(grupos.map((g) => g.dataset.uf)).toEqual(["BA", "SP"]);
    expect(so(grupos[0]?.querySelector("p")?.textContent)).toBe("BA · 1 eleito na parcial");
    expect(so(grupos[1]?.querySelector("p")?.textContent)).toBe("SP · 2 eleitos na parcial");
    // Dentro da UF, a ordem recebida (o rank).
    expect([...(grupos[1]?.querySelectorAll("b") ?? [])].map((x) => x.textContent)).toEqual([
      "ANA PAULISTA",
      "BRUNO PAULISTA",
    ]);
    expect(so(r.querySelector("[data-testid='bancada-eleitos-cabecalho']")?.textContent)).toMatch(
      /^3 eleitos na parcial em 2 estados · eleito na parcial não é resultado oficial\./,
    );
    expect(r.textContent).not.toContain("CARLA SÓ PROJEÇÃO");
    // Só a marca da parcial — nada de projeção nesta base.
    expect(r.querySelector("[data-marca='projecao']")).toBeNull();
    expect(r.querySelectorAll("[data-marca='parcial']").length).toBe(3);
    // Partido em federação; voto apurado e % dos válidos.
    expect(r.textContent).toContain("nº 4301 · PV");
    expect(r.textContent).toContain("400.000");
    // UFs sem dado: ditas, nunca "0 eleitos".
    expect(r.querySelector("[data-testid='bancada-eleitos-sem-dado']")?.textContent).toContain(
      "Sem dado agora, fora da conta: AL, AM",
    );
    expect(r.textContent).not.toMatch(/\b0 eleitos?\b/);
  });

  it("🔴 uma busca por aba: abrir o PT e o PL, fechar e reabrir em 60 s — uma requisição", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    await clicar(botao("22"));
    expect(regiao("22").querySelectorAll("[data-uf]").length).toBe(2);
    await clicar(botao("13"));
    await clicar(botao("13"));
    agora += 59_000;
    await clicar(botao("22"));
    await clicar(botao("22"));
    expect(chamadasDaRota()).toBe(1);
  });

  it("PL com AC totalizada: 'Eleito (TSE)' e o cabeçalho diz parcial ou TSE", async () => {
    await montar(<Painel />);
    await clicar(botao("22"));
    const r = regiao("22");
    const ac = r.querySelector("[data-uf='AC']");
    expect(so(ac?.querySelector("p")?.textContent)).toBe("AC · 1 eleito (TSE)");
    expect(ac?.querySelector("[data-marca='tse']")?.textContent).toBe("Eleito (TSE)");
    expect(ac?.querySelector("[data-marca='parcial']")).toBeNull();
    expect(so(r.querySelector("[data-testid='bancada-eleitos-cabecalho']")?.textContent)).toMatch(
      /^2 eleitos em 2 estados, na parcial ou pelo TSE/,
    );
  });

  it("avatar só nos eleitos (foto e iniciais); quem não é eleito na parcial/TSE não tem", async () => {
    setViewMode("proj");
    await montar(<Painel />);
    await clicar(botao("13"));
    const sp = regiao("13").querySelector("[data-uf='SP']");
    const linha = (nome: string) =>
      [...(sp?.querySelectorAll("li") ?? [])].find((li) => li.textContent?.includes(nome));
    expect(linha("ANA PAULISTA")?.querySelector("img")?.getAttribute("src")).toBe(FOTO_ANA);
    expect(linha("ANA PAULISTA")?.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(
      linha("BRUNO PAULISTA")?.querySelector("[data-testid='candidate-avatar-fallback']"),
    ).not.toBeNull();
    const carla = linha("CARLA SÓ PROJEÇÃO");
    expect(carla).toBeDefined();
    expect(carla?.querySelector("[data-testid^='candidate-avatar']")).toBeNull();
  });

  it("'Recolher' fecha a lista e devolve o foco ao botão de abrir", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    const recolher = regiao("13").querySelector<HTMLButtonElement>(
      "[data-testid='bancada-eleitos-recolher']",
    );
    expect(so(recolher?.textContent)).toBe("Recolher os eleitos de PT/PC do B/PV");
    recolher?.focus();
    await clicar(recolher as HTMLButtonElement);
    expect(botao("13").getAttribute("aria-expanded")).toBe("false");
    expect(regiao("13").hidden).toBe(true);
    expect(document.activeElement).toBe(botao("13"));
  });

  it("aberta, acompanha a atualização da página: re-render depois de 60 s busca de novo e não fecha", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    expect(chamadasDaRota()).toBe(1);
    responder(
      dados({
        agremiacoes: [
          {
            cod: "13",
            sigla: "PT/PC do B/PV",
            parcial: 4,
            cenario: 4,
            linhas: [
              ["BA", 8, "BAIANO DA PARCIAL", "PT", 1302, 80_000, 3.1, P],
              ["BA", 9, "NOVO ELEITO", "PT", 1309, 70_000, 2.9, P],
            ],
          },
        ],
      }),
    );
    agora += 61_000;
    // `router.refresh()` = o servidor reemite o painel com props novas.
    await rerender(<Painel cadeirasPt={4} />);
    expect(chamadasDaRota()).toBe(2);
    expect(botao("13").getAttribute("aria-expanded")).toBe("true");
    expect(regiao("13").textContent).toContain("NOVO ELEITO");
  });
});

describe("RF-299 — erros e 404 na lista aberta", () => {
  beforeEach(() => {
    setViewMode("parcial");
  });

  it("404 (antes da apuração): 'ainda não está disponível' + 'Tentar de novo'; os números da bancada intactos", async () => {
    responder({ error: "eleitos_inexistentes" }, 404);
    await montar(<Painel />);
    await clicar(botao("13"));
    const r = regiao("13");
    expect(r.querySelector("[role='status']")?.textContent).toBe(
      "A lista de eleitos ainda não está disponível.",
    );
    expect(r.querySelector("[data-testid='bancada-eleitos-tentar']")).not.toBeNull();
    expect(
      host?.querySelector("[data-cod='13'] [data-testid='bancada-cadeiras']")?.textContent,
    ).toBe("3");
  });

  it("erro: 'Não deu para carregar a lista agora.'; 'Tentar de novo' busca de verdade", async () => {
    responder({ error: "blob_indisponivel" }, 502);
    await montar(<Painel />);
    await clicar(botao("13"));
    const r = regiao("13");
    expect(r.querySelector("[role='status']")?.textContent).toBe(
      "Não deu para carregar a lista agora.",
    );
    responder(dados());
    await clicar(r.querySelector("[data-testid='bancada-eleitos-tentar']") as HTMLButtonElement);
    expect(chamadasDaRota()).toBe(2);
    expect(r.querySelectorAll("[data-uf]").length).toBe(2);
    expect(r.querySelector("[data-testid='bancada-eleitos-tentar']")).toBeNull();
  });

  it("rede caiu (fetch rejeita): mesma mensagem, e nada quebra", async () => {
    fetchSpy.mockRejectedValue(new TypeError("offline"));
    await montar(<Painel />);
    await clicar(botao("13"));
    expect(regiao("13").querySelector("[role='status']")?.textContent).toBe(
      "Não deu para carregar a lista agora.",
    );
  });
});

// ---------------------------------------------------------------------------
// RF-300 — o cenário projetado nacional
// ---------------------------------------------------------------------------

describe("RF-300 — base Projeção, projeção ligada", () => {
  beforeEach(() => {
    setViewMode("proj");
  });

  it("busca sozinha (uma vez), sem clique; a linha mostra o cenário E a parcial com o nome dela", async () => {
    await montar(<Painel />);
    expect(chamadasDaRota()).toBe(1);
    const pt = host?.querySelector("[data-cod='13']");
    expect(pt?.querySelector("[data-testid='bancada-cadeiras-cenario']")?.textContent).toBe("4");
    // A parcial continua no DOM (só a ênfase muda — Decisão 5)…
    expect(pt?.querySelector("[data-testid='bancada-cadeiras']")?.textContent).toBe("3");
    // …e nomeada, no MESMO elemento do rótulo do cenário (RF-266).
    const rotulo = so(pt?.querySelector("[data-testid='bancada-cenario']")?.textContent);
    expect(rotulo).toBe(
      "4 no cenário · projeção · não oficial, pontual — projeção em 1 de 27 estados; no outro, a parcial; em 1, o resultado do TSE; 24 sem dado agora, fora da conta · 3 na parcial",
    );
    // As duas versões sob a cascata `[data-view-only]` (RF-180).
    expect(
      pt?.querySelector("[data-view-only='proj'] [data-testid='bancada-cadeiras-cenario']"),
    ).not.toBeNull();
    expect(
      pt?.querySelector("[data-view-only='parcial'] [data-testid='bancada-cadeiras']"),
    ).not.toBeNull();
    // Abrir depois, dentro de 60 s, não busca de novo.
    await clicar(botao("13"));
    expect(chamadasDaRota()).toBe(1);
  });

  it("a barra ganha a versão do cenário, sob o mesmo rótulo", async () => {
    await montar(<Painel />);
    const barra = host?.querySelector("[data-testid='bancada-barra-cenario']");
    expect(barra?.getAttribute("data-view-only")).toBe("proj");
    const rotulo = barra?.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(rotulo).toContain("projeção · não oficial, pontual");
    expect(rotulo).toContain("PT/PC do B/PV 4, PL 1, NOVO X 2");
    // 20 − (4 + 1 + 0 + 2) = 13 aguardando.
    expect(rotulo).toContain("13 aguardando apuração");
    // A barra da parcial continua no DOM, para a base Parcial.
    expect(
      host?.querySelector("[data-view-only='parcial'] [data-testid='vote-bar']"),
    ).not.toBeNull();
    const legenda = so(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent);
    expect(legenda).toContain("projeção em 1 de 27 estados");
    expect(legenda).toContain("não oficial");
  });

  it("a lista: UF liberada com 'eleito na projeção · não oficial', travada com o subtítulo, cada nome diz de onde veio", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    const r = regiao("13");
    const sp = r.querySelector("[data-uf='SP']");
    const ba = r.querySelector("[data-uf='BA']");
    expect(sp?.getAttribute("data-origem")).toBe("projecao");
    expect(so(sp?.querySelector("p")?.textContent)).toBe(
      "SP · 3 eleitos na projeção · não oficial",
    );
    expect(sp?.querySelectorAll("[data-marca='projecao']").length).toBe(3);
    expect(sp?.querySelector("[data-marca='parcial']")).toBeNull();
    expect(sp?.textContent).toContain("CARLA SÓ PROJEÇÃO");
    expect(so(ba?.querySelector("p")?.textContent)).toBe(
      "BA · 1 eleito na parcial — projeção ainda travada neste estado",
    );
    expect(ba?.querySelector("[data-marca='parcial']")).not.toBeNull();
    expect(so(r.querySelector("[data-testid='bancada-eleitos-cabecalho']")?.textContent)).toMatch(
      /^4 no cenário projetado · não oficial, pontual · projeção em 1 de 27 estados/,
    );
  });

  it("'Eleito (TSE)' tem precedência: a UF totalizada mostra só ela, também na Projeção", async () => {
    await montar(<Painel />);
    await clicar(botao("22"));
    const ac = regiao("22").querySelector("[data-uf='AC']");
    expect(ac?.getAttribute("data-origem")).toBe("tse");
    expect(
      [...(ac?.querySelectorAll("[data-marca]") ?? [])].map((m) => m.getAttribute("data-marca")),
    ).toEqual(["tse"]);
    // SP do PL só tem eleito na parcial — fora do cenário nesta UF liberada.
    expect(regiao("22").querySelector("[data-uf='SP']")).toBeNull();
  });

  it("agremiação com cadeira no cenário e sem linha no painel entra no fim, parcial zero", async () => {
    await montar(<Painel />);
    const extra = host?.querySelector("[data-testid='bancada-linha-cenario'][data-cod='77']");
    expect(extra).not.toBeNull();
    expect(so(extra?.textContent)).toContain("NOVO X");
    expect(so(extra?.textContent)).toContain("0 na parcial");
    // Depois das linhas do painel.
    const cods = [...(host?.querySelectorAll("#bancada-agremiacoes > li[data-cod]") ?? [])].map(
      (li) => li.getAttribute("data-cod"),
    );
    expect(cods).toEqual(["13", "22", "55", "77"]);
  });

  it("a ordem das linhas é a da parcial, nas duas bases (mesmo com cenário maior embaixo)", async () => {
    await montar(<Painel />);
    const ordem = () =>
      [...(host?.querySelectorAll("[data-testid='bancada-linha']") ?? [])].map((li) =>
        li.getAttribute("data-cod"),
      );
    const naProjecao = ordem();
    await act(async () => setViewMode("parcial"));
    expect(ordem()).toEqual(naProjecao);
    expect(naProjecao).toEqual(["13", "22", "55"]);
  });

  it("RF-266 — todo número de projeção está no mesmo elemento que 'não oficial'", async () => {
    await montar(<Painel />);
    await clicar(botao("13"));
    const alvos = [
      ...(host?.querySelectorAll(
        "[data-testid='bancada-cenario'], [data-testid='bancada-cenario-legenda'], [data-testid='bancada-eleitos-cabecalho'], [data-origem='projecao'] > p, [data-marca='projecao']",
      ) ?? []),
    ];
    expect(alvos.length).toBeGreaterThan(4);
    for (const el of alvos) {
      if (/proje(ção|tad)/i.test(el.textContent ?? "")) {
        expect(el.textContent, el.outerHTML.slice(0, 80)).toContain("não oficial");
      }
    }
    // Nenhum voto projetado por candidato (RF-297).
    expect(host?.textContent).not.toMatch(/projeção ≈/);
  });
});

describe("RF-300 — interruptor e X = 0", () => {
  beforeEach(() => {
    setViewMode("proj");
  });

  it("🔴 página diz 'desligada': nenhuma busca no carregamento, e a frase de desligada", async () => {
    await montar(<Painel ligada={false} />);
    expect(chamadasDaRota()).toBe(0);
    expect(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent).toBe(
      FRASE_PROJECAO_DESLIGADA,
    );
    expect(host?.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
  });

  it("🔴 página 'desligada' e a rota (cache do CDN) ainda com projeção: a ilha a IGNORA", async () => {
    await montar(<Painel ligada={false} />);
    await clicar(botao("13"));
    expect(chamadasDaRota()).toBe(1);
    const r = regiao("13");
    expect(host?.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
    expect(host?.querySelector("[data-testid='bancada-cenario']")).toBeNull();
    expect(host?.querySelector("[data-testid='bancada-barra-cenario']")).toBeNull();
    expect(r.querySelector("[data-testid='bancada-eleitos-aviso']")?.textContent).toBe(
      FRASE_PROJECAO_DESLIGADA,
    );
    expect(r.querySelector("[data-marca='projecao']")).toBeNull();
    expect(r.textContent).not.toContain("CARLA SÓ PROJEÇÃO");
    expect(host?.textContent).not.toMatch(/cenário projetado/);
  });

  it("a rota diz desligada (e a página ligada): também nada de projeção", async () => {
    responder(dados({ projecao_desligada: true, ufs_liberadas: [], ufs_parcial: ["BA", "SP"] }));
    await montar(<Painel />);
    expect(host?.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
    expect(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent).toBe(
      FRASE_PROJECAO_DESLIGADA,
    );
  });

  it("X = 0: a parcial NÃO é chamada de 'cenário projetado'; a tela diz que nenhum estado está liberado", async () => {
    responder(dados({ ufs_liberadas: [], ufs_parcial: ["BA", "SP"] }));
    await montar(<Painel />);
    await clicar(botao("13"));
    expect(host?.textContent).not.toMatch(/cenário projetado/);
    expect(host?.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
    expect(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent).toBe(
      FRASE_NENHUMA_LIBERADA,
    );
    expect(regiao("13").querySelector("[data-testid='bancada-eleitos-aviso']")?.textContent).toBe(
      FRASE_NENHUMA_LIBERADA,
    );
  });

  it("busca em andamento ou falha: a parcial fica, com aviso curto — nunca zero", async () => {
    let soltar: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(
      (() =>
        new Promise<Response>((r) => {
          soltar = r;
        })) as unknown as typeof fetch,
    );
    await montar(<Painel />);
    expect(
      host?.querySelector("[data-cod='13'] [data-testid='bancada-cadeiras']")?.textContent,
    ).toBe("3");
    expect(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent).toBe(
      "Carregando o cenário · projeção · não oficial…",
    );
    await act(async () => {
      soltar(new Response("x", { status: 502 }));
    });
    await esperar();
    expect(
      host?.querySelector("[data-cod='13'] [data-testid='bancada-cadeiras']")?.textContent,
    ).toBe("3");
    expect(host?.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
    expect(host?.querySelector("[data-testid='bancada-cenario-legenda']")?.textContent).toMatch(
      /^Não deu para carregar o cenário · projeção · não oficial agora/,
    );
  });
});

// ---------------------------------------------------------------------------
// O rótulo do misto — X e Y dos dados, nunca literais
// ---------------------------------------------------------------------------

describe("rotuloDoMisto / visaoDoCenario", () => {
  function comBases(liberadas: number, travadas: number, semDado = 0): EleitosNacionais {
    return dados({
      ufs_liberadas: UFS27.slice(0, liberadas),
      ufs_parcial: UFS27.slice(liberadas, liberadas + travadas),
      ufs_tse: [],
      ufs_sem_dado: UFS27.slice(liberadas + travadas, liberadas + travadas + semDado),
      ufs_total: 27,
    });
  }

  it("19 liberadas e 8 travadas", () => {
    expect(rotuloDoMisto(visaoDoCenario(comBases(19, 8), true))).toBe(
      "projeção em 19 de 27 estados; nos outros 8, a parcial",
    );
  });

  it("3 liberadas e 24 travadas — pega um literal escrito à mão", () => {
    expect(rotuloDoMisto(visaoDoCenario(comBases(3, 24), true))).toBe(
      "projeção em 3 de 27 estados; nos outros 24, a parcial",
    );
  });

  it("1 sem dado: 'Z sem dado agora, fora da conta'", () => {
    expect(rotuloDoMisto(visaoDoCenario(comBases(19, 7, 1), true))).toBe(
      "projeção em 19 de 27 estados; nos outros 7, a parcial; 1 sem dado agora, fora da conta",
    );
  });

  it("o total vem da resposta (a lista fechada da rota), não de um 27 no código", () => {
    const d = { ...comBases(2, 3), ufs_total: 5 };
    expect(rotuloDoMisto(visaoDoCenario(d, true))).toBe(
      "projeção em 2 de 5 estados; nos outros 3, a parcial",
    );
  });

  it("página desligada: as liberadas da resposta viram parcial, cenário = parcial", () => {
    const v = visaoDoCenario(comBases(19, 8), false);
    expect(v).toMatchObject({ ligada: false, pronto: false, x: 0, y: 27 });
    for (const a of v.porCod.values()) expect(a.cenario).toBe(a.parcial);
  });
});

// ---------------------------------------------------------------------------
// Decisão do dono (04/10) — zero cadeiras fora da lista, de volta pelo cenário
// ---------------------------------------------------------------------------

describe("ocultarSemCadeira — a lista só com quem tem cadeira na parcial", () => {
  function comCenarioNoPsd(): EleitosNacionais {
    const d = dados();
    return {
      ...d,
      agremiacoes: d.agremiacoes.map((a) =>
        a.cod === "55"
          ? { ...a, cenario: 1, linhas: [["SP", 40, "GIL DO PSD", "", 5501, 60_000, 1, PJ]] }
          : a.cod === "22"
            ? { ...a, cenario: 0 }
            : a,
      ),
    };
  }

  it("Parcial: a agremiação de zero (PSD) não tem linha", async () => {
    setViewMode("parcial");
    await montar(<Painel ocultar />);
    const cods = [...(host?.querySelectorAll("[data-testid='bancada-linha']") ?? [])].map((li) =>
      li.getAttribute("data-cod"),
    );
    expect(cods).toEqual(["13", "22"]);
    expect(host?.querySelector("[data-testid='bancada-linha-cenario']")).toBeNull();
  });

  it("Projeção: zero na parcial e cadeira no cenário volta no fim; parcial > 0 e cenário 0 fica, com o zero", async () => {
    setViewMode("proj");
    responder(comCenarioNoPsd());
    await montar(<Painel ocultar />);
    const ordem = [...(host?.querySelectorAll("#bancada-agremiacoes > li[data-cod]") ?? [])].map(
      (li) => `${li.getAttribute("data-testid")}:${li.getAttribute("data-cod")}`,
    );
    // PSD (no painel, escondido) antes de "77" (que o painel nem conhece).
    expect(ordem).toEqual([
      "bancada-linha:13",
      "bancada-linha:22",
      "bancada-linha-cenario:55",
      "bancada-linha-cenario:77",
    ]);
    const psd = host?.querySelector("[data-testid='bancada-linha-cenario'][data-cod='55']");
    expect(so(psd?.textContent)).toContain("0 na parcial");
    // A cor do PSD na barra do cenário é a dele, não a de "outros".
    const segPsd = host?.querySelector(
      "[data-testid='bancada-barra-cenario'] [data-testid='vote-bar-segment'][data-label='PSD']",
    );
    expect(segPsd?.getAttribute("style")).toContain("var(--party-psd)");
    // PL: parcial 2, cenário 0 — continua visível, com o zero do cenário.
    const pl = host?.querySelector("[data-testid='bancada-linha'][data-cod='22']");
    expect(pl?.querySelector("[data-testid='bancada-cadeiras-cenario']")?.textContent).toBe("0");
    expect(so(pl?.querySelector("[data-testid='bancada-cenario']")?.textContent)).toMatch(
      /^0 no cenário · projeção · não oficial, pontual — .* · 2 na parcial$/,
    );
  });
});
