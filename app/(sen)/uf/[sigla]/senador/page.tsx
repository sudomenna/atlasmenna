/**
 * app/(sen)/uf/[sigla]/senador/page.tsx — T-10, spec 016 (Senador).
 *
 * A corrida de Senado de UM estado. Irmã de `/uf/[sigla]/governador`, com
 * três diferenças que não são cosméticas:
 *
 *   1. **Duas vagas.** O `<ResultPanel>` recebe `vagas={payload.vagas}` e,
 *      com isso, marca as duas primeiras linhas como ocupantes de vaga, com
 *      tratamento IDÊNTICO (RF-105) — no resultado não há hierarquia entre
 *      1º e 2º, os dois são senadores —, troca a margem exibida para a do 2º
 *      sobre o 3º (RF-104) e larga a barra de maioria, cujo marcador de 50%
 *      não corta nada nesta corrida.
 *   2. **O municipal chegou tarde, e em duas etapas.** O cargo 5 era ingerido
 *      em granularidade UF (ADR-0026 item 1): existia um boletim por estado e
 *      nenhum por município, e por isso nem mapa municipal nem lista de
 *      municípios existiam aqui. A ingestão passou a ser por ZONA em
 *      2026-09-11 (emenda (b) do ADR-0026), o mapa municipal desta rota entrou
 *      em 2026-09-19, e a **lista de municípios em 2026-09-20**, a pedido do
 *      dono — a mesma `<MunicipioTable>` paginada das outras duas rotas de
 *      estado, com a mesma folha de município no `<Sheet>`.
 *
 *      Até 20/09 esta era a única rota de UF cujo `useMunicipioSheetStore`
 *      tinha escritor (o clique no mapa) e **nenhum leitor**: tocar num
 *      município aqui gravava no store e não abria nada, porque
 *      `<MunicipioExplorer>` — que é quem desenha o `<Sheet>` — não era
 *      montado. Montá-lo resolveu a lista e a gaveta de uma vez.
 *
 *      ⚠️ `spec 016 § Escopo/Fora` ainda diz por escrito que Senador não tem
 *      dado municipal. A spec precisa de emenda.
 *
 *      🔴 **2026-09-18** — esta rota passou a viver dentro de
 *      `app/(sen)/layout.tsx`/`<PersistentMapFrame cargo="sen">` (a mesma
 *      moldura que Presidente/Governador têm, pedido do dono). No nível
 *      BRASIL (`/senador`) a moldura mostra o coroplético por UF; no nível
 *      desta própria página (UF), ela mostra o coroplético municipal desde
 *      19/09. Ver `PersistentMapFrame.tsx`, ramo `cargo === "sen"` com
 *      `sigla` presente.
 *   3. **Sem 2º turno.** `temSegundoTurno: false` na tabela canônica; a
 *      página não monta `<TurnoBadge>` nem alterna turno.
 *
 * ## `p_eleito` e a honestidade do medidor de chance
 *
 * O painel de chances só aparece quando a projeção tem INCERTEZA medida —
 * isto é, quando o IC95 de algum candidato tem largura. Com a ingestão em
 * granularidade UF o bootstrap reamostra uma única unidade e devolve
 * réplicas idênticas: o IC colapsa no ponto e `p_eleito` degenera para 0 ou
 * 1. Exibir "100% de chance" com 6% apurado seria uma afirmação que o modelo
 * não sustenta (constituição § 6 e § 8). Nesse caso a página diz, em texto, o
 * que o modelo sabe e o que não sabe. Ver a nota em
 * `EdgeUfCandidate.p_eleito`.
 *
 * ## Cobertura
 *   - RF-104 (margem da 2ª vaga), RF-105 (duas linhas de vaga), RF-106
 *     ("2 vagas por estado"), RF-108 (nível de estado + 5 min), RF-103
 *     (`p_eleito` no `<ChancesPanel>`).
 *   - ADR-0001, ADR-0026, ADR-0028 (leitura declara `{cargo, turno}`),
 *     ADR-0034 (`<ResultPanel>` como hero), ADR-0017 (nada sai do DOM).
 *
 * A rota é pré-renderizada estática (27 UFs): nada aqui pode ler
 * `searchParams`, `cookies()` ou `headers()`.
 *
 * ISR: 60 s (ADR-0011).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SerieApuracaoChart } from "@/components/atoms/charts/SerieApuracaoChart";
import { UfFlag } from "@/components/atoms/data/UfFlag";
import {
  DetailFreshness,
  DetailUnavailable,
  type DetailUnavailableReason,
} from "@/components/atoms/surfaces/DetailUnavailable";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { ChancesPanel } from "@/components/blocks/ChancesPanel";
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
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import { cargoInfo, vagasDaCorrida } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import { simulacaoLigada, simulacaoMunicipiosUf, simulacaoSenadorUf } from "@/lib/dev/simulacao";
import { readProjection, readUfProjection } from "@/lib/edge-config/reader";
import type { EdgePayloadUf, EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { CATEGORIAS_CHIP } from "@/lib/etiquetas/catalogo";
import { lerEtiquetas } from "@/lib/etiquetas/leitor";
import { etiquetasDaLista } from "@/lib/etiquetas/telas";
import { queCompetem } from "@/lib/utils/destino-voto";
import { nomeExibicao, primeiroNomeExibicao } from "@/lib/utils/nome-candidato";
import { ordensPorBase } from "@/lib/utils/rank-parcial";
import { resolverModoUf } from "@/lib/zerado/majoritario";
import senUfFixture from "@/tests/fixtures/edge-config/sen-uf.json" with { type: "json" };

/** Ver a nota em `app/(sen)/senador/page.tsx`: o fallback sai da tabela
 * canônica, nunca de literal. */
const CARGO_SENADOR = 5 as const;

/**
 * O que `detalheLido` vale quando a leitura remota nem roda (modo simulação).
 * Gêmeo dos de `app/(pres)/uf/[sigla]/page.tsx` e da rota de governador — a
 * justificativa longa está na presidencial.
 *
 * ⚠️ **Atualizado em 18/09**: esta rota passou a ter irmão de
 * `simulacaoMunicipiosUf` — `municipios-sen-t1.json` existe. Este `const`
 * continua sendo o fallback de quando a fixture não traz a UF pedida, e
 * segue valendo o princípio de sempre: cair no estado "indisponível" em vez
 * de pescar o detalhe de outra corrida.
 */
const SEM_DETALHE_REMOTO: UfDetailResult = {
  status: "unavailable",
  reason: "not_configured",
  url: null,
};

export const revalidate = 60;

// 2026-09-29 — `vagasDaCorrida`, sem o `?? 1` de antes: um default de UMA vaga
// aqui marcaria só o líder como eleito se a tabela perdesse o número, em
// silêncio. A tabela diz 2 (renovação de 2/3 em 2026).
const VAGAS_PADRAO = vagasDaCorrida(CARGO_SENADOR);
const CADENCIA_MIN = 5;

/**
 * Spec 022 RF-210 / spec 021 RF-195c — quantos votos cada eleitor dá nesta
 * UF: as vagas em disputa, lidas de `EdgePayloadUf.vagas`. `null` quando o
 * payload não diz, ou diz algo que não é 1 ou 2.
 *
 * 🔴 **Sem default, de propósito — ao contrário de `vagas` logo abaixo, que
 * cai em `VAGAS_PADRAO`.** Lá o default só decide quantas linhas ganham o
 * marcador de vaga; aqui ele decidiria a UNIDADE de três círculos. Supor 2
 * num payload antigo sem o campo ou supor 1 num de Senado dobraria (ou
 * cortaria pela metade) abstenção e eleitorado em silêncio — o tipo de
 * default que já mordeu três vezes (memória `feedback_default_silencioso_enum`).
 * Sem `vagas` confiável, os dois painéis dizem que estão indisponíveis.
 *
 * O teto 2 é o da eleição: 2/3 do Senado (2 vagas) ou 1/3 (1 vaga). Outro
 * número é payload torto, não uma eleição nova.
 */
function votosPorEleitorDe(vagas: unknown): 1 | 2 | null {
  return vagas === 1 || vagas === 2 ? vagas : null;
}

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

interface UFSenadorPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFSenadorPageProps): Promise<Metadata> {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();
  const title = `Senado ${sigla} — Apuração 2026 | AtlasMenna`;
  const description = `Apuração da corrida ao Senado em ${sigla} (2026): duas vagas por estado, projeção em tempo real e margem para a 2ª vaga.`;
  return {
    alternates: { canonical: `/uf/${sigla}/senador` },
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      siteName: "AtlasMenna",
      url: `/uf/${sigla}/senador`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Título do painel de resultado — e o `<h1>` da página (ADR-0029 § 5). */
function ResultTitle({ sigla }: { sigla: string }) {
  return (
    <>
      {/* Bandeira decorativa (`alt=""`), uma só para os dois textos. */}
      <UfFlag sigla={sigla} width={25} height={18} eager inline />
      <span data-view-only="parcial">
        Senado {sigla} — {primeiroTurnoEncerrado() ? "Resultado final" : "Resultado parcial"}
      </span>
      <span data-view-only="proj">Senado {sigla} — Projeção Atlas Menna</span>
    </>
  );
}

/**
 * A projeção tem incerteza MEDIDA? Só então `p_eleito` pode ser lido como
 * "chance".
 *
 * Quando só há UMA unidade de reamostragem, o bootstrap devolve 1.000 réplicas
 * idênticas: o IC95 fecha no ponto e `p_eleito` vira 0 ou 1. O número continua
 * correto como leitura do ponto estimado, mas exibi-lo como probabilidade
 * afirmaria uma certeza que o modelo não tem (constituição § 6).
 *
 * Até 2026-09-11 isso era a REGRA para este cargo, porque a ingestão era por UF
 * (um boletim por estado). Com a ingestão por zona (emenda (b) do ADR-0026), a
 * situação passou a ser TRANSITÓRIA: acontece enquanto só uma zona do estado
 * estiver apurada, e se resolve sozinha. A guarda permanece porque o começo da
 * apuração é exatamente esse momento — e é quando o leitor mais olharia.
 *
 * A largura do IC é o sinal, e vem do próprio payload — nada é recalculado aqui.
 */
function temIncertezaMedida(candidatos: readonly EdgeUfCandidate[]): boolean {
  return candidatos.some((c) => c.ci95.upper - c.ci95.lower > 0);
}

/**
 * Motivo a exibir no estado "detalhe indisponível" da seção de municípios, ou
 * `null` quando há detalhe para mostrar. Gêmeo dos das rotas presidencial e de
 * governador — a justificativa longa está na presidencial.
 */
function municipioDetailReason(
  result: UfDetailResult,
  quantidade: number,
): "not_configured" | "not_found" | "fetch_error" | "invalid" | "empty" | null {
  if (result.status !== "ok") return result.reason;
  return quantidade === 0 ? "empty" : null;
}

/**
 * Converte municípios do payload (`EdgeUfMunicipio`) em linhas da tabela.
 * Terceiro gêmeo dos adaptadores das rotas presidencial e de governador — a
 * corrida muda, o shape do município não.
 *
 * `eleitores` e `capital` são OPCIONAIS no payload e seguem opcionais aqui: um
 * Blob gravado antes da migration 0006 continua válido, e `<MunicipioTable>`
 * manda o município sem eleitorado para o fim da lista em vez de descartá-lo.
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
 * Só em `pnpm dev`: sem `EDGE_CONFIG` a página renderiza a fixture, para que
 * a rota possa ser inspecionada de verdade. Em teste (`NODE_ENV=test`) e em
 * produção o caminho "Aguardando dados" continua sendo exercitado.
 */
function fixtureUf(sigla: string): EdgePayloadUf | null {
  const mapa = senUfFixture as unknown as Record<string, EdgePayloadUf>;
  return mapa[sigla] ?? null;
}

export default async function UFSenadorPage({ params }: UFSenadorPageProps) {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();

  if (!UFS_BRASIL.includes(sigla as (typeof UFS_BRASIL)[number])) {
    notFound();
  }

  // ADR-0028 — cargo e turno explícitos. Senador é turno único.
  //
  // 🔴 Simulação ligada ⇒ ela é a fonte de verdade e **nenhuma** das duas
  // leituras remotas roda — nem o Global Config, nem o Blob. Era o que
  // `resultadoEleitoral` fazia por esta rota até a Fase 2; com dois read paths
  // o portão passa a ser explícito (`simulacaoLigada`), exatamente como nas
  // rotas presidencial e de governador. Adiar as leituras, e não só ignorar o
  // resultado delas, também tira da rota idas à rede que a segurariam à toa.
  //
  // ## Por que o Blob passou a ser lido AQUI (spec 020, Fase 2)
  //
  // Esta rota era a única das três de UF que não lia o Vercel Blob: sem tabela
  // de municípios (spec 016 § Escopo/Fora), nunca houve detalhe a buscar. Mas a
  // série por candidatura do gráfico de evolução mora justamente ali —
  // `UfDetailBlob.series_temporais.por_candidato` (ADR-0046 D3) —, e o
  // `EdgePayloadUf` do Global Config **não** a carrega, de propósito: 27 UF × 3
  // cargos × 6.905 B levariam o store a ~969 KB e a escrita seria RECUSADA na
  // noite de 04/10. Sem esta leitura, a decisão D5 do dono (o gráfico existe
  // onde há UMA corrida — e T-10 é uma delas) e o RF-173 (as duas vagas)
  // ficariam sem dado para sempre nesta tela.
  //
  // 🔴 **Em `Promise.all`, nunca em série.** Os dois read paths falham de forma
  // independente (ADR-0032 item 3) e disparam juntos: a página não espera o
  // Blob para renderizar o resumo, e o custo em tempo de parede é o do mais
  // lento dos dois, não a soma. Dois `await` sequenciais aqui somariam uma ida
  // à rede ao caminho crítico da rota — e é a única diferença entre as duas
  // formas, porque o RESULTADO é idêntico. Mesma forma da rota de governador
  // (`app/(gov)/uf/[sigla]/governador/page.tsx`).
  // 🔴 Até 18/09 o ramo de simulação era `[simulacaoSenadorUf(sigla),
  // SEM_DETALHE_REMOTO]`: esta rota **nunca lia detalhe** em `dev:sim`, e por
  // isso o gráfico de evolução (spec 020) não tinha como aparecer aqui nem
  // com fixture — era a única das quatro rotas sem caminho nenhum para a
  // série. Agora espelha governador e presidencial, que já usavam
  // `simulacaoMunicipiosUf`.
  //
  // `municipios-sen-t1.json` traz série e `municipios: []` (spec 020
  // § Questões em aberto, item 1 — municipal fabricado para as duas corridas
  // levaria as fixtures a ~10 MB). Esta rota não renderiza mapa municipal de
  // qualquer forma, então a lista vazia não muda nada do que se vê aqui.
  const emSimulacao = simulacaoLigada();
  const detalheSim = emSimulacao ? simulacaoMunicipiosUf(sigla, "sen", 1) : null;
  const [lidoUf, detalhe] = emSimulacao
    ? [
        simulacaoSenadorUf(sigla),
        detalheSim
          ? ({ status: "ok", detail: detalheSim, url: "simulacao://dev" } as UfDetailResult)
          : SEM_DETALHE_REMOTO,
      ]
    : await Promise.all([
        (async () =>
          (await readUfProjection(sigla, { cargo: "sen", turno: 1 })) ??
          (process.env.NODE_ENV === "development" ? fixtureUf(sigla) : null))(),
        readUfDetail(sigla, { cargo: "sen", turno: 1 }),
      ]);

  /**
   * Spec 020 (RF-168 a RF-171) — a série por candidatura desta corrida.
   *
   * 🔴 Repassada **como veio**: a ordem de `candidatos` é contrato do produtor
   * (ADR-0046 D4 / RF-170c), os `null` são furos e não zeros (RF-175b), e
   * `cadencia_min` é declarada — nunca inferida de `eixo[1] - eixo[0]`.
   */
  const serie = seriePorCandidatoFrom(detalhe);

  /**
   * Por que a série não pode ser desenhada (RF-175). `reason` da leitura é "a
   * fonte não respondeu"; `"sem_serie"` é "respondeu, e o produtor não
   * publicou". Correções opostas, motivos separados.
   *
   * 🔴 Um Blob ausente **não pode derrubar esta rota**, que viveu sem ele até
   * hoje: `readUfDetail` nunca lança (ver a docstring dela), e tudo o que um
   * `unavailable` produz é este motivo e o bloco em estado explícito.
   */
  const motivoSerie: DetailUnavailableReason =
    detalhe.status !== "ok" ? detalhe.reason : "sem_serie";

  // 🔴 ADR-0076 — modo zerado: chave da UF ausente, fase pré ou lista vazia ⇒
  // o layout da apuração com as candidaturas do cadastro em 0 (ordem sorteada).
  // Leitura que FALHOU nunca entra aqui. Fora da simulação local.
  const { payload, zerado } = emSimulacao
    ? { payload: lidoUf, zerado: false }
    : await resolverModoUf(lidoUf, "sen", 1, sigla, { vagas: VAGAS_PADRAO });
  // 05/10/2026 — 1º turno encerrado: TSE totalizou, a tela é o resultado final.
  const encerrado = primeiroTurnoEncerrado();

  if (!payload) {
    // RF-149 — cargo 5 nesta UF.
    // 🔴 Spec 020 (RF-174d) — a fase vem do payload NACIONAL desta corrida
    // (`projection-current-sen-t1`, uma das chaves do semeador), pelo ponto
    // único `isPreEleicao`. Nunca por data de calendário.
    //
    // Lida só neste ramo: a rota não tem payload próprio em fase pré, porque o
    // semeador nunca escreve chave de UF. **Custo: zero hop a mais** — o ramo
    // já esperava por `CandidaturasAguardando`, e a leitura cabe dentro dessa
    // mesma espera. O caminho com dado não ganha leitura nenhuma (RNF-002).
    const [grade, nacional] = await Promise.all([
      CandidaturasAguardando({ cargo: 5, uf: sigla }),
      readProjection({ cargo: "sen", turno: 1 }),
    ]);

    // Ponto ÚNICO de fase desta rota (RF-153 / RF-174d).
    const preNacional = isPreEleicao(nacional);

    return (
      <main
        data-trilha="sen"
        className="mx-auto flex min-h-screen max-w-page flex-col px-5 py-6"
        style={{ gap: "var(--space-6)" }}
      >
        <div>
          <h1 className="mt-4 text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
            <UfFlag sigla={sigla} width={34} height={24} eager inline />
            Senado {sigla} — Aguardando dados
          </h1>
          <p
            className="mt-2 text-sm"
            data-testid="uf-sen-aguardando"
            style={{ color: "var(--color-text-muted)" }}
          >
            São {VAGAS_PADRAO} vagas por estado, em turno único. A projeção desta corrida começa
            quando o TSE divulgar o primeiro boletim de {sigla}.
          </p>
        </div>

        {/* Acrescentar, nunca substituir: a grade entra DEPOIS do parágrafo. */}
        {grade}

        {/* Spec 020 (RF-174, RF-175) — o bloco vive também neste ramo, onde
            separa "a eleição ainda não começou" de "não sabemos".

            Fase 2 — a série vem do Vercel Blob, lido EM PARALELO com o resumo
            lá em cima (ver a nota longa no topo da função). É por isso que ela
            chega aqui mesmo sem payload de UF: os dois read paths falham de
            forma independente (ADR-0032 item 3), e o Blob pode responder
            enquanto a chave de Global Config ainda não existe.

            🔴 A ORDEM das perguntas é o contrato do design § 6, e ela começa
            pela fase: antes de 04/10 o Blob legitimamente não tem série, e
            perguntar ao Blob primeiro trocaria "ainda não é hora" por "a fonte
            não respondeu" em todos os dias que antecedem a eleição. */}
        <Panel kicker="Evolução da apuração">
          {serie || preNacional ? (
            <SerieApuracaoChart
              cadenciaMin={serie ? serie.cadencia_min : CADENCIA_MIN}
              candidatos={serie ? serie.candidatos : []}
              eixo={serie ? serie.eixo : []}
              escopo={`Senado ${sigla}`}
              preEleicao={preNacional}
              titleId="serie-apuracao-heading"
              vagas={VAGAS_PADRAO === 2 ? 2 : 1}
            />
          ) : (
            <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
          )}
        </Panel>

        <Footer />
      </main>
    );
  }

  // `vagas` vem do payload (que o orchestrator preenche a partir de
  // `lib/config/cargos.ts`); o default cobre payloads gravados antes da spec
  // 016, que não têm a chave.
  const vagas = payload.vagas ?? VAGAS_PADRAO;
  // RF-210 — a unidade dos círculos. SEM o `?? VAGAS_PADRAO` da linha de
  // cima: ver `votosPorEleitorDe`.
  const votosPorEleitor = votosPorEleitorDe(payload.vagas);
  // 🔴 Estas ordens NÃO alimentam mais o `<ResultPanel>` (2026-09-20): o
  // painel deriva as duas sozinho e a cascata escolhe a da base ativa. O que
  // sobrou aqui é o recorte do `<ChancesPanel>` — que **também** passou a
  // acompanhar a base, um turno depois da lista. Enquanto não acompanhava, a
  // lista de cima podia marcar A e B como ocupantes de vaga na visualização
  // "Projeção" enquanto os medidores logo abaixo falavam de B e C: dois
  // blocos vizinhos discordando sobre quem está na disputa.
  //
  // `ordensPorBase` é o ponto único das duas ordenações
  // (`lib/utils/rank-parcial.ts`) — o mesmo que o `<ResultPanel>` usa, para
  // que nunca haja dois critérios de rank nesta página.
  const { parcial: porParcial, proj: porProj } = ordensPorBase(payload.candidatos);
  const incertezaMedida = temIncertezaMedida(payload.candidatos);

  // RF-103 — os `vagas + 1` primeiros são os únicos com chance relevante de
  // mudar de lado. Mostrar os 12 medidores de uma corrida grande enterraria
  // a disputa que importa, que é pela última cadeira.
  //
  // 🔴 O `.filter()` vem DEPOIS do `.slice()`, e isso é decisão: quem está no
  // recorte e não tem `p_eleito` some do painel, e não é substituído pelo
  // próximo colocado. Publicar um medidor de quem o modelo não avaliou — nem
  // que fosse com 0% — seria inventar uma afirmação que o payload não faz.
  // ADR-0053 / RF-213 — só quem DISPUTA entra no elenco das vagas: a
  // anulada já vem no fim de `ordensPorBase`, e o filtro garante que ela não
  // entre nem numa corrida com menos candidaturas que `vagas + 1`.
  const elencoDe = (ordenados: readonly EdgeUfCandidate[]) =>
    queCompetem(ordenados)
      .slice(0, vagas + 1)
      .filter((c): c is EdgeUfCandidate & { p_eleito: number } => c.p_eleito != null)
      .map((c) => ({
        id: c.id,
        // `ChancesPanel.eleitos[].nome` é string e vira o rótulo do medidor —
        // o mesmo nome que o `<ResultPanel>` logo acima imprime na linha.
        nome: nomeExibicao(c.nome, c.sqcand),
        p: c.p_eleito,
        pctProjetado: c.pct_projetado,
      }));
  const eleitosParcial = elencoDe(porParcial);
  const eleitosProj = elencoDe(porProj);

  // Maps de id → cor / nome curto para a tabela de municípios e para a folha.
  // 🔴 A cor sai da SIGLA (ADR-0024), não de `c.cor` — a paleta por COLOCAÇÃO
  // do ADR-0013 parou de ser emitida em 19/09.
  //
  // 🔴 **`candidateMarkerColor`, nunca `candidateColor`** — este mapa tem UM
  // destino, e ele é TEXTO: `MunicipioRow.liderCor`, que `<MunicipioTable>`
  // usa como `color:` da coluna "Margem" ("PT +12,3%"). Ver a nota do campo
  // em `components/blocks/MunicipioTable.tsx`. A variante de preenchimento
  // reprovava o piso de 4,5:1 da constituição § 4 / RNF-022 em 14 das 31
  // siglas — pior caso PSOL 2,08:1 sobre a página, e "outros" (o destino de
  // toda FEDERAÇÃO, o caso mais provável numa corrida de Senado) 2,39:1.
  // Gate executável: `tests/unit/design-system/municipio-contraste.test.tsx`.
  //
  // O coroplético municipal da moldura ao lado NÃO lê este mapa — ele monta o
  // seu em `components/layout/PersistentMapFrame.tsx` (preenchimento de
  // polígono ⇒ cor-base) e pinta o balão com `textForParty`. As duas
  // superfícies seguem coerentes porque a MATIZ é a mesma; só a luminância
  // muda, que é exatamente o que o § 2 permite variar.
  const candidateColor: Record<number, string> = {};
  const candidateShortName: Record<number, string> = {};
  payload.candidatos.forEach((c) => {
    candidateColor[c.id] = candidateMarkerColor(c.partido);
    // Primeiro nome do nome de EXIBIÇÃO — cortar o cru poria "RONALDO" na
    // tabela e outro nome no painel da mesma página.
    candidateShortName[c.id] = primeiroNomeExibicao(c.nome, c.sqcand);
  });

  // Detalhe municipal, do MESMO `readUfDetail` que já trouxe a série lá em
  // cima: nenhuma leitura nova entra no read path (RNF-002).
  const municipios = municipiosFrom(detalhe);
  const municipioReason = municipioDetailReason(detalhe, municipios.length);
  const municipioRows = toMunicipioRows(municipios, candidateColor, candidateShortName);

  // Spec 025 (RF-245/246) — etiquetas editoriais de toda candidatura da lista;
  // no Senado entra também o impeachment de ministros do STF, SEMPRE com a
  // frase qualificada (`EtiquetaEditorial`). Vazio com `chips` desligado.
  const etiquetasDoPainel = etiquetasDaLista(await lerEtiquetas(), payload.candidatos, 5, 1, [
    ...CATEGORIAS_CHIP,
    "impeachment_stf",
  ]);

  return (
    <main
      data-trilha="sen"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* Seção 1 — a projeção, no `<ResultPanel>` do kit (ADR-0034), com a
          gramática de duas vagas ligada por `vagas`. */}
      {/* 🔴 `ufDaFoto` é a UF da CORRIDA. Aqui ela é o estado, porque a
            corrida é estadual e é sob a sigla dele que o importador gravou as
            fotos (`candidatos/foto/<UF>/<sqcand>.jpg`, ADR-0041). O default do
            painel é `"BR"`, que é o certo só para Presidente — deixá-lo valer
            aqui montaria uma URL sintaticamente válida que devolve 404 no
            navegador do leitor, sem nenhum erro do lado do servidor. */}
      <ResultPanel
        candidatos={payload.candidatos}
        etiquetas={etiquetasDoPainel}
        headingLevel={1}
        kicker={encerrado ? "Resultado final · 1º turno" : "Projeção Atlas Menna · não oficial"}
        note={
          zerado || encerrado
            ? `${vagas} vagas por estado, em turno único — as ${vagas} candidaturas mais votadas se elegem, sem diferença entre elas.`
            : `${vagas} vagas por estado, em turno único — as ${vagas} candidaturas mais votadas se elegem, sem diferença entre elas. A margem acima é a distância da ${vagas}ª vaga para a primeira candidatura fora dela. Projeção por regra de três sobre o boletim do estado.`
        }
        pctApurado={payload.pct_apurado}
        // Versão D (2026-09-27) — "Vaga projetada" / "Vaga na parcial".
        selo="vaga"
        title={<ResultTitle sigla={sigla} />}
        titleId="resultado-heading"
        ufDaFoto={sigla}
        vagas={vagas}
        variant={zerado ? "zerado" : "medicao"}
      />

      {/* Spec 021 RF-192 (EMENDADO em 2026-09-26, noite, decisão do dono) —
          "Votação" DA UF: o eleitorado deste estado em três círculos, logo
          depois de "A corrida" (ordem invertida pelo dono em 2026-09-27; os
          dois painéis abaixo vêm na ordem Corrida → Votação). `payload.votacao`
          é o agregado da UF (spec 022 RF-209); `projetada` sai da
          participação projetada DA UF, nunca da nacional.
          ⚠️ Senado: duas vagas, dois votos por eleitor (spec 022 RF-210) —
          os arcos contam VOTOS, com `votosPorEleitor` vindo de `vagas`.
          Se as contagens não fecharem nas identidades do RF-193/194, os
          arcos dizem "não fecha" em vez de desenhar torto.
          Payload sem `votacao` (fallback sintético em desenvolvimento, ou UF
          sem agregado) ⇒ `<DetailUnavailable>` (RF-198) — não quebra. */}
      {votosPorEleitor === null ? (
        // RF-210 — sem `vagas` confiável não há unidade: ver
        // `votosPorEleitorDe`. Mesmo `titleId`, mesmo heading e mesma posição
        // dos painéis de verdade (a ordem das seções é contrato, RF-192/200),
        // com o motivo "invalid": o dado chegou, mas sem o campo que diz como
        // contá-lo.
        <>
          <Panel
            kicker={`Senador · ${sigla}`}
            title="A corrida"
            titleId="corrida-tres-circulos-heading"
            headingLevel={2}
          >
            <DetailUnavailable label="A corrida por candidatura" reason="invalid" />
          </Panel>
          <Panel
            kicker={`Senador · ${sigla}`}
            title="Votação"
            titleId="votacao-uf-heading"
            headingLevel={2}
          >
            <DetailUnavailable label="A votação do eleitorado" reason="invalid" />
          </Panel>
        </>
      ) : (
        <>
          {/* Spec 022 (RF-200/210) — "A corrida", ANTES do "Votação" (dono, 27/09).
              Senado em VOTOS, `votosPorEleitor` por eleitor (decisão do dono,
              27/09): o "aguardando" de 26/09 caiu quando as capturas reais do
              simulado mostraram `tv == 2 × c`. */}
          {zerado ? null : (
            <CorridaTresCirculos
              kicker={`Senador · ${sigla}`}
              modo="candidatura"
              votacao={payload.votacao}
              candidatos={payload.candidatos}
              titleId="corrida-tres-circulos-heading"
              votosPorEleitor={votosPorEleitor}
            />
          )}

          {zerado ? null : (
            <VotacaoEleitorado
              kicker={`Senador · ${sigla}`}
              votacao={payload.votacao}
              titleId="votacao-uf-heading"
              votosPorEleitor={votosPorEleitor}
            />
          )}
        </>
      )}

      {/* Seção 2 — RF-103. O bloco NUNCA sai do DOM (ADR-0017): sem
          incerteza medida ele explica por quê, em vez de sumir ou de
          publicar um 0/1 vestido de probabilidade.

          🔴 Os DOIS elencos vão para o painel (2026-09-20): o do apurado e o
          do projetado. Quando coincidem — o caso comum — o painel emite um
          grupo só e o DOM é o de antes; quando divergem, a cascata de
          `data-view-only` mostra o da base ativa, para que a tela nunca diga
          numa lista que A e B ocupam vaga e no painel de baixo que a disputa
          é entre B e C. O gate aceita qualquer uma das duas não-vazia: se uma
          base tem medidores, o painel tem o que dizer. */}
      {/* 1º turno encerrado: não há "chance" a medir — o resultado é final. */}
      {encerrado ? null : incertezaMedida &&
        (eleitosParcial.length > 0 || eleitosProj.length > 0) ? (
        <ChancesPanel
          eleitos={eleitosParcial}
          eleitosProj={eleitosProj}
          escopo={sigla}
          pctApurado={payload.pct_apurado}
          title="Chances de eleição"
          vagas={vagas}
        />
      ) : (
        <Panel kicker="Modelo Atlas Menna" title="Chances de eleição" titleId="chances-heading">
          <p
            className="max-w-prose"
            data-testid="chances-sem-incerteza"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            Ainda há uma única zona eleitoral apurada neste estado. Com uma só medição, o modelo
            consegue projetar o resultado final, mas não consegue medir o quanto essa projeção pode
            variar — e sem essa medida, publicar uma "chance de eleição" seria dar ao leitor uma
            certeza que o cálculo não sustenta. Assim que a segunda zona for apurada, as chances
            aparecem aqui. Até lá, os percentuais projetados e a margem para a {vagas}ª vaga, acima,
            são o que há de honesto a dizer.
          </p>
        </Panel>
      )}

      {/* Seção 2b — spec 020 (RF-174 + RF-173): a evolução da apuração, no
          slot T-10 (entre o painel de chances e o de metodologia). Nunca
          acima do painel de resultado: o `<h1>` vive nele.

          `vagas` liga o destaque das duas posições que elegem (RF-173) — o
          mesmo número que o `<ResultPanel>` acima usa, lido do payload e não
          de um literal, para que as duas seções nunca discordem sobre quantas
          cadeiras estão em jogo.

          Fase 2 — a série vem do Blob lido em paralelo com o resumo (nota
          longa no topo da função). Sem série o bloco continua no DOM e diz POR
          QUE ela falta: `reason` da leitura quando a fonte não respondeu,
          `"sem_serie"` quando ela respondeu e o produtor não publicou
          (RF-175). Um Blob ausente degrada este bloco e não a página.

          🔴 `preEleicao={false}` é DECISÃO — há payload desta UF, e payload de
          UF só nasce do orchestrator; o semeador da fase pré grava apenas as
          chaves nacionais. A pergunta cara é feita no ramo de espera, acima, e
          só lá (RNF-002). */}
      <Panel kicker="Evolução da apuração">
        {serie || zerado ? (
          <SerieApuracaoChart
            cadenciaMin={serie ? serie.cadencia_min : 5}
            candidatos={serie ? serie.candidatos : []}
            eixo={serie ? serie.eixo : []}
            escopo={`Senado ${sigla}`}
            preEleicao={false}
            zerado={zerado && !serie}
            titleId="serie-apuracao-heading"
            vagas={vagas === 2 ? 2 : 1}
          />
        ) : (
          <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
        )}
      </Panel>

      {/* Seção 2c — os municípios (2026-09-20, pedido do dono). A MESMA
          `<MunicipioTable>` paginada das rotas presidencial e de governador:
          20 maiores colégios eleitorais, +40 por toque.

          Esta seção traz junto a **folha do município** (`<Sheet>`), que é
          desenhada por `<MunicipioExplorer>`. Até hoje o clique num município
          do mapa da moldura ao lado escrevia em `useMunicipioSheetStore` e
          **nada acontecia**, porque nesta rota — só nela — o leitor daquele
          store não era montado. Montar o explorer fecha as duas pontas de uma
          vez.

          O `<Panel>` não some quando não há município: a fonte é o Vercel Blob
          (ADR-0032), que falha independentemente do resumo, e um bloco ausente
          diria "não existe" onde a verdade é "não chegou" (ADR-0017). */}
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
              // 2026-10-03, pedido do dono (mesmo corte do governador): só os
              // 25 maiores colégios eleitorais na lista; o resto abre pelo mapa.
              limiteLista={25}
              // 2026-10-04 (dono) — as MESMAS opções de selo do `<ResultPanel>`
              // acima ("Vaga na parcial" / "Vaga projetada", `vagas` do
              // payload), e os eleitos definidos da linha `por_uf` desta UF.
              cargo="sen"
              selo={{ regra: "vaga", vagas }}
            />
          </div>
        ) : (
          <DetailUnavailable label="O detalhe por município" reason={municipioReason} />
        )}
      </Panel>

      {/* Seção 3 — RF-108 e constituição § 8: o bloco de transparência é
          obrigatório em toda página com projeção. Aqui ele carrega os dois
          fatos que só esta corrida tem: nível de estado e cadência de 5 min. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency
          pctApurado={payload.pct_apurado}
          variant="uf"
          granularidade={payload.granularidade ?? cargoInfo(CARGO_SENADOR).granularidade}
          cadenciaMinutos={CADENCIA_MIN}
        />
      </Panel>

      <Footer />
    </main>
  );
}
