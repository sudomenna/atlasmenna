/**
 * components/atoms/bars/ProjectionThermometer.tsx
 *
 * Termômetro de projeção — um trilho horizontal com:
 *   - faixa (IC95) `lower → upper` em cor clara (`corBand`);
 *   - tick fino no ponto projetado (`cor`), com halo claro para não se
 *     fundir visualmente com a faixa quando as duas cores são análogas;
 *   - marcador losango do "apurado agora" (glyph distinto da faixa) numa
 *     **faixa própria abaixo do trilho** (nunca dentro dele);
 *   - cabeçalho (título serif + número grande) e rodapé com IC95, apurado
 *     e o **denominador rotulado**.
 *
 * Por que o denominador aparece: o hero de 1º turno mistura três bases
 * (votos a votáveis, comparecimento, eleitores das seções instaladas) na
 * mesma tela. Sem rótulo por termômetro, o leitor somaria percentuais de
 * universos diferentes. Ver `lib/utils/participacao.ts`.
 *
 * Colisão faixa+tick+marcador em ~375px (achado a11y-perf-auditor 2026-09-05)
 *   Quando projetado e apurado diferem por <1pp, faixa (band), tick e o
 *   losango do apurado desenhavam TODOS dentro do mesmo trilho de ~14px de
 *   altura, centrados na mesma posição — medido em produção local: banda
 *   ~18,6px, tick 2px, losango (bounding box rotacionado) ~11,3px, tudo
 *   dentro de uma janela de ~19px de largura total. O resultado era um
 *   blob indistinguível, e a diferença cor-tick-vs-cor-banda mede ~3,19:1
 *   (limite de WCAG 1.4.11 não-texto), frágil demais para carregar sozinha
 *   a distinção visual.
 *
 *   Correção: o losango do apurado sai do trilho e passa a viver numa
 *   segunda faixa (linha) abaixo dele — nunca compete pelo mesmo espaço
 *   vertical que a faixa/tick, então mesmo quando os valores X coincidem,
 *   as duas marcas continuam-se lendo como formas distintas em posições
 *   distintas (não dependente só de cor, WCAG 1.4.1). O tick ganha um halo
 *   (`box-shadow` na cor de fundo) para não se perder dentro da faixa.
 *   Faixas patologicamente estreitas (IC < 2% da escala) recebem uma largura
 *   mínima de 2% da escala, recentrada no ponto médio real do IC — só ativa
 *   abaixo do limiar, então não altera o layout comum.
 *
 * Cor de preenchimento ≠ cor de texto (achado axe-core 2026-09-07)
 *   O número grande é **texto**, e estava sendo pintado com `cor` — a cor de
 *   *preenchimento* do candidato. Na home, o candidato de rank 3 saía em
 *   `--color-cand-3` (#c97c1f): **2,99:1** sobre `--surface-page`, abaixo até
 *   do piso de 3:1 de texto grande (violação `serious` do axe em desktop e
 *   mobile). `--color-cand-1` (#d33732) mede 4,37:1 — passa 3:1 e reprova os
 *   4,5:1 que a constituição § 4 exige sem abrir exceção por tamanho de fonte.
 *
 *   Correção: `cor` segue pintando faixa e tick (área e traço, onde WCAG pede
 *   3:1 de não-texto) e o número passa a usar `corTexto`. Quando o caller não
 *   passa `corTexto`, o número sai em `--color-pct-votos`, a cor ÚNICA de todo
 *   percentual de votos (decisão do dono, 2026-10-03 — até então era
 *   `textForParty` pela sigla). Nenhum caminho devolve a cor de
 *   preenchimento, então nenhum caller consegue reintroduzir o defeito por
 *   omissão.
 *
 * Server Component puro — sem `"use client"`, sem state, sem hooks e sem
 * `framer-motion` (RNF-007a: este bloco é above-the-fold). Qualquer
 * transição é CSS e já cai no guard global de
 * `prefers-reduced-motion` em `app/globals.css` (RNF-026).
 *
 * A11y
 *   - Trilho com `role="meter"` + `aria-valuemin/max/now` e `aria-label`
 *     completo (valor projetado, base, IC95 e apurado).
 *   - Marcador do apurado é decorativo (`aria-hidden`) — o número já está
 *     no `aria-label` e no rodapé.
 *
 * ============================================================================
 * S07/Bloco 2 — restyle com os átomos do kit (ADR-0029 § 6)
 * ============================================================================
 *
 * O ADR-0029 § 6 manteve o conteúdo do ADR-0018 intacto (seis termômetros,
 * três denominadores rotulados, IC por soma de resamples, número grande em cor
 * de TEXTO segura) e pediu só o restyle: `VoteBar` no lugar do trilho próprio,
 * `Figure` no lugar do número em serifa, tokens do kit no lugar dos legados.
 * O que mudou aqui, e por quê:
 *
 *   1. **`VoteBar` desenha o trilho.** A faixa de IC95 virou um segmento do
 *      `VoteBar` (precedido por um segmento transparente que a posiciona), o
 *      que traz de graça o rail chapado do kit — `--surface-sunken`, sem
 *      borda, `--radius-xs` — no lugar do `rounded-sm border` anterior. O
 *      filete de 1px que o `VoteBar` desenha entre segmentos cai exatamente
 *      sobre o **limite inferior do IC**, que é informação, não artefato.
 *   2. **O tick continua sendo nosso.** O `marker` do `VoteBar` é fixo em
 *      `--border-strong`; o tick do ponto projetado tem que sair na cor do
 *      candidato (`cor`), com halo, pela mesma razão documentada acima. Por
 *      isso o `VoteBar` entra com `marker={null}` dentro de um contêiner
 *      `relative`, e o tick é irmão posicionado sobre ele.
 *   3. **`role="meter"` fica no contêiner, e o `VoteBar` entra
 *      `aria-hidden`.** O `VoteBar` se anuncia como `role="img"`; dois nomes
 *      acessíveis para o mesmo trilho seriam anúncio duplicado. O `meter`
 *      continua carregando valor, escala, IC e apurado no `aria-label`.
 *   4. **`Figure` para o número.** Mono (`--type-figure-lg` / `--type-figure`)
 *      em vez de serifa, com o rótulo da base em caixa alta acima — que é o
 *      que torna legível qual dos dois números está em foco.
 *   5. **Reage ao controle "Parcial / Projeção"** (ADR-0029 § 2) sem uma linha
 *      de JavaScript: os DOIS `Figure` são renderizados no servidor, cada um
 *      sob `data-view-only`, e a cascata de `app/globals.css` revela o da base
 *      ativa. O componente segue Server Component puro.
 *
 *      Por que `data-view-only` (exclusivo) e não `data-view-cell` (os dois
 *      visíveis, um esmaecido): dois algarismos de 48px lado a lado competem
 *      pela mesma leitura e nenhum vence. E nada sai do DOM em termos de
 *      informação — o rodapé sempre imprime IC95 **e** apurado, nas duas
 *      bases, em qualquer estado do controle (ADR-0017).
 *
 *      O que deliberadamente NÃO reage: a faixa, o tick e o losango do
 *      apurado. Esmaecer marca gráfica por opacidade a empurraria contra o
 *      piso de 3:1 da WCAG 1.4.11 — `--color-cand-3` já mede 2,99:1 como
 *      texto — e o trilho não é ambíguo: o tick é a projeção, o losango é o
 *      apurado, os dois sempre desenhados.
 */

import type { ReactNode } from "react";

import { VoteBar } from "@/components/atoms/bars/VoteBar";
import { Figure } from "@/components/atoms/data/Figure";
import { ProjecaoIndicador } from "@/components/atoms/data/ProjecaoIndicador";
import { formatCI, formatPercent } from "@/lib/utils/format";
import { denominadorFrase, denominadorLabel } from "@/lib/utils/participacao";
import { colorForParty, intensityForParty } from "@/lib/utils/party-color";

/** Rótulos dos segmentos do `VoteBar` — âncoras estáveis para os testes. */
const SEG_OFFSET = "antes do intervalo";
const SEG_BAND = "intervalo de confiança 95%";

/**
 * Base (denominador) da métrica. Espelha `ParticipacaoBase` de
 * `lib/edge-config/types.ts` — declarado aqui para o átomo não depender do
 * shape do payload (pode ser usado com candidatos, que não têm `base`).
 */
export type ThermometerBase = "votaveis" | "comparecimento" | "eleitores_instalados";

export interface ProjectionThermometerProps {
  /** id do elemento raiz — âncora estável para testes e deep-links. */
  id: string;
  /** Título (nome do candidato, "Outros candidatos", "Abstenção"...). */
  titulo: string;
  /** Linha de apoio: partido, contagem de candidatos, nota de IC. */
  subtitulo?: string;
  /** Denominador da métrica — dirige o rótulo do rodapé e do aria-label. */
  base: ThermometerBase;
  /**
   * Cor de **preenchimento** (`var(--party-<slug>)`,
   * `var(--color-part-abstencao)`...) — pinta a faixa de IC e o tick, que são
   * área/traço, nunca texto. Opcional: quando ausente cai em
   * `colorForParty(partido)` (ADR-0024). Constituição § 2 — nunca hex
   * partidário literal, e nunca derivada de colocação.
   *
   * **Não** é usada no número grande: ver `corTexto`.
   */
  cor?: string;
  /**
   * Cor clara da faixa de IC. Default: `intensityForParty(partido, 1)` — o
   * degrau mais claro da rampa do próprio partido (ADR-0024).
   */
  corBand?: string;
  /**
   * Cor do **número grande**, que é texto e por isso precisa de ≥ 4,5:1 sobre o
   * papel (constituição § 4). Só passe um token medido como tinta: os
   * `--party-<slug>-text`, ou os neutros de participação (`--color-part-*`,
   * medidos em 6,67:1 e 8,19:1 sobre `--surface-page`). Passar aqui a mesma
   * cor de `cor` reintroduz o defeito que esta prop existe para impedir.
   *
   * Ausente, o número sai em `--color-pct-votos` — a cor ÚNICA de todo
   * percentual de votos (decisão do dono, 2026-10-03; ver `corTextoResolvida`)
   * — e nunca cai em `cor`. Só passe esta prop para o que NÃO é percentual de
   * votos de candidato (participação).
   */
  corTexto?: string;
  /**
   * Rank semântico.
   *
   * 🔴 **Não escolhe mais cor nenhuma desde 2026-09-20** — nem de
   * preenchimento, nem de faixa, nem de texto. Continua na assinatura porque
   * as chamadas existentes o passam; hoje não influencia pixel algum deste
   * componente. Ver `corTextoResolvida` no corpo.
   */
  rank?: number;
  /**
   * Sigla do partido — fallback de `cor`/`corBand` (ADR-0024). Desde
   * 2026-10-03 NÃO escolhe mais a cor do número (decisão do dono: percentual
   * de votos em cor única, `--color-pct-votos`).
   */
  partido?: string;
  /** % projetado (0–100). */
  pctProjetado: number;
  /** CI95 inferior (0–100). */
  pctLower: number;
  /** CI95 superior (0–100). */
  pctUpper: number;
  /** % apurado agora (0–100) ou `null` quando ainda não há apuração. */
  pctAtual: number | null;
  /**
   * Topo da escala do trilho (default 100). O bloco usa uma escala comum
   * menor que 100 para candidatos + Outros, para que barras de 5% não
   * fiquem invisíveis ao lado de barras de 40%.
   */
  scaleMax?: number;
  size?: "hero" | "compact";
  /**
   * Estado "aguardando projeção" — o modelo ainda não emitiu esta métrica
   * (ex.: zero zonas apuradas). O termômetro **permanece no DOM** com o
   * meter zerado (ADR-0017 proíbe esconder camadas); os números viram "—".
   */
  aguardando?: boolean;
  /**
   * A linha pequena "↑ X% proj" sob o número da Parcial (decisão do dono,
   * 2026-10-03 — `<ProjecaoIndicador>`). Default `true`: todo percentual de
   * votos de candidatura a recebe. `false` para o que NÃO é percentual de
   * votos de candidato (participação: brancos e nulos, abstenção), que fica
   * fora do pedido. Nunca aparece em `aguardando`.
   */
  indicadorProjecao?: boolean;
  className?: string;
}

/** Clamp em [0, max] com guarda para NaN/Infinity. */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, value));
}

/**
 * Converte um valor 0–scaleMax em posição percentual no trilho.
 * Arredonda em 4 casas para não gerar `left:33.333333333333336%` no HTML
 * (ruído em snapshots e diffs de SSR).
 */
function pos(value: number, scaleMax: number): number {
  if (!(scaleMax > 0)) return 0;
  return Number(((clamp(value, scaleMax) / scaleMax) * 100).toFixed(4));
}

export function ProjectionThermometer({
  id,
  titulo,
  subtitulo,
  base,
  cor,
  corBand,
  corTexto,
  rank: _rank,
  partido,
  pctProjetado,
  pctLower,
  pctUpper,
  pctAtual,
  scaleMax = 100,
  size = "compact",
  aguardando = false,
  indicadorProjecao = true,
  className,
}: ProjectionThermometerProps) {
  const escala = Number.isFinite(scaleMax) && scaleMax > 0 ? scaleMax : 100;

  // 🔴 2026-09-20 — os dois fallbacks de preenchimento saem da SIGLA, não da
  // colocação. Eram `colorForRank(rank)` e `bandForRank(rank)`: a paleta por
  // COLOCAÇÃO do ADR-0013, aposentada pelo ADR-0024 em 2026-09-07.
  //
  // `intensityForParty(partido, 1)` é o degrau mais CLARO da rampa do próprio
  // partido — o análogo exato de `--color-cand-band-N`, com a matiz intacta
  // (constituição § 2 v1.3: "só a intensidade varia, nunca a matiz"). Sem
  // sigla, os dois caem na rampa/base de `outros`, que a paleta define para
  // esse caso.
  const corResolvida = cor ?? colorForParty(partido);
  const corBandResolvida = corBand ?? intensityForParty(partido, 1);

  // Cor de TEXTO do número grande — deliberadamente derivada de outra cadeia
  // que `corResolvida`, e nunca dela.
  //
  // 🔴 **2026-10-03 — decisão do dono: o percentual de votos não leva mais a
  // cor do partido.** Todo percentual de candidato (projeção e apurado) sai
  // na cor única `--color-pct-votos` (`app/globals.css`), neutra pela
  // constituição § 2. A cor do partido segue na faixa e no tick (`cor` /
  // `corBand`), onde é área/traço. A cadeia, em ordem:
  //   1. `corTexto` — o caller mediu e decidiu (participação usa isto: brancos
  //      e nulos e abstenção NÃO são percentual de votos de candidato);
  //   2. `--color-pct-votos` — qualquer candidatura, com ou sem sigla, e o
  //      agregado "Outros candidatos".
  //
  // Histórico: até 2026-10-03 o degrau 2 era `textForParty(partido)` (e
  // `--color-cand-other` sem sigla); até 2026-09-20 havia antes dele um degrau
  // por RANK (`strongForRank`), que pintava o número na cor da COLOCAÇÃO.
  //
  // Nenhum ramo devolve `corResolvida`: é isso que impede um caller de cair na
  // cor de preenchimento por acidente.
  const corTextoResolvida = corTexto ?? "var(--color-pct-votos)";

  const projetado = clamp(pctProjetado, escala);
  // Ordena o par para tolerar payload com lower > upper (defensivo).
  const loRaw = Math.min(clamp(pctLower, escala), clamp(pctUpper, escala));
  const hiRaw = Math.max(clamp(pctLower, escala), clamp(pctUpper, escala));
  const atual = pctAtual === null || !Number.isFinite(pctAtual) ? null : clamp(pctAtual, escala);

  const bandLeft = pos(loRaw, escala);
  const bandWidth = Math.max(0, pos(hiRaw, escala) - bandLeft);
  const bandCenter = pos((loRaw + hiRaw) / 2, escala);
  const tickLeft = pos(projetado, escala);
  const atualLeft = atual === null ? 0 : pos(atual, escala);

  // Largura mínima defensiva para faixas patologicamente estreitas (IC muito
  // apertado). Só ativa abaixo do limiar — o caso comum (band ≥ 2% da
  // escala) preserva o `left`/`width` exatos de sempre. Recentra em
  // `bandCenter` para não puxar a faixa visualmente para um dos lados.
  //
  // Antes do restyle isto saía como `calc(… - max(…%, 3px))`; agora a faixa é
  // um segmento do `<VoteBar>`, que só aceita percentual. O piso passa a ser
  // aritmético (2% da escala) em vez de híbrido %/px — mesma proteção, mesmo
  // limiar, e continua determinístico (constituição § 6).
  const MIN_BAND_PCT = 2;
  const bandNeedsMinWidth = bandWidth > 0 && bandWidth < MIN_BAND_PCT;
  const bandWidthPct = bandNeedsMinWidth ? MIN_BAND_PCT : bandWidth;
  const bandOffsetPct = bandNeedsMinWidth
    ? Number(Math.max(0, Math.min(100 - MIN_BAND_PCT, bandCenter - MIN_BAND_PCT / 2)).toFixed(4))
    : bandLeft;

  const frase = denominadorFrase(base);
  const label = denominadorLabel(base);

  // `lower === upper` significa "ponto sem incerteza publicada" — acontece
  // no fallback aritmético de "Outros" (100 − Σtop3). Nesse caso não existe
  // faixa para desenhar nem IC95 para citar: dizemos isso explicitamente em
  // vez de imprimir "[5,0; 5,0]", que sugeriria uma precisão inexistente.
  const semIC = hiRaw - loRaw <= 0;

  const ariaLabel = aguardando
    ? `${titulo}: aguardando projeção — sem dados suficientes ainda.`
    : `${titulo}: ${formatPercent(projetado, 1)} ${frase}, projetado${
        semIC
          ? "; intervalo de confiança indisponível"
          : `; intervalo de ${formatPercent(loRaw, 1)} a ${formatPercent(hiRaw, 1)}`
      }${atual === null ? "; sem apuração" : `; apurado ${formatPercent(atual, 1)}`}`;

  const hero = size === "hero";
  const railHeight = hero ? 14 : 12;
  const figureSize = hero ? "lg" : "md";
  const numeroCor = aguardando ? "var(--text-faint)" : corTextoResolvida;

  return (
    <div
      id={id}
      className={["flex flex-col", className].filter(Boolean).join(" ")}
      style={{ gap: "var(--space-2)" }}
      data-base={base}
      data-estado={aguardando ? "aguardando" : "projetado"}
    >
      <div className="flex items-end justify-between" style={{ gap: "var(--space-3)" }}>
        <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
          <span
            className="truncate"
            style={{
              font: hero ? "var(--type-title)" : "var(--type-body)",
              color: "var(--text-primary)",
            }}
          >
            {titulo}
          </span>
          {subtitulo && (
            <span
              style={{
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              {subtitulo}
            </span>
          )}
        </div>
        <div className="flex flex-none flex-col items-end">
          <Numero
            cor={numeroCor}
            rotulo="Projeção"
            size={figureSize}
            valor={aguardando ? null : projetado}
            view="proj"
          />
          <Numero
            cor={numeroCor}
            rotulo="Parcial"
            size={figureSize}
            valor={aguardando ? null : atual}
            view="parcial"
          >
            {/* A projeção pequena sob a Parcial — o MESMO `projetado` do
                `<Numero view="proj">` acima. Em `aguardando` não há projeção
                para mostrar, e o átomo não é montado. */}
            {indicadorProjecao && !aguardando ? (
              <ProjecaoIndicador
                bloco
                parcial={atual}
                projetado={projetado}
                size={hero ? "md" : "sm"}
              />
            ) : null}
          </Numero>
        </div>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: <meter> nativo não estiliza faixa + tick + marcador. */}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={escala}
        aria-valuenow={aguardando ? 0 : Math.round(projetado)}
        aria-label={ariaLabel}
        className="relative w-full"
        style={{ height: railHeight }}
      >
        {/* O `<VoteBar>` traz o rail do kit (chapado, `--surface-sunken`, sem
            borda) e desenha a faixa de IC como segmento. `aria-hidden` porque
            ele se anuncia como `role="img"` e quem fala aqui é o `meter`. */}
        <div aria-hidden="true">
          <VoteBar
            ariaLabel={label}
            height={railHeight}
            marker={null}
            segments={
              aguardando || semIC
                ? []
                : [
                    { label: SEG_OFFSET, pct: bandOffsetPct, color: "transparent" },
                    { label: SEG_BAND, pct: bandWidthPct, color: corBandResolvida },
                  ]
            }
            showLabels={false}
          />
        </div>
        {/* Tick do ponto projetado. Halo na cor da superfície evita que o tick
            se funda com a faixa quando as duas cores são análogas (banda
            clara + tick forte do mesmo matiz medem ~3,19:1 — perto do
            piso de WCAG 1.4.11 para objetos gráficos). */}
        {!aguardando && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 block w-0.5 -translate-x-1/2"
            style={{
              left: `${tickLeft}%`,
              backgroundColor: corResolvida,
              boxShadow: "0 0 0 1px var(--surface-card)",
            }}
            data-testid="thermometer-tick"
          />
        )}
      </div>

      {/* Marcador do apurado — losango numa faixa própria ABAIXO do trilho
          (nunca dentro dele). Antes competia pelo mesmo espaço vertical que
          a faixa/tick: quando projetado e apurado diferiam por <1pp, os três
          elementos colapsavam num blob de ~19px em telas de 375px (medido).
          Separar verticalmente garante que o losango continue sendo uma
          forma distinta mesmo quando sua posição X coincide com o tick —
          a distinção passa a vir de forma + posição, não só de cor. */}
      {!aguardando && atual !== null && (
        <div
          aria-hidden="true"
          className="relative w-full"
          style={{ height: 8, marginTop: -4 }}
          data-testid="thermometer-apurado-track"
        >
          <span
            className="absolute top-0 block h-2 w-2 -translate-x-1/2 rotate-45 border"
            style={{
              left: `${atualLeft}%`,
              backgroundColor: "var(--surface-card)",
              borderColor: "var(--text-primary)",
            }}
            data-testid="thermometer-apurado"
          />
        </div>
      )}

      {/* Rodapé em SANS, não em `--type-data` (mono): a linha inteira —
          "IC95 [41,8; 44,6] · apurado 43,2% · % dos votos a votáveis" — tem
          ~57 caracteres e, em mono de 11px, passa de 376px numa coluna de
          398px em 430px: quebra em duas linhas e custa 15px por termômetro,
          90px na tela (medido em 2026-09-08). O mono do kit fica onde ele
          paga por si — nos algarismos do `<Figure>`; aqui os números já
          entram com `tabular-nums`, que é o que impede a coluna de dançar
          entre atualizações. */}
      <p
        style={{
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-secondary)",
        }}
      >
        {aguardando ? (
          <>aguardando projeção · {label}</>
        ) : (
          <>
            {semIC ? "IC indisponível" : `IC95 ${formatCI(loRaw, hiRaw)}`} ·{" "}
            {atual === null ? "sem apuração" : `apurado ${formatPercent(atual, 1)}`} · {label}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Um dos dois algarismos do par "Parcial / Projeção" (ADR-0029 § 2).
 *
 * Os dois são renderizados no servidor; a cascata de `app/globals.css` decide
 * qual aparece, a partir de `data-view` no `<html>`. Zero JavaScript novo — o
 * único componente client do par é o `<ViewModeSwitch>` da barra do topo, que
 * já existe.
 *
 * `data-view-only` mora neste `<span>`, e nunca no `<Figure>`: o `Figure`
 * escreve `display: grid` **inline**, e declaração inline vence qualquer folha
 * de autor — a regra `[data-view-only] { display: none }` seria simplesmente
 * ignorada, e os dois números apareceriam juntos. O `<span>` não declara
 * display, então a regra pega; e como ele é item de um contêiner flex, o
 * `display: revert` do estado ativo (que computa `inline`) é blocificado de
 * volta para bloco, sem efeito colateral de layout.
 */
function Numero({
  cor,
  rotulo,
  size,
  valor,
  view,
  children,
}: {
  cor: string;
  rotulo: string;
  size: "lg" | "md";
  valor: number | null;
  view: "proj" | "parcial";
  /** Abaixo do número, dentro do mesmo `data-view-only` (o indicador da Parcial). */
  children?: ReactNode;
}) {
  return (
    <span
      data-view-only={view}
      data-testid={view === "proj" ? "thermometer-numero" : "thermometer-numero-parcial"}
      style={children ? { color: cor, textAlign: "right" } : { color: cor }}
    >
      <Figure
        align="right"
        color={cor}
        label={rotulo}
        size={size}
        value={valor === null ? "—" : formatPercent(valor, 1)}
      />
      {children}
    </span>
  );
}
