"use client";

/**
 * components/blocks/MunicipioExplorer.tsx
 *
 * S07/Bloco 2 — a folha do município. Tocar num município (na tabela, no
 * MAPA da coluna ao lado ou, onde ela existe, na grade de quadrados) abre o
 * `<Sheet>` com os números daquele município.
 *
 * ## 2026-09-10 — o mapa passa a abrir esta mesma folha
 *
 * O protótipo abre a folha ao clicar num município **do mapa**
 * (`ui_kits/atlas-menna/App.jsx:311`); aqui ela só abria pela tabela. O gatilho
 * que faltava agora existe em `<ChoroplethMapUF>` (`map.on("click", ...)`), e
 * chega até aqui pelo store de módulo em
 * `components/shared/municipio-sheet-store.ts` — o mapa vive na moldura
 * persistente montada pelo `layout.tsx` (ADR-0033 § 1), numa árvore React irmã
 * desta. Nenhuma segunda folha foi criada: é este `<Sheet>`, com estes números.
 *
 * Clique num município que o payload não cobre é **no-op silencioso**: sem
 * entrada em `municipios` não há nem nome nem `pct_apurado` para titular a
 * folha, e um diálogo vazio comunicaria menos que nada (ADR-0017 vale para
 * estado ausente exibido, não para diálogo inventado).
 *
 * Portado do `MunSheet` do protótipo do kit
 * (`docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:198`), com
 * duas divergências que vêm do dado real e não do desenho:
 *
 *   1. **Não há projeção por município.** O protótipo mostra parcial e
 *      projeção lado a lado na folha porque a maquete inventa `projVotes`
 *      para cada município. `EdgeUfMunicipio` traz só `votos_reportados`
 *      (apurados) — o modelo projeta por ZONA e agrega para a UF (ADR-0021),
 *      nunca publica um projetado municipal. A folha, portanto, mostra o
 *      **parcial** e diz que é parcial. Repetir o mesmo número nas duas
 *      colunas fingiria uma projeção que não existe (constituição § 8).
 *   2. **O eleitorado por município passou a existir** (11/09, ADR-0035 D2):
 *      `EdgeUfMunicipio.eleitores` é a soma exata do eleitorado apto dos pares
 *      (município × zona) do cadastro do TSE, sem rateio, e a `Figure`
 *      "Eleitores" do kit (`App.jsx:203`) voltou ao seu lugar. O campo é
 *      OPCIONAL, porém: Blob gravado antes da migration 0006 não o traz, e
 *      nesse caso a folha degrada para "Votos apurados" e diz na nota que
 *      trocou a medida. Até 10/09 esse era o único comportamento.
 *
 * A nota de rodapé da folha declara, além disso, a granularidade real do dado
 * (constituição § 8): a unidade que o TSE apura é a ZONA, uma zona pode
 * atravessar vários municípios, e o total do município é a soma dos boletins
 * dos pares que caem nele — enquanto o `pct_apurado` municipal é média das
 * zonas ponderada pelo eleitorado do par (`fetch_municipio_aggregates`,
 * api/model/project.py), não um percentual que o TSE publique por município.
 *
 * ## Por que este componente existe (e a tabela não abre o sheet sozinha)
 *
 * O estado "qual município está aberto" é compartilhado entre a tabela, a
 * grade, o mapa e o sheet. Se cada bloco carregasse o próprio, tocar na grade
 * não fecharia o sheet aberto pela tabela. Este wrapper é o dono do SHEET; o
 * estado em si mudou de casa em 2026-09-10 (de `useState` local para o store
 * de módulo) porque o quarto gatilho, o mapa, não é descendente deste
 * componente. A tabela e a grade continuam recebendo só um `onSelect`, e
 * continuam utilizáveis sem ele.
 *
 * `"use client"` já era obrigatório aqui: `<MunicipioTable>` e
 * `<MunicipioWaffleGrid>` são Client Components desde S04/S06, então este
 * wrapper não empurra nada novo para o bundle acima da dobra além do próprio
 * `<Sheet>` (RNF-007a).
 *
 * A11y
 *   - Na tabela, o nome do município vira `<button>` de altura `--tap-min`
 *     (44px, o mínimo que o design system fixou) — é o caminho de teclado e
 *     de leitor de tela para abrir qualquer município.
 *   - A grade é `<svg role="img">`: todo o seu interior já está FORA da
 *     árvore de acessibilidade, e o clique nela é um atalho de ponteiro sobre
 *     uma imagem. O equivalente acessível é a tabela logo abaixo, que lista
 *     os mesmos municípios — mais a tabela `sr-only` que a própria grade
 *     emite. Nenhuma semântica interativa nova é anunciada.
 *   - O `<Sheet>` já resolve Esc, foco de entrada/retorno e `aria-modal`.
 */

import { useCallback, useEffect, useMemo } from "react";

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import { Figure } from "@/components/atoms/data/Figure";
import { Sheet } from "@/components/atoms/overlays/Sheet";
import { candidateColor, DATA_FILL_STROKE } from "@/components/blocks/_candidateColor";
import { type MunicipioRow, MunicipioTable } from "@/components/blocks/MunicipioTable";
import { MunicipioWaffleGrid } from "@/components/blocks/MunicipioWaffleGrid";
import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";
import type { EdgeCandidate, EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { compete, haAnulada, NOTA_ANULADAS_SEM_REGRA_1T } from "@/lib/utils/destino-voto";
import { formatPercent, formatVotes } from "@/lib/utils/format";
import {
  type MunicipioVotoCandidato as FolhaRow,
  votosPorCandidatoMunicipio,
} from "@/lib/utils/municipio-votos";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

export interface MunicipioExplorerProps {
  ufSigla: string;
  /** Municípios do payload — fonte da folha. */
  municipios: EdgeUfMunicipio[];
  /** Linhas já adaptadas para `<MunicipioTable>` (o caller já as monta). */
  rows: MunicipioRow[];
  /** Candidatos da corrida na UF — dá nome, partido e cor a cada linha da folha. */
  candidatos: EdgeUfCandidate[];
  /**
   * 🔴 `tableMode` / `topN` saíram em 2026-09-20. `<MunicipioTable>` tem UM
   * modo — lista ordenada por eleitorado e paginada (20 + 40 por vez) — e as
   * três rotas de estado o consomem igual. Ver o cabeçalho daquele arquivo
   * para o porquê de a substituição não ser adição.
   */
  /**
   * Quando presente, a grade de quadrados aparece acima da tabela e também
   * abre a folha. É o shape que `<MunicipioWaffleGrid>` pede (`EdgeCandidate`,
   * com `rank`), montado pela página de governador.
   */
  waffleCandidatos?: EdgeCandidate[];
  /** Repassado a `<MunicipioTable limite>` — corta a LISTA, nunca a folha. */
  limiteLista?: number;
}

// `FolhaRow` (o percentual sobre o total apurado NO MUNICÍPIO) e a função que
// o calcula saíram daqui em 2026-09-18 — ver `lib/utils/municipio-votos.ts`.
// O balão do mapa municipal (`ChoroplethMapUF`, hover) passou a precisar do
// MESMO número que esta folha (clique) já mostrava, e duas contas para o
// mesmo dado divergem cedo ou tarde. `FolhaRow` é um alias de
// `MunicipioVotoCandidato` — só o nome mudou de lugar, o cálculo é
// byte-a-byte o mesmo.

/** A barra decorativa de uma linha da folha — ver o comentário dentro. */
function BarraFolha({ row }: { row: { pct: number; partido?: string | undefined } }) {
  return (
    <div
      aria-hidden="true"
      style={{
        gridColumn: "2 / -1",
        height: 6,
        borderRadius: "var(--radius-xs)",
        background: "var(--surface-sunken)",
        border: DATA_FILL_STROKE,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, row.pct))}%`,
          height: "100%",
          // Barra da folha do município: preenchimento com extensão ⇒
          // cor-base do partido. `row.cor` vinha da paleta por COLOCAÇÃO.
          //
          // 🔴 O 2º argumento (`rank`) saiu em 2026-09-20. Desde `19c2ae2`
          // ele é IGNORADO por `candidateColor` — federação e sigla ausente
          // resolvem para `--party-outros`, e não há mais fallback por
          // colocação a alimentar. Passá-lo continuava anunciando na
          // chamada uma influência que a função não tem: a próxima pessoa a
          // ler esta linha concluiria que a cor daqui depende da posição na
          // folha, que é exatamente o que a constituição § 2 proíbe. O
          // `rank` da prop segue em uso — ele é o número "1, 2, 3…" impresso
          // na primeira coluna da linha.
          background: candidateColor(row.partido),
        }}
      />
    </div>
  );
}

/** Uma linha da folha — parcial apenas, rotulada como parcial. */
function FolhaLinha({ row, rank }: { row: FolhaRow; rank: number }) {
  return (
    <div
      data-testid="municipio-sheet-row"
      className="grid items-center"
      style={{
        gridTemplateColumns: "1.5rem minmax(0, 1fr) auto",
        columnGap: "var(--space-3)",
        rowGap: "var(--space-2)",
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--border-hairline)",
      }}
    >
      <span aria-hidden="true" style={{ font: "var(--type-data)", color: "var(--text-muted)" }}>
        {/* ADR-0053 / RF-213 — a anulada vem no fim e não disputa colocação. */}
        {compete(row) ? rank : "—"}
      </span>
      <div className="flex min-w-0 items-center" style={{ gap: "var(--space-2)" }}>
        <span className="truncate" style={{ font: "var(--type-body-sm)", fontWeight: 500 }}>
          {row.nome}
        </span>
        <DestinoEtiqueta destino={row.destino} />
        <span
          className="flex-none"
          style={{
            font: "var(--type-kicker)",
            letterSpacing: "var(--tracking-caps)",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          {/* 2026-09-18: o "—" agora é do RENDER, não do dado (ver docstring
              de `MunicipioVotoCandidato.partido` em `lib/utils/municipio-votos.ts`)
              — o texto na tela é idêntico a antes.
              2026-09-19: desenhado ⇒ abreviado. A abreviação roda DEPOIS do
              `??`, sobre o texto que vai à tela: o travessão não está na tabela
              e atravessa intacto. */}
          {siglaExibicao(row.partido ?? "—")}
        </span>
      </div>
      <div className="text-right">
        {/* Emenda "opção A" ao ADR-0053 — `pct === null` é a anulada: sem
            percentual e sem barra, só os votos (que o dado sempre traz aqui). */}
        {row.pct !== null ? (
          <div style={{ font: "var(--type-figure-sm)", color: "var(--text-primary)" }}>
            {formatPercent(row.pct, 1)}
          </div>
        ) : null}
        <div
          data-testid={row.pct === null ? "municipio-sheet-votos-anulada" : undefined}
          style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
        >
          {formatVotes(row.votos)} votos
        </div>
      </div>
      {/* Barra decorativa: o percentual já está em texto acima.

          🔴 2026-09-20 — a CALHA ganhou o contorno que faltava desde que a
          barra existe. `DATA_FILL_STROKE` é obrigatório em toda superfície
          colorida por partido (`_candidateColor.ts`), e aqui ele nunca foi
          posto: medido contra `--surface-sunken` no tema claro, o
          preenchimento dava PSOL 1,92:1 · PSB 2,02 · "outros" (o destino de
          toda FEDERAÇÃO) 2,21 · NOVO 2,50, todos abaixo do piso de 3:1 do
          RNF-035 / WCAG SC 1.4.11. Sem fronteira, a barra clara encosta na
          calha clara e o leitor perde ONDE o dado acaba — que é a única
          informação que uma barra carrega.

          A forma é a de `<VoteBar>`, `<RemainingPanel>` e `<StrongholdsPanel>`:
          contorno na CALHA (uma linha, os 31 tokens de uma vez), não no
          preenchimento. A altura subiu de 4 para 6 junto, que é a altura dos
          dois irmãos mais próximos: com `box-sizing: border-box`, 1px de borda
          em cima e embaixo de uma calha de 4px deixaria 2px de miolo. */}
      {row.pct !== null ? <BarraFolha row={{ pct: row.pct, partido: row.partido }} /> : null}
    </div>
  );
}

export function MunicipioExplorer({
  ufSigla,
  municipios,
  rows,
  candidatos,
  waffleCandidatos,
  limiteLista,
}: MunicipioExplorerProps) {
  // Qual município está aberto vive FORA deste componente desde 2026-09-10:
  // o clique no mapa (`<ChoroplethMapUF>`) precisa abrir esta mesma folha, e o
  // mapa é montado pelo `layout.tsx` do grupo de rotas, numa árvore irmã. Ver
  // o cabeçalho de `components/shared/municipio-sheet-store.ts`. Selector fino
  // (só o `codIbge`), como manda a convenção do `useHoverStore`.
  const selecionado = useMunicipioSheetStore((s) => s.codIbge);
  const select = useMunicipioSheetStore((s) => s.select);

  const porCod = useMemo(
    () => new Map(municipios.map((m) => [m.cod_ibge, m] as const)),
    [municipios],
  );

  const abrir = useCallback(
    (cod: string) => {
      if (porCod.has(cod)) select(cod);
    },
    [porCod, select],
  );
  const fechar = useCallback(() => select(null), [select]);

  // O store é de módulo: sobrevive à navegação. Sem esta limpeza, sair de
  // `/uf/SP` com a folha aberta e voltar depois reabriria a folha sozinha — e
  // ir de `/uf/SP` para `/uf/MG` (mesmo componente de página, árvore React
  // preservada pelo App Router) carregaria junto o `cod_ibge` da UF anterior.
  // Fecha ao montar, ao desmontar e a cada troca de UF; o `porCod.has()` acima
  // é a segunda trava.
  //
  // `ufSigla` não é LIDO no corpo — é o gatilho. Trocar de UF tem de fechar a
  // folha; sem a dependência, voltar para a UF anterior reabriria a folha dela.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ufSigla é gatilho, não leitura — ver acima
  useEffect(() => {
    select(null);
    return () => select(null);
  }, [select, ufSigla]);

  const municipio = selecionado ? (porCod.get(selecionado) ?? null) : null;
  const linhas = useMemo(
    () => (municipio ? votosPorCandidatoMunicipio(municipio, candidatos) : []),
    [municipio, candidatos],
  );
  const totalVotos = linhas.reduce((acc, l) => acc + l.votos, 0);

  // O slot do kit é "Eleitores" (`App.jsx:203`). Desde 11/09 o payload publica
  // `eleitores` por município (ADR-0035 D2) — mas como campo OPCIONAL, então o
  // slot ainda tem de saber viver sem ele: um Blob gravado antes da migration
  // 0006 não traz o campo, e aí a folha volta ao que dava para dizer com
  // honestidade ("Votos apurados"), com a nota explicando a troca.
  const eleitores =
    typeof municipio?.eleitores === "number" && Number.isFinite(municipio.eleitores)
      ? municipio.eleitores
      : null;

  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      {waffleCandidatos ? (
        <MunicipioWaffleGrid
          municipios={municipios}
          candidatos={waffleCandidatos}
          cell={12}
          gap={2}
          onSelect={abrir}
        />
      ) : null}

      <MunicipioTable rows={rows} limite={limiteLista} onSelect={abrir} />

      {municipio ? (
        <Sheet
          open
          onClose={fechar}
          kicker={`Município · ${ufSigla}${municipio.capital ? " · capital" : ""}`}
          title={municipio.nome}
          headingLevel={3}
        >
          <div
            className="grid grid-cols-2"
            style={{ gap: "var(--space-4)", marginBottom: "var(--space-4)" }}
          >
            <Figure label="Apurado" value={formatPercent(municipio.pct_apurado, 1)} size="md" />
            {eleitores !== null ? (
              <Figure label="Eleitores" value={formatVotes(eleitores)} size="md" />
            ) : (
              <Figure label="Votos apurados" value={formatVotes(totalVotos)} size="md" />
            )}
          </div>
          {linhas.length > 0 ? (
            <>
              {linhas.map((l, i) => (
                <FolhaLinha key={l.id} row={l} rank={i + 1} />
              ))}
              {haAnulada(linhas) ? (
                <p
                  data-testid="municipio-sheet-nota-anuladas"
                  style={{
                    margin: "var(--space-3) 0 0",
                    font: "var(--type-body-sm)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  {NOTA_ANULADAS_SEM_REGRA_1T}
                </p>
              ) : null}
              <p
                style={{
                  margin: "var(--space-3) 0 0",
                  font: "var(--type-body-sm)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                }}
              >
                Percentuais sobre os votos já apurados neste município. A unidade que o TSE apura é
                a <strong>zona eleitoral</strong>, e uma zona pode atravessar vários municípios: o
                total daqui é a soma dos boletins de cada par município × zona, sem rateio. O
                percentual apurado do município é a média dessas zonas ponderada pelo eleitorado de
                cada par — não é um número que o TSE publique pronto por município. E não existe
                projeção municipal: o modelo projeta por zona e agrega para o estado.{" "}
                {eleitores !== null
                  ? "Os eleitores acima são a soma do eleitorado apto desses mesmos pares, como consta do cadastro do TSE."
                  : "O payload desta corrida não publica o eleitorado do município, então a segunda medida acima é o total de votos já apurados, não o total de eleitores."}
              </p>
            </>
          ) : (
            <p style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
              Nenhum voto reportado neste município até agora.
            </p>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
