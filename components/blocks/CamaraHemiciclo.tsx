/**
 * components/blocks/CamaraHemiciclo.tsx
 *
 * O plenário da Câmara como um assento por cadeira — o formato que o dono
 * pediu, e que o payload já sustenta sem mudança nenhuma no produtor.
 *
 * ## Server Component, zero JavaScript
 *
 * SVG inline, sem estado, sem evento, sem `next/dynamic`. O precedente é
 * `HexCartogramBrasil.tsx` (27 formas em SVG inline), `SerieApuracaoChart.tsx`
 * (gráfico inteiro no servidor) e `UfLinksGrid.tsx`. Importa que seja zero JS
 * porque o chunk do MapLibre está em **285,3 KiB de 300** (RNF-007b) e este
 * widget não pode disputar essa folga: ele é leitura de dado, não interação.
 *
 * ⚠️ E **nenhum gate de RNF-007 enxerga este widget**: os três orçamentos
 * somam `resourceType === "script"`, e aqui não há script nenhum. O custo real
 * é HTML — ~513 `<circle>` agrupados por agremiação. Por isso
 * `tests/e2e/perf-budget.spec.ts` ganhou, junto com este componente, um caso
 * que mede o **corpo do documento**, e `/deputado-federal` entrou nas rotas
 * medidas. Um widget sem gate é um widget que cresce sem ninguém ver.
 *
 * ## 🔴 A ordem das cunhas é a MESMA da lista, e não é espectro
 *
 * `ordenarBancada` (`lib/utils/bancada.ts`) — cadeiras desc → sigla asc, a
 * mesma função que a lista de agremiações usa logo abaixo, não uma segunda
 * implementação com a mesma regra.
 *
 * Reusar a ordem existente **não afirma nada novo**. Ordenar por eixo
 * ideológico afirmaria: o produto não classifica partido em esquerda/direita
 * (constituição § 2), não temos medida para isso, e o desenho passaria a
 * comunicar uma leitura política que não medimos. Três coisas concretas
 * impedem essa leitura aqui: (a) **nenhum rótulo nas extremidades** do arco;
 * (b) o `<desc>` diz em texto que a ordem é por tamanho e não por posição
 * ideológica; (c) **nenhum marcador de maioria em 257** — a página já
 * argumenta que nada nesta eleição se decide em maioria simples, e um traço no
 * meio do arco diria o contrário.
 *
 * ## Os três estados da cadeira
 *
 * | estado | origem | aparência |
 * |---|---|---|
 * | `definida` | `cadeiras − cadeiras_indefinidas` | preenchida na cor da agremiação |
 * | `indefinida` | `cadeiras_indefinidas` | cinza, com anel na cor da agremiação |
 * | `nao_atribuida` | `total_cadeiras − Σ cadeiras` | cinza com anel neutro |
 *
 * A soma dos três é `total_cadeiras` **por construção** (ver
 * {@link assentosDaBancada}) — o invariante de RF-125.1 —, e não depende de o
 * payload ser coerente: a fila é truncada ou completada até caber exatamente
 * nas posições que a geometria produziu.
 *
 * ## Cor: `textForParty`, NUNCA `colorForParty`
 *
 * A tabela de remédios do RNF-035 (`docs/nfr/accessibility.md`) separa dois
 * casos: **marcador de identidade** (a cor diz *quem*) → `textForParty`;
 * **preenchimento com extensão** (a cor diz *quanto* ou *onde*) →
 * `DATA_FILL_STROKE`. Uma bolinha de cadeira é identidade: ela não tem extensão
 * a perder, precisa ser distinguível. A variante `-text` passa 3:1 nas 4
 * superfícies, nos 2 temas, nos 31 partidos — zero exceções —, e em 17 deles
 * **é** a cor base, então nada muda visualmente para a maioria.
 *
 * As cores-base reprovariam: PSOL 2,08, PSB 2,19, `outros` 2,39, NOVO 2,72 em
 * tema claro. E o PSOL é o líder da federação PSOL-Rede, então ele aparece
 * **nesta tela, em toda apuração** — não é caso de borda. Mesmo caminho do
 * ADR-0047 D1 e de `SerieApuracaoChart.tsx`.
 *
 * O anel neutro das cadeiras sem dono é `--text-secondary`, que o mesmo gate
 * prova em ≥5,0:1 — sem ele o disco cinza encosta no papel sem fronteira
 * (1,07:1) e deixa de delimitar o dado.
 *
 * ## RF-127: este widget carrega METADE, e só metade
 *
 * A metade que é dele: `cadeiras_indefinidas`, marcadas cadeira a cadeira.
 *
 * A outra metade — o intervalo — **não é desenhável aqui sem inventar**.
 * "Entre 85 e 93 cadeiras" não tem representação em bolinhas: desenhar até o
 * topo da faixa quebraria RF-125.1 (a soma deixaria de fechar), e desenhar a
 * faixa exigiria saber **de quem** seriam as cadeiras em disputa, coisa que o
 * payload nacional não diz. Então o intervalo fica onde já está: a coluna da
 * lista de agremiações.
 *
 * 🔴 Isso é travado por teste, não por convenção: o `<svg>` renderizado com
 * `cadeiras_ci95` em todas as linhas tem de ser **string idêntica** ao
 * renderizado sem nenhuma. Qualquer "melhoria" futura que desenhe o intervalo
 * derruba o teste no ato.
 *
 * ## A11y
 *
 * `role="img"` (não `role="group"`: aqui não há nada interativo dentro, ao
 * contrário do cartograma) + `<title>`/`<desc>`, e `aria-describedby` apontando
 * também para a **lista textual de agremiações** da própria página.
 * Constituição § 4: gráfico colorido sem lista textual paralela é defeito; a
 * lista existe, e o que faltava era a ligação.
 *
 * ## 2026-09-29 — casca de `<Hemiciclo>` (spec 023, design § D5)
 *
 * A pintura do SVG (figure, svg, `<g>` por trecho, figcaption) subiu para
 * `components/blocks/Hemiciclo.tsx`, que o hemiciclo do Senado também usa. O
 * que é da Câmara ficou aqui: a fila de cadeiras (`assentosDaBancada`), os três
 * estados, a pintura de cada um, o título, o `<desc>` e a legenda. **A saída é
 * byte a byte a de antes** — retrato em
 * `tests/fixtures/hemiciclo/camara-retrato.json`, tirado antes da extração, e
 * comparado por `tests/unit/components/camara-hemiciclo-retrato.test.tsx`.
 */

import type { CSSProperties } from "react";

import {
  agruparEmTrechos,
  CINZA_ASSENTO,
  CONTORNO_NEUTRO,
  Hemiciclo,
  type TrechoHemiciclo,
} from "@/components/blocks/Hemiciclo";
import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { ordenarBancada } from "@/lib/utils/bancada";
import { layoutHemiciclo } from "@/lib/utils/hemiciclo";
import { textForParty } from "@/lib/utils/party-color";

// ---------------------------------------------------------------------------
// Derivações puras
// ---------------------------------------------------------------------------

export type EstadoAssento = "definida" | "indefinida" | "nao_atribuida";

/** Uma cadeira antes de ganhar posição: quem a está ganhando, e com que firmeza. */
export interface AssentoPintado {
  estado: EstadoAssento;
  /** `null` em `nao_atribuida` — não há agremiação a nomear. */
  cod: string | null;
  sigla: string | null;
  /** Sigla que define a COR (ADR-0024). Em partido isolado é a própria sigla. */
  siglaLider: string | null;
}

/**
 * A fila de cadeiras, na ordem em que elas serão pintadas da esquerda para a
 * direita, com **exatamente** `total_cadeiras` elementos.
 *
 * 🔴 O resto cinza sai de `total − Σ cadeiras`, e não de
 * `total − cadeiras_atribuidas`. Nas duas leituras o número é o mesmo quando o
 * payload é coerente (RF-125.1 exige que seja), e a diferença só aparece no
 * dia em que ele não for: derivar da soma real garante que o desenho continue
 * com `total` bolinhas em vez de estourar ou faltar em silêncio. O truncamento
 * e o preenchimento no fim são a mesma defesa, para o outro lado.
 */
export function assentosDaBancada(bancada: EdgeBancadaNacional): AssentoPintado[] {
  const total = Math.max(0, Math.trunc(bancada.total_cadeiras));
  const fila: AssentoPintado[] = [];

  for (const agr of ordenarBancada(bancada.por_agremiacao)) {
    const cadeiras = Math.max(0, Math.trunc(agr.cadeiras));
    if (cadeiras === 0) continue;
    // `cadeiras_indefinidas` nunca pode exceder as cadeiras da agremiação — se
    // exceder, o excesso não vira cadeira de outro, vira indefinida dela.
    const indefinidas = Math.min(cadeiras, Math.max(0, Math.trunc(agr.cadeiras_indefinidas ?? 0)));
    const comum = { cod: agr.cod, sigla: agr.sigla, siglaLider: agr.sigla_lider };

    for (let i = 0; i < cadeiras - indefinidas; i++) fila.push({ estado: "definida", ...comum });
    for (let i = 0; i < indefinidas; i++) fila.push({ estado: "indefinida", ...comum });
  }

  const vazio: AssentoPintado = {
    estado: "nao_atribuida",
    cod: null,
    sigla: null,
    siglaLider: null,
  };
  while (fila.length < total) fila.push(vazio);
  return fila.slice(0, total);
}

// ---------------------------------------------------------------------------
// Pintura
// ---------------------------------------------------------------------------

/**
 * Cinza de fundo das cadeiras que ainda não são de ninguém, ou não são firmes.
 * O token e o anel neutro (`CONTORNO_NEUTRO`) moram em `Hemiciclo.tsx` desde a
 * spec 023, porque o Senado usa os mesmos dois.
 */
const CINZA = CINZA_ASSENTO;

/**
 * 🔴 **Decisão do dono, 2026-09-18 — fechada, não reabrir.**
 *
 * A cadeira **indefinida** fica cinza com **anel na cor da agremiação**. Os dois
 * lados foram apresentados ao dono, inclusive o de que o cinza chapado seria
 * mais fiel à frase original dele ("só pintar o que já está definido") e que o
 * anel custa um desenho um pouco menos limpo. Ele escolheu o anel sabendo disso.
 *
 * O argumento: a cadeira indefinida **não é de ninguém — ela já é de alguém**. O
 * modelo a atribuiu a uma agremiação; o que está apertado é a margem da rodada
 * de sobra que a decidiu. Pintá-la de cinza chapado descartaria informação que
 * existe, e é justamente a informação que RF-127 manda tornar legível — "não uma
 * cadeira atribuída com falsa firmeza"
 * (`docs/specs/017-deputado-federal/spec.md:219-227`). O anel diz as duas
 * coisas ao mesmo tempo: **de quem ela é hoje** e **que ela não está firme**.
 *
 * O cinza chapado fica reservado para a cadeira **vaga** — a que não pertence a
 * agremiação nenhuma porque a UF ainda não apurou. Essa sim é a decisão original
 * do dono, e ela continua valendo inteira (ver `CONTORNO_NEUTRO`).
 *
 * A constante fica por legibilidade — o `pinturaDe` abaixo lê melhor com o nome
 * do que com um ternário mudo —, não porque a escolha esteja em aberto.
 */
const ANEL_DA_AGREMIACAO_NA_INDEFINIDA = true;

interface Pintura {
  fill: string;
  stroke: string;
}

function pinturaDe(a: AssentoPintado): Pintura {
  if (a.estado === "definida") {
    const cor = textForParty(a.siglaLider);
    return { fill: cor, stroke: cor };
  }
  if (a.estado === "indefinida") {
    return {
      fill: CINZA,
      stroke: ANEL_DA_AGREMIACAO_NA_INDEFINIDA ? textForParty(a.siglaLider) : CONTORNO_NEUTRO,
    };
  }
  return { fill: CINZA, stroke: CONTORNO_NEUTRO };
}

/**
 * Um `<g>` por bloco contíguo de cadeiras da mesma agremiação no mesmo estado.
 * `data-cod`/`data-sigla` saem nessa ordem, depois de `data-estado` — é a
 * ordem do markup retratado antes da extração.
 */
function trechosDe(fila: readonly AssentoPintado[]): TrechoHemiciclo[] {
  return agruparEmTrechos(
    fila,
    (anterior, atual) => anterior.cod === atual.cod && anterior.estado === atual.estado,
    (a, inicio) => {
      const { fill, stroke } = pinturaDe(a);
      return {
        chave: `${a.estado}-${a.cod ?? "sem-dono"}-${inicio}`,
        estado: a.estado,
        fill,
        stroke,
        dados: { "data-cod": a.cod ?? undefined, "data-sigla": a.sigla ?? undefined },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface CamaraHemicicloProps {
  bancada: EdgeBancadaNacional;
  /**
   * `id` do equivalente textual — a lista de agremiações da página. Vira parte
   * do `aria-describedby` do SVG (constituição § 4). O alvo precisa **existir**
   * no documento; um `aria-describedby` apontando para o nada é pior que
   * nenhum, porque parece resolvido.
   */
  descritoPorId?: string;
  /** Prefixo dos `id` internos, para duas instâncias não colidirem. */
  idPrefixo?: string;
  className?: string;
  style?: CSSProperties;
}

export function CamaraHemiciclo({
  bancada,
  descritoPorId,
  idPrefixo = "camara-hemiciclo",
  className,
  style,
}: CamaraHemicicloProps) {
  const fila = assentosDaBancada(bancada);
  const layout = layoutHemiciclo(fila.length);
  const trechos = trechosDe(fila);

  const indefinidas = fila.filter((a) => a.estado === "indefinida").length;
  const semDono = fila.filter((a) => a.estado === "nao_atribuida").length;

  // Sem cadeira publicada não há desenho a fazer — e um plenário de tamanho
  // inventado para preencher o espaço seria número escrito à mão (§ D8).
  if (layout.total === 0) return null;

  const porTamanho = ordenarBancada(bancada.por_agremiacao)
    .filter((a) => a.cadeiras > 0)
    .map((a) => `${a.sigla} ${a.cadeiras}`)
    .join(", ");

  return (
    <Hemiciclo
      layout={layout}
      trechos={trechos}
      titulo={`Plenário de ${layout.total} cadeiras, uma bolinha por cadeira`}
      descricao={
        `${porTamanho || "Nenhuma cadeira atribuída ainda"}.` +
        (indefinidas > 0 ? ` ${indefinidas} cadeiras ainda indefinidas.` : "") +
        (semDono > 0 ? ` ${semDono} cadeiras ainda sem dono.` : "") +
        " A ordem das cadeiras repete a ordem da lista abaixo — maior bancada primeiro — e" +
        " não representa posição ideológica."
      }
      descritoPorId={descritoPorId}
      idPrefixo={idPrefixo}
      testId="camara-hemiciclo"
      legendaTestId="camara-hemiciclo-legenda"
      className={className}
      style={style}
      legenda={
        <>
          Cada bolinha é uma cadeira, pintada pela agremiação que a está ganhando com os votos já
          contados. As cadeiras estão na mesma ordem da lista abaixo — maior bancada primeiro —, que
          não é posição ideológica.{" "}
          {indefinidas > 0 ? (
            <span data-testid="camara-hemiciclo-indefinidas">
              {indefinidas === 1
                ? "1 cadeira aparece cinza com anel colorido"
                : `${indefinidas} cadeiras aparecem cinzas com anel colorido`}
              : foram decididas em rodada de sobra, por margem apertada, e ainda podem mudar de mão.{" "}
            </span>
          ) : null}
          {semDono > 0 ? (
            <span data-testid="camara-hemiciclo-sem-dono">
              {semDono === 1
                ? "1 cadeira está cinza sem anel colorido"
                : `${semDono} cadeiras estão cinzas sem anel colorido`}
              : ainda não há apuração suficiente para dizer de quem são.
            </span>
          ) : null}
        </>
      }
    />
  );
}
