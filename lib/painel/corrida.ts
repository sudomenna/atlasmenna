/**
 * lib/painel/corrida.ts
 *
 * A corrida do PRESIDENTE entre os dois primeiros colocados, em alta resolução,
 * para o painel privado (ADR-0077; pedido do dono em 06/10/2026).
 *
 * Funções PURAS — sem I/O, sem dado do retrato embutido, sem o nome da variável
 * de ambiente da URL: este módulo é importado pelo componente de cliente do
 * gráfico (para achar o ponto vigente num instante) e pela montagem do retrato.
 *
 * ## A apuração em alta resolução
 *
 * O TSE publica um arquivo agregado por UF (27 + `ZZ`, o exterior) e um do
 * Brasil (`br`). Cada versão nova de um arquivo de UF que chegou na noite é um
 * INSTANTE da série: o % nacional de cada candidato naquele instante é
 *
 *     Σ votos do candidato (versão mais recente de cada UF)
 *     ÷ Σ votos válidos (`v.vv`, versão mais recente de cada UF)
 *
 * e o % apurado é a mesma conta do site (`_pct_apurado_nacional_somado`,
 * `api/model/project.py`): Σ seções totalizadas ÷ max(Σ seções, seções do `br`).
 * O arquivo `br` não entra na soma de votos (seria contar duas vezes) — só no
 * denominador do % apurado, e só quando é maior.
 *
 * ## A projeção
 *
 * Só existe nas rodadas do modelo (uma linha de `projections` por candidato e
 * rodada). Nada aqui interpola entre rodadas: num instante t vale a última
 * rodada com hora ≤ t ({@link ultimoAte}).
 */

/** Uma versão de arquivo agregado do Presidente com o que a corrida precisa. */
export interface VersaoCorrida {
  tsMs: number;
  uf: string;
  nivel: string;
  /** `s.st` — seções totalizadas. */
  st: unknown;
  /** `s.ts` — total de seções. */
  tot: unknown;
  /** `v.vv` — votos válidos. */
  vv: unknown;
  /** `vap` de cada candidato acompanhado, na ordem de `ids`. */
  votos: unknown[];
}

export interface PontoCorrida {
  tMs: number;
  /** % dos votos válidos de cada candidato (0–100), na ordem de `ids`. */
  pct: number[];
  /** Votos de cada candidato, na ordem de `ids`. */
  votos: number[];
  /** % apurado nacional (0–100). */
  apurado: number;
}

function numero(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reconstrói a apuração nacional a cada chegada de arquivo de UF. Versões
 * ilegíveis (sem `vv`, sem votos de algum candidato) são ignoradas — a UF
 * segue com a última versão boa. Um ponto por chegada de arquivo de UF, mesmo
 * quando várias chegam no mesmo segundo: a coleta do Presidente traz as 28 UFs
 * em rajada (a cada ~5 min), e cada ponto é o que o sistema sabia naquele
 * instante.
 */
export function serieCorrida(
  versoes: readonly VersaoCorrida[],
  nCandidatos: number,
): PontoCorrida[] {
  const ordenadas = [...versoes].sort((a, b) => a.tsMs - b.tsMs);
  const porUf = new Map<string, { vv: number; votos: number[]; st: number; tot: number }>();
  let totBr = 0;
  const out: PontoCorrida[] = [];
  for (const v of ordenadas) {
    if (v.nivel === "br") {
      const tot = numero(v.tot);
      if (tot !== null && tot > 0) totBr = Math.max(totBr, tot);
      continue;
    }
    const vv = numero(v.vv);
    const st = numero(v.st);
    const tot = numero(v.tot);
    const votos = v.votos.slice(0, nCandidatos).map(numero);
    if (vv === null || st === null || tot === null || votos.length < nCandidatos) continue;
    if (votos.some((x) => x === null)) continue;
    porUf.set(v.uf.toUpperCase(), { vv, votos: votos as number[], st, tot });

    let somaVv = 0;
    let somaSt = 0;
    let somaTot = 0;
    const somaVotos = new Array<number>(nCandidatos).fill(0);
    for (const u of porUf.values()) {
      somaVv += u.vv;
      somaSt += u.st;
      somaTot += u.tot;
      for (let k = 0; k < nCandidatos; k++)
        somaVotos[k] = (somaVotos[k] as number) + (u.votos[k] as number);
    }
    // Sem voto válido contado ainda, não há percentual — e um "0%" inventado
    // aqui seria a afirmação falsa "tinha zero voto" e esmagaria a escala.
    if (!(somaVv > 0)) continue;
    const den = Math.max(somaTot, totBr);
    const ponto: PontoCorrida = {
      tMs: v.tsMs,
      pct: somaVotos.map((x) => (100 * x) / somaVv),
      votos: somaVotos,
      apurado: den > 0 ? Math.min(100, (100 * somaSt) / den) : 0,
    };
    out.push(ponto);
  }
  return out;
}

/**
 * Índice do último elemento de `ts` (crescente) com valor ≤ `t`, ou −1 se
 * nenhum. Busca binária — o gráfico chama isto a cada movimento do ponteiro.
 */
export function ultimoAte(ts: readonly number[], t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  let achado = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if ((ts[meio] as number) <= t) {
      achado = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achado;
}

/** Uma rodada do modelo para os candidatos acompanhados. */
export interface RodadaCorrida {
  tsMs: number;
  dadoTsMs: number | null;
  /** Por candidato (ordem de `ids`); `null` quando a rodada não trouxe o candidato. */
  pct: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  pVitoria: (number | null)[];
  pctAtual: (number | null)[];
  votosAtuais: (number | null)[];
}

/**
 * Confere a soma por UF contra o que o MODELO viu (`projections.pct_atual`),
 * nos instantes em que as duas existem. Para cada rodada, compara o
 * `pct_atual` com o último ponto da série até a hora do boletim que o modelo
 * usou (`dado_ts`) — e, sem ela, até a hora da rodada.
 *
 * Diferenças esperadas, e por quê: o modelo soma ZONAS (ele nunca lê o arquivo
 * de UF) e lê o que estava no banco quando rodou; a série soma os arquivos de
 * UF do TSE no segundo em que chegaram.
 */
export function conferirComModelo(
  serie: readonly PontoCorrida[],
  rodadas: readonly RodadaCorrida[],
): { instantes: number; difMaxPp: number; tMsDaDifMax: number | null } {
  const ts = serie.map((p) => p.tMs);
  let instantes = 0;
  let difMaxPp = 0;
  let tMsDaDifMax: number | null = null;
  for (const r of rodadas) {
    const i = ultimoAte(ts, r.dadoTsMs ?? r.tsMs);
    if (i < 0) continue;
    const ponto = serie[i] as PontoCorrida;
    let conta = false;
    r.pctAtual.forEach((atual, k) => {
      if (atual === null) return;
      conta = true;
      const dif = Math.abs((ponto.pct[k] ?? 0) - atual);
      if (dif > difMaxPp) {
        difMaxPp = dif;
        tMsDaDifMax = r.tsMs;
      }
    });
    if (conta) instantes++;
  }
  return { instantes, difMaxPp: Math.round(difMaxPp * 1000) / 1000, tMsDaDifMax };
}

/**
 * As trocas de liderança na série: cada instante em que o candidato à frente
 * mudou (empate exato não conta como troca).
 */
export function trocasDeLideranca(
  serie: readonly PontoCorrida[],
): { tMs: number; lider: number; apurado: number }[] {
  const out: { tMs: number; lider: number; apurado: number }[] = [];
  let atual = -1;
  for (const p of serie) {
    const [a, b] = p.pct as [number, number];
    if (a === b) continue;
    const lider = a > b ? 0 : 1;
    if (lider !== atual) {
      if (atual !== -1) out.push({ tMs: p.tMs, lider, apurado: p.apurado });
      atual = lider;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Desenho e leitura (usadas pelo componente de cliente do gráfico)
// ---------------------------------------------------------------------------

/**
 * Caminho SVG em DEGRAU de uma série esparsa: o valor vale do seu instante até
 * o próximo (é o que o sistema sabia naquele intervalo — nada é interpolado).
 * Coordenadas: x = segundos, y = −valor (o `viewBox` do gráfico vira o eixo
 * de cabeça para baixo sem `transform`). `null` interrompe a linha. O último
 * degrau vai até `fimSeg`.
 */
export function caminhoEmDegraus(
  t: readonly number[],
  v: readonly (number | null)[],
  fimSeg: number,
): string {
  let d = "";
  let aberto = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i] as number;
    const y = v[i];
    if (y === null || y === undefined) {
      if (aberto) d += `H${x}`;
      aberto = false;
      continue;
    }
    d += aberto ? `H${x}V${-y}` : `M${x} ${-y}`;
    aberto = true;
  }
  if (aberto) d += `H${Math.max(fimSeg, t[t.length - 1] ?? fimSeg)}`;
  return d;
}

/** Marcadores (um ponto por instante) — traços de comprimento zero com ponta redonda. */
export function caminhoDePontos(t: readonly number[], v: readonly (number | null)[]): string {
  let d = "";
  for (let i = 0; i < t.length; i++) {
    const y = v[i];
    if (y === null || y === undefined) continue;
    d += `M${t[i]} ${-y}h0`;
  }
  return d;
}

/** A faixa lo–hi em degrau, como um polígono fechado (borda de cima → de baixo, de volta). */
export function caminhoDaFaixa(
  t: readonly number[],
  lo: readonly (number | null)[],
  hi: readonly (number | null)[],
  fimSeg: number,
): string {
  const idx = t.map((_, i) => i).filter((i) => lo[i] != null && hi[i] != null);
  if (idx.length === 0) return "";
  const xs = idx.map((i) => t[i] as number);
  const fim = Math.max(fimSeg, xs[xs.length - 1] as number);
  let d = `M${xs[0]} ${-(hi[idx[0] as number] as number)}`;
  for (let k = 1; k < idx.length; k++) {
    d += `H${xs[k]}V${-(hi[idx[k] as number] as number)}`;
  }
  d += `H${fim}V${-(lo[idx[idx.length - 1] as number] as number)}`;
  for (let k = idx.length - 1; k > 0; k--) {
    d += `H${xs[k]}V${-(lo[idx[k - 1] as number] as number)}`;
  }
  return `${d}H${xs[0]}Z`;
}

/**
 * A faixa vertical do gráfico na janela `[de, ate]` (segundos): do menor ao
 * maior valor visível das séries, com folga.
 *
 * Os instantes antes de `ignorarAteSeg` ficam de fora: na primeira rajada da
 * noite as UFs chegam uma a uma e a soma oscila 30 pontos em dois segundos —
 * a escala seria esmagada por um artefato de dois segundos.
 */
export function dominioY(
  series: readonly { t: readonly number[]; v: readonly (number | null)[] }[],
  de: number,
  ate: number,
  ignorarAteSeg: number,
): { min: number; max: number; marcas: number[] } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    // o degrau vigente no início da janela também está à vista
    const inicio = Math.max(0, ultimoAte(s.t, de));
    for (let i = inicio; i < s.t.length; i++) {
      const x = s.t[i] as number;
      if (x > ate) break;
      if (x < ignorarAteSeg) continue;
      const y = s.v[i];
      if (y === null || y === undefined) continue;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 100, marcas: [0, 50, 100] };
  }
  const faixa = Math.max(1, max - min);
  const passo = faixa <= 3 ? 0.5 : faixa <= 8 ? 1 : faixa <= 16 ? 2 : 5;
  const lo = Math.floor((min - faixa * 0.08) / passo) * passo;
  const hi = Math.ceil((max + faixa * 0.08) / passo) * passo;
  const marcas: number[] = [];
  for (let m = lo; m <= hi + passo / 2; m += passo) marcas.push(Math.round(m * 10) / 10);
  return { min: lo, max: hi, marcas };
}

/**
 * O próximo instante lido pelo teclado na janela `[de, ate]` (segundos):
 * setas ±1 min (Shift ±10 min), Page Up/Down ±1 h, Home/End as pontas.
 * Do vazio, qualquer seta vai ao início (End, ao fim). `undefined` = a tecla
 * não é de navegação.
 */
export function proximoInstante(
  atual: number | null,
  tecla: string,
  shift: boolean,
  de: number,
  ate: number,
): number | undefined {
  const passo = shift ? 600 : 60;
  const desloc: Record<string, number> = {
    ArrowRight: passo,
    ArrowUp: passo,
    ArrowLeft: -passo,
    ArrowDown: -passo,
    PageUp: 3600,
    PageDown: -3600,
  };
  if (tecla === "Home") return de;
  if (tecla === "End") return ate;
  const d = desloc[tecla];
  if (d === undefined) return undefined;
  if (atual === null) return de;
  return Math.max(de, Math.min(ate, atual + d));
}

// ---------------------------------------------------------------------------
// Vídeo da corrida (quadro → instante → estado)
// ---------------------------------------------------------------------------

/**
 * O instante (segundos) mostrado no quadro `quadro` de um vídeo com
 * `totalQuadros`, dos quais os últimos `quadrosParados` congelam no fim. A
 * noite anda em ritmo constante de `tIni` a `tFim`.
 */
export function instanteDoQuadro(
  quadro: number,
  totalQuadros: number,
  quadrosParados: number,
  tIni: number,
  tFim: number,
): number {
  const animados = Math.max(1, totalQuadros - quadrosParados);
  const f = Math.max(0, Math.min(1, quadro / Math.max(1, animados - 1)));
  return tIni + f * (tFim - tIni);
}

export interface EstadoNoInstante {
  /** Índice da última chegada de arquivo ≤ t (−1 = nenhuma ainda). */
  iApuracao: number;
  /** Índice da última rodada ≤ t (−1 = nenhuma ainda). */
  iProjecao: number;
  pct: (number | null)[];
  votos: (number | null)[];
  apurado: number | null;
  projecao: (number | null)[];
}

/** O que valia no instante `t` (segundos): a última chegada e a última rodada até ele. */
export function estadoNoInstante(
  apuracao: {
    t: readonly number[];
    pct: readonly (readonly number[])[];
    votos: readonly (readonly number[])[];
    apurado: readonly number[];
  },
  projecao: { t: readonly number[]; pct: readonly (readonly (number | null)[])[] },
  t: number,
): EstadoNoInstante {
  const iA = ultimoAte(apuracao.t, t);
  const iP = ultimoAte(projecao.t, t);
  return {
    iApuracao: iA,
    iProjecao: iP,
    pct: apuracao.pct.map((v) => (iA < 0 ? null : (v[iA] ?? null))),
    votos: apuracao.votos.map((v) => (iA < 0 ? null : (v[iA] ?? null))),
    apurado: iA < 0 ? null : (apuracao.apurado[iA] ?? null),
    projecao: projecao.pct.map((v) => (iP < 0 ? null : (v[iP] ?? null))),
  };
}

/**
 * O primeiro formato de vídeo que o navegador grava, na ordem de preferência:
 * MP4/H.264 (o que a maioria dos aparelhos reproduz) antes de WebM.
 */
export const FORMATOS_DE_VIDEO = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function escolherFormato(suporta: (tipo: string) => boolean): string | null {
  return FORMATOS_DE_VIDEO.find((f) => suporta(f)) ?? null;
}

/** Os três gráficos da corrida — cada um tem o seu vídeo. */
export type GraficoDaCorrida = "apuracao" | "projecao" | "ambos";

const SUFIXO_DO_ARQUIVO: Record<GraficoDaCorrida, string> = {
  apuracao: "apuracao",
  projecao: "projecao",
  ambos: "apuracao-e-projecao",
};

/** `atlasmenna-presidente-1t-apuracao.mp4` (e `-projecao`, `-apuracao-e-projecao`). */
export function nomeDoArquivoDoVideo(grafico: GraficoDaCorrida, extensao: "mp4" | "webm"): string {
  return `atlasmenna-presidente-1t-${SUFIXO_DO_ARQUIVO[grafico]}.${extensao}`;
}
