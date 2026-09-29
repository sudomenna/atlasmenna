// data-pipeline/trajetoria-camara-calculo.ts
//
// O caminho ÚNICO que calcula a trajetória na Câmara (spec 018, RF-214,
// ADR-0058) a partir dos arquivos locais — usado pela exportação offline
// (`trajetoria-exportar.ts`) e pela paridade (`trajetoria-camara-paridade.ts`),
// para que as duas não possam divergir: o arquivo exportado é exatamente o que
// a paridade conferiu.
//
// Lê só o CACHE do TSE (`build/tse-archives/…_BRASIL.csv`), nunca baixa — o CDN
// do TSE devolve 403 desde setembro e um download parcial aqui seria pior que
// um erro. A Câmara vem de `trajetoria-camara-fonte.ts`, **só do cache** salvo
// pedido explícito de `camaraRefresh`.
//
// Não toca banco: nenhuma função daqui abre conexão (o `_tse-common.ts` é
// importado só pelo leitor de CSV). Não loga nome civil, data de nascimento
// nem nome social.
//
// ─── O ÚNICO ponto que lê `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO` ───────────
//
// É `trajetoriaDaLinha`, abaixo. A exceção de PII do ADR-0039 aberta pelo
// ADR-0058 é estrita: os dois valores existem só como argumento de
// `calcularTrajetoria` e morrem ali. **Não** entram em `CandidatoRow` (o
// import não os lê — `candidatos-parse.ts` e `candidatos-import.ts` ficam
// exatamente como estão em produção, ADR-0058 item 5), não são persistidos,
// não são logados, não aparecem no arquivo exportado. Um teste de fio
// (`tests/unit/data-pipeline/trajetoria-camara-calculo.test.ts`) reprova
// qualquer outro arquivo de código que passe a ler essas colunas.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CACHE_DIR, iterCsv, readCsvHeader } from "./_tse-common.ts";
import { type CandidatoRow, campo, opcional, unirCandidaturas } from "./candidatos-parse.ts";
import {
  CARGO_TRAJETORIA,
  calcularTrajetoria,
  type IndiceCamara,
  isoDeDataTse,
  type Trajetoria,
} from "./trajetoria-camara.ts";
import { carregarFonteCamara, type FonteCamara } from "./trajetoria-camara-fonte.ts";

/**
 * Trajetória na Câmara de uma linha do arquivo principal do TSE (RF-214).
 *
 * **O único ponto do projeto que lê `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO`.**
 * Os dois valores existem só como argumento da chamada abaixo e não são
 * devolvidos, guardados nem logados — ver o cabeçalho deste arquivo.
 */
export function trajetoriaDaLinha(
  campos: readonly string[],
  header: Map<string, number>,
  indice: IndiceCamara,
): Trajetoria {
  return calcularTrajetoria(
    {
      nomeCivil: campo(campos, header, "NM_CANDIDATO"),
      nomeUrna: campo(campos, header, "NM_URNA_CANDIDATO"),
      nomeSocial: opcional(campo(campos, header, "NM_SOCIAL_CANDIDATO")),
      nascimento: isoDeDataTse(campo(campos, header, "DT_NASCIMENTO")),
    },
    indice,
  );
}

export interface ResultadoTrajetorias {
  /**
   * O universo: os `SQ_CANDIDATO` de cargo 6, na ordem do arquivo, sem
   * repetição — o MESMO recorte que o import faz (`unirCandidaturas` com
   * `cargo: 6`), inclusive as não publicáveis.
   */
  universo: string[];
  /** Trajetória por `SQ_CANDIDATO`; tem exatamente as chaves de `universo`. */
  porSq: Map<string, Trajetoria>;
  /**
   * A linha unida de cada candidatura do universo (primeira ocorrência).
   * Serve à paridade (UF e nome de urna na listagem de divergências); a
   * exportação NÃO a usa — o arquivo exportado não carrega nome.
   */
  candidaturas: Map<string, CandidatoRow>;
  /** Linhas de cargo 6 repetidas por `SQ_CANDIDATO` (vale a primeira). */
  duplicadas: number;
  /** `DT_GERACAO HH_GERACAO` do arquivo principal. */
  geracaoDeclarada: string | null;
}

/**
 * Cálculo puro sobre as linhas já lidas dos dois CSVs do TSE.
 *
 * O universo sai de `unirCandidaturas` — o join 1:1 com o complementar é
 * premissa do RF-140 e estoura aqui também, em vez de uma candidatura sumir do
 * arquivo exportado e um consumidor inferir "estreante" pela ausência.
 */
export function calcularTrajetorias(
  principais: readonly (readonly string[])[],
  headerPrincipal: Map<string, number>,
  complementares: readonly (readonly string[])[],
  headerComplementar: Map<string, number>,
  indice: IndiceCamara,
): ResultadoTrajetorias {
  const uniao = unirCandidaturas(principais, headerPrincipal, complementares, headerComplementar, {
    cargo: CARGO_TRAJETORIA,
  });

  const candidaturas = new Map<string, CandidatoRow>();
  let duplicadas = 0;
  for (const l of uniao.linhas) {
    if (candidaturas.has(l.sq_candidato)) {
      duplicadas++;
      continue;
    }
    candidaturas.set(l.sq_candidato, l);
  }

  const porSq = new Map<string, Trajetoria>();
  for (const campos of principais) {
    if (Number(campo(campos, headerPrincipal, "CD_CARGO")) !== CARGO_TRAJETORIA) continue;
    const sq = campo(campos, headerPrincipal, "SQ_CANDIDATO");
    if (!porSq.has(sq)) porSq.set(sq, trajetoriaDaLinha(campos, headerPrincipal, indice));
  }

  // As duas varreduras recortam o mesmo arquivo pelo mesmo cargo; se
  // divergirem, algo mudou em `unirCandidaturas` e o arquivo exportado deixaria
  // de cobrir o universo do import.
  const universo = [...candidaturas.keys()];
  if (porSq.size !== universo.length || universo.some((sq) => !porSq.has(sq))) {
    throw new Error(
      `universo divergente: ${universo.length} candidaturas unidas × ${porSq.size} trajetórias`,
    );
  }

  return {
    universo,
    porSq,
    candidaturas,
    duplicadas,
    geracaoDeclarada: uniao.geracaoDeclarada,
  };
}

export interface OpcoesCalculo {
  tseDir?: string;
  camaraDir?: string;
  /** Baixa a Câmara de novo. Sem isto, o cálculo é SÓ CACHE — nunca rede. */
  camaraRefresh?: boolean;
  log?: (msg: string) => void;
}

export interface CalculoTrajetoria extends ResultadoTrajetorias {
  camara: FonteCamara;
  arquivoPrincipal: string;
}

async function lerTodas(path: string): Promise<string[][]> {
  const out: string[][] = [];
  for await (const c of iterCsv(path)) out.push(c);
  return out;
}

/** Caminhos dos dois arquivos nacionais do cadastro no cache do TSE. */
export function arquivosTse(tseDir: string): { principal: string; complementar: string } {
  return {
    principal: resolve(tseDir, "consulta_cand_2026/consulta_cand_2026_BRASIL.csv"),
    complementar: resolve(
      tseDir,
      "consulta_cand_complementar_2026/consulta_cand_complementar_2026_BRASIL.csv",
    ),
  };
}

export async function calcularTrajetoriasDoCache(
  opts: OpcoesCalculo = {},
): Promise<CalculoTrajetoria> {
  const { principal, complementar } = arquivosTse(opts.tseDir ?? CACHE_DIR);
  for (const f of [principal, complementar]) {
    if (!existsSync(f)) throw new Error(`cache do TSE ausente: ${f}`);
  }
  const [hP, hC, pLinhas, cLinhas] = await Promise.all([
    readCsvHeader(principal),
    readCsvHeader(complementar),
    lerTodas(principal),
    lerTodas(complementar),
  ]);

  const refresh = opts.camaraRefresh ?? false;
  const camara = await carregarFonteCamara({
    dir: opts.camaraDir,
    refresh,
    somenteCache: !refresh,
    log: opts.log,
  });

  return {
    ...calcularTrajetorias(pLinhas, hP, cLinhas, hC, camara.indice),
    camara,
    arquivoPrincipal: principal,
  };
}
