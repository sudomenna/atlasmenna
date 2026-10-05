"use client";

/**
 * components/atoms/banners/DadoParadoBanner.tsx
 *
 * O banner amarelo de "o dado do TSE não anda" —
 * [ADR-0038](../../../docs/architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)
 * D4, e a primeira implementação real do estado que a spec 003 descreve em
 * prosa desde a redação original: "Erro de dados (>60s sem update): banner
 * amarelo" (`docs/specs/003-home-nacional/spec.md:108`). Constituição § 7
 * ("último valor conhecido + banner amarelo") e RNF-010/RNF-012 pedem o mesmo
 * estado; até aqui nenhum componente do repositório o implementava.
 *
 * ## Componente dedicado, e não uma extensão de `<ApuracaoMeta>`
 *
 * O ADR deixa a decisão em aberto (D4, último parágrafo). Três razões para
 * separar:
 *
 *   1. **`<ApuracaoMeta>` é uma grade de métricas**, `role="group"` rotulado
 *      "Resumo da apuração", composta de três `<Figure>` (rótulo em caixa alta
 *      + algarismo em mono). Um aviso em prosa não é uma métrica: enfiá-lo ali
 *      dentro poria um parágrafo numa grade de 3 colunas e tornaria o
 *      `aria-label` do grupo falso.
 *   2. **`<ApuracaoMeta>` só existe em uma das cinco superfícies** que precisam
 *      do banner — o ramo `binary` da home presidencial. As telas de Deputado
 *      Federal (nacional e UF) e as de UF de Presidente/Governador nunca o
 *      renderizam. Um banner morando dentro dele ficaria invisível em 4 de 5.
 *   3. **A gramática de posição já existe.** `<NationalWinnerBanner>` e
 *      `<BreakingNewsTicker>` são faixas irmãs dos painéis, fora de `<Panel>`,
 *      logo abaixo do shell (ADR-0029 § 1). Uma faixa de estado pertence a essa
 *      camada, não ao interior de uma seção editorial.
 *
 * O que `<ApuracaoMeta>` ganhou foi só o que D1 pede dele: o **rótulo**
 * ("Dado do TSE" no lugar de "Última atualização"). O aviso é este componente.
 *
 * ## A virada de 2026-09-13: o aviso passa a poder aparecer com a página aberta
 *
 * A primeira versão deste componente era Server Component puro, e D4 é escrito
 * para isso — "o gatilho é calculado no servidor". O problema é o que o
 * servidor pode prometer: **quatro das cinco rotas são ISR-60 e uma é estática
 * pura, e nenhuma das duas coisas ajuda uma aba já aberta**. ISR só decide o
 * que uma requisição **nova** recebe; quem já está na página não emite
 * requisição nenhuma, então o veredito que ele tem é o do render que o serviu —
 * calculado **uma vez** e nunca mais. Quem abriu a página às 20h e ficou nela
 * não veria aviso nenhum se a ingestão morresse às 20h30 — e a tela ainda
 * pareceria viva, porque a moldura do mapa se repinta a cada 60 s
 * (`components/layout/PersistentMapFrame.tsx:132`). Um relógio fresco por cima
 * de dado parado é exatamente o defeito que o ADR-0038 nomeia; aqui ele estava
 * uma camada acima, no **veredito** em vez do carimbo.
 *
 * O conserto tem duas metades, e só as duas juntas funcionam:
 *
 *   1. **Reavaliar com o tempo**, para o aviso poder acender sozinho.
 *   2. **Reavaliar contra o `dado_ts` mais recente que alguém buscou**, e nunca
 *      contra o do render inicial. Um timer sozinho, em cima do `dado_ts` fixo
 *      que veio do servidor, faria o lag crescer para sempre: o aviso acenderia
 *      **falsamente** em toda página aberta por mais que o limiar do cargo —
 *      um alarme falso recorrente, pior que o defeito original.
 *
 * Quem já busca é o `<PersistentMapFrame>`, e o `EdgePayload` que ele recebe a
 * cada 60 s já carrega `dado_ts`. Ele publica esse valor em
 * `lib/state/dado-freshness-store.ts` (o arquivo explica por que uma store, e
 * não contexto React); este componente lê de lá. Nenhuma requisição nova,
 * nenhuma query nova — o dado já estava na mão e era jogado fora.
 *
 * A prop `frescor` continua sendo o veredito do **servidor**, e continua sendo
 * a única coisa que este componente renderiza no primeiro render do cliente:
 * é o que garante que a hidratação bata com o HTML e não haja salto visual.
 * Do primeiro efeito em diante, o veredito passa a ser recalculado — e, no
 * escopo nacional, o que sai daqui é exatamente o que um render de servidor
 * produziria **agora**, com o payload mais novo que a página conhece.
 *
 * ## A página não perde nada — o banner só acrescenta
 *
 * Constituição § 7 e RNF-010/012: em degradação, "último valor conhecido +
 * banner amarelo". Este componente não esconde bloco, não zera número, não
 * bloqueia interação. Ele é uma faixa a mais no topo, e o caller renderiza o
 * payload inteiro exatamente como renderizaria sem ele.
 *
 * ## Cor: o âmbar do kit, não o `--color-warning`
 *
 * "Banner amarelo" na spec, e o único amarelo desta paleta é o ocre do design
 * system (`--accent-*`). `--color-warning` (#b4432f) é um vermelho-tijolo:
 * carrega "erro", e isto **não** é erro — a página funciona e os números são
 * reais, só pararam de avançar. Usar o vermelho exageraria o estado.
 *
 * Contraste (constituição § 4, WCAG 2.1 AA ≥ 4.5:1) sai de graça no par
 * `--accent-soft` / `--accent-ink`, medido nos dois temas em `app/globals.css`:
 * no claro, #3F2A08 sobre #F4E7CF; no escuro os dois **trocam de papel**
 * (`globals.css:410-416`) e o par dá 10,85:1. Nenhum hex solto aqui — só token
 * (constituição § 2). A cor é redundante, nunca portadora: todo o significado
 * está no texto (WCAG 1.4.1).
 *
 * ## A11y
 *
 *   - **`role="status"` + `aria-live="polite"`.** Era `role="note"`, e a
 *     justificativa registrada aqui era que o conteúdo vinha do servidor e "não
 *     muda depois da hidratação — nenhuma página do produto faz polling no
 *     cliente". **Essa frase deixou de ser verdadeira** com a virada acima: o
 *     aviso agora surge com a página aberta, sem recarga e sem nenhum gesto do
 *     leitor. Um aviso que aparece sozinho e não é anunciado é regressão de
 *     acessibilidade, e a a11y é constitucional (§ 4) — então este é o caso em
 *     que a live region **se justifica**, e não o caso de `DetailUnavailable` /
 *     `ShellLiveBadge`, cujo conteúdo acessível de fato não muda. É a mesma
 *     dupla do `<NationalWinnerBanner>` (`:120-121`), que também aparece no meio
 *     da apuração, e `polite` (nunca `assertive`/`alert`) porque o dado parado
 *     não é emergência: a página segue inteira e o leitor não perde nada
 *     terminando a frase em que estava.
 *   - **A região é montada sempre, vazia, e só o texto entra depois.** A versão
 *     anterior devolvia `null` nos outros três estados, de modo que a região
 *     nascia no DOM **junto** com o conteúdo — o modo de falha clássico de live
 *     region: NVDA/JAWS anunciam de forma inconsistente e o VoiceOver
 *     notoriamente não anuncia nada, porque o observador precisa da região já
 *     registrada para ver a mutação. A justificativa registrada aqui para não
 *     consertar era que manter a região montada "custaria um item vazio no
 *     `flex` com `gap` das cinco páginas". **Essa premissa era falsa**: a região
 *     vazia sai com `.sr-only` (`app/globals.css:619-629`), que é
 *     `position: absolute`, e um filho absolutamente posicionado **não é flex
 *     item** (CSS Flexbox L1 § 4.1) — não gera caixa no fluxo nem participa do
 *     `gap`. O custo real nas cinco páginas é **0 px**, e o que se comprava com
 *     ele era um anúncio que podia não sair.
 *   - **O contador fica FORA do que é anunciado.** O texto começa com "não
 *     avançam há X minutos" e `role="status"` tem `aria-atomic="true"`
 *     implícito (ARIA 1.2): qualquer mudança dentro da região faz o leitor reler
 *     **tudo**. Como o veredito é refeito a cada `CADENCIA_SEGUNDOS/4` e
 *     `humanizarDuracao` corta em minutos, o número muda 1×/minuto — e as três
 *     frases (~135 caracteres, ~8 s de fala) seriam relidas **a cada minuto
 *     enquanto durasse a queda**, que numa noite de apuração são horas. Das duas
 *     saídas possíveis, a escolhida foi **isolar a duração num `<span
 *     aria-live="off">`** (a politeness resolve pelo ancestral mais próximo com
 *     `aria-live`, então `off` no contador suprime a releitura). A alternativa —
 *     congelar o texto anunciado na transição `fresco → parado` — foi rejeitada
 *     por duas razões: exigiria uma **segunda cópia** da prosa (uma `sr-only`
 *     congelada, outra visual e `aria-hidden`), que é prosa que diverge; e
 *     tiraria o número do **primeiro** anúncio também. Com o `<span>`, a
 *     inserção do parágrafo inteiro é uma mutação cujo ancestral vivo mais
 *     próximo é a própria região, então o leitor ouve a frase **completa, com o
 *     número, uma vez** — e nenhuma vez mais, porque dali em diante só o texto
 *     de dentro do `<span>` muda. O **visual** continua contando: o número não
 *     sai da tela, sai só do áudio repetido.
 *   - **Texto real, nunca `content` de CSS** — a lição do `<ShellLiveBadge>`,
 *     cujo número precisou de um par `sr-only` porque texto gerado é lido de
 *     forma inconsistente. Aqui tudo é nó de texto.
 *   - `aria-label`: dá ao leitor a natureza do bloco ("Aviso sobre os dados do
 *     TSE") antes da frase.
 *   - **Sem animação**, então não há o que gatear em `prefers-reduced-motion`:
 *     uma faixa que pulsa sobre um aviso de degradação é ruído, e o kit já é
 *     editorial (ADR-0025 § 8).
 *
 * Client Component a partir de 2026-09-13 (era Server Component puro). O custo
 * de bundle é uma função, um `useEffect` e um selector: a store Zustand já
 * viaja no mesmo bundle do `layout.tsx` que monta a moldura (constituição § 3 —
 * orçamento above-the-fold).
 */

import { type CSSProperties, useEffect, useState } from "react";

import type { CargoTse } from "@/lib/config/cargos";
import {
  avaliarFrescorDado,
  CADENCIA_SEGUNDOS,
  type FrescorDado,
  partesDadoParado,
} from "@/lib/config/dado-freshness";
import { useDadoFrescorStore } from "@/lib/state/dado-freshness-store";

/**
 * De que recorte é o `dado_ts` que produziu a prop `frescor` — e, por
 * consequência, como o relógio vivo (que é **nacional**, porque é o que o
 * `<PersistentMapFrame>` busca) se combina com ele.
 *
 * ADR-0038 D2 dá a cada UF o seu próprio `dado_ts` de propósito: "a ingestão
 * pode degradar regionalmente sem que o agregado nacional acuse nada". Tratar
 * os dois como intercambiáveis seria o substituto silencioso que D1 proíbe.
 */
export type EscopoDado = "nacional" | "uf";

/**
 * De quanto em quanto tempo o veredito é refeito: **um quarto da cadência do
 * cargo**. Derivado da mesma tabela que produz o limiar
 * (`CADENCIA_SEGUNDOS`), nunca um número escrito à mão — se a cadência de um
 * cargo mudar, isto acompanha sozinho, que é a mesma disciplina de
 * `limiarDadoParadoSegundos` (ADR-0038 D3).
 *
 * Um quarto porque o limiar é ×3: o atraso máximo entre cruzar o limiar de
 * verdade e o aviso acender fica em 1/12 do limiar (15 s dos 180 s de
 * Presidente, 7,5 min dos 90 min de Deputado) — imperceptível ao lado da
 * própria cadência, e sem gastar um render por segundo numa página que o
 * leitor deixa aberta por horas.
 */
export function intervaloReavaliacaoMs(cargo: CargoTse): number {
  return (CADENCIA_SEGUNDOS[cargo] / 4) * 1000;
}

/**
 * O caminho de volta de `FrescorDado` para o `dado_ts` cru que o produziu —
 * necessário para reavaliar a semente do servidor contra um relógio de parede
 * novo, sem ter de passar o campo cru por uma segunda prop.
 *
 * `"indisponivel"` volta como `null` e não como a string original: os dois
 * casos que produzem esse estado (`null` explícito e string impossível de
 * datar) já são indistinguíveis para `avaliarFrescorDado`, então o ida-e-volta
 * é fiel ao **veredito**, que é o que importa aqui.
 */
function dadoTsDe(frescor: FrescorDado): string | null | undefined {
  switch (frescor.estado) {
    case "fresco":
    case "parado":
    case "encerrado":
      return frescor.dadoTs;
    case "indisponivel":
      return null;
    case "ausente":
      return undefined;
  }
}

/**
 * Entre o `dado_ts` do servidor e o que o poller publicou, qual vale.
 *
 * A regra é "o publicado manda", com **uma** exceção: quando os dois são datas
 * legíveis, vence a mais nova. A exceção existe porque o `/api/projection` tem
 * CDN de 30 s (ADR-0002) e pode devolver por alguns segundos o ciclo anterior
 * ao que o servidor leu — sem a guarda, o lag daria um pulo para trás a cada
 * navegação. Escolher a mais nova é também a escolha menos alarmista das duas,
 * que é o lado certo para errar num aviso.
 */
function relogioQueVale(
  doServidor: string | null | undefined,
  publicado: string | null | undefined,
): string | null | undefined {
  if (typeof doServidor !== "string" || typeof publicado !== "string") return publicado;
  const a = Date.parse(doServidor);
  const b = Date.parse(publicado);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return publicado;
  return a > b ? doServidor : publicado;
}

export interface DadoParadoBannerProps {
  /**
   * O frescor já classificado pelo **servidor** (`avaliarFrescorDado`). Recebe
   * os **quatro** estados de propósito, e não só `"parado"`: quem decide se o
   * aviso existe é este componente, num lugar só, em vez de cada uma das cinco
   * páginas repetindo o mesmo `if` — e um `if` repetido cinco vezes é um `if`
   * que alguém esquece de repetir na sexta.
   *
   * É também a semente do lado cliente: enquanto nenhum efeito rodou, é
   * **exatamente** isto que se renderiza, o que faz a hidratação bater.
   */
  frescor: FrescorDado;
  /**
   * Recorte do `dado_ts` da prop acima. `"nacional"` por padrão porque três das
   * cinco superfícies (a home presidencial e as duas de Deputado Federal) leem
   * de um payload nacional; as duas páginas de UF passam `"uf"`.
   */
  escopo?: EscopoDado;
  className?: string;
  style?: CSSProperties;
}

export function DadoParadoBanner({
  frescor,
  escopo = "nacional",
  className,
  style,
}: DadoParadoBannerProps) {
  const cargo = frescor.cargo;

  // Dois selectors finos, nunca o estado inteiro (a regra de
  // `lib/state/hover-store.ts`). `pollers[cargo]` decide SE há como reavaliar;
  // `relogios[cargo]` é COM QUE dado. A referência do relógio só muda quando o
  // `dado_ts` muda de verdade — a guarda está na própria store.
  const temPoller = useDadoFrescorStore((s) => (s.pollers[cargo] ?? 0) > 0);
  const relogio = useDadoFrescorStore((s) => s.relogios[cargo]);

  // `null` até o primeiro efeito. É o que faz o primeiro render do cliente ser
  // idêntico ao HTML do servidor, independentemente do que já houver na store:
  // sem isto, uma store populada antes da hidratação (ou um `Date.now()` lido
  // no corpo do componente) produziria um veredito diferente do que veio no
  // HTML — descompasso de hidratação e salto visual no mesmo golpe.
  const [agoraMs, setAgoraMs] = useState<number | null>(null);

  useEffect(() => {
    // Sem poller para este cargo, NÃO reavalie. É o caso das duas telas de
    // Deputado Federal, que não têm moldura de mapa: ali nada jamais traria um
    // `dado_ts` novo, e um timer em cima da semente fixa faria o lag crescer
    // para sempre — alarme falso garantido em toda página aberta por mais de
    // 90 min. Sem relógio vivo, o veredito do servidor é o melhor que existe.
    if (!temPoller) return;
    const bater = () => setAgoraMs(Date.now());
    bater();
    const id = setInterval(bater, intervaloReavaliacaoMs(cargo));
    return () => clearInterval(id);
  }, [temPoller, cargo]);

  const efetivo = agoraMs === null ? frescor : reavaliar(frescor, escopo, relogio, agoraMs);

  // Os outros três estados não produzem **aviso**, e cada um por um motivo
  // próprio (ADR-0038 D4): `"fresco"` porque não há o que avisar;
  // `"indisponivel"` porque não se mede defasagem de um relógio que não existe
  // neste ciclo — quem dá a notícia ali é o texto do carimbo, dizendo
  // "indisponível"; `"ausente"` porque durante o canary a tela se comporta como
  // antes, e um banner novo sobre um campo que o payload não tem seria alarme
  // fabricado.
  //
  // O que eles NÃO fazem mais é desmontar a live region: ela é montada sempre,
  // vazia, e só o texto entra depois (ver a seção "A11y" no topo). Vazia ela é
  // `.sr-only`, ou seja `position: absolute` — não é flex item, não gera caixa,
  // não consome o `gap` de nenhuma das cinco páginas.
  const parado = efetivo.estado === "parado" ? efetivo : null;
  const partes = parado === null ? null : partesDadoParado(parado);

  return (
    <div
      // `role="status"` num `div`: não existe elemento HTML com essa semântica
      // (`<aside>` é conteúdo TANGENCIAL, que este aviso não é — ele fala sobre
      // os números da própria página). `polite`, nunca `assertive`: o dado
      // parado não interrompe ninguém no meio de uma frase.
      role="status"
      aria-live="polite"
      aria-label="Aviso sobre os dados do TSE"
      // A região, não o aviso. Os dois testids são distintos de propósito:
      // `dado-parado-regiao` existe SEMPRE (é o que se afere para provar que a
      // região precede o texto) e `dado-parado-banner` existe SÓ quando há
      // aviso — que é o que todo o resto da suíte, e as telas, já perguntam.
      data-testid="dado-parado-regiao"
      // Vazia, some de toda medida de layout; com aviso, é um invólucro sem
      // estilo nenhum e quem desenha a faixa é o filho.
      className={parado === null ? "sr-only" : undefined}
    >
      {parado === null || partes === null ? null : (
        <div
          data-testid="dado-parado-banner"
          // Segundos, não o texto: um teste (e o operador com o inspetor aberto)
          // consegue conferir o gatilho sem depender da redação da frase.
          // `data-*` não entra na árvore de acessibilidade, então estes dois
          // mudarem a cada reavaliação não dispara anúncio nenhum.
          data-lag-seconds={String(parado.lagSegundos)}
          data-limiar-seconds={String(parado.limiarSegundos)}
          className={className}
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent-ink)",
            // O filete à esquerda é do mesmo âmbar, na variante que passa AA
            // como texto — aqui ele é só traço, mas usar o token de texto evita
            // que uma futura mudança de paleta o deixe invisível no escuro.
            borderLeft: "3px solid var(--accent-text)",
            padding: "var(--space-3) var(--space-4)",
            font: "var(--type-body-sm)",
            ...style,
          }}
        >
          <p style={{ margin: 0 }}>
            {partes.antes}
            {/*
             * A duração — o ÚNICO pedaço que muda enquanto a queda dura, e por
             * isso o único que precisa sair do que é anunciado. `aria-live` do
             * ancestral mais próximo é quem decide a politeness da mutação
             * (ARIA 1.2), então `off` aqui significa: mudanças DESTE texto não
             * reanunciam nada. A inserção do parágrafo inteiro, essa, continua
             * sendo uma mutação da região — e é lida com o número junto, uma
             * vez. Sem isto, as três frases voltariam a ser relidas 1×/minuto
             * por toda a duração da queda.
             *
             * Continua sendo nó de texto real, nunca `content` de CSS (a lição
             * do `<ShellLiveBadge>`), e continua visível: o leitor de olho na
             * tela vê o contador andar.
             */}
            <span aria-live="off">{partes.duracao}</span>
            {partes.depois}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * O veredito do cliente, a partir do do servidor mais o que o poller trouxe.
 *
 * Três caminhos, e a diferença entre eles é o que separa "a ingestão morreu"
 * de "o leitor está só sentado há muito tempo":
 *
 *   1. **Poller montado, nada publicado ainda** — o primeiro `fetch` está em
 *      voo, ou todos estão falhando (o `catch` de `PersistentMapFrame` é
 *      silencioso de propósito). O último `dado_ts` conhecido é o do servidor e
 *      continua valendo; o relógio de parede anda por cima. Se a página não
 *      consegue mais confirmar que o dado avança, acender o aviso é o desfecho
 *      certo — ADR-0038 § "graceful degradation", não um bug.
 *   2. **Escopo nacional** — o relógio publicado mede a MESMA coisa que a
 *      semente, então substitui. O resultado é, por construção, o que um render
 *      de servidor devolveria agora com o payload mais novo que a página
 *      conhece: ingestão saudável ⇒ o `dado_ts` avança a cada ciclo e o lag
 *      nunca chega perto do limiar; ingestão morta ⇒ ele congela e o limiar é
 *      cruzado sem recarga.
 *   3. **Escopo de UF** — o relógio publicado é o NACIONAL, que mede outra
 *      coisa (D2: a ingestão degrada regionalmente sem o nacional acusar). Ele
 *      só pode ser usado no sentido em que a desigualdade é válida: o `dado_ts`
 *      nacional é o `max` sobre todos os pares, logo é sempre ≥ o de qualquer
 *      UF, logo o lag nacional é sempre ≤ o lag da UF. "Nacional parado" prova
 *      "esta UF parada"; "nacional fresco" não prova nada sobre a UF. Então
 *      aqui ele só **acende**, nunca apaga — e o tempo que o texto mostra é o
 *      nacional, que subestima o da UF em vez de exagerá-lo. Substituir o
 *      veredito da UF pelo nacional nos dois sentidos apagaria um aviso
 *      verdadeiro de degradação regional, que é pior do que não ter aviso
 *      nenhum.
 */
function reavaliar(
  semente: FrescorDado,
  escopo: EscopoDado,
  relogio: { dadoTs: string | null | undefined } | undefined,
  agoraMs: number,
): FrescorDado {
  const doServidor = dadoTsDe(semente);

  if (relogio === undefined) {
    return avaliarFrescorDado(doServidor, semente.cargo, agoraMs);
  }

  if (escopo === "nacional") {
    return avaliarFrescorDado(relogioQueVale(doServidor, relogio.dadoTs), semente.cargo, agoraMs);
  }

  const nacional = avaliarFrescorDado(relogio.dadoTs, semente.cargo, agoraMs);
  return nacional.estado === "parado" ? nacional : semente;
}
