/**
 * tests/unit/edge-config/reader.test.ts
 *
 * Ordem de fallback do read path do Global Config.
 *
 * ## O que está sendo garantido
 *
 * O esquema de chaves mudou de `:` para `-` em 2026-09-08 (emenda ao
 * ADR-0012) porque o padrão documentado de nome de chave do Global Config é
 * `^[A-Za-z0-9_-]+$`. Não foi possível verificar se a API da Vercel de fato
 * recusa dois-pontos — sem credencial de escrita no ambiente. Logo, existe um
 * cenário real em que a API sempre aceitou e há dado publicado sob o esquema
 * antigo. O reader precisa enxergar esse dado durante a migração, **sem**
 * pagar leitura extra quando a chave nova responde.
 *
 * Estes testes fixam exatamente isso:
 *   - caminho saudável: chave nova responde → UMA leitura, e só;
 *   - caminho de miss: cai para a chave deprecada com dois-pontos e depois
 *     para os aliases legados, nessa ordem;
 *   - a camada deprecada é temporária e tem data (2026-10-26).
 *
 * ## Estratégia
 *
 * `@vercel/edge-config` é mockado com `vi.mock` — um `get(key)` que consulta
 * um dicionário e conta as chaves consultadas, na ordem. É a ordem que
 * importa aqui, não o valor.
 *
 * O relógio é fixado em 2026-09-08 (`vi.setSystemTime`) porque
 * `currentPresidentialRace()` decide qual corrida é a "ativa", e a existência dos
 * aliases legados no fallback depende disso. Sem fixar, o teste passaria a
 * significar outra coisa depois de 04/10.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@vercel/edge-config", () => ({
  get: (key: string) => getMock(key),
}));

/**
 * 🔴 O canal de alarme do read path (2026-09-14). É o mesmo `logError` que o
 * writer usa para as falhas dele — nenhum mecanismo novo foi inventado.
 */
const logErrorMock = vi.fn();

vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logError: (msg: string, ctx?: unknown) => logErrorMock(msg, ctx) };
});

import {
  readArchivedProjection,
  readDeputadoProjection,
  readProjection,
  readProjectionResult,
  readUfProjection,
} from "@/lib/edge-config/reader";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let originalEdgeConfig: string | undefined;

beforeEach(() => {
  originalEdgeConfig = process.env.EDGE_CONFIG;
  // O reader curto-circuita para `null` sem esta env. Valor sintético: o SDK
  // está mockado, nada é parseado.
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_test?token=t";

  vi.useFakeTimers();
  // Corrida ativa nesta data: (pres, 1). Ver `lib/config/calendar.ts`.
  vi.setSystemTime(new Date("2026-09-08T12:00:00-03:00"));

  getMock.mockReset();
  logErrorMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalEdgeConfig === undefined) delete process.env.EDGE_CONFIG;
  else process.env.EDGE_CONFIG = originalEdgeConfig;
});

/** Faz o `get` mockado responder só para as chaves listadas em `store`. */
function withStore(store: Record<string, unknown>) {
  getMock.mockImplementation(async (key: string) => store[key] ?? undefined);
}

/** Chaves consultadas, na ordem em que foram consultadas. */
function keysRead(): string[] {
  return getMock.mock.calls.map((call) => String(call[0]));
}

// ---------------------------------------------------------------------------
// readProjection
// ---------------------------------------------------------------------------

describe("readProjection — ordem de fallback", () => {
  it("caminho saudável: chave nova responde e o reader para na primeira leitura", async () => {
    withStore({ "projection-current-pres-t1": { ts: "novo" } });

    const payload = await readProjection({ cargo: "pres" });

    expect(payload).toEqual({ ts: "novo" });
    // O custo do fallback é ZERO quando a chave nova existe — este é o
    // caminho de 100% dos ciclos depois que o writer publica.
    expect(keysRead()).toEqual(["projection-current-pres-t1"]);
  });

  it("miss: cai para a chave deprecada com dois-pontos", async () => {
    // Cenário em que a API da Vercel sempre aceitou `:` e há dado publicado
    // sob o esquema antigo.
    withStore({ "projection:current:pres:t1": { ts: "antigo" } });

    const payload = await readProjection({ cargo: "pres" });

    expect(payload).toEqual({ ts: "antigo" });
    expect(keysRead()).toEqual(["projection-current-pres-t1", "projection:current:pres:t1"]);
  });

  it("miss total na corrida ativa: tenta também os dois aliases, nessa ordem", async () => {
    withStore({});

    const payload = await readProjection({ cargo: "pres" });

    expect(payload).toBeNull();
    expect(keysRead()).toEqual([
      "projection-current-pres-t1",
      "projection:current:pres:t1",
      "projection-current",
      "projection:current",
    ]);
  });

  it("corrida NÃO ativa: aliases ficam de fora (eles apontam para a ativa)", async () => {
    withStore({});

    await readProjection({ cargo: "gov", turno: 2 });

    expect(keysRead()).toEqual(["projection-current-gov-t2", "projection:current:gov:t2"]);
  });

  it("o alias novo tem precedência sobre o alias deprecado", async () => {
    withStore({
      "projection-current": { ts: "alias-novo" },
      "projection:current": { ts: "alias-antigo" },
    });

    expect(await readProjection({ cargo: "pres" })).toEqual({ ts: "alias-novo" });
  });

  it("falha do SDK degrada para null, não propaga", async () => {
    getMock.mockRejectedValue(new Error("edge config indisponível"));

    await expect(readProjection({ cargo: "pres" })).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readUfProjection
// ---------------------------------------------------------------------------

describe("readUfProjection — ordem de fallback", () => {
  it("caminho saudável: uma leitura na chave nova", async () => {
    withStore({ "projection-uf-SP-pres-t1": { uf: "SP" } });

    expect(await readUfProjection("SP", { cargo: "pres" })).toEqual({ uf: "SP" });
    expect(keysRead()).toEqual(["projection-uf-SP-pres-t1"]);
  });

  it("miss total: nova → deprecada → alias novo → alias deprecado", async () => {
    withStore({});

    expect(await readUfProjection("SP", { cargo: "pres" })).toBeNull();
    expect(keysRead()).toEqual([
      "projection-uf-SP-pres-t1",
      "projection:uf:SP:pres:t1",
      "projection-uf-SP",
      "projection:uf:SP",
    ]);
  });

  it("sigla malformada não vira chave inválida — degrada para null", async () => {
    withStore({});

    expect(await readUfProjection("SP:1", { cargo: "pres" })).toBeNull();
    // Nenhuma leitura chegou a ser feita: a sigla foi rejeitada na
    // construção da chave.
    expect(keysRead()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readArchivedProjection
// ---------------------------------------------------------------------------

describe("readArchivedProjection — ordem de fallback", () => {
  it("chave nova primeiro, deprecada depois, sem aliases", async () => {
    withStore({});

    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toBeNull();
    expect(keysRead()).toEqual(["projection-archive-pres-t1", "projection:archive:pres:t1"]);
  });

  it("archive publicado sob o esquema antigo ainda é encontrado", async () => {
    withStore({ "projection:archive:pres:t1": { ts: "1T congelado" } });

    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toEqual({
      ts: "1T congelado",
    });
  });
});

/**
 * 🔴 O terceiro degrau: `projection-current-<cargo>-t<N>` de turno encerrado.
 *
 * Medido em 18/09: **ninguém grava `projection-archive-*`.**
 * `grep -rn archiveProjectionKey` acha só leitura, e `api/model/` não menciona
 * archive. A docstring de `readArchivedProjection` afirmava que o orchestrator
 * gravava na virada de turno — a S07 fechou sem isso e a frase ficou falsa.
 *
 * Consequência que ninguém veria até a noite: em 25/10 o `<TurnoOneRecap>` do
 * hero de 2º turno seria `null` a noite inteira, sem erro e sem alarme.
 *
 * O congelamento já acontece sozinho — a chave carrega o turno, o turno vem do
 * calendário, e virada a data ninguém mais escreve em `-t1`.
 */
describe("readArchivedProjection — o degrau do turno encerrado", () => {
  /** Depois de 25/10: a corrida ativa é (pres, 2). */
  function noSegundoTurno() {
    vi.setSystemTime(new Date("2026-10-26T12:00:00-03:00"));
  }

  it("com o 1T encerrado, cai no `projection-current-pres-t1` congelado", async () => {
    noSegundoTurno();
    withStore({ "projection-current-pres-t1": { ts: "retrato final do 1T" } });

    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toEqual({
      ts: "retrato final do 1T",
    });
    expect(keysRead()).toEqual([
      "projection-archive-pres-t1",
      "projection:archive:pres:t1",
      "projection-current-pres-t1",
    ]);
  });

  it("🔴 com o turno EM ANDAMENTO, NÃO toca a chave corrente", async () => {
    // Par com o caso acima, e a razão de a guarda existir. Sem ela, pedir o
    // "arquivo" do turno que está rolando devolveria o placar AO VIVO
    // travestido de histórico — a tela mostraria o número de agora como se
    // fosse o resultado fechado. Mesma família dos três estados: apresentar
    // uma coisa como outra.
    //
    // O relógio do harness já está em 08/09, com (pres, 1) ativo.
    withStore({ "projection-current-pres-t1": { ts: "AO VIVO, não é arquivo" } });

    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toBeNull();
    expect(keysRead()).not.toContain("projection-current-pres-t1");
  });

  it("o archive de verdade tem precedência sobre o degrau", async () => {
    // Se algum dia algo passar a gravar `projection-archive-*` — para congelar
    // antes da virada, ou para sobreviver a uma reingestão de `-t1` — ele
    // ganha sem precisar mexer aqui.
    noSegundoTurno();
    withStore({
      "projection-archive-pres-t1": { ts: "congelado de propósito" },
      "projection-current-pres-t1": { ts: "retrato final do 1T" },
    });

    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toEqual({
      ts: "congelado de propósito",
    });
    expect(keysRead()).toEqual(["projection-archive-pres-t1"]);
  });
});

// ---------------------------------------------------------------------------
// Sem credencial
// ---------------------------------------------------------------------------

describe("sem EDGE_CONFIG", () => {
  it("retorna null sem tocar no SDK (dev/preview sem credencial)", async () => {
    delete process.env.EDGE_CONFIG;

    expect(await readProjection({ cargo: "pres" })).toBeNull();
    expect(await readUfProjection("SP", { cargo: "pres" })).toBeNull();
    expect(await readArchivedProjection({ cargo: "pres" })).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('sem credencial é "ausente", não "falha" — e não alarma', async () => {
    delete process.env.EDGE_CONFIG;

    expect(await readProjectionResult({ cargo: "pres" })).toEqual({ estado: "ausente" });
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 🔴 "Falhou" ≠ "não existe" — spec 019, emenda de 2026-09-14
// ---------------------------------------------------------------------------

/**
 * ## O defeito que estes testes fecham
 *
 * Até 13/09 as quatro funções deste módulo faziam `catch { return null }`.
 * Falha de rede e chave nunca publicada chegavam ao chamador como **a mesma
 * coisa, sem alarme nenhum** — e a página então escolhia um texto que estaria
 * errado metade das vezes. Dizer "a eleição ainda não começou" às 21h de 04/10
 * durante uma queda do Global Config é falso com toda a autoridade da marca.
 *
 * ## Por que são DOIS casos e não um
 *
 * Um teste só do lado positivo ("lançou ⇒ alarmou") passa com um `logError`
 * incondicional no topo da função — que alarmaria em toda leitura de chave
 * ausente, ou seja, em todo render das três semanas de pré-eleição, e treinaria
 * o operador a ignorar o alarme. O par negativo ("ausente ⇒ NÃO alarmou") é o
 * que discrimina, e é por isso que os dois moram no mesmo `describe`.
 *
 * ⚠️ O que estes testes deliberadamente **não** afirmam: que a TELA muda entre
 * os dois casos. Ela não muda, e não deve — nos dois o sistema não sabe o
 * resultado, e um ramo que afirmasse a causa afirmaria uma causa não medida.
 * O que muda é a visibilidade para o operador.
 */
describe("leitura que falha × chave que não existe", () => {
  it('o SDK lança ⇒ estado "falha" E alarme emitido', async () => {
    getMock.mockRejectedValue(new Error("edge config indisponível"));

    const resultado = await readProjectionResult({ cargo: "pres" });
    expect(resultado.estado).toBe("falha");

    expect(await readProjection({ cargo: "pres" })).toBeNull();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [msg, ctx] = logErrorMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("global-config read failed");
    // O contexto precisa dizer QUAL leitura caiu — um alarme que não nomeia a
    // corrida manda o operador abrir quatro abas para descobrir.
    expect(ctx).toMatchObject({ fn: "readProjection", cargo: "pres" });
    expect(String(ctx.erro)).toContain("edge config indisponível");
  });

  it('🔴 (par) a chave apenas NÃO EXISTE ⇒ estado "ausente" E silêncio', async () => {
    withStore({});

    const resultado = await readProjectionResult({ cargo: "pres" });
    expect(resultado).toEqual({ estado: "ausente" });

    expect(await readProjection({ cargo: "pres" })).toBeNull();
    // Sem este `not`, um `logError` incondicional passaria no teste de cima.
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("uma chave que lança encerra a busca — não insiste nas seguintes", async () => {
    getMock.mockRejectedValue(new Error("transporte caiu"));

    await readProjection({ cargo: "pres" });
    // A corrida presidencial ativa tem 4 chaves candidatas; a primeira já
    // decidiu. Insistir só multiplicaria a latência de um render que vai
    // degradar de qualquer jeito.
    expect(keysRead()).toEqual(["projection-current-pres-t1"]);
  });

  it("as outras três funções também alarmam, e cada uma se identifica", async () => {
    getMock.mockRejectedValue(new Error("queda"));

    expect(await readUfProjection("SP", { cargo: "pres" })).toBeNull();
    expect(await readArchivedProjection({ cargo: "pres", turno: 1 })).toBeNull();
    expect(await readDeputadoProjection(6)).toBeNull();

    expect(logErrorMock).toHaveBeenCalledTimes(3);
    const fns = logErrorMock.mock.calls.map((c) => (c[1] as Record<string, unknown>).fn as string);
    expect(fns).toEqual(["readUfProjection", "readArchivedProjection", "readDeputadoProjection"]);
  });

  it("sigla malformada é falha (não conseguimos nem perguntar), e não derruba o render", async () => {
    withStore({});

    // O comportamento observável não mudou — continua `null`, sem propagar.
    expect(await readUfProjection("SP:1", { cargo: "pres" })).toBeNull();
    expect(keysRead()).toEqual([]);
    // O que mudou: deixou de ser silencioso.
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [, ctx] = logErrorMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(ctx.sigla).toBe("SP:1");
  });
});
