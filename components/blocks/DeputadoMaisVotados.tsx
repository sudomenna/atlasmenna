/**
 * components/blocks/DeputadoMaisVotados.tsx — spec 026 (RF-270, RF-271),
 * design 026 § 3.2–3.3 e § 8.4.
 *
 * Os 10 candidatos a deputado com mais votos apurados — de uma UF
 * (`escopo="uf"`, página do estado) ou do país (`escopo="pais"`, capa).
 *
 * - **O cargo é prop obrigatória** (spec 027): o kicker diz "Deputado Federal",
 *   "Deputado Estadual" ou "Deputado Distrital" pelo `cargo` recebido. Sem
 *   default, de propósito — um default de federal poria "Deputado Federal ·
 *   SP" no topo da lista da Assembleia de São Paulo, e ninguém notaria.
 *
 * - **A ordem é a do produtor** (`(−votos, sqcand)` na UF, `(−votos, uf,
 *   sqcand)` no país) — o componente não reordena (constituição § 2, § 6).
 * - **Candidato sub judice ou anulado entre os 10 aparece** (spec 026, open
 *   question 2), com o destino escrito no lugar do % e sem marca de eleito.
 * - **O % tem denominador dito**: dos válidos da UF DO CANDIDATO. No país, a
 *   linha diz de qual UF (RF-271) — somar ou comparar percentuais de UFs
 *   diferentes não teria sentido, e a frase impede a leitura errada.
 * - **A capa nunca lê Blob** (RF-271): as linhas do país vêm do payload
 *   nacional, prontas. Quem chama garante; este componente só desenha.
 *
 * Server Component, zero JS. Reaproveita o desenho de linha de
 * `<DeputadoListaAgremiacao>` (mesmo módulo de CSS) — posição, pessoa, números.
 */

import { DestinoDeputadoTexto, MarcaDeputado } from "@/components/atoms/badges/MarcaDeputado";
import { Panel } from "@/components/atoms/surfaces/Panel";
import type { EdgeDeputadoDestaque } from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import type { FotosDosEleitos } from "@/lib/deputado/fotos-eleitos";
import { rotuloCargo } from "@/lib/utils/casa-legislativa";
import { marcasDosBits } from "@/lib/utils/deputado-marcas";
import { formatPercent, formatVotes } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";
import { siglaNaFrase } from "@/lib/utils/termo-territorio";

import { AvatarEleito } from "./AvatarEleito";
import styles from "./DeputadoListaAgremiacao.module.css";

/** Uma linha do top 10: o destaque do contrato + as marcas já derivadas (bits de `deputado-marcas`). */
export interface LinhaMaisVotados extends EdgeDeputadoDestaque {
  /** `bitsDasMarcas(marcasDaLinha(...))` — só na UF. A capa não tem marca (o payload não a leva). */
  marcas?: number;
}

export interface DeputadoMaisVotadosProps {
  /** O cargo da tela (6 · 7 · 8) — dá o rótulo do kicker. Obrigatório, sem default. */
  cargo: CargoProporcional;
  /**
   * Spec 027 — o rótulo do kicker por cima do do cargo. A capa das
   * assembleias une o estadual e o distrital numa lista só, e o kicker diz
   * isso ("Deputados estaduais e distritais") em vez de chamar um distrital de
   * "Deputado Estadual".
   */
  rotulo?: string;
  escopo: "uf" | "pais";
  /** Obrigatório com `escopo="uf"`: dá nome ao painel e à base do %. */
  uf?: string;
  /** Ausente (objeto v1 ou payload antigo) ⇒ o bloco não aparece (RF-276). */
  linhas: readonly LinhaMaisVotados[] | undefined;
  /**
   * Spec 026 RF-291 — `sqcand → URL` das fotos dos eleitos (só a página de
   * UF passa). Ausente ⇒ nenhum avatar: a capa nacional fica como estava.
   */
  fotos?: FotosDosEleitos;
  titleId: string;
}

export function DeputadoMaisVotados({
  cargo,
  rotulo: rotuloDado,
  escopo,
  uf,
  linhas,
  fotos,
  titleId,
}: DeputadoMaisVotadosProps) {
  if (!linhas || linhas.length === 0) return null;
  const noPais = escopo === "pais";
  // Spec 027 — "no DF"/"do DF" nas assembleias; o federal guarda o texto de sempre.
  const comArtigo = cargo !== 6;
  const naUf = siglaNaFrase(uf ?? "", comArtigo);
  const titulo = noPais ? "Mais votados do país" : `Mais votados ${naUf.em}`;
  const rotulo = rotuloDado ?? rotuloCargo(cargo);

  return (
    <Panel
      kicker={noPais ? `${rotulo} · Brasil` : `${rotulo} · ${uf ?? ""}`}
      title={titulo}
      titleId={titleId}
    >
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <p className={styles.legendaColunas}>
          {noPais
            ? `Os 10 candidatos com mais votos apurados no país, de todas as agremiações. O percentual de cada um é sobre os votos válidos ${cargo === 6 ? "do estado dele" : "da unidade dele — o estado, ou o Distrito Federal"} — é lá que a cadeira é disputada.`
            : `Os 10 candidatos com mais votos apurados ${naUf.em}, de todas as agremiações. O percentual é sobre os votos válidos ${naUf.de}.`}
        </p>
        {/* Nome acessível = o título do painel ("Mais votados em SP"): o
            leitor que pula de lista em lista sabe qual é esta (G6, 30/09). */}
        <ol
          className={styles.lista}
          aria-labelledby={titleId}
          data-testid={noPais ? "dep-mais-votados-pais" : "dep-mais-votados-uf"}
        >
          {linhas.map((l, i) => {
            const nome = nomeExibicao(l.nome, String(l.sqcand));
            const partido = siglaExibicao(l.partido);
            const agremiacao = siglaExibicao(l.sigla);
            const quem = [
              l.numero === undefined ? null : `nº ${l.numero}`,
              agremiacao === partido ? agremiacao : `${partido} · ${agremiacao}`,
              noPais ? l.uf : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={`${l.uf}:${l.sqcand}`} data-rank={i + 1} data-uf={l.uf}>
                <span>{`${i + 1}º`}</span>
                <span>
                  <AvatarEleito
                    nome={nome}
                    sqcand={l.sqcand}
                    marcas={l.destino === undefined ? (l.marcas ?? 0) : 0}
                    fotos={fotos}
                  />
                  <b>{nome}</b>
                  <small>{quem}</small>
                  {l.destino === undefined && l.marcas
                    ? marcasDosBits(l.marcas).map((m) => <MarcaDeputado key={m.tipo} marca={m} />)
                    : null}
                </span>
                <span>
                  {formatVotes(l.votos)}
                  {l.destino !== undefined && l.destino !== "valido_legenda" ? (
                    <small>
                      <DestinoDeputadoTexto destino={l.destino} />
                    </small>
                  ) : l.destino === "valido_legenda" && l.pct_validos !== null ? (
                    // ADR-0064 (emenda 29/09): o voto de legenda é válido — o % aparece,
                    // sempre com o destino ao lado, que desfaz a leitura de voto nominal.
                    <small>
                      {formatPercent(l.pct_validos, 2)}
                      {noPais ? ` dos válidos ${siglaNaFrase(l.uf, comArtigo).de}` : null} ·{" "}
                      <DestinoDeputadoTexto destino={l.destino} />
                    </small>
                  ) : l.pct_validos !== null ? (
                    <small>
                      {formatPercent(l.pct_validos, 2)}
                      {noPais ? ` dos válidos ${siglaNaFrase(l.uf, comArtigo).de}` : null}
                    </small>
                  ) : (
                    <small>—</small>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
