/**
 * tests/unit/api/projection-route-uf-cargo.test.tsx
 *
 * `GET /api/projection?uf=<sigla>&cargo=<pres|gov|sen>` — a camada 1 dos
 * ajustes de 2026-09-19.
 *
 * ## O defeito que estes casos trancam
 *
 * Até 19/09 o ramo `?uf=` cravava `cargo: "pres"` na chamada ao reader e a
 * docstring do endpoint declarava isso como contrato. Em
 * `/uf/<sigla>/governador` a consequência era visível e silenciosa ao mesmo
 * tempo: a moldura do mapa recebia a lista de candidatos do PRESIDENTE, os
 * `id` presidenciais não casavam com os `votos_reportados` de governador, e
 * toda linha do balão caía em `nome: "Candidato {id}"` / `partido: undefined`
 * (`lib/utils/municipio-votos.ts`).
 *
 * As asserções são sobre o ARGUMENTO da chamada ao reader, não só sobre o
 * corpo da resposta: é o argumento que carrega o cargo, e um teste que só
 * olhasse o retorno passaria com o cargo trocado desde que o mock devolvesse
 * alguma coisa.
 *
 * Provado por MOCK dos produtores (`readUfProjection`, `simulacaoNacional`,
 * `simulacaoSenadorUf`, `simulacaoGovernadorUf`), não pela fixture de simulação
 * real — o ponto aqui é a ROTA escolhida dentro do handler, não o conteúdo de
 * um arquivo.
 *
 * ## A segunda rodada do MESMO dia, e por que ela não é redundante
 *
 * A camada 1 fez o ramo `?uf=` parar de cravar `cargo: "pres"`, e a lista do
 * balão passou a ser a de governador. Restava um segundo corte, mais estreito:
 * em `pnpm dev:sim` o cargo 3 era o único majoritário SEM arquivo por UF, e
 * caía na síntese a partir de `por_uf[].top_candidatos` — que é
 * `slice(0, TOP_CANDIDATOS_POR_UF)`, hoje 4. São Paulo tem 7 candidaturas a
 * governador, o detalhe municipal reparte votos entre as 7, e as 3 da cauda
 * voltavam a aparecer como "Candidato 26004" no hover. Daí
 * `simulacaoGovernadorUf` e a preferência dela sobre a síntese.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentPresidentialTurno } from "@/lib/config/calendar";

const readUfProjectionMock = vi.fn();
vi.mock("@/lib/edge-config/reader", () => ({
  readNationalProjection: vi.fn(),
  readProjection: vi.fn(),
  readUfProjection: (sigla: string, opts: unknown) => readUfProjectionMock(sigla, opts),
}));

const simulacaoLigadaMock = vi.fn(() => false);
const simulacaoNacionalMock = vi.fn();
const simulacaoSenadorUfMock = vi.fn();
const simulacaoUfPresidenteMock = vi.fn();
const simulacaoGovernadorUfMock = vi.fn();
vi.mock("@/lib/dev/simulacao", () => ({
  simulacaoLigada: () => simulacaoLigadaMock(),
  simulacaoNacional: (cargo: string) => simulacaoNacionalMock(cargo),
  simulacaoSenadorUf: (sigla: string) => simulacaoSenadorUfMock(sigla),
  simulacaoUfPresidente: (sigla: string) => simulacaoUfPresidenteMock(sigla),
  simulacaoGovernadorUf: (sigla: string) => simulacaoGovernadorUfMock(sigla),
}));

const { GET } = await import("@/app/api/projection/route");

const RESUMO = { uf: "SP", cargo: 3, turno: 1, candidatos: [] } as unknown;

/**
 * Payload nacional de Governador em miniatura, com a propriedade que importa:
 * `national.candidatos` é a UNIÃO de duas corridas estaduais (RF-145), e só
 * `por_uf[].top_candidatos` sabe de que estado cada uma é.
 */
const GOV_NACIONAL = {
  ts: "2026-10-04T22:15:00-03:00",
  cargo: 3,
  turno: 1,
  national: {
    candidato_a_id: null,
    candidatos: [
      {
        id: 26000,
        nome: "NOME DO NACIONAL SP",
        partido: "XX",
        votos_atuais: 10,
        votos_projetados: 100,
        pct_atual: 40,
        pct_projetado: 41,
        pct_projetado_lower: 39,
        pct_projetado_upper: 43,
      },
      {
        id: 26001,
        nome: "SEGUNDO DE SP",
        partido: "YY",
        votos_atuais: 8,
        votos_projetados: 80,
        pct_atual: 32,
        pct_projetado: 33,
        pct_projetado_lower: 31,
        pct_projetado_upper: 35,
      },
      {
        id: 1000,
        nome: "CANDIDATO DO ACRE",
        partido: "ZZ",
        votos_atuais: 5,
        votos_projetados: 50,
        pct_atual: 20,
        pct_projetado: 21,
        pct_projetado_lower: 19,
        pct_projetado_upper: 23,
      },
    ],
  },
  por_uf: [
    {
      sigla: "SP",
      pct_apurado: 35,
      lider: 26000,
      top_candidatos: [
        { id: 26000, nome: "NOME RESOLVIDO EM SP", partido: "PL", sqcand: "250002541308" },
        { id: 26001, nome: "SEGUNDO RESOLVIDO EM SP", partido: "PT" },
      ],
    },
    {
      sigla: "AC",
      pct_apurado: 12,
      lider: 1000,
      top_candidatos: [{ id: 1000, nome: "CANDIDATO DO ACRE", partido: "ZZ" }],
    },
  ],
} as unknown;

describe("GET /api/projection?uf= com cargo", () => {
  beforeEach(() => {
    readUfProjectionMock.mockReset();
    simulacaoLigadaMock.mockReset().mockReturnValue(false);
    simulacaoNacionalMock.mockReset();
    simulacaoSenadorUfMock.mockReset();
    simulacaoUfPresidenteMock.mockReset();
    simulacaoGovernadorUfMock.mockReset();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem `cargo` continua presidencial — o contrato anterior a 19/09 não muda", async () => {
    readUfProjectionMock.mockResolvedValue(RESUMO);

    const res = await GET(new Request("http://x/api/projection?uf=SP"));

    expect(readUfProjectionMock).toHaveBeenCalledTimes(1);
    expect(readUfProjectionMock).toHaveBeenCalledWith("SP", {
      cargo: "pres",
      turno: currentPresidentialTurno(),
    });
    expect(res.status).toBe(200);
  });

  it("`cargo=gov` lê a chave de GOVERNADOR — não a do Presidente", async () => {
    // Mutação: devolver o literal `"pres"` aqui (o comportamento até 19/09)
    // faz este caso falhar, porque a asserção é sobre o argumento.
    readUfProjectionMock.mockResolvedValue(RESUMO);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));

    expect(readUfProjectionMock).toHaveBeenCalledTimes(1);
    expect(readUfProjectionMock).toHaveBeenCalledWith("SP", { cargo: "gov", turno: 1 });
    expect(res.status).toBe(200);
  });

  it("`cargo=gov` tenta o 2º turno quando o 1º não tem payload", async () => {
    readUfProjectionMock.mockResolvedValueOnce(null).mockResolvedValueOnce(RESUMO);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));

    expect(readUfProjectionMock.mock.calls.map((c) => c[1])).toEqual([
      { cargo: "gov", turno: 1 },
      { cargo: "gov", turno: 2 },
    ]);
    expect(res.status).toBe(200);
  });

  it("`cargo=sen` só tenta o turno 1 — cargo 5 não tem 2º turno", async () => {
    // Mutação: acrescentar `2` à lista de turnos de `sen` faz este caso
    // falhar. É a diferença que `lib/config/cargos.ts` declara em
    // `temSegundoTurno: false` e que o endpoint precisa respeitar.
    readUfProjectionMock.mockResolvedValue(null);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=sen"));

    expect(readUfProjectionMock).toHaveBeenCalledTimes(1);
    expect(readUfProjectionMock).toHaveBeenCalledWith("SP", { cargo: "sen", turno: 1 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_payload", uf: "SP", cargo: "sen" });
  });

  it("cargo desconhecido é 400 — e o reader NEM É CHAMADO", async () => {
    // 🔴 O caso que tranca o default silencioso. Antes de 19/09 qualquer valor
    // caía no presidencial; um `default`/`??` reintroduzido faria este caso
    // devolver 200 com a corrida errada em vez de 400.
    for (const cargo of ["dep", "presidente", "gov ", "GOV", "toString"]) {
      readUfProjectionMock.mockReset();
      const res = await GET(
        new Request(`http://x/api/projection?uf=SP&cargo=${encodeURIComponent(cargo)}`),
      );
      expect(res.status, `cargo=${cargo}`).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_cargo", cargo });
      expect(readUfProjectionMock, `cargo=${cargo}`).not.toHaveBeenCalled();
    }
  });

  it("simulação ligada + `cargo=sen` usa `simulacaoSenadorUf`, nunca o arquivo presidencial", async () => {
    simulacaoLigadaMock.mockReturnValue(true);
    simulacaoSenadorUfMock.mockReturnValue(RESUMO);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=sen"));

    expect(simulacaoSenadorUfMock).toHaveBeenCalledWith("SP");
    expect(simulacaoUfPresidenteMock).not.toHaveBeenCalled();
    expect(readUfProjectionMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("🔴 simulação ligada + `cargo=gov` prefere `governador-uf.json` à síntese [mutação: manter `simulacaoUf: () => null` em gov]", async () => {
    // O caso que conserta a queixa "o balão mostra Candidato 26004".
    //
    // A síntese do caso seguinte acerta os NÚMEROS de cada linha, e por isso a
    // decisão anterior parecia defensável — mas ela monta a lista a partir de
    // `por_uf[].top_candidatos`, que é `slice(0, 4)` por definição. SP tem 7
    // candidaturas a governador, e `votos_reportados` do detalhe municipal
    // reparte entre as 7: as 3 da cauda viravam "Candidato 26004" no hover.
    //
    // A asserção que discrimina é a NEGATIVA: com o arquivo por UF disponível,
    // `simulacaoNacional` não pode nem ser chamado. Sem ela, a versão antiga
    // (`simulacaoUf: () => null` para gov) passaria — a síntese devolve 200
    // com um corpo plausível.
    simulacaoLigadaMock.mockReturnValue(true);
    simulacaoGovernadorUfMock.mockReturnValue(RESUMO);
    simulacaoNacionalMock.mockReturnValue(GOV_NACIONAL);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));

    expect(simulacaoGovernadorUfMock).toHaveBeenCalledWith("SP");
    expect(simulacaoNacionalMock).not.toHaveBeenCalled();
    expect(simulacaoUfPresidenteMock).not.toHaveBeenCalled();
    expect(simulacaoSenadorUfMock).not.toHaveBeenCalled();
    expect(readUfProjectionMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESUMO);
  });

  it("simulação ligada + `cargo=gov` SEM o arquivo por UF sintetiza a corrida DAQUELA UF, não a união das 27", async () => {
    // O fallback continua existindo e continua correto: enquanto
    // `governador-uf.json` não estiver no diretório (fixture antiga, alguém
    // que ainda não rodou o gerador), a tela segue com o pódio em vez de ficar
    // muda. Com a lista presidencial — ou com a união nacional de cargo 3 sem
    // filtro — o balão mostraria "Candidato 26000" e a coluna de partido
    // sumiria.
    simulacaoLigadaMock.mockReturnValue(true);
    simulacaoGovernadorUfMock.mockReturnValue(null);
    simulacaoNacionalMock.mockReturnValue(GOV_NACIONAL);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));

    expect(simulacaoNacionalMock).toHaveBeenCalledWith("gov");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      cargo: number;
      pct_apurado: number;
      candidatos: Array<{ id: number; nome: string; partido: string; sqcand?: string }>;
    };

    expect(corpo.cargo).toBe(3);
    expect(corpo.pct_apurado).toBe(35);
    // O candidato do Acre NÃO entra: `id` é namespaced por UF no produtor, e
    // quem recorta a corrida do estado é `top_candidatos`.
    expect(corpo.candidatos.map((c) => c.id)).toEqual([26000, 26001]);
    // A IDENTIDADE vem de `top_candidatos` (resolvida pelo par `(uf, numero)`
    // no orchestrator), não de `national.candidatos` — RF-145.
    expect(corpo.candidatos[0]?.nome).toBe("NOME RESOLVIDO EM SP");
    expect(corpo.candidatos[0]?.partido).toBe("PL");
    expect(corpo.candidatos[0]?.sqcand).toBe("250002541308");
    // Sem `sqcand` na linha da UF, a chave fica AUSENTE — não `undefined`
    // explícito, que um `"sqcand" in c` leria como "tem".
    expect("sqcand" in (corpo.candidatos[1] ?? {})).toBe(false);
  });

  it("🔴 síntese de `cargo=gov`: `destino` SÓ da linha da UF — ausente ali não deixa passar o da lista nacional [mutação: `t?.destino ?? c.destino`]", async () => {
    // Desde 2026-09-27 as listas não emitem `"valido"`: a ausência na linha da
    // UF quer dizer "compete". Se a síntese caísse na lista nacional — em
    // Gov/Sen a UNIÃO de 27 corridas —, um `destino` alheio viraria etiqueta
    // aqui. Presidente segue lendo a lista nacional (ver o ramo `nacional`).
    const base = GOV_NACIONAL as {
      national: { candidatos: Array<Record<string, unknown>> };
      por_uf: Array<{ sigla: string; top_candidatos: Array<Record<string, unknown>> }>;
    };
    const payload = structuredClone(base);
    for (const c of payload.national.candidatos) {
      if (c.id === 26000) c.destino = "anulado";
      if (c.id === 26001) c.destino = "anulado";
    }
    const sp = payload.por_uf.find((l) => l.sigla === "SP");
    const segundo = sp?.top_candidatos.find((t) => t.id === 26001);
    if (segundo === undefined) throw new Error("fixture sem 26001");
    segundo.destino = "sub_judice";
    simulacaoLigadaMock.mockReturnValue(true);
    simulacaoGovernadorUfMock.mockReturnValue(null);
    simulacaoNacionalMock.mockReturnValue(payload);

    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));
    const corpo = (await res.json()) as { candidatos: Array<{ id: number; destino?: string }> };
    const porId = new Map(corpo.candidatos.map((c) => [c.id, c] as const));

    expect("destino" in (porId.get(26000) ?? {})).toBe(false);
    expect(porId.get(26001)?.destino).toBe("sub_judice");
  });

  it("simulação ligada + `cargo=gov` numa UF que o payload não tem → 503, nunca outra UF", async () => {
    simulacaoLigadaMock.mockReturnValue(true);
    simulacaoGovernadorUfMock.mockReturnValue(null);
    simulacaoNacionalMock.mockReturnValue(GOV_NACIONAL);

    const res = await GET(new Request("http://x/api/projection?uf=RR&cargo=gov"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_payload", uf: "RR", cargo: "gov" });
  });
});
