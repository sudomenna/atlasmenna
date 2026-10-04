/**
 * components/atoms/data/UfFlag.tsx
 *
 * A bandeira de uma das 27 unidades federativas: um `<img>` comum apontando
 * para `public/bandeiras/<SIGLA>.webp`, servido pelo próprio site.
 *
 * ## Por que arquivo em `public/` e `<img>` — e não mais sprite embutido
 *
 * Até 2026-10-03 a arquitetura era um sprite `<symbol>` embutido no HTML
 * (`UfFlagSprite`, gerado de SVG por `scripts/gen-uf-flags.ts`). Ela não
 * sobreviveu às bandeiras reais: depois de otimizadas, as que têm brasão pesam
 * AL 147 KB, RJ 66, RN 54, PR 37 KB…, contra um teto de 4 KB por bandeira, e
 * `/deputado-federal` já media 307,8 de 320 KiB do teto do documento — com o
 * sprite contado DUAS vezes (HTML + payload RSC). Decisão do dono, 03/10:
 * bandeiras viram arquivos rasterizados pequenos (WebP, 60 px de altura,
 * 0,5–1,9 KB cada) no nosso domínio, referenciados por `<img>`.
 *
 * - **Sem CDN de terceiro**: a bandeira sai do mesmo domínio que a página.
 * - **Zero JavaScript de aplicação**: é markup puro, serve em Server e em
 *   Client Component (não importa dado nenhum — o `UfPicker` é cliente).
 * - **O HTML só ganha a tag** (~110 bytes por bandeira). A imagem vai para o
 *   cache do navegador uma vez e serve a todas as telas.
 * - Sem `next/image`: ele é Client Component no App Router e traria runtime e
 *   o otimizador de imagem para um arquivo que já está no tamanho final (ver
 *   `CandidateAvatar.tsx`).
 *
 * Proveniência e receita de regeneração: `scripts/data/bandeiras-uf/PROVENIENCIA.md`.
 *
 * ## Acessibilidade: a bandeira é decorativa, e tem de ser
 *
 * `alt=""` tira a imagem da árvore de acessibilidade. Em TODO lugar onde ela
 * aparece, o nome do estado e/ou a sigla estão em texto ao lado — é o que
 * reconcilia esta superfície com RF-162/163 e com a constituição § 4: a
 * bandeira ajuda o reconhecimento, não carrega informação. Um `alt="Bandeira
 * de São Paulo"` faria o leitor de tela anunciar o estado duas vezes por item,
 * 27 vezes numa página.
 *
 * ## Sigla desconhecida ⇒ nada
 *
 * Fora das 27 (inclusive "BR", vazio, lixo), devolve `null` — nunca um `<img>`
 * apontando para um arquivo que não existe, que viraria ícone quebrado ao lado
 * de um resultado eleitoral.
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import styles from "./UfFlag.module.css";

/** Caminho público da bandeira. Um lugar só — o componente e os testes leem daqui. */
export function ufFlagSrc(sigla: string): string {
  return `/bandeiras/${sigla.toUpperCase()}.webp`;
}

/** É uma das 27 UFs? É a guarda de existência, e é única. */
export function temBandeira(sigla: string): boolean {
  return Object.hasOwn(UF_NOMES, sigla.toUpperCase());
}

export interface UfFlagProps {
  sigla: string;
  /** Largura em px. As bandeiras têm proporção ~1,4 (de 1,38 a 1,50). */
  width?: number;
  height?: number;
  /**
   * Carregar já, sem `loading="lazy"` — para a bandeira acima da dobra (o
   * `<h1>` das páginas de UF). Nas grades, o padrão `lazy` deixa o navegador
   * buscar só as que entram na tela.
   */
  eager?: boolean;
  /**
   * A bandeira está dentro de texto corrido (título, cabeçalho de cartão), e
   * não num contêiner flex: alinha ao corpo das letras e ganha o espaço até o
   * texto seguinte.
   */
  inline?: boolean;
  className?: string;
}

/** A bandeira de uma UF, ou `null` se a sigla não é uma das 27. */
export function UfFlag({
  sigla,
  width = 21,
  height = 15,
  eager = false,
  inline = false,
  className,
}: UfFlagProps) {
  if (!temBandeira(sigla)) return null;

  const classes = [styles.f, inline ? styles.t : null, className].filter(Boolean).join(" ");

  return (
    // biome-ignore lint/performance/noImgElement: arquivo estático já no tamanho final; `next/image` traria runtime de cliente — ver o cabeçalho
    <img
      src={ufFlagSrc(sigla)}
      width={width}
      height={height}
      alt=""
      decoding="async"
      loading={eager ? undefined : "lazy"}
      className={classes}
    />
  );
}
