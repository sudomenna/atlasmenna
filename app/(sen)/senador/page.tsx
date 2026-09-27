/**
 * app/(sen)/senador/page.tsx — T-09, spec 016 (Senador).
 *
 * A visão nacional da disputa do Senado: as 27 corridas estaduais e a
 * composição das **54 vagas em disputa**.
 *
 * ## A decisão de leitura que governa esta tela
 *
 * São duas vagas por estado, não uma. Toda a gramática que as outras rotas
 * usam — "quem está na frente", "margem do líder", barra com marcador de
 * maioria em 50% — descreve uma corrida de vaga única e, aplicada aqui,
 * produziria números certos respondendo à pergunta errada. O que decide a
 * eleição de um senador não é liderar: é estar entre os dois primeiros. Por
 * isso a margem exibida em cada estado é a do **2º para o 3º** (RF-104), e
 * não a do 1º para o 2º.
 *
 * ## Por que esta rota não tem mapa MUNICIPAL
 *
 * O cargo 5 é ingerido em granularidade ZONA desde 2026-09-11 (emenda (b) do
 * ADR-0026). Antes eram 27 arquivos por
 * ciclo, um por estado, sem quebra por zona ou município. Quatro cargos em
 * zona passariam de 24 mil GETs por ciclo. A consequência assumida é que
 * Senador não tem mapa municipal nem "maiores colégios eleitorais" — não há
 * dado municipal para desenhar (`municipios-sen-t1.json` grava `municipios:
 * []` de propósito).
 *
 * 🔴 **2026-09-18 — esta rota GANHOU moldura de mapa, no nível Brasil.** Até
 * aqui a ausência de mapa municipal levava a rota inteira para fora do
 * `<AppShellSplit>`/`<PersistentMapFrame>` (ADR-0033 § 1). Pedido do dono: a
 * mesma moldura de Presidente/Governador, pintada por UF (não por
 * município) — dado que já existe (`EdgeUfRow`, o mesmo tipo das outras duas
 * corridas). `app/(sen)/layout.tsx` monta `<PersistentMapFrame cargo="sen">`;
 * o nível UF dela continua sem coroplético municipal, pelo motivo acima —
 * ver o ramo `sigla` de `PersistentMapFrame.tsx`, cargo `"sen"`.
 *
 * ## Cobertura
 *   - RF-106 — "2 vagas por estado" junto ao título. ⚠️ O kit rotula
 *     "1 vaga" (ADR-0029); esse rótulo NÃO é herdado.
 *   - RF-107 — composição das 54 vagas por partido, distinguida das 81
 *     cadeiras do Senado.
 *   - RF-108 — projeção em nível de estado + cadência de 5 min, em texto,
 *     sem clique (`<ForecastTransparency>`).
 *   - RF-104 — a margem de cada corrida é a da 2ª vaga.
 *   - ADR-0001 (Global Config no read path), ADR-0026, ADR-0028 (a leitura
 *     declara `{ cargo, turno }`; nada vem do calendário), ADR-0035 D2
 *     (campos novos opcionais).
 *   - Constituição § 1 (não oficial), § 2 (cores por token), § 3 (degrada
 *     graciosamente), § 4 (lista textual), § 8 (transparência).
 *
 * ISR: 60 s (ADR-0011) — o payload é reescrito a cada 5 min pelo cron do
 * cargo, e revalidar mais rápido que isso não traz dado novo; revalidar
 * mais devagar atrasaria a primeira aparição.
 */

import type { Metadata } from "next";

import { FasePreEleicaoBanner } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { VoteBar, type VoteBarSegment } from "@/components/atoms/bars/VoteBar";
import { Figure } from "@/components/atoms/data/Figure";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateColor as candidateColorDoPartido } from "@/components/blocks/_candidateColor";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import { Footer } from "@/components/layout/Footer";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { cargoInfo } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import { resultadoEleitoral, simulacaoNacional } from "@/lib/dev/simulacao";
import { readProjection } from "@/lib/edge-config/reader";
import type { EdgeDestinoVoto, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import {
  compete,
  exibePercentual,
  haAnulada,
  NOTA_ANULADAS_SEM_REGRA_1T,
  sufixoAriaDestino,
  votosDaAnulada,
} from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import senFixture from "@/tests/fixtures/edge-config/sen-current.json" with { type: "json" };

/** Código TSE do cargo desta rota. A granularidade e as vagas saem da tabela
 * canônica (`lib/config/cargos.ts`), nunca de literal na página: em 2026-09-11
 * o cargo 5 mudou de `uf` para `zona` e um `granularidade="uf"` hardcoded aqui
 * teria feito a tela afirmar ao leitor que "o TSE publica um boletim agregado
 * por UF para este cargo, e não um por zona" — falso desde a mudança, e
 * constituição § 8 é sobre exatamente isso. */
const CARGO_SENADOR = 5 as const;

export const revalidate = 60;

/** Tabela canônica — nenhum "2" literal nesta tela (ADR-0026, spec 016). */
const SENADOR = cargoInfo(5);
const VAGAS = SENADOR.vagasPorUf ?? 1;

/** Cadência do cron de Senador em `vercel.ts` (ADR-0026 item 5). */
const CADENCIA_MIN = 5;

export const metadata: Metadata = {
  title: "Senado 2026 · AtlasMenna",
  description:
    "Projeção das 27 corridas estaduais para o Senado em 2026 — duas vagas por estado, 54 em disputa. Não oficial. Fonte: TSE.",
  alternates: { canonical: "/senador" },
  openGraph: {
    title: "Senado 2026 · AtlasMenna",
    description:
      "Projeção das 54 vagas do Senado em disputa em 2026 — duas por estado, turno único.",
    type: "website",
    locale: "pt_BR",
    siteName: "AtlasMenna",
  },
  twitter: {
    card: "summary_large_image",
    title: "Senado 2026 · AtlasMenna",
    description: "As 54 vagas do Senado em disputa, estado a estado.",
  },
};

/**
 * 🔴 **O ramo de espera — o que substituiu o `emptyPayload()` em 2026-09-14.**
 *
 * Gêmeo de `AguardandoGovernadores` em `app/(gov)/governador/page.tsx`, e a
 * justificativa inteira está lá. O resumo: o `emptyPayload()` que ficava aqui
 * fabricava um `EdgePayload` completo de zeros e a página o renderizava como
 * resultado — "Todas as unidades federativas estão com a apuração concluída",
 * em produção, sem aviso. Era a única superfície da spec 019 que regredia de
 * fato.
 *
 * A hierarquia, decidida pelo dono: **número conhecido ⇒ mostre; nada ⇒ diga
 * que não tem, sem número nenhum; nunca fabrique zeros.** Este ramo é o caso
 * do meio, e por isso não tem `<Figure>`, nem `<VoteBar>`, nem a composição
 * das 54 vagas — cada um imprimiria um número que ninguém mediu.
 *
 * ⚠️ **Emenda de 2026-09-14.** O bloco de transparência, que este docstring
 * listava entre os ausentes, **ficou** — em prosa, sem as duas frações. Ver a
 * justificativa no gêmeo, `AguardandoGovernadores`.
 *
 * ⚠️ A faixa entra com `variante="sem_dados"`: este ramo é alcançado tanto por
 * "a chave ainda não foi gravada" quanto por "a leitura falhou", e a tela não
 * tem como distinguir. Afirmar "a eleição ainda não começou" aqui seria
 * transformar uma falha de rede numa afirmação sobre o calendário — a
 * armadilha do RNF-010 e da open question 3 da spec 019.
 */
function AguardandoSenado() {
  return (
    <main
      data-trilha="sen"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* RF-160 — primeiro filho do `<main>`; teste de ORDEM, não de presença. */}
      <FasePreEleicaoBanner corrida="o Senado" variante="sem_dados" listaDeEstadosAbaixo />

      {/* RF-159 — `variante="sem_dados"` (emenda de 2026-09-14): o selo fica
          silencioso. Este ramo é "não recebemos dados", não "a eleição não
          começou" — a segunda frase é a que a faixa acima já se recusa a
          dizer, e o selo vive fora do `<main>`, onde os testes de página não
          a viam. Resta o que vale nos dois casos: apagar o segmentado
          "Parcial / Projeção" (RF-161). */}
      <SeloFasePreStyle variante="sem_dados" />

      <Panel
        kicker="Atlas Menna · não oficial"
        title="Senado 2026"
        titleId="senado-heading"
        headingLevel={1}
      >
        <p
          className="max-w-prose"
          data-testid="sen-aguardando"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          Esta página ainda não recebeu dados de apuração do TSE, então não há número nenhum a
          mostrar aqui — nem percentual, nem contagem de vagas por partido. O que continua valendo é
          a regra da eleição: <strong>{VAGAS} vagas por estado</strong>, em turno único, com cada
          eleitor votando em duas candidaturas. Não oficial. Fonte: TSE.
        </p>
      </Panel>

      {/* Geografia é identidade e fala; progresso é medição e cala. */}
      <Panel kicker="Corridas estaduais" title="Estado a estado" titleId="corridas-heading">
        <UfLinksGrid cargo={CARGO_SENADOR} />
      </Panel>

      {/* 🔴 Emenda de 2026-09-14 — gêmeo do de `/governador`, e a justificativa
          está lá: as duas leituras da constituição § 8 ficam satisfeitas ao
          mesmo tempo, o bloco fica e o número sai.

          ⚠️ Sem `granularidade` e sem `cadenciaMinutos`, ao contrário do ramo
          com payload logo abaixo: as duas frases que eles produzem estão no
          PRESENTE ("lemos o boletim agregado por estado", "os números são
          atualizados a cada N minutos") sobre uma leitura que ainda não
          aconteceu — e a segunda traria um número de volta. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={0} preEleicao variante="sem_dados" variant="national" />
      </Panel>

      <Footer />
    </main>
  );
}

/**
 * Os candidatos de uma UF, na ordem da projeção.
 *
 * `EdgeUfRow.top_candidatos` já vem ordenado por `pct_projetado` desc. **Vinha
 * cortado em 3 pelo orchestrator; desde 2026-09-19 vêm 4** — decisão do dono
 * de mostrar quatro candidaturas nas telas de resumo de UF, acompanhada pelo
 * produtor (`TOP_CANDIDATOS_POR_UF = 4`, `api/model/project.py`). Com duas
 * vagas, o que esta tela precisa continua vindo de graça: os dois que entram e
 * — agora — os dois primeiros que ficam de fora.
 *
 * Esta função NÃO corta nada: quem consome escolhe. A lista estado a estado
 * imprime `slice(0, VAGAS)` (os dois ocupantes, sem ordinal) e mede a margem
 * da 2ª vaga entre `[VAGAS - 1]` e `[VAGAS]` — o 2º e o 3º. Os dois acessos
 * são por índice contado do TOPO, então a 4ª entrada entrou sem deslocar
 * nenhum deles. Payload gravado antes de 19/09 traz 3 entradas e segue
 * correto pela mesma razão.
 *
 * **Spec 018 / ADR-0042 — nome e partido vêm da própria linha da UF.** Até a
 * spec 018 esta função os buscava em `national.candidatos` indexado por `id`,
 * e isso estava errado por construção: no Senado o bloco nacional é a **união
 * de 27 corridas** sob o mesmo espaço de `id`, então `id === 13` ali não
 * identifica uma pessoa — identifica "o número 13 nalguma UF". Como em cargo
 * majoritário o número na urna É o número do partido, todo senador do PT do
 * país concorre sob o 13, e o índice entregava o candidato de um estado
 * arbitrário para os outros 26. `uf.top_candidatos[]` é resolvido pelo par
 * `(uf, numero)` no orchestrator e já sabe de que estado é.
 */
// ⚠️ `porId: Map<number, EdgeCandidate>` saiu em 2026-09-19: ele existia só para
// buscar `c.cor`, a paleta por COLOCAÇÃO que o payload deixou de emitir. A cor
// agora vem da SIGLA, que já chega em `top_candidatos[].partido` (RF-144).
function topDaUf(uf: EdgeUfRow): Array<{
  id: number;
  pct: number;
  nome: string;
  partido: string;
  cor: string;
  destino?: EdgeDestinoVoto;
  votos?: number;
}> {
  return (uf.top_candidatos ?? []).map((t, i) => {
    return {
      id: t.id,
      pct: t.pct,
      // Fallback para payload PRÉ-018 (campo ausente): o placeholder de
      // sempre, e deliberadamente NÃO uma volta ao índice nacional —
      // "Candidatura 13" é feio e verdadeiro; o nome do senador de outro
      // estado seria bonito e falso.
      nome: t.nome ? nomeExibicao(t.nome, t.sqcand) : `Candidatura ${t.id}`,
      partido: t.partido ?? "—",
      // 🔴 Cor pela SIGLA (ADR-0024), não por `c.cor` — que era a paleta por
      // COLOCAÇÃO e saiu do payload em 19/09. O `?? "var(--color-cand-other)"`
      // antigo mascarava o problema: dava cinza quando o candidato não estava
      // no índice nacional, e cor de rank quando estava.
      cor: candidateColorDoPartido(t.partido, i + 1),
      ...(t.destino ? { destino: t.destino } : {}),
      // Lido SÓ na anulada, que aparece com os votos no lugar do % (opção A).
      ...(typeof t.votos_atuais === "number" ? { votos: t.votos_atuais } : {}),
    };
  });
}

/**
 * ADR-0053 / RF-213 — "Nome (SIGLA)" com a etiqueta de destino dentro dos
 * parênteses quando houver: "Nome (SIGLA, Anulado)". Texto corrido, e não o
 * átomo `<DestinoEtiqueta>`, porque esta linha é uma frase única juntada por
 * " · " — a palavra continua visível e é lida no mesmo fluxo.
 */
function rotuloCandidatura(c: { nome: string; partido: string; destino?: EdgeDestinoVoto }) {
  return `${c.nome} (${siglaExibicao(c.partido)}${sufixoAriaDestino(c.destino)})`;
}

export default async function SenadoPage() {
  // ADR-0028: a leitura declara cargo E turno. Nada é derivado do calendário —
  // e Senador não tem 2º turno (`temSegundoTurno: false`), então `turno: 1`
  // aqui é o único turno que existe, não um default preguiçoso.
  //
  // 🔴 Sem payload **não há fallback estrutural** em produção: a página vai
  // para o ramo de espera e não mostra número nenhum. O `emptyPayload()` que
  // ficava aqui fabricava zeros e a tela os publicava como resultado.
  // 🔴 Simulação ligada ⇒ ela é a fonte de verdade e o Global Config nem é
  // lido. Ver a nota gêmea em `app/(gov)/governador/page.tsx`: uma resposta
  // vazia da fonte remota é uma resposta, e ela ganhava da simulação.
  const payload = await resultadoEleitoral(
    () => simulacaoNacional("sen"),
    async () =>
      (await readProjection({ cargo: "sen", turno: 1 })) ??
      (process.env.NODE_ENV === "development" ? (senFixture as unknown as EdgePayload) : null),
  );

  if (!payload) return <AguardandoSenado />;

  // 🔴 RF-153 — o campo `fase` é o único gatilho. Ver a nota gêmea em
  // `app/(gov)/governador/page.tsx`. Ausência de payload **não** liga a fase
  // pré: ela leva ao ramo acima, que é o terceiro estado ("não sabemos").
  const pre = isPreEleicao(payload);

  const composicao = payload.composicao_vagas;

  // Segmentos da barra de composição: cada partido ocupa a fração das vagas
  // EM DISPUTA que a projeção lhe dá. Cor por posição na lista (ADR-0013 —
  // paleta dinâmica por rank), nunca a cor oficial do partido
  // (constituição § 2).
  const vagasEmDisputa = composicao?.vagas_em_disputa ?? 0;
  const segmentos: VoteBarSegment[] = composicao
    ? composicao.por_partido.map((p, i) => ({
        id: p.partido,
        label: p.partido,
        pct: vagasEmDisputa > 0 ? (p.vagas * 100) / vagasEmDisputa : 0,
        color: `var(--color-cand-${Math.min(i + 1, 11)})`,
      }))
    : [];
  const aguardando = composicao ? Math.max(0, vagasEmDisputa - composicao.vagas_projetadas) : 0;

  return (
    <main
      data-trilha="sen"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      style={{ gap: "var(--space-8)" }}
    >
      {/* 🔴 RF-160 — PRIMEIRO FILHO do `<main>`. Teste de ORDEM, não de
          presença. */}
      {pre ? <FasePreEleicaoBanner corrida="o Senado" /> : null}

      {/* RF-159 — o selo do `<TopBar>`: silêncio por default, e em fase pré as
          três propriedades que dizem "ainda não começou". */}
      {pre ? <SeloFasePreStyle /> : null}

      {/* Seção 1 — o placar da corrida inteira. O `<h1>` é o título deste
          painel (ADR-0029 § 5), e o parágrafo abaixo dele carrega o rótulo
          de duas vagas (RF-106) — que é REGRA DA ELEIÇÃO, não medição, e por
          isso fica igual nas duas fases. */}
      <Panel
        kicker={pre ? "Candidaturas registradas no TSE" : "Projeção Atlas Menna · não oficial"}
        title={pre ? "Quem está concorrendo em cada estado" : "Senado 2026"}
        titleId="senado-heading"
        headingLevel={1}
      >
        <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
          <p
            className="max-w-prose"
            data-testid="senado-vagas-label"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            <strong>{VAGAS} vagas por estado</strong> — turno único. Cada eleitor vota em duas
            candidaturas e as duas mais votadas de cada estado se elegem, sem diferença entre a
            primeira e a segunda. Não oficial. Fonte: TSE.
          </p>

          {/* RF-155/RF-161 — a figura "Apurado" é medição pura, e as duas
              palavras que ela imprime ("Apurado", "boletim") estão na lista
              negra de vocabulário do RF-161. Em fase pré ela não chega ao DOM:
              esconder por CSS não serviria, porque a métrica de aceitação é
              varrida sobre o HTML renderizado. */}
          {pre ? null : (
            <div className="grid grid-cols-2" style={{ gap: "var(--space-4)" }}>
              <Figure
                label="Apurado"
                note={`${payload.ufs_apuradas} de 27 estados com boletim`}
                unit="%"
                value={payload.pct_apurado_total.toLocaleString("pt-BR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              />
              {composicao ? (
                <Figure
                  label="Vagas em disputa"
                  note={
                    composicao.total_cadeiras
                      ? `de ${composicao.total_cadeiras} cadeiras do Senado`
                      : "nesta eleição"
                  }
                  size="lg"
                  value={String(vagasEmDisputa)}
                />
              ) : null}
            </div>
          )}
        </div>
      </Panel>

      {/* Spec 021 RF-192 / spec 022 RF-200 — EMENDADOS em 2026-09-26 (noite),
          decisão do dono: "Votação" e "A corrida" SAÍRAM desta capa. O
          eleitorado do Brasil repetia o da capa de Presidente sem dizer nada
          sobre 27 eleições estaduais. Os dois painéis vivem em
          `/uf/[sigla]/senador`, com o dado DA UF. */}

      {/* Seção 2 — RF-107. A composição é AGREGAÇÃO, não estimativa nacional:
          o TSE não publica arquivo agregado para cargo 5 (`temArquivoBr:
          false`), então o número é a soma das 27 corridas. O texto diz isso,
          porque a constituição § 8 exige que o leitor saiba de onde vem o
          número, e a open question 2 da spec nomeia esse risco. */}
      <Panel kicker="Composição" title="As 54 vagas em disputa" titleId="composicao-heading">
        {/* RF-158 tem um irmão aqui: o bloco FICA em fase pré, a medição sai.
            A alternativa — sumir com ele — tiraria do outline um `<h2>` que
            não fala de apuração nenhuma ("As 54 vagas em disputa" é um fato
            sobre a eleição, verdadeiro em qualquer dia), e o texto de espera
            que já existia dizia "quando o primeiro estado tiver boletim
            apurado", com duas palavras da lista negra do RF-161. */}
        {pre ? (
          <p
            className="max-w-prose"
            data-testid="composicao-pre-eleicao"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            Nenhum voto foi contado ainda. São {vagasEmDisputa || 54} vagas em disputa — duas por
            estado —, de um Senado de 81 cadeiras; as outras 27 são de senadores eleitos em 2022,
            com mandato até 2031, e não estão em jogo nesta eleição. Quantas cada partido leva
            aparece aqui quando a votação começar.
          </p>
        ) : composicao ? (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            {/* Sem `marker`: não existe "maioria" a marcar aqui. Metade destas
                54 vagas não é metade do Senado — as outras 27 cadeiras não
                estão em disputa e seguem com quem foi eleito em 2022. */}
            {/* `showLabels={false}`: o `<VoteBar>` rotula, por default, o
                PRIMEIRO e o SEGUNDO segmento — desenho pensado para o duelo de
                uma corrida majoritária. Numa composição de oito partidos isso
                imprime dois nomes arbitrários sob a barra, como se os dois
                primeiros fossem os que importam. A lista logo abaixo já nomeia
                TODOS, com a contagem de cada um. O `ariaLabel` explícito
                garante que o leitor de tela receba a série inteira em vez do
                texto gerado para dois segmentos. */}
            <VoteBar
              ariaLabel={`Composição projetada das ${vagasEmDisputa} vagas em disputa: ${composicao.por_partido
                .map((p) => `${p.partido} ${p.vagas}`)
                .join(", ")}`}
              marker={null}
              segments={segmentos}
              showLabels={false}
            />

            <ul
              className="flex flex-wrap"
              data-testid="composicao-partidos"
              style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--space-3)" }}
            >
              {composicao.por_partido.map((p) => (
                <li
                  key={p.partido}
                  className="inline-flex items-baseline"
                  style={{ gap: "var(--space-2)", font: "var(--type-body-sm)" }}
                >
                  <span style={{ font: "var(--type-figure-sm)" }}>{p.vagas}</span>
                  {/* Desenhado ⇒ abreviado (2026-09-19). Oito ou mais partidos
                      numa fileira `flex-wrap`; o `ariaLabel` do `<VoteBar>`
                      logo acima segue com as siglas inteiras.
                      🔴 Esta é a composição do SENADO, não a bancada da Câmara:
                      a exceção do dono ("home de Deputados não abrevia") é da
                      rota `/deputado-federal`, não de toda tela que lista
                      partido. */}
                  <span style={{ color: "var(--text-secondary)" }}>{siglaExibicao(p.partido)}</span>
                </li>
              ))}
              {aguardando > 0 ? (
                <li
                  className="inline-flex items-baseline"
                  data-testid="composicao-aguardando"
                  style={{ gap: "var(--space-2)", font: "var(--type-body-sm)" }}
                >
                  <span style={{ font: "var(--type-figure-sm)" }}>{aguardando}</span>
                  <span style={{ color: "var(--text-muted)" }}>aguardando apuração</span>
                </li>
              ) : null}
            </ul>

            <p
              className="max-w-prose"
              data-testid="composicao-nota"
              style={{
                margin: 0,
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                textWrap: "pretty",
              }}
            >
              O Senado tem <strong>{composicao.total_cadeiras ?? 81} cadeiras</strong>. Em 2026 a
              eleição renova dois terços delas — as{" "}
              <strong>{vagasEmDisputa} que aparecem aqui</strong>. As outras{" "}
              {(composicao.total_cadeiras ?? 81) - vagasEmDisputa} são de senadores eleitos em 2022,
              com mandato até 2031: não estão em disputa e não entram nesta contagem. O total por
              partido é a soma das 27 corridas estaduais — o TSE não publica um arquivo nacional
              para este cargo.
            </p>
          </div>
        ) : (
          <p
            className="max-w-prose"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            A contagem de vagas por partido aparece quando o primeiro estado tiver boletim apurado.
            São 54 vagas em disputa — duas por estado —, de um Senado de 81 cadeiras.
          </p>
        )}
      </Panel>

      {/* Seção 3 — as corridas, estado a estado. A margem de cada linha é a
          da 2ª vaga (RF-104): `top_candidatos[1].pct − top_candidatos[2].pct`.
          É lista, não mapa: este cargo não tem dado municipal (ADR-0026). */}
      <Panel kicker="Corridas estaduais" title="Estado a estado" titleId="corridas-heading">
        {/* 🔴 RF-162 — em fase pré esta lista é 27 links e nenhum nome. Cada
            linha de hoje imprime os dois primeiros colocados de um estado e a
            margem para a 2ª vaga: nome de candidato e medição, os dois. E os
            nomes viriam de `top_candidatos`, que num payload semeado com
            `por_uf: []` nem existe. A asserção do teste é NEGATIVA — nenhum
            nome de candidatura no documento —, porque a positiva passaria com
            uma grade de rostos logo abaixo. */}
        {pre ? (
          <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
            <p
              className="max-w-prose"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              São 27 disputas independentes, com candidaturas próprias em cada estado. Abra um
              estado para ver quem concorre lá.
            </p>
            <UfLinksGrid cargo={CARGO_SENADOR} />
          </div>
        ) : payload.por_uf.length > 0 ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            {/* 🔴 A legenda é o que impede a segunda linha de mentir por
                omissão. "Outros (7)" logo depois de dois nomes seria lido como
                "e mais sete" — quando há também o 3º e o 4º, que estão na
                mesma linha e fora da cauda. Dizer de onde a cauda começa é o
                que mantém a partição legível: ocupantes + de fora + Outros =
                todas as candidaturas do estado. A frase do traço existe pela
                mesma razão: sem ela, um "—" no meio de números vira erro de
                renderização aos olhos do leitor, em vez do fato que é. */}
            <p
              className="max-w-prose"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              Cada linha traz os dois que ficam com as vagas e, abaixo, quem ficou de fora: as
              demais candidaturas com a projeção de cada uma e <strong>Outros</strong>, a soma das
              que estão fora das quatro primeiras daquele estado — com quantas são entre parênteses.
              Onde o TSE ainda não apurou nada no estado, o valor apurado aparece como um traço,
              porque não foi medido — não é zero.
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}>
              {payload.por_uf.map((uf) => {
                // ADR-0053 / RF-213 — vagas e margem entre quem DISPUTA; a
                // anulada vai para "Fora das vagas", depois das que competem e
                // antes de "Outros". Sem anulada, `disputam` é `top`.
                const top = topDaUf(uf);
                const disputam = top.filter(compete);
                const anuladas = top.filter((c) => !compete(c));
                const dentro = disputam[VAGAS - 1];
                const fora = disputam[VAGAS];
                const margem = dentro && fora ? dentro.pct - fora.pct : null;

                // 🔴 2026-09-19 — a SEGUNDA linha, "quem ficou de fora".
                //
                // Motivo: o balão de hover dos mapas (`<HoverCard>`) mostra
                // quatro candidaturas por UF mais a cauda somada, e é
                // `aria-hidden` por construção — ele espelha em pixels o que um
                // ponteiro revelou, e quem navega por teclado não tem ponteiro
                // (docstring do átomo). Esta lista é o alvo do
                // `aria-describedby` do mapa nacional de Senador
                // (`_NationalChoroplethMapImpl.tsx`, ramo `cargo === "sen"` →
                // `"corridas-heading"`), então tudo que o balão diz e esta lista
                // cala é informação que a rota não entrega a leitor de tela. Até
                // aqui ela calava TRÊS coisas: o 3º, o 4º e a cauda.
                //
                // ⚠️ A linha de cima NÃO mudou e não pode mudar: ela é "quem
                // fica com as duas cadeiras", e quatro nomes ali diriam que
                // quatro pessoas ocupam duas vagas (ver o comentário dela).
                // Estes nomes vêm numa linha PRÓPRIA e sob o rótulo "Fora das
                // vagas", que é a frase que impede a leitura errada.
                //
                // Por que os de fora ganham percentual e os ocupantes não: a
                // divisão editorial é identidade × magnitude. Entre o 1º e o 2º
                // não há hierarquia — os dois se elegem igual, e numerá-los ou
                // ranqueá-los por número inventaria uma. Entre o 2º e o 3º há
                // exatamente uma diferença que importa, e a coluna da direita já
                // a publica ("X p/ 2ª vaga"): esta linha é quem dá NOME ao lado
                // de lá dessa margem, que até hoje era um número contra um
                // adversário anônimo.
                //
                // `slice(VAGAS)` sem teto superior, ao contrário do
                // `slice(0, 4)` de `<GovernorCard>`: aqui o trabalho da linha é
                // FECHAR a partição (ocupantes + de fora + cauda = todo mundo).
                // `uf.outros` é o complemento de `top_candidatos` seja qual for
                // o comprimento dele, então um teto de 4 cravado aqui faria a 5ª
                // entrada sumir da tela sem entrar na cauda no dia em que o
                // produtor subir `TOP_CANDIDATOS_POR_UF` — e sumiria calada.
                const deFora = [...disputam.slice(VAGAS), ...anuladas];
                const outros = uf.outros;
                // 🔴 `pct_atual` é TUDO-OU-NADA e **ausente, nunca `0`** (ver a
                // docstring de `EdgeUfRow.outros` em `lib/edge-config/types.ts`):
                // some por UF inteira quando nenhuma zona foi apurada. Um
                // `?? 0` aqui escreveria "0,0% apurado" — "medimos zero" no
                // lugar de "não sabemos", que são estados diferentes (decisão do
                // dono, 14/09). Por isso o teste explícito de tipo, e não um
                // coalesce.
                const pctAtualOutros = outros?.pct_atual;
                const parcialOutros =
                  typeof pctAtualOutros === "number" && Number.isFinite(pctAtualOutros)
                    ? formatPercent(pctAtualOutros, 1)
                    : "—";
                // 🔴 Cauda AUSENTE ⇒ nenhum pedaço de texto. Campo faltando
                // significa "não há mais ninguém" (UF com ≤ 4 candidaturas), não
                // "os demais somam zero": renderizar incondicionalmente
                // escreveria "Outros 0,0%" numa corrida de três.
                //
                // E `outros.pct` vem do CAMPO, somado candidato a candidato no
                // produtor — nunca `100 − Σ(top)`. Os pontos de uma UF não fecham
                // em 100 de propósito (cada um é a média de um bootstrap
                // próprio); a subtração empurraria o resíduo de fechamento para
                // dentro de "Outros" e o publicaria como voto de alguém.
                const partesFora = [
                  // Desenhado ⇒ abreviado (2026-09-19). Esta cauda é texto
                  // VISÍVEL (ver o comentário três blocos abaixo), espremida na
                  // coluna do meio de uma linha de 3 colunas.
                  // Emenda "opção A" ao ADR-0053 — a anulada vai com os
                  // VOTOS, nunca com o % (o dela é sobre outra base); sem voto
                  // no dado, só o rótulo com a etiqueta.
                  ...deFora.map((c) => {
                    if (exibePercentual(c))
                      return `${rotuloCandidatura(c)} ${formatPercent(c.pct, 1)}`;
                    const votos = votosDaAnulada(c.votos, true);
                    return votos ? `${rotuloCandidatura(c)} ${votos}` : rotuloCandidatura(c);
                  }),
                  // ⚠️ Rótulo ANTES do número nos dois valores da cauda, e não
                  // "8,1% · parcial 6,4%": o separador da lista é " · ", então
                  // um "·" dentro de um item faria a cauda parecer DOIS itens
                  // ("… · Outros (7) 8,1%" + "parcial 6,4%") — a linha passaria
                  // a listar uma candidatura fantasma. Com o rótulo na frente,
                  // o traço de "apurado —" também cai num lugar em que se lê
                  // como valor ausente, não como travessão de pontuação.
                  ...(outros
                    ? [
                        `Outros (${outros.n_candidatos}) projetado ${formatPercent(outros.pct, 1)}, apurado ${parcialOutros}`,
                      ]
                    : []),
                ];
                return (
                  <li key={uf.sigla} style={{ borderBottom: "1px solid var(--border-hairline)" }}>
                    <a
                      href={`/uf/${uf.sigla}/senador`}
                      data-testid="corrida-uf"
                      data-uf={uf.sigla}
                      className="grid items-center"
                      style={{
                        gridTemplateColumns: "2.5rem minmax(0, 1fr) auto",
                        columnGap: "var(--space-3)",
                        minHeight: "var(--tap-min)",
                        padding: "var(--space-3) 0",
                        color: "inherit",
                        textDecoration: "none",
                      }}
                    >
                      <span style={{ font: "var(--type-figure-sm)" }}>{uf.sigla}</span>
                      <span className="min-w-0 flex flex-col" style={{ gap: "var(--space-1)" }}>
                        <span
                          className="truncate"
                          // 2026-09-19 — `data-testid` novo, e ele existe para
                          // uma asserção NEGATIVA: o teste "(g)" precisa provar
                          // que o 3º colocado não aparece AQUI. Até esta data a
                          // prova era sobre o `textContent` da linha inteira,
                          // o que passou a ser forte demais — o 3º agora tem
                          // lugar legítimo na linha de baixo, sob rótulo
                          // próprio. Sem um alvo para o escopo, a única saída
                          // seria afrouxar a asserção, e afrouxar é como a
                          // regra "quatro nomes diriam que quatro pessoas
                          // ocupam duas vagas" morre em silêncio.
                          data-testid="corrida-ocupantes"
                          style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
                        >
                          {/* Os `VAGAS` primeiros, sem ordinal: numerá-los
                          reintroduziria a hierarquia que o resultado não tem.

                          🔴 Continua `VAGAS` (2) mesmo com `topDaUf` devolvendo
                          4 desde 19/09 — e isso NÃO é uma pendência. Esta linha
                          não é "o top da UF": é "quem fica com as duas
                          cadeiras". Imprimir quatro nomes num lugar que o
                          leitor lê como os ocupantes diria que quatro pessoas
                          ocupam duas vagas. O que os dois nomes extras fazem
                          aqui é alimentar a margem à direita (2º−3º). */}
                          {disputam.slice(0, VAGAS).length > 0
                            ? disputam
                                .slice(0, VAGAS)
                                // Desenhado ⇒ abreviado (2026-09-19): dois
                                // nomes + duas siglas num `truncate`.
                                .map(rotuloCandidatura)
                                .join(" · ")
                            : "aguardando apuração"}
                        </span>
                        {/* Visível, não `sr-only`. Texto escondido é uma segunda
                          verdade que ninguém revisa e que apodrece — e este
                          conteúdo não é muleta de acessibilidade: quem enxerga
                          também lia "2,3% p/ 2ª vaga" sem nunca saber contra
                          QUEM eram os 2,3%. */}
                        {partesFora.length > 0 ? (
                          <span
                            data-testid="corrida-fora"
                            style={{ font: "var(--type-body-sm)", color: "var(--text-muted)" }}
                          >
                            Fora das vagas: {partesFora.join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="text-right"
                        data-testid="corrida-margem"
                        style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
                      >
                        {margem === null ? "—" : `${formatPercent(Math.abs(margem), 1)} p/ 2ª vaga`}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
            {/* ADR-0053 / RF-213 — só quando alguma UF tem anulada no corte. */}
            {payload.por_uf.some((uf) => haAnulada(uf.top_candidatos)) ? (
              <p
                className="max-w-prose"
                data-testid="senado-nota-anuladas"
                style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}
              >
                {NOTA_ANULADAS_SEM_REGRA_1T}
              </p>
            ) : null}
          </div>
        ) : (
          <p
            className="max-w-prose"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            Nenhum estado apurado ainda. As 27 corridas aparecem aqui conforme o TSE divulga os
            primeiros boletins.
          </p>
        )}
      </Panel>

      {/* Seção 4 — RF-108 + constituição § 8. */}
      <Panel kicker="Metodologia">
        {/* RF-158 — o bloco fica em fase pré (constituição § 8), em prosa. As
            duas frases de granularidade e cadência não entram ali: as duas
            estão no presente ("lemos o boletim agregado por estado", "os
            números são atualizados a cada 5 minutos") sobre números que ainda
            não existem. */}
        <ForecastTransparency
          pctApurado={payload.pct_apurado_total}
          preEleicao={pre}
          variant="national"
          granularidade={cargoInfo(CARGO_SENADOR).granularidade}
          cadenciaMinutos={CADENCIA_MIN}
        />
      </Panel>

      <Footer />
    </main>
  );
}
