/**
 * components/painel/SecaoCorrida.tsx
 *
 * A seção "Presidente: Lula × Flávio" do painel privado (ADR-0077; pedido do
 * dono em 06/10/2026). Componente de SERVIDOR: lê a corrida do retrato,
 * resolve as cores pelo token do partido (constituição § 2 — `textForParty`,
 * nunca a cor oficial) e entrega SÓ números e textos ao componente de cliente
 * (`CorridaPresidente`). As tabelas equivalentes (constituição § 4) saem daqui.
 */

import { ultimoAte } from "@/lib/painel/corrida";
import { fmtNum, horaComDia, horaCurta, msDeIso } from "@/lib/painel/eixo";
import type { CorridaPainel, RetratoPainel } from "@/lib/painel/tipos";
import { textForParty } from "@/lib/utils/party-color";

import { CorridaPresidente } from "./CorridaPresidente";
import s from "./painel.module.css";
import { TabelaRolavel, VerEmTabela } from "./Tabelas";

const BLOCO_TABELA_SEG = 5 * 60;

/** Segundos, a partir de `inicioMs`, até a próxima hora cheia `hora` (BRT). */
function segundosAte(inicioMs: number, hora: number): number {
  const brt = new Date(inicioMs - 3 * 3600_000);
  const alvo =
    Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), hora) + 3 * 3600_000;
  const t = alvo >= inicioMs ? alvo : alvo + 24 * 3600_000;
  return Math.round((t - inicioMs) / 1000);
}

export function faixasDeHorario(inicioMs: number, totalSeg: number) {
  const s17 = segundosAte(inicioMs, 17);
  const s20 = segundosAte(inicioMs, 20);
  const s23 = segundosAte(inicioMs, 23);
  return [
    { rotulo: "Noite toda", de: 0, ate: totalSeg },
    { rotulo: "17h–20h", de: s17, ate: s20 },
    { rotulo: "20h–23h", de: s20, ate: s23 },
    { rotulo: "23h–fim", de: s23, ate: totalSeg },
  ].filter((f) => f.ate > f.de && f.de >= 0 && f.ate <= totalSeg);
}

export function SecaoCorrida({ retrato }: { retrato: RetratoPainel }) {
  const c = retrato.corridaPresidente;
  if (!c || c.apuracao.t.length === 0) {
    return (
      <section id="corrida" className={s.secao} aria-labelledby="t-corrida">
        <h2 id="t-corrida">Presidente: os dois primeiros</h2>
        <p>Este retrato não tem os dados da corrida do Presidente.</p>
      </section>
    );
  }
  const inicioMs = msDeIso(retrato.eixo.inicio);
  const totalSeg = retrato.eixo.minutos * 60;
  const candidatos = c.candidatos.map((x) => ({
    nome: x.nome,
    partido: x.partido,
    tinta: textForParty(x.partido),
  }));
  const [a, b] = c.candidatos;
  const titulo = `${a?.nome ?? ""} × ${b?.nome ?? ""}`;
  const ultimo = c.apuracao.t.length - 1;
  const ref = msDeIso(retrato.janela.de);
  const trocaReal = c.trocas.filter((t) => t.apurado >= 2);

  return (
    <section id="corrida" className={s.secao} aria-labelledby="t-corrida">
      <h2 id="t-corrida">Presidente: {titulo}, ao longo da noite</h2>
      <p className={s.explica}>
        Três gráficos com o mesmo relógio e a mesma escala, um embaixo do outro. No primeiro, a
        apuração: o percentual de cada um nos votos válidos, refeito a cada arquivo de estado que
        chegou do TSE ({fmtNum(c.apuracao.t.length)} chegadas, em rajadas a cada ~5 minutos). No
        segundo, a projeção do modelo ({c.projecao.t.length} rodadas), com a margem de cada rodada
        sombreada — entre uma rodada e a seguinte vale a anterior; nada é inventado no meio. No
        terceiro, os dois juntos: apuração em linha cheia, projeção pontilhada. Passe o mouse, toque
        ou use as setas do teclado: a linha do instante aparece nos três. Cada gráfico tem um botão
        que gera, aqui no aparelho, um vídeo vertical da sua evolução e o baixa. A escala vertical
        ignora a primeira rajada (17h24), quando os estados chegavam um a um e a soma oscilava.
      </p>
      <p className={s.explica}>
        {trocaReal.length === 0
          ? `A liderança não trocou de mãos depois da primeira rajada: ${b && (c.apuracao.pct[1]?.[ultimo] ?? 0) > (c.apuracao.pct[0]?.[ultimo] ?? 0) ? b.nome : a?.nome} esteve à frente a noite toda.`
          : `A liderança trocou de mãos ${trocaReal.length} vez(es): ${trocaReal.map((t) => `${horaComDia(msDeIso(t.hora), ref)} (${c.candidatos[t.lider]?.nome})`).join(", ")}.`}{" "}
        Conferência: a soma por estado bate com o que o modelo viu ({c.conferencia.instantes}{" "}
        rodadas) com diferença máxima de {fmtNum(c.conferencia.difMaxPp, 3)} ponto
        {c.conferencia.horaDaDifMax
          ? `, às ${horaComDia(msDeIso(c.conferencia.horaDaDifMax), ref)}`
          : ""}
        . O modelo soma zonas, não estados, e lê o que estava no banco quando rodou.
      </p>

      <CorridaPresidente
        inicioMs={inicioMs}
        totalSeg={totalSeg}
        candidatos={candidatos}
        apuracao={c.apuracao}
        projecao={{
          t: c.projecao.t,
          tBoletim: c.projecao.tBoletim,
          pct: c.projecao.pct,
          lo: c.projecao.lo,
          hi: c.projecao.hi,
        }}
        faixasDeHorario={faixasDeHorario(inicioMs, totalSeg)}
      />

      <VerEmTabela>
        <TabelaApuracao corrida={c} inicioMs={inicioMs} />
        <TabelaRodadas corrida={c} inicioMs={inicioMs} />
      </VerEmTabela>
    </section>
  );
}

function TabelaApuracao({ corrida: c, inicioMs }: { corrida: CorridaPainel; inicioMs: number }) {
  const t = c.apuracao.t;
  const primeiro = t[0] ?? 0;
  const ultimo = t[t.length - 1] ?? 0;
  const linhas: number[] = [];
  for (
    let fim = Math.ceil(primeiro / BLOCO_TABELA_SEG) * BLOCO_TABELA_SEG;
    fim <= ultimo + BLOCO_TABELA_SEG;
    fim += BLOCO_TABELA_SEG
  ) {
    linhas.push(fim);
  }
  const [a, b] = c.candidatos;
  const legenda = `Apuração a cada 5 minutos: o último arquivo recebido até cada horário (${a?.nome} × ${b?.nome})`;
  return (
    <TabelaRolavel rotulo={legenda} alta>
      <table className={s.tabela}>
        <caption>{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Até</th>
            <th scope="col">{a?.nome} (%)</th>
            <th scope="col">{a?.nome} (votos)</th>
            <th scope="col">{b?.nome} (%)</th>
            <th scope="col">{b?.nome} (votos)</th>
            <th scope="col">Diferença (pontos)</th>
            <th scope="col">Diferença (votos)</th>
            <th scope="col">% apurado</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((fim) => {
            const i = ultimoAte(t, fim);
            if (i < 0) return null;
            const pa = c.apuracao.pct[0]?.[i] ?? 0;
            const pb = c.apuracao.pct[1]?.[i] ?? 0;
            const va = c.apuracao.votos[0]?.[i] ?? 0;
            const vb = c.apuracao.votos[1]?.[i] ?? 0;
            return (
              <tr key={fim}>
                <th scope="row" className={s.mono}>
                  {horaCurta(inicioMs + fim * 1000)}
                </th>
                <td>{fmtNum(pa, 3)}</td>
                <td>{fmtNum(va)}</td>
                <td>{fmtNum(pb, 3)}</td>
                <td>{fmtNum(vb)}</td>
                <td>{fmtNum(pa - pb, 3)}</td>
                <td>{fmtNum(va - vb)}</td>
                <td>{fmtNum(c.apuracao.apurado[i] ?? 0, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TabelaRolavel>
  );
}

function TabelaRodadas({ corrida: c, inicioMs }: { corrida: CorridaPainel; inicioMs: number }) {
  const [a, b] = c.candidatos;
  const legenda = `As ${c.projecao.t.length} rodadas da projeção (${a?.nome} × ${b?.nome}), com a margem de cada uma`;
  const faixa = (k: number, i: number) => {
    const p = c.projecao.pct[k]?.[i];
    const lo = c.projecao.lo[k]?.[i];
    const hi = c.projecao.hi[k]?.[i];
    if (p == null) return "—";
    return lo != null && hi != null
      ? `${fmtNum(p, 2)} (${fmtNum(lo, 2)}–${fmtNum(hi, 2)})`
      : fmtNum(p, 2);
  };
  const chance = (k: number, i: number) => {
    const v = c.projecao.pVitoria[k]?.[i];
    return v == null ? "—" : `${fmtNum(v * 100, 1)}%`;
  };
  return (
    <TabelaRolavel rotulo={legenda} alta>
      <table className={s.tabela}>
        <caption>{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Rodada</th>
            <th scope="col">Boletim usado</th>
            <th scope="col">{a?.nome} (%)</th>
            <th scope="col">{b?.nome} (%)</th>
            <th scope="col">Chance de vitória — {a?.nome}</th>
            <th scope="col">Chance de vitória — {b?.nome}</th>
          </tr>
        </thead>
        <tbody>
          {c.projecao.t.map((t, i) => (
            <tr key={t}>
              <th scope="row" className={s.mono}>
                {horaCurta(inicioMs + t * 1000)}
              </th>
              <td className={s.mono}>
                {c.projecao.tBoletim[i] == null
                  ? "—"
                  : horaCurta(inicioMs + (c.projecao.tBoletim[i] as number) * 1000)}
              </td>
              <td>{faixa(0, i)}</td>
              <td>{faixa(1, i)}</td>
              <td>{chance(0, i)}</td>
              <td>{chance(1, i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TabelaRolavel>
  );
}
