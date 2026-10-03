/**
 * tests/unit/design-system/party-delta-e.test.ts
 *
 * **Este é o gate que impede uma violação constitucional de chegar em produção.**
 *
 * A constituição § 2 (v1.3) exige ΔE76 ≥ 10 entre cada cor de partido do
 * AtlasMenna e o hex oficial documentado daquele partido. O gerador
 * (`scripts/gen-party-scale.ts`) já falha quando isso quebra — mas o gerador só
 * roda quando alguém o roda. Este teste refaz a conta sobre o **CSS commitado**,
 * a cada `pnpm test`, para que a violação não volte por:
 *
 *   - edição manual de `app/tokens-party.css` (o arquivo diz "não edite", o que
 *     não é o mesmo que impedir);
 *   - mudança em `scripts/data/party-official-hexes.json` — quando uma fonte
 *     melhor de hex oficial aparece, é o CSS que passa a violar, e ninguém
 *     rodaria o gerador de novo por causa disso;
 *   - token novo acrescentado à mão sem passar pelo gerador.
 *
 * Por isso a aritmética de cor é **reimplementada aqui**, sem importar
 * `gen-party-scale.ts`: um teste que reusa a função que ele quer verificar não
 * verifica nada. Se as duas implementações divergirem, o teste falha — que é o
 * comportamento desejado.
 *
 * Cross-refs:
 *   - Constituição § 2 v1.3: `docs/constitution.md`
 *   - ADR-0024: `docs/architecture/adrs/0024-paleta-editorial-por-partido.md`
 *   - Gerador: `scripts/gen-party-scale.ts`
 *   - Fonte dos hexes oficiais: `scripts/data/party-official-hexes.json`
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Contrato numérico
// ---------------------------------------------------------------------------

/**
 * Mínimo constitucional. A constituição § 2 v1.3 diz **10**; o repositório
 * opera com **12** (`DELTA_E_FLOOR` no gerador) para ter folga contra revisão
 * de fonte. Este teste cobra os dois, em severidades diferentes:
 *
 *   - abaixo de 10 → violação da constituição, sem discussão;
 *   - entre 10 e 12 → passa na constituição mas queimou a folga, e o gerador
 *     não teria produzido isso: sinal de que o CSS e a tabela-fonte
 *     divergiram.
 */
const CONSTITUTIONAL_FLOOR = 10;
const OPERATIONAL_FLOOR = 12;

// ---------------------------------------------------------------------------
// Colorimetria — reimplementada de propósito (ver docblock)
// ---------------------------------------------------------------------------

/** sRGB (#rrggbb) → CIE Lab, D65 / observador 2°. */
function hexToLab(hex: string): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(Number.parseInt(hex.slice(1, 3), 16));
  const g = lin(Number.parseInt(hex.slice(3, 5), 16));
  const b = lin(Number.parseInt(hex.slice(5, 7), 16));
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** ΔE76 (CIE 1976) — distância euclidiana em Lab. */
function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function lightness(hex: string): number {
  return hexToLab(hex)[0];
}

function chroma(hex: string): number {
  const [, a, b] = hexToLab(hex);
  return Math.hypot(a, b);
}

// ---------------------------------------------------------------------------
// Entradas: o CSS commitado e a tabela de hexes oficiais
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TOKENS_CSS = readFileSync(path.join(ROOT, "app/tokens-party.css"), "utf8");

interface OfficialHex {
  hex: string;
  role: string;
  source_type: string;
  url?: string;
  confidence?: string;
  note?: string;
}

interface OfficialEntry {
  party: string;
  official: OfficialHex[];
  note?: string;
}

const OFFICIAL: Record<string, OfficialEntry> = (() => {
  const raw = JSON.parse(
    readFileSync(path.join(ROOT, "scripts/data/party-official-hexes.json"), "utf8"),
  ) as Record<string, unknown>;
  const out: Record<string, OfficialEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_meta") continue;
    out[k] = v as OfficialEntry;
  }
  return out;
})();

/** `--party-<nome>: #hex;` → Map("<nome>" → "#hex"). */
function parseTokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /--party-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g;
  let m = re.exec(css);
  while (m !== null) {
    if (m[1] && m[2]) map.set(m[1], m[2]);
    m = re.exec(css);
  }
  return map;
}

/**
 * O CSS tem **dois** blocos de token desde o dark mode (ADR-0025 § 5) — o claro
 * em `@theme static { … }` e o escuro em `:root[data-theme="dark"] { … }` — com
 * os mesmos nomes, de propósito. Um parser que varra o arquivo inteiro guarda
 * só o último valor visto, e metade da paleta deixaria de ser medida contra os
 * hexes oficiais: exatamente o silêncio que este arquivo existe para impedir.
 */
function blockOf(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`bloco não encontrado em tokens-party.css: ${opener}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`bloco não fechado em tokens-party.css: ${opener}`);
}

/** Estados de corrida: não são partido, não têm rampa, não têm oficial. */
const STATE_TOKENS = new Set(["tie", "none"]);

const THEMES = [
  {
    id: "claro",
    tokens: parseTokens(blockOf(TOKENS_CSS, "@theme static {")),
    /** No claro a escala DESCE em L*: o "decisivo" é o mais escuro. */
    ascendente: false,
    /**
     * Rampas em que o croma cai antes do nível 4 — a matiz do partido está
     * cercada pela paleta oficial dele e o empurrão de ΔE76 paga em C*. Caso
     * declarado, não regressão silenciosa.
     */
    excecoesCroma: ["dc", "republicanos"],
  },
  {
    id: "escuro",
    tokens: parseTokens(blockOf(TOKENS_CSS, ':root[data-theme="dark"] {')),
    /** No escuro a escala SOBE: o "decisivo" é o mais claro. */
    ascendente: true,
    excecoesCroma: ["mdb"],
  },
] as const;

/** Tokens do tema claro — a paleta que o `--suggest` e a documentação citam. */
const TOKENS = THEMES[0].tokens;

/** Slugs de partido no CSS (base, sem os sufixos `-1..5`/`-chip`/`-ink`/`-text`). */
const PARTY_SLUGS = [
  ...new Set(
    [...TOKENS.keys()]
      .map((n) => n.replace(/-(?:[1-5]|chip|ink|text)$/, ""))
      .filter((s) => !STATE_TOKENS.has(s)),
  ),
].sort();

/**
 * Todo token de um partido que **é uma cor de partido**: o base, o fundo do chip
 * sólido, a tinta de texto e os 5 níveis da rampa.
 *
 * `--party-<slug>-ink` fica de fora de propósito. Ele é uma das duas tintas do
 * tema (#14171b ou #fbfbfc no claro; #14171b ou #eceef1 no escuro), escolhida
 * por contraste WCAG — não é uma cor derivada da identidade do partido, e medir
 * a distância dela até a paleta oficial responderia a uma pergunta que ninguém
 * fez. O gate do par chip/tinta é outro arquivo: `party-chip-contrast.test.ts`.
 *
 * O chip, ao contrário, **entra**: quando ele diverge da base, é uma cor nova de
 * partido, e mover em L* pode empurrar a cor para dentro do raio proibido de um
 * hex oficial exatamente como o empurrão da rampa já podia.
 *
 * `--party-<slug>-text` entra pelo mesmo motivo. No claro, em 14 dos 31
 * partidos ele é uma cor nova: onde a base reprova 4,5:1 sobre o papel (PSOL
 * 2,08:1, PSB 2,20:1, o fallback cinza 2,39:1, NOVO 2,72:1...), a tinta é a
 * base escurecida — e escurecer aproxima do fim do gradiente escuro que vários
 * manuais de partido publicam. No escuro é a base CLAREADA, e clarear aproxima
 * do outro extremo do mesmo gradiente. Ficar de fora deste gate era a forma
 * óbvia de a correção de a11y reintroduzir uma violação do § 2.
 */
function tokensOfIn(tokens: Map<string, string>, slug: string) {
  const out: Array<{ token: string; hex: string }> = [];
  const base = tokens.get(slug);
  if (base) out.push({ token: `--party-${slug}`, hex: base });
  const chip = tokens.get(`${slug}-chip`);
  if (chip) out.push({ token: `--party-${slug}-chip`, hex: chip });
  const text = tokens.get(`${slug}-text`);
  if (text) out.push({ token: `--party-${slug}-text`, hex: text });
  for (const level of [1, 2, 3, 4, 5]) {
    const hex = tokens.get(`${slug}-${level}`);
    if (hex) out.push({ token: `--party-${slug}-${level}`, hex });
  }
  return out;
}

/** Mensagem de erro completa: qual token, contra qual oficial, ΔE e fonte. */
function describeViolation(token: string, hex: string, o: OfficialHex, party: string): string {
  const d = deltaE76(hex, o.hex);
  return [
    `${token} (${hex}) está a ΔE76 ${d.toFixed(2)} de ${o.hex}.`,
    `  partido : ${party}`,
    `  papel   : ${o.role}`,
    `  fonte   : ${o.source_type}${o.confidence ? ` (confiança ${o.confidence})` : ""}`,
    o.url ? `  url     : ${o.url}` : "",
    "",
    "Constituição § 2 v1.3 exige ΔE76 ≥ 10 contra o hex oficial documentado;",
    `este repositório opera com piso ${OPERATIONAL_FLOOR}.`,
    "Corrija o hex base em PARTY_BASE (scripts/gen-party-scale.ts) e rode",
    "`pnpm gen:party-scale` — o gerador reempurra os níveis sozinho, nos dois temas.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Sanidade das entradas
// ---------------------------------------------------------------------------

describe("scripts/data/party-official-hexes.json", () => {
  it("cobre todo partido que tem token no CSS", () => {
    for (const slug of PARTY_SLUGS) {
      expect(
        OFFICIAL[`--party-${slug}`],
        `--party-${slug} tem token mas não tem entrada em party-official-hexes.json — ` +
          "sem entrada, nada é medido contra ele e a violação passa em silêncio.",
      ).toBeDefined();
    }
  });

  it("todo hex oficial é #RRGGBB e tem papel e tipo de fonte declarados", () => {
    for (const [key, entry] of Object.entries(OFFICIAL)) {
      for (const o of entry.official) {
        expect(o.hex, `${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(o.role, `${key} ${o.hex}`).toBeTruthy();
        expect(o.source_type, `${key} ${o.hex}`).toBeTruthy();
      }
    }
  });

  it("partido sem fonte primária é declarado explicitamente, não por omissão", () => {
    // `official: []` é uma afirmação ("procuramos e não achamos" OU "não
    // procuramos"), e por isso exige `note` dizendo qual dos dois foi. Hoje
    // são três: DEMOCRATA (o site usa a paleta padrão do Tailwind, não uma
    // paleta de marca), MOBILIZA (domínios fora do ar) e PTB (busca NÃO
    // tentada em 2026-09-20 — diferente dos outros dois, a note é explícita
    // sobre essa diferença). O validador não reprova por ausência de oficial
    // — não há do que se afastar — mas a dívida fica escrita.
    const semFonte = Object.entries(OFFICIAL).filter(
      ([key, e]) => e.official.length === 0 && !STATE_TOKENS.has(key.replace("--party-", "")),
    );
    for (const [key, e] of semFonte) {
      expect(e.note, `${key} tem official: [] sem note explicando a busca`).toBeTruthy();
    }
    expect(semFonte.map(([k]) => k).sort()).toEqual([
      "--party-democrata",
      "--party-mobiliza",
      "--party-outros",
      "--party-ptb",
    ]);
  });
});

// ---------------------------------------------------------------------------
// O gate
// ---------------------------------------------------------------------------

for (const theme of THEMES) {
  const T = theme.tokens;
  const slugs = [
    ...new Set(
      [...T.keys()]
        .map((n) => n.replace(/-(?:[1-5]|chip|ink|text)$/, ""))
        .filter((s) => !STATE_TOKENS.has(s)),
    ),
  ].sort();

  describe(`[tema ${theme.id}] constituição § 2 — ΔE76 contra o hex oficial de cada partido`, () => {
    it("mede todos os 31 partidos + fallback: base, chip, text e 5 níveis", () => {
      expect(slugs.length).toBe(32);
      for (const slug of slugs) {
        expect(tokensOfIn(T, slug), `--party-${slug}`).toHaveLength(8);
      }
    });

    it.each(
      slugs,
    )("--party-%s: base, chip, text e 5 níveis ficam a ΔE76 ≥ 10 de todo hex oficial", (slug) => {
      const entry = OFFICIAL[`--party-${slug}`];
      const officials = entry?.official ?? [];
      // Sem hex oficial não há do que se afastar. É o caso declarado de
      // DEMOCRATA e MOBILIZA (ver o teste de sanidade acima).
      if (officials.length === 0) return;

      for (const { token, hex } of tokensOfIn(T, slug)) {
        for (const o of officials) {
          const d = deltaE76(hex, o.hex);
          expect(
            d,
            `Tema ${theme.id}.\n${describeViolation(token, hex, o, entry?.party ?? slug)}`,
          ).toBeGreaterThanOrEqual(CONSTITUTIONAL_FLOOR);
        }
      }
    });

    it.each(slugs)("--party-%s: mantém também a folga operacional de 12", (slug) => {
      const entry = OFFICIAL[`--party-${slug}`];
      const officials = entry?.official ?? [];
      if (officials.length === 0) return;

      for (const { token, hex } of tokensOfIn(T, slug)) {
        for (const o of officials) {
          const d = deltaE76(hex, o.hex);
          expect(
            d,
            `Tema ${theme.id}.\n${describeViolation(token, hex, o, entry?.party ?? slug)}\n\n` +
              "Este token passa no mínimo constitucional (10) mas queimou a folga de 12 que o\n" +
              "gerador garante. Ou o CSS foi editado à mão, ou a tabela de hexes oficiais mudou\n" +
              "e o CSS não foi regerado.",
          ).toBeGreaterThanOrEqual(OPERATIONAL_FLOOR);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // A rampa continua sendo uma escala
  // -------------------------------------------------------------------------

  describe(`[tema ${theme.id}] a rampa de margem ordena`, () => {
    // O empurrão de ΔE76 mexe em L* — é o preço de sair do raio proibido sem
    // tocar na matiz. Este teste garante que o preço nunca chega a inverter a
    // escala: se `--party-psol-4` voltar a sair mais claro que `--party-psol-3`
    // no tema claro, "decisivo" aparece mais fraco que "provável" e o mapa
    // mente para o leitor. No escuro a leitura inverte junto com o papel.
    const sentido = theme.ascendente ? "sobe" : "cai";
    it.each(slugs)(`--party-%s: L* ${sentido} estritamente do nível 1 ao 5`, (slug) => {
      const levels = [1, 2, 3, 4, 5].map((n) => T.get(`${slug}-${n}`) as string);
      const Ls = levels.map(lightness);
      for (let i = 1; i < Ls.length; i++) {
        const prev = Ls[i - 1] as number;
        const cur = Ls[i] as number;
        const msg =
          `tema ${theme.id}: --party-${slug}-${i + 1} (${levels[i]}, L* ${cur.toFixed(1)}) ` +
          `não é mais ${theme.ascendente ? "claro" : "escuro"} que --party-${slug}-${i} ` +
          `(${levels[i - 1]}, L* ${prev.toFixed(1)})`;
        if (theme.ascendente) expect(cur, msg).toBeGreaterThan(prev);
        else expect(cur, msg).toBeLessThan(prev);
      }
    });

    it("nenhum nível colapsa contra o vizinho — degraus de pelo menos 5 em L*", () => {
      // Os alvos distam 10–18 unidades; o empurrão de ΔE76 pode encurtar um
      // degrau, mas não a ponto de dois níveis lerem como a mesma cor.
      for (const slug of slugs) {
        const Ls = [1, 2, 3, 4, 5].map((n) => lightness(T.get(`${slug}-${n}`) as string));
        for (let i = 1; i < Ls.length; i++) {
          expect(
            Math.abs((Ls[i - 1] as number) - (Ls[i] as number)),
            `tema ${theme.id}: --party-${slug} níveis ${i} e ${i + 1} a menos de 5 unidades de L*`,
          ).toBeGreaterThan(5);
        }
      }
    });

    it("o nível 5 conserva pelo menos 60% do croma do nível 4", () => {
      // O nível 5 é o "decisivo": a cor mais carregada da escala. O kit recua o
      // croma de propósito (C* 53 sobre 66 = 0,80 no claro; 48 sobre 62 = 0,77
      // no escuro), o que mantém o nível 5 reconhecível como a cor do partido,
      // só mais densa.
      //
      // O empurrão de ΔE76 destruía isso em silêncio: quando um hex oficial
      // fica no caminho, escapar reduzindo o croma é a saída mais barata no
      // custo do solver. `--party-pp` saía com C* 15,0 contra C* 43,8 do nível
      // 4 — razão 0,34, um cinza-ardósia onde deveria estar o azul mais forte
      // do PP — e nada reclamava. Corrigido em 2026-09-08 girando a matiz do
      // hex base (#2c6fb0 → #0f60b3, 272,3° → 280,9°).
      //
      // O piso de 0,60 fica no vão entre 0,34 (o defeito) e 0,71 (o pior caso
      // legítimo, `--party-pl` no claro, limitado pelo gamut do azul).
      for (const slug of slugs) {
        if (slug === "outros") continue; // acromático por construção: C* = 0.
        const c4 = chroma(T.get(`${slug}-4`) as string);
        const c5 = chroma(T.get(`${slug}-5`) as string);
        expect(
          c5 / c4,
          `tema ${theme.id}: --party-${slug}-5 (${T.get(`${slug}-5`)}) tem C* ${c5.toFixed(1)} ` +
            `contra C* ${c4.toFixed(1)} do nível 4 — o "decisivo" perdeu a cor do partido e lê\n` +
            "como cinza. A matiz do hex base está cercada pelos hexes oficiais do partido:\n" +
            "gire-a em PARTY_BASE (`pnpm gen:party-scale --suggest` procura a rotação mínima).",
        ).toBeGreaterThanOrEqual(0.6);
      }
    });

    it("o croma sobe até o nível 4 (com as exceções que o ΔE76 impõe)", () => {
      // Formato do kit: C* cresce do nível 1 ao 4 e recua no 5. Onde o empurrão
      // de ΔE76 desfaz isso, é porque a matiz do partido está cercada pela
      // paleta oficial dele — caso declarado, não regressão silenciosa.
      const invertidos: string[] = [];
      for (const slug of slugs) {
        if (slug === "outros") continue; // acromático por construção
        const Cs = [1, 2, 3, 4].map((n) => chroma(T.get(`${slug}-${n}`) as string));
        for (let i = 1; i < Cs.length; i++) {
          // 0,6 absorve o ruído do arredondamento 8-bit.
          if ((Cs[i] as number) < (Cs[i - 1] as number) - 0.6) invertidos.push(slug);
        }
      }
      expect([...new Set(invertidos)].sort(), `tema ${theme.id}`).toEqual(
        [...theme.excecoesCroma].sort(),
      );
    });
  });
}
