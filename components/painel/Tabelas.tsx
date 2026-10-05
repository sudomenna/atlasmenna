/**
 * components/painel/Tabelas.tsx
 *
 * Tabelas do painel privado (ADR-0077), todas de SERVIDOR:
 *
 *   - {@link VerEmTabela}: a alternativa em tabela de cada gráfico
 *     (constituição § 4), recolhida num `<details>` logo abaixo dele;
 *   - {@link TabelaPorBlocos}: séries por minuto somadas em blocos de 15 min;
 *   - {@link TabelaDeCiclos}: a lista de coletas, com filtro por cargo.
 *
 * 🔴 Toda `<table>` mora dentro de um `<div>` que rola (`.rolavel`): solta,
 * a tabela cresce até caber o conteúdo e empurra a página para os lados no
 * celular — `sr-only` também não a esconderia (memória do projeto, 2.424 px de
 * rolagem horizontal medidos).
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { cicloTemProblema, type FiltroCiclos, nomeComFatia } from "@/lib/painel/apresentar";
import { fmtNum, horaComDia, horaCurta, msDeIso, somarEmBlocos } from "@/lib/painel/eixo";
import type { CicloPainel, RetratoPainel } from "@/lib/painel/tipos";

import s from "./painel.module.css";

export function VerEmTabela({ children }: { children: ReactNode }) {
  return (
    <details className={s.detalhes}>
      <summary>Ver em tabela</summary>
      <div className={`${s.rolavel} ${s.rolavelAlta}`}>{children}</div>
    </details>
  );
}

export interface ColunaPorBlocos {
  rotulo: string;
  valores: (number | null)[];
}

/**
 * Uma linha por bloco de `bloco` minutos. `"soma"` para contagens (pedidos,
 * novidades, erros); `"ultimo"` para medidas que não se somam (% apurado).
 */
export function TabelaPorBlocos({
  legenda,
  inicioMs,
  minutos,
  colunas,
  agregacao = "soma",
  casas = 0,
  bloco = 15,
  total = false,
}: {
  legenda: string;
  inicioMs: number;
  minutos: number;
  colunas: ColunaPorBlocos[];
  agregacao?: "soma" | "ultimo";
  casas?: number;
  bloco?: number;
  total?: boolean;
}) {
  const nBlocos = Math.ceil(minutos / bloco);
  const somas = colunas.map((c) =>
    somarEmBlocos(
      c.valores.map((v) => v ?? 0),
      bloco,
    ),
  );
  const valorDoBloco = (coluna: number, b: number): number | null => {
    if (agregacao === "soma") return somas[coluna]?.[b] ?? 0;
    const valores = colunas[coluna]?.valores ?? [];
    for (let i = Math.min(valores.length, (b + 1) * bloco) - 1; i >= b * bloco; i--) {
      const v = valores[i];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  return (
    <table className={s.tabela}>
      <caption>{legenda}</caption>
      <thead>
        <tr>
          <th scope="col">Horário</th>
          {colunas.map((c) => (
            <th key={c.rotulo} scope="col">
              {c.rotulo}
            </th>
          ))}
          {total ? <th scope="col">Total</th> : null}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: nBlocos }, (_, b) => {
          const de = inicioMs + b * bloco * 60_000;
          const ate = inicioMs + Math.min(minutos, (b + 1) * bloco) * 60_000;
          const linha = colunas.map((_, i) => valorDoBloco(i, b));
          const soma = linha.reduce<number>((acc, v) => acc + (v ?? 0), 0);
          return (
            <tr key={de}>
              <th scope="row">
                {horaCurta(de)}–{horaCurta(ate)}
              </th>
              {linha.map((v, i) => (
                <td key={colunas[i]?.rotulo}>{v === null ? "—" : fmtNum(v, casas)}</td>
              ))}
              {total ? <td>{fmtNum(soma, casas)}</td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function situacao(c: CicloPainel): string {
  if (c.fim === null) return "não terminou";
  const itens: string[] = [];
  if (c.abortado) itens.push(`saiu cedo (${c.abortado})`);
  if ((c.bloqueios ?? 0) > 0) itens.push("bloqueio");
  if ((c.erros ?? 0) > 0) itens.push("erros");
  if ((c.naoEncontrados ?? 0) > 0) itens.push("não encontrados");
  if ((c.duracaoS ?? 0) > 300) itens.push("mais de 5 min");
  return itens.length ? itens.join(", ") : "ok";
}

const CARGOS_FILTRO = [1, 3, 5, 6, 7, 8] as const;

function hrefDoFiltro(f: FiltroCiclos): string {
  const p = new URLSearchParams();
  if (f.cargo !== null) p.set("cargo", String(f.cargo));
  if (!f.soProblemas) p.set("so", "todas");
  const q = p.toString();
  return `/painel${q ? `?${q}` : ""}#coletas`;
}

export function FiltroDeCiclos({
  retrato,
  filtro,
}: {
  retrato: Pick<RetratoPainel, "cargos">;
  filtro: FiltroCiclos;
}) {
  const opcoes: { rotulo: string; f: FiltroCiclos }[] = [
    { rotulo: "Todos os cargos", f: { ...filtro, cargo: null } },
    ...CARGOS_FILTRO.map((cd) => ({
      rotulo: retrato.cargos.find((c) => c.cd === cd)?.nome ?? `Cargo ${cd}`,
      f: { ...filtro, cargo: cd },
    })),
  ];
  return (
    <nav aria-label="Filtrar coletas">
      <ul className={s.chips}>
        {opcoes.map((o) => {
          const ativo = o.f.cargo === filtro.cargo;
          return (
            <li key={o.rotulo}>
              <Link
                href={hrefDoFiltro(o.f)}
                className={`${s.chip} ${ativo ? s.chipAtivo : ""}`}
                aria-current={ativo ? "true" : undefined}
                scroll={false}
              >
                {o.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className={s.chips}>
        <li>
          <Link
            href={hrefDoFiltro({ ...filtro, soProblemas: true })}
            className={`${s.chip} ${filtro.soProblemas ? s.chipAtivo : ""}`}
            aria-current={filtro.soProblemas ? "true" : undefined}
            scroll={false}
          >
            Só as com problema
          </Link>
        </li>
        <li>
          <Link
            href={hrefDoFiltro({ ...filtro, soProblemas: false })}
            className={`${s.chip} ${filtro.soProblemas ? "" : s.chipAtivo}`}
            aria-current={filtro.soProblemas ? undefined : "true"}
            scroll={false}
          >
            Todas as coletas
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function TabelaDeCiclos({
  retrato,
  ciclos,
  total,
}: {
  retrato: Pick<RetratoPainel, "cargos" | "janela">;
  ciclos: CicloPainel[];
  /** Quantas coletas há sem filtro nenhum — para dizer "N de M". */
  total: number;
}) {
  const ref = msDeIso(retrato.janela.de);
  const h = (iso: string | null) => (iso === null ? "—" : horaComDia(msDeIso(iso), ref));
  const n = (v: number | null, casas = 0) => (v === null ? "—" : fmtNum(v, casas));
  return (
    <div className={`${s.rolavel} ${s.rolavelAlta}`}>
      <table className={s.tabela}>
        <caption>
          Mostrando {fmtNum(ciclos.length)} de {fmtNum(total)} coletas, em ordem de término. Linhas
          destacadas tiveram algum problema (coluna "Situação").
        </caption>
        <thead>
          <tr>
            <th scope="col">Cargo</th>
            <th scope="col">Início</th>
            <th scope="col">Fim</th>
            <th scope="col">Duração (s)</th>
            <th scope="col">Pedidos</th>
            <th scope="col">Novidades</th>
            <th scope="col">Iguais</th>
            <th scope="col">Não encontrados</th>
            <th scope="col">Erros</th>
            <th scope="col">Bloqueios</th>
            <th scope="col">Espera (s)</th>
            <th scope="col">Pediu projeção</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {ciclos.map((c) => (
            <tr
              key={`${c.cargo}-${c.fatia ?? 0}-${c.inicio}-${c.fim ?? "x"}`}
              className={cicloTemProblema(c) ? s.linhaProblema : undefined}
            >
              <th scope="row">{nomeComFatia(retrato, c.cargo, c.fatia)}</th>
              <td className={s.mono}>{h(c.inicio)}</td>
              <td className={s.mono}>{h(c.fim)}</td>
              <td>{n(c.duracaoS, 1)}</td>
              <td>{n(c.pedidos)}</td>
              <td>{n(c.novidades)}</td>
              <td>{n(c.inalterados)}</td>
              <td>{n(c.naoEncontrados)}</td>
              <td>{n(c.erros)}</td>
              <td>{n(c.bloqueios)}</td>
              <td>{n(c.esperaS, 0)}</td>
              <td>{c.fim === null ? "—" : c.modeloAcionado ? "sim" : "não"}</td>
              <td className={s.texto}>{situacao(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
