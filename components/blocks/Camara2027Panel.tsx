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
 *
 * ## Peso (auditoria de a11y/perf de 29/09, A2)
 *
 * Estilos por classe (`Camara2027Panel.module.css`), não `style` inline — o
 * Next escreve cada `style` duas vezes (HTML e payload RSC). A descrição da
 * fonte sai UMA vez, numerada (`numerarFontes`): os padrões de partido
 * costumam vir do mesmo levantamento, e a frase inteira se repetia em cada
 * agremiação. Nenhum link abre aba nova.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { HemicicloPorBloco } from "@/components/blocks/HemicicloPorBloco";
import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { ROTULO_BLOCO_HEMICICLO } from "@/lib/etiquetas/catalogo";
import { numerarFontes } from "@/lib/etiquetas/fontes";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { resumoDosBloqueantes } from "@/lib/etiquetas/portao";
import { visaoCamara2027 } from "@/lib/etiquetas/visoes";
import { ordenarBancada } from "@/lib/utils/bancada";
import { ARCOS_CAMARA } from "@/lib/utils/hemiciclo";

import styles from "./Camara2027Panel.module.css";

/** Prefixo dos ids das fontes numeradas (uma instância por página). */
const ID_FONTE = "camara-2027-fonte";

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
        `${LOG_TAG_CAMARA_2027} escondida pelo portão: ${r.bloqueantes.length} agremiação(ões) sem classificação — ${resumoDosBloqueantes(r.bloqueantes)}`,
      );
    }
    return null;
  }
  const v = r.visao;
  const comCadeira = ordenarBancada(v.agremiacoes.filter((a) => a.cadeiras > 0));
  const fontes = numerarFontes(comCadeira.map((a) => a.etiqueta));

  return (
    <Panel
      kicker="Câmara de 2027 · classificação editorial · não oficial"
      title="Câmara de 2027: quem terá maioria"
      titleId="camara-2027-heading"
    >
      <div className={styles.coluna}>
        <p className={styles.texto}>
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
        <ul data-testid="camara-2027-agremiacoes" className={styles.lista}>
          {comCadeira.map((a) => {
            const n = fontes.numero(a.etiqueta);
            return (
              <li key={a.cod} data-bloco={a.bloco}>
                <strong>{a.sigla}</strong> ({a.cadeiras}): {ROTULO_BLOCO_HEMICICLO[a.bloco]}
                {a.etiqueta ? (
                  <>
                    {" — "}
                    <a href={a.etiqueta.fonte_url} aria-describedby={`${ID_FONTE}-${n}`}>
                      fonte {n}
                    </a>
                    , {dataBr(a.etiqueta.data)}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        {fontes.lista.length > 0 ? (
          <>
            <p className={styles.lista} id={`${ID_FONTE}s`}>
              Fontes
            </p>
            <ol
              className={styles.fontes}
              aria-labelledby={`${ID_FONTE}s`}
              data-testid="camara-2027-fontes"
            >
              {fontes.lista.map((f) => (
                <li key={f.n} id={`${ID_FONTE}-${f.n}`}>
                  <a href={f.fonte_url}>{f.fonte_descricao}</a>
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <EtiquetasAviso />
      </div>
    </Panel>
  );
}
