/**
 * components/blocks/GovernorCard.tsx
 *
 * S06/F4d (Fase 3) — card individual de UF na grid `/governador`.
 * Layout opção (b) decidida no plan S06:
 *   - Header: "Nome do estado · SIGLA    pct% apur"
 *   - Top-4 candidatos com nome + partido + barra colorida pela SIGLA
 *   - 5ª linha "Outros" agregando o restante
 *   - Chip de status à direita do líder (● ELEITO / VAI A 2T / EM APURAÇÃO)
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
import { candidateColor } from "@/components/blocks/_candidateColor";
import type { EdgeCandidate, EdgeDestinoVoto, EdgeUfRow } from "@/lib/edge-config/types";
import { classificarProjecao } from "@/lib/utils/desfecho-governador";
import { anuladasAoFim, compete, exibePercentual, votosDaAnulada } from "@/lib/utils/destino-voto";
import { formatPercentTrim } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

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
   * votos válidos. Em `"sen"` o selo de status some — ele diz "eleito no 1º
   * turno / vai a 2º turno", e o Senado é turno único com DUAS vagas por
   * estado: "● ELEITO" só no líder negaria a segunda vaga, e "VAI A 2T" é
   * falso por construção. O `aria-label` nomeia os dois primeiros pelo mesmo
   * motivo (duas vagas, não um líder).
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
}

/** Vagas por UF no Senado em 2026 (renovação de 2/3) — só para a variante `"sen"`. */
const VAGAS_SENADO = 2;

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
  pct: number;
  /** Já resolvida pela SIGLA — ver o `candidateColor` abaixo. */
  corResolvida: string;
  rank: number; // só pra "Outros" virar cinza
  /** ADR-0053 / RF-213 — etiqueta e posição; ausente ⇒ compete. */
  destino?: EdgeDestinoVoto;
  /** Votos apurados — lidos SÓ na linha da anulada, que não mostra % (opção A). */
  votos?: number;
}

export function GovernorCard({
  uf,
  candidatos,
  cargo = "gov",
  nivelTitulo = 3,
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
  const top = anuladasAoFim((uf.top_candidatos ?? []).slice(0, 4)).map<Row>((t, i) => {
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
      pct: t.pct,
      // ⚠️ A redação anterior dizia que a cor "é função do RANK, não da
      // identidade". Isso deixou de valer com o ADR-0024 (07/09): a cor É a
      // identidade, e o grid de 27 governadores é o exemplo que o próprio ADR
      // usa — 27 líderes de partidos diferentes saíam todos na cor de rank 1.
      // Barra = preenchimento com extensão ⇒ cor-base.
      corResolvida: candidateColor(meta?.partido, meta?.rank ?? i + 1),
      rank: meta?.rank ?? i + 1,
      ...(t.destino ? { destino: t.destino } : {}),
      ...(typeof t.votos_atuais === "number" ? { votos: t.votos_atuais } : {}),
    };
  });

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
  const rows: Row[] = outros
    ? [
        ...top,
        {
          id: null,
          nome: "Outros",
          partido: "",
          pct: outros.pct,
          corResolvida: "var(--color-cand-other)",
          rank: 99,
        },
      ]
    : top;

  const liderRow = top.find(compete);
  // 🔊 `aria-label` — sigla INTEIRA, de propósito (2026-09-19). A abreviação
  // resolve largura, e aqui não há largura: "REPUBLICANOS" dito por inteiro é
  // exatamente o que o TSE publica. A regra está em `lib/utils/sigla-partido.ts`.
  // Senado: os que ocupam as vagas pela ordem do cartão — não "o líder".
  const destaque = senado ? top.filter(compete).slice(0, VAGAS_SENADO) : liderRow ? [liderRow] : [];
  const descreve = (r: Row) => `${r.nome} (${r.partido}) com ${formatPercentTrim(r.pct)}`;
  const apurado = `${formatPercentTrim(uf.pct_apurado)} apurado`;
  const ariaLabel = senado
    ? `${nomeUf}${destaque.length > 0 ? `, mais votados: ${destaque.map(descreve).join(" e ")}` : ""}, ${apurado}`
    : presidente
      ? `${nomeUf}${liderRow ? `, na frente no estado: ${descreve(liderRow)}` : ""}, ${apurado}`
      : `${nomeUf}, ${chip?.ariaText}${liderRow ? `, líder: ${descreve(liderRow)}` : ""}, ${apurado}`;

  // 🔴 2026-09-28 — markup ENXUTO. Até esta data cada cartão carregava ~4,3 KB
  // de `style={}` e classes utilitárias repetidos em toda linha, e a home
  // passou a montar 27 cartões (ADR-0057 item 6). O desenho inteiro está em
  // `GovernorCard.module.css`, com UMA classe na raiz e os filhos alcançados
  // por estrutura; no HTML fica só o que é DADO da linha — `--w` (largura da
  // barra) e `--cor` (cor do partido), no `style` do trilho. A estrutura da
  // linha é contrato daquele arquivo: mudar a ordem dos filhos do `<li>` muda
  // o desenho.
  return (
    <article aria-label={ariaLabel} className={styles.c}>
      {/* 🔴 2026-09-28 (decisão do dono) — o cartão completo (4 primeiros +
          "Outros") vale em TODA largura; a linha única do celular saiu. */}
      <header>
        <Titulo>
          {nomeUf}
          <span>· {uf.sigla}</span>
        </Titulo>
        <span>{formatPercentTrim(uf.pct_apurado)} apur</span>
      </header>
      <ul>
        {rows.map((r, idx) => {
          const isLider = r.id !== null && r.id === liderRow?.id;
          const pctWidth = Math.max(0, Math.min(100, r.pct));
          return (
            <li key={r.id ?? `outros-${idx}`}>
              <span aria-hidden="true">
                {r.id === null ? "" : compete(r) ? `${idx + 1}°` : "—"}
              </span>
              {/* Quebra, não corta (2026-09-28): selo e etiqueta descem
                  INTEIROS para a linha de baixo quando não cabem. */}
              <span>
                {r.nome}
                {/* Desenhado ⇒ abreviado (2026-09-19). */}
                {r.partido ? <span>{siglaExibicao(r.partido)}</span> : null}
                {r.destino ? <DestinoEtiqueta destino={r.destino} /> : null}
                {isLider && chip ? <b data-s={chip.s}>{chip.label}</b> : null}
              </span>
              {r.id !== null && !exibePercentual(r) ? (
                // Emenda "opção A" ao ADR-0053 — a anulada não tem barra nem
                // percentual (o % dela é sobre outra base). Os votos ocupam as
                // DUAS colunas (barra + número), para a linha continuar
                // alinhada; sem voto no dado, o espaço fica vazio.
                <span data-testid="governor-card-votos-anulada">
                  {votosDaAnulada(r.votos, true)}
                </span>
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
                  <span>{formatPercentTrim(r.pct)}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/** Largura da barra com 2 casas — sub-pixel a mais não muda desenho, só bytes. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
