"use client";

/**
 * components/painel/VideoDaCorrida.tsx
 *
 * "Baixar vídeo" de UM gráfico da corrida do Presidente (pedido do dono em
 * 06/10/2026): cada um dos três gráficos — apuração, projeção, os dois
 * sobrepostos — tem o seu botão, que gera NO NAVEGADOR um vídeo vertical da
 * evolução daquele gráfico ao longo da noite e o baixa. Igual no celular e no
 * computador: o botão só baixa. Não há compartilhamento nem vídeo combinado.
 *
 * Um gerador só, parametrizado pelo gráfico (`grafico`), não três cópias.
 *
 * Sem dependência nova (constituição § 9): desenha num `<canvas>` com os
 * MESMOS números do gráfico e as MESMAS cores (lidas dos tokens computados),
 * grava com `canvas.captureStream()` + `MediaRecorder`, em MP4 (H.264) quando
 * o navegador grava MP4, senão WebM — com aviso. Nada vai a servidor nenhum.
 *
 * 🔴 Componente de CLIENTE: só números e textos por props (trava em
 * `tests/unit/painel/retrato-fora-do-cliente.test.ts`).
 */

import { useEffect, useRef, useState } from "react";

import {
  dominioY,
  escolherFormato,
  estadoNoInstante,
  type GraficoDaCorrida,
  instanteDoQuadro,
  nomeDoArquivoDoVideo,
  ultimoAte,
} from "@/lib/painel/corrida";
import { fmtNum, horaCurta } from "@/lib/painel/eixo";

import s from "./painel.module.css";

export interface DadosDoVideo {
  inicioMs: number;
  candidatos: { nome: string; partido: string; tinta: string }[];
  apuracao: { t: number[]; pct: number[][]; votos: number[][]; apurado: number[] };
  projecao: {
    t: number[];
    pct: (number | null)[][];
    lo: (number | null)[][];
    hi: (number | null)[][];
  };
}

const LARGURA = 720;
const ALTURA = 1280;
const FPS = 30;
const SEGUNDOS_ANIMADOS = 12;
const SEGUNDOS_PARADOS = 2;
const TOTAL_QUADROS = (SEGUNDOS_ANIMADOS + SEGUNDOS_PARADOS) * FPS;
const QUADROS_PARADOS = SEGUNDOS_PARADOS * FPS;

const TITULO: Record<GraficoDaCorrida, string> = {
  apuracao: "Apuração",
  projecao: "Projeção (com a margem)",
  ambos: "Apuração (cheia) e projeção (pontilhada)",
};

const ROTULO_DO_BOTAO: Record<GraficoDaCorrida, string> = {
  apuracao: "Baixar vídeo da apuração",
  projecao: "Baixar vídeo da projeção",
  ambos: "Baixar vídeo da apuração e da projeção",
};

type Estado =
  | { fase: "ocioso" }
  | { fase: "gerando"; progresso: number }
  | { fase: "baixado"; nome: string; megabytes: number; webm: boolean }
  | { fase: "erro"; mensagem: string };

interface Paleta {
  fundo: string;
  texto: string;
  suave: string;
  grade: string;
  candidatos: string[];
}

interface Dominio {
  tIni: number;
  tFim: number;
  yMin: number;
  yMax: number;
  marcas: number[];
}

/** Resolve `var(--…)` para a cor computada, pendurando um elemento no DOM. */
function resolverCor(raiz: HTMLElement, css: string): string {
  const el = document.createElement("span");
  el.style.color = css;
  el.style.display = "none";
  raiz.appendChild(el);
  const cor = getComputedStyle(el).color;
  el.remove();
  return cor;
}

function lerPaleta(raiz: HTMLElement, tintas: string[]): Paleta {
  return {
    fundo: resolverCor(raiz, "var(--color-bg-page)"),
    texto: resolverCor(raiz, "var(--color-text)"),
    suave: resolverCor(raiz, "var(--color-text-muted)"),
    grade: resolverCor(raiz, "var(--border-chart)"),
    candidatos: tintas.map((t) => resolverCor(raiz, t)),
  };
}

/** O domínio do vídeo: a noite toda, da 1ª chegada à última rodada, com folga. */
function dominioDoVideo(d: DadosDoVideo, grafico: GraficoDaCorrida): Dominio {
  const { apuracao, projecao } = d;
  const tIni = Math.max(0, (apuracao.t[0] ?? projecao.t[0] ?? 0) - 120);
  const tFim =
    Math.max(apuracao.t[apuracao.t.length - 1] ?? 0, projecao.t[projecao.t.length - 1] ?? 0) + 120;
  const series = [
    ...(grafico !== "projecao" ? apuracao.pct.map((v) => ({ t: apuracao.t, v })) : []),
    ...(grafico !== "apuracao"
      ? [
          ...projecao.lo.map((v) => ({ t: projecao.t, v })),
          ...projecao.hi.map((v) => ({ t: projecao.t, v })),
        ]
      : []),
  ];
  const y = dominioY(series, tIni, tFim, (apuracao.t[0] ?? 0) + 60);
  return { tIni, tFim, yMin: y.min, yMax: y.max, marcas: y.marcas };
}

/** Desenha UM quadro do vídeo do `grafico`: a noite até o instante `t` (segundos). */
function desenharQuadro(
  ctx: CanvasRenderingContext2D,
  d: DadosDoVideo,
  grafico: GraficoDaCorrida,
  pal: Paleta,
  t: number,
  dom: Dominio,
): void {
  const { apuracao, projecao, candidatos, inicioMs } = d;
  const comApuracao = grafico !== "projecao";
  const comProjecao = grafico !== "apuracao";
  ctx.fillStyle = pal.fundo;
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  ctx.textBaseline = "top";
  const M = 40;

  // --- cabeçalho ---------------------------------------------------------------
  ctx.fillStyle = pal.texto;
  ctx.font = "600 34px Georgia, 'Times New Roman', serif";
  ctx.fillText("Presidente — 1º turno 2026", M, 48);
  ctx.font = "500 26px system-ui, sans-serif";
  ctx.fillText(`${candidatos.map((c) => c.nome).join(" × ")} · ${TITULO[grafico]}`, M, 96);

  const est = estadoNoInstante(apuracao, projecao, t);
  ctx.font = "700 96px ui-monospace, Menlo, monospace";
  ctx.fillText(horaCurta(inicioMs + t * 1000), M, 150);
  ctx.font = "500 26px system-ui, sans-serif";
  ctx.fillStyle = pal.suave;
  ctx.fillText(
    est.apurado === null ? "apuração ainda não começou" : `${fmtNum(est.apurado, 2)}% apurado`,
    M,
    262,
  );
  candidatos.forEach((c, k) => {
    const yc = 310 + k * 92;
    ctx.fillStyle = pal.candidatos[k] ?? pal.texto;
    ctx.fillRect(M, yc + 8, 18, 18);
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillText(c.nome, M + 30, yc);
    ctx.font = "700 40px ui-monospace, Menlo, monospace";
    const partes: string[] = [];
    if (comApuracao) partes.push(est.pct[k] == null ? "—" : `${fmtNum(est.pct[k] as number, 2)}%`);
    if (comProjecao) {
      const pr = est.projecao[k];
      partes.push(pr == null ? "proj. —" : `proj. ${fmtNum(pr, 2)}%`);
    }
    ctx.fillText(partes.join("   "), M + 30, yc + 38);
  });

  // --- o gráfico -----------------------------------------------------------------
  const esq = M + 70;
  const dir = LARGURA - M;
  const y0 = 520;
  const y1 = 1110;
  const X = (seg: number) => esq + ((seg - dom.tIni) / (dom.tFim - dom.tIni)) * (dir - esq);
  const Y = (v: number) =>
    y0 +
    ((dom.yMax - Math.max(dom.yMin, Math.min(dom.yMax, v))) / (dom.yMax - dom.yMin)) * (y1 - y0);

  ctx.strokeStyle = pal.grade;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.font = "400 20px ui-monospace, Menlo, monospace";
  ctx.fillStyle = pal.suave;
  for (const m of dom.marcas) {
    ctx.beginPath();
    ctx.moveTo(esq, Y(m));
    ctx.lineTo(dir, Y(m));
    ctx.stroke();
    ctx.fillText(`${fmtNum(m, m % 1 === 0 ? 0 : 1)}%`, M, Y(m) - 10);
  }
  for (
    let h = Math.ceil((inicioMs + dom.tIni * 1000) / 3_600_000) * 3_600_000;
    h <= inicioMs + dom.tFim * 1000;
    h += 2 * 3_600_000
  ) {
    ctx.fillText(horaCurta(h), X((h - inicioMs) / 1000) - 22, y1 + 10);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(esq, y0, dir - esq, y1 - y0);
  ctx.clip();
  candidatos.forEach((_, k) => {
    const cor = pal.candidatos[k] ?? pal.texto;
    if (comProjecao) desenharProjecao(ctx, projecao, k, t, cor, grafico, X, Y);
    if (comApuracao) {
      const iA = ultimoAte(apuracao.t, t);
      const v = apuracao.pct[k] ?? [];
      if (iA >= 0) {
        ctx.beginPath();
        ctx.moveTo(X(apuracao.t[0] as number), Y(v[0] as number));
        for (let i = 1; i <= iA; i++) {
          ctx.lineTo(X(apuracao.t[i] as number), Y(v[i - 1] as number));
          ctx.lineTo(X(apuracao.t[i] as number), Y(v[i] as number));
        }
        ctx.lineTo(X(t), Y(v[iA] as number));
        ctx.strokeStyle = cor;
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }
  });
  ctx.restore();
  // a linha do instante
  ctx.strokeStyle = pal.suave;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(X(t), y0);
  ctx.lineTo(X(t), y1);
  ctx.stroke();

  // --- rodapé obrigatório (constituição § 1) -------------------------------------
  ctx.fillStyle = pal.texto;
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.fillText("AtlasMenna · Não oficial. Fonte: TSE.", M, ALTURA - 96);
  if (comProjecao) {
    ctx.fillStyle = pal.suave;
    ctx.font = "400 22px system-ui, sans-serif";
    ctx.fillText("Projeção estatística — não é resultado.", M, ALTURA - 58);
  }
}

function desenharProjecao(
  ctx: CanvasRenderingContext2D,
  projecao: DadosDoVideo["projecao"],
  k: number,
  t: number,
  cor: string,
  grafico: GraficoDaCorrida,
  X: (s: number) => number,
  Y: (v: number) => number,
): void {
  const iP = ultimoAte(projecao.t, t);
  if (iP < 0) return;
  const xFim = (i: number) => (i === iP ? X(t) : X(projecao.t[i + 1] as number));
  const lo = projecao.lo[k] ?? [];
  const hi = projecao.hi[k] ?? [];
  const pr = projecao.pct[k] ?? [];
  // margem
  ctx.beginPath();
  let aberto = false;
  for (let i = 0; i <= iP; i++) {
    const h = hi[i];
    if (h == null) continue;
    if (!aberto) ctx.moveTo(X(projecao.t[i] as number), Y(h));
    else ctx.lineTo(X(projecao.t[i] as number), Y(h));
    ctx.lineTo(xFim(i), Y(h));
    aberto = true;
  }
  for (let i = iP; i >= 0; i--) {
    const l = lo[i];
    if (l == null) continue;
    ctx.lineTo(xFim(i), Y(l));
    ctx.lineTo(X(projecao.t[i] as number), Y(l));
  }
  ctx.closePath();
  ctx.globalAlpha = grafico === "projecao" ? 0.16 : 0.07;
  ctx.fillStyle = cor;
  ctx.fill();
  ctx.globalAlpha = 1;
  // linha
  ctx.beginPath();
  let aberta = false;
  for (let i = 0; i <= iP; i++) {
    const v = pr[i];
    if (v == null) continue;
    if (!aberta) ctx.moveTo(X(projecao.t[i] as number), Y(v));
    else ctx.lineTo(X(projecao.t[i] as number), Y(v));
    ctx.lineTo(xFim(i), Y(v));
    aberta = true;
  }
  ctx.strokeStyle = cor;
  ctx.lineCap = "round";
  ctx.lineWidth = grafico === "ambos" ? 5 : 4;
  ctx.setLineDash(grafico === "ambos" ? [0.1, 11] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  if (grafico === "projecao") {
    ctx.fillStyle = cor;
    for (let i = 0; i <= iP; i++) {
      const v = pr[i];
      if (v == null) continue;
      ctx.beginPath();
      ctx.arc(X(projecao.t[i] as number), Y(v), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function VideoDaCorrida({
  grafico,
  ...dados
}: DadosDoVideo & { grafico: GraficoDaCorrida }) {
  const [estado, setEstado] = useState<Estado>({ fase: "ocioso" });
  const raizRef = useRef<HTMLDivElement>(null);
  const previaRef = useRef<HTMLCanvasElement>(null);
  const cancelarRef = useRef<(() => void) | null>(null);

  // Cancela a gravação só ao sair da página — não a cada mudança de estado.
  useEffect(() => () => cancelarRef.current?.(), []);

  const gerar = () => {
    const raiz = raizRef.current;
    const canvas = previaRef.current;
    if (!raiz || !canvas) return;
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setEstado({ fase: "erro", mensagem: "Este navegador não grava vídeo a partir da página." });
      return;
    }
    const formato = escolherFormato((f) => MediaRecorder.isTypeSupported(f));
    if (!formato) {
      setEstado({ fase: "erro", mensagem: "Este navegador não tem formato de vídeo para gravar." });
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pal = lerPaleta(
      raiz,
      dados.candidatos.map((c) => c.tinta),
    );
    const dom = dominioDoVideo(dados, grafico);

    desenharQuadro(ctx, dados, grafico, pal, dom.tIni, dom);
    const fluxo = canvas.captureStream(FPS);
    const gravador = new MediaRecorder(fluxo, { mimeType: formato, videoBitsPerSecond: 4_000_000 });
    const pedacos: Blob[] = [];
    let cancelado = false;
    let quadro = 0;
    let relogio: ReturnType<typeof setInterval> | null = null;
    gravador.ondataavailable = (e) => {
      if (e.data.size > 0) pedacos.push(e.data);
    };
    gravador.onstop = () => {
      if (relogio) clearInterval(relogio);
      for (const trilha of fluxo.getTracks()) trilha.stop();
      cancelarRef.current = null;
      if (cancelado) {
        setEstado({ fase: "ocioso" });
        return;
      }
      const webm = formato.startsWith("video/webm");
      const nome = nomeDoArquivoDoVideo(grafico, webm ? "webm" : "mp4");
      const arquivo = new Blob(pedacos, { type: formato.split(";")[0] });
      const url = URL.createObjectURL(arquivo);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setEstado({ fase: "baixado", nome, megabytes: arquivo.size / 1_000_000, webm });
    };
    cancelarRef.current = () => {
      cancelado = true;
      if (gravador.state !== "inactive") gravador.stop();
    };
    gravador.start(1000);
    setEstado({ fase: "gerando", progresso: 0 });
    // Um quadro a cada 1/30 s, no relógio de parede (o gravador grava o tempo
    // real): ~14 s de geração para ~14 s de vídeo. `setInterval` e não
    // `requestAnimationFrame`: com a aba em segundo plano o rAF para e o vídeo
    // ficaria com buracos; o intervalo só fica mais lento.
    relogio = setInterval(() => {
      if (cancelado) return;
      const t = instanteDoQuadro(quadro, TOTAL_QUADROS, QUADROS_PARADOS, dom.tIni, dom.tFim);
      desenharQuadro(ctx, dados, grafico, pal, t, dom);
      quadro++;
      if (quadro % FPS === 0) setEstado({ fase: "gerando", progresso: quadro / TOTAL_QUADROS });
      if (quadro >= TOTAL_QUADROS) {
        if (relogio) clearInterval(relogio);
        gravador.stop();
      }
    }, 1000 / FPS);
  };

  const idAjuda = `${grafico}-video-ajuda`;
  return (
    <div ref={raizRef} className={s.video} data-fase={estado.fase} data-grafico={grafico}>
      {estado.fase === "gerando" ? (
        <div className={s.videoProgresso}>
          <label>
            Gerando o vídeo… {Math.round(estado.progresso * 100)}%
            <progress value={estado.progresso} max={1} />
          </label>
          <button
            type="button"
            className={s.botaoVideoSecundario}
            onClick={() => cancelarRef.current?.()}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={s.botaoVideoSecundario}
          onClick={gerar}
          aria-describedby={idAjuda}
        >
          {ROTULO_DO_BOTAO[grafico]}
        </button>
      )}
      <p id={idAjuda} className={s.explica} aria-live="polite">
        {estado.fase === "ocioso"
          ? "Vídeo vertical de ~14 s com a evolução deste gráfico na noite, gerado aqui no aparelho."
          : estado.fase === "gerando"
            ? "A gravação acontece em tempo real; a página continua utilizável."
            : estado.fase === "erro"
              ? estado.mensagem
              : `Baixado: ${estado.nome} (${fmtNum(estado.megabytes, 1)} MB).${estado.webm ? " Atenção: este navegador só grava WebM, que alguns aparelhos não reproduzem." : ""}`}
      </p>
      <canvas
        ref={previaRef}
        width={LARGURA}
        height={ALTURA}
        className={estado.fase === "gerando" ? s.videoPrevia : s.videoPreviaOculta}
      />
    </div>
  );
}
