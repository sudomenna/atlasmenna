/**
 * lib/utils/margem-senado.ts
 *
 * As duas funções de RF-104/RF-106 (spec 016) que precisam existir SEM
 * dependência de UI — `_NationalChoroplethMapImpl.tsx` (o chunk MapLibre,
 * `next/dynamic({ ssr: false })`, ADR-0010) importa as duas diretamente
 * daqui, não de `components/layout/UfPicker.tsx`.
 *
 * 🔴 Por que este arquivo existe separado de `UfPicker.tsx` (2026-09-18, 3ª
 * rodada) — `UfPicker.tsx` é `"use client"` e no MESMO módulo define os
 * componentes `<UfPicker>`/`<UfPickerGrid>`, que importam `<Button>`,
 * `<Sheet>`, `next/link` e `ufsPorNome`. `_NationalChoroplethMapImpl.tsx` é
 * o chunk lazy do MapLibre e está a **14,7 KiB** do teto de 300 KiB
 * (RNF-007b, medido pelo `a11y-perf-auditor` em 2026-09-18: 285,3 KiB).
 * Importar um valor em RUNTIME de `UfPicker.tsx` (mesmo que só duas funções
 * puras) arrisca puxar o módulo inteiro — componentes e dependências — para
 * dentro do chunk que menos tem margem no orçamento inteiro do produto.
 * `UfPicker.tsx` continua sendo a fonte pública destas funções para quem já
 * as importa de lá (`StateResultSheet.tsx`, `NationalChoroplethMap.tsx`,
 * `NationalMapBlock.tsx` — todos fora do chunk lazy, sem risco de
 * orçamento) via `export { ... } from "@/lib/utils/margem-senado"` — uma
 * fonte, dois pontos de import, nunca duas implementações.
 */

import type { UfPickerCargo } from "@/components/layout/UfPicker";
import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { queCompetem } from "@/lib/utils/destino-voto";

/**
 * A margem que decide a 2ª vaga do Senado — 2º colocado menos o 3º (RF-104),
 * nunca 1º menos 2º. Fonte: `EdgeUfRow.top_candidatos`, ordenado por
 * `pct_projetado` desc (ver docstring do campo em `lib/edge-config/types.ts`)
 * — é o único par (2º, 3º) que o payload nacional carrega; não existe um
 * `margem_2_3` pronto porque `api/model/project.py` só agrega o duelo
 * top-2 (`margem_atual`/`margem_projetada`).
 *
 * `NaN` — não `0`, não `null` — quando a UF tem menos de 3 candidatos no
 * top-3: a margem de 2ª vaga simplesmente NÃO EXISTE nesse caso (decisão do
 * dono, 14/09: "não sabemos" e "medimos zero" são estados diferentes).
 * `NaN` é o sentinela que o resto da base já usa para medição ausente —
 * `formatPp`/`formatPercent` tratam `NaN` como "—" (`lib/utils/format.ts`), e
 * `intensityLevelForMargin` (`lib/utils/party-color.ts`) trata `NaN` como
 * nível 1, a leitura mais conservadora ("apertado", nunca "decidido").
 */
export function margemSegundaVaga(row: {
  top_candidatos: ReadonlyArray<{ pct: number; destino?: EdgeDestinoVoto }>;
}): number {
  // ADR-0053 / RF-213 — 2º e 3º entre quem DISPUTA a vaga. Uma anulada no
  // corte não ocupa vaga, então não é nem a "2ª vaga" nem a "1ª fora". Sem
  // anulada, `queCompetem` devolve a mesma lista, na mesma ordem.
  const disputam = queCompetem(row.top_candidatos);
  const segundo = disputam[1];
  const terceiro = disputam[2];
  if (segundo == null || terceiro == null) return Number.NaN;
  return segundo.pct - terceiro.pct;
}

/**
 * Ressalva de acessibilidade das "2 vagas" no NOME ACESSÍVEL do mapa nacional
 * — RF-106 + RNF-025 (`docs/nfr/accessibility.md:16`) + WCAG SC 4.1.2 (nome
 * acessível tem de corresponder ao que a superfície apresenta).
 *
 * 🔴 2026-09-18 (achado do `a11y-perf-auditor`) — o cabeçalho visual da
 * moldura já anuncia "· 2 vagas" (`PersistentMapFrame.tsx`), mas é um
 * elemento IRMÃO do mapa, não amarrado por `aria-labelledby`/`aria-describedby`
 * a nenhuma das camadas com nome acessível. Quem pula direto para o mapa
 * (atalho comum de leitor de tela) nunca ouvia a ressalva sob a qual o dono
 * aceitou pintar o mapa pelo 1º colocado — ouvia, no lugar, a mesma
 * linguagem de "vencedor"/"líder" de 1 vaga que Presidente e Governador
 * usam.
 *
 * `Record` total por `UfPickerCargo`: string vazia para os cargos de 1 vaga
 * (nada a ressalvar — `pres`/`gov` continuam byte a byte iguais a antes desta
 * mudança), sufixo para Senado. Usada nas DUAS camadas internas do mapa que
 * carregam `aria-label` em texto (`role="region"` em
 * `NationalChoroplethMap.tsx`, `role="img"` em
 * `_NationalChoroplethMapImpl.tsx`) — uma função, não duas strings escritas
 * à mão: foi exatamente ter duas fontes que atrasou a correção da margem em
 * uma rodada inteira (RF-104 nasceu qualificado só no seletor do mapa, não na
 * ficha de estado).
 *
 * O texto não afirma nada sobre COMO o mapa pinta (nem em fase pré, nem
 * sobre parcial/projeção) — só o fato estrutural que vale em toda tela de
 * Senador (RF-106: "qualquer tela", sem exceção de fase).
 */
const ARIA_RESSALVA_VAGAS: Record<UfPickerCargo, string> = {
  pres: "",
  gov: "",
  sen: " — Senado: 2 vagas por estado",
};

/** Sufixo de ressalva de vagas para `aria-label`. Ver `ARIA_RESSALVA_VAGAS`. */
export function ariaRessalvaVagas(cargo: UfPickerCargo): string {
  return ARIA_RESSALVA_VAGAS[cargo];
}
