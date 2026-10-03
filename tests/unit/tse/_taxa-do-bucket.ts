/**
 * tests/unit/tse/_taxa-do-bucket.ts
 *
 * Mede, com relógio falso, as DUAS grandezas de um token bucket que, até
 * 2026-10-03, se confundiam num número só: a **rajada** (quantas requisições
 * saem sem esperar num bucket recém-criado) e a **taxa** (quantas por segundo em
 * regime). Enquanto `burst = ratePerSec`, contar tokens com `tryAcquire()` dava
 * a taxa de graça; com a rajada fixa em `TSE_BURST_INICIAL` (2), contar tokens
 * mede só a rajada, e a taxa precisa ser medida pelo tempo que o bucket leva
 * para entregar N tokens.
 */
import { vi } from "vitest";
import type { TokenBucket } from "@/lib/tse/rate-limiter";

export interface MedidaDoBucket {
  /** Tokens entregues por `tryAcquire()` num bucket recém-criado, sem esperar. */
  rajada: number;
  /** Requisições por segundo em regime, medida no relógio falso e arredondada. */
  taxa: number;
}

/**
 * Esvazia a rajada do bucket e mede a taxa de reposição com `n` `acquire()`.
 * O bucket deve estar recém-criado (ou recém-resetado) para a rajada valer.
 */
export async function medirBucket(bucket: TokenBucket, n = 200): Promise<MedidaDoBucket> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    let rajada = 0;
    while (bucket.tryAcquire()) {
      rajada++;
      if (rajada > 1000) throw new Error("bucket sem limite de rajada");
    }

    const t0 = Date.now();
    let pronto = false;
    const rodada = (async () => {
      for (let i = 0; i < n; i++) await bucket.acquire();
      pronto = true;
    })();
    for (let i = 0; !pronto; i++) {
      if (i > 10 * n) throw new Error("medirBucket: acquire não terminou");
      await vi.advanceTimersToNextTimerAsync();
    }
    await rodada;

    const taxa = Math.round(n / ((Date.now() - t0) / 1000));
    return { rajada, taxa };
  } finally {
    vi.useRealTimers();
  }
}
