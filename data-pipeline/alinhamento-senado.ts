// data-pipeline/alinhamento-senado.ts
//
// **Alinhamento dos senadores à orientação do Governo** nas votações nominais
// abertas do plenário do Senado — a versão para o Senado do método do projeto
// externo `alinhamento-governo-camara` (`calcular.py`, `LEIAME.md`), aplicado
// aos dados do Senado Federal — Dados Abertos. Puro: nem rede, nem disco. O
// I/O vive em `senado-fonte.ts` (cliente) e `alinhamento-senado-cli.ts`.
//
// ─── O método (espelha a Câmara; as diferenças estão marcadas) ──────────────
//
// **Universo** — votação do plenário do Senado (`casaSessao = SF`), **nominal
// aberta** (`votacaoSecreta = N`; na secreta a lista traz só "Votou" e não há
// como alinhar nada) e com a bancada **"Governo"** orientando **SIM** ou
// **NÃO**. Ficam fora: orientação LIVRE ou ausente e votação sem
// `sequencialVotacao` (a chave que liga a votação à orientação; contadas em
// `universo.excluidas_sem_sequencial`, nunca caladas).
//
// **Disputada** — a bancada "Oposição" orientou o contrário do Governo, ou
// orientou OBSTRUÇÃO (o Senado tem essa orientação: 5 ocorrências no
// período; ela existe, então vale como na Câmara). Oposição LIVRE ou sem
// orientação → **não** disputada.
//
// **Taxa** — para cada senador (`codigoParlamentar`), só nas votações
// disputadas:
//
//     taxa_disputadas = votos iguais à orientação do Governo
//                       ÷ (Sim + Não + Abstenção [+ Obstrução, se o Senado a registrar])
//
// A **abstenção conta contra** (entra no denominador e nunca no numerador),
// como a obstrução na Câmara. **Não entram** em nenhum dos dois lados:
//
//   - `Presidente (art. 51 RISF)` — o presidente da sessão não vota;
//   - as ausências: `AP` (atividade parlamentar), `MIS` (missão), `LS`
//     (licença saúde), `LP` (licença particular), `NCom` (não compareceu),
//     `NA` (dispositivo não citado);
//   - **`P-NRV` (presente, não registrou voto)** — decisão de método,
//     DIFERENTE da obstrução da Câmara: no Senado ela não se distingue de quem
//     simplesmente esqueceu de votar, e tratá-la como voto contrário puniria a
//     distração. O relatório da CLI mede o que mudaria se contasse contra.
//
// `votos_disputadas` é o denominador (quantos votos contaram), a base da
// regra de amostra mínima do ADR-0059.
//
// ─── Arredondamento ─────────────────────────────────────────────────────────
//
// 1 casa decimal, **meio para cima**, em aritmética de inteiros
// (`round(1000·a/b)/10`) — a regra dos limiares (≥ 65, ≤ 35) lê o número
// publicado, então o arredondamento faz parte do método.
//
// ─── O que sai ──────────────────────────────────────────────────────────────
//
// Só o código do parlamentar, o denominador e a taxa. Nome, partido, data de
// nascimento e qualquer coisa que identifique a pessoa além do código público
// **não entram** no arquivo (ADR-0062 item 2, constituição § 5).

import type { OrientacaoLideranca, VotacaoComOrientacao, VotacaoNominal } from "./senado-parse.ts";

export const FONTE_ALINHAMENTO_SENADO = {
  descricao:
    "Senado Federal — Dados Abertos (votações nominais do plenário com orientação do Governo)",
  url: "https://legis.senado.leg.br/dadosabertos/",
} as const;

/** Início da 57ª legislatura — o mesmo recorte do projeto da Câmara. */
export const INICIO_LEGISLATURA_57 = "2023-02-01";

/** Casa do plenário do Senado em `casaSessao` (a outra é `CN`, sessão do Congresso). */
export const CASA_SENADO = "SF";

export type Orientacao = "SIM" | "NAO" | "LIVRE" | "OBSTRUCAO" | "OUTRA" | "AUSENTE";
export type Bancada = "governo" | "oposicao";
type VotoContado = "SIM" | "NAO" | "ABSTENCAO" | "OBSTRUCAO";

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/** Maiúsculas, sem acento, sem espaços nas pontas: `"Oposição "` → `"OPOSICAO"`. */
export function chaveTexto(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

/** A orientação de uma bancada, como o Senado a escreve, em forma canônica. */
export function orientacaoNormalizada(voto: string | null | undefined): Orientacao {
  const k = chaveTexto(voto);
  if (k === "") return "AUSENTE";
  if (k === "SIM") return "SIM";
  if (k === "NAO") return "NAO";
  if (k === "LIVRE") return "LIVRE";
  if (k === "OBSTRUCAO") return "OBSTRUCAO";
  return "OUTRA";
}

/**
 * A orientação da bancada `Governo` ou `Oposição` numa votação. Sem entrada da
 * bancada → `AUSENTE`. **Duas entradas com orientações diferentes lançam**:
 * escolher uma seria arbitrário e mudaria o universo em silêncio.
 */
export function orientacaoDaBancada(
  orientacoes: readonly OrientacaoLideranca[],
  bancada: Bancada,
): Orientacao {
  const alvo = bancada === "governo" ? "GOVERNO" : "OPOSICAO";
  const achadas = orientacoes
    .filter((o) => chaveTexto(o.partido) === alvo)
    .map((o) => orientacaoNormalizada(o.voto));
  if (achadas.length === 0) return "AUSENTE";
  const primeira = achadas[0] as Orientacao;
  if (achadas.some((a) => a !== primeira)) {
    throw new Error(`orientações conflitantes da bancada ${bancada} na mesma votação`);
  }
  return primeira;
}

export interface ClassificacaoVotacao {
  governo: Orientacao;
  oposicao: Orientacao;
  /** Governo orientou SIM ou NÃO. */
  noUniverso: boolean;
  /** No universo e a Oposição orientou o contrário (ou obstrução). */
  disputada: boolean;
}

export function classificarVotacao(
  orientacoes: readonly OrientacaoLideranca[],
): ClassificacaoVotacao {
  const governo = orientacaoDaBancada(orientacoes, "governo");
  const oposicao = orientacaoDaBancada(orientacoes, "oposicao");
  const noUniverso = governo === "SIM" || governo === "NAO";
  const contrario = (oposicao === "SIM" || oposicao === "NAO") && oposicao !== governo;
  return {
    governo,
    oposicao,
    noUniverso,
    disputada: noUniverso && (contrario || oposicao === "OBSTRUCAO"),
  };
}

/**
 * O voto individual que entra na conta, ou `null` quando não entra (ausência,
 * presidente da sessão, `P-NRV`, voto secreto). `extras` é a lista de siglas
 * adicionais que passam a contar **contra** — só o relatório de sensibilidade
 * usa; o arquivo publicado é sempre gerado com a lista vazia.
 */
export function votoContado(
  sigla: string | null | undefined,
  extras: readonly string[] = [],
): VotoContado | "EXTRA" | null {
  const k = chaveTexto(sigla);
  if (k === "SIM") return "SIM";
  if (k === "NAO") return "NAO";
  if (k === "ABSTENCAO") return "ABSTENCAO";
  if (k === "OBSTRUCAO") return "OBSTRUCAO";
  if (extras.some((e) => chaveTexto(e) === k)) return "EXTRA";
  return null;
}

/** `round(1000·a/b)/10` — 1 casa, meio para cima, sem passar por ponto flutuante em `a/b·100`. */
export function taxaComUmaCasa(alinhados: number, contados: number): number {
  if (contados <= 0) throw new Error("taxa sem denominador");
  return Math.round((1000 * alinhados) / contados) / 10;
}

// ---------------------------------------------------------------------------
// Janelas de consulta
// ---------------------------------------------------------------------------

/**
 * Divide `[inicio, fim]` em janelas de semestre civil (jan–jun, jul–dez), a
 * última cortada em `fim`. O `/votacao` aceita até 1 ano por chamada; o
 * semestre mantém cada resposta abaixo de ~1 MB e, sendo fixo, deixa a janela
 * encerrada em cache para sempre.
 */
export function janelasSemestrais(
  inicio: string,
  fim: string,
): Array<{ inicio: string; fim: string }> {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  if (!re.test(inicio) || !re.test(fim)) throw new Error("datas devem ser AAAA-MM-DD");
  if (inicio > fim) throw new Error(`início ${inicio} depois do fim ${fim}`);
  const out: Array<{ inicio: string; fim: string }> = [];
  let ini = inicio;
  while (ini <= fim) {
    const ano = Number(ini.slice(0, 4));
    const mes = Number(ini.slice(5, 7));
    const fimSemestre = mes <= 6 ? `${ano}-06-30` : `${ano}-12-31`;
    const fimJanela = fimSemestre < fim ? fimSemestre : fim;
    out.push({ inicio: ini, fim: fimJanela });
    if (fimJanela === fim) break;
    ini = fimSemestre.endsWith("-06-30") ? `${ano}-07-01` : `${ano + 1}-01-01`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface OpcoesAlinhamento {
  /** `dataSessao` mínima (inclusive). */
  inicio: string;
  /** `dataSessao` máxima (inclusive). */
  fim: string;
  /** Siglas de voto (ex.: `P-NRV`) que passam a contar contra. Só sensibilidade. */
  contarContra?: readonly string[];
}

export interface DiagnosticoAlinhamento {
  votacoes_na_janela: number;
  secretas: number;
  fora_do_plenario_do_senado: number;
  abertas_nominais: number;
  sem_sequencial: number;
  sem_orientacao_do_governo: number;
  governo_livre: number;
  governo_outra: number;
  no_universo: number;
  disputadas: number;
  votos_repetidos_no_mesmo_registro: number;
  senadores_no_universo: number;
  senadores_com_voto_em_disputada: number;
}

export interface LinhaSenador {
  codigo: number;
  /** Votos que contaram nas disputadas (o denominador). */
  votosDisputadas: number;
  alinhadasDisputadas: number;
  /** 0–100, 1 casa. */
  taxaDisputadas: number;
}

export interface AgregadoPartido {
  partido: string;
  votosDisputadas: number;
  alinhadasDisputadas: number;
}

export interface ResultadoAlinhamento {
  /** `dataSessao` da última votação do universo; `null` se o universo é vazio. */
  corte: string | null;
  universo: { votacoes: number; disputadas: number; excluidas_sem_sequencial: number };
  diagnostico: DiagnosticoAlinhamento;
  /** Só senadores com ≥ 1 voto contado em votação disputada, por código crescente. */
  senadores: LinhaSenador[];
  /** Partido **da época do voto**, só nas disputadas — para o relatório, não vai ao arquivo. */
  porPartido: AgregadoPartido[];
}

/**
 * Índice `sequencialVotacao → orientações`. Sem sequencial não há como juntar,
 * e a entrada é ignorada. **Mesmo sequencial com orientações diferentes lança.**
 */
export function indexarOrientacoes(
  votacoes: readonly VotacaoComOrientacao[],
): Map<number, readonly OrientacaoLideranca[]> {
  const idx = new Map<number, readonly OrientacaoLideranca[]>();
  for (const v of votacoes) {
    if (v.sequencialVotacao == null) continue;
    const anterior = idx.get(v.sequencialVotacao);
    if (anterior && JSON.stringify(anterior) !== JSON.stringify(v.orientacoesLideranca)) {
      throw new Error(`sequencialVotacao ${v.sequencialVotacao} com orientações diferentes`);
    }
    idx.set(v.sequencialVotacao, v.orientacoesLideranca);
  }
  return idx;
}

export function calcularAlinhamento(
  votacoes: readonly VotacaoNominal[],
  orientacoes: ReadonlyMap<number, readonly OrientacaoLideranca[]>,
  opcoes: OpcoesAlinhamento,
): ResultadoAlinhamento {
  const extras = opcoes.contarContra ?? [];
  const diag: DiagnosticoAlinhamento = {
    votacoes_na_janela: 0,
    secretas: 0,
    fora_do_plenario_do_senado: 0,
    abertas_nominais: 0,
    sem_sequencial: 0,
    sem_orientacao_do_governo: 0,
    governo_livre: 0,
    governo_outra: 0,
    no_universo: 0,
    disputadas: 0,
    votos_repetidos_no_mesmo_registro: 0,
    senadores_no_universo: 0,
    senadores_com_voto_em_disputada: 0,
  };
  const porSenador = new Map<number, { contados: number; alinhados: number }>();
  const noUniverso = new Set<number>();
  const porPartido = new Map<string, { contados: number; alinhados: number }>();
  const vistas = new Set<string>();
  let corte: string | null = null;

  for (const v of votacoes) {
    if (v.dataSessao < opcoes.inicio || v.dataSessao > opcoes.fim) continue;
    // Uma votação aparece uma vez só, mesmo que duas janelas em cache a tragam.
    // Só se deduplica por chave que identifica UMA votação: sem `codigoSessaoVotacao`
    // nem `sequencialVotacao`, duas votações do mesmo dia e da mesma matéria
    // (dispositivos diferentes) seriam confundidas — e seguem contadas as duas.
    const id =
      v.codigoSessaoVotacao != null
        ? `c${v.codigoSessaoVotacao}`
        : v.sequencialVotacao != null
          ? `s${v.sequencialVotacao}`
          : null;
    if (id !== null) {
      if (vistas.has(id)) continue;
      vistas.add(id);
    }
    diag.votacoes_na_janela++;

    if (v.votacaoSecreta === "S") {
      diag.secretas++;
      continue;
    }
    if (v.casaSessao !== CASA_SENADO) {
      diag.fora_do_plenario_do_senado++;
      continue;
    }
    diag.abertas_nominais++;
    if (v.sequencialVotacao == null) {
      diag.sem_sequencial++;
      continue;
    }
    const orient = orientacoes.get(v.sequencialVotacao);
    const cl = orient ? classificarVotacao(orient) : null;
    if (!cl || cl.governo === "AUSENTE") {
      diag.sem_orientacao_do_governo++;
      continue;
    }
    if (!cl.noUniverso) {
      if (cl.governo === "LIVRE") diag.governo_livre++;
      else diag.governo_outra++;
      continue;
    }

    diag.no_universo++;
    if (corte === null || v.dataSessao > corte) corte = v.dataSessao;
    if (cl.disputada) diag.disputadas++;

    const naVotacao = new Set<number>();
    for (const voto of v.votos) {
      if (naVotacao.has(voto.codigoParlamentar)) {
        diag.votos_repetidos_no_mesmo_registro++;
        continue;
      }
      naVotacao.add(voto.codigoParlamentar);
      noUniverso.add(voto.codigoParlamentar);
      if (!cl.disputada) continue;
      const contado = votoContado(voto.siglaVotoParlamentar, extras);
      if (contado === null) continue;

      // Só SIM/NAO iguais à orientação do Governo alinham. Abstenção, obstrução
      // e as siglas extras entram no denominador e nunca no numerador.
      const alinhado = contado === cl.governo ? 1 : 0;
      const s = porSenador.get(voto.codigoParlamentar) ?? { contados: 0, alinhados: 0 };
      s.contados++;
      s.alinhados += alinhado;
      porSenador.set(voto.codigoParlamentar, s);

      const sigla = (voto.siglaPartidoParlamentar ?? "").trim() || "(sem partido)";
      const p = porPartido.get(sigla) ?? { contados: 0, alinhados: 0 };
      p.contados++;
      p.alinhados += alinhado;
      porPartido.set(sigla, p);
    }
  }

  diag.senadores_no_universo = noUniverso.size;
  diag.senadores_com_voto_em_disputada = porSenador.size;

  const senadores: LinhaSenador[] = [...porSenador.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([codigo, s]) => ({
      codigo,
      votosDisputadas: s.contados,
      alinhadasDisputadas: s.alinhados,
      taxaDisputadas: taxaComUmaCasa(s.alinhados, s.contados),
    }));

  return {
    corte,
    universo: {
      votacoes: diag.no_universo,
      disputadas: diag.disputadas,
      excluidas_sem_sequencial: diag.sem_sequencial,
    },
    diagnostico: diag,
    senadores,
    porPartido: [...porPartido.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([partido, p]) => ({
        partido,
        votosDisputadas: p.contados,
        alinhadasDisputadas: p.alinhados,
      })),
  };
}

// ---------------------------------------------------------------------------
// Arquivo derivado
// ---------------------------------------------------------------------------

export interface ArquivoAlinhamentoSenado {
  corte: string;
  fonte: { descricao: string; url: string };
  universo: { votacoes: number; disputadas: number; excluidas_sem_sequencial: number };
  por_senador: Record<string, { votos_disputadas: number; taxa_disputadas: number }>;
}

/**
 * `editorial/derivados/alinhamento-senado.json`. **Lista branca por
 * construção**: o objeto é montado campo a campo, então nada que não esteja
 * aqui pode vazar para o arquivo — nome, partido e nascimento nem existem no
 * `ResultadoAlinhamento`, mas a garantia é esta, não aquela.
 */
export function montarArquivoAlinhamento(r: ResultadoAlinhamento): ArquivoAlinhamentoSenado {
  if (r.corte === null) {
    throw new Error(
      "universo vazio: nenhuma votação com orientação do Governo (SIM/NÃO) na janela",
    );
  }
  const por_senador: ArquivoAlinhamentoSenado["por_senador"] = {};
  for (const s of r.senadores) {
    por_senador[String(s.codigo)] = {
      votos_disputadas: s.votosDisputadas,
      taxa_disputadas: s.taxaDisputadas,
    };
  }
  return {
    corte: r.corte,
    fonte: { ...FONTE_ALINHAMENTO_SENADO },
    universo: {
      votacoes: r.universo.votacoes,
      disputadas: r.universo.disputadas,
      excluidas_sem_sequencial: r.universo.excluidas_sem_sequencial,
    },
    por_senador,
  };
}
