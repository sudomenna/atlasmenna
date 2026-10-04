/**
 * app/(dep)/_dados-da-casa.ts — spec 027, frente U-a.
 *
 * **O único lugar em que o módulo comum das telas de deputado lê dado.** A
 * página da UF (`_pagina-uf-deputado.tsx`) e a rota da lista 61+
 * (`_rota-lista-deputado.ts`) não importam leitor nenhum: passam por aqui,
 * sempre com o `cargo` na mão.
 *
 * ## Por que um adaptador, e por que cada cargo tem a SUA fonte
 *
 * Os leitores recebem o cargo desde a frente T — `readDeputadoProjection(cargo)`
 * lê `projection-current-{dep,est,dis}-t1`, `readDeputadoUfDetail(cargo, uf)`
 * lê `deputado[-estadual|-distrital]/uf/<UF>.json`. As fontes de
 * desenvolvimento também são por cargo: a simulação (`lib/dev/simulacao.ts`)
 * tem arquivos próprios das assembleias desde a frente S
 * (`deputado-estadual*.json`, `deputado-distrital*.json`, gerados por
 * `data-pipeline/simulacao-assembleias.py`); a fixture de `pnpm dev`
 * (`tests/fixtures/edge-config/dep-current.json`, `tests/fixtures/blob/dep-uf.json`)
 * continua só do FEDERAL. Servi-la como a página da Assembleia Legislativa de
 * São Paulo poria a bancada de SP na Câmara dos Deputados com cara de dado
 * certo: o defeito do conversor de enum com default silencioso, que já mandou
 * payload de Senador para a chave do Presidente.
 *
 * Por isso a tabela {@link FONTES_DEV} é indexada por `CargoProporcional`, sem
 * ramo de fallback: para 7 e 8 a simulação lê os arquivos da casa, e a fixture
 * de `pnpm dev` devolve `null` (a tela cai no estado honesto, "aguardando os
 * dados"). Cargo proporcional novo sem linha na tabela é erro de compilação.
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
import { readCandidatosUf } from "@/lib/blob/candidatos";
import {
  type DeputadoUfDetail,
  type DeputadoUfDetailResult,
  type DeputadoUfLista,
  type DeputadoUfListaResult,
  readDeputadoUfDetail,
  readDeputadoUfLista,
  sanearDeputadoUfDetail,
  sanearDeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import { type CargoProporcional, cargoToken } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import {
  type CargoAssembleia,
  resultadoEleitoral,
  simulacaoAssembleiaNacional,
  simulacaoAssembleiaUf,
  simulacaoAssembleiaUfLista,
  simulacaoDeputadoNacional,
  simulacaoDeputadoUf,
  simulacaoDeputadoUfLista,
  simulacaoLigada,
} from "@/lib/dev/simulacao";
import {
  type InterruptorProjecaoLido,
  readDeputadoProjection,
  readDeputadoProjectionResult,
} from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { ufsDoCargo } from "@/lib/utils/casa-legislativa";
import { bancadaZerada, detalheZeradoUf } from "@/lib/zerado/deputado";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import depFixture from "@/tests/fixtures/edge-config/dep-current.json" with { type: "json" };

import { lerInterruptorDaTela } from "./_interruptor";

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

/**
 * As fontes de DESENVOLVIMENTO de cada cargo — simulação (`pnpm dev:sim`) e
 * fixture de `pnpm dev`. Ver o cabeçalho: cada casa tem a SUA simulação; a
 * fixture de `pnpm dev` só existe para o federal — e NUNCA serve 7 e 8.
 */
interface FontesDev {
  simulacaoNacional: () => EdgePayloadDeputado | null;
  simulacaoUf: (sigla: string) => DeputadoUfDetail | null;
  simulacaoLista: (sigla: string) => DeputadoUfLista | null;
  fixtureNacional: () => EdgePayloadDeputado | null;
  fixtureUf: (sigla: string) => DeputadoUfDetail | null;
}

/** Assembleia: a simulação da casa; nenhuma fixture de `pnpm dev` (a que existe é do federal). */
function fontesDaAssembleia(cargo: CargoAssembleia): FontesDev {
  return {
    simulacaoNacional: () => simulacaoAssembleiaNacional(cargo),
    simulacaoUf: (sigla) => simulacaoAssembleiaUf(cargo, sigla),
    simulacaoLista: (sigla) => simulacaoAssembleiaUfLista(cargo, sigla),
    fixtureNacional: () => null,
    fixtureUf: () => null,
  };
}

const FONTES_DEV: Readonly<Record<CargoProporcional, FontesDev>> = {
  6: {
    simulacaoNacional: () => simulacaoDeputadoNacional(),
    simulacaoUf: (sigla) => simulacaoDeputadoUf(sigla),
    simulacaoLista: (sigla) => simulacaoDeputadoUfLista(sigla),
    fixtureNacional: () => depFixture as unknown as EdgePayloadDeputado,
    fixtureUf: (sigla) => fixtureDetalhe(sigla),
  },
  // Frente S (spec 027 design § 11): o simulado de cada casa. As fixtures de
  // `pnpm dev` acima são do federal — nunca aqui.
  7: fontesDaAssembleia(7),
  8: fontesDaAssembleia(8),
};

/**
 * Só o payload NACIONAL de um cargo — para a capa das assembleias
 * (`/deputado-estadual`), que lê `est` e `dis` e NENHUM Blob de UF (RF-282).
 * Mesmas regras de {@link lerDadosDaCasa}: simulação ligada ⇒ nenhuma leitura
 * remota; fixture de `pnpm dev` só com `NODE_ENV=development` e só do cargo
 * que a tem.
 */
export async function lerNacionalDaCasa(
  cargo: CargoProporcional,
): Promise<EdgePayloadDeputado | null> {
  const dev = FONTES_DEV[cargo];
  const isDev = process.env.NODE_ENV === "development";
  return resultadoEleitoral(
    () => dev.simulacaoNacional(),
    async () => (await readDeputadoProjection(cargo)) ?? (isDev ? dev.fixtureNacional() : null),
  );
}

/** Resumo nacional + detalhe da UF + interruptor, para `/uf/<UF>/<slug do cargo>`. */
export async function lerDadosDaCasa(
  cargo: CargoProporcional,
  sigla: string,
): Promise<DadosDaCasaUf> {
  const dev = FONTES_DEV[cargo];

  // Em paralelo, de propósito: a página não espera o Blob para renderizar o
  // resumo (RF-129, ADR-0032 item 3). O interruptor vai junto (RF-265) — e no
  // modo simulado vem do arquivo da simulação, nunca do Edge Config.
  const emSimulacao = simulacaoLigada();
  const [[nacionalLido, detalheLido], interruptor] = await Promise.all([
    emSimulacao
      ? Promise.resolve([null, SEM_DETALHE_REMOTO] as const)
      : Promise.all([readDeputadoProjection(cargo), readDeputadoUfDetail(cargo, sigla)]),
    lerInterruptorDaTela(cargo, emSimulacao),
  ]);

  const isDev = process.env.NODE_ENV === "development";
  const nacional =
    nacionalLido ??
    (await resultadoEleitoral(
      () => dev.simulacaoNacional(),
      () => (isDev ? dev.fixtureNacional() : null),
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
          () => dev.simulacaoUf(sigla),
          () => (isDev ? dev.fixtureUf(sigla) : null),
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
  cargo: CargoProporcional,
  sigla: string,
): Promise<DeputadoUfListaResult> {
  if (!simulacaoLigada()) return readDeputadoUfLista(cargo, sigla);
  const daSimulacao = FONTES_DEV[cargo].simulacaoLista(sigla);
  return daSimulacao
    ? { status: "ok", lista: sanearDeputadoUfLista(daSimulacao), url: "fixture://simulacao" }
    : { status: "unavailable", reason: "not_found", url: null };
}

/**
 * Só o detalhe da UF (Blob), para a rota da lista das casas de duas faixas
 * (spec 027, decisão do dono de 03/10): a rota corta o objeto da UF pelo MESMO
 * R que a página usou (`lib/deputado/lista-documento.ts`) e devolve o resto.
 *
 * Mesmas regras de {@link lerDadosDaCasa}: simulação ligada ⇒ nenhuma leitura
 * remota, o detalhe da simulação saneado como a página o saneia; fixture de
 * `pnpm dev` só com `NODE_ENV=development` e só do cargo que a tem.
 */
export async function lerDetalheDaCasa(
  cargo: CargoProporcional,
  sigla: string,
): Promise<DeputadoUfDetailResult> {
  const dev = FONTES_DEV[cargo];
  if (simulacaoLigada()) {
    const daSimulacao = dev.simulacaoUf(sigla);
    return daSimulacao
      ? { status: "ok", detail: sanearDeputadoUfDetail(daSimulacao), url: "fixture://simulacao" }
      : { status: "unavailable", reason: "not_found", url: null };
  }
  const lido = await readDeputadoUfDetail(cargo, sigla);
  if (lido.status === "ok" || process.env.NODE_ENV !== "development") return lido;
  const daFixture = dev.fixtureUf(sigla);
  return daFixture
    ? { status: "ok", detail: sanearDeputadoUfDetail(daFixture), url: "fixture://dev" }
    : lido;
}

/**
 * RF-149 (spec 018) — a grade de candidaturas do estado "aguardando dados",
 * lida do Blob de candidatos pelo código do cargo (token `dep` · `est` · `dis`,
 * de `cargoToken`). Mora aqui porque é leitura por cargo, e o adaptador é o
 * único lugar do módulo comum que lê. Identidade de candidato não é resultado
 * eleitoral: pode vir do Blob real também com a simulação ligada.
 */
export async function lerCandidaturasAguardando(cargo: CargoProporcional, sigla: string) {
  return CandidaturasAguardando({ cargo, uf: sigla });
}

/**
 * Spec 026 RF-291 — os `sqcand` desta casa nesta UF com foto publicada
 * (`foto_ok`), da fatia de candidaturas do Blob (token de `cargoToken`, Data
 * Cache de 12 h). Identidade, não resultado: pode vir do Blob real também com
 * a simulação ligada (os `sqcand` fictícios do simulado só não casam — e as
 * linhas eleitas caem nas iniciais). Fatia indisponível ⇒ conjunto vazio.
 * Nunca lança (`readCandidatosUf` não lança).
 */
export async function lerFotosDaCasa(
  cargo: CargoProporcional,
  sigla: string,
): Promise<ReadonlySet<string>> {
  const fatia = await readCandidatosUf(sigla, cargoToken(cargo));
  if (fatia.status !== "ok") return new Set();
  return new Set(fatia.slice.candidatos.filter((c) => c.foto_ok).map((c) => c.sqcand));
}

// ---------------------------------------------------------------------------
// Placar zerado — ADR-0076 (decisão do dono, 04/10/2026)
// ---------------------------------------------------------------------------

/** O placar zerado de uma UF: o objeto da página, o resto 61+ (federal) e quem tem foto. */
export interface ZeradoDaCasa {
  detail: DeputadoUfDetail;
  lista: DeputadoUfLista | null;
  comFoto: ReadonlySet<string>;
}

/**
 * O lado NACIONAL do gatilho do placar zerado: (a) a chave do cargo está
 * AUSENTE, (b) o payload está na fase pré-eleição (`isPreEleicao`), ou (c) o payload real
 * não tem linha desta UF. 🔴 Leitura que FALHOU nunca zera — e uma leitura
 * que lança aqui conta como falha (nunca como ausência). Com a simulação
 * ligada a leitura remota não roda, e sem payload simulado não se zera.
 */
async function nacionalPermiteZerar(
  cargo: CargoProporcional,
  sigla: string,
  nacional: EdgePayloadDeputado | null,
): Promise<boolean> {
  if (nacional) {
    return isPreEleicao(nacional) || !nacional.por_uf.some((u) => u.sigla === sigla);
  }
  if (simulacaoLigada()) return false;
  try {
    return (await readDeputadoProjectionResult(cargo)).estado === "ausente";
  } catch {
    return false;
  }
}

/**
 * O lado do DETALHE: só sem conteúdo — 404 (nunca gravado), ambiente sem Blob,
 * ou objeto sem agremiação nenhuma. `fetch_error`/`invalid` são falha: não zera.
 */
function detalhePermiteZerar(detalhe: DeputadoUfDetailResult): boolean {
  if (detalhe.status === "ok") return detalhe.detail.agremiacoes.length === 0;
  return detalhe.reason === "not_found" || detalhe.reason === "not_configured";
}

/**
 * O placar zerado desta UF, ou `null` quando o gatilho não vale ou o cadastro
 * de candidaturas não veio (aí a tela fica no estado de sempre). Lê o cadastro
 * do Blob (`readCandidatosUf`, Data Cache de 12 h) — identidade, não resultado.
 */
export async function lerZeradoSePermitido(
  cargo: CargoProporcional,
  sigla: string,
  nacional: EdgePayloadDeputado | null,
  detalhe: DeputadoUfDetailResult,
): Promise<ZeradoDaCasa | null> {
  const uf = sigla.toUpperCase();
  if (!detalhePermiteZerar(detalhe)) return null;
  if (!(await nacionalPermiteZerar(cargo, uf, nacional))) return null;
  const fatia = await readCandidatosUf(uf, cargoToken(cargo));
  if (fatia.status !== "ok" || fatia.slice.candidatos.length === 0) return null;
  const { detail, lista } = detalheZeradoUf(cargo, uf, fatia.slice.candidatos);
  return {
    detail,
    lista,
    comFoto: new Set(fatia.slice.candidatos.filter((c) => c.foto_ok).map((c) => c.sqcand)),
  };
}

/**
 * ADR-0076 — para as CAPAS nacionais: a chave do cargo está AUSENTE (e não
 * falhou)? `true` só com a leitura dizendo "ausente"; falha, exceção ou
 * simulação ligada ⇒ `false` (a capa fica na espera honesta, sem número).
 */
export async function nacionalAusenteDaCasa(cargo: CargoProporcional): Promise<boolean> {
  if (simulacaoLigada()) return false;
  try {
    return (await readDeputadoProjectionResult(cargo)).estado === "ausente";
  } catch {
    return false;
  }
}

/**
 * ADR-0076 — as agremiações do país a zero, do cadastro das UFs da casa (uma
 * leitura de Blob por UF, Data Cache de 12 h). UF cujo cadastro não veio fica
 * de fora — a lista é de identidade, não de resultado.
 */
export async function lerBancadaZerada(cargo: CargoProporcional) {
  const fatias = await Promise.all(
    ufsDoCargo(cargo).map((uf) => readCandidatosUf(uf, cargoToken(cargo))),
  );
  return bancadaZerada(fatias.flatMap((f) => (f.status === "ok" ? f.slice.candidatos : [])));
}
