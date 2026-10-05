/**
 * tests/setup/modo-ao-vivo.ts
 *
 * **Carregado antes de todo arquivo de teste.** Fixa `primeiroTurnoEncerrado()`
 * (`lib/config/calendar.ts`) em `false` — a suíte testa o comportamento de
 * apuração ao vivo por padrão, qualquer que seja a data do relógio da máquina.
 *
 * Por quê: o modo "1º turno encerrado" é decidido pelo RELÓGIO (de 05/10/2026
 * 03h até o início do 2º turno). Sem isto, toda asserção de texto de uma tela
 * de apuração viraria dependente do dia em que a suíte roda — passava em
 * 04/10, quebrava em 05/10 e voltava a passar em 25/10.
 *
 * Quem testa o modo encerrado liga explicitamente:
 *
 *     vi.mocked(primeiroTurnoEncerrado).mockReturnValue(true);
 *
 * e quem testa a própria regra de datas usa
 * `vi.importActual("@/lib/config/calendar")`.
 */
import { vi } from "vitest";

vi.mock("@/lib/config/calendar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config/calendar")>();
  return { ...original, primeiroTurnoEncerrado: vi.fn(() => false) };
});
