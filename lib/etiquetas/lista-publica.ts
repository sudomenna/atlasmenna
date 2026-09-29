/**
 * lib/etiquetas/lista-publica.ts — a lista de TODAS as classificações no ar,
 * para `/sobre-as-etiquetas` e para o CSV público
 * `/sobre-as-etiquetas/classificacoes.csv` (constituição 1.6 § 8: "a lista de
 * todas as classificações com fonte, data e origem — exceção individual, regra
 * derivada ou padrão do partido").
 *
 * Lê os MESMOS arquivos que as telas (`lerEtiquetas`: Blob ou cópia do build,
 * vence a maior versão), então só lista o que está publicado — e publicado já
 * quer dizer revisado pelo dono (RF-223, inclusive a emenda de 29/09 para os
 * derivados). Só no servidor, por construção (o leitor e o cadastro fazem
 * `fetch` com Data Cache).
 */

import { type CandidatoIdentidade, readCandidatosUf } from "@/lib/blob/candidatos";
import { cargoToken } from "@/lib/config/cargos";
import { MANDATO_2031 } from "@/lib/senado/mandato-2031";

import { type ArquivoUf, UFS } from "./formato";
import { type Etiquetas, lerEtiquetas } from "./leitor";
import {
  csvDasClassificacoes,
  type LinhaPublicada,
  linhasDerivadasPublicadas,
  linhasPublicadas,
  separarPorCriterio,
} from "./metodologia";

export interface ClassificacoesPublicadas {
  etiquetas: Etiquetas;
  ufs: ArquivoUf[];
  /** Individuais e padrões de partido/federação com critério publicado — a tabela da página. */
  porLinha: LinhaPublicada[];
  /** Por regra derivada, em vigor (a individual vence) — só no CSV, são milhares. */
  derivadas: LinhaPublicada[];
  /** Linhas revisadas em categoria ainda sem critério publicado, por categoria. */
  aguardandoCriterio: ReturnType<typeof separarPorCriterio>["aguardandoCriterio"];
}

/** O nacional e as 27 UFs, e as linhas publicadas separadas por origem. */
export async function lerClassificacoesPublicadas(): Promise<ClassificacoesPublicadas> {
  const etiquetas = await lerEtiquetas();
  const ufs = (await Promise.all(UFS.map((uf) => lerEtiquetas({ uf }))))
    .map((e) => e.arquivoUf)
    .filter((u): u is ArquivoUf => u !== null);
  const { exibiveis, aguardandoCriterio } = separarPorCriterio(
    linhasPublicadas(etiquetas.nacional, ufs),
  );
  const derivadas = separarPorCriterio(
    linhasDerivadasPublicadas(etiquetas.nacional, ufs),
  ).exibiveis;
  return { etiquetas, ufs, porLinha: exibiveis, derivadas, aguardandoCriterio };
}

/**
 * Nome de exibição de cada linha — o nome de urna do cadastro publicado do
 * TSE (candidaturas) ou o nome parlamentar da foto do Senado (os 27 até 2031).
 * Sem o cadastro, a linha sai sem nome (a página usa o número da
 * candidatura); nunca some e nunca é inventada.
 */
export async function nomesDasLinhas(
  linhas: readonly LinhaPublicada[],
): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (MANDATO_2031.ok) {
    for (const s of MANDATO_2031.mandato.senadores)
      nomes.set(`senado:${s.codigo}`, s.nome_parlamentar);
  }
  const pedidos = new Map<string, { uf: string; cargo: 3 | 5 | 6 }>();
  for (const l of linhas) {
    if (!l.uf) continue;
    const cargo =
      l.alvo === "governador" ? 3 : l.alvo === "senador" ? 5 : l.alvo === "deputado" ? 6 : null;
    if (cargo) pedidos.set(`${l.uf}:${cargo}`, { uf: l.uf, cargo });
  }
  await Promise.all(
    [...pedidos.values()].map(async ({ uf, cargo }) => {
      try {
        const r = await readCandidatosUf(uf, cargoToken(cargo));
        if (r.status !== "ok") return;
        for (const c of r.slice.candidatos as CandidatoIdentidade[])
          nomes.set(c.sqcand, c.nome_urna);
      } catch {
        // Sem o cadastro, a linha sai sem nome — nunca some.
      }
    }),
  );
  return nomes;
}

/** O CSV público inteiro: individuais, padrões e derivadas, na ordem estável da lista. */
export async function csvPublicoDasClassificacoes(): Promise<string> {
  const { porLinha, derivadas } = await lerClassificacoesPublicadas();
  const linhas = [...porLinha, ...derivadas];
  return csvDasClassificacoes(linhas, await nomesDasLinhas(linhas));
}
