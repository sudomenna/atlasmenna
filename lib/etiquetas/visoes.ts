/**
 * lib/etiquetas/visoes.ts — as visões editoriais AGREGADAS da spec 025, como
 * funções puras sobre um `Etiquetas` já lido e o payload que a página já tem:
 *
 *   - **V1** — Senado de 2027 por bloco (RF-242);
 *   - **V2** — impeachment de ministros do STF no Senado de 2027 (RF-243);
 *   - **Câmara 2027** por bloco (RF-244);
 *   - **V4** — renovação do Senado (RF-249).
 *
 * ## Três portas, sempre as três (constituição 1.6 § 2 (a) e (f))
 *
 * Uma visão só é devolvida `ok` quando:
 *   1. a chave dela está ligada (`viewLigada`, `publicar.json`);
 *   2. a categoria de que ela depende tem critério publicado
 *      (`categoriaExibivel`);
 *   3. o portão de cobertura passa (`lib/etiquetas/portao.ts`) — todo
 *      candidato com chance classificado, os 27 que seguem até 2031
 *      classificados, toda agremiação com cadeira classificada.
 *
 * Qualquer uma falhando ⇒ `{ ok: false, motivo }` e a tela NÃO desenha nada —
 * nem um "a classificar", nem um "em breve" (decisão do dono, 29/09).
 *
 * ## Nenhuma etiqueta muda ordem de candidato
 *
 * As listas daqui estão na ordem da UF (alfabética) e, dentro da UF, na ordem
 * do payload (a da projeção). A visão por bloco ordena CADEIRAS por bloco —
 * é o propósito dela, e a ordem dos blocos é fixa pelo catálogo
 * (`ORDEM_BLOCOS_HEMICICLO`), nunca pela apuração nem pela etiqueta de alguém.
 */

import { cargoInfo } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import type {
  EdgeAgremiacaoBancada,
  EdgeBancadaNacional,
  EdgePayload,
} from "@/lib/edge-config/types";
import type { ValidacaoFotoSenado, ValidacaoMandato2031 } from "@/lib/senado/mandato-2031";
import { queCompetem } from "@/lib/utils/destino-voto";
import { limiaresDaCasa } from "@/lib/utils/hemiciclo-bloco";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import {
  chavePartido,
  derivarSenado2027,
  PCT_UF_CONCLUIDA,
  type Senado2027,
} from "@/lib/utils/senado-2027";

import {
  type BlocoHemiciclo,
  blocoDoHemiciclo,
  type CategoriaId,
  categoriaExibivel,
  ORDEM_BLOCOS_HEMICICLO,
  type Visao,
} from "./catalogo";
import { normalizarSqcand } from "./formato";
import type { Etiquetas } from "./leitor";
import {
  avaliarCamara2027,
  avaliarCorridas,
  avaliarSenado2031,
  avaliarUniverso,
  type Bloqueante,
  type CorridaPortao,
  corridaDeUfRow,
  juntarPortoes,
  type ResultadoPortao,
} from "./portao";
import type { EtiquetaResolvida, Resolucao } from "./resolver";

// ---------------------------------------------------------------------------
// Resultado comum
// ---------------------------------------------------------------------------

export type MotivoVisaoOculta =
  | "desligada"
  | "sem_criterio"
  | "sem_dados"
  | "recusa_senado"
  | "portao";

export type ResultadoVisao<T> =
  | { ok: true; visao: T }
  | { ok: false; motivo: MotivoVisaoOculta; bloqueantes: Bloqueante[]; detalhe?: string };

function oculta<T>(
  motivo: MotivoVisaoOculta,
  bloqueantes: Bloqueante[] = [],
  detalhe?: string,
): ResultadoVisao<T> {
  return { ok: false, motivo, bloqueantes, ...(detalhe ? { detalhe } : {}) };
}

/** As duas primeiras portas (chave e critério). `null` = pode seguir. */
function portas<T>(etiquetas: Etiquetas, visao: Visao, cat: CategoriaId): ResultadoVisao<T> | null {
  if (!etiquetas.viewLigada(visao)) return oculta("desligada");
  if (!categoriaExibivel(cat)) return oculta("sem_criterio");
  return null;
}

function classificada(r: Resolucao | undefined): boolean {
  return r?.estado === "classificado";
}

/** `(sqcand) => está classificado na categoria?` para o portão. */
export function classificadoEm(
  etiquetas: Etiquetas,
  cargo: 3 | 5,
  turno: 1 | 2,
  cat: CategoriaId,
): (sqcand: string) => boolean {
  return (sq) => classificada(etiquetas.resolver(sq, cargo, turno)[cat]);
}

// ---------------------------------------------------------------------------
// Visão por bloco (V1 e Câmara 2027)
// ---------------------------------------------------------------------------

/** De onde vem a cadeira — o texto do placar a detalha; o desenho mostra só o bloco. */
export type OrigemCadeira = "continua_2031" | "decidida" | "projetada" | "atribuida" | "aguardando";

const ORDEM_ORIGEM: readonly OrigemCadeira[] = [
  "continua_2031",
  "decidida",
  "projetada",
  "atribuida",
  "aguardando",
];

export interface CadeiraDoBloco {
  bloco: BlocoHemiciclo;
  origem: OrigemCadeira;
}

export interface VisaoPorBloco {
  total: number;
  /** As cadeiras na ordem do desenho: blocos na ordem fixa do catálogo. */
  cadeiras: CadeiraDoBloco[];
  contagem: Record<BlocoHemiciclo, number>;
  porOrigem: Record<BlocoHemiciclo, Partial<Record<OrigemCadeira, number>>>;
}

/**
 * Ordena as cadeiras pela ordem FIXA dos blocos (Base → Independentes →
 * aguardando → Oposição) e, dentro do bloco, pela origem (as que continuam
 * primeiro). A entrada pode vir em qualquer ordem: a saída não depende dela.
 */
export function ordenarPorBloco(cadeiras: readonly CadeiraDoBloco[]): VisaoPorBloco {
  const contagem = Object.fromEntries(ORDEM_BLOCOS_HEMICICLO.map((b) => [b, 0])) as Record<
    BlocoHemiciclo,
    number
  >;
  const porOrigem = Object.fromEntries(ORDEM_BLOCOS_HEMICICLO.map((b) => [b, {}])) as Record<
    BlocoHemiciclo,
    Partial<Record<OrigemCadeira, number>>
  >;
  for (const c of cadeiras) {
    contagem[c.bloco] += 1;
    porOrigem[c.bloco][c.origem] = (porOrigem[c.bloco][c.origem] ?? 0) + 1;
  }
  const ordenadas: CadeiraDoBloco[] = [];
  for (const bloco of ORDEM_BLOCOS_HEMICICLO) {
    for (const origem of ORDEM_ORIGEM) {
      const n = porOrigem[bloco][origem] ?? 0;
      for (let i = 0; i < n; i++) ordenadas.push({ bloco, origem });
    }
  }
  return { total: ordenadas.length, cadeiras: ordenadas, contagem, porOrigem };
}

function blocoDaResolucao(r: Resolucao | undefined): BlocoHemiciclo {
  return r?.estado === "classificado" ? blocoDoHemiciclo(r.etiqueta.valor) : "aguardando";
}

/** O placar de UM limiar, para os dois lados (critério simétrico, § 2 (g)). */
export interface PlacarLimiar {
  id: ReturnType<typeof limiaresDaCasa>[number]["id"];
  k: number;
  base: number;
  oposicao: number;
}

export function placarDosLimiares(v: VisaoPorBloco): PlacarLimiar[] {
  return limiaresDaCasa(v.total).map((l) => ({
    id: l.id,
    k: l.k,
    base: v.contagem.base_governo,
    oposicao: v.contagem.oposicao,
  }));
}

// ---------------------------------------------------------------------------
// Portão do Senado inteiro (V1, V2)
// ---------------------------------------------------------------------------

/** As 27 corridas do Senado como o portão as lê, com o universo de cada UF. */
export function corridasDoSenado(payload: EdgePayload, etiquetas: Etiquetas): CorridaPortao[] {
  const pre = isPreEleicao(payload);
  const vagasUf = payload.composicao_vagas?.vagas_por_uf ?? cargoInfo(5).vagasPorUf ?? null;
  return (payload.por_uf ?? []).map((row) =>
    corridaDeUfRow(row, {
      cargo: 5,
      turno: 1,
      preEleicao: pre,
      vagasUf,
      universo: etiquetas.universo(5, row.sigla),
    }),
  );
}

/**
 * Portão do Senado de 2027 para UMA categoria: os candidatos com chance nas
 * 27 corridas e os 27 que seguem até 2031 (os CÓDIGOS da foto que o desenho
 * usa — não os do arquivo de etiquetas, para as duas listas não divergirem).
 */
export function portaoDoSenado(
  payload: EdgePayload,
  codigos2031: readonly string[],
  etiquetas: Etiquetas,
  cat: CategoriaId,
): ResultadoPortao {
  return juntarPortoes(
    avaliarCorridas(corridasDoSenado(payload, etiquetas), classificadoEm(etiquetas, 5, 1, cat)),
    avaliarSenado2031(
      { disponivel: etiquetas.senado2031.disponivel, codigos: codigos2031 },
      (cod) => classificada(etiquetas.senador2031(cod, 1)[cat]),
    ),
  );
}

// ---------------------------------------------------------------------------
// V1 — Senado de 2027 por bloco
// ---------------------------------------------------------------------------

export interface Senado2027PorBloco extends VisaoPorBloco {
  fase: Senado2027["fase"];
  dataFoto: string;
  vagasEmDisputa: number;
}

/** O Senado de 2027 que a visão por partido já aceitou, ou a razão de não haver. */
function senadoAceito(
  payload: EdgePayload | null,
  mandato: ValidacaoMandato2031,
): { ok: true; senado: Senado2027; codigos: string[] } | { ok: false; detalhe: string } {
  if (!payload || !mandato.ok) return { ok: false, detalhe: "sem payload ou foto inválida" };
  const r = derivarSenado2027(payload, mandato);
  if (!r.ok) return { ok: false, detalhe: `${r.motivo} — ${r.detalhe}` };
  return { ok: true, senado: r.senado, codigos: mandato.mandato.senadores.map((s) => s.codigo) };
}

export function visaoSenado2027PorBloco(
  payload: EdgePayload | null,
  mandato: ValidacaoMandato2031,
  etiquetas: Etiquetas,
): ResultadoVisao<Senado2027PorBloco> {
  const p = portas<Senado2027PorBloco>(etiquetas, "v1", "relacao_governo");
  if (p) return p;
  const aceito = senadoAceito(payload, mandato);
  if (!aceito.ok || !payload || !mandato.ok) {
    return oculta("recusa_senado", [], aceito.ok ? undefined : aceito.detalhe);
  }
  const portao = portaoDoSenado(payload, aceito.codigos, etiquetas, "relacao_governo");
  if (!portao.ok) return oculta("portao", portao.bloqueantes);

  const { senado } = aceito;
  const cadeiras: CadeiraDoBloco[] = [];
  for (const cod of aceito.codigos) {
    cadeiras.push({
      bloco: blocoDaResolucao(etiquetas.senador2031(cod, 1).relacao_governo),
      origem: "continua_2031",
    });
  }
  for (const v of senado.vagas) {
    cadeiras.push({
      bloco: blocoDaResolucao(etiquetas.resolver(v.sqcand, 5, 1).relacao_governo),
      origem: v.estado,
    });
  }
  for (let i = 0; i < senado.contagem.aguardando; i++) {
    cadeiras.push({ bloco: "aguardando", origem: "aguardando" });
  }
  const visao = ordenarPorBloco(cadeiras);
  if (visao.total !== senado.total) {
    return oculta("recusa_senado", [], `${visao.total} cadeiras para ${senado.total}`);
  }
  return {
    ok: true,
    visao: {
      ...visao,
      fase: senado.fase,
      dataFoto: senado.dataFoto,
      vagasEmDisputa: senado.vagasEmDisputa,
    },
  };
}

// ---------------------------------------------------------------------------
// V2 — impeachment de ministros do STF no Senado de 2027
// ---------------------------------------------------------------------------

export type ValorImpeachment = "a_favor" | "contra" | "sem_posicao_publica";
export const ORDEM_IMPEACHMENT: readonly ValorImpeachment[] = [
  "a_favor",
  "sem_posicao_publica",
  "contra",
];

export interface LinhaImpeachment {
  /** `senado:COD`, o `sqcand`, ou `vaga:UF:n` para a vaga ainda sem dono. */
  chave: string;
  uf: string;
  nome: string | null;
  partido: string | null;
  mandato: "continua_2031" | "decidida" | "projetada" | "aguardando";
  /** `null` só na vaga ainda sem dono. */
  etiqueta: EtiquetaResolvida | null;
}

export interface PlacarImpeachment {
  total: number;
  /** Dois terços da casa (CF art. 52, parágrafo único) — do total, nunca literal. */
  limiar: number;
  contagem: Record<ValorImpeachment | "aguardando", number>;
  /** As cadeiras, por UF (alfabética); dentro da UF, quem segue até 2031 primeiro. */
  linhas: LinhaImpeachment[];
  dataFoto: string;
  fase: Senado2027["fase"];
}

export function placarImpeachment(
  payload: EdgePayload | null,
  mandato: ValidacaoMandato2031,
  etiquetas: Etiquetas,
): ResultadoVisao<PlacarImpeachment> {
  const p = portas<PlacarImpeachment>(etiquetas, "v2", "impeachment_stf");
  if (p) return p;
  const aceito = senadoAceito(payload, mandato);
  if (!aceito.ok || !payload || !mandato.ok) {
    return oculta("recusa_senado", [], aceito.ok ? undefined : aceito.detalhe);
  }
  const portao = portaoDoSenado(payload, aceito.codigos, etiquetas, "impeachment_stf");
  if (!portao.ok) return oculta("portao", portao.bloqueantes);

  const { senado } = aceito;
  const porUf = new Map<string, LinhaImpeachment[]>();
  const empilhar = (l: LinhaImpeachment) => {
    const lista = porUf.get(l.uf) ?? [];
    lista.push(l);
    porUf.set(l.uf, lista);
  };
  const etq = (r: Resolucao | undefined) => (r?.estado === "classificado" ? r.etiqueta : null);

  for (const s of mandato.mandato.senadores) {
    empilhar({
      chave: `senado:${s.codigo}`,
      uf: s.uf,
      nome: s.nome_parlamentar,
      partido: s.partido,
      mandato: "continua_2031",
      etiqueta: etq(etiquetas.senador2031(s.codigo, 1).impeachment_stf),
    });
  }
  for (const v of senado.vagas) {
    const sq = normalizarSqcand(v.sqcand);
    empilhar({
      chave: sq ?? `vaga:${v.uf}:${v.id}`,
      uf: v.uf,
      nome: v.nome ? nomeExibicao(v.nome, sq) : null,
      partido: v.sigla,
      mandato: v.estado,
      etiqueta: etq(etiquetas.resolver(sq, 5, 1).impeachment_stf),
    });
  }
  // Vagas sem dono: por UF, quantas faltam para as vagas da UF.
  const vagasUf = payload.composicao_vagas?.vagas_por_uf ?? cargoInfo(5).vagasPorUf ?? 0;
  const ufs = [...new Set(mandato.mandato.senadores.map((s) => s.uf))].sort();
  for (const uf of ufs) {
    const ocupadas = (porUf.get(uf) ?? []).filter((l) => l.mandato !== "continua_2031").length;
    for (let i = ocupadas; i < vagasUf; i++) {
      empilhar({
        chave: `vaga:${uf}:${i + 1}`,
        uf,
        nome: null,
        partido: null,
        mandato: "aguardando",
        etiqueta: null,
      });
    }
  }

  const linhas = ufs.flatMap((uf) => porUf.get(uf) ?? []);
  const contagem: PlacarImpeachment["contagem"] = {
    a_favor: 0,
    contra: 0,
    sem_posicao_publica: 0,
    aguardando: 0,
  };
  for (const l of linhas) {
    const v = l.etiqueta?.valor;
    if (v === "a_favor" || v === "contra" || v === "sem_posicao_publica") contagem[v] += 1;
    else contagem.aguardando += 1;
  }
  const limiar = limiaresDaCasa(linhas.length).find((x) => x.id === "dois_tercos")?.k ?? 0;
  if (linhas.length !== senado.total) {
    return oculta("recusa_senado", [], `${linhas.length} linhas para ${senado.total} cadeiras`);
  }
  return {
    ok: true,
    visao: {
      total: linhas.length,
      limiar,
      contagem,
      linhas,
      dataFoto: senado.dataFoto,
      fase: senado.fase,
    },
  };
}

// ---------------------------------------------------------------------------
// Câmara 2027 por bloco
// ---------------------------------------------------------------------------

/** Como uma agremiação da bancada se classifica, e por quê. */
export interface AgremiacaoPorBloco {
  cod: string;
  sigla: string;
  tipo: "partido" | "federacao";
  cadeiras: number;
  bloco: BlocoHemiciclo;
  etiqueta: EtiquetaResolvida | null;
}

/**
 * A relação com o governo de UMA agremiação da Câmara, pelo padrão editorial:
 *
 *   - partido isolado → o padrão do partido, caindo no da federação que o
 *     cadastro do TSE registra para ele (`padraoDoPartido`);
 *   - federação → o padrão da FEDERAÇÃO. O payload a nomeia pelo apelido do
 *     EA20 ("FE BRASIL"); o padrão é chaveado pela federação do cadastro
 *     ("PT/PC DO B/PV"). A ponte são os partidos-membro: todos têm de apontar
 *     para a MESMA federação no cadastro; senão, `a_classificar` (o portão
 *     bloqueia — melhor que casar a federação errada).
 */
export function relacaoDaAgremiacao(
  a: Pick<EdgeAgremiacaoBancada, "sigla" | "tipo" | "componentes">,
  etiquetas: Etiquetas,
): Resolucao {
  if (a.tipo === "partido") return etiquetas.padraoDoPartido(a.sigla, 1).relacao_governo;
  const feds = new Set(a.componentes.map((p) => etiquetas.federacaoDoPartido(p)));
  if (feds.size !== 1) return { estado: "a_classificar" };
  const [fed] = [...feds];
  if (!fed) return { estado: "a_classificar" };
  return etiquetas.padraoDaAgremiacao(fed, "federacao", 1).relacao_governo;
}

export interface Camara2027PorBloco extends VisaoPorBloco {
  /** Cadeiras que a apuração ainda não atribuiu a ninguém. */
  semDono: number;
  /** Na ordem do payload — nunca reordenada pela etiqueta. */
  agremiacoes: AgremiacaoPorBloco[];
}

export function visaoCamara2027(
  bancada: EdgeBancadaNacional | null | undefined,
  etiquetas: Etiquetas,
): ResultadoVisao<Camara2027PorBloco> {
  const p = portas<Camara2027PorBloco>(etiquetas, "camara2027", "relacao_governo");
  if (p) return p;
  if (!bancada || !(bancada.total_cadeiras > 0)) return oculta("sem_dados");

  const agremiacoes: AgremiacaoPorBloco[] = bancada.por_agremiacao.map((a) => {
    const r = relacaoDaAgremiacao(a, etiquetas);
    return {
      cod: a.cod,
      sigla: a.sigla,
      tipo: a.tipo,
      cadeiras: Math.max(0, Math.trunc(a.cadeiras)),
      bloco: blocoDaResolucao(r),
      etiqueta: r.estado === "classificado" ? r.etiqueta : null,
    };
  });
  const porCod = new Map(agremiacoes.map((a) => [`${a.tipo}:${a.sigla}`, a] as const));
  const portao = avaliarCamara2027(agremiacoes, (sigla, tipo) =>
    Boolean(porCod.get(`${tipo}:${sigla}`)?.etiqueta),
  );
  if (!portao.ok) return oculta("portao", portao.bloqueantes);

  const atribuidas = agremiacoes.reduce((s, a) => s + a.cadeiras, 0);
  if (atribuidas > bancada.total_cadeiras) {
    return oculta("sem_dados", [], `${atribuidas} cadeiras para ${bancada.total_cadeiras}`);
  }
  const cadeiras: CadeiraDoBloco[] = [];
  for (const a of agremiacoes) {
    for (let i = 0; i < a.cadeiras; i++) cadeiras.push({ bloco: a.bloco, origem: "atribuida" });
  }
  const semDono = bancada.total_cadeiras - atribuidas;
  for (let i = 0; i < semDono; i++) cadeiras.push({ bloco: "aguardando", origem: "aguardando" });
  return { ok: true, visao: { ...ordenarPorBloco(cadeiras), semDono, agremiacoes } };
}

// ---------------------------------------------------------------------------
// V4 — renovação do Senado
// ---------------------------------------------------------------------------

export interface EleitoRenovacao {
  sqcand: string;
  nome: string;
  partido: string | null;
  /** O valor de `trajetoria_cargo` — classificado, pelo portão. */
  trajetoria: string;
}

export interface DerrotadoRenovacao {
  sqcand: string;
  /** `null` quando a candidatura ficou fora dos que o payload publica pelo nome. */
  nome: string | null;
  partido: string | null;
}

export interface RenovacaoUf {
  uf: string;
  vagas: number;
  eleitos: EleitoRenovacao[];
  /** Vagas cuja PESSOA mudou: eleito que não tentava a reeleição. */
  mudaramDeMaos: number;
  /** Vagas cujo PARTIDO mudou, contra a foto dos 54 de hoje. `null` sem a foto. */
  trocaDePartido: number | null;
  /** Quem tentava a reeleição e não ficou com vaga. */
  derrotados: DerrotadoRenovacao[];
}

export interface Renovacao {
  ufs: RenovacaoUf[];
  vagas: number;
  mudaramDeMaos: number;
  trocaDePartido: number | null;
  derrotados: number;
}

/**
 * A renovação das vagas do Senado, SÓ nas UFs com a apuração concluída
 * (`pct_apurado` ≥ 100 — a mesma régua de "decidida" da spec 023). O número
 * principal é a PESSOA (decisão do dono, 29/09): quantas vagas foram para quem
 * não as ocupava. A troca de partido é o número secundário.
 *
 * Portão: em cada UF concluída, a corrida INTEIRA classificada em trajetória
 * (`avaliarUniverso`) — "quem tentou a reeleição e perdeu" só é lista completa
 * sem ninguém `a_classificar`.
 */
export function visaoRenovacaoSenado(
  payload: EdgePayload | null,
  mandato2027: ValidacaoFotoSenado,
  etiquetas: Etiquetas,
): ResultadoVisao<Renovacao> {
  const p = portas<Renovacao>(etiquetas, "v4", "trajetoria_cargo");
  if (p) return p;
  if (!payload || isPreEleicao(payload)) return oculta("sem_dados");
  const vagasUf = payload.composicao_vagas?.vagas_por_uf ?? cargoInfo(5).vagasPorUf ?? 0;
  const concluidas = (payload.por_uf ?? [])
    .filter((r) => r.pct_apurado >= PCT_UF_CONCLUIDA)
    .sort((a, b) => (a.sigla < b.sigla ? -1 : a.sigla > b.sigla ? 1 : 0));
  if (concluidas.length === 0 || vagasUf <= 0) return oculta("sem_dados");

  const classificado = classificadoEm(etiquetas, 5, 1, "trajetoria_cargo");
  const portao = juntarPortoes(
    ...concluidas.map((row) => {
      const vencedores = queCompetem(row.top_candidatos ?? []).slice(0, vagasUf);
      const semSq = vencedores
        .filter((c) => !normalizarSqcand(c.sqcand))
        .map((c) => ({
          corrida: row.sigla,
          chave: null,
          id: c.id,
          nome: c.nome ?? null,
          motivo: "sem_sqcand" as const,
        }));
      const u = avaliarUniverso(row.sigla, etiquetas.universo(5, row.sigla), classificado);
      return { ok: u.ok && semSq.length === 0, bloqueantes: [...semSq, ...u.bloqueantes] };
    }),
  );
  if (!portao.ok) return oculta("portao", portao.bloqueantes);

  const trajetoria = (sq: string) => {
    const r = etiquetas.resolver(sq, 5, 1).trajetoria_cargo;
    return r.estado === "classificado" ? r.etiqueta.valor : null;
  };
  const holders = mandato2027.ok ? mandato2027.mandato.senadores : null;

  const ufs: RenovacaoUf[] = concluidas.map((row) => {
    const top = row.top_candidatos ?? [];
    const vencedores = queCompetem(top).slice(0, vagasUf);
    const eleitos: EleitoRenovacao[] = vencedores.map((c) => {
      const sq = normalizarSqcand(c.sqcand) as string;
      return {
        sqcand: sq,
        nome: nomeExibicao(c.nome ?? `Cand ${c.id}`, sq),
        partido: c.partido ?? null,
        trajetoria: trajetoria(sq) as string,
      };
    });
    const doTop = new Map(top.map((c) => [normalizarSqcand(c.sqcand), c] as const));
    const eleitosSq = new Set(eleitos.map((e) => e.sqcand));
    const derrotados: DerrotadoRenovacao[] = etiquetas
      .universo(5, row.sigla)
      .filter((sq) => !eleitosSq.has(sq) && trajetoria(sq) === "tenta_reeleicao")
      .map((sq) => {
        const c = doTop.get(sq);
        return {
          sqcand: sq,
          nome: c?.nome ? nomeExibicao(c.nome, sq) : null,
          partido: c?.partido ?? null,
        };
      });

    let trocaDePartido: number | null = null;
    if (holders) {
      const antes = new Map<string, number>();
      for (const h of holders.filter((s) => s.uf === row.sigla)) {
        const k = chavePartido(h.partido);
        antes.set(k, (antes.get(k) ?? 0) + 1);
      }
      let mantidas = 0;
      for (const e of eleitos) {
        const k = chavePartido(e.partido ?? "");
        const n = antes.get(k) ?? 0;
        if (n > 0) {
          mantidas++;
          antes.set(k, n - 1);
        }
      }
      trocaDePartido = eleitos.length - mantidas;
    }
    return {
      uf: row.sigla,
      vagas: eleitos.length,
      eleitos,
      mudaramDeMaos: eleitos.filter((e) => e.trajetoria !== "tenta_reeleicao").length,
      trocaDePartido,
      derrotados,
    };
  });

  return {
    ok: true,
    visao: {
      ufs,
      vagas: ufs.reduce((s, u) => s + u.vagas, 0),
      mudaramDeMaos: ufs.reduce((s, u) => s + u.mudaramDeMaos, 0),
      trocaDePartido: holders ? ufs.reduce((s, u) => s + (u.trocaDePartido ?? 0), 0) : null,
      derrotados: ufs.reduce((s, u) => s + u.derrotados.length, 0),
    },
  };
}
