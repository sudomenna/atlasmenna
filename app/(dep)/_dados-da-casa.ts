/**
 * app/(dep)/_dados-da-casa.ts — spec 027, frente U-a.
 *
 * **O único lugar em que o módulo comum das telas de deputado lê dado.** A
 * página da UF (`_pagina-uf-deputado.tsx`) e a rota da lista 61+
 * (`_rota-lista-deputado.ts`) não importam leitor nenhum: passam por aqui,
 * sempre com o `cargo` na mão.
 *
 * ## Por que um adaptador, e por que ele RECUSA os cargos 7 e 8 hoje
 *
 * Os leitores de hoje não recebem cargo — `readDeputadoProjection()`,
 * `readDeputadoUfDetail(uf)`, `readDeputadoUfLista(uf)` e o interruptor da
 * projeção só conhecem o federal. A frente T troca as assinaturas para
 * `(cargo, uf)`; quando ela entrar, a U-b muda ESTE arquivo e nenhum outro.
 *
 * Até lá, pedir o cargo 7 ou 8 aqui LANÇA, em vez de devolver o federal. A
 * alternativa silenciosa — ignorar o cargo e ler o que o leitor sabe ler —
 * poria a bancada de São Paulo na Câmara dos Deputados na página da
 * Assembleia Legislativa de São Paulo, com cara de dado certo. É o defeito do
 * conversor de enum com default silencioso, que já mandou payload de Senador
 * para a chave do Presidente. Um erro na montagem aparece no primeiro teste da
 * U-b; um dado trocado apareceria no ar.
 *
 * As regras de sempre continuam, só mudaram de arquivo (estavam no corpo de
 * `uf/[sigla]/deputado-federal/page.tsx` e de `lista/route.ts`):
 *
 *   - resumo (Global Config) e detalhe (Blob) em paralelo, degradando
 *     independentes (RF-129, ADR-0032 item 3);
 *   - o interruptor da projeção lido JUNTO, a cada render (spec 026 RF-265);
 *   - 🔴 simulação ligada ⇒ nenhuma leitura remota roda (`lib/dev/simulacao.ts`):
 *     com `BLOB_READ_WRITE_TOKEN` no `.env.local`, o Blob de PRODUÇÃO
 *     responderia, e uma resposta vazia é uma resposta;
 *   - fixture de desenvolvimento só com `NODE_ENV=development`, e nunca por
 *     cima de dado real.
 */

import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import {
  type DeputadoUfDetail,
  type DeputadoUfDetailResult,
  type DeputadoUfListaResult,
  readDeputadoUfDetail,
  readDeputadoUfLista,
  sanearDeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import {
  resultadoEleitoral,
  simulacaoDeputadoNacional,
  simulacaoDeputadoUf,
  simulacaoDeputadoUfLista,
  simulacaoLigada,
} from "@/lib/dev/simulacao";
import { type InterruptorProjecaoLido, readDeputadoProjection } from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import type { CargoDeputado } from "@/lib/utils/casa-legislativa";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import depFixture from "@/tests/fixtures/edge-config/dep-current.json" with { type: "json" };

import { lerInterruptorDaTela } from "./_interruptor";

/**
 * Até a frente T: só o cargo 6 tem leitor. Qualquer outro é erro de montagem,
 * nunca "sem dado" nem "o federal serve". Ver o cabeçalho.
 */
function exigirLeitor(cargo: CargoDeputado, leitura: string): asserts cargo is 6 {
  if (cargo !== 6) {
    throw new Error(
      `[deputado] ${leitura}: ainda não há leitor para o cargo ${cargo} — os leitores com cargo chegam com a frente T (spec 027); não caia no federal`,
    );
  }
}

/** O que a página da UF precisa ler, já com simulação e fixture resolvidas. */
export interface DadosDaCasaUf {
  /** Payload nacional do cargo (o resumo da UF está em `por_uf`). */
  nacional: EdgePayloadDeputado | null;
  /** Detalhe da UF (Blob) — `ok` com `url: "fixture://…"` quando veio da simulação/fixture. */
  detalhe: DeputadoUfDetailResult;
  /** O interruptor da projeção, lido agora (RF-265). */
  interruptor: InterruptorProjecaoLido;
}

/**
 * O que `detalheLido` vale quando a leitura remota nem roda (modo simulação).
 * Gêmeo do de `app/(pres)/uf/[sigla]/page.tsx` — a justificativa está lá.
 */
const SEM_DETALHE_REMOTO: DeputadoUfDetailResult = {
  status: "unavailable",
  reason: "not_configured",
  url: null,
};

/**
 * Fixtures dev-only, espelhando `fixtureUf` de `/uf/[sigla]/senador`.
 *
 * **NUNCA em produção**: o chamador faz o gate `NODE_ENV === "development"`
 * antes. A fixture do Blob cobre 5 UFs (SP, MG, RJ, RR, AP); as outras 22 caem,
 * mesmo em dev, no estado "detalhe indisponível" — que também precisa ser
 * visto, e é o estado que 22 estados terão na primeira hora da apuração.
 */
function fixtureDetalhe(sigla: string): DeputadoUfDetail | null {
  const mapa = depUfFixture as unknown as Record<string, DeputadoUfDetail>;
  return mapa[sigla.toUpperCase()] ?? null;
}

/** Resumo nacional + detalhe da UF + interruptor, para `/uf/<UF>/<slug do cargo>`. */
export async function lerDadosDaCasa(cargo: CargoDeputado, sigla: string): Promise<DadosDaCasaUf> {
  exigirLeitor(cargo, "lerDadosDaCasa");

  // Em paralelo, de propósito: a página não espera o Blob para renderizar o
  // resumo (RF-129, ADR-0032 item 3). O interruptor vai junto (RF-265) — e no
  // modo simulado vem do arquivo da simulação, nunca do Edge Config.
  const emSimulacao = simulacaoLigada();
  const [[nacionalLido, detalheLido], interruptor] = await Promise.all([
    emSimulacao
      ? Promise.resolve([null, SEM_DETALHE_REMOTO] as const)
      : Promise.all([readDeputadoProjection(), readDeputadoUfDetail(sigla)]),
    lerInterruptorDaTela(emSimulacao),
  ]);

  const isDev = process.env.NODE_ENV === "development";
  const nacional =
    nacionalLido ??
    (await resultadoEleitoral(
      () => simulacaoDeputadoNacional(),
      () => (isDev ? (depFixture as unknown as EdgePayloadDeputado) : null),
    )) ??
    null;

  // Simulação quando ligada, fixture de sempre caso contrário — nunca as duas,
  // para que o resumo desta UF e o detalhe por agremiação não venham de
  // apurações diferentes. `detalheLido.status === "ok"` continua tendo
  // precedência sobre ambos: dado real nunca é substituído.
  const detalheDev =
    detalheLido.status === "ok"
      ? null
      : await resultadoEleitoral(
          () => simulacaoDeputadoUf(sigla),
          () => (isDev ? fixtureDetalhe(sigla) : null),
        );
  const detalhe: DeputadoUfDetailResult = detalheDev
    ? { status: "ok", detail: detalheDev, url: "fixture://dev" }
    : detalheLido;

  return { nacional, detalhe, interruptor };
}

/**
 * A lista 61+ da UF (spec 026 RF-260). Com a simulação ligada, a leitura
 * remota NÃO roda (a regra de `lib/dev/simulacao.ts`: uma resposta do Blob de
 * produção ganharia da fixture).
 */
export async function lerListaDaCasa(
  cargo: CargoDeputado,
  sigla: string,
): Promise<DeputadoUfListaResult> {
  exigirLeitor(cargo, "lerListaDaCasa");
  if (!simulacaoLigada()) return readDeputadoUfLista(sigla);
  const daSimulacao = simulacaoDeputadoUfLista(sigla);
  return daSimulacao
    ? { status: "ok", lista: sanearDeputadoUfLista(daSimulacao), url: "fixture://simulacao" }
    : { status: "unavailable", reason: "not_found", url: null };
}

/**
 * RF-149 (spec 018) — a grade de candidaturas do estado "aguardando dados",
 * lida do Blob de candidatos pelo código do cargo. Mora aqui porque é leitura
 * por cargo: `<CandidaturasAguardando>` só aceita `CargoTse`, que ainda não
 * conhece 7 e 8.
 */
export async function lerCandidaturasAguardando(cargo: CargoDeputado, sigla: string) {
  exigirLeitor(cargo, "lerCandidaturasAguardando");
  return CandidaturasAguardando({ cargo, uf: sigla });
}
