/**
 * components/atoms/badges/MarcaDeputado.tsx — spec 026 (RF-262, RF-266,
 * RF-267), design 026 § 4.
 *
 * A marca de eleição numa linha de candidato a Deputado Federal, e o texto do
 * destino do voto quando o voto não é nominal válido.
 *
 * **Texto primeiro, nunca "eleito" sozinho.** O átomo NÃO decide qual marca a
 * linha tem — isso é `marcasDaLinha` (`lib/utils/deputado-marcas.ts`), o único
 * lugar com a precedência do TSE. Ele só desenha uma `Marca` já derivada, com
 * o texto que o mesmo módulo fixa: "eleito na parcial", "eleito na projeção ·
 * não oficial" ou "Eleito (TSE)".
 *
 * Sem estado e sem evento: renderiza no servidor e dentro do componente
 * cliente da lista (`DeputadoListaAgremiacao`) sem arrastar nada para o
 * bundle além deste arquivo.
 */

import {
  type DestinoDeputado,
  type Marca,
  TEXTO_DESTINO,
  textoDaMarca,
} from "@/lib/utils/deputado-marcas";

import styles from "./MarcaDeputado.module.css";

const CLASSE: Record<Marca["tipo"], string | undefined> = {
  parcial: styles.parcial,
  projecao: styles.projecao,
  tse: styles.tse,
};

export interface MarcaDeputadoProps {
  marca: Marca;
}

/** Uma marca de eleição. A via e o "apertada" vão dentro da mesma caixa, com peso menor. */
export function MarcaDeputado({ marca }: MarcaDeputadoProps) {
  const t = textoDaMarca(marca);
  return (
    <>
      <span className={`${styles.marca} ${CLASSE[marca.tipo]}`} data-marca={marca.tipo}>
        {t.principal}
        {t.via ? <span className={styles.detalhe}>{`· ${t.via}`}</span> : null}
        {t.apertada ? <span className={styles.detalhe}>{`· ${t.apertada}`}</span> : null}
      </span>
      {t.citacaoTse ? (
        <span className={styles.citacao} data-citacao-tse="">
          <span className="sr-only">rótulo do TSE: </span>“{t.citacaoTse}”
        </span>
      ) : null}
    </>
  );
}

export interface DestinoDeputadoTextoProps {
  destino: DestinoDeputado;
}

/**
 * O texto do destino quando o voto não é nominal válido (RF-261): "votos para a
 * legenda", "votos anulados", "sub judice — fora da conta". Em anulado e sub
 * judice ele ocupa o lugar do %; em "Válido (legenda)" vai AO LADO do %, que é
 * verdadeiro (ADR-0064, emenda de 29/09). Nunca "0,00%" e nunca marca de eleito
 * ao lado (ADR-0064 decisão 5).
 */
export function DestinoDeputadoTexto({ destino }: DestinoDeputadoTextoProps) {
  return (
    <span className={styles.destino} data-destino={destino}>
      {TEXTO_DESTINO[destino]}
    </span>
  );
}

export interface LegendaMarcasProps {
  /** Com o interruptor desligado ou a trava fechada, a marca de projeção não existe — nem na legenda. */
  projecaoVisivel: boolean;
  /** Com totalização final, só a marca do TSE existe na UF. */
  totalizacaoFinal: boolean;
  /** Mostra os textos de destino quando algum candidato da UF tem destino. */
  temDestino?: boolean;
  /** Objeto v1: as linhas não têm % — a frase da base não se aplica. */
  semPercentual?: boolean;
  /** Sigla da UF, para a base do percentual (constituição § 8). */
  uf: string;
}

/**
 * A legenda ÚNICA das marcas para o painel inteiro (spec 026 § Telas, item 5):
 * um lugar só explica o que cada marca quer dizer, em vez de repetir a
 * explicação em mil linhas. Só lista marca que pode aparecer nesta UF agora.
 */
export function LegendaMarcas({
  projecaoVisivel,
  totalizacaoFinal,
  temDestino = false,
  semPercentual = false,
  uf,
}: LegendaMarcasProps) {
  return (
    <ul className={styles.legenda} data-testid="dep-legenda-marcas">
      {semPercentual ? null : (
        <li>
          O percentual ao lado dos votos é sobre os votos válidos de {uf} — a base da conta de
          cadeiras.
        </li>
      )}
      {totalizacaoFinal ? (
        <li>
          <MarcaDeputado marca={{ tipo: "tse", rotulo: "eleito" }} /> o TSE totalizou o estado e
          publicou este candidato na lista dos eleitos. É o resultado oficial, e por isso substitui
          as marcas da nossa conta em todas as linhas.
        </li>
      ) : (
        <>
          <li>
            <MarcaDeputado marca={{ tipo: "parcial", via: null, apertada: false }} /> quem ocuparia
            a cadeira se a contagem parasse agora, pela distribuição do Código Eleitoral sobre os
            votos já apurados. "Pelo quociente" e "nas sobras" dizem por onde a vaga veio na nossa
            conta; "sobra apertada" marca a vaga de sobra cuja margem é menor que o voto que ainda
            falta contar.
          </li>
          {projecaoVisivel ? (
            <li>
              <MarcaDeputado marca={{ tipo: "projecao", via: "qp", apertada: false }} /> quem
              ocuparia a cadeira na nossa estimativa do resultado final do estado. Não é resultado
              do TSE; "apertada" marca a vaga que ainda pode mudar de mão.
            </li>
          ) : null}
        </>
      )}
      {temDestino ? (
        <li>
          Sem marca: <DestinoDeputadoTexto destino="valido_legenda" /> (o voto é válido e conta para
          a agremiação, não para o nome — o percentual aparece ao lado),{" "}
          <DestinoDeputadoTexto destino="anulado" /> e <DestinoDeputadoTexto destino="sub_judice" />{" "}
          (fora da conta, sem percentual) — como o TSE marca cada candidatura. Os votos aparecem;
          nenhum deles entra na conta de cadeiras em nome do candidato.
        </li>
      ) : null}
    </ul>
  );
}
