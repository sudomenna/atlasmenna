// data-pipeline/zonas-faltantes-nucleo.ts
//
// Núcleo PURO de `zonas-faltantes-import.ts` — sem disco, sem rede, sem banco.
// Tudo aqui recebe dados já lidos e devolve dados; é o que os testes exercitam
// (`tests/unit/data-pipeline/zonas-faltantes-import.test.ts`). O I/O (ler o
// EA12, ler o banco, gravar) vive no irmão `zonas-faltantes-import.ts`.
//
// ─── O que este script conserta ─────────────────────────────────────────────
//
// `zonas` (pares município × zona) decide QUAIS arquivos EA20 pedimos ao TSE,
// para todos os cargos (`lib/tse/targets.ts`). Quando um par que o EA12 lista
// não está em `zonas`, o arquivo dele nunca é pedido: os votos daquele par
// somem em silêncio, e o total da UF nunca fecha com o agregado do TSE. Mesma
// classe de falha do DF em 27/09 (runbook § "Carregar o eleitorado do DF").
// Medido em 29/09 contra o EA12 do simulado (`mun-e021270-cm.json`): faltam
// AP Macapá zona 14 (19,5 % do eleitorado do AP) e PE Fernando de Noronha
// zona 4.
//
// ─── De onde vem o peso (`eleitorado.eleitores_aptos`) ──────────────────────
//
// O peso do par é o `e.te` do EA20 OFICIAL da zona daquele par (o arquivo
// `<uf><mun5>-z<zona4>-c0001-e<ele6>-u.json`, fatia do município — provado no
// Passo 0 do protocolo do simulado). Duas fontes, nesta ordem:
//
//   1. arquivo-zona — o EA20 do par, baixado à parte e guardado como fixture
//      (`--zonas-dir`). Fonte primária, a mesma do DF.
//   2. derivado — quando o arquivo não foi baixado: `te` do agregado de UF
//      (EA20 oficial, já no banco) menos a soma do `te` de todos os OUTROS
//      pares oficiais da UF (EA20 oficiais de zona, já no banco). É aritmética
//      exata sobre números oficiais — as 25 UFs sem par faltante fecham ao
//      eleitor (diferença 0) por essa mesma conta em 29/09 — mas só é
//      inequívoca com UM par faltante por UF. Só grava com
//      `--aceitar-te-derivado`.
//
// Quando as duas existem, têm de ser IGUAIS (a conferência cruzada é o que
// dá confiança ao arquivo baixado à parte).
//
// ─── O limite que a soma dos pesos revela (e os modos) ──────────────────────
//
// Os pesos JÁ existentes em `eleitorado` vêm do CSV municipal de 2024
// (`eleitorado-import.ts`), não do cadastro de 2026. Onde o TSE redistribuiu
// zonas (Macapá, Recife), o peso antigo de uma zona ainda inclui eleitores que
// hoje pertencem à zona nova. Inserir só o par faltante, sem corrigir os
// vizinhos, CONTA ESSES ELEITORES DUAS VEZES — e a soma dos pesos da UF passa
// a ficar mais longe do agregado do TSE do que antes. `verificarTotais`
// mede isso e `planejar` trava a escrita quando a inserção PIORA a distância
// (situação "PIORA").
//
// 🔴 DECISÃO DO DONO (29/09): o eleitorado do SIMULADO não é o real (AP: TRE-AP 577.534 ×
// agregado do simulado 628.071). Nenhum `te` de simulado pode virar peso: com EA12 do
// simulado (`f = "s"`), `planejar` BLOQUEIA qualquer peso vindo de `te` (`ea12Simulado`).
// Os modos, todos opt-in e todos na MESMA transação:
//
//   1. `--so-estrutural` — só INSERT dos pares que o EA12 lista e `zonas` não tem, SÓ em
//      `zonas`: nenhuma linha de `eleitorado`, nenhum te lido, nenhum agregado consultado
//      (o do simulado não é critério). É o que se grava agora.
//   2. `--remover-fantasmas` — DELETE, em `zonas` e `eleitorado`, dos pares
//      de `FANTASMAS_AUTORIZADOS` (lista fechada, decisão do dono em 29/09).
//      Só remove par que o EA12 NÃO lista E que tem ZERO snapshots em qualquer
//      cargo; qualquer outra situação é bloqueio (snapshots são append-only,
//      constituição § 10 — par com histórico nunca sai).
//   3. (legado) inserção com te e `--recalcular-pesos-uf <UF,…>` — peso a partir do `te`
//      de EA20 (resíduo do agregado, "derivado", só com `--aceitar-te-derivado`). Só passam
//      com um EA12 que NÃO seja do simulado; com o do simulado, bloqueio.
//   (depois) `--pesos-oficiais` — pesos do arquivo oficial do TSE, em `zonas-pesos-oficiais.ts`.
//
// Nada disso grava sem `--escrever`; o que vai ser alterado é copiado para um
// backup em JSON ANTES da escrita (ver `zonas-faltantes-import.ts`).

import { derivarPares, parseCodigoTse, parseEA12 } from "../lib/tse/ea12-schema.ts";
import { EA20Schema, parseEA20Numeric } from "../lib/tse/ea20-schema.ts";

export const ANO = 2026;
/** Valor gravado em `zonas.fonte` para os pares inseridos por este script. */
export const FONTE_ZONAS = "ea12";
/** Cargo de referência para ler `te` nos snapshots: Presidente (eleição federal). */
export const CARGO_REF = 1;
export const ELEICAO_FEDERAL_PADRAO = "21270";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface Par {
  uf: string;
  codMunicipioTse: number;
  codZona: number;
}

export interface ParEa12 extends Par {
  nomeMunicipio: string;
}

export interface Peso extends Par {
  eleitoresAptos: number;
}

export interface MetaEa12 {
  dg: string;
  hg: string;
  idg: string;
  f: string;
}

/**
 * De onde veio o `te` gravado como peso: `arquivo-zona` (EA20 do par baixado à
 * parte), `derivado` (resíduo do agregado) ou `snapshot` (EA20 de zona que o
 * ingest já gravou — só no recálculo dos pares que já existem).
 */
export type FonteTe = "arquivo-zona" | "derivado" | "snapshot";

export interface TeResolvido extends ParEa12 {
  te: number;
  fonte: FonteTe;
  /** `te` do agregado da UF menos a soma dos demais pares oficiais — `null` se incalculável. */
  residuoUf: number | null;
}

export type Situacao = "FECHA" | "MELHORA" | "PIORA";

export interface VerificacaoUf {
  uf: string;
  agregadoTe: number;
  somaPesosAntes: number;
  somaPesosDepois: number;
  /** Σ pesos − agregado (com sinal). */
  gapAntes: number;
  gapDepois: number;
  /** Final × antes de qualquer mudança. */
  situacao: Situacao;
  /**
   * Σ pesos depois das remoções e das atualizações, ANTES das inserções — a base
   * contra a qual se mede o que a inserção sozinha faz (uma remoção de peso
   * órfão não é dupla contagem; inserir par novo sobre vizinho de 2024 é).
   */
  somaPesosAntesDasInsercoes: number;
  gapAntesDasInsercoes: number;
  /** Final × antes das inserções: o efeito das INSERÇÕES isoladas. */
  situacaoInsercao: Situacao;
}

export class ValidacaoError extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Chaves e utilitários
// ─────────────────────────────────────────────────────────────────────────────

export function chaveDoPar(p: Par): string {
  return `${p.uf}|${p.codMunicipioTse}|${p.codZona}`;
}

function ordenar<T extends Par>(pares: T[]): T[] {
  return pares
    .slice()
    .sort(
      (a, b) =>
        a.uf.localeCompare(b.uf) || a.codMunicipioTse - b.codMunicipioTse || a.codZona - b.codZona,
    );
}

function pad(n: number, largura: number): string {
  return String(n).padStart(largura, "0");
}

export function rotuloDoPar(p: Par): string {
  return `${p.uf} ${pad(p.codMunicipioTse, 5)}×${pad(p.codZona, 4)}`;
}

export function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

// ─────────────────────────────────────────────────────────────────────────────
// EA12 → pares
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pares oficiais do EA12 (sem o exterior — `derivarPares` exclui `ZZ`), sem
 * duplicata, ordenados. Código malformado é ERRO, não descarte silencioso: um
 * par perdido aqui é exatamente a falha que este script existe para achar.
 */
export function lerParesDoEa12(raw: unknown): { pares: ParEa12[]; meta: MetaEa12 } {
  const ea12 = parseEA12(raw);
  const { pares, descartados } = derivarPares(ea12);
  if (descartados > 0) {
    throw new ValidacaoError(
      `EA12 com ${descartados} código(s) malformado(s) — o diff não é confiável. Nada foi feito.`,
    );
  }
  const vistos = new Set<string>();
  const out: ParEa12[] = [];
  for (const p of pares) {
    const par: ParEa12 = {
      uf: p.uf,
      codMunicipioTse: p.codMunicipioTse,
      codZona: p.codZona,
      nomeMunicipio: p.nomeMunicipio,
    };
    const k = chaveDoPar(par);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(par);
  }
  return {
    pares: ordenar(out),
    meta: { dg: ea12.dg, hg: ea12.hg, idg: ea12.idg, f: ea12.f },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff EA12 × zonas × eleitorado
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffPares {
  /** EA12 ∖ zonas — os que este script insere. */
  faltandoEmZonas: ParEa12[];
  /** zonas ∖ EA12 — pares que pedimos ao TSE e o EA12 não lista (só relatório). */
  sobrandoEmZonas: Par[];
  /** zonas ∖ eleitorado — pares sem peso (o modelo descarta a zona). */
  zonasSemPeso: Par[];
  /** EA12 ∖ eleitorado — inclui os faltantes; o que sobra deles é alerta. */
  ea12SemPeso: ParEa12[];
  /** eleitorado ∖ EA12 — peso de par que o EA12 não lista (pode inflar a UF). */
  pesosForaDoEa12: Peso[];
}

export function diffPares(ea12: ParEa12[], zonas: Par[], pesos: Peso[]): DiffPares {
  const kEa12 = new Set(ea12.map(chaveDoPar));
  const kZonas = new Set(zonas.map(chaveDoPar));
  const kPesos = new Set(pesos.map(chaveDoPar));
  return {
    faltandoEmZonas: ordenar(ea12.filter((p) => !kZonas.has(chaveDoPar(p)))),
    sobrandoEmZonas: ordenar(zonas.filter((p) => !kEa12.has(chaveDoPar(p)))),
    zonasSemPeso: ordenar(zonas.filter((p) => !kPesos.has(chaveDoPar(p)))),
    ea12SemPeso: ordenar(ea12.filter((p) => !kPesos.has(chaveDoPar(p)))),
    pesosForaDoEa12: ordenar(pesos.filter((p) => !kEa12.has(chaveDoPar(p)))),
  };
}

export interface LinhaUf {
  uf: string;
  ea12: number;
  zonas: number;
  faltam: number;
  sobram: number;
  ea12SemPeso: number;
  pesosForaDoEa12: number;
  somaPesosForaDoEa12: number;
  agregadoTe: number | null;
  somaPesos: number;
  /** (Σ pesos − agregado) / agregado, em %, ou `null` sem agregado. */
  gapPct: number | null;
}

/** Tabela nacional, uma linha por UF, ordenada por sigla. */
export function tabelaPorUf(
  ea12: ParEa12[],
  zonas: Par[],
  pesos: Peso[],
  agregadoPorUf: Map<string, number>,
): LinhaUf[] {
  const d = diffPares(ea12, zonas, pesos);
  const ufs = new Set<string>([
    ...ea12.map((p) => p.uf),
    ...zonas.map((p) => p.uf),
    ...pesos.map((p) => p.uf),
  ]);
  const cont = <T extends Par>(xs: T[], uf: string) => xs.filter((p) => p.uf === uf).length;
  return [...ufs].sort().map((uf) => {
    const somaPesos = pesos.filter((p) => p.uf === uf).reduce((a, p) => a + p.eleitoresAptos, 0);
    const foraEa12 = d.pesosForaDoEa12.filter((p) => p.uf === uf);
    const agg = agregadoPorUf.get(uf) ?? null;
    return {
      uf,
      ea12: cont(ea12, uf),
      zonas: cont(zonas, uf),
      faltam: cont(d.faltandoEmZonas, uf),
      sobram: cont(d.sobrandoEmZonas, uf),
      ea12SemPeso: cont(d.ea12SemPeso, uf),
      pesosForaDoEa12: foraEa12.length,
      somaPesosForaDoEa12: foraEa12.reduce((a, p) => a + p.eleitoresAptos, 0),
      agregadoTe: agg,
      somaPesos,
      gapPct: agg && agg > 0 ? ((somaPesos - agg) / agg) * 100 : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Arquivo de zona (EA20 oficial do par) → te
// ─────────────────────────────────────────────────────────────────────────────

const ARQUIVO_ZONA_RE = /^([a-z]{2})(\d{5})-z(\d{4})-c0001-e(\d{6})-u\.json$/;

export function nomeArquivoZona(p: Par, eleicao: string): string {
  return `${p.uf.toLowerCase()}${pad(p.codMunicipioTse, 5)}-z${pad(p.codZona, 4)}-c0001-e${pad(
    Number(eleicao),
    6,
  )}-u.json`;
}

/** Decompõe o nome oficial do arquivo; `null` se fora do padrão. */
export function parseNomeArquivoZona(nome: string): { par: Par; eleicao: number } | null {
  const m = ARQUIVO_ZONA_RE.exec(nome);
  if (!m) return null;
  const mun = parseCodigoTse(m[2]!);
  const zona = parseCodigoTse(m[3]!);
  const ele = parseCodigoTse(m[4]!);
  if (mun == null || zona == null || ele == null) return null;
  return { par: { uf: m[1]!.toUpperCase(), codMunicipioTse: mun, codZona: zona }, eleicao: ele };
}

/**
 * `e.te` do EA20 de zona já lido do disco. Confere que o envelope é da zona
 * e da eleição que o NOME do arquivo declara (o nome carrega o município; o
 * envelope, só a zona), e que `te` é inteiro > 0.
 */
export function extrairTeDeArquivoZona(
  nome: string,
  raw: unknown,
): { par: Par; te: number; eleicao: number } {
  const dec = parseNomeArquivoZona(nome);
  if (!dec) {
    throw new ValidacaoError(
      `Nome de arquivo fora do padrão oficial <uf><mun5>-z<zona4>-c0001-e<ele6>-u.json: ${nome}`,
    );
  }
  const env = EA20Schema.parse(raw);
  if (env.tpabr !== "zona") {
    throw new ValidacaoError(`${nome}: tpabr esperado "zona", veio "${env.tpabr}"`);
  }
  const zonaEnv = parseCodigoTse(env.cdabr);
  if (zonaEnv !== dec.par.codZona) {
    throw new ValidacaoError(
      `${nome}: zona do nome (${dec.par.codZona}) não bate com cdabr do envelope ("${env.cdabr}")`,
    );
  }
  const eleEnv = parseCodigoTse(env.ele);
  if (eleEnv !== dec.eleicao) {
    throw new ValidacaoError(
      `${nome}: eleição do nome (${dec.eleicao}) não bate com "ele" do envelope ("${env.ele}")`,
    );
  }
  const te = parseEA20Numeric(env.e.te);
  if (!Number.isInteger(te) || te <= 0) {
    throw new ValidacaoError(`${nome}: e.te="${env.e.te}" — esperado inteiro > 0`);
  }
  return { par: dec.par, te, eleicao: dec.eleicao };
}

// ─────────────────────────────────────────────────────────────────────────────
// te dos pares faltantes
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaResolverTe {
  /** Todos os pares oficiais (EA12, sem exterior). */
  ea12: ParEa12[];
  /** EA12 ∖ zonas. */
  faltantes: ParEa12[];
  /** `te` do EA20 de UF (agregado oficial), por sigla. */
  agregadoPorUf: Map<string, number>;
  /** `te` do EA20 de zona já ingerido, por chave do par (só pares NÃO faltantes). */
  teZonaSnapshots: Map<string, number>;
  /** `te` de arquivo de zona fornecido à parte, por chave do par (só faltantes). */
  teArquivos: Map<string, number>;
}

export interface ResultadoTe {
  resolvidos: TeResolvido[];
  problemas: string[];
}

/**
 * Resolve o `te` de cada par faltante — ver o cabeçalho do arquivo para as duas
 * fontes e a regra de conferência cruzada. Problemas são devolvidos (não
 * lançados) para o relatório mostrar TODOS de uma vez.
 */
export function resolverTeDosFaltantes(e: EntradaResolverTe): ResultadoTe {
  const resolvidos: TeResolvido[] = [];
  const problemas: string[] = [];
  const kFaltantes = new Set(e.faltantes.map(chaveDoPar));
  const ufs = [...new Set(e.faltantes.map((p) => p.uf))].sort();

  for (const uf of ufs) {
    const faltUf = e.faltantes.filter((p) => p.uf === uf);
    const outros = e.ea12.filter((p) => p.uf === uf && !kFaltantes.has(chaveDoPar(p)));
    const semTe = outros.filter((p) => !e.teZonaSnapshots.has(chaveDoPar(p)));
    const agg = e.agregadoPorUf.get(uf);

    let residuo: number | null = null;
    if (agg === undefined) {
      problemas.push(`${uf}: sem agregado de UF (EA20 oficial) no banco — não há como conferir.`);
    } else if (semTe.length > 0) {
      problemas.push(
        `${uf}: ${semTe.length} par(es) oficial(is) sem te de zona no banco (${semTe
          .slice(0, 5)
          .map(rotuloDoPar)
          .join(", ")}${semTe.length > 5 ? ", …" : ""}) — resíduo do agregado incalculável.`,
      );
    } else {
      const somaOutros = outros.reduce((a, p) => a + e.teZonaSnapshots.get(chaveDoPar(p))!, 0);
      residuo = agg - somaOutros;
    }

    const comArquivo = faltUf.filter((p) => e.teArquivos.has(chaveDoPar(p)));
    const semArquivo = faltUf.filter((p) => !e.teArquivos.has(chaveDoPar(p)));
    const somaArquivos = comArquivo.reduce((a, p) => a + e.teArquivos.get(chaveDoPar(p))!, 0);

    const empurra = (p: ParEa12, te: number, fonte: FonteTe) =>
      resolvidos.push({ ...p, te, fonte, residuoUf: residuo });

    if (semArquivo.length === 0) {
      // Todos os faltantes da UF têm arquivo: o fechamento com o agregado é a conferência.
      if (residuo !== null && residuo !== somaArquivos) {
        problemas.push(
          `${uf}: Σ te dos arquivos de zona (${fmt(somaArquivos)}) ≠ agregado − Σ demais pares ` +
            `(${fmt(residuo)}) — diferença de ${fmt(somaArquivos - residuo)}.`,
        );
      }
      for (const p of comArquivo) empurra(p, e.teArquivos.get(chaveDoPar(p))!, "arquivo-zona");
    } else if (semArquivo.length === 1 && residuo !== null) {
      const alvo = semArquivo[0]!;
      const derivado = residuo - somaArquivos;
      if (!(derivado > 0)) {
        problemas.push(
          `${uf}: te derivado de ${rotuloDoPar(alvo)} = ${fmt(derivado)} — esperado > 0.`,
        );
      } else {
        empurra(alvo, derivado, "derivado");
      }
      for (const p of comArquivo) empurra(p, e.teArquivos.get(chaveDoPar(p))!, "arquivo-zona");
    } else {
      problemas.push(
        `${uf}: ${semArquivo.length} par(es) faltante(s) sem arquivo de zona (${semArquivo
          .map(rotuloDoPar)
          .join(", ")}) e a soma sozinha ${
          residuo === null ? "é incalculável" : "não separa mais de um par"
        } — baixe o EA20 de zona do(s) par(es).`,
      );
    }
  }

  return { resolvidos: resolvidos.sort(ordenarPar), problemas };
}

function ordenarPar(a: Par, b: Par): number {
  return a.uf.localeCompare(b.uf) || a.codMunicipioTse - b.codMunicipioTse || a.codZona - b.codZona;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificação dos totais (Σ pesos × agregado)
// ─────────────────────────────────────────────────────────────────────────────

/** Linha de `eleitorado` cujo peso muda (recálculo): `de` é o valor lido no banco. */
export interface AtualizacaoPeso {
  par: ParEa12;
  de: number;
  para: number;
  fonte: FonteTe;
}

function situacaoDe(gapDepois: number, gapAntes: number): Situacao {
  return gapDepois === 0 ? "FECHA" : Math.abs(gapDepois) < Math.abs(gapAntes) ? "MELHORA" : "PIORA";
}

/**
 * Σ pesos × agregado, por UF tocada. `depois = antes − removidos + Σ(para − de) +
 * inseridos`. Sem `atualizacoes`/`removidos` é a conta original (só inserção).
 */
export function verificarTotais(args: {
  pesosAtuais: Peso[];
  /** O que iria para `eleitorado` (já sem os pares que têm peso idêntico no banco). */
  novosPesos: TeResolvido[];
  agregadoPorUf: Map<string, number>;
  atualizacoes?: AtualizacaoPeso[];
  removidos?: Peso[];
  /** UFs a verificar mesmo sem linha nova (recálculo que já estava fechado). */
  ufsExtras?: string[];
}): VerificacaoUf[] {
  const atualizacoes = args.atualizacoes ?? [];
  const removidos = args.removidos ?? [];
  const ufs = [
    ...new Set([
      ...args.novosPesos.map((p) => p.uf),
      ...atualizacoes.map((a) => a.par.uf),
      ...removidos.map((p) => p.uf),
      ...(args.ufsExtras ?? []),
    ]),
  ].sort();
  return ufs.map((uf) => {
    const agregadoTe = args.agregadoPorUf.get(uf);
    if (agregadoTe === undefined) {
      throw new ValidacaoError(`${uf}: sem agregado de UF — não há como verificar os totais.`);
    }
    const antes = args.pesosAtuais
      .filter((p) => p.uf === uf)
      .reduce((a, p) => a + p.eleitoresAptos, 0);
    const tirado = removidos.filter((p) => p.uf === uf).reduce((a, p) => a + p.eleitoresAptos, 0);
    const delta = atualizacoes
      .filter((a) => a.par.uf === uf)
      .reduce((a, x) => a + (x.para - x.de), 0);
    const novo = args.novosPesos.filter((p) => p.uf === uf).reduce((a, p) => a + p.te, 0);
    const antesDasInsercoes = antes - tirado + delta;
    const depois = antesDasInsercoes + novo;
    const gapAntes = antes - agregadoTe;
    const gapDepois = depois - agregadoTe;
    const gapAntesDasInsercoes = antesDasInsercoes - agregadoTe;
    return {
      uf,
      agregadoTe,
      somaPesosAntes: antes,
      somaPesosDepois: depois,
      gapAntes,
      gapDepois,
      situacao: situacaoDe(gapDepois, gapAntes),
      somaPesosAntesDasInsercoes: antesDasInsercoes,
      gapAntesDasInsercoes,
      situacaoInsercao: situacaoDe(gapDepois, gapAntesDasInsercoes),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Divergência dos pesos existentes × te 2026 (informativo, só UFs afetadas)
// ─────────────────────────────────────────────────────────────────────────────

export interface DesvioDePeso {
  par: Par;
  pesoAtual: number;
  te2026: number;
  diferenca: number;
}

/** Pares com peso e te oficial cuja diferença passa de 10 % E de 1.000 eleitores. */
export function desviosDePeso(pesos: Peso[], teZonaSnapshots: Map<string, number>): DesvioDePeso[] {
  const out: DesvioDePeso[] = [];
  for (const p of pesos) {
    const te = teZonaSnapshots.get(chaveDoPar(p));
    if (te === undefined) continue;
    const diferenca = p.eleitoresAptos - te;
    if (Math.abs(diferenca) > 0.1 * te && Math.abs(diferenca) > 1000) {
      out.push({ par: p, pesoAtual: p.eleitoresAptos, te2026: te, diferenca });
    }
  }
  return out.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pares-fantasma (modo --remover-fantasmas)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LISTA FECHADA dos pares que o dono autorizou remover (29/09, "consertar tudo").
 * Medidos contra o EA12 do simulado: estão em `zonas` e o EA12 NÃO os lista — o
 * TSE não deve publicar o EA20 deles, então cada ciclo pede essas URLs por cargo
 * e recebe 404 (a constituição § 1 registra que 404 em rajada pode bloquear o
 * IP). PE 25313×0001 (Recife zona 1) ainda carrega um peso órfão em
 * `eleitorado`; os seis restantes são `fonte='historico'` e não têm peso.
 *
 * A lista é FECHADA de propósito: um EA12 passado por engano (truncado, de outra
 * eleição) faria todo par "sobrar" — só sai daqui o que o dono nomeou.
 */
export const FANTASMAS_AUTORIZADOS: readonly Par[] = [
  { uf: "PE", codMunicipioTse: 25313, codZona: 1 },
  { uf: "PI", codMunicipioTse: 10170, codZona: 92 },
  { uf: "PI", codMunicipioTse: 11118, codZona: 75 },
  { uf: "PI", codMunicipioTse: 11452, codZona: 83 },
  { uf: "PI", codMunicipioTse: 11495, codZona: 31 },
  { uf: "PI", codMunicipioTse: 11614, codZona: 55 },
  { uf: "SP", codMunicipioTse: 71072, codZona: 398 },
];

export interface EntradaFantasmas {
  ea12: ParEa12[];
  zonas: Par[];
  /** Pesos de `eleitorado` (ano=2026). */
  pesos: Peso[];
  /** Nº de snapshots (qualquer cargo, turno e nível) por chave de par autorizado presente no banco. */
  snapshotsPorPar: Map<string, number>;
  /** Vazio = todas as UFs. */
  ufsEscopo: Set<string>;
}

export interface PlanoFantasmas {
  remocoesZonas: Par[];
  remocoesPesos: Peso[];
  /** Autorizados que já não estão em `zonas` nem em `eleitorado` (reexecução). */
  jaRemovidos: Par[];
  /** `zonas ∖ EA12` que NÃO estão na lista autorizada — nunca removidos. */
  naoAutorizados: Par[];
  bloqueios: string[];
}

export const FANTASMAS_VAZIO: PlanoFantasmas = {
  remocoesZonas: [],
  remocoesPesos: [],
  jaRemovidos: [],
  naoAutorizados: [],
  bloqueios: [],
};

/**
 * Decide o que `--remover-fantasmas` remove. Um autorizado só sai se (a) o EA12
 * NÃO o lista e (b) tem ZERO snapshots; senão é bloqueio (nunca remoção parcial).
 */
export function planejarFantasmas(e: EntradaFantasmas): PlanoFantasmas {
  const kEa12 = new Set(e.ea12.map(chaveDoPar));
  const kZonas = new Set(e.zonas.map(chaveDoPar));
  const pesoPorChave = new Map(e.pesos.map((p) => [chaveDoPar(p), p.eleitoresAptos]));
  const kAutorizados = new Set(FANTASMAS_AUTORIZADOS.map(chaveDoPar));
  const remocoesZonas: Par[] = [];
  const remocoesPesos: Peso[] = [];
  const jaRemovidos: Par[] = [];
  const bloqueios: string[] = [];

  for (const g of ordenar([...FANTASMAS_AUTORIZADOS])) {
    if (e.ufsEscopo.size > 0 && !e.ufsEscopo.has(g.uf)) continue;
    const k = chaveDoPar(g);
    if (kEa12.has(k)) {
      bloqueios.push(
        `${rotuloDoPar(g)}: o EA12 agora LISTA este par — não é fantasma; remoção recusada.`,
      );
      continue;
    }
    const emZonas = kZonas.has(k);
    const peso = pesoPorChave.get(k);
    if (!emZonas && peso === undefined) {
      jaRemovidos.push(g);
      continue;
    }
    const n = e.snapshotsPorPar.get(k);
    if (n === undefined) {
      bloqueios.push(
        `${rotuloDoPar(g)}: contagem de snapshots não lida — sem ela a remoção é recusada.`,
      );
      continue;
    }
    if (n > 0) {
      bloqueios.push(
        `${rotuloDoPar(g)}: tem ${fmt(n)} snapshot(s) — par com histórico nunca é removido ` +
          "(snapshots são append-only, constituição § 10); remoção recusada.",
      );
      continue;
    }
    if (emZonas) remocoesZonas.push(g);
    if (peso !== undefined) remocoesPesos.push({ ...g, eleitoresAptos: peso });
  }

  const naoAutorizados = ordenar(
    e.zonas.filter((z) => !kEa12.has(chaveDoPar(z)) && !kAutorizados.has(chaveDoPar(z))),
  );
  return { remocoesZonas, remocoesPesos, jaRemovidos, naoAutorizados, bloqueios };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escopo: quem é faltante e de quem o te precisa ser resolvido
// ─────────────────────────────────────────────────────────────────────────────

type OpcoesDeEscopo = Pick<Opcoes, "ufs" | "recalcularPesosUf">;

const maiusculas = (xs: string[]): Set<string> => new Set(xs.map((u) => u.toUpperCase()));

/**
 * EA12 ∖ zonas dentro do escopo: as UFs de `--uf` (vazio = todas) MAIS as UFs de
 * `--recalcular-pesos-uf` — recalcular uma UF sem inserir o par que falta nela
 * deixaria a soma sem fechar.
 */
export function faltantesNoEscopo(
  ea12: ParEa12[],
  zonas: Par[],
  opcoes: OpcoesDeEscopo,
): ParEa12[] {
  const kZonas = new Set(zonas.map(chaveDoPar));
  const escopo = maiusculas(opcoes.ufs);
  const recalc = maiusculas(opcoes.recalcularPesosUf);
  return ordenar(
    ea12.filter(
      (p) =>
        !kZonas.has(chaveDoPar(p)) && (escopo.size === 0 || escopo.has(p.uf) || recalc.has(p.uf)),
    ),
  );
}

/**
 * Pares cujo `te` NÃO vem de snapshot e precisa de arquivo-zona ou de resíduo: os
 * faltantes do escopo + os pares das UFs recalculadas que existem em `zonas` mas
 * nunca foram ingeridos (o par que acabou de ser inserido, numa segunda execução).
 */
export function alvosDeTe(
  ea12: ParEa12[],
  zonas: Par[],
  opcoes: OpcoesDeEscopo,
  teZonaSnapshots: Map<string, number>,
): ParEa12[] {
  const faltantes = faltantesNoEscopo(ea12, zonas, opcoes);
  const recalc = maiusculas(opcoes.recalcularPesosUf);
  const kFalt = new Set(faltantes.map(chaveDoPar));
  const semTe = ea12.filter(
    (p) => recalc.has(p.uf) && !kFalt.has(chaveDoPar(p)) && !teZonaSnapshots.has(chaveDoPar(p)),
  );
  return ordenar([...faltantes, ...semTe]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plano
// ─────────────────────────────────────────────────────────────────────────────

export interface Opcoes {
  escrever: boolean;
  /** Restringe a UFs (maiúsculas). Vazio = todas as que têm par faltante. */
  ufs: string[];
  aceitarTeDerivado: boolean;
  exigirSomaExata: boolean;
  /** UFs cujos pesos TODOS são regravados com o te 2026 (maiúsculas). */
  recalcularPesosUf: string[];
  /** Remove os pares de `FANTASMAS_AUTORIZADOS` de `zonas` e `eleitorado`. */
  removerFantasmas: boolean;
  /**
   * Só a ESTRUTURA: insere os pares faltantes em `zonas` e nada em `eleitorado`. Não lê
   * `te` nem agregado (o eleitorado do simulado não é o real) e nunca grava peso.
   */
  soEstrutural: boolean;
}

export interface EntradaPlano {
  ea12: ParEa12[];
  zonas: Par[];
  pesos: Peso[];
  agregadoPorUf: Map<string, number>;
  /** `te` de zona ingerido, por chave — pares NÃO faltantes (snapshots). */
  teZonaSnapshots: Map<string, number>;
  teArquivos: Map<string, number>;
  /** Municípios dos faltantes que existem em `municipios` (FK de `zonas`). */
  municipiosExistentes: Set<number>;
  /** Snapshots por par autorizado a sair — só lido com `--remover-fantasmas`. */
  snapshotsPorPar?: Map<string, number>;
  /**
   * O EA12 lido é do SIMULADO (`f = "s"`). O eleitorado do simulado NÃO é o real (AP: TRE-AP
   * 577.534 × agregado do simulado 628.071): com isto ligado, qualquer peso vindo de `te` de
   * EA20 vira bloqueio. Só a estrutura (`--so-estrutural`) e `--pesos-oficiais` passam.
   */
  ea12Simulado?: boolean;
  opcoes: Opcoes;
}

export interface Plano {
  diff: DiffPares;
  /** Faltantes dentro do escopo (`--uf` + UFs recalculadas). */
  faltantes: ParEa12[];
  /** Pares com te resolvido por arquivo-zona ou resíduo (faltantes + sem te em snapshot). */
  resolvidos: TeResolvido[];
  /** Linhas para `zonas` (só os faltantes resolvidos). */
  insercoesZonas: (ParEa12 & { fonte: string })[];
  /** Linhas para `eleitorado` — sem os pares com peso idêntico já no banco. */
  insercoesPesos: TeResolvido[];
  /** UPDATE de `eleitorado.eleitores_aptos` (só UFs de `--recalcular-pesos-uf`). */
  atualizacoesPesos: AtualizacaoPeso[];
  /** Pares de UF recalculada cujo peso já era o te 2026. */
  inalteradosNoRecalculo: number;
  /** DELETE de pares-fantasma (vazio sem `--remover-fantasmas`). */
  fantasmas: PlanoFantasmas;
  /** Pares com peso já no banco (idêntico: pula; diferente: conflito). */
  pesosJaExistentes: { par: Par; pesoBanco: number; te: number }[];
  problemas: string[];
  verificacoes: VerificacaoUf[];
  /** Impedem `--escrever`. Vazio = pode gravar. */
  bloqueios: string[];
  avisos: string[];
}

const sinal = (n: number): string => (n > 0 ? "+" : "");

export function planejar(e: EntradaPlano): Plano {
  const diff = diffPares(e.ea12, e.zonas, e.pesos);
  const recalc = maiusculas(e.opcoes.recalcularPesosUf);
  const estrutural = e.opcoes.soEstrutural;
  const faltantes = faltantesNoEscopo(e.ea12, e.zonas, e.opcoes);
  // modo estrutural: nenhum te é resolvido (nem lido) — o peso não é assunto deste modo
  const alvos = estrutural ? [] : alvosDeTe(e.ea12, e.zonas, e.opcoes, e.teZonaSnapshots);
  const avisos: string[] = [];
  const bloqueios: string[] = [];

  for (const uf of [...recalc].sort()) {
    if (!e.ea12.some((p) => p.uf === uf)) {
      bloqueios.push(`${uf}: --recalcular-pesos-uf sem nenhum par no EA12 — UF inexistente?`);
    }
  }

  // te de cada par a resolver (faltantes + sem te em snapshot nas UFs recalculadas)
  const { resolvidos, problemas } = resolverTeDosFaltantes({
    ea12: e.ea12,
    faltantes: alvos,
    agregadoPorUf: e.agregadoPorUf,
    teZonaSnapshots: e.teZonaSnapshots,
    teArquivos: e.teArquivos,
  });
  for (const p of problemas) bloqueios.push(p);

  const kFaltantes = new Set(faltantes.map(chaveDoPar));
  const resolvPorChave = new Map(resolvidos.map((r) => [chaveDoPar(r), r]));
  for (const p of alvos) {
    if (!resolvPorChave.has(chaveDoPar(p))) {
      bloqueios.push(`${rotuloDoPar(p)} (${p.nomeMunicipio}): sem te resolvido — nada a gravar.`);
    }
  }

  // FK zonas → municipios
  for (const p of faltantes) {
    if (!e.municipiosExistentes.has(p.codMunicipioTse)) {
      bloqueios.push(
        `${rotuloDoPar(p)} (${p.nomeMunicipio}): cod_municipio_tse ${p.codMunicipioTse} não existe ` +
          "em `municipios` — a FK de `zonas` rejeitaria. Municípios é outra tabela: decisão do dono.",
      );
    }
  }

  // te derivado só com aval explícito
  const derivados = resolvidos.filter((r) => r.fonte === "derivado");
  if (derivados.length > 0 && !e.opcoes.aceitarTeDerivado) {
    bloqueios.push(
      `${derivados.length} par(es) com te DERIVADO (${derivados
        .map(rotuloDoPar)
        .join(", ")}) — a fonte oficial é o EA20 de zona do par. Baixe-o para --zonas-dir ` +
        "ou passe --aceitar-te-derivado.",
    );
  }

  // pesos: UFs comuns (idêntico pula, diferente aborta) e UFs recalculadas (grava o te)
  const pesosPorChave = new Map(e.pesos.map((p) => [chaveDoPar(p), p.eleitoresAptos]));
  const pesosJaExistentes: Plano["pesosJaExistentes"] = [];
  const insercoesPesos: TeResolvido[] = [];
  const atualizacoesPesos: AtualizacaoPeso[] = [];
  let inalteradosNoRecalculo = 0;

  for (const r of resolvidos) {
    if (recalc.has(r.uf)) continue; // tratado no recálculo, logo abaixo
    const existente = pesosPorChave.get(chaveDoPar(r));
    if (existente === undefined) {
      insercoesPesos.push(r);
      continue;
    }
    pesosJaExistentes.push({ par: r, pesoBanco: existente, te: r.te });
    if (existente !== r.te) {
      bloqueios.push(
        `${rotuloDoPar(r)}: já existe peso em eleitorado (${fmt(existente)}) DIFERENTE do te ` +
          `calculado (${fmt(r.te)}) — sem --recalcular-pesos-uf ${r.uf} este script nunca sobrescreve.`,
      );
    }
  }
  for (const uf of [...recalc].sort()) {
    for (const p of e.ea12.filter((x) => x.uf === uf)) {
      const k = chaveDoPar(p);
      let alvo = resolvPorChave.get(k);
      if (!alvo) {
        const te = e.teZonaSnapshots.get(k);
        if (te === undefined) continue; // sem te: o bloqueio já foi registrado acima
        alvo = { ...p, te, fonte: "snapshot", residuoUf: null };
      }
      const existente = pesosPorChave.get(k);
      if (existente === undefined) insercoesPesos.push(alvo);
      else if (existente !== alvo.te) {
        atualizacoesPesos.push({ par: p, de: existente, para: alvo.te, fonte: alvo.fonte });
      } else inalteradosNoRecalculo++;
    }
  }
  insercoesPesos.sort(ordenarPar);
  atualizacoesPesos.sort((a, b) => ordenarPar(a.par, b.par));

  // O te do simulado não é o eleitorado real: nenhum peso pode vir dele
  if (e.ea12Simulado && insercoesPesos.length + atualizacoesPesos.length > 0) {
    bloqueios.push(
      `${insercoesPesos.length + atualizacoesPesos.length} linha(s) de peso viriam do te do SIMULADO ` +
        "(EA12 com f='s'), e o eleitorado do simulado NÃO é o real (AP: TRE-AP 577.534 × agregado do " +
        "simulado 628.071). Grave só a estrutura (--so-estrutural [--remover-fantasmas]) e os pesos " +
        "depois, do arquivo oficial do TSE (--pesos-oficiais).",
    );
  }

  // pares-fantasma
  const fantasmas = e.opcoes.removerFantasmas
    ? planejarFantasmas({
        ea12: e.ea12,
        zonas: e.zonas,
        pesos: e.pesos,
        snapshotsPorPar: e.snapshotsPorPar ?? new Map(),
        ufsEscopo: maiusculas(e.opcoes.ufs),
      })
    : FANTASMAS_VAZIO;
  for (const b of fantasmas.bloqueios) bloqueios.push(b);

  // peso órfão numa UF recalculada que ninguém remove: a soma não fecharia
  const kEa12 = new Set(e.ea12.map(chaveDoPar));
  const kRemovidosPeso = new Set(fantasmas.remocoesPesos.map(chaveDoPar));
  for (const uf of [...recalc].sort()) {
    const orfaos = e.pesos.filter(
      (p) => p.uf === uf && !kEa12.has(chaveDoPar(p)) && !kRemovidosPeso.has(chaveDoPar(p)),
    );
    if (orfaos.length > 0) {
      bloqueios.push(
        `${uf}: ${orfaos.length} linha(s) de peso de par que o EA12 não lista (${orfaos
          .map((p) => `${rotuloDoPar(p)}: ${fmt(p.eleitoresAptos)}`)
          .join(", ")}) — o recálculo não as cobre e a soma não fecharia.`,
      );
    }
  }

  // totais
  // (modo estrutural: o agregado do simulado NÃO é critério — nada a verificar contra ele)
  const ufsAVerificar = new Set(
    estrutural
      ? []
      : [
          ...insercoesPesos.map((p) => p.uf),
          ...atualizacoesPesos.map((a) => a.par.uf),
          ...fantasmas.remocoesPesos.map((p) => p.uf),
          ...[...recalc].filter((uf) => e.ea12.some((p) => p.uf === uf)),
        ],
  );
  for (const uf of [...ufsAVerificar].sort()) {
    if (!e.agregadoPorUf.has(uf)) {
      (recalc.has(uf) ? bloqueios : avisos).push(
        `${uf}: sem agregado de UF (EA20 oficial) no banco — a soma dos pesos não pôde ser conferida.`,
      );
    }
  }
  const agregadosOk = new Map([...e.agregadoPorUf].filter(([uf]) => ufsAVerificar.has(uf)));
  // UF sem agregado já virou bloqueio/aviso acima: fica fora da conta (não lança)
  const comAgregado = (uf: string): boolean => agregadosOk.has(uf);
  const verificacoes = verificarTotais({
    pesosAtuais: e.pesos,
    novosPesos: insercoesPesos.filter((p) => comAgregado(p.uf)),
    atualizacoes: atualizacoesPesos.filter((a) => comAgregado(a.par.uf)),
    removidos: fantasmas.remocoesPesos.filter((p) => comAgregado(p.uf)),
    agregadoPorUf: agregadosOk,
    ufsExtras: [...ufsAVerificar].filter(comAgregado),
  });
  for (const v of verificacoes) {
    const temInsercao = insercoesPesos.some((p) => p.uf === v.uf);
    const tirou = fantasmas.remocoesPesos.filter((p) => p.uf === v.uf);
    if (recalc.has(v.uf)) {
      if (v.gapDepois !== 0) {
        bloqueios.push(
          `${v.uf}: recalcular os pesos NÃO fecha com o agregado do TSE (Σ pesos ${fmt(
            v.somaPesosDepois,
          )} × agregado ${fmt(v.agregadoTe)}; ${sinal(v.gapDepois)}${fmt(v.gapDepois)}) — nada é gravado.`,
        );
      }
    } else if (temInsercao && v.situacaoInsercao === "PIORA") {
      bloqueios.push(
        `${v.uf}: inserir os pesos PIORA a soma da UF contra o agregado do TSE ` +
          `(Σ pesos ${fmt(v.somaPesosAntesDasInsercoes)} → ${fmt(v.somaPesosDepois)}; agregado ${fmt(
            v.agregadoTe,
          )}; distância ${fmt(Math.abs(v.gapAntesDasInsercoes))} → ${fmt(Math.abs(v.gapDepois))}). Os pesos ` +
          "existentes da UF são do CSV de 2024 e já incluem eleitores que hoje estão neste par — " +
          "inserir só o par novo os contaria duas vezes. Corrija os pesos vizinhos junto: " +
          `--recalcular-pesos-uf ${v.uf}.`,
      );
    } else if (temInsercao && v.situacaoInsercao === "MELHORA") {
      avisos.push(
        `${v.uf}: Σ pesos após a inserção (${fmt(v.somaPesosDepois)}) não fecha com o agregado ` +
          `(${fmt(v.agregadoTe)}; ${sinal(v.gapDepois)}${fmt(v.gapDepois)}), mas MELHORA ` +
          `a distância (${fmt(Math.abs(v.gapAntesDasInsercoes))} → ${fmt(Math.abs(v.gapDepois))}). O resto é ` +
          "peso de 2024 nos pares vizinhos.",
      );
    }
    if (
      !recalc.has(v.uf) &&
      tirou.length > 0 &&
      Math.abs(v.gapAntesDasInsercoes) > Math.abs(v.gapAntes)
    ) {
      avisos.push(
        `${v.uf}: remover ${tirou.map(rotuloDoPar).join(", ")} tira ${fmt(
          tirou.reduce((a, p) => a + p.eleitoresAptos, 0),
        )} eleitores da soma e a AFASTA do agregado (distância ${fmt(Math.abs(v.gapAntes))} → ${fmt(
          Math.abs(v.gapAntesDasInsercoes),
        )} só pela remoção). O peso removido é de zona que o EA12 não lista, mas os eleitores dela ` +
          "hoje estão em outras zonas cujo peso (CSV de 2024) não os inclui — só " +
          `--recalcular-pesos-uf ${v.uf} fecha a soma.`,
      );
    }
    if (e.opcoes.exigirSomaExata && v.situacao !== "FECHA") {
      bloqueios.push(
        `${v.uf}: --exigir-soma-exata — Σ pesos após (${fmt(v.somaPesosDepois)}) ≠ agregado ` +
          `(${fmt(v.agregadoTe)}).`,
      );
    }
  }

  // modo estrutural: o que fica SEM peso e o que sai da soma
  if (estrutural) {
    const pesoDaZona = (uf: string, zona: number): number =>
      e.pesos
        .filter((p) => p.uf === uf && p.codZona === zona && !kRemovidosPeso.has(chaveDoPar(p)))
        .reduce((a, p) => a + p.eleitoresAptos, 0);
    if (faltantes.length > 0) {
      avisos.push(
        `modo estrutural: ${faltantes.length} par(es) entram em zonas SEM peso em eleitorado até ` +
          "--pesos-oficiais. `_resolve_zone_weight` pesa a zona por Σ dos pares dela: " +
          faltantes
            .map((p) => {
              const w = pesoDaZona(p.uf, p.codZona);
              return w === 0
                ? `${rotuloDoPar(p)} → zona SEM nenhum peso (peso 0): o modelo DESCARTA os votos dela`
                : `${rotuloDoPar(p)} → a zona segue com o peso de ${fmt(w)} dos outros pares, sem a fatia deste`;
            })
            .join("; ") +
          ".",
      );
    }
    const porUf = new Map<string, Peso[]>();
    for (const p of fantasmas.remocoesPesos) porUf.set(p.uf, [...(porUf.get(p.uf) ?? []), p]);
    for (const [uf, tirados] of porUf) {
      const antes = e.pesos.filter((p) => p.uf === uf).reduce((a, p) => a + p.eleitoresAptos, 0);
      const tirou = tirados.reduce((a, p) => a + p.eleitoresAptos, 0);
      avisos.push(
        `${uf}: remover ${tirados.map(rotuloDoPar).join(", ")} tira ${fmt(tirou)} eleitores da soma dos ` +
          `pesos da UF (Σ ${fmt(antes)} → ${fmt(antes - tirou)}). Zona que o EA12 não lista e que ` +
          "nunca vai reportar; os vizinhos seguem com o peso de 2024 até --pesos-oficiais.",
      );
    }
  }

  // alertas que não travam
  const foraDoEscopo = diff.faltandoEmZonas.filter((p) => !kFaltantes.has(chaveDoPar(p)));
  if (foraDoEscopo.length > 0) {
    avisos.push(
      `${foraDoEscopo.length} par(es) faltante(s) fora do escopo --uf: ${foraDoEscopo
        .map(rotuloDoPar)
        .join(", ")}.`,
    );
  }
  const semPesoNaoFaltante = diff.ea12SemPeso.filter(
    (p) => !diff.faltandoEmZonas.some((f) => chaveDoPar(f) === chaveDoPar(p)),
  );
  if (semPesoNaoFaltante.length > 0) {
    const recalculados = semPesoNaoFaltante.filter((p) => recalc.has(p.uf));
    avisos.push(
      `${semPesoNaoFaltante.length} par(es) do EA12 JÁ em zonas mas SEM peso (o modelo os descarta` +
        `${recalculados.length > 0 ? "; os de UF recalculada ganham peso neste plano" : ""}): ${semPesoNaoFaltante
          .map(rotuloDoPar)
          .join(", ")}.`,
    );
  }
  const sobrando = e.opcoes.removerFantasmas ? fantasmas.naoAutorizados : diff.sobrandoEmZonas;
  if (sobrando.length > 0) {
    avisos.push(
      `${sobrando.length} par(es) em zonas que o EA12 NÃO lista (o TSE não deve publicar ` +
        `o arquivo deles → provável 404 a cada ciclo, por cargo; ${
          e.opcoes.removerFantasmas
            ? "fora da lista autorizada — NÃO removidos"
            : "sem --remover-fantasmas este script não remove"
        }): ${sobrando.map(rotuloDoPar).join(", ")}.`,
    );
  }

  return {
    diff,
    faltantes,
    resolvidos,
    insercoesZonas: (estrutural
      ? faltantes
      : resolvidos.filter((r) => kFaltantes.has(chaveDoPar(r)))
    ).map((r) => ({ ...r, fonte: FONTE_ZONAS })),
    insercoesPesos,
    atualizacoesPesos,
    inalteradosNoRecalculo,
    fantasmas,
    pesosJaExistentes,
    problemas,
    verificacoes,
    bloqueios,
    avisos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado final esperado, resumo por UF e comparação com o banco
// ─────────────────────────────────────────────────────────────────────────────

export interface Estado {
  zonas: Par[];
  pesos: Peso[];
}

/** O que `zonas` e `eleitorado` (ano=2026) DEVEM conter depois de gravar o plano. */
export function estadoFinal(antes: Estado, plano: Plano): Estado {
  const rmZ = new Set(plano.fantasmas.remocoesZonas.map(chaveDoPar));
  const rmP = new Set(plano.fantasmas.remocoesPesos.map(chaveDoPar));
  const upd = new Map(plano.atualizacoesPesos.map((a) => [chaveDoPar(a.par), a.para]));
  const zonas: Par[] = antes.zonas
    .filter((z) => !rmZ.has(chaveDoPar(z)))
    .map(({ uf, codMunicipioTse, codZona }) => ({ uf, codMunicipioTse, codZona }));
  for (const z of plano.insercoesZonas) {
    zonas.push({ uf: z.uf, codMunicipioTse: z.codMunicipioTse, codZona: z.codZona });
  }
  const pesos: Peso[] = antes.pesos
    .filter((p) => !rmP.has(chaveDoPar(p)))
    .map(({ uf, codMunicipioTse, codZona, eleitoresAptos }) => ({
      uf,
      codMunicipioTse,
      codZona,
      eleitoresAptos: upd.get(chaveDoPar({ uf, codMunicipioTse, codZona })) ?? eleitoresAptos,
    }));
  for (const r of plano.insercoesPesos) {
    pesos.push({
      uf: r.uf,
      codMunicipioTse: r.codMunicipioTse,
      codZona: r.codZona,
      eleitoresAptos: r.te,
    });
  }
  return { zonas: ordenar(zonas), pesos: ordenar(pesos) };
}

/** Diferenças entre o estado esperado e o lido do banco (vazio = idênticos). */
export function diferencasDeEstado(esperado: Estado, lido: Estado, limite = 10): string[] {
  const out: string[] = [];
  const cmp = <T extends Par>(nome: string, a: T[], b: T[], valor?: (x: T) => number) => {
    const ma = new Map(a.map((x) => [chaveDoPar(x), x]));
    const mb = new Map(b.map((x) => [chaveDoPar(x), x]));
    for (const [k, x] of ma) {
      const y = mb.get(k);
      if (!y) out.push(`${nome}: ${rotuloDoPar(x)} esperado e ausente no banco`);
      else if (valor && valor(x) !== valor(y)) {
        out.push(`${nome}: ${rotuloDoPar(x)} esperado ${fmt(valor(x))}, banco ${fmt(valor(y))}`);
      }
    }
    for (const [k, y] of mb) {
      if (!ma.has(k)) out.push(`${nome}: ${rotuloDoPar(y)} presente no banco e não esperado`);
    }
  };
  cmp("zonas", esperado.zonas, lido.zonas);
  cmp("eleitorado", esperado.pesos, lido.pesos, (p) => p.eleitoresAptos);
  return out.slice(0, limite);
}

export interface ResumoUf {
  uf: string;
  zonasAntes: number;
  zonasDepois: number;
  pesosAntes: number;
  pesosDepois: number;
  somaAntes: number;
  somaDepois: number;
  agregadoTe: number | null;
}

export function resumoPorUf(
  antes: Estado,
  depois: Estado,
  agregadoPorUf: Map<string, number>,
  ufs: string[],
): ResumoUf[] {
  const soma = (ps: Peso[], uf: string) =>
    ps.filter((p) => p.uf === uf).reduce((a, p) => a + p.eleitoresAptos, 0);
  const n = (xs: Par[], uf: string) => xs.filter((p) => p.uf === uf).length;
  return [...new Set(ufs)].sort().map((uf) => ({
    uf,
    zonasAntes: n(antes.zonas, uf),
    zonasDepois: n(depois.zonas, uf),
    pesosAntes: n(antes.pesos, uf),
    pesosDepois: n(depois.pesos, uf),
    somaAntes: soma(antes.pesos, uf),
    somaDepois: soma(depois.pesos, uf),
    agregadoTe: agregadoPorUf.get(uf) ?? null,
  }));
}

/**
 * Alvos de UF + nacional que `listIngestTargets` soma aos pares de `zonas`
 * (27 UFs + 1 BR, `lib/tse/targets.ts`; medido em 27/09: 6.138 = 6.110 + 28).
 */
export const ALVOS_AGREGADOS = 28;

// ─────────────────────────────────────────────────────────────────────────────
// SQL para desfazer (gerado do estado LIDO antes da escrita)
// ─────────────────────────────────────────────────────────────────────────────

/** Linha completa de `zonas`, como o banco a devolve. */
export interface LinhaZona {
  uf: string;
  cod_municipio_tse: number;
  cod_zona: number;
  nome: string | null;
  fonte: string | null;
}

/** Linha completa de `eleitorado`, como o banco a devolve (numeric vem como texto). */
export interface LinhaPeso {
  ano: number;
  uf: string;
  cod_municipio_tse: number;
  cod_zona: number;
  eleitores_aptos: number;
  comparecimento_pct_historico: string | null;
}

function lit(v: string | number | null): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ValidacaoError(`literal numérico inválido: ${v}`);
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

function litNumeric(v: string | null): string {
  if (v === null) return "NULL";
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new ValidacaoError(`numeric inesperado: "${v}"`);
  return v;
}

/**
 * Instruções que devolvem o banco ao estado de ANTES da escrita, numa
 * transação. Ordem: recolocar o que saiu, devolver os pesos antigos, tirar o que
 * entrou. Devolve `[]` quando nada muda.
 */
export function sqlDesfazer(a: {
  zonasRemovidas: LinhaZona[];
  pesosRemovidos: LinhaPeso[];
  /** Estado ANTES das linhas que o UPDATE altera. */
  pesosAtualizados: LinhaPeso[];
  zonasInseridas: Par[];
  pesosInseridos: Par[];
}): string[] {
  const vazio =
    a.zonasRemovidas.length +
      a.pesosRemovidos.length +
      a.pesosAtualizados.length +
      a.zonasInseridas.length +
      a.pesosInseridos.length ===
    0;
  if (vazio) return [];
  const out = ["BEGIN;"];
  if (a.zonasRemovidas.length > 0) {
    out.push(
      "INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte) VALUES\n  " +
        a.zonasRemovidas
          .map(
            (z) =>
              `(${lit(z.uf)}, ${lit(z.cod_municipio_tse)}, ${lit(z.cod_zona)}, ${lit(z.nome)}, ${lit(z.fonte)})`,
          )
          .join(",\n  ") +
        ";",
    );
  }
  if (a.pesosRemovidos.length > 0) {
    out.push(
      "INSERT INTO eleitorado (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico) VALUES\n  " +
        a.pesosRemovidos
          .map(
            (p) =>
              `(${lit(p.ano)}, ${lit(p.uf)}, ${lit(p.cod_municipio_tse)}, ${lit(p.cod_zona)}, ${lit(
                p.eleitores_aptos,
              )}, ${litNumeric(p.comparecimento_pct_historico)})`,
          )
          .join(",\n  ") +
        ";",
    );
  }
  if (a.pesosAtualizados.length > 0) {
    const anos = [...new Set(a.pesosAtualizados.map((p) => p.ano))];
    if (anos.length !== 1) throw new ValidacaoError("pesos atualizados de mais de um ano");
    out.push(
      "UPDATE eleitorado e SET eleitores_aptos = v.antigo FROM (VALUES\n  " +
        a.pesosAtualizados
          .map(
            (p) =>
              `(${lit(p.uf)}, ${lit(p.cod_municipio_tse)}, ${lit(p.cod_zona)}, ${lit(p.eleitores_aptos)})`,
          )
          .join(",\n  ") +
        `\n) AS v(uf, mun, zona, antigo)\nWHERE e.ano = ${anos[0]} AND e.uf = v.uf AND e.cod_municipio_tse = v.mun AND e.cod_zona = v.zona;`,
    );
  }
  const chaves = (ps: Par[]) =>
    ps.map((p) => `(${lit(p.uf)}, ${p.codMunicipioTse}, ${p.codZona})`).join(", ");
  if (a.pesosInseridos.length > 0) {
    out.push(
      `DELETE FROM eleitorado WHERE ano = ${ANO} AND (uf, cod_municipio_tse, cod_zona) IN (${chaves(
        a.pesosInseridos,
      )});`,
    );
  }
  if (a.zonasInseridas.length > 0) {
    out.push(
      `DELETE FROM zonas WHERE (uf, cod_municipio_tse, cod_zona) IN (${chaves(a.zonasInseridas)});`,
    );
  }
  out.push("COMMIT;");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nomes das colunas do arquivo OFICIAL de eleitorado (`perfil_eleitorado_2026`). Não há amostra
 * do arquivo no repositório (só o de locais de votação de 2024, outro leiaute): os padrões
 * abaixo são os nomes que o dono informou/conhecidos do dataset do TSE, a leitura VALIDA o
 * cabeçalho e, se algum nome não existir, falha listando o que encontrou — e cada nome é
 * ajustável por `--col-uf`, `--col-municipio`, `--col-zona`, `--col-qt`.
 */
export interface ColunasOficiais {
  uf: string;
  municipio: string;
  zona: string;
  qt: string;
}

export const COLUNAS_OFICIAIS_PADRAO: ColunasOficiais = {
  uf: "SG_UF",
  municipio: "CD_MUNICIPIO",
  zona: "NR_ZONA",
  qt: "QT_ELEITORES_PERFIL",
};

export interface Cli extends Opcoes {
  ea12: string | null;
  zonasDir: string | null;
  eleicao: string;
  /** Caminho do `perfil_eleitorado_2026.zip` (ou do CSV extraído): liga o modo de pesos oficiais. */
  pesosOficiais: string | null;
  /** Totais publicados por UF (ex.: TRE-AP 577534), conferidos contra a soma do arquivo. */
  totalUf: Record<string, number>;
  colunas: ColunasOficiais;
}

/** Aceita o `--` que `pnpm <script> -- --flag` repassa literalmente (medido em 27/09). */
export function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    escrever: false,
    ufs: [],
    aceitarTeDerivado: false,
    exigirSomaExata: false,
    recalcularPesosUf: [],
    removerFantasmas: false,
    soEstrutural: false,
    ea12: null,
    zonasDir: null,
    eleicao: ELEICAO_FEDERAL_PADRAO,
    pesosOficiais: null,
    totalUf: {},
    colunas: { ...COLUNAS_OFICIAIS_PADRAO },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const valor = (flag: string): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} exige um valor`);
      i++;
      return v;
    };
    if (a === "--") continue;
    if (a === "--escrever") cli.escrever = true;
    else if (a === "--aceitar-te-derivado") cli.aceitarTeDerivado = true;
    else if (a === "--exigir-soma-exata") cli.exigirSomaExata = true;
    else if (a === "--remover-fantasmas") cli.removerFantasmas = true;
    else if (a === "--so-estrutural") cli.soEstrutural = true;
    else if (a === "--pesos-oficiais") {
      cli.pesosOficiais = valor(a);
      if (/^https?:\/\//i.test(cli.pesosOficiais)) {
        throw new Error(
          "--pesos-oficiais aceita só CAMINHO de arquivo local (o operador baixa o zip): este " +
            "script não faz rede (constituição § 1).",
        );
      }
    } else if (a === "--total-uf") {
      for (const par of valor(a).split(",")) {
        const m = /^\s*([A-Za-z]{2})\s*=\s*(\d+)\s*$/.exec(par);
        if (!m || Number(m[2]) <= 0) {
          throw new Error(`--total-uf inválido: "${par}" (esperado UF=total, ex.: AP=577534)`);
        }
        cli.totalUf[m[1]!.toUpperCase()] = Number(m[2]);
      }
    } else if (a === "--col-uf") cli.colunas.uf = valor(a);
    else if (a === "--col-municipio") cli.colunas.municipio = valor(a);
    else if (a === "--col-zona") cli.colunas.zona = valor(a);
    else if (a === "--col-qt") cli.colunas.qt = valor(a);
    else if (a === "--recalcular-pesos-uf") {
      cli.recalcularPesosUf = [
        ...new Set(
          valor(a)
            .split(",")
            .map((u) => u.trim().toUpperCase())
            .filter(Boolean),
        ),
      ];
      const ruim = cli.recalcularPesosUf.find((u) => !/^[A-Z]{2}$/.test(u));
      if (ruim) throw new Error(`--recalcular-pesos-uf inválida: "${ruim}"`);
      if (cli.recalcularPesosUf.length === 0) throw new Error("--recalcular-pesos-uf exige uma UF");
    } else if (a === "--ea12") {
      cli.ea12 = valor(a);
      if (/^https?:\/\//i.test(cli.ea12)) {
        throw new Error(
          "--ea12 aceita só CAMINHO de arquivo local: este script não faz rede (constituição § 1).",
        );
      }
    } else if (a === "--zonas-dir") cli.zonasDir = valor(a);
    else if (a === "--eleicao") {
      cli.eleicao = valor(a);
      if (!/^\d{5,6}$/.test(cli.eleicao)) {
        throw new Error(
          `--eleicao inválida: "${cli.eleicao}" (esperado o código numérico, ex.: 21270)`,
        );
      }
    } else if (a === "--uf") {
      cli.ufs = valor(a)
        .split(",")
        .map((u) => u.trim().toUpperCase())
        .filter(Boolean);
      const ruim = cli.ufs.find((u) => !/^[A-Z]{2}$/.test(u));
      if (ruim) throw new Error(`--uf inválida: "${ruim}"`);
    } else if (a.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  validarCombinacoes(cli);
  return cli;
}

/** Os três modos não se misturam: estrutural nunca grava peso; oficial só mexe em `eleitorado`. */
function validarCombinacoes(cli: Cli): void {
  const incompativeis = (modo: string, flags: [string, boolean][]): void => {
    const ruim = flags.find(([, ligada]) => ligada);
    if (ruim) throw new Error(`${modo} não combina com ${ruim[0]}.`);
  };
  if (cli.soEstrutural) {
    incompativeis("--so-estrutural (nunca grava peso)", [
      ["--pesos-oficiais", cli.pesosOficiais !== null],
      ["--recalcular-pesos-uf", cli.recalcularPesosUf.length > 0],
      ["--aceitar-te-derivado", cli.aceitarTeDerivado],
      ["--exigir-soma-exata", cli.exigirSomaExata],
    ]);
  }
  if (cli.pesosOficiais !== null) {
    if (cli.ufs.length === 0) {
      throw new Error("--pesos-oficiais exige --uf explícito (ex.: --uf AP) — nunca 'todas'.");
    }
    if (cli.ufs.includes("ZZ"))
      throw new Error("--uf ZZ: o exterior está fora do escopo (ADR-0045).");
    incompativeis("--pesos-oficiais (só mexe em `eleitorado`, do arquivo oficial)", [
      ["--remover-fantasmas (rode o estrutural antes, separado)", cli.removerFantasmas],
      ["--recalcular-pesos-uf", cli.recalcularPesosUf.length > 0],
      ["--aceitar-te-derivado", cli.aceitarTeDerivado],
      ["--exigir-soma-exata", cli.exigirSomaExata],
    ]);
  } else {
    if (Object.keys(cli.totalUf).length > 0) {
      throw new Error("--total-uf só vale junto com --pesos-oficiais.");
    }
    const padrao = COLUNAS_OFICIAIS_PADRAO;
    if (
      cli.colunas.uf !== padrao.uf ||
      cli.colunas.municipio !== padrao.municipio ||
      cli.colunas.zona !== padrao.zona ||
      cli.colunas.qt !== padrao.qt
    ) {
      throw new Error(
        "--col-uf/--col-municipio/--col-zona/--col-qt só valem com --pesos-oficiais.",
      );
    }
  }
}
