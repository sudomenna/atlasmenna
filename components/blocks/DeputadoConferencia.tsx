/**
 * components/blocks/DeputadoConferencia.tsx — spec 026 (RF-269), design 026 § 2.8.
 *
 * "Os nossos números e os do TSE", com texto VERDADEIRO.
 *
 * ## O defeito que este componente existe para não repetir
 *
 * Até 29/09 a página dizia "o quociente eleitoral e a contagem de vagas por
 * agremiação que calculamos batem com os que o TSE publica neste boletim"
 * sempre que `divergencias` vinha vazio — e ele vinha vazio porque a
 * comparação **nunca era feita** (`api/model/deputado.py:502-503` zerava o dado
 * do TSE no modo por zona). Lista vazia não é "confere": é "não comparamos".
 *
 * Por isso a frase sai de `comparou` — o que foi DE FATO comparado no ciclo —,
 * e "batem com o TSE" só existe com `estado === "confere"` **e** `algoritmo` em
 * `comparou`. As duas condições, e não só o estado: um payload inconsistente
 * (estado "confere" sem a comparação da conta) cai no texto neutro em vez de
 * afirmar uma igualdade que ninguém mediu.
 *
 * ## Os três estados (design § 2.8)
 *
 *   - `confere` ......... diz o que bateu e o HORÁRIO do boletim do TSE comparado;
 *   - `diverge` ......... quantas divergências, e cada uma com as duas magnitudes
 *                         (e a diferença em %, quando o produtor a mede);
 *   - `sem_dado_tse` .... diz que não houve com o que comparar — nunca "bate".
 *
 * "Pequenas diferenças são esperadas e não indicam erro" só sai quando NÃO há
 * divergência de `eleitorado` nem de `votos_validos`: essas duas são
 * estruturais (a nossa soma não alcança o boletim — uma zona que não
 * buscamos, por exemplo), e a tela diz isso, com o tamanho.
 *
 * Objeto v1 (sem `conferencia`, RF-276): só `divergencias` do v1. Com
 * divergência, elas aparecem; sem, o texto é o neutro — nunca o "batem" antigo.
 *
 * Server Component, zero JS.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import type {
  DeputadoComparacao as Comparacao,
  DeputadoConferencia as ConferenciaDados,
} from "@/lib/blob/deputado-uf";
import { formatPercent, formatTimeHMS, formatVotes } from "@/lib/utils/format";

/** Uma divergência como chega — v1 (`o_que` livre) ou v2 (conjunto fechado, com `diferenca_pct`). */
export interface DivergenciaParaTela {
  o_que: string;
  nosso: number;
  tse: number;
  detalhe: string;
  diferenca_pct?: number;
}

export interface DeputadoConferenciaProps {
  /** v2 (design § 2.8). Ausente no objeto v1. */
  conferencia: ConferenciaDados | undefined;
  /** v1 (`detail.divergencias`) — só lido quando `conferencia` falta. */
  divergenciasV1: readonly DivergenciaParaTela[];
  /** `detail.totalizacao_final`. */
  totalizacaoFinal: boolean;
  /** `cod` → sigla, para a divergência de cadeiras dizer "MDB", e não "agremiação 15". */
  siglaPorCod?: ReadonlyMap<string, string>;
  /** `sqcand` → nome, para a divergência de eleitos nomear pessoas, e não números. */
  nomePorSqcand?: ReadonlyMap<number, string>;
  titleId: string;
}

/**
 * Nome legível do que divergiu. Chave fora do conjunto volta quase crua (só o
 * sublinhado vira espaço), de propósito: divergência perdida é pior que
 * divergência sem rótulo bonito.
 */
export const ROTULO_DIVERGENCIA: Readonly<Record<string, string>> = {
  quociente_eleitoral: "Quociente eleitoral",
  cadeiras: "Cadeiras da agremiação",
  eleitos: "Eleitos",
  eleitorado: "Eleitorado",
  votos_validos: "Votos válidos",
};

export function rotuloDivergencia(oQue: string): string {
  return ROTULO_DIVERGENCIA[oQue] ?? oQue.replace(/_/g, " ");
}

/** O que cada comparação FEITA e sem divergência permite afirmar. */
const O_QUE_BATEU: Readonly<Record<Comparacao, string>> = {
  eleitorado: "o eleitorado das zonas que lemos fecha com o do boletim do TSE",
  algoritmo:
    "o quociente eleitoral e as cadeiras de cada agremiação que calculamos sobre os votos do próprio boletim são os que o TSE publica",
  eleitos: "os eleitos são as mesmas pessoas",
  votos_validos: "os votos válidos somados das zonas batem com o total do TSE",
};

function listarEmTexto(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join("; ")}; e ${itens[itens.length - 1]}`;
}

/** "19,5% abaixo" — a magnitude que o produtor mediu, com o sentido. `null` sem medida. */
function magnitude(d: DivergenciaParaTela): string | null {
  if (typeof d.diferenca_pct !== "number" || !Number.isFinite(d.diferenca_pct)) return null;
  if (d.diferenca_pct === 0) return null;
  const sentido = d.diferenca_pct < 0 ? "abaixo" : "acima";
  return `${formatPercent(Math.abs(d.diferenca_pct), 1)} ${sentido}`;
}

/** Que chaves de divergência cada comparação pode produzir (design § 2.8). */
const CHAVES_DA_COMPARACAO: Readonly<Record<Comparacao, readonly string[]>> = {
  eleitorado: ["eleitorado"],
  algoritmo: ["quociente_eleitoral", "cadeiras"],
  eleitos: ["eleitos"],
  votos_validos: ["votos_validos"],
};

/** Troca, no texto do produtor, cada `sqcand` conhecido pelo nome — o leitor não lê números de 11 dígitos. */
function nomearSqcands(texto: string, nomes: ReadonlyMap<number, string> | undefined): string {
  if (!nomes || nomes.size === 0) return texto;
  return texto.replace(/\b\d{8,}\b/g, (m) => nomes.get(Number(m)) ?? m);
}

function detalheLegivel(
  d: DivergenciaParaTela,
  siglaPorCod: ReadonlyMap<string, string> | undefined,
  nomes: ReadonlyMap<number, string> | undefined,
): string {
  if (d.o_que === "cadeiras") {
    const cod = /agremia[çc][ãa]o\s+(\S+)/i.exec(d.detalhe)?.[1];
    const sigla = cod ? siglaPorCod?.get(cod) : undefined;
    if (sigla) return `${sigla} (número ${cod}).`;
  }
  return nomearSqcands(d.detalhe, nomes);
}

function linhaDivergencia(
  d: DivergenciaParaTela,
  siglaPorCod: ReadonlyMap<string, string> | undefined,
  nomes: ReadonlyMap<number, string> | undefined,
): React.ReactNode {
  const mag = magnitude(d);
  if (d.o_que === "eleitorado") {
    return (
      <>
        <strong>{rotuloDivergencia(d.o_que)}</strong>: o das zonas que lemos soma{" "}
        {formatVotes(d.nosso)}
        {mag ? `, ${mag} dos ` : " contra "}
        {formatVotes(d.tse)} do boletim do TSE. {detalheLegivel(d, siglaPorCod, nomes)}
      </>
    );
  }
  if (d.o_que === "votos_validos") {
    return (
      <>
        <strong>{rotuloDivergencia(d.o_que)}</strong>: os das zonas somam {formatVotes(d.nosso)}
        {mag ? `, ${mag} dos ` : " contra "}
        {formatVotes(d.tse)} do total do TSE. {detalheLegivel(d, siglaPorCod, nomes)}
      </>
    );
  }
  if (d.o_que === "eleitos") {
    return (
      <>
        <strong>{rotuloDivergencia(d.o_que)}</strong>: {d.nosso.toLocaleString("pt-BR")} só na nossa
        conta e {d.tse.toLocaleString("pt-BR")} só na do TSE.{" "}
        {detalheLegivel(d, siglaPorCod, nomes)}
      </>
    );
  }
  return (
    <>
      <strong>{rotuloDivergencia(d.o_que)}</strong>: nosso {formatVotes(d.nosso)}, TSE{" "}
      {formatVotes(d.tse)}
      {mag ? ` — ${mag} do TSE` : ""}. {detalheLegivel(d, siglaPorCod, nomes)}
    </>
  );
}

/**
 * Divergências ESTRUTURAIS: `eleitorado` (Σ `e.te` das zonas × `e.te` do
 * agregado — o eleitorado não muda durante a contagem) e `votos_validos` (só
 * comparado com totalização final). Nenhuma das duas se explica pelo andamento
 * da apuração: é a nossa soma que não alcança o que o boletim do TSE conta —
 * por exemplo, uma zona que não buscamos (o caso do AP no simulado: −19,5%).
 */
const CHAVES_ESTRUTURAIS: ReadonlySet<string> = new Set(["eleitorado", "votos_validos"]);

/** "o eleitorado das zonas que lemos está 19,5% abaixo do do boletim do TSE (122.461 eleitores a menos)". */
function descricaoEstrutural(d: DivergenciaParaTela): string {
  const mag = magnitude(d);
  const falta = Math.abs(d.nosso - d.tse);
  const sentido = d.nosso < d.tse ? "a menos" : "a mais";
  if (d.o_que === "eleitorado") {
    const unidade = falta === 1 ? "eleitor" : "eleitores";
    return mag
      ? `o eleitorado das zonas que lemos está ${mag} do que o boletim do TSE registra (${formatVotes(falta)} ${unidade} ${sentido})`
      : `o eleitorado das zonas que lemos soma ${formatVotes(d.nosso)}, contra ${formatVotes(d.tse)} do boletim do TSE`;
  }
  const unidade = falta === 1 ? "voto" : "votos";
  return mag
    ? `os votos válidos somados das zonas estão ${mag} do total do TSE (${formatVotes(falta)} ${unidade} ${sentido})`
    : `os votos válidos somados das zonas são ${formatVotes(d.nosso)}, contra ${formatVotes(d.tse)} do total do TSE`;
}

/**
 * A frase depois do resumo. "Pequenas diferenças são esperadas e não indicam
 * erro" é verdade para o quociente e as cadeiras enquanto o boletim não é a
 * totalização final — e FALSA diante de uma divergência estrutural: um
 * eleitorado 19,5% menor não é "pequena diferença" nem passa com o avanço da
 * contagem. Com ela, a tela diz que é estrutural, e o tamanho.
 */
function fraseDoBoletim(
  divergencias: readonly DivergenciaParaTela[],
  totalizacaoFinal: boolean,
): string {
  const estruturais = divergencias.filter((d) => CHAVES_ESTRUTURAIS.has(d.o_que));
  const doBoletim = totalizacaoFinal
    ? "Este boletim já é a totalização final do estado."
    : "Este boletim ainda não é a totalização final do estado.";
  if (estruturais.length === 0) {
    return totalizacaoFinal
      ? doBoletim
      : "Este boletim ainda não é a totalização final do estado — até lá, pequenas diferenças são esperadas e não indicam erro.";
  }
  const partes = listarEmTexto(estruturais.map(descricaoEstrutural));
  return `${doBoletim} Mas ${partes}: essa diferença não vem do andamento da apuração e não some sozinha — é estrutural, e o caso típico é uma zona eleitoral do estado que não buscamos no TSE, cujo eleitorado e cujos votos ficam fora da nossa soma.`;
}

const TEXTO: React.CSSProperties = {
  margin: 0,
  font: "var(--type-body-sm)",
  color: "var(--text-secondary)",
  textWrap: "pretty",
};

export function DeputadoConferencia({
  conferencia,
  divergenciasV1,
  totalizacaoFinal,
  siglaPorCod,
  nomePorSqcand,
  titleId,
}: DeputadoConferenciaProps) {
  const divergencias: readonly DivergenciaParaTela[] = conferencia
    ? conferencia.divergencias
    : divergenciasV1;
  const comparou = conferencia?.comparou ?? [];
  const boletim = conferencia?.boletim_dado_ts ?? null;
  const horaBoletim = boletim ? formatTimeHMS(boletim) : null;
  const doBoletim = horaBoletim ? `o boletim do TSE das ${horaBoletim}` : "o boletim do TSE";

  // A ÚNICA porta para "batem": estado confere E a conta foi comparada.
  const confere =
    conferencia?.estado === "confere" &&
    comparou.includes("algoritmo") &&
    divergencias.length === 0;

  let frase: string;
  if (divergencias.length > 0) {
    frase =
      divergencias.length === 1
        ? `Há uma divergência entre a nossa conta e ${doBoletim}.`
        : `Há ${divergencias.length} divergências entre a nossa conta e ${doBoletim}.`;
    // O que foi comparado e NÃO divergiu também é fato medido — e só isso.
    const chaves = new Set(divergencias.map((d) => d.o_que));
    const bateram = comparou.filter((c) => !CHAVES_DA_COMPARACAO[c].some((k) => chaves.has(k)));
    if (bateram.length > 0) {
      frase += ` No resto do que comparamos, ${listarEmTexto(bateram.map((c) => O_QUE_BATEU[c]))}.`;
    }
  } else if (confere) {
    frase = `Conferimos com ${doBoletim}: ${listarEmTexto(comparou.map((c) => O_QUE_BATEU[c]))}.`;
  } else if (comparou.length > 0) {
    // Comparou alguma coisa, mas não a conta de cadeiras — diz só o que comparou.
    frase = `Com ${doBoletim} conferimos só isto: ${listarEmTexto(comparou.map((c) => O_QUE_BATEU[c]))}. A conta de cadeiras ainda não pôde ser comparada — o TSE só publica o quociente depois da primeira totalização do estado —, então não dizemos que ela bate.`;
  } else {
    frase =
      "Ainda não há boletim do TSE com que comparar a nossa conta neste estado, então não dizemos que os números batem. A comparação aparece aqui quando o TSE publicar o quociente eleitoral da primeira totalização.";
  }

  return (
    <Panel kicker="Conferência" title="Os nossos números e os do TSE" titleId={titleId}>
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <p
          className="max-w-prose"
          data-testid="uf-conferencia"
          data-estado={conferencia?.estado ?? "v1"}
          style={TEXTO}
        >
          {frase} {fraseDoBoletim(divergencias, totalizacaoFinal)}
        </p>

        {divergencias.length > 0 ? (
          <ul
            data-testid="uf-divergencias"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--space-2)",
            }}
          >
            {divergencias.map((d) => (
              <li
                key={`${d.o_que}:${d.nosso}:${d.tse}:${d.detalhe}`}
                data-o-que={d.o_que}
                style={{ ...TEXTO, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
              >
                {linhaDivergencia(d, siglaPorCod, nomePorSqcand)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
