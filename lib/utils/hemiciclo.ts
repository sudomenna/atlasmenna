/**
 * lib/utils/hemiciclo.ts — a geometria do hemiciclo, sem React: o plenário da
 * Câmara (spec 017) e, desde 2026-09-29, o do Senado (spec 023).
 *
 * Vive aqui, e não dentro do componente, porque é **aritmética com um
 * invariante**: a soma dos assentos desenhados tem de ser exatamente `N`. Na
 * Câmara, `N` é `bancada.total_cadeiras` — RF-125.1; no Senado, os 27 mandatos
 * até 2031 mais as vagas em disputa — RF-216. Um invariante de contagem se
 * testa melhor isolado do JSX, e é isso que separa "o SVG parece certo" de
 * "as bolinhas somam o que a casa tem".
 *
 * ## 🔴 `513` (e `81`) não é constante em lugar nenhum
 *
 * Nada neste arquivo assume 513 ou 81 — nem como default, nem como limite, nem
 * como divisor. Todo número de cadeira sai do argumento `total`.
 *
 * ⚠️ **Corrigido em 2026-09-19.** Este parágrafo dizia que "o tamanho da Câmara
 * é a soma dos `lugares_a_preencher` publicados, lida em runtime", e que "a
 * redistribuição pelo Censo 2022 (PLP 177/2023) pode elevá-la a 531 e não tem
 * desfecho confirmado". As duas metades eram falsas. A soma **não podia** ser o
 * tamanho da Câmara: ela só conta as UFs que já publicaram, e com três estados
 * pequenos no ar dava 26 — este desenho chegou a receber esse número. E o PLP
 * 177/2023 foi vetado integralmente em julho/2025, com o STF mantendo as 513
 * para este pleito. Hoje o total é fato fixo no produtor do payload
 * (`api/model/cargos.py`), conferido contra a soma dos `carg[].nv` das 27 UFs.
 * RF-124 rege o número **por UF**, não o total nacional. A regra deste arquivo
 * não muda por isso: o desenho não pode assumir o tamanho da casa.
 *
 * ## 🔴 O número de arcos é CONSTANTE POR CASA, e é por isso que ele é constante
 *
 * {@link ARCOS_CAMARA} é 12 e {@link ARCOS_SENADO} é 5, fixos. A tentação
 * natural é derivar o número de arcos de `N` — "mais cadeiras, mais linhas" —,
 * e ela está errada pelo motivo que só aparece no dia em que `N` muda: com o
 * número de arcos derivado, **cruzar um limiar reestrutura o desenho
 * inteiro**. O leitor veria o plenário mudar de forma por causa de uma decisão
 * do Congresso sobre o Censo, e leria essa mudança como informação sobre a
 * eleição. Com o número fixo, 513 → 531 acrescenta uma ou duas bolinhas a cada
 * arco e nada mais muda.
 *
 * **O que mudou em 2026-09-29 (spec 023):** "a casa" passou a ser argumento
 * (`layoutHemiciclo(total, { arcos })`). O número continua sendo escolha de
 * desenho, fixa, feita **uma vez por casa** — nunca uma função de `N`. O
 * default é o da Câmara, e o plenário da Câmara sai byte a byte igual ao de
 * antes (`tests/unit/components/camara-hemiciclo-retrato.test.tsx`). Por que 5
 * no Senado: com 81 cadeiras, 5 arcos dão 10/13/16/19/23 e os dois
 * espaçamentos (radial 13,75; angular 13,66 no arco externo) quase coincidem —
 * bolinhas redondas, pelo mesmo critério que escolheu 12 para 513.
 *
 * A única exceção é o extremo pequeno: uma casa com menos de duas cadeiras
 * por arco produziria arcos vazios, e arco vazio no meio do desenho é um
 * buraco que se lê como cadeira faltando. Ver {@link arcosPara}.
 *
 * ## Determinismo (constituição § 6)
 *
 * Sem `Math.random()`, sem `Date`, sem estado de módulo. Mesmo `total` e mesmos
 * arcos ⇒ mesmo layout, campo a campo, casa decimal a casa decimal (as
 * coordenadas são arredondadas em {@link arred} justamente para que a
 * comparação byte a byte valha, sem depender do último bit do `Math.cos` de uma
 * plataforma).
 *
 * ## O desenho, em quatro passos
 *
 *   1. **Arcos**: os da casa ({@link ARCOS_CAMARA} por default), com a guarda
 *      do extremo pequeno.
 *   2. **Raios igualmente espaçados** entre {@link RAIO_INTERNO} e
 *      {@link RAIO_EXTERNO}.
 *   3. **Assentos por arco proporcionais ao raio** (arco maior comporta mais),
 *      com o resto distribuído por **maiores restos (Hare)** e desempate por
 *      índice de arco crescente — ver {@link assentosPorArco}.
 *   4. **Ângulos uniformes** dentro de cada arco, em centro de célula:
 *      `θ_j = π (j + ½) / s`. O `+ ½` não é estética — é o que faz `s = 1`
 *      funcionar sem divisão por zero e o que dá margens iguais nas duas
 *      pontas.
 *
 * A ordem de varredura é da **esquerda para a direita** (θ decrescente),
 * atravessando os arcos — é isso que faz cada agremiação ocupar uma cunha
 * contígua em vez de pontilhar o desenho inteiro.
 *
 * ## Marcas de limiar (spec 023, design § D7)
 *
 * A visão por bloco (spec 025) vai marcar limiares — "k cadeiras antes daqui".
 * {@link marcaDeLimiar} dá o ângulo da marca entre a cadeira `k − 1` e a `k`
 * da varredura, e diz quando as duas estão na MESMA coluna (empate entre
 * arcos), caso em que nenhuma linha radial as separa. Não é caso raro: a marca
 * de maioria do Senado (41) cai exatamente assim.
 */

/** Raio do arco mais externo, em unidades do `viewBox`. É a escala do desenho. */
export const RAIO_EXTERNO = 100;

/**
 * Fração do raio externo em que começa o arco mais interno. 0,45 deixa o
 * "buraco" do plenário grande o bastante para os arcos não se amontoarem no
 * centro e pequeno o bastante para o arco externo não virar um fio.
 */
export const FRACAO_INTERNA = 0.45;

/** Raio do arco mais interno. */
export const RAIO_INTERNO = RAIO_EXTERNO * FRACAO_INTERNA;

/**
 * Arcos da Câmara. **Constante de desenho, não derivada de `N`** — ver o
 * cabeçalho. Com 12 arcos e ~513 cadeiras o espaçamento angular (≈5,24) e o
 * radial (5,00) quase coincidem, que é o que faz as bolinhas saírem redondas e
 * igualmente afastadas nos dois eixos.
 */
export const ARCOS_CAMARA = 12;

/**
 * Arcos do Senado (spec 023). Com 81 cadeiras: 10/13/16/19/23 — o espaçamento
 * radial (13,75) e o angular do arco externo (13,66) quase coincidem, o mesmo
 * critério dos 12 da Câmara. Fixo pelo mesmo motivo: a forma do desenho não
 * pode mudar com o número de cadeiras.
 */
export const ARCOS_SENADO = 5;

/**
 * O default de {@link arcosPara} e {@link layoutHemiciclo}: a Câmara, que é o
 * uso anterior à generalização. Mantido com este nome porque é ele que os
 * testes da spec 017 travam (`tests/unit/lib/hemiciclo.test.ts`).
 */
export const ARCOS_PADRAO = ARCOS_CAMARA;

/** Folga em volta do arco, para o contorno do assento não ser cortado. */
const MARGEM = 3;

/** Fração do menor espaçamento que vira raio do assento. */
const OCUPACAO_DO_ASSENTO = 0.4;

/**
 * Quantos arcos para `total` cadeiras numa casa de `arcos` arcos
 * ({@link ARCOS_PADRAO} por default), exceto no extremo pequeno.
 *
 * A guarda é `total < 2 · arcos ⇒ arcos = max(1, ⌊total / 2⌋)`: abaixo de duas
 * cadeiras por arco a distribuição proporcional começa a produzir arcos com
 * zero assentos, e um arco vazio no meio do desenho se lê como cadeira
 * faltando, não como escolha de layout.
 *
 * Não é caminho hipotético: um payload degradado com 4 ou 10 cadeiras
 * publicadas passa por aqui na primeira meia hora da apuração.
 */
export function arcosPara(total: number, arcos: number = ARCOS_PADRAO): number {
  const casa = arcosDaCasa(arcos);
  if (total <= 0) return 0;
  if (total < 2 * casa) return Math.max(1, Math.floor(total / 2));
  return casa;
}

/**
 * Normaliza o número de arcos pedido. Valor que não é inteiro positivo cai no
 * default — nunca em "zero arcos", que apagaria o desenho em silêncio.
 */
function arcosDaCasa(arcos: number): number {
  return Number.isInteger(arcos) && arcos > 0 ? arcos : ARCOS_PADRAO;
}

/** Raios dos arcos, do interno para o externo. Um arco só ⇒ o raio médio. */
export function raiosDosArcos(arcos: number): number[] {
  if (arcos <= 0) return [];
  if (arcos === 1) return [(RAIO_INTERNO + RAIO_EXTERNO) / 2];
  const passo = (RAIO_EXTERNO - RAIO_INTERNO) / (arcos - 1);
  return Array.from({ length: arcos }, (_, k) => RAIO_INTERNO + k * passo);
}

/**
 * Assentos por arco, do interno (índice 0) para o externo.
 *
 * Proporcional ao raio (o arco externo é mais longo e comporta mais), com o
 * resto do arredondamento distribuído por **maiores restos** — o método de
 * Hare —, desempate por **índice de arco crescente**.
 *
 * 🔴 O `Σ === total` é o ponto inteiro desta função, e é o invariante de
 * RF-125.1 na sua forma geométrica. `Math.floor` sozinho perde entre 0 e
 * `arcos − 1` cadeiras, e a perda é invisível: o desenho continua bonito, só
 * com menos cadeiras do que a Câmara tem. O desempate existe porque dois arcos
 * com o mesmo resto fracionário trocariam de lugar entre execuções sem ele, e
 * a cor das cadeiras junto (constituição § 6).
 */
export function assentosPorArco(total: number, arcos: number): number[] {
  if (total <= 0 || arcos <= 0) return [];
  const raios = raiosDosArcos(arcos);
  const somaRaios = raios.reduce((a, b) => a + b, 0);

  const quotas = raios.map((r) => (total * r) / somaRaios);
  const base = quotas.map((q) => Math.floor(q));
  const resto = total - base.reduce((a, b) => a + b, 0);

  const porResto = quotas
    .map((q, k) => ({ k, frac: q - Math.floor(q) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.k - b.k));

  for (let j = 0; j < resto; j++) {
    const alvo = (porResto[j] as { k: number }).k;
    base[alvo] = (base[alvo] as number) + 1;
  }
  return base;
}

/** Uma cadeira, já posicionada. */
export interface AssentoGeometria {
  /** Posição na varredura esquerda → direita. É por ela que a cor é atribuída. */
  i: number;
  /** Arco a que pertence. 0 = mais interno. */
  arco: number;
  /**
   * Ângulo da cadeira, em radianos: π na ponta esquerda, 0 na direita
   * (`π (j + ½) / s`). **Não arredondado** — não vai para o SVG, e é por este
   * valor exato que a varredura foi ordenada (ver {@link marcaDeLimiar}).
   */
  theta: number;
  cx: number;
  cy: number;
}

export interface HemicicloLayout {
  /** `assentos.length`. Igual ao `total` pedido, por construção (RF-125.1). */
  total: number;
  arcos: number;
  /** Assentos por arco, do interno para o externo. */
  porArco: number[];
  /** Raio de cada arco, do interno para o externo (unidades do `viewBox`). */
  raios: number[];
  /** Centro do semicírculo, em coordenadas do `viewBox`. */
  centro: { cx: number; cy: number };
  /** Raio de cada bolinha, em unidades do `viewBox`. */
  raioAssento: number;
  width: number;
  height: number;
  assentos: AssentoGeometria[];
}

/** Opções de {@link layoutHemiciclo}. */
export interface OpcoesHemiciclo {
  /**
   * Arcos da casa — {@link ARCOS_CAMARA} (default) ou {@link ARCOS_SENADO}.
   * Constante por casa, nunca calculada a partir de `total` (ver o cabeçalho).
   */
  arcos?: number;
}

/**
 * Arredonda para 3 casas. Existe para o SVG sair **byte a byte igual** entre
 * execuções e plataformas: `Math.cos` não é garantido bit a bit pelo padrão da
 * linguagem, e 3 casas em unidades de um `viewBox` de 210 são bem mais finas
 * que um pixel em qualquer tamanho de render.
 */
function arred(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * O layout inteiro para `total` cadeiras.
 *
 * `total <= 0` devolve um layout vazio com caixa mínima — a tela que não tem
 * número não desenha bolinha nenhuma, e não inventa uma Câmara de tamanho
 * padrão para preencher o espaço (design 017 § D8).
 */
export function layoutHemiciclo(total: number, opcoes: OpcoesHemiciclo = {}): HemicicloLayout {
  const n = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const arcos = arcosPara(n, opcoes.arcos ?? ARCOS_PADRAO);

  if (arcos === 0) {
    return {
      total: 0,
      arcos: 0,
      porArco: [],
      raios: [],
      centro: { cx: arred(RAIO_EXTERNO + MARGEM), cy: arred(RAIO_EXTERNO + MARGEM) },
      raioAssento: 0,
      width: arred(2 * (RAIO_EXTERNO + MARGEM)),
      height: arred(RAIO_EXTERNO + 2 * MARGEM),
      assentos: [],
    };
  }

  const raios = raiosDosArcos(arcos);
  const porArco = assentosPorArco(n, arcos);

  // O raio da bolinha sai do MENOR dos dois espaçamentos. Usar só o radial
  // deixaria os assentos do arco externo encavalados; usar só o angular
  // deixaria corredores largos entre os arcos.
  const gapRadial =
    arcos > 1 ? (RAIO_EXTERNO - RAIO_INTERNO) / (arcos - 1) : RAIO_EXTERNO - RAIO_INTERNO;
  let gapAngular = Number.POSITIVE_INFINITY;
  for (let k = 0; k < arcos; k++) {
    const s = porArco[k] as number;
    if (s < 1) continue;
    // Centro de célula: `s` células no arco de π ⇒ passo π·r / s.
    gapAngular = Math.min(gapAngular, (Math.PI * (raios[k] as number)) / s);
  }
  if (!Number.isFinite(gapAngular)) gapAngular = gapRadial;
  const raioAssento = arred(OCUPACAO_DO_ASSENTO * Math.min(gapRadial, gapAngular));

  const cx0 = RAIO_EXTERNO + raioAssento + MARGEM;
  const cy0 = RAIO_EXTERNO + raioAssento + MARGEM;
  const width = arred(2 * cx0);
  const height = arred(cy0 + raioAssento + MARGEM);

  // Gera com o ângulo em mãos, ordena pela varredura, só então numera.
  const brutos: Array<AssentoGeometria & { theta: number }> = [];
  for (let k = 0; k < arcos; k++) {
    const s = porArco[k] as number;
    const r = raios[k] as number;
    for (let j = 0; j < s; j++) {
      const theta = (Math.PI * (j + 0.5)) / s;
      brutos.push({
        i: 0,
        arco: k,
        theta,
        cx: arred(cx0 + r * Math.cos(theta)),
        cy: arred(cy0 - r * Math.sin(theta)),
      });
    }
  }

  // Esquerda → direita: θ decrescente. Desempate pelo arco (interno primeiro),
  // para a ordenação ser TOTAL — duas cadeiras no mesmo ângulo em arcos
  // diferentes trocariam de lugar entre execuções sem este segundo critério, e
  // a cor delas junto (constituição § 6).
  brutos.sort((a, b) => (b.theta !== a.theta ? b.theta - a.theta : a.arco - b.arco));

  const assentos: AssentoGeometria[] = brutos.map((s, i) => ({
    i,
    arco: s.arco,
    theta: s.theta,
    cx: s.cx,
    cy: s.cy,
  }));

  return {
    total: assentos.length,
    arcos,
    porArco,
    raios,
    centro: { cx: arred(cx0), cy: arred(cy0) },
    raioAssento,
    width,
    height,
    assentos,
  };
}

// ---------------------------------------------------------------------------
// Marcas de limiar (spec 023, design § D7) — só a geometria; quem desenha é a
// visão por bloco da spec 025
// ---------------------------------------------------------------------------

/**
 * Tolerância para "mesmo ângulo". Não é folga de gosto: a varredura ordena
 * pelo θ em ponto flutuante, e duas cadeiras que estão matematicamente na mesma
 * coluna podem sair com θ diferentes no último bit — `(π · 6,5) / 13` dá
 * `1,5707963267948968` e `(π · 9,5) / 19` dá `1,5707963267948966`, os dois
 * valendo π/2. A menor distância angular REAL entre colunas distintas, em
 * qualquer casa plausível, é da ordem de 1e-3; 1e-9 separa as duas escalas com
 * seis ordens de grandeza de folga.
 *
 * ⚠️ Consequência registrada no design 023 § D7: o comentário da varredura em
 * {@link layoutHemiciclo} ("desempate pelo arco, interno primeiro") só decide
 * quando os θ são IGUAIS em ponto flutuante. Na coluna central é o último bit
 * que decide. A ordem continua determinística (× e ÷ do IEEE-754 são
 * corretamente arredondados em toda plataforma) e NÃO foi mudada: mudar
 * mudaria o plenário da Câmara, que tem de sair byte a byte igual.
 */
export const EPS_ANGULO = 1e-9;

/** Onde fica a marca do limiar `k` — ver {@link marcaDeLimiar}. */
export interface MarcaDeLimiar {
  /** Quantas cadeiras ficam ANTES da marca, na varredura esquerda → direita. */
  k: number;
  /**
   * Ângulo da marca (rad). Sem empate, a média dos θ das cadeiras `k − 1` e
   * `k` — a linha radial nesse ângulo separa EXATAMENTE as `k` primeiras das
   * demais. Com empate, o ângulo da coluna em que as duas estão.
   */
  theta: number;
  /**
   * `true` quando as cadeiras `k − 1` e `k` estão na mesma coluna (mesmo
   * ângulo, arcos diferentes): nenhuma linha radial as separa, e a coluna fica
   * partida entre os dois lados da marca.
   */
  empate: boolean;
  /** Em empate, os arcos da coluna cujas cadeiras ficam ANTES da marca. Sem empate, `[]`. */
  arcosAntes: number[];
  /** Em empate, os arcos da coluna cujas cadeiras ficam DEPOIS da marca. Sem empate, `[]`. */
  arcosDepois: number[];
}

/**
 * A marca do limiar `k`: entre a cadeira `k − 1` e a cadeira `k` da varredura
 * (índices a partir de 0), isto é, com `k` cadeiras antes dela. `null` quando
 * não há cadeira dos dois lados (`k < 1`, `k > total − 1`) ou `k` não é
 * inteiro.
 *
 * 🔴 **`k − 1` e `k`, não `k` e `k + 1`.** "Maioria de 41" quer dizer 41
 * cadeiras à esquerda — as de índice 0..40. Um erro de um aqui desloca a marca
 * uma cadeira, e no Senado é a diferença entre a marca cair na coluna central
 * (empate) ou fora dela.
 */
export function marcaDeLimiar(layout: HemicicloLayout, k: number): MarcaDeLimiar | null {
  if (!Number.isInteger(k) || k < 1 || k > layout.total - 1) return null;
  const antes = layout.assentos[k - 1] as AssentoGeometria;
  const depois = layout.assentos[k] as AssentoGeometria;

  if (Math.abs(antes.theta - depois.theta) >= EPS_ANGULO) {
    return {
      k,
      theta: (antes.theta + depois.theta) / 2,
      empate: false,
      arcosAntes: [],
      arcosDepois: [],
    };
  }

  const coluna = layout.assentos.filter((a) => Math.abs(a.theta - antes.theta) < EPS_ANGULO);
  return {
    k,
    theta: antes.theta,
    empate: true,
    arcosAntes: coluna.filter((a) => a.i < k).map((a) => a.arco),
    arcosDepois: coluna.filter((a) => a.i >= k).map((a) => a.arco),
  };
}

/**
 * O ponto a `raio` do centro, no ângulo `theta`, em coordenadas do `viewBox`
 * (arredondado como as cadeiras). Para a marca ficar FORA do arco externo, o
 * raio passa de {@link RAIO_EXTERNO} + `raioAssento` — e quem desenha a marca
 * precisa de um `viewBox` com essa folga, que o layout desta função não dá (e
 * não pode dar sem mudar o plenário da Câmara).
 */
export function pontoNoAngulo(
  layout: HemicicloLayout,
  theta: number,
  raio: number,
): { x: number; y: number } {
  return {
    x: arred(layout.centro.cx + raio * Math.cos(theta)),
    y: arred(layout.centro.cy - raio * Math.sin(theta)),
  };
}
