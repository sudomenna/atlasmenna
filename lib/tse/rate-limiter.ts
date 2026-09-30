/**
 * lib/tse/rate-limiter.ts
 *
 * Token-bucket rate limiter para chamadas de saída ao CDN TSE.
 *
 * Por que isto existe (2026-09-05): a FAQ técnica do simulado TSE confirmou
 * um limite duro de **100 req/s por IP → bloqueio de 10 minutos**, e que
 * **304 conta no limite** (se-modified-since não é "grátis"). O pipeline
 * anterior não tinha nenhum controle de vazão de saída — só um semáforo de
 * concorrência (`CONCURRENCY`), que limita quantas requisições ficam
 * simultaneamente em voo mas não a taxa por segundo. Em produção (~5.200
 * GETs/ciclo — ver docs/reference/risks.md) isso pode facilmente estourar
 * 100 req/s e derrubar o IP por 10min no meio do dia de apuração.
 *
 * Cobre: RF-001 (consumo do CDN TSE dentro dos limites operacionais).
 *
 * Design:
 *   - `createTokenBucket` é a implementação pura, testável com relógio e
 *     sleep injetados (sem `setTimeout` real nos testes).
 *   - `getTseRateLimiter(cargo)` devolve o bucket **daquele cargo** dentro do
 *     processo (ADR-0068): um mapa `cargo → bucket`, criado sob demanda, lendo
 *     `TSE_MAX_RPS` do ambiente quando definida; senão o `rpsMax` do cargo
 *     (`lib/config/cargos.ts`: 25 para Presidente, Governador e Senador;
 *     5 para Deputado Federal — os quatro em granularidade zona, 6.110 alvos
 *     cada, sendo que o cargo 6 varre em 6 fatias desde o ADR-0036). Clamp
 *     1..50 — nunca deixamos configurar acima do limite documentado do TSE
 *     por engano. Sem cargo, um bucket próprio no default seguro; nunca o de
 *     um cargo.
 *   - Chamadas concorrentes a `acquire()` são serializadas via uma cadeia de
 *     Promises (`chain`), garantindo que a N-ésima chamada simultânea espere
 *     o tempo cumulativo correto em vez de todas computarem a mesma espera
 *     "ingênua" a partir do estado atual do bucket.
 */
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TokenBucketStats {
  /** Total de tokens concedidos (acquire bem-sucedido + tryAcquire true). */
  acquired: number;
  /** Soma de todo tempo de espera (ms) gasto dentro de acquire(). */
  waitedMs: number;
  /** Maior número de chamadas a acquire() aguardando concorrentemente. */
  maxQueue: number;
}

export interface TokenBucket {
  /** Resolve quando um token está disponível — pode esperar (sleep). */
  acquire(): Promise<void>;
  /** Consome um token se disponível AGORA, sem esperar. Nunca espera. */
  tryAcquire(): boolean;
  readonly stats: TokenBucketStats;
}

export interface TokenBucketOptions {
  /** Taxa de reposição de tokens por segundo. Deve ser > 0. */
  ratePerSec: number;
  /** Capacidade máxima (burst inicial). Default: igual a ratePerSec. Os buckets
   * de produção (`getTseRateLimiter`) passam `TSE_BURST_INICIAL` (2). */
  burst?: number;
  /** Relógio injetável (ms epoch). Default: Date.now. */
  now?: () => number;
  /** Sleep injetável. Default: setTimeout real. */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// createTokenBucket
// ---------------------------------------------------------------------------

export function createTokenBucket(opts: TokenBucketOptions): TokenBucket {
  if (!(opts.ratePerSec > 0)) {
    throw new Error(`createTokenBucket: ratePerSec deve ser > 0 (recebido: ${opts.ratePerSec})`);
  }

  const ratePerSec = opts.ratePerSec;
  const capacity = opts.burst ?? ratePerSec;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let tokens = capacity;
  let lastRefill = now();
  let queueLength = 0;

  // Cadeia de serialização: cada acquire() encadeia sua espera atrás da
  // anterior, garantindo que chamadas concorrentes consumam o bucket em
  // ordem FIFO e acumulem espera corretamente (em vez de cada uma computar
  // independentemente "quanto falta a partir do estado atual").
  let chain: Promise<void> = Promise.resolve();

  const stats: TokenBucketStats = { acquired: 0, waitedMs: 0, maxQueue: 0 };

  function refill(): void {
    const t = now();
    const elapsedSec = (t - lastRefill) / 1000;
    if (elapsedSec > 0) {
      tokens = Math.min(capacity, tokens + elapsedSec * ratePerSec);
      lastRefill = t;
    }
  }

  function tryAcquire(): boolean {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      stats.acquired += 1;
      return true;
    }
    return false;
  }

  function acquire(): Promise<void> {
    queueLength += 1;
    stats.maxQueue = Math.max(stats.maxQueue, queueLength);

    const task = chain.then(async () => {
      refill();
      if (tokens < 1) {
        const deficit = 1 - tokens;
        const waitMs = Math.max(0, Math.ceil((deficit / ratePerSec) * 1000));
        if (waitMs > 0) {
          await sleep(waitMs);
          stats.waitedMs += waitMs;
          refill();
        }
      }
      tokens = Math.max(0, tokens - 1);
      stats.acquired += 1;
      queueLength -= 1;
    });

    chain = task;
    return task;
  }

  return { acquire, tryAcquire, stats };
}

// ---------------------------------------------------------------------------
// Buckets por cargo — getTseRateLimiter (ADR-0068)
// ---------------------------------------------------------------------------

/** Limite documentado pelo TSE é 100 req/s/IP, com bloqueio de 10 min
 *  renovado em caso de violação. Nunca deixamos configurar acima de 50
 *  mesmo via env, para deixar margem de segurança (outros processos no
 *  mesmo IP, retries, HEAD do tse-watch, e o 304 que tratamos como se
 *  consumisse cota). Teto exigido por RF-010.3 da spec 001 — não elevar
 *  sem revisar a spec e o ADR-0020.
 *
 * NÃO existe mais um default único. Desde 2026-09-11 (ADR-0026, nota do mesmo
 * dia) o teto padrão é **por cargo**, e a fonte canônica é o campo `rpsMax` de
 * `lib/config/cargos.ts` — 25 rps para Presidente, Governador e Senador e
 * 5 rps para Deputado Federal, os quatro em granularidade zona com 6.110
 * alvos cada. `TSE_MAX_RPS_DEFAULT`, logo abaixo, vale só para o caller que
 * não informa cargo. Mudar qualquer um desses números é mudar `cargos.ts`,
 * não este arquivo.
 *
 * Por que por cargo. Os buckets de instâncias DIFERENTES não se coordenam, e o
 * que o TSE vê no IP é a SOMA de tudo que está no ar. Não são mais dois
 * cargos: são **quatro**, com crons próprios em `vercel.ts` que podem cair no
 * mesmo minuto. Com o default único de 40 o pior caso era 4 × 40 = **160 rps**,
 * acima do teto do TSE — medido em 2026-09-11.
 *
 * ⚠️ Correção de 2026-09-30 (ADR-0068): este comentário dizia que o Fluid
 * Compute "isola instâncias por invocação concorrente", logo cada invocação
 * teria o seu bucket. **Não isola.** O Fluid Compute REAPROVEITA instâncias e
 * multiplexa invocações concorrentes na mesma — então um singleton de processo
 * era um bucket compartilhado por tudo que caísse na instância, com a taxa de
 * quem chegou primeiro (Presidente e Governador concorrentes dividiam 25 rps).
 * Por isso o bucket agora é por CARGO dentro do processo: a soma dos tetos por
 * cargo só descreve o código quando cada cargo tem o seu bucket, com o teto
 * dele.
 *
 * A calibragem atual mantém o pior caso agregado em **82 rps**
 * (25 + 25 + 25 + 5 + 1 + 1 = `piorCasoAgregadoRps()`), 18% abaixo do teto
 * documentado. Era 80 até 2026-09-29; os dois `+1` são Deputado Estadual e
 * Distrital na Fase 1 da spec 027 (ADR-0067), um resumo por casa a 1 rps.
 * A constituição § 1 exige teto "**bem abaixo** do limite documentado", e é
 * essa folga — não o valor por invocação isolado — que satisfaz o texto: ela é
 * o que sobra para retry, para o HEAD do `tse-watch`, para o 304 (que conta) e
 * para qualquer outro processo no mesmo IP. Um default de 50 por invocação já
 * foi tentado e recusado pela auditoria constitucional de 11/09, justamente
 * porque punha o agregado em exatamente 100: "no limite" não é "bem abaixo".
 *
 * Custo do lado do ciclo: 6.110 GETs a 25 rps ≈ **244 s** por cargo pesado,
 * dentro do `maxDuration` de 300 s mas com menos folga que antes — daí a
 * medição de `duration_ms` no simulado 1 ser obrigatória. Deputado Federal, a
 * 5 rps, levaria ~1.222 s se pedisse os 6.110 de uma vez; por isso o ADR-0036
 * o divide em **6 fatias** de ~1.019 alvos (~204 s cada), e não sobe o rps
 * dele: é o teto agregado que manda, não o conforto do cargo.
 *
 * O CEILING segue em 50 para que uma janela SUPERVISIONADA (simulado, com
 * alguém lendo `rateLimited` em tempo real) possa subir via `TSE_MAX_RPS`
 * deliberadamente. Produção desassistida usa o teto do cargo. ⚠️ `TSE_MAX_RPS`
 * é override GLOBAL: ela substitui o teto de todos os cargos de uma vez, então
 * um valor alto multiplica pelo número de crons simultâneos.
 *
 * Rajada inicial (2026-10-03, ADR-0068): resolvida — todo bucket de produção
 * nasce com `TSE_BURST_INICIAL` = 2 tokens (abaixo). O pico do agregado caiu de
 * 156 para 88 req no pior segundo.
 *
 * Pendência registrada: buckets independentes garantem a média; entre
 * INSTÂNCIAS diferentes (que não se coordenam) nada limita o pico. Um
 * limitador coordenado entre invocações (contador compartilhado) é a solução completa — decidir depois do simulado 1, com
 * `rateLimited` medido. Histórico do default: 30 quando um único ciclo cobria
 * todos os cargos sequencialmente; 50 e depois 40 na fase de dois cargos
 * concorrentes (ADR-0035 D3 e a auditoria que o emendou); por cargo desde a
 * entrada de Senador e Deputado. */
const TSE_MAX_RPS_CEILING = 50;
const TSE_MAX_RPS_FLOOR = 1;
/** Default quando o caller não informa cargo — o teto dos cargos leves, que é
 * o valor seguro sem saber quem mais está no ar. Ver `getTseRateLimiter`. */
const TSE_MAX_RPS_DEFAULT = 5;

/** Rajada inicial (capacidade) de TODO bucket de produção: 2 tokens, não a taxa.
 *
 * Com `burst = rps` o bucket nasce cheio e cada cargo emite até 2 × taxa no 1º
 * segundo; os quatro ciclos disparam juntos a cada múltiplo de 5 min, e o teste
 * de carga mediu **156 requisições no 1º segundo** (49+49+49+9) contra os 100
 * req/s/IP do TSE (bloqueio de 10 min). Com 2 tokens, o pior segundo deslizante
 * é (taxa + 2) por cargo: 27+27+27+7 = **88**. Não é 1: com capacidade 1 o
 * `refill()` descarta o overshoot do `setTimeout` (o timer dispara alguns ms
 * depois do devido e o excedente passa do teto de 1 token), e a taxa efetiva a
 * 25 rps caiu 2–26% medido — o ciclo de ~244 s chegaria perto dos 300 s de
 * `maxDuration`. Ver ADR-0068. */
export const TSE_BURST_INICIAL = 2;

/** Um bucket por cargo dentro do processo (ADR-0068). Nunca uma chamada de um
 * cargo decide a taxa de outro. */
const bucketsPorCargo = new Map<CargoTse, TokenBucket>();

/** Bucket das chamadas SEM cargo (diagnóstico, script avulso). Próprio, no
 * default seguro — nunca compartilhado com o de um cargo. Nenhum caminho de
 * produção o usa (ver `getTseRateLimiter`). */
let bucketSemCargo: TokenBucket | null = null;

/**
 * getTseRateLimiter — bucket de taxa das chamadas ao CDN do TSE **de um cargo**.
 *
 * `cargo` define o teto **padrão** (`lib/config/cargos.ts`, campo `rpsMax`):
 * 25 rps para Presidente, Governador e Senador (6.110 alvos cada) e 5 rps para
 * Deputado Federal — que desde o ADR-0036 (13/09) também pede 6.110, mas
 * **fatiado em 6 invocações** de ~1.019 alvos, ~204 s cada. `TSE_MAX_RPS` no
 * ambiente sobrepõe para todos — é a escotilha de janela supervisionada, e vale
 * POR BUCKET.
 *
 * ## Semântica (ADR-0068)
 *
 *   - **Mesmo cargo, mesma instância → mesmo bucket.** Invocações concorrentes
 *     do mesmo cargo dividem o teto do cargo: o teto vale por IP, não por
 *     invocação. É o comportamento seguro.
 *   - **Cargos diferentes não se afetam.** Quem chega primeiro à instância não
 *     decide a taxa de ninguém: criar o bucket do cargo 6 (5 rps) antes do do
 *     cargo 1 não muda os 25 rps do Presidente.
 *   - **Sem cargo** (`undefined`: `tse-watch`, diagnóstico) → bucket próprio em
 *     `TSE_MAX_RPS_DEFAULT`. ⚠️ **Nenhum caminho de produção pode usar este
 *     bucket**: ele não entra em `piorCasoAgregadoRps()`, e um chamador de cron
 *     que o usasse somaria +5 rps à conta (80 → 85). Por isso `fetchEA20` e
 *     `detectChangedUfs` recebem `cargo` OBRIGATÓRIO no tipo, e
 *     `tests/unit/tse/rate-limiter-por-cargo.test.ts` varre o código de
 *     produção atrás de chamadas sem argumento.
 *
 * ## Por que o teto é por cargo (2026-09-11)
 *
 * Até então o default era **40 para todos**, calibrado quando existiam DOIS
 * cargos: pior caso 2 x 40 = 80 rps, 20% abaixo do teto documentado de 100.
 * Com a entrada de Senador e Deputado (ADR-0026), os quatro crons de
 * `vercel.ts` passam a coincidir — à época nos minutos 0, 15, 30 e 45 (cadências
 * de 5 e 15 min sobre a de 1 min dos majoritários); desde o ADR-0036, que pôs
 * Deputado em 6 fatias intercaladas de 5 em 5 min, a cada múltiplo de 5 — e o pior
 * caso medido virou **160 rps**, acima do teto, que bloqueia o IP por 10 min.
 * A constituição § 1 exige "bem abaixo".
 *
 * O que o TSE vê no IP é a soma dos tetos por cargo: 25+25+25+5 = **80 rps** no
 * pior caso (`piorCasoAgregadoRps()`; **82** desde a spec 027, com 7 e 8 a 1 rps
 * cada — ADR-0067), inalterado pelo ADR-0036 — é justamente
 * por manter o cargo 6 em 5 rps que a varredura dele precisa ser fatiada, e não
 * o contrário. Essa soma supõe um bucket independente POR CARGO, que é o que
 * este módulo entrega desde o ADR-0068. Ela NÃO cobre duas instâncias do MESMO
 * cargo ao mesmo tempo (buckets de instâncias diferentes não se coordenam) —
 * quem evita isso é o lock anti-overlap de `ingest-handler.ts`.
 *
 * A pendência do limitador **coordenado** entre instâncias (contador
 * compartilhado) continua aberta: buckets independentes garantem a média, não
 * o pico instantâneo. Decidir depois do simulado 1, com `rateLimited` medido.
 */
export function getTseRateLimiter(cargo?: CargoTse): TokenBucket {
  if (cargo === undefined) {
    if (!bucketSemCargo) {
      bucketSemCargo = createTokenBucket({
        ratePerSec: taxaEfetiva(TSE_MAX_RPS_DEFAULT),
        burst: TSE_BURST_INICIAL,
      });
    }
    return bucketSemCargo;
  }

  const existente = bucketsPorCargo.get(cargo);
  if (existente) return existente;

  const criado = createTokenBucket({
    ratePerSec: taxaEfetiva(cargoInfo(cargo).rpsMax),
    burst: TSE_BURST_INICIAL,
  });
  bucketsPorCargo.set(cargo, criado);
  return criado;
}

/**
 * taxaEfetiva — teto de um bucket: `TSE_MAX_RPS` do ambiente quando definida,
 * senão o `padrao` (o `rpsMax` do cargo, ou o default sem cargo), sempre com
 * clamp em [1, 50].
 *
 * Ausente/vazio/não-numérico → cai no padrão ANTES do clamp. Um valor numérico
 * explícito — mesmo 0 ou negativo — é clampado em vez de ignorado:
 * "TSE_MAX_RPS=0" é uma configuração inválida, não uma ausência de
 * configuração, então o resultado é o floor (1), não o padrão.
 */
function taxaEfetiva(padrao: number): number {
  let ratePerSec = padrao;
  const raw = process.env.TSE_MAX_RPS;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) {
      ratePerSec = parsed;
    }
  }
  return Math.min(TSE_MAX_RPS_CEILING, Math.max(TSE_MAX_RPS_FLOOR, ratePerSec));
}

/**
 * resetTseRateLimiter — descarta TODOS os buckets (o de cada cargo e o sem
 * cargo).
 *
 * Uso: testes que precisam de um bucket "limpo" (burst cheio de novo) entre
 * casos, e trocas de `TSE_MAX_RPS` em runtime (ex.: escalonar a taxa entre
 * as janelas do simulado — ver Fase 4 do plano de prontidão TSE).
 */
export function resetTseRateLimiter(): void {
  bucketsPorCargo.clear();
  bucketSemCargo = null;
}
