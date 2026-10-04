/**
 * app/(dep)/deputado-federal/eleitos/route.ts
 *
 * GET /deputado-federal/eleitos — os eleitos de Deputado Federal do PAÍS por
 * agremiação e o cenário projetado nacional misto (spec 026 RF-299 e RF-300;
 * ADR-0063, emenda de 04/10 (2)). Quem chama é a ilha
 * `<BancadaEleitosNacional>` da capa, no clique em "Ver os eleitos" ou ao
 * escolher "Projeção" no seletor — uma vez por aba, 60 s em memória.
 *
 * A capa NÃO chama esta rota no servidor: o RF-271 (a capa não lê Blob de
 * UF) continua valendo. A leitura acontece só aqui, só sob demanda.
 *
 * ## Por que FORA de `/api`
 *
 * O mesmo motivo de `uf/[sigla]/deputado-federal/lista/route.ts` (ADR-0065
 * D3): `proxy.ts` aplica o BotID a `/api/*`, e um `fetch` de clique é o tipo
 * de requisição que ele barra com 403 `bot_detected`. Os objetos de UF já são
 * públicos no Blob; esta rota não abre dado novo — só os soma.
 * `tests/unit/api/deputado-eleitos-nacionais-route.test.ts` falha se a rota
 * for movida para baixo de `/api`.
 *
 * ## O que lê
 *
 * O interruptor da projeção (`lerInterruptorDaTela`, o mesmo da página) e,
 * em paralelo, as 27 UFs (`lerDetalheDaCasa` — com a simulação ligada, a
 * fixture; nunca o Blob de produção) e a fatia de candidaturas de cada UF
 * para as fotos dos eleitos (`lerFotosDaCasa`, Data Cache de 12 h). Nenhuma
 * leitura de Postgres (ADR-0001).
 *
 * ## Respostas
 *
 *   - 200 — o {@link EleitosNacionais}; UF que falhou ou não existe vai para
 *     `ufs_sem_dado` e fica FORA da soma (nunca vira zero);
 *   - 404 — nenhuma UF com dado (antes da apuração, ou ambiente sem Blob);
 *   - 502 — nenhuma UF com dado e ao menos uma falhou de verdade (rede,
 *     corpo fora do contrato), ou erro inesperado.
 *
 * ## Cache
 *
 *   - sucesso: `public, s-maxage=60, stale-while-revalidate=60` — e não os
 *     300 s de SWR do molde `/lista`: aqui o dado muda a cada ciclo e carrega
 *     projeção, e o "desligar → sumir" do interruptor não pode ficar preso
 *     6 min no CDN (ADR-0063 emenda 04/10 (2), Consequências). A ilha ainda
 *     confere o interruptor lido pela PÁGINA e ignora a projeção da resposta
 *     quando a página diz "desligada";
 *   - 🔴 erro nunca é cacheável (ADR-0065 D3): 404 e 502 saem `no-store`.
 *
 * ⚠️ `force-dynamic`, e não `revalidate` — com `revalidate` a rota vira ISR e
 * o Next guarda no cache ISR a resposta de QUALQUER status (um 502 servido
 * por 60 s a todo leitor). Ver a nota gêmea em `lista/route.ts`.
 */

import { NextResponse } from "next/server";

import { ufsDoCargo } from "@/lib/config/cargos";
import { agregarEleitosNacionais } from "@/lib/deputado/eleitos-nacionais";
import { simulacaoLigada } from "@/lib/dev/simulacao";

import { lerDetalheDaCasa, lerFotosDaCasa } from "../../_dados-da-casa";
import { lerInterruptorDaTela } from "../../_interruptor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deputado Federal. Escrito uma vez. */
const CARGO = 6 as const;

const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=60";
const CACHE_ERRO = "no-store";

function erro(status: 404 | 502, corpo: Record<string, unknown>): Response {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": CACHE_ERRO } });
}

export async function GET(): Promise<Response> {
  try {
    const ufs = ufsDoCargo(CARGO);
    const [interruptor, lidas] = await Promise.all([
      lerInterruptorDaTela(CARGO, simulacaoLigada()),
      Promise.all(
        ufs.map(async (uf) => {
          const [resultado, comFoto] = await Promise.all([
            lerDetalheDaCasa(CARGO, uf),
            lerFotosDaCasa(CARGO, uf),
          ]);
          return { uf, resultado, comFoto };
        }),
      ),
    ]);

    if (!lidas.some((l) => l.resultado.status === "ok")) {
      const falhou = lidas.filter(
        (l) =>
          l.resultado.status === "unavailable" &&
          (l.resultado.reason === "fetch_error" || l.resultado.reason === "invalid"),
      );
      return falhou.length > 0
        ? erro(502, { error: "blob_indisponivel", ufs: falhou.map((l) => l.uf) })
        : erro(404, { error: "eleitos_inexistentes" });
    }

    const corpo = agregarEleitosNacionais(
      lidas.map(({ uf, resultado, comFoto }) => ({
        uf,
        detail: resultado.status === "ok" ? resultado.detail : null,
        comFoto,
      })),
      interruptor,
    );
    return NextResponse.json(corpo, { headers: { "Cache-Control": CACHE_OK } });
  } catch {
    return erro(502, { error: "falha_interna" });
  }
}
