/**
 * components/blocks/ApuracaoMeta.tsx
 *
 * Bloco "Apurado X% | UFs apuradas Y/27 | atualizado HH:MM:SS".
 *
 * Cobertura: RF-026 (timestamp + meta da apuração).
 *
 * S07/Bloco 1 (ADR-0025) — o bloco perdeu a moldura. A gramática do design
 * system Atlas Menna é de jornal: números-manchete separados por espaço e
 * filete, nunca um card com borda arredondada flutuando sobre o papel. Os
 * três pares viraram `<Figure>`, o átomo canônico do "rótulo em caixa alta +
 * algarismo em mono", que já resolve escala tipográfica, `tabular-nums` e a
 * cor do rótulo. O contrato de dados e o de a11y não mudaram.
 *
 * Server Component puro. Recebe campos do `EdgePayload` resolvidos pelo pai.
 *
 * ## 2026-09-13 — a terceira figura mudou de relógio (ADR-0038 D1)
 *
 * Ela dizia "Última atualização" sobre `ts`, que é **a hora em que o modelo
 * rodou**, não a hora em que o TSE atualizou. O doc-comment do tipo nunca
 * prometeu outra coisa; quem mentia era este rótulo. Se a ingestão parar, o
 * modelo continua rodando sobre os últimos snapshots e carimbando um `ts`
 * fresco sobre dado parado, a cada ciclo — e esta figura mostraria "agora".
 *
 * Agora a figura mostra `dado_ts` (`max(dg, hg)` dos boletins do ciclo), e
 * `ts` só volta a aparecer no estado `"ausente"`, durante o canary de um
 * deploy. Quem resolve os quatro estados é `rotuloFrescorDado`
 * (`lib/config/dado-freshness.ts`) — este componente não os interpreta, para
 * que as cinco superfícies de carimbo do produto não divirjam na leitura.
 *
 * A11y
 *   - role="group" + aria-label (preservados — há teste fixando os dois).
 *   - `<Figure>` emite rótulo e valor como texto; leitor de tela lê o par na
 *     ordem visual sem depender de cor ou posição. O rótulo mudar junto com o
 *     valor é parte disso: "Dado do TSE" e "Última atualização" medem coisas
 *     diferentes, e um leitor que só ouve o número precisa ouvir qual delas.
 */

import { Figure } from "@/components/atoms/data/Figure";
import type { CargoTse } from "@/lib/config/cargos";
import { avaliarFrescorDado, rotuloFrescorDado } from "@/lib/config/dado-freshness";
import { formatPercent } from "@/lib/utils/format";

export interface ApuracaoMetaProps {
  pctApurado: number;
  ufsApuradas: number;
  totalUfs?: number;
  /**
   * ISO 8601 da hora em que o **modelo** rodou (`EdgePayload.ts`).
   *
   * Continua obrigatório, e continua sendo o que é: o relógio da nossa
   * escrita. Só chega à tela no estado `"ausente"` de {@link dadoTs} — o
   * fallback de rollout do ADR-0038 D1 item 3.
   */
  ts: string;
  /**
   * ISO 8601 da hora do **dado do TSE** (`EdgePayload.dado_ts`).
   *
   * Passe o campo **cru**, sem `??`: `undefined` (payload pré-ADR-0038, em voo
   * durante o canary) e `null` (o ciclo não teve `dg`/`hg` parseável) são
   * estados diferentes, com textos diferentes, e coalescê-los aqui é
   * exatamente o default silencioso que o ADR proíbe.
   */
  dadoTs?: string | null;
  /**
   * Cargo da corrida — decide o limiar de "parado" (ADR-0038 D3).
   *
   * Default 1 (Presidente) porque é o único cargo que renderiza este bloco
   * hoje. **Não** é um `??` sobre dado do payload: é o valor de uma prop de
   * componente, e o dia em que outra trilha usar o bloco o call site passa o
   * dele. O único efeito do cargo aqui é o limiar do banner — a figura em si
   * não muda.
   */
  cargo?: CargoTse;
  className?: string;
}

export function ApuracaoMeta({
  pctApurado,
  ufsApuradas,
  totalUfs = 27,
  ts,
  dadoTs,
  cargo = 1,
  className,
}: ApuracaoMetaProps) {
  const frescor = rotuloFrescorDado(avaliarFrescorDado(dadoTs, cargo), ts);
  return (
    // biome-ignore lint/a11y/useSemanticElements: role=group em div é o correto para "grupo de métricas"; fieldset exigiria legend.
    <div
      role="group"
      aria-label="Resumo da apuração"
      className={["grid grid-cols-2 sm:grid-cols-3", className].filter(Boolean).join(" ")}
      style={{ gap: "var(--space-6)" }}
    >
      <Figure label="Apurado" value={formatPercent(pctApurado, 1)} size="md" />
      {/* ADR-0045 — no Presidente o denominador é 28: diz ao leitor que o
          28º é o exterior, e não uma UF que ele não conhece. */}
      <Figure
        label="UFs apuradas"
        value={`${ufsApuradas}/${totalUfs}`}
        size="md"
        {...(totalUfs > 27 ? { note: "27 UFs e o exterior" } : {})}
      />
      <Figure label={frescor.label} value={frescor.value} size="md" />
    </div>
  );
}
