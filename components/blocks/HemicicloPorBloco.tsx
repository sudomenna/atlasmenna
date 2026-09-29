/**
 * components/blocks/HemicicloPorBloco.tsx — o plenário por BLOCO de relação com
 * o governo Lula (spec 025, RF-240/RF-241; ADR-0061 item 4). Serve à V1
 * (Senado de 2027) e à Câmara de 2027. Construído sobre `<Hemiciclo>`.
 *
 * ## O que ele desenha — e o que não desenha
 *
 *   - **Ordem fixa do catálogo** (`ORDEM_BLOCOS_HEMICICLO`): Base do governo
 *     Lula à esquerda → Independentes → cadeiras ainda sem dono → Oposição ao
 *     governo Lula à direita. Decisão do dono (29/09). A ordem nunca muda com
 *     a apuração nem com a etiqueta de ninguém.
 *   - **A posição reflete a RELAÇÃO COM O GOVERNO LULA, não ideologia.** O
 *     `<desc>`, o título e o placar dizem isso em texto, e dizem "governo
 *     Lula" — em 2027 o governo pode ser outro (ADR-0061, Consequências).
 *   - **Marcas de limiar FORA do arco externo, contadas da esquerda** — medem
 *     a distância da Base a cada limiar (maioria absoluta, três quintos, dois
 *     terços). O placar em texto dá a mesma distância para a Oposição, contada
 *     do outro lado: a figura mede uma direção, o texto mede as duas
 *     (critério simétrico, constituição § 2 (g)).
 *   - **Sem firmeza por cadeira.** A visão por partido, logo acima na mesma
 *     página, já pinta o que é firme e o que é projeção cadeira a cadeira; aqui
 *     o desenho mostra só o bloco, e o placar em texto detalha de onde vem
 *     cada número (até 2031 / apuração concluída / pela projeção). É o mesmo
 *     tratamento da barra "As 54 vagas em disputa", que também não distingue.
 *
 * ## Cor: nenhuma (constituição § 2 (d))
 *
 * Três texturas em TINTA NEUTRA sobre o papel — cheia (Base), hachurada
 * (Independentes), vazada (Oposição) — e cinza com contorno tracejado para a
 * cadeira sem dono. Nenhum tom de cinza intermediário: medido em 29/09, todo
 * cinza entre a tinta e o papel fica a ΔE76 < 10 de algum nível de "Outros"
 * da paleta de partido (só a tinta `--text-primary` passa nos dois temas). A
 * textura não depende de cor, e cada bloco também é nomeado no texto.
 *
 * ## Marca que cai DENTRO de uma coluna (maioria absoluta: 41 e 257)
 *
 * `marcaDeLimiar` avisa `empate` quando as cadeiras k−1 e k estão na mesma
 * coluna — nenhuma linha radial as separa. A varredura desta visão
 * (`layoutPorBloco`) garante que, numa coluna partida, as cadeiras de ANTES
 * são as de DENTRO; então a marca é desenhada no ângulo da coluna, fora do
 * arco, e um traço CURTO e tangencial corta a coluna entre o último arco de
 * antes e o primeiro de depois (`raioCorte`). A legenda diz em texto quantas
 * cadeiras da coluna contam antes da marca. O número exato, de qualquer
 * forma, está no placar.
 *
 * ## Server Component, zero JavaScript
 *
 * Mesma razão do `<Hemiciclo>`: o custo é HTML, e o teste de peso
 * (`tests/unit/components/hemiciclo-por-bloco-peso.test.tsx`) o trava.
 */

import type { ReactNode } from "react";

import {
  agruparEmTrechos,
  CINZA_ASSENTO,
  CONTORNO_NEUTRO,
  Hemiciclo,
} from "@/components/blocks/Hemiciclo";
import {
  type BlocoHemiciclo,
  ORDEM_BLOCOS_HEMICICLO,
  ROTULO_BLOCO_HEMICICLO,
} from "@/lib/etiquetas/catalogo";
import type { OrigemCadeira, VisaoPorBloco } from "@/lib/etiquetas/visoes";
import { pontoNoAngulo } from "@/lib/utils/hemiciclo";
import {
  FOLGA_MARCAS,
  layoutPorBloco,
  limiaresDaCasa,
  type MarcaBloco,
  marcaDoBloco,
  type NomeLimiar,
  raiosDaMarca,
} from "@/lib/utils/hemiciclo-bloco";

/** A tinta neutra do site (ink-0 nos dois temas) — a única "cor" desta visão. */
export const TINTA_BLOCO = "var(--text-primary)";
/** O papel do cartão — o fundo da cadeira vazada e da hachura. */
export const PAPEL_BLOCO = "var(--surface-card)";

/** Nome de cada limiar em texto, e para que ele serve em cada casa. */
export const TEXTO_LIMIAR: Readonly<
  Record<NomeLimiar, { nome: string; senado: string; camara: string }>
> = {
  maioria_absoluta: {
    nome: "maioria absoluta",
    senado: "aprovar lei complementar",
    camara: "aprovar lei complementar",
  },
  tres_quintos: {
    nome: "três quintos",
    senado: "aprovar emenda constitucional",
    camara: "aprovar emenda constitucional",
  },
  dois_tercos: {
    nome: "dois terços",
    senado: "condenar em processo de impeachment",
    camara: "autorizar processo de impeachment do presidente",
  },
};

type Pintura = { fill: string; stroke: string; tracejado?: boolean };

export function pinturaDoBloco(bloco: BlocoHemiciclo, idHachura: string): Pintura {
  switch (bloco) {
    case "base_governo":
      return { fill: TINTA_BLOCO, stroke: TINTA_BLOCO };
    case "independente":
      return { fill: `url(#${idHachura})`, stroke: TINTA_BLOCO };
    case "oposicao":
      return { fill: PAPEL_BLOCO, stroke: TINTA_BLOCO };
    default:
      return { fill: CINZA_ASSENTO, stroke: CONTORNO_NEUTRO, tracejado: true };
  }
}

function arred(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** O padrão de hachura (Independentes), em unidades do `viewBox` da figura. */
function Hachura({ id, passo }: { id: string; passo: number }) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={passo}
      height={passo}
      patternTransform="rotate(45)"
    >
      <rect width={passo} height={passo} fill={PAPEL_BLOCO} />
      <rect width={arred(passo * 0.45)} height={passo} fill={TINTA_BLOCO} />
    </pattern>
  );
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "Base do governo Lula 34 — faltam 7 para 41" / "— alcança 41". */
export function frasePlacar(rotulo: string, tem: number, k: number): string {
  return tem >= k
    ? `${rotulo} ${tem} — alcança ${k}`
    : `${rotulo} ${tem} — faltam ${k - tem} para ${k}`;
}

/**
 * A frase da marca que cai dentro de uma coluna — em texto, porque o traço
 * curto sozinho não diz quantas cadeiras de cada lado.
 */
export function fraseEmpate(m: Pick<MarcaBloco, "k" | "colunaAntes" | "colunaDepois">): string {
  const n = m.colunaAntes + m.colunaDepois;
  const antes = m.colunaAntes === 1 ? "a de dentro conta" : `as ${m.colunaAntes} de dentro contam`;
  const depois = m.colunaDepois === 1 ? "a de fora" : `as ${m.colunaDepois} de fora`;
  return (
    `A marca de ${m.k} cai na coluna do meio: das ${n} cadeiras dessa coluna, ${antes} antes ` +
    `da marca e ${depois}, depois — o traço curto dentro da coluna mostra o corte.`
  );
}

export interface HemicicloPorBlocoProps {
  visao: VisaoPorBloco;
  /** `ARCOS_SENADO` ou `ARCOS_CAMARA` — constante por casa (ADR-0061 item 1). */
  arcos: number;
  casa: "senado" | "camara";
  /** Prefixo dos `id` internos — único na página. */
  idPrefixo: string;
  /** Texto do `<title>` e do cabeçalho acessível da figura. */
  titulo: string;
  /** Como a visão chama a cadeira sem dono ("aguardando apuração", "ainda sem dono"). */
  rotuloAguardando: string;
  /** Detalhe de origem de um bloco, em texto (placar). */
  detalheOrigem?: (porOrigem: Partial<Record<OrigemCadeira, number>>) => string | null;
  /** Nota extra sob o placar (fonte, data da foto…). */
  nota?: ReactNode;
}

export function HemicicloPorBloco({
  visao,
  arcos,
  casa,
  idPrefixo,
  titulo,
  rotuloAguardando,
  detalheOrigem,
  nota,
}: HemicicloPorBlocoProps) {
  const layout = layoutPorBloco(visao.total, arcos);
  const idHachura = `${idPrefixo}-hachura`;
  const placarId = `${idPrefixo}-placar`;
  const limiaresId = `${idPrefixo}-limiares`;
  const passo = arred(Math.max(1, layout.raioAssento * 0.9));

  const trechos = agruparEmTrechos(
    visao.cadeiras,
    (a, b) => a.bloco === b.bloco,
    (c, inicio) => ({
      chave: `${c.bloco}-${inicio}`,
      estado: c.bloco,
      ...pinturaDoBloco(c.bloco, idHachura),
      dados: { "data-bloco": c.bloco },
    }),
  );

  const limiares = limiaresDaCasa(visao.total);
  const marcas = limiares
    .map((l) => marcaDoBloco(layout, l))
    .filter((m): m is MarcaBloco => m !== null);
  const r = raiosDaMarca(layout);
  const fonte = 8;
  const rotuloDe = (b: BlocoHemiciclo) =>
    b === "aguardando" ? rotuloAguardando : ROTULO_BLOCO_HEMICICLO[b];

  const sobreposicao = (
    <g data-testid="hemiciclo-bloco-marcas" stroke={TINTA_BLOCO} fill={TINTA_BLOCO}>
      {marcas.map((m) => {
        const a = pontoNoAngulo(layout, m.theta, r.inicio);
        const b = pontoNoAngulo(layout, m.theta, r.fim);
        const t = pontoNoAngulo(layout, m.theta, r.rotulo);
        let corte: ReactNode = null;
        if (m.empate && m.raioCorte !== null) {
          const delta = (layout.raioAssento * 1.3) / m.raioCorte;
          const c1 = pontoNoAngulo(layout, m.theta + delta, m.raioCorte);
          const c2 = pontoNoAngulo(layout, m.theta - delta, m.raioCorte);
          corte = (
            <line
              data-testid="hemiciclo-bloco-corte"
              x1={c1.x}
              y1={c1.y}
              x2={c2.x}
              y2={c2.y}
              strokeWidth={arred(Math.max(0.6, layout.raioAssento * 0.2))}
            />
          );
        }
        return (
          <g
            key={m.id}
            data-limiar={m.id}
            data-k={m.k}
            data-empate={m.empate ? "true" : undefined}
            data-theta={arred(m.theta)}
          >
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1} />
            {corte}
            <text
              x={t.x}
              y={t.y}
              stroke="none"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fonte}
              fontWeight={600}
            >
              {m.k}
            </text>
          </g>
        );
      })}
    </g>
  );

  const nomesLimiares = limiares.map((l) => `${l.k} (${TEXTO_LIMIAR[l.id].nome})`).join(", ");
  const descricao =
    `Cada bolinha é uma cadeira: ${visao.total} no total. Da esquerda para a direita: ` +
    ORDEM_BLOCOS_HEMICICLO.map((b) => `${rotuloDe(b)} (${visao.contagem[b]})`).join(", ") +
    ". A posição de cada bloco reflete a relação com o governo Lula, não posição ideológica." +
    (nomesLimiares ? ` Marcas fora do arco, contadas da esquerda: ${nomesLimiares}.` : "");

  const empates = marcas.filter((m) => m.empate && m.raioCorte !== null);

  return (
    <div
      data-testid="hemiciclo-por-bloco"
      data-casa={casa}
      data-total={visao.total}
      className="flex flex-col"
      style={{ gap: "var(--space-3)" }}
    >
      <Hemiciclo
        layout={layout}
        trechos={trechos}
        titulo={titulo}
        descricao={descricao}
        descritoPorId={`${placarId} ${limiaresId}`}
        idPrefixo={idPrefixo}
        testId="hemiciclo-por-bloco-figura"
        legendaTestId="hemiciclo-por-bloco-legenda"
        style={{ maxWidth: "36rem" }}
        folga={FOLGA_MARCAS}
        defs={<Hachura id={idHachura} passo={passo} />}
        sobreposicao={sobreposicao}
        legenda={
          <ul
            className="flex flex-wrap"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              columnGap: "var(--space-4)",
              rowGap: "var(--space-1)",
            }}
          >
            {ORDEM_BLOCOS_HEMICICLO.map((b) => (
              <li
                key={b}
                data-testid="hemiciclo-bloco-legenda-item"
                data-bloco={b}
                className="inline-flex items-center"
                style={{ gap: "var(--space-1)" }}
              >
                <Amostra bloco={b} idPrefixo={idPrefixo} />
                <span>{rotuloDe(b)}</span>
              </li>
            ))}
          </ul>
        }
      />

      <ul
        id={placarId}
        data-testid="hemiciclo-bloco-placar"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          font: "var(--type-body-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {ORDEM_BLOCOS_HEMICICLO.map((b) => {
          const detalhe = detalheOrigem?.(visao.porOrigem[b]) ?? null;
          return (
            <li key={b} data-bloco={b}>
              <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {rotuloDe(b)}
              </strong>
              : {plural(visao.contagem[b], "cadeira", "cadeiras")}
              {detalhe && visao.contagem[b] > 0 ? ` (${detalhe})` : ""}
            </li>
          );
        })}
      </ul>

      <ul
        id={limiaresId}
        data-testid="hemiciclo-bloco-limiares"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          font: "var(--type-body-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {limiares.map((l) => (
          <li key={l.id} data-limiar={l.id}>
            <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {l.k} — {TEXTO_LIMIAR[l.id].nome}
            </strong>{" "}
            ({TEXTO_LIMIAR[l.id][casa]}):{" "}
            {frasePlacar(ROTULO_BLOCO_HEMICICLO.base_governo, visao.contagem.base_governo, l.k)};{" "}
            {frasePlacar(ROTULO_BLOCO_HEMICICLO.oposicao, visao.contagem.oposicao, l.k)}.
          </li>
        ))}
      </ul>

      <p
        className="max-w-prose"
        style={{
          margin: 0,
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          textWrap: "pretty",
        }}
      >
        As marcas fora do arco contam cadeiras a partir da esquerda: se a Base do governo Lula passa
        de uma marca, ela sozinha alcança aquele limiar. A distância da Oposição, contada do outro
        lado, está no texto acima.
        {empates.map((m) => (
          <span key={m.id} data-testid="hemiciclo-bloco-nota-empate">
            {" "}
            {fraseEmpate(m)}
          </span>
        ))}{" "}
        {nota}
      </p>
    </div>
  );
}

/** A amostra de um bloco na legenda — a mesma textura da figura, em miniatura. */
function Amostra({ bloco, idPrefixo }: { bloco: BlocoHemiciclo; idPrefixo: string }) {
  const id = `${idPrefixo}-amostra-hachura`;
  const p = pinturaDoBloco(bloco, id);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{ flex: "none" }}
    >
      {bloco === "independente" ? (
        <defs>
          <Hachura id={id} passo={2.6} />
        </defs>
      ) : null}
      <circle
        cx="6"
        cy="6"
        r="4.4"
        strokeWidth="1.6"
        fill={p.fill}
        stroke={p.stroke}
        strokeDasharray={p.tracejado ? "2 1.4" : undefined}
      />
    </svg>
  );
}
