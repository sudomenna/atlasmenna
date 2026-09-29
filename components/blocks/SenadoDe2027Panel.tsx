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
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { HemicicloPorBloco, PAPEL_BLOCO, TINTA_BLOCO } from "@/components/blocks/HemicicloPorBloco";
import type { EdgePayload } from "@/lib/edge-config/types";
import { QUALIFICADOR_VISIVEL, rotuloDoValor } from "@/lib/etiquetas/catalogo";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import {
  type LinhaImpeachment,
  type OrigemCadeira,
  type PlacarImpeachment,
  placarImpeachment,
  visaoSenado2027PorBloco,
} from "@/lib/etiquetas/visoes";
import type { ValidacaoMandato2031 } from "@/lib/senado/mandato-2031";
import { ARCOS_SENADO } from "@/lib/utils/hemiciclo";

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
  // visão foi pedida e não apareceu. Uma linha, sem nomes (o vigia lista).
  for (const [nome, r] of [
    ["v1", v1],
    ["v2", v2],
  ] as const) {
    if (!r.ok && r.motivo === "portao") {
      console.warn(
        `${LOG_TAG_VISOES_SENADO} ${nome} escondida pelo portão: ${r.bloqueantes.length} sem classificação`,
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
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            <p
              className="max-w-prose"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
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

/** A barra do placar: a favor (cheia), sem posição (hachura), aguardando, contra (vazada). */
function BarraImpeachment({ placar }: { placar: PlacarImpeachment }) {
  const segmentos: Array<{ id: string; n: number; fundo: string; borda: string }> = [
    { id: "a_favor", n: placar.contagem.a_favor, fundo: TINTA_BLOCO, borda: "solid" },
    {
      id: "sem_posicao_publica",
      n: placar.contagem.sem_posicao_publica,
      fundo: `repeating-linear-gradient(45deg, ${TINTA_BLOCO} 0 2px, ${PAPEL_BLOCO} 2px 5px)`,
      borda: "solid",
    },
    {
      id: "aguardando",
      n: placar.contagem.aguardando,
      fundo: "var(--surface-sunken)",
      borda: "dashed",
    },
    { id: "contra", n: placar.contagem.contra, fundo: PAPEL_BLOCO, borda: "solid" },
  ];
  const pos = placar.total > 0 ? (placar.limiar / placar.total) * 100 : 0;
  return (
    <div
      aria-hidden="true"
      data-testid="impeachment-barra"
      style={{ position: "relative", paddingTop: 18 }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${pos}%`,
          transform: "translateX(-50%)",
          font: "var(--type-label)",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {placar.limiar}
      </div>
      <div style={{ display: "flex", height: 16 }}>
        {segmentos
          .filter((s) => s.n > 0)
          .map((s) => (
            <div
              key={s.id}
              data-segmento={s.id}
              style={{
                width: `${(s.n / placar.total) * 100}%`,
                background: s.fundo,
                border: `1px ${s.borda} ${TINTA_BLOCO}`,
                boxSizing: "border-box",
              }}
            />
          ))}
      </div>
      <div
        data-testid="impeachment-marca"
        style={{
          position: "absolute",
          top: 14,
          bottom: -4,
          left: `${pos}%`,
          width: 2,
          marginLeft: -1,
          background: TINTA_BLOCO,
        }}
      />
    </div>
  );
}

function PainelImpeachment({ placar }: { placar: PlacarImpeachment }) {
  const qualificador = QUALIFICADOR_VISIVEL.impeachment_stf as string;
  const aFavor = placar.contagem.a_favor;
  const falta = Math.max(0, placar.limiar - aFavor);
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
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <p
          className="max-w-prose"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          Para condenar um ministro do STF em processo de impeachment, o Senado precisa de dois
          terços dos votos: {placar.limiar} de {placar.total} senadores (Constituição, art. 52,
          parágrafo único). A contagem abaixo é pela posição pública de cada um sobre o impeachment
          de ministros do STF — não é voto dado nem previsão de voto.
        </p>
        <p
          data-testid="impeachment-placar"
          style={{ margin: 0, font: "var(--type-body)", color: "var(--text-primary)" }}
        >
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
        <ul
          className="flex flex-wrap"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            columnGap: "var(--space-4)",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          <li>cheio: a favor</li>
          <li>hachurado: sem posição pública</li>
          <li>vazado: contra</li>
          <li>cinza tracejado: vaga aguardando apuração</li>
          <li>traço: {placar.limiar} (dois terços), contado da esquerda</li>
        </ul>
        <div style={{ overflowX: "auto" }}>
          <table
            data-testid="impeachment-lista"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              font: "var(--type-body-sm)",
              color: "var(--text-primary)",
            }}
          >
            <caption className="sr-only">
              {`${qualificador}, cadeira por cadeira do Senado de 2027, com fonte e data`}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "var(--space-1) var(--space-2) var(--space-1) 0",
                  }}
                >
                  Senador(a)
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "var(--space-1) 0" }}>
                  {qualificador}
                </th>
              </tr>
            </thead>
            <tbody>
              {placar.linhas.map((l) => (
                <tr
                  key={l.chave}
                  data-mandato={l.mandato}
                  data-valor={l.etiqueta?.valor ?? "aguardando"}
                  style={{ borderTop: "1px solid var(--border-hairline)", verticalAlign: "top" }}
                >
                  <td style={{ padding: "var(--space-1) var(--space-2) var(--space-1) 0" }}>
                    {l.nome ?? "Vaga em disputa"}{" "}
                    <span style={{ color: "var(--text-secondary)" }}>
                      ({[l.partido, l.uf].filter(Boolean).join(" · ")})
                    </span>
                    <br />
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      {TEXTO_MANDATO[l.mandato]}
                    </span>
                  </td>
                  <td style={{ padding: "var(--space-1) 0" }}>
                    {l.etiqueta ? (
                      <>
                        {rotuloDoValor("impeachment_stf", l.etiqueta.valor)}
                        <br />
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                          <a href={l.etiqueta.fonte_url} rel="noopener noreferrer" target="_blank">
                            {l.etiqueta.fonte_descricao}
                          </a>
                          , {dataBr(l.etiqueta.data)}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>aguardando apuração</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          className="max-w-prose"
          style={{
            margin: 0,
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          Mandatos até 2031 conforme o Senado em {placar.dataFoto}; as demais linhas são as vagas de
          2026. A ordem da lista é por estado, e não muda com a posição de ninguém.
        </p>
        <EtiquetasAviso />
      </div>
    </Panel>
  );
}
