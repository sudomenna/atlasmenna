/**
 * app/governador/page.tsx
 *
 * Grid Nacional Governadores (T-02) — spec 006.
 *
 * Server Component RSC. Lê `EdgePayload` (cargo="gov", turno ativo) via
 * `readProjection({ cargo: "gov", turno })` (ADR-0001 + ADR-0012). Em dev sem
 * `EDGE_CONFIG`, o reader retorna `null` e caímos na fixture do repositório.
 *
 * ⚠️ **Em produção não há fallback estrutural** (mudou em 2026-09-14). Sem
 * payload a página vai para `AguardandoGovernadores` e **não mostra número
 * nenhum**. O `emptyPayload()` que ocupava este lugar fabricava um
 * `EdgePayload` completo de zeros, e a página o renderizava como resultado —
 * "Todas as unidades federativas estão com a apuração concluída" saía daí. A
 * página continua não quebrando (constituição § 3); o que ela deixou de fazer
 * é inventar a medição.
 *
 * Layout (S06/F4d — Fase 4):
 *   - `<BreakingNewsTicker>` no topo (chamadas recentes).
 *   - Tabs cargo: Presidente | Governador (active) | Senado | Congresso |
 *     Assembleias (3 últimas grayed-out + tooltip "Disponível em breve").
 *   - `<RaceStatsCards>` — eleitos / vai a 2T / em apuração (27 UFs).
 *   - `<HexCartogramBrasil>` — visão alternativa NYT-like.
 *   - Grid 27 `<GovernorCard>` (3-4 cols desktop, 1 mobile).
 *   - Footer constitucional.
 *
 * Filtros (server-side via search params, sem state client):
 *   `?status=todas|em_disputa|decididos_1t|vai_2t|chamadas`
 *   Default `todas`. Cada filtro renderiza links GET — mantém RSC puro.
 *
 * Cobertura
 *   - RF-021/022 (visão geral por UF), RF-025 (substituído por grid),
 *     RF-029 (tabs Pres/Gov), RF-006.2 (filtros por status).
 *   - RF-006.6/7/8 (2026-09-27): placar 1º × 2º turno e gráfico por partido,
 *     nas duas bases, com a regra única de desfecho de
 *     `lib/utils/desfecho-governador.ts`. Substituem o RF-006.1
 *     (`<RaceStatsCards>`, sem call site desde 09/09 — D23).
 *   - ADR-0001/0010/0012/0013/0017.
 *   - Constituição § 2 (cores via tokens, paleta multi-partido),
 *     § 3 (degrade gracioso), § 8 (transparência — disclaimer K-1
 *     herdado da página UF Gov).
 *
 * S07/Fase 2
 *   - `<main data-trilha="gov">` + `<RaceHeader />` com kicker
 *     "GOVERNADOR · Brasil (27 UFs)" (ADR-0019). O grid de 27 cards e o
 *     cartograma seguem inalterados.
 *   - `<ProjectionThermometers variant="participacao-only" />` acima dos
 *     `<RaceStatsCards />` quando o payload traz `participacao` (ADR-0018).
 *     Não há "top 3 nacional" de governador — só Presidente tem abrangência
 *     Brasil no EA20 —, por isso a variante de participação.
 *   - Sem `participacao` no payload, o lugar do bloco é ocupado por um
 *     parágrafo explicativo estático, com o mesmo `<h2>` (ADR-0022, emendado
 *     em 06/09): o bloco nunca sai do DOM, mas também não alega que há um
 *     valor a caminho — só explica que o agregado é a soma de 27 corridas e
 *     que ele passa a existir na primeira zona apurada em qualquer estado.
 *
 * ===== S07/Bloco 2 — mapa primeiro (ADR-0029) =====
 * A mesma recomposição da home, adaptada ao que esta página é: uma grade de
 * 27 corridas, não uma corrida. **Nenhum bloco saiu.**
 *
 *   1. O `<HexCartogramBrasil>` — o "mapa" desta rota — sobe para PRIMEIRO
 *      conteúdo, logo abaixo do ticker (ADR-0029 § 1).
 *   2. O `<RaceHeader>` com `<h1>` grande saiu da primeira dobra: o `<h1>`
 *      "Governadores 2026" virou o título do painel de resultado, na escala
 *      de qualquer outra seção (ADR-0029 § 5), com `<TrilhaKicker>` acima.
 *      Ele NÃO alterna "Parcial / Projeção" como nas rotas de corrida única:
 *      27 disputas não têm um resultado só para nomear.
 *   3. Cada seção virou um `<Panel>` com filete e kicker (ADR-0025).
 *   4. Os filtros de status passaram de 28px de alvo de toque para
 *      `--tap-min` (44px), o mínimo que o design system fixou. Continuam
 *      sendo links GET — a página segue RSC pura.
 *
 * ===== 2026-09-09 (decisão D23) — o que mudou e o que NÃO mudou =====
 * Saíram:
 *   - `<TrilhaKicker>` (ADR-0019) — sem contraparte no protótipo. Com ele
 *     fora, o painel de resultado volta ao filete duplo padrão do `<Panel>`.
 *   - `<RaceStatsCards>` — idem. O componente segue no repositório, sem call
 *     site: esta era a única rota que o montava.
 *
 * A grade de 27 `<GovernorCard>` FICA, por ordem explícita do usuário: ela é o
 * conteúdo próprio desta rota, e o protótipo não tem equivalente só porque a
 * maquete carrega candidaturas estaduais apenas de São Paulo
 * (`ui_kits/atlas-menna/App.jsx`, nota do seletor de UF). Cortá-la deixaria a
 * página sem conteúdo. O que mudou nela é a contagem de colunas — ver o
 * comentário no ponto de uso.
 *
 * `<ProjectionThermometers variant="participacao-only">` ficou em 09/09 (o
 * ADR-0022 obrigava o bloco a nunca sair do DOM), mas SAIU em 2026-09-27 por
 * decisão do dono: "Participação do eleitorado" não é mais desta página.
 *
 * ## Por que esta rota NÃO recebeu o `<ResultPanel>` do kit
 *
 * As outras três rotas trocaram o hero pelo `<ResultPanel>`. Aqui isso não é
 * possível sem afirmar o que é falso. O painel lê uma lista de candidatos
 * ordenada como UM ranking, e deriva dela a "Margem <líder>" e uma barra de
 * maioria com marcador em 50%. Em `cargo="gov"`, `national.candidatos` não é
 * uma corrida: é a concatenação das 27 corridas estaduais (na fixture, 81
 * candidatos, com `rank` reiniciando a cada UF). Um `<ResultPanel>` sobre esse
 * array publicaria "1º Gov AC MDB, 2º Gov AC PT, ... 4º Gov AL PDT" como se
 * fosse um placar nacional, e uma margem nacional que na verdade compara dois
 * candidatos do Acre. Não há corrida nacional de governador para nomear —
 * é o mesmo fato que o bloco de participação explica em texto logo abaixo.
 *
 * Constituição § 8 (transparência metodológica) e § 6 (determinismo: a UI não
 * inventa número) barram a alternativa. O painel de resultado desta rota
 * continua sendo o `<Panel>` com o `<h1>` "Governadores 2026", o parágrafo que
 * declara as 27 disputas e a participação agregada.
 *
 * ISR: cadência de 60s (ADR-0011) — `revalidate = 60`.
 */

import type { Metadata } from "next";

import { TurnoBadge } from "@/components/atoms/badges/TurnoBadge";
import { FasePreEleicaoBanner } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { EtiquetaFiltro } from "@/components/atoms/controls/EtiquetaFiltro";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { palanquesDaCapa } from "@/components/blocks/_palanques-capa";
import { BreakingNewsTicker } from "@/components/blocks/BreakingNewsTicker";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { GovernadoresPlacarTurno } from "@/components/blocks/GovernadoresPlacarTurno";
import { GovernadoresPorPartido } from "@/components/blocks/GovernadoresPorPartido";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { PalanquesMapa } from "@/components/blocks/PalanquesMapa";
import { RegiaoConsolidada } from "@/components/blocks/RegiaoConsolidada";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import { Footer } from "@/components/layout/Footer";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import { isPreEleicao } from "@/lib/config/fase";
import { agruparPorRegiao } from "@/lib/config/regioes";
import { resultadoEleitoral, simulacaoLigada, simulacaoNacional } from "@/lib/dev/simulacao";
import { readProjection } from "@/lib/edge-config/reader";
import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { lerEtiquetas } from "@/lib/etiquetas/leitor";
import { editorialDaCapa } from "@/lib/etiquetas/telas";
import { itensFaixaAgora } from "@/lib/utils/anuncios-definidos";
import { classificarProjecao } from "@/lib/utils/desfecho-governador";
import { haAnulada, NOTA_ANULADAS } from "@/lib/utils/destino-voto";
import { resolverModoNacional } from "@/lib/zerado/majoritario";
import govFixture from "@/tests/fixtures/edge-config/gov-current.json" with { type: "json" };

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Governadores 2026 · AtlasMenna",
  description:
    "Projeção das 27 corridas estaduais para governador em 2026 — apuração em tempo real, status por UF, cartograma NYT-style. Não oficial. Fonte: TSE.",
  alternates: { canonical: "/governador" },
  openGraph: {
    title: "Governadores 2026 · AtlasMenna",
    description:
      "Projeção das 27 corridas estaduais para governador em 2026 — apuração em tempo real.",
    type: "website",
    locale: "pt_BR",
    siteName: "AtlasMenna",
  },
  twitter: {
    card: "summary_large_image",
    title: "Governadores 2026 · AtlasMenna",
    description: "Apuração em tempo real das 27 corridas estaduais.",
  },
};

type StatusFilter = "todas" | "em_disputa" | "decididos_1t" | "vai_2t" | "chamadas";

const FILTER_LABELS: Record<StatusFilter, string> = {
  todas: "Todas",
  em_disputa: "Em disputa",
  decididos_1t: "1º turno pela projeção",
  vai_2t: "2º turno pela projeção",
  chamadas: "Decididas pela projeção",
};

/** 1º turno encerrado (05/10/2026): a classificação é a do resultado final. */
const FILTER_LABELS_FINAL: Record<StatusFilter, string> = {
  todas: "Todas",
  em_disputa: "Em disputa",
  decididos_1t: "Eleitos no 1º turno",
  vai_2t: "Vão ao 2º turno",
  chamadas: "Decididas",
};

function rotuloFiltro(f: StatusFilter): string {
  return (primeiroTurnoEncerrado() ? FILTER_LABELS_FINAL : FILTER_LABELS)[f];
}

const FILTER_ORDER: StatusFilter[] = ["todas", "em_disputa", "decididos_1t", "vai_2t", "chamadas"];

/**
 * Predicado de filtro — spec 006, RF-006.2 + RF-006.8.
 *
 * 🔴 **Desde 2026-09-27 os três filtros de turno leem `classificarProjecao`**
 * (`lib/utils/desfecho-governador.ts`), a MESMA regra do selo do
 * `<GovernorCard>` e do placar logo acima da grade. Até esta data eles liam
 * `bucket`, e "Decididos no 1º turno" incluía `bucket === "chamada"` — que é
 * só "margem grande", ortogonal ao turno: ES, GO e MG do simulado (líder com
 * 38,5%, `vai_a_2t: true`) apareciam como decididos no 1º turno.
 *
 * - `decididos_1t` = `eleito_1t`; `vai_2t` = `segundo_turno`;
 * - `em_disputa`   = tudo que NÃO é `eleito_1t` (inclui quem vai ao 2º turno:
 *                    a disputa continua até 25/10);
 * - `chamadas` continua por `bucket` — é o que o nome diz: margem decisiva.
 */
function passesFilter(uf: EdgeUfRow, filter: StatusFilter): boolean {
  switch (filter) {
    case "todas":
      return true;
    case "em_disputa":
      return classificarProjecao(uf) !== "eleito_1t";
    case "decididos_1t":
      return classificarProjecao(uf) === "eleito_1t";
    case "vai_2t":
      return classificarProjecao(uf) === "segundo_turno";
    case "chamadas":
      return uf.bucket === "chamada";
  }
}

interface PageProps {
  searchParams?: Promise<{ status?: string }>;
}

/**
 * 🔴 **O ramo de espera — o que substituiu o `emptyPayload()` em 2026-09-14.**
 *
 * ## O que estava aqui e por que saiu
 *
 * Até hoje esta página, quando o reader devolvia `null`, montava um
 * `EdgePayload` **estruturalmente completo e cheio de zeros** e o renderizava
 * como se fosse resultado. O que o leitor via, em produção, sem aviso nenhum:
 * "Todas as unidades federativas estão com a apuração concluída" e "Nenhuma UF
 * se encaixa no filtro Todas no momento" — as mentiras nº 1 e nº 10 da tabela
 * do design 019 § D2. Era a única superfície desta spec que **regredia de
 * fato**: fabricava medição onde não houve medição.
 *
 * A hierarquia que governa este ramo, decidida pelo dono do produto:
 *
 *   1. **Tem número conhecido?** Mostre o número, com a idade dele. Nunca
 *      esconda.
 *   2. **Não tem nada?** Diga que não tem — **sem número nenhum** na tela.
 *   3. **NUNCA fabrique zeros.** Dado já apurado ou projetado não regride, nem
 *      por falha de sinal, nem por interrupção da apuração.
 *
 * Este ramo é o caso 2. Por isso ele **não** tem `<Figure>`, **não** tem
 * `<VoteBar>` e **não** tem filtros por status: todos imprimiriam um número —
 * "0%", "0 corridas" — que ninguém mediu.
 *
 * ⚠️ **Emenda de 2026-09-14 — o bloco de transparência ficou, sem o número.**
 * Este docstring dizia que ele não entrava aqui, porque a constituição § 8 o
 * exige "em **toda página com projeção**" e esta, sem payload, não tem
 * projeção a decompor. A leitura oposta — toda página de apuração carrega o
 * bloco — é igualmente defensável, e a decisão do dono foi **satisfazer as
 * duas**: o bloco fica na tela e vai a prosa, que é o mesmo tratamento que o
 * RF-158 já dera a ele em fase pré. O que nunca volta é a decomposição
 * numérica ("Modelo 100% / Apuração 0%"), que era o zero fabricado.
 *
 * ## Por que a faixa aqui NÃO diz "a eleição ainda não começou"
 *
 * ⚠️ Este ramo é alcançado por **dois** caminhos que a página não distingue: a
 * chave ainda não foi gravada (verdade em 20/09) e a leitura do Global Config
 * falhou (possível às 21h de 04/10). Fazer `emptyPayload()` carregar o campo
 * `fase` semeado teria sido a correção mais curta e é **a armadilha** nomeada
 * no RNF-010 — transformaria falha de rede em afirmação sobre o calendário. "Não sabemos" é um **terceiro** estado, nunca o reaproveitamento
 * de um dos dois reais, e por isso a faixa entra com
 * `variante="sem_dados"`: ela fala sobre nós, e põe o fato de calendário ao
 * lado sem ligar um ao outro por causa.
 *
 * A falha, essa sim, deixou de ser silenciosa — `lib/edge-config/reader.ts`
 * emite `logError` quando a leitura lança, e o operador a vê nos logs. O que
 * **não** existe é uma segunda cópia dos números para sobreviver a uma queda
 * do Global Config; sem ela, a regra 3 é a única defesa, e é pela negativa.
 */
function AguardandoGovernadores() {
  return (
    <main
      data-trilha="gov"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* RF-160 — primeiro filho do `<main>`; teste de ORDEM, não de presença. */}
      <FasePreEleicaoBanner
        corrida="os governos estaduais"
        variante="sem_dados"
        listaDeEstadosAbaixo
      />

      {/* RF-159 — o selo do `<TopBar>`. `variante="sem_dados"`, emenda de
          2026-09-14: até hoje este ramo publicava também as três propriedades
          que revelam o `sr-only` "A eleição ainda não começou" e o rótulo
          "antes da votação". Chegar aqui significa que o reader não devolveu
          payload — o que às 21h de 04/10 é uma falha de rede, não um fato
          sobre o calendário. A faixa logo acima já se recusava a dizer a
          frase; o selo, fora do `<main>`, continuava dizendo. Agora só o
          segmentado "Parcial / Projeção" é apagado (RF-161), e o selo cai no
          default silencioso. */}
      <SeloFasePreStyle variante="sem_dados" />

      <Panel
        kicker="Atlas Menna · não oficial"
        title="Governadores 2026"
        titleId="resultado-heading"
        headingLevel={1}
      >
        <p
          className="max-w-prose"
          data-testid="gov-aguardando"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          Esta página ainda não recebeu dados de apuração do TSE, então não há número nenhum a
          mostrar aqui — nem percentual, nem contagem, nem liderança. São 27 disputas estaduais
          independentes, uma em cada estado e no Distrito Federal, e cada uma tem a própria página.
          Não oficial. Fonte: TSE.
        </p>
      </Panel>

      {/* Geografia é identidade e fala; progresso é medição e cala. Os 27 links
          são a única coisa que esta tela pode mostrar sem medir nada — e são
          verdadeiros em qualquer dia do calendário. */}
      <Panel kicker="Corridas estaduais" title="Estado a estado" titleId="corridas-heading">
        <UfLinksGrid cargo={3} />
      </Panel>

      {/* 🔴 Emenda de 2026-09-14 — o bloco VOLTOU, em prosa.

          A versão de algumas horas atrás deste ramo tirou o bloco de
          transparência inteiro, com o argumento de que a constituição § 8 o
          exige "em toda página com **projeção**" e que esta, sem payload, não
          tem projeção a decompor. A leitura é defensável; a oposta — toda
          página de apuração carrega o bloco — também é. As duas ficam
          satisfeitas ao mesmo tempo, e custa um parágrafo: o bloco fica, e o
          que sai é o número. Assim a pergunta não volta, e nenhuma das quatro
          telas fica divergente das outras três.

          `variante="sem_dados"` pela mesma razão da faixa no topo: este ramo
          não sabe se a eleição não começou ou se o Global Config caiu. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={0} preEleicao variante="sem_dados" variant="national" />
      </Panel>

      <Footer />
    </main>
  );
}

export default async function GovernadorGridPage({ searchParams }: PageProps) {
  // Filtro lido de search params (RSC puro — sem state client).
  const params = (await searchParams) ?? {};
  const rawStatus = (params.status ?? "todas") as StatusFilter;
  const status: StatusFilter = (FILTER_ORDER as readonly string[]).includes(rawStatus)
    ? rawStatus
    : "todas";

  // Leitura. Sem Edge Config: em `pnpm dev` caímos na fixture de governador (a
  // mesma que os testes usam) para a página renderizar completa em `pnpm dev`.
  //
  // 🔴 Em produção **não há fallback estrutural**: sem payload, a página vai
  // para o ramo de espera e não mostra número nenhum. O `emptyPayload()` que
  // ficava aqui fabricava zeros e os publicava como resultado — ver
  // `AguardandoGovernadores` acima.
  // 🔴 Simulação ligada ⇒ ela é a fonte de verdade e o Global Config nem é
  // lido. Não é zelo: em 2026-09-15 o Blob de produção, respondendo `ok` com
  // lista vazia, ganhou da simulação na rota de municípios. Uma resposta vazia
  // é uma resposta, e a mesma armadilha espera aqui no dia em que `EDGE_CONFIG`
  // entrar no `.env.local`.
  const lido = await resultadoEleitoral(
    () => simulacaoNacional("gov"),
    async () =>
      (await readProjection({ cargo: "gov", turno: 1 })) ??
      (await readProjection({ cargo: "gov", turno: 2 })) ??
      (process.env.NODE_ENV === "development" ? (govFixture as unknown as EdgePayload) : null),
  );

  // 🔴 ADR-0076 — modo zerado: chave ausente, fase pré ou lista vazia ⇒ as 27
  // corridas no layout da apuração, todas em 0 (cadastro do Blob, ordem
  // sorteada). Leitura que FALHOU segue para a tela honesta, sem número.
  const { payload, zerado } = simulacaoLigada()
    ? { payload: lido, zerado: false }
    : await resolverModoNacional(lido, "gov", 1);

  if (!payload) return <AguardandoGovernadores />;

  // 🔴 RF-153 — o ÚNICO gatilho de fase é o campo `fase`. Nada aqui olha para
  // `pct_apurado_total`, `por_uf.length`, `composition.pre_election` ou a data
  // de hoje: às 20h01 de 04/10 o percentual real é 0,01 e por alguns minutos
  // antes ele passa por 0 com o orchestrator já rodando (ADR-0043 D5).
  //
  // E `pre` é **só** sobre o payload que chegou. A ausência de payload não
  // liga a fase pré: ela leva ao ramo acima, que é o terceiro estado ("não
  // sabemos") e não um dos dois reais.
  const pre = isPreEleicao(payload);
  // Identidade fala, medição cala — no zerado como na fase pré.
  const cala = pre || zerado;
  // 05/10/2026 — 1º turno encerrado: TSE totalizou, a tela é o resultado final.
  const encerrado = primeiroTurnoEncerrado();

  const { national, por_uf, pct_apurado_total } = {
    national: payload.national,
    por_uf: payload.por_uf,
    pct_apurado_total: payload.pct_apurado_total,
  };
  // 🔴 2026-10-04 (dono) — a faixa "AGORA" segue a regra do balão do mapa: só
  // anuncia UF com eleito MATEMATICAMENTE definido ou 2º turno definido pelo
  // TSE (`lib/utils/anuncios-definidos.ts`). `national.chamadas_recentes` não
  // é mais lido — o texto dele saía da `chamada` da projeção.
  const faixaAgora = itensFaixaAgora(payload);

  const ufsFiltradas = por_uf.filter((uf) => passesFilter(uf, status));

  // Spec 025 — etiquetas editoriais (chips, filtro, V3): lidas no servidor
  // (Blob com revalidate 60, ou a cópia do build), nunca do payload. Com as
  // chaves de `publicar.json` desligadas, nada abaixo muda a página — e o V3
  // nem lê o payload de Presidente (`_palanques-capa.ts`).
  const etiquetas = await lerEtiquetas();
  const capa = editorialDaCapa(etiquetas, por_uf, {
    cargo: 3,
    turno: payload.turno === 2 ? 2 : 1,
    preEleicao: cala,
  });
  const palanques = await palanquesDaCapa(payload, etiquetas);

  // S07/Bloco 1 — a lista de cargos (Presidente/Governador + os ainda não
  // cobertos) saiu daqui: agora é `<CargoTabs>` no `<TopBar>` global
  // (app/layout.tsx, ADR-0025 § 2), uma vez por documento.

  // O cartograma não está mais nesta página (ADR-0033 § 1): quem o monta é
  // `app/(gov)/layout.tsx`, na coluna persistente do `<AppShellSplit>`.
  return (
    <main
      data-trilha="gov"
      className="mx-auto flex max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* 🔴 RF-160 — PRIMEIRO FILHO do `<main>`, e a posição é o requisito. O
          teste é de ORDEM, não de presença. */}
      {pre ? <FasePreEleicaoBanner corrida="os governos estaduais" /> : null}

      {/* RF-159 — o selo do `<TopBar>`. Esta rota nunca publicou custom
          property nenhuma, e por isso o selo não aparece nela; em fase pré ela
          passa a publicar as três que dizem "ainda não começou", e só elas. */}
      {pre ? <SeloFasePreStyle /> : null}

      {/* Breaking news no topo — faixa fina entre o shell e o mapa
          (ADR-0029 § 1). Só renderiza se há UF com resultado matematicamente
          definido — e nenhuma está antes de a votação acontecer. */}
      {!cala && faixaAgora.length > 0 && <BreakingNewsTicker chamadas={faixaAgora} />}

      {/* O cartograma hexagonal — o "mapa" desta rota — saiu daqui e virou a
          coluna persistente do `<AppShellSplit>` (ADR-0033 § 1), montada por
          `app/(gov)/layout.tsx`. Ele sobrevive à navegação para
          `/uf/[sigla]/governador` e de volta. */}

      {/* O `<TrilhaKicker>` (ADR-0019) saiu em 2026-09-09 (D23): não existe no
          protótipo. Com ele fora, este painel volta ao filete duplo padrão do
          `<Panel>` — era `rule="none"` justamente porque o filete da seção era
          o do kicker de trilha. */}

      {/* Seção 2 — o placar das 27 corridas. O `<h1>` é o título deste painel
          (ADR-0029 § 5) e não alterna Parcial/Projeção: não há um resultado
          único a nomear. O kicker carrega o "não oficial" da constituição § 1.

          Esta rota NÃO recebeu o `<ResultPanel>` do kit — ver o bloco
          "2026-09-09" no cabeçalho deste arquivo. */}
      {/* RF-161 — em fase pré o kicker e o `<h1>` trocam de texto. O kicker de
          sempre contém a palavra que o RF-161 proíbe na tela inteira, e rotula
          como não-oficial uma projeção que não está lá (o `<Footer>` continua
          carregando "Não oficial. Fonte: TSE." em toda página). */}
      <Panel
        kicker={
          pre
            ? "Candidaturas registradas no TSE"
            : encerrado
              ? "Resultado final · 1º turno · não oficial"
              : "Projeção Atlas Menna · não oficial"
        }
        title={pre ? "Quem está concorrendo em cada estado" : "Governadores 2026"}
        titleId="resultado-heading"
        headingLevel={1}
        action={<TurnoBadge turno={payload.turno} />}
      >
        <div className="flex flex-col" style={{ gap: "var(--space-6)" }}>
          <p
            className="max-w-prose"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            {pre
              ? "São 27 disputas estaduais independentes — uma em cada estado e no Distrito Federal. Abrir um estado mostra quem concorre lá. Fonte: TSE."
              : encerrado
                ? "27 corridas estaduais — resultado final do 1º turno, com a totalização do TSE encerrada. Não oficial. Fonte: TSE."
                : "27 corridas estaduais — apuração em tempo real. Não oficial. Fonte: TSE."}
          </p>

          {/* "Participação do eleitorado" (os termômetros de brancos/nulos e
              abstenção, ADR-0018) SAIU desta página em 2026-09-27, decisão do
              dono. Com isso cai aqui a obrigação do ADR-0022 de o bloco nunca
              sair do DOM — ela valia para um bloco que existia; não há mais
              bloco (ADR-0022, `deprecated`). O componente segue no repositório,
              sem call site. */}

          {/* `<RaceStatsCards>` (eleitos / vai a 2T / em apuração) saiu em
              2026-09-09 (D23): não tem contraparte no protótipo. O componente
              continua no repositório, sem call site — esta era a única rota
              que o montava. A contagem por status não sumiu da tela: os
              filtros da seção seguinte nomeiam os mesmos quatro estados e a
              linha "N corridas — <filtro>" dá o número de cada um. */}
        </div>
      </Panel>

      {/* Spec 021 RF-192 / spec 022 RF-200 — EMENDADOS em 2026-09-26 (noite),
          decisão do dono: "Votação" e "A corrida" SAÍRAM desta capa. O
          eleitorado do Brasil é praticamente o mesmo número em todos os cargos
          e aqui repetia o da capa de Presidente sem dizer nada sobre uma
          eleição que é estadual. Os dois painéis vivem em
          `/uf/[sigla]/governador`, com o dado DA UF. */}

      {/* Spec 006 RF-006.6 / RF-006.7 (2026-09-27, decisão do dono) — quem
          fecha no 1º turno, quem vai ao 2º, e o peso de cada partido. Duas
          leituras: "Pela projeção" (como o estado deve terminar) e "Se a
          apuração parasse agora" (só o já apurado). Até 2026-09-27 (tarde)
          ficavam lado a lado; agora cada uma aparece só na sua base da chave
          "Parcial / Projeção" — ver o comentário no ponto de uso.

          Ausente em fase pré (não há desfecho de apuração que não começou —
          RF-161), no ramo sem payload (é outro componente, acima) e no 2º
          turno: com `turno === 2` não existe "fecha no 1º turno", e a regra
          de desfecho deixa todas as UFs `em_aberto` (`vai_a_2t` nulo). */}
      {!cala && payload.turno !== 2 ? (
        <Panel
          kicker="Governadores · não oficial"
          title="1º ou 2º turno"
          titleId="desfecho-turno-heading"
        >
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            {/* 🔴 2026-09-27 (decisão do dono) — as duas leituras deixaram de
                ficar lado a lado: cada uma segue a chave "Parcial / Projeção"
                (`data-view-only`, `app/globals.css`). "Pela projeção" só na
                base Projeção; "Se a apuração parasse agora" só na Parcial —
                a mesma regra de 20/09 de que a visão Parcial não mostra
                leitura do modelo nenhuma. `display: none` também tira a
                coluna escondida da árvore de acessibilidade. Com uma coluna
                por vez, a grade de duas colunas por container saiu. */}
            <div className="flex flex-col" data-testid="desfecho-turno">
              <section
                aria-labelledby="desfecho-projecao-heading"
                className="flex flex-col gap-4"
                data-view-only="proj"
              >
                <h3
                  id="desfecho-projecao-heading"
                  style={{ margin: 0, font: "var(--type-title)", fontSize: "var(--text-lg)" }}
                >
                  Pela projeção
                </h3>
                <p
                  className="max-w-prose"
                  style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
                >
                  Como cada estado deve terminar, segundo a projeção do modelo.
                </p>
                <GovernadoresPlacarTurno porUf={por_uf} base="projecao" />
                <GovernadoresPorPartido porUf={por_uf} base="projecao" />
              </section>
              <section
                aria-labelledby="desfecho-contagem-heading"
                className="flex flex-col gap-4"
                data-view-only="parcial"
              >
                <h3
                  id="desfecho-contagem-heading"
                  style={{ margin: 0, font: "var(--type-title)", fontSize: "var(--text-lg)" }}
                >
                  {encerrado ? "Resultado final" : "Se a apuração parasse agora"}
                </h3>
                <p
                  className="max-w-prose"
                  style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
                >
                  {encerrado
                    ? "Quem foi eleito no 1º turno e quem vai ao 2º, pela contagem final do TSE."
                    : "O que já saiu das urnas, sem projeção."}
                </p>
                <GovernadoresPlacarTurno porUf={por_uf} base="contagem" />
                <GovernadoresPorPartido porUf={por_uf} base="contagem" />
              </section>
            </div>
          </div>
        </Panel>
      ) : null}

      {/* Spec 025 (RF-251) — V3, o mapa dos palanques presidenciais. Abaixo da
          dobra, zero JS; só com a chave `v3`, o critério de palanque publicado
          e o portão de cobertura aberto — senão `palanques` é `null` e nem o
          payload de Presidente é lido. */}
      {palanques ? (
        <Panel
          kicker="Governadores · classificação editorial · não oficial"
          title="Palanques presidenciais nos estados"
          titleId="palanques-heading"
        >
          <PalanquesMapa
            parcial={palanques.parcial}
            projecao={palanques.projecao}
            turno={palanques.turno}
          />
        </Panel>
      ) : null}

      {/* Seção 3 — as 27 corridas.
          🔴 RF-162 — em fase pré esta seção é **27 links e mais nada**.
          Decisão do dono do produto em 13/09, e não é opção em aberto: são 27
          corridas, não uma. `national.candidatos` neste cargo é a união das 27
          sob o mesmo espaço de `id` (o número na urna de cargo majoritário é o
          número do PARTIDO), então todo nome atribuído a um `id` no bloco
          nacional é ambíguo por construção — é o mesmo fato que produziu o
          RF-145 da spec 018. Os `<GovernorCard>` saem com os filtros junto:
          eles nomeiam candidatos e classificam corridas por status de uma
          apuração que não começou. O teste do RF-162 é NEGATIVO — "nenhum nome
          de candidatura no documento" —, porque "os 27 links estão lá" passaria
          com uma grade de rostos logo abaixo. */}
      {/* Constituição § 1 — com o consolidado regional (ADR-0057) esta seção
          passa a carregar número do modelo, e o kicker diz "não oficial". Em
          fase pré ela é 27 links e o kicker fica o de sempre (RF-161). */}
      <Panel kicker={pre ? "Corridas estaduais" : "Corridas estaduais · não oficial"}>
        {pre ? (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            <p
              className="max-w-prose"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              Cada estado elege o próprio governador, e as candidaturas são diferentes em cada um.
              Abra um estado para ver quem concorre lá.
            </p>
            <UfLinksGrid cargo={3} />
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            {/* Filtros — server-side, links GET, RSC puro.
              Alvo de toque `--tap-min` (44px): a versão anterior media 28px,
              abaixo do mínimo que o design system fixou (WCAG 2.5.8 / kit
              Atlas Menna). O ativo é tinta cheia sobre papel (`--surface-
              inverse` × `--text-inverse`); o inativo é `--text-secondary`
              sobre `--paper-1` (5,52:1) — nenhum dos dois depende de cor
              sozinha, porque o ativo também carrega `aria-current="page"`. */}
            <nav aria-label="Filtros por status">
              <ul className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
                {FILTER_ORDER.map((f) => {
                  const active = status === f;
                  const href = f === "todas" ? "/governador" : `/governador?status=${f}`;
                  return (
                    <li key={f}>
                      <a
                        href={href}
                        aria-current={active ? "page" : undefined}
                        data-testid="governador-filtro"
                        data-active={active ? "true" : "false"}
                        className="inline-flex items-center justify-center transition-colors"
                        style={{
                          minHeight: "var(--tap-min)",
                          padding: "0 var(--space-4)",
                          border: "1px solid",
                          borderColor: active ? "var(--surface-inverse)" : "var(--border-hairline)",
                          borderRadius: "var(--radius-pill)",
                          backgroundColor: active ? "var(--surface-inverse)" : "transparent",
                          color: active ? "var(--text-inverse)" : "var(--text-secondary)",
                          font: "var(--type-body-sm)",
                          fontWeight: active ? 600 : 400,
                          textDecoration: "none",
                        }}
                      >
                        {rotuloFiltro(f)}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Spec 025 (RF-247) — filtro por etiqueta: esconde cartões inteiros
                (os que o filtro de status deixou), nunca reordena; o
                consolidado de cada região segue somando todos os estados. */}
            {capa.filtro.length > 0 ? <EtiquetaFiltro grupos={capa.filtro} /> : null}

            {ufsFiltradas.length === 0 ? (
              <p style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}>
                Nenhuma UF se encaixa no filtro <strong>{rotuloFiltro(status)}</strong> no momento.{" "}
                <a href="/governador">Ver todas</a>.
              </p>
            ) : null}

            {/* 🔴 ADR-0057 (2026-09-28, decisão do dono) — os 27 cartões saem
                AGRUPADOS POR REGIÃO (ordem de `lib/config/regioes.ts`; dentro
                da região, alfabética por sigla, como antes), com o
                consolidado da região no topo de cada grupo.

                O filtro de status age SÓ nos cartões (ADR-0057 item 5): o
                consolidado soma sempre `grupo.rows` — todos os estados da
                região —, e os cartões são `grupo.rows` filtrado. Região sem
                nenhum cartão no filtro NÃO some: fica, com o consolidado
                visível, RECOLHIDA, e o corpo diz que nenhum estado dela entra
                no filtro. Assim as cinco regiões estão sempre na tela e o
                consolidado nunca depende do filtro. */}
            <section
              aria-label="Corridas estaduais de governador"
              className="flex flex-col"
              style={{ gap: "var(--space-3)" }}
            >
              {ufsFiltradas.length > 0 ? (
                <p style={{ margin: 0, font: "var(--type-data)", color: "var(--text-muted)" }}>
                  {ufsFiltradas.length} {ufsFiltradas.length === 1 ? "corrida" : "corridas"} —{" "}
                  {rotuloFiltro(status).toLowerCase()}.
                </p>
              ) : null}
              {agruparPorRegiao(por_uf).map((grupo) => {
                const cartoes = grupo.rows.filter((uf) => passesFilter(uf, status));
                return (
                  <RegiaoConsolidada
                    key={grupo.regiao.id}
                    regiao={grupo.regiao}
                    ufs={grupo.rows}
                    chave="partido"
                    nivel={2}
                    abertaInicial={cartoes.length > 0}
                  >
                    {/* UMA coluna, sem breakpoints. Os `sm:`/`lg:`/`xl:` que
                        havia aqui medem a VIEWPORT, e desde o ADR-0033 § 1
                        esta grade não vive mais na viewport: ela está dentro
                        da coluna de painéis do `<AppShellSplit>` (400px no
                        desktop, ≤ 430px no mobile). Numa janela de 1280px o
                        `xl:grid-cols-4` dava ~79px por card — largura
                        NEGATIVA para o nome do candidato. Medido em 1280×900. */}
                    {cartoes.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                        {cartoes.map((uf) => (
                          <GovernorCard
                            key={uf.sigla}
                            uf={uf}
                            candidatos={national.candidatos}
                            etiquetas={capa.cartao(uf.sigla)}
                            // 04/10/2026 (dono) — o cartão reage à chave
                            // "Parcial / Projeção": apurado na Parcial,
                            // projeção na Projeção.
                            duasBases
                            // 2º turno ⇒ nenhum selo de turno ("Venceria no
                            // 1º turno · na parcial" seria falso); a marca de
                            // eleito continua.
                            turno={payload.turno}
                            zerado={zerado}
                          />
                        ))}
                      </div>
                    ) : (
                      <p
                        data-testid="regiao-filtro-vazio"
                        style={{
                          margin: 0,
                          font: "var(--type-body-sm)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Nenhum estado do {grupo.regiao.nome} no filtro{" "}
                        {rotuloFiltro(status).toLowerCase()}.
                      </p>
                    )}
                  </RegiaoConsolidada>
                );
              })}
              {/* ADR-0053 / RF-213 — uma frase para a grade inteira, só se
                  algum cartão exibido tiver candidatura anulada. */}
              {ufsFiltradas.some((uf) => haAnulada(uf.top_candidatos)) ? (
                <p
                  data-testid="governadores-nota-anuladas"
                  style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}
                >
                  {NOTA_ANULADAS}
                </p>
              ) : null}
              {capa.aviso ? <EtiquetasAviso /> : null}
            </section>
          </div>
        )}
      </Panel>

      {/* Seção 4 — transparência metodológica. RF-158: o bloco fica em fase
          pré (constituição § 8), sem as duas frações e sem barra. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={pct_apurado_total} preEleicao={cala} variant="national" />
      </Panel>

      <Footer />
    </main>
  );
}
