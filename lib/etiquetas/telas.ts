/**
 * lib/etiquetas/telas.ts — a junção etiqueta ↔ tela das superfícies de LISTA
 * (spec 025, RF-245..RF-248): os "chips" ao lado do nome, os tokens do filtro
 * por etiqueta e as opções do `<select>`. Função pura sobre um objeto
 * `Etiquetas` já lido (`lerEtiquetas`) — sem I/O.
 *
 * ## Quem ganha chip
 *
 *   - **Cartões das capas** (`/governador`, `/senador`): só quem tem CHANCE na
 *     corrida (`comChance`, o mesmo conjunto do portão de cobertura, RF-233) —
 *     é o conjunto que o dono se compromete a manter classificado durante a
 *     noite; os demais ficariam com chip ou sem chip por acaso de cobertura.
 *   - **Páginas de UF e `/candidatos`**: toda candidatura da lista.
 *
 * Em todos os casos, só categoria **exibível** (critério publicado —
 * `categoriaExibivel`, constituição § 2 (a)) e só valor classificado com
 * rótulo (`centrao: nao` nunca vira chip nem token).
 *
 * ## 🔴 A ordem é a da ENTRADA, sempre (constituição § 2 (e), RF-238)
 *
 * Nada aqui ordena, filtra ou agrupa candidatos. O resultado é um MAPA por
 * `sqcand` que a tela consulta enquanto percorre a SUA lista, na ordem dela.
 * Os tokens de uma corrida são um conjunto (ordenado pelo catálogo, não pelos
 * candidatos). O filtro ESCONDE corridas inteiras por CSS — nunca reordena
 * (`EtiquetaFiltro`).
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";

import {
  CATEGORIAS_CHIP,
  type CategoriaId,
  categoriaExibivel,
  categoria as defCategoria,
  ORDEM_CATEGORIAS,
  QUALIFICADOR_VISIVEL,
  rotuloDoValor,
} from "./catalogo";
import { normalizarSqcand } from "./formato";
import { comEtiquetas } from "./juncao";
import type { CargoEtiquetado, Etiquetas } from "./leitor";
import { comChance, corridaDeUfRow } from "./portao";
import type { Resolucao } from "./resolver";

/** As resoluções que uma tela exibe para UM candidato — só exibíveis e classificadas. */
export type ResolucoesExibiveis = Partial<Record<CategoriaId, Resolucao>>;

/**
 * Só as categorias pedidas que PODEM ir à tela (critério publicado) e estão
 * classificadas com rótulo. `null` quando não sobra nada — a tela não desenha
 * a linha.
 */
export function exibiveis(
  r: Record<CategoriaId, Resolucao>,
  categorias: readonly CategoriaId[],
): ResolucoesExibiveis | null {
  const out: ResolucoesExibiveis = {};
  let n = 0;
  for (const cat of categorias) {
    if (!categoriaExibivel(cat)) continue;
    const x = r[cat];
    if (x?.estado !== "classificado" || x.etiqueta.rotulo === null) continue;
    out[cat] = x;
    n++;
  }
  return n > 0 ? out : null;
}

/** `categoria:valor` — o token que o filtro procura em `data-etq`. */
export function token(categoria: CategoriaId, valor: string): string {
  return `${categoria}:${valor}`;
}

/** Tokens de UMA resolução exibível, na ordem do catálogo. */
export function tokensDe(r: ResolucoesExibiveis | null | undefined): string[] {
  if (!r) return [];
  const out: string[] = [];
  for (const cat of ORDEM_CATEGORIAS) {
    const x = r[cat];
    if (x?.estado === "classificado") out.push(token(cat, x.etiqueta.valor));
  }
  return out;
}

/** O que UMA corrida (um cartão) leva de etiqueta. */
export interface EtiquetasDaCorrida {
  /** `sqcand` normalizado → o que o chip mostra. Só quem tem chance e tem algo exibível. */
  porSqcand: Map<string, ResolucoesExibiveis>;
  /**
   * Tokens da corrida para `data-etq` (união dos candidatos com chance, na
   * ordem do catálogo), ou `undefined` quando o filtro está desligado — aí o
   * atributo nem sai no HTML.
   */
  tokens: string | undefined;
}

export interface OpcoesCapa {
  cargo: 3 | 5;
  turno: 1 | 2;
  preEleicao: boolean;
  /** Vagas por UF (Senado: 2). */
  vagasUf?: number | null;
}

/**
 * As etiquetas dos CARTÕES de uma capa (`/governador`, `/senador`), por UF.
 * Mapa vazio quando nem `chips` nem `filtro` estão ligados — a capa sai
 * idêntica à de antes.
 *
 * Chips: {@link CATEGORIAS_CHIP}. Tokens do filtro: os mesmos e, no Senado,
 * também o impeachment (qualificado na opção do `<select>`).
 */
export function etiquetasDasCorridas(
  etiquetas: Etiquetas,
  rows: readonly EdgeUfRow[],
  o: OpcoesCapa,
): Map<string, EtiquetasDaCorrida> {
  const chips = etiquetas.viewLigada("chips");
  const filtro = etiquetas.viewLigada("filtro");
  const out = new Map<string, EtiquetasDaCorrida>();
  if (!chips && !filtro) return out;
  const categoriasToken: CategoriaId[] =
    o.cargo === 5 ? [...CATEGORIAS_CHIP, "impeachment_stf"] : [...CATEGORIAS_CHIP];

  for (const row of rows) {
    const { membros } = comChance(
      corridaDeUfRow(row, {
        cargo: o.cargo,
        turno: o.turno,
        preEleicao: o.preEleicao,
        vagasUf: o.vagasUf ?? null,
      }),
    );
    const porSqcand = new Map<string, ResolucoesExibiveis>();
    const tokens = new Set<string>();
    // `comEtiquetas` (juncao.ts) — o ÚNICO lugar em que lista encontra
    // etiqueta, e que preserva a ordem de entrada (RF-238).
    const juntos = comEtiquetas(membros, (m) => etiquetas.resolver(m.sqcand, o.cargo, o.turno));
    for (const { item: m, etiquetas: r } of juntos) {
      const sq = normalizarSqcand(m.sqcand);
      if (!sq) continue;
      if (chips) {
        const e = exibiveis(r, CATEGORIAS_CHIP);
        if (e) porSqcand.set(sq, e);
      }
      if (filtro) for (const t of tokensDe(exibiveis(r, categoriasToken))) tokens.add(t);
    }
    const ordenados = ordenarTokens(tokens);
    out.set(row.sigla, {
      porSqcand,
      tokens: filtro ? ordenados.join(" ") : undefined,
    });
  }
  return out;
}

/** Tokens na ordem do catálogo (categoria, depois valor) — nunca na dos candidatos. */
export function ordenarTokens(tokens: Iterable<string>): string[] {
  const posicao = (t: string): [number, number] => {
    const [cat = "", valor = ""] = t.split(":");
    const ci = ORDEM_CATEGORIAS.indexOf(cat as CategoriaId);
    const vi =
      ci >= 0 ? defCategoria(cat as CategoriaId).valores.findIndex((v) => v.id === valor) : -1;
    return [ci < 0 ? 999 : ci, vi < 0 ? 999 : vi];
  };
  return [...tokens].sort((a, b) => {
    const [ca, va] = posicao(a);
    const [cb, vb] = posicao(b);
    return ca - cb || va - vb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/**
 * As etiquetas de uma LISTA inteira (páginas de UF, `/candidatos`): todo
 * candidato, na ordem que a tela já tem. Mapa vazio com `chips` desligado.
 */
export function etiquetasDaLista(
  etiquetas: Etiquetas,
  candidatos: readonly { sqcand?: string | number | null }[],
  cargo: CargoEtiquetado,
  turno: 1 | 2,
  categorias: readonly CategoriaId[],
): Map<string, ResolucoesExibiveis> {
  const out = new Map<string, ResolucoesExibiveis>();
  if (!etiquetas.viewLigada("chips")) return out;
  for (const { item, etiquetas: r } of comEtiquetas(candidatos, (c) =>
    etiquetas.resolver(c.sqcand, cargo, turno),
  )) {
    const sq = normalizarSqcand(item.sqcand);
    if (!sq || out.has(sq)) continue;
    const e = exibiveis(r, categorias);
    if (e) out.set(sq, e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opções do filtro
// ---------------------------------------------------------------------------

export interface OpcaoFiltro {
  token: string;
  rotulo: string;
}

export interface GrupoFiltro {
  categoria: CategoriaId;
  /** Rótulo do `<optgroup>` — qualificado quando a categoria pede (impeachment). */
  rotulo: string;
  opcoes: OpcaoFiltro[];
}

/**
 * Os grupos do `<select>` do filtro: uma categoria por `<optgroup>`, na ordem
 * do catálogo, e só os valores que APARECEM na página (opção que esconde tudo
 * seria um beco sem saída). Categoria sem critério publicado não entra.
 */
export function opcoesDoFiltro(tokensPresentes: Iterable<string>): GrupoFiltro[] {
  const presentes = new Set<string>();
  for (const t of tokensPresentes) for (const x of t.split(" ")) if (x) presentes.add(x);
  const grupos: GrupoFiltro[] = [];
  for (const cat of ORDEM_CATEGORIAS) {
    if (!categoriaExibivel(cat)) continue;
    const def = defCategoria(cat);
    const opcoes: OpcaoFiltro[] = [];
    for (const v of def.valores) {
      const t = token(cat, v.id);
      const rotulo = rotuloDoValor(cat, v.id);
      if (rotulo !== null && presentes.has(t)) opcoes.push({ token: t, rotulo });
    }
    if (opcoes.length > 0) {
      grupos.push({ categoria: cat, rotulo: QUALIFICADOR_VISIVEL[cat] ?? def.rotulo, opcoes });
    }
  }
  return grupos;
}

/**
 * Tudo o que o filtro PODE ter de opção, pelo catálogo (sem olhar a página) —
 * é contra isto que o teste confere que o CSS do filtro tem uma regra para
 * cada token (spec 025, RF-247).
 */
export function todosOsTokensDoCatalogo(): string[] {
  const out: string[] = [];
  for (const cat of ORDEM_CATEGORIAS) {
    for (const v of defCategoria(cat).valores) {
      if (rotuloDoValor(cat, v.id) !== null) out.push(token(cat, v.id));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pacote de uma capa (`/governador`, `/senador`)
// ---------------------------------------------------------------------------

/** O que uma capa precisa para ligar chips, filtro e aviso — num objeto só. */
export interface EditorialDaCapa {
  /** Chips + tokens de um cartão (`/governador`: `data-etq` no `<article>`). */
  cartao(sigla: string): EtiquetasDaCorrida | undefined;
  /** Só os chips (`/senador`: os tokens vão no `<li>` que envolve o link). */
  chips(sigla: string): EtiquetasDaCorrida | undefined;
  /** Só os tokens, para `data-etq` de um invólucro. */
  tokens(sigla: string): string | undefined;
  /**
   * `{ "data-etq": tokens }` ou `{}` — para espalhar num invólucro. Espalhar, e
   * não `data-etq={undefined}`: dentro de um componente cliente o `undefined`
   * vira `"data-etq":"$undefined"` no payload RSC, por cartão.
   */
  atributos(sigla: string): { "data-etq"?: string };
  /** Opções do `<select>` — vazio com o filtro desligado ou nada a filtrar. */
  filtro: GrupoFiltro[];
  /** Há alguma etiqueta na capa (chip ou filtro)? Então o aviso vai junto. */
  aviso: boolean;
}

export function editorialDaCapa(
  etiquetas: Etiquetas,
  rows: readonly EdgeUfRow[],
  o: OpcoesCapa,
): EditorialDaCapa {
  const porUf = etiquetasDasCorridas(etiquetas, rows, o);
  const filtro = etiquetas.viewLigada("filtro")
    ? opcoesDoFiltro([...porUf.values()].map((e) => e.tokens ?? ""))
    : [];
  const comChip = [...porUf.values()].some((e) => e.porSqcand.size > 0);
  return {
    cartao: (sigla) => porUf.get(sigla),
    chips: (sigla) => {
      const e = porUf.get(sigla);
      return e ? { porSqcand: e.porSqcand, tokens: undefined } : undefined;
    },
    tokens: (sigla) => porUf.get(sigla)?.tokens,
    atributos: (sigla) => {
      const t = porUf.get(sigla)?.tokens;
      return t !== undefined ? { "data-etq": t } : {};
    },
    filtro,
    aviso: comChip || filtro.length > 0,
  };
}
