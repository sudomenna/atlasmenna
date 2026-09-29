/**
 * components/blocks/Camara2027Panel.tsx — "Câmara de 2027: quem terá maioria"
 * em `/deputado-federal` (spec 025, RF-244). Vem DEPOIS do plenário por
 * partido, que fica exatamente como está — a regra do ADR-0049 "sem marca em
 * 257" continua valendo para ele; as marcas moram só aqui (ADR-0061 item 4).
 *
 * ## De onde vem o bloco de cada cadeira
 *
 * Durante a apuração a bancada do payload nacional é POR AGREMIAÇÃO
 * (`bancada.por_agremiacao`) — o payload não diz quais deputados ocupam as
 * cadeiras. Então cada cadeira herda o PADRÃO da agremiação (partido, ou
 * federação), com a fonte de cada padrão listada abaixo do desenho. Isso está
 * dito na tela: até o resultado final, a etiqueta é da agremiação, não de cada
 * deputado. (A conferência individual dos 513 eleitos é depois do resultado —
 * spec 025, pendência registrada no `tasks.md`.)
 *
 * Três portas (chave `camara2027`, critério publicado, portão: toda
 * agremiação com cadeira classificada). Fechado ⇒ nada.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { HemicicloPorBloco } from "@/components/blocks/HemicicloPorBloco";
import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { ROTULO_BLOCO_HEMICICLO } from "@/lib/etiquetas/catalogo";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { visaoCamara2027 } from "@/lib/etiquetas/visoes";
import { ordenarBancada } from "@/lib/utils/bancada";
import { ARCOS_CAMARA } from "@/lib/utils/hemiciclo";

/** Etiqueta das linhas de log quando a visão fica escondida pelo portão. */
export const LOG_TAG_CAMARA_2027 = "[etiquetas-camara-2027]";

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

export interface Camara2027PanelProps {
  bancada: EdgeBancadaNacional | null | undefined;
  etiquetas: Etiquetas;
}

export function Camara2027Panel({ bancada, etiquetas }: Camara2027PanelProps) {
  const r = visaoCamara2027(bancada, etiquetas);
  if (!r.ok) {
    if (r.motivo === "portao") {
      console.warn(
        `${LOG_TAG_CAMARA_2027} escondida pelo portão: ${r.bloqueantes.length} agremiação(ões) sem classificação`,
      );
    }
    return null;
  }
  const v = r.visao;
  const comCadeira = ordenarBancada(v.agremiacoes.filter((a) => a.cadeiras > 0));

  return (
    <Panel
      kicker="Câmara de 2027 · classificação editorial · não oficial"
      title="Câmara de 2027: quem terá maioria"
      titleId="camara-2027-heading"
    >
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <p
          className="max-w-prose"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          As mesmas {v.total} cadeiras do plenário acima, agora pela relação com o governo Lula. Até
          o resultado final, cada cadeira leva a classificação da agremiação que a conquistou — o
          padrão do partido ou da federação, não a de cada deputado. Em 2027 o governo pode ser
          outro: a classificação é a relação com o governo Lula.
        </p>
        <HemicicloPorBloco
          visao={v}
          arcos={ARCOS_CAMARA}
          casa="camara"
          idPrefixo="camara-2027-blocos"
          titulo={`A Câmara a partir de 2027 por relação com o governo Lula: ${v.total} cadeiras`}
          rotuloAguardando="Cadeiras ainda sem dono"
        />
        <ul
          data-testid="camara-2027-agremiacoes"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          {comCadeira.map((a) => (
            <li key={a.cod} data-sigla={a.sigla} data-bloco={a.bloco}>
              <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{a.sigla}</strong>{" "}
              ({a.cadeiras}): {ROTULO_BLOCO_HEMICICLO[a.bloco]}
              {a.etiqueta ? (
                <>
                  {" — "}
                  <a href={a.etiqueta.fonte_url} rel="noopener noreferrer" target="_blank">
                    {a.etiqueta.fonte_descricao}
                  </a>
                  , {dataBr(a.etiqueta.data)}
                </>
              ) : null}
            </li>
          ))}
        </ul>
        <EtiquetasAviso />
      </div>
    </Panel>
  );
}
