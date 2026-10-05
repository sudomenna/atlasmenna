// @vitest-environment happy-dom
/**
 * tests/unit/components/ShellLiveBadge.test.tsx — RF-159 (spec 019).
 *
 * **M11** — o leitor de tela em fase pré **não** ouve "Apuração ao vivo", e a
 * frase alternativa **está** no DOM.
 *
 * ## Por que este teste monta a cascata inteira
 *
 * A mutação que ele existe para matar é "trocar o texto acessível por `content`
 * de CSS", que *parece* funcionar no inspetor e não funciona no leitor. Um
 * teste que só olhasse o texto visível não a pegaria. Então aqui o caminho é
 * percorrido de ponta a ponta, com os artefatos reais:
 *
 *   1. a **página** renderiza e publica uma regra `:root { … }` (ADR-0029 § 4);
 *   2. o **CSS module real** de `ShellLiveBadge` é lido do disco;
 *   3. os dois são injetados no documento, junto com o markup real do selo;
 *   4. `getComputedStyle` diz qual das duas frases sobrou na árvore de
 *      acessibilidade — `display: none` é a única remoção que os dois leitores
 *      de tela respeitam.
 *
 * Se o texto acessível voltar a sair de `content`, o passo 1 perde o span e o
 * passo 4 não tem o que medir: o teste cai.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { payloadNormalApurando, payloadPreEleicao } from "@/tests/fixtures/spec-019/payloads";

const readNationalProjectionMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: vi.fn(async () => null),
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  readDeputadoProjection: vi.fn(async () => null),
}));

vi.mock("@/lib/blob/candidatos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/candidatos")>();
  return {
    ...real,
    readCandidatosUf: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "not_configured" as const,
      url: null,
    })),
  };
});

import HomePage from "@/app/(pres)/page";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { ShellLiveBadge } from "@/components/layout/ShellLiveBadge";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import type { EdgePayload } from "@/lib/edge-config/types";

/**
 * Em `happy-dom` o `import.meta.url` do vitest vem servido como `/@fs/…`; o
 * prefixo é do servidor de módulos, não do disco.
 */
const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/^\/@fs/, "");

const CSS_DO_SELO = readFileSync(join(RAIZ, "components/layout/ShellLiveBadge.module.css"), "utf8");

const MARKUP_DO_SELO = renderToStaticMarkup(<ShellLiveBadge />);

/**
 * As regras `:root { … }` que uma página publica.
 *
 * Sai do `<main>` renderizado, e não de uma constante copiada daqui: o que
 * este teste quer saber é o que a PÁGINA diz ao shell.
 */
async function declaracoesDaHome(payload: EdgePayload | null): Promise<string> {
  readNationalProjectionMock.mockResolvedValue(payload);
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(await HomePage()), "text/html");
  return [...(doc.querySelector("main")?.querySelectorAll("style") ?? [])]
    .map((s) => s.textContent ?? "")
    .join("\n");
}

/**
 * Monta o documento com a cascata real e devolve o que o leitor de tela veria.
 *
 * O CSS module é reescrito para os nomes de classe com hash que o bundler de
 * teste gerou — a correspondência sai do próprio markup, então uma renomeação
 * de classe no componente ou no CSS quebra o casamento em vez de passar
 * silenciosamente.
 */
function resolverSelo(declaracoesDaPagina: string, cssGlobalExtra = "") {
  const escopo = new Map<string, string>();
  for (const cls of MARKUP_DO_SELO.matchAll(/class="([^"]+)"/g)) {
    for (const nome of (cls[1] ?? "").split(/\s+/)) {
      const m = /^_(\w+?)_[a-z0-9]+$/.exec(nome);
      if (m?.[1]) escopo.set(m[1], nome);
    }
  }
  // Anti-vácuo: se o casamento falhar, todo `display` viria do default do
  // navegador e as asserções abaixo mediriam nada.
  expect([...escopo.keys()].sort()).toEqual([
    "badge",
    "dot",
    "label",
    "srAoVivo",
    "srFinal",
    "srPre",
  ]);

  const cssEscopado = CSS_DO_SELO.replace(
    /(^|[\s,>+~{])\.([A-Za-z_][\w-]*)/g,
    (inteiro, antes: string, nome: string) =>
      escopo.has(nome) ? `${antes}.${escopo.get(nome)}` : inteiro,
  );

  document.head.innerHTML = `<style>${cssEscopado}</style><style>${declaracoesDaPagina}</style><style>${cssGlobalExtra}</style>`;
  document.body.innerHTML = MARKUP_DO_SELO;

  const q = (testid: string) =>
    document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  const badge = q("shell-live-badge");
  const pre = q("shell-live-badge-sr-pre");
  const aoVivo = q("shell-live-badge-sr-ao-vivo");
  const dot = q("shell-live-badge-dot");
  const final = q("shell-live-badge-sr-final");
  expect(badge && pre && aoVivo && dot && final).toBeTruthy();

  const visivel = (el: HTMLElement | null) =>
    el !== null && getComputedStyle(el).display !== "none";

  return {
    seloNaTela: visivel(badge),
    /** O que o leitor de tela ouve — só o que não está em `display: none`. */
    textoAcessivel: [pre, aoVivo, final]
      .filter(visivel)
      .map((el) => (el as HTMLElement).textContent ?? "")
      .join(" | "),
    pontoAnimado: getComputedStyle(dot as HTMLElement).animationPlayState === "running",
    rotuloVisivel: declaracoesDaPagina,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("RF-159 — o selo do shell", () => {
  it("as DUAS frases acessíveis moram no DOM (nunca `content` de CSS)", () => {
    const doc = new DOMParser().parseFromString(MARKUP_DO_SELO, "text/html");
    const pre = doc.querySelector('[data-testid="shell-live-badge-sr-pre"]');
    const aoVivo = doc.querySelector('[data-testid="shell-live-badge-sr-ao-vivo"]');
    expect(pre).not.toBeNull();
    expect(aoVivo).not.toBeNull();
    expect(pre?.textContent ?? "").toContain("ainda não começou");
    expect(aoVivo?.textContent ?? "").toBe("Apuração ao vivo");
    // `sr-only` nas duas: `sr-only` sozinho **não** remove da árvore de
    // acessibilidade — quem remove é o `display: none` da custom property.
    expect(pre?.className).toContain("sr-only");
    expect(aoVivo?.className).toContain("sr-only");
  });

  it("todo default do CSS é silêncio — uma rota que não publica nada não afirma nada", () => {
    const r = resolverSelo("");
    expect(r.seloNaTela).toBe(false);
    expect(r.textoAcessivel).toBe("");
    expect(r.pontoAnimado).toBe(false);
    // É o caso de `/candidatos`, `/sobre-o-modelo` e `/status`, que nunca
    // foram ao vivo em dia nenhum do calendário. O fallback do `var()` era a
    // afirmação, e a afirmação era falsa; sem comentários, a string sumiu.
    const semComentarios = CSS_DO_SELO.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios.toLowerCase()).not.toContain("ao vivo");
    expect(semComentarios).toContain('content: var(--live-pct-label, "")');
  });

  it("🔴 (M11) em fase pré o leitor de tela NÃO ouve `Apuração ao vivo`", async () => {
    const r = resolverSelo(await declaracoesDaHome(payloadPreEleicao()));
    expect(r.seloNaTela).toBe(true);
    expect(r.textoAcessivel).toContain("ainda não começou");
    expect(r.textoAcessivel).not.toContain("Apuração ao vivo");
    expect(r.textoAcessivel).not.toContain("ao vivo");
    expect(r.pontoAnimado).toBe(false);
  });

  it("(par de modo normal) com percentual publicado o selo volta a afirmar liveness", async () => {
    const r = resolverSelo(await declaracoesDaHome(payloadNormalApurando()));
    expect(r.seloNaTela).toBe(true);
    expect(r.textoAcessivel).toBe("Apuração ao vivo");
    expect(r.textoAcessivel).not.toContain("ainda não começou");
    expect(r.pontoAnimado).toBe(true);
    expect(r.rotuloVisivel).toContain("--live-pct-label");
    expect(r.rotuloVisivel).toContain("apurado");
  });

  it("o rótulo VISÍVEL em fase pré não contém `AO VIVO` nem percentual", async () => {
    const publicado = await declaracoesDaHome(payloadPreEleicao());
    expect(publicado.toLowerCase()).not.toContain("ao vivo");
    expect(publicado).toContain('--live-pct-label:"antes da votação"');
    expect(publicado).not.toMatch(/--live-pct-label:"[^"]*\d/);
    // E não publica as duas propriedades que afirmariam liveness.
    expect(publicado).not.toContain("--live-sr-ao-vivo");
    expect(publicado).not.toContain("--live-dot-state");
  });

  /**
   * ⚠️ **Emenda de 2026-09-14.** Este `it` era um só — "publica exatamente
   * quatro propriedades" — e virou dois porque o componente passou a ter duas
   * variantes. Um teste só, na variante default, passaria com a variante
   * `"sem_dados"` publicando as quatro, que é precisamente a regressão.
   */
  const propriedadesDe = (markup: string) =>
    [...markup.matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1]).sort();

  it("`SeloFasePreStyle` default (`nao_comecou`) publica as quatro, e nenhuma afirma apuração", () => {
    const markup = renderToStaticMarkup(<SeloFasePreStyle />);
    expect(propriedadesDe(markup)).toEqual([
      "live-badge-display",
      "live-pct-label",
      "live-sr-pre",
      "shell-viewmode-display",
    ]);
    // RF-161: o segmentado "Parcial / Projeção" do shell é apagado por aqui.
    expect(markup).toContain("--shell-viewmode-display:none");
  });

  it('🔴 `variante="sem_dados"` publica UMA só — o selo não afirma causa nenhuma', () => {
    const markup = renderToStaticMarkup(<SeloFasePreStyle variante="sem_dados" />);
    expect(propriedadesDe(markup)).toEqual(["shell-viewmode-display"]);
    expect(markup).toContain("--shell-viewmode-display:none");
    // As três do selo ficam de fora, e é essa ausência que é a afirmação que
    // um ramo de espera escolhe NÃO fazer.
    expect(markup).not.toContain("--live-badge-display");
    expect(markup).not.toContain("--live-pct-label");
    expect(markup).not.toContain("--live-sr-pre");
  });

  it("🔴 (cascata real) em `sem_dados` o leitor de tela não ouve NENHUMA das duas frases", () => {
    // Não basta o markup: o que importa é o que sobra na árvore de
    // acessibilidade depois do CSS module real. O par positivo deste teste é o
    // M11 acima, em que a mesma cascata deixa "ainda não começou" audível.
    // O texto DENTRO do `<style>`: `resolverSelo` recebe declarações, não
    // markup — um `<style>` aninhado em outro vira texto e não vira cascata,
    // e o teste passaria medindo nada.
    const markup = renderToStaticMarkup(<SeloFasePreStyle variante="sem_dados" />);
    const declaracoes = new DOMParser()
      .parseFromString(markup, "text/html")
      .querySelector("style")?.textContent;
    expect(declaracoes).toContain("--shell-viewmode-display");
    const r = resolverSelo(declaracoes ?? "");
    expect(r.seloNaTela).toBe(false);
    expect(r.textoAcessivel).toBe("");
    expect(r.pontoAnimado).toBe(false);
  });

  /**
   * 1º turno encerrado (05/10/2026): `app/layout.tsx` escreve
   * `data-encerrado="1t"` no `<html>`, e as regras `:root[data-encerrado]` de
   * `app/globals.css` vencem o `:root{…}` que a página publica — o selo diz
   * "Resultado final", o ponto para e o leitor de tela ouve a frase final, não
   * "Apuração ao vivo". Lidas do arquivo real, nunca copiadas aqui.
   */
  it("🔴 (1º turno encerrado) a página publica liveness, mas o selo diz resultado final", async () => {
    const globais = readFileSync(join(RAIZ, "app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const regras = [...globais.matchAll(/:root\[data-encerrado\][^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(regras.length).toBeGreaterThan(0);
    document.documentElement.setAttribute("data-encerrado", "1t");
    try {
      const r = resolverSelo(await declaracoesDaHome(payloadNormalApurando()), regras.join("\n"));
      expect(r.seloNaTela).toBe(true);
      expect(r.textoAcessivel).toBe("Resultado final do 1º turno");
      expect(r.pontoAnimado).toBe(false);
    } finally {
      document.documentElement.removeAttribute("data-encerrado");
    }
  });

  it("🔴 (1º turno encerrado) a home do Presidente fala em resultado final, sem projeção nem a nota do atraso", async () => {
    readNationalProjectionMock.mockResolvedValue(payloadNormalApurando());
    const aoVivo = renderToStaticMarkup(await HomePage());
    // Par: ao vivo o kicker e a nota de 04/10 estão lá.
    expect(aoVivo).toContain("Projeção Atlas Menna · não oficial");
    expect(aoVivo).toContain("às vezes atualiza com atraso");

    vi.mocked(primeiroTurnoEncerrado).mockReturnValue(true);
    try {
      const final = renderToStaticMarkup(await HomePage());
      expect(final).toContain("Resultado final · 1º turno");
      expect(final).toContain("Resultado final");
      expect(final).not.toContain("Projeção Atlas Menna · não oficial");
      expect(final).not.toContain("às vezes atualiza com atraso");
      expect(final).not.toContain("Resultado parcial");
    } finally {
      vi.mocked(primeiroTurnoEncerrado).mockReturnValue(false);
    }
  });
});
