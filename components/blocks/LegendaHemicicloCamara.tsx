/**
 * components/blocks/LegendaHemicicloCamara.tsx — a legenda compacta do
 * plenário da Câmara: bolinha + sigla + nº de cadeiras, logo sob o desenho
 * (spec 008, RF-294; decisão do dono de 03/10).
 *
 * Existe para o realce por agremiação (`<RealceHemiciclo atributo="data-cod">`)
 * ter uma legenda AO LADO do plenário — a lista de agremiações da página
 * (`#bancada-agremiacoes`) mora em outro painel, longe. Cada `<li>` leva o
 * `data-cod` das cadeiras dela.
 *
 * - **Ordem**: `ordenarBancada`, só quem tem cadeira — a mesma das cunhas do
 *   `<CamaraHemiciclo>` (`assentosDaBancada` pula `cadeiras === 0`).
 * - **Cor**: `textForParty(sigla_lider)`, a mesma de `pinturaDe` nas cadeiras
 *   (marcador de identidade, RNF-035).
 * - **Sigla INTEIRA**: exceção do dono (19/09) para as capas de Deputados —
 *   nenhum `siglaExibicao(...)` aqui.
 * - **`aria-hidden`**: o equivalente textual canônico do plenário continua
 *   sendo `#bancada-agremiacoes` (alvo do `aria-describedby` do SVG). Ler as
 *   mesmas siglas e números duas vezes seria ruído (constituição § 4).
 *
 * Server Component, zero JavaScript. Peso: o Next escreve cada atributo duas
 * vezes (HTML + payload RSC), e em produção uma classe de módulo CSS vira
 * `LegendaHemicicloCamara-module__xxxxxx__nome` (~45 B). Por isso UMA classe,
 * na `<ul>`, e as linhas estilizadas por posição (bolinha · sigla · número);
 * o único `style` inline é a cor da bolinha, que é por agremiação. Teto em
 * `tests/unit/components/LegendaHemicicloCamara.test.tsx`.
 */

import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { ordenarBancada } from "@/lib/utils/bancada";
import { textForParty } from "@/lib/utils/party-color";

import styles from "./LegendaHemicicloCamara.module.css";

/** As agremiações da legenda, na ordem das cunhas. */
export function agremiacoesDaLegenda(bancada: EdgeBancadaNacional) {
  return ordenarBancada(bancada.por_agremiacao).filter((a) => Math.trunc(a.cadeiras) > 0);
}

export function LegendaHemicicloCamara({ bancada }: { bancada: EdgeBancadaNacional }) {
  const linhas = agremiacoesDaLegenda(bancada);
  if (linhas.length === 0) return null;
  return (
    <ul
      aria-hidden="true"
      data-testid="camara-hemiciclo-legenda-agremiacoes"
      className={styles.lista}
    >
      {linhas.map((agr) => (
        <li key={agr.cod} data-cod={agr.cod}>
          <span style={{ background: textForParty(agr.sigla_lider) }} />
          <span>{agr.sigla}</span>
          <span>{Math.trunc(agr.cadeiras)}</span>
        </li>
      ))}
    </ul>
  );
}
