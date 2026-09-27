/**
 * lib/utils/municipio-votos.ts
 *
 * 2026-09-18 (correção de rota do orquestrador, mesmo dia do balão do mapa
 * nacional) — **uma conta, dois consumidores**. `MunicipioExplorer` (a folha,
 * que abre no CLIQUE) já calculava o percentual de cada candidato num
 * município a partir de `votos_reportados` (`folhaRows`, então privada
 * naquele arquivo). O balão do mapa municipal (`ChoroplethMapUF`, que abre no
 * HOVER) precisa exatamente do mesmo número para o mesmo município — e uma
 * segunda implementação da mesma soma diverge cedo ou tarde: o defeito que
 * essa extração existe para prevenir é "o mouse diz 28,7% e o clique diz
 * 28,6% no mesmo município", a mesma cidade, a mesma tela.
 *
 * Extraído de `components/blocks/MunicipioExplorer.tsx` sem mudar a conta:
 * `votosPorCandidatoMunicipio` é `folhaRows` de antes, só que exportada e
 * livre de JSX, para que um átomo de mapa (`ChoroplethMapUF`, que não deve
 * importar de `components/blocks/`) possa chamá-la também.
 */

import type { EdgeDestinoVoto, EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { anuladasAoFim, compete } from "@/lib/utils/destino-voto";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { colorForParty } from "@/lib/utils/party-color";

export interface MunicipioVotoCandidato {
  id: number;
  nome: string;
  /**
   * Sigla do partido, ou `undefined` quando o candidato não está na lista de
   * `EdgeUfCandidate` passada (payload sem match para este `id`).
   *
   * Deliberadamente `undefined`, não `"—"` (2026-09-18, mudança desta
   * extração): a versão anterior (`FolhaRow.partido: string`, sempre
   * preenchida com `"—"` como placeholder) forçava cada consumidor a tratar
   * o traço como um VALOR de dado, e o `<HoverCard>` decide se uma coluna
   * inteira existe pela PRESENÇA do campo (`hasColumn`/`hasPartido`) — um
   * `"—"` literal ali contaria como "tem partido" e a coluna nunca sumiria
   * mesmo quando NENHUM candidato tivesse partido resolvido. O visual da
   * folha não muda: `MunicipioExplorer` agora escreve o `"—"` no RENDER
   * (`row.partido ?? "—"`), não no dado.
   */
  partido?: string;
  /**
   * Cor de **preenchimento** da candidatura, derivada da SIGLA
   * (`colorForParty`, ADR-0024).
   *
   * 🔴 **2026-09-20 — era `c?.cor ?? "var(--color-cand-other)"`: o campo `cor`
   * do payload, copiado literalmente.** Aquele campo carrega
   * `var(--color-cand-{rank})` — a paleta por COLOCAÇÃO do ADR-0013, que o
   * ADR-0024 aposentou em 2026-09-07 e que
   * `tests/unit/components/cor-nunca-do-payload.test.ts` bane de `components/`
   * e `app/` desde 19/09. Só que a varredura escolhia onde olhar, e `lib/`
   * ficou de fora: esta linha era a porta pela qual o campo banido voltava à
   * tela, por dentro de um utilitário. Os dois consumidores já tinham saído
   * dela por conta própria (o balão do mapa municipal em `ChoroplethMapUF` e a
   * barra da folha em `MunicipioExplorer` resolvem pela sigla), então o campo
   * estava **morto e errado ao mesmo tempo** — a pior combinação, porque nada
   * na tela denunciava.
   *
   * Sigla ausente, desconhecida ou de federação → `var(--party-outros)`.
   *
   * ⚠️ Preenchimento COM extensão. Para MARCADOR sem extensão (ponto de 8×8),
   * use `textForParty(row.partido)` no consumidor — é o que o balão faz.
   */
  cor: string;
  votos: number;
  /**
   * % sobre o total apurado NO MUNICÍPIO (`Σ votos_reportados` — ver a
   * docstring de {@link votosPorCandidatoMunicipio} para a prova de que este
   * é o MESMO denominador "votáveis" que `pct_atual` usa no resto do
   * produto, olhando um subconjunto menor de zonas).
   *
   * `0` quando `total === 0` — comportamento PRESERVADO do `folhaRows`
   * original, não uma decisão nova desta extração. Aberto com o orquestrador
   * em 2026-09-18 (relatório do map-builder daquele dia): é uma fração 0/0
   * (candidatos já listados no boletim, mas zero votos contados para
   * qualquer um deles até agora), e há um argumento honesto para virar "—"
   * como o resto do produto faz com dado não medido — mas mudar isso mudaria
   * a folha JÁ PUBLICADA sem pedido explícito do dono, então não foi feito
   * aqui. Se um dia a resposta for "sim, muda", muda nos DOIS consumidores
   * ao mesmo tempo (é por isso que a conta está aqui, e não duplicada).
   *
   * 🔴 Emenda "opção A" ao ADR-0053 (dono, 2026-09-27): com candidatura
   * anulada no município, o denominador é o dos **votos em disputa** — a soma
   * só de quem COMPETE —, a mesma base que o produtor passa a usar para a UF.
   * E a anulada recebe `null`: a tela não mostra o percentual dela (ela
   * aparece só com os votos). `null` e não `0`/`NaN` de propósito — o tipo
   * obriga cada consumidor a decidir o que fazer, em vez de um `0,0%` ou um
   * "—" escaparem para a tela. Sem anulada, o total e os números são os de
   * sempre.
   */
  pct: number | null;
  /**
   * ADR-0053 / RF-213 — destinação do voto da candidatura NA UF
   * (`EdgeUfCandidate.destino`). Ausente ⇒ compete. Só etiqueta e ordem: o
   * líder do município é o `m.lider` do Blob, que o produtor calcula.
   */
  destino?: EdgeDestinoVoto;
}

/**
 * Todos os candidatos de `EdgeUfMunicipio.votos_reportados`, ordenados por
 * votos desc (tie-break por `id` asc — estabilidade, mesma regra de sempre).
 * Sem corte: o CALLER decide se mostra tudo (a folha) ou só o topo (o balão
 * do mapa, `.slice(0, 3)`).
 *
 * `votos_reportados` vazio (nenhum boletim chegou ainda para este município)
 * devolve `[]` — nunca uma linha com voto fabricado.
 *
 * Identidade (nome/partido/cor) resolvida contra `candidatos`, a lista da
 * PRÓPRIA UF (`EdgePayloadUf.candidatos`) — nunca `national.candidatos`: só a
 * lista da UF garante `sqcand` em TODO cargo (ADR-0042 item 2, RF-144). O
 * bloco nacional não tem essa garantia fora do cargo 1 — em Governador e
 * Senador ele é a união de 27 corridas sob o mesmo espaço de `id` (RF-145).
 *
 * ⚠️ **Este denominador (`Σ votos_reportados`) não é uma base inventada para
 * esta função** — é, por definição do próprio EA20, a MESMA soma que
 * `pct_atual` usa em todo o resto do produto na base "votáveis": `votaveis`
 * (`v.vvc`, "votos a votáveis concorrentes") É a soma dos votos de todos os
 * candidatos concorrentes de uma zona (`api/model/extrapolation.py:344`,
 * `pct_atual_v = sum_vap / sum_vvc`, onde `sum_vvc` vem do MESMO campo que
 * `_extract_zone_candidatos` obtém somando `cand[].vap` candidato a
 * candidato). `votos_reportados` aqui é exatamente essa segunda forma,
 * agregada por `fetch_municipio_aggregates` (`api/model/project.py`) sobre os
 * pares (município, zona) do MUNICÍPIO, em vez da UF inteira — mesma
 * identidade, subconjunto diferente de zonas. É por isso que "Parcial" na
 * folha, no balão do mapa municipal e `pct_atual` no mapa nacional podem
 * conviver na mesma tela sob o mesmo nome sem serem números de universos
 * diferentes.
 *
 * Nunca usa `EdgeUfMunicipio.eleitores` (eleitorado APTO) nem qualquer
 * derivado de comparecimento como denominador — seria a base "comparecimento"
 * sob o rótulo "votáveis" (ADR-0020: as duas não são intercambiáveis).
 */
export function votosPorCandidatoMunicipio(
  municipio: EdgeUfMunicipio,
  candidatos: EdgeUfCandidate[],
): MunicipioVotoCandidato[] {
  const porId = new Map(candidatos.map((c) => [c.id, c] as const));
  const entradas = Object.entries(municipio.votos_reportados ?? {});
  // Emenda "opção A" — o denominador soma só quem COMPETE (ver a docstring de
  // `pct`). `compete` com o destino DA UF; ausente ⇒ compete.
  const total = entradas.reduce(
    (acc, [rawId, v]) => acc + (compete(porId.get(Number(rawId))) && Number.isFinite(v) ? v : 0),
    0,
  );

  // ADR-0053 / RF-213 — anulada no fim, depois do ranking por votos.
  const ordenados = entradas
    .map(([rawId, votos]) => {
      const id = Number(rawId);
      const c = porId.get(id);
      const v = Number.isFinite(votos) ? votos : 0;
      return {
        id,
        nome: c ? nomeExibicao(c.nome, c.sqcand) : `Candidato ${id}`,
        partido: c?.partido,
        // Ver a docstring do campo: a cor sai da SIGLA, nunca de `c.cor`.
        cor: colorForParty(c?.partido),
        votos: v,
        pct: !compete(c) ? null : total > 0 ? (v / total) * 100 : 0,
        ...(c?.destino ? { destino: c.destino } : {}),
      };
    })
    .sort((a, b) => b.votos - a.votos || a.id - b.id);
  return anuladasAoFim(ordenados);
}
