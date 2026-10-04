// @vitest-environment happy-dom
/**
 * tests/unit/shell/atualizacao-automatica.test.tsx
 *
 * `<AtualizacaoAutomatica>` (shell) e `<PausaAtualizacao>` (rodapé) — a
 * atualização automática das páginas de apuração (04/10/2026, decisão do
 * dono) e o controle de pausa que a WCAG 2.2.2 exige dela.
 *
 * O que cada bloco derruba (mutação que morre):
 *   - intervalo/jitter: trocar `ATUALIZACAO_INTERVALO_MS` ou somar o jitter
 *     fora da faixa 0–15 s;
 *   - aba oculta: remover `visivel()` de `podeRodar`;
 *   - volta da aba: remover o `atualizar()` de `sincronizar`, ou trocar `>` por
 *     `>=` com espera curta;
 *   - rotas: trocar a regex por `.*`;
 *   - pausa: não ler `lerPausada()` no disparo; não assinar o evento;
 *   - saveData: remover o `return` de `economiaDeDados()`.
 */

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
let pathnameAtual: string | null = "/";

vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
  usePathname: () => pathnameAtual,
}));
// Objeto estável, como o do App Router — senão o efeito reiniciaria a cada render.
const ROUTER = { refresh: (...a: unknown[]) => refresh(...a) };

import { AtualizacaoAutomatica } from "@/components/layout/AtualizacaoAutomatica";
import {
  __resetAtualizacaoForTests,
  ATUALIZACAO_INTERVALO_MS,
  ATUALIZACAO_JITTER_MS,
  ATUALIZACAO_STORAGE_KEY,
  gravarPausada,
  lerPausada,
  rotaComAtualizacao,
} from "@/components/layout/atualizacao-estado";
import { PausaAtualizacao } from "@/components/layout/PausaAtualizacao";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let visibilidade: DocumentVisibilityState = "visible";
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mudarVisibilidade(v: DocumentVisibilityState) {
  visibilidade = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function avancar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function montar(node: React.ReactElement = <AtualizacaoAutomatica />) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  pathnameAtual = "/";
  visibilidade = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
  });
  // Jitter fixo no meio da faixa: 60 s + 7,5 s.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  __resetAtualizacaoForTests();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  // biome-ignore lint/suspicious/noExplicitAny: limpeza do stub de `navigator.connection`
  delete (navigator as any).connection;
  __resetAtualizacaoForTests();
});

describe("rotaComAtualizacao — a lista de permitidas", () => {
  it.each([
    "/",
    "/governador",
    "/senador",
    "/deputado-federal",
    "/deputado-estadual",
    "/uf/SP",
    "/uf/sp",
    "/uf/SP/",
    "/uf/SP/governador",
    "/uf/RJ/senador",
    "/uf/MG/deputado-federal",
    "/uf/BA/deputado-estadual",
    "/uf/DF/deputado-distrital",
  ])("roda em %s", (rota) => {
    expect(rotaComAtualizacao(rota)).toBe(true);
  });

  it.each([
    "/candidatos",
    "/sobre-o-modelo",
    "/sobre-as-etiquetas",
    "/manutencao",
    "/api/projection",
    "/uf/SP/lista",
    "/uf/SP/deputado-federal/lista",
    "/uf/SPX",
    "/uf",
    "/governadorx",
    "/deputado-distrital",
    "//",
  ])("NÃO roda em %s", (rota) => {
    expect(rotaComAtualizacao(rota)).toBe(false);
  });

  it("pathname nulo (fora do App Router) não roda", () => {
    expect(rotaComAtualizacao(null)).toBe(false);
  });
});

describe("<AtualizacaoAutomatica> — intervalo e jitter", () => {
  it("🔴 chama router.refresh() depois de 60 s + jitter, e de novo no intervalo seguinte", () => {
    montar();
    const espera = ATUALIZACAO_INTERVALO_MS + 0.5 * ATUALIZACAO_JITTER_MS; // 67,5 s

    avancar(espera - 1);
    expect(refresh).not.toHaveBeenCalled();
    avancar(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    avancar(espera);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("jitter 0 → exatamente 60 s; jitter máximo → abaixo de 75 s", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    montar();
    avancar(ATUALIZACAO_INTERVALO_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    avancar(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    avancar(ATUALIZACAO_INTERVALO_MS + ATUALIZACAO_JITTER_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("🔴 sem rede (navigator.onLine false) pula a volta, mantém o dado na tela e retoma quando a rede volta", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    montar();
    avancar(3 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    avancar(ATUALIZACAO_INTERVALO_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("não renderiza nada", () => {
    montar();
    expect(host?.innerHTML).toBe("");
  });

  it("desmontar cancela o timer", () => {
    montar();
    act(() => root?.unmount());
    root = null;
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("<AtualizacaoAutomatica> — visibilidade da aba", () => {
  it("🔴 aba oculta não gera nenhuma atualização", () => {
    montar();
    mudarVisibilidade("hidden");
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("montada com a aba já oculta: nada até ficar visível", () => {
    visibilidade = "hidden";
    montar();
    avancar(5 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("🔴 ao voltar depois de mais de 60 s, atualiza NA HORA e reagenda", () => {
    montar();
    mudarVisibilidade("hidden");
    avancar(90_000);
    expect(refresh).not.toHaveBeenCalled();

    mudarVisibilidade("visible");
    expect(refresh).toHaveBeenCalledTimes(1);

    avancar(ATUALIZACAO_INTERVALO_MS + 0.5 * ATUALIZACAO_JITTER_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ao voltar antes de 60 s, NÃO atualiza na hora — só reagenda", () => {
    montar();
    mudarVisibilidade("hidden");
    avancar(30_000);
    mudarVisibilidade("visible");
    expect(refresh).not.toHaveBeenCalled();

    avancar(ATUALIZACAO_INTERVALO_MS + 0.5 * ATUALIZACAO_JITTER_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("<AtualizacaoAutomatica> — onde e quando não roda", () => {
  it.each([
    "/candidatos",
    "/sobre-o-modelo",
    "/manutencao",
  ])("🔴 fora da lista (%s): nunca atualiza", (rota) => {
    pathnameAtual = rota;
    montar();
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("navegar de rota permitida para não permitida para o timer", () => {
    montar();
    pathnameAtual = "/candidatos";
    // Mesmo componente, re-renderizado: o efeito depende de `pathname`, limpa
    // o timer da rota anterior e não agenda na nova.
    act(() => root?.render(<AtualizacaoAutomatica />));
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("🔴 com saveData (economia de dados) não roda", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    montar();
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saveData false roda normalmente", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: false },
    });
    montar();
    avancar(ATUALIZACAO_INTERVALO_MS + ATUALIZACAO_JITTER_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("<AtualizacaoAutomatica> — pausa", () => {
  it("🔴 pausa gravada antes de montar: nunca atualiza", () => {
    localStorage.setItem(ATUALIZACAO_STORAGE_KEY, "pausada");
    montar();
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("🔴 pausar com a página aberta para o timer; retomar depois de 60 s atualiza na hora", () => {
    montar();
    act(() => gravarPausada(true));
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();

    act(() => gravarPausada(false));
    expect(refresh).toHaveBeenCalledTimes(1);
    avancar(ATUALIZACAO_INTERVALO_MS + 0.5 * ATUALIZACAO_JITTER_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pausa vinda de OUTRA aba (evento storage) também para o timer", () => {
    montar();
    localStorage.setItem(ATUALIZACAO_STORAGE_KEY, "pausada");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ATUALIZACAO_STORAGE_KEY }));
    });
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("localStorage que lança: a pausa vale em memória para a sessão", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(lerPausada()).toBe(false);
    montar();
    act(() => gravarPausada(true));
    expect(lerPausada()).toBe(true);
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("<PausaAtualizacao> — a linha do rodapé (WCAG 2.2.2)", () => {
  function texto(): string {
    return (host?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  it("🔴 o HTML do servidor sai no estado 'atualiza a cada minuto · Pausar'", () => {
    // Mesmo com a pausa gravada: o servidor não conhece o localStorage.
    localStorage.setItem(ATUALIZACAO_STORAGE_KEY, "pausada");
    const html = renderToString(<PausaAtualizacao />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toBe("Esta página se atualiza a cada minuto · Pausar");
    const botao = doc.querySelector("button");
    expect(botao?.getAttribute("type")).toBe("button");
    expect(botao?.getAttribute("aria-label")).toBe("Pausar a atualização automática");
  });

  it("fora das rotas que se atualizam, não aparece", () => {
    pathnameAtual = "/candidatos";
    expect(renderToString(<PausaAtualizacao />)).toBe("");
    pathnameAtual = null;
    expect(renderToString(<PausaAtualizacao />)).toBe("");
  });

  it("🔴 Pausar → 'Atualização pausada · Retomar', grava a chave, e o timer do shell para", () => {
    montar(
      <>
        <AtualizacaoAutomatica />
        <PausaAtualizacao />
      </>,
    );
    expect(texto()).toBe("Esta página se atualiza a cada minuto · Pausar");

    act(() => host?.querySelector("button")?.click());
    expect(texto()).toBe("Atualização pausada · Retomar");
    expect(host?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Retomar a atualização automática",
    );
    expect(localStorage.getItem(ATUALIZACAO_STORAGE_KEY)).toBe("pausada");
    avancar(10 * ATUALIZACAO_INTERVALO_MS);
    expect(refresh).not.toHaveBeenCalled();

    act(() => host?.querySelector("button")?.click());
    expect(texto()).toBe("Esta página se atualiza a cada minuto · Pausar");
    expect(localStorage.getItem(ATUALIZACAO_STORAGE_KEY)).toBeNull();
    // Retomou depois de 10 min parado: atualiza na hora.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("🔴 hidratação com a pausa gravada: sem erro de hidratação, e o texto corrige depois de montar", () => {
    const html = renderToString(<PausaAtualizacao />);
    localStorage.setItem(ATUALIZACAO_STORAGE_KEY, "pausada");
    host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const erros = vi.fn();
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      root = hydrateRoot(host as HTMLDivElement, <PausaAtualizacao />, {
        onRecoverableError: erros,
      });
    });
    expect(erros).not.toHaveBeenCalled();
    expect(consoleErro).not.toHaveBeenCalled();
    expect(texto()).toBe("Atualização pausada · Retomar");
  });

  it("com saveData a linha some (nada se atualiza para pausar)", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    montar(<PausaAtualizacao />);
    expect(texto()).toBe("");
  });
});
