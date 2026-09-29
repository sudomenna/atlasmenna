/**
 * Nenhum par de crons com o MESMO path pode disparar no mesmo (minuto, hora).
 *
 * 2026-09-29: as janelas de apuração (`20-23,0-7` UTC) e do simulado (`12-20`)
 * se sobrepunham na hora 20 UTC (17h BRT de 04/10, a abertura da apuração): cada
 * path disparava duas vezes por slot e a trava `getLastIngestRun` é
 * ler-e-agir — as duas invocações podiam passar e dobrar o ritmo contra o CDN
 * do TSE (constituição § 1, limite de 100 req/s com bloqueio de 10 min).
 */
import { describe, expect, it } from "vitest";
import config from "@/vercel";

function expandir(campo: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const parte of campo.split(",")) {
    const [faixa = "*", passoTxt] = parte.split("/");
    const passo = passoTxt ? Number(passoTxt) : 1;
    let [ini, fim] = [min, max];
    if (faixa !== "*") {
      const [a = 0, b] = faixa.split("-").map(Number);
      ini = a;
      fim = b ?? a;
    }
    for (let v = ini; v <= fim; v += passo) out.add(v);
  }
  return out;
}

function slots(schedule: string): Set<string> {
  const [minuto = "", hora = "", ...resto] = schedule.trim().split(/\s+/);
  expect(resto).toEqual(["*", "*", "*"]);
  const out = new Set<string>();
  for (const h of expandir(hora, 0, 23)) {
    for (const m of expandir(minuto, 0, 59)) out.add(`${h}:${m}`);
  }
  return out;
}

describe("vercel.ts — crons", () => {
  it("expandir entende as formas usadas (*, */5, a-b, listas)", () => {
    expect(expandir("20-23,0-7", 0, 23).size).toBe(12);
    expect(expandir("*/5", 0, 59).size).toBe(12);
    expect([...expandir("0,30", 0, 59)]).toEqual([0, 30]);
  });

  it("nenhum path dispara duas vezes no mesmo (minuto, hora)", () => {
    const crons = config.crons ?? [];
    const porPath = new Map<string, Set<string>>();
    const colisoes: string[] = [];
    for (const c of crons) {
      const vistos = porPath.get(c.path) ?? new Set<string>();
      for (const s of slots(c.schedule)) {
        if (vistos.has(s)) colisoes.push(`${c.path} @ ${s} UTC`);
        vistos.add(s);
      }
      porPath.set(c.path, vistos);
    }
    expect(colisoes.slice(0, 10)).toEqual([]);
  });

  it("a janela de apuração cobre 17h–04h59 BRT (20–23 e 0–7 UTC)", () => {
    const pres = (config.crons ?? []).filter((c) => c.path === "/api/ingest/presidente");
    const horas = new Set<number>();
    for (const c of pres) for (const s of slots(c.schedule)) horas.add(Number(s.split(":")[0]));
    for (const h of [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7]) expect(horas.has(h)).toBe(true);
  });
});
