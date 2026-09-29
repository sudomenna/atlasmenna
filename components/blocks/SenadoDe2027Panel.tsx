/**
 * components/blocks/SenadoDe2027Panel.tsx — as duas visões editoriais do
 * Senado de 2027 em `/senador` (spec 025):
 *
 *   - **V1 — "Senado de 2027: quem terá maioria"** (RF-242): as MESMAS 81
 *     cadeiras do hemiciclo por partido logo acima, agora por bloco de relação
 *     com o governo Lula (`<HemicicloPorBloco>`), com as marcas de 41, 49 e 54.
 *   - **V2 — "Impeachment de ministros do STF no Senado de 2027"** (RF-243):
 *     a barra com a marca de dois terços (54, CF art. 52, parágrafo único) e a
 *     lista das 81 cadeiras com a posição pública de cada uma, fonte e data.
 *
 * Cada visão só aparece com as TRÊS portas abertas (chave, critério publicado,
 * portão de cobertura — `lib/etiquetas/visoes.ts`). Fechada, ela não desenha
 * NADA: nem painel, nem "a classificar", nem "em breve" (decisão do dono).
 *
 * Server Component, zero JavaScript. Recebe o `Etiquetas` já lido pela página
 * — nenhuma leitura aqui (a página renderiza sem Suspense nos testes).
 *
 * ## Peso e teclado (auditoria de a11y/perf de 29/09, A2/M2/B4)
 *
 * Com as visões ligadas, `/senador` mediu 714 KB de documento; a lista das 81
 * cadeiras do V2 era a maior parte, e somava 82 paradas de Tab ANTES do filtro
 * da página. Agora: estilos por classe (`SenadoDe2027Panel.module.css`, e não
 * `style` inline, que o Next escreve duas vezes — HTML e payload RSC); a lista
 * mora num `<details>` recolhido, com o placar no `<summary>` (links dentro de
 * `<details>` fechado não recebem foco); a descrição de cada fonte sai UMA vez,
 * numerada (`numerarFontes`), e cada linha leva o link "fonte N" com a
 * descrição como `aria-describedby`; o nome da cadeira é `<th scope="row">`;
 * nenhum link abre aba nova.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { HemicicloPorBloco } from "@/components/blocks/HemicicloPorBloco";
import type { EdgePayload } from "@/lib/edge-config/types";
import { QUALIFICADOR_VISIVEL, rotuloDoValor } from "@/lib/etiquetas/catalogo";
import { numerarFontes } from "@/lib/etiquetas/fontes";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { resumoDosBloqueantes } from "@/lib/etiquetas/portao";
import {
  type LinhaImpeachment,
  type OrigemCadeira,
  type PlacarImpeachment,
  placarImpeachment,
  visaoSenado2027PorBloco,
} from "@/lib/etiquetas/visoes";
import type { ValidacaoMandato2031 } from "@/lib/senado/mandato-2031";
import { ARCOS_SENADO } from "@/lib/utils/hemiciclo";

import styles from "./SenadoDe2027Panel.module.css";

/** Etiqueta das linhas de log quando uma visão fica escondida pelo portão. */
export const LOG_TAG_VISOES_SENADO = "[etiquetas-senado-2027]";

/** "19 até 2031, 3 em 2026 com a apuração concluída no estado, 12 em 2026 pela projeção". */
export function detalheOrigemSenado(p: Partial<Record<OrigemCadeira, number>>): string | null {
  const partes: string[] = [];
  if (p.continua_2031) partes.push(`${p.continua_2031} até 2031`);
  if (p.decidida) partes.push(`${p.decidida} em 2026 com a apuração concluída no estado`);
  if (p.projetada) partes.push(`${p.projetada} em 2026 pela projeção`);
  return partes.length > 0 ? partes.join(", ") : null;
}

const TEXTO_MANDATO: Record<LinhaImpeachment["mandato"], string> = {
  continua_2031: "mandato até 2031",
  decidida: "vaga de 2026 — apuração concluída no estado",
  projetada: "vaga de 2026 — pela projeção",
  aguardando: "vaga de 2026 — aguardando apuração",
};

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

export interface SenadoDe2027PanelProps {
  payload: EdgePayload | null;
  mandato: ValidacaoMandato2031;
  etiquetas: Etiquetas;
}

export function SenadoDe2027Panel({ payload, mandato, etiquetas }: SenadoDe2027PanelProps) {
  const v1 = visaoSenado2027PorBloco(payload, mandato, etiquetas);
  const v2 = placarImpeachment(payload, mandato, etiquetas);
  // Portão fechado com a chave LIGADA é o caso que o dono precisa saber: a
  // visão foi pedida e não apareceu. Uma linha, com QUEM prende (até 5 chaves
  // — B6, 29/09: o V1 sumia por um só senador sem partido, e a linha dizia só
  // "1 sem classificação"). A lista inteira é o vigia; os senadores até 2031
  // que faltam também saem em `/sobre-as-etiquetas`.
  for (const [nome, r] of [
    ["v1", v1],
    ["v2", v2],
  ] as const) {
    if (!r.ok && r.motivo === "portao") {
      console.warn(
        `${LOG_TAG_VISOES_SENADO} ${nome} escondida pelo portão: ${r.bloqueantes.length} sem classificação — ${resumoDosBloqueantes(r.bloqueantes)}`,
      );
    }
  }
  if (!v1.ok && !v2.ok) return null;

  return (
    <>
      {v1.ok ? (
        <Panel
          kicker={
            v1.visao.fase === "normal"
              ? "Senado de 2027 · classificação editorial · não oficial"
              : "Senado de 2027 · classificação editorial"
          }
          title="Senado de 2027: quem terá maioria"
          titleId="senado-2027-blocos-heading"
        >
          <div className={styles.coluna}>
            <p className={styles.texto}>
              {v1.visao.fase === "normal"
                ? `As mesmas ${v1.visao.total} cadeiras do gráfico acima, agora pela relação de cada senador com o governo Lula: as ${v1.visao.total - v1.visao.vagasEmDisputa} com mandato até 2031 e as ${v1.visao.vagasEmDisputa} em disputa, pela projeção de cada estado (ou pelo resultado, nos estados com a apuração concluída). Em 2027 o governo pode ser outro — a classificação é a relação com o governo Lula.`
                : `As ${v1.visao.total - v1.visao.vagasEmDisputa} cadeiras com mandato até 2031, pela relação de cada senador com o governo Lula, e as ${v1.visao.vagasEmDisputa} vagas em disputa nesta eleição, ainda sem voto contado.`}
            </p>
            <HemicicloPorBloco
              visao={v1.visao}
              arcos={ARCOS_SENADO}
              casa="senado"
              idPrefixo="senado-2027-blocos"
              titulo={`O Senado a partir de 2027 por relação com o governo Lula: ${v1.visao.total} cadeiras`}
              rotuloAguardando={
                v1.visao.fase === "normal" ? "Vagas aguardando apuração" : "Vagas em disputa"
              }
              detalheOrigem={detalheOrigemSenado}
              nota={`Mandatos até 2031 conforme o Senado em ${v1.visao.dataFoto}.`}
            />
            <EtiquetasAviso />
          </div>
        </Panel>
      ) : null}
      {v2.ok ? <PainelImpeachment placar={v2.visao} /> : null}
    </>
  );
}

/** Os segmentos da barra, da esquerda: a favor, sem posição, aguardando, contra. */
const SEGMENTOS = ["a_favor", "sem_posicao_publica", "aguardando", "contra"] as const;

/** A barra do placar: a favor (cheia), sem posição (hachura), aguardando, contra (vazada). */
function BarraImpeachment({ placar }: { placar: PlacarImpeachment }) {
  const pos = placar.total > 0 ? (placar.limiar / placar.total) * 100 : 0;
  // Largura e posição são o DADO — ficam inline; o resto é classe.
  const pct = (n: number) => `${((n / placar.total) * 100).toFixed(3)}%`;
  return (
    <div aria-hidden="true" data-testid="impeachment-barra" className={styles.barra}>
      <div className={styles.limiar} style={{ left: `${pos}%` }}>
        {placar.limiar}
      </div>
      <div className={styles.trilho}>
        {SEGMENTOS.filter((id) => placar.contagem[id] > 0).map((id) => (
          <div
            key={id}
            data-segmento={id}
            className={`${styles.segmento} ${styles[id]}`}
            style={{ width: pct(placar.contagem[id]) }}
          />
        ))}
      </div>
      <div data-testid="impeachment-marca" className={styles.marca} style={{ left: `${pos}%` }} />
    </div>
  );
}

/** Prefixo dos ids das fontes numeradas (uma instância por página). */
const ID_FONTE = "impeachment-fonte";

function PainelImpeachment({ placar }: { placar: PlacarImpeachment }) {
  const qualificador = QUALIFICADOR_VISIVEL.impeachment_stf as string;
  const aFavor = placar.contagem.a_favor;
  const falta = Math.max(0, placar.limiar - aFavor);
  const fontes = numerarFontes(placar.linhas.map((l) => l.etiqueta));
  const contagemCurta = [
    `a favor: ${aFavor}`,
    `contra: ${placar.contagem.contra}`,
    `sem posição pública: ${placar.contagem.sem_posicao_publica}`,
    ...(placar.contagem.aguardando > 0 ? [`aguardando: ${placar.contagem.aguardando}`] : []),
  ].join(" · ");
  return (
    <Panel
      kicker={
        placar.fase === "normal"
          ? "Senado de 2027 · classificação editorial · não oficial"
          : "Senado de 2027 · classificação editorial"
      }
      title="Impeachment de ministros do STF no Senado de 2027"
      titleId="impeachment-stf-heading"
    >
      <div className={styles.coluna}>
        <p className={styles.texto}>
          Para condenar um ministro do STF em processo de impeachment, o Senado precisa de dois
          terços dos votos: {placar.limiar} de {placar.total} senadores (Constituição, art. 52,
          parágrafo único). A contagem abaixo é pela posição pública de cada um sobre o impeachment
          de ministros do STF — não é voto dado nem previsão de voto.
        </p>
        <p data-testid="impeachment-placar" className={styles.placar}>
          <strong>
            {qualificador}: a favor — {aFavor} de {placar.total}
          </strong>
          {aFavor >= placar.limiar
            ? ` (alcança ${placar.limiar})`
            : ` — faltam ${falta} para ${placar.limiar}`}
          . Contra: {placar.contagem.contra}. Sem posição pública:{" "}
          {placar.contagem.sem_posicao_publica}.
          {placar.contagem.aguardando > 0
            ? ` Vagas aguardando apuração: ${placar.contagem.aguardando}.`
            : ""}
        </p>
        <BarraImpeachment placar={placar} />
        <ul className={styles.legenda}>
          <li>cheio: a favor</li>
          <li>hachurado: sem posição pública</li>
          <li>vazado: contra</li>
          <li>cinza tracejado: vaga aguardando apuração</li>
          <li>traço: {placar.limiar} (dois terços), contado da esquerda</li>
        </ul>
        <details className={styles.detalhes} data-testid="impeachment-detalhes">
          <summary className={styles.resumo}>
            {`As ${placar.total} cadeiras, uma a uma, com fonte e data (${contagemCurta})`}
          </summary>
          <div className={styles.rolagem}>
            <table data-testid="impeachment-lista" className={styles.tabela}>
              <caption className="sr-only">
                {`${qualificador}, cadeira por cadeira do Senado de 2027, com fonte e data`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Senador(a)</th>
                  <th scope="col">{qualificador}</th>
                </tr>
              </thead>
              <tbody>
                {placar.linhas.map((l) => {
                  const n = fontes.numero(l.etiqueta);
                  return (
                    <tr key={l.chave}>
                      <th scope="row">
                        {l.nome ?? "Vaga em disputa"}{" "}
                        <span>({[l.partido, l.uf].filter(Boolean).join(" · ")})</span>
                        <small>{TEXTO_MANDATO[l.mandato]}</small>
                      </th>
                      <td>
                        {l.etiqueta ? (
                          <>
                            {rotuloDoValor("impeachment_stf", l.etiqueta.valor)}
                            <small>
                              <a href={l.etiqueta.fonte_url} aria-describedby={`${ID_FONTE}-${n}`}>
                                fonte {n}
                              </a>
                              , {dataBr(l.etiqueta.data)}
                            </small>
                          </>
                        ) : (
                          <small>aguardando apuração</small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fontes.lista.length > 0 ? (
            <>
              <p className={styles.nota} id={`${ID_FONTE}s`}>
                Fontes
              </p>
              <ol
                className={styles.fontes}
                aria-labelledby={`${ID_FONTE}s`}
                data-testid="impeachment-fontes"
              >
                {fontes.lista.map((f) => (
                  <li key={f.n} id={`${ID_FONTE}-${f.n}`}>
                    <a href={f.fonte_url}>{f.fonte_descricao}</a>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </details>
        <p className={styles.nota}>
          Mandatos até 2031 conforme o Senado em {placar.dataFoto}; as demais linhas são as vagas de
          2026. A ordem da lista é por estado, e não muda com a posição de ninguém.
        </p>
        <EtiquetasAviso />
      </div>
    </Panel>
  );
}
