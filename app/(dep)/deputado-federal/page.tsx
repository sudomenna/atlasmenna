/**
 * app/(dep)/deputado-federal/page.tsx — T-11, spec 017 (Deputado Federal).
 *
 * A visão nacional da corrida proporcional: como a bancada da Câmara está se
 * formando, agremiação por agremiação, e o que ainda não dá para dizer.
 *
 * ## A decisão de leitura que governa esta tela
 *
 * Esta corrida **não tem líder**. Toda a gramática que as outras rotas usam —
 * agulha, duelo A×B, margem do primeiro sobre o segundo, chance de 2º turno —
 * descreve uma disputa majoritária e aqui não tem referente: o que se elege é
 * um conjunto de 513 cadeiras, e quem as ganha é a **agremiação**, não o
 * candidato mais votado. Por isso o payload tem tipo próprio
 * (`EdgePayloadDeputado`, design 017 § D1) e esta página não monta nenhum
 * componente de corrida majoritária.
 *
 * O fato que a tela existe para contar é o que o leitor tende a errar sozinho:
 * **um partido pode ganhar votos e perder cadeira**, e a última vaga de um
 * estado se decide por algumas centenas de votos.
 *
 * ## Por que esta rota não tem mapa
 *
 * ⚠️ **Corrigido em 2026-09-13.** Este parágrafo dizia que o cargo 6 é
 * ingerido em granularidade **UF** (27 arquivos por ciclo, sem quebra por
 * município ou zona) e usava isso para justificar a ausência de mapa. O
 * ADR-0036 inverteu o fato: o cargo 6 lê o par (município, zona), ~6.110
 * alvos, varridos em 6 fatias com volta completa a cada 30 min.
 *
 * **A ausência do mapa não é mais consequência de falta de dado.** Passou a
 * ser escopo: a rota fica fora do `<AppShellSplit>`/`<PersistentMapFrame>`
 * (ADR-0033 § 1), como `/senador`, e desenhar o recorte municipal de uma
 * corrida proporcional é decisão de produto que ninguém tomou. Registrar a
 * razão verdadeira importa porque a razão anterior aparecia **na tela do
 * leitor**, em `<DeputadoMetodologia>`, e ficou falsa junto.
 *
 * ## Nenhum número escrito à mão (design 017 § D8)
 *
 * Lição de 2026-09-11: quatro frases da tela de Senador viraram falsas quando
 * a granularidade do cargo 5 mudou, e uma delas atribuía ao TSE uma limitação
 * que era escolha nossa. Aqui:
 *
 *   - o total de cadeiras sai de `bancada.total_cadeiras`, **nunca** do literal
 *     `513` escrito neste arquivo — o número chega pelo payload;
 *     ⚠️ **corrigido em 2026-09-19**: até esta data a justificativa era "o
 *     número é a soma dos `lugares_a_preencher` que o TSE publicou, e a
 *     redistribuição pelo Censo 2022 (PLP 177/2023) não está confirmada". As
 *     duas metades morreram. A soma **não podia** ser o total: ela cresce
 *     durante a noite, e com três estados pequenos apurando esta tela escrevia
 *     "26 cadeiras em disputa". E o PLP 177/2023 foi vetado integralmente em
 *     julho/2025, com o STF mantendo as 513 para este pleito. Hoje
 *     `total_cadeiras` é fato fixo no produtor do dado
 *     (`api/model/cargos.py`), conferido contra a soma quando as 27 UFs
 *     publicarem `carg[].nv` (RF-124);
 *   - a cadência sai de `atualizacao_min` (RF-128);
 *   - nome, slug, proporcionalidade e granularidade do cargo saem de
 *     `lib/config/cargos.ts`.
 *
 * E **sem payload a página não inventa número nenhum**: ela descreve a
 * estrutura e diz que a contagem aparece quando o primeiro boletim chegar. Um
 * `emptyPayload()` com `total_cadeiras: 0` imprimiria aqui "0 cadeiras em
 * disputa", que é falso.
 *
 * ✅ Esta rota era a única das quatro que já fazia isso certo. `/governador` e
 * `/senador` usavam o atalho do payload zerado e o publicavam como resultado;
 * em 2026-09-14 elas ganharam ramos de espera de verdade, irmãos deste.
 *
 * ## Cobertura
 *   - RF-122 — federação com identidade própria e componentes legíveis.
 *   - RF-125.1 — o que vai à tela é `cadeiras` (eleitos). `vagas_obtidas` não
 *     existe no payload e não é reconstruído.
 *   - RF-127 — incerteza explícita: intervalo quando houver, e marcação de
 *     cadeira indefinida sempre.
 *   - RF-128 — cadência + `ts` do payload.
 *   - RF-130 — voto de legenda distinguível do nominal.
 *   - ADR-0001 (Global Config no read path), ADR-0012 (chave nomeada),
 *     ADR-0024 (cor por sigla, nunca a oficial do partido), ADR-0026.
 *   - Constituição § 1 (não oficial), § 2 (cores por token), § 3 (degrada),
 *     § 4 (lista textual), § 6 (ordenação determinística), § 8 (transparência).
 *
 * ISR: 60 s (ADR-0011). O payload é reescrito a cada **30 min** — a volta
 * completa das 6 fatias do cron do cargo (ADR-0036, 2026-09-13; era 15 min
 * enquanto a ingestão era por UF). Revalidar em 1.800 s só serviria para
 * atrasar a primeira aparição. A cadência exibida na tela NÃO vem daqui:
 * sai de `atualizacao_min` do payload (§ D8) — este comentário é sobre o
 * cache, não sobre a prosa.
 */

import type { Metadata } from "next";

import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { FasePreEleicaoBanner } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { Figure } from "@/components/atoms/data/Figure";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { Camara2027Panel } from "@/components/blocks/Camara2027Panel";
import { CamaraHemiciclo } from "@/components/blocks/CamaraHemiciclo";
import { DeputadoBancadaPanel } from "@/components/blocks/DeputadoBancadaPanel";
import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoMetodologia } from "@/components/blocks/DeputadoMetodologia";
import { DeputadoPuxadores } from "@/components/blocks/DeputadoPuxadores";
import {
  agremiacoesDaLegenda,
  LegendaHemicicloCamara,
} from "@/components/blocks/LegendaHemicicloCamara";
import { RealceHemiciclo } from "@/components/blocks/RealceHemiciclo";
import { UfBandeirasGrid } from "@/components/blocks/UfBandeirasGrid";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import { Footer } from "@/components/layout/Footer";
import { SeletorDeputado } from "@/components/layout/SeletorDeputado";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { aplicarInterruptorNoNacional } from "@/lib/blob/deputado-uf";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import { cargoInfo } from "@/lib/config/cargos";
import { avaliarFrescorDado, fraseFrescorDado } from "@/lib/config/dado-freshness";
import { isPreEleicao } from "@/lib/config/fase";
import { resumosPorUf } from "@/lib/deputado/resumos-por-uf";
import {
  resultadoEleitoral,
  simulacaoDeputadoNacional,
  simulacaoLigada,
} from "@/lib/dev/simulacao";
import { readDeputadoProjection } from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { lerEtiquetas } from "@/lib/etiquetas/leitor";
import { ordenarBancada } from "@/lib/utils/bancada";
import { nacionalZeradoCamara } from "@/lib/zerado/deputado";
import depFixture from "@/tests/fixtures/edge-config/dep-current.json" with { type: "json" };

import { lerBancadaZerada, nacionalAusenteDaCasa } from "../_dados-da-casa";
import { lerInterruptorDaTela } from "../_interruptor";
import painel from "../_painel-desktop.module.css";

/** Código TSE deste cargo. Tudo o que descreve o cargo sai da tabela canônica. */
const CARGO_DEPUTADO = 6 as const;
const DEPUTADO = cargoInfo(CARGO_DEPUTADO);

/** Total de unidades da federação — é geografia, não um número da eleição. */
const TOTAL_UFS = 27;

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Câmara dos Deputados 2026 · AtlasMenna",
  description:
    "Como está a bancada da Câmara dos Deputados em 2026 com os votos já apurados, por partido e federação — 27 corridas proporcionais, turno único. Não oficial. Fonte: TSE.",
  alternates: { canonical: `/${DEPUTADO.slug}` },
  openGraph: {
    title: "Câmara dos Deputados 2026 · AtlasMenna",
    description:
      "Como a bancada da Câmara está se formando, partido a partido e federação a federação, com os votos já contados.",
    type: "website",
    locale: "pt_BR",
    siteName: "AtlasMenna",
  },
  twitter: {
    card: "summary_large_image",
    title: "Câmara dos Deputados 2026 · AtlasMenna",
    description: "A bancada da Câmara com os votos já apurados, estado a estado.",
  },
};

// ---------------------------------------------------------------------------
// Derivações puras
// ---------------------------------------------------------------------------

/*
 * `ordenarBancada` nasceu aqui e vive em `lib/utils/bancada.ts` desde
 * 2026-09-18 — a regra não mudou uma vírgula. Ela subiu porque o
 * `<CamaraHemiciclo>` precisa da MESMA ordem: com duas implementações, a quarta
 * cunha do plenário e a quarta linha desta lista passariam a ser agremiações
 * diferentes no primeiro empate de cadeiras, cada uma internamente consistente,
 * e ninguém notaria até a noite da apuração.
 */

/*
 * `resumosPorUf` (o texto de cada UF na grade "Estado a estado") nasceu aqui e
 * vive em `lib/deputado/resumos-por-uf.ts` desde a spec 027: a capa das
 * assembleias monta a mesma grade a partir de dois payloads, e duas cópias da
 * regra divergiriam.
 */

/*
 * `listarComponentes`, `corDaAgremiacao`, `corIdentidadeDaAgremiacao`,
 * `segmentosDaBancada` e `intervaloDeCadeiras` moraram aqui até a spec 027 e
 * foram, com o painel "Quem fica com as cadeiras", para
 * `components/blocks/DeputadoBancadaPanel.tsx` — com a história de cada
 * decisão (cor de identidade × cor de preenchimento, faixa `[n, n]`, segmento
 * "aguardando").
 */

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default async function DeputadoFederalPage() {
  // Chave própria (`projection-current-dep-t1`) e função própria: o envelope
  // deste cargo não é `EdgePayload` (design 017 § D1), e `readProjection` nem
  // aceita `cargo: "dep"` — ver `CargoMajoritario` em `lib/edge-config/reader.ts`.
  //
  // Só em `pnpm dev` a fixture entra, para que a rota possa ser inspecionada
  // de verdade. Em teste (`NODE_ENV=test`) e em produção o caminho
  // "aguardando" continua sendo exercitado.
  // 🔴 Simulação ligada ⇒ ela é a fonte de verdade e o Global Config nem é
  // lido. Ver a nota gêmea em `app/(gov)/governador/page.tsx`.
  //
  // Spec 026 (RF-265) — o interruptor da projeção vai em paralelo, e é
  // aplicado ao payload antes de qualquer bloco o ver
  // (`aplicarInterruptorNoNacional`). A capa lê SÓ o Global Config: os mais
  // votados e os puxadores do país vêm prontos no payload (RF-271) — nenhum
  // Blob de UF é lido aqui.
  const [payloadLido, interruptor] = await Promise.all([
    resultadoEleitoral(
      () => simulacaoDeputadoNacional(),
      async () =>
        (await readDeputadoProjection(6)) ??
        (process.env.NODE_ENV === "development"
          ? (depFixture as unknown as EdgePayloadDeputado)
          : null),
    ),
    lerInterruptorDaTela(CARGO_DEPUTADO, simulacaoLigada()),
  ]);

  // ADR-0076 (decisão do dono, 04/10) — placar ZERADO: chave AUSENTE ou
  // payload pré-eleição abrem o layout da apuração com 513 cadeiras sem dono
  // e as agremiações a zero, na ordem sorteada. 🔴 Leitura que FALHOU nunca
  // zera: `nacionalAusenteDaCasa` só diz "ausente" com a leitura dizendo isso.
  const zerado = isPreEleicao(payloadLido) || (!payloadLido && (await nacionalAusenteDaCasa(6)));
  if (!payloadLido && !zerado) return <AguardandoNacional />;
  const payload = zerado
    ? nacionalZeradoCamara(await lerBancadaZerada(6))
    : aplicarInterruptorNoNacional(payloadLido as EdgePayloadDeputado, interruptor);

  const bancada = payload.bancada;
  // Zerado: a ordem do sorteio do dia — reordenar zeros cairia no alfabeto.
  const agremiacoes = zerado ? bancada.por_agremiacao : ordenarBancada(bancada.por_agremiacao);

  // ADR-0038 D4. É nesta trilha que a diferença entre os dois relógios é maior:
  // o modelo roda e carimba `ts` muito mais vezes do que a varredura de 6
  // fatias renova o conjunto do dado (volta completa em 30 min, ADR-0036). O
  // limiar sai de `CADENCIA_SEGUNDOS[6]` × 3 = 5.400 s (90 min) — e não dos
  // 5 min do intervalo entre fatias, que é a leitura errada do cron.
  const frescorDado = avaliarFrescorDado(payload.dado_ts, payload.cargo);

  // Spec 025 (RF-244) — a Câmara de 2027 por bloco. Etiqueta lida no servidor
  // (Blob ou cópia do build), nunca do payload; desligada, o painel não sai.
  const etiquetas = zerado ? null : await lerEtiquetas();

  return (
    <main
      data-trilha="dep"
      className={`mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10 ${painel.main}`}
      style={{ gap: "var(--space-8)" }}
    >
      {/* Escopo nacional (o payload é o do país inteiro), mas esta trilha **não
          tem moldura de mapa**: `(dep)` não tem `layout.tsx` com
          `<PersistentMapFrame>`, então ninguém publica um `dado_ts` vivo para o
          cargo 6 e o banner fica com o veredito do servidor, como antes. É de
          propósito: sem relógio vivo, reavaliar por tempo faria o lag crescer
          para sempre e o aviso acenderia falsamente em toda aba deixada aberta
          por mais de 90 min. Quando esta trilha ganhar um poller de 30 min,
          basta ele registrar-se na store — este JSX não muda. */}
      {zerado ? null : <DadoParadoBanner frescor={frescorDado} />}

      {/* Spec 027 RF-283 — Federal · Estadual, antes do `<h1>`. */}
      <SeletorDeputado atual={CARGO_DEPUTADO} />

      {/* Seção 1 — o enquadramento da corrida. O `<h1>` é o título deste
          painel (ADR-0029 § 5). */}
      <Panel
        kicker={
          primeiroTurnoEncerrado()
            ? "Resultado final · 1º turno"
            : "Atlas Menna · apuração ao vivo · não oficial"
        }
        title="Câmara dos Deputados 2026"
        titleId="camara-heading"
        headingLevel={1}
      >
        <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
          <p
            className="max-w-prose"
            data-testid="dep-cadeiras-label"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            {/* `total_cadeiras` é o tamanho da Câmara, fato fixo no produtor
                do dado (`api/model/cargos.py`) desde 2026-09-19 — antes disso
                era a soma dos `lugares_a_preencher` já publicados, que com três
                estados pequenos no ar fazia esta frase dizer "26 cadeiras em
                disputa".

                🔴 **O ramo de 0 continua, e não é código morto defensivo**: o
                payload pode vir de um produtor que este arquivo não controla
                (fixture, simulação, uma versão anterior ainda no Global
                Config), e "0 cadeiras em disputa" seria tão falso quanto cravar
                513 no JSX. Um total ausente vira frase, nunca número. */}
            {bancada.total_cadeiras > 0 ? (
              <>
                <strong>{bancada.total_cadeiras} cadeiras</strong> em disputa, em turno único e por
                sistema proporcional:{" "}
              </>
            ) : (
              <>
                O TSE ainda não publicou quantas cadeiras cada estado elege, então não há total a
                exibir. A eleição é em turno único e por sistema proporcional:{" "}
              </>
            )}
            quem ganha cadeira é a agremiação, e só depois ela é ocupada pelos candidatos mais
            votados dentro dela. Por isso um partido pode ganhar votos e <strong>perder</strong>{" "}
            cadeira. Não oficial. Fonte: TSE.
          </p>

          <div className="grid grid-cols-2" style={{ gap: "var(--space-4)" }}>
            <Figure
              label="Apurado"
              note={`${payload.ufs_apuradas} de ${TOTAL_UFS} estados com boletim`}
              unit="%"
              value={payload.pct_apurado_total.toLocaleString("pt-BR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            />
            <Figure
              label="Cadeiras definidas"
              note={`${
                bancada.total_cadeiras > 0 ? `de ${bancada.total_cadeiras} — ` : ""
              }${bancada.ufs_aguardando} ${
                bancada.ufs_aguardando === 1 ? "estado ainda sem" : "estados ainda sem"
              } boletim`}
              size="lg"
              value={String(bancada.cadeiras_atribuidas)}
            />
          </div>

          {/* O plenário. Server Component, SVG inline, zero JavaScript — ver o
              cabeçalho de `CamaraHemiciclo.tsx`.

              `descritoPorId` aponta para a LISTA de agremiações do painel
              abaixo: constituição § 4 exige lista textual paralela a gráfico
              colorido, a lista já existia, e o que faltava era a ligação. O
              `id` foi acrescentado lá para este `aria-describedby` ter alvo
              existente — apontar para o nada é pior que não apontar, porque
              parece resolvido. */}
          {/* Sem cadeira publicada o `<CamaraHemiciclo>` não desenha nada, e o
              invólucro vazio somaria um vão à coluna. */}
          {bancada.total_cadeiras >= 1 ? (
            <RealceHemiciclo
              raiz="camara"
              atributo="data-cod"
              chaves={agremiacoesDaLegenda(bancada).map((a) => a.cod)}
              className={`flex flex-col ${painel.plenario}`}
              style={{ gap: "var(--space-3)" }}
            >
              <CamaraHemiciclo bancada={bancada} descritoPorId="bancada-agremiacoes" />
              {/* RF-294 — legenda compacta sob o plenário, ligada ao realce por
                agremiação (passar o mouse numa cadeira ou numa linha esmaece
                as outras). `aria-hidden`: o equivalente textual continua sendo
                `#bancada-agremiacoes`. */}
              <LegendaHemicicloCamara bancada={bancada} />
            </RealceHemiciclo>
          ) : null}

          {/* RF-128 — o instante do payload. A frequência fica no bloco de
              metodologia, que é onde a explicação do método mora; aqui só o
              "de quando é este número".

              ADR-0038 D1: o "de quando" passou a ser a hora do DADO
              (`dado_ts`), não a hora em que o modelo rodou. `fraseFrescorDado`
              resolve os quatro estados num lugar só — inclusive o de payload
              pré-ADR, em que a frase volta a ser exatamente a de antes
              ("Atualizado às HH:MM:SS"), porque durante o canary a tela se
              comporta como se comportava. */}
          {zerado ? null : (
            <p
              data-testid="dep-atualizacao"
              style={{
                margin: 0,
                font: "var(--type-data)",
                color: "var(--text-muted)",
              }}
            >
              {fraseFrescorDado(frescorDado, payload.ts)}
              {payload.atualizacao_min > 0 && !primeiroTurnoEncerrado()
                ? `, a cada ${payload.atualizacao_min} ${
                    payload.atualizacao_min === 1 ? "minuto" : "minutos"
                  }`
                : ""}
              .
            </p>
          )}
        </div>
      </Panel>

      {/* Spec 025 (RF-244) — "Câmara de 2027: quem terá maioria", depois do
          plenário por partido (que fica igual, sem marca de limiar — ADR-0049
          item 6 vale para ELE; as marcas moram só na visão por bloco).

          Spec 026 RF-299 (04/10, decisão do dono) — sozinho na linha: a
          bancada saiu do par e virou a última seção de conteúdo, lá embaixo.
          Sem o invólucro `.par` (ADR-0073): com uma criança só, ele não
          dispunha nada, e com o painel desligado (etiquetas fora) sobraria
          uma caixa vazia levando o `gap` do `<main>`. */}
      {etiquetas ? <Camara2027Panel bancada={bancada} etiquetas={etiquetas} /> : null}

      {/* Spec 021 RF-192 — EMENDADO em 2026-09-26 (noite), decisão do dono:
          "Votação" SAIU desta capa (repetia o eleitorado do Brasil da capa de
          Presidente). Vive em `/uf/[sigla]/deputado-federal`, com o dado DA
          UF. */}

      {/* Seção 2b — destaques por template (ADR-0005, NUNCA LLM).
          **Hoje a lista vem vazia e isso não é erro** (design 017 § D10): os
          templates determinísticos da corrida proporcional não existem, e é o
          estado esperado no dia 15. Por isso o bloco é condicional em vez de
          um painel sempre presente com miolo vazio — um título "Destaques" sem
          nada embaixo diz ao leitor que algo falhou, quando nada falhou. Não é
          exceção ao ADR-0017: ali o que não pode sumir é dado que EXISTE. */}
      {payload.insights.length > 0 && !primeiroTurnoEncerrado() ? (
        <Panel kicker="Destaques" title="O que chama atenção" titleId="insights-heading">
          <ul
            data-testid="dep-insights"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--space-2)",
            }}
          >
            {payload.insights.map((frase) => (
              <li key={frase} className="max-w-prose" style={{ font: "var(--type-body-sm)" }}>
                {frase}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* Seção 3 — as 27 corridas, com bandeira. É lista, não mapa: este cargo
          não tem dado municipal (ADR-0026 item 1).

          🔴 A grade **acrescenta** a bandeira; ela não substitui informação.
          Todo texto que a lista anterior carregava — maior bancada, empates sem
          desempate previsto, vagas sem candidato elegível, o placar de cadeiras
          — continua aqui, vindo de `resumosPorUf`. Trocar dado que EXISTE por
          um ícone bonito é o defeito que o ADR-0017 nomeia.

          E os 27 estados aparecem sempre, inclusive os sem boletim: o ramo
          "Nenhum estado apurado ainda" sumiu junto com a lista parcial, porque
          um estado ausente da grade se lê como estado que não elege ninguém.
          Sem dado, o item diz "aguardando apuração" e "vagas não publicadas" —
          nunca um zero (RF-124). */}
      {/* Spec 026 RF-271 / RF-273 — os mais votados e os puxadores do país,
          do payload nacional (autossuficiente). Payload anterior à spec 026
          não tem os campos, e os blocos não aparecem. */}
      {/* ADR-0073 — lado a lado a partir de 1280px; abaixo, `display: contents`. */}
      {zerado ? null : (
        <div className={painel.par}>
          <DeputadoMaisVotados
            cargo={CARGO_DEPUTADO}
            escopo="pais"
            linhas={payload.mais_votados}
            titleId="mais-votados-pais-heading"
          />
          <DeputadoPuxadores
            cargo={CARGO_DEPUTADO}
            puxadores={payload.puxadores}
            titleId="puxadores-heading"
          />
        </div>
      )}

      <Panel kicker="Corridas estaduais" title="Estado a estado" titleId="corridas-heading">
        <UfBandeirasGrid cargo={CARGO_DEPUTADO} resumos={resumosPorUf(payload, interruptor)} />
      </Panel>

      {/* Seção 2 — a bancada. RF-122, RF-125.1, RF-127, RF-130. O painel
        saiu para `<DeputadoBancadaPanel>` na spec 027 (design § 8.4): a capa
        das assembleias mostra o mesmo painel sobre a soma das 27 casas.

        Spec 026 RF-299 (04/10, decisão do dono) — a ÚLTIMA seção de
        conteúdo: depois de "Estado a estado", antes da metodologia. Com
        `eleitosNacionais`, cada agremiação abre os eleitos do país e, na base
        "Projeção", mostra o cenário projetado nacional ao lado da parcial
        (RF-300). `projecaoLigada` é o interruptor lido AGORA, nesta
        renderização (RF-265): o segundo ponto de leitura, que vale sobre a
        resposta da rota (ADR-0063 emenda 04/10 (2), item 5). A capa continua
        sem ler Blob de UF (RF-271): quem lê é a rota, no navegador, sob
        demanda. */}
      <DeputadoBancadaPanel
        kicker="Bancada apurada"
        title="Quem fica com as cadeiras"
        titleId="bancada-heading"
        agremiacoes={agremiacoes}
        total={bancada.total_cadeiras}
        atribuidas={bancada.cadeiras_atribuidas}
        rotuloBarra={`Bancada de ${bancada.total_cadeiras} cadeiras`}
        {...(zerado
          ? {}
          : {
              eleitosNacionais: {
                projecaoLigada: interruptor.ligada,
                // Reserva do rótulo do cenário (sem salto): alguma UF já liberada
                // no payload que a página leu — já com o interruptor aplicado.
                cenarioEsperado:
                  interruptor.ligada &&
                  payload.por_uf.some((u) => u.projecao?.estado === "liberada"),
              },
            })}
        // Decisão do dono, 04/10: só agremiação com cadeira na parcial.
        // Zerado (ADR-0076): todas, a zero.
        ocultarSemCadeira={!zerado}
        fraseAguardando={
          <>
            cadeiras ainda sem dono — {bancada.ufs_aguardando} de {TOTAL_UFS} estados sem boletim e
            vagas que a distribuição ainda não fechou.
          </>
        }
        nota={
          <>
            {/* Constituição § 8 — de onde vem o número. Os dois fatos que o
        leitor não tem como inferir da tela: que o agregado nacional é
        soma nossa, e que o próprio total de cadeiras é dado publicado,
        não constante. */}
            <p
              className="max-w-prose"
              data-testid="bancada-nota"
              style={{
                margin: 0,
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                textWrap: "pretty",
              }}
            >
              Esta contagem é a <strong>soma das {TOTAL_UFS} corridas estaduais</strong> — o TSE não
              publica um arquivo nacional para este cargo, então não existe um número oficial a
              reproduzir: o que existe são {TOTAL_UFS} apurações estaduais, e a soma é nossa. Já o
              total de {bancada.total_cadeiras} cadeiras não é soma nenhuma: é o tamanho da Câmara,
              fixo desde antes da urna abrir, e todas elas são renovadas nesta eleição. Quantas cada
              estado elege continua vindo do dado que o TSE publica, e nós conferimos uma coisa
              contra a outra. Cadeira contada é cadeira com candidato eleito: quando a conta de um
              partido dá direito a uma vaga que nenhum candidato dele pode ocupar, a vaga vai para
              as sobras e não aparece aqui.
              {zerado
                ? null
                : primeiroTurnoEncerrado()
                  ? " Partidos e federações sem nenhuma cadeira ficam fora da lista."
                  : " Partidos e federações sem nenhuma cadeira na parcial ficam fora da lista."}
            </p>
          </>
        }
      />

      {/* Seção 4 — constituição § 8 (método da parcial e, desde o ADR-0063, da
          projeção por UF, que superou o § D9 do design 017). */}
      <DeputadoMetodologia
        pctApurado={payload.pct_apurado_total}
        cadenciaMinutos={payload.atualizacao_min}
        // Derivado do payload, nunca fixo: sem zonas para reamostrar não há
        // faixa, e o texto do bloco precisa acompanhar sozinho (ADR-0036 fez
        // a frase anterior virar falsa na tela).
        temIntervalo={payload.bancada.por_agremiacao.some((a) => a.cadeiras_ci95 !== undefined)}
        interruptorLigado={interruptor.ligada}
        interruptorOrigem={interruptor.origem}
        pctMinimo={interruptor.pct_minimo}
        // Spec 026 RF-300 — o método do cenário nacional misto (§ 8).
        cenarioNacional
        // Constituição § 8 — com o selo de projeção de algum estado na tela
        // (interruptor ligado, `resumosPorUf`), o bloco traz o "o que está
        // movendo a projeção · não oficial" compacto. Mesma condição dos selos.
        projecaoPorUf={payload.por_uf.flatMap((u) =>
          u.projecao ? [{ sigla: u.sigla, estado: u.projecao.estado }] : [],
        )}
      />

      <Footer />
    </main>
  );
}

/**
 * Estado sem payload — a página **não some** (constituição § 3) e **não
 * inventa número** (design 017 § D8).
 *
 * Nenhuma contagem de cadeiras aparece aqui, nem 513 nem 0: sem payload não
 * sabemos quantas vagas o TSE publicou — e o § D9.1 registra que nem sequer
 * está confirmado que ele as publica antes do primeiro boletim. O bloco de
 * metodologia permanece, porque a constituição § 8 o exige em toda página que
 * exibe número de apuração — inclusive quando ainda não há número —, mas sem a
 * frase de cadência, que também viria do payload.
 *
 * ## RF-163 — Deputado Federal não é semeado, e esta tela ganha o aviso
 *
 * Decisão do dono do produto em 2026-09-13, e **não é opção em aberto**: o
 * semeador da spec 019 não grava nenhuma chave de cargo `dep`. A razão é que
 * esta tela lista **cadeiras por partido**, não pessoas — semeá-la produziria
 * "0 cadeiras" para cada legenda, que é a mesma mentira das outras telas em
 * outra unidade, e **nenhuma identidade ganharia**: não há onde pôr rosto aqui.
 * O ganho que justifica a fase pré nos outros três cargos não existe; sobra só
 * o custo.
 *
 * Então esta tela continua sem payload — e sem payload não há campo `fase` de
 * onde ler. `faseDoPayload(null)` devolve `"normal"` por construção
 * (`lib/config/fase.ts`), e é deliberado.
 *
 * **A faixa aqui é incondicional, e quem decide é o chamador** (design 019
 * § D5): este ramo JÁ significa "não há apuração publicada", e a faixa é a
 * afirmação em prosa do que o ramo já é. A alternativa — gatear por data de
 * calendário — foi rejeitada: relógio de servidor errado ou fuso mal resolvido
 * produziria a faixa no meio da noite de apuração.
 *
 * ## ✅ 2026-09-14 — a contradição com o RNF-010 fechada pelo TEXTO, não pela fiação
 *
 * A versão de 13/09 registrava aqui um custo assumido: este ramo também é onde
 * a página cai se o Global Config estiver indisponível em 04/10, e a faixa
 * diria "a eleição ainda não começou" **durante a apuração** — exatamente o que
 * o RNF-010 desaconselha (afirmar um fato sobre o calendário a partir de uma
 * falha de rede).
 *
 * A emenda do dono do produto resolve isso **mudando o texto, não a fiação**. A
 * faixa continua incondicional neste ramo — condicioná-la a alguma coisa seria
 * criar uma segunda fonte de fase, que é o defeito que a spec inteira existe
 * para evitar —, mas entra com `variante="sem_dados"`: ela diz que **esta
 * página não recebeu dados de apuração** e põe a data da votação ao lado, sem
 * ligar uma coisa à outra por causa. As duas frases são verdadeiras em
 * qualquer dia do calendário, inclusive às 21h de 04/10.
 *
 * 🔴 **A tentação recusada**: criar uma chave global de fase para dar evidência
 * positiva a esta tela. Em noite de apuração um interruptor global travado na
 * posição errada derruba tudo de uma vez; sinais independentes por cargo
 * degradam um de cada vez. O desenho atual já acertou nisso.
 *
 * O parágrafo `data-testid="dep-aguardando"` **continua presente e não é
 * reescrito** — é texto que três correções anteriores acertaram.
 */
function AguardandoNacional() {
  return (
    <main
      data-trilha="dep"
      className={`mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10 ${painel.main}`}
      style={{ gap: "var(--space-8)" }}
    >
      {/* 🔴 RF-160/RF-163 — PRIMEIRO FILHO do `<main>`, acima do parágrafo
          honesto. Teste de ORDEM, não de presença.

          A faixa continua **incondicional** neste ramo — simples, sem risco de
          sair de sincronia com a condição que trouxe a página até aqui. O que
          mudou em 2026-09-14 é o TEXTO: `variante="sem_dados"`. Ver a nota
          "⚠️ O custo assumido" no cabeçalho desta função, que este parágrafo
          responde. */}
      <FasePreEleicaoBanner
        corrida="a Câmara dos Deputados"
        variante="sem_dados"
        listaDeEstadosAbaixo
      />

      {/* RF-159 — o selo do `<TopBar>`. Esta rota nunca publicou custom
          property nenhuma; publica agora uma só, `variante="sem_dados"`
          (emenda de 2026-09-14).

          Esta tela é, por definição, a tela de quando não há payload — o
          RF-163 registra que o semeador não a alimenta. Publicar as três
          propriedades do selo afirmaria "a eleição ainda não começou" na
          barra do topo, que é a mesma frase que a faixa logo acima passou a
          recusar no mesmo dia. Sobra o segmentado "Parcial / Projeção",
          apagado por RF-161 — que não afirma calendário nenhum. */}
      <SeloFasePreStyle variante="sem_dados" />

      {/* Spec 027 RF-283 — depois da faixa (que precisa ser o primeiro filho,
          RF-160), antes do `<h1>`. Navegação existe também sem dado. */}
      <SeletorDeputado atual={CARGO_DEPUTADO} />

      <Panel
        // RF-159, mesma correção em outra superfície: "apuração ao vivo" era
        // falso nesta tela em qualquer dia do calendário — ela é, por
        // definição, a tela de quando não há apuração. O parágrafo abaixo
        // continua intocado; só o kicker parou de afirmar o contrário dele.
        kicker="Atlas Menna · não oficial"
        title="Câmara dos Deputados 2026"
        titleId="camara-heading"
        headingLevel={1}
      >
        <p
          className="max-w-prose"
          data-testid="dep-aguardando"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          Aguardando o primeiro boletim. A bancada — por partido e por federação — aparece aqui
          assim que o TSE divulgar a apuração de algum estado, junto com o número de cadeiras em
          disputa. Turno único, sistema proporcional. Não oficial. Fonte: TSE.
        </p>
      </Panel>

      {/* 🔴 2026-09-14 — o parágrafo "Nenhum estado apurado ainda. As 27
          corridas aparecem aqui conforme o TSE divulga os primeiros boletins."
          SAIU daqui, e ele era a única ocorrência de vocabulário de medição
          desta rota sem defesa.

          Por que ele era falso e não só feio: "nenhum estado apurado" é o
          PLACAR de um processo, e dar o placar pressupõe que o processo está em
          curso. Neste ramo não sabemos nem isso — ele é alcançado tanto antes de
          04/10 quanto durante uma queda do Global Config. Era medição de coisa
          nenhuma, no mesmo espírito da mentira nº 1 da tabela do design 019 § D2
          ("Todas as unidades federativas estão com a apuração concluída").

          O que ficou no lugar é a regra que a própria spec criou: **progresso é
          medição e cala; geografia é identidade e fala.** Os 27 links são
          verdadeiros em qualquer dia do calendário, e levam a
          `/uf/<sigla>/deputado-federal`, onde as 7.221 candidaturas publicáveis
          da spec 018 já aparecem — o outro endereço delas é
          `/candidatos?cargo=6`.

          As outras ocorrências desta rota FICAM: "Aguardando o primeiro
          boletim" (RF-163 manda preservá-la intacta, e ela descreve o NOSSO
          estado, não o do mundo) e as de `<DeputadoMetodologia>`, onde
          "projeção" aparece como negação. */}
      <Panel kicker="Corridas estaduais" title="Estado a estado" titleId="corridas-heading">
        <UfLinksGrid cargo={CARGO_DEPUTADO} />
      </Panel>

      {/* Sem payload não há cadência declarada nem granularidade a explicar:
          `cadenciaMinutos={0}` e `temDado={false}` fazem o bloco calar sobre as
          duas, em vez de inventar (§ D8). O `temDado` existe porque a primeira
          versão desta correção publicou, neste exato estado, a frase "lemos o
          boletim que o TSE publica por estado" — falso, porque aqui não se leu
          nada ainda. */}
      <DeputadoMetodologia pctApurado={0} cadenciaMinutos={0} temDado={false} />

      <Footer />
    </main>
  );
}
