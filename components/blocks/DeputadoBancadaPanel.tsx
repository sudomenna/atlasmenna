/**
 * components/blocks/DeputadoBancadaPanel.tsx — spec 017 (RF-122, RF-125.1,
 * RF-127, RF-130); extraído na spec 027 (design § 8.4, RF-282).
 *
 * "Quem fica com as cadeiras": a barra da bancada (sem marcador — não existe
 * maioria a marcar numa corrida proporcional) e a lista textual de todas as
 * agremiações, com a linha das cadeiras ainda sem dono e a nota de método.
 *
 * Morava inline na capa federal (`app/(dep)/deputado-federal/page.tsx`). Saiu
 * para cá porque a capa das assembleias (`/deputado-estadual`) mostra o mesmo
 * painel sobre a SOMA das 27 casas — e duas cópias do mesmo painel seriam duas
 * regras de "aguardando" que divergiriam no primeiro ajuste. O JSX é o de
 * antes, linha por linha: a capa federal renderiza igual e os testes dela
 * passam sem edição (é o portão da extração).
 *
 * ## O que muda entre as duas capas, e só isto
 *
 *   - os textos que nomeiam a abrangência — o rótulo acessível da barra, a
 *     frase das cadeiras sem dono, a nota de método — entram por prop;
 *   - `mostrarFaixa`: a capa das assembleias NÃO mostra faixa de cadeiras. O
 *     intervalo de uma casa não se soma ao de outra (design 027 § 8.3); a
 *     incerteza que sobrevive à soma é a "sobra apertada"
 *     (`cadeiras_indefinidas`), e essa continua na linha de cada agremiação.
 *
 * ## "Aguardando" nunca negativo, nunca mascarado
 *
 * `aguardando = total − atribuídas`, com o `total` que o chamador passa (o
 * fixo da casa enquanto faltar UF — ADR-0049, spec 027 RF-280). Até 30/09 a
 * capa federal escrevia `Math.max(0, …)`: com o total derivado do dado do TSE
 * quando todas as UFs estão presentes, a diferença é ≥ 0 por construção — e,
 * se um produtor errado a fizesse negativa, o `max` a esconderia, fazendo a
 * tela afirmar "nenhuma cadeira aguardando" sobre uma soma que passa do total.
 * Aqui o negativo vira uma linha que diz o que aconteceu.
 *
 * ## As ilhas da capa federal (spec 026 RF-299 e RF-300, 04/10)
 *
 * Com `eleitosNacionais` (só a capa federal passa), cada agremiação ganha o
 * botão "Ver os eleitos" e, na base "Projeção", o cenário projetado nacional
 * ao lado da parcial — `BancadaEleitosNacional.tsx`. O HTML que o servidor
 * manda continua sendo a parcial: as ilhas só acrescentam no navegador.
 *
 * Server Component; zero JS sem `eleitosNacionais`.
 */

import type { ReactNode } from "react";
import { VoteBar, type VoteBarSegment } from "@/components/atoms/bars/VoteBar";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import type { EdgeAgremiacaoBancada } from "@/lib/edge-config/types";
import { ordenarBancada } from "@/lib/utils/bancada";
import { formatPercent, formatVotes } from "@/lib/utils/format";
import { colorForParty, textForParty } from "@/lib/utils/party-color";

import {
  BancadaLinhaNacional,
  BancadaNacionalContexto,
  BarraCenarioNacional,
  CenarioSemLinha,
} from "./BancadaEleitosNacional";
import estilosNacional from "./BancadaEleitosNacional.module.css";

export interface DeputadoBancadaPanelProps {
  kicker: string;
  title: string;
  titleId: string;
  /** As agremiações — o painel reaplica a ordem (`ordenarBancada`), não confia na recebida. */
  agremiacoes: readonly EdgeAgremiacaoBancada[];
  /** O total de cadeiras da abrangência (513 · 1.059 · Σ dos totais das casas). */
  total: number;
  /** Σ `cadeiras` já atribuídas. */
  atribuidas: number;
  /**
   * Como a barra se apresenta ao leitor de tela, antes da lista: "Bancada de
   * 513 cadeiras" · "Soma de 27 casas separadas, 1.059 cadeiras". O painel
   * acrescenta ", com os votos já apurados: PT 89, …".
   */
  rotuloBarra: string;
  /** O texto depois do número de cadeiras sem dono ("cadeiras ainda sem dono — …"). */
  fraseAguardando: ReactNode;
  /** A nota de método ao pé do painel (constituição § 8). */
  nota: ReactNode;
  /** Algo a dizer ANTES da barra, no mesmo painel (o aviso da soma de casas). */
  aviso?: ReactNode;
  /** Mostra a coluna da faixa de cadeiras (RF-127). Default `true` (a capa federal). */
  mostrarFaixa?: boolean;
  /**
   * Spec 026 RF-299 e RF-300 (ADR-0063, emenda de 04/10 (2)) — SÓ a capa
   * federal passa: liga as ilhas `<BancadaEleitosNacional>` (o botão "Ver os
   * eleitos" em cada agremiação e, na base "Projeção", o cenário projetado
   * nacional ao lado da parcial). `projecaoLigada` é o interruptor que a
   * PÁGINA leu agora (RF-265) — o segundo ponto de leitura: desligado, a ilha
   * ignora qualquer projeção que a rota traga. Ausente (a capa das
   * assembleias), o painel é o de antes, byte a byte.
   */
  eleitosNacionais?: {
    projecaoLigada: boolean;
    /**
     * O payload nacional já diz que alguma UF tem a projeção liberada — a
     * linha reserva, desde o servidor, o espaço do rótulo do cenário, para a
     * lista não "pular" quando a busca da rota terminar (CLS, 04/10).
     */
    cenarioEsperado?: boolean;
  };
  /**
   * Decisão do dono (04/10, dia do 1º turno) — a lista mostra só as
   * agremiações com cadeira na parcial (`cadeiras > 0`). Só a capa federal
   * liga; a das assembleias não muda sem decisão própria. A barra e a conta do
   * "aguardando" não mudam: quem tem zero já não tinha segmento. Na base
   * "Projeção", agremiação escondida aqui que tenha cadeira no cenário volta
   * ao fim da lista pela ilha (RF-300); a que tem parcial e cenário zero fica
   * visível, com o zero do cenário.
   */
  ocultarSemCadeira?: boolean;
}

/**
 * "PT, PCdoB e PV" — RF-122: a federação tem identidade própria, **e** os
 * partidos que a compõem precisam estar legíveis. Vazio quando é partido
 * isolado.
 */
function listarComponentes(componentes: readonly string[]): string {
  if (componentes.length === 0) return "";
  if (componentes.length === 1) return componentes[0] as string;
  return `${componentes.slice(0, -1).join(", ")} e ${componentes[componentes.length - 1]}`;
}

/**
 * Cor da agremiação — ADR-0024: token por sigla, **nunca** a cor oficial do
 * partido (constituição § 2). Um caminho só: `sigla_lider` já vale a própria
 * sigla em partido isolado. Sigla sem token cai em `--party-outros` dentro de
 * `colorForParty`. Histórico completo na capa federal.
 */
function corDaAgremiacao(agr: EdgeAgremiacaoBancada): string {
  return colorForParty(agr.sigla_lider);
}

/**
 * Cor como **marcador de identidade** (o ponto de 10×10): a variante `-text`,
 * que passa 3:1 nas 4 superfícies e nos 2 temas (RNF-035). Não é a mesma
 * função acima — o preenchimento com extensão (segmento do `<VoteBar>`) usa a
 * cor-base mais o traço da barra.
 */
function corIdentidadeDaAgremiacao(agr: EdgeAgremiacaoBancada): string {
  return textForParty(agr.sigla_lider);
}

/**
 * RF-127 — o texto da faixa de cadeiras. `lo === hi` desenha o ponto central:
 * uma faixa `[n, n]` afirmaria precisão que a amostra não sustenta.
 */
function intervaloDeCadeiras(agr: EdgeAgremiacaoBancada): string | null {
  const ci = agr.cadeiras_ci95;
  // 1º turno encerrado: a contagem é final — não há faixa a mostrar.
  if (!ci || primeiroTurnoEncerrado()) return null;
  const [lo, hi] = ci;
  return lo === hi ? `${lo}` : `${lo} a ${hi}`;
}

/**
 * Segmentos da barra: cada agremiação ocupa a fração do total que conquistou,
 * e o resto vira um segmento "aguardando" explícito — sem ele a barra
 * pareceria cheia com 463 de 513 cadeiras distribuídas.
 */
function segmentos(
  agremiacoes: readonly EdgeAgremiacaoBancada[],
  total: number,
  aguardando: number,
): VoteBarSegment[] {
  if (total <= 0) return [];
  const saida: VoteBarSegment[] = agremiacoes
    .filter((a) => a.cadeiras > 0)
    .map((a) => ({
      id: a.cod,
      // 🔴 Sigla inteira — exceção do dono para as capas de Deputados
      // (2026-09-19). `siglaExibicao` aqui abreviaria a tela que o dono mandou
      // não abreviar.
      label: a.sigla,
      pct: (a.cadeiras * 100) / total,
      color: corDaAgremiacao(a),
    }));
  if (aguardando > 0) {
    saida.push({
      id: "aguardando",
      label: "aguardando apuração",
      pct: (aguardando * 100) / total,
      color: "var(--surface-sunken)",
    });
  }
  return saida;
}

export function DeputadoBancadaPanel({
  kicker,
  title,
  titleId,
  agremiacoes: recebidas,
  total,
  atribuidas,
  rotuloBarra,
  fraseAguardando,
  nota,
  aviso,
  mostrarFaixa = true,
  eleitosNacionais,
  ocultarSemCadeira = false,
}: DeputadoBancadaPanelProps) {
  const agremiacoes = ordenarBancada(recebidas);
  // Só a LISTA filtra (ver `ocultarSemCadeira`); barra, rótulo e contas usam todas.
  const naLista = ocultarSemCadeira ? agremiacoes.filter((a) => a.cadeiras > 0) : agremiacoes;
  // Sem `Math.max(0, …)` — ver o cabeçalho.
  const aguardando = total - atribuidas;

  // Sem `marker`: não existe "maioria" a marcar. `showLabels={false}`: o
  // `<VoteBar>` rotula, por default, o primeiro e o segundo segmento —
  // desenho de duelo majoritário. A lista abaixo nomeia todas.
  const barra = (
    <VoteBar
      ariaLabel={`${rotuloBarra}, com os votos já apurados: ${agremiacoes
        .filter((a) => a.cadeiras > 0)
        .map((a) => `${a.sigla} ${a.cadeiras}`)
        .join(", ")}${aguardando > 0 ? `, ${aguardando} aguardando apuração` : ""}`}
      marker={null}
      segments={segmentos(agremiacoes, total, aguardando)}
      showLabels={false}
    />
  );

  const conteudo = (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      {aviso}

      {/* RF-300 — com as ilhas, a barra da parcial ganha a versão do cenário
          (na base "Projeção", só no navegador). */}
      {eleitosNacionais ? <BarraCenarioNacional>{barra}</BarraCenarioNacional> : barra}

      {/* O `id` é o alvo do `aria-describedby` do hemiciclo da capa federal
          — é esta lista que serve de equivalente textual do gráfico
          (constituição § 4). Não renomear sem mexer lá. */}
      <ul
        id="bancada-agremiacoes"
        data-testid="bancada-agremiacoes"
        className={eleitosNacionais ? estilosNacional.bancada : undefined}
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}
      >
        {naLista.map((agr) => {
          const intervalo = intervaloDeCadeiras(agr);
          const componentes = listarComponentes(agr.componentes);
          // O miolo da coluna do texto e a coluna da faixa. Com as ilhas
          // (capa federal) eles atravessam para `<BancadaLinhaNacional>`
          // prontos do servidor; sem elas, a linha é a de sempre.
          // As `key` dos dois filhos: o fragmento atravessa a fronteira do
          // cliente (`<BancadaLinhaNacional>`) como ARRAY, e o React avisa
          // "Each child in a list should have a unique key" sem elas.
          const identidade = (
            <>
              <span
                key="sigla"
                className="inline-flex items-center"
                style={{ gap: "var(--space-2)" }}
              >
                {/* O ponto de cor é redundante com o texto (WCAG 1.4.1). */}
                <span
                  aria-hidden="true"
                  data-testid="bancada-ponto"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: corIdentidadeDaAgremiacao(agr),
                    flex: "none",
                  }}
                />
                {/* 🔴 A SIGLA INTEIRA — exceção explícita do dono
                    (2026-09-19) para as capas de Deputados. Nenhum
                    `siglaExibicao(...)` neste painel. */}
                <span style={{ font: "var(--type-body-sm)" }}>{agr.sigla}</span>
              </span>

              <span
                key="texto"
                style={{
                  font: "var(--type-body-sm)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                  textWrap: "pretty",
                }}
              >
                {/* RF-122 */}
                {agr.tipo === "federacao" && componentes.length > 0 ? (
                  <span data-testid="bancada-federacao">
                    {agr.nome} — federação de {componentes}.{" "}
                  </span>
                ) : (
                  <span>{agr.nome}. </span>
                )}
                {/* RF-130 — legenda separada do nominal. */}
                <span data-testid="bancada-votos">
                  {formatVotes(agr.votos_nominais)} votos nominais e{" "}
                  {formatVotes(agr.votos_legenda)} de legenda ({formatPercent(agr.pct_votos)} dos
                  válidos).
                </span>
                {/* RF-127 — a cadeira decidida em rodada de sobra vai marcada. */}
                {agr.cadeiras_indefinidas ? (
                  <span data-testid="bancada-indefinidas">
                    {" "}
                    {agr.cadeiras_indefinidas === 1
                      ? "1 dessas cadeiras ainda está indefinida — foi decidida em rodada de sobra, por margem apertada."
                      : `${agr.cadeiras_indefinidas} dessas cadeiras ainda estão indefinidas — foram decididas em rodada de sobra, por margem apertada.`}
                  </span>
                ) : null}
              </span>
            </>
          );
          // Nada aqui usa `aria-hidden`: o teste (m4) da capa federal conta
          // `span[aria-hidden]` para conferir os pontos de cor.
          const faixa =
            mostrarFaixa && !primeiroTurnoEncerrado() ? (
              <span
                className="text-right"
                style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
              >
                <span className="sr-only">
                  {intervalo ? "faixa provável: " : "faixa não disponível "}
                </span>
                <span data-testid="bancada-intervalo">
                  {intervalo ? `${intervalo} cadeiras` : "—"}
                </span>
              </span>
            ) : (
              <span />
            );
          return (
            <li
              key={agr.cod}
              data-testid="bancada-linha"
              data-cod={agr.cod}
              className="grid items-baseline"
              style={{
                gridTemplateColumns: "3rem minmax(0, 1fr) auto",
                columnGap: "var(--space-3)",
                padding: "var(--space-3) 0",
                borderBottom: "1px solid var(--border-hairline)",
              }}
            >
              {eleitosNacionais ? (
                // RF-299 / RF-300 — props mínimas por linha (peso da capa).
                <BancadaLinhaNacional
                  cod={agr.cod}
                  sigla={agr.sigla}
                  cadeiras={agr.cadeiras}
                  identidade={identidade}
                  faixa={faixa}
                />
              ) : (
                <>
                  {/* O rótulo é IRMÃO do número, não filho: `bancada-cadeiras`
                      vale exatamente a contagem (RF-125.1). */}
                  <span style={{ font: "var(--type-figure-sm)", color: "var(--text-primary)" }}>
                    <span data-testid="bancada-cadeiras">{agr.cadeiras}</span>
                    <span className="sr-only"> cadeiras conquistadas</span>
                  </span>
                  <span className="min-w-0 flex flex-col" style={{ gap: "var(--space-1)" }}>
                    {identidade}
                  </span>
                  {faixa}
                </>
              )}
            </li>
          );
        })}

        {/* RF-300 — agremiação com cadeira no cenário e sem linha acima. */}
        {eleitosNacionais ? <CenarioSemLinha /> : null}

        {aguardando > 0 ? (
          <li
            data-testid="bancada-aguardando"
            className="grid items-baseline"
            style={{
              gridTemplateColumns: "3rem minmax(0, 1fr) auto",
              columnGap: "var(--space-3)",
              padding: "var(--space-3) 0",
            }}
          >
            <span style={{ font: "var(--type-figure-sm)", color: "var(--text-muted)" }}>
              {aguardando}
            </span>
            <span style={{ font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
              {fraseAguardando}
            </span>
            <span />
          </li>
        ) : aguardando < 0 ? (
          // Nunca deveria acontecer (o total com todas as UFs é a soma das
          // vagas publicadas). Se acontecer, a tela diz — não esconde.
          <li
            data-testid="bancada-excesso"
            style={{
              padding: "var(--space-3) 0",
              font: "var(--type-body-sm)",
              color: "var(--text-secondary)",
            }}
          >
            As cadeiras somadas ({atribuidas.toLocaleString("pt-BR")}) passam do total de{" "}
            {total.toLocaleString("pt-BR")} em {(-aguardando).toLocaleString("pt-BR")}. É uma
            divergência nos dados, não uma cadeira a mais: conferimos a conta de cada casa contra as
            vagas que o TSE publica.
          </li>
        ) : null}
      </ul>

      {nota}
    </div>
  );

  return (
    <Panel kicker={kicker} title={title} titleId={titleId}>
      {eleitosNacionais ? (
        // ADR-0063 emenda 04/10 (2), item 5 — o interruptor que a PÁGINA leu,
        // o total e a cor de cada agremiação (ADR-0024, resolvida aqui).
        <BancadaNacionalContexto
          ligada={eleitosNacionais.projecaoLigada}
          esperado={eleitosNacionais.cenarioEsperado ?? false}
          total={total}
          // `0` no fim: agremiação SEM linha na lista (escondida com zero) — a
          // ilha a acrescenta se tiver cadeira no cenário.
          cores={agremiacoes.map((a) =>
            naLista.includes(a)
              ? ([a.cod, corDaAgremiacao(a)] as const)
              : ([a.cod, corDaAgremiacao(a), 0] as const),
          )}
        >
          {conteudo}
        </BancadaNacionalContexto>
      ) : (
        conteudo
      )}
    </Panel>
  );
}
