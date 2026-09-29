// data-pipeline/trajetoria-senado.ts
//
// **Trajetória no Senado** de cada candidatura a Senador (cargo 5) de 2026:
// quem tenta a reeleição, quem volta ao cargo e quem é estreante. Puro: nem
// rede, nem disco. O I/O vive em `senado-fonte.ts` (cliente) e
// `trajetoria-senado-cli.ts`; o casamento, em `casamento-nome.ts`.
//
// ─── Por que casar por nome + nascimento ────────────────────────────────────
//
// `ST_REELEICAO` vale `#NE` em 100% das candidaturas de todos os cargos
// (medido em 29/09/2026), e o Senado não publica CPF. O que as duas fontes
// têm em comum é o nome civil e a data de nascimento — e só isso. O método é
// o de `trajetoria-camara.ts` (ADR-0058), com a fonte trocada para o Senado
// Federal — Dados Abertos (ADR-0062 item 5).
//
// ─── Categorias (dado interno = rótulo público do dono, 29/09) ──────────────
//
//   em_exercicio      → "Tenta a reeleição": HOJE ocupa uma das 54 cadeiras
//                       cujo mandato termina em 2027-01-31 — titular (mesmo
//                       afastado) ou suplente em exercício;
//   mandato_anterior  → "Volta ao cargo": exerceu mandato de senador em algum
//                       momento das legislaturas 50–57 (1995→), mas não ocupa
//                       hoje uma cadeira de 2027;
//   estreante         → "Estreante no cargo": nenhum casamento.
//
// **Ausência é `estreante` só se a fonte foi lida por inteiro** — a CLI aborta
// quando qualquer detalhe de senador falha, e o arquivo carrega `universo`
// (quantas candidaturas ele cobre) para o consumidor afirmar "este `sqcand`
// está fora do arquivo" em vez de inferir "estreante" por ausência.
//
// ⚠️ **Limite conhecido:** o histórico começa na 50ª legislatura (1995). Quem
// foi senador só antes disso e concorre agora sai `estreante`. Idem quem o
// Senado não informa a data de nascimento (`semNascimento` no resumo).
//
// ─── A exceção de PII: UMA função lê DT_NASCIMENTO do TSE ────────────────────
//
// `candidatoSenadoDaLinha` é a única função deste caminho que lê
// `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO` do TSE. Os valores viram argumento
// de `calcularTrajetoriaSenado` e morrem ali: nunca entram no arquivo, nunca
// são logados. O arquivo derivado é montado campo a campo em
// `montarArquivoTrajetoria` (lista branca): `t` e códigos públicos do Senado.
//
// O ponto equivalente da Câmara é `trajetoriaDaLinha`, em
// `trajetoria-camara-calculo.ts`. A invariante é "um ponto de leitura por
// casa": são DOIS no projeto, um para a Câmara e este para o Senado.

import { type CarimboRevisao, carimboPendente } from "./_revisao-derivado.ts";
import { campo, opcional } from "./candidatos-parse.ts";
import {
  casar,
  type IdentificacaoCandidato,
  type IndiceCasamento,
  isoDeDataTse,
  type ModoCasamento,
  type PessoaCasavel,
} from "./casamento-nome.ts";
import {
  type Cadeira,
  cadeiraDoFim,
  type DetalheSenador,
  type ParlamentarSenado,
} from "./senado-parse.ts";

/** Único cargo para o qual a trajetória do Senado é calculada. */
export const CARGO_SENADOR = 5;

/** Primeira legislatura do histórico (1995–1999). */
export const LEGISLATURA_INICIAL_HISTORICO = 50;
/** Legislatura em curso (2023–2027). */
export const LEGISLATURA_ATUAL_SENADO = 57;

export const TRAJETORIAS_SENADO = ["em_exercicio", "mandato_anterior", "estreante"] as const;
export type TrajetoriaSenado = (typeof TRAJETORIAS_SENADO)[number];

export const FONTE_TRAJETORIA_SENADO = {
  // O método (casamento em memória) fica no ADR-0062 e na metodologia, não aqui:
  // o arquivo não menciona o que não carrega.
  descricao:
    "Senado Federal — Dados Abertos (senadores em exercício e das legislaturas 50 a 57), " +
    "casados com as candidaturas do cadastro do TSE",
  url: "https://legis.senado.leg.br/dadosabertos/",
} as const;

// ---------------------------------------------------------------------------
// Histórico de senadores
// ---------------------------------------------------------------------------

export interface SenadorHistorico extends PessoaCasavel {
  codigo: number;
}

/**
 * Une listas de parlamentares (legislaturas, em exercício, afastados) por
 * código. O código é o único ponto de junção; nome e partido de quem aparece em
 * mais de uma lista não importam aqui.
 */
export function codigosDoUniverso(listas: ReadonlyArray<readonly ParlamentarSenado[]>): number[] {
  const codigos = new Set<number>();
  for (const lista of listas) for (const p of lista) codigos.add(p.codigo);
  return [...codigos].sort((a, b) => a - b);
}

export interface Historico {
  senadores: SenadorHistorico[];
  /** Contagens para o log; nunca nomes nem datas. */
  semNomeCivil: number;
  semNascimento: number;
}

/**
 * Junta o universo de códigos aos detalhes (nome civil + nascimento). Código
 * sem detalhe **lança**: um senador que some do índice viraria "estreante" em
 * silêncio. Sem nome civil ou sem nascimento o senador entra no histórico mas
 * não casa (fica fora dos dois índices) — contado, não calado.
 */
export function montarHistorico(
  codigos: readonly number[],
  detalhes: ReadonlyMap<number, DetalheSenador>,
): Historico {
  const senadores: SenadorHistorico[] = [];
  let semNomeCivil = 0;
  let semNascimento = 0;
  for (const codigo of codigos) {
    const d = detalhes.get(codigo);
    if (!d) throw new Error(`senador ${codigo} sem detalhe — o histórico ficaria incompleto`);
    if (!d.nomeCivil) semNomeCivil++;
    if (!d.nascimento) semNascimento++;
    senadores.push({
      codigo,
      nomeCivil: d.nomeCivil ?? "",
      nomeParlamentar: d.nomeParlamentar,
      // Sem nome civil o casamento exato seria contra a chave vazia; a data some
      // junto para o senador não entrar em nenhum índice.
      nascimento: d.nomeCivil && d.nascimento ? d.nascimento : "",
    });
  }
  return { senadores, semNomeCivil, semNascimento };
}

/**
 * Quem ocupa hoje uma cadeira do Senado e de qual mandato (`2027` = as 54 em
 * disputa; `2031` = as 27 que continuam):
 *
 *  - todos os **em exercício** (titulares e suplentes empossados);
 *  - os **titulares afastados** (ministro, governador, licença): seguem donos da
 *    cadeira. Suplente afastado **não** ocupa nada.
 *
 * Fim de mandato que não seja 2027-01-31 nem 2031-01-31 lança: seria um
 * formato novo, e ignorá-lo tiraria alguém da contagem sem aviso.
 */
export function ocupacaoAtual(
  emExercicio: readonly ParlamentarSenado[],
  afastados: readonly ParlamentarSenado[],
): Map<number, Cadeira> {
  const out = new Map<number, Cadeira>();
  const registrar = (p: ParlamentarSenado, m: ParlamentarSenado["mandatos"][number]) => {
    const cadeira = cadeiraDoFim(m.fim);
    if (cadeira === null) {
      throw new Error(`mandato do senador ${p.codigo} termina em ${m.fim}: nem 2027 nem 2031`);
    }
    out.set(p.codigo, cadeira);
  };
  for (const p of emExercicio) for (const m of p.mandatos) registrar(p, m);
  for (const p of afastados) {
    for (const m of p.mandatos) {
      if (m.participacao === "Titular" && !out.has(p.codigo)) registrar(p, m);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leitura do TSE (o ponto único de leitura de DT_NASCIMENTO neste caminho)
// ---------------------------------------------------------------------------

/**
 * Arquivos por UF do cadastro, sem os agregados: `_BR` (presidente) e
 * `_BRASIL` (a união de todos) duplicariam linhas. São 27, um por UF.
 */
export function arquivosPorUf(nomes: readonly string[]): string[] {
  return nomes
    .filter((f) => /^consulta_cand_2026_[A-Z]{2}\.csv$/.test(f) && !f.endsWith("_BR.csv"))
    .sort();
}

export interface CandidatoSenadoTse {
  /** `SQ_CANDIDATO` — texto, nunca número. */
  sqcand: string;
  uf: string;
  /** **Transitório.** Não sai da chamada de `calcularTrajetoriaSenado`. */
  identificacao: IdentificacaoCandidato;
}

/**
 * Uma linha do `consulta_cand_2026_<UF>.csv` → candidato ao Senado, ou `null`
 * se não for cargo 5. Lê `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO`: ver o
 * cabeçalho. CPF, e-mail e título de eleitor nunca são lidos.
 */
export function candidatoSenadoDaLinha(
  campos: readonly string[],
  header: Map<string, number>,
): CandidatoSenadoTse | null {
  if (Number(campo(campos, header, "CD_CARGO")) !== CARGO_SENADOR) return null;
  return {
    sqcand: campo(campos, header, "SQ_CANDIDATO"),
    uf: campo(campos, header, "SG_UF"),
    identificacao: {
      nomeCivil: campo(campos, header, "NM_CANDIDATO"),
      nomeUrna: campo(campos, header, "NM_URNA_CANDIDATO"),
      nomeSocial: opcional(campo(campos, header, "NM_SOCIAL_CANDIDATO")),
      nascimento: isoDeDataTse(campo(campos, header, "DT_NASCIMENTO")),
    },
  };
}

/**
 * `DS_OCUPACAO` declara SENADOR? **Só para a conferência da CLI** — a ocupação
 * fica fora do pipeline (ADR-0039) e este booleano nunca chega a um arquivo.
 */
export function declaraOcupacaoSenador(
  campos: readonly string[],
  header: Map<string, number>,
): boolean {
  return campo(campos, header, "DS_OCUPACAO").trim().toUpperCase() === "SENADOR";
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface ResultadoTrajetoriaSenado {
  t: TrajetoriaSenado;
  /** Códigos do Senado casados, crescentes. Vazio = estreante. */
  senado_codigos: number[];
  modo: ModoCasamento;
  /** Casou com quem ocupa hoje uma cadeira de 2031 — não deveria candidatar-se ao Senado em 2026. */
  cadeira2031: boolean;
}

/**
 * Categoria, nesta precedência:
 *   sem casamento                                → `estreante`
 *   algum casado ocupa hoje cadeira de 2027      → `em_exercicio`
 *   caso contrário                               → `mandato_anterior`
 *
 * Quem casa com titular/suplente de uma cadeira de **2031** cai em
 * `mandato_anterior` e vem marcado `cadeira2031: true`: a cadeira dele NÃO está
 * em disputa, então "tenta a reeleição" seria falso, e o caso é anômalo o
 * bastante para a CLI listar.
 */
export function calcularTrajetoriaSenado(
  cand: IdentificacaoCandidato,
  indice: IndiceCasamento<SenadorHistorico>,
  ocupacao: ReadonlyMap<number, Cadeira>,
): ResultadoTrajetoriaSenado {
  const { casados, modo } = casar(cand, indice);
  const codigos = [...new Set(casados.map((s) => s.codigo))].sort((a, b) => a - b);
  const cadeiras = codigos.map((c) => ocupacao.get(c));
  const t: TrajetoriaSenado =
    codigos.length === 0
      ? "estreante"
      : cadeiras.includes("2027")
        ? "em_exercicio"
        : "mandato_anterior";
  return {
    t,
    senado_codigos: codigos,
    modo,
    cadeira2031: cadeiras.includes("2031"),
  };
}

export interface ResumoTrajetorias {
  total: number;
  porCategoria: Record<TrajetoriaSenado, number>;
  porModo: Record<ModoCasamento, number>;
  /** `sqcand` com mais de um senador casado. */
  comMaisDeUmCasado: string[];
  /** `sqcand` que casaram com cadeira de 2031. */
  cadeira2031: string[];
}

export interface TrajetoriasCalculadas {
  /** Por `sqcand`, na ordem numérica crescente. */
  porSqcand: Map<string, ResultadoTrajetoriaSenado>;
  resumo: ResumoTrajetorias;
}

/**
 * Calcula a trajetória de cada candidato. `sqcand` repetido (a mesma
 * candidatura em dois arquivos) conta uma vez — o primeiro vale.
 */
export function calcularTrajetorias(
  candidatos: readonly CandidatoSenadoTse[],
  indice: IndiceCasamento<SenadorHistorico>,
  ocupacao: ReadonlyMap<number, Cadeira>,
): TrajetoriasCalculadas {
  const calculados = new Map<string, ResultadoTrajetoriaSenado>();
  for (const c of candidatos) {
    if (calculados.has(c.sqcand)) continue;
    calculados.set(c.sqcand, calcularTrajetoriaSenado(c.identificacao, indice, ocupacao));
  }
  const ordenado = new Map(
    [...calculados.entries()].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)),
  );
  const resumo: ResumoTrajetorias = {
    total: ordenado.size,
    porCategoria: { em_exercicio: 0, mandato_anterior: 0, estreante: 0 },
    porModo: { exato: 0, aproximado: 0, nenhum: 0 },
    comMaisDeUmCasado: [],
    cadeira2031: [],
  };
  for (const [sq, r] of ordenado) {
    resumo.porCategoria[r.t]++;
    resumo.porModo[r.modo]++;
    if (r.senado_codigos.length > 1) resumo.comMaisDeUmCasado.push(sq);
    if (r.cadeira2031) resumo.cadeira2031.push(sq);
  }
  return { porSqcand: ordenado, resumo };
}

// ---------------------------------------------------------------------------
// Arquivo derivado
// ---------------------------------------------------------------------------

export interface ArquivoTrajetoriaSenado {
  /** Sempre pendente aqui — regenerar zera a revisão do dono (spec 024, RF-223). */
  revisao: CarimboRevisao;
  gerado_em: string;
  fonte: { descricao: string; url: string };
  /** Quantas candidaturas de cargo 5 o arquivo cobre: ausente ≠ estreante. */
  universo: number;
  por_sqcand: Record<string, { t: TrajetoriaSenado; senado_codigos: number[] }>;
}

/**
 * `editorial/derivados/trajetoria-senado.json`. **Lista branca por
 * construção**: cada entrada é `{ t, senado_codigos }`, montada campo a campo.
 * Nome civil, nascimento, modo do casamento e a marca `cadeira2031` ficam
 * fora — o modo e a marca são do relatório, não do dado publicado.
 */
export function montarArquivoTrajetoria(
  calculadas: TrajetoriasCalculadas,
  geradoEm: string,
): ArquivoTrajetoriaSenado {
  const por_sqcand: ArquivoTrajetoriaSenado["por_sqcand"] = {};
  for (const [sq, r] of calculadas.porSqcand) {
    por_sqcand[sq] = { t: r.t, senado_codigos: [...r.senado_codigos] };
  }
  return {
    revisao: carimboPendente(),
    gerado_em: geradoEm,
    fonte: { ...FONTE_TRAJETORIA_SENADO },
    universo: calculadas.porSqcand.size,
    por_sqcand,
  };
}
