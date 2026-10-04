// vercel.ts — config typed do projeto (substitui vercel.json).
// Cron de /api/ingest é placeholder; cadência final entra em S02 após
// publicação da resolução TSE 2026 (constituição § 1).
//
// O tipo @vercel/config ainda não existe como pacote npm consolidado;
// usamos um shape literal validado em deploy. Mantemos o objeto exportado
// como `const` para que `pnpm typecheck` enforce o shape mínimo.

export type VercelCron = {
  path: string;
  schedule: string;
};

// Rolling Release não é serializável no bundle do projeto — é configuração
// account/project-side aplicada via `vercel rolling-release configure`
// (Vercel CLI) e armazenada no Vercel API. Mantemos aqui um marker tipado
// como source-of-truth da política desejada, para auditoria e para que
// `pnpm typecheck` quebre se alguém alterar sem revisar.
export type RollingReleaseStage = {
  /** Porcentagem de tráfego no canary nesta etapa (0..100). */
  percentage: number;
  /** Duração mínima antes de avançar (formato Vercel: ex. "5m", "10m"). */
  duration?: string;
};

export type RollingReleasePolicy = {
  enabled: boolean;
  advancementType: "automatic" | "manual-approval";
  stages: RollingReleaseStage[];
};

// Function-level overrides (runtime, maxDuration, memory).
// Schema espelha https://vercel.com/docs/projects/project-configuration#functions.
// Mantemos campos opcionais e fechado pra evitar drift (lição S01: vercel.ts
// rejeita props extras na validação do deploy).
export type VercelFunctionConfig = {
  /**
   * Runtime explícito — usado APENAS para third-party community runtimes
   * com versão (ex.: "vercel-php@0.7.3"). Runtimes nativos do Vercel
   * (Node.js, Edge, Python) NÃO são declarados aqui — são detectados
   * automaticamente. Para Python, use `.python-version` na raiz.
   */
  runtime?: string;
  /** Timeout máximo da invocation em segundos. Pro: até 800s com Fluid Compute. */
  maxDuration?: number;
  /** Memória em MB. Default 1024. */
  memory?: number;
  /** Glob de exclusão pra reduzir bundle (Python: limite 500MB uncompressed). */
  excludeFiles?: string;
};

export type VercelProjectConfig = {
  $schema?: string;
  crons?: VercelCron[];
  regions?: string[];
  /**
   * Functions config — chave é glob relativo à raiz do projeto.
   * Vercel reconhece functions Python sob `api/**.py` automaticamente,
   * mas declaramos `runtime` e `maxDuration` explicitamente pra pinar.
   */
  functions?: Record<string, VercelFunctionConfig>;
};

// Rolling Release (RF-059, constituição § 7) — canary 10% → 50% → 100% com
// manual-approval. NÃO é consumido pelo schema do vercel.ts (Vercel rejeita
// propriedades extras na validação). É aplicado no projeto via:
//   vercel rolling-release configure --enable \
//     --advancement-type=manual-approval --stage=10 --stage=50
// Estágio final (100%) é implícito quando o último stage é aprovado. Mantemos
// este export como source-of-truth tipada da política para auditoria.
export const rollingReleasePolicy: RollingReleasePolicy = {
  enabled: true,
  advancementType: "manual-approval",
  stages: [{ percentage: 10 }, { percentage: 50 }],
};

const config: VercelProjectConfig = {
  // Crons da spec 001 (ingestão TSE).
  // ADR-0011 fixou cadência em 60s — Vercel Cron mínimo nativo é 1/min.
  // RNF-006: defasagem TSE→tela <90s.
  //
  // ---------------------------------------------------------------------------
  // Achado (B) — 2026-09-11, ADR-0035 D3
  // ---------------------------------------------------------------------------
  // Uma query string em `path` (ex.: `/api/ingest?cargo=1`) NÃO é documentada
  // pela Vercel (vercel.com/docs/cron-jobs, vercel.com/docs/cron-jobs/manage-cron-jobs
  // — lidos 2026-09-11). O que a doc documenta, com exemplo literal, é
  // distinguir dois crons NO MESMO horário por SEGMENTO DE ROTA:
  //   `/api/sync-slack-team/T0CAQ10TZ` e `/api/sync-slack-team/T4BOE34OP`.
  // O header `x-vercel-cron-schedule` só ajuda a distinguir crons de
  // HORÁRIOS diferentes — inútil aqui, porque presidente e governador rodam
  // no mesmo minuto. Por isso cada janela abaixo vira UMA ENTRADA POR CARGO,
  // apontando para `/api/ingest/<slug>` (app/api/ingest/[cargo]/route.ts,
  // slugs em `lib/config/cargos.ts`), não para `/api/ingest?cargo=`.
  //
  // Nota 2026-09-11: isto **emenda o ADR-0026 item 1**, que previa
  // `?cargos=5` / `?cargos=6` por query string para Senador e Deputado. Aquele
  // mecanismo não existe na Vercel; o correto é o segmento de rota, e é o que
  // está abaixo.
  //
  // - Cron de apuração: a cada minuto na janela 17h–04h BRT (UTC-3 sem DST).
  //   17h BRT = 20h UTC; 04h BRT = 07h UTC. Em cron UTC: hours 20-23,0-7.
  // - Cron do simulado (2026-09-05): 9h-16h59 BRT = 12h-19h UTC, todo minuto.
  //   ⚠️ 2026-09-29: era `12-20`, que se sobrepunha à hora 20 UTC (17h BRT) da
  //   janela de apuração `20-23,0-7` — o MESMO path disparava duas vezes por
  //   slot na primeira hora da apuração, e a trava `getLastIngestRun` é
  //   ler-e-agir (não atômica): as duas invocações podiam passar e dobrar o
  //   ritmo contra o CDN do TSE (limite 100 req/s, bloqueio de 10 min).
  //   Teste: tests/unit/config/vercel-crons.test.ts.
  //   Os simulados oficiais TSE rodam 15-17/09 e 22-24/09, 9h-17h BRT
  //   (ver docs/testing/tse-simulados.md). Este cron roda TODO DIA nessa
  //   janela — não só nos dias do simulado — porque `runIngestCycle`
  //   (lib/tse/ingest-handler.ts) já resolve isso via `INGEST_WINDOW`
  //   (default "17-04"; setar `INGEST_WINDOW=9-17` no ambiente do simulado):
  //   fora da janela configurada, o handler responde
  //   `{ skipped: "out_of_window" }` sem custo real (sem query a targets, sem
  //   fetch ao TSE). Isso evita ter que fazer redeploy pra ligar/desligar
  //   este cron especificamente no dia 15 — só a env var `INGEST_WINDOW`
  //   muda entre ambientes.
  // - Cron heartbeat diurno: 12:00 UTC = 09:00 BRT. Satisfaz exigência Vercel
  //   de ≥1 execução/dia em plano pago. Aponta para `/api/ingest` SEM cargo
  //   (todos os cargos ativos) — o handler retorna {skipped} fora da
  //   janela, então o heartbeat é inofensivo.
  crons: [
    {
      path: "/api/ingest/presidente",
      schedule: "* 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/governador",
      schedule: "* 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/presidente",
      schedule: "* 12-19 * * *",
    },
    {
      path: "/api/ingest/governador",
      schedule: "* 12-19 * * *",
    },
    // ── Senador (cargo 5) — ADR-0026 item 1, emendado em 2026-09-11 ──
    // Cadência própria e MENOR que a de 60 s dos majoritários: a cada 5 min.
    //
    // ⚠️ Corrigido em 2026-09-13: este comentário dizia "em granularidade UF,
    // 27 GETs por ciclo". Falso desde 2026-09-11, quando o Senador saiu de UF
    // para ZONA (nota "(b)" do ADR-0026) — `lib/config/cargos.ts` mostra
    // `granularidade: "zona"`, `rpsMax: 25`, ~6.110 alvos, ~244 s de ciclo.
    // A reescrita deste bloco em `e2f3240` separou Senador de Deputado mas
    // copiou a alegação errada adiante, com o bloco correto logo abaixo.
    //
    // A folga aqui é a mais apertada do projeto: ~244 s de ciclo dentro de uma
    // janela de 300 s entre disparos. Medir `duration_ms` no simulado 1 não é
    // opcional.
    //
    // Mesmas duas janelas dos demais: apuração (20-23,0-7 UTC = 17h-04h BRT) e
    // simulado (12-19 UTC = 9h-16h59 BRT). `INGEST_WINDOW` decide qual vale em
    // cada ambiente — fora dela o handler responde `{skipped}` sem custo.
    {
      path: "/api/ingest/senador",
      schedule: "*/5 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/senador",
      schedule: "*/5 12-19 * * *",
    },
    // ── Deputado Federal (cargo 6) EM 6 FATIAS — ADR-0026 item 1, emenda
    //    2026-09-13 ──
    //
    // Deputado Federal saiu de granularidade UF (27 alvos, um cron `*/15`) para
    // ZONA (~6.110 alvos) em 2026-09-13 — mesmo diagnóstico de bootstrap que
    // moveu o Senador em 11/09: um único arquivo por UF só dá ao estimador do
    // RF-127 uma unidade de reamostragem, e o IC95 degenera. A `rpsMax` do
    // cargo continua 5 (não reabre a calibragem do pior caso agregado de
    // 80 rps — `piorCasoAgregadoRps()`, `lib/config/cargos.ts`), então varrer
    // os ~6.110 alvos numa invocação só levaria ~1.222 s — muito acima do
    // `maxDuration` de 300 s.
    //
    // A varredura é dividida em 6 fatias (`sliceTargets`,
    // `lib/tse/targets.ts`; segmento de rota, não query string — mesmo achado
    // (B) do ADR-0026 nota 2026-09-11 que já valia pra distinguir cargos no
    // mesmo minuto), cada uma cobrindo ~1/6 do fan-out (~1.019 alvos, ~204 s).
    // As 6 entradas abaixo disparam uma fatia a cada 5 min, intercaladas em
    // 5 min uma da outra (fatia 1 nos minutos 0 e 30, fatia 2 nos minutos 5 e
    // 35, ..., fatia 6 nos minutos 25 e 55) — a volta completa (as 6 fatias)
    // leva 30 min. A UI precisa dizer "atualizado a cada 30 min" quando
    // exibir Deputado (ADR-0026 item 5, constituição § 8) — nunca um
    // "atualizado às" único numa tela que mistura cargos de cadências
    // diferentes.
    //
    // Chave de emergência: `TSE_DEPUTADO_GRANULARIDADE=uf` reverte o cargo a
    // UF — nesse modo cada uma das 6 invocações abaixo devolve o agregado
    // completo de 27 UFs, ignorando a fatia (ver
    // `getGranularidade`/`listIngestTargets`, `lib/tse/targets.ts`).
    // 🔴 EXIGE NOVO DEPLOY (corrigido em 29/09, ADR-0063 D4): na Vercel,
    // variável de ambiente só chega a um deployment novo — indisponível das
    // 16h às 05h de 04/10, quando o deploy está congelado. O que age sem
    // deploy é chave do Global Config (ex.: `interruptor-projecao-dep`,
    // `pnpm dep:projecao`), nunca variável de ambiente.
    //
    // Mesmas duas janelas dos demais cargos: apuração (20-23,0-7 UTC) e
    // simulado (12-19 UTC).
    {
      path: "/api/ingest/deputado-federal/1",
      schedule: "0,15,30,45 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/2",
      schedule: "2,17,32,47 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/3",
      schedule: "5,20,35,50 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/4",
      schedule: "7,22,37,52 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/5",
      schedule: "10,25,40,55 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/6",
      schedule: "12,27,42,57 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/1",
      schedule: "0,15,30,45 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/2",
      schedule: "2,17,32,47 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/3",
      schedule: "5,20,35,50 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/4",
      schedule: "7,22,37,52 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/5",
      schedule: "10,25,40,55 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-federal/6",
      schedule: "12,27,42,57 12-19 * * *",
    },
    // ── Deputado Estadual (7) e Distrital (8) — spec 027 Fase 1, ADR-0067 ──
    //
    // Um arquivo-RESUMO por casa (`granularidade: "uf"` em
    // `lib/config/cargos.ts`): 26 alvos para o 7 (as UFs sem o DF), 1 para o 8
    // (só o DF), a 1 rps cada (`rpsMax: 1`) — ~26 s e ~1 s por ciclo. A cada
    // 5 min, nas duas janelas: apuração (20-23,0-7 UTC) e simulado (12-19 UTC —
    // SEM a hora 20, que já é da apuração: duas entradas do mesmo caminho no
    // mesmo minuto dobrariam a taxa, porque a trava anti-sobreposição não é
    // atômica).
    //
    // Em minutos DESLOCADOS das fatias do 6 e do Senador (que ocupam todos os
    // múltiplos de 5): o 7 nos minutos 2, 7, 12, …; o 8 nos 3, 8, 13, …. Não
    // muda o pior caso agregado (um ciclo de Senador ou de uma fatia do 6 dura
    // ~4 min e ainda está no ar — por isso ele é 82, e não 80, em
    // `piorCasoAgregadoRps`), mas espalha o início das invocações. Lista
    // explícita em vez de `2-59/5`: é a forma que este arquivo já usa e que o
    // teste de cadência (`dado-freshness.test.ts`) sabe ler.
    //
    // Sem fatia (a rota `/api/ingest/[cargo]/[fatia]` aceita só o 6). Se a
    // Fase 2 subir, o 7 vira zona fatiada e estas entradas mudam.
    {
      path: "/api/ingest/deputado-estadual",
      schedule: "2,7,12,17,22,27,32,37,42,47,52,57 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-distrital",
      schedule: "3,8,13,18,23,28,33,38,43,48,53,58 20-23,0-7 * * *",
    },
    {
      path: "/api/ingest/deputado-estadual",
      schedule: "2,7,12,17,22,27,32,37,42,47,52,57 12-19 * * *",
    },
    {
      path: "/api/ingest/deputado-distrital",
      schedule: "3,8,13,18,23,28,33,38,43,48,53,58 12-19 * * *",
    },
    {
      path: "/api/ingest",
      schedule: "0 12 * * *",
    },
    // ── Leitura da noite da home presidencial — ADR-0072 ──
    // Histórico do Boletim, manchetes de feeds e análise por IA, gravados no
    // Blob (`leitura/pres/t<turno>.json`). A cada minuto, só na janela da
    // apuração (20-23,0-7 UTC = 17h-04h BRT) — sem entrada na janela do
    // simulado: a leitura só faz sentido sobre a apuração real.
    // NASCE DESLIGADO: IA e notícias só rodam com a chave
    // `interruptor-leitura-noite` do Global Config ligada
    // (`pnpm leitura:interruptor`), sem deploy. O histórico roda sempre. O
    // ritmo da IA (no máximo 1 tentativa a cada 4 min) e das notícias (5 min)
    // é decidido dentro do ciclo (`lib/leitura/ciclo.ts`), não aqui.
    {
      path: "/api/internal/leitura-noite",
      schedule: "* 20-23,0-7 * * *",
    },
  ],
  // gru1 = São Paulo. Audiência majoritariamente BR — minimizar latência.
  regions: ["gru1"],
  // Python functions da spec 002 (modelo estatístico).
  // ADR-0006: Python 3.14 + NumPy em Vercel Fluid Compute.
  //
  // IMPORTANTE: NÃO declarar `runtime` aqui — o campo `runtime` em
  // `functions` só aceita third-party runtimes com versão (ex.:
  // "now-php@1.0.0"). Para Python NATIVO, o Vercel detecta o runtime
  // automaticamente pela presença de `requirements.txt` em `api/`. A
  // versão Python é pinada via `.python-version` na raiz (ver
  // https://vercel.com/docs/functions/runtimes/python/python-version).
  //
  // maxDuration=60s alinha com o budget do ciclo de ingestão (também 60s).
  // Bootstrap n=1000 × ~150 zonas executa em <5s em hardware típico —
  // sobra margem.
  functions: {
    "api/model/project.py": {
      // 🔴 04/10/2026 17h55: 60 s cortava Senado e Deputado no meio da noite.
      maxDuration: 300,
      // 🔴 04/10/2026 19h20: "ran out of available memory" com a apuração em
      // ~60% — Presidente parado 15 min. Máximo do plano.
      memory: 3009,
      // Bundle Python tende a inflar com numpy. Excluímos artefatos comuns
      // que não são necessários em runtime.
      excludeFiles: "{tests/**,__tests__/**,**/*.test.py,**/test_*.py,**/__pycache__/**,**/*.pyc}",
    },
    // 🔴 04/10/2026 ~20h15: o MESMO modelo, função separada para Deputado
    // (6/7/8) — dividindo instância, ele derrubava os majoritários por
    // memória e tempo. Ver api/model/project_dep.py.
    "api/model/project_dep.py": {
      maxDuration: 300,
      memory: 3009,
      excludeFiles: "{tests/**,__tests__/**,**/*.test.py,**/test_*.py,**/__pycache__/**,**/*.pyc}",
    },
  },
};

export default config;
