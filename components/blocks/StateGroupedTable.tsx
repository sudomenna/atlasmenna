/**
 * components/blocks/StateGroupedTable.tsx
 *
 * Tabela "Resultados por estado" agrupada por bucket. Cobertura: RF-030.6.
 *
 * Modos (S05/F3B — refator)
 *   - `mode="binary"` (default): 5 colunas (A_safe | A_close | tossup | B_close | B_safe).
 *     Comportamento S04 preservado — usado em 2T e em 1T com 2 candidatos.
 *   - `mode="multi-1t"`: 1 coluna por candidato com >= 1 UF liderando + 1
 *     coluna "Em disputa" (UFs com tossup ou margem < 2pp). Cor do header
 *     vem da SIGLA do candidato (`candidateMarkerColor`, ADR-0024) — nunca da
 *     colocação; ver a nota de 2026-09-20 em `MultiTable`. Esperado típico em
 *     1T BR: 2-3 colunas concentrando a maioria das UFs (top-2 dominante) + 1
 *     "Em disputa".
 *
 * Server Component. O único pedaço client é `<UfHoverLink>` (a célula de UF),
 * que precisa de handlers de foco — ver a nota de 2026-09-20 abaixo.
 *
 * A11y
 *   - `<table>` semântico, com `<caption>` + `<thead>` + `<tbody>`.
 *   - Linhas vinculadas a `/uf/[sigla]`.
 *
 * 🔴 2026-09-19 — esta tabela é o EQUIVALENTE TEXTUAL do mapa nacional, não
 * um extra. `_NationalChoroplethMapImpl.tsx` aponta o `aria-describedby` do
 * `role="img"` para o `<h2 id="state-grouped-table-heading">` daqui: quem não
 * enxerga o coroplético é mandado para cá. Tudo que o balão de hover
 * (`<HoverCard>`, `aria-hidden` por construção) mostra sobre uma UF e não
 * existe aqui é informação que a rota `/` simplesmente não entrega a leitor
 * de tela — e o balão ganhou naquele dia uma 5ª linha, "Outros (N)", com a
 * cauda de candidaturas fora das quatro primeiras.
 *
 * 🔴 **2026-09-20 — a distância que o ajuste anterior abriu, fechada.** Até
 * aqui o balão nomeava 4 candidaturas por UF e esta tabela nomeava **uma** (o
 * líder, e só no cabeçalho da coluna): quem usa mouse alcançava quatro nomes
 * por estado, quem usa teclado ou leitor de tela alcançava um. Entraram duas
 * emendas, ambas na célula (`<CelulaUf>`, abaixo):
 *
 *   (a) **o foco abre o balão** — `<UfHoverLink>` emite para o `useHoverStore`
 *       com `source: "table"` e o mapa obedece (WCAG SC 1.4.13);
 *   (b) **as 4 candidaturas viram texto** — um bloco `sr-only` por célula,
 *       ligado ao link por `aria-describedby`, montado por
 *       `descricaoCandidaturasUf` (`lib/utils/uf-descricao-candidaturas.ts`).
 *
 * O `<HoverCard>` continua `aria-hidden`, e isso é de propósito: fazê-lo falar
 * duplicaria o que a descrição já diz.
 *
 * As células de UF eram `<a href>` cru até 2026-09-08 e passaram a `<Link>`
 * (ADR-0033 § 1). Um `<a href>` recarrega o documento, e com a moldura
 * persistente isso significa derrubar a moldura inteira — medido no navegador
 * naquele dia: uma marca gravada em `window` não sobrevivia ao clique daqui,
 * mas sobrevivia ao clique num `<Link>`. O HTML rendido é o mesmo `<a href>`
 * indexável; muda só o handler que o App Router acopla.
 */

import { rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import { UfHoverLink } from "@/components/atoms/tables/UfHoverLink";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { formatPercent, formatPp } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { descricaoCandidaturasUf } from "@/lib/utils/uf-descricao-candidaturas";

export type StateGroupedTableMode = "binary" | "multi-1t";

export interface StateGroupedTableProps {
  rows: EdgeUfRow[];
  /**
   * Modo de agrupamento. Default `"binary"` mantém o comportamento S04
   * (5 colunas A/B). Em corrida 1T multi-candidato, caller passa `"multi-1t"`
   * pra mostrar 1 coluna por candidato + "Em disputa".
   */
  mode?: StateGroupedTableMode;
  /**
   * Lista nacional de candidatos. Necessário em `mode="multi-1t"` pra
   * resolver `nome` + `rank` por `id` (UF.lider). Opcional em binary
   * (mantém back-compat S04 via `candidatoAName`/`candidatoBName`).
   */
  candidatos?: EdgeCandidate[];
  candidatoAId: number | null;
  /** Usado em mode="binary". S05+: prefira passar `candidatos`. */
  candidatoAName?: string;
  /** Usado em mode="binary". S05+: prefira passar `candidatos`. */
  candidatoBName?: string;
  /**
   * Cor das duas faixas do lado A em `mode="binary"`. O caller resolve pela
   * SIGLA (`candidateColor`) — ver `app/(pres)/page.tsx`.
   *
   * 🔴 O default era `"var(--color-cand-1)"` até 2026-09-20: a ponta da paleta
   * por COLOCAÇÃO cravada no LADO. Quem omitisse a prop ganhava vermelho para
   * "A" e azul para "B" independentemente de quem fosse — e A e B são o líder
   * e o segundo, que trocam de lugar durante a noite. Hoje o default é o
   * cinza de sigla desconhecida: "não me disseram de quem é esta faixa" é
   * verdade, "vermelho porque é o de cima" não era.
   */
  corA?: string;
  /** Idem `corA`, lado B. */
  corB?: string;
  /** Limites em pp. Default: comfortable >= 10, tossup < 3. */
  comfortableThreshold?: number;
  tossupThreshold?: number;
  /** Margem (pp) que classifica UF como "Em disputa" em multi-1t. Default 2. */
  multiDisputaThreshold?: number;
  className?: string;
}

type Bucket = "a_safe" | "a_close" | "tossup" | "b_close" | "b_safe";

function bucketFor(
  row: EdgeUfRow,
  candidatoAId: number | null,
  comfortable: number,
  tossup: number,
): Bucket {
  const abs = Math.abs(row.margem_projetada);
  if (abs < tossup) return "tossup";
  const isA = row.lider === candidatoAId;
  if (isA) return abs >= comfortable ? "a_safe" : "a_close";
  return abs >= comfortable ? "b_safe" : "b_close";
}

/**
 * Uma célula de UF — a mesma nos dois modos (`binary` e `multi-1t`), que até
 * 2026-09-19 tinham **cópias byte a byte** deste `<Link>`. Virou função no dia
 * em que ganhou a segunda linha: duas cópias de uma regra de ausência ("campo
 * faltando ⇒ NENHUMA linha") é uma cópia a mais do que o número de lugares em
 * que alguém vai lembrar de conferir.
 *
 * 🔴 **A segunda linha, "Outros (N)"** (2026-09-19, decisão do dono). É a
 * cauda somada pelo produtor (`api/model/project.py`) — todas as candidaturas
 * da UF fora das quatro primeiras. Ela já existia no balão de hover do mapa,
 * que é `aria-hidden` por construção (`HoverCard.tsx`: espelha em pixels o que
 * um ponteiro revelou, e quem navega por teclado não tem ponteiro). Esta
 * tabela é o alvo do `aria-describedby` daquele mapa, então é AQUI que a
 * informação passa a existir para todo mundo.
 *
 * Visível, não `sr-only`: texto escondido é uma segunda verdade que ninguém
 * revisa e que apodrece — e este número interessa a quem enxerga também ("um
 * décimo deste estado não está em nenhuma das quatro primeiras candidaturas"
 * é exatamente o tipo de fato que o mapa pintado pelo 1º colocado esconde).
 *
 * Três regras duras, todas do contrato de `EdgeUfRow.outros`
 * (`lib/edge-config/types.ts`) e todas com teste dedicado:
 *
 *   1. **Campo ausente ⇒ nenhuma linha.** Ausência significa "a cauda é
 *      vazia" (UF com ≤ 4 candidaturas no cargo), não "os demais somam zero".
 *      Renderizar incondicionalmente escreveria "Outros 0,0%" numa corrida de
 *      três, que é uma linha falsa.
 *   2. **Nada de `100 − Σ(top)`.** O número vem do campo, somado candidato a
 *      candidato no produtor. Os pontos de uma UF não fecham em 100 (cada um
 *      é a média de um bootstrap próprio); a subtração publicaria esse resíduo
 *      de fechamento como se fosse voto de alguém — e aqui seria pior que no
 *      balão, porque esta tabela nem tem os `top_candidatos` na tela para o
 *      leitor desconfiar da conta.
 *   3. **Só `pct` (a projeção), não `pct_atual` nem `votos_atuais`.** Não é
 *      economia de bytes: a célula tem ~1/5 da largura da tabela e todo o
 *      vocabulário dela é projeção (`margem_projetada` na mesma linha). Os
 *      outros dois números da cauda estão em `/senador`, onde a linha é de
 *      largura cheia. Mesma escolha de `<GovernorCard>`, que também publica
 *      só o ponto projetado de "Outros".
 *
 * Sem marcador de cor, de propósito — e isto é decisão registrada, não
 * esquecimento: o `<HoverCard>` põe um ESPAÇADOR INVISÍVEL no lugar do ponto
 * de 8×8 desta linha, porque "um ponto cinza inventaria identidade visual para
 * o resto" (docstring de `HoverCardRow.color`). Um quadradinho
 * `var(--color-cand-other)` aqui reabriria exatamente isso. `<GovernorCard>`
 * usa aquele token, mas para uma BARRA — preenchimento com extensão, que
 * precisa de alguma tinta —, não para um marcador de identidade.
 */
function CelulaUf({ row }: { row: EdgeUfRow }) {
  const outros = row.outros;
  /**
   * 🔴 2026-09-20 — a descrição acessível com as 4 candidaturas + "Outros".
   *
   * **Descrição, e não conteúdo visível da célula, de propósito.** São 27
   * células; quatro nomes despejados no fluxo de leitura de cada uma tornariam
   * a tabela impraticável para quem a varre de cima a baixo. Como
   * `aria-describedby`, o texto é falado quando a pessoa **para naquele
   * estado** — que é exatamente o momento em que o balão abre para quem usa
   * mouse.
   *
   * **`<span>`, nunca uma `<table>` com `sr-only`** (regra de 2026-09-19,
   * travada por `tests/unit/design-system/sr-only-tabela.test.ts`): o recorte
   * depende de `width: 1px` e o layout de tabela lê largura como MÍNIMO —
   * medido na home a 360px, uma `<table class="sr-only">` saiu com 2.768px e
   * criou 2.424px de rolagem horizontal. Aqui não há tabela escondida
   * nenhuma; o texto é uma frase.
   *
   * **Fora do `<Link>`, não dentro.** O nome acessível de um link é computado
   * a partir do seu conteúdo: um `sr-only` aqui dentro faria o link se chamar
   * "SP −10,0 pp 30% Outros (7) 8,1% Primeiras candidaturas, por projeção:
   * …" — a lista inteira lida duas vezes, uma como nome e outra como
   * descrição. Como irmão, o link continua se chamando "SP …" e a descrição
   * vem depois.
   *
   * Texto vazio (payload sem `top_candidatos` e sem `outros`) ⇒ nem o `<span>`
   * nem o atributo — `aria-describedby` apontando para um elemento vazio
   * anuncia uma descrição que não existe.
   */
  const descricao = descricaoCandidaturasUf(row);
  const descId = descricao ? `uf-cand-${row.sigla}` : undefined;
  return (
    <>
      <UfHoverLink
        sigla={row.sigla}
        href={`/uf/${row.sigla}`}
        describedById={descId}
        className="flex flex-col gap-0.5"
        style={{ color: "var(--color-text)" }}
      >
        <span className="flex items-baseline justify-between gap-2">
          {/* ADR-0045 — o exterior (`ZZ`) aparece como "Exterior", nunca a sigla crua. */}
          <span className="font-medium tabular-nums">{rotuloDaUnidade(row.sigla)}</span>
          <span className="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
            {/* 🔴 04/10 (dono): a margem é projetada ⇒ cor da projeção; o
                % apurado ao lado segue na tinta apagada. */}
            <span style={{ color: "var(--color-pct-proj)" }}>{formatPp(row.margem_projetada)}</span>{" "}
            · {formatPercent(row.pct_apurado, 0)}
          </span>
        </span>
        {outros ? (
          <span
            className="flex items-baseline justify-between gap-2 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {/* `n_candidatos` é a razão de este agregado não caber dentro de
                `top_candidatos[]` — candidatura nenhuma tem esse campo — e é o
                que impede o rótulo de mentir por omissão: "Outros" sozinho não
                diz se é gente ou arredondamento. */}
            <span className="truncate">Outros ({outros.n_candidatos})</span>
            {/* `outros.pct` é Σ `pct_projetado` da cauda ⇒ cor da projeção (04/10). */}
            <span className="tabular-nums" style={{ color: "var(--color-pct-proj)" }}>
              {formatPercent(outros.pct, 1)}
            </span>
          </span>
        ) : null}
      </UfHoverLink>
      {descId ? (
        <span id={descId} className="sr-only">
          {descricao}
        </span>
      ) : null}
    </>
  );
}

export function StateGroupedTable({
  rows,
  mode = "binary",
  candidatos,
  candidatoAId,
  candidatoAName = "Líder A",
  candidatoBName = "Líder B",
  corA = "var(--party-outros)",
  corB = "var(--party-outros)",
  comfortableThreshold = 10,
  tossupThreshold = 3,
  multiDisputaThreshold = 2,
  className,
}: StateGroupedTableProps) {
  if (mode === "multi-1t") {
    return (
      <MultiTable
        rows={rows}
        candidatos={candidatos ?? []}
        multiDisputaThreshold={multiDisputaThreshold}
        className={className}
      />
    );
  }

  // mode === "binary" — comportamento S04
  const groups: Record<Bucket, EdgeUfRow[]> = {
    a_safe: [],
    a_close: [],
    tossup: [],
    b_close: [],
    b_safe: [],
  };
  rows.forEach((row) => {
    groups[bucketFor(row, candidatoAId, comfortableThreshold, tossupThreshold)].push(row);
  });
  // Dentro de cada bucket, ordena por |margem| decrescente (mais "definidos" primeiro)
  (Object.keys(groups) as Bucket[]).forEach((k) => {
    groups[k].sort((a, b) => Math.abs(b.margem_projetada) - Math.abs(a.margem_projetada));
  });

  const headers: Array<{ id: Bucket; label: string; color: string }> = [
    { id: "a_safe", label: `${candidatoAName} confortável`, color: corA },
    { id: "a_close", label: `${candidatoAName} apertado`, color: corA },
    { id: "tossup", label: "Em disputa", color: "var(--color-tossup)" },
    { id: "b_close", label: `${candidatoBName} apertado`, color: corB },
    { id: "b_safe", label: `${candidatoBName} confortável`, color: corB },
  ];

  // Altura uniforme das colunas — max length
  const maxLen = Math.max(...headers.map((h) => groups[h.id].length));

  return (
    <section
      aria-labelledby="state-grouped-table-heading"
      className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
    >
      <header>
        <h2
          id="state-grouped-table-heading"
          className="text-xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Resultados por estado
        </h2>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          UFs agrupadas pela margem projetada (líder atual).{" "}
          {/* 🔴 A legenda é o que impede "Outros (7) 8,1%" de flutuar sem
              referência: a célula não nomeia nenhuma candidatura (quem nomeia
              é o cabeçalho da coluna, e só o líder), então sem esta frase o
              leitor não tem como saber de que conjunto o 8,1% é a soma. */}
          <strong style={{ fontWeight: 600 }}>Outros</strong> é a soma das candidaturas fora das
          quatro primeiras de cada estado; o número entre parênteses é quantas são.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {rows.some((r) => r.sigla === "ZZ")
              ? "27 UFs e o exterior agrupados em 5 colunas pela margem projetada."
              : "27 UFs agrupadas em 5 colunas pela margem projetada."}
          </caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h.id}
                  scope="col"
                  className="border-b px-2 py-2 text-left text-xs font-medium uppercase tracking-wide"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                    style={{ backgroundColor: h.color }}
                  />
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLen }).map((_, rowIdx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: linhas são posicionais por construção (buckets ordenados por |margem|); sem id estável.
              <tr key={`row-${rowIdx}`}>
                {headers.map((h) => {
                  const row = groups[h.id][rowIdx];
                  return (
                    <td
                      key={h.id}
                      className="border-b px-2 py-1.5 align-top"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {row ? <CelulaUf row={row} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MultiTable — mode="multi-1t" (1 coluna por candidato + Em disputa)
// ---------------------------------------------------------------------------
interface MultiTableProps {
  rows: EdgeUfRow[];
  candidatos: EdgeCandidate[];
  multiDisputaThreshold: number;
  className?: string;
}

function MultiTable({ rows, candidatos, multiDisputaThreshold, className }: MultiTableProps) {
  // Lookup id → candidato (nome + rank)
  const byId = new Map(candidatos.map((c) => [c.id, c]));

  // Bucket "Em disputa": margem absoluta abaixo do threshold (default 2pp).
  // Demais UFs vão pra coluna do `lider`.
  const disputa: EdgeUfRow[] = [];
  const porLider = new Map<number, EdgeUfRow[]>();
  for (const row of rows) {
    if (Math.abs(row.margem_projetada) < multiDisputaThreshold) {
      disputa.push(row);
      continue;
    }
    const arr = porLider.get(row.lider) ?? [];
    arr.push(row);
    porLider.set(row.lider, arr);
  }

  // Ordena UFs dentro de cada coluna por |margem| desc (mais decisivas primeiro)
  for (const arr of porLider.values()) {
    arr.sort((a, b) => Math.abs(b.margem_projetada) - Math.abs(a.margem_projetada));
  }
  disputa.sort((a, b) => Math.abs(a.margem_projetada) - Math.abs(b.margem_projetada));

  // Headers: 1 por candidato com >= 1 UF + 1 "Em disputa"
  // Ordenação dos candidatos por rank ascendente (rank 1 primeiro)
  type Header = {
    key: string;
    label: string;
    color: string;
    ufs: EdgeUfRow[];
  };

  const candidatoHeaders: Header[] = Array.from(porLider.entries())
    .map(([liderId, ufs]) => {
      const cand = byId.get(liderId);
      const rank = cand?.rank ?? 99;
      const nome = cand ? nomeExibicao(cand.nome, cand.sqcand) : `#${liderId}`;
      return {
        key: `cand-${liderId}`,
        label: nome,
        // 🔴 2026-09-20 — a cor sai da SIGLA, não da colocação.
        //
        // `color` aqui vira um quadradinho de 8×8 (`h-2 w-2`) ao lado do nome
        // no cabeçalho da coluna: MARCADOR sem extensão ⇒
        // `candidateMarkerColor` (a variante `-text`, legível), a mesma regra
        // do ponto do `<HoverCard>` e da lista de candidatos. Era
        // `colorForRank(rank)` — a paleta por COLOCAÇÃO do ADR-0013, que o
        // ADR-0024 aposentou em 2026-09-07.
        //
        // **Este era o pior dos pontos que sobraram.** Esta tabela fica na
        // HOME, ao lado do mapa, e o mapa já resolvia pela sigla: uma
        // candidatura sem token próprio (federação — "PSDB/CIDADANIA",
        // "FEDERACAO BRASIL DA ESPERANCA" — ou sigla ausente) saía aqui na
        // cor da sua posição e, a dois palmos de distância, no cinza de
        // reserva. Mesma pessoa, duas tintas, na mesma tela — o defeito que o
        // dono reportou em 19/09 com CAIADO/PSD.
        //
        // `rank` continua vindo do candidato, mas só para ORDENAR as colunas
        // (rank 1 primeiro, logo abaixo). Ordenar por posição é legítimo;
        // pintar por posição não é.
        color: candidateMarkerColor(cand?.partido),
        ufs,
        rank,
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank, ...h }) => h); // strip rank from final shape

  const disputaHeader: Header = {
    key: "disputa",
    label: "Em disputa",
    color: "var(--color-tossup)",
    ufs: disputa,
  };

  const headers: Header[] = [...candidatoHeaders, disputaHeader];

  // Altura uniforme — max length
  const maxLen = Math.max(0, ...headers.map((h) => h.ufs.length));

  return (
    <section
      aria-labelledby="state-grouped-table-heading"
      className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
    >
      <header>
        <h2
          id="state-grouped-table-heading"
          className="text-xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Resultados por estado
        </h2>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {primeiroTurnoEncerrado()
            ? "UFs agrupadas pelo líder (resultado final do 1º turno)."
            : "UFs agrupadas pelo líder projetado (1º turno)."}{" "}
          {/* Gêmea da legenda do modo binário — ver lá o porquê. */}
          <strong style={{ fontWeight: 600 }}>Outros</strong> é a soma das candidaturas fora das
          quatro primeiras de cada estado; o número entre parênteses é quantas são.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {rows.length} UFs agrupadas em {headers.length} colunas — 1 por candidato + "Em
            disputa".
          </caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  scope="col"
                  className="border-b px-2 py-2 text-left text-xs font-medium uppercase tracking-wide"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                    style={{ backgroundColor: h.color }}
                  />
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLen }).map((_, rowIdx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: linhas são posicionais por construção (UFs ordenadas por |margem|); sem id estável.
              <tr key={`row-${rowIdx}`}>
                {headers.map((h) => {
                  const row = h.ufs[rowIdx];
                  return (
                    <td
                      key={h.key}
                      className="border-b px-2 py-1.5 align-top"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {row ? <CelulaUf row={row} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
