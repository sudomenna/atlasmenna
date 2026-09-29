/**
 * lib/utils/bancada.ts — a ordem de exibição da bancada, num lugar só.
 *
 * `ordenarBancada` nasceu como função local de
 * `app/(dep)/deputado-federal/page.tsx` e subiu para cá em 2026-09-18, quando
 * o hemiciclo (`components/blocks/CamaraHemiciclo.tsx`) passou a precisar da
 * **mesma** ordem.
 *
 * 🔴 Por que mover em vez de escrever uma segunda: a cunha do hemiciclo e a
 * linha da lista precisam corresponder. Com duas implementações, a quarta
 * cunha da esquerda e a quarta linha da lista passariam a ser agremiações
 * diferentes no primeiro empate de cadeiras — e ninguém notaria, porque cada
 * uma continuaria internamente consistente. É a classe de divergência que só
 * aparece na noite da apuração.
 *
 * Nada mais mudou: mesma regra, mesma justificativa, mesmos testes.
 */

import type { EdgeAgremiacaoBancada } from "@/lib/edge-config/types";

/**
 * Ordem de exibição da bancada, com desempate explícito (constituição § 6):
 * cadeiras desc → sigla asc. É a mesma regra que o produtor do payload aplica
 * (design 017 § D5), reaplicada aqui de propósito — duas agremiações empatadas
 * em cadeiras trocariam de lugar entre ciclos se a ordem dependesse de uma
 * estabilidade que ninguém garantiu.
 *
 * 🔴 **É ordem por TAMANHO DE BANCADA, e o hemiciclo a reusa como está.** Ela
 * não afirma nada sobre posição ideológica, e o desenho não pode passar a
 * afirmar: a ORDEM desta lista é por tamanho; a classificação editorial vive
 * só na camada de etiquetas (spec 024, ADR-0059), nunca decide ordem
 * (constituição § 2 (e)) e tem desenho próprio (a visão por bloco da spec 025).
 * Um plenário ordenado por espectro leria como informação uma coisa que esta
 * lista não mede. Ver o `<desc>` do `<CamaraHemiciclo>`, que diz isso ao leitor
 * de tela em texto.
 *
 * **Genérica desde 2026-09-29 (spec 023, design § D4).** O hemiciclo do Senado
 * ordena os partidos pela MESMA regra — total de cadeiras desc → sigla asc —, e
 * a função passou a aceitar qualquer linha com `cadeiras` e `sigla` em vez de
 * uma segunda implementação. Corpo, regra e chamadores da Câmara: inalterados.
 */
export function ordenarBancada<T extends Pick<EdgeAgremiacaoBancada, "cadeiras" | "sigla">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (b.cadeiras !== a.cadeiras) return b.cadeiras - a.cadeiras;
    return a.sigla.localeCompare(b.sigla, "pt-BR");
  });
}
