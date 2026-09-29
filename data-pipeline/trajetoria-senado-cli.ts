// data-pipeline/trajetoria-senado-cli.ts
//
// `pnpm trajetoria:senado` — para cada candidatura a Senador (cargo 5) do
// cadastro do TSE, descobre se o candidato ocupa hoje uma das 54 cadeiras em
// disputa (`em_exercicio`), já foi senador (`mandato_anterior`) ou não é
// nenhum dos dois (`estreante`), e grava
// `editorial/derivados/trajetoria-senado.json`.
//
// O cálculo é puro (`trajetoria-senado.ts`, `casamento-nome.ts`); aqui só há
// leitura do CSV local do TSE, rede (Senado, com cache) e o relatório.
//
// Uso:
//   pnpm trajetoria:senado [--tse-dir build/tse-archives/consulta_cand_2026]
//                          [--saida editorial/derivados/trajetoria-senado.json]
//                          [--cache build/senado] [--atualizar]
//                          [--legislatura-inicial 50]
//
// **Não abre banco e não lê `.env.local`.** Único destino de rede:
// `https://legis.senado.leg.br/dadosabertos/` (só GET, ≥ 0,6 s entre chamadas).
// Data de nascimento e nome civil ficam em memória; o relatório imprime só
// contagens e `sqcand` (identificador público da candidatura).

import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jsonNoFormatoDoBiome } from "./_json-biome.ts";
import { iterCsv, readCsvHeader } from "./_tse-common.ts";
import { construirIndice } from "./casamento-nome.ts";
import { criarClienteSenado, gravarArquivoAtomico } from "./senado-fonte.ts";
import {
  type DetalheSenador,
  type ParlamentarSenado,
  parseAfastados,
  parseDetalhe,
  parseListaAtual,
  parseListaLegislatura,
} from "./senado-parse.ts";
import {
  arquivosPorUf,
  type CandidatoSenadoTse,
  calcularTrajetorias,
  candidatoSenadoDaLinha,
  codigosDoUniverso,
  declaraOcupacaoSenador,
  LEGISLATURA_ATUAL_SENADO,
  LEGISLATURA_INICIAL_HISTORICO,
  montarArquivoTrajetoria,
  montarHistorico,
  ocupacaoAtual,
} from "./trajetoria-senado.ts";

function hojeLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function lerCandidatosAoSenado(tseDir: string): Promise<{
  candidatos: CandidatoSenadoTse[];
  declaramSenador: Set<string>;
  arquivos: number;
  linhasCargo5: number;
  duplicadas: number;
}> {
  const arquivos = arquivosPorUf(await readdir(tseDir));
  if (arquivos.length !== 27) {
    throw new Error(
      `${tseDir}: esperava 27 arquivos por UF, achei ${arquivos.length} — o cadastro está incompleto`,
    );
  }
  const candidatos: CandidatoSenadoTse[] = [];
  const declaramSenador = new Set<string>();
  const vistos = new Set<string>();
  let linhasCargo5 = 0;
  let duplicadas = 0;
  for (const arq of arquivos) {
    const caminho = join(tseDir, arq);
    const header = await readCsvHeader(caminho);
    for await (const campos of iterCsv(caminho)) {
      const c = candidatoSenadoDaLinha(campos, header);
      if (!c) continue;
      linhasCargo5++;
      if (vistos.has(c.sqcand)) {
        duplicadas++;
        continue;
      }
      vistos.add(c.sqcand);
      candidatos.push(c);
      if (declaraOcupacaoSenador(campos, header)) declaramSenador.add(c.sqcand);
    }
  }
  if (candidatos.length === 0) throw new Error(`${tseDir}: nenhuma candidatura de cargo 5`);
  return { candidatos, declaramSenador, arquivos: arquivos.length, linhasCargo5, duplicadas };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "tse-dir": { type: "string", default: "build/tse-archives/consulta_cand_2026" },
      saida: { type: "string", default: "editorial/derivados/trajetoria-senado.json" },
      cache: { type: "string", default: "build/senado" },
      atualizar: { type: "boolean", default: false },
      "legislatura-inicial": { type: "string", default: String(LEGISLATURA_INICIAL_HISTORICO) },
    },
  });
  const tseDir = resolve(values["tse-dir"] as string);
  const saida = resolve(values.saida as string);
  const legIni = Number(values["legislatura-inicial"]);
  if (!Number.isInteger(legIni) || legIni < 1 || legIni > LEGISLATURA_ATUAL_SENADO) {
    throw new Error(`--legislatura-inicial inválida: ${values["legislatura-inicial"]}`);
  }
  const hoje = hojeLocal();

  const tse = await lerCandidatosAoSenado(tseDir);
  console.log(
    `TSE: ${tse.arquivos} arquivos por UF, ${tse.linhasCargo5} linhas de cargo 5, ` +
      `${tse.candidatos.length} candidaturas únicas (${tse.duplicadas} duplicadas descartadas)`,
  );

  const cliente = criarClienteSenado({
    cacheDir: values.cache as string,
    atualizar: values.atualizar as boolean,
    log: (l) => console.log(l),
  });

  // Listas vivas levam a data na chave: um novo dia refaz a chamada.
  const emExercicio = parseListaAtual(
    await cliente.obter({ caminho: "senador/lista/atual.json", chave: `lista_atual_${hoje}` }),
  );
  const afastados = parseAfastados(
    await cliente.obter({ caminho: "senador/afastados.json", chave: `afastados_${hoje}` }),
  );
  const porLegislatura: ParlamentarSenado[][] = [];
  for (let n = legIni; n <= LEGISLATURA_ATUAL_SENADO; n++) {
    const lista = parseListaLegislatura(
      await cliente.obter({
        caminho: `senador/lista/legislatura/${n}.json`,
        consulta: { exercicio: "S" },
        chave: `legislatura_${n}_exercicio_${hoje}`,
      }),
    );
    console.log(`  legislatura ${n}: ${lista.length} senadores que exerceram mandato`);
    porLegislatura.push(lista);
  }

  const codigos = codigosDoUniverso([emExercicio, afastados, ...porLegislatura]);
  console.log(
    `Senado: ${emExercicio.length} em exercício, ${afastados.length} afastados, ` +
      `${codigos.length} pessoas no universo (legislaturas ${legIni}–${LEGISLATURA_ATUAL_SENADO})`,
  );

  // Detalhe é imutável (nome e nascimento não mudam): chave fixa, vale para sempre.
  const detalhes = new Map<number, DetalheSenador>();
  let i = 0;
  for (const codigo of codigos) {
    i++;
    const d = parseDetalhe(
      await cliente.obter({ caminho: `senador/${codigo}.json`, chave: `senador_${codigo}` }),
    );
    if (d.codigo !== codigo) throw new Error(`detalhe do senador ${codigo} veio com outro código`);
    detalhes.set(codigo, d);
    if (i % 50 === 0 || i === codigos.length) console.log(`  detalhes: ${i}/${codigos.length}`);
  }

  const historico = montarHistorico(codigos, detalhes);
  const ocupacao = ocupacaoAtual(emExercicio, afastados);
  const donos2027 = [...ocupacao.values()].filter((c) => c === "2027").length;
  const donos2031 = [...ocupacao.values()].filter((c) => c === "2031").length;
  console.log(
    `Histórico: ${historico.senadores.length} senadores, ${historico.semNomeCivil} sem nome civil, ` +
      `${historico.semNascimento} sem nascimento | donos hoje: ${donos2027} de 2027, ${donos2031} de 2031`,
  );

  const indice = construirIndice(historico.senadores);
  const calculadas = calcularTrajetorias(tse.candidatos, indice, ocupacao);
  const arquivo = montarArquivoTrajetoria(calculadas, new Date().toISOString());

  await mkdir(dirname(saida), { recursive: true });
  await gravarArquivoAtomico(saida, jsonNoFormatoDoBiome(arquivo));

  // ── Relatório (contagens e sqcand; nunca nome nem data) ───────────────────
  const r = calculadas.resumo;
  console.log(`\nGravado ${saida} (universo ${arquivo.universo})`);
  console.log(
    `  em_exercicio ${r.porCategoria.em_exercicio} · mandato_anterior ${r.porCategoria.mandato_anterior} · ` +
      `estreante ${r.porCategoria.estreante}`,
  );
  console.log(
    `  casamento: exato ${r.porModo.exato} · aproximado ${r.porModo.aproximado} · nenhum ${r.porModo.nenhum}`,
  );
  console.log(
    `  com mais de um senador casado: ${r.comMaisDeUmCasado.length} ${JSON.stringify(r.comMaisDeUmCasado)}`,
  );
  console.log(
    `  ATENCAO casaram com cadeira de 2031 (não deveriam concorrer ao Senado): ${r.cadeira2031.length} ${JSON.stringify(r.cadeira2031)}`,
  );

  const donosCandidatos = new Set<number>();
  for (const x of calculadas.porSqcand.values()) {
    if (x.t === "em_exercicio")
      for (const c of x.senado_codigos) if (ocupacao.get(c) === "2027") donosCandidatos.add(c);
  }
  console.log(
    `  donos de cadeira 2027 que são candidatos ao Senado: ${donosCandidatos.size} de ${donos2027}`,
  );

  const porUf = new Map<string, CandidatoSenadoTse>(tse.candidatos.map((c) => [c.sqcand, c]));
  console.log(`\nConferência com DS_OCUPACAO = SENADOR (${tse.declaramSenador.size} candidatos):`);
  const decl = { em_exercicio: 0, mandato_anterior: 0, estreante: 0 };
  const divergentes: string[] = [];
  for (const sq of tse.declaramSenador) {
    const x = calculadas.porSqcand.get(sq);
    if (!x) continue;
    decl[x.t]++;
    if (x.t === "estreante") divergentes.push(`${sq}/${porUf.get(sq)?.uf ?? "?"}`);
  }
  console.log(
    `  declaram SENADOR → em_exercicio ${decl.em_exercicio} · mandato_anterior ${decl.mandato_anterior} · estreante ${decl.estreante}`,
  );
  console.log(`  divergência (declara SENADOR, sem casamento): ${JSON.stringify(divergentes)}`);
  const naoDeclaram = [...calculadas.porSqcand.entries()].filter(
    ([sq, x]) => x.t !== "estreante" && !tse.declaramSenador.has(sq),
  ).length;
  console.log(`  casaram com senador mas NÃO declaram SENADOR: ${naoDeclaram}`);

  const e = cliente.estatisticas();
  console.log(
    `\nAPI: ${e.chamadasDeRede} chamadas, ${e.acertosDeCache} acertos de cache, ` +
      `${e.tentativasFalhas} tentativas falhas, espera total ${Math.round(e.esperaTotalMs / 1000)}s, ` +
      `por status ${JSON.stringify(e.porStatus)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
