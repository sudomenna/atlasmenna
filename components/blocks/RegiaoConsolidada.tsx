/**
 * components/blocks/RegiaoConsolidada.tsx
 *
 * Uma região das capas `/governador`, `/senador` e da home de Presidente —
 * ADR-0057, versão C do protótipo
 * (`docs/design-system/prototipos/capas-regioes-2026-09-28/`).
 *
 * Server Component. Monta o CONSOLIDADO da região (nome, "N estados", "Na
 * região: <líder> X%", % apurado, barra empilhada 100%, legenda com os 6 + Outros
 * e a linha da base) e entrega os cartões dos estados (`children`) ao
 * `<RegiaoRecolhivel>`, o único pedaço de cliente, que abre e fecha.
 *
 * ## As duas bases no DOM
 *
 * O resumo sai duas vezes, uma por base, com `data-view-only="proj"` e
 * `data-view-only="parcial"` — a mesma mecânica do painel "1º ou 2º turno" de
 * `/governador`: a chave "Parcial / Projeção" do `<TopBar>` escreve
 * `data-view` no `<html>` e a cascata de `app/globals.css` mostra só a base
 * ativa (e tira a outra da árvore de acessibilidade). Sem JS nenhum.
 *
 * ## O consolidado soma TODOS os estados da região
 *
 * `ufs` são sempre os estados da região inteira; `children` podem ser menos
 * (o filtro de status de `/governador` age só nos cartões — ADR-0057 item 5).
 *
 * ## Cor (constituição § 2 e § 4)
 *
 *   - Barra e amostra da legenda são PREENCHIMENTO → `colorForParty` (cor
 *     base), com o contorno de `DATA_FILL_STROKE` repetido no CSS module
 *     (`1px solid var(--text-secondary)`): PSOL, PSB, NOVO e o cinza de
 *     "Outros" não chegam a 3:1 contra o papel sem ele.
 *   - O número do líder e os percentuais da legenda são TEXTO →
 *     `textForParty` (≥ 4,5:1, `tests/unit/design-system/party-text-contrast`).
 *   - Nunca `cor` do payload (`tests/unit/components/cor-nunca-do-payload`).
 *
 * A barra é `aria-hidden`: a legenda, que é texto, carrega os mesmos números.
 */

import type { CSSProperties, ReactNode } from "react";

import type { Regiao } from "@/lib/config/regioes";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import {
  type BaseConsolidado,
  type ChaveConsolidado,
  type ConsolidadoRegiao,
  consolidarRegiao,
  type LinhaConsolidado,
} from "@/lib/utils/consolidado-regiao";
import { formatPercentTrim, formatVotesCompact } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { colorForParty, textForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

import styles from "./RegiaoConsolidada.module.css";
import { RegiaoRecolhivel } from "./RegiaoRecolhivel";

export interface RegiaoConsolidadaProps {
  regiao: Regiao;
  /** TODOS os estados da região presentes no payload — a base do consolidado. */
  ufs: readonly EdgeUfRow[];
  /** `"partido"` (Governador/Senador) ou `"candidato"` (Presidente). */
  chave: ChaveConsolidado;
  /** Senado: os percentuais são "% dos votos" (cada eleitor vota duas vezes). */
  senado?: boolean;
  /** Nível do título da região. */
  nivel: 2 | 3;
  /** Default `true`. */
  abertaInicial?: boolean;
  /** Os cartões (ou o aviso de filtro vazio). */
  children: ReactNode;
}

const COR_OUTROS = colorForParty(null);

function rotuloDe(l: LinhaConsolidado, chave: ChaveConsolidado): string {
  if (chave === "candidato") return l.nome ? nomeExibicao(l.nome, l.sqcand) : `Cand ${l.chave}`;
  return siglaExibicao(l.partido ?? l.chave);
}

function textoMotivo(c: ConsolidadoRegiao, base: BaseConsolidado): string {
  switch (c.motivo) {
    case "sem_total_projetado":
      return "Projeção da região indisponível: falta o total projetado de algum estado.";
    case "sem_contagem":
      return "Contagem da região indisponível neste momento.";
    default:
      return base === "proj"
        ? "Ainda não há votos projetados na região."
        : "Ainda não há votos contados na região.";
  }
}

/** Largura com 2 casas — sub-pixel a mais não muda o desenho, só bytes. */
const w = (pct: number) => `${Math.round(Math.max(0, Math.min(100, pct)) * 100) / 100}%`;

/**
 * O andamento da contagem, por base (decisão do dono de 20/09: a visão
 * Parcial não mostra leitura do modelo nenhuma):
 *
 *   - Projeção → "X% apurado". O denominador (`votos_disputa_projetados`) é o
 *     total PROJETADO — saída do modelo, por isso só aqui.
 *   - Parcial  → "8,3 mi votos contados". Só o que já saiu das urnas.
 */
function andamento(c: ConsolidadoRegiao, base: BaseConsolidado): string {
  if (base === "proj") {
    return c.pctApurado === null ? "apurado —" : `${formatPercentTrim(c.pctApurado)} apurado`;
  }
  if (c.votosContados === null) return "votos contados —";
  const n = c.votosContados;
  return `${formatVotesCompact(n)} ${n === 1 ? "voto contado" : "votos contados"}`;
}

/**
 * 🔴 Markup ENXUTO (2026-09-28): uma classe local na raiz (`.resumo`) e os
 * filhos alcançados por estrutura em `RegiaoConsolidada.module.css`. No
 * `style` só vai o que é DADO — `--w` (largura do segmento) e `--cor`/`--tx`
 * (cor base e cor de texto do partido). Ver o cabeçalho do CSS.
 */
function Resumo({
  base,
  c,
  chave,
  senado,
}: {
  base: BaseConsolidado;
  c: ConsolidadoRegiao;
  chave: ChaveConsolidado;
  senado: boolean;
}) {
  const lider = c.disponivel ? c.linhas[0] : undefined;
  const baseTxt = `${base === "proj" ? "Projeção" : "Parcial"} · ${
    senado ? "% dos votos" : "% dos votos válidos em disputa"
  }`;

  return (
    <div className={styles.resumo} data-view-only={base}>
      <p>
        Na região:{" "}
        {lider ? (
          <b data-testid="regiao-lider" style={{ color: textForParty(lider.partido) }}>
            {rotuloDe(lider, chave)} {formatPercentTrim(lider.pct)}
          </b>
        ) : (
          <b data-testid="regiao-lider">—</b>
        )}{" "}
        · <span data-testid="regiao-andamento">{andamento(c, base)}</span>
      </p>
      {c.disponivel ? (
        <>
          <div aria-hidden="true">
            {c.linhas.map((l) => (
              <i
                key={l.chave}
                style={{ "--w": w(l.pct), "--cor": colorForParty(l.partido) } as CSSProperties}
              />
            ))}
            {c.outros ? (
              <i style={{ "--w": w(c.outros.pct), "--cor": COR_OUTROS } as CSSProperties} />
            ) : null}
          </div>
          <ul>
            {c.linhas.map((l) => (
              <li
                key={l.chave}
                style={
                  {
                    "--cor": colorForParty(l.partido),
                    "--tx": textForParty(l.partido),
                  } as CSSProperties
                }
              >
                <i />
                {rotuloDe(l, chave)} <span>{formatPercentTrim(l.pct)}</span>
              </li>
            ))}
            {c.outros ? (
              <li style={{ "--cor": COR_OUTROS } as CSSProperties}>
                <i />
                Outros {formatPercentTrim(c.outros.pct)}
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <p data-testid="regiao-indisponivel">{textoMotivo(c, base)}</p>
      )}
      <p>{baseTxt}</p>
    </div>
  );
}

export function RegiaoConsolidada({
  regiao,
  ufs,
  chave,
  senado = false,
  nivel,
  abertaInicial = true,
  children,
}: RegiaoConsolidadaProps) {
  const proj = consolidarRegiao(ufs, "proj", chave);
  const parcial = consolidarRegiao(ufs, "parcial", chave);
  const n = regiao.siglas.length;

  return (
    <RegiaoRecolhivel
      nome={regiao.nome}
      contagem={`${n} ${n === 1 ? "estado" : "estados"}`}
      nivel={nivel}
      abertaInicial={abertaInicial}
      regiaoId={regiao.id}
      resumo={
        <>
          <Resumo base="proj" c={proj} chave={chave} senado={senado} />
          <Resumo base="parcial" c={parcial} chave={chave} senado={senado} />
        </>
      }
    >
      {children}
    </RegiaoRecolhivel>
  );
}
