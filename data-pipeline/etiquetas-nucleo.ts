// data-pipeline/etiquetas-nucleo.ts
//
// O **núcleo puro** do compilador de etiquetas (spec 024, RF-222..RF-229,
// RF-239). Recebe as fontes já lidas (texto dos CSVs, universo do TSE,
// insumos derivados, gerados anteriores) e devolve os arquivos a gravar — ou
// a lista de erros. Nada de disco, rede ou relógio implícito: `agora` entra
// como parâmetro, e é o que torna a compilação reprodutível (teste de deriva).
//
// A casca de I/O é `data-pipeline/etiquetas-compilar.ts`.
//
// ─── Tudo ou nada ───────────────────────────────────────────────────────────
//
// Um único erro de validação recusa a compilação inteira — nenhum arquivo é
// gravado. Compilar "o que deu" publicaria uma classificação cuja linha
// irmã (a federação, o turno 2) foi descartada em silêncio.
//
// ─── Determinismo ───────────────────────────────────────────────────────────
//
// Chaves inseridas em ordem ordenada, listas de `sqcand` ordenadas por valor
// numérico (11 e 12 dígitos convivem: ordem de texto poria "99…" depois de
// "100…"), e `meta` preservada quando o conteúdo não muda — recompilar as
// mesmas fontes dá o mesmo resultado.

import { createHash } from "node:crypto";

import {
  A_CLASSIFICAR,
  ALINHAMENTO_BASE_MIN,
  ALINHAMENTO_MIN_VOTOS_DISPUTADAS,
  ALINHAMENTO_OPOSICAO_MAX,
  type AlvoEtiqueta,
  ARQUIVOS_FONTE,
  type ArquivoFonte,
  aplicaA,
  type CategoriaId,
  categoria as defCategoria,
  isCategoriaId,
  ORDEM_CATEGORIAS,
  TRAJETORIA_PARA_VALOR,
  todasDesligadas,
  type ValorId,
  valorDoCatalogo,
} from "@/lib/etiquetas/catalogo";
import {
  type ArquivoHistorico,
  type ArquivoNacional,
  type ArquivoUf,
  type CandidatoNacional,
  chaveDeCategoria,
  chaveFederacao,
  chavePartido,
  type EntradaHistorico,
  FORMATO_ETIQUETAS,
  type FonteDerivada,
  INSUMOS_DERIVADOS,
  type InsumoDerivado,
  type MetaEtiquetas,
  normalizarSigla,
  normalizarSqcand,
  type Registro,
  type Registros,
  registroPublico,
  type Senador2031,
  UFS,
  type ValoresDerivados,
} from "@/lib/etiquetas/formato";
import {
  insumosDeputadosDaUf,
  insumosMajoritario,
  insumosSenador2031,
} from "@/lib/etiquetas/montagem";
import { type InsumosResolucao, resolverCategoria } from "@/lib/etiquetas/resolver";

import { type ErroCompilacao, type LinhaFonte, parseCsvEtiquetas } from "./etiquetas-csv";
import type { AlinhamentoInsumo, Senado2031Insumo, TrajetoriaInsumo } from "./etiquetas-insumos";
import type { Universo } from "./etiquetas-universo";

export type { ErroCompilacao } from "./etiquetas-csv";

export interface AnteriorCompilado {
  nacional: ArquivoNacional | null;
  ufs: ReadonlyMap<string, ArquivoUf>;
  historico: ArquivoHistorico | null;
}

/** Os quatro derivados; cada um pode faltar. */
export interface InsumosDerivadosEntrada {
  trajetoria_camara: TrajetoriaInsumo | null;
  alinhamento_camara: AlinhamentoInsumo | null;
  trajetoria_senado: TrajetoriaInsumo | null;
  alinhamento_senado: AlinhamentoInsumo | null;
}

export function semDerivados(): InsumosDerivadosEntrada {
  return {
    trajetoria_camara: null,
    alinhamento_camara: null,
    trajetoria_senado: null,
    alinhamento_senado: null,
  };
}

export interface EntradaCompilacao {
  /** Texto de cada CSV; `null` = arquivo ausente (erro). */
  fontes: Readonly<Record<ArquivoFonte, string | null>>;
  universo: Universo;
  senado2031: Senado2031Insumo | null;
  derivados: InsumosDerivadosEntrada;
  anterior: AnteriorCompilado;
  agora: Date;
}

export interface RelatorioCompilacao {
  linhas: number;
  efetivas: number;
  naoRevisadas: number;
  avisos: string[];
  /** Por alvo e categoria: quantos classificados / total do universo (turno 1). */
  cobertura: Array<{ alvo: string; categoria: CategoriaId; classificados: number; total: number }>;
  mudancas: number;
  conteudoMudou: boolean;
}

export type ResultadoCompilacao =
  | {
      ok: true;
      nacional: ArquivoNacional;
      ufs: Record<string, ArquivoUf>;
      historico: ArquivoHistorico;
      relatorio: RelatorioCompilacao;
    }
  | { ok: false; erros: ErroCompilacao[] };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function dataValida(s: string): boolean {
  const m = DATA.exec(s);
  if (!m) return false;
  const [, a, me, d] = m;
  const dt = new Date(Date.UTC(Number(a), Number(me) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(a) &&
    dt.getUTCMonth() === Number(me) - 1 &&
    dt.getUTCDate() === Number(d)
  );
}

/** "Hoje" no fuso de Brasília — a régua de "data no futuro". */
export function hojeBrt(agora: Date): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Ordem numérica de `sqcand`/código em texto (11 e 12 dígitos convivem). */
export function compararSqcand(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function ordenarChaves<T>(
  o: Record<string, T>,
  cmp?: (a: string, b: string) => number,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort(cmp)) out[k] = o[k] as T;
  return out;
}

function empilhar<K extends string>(o: Partial<Record<K, string[]>>, k: K, v: string): void {
  const lista = o[k];
  if (lista) lista.push(v);
  else o[k] = [v];
}

/** JSON canônico: chaves ordenadas em toda profundidade. Só para o hash. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Validação linha a linha (RF-222)
// ---------------------------------------------------------------------------

interface LinhaValida {
  arquivo: ArquivoFonte;
  linha: number;
  /** Chave normalizada: `sqcand`, `senado:X`, `partido:X`, `federacao:X`. */
  chave: string;
  alvo: AlvoEtiqueta | "agremiacao";
  categoria: CategoriaId;
  turno: 1 | 2 | null;
  revisado: boolean;
  registro: Registro;
}

function validarLinha(
  arquivo: ArquivoFonte,
  l: LinhaFonte,
  e: EntradaCompilacao,
  hoje: string,
  partidosConhecidos: ReadonlySet<string>,
): { ok: true; valor: LinhaValida } | { ok: false; erros: string[] } {
  const c = l.campos;
  const erros: string[] = [];
  const tipo = ARQUIVOS_FONTE[arquivo];

  // chave → alvo
  let chave = c.chave;
  let alvo: AlvoEtiqueta | "agremiacao" = "agremiacao";
  if (tipo.tipo === "sqcand") {
    const sq = normalizarSqcand(c.chave);
    const cand = sq ? e.universo.candidaturas.get(sq) : undefined;
    if (!sq || sq !== c.chave) {
      erros.push(`chave "${c.chave}" não é um sqcand (só dígitos)`);
    } else if (!cand || cand.cargo !== tipo.cargo) {
      erros.push(`sqcand ${sq} não é candidatura a cargo ${tipo.cargo} no universo do TSE`);
    }
    chave = sq ?? c.chave;
    alvo = tipo.cargo;
  } else if (tipo.tipo === "senado") {
    const m = /^senado:(\S+)$/.exec(c.chave);
    alvo = "senado2031";
    if (!m?.[1]) {
      erros.push(`chave "${c.chave}" deveria ser senado:CODIGO`);
    } else if (!e.senado2031) {
      erros.push(
        `senado:${m[1]} — a foto do Senado (editorial/senado/mandato-2031.json) não existe`,
      );
    } else if (!e.senado2031.senadores.has(m[1])) {
      erros.push(`senado:${m[1]} não está na foto do Senado`);
    }
    chave = `senado:${m?.[1] ?? c.chave}`;
  } else {
    const m = /^(partido|federacao):(.+)$/.exec(c.chave);
    if (!m?.[1] || !m[2]) {
      erros.push(`chave "${c.chave}" deveria ser partido:SIGLA ou federacao:SIGLA`);
    } else if (m[1] === "partido") {
      chave = chavePartido(m[2]);
      if (!partidosConhecidos.has(normalizarSigla(m[2]))) {
        erros.push(`partido "${m[2]}" não existe no universo (TSE + foto do Senado)`);
      }
    } else {
      chave = chaveFederacao(m[2]);
      if (!e.universo.federacoes.has(normalizarSigla(m[2]))) {
        erros.push(`federação "${m[2]}" não existe no universo do TSE`);
      }
    }
  }

  // categoria
  const cat: CategoriaId | null = isCategoriaId(c.categoria) ? c.categoria : null;
  if (!cat) {
    erros.push(`categoria "${c.categoria}" não existe no catálogo`);
  } else if (alvo === "agremiacao") {
    if (!defCategoria(cat).herdaDoPartido) {
      erros.push(`categoria ${cat} não aceita padrão por partido/federação`);
    }
  } else if (!aplicaA(cat, alvo)) {
    erros.push(
      `categoria ${cat} não se aplica a ${alvo === "senado2031" ? "senado2031" : `cargo ${alvo}`}`,
    );
  }

  // valor
  if (cat) {
    if (c.valor === A_CLASSIFICAR) {
      erros.push(
        `"${A_CLASSIFICAR}" não é valor de linha — para não classificar, não escreva a linha`,
      );
    } else if (!valorDoCatalogo(cat, c.valor)) {
      erros.push(`valor "${c.valor}" não existe na categoria ${cat}`);
    }
  }

  // turno (RF-225)
  let turno: 1 | 2 | null = null;
  if (cat && defCategoria(cat).porTurno) {
    if (c.turno === "1" || c.turno === "2") turno = Number(c.turno) as 1 | 2;
    else erros.push(`categoria ${cat} exige turno 1 ou 2`);
  } else if (c.turno !== "") {
    erros.push("turno só se usa em palanque_presidencial — deixe vazio");
  }

  // proveniência
  if (!/^https?:\/\/\S+$/.test(c.fonte_url)) erros.push("fonte_url vazia ou não é http(s)");
  if (c.fonte_descricao === "") erros.push("fonte_descricao vazia");
  if (!dataValida(c.data)) erros.push(`data "${c.data}" inválida (AAAA-MM-DD)`);
  else if (c.data > hoje) erros.push(`data ${c.data} está no futuro`);

  // revisão
  if (c.revisado !== "sim" && c.revisado !== "nao") {
    erros.push(`revisado deve ser "sim" ou "nao" — veio "${c.revisado}"`);
  }
  if (c.revisado === "sim" && c.revisado_em === "") {
    erros.push("revisado=sim exige revisado_em");
  }
  if (c.revisado_em !== "") {
    if (!dataValida(c.revisado_em)) erros.push(`revisado_em "${c.revisado_em}" inválida`);
    else if (c.revisado_em > hoje) erros.push(`revisado_em ${c.revisado_em} está no futuro`);
  }

  if (erros.length > 0) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      arquivo,
      linha: l.linha,
      chave,
      alvo,
      categoria: cat as CategoriaId,
      turno,
      revisado: c.revisado === "sim",
      // Lista branca: `nota` fica para trás aqui (ADR-0062).
      registro: registroPublico({
        valor: c.valor,
        fonte_url: c.fonte_url,
        fonte_descricao: c.fonte_descricao,
        data: c.data,
        revisado_em: c.revisado_em,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Derivados (RF-226, RF-227)
// ---------------------------------------------------------------------------

/**
 * Relação com o governo pelo alinhamento, para UM parlamentar (ou candidato
 * que já foi parlamentar). `null` = a regra não se aplica (sem id, sem dado,
 * menos de 30 votos disputados) ⇒ vale o padrão do partido.
 *
 * **Vários ids** (a mesma pessoa com mais de um registro na casa): soma os
 * votos disputados de todos os ids com dado e pondera a taxa pelos votos — a
 * taxa que se teria juntando todas as votações num balde só. O mínimo de 30
 * vale sobre a soma. Determinístico e independente da ordem dos ids.
 */
export function relacaoPeloAlinhamento(
  ids: readonly (string | number)[],
  alinhamento: AlinhamentoInsumo,
): ValorId<"relacao_governo"> | null {
  let votos = 0;
  let ponderado = 0;
  for (const id of new Set(ids.map(String))) {
    const d = alinhamento.por_id.get(id);
    if (!d) continue;
    votos += d.votos_disputadas;
    ponderado += d.taxa_disputadas * d.votos_disputadas;
  }
  if (votos < ALINHAMENTO_MIN_VOTOS_DISPUTADAS) return null;
  const taxa = ponderado / votos;
  if (taxa >= ALINHAMENTO_BASE_MIN) return "base_governo";
  if (taxa <= ALINHAMENTO_OPOSICAO_MAX) return "oposicao";
  return "independente";
}

// ---------------------------------------------------------------------------
// Extração de um conjunto compilado (para o histórico)
// ---------------------------------------------------------------------------

type MapaEfetivo = Map<string, { chave: string; catKey: string; registro: Registro }>;

function efetivosDe(nacional: ArquivoNacional | null, ufs: Iterable<ArquivoUf>): MapaEfetivo {
  const out: MapaEfetivo = new Map();
  const add = (chave: string, regs: Registros | undefined) => {
    for (const [catKey, registro] of Object.entries(regs ?? {})) {
      out.set(`${chave}|${catKey}`, { chave, catKey, registro });
    }
  };
  if (nacional) {
    for (const [k, regs] of Object.entries(nacional.padroes)) add(k, regs);
    for (const [sq, c] of Object.entries(nacional.candidatos)) add(sq, c.x);
    for (const [cod, s] of Object.entries(nacional.senado2031.senadores)) add(`senado:${cod}`, s.x);
  }
  for (const uf of ufs) for (const [sq, regs] of Object.entries(uf.excecoes)) add(sq, regs);
  return out;
}

/** Valores de UM insumo derivado, por chave (`sqcand` ou `senado:X`). */
function valoresDoInsumo(
  insumo: InsumoDerivado,
  nacional: ArquivoNacional | null,
  ufs: Iterable<ArquivoUf>,
): Map<string, string> {
  const out = new Map<string, string>();
  const cat = INSUMOS_DERIVADOS[insumo];
  if (insumo === "trajetoria_camara" || insumo === "alinhamento_camara") {
    const campo = insumo === "trajetoria_camara" ? "trajetoria" : "alinhamento";
    for (const uf of ufs) {
      for (const [valor, lista] of Object.entries(uf[campo])) {
        for (const sq of lista ?? []) out.set(sq, valor);
      }
    }
    return out;
  }
  if (!nacional) return out;
  for (const [sq, c] of Object.entries(nacional.candidatos)) {
    const v = c.d?.[cat];
    if (v) out.set(sq, v);
  }
  if (insumo === "alinhamento_senado") {
    for (const [cod, s] of Object.entries(nacional.senado2031.senadores)) {
      const v = s.d?.relacao_governo;
      if (v) out.set(`senado:${cod}`, v);
    }
  }
  return out;
}

function separarCatKey(catKey: string): { categoria: string; turno: 1 | 2 | null } {
  const [categoria, t] = catKey.split(":");
  return { categoria: categoria ?? catKey, turno: t === "1" ? 1 : t === "2" ? 2 : null };
}

function arquivoDoInsumo(i: InsumoDerivado): string {
  return `editorial/derivados/${i.replace("_", "-")}.json`;
}

// ---------------------------------------------------------------------------
// Compilação
// ---------------------------------------------------------------------------

export function compilarEtiquetas(e: EntradaCompilacao): ResultadoCompilacao {
  const erros: ErroCompilacao[] = [];
  const avisos: string[] = [];
  const hoje = hojeBrt(e.agora);
  const der = e.derivados;

  // Partidos que uma linha `partido:` pode citar: os do universo do TSE e os
  // partidos atuais dos 27 que seguem até 2031.
  const partidosConhecidos = new Set<string>(e.universo.partidos.keys());
  for (const s of e.senado2031?.senadores.values() ?? []) {
    if (s.partido) partidosConhecidos.add(s.partido);
  }

  // ── 1. ler e validar cada arquivo ────────────────────────────────────────
  const validas: LinhaValida[] = [];
  let totalLinhas = 0;
  for (const arquivo of Object.keys(ARQUIVOS_FONTE) as ArquivoFonte[]) {
    const texto = e.fontes[arquivo];
    const nome = `editorial/etiquetas/${arquivo}`;
    if (texto === null) {
      erros.push({ arquivo: nome, linha: null, mensagem: "arquivo ausente" });
      continue;
    }
    const { linhas, erros: errCsv } = parseCsvEtiquetas(texto, nome);
    erros.push(...errCsv);
    totalLinhas += linhas.length;
    for (const l of linhas) {
      const r = validarLinha(arquivo, l, e, hoje, partidosConhecidos);
      if (r.ok) validas.push(r.valor);
      else for (const m of r.erros) erros.push({ arquivo: nome, linha: l.linha, mensagem: m });
    }
  }

  // ── 2. duplicatas (chave, categoria, turno) ──────────────────────────────
  const vistas = new Map<string, LinhaValida>();
  for (const v of validas) {
    const k = `${v.chave}|${chaveDeCategoria(v.categoria, v.turno)}`;
    const ja = vistas.get(k);
    if (ja) {
      erros.push({
        arquivo: `editorial/etiquetas/${v.arquivo}`,
        linha: v.linha,
        mensagem: `duplicata de (${v.chave}, ${v.categoria}, turno ${v.turno ?? "—"}) — já em ${ja.arquivo}:${ja.linha}`,
      });
    } else {
      vistas.set(k, v);
    }
  }

  // ── 3. federação explícita quando algum membro tem linha ─────────────────
  for (const [fed, membros] of e.universo.federacoes) {
    const kf = chaveFederacao(fed);
    const exigidas = new Map<string, string>();
    for (const v of vistas.values()) {
      for (const p of membros) {
        if (v.chave === chavePartido(p)) exigidas.set(chaveDeCategoria(v.categoria, v.turno), p);
      }
    }
    for (const [catKey, membro] of exigidas) {
      if (!vistas.has(`${kf}|${catKey}`)) {
        erros.push({
          arquivo: "editorial/etiquetas/partidos.csv",
          linha: null,
          mensagem:
            `federação "${fed}" precisa de linha própria em ${catKey} ` +
            `(o partido-membro ${membro} tem) — a federação é a unidade da Câmara`,
        });
      }
    }
  }

  // ── 4. trajetórias contra o universo (RF-226) ────────────────────────────
  const todos = [...e.universo.candidaturas.values()];
  for (const [insumo, cargo, nomeCargo] of [
    ["trajetoria_camara", 6, "Deputado Federal"],
    ["trajetoria_senado", 5, "Senador"],
  ] as const) {
    const t = der[insumo];
    if (!t) continue;
    const arquivo = arquivoDoInsumo(insumo);
    const doCargo = todos.filter((c) => c.cargo === cargo).length;
    if (t.universo !== doCargo) {
      erros.push({
        arquivo,
        linha: null,
        mensagem:
          `universo ${t.universo} ≠ ${doCargo} candidaturas a ${nomeCargo} no cache do TSE — ` +
          "regenere o insumo contra o mesmo cadastro",
      });
    }
    for (const sq of t.por_sqcand.keys()) {
      if (e.universo.candidaturas.get(sq)?.cargo !== cargo) {
        erros.push({
          arquivo,
          linha: null,
          mensagem: `sqcand ${sq} não é candidatura a ${nomeCargo} no universo do TSE`,
        });
      }
    }
  }

  if (erros.length > 0) return { ok: false, erros };

  const efetivas = [...vistas.values()].filter((v) => v.revisado);
  const naoRevisadas = vistas.size - efetivas.length;

  // ── 5. montar o nacional ─────────────────────────────────────────────────
  const porChave = new Map<string, Registros>();
  for (const v of efetivas) {
    const regs = porChave.get(v.chave) ?? {};
    regs[chaveDeCategoria(v.categoria, v.turno)] = v.registro;
    porChave.set(v.chave, regs);
  }
  /** Registros revisados de uma chave, ordenados; `undefined` quando não há. */
  const regsDe = (chave: string): Registros | undefined => {
    const regs = porChave.get(chave);
    return regs ? ordenarChaves(regs) : undefined;
  };

  const padroes: Record<string, Registros> = {};
  for (const v of efetivas) {
    if (v.alvo !== "agremiacao" || padroes[v.chave]) continue;
    padroes[v.chave] = regsDe(v.chave) as Registros;
  }

  const partidos: Record<string, string | null> = {};
  for (const p of [...partidosConhecidos].sort()) partidos[p] = e.universo.partidos.get(p) ?? null;

  // Proveniência dos derivados. Alinhamento da Câmara sem trajetória da Câmara
  // não alcança ninguém (os camara_ids vêm dela) — fica de fora, com aviso.
  const fontesDerivadas: Record<InsumoDerivado, FonteDerivada | null> = {
    trajetoria_camara: der.trajetoria_camara?.fonte ?? null,
    alinhamento_camara:
      der.alinhamento_camara && der.trajetoria_camara ? der.alinhamento_camara.fonte : null,
    trajetoria_senado: der.trajetoria_senado?.fonte ?? null,
    alinhamento_senado: der.alinhamento_senado?.fonte ?? null,
  };
  if (der.alinhamento_camara && !der.trajetoria_camara) {
    avisos.push(
      "alinhamento-camara.json existe mas trajetoria-camara.json não — sem camara_ids por sqcand, " +
        "o alinhamento da Câmara não classifica ninguém (vale o padrão do partido)",
    );
  }
  if (der.alinhamento_senado && !der.trajetoria_senado) {
    avisos.push(
      "alinhamento-senado.json existe mas trajetoria-senado.json não — o alinhamento do Senado " +
        "classifica só os 27 de senado2031, nenhum candidato a Senador",
    );
  }

  const candidatos: Record<string, CandidatoNacional> = {};
  const majoritarios = todos
    .filter((c) => c.cargo === 3 || c.cargo === 5)
    .sort((a, b) => compararSqcand(a.sqcand, b.sqcand));
  for (const c of majoritarios) {
    const x = regsDe(c.sqcand);
    let d: ValoresDerivados | undefined;
    if (c.cargo === 5) {
      const t = der.trajetoria_senado?.por_sqcand.get(c.sqcand);
      const rel =
        t && der.alinhamento_senado ? relacaoPeloAlinhamento(t.ids, der.alinhamento_senado) : null;
      if (t || rel) {
        d = {
          ...(rel ? { relacao_governo: rel } : {}),
          ...(t ? { trajetoria_cargo: TRAJETORIA_PARA_VALOR[t.t] } : {}),
        };
      }
    }
    candidatos[c.sqcand] = {
      uf: c.uf,
      cargo: c.cargo as 3 | 5,
      partido: c.partido,
      ...(x ? { x } : {}),
      ...(d ? { d } : {}),
    };
  }

  const senadores: Record<string, Senador2031> = {};
  if (e.senado2031) {
    for (const cod of [...e.senado2031.senadores.keys()].sort(compararSqcand)) {
      const s = e.senado2031.senadores.get(cod);
      if (!s) continue;
      const x = regsDe(`senado:${cod}`);
      const rel = der.alinhamento_senado
        ? relacaoPeloAlinhamento([cod], der.alinhamento_senado)
        : null;
      senadores[cod] = {
        uf: s.uf,
        partido: s.partido,
        ...(x ? { x } : {}),
        ...(rel ? { d: { relacao_governo: rel } } : {}),
      };
    }
  }

  const corpoNacional = {
    derivados: fontesDerivadas,
    partidos,
    padroes: ordenarChaves(padroes),
    candidatos,
    senado2031: {
      disponivel: e.senado2031?.completo ?? false,
      foto: e.senado2031?.foto ?? null,
      senadores,
    },
  };

  // ── 6. montar as UFs (Deputado Federal) ──────────────────────────────────
  const deputados = todos
    .filter((c) => c.cargo === 6)
    .sort((a, b) => compararSqcand(a.sqcand, b.sqcand));
  const alinCamara = fontesDerivadas.alinhamento_camara ? der.alinhamento_camara : null;
  const corposUf: Record<string, Omit<ArquivoUf, "formato" | "meta" | "uf">> = {};
  for (const uf of UFS) {
    const por_partido: Record<string, string[]> = {};
    const trajetoria: Partial<Record<ValorId<"trajetoria_cargo">, string[]>> = {};
    const alinhamento: Partial<Record<ValorId<"relacao_governo">, string[]>> = {};
    const excecoes: Record<string, Registros> = {};
    for (const c of deputados) {
      if (c.uf !== uf) continue;
      empilhar(por_partido, c.partido, c.sqcand);
      const t = der.trajetoria_camara?.por_sqcand.get(c.sqcand);
      if (t) empilhar(trajetoria, TRAJETORIA_PARA_VALOR[t.t], c.sqcand);
      if (t && alinCamara) {
        const r = relacaoPeloAlinhamento(t.ids, alinCamara);
        if (r) empilhar(alinhamento, r, c.sqcand);
      }
      const x = regsDe(c.sqcand);
      if (x) excecoes[c.sqcand] = x;
    }
    corposUf[uf] = {
      por_partido: ordenarChaves(por_partido),
      trajetoria: ordenarChaves(trajetoria),
      alinhamento: ordenarChaves(alinhamento),
      excecoes,
    };
  }

  // ── 7. meta: preservada quando o conteúdo não muda ───────────────────────
  const sha = createHash("sha256")
    .update(canonico({ nacional: corpoNacional, ufs: corposUf }))
    .digest("hex");
  const ant = e.anterior;
  const anteriorCompleto = ant.nacional !== null && UFS.every((u) => ant.ufs.has(u));
  const conteudoMudou = !(anteriorCompleto && ant.nacional?.meta.conteudo_sha256 === sha);
  const meta: MetaEtiquetas = conteudoMudou
    ? {
        versao: Math.max(
          (ant.nacional?.meta.versao ?? 0) + 1,
          Math.floor(e.agora.getTime() / 1000),
        ),
        gerado_em: e.agora.toISOString(),
        conteudo_sha256: sha,
        git_sha: null,
      }
    : { ...(ant.nacional as ArquivoNacional).meta, git_sha: null };

  const nacional: ArquivoNacional = {
    formato: FORMATO_ETIQUETAS,
    meta,
    publicar: todasDesligadas(),
    ...corpoNacional,
  };
  const ufs: Record<string, ArquivoUf> = {};
  for (const uf of UFS) {
    const corpo = corposUf[uf] as Omit<ArquivoUf, "formato" | "meta" | "uf">;
    ufs[uf] = { formato: FORMATO_ETIQUETAS, meta, uf, ...corpo };
  }

  // ── 8. histórico (RF-239) ────────────────────────────────────────────────
  const novas: EntradaHistorico[] = [];
  if (conteudoMudou) {
    const antes = efetivosDe(ant.nacional, ant.ufs.values());
    const depois = efetivosDe(nacional, Object.values(ufs));
    for (const k of [...new Set([...antes.keys(), ...depois.keys()])].sort()) {
      const ra = antes.get(k)?.registro;
      const rd = depois.get(k)?.registro;
      const igual =
        ra &&
        rd &&
        ra.valor === rd.valor &&
        ra.fonte_url === rd.fonte_url &&
        ra.fonte_descricao === rd.fonte_descricao &&
        ra.data === rd.data;
      if (igual) continue;
      const base = (depois.get(k) ?? antes.get(k)) as { chave: string; catKey: string };
      const { categoria, turno } = separarCatKey(base.catKey);
      const r = rd ?? ra;
      novas.push({
        em: meta.gerado_em,
        versao: meta.versao,
        chave: base.chave,
        categoria,
        turno,
        de: ra?.valor ?? null,
        para: rd?.valor ?? null,
        fonte_url: r?.fonte_url ?? null,
        fonte_descricao: r?.fonte_descricao ?? null,
        data: r?.data ?? null,
      });
    }
    for (const insumo of Object.keys(INSUMOS_DERIVADOS) as InsumoDerivado[]) {
      const antes = valoresDoInsumo(insumo, ant.nacional, ant.ufs.values());
      const depois = valoresDoInsumo(insumo, nacional, Object.values(ufs));
      let novos = 0;
      let removidos = 0;
      let alterados = 0;
      for (const [k, v] of depois) {
        const a = antes.get(k);
        if (a === undefined) novos++;
        else if (a !== v) alterados++;
      }
      for (const k of antes.keys()) if (!depois.has(k)) removidos++;
      if (novos + removidos + alterados === 0) continue;
      const fonte = nacional.derivados[insumo] ?? ant.nacional?.derivados[insumo] ?? null;
      novas.push({
        em: meta.gerado_em,
        versao: meta.versao,
        chave: `derivado:${insumo}`,
        categoria: INSUMOS_DERIVADOS[insumo],
        turno: null,
        de: null,
        para: null,
        fonte_url: fonte?.fonte_url ?? null,
        fonte_descricao: fonte?.fonte_descricao ?? null,
        data: fonte?.data ?? null,
        resumo: `${novos} classificadas, ${alterados} mudaram de valor, ${removidos} deixaram de ser classificadas`,
      });
    }
  }
  const historico: ArquivoHistorico = {
    formato: FORMATO_ETIQUETAS,
    meta: conteudoMudou ? meta : (ant.historico?.meta ?? meta),
    entradas: [...(ant.historico?.entradas ?? []), ...novas],
  };

  // ── 9. relatório de cobertura (turno 1) ──────────────────────────────────
  const cobertura: RelatorioCompilacao["cobertura"] = [];
  const contar = (alvo: AlvoEtiqueta, insumos: InsumosResolucao[]) => {
    for (const cat of ORDEM_CATEGORIAS) {
      if (!aplicaA(cat, alvo)) continue;
      const classificados = insumos.filter(
        (i) => resolverCategoria(i, cat, 1).estado === "classificado",
      ).length;
      cobertura.push({ alvo: String(alvo), categoria: cat, classificados, total: insumos.length });
    }
  };
  for (const cargo of [3, 5] as const) {
    contar(
      cargo,
      Object.entries(nacional.candidatos)
        .filter(([, c]) => c.cargo === cargo)
        .map(([sq, c]) => insumosMajoritario(nacional, sq, c)),
    );
  }
  contar(
    6,
    Object.values(ufs).flatMap((u) => insumosDeputadosDaUf(u, nacional)),
  );
  if (e.senado2031) {
    contar(
      "senado2031",
      Object.entries(nacional.senado2031.senadores).map(([cod, s]) =>
        insumosSenador2031(nacional, cod, s),
      ),
    );
  }

  return {
    ok: true,
    nacional,
    ufs,
    historico,
    relatorio: {
      linhas: totalLinhas,
      efetivas: efetivas.length,
      naoRevisadas,
      avisos,
      cobertura,
      mudancas: novas.length,
      conteudoMudou,
    },
  };
}
