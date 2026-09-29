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
// ─── O limite que a soma dos pesos revela ───────────────────────────────────
//
// Os pesos JÁ existentes em `eleitorado` vêm do CSV municipal de 2024
// (`eleitorado-import.ts`), não do cadastro de 2026. Onde o TSE redistribuiu
// zonas (Macapá, Recife), o peso antigo de uma zona ainda inclui eleitores que
// hoje pertencem à zona nova. Inserir só o par faltante, sem corrigir os
// vizinhos, CONTA ESSES ELEITORES DUAS VEZES — e a soma dos pesos da UF passa
// a ficar mais longe do agregado do TSE do que antes. `verificarTotais`
// mede isso e `bloqueiosDaEscrita` trava a escrita quando a inserção PIORA a
// distância (situação "PIORA"). Este script NUNCA altera linha existente.

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

export type FonteTe = "arquivo-zona" | "derivado";

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
  situacao: Situacao;
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

export function verificarTotais(args: {
  pesosAtuais: Peso[];
  /** O que iria para `eleitorado` (já sem os pares que têm peso idêntico no banco). */
  novosPesos: TeResolvido[];
  agregadoPorUf: Map<string, number>;
}): VerificacaoUf[] {
  const ufs = [...new Set(args.novosPesos.map((p) => p.uf))].sort();
  return ufs.map((uf) => {
    const agregadoTe = args.agregadoPorUf.get(uf);
    if (agregadoTe === undefined) {
      throw new ValidacaoError(`${uf}: sem agregado de UF — não há como verificar os totais.`);
    }
    const antes = args.pesosAtuais
      .filter((p) => p.uf === uf)
      .reduce((a, p) => a + p.eleitoresAptos, 0);
    const novo = args.novosPesos.filter((p) => p.uf === uf).reduce((a, p) => a + p.te, 0);
    const depois = antes + novo;
    const gapAntes = antes - agregadoTe;
    const gapDepois = depois - agregadoTe;
    const situacao: Situacao =
      gapDepois === 0 ? "FECHA" : Math.abs(gapDepois) < Math.abs(gapAntes) ? "MELHORA" : "PIORA";
    return {
      uf,
      agregadoTe,
      somaPesosAntes: antes,
      somaPesosDepois: depois,
      gapAntes,
      gapDepois,
      situacao,
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
// Plano
// ─────────────────────────────────────────────────────────────────────────────

export interface Opcoes {
  escrever: boolean;
  /** Restringe a UFs (maiúsculas). Vazio = todas as que têm par faltante. */
  ufs: string[];
  aceitarTeDerivado: boolean;
  exigirSomaExata: boolean;
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
  opcoes: Opcoes;
}

export interface Plano {
  diff: DiffPares;
  /** Faltantes dentro do escopo (`--uf`). */
  faltantes: ParEa12[];
  resolvidos: TeResolvido[];
  /** Linhas para `zonas` (todos os faltantes resolvidos). */
  insercoesZonas: (ParEa12 & { fonte: string })[];
  /** Linhas para `eleitorado` — sem os pares com peso idêntico já no banco. */
  insercoesPesos: TeResolvido[];
  /** Pares com peso já no banco (idêntico: pula; diferente: conflito). */
  pesosJaExistentes: { par: Par; pesoBanco: number; te: number }[];
  problemas: string[];
  verificacoes: VerificacaoUf[];
  /** Impedem `--escrever`. Vazio = pode gravar. */
  bloqueios: string[];
  avisos: string[];
}

export function planejar(e: EntradaPlano): Plano {
  const diff = diffPares(e.ea12, e.zonas, e.pesos);
  const ufsEscopo = new Set(e.opcoes.ufs.map((u) => u.toUpperCase()));
  const faltantes = diff.faltandoEmZonas.filter((p) => ufsEscopo.size === 0 || ufsEscopo.has(p.uf));
  const avisos: string[] = [];
  const bloqueios: string[] = [];

  // te de cada faltante
  const { resolvidos, problemas } = resolverTeDosFaltantes({
    ea12: e.ea12,
    faltantes,
    agregadoPorUf: e.agregadoPorUf,
    teZonaSnapshots: e.teZonaSnapshots,
    teArquivos: e.teArquivos,
  });
  for (const p of problemas) bloqueios.push(p);

  const kFaltantes = new Set(faltantes.map(chaveDoPar));
  for (const p of faltantes) {
    if (!resolvidos.some((r) => chaveDoPar(r) === chaveDoPar(p))) {
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

  // pesos já existentes para os faltantes: idêntico pula, diferente aborta
  const pesosPorChave = new Map(e.pesos.map((p) => [chaveDoPar(p), p.eleitoresAptos]));
  const pesosJaExistentes: Plano["pesosJaExistentes"] = [];
  const insercoesPesos: TeResolvido[] = [];
  for (const r of resolvidos) {
    const existente = pesosPorChave.get(chaveDoPar(r));
    if (existente === undefined) {
      insercoesPesos.push(r);
      continue;
    }
    pesosJaExistentes.push({ par: r, pesoBanco: existente, te: r.te });
    if (existente !== r.te) {
      bloqueios.push(
        `${rotuloDoPar(r)}: já existe peso em eleitorado (${fmt(existente)}) DIFERENTE do te ` +
          `calculado (${fmt(r.te)}) — este script nunca sobrescreve.`,
      );
    }
  }

  // totais
  let verificacoes: VerificacaoUf[] = [];
  const ufsResolvidas = new Set(resolvidos.map((r) => r.uf));
  const agregadosOk = new Map([...e.agregadoPorUf].filter(([uf]) => ufsResolvidas.has(uf)));
  if (resolvidos.length > 0 && [...ufsResolvidas].every((uf) => agregadosOk.has(uf))) {
    verificacoes = verificarTotais({
      pesosAtuais: e.pesos,
      novosPesos: insercoesPesos,
      agregadoPorUf: agregadosOk,
    });
    for (const v of verificacoes) {
      if (v.situacao === "PIORA") {
        bloqueios.push(
          `${v.uf}: inserir os pesos PIORA a soma da UF contra o agregado do TSE ` +
            `(Σ pesos ${fmt(v.somaPesosAntes)} → ${fmt(v.somaPesosDepois)}; agregado ${fmt(
              v.agregadoTe,
            )}; distância ${fmt(Math.abs(v.gapAntes))} → ${fmt(Math.abs(v.gapDepois))}). Os pesos ` +
            "existentes da UF são do CSV de 2024 e já incluem eleitores que hoje estão neste par — " +
            "inserir só o par novo os contaria duas vezes. Decisão do dono: corrigir os pesos " +
            "vizinhos antes (fora do escopo deste script).",
        );
      } else if (v.situacao === "MELHORA") {
        avisos.push(
          `${v.uf}: Σ pesos após a inserção (${fmt(v.somaPesosDepois)}) não fecha com o agregado ` +
            `(${fmt(v.agregadoTe)}; ${v.gapDepois > 0 ? "+" : ""}${fmt(v.gapDepois)}), mas MELHORA ` +
            `a distância (${fmt(Math.abs(v.gapAntes))} → ${fmt(Math.abs(v.gapDepois))}). O resto é ` +
            "peso de 2024 nos pares vizinhos.",
        );
      }
      if (e.opcoes.exigirSomaExata && v.situacao !== "FECHA") {
        bloqueios.push(
          `${v.uf}: --exigir-soma-exata — Σ pesos após (${fmt(v.somaPesosDepois)}) ≠ agregado ` +
            `(${fmt(v.agregadoTe)}).`,
        );
      }
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
    avisos.push(
      `${semPesoNaoFaltante.length} par(es) do EA12 JÁ em zonas mas SEM peso (o modelo os descarta; ` +
        `este script não os corrige): ${semPesoNaoFaltante.map(rotuloDoPar).join(", ")}.`,
    );
  }
  if (diff.sobrandoEmZonas.length > 0) {
    avisos.push(
      `${diff.sobrandoEmZonas.length} par(es) em zonas que o EA12 NÃO lista (o TSE não deve publicar ` +
        `o arquivo deles → provável 404 a cada ciclo, por cargo; este script não remove): ${diff.sobrandoEmZonas
          .map(rotuloDoPar)
          .join(", ")}.`,
    );
  }

  return {
    diff,
    faltantes,
    resolvidos,
    insercoesZonas: resolvidos.map((r) => ({ ...r, fonte: FONTE_ZONAS })),
    insercoesPesos,
    pesosJaExistentes,
    problemas,
    verificacoes,
    bloqueios,
    avisos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export interface Cli extends Opcoes {
  ea12: string | null;
  zonasDir: string | null;
  eleicao: string;
}

/** Aceita o `--` que `pnpm <script> -- --flag` repassa literalmente (medido em 27/09). */
export function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    escrever: false,
    ufs: [],
    aceitarTeDerivado: false,
    exigirSomaExata: false,
    ea12: null,
    zonasDir: null,
    eleicao: ELEICAO_FEDERAL_PADRAO,
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
    else if (a === "--ea12") {
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
  return cli;
}
