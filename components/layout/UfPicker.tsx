"use client";

/**
 * components/layout/UfPicker.tsx
 *
 * O seletor de UF do protótipo — botão sobreposto ao canto superior direito do
 * mapa (`ui_kits/atlas-menna/App.jsx:316`) que abre uma `<Sheet>` com kicker
 * "Escolher UF" e a grade das 27 unidades federativas ordenadas por nome
 * (`App.jsx:362-369`).
 *
 * ## Uma divergência que é melhoria, não porte
 *
 * No kit **só São Paulo é clicável** — os outros 26 nascem `disabled`, com a
 * nota "no protótipo, candidaturas estaduais estão carregadas apenas para São
 * Paulo". Aqui as 27 são links reais: a rota de UF existe para todas.
 *
 * São `<Link>` do `next/link`, não `<button onClick={router.push}>`, por dois
 * motivos que se somam:
 *   - **a moldura do mapa não pode desmontar.** O ADR-0033 § 1 põe o mapa num
 *     `layout.tsx` de grupo de rotas exatamente para ele sobreviver à troca de
 *     UF. Navegação client-side do App Router preserva o segmento de layout;
 *     um `window.location` recarregaria a página e destruiria a instância
 *     MapLibre — que é o custo que o ADR existe para evitar.
 *   - **é um link, e o usuário sabe disso.** Botão do meio, Cmd+clique, "abrir
 *     em nova aba", pré-visualização de destino na barra de status: tudo isso
 *     vem de graça com `<a href>` e teria que ser reimplementado (mal) com um
 *     `onClick`.
 *
 * ## Forma da folha
 *
 * `<Sheet>` na variante MODAL (bottom sheet com scrim), não na `side`. O kit
 * usa `side={desktop}` — cartão flutuante ancorado ao mapa no desktop. Aqui:
 *   - a variante `side` é `position: absolute` e não-modal; ancorada dentro da
 *     moldura do mapa ela cobriria o próprio mapa que o leitor está usando
 *     para se localizar, e ficaria sem scrim para dizer que está por cima;
 *   - a folha do MUNICÍPIO (`<MunicipioExplorer>`) já é modal nos dois
 *     breakpoints desde S07/Bloco 2. Duas folhas com comportamento diferente
 *     na mesma tela custam mais do que a fidelidade ao kit rende.
 * O `<Sheet>` modal já resolve Esc, foco de entrada, foco de retorno e
 * `aria-modal` (WCAG 2.1.2 / RNF-022).
 *
 * ## Alvo de toque
 *
 * O botão é `<Button size="md">` = `--tap-min` (44px). `size="sm"` (32px) é
 * densidade de painel no desktop e não serve como alvo primário sobre o mapa,
 * que é a superfície mais tocada no mobile. Cada UF da grade tem 44px pela
 * mesma razão.
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/atoms/controls/Button";
import { ufsPorNome } from "@/components/atoms/maps/_shared";
import { Sheet } from "@/components/atoms/overlays/Sheet";
import { cargoFromToken, cargoInfo } from "@/lib/config/cargos";
import { ariaRessalvaVagas, margemSegundaVaga } from "@/lib/utils/margem-senado";
import { type UfPickerCargo, ufHref } from "@/lib/utils/uf-href";

// `UfPickerCargo` e `ufHref` passaram a morar em `lib/utils/uf-href.ts` em
// 2026-09-19 — módulo puro, sem React, para que o chunk lazy do MapLibre possa
// importar o VALOR `ufHref` sem arrastar `<Button>`/`<Sheet>`/`next/link`
// junto (RNF-007b; mesmo precedente de `lib/utils/margem-senado.ts`, e a razão
// está escrita lá). Re-exportados daqui para que nenhum dos call-sites
// existentes precisasse trocar de import.
export { type UfPickerCargo, ufHref };

export interface UfPickerProps {
  /**
   * Qual corrida está aberta — decide o destino de cada UF:
   * `pres` → `/uf/<SIGLA>`, `gov` → `/uf/<SIGLA>/governador`,
   * `sen` → `/uf/<SIGLA>/senador`.
   */
  cargo: UfPickerCargo;
  /** UF corrente, quando a rota já é de UF. Ganha `aria-current="page"`. */
  atual?: string | null;
}

/** Título da folha "Escolher UF" — um por cargo, mesmo motivo do `Record` acima. */
const UF_PICKER_TITLE: Record<UfPickerCargo, string> = {
  pres: "Presidente",
  gov: "Governador",
  sen: "Senador",
};

/**
 * Rótulo qualificado de margem em Senado (RF-104) — **uma única string**,
 * reaproveitada em toda superfície que precisa nomear a margem de 2ª vaga:
 * a `<Figure>` da ficha/`<MapViewToggle>` (via `MARGEM_LABEL` abaixo) e o
 * seletor de view do mapa (`NationalChoroplethMap.tsx`, `viewLabelForCargo`).
 *
 * 🔴 2026-09-18 (3ª rodada) — até aqui existiam DUAS strings para o mesmo
 * conceito ("Margem projetada 1º→2º" aqui, "Margem 1º→2º" no mapa), e as
 * duas descreviam o NÚMERO ERRADO: `row.margem_projetada` é sempre 1º−2º,
 * mas a margem que decide a corrida de Senado é a do 2º para o 3º
 * (`docs/specs/016-senador/spec.md:125-133`). Rotular honestamente o número
 * errado não bastava — o número exibido também muda, para
 * `margemSegundaVaga` (abaixo). O texto agora nomeia o que É exibido, não o
 * que deixou de ser.
 */
export const MARGEM_2A_VAGA_LABEL = "Margem para a 2ª vaga";

/**
 * Rótulo do número de margem exibido — **um por cargo, e aqui por ser o mesmo
 * conceito em superfícies diferentes.**
 *
 * Em Presidente e Governador (1 vaga) `row.margem_projetada` (1º−2º) É a
 * margem da disputa, e "Margem projetada" basta. Em Senador (2 vagas) o
 * número exibido é `margemSegundaVaga` (2º−3º, ver abaixo) — a distância que
 * de fato decide a última cadeira (RF-104).
 *
 * 🔴 Por que neste arquivo e não ao lado de cada uso: em 2026-09-18 (2ª
 * rodada) o rótulo foi qualificado no seletor do mapa
 * (`NationalChoroplethMap`) e **não** na folha de estado (`StateResultSheet`),
 * que mostra o MESMO número — a mesma ambiguidade vazou pela segunda
 * superfície porque cada uma escrevia o próprio texto. Com um `Record` total,
 * um cargo novo quebra a COMPILAÇÃO e as duas superfícies mudam juntas ou não
 * mudam.
 */
const MARGEM_LABEL: Record<UfPickerCargo, string> = {
  pres: "Margem projetada",
  gov: "Margem projetada",
  sen: MARGEM_2A_VAGA_LABEL,
};

/** Rótulo do número de margem exibido na corrente corrida. Ver `MARGEM_LABEL`. */
export function margemLabel(cargo: UfPickerCargo): string {
  return MARGEM_LABEL[cargo];
}

/**
 * `margemSegundaVaga` e `ariaRessalvaVagas` (importadas acima) vivem em
 * `lib/utils/margem-senado.ts`, não aqui — leia o docstring daquele arquivo
 * antes de "simplificar" isto de volta para uma função local. Resumo: são as
 * duas funções que `_NationalChoroplethMapImpl.tsx` (chunk lazy do MapLibre,
 * RNF-007b, 14,7 KiB de margem no orçamento) precisa importar em RUNTIME, e
 * este arquivo é `"use client"` com `<UfPicker>`/`<UfPickerGrid>` no MESMO
 * módulo — puxando `<Button>`/`<Sheet>`/`next/link` juntos se o import fosse
 * daqui. Re-exportadas abaixo para os consumidores que NÃO estão no chunk
 * lazy (`StateResultSheet.tsx`, `NationalChoroplethMap.tsx`,
 * `NationalMapBlock.tsx` — todos eager, sem risco de orçamento) continuarem
 * importando de `@/components/layout/UfPicker`, sem precisar saber da
 * separação.
 */
export { ariaRessalvaVagas, margemSegundaVaga };

/**
 * O número de margem a exibir/colorir, por cargo (RF-104). Em Senador é
 * `margemSegundaVaga` (2º→3º); nos demais é `row.margem_projetada`, que o
 * payload já traz pronta e que, com 1 vaga só, É a margem da disputa.
 *
 * Um `Record`/`switch` sobre `UfPickerCargo` teria três ramos idênticos para
 * pres/gov; a checagem única `cargo === "sen"` já é total sobre o tipo (o
 * `else` cobre exatamente os outros dois) e não corre o risco do bug de
 * conversor de cargo de 3 vias que esta base já pagou — aqui só há DUAS
 * saídas possíveis, não uma por cargo.
 */
export function margemParaExibir(
  cargo: UfPickerCargo,
  row: Parameters<typeof margemSegundaVaga>[0] & { margem_projetada: number },
): number {
  return cargo === "sen" ? margemSegundaVaga(row) : row.margem_projetada;
}

/**
 * Quantas vagas esta corrida elege por UF — lida da tabela canônica
 * (`lib/config/cargos.ts`), nunca um literal solto no meio de um componente
 * de UI. RF-105 precisa do número exato (hoje 2, só em Senado) para marcar a
 * quantidade certa de linhas como ocupantes de vaga.
 */
export function vagasPorCargo(cargo: UfPickerCargo): number {
  return cargoInfo(cargoFromToken(cargo)).vagasPorUf ?? 1;
}

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  minHeight: "var(--tap-min)",
  padding: "0 var(--space-3)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "var(--radius-sm)",
  font: "var(--type-body-sm)",
  color: "var(--text-primary)",
  textDecoration: "none",
};

const ITEM_ATUAL_STYLE: React.CSSProperties = {
  ...ITEM_STYLE,
  background: "var(--surface-inverse)",
  color: "var(--text-inverse)",
  borderColor: "var(--surface-inverse)",
};

/**
 * A grade em si, separada do botão por um motivo de teste: o `<Sheet>` só
 * existe depois de um clique, e a suíte unitária renderiza por
 * `renderToStaticMarkup`, que não hidrata nem dispara eventos. Exportando a
 * grade, o contrato dela (27 destinos, ordem, `href`, alvo de toque) é medido
 * sem browser; a ABERTURA fica para o e2e.
 */
export function UfPickerGrid({
  cargo,
  atual,
  onNavigate,
}: {
  cargo: UfPickerCargo;
  atual?: string | null;
  onNavigate?: () => void;
}) {
  const ufs = ufsPorNome();
  const atualUpper = atual?.toUpperCase() ?? null;

  return (
    <nav aria-label="Unidades federativas">
      <ul
        data-testid="uf-picker-grid"
        className="grid"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-2)",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        }}
      >
        {ufs.map((uf) => {
          const eAtual = uf.sigla === atualUpper;
          return (
            <li key={uf.sigla}>
              <Link
                href={ufHref(cargo, uf.sigla)}
                data-testid="uf-picker-item"
                data-sigla={uf.sigla}
                aria-current={eAtual ? "page" : undefined}
                onClick={onNavigate}
                style={eAtual ? ITEM_ATUAL_STYLE : ITEM_STYLE}
              >
                <span className="min-w-0 truncate">{uf.nome}</span>
                <span className="flex-none" style={{ font: "var(--type-figure-sm)" }}>
                  {uf.sigla}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function UfPicker({ cargo, atual }: UfPickerProps) {
  const [aberto, setAberto] = useState(false);
  const atualUpper = atual?.toUpperCase() ?? null;

  return (
    <>
      <Button
        variant="secondary"
        size="md"
        aria-expanded={aberto}
        onClick={() => setAberto(true)}
        // A moldura é `--surface-page`: sem fundo próprio o botão sumiria
        // contra o mapa. Mesma razão do `background` que o kit crava no botão
        // equivalente (`App.jsx:316`), aqui via token.
        style={{ background: "var(--surface-card)" }}
      >
        {atualUpper ?? "Escolher UF"}
      </Button>

      {aberto ? (
        <Sheet
          open
          onClose={() => setAberto(false)}
          kicker="Escolher UF"
          title={UF_PICKER_TITLE[cargo]}
          headingLevel={2}
        >
          <UfPickerGrid cargo={cargo} atual={atualUpper} onNavigate={() => setAberto(false)} />
          <p
            style={{
              margin: "var(--space-3) 0 0",
              font: "var(--type-body-sm)",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            As 27 unidades federativas, em ordem alfabética de nome. Abrir uma delas troca a página
            sem recarregar o mapa.
          </p>
        </Sheet>
      ) : null}
    </>
  );
}
