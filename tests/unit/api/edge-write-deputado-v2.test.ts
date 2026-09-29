/**
 * tests/unit/api/edge-write-deputado-v2.test.ts
 *
 * Spec 026 — o contrato v2 de Deputado atravessa a rota de escrita?
 *
 * 🔴 O objeto do TOPO do corpo (`deputadoBodySchema`) é `z.object` sem
 * `.passthrough()`: chave nova ao lado de `payload`/`payloads_uf` é
 * **descartada sem erro**. Todo dado novo da spec 026 tem de viajar DENTRO
 * de `payload` e de `payloads_uf[UF]`. Estes testes provam que, lá dentro,
 * os campos novos chegam ao escritor intactos — inclusive o transporte
 * `lista_restante`, que é o escritor quem separa — e fixam, por contraste, que
 * o topo de fato descarta (para ninguém "consertar" um dado novo pondo-o lá).
 *
 * E o tamanho: o corpo de Deputado com as listas cresce para ~2–2,5 MB
 * (ADR-0065, negativas); o limite da Vercel é 4,5 MB. A rota mede o corpo em
 * BYTES e avisa acima de 3,5 MB.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/edge-config/writer", () => ({
  writeProjection: vi.fn(),
  writeDeputadoProjection: vi.fn(),
}));

const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return {
    ...real,
    logInfo: (m: string, c?: unknown) => logInfoMock(m, c),
    logWarn: (m: string, c?: unknown) => logWarnMock(m, c),
    logError: () => {},
  };
});

import { POST } from "@/app/api/internal/edge-write/route";
import { writeDeputadoProjection } from "@/lib/edge-config/writer";

const SEGREDO = "test-secret-v2";
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.MODEL_SECRET;
  process.env.MODEL_SECRET = SEGREDO;
  vi.mocked(writeDeputadoProjection).mockReset();
  logInfoMock.mockReset();
  logWarnMock.mockReset();
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.MODEL_SECRET;
  else process.env.MODEL_SECRET = originalSecret;
});

function linha(rank: number) {
  return {
    sqcand: 10002630000 + rank,
    nome: `Candidata ${rank}`,
    partido: "PL",
    numero: 2200 + rank,
    votos: 5000 - rank,
    rank,
    pct_validos: 0.1,
  };
}

/** Corpo v2 no formato das fixtures de contrato. */
function corpoV2(): Record<string, unknown> {
  return {
    payload: {
      ts: "2026-10-04T23:41:07.312Z",
      dado_ts: "2026-10-04T23:30:04Z",
      pares_atrasados: 0,
      cargo: 6,
      turno: 1,
      pct_apurado_total: 40,
      ufs_apuradas: 1,
      atualizacao_min: 30,
      bancada: {
        total_cadeiras: 513,
        cadeiras_atribuidas: 70,
        ufs_calculadas: 1,
        ufs_aguardando: 26,
        por_agremiacao: [],
      },
      por_uf: [
        {
          sigla: "SP",
          pct_apurado: 40,
          projecao: { estado: "liberada", pct_minimo: 25, zonas_apuradas: 500, zonas_total: 1011 },
        },
      ],
      mais_votados: [{ uf: "SP", cod: "22", sigla: "PL", ...linha(1) }],
      puxadores: [
        {
          uf: "SP",
          cod: "22",
          sigla: "PL",
          ...linha(1),
          quociente_eleitoral: 62284,
          quocientes: 3,
          excedente: 2,
        },
      ],
      insights: [],
      composition: { pre_election: 0, model: 0, actual_results: 1 },
    },
    payloads_uf: {
      SP: {
        ts: "2026-10-04T23:41:07.312Z",
        cargo: 6,
        turno: 1,
        contrato: 2,
        uf: "SP",
        pct_apurado: 40,
        regras: {
          quociente_eleitoral: 62284,
          votos_validos: 4359874,
          lugares_a_preencher: 70,
          piso_candidato: 6229,
          piso_agremiacao_sobras: 49828,
          piso_candidato_sobras: 12457,
        },
        projecao: { estado: "liberada", pct_minimo: 25, zonas_apuradas: 500, zonas_total: 1011 },
        conferencia: {
          estado: "sem_dado_tse",
          boletim_dado_ts: null,
          totalizacao_final: false,
          comparou: [],
          divergencias: [],
        },
        mais_votados: [{ cod: "22", sqcand: 10002630001 }],
        lista: { restantes: 1 },
        agremiacoes: [
          {
            cod: "22",
            cadeiras_projetadas: 25,
            cadeiras_projetadas_ci95: [23, 27],
            corte: { ultimo_eleito: 10002630025, primeiro_fora: 10002630026, diferenca: 599 },
            puxadores: [{ sqcand: 10002630001, quocientes: 3, excedente: 2 }],
            total_candidatos: 71,
            candidatos: [{ ...linha(1), parcial: "qp", projecao: "qp" }],
            eleitos: [],
            suplentes: [],
          },
        ],
        lista_restante: [{ cod: "22", candidatos: [linha(61)] }],
      },
    },
  };
}

function requisicao(corpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/internal/edge-write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-model-secret": SEGREDO },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

describe("edge-write (cargo 6) — o contrato v2 chega inteiro ao escritor", () => {
  it("campos novos do NACIONAL (dentro de `payload`) chegam intactos", async () => {
    const res = await POST(requisicao(corpoV2()));
    expect(res.status).toBe(200);
    const [payload] = vi.mocked(writeDeputadoProjection).mock.calls[0] ?? [];
    const esperado = corpoV2().payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      mais_votados: esperado.mais_votados,
      puxadores: esperado.puxadores,
    });
    expect((payload as { por_uf: Array<{ projecao?: unknown }> }).por_uf[0]?.projecao).toEqual({
      estado: "liberada",
      pct_minimo: 25,
      zonas_apuradas: 500,
      zonas_total: 1011,
    });
  });

  it("campos novos da UF — e o transporte `lista_restante` — chegam intactos (o escritor separa)", async () => {
    await POST(requisicao(corpoV2()));
    const [, detalhes] = vi.mocked(writeDeputadoProjection).mock.calls[0] ?? [];
    const esperado = (corpoV2().payloads_uf as Record<string, unknown>).SP;
    // Igualdade PROFUNDA do objeto inteiro: qualquer campo aninhado que o Zod
    // descartasse faria esta asserção falhar.
    expect((detalhes as Record<string, unknown>).SP).toEqual(esperado);
  });

  it("🔴 contraste: chave nova no TOPO do corpo é descartada sem erro — por isso nada vai lá", async () => {
    const corpo = { ...corpoV2(), listas_61_mais: { SP: [linha(61)] } };
    const res = await POST(requisicao(corpo));
    expect(res.status).toBe(200);
    const chamada = vi.mocked(writeDeputadoProjection).mock.calls[0] ?? [];
    expect(JSON.stringify(chamada)).not.toContain("listas_61_mais");
  });
});

describe("edge-write — tamanho do corpo em BYTES (limite da Vercel: 4,5 MB)", () => {
  it("corpo normal: nenhum aviso, e a linha de sucesso leva `bodyBytes`", async () => {
    const texto = JSON.stringify(corpoV2());
    await POST(requisicao(texto));
    expect(logWarnMock).not.toHaveBeenCalled();
    const ok = logInfoMock.mock.calls.find((c) => c[0] === "edge-write ok")?.[1] as {
      bodyBytes: number;
    };
    expect(ok.bodyBytes).toBe(Buffer.byteLength(texto, "utf8"));
  });

  it("🔴 acima de 3,5 MB: avisa, com o número — antes do 413 da plataforma", async () => {
    const corpo = corpoV2();
    const sp = (corpo.payloads_uf as Record<string, { lista_restante: unknown[] }>).SP as {
      lista_restante: unknown[];
    };
    // ~3,7 MB de faixa 3 (~122 B por linha, medido aqui).
    const candidatos = Array.from({ length: 30_000 }, (_, i) => linha(61 + i));
    sp.lista_restante = [{ cod: "22", candidatos }];
    const texto = JSON.stringify(corpo);
    expect(Buffer.byteLength(texto)).toBeGreaterThan(3_500_000);

    const res = await POST(requisicao(texto));
    expect(res.status).toBe(200);
    const aviso = logWarnMock.mock.calls.find(
      (c) => c[0] === "edge-write corpo perto do limite da Vercel",
    );
    expect(aviso?.[1]).toMatchObject({ limiteBytes: 4_500_000, avisoBytes: 3_500_000, cargo: 6 });
  });

  it("mede BYTES, não caracteres: acento conta dois", async () => {
    const corpo = corpoV2();
    (
      (corpo.payloads_uf as Record<string, { nome_extra?: string }>).SP as { nome_extra?: string }
    ).nome_extra = "ÇÃÕ".repeat(100);
    const texto = JSON.stringify(corpo);
    await POST(requisicao(texto));
    const ok = logInfoMock.mock.calls.find((c) => c[0] === "edge-write ok")?.[1] as {
      bodyBytes: number;
    };
    expect(ok.bodyBytes).toBe(Buffer.byteLength(texto, "utf8"));
    expect(ok.bodyBytes).toBeGreaterThan(texto.length);
  });

  it("JSON inválido continua 400 `invalid_json`", async () => {
    const res = await POST(requisicao("{nao-json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });
});
