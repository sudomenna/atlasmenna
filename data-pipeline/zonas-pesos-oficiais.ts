// data-pipeline/zonas-pesos-oficiais.ts
//
// Modo `--pesos-oficiais` de `zonas-faltantes-import.ts`: o peso de cada par
// (município × zona) em `eleitorado` (ano=2026) vem do ARQUIVO OFICIAL de eleitorado
// do TSE (dataset "Eleitorado - 2026", `perfil_eleitorado_2026.zip`), e de mais nenhum
// lugar. Este módulo tem duas metades:
//
//   1. leitura — `lerPerfilOficial`/`agregarPerfil`: abre o zip (ou o CSV já extraído),
//      lê em latin1 com `;`, e SOMA `QT_ELEITORES_PERFIL` por (SG_UF, CD_MUNICIPIO,
//      NR_ZONA). `CD_MUNICIPIO` é o código TSE (o mesmo de `cod_municipio_tse`).
//   2. plano PURO — `planejarPesosOficiais`: compara com `zonas`/`eleitorado`, decide
//      INSERT (par em `zonas` sem peso) / UPDATE (peso diferente), e trava tudo que
//      faria a soma da UF não fechar com o arquivo.
//
// ─── Por que existe ─────────────────────────────────────────────────────────────
//
// O `te` dos EA20 do SIMULADO não é o eleitorado real: TRE-AP publicou 577.534 eleitores
// para o AP em 2026 e o agregado do simulado diz 628.071 (+8,7 %). Nenhum `te` de
// simulado pode virar peso (`planejar` bloqueia, ver `EntradaPlano.ea12Simulado`).
//
// ─── O que este modo NÃO faz ────────────────────────────────────────────────────
//
// Não toca `zonas` (a estrutura é do `--so-estrutural`, que roda ANTES, separado): par do
// arquivo que não está em `zonas`, par de `zonas` sem contagem oficial e linha de peso de
// par fora de `zonas` são BLOQUEIO — a soma da UF não fecharia. Não faz rede: o operador
// baixa o zip.
//
// ─── Validação do total ─────────────────────────────────────────────────────────
//
// O arquivo não traz total por UF; o "total que o próprio arquivo implica" é a soma de
// TODAS as linhas da UF. Depois da escrita, Σ `eleitorado` da UF tem de ser IGUAL a ele
// (nenhum par ficou de fora). `--total-uf AP=577534` acrescenta a conferência externa: o
// total publicado pelo TRE contra a soma do arquivo.

import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { CACHE_DIR, iterCsv, readCsvHeader } from "./_tse-common.ts";
import {
  type ColunasOficiais,
  chaveDoPar,
  type Estado,
  fmt,
  type Par,
  type Peso,
  rotuloDoPar,
  ValidacaoError,
} from "./zonas-faltantes-nucleo.ts";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────────────────────

export interface ContagemOficial {
  /** Σ `QT_ELEITORES_PERFIL` por chave `UF|município|zona` (só das UFs pedidas). */
  porPar: Map<string, number>;
  /** Σ de TODAS as linhas da UF (inclusive pares que não estão em `zonas`). */
  totalPorUf: Map<string, number>;
  linhasLidas: number;
  linhasDasUfs: number;
  /** Linhas do exterior (`ZZ`), ignoradas (ADR-0045). */
  linhasExterior: number;
}

function inteiroOuErro(
  v: string | undefined,
  coluna: string,
  linha: number,
  minimo: number,
): number {
  const t = (v ?? "").trim();
  const n = Number(t);
  if (t === "" || !Number.isInteger(n) || n < minimo) {
    throw new ValidacaoError(
      `arquivo oficial, linha de dados ${linha}: ${coluna}="${t}" — esperado inteiro ≥ ${minimo}.`,
    );
  }
  return n;
}

/**
 * Soma `QT_ELEITORES_PERFIL` por (UF, município, zona), só para as UFs pedidas. O cabeçalho
 * é VALIDADO: nome de coluna ausente é erro (listando o que existe) e não zero em silêncio.
 * Valor não inteiro ou negativo é erro com o número da linha de dados.
 */
export async function agregarPerfil(
  cabecalho: Map<string, number>,
  linhas: AsyncIterable<string[]> | Iterable<string[]>,
  ufs: Set<string>,
  colunas: ColunasOficiais,
): Promise<ContagemOficial> {
  const idx = (nome: string, flag: string): number => {
    const i = cabecalho.get(nome);
    if (i === undefined) {
      throw new ValidacaoError(
        `coluna "${nome}" ausente no cabeçalho do arquivo oficial — encontrei: ${[
          ...cabecalho.keys(),
        ]
          .slice(0, 40)
          .join(", ")}. Ajuste com ${flag}.`,
      );
    }
    return i;
  };
  const iUf = idx(colunas.uf, "--col-uf");
  const iMun = idx(colunas.municipio, "--col-municipio");
  const iZona = idx(colunas.zona, "--col-zona");
  const iQt = idx(colunas.qt, "--col-qt");

  const out: ContagemOficial = {
    porPar: new Map(),
    totalPorUf: new Map(),
    linhasLidas: 0,
    linhasDasUfs: 0,
    linhasExterior: 0,
  };
  for await (const row of linhas) {
    out.linhasLidas++;
    const uf = (row[iUf] ?? "").trim().toUpperCase();
    if (uf === "ZZ") {
      out.linhasExterior++;
      continue;
    }
    if (!ufs.has(uf)) continue;
    out.linhasDasUfs++;
    const mun = inteiroOuErro(row[iMun], colunas.municipio, out.linhasLidas, 1);
    const zona = inteiroOuErro(row[iZona], colunas.zona, out.linhasLidas, 1);
    const qt = inteiroOuErro(row[iQt], colunas.qt, out.linhasLidas, 0);
    const k = chaveDoPar({ uf, codMunicipioTse: mun, codZona: zona });
    out.porPar.set(k, (out.porPar.get(k) ?? 0) + qt);
    out.totalPorUf.set(uf, (out.totalPorUf.get(uf) ?? 0) + qt);
  }
  return out;
}

/** Zip → extrai (com `unzip`, como o resto do pipeline) numa pasta de cache própria; CSV → ele mesmo. */
export async function localizarCsvOficial(
  caminho: string,
  baseDeExtracao: string = CACHE_DIR,
): Promise<string> {
  if (!/\.zip$/i.test(caminho)) return caminho;
  const destino = resolve(
    baseDeExtracao,
    `pesos-oficiais-${basename(caminho).replace(/[^\w.-]/g, "_")}`,
  );
  await rm(destino, { recursive: true, force: true }); // pasta nossa; nunca reaproveita extração velha
  await mkdir(destino, { recursive: true }); // `unzip -d` não cria os pais (build/tse-archives)
  await execFileAsync("unzip", ["-o", "-q", caminho, "-d", destino], { maxBuffer: 1 << 26 });
  const csvs = (await readdir(destino)).filter((f) => /\.csv$/i.test(f));
  const perfil = csvs.filter((f) => /perfil_eleitorado/i.test(f));
  const escolhidos = perfil.length > 0 ? perfil : csvs;
  if (escolhidos.length !== 1) {
    throw new ValidacaoError(
      `zip oficial: esperava exatamente 1 CSV (de perfil) e achei ${escolhidos.length} ` +
        `[${csvs.join(", ") || "nenhum"}] em ${destino}. Extraia à mão e passe o CSV.`,
    );
  }
  return resolve(destino, escolhidos[0]!);
}

export async function lerPerfilOficial(
  caminho: string,
  ufs: string[],
  colunas: ColunasOficiais,
  baseDeExtracao: string = CACHE_DIR,
): Promise<ContagemOficial> {
  const csv = await localizarCsvOficial(caminho, baseDeExtracao);
  const cabecalho = await readCsvHeader(csv);
  return agregarPerfil(cabecalho, iterCsv(csv), new Set(ufs), colunas);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plano (puro)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaPlanoOficial {
  ufs: string[];
  zonas: Par[];
  /** Pesos de `eleitorado` (ano=2026), todas as UFs. */
  pesos: Peso[];
  oficial: ContagemOficial;
  /** `--total-uf`: total publicado por UF. */
  totaisPublicados: Record<string, number>;
}

export interface AtualizacaoOficial {
  par: Par;
  de: number;
  para: number;
}

export interface VerificacaoOficial {
  uf: string;
  pares: number;
  /** Σ de todas as linhas da UF no arquivo (o total que o próprio arquivo implica). */
  totalArquivo: number;
  somaAntes: number;
  /** Σ `eleitorado` da UF depois de aplicar o plano. */
  somaDepois: number;
  publicado: number | null;
}

export interface PlanoOficial {
  ufs: string[];
  atualizacoes: AtualizacaoOficial[];
  /** Pares em `zonas` sem peso: entram com a contagem oficial. */
  insercoes: Peso[];
  inalterados: number;
  /** Pares em `zonas` sem contagem no arquivo. */
  semOficial: Par[];
  /** Pares do arquivo (das UFs pedidas) que não estão em `zonas`. */
  foraDeZonas: (Par & { qt: number })[];
  /** Linhas de peso de par que não está em `zonas`. */
  orfaos: Peso[];
  verificacoes: VerificacaoOficial[];
  bloqueios: string[];
  avisos: string[];
}

const cmpPar = (a: Par, b: Par): number =>
  a.uf.localeCompare(b.uf) || a.codMunicipioTse - b.codMunicipioTse || a.codZona - b.codZona;

function ordenar<T extends Par>(xs: T[]): T[] {
  return xs.slice().sort(cmpPar);
}

const lista = (xs: Par[], n = 8): string =>
  `${xs.slice(0, n).map(rotuloDoPar).join(", ")}${xs.length > n ? `, … (+${xs.length - n})` : ""}`;

const soma = (xs: { eleitoresAptos: number }[]): number =>
  xs.reduce((a, p) => a + p.eleitoresAptos, 0);

export function planejarPesosOficiais(e: EntradaPlanoOficial): PlanoOficial {
  const ufs = [...new Set(e.ufs.map((u) => u.toUpperCase()))].sort();
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const atualizacoes: AtualizacaoOficial[] = [];
  const insercoes: Peso[] = [];
  const semOficial: Par[] = [];
  const foraDeZonas: (Par & { qt: number })[] = [];
  const orfaos: Peso[] = [];
  const verificacoes: VerificacaoOficial[] = [];
  let inalterados = 0;

  for (const uf of Object.keys(e.totaisPublicados)) {
    if (!ufs.includes(uf)) {
      bloqueios.push(`--total-uf ${uf}: a UF não está em --uf (${ufs.join(",")}) — total sem uso.`);
    }
  }

  const kZonas = new Set(e.zonas.map(chaveDoPar));
  const pesoPorChave = new Map(e.pesos.map((p) => [chaveDoPar(p), p.eleitoresAptos]));

  for (const uf of ufs) {
    const zonasUf = ordenar(e.zonas.filter((z) => z.uf === uf));
    if (zonasUf.length === 0) {
      bloqueios.push(`${uf}: nenhum par em \`zonas\` — nada a pesar (UF inexistente?).`);
      continue;
    }
    const totalArquivo = e.oficial.totalPorUf.get(uf);
    if (totalArquivo === undefined) {
      bloqueios.push(`${uf}: o arquivo oficial não tem nenhuma linha desta UF.`);
      continue;
    }

    const semOficialUf: Par[] = [];
    for (const z of zonasUf) {
      const k = chaveDoPar(z);
      const qt = e.oficial.porPar.get(k);
      if (qt === undefined) {
        semOficialUf.push(z);
        continue;
      }
      if (qt <= 0) {
        bloqueios.push(`${rotuloDoPar(z)}: contagem oficial ${fmt(qt)} — esperado > 0.`);
        continue;
      }
      const existente = pesoPorChave.get(k);
      if (existente === undefined) {
        insercoes.push({ ...z, eleitoresAptos: qt });
      } else if (existente !== qt) {
        atualizacoes.push({ par: z, de: existente, para: qt });
      } else inalterados++;
    }
    semOficial.push(...semOficialUf);
    if (semOficialUf.length > 0) {
      bloqueios.push(
        `${uf}: ${semOficialUf.length} par(es) em \`zonas\` SEM contagem no arquivo oficial ` +
          `(${lista(semOficialUf)}) — o peso deles não pode ser gravado e a soma não fecharia.`,
      );
    }

    const fora: (Par & { qt: number })[] = [];
    for (const [k, qt] of e.oficial.porPar) {
      if (!k.startsWith(`${uf}|`) || kZonas.has(k)) continue;
      const [, mun, zona] = k.split("|");
      fora.push({ uf, codMunicipioTse: Number(mun), codZona: Number(zona), qt });
    }
    const foraOrdenado = ordenar(fora);
    foraDeZonas.push(...foraOrdenado);
    if (foraOrdenado.length > 0) {
      bloqueios.push(
        `${uf}: ${foraOrdenado.length} par(es) do arquivo oficial NÃO estão em \`zonas\` ` +
          `(${lista(foraOrdenado)}; ${fmt(foraOrdenado.reduce((a, p) => a + p.qt, 0))} eleitores) — ` +
          "rode antes o --so-estrutural (estrutura primeiro, pesos depois).",
      );
    }

    const orfaosUf = e.pesos.filter((p) => p.uf === uf && !kZonas.has(chaveDoPar(p)));
    orfaos.push(...orfaosUf);
    if (orfaosUf.length > 0) {
      bloqueios.push(
        `${uf}: ${orfaosUf.length} linha(s) de peso de par fora de \`zonas\` ` +
          `(${orfaosUf.map((p) => `${rotuloDoPar(p)}: ${fmt(p.eleitoresAptos)}`).join(", ")}) — ` +
          "entram na soma e ela não fecharia; remova-as antes (--so-estrutural --remover-fantasmas).",
      );
    }

    // Σ final da UF = pesos atuais com as mudanças do plano aplicadas
    const upd = new Map(
      atualizacoes.filter((a) => a.par.uf === uf).map((a) => [chaveDoPar(a.par), a.para]),
    );
    const somaAntes = soma(e.pesos.filter((p) => p.uf === uf));
    const somaDepois =
      soma(
        e.pesos
          .filter((p) => p.uf === uf)
          .map((p) => ({ eleitoresAptos: upd.get(chaveDoPar(p)) ?? p.eleitoresAptos })),
      ) + soma(insercoes.filter((p) => p.uf === uf));
    const publicado = e.totaisPublicados[uf] ?? null;
    verificacoes.push({
      uf,
      pares: zonasUf.length,
      totalArquivo,
      somaAntes,
      somaDepois,
      publicado,
    });

    if (somaDepois !== totalArquivo) {
      bloqueios.push(
        `${uf}: Σ dos pesos depois do plano (${fmt(somaDepois)}) ≠ total que o arquivo implica ` +
          `(${fmt(totalArquivo)}; ${somaDepois - totalArquivo > 0 ? "+" : ""}${fmt(somaDepois - totalArquivo)}) — nada é gravado.`,
      );
    }
    if (publicado === null) {
      avisos.push(
        `${uf}: sem --total-uf ${uf}=<total publicado>: a soma do arquivo só foi conferida contra ela mesma.`,
      );
    } else if (publicado !== totalArquivo) {
      bloqueios.push(
        `${uf}: o arquivo oficial soma ${fmt(totalArquivo)} e o total publicado é ${fmt(publicado)} ` +
          `(${totalArquivo - publicado > 0 ? "+" : ""}${fmt(totalArquivo - publicado)}) — arquivo errado, ` +
          "de outra data ou coluna trocada.",
      );
    }
  }

  return {
    ufs,
    atualizacoes: atualizacoes.sort((a, b) => cmpPar(a.par, b.par)),
    insercoes: ordenar(insercoes),
    inalterados,
    semOficial: ordenar(semOficial),
    foraDeZonas,
    orfaos: ordenar(orfaos),
    verificacoes,
    bloqueios,
    avisos,
  };
}

/** O que `eleitorado` (ano=2026) DEVE conter depois de gravar o plano; `zonas` não muda. */
export function estadoFinalOficial(antes: Estado, plano: PlanoOficial): Estado {
  const upd = new Map(plano.atualizacoes.map((a) => [chaveDoPar(a.par), a.para]));
  const pesos: Peso[] = antes.pesos.map((p) => ({
    ...p,
    eleitoresAptos: upd.get(chaveDoPar(p)) ?? p.eleitoresAptos,
  }));
  for (const p of plano.insercoes) pesos.push({ ...p });
  return { zonas: antes.zonas.map((z) => ({ ...z })), pesos: ordenar(pesos) };
}
