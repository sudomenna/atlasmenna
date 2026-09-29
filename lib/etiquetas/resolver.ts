/**
 * lib/etiquetas/resolver.ts
 *
 * A **precedência** das etiquetas (spec 024, RF-223/224/225) — função pura,
 * usada pelo compilador (histórico, relatório) e pelo leitor (tela, portão).
 * Uma regra de precedência em dois lugares é como a tela passa a mostrar uma
 * coisa e o histórico registrar outra.
 *
 * Ordem, a primeira que existir vence:
 *
 *   1. linha individual revisada (`sqcand` / `senado:`)
 *   2. regra derivada — alinhamento → `relacao_governo`, trajetória →
 *      `trajetoria_cargo`; Câmara para cargo 6, Senado para cargo 5 e para
 *      os 27 de senado2031 (só alinhamento)
 *   3. padrão do partido (`partido:SIGLA`)
 *   4. padrão da federação (`federacao:SIGLA`) — o partido é mais específico
 *      que a federação que ele integra, por isso vem antes
 *   5. `a_classificar`
 *
 * 3 e 4 só valem em categoria que herda (`herdaDoPartido`).
 *
 * **Turno** (RF-225): em categoria por turno, cada turno lê SÓ as chaves
 * daquele turno. Não existe "cair para o 1º turno" — o palanque pode mudar no
 * 2º, e herdar o do 1º afirmaria uma coisa que ninguém conferiu.
 *
 * **Valor desconhecido** (catálogo mais novo que este deploy, ou arquivo
 * adulterado): para ali e devolve `a_classificar`. Não desce para o padrão do
 * partido — a linha individual existe e diz outra coisa; mostrar o do partido
 * no lugar contradiria a fonte.
 */

import {
  type AlvoEtiqueta,
  aplicaA,
  type CategoriaId,
  categoria as defCategoria,
  ORDEM_CATEGORIAS,
  rotuloDoValor,
  valorDoCatalogo,
} from "./catalogo";
import {
  chaveDeCategoria,
  chaveFederacao,
  chavePartido,
  type FonteDerivada,
  type InsumoDerivado,
  type Registro,
  type Registros,
  type ValoresDerivados,
} from "./formato";

export type Origem = "individual" | "derivado" | "partido";

export interface EtiquetaResolvida {
  categoria: CategoriaId;
  valor: string;
  /** `null` quando o valor não vira etiqueta (`centrao: nao`). */
  rotulo: string | null;
  origem: Origem;
  /** De onde veio: o `sqcand`/`senado:X`, `partido:X`, `federacao:X` ou `derivado:<insumo>`. */
  chave_origem: string;
  fonte_url: string;
  fonte_descricao: string;
  data: string;
}

export type Resolucao =
  | { estado: "classificado"; etiqueta: EtiquetaResolvida }
  | { estado: "a_classificar" }
  | { estado: "nao_se_aplica" };

export interface Derivado {
  valor: string;
  fonte: FonteDerivada;
  /** `derivado:alinhamento_camara` / `derivado:trajetoria_camara`. */
  chave: string;
}

/**
 * Converte os valores derivados gravados num candidato (`d`, ou os grupos do
 * arquivo de UF) em {@link Derivado}s com proveniência. Valor sem fonte no
 * cabeçalho (insumo ausente) é descartado — derivado sem fonte não vai à tela.
 */
export function derivadosDe(
  valores: ValoresDerivados | undefined,
  fontes: Readonly<Record<InsumoDerivado, FonteDerivada | null>>,
  casa: "camara" | "senado",
): Partial<Record<CategoriaId, Derivado>> {
  const out: Partial<Record<CategoriaId, Derivado>> = {};
  if (!valores) return out;
  const pares = [
    ["trajetoria_cargo", casa === "camara" ? "trajetoria_camara" : "trajetoria_senado"],
    ["relacao_governo", casa === "camara" ? "alinhamento_camara" : "alinhamento_senado"],
  ] as const;
  for (const [cat, insumo] of pares) {
    const valor = valores[cat];
    const fonte = fontes[insumo];
    if (valor && fonte) out[cat] = { valor, fonte, chave: `derivado:${insumo}` };
  }
  return out;
}

export interface InsumosResolucao {
  alvo: AlvoEtiqueta;
  /** Chave da linha individual — `sqcand` ou `senado:X` — só para proveniência. */
  chaveIndividual: string;
  individuais?: Registros;
  derivados?: Partial<Record<CategoriaId, Derivado>>;
  /** Sigla do partido (qualquer grafia; é normalizada aqui). `null` = desconhecido. */
  partido: string | null;
  /** `ArquivoNacional.padroes`. */
  padroes: Readonly<Record<string, Registros>>;
  /** `ArquivoNacional.partidos` — partido normalizado → federação normalizada. */
  partidos: Readonly<Record<string, string | null>>;
}

const A_CLASSIFICAR: Resolucao = { estado: "a_classificar" };
const NAO_SE_APLICA: Resolucao = { estado: "nao_se_aplica" };

function deRegistro(
  cat: CategoriaId,
  reg: Registro,
  origem: Origem,
  chaveOrigem: string,
): Resolucao {
  if (!valorDoCatalogo(cat, reg.valor)) return A_CLASSIFICAR;
  return {
    estado: "classificado",
    etiqueta: {
      categoria: cat,
      valor: reg.valor,
      rotulo: rotuloDoValor(cat, reg.valor),
      origem,
      chave_origem: chaveOrigem,
      fonte_url: reg.fonte_url,
      fonte_descricao: reg.fonte_descricao,
      data: reg.data,
    },
  };
}

/**
 * Resolve UMA categoria de UM alvo num turno. `turno` só importa em categoria
 * por turno; nas demais é ignorado.
 */
export function resolverCategoria(
  ins: InsumosResolucao,
  cat: CategoriaId,
  turno: 1 | 2,
): Resolucao {
  if (!aplicaA(cat, ins.alvo)) return NAO_SE_APLICA;
  const def = defCategoria(cat);
  const k = chaveDeCategoria(cat, def.porTurno ? turno : null);

  // 1. individual
  const ind = ins.individuais?.[k];
  if (ind) return deRegistro(cat, ind, "individual", ins.chaveIndividual);

  // 2. derivado (a chave do mapa é a categoria: um derivado de uma categoria
  //    não tem como vazar para outra)
  const der = ins.derivados?.[cat];
  if (der) {
    if (!valorDoCatalogo(cat, der.valor)) return A_CLASSIFICAR;
    return {
      estado: "classificado",
      etiqueta: {
        categoria: cat,
        valor: der.valor,
        rotulo: rotuloDoValor(cat, der.valor),
        origem: "derivado",
        chave_origem: der.chave,
        fonte_url: der.fonte.fonte_url,
        fonte_descricao: der.fonte.fonte_descricao,
        data: der.fonte.data,
      },
    };
  }

  // 3–4. padrão do partido, depois da federação
  if (def.herdaDoPartido && ins.partido) {
    const kp = chavePartido(ins.partido);
    const doPartido = ins.padroes[kp]?.[k];
    if (doPartido) return deRegistro(cat, doPartido, "partido", kp);

    const federacao = ins.partidos[kp.slice("partido:".length)] ?? null;
    if (federacao) {
      const kf = chaveFederacao(federacao);
      const daFederacao = ins.padroes[kf]?.[k];
      if (daFederacao) return deRegistro(cat, daFederacao, "partido", kf);
    }
  }

  return A_CLASSIFICAR;
}

/** Todas as categorias do catálogo, na ordem do catálogo. */
export function resolverTodas(ins: InsumosResolucao, turno: 1 | 2): Record<CategoriaId, Resolucao> {
  const out = {} as Record<CategoriaId, Resolucao>;
  for (const cat of ORDEM_CATEGORIAS) out[cat] = resolverCategoria(ins, cat, turno);
  return out;
}

/** Padrão de uma agremiação (partido ou federação) — para a Câmara 2027 e o vigia. */
export function resolverPadrao(
  padroes: Readonly<Record<string, Registros>>,
  chaveAgremiacao: string,
  cat: CategoriaId,
  turno: 1 | 2,
): Resolucao {
  const def = defCategoria(cat);
  if (!def.herdaDoPartido) return NAO_SE_APLICA;
  const reg = padroes[chaveAgremiacao]?.[chaveDeCategoria(cat, def.porTurno ? turno : null)];
  if (!reg) return A_CLASSIFICAR;
  return deRegistro(cat, reg, "partido", chaveAgremiacao);
}

export function estaClassificado(r: Resolucao): boolean {
  return r.estado === "classificado";
}
