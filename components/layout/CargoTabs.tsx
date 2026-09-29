/**
 * components/layout/CargoTabs.tsx
 *
 * Navegação global de cargos do shell (ADR-0025 § 2). Renderiza dentro do
 * `<TopBar>` em `app/layout.tsx`, portanto acima da dobra de TODAS as rotas.
 *
 * Quatro abas, decisão D5 do usuário (2026-09-07):
 *   Presidente `/` · Governador `/governador` · Senador `/senador` ·
 *   Deputados `/deputado-federal` (até 29/09, "Deputado Federal"; a spec 027
 *   pôs as assembleias sob a mesma aba, com seletor dentro da página).
 *
 * **As quatro navegam desde 2026-09-12.** Senador saiu do modo desabilitado em
 * 2026-09-11 (spec 016) e Deputado Federal em 2026-09-12 (spec 017), quando as
 * rotas `/deputado-federal` e `/uf/[sigla]/deputado-federal` passaram a
 * existir. O modo desabilitado — `<span aria-disabled="true">` com a razão em
 * `title` e em `sr-only`, nunca um `<a>` que levaria a 404 — continua
 * implementado no `<TabBar>` e coberto por teste lá; ele simplesmente não tem
 * mais usuário aqui.
 *
 * ⚠️ Ligar uma aba é **três** edições, não uma: `href` aqui, `<CurrentFlag />`
 * no rótulo, e o par de regras em `CargoTabs.module.css`
 * (`body:has(main[data-trilha="…"])`). Sem a terceira, a aba navega mas nunca
 * se marca como atual — e ninguém percebe. O teste (g) do
 * `CargoTabs.test.tsx` existe exatamente para essa terceira.
 *
 * ## Aba atual sem JS e sem tornar a rota dinâmica
 *
 * Um layout raiz não recebe a rota. As saídas usuais são todas proibidas
 * aqui: `usePathname()` exigiria `"use client"` acima da dobra (RNF-007a está
 * em 148,7 KiB de 150 — sem folga); `headers()`/`cookies()`/`searchParams`
 * tornariam dinâmicas as 54 páginas de UF hoje pré-renderizadas
 * (ADR-0025 § 2 e § 5); um slot de parallel route (`app/@cargo/...`) casaria
 * `/uf/[sigla]/governador` só com um segmento dinâmico dentro do slot, o que
 * duplicaria `generateStaticParams` em rota paralela.
 *
 * A informação, porém, já está no DOM: cada página emite
 * `main[data-trilha="pres"|"gov"]` (ADR-0019). `CargoTabs.module.css` lê esse
 * atributo com `:has()` a partir do `<body>` e marca a aba — cor, sublinhado
 * e um texto "página atual" que só existe (para olho e para leitor de tela)
 * na aba da trilha corrente. Zero JS, zero render dinâmico, sem duplicar
 * estado entre layout e página.
 *
 * Consequência aceita: não há atributo `aria-current` literal, porque ele
 * teria de ser decidido no render do servidor — exatamente o que não se pode
 * fazer aqui. O portador do estado é o texto revelado por CSS, que leitores
 * de tela anunciam normalmente (elementos em `display: none` ficam fora da
 * árvore de acessibilidade; os demais, dentro). O sinal não é só cor
 * (WCAG 1.4.1): há sublinhado E texto.
 *
 * Server Component puro — sem `"use client"`, sem hook, sem evento.
 *
 * ## S07/Bloco 2 (ADR-0029 § 3) — duas posições, uma por breakpoint
 *
 * `placement="bottom"` é a barra fixa no rodapé do mobile (<960px), zona de
 * alcance do polegar e convenção de app — é a posição que resolve o bug de
 * "Deputado Federal" quebrando em duas linhas no topo em 430px.
 * `placement="top"` continua no `<TopBar>`, mas só a partir de 960px, com a
 * moldura de `SegmentedControl` que o protótipo usa nesse breakpoint
 * (`ui_kits/atlas-menna/App.jsx:330`).
 *
 * O layout renderiza **as duas** e deixa o CSS escolher por media query. Os
 * dois `<nav aria-label="Cargos">` nunca coexistem na árvore de
 * acessibilidade: o escondido está em `display: none`, que o remove da
 * árvore e da ordem de tabulação — não há landmark duplicado nem parada de
 * teclado fantasma em nenhum breakpoint. Escolher a posição no servidor
 * exigiria saber a largura da viewport, o que só o cliente sabe.
 *
 * O ADR pede literalmente um `<SegmentedControl>` no topo do desktop. Aqui
 * ele é um `<TabBar>` **com a aparência** de segmented control, e a
 * divergência é deliberada: `SegmentedControl` é Client Component com
 * `onChange`, e cargo é **rota** (`/`, `/governador`), não estado client
 * (ADR-0025 § 6). Trocar `<Link>` por `onChange` somaria JS acima da dobra em
 * todas as rotas e quebraria a navegação sem JS. O que o ADR descreve é a
 * forma; a semântica de navegação é a de link.
 */

import { TabBar } from "@/components/layout/TabBar";
import styles from "./CargoTabs.module.css";

/** Texto revelado por CSS só na aba da trilha corrente (ver o `.module.css`). */
function CurrentFlag() {
  return <span className={`sr-only ${styles.flag}`}> (página atual)</span>;
}

const ITEMS = [
  {
    value: "pres",
    href: "/",
    label: (
      <>
        Presidente
        <CurrentFlag />
      </>
    ),
  },
  {
    value: "gov",
    href: "/governador",
    label: (
      <>
        Governador
        <CurrentFlag />
      </>
    ),
  },
  {
    value: "sen",
    href: "/senador",
    label: (
      <>
        Senador
        <CurrentFlag />
      </>
    ),
  },
  {
    value: "dep",
    href: "/deputado-federal",
    // Spec 027 (RF-283, decisão do dono de 29/09): a aba passou a cobrir DUAS
    // casas — a Câmara dos Deputados e a assembleia de cada estado (no DF, a
    // Câmara Legislativa) —, e a escolha entre elas é o seletor "Federal ·
    // Estadual" dentro da página (`<SeletorDeputado>`). Continuam quatro abas.
    //
    // O rótulo é "Deputados", e só isso: visível e nome acessível iguais. Até
    // 29/09 o visível era "Deputado" com um " Federal" em `sr-only` — o nome
    // acessível dizia um cargo só, e hoje seria falso. A WCAG 2.5.3 (Label in
    // Name) pede que o nome acessível COMECE pelo texto visível; igual cumpre.
    // "Deputados" cabe numa coluna de 1/4 a 320 px, como "Governador".
    //
    // O `<CurrentFlag />` fica DEPOIS do rótulo, para que o nome acessível
    // continue começando por "Deputados". A aba se marca como atual pelo
    // `data-trilha="dep"` — que as páginas estaduais e distritais emitem
    // também, sem regra nova no CSS.
    label: (
      <>
        Deputados
        <CurrentFlag />
      </>
    ),
  },
] as const;

export interface CargoTabsProps {
  /**
   * `"bottom"` (default) — barra fixa no rodapé, visível só abaixo de 960px.
   * `"top"` — faixa dentro do `<TopBar>`, visível só a partir de 960px.
   */
  placement?: "top" | "bottom";
}

export function CargoTabs({ placement = "bottom" }: CargoTabsProps) {
  const top = placement === "top";

  return (
    <TabBar
      ariaLabel="Cargos"
      className={`${styles.cargoTabs} ${top ? styles.top : styles.bottom}`}
      items={ITEMS}
      // Sentinela deliberada: nenhum item casa com `""`, então o `<TabBar>`
      // não escolhe ativo no servidor — quem escolhe é o CSS, a partir de
      // `main[data-trilha]`. Ver o bloco de doc acima.
      value=""
      // O `<TabBar>` nasceu como nav inferior de mobile (`sticky bottom-0`,
      // safe-area). No topo, dentro do `<TopBar>`, ele é uma faixa em fluxo
      // normal. `style` é o último spread no componente, então vence os
      // defaults dele — `className` não venceria o `paddingBottom` inline.
      // `gridTemplateColumns` é inline no `<TabBar>` (`repeat(4, 1fr)`), e
      // folha de estilo não vence inline: no topo do desktop as quatro abas
      // devem ter a largura do rótulo, não um quarto da tela cada.
      style={
        top
          ? {
              position: "static",
              paddingBottom: 0,
              borderTop: 0,
              gridTemplateColumns: "repeat(4, auto)",
            }
          : undefined
      }
    />
  );
}
