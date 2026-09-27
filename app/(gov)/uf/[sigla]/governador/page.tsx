/**
 * app/uf/[sigla]/governador/page.tsx — Spec 005 (Página de UF Governador, T-04)
 *
 * Server Component. `generateStaticParams` lista as 27 UFs.
 *
 * Herda ~70% da `app/uf/[sigla]/page.tsx` (presidencial) mas com cargo=gov.
 * Dos 3 blocos NYT-style decididos no kickoff S06, nenhum sobreviveu:
 *
 *   1. (removido em S07/Fase 5) K-1 disclaimer — ver ADR-0021, que supersede
 *      o ADR-0015: sem 2022 no cálculo, não há "prior limitado" a declarar.
 *   2. (removido em 2026-09-08) `<MunicipioWaffleGrid>` — Print 3 NYT
 *      (1 quadrado = 1 município). Não existe no protótipo do kit.
 *   3. (removido em 2026-09-08) Bloco "Apuração por mesorregião" — também sem
 *      contraparte no protótipo. `payload.mesorregioes` segue no schema, sem
 *      consumidor nesta rota.
 *
 * Os municípios (e as séries) chegam pelo Vercel Blob desde o ADR-0032, em
 * `readUfDetail` disparado EM PARALELO com `readUfProjection` — dois read
 * paths que falham de forma independente, com degradação por seção
 * (`<DetailUnavailable>`, sempre no DOM — ADR-0017).
 *
 * Cobertura (após os cortes de 2026-09-08 e 2026-09-09)
 *   - RF-033 (candidate rows, agora dentro do `<ResultPanel>`),
 *     RF-037 (municipios table), RF-043 (forecast transparency).
 *   - DEIXARAM de ter implementação aqui: RF-031 (breadcrumb) e RF-032
 *     (winner banner), cortados em 09/09; RF-035/036 (mapas duo), RF-039
 *     (agulha), RF-040/041/042 (séries), RF-044 (insight), cortados antes. A
 *     spec 005 regride — sincronização de traceability/status é tarefa
 *     separada (`spec-syncer`).
 *   - ADR-0001/0010/0012/0013/0017/0021.
 *   - Constituição § 2 (cores via tokens, paleta multi-partido),
 *     § 3 (degrade gracioso), § 8 (transparência metodológica).
 *
 * S07/Fase 2
 *   - Dispatch de modo (`binary` | `multi-1t`) com a mesma regra da home;
 *     em `multi-1t` os seis termômetros (ADR-0018) abrem a projeção.
 *   - Trilha governador: `<main data-trilha="gov">`, kicker "GOVERNADOR · <UF>"
 *     e breadcrumb "Governadores › <UF>" (ADR-0019 — a trilha de governador
 *     não tem nó nacional).
 *
 * ===== S07/Bloco 2 — mapa primeiro (ADR-0029) =====
 * Mesma recomposição da home e da rota presidencial de UF, item a item:
 * mapa como primeiro conteúdo com altura de hero; `<h1>` pequeno dentro do
 * painel de resultado (alternando "Resultado parcial" / "Projeção Atlas
 * Menna" por cascata); linhas de candidato em `<CandidateResultRow>` com
 * parcial e projeção lado a lado (ADR-0029 § 7); cada seção num `<Panel>`.
 *
 * Novo nesta rota: `<MunicipioExplorer>`, que costura a tabela ao `<Sheet>` —
 * tocar num município abre a folha dele.
 *
 * ===== 2026-09-08 — a rota passa a seguir o protótipo do kit =====
 * Decisão do usuário: corta-se desta página tudo que não está em
 * `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx`. Saíram:
 * `<ChancesPanel>` (no protótipo é NACIONAL — migrou para `app/page.tsx`),
 * `<InsightCard>`, o `<Panel>` "Volume e estimativa" (`UfMapDuoLazy`), a
 * grade de quadrados (`waffleCandidatos` → `<MunicipioWaffleGrid>`), o
 * `<Panel>` "Regiões" (mesorregiões), o `<Panel>` "Forecast" (`<Needle>`) e o
 * `<Panel>` "Ao longo da noite" (os três charts).
 *
 * Duas exceções que NÃO são cortadas apesar de não estarem no protótipo:
 * `<ForecastTransparency>` (constituição § 8 — toda página com projeção) e
 * `<Footer>` (constituição § 1 — "Não oficial. Fonte: TSE.").
 *
 * ===== 2026-09-09 — a projeção vira o `<ResultPanel>` do kit (decisão D23) =====
 * Espelho exato da rota presidencial de UF, pelo mesmo motivo: com o shell de
 * duas colunas (ADR-0033 § 1) a coluna de painéis mede `--container-sidebar`
 * (400px), e os seis termômetros do ADR-0018 — desenhados para a página
 * inteira — sobrepunham os próprios números e truncavam os rótulos ali dentro.
 * O painel que entra é o MESMO componente da home
 * (`components/blocks/ResultPanel.tsx`), não uma variante.
 *
 * Saíram: `<UFBreadcrumb>` (RF-031), `<WinnerBanner>` (RF-032),
 * `<TrilhaKicker>` (ADR-0019), `<ProjectionThermometers>` (ADR-0018), as duas
 * `<Figure>` "Apurado"/"Última atualização" e a `<section
 * aria-labelledby="candidates-heading">` montada à mão — as três últimas
 * porque o `<ResultPanel>` as resolve.
 *
 * Consequência declarada: brancos, nulos e abstenção saem DESTA TELA. O dado
 * segue em `EdgePayloadUf.participacao` e o bloco continua íntegro em
 * `/governador`, onde o ADR-0022 o torna obrigatório. Isto emenda de fato o
 * ADR-0018 nesta rota; a formalização é trabalho de `adr-author`.
 *
 * Ficam, contra o protótipo e por regra de nível mais alto:
 * `<MunicipioExplorer>`/`<MunicipioTable>` (constituição § 4 — lista textual
 * paralela ao mapa municipal), `<ForecastTransparency>` (§ 8) e `<Footer>`
 * (§ 1).
 *
 * A rota é pré-renderizada estática (27 UFs): nada aqui pode ler
 * `searchParams`, `cookies()` ou `headers()`.
 *
 * ISR: cadência 60s (ADR-0011).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TurnoBadge } from "@/components/atoms/badges/TurnoBadge";
import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { SerieApuracaoChart } from "@/components/atoms/charts/SerieApuracaoChart";
import {
  DetailFreshness,
  DetailUnavailable,
  type DetailUnavailableReason,
} from "@/components/atoms/surfaces/DetailUnavailable";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { CorridaTresCirculos } from "@/components/blocks/CorridaTresCirculos";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { MunicipioExplorer } from "@/components/blocks/MunicipioExplorer";
import type { MunicipioRow } from "@/components/blocks/MunicipioTable";
import { ResultPanel } from "@/components/blocks/ResultPanel";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import { Footer } from "@/components/layout/Footer";
import {
  municipiosFrom,
  readUfDetail,
  seriePorCandidatoFrom,
  type UfDetailResult,
} from "@/lib/blob/uf-detail";
import { avaliarFrescorDado } from "@/lib/config/dado-freshness";
import { isPreEleicao } from "@/lib/config/fase";
import {
  resultadoEleitoral,
  simulacaoGovernadorUf,
  simulacaoLigada,
  simulacaoMunicipiosUf,
  simulacaoNacional,
} from "@/lib/dev/simulacao";
import { readProjection, readUfProjection } from "@/lib/edge-config/reader";
import type {
  EdgePayload,
  EdgePayloadUf,
  EdgeUfCandidate,
  EdgeUfMunicipio,
} from "@/lib/edge-config/types";
import { primeiroNomeExibicao } from "@/lib/utils/nome-candidato";
import govFixture from "@/tests/fixtures/edge-config/gov-current.json" with { type: "json" };

export const revalidate = 60;

/** Título do painel de resultado — e o `<h1>` da página (ADR-0029 § 5). */
function ResultTitle({ sigla }: { sigla: string }) {
  return (
    <>
      <span data-view-only="parcial">Governador {sigla} — Resultado parcial</span>
      <span data-view-only="proj">Governador {sigla} — Projeção Atlas Menna</span>
    </>
  );
}

// 27 UFs — mesma lista canônica da rota presidencial.
const UFS_BRASIL = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

export function generateStaticParams() {
  return UFS_BRASIL.map((sigla) => ({ sigla }));
}

interface UFGovernadorPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFGovernadorPageProps): Promise<Metadata> {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();
  const title = `Governador ${sigla} — Apuração 2026 | AtlasMenna`;
  const description = `Apuração da corrida estadual de governador em ${sigla} (2026): projeção em tempo real, mapa de municípios, agregação por mesorregião.`;
  return {
    alternates: { canonical: `/uf/${sigla}/governador` },
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      siteName: "AtlasMenna",
      url: `/uf/${sigla}/governador`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * 2026-09-11 (ADR-0035 D2): `eleitores` e `capital` entram nas linhas. É esta
 * rota que consome `mode="top-by-eleitorado"` — sem os dois campos a tabela
 * caía no estado "eleitorado não publicado" e não listava município nenhum.
 * Ambos seguem opcionais: Blob antigo (pré-migration 0006) continua válido, e
 * `capital` é emitido só quando `true` (ausência == não é capital).
 */
function toMunicipioRows(
  municipios: EdgeUfMunicipio[],
  candidateColor: Record<number, string>,
  candidateShortName: Record<number, string>,
): MunicipioRow[] {
  return municipios.map((m) => {
    const liderId = m.lider.candidato_id;
    const totalVotos = Object.values(m.votos_reportados).reduce((a, b) => a + b, 0);
    return {
      cod_ibge: m.cod_ibge,
      nome: m.nome,
      lider: liderId,
      liderCor: candidateColor[liderId] ?? "var(--color-text)",
      liderNome: candidateShortName[liderId] ?? `#${liderId}`,
      margemPp: m.lider.margem_pp,
      pctApurado: m.pct_apurado,
      votosReportados: totalVotos,
      eleitorado: m.eleitores,
      capital: m.capital,
    };
  });
}

/**
 * O que `detalheLido` vale quando a leitura remota nem roda (modo simulação).
 * Gêmeo do de `app/(pres)/uf/[sigla]/page.tsx` — a justificativa está lá.
 */
const SEM_DETALHE_REMOTO: UfDetailResult = {
  status: "unavailable",
  reason: "not_configured",
  url: null,
};

/**
 * Sintetiza um `EdgePayloadUf` de governador a partir da fixture nacional de
 * gov — espelho de `synthesizeUfFromNational` na rota presidencial. Só roda
 * fora de produção e só quando o reader devolve null (dev/preview sem
 * `EDGE_CONFIG`), para a página renderizar completa em `pnpm dev`.
 */
function synthesizeGovUfFromFixture(sigla: string, fixture: EdgePayload): EdgePayloadUf | null {
  const row = fixture.por_uf.find((u) => u.sigla === sigla);
  if (!row) return null;

  /*
   * 🔴 A IDENTIDADE sai de `row.top_candidatos`, os NÚMEROS saem do nacional.
   *
   * Os dois lados desta síntese respondem a perguntas diferentes, e trocá-los é
   * o defeito que o RF-145 descreve. `fixture.national.candidatos`, em cargo 3,
   * é a **união de 27 corridas** sob o mesmo espaço de `id` — por isso ele não
   * carrega `sqcand` por contrato, e por isso o nome que ele guarda para um
   * `id` é "o número N nalguma UF", não uma pessoa. `row.top_candidatos[]` é
   * resolvido pelo par `(uf, numero)` lá no orchestrator: ele já sabe de que
   * estado é, e traz `nome`, `partido` e `sqcand` do MESMO registro.
   *
   * É por isso que os três vêm juntos daqui, e não só o `sqcand`: casar um
   * `sqcand` de uma fonte com um nome de outra é o que poria o rosto de uma
   * pessoa ao lado do nome de outra no dia em que dois estados colidissem num
   * `id`. É a mesma regra — e o mesmo motivo — do `<GovernorCard>`.
   *
   * Sem a linha da UF, nada é inventado: cai no nacional para nome e partido
   * (payload pré-018) e fica **sem foto**, que é o estado honesto.
   */
  const identidadeDaUf = new Map((row.top_candidatos ?? []).map((t) => [t.id, t] as const));
  const candidatos: EdgeUfCandidate[] = fixture.national.candidatos
    .filter((c) => identidadeDaUf.has(c.id))
    .map((c) => {
      const daUf = identidadeDaUf.get(c.id);
      return {
        id: c.id,
        nome: daUf?.nome ?? c.nome,
        partido: daUf?.partido ?? c.partido,
        // `cor` não é repassada: o campo saiu do payload em 19/09 (paleta por
        // COLOCAÇÃO, ADR-0013). Quem desenha resolve pela SIGLA.
        votos_atuais: c.votos_atuais,
        votos_projetados: c.votos_projetados,
        pct_atual: c.pct_atual,
        pct_projetado: c.pct_projetado,
        ci95: { lower: c.pct_projetado_lower, upper: c.pct_projetado_upper },
        // Só quando existe. `sqcand: undefined` explícito é uma chave presente
        // valendo "não sei", e um consumidor futuro que teste `"sqcand" in c`
        // leria isso como "tem".
        ...(daUf?.sqcand ? { sqcand: daUf.sqcand } : {}),
        // ADR-0053 / RF-213 — destino SÓ da linha DA UF (é a corrida daquele
        // estado). Nunca cai no nacional: desde 2026-09-27 as listas não
        // emitem `"valido"`, então ausente aqui é "compete" e não pode deixar
        // passar o valor da união de 27 corridas. Ausente ⇒ sem chave.
        ...(daUf?.destino ? { destino: daUf.destino } : {}),
      };
    });
  if (candidatos.length === 0) return null;

  return {
    uf: sigla,
    ts: fixture.ts,
    cargo: 3,
    turno: fixture.turno,
    pct_apurado: row.pct_apurado,
    candidatos,
    // Dev-only. Desde os cortes de 09/09 esta rota não tem mais consumidor
    // para `participacao` (os termômetros do ADR-0018 saíram); o campo
    // permanece porque `EdgePayloadUf` o declara e a fixture sintetizada deve
    // ter a mesma forma do payload real.
    participacao: fixture.national.participacao,
    needle_position: 0.3,
    needle_band: "lean_a",
  };
}

/**
 * Motivo do estado "detalhe indisponível" da seção de municípios, ou `null`
 * quando há detalhe. Espelha a função homônima da rota presidencial: fonte que
 * não respondeu (`result.reason`) e detalhe vazio (`"empty"`) são notícias
 * diferentes, e nenhuma das duas esconde o bloco (ADR-0032 item 3 / ADR-0017).
 */
function municipioDetailReason(
  result: UfDetailResult,
  quantidade: number,
): "not_configured" | "not_found" | "fetch_error" | "invalid" | "empty" | null {
  if (result.status !== "ok") return result.reason;
  return quantidade === 0 ? "empty" : null;
}

/* O `govBreadcrumb()` saiu em 2026-09-09 (D23) junto com o `<UFBreadcrumb>`:
 * o protótipo não tem breadcrumb, e a volta para a grade das 27 corridas fica
 * com o `<CargoTabs>` do shell. */

export default async function UFGovernadorPage({ params }: UFGovernadorPageProps) {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();

  if (!UFS_BRASIL.includes(sigla as (typeof UFS_BRASIL)[number])) {
    notFound();
  }

  // Os DOIS read paths, em paralelo (ADR-0032 item 3): resumo no Global Config,
  // detalhe municipal + séries no Vercel Blob. Nunca em série — a página não
  // espera o Blob para renderizar o resumo, e os dois falham independentemente.
  //
  // cargo=gov, turno=1 default (orchestrator alterna pra turno=2 via chave
  // dinâmica em S07). Os mesmos qualificadores nomeiam a chave do Global Config
  // e o caminho do Blob.
  // 🔴 Simulação ligada ⇒ nenhuma leitura remota roda. Ver a nota longa em
  // `app/(pres)/uf/[sigla]/page.tsx`: o Blob responde `ok` com lista vazia e
  // ganhava da simulação, porque uma resposta vazia é uma resposta.
  const emSimulacao = simulacaoLigada();
  const [payloadDoStore, detalheLido] = emSimulacao
    ? [null, SEM_DETALHE_REMOTO]
    : await Promise.all([
        readUfProjection(sigla, { cargo: "gov", turno: 1 }),
        readUfDetail(sigla, { cargo: "gov", turno: 1 }),
      ]);
  let payload = payloadDoStore;

  // Detalhe municipal só sob `FIXTURE_VARIANT=sim`. Com o modo desligado,
  // `detalhe` é exatamente `detalheLido` e esta rota continua sem fallback de
  // dev para o Blob.
  const detalheSim = emSimulacao ? simulacaoMunicipiosUf(sigla, "gov", 1) : null;
  const detalhe: UfDetailResult = detalheSim
    ? { status: "ok", detail: detalheSim, url: "simulacao://dev" }
    : detalheLido;

  /**
   * Spec 020 (RF-168 a RF-171) — a série por candidatura desta corrida, do
   * MESMO `readUfDetail` que a seção de municípios consome. Nenhuma leitura
   * nova entra no read path (RNF-002); é por isso que a série de UF mora no
   * Blob e não numa chave de Global Config (ADR-0046 D3).
   *
   * 🔴 Repassada **como veio**: a ordem de `candidatos` é contrato do produtor
   * (ADR-0046 D4 / RF-170c), os `null` são furos e não zeros (RF-175b), e
   * `cadencia_min` é declarada — nunca inferida de `eixo[1] - eixo[0]`.
   *
   * Declarada antes do ramo de espera porque os DOIS ramos a usam: o Blob é
   * lido em paralelo com o resumo e não depende de o resumo existir.
   *
   * Espelha a rota presidencial de UF, como `municipioDetailReason` já espelha.
   */
  const serie = seriePorCandidatoFrom(detalhe);

  /**
   * Por que a série não pode ser desenhada (RF-175). `reason` da leitura é "a
   * fonte não respondeu"; `"sem_serie"` é "respondeu, e o produtor não
   * publicou". Correções opostas — colapsá-las manda quem opera caçar rede
   * quando o que faltou foi publicação.
   */
  const motivoSerie: DetailUnavailableReason =
    detalhe.status !== "ok" ? detalhe.reason : "sem_serie";

  // Só em `pnpm dev`: em teste (NODE_ENV=test) e em produção o caminho
  // "Aguardando dados" continua sendo exercitado de verdade.
  // 🔴 A corrida INTEIRA da UF, antes de qualquer síntese (2026-09-21).
  //
  // `simulacaoGovernadorUf` lê `governador-uf.json`, que traz `candidatos[]`
  // completo — e a própria docstring dele já dizia "tem PRIORIDADE sobre a
  // síntese". A linha que exercia essa prioridade nunca foi escrita: o getter
  // era chamado só por `GET /api/projection?uf=…&cargo=gov`, nunca pela página.
  //
  // O efeito, medido no simulado em 2026-09-21: **/uf/RS/governador mostrava 4
  // das 6 candidaturas** (faltavam PRISCILA VOIGT/UP e REJANE DE OLIVEIRA/PSTU),
  // e a lista NÃO tinha linha "Outros" — a tela afirmava, por omissão, que
  // aquela era a corrida inteira. Não é caso isolado: MG e DF escondiam **7 de
  // 11**, e as 27 UFs paravam em 4, que é `TOP_CANDIDATOS_POR_UF`. Ao mesmo
  // tempo a API servia as 6 para o balão do mapa — duas superfícies do mesmo
  // site discordando sobre quem está concorrendo, que é o defeito da ficha de
  // Senador de 21/09 outra vez, na outra ponta.
  //
  // Espelha `app/(pres)/uf/[sigla]/page.tsx` (`simulacaoUfPresidente`) e o ramo
  // de simulação de `app/(sen)/uf/[sigla]/senador/page.tsx`
  // (`simulacaoSenadorUf`) — Governador era a única das três sem o equivalente.
  //
  // 🔴 Produção nunca teve isso: `build_uf_payloads` (`api/model/project.py`)
  // percorre `ordered` INTEIRO, sem fatiar, e a rota lê o payload em vez de
  // sintetizar. Era lacuna só do modo simulado — e é no simulado que o dono
  // confere, então a lacuna estava exatamente na tela dele.
  if (!payload) payload = simulacaoGovernadorUf(sigla);

  if (!payload) {
    // Origem escolhida por `resultadoEleitoral` — simulação quando ligada, a
    // fixture de governador caso contrário, nunca as duas. Com o modo desligado
    // o comportamento é idêntico ao de antes.
    //
    // ⚠️ A síntese continua sendo o ÚLTIMO recurso, e continua incompleta por
    // construção: ela filtra `national.candidatos` por `row.top_candidatos`, que
    // é `ordered[:4]` (+ resgate do RF-190). Ela recorta a UF certa — cada
    // candidatura a governador só existe num estado, ao contrário da cédula
    // presidencial, que é a mesma nos 27 —, mas recorta só o pódio. Só roda
    // quando não há nem payload real nem `governador-uf.json`.
    const nacional = await resultadoEleitoral(
      () => simulacaoNacional("gov"),
      () =>
        process.env.NODE_ENV === "development" ? (govFixture as unknown as EdgePayload) : null,
    );
    if (nacional) payload = synthesizeGovUfFromFixture(sigla, nacional);
  }

  if (!payload) {
    // RF-149 — cargo 3 nesta UF: a corrida é estadual, e a fatia também.
    // 🔴 Spec 020 (RF-174d) — a fase vem do payload NACIONAL desta corrida
    // (`projection-current-gov-t1`, uma das chaves que o semeador grava), pelo
    // ponto único `isPreEleicao`. Nunca por data de calendário: `revalidate`
    // congela o relógio no build.
    //
    // Lida **só aqui**, no ramo que não consegue responder sozinho: esta rota
    // não tem payload próprio em fase pré, porque o semeador nunca escreve
    // chave de UF (`data-pipeline/projection-seed.ts` § chavesDeDestino).
    //
    // **Custo: zero hop a mais.** O ramo já esperava por `CandidaturasAguardando`;
    // a leitura entra no MESMO `Promise.all` e cabe dentro daquela espera. O
    // caminho com dado não ganha leitura nenhuma (RNF-002).
    const [grade, nacional] = await Promise.all([
      CandidaturasAguardando({ cargo: 3, uf: sigla }),
      readProjection({ cargo: "gov", turno: 1 }),
    ]);

    // Ponto ÚNICO de fase desta rota (RF-153 / RF-174d).
    const preNacional = isPreEleicao(nacional);

    return (
      <main
        data-trilha="gov"
        className="mx-auto flex min-h-screen max-w-page flex-col px-5 py-6"
        style={{ gap: "var(--space-6)" }}
      >
        <div>
          <h1 className="mt-4 text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
            Governador {sigla} — Aguardando dados
          </h1>
          <p
            className="mt-2 text-sm"
            data-testid="uf-gov-aguardando"
            style={{ color: "var(--color-text-muted)" }}
          >
            A projeção para esta corrida começa quando o TSE divulgar os primeiros boletins.
          </p>
        </div>

        {/* Acrescentar, nunca substituir: a grade entra DEPOIS do parágrafo. */}
        {grade}

        {/* Spec 020 (RF-174, RF-175) — o bloco também vive neste ramo, e é
            aqui que ele separa "a eleição ainda não começou" de "não sabemos",
            que o parágrafo de espera acima funde num texto só.

            🔴 A ORDEM das perguntas é o contrato do design § 6, e ela começa
            pela fase: antes de 04/10 o Blob legitimamente não tem série, e
            perguntar ao Blob primeiro trocaria "ainda não é hora" por "a fonte
            não respondeu" em todos os dias que antecedem a eleição. */}
        <Panel kicker="Evolução da apuração">
          {serie || preNacional ? (
            <SerieApuracaoChart
              cadenciaMin={serie ? serie.cadencia_min : 5}
              candidatos={serie ? serie.candidatos : []}
              eixo={serie ? serie.eixo : []}
              escopo={`Governador ${sigla}`}
              preEleicao={preNacional}
              titleId="serie-apuracao-heading"
            />
          ) : (
            <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
          )}
        </Panel>

        <Footer />
      </main>
    );
  }

  // ADR-0038 D4 — frescor do DADO desta UF, do servidor, a partir do `dado_ts`
  // que já veio no payload. Cargo do payload, não literal: o limiar é por
  // cargo (D3) — aqui, os mesmos 180 s do Presidente, porque Governador
  // compartilha a cadência de 60 s do ADR-0011.
  const frescorDado = avaliarFrescorDado(payload.dado_ts, payload.cargo);

  // 🔴 A cor sai da SIGLA (ADR-0024), não de `c.cor` — a paleta por COLOCAÇÃO
  // do ADR-0013, que o produtor parou de emitir em 19/09.
  //
  // 🔴 **`candidateMarkerColor`, nunca `candidateColor`** — este mapa tem UM
  // destino, e ele é TEXTO: `MunicipioRow.liderCor`, que `<MunicipioTable>`
  // usa como `color:` da coluna "Margem" ("PT +12,3%"). Ver a nota do campo
  // em `components/blocks/MunicipioTable.tsx`. A variante de preenchimento
  // reprovava o piso de 4,5:1 da constituição § 4 / RNF-022 em 14 das 31
  // siglas — pior caso PSOL 2,08:1 sobre a página, e "outros" (o destino de
  // toda FEDERAÇÃO) 2,39:1. Gate executável:
  // `tests/unit/design-system/municipio-contraste.test.tsx`.
  //
  // O coroplético municipal NÃO lê este mapa — ele monta o seu em
  // `components/layout/PersistentMapFrame.tsx` (preenchimento de polígono ⇒
  // cor-base) e pinta o balão com `textForParty`. As duas superfícies seguem
  // coerentes porque a MATIZ é a mesma; só a luminância muda, que é
  // exatamente o que o § 2 permite variar.
  const candidateColor: Record<number, string> = {};
  const candidateShortName: Record<number, string> = {};
  payload.candidatos.forEach((c) => {
    candidateColor[c.id] = candidateMarkerColor(c.partido);
    // Primeiro nome do nome de EXIBIÇÃO. Este mapa alimenta a coluna
    // "margem" da tabela de municípios e o rótulo curto do mapa; cortar o cru
    // poria "RONALDO" na tabela e "CAIADO" no painel da mesma página.
    candidateShortName[c.id] = primeiroNomeExibicao(c.nome, c.sqcand);
  });

  // Detalhe do Blob. Coalesce para vazio; o estado explícito é decidido abaixo.
  const municipios = municipiosFrom(detalhe);
  const municipioReason = municipioDetailReason(detalhe, municipios.length);

  const municipioRows = toMunicipioRows(municipios, candidateColor, candidateShortName);

  // O dispatch `binary` | `multi-1t` saiu com os termômetros (D23): o
  // `<ResultPanel>` é o mesmo nos dois turnos — em 2T a lista tem duas linhas.

  return (
    <main
      data-trilha="gov"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* ADR-0038 D4/D5 — o SEGUNDO sinal de frescor desta página, e o
          primeiro que mede o TSE. Alimentado pelo `dado_ts` do `EdgePayloadUf`
          desta UF (cru, sem `??`), e deliberadamente separado do
          `<DetailFreshness>` lá embaixo: aquele compara dois relógios de
          ESCRITA (o Blob ficou para trás do resumo) e segue correto para o que
          mede. Causas diferentes, frases diferentes.

          `escopo="uf"` porque este `dado_ts` é o DESTA UF (D2: a ingestão
          degrada regionalmente sem o nacional acusar nada). O único relógio
          vivo no cliente é o nacional, que a moldura do mapa publica a cada
          60 s — e ele é o `max` sobre todos os pares, logo nunca mais velho que
          o desta UF. O banner sabe usá-lo só no sentido em que isso é válido:
          nacional parado ⇒ esta UF parada (acende); nacional fresco não prova
          nada sobre a UF (não apaga o aviso que o servidor já deu). */}
      <DadoParadoBanner frescor={frescorDado} escopo="uf" />

      {/* O coroplético "{sigla} · quem lidera cada município" (RF-034) MUDOU
          DE ENDEREÇO em 2026-09-09 (map-builder): não vive mais aqui — vive
          na coluna do mapa (`<PersistentMapFrame>`, ADR-0033 § 1), que agora
          desce para o nível município quando a rota é de UF (nas duas
          corridas, Presidente e Governador). Manter os dois seria duplicação
          — o conteúdo desta seção não tinha nada além do mapa e do aviso de
          indisponível, e os dois migraram juntos. */}

      {/* O disclaimer de K-1 (ADR-0015) foi REMOVIDO em S07/Fase 5. O ADR-0021
          supersede o ADR-0015: a projeção não usa mais 2022 como insumo, então
          não existe "bloco político sem mapeamento histórico" — o caminho de
          código que alimentava esse banner é morto desde a Fase 1. Manter o
          texto seria descrever ao leitor um modelo que não roda (constituição
          § 8 v1.2). `model_fallback_tier` segue no schema como @deprecated,
          sem consumidor. */}

      {/* Seção 1 — a projeção, no `<ResultPanel>` do kit (o MESMO componente
          da home e da rota presidencial de UF). Primeiro conteúdo da coluna de
          painéis, e por isso com o filete duplo padrão do `<Panel>`: o
          `rule="none"` da home existe porque lá o `<TrilhaKicker>` desenha o
          filete, e aqui ele saiu (D23). */}
      {/* 🔴 `ufDaFoto` é a UF da CORRIDA. Aqui ela é o estado, porque a
            corrida é estadual e é sob a sigla dele que o importador gravou as
            fotos (`candidatos/foto/<UF>/<sqcand>.jpg`, ADR-0041). O default do
            painel é `"BR"`, que é o certo só para Presidente — deixá-lo valer
            aqui montaria uma URL sintaticamente válida que devolve 404 no
            navegador do leitor, sem nenhum erro do lado do servidor. */}
      <ResultPanel
        action={<TurnoBadge turno={payload.turno} />}
        // 🔴 Sem `rankByParcial` aqui desde 2026-09-20: o `<ResultPanel>`
        // deriva as DUAS ordens (parcial e projeção) e a cascata escolhe a da
        // base ativa. Entregar uma ordem só voltaria a congelar a lista numa
        // base — que é o defeito que a mudança corrigiu.
        candidatos={payload.candidatos}
        headingLevel={1}
        kicker="Projeção Atlas Menna · não oficial"
        note="Projeção por regra de três: votos apurados ÷ % apurado em cada município, somados na UF."
        pctApurado={payload.pct_apurado}
        title={<ResultTitle sigla={sigla} />}
        titleId="resultado-heading"
        ufDaFoto={sigla}
      />

      {/* Spec 022 (RF-200/201) — "A corrida" da UF em três círculos,
          imediatamente depois do `<ResultPanel>` e ANTES do "Votação" (dono,
          2026-09-27). Uma corrida só ⇒ fatias por
          CANDIDATURA, com o nome cruzado por `id` em `payload.candidatos`.
          ⚠️ O payload sintetizado em desenvolvimento não traz `votacao` e cai
          em `<DetailUnavailable>` (RF-207) — não quebra. */}
      <CorridaTresCirculos
        kicker={`Governador · ${sigla}`}
        modo="candidatura"
        votacao={payload.votacao}
        candidatos={payload.candidatos}
        titleId="corrida-tres-circulos-heading"
      />

      {/* Spec 021 RF-192 (EMENDADO em 2026-09-26, noite, decisão do dono) —
          "Votação" DA UF: o eleitorado deste estado em três círculos, logo
          depois de "A corrida" (ordem invertida pelo dono em 2026-09-27). `payload.votacao`
          é o agregado da UF (spec 022 RF-209); `projetada` sai da
          participação projetada DA UF, nunca da nacional.
          Payload sem `votacao` (fallback sintético em desenvolvimento, ou UF
          sem agregado) ⇒ `<DetailUnavailable>` (RF-198) — não quebra. */}
      <VotacaoEleitorado
        kicker={`Governador · ${sigla}`}
        votacao={payload.votacao}
        titleId="votacao-uf-heading"
      />

      {/* Seção 1b — spec 020 (RF-174): a evolução da apuração, no slot T-04
          (entre o painel de resultado e o de municípios). Nunca acima do
          painel: o `<h1>` da página vive nele.

          Fase 2 — a série vem de `serie`, resolvida a partir do MESMO
          `readUfDetail` que a seção de municípios consome logo abaixo. Sem
          série o bloco continua no DOM e diz POR QUE ela falta (RF-175).

          🔴 `preEleicao={false}` é DECISÃO, não esquecimento — mesma razão da
          rota presidencial de UF. Chegar aqui significa que existe payload
          desta UF, e payload de UF só nasce do orchestrator: o semeador da
          fase pré grava apenas as chaves NACIONAIS. Perguntar a fase neste
          ramo custaria uma leitura por render para receber sempre a mesma
          resposta (RNF-002). Quem precisa da pergunta é o ramo de espera, e é
          lá que ela é feita. */}
      <Panel kicker="Evolução da apuração">
        {serie ? (
          <SerieApuracaoChart
            cadenciaMin={serie.cadencia_min}
            candidatos={serie.candidatos}
            eixo={serie.eixo}
            escopo={`Governador ${sigla}`}
            preEleicao={false}
            titleId="serie-apuracao-heading"
          />
        ) : (
          <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
        )}
      </Panel>

      {/* Seção 2 — os municípios, ligados à folha do município (`<Sheet>`).
          Era o `BiggestPanel` do protótipo (`App.jsx:353`).

          A grade de quadrados (`<MunicipioWaffleGrid>` via `waffleCandidatos`)
          saiu em 2026-09-08: não existe no protótipo. A tabela permanece — e
          era ela, não a grade, o caminho acessível para abrir cada município.

          🔴 **2026-09-20** — o título "Maiores colégios eleitorais" e o
          `tableMode="top-by-eleitorado" topN={8}` saíram JUNTOS, e é a mesma
          mudança: a lista deixou de ser um corte de 8 e passou a ser a lista
          inteira, paginada (20 + 40 por toque), ordenada por eleitorado. Ela
          ainda ABRE pelos maiores colégios — mas não termina neles, e um
          título afirmando o contrário passaria a mentir a partir do primeiro
          "mostrar mais". O `<h3>` da própria tabela ("Municípios (645)") é
          agora o único cabeçalho da seção, igual nas três rotas de estado.

          O `<Panel>` não some quando não há município: a fonte é o Vercel Blob
          (ADR-0032), que falha independentemente do resumo, e um bloco ausente
          diria "não existe" onde a verdade é "não chegou". */}
      <Panel kicker="Municípios">
        {municipioReason === null ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            {detalhe.status === "ok" && (
              <DetailFreshness ts={detalhe.detail.ts} resumoTs={payload.ts} />
            )}
            <MunicipioExplorer
              ufSigla={sigla}
              municipios={municipios}
              rows={municipioRows}
              candidatos={payload.candidatos}
            />
          </div>
        ) : (
          <DetailUnavailable label="O detalhe por município" reason={municipioReason} />
        )}
      </Panel>

      {/* Seção 3 — transparência metodológica (RF-043). Constituição § 8
          exige o bloco em toda página com projeção — fica mesmo não estando
          no protótipo. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={payload.pct_apurado} variant="uf" />
      </Panel>

      <Footer />
    </main>
  );
}
