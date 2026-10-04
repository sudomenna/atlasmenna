// @vitest-environment happy-dom
/**
 * tests/unit/components/MunicipioExplorer.test.tsx
 *
 * A folha do município passou a ter QUATRO gatilhos em 2026-09-10 (tabela,
 * grade, MAPA e o × que fecha) e um só estado, no store de módulo
 * `components/shared/municipio-sheet-store.ts`. O que estes testes protegem é
 * o contrato desse estado: quem escreve nele abre a folha certa, e um
 * `cod_ibge` que o payload não cobre não abre folha nenhuma.
 *
 * ## Por que este arquivo monta de verdade em vez de `renderToStaticMarkup`
 *
 * O resto da suíte de componentes renderiza estático, e aqui isso não serve:
 * o `useStore` do Zustand v5 resolve `useSyncExternalStore` pelo
 * `getInitialState()` no caminho de servidor, então um `select()` feito antes
 * do render seria invisível — a folha nunca apareceria e o teste passaria
 * verde medindo nada. Montamos no cliente (`createRoot` + `act`, happy-dom),
 * que é o único jeito de o store ser observado. É o mesmo caminho do clique
 * real do mapa (`ChoroplethMapUF` → `useMunicipioSheetStore.getState().select`),
 * menos o MapLibre — o handler do mapa não faz nada além dessa chamada, então
 * o que fica fora daqui é só a entrega do evento pelo canvas WebGL, que o
 * `tests/e2e/municipio-sheet.spec.ts` alcança pelo caminho da tabela.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MunicipioExplorer } from "@/components/blocks/MunicipioExplorer";
import type { MunicipioRow } from "@/components/blocks/MunicipioTable";
import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";
import type { EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function cand(over: Partial<EdgeUfCandidate>): EdgeUfCandidate {
  return {
    id: 0,
    nome: "",
    partido: "",
    cor: "var(--color-cand-other)",
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    ci95: { lower: 0, upper: 0 },
    ...over,
  };
}

// A folha lê destes candidatos apenas nome, partido e cor: os percentuais dela
// saem de `votos_reportados` do município, não do resumo da UF.
const candidatos: EdgeUfCandidate[] = [
  cand({ id: 13, nome: "Candidato PT", partido: "PT", cor: "var(--party-pt)" }),
  cand({ id: 22, nome: "Candidato PL", partido: "PL", cor: "var(--party-pl)" }),
];

// São Paulo traz `eleitores`/`capital` (o payload pós-ADR-0035 D2); Campinas
// NÃO — é o Blob antigo, pré-migration 0006, que o campo opcional preserva.
// Os dois estados convivem de propósito: a folha tem de se comportar nos dois.
const municipios: EdgeUfMunicipio[] = [
  {
    cod_ibge: "3550308",
    nome: "São Paulo",
    pct_apurado: 72.5,
    lider: { candidato_id: 13, partido: "PT", votos: 1200, margem_pp: 20 },
    votos_reportados: { 13: 1200, 22: 800 },
    eleitores: 9_281_234,
    capital: true,
  },
  {
    cod_ibge: "3509502",
    nome: "Campinas",
    pct_apurado: 55,
    lider: { candidato_id: 22, partido: "PL", votos: 500, margem_pp: 25 },
    votos_reportados: { 13: 300, 22: 500 },
  },
];

const rows: MunicipioRow[] = municipios.map((m) => ({
  cod_ibge: m.cod_ibge,
  nome: m.nome,
  lider: m.lider.candidato_id,
  liderCor: m.lider.candidato_id === 13 ? "var(--party-pt)" : "var(--party-pl)",
  liderNome: m.lider.partido,
  margemPp: m.lider.margem_pp,
  pctApurado: m.pct_apurado,
  votosReportados: Object.values(m.votos_reportados).reduce((a, b) => a + b, 0),
}));

let container: HTMLElement;
let root: Root;

function montar() {
  act(() => {
    root.render(
      <MunicipioExplorer
        ufSigla="SP"
        municipios={municipios}
        rows={rows}
        candidatos={candidatos}
      />,
    );
  });
}

/** O que o clique do mapa faz — a única coisa que ele faz. */
function cliqueNoMapa(codIbge: string) {
  act(() => {
    useMunicipioSheetStore.getState().select(codIbge);
  });
}

function folha() {
  return container.querySelector('[data-testid="sheet"]');
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useMunicipioSheetStore.getState().clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("<MunicipioExplorer /> — a folha aberta pelo mapa", () => {
  it("(a) sem seleção, nenhuma folha no DOM", () => {
    montar();
    expect(folha()).toBeNull();
  });

  it("(b) o clique no mapa abre A folha daquele município — uma só", () => {
    montar();
    cliqueNoMapa("3509502");

    // UMA folha. O gatilho do mapa reaproveita a que a tabela já usava; não
    // existe uma segunda folha para o caminho do mapa.
    expect(container.querySelectorAll('[data-testid="sheet"]')).toHaveLength(1);
    expect(folha()?.textContent).toContain("Campinas");
    expect(folha()?.textContent).toContain("Município · SP");
  });

  it("(b2) 2026-10-03 — `limiteLista` corta a LISTA, mas o mapa ainda abre quem ficou de fora", () => {
    act(() => {
      root.render(
        <MunicipioExplorer
          ufSigla="SP"
          municipios={municipios}
          rows={rows}
          candidatos={candidatos}
          limiteLista={1}
        />,
      );
    });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("tbody")?.textContent).not.toContain("Campinas");

    cliqueNoMapa("3509502");
    expect(folha()?.textContent).toContain("Campinas");
  });

  it("(c) município sem dado no payload é no-op — o mapa desenha mais do que o payload cobre", () => {
    montar();
    cliqueNoMapa("3500000");
    // Sem entrada em `municipios` não há nome nem apurado para titular a
    // folha; abrir um diálogo vazio comunicaria menos que não abrir.
    expect(folha()).toBeNull();
  });

  it("(d) fechar a folha limpa o store — o próximo clique reabre", () => {
    montar();
    cliqueNoMapa("3550308");
    const fechar = container.querySelector<HTMLElement>('[data-testid="sheet-close"]');
    act(() => fechar?.click());

    expect(folha()).toBeNull();
    expect(useMunicipioSheetStore.getState().codIbge).toBeNull();

    cliqueNoMapa("3550308");
    expect(folha()).not.toBeNull();
  });

  it("(e) desmontar (trocar de rota) fecha a folha — ela não reabre sozinha depois", () => {
    montar();
    cliqueNoMapa("3550308");
    expect(folha()).not.toBeNull();

    act(() => root.unmount());
    expect(useMunicipioSheetStore.getState().codIbge).toBeNull();

    // Remonta como a próxima página faria: nasce fechada.
    root = createRoot(container);
    montar();
    expect(folha()).toBeNull();
  });

  it("(f) a folha traz o apurado e as linhas de candidato, sem coluna de projeção", () => {
    montar();
    cliqueNoMapa("3550308");

    expect(folha()?.textContent).toContain("Apurado");
    expect(container.querySelectorAll('[data-testid="municipio-sheet-row"]')).toHaveLength(2);
    // 1200 de 2000 = 60,0%. Percentual sobre o apurado NO município.
    expect(folha()?.textContent).toContain("60,0%");
    // Não existe projeção municipal no payload, e a folha diz isso em vez de
    // repetir o parcial numa coluna "PROJ." como o protótipo faz.
    expect(folha()?.textContent).toContain("não existe projeção municipal");
    expect(folha()?.textContent).not.toContain("PROJ.");
  });

  /**
   * 2026-09-11 (ADR-0035 D2) — inversão deliberada deste caso.
   *
   * Até 10/09 o `Figure` "Eleitores" do protótipo (`App.jsx:203`) NÃO podia
   * existir: `EdgeUfMunicipio` não publicava eleitorado por município, e a
   * folha punha o que existia (votos apurados) dizendo na nota que era isso.
   * O campo `eleitores` passou a existir — soma exata dos pares
   * (município × zona) do cadastro do TSE, sem rateio —, então o slot do kit
   * voltou ao lugar. O caso antigo não sumiu: virou o fallback em (h), porque
   * o campo é opcional e Blob pré-migration 0006 segue válido.
   */
  it("(g) com `eleitores` no payload, a segunda medida é o eleitorado", () => {
    montar();
    cliqueNoMapa("3550308"); // São Paulo — a entrada com `eleitores`.

    expect(folha()?.textContent).toContain("Eleitores");
    expect(folha()?.textContent).toContain("9.281.234");
    expect(folha()?.textContent).not.toContain("Votos apurados");
    expect(folha()?.textContent).toContain("soma do eleitorado apto desses mesmos pares");
  });

  it("(h) sem `eleitores`, degrada para votos apurados e diz que degradou", () => {
    montar();
    cliqueNoMapa("3509502"); // Campinas — sem o campo, como um Blob antigo.

    expect(folha()?.textContent).toContain("Votos apurados");
    expect(folha()?.textContent).toContain("não publica o eleitorado do município");
    expect(folha()?.textContent).not.toContain("Eleitores");
  });

  /**
   * Constituição § 8 — a folha não pode deixar o leitor achar que o TSE apura
   * e publica resultado por município. Ele apura por ZONA, e uma zona pode
   * atravessar vários municípios; o total daqui é a soma dos boletins dos
   * pares que caem no município, e o `pct_apurado` é média das zonas
   * ponderada pelo eleitorado do par (`fetch_municipio_aggregates`).
   */
  it("(i) a nota declara a granularidade real do dado, em linguagem simples", () => {
    montar();
    cliqueNoMapa("3550308");
    const texto = folha()?.textContent ?? "";

    expect(texto).toContain("zona eleitoral");
    expect(texto).toContain("uma zona pode atravessar vários municípios");
    expect(texto).toContain("soma dos boletins de cada par município × zona");
    expect(texto).toContain("sem rateio");
    expect(texto).toContain("não existe projeção municipal");
  });

  it("(j) a capital aparece no kicker da folha", () => {
    montar();
    cliqueNoMapa("3550308");
    expect(folha()?.textContent).toContain("Município · SP · capital");

    const fechar = container.querySelector<HTMLElement>('[data-testid="sheet-close"]');
    act(() => fechar?.click());

    cliqueNoMapa("3509502");
    expect(folha()?.textContent).toContain("Município · SP");
    expect(folha()?.textContent).not.toContain("· capital");
  });
});
