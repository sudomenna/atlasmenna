"use client";

/**
 * components/painel/CorridaPresidente.tsx
 *
 * A corrida do Presidente entre os dois primeiros colocados, em ALTA
 * RESOLUÇÃO, no painel privado (ADR-0077; pedido do dono em 06/10/2026). Três
 * gráficos um embaixo do outro, com o MESMO eixo de horário e a MESMA escala
 * vertical, para comparar olhando de um para o outro:
 *
 *   1. Apuração — um vértice por chegada de arquivo de UF (+ o % apurado);
 *   2. Projeção — vértices nas rodadas do modelo e a faixa da margem;
 *   3. Os dois sobrepostos — apuração contínua, projeção pontilhada.
 *
 * A linha vertical do instante é COMPARTILHADA: passar o mouse (tocar, usar o
 * teclado) em um marca a mesma hora nos outros. O balão aparece só no gráfico
 * em uso.
 *
 * 🔴 Componente de CLIENTE: recebe só números e textos por props do
 * componente de servidor. NUNCA importe aqui `lib/painel/ler.ts`, o JSON do
 * retrato ou qualquer coisa que mencione a variável da URL secreta (trava em
 * `tests/unit/painel/retrato-fora-do-cliente.test.ts`).
 *
 * Geometria: `viewBox` em (segundos, −%), `preserveAspectRatio="none"`. Os
 * caminhos são calculados UMA vez; trocar a faixa de horário só troca o
 * `viewBox`. Nenhum texto dentro do SVG (sairia deformado).
 */

import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import {
  caminhoDaFaixa,
  caminhoDePontos,
  caminhoEmDegraus,
  dominioY,
  proximoInstante,
  ultimoAte,
} from "@/lib/painel/corrida";
import { fmtNum, horaCurta, marcasDeHora } from "@/lib/painel/eixo";
import s from "./painel.module.css";
import { VideoDaCorrida } from "./VideoDaCorrida";

export interface CorridaPresidenteProps {
  /** Epoch ms do início do eixo (o segundo 0). */
  inicioMs: number;
  /** Fim do eixo, em segundos desde o início. */
  totalSeg: number;
  candidatos: { nome: string; partido: string; tinta: string }[];
  apuracao: { t: number[]; pct: number[][]; votos: number[][]; apurado: number[] };
  projecao: {
    t: number[];
    tBoletim: (number | null)[];
    pct: (number | null)[][];
    lo: (number | null)[][];
    hi: (number | null)[][];
  };
  faixasDeHorario: { rotulo: string; de: number; ate: number }[];
}

type Modo = "apuracao" | "projecao" | "ambos";

const ALTURA = 220;
const ALTURA_APURADO = 72;
/** A primeira rajada (UFs chegando uma a uma) não define a escala — ver `dominioY`. */
const RAJADA_INICIAL_SEG = 60;

function hms(ms: number): string {
  const d = new Date(ms - 3 * 3600_000);
  return `${horaCurta(ms)}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

export function CorridaPresidente({
  inicioMs,
  totalSeg,
  candidatos,
  apuracao,
  projecao,
  faixasDeHorario,
}: CorridaPresidenteProps) {
  const [faixa, setFaixa] = useState(0);
  const [instante, setInstante] = useState<number | null>(null);
  const [ativo, setAtivo] = useState<Modo | null>(null);
  const idAjuda = useId();

  const janela = faixasDeHorario[faixa] ?? { rotulo: "", de: 0, ate: totalSeg };
  const { de, ate } = janela;

  const caminhos = useMemo(
    () =>
      candidatos.map((_, k) => ({
        apuracao: caminhoEmDegraus(apuracao.t, apuracao.pct[k] ?? [], totalSeg),
        projecao: caminhoEmDegraus(projecao.t, projecao.pct[k] ?? [], totalSeg),
        pontos: caminhoDePontos(projecao.t, projecao.pct[k] ?? []),
        margem: caminhoDaFaixa(projecao.t, projecao.lo[k] ?? [], projecao.hi[k] ?? [], totalSeg),
      })),
    [candidatos, apuracao, projecao, totalSeg],
  );
  const caminhoApurado = useMemo(
    () => caminhoEmDegraus(apuracao.t, apuracao.apurado, totalSeg),
    [apuracao, totalSeg],
  );
  const inicioApuracao = apuracao.t[0] ?? 0;
  const y = useMemo(
    () =>
      dominioY(
        [
          ...apuracao.pct.map((v) => ({ t: apuracao.t, v })),
          ...projecao.lo.map((v) => ({ t: projecao.t, v })),
          ...projecao.hi.map((v) => ({ t: projecao.t, v })),
        ],
        de,
        ate,
        inicioApuracao + RAJADA_INICIAL_SEG,
      ),
    [apuracao, projecao, de, ate, inicioApuracao],
  );

  // --- leitura no instante -------------------------------------------------
  const iApur = instante === null ? -1 : ultimoAte(apuracao.t, instante);
  const iProj = instante === null ? -1 : ultimoAte(projecao.t, instante);
  const leituraApur =
    iApur < 0
      ? null
      : {
          hora: inicioMs + (apuracao.t[iApur] as number) * 1000,
          pct: apuracao.pct.map((v) => v[iApur] as number),
          votos: apuracao.votos.map((v) => v[iApur] as number),
          apurado: apuracao.apurado[iApur] as number,
        };
  const leituraProj =
    iProj < 0
      ? null
      : {
          hora: inicioMs + (projecao.t[iProj] as number) * 1000,
          boletim:
            projecao.tBoletim[iProj] == null
              ? null
              : inicioMs + (projecao.tBoletim[iProj] as number) * 1000,
          pct: projecao.pct.map((v) => v[iProj] ?? null),
          lo: projecao.lo.map((v) => v[iProj] ?? null),
          hi: projecao.hi.map((v) => v[iProj] ?? null),
        };

  const textoApur = leituraApur
    ? `apuração: ${candidatos
        .map((c, k) => `${c.nome} ${fmtNum(leituraApur.pct[k] ?? 0, 2)}%`)
        .join(", ")}; ${fmtNum(leituraApur.apurado, 2)}% apurado`
    : "apuração ainda sem voto";
  const textoProj = leituraProj
    ? `projeção das ${horaCurta(leituraProj.hora)}: ${candidatos
        .map(
          (c, k) =>
            `${c.nome} ${leituraProj.pct[k] == null ? "—" : `${fmtNum(leituraProj.pct[k] as number, 2)}%`}`,
        )
        .join(", ")}`
    : "projeção ainda não rodou";

  const dadosDoVideo = { inicioMs, candidatos, apuracao, projecao };
  const props = {
    inicioMs,
    de,
    ate,
    y,
    instante,
    setInstante,
    setAtivo,
    idAjuda,
  };

  return (
    <div className={s.corrida}>
      <fieldset className={`${s.chips} ${s.semMoldura}`}>
        <legend className="sr-only">Faixa de horário dos três gráficos</legend>
        {faixasDeHorario.map((f, i) => (
          <button
            key={f.rotulo}
            type="button"
            className={`${s.chip} ${i === faixa ? s.chipAtivo : ""}`}
            aria-pressed={i === faixa}
            onClick={() => {
              setFaixa(i);
              setInstante(null);
            }}
          >
            {f.rotulo}
          </button>
        ))}
      </fieldset>
      <ul className={s.legenda}>
        {candidatos.map((c) => (
          <li key={c.nome}>
            <span className={s.amostra} style={{ background: c.tinta }} />
            {c.nome} ({c.partido})
          </li>
        ))}
      </ul>
      <span id={idAjuda} className="sr-only">
        Setas: um minuto (com Shift, dez). Page Up e Page Down: uma hora. Home e End: início e fim
        da faixa de horário. Esc: fecha a leitura. Os mesmos números estão em “Ver em tabela”.
      </span>

      <Painel
        {...props}
        modo="apuracao"
        titulo="Apuração"
        nome="Leitura da apuração"
        ativo={ativo === "apuracao"}
        valorTexto={textoApur}
        rotulo={`Apuração do Presidente, ${candidatos.map((c) => c.nome).join(" e ")}, em percentual dos votos válidos, a cada chegada de arquivo estadual do TSE.`}
        desenho={candidatos.map((c, k) => (
          <path
            key={c.nome}
            d={caminhos[k]?.apuracao}
            className={s.linhaCorrida}
            stroke={c.tinta}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        balao={leituraApur ? <BalaoApuracao candidatos={candidatos} l={leituraApur} /> : null}
      />
      <PainelApurado {...props} caminho={caminhoApurado} valor={leituraApur?.apurado ?? null} />
      <VideoDaCorrida grafico="apuracao" {...dadosDoVideo} />

      <Painel
        {...props}
        modo="projecao"
        titulo="Projeção"
        nome="Leitura da projeção"
        ativo={ativo === "projecao"}
        valorTexto={textoProj}
        rotulo={`Projeção do Presidente, ${candidatos.map((c) => c.nome).join(" e ")}, nas ${projecao.t.length} rodadas do modelo, com a margem de cada uma sombreada.`}
        desenho={candidatos.map((c, k) => (
          <g key={c.nome}>
            <path d={caminhos[k]?.margem} fill={c.tinta} className={s.margemCorrida} />
            <path
              d={caminhos[k]?.projecao}
              className={s.linhaCorrida}
              stroke={c.tinta}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={caminhos[k]?.pontos}
              className={s.verticeCorrida}
              stroke={c.tinta}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        balao={leituraProj ? <BalaoProjecao candidatos={candidatos} l={leituraProj} /> : null}
      />
      <VideoDaCorrida grafico="projecao" {...dadosDoVideo} />

      <Painel
        {...props}
        modo="ambos"
        titulo="Apuração (linha cheia) e projeção (pontilhada)"
        nome="Leitura da apuração e da projeção"
        ativo={ativo === "ambos"}
        valorTexto={`${textoApur}; ${textoProj}`}
        rotulo={`Apuração e projeção do Presidente sobrepostas: apuração em linha cheia, projeção em linha pontilhada, ${candidatos.map((c) => c.nome).join(" e ")}.`}
        desenho={candidatos.map((c, k) => (
          <g key={c.nome}>
            <path d={caminhos[k]?.margem} fill={c.tinta} className={s.margemCorridaLeve} />
            <path
              d={caminhos[k]?.apuracao}
              className={s.linhaCorrida}
              stroke={c.tinta}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={caminhos[k]?.projecao}
              className={s.linhaPontilhada}
              stroke={c.tinta}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        balao={
          leituraApur || leituraProj ? (
            <BalaoAmbos candidatos={candidatos} apur={leituraApur} proj={leituraProj} />
          ) : null
        }
      />
      <VideoDaCorrida grafico="ambos" {...dadosDoVideo} />
    </div>
  );
}

interface PainelBase {
  inicioMs: number;
  de: number;
  ate: number;
  y: { min: number; max: number; marcas: number[] };
  instante: number | null;
  setInstante: (f: (t: number | null) => number | null) => void;
  setAtivo: (m: Modo | null) => void;
  idAjuda: string;
}

/** A camada de leitura compartilhada: ponteiro e teclado viram um instante (segundos). */
function useLeitura(base: PainelBase, modo: Modo) {
  const { de, ate, setInstante, setAtivo } = base;
  const aoMover = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const caixa = e.currentTarget.getBoundingClientRect();
      if (caixa.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (e.clientX - caixa.left) / caixa.width));
      setInstante(() => Math.round(de + frac * (ate - de)));
      setAtivo(modo);
    },
    [de, ate, setInstante, setAtivo, modo],
  );
  const aoSair = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") return;
      if (document.activeElement === e.currentTarget) return;
      setInstante(() => null);
      setAtivo(null);
    },
    [setInstante, setAtivo],
  );
  const aoTeclar = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        setInstante(() => null);
        return;
      }
      const tecla = e.key;
      const shift = e.shiftKey;
      if (proximoInstante(null, tecla, shift, de, ate) === undefined) return;
      e.preventDefault();
      setAtivo(modo);
      setInstante((atual) => proximoInstante(atual, tecla, shift, de, ate) ?? atual);
    },
    [de, ate, setInstante, setAtivo, modo],
  );
  const aoFocar = useCallback(() => {
    setAtivo(modo);
    setInstante((t) => t ?? de);
  }, [de, setInstante, setAtivo, modo]);
  const aoDesfocar = useCallback(
    (_e: FocusEvent<HTMLDivElement>) => {
      setInstante(() => null);
      setAtivo(null);
    },
    [setInstante, setAtivo],
  );
  return { aoMover, aoSair, aoTeclar, aoFocar, aoDesfocar };
}

function GradeDoPainel({
  inicioMs,
  de,
  ate,
  yMin,
  yMax,
  marcasY,
}: {
  inicioMs: number;
  de: number;
  ate: number;
  yMin: number;
  yMax: number;
  marcasY: number[];
}) {
  const horas = marcasDeHora(inicioMs, Math.ceil(ate / 60), 1).filter(
    (h) => h.minuto * 60 >= de && h.minuto * 60 <= ate,
  );
  return (
    <>
      {marcasY.map((m) => (
        <line
          key={m}
          x1={de}
          x2={ate}
          y1={-m}
          y2={-m}
          className={s.grade}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {horas.map((h) => (
        <line
          key={h.minuto}
          x1={h.minuto * 60}
          x2={h.minuto * 60}
          y1={-yMax}
          y2={-yMin}
          className={s.gradeVertical}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

function ReguaX({ inicioMs, de, ate }: { inicioMs: number; de: number; ate: number }) {
  const horas = marcasDeHora(inicioMs, Math.ceil(ate / 60), 1).filter(
    (h) => h.minuto * 60 >= de && h.minuto * 60 <= ate,
  );
  return (
    <div className={s.reguaX} aria-hidden="true">
      {horas.map((h) => (
        <span key={h.minuto} style={{ left: `${((h.minuto * 60 - de) / (ate - de)) * 100}%` }}>
          {h.rotulo}
        </span>
      ))}
    </div>
  );
}

function Painel(
  base: PainelBase & {
    modo: Modo;
    titulo: string;
    nome: string;
    rotulo: string;
    ativo: boolean;
    valorTexto: string;
    desenho: React.ReactNode;
    balao: React.ReactNode;
  },
) {
  const { inicioMs, de, ate, y, instante, idAjuda, modo, titulo, nome, rotulo } = base;
  const ev = useLeitura(base, modo);
  const pctY = (v: number) => `${((y.max - v) / (y.max - y.min)) * 100}%`;
  const fracX = instante === null ? 0 : (instante - de) / (ate - de);
  const aDireita = fracX < 0.55;
  return (
    <div className={s.painelCorrida}>
      <h3 className={s.subtitulo3}>{titulo}</h3>
      <div className={s.plot} style={{ height: ALTURA }}>
        <div className={s.reguaY} aria-hidden="true">
          {y.marcas.map((m) => (
            <span key={m} style={{ top: pctY(m) }}>
              {fmtNum(m, m % 1 === 0 ? 0 : 1)}%
            </span>
          ))}
        </div>
        <div className={`${s.areaDoPlot} ${s.recorte}`}>
          <svg
            className={s.svg}
            viewBox={`${de} ${-y.max} ${ate - de} ${y.max - y.min}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={rotulo}
          >
            <GradeDoPainel
              inicioMs={inicioMs}
              de={de}
              ate={ate}
              yMin={y.min}
              yMax={y.max}
              marcasY={y.marcas}
            />
            {base.desenho}
            {instante !== null ? (
              <line
                x1={instante}
                x2={instante}
                y1={-y.max}
                y2={-y.min}
                className={s.cursor}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <ReguaX inicioMs={inicioMs} de={de} ate={ate} />
          <div
            className={s.camadaDeLeitura}
            role="slider"
            tabIndex={0}
            aria-label={nome}
            aria-describedby={idAjuda}
            aria-valuemin={de}
            aria-valuemax={ate}
            aria-valuenow={instante ?? de}
            aria-valuetext={
              instante === null
                ? "nenhum instante selecionado"
                : `${hms(inicioMs + instante * 1000)}: ${base.valorTexto}`
            }
            onPointerMove={ev.aoMover}
            onPointerDown={ev.aoMover}
            onPointerLeave={ev.aoSair}
            onKeyDown={ev.aoTeclar}
            onFocus={ev.aoFocar}
            onBlur={ev.aoDesfocar}
          />
          {base.ativo && instante !== null && base.balao ? (
            <div
              className={`${s.leitura} ${s.leituraCorrida}`}
              style={
                aDireita
                  ? { left: `calc(${fracX * 100}% + 8px)` }
                  : { right: `calc(${(1 - fracX) * 100}% + 8px)` }
              }
            >
              <strong>{hms(inicioMs + instante * 1000)}</strong>
              {base.balao}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PainelApurado(base: PainelBase & { caminho: string; valor: number | null }) {
  const { inicioMs, de, ate, instante } = base;
  return (
    <div className={s.painelCorrida}>
      <p className={s.explica} style={{ margin: 0 }}>
        % apurado (Brasil){base.valor === null ? "" : `: ${fmtNum(base.valor, 2)}%`}
      </p>
      <div className={s.plot} style={{ height: ALTURA_APURADO }}>
        <div className={s.reguaY} aria-hidden="true">
          {[0, 50, 100].map((m) => (
            <span key={m} style={{ top: `${100 - m}%` }}>
              {m}%
            </span>
          ))}
        </div>
        <div className={`${s.areaDoPlot} ${s.recorte}`}>
          <svg
            className={s.svg}
            viewBox={`${de} -100 ${ate - de} 100`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Percentual apurado do Presidente no Brasil, a cada chegada de arquivo estadual."
          >
            <GradeDoPainel
              inicioMs={inicioMs}
              de={de}
              ate={ate}
              yMin={0}
              yMax={100}
              marcasY={[0, 50, 100]}
            />
            <path d={base.caminho} className={s.linhaApurado} vectorEffect="non-scaling-stroke" />
            {instante !== null ? (
              <line
                x1={instante}
                x2={instante}
                y1={-100}
                y2={0}
                className={s.cursor}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <ReguaX inicioMs={inicioMs} de={de} ate={ate} />
        </div>
      </div>
    </div>
  );
}

type Cand = { nome: string; tinta: string };

function BalaoApuracao({
  candidatos,
  l,
}: {
  candidatos: Cand[];
  l: { hora: number; pct: number[]; votos: number[]; apurado: number };
}) {
  const difPp = (l.pct[0] ?? 0) - (l.pct[1] ?? 0);
  const difVotos = (l.votos[0] ?? 0) - (l.votos[1] ?? 0);
  const lider = difPp >= 0 ? 0 : 1;
  return (
    <>
      <p className={s.leituraTitulo}>Apuração (arquivo das {hms(l.hora)})</p>
      <ul>
        {candidatos.map((c, k) => (
          <li key={c.nome}>
            <span className={s.amostra} style={{ background: c.tinta }} />
            {c.nome}: {fmtNum(l.pct[k] ?? 0, 2)}% · {fmtNum(l.votos[k] ?? 0)} votos
          </li>
        ))}
      </ul>
      <p>
        {candidatos[lider]?.nome} à frente por {fmtNum(Math.abs(difPp), 2)} pontos (
        {fmtNum(Math.abs(difVotos))} votos) · {fmtNum(l.apurado, 2)}% apurado
      </p>
    </>
  );
}

function BalaoProjecao({
  candidatos,
  l,
}: {
  candidatos: Cand[];
  l: {
    hora: number;
    boletim: number | null;
    pct: (number | null)[];
    lo: (number | null)[];
    hi: (number | null)[];
  };
}) {
  const a = l.pct[0];
  const b = l.pct[1];
  return (
    <>
      <p className={s.leituraTitulo}>
        Projeção vigente (rodada das {hms(l.hora)}
        {l.boletim !== null ? `, boletim das ${hms(l.boletim)}` : ""})
      </p>
      <ul>
        {candidatos.map((c, k) => (
          <li key={c.nome}>
            <span className={s.amostra} style={{ background: c.tinta }} />
            {c.nome}: {l.pct[k] == null ? "—" : `${fmtNum(l.pct[k] as number, 2)}%`}
            {l.lo[k] != null && l.hi[k] != null
              ? ` (${fmtNum(l.lo[k] as number, 2)}–${fmtNum(l.hi[k] as number, 2)})`
              : ""}
          </li>
        ))}
      </ul>
      {a != null && b != null ? (
        <p>Diferença projetada: {fmtNum(Math.abs(a - b), 2)} pontos</p>
      ) : null}
    </>
  );
}

/** O balão do 3º gráfico: apuração e projeção vigente numa linha por candidato. */
function BalaoAmbos({
  candidatos,
  apur,
  proj,
}: {
  candidatos: Cand[];
  apur: { hora: number; pct: number[]; votos: number[]; apurado: number } | null;
  proj: {
    hora: number;
    pct: (number | null)[];
    lo: (number | null)[];
    hi: (number | null)[];
  } | null;
}) {
  const difPp = apur ? (apur.pct[0] ?? 0) - (apur.pct[1] ?? 0) : 0;
  const difVotos = apur ? (apur.votos[0] ?? 0) - (apur.votos[1] ?? 0) : 0;
  return (
    <>
      <p className={s.leituraTitulo}>
        Apuração{apur ? ` (arquivo das ${hms(apur.hora)})` : ""} · projeção
        {proj ? ` (rodada das ${hms(proj.hora)})` : ""}
      </p>
      <ul>
        {candidatos.map((c, k) => {
          const p = proj?.pct[k];
          const lo = proj?.lo[k];
          const hi = proj?.hi[k];
          return (
            <li key={c.nome}>
              <span className={s.amostra} style={{ background: c.tinta }} />
              {c.nome}: {apur ? `${fmtNum(apur.pct[k] ?? 0, 2)}%` : "—"} · proj.{" "}
              {p == null ? "—" : `${fmtNum(p, 2)}%`}
              {lo != null && hi != null ? ` (${fmtNum(lo, 2)}–${fmtNum(hi, 2)})` : ""}
            </li>
          );
        })}
      </ul>
      {apur ? (
        <p>
          {candidatos[difPp >= 0 ? 0 : 1]?.nome} à frente por {fmtNum(Math.abs(difPp), 2)} pontos (
          {fmtNum(Math.abs(difVotos))} votos) · {fmtNum(apur.apurado, 2)}% apurado
        </p>
      ) : null}
    </>
  );
}
