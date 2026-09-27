/**
 * lib/utils/rank-parcial.ts
 *
 * Ponto ÚNICO da derivação do rank de candidaturas — **nas duas bases**.
 *
 * Extraído em 2026-09-17 (spec 020, passo 0b) de três cópias byte-idênticas
 * que viviam em `app/(pres)/uf/[sigla]/page.tsx`,
 * `app/(gov)/uf/[sigla]/governador/page.tsx` e
 * `app/(sen)/uf/[sigla]/senador/page.tsx`.
 *
 * Ganhou a segunda base em 2026-09-20, por decisão do dono: **tudo acompanha
 * a base ativa** do controle "Parcial / Projeção" — a lista, a numeração, o
 * destaque de margem e a ocupação de vaga. Até então a home ordenava por
 * projeção (a ordem que o produtor publica) e as três rotas de UF ordenavam
 * por parcial, e nenhuma das duas reagia ao controle.
 *
 * Determinismo (constituição § 6): funções puras, sem `Date`, sem random.
 */

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { anuladasAoFim } from "@/lib/utils/destino-voto";

/**
 * O mínimo que uma candidatura precisa ter para ser ordenável.
 *
 * Estrutural, e não `EdgeUfCandidate`, porque os dois consumidores têm shapes
 * diferentes: as rotas de UF passam `EdgeUfCandidate` (que tem `ci95` e
 * companhia) e o `<ResultPanel>` passa `ResultPanelCandidate` (um `Pick` de
 * `EdgeCandidate`). O genérico devolve o MESMO tipo que entrou, então quem
 * chama não perde nenhum campo pelo caminho.
 */
export interface RankavelPorBase {
  id: number;
  pct_atual: number;
  pct_projetado: number;
  /**
   * ADR-0053 / RF-213 — lido só por {@link ordensPorBase}, que põe a
   * candidatura `"anulado"` no fim das DUAS ordens. Ausente ⇒ compete.
   */
  destino?: EdgeDestinoVoto;
}

/**
 * DERIVAÇÃO DO RANK NA BASE **PARCIAL** — o resultado APURADO.
 *
 * `EdgeUfCandidate` (interface em `lib/edge-config/types.ts`) é, por
 * definição, um subset do `EdgeCandidate` nacional: tem `votos_atuais`,
 * `pct_atual`, `pct_projetado` e `ci95`, mas **não tem `rank`**. Ou seja: na
 * UF não há rank publicado, e ordenar é derivá-lo.
 *
 * Critério primário: **`pct_atual` desc** — o resultado APURADO, que é o
 * número que o leitor confere contra o boletim do TSE, e é sobre `pct` que o
 * protótipo ordena (`ui_kits/atlas-menna/App.jsx:22`, `rows[0]`/`rows[1]`).
 *
 * Dois desempates, e nenhum é cosmético:
 *
 *   1. `pct_projetado` desc. Antes da primeira zona apurada TODOS os
 *      `pct_atual` valem 0 e o critério primário não separa ninguém; sem este
 *      desempate a ordem cairia na do array de origem e a página abriria a
 *      noite eleitoral com um "líder" arbitrário — na numeração, na margem e
 *      na barra. `pct_projetado` carrega o prior pré-eleitoral e é a única
 *      leitura disponível nesse instante. (Era o critério primário até 09/09.)
 *   2. `id` asc — desempate estável final, a mesma convenção do payload
 *      nacional (`EdgeNational.candidatos`).
 *
 * 🔴 **A spec 020 depende deste ser o PONTO ÚNICO.** O produtor Python porta
 * este mesmo comparador (`ordenar_por_parcial` / `_chave_parcial` em
 * `api/model/project.py`) para escolher as 4 candidaturas que entram no
 * gráfico de evolução da apuração, e
 * `tests/unit/model/test_serie_por_candidato.py` lê ESTE arquivo e exige que
 * os três critérios continuem aqui, nesta ordem e nestas direções. Se o
 * critério mudar aqui e não lá (ou o contrário), o gráfico passa a mostrar um
 * conjunto de candidaturas diferente do que a tabela ranqueia logo acima dele
 * — divergência silenciosa, sem erro em lugar nenhum. Qualquer alteração de
 * critério tem que ser feita nos dois lugares no mesmo commit.
 */
export function rankByParcial<T extends RankavelPorBase>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort((a, b) => {
    if (b.pct_atual !== a.pct_atual) return b.pct_atual - a.pct_atual;
    if (b.pct_projetado !== a.pct_projetado) return b.pct_projetado - a.pct_projetado;
    return a.id - b.id;
  });
}

/**
 * DERIVAÇÃO DO RANK NA BASE **PROJEÇÃO** — o que o modelo diz que termina.
 *
 * `pct_projetado` desc → `id` asc. **Dois critérios, não três**, e a ausência
 * do terceiro é a decisão que importa: este é o porte literal da ordenação
 * que o produtor já usa para gravar `EdgeCandidate.rank`
 * (`api/model/project.py`: `sorted(..., key=lambda c: (-point_by_cand[c], c))`
 * e o `rank_by_cand` logo abaixo). Acrescentar um desempate por `pct_atual`
 * aqui seria "mais simétrico" e produziria, num empate de projeção, uma ordem
 * de exibição que DISCORDA do `rank` que veio no payload — na home, onde o
 * `rank` existe, a numeração e a posição da linha passariam a se contradizer.
 *
 * Por isso o critério é o do produtor, não o espelho do de cima.
 */
export function rankByProjecao<T extends RankavelPorBase>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort((a, b) => {
    if (b.pct_projetado !== a.pct_projetado) return b.pct_projetado - a.pct_projetado;
    return a.id - b.id;
  });
}

/** As duas ordens da mesma corrida, mais o índice de cada candidatura em cada. */
export interface OrdensPorBase<T> {
  /** A lista na base **parcial** (`rankByParcial`). */
  parcial: T[];
  /** A lista na base **projeção** (`rankByProjecao`). */
  proj: T[];
  /** `id` → índice 0-based na base parcial. */
  posParcial: ReadonlyMap<number, number>;
  /** `id` → índice 0-based na base projeção. */
  posProj: ReadonlyMap<number, number>;
}

/**
 * As duas ordens de uma vez, com os índices já indexados por `id`.
 *
 * Existe porque o `<ResultPanel>` precisa das DUAS ao mesmo tempo e precisa,
 * para cada linha, saber a posição dela em cada base — é isso que vira o
 * número à esquerda, a posição visual (`order` do CSS), o corte do colapso e
 * a ocupação de vaga. Fazer isso com dois `indexOf` por linha seria O(n²) num
 * caminho que roda em 54 rotas pré-renderizadas.
 *
 * `id` como chave, e não a referência do objeto: `rankByParcial` devolve as
 * MESMAS referências (só reordena), mas depender disso amarraria o consumidor
 * a um detalhe de implementação que um `map()` inocente quebraria em silêncio.
 */
export function ordensPorBase<T extends RankavelPorBase>(
  candidatos: readonly T[],
): OrdensPorBase<T> {
  // 🔴 ADR-0053 / RF-213 (decisão do dono, 2026-09-27): a candidatura de voto
  // `"anulado"` continua na lista, com o percentual oficial, mas vai para o
  // FIM das duas ordens — ela não disputa a vaga, e a posição 1 da lista é
  // lida como "quem lidera". A partição fica AQUI, depois dos comparadores, e
  // não dentro de `rankByParcial`/`rankByProjecao`: aqueles dois são portados
  // critério a critério pelo produtor Python (ver a docstring de
  // `rankByParcial`), e um critério novo lá exigiria mexer no gráfico de
  // evolução no mesmo commit. Sem anulada na lista, a ordem é a de sempre.
  const parcial = anuladasAoFim(rankByParcial(candidatos));
  const proj = anuladasAoFim(rankByProjecao(candidatos));
  const posParcial = new Map<number, number>();
  const posProj = new Map<number, number>();
  parcial.forEach((c, i) => {
    posParcial.set(c.id, i);
  });
  proj.forEach((c, i) => {
    posProj.set(c.id, i);
  });
  return { parcial, proj, posParcial, posProj };
}
