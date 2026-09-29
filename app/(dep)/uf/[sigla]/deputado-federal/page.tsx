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
 * ## Spec 026 (2026-09-29) — listas, marcas, projeção com trava, extras
 *
 * A ordem dos blocos é a da spec 026 § Telas: banner; resumo (com a linha do
 * estado da projeção); Votação; Mais votados em {UF}; Cadeiras e candidatos
 * por agremiação (cabeçalho, corte, puxadores, lista em três faixas, legenda
 * única das marcas); Regras com os números de {UF}; Conferência;
 * metodologia estendida como o bloco § 8; rodapé.
 *
 * O interruptor da projeção é lido AQUI, a cada render, em paralelo com as
 * duas leituras de sempre, e aplicado ao objeto do Blob ANTES de qualquer
 * componente o ver (`aplicarInterruptorProjecao`) — desligar apaga a projeção
 * na próxima requisição, sem esperar a volta de 30 min do cargo (ADR-0063 D4).
 * As marcas saem de `lib/utils/deputado-marcas.ts`, que exige as DUAS leituras
 * (estado `liberada` E interruptor ligado).
 *
 * ## O que esta tela NÃO mostra
 *
 *   - ~~Suplentes~~ — superado pela spec 026: a lista inteira de cada
 *     agremiação vai à tela, em três faixas (ADR-0065), na ordem do voto
 *     apurado. A palavra "suplente" só aparece com a totalização final do TSE
 *     — antes dela, quem não se elegeu na parcial é só a linha seguinte.
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
import { LegendaMarcas } from "@/components/atoms/badges/MarcaDeputado";
import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { DeputadoConferencia } from "@/components/blocks/DeputadoConferencia";
import {
  type CorteCompacto,
  DeputadoListaAgremiacao,
} from "@/components/blocks/DeputadoListaAgremiacao";
import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoMetodologia } from "@/components/blocks/DeputadoMetodologia";
import { LinhaPuxadores } from "@/components/blocks/DeputadoPuxadores";
import { DeputadoRegras } from "@/components/blocks/DeputadoRegras";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import { Footer } from "@/components/layout/Footer";
import {
  aplicarInterruptorProjecao,
  type DeputadoUfAgremiacao,
  type DeputadoUfDetail,
  type DeputadoUfDetailResult,
  maisVotadosDaUf,
  ordenarAgremiacoes,
  readDeputadoUfDetail,
  sanearDeputadoUfDetail,
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
import {
  bitsDasMarcas,
  type ContextoMarcas,
  type ExibicaoLinha,
  fraseCorteCabecalho,
  fraseEstadoProjecao,
  linhasCompactasDoV1,
  marcasDaLinha,
  paraLinhaCompacta,
  projecaoVisivel,
} from "@/lib/utils/deputado-marcas";
import { formatPercent, formatTimeHMS, formatVotes } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { colorForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import depFixture from "@/tests/fixtures/edge-config/dep-current.json" with { type: "json" };

import { lerInterruptorDaTela } from "../../../_interruptor";

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

/*
 * Os rótulos das divergências (`ROTULO_DIVERGENCIA`) moraram aqui até a spec
 * 026 e foram para `components/blocks/DeputadoConferencia.tsx`, junto com as
 * três chaves novas (`eleitos`, `eleitorado`, `votos_validos`). A regra de
 * "chave desconhecida aparece crua, nunca some" foi junto.
 */

function intervaloDeCadeiras(agr: DeputadoUfAgremiacao): string | null {
  const ci = agr.cadeiras_ci95;
  if (!ci) return null;
  const [lo, hi] = ci;
  return lo === hi ? `${lo}` : `${lo} a ${hi}`;
}

/** RF-127 emendado (ADR-0063 D8) — a faixa da projeção, quando medida. */
function intervaloProjetado(agr: DeputadoUfAgremiacao): string | null {
  const ci = agr.cadeiras_projetadas_ci95;
  if (!ci) return null;
  const [lo, hi] = ci;
  return lo === hi ? null : `${lo} a ${hi}`;
}

/** O `corte` do contrato, compacto para o componente cliente. Nunca com totalização final. */
function corteCompacto(agr: DeputadoUfAgremiacao, totalizacaoFinal: boolean): CorteCompacto | null {
  if (!agr.corte || totalizacaoFinal) return null;
  return {
    ultimoEleito: agr.corte.ultimo_eleito,
    primeiroFora: agr.corte.primeiro_fora,
    diferenca: agr.corte.diferenca,
    abaixoPiso10: agr.corte.primeiro_fora_abaixo_piso_10 === true,
  };
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
  // Spec 026 (RF-265): o interruptor da projeção vai JUNTO, em paralelo — e
  // no modo simulado vem do arquivo da simulação, nunca do Edge Config.
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
  // O interruptor é aplicado ao OBJETO antes de qualquer componente vê-lo:
  // desligado, a cópia sai sem nenhum campo de projeção (ADR-0063 D4). O
  // detalhe da simulação/fixture passa pelo mesmo leitor tolerante do Blob.
  const detail =
    detalhe.status === "ok"
      ? aplicarInterruptorProjecao(
          detalhe.url.startsWith("fixture://")
            ? sanearDeputadoUfDetail(detalhe.detail)
            : detalhe.detail,
          interruptor,
        )
      : null;

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

  // ── Spec 026 — marcas, projeção, listas ──
  //
  // `visivel` são as DUAS leituras juntas: o estado que o modelo publicou para
  // a UF e o interruptor lido agora (RF-265). Depois de
  // `aplicarInterruptorProjecao` o estado já diz "indisponivel" com o
  // interruptor desligado; a segunda leitura aqui é a rede de segurança, não
  // a única porta.
  const v2 = detail?.contrato === 2;
  const visivel = projecaoVisivel(detail?.projecao, interruptor.ligada);
  const ctx: ContextoMarcas = {
    totalizacaoFinal: detail?.totalizacao_final === true,
    projecaoVisivel: visivel,
  };
  const temDestino = agremiacoes.some((a) => a.candidatos?.some((c) => c.destino !== undefined));
  const linhasDaUf = agremiacoes.flatMap((a) => a.candidatos ?? []);
  const nomePorSqcand = new Map(
    linhasDaUf.map((c) => [c.sqcand, nomeExibicao(c.nome, String(c.sqcand))] as const),
  );
  const marcasPorSqcand = new Map(
    linhasDaUf.map((c) => [c.sqcand, bitsDasMarcas(marcasDaLinha(c, ctx))] as const),
  );
  const maisVotados = detail
    ? maisVotadosDaUf(detail).map((d) => ({ ...d, marcas: marcasPorSqcand.get(d.sqcand) ?? 0 }))
    : [];
  const movendo = visivel
    ? agremiacoes
        .filter((a) => a.cadeiras_projetadas !== undefined && a.cadeiras_projetadas !== a.cadeiras)
        .map((a) => ({
          sigla: a.sigla,
          parcial: a.cadeiras,
          projetada: a.cadeiras_projetadas ?? 0,
        }))
    : [];
  // A linha do estado da projeção no resumo: só com o interruptor LIGADO. Com
  // ele desligado a projeção não existe na tela fora da metodologia (RF-265),
  // nem como aviso de estado.
  const fraseProjecao =
    detail && interruptor.ligada ? fraseEstadoProjecao(detail.projecao, detail.pct_apurado) : null;

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

          {/* Spec 026 § Telas item 2 — o estado da projeção desta UF. A frase
              inteira num elemento só, com "não oficial" dentro (RF-266). */}
          {fraseProjecao ? (
            <p
              className="max-w-prose"
              data-testid="uf-projecao-estado"
              data-estado={detail?.projecao?.estado}
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              {fraseProjecao}
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

      {/* Spec 026 RF-270 — os 10 mais votados da UF, do próprio objeto da UF
          (nunca da lista 61+). Objeto v1 ⇒ nenhum (o bloco não aparece). */}
      <DeputadoMaisVotados
        escopo="uf"
        uf={sigla}
        linhas={maisVotados.length > 0 ? maisVotados : undefined}
        titleId="mais-votados-uf-heading"
      />

      {/* Seção 2 — a bancada do estado. RF-122, RF-125.1, RF-127, RF-130.
          O bloco NUNCA sai do DOM (ADR-0017): sem o Blob ele diz por quê. */}
      <Panel
        kicker="Bancada do estado"
        title="Cadeiras e candidatos por agremiação"
        titleId="bancada-uf-heading"
      >
        {detail ? (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            {/* Uma legenda só para o painel inteiro (spec 026 § Telas item 5). */}
            <LegendaMarcas
              uf={sigla}
              projecaoVisivel={visivel}
              totalizacaoFinal={ctx.totalizacaoFinal}
              temDestino={temDestino}
              semPercentual={!v2}
            />
            <ul
              data-testid="uf-agremiacoes"
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}
            >
              {agremiacoes.map((agr) => {
                const componentes = listarComponentes(agr.componentes);
                const intervalo = intervaloDeCadeiras(agr);
                const federacao = agr.tipo === "federacao";
                const exibicao: ExibicaoLinha = {
                  nome: nomeExibicao,
                  partido: siglaExibicao,
                  mostrarPartido: federacao,
                };
                // v2: `candidatos` na ordem do rank; v1: eleitos + suplentes (RF-276).
                const linhas = agr.candidatos
                  ? agr.candidatos.map((l) => paraLinhaCompacta(l, ctx, exibicao))
                  : linhasCompactasDoV1(agr, exibicao);
                const corte = corteCompacto(agr, ctx.totalizacaoFinal);
                const projetadas = visivel ? agr.cadeiras_projetadas : undefined;
                const faixaProjetada = projetadas !== undefined ? intervaloProjetado(agr) : null;
                const headingId = `agremiacao-${agr.cod}-heading`;
                return (
                  <li
                    key={agr.cod}
                    data-testid="uf-agremiacao"
                    data-cod={agr.cod}
                    aria-labelledby={headingId}
                    className="flex flex-col"
                    style={{
                      gap: "var(--space-2)",
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
                        <span className="sr-only"> cadeiras na parcial</span>
                      </span>
                      <span className="min-w-0 flex flex-col" style={{ gap: "var(--space-1)" }}>
                        {/* ADR-0065 (negativas): um título por agremiação, para
                            quem navega por cabeçalhos pular listas de 60. */}
                        <h3
                          id={headingId}
                          className="inline-flex items-center"
                          style={{ gap: "var(--space-2)", margin: 0, font: "var(--type-body-sm)" }}
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
                          {/* Sigla INTEIRA no cabeçalho da bancada (2026-09-19);
                              ABREVIADA nas linhas de pessoas logo abaixo. */}
                          {agr.sigla}
                        </h3>
                        <span
                          style={{
                            font: "var(--type-body-sm)",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                            textWrap: "pretty",
                          }}
                        >
                          {/* RF-122 */}
                          {federacao && componentes.length > 0 ? (
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
                        {/* RF-263 — cadeiras projetadas: só com a projeção
                            VISÍVEL, e a frase inteira num elemento com "não
                            oficial" (RF-266). A parcial, ao lado, não muda. */}
                        {projetadas !== undefined ? (
                          <span
                            data-testid="uf-cadeiras-projetadas"
                            style={{ font: "var(--type-data)", color: "var(--accent-text)" }}
                          >
                            {projetadas} {projetadas === 1 ? "cadeira" : "cadeiras"} na projeção ·
                            não oficial
                            {faixaProjetada ? ` (faixa provável: ${faixaProjetada})` : ""}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="text-right"
                        style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
                      >
                        <span className="sr-only">
                          {intervalo ? "faixa provável na parcial: " : "faixa não disponível "}
                        </span>
                        <span data-testid="uf-intervalo">
                          {intervalo ? `${intervalo} cadeiras` : "—"}
                        </span>
                      </span>
                    </div>

                    {/* RF-272 — o corte repetido no cabeçalho: ele não some
                        quando a linha de corte está na faixa recortada. */}
                    {corte ? (
                      <p
                        data-testid="uf-corte-cabecalho"
                        style={{
                          margin: 0,
                          font: "var(--type-body-sm)",
                          fontSize: "var(--text-xs)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {fraseCorteCabecalho({
                          diferenca: agr.corte?.diferenca ?? 0,
                          primeiro_fora_abaixo_piso_10: corte.abaixoPiso10,
                        })}
                      </p>
                    ) : null}

                    {/* RF-273 */}
                    <LinhaPuxadores
                      uf={sigla}
                      puxadores={agr.puxadores}
                      nomePorSqcand={nomePorSqcand}
                    />

                    {/* RF-260/RF-261 — a lista em três faixas (cliente, tuplas). */}
                    {linhas.length > 0 ? (
                      <DeputadoListaAgremiacao
                        uf={sigla}
                        cod={agr.cod}
                        sigla={agr.sigla}
                        linhas={linhas}
                        totalCandidatos={agr.total_candidatos}
                        haListaRestante={(detail.lista?.restantes ?? 0) > 0}
                        corte={corte}
                        totalizacaoFinal={ctx.totalizacaoFinal}
                        projecaoVisivel={visivel}
                        mostrarPartido={federacao}
                        tsDetalhe={detail.ts}
                        semPercentual={!agr.candidatos}
                      />
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

      {/* Spec 026 RF-274 — regras com os números da UF. Só em objeto v2: o v1
          não tem `regras`, e o RF-276 manda o bloco não aparecer (em vez de
          dizer "aguardando" sobre um dado que o objeto nunca carregaria). */}
      {detail && v2 ? (
        <DeputadoRegras uf={sigla} regras={detail.regras} titleId="regras-heading" />
      ) : null}

      {/* Seção 3 — conferência contra o TSE (RF-269). Constituição § 8:
          divergência aparece; e a frase "batem" só existe quando a comparação
          FOI feita — o componente decide pelo `comparou`, nunca pela lista
          vazia de divergências (o defeito de 29/09). */}
      {detail ? (
        <DeputadoConferencia
          conferencia={detail.conferencia}
          divergenciasV1={detail.divergencias}
          totalizacaoFinal={detail.totalizacao_final}
          siglaPorCod={new Map(detail.agremiacoes.map((a) => [a.cod, a.sigla] as const))}
          nomePorSqcand={nomePorSqcand}
          titleId="conferencia-heading"
        />
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
        pctApurado={detail?.pct_apurado ?? pctApurado}
        cadenciaMinutos={cadencia}
        temDado={detail !== null}
        temIntervalo={agremiacoes.some((a) => a.cadeiras_ci95 !== undefined)}
        variant="uf"
        uf={sigla}
        projecao={detail?.projecao ?? null}
        interruptorLigado={interruptor.ligada}
        interruptorOrigem={interruptor.origem}
        movendo={movendo}
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
