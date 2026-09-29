/**
 * components/blocks/RenovacaoPanel.tsx — V4, "Renovação" das vagas do Senado
 * em `/senador` (spec 025, RF-249).
 *
 * Só nas UFs com a apuração CONCLUÍDA (`pct_apurado` ≥ 100, a régua de
 * "decidida" da spec 023): o que ainda é projeção não "mudou de mãos".
 *
 *   - Número principal: vagas que foram para quem NÃO ocupava a cadeira — a
 *     PESSOA mudou (decisão do dono, 29/09). Eleito com trajetória "tenta a
 *     reeleição" mantém a cadeira; "volta ao cargo" e "estreante no cargo",
 *     não.
 *   - Número secundário: vagas em que o PARTIDO mudou, contra a foto dos 54
 *     de hoje (`editorial/senado/mandato-2027.json`).
 *   - A lista de quem tentava a reeleição e ficou sem vaga.
 *
 * 🔴 Nunca "eleito" solto (constituição § 1; ADR-0055): a base é dita — "com
 * a apuração concluída no estado".
 *
 * Governador fica de fora por ora: não há trajetória de governador nos dados
 * (só por linha individual, e `governador.csv` está vazio) — registrado no
 * `tasks.md` da spec 025.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import type { EdgePayload } from "@/lib/edge-config/types";
import { rotuloDoValor } from "@/lib/etiquetas/catalogo";
import type { Etiquetas } from "@/lib/etiquetas/leitor";
import { visaoRenovacaoSenado } from "@/lib/etiquetas/visoes";
import type { ValidacaoFotoSenado } from "@/lib/senado/mandato-2031";

export const LOG_TAG_RENOVACAO = "[etiquetas-renovacao]";

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export interface RenovacaoPanelProps {
  payload: EdgePayload | null;
  mandato2027: ValidacaoFotoSenado;
  etiquetas: Etiquetas;
}

export function RenovacaoPanel({ payload, mandato2027, etiquetas }: RenovacaoPanelProps) {
  const r = visaoRenovacaoSenado(payload, mandato2027, etiquetas);
  if (!r.ok) {
    if (r.motivo === "portao") {
      console.warn(
        `${LOG_TAG_RENOVACAO} escondida pelo portão: ${r.bloqueantes.length} sem classificação`,
      );
    }
    return null;
  }
  const v = r.visao;
  const semNome = v.ufs.flatMap((u) => u.derrotados.filter((d) => d.nome === null)).length;
  const comNome = v.ufs.flatMap((u) =>
    u.derrotados.filter((d) => d.nome !== null).map((d) => ({ ...d, uf: u.uf })),
  );

  return (
    <Panel
      kicker="Senado · classificação editorial · não oficial"
      title="Renovação: quem fica com as vagas"
      titleId="renovacao-heading"
    >
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <p
          data-testid="renovacao-resumo"
          className="max-w-prose"
          style={{ margin: 0, font: "var(--type-body)", color: "var(--text-primary)" }}
        >
          Nos {plural(v.ufs.length, "estado", "estados")} com a apuração concluída,{" "}
          <strong>
            {v.mudaramDeMaos} de {v.vagas} vagas
          </strong>{" "}
          vão para quem não ocupava a cadeira.
          {v.trocaDePartido !== null
            ? ` Em ${plural(v.trocaDePartido, "vaga", "vagas")}, o partido também muda.`
            : ""}
        </p>
        <ul
          data-testid="renovacao-ufs"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            font: "var(--type-body-sm)",
            color: "var(--text-secondary)",
          }}
        >
          {v.ufs.map((u) => (
            <li key={u.uf} data-uf={u.uf}>
              <strong style={{ color: "var(--text-primary)" }}>{u.uf}</strong>:{" "}
              {u.eleitos
                .map(
                  (e) =>
                    `${e.nome}${e.partido ? ` (${e.partido})` : ""}, ${(
                      rotuloDoValor("trajetoria_cargo", e.trajetoria) ?? ""
                    ).toLocaleLowerCase("pt-BR")}`,
                )
                .join("; ")}
              {" — "}
              {plural(u.mudaramDeMaos, "vaga mudou", "vagas mudaram")} de mãos
              {u.trocaDePartido !== null
                ? `; ${plural(u.trocaDePartido, "mudou", "mudaram")} de partido`
                : ""}
              .
            </li>
          ))}
        </ul>
        {v.derrotados > 0 ? (
          <div data-testid="renovacao-derrotados">
            <h3 style={{ margin: 0, font: "var(--type-title)", fontSize: "var(--text-md)" }}>
              Tentavam a reeleição e ficaram sem vaga
            </h3>
            <ul
              style={{
                margin: "var(--space-1) 0 0",
                paddingLeft: "var(--space-4)",
                font: "var(--type-body-sm)",
                color: "var(--text-secondary)",
              }}
            >
              {comNome.map((d) => (
                <li key={d.sqcand}>
                  {d.nome}
                  {d.partido ? ` (${d.partido})` : ""} — {d.uf}
                </li>
              ))}
              {semNome > 0 ? (
                <li>
                  e mais {semNome} fora dos quatro mais votados de cada estado, que o resumo da
                  apuração não publica pelo nome
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        <EtiquetasAviso />
      </div>
    </Panel>
  );
}
