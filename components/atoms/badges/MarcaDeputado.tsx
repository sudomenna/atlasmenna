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

import { siglaNaFrase, TERMO_ESTADO, type TermoDoTerritorio } from "@/lib/utils/termo-territorio";

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
  /** Spec 027 — "o estado" · "o Distrito Federal". Ausente ⇒ o termo dos estados. */
  territorio?: TermoDoTerritorio;
  /**
   * Spec 027 — a sigla com artigo ("dos válidos do DF"). As telas das
   * assembleias passam `true`; ausente ⇒ o texto do federal ("de DF").
   */
  comArtigo?: boolean;
  /**
   * Decisão do dono, 04/10 — `avisoSemProjecao(...)`: sem projeção na tela, a
   * base "Projeção" mostra as marcas da parcial e este aviso (só nela,
   * `data-view-only="proj"`). `null`/ausente ⇒ nada.
   */
  aviso?: string | null;
}

/**
 * A legenda ÚNICA das marcas para o painel inteiro (spec 026 § Telas, item 5):
 * um lugar só explica o que cada marca quer dizer, em vez de repetir a
 * explicação em mil linhas. Só lista marca que pode aparecer nesta UF agora.
 *
 * Uma base por vez (decisão do dono, 04/10): com a projeção visível, o item da
 * parcial só existe na base "Parcial" e os da projeção só na "Projeção"
 * (`data-view-only` — `display: none` na outra, fora da árvore de
 * acessibilidade). Sem projeção visível, o item da parcial vale nas duas e a
 * "Projeção" ganha o {@link LegendaMarcasProps.aviso}.
 */
export function LegendaMarcas({
  projecaoVisivel,
  totalizacaoFinal,
  temDestino = false,
  semPercentual = false,
  uf,
  territorio = TERMO_ESTADO,
  comArtigo = false,
  aviso = null,
}: LegendaMarcasProps) {
  // Só separa as bases quando há o que separar (`separaBases`): projeção
  // visível e sem totalização final — este ramo já é o sem totalização.
  const soParcial = projecaoVisivel ? "parcial" : undefined;
  return (
    <ul className={styles.legenda} data-testid="dep-legenda-marcas">
      {semPercentual ? null : (
        <li>
          O percentual ao lado dos votos é sobre os votos válidos {siglaNaFrase(uf, comArtigo).de} —
          a base da conta de cadeiras.
        </li>
      )}
      {totalizacaoFinal ? (
        <li>
          <MarcaDeputado marca={{ tipo: "tse", rotulo: "eleito" }} /> o TSE totalizou {territorio.o}{" "}
          e publicou este candidato na lista dos eleitos. É o resultado oficial, e por isso
          substitui as marcas da nossa conta em todas as linhas.
        </li>
      ) : (
        <>
          {aviso && !projecaoVisivel ? (
            <li data-view-only="proj" data-testid="dep-aviso-sem-projecao">
              {aviso}
            </li>
          ) : null}
          <li data-view-only={soParcial}>
            <MarcaDeputado marca={{ tipo: "parcial", via: null, apertada: false }} /> quem ocuparia
            a cadeira se a contagem parasse agora, pela distribuição do Código Eleitoral sobre os
            votos já apurados. "Pelo quociente" e "nas sobras" dizem por onde a vaga veio na nossa
            conta; "sobra apertada" marca a vaga de sobra cuja margem é menor que o voto que ainda
            falta contar.
          </li>
          {projecaoVisivel ? (
            <li data-view-only="proj">
              <MarcaDeputado marca={{ tipo: "projecao", via: "qp", apertada: false }} /> quem
              ocuparia a cadeira na nossa estimativa do resultado final {territorio.doTerritorio}.
              Não é resultado do TSE; "apertada" marca a vaga que ainda pode mudar de mão.
            </li>
          ) : null}
          {projecaoVisivel ? (
            // Spec 026 RF-297 — o número sob o voto apurado. Só existe com a
            // projeção visível (o mesmo par de leituras da marca acima).
            <li data-view-only="proj" data-testid="dep-legenda-voto-projetado">
              "projeção ≈ 652 mil · não oficial", sob os votos: o voto que estimamos para o
              candidato ao fim da apuração {territorio.doTerritorio}, arredondado. Aparece nos
              marcados como eleitos e nos 7 seguintes de cada agremiação. Não é resultado do TSE e
              não muda a ordem da lista, que é sempre a dos votos apurados.
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
