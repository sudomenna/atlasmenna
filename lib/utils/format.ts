/**
 * lib/utils/format.ts
 *
 * Helpers determinísticos de formatação para a UI (specs 003 e 004).
 *
 * Princípios
 *   - Locale fixo `pt-BR` em todos os Intl.Format — output estável entre
 *     SSR (servidor em UTC) e cliente (qualquer fuso). Sem isso, o React
 *     dispara hydration mismatch (mensagem "Text content did not match").
 *   - `tabular-nums` está globalmente em `globals.css` (`* { ... }`),
 *     mas os números aqui devem ser legíveis também sem CSS — daí
 *     `style: 'decimal'`/`grouping` separator pt-BR (ponto).
 *   - Determinismo (constituição § 6): mesma entrada → mesma saída. Sem
 *     `Date.now()`, sem aleatoriedade.
 *
 * Cobertura: RF-022 (votos absolutos), RF-023 (% + CI), RF-026 (timestamp).
 */

/** TZ canônico do projeto. America/Sao_Paulo == UTC-3 sem horário de verão. */
export const TZ = "America/Sao_Paulo";
const LOCALE = "pt-BR";

/**
 * `Intl.NumberFormat` em cache de módulo, uma instância por combinação de
 * casas decimais.
 *
 * `Number.prototype.toLocaleString(locale, opções)` é, pela ECMA-402,
 * exatamente `new Intl.NumberFormat(locale, opções).format(x)` — só que
 * construindo o formatador (resolução de locale, dados de CLDR) a CADA
 * chamada. Na página de UF de Deputado de SP são ~2.000 chamadas na
 * hidratação (votos e % de ~1.000 linhas), medidas em ~83 ms de CPU com
 * lentidão 4× (auditoria G6 da spec 026, 30/09). Mesmo algoritmo, mesmo
 * texto: a saída é idêntica byte a byte (`tests/unit/lib/format.test.ts`).
 */
const FORMATADORES = new Map<string, Intl.NumberFormat>();

function formatador(minimo: number | undefined, maximo: number | undefined): Intl.NumberFormat {
  const chave = `${minimo ?? ""}:${maximo ?? ""}`;
  let f = FORMATADORES.get(chave);
  if (!f) {
    const opcoes: Intl.NumberFormatOptions = {};
    if (minimo !== undefined) opcoes.minimumFractionDigits = minimo;
    if (maximo !== undefined) opcoes.maximumFractionDigits = maximo;
    f = new Intl.NumberFormat(LOCALE, opcoes);
    FORMATADORES.set(chave, f);
  }
  return f;
}

/**
 * Formata um percentual em 0–100 com 1 casa decimal por default.
 * `decimals` permite forçar 0 para headers grandes (ex. "53%").
 *
 * Edge cases:
 *   - NaN  → "—" (em-dash, padrão NYT)
 *   - <0   → "0%"
 *   - >100 → "100%"
 */
export function formatPercent(value: number, decimals = 1): string {
  if (Number.isNaN(value)) return "—";
  const clamped = Math.max(0, Math.min(100, value));
  const rounded = Number(clamped.toFixed(decimals));
  return decimals === 0
    ? `${Math.round(rounded)}%`
    : `${formatador(decimals, decimals).format(rounded)}%`;
}

/**
 * O mesmo percentual de {@link formatPercent}, **sem o `,0` quando o número é
 * redondo**: `13` → `"13%"`, `17,5` → `"17,5%"`, `54,47` → `"54,5%"`.
 *
 * ## Por que existe uma segunda função de percentual
 *
 * Não é preferência estética — é orçamento de pixel. A coluna "Apurado" da
 * `<MunicipioTable>` tem **40px de conteúdo** (`COL_APURADO_PX` menos o
 * padding), e a maioria esmagadora dos municípios numa noite de apuração
 * exibe um percentual redondo. Com `formatPercent` todos eles ganhariam dois
 * caracteres de `,0` que não dizem nada, e a coluna passaria a ser
 * dimensionada pelo enfeite. Mesma lógica nos rótulos de `<CandidateRow>`,
 * `<GovernorCard>` e `<MunicipioWaffleGrid>`, que dividem espaço com o nome
 * do candidato ou do município.
 *
 * ## 🔴 O arredondamento é `Math.round`, e continua sendo de propósito
 *
 * O valor é arredondado **antes** de chegar ao `Intl`, com exatamente a conta
 * que as cinco cópias inline usavam até 2026-09-20
 * (`Math.round(v * 10) / 10`). Isto é conteúdo eleitoral: o recorte daquela
 * mudança era a **pontuação**, não o número, e a linha explícita é o que
 * prova que o número não se mexeu.
 *
 * Medido em 2026-09-20, e o resultado é honesto sobre o que a linha vale:
 * varrendo 0–100 em passos de 0,0001 (1.000.001 valores), `Math.round` antes
 * do `Intl` e o `Intl` sozinho (`maximumFractionDigits: 1`) dão **o mesmo
 * texto em todos**. Ou seja, hoje ela é redundante — e fica assim mesmo,
 * porque o custo dela é zero e o que ela compra é que o `roundingMode` do
 * `Intl` (default `halfExpand`, mas configurável) deixe de ser a única coisa
 * entre um valor do TSE e o algarismo na tela.
 *
 * ## 🔴 Por que `Intl` e não `.toFixed(1).replace(".", ",")`
 *
 * Duas razões, e a segunda é a grave.
 *
 *   1. `replace` troca o separador decimal e **esquece o de milhar**:
 *      `1234,5` sairia `"1234,5%"` em vez de `"1.234,5%"`.
 *   2. **`toFixed` arredonda para BAIXO onde este código arredonda para
 *      cima.** `toFixed` trabalha sobre o double, e o double mais próximo de
 *      0,15 é 0,1499999999999999944 — então `(0,15).toFixed(1)` é `"0.1"`,
 *      contra `"0,2"` aqui. Na mesma varredura de 0–100 em passos de 0,0001
 *      isso acontece em **400 valores** (0,15 · 0,35 · 0,85 · 0,95 · 1,15 …).
 *      Cada um deles é um percentual de apuração que um `toFixed` publicaria
 *      um décimo abaixo do verdadeiro.
 *
 * Por isso a troca "é só trocar o ponto pela vírgula, dá na mesma" não dá na
 * mesma, e há teste nomeado para ela em `tests/unit/lib/format.test.ts`.
 *
 * ## Diferenças deliberadas em relação a {@link formatPercent}
 *
 *   - **Não clampa** em 0–100. As cópias que ela substitui não clampavam, e
 *     um percentual fora da faixa é defeito de dado que deve aparecer na
 *     tela, não ser maquiado para `"100%"`.
 *   - `NaN` **e** `±Infinity` viram `"—"`. As cópias inline emitiam
 *     `"NaN%"`; "—" é o que o resto do arquivo (e do produto) usa para
 *     "não sabemos".
 *
 * ## ⚠️ O sinal sai daqui, e não do `Intl` — pelo mesmo motivo de `formatPp`
 *
 * `Intl.NumberFormat("pt-BR")` escreve negativo com **HYPHEN-MINUS (U+002D)**,
 * o hífen do teclado. O projeto usa **MINUS SIGN (U+2212)**: é o que
 * {@link formatPp} emite desde sempre, e o glifo que
 * `tests/unit/components/Figure.test.tsx` trava. O hífen é mais estreito,
 * fica na altura errada ao lado de algarismos `tabular-nums` e, num leitor
 * de tela, pode ser lido como pontuação em vez de sinal.
 *
 * Por isso o valor vai ao `Intl` em **módulo** e o sinal é prefixado aqui —
 * exatamente a mecânica de {@link formatPp}, para que as duas funções não
 * possam divergir. `-0` não ganha sinal (`-0 < 0` é falso): `"0%"`, nunca
 * `"−0%"`.
 */
export function formatPercentTrim(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const sign = rounded < 0 ? "−" : "";
  const abs = formatador(undefined, decimals).format(Math.abs(rounded));
  return `${sign}${abs}%`;
}

/**
 * Formata votos com separador de milhar pt-BR (ex. 79.812.408).
 *
 * Para a home (RF-022) queremos número cheio — não abreviar para "79M".
 * Abreviações ("8,2M") só na tabela de UFs ou cards estreitos: use
 * `formatVotesCompact` para isso.
 */
export function formatVotes(votes: number): string {
  if (Number.isNaN(votes) || !Number.isFinite(votes)) return "—";
  return formatador(undefined, undefined).format(Math.round(votes));
}

/**
 * Abreviado em pt-BR: 8.234.000 → "8,2 mi", 680.000 → "680 mil".
 *
 * Usa thresholds inteiros para previsibilidade. Não usa `Intl.NumberFormat`
 * com `notation: 'compact'` porque o "mil/mi" em pt-BR varia ("mi" ou "M"
 * conforme implementação V8/JSC); aqui forçamos a forma curta NYT-like.
 */
export function formatVotesCompact(votes: number): string {
  if (Number.isNaN(votes) || !Number.isFinite(votes)) return "—";
  const abs = Math.abs(votes);
  // 999.500–999.999 arredondam para 1.000 mil: sobem para "1 mi" (o mesmo
  // formato do milhão), nunca "1.000 mil" (spec 026 RF-297, 04/10).
  if (abs >= 1_000_000 || Math.round(abs / 1_000) >= 1_000) {
    const m = votes / 1_000_000;
    return `${formatador(undefined, 1).format(m)} mi`;
  }
  if (abs >= 1_000) {
    const k = Math.round(votes / 1_000);
    return `${formatador(undefined, undefined).format(k)} mil`;
  }
  return formatador(undefined, undefined).format(votes);
}

/**
 * Formata um intervalo de confiança 95% em pp (pontos percentuais).
 * `(lower, upper)` vêm em 0-100; saída ex.: "[52,1; 54,3]".
 */
export function formatCI(lower: number, upper: number, decimals = 1): string {
  if (Number.isNaN(lower) || Number.isNaN(upper)) return "—";
  const f = formatador(decimals, decimals);
  const lo = f.format(lower);
  const up = f.format(upper);
  return `[${lo}; ${up}]`;
}

/**
 * "HH:MM:SS" no fuso de Brasília a partir de um ISO 8601. Determinístico:
 * usa `Intl.DateTimeFormat` com TZ fixa, então o output é o mesmo em SSR e
 * cliente, mesmo se o servidor estiver em UTC.
 *
 * Edge cases:
 *   - ISO inválido → "—"
 */
export function formatTimeHMS(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Margem em pp formatada com sinal explícito: "+2,1 pp" / "-0,8 pp".
 * Útil para a comparação descritiva vs. 2022 (RF-038) e para margens em
 * insights. NaN e `null` são responsabilidade do caller — aqui NaN vira "—".
 */
export function formatPp(value: number, decimals = 1): string {
  if (Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = formatador(decimals, decimals).format(Math.abs(value));
  return `${sign}${abs} pp`;
}
