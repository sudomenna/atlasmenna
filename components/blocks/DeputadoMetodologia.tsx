/**
 * components/blocks/DeputadoMetodologia.tsx
 *
 * O bloco de metodologia das duas telas de Deputado Federal (spec 017) — e por
 * que ele não é o `<ForecastTransparency>` que as outras três rotas usam.
 *
 * ## O que o componente compartilhado afirmaria de errado
 *
 * `<ForecastTransparency>` desenha duas barras, "Modelo" e "Apuração", com
 * `pctModel = 100 − pctApurado` (`components/blocks/ForecastTransparency.tsx`).
 * Com 71,4% apurado ele imprime **"Modelo 28,6%"**. No cargo 6 isso é falso, e
 * não por arredondamento: o design 017 § D10 fixa
 * `composition = {pre_election: 0, model: 0, actual_results: 1}` porque, hoje,
 * o número de cadeiras é a aritmética do ADR-0027 sobre o voto **já contado** —
 * não há prior, não há extrapolação, não há modelo (§ D9). A tela estaria
 * atribuindo 28,6% do resultado a um modelo que não rodou.
 *
 * O mesmo componente rotula a seção "O que está movendo o forecast" e afirma
 * "Esta projeção é feita no nível do estado". As duas frases são verdadeiras
 * nas outras rotas e falsas nesta. Editá-lo para servir aos dois casos
 * ampliaria o alcance da mudança para Presidente, Governador e Senador, que já
 * estão no ar; este bloco resolve sem tocar em nada que já funciona.
 *
 * ## O que continua sendo dito, porque é verdade
 *
 * Constituição § 8 pede que o leitor saiba de onde vem o número. Aqui: que
 * **não é projeção** (§ D9 é literal — "a tela não pode chamar isso de
 * projeção"), o percentual apurado **quando ele foi medido** (`temDado`), o
 * que a faixa de cadeiras mede — e o que ela **não** mede — e a cadência.
 *
 * ⚠️ **2026-09-13.** Este parágrafo afirmava a granularidade de UF sem
 * condição ("lemos o boletim que o TSE publica por estado, e não os de cada
 * zona eleitoral... e por isso não há mapa de municípios aqui"). O ADR-0036
 * inverteu o fato e a frase virou falsa **na tela**, não num comentário. A
 * granularidade agora entra por `temIntervalo`, derivada do payload. A
 * justificativa do mapa foi **removida, não reescrita**: com dado de zona a
 * razão deixou de existir, e a ausência do mapa não precisa de desculpa — uma
 * razão falsa é pior que nenhuma.
 *
 * A cadência vem do payload (`atualizacao_min`, RF-128 / § D8), nunca de
 * literal. `cadenciaMinutos = 0` significa "não sabemos" — sem payload não há
 * cadência declarada — e o bloco **cala** sobre ela em vez de inventar um
 * número.
 *
 * ## 2026-09-29 — a projeção de deputado existe (spec 026, ADR-0063)
 *
 * O D9 do design 017 caiu: ao lado da parcial passa a existir a projeção, com
 * trava de 25% e interruptor. Este bloco vira o bloco do § 8 da constituição
 * para o cargo 6 — **método, valores da trava, estado do interruptor e
 * limitações** — e, com a projeção liberada na UF, o "o que está movendo a
 * projeção", que diz a fração de eleitorado estimada e as agremiações cuja
 * cadeira projetada difere da parcial, e nada mais (RF-266).
 *
 * A frase "não são uma projeção" **fica**, agora sobre a PARCIAL — que continua
 * não sendo projeção. E o ramo sem dado (`temDado = false`) fica **byte a
 * byte** como era: sem payload não há estado de projeção a relatar, e
 * `tests/unit/pages/fase-pre-eleicao.test.tsx` conta as palavras desse ramo.
 *
 * Server Component puro: zero estado, zero evento, zero JS novo no bundle.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import {
  projecaoVisivel as ehProjecaoVisivel,
  fraseEstadoProjecao,
  type ProjecaoUfParaTexto,
  ZONAS_MINIMAS_PROJECAO,
} from "@/lib/utils/deputado-marcas";
import { formatPercent, formatPercentTrim } from "@/lib/utils/format";

/** Uma agremiação cuja cadeira projetada difere da parcial — o "o que está movendo". */
export interface AgremiacaoMovendo {
  sigla: string;
  parcial: number;
  projetada: number;
}

/**
 * O piso da trava quando o payload não o traz (tela nacional sem nenhuma UF
 * com estado publicado). É o piso do ADR-0063 D4 — a chave do interruptor só
 * pode SUBIR este número, nunca baixar.
 */
const PCT_MINIMO_PADRAO = 25;

export interface DeputadoMetodologiaProps {
  /** Percentual apurado da abrangência (0–100). */
  pctApurado: number;
  /**
   * Minutos entre atualizações, vindo de `EdgePayloadDeputado.atualizacao_min`.
   * `0` (ou ausente) ⇒ nenhuma frase de cadência.
   */
  cadenciaMinutos: number;
  /**
   * `true` quando o payload trouxe faixa de cadeiras (`cadeiras_ci95`) — o que
   * só acontece quando há zonas de verdade para reamostrar.
   *
   * **Por que é uma prop derivada do payload e não uma frase fixa**: até
   * 2026-09-13 este bloco afirmava, sem condição, que "lemos o boletim que o
   * TSE publica por estado, e não os de cada zona eleitoral". O ADR-0036 virou
   * essa chave e a frase virou **falsa na tela do leitor** — e o componente,
   * que nenhum dos commits daquela madrugada tocou, seguiu afirmando. É a
   * mesma classe de defeito que quebrou a tela de Senador em 11/09: prosa que
   * fica para trás do dado.
   *
   * A presença da faixa é o sinal observável certo, e não um `granularidade`
   * próprio, porque ela acompanha sozinha o interruptor de emergência
   * (`TSE_DEPUTADO_GRANULARIDADE=uf`): sem zonas não há faixa, e o texto volta
   * a dizer a verdade sem ninguém lembrar de mudá-lo. Mesmo padrão que
   * `<ForecastTransparency>` já usa para a frase equivalente.
   */
  temIntervalo?: boolean;
  /**
   * `false` quando ainda não há payload nenhum — a tela está em "aguardando o
   * primeiro boletim".
   *
   * ⚠️ **Nasceu de um defeito publicado em 2026-09-13.** A primeira versão
   * desta prop tinha só dois ramos: com faixa e sem faixa. O estado "sem dado
   * algum" caía no segundo e a tela afirmava, em produção, "lemos o boletim
   * que o TSE publica por estado" — falso: não líamos nada ainda. Eram três
   * estados, não dois. Sem payload o bloco **cala** sobre granularidade, pela
   * mesma razão que já calava sobre cadência (`cadenciaMinutos = 0`): não
   * inventar o que não se sabe.
   *
   * ⚠️ **Emenda de 2026-09-14 — passou a calar também sobre o PERCENTUAL.**
   * A frase "Com {@link DeputadoMetodologiaProps.pctApurado}% apurado, ela
   * ainda muda" continuava sendo impressa neste estado, e o `0` que o chamador
   * passava por falta de coisa melhor virava "Com 0% apurado" na tela — um
   * número que ninguém mediu, na única frase deste bloco que tem número.
   */
  temDado?: boolean;
  /** `"uf"` troca o título e liga o bloco por UF; o método é o mesmo. */
  variant?: "national" | "uf";
  /**
   * Spec 026 — o interruptor lido NO RENDER (`readInterruptorProjecao`).
   * Ausente ⇒ desligado (falha fechada, RF-265).
   */
  interruptorLigado?: boolean;
  /**
   * De onde veio o "desligado" (`InterruptorProjecaoLido.origem`): `chave` /
   * `ausente` ⇒ desligada pela operação; `invalida` / `falha` ⇒ não foi possível
   * ler o interruptor, e ela fica desligada por segurança (ADR-0063 D4 pede as
   * duas frases distintas). Ausente ⇒ tratado como `ausente`.
   */
  interruptorOrigem?: "chave" | "ausente" | "invalida" | "falha";
  /** UF: o `projecao` do objeto da UF (design § 2.7). Ausente no objeto v1. */
  projecao?: ProjecaoUfParaTexto | null;
  /** UF: sigla do estado, para as frases da trava. */
  uf?: string;
  /**
   * UF, com a projeção visível: as agremiações cuja cadeira projetada difere
   * da parcial, na ordem das agremiações da página. `[]` ⇒ "nenhuma difere".
   */
  movendo?: readonly AgremiacaoMovendo[];
  /** Nacional: o `pct_minimo` publicado (o de qualquer UF — é o mesmo). Ausente ⇒ 25. */
  pctMinimo?: number;
}

export function DeputadoMetodologia({
  pctApurado,
  cadenciaMinutos,
  temIntervalo = false,
  temDado = true,
  variant = "national",
  interruptorLigado = false,
  interruptorOrigem = "ausente",
  projecao = null,
  uf,
  movendo,
  pctMinimo,
}: DeputadoMetodologiaProps) {
  const visivel = variant === "uf" && ehProjecaoVisivel(projecao, interruptorLigado);
  const piso = projecao?.pct_minimo ?? pctMinimo ?? PCT_MINIMO_PADRAO;
  return (
    <Panel
      kicker="Metodologia"
      title={variant === "uf" ? "Como esta conta é feita" : "Como esta contagem é feita"}
      titleId="metodologia-heading"
    >
      <div
        data-testid="dep-metodologia"
        className="flex flex-col"
        style={{ gap: "var(--space-3)" }}
      >
        <p className="max-w-prose" style={PARAGRAFO}>
          {temDado ? "Os números da parcial" : "Estes números"}{" "}
          <strong>não são uma projeção</strong>. São a distribuição de cadeiras pelas regras do
          Código Eleitoral aplicada aos votos <strong>já apurados</strong> — a resposta para "como
          ficaria a bancada se a contagem parasse agora".{" "}
          {/* 🔴 2026-09-14 — a frase "Com 0% apurado, ela ainda muda" SAIU do
            estado sem dado. Ela é a única deste bloco que carrega um NÚMERO, e
            sem payload esse número não foi medido: não sabemos se a apuração
            está em zero ou se a leitura do Global Config falhou com a contagem
            em curso. É a mesma classe de zero fabricado que saiu de
            `/governador`, de `/senador` e do bloco de transparência da home.

            O resto do parágrafo FICA, e a diferença é real: "não são uma
            projeção" e "votos já apurados" descrevem o MÉTODO desta tela, que
            é verdadeiro em qualquer dia do calendário; o percentual descrevia
            um ESTADO, e o estado é o que não medimos. */}
          {temDado ? <>Com {formatPercent(pctApurado)} apurado, ela ainda muda. </> : null}
          {!temDado ? null : temIntervalo ? (
            <>
              O intervalo ao lado de cada bancada mede o quanto o número balança entre as zonas
              eleitorais <strong>já apuradas</strong>: sorteamos mil combinações delas e refazemos a
              conta em cada uma. Ele não adivinha o voto que ainda falta chegar — isso é o que as
              cadeiras marcadas como indefinidas ("sobra apertada") apontam.
            </>
          ) : (
            <>
              Neste momento lemos o boletim que o TSE publica por estado, e não os de cada zona
              eleitoral — e sem as zonas não há como medir o quanto o número balança, por isso não
              há intervalo ao lado das bancadas.
            </>
          )}
          {cadenciaMinutos > 0 ? (
            <>
              {" "}
              Os números são atualizados a cada {cadenciaMinutos}{" "}
              {cadenciaMinutos === 1 ? "minuto" : "minutos"}.
            </>
          ) : null}
        </p>

        {/* Spec 026 — só com dado: sem payload não há trava nem interruptor a
          relatar, e o ramo sem dado é contado palavra a palavra em
          `fase-pre-eleicao.test.tsx`. */}
        {temDado ? (
          <p className="max-w-prose" style={PARAGRAFO} data-testid="dep-metodologia-projecao">
            <strong>A projeção, que é não oficial, é outra conta.</strong> Estimamos o voto final de
            cada candidato e de cada legenda zona a zona: a zona que já tem boletim é esticada até o
            tamanho do seu eleitorado; a zona sem boletim recebe o voto das zonas apuradas de
            tamanho parecido. Sobre esse voto estimado aplicamos a mesma distribuição de cadeiras da
            parcial. Ela só aparece num estado com {formatPercentTrim(piso)} do eleitorado apurado,
            ao menos {ZONAS_MINIMAS_PROJECAO} zonas com boletim, as cadeiras do estado publicadas
            pelo TSE e o eleitorado das zonas que lemos fechando com o do TSE. A ordem das listas
            nunca muda por causa dela: é sempre a do voto apurado.{" "}
            {interruptorLigado
              ? "A projeção está ligada no site; em cada estado, só aparece quando essas condições se cumprem."
              : interruptorOrigem === "invalida" || interruptorOrigem === "falha"
                ? "Neste momento não foi possível ler o interruptor da projeção, e por segurança ela fica desligada: nenhuma marca nem número dela aparece."
                : "Neste momento a projeção está desligada no site: nenhuma marca nem número dela aparece, qualquer que seja a apuração."}
            {variant === "uf" && interruptorLigado && projecao && uf ? (
              <>
                {" "}
                Em {uf}: {formatPercent(pctApurado)} do eleitorado apurado e{" "}
                {projecao.zonas_apuradas} de {projecao.zonas_total} zonas com boletim.{" "}
                {fraseEstadoProjecao(projecao, pctApurado)}
              </>
            ) : null}
            {variant === "national" ? (
              <>
                {" "}
                Ela existe por estado: não somamos projeções numa bancada nacional, porque juntar
                estados com a projeção liberada e estados que ainda aguardam daria um número sem
                nome.
              </>
            ) : null}
          </p>
        ) : null}

        {/* RF-266 / constituição § 8 — "o que está movendo", só com a projeção
          VISÍVEL (estado liberada E interruptor ligado). Diz a fração de
          eleitorado estimada e as agremiações cuja cadeira projetada difere
          da parcial — e nada mais. */}
        {visivel && projecao ? (
          <section aria-labelledby="dep-movendo-heading" data-testid="dep-movendo">
            <h3
              id="dep-movendo-heading"
              style={{ margin: "0 0 var(--space-1)", font: "var(--type-label)", fontWeight: 600 }}
            >
              O que está movendo a projeção · não oficial
            </h3>
            <p className="max-w-prose" style={PARAGRAFO}>
              {formatPercent(Math.max(0, 100 - pctApurado))} do eleitorado de {uf ?? "este estado"}{" "}
              ainda não foi apurado, e o voto dele entra por estimativa
              {projecao.zonas_total > projecao.zonas_apuradas
                ? ` — imputado nas ${projecao.zonas_total - projecao.zonas_apuradas} zonas sem boletim`
                : ""}
              .{" "}
              {movendo && movendo.length > 0 ? (
                <>
                  Onde a projeção difere da parcial:{" "}
                  {movendo
                    .map(
                      (m) =>
                        `${m.sigla}, ${m.parcial} ${m.parcial === 1 ? "cadeira" : "cadeiras"} na parcial e ${m.projetada} na projeção`,
                    )
                    .join("; ")}
                  .
                </>
              ) : (
                "A projeção dá a cada agremiação as mesmas cadeiras da parcial."
              )}
            </p>
          </section>
        ) : null}

        {temDado ? (
          <p className="max-w-prose" style={PARAGRAFO} data-testid="dep-metodologia-limites">
            <strong>O limite que mais pesa é o voto de reduto.</strong> A estimativa só enxerga o
            tamanho da zona, não o lugar: um candidato forte numa região que ainda não apurou fica
            subestimado. É por isso que a projeção é não oficial e marca como "apertada" a vaga que
            ainda pode mudar de mão. O método completo está em{" "}
            <a href="/sobre-o-modelo#sec-cadeiras" style={{ color: "inherit" }}>
              Sobre o modelo
            </a>
            .
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

const PARAGRAFO: React.CSSProperties = {
  margin: 0,
  font: "var(--type-body-sm)",
  color: "var(--text-secondary)",
  textWrap: "pretty",
};
