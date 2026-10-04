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
import { EtiquetaFiltro } from "@/components/atoms/controls/EtiquetaFiltro";
import { Figure } from "@/components/atoms/data/Figure";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { ComposicaoVagasLista } from "@/components/blocks/ComposicaoVagasLista";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { RegiaoConsolidada } from "@/components/blocks/RegiaoConsolidada";
import { RenovacaoPanel } from "@/components/blocks/RenovacaoPanel";
import { SenadoDe2027Panel } from "@/components/blocks/SenadoDe2027Panel";
import { SenadoHemicicloPanel } from "@/components/blocks/SenadoHemiciclo";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import { Footer } from "@/components/layout/Footer";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { cargoInfo } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import { agruparPorRegiao } from "@/lib/config/regioes";
import { resultadoEleitoral, simulacaoNacional } from "@/lib/dev/simulacao";
import { readProjection } from "@/lib/edge-config/reader";
import type { EdgePayload } from "@/lib/edge-config/types";
import { lerEtiquetas } from "@/lib/etiquetas/leitor";
import { editorialDaCapa } from "@/lib/etiquetas/telas";
import { MANDATO_2027 } from "@/lib/senado/mandato-2027";
import { MANDATO_2031 } from "@/lib/senado/mandato-2031";
import { haAnulada, NOTA_ANULADAS_SEM_REGRA_1T } from "@/lib/utils/destino-voto";
import { textForParty } from "@/lib/utils/party-color";
import { VAGA_LABEL } from "@/lib/utils/selo-resultado";
import {
  nomesDoPartido,
  nomesNaParcial,
  nomesNaProjecao,
} from "@/lib/utils/senado-nomes-das-vagas";
import { composicaoNaParcial } from "@/lib/utils/senado-parcial";
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

  // Spec 025 — etiquetas editoriais (chips, filtro, V1, V2, V4): lidas no
  // servidor (Blob com revalidate 60, ou a cópia do build), nunca do payload.
  // Com as chaves de `publicar.json` desligadas, nada abaixo muda a página.
  const etiquetas = await lerEtiquetas();
  const capa = editorialDaCapa(etiquetas, payload.por_uf, {
    cargo: CARGO_SENADOR,
    turno: 1,
    preEleicao: pre,
    vagasUf: VAGAS,
  });

  // Segmentos da barra de composição: cada partido ocupa a fração das vagas
  // EM DISPUTA que a projeção lhe dá. 🔴 RF-219 (spec 023, ADR-0061 item 5):
  // cor do PARTIDO pela sigla (`textForParty`, ADR-0024), a mesma das bolinhas
  // do hemiciclo de 81 logo abaixo — não mais a cor por posição na lista
  // (ADR-0013, superado), que dava ao mesmo partido duas cores na página.
  const vagasEmDisputa = composicao?.vagas_em_disputa ?? 0;
  const segmentos: VoteBarSegment[] = composicao
    ? composicao.por_partido.map((p) => ({
        id: p.partido,
        label: p.partido,
        pct: vagasEmDisputa > 0 ? (p.vagas * 100) / vagasEmDisputa : 0,
        color: textForParty(p.partido),
      }))
    : [];
  const aguardando = composicao ? Math.max(0, vagasEmDisputa - composicao.vagas_projetadas) : 0;

  // 04/10/2026 (dono) — a mesma composição "se a apuração parasse agora": os
  // dois mais votados ATÉ AQUI em cada UF (`lib/utils/senado-parcial.ts`), UF
  // sem apurado aguardando, UF concluída igual à projeção. Mesma regra de cor
  // da barra da projeção (`textForParty`).
  const vagasPorUf = composicao?.vagas_por_uf ?? VAGAS;
  const parcial = composicao
    ? composicaoNaParcial(payload.por_uf, vagasPorUf, vagasEmDisputa)
    : null;

  // RF-301 (04/10/2026, dono) — quem ocupa as vagas de cada partido, nas duas
  // bases, pelas MESMAS derivações da contagem (`lib/utils/senado-nomes-das-vagas.ts`).
  // Projeção: `null` quando a derivação não fecha com `composicao_vagas` ⇒ as
  // linhas ficam só com o número. Fase pré: nada a nomear.
  const nomesProj = composicao && !pre ? nomesNaProjecao(payload, vagasPorUf) : null;
  const nomesParcial =
    parcial && !pre ? nomesNaParcial(payload.por_uf, vagasPorUf, vagasEmDisputa) : null;
  const linhasProj = composicao
    ? composicao.por_partido.map((p) => ({
        partido: p.partido,
        vagas: p.vagas,
        nomes: nomesDoPartido(nomesProj, p.partido, p.vagas),
      }))
    : [];
  const linhasParcial = parcial
    ? parcial.porPartido.map((p) => ({
        partido: p.partido,
        vagas: p.vagas,
        nomes: nomesDoPartido(nomesParcial, p.partido, p.vagas),
      }))
    : [];
  const segmentosParcial: VoteBarSegment[] = parcial
    ? parcial.porPartido.map((p) => ({
        id: p.partido,
        label: p.partido,
        pct: vagasEmDisputa > 0 ? (p.vagas * 100) / vagasEmDisputa : 0,
        color: textForParty(p.partido),
      }))
    : [];

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
          <>
            {/* 04/10/2026 (dono) — o bloco reage à chave "Parcial / Projeção":
              duas versões, cada uma sob um `<div data-view-only>` NU (sem
              classe de `display` — `app/globals.css`). A da projeção é a de
              sempre; a da Parcial segue o precedente de `/governador` ("Se a
              apuração parasse agora"). A escondida sai da árvore de
              acessibilidade, e o `<h2>` do painel é um só. */}
            <div data-view-only="proj">
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

                {/* RF-107 + RF-301 — "N PARTIDO" por linha, e cada partido abre
                    com quem ocupa as vagas (`<details>`, zero JS). Desenhado ⇒
                    sigla abreviada (2026-09-19); o `ariaLabel` do `<VoteBar>`
                    acima e o `<summary>` dizem a sigla inteira.
                    🔴 Esta é a composição do SENADO, não a bancada da Câmara:
                    a exceção do dono ("home de Deputados não abrevia") é da
                    rota `/deputado-federal`, não de toda tela que lista
                    partido. */}
                <ComposicaoVagasLista
                  linhas={linhasProj}
                  aguardando={aguardando}
                  ufsAguardando={nomesProj?.ufsAguardando ?? null}
                  selo={VAGA_LABEL.proj}
                  testId="composicao-partidos"
                  testIdAguardando="composicao-aguardando"
                />

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
                  O Senado tem <strong>{composicao.total_cadeiras ?? 81} cadeiras</strong>. Em 2026
                  a eleição renova dois terços delas — as{" "}
                  <strong>{vagasEmDisputa} que aparecem aqui</strong>. As outras{" "}
                  {(composicao.total_cadeiras ?? 81) - vagasEmDisputa} são de senadores eleitos em
                  2022, com mandato até 2031: não estão em disputa e não entram nesta contagem. O
                  total por partido é a soma das 27 corridas estaduais — o TSE não publica um
                  arquivo nacional para este cargo.
                  {/* RF-301 — só quando há o que abrir. */}
                  {linhasProj.some((l) => l.nomes) ? " Abra um partido para ver os nomes." : null}
                </p>
              </div>
            </div>
            <div data-view-only="parcial">
              <section
                aria-labelledby="composicao-parcial-heading"
                className="flex flex-col"
                data-testid="composicao-parcial"
                style={{ gap: "var(--space-4)" }}
              >
                <h3
                  id="composicao-parcial-heading"
                  style={{ margin: 0, font: "var(--type-title)", fontSize: "var(--text-lg)" }}
                >
                  Se a apuração parasse agora
                </h3>
                <p
                  className="max-w-prose"
                  style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
                >
                  O que já saiu das urnas, sem projeção: em cada estado, as duas vagas ficam com os
                  dois mais votados até aqui.
                </p>
                {parcial && parcial.atribuidas > 0 ? (
                  <>
                    <VoteBar
                      ariaLabel={`Vagas em disputa se a apuração parasse agora: ${parcial.porPartido
                        .map((p) => `${p.partido} ${p.vagas}`)
                        .join(
                          ", ",
                        )}${parcial.aguardando > 0 ? `; ${parcial.aguardando} aguardando apuração` : ""}`}
                      marker={null}
                      segments={segmentosParcial}
                      showLabels={false}
                    />
                    {/* RF-301 — os nomes da Parcial saem de `vagasNaParcial`,
                        a MESMA lista que esta contagem soma; UF aguardando
                        nunca vira nome — vai para a linha "aguardando". */}
                    <ComposicaoVagasLista
                      linhas={linhasParcial}
                      aguardando={parcial.aguardando}
                      ufsAguardando={nomesParcial?.ufsAguardando ?? null}
                      selo={VAGA_LABEL.parcial}
                      testId="composicao-partidos-parcial"
                      testIdAguardando="composicao-aguardando-parcial"
                    />
                  </>
                ) : (
                  // Nenhuma UF com contagem utilizável: diz que não tem, sem
                  // número nenhum (decisão do dono, 14/09 — nunca um zero de
                  // resgate).
                  <p
                    className="max-w-prose"
                    data-testid="composicao-parcial-vazia"
                    style={{
                      margin: 0,
                      font: "var(--type-body-sm)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Nenhum estado tem votos apurados para senador ainda. A contagem por partido
                    aparece aqui quando a apuração começar.
                  </p>
                )}
                <p
                  className="max-w-prose"
                  data-testid="composicao-nota-parcial"
                  style={{
                    margin: 0,
                    font: "var(--type-body-sm)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    textWrap: "pretty",
                  }}
                >
                  Retrato do que já foi contado, não resultado nem projeção. Estado ainda sem votos
                  apurados fica aguardando; estado com a apuração concluída conta igual à projeção.
                  O total por partido é a soma das 27 corridas estaduais. Não oficial.
                  {linhasParcial.some((l) => l.nomes)
                    ? " Abra um partido para ver os nomes."
                    : null}
                </p>
              </section>
            </div>
          </>
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

      {/* Spec 023 (RF-215..RF-218, ADR-0061 item 3) — o Senado de 2027: as 54
          em disputa somadas aos 27 mandatos até 2031. Some sozinho se a conta
          não fechar com `composicao_vagas` (RF-217). */}
      <SenadoHemicicloPanel payload={payload} mandato={MANDATO_2031} />

      {/* Spec 025 (RF-242/243/249) — V1 (Senado de 2027 por bloco), V2
          (impeachment de ministros do STF) e V4 (renovação). Cada uma só
          aparece com a chave ligada, o critério publicado e o portão de
          cobertura aberto; fechada, não desenha nada. */}
      <SenadoDe2027Panel payload={payload} mandato={MANDATO_2031} etiquetas={etiquetas} />
      <RenovacaoPanel payload={payload} mandato2027={MANDATO_2027} etiquetas={etiquetas} />

      {/* Seção 3 — as corridas, estado a estado. A margem de cada linha é a
          da 2ª vaga (RF-104): `top_candidatos[1].pct − top_candidatos[2].pct`.
          É lista, não mapa: este cargo não tem dado municipal (ADR-0026). */}
      {/* Constituição § 1 — o consolidado regional (ADR-0057) é número do
          modelo: o kicker diz "não oficial" fora da fase pré (RF-161). O
          `titleId` fica: é o alvo do `aria-describedby` do mapa do Senado. */}
      <Panel
        kicker={pre ? "Corridas estaduais" : "Corridas estaduais · não oficial"}
        title="Estado a estado"
        titleId="corridas-heading"
      >
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
            {/* 🔴 2026-10-04 (dono, auditoria P1) — o "● ELEITO" de 29/09 nos
                dois ocupantes de vaga projetados virou "Vaga projetada"; o selo
                verde "Matematicamente eleito" só sai de `eleitos_definidos`
                (`<GovernorCard>`). A frase abaixo acompanha. Era: "● ELEITO"
                nos DOIS ocupantes de vaga (spec 016, emenda do RF-105).

                🔴 2026-09-27 (decisão do dono) — o MESMO cartão de
                `/governador` (`<GovernorCard cargo="sen">`): as quatro
                primeiras posições e "Outros", sempre em % dos votos válidos do
                estado (`top_candidatos[].pct` + `outros.pct` fecham 100 por
                UF). Substitui a linha "ocupantes · Fora das vagas · margem p/
                2ª vaga" de 19/09. A margem da 2ª vaga continua na tela do
                estado (`/uf/[sigla]/senador`, RF-104). Cada cartão segue sendo
                o link para essa tela, e a lista continua o alvo do
                `aria-describedby` do mapa nacional (`corridas-heading`). */}
            {/* 04/10/2026 (dono) — o texto acompanha a base dos cartões. Um
                `<p>` não tem classe de `display`, então pode levar o
                `data-view-only` direto. */}
            <p
              className="max-w-prose"
              data-view-only="proj"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              Os quatro mais votados de cada estado e a soma dos demais, em percentual dos votos
              válidos. São duas vagas por estado: pela projeção, ficam com elas as duas primeiras
              posições, que levam o selo "vaga projetada" — não é o resultado oficial. O selo
              "matematicamente eleito" só aparece quando a contagem já garante a vaga.
            </p>
            <p
              className="max-w-prose"
              data-view-only="parcial"
              style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
            >
              Os quatro mais votados até agora em cada estado e a soma dos demais, em percentual dos
              votos já apurados. Se a apuração parasse agora, as duas vagas ficariam com os que
              levam o selo "vaga na parcial" — não é resultado nem projeção.
            </p>
            {/* Spec 025 (RF-247) — filtro por etiqueta: esconde corridas, nunca reordena. */}
            {capa.filtro.length > 0 ? (
              <EtiquetaFiltro grupos={capa.filtro} esconderRegiaoVazia />
            ) : null}
            {/* 🔴 ADR-0057 (2026-09-28, decisão do dono) — agrupado por
                REGIÃO, com o consolidado por partido no topo de cada uma, em
                "% dos votos" (cada eleitor vota duas vezes). A lista externa
                mantém o rótulo de sempre e passa a ser a lista das cinco
                regiões; cada região traz a própria lista de estados, e cada
                cartão continua sendo o link para `/uf/[sigla]/senador`. */}
            <ul
              aria-label="Corridas estaduais de senador"
              className="grid grid-cols-1 gap-3"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {agruparPorRegiao(payload.por_uf).map((grupo) =>
                grupo.rows.length > 0 ? (
                  <li key={grupo.regiao.id}>
                    <RegiaoConsolidada
                      regiao={grupo.regiao}
                      ufs={grupo.rows}
                      chave="partido"
                      senado
                      nivel={3}
                    >
                      <ul
                        aria-label={`Estados do ${grupo.regiao.nome}`}
                        className="grid grid-cols-1 gap-3"
                        style={{ listStyle: "none", margin: 0, padding: 0 }}
                      >
                        {grupo.rows.map((uf) => (
                          <li key={uf.sigla} {...capa.atributos(uf.sigla)}>
                            <a
                              href={`/uf/${uf.sigla}/senador`}
                              data-testid="corrida-uf"
                              data-uf={uf.sigla}
                              className="block"
                              style={{ color: "inherit", textDecoration: "none" }}
                            >
                              <GovernorCard
                                uf={uf}
                                candidatos={payload.national.candidatos}
                                cargo="sen"
                                nivelTitulo={4}
                                etiquetas={capa.chips(uf.sigla)}
                                duasBases
                                turno={payload.turno}
                              />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </RegiaoConsolidada>
                  </li>
                ) : null,
              )}
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
            {capa.aviso ? <EtiquetasAviso /> : null}
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
