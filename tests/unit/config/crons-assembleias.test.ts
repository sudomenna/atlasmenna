/**
 * tests/unit/config/crons-assembleias.test.ts
 *
 * Os crons de Deputado Estadual (cargo 7) e Distrital (cargo 8) em `vercel.ts`
 * — spec 027 Fase 1 (RF-278, RF-285; ADR-0067).
 *
 * A regra geral "nenhum caminho dispara duas vezes no mesmo (minuto, hora)"
 * vive em `tests/unit/config/vercel-crons.test.ts` (na `main` desde 29/09);
 * aqui fica o que é próprio das assembleias: as duas janelas, sem fatia, em
 * minutos deslocados das fatias do 6 e do Senador, e o total de crons do
 * projeto abaixo do limite do plano.
 */

import { describe, expect, it } from "vitest";

import { parseCargoSegment } from "@/lib/config/cargos";
import vercelConfig from "@/vercel";

const CRONS = vercelConfig.crons ?? [];

/**
 * Expande um campo de cron (minuto ou hora). Cobre `*`, `*` barra `N`, `a-b`,
 * número solto e listas; forma desconhecida LANÇA — um parser que ignorasse o
 * que não entende aprovaria justamente a entrada nova.
 */
function expandir(campo: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const parte of campo.split(",")) {
    const m = parte.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`campo de cron não reconhecido: "${campo}"`);
    const passo = m[4] ? Number(m[4]) : 1;
    const inicio = m[1] === "*" ? min : Number(m[2]);
    const fim = m[1] === "*" ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : inicio;
    if (inicio < min || fim > max || inicio > fim) {
      throw new Error(`faixa de cron fora do domínio ${min}-${max}: "${parte}"`);
    }
    for (let v = inicio; v <= fim; v += passo) out.add(v);
  }
  return out;
}

const minutosDe = (schedule: string) => expandir(schedule.split(" ")[0] ?? "", 0, 59);
const horasDe = (schedule: string) => expandir(schedule.split(" ")[1] ?? "", 0, 23);
const doSlug = (slug: string) => CRONS.filter((c) => c.path === `/api/ingest/${slug}`);

describe("crons das assembleias (spec 027 Fase 1)", () => {
  it.each([
    { slug: "deputado-estadual", cargo: 7 },
    { slug: "deputado-distrital", cargo: 8 },
  ] as const)("RF-285: $slug (cargo $cargo) tem cron na apuração E no simulado, sem fatia", ({
    slug,
    cargo,
  }) => {
    // O slug do cron resolve para o cargo certo pela tabela canônica — é o
    // mesmo `parseCargoSegment` que a rota `/api/ingest/[cargo]` usa.
    expect(parseCargoSegment(slug)).toBe(cargo);

    const entradas = doSlug(slug);
    expect(entradas).toHaveLength(2);
    const janelas = entradas.map((c) => horasDe(c.schedule));
    // Apuração: 20-23,0-7 UTC (17h-04h BRT).
    expect(janelas.some((h) => h.has(20) && h.has(0) && h.has(7))).toBe(true);
    // Simulado: começa às 12 UTC e NÃO tem a hora 20 (que é da apuração).
    expect(janelas.some((h) => h.has(12) && !h.has(20))).toBe(true);
    // As duas janelas do mesmo caminho não se sobrepõem em hora nenhuma.
    const [a, b] = janelas as [Set<number>, Set<number>];
    expect([...a].filter((h) => b.has(h))).toEqual([]);

    // Sem rota fatiada: `/api/ingest/[cargo]/[fatia]` aceita só o 6.
    expect(CRONS.some((c) => c.path.startsWith(`/api/ingest/${slug}/`))).toBe(false);
  });

  it("a cada 5 min, em minutos DESLOCADOS dos múltiplos de 5 (fatias do 6 e Senador)", () => {
    const minutosPorSlug = new Map<string, number[]>();
    for (const slug of ["deputado-estadual", "deputado-distrital"]) {
      for (const cron of doSlug(slug)) {
        const minutos = [...minutosDe(cron.schedule)].sort((x, y) => x - y);
        expect(minutos, cron.schedule).toHaveLength(12);
        expect(
          minutos.every((m) => m % 5 !== 0),
          cron.schedule,
        ).toBe(true);
        minutosPorSlug.set(slug, minutos);
      }
    }
    // O 7 e o 8 também não começam juntos.
    const est = minutosPorSlug.get("deputado-estadual") ?? [];
    const dis = new Set(minutosPorSlug.get("deputado-distrital") ?? []);
    expect(est.filter((m) => dis.has(m))).toEqual([]);
  });

  it("o total de crons do projeto fica abaixo do menor limite do plano que conhecemos", () => {
    // 19 até 29/09 + 4 das assembleias = 23. O teto aqui é 40 — o menor limite
    // de cron jobs por projeto que a Vercel já documentou para o plano Pro (a
    // documentação mais recente fala em 100). Subir além disso exige conferir o
    // limite na documentação da Vercel ANTES, não depois do deploy recusar.
    expect(CRONS.length).toBeLessThanOrEqual(40);
  });
});
