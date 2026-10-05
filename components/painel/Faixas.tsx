/**
 * components/painel/Faixas.tsx
 *
 * Gráficos em FAIXAS do painel privado (ADR-0077) — um por cargo, empilhados,
 * no mesmo eixo do tempo:
 *
 *   - {@link RodadasDaProjecao}: um tique por rodada do modelo, com os buracos
 *     sombreados (falha em tom de alerta, "sem novidade" em cinza);
 *   - {@link DuracaoDosCiclos}: um ponto por rodada de pedidos ao TSE, na
 *     altura da duração, com a linha dos 5 minutos.
 *
 * Faixas (pequenos múltiplos) e não um gráfico só com seis cores: com seis
 * séries no mesmo plano, a cor sozinha não separa os cargos para quem tem
 * daltonismo. Aqui o NOME da faixa identifica o cargo.
 *
 * Componentes de SERVIDOR (sem `"use client"`): o SVG sai pronto no HTML.
 * Mesma geometria do `GraficoPorMinuto` — `viewBox` em minutos,
 * `preserveAspectRatio="none"`, traço que não engrossa ao esticar, nenhum texto
 * dentro do SVG.
 */

import { marcasDeHora, minutoNoEixo, msDeIso } from "@/lib/painel/eixo";
import type { BuracoProjecao, CargoDoPainel, CicloPainel, RodadaPainel } from "@/lib/painel/tipos";

import s from "./painel.module.css";

export function corDoCargo(cd: number): string {
  return `var(--painel-cargo-${cd})`;
}

export function ReguaDeHoras({ inicioMs, minutos }: { inicioMs: number; minutos: number }) {
  return (
    <div className={s.faixaRegua} aria-hidden="true">
      {marcasDeHora(inicioMs, minutos).map((h) => (
        <span key={h.minuto} style={{ left: `${(h.minuto / minutos) * 100}%` }}>
          {h.rotulo}
        </span>
      ))}
    </div>
  );
}

function GradeDeHoras({
  inicioMs,
  minutos,
  altura,
}: {
  inicioMs: number;
  minutos: number;
  altura: number;
}) {
  return (
    <>
      {marcasDeHora(inicioMs, minutos).map((h) => (
        <line
          key={h.minuto}
          x1={h.minuto}
          x2={h.minuto}
          y1={0}
          y2={altura}
          className={s.gradeVertical}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

export function RodadasDaProjecao({
  inicioMs,
  minutos,
  cargos,
  rodadas,
  buracos,
}: {
  inicioMs: number;
  minutos: number;
  cargos: { cd: CargoDoPainel; nome: string }[];
  rodadas: RodadaPainel[];
  buracos: BuracoProjecao[];
}) {
  const H = 10;
  const x = (iso: string) => Math.round(minutoNoEixo(msDeIso(iso), inicioMs) * 100) / 100;
  return (
    <div>
      <div className={s.faixas}>
        {cargos.map((c) => {
          const doCargo = rodadas.filter((r) => r.cargo === c.cd);
          const tiques = doCargo.map((r) => `M${x(r.hora)} 1.5V${H - 1.5}`).join("");
          const falhas = buracos.filter((b) => b.cargo === c.cd && b.tipo === "falha").length;
          const semNovidade = buracos.filter(
            (b) => b.cargo === c.cd && b.tipo === "sem-novidade",
          ).length;
          const resumo = `Rodadas da projeção de ${c.nome}: ${doCargo.length} rodadas; ${falhas} paradas por falha e ${semNovidade} paradas sem novidade, de mais de 10 minutos.`;
          return (
            <div key={c.cd} className={s.faixa}>
              <span className={s.faixaNome}>{c.nome}</span>
              <div className={s.faixaPlot}>
                {/* As paradas são retângulos HTML atrás do desenho: hachura e
                    contorno em CSS não se deformam com o SVG esticado. */}
                <div className={s.buracos} aria-hidden="true">
                  {buracos
                    .filter((b) => b.cargo === c.cd)
                    .map((b) => (
                      <span
                        key={b.de}
                        className={`${s.buraco} ${b.tipo === "falha" ? s.buracoFalha : s.buracoNeutro}`}
                        style={{
                          left: `${(x(b.de) / minutos) * 100}%`,
                          width: `${(Math.max(0, x(b.ate) - x(b.de)) / minutos) * 100}%`,
                        }}
                      />
                    ))}
                </div>
                <svg
                  className={s.faixaSvg}
                  viewBox={`0 0 ${minutos} ${H}`}
                  preserveAspectRatio="none"
                  style={{ height: 30 }}
                  role="img"
                  aria-label={resumo}
                >
                  <GradeDeHoras inicioMs={inicioMs} minutos={minutos} altura={H} />
                  <path
                    d={tiques}
                    stroke={corDoCargo(c.cd)}
                    className={s.tique}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
      <ReguaDeHoras inicioMs={inicioMs} minutos={minutos} />
      <ul className={s.legendaBuracos}>
        <li>
          <span className={s.amostraFalha} /> parada por falha: o modelo foi chamado e não gravou
        </li>
        <li>
          <span className={s.amostraNeutra} /> parada sem novidade: o TSE não mudou nada, o modelo
          não foi chamado
        </li>
      </ul>
    </div>
  );
}

export function DuracaoDosCiclos({
  inicioMs,
  minutos,
  cargos,
  ciclos,
}: {
  inicioMs: number;
  minutos: number;
  cargos: { cd: CargoDoPainel; nome: string }[];
  ciclos: CicloPainel[];
}) {
  const H = 100;
  const maiorDuracao = Math.max(300, ...ciclos.map((c) => c.duracaoS ?? 0));
  const yMax = Math.ceil(maiorDuracao / 100) * 100;
  const y = (seg: number) => Math.round((H - (Math.min(seg, yMax) / yMax) * H) * 10) / 10;
  const x = (iso: string) => Math.round(minutoNoEixo(msDeIso(iso), inicioMs) * 100) / 100;
  const pct = (seg: number) => `${(y(seg) / H) * 100}%`;
  return (
    <div className={s.comReguaY}>
      <div className={s.faixas}>
        {cargos.map((c) => {
          const doCargo = ciclos.filter((ci) => ci.cargo === c.cd);
          const feitos = doCargo.filter(
            (ci) => ci.fim !== null && ci.duracaoS !== null && ci.abortado === null,
          );
          const pontos = feitos
            .map((ci) => `M${x(ci.fim as string)} ${y(ci.duracaoS as number)}h0`)
            .join("");
          const acima = feitos.filter((ci) => (ci.duracaoS ?? 0) > 300).length;
          const nInterrompidos = doCargo.filter((ci) => ci.fim === null).length;
          const maior = Math.max(0, ...feitos.map((ci) => ci.duracaoS ?? 0));
          const resumo = `Duração das rodadas de pedidos de ${c.nome}: ${feitos.length} rodadas concluídas, ${acima} acima de 5 minutos, a mais longa com ${Math.round(maior)} segundos; ${nInterrompidos} começaram e não terminaram.`;
          const interrompidos = doCargo
            .filter((ci) => ci.fim === null)
            .map((ci) => `M${x(ci.inicio)} 0V${H}`)
            .join("");
          return (
            <div key={c.cd} className={s.faixa}>
              <span className={s.faixaNome}>{c.nome}</span>
              <div className={s.faixaPlot} style={{ height: 76 }}>
                <span className={s.faixaRotuloY} style={{ top: pct(300) }} aria-hidden="true">
                  5 min
                </span>
                <span className={s.faixaRotuloY} style={{ top: pct(yMax) }} aria-hidden="true">
                  {Math.round(yMax / 60)} min
                </span>
                <svg
                  className={s.faixaSvg}
                  viewBox={`0 0 ${minutos} ${H}`}
                  preserveAspectRatio="none"
                  style={{ height: 76 }}
                  role="img"
                  aria-label={resumo}
                >
                  <GradeDeHoras inicioMs={inicioMs} minutos={minutos} altura={H} />
                  <line
                    x1={0}
                    x2={minutos}
                    y1={y(0)}
                    y2={y(0)}
                    className={s.grade}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={0}
                    x2={minutos}
                    y1={y(300)}
                    y2={y(300)}
                    className={s.referencia}
                    vectorEffect="non-scaling-stroke"
                  />
                  {interrompidos ? (
                    <path
                      d={interrompidos}
                      className={s.pontoInterrompido}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <path
                    d={pontos}
                    stroke={corDoCargo(c.cd)}
                    className={s.ponto}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
      <ReguaDeHoras inicioMs={inicioMs} minutos={minutos} />
      <ul className={s.legendaBuracos}>
        <li>cada ponto é uma rodada de pedidos ao TSE, na altura do tempo que ela levou</li>
        <li>linha tracejada: 5 minutos</li>
        <li>
          <span className={s.amostraFalha} /> traço vertical: rodada que começou e não terminou
        </li>
      </ul>
    </div>
  );
}
