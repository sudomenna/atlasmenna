/**
 * components/atoms/charts/SerieApuracaoChart.tsx
 *
 * Spec 020 (RF-170 a RF-176) — a evolução da apuração: horário do boletim no
 * eixo horizontal, fatia de votos no vertical, uma linha por candidatura (no
 * máximo 4), em **duas bases** desenhadas ambas no servidor.
 *
 * Server Component. SVG inline, sem lib de charting, sem `"use client"`, sem
 * animação (constituição § 9, RNF-007a, RNF-026).
 *
 * ## As cinco decisões que este arquivo carrega
 *
 * 1. **Eixo horizontal é o RELÓGIO, não a fila.** Usa `makeTimeScale`, nunca
 *    `makeScale`. Um atraso de 20 min do TSE tem de aparecer como vão — é a
 *    notícia, e o eixo por índice a apagaria (ADR-0038; ver o bloco no topo de
 *    `scale.ts`).
 *
 * 2. **A cor sai do PARTIDO** (`textForParty`), nunca do campo `cor` do
 *    payload (RF-171). O payload ainda publica `var(--color-cand-N)`, a cor por
 *    rank que o ADR-0024 aposentou: lê-la aqui reintroduziria o defeito no
 *    único lugar em que ele seria visível como **movimento** — a linha trocaria
 *    de cor no instante de uma ultrapassagem.
 *
 *    É `textForParty` e não `colorForParty` porque a base é cor de **área**, e
 *    o que este componente desenha é um traço de 1,5–2,5 px sobre o papel — o
 *    caso do SC 1.4.11 (Non-text Contrast, piso 3:1). Medidas contra
 *    `--surface-page` (#f3f4f6), quatro bases reprovam esse piso: PSOL 2,08:1,
 *    PSB 2,19:1, o fallback `outros` 2,39:1 e NOVO 2,72:1. A variante
 *    `--party-<slug>-text` é a MESMA matiz noutra intensidade (§ 2 v1.3), e em
 *    17 dos 31 partidos **é** a base — PT, PL e UNIÃO entre eles, nenhum pixel
 *    muda. A identidade por sigla do ADR-0024 fica intacta: `textForParty`
 *    também deriva do partido, nunca do rank.
 *
 *    🔴 O destaque do Senado continua sendo **espessura** (RF-173), nunca
 *    opacidade: opacidade compõe com a cor e desfaz a medida acima — foi o que
 *    derrubou 16 nós para 2,27:1 no axe em 2026-09-08.
 *
 * 3. **Uma régua vertical só, para as duas bases** (RF-172d). `yMin`/`yMax` são
 *    calculados sobre os valores das DUAS bases juntas. Escalas separadas
 *    fariam a alternância parecer mudança de resultado — uma mentira gráfica
 *    produzida a cada clique do leitor.
 *
 *    E, desde 2026-09-19, **um renderizador só para os dois ESTADOS**
 *    ({@link ReguaVertical}). O estado "antes do dia" e o estado "ok" tinham
 *    réguas próprias, em lados opostos da caixa, e a de quem tinha dado era a
 *    mais pobre das duas — duas linhas contra seis.
 *
 * 4. **`null` interrompe o traço.** Um balde sem ciclo vira dois elementos de
 *    traçado separados; nunca se interpola entre as pontas e nunca se desce a
 *    zero (RF-175b). Zero é um resultado; ausência de medição não é
 *    (`docs/reference/risks.md`, "três estados e não-regressão").
 *
 * 5. **Chave própria, independente do topo** (RF-172, emenda de 2026-10-04).
 *    As duas bases saem em `<g data-serie-only="parcial">` e
 *    `<g data-serie-only="proj">`; quem alterna é o `<SerieBaseAlternavel>`
 *    (client, só no estado "ok"), que abre em Apuração. Até 04/10 era o
 *    `<ViewModeSwitch>` do shell, pela cascata `data-view-only`; o dono pediu um
 *    seletor dentro do gráfico e decidiu que ele só muda o gráfico — por isso o
 *    atributo mudou de nome, para a cascata do shell não alcançá-lo. ESTE módulo
 *    continua Server Component: não tem `<input>`, `<button>` nem estado.
 *
 * ## Por que `display:none` aqui não viola o ADR-0017
 *
 * A proibição mira a **remoção de candidaturas** atrás de um controle. As
 * quatro estão presentes nas duas visões; o que alterna é a **base de
 * medição**. Nenhuma candidatura fica inalcançável em nenhum estado do
 * interruptor. Mesma mecânica que o painel de resultado já usa em produção
 * (design da spec 020 § 5).
 *
 * ## Fase pré-eleição
 *
 * A decisão de fase é do **chamador**, pelo ponto único `isPreEleicao`. Aqui
 * chega como booleano, e o literal da fase não ocorre neste arquivo — a guarda
 * estrutural de `tests/unit/config/fase.test.ts` varre `components/` e falha se
 * ocorrer. No estado de espera a palavra "projeção" não aparece em nenhuma
 * superfície do componente (RF-174): nem em `aria-label`, nem em `<title>`,
 * nem em `<desc>`, nem em legenda de tabela.
 *
 * ## Acessibilidade (RF-176)
 *
 * Precedente: `components/blocks/HexCartogramBrasil.tsx` — figura rotulada +
 * estrutura paralela `sr-only`. Aqui o SVG é `role="img"` (e não `role="group"`
 * como lá): este não contém nada interativo, então declarar "imagem única" é
 * correto e oculta os traçados da árvore de acessibilidade de uma vez.
 * **Uma** tabela, 8 colunas de dado — hora + (apurado, projeção) × 4. Duas
 * tabelas dobrariam o DOM e obrigariam a percorrer o mesmo eixo duas vezes.
 */

import type { CSSProperties } from "react";

import { SerieBaseAlternavel } from "@/components/atoms/charts/SerieBaseAlternavel";
import { makeTimeScale, verticalScale } from "@/components/atoms/charts/scale";
import { formatPercent, formatTimeHMS } from "@/lib/utils/format";
import { textForParty } from "@/lib/utils/party-color";

// ---------------------------------------------------------------------------
// Geometria — exportada para os testes não precisarem de números mágicos
// ---------------------------------------------------------------------------

/**
 * 🔴 Quatro folgas, uma por lado — e não duas simétricas.
 *
 * Até 2026-09-19 eram duas (`SERIE_PAD_X = 32`, `SERIE_PAD_Y = 20`), e a conta
 * que elas produziam era 416×180 dentro de 480×220: **70,9% da caixa**. Os
 * outros 29% eram papel em branco pago quatro vezes pela folga do lado mais
 * caro. Com os quatro lados declarados, a mesma caixa de 480×220 rende 80,0%, e
 * a caixa nova de 480×260, 81,8%.
 *
 * O ponto não é economizar pixel: é que as linhas ficavam numa faixa estreita no
 * meio de um bloco grande, e na coluna de `--container-sidebar: 400px` (menos
 * 16px de padding de cada lado, `AppShellSplit.module.css`) o SVG real tem
 * ~352px de largura — cada unidade do `viewBox` vale 0,73px de tela. Folga
 * desperdiçada ali é altura de gráfico que o leitor nunca vê.
 */

/**
 * ESQUERDA — continua 32, e agora está **em uso**.
 *
 * É onde a régua de percentual passa a morar nos dois estados (ver
 * {@link ReguaVertical}). `formatPercent(50, 0)` = "50%" mede ~22px a
 * `fontSize=10`, e um rótulo com `textAnchor="end"` ancorado em
 * `SERIE_PAD_LEFT - 6` precisa desses 22px à esquerda dele. É folga **ganha**,
 * não desperdiçada: antes destes 32 unidades ficavam vazios no estado "ok",
 * porque os rótulos de Y estavam do outro lado.
 */
export const SERIE_PAD_LEFT = 32;

/**
 * DIREITA — 8, e não 32.
 *
 * Deste lado só precisam caber o raio do ponto final (`r = 3.5`) e o
 * `textAnchor="end"` do rótulo da hora final, que cresce para dentro. Os 32
 * antigos empurravam **o último boletim** — o ponto que o leitor procura
 * primeiro na noite de 04/10 — 32 unidades para dentro da caixa, por nada.
 */
export const SERIE_PAD_RIGHT = 8;

/**
 * TOPO — 10.
 *
 * O rótulo do topo da régua tem baseline em `padTop + 4`; com 10px de corpo o
 * glifo começa cerca de 3 unidades acima de `padTop`. 10 deixa essa sobra
 * dentro do `viewBox` e nada mais — não há nada além do rótulo lá em cima.
 */
export const SERIE_PAD_TOP = 10;

/**
 * BASE — 18.
 *
 * Aqui mora a fileira de rótulos de hora: baseline em `height - 6`, glifos de
 * `height - 13` a `height - 3`. 18 deixa 5 unidades entre a linha do eixo
 * (`height - 18`) e o topo dos glifos — o respiro que impede o rótulo de
 * encostar no eixo —, e nem uma a mais.
 */
export const SERIE_PAD_BOTTOM = 18;

/** Passo dos rótulos do eixo vertical. Ver {@link limitesVerticais}. */
export const SERIE_PASSO_EIXO_PP = 5;

/**
 * Teto de **intervalos** entre marcas rotuladas da régua vertical — não de
 * marcas. Cinco intervalos são até seis marcas, e é de propósito: a régua
 * ilustrativa do estado "antes do dia" vai de 0 a 50 e tem de continuar saindo
 * exatamente como sai hoje — 0, 10, 20, 30, 40, 50 —, que são seis marcas e
 * cinco vãos. Ver {@link marcasDaRegua}.
 */
export const SERIE_MAX_INTERVALOS_EIXO = 5;

/**
 * Piso de intervalos. Existe porque uma régua de duas marcas — só as pontas —
 * é a régua pobre que este ajuste veio corrigir, e ela reapareceria sozinha em
 * domínios cujo alcance em passos não tem divisor intermediário. Ver o degrau
 * de {@link limitesVerticais}.
 */
export const SERIE_MIN_INTERVALOS_EIXO = 3;

/** Espessura das linhas fora de vaga (e de todas, quando `vagas` é 1). */
export const SERIE_TRACO_NORMAL = 1.5;
/** Espessura das linhas em vaga, quando `vagas` é 2 (RF-173). */
export const SERIE_TRACO_DESTAQUE = 2.5;

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

/**
 * Uma candidatura e suas duas séries, na forma colunar do payload
 * (ADR-0046 D1). Os dois arrays têm o mesmo comprimento de `eixo`.
 *
 * `null` é **furo**, nunca zero: o balde não teve ciclo.
 */
export interface SerieCandidatoView {
  id: number;
  nome: string;
  /**
   * Sigla do partido. É **daqui** que sai a cor — nunca de um campo `cor`.
   * Resolvida por `textForParty` (a variante legível da cor do partido), não
   * pela base: ver a decisão 2 no topo do arquivo.
   */
  partido: string;
  sqcand?: string;
  /** Fatia de votos válidos já apurados, 0–100. */
  apurado: (number | null)[];
  /** Fatia projetada pelo modelo, 0–100. */
  projetado: (number | null)[];
}

export interface SerieApuracaoChartProps {
  /** Instantes do eixo em ISO, ASC. `length` é o N de todas as séries. */
  eixo: string[];
  /** Cadência declarada pelo produtor, em minutos. Não é inferida aqui. */
  cadenciaMin: number;
  /** Até 4, **na ordem de exibição já decidida pelo produtor** (RF-170c). */
  candidatos: SerieCandidatoView[];
  /** Escopo legível — "Brasil", "SP", "Governador de SP". */
  escopo: string;
  /** 2 liga o destaque e a régua do Senado (RF-173). */
  vagas?: 1 | 2;
  /** Decidido pelo **chamador**, pelo ponto único de leitura da fase. */
  preEleicao?: boolean;
  /**
   * ADR-0076 — placar zerado (antes do 1º boletim). Mesma régua vazia do
   * estado pré, SEM a frase "disponível apenas no dia das eleições".
   */
  zerado?: boolean;
  width?: number;
  height?: number;
  /** `id` do `<title>` do SVG — a figura externa aponta para ele. */
  titleId: string;
}

// ---------------------------------------------------------------------------
// Aritmética
// ---------------------------------------------------------------------------

type Base = "parcial" | "proj";

interface Ponto {
  x: number;
  y: number;
}

/** ISO → epoch ms, ou `null`. Nunca deixa `NaN` chegar a um `path`. */
function epochDe(iso: string | undefined): number | null {
  if (iso == null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function valorFinito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * `yMax = ceil(max/5)*5`; `yMin` é o degrau abaixo do mínimo, e desce **mais um
 * passo só quando precisa** — sobre os valores das **duas** bases juntas
 * (RF-172d).
 *
 * **Sem forçar zero**, ao contrário do `<TimeSeriesChart>`: aquele mede margem,
 * onde o zero é o cruzamento e tem significado. Aqui não há zero semântico —
 * com candidaturas entre 8% e 42%, ancorar em 0 comprimiria toda a ação no
 * terço superior do gráfico.
 *
 * Múltiplos de 5 para que os rótulos não redesenhem a cada revalidação de 60 s.
 */
function limitesVerticais(candidatos: SerieCandidatoView[]): { yMin: number; yMax: number } {
  const todos: number[] = [];
  for (const c of candidatos) {
    for (const v of c.apurado) if (valorFinito(v)) todos.push(v);
    for (const v of c.projetado) if (valorFinito(v)) todos.push(v);
  }
  // Série inteira em furo: régua honesta de 0 a 100 em vez de NaN. Nenhum
  // traço será desenhado de qualquer modo.
  if (todos.length === 0) return { yMin: 0, yMax: 100 };

  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const passo = SERIE_PASSO_EIXO_PP;
  const yMax = Math.ceil(max / passo) * passo;

  // 🔴 O `- passo` incondicional que estava aqui **tinha uma razão** e ela
  // continua valendo: sem folga nenhuma, a candidatura mais baixa sai desenhada
  // colada na linha do eixo, e um traço sobre o eixo some. O errado não era
  // cobrar a folga — era cobrá-la SEMPRE.
  //
  // Quando o mínimo já está longe do degrau abaixo dele, aquele degrau JÁ é a
  // folga, e descer outro passo é regalar uma faixa inteira de gráfico a uma
  // região onde nenhuma linha passa. Com min 8,2 e max 31,7 (um Senado típico)
  // a régua saía 0–35 para desenhar valores que nunca descem de 8.
  //
  // O limiar é 30% do passo — 1,5pp. Acima dele o degrau basta; abaixo dele a
  // linha encostaria. Removê-lo de vez (o atalho tentador) poria a linha do
  // ZEMA, que mede 5,64%, a 1,6% da altura do eixo.
  const piso = Math.floor(min / passo) * passo;
  const yMin = Math.max(0, min - piso < passo * 0.3 ? piso - passo : piso);
  let teto = yMax > yMin ? yMax : yMin + passo;

  // ⚠️ O degrau, e o defeito que ele fecha.
  //
  // A régua só rotula em vãos que DIVIDEM o alcance do domínio — é o que garante
  // que a marca do topo caia exatamente em `yMax` sem um último vão menor que os
  // outros (ver {@link marcasDaRegua}). Mas há alcances sem divisor dentro do
  // teto: 35pp são 7 passos, e 7 é primo, então o único vão que divide 35 sem
  // estourar o teto é o próprio passo de 5pp — **oito vãos**, nove linhas
  // rotuladas numa caixa de 232 unidades. Papel quadriculado, não régua, e o
  // teto de {@link SERIE_MAX_INTERVALOS_EIXO} deixa de valer justamente onde
  // ninguém olhou. E 35pp de alcance é uma noite plausível (mínimo 7%, máximo
  // 38%), não um caso de laboratório.
  //
  // O conserto é subir o teto um passo de cada vez até o alcance admitir uma
  // régua de 3 a 5 vãos. Custa até 10pp de folga ACIMA da candidatura líder —
  // o lado barato da caixa, porque não é lá que a ação acontece — e só é cobrado
  // nos alcances que precisam. Nenhum dos domínios do produto passa por aqui:
  // 0–45 (nacional), 5–35 (Senado), 10–50 (UF) e 0–50 (a régua do pré) já têm
  // divisor. Alcance de 1 ou 2 passos não sobe: 2 ou 3 marcas é o que cabe ali.
  for (let i = 0; i < 3; i += 1) {
    const passos = Math.round((teto - yMin) / passo);
    if (passos < SERIE_MIN_INTERVALOS_EIXO || multiploDaRegua(passos) !== null) break;
    teto += passo;
  }

  return { yMin, yMax: teto };
}

/**
 * Quebra a série em **trechos contíguos de medição**. Um `null` (ou um instante
 * ilegível) fecha o trecho corrente e abre outro — é o coração do RF-175b.
 *
 * Nunca se costura por cima do furo: interpolar inventaria uma medição que não
 * houve, e descer a zero afirmaria uma queda que não houve. As duas são a mesma
 * mentira, com formas diferentes.
 */
function trechos(
  valores: (number | null)[],
  instantes: (number | null)[],
  xFor: (epochMs: number) => number,
  yFor: (valor: number) => number,
): Ponto[][] {
  const out: Ponto[][] = [];
  let atual: Ponto[] = [];

  for (let i = 0; i < instantes.length; i += 1) {
    const t = instantes[i];
    const v = valores[i];
    // `t == null` cobre o furo do eixo E o índice fora do array: um `eixo` mais
    // curto que a série é dado incoerente, e a leitura honesta é não desenhar
    // aquele ponto — nunca ancorá-lo num instante inventado.
    if (t == null || !valorFinito(v)) {
      if (atual.length > 0) out.push(atual);
      atual = [];
      continue;
    }
    atual.push({ x: xFor(t), y: yFor(v) });
  }
  if (atual.length > 0) out.push(atual);
  return out;
}

/**
 * `d` de um trecho. Um trecho de **um ponto só** vira `M x,y L x,y`, que com
 * `stroke-linecap="round"` desenha um ponto visível.
 *
 * Por que não um `<circle>` para esse caso: o teste do furo conta "elementos de
 * traçado", e uma série `[30, null, 32]` produz dois trechos de um ponto cada.
 * Com duas tags diferentes a contagem dependeria de qual seletor se usa, e a
 * asserção mais óbvia (`querySelectorAll("path")`) devolveria 0 — um teste que
 * passa sem provar nada. Uma tag só, um atributo só (`data-traco`).
 */
function pathDe(trecho: Ponto[]): string {
  const coords = trecho.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  if (coords.length === 1) return `M ${coords[0]} L ${coords[0]}`;
  return `M ${coords.join(" L ")}`;
}

/** Último valor medido da série — o que a régua da 2ª vaga acompanha. */
function ultimoMedido(valores: (number | null)[]): number | null {
  for (let i = valores.length - 1; i >= 0; i -= 1) {
    const v = valores[i];
    if (valorFinito(v)) return v;
  }
  return null;
}

function serieDaBase(c: SerieCandidatoView, base: Base): (number | null)[] {
  return base === "parcial" ? c.apurado : c.projetado;
}

// ---------------------------------------------------------------------------
// Moldura comum aos estados
// ---------------------------------------------------------------------------

const MOLDURA: CSSProperties = {
  position: "relative",
  margin: 0,
  borderTop: "1px solid var(--border-hairline)",
  paddingTop: "var(--space-3)",
};

const NOTA: CSSProperties = {
  margin: 0,
  font: "var(--type-body-sm)",
  color: "var(--text-muted)",
};

/**
 * O chip do protótipo: a frase pousada sobre a régua, não abaixo dela.
 *
 * 🔴 A centralização vai em CLASSES (`absolute top-1/2 left-1/2 -translate-*`),
 * nunca em `style`. Um `style={{top:"50%",transform:"translate(-50%,-50%)"}}`
 * põe quatro `%` no HTML, e a varredura do RF-161 (spec 019) lê o `innerHTML`
 * do `<main>` — atributos inclusive. O mesmo pixel, sem o caractere que aquela
 * guarda existe para caçar.
 */
const NOTA_SOBREPOSTA_CLASSES =
  "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full";

const NOTA_SOBREPOSTA: CSSProperties = {
  margin: 0,
  padding: "0.5rem 1rem",
  background: "var(--surface-raised, var(--background))",
  boxShadow: "0 1px 3px rgb(0 0 0 / 0.08), 0 8px 24px rgb(0 0 0 / 0.06)",
  fontSize: "0.875rem",
  color: "var(--text-muted)",
};

/**
 * A régua do estado "antes do dia" — fixa, ilustrativa, e sem nenhuma medição.
 *
 * As urnas fecham às 17h (horário de Brasília) e a noite útil de apuração vai
 * até cerca de 20h30, que é a janela do protótipo. Os valores existem para dar
 * ESCALA ao leitor, não para afirmar resultado: no dia, a régua vertical passa
 * a ser calculada dos dados e a horizontal, do `dado_ts` dos boletins.
 *
 * A lista de percentuais que ficava aqui (`[0, 10, 20, 30, 40, 50]`) **sumiu de
 * propósito**: o domínio 0–50 entregue a {@link marcasDaRegua} devolve
 * exatamente esses seis números. Um caminho de código a menos, mesma aparência
 * — é o que o bloco "as duas réguas concordam" de
 * `tests/unit/components/serie-apuracao-chart.test.tsx` verifica.
 */
const GRADE_PCT_MAX = 50;
const GRADE_HORAS = ["17h", "18h", "19h", "20h", "20h30"] as const;

/**
 * O SVG é fluido: `viewBox` fixo (a régua interna), tamanho pelo CSS.
 *
 * Com `width`/`height` em pixels o gráfico transbordava a coluna de
 * `--container-sidebar: 400px` das rotas de UF e o último rótulo do eixo
 * ficava fora da tela — medido no navegador em 2026-09-17.
 *
 * 🔴 Via CLASSE (`block h-auto w-full`), não `style`. Um `style={{width:"100%"}}`
 * põe o caractere "%" no HTML, e a varredura do RF-161 (spec 019) lê o
 * `innerHTML` do `<main>` — atributos inclusive —, não o `textContent`. O
 * mesmo pixel, sem o caractere que denuncia medição fabricada.
 */

/**
 * Traço dos eixos E da régua. `--border-chart`, nunca `--border-hairline` —
 * ver "O traço é `--border-chart`" acima. Os dois andam juntos de propósito:
 * uma régua mais forte que o eixo que a ancora lê como ruído.
 */
const EIXO_STROKE = "var(--border-chart)";
const ROTULO_FILL = "var(--text-muted)";

/** Os dois eixos, iguais em todos os estados que desenham a moldura. */
function Eixos({ width, yBase }: { width: number; yBase: number }) {
  return (
    <g data-testid="serie-eixos">
      <line
        x1={SERIE_PAD_LEFT}
        x2={width - SERIE_PAD_RIGHT}
        y1={yBase}
        y2={yBase}
        stroke={EIXO_STROKE}
        strokeWidth="1"
      />
      <line
        x1={SERIE_PAD_LEFT}
        x2={SERIE_PAD_LEFT}
        y1={SERIE_PAD_TOP}
        y2={yBase}
        stroke={EIXO_STROKE}
        strokeWidth="1"
      />
    </g>
  );
}

/**
 * Os valores que a régua vertical rotula, de baixo para cima.
 *
 * A regra: o vão entre marcas é um **múltiplo inteiro** do passo (5pp) que
 * **divide** o alcance do domínio, escolhido como o menor que caiba em
 * {@link SERIE_MAX_INTERVALOS_EIXO} vãos. Dividir o alcance é o que garante que
 * a marca do topo caia exatamente em `yMax` sem um último vão menor que os
 * outros — vão desigual faz a régua parecer quebrada, e a marca do topo é
 * obrigatória (é ela que carrega o `data-testid="serie-rotulo-ymax"`).
 *
 * Os domínios que a noite produz:
 *
 * | Domínio | Alcance ÷ 5 | Vão | Marcas |
 * |---|---|---|---|
 * | 0–50 (a régua ilustrativa do pré) | 10 | 10pp | 0,10,20,30,40,50 |
 * | 0–45 (a fixture nacional) | 9 | 15pp | 0,15,30,45 |
 * | 5–35 (um Senado típico) | 6 | 10pp | 5,15,25,35 |
 * | 10–50 (uma UF típica) | 8 | 10pp | 10,20,30,40,50 |
 * | 0–100 (série inteira em furo) | 20 | 20pp | 0,20,…,100 |
 *
 * Alcances sem divisor útil (35pp são 7 passos, e 7 é primo) não chegam aqui:
 * {@link limitesVerticais} sobe o teto um passo antes de devolver o domínio.
 */
function marcasDaRegua(yMin: number, yMax: number): number[] {
  const passo = SERIE_PASSO_EIXO_PP;
  const passos = Math.max(1, Math.round((yMax - yMin) / passo));

  // O `?? 1` cobre o domínio curto — 1 ou 2 passos, que não tem como render 3
  // vãos. Ali a régua sai com 2 ou 3 marcas e está certo: não há mais o que
  // rotular entre duas pontas a 5pp de distância. Alcance LONGO sem divisor não
  // chega aqui: {@link limitesVerticais} já subiu o teto. Se um dia chegar, cai
  // no vão de 5pp — denso demais, e é o que o degrau de lá existe para evitar.
  const vao = passo * (multiploDaRegua(passos) ?? 1);
  const vaos = Math.round((yMax - yMin) / vao);
  return Array.from({ length: vaos + 1 }, (_, i) => yMin + i * vao);
}

/**
 * Quantos passos de 5pp cabem em cada vão da régua, ou `null` se este alcance
 * não admite nenhuma régua entre {@link SERIE_MIN_INTERVALOS_EIXO} e
 * {@link SERIE_MAX_INTERVALOS_EIXO} vãos.
 *
 * Varre do menor múltiplo para o maior, e por isso devolve a régua mais DENSA
 * que cabe no teto: em 10 passos (0–50) recusa o vão de 5pp, que daria 10 vãos,
 * e devolve o de 10pp — os seis rótulos 0,10,20,30,40,50 que o estado
 * "antes do dia" já mostrava antes deste arquivo ter uma régua só.
 */
function multiploDaRegua(passos: number): number | null {
  for (let m = 1; m <= passos; m += 1) {
    if (passos % m !== 0) continue;
    const vaos = passos / m;
    if (vaos >= SERIE_MIN_INTERVALOS_EIXO && vaos <= SERIE_MAX_INTERVALOS_EIXO) return m;
  }
  return null;
}

/**
 * A régua vertical — **uma só**, para os dois estados que desenham a moldura.
 *
 * 🔴 Antes de 2026-09-19 havia duas, e elas discordavam de lado: o estado
 * "antes do dia" punha os rótulos à esquerda (`textAnchor="end"` em
 * `padX - 6`), o estado "ok" punha à direita (`width - padX + 4`). Um leitor
 * que abrisse a página antes das 17h e voltasse às 19h via a régua saltar de
 * lado. Pior: o estado COM dado desenhava duas linhas e quatro textos, e o
 * estado SEM dado desenhava seis linhas e seis textos — a caixa cheia parecia
 * mais vazia que a caixa vazia.
 *
 * O lado é a **esquerda** nos dois, porque é onde a moldura já vive: é ali que
 * {@link Eixos} desenha a linha vertical, onde o rótulo do corte da 2ª vaga
 * (RF-173) se apoia e onde o rótulo da hora inicial começa.
 *
 * ## O traço é `--border-chart`, e a razão é uma correção de rota
 *
 * A primeira versão desta régua usou `--border-hairline` (~1,45:1) com o
 * argumento de que a gridline é **andaime redundante**: o que ela comunica
 * estaria escrito no `<text>` ao lado, em `--text-muted` (5,52:1), então
 * apagar todas as linhas não tiraria informação de ninguém — e usar o token
 * dos eixos evitaria inventar um terceiro cinza de moldura.
 *
 * **O argumento não sobreviveu à auditoria de 2026-09-19, e ele estava errado
 * no ponto que importa.** A gridline não é redundante: ela existe justamente
 * para permitir seguir a ALTURA de uma linha de dado no meio da caixa até o
 * rótulo da borda sem fazer a proporção de cabeça. Ler "35%" na régua diz qual
 * valor mora naquela altura; não ajuda a comparar aquela altura com a curva do
 * 3º colocado. Essa é exatamente a função que o SC 1.4.11 (Non-text Contrast,
 * piso 3:1) protege para quem tem baixa visão. Se a linha fosse mesmo
 * decorativa, bastariam mais rótulos e ela não teria sido acrescentada.
 *
 * Havia ainda um erro de escala no argumento do "mesmo token já em produção":
 * antes desta mudança o estado "com dado" **não tinha gridline nenhuma** — o
 * cinza fraco só existia no esqueleto pré-eleição, visto por poucos minutos
 * antes do 1º boletim. Levá-lo para a tela que fica no ar a noite inteira da
 * apuração não é reaproveitar dívida, é ampliá-la no pior momento possível.
 *
 * Decisão do dono (19/09): token próprio, `--rule-chart`/`--border-chart`,
 * medido em **3,26:1** sobre `--paper-1` e 3,47:1 sobre `--paper-0` no tema
 * claro; no escuro aponta para `--ink-3`, que já media 3,91:1. Continua
 * visivelmente mais leve que o número ao lado (5,52:1), então a grade não
 * compete com o dado.
 *
 * 🔴 **O portão automático não protege este número.** O axe joga contraste de
 * SVG no balde `results.incomplete`, que não reprova nada — reconfirmado em
 * 19/09 com Lighthouse nas 6 rotas, zero itens de série reportados. Quem
 * trocar este token não receberá aviso nenhum: recalcule à mão.
 */
function ReguaVertical({
  width,
  yMin,
  yMax,
  yFor,
}: {
  width: number;
  yMin: number;
  yMax: number;
  yFor: (valor: number) => number;
}) {
  const marcas = marcasDaRegua(yMin, yMax);
  const topo = marcas.length - 1;

  return (
    <g data-testid="serie-regua-y">
      {marcas.map((valor, i) => {
        const y = yFor(valor);
        // Os dois `data-testid` sobreviveram à absorção pela régua: eram dois
        // `<text>` soltos e agora são a primeira e a última marca. Quem os
        // consome (testes, e qualquer inspeção manual na noite) continua
        // achando o mesmo número no mesmo nome.
        const testid = i === topo ? "serie-rotulo-ymax" : i === 0 ? "serie-rotulo-ymin" : undefined;

        return (
          <g key={`marca-${valor}`} data-grade-pct={valor}>
            <line
              x1={SERIE_PAD_LEFT}
              x2={width - SERIE_PAD_RIGHT}
              y1={y}
              y2={y}
              stroke={EIXO_STROKE}
              strokeWidth="1"
            />
            <text
              data-testid={testid}
              x={SERIE_PAD_LEFT - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--font-sans)"
              fill={ROTULO_FILL}
            >
              {formatPercent(valor, 0)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function SerieApuracaoChart({
  eixo,
  cadenciaMin,
  candidatos,
  escopo,
  vagas = 1,
  preEleicao = false,
  zerado = false,
  width = 480,
  height = 260,
  titleId,
}: SerieApuracaoChartProps) {
  const descId = `${titleId}-desc`;
  const yBase = height - SERIE_PAD_BOTTOM;

  // -------------------------------------------------------------------------
  // Estado 1 — antes do dia da eleição (RF-174)
  //
  // Eixos e rótulos, zero traçados, zero números percentuais. E nenhuma
  // ocorrência da palavra "projeção" em superfície alguma: não há projeção a
  // anunciar antes de haver apuração, e anunciá-la aqui prometeria ao leitor um
  // número que ninguém calculou.
  // -------------------------------------------------------------------------
  if (preEleicao || zerado) {
    return (
      <figure
        data-testid="serie-apuracao-chart"
        data-estado={zerado ? "zerado" : "antes-do-dia"}
        aria-labelledby={titleId}
        style={MOLDURA}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <title id={titleId}>{`Evolução da apuração — ${escopo}`}</title>
          <desc id={descId}>
            {zerado
              ? "Os eixos estão desenhados e ainda não há nenhuma linha: nenhum boletim foi recebido."
              : "Os eixos estão desenhados e ainda não há nenhuma linha. O gráfico fica disponível apenas no dia das eleições."}
          </desc>
          <Eixos width={width} yBase={yBase} />

          {/* A RÉGUA, sem nenhuma medição.
              Os rótulos de escala (0%..50%, 17h..20h30) NÃO afirmam resultado:
              são a moldura do gráfico, e é o que o protótipo do dono mostra.
              O que não pode aparecer aqui é valor DE CANDIDATURA — nenhum
              traçado, nenhum nome com número ao lado (RF-174).

              É o MESMO componente que o estado "ok" usa, com o domínio fixo
              0–50 no lugar do domínio medido. A escala do eixo é a lateral de
              uma balança vazia — decisão do dono em 2026-09-17, ao remover a
              proibição do caractere "%" da varredura de fase pré ("0% apurado é
              uma verdade antes da eleição"). As guardas que medem AFIRMAÇÃO
              (palavras proibidas, frases do RF-154, o "0/27") continuam
              inteiras e cobrem os três casos de 13/09. */}
          <ReguaVertical
            width={width}
            yMin={0}
            yMax={GRADE_PCT_MAX}
            yFor={verticalScale(height, SERIE_PAD_TOP, SERIE_PAD_BOTTOM, 0, GRADE_PCT_MAX).yFor}
          />

          {GRADE_HORAS.map((hora, i) => (
            <text
              key={`hora-${hora}`}
              x={
                SERIE_PAD_LEFT +
                (i / (GRADE_HORAS.length - 1)) * (width - SERIE_PAD_LEFT - SERIE_PAD_RIGHT)
              }
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === GRADE_HORAS.length - 1 ? "end" : "middle"}
              fontSize="10"
              fontFamily="var(--font-sans)"
              fill={ROTULO_FILL}
            >
              {hora}
            </text>
          ))}
        </svg>

        {/* A frase fica SOBRE a régua, centrada — é onde o protótipo a põe, e
            é o que impede a moldura vazia de parecer um gráfico que falhou
            ao carregar. */}
        {zerado ? null : (
          <figcaption
            data-testid="serie-apuracao-nota"
            className={NOTA_SOBREPOSTA_CLASSES}
            style={NOTA_SOBREPOSTA}
          >
            disponível apenas no dia das eleições
          </figcaption>
        )}
      </figure>
    );
  }

  const instantes = eixo.map(epochDe);
  const validos = instantes.filter((t): t is number => t !== null);

  // -------------------------------------------------------------------------
  // Estado 2 — não sabemos (RF-175): o bloco fica, o motivo é dito
  // -------------------------------------------------------------------------
  if (eixo.length === 0 || candidatos.length === 0) {
    return (
      <figure
        data-testid="serie-apuracao-chart"
        data-estado="indisponivel"
        aria-labelledby={titleId}
        style={MOLDURA}
      >
        {/* 🔴 A frase diz só o que vale nos DOIS escopos que montam este
            componente. A versão anterior afirmava "o arquivo de detalhe foi
            lido, mas sem a série" — verdade nas rotas de UF, e **falsa na
            home**, que não tem arquivo de detalhe nenhum: ali a série viaja no
            próprio payload. Era uma causa inventada, da mesma família dos zeros
            fabricados que a spec 019 existe para impedir, e mandaria quem
            estivesse depurando na noite de 04/10 procurar no lugar errado. */}
        <p id={titleId} data-testid="serie-apuracao-nota" style={NOTA}>
          A evolução da apuração em {escopo} ainda não chegou — a série por candidatura ainda não é
          publicada. Os números do resumo acima vêm de outra fonte e não são afetados por isto.
        </p>
      </figure>
    );
  }

  // -------------------------------------------------------------------------
  // Estado 3 — apurando, ainda sem linha (RF-175a)
  //
  // Com uma medição só não há inclinação: desenhar uma linha seria inventar a
  // metade que não foi medida. A frase nomeia a hora da primeira medição — e
  // não reusa "Série temporal ainda insuficiente", que é jargão.
  // -------------------------------------------------------------------------
  if (validos.length < 2) {
    const primeira = eixo[0];
    return (
      <figure
        data-testid="serie-apuracao-chart"
        data-estado="apurando"
        aria-labelledby={titleId}
        style={MOLDURA}
      >
        <p id={titleId} data-testid="serie-apuracao-nota" style={NOTA}>
          Primeira medição de {escopo} às {primeira ? formatTimeHMS(primeira) : "—"}. A linha
          aparece no próximo boletim, quando houver dois instantes para ligar.
        </p>
      </figure>
    );
  }

  // -------------------------------------------------------------------------
  // Estado 4 — o gráfico
  // -------------------------------------------------------------------------
  const tMin = Math.min(...validos);
  const tMax = Math.max(...validos);
  const { yMin, yMax } = limitesVerticais(candidatos);

  // Uma escala só. As duas bases desenham contra ela — é o que o RF-172(d)
  // exige, e está garantido aqui por construção: não existe um segundo
  // `makeTimeScale` neste arquivo que pudesse divergir.
  const { xFor, yFor } = makeTimeScale({
    width,
    height,
    padLeft: SERIE_PAD_LEFT,
    padRight: SERIE_PAD_RIGHT,
    padTop: SERIE_PAD_TOP,
    padBottom: SERIE_PAD_BOTTOM,
    tMin,
    tMax,
    yMin,
    yMax,
  });

  // `candidatos.length >= 2` faz parte do gatilho: uma corrida de 2 vagas com
  // uma candidatura só não tem "2ª colocada" para pendurar a régua, e inventar
  // um corte ali seria afirmar um limiar que ninguém mediu.
  const destacaVagas = vagas === 2 && candidatos.length >= 2;
  const primeiroIso = eixo[0];
  const ultimoIso = eixo[eixo.length - 1];
  const horaInicio = primeiroIso ? formatTimeHMS(primeiroIso) : "—";
  const horaFim = ultimoIso ? formatTimeHMS(ultimoIso) : "—";

  const cores = new Map(candidatos.map((c) => [c.id, textForParty(c.partido)] as const));
  const espessura = (indice: number): number =>
    destacaVagas
      ? indice < 2
        ? SERIE_TRACO_DESTAQUE
        : SERIE_TRACO_NORMAL
      : SERIE_TRACO_DESTAQUE - 0.5;

  /**
   * RF-173 — as duas posições que elegem, quando a corrida tem 2 vagas.
   * Vazio fora do Senado. Declarado aqui, e não derivado dentro da tabela,
   * porque a régua do gráfico e a frase da legenda têm de nomear as MESMAS
   * duas candidaturas: derivar duas vezes é como elas divergiriam.
   */
  const emVaga = destacaVagas ? candidatos.slice(0, 2) : [];

  /** Um grupo por base. A chave `<SerieBaseAlternavel>` escolhe qual aparece. */
  function grupoDaBase(base: Base) {
    // `candidatos[1]` é opcional sob `noUncheckedIndexedAccess`: uma corrida de
    // 2 vagas com uma só candidatura medida não tem 2ª colocada, e portanto não
    // tem régua de corte. Sem régua é o estado honesto — não zero.
    const segundaColocada = candidatos[1];
    const corteVaga =
      destacaVagas && segundaColocada ? ultimoMedido(serieDaBase(segundaColocada, base)) : null;

    return (
      <g data-serie-only={base === "parcial" ? "parcial" : "proj"} data-base={base}>
        {/* Régua da 2ª vaga (RF-173): a linha de corte do Senado, na altura da
            2ª colocada DAQUELA base. Uma régua por base porque o corte é um
            dado, e o dado muda entre apurado e projetado. */}
        {corteVaga !== null ? (
          <g data-testid="serie-regua-vaga" data-base={base}>
            <line
              x1={SERIE_PAD_LEFT}
              x2={width - SERIE_PAD_RIGHT}
              y1={yFor(corteVaga)}
              y2={yFor(corteVaga)}
              stroke={ROTULO_FILL}
              strokeWidth="1"
              strokeDasharray="4,3"
            />
            <text
              x={SERIE_PAD_LEFT + 4}
              y={yFor(corteVaga) - 4}
              fontSize="9"
              fontFamily="var(--font-sans)"
              fill={ROTULO_FILL}
            >
              corte da 2ª vaga
            </text>
          </g>
        ) : null}

        {candidatos.map((c, indice) => {
          const cor = cores.get(c.id) ?? textForParty(c.partido);
          const larguraTraco = espessura(indice);
          const segmentos = trechos(serieDaBase(c, base), instantes, xFor, yFor);
          const ultimo = segmentos[segmentos.length - 1]?.at(-1);

          return (
            <g key={c.id} data-cand={c.id} data-base={base}>
              {segmentos.map((trecho) => (
                <path
                  key={`${c.id}-${base}-${trecho[0]?.x.toFixed(1)}`}
                  data-traco=""
                  data-cand={c.id}
                  data-base={base}
                  d={pathDe(trecho)}
                  fill="none"
                  stroke={cor}
                  strokeWidth={larguraTraco}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {ultimo ? (
                <circle
                  data-ponto-final=""
                  data-cand={c.id}
                  data-base={base}
                  cx={ultimo.x}
                  cy={ultimo.y}
                  r={destacaVagas && indice < 2 ? 3.5 : 2.5}
                  fill={cor}
                />
              ) : null}
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <figure
      data-testid="serie-apuracao-chart"
      data-estado="ok"
      aria-labelledby={titleId}
      style={MOLDURA}
    >
      {/* RF-172, emenda de 2026-10-04 — a chave própria do gráfico, só neste
          estado: nos outros não há série para alternar, e no "antes do dia" a
          palavra "projeção" é proibida (RF-174). */}
      <SerieBaseAlternavel>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <title id={titleId}>{`Evolução da apuração — ${escopo}`}</title>
          <desc id={descId}>
            Fatia de votos de {candidatos.length}{" "}
            {candidatos.length === 1 ? "candidatura" : "candidaturas"} entre {horaInicio} e{" "}
            {horaFim}, em duas bases: o que já foi apurado e a projeção do modelo. Os mesmos números
            estão na tabela logo abaixo, instante a instante.
          </desc>

          <Eixos width={width} yBase={yBase} />

          {/* A régua vertical, FORA dos grupos de base: é a régua compartilhada,
            e mantê-la aqui torna estruturalmente impossível que as duas visões
            anunciem escalas diferentes (RF-172d).

            Desenhada ANTES dos grupos de base de propósito: em SVG a ordem do
            documento é a ordem de pintura, e a gridline tem de passar por baixo
            do traço da candidatura, nunca por cima dele. */}
          <ReguaVertical width={width} yMin={yMin} yMax={yMax} yFor={yFor} />

          <text
            x={SERIE_PAD_LEFT}
            y={height - 6}
            fontSize="10"
            fontFamily="var(--font-sans)"
            fill={ROTULO_FILL}
          >
            {horaInicio}
          </text>
          <text
            x={width - SERIE_PAD_RIGHT}
            y={height - 6}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--font-sans)"
            fill={ROTULO_FILL}
          >
            {horaFim}
          </text>

          {grupoDaBase("parcial")}
          {grupoDaBase("proj")}
        </svg>
      </SerieBaseAlternavel>

      {/* RF-176 — a tabela. Uma só, com as duas bases lado a lado. */}
      {/* 🔴 **A `sr-only` vai no DIV, nunca na `<table>`** (2026-09-19).
          Medido: a 360px de largura esta tabela saía com **2.768px** e
          empurrava a página inteira — 2.424px de rolagem horizontal na home.
          O truque de esconder visualmente depende de `width: 1px`, e o
          algoritmo de layout de TABELA trata isso como mínimo, não como
          teto: a tabela cresce até caber o conteúdo, e `overflow: hidden`
          não segura o próprio box dela.
          ⚠️ Forçar `display: block` na tabela resolveria o tamanho e
          DESTRUIRIA a semântica de linha/coluna para o leitor de tela — que
          é a única razão desta tabela existir (RNF-023). O `<div>` de fora
          aceita o recorte; a tabela dentro segue sendo tabela. */}
      <div className="sr-only">
        <table data-testid="serie-apuracao-tabela">
          <caption>
            Evolução da apuração em {escopo}, de {horaInicio} a {horaFim}, com uma medição a cada{" "}
            {cadenciaMin} minutos. As candidaturas listadas são as{" "}
            {candidatos.length === 1 ? "que está" : `${candidatos.length} que estão`} à frente no
            momento; quem sai do grupo deixa de aparecer, inclusive no passado. A coluna de projeção
            é uma estimativa do AtlasMenna, não um resultado oficial — o resultado oficial é o do
            Tribunal Superior Eleitoral.
            {destacaVagas && emVaga.length === 2
              ? ` Esta corrida elege 2 vagas: no momento, ${emVaga
                  .map((c) => c.nome)
                  .join(" e ")} as ocupam.`
              : ""}{" "}
            Onde não houve boletim, a célula diz "sem medição" — não é zero.
          </caption>
          <thead>
            <tr>
              {/* 🔊 Sigla INTEIRA nos cabeçalhos abaixo (2026-09-19): esta tabela
                é `sr-only` — ela não ocupa pixel nenhum, só é lida. A
                abreviação de `lib/utils/sigla-partido.ts` vale para o que é
                DESENHADO; aqui nada é. */}
              <th scope="col">Hora do boletim</th>
              {candidatos.map((c) => (
                <th key={`${c.id}-apurado`} scope="col">
                  {c.nome} ({c.partido}) — apurado
                </th>
              ))}
              {candidatos.map((c) => (
                <th key={`${c.id}-projecao`} scope="col">
                  {c.nome} ({c.partido}) — projeção
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eixo.map((iso, i) => (
              <tr key={iso}>
                <th scope="row">{formatTimeHMS(iso)}</th>
                {candidatos.map((c) => {
                  const v = c.apurado[i];
                  return (
                    <td key={`${c.id}-apurado-${iso}`} data-cand={c.id} data-base="parcial">
                      {valorFinito(v) ? formatPercent(v, 1) : "sem medição"}
                    </td>
                  );
                })}
                {candidatos.map((c) => {
                  const v = c.projetado[i];
                  return (
                    <td key={`${c.id}-projecao-${iso}`} data-cand={c.id} data-base="proj">
                      {valorFinito(v) ? formatPercent(v, 1) : "sem medição"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
