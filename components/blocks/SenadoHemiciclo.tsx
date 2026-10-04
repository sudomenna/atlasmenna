/**
 * components/blocks/SenadoHemiciclo.tsx — o Senado de 2027 como um assento por
 * cadeira: as 27 com mandato até 2031 e as 54 em disputa. Spec 023, RF-216 e
 * RF-218; ADR-0061 item 3.
 *
 * Mesmo desenho da Câmara (`<Hemiciclo>`), com 5 arcos (`ARCOS_SENADO`) em vez
 * de 12. Server Component, zero JavaScript: o custo é HTML, e o teto dele está
 * em `tests/unit/components/senado-hemiciclo-peso.test.tsx`.
 *
 * ## Os quatro estados (design 023 § D3)
 *
 * | estado | aparência |
 * |---|---|
 * | `continua_2031` — mandato até 2031 | cheia, cor do partido |
 * | `decidida` — vaga de UF com a apuração concluída | cheia, cor do partido |
 * | `projetada` — vaga pela projeção | cinza com anel na cor do partido |
 * | `aguardando` — vaga ainda sem UF projetada | cinza com anel neutro |
 *
 * `continua_2031` e `decidida` têm a mesma aparência por decisão do plano do
 * dono (29/09). A distinção está na ordem dentro da cunha (as que continuam vêm
 * primeiro), na legenda e na lista textual. O anel na cadeira não firme é a
 * gramática do ADR-0049 item 3, reaproveitada.
 *
 * ## 🔴 Nunca "eleito"
 *
 * As 27 são "mandato até 2031 — não estão em disputa"; a vaga de UF concluída é
 * "apuração concluída no estado", com a base dita. Nenhuma palavra da raiz
 * `eleit` sai deste bloco, em fase nenhuma (RF-218 c; constituição § 1). O
 * teste varre o markup.
 *
 * ## Fase pré-eleição (spec 019)
 *
 * 27 cheias + 54 cinzas. A legenda só nomeia os dois estados presentes, e o
 * texto evita a lista negra do RF-161 (`projeç`, `apurado`, `boletim`…).
 *
 * ## Cor: `textForParty`, como na Câmara e na barra das 54
 *
 * Bolinha é marcador de identidade (RNF-035) ⇒ variante `-text`. A barra das 54
 * na mesma página usa a mesma função (RF-219), então o mesmo partido tem a
 * mesma cor nas duas.
 *
 * ## A11y (RF-218)
 *
 * `role="img"` com `<title>`/`<desc>`, e `aria-describedby` apontando para a
 * lista textual deste mesmo bloco — um item por partido, na ordem das cunhas.
 */

import type { CSSProperties } from "react";

import { Panel } from "@/components/atoms/surfaces/Panel";
import {
  agruparEmTrechos,
  CINZA_ASSENTO,
  CONTORNO_NEUTRO,
  Hemiciclo,
} from "@/components/blocks/Hemiciclo";
import { RealceHemiciclo } from "@/components/blocks/RealceHemiciclo";
import type { EdgePayload } from "@/lib/edge-config/types";
import type { ValidacaoMandato2031 } from "@/lib/senado/mandato-2031";
import { ARCOS_SENADO, layoutHemiciclo } from "@/lib/utils/hemiciclo";
import { textForParty } from "@/lib/utils/party-color";
import {
  type CadeiraSenado,
  CHAVE_SEM_PARTIDO,
  derivarSenado2027,
  type EstadoCadeiraSenado,
  ROTULO_SEM_PARTIDO,
  type Senado2027,
  textoDoPartido,
} from "@/lib/utils/senado-2027";

/** Etiqueta das linhas de log da recusa (RF-217). */
export const LOG_TAG_SENADO_2027 = "[senado-2027]";

/**
 * Cinza CHEIO da cadeira de senador hoje sem partido: ocupada (por isso cheia,
 * como as outras que continuam), de partido nenhum (por isso sem cor de
 * partido — nem do antigo, nem a de "Outros"). É o mesmo token do anel neutro,
 * ≥5,0:1 contra as superfícies claras.
 */
export const CINZA_SEM_PARTIDO = CONTORNO_NEUTRO;

/** Pintura de uma cadeira — o único lugar que decide cor. */
export function pinturaDoAssento(c: Pick<CadeiraSenado, "estado" | "sigla" | "chave">): {
  fill: string;
  stroke: string;
} {
  if (c.chave === CHAVE_SEM_PARTIDO) return { fill: CINZA_SEM_PARTIDO, stroke: CINZA_SEM_PARTIDO };
  if (c.estado === "continua_2031" || c.estado === "decidida") {
    const cor = textForParty(c.sigla);
    return { fill: cor, stroke: cor };
  }
  if (c.estado === "projetada") return { fill: CINZA_ASSENTO, stroke: textForParty(c.sigla) };
  return { fill: CINZA_ASSENTO, stroke: CONTORNO_NEUTRO };
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** A forma da amostra na legenda — ver {@link Amostra}. */
type FormaAmostra = "cheia" | "sem_partido" | "anel" | "cinza";

/** Uma linha da legenda: um estado (ou o recorte "sem partido"), com a contagem. */
interface ItemLegenda {
  id: EstadoCadeiraSenado | "sem_partido";
  forma: FormaAmostra;
  n: number;
  texto: string;
}

/**
 * As linhas da legenda. Na fase pré só as que existem (as que continuam e as
 * em disputa ainda cinzas): nomear "projeção" ou "apuração concluída" ali
 * seria vocabulário de medição antes de haver medição (spec 019, RF-161).
 */
function itensDaLegenda(senado: Senado2027, pre: boolean): ItemLegenda[] {
  const { contagem, continuaSemPartido } = senado;
  const itens: ItemLegenda[] = [
    {
      id: "continua_2031",
      forma: "cheia",
      n: contagem.continua_2031 - continuaSemPartido,
      texto: "cheias, na cor do partido: mandato até 2031 — não estão em disputa",
    },
  ];
  if (continuaSemPartido > 0) {
    itens.push({
      id: "sem_partido",
      forma: "sem_partido",
      n: continuaSemPartido,
      texto: `cinza cheia: mandato até 2031 de quem hoje está sem partido ("${ROTULO_SEM_PARTIDO}")`,
    });
  }
  if (!pre) {
    itens.push(
      {
        id: "decidida",
        forma: "cheia",
        n: contagem.decidida,
        texto: "cheias, na cor do partido: vagas de 2026 em estado com a apuração concluída",
      },
      {
        id: "projetada",
        forma: "anel",
        n: contagem.projetada,
        texto: "anel na cor do partido: vagas de 2026 pela projeção — ainda podem mudar",
      },
    );
  }
  itens.push({
    id: "aguardando",
    forma: "cinza",
    n: contagem.aguardando,
    texto: pre
      ? "cinzas: vagas em disputa nesta eleição, ainda sem voto contado"
      : "cinzas: vagas em disputa aguardando apuração",
  });
  return itens;
}

function Amostra({ forma }: { forma: FormaAmostra }) {
  // A amostra de "na cor do partido" usa a tinta neutra do texto: a legenda
  // explica a FORMA (cheia, anel, cinza), e "na cor do partido" vem escrito.
  // Pintar a amostra com um partido escolhido seria o produto escolhendo um
  // partido para exemplo.
  const pintura: Record<FormaAmostra, { fill: string; stroke: string }> = {
    cheia: { fill: "var(--text-primary)", stroke: "var(--text-primary)" },
    sem_partido: { fill: CINZA_SEM_PARTIDO, stroke: CINZA_SEM_PARTIDO },
    anel: { fill: CINZA_ASSENTO, stroke: "var(--text-primary)" },
    cinza: { fill: CINZA_ASSENTO, stroke: CONTORNO_NEUTRO },
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{ flex: "none", alignSelf: "center" }}
    >
      <circle cx="5" cy="5" r="3.6" strokeWidth="1.6" {...pintura[forma]} />
    </svg>
  );
}

export interface SenadoHemicicloProps {
  senado: Senado2027;
  /** Prefixo dos `id` internos, para duas instâncias não colidirem. */
  idPrefixo?: string;
  className?: string;
  style?: CSSProperties;
}

/** O desenho + legenda + lista textual. Recebe o Senado já derivado e aceito. */
export function SenadoHemiciclo({
  senado,
  idPrefixo = "senado-hemiciclo",
  className,
  style,
}: SenadoHemicicloProps) {
  const layout = layoutHemiciclo(senado.total, { arcos: ARCOS_SENADO });
  const pre = senado.fase !== "normal";
  const { contagem } = senado;
  const listaId = `${idPrefixo}-lista`;

  const trechos = agruparEmTrechos(
    senado.cadeiras,
    (anterior, atual) => anterior.chave === atual.chave && anterior.estado === atual.estado,
    (c, inicio) => ({
      chave: `${c.estado}-${c.chave ?? "sem-partido"}-${inicio}`,
      estado: c.estado,
      ...pinturaDoAssento(c),
      dados: { "data-partido": c.sigla ?? undefined },
    }),
  );

  const itens = itensDaLegenda(senado, pre);

  const descricao =
    `${plural(contagem.continua_2031, "cadeira", "cadeiras")} com mandato até 2031, que não estão em disputa` +
    (senado.continuaSemPartido > 0
      ? ` (${senado.continuaSemPartido} de senador hoje sem partido)`
      : "") +
    (contagem.decidida > 0
      ? `; ${plural(contagem.decidida, "vaga", "vagas")} de 2026 em estado com a apuração concluída`
      : "") +
    (contagem.projetada > 0
      ? `; ${plural(contagem.projetada, "vaga", "vagas")} de 2026 pela projeção`
      : "") +
    (contagem.aguardando > 0
      ? `; ${plural(contagem.aguardando, "vaga", "vagas")} em disputa ${
          pre ? "ainda sem voto contado" : "aguardando apuração"
        }`
      : "") +
    ". Cada partido ocupa um trecho contíguo, do maior para o menor; a ordem é por tamanho e" +
    " não representa posição ideológica.";

  return (
    <div
      className={className}
      data-testid="senado-hemiciclo"
      data-fase={senado.fase}
      data-total={senado.total}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", ...style }}
    >
      <Hemiciclo
        layout={layout}
        trechos={trechos}
        titulo={`O Senado a partir de 2027: ${senado.total} cadeiras, uma bolinha por cadeira`}
        descricao={descricao}
        descritoPorId={listaId}
        idPrefixo={idPrefixo}
        testId="senado-hemiciclo-figura"
        legendaTestId="senado-hemiciclo-legenda"
        style={{ maxWidth: "36rem" }}
        legenda={
          <ul
            className="flex flex-col"
            style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--space-1)" }}
          >
            {itens.map((item) => (
              <li
                key={item.id}
                data-testid="senado-hemiciclo-estado"
                data-estado={item.id}
                className="flex"
                style={{ gap: "var(--space-2)", minWidth: 0 }}
              >
                <Amostra forma={item.forma} />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ fontWeight: 600 }}>{item.n}</strong> {item.texto}
                </span>
              </li>
            ))}
          </ul>
        }
      />

      <ul
        id={listaId}
        data-testid="senado-hemiciclo-lista"
        className="flex flex-wrap"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          columnGap: "var(--space-4)",
          rowGap: "var(--space-1)",
          font: "var(--type-body-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {senado.partidos.map((p) => (
          <li key={p.chave} data-partido={p.sigla}>
            {textoDoPartido(p)}
          </li>
        ))}
        {contagem.aguardando > 0 ? (
          <li data-testid="senado-hemiciclo-lista-aguardando">
            {pre
              ? `Em disputa nesta eleição: ${plural(contagem.aguardando, "vaga", "vagas")}, ainda sem voto contado`
              : `Aguardando apuração: ${plural(contagem.aguardando, "vaga", "vagas")} em disputa`}
          </li>
        ) : null}
      </ul>

      <p
        className="max-w-prose"
        data-testid="senado-hemiciclo-foto"
        style={{
          margin: 0,
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          textWrap: "pretty",
        }}
      >
        Composição dos {contagem.continua_2031} mandatos até 2031 conforme o Senado em{" "}
        {senado.dataFoto}. O partido de cada uma dessas cadeiras é o partido atual de quem a ocupa
        hoje, suplente em exercício incluído. Se alguém deixar a cadeira antes de 2027, ela passa ao
        suplente, e o partido pode mudar. Fonte: Senado Federal — Dados Abertos.
      </p>
    </div>
  );
}

export interface SenadoHemicicloPanelProps {
  /** O payload nacional de Senador (cargo 5) que a página já leu. */
  payload: EdgePayload | null;
  /** A foto dos 27 mandatos até 2031, já validada (`lib/senado/mandato-2031.ts`). */
  mandato: ValidacaoMandato2031;
}

/**
 * O painel de `/senador`: deriva, e se a derivação recusar (RF-217), loga uma
 * linha com {@link LOG_TAG_SENADO_2027} e não desenha nada — nem o painel. A
 * barra das 54 e o resto da página seguem.
 */
export function SenadoHemicicloPanel({ payload, mandato }: SenadoHemicicloPanelProps) {
  const resultado = derivarSenado2027(payload, mandato);
  if (!resultado.ok) {
    console.warn(
      `${LOG_TAG_SENADO_2027} hemiciclo não desenhado: ${resultado.motivo} — ${resultado.detalhe}`,
    );
    return null;
  }
  const { senado } = resultado;
  const pre = senado.fase !== "normal";

  return (
    <Panel
      kicker={pre ? "Senado de 2027" : "Senado de 2027 · não oficial"}
      title={`As ${senado.total} cadeiras`}
      titleId="senado-2027-heading"
    >
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <p
          className="max-w-prose"
          style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}
        >
          {pre
            ? `Como fica o Senado a partir de 2027: as ${senado.vagasEmDisputa} vagas em disputa nesta eleição, somadas às ${senado.contagem.continua_2031} cadeiras com mandato até 2031, que não estão em disputa.`
            : `Como fica o Senado a partir de 2027: as ${senado.vagasEmDisputa} vagas em disputa, pela projeção de cada estado, somadas às ${senado.contagem.continua_2031} cadeiras com mandato até 2031, que não estão em disputa. Não oficial.`}
        </p>
        {/* RF-294 — realce por partido: ponteiro numa cadeira ou numa linha
            da lista (`li[data-partido]`) esmaece as dos outros partidos. */}
        <RealceHemiciclo
          raiz="senado"
          atributo="data-partido"
          chaves={senado.partidos.map((p) => p.sigla)}
        >
          <SenadoHemiciclo senado={senado} />
        </RealceHemiciclo>
      </div>
    </Panel>
  );
}
