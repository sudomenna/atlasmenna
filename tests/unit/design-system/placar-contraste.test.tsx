// @vitest-environment happy-dom
/**
 * tests/unit/design-system/placar-contraste.test.tsx
 *
 * **O gate do maior número da home.**
 *
 * ## Por que este arquivo nasce em 2026-09-20
 *
 * `<CandidateBar>` pintava o número `text-3xl` do placar presidencial com
 * `corResolvida` — a **cor-base** do partido, a mesma variável que preenche a
 * barra logo abaixo. Medido contra `--surface-page`: **PSOL 2,08:1**, contra o
 * piso de 4,5:1 do RNF-022. O maior número da porta de entrada do site, abaixo
 * de metade do piso que o projeto adotou para si.
 *
 * É o **terceiro** membro da mesma família em quatro dias, e nenhum dos dois
 * anteriores tinha teste antes de doer:
 *
 * | data | superfície | achado por |
 * |---|---|---|
 * | 07/09 | número do placar, paleta `--color-cand-*` | axe |
 * | 20/09 | coluna "Margem" da `<MunicipioTable>` | portão da spec 016 (`eb3170e`) |
 * | 20/09 | número do placar, paleta `--party-*` | este arquivo |
 *
 * O de 19/09 sobreviveu a uma reescrita inteira do arquivo sem que nada
 * reprovasse. **Um defeito que atravessa uma reescrita é um defeito que
 * ninguém está medindo** — e é por isso que este gate mede o DOM renderizado,
 * não a função chamada.
 *
 * ## As duas tintas
 *
 * O átomo pinta duas superfícies de natureza oposta com a mesma identidade, e
 * o teste guarda as DUAS direções:
 *
 * | superfície | piso | tem de usar | mutação que o mata |
 * |---|---|---|---|
 * | número `text-3xl` | 4,5:1 (RNF-022) | `--color-pct-proj` (desde 2026-10-04 — é o projetado; 03/10 `--color-pct-votos`; antes `--party-<slug>-text`) | voltar para a cor-base |
 * | preenchimento da barra | 3:1 (RNF-035) | `--party-<slug>` (base) | escurecer junto com o número |
 *
 * A segunda linha não é zelo decorativo: o remédio óbvio — "troca tudo por
 * `textForParty`" — apaga a cor viva da barra, que é o elemento com extensão
 * onde a identidade do partido tem de viver (`_candidateColor.ts`, 18/09).
 *
 * ## Contra QUE fundo
 *
 * 🔴 A superfície é metade da medida. `--surface-page` (`#f3f4f6`) é o fundo
 * real: `<Panel>` declara só `border-top` e `padding-top`, a home não declara
 * fundo em ancestral nenhum, e quem decide é `body { background:
 * var(--surface-page) }` (`app/globals.css:570`). Os mesmos tokens medem
 * ~4,15:1 sobre `--surface-sunken` e reprovariam ali — medir contra o fundo
 * errado inverte o veredito, e é uma das mutações registradas abaixo.
 *
 * ## Colorimetria reimplementada de propósito
 *
 * Mesma razão de `party-text-contrast.test.ts` e `municipio-contraste.test.tsx`:
 * um teste que importa a função do gerador verifica a si mesmo, não o gerador.
 *
 * Cross-refs:
 *   - Constituição § 4 · RNF-022 (texto, 4,5:1) · RNF-035 (não-texto, 3:1)
 *   - ADR-0024 (identidade vem da SIGLA, nunca da colocação)
 *   - `components/blocks/_candidateColor.ts` (texto escurece · preenchimento contorna)
 *   - `tests/unit/design-system/municipio-contraste.test.tsx` (o irmão, spec 016)
 *   - `docs/reference/dividas-tecnicas.md` § 1 (a dívida que este arquivo fecha)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CandidateBar } from "@/components/atoms/bars/CandidateBar";

const RAIZ = process.cwd();

/** Constituição § 4 / RNF-022 — texto. */
const PISO_TEXTO = 4.5;

// ---------------------------------------------------------------------------
// Colorimetria WCAG 2.1 — reimplementada (ver docblock)
// ---------------------------------------------------------------------------

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// Entrada: o CSS commitado
// ---------------------------------------------------------------------------

const TOKENS_CSS = readFileSync(resolve(RAIZ, "app/tokens-party.css"), "utf8");
const GLOBALS_CSS = readFileSync(resolve(RAIZ, "app/globals.css"), "utf8");

/**
 * 🔴 O bloco claro é `@theme static {`, **não `:root`** — o único `:root` de
 * `tokens-party.css` é o `[data-theme="dark"]`. Quem procura `:root` mede a
 * paleta escura contra o papel claro e obtém tudo reprovado.
 */
function bloco(css: string, abertura: string): string {
  const inicio = css.indexOf(abertura);
  if (inicio === -1) throw new Error(`bloco não encontrado: ${abertura}`);
  let nivel = 0;
  for (let i = css.indexOf("{", inicio); i < css.length; i++) {
    if (css[i] === "{") nivel++;
    if (css[i] === "}") {
      nivel--;
      if (nivel === 0) return css.slice(inicio, i + 1);
    }
  }
  throw new Error(`bloco não fechado: ${abertura}`);
}

function tokensDeParty(escopo: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /--party-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g;
  let x = re.exec(escopo);
  while (x !== null) {
    if (x[1] && x[2]) m.set(x[1], x[2].toLowerCase());
    x = re.exec(escopo);
  }
  return m;
}

function primitivo(escopo: string, nome: string): string {
  const m = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(escopo);
  if (!m?.[1]) throw new Error(`primitivo --${nome} não encontrado`);
  return m[1].toLowerCase();
}

const GLOBALS_ESCURO = GLOBALS_CSS.split(':root[data-theme="dark"] {')[1] ?? "";

const TEMAS = [
  {
    id: "claro",
    party: tokensDeParty(bloco(TOKENS_CSS, "@theme static {")),
    // `--surface-page` é declarado uma vez (`var(--paper-1)`) e muda de valor
    // porque o PRIMITIVO muda no bloco escuro — então é o primitivo que se lê.
    paginaHex: primitivo(GLOBALS_CSS, "paper-1"),
    tintaHex: primitivo(GLOBALS_CSS, "ink-0"),
    projHex: primitivo(GLOBALS_CSS, "accent-text"),
  },
  {
    id: "escuro",
    party: tokensDeParty(bloco(TOKENS_CSS, ':root[data-theme="dark"] {')),
    paginaHex: primitivo(GLOBALS_ESCURO, "paper-1"),
    tintaHex: primitivo(GLOBALS_ESCURO, "ink-0"),
    projHex: primitivo(GLOBALS_ESCURO, "accent-text"),
  },
] as const;

/** `var(--party-pt-text)` → `#c62e49`, no tema pedido. */
function hexDoToken(valorCss: string, tema: (typeof TEMAS)[number]): string {
  const m = /^var\(--party-([a-z0-9-]+)\)$/.exec(valorCss.trim());
  if (!m?.[1]) throw new Error(`não é token de partido: ${valorCss}`);
  const hex = tema.party.get(m[1]);
  if (!hex) throw new Error(`--party-${m[1]} não existe no tema ${tema.id}`);
  return hex;
}

/**
 * A cor da PROJEÇÃO (decisão do dono, 2026-10-04: "sempre que exibir
 * percentual projetado a cor deve ser a cor padrão para projeção"). O número
 * do placar é o `pctProjetado` — sai nela, igual para toda sigla.
 */
const COR_PCT_PROJ = "var(--color-pct-proj)";

/**
 * `var(--color-pct-proj)` → hex, no tema pedido. Segue a cadeia COMMITADA em
 * `app/globals.css` (`--color-pct-proj` → `--accent-text`) em vez de supô-la:
 * se alguém repontar o token, isto lança e o gate reprova.
 */
function hexDoNumero(valorCss: string, tema: (typeof TEMAS)[number]): string {
  if (valorCss.trim() !== COR_PCT_PROJ) return hexDoToken(valorCss, tema);
  // A cadeia COMMITADA: `--color-pct-proj` → `--accent-text` (redefinido no
  // tema escuro). Se alguém repontar o token, isto reprova.
  expect(GLOBALS_CSS).toMatch(/--color-pct-proj:\s*var\(--accent-text\)\s*;/);
  return tema.projHex;
}

// ---------------------------------------------------------------------------
// Render → as duas tintas que saíram no DOM
// ---------------------------------------------------------------------------

function pinturas(partido: string, props: Record<string, unknown> = {}) {
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(
      <CandidateBar nome="Fulano" partido={partido} pctProjetado={41.7} {...props} />,
    ),
    "text/html",
  );
  const numero = doc.querySelector(".text-3xl");
  const fill = doc.querySelector('[role="meter"] > div');
  if (!numero || !fill) throw new Error(`render sem número ou sem barra (${partido})`);

  const corTexto = /color:\s*([^;"]+)/.exec(numero.getAttribute("style") ?? "")?.[1];
  const corFill = /background-color:\s*([^;"]+)/.exec(fill.getAttribute("style") ?? "")?.[1];
  if (!corTexto || !corFill) throw new Error(`estilo sem cor (${partido})`);

  // O número renderizado tem de ser o do componente, não um placeholder — se
  // o seletor pegar a caixa errada, isto acusa.
  expect(numero.textContent).toContain("41,7%");
  return { corTexto, corFill };
}

/**
 * Os quatro piores casos medidos + as duas formas de FEDERAÇÃO + sigla
 * ausente + sigla desconhecida.
 *
 * 🔴 Federação é o caso mais provável fora do Presidente e era o segundo pior:
 * `normalizePartySlug` manda as duas formas para `outros`, e nem
 * "PSDB/CIDADANIA" nem "FEDERACAO BRASIL DA ESPERANCA" estão em
 * `KNOWN_PARTY_SLUGS`. Um teste que só passeasse por PT e PL ficaria verde com
 * o defeito inteiro no lugar — PT e PL são dois dos 17 slugs em que a variante
 * `-text` **É** a cor-base, e portanto os dois em que a mutação é invisível.
 */
const SIGLAS_CRITICAS = [
  "PSOL",
  "PSB",
  "NOVO",
  "PSDB/CIDADANIA",
  "FEDERACAO BRASIL DA ESPERANCA",
  "",
  "PARTIDO QUE NAO EXISTE",
] as const;

/** Todas as siglas com token no CSS — o gate vale para a paleta inteira. */
const SLUGS_BASE = [...TEMAS[0].party.keys()].filter((k) => !k.includes("-")).sort();

describe("o número do placar (<CandidateBar>) é TEXTO e respeita o piso de 4,5:1", () => {
  it("🔴 a paleta inteira passa o piso, nos dois temas, sobre o papel da página", () => {
    expect(SLUGS_BASE.length).toBeGreaterThanOrEqual(30);

    const reprovados: string[] = [];
    for (const tema of TEMAS) {
      for (const slug of SLUGS_BASE) {
        const { corTexto } = pinturas(slug.toUpperCase());
        const razao = contraste(hexDoNumero(corTexto, tema), tema.paginaHex);
        if (razao < PISO_TEXTO) {
          reprovados.push(`${tema.id}/${slug}: ${razao.toFixed(3)}`);
        }
      }
    }
    expect(reprovados).toEqual([]);
  });

  it("🔴 os piores casos medidos — PSOL, federação e sigla ausente — passam", () => {
    for (const tema of TEMAS) {
      for (const sigla of SIGLAS_CRITICAS) {
        const { corTexto } = pinturas(sigla);
        const razao = contraste(hexDoNumero(corTexto, tema), tema.paginaHex);
        expect(
          razao,
          `${tema.id} · "${sigla}" mede ${razao.toFixed(3)}:1 contra ${tema.paginaHex}`,
        ).toBeGreaterThanOrEqual(PISO_TEXTO);
      }
    }
  });

  // O caso que DISCRIMINA contra a regressão exata de 2026-09-20: o PSOL é o
  // pior da paleta, e é justamente onde a cor-base (2,08:1) reprova. Desde
  // 2026-10-03 (decisão do dono) o número nem leva mais a cor do partido; desde
  // 2026-10-04 sai na cor da projeção `--color-pct-proj`, a mesma para todas.
  it("🔴 o número usa a cor da projeção `--color-pct-proj`, não a cor-base (PSOL: 2,08:1)", () => {
    const { corTexto, corFill } = pinturas("PSOL");
    expect(corTexto).toBe(COR_PCT_PROJ);
    expect(corFill).toBe("var(--party-psol)");

    const claro = TEMAS[0];
    expect(contraste(hexDoToken(corFill, claro), claro.paginaHex)).toBeLessThan(PISO_TEXTO);
    expect(contraste(hexDoNumero(corTexto, claro), claro.paginaHex)).toBeGreaterThanOrEqual(
      PISO_TEXTO,
    );
  });

  it("🔴 dois partidos diferentes ⇒ o MESMO número: a cor não varia por sigla", () => {
    const tintas = ["PT", "PL", "PSOL", "NOVO", "PSDB/CIDADANIA", ""].map(
      (sigla) => pinturas(sigla).corTexto,
    );
    expect(new Set(tintas)).toEqual(new Set([COR_PCT_PROJ]));
  });

  // A OUTRA direção. O remédio errado — "troca tudo por `textForParty`" —
  // passaria em tudo acima e apagaria a cor viva da barra, que é preenchimento
  // COM extensão e por isso escurece em nada (RNF-035: o remédio dela é
  // contorno, não tinta).
  it("🔴 a BARRA não escureceu junto — ela continua na cor-base", () => {
    for (const sigla of ["PSOL", "PSB", "NOVO", "PT", "PL"]) {
      const { corFill } = pinturas(sigla);
      expect(corFill, `barra de ${sigla}`).not.toContain("-text)");
    }
  });

  // `cor` é a prop de PREENCHIMENTO. Um caller que a passe — e o único caller
  // real, `<HeadlineScore>`, passa — não pode arrastar o número junto. Era
  // exatamente assim que o defeito vivia em produção.
  it("🔴 passar `cor` move a barra e NÃO move o número", () => {
    const semCor = pinturas("PSOL");
    const comCor = pinturas("PSOL", { cor: "var(--party-pt)" });

    expect(comCor.corFill).toBe("var(--party-pt)");
    expect(comCor.corTexto).toBe(semCor.corTexto);
    expect(comCor.corTexto).toBe(COR_PCT_PROJ);
  });

  // ADR-0024 pelo eixo do contraste: a colocação não escolhe tinta nenhuma.
  it("a MESMA sigla em posições diferentes recebe a MESMA tinta de número", () => {
    const tintas = [1, 2, 3, 9, undefined].map((rank) => pinturas("PSOL", { rank }).corTexto);
    expect(new Set(tintas).size).toBe(1);
    expect(tintas[0]).not.toContain("--color-cand-");
  });
});
