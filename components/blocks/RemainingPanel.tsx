/**
 * components/blocks/RemainingPanel.tsx
 *
 * "O que ainda falta apurar" — quanto resta, onde resta, e onde isso ainda
 * pode mudar o resultado local. Design system Atlas Menna (ADR-0025, Bloco 1),
 * portado do `RemainingPanel` de
 * `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:96`.
 *
 * Cobertura: RF-026 (estado da apuração) e RF-024 (onde a corrida ainda pode
 * virar), pelo eixo "pendência" em vez do eixo "decisividade" do
 * `<DecisiveUFsGrid />` — ali a pergunta é "onde poucos pontos viram a
 * chamada agora"; aqui é "quanto ainda não foi contado, e em quais UFs o
 * resultado segue em aberto".
 *
 * ===== Como "em aberto" é definido =====
 * Uma UF entra em "em aberto" quando o próprio payload já diz que a corrida
 * local não está resolvida:
 *   - `bucket === "indefinido"` (o orchestrator não chamou a UF), OU
 *   - o IC95 da margem projetada cruza o zero
 *     (`margem_projetada_ci[0] <= 0 <= margem_projetada_ci[1]`), isto é, a
 *     projeção ainda não exclui a inversão do líder local.
 * Nenhum limiar novo é inventado neste arquivo — os dois sinais já existem no
 * contrato (`lib/edge-config/types.ts`).
 *
 * ===== Limite conhecido do payload =====
 * A ordenação é por **percentual de seções ainda não apuradas na UF**
 * (`100 − pct_apurado`), não por votos absolutos pendentes. `EdgeUfRow` não
 * carrega eleitorado nem total de votos da UF — só percentuais —, então não
 * há como ponderar "quanto falta" pelo tamanho do estado sem inventar o
 * denominador. Consequência prática: uma UF pequena com 90% por apurar sobe
 * acima de SP com 40% por apurar, mesmo valendo menos votos. A nota de rodapé
 * declara isso; a coluna nacional de cima (`pct_apurado_total`) continua sendo
 * a medida ponderada correta, porque essa vem agregada do TSE.
 *
 * Server Component puro — sem estado, sem hooks, zero JS novo (RNF-007a).
 *
 * A11y (RNF-023): `<table>` de verdade com `<caption>`; a coluna "Situação"
 * carrega o estado em texto, então a cor da barra nunca é o único portador de
 * significado (WCAG 1.4.1).
 */

import { Figure } from "@/components/atoms/data/Figure";
import { rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import { Panel } from "@/components/atoms/surfaces/Panel";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import { candidateColorByMargin, DATA_FILL_STROKE } from "./_candidateColor";

export interface RemainingPanelProps {
  rows: EdgeUfRow[];
  /** `EdgeNational.candidatos` — resolve nome/partido do líder local. */
  candidatos: EdgeCandidate[];
  /** `EdgePayload.pct_apurado_total` (0–100). */
  pctApuradoTotal: number;
  /** `EdgePayload.ufs_apuradas`. */
  ufsApuradas: number;
  totalUfs?: number;
  /** Quantas UFs listar. Default 6. */
  top?: number;
  className?: string;
}

/** Percentual de seções ainda não apuradas na UF, clampeado em [0, 100]. */
export function faltaApurar(row: EdgeUfRow): number {
  const pct = Number.isFinite(row.pct_apurado) ? row.pct_apurado : 0;
  return Math.max(0, Math.min(100, 100 - pct));
}

/**
 * A corrida local ainda não está resolvida? Ver o cabeçalho do arquivo para a
 * definição. Exportada para o teste fixar a regra sem passar pelo DOM.
 */
export function resultadoEmAberto(row: EdgeUfRow): boolean {
  if (row.bucket === "indefinido") return true;
  const ci = row.margem_projetada_ci;
  if (!ci || ci.length < 2) return false;
  const [lower, upper] = ci;
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return false;
  return lower <= 0 && upper >= 0;
}

/** "SP", "SP e MG", "SP, MG e RS" — pt-BR, determinístico. */
export function listarSiglas(siglas: string[]): string {
  if (siglas.length === 0) return "";
  if (siglas.length === 1) return siglas[0] as string;
  return `${siglas.slice(0, -1).join(", ")} e ${siglas[siglas.length - 1]}`;
}

const CELL: React.CSSProperties = {
  padding: "var(--space-2) 0",
  borderTop: "1px solid var(--border-hairline)",
};

const HEAD_CELL: React.CSSProperties = {
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  paddingBottom: "var(--space-2)",
  fontWeight: 600,
};

export function RemainingPanel({
  rows,
  candidatos,
  pctApuradoTotal,
  ufsApuradas,
  totalUfs = 27,
  top = 6,
  className,
}: RemainingPanelProps) {
  const candidatosById = new Map(candidatos.map((c) => [c.id, c]));

  // Determinístico (constituição § 6): tie-breaker por sigla.
  const pendentes = rows
    .filter((r) => faltaApurar(r) > 0)
    .sort((a, b) => faltaApurar(b) - faltaApurar(a) || a.sigla.localeCompare(b.sigla, "pt-BR"))
    .slice(0, top);

  const emAberto = rows
    .filter((r) => faltaApurar(r) > 0 && resultadoEmAberto(r))
    .map((r) => r.sigla)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    // ADR-0045 — o exterior (`ZZ`) entra na frase como "Exterior".
    .map(rotuloDaUnidade);

  const faltaNacional = Math.max(0, Math.min(100, 100 - pctApuradoTotal));
  const semBoletim = Math.max(0, totalUfs - ufsApuradas);

  return (
    <Panel
      kicker="Onde a apuração está atrasada"
      title="O que ainda falta apurar"
      titleId="remaining-panel-heading"
      className={className}
    >
      <div
        className="grid grid-cols-2 md:grid-cols-3"
        style={{ gap: "var(--space-6)", marginBottom: "var(--space-6)" }}
      >
        <Figure
          label="Falta apurar"
          value={formatPercent(faltaNacional, 1)}
          size="md"
          note="Seções em todo o país"
        />
        <Figure
          label="UFs sem boletim"
          value={`${semBoletim}/${totalUfs}`}
          size="md"
          note="Nenhuma zona apurada ainda"
        />
        <Figure
          label="Resultado em aberto"
          value={`${emAberto.length}`}
          size="md"
          note="UFs com apuração pendente"
        />
      </div>

      <table data-testid="remaining-table" className="w-full border-collapse text-left">
        <caption className="sr-only">
          Unidades federativas com mais seções por apurar, com o líder projetado local e a situação
          da corrida em cada uma.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={HEAD_CELL}>
              UF
            </th>
            <th scope="col" style={HEAD_CELL}>
              Líder projetado
            </th>
            <th scope="col" style={HEAD_CELL}>
              Situação
            </th>
            <th scope="col" style={{ ...HEAD_CELL, textAlign: "right" }}>
              Apurado
            </th>
            <th scope="col" style={{ ...HEAD_CELL, textAlign: "right" }}>
              Falta
            </th>
          </tr>
        </thead>
        <tbody>
          {pendentes.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ ...CELL, font: "var(--type-body-sm)" }}>
                Todas as unidades federativas estão com a apuração concluída.
              </td>
            </tr>
          ) : (
            pendentes.map((row) => {
              const lider = candidatosById.get(row.lider);
              const rank = lider?.rank ?? 1;
              const aberto = resultadoEmAberto(row);
              return (
                <tr key={row.sigla} data-uf={row.sigla} data-aberto={aberto ? "true" : "false"}>
                  <th
                    scope="row"
                    style={{ ...CELL, font: "var(--type-figure-sm)", fontWeight: 500 }}
                  >
                    {rotuloDaUnidade(row.sigla)}
                  </th>
                  <td style={{ ...CELL, font: "var(--type-body-sm)" }}>
                    <span>
                      {/* Desenhado ⇒ abreviado (2026-09-19). Coluna do meio de
                          uma tabela de 3 colunas dentro do painel lateral. */}
                      {lider
                        ? `${nomeExibicao(lider.nome, lider.sqcand)} (${siglaExibicao(lider.partido)})`
                        : "—"}
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
                          width: `${faltaApurar(row)}%`,
                          background: candidateColorByMargin(
                            lider?.partido,
                            rank,
                            row.margem_projetada,
                          ),
                        }}
                      />
                    </span>
                  </td>
                  <td
                    style={{
                      ...CELL,
                      font: "var(--type-body-sm)",
                      color: aberto ? "var(--accent-text)" : "var(--text-secondary)",
                    }}
                  >
                    {aberto ? "Em aberto" : "Líder definido na projeção"}
                  </td>
                  <td style={{ ...CELL, font: "var(--type-figure-sm)", textAlign: "right" }}>
                    {formatPercent(row.pct_apurado, 0)}
                  </td>
                  <td style={{ ...CELL, font: "var(--type-figure-sm)", textAlign: "right" }}>
                    {formatPercent(faltaApurar(row), 0)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <p
        data-testid="remaining-aberto"
        style={{
          margin: "var(--space-4) 0 0",
          font: "var(--type-body-sm)",
        }}
      >
        {emAberto.length === 0
          ? "Nenhuma unidade federativa combina apuração pendente com resultado local ainda em aberto."
          : `Com apuração pendente e resultado local ainda em aberto: ${listarSiglas(emAberto)}.`}
      </p>

      <p
        data-testid="remaining-nota"
        style={{
          margin: "var(--space-2) 0 0",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        A ordem é pelo percentual de seções ainda não apuradas em cada UF — o payload não publica
        eleitorado nem total de votos por UF, então não há como ponderar a lista pelo tamanho do
        estado. &quot;Em aberto&quot; é a UF que o modelo ainda não chamou ou cujo intervalo de 95%
        da margem projetada inclui o zero. Projeção não oficial; o resultado é do TSE.
      </p>
    </Panel>
  );
}
