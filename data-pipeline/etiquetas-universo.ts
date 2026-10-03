// data-pipeline/etiquetas-universo.ts
//
// O **universo** contra o qual toda chave de etiqueta é validada (spec 024,
// RF-222): as candidaturas a Governador, Senador e Deputado Federal do
// cadastro do TSE, lidas do cache local `build/tse-archives/consulta_cand_2026/`
// que `pnpm candidatos:import` já baixa.
//
// ─── Cinco colunas, e nenhuma outra (RF-229) ────────────────────────────────
//
// `consulta_cand_2026.csv` tem 50 colunas, entre elas CPF, e-mail, título de
// eleitor, data de nascimento, nome civil e nome social. Este módulo lê
// **exatamente** `SQ_CANDIDATO`, `CD_CARGO`, `SG_UF`, `SG_PARTIDO` e
// `SG_FEDERACAO` — nada mais entra em estrutura intermediária, e o teste de
// conjunto exato de chaves de `CandidaturaUniverso` reprova quem acrescentar
// um campo (mesma guarda de `candidatos-parse.ts`).
//
// ─── BR, BRASIL e os 27 arquivos por UF ─────────────────────────────────────
//
// O ZIP do TSE traz `_BRASIL.csv` (a união), `_BR.csv` (só Presidente) e um
// arquivo por UF. Ler tudo duplicaria cada linha. Regra: havendo `_BRASIL`,
// só ele; sem ele, a união dos demais com deduplicação por `SQ_CANDIDATO` —
// duplicata idêntica é descartada, duplicata divergente derruba a leitura.

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizarSigla, normalizarSqcand } from "@/lib/etiquetas/formato";

import { siglaDeFederacao } from "./candidatos-parse";

export type CargoEtiquetado = 3 | 5 | 6;

export interface CandidaturaUniverso {
  sqcand: string;
  cargo: CargoEtiquetado;
  uf: string;
  /** Normalizado. */
  partido: string;
  /** Normalizado; `null` em partido fora de federação. */
  federacao: string | null;
}

export interface Universo {
  candidaturas: ReadonlyMap<string, CandidaturaUniverso>;
  /** partido → federação (ou `null`). */
  partidos: ReadonlyMap<string, string | null>;
  /** federação → partidos-membros **observados** (não parseados da composição). */
  federacoes: ReadonlyMap<string, ReadonlySet<string>>;
}

const COLUNAS = ["SQ_CANDIDATO", "CD_CARGO", "SG_UF", "SG_PARTIDO", "SG_FEDERACAO"] as const;
const SEM_FEDERACAO = new Set(["", "#NULO", "#NULO#", "#NE", "-1", "-3", "NULL"]);

/**
 * Mapeia UM registro do CSV do TSE para uma candidatura — lendo só as cinco
 * colunas acima. `null` para cargo fora de 3/5/6 (Presidente, vices,
 * suplentes, deputados estaduais).
 */
export function candidaturaDeCampos(
  campos: readonly string[],
  header: ReadonlyMap<string, number>,
): CandidaturaUniverso | null {
  const v = (nome: (typeof COLUNAS)[number]): string => {
    const i = header.get(nome);
    if (i === undefined) throw new Error(`coluna obrigatória ausente no CSV do TSE: ${nome}`);
    return (campos[i] ?? "").trim();
  };
  const cargo = Number(v("CD_CARGO"));
  if (cargo !== 3 && cargo !== 5 && cargo !== 6) return null;
  const sqcand = normalizarSqcand(v("SQ_CANDIDATO"));
  if (!sqcand) throw new Error(`SQ_CANDIDATO inválido: "${v("SQ_CANDIDATO")}"`);
  // Desde o cadastro de 03/10 o TSE escreve "13-PT/65-PC do B/43-PV"; o de
  // 12/09 escrevia "PT/PC do B/PV". A mesma limpeza da importação
  // (`siglaDeFederacao`) faz os dois darem a mesma chave — senão toda linha
  // `federacao:` do `partidos.csv` deixa de existir no universo.
  const fed = siglaDeFederacao(v("SG_FEDERACAO")) ?? "";
  return {
    sqcand,
    cargo,
    uf: v("SG_UF").toUpperCase(),
    partido: normalizarSigla(v("SG_PARTIDO")),
    federacao: SEM_FEDERACAO.has(fed) ? null : normalizarSigla(fed),
  };
}

export function montarUniverso(lista: Iterable<CandidaturaUniverso>): Universo {
  const candidaturas = new Map<string, CandidaturaUniverso>();
  for (const c of lista) {
    const ja = candidaturas.get(c.sqcand);
    if (ja) {
      const igual =
        ja.cargo === c.cargo &&
        ja.uf === c.uf &&
        ja.partido === c.partido &&
        ja.federacao === c.federacao;
      if (!igual) {
        throw new Error(
          `SQ_CANDIDATO ${c.sqcand} aparece duas vezes com dados diferentes ` +
            `(${ja.cargo}/${ja.uf}/${ja.partido} × ${c.cargo}/${c.uf}/${c.partido})`,
        );
      }
      continue;
    }
    candidaturas.set(c.sqcand, c);
  }

  const partidos = new Map<string, string | null>();
  const federacoes = new Map<string, Set<string>>();
  for (const c of candidaturas.values()) {
    const ja = partidos.get(c.partido);
    if (ja === undefined || (ja === null && c.federacao !== null)) {
      partidos.set(c.partido, c.federacao);
    } else if (c.federacao !== null && ja !== c.federacao) {
      throw new Error(
        `partido ${c.partido} aparece em duas federações (${ja} e ${c.federacao}) — ` +
          `federação é nacional, isso não deveria acontecer`,
      );
    }
    if (c.federacao) {
      let membros = federacoes.get(c.federacao);
      if (!membros) {
        membros = new Set();
        federacoes.set(c.federacao, membros);
      }
      membros.add(c.partido);
    }
  }
  return { candidaturas, partidos, federacoes };
}

/** Qual(is) arquivo(s) ler: só `_BRASIL` quando existe (ver cabeçalho). */
export function escolherArquivosTse(nomes: readonly string[]): string[] {
  const csv = nomes.filter((n) => /^consulta_cand_2026_([A-Z]{2}|BRASIL)\.csv$/.test(n));
  const brasil = csv.find((n) => n.endsWith("_BRASIL.csv"));
  return brasil ? [brasil] : [...csv].sort();
}

/**
 * Lê o universo do cache local. Lança se o diretório não existir ou não tiver
 * nenhum CSV reconhecível — o chamador decide se isso é erro (compilar) ou
 * "pular" (teste de deriva sem cache, ex. CI).
 */
export async function lerUniversoTse(
  dir: string,
): Promise<{ universo: Universo; arquivos: string[] }> {
  // Import tardio: `_tse-common.ts` configura o driver do Neon na carga do
  // módulo. Nada aqui conecta, mas quem só valida CSV não precisa disso.
  const { iterCsv, readCsvHeader } = await import("./_tse-common.ts");
  const arquivos = escolherArquivosTse(await readdir(dir));
  if (arquivos.length === 0) throw new Error(`nenhum consulta_cand_2026_*.csv em ${dir}`);
  const lista: CandidaturaUniverso[] = [];
  for (const nome of arquivos) {
    const caminho = resolve(dir, nome);
    const header = await readCsvHeader(caminho);
    for await (const campos of iterCsv(caminho)) {
      const c = candidaturaDeCampos(campos, header);
      if (c) lista.push(c);
    }
  }
  return { universo: montarUniverso(lista), arquivos };
}
