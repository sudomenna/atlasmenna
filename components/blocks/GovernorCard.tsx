/**
 * components/blocks/GovernorCard.tsx
 *
 * S06/F4d (Fase 3) — card individual de UF na grid `/governador`.
 * Layout opção (b) decidida no plan S06:
 *   - Header: "Nome do estado · SIGLA    pct% apur"
 *   - Top-4 candidatos com nome + partido + barra colorida pela SIGLA
 *   - 5ª linha "Outros" agregando o restante
 *   - Chip de status à direita do líder (● ELEITO / VAI A 2T / EM APURAÇÃO);
 *     no Senado (`cargo="sen"`), "● ELEITO" nos DOIS ocupantes de vaga
 *     (2026-09-29, decisão do dono)
 *
 * **Eram 3 candidatos + "Outros" até 2026-09-19.** O dono decidiu naquele dia
 * que as três telas de resumo de UF (esta, a ficha `<StateResultSheet>` e a
 * lista de `/senador`) passam a trabalhar com QUATRO candidaturas; o produtor
 * acompanhou na mesma data (`TOP_CANDIDATOS_POR_UF = 4`, `api/model/project.py`)
 * e passou a emitir o irmão {@link EdgeUfRow.outros} com a cauda já somada.
 *
 * Server Component puro. Desde 2026-09-28 o cartão completo vale em toda
 * largura (a linha única do celular saiu, decisão do dono).
 *
 * Cobertura
 *   - Spec 005 (página `/governador`) — RFs governador grid.
 *   - ADR-0017 (transparência total: mostra top-4 + outros, não só líder).
 *   - ADR-0024 (cor pela SIGLA do partido, não por colocação — ADR-0013 §Status).
 *   - Constituição § 2 (cores via tokens; nunca partidária oficial).
 *
 * A11y
 *   - aria-label do card descreve UF + status + líder.
 *   - Barras decorativas com aria-hidden — info textual está nos rótulos.
 */

import type { CSSProperties } from "react";

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import { EtiquetasLinha } from "@/components/atoms/data/EtiquetasLinha";
import { UfFlag } from "@/components/atoms/data/UfFlag";
import { candidateColor } from "@/components/blocks/_candidateColor";
import { vagasDaCorrida } from "@/lib/config/cargos";
import type { EdgeCandidate, EdgeDestinoVoto, EdgeUfRow } from "@/lib/edge-config/types";
import { normalizarSqcand } from "@/lib/etiquetas/formato";
import type { EtiquetasDaCorrida } from "@/lib/etiquetas/telas";
import { classificarContagem, classificarProjecao } from "@/lib/utils/desfecho-governador";
import { anuladasAoFim, compete, exibePercentual, votosDaAnulada } from "@/lib/utils/destino-voto";
import { formatPercentTrim } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { rankByParcial } from "@/lib/utils/rank-parcial";
import { vagasDaUfNaParcial } from "@/lib/utils/senado-parcial";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import { idsDasVagas } from "@/lib/utils/vagas-eleitas";

import styles from "./GovernorCard.module.css";

/**
 * Nome longo da UF para o header. Sigla curta vai à direita.
 * Determinístico (constituição § 6).
 */
const UF_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

export interface GovernorCardProps {
  uf: EdgeUfRow;
  /**
   * Candidatos com metadados de RANK (`cor`, `rank`), cruzados por `id` com
   * `uf.top_candidatos`. Caller passa o array nacional
   * (`EdgePayload.national.candidatos`) ou um array estadual específico.
   *
   * ⚠️ **NÃO é mais a fonte de `nome`/`partido`** (spec 018 / ADR-0042). Em
   * cargo 3 o array nacional é a união de 27 corridas sob o mesmo espaço de
   * `id`, com `rank` reiniciando a cada UF — resolver identidade por `id`
   * sozinho ali entrega o candidato do estado errado. Nome e partido saem de
   * `uf.top_candidatos[]`, que o orchestrator resolve pelo par `(uf, numero)`.
   */
  candidatos: EdgeCandidate[];
  /**
   * 🔴 2026-09-27 (decisão do dono) — a capa `/senador` passou a usar ESTE
   * cartão, no mesmo formato de `/governador`: 4 posições + "Outros", em % dos
   * votos válidos. Em `"sen"` o selo de TURNO some — "VAI A 2T" é falso por
   * construção (turno único), e "● ELEITO" só no líder negaria a segunda vaga.
   *
   * 🔴 2026-09-29 (decisão do dono, "são 2 senadores eleitos") — o selo
   * "● ELEITO" VOLTA ao cartão de Senador, **nas duas** candidaturas que
   * ocupam as vagas (as `vagasDaCorrida(5)` primeiras que disputam, na ordem
   * do cartão — a da projeção), com o mesmo desenho do selo de governador. A
   * objeção de 27/09 era o selo só no líder; com ele nos dois, ela cai. O
   * `aria-label` diz "eleitos" e nomeia os dois.
   *
   * 🔴 2026-09-28 (ADR-0057 item 6) — `"pres"`: o cartão por estado da seção
   * regional da home de Presidente. **Sem selo** de turno (ADR-0055: o 2º
   * turno de Presidente é fato NACIONAL — "VAI A 2T" ou "● ELEITO" num estado
   * afirmaria o que só o total do país decide), e o `aria-label` nomeia o
   * líder do estado sem status nenhum.
   */
  cargo?: "gov" | "sen" | "pres";
  /**
   * Nível do título do cartão. Default 3 (a capa de sempre). Dentro de uma
   * região (`<RegiaoConsolidada>`, cujo título já é h3 em `/senador` e na
   * home) o cartão desce para 4, para não achatar o outline da página.
   */
  nivelTitulo?: 3 | 4;
  /**
   * Spec 025 (RF-245/RF-247) — as etiquetas editoriais desta corrida, já
   * juntadas por `etiquetasDasCorridas` (`lib/etiquetas/telas.ts`): o chip ao
   * lado do nome de quem tem chance e, com o filtro ligado, os tokens que vão
   * para `data-etq` do `<article>`. Ausente ⇒ o cartão sai byte a byte igual.
   * Nunca muda a ordem das linhas (constituição § 2 (e)): a lista é
   * `top_candidatos`, e a etiqueta só é consultada linha a linha.
   */
  etiquetas?: EtiquetasDaCorrida;
  /**
   * 04/10/2026 (dono) — o cartão reage à chave "Parcial / Projeção" das capas
   * `/governador` e `/senador`: a lista sai nas duas bases, cada uma sob
   * `data-view-only`. Na Parcial, `pct_atual` (cor `--color-pct-votos`), na
   * ordem do apurado, com o selo da mesma base; na Projeção, a lista de
   * sempre. Ausente ⇒ o cartão de antes, uma lista só (a home de Presidente).
   */
  duasBases?: boolean;
}

/**
 * Vagas por UF no Senado — da tabela canônica (`lib/config/cargos.ts`: 2 em
 * 2026, renovação de 2/3), nunca um literal. Só a variante `"sen"` lê.
 */
const VAGAS_SENADO = vagasDaCorrida(5);

/**
 * 2026-09-29 — o selo de eleito do SENADO, o MESMO desenho e o mesmo texto do
 * de governador (`chipFor`, variante `e`), em cada ocupante de vaga. Pela
 * projeção (a ordem do cartão), e só com apuração começada: sem voto contado
 * não há projeção, e "● ELEITO" seria fabricado (constituição § 1).
 */
const CHIP_ELEITO_SENADO: StatusChip = { label: "● ELEITO", s: "e", ariaText: "eleitos" };

/** Nenhum ocupante de vaga — as variantes de vaga única (`"gov"`, `"pres"`). */
const SEM_OCUPANTES: ReadonlySet<number> = new Set();

interface StatusChip {
  label: string;
  /**
   * Variante do selo em `GovernorCard.module.css` (`b[data-s]`): `e` eleito,
   * `t` 2º turno, `a` em apuração. As cores (fundo `-strong` + tinta pareada
   * por tema, nunca branco fixo — o axe mediu 1,62:1 e 1,85:1 no tema escuro
   * com branco cravado, 2026-09-10) moram lá desde 2026-09-28.
   */
  s: "e" | "t" | "a";
  ariaText: string;
}

/**
 * Selo de status da UF — spec 006, RF-006.8 (2026-09-27).
 *
 * 🔴 **Era um `switch` sobre `bucket` até esta data, e `"chamada"` saía como
 * "● ELEITO".** `chamada` é só "margem grande" — ortogonal ao turno
 * (`EdgeUfRow.bucket`) —, então um líder com 38,5% e 13pp de folga ganhava o
 * selo de eleito na mesma linha em que o payload dizia `vai_a_2t: true` (ES,
 * GO e MG no simulado de 26/09). O desfecho agora vem de
 * `classificarProjecao` (`lib/utils/desfecho-governador.ts`), a mesma regra do
 * filtro "Decididos no 1º turno" e dos gráficos de `/governador`: selo,
 * filtro e gráfico não podem discordar.
 */
function chipFor(uf: Pick<EdgeUfRow, "vai_a_2t" | "bucket">): StatusChip {
  switch (classificarProjecao(uf)) {
    case "eleito_1t":
      return { label: "● ELEITO", s: "e", ariaText: "eleito" };
    case "segundo_turno":
      return { label: "VAI A 2T", s: "t", ariaText: "vai ao segundo turno" };
    default:
      return { label: "EM APURAÇÃO", s: "a", ariaText: "em apuração" };
  }
}

interface Row {
  id: number | null; // null = "Outros"
  nome: string;
  partido: string;
  /**
   * O número da linha NA BASE da lista: `pct` (projeção) ou `pct_atual`
   * (Parcial). `null` só na Parcial, quando o apurado não foi medido — a tela
   * escreve "—", nunca `0` (decisão do dono, 14/09).
   */
  pct: number | null;
  /** Já resolvida pela SIGLA — ver o `candidateColor` abaixo. */
  corResolvida: string;
  rank: number; // só pra "Outros" virar cinza
  /** ADR-0053 / RF-213 — etiqueta e posição; ausente ⇒ compete. */
  destino?: EdgeDestinoVoto;
  /** Votos apurados — lidos SÓ na linha da anulada, que não mostra % (opção A). */
  votos?: number;
  /** Spec 025 — a chave da junção com as etiquetas editoriais. */
  sqcand?: string | null;
}

type TopCandidato = EdgeUfRow["top_candidatos"][number];

/**
 * 04/10/2026 (dono) — a ordem da lista na base PARCIAL: as 4 primeiras do
 * corte inteiro (`top_candidatos`, resgatados do RF-190 incluídos) pelo
 * comparador único `rankByParcial` (`pct_atual` desc → `pct_projetado` desc →
 * `id` asc), anulada no fim das 4 — o espelho exato da lista da projeção
 * (prefixo de 4 do array, anulada no fim).
 *
 * `null` quando a Parcial não tem leitura honesta: nada apurado, ou falta
 * `pct_atual` a alguém do corte. Aí a ordem cai INTEIRA para a da projeção
 * (constituição § 2, exceção (c)) e os números saem "—".
 */
function ordemParcial(uf: EdgeUfRow): TopCandidato[] | null {
  const top = uf.top_candidatos ?? [];
  if (!(uf.pct_apurado > 0) || top.length === 0) return null;
  if (!top.every((t) => typeof t.pct_atual === "number")) return null;
  const porId = new Map(top.map((t) => [t.id, t] as const));
  const ranking = rankByParcial(
    top.map((t) => ({ id: t.id, pct_atual: t.pct_atual as number, pct_projetado: t.pct })),
  );
  return anuladasAoFim(ranking.slice(0, 4).map((r) => porId.get(r.id) as TopCandidato));
}

/**
 * O selo de governador na Parcial — "se a apuração parasse agora", a MESMA
 * regra de `<GovernadoresPlacarTurno base="contagem">` (`classificarContagem`,
 * `lib/utils/desfecho-governador.ts`) e o mesmo condicional dos rótulos dele.
 * Nunca "eleito". `aguardando` ⇒ sem selo: não há contagem a resumir.
 */
function chipContagem(uf: EdgeUfRow): StatusChip | null {
  switch (classificarContagem(uf)) {
    case "eleito_1t":
      return { label: "FECHARIA NO 1T", s: "e", ariaText: "fecharia no 1º turno" };
    case "segundo_turno":
      return { label: "IRIA AO 2T", s: "t", ariaText: "iria ao 2º turno" };
    default:
      return null;
  }
}

/**
 * O selo de vaga do SENADO na Parcial — sempre com a base dita, como o
 * `VAGA_LABEL.parcial` do `<ResultPanel>` (`lib/utils/selo-resultado.ts`).
 * Variante neutra: verde é a cor de "eleito", e isto não é.
 */
const CHIP_VAGA_PARCIAL: StatusChip = {
  label: "VAGA NA PARCIAL",
  s: "a",
  ariaText: "nas vagas na parcial",
};

export function GovernorCard({
  uf,
  candidatos,
  cargo = "gov",
  nivelTitulo = 3,
  etiquetas,
  duasBases = false,
}: GovernorCardProps) {
  const senado = cargo === "sen";
  const presidente = cargo === "pres";
  const chip = senado || presidente ? null : chipFor(uf);
  const Titulo = `h${nivelTitulo}` as "h3" | "h4";
  const nomeUf = UF_NAMES[uf.sigla] ?? uf.sigla;
  const candIndex = new Map(candidatos.map((c) => [c.id, c] as const));

  // Top-4 derivados de uf.top_candidatos (ordenado por pct desc — orchestrator
  // garante). **Era `.slice(0, 3)` até 2026-09-19** — ver o cabeçalho do
  // arquivo: decisão do dono, com o produtor já emitindo 4 entradas
  // (`TOP_CANDIDATOS_POR_UF`, `api/model/project.py`).
  //
  // O `.slice()` FICA de propósito, não vira `.map()` direto: o contrato de
  // `top_candidatos` não promete comprimento nenhum (docstring do campo em
  // `lib/edge-config/types.ts`), e um payload gravado antes desta data traz 3
  // entradas e nenhum `outros` — legítimo, e a tela tem de continuar
  // renderizando. O corte é o que amarra ESTA superfície ao número que o dono
  // pediu, em vez de deixá-la crescer com o que o produtor resolver emitir.
  // ADR-0053 / RF-213 — anulada no fim das 4 linhas (antes de "Outros"), com
  // etiqueta; o líder do cartão é o 1º QUE COMPETE. Sem anulada, a ordem é a
  // de sempre.
  const topCandidatos = anuladasAoFim((uf.top_candidatos ?? []).slice(0, 4));
  const linha = (t: TopCandidato, i: number, pct: number | null): Row => {
    const meta = candIndex.get(t.id);
    return {
      id: t.id,
      // Spec 018 / ADR-0042 — nome e partido vêm da PRÓPRIA linha da UF, nunca
      // mais de `candIndex`. O índice é construído sobre `national.candidatos`,
      // que em cargo 3 é a **união de 27 corridas** sob o mesmo espaço de `id`
      // (ver o comentário do `GovernorCardProps.candidatos`): `id === 13` ali
      // não é uma pessoa, é "o número 13 nalguma UF". Resolver nome por ele
      // punha o candidato de um estado no card de outros 26 — e o único caller
      // de produção (`app/(gov)/governador/page.tsx`) passa exatamente esse
      // array. `uf.top_candidatos[]` é resolvido pelo par `(uf, numero)` no
      // orchestrator, então já sabe de que estado é.
      //
      // Fallback para payload PRÉ-018 (campo ausente): o placeholder de
      // sempre. É deliberado que ele NÃO caia de volta no índice nacional —
      // "Cand 13" é feio e verdadeiro; o nome do governador de outro estado
      // seria bonito e falso.
      // `t.sqcand` existe em TODO cargo aqui (esta linha é de UMA UF, então o
      // par `(uf, numero)` que a resolve não é ambíguo) — é o único lugar do
      // cargo 3 em que a decisão editorial por `sqcand` chega a valer.
      nome: t.nome ? nomeExibicao(t.nome, t.sqcand) : `Cand ${t.id}`,
      partido: t.partido ?? "—",
      pct,
      // ⚠️ A redação anterior dizia que a cor "é função do RANK, não da
      // identidade". Isso deixou de valer com o ADR-0024 (07/09): a cor É a
      // identidade, e o grid de 27 governadores é o exemplo que o próprio ADR
      // usa — 27 líderes de partidos diferentes saíam todos na cor de rank 1.
      // Barra = preenchimento com extensão ⇒ cor-base.
      corResolvida: candidateColor(meta?.partido, meta?.rank ?? i + 1),
      rank: meta?.rank ?? i + 1,
      ...(t.destino ? { destino: t.destino } : {}),
      ...(typeof t.votos_atuais === "number" ? { votos: t.votos_atuais } : {}),
      ...(etiquetas ? { sqcand: normalizarSqcand(t.sqcand) } : {}),
    };
  };
  const top = topCandidatos.map<Row>((t, i) => linha(t, i, t.pct));

  // 🔴 A linha "Outros" vem do CAMPO `uf.outros` (2026-09-19), nunca mais de
  // `100 − Σ(top)`.
  //
  // O que havia aqui até esta data:
  //
  //     const outrosPct  = Math.max(0, 100 - sumTop);
  //     const showOutros = (uf.top_candidatos?.length ?? 0) > 3 && outrosPct > 0.5;
  //
  // Era **código morto**: o produtor cortava o array em 3, então `length > 3`
  // nunca era verdade e a subtração nunca aparecia na tela. No dia em que o
  // corte virou 4, o mesmo gatilho passaria a disparar SEMPRE — e com o 4º
  // colocado agora DENTRO de `top`, "Outros" publicaria a diferença de
  // fechamento como se fosse voto de alguém, além de somar 100 na cara do
  // leitor. Continuaria compilando e continuaria verde nos testes de então:
  // exatamente a regressão silenciosa que a migração evita.
  //
  // Por que a soma do produtor e não a subtração: os quatro pontos de uma UF
  // são médias de bootstraps independentes e não fecham em 100 exatamente. A
  // subtração empurra esse resíduo para dentro de "Outros"; a soma candidato a
  // candidato, não. Ver a docstring de `EdgeUfRow.outros`
  // (`lib/edge-config/types.ts`) e `tests/unit/model/test_uf_outros.py`, cuja
  // fixture soma 99,1 DE PROPÓSITO para que as duas contas divirjam.
  //
  // ⚠️ `Σ(top 4) + outros.pct` **não fecha exatamente em 100** — e não
  // normalizamos. Normalizar fabricaria o fechamento, que é a mesma classe de
  // erro da subtração (decisão registrada com a do dono, 19/09).
  //
  // Gatilho = a EXISTÊNCIA do campo. Cauda vazia (UF com ≤ 4 candidaturas no
  // cargo) ⇒ o produtor OMITE `outros` e aqui não há linha nenhuma. Ele nunca
  // emite `{ pct: 0 }`: "não há mais ninguém" e "os demais somam 0%" são
  // estados diferentes (decisão do dono, 14/09) e um zero escreveria "Outros
  // 0,0%" numa corrida de três.
  const outros = uf.outros;
  const linhaOutros = (pct: number | null): Row => ({
    id: null,
    nome: "Outros",
    partido: "",
    pct,
    corResolvida: "var(--color-cand-other)",
    rank: 99,
  });
  const rows: Row[] = outros ? [...top, linhaOutros(outros.pct)] : top;

  const liderRow = top.find(compete);
  // 2026-09-29 — Senado: quem ocupa as vagas, pelo ponto único
  // (`lib/utils/vagas-eleitas.ts`) sobre a ORDEM DO CARTÃO (a da projeção,
  // anulada no fim). É o mesmo conjunto do hemiciclo de 2027 e do balão do
  // mapa na base "Projeção".
  const ocupantes = senado ? idsDasVagas(topCandidatos, VAGAS_SENADO) : SEM_OCUPANTES;
  const chipSenado = senado && uf.pct_apurado > 0 ? CHIP_ELEITO_SENADO : null;
  /** O selo desta linha: o de turno no líder (gov), o de eleito em cada vaga (sen). */
  const seloDe = (r: Row): StatusChip | null => {
    if (r.id === null) return null;
    if (senado) return ocupantes.has(r.id) ? chipSenado : null;
    return r.id === liderRow?.id ? chip : null;
  };
  // 🔊 `aria-label` — sigla INTEIRA, de propósito (2026-09-19). A abreviação
  // resolve largura, e aqui não há largura: "REPUBLICANOS" dito por inteiro é
  // exatamente o que o TSE publica. A regra está em `lib/utils/sigla-partido.ts`.
  // Senado: os que ocupam as vagas pela ordem do cartão — não "o líder".
  const destaque = senado
    ? top.filter((r) => r.id !== null && ocupantes.has(r.id))
    : liderRow
      ? [liderRow]
      : [];
  const descreve = (r: Row) =>
    `${r.nome} (${r.partido}) com ${r.pct === null ? "—" : formatPercentTrim(r.pct)}`;
  const apurado = `${formatPercentTrim(uf.pct_apurado)} apurado`;
  const descricaoProj = senado
    ? `${destaque.length > 0 ? `, ${chipSenado ? chipSenado.ariaText : "mais votados"}: ${destaque.map(descreve).join(" e ")}` : ""}`
    : presidente
      ? `${liderRow ? `, na frente no estado: ${descreve(liderRow)}` : ""}`
      : `, ${chip?.ariaText}${liderRow ? `, líder: ${descreve(liderRow)}` : ""}`;
  const ariaLabel = `${nomeUf}${descricaoProj}, ${apurado}`;

  /** Uma lista de linhas — a de sempre, ou a da Parcial no modo de duas bases. */
  const lista = (
    linhas: readonly Row[],
    selo: (r: Row) => StatusChip | null,
    ariaLista?: string,
  ) => (
    // Spread condicional pelo mesmo motivo do `data-etq` abaixo: no payload RSC
    // um `aria-label={undefined}` viraria `"$undefined"` em cada cartão.
    <ul {...(ariaLista !== undefined ? { "aria-label": ariaLista } : {})}>
      {linhas.map((r, idx) => {
        const s = selo(r);
        const pctWidth = r.pct === null ? 0 : Math.max(0, Math.min(100, r.pct));
        return (
          <li key={r.id ?? `outros-${idx}`}>
            <span aria-hidden="true">{r.id === null ? "" : compete(r) ? `${idx + 1}°` : "—"}</span>
            {/* Quebra, não corta (2026-09-28): selo e etiqueta descem
                INTEIROS para a linha de baixo quando não cabem. */}
            <span>
              {r.nome}
              {/* Desenhado ⇒ abreviado (2026-09-19). */}
              {r.partido ? <span>{siglaExibicao(r.partido)}</span> : null}
              {r.destino ? <DestinoEtiqueta destino={r.destino} /> : null}
              {/* Spec 025 — o chip editorial divide a MESMA posição do selo:
                  sem etiqueta, a lista de filhos do `<span>` é a de antes, e
                  o payload RSC (o cartão é filho de `<RegiaoRecolhivel>`,
                  cliente) não ganha um `null` por linha. `<span>` de texto,
                  nunca interativo (no /senador o cartão está num `<a>`); só
                  para quem tem chance, e só com a chave `chips` ligada. */}
              {r.sqcand && etiquetas?.porSqcand.has(r.sqcand) ? (
                <>
                  {s ? <b data-s={s.s}>{s.label}</b> : null}
                  <EtiquetasLinha resolucoes={etiquetas.porSqcand.get(r.sqcand)} />
                </>
              ) : s ? (
                <b data-s={s.s}>{s.label}</b>
              ) : null}
            </span>
            {r.id !== null && !exibePercentual(r) ? (
              // Emenda "opção A" ao ADR-0053 — a anulada não tem barra nem
              // percentual (o % dela é sobre outra base). Os votos ocupam as
              // DUAS colunas (barra + número), para a linha continuar
              // alinhada; sem voto no dado, o espaço fica vazio.
              <span data-testid="governor-card-votos-anulada">{votosDaAnulada(r.votos, true)}</span>
            ) : (
              <>
                <i
                  aria-hidden="true"
                  style={
                    { "--w": `${round2(pctWidth)}%`, "--cor": r.corResolvida } as CSSProperties
                  }
                >
                  <i />
                </i>
                <span>{r.pct === null ? "—" : formatPercentTrim(r.pct)}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );

  const cabecalho = (
    <header>
      <Titulo>
        {/* Bandeira decorativa (`alt=""`): o nome do estado e a sigla
            continuam em texto. Classe, não `style` — 27 cartões por tela. */}
        <UfFlag sigla={uf.sigla} width={17} height={12} inline />
        {nomeUf}
        <span>· {uf.sigla}</span>
      </Titulo>
      <span>{formatPercentTrim(uf.pct_apurado)} apur</span>
    </header>
  );
  // Spread condicional, e não `data-etq={undefined}`: o cartão também viaja
  // no payload RSC (é `children` do `<RegiaoRecolhivel>`, cliente), e lá um
  // `undefined` vira `"data-etq":"$undefined"` — 23 B × 27 cartões por nada.
  const dataEtq = etiquetas?.tokens !== undefined ? { "data-etq": etiquetas.tokens } : {};

  // 🔴 2026-09-28 — markup ENXUTO. Até esta data cada cartão carregava ~4,3 KB
  // de `style={}` e classes utilitárias repetidos em toda linha, e a home
  // passou a montar 27 cartões (ADR-0057 item 6). O desenho inteiro está em
  // `GovernorCard.module.css`, com UMA classe na raiz e os filhos alcançados
  // por estrutura; no HTML fica só o que é DADO da linha — `--w` (largura da
  // barra) e `--cor` (cor do partido), no `style` do trilho. A estrutura da
  // linha é contrato daquele arquivo: mudar a ordem dos filhos do `<li>` muda
  // o desenho.
  if (!duasBases) {
    return (
      <article aria-label={ariaLabel} className={styles.c} {...dataEtq}>
        {/* 🔴 2026-09-28 (decisão do dono) — o cartão completo (4 primeiros +
            "Outros") vale em TODA largura; a linha única do celular saiu. */}
        {cabecalho}
        {lista(rows, seloDe)}
      </article>
    );
  }

  // ===== 04/10/2026 (dono) — as duas bases no mesmo cartão =================
  //
  // O cabeçalho (UF, % apurado) é um só; a LISTA sai duas vezes, cada uma num
  // `<div data-view-only>` NU (sem `display` próprio — `app/globals.css`):
  // a da projeção, idêntica à de sempre, e a da Parcial — `pct_atual`, na
  // ordem do apurado, com o selo da mesma base. A descrição para leitor de
  // tela passa do `<article>` para cada `<ul>` (`aria-label`): um nome só no
  // cartão não pode dizer a projeção na visão Parcial.
  const ordem = ordemParcial(uf);
  const usaParcial = ordem !== null;
  const topParcial = (ordem ?? topCandidatos).map<Row>((t, i) =>
    linha(t, i, usaParcial && typeof t.pct_atual === "number" ? t.pct_atual : null),
  );
  const rowsParcial: Row[] = outros
    ? [...topParcial, linhaOutros(usaParcial ? (outros.pct_atual ?? null) : null)]
    : topParcial;
  const liderParcial = usaParcial ? topParcial.find(compete) : undefined;
  // Senado: os ocupantes vêm de `vagasDaUfNaParcial` — o MESMO ponto da barra
  // das 54 e do hemiciclo na Parcial (constituição § 2 (b): cor, ordem e
  // destaque de uma base não discordam). UF `aguardando` ⇒ ninguém marcado.
  const ocupantesParcial: ReadonlySet<number> = senado
    ? new Set(vagasDaUfNaParcial(uf, VAGAS_SENADO).ocupantes.map((c) => c.id))
    : SEM_OCUPANTES;
  const chipParcialGov = senado || presidente ? null : chipContagem(uf);
  const seloParcial = (r: Row): StatusChip | null => {
    if (r.id === null) return null;
    if (senado) return ocupantesParcial.has(r.id) ? CHIP_VAGA_PARCIAL : null;
    return r.id === liderParcial?.id ? chipParcialGov : null;
  };
  const destaqueParcial = senado
    ? topParcial.filter((r) => r.id !== null && ocupantesParcial.has(r.id))
    : liderParcial
      ? [liderParcial]
      : [];
  const descricaoParcial = !usaParcial
    ? ", na parcial: aguardando apuração"
    : senado
      ? destaqueParcial.length > 0
        ? `, ${CHIP_VAGA_PARCIAL.ariaText}: ${destaqueParcial.map(descreve).join(" e ")}`
        : ""
      : `, se a apuração parasse agora${chipParcialGov ? `: ${chipParcialGov.ariaText}` : ""}${
          liderParcial ? `, na frente: ${descreve(liderParcial)}` : ""
        }`;

  return (
    <article aria-label={`${nomeUf}, ${apurado}`} className={styles.c} {...dataEtq}>
      {cabecalho}
      <div data-view-only="proj">{lista(rows, seloDe, `Pela projeção${descricaoProj}`)}</div>
      <div data-view-only="parcial">
        {lista(rowsParcial, seloParcial, `Na parcial${descricaoParcial}`)}
      </div>
    </article>
  );
}

/** Largura da barra com 2 casas — sub-pixel a mais não muda desenho, só bytes. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
