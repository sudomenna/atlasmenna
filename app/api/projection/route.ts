/**
 * app/api/projection/route.ts
 *
 * Endpoint público de leitura da projeção. Cumpre RF-019/RF-020 e o contrato
 * declarado pelas specs 003 (home) e 004 (UF):
 *
 *   GET /api/projection                     → EdgePayload (nacional, Presidente)
 *   GET /api/projection?cargo=gov           → EdgePayload (nacional, Governador)
 *   GET /api/projection?cargo=sen           → EdgePayload (nacional, Senador)
 *   GET /api/projection?uf=<sigla>          → EdgePayloadUf (RESUMO presidencial da UF)
 *   GET /api/projection?uf=<sigla>&cargo=gov → EdgePayloadUf (RESUMO de Governador da UF)
 *   GET /api/projection?uf=<sigla>&cargo=sen → EdgePayloadUf (RESUMO de Senador da UF)
 *
 * **ADR-0033 § 1 (2026-09-08)**: `?cargo=gov` é acréscimo desta data. A moldura
 * persistente do mapa (`components/layout/PersistentMapFrame.tsx`) busca o
 * próprio dado no cliente, e a trilha Governador precisava de um read path
 * client-side para o cartograma — o `/governador` lia `readProjection({cargo:
 * "gov"})` só no servidor. Sem parâmetro o comportamento é o de sempre
 * (Presidente), então nenhum consumidor existente muda. O namespacing de chave
 * por cargo/turno continua sendo o do ADR-0012: quem resolve a chave é
 * `readProjection`, não este arquivo.
 *
 * **2026-09-18 — `?cargo=sen` acrescido pelo mesmo motivo.** A trilha Senador
 * ganhou a mesma moldura persistente (`PersistentMapFrame`, ramo `cargo ===
 * "sen"`) e precisava do mesmo read path client-side. Senador não tem 2º
 * turno (`temSegundoTurno: false`, `lib/config/cargos.ts`), então este ramo
 * só tenta `turno: 1` — ao contrário de `?cargo=gov`, que tenta 1 e depois 2.
 *
 * ===== 2026-09-19 — `?uf=` PASSA A ACEITAR `cargo` (mudança de contrato) =====
 *
 * 🔴 Até esta data o ramo `?uf=` **ignorava** `cargo` e devolvia sempre o
 * resumo PRESIDENCIAL — a versão anterior desta docstring dizia isso em letras
 * grandes, e o `cargo: "pres"` estava cravado na chamada ao reader. A
 * consequência não era teórica: em `/uf/<sigla>/governador` a moldura do mapa
 * recebia a lista de candidatos do PRESIDENTE, e como os `id` presidenciais não
 * casam com os `votos_reportados` de governador, toda linha do balão caía no
 * fallback `nome: "Candidato {id}"` / `partido: undefined`
 * (`lib/utils/municipio-votos.ts`), a coluna "Part." sumia e o coroplético
 * ficava inteiro em `var(--color-tossup)`.
 *
 * O que muda e o que NÃO muda:
 *   - **Sem `cargo`, nada muda**: continua presidencial, mesma chave, mesmo
 *     corpo de resposta. Nenhum consumidor existente quebra.
 *   - `cargo=gov` tenta turno 1 e depois 2 (mesma ordem de
 *     `app/(gov)/governador/page.tsx`); `cargo=sen` só turno 1.
 *   - `cargo` presente com valor não reconhecido (`dep`, `presidente`, typo)
 *     responde **400 `invalid_cargo`**, e nunca o presidencial em silêncio. É a
 *     regra da casa para conversor de cargo: default permissivo já mandou
 *     payload de Senador para a chave do Presidente neste repositório.
 *
 * `readUfProjection` (`lib/edge-config/reader.ts`) **já exigia** `cargo` sem
 * default (ADR-0028) e a chave já era namespaced por cargo/turno (ADR-0012) —
 * quem resolve a chave continua sendo o reader, não este arquivo. O que faltava
 * era este ramo parar de cravar o literal.
 *
 * **ADR-0032 (2026-09-08)**: o `?uf=` devolve só o resumo. O detalhe municipal
 * e as séries temporais deixaram de fazer parte de `EdgePayloadUf` — vivem no
 * Vercel Blob, lidos no servidor por `readUfDetail` (`lib/blob/uf-detail.ts`).
 * Não há consumidor deste endpoint no repositório que esperasse esses campos
 * (o `useProjection()` de `components/shared/swr-provider.tsx` só busca o
 * nacional), mas um cliente externo que os esperasse passará a não recebê-los.
 *
 * Backed por Edge Config (ADR-0001). Quando não há payload publicado
 * (dev/preview sem credencial), cai num fixture estático compartilhado com os
 * tests para que `pnpm dev` continue renderizável (constituição § 3: UX nunca
 * quebra). Em produção com Edge Config configurado, comportamento original
 * (503 quando chave ausente).
 *
 * Cache (RF-027 + ADR-0002 — polling com CDN cache):
 *   - `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`
 *     A SWR no cliente faz polling a cada 5s, mas a CDN entrega cache de
 *     30s. Combinado: cliente sempre fresh, CDN absorve carga.
 */

import { NextResponse } from "next/server";
import type { Turno } from "@/lib/config/calendar";
import { currentPresidentialTurno } from "@/lib/config/calendar";

import {
  simulacaoGovernadorUf,
  simulacaoLigada,
  simulacaoNacional,
  simulacaoSenadorUf,
  simulacaoUfPresidente,
} from "@/lib/dev/simulacao";
import type { CargoMajoritario } from "@/lib/edge-config/reader";
import { readNationalProjection, readProjection, readUfProjection } from "@/lib/edge-config/reader";
import type { EdgePayload, EdgePayloadUf, EdgeUfCandidate } from "@/lib/edge-config/types";
import govFixture from "@/tests/fixtures/edge-config/gov-current.json" with { type: "json" };
import nationalFixture from "@/tests/fixtures/edge-config/projection-current.json" with {
  type: "json",
};
import senFixture from "@/tests/fixtures/edge-config/sen-current.json" with { type: "json" };

const UF_REGEX = /^[A-Z]{2}$/;
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
} as const;

/**
 * De onde sai a IDENTIDADE (nome, partido, foto) de cada candidatura quando o
 * resumo da UF precisa ser sintetizado do payload nacional.
 *
 *   - `"nacional"` — a cédula é a mesma nos 27 estados (Presidente). Não há por
 *     quem filtrar, e `national.candidatos` é a lista certa.
 *   - `"da-uf"` — `national.candidatos` é a **união de 27 corridas** sob o mesmo
 *     espaço de `id` (Governador e Senador). Quem recorta a corrida daquele
 *     estado é `por_uf[].top_candidatos`, que foi resolvido pelo par
 *     `(uf, numero)` lá no orchestrator e por isso traz `nome`, `partido` e
 *     `sqcand` do MESMO registro. Casar `sqcand` de uma fonte com nome de outra
 *     é o que poria o rosto de uma pessoa ao lado do nome de outra no dia em
 *     que dois estados colidissem num `id` (RF-145).
 */
type FonteDaIdentidade = "nacional" | "da-uf";

interface CargoUfSpec {
  /** Turnos a tentar no Global Config, NESTA ordem. */
  turnos: () => readonly Turno[];
  /**
   * Arquivo por UF da simulação, quando ele existe. Tem precedência sobre a
   * síntese — ver a docstring de `simulacaoUfPresidente`.
   */
  simulacaoUf: (sigla: string) => EdgePayloadUf | null;
  /** Fixture nacional de dev, a partir da qual a síntese é feita. */
  fixtureNacional: () => EdgePayload;
  identidade: FonteDaIdentidade;
}

/**
 * Tabela, e não ternário encadeado nem `??`.
 *
 * O default silencioso em conversor de cargo já mordeu este repositório três
 * vezes — a última mandava todo payload de Senador para a chave do Presidente,
 * e a que esta mudança conserta punha a lista presidencial dentro da tela de
 * Governador. Uma tabela indexada pela união literal `CargoMajoritario` não tem
 * ramo de fallback onde o erro possa se esconder: cargo novo sem entrada é erro
 * de compilação, não uma tela calada mostrando a corrida errada.
 *
 * `dep` está fora de propósito (`CargoMajoritario = Exclude<Cargo, "dep">`):
 * Deputado Federal não tem resumo em forma de `EdgePayloadUf` — tem
 * `DeputadoUfDetail`, tipo próprio, read path próprio (ADR-0026).
 */
const CARGOS_UF: Readonly<Record<CargoMajoritario, CargoUfSpec>> = {
  pres: {
    // Só o turno corrente, como sempre foi: a chave presidencial do turno
    // encerrado tem leitor próprio (`readArchivedProjection`).
    turnos: () => [currentPresidentialTurno()],
    simulacaoUf: simulacaoUfPresidente,
    fixtureNacional: () => nationalFixture as unknown as EdgePayload,
    identidade: "nacional",
  },
  gov: {
    // 1 → 2, a mesma ordem que `app/(gov)/governador/page.tsx` já usava no
    // servidor e que o ramo nacional `?cargo=gov` repete logo abaixo.
    turnos: () => [1, 2],
    // 🔴 2026-09-19, segunda rodada: `governador-uf.json` PASSOU a existir, e
    // a decisão anterior — "cargo 3 não precisa de arquivo por UF porque a
    // síntese filtrada por `top_candidatos` é exata" — estava respondendo à
    // pergunta errada. Ela prova que os números do recorte são da UF; não prova
    // que o recorte tem a corrida inteira. `top_candidatos` é `slice(0, 4)`, SP
    // tem 7 candidaturas a governador, e as 3 da cauda existem em
    // `votos_reportados` do detalhe municipal — daí "Candidato 26004" no balão
    // do hover. Ver a docstring de `simulacaoGovernadorUf`.
    simulacaoUf: simulacaoGovernadorUf,
    fixtureNacional: () => govFixture as unknown as EdgePayload,
    identidade: "da-uf",
  },
  sen: {
    // Senador não tem 2º turno (`temSegundoTurno: false`, `lib/config/cargos.ts`).
    turnos: () => [1],
    simulacaoUf: simulacaoSenadorUf,
    fixtureNacional: () => senFixture as unknown as EdgePayload,
    identidade: "da-uf",
  },
};

/**
 * `?cargo=` do ramo `?uf=` → cargo, ou `null` quando o valor não é atendido.
 *
 * Ausência é o contrato antigo (presidencial) e continua valendo — é o que
 * mantém intacto todo consumidor anterior a 2026-09-19. Presença de valor
 * desconhecido é **erro**, nunca o presidencial em silêncio: é justamente o
 * ramo `default` que esta base já pagou três vezes.
 */
function resolverCargoUf(param: string | null): CargoMajoritario | null {
  if (param === null) return "pres";
  return Object.hasOwn(CARGOS_UF, param) ? (param as CargoMajoritario) : null;
}

/**
 * Em dev (sem `EDGE_CONFIG`), retornamos o fixture para que a home renderize.
 * Em produção com `EDGE_CONFIG` setado, o caller já fez a chamada real ao
 * reader e veio `null` — aí é genuinamente ausência de payload, mantemos 503.
 *
 * ## O `NODE_ENV === "development"` é acréscimo de 2026-09-14, e conserta um buraco
 *
 * Até aqui esta função olhava SÓ a ausência de `EDGE_CONFIG`, e o nome dela
 * afirmava um "dev" que ela nunca verificou. A consequência não era hipotética:
 * uma deployment de PRODUÇÃO sem a variável `EDGE_CONFIG` — credencial não
 * propagada, projeto recriado, variável removida por engano — caía neste ramo e
 * servia os números da fixture como se fossem apuração, com `Cache-Control`
 * público de 30 s por cima. É a mesma classe de defeito que derrubou a home em
 * 13/09 e que publicou resultado inventado em 14/09: a rede de segurança que,
 * na falta de dado, fabrica dado com cara de verdadeiro.
 *
 * Falta de credencial é justamente o estado em que menos se pode confiar no
 * ambiente — então ele passa a ser afirmado, e não inferido. Fora do `pnpm dev`
 * o caminho honesto é o 503 que os chamadores abaixo já tinham escrito.
 */
function isDevWithoutEdgeConfig(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.EDGE_CONFIG;
}

/**
 * Fonte de DESENVOLVIMENTO deste endpoint: simulação quando ligada, a fixture
 * de sempre caso contrário — e nunca as duas.
 *
 * A exclusividade é o ponto. Se a simulação estiver ligada mas o arquivo do
 * cargo faltar, isto devolve `null` e o endpoint responde 503, em vez de cair
 * na fixture antiga: o mapa desta moldura ficaria mostrando OUTRA apuração ao
 * lado do placar da simulação, e o dono passaria horas caçando um bug de UI que
 * não existe. Endpoint mudo é diagnosticável; endpoint discordando, não.
 */
function fonteDev<T>(daSimulacao: () => T | null, daFixture: () => T): T | null {
  if (simulacaoLigada()) return daSimulacao();
  return isDevWithoutEdgeConfig() ? daFixture() : null;
}

/**
 * Recorta um `EdgePayloadUf` de um payload nacional — a mesma lógica que
 * `synthesizeUfFromNational` aplica em `app/(pres)/uf/[sigla]/page.tsx` e que
 * `synthesizeGovUfFromFixture` aplica na rota de governador.
 *
 * ⚠️ Com `identidade: "nacional"` (Presidente) isto serve a votação NACIONAL
 * como se fosse a do estado: a cédula é a mesma nos 27, e não há por quem
 * filtrar. É aproximação de desenvolvimento, e por isso `simulacaoUfPresidente`
 * tem precedência sobre ela no ramo abaixo.
 *
 * Com `identidade: "da-uf"` (Governador, Senador) o recorte é CORRETO e não uma
 * aproximação: cada candidatura estadual só existe num estado, e `id` é
 * namespaced por UF no produtor — o filtro por `top_candidatos` devolve a
 * corrida daquele estado com a votação dela.
 */
function sintetizarUf(
  sigla: string,
  national: EdgePayload,
  identidade: FonteDaIdentidade,
): EdgePayloadUf | null {
  const row = national.por_uf.find((u) => u.sigla === sigla);
  if (!row) return null;

  const daUf = new Map((row.top_candidatos ?? []).map((t) => [t.id, t] as const));
  const elenco =
    identidade === "nacional"
      ? national.national.candidatos
      : national.national.candidatos.filter((c) => daUf.has(c.id));

  // Só no recorte por UF: elenco vazio significa que a linha da UF não trouxe
  // candidatura nenhuma, e devolver um payload sem candidatos pintaria a tela
  // de "corrida sem ninguém". No presidencial a lista nacional é a corrida
  // inteira, e o cheque mudaria o comportamento anterior sem motivo.
  if (identidade === "da-uf" && elenco.length === 0) return null;

  const candidatos: EdgeUfCandidate[] = elenco.map((c) => {
    const t = identidade === "da-uf" ? daUf.get(c.id) : undefined;
    // Ver o comentário no `destino` abaixo: da UF OU do nacional, nunca um
    // caindo no outro.
    const destino = identidade === "da-uf" ? t?.destino : c.destino;
    return {
      id: c.id,
      // Identidade da UF quando ela existe; o nacional é o fallback honesto de
      // payload pré-018, que não tinha `top_candidatos` enriquecido.
      nome: t?.nome ?? c.nome,
      partido: t?.partido ?? c.partido,
      // `cor` não é repassada: saiu do payload em 19/09 (ADR-0024).
      votos_atuais: c.votos_atuais,
      votos_projetados: c.votos_projetados,
      pct_atual: c.pct_atual,
      pct_projetado: c.pct_projetado,
      ci95: { lower: c.pct_projetado_lower, upper: c.pct_projetado_upper },
      // Só quando existe. `sqcand: undefined` explícito é uma chave presente
      // valendo "não sei", e um consumidor que teste `"sqcand" in c` leria isso
      // como "tem".
      ...(t?.sqcand ? { sqcand: t.sqcand } : {}),
      // ADR-0053 / RF-213 — destino da abrangência que decide: a linha DA UF
      // em Governador/Senador, a lista nacional no Presidente. Sem cair de uma
      // na outra: desde 2026-09-27 as listas não emitem `"valido"`, então a
      // ausência na UF é "compete" e NÃO pode deixar passar o valor da lista
      // nacional (em Gov/Sen, a união de 27 corridas). Ausente ⇒ sem chave.
      ...(destino ? { destino } : {}),
    };
  });

  return {
    uf: sigla,
    ts: national.ts,
    cargo: national.cargo,
    turno: national.turno,
    pct_apurado: row.pct_apurado,
    candidatos,
    needle_position: row.lider === national.national.candidato_a_id ? 0.4 : -0.4,
    needle_band: "lean_a",
  };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ufParam = url.searchParams.get("uf");

  if (ufParam) {
    const sigla = ufParam.toUpperCase();
    if (!UF_REGEX.test(sigla)) {
      return NextResponse.json({ error: "invalid_uf" }, { status: 400 });
    }

    // 🔴 Cargo explícito desde 2026-09-19 (ver a docstring do topo). Valor
    // desconhecido é 400, nunca o presidencial calado.
    const cargo = resolverCargoUf(url.searchParams.get("cargo"));
    if (cargo === null) {
      return NextResponse.json(
        { error: "invalid_cargo", cargo: url.searchParams.get("cargo") },
        { status: 400 },
      );
    }
    const spec = CARGOS_UF[cargo];

    // 🔴 Simulação ligada ⇒ ela é a fonte de verdade, e o Global Config nem é
    // lido. Ordem deliberada: é este endpoint que pinta o mapa da moldura
    // persistente, e ele precisa contar exatamente a mesma história que
    // `/uf/[sigla]` renderiza ao lado. O payload por UF vem primeiro; a síntese
    // é o fallback para os três cargos — ela só roda enquanto o arquivo por UF
    // daquele cargo não existir no diretório de fixtures, e entrega o pódio em
    // vez da corrida inteira (o motivo está em `simulacaoGovernadorUf`).
    if (simulacaoLigada()) {
      const daUf = spec.simulacaoUf(sigla);
      if (daUf) return NextResponse.json(daUf, { headers: CACHE_HEADERS });
      const nacional = simulacaoNacional(cargo);
      const sintetizado = nacional ? sintetizarUf(sigla, nacional, spec.identidade) : null;
      if (sintetizado) return NextResponse.json(sintetizado, { headers: CACHE_HEADERS });
      return NextResponse.json({ error: "no_payload", uf: sigla, cargo }, { status: 503 });
    }

    // Cargo explícito (ADR-0028) — e agora o do pedido, não mais o literal
    // `"pres"`. Quem resolve a chave é `readUfProjection`.
    for (const turno of spec.turnos()) {
      const payload = await readUfProjection(sigla, { cargo, turno });
      if (payload) return NextResponse.json(payload, { headers: CACHE_HEADERS });
    }

    // Em dev, sintetiza a UF a partir do fixture nacional DAQUELE cargo, para o
    // `/api/projection?uf=` funcionar sem precisar de fixtures per-UF separadas.
    const national = fonteDev(() => null, spec.fixtureNacional);
    const synthesized = national ? sintetizarUf(sigla, national, spec.identidade) : null;
    if (synthesized) return NextResponse.json(synthesized, { headers: CACHE_HEADERS });
    return NextResponse.json({ error: "no_payload", uf: sigla, cargo }, { status: 503 });
  }

  // ADR-0033 § 1 — `?cargo=gov`. A ordem 1T → 2T é a mesma que
  // `app/(gov)/governador/page.tsx` já usava no servidor.
  if (url.searchParams.get("cargo") === "gov") {
    // Simulação primeiro, e sem tocar no Global Config — mesma regra do ramo
    // de UF acima.
    const govSim = simulacaoLigada() ? simulacaoNacional("gov") : null;
    if (govSim) return NextResponse.json(govSim, { headers: CACHE_HEADERS });
    if (!simulacaoLigada()) {
      const gov =
        (await readProjection({ cargo: "gov", turno: 1 })) ??
        (await readProjection({ cargo: "gov", turno: 2 })) ??
        fonteDev(
          () => null,
          () => govFixture as unknown as EdgePayload,
        );
      if (gov) return NextResponse.json(gov, { headers: CACHE_HEADERS });
    }
    return NextResponse.json({ error: "no_payload", cargo: "gov" }, { status: 503 });
  }

  // `?cargo=sen` — mesma estrutura do ramo gov acima, sem o retry de 2º
  // turno: Senador não tem (`temSegundoTurno: false`, `lib/config/cargos.ts`).
  if (url.searchParams.get("cargo") === "sen") {
    const senSim = simulacaoLigada() ? simulacaoNacional("sen") : null;
    if (senSim) return NextResponse.json(senSim, { headers: CACHE_HEADERS });
    if (!simulacaoLigada()) {
      const sen =
        (await readProjection({ cargo: "sen", turno: 1 })) ??
        fonteDev(
          () => null,
          () => senFixture as unknown as EdgePayload,
        );
      if (sen) return NextResponse.json(sen, { headers: CACHE_HEADERS });
    }
    return NextResponse.json({ error: "no_payload", cargo: "sen" }, { status: 503 });
  }

  const presSim = simulacaoLigada() ? simulacaoNacional("pres") : null;
  if (presSim) return NextResponse.json(presSim, { headers: CACHE_HEADERS });
  if (!simulacaoLigada()) {
    const payload =
      (await readNationalProjection()) ??
      fonteDev(
        () => null,
        () => nationalFixture as unknown as EdgePayload,
      );
    if (payload) return NextResponse.json(payload, { headers: CACHE_HEADERS });
  }
  return NextResponse.json({ error: "no_payload" }, { status: 503 });
}
