/**
 * components/atoms/data/CandidateAvatar.tsx
 *
 * RF-151 — foto oficial do candidato, ou as iniciais no mesmo espaço.
 *
 * **Este é o único lugar do repositório que renderiza uma imagem.** Até
 * 2026-09-13 não existia nenhum `<img>` nem `next/image` em `app/` ou
 * `components/` (ADR-0041, item 4, verificado por grep). Não há precedente
 * interno a copiar, então as cinco decisões abaixo ficam escritas aqui em vez
 * de implícitas — quem chegar depois vai querer "otimizar" pelo menos três
 * delas.
 *
 * ## 1. `<img>` nativo, não `next/image`
 *
 * O ADR-0041 item 4 deixa a escolha ao implementador e exige só uma coisa das
 * duas: **não pagar o pipeline de otimização da Vercel**. A foto do TSE já
 * chega em 161×225 px — exatamente o tamanho de render —, são ~7.700 fontes, e
 * a Vercel cobra por imagem-fonte transformada. Otimizar é custo puro por ganho
 * zero.
 *
 * Entre `next/image unoptimized` e `<img>`, vence o `<img>`: `next/image` é um
 * Client Component no App Router, então importá-lo de um Server Component abre
 * uma fronteira de cliente e traz runtime para o bundle. **RNF-007a está em
 * 148,7 KiB de 150** — 1,3 KiB de folga —, e o RF-146 é literal sobre "sem
 * JavaScript de aplicação novo". `<img>` custa zero byte de JS.
 *
 * Consequência registrada: `next.config.ts:13-15` declara
 * `images.remotePatterns` para `*.public.blob.vercel-storage.com` desde o
 * ADR-0032 e **continua sem consumidor**. Não remover — é o que permite trocar
 * para `next/image` sem mudança de config caso o orçamento de bundle abra.
 *
 * ## 2. `width` e `height` explícitos, sempre
 *
 * Imagem sem dimensão declarada é a causa clássica de CLS, e RNF-002 é a
 * métrica de autoridade. Os atributos ficam nos números reais do TSE (161×225);
 * o CSS pode esticar a caixa (`responsive`), e o navegador deriva a proporção
 * dos atributos — é isso que mantém o CLS em zero mesmo numa grade fluida.
 *
 * O fallback de iniciais usa `aspect-ratio` com os MESMOS números, para ocupar
 * exatamente o mesmo espaço (RF-151: "não deixar o espaço colapsar").
 *
 * ## 3. `alt=""` + `aria-hidden="true"` — a foto é decorativa
 *
 * O nome do candidato está em texto ao lado, dentro do mesmo card. Imagem
 * redundante a texto adjacente é decorativa por WCAG 1.1.1; repetir o nome no
 * `alt` faria o leitor de tela anunciar a mesma pessoa duas vezes.
 *
 * ⚠️ O ADR-0041 registra que nenhuma auditoria de `alt` foi feita e **presume**
 * "nome do candidato". Esta é a decisão contrária, tomada no design 018 § D6
 * item 3 com o motivo escrito. É gate do `a11y-perf-auditor` antes de `shipped`.
 *
 * ## 4. `loading="lazy"`, exceto as primeiras células
 *
 * A grade tem centenas de cards (cargo 6 em SP: ~1.131). Carregar tudo
 * derrubaria o LCP que o RNF-002 protege. As ~6 primeiras células passam
 * `eager` — e **nenhuma** usa `priority`/`fetchpriority="high"`: dar preload a
 * um JPEG de 3 KB compete com o LCP real da página em vez de ajudá-lo.
 *
 * ## 5. Cor: nunca `colorForParty` como preenchimento de área
 *
 * O default do fallback é o par neutro do kit — `--surface-sunken` (#E9EBEE)
 * com `--text-secondary` (#5B636E), **5,01:1**, medido em `app/globals.css`.
 * `colorForParty` como área reprova WCAG 1.4.11 em PSOL (2,08) e NOVO (2,72),
 * risco aberto em `docs/reference/risks.md`, e uma grade de milhares de cards
 * seria a maior superfície desse defeito no produto inteiro (design 018 § D7).
 *
 * `background`/`ink` existem como par opcional para o chamador que já tem um
 * par MEDIDO (é o caso do `<CandidateRow />`, que usa a cor de rank `-strong`).
 * Passar um sem o outro é inseguro e ninguém avisa em runtime — mesma regra do
 * `<PartyTag filled>`.
 *
 * Server Component puro: zero estado, zero evento, zero JS novo.
 */

import type { CSSProperties } from "react";

/** Largura da foto que o TSE publica, em px (ADR-0041, contexto). */
export const CANDIDATE_PHOTO_WIDTH = 161;
/** Altura da foto que o TSE publica, em px (ADR-0041, contexto). */
export const CANDIDATE_PHOTO_HEIGHT = 225;

/**
 * Iniciais de um nome — primeira letra do primeiro nome + primeira do último.
 *
 * **Extraída** de `components/atoms/tables/CandidateRow.tsx`, onde nasceu como
 * `defaultIniciais` local. Vive aqui, e não lá, porque este módulo é o dono do
 * avatar; `CandidateRow` passou a importar daqui. Duas implementações de
 * iniciais divergiriam em silêncio no primeiro nome composto.
 *
 * `lib/utils/` seria o lugar natural, mas o território desta tarefa não inclui
 * `lib/` — mover para lá é uma limpeza posterior, sem mudança de comportamento.
 */
export function iniciaisDe(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export interface CandidateAvatarProps {
  /** Nome exibido ao lado do avatar. Só alimenta as iniciais — nunca o `alt`. */
  nome: string;
  /**
   * URL pública da foto no Blob, ou `null` quando não há.
   *
   * `null` cobre os dois casos, e de propósito: `foto_ok === false` na fatia
   * (o TSE não publicou foto para este `sqcand`) e ambiente sem Blob
   * configurado (`blobUrlFor` devolve `null`). Nos dois, o card continua
   * inteiro — é o que o RF-151 exige.
   */
  fotoUrl: string | null;
  /** Iniciais explícitas; por default saem de {@link iniciaisDe}. */
  iniciais?: string;
  /** Largura em px dos atributos da imagem. Default: a do TSE (161). */
  width?: number;
  /** Altura em px dos atributos da imagem. Default: a do TSE (225). */
  height?: number;
  /**
   * `true` → a caixa ocupa 100% da coluna e a altura sai da proporção
   * `width/height` (grade fluida, CLS zero). `false` → caixa fixa em px.
   */
  responsive?: boolean;
  /** `true` → borda circular/pílula, para o avatar pequeno de lista. */
  rounded?: boolean;
  /** Fundo do fallback. Só troque com um par MEDIDO — ver o bloco 5 no topo. */
  background?: string;
  /** Tinta das iniciais. Anda junto de `background`; um sem o outro é inseguro. */
  ink?: string;
  /**
   * `true` só para as primeiras células da grade — vira `loading="eager"`.
   * Nunca vira `priority`/`fetchpriority`: ver o bloco 4 no topo.
   */
  eager?: boolean;
  /**
   * `true` → o átomo NÃO emite `style` inline: caixa, forma, `object-fit`,
   * `object-position` e as cores do fallback vêm todos de `className`.
   *
   * Existe por peso de HTML (2026-09-27, versão D da lista do `<ResultPanel>`):
   * o `style` do avatar é idêntico em todas as linhas de uma lista, e repetido
   * 12 vezes por painel ele era uma fatia grande do HTML da home — que o
   * RNF-007a mede. Numa lista, a folha de estilo diz uma vez o que o `style`
   * dizia doze. Os atributos `width`/`height` da `<img>` continuam saindo
   * (reserva de caixa antes da CSS, CLS zero); a CSS os sobrescreve.
   *
   * 🔴 Quem liga isto é responsável pela forma inteira — sem a classe, a foto
   * sai no tamanho dos atributos, sem círculo e sem `object-fit`.
   */
  semEstiloInline?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function CandidateAvatar({
  nome,
  fotoUrl,
  iniciais,
  width = CANDIDATE_PHOTO_WIDTH,
  height = CANDIDATE_PHOTO_HEIGHT,
  responsive = true,
  rounded = false,
  background = "var(--surface-sunken)",
  ink = "var(--text-secondary)",
  eager = false,
  semEstiloInline = false,
  className,
  style,
}: CandidateAvatarProps) {
  // A caixa é a MESMA com e sem foto — é o que faz o card sem foto ocupar
  // exatamente o espaço do card com foto (RF-151, CLS zero do RNF-002).
  const box: CSSProperties = responsive
    ? { width: "100%", height: "auto", aspectRatio: `${width} / ${height}` }
    : { width, height };

  const shape: CSSProperties = {
    display: "block",
    flex: "none",
    borderRadius: rounded ? "var(--radius-pill)" : "var(--radius-sm)",
    ...box,
    ...style,
  };

  if (fotoUrl) {
    return (
      /*
       * `next/image` é Client Component no App Router: importá-lo aqui abriria
       * fronteira de cliente numa rota que o RF-146 exige sem JS novo, e a
       * fonte já chega no tamanho de render, então o pipeline de otimização da
       * Vercel é custo puro (ADR-0041 item 4, que autoriza as duas formas).
       * Ver o bloco 1 no cabeçalho deste arquivo.
       */
      // biome-ignore lint/performance/noImgElement: ADR-0041 item 4 + design 018 § D6 — ver acima.
      <img
        src={fotoUrl}
        // `alt=""` + `aria-hidden` porque o nome está em texto no mesmo card —
        // imagem redundante a texto adjacente é decorativa (WCAG 1.1.1).
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        data-testid="candidate-avatar-photo"
        className={className}
        style={
          semEstiloInline
            ? style
            : { objectFit: "cover", background: "var(--surface-sunken)", ...shape }
        }
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      data-testid="candidate-avatar-fallback"
      className={["flex items-center justify-center", className].filter(Boolean).join(" ")}
      style={
        semEstiloInline
          ? style
          : {
              background,
              color: ink,
              font: "var(--type-figure)",
              letterSpacing: "var(--tracking-caps)",
              ...shape,
            }
      }
    >
      {iniciais ?? iniciaisDe(nome)}
    </div>
  );
}
