/**
 * components/blocks/ForecastTransparency.tsx
 *
 * Bloco "O que está movendo o forecast" — exigência constitucional § 8
 * ("Bloco 'O que está movendo o forecast' presente em toda página com
 * projeção") e RF-043 das specs 003 (home) e 004 (página de UF).
 *
 * Renderiza, de forma puramente presentacional, a composição do forecast em
 * dois eixos:
 *   - Modelo:    contribuição da extrapolação do apurado / bootstrap (= 100 - pctApurado)
 *   - Apuração:  contribuição dos dados reais do TSE no momento (= pctApurado)
 *
 * Antes de qualquer apuração: barra Modelo cheia (100%) e Apuração zerada.
 * Conforme as urnas chegam: Modelo encolhe enquanto Apuração cresce, até
 * inverter por completo no fim da apuração.
 *
 * Server Component — sem state, sem hooks, sem 'use client'. Renderização
 * determinística do prop `pctApurado` (transparência metodológica § 8).
 *
 * Cores:
 *   - Apuração → `--color-success` (verde discreto, "dado real")
 *   - Modelo   → `--color-text-muted` (cinza médio, "estimativa")
 *   NUNCA cores partidárias (constituição § 2).
 *
 * A11y (RNF-022, RNF-024, RNF-025, RNF-026):
 *   - Cada barra tem role="meter" + aria-valuemin/max/now e aria-label
 *     descrevendo o que ela representa.
 *   - Cabeçalho é <h3> → screen readers anunciam como heading.
 *   - Nenhuma animação default → respeita reduced-motion por construção.
 */

import type { CSSProperties } from "react";

import type { VarianteFasePreEleicao } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import { formatPercentTrim } from "@/lib/utils/format";

export interface ForecastTransparencyProps {
  /** Percentual apurado da corrida (0–100). Vem de `EdgePayload.pct_apurado_total`. */
  pctApurado: number;
  /**
   * Variante de rótulo:
   *   - 'national' (default) → "O que está movendo o forecast"
   *   - 'uf'                 → "O que está movendo o forecast estadual"
   */
  variant?: "national" | "uf";
  /**
   * RF-108 (spec 016) — em que unidade a regra de três rodou, vindo de
   * `EdgePayloadUf.granularidade` / `metodo.granularidade`.
   *
   * `"zona"` é o caso de Presidente e Governador, e o bloco não diz nada
   * (é a granularidade que o leitor já supõe quando vê um mapa municipal).
   * `"uf"` é Senador e Deputado Federal: ali a projeção nasce de **um**
   * boletim agregado por estado, e omitir isso deixaria o leitor concluir
   * que a corrida tem a mesma resolução das outras duas. A constituição § 8
   * não pede só "explique o método" — pede que a explicação corresponda ao
   * método que de fato rodou.
   */
  granularidade?: "uf" | "zona";
  /**
   * RF-108 / ADR-0026 item 5 — de quantos em quantos minutos esta corrida é
   * atualizada. Senador é 5 (contra 1 de Presidente/Governador). Omitido ⇒
   * nenhuma frase de cadência, que é melhor do que uma frase genérica.
   */
  cadenciaMinutos?: number;
  /**
   * **RF-158 (spec 019)** — fase pré-eleição: o bloco FICA, a medição sai.
   *
   * Pela regra do design 019 § D0 ("mede ⇒ cala") este bloco sumiria: ele
   * decompõe o forecast, e decompor é medir. **Ele não some**, e a razão é
   * hierárquica, não estética — a constituição
   * [§ 8](../../docs/constitution.md#8-transparência-metodológica) exige "Bloco
   * 'O que está movendo o forecast' presente em toda página com projeção", e
   * princípio constitucional está acima de regra de design de uma spec. É a
   * única das nove superfícies da tabela de mentiras que **não** pode sumir.
   *
   * A saída é a que a própria regra permite: as duas barras e os dois
   * percentuais saem, e no lugar entra um parágrafo no **futuro**, dizendo o
   * que este bloco vai mostrar quando houver voto. Em fase pré as duas frações
   * somariam 100% de coisa nenhuma.
   *
   * A palavra "projeção" aqui é a **exceção registrada e única** do RF-161: na
   * fase pré ela não ocorre em mais nenhum lugar das quatro telas, e a métrica
   * de aceitação da spec é medida sobre o HTML com este bloco descontado.
   *
   * ⚠️ **Emenda de 2026-09-14 — o nome ficou mais estreito que o que a prop
   * faz.** Ela liga o ramo de prosa, e o ramo de prosa serve aos **dois**
   * estados em que não há medição a decompor: "a eleição não começou" (payload
   * semeado) e "não sabemos" (nenhum payload). Qual dos dois é dito sai de
   * {@link ForecastTransparencyProps.variante}. O nome não foi trocado porque
   * ele é o mesmo sinal que `<RaceTypeIndicator>`, `<NationalMapBlock>` e o
   * mapa nacional recebem, e cinco call sites com a mesma palavra valem mais
   * que um nome perfeito num só.
   */
  preEleicao?: boolean;
  /**
   * 🔴 **Qual das duas prosas, e por que a escolha é do CHAMADOR.**
   *
   * Mesmo union e mesma regra de `<FasePreEleicaoBanner>`, de propósito: as
   * duas superfícies falam do mesmo estado na mesma tela, e um vocabulário só
   * evita que uma diga "ainda não começou" enquanto a outra diz "não
   * recebemos nada".
   *
   * | valor | quando | o que a prosa pode afirmar |
   * |---|---|---|
   * | `"nao_comecou"` (default) | o payload semeado TRAZ o campo de fase | "Nenhum voto foi contado ainda" — é um fato medido e gravado por quem semeou |
   * | `"sem_dados"` | não veio payload nenhum — ausente **ou** falha de leitura | só o que sabemos de nós: esta página não recebeu dado. **Nunca** a causa. |
   *
   * A frase do primeiro ramo, dita às 21h de 04/10 durante uma queda do Global
   * Config, é falsa com toda a autoridade da marca. Por isso o segundo ramo
   * existe, e por isso a escolha não é inferida aqui: quem sabe em que estado
   * está é quem tentou ler o Global Config (design 019 § D5, RNF-010).
   *
   * ⚠️ Passar `variante` **sem** `preEleicao` também liga a prosa. É
   * deliberado e erra para o lado do silêncio: um chamador que escolheu a
   * redação do estado sem medição não quer a decomposição numérica, e a
   * alternativa — cair na barra "Apuração 0%" porque faltou um booleano — é
   * exatamente o default silencioso que esta spec inteira existe para fechar.
   */
  variante?: VarianteFasePreEleicao;
  /** Classes adicionais para o container externo. */
  className?: string;
}

/**
 * Normaliza o número para o intervalo [0, 100]. O EdgePayload já entrega em
 * [0, 100] por contrato (lib/edge-config/types.ts § "pct_apurado_total"),
 * mas defendemos a borda — `NaN`, negativos e overflow viram 0 ou 100.
 */
function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

interface BarRowProps {
  label: string;
  pct: number;
  color: string;
  ariaLabel: string;
}

function BarRow({ label, pct, color, ariaLabel }: BarRowProps) {
  const trackStyle: CSSProperties = {
    backgroundColor: "var(--color-bg-muted)",
    borderColor: "var(--color-border)",
  };
  const fillStyle: CSSProperties = {
    width: `${pct}%`,
    backgroundColor: color,
  };
  return (
    <div className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3">
      <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      {/*
       * Meter custom: o `<meter>` nativo do HTML não é estilizável o
       * suficiente para a barra NYT-style (cores via tokens, largura
       * controlada). Mantemos `role="meter"` num <div> e expomos
       * aria-valuemin/max/now + aria-label — o leitor de tela anuncia
       * idêntico ao elemento nativo (RNF-022, RNF-024).
       */}
      {/* biome-ignore lint/a11y/useSemanticElements: meter nativo não é estilizável o bastante. */}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={ariaLabel}
        className="relative h-3 w-full overflow-hidden rounded-sm border"
        style={trackStyle}
      >
        <div className="h-full" style={fillStyle} />
      </div>
      <span
        className="text-right text-sm font-medium tabular-nums"
        style={{ color: "var(--color-text)" }}
      >
        {formatPercentTrim(pct)}
      </span>
    </div>
  );
}

export function ForecastTransparency({
  pctApurado,
  variant = "national",
  granularidade,
  cadenciaMinutos,
  preEleicao = false,
  variante,
  className,
}: ForecastTransparencyProps) {
  const pctReal = clampPercent(pctApurado);
  const pctModel = 100 - pctReal;
  // 1º turno encerrado: a ingestão parou — não há cadência a anunciar.
  const cadenciaAnunciada = cadenciaMinutos && !primeiroTurnoEncerrado() ? cadenciaMinutos : 0;

  const heading =
    variant === "uf" ? "O que está movendo o forecast estadual" : "O que está movendo o forecast";

  const containerClass = ["w-full max-w-[480px]", className].filter(Boolean).join(" ");

  // RF-158 — o bloco fica, a medição sai. Mesmo `<section>`, mesmo `<h3>`, mesmo
  // `id`: a navegação por headings não muda de forma conforme a fase, e o
  // teste do RF-158 afere PRESENÇA do bloco e AUSÊNCIA de fração/barra/
  // percentual, não a troca de um componente por outro.
  //
  // `variante` sozinha também entra aqui — ver o docstring da prop: faltar o
  // booleano não pode ser o caminho de volta para "Apuração 0%".
  if (preEleicao || variante !== undefined) {
    const semDados = variante === "sem_dados";
    return (
      <section aria-labelledby="forecast-transparency-heading" className={containerClass}>
        <h3
          id="forecast-transparency-heading"
          className="mb-3 text-lg"
          style={{ fontFamily: "var(--font-serif)", color: "var(--color-text)" }}
        >
          {heading}
        </h3>
        <p
          className="max-w-prose text-sm"
          data-testid="forecast-transparency-pre"
          data-variante={semDados ? "sem_dados" : "nao_comecou"}
          style={{ margin: 0, color: "var(--color-text-muted)" }}
        >
          {semDados ? (
            /* 🔴 A oração final é a única diferença entre as duas redações, e é
               a diferença inteira: aqui ela fala de NÓS ("esta página não
               recebeu dado nenhum"), lá ela fala do MUNDO ("nenhum voto foi
               contado ainda"). Este ramo é alcançado tanto antes de 04/10
               quanto durante uma queda do Global Config às 21h — e a frase do
               outro ramo, dita naquele minuto, é falsa. Nenhuma conjunção
               causal liga as duas frases: a segunda não explica a primeira. */
            <>
              Quando os primeiros boletins chegarem a esta página, esta caixa vai mostrar quanto da
              projeção vem do que o TSE já contou e quanto ainda vem do modelo — a proporção muda a
              cada atualização, e ao fim da noite o que o TSE contou responde por tudo. Enquanto
              esta página não receber dado nenhum, não há nada a decompor aqui, e nenhum número
              desta caixa mede a corrida.
            </>
          ) : (
            <>
              Quando os primeiros boletins chegarem, esta caixa vai mostrar quanto da projeção vem
              do que o TSE já contou e quanto ainda vem do modelo — a proporção muda a cada
              atualização, e ao fim da noite o que o TSE contou responde por tudo. Nenhum voto foi
              contado ainda, então não há nada a decompor aqui.
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="forecast-transparency-heading" className={containerClass}>
      <h3
        id="forecast-transparency-heading"
        className="mb-3 text-lg"
        style={{ fontFamily: "var(--font-serif)", color: "var(--color-text)" }}
      >
        {heading}
      </h3>
      <div className="flex flex-col gap-2">
        <BarRow
          label="Modelo"
          pct={pctModel}
          color="var(--color-text-muted)"
          ariaLabel={`Modelo contribui ${formatPercentTrim(pctModel)}`}
        />
        <BarRow
          label="Apuração"
          pct={pctReal}
          color="var(--color-success)"
          ariaLabel={`Apuração contribui ${formatPercentTrim(pctReal)}`}
        />
      </div>
      {/* RF-108 — os dois fatos que o leitor não tem como inferir da tela:
          a resolução da projeção e a frequência com que ela muda. Texto,
          não tooltip: "legível sem clique" é literal na aceitação. */}
      {granularidade === "uf" || cadenciaAnunciada ? (
        <p
          data-testid="forecast-cadencia"
          className="mt-3 max-w-prose text-sm"
          style={{ margin: "var(--space-3) 0 0", color: "var(--color-text-muted)" }}
        >
          {granularidade === "uf"
            ? "Esta projeção é feita no nível do estado: para este cargo lemos o boletim agregado por unidade da federação, e não os de cada zona eleitoral — uma escolha nossa, para caber no limite de requisições que o TSE impõe. Por isso não há mapa de municípios aqui, e a projeção é menos fina que a de Presidente e Governador. "
            : null}
          {cadenciaAnunciada
            ? `Os números são atualizados a cada ${cadenciaMinutos} ${
                cadenciaMinutos === 1 ? "minuto" : "minutos"
              }.`
            : null}
        </p>
      ) : null}
    </section>
  );
}
