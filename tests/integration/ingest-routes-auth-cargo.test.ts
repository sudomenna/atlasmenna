/**
 * tests/integration/ingest-routes-auth-cargo.test.ts
 *
 * Testes das DUAS rotas de ingestão introduzidas/alteradas em 2026-09-11
 * (ADR-0035 D3, achados (A) e (B) do plano
 * `perfeito-monte-um-plano-eventual-candle.md`):
 *
 *   - `app/api/ingest/route.ts` (sem cargo) — agora aceita GET além de POST,
 *     e `Authorization: Bearer <CRON_SECRET>` além de `x-cron-secret`.
 *   - `app/api/ingest/[cargo]/route.ts` (novo) — resolve o segmento de rota
 *     para um cargo (1|3, aceitando também os aliases `presidente`/
 *     `governador`), rejeita segmento inválido com 400 ANTES de checar auth,
 *     e mantém um lock anti-overlap INDEPENDENTE por cargo
 *     (`getLastIngestRun(cargo)`, lib/tse/repository.ts).
 *
 * O ciclo completo (targets → fetch → snapshot → dedup) já é coberto por
 * `tests/integration/ingest-cycle.test.ts` — aqui os targets são mockados
 * como `[]` (lista vazia) sempre que o objetivo do teste é auth/roteamento/
 * lock, não a mecânica de ingestão em si.
 */

import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/lib/db";
import { podeEscreverNoBanco } from "./_guarda-banco";

/** `describe` normal quando a escrita está autorizada; `describe.skip` caso contrário. */
const describeSeEscreve = podeEscreverNoBanco() ? describe : describe.skip;

// ---------------------------------------------------------------------------
// vi.mock hoisting — mesma estratégia de tests/integration/ingest-cycle.test.ts
// ---------------------------------------------------------------------------

vi.mock("@/lib/tse/targets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tse/targets")>();
  return {
    ...actual,
    listIngestTargets: vi.fn(),
  };
});

import { GET as ingestCargoFatiaGet } from "@/app/api/ingest/[cargo]/[fatia]/route";
import { GET as ingestCargoGet, POST as ingestCargoPost } from "@/app/api/ingest/[cargo]/route";
import { GET as ingestGet, POST as ingestPost } from "@/app/api/ingest/route";
import { listIngestTargets } from "@/lib/tse/targets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET não definida no ambiente de teste");
  return secret;
}

function buildReq(method: "GET" | "POST", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/ingest", { method, headers });
}

function bearerHeaders(): Record<string, string> {
  return { authorization: `Bearer ${requireCronSecret()}` };
}

function legacyHeaders(): Record<string, string> {
  return { "x-cron-secret": requireCronSecret() };
}

/** Constrói o `RouteContext` esperado por app/api/ingest/[cargo]/route.ts. */
function cargoContext(cargo: string) {
  return { params: Promise.resolve({ cargo }) };
}

/** Constrói o `RouteContext` esperado por app/api/ingest/[cargo]/[fatia]/route.ts. */
function cargoFatiaContext(cargo: string, fatia: string) {
  return { params: Promise.resolve({ cargo, fatia }) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("rotas de ingestão — auth (Bearer/x-cron-secret) e cargo (segmento)", {
  timeout: 30000,
}, () => {
  let originalCronEnabled: string | undefined;
  let originalWindowOverride: string | undefined;
  let originalTurno: string | undefined;
  let originalCodEleicao: string | undefined;

  beforeAll(() => {
    originalCronEnabled = process.env.CRON_ENABLED;
    originalWindowOverride = process.env.INGEST_WINDOW_OVERRIDE;
    originalTurno = process.env.TSE_TURNO;
    originalCodEleicao = process.env.TSE_COD_ELEICAO;

    process.env.CRON_ENABLED = "true";
    process.env.INGEST_WINDOW_OVERRIDE = "true";
    process.env.TSE_TURNO = "1";
    process.env.TSE_COD_ELEICAO = "ele2026/test";
  });

  afterAll(() => {
    if (originalCronEnabled !== undefined) process.env.CRON_ENABLED = originalCronEnabled;
    else delete process.env.CRON_ENABLED;
    if (originalWindowOverride !== undefined) {
      process.env.INGEST_WINDOW_OVERRIDE = originalWindowOverride;
    } else {
      delete process.env.INGEST_WINDOW_OVERRIDE;
    }
    if (originalTurno !== undefined) process.env.TSE_TURNO = originalTurno;
    else delete process.env.TSE_TURNO;
    if (originalCodEleicao !== undefined) process.env.TSE_COD_ELEICAO = originalCodEleicao;
    else delete process.env.TSE_COD_ELEICAO;
  });

  beforeEach(() => {
    vi.mocked(listIngestTargets).mockReset();
    vi.mocked(listIngestTargets).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // /api/ingest (sem cargo) — GET com Bearer, POST com x-cron-secret
  // -------------------------------------------------------------------------

  describe("/api/ingest (sem segmento — todos os cargos)", () => {
    it("GET + Authorization: Bearer <CRON_SECRET> → 200 ok:true (achado A — caminho do Vercel Cron)", async () => {
      const res = await ingestGet(buildReq("GET", bearerHeaders()));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("POST + x-cron-secret → 200 ok:true (caminho manual do runbook)", async () => {
      const res = await ingestPost(buildReq("POST", legacyHeaders()));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("GET + x-cron-secret também funciona (aceito nos dois verbos)", async () => {
      const res = await ingestGet(buildReq("GET", legacyHeaders()));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("POST + Authorization: Bearer também funciona (aceito nos dois verbos)", async () => {
      const res = await ingestPost(buildReq("POST", bearerHeaders()));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("sem nenhum dos dois headers → 401", async () => {
      const res = await ingestGet(buildReq("GET"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ error: "unauthorized" });
    });

    it("Bearer com segredo errado → 401", async () => {
      const res = await ingestGet(buildReq("GET", { authorization: "Bearer segredo-errado" }));
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // /api/ingest/[cargo] — resolução de segmento
  // -------------------------------------------------------------------------

  describe("/api/ingest/[cargo] — resolução de segmento", () => {
    it("segmento '1' → cargo Presidente, 200 ok:true", async () => {
      const res = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext("1"));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmento 'presidente' → cargo 1, 200 ok:true", async () => {
      const res = await ingestCargoGet(
        buildReq("GET", bearerHeaders()),
        cargoContext("presidente"),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmento '3' → cargo Governador, 200 ok:true", async () => {
      const res = await ingestCargoPost(buildReq("POST", legacyHeaders()), cargoContext("3"));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmento 'governador' → cargo 3, 200 ok:true", async () => {
      const res = await ingestCargoPost(
        buildReq("POST", legacyHeaders()),
        cargoContext("governador"),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmento inválido → 400 { error: 'invalid_cargo' }, mesmo SEM header de auth", async () => {
      const res = await ingestCargoGet(buildReq("GET"), cargoContext("2"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({ error: "invalid_cargo" });
    });

    it("segmento 'senador' → cargo 5, 200 ok:true", async () => {
      // Este caso era um exemplo de LIXO até 2026-09-11 (ADR-0026 implementado):
      // "senador" não resolvia e esperava-se 400. Virou cargo de verdade.
      const res = await ingestCargoPost(buildReq("POST", legacyHeaders()), cargoContext("senador"));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmento 'deputado-federal' → cargo 6, 200 ok:true", async () => {
      const res = await ingestCargoPost(
        buildReq("POST", legacyHeaders()),
        cargoContext("deputado-federal"),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("segmentos 'deputado-estadual' (7) e 'deputado-distrital' (8) → 200 ok:true", async () => {
      // Estes casos eram exemplos de LIXO até 2026-09-29 (spec 027, ADR-0066):
      // "deputado-estadual" e "7" esperavam 400. Viraram cargos de verdade, e
      // os crons de `vercel.ts` chegam a eles por estes slugs (RF-285).
      for (const segmento of ["deputado-estadual", "7", "deputado-distrital", "8"]) {
        const res = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext(segmento));
        expect(res.status, `segmento ${JSON.stringify(segmento)} deveria dar 200`).toBe(200);
        expect((await res.json()).ok).toBe(true);
      }
    });

    it("segmento vazio/lixo → 400", async () => {
      // Cargos do TSE deliberadamente FORA do escopo do produto continuam 400:
      // os vices (2, 4) não têm votação própria, e vereador não está em 2026.
      // Ver `lib/config/cargos.ts`.
      for (const lixo of ["", "  ", "vereador", "4", "99"]) {
        const res = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext(lixo));
        expect(res.status, `segmento ${JSON.stringify(lixo)} deveria dar 400`).toBe(400);
      }
    });

    it("segmento válido mas auth ausente → 401 (auth roda DEPOIS da validação de segmento)", async () => {
      const res = await ingestCargoGet(buildReq("GET"), cargoContext("1"));
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // /api/ingest/[cargo]/[fatia] — cargo 6 fatiado (ADR-0026 emenda 2026-09-13)
  // -------------------------------------------------------------------------

  describe("/api/ingest/[cargo]/[fatia] — resolução de segmento", () => {
    it("cargo 'deputado-federal' + fatia '1' → 200 ok:true", async () => {
      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("deputado-federal", "1"),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("cargo '6' + fatia '6' (a última) → 200 ok:true", async () => {
      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("6", "6"),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("fatia fora de 1..6 → 400 { error: 'invalid_fatia' }", async () => {
      for (const fatiaLixo of ["0", "7", "-1", "1.5", "abc", ""]) {
        const res = await ingestCargoFatiaGet(
          buildReq("GET", bearerHeaders()),
          cargoFatiaContext("deputado-federal", fatiaLixo),
        );
        expect(res.status, `fatia ${JSON.stringify(fatiaLixo)} deveria dar 400`).toBe(400);
        expect((await res.json()).error).toBe("invalid_fatia");
      }
    });

    it("cargo inválido → 400 { error: 'invalid_cargo' }, checado ANTES da fatia", async () => {
      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("2", "1"),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_cargo");
    });

    it("cargo válido mas NÃO fatiável (Presidente) → 400 { error: 'cargo_nao_fatiavel' }", async () => {
      // Só o cargo 6 usa fatia hoje — Presidente/Governador/Senador continuam
      // em uma invocação só. Aceitar qualquer cargo aqui deixaria uma
      // chamada manual com o cargo errado varrer 1/6 do país em silêncio.
      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("presidente", "1"),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("cargo_nao_fatiavel");
    });

    it("segmento válido mas auth ausente → 401", async () => {
      const res = await ingestCargoFatiaGet(
        buildReq("GET"),
        cargoFatiaContext("deputado-federal", "1"),
      );
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Lock anti-overlap independente por cargo (ADR-0035 D3)
  // -------------------------------------------------------------------------

  describeSeEscreve("lock anti-overlap — independente por cargo", () => {
    async function cleanupLockMarkers(): Promise<void> {
      await db.execute(sql`
        DELETE FROM ingest_log
        WHERE notes LIKE '%route-cargo-lock-test%'
      `);
    }

    // Falso-positivo de `noDuplicateTestHooks` nos dois hooks abaixo: eles estão
    // num `describe` ANINHADO, não no pai — o analisador só não o enxerga
    // porque o bloco vem de `describeSeEscreve`, uma variável (`describe` ou
    // `describe.skip`, conforme a autorização de escrita no banco). O mesmo
    // acontece com `describe.skipIf(…)()`. Voltar a um `describe` literal
    // perderia a guarda que impede a suíte de escrever em produção — o remédio
    // seria pior. Supressão com justificativa é o padrão do repositório
    // (`components/layout/TurnoSwitch.tsx:103`).

    // biome-ignore lint/suspicious/noDuplicateTestHooks: ver a nota acima
    beforeAll(async () => {
      await cleanupLockMarkers();
    });

    // biome-ignore lint/suspicious/noDuplicateTestHooks: ver a nota acima
    afterAll(async () => {
      await cleanupLockMarkers();
    });

    // Limpa os marcadores SINTÉTICOS (tagueados com `test_marker`) entre
    // testes — sem isso, o marcador `running:true` inserido manualmente por
    // um teste nunca é "resolvido" (a rota real só grava a linha final
    // `running:false` quando o ciclo COMPLETA; um ciclo que retorna
    // `skipped: overlap` nunca chega lá) e continua bloqueando o mesmo
    // cargo no teste seguinte, dentro da janela de 6min do lock. As linhas
    // que a própria rota grava (sem `test_marker`) NÃO são apagadas aqui —
    // elas já se resolvem sozinhas (running:false ao final do ciclo).
    afterEach(async () => {
      await cleanupLockMarkers();
    });

    it("marcador running=true do cargo 1 bloqueia só o cargo 1, não o cargo 3", async () => {
      // Marcador sintético — simula um ciclo do cargo 1 ainda "em voo".
      await db.insert(schema.ingestLog).values({
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: JSON.stringify({
          running: true,
          turno: 1,
          env: "preview",
          cargo: 1,
          test_marker: "route-cargo-lock-test",
        }),
      });

      const resCargo1 = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext("1"));
      expect(resCargo1.status).toBe(200);
      const bodyCargo1 = await resCargo1.json();
      expect(bodyCargo1).toMatchObject({ skipped: "overlap" });

      const resCargo3 = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext("3"));
      expect(resCargo3.status).toBe(200);
      const bodyCargo3 = await resCargo3.json();
      // Cargo 3 não tem marcador `running` seu — segue em frente normalmente.
      expect(bodyCargo3.ok).toBe(true);
      expect(bodyCargo3.skipped).toBeUndefined();
    });

    it("marcador running=true do ciclo SEM cargo (/api/ingest) não bloqueia /api/ingest/[cargo]", async () => {
      await db.insert(schema.ingestLog).values({
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: JSON.stringify({
          running: true,
          turno: 1,
          env: "preview",
          test_marker: "route-cargo-lock-test",
          // Sem `cargo` — representa um ciclo de /api/ingest (todos os cargos).
        }),
      });

      const resCargo1 = await ingestCargoGet(buildReq("GET", bearerHeaders()), cargoContext("1"));
      const bodyCargo1 = await resCargo1.json();
      expect(bodyCargo1.ok).toBe(true);
      expect(bodyCargo1.skipped).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Lock por cargo+fatia (ADR-0026 emenda 2026-09-13) — sem esta chave
    // estendida, a fatia 2 do cargo 6 seria bloqueada pelo marcador da fatia 1
    // (mesmo cargo, dentro da janela de 6min), e a varredura completa nunca
    // fecharia.
    // -----------------------------------------------------------------------

    it("marcador running=true da fatia 1 do cargo 6 bloqueia SÓ a fatia 1, não a fatia 2", async () => {
      await db.insert(schema.ingestLog).values({
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: JSON.stringify({
          running: true,
          turno: 1,
          env: "preview",
          cargo: 6,
          fatia: 1,
          test_marker: "route-cargo-lock-test",
        }),
      });

      const resFatia1 = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("deputado-federal", "1"),
      );
      expect(resFatia1.status).toBe(200);
      expect(await resFatia1.json()).toMatchObject({ skipped: "overlap" });

      const resFatia2 = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("deputado-federal", "2"),
      );
      expect(resFatia2.status).toBe(200);
      const bodyFatia2 = await resFatia2.json();
      expect(bodyFatia2.ok).toBe(true);
      expect(bodyFatia2.skipped).toBeUndefined();
    });

    it("marcador running=true da fatia 2 AINDA bloqueia uma nova invocação da MESMA fatia 2", async () => {
      await db.insert(schema.ingestLog).values({
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: JSON.stringify({
          running: true,
          turno: 1,
          env: "preview",
          cargo: 6,
          fatia: 2,
          test_marker: "route-cargo-lock-test",
        }),
      });

      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("deputado-federal", "2"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ skipped: "overlap" });
    });

    it("marcador running=true do cargo 6 SEM fatia (rota antiga, sem segmento) não bloqueia a fatia 1", async () => {
      // Distingue explicitamente "ciclo não fatiado do cargo 6" de "fatia 1
      // do cargo 6" — são chaves diferentes (`getLastIngestRun` exige match
      // exato de `fatia`, ausente só casa com ausente).
      await db.insert(schema.ingestLog).values({
        durationMs: 0,
        filesFetched: 0,
        filesChanged: 0,
        errors: 0,
        notes: JSON.stringify({
          running: true,
          turno: 1,
          env: "preview",
          cargo: 6,
          test_marker: "route-cargo-lock-test",
          // Sem `fatia` — representa uma chamada a /api/ingest/deputado-federal
          // (sem segmento de fatia).
        }),
      });

      const res = await ingestCargoFatiaGet(
        buildReq("GET", bearerHeaders()),
        cargoFatiaContext("deputado-federal", "1"),
      );
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.skipped).toBeUndefined();
    });
  });
});
