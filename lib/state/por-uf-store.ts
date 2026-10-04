/**
 * lib/state/por-uf-store.ts
 *
 * As linhas `por_uf` do payload NACIONAL de cada cargo, como a moldura do mapa
 * (`components/layout/PersistentMapFrame.tsx`) as recebeu na última busca.
 *
 * ## Por que existe (2026-10-04, dono)
 *
 * A folha do município (`<MunicipioExplorer>`) passou a mostrar quem está
 * MATEMATICAMENTE eleito na corrida do estado (`EdgeUfRow.eleitos_definidos`,
 * lido por `lib/utils/eleitos-definidos.ts`). Esse campo só existe no payload
 * nacional — o `EdgePayloadUf` que a página da UF lê no servidor não o traz.
 *
 * Duas saídas foram pesadas:
 *
 *   - ler o payload nacional também no servidor, em cada página de UF — uma
 *     leitura de Edge Config A MAIS por visita, justamente no caminho com dado,
 *     que as três rotas documentam como "nenhuma leitura nova" (RNF-002);
 *   - reaproveitar o payload que a moldura do mapa JÁ busca no cliente a cada
 *     60 s (montada pelo `layout.tsx` dos grupos `(pres)`, `(gov)` e `(sen)`,
 *     em todas as rotas, inclusive as de UF) — custo de rede zero.
 *
 * Ficou a segunda. A moldura publica aqui o que recebeu; a folha lê.
 *
 * ## Chave por cargo, nunca "o último payload"
 *
 * Ao trocar de grupo (Governador → Presidente) a moldura remonta com outro
 * cargo, mas a store é de módulo e sobrevive. Sem a chave, a folha do
 * Presidente leria por alguns segundos os eleitos do Governador — os `id`
 * são números de urna e colidem entre corridas. Com a chave, o pior caso é
 * ler o `por_uf` do MESMO cargo de minutos atrás, e `eleitos_definidos` só
 * cresce durante a noite: atraso é omissão, nunca afirmação falsa.
 *
 * Zustand porque a moldura e a folha já o carregam (`dado-freshness-store`,
 * `municipio-sheet-store`): nenhum pacote novo no chunk.
 */

import { create } from "zustand";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import type { UfPickerCargo } from "@/lib/utils/uf-href";

interface PorUfState {
  /** `por_uf` cru do último payload nacional válido, por cargo da moldura. */
  porCargo: Partial<Record<UfPickerCargo, readonly EdgeUfRow[]>>;
  /** Chamado pela moldura depois de cada busca cujo `cargo` confere. */
  publicarPorUf: (cargo: UfPickerCargo, rows: readonly EdgeUfRow[]) => void;
}

export const usePorUfStore = create<PorUfState>((set) => ({
  porCargo: {},
  publicarPorUf: (cargo, rows) =>
    set((s) => (s.porCargo[cargo] === rows ? s : { porCargo: { ...s.porCargo, [cargo]: rows } })),
}));
