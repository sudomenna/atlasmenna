/**
 * lib/deputado/eleitos-nacionais.ts — spec 026 RF-299 e RF-300 (emenda de
 * 04/10 (2) do ADR-0063): os eleitos de Deputado Federal do PAÍS, por
 * agremiação, e o cenário projetado nacional misto, montados NA LEITURA a
 * partir dos 27 objetos de UF do Blob.
 *
 * ## Por que na leitura, e não no modelo
 *
 * Dia da eleição: mexer no modelo Python ou na gravação do payload nacional
 * arrisca a apuração da noite. E o dado já existe: cada objeto de UF traz toda
 * candidatura marcada (parcial, projeção, TSE), qualquer que seja o `rank`
 * (ADR-0065 D1), e o `cod` de cada agremiação do objeto é a chave NACIONAL —
 * a mesma de `bancada.por_agremiacao[].cod` (design 017 D3, emenda de 29/09).
 * O casamento entre UFs é igualdade de string.
 *
 * ## O que este módulo decide, e só isto
 *
 *   - **UF liberada** ⇔ `projecaoVisivel` (estado `liberada` E interruptor
 *     ligado, depois de `aplicarInterruptorProjecao`) E sem totalização final
 *     E toda agremiação com `cadeiras_projetadas`. Só aí a projeção conta. A
 *     totalização final tem precedência (RF-267): a UF entra com o resultado
 *     do TSE. E uma UF em que o leitor tolerante descartou o
 *     `cadeiras_projetadas` de alguma agremiação conta a parcial INTEIRA —
 *     misturar parcial e projeção dentro de um mesmo estado faria a soma da UF
 *     deixar de fechar com as vagas dela;
 *   - **cenário** de uma agremiação = Σ `cadeiras_projetadas` nas UFs
 *     liberadas + Σ `cadeiras` nas demais UFs COM DADO. UF sem dado fica FORA
 *     da soma e é listada (`ufs_sem_dado`) — nunca vira zero (decisão do dono,
 *     "três estados": não começou / não sabemos / apurando);
 *   - **linhas**: toda candidatura com marca derivada por `marcasDaLinha` (a
 *     MESMA precedência das páginas de UF), como tupla compacta. A ordem é
 *     fixa (constituição § 6): UF por sigla, depois `rank`, depois `sqcand`.
 *
 * ## O que NUNCA sai daqui
 *
 *   - `votos_projetados` (RF-297: voto projetado por candidato nunca numa
 *     página nacional). A tupla não tem posição para ele;
 *   - dado de projeção com o interruptor desligado: `aplicarInterruptorProjecao`
 *     apaga os campos de cada UF antes de qualquer conta, e o cenário é a
 *     parcial (`projecao_desligada: true`). A ilha cliente ainda confere a
 *     leitura da PÁGINA (ADR-0063 emenda 04/10 (2), item 5) — o CDN pode
 *     servir uma resposta anterior ao desligamento.
 *
 * Os tipos moram aqui (e não em `lib/edge-config/types.ts`): são o contrato
 * desta rota, não do payload. O componente cliente só os importa com
 * `import type` — este módulo lê o Blob por tabela e nunca vai ao navegador.
 */

import { aplicarInterruptorProjecao, type DeputadoUfDetail } from "@/lib/blob/deputado-uf";
import { fotosDosEleitos } from "@/lib/deputado/fotos-eleitos";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import {
  BIT_MARCA,
  bitsDasMarcas,
  type ContextoMarcas,
  marcasDaLinha,
  projecaoVisivel,
} from "@/lib/utils/deputado-marcas";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

// ---------------------------------------------------------------------------
// Contrato da rota `GET /deputado-federal/eleitos`
// ---------------------------------------------------------------------------

/**
 * Uma candidatura marcada, em posição fixa (o molde da `LinhaCompacta` de
 * `lib/utils/deputado-marcas.ts`, ADR-0065 D5): a resposta tem centenas de
 * linhas, e os nomes das chaves repetidos em cada uma seriam peso sem leitor.
 *
 *   0 `uf` · 1 `sqcand` · 2 nome de exibição · 3 partido (`""` em partido
 *   isolado — a coluna só existe em federação) · 4 número de urna ou `null` ·
 *   5 voto APURADO · 6 % dos válidos da UF ou `null` · 7 bits de marca JÁ
 *   derivados (`BIT_MARCA`) · 8 URL da foto, só em eleito na parcial/TSE com
 *   foto publicada (RF-291), ausente nos demais.
 *
 * Não há posição para voto projetado (RF-297).
 */
export type LinhaEleitoNacional = readonly [
  uf: string,
  sqcand: number,
  nome: string,
  partido: string,
  numero: number | null,
  votos: number,
  pctValidos: number | null,
  marcas: number,
  foto?: string,
];

/** Uma agremiação nacional (`cod`), somada sobre as UFs com dado. */
export interface AgremiacaoEleitosNacional {
  /** A chave nacional — a mesma de `bancada.por_agremiacao[].cod`. */
  cod: string;
  /** A sigla da agremiação, como a primeira UF (por sigla) a publica. */
  sigla: string;
  /** Σ `cadeiras` (a parcial) das UFs com dado. */
  parcial: number;
  /**
   * O cenário misto: Σ `cadeiras_projetadas` nas UFs liberadas + Σ `cadeiras`
   * nas demais UFs com dado. Igual a `parcial` com a projeção desligada.
   */
  cenario: number;
  /** UF por sigla, depois `rank`. Só candidaturas com marca. */
  linhas: LinhaEleitoNacional[];
}

/** O corpo de `GET /deputado-federal/eleitos`. */
export interface EleitosNacionais {
  /** O `ts` mais recente entre os objetos de UF lidos, ou `null` sem nenhum. */
  ts: string | null;
  /** O interruptor lido pela ROTA estava desligado — nenhum dado de projeção saiu. */
  projecao_desligada: boolean;
  /** Quantas UFs a casa tem (a lista fechada de `ufsDoCargo(6)`), nunca um literal. */
  ufs_total: number;
  /** UFs cuja projeção conta no cenário (X do rótulo), por sigla. */
  ufs_liberadas: string[];
  /** UFs com dado que contam a parcial (Y do rótulo), por sigla. */
  ufs_parcial: string[];
  /** UFs com totalização final — contam o resultado do TSE (RF-267), por sigla. */
  ufs_tse: string[];
  /** UFs que não puderam ser lidas — FORA da soma, nunca zero (Z do rótulo), por sigla. */
  ufs_sem_dado: string[];
  /** Por `cod` asc. Toda agremiação que aparece em alguma UF com dado, inclusive com zero. */
  agremiacoes: AgremiacaoEleitosNacional[];
}

/** O que a rota leu de UMA UF. `detail: null` ⇔ não pôde ser lida (qualquer motivo). */
export interface LeituraUfNacional {
  uf: string;
  detail: DeputadoUfDetail | null;
  /** `sqcand` (string) com foto publicada na fatia de candidaturas da UF (RF-291). */
  comFoto?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// O agregador
// ---------------------------------------------------------------------------

/** Os bits que dizem "eleito na parcial" no objeto v1, que não diz a via. */
const BITS_PARCIAL_V1 = BIT_MARCA.PARCIAL | BIT_MARCA.PARCIAL_SEM_VIA;

interface Acumulado {
  sigla: string;
  parcial: number;
  cenario: number;
  linhas: Array<{ rank: number; tupla: LinhaEleitoNacional }>;
}

type LinhaSemFoto = readonly [
  uf: string,
  sqcand: number,
  nome: string,
  partido: string,
  numero: number | null,
  votos: number,
  pctValidos: number | null,
  marcas: number,
];

function porSigla(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * As linhas marcadas de UMA agremiação numa UF, sem foto, com o `rank` para
 * ordenar. v2: `candidatos` pela precedência de `marcasDaLinha`; v1 (sem
 * `candidatos`): `eleitos[]` como parcial, sem via, sem % nem número (RF-276).
 */
function linhasDaAgremiacao(
  uf: string,
  agr: DeputadoUfDetail["agremiacoes"][number],
  ctx: ContextoMarcas,
): Array<{ rank: number; linha: LinhaSemFoto }> {
  const partidoVisivel = (partido: string) =>
    agr.tipo === "federacao" ? siglaExibicao(partido) : "";
  const saida: Array<{ rank: number; linha: LinhaSemFoto }> = [];

  if (agr.candidatos) {
    for (const c of agr.candidatos) {
      const bits = bitsDasMarcas(marcasDaLinha(c, ctx));
      if (bits === 0) continue;
      saida.push({
        rank: c.rank,
        linha: [
          uf,
          c.sqcand,
          nomeExibicao(c.nome, String(c.sqcand)),
          partidoVisivel(c.partido),
          typeof c.numero === "number" ? c.numero : null,
          c.votos,
          typeof c.pct_validos === "number" ? c.pct_validos : null,
          bits,
        ],
      });
    }
    return saida;
  }

  const eleitos = [...agr.eleitos].sort((a, b) => a.ordem - b.ordem || a.sqcand - b.sqcand);
  eleitos.forEach((c, i) => {
    saida.push({
      rank: i + 1,
      linha: [
        uf,
        c.sqcand,
        nomeExibicao(c.nome, String(c.sqcand)),
        partidoVisivel(c.partido),
        null,
        c.votos,
        null,
        BITS_PARCIAL_V1 | (c.indefinido === true ? BIT_MARCA.PARCIAL_APERTADA : 0),
      ],
    });
  });
  return saida;
}

/**
 * A UF é liberada para o cenário? Ver o cabeçalho: projeção visível, sem
 * totalização final, e TODA agremiação com `cadeiras_projetadas` numérico.
 */
function ufLiberada(detail: DeputadoUfDetail, interruptor: InterruptorProjecaoLido): boolean {
  return (
    projecaoVisivel(detail.projecao, interruptor.ligada) &&
    detail.totalizacao_final !== true &&
    detail.agremiacoes.every((a) => typeof a.cadeiras_projetadas === "number")
  );
}

/**
 * Agrega as leituras das UFs num {@link EleitosNacionais}. Pura (a URL da
 * foto sai de `candidatoFotoUrl`, que lê a base do Blob do ambiente — a mesma
 * regra das páginas de UF). Mesma entrada ⇒ mesma saída, na mesma ordem,
 * qualquer que seja a ordem das leituras.
 *
 * `leituras` deve trazer TODAS as UFs da casa — inclusive as que falharam,
 * com `detail: null` —, porque `ufs_total` é o tamanho dela.
 */
export function agregarEleitosNacionais(
  leituras: readonly LeituraUfNacional[],
  interruptor: InterruptorProjecaoLido,
): EleitosNacionais {
  const ordenadas = [...leituras].sort((a, b) => porSigla(a.uf, b.uf));
  const acumulado = new Map<string, Acumulado>();
  const ufsLiberadas: string[] = [];
  const ufsParcial: string[] = [];
  const ufsTse: string[] = [];
  const ufsSemDado: string[] = [];
  let ts: string | null = null;

  for (const { uf: ufBruta, detail: lido, comFoto } of ordenadas) {
    const uf = ufBruta.toUpperCase();
    if (!lido) {
      ufsSemDado.push(uf);
      continue;
    }
    if (ts === null || Date.parse(lido.ts) > Date.parse(ts)) ts = lido.ts;

    // RF-265 — o interruptor apaga a projeção do objeto LIDO antes de
    // qualquer conta; a segunda leitura (`projecaoVisivel`) é a de sempre.
    const detail = aplicarInterruptorProjecao(lido, interruptor);
    const tf = detail.totalizacao_final === true;
    const liberada = ufLiberada(detail, interruptor);
    if (liberada) ufsLiberadas.push(uf);
    else if (tf) ufsTse.push(uf);
    else ufsParcial.push(uf);

    const ctx: ContextoMarcas = { totalizacaoFinal: tf, projecaoVisivel: liberada };
    for (const agr of detail.agremiacoes) {
      let acc = acumulado.get(agr.cod);
      if (!acc) {
        acc = { sigla: agr.sigla, parcial: 0, cenario: 0, linhas: [] };
        acumulado.set(agr.cod, acc);
      }
      acc.parcial += agr.cadeiras;
      acc.cenario += liberada ? (agr.cadeiras_projetadas ?? agr.cadeiras) : agr.cadeiras;

      const linhas = linhasDaAgremiacao(uf, agr, ctx);
      // RF-291 — a URL só para eleito na parcial/TSE com foto publicada.
      const fotos = comFoto
        ? fotosDosEleitos(
            uf,
            linhas.map(({ linha }) => [linha[1], linha[7]] as const),
            comFoto,
          )
        : {};
      for (const { rank, linha } of linhas) {
        const foto = fotos[String(linha[1])];
        acc.linhas.push({ rank, tupla: foto ? [...linha, foto] : linha });
      }
    }
  }

  const agremiacoes: AgremiacaoEleitosNacional[] = [...acumulado.entries()]
    .sort(([a], [b]) => porSigla(a, b))
    .map(([cod, acc]) => ({
      cod,
      sigla: acc.sigla,
      parcial: acc.parcial,
      cenario: acc.cenario,
      // UF por sigla (as UFs já foram percorridas nessa ordem — a ordenação
      // abaixo é estável e só reaplica rank e sqcand dentro de cada UF).
      linhas: acc.linhas
        .sort(
          (a, b) => porSigla(a.tupla[0], b.tupla[0]) || a.rank - b.rank || a.tupla[1] - b.tupla[1],
        )
        .map((l) => l.tupla),
    }));

  return {
    ts,
    projecao_desligada: !interruptor.ligada,
    ufs_total: ordenadas.length,
    ufs_liberadas: ufsLiberadas,
    ufs_parcial: ufsParcial,
    ufs_tse: ufsTse,
    ufs_sem_dado: ufsSemDado,
    agremiacoes,
  };
}
