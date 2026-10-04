"use client";

/**
 * components/blocks/StrongholdsPanel.tsx
 *
 * "Redutos" — onde cada força é mais forte, por percentual projetado e pela
 * margem projetada local. Design system Atlas Menna (ADR-0025, Bloco 1),
 * portado do `StrongholdsPanel` de
 * `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:58`.
 *
 * Cobertura: RF-024 (leitura estadual da corrida nacional) e RF-030.6
 * (distribuição por UF em corrida multi-candidato), na chave "por candidato"
 * em vez de "por UF" — é a mesma matriz lida na outra direção.
 *
 * ===== 2026-09-10 — as pílulas do protótipo =====
 * Até aqui o bloco renderizava uma coluna FIXA por candidato, todas ao mesmo
 * tempo, e declarava a omissão da fileira de pílulas em comentário. As pílulas
 * agora existem: uma por candidato (até 5, `race.candidates.slice(0,5)` do
 * kit), e a tabela mostra as 10 UFs do candidato selecionado.
 *
 * A troca não é cosmética — as três colunas eram um defeito de layout. A
 * coluna de painéis mede `--container-sidebar` (400px) no desktop (ADR-0033
 * § 1), enquanto o `md:grid-cols-3` que estava aqui é uma media query de
 * VIEWPORT: acima de 768px de janela, as três tabelas se espremiam em ~130px
 * cada dentro de uma coluna de 400px. Uma tabela por vez cabe.
 *
 * Custo declarado: o bloco vira Client Component (`useState` para a seleção).
 * É o mesmo custo que o kit paga, e é o único jeito de a seleção existir.
 *
 * ===== De onde vem cada número =====
 * Tudo sai de `EdgeUfRow.top_candidatos[]`, cujo `pct` é literalmente o
 * `pct_projetado` daquele candidato naquela UF (ver o campo em
 * `lib/edge-config/types.ts`). Portanto:
 *   - "% projetado" = `top_candidatos[i].pct`
 *   - "posição"     = índice em `top_candidatos` + 1 (o array vem ordenado
 *                     por `pct` desc, com tie-breaker estável por id)
 *   - "diferença"   = margem projetada local: para quem está em 1º, a
 *                     distância até o 2º (positiva); para quem está abaixo,
 *                     a distância até o 1º (negativa)
 *
 * Nada é inventado. Em particular **não** usamos `EdgeUfRow.margem_projetada`
 * aqui: aquele campo é a margem do líder da UF, então só coincidiria com a
 * "diferença" na linha de quem lidera — misturar as duas fontes produziria
 * dois números levemente diferentes para a mesma coisa na mesma tabela.
 *
 * ===== O corte é DESTE componente, e vale 4 desde 2026-09-19 =====
 * Até 19/09 o limite era do payload: `api/model/project.py` emitia no máximo
 * 3 candidatos por UF em `top_candidatos`, e este arquivo apenas herdava o
 * número — o 3 daqui não era escolha de ninguém, era o que chegava.
 *
 * O produtor passou a emitir **4** (pedido do dono — o balão do mapa mostra 4
 * + "Outros"), e com isso o número virou decisão que este arquivo tem de
 * tomar e declarar: `strongholdsFor` corta em {@link STRONGHOLD_POSICAO_MAX}.
 *
 * **O valor é 4, e isso corrige um defeito que este próprio bloco descrevia.**
 * A versão anterior deste parágrafo LAMENTAVA o limite: dizia que a lista de
 * um candidato de rank 3 sai mais curta que a dos dois primeiros, e que a
 * pílula do 4º colocado nacional pode abrir uma tabela vazia. Não era um
 * limite desejado — era um limite sofrido, e a única razão de não corrigi-lo
 * era que o payload não tinha o 4º. Agora tem, e o `pct_projetado` dele é
 * medido exatamente como o dos outros três: não há número sintético nenhum
 * nesta mudança, só uma linha que antes não existia e passou a existir.
 *
 * ⚠️ Consequência visível a esperar: as tabelas ficam mais longas em UFs
 * disputadas, e a pílula do 4º colocado nacional — que antes abria vazia em
 * boa parte dos estados — passa a listar UFs. Isso é o conserto, não um
 * efeito colateral.
 *
 * O que continua valendo do texto antigo: preferimos a lista curta (e o
 * estado vazio explícito, ADR-0017) a um número sintético — um candidato de
 * rank 5 numa UF segue **sem** linha ali, e a tabela vazia continua sendo uma
 * resposta legítima; a legenda de cada tabela mostra o denominador real.
 *
 * ===== Cor =====
 * Identidade pelo partido (ADR-0024), intensidade pela margem local
 * (constituição § 2). Sem `partido` mapeado, cai no rank (ADR-0013). Toda
 * barra leva contorno — ver `DATA_FILL_STROKE` em `./_candidateColor`.
 *
 * **A pílula selecionada é preenchimento com texto por cima**, que é um caso
 * diferente: o par cor-de-fundo + tinta precisa de >= 4,5:1 (constituição § 4),
 * e `colorForParty()` não diz nada sobre a tinta. Quem resolve isso é
 * `partyChipInk(sigla)` (`lib/utils/party-color.ts`), que devolve o par
 * `--party-<slug>-chip` / `--party-<slug>-ink` já medido pelo gerador — o
 * mesmo par que `<PartyTag filled>` exige. Sigla sem token cai no par inverso
 * do shell (`--surface-inverse` / `--text-inverse`), que é o preenchimento do
 * `<Button variant="primary">`; o fallback de rank (`colorForRank`) não tem
 * tinta medida e por isso não pinta pílula.
 *
 * ===== 2026-10-03 — a chave "Ordenar por" (RF-295) =====
 * Pedido do dono: além de "onde o candidato tem o maior percentual", ver onde
 * ele é mais forte pelo NÚMERO LÍQUIDO DE VOTOS de diferença para o adversário
 * da linha. Dois critérios, uma chave segmentada abaixo das pílulas:
 *
 *   - **Percentual** (padrão) — exatamente o comportamento anterior: ordena
 *     pelo `pct` desc e a "Diferença" sai em pp.
 *   - **Votos** — `diffVotos = (me.pct − contra.pct) / 100 ×
 *     row.votos_disputa_projetados`, com o MESMO `contra` da diferença em pp.
 *     É a fórmula do consolidado regional (`lib/utils/consolidado-regiao.ts`):
 *     `votos_disputa_projetados` está na mesma base dos `pct` de
 *     `top_candidatos[]` (ver o campo em `lib/edge-config/types.ts`), então o
 *     produto é voto projetado, não um número de outra régua. Ordena por
 *     `diffVotos` desc — maiores vantagens primeiro, depois as menores
 *     desvantagens — com desempate pela sigla.
 *
 * 🔴 **UF sem `votos_disputa_projetados` não entra no modo Votos.** O tipo diz
 * "ausente ⇒ nunca uma estimativa", e ausência não é zero (decisão do dono de
 * 14/09): tratá-la como 0 poria a UF no meio da lista com "0" de diferença, um
 * empate que ninguém mediu. A legenda da tabela declara quantas ficaram fora.
 *
 * A coluna "Projetado" (%), a barra e a COR (`candidateColorByMargin` pela
 * diferença em pp) não mudam com o critério — o que muda é a ordem e a régua
 * da coluna "Diferença". O critério é estado próprio, independente da pílula:
 * trocar de candidato mantém o critério escolhido.
 *
 * A11y (RNF-023)
 *   - A chave de critério segue o mesmo padrão das pílulas: `<fieldset>` com
 *     `<legend>` só para leitor de tela ("Ordenar por") e o mesmo texto
 *     visível num `<span aria-hidden>` na fileira, `<button aria-pressed>` com
 *     `aria-controls` para a tabela, e o `<caption>` nomeia o critério ativo
 *     para o leitor de tela anunciar a troca.
 *   - As pílulas são um `<fieldset>` com `<legend>` só para leitor de tela, e
 *     cada uma é um `<button aria-pressed>` — alternância de filtro, não
 *     navegação, e todas alcançáveis por Tab. `aria-controls` aponta para a
 *     tabela que elas trocam. (`<fieldset>` e não `role="group"` num `<div>`:
 *     é o elemento nativo do papel, e é o que o `useSemanticElements` do
 *     Biome exige.)
 *   - A tabela é uma `<table>` de verdade com `<caption>` que NOMEIA o
 *     candidato selecionado: a mudança de conteúdo é anunciável e a cor da
 *     pílula nunca é o único portador do estado (o `aria-pressed` é).
 *   - Alvo de toque de `--tap-min` (44px) no mobile — ver
 *     `StrongholdsPanel.module.css`.
 */

import { useId, useState } from "react";

import { PartyTag } from "@/components/atoms/data/PartyTag";
import { rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import { Panel } from "@/components/atoms/surfaces/Panel";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { queCompetem } from "@/lib/utils/destino-voto";
import { formatPercent, formatPp, formatVotesCompact } from "@/lib/utils/format";
import { nomeExibicao, primeiroNomeExibicao } from "@/lib/utils/nome-candidato";
import { partyChipInk } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import {
  candidateColor,
  candidateColorByMargin,
  DATA_FILL_STROKE,
  partidoIsMapped,
} from "./_candidateColor";
import styles from "./StrongholdsPanel.module.css";

export interface StrongholdsPanelProps {
  /** `EdgeNational.candidatos`, já ordenado por rank. */
  candidatos: EdgeCandidate[];
  rows: EdgeUfRow[];
  /** Quantos candidatos viram pílula. Default 5 — o corte do kit. */
  topCandidatos?: number;
  /** Quantas UFs listar por força. Default 10 — o corte do kit. */
  topUfs?: number;
  className?: string;
}

/**
 * Quantas colocações deste painel contam como "reduto".
 *
 * Constante nomeada porque o número deixou de ser herdado do produtor em
 * 2026-09-19 — ver "O corte é DESTE componente" no topo do arquivo. Hoje ela
 * coincide com `TOP_CANDIDATOS_POR_UF` de `api/model/project.py`, e a
 * coincidência é intencional mas **não é um acoplamento**: se o produtor
 * emitir 5 um dia, este painel só passa a mostrar 5 quando alguém mudar
 * ESTE número, de propósito. Foi exatamente essa distinção que faltou até
 * 19/09, quando o 3 daqui era herança invisível e ninguém sabia que estava
 * decidindo algo ao mexer no produtor.
 */
export const STRONGHOLD_POSICAO_MAX = 4;

/** Uma UF na lista de um candidato. */
export interface StrongholdRow {
  sigla: string;
  /** Posição do candidato entre os `top_candidatos` daquela UF (1..{@link STRONGHOLD_POSICAO_MAX}). */
  posicao: number;
  /** `pct_projetado` do candidato na UF (0–100). */
  pct: number;
  /** Margem projetada local em pp: `+` quando lidera, `−` quando não. */
  diff: number;
  /** Sigla de quem está do outro lado da diferença. */
  contraNome: string;
  /**
   * A mesma diferença em VOTOS projetados (RF-295): `diff / 100 ×
   * row.votos_disputa_projetados`, arredondada para inteiro. `null` quando a
   * UF não publica `votos_disputa_projetados` — nunca uma estimativa, nunca 0.
   */
  diffVotos: number | null;
}

/** Critério de ordenação do painel (RF-295). */
export type StrongholdCriterio = "percentual" | "votos";

/**
 * Diferença em votos com sinal, em forma compacta: "+1,2 mi", "−340 mil".
 * O sinal negativo é o MESMO caractere de `formatPp` (U+2212), para as duas
 * réguas da coluna "Diferença" se lerem iguais.
 */
export function formatVotosDiferenca(votos: number): string {
  if (!Number.isFinite(votos)) return "—";
  const sign = votos > 0 ? "+" : votos < 0 ? "−" : "";
  return `${sign}${formatVotesCompact(Math.abs(votos))}`;
}

/**
 * UFs em que `candidatoId` aparece nos `top_candidatos`, ordenadas pelo
 * critério (tie-breaker por sigla, para ser determinístico — constituição § 6).
 * Exportada para o teste medir a regra sem o DOM.
 *
 *   - `"percentual"` (padrão): percentual projetado desc.
 *   - `"votos"` (RF-295): `diffVotos` desc; UF com `diffVotos === null` fica
 *     FORA da lista — ver o bloco de 2026-10-03 no topo.
 */
export function strongholdsFor(
  candidatoId: number,
  rows: EdgeUfRow[],
  candidatosById: Map<number, EdgeCandidate>,
  criterio: StrongholdCriterio = "percentual",
): StrongholdRow[] {
  const out: StrongholdRow[] = [];

  for (const row of rows) {
    // 🔴 `.slice()` EXPLÍCITO, mesmo quando o número coincide com o que o
    // produtor emite — ver "O corte é DESTE componente" no topo. Sem ele, o
    // dia em que `TOP_CANDIDATOS_POR_UF` subir para 5 mudaria o conteúdo
    // desta tabela sem uma linha de diff neste arquivo, que é como o 3 antigo
    // virou premissa silenciosa de seis consumidores.
    //
    // ADR-0053 / RF-213 — posição e diferença são entre quem DISPUTA: uma
    // anulada no topo da UF não põe ninguém em "2º" nem é o "atrás de …". O
    // filtro vem ANTES do corte, para o corte continuar sendo de 4 que competem.
    const top = queCompetem(row.top_candidatos ?? []).slice(0, STRONGHOLD_POSICAO_MAX);
    const i = top.findIndex((t) => t.id === candidatoId);
    if (i < 0) continue;
    const me = top[i];
    if (!me) continue;

    // Em 1º, a diferença é para o 2º; abaixo, para o 1º. Sem adversário na
    // linha (UF com um único candidato no top), não há diferença a exibir.
    const contra = i === 0 ? top[1] : top[0];
    if (!contra) continue;

    // O nome de quem está do outro lado da diferença sai daqui já em forma de
    // EXIBIÇÃO: `contraNome` é uma string no `StrongholdRow`, e o ponto de uso
    // (a célula "atrás de …") não tem mais como chegar ao `sqcand`. Converter
    // na origem é o que impede a célula de dizer "atrás de RONALDO CAIADO"
    // enquanto a pílula ao lado diz "CAIADO".
    const oponente = candidatosById.get(contra.id);
    const diff = me.pct - contra.pct;

    // RF-295 — a mesma `diff`, na régua de votos. Só com o total publicado:
    // ausente (ou não finito) é `null`, e o modo Votos descarta a linha. Zero
    // também: o produtor nunca publica 0 (ausente ≠ zero, decisão de 14/09), e
    // um 0 vindo de bug viraria uma diferença de "0" votos que ninguém mediu.
    const total = row.votos_disputa_projetados;
    const diffVotos =
      typeof total === "number" && Number.isFinite(total) && total > 0
        ? Math.round((diff / 100) * total)
        : null;

    out.push({
      sigla: row.sigla,
      posicao: i + 1,
      pct: me.pct,
      diff,
      contraNome: oponente ? nomeExibicao(oponente.nome, oponente.sqcand) : `#${contra.id}`,
      diffVotos,
    });
  }

  if (criterio === "votos") {
    return out
      .filter((l): l is StrongholdRow & { diffVotos: number } => l.diffVotos !== null)
      .sort((a, b) => b.diffVotos - a.diffVotos || a.sigla.localeCompare(b.sigla, "pt-BR"));
  }

  return out.sort((a, b) => b.pct - a.pct || a.sigla.localeCompare(b.sigla, "pt-BR"));
}

/**
 * Par fundo + tinta da pílula SELECIONADA. Só o par medido do partido serve
 * (ver o bloco "Cor" no topo); sem token de partido, o par inverso do shell.
 */
export function chipFillFor(partido: string | null | undefined): {
  background: string;
  ink: string;
} {
  if (!partidoIsMapped(partido)) {
    return { background: "var(--surface-inverse)", ink: "var(--text-inverse)" };
  }
  return partyChipInk(partido);
}

/**
 * Rótulos VISÍVEIS das pílulas, um por candidato, na ordem de entrada.
 *
 * Regra do kit: primeiro nome. O kit pode se dar ao luxo porque a maquete traz
 * nomes de urna distintos ("Lula", "Tarcísio", "Ciro"). O payload real não
 * garante isso — o fixture de teste deste repositório tem cinco candidatos
 * chamados "Candidato PT", "Candidato PL", "Candidato MDB"… e o corte no
 * primeiro nome produz **cinco pílulas idênticas**, medidas em 2026-09-10 a
 * 400px: cinco botões de 80×32 escritos "Candidato".
 *
 * Então: primeiro nome quando ele já distingue; primeiro nome + sigla quando
 * dois candidatos do quadro o compartilham. Só quem colide paga o rótulo mais
 * longo — no caso real (nomes de urna distintos) a saída é idêntica à do kit.
 * Sem sigla para desempatar, cai no nome completo, que é o último recurso que
 * não inventa nada.
 */
export function chipLabels(
  candidatos: Array<{ nome: string; partido: string; sqcand?: string }>,
): string[] {
  // 🔴 O corte é sobre o nome de EXIBIÇÃO. Sobre o cru, o desempate abaixo
  // também mediria a coisa errada: dois candidatos poderiam colidir no primeiro
  // nome cru e não colidir no de exibição (ou o inverso), e a pílula ganharia
  // ou perderia a sigla por uma colisão que a tela não tem.
  const primeiros = candidatos.map((c) => primeiroNomeExibicao(c.nome, c.sqcand));
  const contagem = new Map<string, number>();
  for (const p of primeiros) contagem.set(p, (contagem.get(p) ?? 0) + 1);

  return candidatos.map((c, i) => {
    const p = primeiros[i] as string;
    if ((contagem.get(p) ?? 0) < 2) return p;
    // 2026-09-19 — a sigla entra aqui como DESEMPATE dentro de uma pílula que
    // já existe porque o espaço é curto; abreviá-la é o mesmo movimento. O
    // canal `sr-only` do botão (mais abaixo) continua dizendo a sigla inteira.
    //
    // A WCAG 2.5.3 segue satisfeita sem truque: o nome acessível deste botão é
    // calculado do CONTEÚDO (não há `aria-label` sobrescrevendo), então o texto
    // visível — "Tarcísio REP" — já está dentro do nome, seguido da expansão
    // "— TARCÍSIO GOMES DE FREITAS, REPUBLICANOS".
    const sigla = c.partido?.trim();
    return sigla ? `${p} ${siglaExibicao(sigla)}` : nomeExibicao(c.nome, c.sqcand);
  });
}

const CELL: React.CSSProperties = {
  padding: "var(--space-2) 0",
  borderTop: "1px solid var(--border-hairline)",
};

/** Célula de número da PROJEÇÃO — cor da projeção (decisão do dono, 2026-10-04). */
const NUMERO_PROJETADO: React.CSSProperties = {
  font: "var(--type-figure-sm)",
  textAlign: "right",
  color: "var(--color-pct-proj)",
};

const HEAD_CELL: React.CSSProperties = {
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  paddingBottom: "var(--space-2)",
  fontWeight: 600,
};

/** Rótulo VISÍVEL de cada critério na chave "Ordenar por". */
const CRITERIOS: ReadonlyArray<{ valor: StrongholdCriterio; rotulo: string }> = [
  { valor: "percentual", rotulo: "Percentual" },
  { valor: "votos", rotulo: "Votos" },
];

interface CandidateTableProps {
  cand: EdgeCandidate;
  rank: number;
  lista: StrongholdRow[];
  totalUfsComDado: number;
  id: string;
  criterio: StrongholdCriterio;
  /**
   * Quantas UFs o candidato tem no critério ativo, ANTES do corte em `topUfs`.
   * O caption conta estas — contar as linhas exibidas dizia "10 de 27" para
   * quem tem 27, como se só 10 tivessem dado.
   */
  naLista: number;
  /**
   * Só no modo Votos: quantas UFs do candidato saíram da lista por não terem
   * `votos_disputa_projetados`. Declarado na legenda — o denominador real.
   */
  semVotos: number;
}

function CandidateTable({
  cand,
  rank,
  lista,
  totalUfsComDado,
  id,
  criterio,
  naLista,
  semVotos,
}: CandidateTableProps) {
  const porVotos = criterio === "votos";
  const cor = candidateColor(cand.partido, rank);
  const captionId = `${id}-caption`;

  return (
    <table
      id={id}
      data-testid="stronghold-column"
      data-candidato={cand.id}
      className="w-full border-collapse text-left"
      aria-describedby={captionId}
    >
      <caption
        id={captionId}
        className="text-left"
        style={{ paddingBottom: "var(--space-2)", captionSide: "top" }}
      >
        <span className="flex flex-wrap items-baseline" style={{ gap: "var(--space-2)" }}>
          <span style={{ font: "var(--type-title)", fontSize: "var(--text-lg)" }}>
            {nomeExibicao(cand.nome, cand.sqcand)}
          </span>
          <PartyTag sigla={cand.partido} size="sm" color={cor} />
        </span>
        <span
          className="block"
          style={{
            font: "var(--type-data)",
            color: "var(--text-secondary)",
            marginTop: "var(--space-1)",
          }}
        >
          {naLista} de {totalUfsComDado} UFs com{" "}
          {porVotos ? "votos projetados" : "percentual publicado"} para este candidato
          {porVotos && semVotos > 0
            ? ` · ${semVotos} ${semVotos === 1 ? "UF" : "UFs"} sem total de votos projetado fora da lista`
            : null}
        </span>
        {/* RF-295 — o critério ativo vive DENTRO do caption: é o que o leitor
            de tela relê quando a chave troca a ordem da tabela. */}
        <span
          data-testid="stronghold-criterio"
          className="block"
          style={{ font: "var(--type-data)", color: "var(--text-secondary)" }}
        >
          {porVotos
            ? "Ordenado pela diferença em votos projetados"
            : "Ordenado pelo percentual projetado"}
        </span>
      </caption>
      <thead>
        <tr>
          <th scope="col" style={HEAD_CELL}>
            UF
          </th>
          <th scope="col" style={HEAD_CELL}>
            Posição
          </th>
          <th scope="col" style={{ ...HEAD_CELL, textAlign: "right" }}>
            {porVotos ? "Diferença em votos" : "Diferença"}
          </th>
          <th scope="col" style={{ ...HEAD_CELL, textAlign: "right" }}>
            Projetado
          </th>
        </tr>
      </thead>
      <tbody>
        {lista.length === 0 ? (
          <tr>
            <td colSpan={4} style={{ ...CELL, font: "var(--type-body-sm)" }}>
              {porVotos
                ? "Nenhuma UF publicou total de votos projetado para este candidato ainda."
                : "Nenhuma UF publicou percentual para este candidato ainda."}
            </td>
          </tr>
        ) : (
          lista.map((l) => (
            <tr key={l.sigla} data-uf={l.sigla}>
              <th scope="row" style={{ ...CELL, font: "var(--type-figure-sm)", fontWeight: 500 }}>
                {rotuloDaUnidade(l.sigla)}
              </th>
              <td style={{ ...CELL, font: "var(--type-body-sm)" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {l.posicao}º · {l.posicao === 1 ? "à frente de" : "atrás de"} {l.contraNome}
                </span>
                <span
                  aria-hidden="true"
                  className="mt-1 block overflow-hidden"
                  style={{
                    height: 6,
                    borderRadius: "var(--radius-xs)",
                    background: "var(--surface-sunken)",
                    border: DATA_FILL_STROKE,
                  }}
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, l.pct))}%`,
                      background: candidateColorByMargin(cand.partido, rank, l.diff),
                    }}
                  />
                </span>
              </td>
              {/* 🔴 04/10 (dono): as duas colunas numéricas são PROJEÇÃO
                  (margem projetada local e % projetado) ⇒ cor da projeção. */}
              <td style={{ ...CELL, ...NUMERO_PROJETADO }}>
                {porVotos && l.diffVotos !== null
                  ? formatVotosDiferenca(l.diffVotos)
                  : formatPp(l.diff)}
              </td>
              <td style={{ ...CELL, ...NUMERO_PROJETADO }}>{formatPercent(l.pct, 1)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export function StrongholdsPanel({
  candidatos,
  rows,
  topCandidatos = 5,
  topUfs = 10,
  className,
}: StrongholdsPanelProps) {
  const baseId = useId();
  const tabelaId = `${baseId}-tabela`;
  const candidatosById = new Map(candidatos.map((c) => [c.id, c]));
  // ADR-0053 — a anulada não disputa, então não tem "reduto" a mostrar: sem
  // o filtro ela ocuparia uma pílula (o `rank` do payload a conta) e a tabela
  // dela sairia vazia, porque `strongholdsFor` a ignora.
  const pilulas = queCompetem(candidatos).slice(0, topCandidatos);

  // A seleção guarda o ID, não o índice: se o payload reordenar entre dois
  // ciclos de 60s, o índice apontaria para outro candidato em silêncio.
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const selecionado = pilulas.find((c) => c.id === selecionadoId) ?? pilulas[0];
  // RF-295 — estado próprio, separado da pílula: trocar de candidato mantém o
  // critério. Padrão = Percentual, o comportamento anterior à chave.
  const [criterio, setCriterio] = useState<StrongholdCriterio>("percentual");

  const listaCompleta = selecionado
    ? strongholdsFor(selecionado.id, rows, candidatosById, criterio)
    : [];
  // Quantas UFs do candidato o modo Votos deixou de fora (sem total
  // projetado). No modo Percentual não há descarte e o número não é usado.
  const semVotos =
    selecionado && criterio === "votos"
      ? strongholdsFor(selecionado.id, rows, candidatosById).length - listaCompleta.length
      : 0;

  const totalUfsComDado = rows.filter((r) => (r.top_candidatos ?? []).length > 0).length;
  const rotulos = chipLabels(pilulas);

  return (
    <Panel
      kicker="Por unidade federativa"
      title="Onde cada candidato é mais forte"
      titleId="strongholds-panel-heading"
      className={className}
    >
      {pilulas.length > 0 ? (
        <fieldset data-testid="strongholds-chips" className={styles.chips}>
          <legend className="sr-only">Escolher candidato</legend>
          {pilulas.map((c, i) => {
            const ativo = c.id === selecionado?.id;
            const { background, ink } = chipFillFor(c.partido);
            return (
              <button
                key={c.id}
                type="button"
                data-testid="stronghold-chip"
                data-candidato={c.id}
                data-ativo={ativo ? "true" : "false"}
                aria-pressed={ativo}
                aria-controls={tabelaId}
                className={[styles.chip, ativo ? styles.chipOn : null].filter(Boolean).join(" ")}
                // Inline só o par que depende da sigla; o resto é o módulo CSS.
                // Estilo inline vence seletor, então o `:hover` do módulo não
                // alcança (nem deve alcançar) o fundo medido da selecionada.
                style={ativo ? { background, color: ink } : undefined}
                onClick={() => setSelecionadoId(c.id)}
              >
                {rotulos[i]}
                {/* Nome completo e sigla para leitor de tela — a pílula
                    visível é curta por desenho, mas quem ouve não deve ter de
                    adivinhar de quem é.

                    🔴 Aqui, e SÓ aqui, fica o nome CRU do TSE, e é de propósito:
                    este canal existe para EXPANDIR um rótulo cortado, não para
                    repeti-lo. O nome acessível do botão sai "CAIADO — RONALDO
                    CAIADO, PSD" — contém o texto visível, como a WCAG 2.5.3
                    exige, e ainda diz de quem se trata. Trocar por
                    `nomeExibicao` aqui devolveria "CAIADO — CAIADO, PSD" e
                    gastaria o único lugar da tela que não tem limite de
                    largura. */}
                <span className="sr-only">
                  {" — "}
                  {c.nome}
                  {c.partido ? `, ${c.partido}` : ", sem partido"}
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}

      {selecionado ? (
        <fieldset data-testid="strongholds-criterio" className={styles.ordem}>
          {/* A `<legend>` nomeia o grupo para o leitor de tela; o rótulo
              VISÍVEL é um `<span aria-hidden>` na fileira dos botões. Uma
              legend flutuada (`float: left`) entra na fileira no Chromium, mas
              o WebKit 26 ignora o float e a empilha acima do trilho (medido em
              03/10 no Playwright, iPhone 14 e Safari desktop). */}
          <legend className="sr-only">Ordenar por</legend>
          <span aria-hidden="true" className={styles.ordemLegenda}>
            Ordenar por
          </span>
          <span className={styles.segmentos}>
            {CRITERIOS.map(({ valor, rotulo }) => {
              const ativo = valor === criterio;
              return (
                <button
                  key={valor}
                  type="button"
                  data-testid="stronghold-criterio-botao"
                  data-criterio={valor}
                  aria-pressed={ativo}
                  aria-controls={tabelaId}
                  className={[styles.segmento, ativo ? styles.segmentoOn : null]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setCriterio(valor)}
                >
                  {rotulo}
                </button>
              );
            })}
          </span>
        </fieldset>
      ) : null}

      {selecionado ? (
        <CandidateTable
          id={tabelaId}
          cand={selecionado}
          rank={selecionado.rank ?? pilulas.indexOf(selecionado) + 1}
          lista={listaCompleta.slice(0, topUfs)}
          totalUfsComDado={totalUfsComDado}
          criterio={criterio}
          naLista={listaCompleta.length}
          semVotos={semVotos}
        />
      ) : (
        <p style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
          Aguardando a lista de candidatos do TSE.
        </p>
      )}

      <p
        data-testid="strongholds-nota"
        style={{
          margin: "var(--space-4) 0 0",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        As {topUfs} UFs em que o candidato escolhido acima é mais forte. A diferença é a margem
        projetada local — para quem está em 1º, a distância até o 2º; abaixo disso, a distância até
        o 1º —, em pontos percentuais em “Percentual” e, em “Votos”, convertida em votos pelo total
        projetado de votos em disputa da UF (UF sem esse total fica fora). Só entram UFs em que o
        candidato esteja entre os {STRONGHOLD_POSICAO_MAX} primeiros colocados. Projeção não
        oficial; o resultado é do TSE.
      </p>
    </Panel>
  );
}
