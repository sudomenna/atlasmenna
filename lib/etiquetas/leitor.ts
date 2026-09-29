/**
 * lib/etiquetas/leitor.ts
 *
 * Leitura das etiquetas editoriais **no servidor** (spec 024, RF-231/232;
 * ADR-0060). Duas cópias, vence a de maior `versao`:
 *
 *   - **Blob** `etiquetas/v1/*` — o que o dono publica sem deploy
 *     (`pnpm etiquetas:publicar`), lido com `revalidate: 60` — mesmo piso dos
 *     leitores de apuração (`lib/blob/deputado-uf.ts`, `lib/blob/uf-detail.ts`),
 *     casado com o `cacheControlMaxAge: 60` que `lib/blob/write.ts` grava.
 *   - **Cópia do build** `lib/data/etiquetas/` (`embutido.ts`) — o piso. Blob
 *     ausente, fora do ar ou com corpo inválido ⇒ esta, sem erro na tela
 *     (constituição § 7).
 *
 * ## As chaves por visão vêm do `publicar.json` versionado — nos DOIS lados
 *
 * **Emenda de 2026-09-29 (spec 025; ADR-0060, emenda; RF-231 emendado).** Até
 * esta data a cópia do build tinha as chaves SEMPRE desligadas, e este leitor
 * as forçava a `false`. Combinado com "vence a maior `versao`", isso armava uma
 * armadilha para o dia D: um deploy que levasse uma compilação mais nova que a
 * última publicação fazia a cópia do build vencer — e apagava, em silêncio,
 * toda visão que o dono tinha ligado, até a próxima publicação (open question 5
 * da spec 024). Com o deploy congelado das 16h às 5h, ninguém perceberia.
 *
 * Agora o compilador grava na cópia do build as chaves de
 * `editorial/etiquetas/publicar.json` (o arquivo que o dono edita e versiona),
 * e o publicador leva ao Blob o MESMO arquivo — e recusa publicar se os dois
 * divergirem. Então Blob e build dizem a mesma coisa sobre o que está ligado,
 * e quem vence pela versão não muda o que aparece. Consequências:
 *   - deploy depois de publicação NÃO apaga visão (o teste que trava isso está
 *     em `tests/unit/etiquetas/leitor.test.ts`, "deploy depois da publicação");
 *   - Blob fora do ar mantém as visões que o `publicar.json` do deploy liga
 *     (o último estado conhecido, constituição § 7), em vez de apagá-las;
 *   - desligar uma visão às pressas é publicar com a chave em `false`; o build
 *     no ar ainda diz `true` até o próximo deploy — se o Blob cair NESSA janela,
 *     a visão volta. É o custo conhecido, registrado na emenda do ADR-0060.
 *
 * Chave com valor não booleano, ou ausente, fica desligada (falha fechada).
 *
 * ## Só no servidor
 *
 * O repositório não usa o pacote `server-only` (não está na stack, e
 * acrescentá-lo exige ADR). A garantia é de construção: o `fetch` com
 * `next.revalidate` e o import dos gerados só fazem sentido em Server
 * Component / script; nenhum componente cliente importa este módulo.
 *
 * ## Nunca lança
 *
 * Toda falha de leitura degrada para a cópia do build; toda consulta a
 * candidato desconhecido devolve `a_classificar`. A tela nunca quebra por
 * causa de uma etiqueta.
 */

import { blobUrlFor } from "@/lib/blob/paths";

import {
  etiquetasHistoricoBlobPathname,
  etiquetasNacionalBlobPathname,
  etiquetasUfBlobPathname,
} from "./caminhos";
import {
  type AlvoEtiqueta,
  type CategoriaId,
  type ChavesPublicacao,
  ORDEM_CATEGORIAS,
  todasDesligadas,
  type Visao,
} from "./catalogo";
import { CARREGADOR_HISTORICO, CARREGADORES_UF, NACIONAL_EMBUTIDO } from "./embutido";
import {
  type ArquivoHistorico,
  type ArquivoNacional,
  type ArquivoUf,
  chaveFederacao,
  chavePartido,
  isArquivoHistorico,
  isArquivoNacional,
  isArquivoUf,
  isSiglaUf,
  normalizarSigla,
  normalizarSqcand,
} from "./formato";
import { indiceDeputadosDaUf, insumosMajoritario, insumosSenador2031 } from "./montagem";
import {
  type EtiquetaResolvida,
  type InsumosResolucao,
  type Resolucao,
  resolverPadrao,
  resolverTodas,
} from "./resolver";

/** 60 s — ver o cabeçalho. */
export const ETIQUETAS_REVALIDATE_SECONDS = 60;

export type FonteEtiquetas = "blob" | "embutido";

export type MotivoIndisponivel = "not_configured" | "not_found" | "fetch_error" | "invalid";

export type LeituraBlob<T> =
  | { status: "ok"; valor: T }
  | { status: "indisponivel"; motivo: MotivoIndisponivel };

/** GET de um JSON do Blob com o Data Cache do Next. Nunca lança. */
export async function lerJsonDoBlob<T>(
  pathname: string,
  guarda: (v: unknown) => v is T,
): Promise<LeituraBlob<T>> {
  const url = blobUrlFor(pathname);
  if (!url) return { status: "indisponivel", motivo: "not_configured" };
  let res: Response;
  try {
    // Sem AbortSignal: um `signal` desliga o Data Cache (ver lib/blob/deputado-uf.ts).
    res = await fetch(url, { next: { revalidate: ETIQUETAS_REVALIDATE_SECONDS } } as RequestInit);
  } catch {
    return { status: "indisponivel", motivo: "fetch_error" };
  }
  if (res.status === 404) return { status: "indisponivel", motivo: "not_found" };
  if (!res.ok) return { status: "indisponivel", motivo: "fetch_error" };
  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    return { status: "indisponivel", motivo: "invalid" };
  }
  return guarda(corpo)
    ? { status: "ok", valor: corpo }
    : { status: "indisponivel", motivo: "invalid" };
}

/**
 * A regra de escolha (RF-231), pura: o Blob só vence com `versao`
 * **estritamente** maior. Empate fica com a cópia do build — mesmo conteúdo,
 * e ela não depende de rede.
 */
export function escolherMaisNovo<T extends { meta: { versao: number } }>(
  blob: T | null,
  embutido: T,
): { arquivo: T; fonte: FonteEtiquetas } {
  if (blob && blob.meta.versao > embutido.meta.versao) return { arquivo: blob, fonte: "blob" };
  return { arquivo: embutido, fonte: "embutido" };
}

// ---------------------------------------------------------------------------
// O objeto de consulta
// ---------------------------------------------------------------------------

export type CargoEtiquetado = 3 | 5 | 6;

export interface Etiquetas {
  fonte: FonteEtiquetas;
  versao: number;
  /**
   * O arquivo nacional escolhido, cru — para a página de metodologia listar
   * as classificações publicadas (spec 025, RF-252). As telas de voto usam
   * `resolver`, nunca isto.
   */
  nacional: ArquivoNacional;
  /** O arquivo da UF carregada, cru (mesmo uso: metodologia). `null` sem UF. */
  arquivoUf: ArquivoUf | null;
  /** A UF cujos deputados foram carregados (`null` = só o nacional). */
  uf: string | null;
  publicar: ChavesPublicacao;
  viewLigada(visao: Visao): boolean;
  /**
   * Todas as categorias de um candidato, na ordem do catálogo. `sqcand` aceita
   * `number` e `string` (RF-232). Cargo 6 exige ter carregado a UF.
   */
  resolver(
    sqcand: string | number | null | undefined,
    cargo: CargoEtiquetado,
    turno: 1 | 2,
  ): Record<CategoriaId, Resolucao>;
  /** Só as classificadas, na ordem do catálogo — o que a tela mostra. */
  classificadas(
    sqcand: string | number | null | undefined,
    cargo: CargoEtiquetado,
    turno: 1 | 2,
  ): EtiquetaResolvida[];
  senador2031(codigo: string | number, turno: 1 | 2): Record<CategoriaId, Resolucao>;
  senado2031: { disponivel: boolean; foto: string | null; codigos: string[] };
  /** Padrão do partido, caindo na federação dele quando o partido não tem linha. */
  padraoDoPartido(sigla: string, turno: 1 | 2): Record<CategoriaId, Resolucao>;
  /** Padrão de uma agremiação da Câmara — partido isolado ou federação — sem herança entre as duas. */
  padraoDaAgremiacao(
    sigla: string,
    tipo: "partido" | "federacao",
    turno: 1 | 2,
  ): Record<CategoriaId, Resolucao>;
  /**
   * A federação (normalizada) que o TSE registra para o partido, ou `null`.
   * Spec 025: o payload da Câmara nomeia a federação pelo apelido do EA20
   * ("FE BRASIL") e lista os partidos-membro; o padrão editorial é chaveado
   * pela federação do cadastro ("PT/PC DO B/PV") — é por aqui que as duas se
   * encontram.
   */
  federacaoDoPartido(sigla: string): string | null;
  /**
   * Todos os `sqcand` de uma corrida majoritária (cargo 3 ou 5 numa UF), na
   * ordem do arquivo — o `universo` que o portão exige na fase pré-eleição ou
   * quando a cauda pode ter chance (RF-233). Spec 025.
   */
  universo(cargo: 3 | 5, uf: string): string[];
}

const TODAS_A_CLASSIFICAR = (): Record<CategoriaId, Resolucao> => {
  const out = {} as Record<CategoriaId, Resolucao>;
  for (const c of ORDEM_CATEGORIAS) out[c] = { estado: "a_classificar" };
  return out;
};

function naoSeAplicaFora(
  alvo: AlvoEtiqueta,
  r: Record<CategoriaId, Resolucao>,
): Record<CategoriaId, Resolucao> {
  // Mantém `nao_se_aplica` coerente mesmo quando o candidato é desconhecido.
  const base = resolverTodas(
    { alvo, chaveIndividual: "", partido: null, padroes: {}, partidos: {} },
    1,
  );
  for (const c of ORDEM_CATEGORIAS) {
    if (base[c].estado === "nao_se_aplica") r[c] = { estado: "nao_se_aplica" };
  }
  return r;
}

/**
 * Monta o objeto de consulta a partir de arquivos já escolhidos. Puro —
 * exportado para teste e para o vigia.
 */
export function montarEtiquetas(
  nacional: ArquivoNacional,
  fonte: FonteEtiquetas,
  uf: ArquivoUf | null,
): Etiquetas {
  // As chaves do arquivo escolhido — Blob ou build carregam o MESMO
  // `publicar.json` (ver o cabeçalho). Só `true` literal liga.
  const publicar: ChavesPublicacao = { ...todasDesligadas(), ...pickBooleans(nacional.publicar) };
  const idxUf = uf ? indiceDeputadosDaUf(uf, nacional) : null;
  const base = { padroes: nacional.padroes, partidos: nacional.partidos };

  const resolver: Etiquetas["resolver"] = (sqcandBruto, cargo, turno) => {
    const sq = normalizarSqcand(sqcandBruto);
    if (!sq) return naoSeAplicaFora(cargo, TODAS_A_CLASSIFICAR());
    let ins: InsumosResolucao | undefined;
    if (cargo === 6) {
      ins = idxUf?.get(sq);
    } else {
      const c = nacional.candidatos[sq];
      // O cargo tem de bater: um sqcand de Governador consultado como Senador
      // não herda nada — é outro candidato.
      if (c && c.cargo === cargo) ins = insumosMajoritario(nacional, sq, c);
    }
    return ins ? resolverTodas(ins, turno) : naoSeAplicaFora(cargo, TODAS_A_CLASSIFICAR());
  };

  const padraoDaAgremiacao: Etiquetas["padraoDaAgremiacao"] = (sigla, tipo, turno) => {
    const chave = tipo === "partido" ? chavePartido(sigla) : chaveFederacao(sigla);
    const out = {} as Record<CategoriaId, Resolucao>;
    for (const c of ORDEM_CATEGORIAS) out[c] = resolverPadrao(nacional.padroes, chave, c, turno);
    return out;
  };

  return {
    fonte,
    versao: nacional.meta.versao,
    nacional,
    arquivoUf: uf,
    uf: uf?.uf ?? null,
    publicar,
    viewLigada: (v) => publicar[v] === true,
    resolver,
    classificadas: (sq, cargo, turno) =>
      Object.values(resolver(sq, cargo, turno)).flatMap((r) =>
        r.estado === "classificado" ? [r.etiqueta] : [],
      ),
    senador2031: (codigo, turno) => {
      const cod = String(codigo).trim();
      const s = nacional.senado2031.senadores[cod];
      if (!s) return naoSeAplicaFora("senado2031", TODAS_A_CLASSIFICAR());
      return resolverTodas(insumosSenador2031(nacional, cod, s), turno);
    },
    senado2031: {
      disponivel: nacional.senado2031.disponivel,
      foto: nacional.senado2031.foto,
      codigos: Object.keys(nacional.senado2031.senadores),
    },
    padraoDoPartido: (sigla, turno) => {
      // Um "candidato" sem linha individual do partido pedido: a precedência
      // partido → federação é a mesma do resolvedor.
      const r = resolverTodas(
        { ...base, alvo: 6, chaveIndividual: "", partido: normalizarSigla(sigla) },
        turno,
      );
      for (const c of ORDEM_CATEGORIAS)
        if (c === "trajetoria_cargo" || c === "impeachment_stf") r[c] = { estado: "nao_se_aplica" };
      return r;
    },
    padraoDaAgremiacao,
    federacaoDoPartido: (sigla) => nacional.partidos[normalizarSigla(sigla)] ?? null,
    universo: (cargo, ufPedida) => {
      const alvo = ufPedida.toUpperCase();
      const out: string[] = [];
      for (const [sq, c] of Object.entries(nacional.candidatos)) {
        if (c.cargo === cargo && c.uf === alvo) out.push(sq);
      }
      return out;
    },
  };
}

function pickBooleans(o: unknown): Partial<ChavesPublicacao> {
  const out: Partial<ChavesPublicacao> = {};
  if (typeof o !== "object" || o === null) return out;
  for (const [k, v] of Object.entries(o)) {
    if (v === true) (out as Record<string, boolean>)[k] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

function embutidoNacional(): ArquivoNacional {
  if (!isArquivoNacional(NACIONAL_EMBUTIDO)) {
    // Inalcançável com o gerado versionado (teste de deriva); se acontecer, é
    // bug de build — melhor um nacional vazio e tudo `a_classificar` que 500.
    return {
      formato: "etiquetas/v1",
      meta: { versao: 0, gerado_em: "", conteudo_sha256: "", git_sha: null },
      publicar: todasDesligadas(),
      derivados: {
        trajetoria_camara: null,
        alinhamento_camara: null,
        trajetoria_senado: null,
        alinhamento_senado: null,
      },
      partidos: {},
      padroes: {},
      candidatos: {},
      senado2031: { disponivel: false, foto: null, senadores: {} },
    };
  }
  return NACIONAL_EMBUTIDO;
}

async function embutidoUf(uf: string): Promise<ArquivoUf | null> {
  if (!isSiglaUf(uf)) return null;
  try {
    const mod = await CARREGADORES_UF[uf]();
    return isArquivoUf(mod.default, uf) ? mod.default : null;
  } catch {
    return null;
  }
}

/**
 * Carrega as etiquetas: o nacional sempre; os deputados de UMA UF quando
 * pedida. Cada arquivo escolhe sozinho entre Blob e build pela maior `versao`
 * — durante uma publicação, por até 60 s, o nacional e a UF podem vir de
 * versões vizinhas; as duas metades são dado revisado.
 */
export async function lerEtiquetas(opts: { uf?: string | null } = {}): Promise<Etiquetas> {
  const ufPedida = opts.uf ? opts.uf.toUpperCase() : null;
  const [blobNac, blobUf] = await Promise.all([
    lerJsonDoBlob(etiquetasNacionalBlobPathname(), isArquivoNacional),
    ufPedida && isSiglaUf(ufPedida)
      ? lerJsonDoBlob(etiquetasUfBlobPathname(ufPedida), (v): v is ArquivoUf =>
          isArquivoUf(v, ufPedida),
        )
      : Promise.resolve(null),
  ]);
  const nac = escolherMaisNovo(blobNac.status === "ok" ? blobNac.valor : null, embutidoNacional());

  let uf: ArquivoUf | null = null;
  if (ufPedida) {
    const emb = await embutidoUf(ufPedida);
    const doBlob = blobUf && blobUf.status === "ok" ? blobUf.valor : null;
    if (emb) uf = escolherMaisNovo(doBlob, emb).arquivo;
    else uf = doBlob;
  }
  return montarEtiquetas(nac.arquivo, nac.fonte, uf);
}

/**
 * O histórico público de alterações (RF-239) — só para `/sobre-as-etiquetas`
 * (spec 025, RF-252). Mesma regra do nacional: a maior `versao` entre Blob e
 * cópia do build; Blob fora ⇒ build. O arquivo pode passar de 2 MB no pior
 * caso (design 024 § 2.3) — acima disso o Data Cache do Next não guarda a
 * resposta, mas o `fetch` ainda devolve o corpo; a página só MOSTRA as
 * entradas mais recentes e aponta para o arquivo inteiro. Nunca lança.
 */
export async function lerHistoricoEtiquetas(): Promise<{
  arquivo: ArquivoHistorico;
  fonte: FonteEtiquetas;
  url: string | null;
}> {
  const vazio: ArquivoHistorico = {
    formato: "etiquetas/v1",
    meta: { versao: 0, gerado_em: "", conteudo_sha256: "", git_sha: null },
    entradas: [],
  };
  const doBlob = await lerJsonDoBlob(etiquetasHistoricoBlobPathname(), isArquivoHistorico);
  let embutido = vazio;
  try {
    const mod = await CARREGADOR_HISTORICO();
    if (isArquivoHistorico(mod.default)) embutido = mod.default;
  } catch {
    // cópia do build ilegível: fica o vazio, e a página diz que não há registro.
  }
  const escolhido = escolherMaisNovo(doBlob.status === "ok" ? doBlob.valor : null, embutido);
  return {
    arquivo: escolhido.arquivo,
    fonte: escolhido.fonte,
    url: escolhido.fonte === "blob" ? blobUrlFor(etiquetasHistoricoBlobPathname()) : null,
  };
}

// ---------------------------------------------------------------------------
// Atalhos (a API que as telas chamam)
// ---------------------------------------------------------------------------

/** Categorias de UM candidato. Cargo 6 exige `uf`. */
export async function etiquetasDe(
  sqcand: string | number | null | undefined,
  cargo: CargoEtiquetado,
  turno: 1 | 2,
  uf?: string | null,
): Promise<Record<CategoriaId, Resolucao>> {
  const e = await lerEtiquetas({ uf: cargo === 6 ? (uf ?? null) : null });
  return e.resolver(sqcand, cargo, turno);
}

export async function padraoDoPartido(
  sigla: string,
  turno: 1 | 2 = 1,
): Promise<Record<CategoriaId, Resolucao>> {
  return (await lerEtiquetas()).padraoDoPartido(sigla, turno);
}

export async function viewLigada(visao: Visao): Promise<boolean> {
  return (await lerEtiquetas()).viewLigada(visao);
}
