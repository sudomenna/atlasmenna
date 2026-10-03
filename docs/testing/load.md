---
title: Load Test (k6)
description: Simula 20k VUs sustentados, valida p95 <200ms e error rate <0.1%
status: stable
source: PRD.md § 20.5
---

# Load Test (k6)

```js
// scripts/load-test.k6.js
export const options = {
  stages: [
    { duration: '5m', target: 20000 },
    { duration: '30m', target: 20000 },
    { duration: '2m', target: 0 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.001']
  }
};

export default function () {
  http.get('https://atlasmenna.online/api/projection');
  sleep(5);
}
```

## Aceite

- p95 <200ms
- Error rate <0.1%
- Cache hit ratio >99%

## Cross-refs

- NFR performance: [../nfr/performance.md](../nfr/performance.md)
- OT-1 (20k+ simultâneos): [../product/success-metrics.md](../product/success-metrics.md)
