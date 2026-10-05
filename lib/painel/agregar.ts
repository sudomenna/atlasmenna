/**
 * lib/painel/agregar.ts
 *
 * A lógica do retrato do painel privado (ADR-0077), em funções PURAS: recebem
 * as linhas já lidas do banco (normalizadas para números e epoch ms) e devolvem
 * o {@link RetratoPainel}. Sem I/O — o script `scripts/painel-retrato.ts` faz
 * as consultas e a gravação; os testes exercitam tudo daqui sobre dados
 * sintéticos.
 *
 * Três regras que valem para o arquivo inteiro:
 *
 *   1. **BRT fixo (UTC−3).** O eixo e todo horário de saída são BRT; não há
 *      horário de verão desde 2019, então um deslocamento constante basta.
 *   2. **O que é estimado diz que é estimado.** Pedidos ao TSE só existem como
 *      total por ciclo — a distribuição por minuto é uma estimativa
 *      ({@link espalharPorMinuto}). Novidades vêm de `snapshots` e são exatas.
 *   3. **Ausência não vira zero inventado.** Um ciclo que começou e não deixou
 *      fim aparece como interrompido, com as métricas `null` — não como um
 *      ciclo de zero pedidos.
 */

import {
  type ArquivoParado,
  BRT_OFFSET_MS,
  type BuracoCiclos,
  type BuracoProjecao,
  CARGOS_COM_RODADA,
  CARGOS_DO_PAINEL,
  type CargoDoPainel,
  type ChaveCargo,
  type CicloPainel,
  type CorrecaoPainel,
  type EpisodioBloqueio,
  type PontoApurado,
  type RetratoPainel,
  type SeriePorCargo,
  type TotaisCargo,
  VERSAO_RETRATO,
} from "./tipos";

const MINUTO_MS = 60_000;

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** Epoch ms → `2026-10-04T19:07:12-03:00` (BRT, precisão de segundo). */
export function isoBrt(ms: number): string {
  return `${new Date(ms - BRT_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
}

/** Índice do minuto de `ms` num eixo que começa em `inicioMs` (pode sair do eixo). */
export function indiceDoMinuto(ms: number, inicioMs: number): number {
  return Math.floor((ms - inicioMs) / MINUTO_MS);
}

/** `true` para os seis códigos de cargo que a ingestão cobre. */
export function ehCargoDoPainel(n: unknown): n is CargoDoPainel {
  return typeof n === "number" && (CARGOS_DO_PAINEL as readonly number[]).includes(n);
}

// ---------------------------------------------------------------------------
// Espalhar um total pelo intervalo do ciclo
// ---------------------------------------------------------------------------

/**
 * Soma `total` em `acc` (uma posição por minuto, a partir de `eixoInicioMs`),
 * **proporcionalmente** ao pedaço do intervalo `[inicioMs, fimMs]` que cai em
 * cada minuto. Um ciclo de 4 min 10 s com 6.321 pedidos põe ~1.517 em cada
 * minuto cheio e o resto nas pontas.
 *
 * - Intervalo de duração zero (ou invertido): o total inteiro vai para o
 *   minuto de `fimMs`.
 * - O pedaço que cai fora do eixo é descartado (o eixo é a janela do retrato).
 *
 * Muta `acc` e devolve o quanto efetivamente caiu dentro do eixo.
 */
export function espalharPorMinuto(
  acc: number[],
  eixoInicioMs: number,
  inicioMs: number,
  fimMs: number,
  total: number,
): number {
  if (!(total > 0)) return 0;
  const n = acc.length;
  if (!(fimMs > inicioMs)) {
    const i = indiceDoMinuto(fimMs, eixoInicioMs);
    if (i < 0 || i >= n) return 0;
    acc[i] = (acc[i] ?? 0) + total;
    return total;
  }
  const dur = fimMs - inicioMs;
  let dentro = 0;
  const primeiro = indiceDoMinuto(inicioMs, eixoInicioMs);
  const ultimo = indiceDoMinuto(fimMs, eixoInicioMs);
  for (let i = Math.max(0, primeiro); i <= Math.min(n - 1, ultimo); i++) {
    const a = Math.max(inicioMs, eixoInicioMs + i * MINUTO_MS);
    const b = Math.min(fimMs, eixoInicioMs + (i + 1) * MINUTO_MS);
    if (b <= a) continue;
    const parte = (total * (b - a)) / dur;
    acc[i] = (acc[i] ?? 0) + parte;
    dentro += parte;
  }
  return dentro;
}

/** Soma 1 (ou `valor`) no minuto de `ms`, se ele cair no eixo. */
function somarNoMinuto(acc: number[], eixoInicioMs: number, ms: number, valor: number): void {
  const i = indiceDoMinuto(ms, eixoInicioMs);
  if (i < 0 || i >= acc.length) return;
  acc[i] = (acc[i] ?? 0) + valor;
}

// ---------------------------------------------------------------------------
// ingest_log → ciclos
// ---------------------------------------------------------------------------

/** Uma linha de `ingest_log` já normalizada pelo leitor. */
export interface LinhaIngestLog {
  tsMs: number;
  durationMs: number | null;
  filesFetched: number | null;
  filesChanged: number | null;
  errors: number | null;
  /** O texto cru de `notes` (JSON gravado pelo `ingest-handler`). */
  notes: string | null;
}

/** Ciclo em epoch ms — a forma interna, antes de virar {@link CicloPainel}. */
export interface CicloBruto {
  inicioMs: number;
  fimMs: number | null;
  cargo: CargoDoPainel;
  fatia: number | null;
  duracaoMs: number | null;
  pedidos: number | null;
  novidades: number | null;
  inalterados: number | null;
  naoEncontrados: number | null;
  erros: number | null;
  bloqueios: number | null;
  esperaMs: number | null;
  modeloAcionado: boolean;
  abortado: string | null;
}

interface NotasCiclo {
  running?: unknown;
  turno?: unknown;
  env?: unknown;
  cargo?: unknown;
  fatia?: unknown;
  unchanged?: unknown;
  not_found?: unknown;
  rateLimited?: unknown;
  waitedMs?: unknown;
  model_triggered?: unknown;
  aborted?: unknown;
}

function lerNotas(texto: string | null): NotasCiclo | null {
  if (!texto) return null;
  try {
    const v: unknown = JSON.parse(texto);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as NotasCiclo) : null;
  } catch {
    return null;
  }
}

function numeroOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Distância máxima entre o marcador de início e o início calculado do fim
 * (`fim − duração`) para os dois serem o MESMO ciclo. O marcador é gravado
 * logo depois do relógio do ciclo começar a contar — milissegundos a poucos
 * segundos de diferença na noite de 04/10.
 */
export const TOLERANCIA_PAREAMENTO_MS = 30_000;

/**
 * Transforma as linhas de `ingest_log` em ciclos.
 *
 * Cada ciclo grava DUAS linhas (`lib/tse/ingest-handler.ts`): o marcador de
 * início (`notes.running = true`) e o fim (`running = false`, com as
 * métricas e a duração). O pareamento é por sequência `(cargo, fatia)` e
 * **pela duração**, não pela ordem: cada fim procura o marcador mais próximo
 * de `fim − duração` (até {@link TOLERANCIA_PAREAMENTO_MS}).
 *
 * Parear pela ordem ("início, depois fim") erra justamente na noite que o
 * painel quer mostrar: quando um ciclo passa de 5 minutos, o próximo começa
 * antes de ele terminar, e a sequência vira início-início-fim-fim.
 *
 *   - fim com marcador → ciclo concluído;
 *   - fim sem marcador (o início caiu fora da janela) → ciclo concluído;
 *   - marcador sem fim → ciclo **interrompido**: começou e não deixou registro
 *     de fim (função derrubada por tempo ou por memória). Entra na lista com
 *     `fimMs = null` e as métricas `null` — nunca como zero.
 *
 * Linhas ignoradas (contadas em `ignoradas`): `notes` ilegível, turno ou
 * ambiente diferente do pedido, cargo fora dos seis cobertos.
 */
export function parearCiclos(
  linhas: readonly LinhaIngestLog[],
  opts: { turno: number; ambiente: string },
): { ciclos: CicloBruto[]; ignoradas: number } {
  let ignoradas = 0;
  const porSequencia = new Map<string, { linha: LinhaIngestLog; notas: NotasCiclo }[]>();

  for (const linha of linhas) {
    const notas = lerNotas(linha.notes);
    if (!notas) {
      ignoradas++;
      continue;
    }
    if (notas.turno !== undefined && notas.turno !== opts.turno) {
      ignoradas++;
      continue;
    }
    if (notas.env !== undefined && notas.env !== opts.ambiente) {
      ignoradas++;
      continue;
    }
    if (!ehCargoDoPainel(notas.cargo)) {
      ignoradas++;
      continue;
    }
    const fatia = numeroOuNull(notas.fatia);
    const chave = `${notas.cargo}:${fatia ?? "-"}`;
    const lista = porSequencia.get(chave) ?? [];
    lista.push({ linha, notas });
    porSequencia.set(chave, lista);
  }

  const ciclos: CicloBruto[] = [];
  for (const lista of porSequencia.values()) {
    const marcadores = lista
      .filter((i) => i.notas.running === true)
      .sort((a, b) => a.linha.tsMs - b.linha.tsMs);
    const fins = lista
      .filter((i) => i.notas.running !== true)
      .sort((a, b) => a.linha.tsMs - b.linha.tsMs);
    const usado = new Array<boolean>(marcadores.length).fill(false);

    for (const fim of fins) {
      const cargo = fim.notas.cargo as CargoDoPainel;
      const fatia = numeroOuNull(fim.notas.fatia);
      const inicioCalculado = fim.linha.tsMs - (fim.linha.durationMs ?? 0);
      let melhor = -1;
      let melhorDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < marcadores.length; i++) {
        if (usado[i]) continue;
        const m = marcadores[i] as { linha: LinhaIngestLog };
        if (m.linha.tsMs > fim.linha.tsMs) break;
        const dist = Math.abs(m.linha.tsMs - inicioCalculado);
        if (dist <= TOLERANCIA_PAREAMENTO_MS && dist < melhorDist) {
          melhor = i;
          melhorDist = dist;
        }
      }
      if (melhor >= 0) usado[melhor] = true;
      ciclos.push(concluido(fim.linha, fim.notas, cargo, fatia));
    }
    marcadores.forEach((m, i) => {
      if (usado[i]) return;
      ciclos.push(
        interrompido(m.linha, m.notas.cargo as CargoDoPainel, numeroOuNull(m.notas.fatia)),
      );
    });
  }

  ciclos.sort((a, b) => (a.fimMs ?? a.inicioMs) - (b.fimMs ?? b.inicioMs) || a.cargo - b.cargo);
  return { ciclos, ignoradas };
}

function interrompido(
  linha: LinhaIngestLog,
  cargo: CargoDoPainel,
  fatia: number | null,
): CicloBruto {
  return {
    inicioMs: linha.tsMs,
    fimMs: null,
    cargo,
    fatia,
    duracaoMs: null,
    pedidos: null,
    novidades: null,
    inalterados: null,
    naoEncontrados: null,
    erros: null,
    bloqueios: null,
    esperaMs: null,
    modeloAcionado: false,
    abortado: null,
  };
}

function concluido(
  linha: LinhaIngestLog,
  notas: NotasCiclo,
  cargo: CargoDoPainel,
  fatia: number | null,
): CicloBruto {
  const duracaoMs = linha.durationMs ?? 0;
  const acionados = Array.isArray(notas.model_triggered) ? notas.model_triggered : [];
  return {
    inicioMs: linha.tsMs - duracaoMs,
    fimMs: linha.tsMs,
    cargo,
    fatia,
    duracaoMs,
    pedidos: linha.filesFetched,
    novidades: linha.filesChanged,
    inalterados: numeroOuNull(notas.unchanged),
    naoEncontrados: numeroOuNull(notas.not_found),
    erros: linha.errors,
    bloqueios: numeroOuNull(notas.rateLimited),
    esperaMs: numeroOuNull(notas.waitedMs),
    modeloAcionado: acionados.includes(cargo),
    abortado: typeof notas.aborted === "string" ? notas.aborted : null,
  };
}

// ---------------------------------------------------------------------------
// Buracos
// ---------------------------------------------------------------------------

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1
    ? (v[meio] as number)
    : ((v[meio - 1] as number) + (v[meio] as number)) / 2;
}

/** Janela em que uma rodada "responde" a um acionamento: de 10 s antes a 4 min depois. */
export const RODADA_RESPONDE_ANTES_MS = 10_000;
export const RODADA_RESPONDE_DEPOIS_MS = 4 * MINUTO_MS;

/**
 * Projeção parada: dois horários de rodada consecutivos do MESMO cargo com
 * mais de `limiarMinutos` entre eles, dentro da janela ativa do cargo (da
 * primeira à última rodada — antes da primeira e depois da última não há
 * buraco, há noite que ainda não começou ou já acabou).
 *
 * Cada buraco é classificado pelo que a ingestão fez dentro dele:
 *
 *   - `acionamentos`: fins de ciclo do cargo que pediram projeção
 *     (`model_triggered`) no intervalo `(de, ate − 10 s)` — o acionamento que
 *     produziu a rodada `ate` fica de fora;
 *   - `acionamentosSemRodada`: desses, os que não têm rodada nenhuma do cargo
 *     entre 10 s antes e 4 min depois;
 *   - `tipo`: `"falha"` se algum acionamento ficou sem rodada (o modelo foi
 *     chamado e não gravou), `"sem-novidade"` se ninguém pediu (o TSE não
 *     mudou nada e, por desenho, o modelo não roda).
 */
/** {@link BuracoProjecao} em epoch ms — a forma interna. */
export type BuracoProjecaoBruto = Omit<BuracoProjecao, "de" | "ate"> & {
  deMs: number;
  ateMs: number;
};

export function detectarBuracosProjecao(
  rodadas: readonly { cargo: CargoDoPainel; tsMs: number }[],
  acionamentos: readonly { cargo: CargoDoPainel; tsMs: number }[],
  limiarMinutos = 10,
): BuracoProjecaoBruto[] {
  const out: BuracoProjecaoBruto[] = [];
  for (const cargo of CARGOS_COM_RODADA) {
    const horas = [...new Set(rodadas.filter((r) => r.cargo === cargo).map((r) => r.tsMs))].sort(
      (a, b) => a - b,
    );
    const pedidos = acionamentos.filter((a) => a.cargo === cargo).map((a) => a.tsMs);
    const temRodadaPara = (t: number) =>
      horas.some((h) => h >= t - RODADA_RESPONDE_ANTES_MS && h <= t + RODADA_RESPONDE_DEPOIS_MS);
    for (let i = 1; i < horas.length; i++) {
      const de = horas[i - 1] as number;
      const ate = horas[i] as number;
      const minutos = (ate - de) / MINUTO_MS;
      if (minutos <= limiarMinutos) continue;
      const dentro = pedidos.filter((t) => t > de && t < ate - RODADA_RESPONDE_ANTES_MS);
      const semRodada = dentro.filter((t) => !temRodadaPara(t)).length;
      out.push({
        cargo,
        deMs: de,
        ateMs: ate,
        minutos: Math.round(minutos * 10) / 10,
        acionamentos: dentro.length,
        acionamentosSemRodada: semRodada,
        tipo: semRodada > 0 ? "falha" : "sem-novidade",
      });
    }
  }
  return out.sort((a, b) => a.deMs - b.deMs);
}

/**
 * Folga somada ao limite de "ciclo parado": o agendador dispara com segundos de
 * variação, e um intervalo de 30 min 02 s numa sequência de mediana 15 min não
 * é um ciclo perdido — é o relógio. Sem a folga, toda troca de cadência
 * apareceria como buraco.
 */
export const FOLGA_BURACO_CICLOS_MS = 60_000;

/**
 * Ciclos parados: dentro de cada sequência `(cargo, fatia)`, dois fins de
 * ciclo concluído consecutivos com mais de `fator` × o intervalo mediano da
 * própria sequência (mais {@link FOLGA_BURACO_CICLOS_MS}) entre eles.
 *
 * Mediana e não média: um único buraco grande puxaria a média para cima e
 * esconderia a si mesmo. Sequência com menos de 3 ciclos não tem "normal"
 * para comparar e não gera buraco.
 */
/** {@link BuracoCiclos} em epoch ms — a forma interna. */
export type BuracoCiclosBruto = Omit<BuracoCiclos, "de" | "ate"> & { deMs: number; ateMs: number };

export function detectarBuracosCiclos(
  ciclos: readonly CicloBruto[],
  fator = 2,
): BuracoCiclosBruto[] {
  const porSequencia = new Map<string, number[]>();
  const meta = new Map<string, { cargo: CargoDoPainel; fatia: number | null }>();
  for (const c of ciclos) {
    if (c.fimMs === null || c.abortado !== null) continue;
    const chave = `${c.cargo}:${c.fatia ?? "-"}`;
    const lista = porSequencia.get(chave) ?? [];
    lista.push(c.fimMs);
    porSequencia.set(chave, lista);
    meta.set(chave, { cargo: c.cargo, fatia: c.fatia });
  }
  const out: BuracoCiclosBruto[] = [];
  for (const [chave, fins] of porSequencia) {
    fins.sort((a, b) => a - b);
    if (fins.length < 3) continue;
    const intervalos = fins.slice(1).map((f, i) => f - (fins[i] as number));
    const med = mediana(intervalos);
    if (!med || med <= 0) continue;
    const m = meta.get(chave) as { cargo: CargoDoPainel; fatia: number | null };
    for (let i = 1; i < fins.length; i++) {
      const de = fins[i - 1] as number;
      const ate = fins[i] as number;
      if (ate - de > fator * med + FOLGA_BURACO_CICLOS_MS) {
        out.push({
          cargo: m.cargo,
          fatia: m.fatia,
          deMs: de,
          ateMs: ate,
          minutos: Math.round(((ate - de) / MINUTO_MS) * 10) / 10,
          medianaMinutos: Math.round((med / MINUTO_MS) * 10) / 10,
        });
      }
    }
  }
  return out.sort((a, b) => a.deMs - b.deMs || a.cargo - b.cargo);
}

// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

export type EpisodioBloqueioBruto = Omit<EpisodioBloqueio, "de" | "ate"> & {
  deMs: number;
  ateMs: number;
};

/**
 * Junta em episódios os ciclos concluídos que relataram bloqueio (429) e se
 * sobrepõem no tempo. Ver {@link EpisodioBloqueio}: o contador é do processo,
 * então dois ciclos simultâneos podem estar relatando os MESMOS bloqueios — o
 * episódio devolve a faixa `[maior valor, soma]`.
 */
export function agruparBloqueios(ciclos: readonly CicloBruto[]): EpisodioBloqueioBruto[] {
  const comBloqueio = ciclos
    .filter((c) => c.fimMs !== null && (c.bloqueios ?? 0) > 0)
    .sort((a, b) => a.inicioMs - b.inicioMs);
  const out: EpisodioBloqueioBruto[] = [];
  for (const c of comBloqueio) {
    const fim = c.fimMs as number;
    const b = c.bloqueios as number;
    const atual = out[out.length - 1];
    if (atual && c.inicioMs <= atual.ateMs) {
      atual.ateMs = Math.max(atual.ateMs, fim);
      atual.minimo = Math.max(atual.minimo, b);
      atual.maximo += b;
      atual.ciclos.push({ cargo: c.cargo, fatia: c.fatia, bloqueios: b });
      continue;
    }
    out.push({
      deMs: c.inicioMs,
      ateMs: fim,
      minimo: b,
      maximo: b,
      ciclos: [{ cargo: c.cargo, fatia: c.fatia, bloqueios: b }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// % apurado do Presidente
// ---------------------------------------------------------------------------

/**
 * Número do EA20 (`"472075"`, `"12,5"`) → `number`, ou `null`. Mesma regra do
 * `_parse_br_number` do modelo: troca a vírgula decimal, não mexe em ponto.
 */
export function numeroTse(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Uma versão de arquivo agregado do Presidente (UF ou Brasil), só com as seções. */
export interface AgregadoApurado {
  tsMs: number;
  uf: string;
  nivel: string;
  /** `s.st` — seções totalizadas. */
  st: unknown;
  /** `s.ts` — total de seções. */
  tot: unknown;
}

/**
 * Refaz, minuto a minuto, o % apurado nacional do Presidente pela MESMA conta
 * que o site usava (`_pct_apurado_nacional_somado`, `api/model/project.py`):
 *
 *   Σ seções totalizadas das UFs (+ exterior) ÷ max(Σ total das UFs, total do arquivo Brasil)
 *
 * — e, ao lado, o que dizia o arquivo nacional do TSE (`br`), que atrasava em
 * relação às UFs (às 19h06 de 04/10 o `br` parou em 64,81% com a soma em 84,95%).
 *
 * Replay: percorre as versões em ordem, guarda a última de cada UF e emite UM
 * ponto por minuto (o último valor do minuto), só nos minutos em que algo mudou.
 * Uso de `snapshots.pct_apurado` é proibido aqui: é o `s.psa`, ~100% com uma
 * urna só.
 */
export function serieApuradoPresidente(agregados: readonly AgregadoApurado[]): {
  somaDosEstados: { tsMs: number; pct: number }[];
  arquivoBrasil: { tsMs: number; pct: number }[];
} {
  const ordenados = [...agregados].sort((a, b) => a.tsMs - b.tsMs);
  const porUf = new Map<string, { st: number; tot: number }>();
  let totBr = 0;
  const soma = new Map<number, number>();
  const brasil = new Map<number, number>();
  for (const a of ordenados) {
    const st = numeroTse(a.st);
    const tot = numeroTse(a.tot);
    if (st === null || tot === null || tot <= 0) continue;
    const minuto = Math.floor(a.tsMs / MINUTO_MS) * MINUTO_MS;
    if (a.nivel === "br") {
      totBr = Math.max(totBr, tot);
      brasil.set(minuto, limitar((100 * st) / tot));
    } else {
      porUf.set(a.uf.toUpperCase(), { st, tot });
    }
    let somaSt = 0;
    let somaTot = 0;
    for (const v of porUf.values()) {
      somaSt += v.st;
      somaTot += v.tot;
    }
    const den = Math.max(somaTot, totBr);
    if (porUf.size > 0 && den > 0) soma.set(minuto, limitar((100 * somaSt) / den));
  }
  const paraLista = (m: Map<number, number>) =>
    [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tsMs, pct]) => ({ tsMs, pct: Math.round(pct * 100) / 100 }));
  return { somaDosEstados: paraLista(soma), arquivoBrasil: paraLista(brasil) };
}

function limitar(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

// ---------------------------------------------------------------------------
// Arquivos parados
// ---------------------------------------------------------------------------

/** A última versão guardada de um arquivo do TSE na janela. */
export interface UltimaVersao {
  tsMs: number;
  cargo: number;
  nivel: string;
  uf: string;
  codMunicipioTse: number;
  codZona: number;
  st: unknown;
  tot: unknown;
  municipio: string | null;
}

/**
 * Arquivos cuja última versão guardada na noite tinha MENOS seções totalizadas
 * que o total: o TSE parou de atualizá-los antes de terminar (foi o que
 * aconteceu com 12 arquivos de zona do Presidente por volta das 21h de 04/10).
 * Um arquivo que termina em 100% e para de mudar é o normal — não entra.
 */
export function detectarArquivosParados(
  versoes: readonly UltimaVersao[],
): Array<Omit<ArquivoParado, "ultimaNovidade"> & { tsMs: number }> {
  const out: Array<Omit<ArquivoParado, "ultimaNovidade"> & { tsMs: number }> = [];
  for (const v of versoes) {
    if (!ehCargoDoPainel(v.cargo)) continue;
    const st = numeroTse(v.st);
    const tot = numeroTse(v.tot);
    if (st === null || tot === null || tot <= 0 || st >= tot) continue;
    const nivel = v.nivel === "uf" || v.nivel === "br" ? v.nivel : "zona";
    out.push({
      tsMs: v.tsMs,
      cargo: v.cargo,
      nivel,
      uf: v.uf.toUpperCase(),
      codMunicipioTse: v.codMunicipioTse,
      municipio: v.municipio,
      zona: v.codZona,
      secoesTotalizadas: st,
      secoesTotal: tot,
    });
  }
  return out.sort((a, b) => a.tsMs - b.tsMs || a.cargo - b.cargo);
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Contagem de `snapshots` num minuto, para um cargo. */
export interface NovidadesNoMinuto {
  minutoMs: number;
  cargo: number;
  n: number;
}

export interface RodadaBruta {
  cargo: number;
  tsMs: number;
  dadoTsMs: number | null;
}

export interface CommitBruto {
  hash: string;
  tsMs: number;
  titulo: string;
}

export interface InsumosRetrato {
  deMs: number;
  ateMs: number;
  turno: number;
  ambiente: string;
  geradoEmMs: number;
  nomes: Record<CargoDoPainel, string>;
  ingest: readonly LinhaIngestLog[];
  novidades: readonly NovidadesNoMinuto[];
  rodadas: readonly RodadaBruta[];
  agregadosPresidente: readonly AgregadoApurado[];
  ultimasVersoes: readonly UltimaVersao[];
  commits: readonly CommitBruto[];
  gitRef: string;
  correcoesDeMs: number;
  correcoesAteMs: number;
}

function seriesVazias(n: number): SeriePorCargo {
  const out = {} as SeriePorCargo;
  for (const c of CARGOS_DO_PAINEL) out[String(c) as ChaveCargo] = new Array<number>(n).fill(0);
  return out;
}

function arredondar(s: SeriePorCargo, casas = 0): SeriePorCargo {
  const f = 10 ** casas;
  const out = {} as SeriePorCargo;
  for (const [k, v] of Object.entries(s) as [ChaveCargo, number[]][]) {
    out[k] = v.map((x) => Math.round(x * f) / f);
  }
  return out;
}

function ciclosParaPainel(c: CicloBruto): CicloPainel {
  return {
    inicio: isoBrt(c.inicioMs),
    fim: c.fimMs === null ? null : isoBrt(c.fimMs),
    cargo: c.cargo,
    fatia: c.fatia,
    duracaoS: c.duracaoMs === null ? null : Math.round(c.duracaoMs / 100) / 10,
    pedidos: c.pedidos,
    novidades: c.novidades,
    inalterados: c.inalterados,
    naoEncontrados: c.naoEncontrados,
    erros: c.erros,
    bloqueios: c.bloqueios,
    esperaS: c.esperaMs === null ? null : Math.round(c.esperaMs / 100) / 10,
    modeloAcionado: c.modeloAcionado,
    abortado: c.abortado,
  };
}

/**
 * Monta o retrato inteiro a partir das linhas lidas do banco. Pura e
 * determinística: mesma entrada, mesmo JSON (o `geradoEm` vem de fora).
 */
export function montarRetrato(ins: InsumosRetrato): RetratoPainel {
  const inicioEixo = Math.floor(ins.deMs / MINUTO_MS) * MINUTO_MS;
  const minutos = Math.max(0, Math.ceil((ins.ateMs - inicioEixo) / MINUTO_MS));

  const { ciclos, ignoradas } = parearCiclos(ins.ingest, {
    turno: ins.turno,
    ambiente: ins.ambiente,
  });

  const pedidos = seriesVazias(minutos);
  const concluidos = seriesVazias(minutos);
  const erros = seriesVazias(minutos);
  const naoEncontrados = seriesVazias(minutos);
  const bloqueios = seriesVazias(minutos);
  const espera = seriesVazias(minutos);
  for (const c of ciclos) {
    if (c.fimMs === null) continue;
    const k = String(c.cargo) as ChaveCargo;
    espalharPorMinuto(pedidos[k], inicioEixo, c.inicioMs, c.fimMs, c.pedidos ?? 0);
    somarNoMinuto(concluidos[k], inicioEixo, c.fimMs, 1);
    somarNoMinuto(erros[k], inicioEixo, c.fimMs, c.erros ?? 0);
    somarNoMinuto(naoEncontrados[k], inicioEixo, c.fimMs, c.naoEncontrados ?? 0);
    somarNoMinuto(bloqueios[k], inicioEixo, c.fimMs, c.bloqueios ?? 0);
    somarNoMinuto(espera[k], inicioEixo, c.fimMs, (c.esperaMs ?? 0) / 1000);
  }

  const novidades = seriesVazias(minutos);
  const novidadesPorCargo = new Map<CargoDoPainel, number>();
  for (const n of ins.novidades) {
    if (!ehCargoDoPainel(n.cargo)) continue;
    somarNoMinuto(novidades[String(n.cargo) as ChaveCargo], inicioEixo, n.minutoMs, n.n);
    if (n.minutoMs >= ins.deMs && n.minutoMs < ins.ateMs) {
      novidadesPorCargo.set(n.cargo, (novidadesPorCargo.get(n.cargo) ?? 0) + n.n);
    }
  }

  const rodadasValidas = ins.rodadas
    .filter((r): r is RodadaBruta & { cargo: CargoDoPainel } => ehCargoDoPainel(r.cargo))
    .sort((a, b) => a.tsMs - b.tsMs || a.cargo - b.cargo);
  const rodadasSerie = seriesVazias(minutos);
  for (const r of rodadasValidas) {
    somarNoMinuto(rodadasSerie[String(r.cargo) as ChaveCargo], inicioEixo, r.tsMs, 1);
  }

  const acionamentos = ciclos
    .filter((c) => c.fimMs !== null && c.modeloAcionado)
    .map((c) => ({ cargo: c.cargo, tsMs: c.fimMs as number }));
  const buracosProjecao = detectarBuracosProjecao(rodadasValidas, acionamentos).map(
    ({ deMs, ateMs, ...resto }) => ({ ...resto, de: isoBrt(deMs), ate: isoBrt(ateMs) }),
  );
  const buracosCiclos = detectarBuracosCiclos(ciclos).map(({ deMs, ateMs, ...resto }) => ({
    ...resto,
    de: isoBrt(deMs),
    ate: isoBrt(ateMs),
  }));

  const apurado = serieApuradoPresidente(ins.agregadosPresidente);
  const pontos = (l: { tsMs: number; pct: number }[]): PontoApurado[] =>
    l.map((p) => ({ hora: isoBrt(p.tsMs), pct: p.pct }));

  const correcoes: CorrecaoPainel[] = [...ins.commits]
    .filter((c) => c.tsMs >= ins.correcoesDeMs && c.tsMs < ins.correcoesAteMs)
    .sort((a, b) => a.tsMs - b.tsMs)
    .map((c) => ({ hash: c.hash, hora: isoBrt(c.tsMs), titulo: c.titulo }));

  const totais: TotaisCargo[] = CARGOS_DO_PAINEL.map((cargo) => {
    const doCargo = ciclos.filter((c) => c.cargo === cargo);
    const feitos = doCargo.filter((c) => c.fimMs !== null);
    const duracoes = feitos
      .filter((c) => c.abortado === null && c.duracaoMs !== null)
      .map((c) => c.duracaoMs as number);
    const soma = (f: (c: CicloBruto) => number | null) =>
      feitos.reduce((s, c) => s + (f(c) ?? 0), 0);
    const med = mediana(duracoes);
    const temRodada = (CARGOS_COM_RODADA as readonly number[]).includes(cargo);
    return {
      cargo,
      ciclos: feitos.length,
      interrompidos: doCargo.length - feitos.length,
      pedidos: soma((c) => c.pedidos),
      novidades: novidadesPorCargo.get(cargo) ?? 0,
      erros: soma((c) => c.erros),
      naoEncontrados: soma((c) => c.naoEncontrados),
      bloqueios: soma((c) => c.bloqueios),
      esperaS: Math.round(soma((c) => c.esperaMs) / 1000),
      duracaoMedianaS: med === null ? null : Math.round(med / 100) / 10,
      duracaoMaximaS: duracoes.length ? Math.round(Math.max(...duracoes) / 100) / 10 : null,
      ciclosAcimaDe300s: duracoes.filter((d) => d > 300_000).length,
      rodadas: temRodada
        ? new Set(rodadasValidas.filter((r) => r.cargo === cargo).map((r) => r.tsMs)).size
        : null,
    };
  });

  return {
    versao: VERSAO_RETRATO,
    geradoEm: isoBrt(ins.geradoEmMs),
    turno: ins.turno,
    janela: { de: isoBrt(ins.deMs), ate: isoBrt(ins.ateMs) },
    eixo: { inicio: isoBrt(inicioEixo), minutos },
    cargos: CARGOS_DO_PAINEL.map((cd) => ({ cd, nome: ins.nomes[cd] })),
    porMinuto: {
      pedidosEstimados: arredondar(pedidos),
      novidades,
      ciclosConcluidos: concluidos,
      erros,
      naoEncontrados,
      bloqueios,
      esperaSegundos: arredondar(espera),
      rodadasProjecao: rodadasSerie,
    },
    ciclos: ciclos.map(ciclosParaPainel),
    rodadas: rodadasValidas.map((r) => ({
      cargo: r.cargo,
      hora: isoBrt(r.tsMs),
      horaDoBoletim: r.dadoTsMs === null ? null : isoBrt(r.dadoTsMs),
    })),
    buracosProjecao,
    buracosCiclos,
    arquivosParados: detectarArquivosParados(ins.ultimasVersoes).map(({ tsMs, ...resto }) => ({
      ...resto,
      ultimaNovidade: isoBrt(tsMs),
    })),
    episodiosDeBloqueio: agruparBloqueios(ciclos).map(({ deMs, ateMs, ...resto }) => ({
      ...resto,
      de: isoBrt(deMs),
      ate: isoBrt(ateMs),
    })),
    apuradoPresidente: {
      somaDosEstados: pontos(apurado.somaDosEstados),
      arquivoBrasil: pontos(apurado.arquivoBrasil),
    },
    correcoes,
    totais,
    fonte: {
      gitRef: ins.gitRef,
      linhasIgnoradas: ignoradas,
      janelaCorrecoes: { de: isoBrt(ins.correcoesDeMs), ate: isoBrt(ins.correcoesAteMs) },
    },
  };
}
