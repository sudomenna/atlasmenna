// data-pipeline/alinhamento-senado-cli.ts
//
// `pnpm alinhamento:senado` — baixa (com cache) as votações nominais e as
// orientações de bancada do plenário do Senado, calcula o alinhamento e grava
// `editorial/derivados/alinhamento-senado.json`. O cálculo é puro e vive em
// `alinhamento-senado.ts`; aqui só há rede, disco e o relatório de conferência.
//
// Uso:
//   pnpm alinhamento:senado [--inicio 2023-02-01] [--fim AAAA-MM-DD]
//                           [--saida editorial/derivados/alinhamento-senado.json]
//                           [--cache build/senado] [--atualizar]
//
// **Não abre banco e não lê `.env.local`.** Único destino de rede:
// `https://legis.senado.leg.br/dadosabertos/` (só GET, ≥ 0,6 s entre chamadas).

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jsonNoFormatoDoBiome } from "./_json-biome.ts";
import {
  calcularAlinhamento,
  INICIO_LEGISLATURA_57,
  indexarOrientacoes,
  janelasSemestrais,
  montarArquivoAlinhamento,
} from "./alinhamento-senado.ts";
import {
  AMOSTRA_MINIMA,
  classificarEmExercicio,
  contarRelacoes,
  LIMIAR_BASE,
  LIMIAR_OPOSICAO,
  porPartidoAtual,
  quantosMudaram,
  resumoDeVotos,
  taxaPorPartidoDaEpoca,
} from "./alinhamento-senado-relatorio.ts";
import { criarClienteSenado, gravarArquivoAtomico } from "./senado-fonte.ts";
import {
  parseListaAtual,
  parseOrientacoes,
  parseVotacoes,
  type VotacaoComOrientacao,
  type VotacaoNominal,
} from "./senado-parse.ts";

function hojeLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const semTracos = (d: string) => d.replaceAll("-", "");

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      inicio: { type: "string", default: INICIO_LEGISLATURA_57 },
      fim: { type: "string", default: hojeLocal() },
      saida: { type: "string", default: "editorial/derivados/alinhamento-senado.json" },
      cache: { type: "string", default: "build/senado" },
      atualizar: { type: "boolean", default: false },
    },
  });
  const inicio = values.inicio as string;
  const fim = values.fim as string;
  const saida = resolve(values.saida as string);
  const hoje = hojeLocal();

  const cliente = criarClienteSenado({
    cacheDir: values.cache as string,
    atualizar: values.atualizar as boolean,
    log: (l) => console.log(l),
  });

  const janelas = janelasSemestrais(inicio, fim);
  console.log(`Alinhamento do Senado — ${inicio} a ${fim} em ${janelas.length} janelas semestrais`);

  const votacoes: VotacaoNominal[] = [];
  const comOrientacao: VotacaoComOrientacao[] = [];
  for (const j of janelas) {
    const votos = parseVotacoes(
      await cliente.obter({
        caminho: "votacao",
        consulta: { dataInicio: j.inicio, dataFim: j.fim },
        chave: `votacao_${j.inicio}_${j.fim}`,
      }),
    );
    const orient = parseOrientacoes(
      await cliente.obter({
        caminho: `plenario/votacao/orientacaoBancada/${semTracos(j.inicio)}/${semTracos(j.fim)}.json`,
        chave: `orientacao_${j.inicio}_${j.fim}`,
      }),
    );
    console.log(
      `  ${j.inicio}..${j.fim}: ${votos.length} votações, ${orient.length} com orientação`,
    );
    votacoes.push(...votos);
    comOrientacao.push(...orient);
  }

  const resultado = calcularAlinhamento(votacoes, indexarOrientacoes(comOrientacao), {
    inicio,
    fim,
  });
  const arquivo = montarArquivoAlinhamento(resultado);

  await mkdir(dirname(saida), { recursive: true });
  await gravarArquivoAtomico(saida, jsonNoFormatoDoBiome(arquivo));

  const d = resultado.diagnostico;
  console.log(`\nGravado ${saida}`);
  console.log(`  corte (última votação do universo): ${arquivo.corte}`);
  console.log(
    `  universo: ${d.no_universo} votações (${d.disputadas} disputadas) | ` +
      `${Object.keys(arquivo.por_senador).length} senadores com ≥ 1 voto em disputada`,
  );
  console.log("  funil:", JSON.stringify(d));

  // ── Relatório de conferência (informativo; não vai ao arquivo) ──────────
  const atuais = parseListaAtual(
    await cliente.obter({
      caminho: "senador/lista/atual.json",
      chave: `lista_atual_${hoje}`,
    }),
  ).map((p) => ({ codigo: p.codigo, partido: p.partido }));
  const cls = classificarEmExercicio(atuais, resultado.senadores);
  const c = contarRelacoes(cls);
  const v = resumoDeVotos(cls);
  console.log(
    `\nRegra do dono sobre os ${atuais.length} em exercício ` +
      `(≥ ${LIMIAR_BASE} Base · ≤ ${LIMIAR_OPOSICAO} Oposição · < ${AMOSTRA_MINIMA} votos disputados = insuficiente):`,
  );
  console.log(
    `  Base ${c.base} · Independente ${c.independente} · Oposição ${c.oposicao} · insuficiente ${c.insuficiente}`,
  );
  console.log(
    `  votos disputados por senador em exercício: mín ${v.min} · mediana ${v.mediana} · máx ${v.max}`,
  );

  console.log("\nPor partido ATUAL (n · Base/Indep/Oposição/insuf):");
  for (const p of porPartidoAtual(cls)) {
    console.log(
      `  ${p.partido.padEnd(13)} ${String(p.n).padStart(2)} · ${p.base}/${p.independente}/${p.oposicao}/${p.insuficiente}`,
    );
  }

  console.log("\nTaxa por partido DA ÉPOCA do voto (só disputadas, ponderada):");
  for (const p of taxaPorPartidoDaEpoca(resultado.porPartido)) {
    console.log(
      `  ${p.partido.padEnd(13)} ${String(p.taxa).padStart(5)}%  (${p.votosDisputadas} votos)`,
    );
  }

  // Sensibilidade: P-NRV (presente, não registrou voto) contado contra.
  const sens = calcularAlinhamento(votacoes, indexarOrientacoes(comOrientacao), {
    inicio,
    fim,
    contarContra: ["P-NRV"],
  });
  const clsSens = classificarEmExercicio(atuais, sens.senadores);
  const cs = contarRelacoes(clsSens);
  console.log(
    `\nSensibilidade — P-NRV contado contra: Base ${cs.base} · Independente ${cs.independente} · ` +
      `Oposição ${cs.oposicao} · insuficiente ${cs.insuficiente} ` +
      `(${quantosMudaram(cls, clsSens)} senadores mudam de classe)`,
  );

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
