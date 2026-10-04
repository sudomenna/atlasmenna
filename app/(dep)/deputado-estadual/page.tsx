/**
 * app/(dep)/deputado-estadual/page.tsx — T-17, spec 027 (RF-280, RF-282,
 * RF-283, RF-284).
 *
 * A capa das 27 casas que elegem deputado estadual ou distrital: as 26
 * Assembleias Legislativas (cargo 7) e a Câmara Legislativa do Distrito
 * Federal (cargo 8). Decisão do dono de 29/09 (não reabrir): grade das 27
 * casas, os mais votados e os puxadores do país, e a soma das cadeiras por
 * partido ou federação sobre 1.059 — **sem plenário**.
 *
 * ## Por que não há plenário, nem faixa
 *
 * Não existe uma casa de 1.059 cadeiras: são 27 eleições separadas, cada uma
 * com o seu quociente e as suas sobras, e ninguém forma maioria numa soma
 * delas. Um hemiciclo desenharia essa casa inexistente (design § 8.3). Pelo
 * mesmo motivo a soma não mostra faixa de cadeiras — o intervalo de uma casa
 * não se soma ao de outra; a incerteza que sobrevive à soma é a "sobra
 * apertada", e ela fica na linha de cada agremiação. E o painel da soma diz,
 * DENTRO dele, que é a soma de 27 casas separadas.
 *
 * ## Duas fontes, e só elas
 *
 * `projection-current-est-t1` (26 UFs) e `projection-current-dis-t1` (o DF),
 * pelo adaptador `app/(dep)/_dados-da-casa.ts` (`lerNacionalDaCasa`). NENHUM
 * Blob de UF: mais votados e puxadores vêm prontos nos payloads (spec 026
 * RF-271), e as uniões são funções puras em `lib/deputado/uniao-casas.ts`.
 * Cada payload tem o seu relógio e a sua cadência, e a tela diz os dois —
 * nunca um "atualizado às" único (ADR-0026 item 5, constituição § 8).
 *
 * ## Três estados, nunca zeros (decisão do dono de 14/09)
 *
 *   - nenhum dos dois payloads ⇒ "esta página ainda não recebeu dados", com
 *     a grade das 27 casas em links (geografia é identidade e fala; progresso
 *     é medição e cala);
 *   - só um ⇒ a soma sobre 1.059, e as casas do outro cargo "aguardando";
 *   - os dois ⇒ a soma sobre os totais publicados.
 *
 * ## Nenhum número escrito à mão
 *
 * O total vem de `somaDasCasas` (1.059 fixo enquanto faltar casa — ADR-0049,
 * RF-280); as cadências, de `atualizacao_min` de cada payload; o nome da casa
 * do DF, de `lib/utils/casa-legislativa.ts`.
 *
 * ISR: 60 s (ADR-0011).
 */

import type { Metadata } from "next";

import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { FasePreEleicaoBanner } from "@/components/atoms/banners/FasePreEleicaoBanner";
import { Figure } from "@/components/atoms/data/Figure";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { DeputadoBancadaPanel } from "@/components/blocks/DeputadoBancadaPanel";
import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoPuxadores } from "@/components/blocks/DeputadoPuxadores";
import { UfBandeirasGrid, type UfResumoCorrida } from "@/components/blocks/UfBandeirasGrid";
import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";
import { Footer } from "@/components/layout/Footer";
import { SeletorDeputado } from "@/components/layout/SeletorDeputado";
import { SeloFasePreStyle } from "@/components/layout/SeloFasePreStyle";
import { aplicarInterruptorNoNacional } from "@/lib/blob/deputado-uf";
import { avaliarFrescorDado, fraseFrescorDado } from "@/lib/config/dado-freshness";
import { isPreEleicao } from "@/lib/config/fase";
import { resumosPorUf } from "@/lib/deputado/resumos-por-uf";
import {
  maisVotadosDasCasas,
  puxadoresDasCasas,
  somaDasCasas,
  TOTAL_CADEIRAS_ASSEMBLEIAS,
  TOTAL_CADEIRAS_DA_CASA,
  TOTAL_CASAS,
} from "@/lib/deputado/uniao-casas";
import { simulacaoLigada } from "@/lib/dev/simulacao";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { hrefDaCasa, nomeDaCasa, ufsDoCargo } from "@/lib/utils/casa-legislativa";

import { lerBancadaZerada, lerNacionalDaCasa, nacionalAusenteDaCasa } from "../_dados-da-casa";
import { lerInterruptorDaTela } from "../_interruptor";
import painel from "../_painel-desktop.module.css";

export const revalidate = 60;

const TITULO = "Assembleias Legislativas e Câmara Legislativa do DF 2026";
const DESCRICAO =
  "Como estão as 26 Assembleias Legislativas e a Câmara Legislativa do Distrito Federal em 2026, com os votos já apurados: 1.059 cadeiras em 27 eleições separadas, somadas por partido e federação. Não oficial. Fonte: TSE.";

export const metadata: Metadata = {
  title: `${TITULO} · AtlasMenna`,
  description: DESCRICAO,
  alternates: { canonical: "/deputado-estadual" },
  openGraph: {
    title: `${TITULO} · AtlasMenna`,
    description: DESCRICAO,
    type: "website",
    locale: "pt_BR",
    siteName: "AtlasMenna",
  },
  twitter: { card: "summary_large_image", title: `${TITULO} · AtlasMenna`, description: DESCRICAO },
};

/** A grade das 27 casas manda o DF para a Câmara Legislativa; as outras 26, para a Assembleia. */
const HREF_POR_UF: Readonly<Record<string, string>> = { DF: hrefDaCasa(8, "DF") };
const ROTULO_GRADE =
  "As 27 casas: Assembleias Legislativas e Câmara Legislativa do Distrito Federal";
const ROTULO_LISTAS = "Deputados estaduais e distritais";
const NOME_CLDF = nomeDaCasa(8, "DF");

function milhar(n: number): string {
  return n.toLocaleString("pt-BR");
}

/**
 * O resumo de cada casa para a grade: as 26 do payload `est`, o DF do `dis` —
 * cada um filtrado às UFs do SEU cargo (uma linha de UF fora do cargo seria
 * defeito do produtor, e aqui não viraria resumo de casa nenhuma).
 */
function resumosDasCasas(
  est: EdgePayloadDeputado | null,
  dis: EdgePayloadDeputado | null,
  interruptor: InterruptorProjecaoLido,
): Record<string, UfResumoCorrida> {
  const saida: Record<string, UfResumoCorrida> = {};
  for (const [payload, cargo] of [
    [est, 7],
    [dis, 8],
  ] as const) {
    if (!payload) continue;
    const doCargo = new Set(ufsDoCargo(cargo));
    for (const [uf, resumo] of Object.entries(resumosPorUf(payload, interruptor))) {
      if (doCargo.has(uf)) saida[uf] = resumo;
    }
  }
  return saida;
}

/** "Dado do TSE às 20:14:05, a cada 5 minutos." — ou a espera, dita como espera. */
function fraseFrescor(payload: EdgePayloadDeputado | null): string {
  if (!payload) return "aguardando o primeiro boletim.";
  const frescor = avaliarFrescorDado(payload.dado_ts, payload.cargo);
  const cadencia =
    payload.atualizacao_min > 0
      ? `, a cada ${payload.atualizacao_min} ${payload.atualizacao_min === 1 ? "minuto" : "minutos"}`
      : "";
  return `${fraseFrescorDado(frescor, payload.ts)}${cadencia}.`;
}

export default async function DeputadoEstadualPage() {
  // A capa lê SÓ os dois payloads nacionais e o interruptor das assembleias
  // (`interruptor-projecao-est`), em paralelo. Nenhum Blob de UF (RF-282).
  const [estLido, disLido, interruptor] = await Promise.all([
    lerNacionalDaCasa(7),
    lerNacionalDaCasa(8),
    lerInterruptorDaTela(7, simulacaoLigada()),
  ]);

  // ADR-0076 (decisão do dono, 04/10) — placar ZERADO: as duas chaves
  // AUSENTES (ou em pré-eleição) abrem o layout da apuração a zero, com as
  // agremiações do cadastro na ordem sorteada. 🔴 Leitura que FALHOU nunca
  // zera: com qualquer das duas sem dizer "ausente", fica a espera honesta.
  const pre = (p: EdgePayloadDeputado | null) => isPreEleicao(p);
  const zerado =
    (!estLido || pre(estLido)) &&
    (!disLido || pre(disLido)) &&
    (estLido !== null || (await nacionalAusenteDaCasa(7))) &&
    (disLido !== null || (await nacionalAusenteDaCasa(8)));
  if (!estLido && !disLido && !zerado) return <AguardandoAssembleias />;

  // O interruptor aplicado aos dois objetos ANTES de qualquer bloco os ver
  // (ADR-0063 D4): desligado, nenhum selo de projeção sobra na grade.
  const est = zerado ? null : estLido ? aplicarInterruptorNoNacional(estLido, interruptor) : null;
  const dis = zerado ? null : disLido ? aplicarInterruptorNoNacional(disLido, interruptor) : null;

  const somaLida = somaDasCasas(est, dis);
  const soma = zerado
    ? {
        ...somaLida,
        por_agremiacao: [...(await lerBancadaZerada(7)), ...(await lerBancadaZerada(8))].filter(
          (a, i, todas) => todas.findIndex((b) => b.cod === a.cod) === i,
        ),
      }
    : somaLida;
  const maisVotados = maisVotadosDasCasas(est, dis);
  const puxadores = puxadoresDasCasas(est, dis);
  const cadeirasEst = est?.bancada.total_cadeiras ?? TOTAL_CADEIRAS_DA_CASA[7];
  const cadeirasDis = dis?.bancada.total_cadeiras ?? TOTAL_CADEIRAS_DA_CASA[8];

  return (
    <main
      data-trilha="dep"
      className={`mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10 ${painel.main}`}
      style={{ gap: "var(--space-8)" }}
    >
      {/* ADR-0038 D4 — um aviso de dado parado por fonte: são dois ciclos
          independentes, e um parado não diz nada do outro. Sem payload, sem
          aviso (seria alarme fabricado sobre a ausência da fonte). */}
      {est ? <DadoParadoBanner frescor={avaliarFrescorDado(est.dado_ts, est.cargo)} /> : null}
      {dis ? <DadoParadoBanner frescor={avaliarFrescorDado(dis.dado_ts, dis.cargo)} /> : null}

      {/* RF-283 — Federal · Estadual, antes do `<h1>`. */}
      <SeletorDeputado atual={7} />

      {/* Seção 1 — o enquadramento. */}
      <Panel
        kicker="Atlas Menna · apuração ao vivo · não oficial"
        title={TITULO}
        titleId="casas-heading"
        headingLevel={1}
      >
        <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
          <p
            className="max-w-prose"
            data-testid="casas-cadeiras-label"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            <strong>{milhar(soma.total)} cadeiras</strong> em disputa em {TOTAL_CASAS} eleições
            separadas: as {ufsDoCargo(7).length} Assembleias Legislativas dos estados (
            {milhar(cadeirasEst)} cadeiras) e a {NOME_CLDF} ({milhar(cadeirasDis)}), em turno único
            e por sistema proporcional. Cada casa tem o seu quociente eleitoral e as suas sobras; em
            cada uma, quem ganha cadeira é a agremiação, e só depois ela é ocupada pelos candidatos
            mais votados dentro dela. Não oficial. Fonte: TSE.
          </p>

          {/* Véspera 03/10 — "963 de 1.059, somadas as 27 casas" ao lado de
              "23 de 27 casas calculadas" se lia como duas contas sobre a mesma
              coisa. Cada número agora diz do que é parte: as cadeiras já
              distribuídas sobre o total fixo das 27 casas, e quantas casas já
              têm a conta feita com os votos apurados. */}
          <div
            className="grid grid-cols-2"
            style={{ gap: "var(--space-4)" }}
            data-testid="casas-figuras"
          >
            <Figure
              label="Cadeiras já distribuídas"
              note={`das ${milhar(soma.total)} cadeiras das ${TOTAL_CASAS} casas`}
              size="lg"
              value={milhar(soma.atribuidas)}
            />
            <Figure
              label="Casas com a conta feita"
              note={`das ${TOTAL_CASAS}, com os votos já apurados — as cadeiras ao lado vêm delas`}
              value={String(soma.casasCalculadas)}
            />
          </div>

          {/* Um relógio por fonte, com a cadência de cada uma — nunca um
              "atualizado às" único (ADR-0026 item 5). */}
          {zerado ? null : (
            <ul
              data-testid="casas-atualizacao"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: "var(--space-1)",
                font: "var(--type-data)",
                color: "var(--text-muted)",
              }}
            >
              <li data-cargo="7">Assembleias Legislativas: {fraseFrescor(est)}</li>
              <li data-cargo="8">
                {NOME_CLDF}: {fraseFrescor(dis)}
              </li>
            </ul>
          )}
        </div>
      </Panel>

      {/* Seção 2 — a soma por partido ou federação (RF-282). O aviso de que é
          a soma de 27 casas separadas está DENTRO do painel, antes da barra. */}
      <DeputadoBancadaPanel
        kicker={`Soma das ${TOTAL_CASAS} casas`}
        title="Cadeiras por partido ou federação no Brasil"
        titleId="bancada-heading"
        agremiacoes={soma.por_agremiacao}
        total={soma.total}
        atribuidas={soma.atribuidas}
        rotuloBarra={`Soma de ${TOTAL_CASAS} casas separadas, ${milhar(soma.total)} cadeiras`}
        mostrarFaixa={false}
        aviso={
          <p
            className="max-w-prose"
            data-testid="soma-aviso"
            style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
          >
            <strong>Esta é a soma de {TOTAL_CASAS} casas separadas.</strong> Não existe uma casa de{" "}
            {milhar(soma.total)} cadeiras: cada Assembleia, e a Câmara Legislativa do DF, é uma
            eleição própria. A soma mostra o peso de cada partido ou federação no país, não uma
            maioria — ninguém governa com ela.
          </p>
        }
        fraseAguardando={
          <>
            cadeiras ainda sem dono — {soma.casasAguardando} de {TOTAL_CASAS} casas sem a conta de
            cadeiras e vagas que a distribuição ainda não fechou.
          </>
        }
        nota={
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
            A soma é nossa: o TSE não publica um arquivo nacional destas eleições. Cada partido é
            reconhecido pelo seu número, e cada federação pela sua composição — o mesmo em todas as
            casas. O total de {milhar(TOTAL_CADEIRAS_ASSEMBLEIAS)} cadeiras não é soma das casas que
            já apuraram: é o tamanho das {TOTAL_CASAS} casas, fixo desde antes da urna abrir, e
            quantas cada uma elege continua vindo do dado que o TSE publica. Não mostramos faixa de
            cadeiras aqui: a incerteza de uma casa não se soma à de outra. A cadeira decidida em
            rodada de sobra por margem apertada continua marcada na linha de cada agremiação.
          </p>
        }
      />

      {/* Seção 3 — mais votados e puxadores do país, dos dois payloads. */}
      {/* ADR-0073 — lado a lado a partir de 1280px; abaixo, `display: contents`. */}
      {zerado ? null : (
        <div className={painel.par}>
          <DeputadoMaisVotados
            cargo={7}
            rotulo={ROTULO_LISTAS}
            escopo="pais"
            linhas={maisVotados}
            titleId="mais-votados-pais-heading"
          />
          <DeputadoPuxadores
            cargo={7}
            rotulo={ROTULO_LISTAS}
            puxadores={puxadores}
            titleId="puxadores-heading"
          />
        </div>
      )}

      {/* Seção 4 — as 27 casas. Casa sem linha no payload cai em "aguardando
          apuração" / "vagas não publicadas" — nunca zero (RF-124). */}
      <Panel kicker="As 27 casas" title="Casa a casa" titleId="corridas-heading">
        <UfBandeirasGrid
          cargo={7}
          resumos={resumosDasCasas(est, dis, interruptor)}
          hrefPorUf={HREF_POR_UF}
          ariaLabel={ROTULO_GRADE}
        />
      </Panel>

      {/* Constituição § 8 — o método, curto: a conta das casas é a das
          páginas de cada uma, e lá está o método inteiro. */}
      <Panel kicker="Metodologia" title="Como esta soma é feita" titleId="metodologia-heading">
        <p
          className="max-w-prose"
          data-testid="casas-metodologia"
          style={{
            margin: 0,
            font: "var(--type-body-sm)",
            color: "var(--text-secondary)",
            textWrap: "pretty",
          }}
        >
          Os números desta página <strong>não são uma projeção</strong>. Em cada casa, são a
          distribuição de cadeiras pelas regras do Código Eleitoral aplicada aos votos{" "}
          <strong>já apurados</strong> — "como ficaria a casa se a contagem parasse agora" —, e a
          soma junta as {TOTAL_CASAS} contas. A projeção, que é não oficial, quando existe, é feita
          casa a casa e aparece só na página de cada uma: não somamos projeções.{" "}
          {interruptor.ligada
            ? "Ela está ligada no site para as assembleias."
            : interruptor.origem === "invalida" || interruptor.origem === "falha"
              ? "Neste momento não foi possível ler o interruptor da projeção das assembleias, e por segurança ela fica desligada."
              : "Neste momento ela está desligada no site para as assembleias."}{" "}
          O método completo está em{" "}
          <a href="/sobre-o-modelo#sec-cadeiras" style={{ color: "inherit" }}>
            Sobre o modelo
          </a>
          .
        </p>
      </Panel>

      <Footer />
    </main>
  );
}

/**
 * Nenhum dos dois payloads — a página **não some** (constituição § 3) e **não
 * inventa número**: nem 1.059, nem 0 (as vagas de cada casa são dado do TSE).
 * A faixa diz que esta página não recebeu dados; a grade das 27 casas fica,
 * em links — é geografia, verdadeira em qualquer dia do calendário.
 */
function AguardandoAssembleias() {
  return (
    <main
      data-trilha="dep"
      className={`mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10 ${painel.main}`}
      style={{ gap: "var(--space-8)" }}
    >
      {/* RF-160 — primeiro filho do `<main>`; `sem_dados` é verdade em
          qualquer dia (emenda de 14/09). */}
      <FasePreEleicaoBanner
        corrida="as Assembleias Legislativas e a Câmara Legislativa do DF"
        variante="sem_dados"
      />
      <SeloFasePreStyle variante="sem_dados" />

      <SeletorDeputado atual={7} />

      <Panel
        kicker="Atlas Menna · não oficial"
        title={TITULO}
        titleId="casas-heading"
        headingLevel={1}
      >
        <p
          className="max-w-prose"
          data-testid="casas-aguardando"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          Aguardando os dados. As cadeiras de cada casa — por partido e por federação — e a soma
          delas aparecem aqui assim que o TSE divulgar a apuração das Assembleias Legislativas ou da
          Câmara Legislativa do Distrito Federal. São 27 eleições separadas, em turno único e por
          sistema proporcional. Não oficial. Fonte: TSE.
        </p>
      </Panel>

      <Panel kicker="As 27 casas" title="Casa a casa" titleId="corridas-heading">
        <UfLinksGrid cargo={7} hrefPorUf={HREF_POR_UF} ariaLabel={ROTULO_GRADE} />
      </Panel>

      <Footer />
    </main>
  );
}
