/**
 * components/atoms/bars/CandidateBar.tsx
 *
 * Barra horizontal proporcional para um candidato — exibe nome, partido,
 * %, votos e CI95 ao lado/abaixo da barra. Usada por `<HeadlineScore />`
 * (RF-022, RF-023), único caller no repositório.
 *
 * ⚠️ O docblock afirmou até 2026-09-20 que `<DecisiveUFsGrid />` também a
 * usava. Não usa, e nunca usou: aquele bloco desenha a própria mini-barra com
 * `candidateColor` e não importa este átomo.
 *
 * Server Component puro — sem state, sem hooks, sem 'use client'.
 *
 * ## 🔴 DUAS tintas, não uma (2026-09-20)
 *
 * Este átomo pinta duas superfícies de natureza oposta com a identidade do
 * partido, e elas NÃO podem sair da mesma variável:
 *
 * | superfície | piso | o que usa |
 * |---|---|---|
 * | o número `text-3xl` | 4,5:1 — TEXTO (RNF-022 / const. § 4) | `--color-pct-votos` (desde 2026-10-03; era `textForParty`) |
 * | o preenchimento da barra | 3:1 — não-texto com extensão (RNF-035) | `colorForParty` |
 *
 * Até esta data as duas saíam de `corResolvida`, a cor-base. Medido contra
 * `--surface-page` (`#f3f4f6`, o fundo real — nem `<Panel>` nem nenhum outro
 * ancestral declara fundo próprio; quem decide é `body`): **PSOL 2,08:1**,
 * PSB 2,20, NOVO 2,72, federação/sem sigla 2,39 — abaixo de metade do piso
 * que o projeto adotou para si.
 *
 * 🔴 **QUANDO essa tela aparece, porque a resposta não é "sempre".** O único
 * caller é `<HeadlineScore>`, e `app/(pres)/page.tsx:685,903-948` só o
 * renderiza no ramo `mode === "binary"` e fora da fase pré — ou seja, no **2º
 * turno (25/10)**, ou num 1º turno com exatamente 2 candidaturas (ramo
 * defensivo). No 1º turno multi-candidato de 04/10 a home cai em
 * `painelDeIdentidade` e usa `<ResultPanel>`, onde este átomo não entra.
 * O defeito era real e o conserto vale; mas ele mira a tela de 25/10, não a
 * de 04/10 — e essa distinção foi corrigida depois de um relato inicial que
 * a tratava como "a porta de entrada do site hoje".
 *
 * É o MESMO erro que `eb3170e` consertou na coluna "Margem" da
 * `<MunicipioTable>` no mesmo dia, e que o componente irmão
 * `<ProjectionThermometer>` já evitava por `corTextoResolvida`. A distinção
 * está escrita desde 18/09 em `components/blocks/_candidateColor.ts`: texto
 * não tem extensão a contornar, então escurece-se a tinta; preenchimento com
 * extensão não pode escurecer sem trair a identidade, então ganha fronteira.
 *
 * A barra **não** escureceu junto: ela é preenchimento com extensão, e é ali
 * que a cor viva do partido tem de viver.
 *
 * A11y
 *   - role="meter" + aria-valuemin/max/now e aria-label descritivo.
 *   - Números em tabular-nums (CSS global).
 */

import {
  VotosProjetados,
  votosProjetadosExibiveis,
} from "@/components/atoms/data/ProjecaoIndicador";
import { formatCI, formatPercent, formatVotesCompact } from "@/lib/utils/format";
import { colorForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

export interface CandidateBarProps {
  nome: string;
  partido: string;
  /**
   * Cor token (`var(--party-<slug>)` etc). NUNCA hex partidário direto.
   * Quando ausente, derivamos de `partido` via `colorForParty` — ver a nota
   * de 2026-09-20 em {@link CandidateBar}.
   */
  cor?: string;
  /**
   * Rank semântico do candidato (1 = líder).
   *
   * 🔴 **Não escolhe mais cor desde 2026-09-20** (ver {@link CandidateBar}).
   * Continua na assinatura porque as chamadas existentes o passam; hoje não
   * influencia pixel nenhum deste componente.
   */
  rank?: number;
  /** Percentual projetado (0-100). */
  pctProjetado: number;
  /** CI95 lower (0-100). */
  pctLower?: number;
  /** CI95 upper (0-100). */
  pctUpper?: number;
  /** Votos projetados. */
  votos?: number;
  /** Largura "máxima" semântica: o percentual 100% equivale a essa largura. */
  alignRight?: boolean;
  className?: string;
}

export function CandidateBar({
  nome,
  partido,
  cor,
  rank: _rank,
  pctProjetado,
  pctLower,
  pctUpper,
  votos,
  alignRight = false,
  className,
}: CandidateBarProps) {
  // 🔴 2026-09-20 — o fallback deixa de ser a colocação e passa a ser a sigla.
  //
  // Era: `cor ?? (typeof rank === "number" ? colorForRank(rank) : "var(--color-cand-1)")`.
  // Os dois ramos do fallback derivavam de posição — o segundo de forma ainda
  // mais crua, cravando `--color-cand-1` (vermelho) em QUALQUER candidatura
  // sem cor nem rank. `partido` é prop OBRIGATÓRIA deste átomo, então a sigla
  // sempre esteve à mão; nada precisava ser costurado pela cadeia de props.
  //
  // Em produção o ramo não dispara (o único caller, `<HeadlineScore>`, passa
  // `cor={candidateColor(partido, rank)}`), e é exatamente por isso que ele
  // sobreviveu doze dias ao ADR-0024: um fallback que ninguém vê é um fallback
  // que ninguém corrige. Ele dispara em fixture antiga e em teste — e o dia em
  // que um caller novo esquecer `cor` é o dia em que a home pintaria alguém
  // pela colocação de novo.
  //
  // `colorForParty` (e não `candidateColor`) porque este é um ÁTOMO:
  // `components/atoms/` não importa de `components/blocks/` — a mesma regra
  // que `ChoroplethMapUF.tsx` declara. As duas funções devolvem o mesmo token;
  // `candidateColor` é a fachada de `blocks/`.
  const corResolvida: string = cor ?? colorForParty(partido);
  // 🔴 A tinta do NÚMERO não passa por `cor` nem por `corResolvida`, de
  // propósito — é isso que impede um caller de derrubar o contraste do maior
  // número da home só por passar a cor de preenchimento, que é exatamente
  // como o defeito viveu até 2026-09-20 (`<HeadlineScore>` passa
  // `cor={candidateColor(...)}`). Ver a tabela das duas tintas no topo.
  //
  // 🔴 2026-10-03 — decisão do dono: o percentual de votos sai na cor ÚNICA
  // `--color-pct-votos` (neutra, constituição § 2), não mais na cor de texto
  // do partido (`textForParty`, até esta data). A cor do partido fica na barra.
  const corTextoResolvida = "var(--color-pct-votos)";
  // 🔴 2026-10-03 — decisão do dono: votos PROJETADOS saem abreviados, com "≈"
  // e na cor da projeção (`<VotosProjetados>`), como no resto do site. Antes
  // eram o número cheio ("79.812.408 votos"), sem dizer que era projeção —
  // precisão que o modelo não tem. Zero/ausente ⇒ não sabemos ⇒ sem linha.
  const votosProj = votosProjetadosExibiveis(votos);
  const pctSafe = Number.isFinite(pctProjetado) ? Math.max(0, Math.min(100, pctProjetado)) : 0;
  const ariaLabel = `${nome} (${partido}): ${formatPercent(pctSafe)} projetado${
    typeof pctLower === "number" && typeof pctUpper === "number"
      ? ` — intervalo ${formatCI(pctLower, pctUpper)}`
      : ""
  }${votosProj !== null ? `, aproximadamente ${formatVotesCompact(votosProj)} votos projetados` : ""}`;

  const containerClass = ["flex flex-col gap-2", className].filter(Boolean).join(" ");
  const headerClass = alignRight
    ? "flex items-baseline justify-between flex-row-reverse"
    : "flex items-baseline justify-between";
  const numberClass = alignRight ? "text-right" : "text-left";

  return (
    <div className={containerClass}>
      <div className={headerClass}>
        <div className={alignRight ? "text-right" : "text-left"}>
          <div className="text-lg font-medium" style={{ fontFamily: "var(--font-serif)" }}>
            {nome}{" "}
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {/* Desenhado ⇒ abreviado (2026-09-19); o `ariaLabel` acima segue
                  com a sigla inteira. */}
              ({siglaExibicao(partido)})
            </span>
          </div>
        </div>
        <div className={numberClass}>
          <div
            className="font-serif text-3xl font-semibold tabular-nums leading-none"
            style={{ color: corTextoResolvida }}
          >
            {formatPercent(pctSafe, 1)}
          </div>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: meter nativo não estiliza o suficiente. */}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pctSafe)}
        aria-label={ariaLabel}
        className="relative h-3 w-full overflow-hidden rounded-sm border"
        style={{
          backgroundColor: "var(--color-bg-muted)",
          borderColor: "var(--color-border)",
        }}
      >
        <div
          className="h-full"
          style={{
            width: `${pctSafe}%`,
            backgroundColor: corResolvida,
            marginLeft: alignRight ? "auto" : 0,
          }}
        />
      </div>
      {(votosProj !== null || (typeof pctLower === "number" && typeof pctUpper === "number")) && (
        <div
          className={`flex flex-wrap items-baseline gap-x-3 text-xs ${
            alignRight ? "justify-end" : ""
          }`}
          style={{ color: "var(--color-text-muted)" }}
        >
          {votosProj !== null && (
            // `dentroDaProjecao`: o placar só mostra projeção, nas duas
            // visões — sem `data-view-only`, a linha não some na Parcial.
            <VotosProjetados dentroDaProjecao votos={votosProj} />
          )}
          {typeof pctLower === "number" && typeof pctUpper === "number" && (
            <span className="tabular-nums">CI95: {formatCI(pctLower, pctUpper)}</span>
          )}
        </div>
      )}
    </div>
  );
}
