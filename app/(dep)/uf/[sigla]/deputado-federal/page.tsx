/**
 * app/(dep)/uf/[sigla]/deputado-federal/page.tsx — T-12, spec 017.
 *
 * A corrida proporcional de UM estado: quantas cadeiras o estado elege, qual
 * agremiação ficou com cada uma, e quem as ocupa.
 *
 * ## Duas fontes, de propósito — e é isso que cumpre RF-129
 *
 * O **resumo** (apurado, vagas, quociente, cadeiras definidas) vem do payload
 * nacional no Global Config (`EdgeDeputadoUfRow`). O **detalhe** (agremiações,
 * votos, eleitos) vem do Vercel Blob, em `deputado/uf/<SIGLA>.json`
 * (ADR-0026 item 4): é a maior carga do produto, e o limite de 1 MB do Global
 * Config já é dividido por três cargos.
 *
 * As duas leituras vão **em paralelo** e degradam de forma independente. É
 * literalmente a aceitação de RF-129: com o Blob indisponível, a página exibe
 * um estado de detalhe indisponível **e mantém o resumo** (constituição § 7).
 * Se o resumo dependesse do Blob, uma falha de CDN apagaria a página inteira.
 *
 * ## O que esta tela NÃO mostra
 *
 *   - **Suplentes.** O objeto do Blob os carrega (design 017 § D6), e a spec
 *     017 põe a suplência nominal explicitamente fora desta janela. Exibi-los
 *     somaria ~55 nomes a um estado como SP sem responder à pergunta da noite,
 *     que é quem se elegeu.
 *   - **Mapa e municípios.** ⚠️ Corrigido em 2026-09-13: esta linha dizia que
 *     "o cargo 6 é ingerido por UF (ADR-0026 item 1): não há dado municipal
 *     para desenhar". O ADR-0036 inverteu o fato — o cargo 6 lê o par
 *     (município, zona). É a MESMA frase que virou incidente na tela irmã
 *     nesta madrugada (ver `8cd955f`), aqui em docstring em vez de DOM.
 *     A ausência do mapa virou **escopo, não falta de dado**: desenhar o
 *     recorte municipal de uma corrida proporcional é decisão que ninguém
 *     tomou. Razão falsa é pior que nenhuma.
 *   - **2º turno.** `temSegundoTurno: false` na tabela canônica.
 *   - **Líder da corrida.** Não existe: elege-se um conjunto de cadeiras.
 *
 * ## Prosa derivada (design 017 § D8)
 *
 * Nenhum número de vaga, cadeira ou minuto escrito à mão. As vagas do estado
 * saem de `lugares_a_preencher` (RF-124 — nunca constante), a cadência de
 * `atualizacao_min` (RF-128), e nome/slug/granularidade do cargo de
 * `lib/config/cargos.ts`.
 *
 * A rota é pré-renderizada estática (27 UFs): nada aqui pode ler
 * `searchParams`, `cookies()` ou `headers()`.
 *
 * ISR: 60 s (ADR-0011).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { DeputadoMetodologia } from "@/components/blocks/DeputadoMetodologia";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import { Footer } from "@/components/layout/Footer";
import {
  type DeputadoUfAgremiacao,
  type DeputadoUfDetail,
  type DeputadoUfDetailResult,
  ordenarAgremiacoes,
  ordenarCandidatos,
  readDeputadoUfDetail,
} from "@/lib/blob/deputado-uf";
import { cargoInfo } from "@/lib/config/cargos";
import { avaliarFrescorDado, fraseFrescorDado } from "@/lib/config/dado-freshness";
import {
  resultadoEleitoral,
  simulacaoDeputadoNacional,
  simulacaoDeputadoUf,
  simulacaoLigada,
} from "@/lib/dev/simulacao";
import { readDeputadoProjection } from "@/lib/edge-config/reader";
import type { EdgeDeputadoUfRow } from "@/lib/edge-config/types";
import { formatPercent, formatTimeHMS, formatVotes } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { colorForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import depFixture from "@/tests/fixtures/edge-config/dep-current.json" with { type: "json" };

const CARGO_DEPUTADO = 6 as const;
const DEPUTADO = cargoInfo(CARGO_DEPUTADO);

export const revalidate = 60;

// 27 UFs — mesma lista canônica das outras rotas de UF.
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

interface UFDeputadoPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFDeputadoPageProps): Promise<Metadata> {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();
  const title = `${DEPUTADO.label} ${sigla} — Apuração 2026 | AtlasMenna`;
  const description = `Apuração da eleição de ${DEPUTADO.label} em ${sigla} (2026): cadeiras por partido e federação com os votos já contados, votos de legenda e eleitos, em tempo real.`;
  return {
    alternates: { canonical: `/uf/${sigla}/${DEPUTADO.slug}` },
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      siteName: "AtlasMenna",
      url: `/uf/${sigla}/${DEPUTADO.slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

// ---------------------------------------------------------------------------
// Texto do estado indisponível — RF-129 + ADR-0032 item 3
// ---------------------------------------------------------------------------

/**
 * Um 404 numa UF sem boletim não é a mesma notícia que uma falha de rede, e o
 * leitor merece saber qual dos dois é (constituição § 7 e § 8). O bloco
 * **continua no DOM** em todos os casos.
 *
 * ⚠️ Nenhuma destas frases pode afirmar algo sobre a APURAÇÃO — só sobre o
 * detalhe. A primeira versão de `not_found` dizia "este estado ainda não teve
 * boletim publicado", e ela vira falsa na combinação que de fato acontece: o
 * resumo diz 93% apurado (Global Config gravou) e o Blob responde 404 (a
 * gravação do detalhe falhou naquele ciclo). Duas fontes independentes é o que
 * torna a página resiliente — e é o que torna qualquer frase que fale pelas
 * duas uma mentira em potencial. Mesma classe do defeito de 2026-09-11 na tela
 * de Senador.
 */
const MOTIVO_INDISPONIVEL: Record<string, string> = {
  not_found:
    "Ainda não há um detalhe publicado para este estado. A lista de eleitos aparece assim que ele for gravado — o resumo acima vem de outra fonte e continua valendo.",
  not_configured:
    "O armazenamento do detalhe não está configurado neste ambiente. O resumo acima continua válido — ele vem de outra fonte.",
  fetch_error:
    "Não conseguimos buscar o detalhe agora. O resumo acima continua válido — ele vem de outra fonte, e o detalhe volta no próximo ciclo.",
  invalid:
    "O detalhe recebido não bateu com o formato esperado e foi descartado, em vez de exibido. O resumo acima continua válido.",
};

// ---------------------------------------------------------------------------
// Derivações puras
// ---------------------------------------------------------------------------

/**
 * Ver `corDaAgremiacao` na página nacional. Um caminho só: `sigla_lider` já
 * vale a própria sigla em partido isolado (ADR-0024 linha 41, design 017 § D6),
 * e sigla sem token cai em `--party-outros` dentro de `colorForParty`.
 *
 * O líder desta UF pode diferir do líder nacional da mesma federação — é
 * esperado, e é por isso que o campo existe nos dois payloads em vez de um só.
 */
function corDaAgremiacao(agr: { sigla_lider: string }): string {
  return colorForParty(agr.sigla_lider);
}

function listarComponentes(componentes: readonly string[]): string {
  if (componentes.length === 0) return "";
  if (componentes.length === 1) return componentes[0] as string;
  return `${componentes.slice(0, -1).join(", ")} e ${componentes[componentes.length - 1]}`;
}

/**
 * Nome legível do que divergiu.
 *
 * `divergencias[].o_que` é a saída de `conferir_contra_tse`. Desde 2026-09-12 é
 * um **conjunto fechado e documentado** — `"quociente_eleitoral" | "cadeiras"`
 * (`CHAVES_DE_DIVERGENCIA` em `api/model/deputado_payload.py`, design 017 § D6)
 * —, e o código da agremiação vai em `detalhe`, não embutido na chave: a tela
 * não decifra strings do modelo.
 *
 * Imprimir a chave crua entregaria ao leitor um identificador de código, num
 * bloco cuja razão de existir é transparência (constituição § 8): dizer "houve
 * divergência" em jargão é meio caminho para não dizer nada.
 *
 * Chave **fora** do conjunto volta quase inalterada (só o sublinhado vira
 * espaço), de propósito: se o conjunto crescer e ninguém atualizar este mapa, a
 * divergência tem de aparecer feia em vez de sumir. Divergência perdida é pior
 * que divergência sem rótulo bonito.
 */
const ROTULO_DIVERGENCIA: Record<string, string> = {
  quociente_eleitoral: "Quociente eleitoral",
  cadeiras: "Cadeiras da agremiação",
};

function rotuloDivergencia(oQue: string): string {
  return ROTULO_DIVERGENCIA[oQue] ?? oQue.replace(/_/g, " ");
}

function intervaloDeCadeiras(agr: DeputadoUfAgremiacao): string | null {
  const ci = agr.cadeiras_ci95;
  if (!ci) return null;
  const [lo, hi] = ci;
  return lo === hi ? `${lo}` : `${lo} a ${hi}`;
}

/**
 * Fixtures dev-only, espelhando `fixtureUf` de `/uf/[sigla]/senador`.
 *
 * **NUNCA em produção**: todo chamador faz o gate
 * `process.env.NODE_ENV === "development"` antes. A fonte real (Global Config
 * e Blob) é sempre tentada primeiro; isto só entra quando ela já devolveu
 * vazio, e nunca a substitui em silêncio.
 *
 * A fixture do Blob cobre 5 UFs (SP, MG, RJ, RR, AP). As outras 22 caem,
 * mesmo em dev, no estado "detalhe indisponível" — que também precisa ser
 * visto, e é o estado que 22 estados terão na primeira hora da apuração.
 */
/**
 * O que `detalheLido` vale quando a leitura remota nem roda (modo simulação).
 * Gêmeo do de `app/(pres)/uf/[sigla]/page.tsx` — a justificativa está lá.
 */
const SEM_DETALHE_REMOTO: DeputadoUfDetailResult = {
  status: "unavailable",
  reason: "not_configured",
  url: null,
};

function fixtureDetalhe(sigla: string): DeputadoUfDetail | null {
  const mapa = depUfFixture as unknown as Record<string, DeputadoUfDetail>;
  return mapa[sigla.toUpperCase()] ?? null;
}

export default async function UFDeputadoFederalPage({ params }: UFDeputadoPageProps) {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();

  if (!UFS_BRASIL.includes(sigla as (typeof UFS_BRASIL)[number])) {
    notFound();
  }

  // Em paralelo, de propósito: a página não espera o Blob para renderizar o
  // resumo (RF-129, ADR-0032 item 3).
  //
  // 🔴 Simulação ligada ⇒ nenhuma das duas leituras remotas roda. Ver a nota
  // longa em `app/(pres)/uf/[sigla]/page.tsx`: com `BLOB_READ_WRITE_TOKEN` no
  // `.env.local`, `readDeputadoUfDetail` fala com o Blob de PRODUÇÃO, e um
  // `status: "ok"` de bancada vazia ganhava da simulação — uma resposta vazia é
  // uma resposta.
  const emSimulacao = simulacaoLigada();
  const [nacionalLido, detalheLido] = emSimulacao
    ? [null, SEM_DETALHE_REMOTO]
    : await Promise.all([readDeputadoProjection(), readDeputadoUfDetail(sigla)]);

  const isDev = process.env.NODE_ENV === "development";
  const nacional =
    nacionalLido ??
    (await resultadoEleitoral(
      () => simulacaoDeputadoNacional(),
      () => (isDev ? (depFixture as unknown as typeof nacionalLido) : null) ?? null,
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

  const row: EdgeDeputadoUfRow | null =
    nacional?.por_uf.find((u) => u.sigla === sigla.toUpperCase()) ?? null;
  const detail = detalhe.status === "ok" ? detalhe.detail : null;

  // Nem resumo nem detalhe: não há o que dizer sobre este estado ainda.
  if (!row && !detail) {
    // RF-149 — cargo 6 nesta UF. É a maior grade do produto (1.131 candidaturas
    // publicáveis em SP), e é a que mais rende: quem se candidatou a deputado
    // federal pelo estado do leitor é justamente o que não cabe em lugar nenhum
    // da cédula. `<CandidatosGrid>` já cobre o custo com `content-visibility` e
    // `loading="lazy"`, e `/candidatos?cargo=6&uf=SP` já provou o caminho.
    const grade = await CandidaturasAguardando({ cargo: 6, uf: sigla });

    return (
      <main
        data-trilha="dep"
        className="mx-auto flex min-h-screen max-w-page flex-col px-5 py-6"
        style={{ gap: "var(--space-6)" }}
      >
        <div>
          <h1 className="mt-4 text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
            {DEPUTADO.label} {sigla} — Aguardando dados
          </h1>
          <p
            className="mt-2 text-sm"
            data-testid="uf-dep-aguardando"
            style={{ color: "var(--color-text-muted)" }}
          >
            A apuração deste estado começa a aparecer aqui quando o TSE divulgar o primeiro boletim.
            Turno único, sistema proporcional: as cadeiras vão para as agremiações, e só depois são
            ocupadas pelos candidatos mais votados dentro de cada uma.
          </p>
        </div>

        {/* Acrescentar, nunca substituir: a grade entra DEPOIS do parágrafo. */}
        {grade}

        <Footer />
      </main>
    );
  }

  // O resumo prefere o Global Config e cai no Blob — os dois carregam os
  // mesmos quatro números, e sobreviver à falta de um é o ponto de RF-129.
  const pctApurado = row?.pct_apurado ?? detail?.pct_apurado ?? 0;
  const lugares = row?.lugares_a_preencher ?? detail?.lugares_a_preencher ?? null;
  const quociente = row?.quociente_eleitoral ?? detail?.quociente_eleitoral ?? null;
  const cadeirasDefinidas =
    row?.cadeiras_definidas ?? detail?.agremiacoes.reduce((a, x) => a + x.cadeiras, 0) ?? 0;
  const vagasNaoPreenchidas = row?.vagas_nao_preenchidas ?? detail?.vagas_nao_preenchidas ?? 0;
  const agremiacoes = detail ? ordenarAgremiacoes(detail.agremiacoes) : [];
  const cadencia = nacional?.atualizacao_min ?? 0;

  // ── Os relógios desta tela — ADR-0038 D1 ──
  //
  // Até 2026-09-13 havia aqui uma linha só: `nacional?.ts ?? detail?.ts ?? null`,
  // exibida sob o rótulo "Atualizado às". Ela punha num `??` duas coisas
  // **diferentes**: o carimbo de escrita do RESUMO (Global Config) e o do
  // DETALHE (Vercel Blob). São escritas independentes e não atômicas — é
  // literalmente o que o doc-comment de `DeputadoUfDetail.ts` diz, e a razão de
  // o Blob ter `ts` próprio (ADR-0032). Com o `??`, uma tela alimentada só pelo
  // Blob afirmava, com o mesmo rótulo de sempre, uma hora de outra fonte.
  //
  // Agora são dois nomes, duas frases e nenhum `??` entre eles. E o carimbo
  // primário deixou de ser relógio de escrita: é `dado_ts`, a hora do TSE.
  //
  // `frescor` e `ts` viajam no MESMO objeto de propósito: o `ts` só é lido no
  // estado "ausente" (payload pré-ADR), e separá-los em duas variáveis abriria
  // a porta para alguém combinar o frescor de uma fonte com o `ts` da outra —
  // que é o defeito que esta linha acabou de consertar.
  const resumoFrescor = nacional
    ? { frescor: avaliarFrescorDado(nacional.dado_ts, nacional.cargo), ts: nacional.ts }
    : null;
  const detalheTs = detail?.ts ?? null;

  return (
    <main
      data-trilha="dep"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* ADR-0038 D4. Só quando o resumo nacional chegou: sem ele não há
          `dado_ts`, e um banner de "parado" montado sobre a ausência da fonte
          seria alarme fabricado — o estado certo nesse caso é o que a frase do
          detalhe já diz. Limiar de 5.400 s (90 min): três voltas completas das
          6 fatias de 30 min (ADR-0036), nunca três vezes os 5 min entre
          fatias.

          Escopo nacional mesmo numa página de UF, porque o `dado_ts` vem do
          resumo NACIONAL (é o que esta tela carrega) — não do recorte desta UF.
          E, como a trilha `(dep)` não tem moldura de mapa, ninguém publica um
          `dado_ts` vivo para o cargo 6: o veredito segue sendo só o do
          servidor, sem timer. Reavaliar por tempo sem relógio vivo produziria
          alarme falso garantido em toda aba aberta por mais de 90 min. */}
      {resumoFrescor ? <DadoParadoBanner frescor={resumoFrescor.frescor} /> : null}

      {/* Seção 1 — o resumo. Sobrevive à ausência do Blob (RF-129). */}
      <Panel
        kicker="Atlas Menna · apuração ao vivo · não oficial"
        title={`${DEPUTADO.label} ${sigla}`}
        titleId="resumo-heading"
        headingLevel={1}
      >
        <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
          <p
            className="max-w-prose"
            data-testid="uf-vagas-label"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            {/* RF-124 — as vagas vêm do dado publicado. `null` é "o TSE ainda
                não publicou", e dizer isso é melhor que imprimir um número
                plausível de origem desconhecida. */}
            {lugares == null ? (
              <>
                O número de cadeiras que {sigla} elege ainda não foi publicado pelo TSE. Assim que
                vier, ele aparece aqui — não usamos tabela própria para esse número, porque errá-lo
                corromperia todo o cálculo de cadeiras do estado.
              </>
            ) : (
              <>
                <strong>
                  {lugares} {lugares === 1 ? "cadeira" : "cadeiras"}
                </strong>{" "}
                em disputa em {sigla}, em turno único. As cadeiras são ganhas pela agremiação —
                partido ou federação — e só depois ocupadas pelos candidatos mais votados dentro
                dela.
              </>
            )}
          </p>

          <dl
            className="grid"
            data-testid="uf-resumo"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
              gap: "var(--space-4)",
              margin: 0,
            }}
          >
            <ResumoItem rotulo="Apurado" valor={formatPercent(pctApurado)} />
            <ResumoItem
              rotulo="Cadeiras definidas"
              valor={
                lugares == null ? String(cadeirasDefinidas) : `${cadeirasDefinidas} de ${lugares}`
              }
            />
            <ResumoItem
              rotulo="Quociente eleitoral"
              valor={quociente == null ? "—" : formatVotes(quociente)}
              nota="votos que valem uma cadeira"
            />
          </dl>

          {vagasNaoPreenchidas > 0 ? (
            <p
              className="max-w-prose"
              data-testid="uf-vagas-nao-preenchidas"
              style={{
                margin: 0,
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
              }}
            >
              {vagasNaoPreenchidas === 1
                ? "Uma cadeira não foi preenchida"
                : `${vagasNaoPreenchidas} cadeiras não foram preenchidas`}{" "}
              porque a agremiação com direito a ela não tinha candidato com votação suficiente. A
              vaga vai para as sobras.
            </p>
          ) : null}

          {/* Um relógio por frase, e a frase diz de qual fonte ele é. O ramo
              do resumo é o normal; o do detalhe só existe quando o Global
              Config não respondeu e a tela está inteiramente sobre o Blob —
              caso em que dizer "atualizado às" sem dizer "o quê" atribuiria ao
              resumo uma hora que não é dele. */}
          {resumoFrescor ? (
            <p
              data-testid="dep-atualizacao"
              style={{ margin: 0, font: "var(--type-data)", color: "var(--text-muted)" }}
            >
              {fraseFrescorDado(resumoFrescor.frescor, resumoFrescor.ts)}
              {cadencia > 0 ? `, a cada ${cadencia} ${cadencia === 1 ? "minuto" : "minutos"}` : ""}.
            </p>
          ) : detalheTs ? (
            <p
              data-testid="dep-atualizacao"
              style={{ margin: 0, font: "var(--type-data)", color: "var(--text-muted)" }}
            >
              Detalhe deste estado gravado às {formatTimeHMS(detalheTs)}. O resumo nacional não
              chegou neste ciclo.
            </p>
          ) : null}
        </div>
      </Panel>

      {/* Spec 021 RF-192 (EMENDADO em 2026-09-26, noite, decisão do dono) —
          "Votação" DA UF, logo depois do painel de resultado (o resumo, que
          carrega o `<h1>`) e antes da bancada: a mesma posição que o painel
          ocupava na capa nacional de Deputado, de onde saiu. Sem "A corrida":
          a disputa é proporcional (spec 022 RF-200).

          Vem do detalhe da UF no Blob (`DeputadoUfDetail.votacao`). Blob
          indisponível, objeto anterior à emenda ou UF sem agregado ⇒
          `<DetailUnavailable>` (RF-198) — o painel fica no DOM e nunca quebra.
          Hoje o produtor não publica `projetada` para o cargo 6 (o ciclo
          proporcional não calcula participação projetada), então o arco 3 fica
          em "aguardando projeção". */}
      <VotacaoEleitorado
        kicker={`${DEPUTADO.label} · ${sigla}`}
        votacao={detail?.votacao}
        titleId="votacao-uf-heading"
      />

      {/* Seção 2 — a bancada do estado. RF-122, RF-125.1, RF-127, RF-130.
          O bloco NUNCA sai do DOM (ADR-0017): sem o Blob ele diz por quê. */}
      <Panel
        kicker="Bancada do estado"
        title="Cadeiras por agremiação"
        titleId="bancada-uf-heading"
      >
        {detail ? (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            <ul
              data-testid="uf-agremiacoes"
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}
            >
              {agremiacoes.map((agr) => {
                const componentes = listarComponentes(agr.componentes);
                const intervalo = intervaloDeCadeiras(agr);
                const eleitos = ordenarCandidatos(agr.eleitos);
                return (
                  <li
                    key={agr.cod}
                    data-testid="uf-agremiacao"
                    data-cod={agr.cod}
                    style={{
                      padding: "var(--space-4) 0",
                      borderBottom: "1px solid var(--border-hairline)",
                    }}
                  >
                    <div
                      className="grid items-baseline"
                      style={{
                        gridTemplateColumns: "3rem minmax(0, 1fr) auto",
                        columnGap: "var(--space-3)",
                      }}
                    >
                      {/* Rótulo IRMÃO do número — ver a nota gêmea na tela
                          nacional para o porquê de não ser filho. */}
                      <span style={{ font: "var(--type-figure-sm)" }}>
                        <span data-testid="uf-cadeiras">{agr.cadeiras}</span>
                        <span className="sr-only"> cadeiras conquistadas</span>
                      </span>
                      <span className="min-w-0 flex flex-col" style={{ gap: "var(--space-1)" }}>
                        <span
                          className="inline-flex items-center"
                          style={{ gap: "var(--space-2)" }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: corDaAgremiacao(agr),
                              flex: "none",
                            }}
                          />
                          {/* 🔴 Sigla INTEIRA aqui, e ABREVIADA na lista de
                              pessoas logo abaixo (`cand.partido`) — não é
                              incoerência, é a mesma regra aplicada a dois
                              elementos diferentes (2026-09-19).

                              Este é o cabeçalho de uma BANCADA por agremiação:
                              a linha inteira é dele, ninguém disputa largura,
                              e é o elemento idêntico ao que o dono isentou na
                              home de Deputados. Abreviá-lo faria a MESMA peça
                              de interface aparecer de dois jeitos em duas
                              rotas do mesmo cargo.

                              ⚠️ Ponto para o dono confirmar: ele isentou "a
                              home de Deputados", e este cabeçalho está fora
                              dela. A leitura adotada é que a isenção é do
                              CONTEXTO (sigla que rotula bancada), não da URL. */}
                          <span style={{ font: "var(--type-body-sm)" }}>{agr.sigla}</span>
                        </span>
                        <span
                          style={{
                            font: "var(--type-body-sm)",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                            textWrap: "pretty",
                          }}
                        >
                          {/* RF-122 */}
                          {agr.tipo === "federacao" && componentes.length > 0 ? (
                            <span data-testid="uf-federacao">
                              {agr.nome} — federação de {componentes}.{" "}
                            </span>
                          ) : (
                            <span>{agr.nome}. </span>
                          )}
                          {/* RF-130 — legenda nunca somada em silêncio ao nominal. */}
                          <span data-testid="uf-votos">
                            {formatVotes(agr.votos_nominais)} votos nominais e{" "}
                            {formatVotes(agr.votos_legenda)} de legenda —{" "}
                            {formatVotes(agr.votos_validos)} no total,{" "}
                            {formatPercent(agr.pct_votos)} dos válidos. Quociente partidário:{" "}
                            {agr.quociente_partidario}.
                          </span>
                        </span>
                      </span>
                      {/* Ver a nota gêmea na tela nacional. */}
                      <span
                        className="text-right"
                        style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
                      >
                        <span className="sr-only">
                          {intervalo ? "faixa provável: " : "faixa não disponível "}
                        </span>
                        <span data-testid="uf-intervalo">
                          {intervalo ? `${intervalo} cadeiras` : "—"}
                        </span>
                      </span>
                    </div>

                    {eleitos.length > 0 ? (
                      <ol
                        data-testid="uf-eleitos"
                        style={{
                          listStyle: "none",
                          margin: "var(--space-3) 0 0",
                          padding: "0 0 0 3rem",
                          display: "grid",
                          gap: "var(--space-1)",
                        }}
                      >
                        {eleitos.map((cand) => (
                          <li
                            key={cand.sqcand}
                            data-testid="uf-eleito"
                            data-indefinido={cand.indefinido ? "true" : undefined}
                            className="grid items-baseline"
                            style={{
                              gridTemplateColumns: "minmax(0, 1fr) auto",
                              columnGap: "var(--space-3)",
                              font: "var(--type-body-sm)",
                              fontSize: "var(--text-xs)",
                            }}
                          >
                            <span className="min-w-0">
                              {/* `sqcand` aqui é `number` (`DeputadoUfCandidato`),
                                  e a chave editorial é string — daí o `String()`.
                                  Nenhum dos dois nomes da lista é de deputado, mas
                                  a regra objetiva de prefixo é a que importa neste
                                  cargo: são 20 mil candidaturas. */}
                              {nomeExibicao(cand.nome, String(cand.sqcand))}{" "}
                              {/* 🔴 Desenhado ⇒ abreviado (2026-09-19). Esta é
                                  a página de UF de Deputado (`/uf/SP/deputado-federal`),
                                  que lista PESSOAS eleitas numa coluna estreita.
                                  A exceção do dono — "home de Deputados não
                                  abrevia" — é da rota `/deputado-federal`, onde
                                  a sigla rotula uma BANCADA e tem espaço. Rota
                                  diferente, contexto diferente. */}
                              <span style={{ color: "var(--text-muted)" }}>
                                ({siglaExibicao(cand.partido)})
                              </span>
                              {/* RF-127 — firmeza falsa é o defeito a evitar.
                                  A marcação é TEXTO, não só cor (WCAG 1.4.1). */}
                              {cand.indefinido ? (
                                <span
                                  data-testid="uf-eleito-indefinido"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {" "}
                                  — ainda indefinido: esta cadeira saiu de uma rodada de sobra e
                                  pode mudar de mão
                                </span>
                              ) : null}
                            </span>
                            <span
                              className="text-right"
                              style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
                            >
                              {formatVotes(cand.votos)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {detail.empates_indeterminados.length > 0 ? (
              <p
                className="max-w-prose"
                data-testid="uf-empates"
                style={{
                  margin: 0,
                  font: "var(--type-body-sm)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                  textWrap: "pretty",
                }}
              >
                {detail.empates_indeterminados.length === 1
                  ? "Uma cadeira está em empate"
                  : `${detail.empates_indeterminados.length} cadeiras estão em empate`}{" "}
                que os dois critérios de desempate da lei — maior votação total, depois maior
                votação nominal — não resolveram. A norma não prevê sorteio, então não escolhemos:
                fica marcado como indeterminado até a decisão oficial.
              </p>
            ) : null}
          </div>
        ) : (
          <p
            className="max-w-prose"
            data-testid="uf-detalhe-indisponivel"
            data-reason={detalhe.status === "unavailable" ? detalhe.reason : undefined}
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            <strong>Detalhe indisponível.</strong>{" "}
            {(detalhe.status === "unavailable" && MOTIVO_INDISPONIVEL[detalhe.reason]) ??
              "O detalhe desta UF não está disponível agora. O resumo acima continua válido."}
          </p>
        )}
      </Panel>

      {/* Seção 3 — conferência contra o TSE. Constituição § 8: divergência
          aparece; esconder a conferência seria o oposto de transparência. */}
      {detail ? (
        <Panel
          kicker="Conferência"
          title="Os nossos números e os do TSE"
          titleId="conferencia-heading"
        >
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            <p
              className="max-w-prose"
              data-testid="uf-conferencia"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              {detail.divergencias.length === 0
                ? "O quociente eleitoral e a contagem de vagas por agremiação que calculamos batem com os que o TSE publica neste boletim."
                : detail.divergencias.length === 1
                  ? "Há uma divergência entre o que calculamos e o que o TSE publica neste boletim."
                  : `Há ${detail.divergencias.length} divergências entre o que calculamos e o que o TSE publica neste boletim.`}{" "}
              {detail.totalizacao_final
                ? "Este boletim já é a totalização final do estado."
                : "Este boletim ainda não é a totalização final do estado — até lá, pequenas diferenças são esperadas e não indicam erro."}
            </p>

            {detail.divergencias.length > 0 ? (
              <ul
                data-testid="uf-divergencias"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gap: "var(--space-2)",
                }}
              >
                {detail.divergencias.map((d) => (
                  <li
                    key={`${d.o_que}:${d.nosso}:${d.tse}`}
                    style={{
                      font: "var(--type-body-sm)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-muted)",
                      textWrap: "pretty",
                    }}
                  >
                    <strong>{rotuloDivergencia(d.o_que)}</strong>: nosso {formatVotes(d.nosso)}, TSE{" "}
                    {formatVotes(d.tse)}. {d.detalhe}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* Seção 4 — constituição § 8 + design 017 § D9. Ver a nota em
          `Metodologia` (página nacional) para o porquê de este bloco não ser o
          `<ForecastTransparency>` das outras rotas: ele desenharia uma barra
          "Modelo 31,1%" sobre um número em que não há modelo nenhum. */}
      {/* `temDado` é `detail !== null`, não `row !== null`: sem o detalhe do
          Blob não há agremiação nenhuma, e afirmar granularidade aí seria o
          mesmo defeito que a tela nacional publicou em 13/09 — o resumo pode
          ter chegado enquanto o Blob falhou (RF-129), e nesse estado não se
          sabe dizer de onde o voto veio. */}
      <DeputadoMetodologia
        pctApurado={pctApurado}
        cadenciaMinutos={cadencia}
        temDado={detail !== null}
        temIntervalo={agremiacoes.some((a) => a.cadeiras_ci95 !== undefined)}
        variant="uf"
      />

      <Footer />
    </main>
  );
}

/** Um par rótulo/valor do resumo. `<dl>` porque é exatamente isso: termo e definição. */
function ResumoItem({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <dt
        style={{
          font: "var(--type-kicker)",
          letterSpacing: "var(--tracking-caps)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {rotulo}
      </dt>
      <dd style={{ margin: 0, font: "var(--type-figure-sm)" }}>{valor}</dd>
      {nota ? (
        <dd
          style={{
            margin: 0,
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          {nota}
        </dd>
      ) : null}
    </div>
  );
}
