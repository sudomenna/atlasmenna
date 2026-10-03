/**
 * components/blocks/DeputadoPuxadores.tsx — spec 026 (RF-273), design 026 § 3.5.
 *
 * **Puxador** é o candidato com votos para mais de uma cadeira: a partir de
 * duas vezes o quociente eleitoral (QE) do estado dele (spec 026, open
 * question 1). O que passa da primeira cadeira é o **excedente**
 * (`⌊votos / QE⌋ − 1` quocientes) — soma para a agremiação, ajuda a eleger os
 * colegas de lista, e **não elege nome nenhum por si**. A frase diz isso em
 * toda superfície, porque "puxador" sem ela vira "o candidato elegeu X" — que
 * é falso.
 *
 * Dois usos:
 *   - `<DeputadoPuxadores>` — o painel da capa, até 30, do payload nacional
 *     (a capa nunca lê Blob, RF-271/RF-273). Ordem do produtor
 *     (`(−excedente, −votos, uf, sqcand)`).
 *   - `<LinhaPuxadores>` — a linha dentro da agremiação, na página da UF.
 *
 * Os números vêm do payload (`quocientes`, `excedente`, `quociente_eleitoral`);
 * nada é recalculado aqui. Server Components, zero JS.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import type {
  DeputadoPuxador as DeputadoPuxadorAgremiacao,
  EdgeDeputadoPuxador,
} from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import { rotuloCargo } from "@/lib/utils/casa-legislativa";
import { formatVotes } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import { siglaNaFrase } from "@/lib/utils/termo-territorio";

import styles from "./DeputadoListaAgremiacao.module.css";

function quocientesTexto(n: number): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? "quociente eleitoral" : "quocientes eleitorais"}`;
}

/**
 * "fez 3 quocientes de SP sozinho; os 2 de excedente somam para a agremiação e não elegem nome nenhum."
 *
 * `comArtigo` (spec 027): nas assembleias o DF leva artigo — "do DF". O
 * federal chama sem ele e guarda o texto de sempre.
 */
export function frasePuxador(
  p: { quocientes: number; excedente: number },
  uf: string,
  comArtigo = false,
): string {
  const exc =
    p.excedente === 1
      ? "o 1 de excedente soma"
      : `os ${p.excedente.toLocaleString("pt-BR")} de excedente somam`;
  return `fez ${quocientesTexto(p.quocientes)} ${siglaNaFrase(uf, comArtigo).de} sozinho; ${exc} para a agremiação e não elege${p.excedente === 1 ? "" : "m"} nome nenhum`;
}

export interface DeputadoPuxadoresProps {
  /**
   * O cargo da capa (6 · 7 · 8) — dá o rótulo do kicker (spec 027).
   * Obrigatório, sem default: um default de federal rotularia os puxadores das
   * assembleias como "Deputado Federal · Brasil".
   */
  cargo: CargoProporcional;
  /** Spec 027 — o rótulo do kicker por cima do do cargo (a capa das 27 casas). */
  rotulo?: string;
  /** Ausente (payload anterior à spec 026) ⇒ o painel não aparece. `[]` ⇒ aparece e diz "nenhum ainda". */
  puxadores: readonly EdgeDeputadoPuxador[] | undefined;
  titleId: string;
}

/** O painel da capa: os maiores excedentes do país. */
export function DeputadoPuxadores({ cargo, rotulo, puxadores, titleId }: DeputadoPuxadoresProps) {
  if (!puxadores) return null;
  // No DF a casa não é de um estado: "o quociente do estado" viraria falso
  // para o distrital (spec 027, RF-284).
  const doLugar = cargo === 6 ? "do estado" : "do estado (ou do Distrito Federal)";
  const doSeuLugar = cargo === 6 ? "do seu estado" : "do seu estado (ou do Distrito Federal)";
  const comArtigo = cargo !== 6;
  return (
    <Panel
      kicker={`${rotulo ?? rotuloCargo(cargo)} · Brasil`}
      title="Puxadores de voto"
      titleId={titleId}
    >
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <p className={styles.legendaColunas}>
          Candidatos com votos para mais de uma cadeira: pelo menos duas vezes o quociente eleitoral{" "}
          {doLugar}. O excedente soma para a agremiação e ajuda a eleger colegas de lista — não
          elege nome nenhum por si.
        </p>
        {puxadores.length === 0 ? (
          <p className={styles.legendaColunas} data-testid="dep-puxadores-vazio">
            Nenhum candidato chegou a duas vezes o quociente eleitoral {doSeuLugar} com os votos
            apurados até agora.
          </p>
        ) : (
          <ol className={styles.lista} data-testid="dep-puxadores-pais">
            {puxadores.map((p, i) => {
              const partido = siglaExibicao(p.partido);
              const agremiacao = siglaExibicao(p.sigla);
              return (
                <li key={`${p.uf}:${p.sqcand}`} data-rank={i + 1} data-uf={p.uf}>
                  <span>{i + 1}º</span>
                  <span>
                    <b>{nomeExibicao(p.nome, String(p.sqcand))}</b>
                    <small>
                      {agremiacao === partido ? agremiacao : `${partido} · ${agremiacao}`} · {p.uf}
                    </small>
                    <small>
                      {frasePuxador(p, p.uf, comArtigo)} (quociente{" "}
                      {siglaNaFrase(p.uf, comArtigo).de}: {formatVotes(p.quociente_eleitoral)}{" "}
                      votos).
                    </small>
                  </span>
                  <span>
                    {formatVotes(p.votos)}
                    <small>
                      +{p.excedente.toLocaleString("pt-BR")}{" "}
                      <span className="sr-only">quociente(s) de </span>excedente
                    </small>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Panel>
  );
}

export interface LinhaPuxadoresProps {
  uf: string;
  /** Spec 027 — "do DF" nas assembleias. Ausente ⇒ o texto do federal ("de DF"). */
  comArtigo?: boolean;
  puxadores: readonly DeputadoPuxadorAgremiacao[] | undefined;
  /** `sqcand` → nome de exibição, montado pelo chamador a partir das linhas da agremiação. */
  nomePorSqcand: ReadonlyMap<number, string>;
}

/** A linha "Puxador: …" dentro de uma agremiação, na página da UF. */
export function LinhaPuxadores({
  uf,
  comArtigo = false,
  puxadores,
  nomePorSqcand,
}: LinhaPuxadoresProps) {
  if (!puxadores || puxadores.length === 0) return null;
  return (
    <ul
      data-testid="dep-puxadores-agremiacao"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: "var(--space-1)",
        font: "var(--type-body-sm)",
        fontSize: "var(--text-xs)",
        color: "var(--text-secondary)",
      }}
    >
      {puxadores.map((p) => (
        <li key={p.sqcand}>
          <strong>Puxador:</strong> {nomePorSqcand.get(p.sqcand) ?? "candidato desta agremiação"}{" "}
          {frasePuxador(p, uf, comArtigo)}.
        </li>
      ))}
    </ul>
  );
}
