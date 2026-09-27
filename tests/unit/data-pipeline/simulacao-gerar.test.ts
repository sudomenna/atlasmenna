/**
 * tests/unit/data-pipeline/simulacao-gerar.test.ts
 *
 * O gerador de estado eleitoral simulado (`data-pipeline/simulacao-gerar.ts`).
 *
 * ## Como este arquivo foi escrito
 *
 * Cada teste abaixo nasceu de uma MUTAÇÃO: primeiro se escolhe o defeito que o
 * gerador poderia ter, depois se escreve o teste que morre com ele. O nome de
 * cada `it` termina com a mutação que ele mata, entre colchetes. Teste sem
 * mutação nomeada aqui é teste que ninguém provou que discrimina — e este
 * repositório já tem três memórias distintas sobre isso.
 *
 * ## Duas camadas, de propósito
 *
 * 1. **Hermética** — roda o gerador sobre um conjunto de dados sintético
 *    montado aqui. Não toca banco, não depende de nada ter rodado antes, e é
 *    onde as invariantes aritméticas são exercitadas.
 * 2. **Sobre os arquivos gravados** — lê `tests/fixtures/simulacao/*.json` e
 *    confere a coerência entre eles. É a camada que responde à pergunta do
 *    dono ("o percentual de SP é o mesmo nas seis telas?"), e ela tem de olhar
 *    os bytes que a tela vai ler, não um objeto em memória.
 *
 * A camada 2 falha se `pnpm sim` nunca rodou. Isso é intencional: os arquivos
 * são o entregável, e um teste que se auto-pula quando o entregável some é a
 * primeira das três formas de teste que não discrimina.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alocarInteiros,
  alocarMatriz,
  type CandidatoBruto,
  CLI_DEFAULT,
  contagensVotacao,
  type DadosSimulacao,
  designarDestinos,
  distribuirPctPorUf,
  gerarSimulacao,
  type Manifest,
  type MunicipioBruto,
  PARAMETROS_VOTACAO,
  PERFIL_VELOCIDADE_2022,
  parseCli,
  projetarVotacao,
  quocienteEleitoral,
  Rng,
  TOLERANCIA,
  UFS,
  validarSaida,
} from "@/data-pipeline/simulacao-gerar";
import type { DeputadoUfDetail } from "@/lib/blob/deputado-uf";
import type { UfDetailBlob } from "@/lib/blob/uf-detail";
import type { CargoTse } from "@/lib/config/cargos";
import type {
  EdgePayload,
  EdgePayloadDeputado,
  EdgePayloadUf,
  EdgeUfCandidate,
  EdgeVotacao,
  EdgeVotacaoContagens,
} from "@/lib/edge-config/types";

/** Alias local só para encurtar as asserções de ordenação. */
type EdgeUfCandidateLike = EdgeUfCandidate;

// ─────────────────────────────────────────────────────────────────────────────
// Dados sintéticos — a camada hermética
// ─────────────────────────────────────────────────────────────────────────────

/** Tabela real das 513 cadeiras, lida da mesma fixture que o gerador usa. */
const CADEIRAS: Record<string, number> = (() => {
  const j = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/fixtures/edge-config/dep-current.json"), "utf8"),
  ) as { por_uf: Array<{ sigla: string; lugares_a_preencher: number }> };
  return Object.fromEntries(j.por_uf.map((l) => [l.sigla, l.lugares_a_preencher]));
})();

/**
 * 20 siglas, como o dado real (24 agremiações em 2026). O número importa: com
 * 8 partidos, 513 cadeiras não cabem numa cauda — todo mundo elege alguém, e o
 * teste da hierarquia mediria o tamanho do dado de teste em vez do gerador.
 */
const PARTIDOS = [
  "PT",
  "PL",
  "PSD",
  "MDB",
  "UNIÃO",
  "PSB",
  "PP",
  "NOVO",
  "PDT",
  "PSDB",
  "REPUBLICANOS",
  "PODE",
  "SOLIDARIEDADE",
  "PSOL",
  "AVANTE",
  "PV",
  "CIDADANIA",
  "PRTB",
  "DC",
  "PCO",
] as const;

/**
 * Força de 2022 com a FORMA da real: 20,5 no topo e 0,01 na ponta. Uma âncora
 * plana aqui faria o teste da hierarquia passar sem provar nada.
 */
const FORCA_2022 = [
  20.5, 13.6, 11.0, 10.2, 8.5, 7.5, 6.5, 6.3, 5.4, 2.6, 1.9, 1.0, 0.9, 0.8, 0.6, 0.5, 0.4, 0.3, 0.1,
  0.01,
] as const;
/** Duas siglas formam federação — exercita o ramo de `tipo: "federacao"`. */
const FEDERACAO: Record<string, string | null> = { PSB: "PSB/PP", PP: "PSB/PP" };

/**
 * 🔴 UFs em que o PSB **não** lança candidatura, deixando a federação PSB/PP
 * representada só pelo PP naquele estado.
 *
 * ⚠️ Quem falta tem de ser o componente de MENOR número na urna (PSB = 15, PP =
 * 16). Com o menor sempre presente, o `cod` derivado da UF coincide com o
 * global e a mutação sobrevive — verificado: numa primeira versão faltava o PP
 * e o teste passava com o defeito aplicado.
 *
 * Existe porque sem isso o teste da identidade da federação não discrimina: com
 * a federação sempre completa nos 27 estados, `cod` derivado dos componentes
 * presentes na UF dá sempre o mesmo número e o defeito fica invisível. No dado
 * real ele NÃO é invisível — produziu "PSDB/CIDADANIA" duas vezes na bancada,
 * com 29 e 9 cadeiras.
 */
const UFS_SEM_PSB = new Set(["AC", "AP", "RR", "SE", "TO"]);

function candidatura(cargo: CargoTse, uf: string, i: number, seq: number): CandidatoBruto {
  const sigla = PARTIDOS[i % PARTIDOS.length] as string;
  return {
    cargo,
    uf,
    numero: cargo === 1 ? 10 + i : cargo === 6 ? 1000 + i : 10 + i,
    nome_urna: `CAND ${uf}-${cargo}-${i}`,
    partido_sigla: sigla,
    partido_numero: 10 + (i % PARTIDOS.length),
    federacao_sigla: FEDERACAO[sigla] ?? null,
    sq_candidato: String(280000000000 + seq),
  };
}

function dadosSinteticos(): DadosSimulacao {
  const eleitorado: DadosSimulacao["eleitorado"] = Object.fromEntries(
    UFS.map((uf, i) => [
      uf,
      {
        // O eleitorado sintético CORRELACIONA com a velocidade de apuração,
        // como no dado real (as UFs da frente são as grandes). Sem isso, a
        // média ponderada e a simples quase coincidem e o teste que separa as
        // duas não discriminaria nada.
        aptos: 400_000 + (PERFIL_VELOCIDADE_2022[uf] as number) * 260_000 + i * 150_000,
        comparecimento: 0.7 + (i % 9) * 0.01,
        pares: 20 + i * 7,
        fonte: "medido" as const,
      },
    ]),
  );

  const candidatos: CandidatoBruto[] = [];
  let seq = 0;
  for (let i = 0; i < 6; i++) candidatos.push(candidatura(1, "BR", i, seq++));
  for (const uf of UFS) {
    for (let i = 0; i < 5; i++) candidatos.push(candidatura(3, uf, i, seq++));
    for (let i = 0; i < 6; i++) candidatos.push(candidatura(5, uf, i, seq++));
    // Candidaturas a deputado em número suficiente para a UF poder preencher
    // as suas cadeiras — senão o teste mediria o caso degenerado o tempo todo.
    const n = (CADEIRAS[uf] as number) + 16;
    for (let i = 0; i < n; i++) {
      if (UFS_SEM_PSB.has(uf) && PARTIDOS[i % PARTIDOS.length] === "PSB") continue;
      candidatos.push(candidatura(6, uf, i, seq++));
    }
  }

  const municipios: MunicipioBruto[] = [];
  for (const [k, uf] of UFS.entries()) {
    const nMun = 4 + (k % 5);
    for (let i = 0; i < nMun; i++) {
      municipios.push({
        cod_ibge: String(1000000 + k * 1000 + i),
        cod_municipio_tse: k * 1000 + i,
        uf,
        nome: `Município ${uf}-${i}`,
        populacao: 30_000 * (i + 1),
        capital: i === 0,
        aptos: 20_000 * (i + 1),
      });
    }
  }

  return {
    eleitorado,
    candidatos,
    cadeirasPorUf: CADEIRAS,
    atualizacaoMin: 15,
    nomePartido: Object.fromEntries(PARTIDOS.map((p, i) => [10 + i, `Partido ${p}`])),
    forcaPartido: Object.fromEntries(PARTIDOS.map((p, i) => [p, FORCA_2022[i] ?? 0.01])),
    // Âncora sintética com a MESMA forma da real: poucas legendas grandes e
    // cauda longa (20,5 · 13,6 · 11,0 · … · 0,3). Uma âncora plana aqui faria
    // o teste da hierarquia medir o próprio dado de teste, não o gerador.
    forcaCamaraNacional: Object.fromEntries(PARTIDOS.map((p, i) => [p, FORCA_2022[i] ?? 0.01])),
    // Pendor estadual só em metade das UFs — exercita os dois ramos (com
    // medição na UF e sem, caindo no nacional).
    forcaCamaraUf: Object.fromEntries(
      UFS.map((uf, k): [string, Record<string, number>] => [
        uf,
        k % 2 === 0 ? { PT: 30 - k, PL: 15 + (k % 7), UNIÃO: 10 } : {},
      ]),
    ),
    pisoForcaCamara: 0.01,
    pendorPresUf: Object.fromEntries(
      UFS.map((uf, k) => [uf, { PT: 0.6 + (k % 10) * 0.1, PL: 1.6 - (k % 10) * 0.1 }]),
    ),
    municipios,
    avisos: [],
  };
}

const TS = "2026-10-04T20:15:00.000Z";
const DADOS = dadosSinteticos();

function gerar(over: Partial<typeof CLI_DEFAULT> = {}) {
  return gerarSimulacao(DADOS, { ...CLI_DEFAULT, ...over }, TS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Arquivos gravados — a camada sobre os bytes
// ─────────────────────────────────────────────────────────────────────────────

const DIR = resolve(process.cwd(), CLI_DEFAULT.out);

function lerArquivo<T>(nome: string): T {
  try {
    return JSON.parse(readFileSync(resolve(DIR, nome), "utf8")) as T;
  } catch (e) {
    throw new Error(
      `Não consegui ler ${nome} em ${DIR}. Rode \`set -a; . ./.env.local; set +a; pnpm sim\` ` +
        `antes — os arquivos de simulação são o entregável deste gerador. (${String(e)})`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════

describe("simulacao-gerar — CLI", () => {
  it('recusa cenário desconhecido em vez de cair no default [mutação: `cenario = v ?? "apertado"`]', () => {
    expect(() => parseCli(["--cenario", "folgadissimo"])).toThrow(/não reconhece/);
    // A mutação que este teste mata é o molde que já mandou payload de Senador
    // para a chave do Presidente neste repositório: valor não reconhecido
    // virando o default em silêncio.
    expect(parseCli(["--cenario", "folgado"]).cenario).toBe("folgado");
  });

  it("recusa --pct fora de 0..100 [mutação: aceitar qualquer número]", () => {
    expect(() => parseCli(["--pct", "140"])).toThrow(/0\.\.100/);
    expect(() => parseCli(["--pct", "-3"])).toThrow(/0\.\.100/);
    expect(parseCli(["--pct", "62.5"]).pct).toBe(62.5);
  });

  it("recusa flag desconhecida [mutação: ignorar flags não reconhecidas]", () => {
    expect(() => parseCli(["--saida", "x"])).toThrow(/Flag desconhecida/);
  });
});

describe("simulacao-gerar — aritmética de base", () => {
  it("alocarInteiros reparte o total EXATO [mutação: arredondar cada parcela isoladamente]", () => {
    // Três pesos iguais sobre 100: o arredondamento independente daria 33+33+33
    // = 99 e deixaria um voto órfão. Maiores restos dá 34+33+33.
    expect(alocarInteiros(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(alocarInteiros(100, [1, 1, 1])).toEqual([34, 33, 33]);
    const pesos = [37.4, 21.9, 15.05, 9.3, 8.15, 5.2, 3.0];
    expect(alocarInteiros(1_234_567, pesos).reduce((a, b) => a + b, 0)).toBe(1_234_567);
    expect(alocarInteiros(0, pesos).every((v) => v === 0)).toBe(true);
  });

  it("alocarMatriz fecha as duas margens e NÃO envenena a matriz com NaN quando uma linha tem margem 0 [mutação: fator de linha `linhas[m] / soma` sem guarda]", () => {
    // 🔴 O caso de regressão de 2026-09-19. Uma linha de margem `0` — um
    // município que ainda não apurou nada, o estado NORMAL no começo da noite
    // — era zerada na 1ª iteração e, na 2ª, o fator virava `0 / 0 = NaN`. A
    // normalização de coluna seguinte espalhava esse `NaN` por TODAS as
    // linhas, e o gerador escrevia `votos_reportados: {}` em todos os
    // municípios do estado com forma perfeitamente válida (`JSON.stringify`
    // serializa `NaN` como `null`, e `NaN > 0` é `false`).
    //
    // A linha do meio é a que reproduz. Sem ela o caso passa com o defeito.
    const linhas = [1586, 6343, 0, 6342];
    const colunas = [5939, 2815, 3032, 1386, 659, 440];
    const pesos = linhas.map((_, m) => colunas.map((_v, c) => 1 + ((m * 7 + c * 3) % 5)));
    const y = alocarMatriz(linhas, colunas, pesos);

    for (const linha of y) {
      for (const v of linha) {
        expect(Number.isFinite(v), `célula não-finita: ${v}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
    // As duas margens, exatas — é para isso que a função existe.
    expect(y.map((l) => l.reduce((a, b) => a + b, 0))).toEqual(linhas);
    expect(colunas.map((_, c) => y.reduce((a, l) => a + (l[c] as number), 0))).toEqual(colunas);
    // E a linha de margem zero continua zerada: ela não apurou nada.
    expect(y[2]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("alocarMatriz sai finita em toda a família de margens zeradas [mutação: remover a guarda e confiar num caso só]", () => {
    // Um caso não basta: o defeito depende de QUANTAS linhas zeram, de onde
    // elas estão e de a preferência ser ou não degenerada. Varre a família.
    const colunas = [7, 5, 3, 1];
    const total = colunas.reduce((a, b) => a + b, 0);
    for (const linhas of [
      [total, 0, 0],
      [0, total, 0],
      [0, 0, total],
      [8, 0, 8],
      [0, 16, 0],
      [4, 0, 4, 0, 8],
    ]) {
      for (const degenerada of [false, true]) {
        // `degenerada`: preferência toda zero — o piso de 1e-12 é o único
        // sinal que sobra, e é onde o `0/0` nascia.
        const pesos = linhas.map((_, m) =>
          colunas.map((_v, c) => (degenerada ? 0 : 1 + ((m + c) % 3))),
        );
        const y = alocarMatriz(linhas, colunas, pesos);
        const onde = `linhas=${JSON.stringify(linhas)} degenerada=${degenerada}`;
        expect(
          y.every((l) => l.every((v) => Number.isFinite(v) && v >= 0)),
          `${onde}: célula não-finita ou negativa`,
        ).toBe(true);
        expect(
          y.map((l) => l.reduce((a, b) => a + b, 0)),
          `${onde}: margem de linha`,
        ).toEqual(linhas);
        expect(
          colunas.map((_v, c) => y.reduce((a, l) => a + (l[c] as number), 0)),
          `${onde}: margem de coluna`,
        ).toEqual(colunas);
      }
    }
  });

  it("quocienteEleitoral desce no 0,5 EXATO [mutação: Math.round]", () => {
    // Art. 106: "desprezada a fração se igual ou inferior a meio". 15/10 = 1,5
    // exato ⇒ 1. `Math.round(1.5)` dá 2, e um QE 1 maior muda quem elege.
    expect(quocienteEleitoral(15, 10)).toBe(1);
    // Acima de meio sobe: 16/10 = 1,6 ⇒ 2.
    expect(quocienteEleitoral(16, 10)).toBe(2);
    expect(quocienteEleitoral(1_000_000, 70)).toBe(14_286);
    expect(() => quocienteEleitoral(10, 0)).toThrow();
  });

  it("Rng é determinístico e derive separa fluxos [mutação: Math.random()]", () => {
    const a = new Rng("x");
    const b = new Rng("x");
    expect([a.u(), a.u(), a.u()]).toEqual([b.u(), b.u(), b.u()]);
    expect(new Rng("x").derive("p").u()).not.toBe(new Rng("x").derive("q").u());
  });

  it("distribuirPctPorUf bate o alvo ponderado e NÃO deixa o mapa uniforme [mutação: fator fixo 1]", () => {
    const peso = Object.fromEntries(UFS.map((uf, i) => [uf, 1_000_000 + i * 500_000]));
    const m = distribuirPctPorUf(25, peso);
    const total = Object.values(peso).reduce((a, b) => a + b, 0);
    const nac = UFS.reduce((a, uf) => a + (m[uf] as number) * (peso[uf] as number), 0) / total;
    expect(Math.abs(nac - 25)).toBeLessThanOrEqual(TOLERANCIA.pctNacional);
    // Sem renormalização o nacional sairia na casa de 13% (média das
    // velocidades ≈ 0,52), e o teste acima já morreria. Este segundo `expect`
    // mata a mutação oposta: normalizar ACHATANDO todo mundo no mesmo valor.
    const vals = UFS.map((uf) => m[uf] as number);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(20);
  });
});

describe("simulacao-gerar — invariantes de conteúdo", () => {
  const s = gerar();

  it("validarSaida aceita a saída inteira [mutação: qualquer uma das 11 invariantes]", () => {
    expect(() => validarSaida(s)).not.toThrow();
  });

  it("a soma dos votos de uma UF bate com o total de votos válidos da UF [mutação: alocar por arredondamento independente]", () => {
    for (const c of [...s.corridasPres, ...s.corridasGov, ...s.corridasSen]) {
      expect(c.resultados.reduce((a, x) => a + x.votosProjetados, 0)).toBe(c.ctx.votosFinais);
      expect(c.resultados.reduce((a, x) => a + x.votosAtuais, 0)).toBe(c.ctx.votosApurados);
    }
  });

  it("os percentuais de uma corrida somam 100 [mutação: escalar um share sem renormalizar]", () => {
    const soma = s.presidente.national.candidatos.reduce((a, c) => a + c.pct_projetado, 0);
    expect(Math.abs(soma - 100)).toBeLessThanOrEqual(TOLERANCIA.pctSoma);
    for (const uf of UFS) {
      const p = s.senadorUf[uf] as EdgePayloadUf;
      const sm = p.candidatos.reduce((a, c) => a + c.pct_projetado, 0);
      expect(Math.abs(sm - 100)).toBeLessThanOrEqual(TOLERANCIA.pctSoma);
    }
  });

  it("lower <= projetado <= upper em todo candidato [mutação: lower = share + hw]", () => {
    for (const p of [s.presidente, s.governador, s.senador]) {
      for (const c of p.national.candidatos) {
        expect(c.pct_projetado_lower).toBeLessThanOrEqual(c.pct_projetado);
        expect(c.pct_projetado).toBeLessThanOrEqual(c.pct_projetado_upper);
        expect(c.pct_projetado_lower).toBeGreaterThanOrEqual(0);
      }
    }
    for (const uf of UFS) {
      for (const c of (s.senadorUf[uf] as EdgePayloadUf).candidatos) {
        expect(c.ci95.lower).toBeLessThanOrEqual(c.pct_projetado);
        expect(c.pct_projetado).toBeLessThanOrEqual(c.ci95.upper);
      }
    }
  });

  it("as probabilidades ficam em [0,1] e somam o que devem [mutação: p_eleito por comparação marginal em vez de por cenário]", () => {
    const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(
      Math.abs(soma(s.presidente.national.candidatos.map((c) => c.p_vitoria)) - 1),
    ).toBeLessThanOrEqual(TOLERANCIA.prob);
    // Σ p_passa_2t == 2, e não 1: são DUAS vagas no 2º turno.
    expect(
      Math.abs(soma(s.presidente.national.candidatos.map((c) => c.p_passa_2t)) - 2),
    ).toBeLessThanOrEqual(TOLERANCIA.prob);
    for (const uf of UFS) {
      const p = s.senadorUf[uf] as EdgePayloadUf;
      // 🔴 A mutação que este número mata: contar `p_eleito` comparando
      // distribuições marginais (quem lidera) em vez de por cenário. Ali a soma
      // daria 1, não 2 — e numa corrida de duas vagas liderar não decide nada.
      expect(
        Math.abs(soma(p.candidatos.map((c) => c.p_eleito ?? 0)) - (p.vagas ?? 1)),
      ).toBeLessThanOrEqual(TOLERANCIA.prob);
      for (const c of p.candidatos) {
        expect(c.p_eleito).toBeGreaterThanOrEqual(0);
        expect(c.p_eleito).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ufs_apuradas conta só as UFs que REALMENTE apuraram [mutação: constante 27]", () => {
    // A 0,08% nacional as UFs lentas arredondam para 0,0 e genuinamente ainda
    // não começaram — é o estado "não começou" dentro de um payload que já
    // está apurando. Sem um caso assim, `ufs_apuradas: 27` fixo passaria.
    const baixo = gerar({ pct: 0.08 });
    const zeradas = baixo.presidente.por_uf.filter((l) => l.pct_apurado === 0).length;
    expect(zeradas).toBeGreaterThan(0);
    for (const p of [baixo.presidente, baixo.governador, baixo.senador]) {
      expect(p.ufs_apuradas).toBe(p.por_uf.filter((l) => l.pct_apurado > 0).length);
      expect(p.ufs_apuradas).toBeLessThan(27);
    }
    expect(baixo.deputado.ufs_apuradas).toBe(
      baixo.deputado.por_uf.filter((l) => l.pct_apurado > 0).length,
    );
    expect(() => validarSaida(baixo)).not.toThrow();
  });

  it("pct_apurado_total é a média PONDERADA pelo eleitorado [mutação: média simples das 27 UFs]", () => {
    const pesoTotal = s.ctxs.reduce((a, c) => a + c.eleitores, 0);
    const ponderada = s.ctxs.reduce((a, c) => a + c.pctApurado * c.eleitores, 0) / pesoTotal;
    const simples = s.ctxs.reduce((a, c) => a + c.pctApurado, 0) / s.ctxs.length;
    // As duas TÊM de divergir, senão o teste não discriminaria nada: as UFs
    // rápidas são justamente as grandes.
    expect(Math.abs(ponderada - simples)).toBeGreaterThan(1);
    expect(s.presidente.pct_apurado_total).toBe(s.manifest.pct_efetivo);
    expect(Math.abs(s.manifest.pct_efetivo - ponderada)).toBeLessThan(0.05);
  });

  it("o pct efetivo bate o pedido dentro de 0,1 pp [mutação: remover a bisseção]", () => {
    for (const pct of [5, 25, 62, 90]) {
      const g = gerar({ pct });
      expect(g.manifest.erro_pp).toBeLessThanOrEqual(TOLERANCIA.pctNacional);
    }
  });

  it("as cadeiras de cada UF fecham com lugares_a_preencher [mutação: uma rodada de sobra a mais]", () => {
    let total = 0;
    for (const uf of UFS) {
      const d = s.deputadoUf[uf] as DeputadoUfDetail;
      const cadeiras = d.agremiacoes.reduce((a, x) => a + x.cadeiras, 0);
      expect(cadeiras + d.vagas_nao_preenchidas).toBe(d.lugares_a_preencher);
      total += cadeiras;
    }
    expect(s.deputado.bancada.total_cadeiras).toBe(513);
    expect(s.deputado.bancada.cadeiras_atribuidas).toBe(total);
    expect(s.deputado.bancada.ufs_calculadas + s.deputado.bancada.ufs_aguardando).toBe(27);
  });

  it("federação entra como UMA agremiação, com os componentes legíveis [mutação: uma linha por partido]", () => {
    const fed = s.deputado.bancada.por_agremiacao.filter((a) => a.tipo === "federacao");
    expect(fed.length).toBeGreaterThan(0);
    for (const f of fed) {
      expect(f.componentes.length).toBeGreaterThan(1);
      // A cor sai da sigla do partido-líder (ADR-0024), que tem de ser um dos
      // componentes — nunca a sigla da federação, que não tem token de cor.
      expect(f.componentes).toContain(f.sigla_lider);
    }
    // Coligação não existe em proporcional desde a EC 97/2017.
    const siglas = s.deputado.bancada.por_agremiacao.map((a) => a.sigla);
    expect(new Set(siglas).size).toBe(siglas.length);
  });

  it("🔴 a identidade da agremiação é GLOBAL, não do recorte estadual [mutação: cod vindo dos componentes presentes na UF]", () => {
    // O dado sintético tem uma federação (PSB/PP) sem o PP em 5 UFs, que é o
    // que o dado real faz e o que torna este teste capaz de discriminar.
    // Com o `cod` derivado da UF, a mesma federação vira duas linhas na
    // bancada — foi o que aconteceu com PSDB/CIDADANIA (29 e 9 cadeiras).
    const ags = s.deputado.bancada.por_agremiacao;
    expect(new Set(ags.map((a) => a.cod)).size).toBe(ags.length);
    const codPorSigla = new Map<string, string>();
    for (const a of ags) {
      const visto = codPorSigla.get(a.sigla);
      expect(visto === undefined || visto === a.cod, `sigla ${a.sigla} com dois cods`).toBe(true);
      codPorSigla.set(a.sigla, a.cod);
    }
    // E os componentes da bancada nacional são a UNIÃO das 27 UFs, não os da
    // primeira UF lida: o PSB tem de aparecer mesmo faltando em 5 estados.
    const psbpp = ags.find((a) => a.sigla === "PSB/PP");
    expect(psbpp?.componentes).toEqual(["PP", "PSB"]);
  });

  it("🔴 a bancada tem HIERARQUIA e cauda, não 26 legendas empatadas [mutação: peso por número de candidaturas, sem âncora de 2022]", () => {
    // O defeito que este teste mata: sem âncora medida, o gerador pesava as
    // legendas pelo tamanho da lista que cada uma lança — quase plano, porque
    // todo partido lança lista cheia. Saíam 26 agremiações em torno de 32
    // cadeiras, com o NOVO como maior bancada. "Σ cadeiras == 513" passava.
    const cadeiras = s.deputado.bancada.por_agremiacao.map((a) => a.cadeiras);
    expect(cadeiras.reduce((a, b) => a + b, 0)).toBe(513);
    const ordenadas = [...cadeiras].sort((a, b) => a - b);
    const mediana = ordenadas[Math.floor(ordenadas.length / 2)] as number;
    const maior = Math.max(...cadeiras);

    // Limiares desta camada calibrados pelo que a âncora SINTÉTICA implica
    // (razão ~4, com 20 siglas). A versão FORTE roda contra o dado real, na
    // camada dos arquivos gravados, onde a razão é 40. As duas matam a mesma
    // mutação: com peso plano a razão cai para ~1,1 nos dois conjuntos.
    expect(maior / Math.max(1, mediana)).toBeGreaterThanOrEqual(2.5);
    const top5 = [...cadeiras]
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((a, b) => a + b, 0);
    expect(top5 / 513).toBeGreaterThan(0.35);
  });
});

describe("simulacao-gerar — o que o payload NÃO pode dizer", () => {
  const s = gerar();

  it('nenhum payload carrega o campo `fase` [mutação: emitir fase: "pre_eleicao"]', () => {
    // `fase` significa "a eleição ainda não começou". Num placar de 25% ela
    // faria as telas anunciarem exatamente o contrário do que mostram.
    for (const p of [s.presidente, s.governador, s.senador]) {
      expect(Object.hasOwn(p, "fase")).toBe(false);
    }
    expect(Object.hasOwn(s.deputado, "fase")).toBe(false);
  });

  it("nenhum payload inventa `dado_ts` [mutação: dado_ts: ts]", () => {
    // Não houve TSE. Carimbar uma hora de fonte é a mentira que o ADR-0038
    // existe para impedir.
    for (const p of [s.presidente, s.governador, s.senador]) {
      expect(Object.hasOwn(p, "dado_ts")).toBe(false);
    }
    expect(Object.hasOwn(s.deputado, "dado_ts")).toBe(false);
  });

  it("swing_vs_2022 é null, nunca 0 [mutação: swing_vs_2022: 0]", () => {
    // `0` afirmaria "não mudou nada desde 2022". Não há dado de swing aqui.
    for (const p of [s.presidente, s.governador, s.senador]) {
      for (const l of p.por_uf) expect(l.swing_vs_2022).toBeNull();
    }
  });

  it("UF presidencial nunca é marcada como decidida no 1º turno [mutação: bucket por p_vitoria da UF]", () => {
    // Quem decide o 2º turno presidencial é o agregado nacional. "decidido_1t"
    // numa linha de UF faria a tela dizer que São Paulo elegeu o presidente.
    for (const l of s.presidente.por_uf) {
      expect(["chamada", "indefinido"]).toContain(l.bucket);
      expect(l.vai_a_2t).toBeNull();
    }
  });

  it("o gerador não tem caminho de escrita remota [mutação: importar lib/edge-config/writer]", () => {
    // A garantia que importa não é sobre o que o código faz hoje, e sim sobre o
    // que o próximo editor não pode acrescentar sem perceber. Em 14/09/2026
    // este projeto publicou resultado inventado no site público real.
    const fonte = readFileSync(resolve(process.cwd(), "data-pipeline/simulacao-gerar.ts"), "utf8");
    // Ignora o bloco de comentário do cabeçalho, que CITA esses nomes de
    // propósito ao explicar por que não estão no código.
    const codigo = fonte
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    for (const proibido of [
      "edge-config/writer",
      "writeProjection",
      "writeEdgePayload",
      "blob/write",
      "putJson",
      "api.vercel.com",
      "EDGE_CONFIG_TOKEN",
      "BLOB_READ_WRITE_TOKEN",
      "fetch(",
    ]) {
      expect(codigo).not.toContain(proibido);
    }
  });
});

describe("simulacao-gerar — identidade real e fotos", () => {
  const s = gerar();

  it("cargo 1 carrega sqcand no bloco nacional; cargos 3 e 5 NÃO [mutação: emitir sqcand em todo cargo]", () => {
    for (const c of s.presidente.national.candidatos) {
      expect(typeof c.sqcand).toBe("string");
    }
    // Em cargo 3/5 o bloco nacional é a união de 27 corridas: um `sqcand` ali
    // endereçaria a foto de um candidato de UF arbitrária (types.ts:324).
    for (const p of [s.governador, s.senador]) {
      for (const c of p.national.candidatos) expect(c.sqcand).toBeUndefined();
    }
  });

  it("top_candidatos sempre traz nome, partido e sqcand próprios [mutação: resolver identidade por índice sobre national.candidatos]", () => {
    for (const p of [s.presidente, s.governador, s.senador]) {
      for (const l of p.por_uf) {
        for (const t of l.top_candidatos) {
          expect(typeof t.sqcand).toBe("string");
          expect(t.nome).toBeTruthy();
          expect(t.partido).toBeTruthy();
        }
        expect(l.lider).toBe(l.top_candidatos[0]?.id);
      }
    }
  });

  it("os ids de Governador e Senador são únicos entre as 27 UFs [mutação: id = número na urna]", () => {
    // Com o número de urna como `id`, o 13 do Acre e o 13 de Alagoas colidiriam
    // no índice que a tela monta sobre `national.candidatos`, e o card do
    // estado mostraria a pessoa errada (ADR-0042).
    for (const p of [s.governador, s.senador]) {
      const ids = p.national.candidatos.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("senador-uf traz as 27 UFs, com vagas e sqcand [mutação: só as UFs com candidatura completa]", () => {
    expect(Object.keys(s.senadorUf).sort()).toEqual([...UFS]);
    for (const uf of UFS) {
      const p = s.senadorUf[uf] as EdgePayloadUf;
      expect(p.uf).toBe(uf);
      expect(p.cargo).toBe(5);
      expect(p.vagas).toBe(2);
      expect(p.granularidade).toBe("zona");
      for (const c of p.candidatos) expect(typeof c.sqcand).toBe("string");
    }
  });
});

describe("simulacao-gerar — a votação presidencial por estado", () => {
  const s = gerar();

  it("🔴 a soma das 27 UFs bate com o total nacional, candidato a candidato [mutação: derivar a UF do nacional, ou o nacional de um cálculo paralelo]", () => {
    // O defeito que este teste mata é o que apareceu em `/uf/SP`: a página do
    // estado mostrando os votos do Brasil. É também o que mata o inverso — um
    // nacional calculado à parte das UFs, que ninguém conseguiria conferir
    // somando o mapa.
    for (const c of s.presidente.national.candidatos) {
      const somaProj = UFS.reduce(
        (a, uf) =>
          a +
          ((s.presidenteUf[uf] as EdgePayloadUf).candidatos.find((x) => x.id === c.id)
            ?.votos_projetados ?? 0),
        0,
      );
      const somaAt = UFS.reduce(
        (a, uf) =>
          a +
          ((s.presidenteUf[uf] as EdgePayloadUf).candidatos.find((x) => x.id === c.id)
            ?.votos_atuais ?? 0),
        0,
      );
      expect(somaProj, `votos projetados de ${c.nome}`).toBe(c.votos_projetados);
      expect(somaAt, `votos atuais de ${c.nome}`).toBe(c.votos_atuais);
    }
  });

  it("🔴 o líder do mapa é o líder da página do estado [mutação: ordenar a UF por apurado e o mapa por projetado]", () => {
    // Se divergirem, o choropleth pinta um vencedor e `/uf/XX` mostra outro.
    //
    // ⚠️ O teste só discrimina onde a ordem por APURADO difere da ordem por
    // PROJETADO — nas UFs em que coincidem, as duas implementações dão o mesmo
    // resultado e nenhuma asserção as separa. Por isso a varredura cobre dois
    // cenários e termina EXIGINDO que a divergência exista em algum lugar:
    // se um dia ela sumir, este teste tem de falhar avisando que virou
    // decorativo, não passar em silêncio.
    let divergencias = 0;
    for (const cenario of ["apertado", "tres-vias"] as const) {
      const g = gerar({ cenario });
      for (const l of g.presidente.por_uf) {
        const p = g.presidenteUf[l.sigla] as EdgePayloadUf;
        expect(p.candidatos[0]?.id, `líder de ${l.sigla} (${cenario})`).toBe(l.lider);
        expect(p.candidatos[0]?.pct_projetado).toBe(l.top_candidatos[0]?.pct);
        // Ordem canônica: `pct_projetado` desc.
        for (let i = 1; i < p.candidatos.length; i++) {
          expect((p.candidatos[i - 1] as EdgeUfCandidateLike).pct_projetado).toBeGreaterThanOrEqual(
            (p.candidatos[i] as EdgeUfCandidateLike).pct_projetado,
          );
        }
        const porApurado = [...p.candidatos].sort(
          (a, b) => b.pct_atual - a.pct_atual || a.id - b.id,
        );
        if (porApurado[0]?.id !== p.candidatos[0]?.id) divergencias++;
      }
    }
    expect(
      divergencias,
      "nenhuma UF tem líder diferente entre apurado e projetado — este teste não " +
        "conseguiria distinguir as duas ordenações e precisa de dado que as separe",
    ).toBeGreaterThan(0);
  });

  it("🔴 os votos municipais de uma UF fecham com o total daquela UF, candidato a candidato [mutação: alocar por município sem fechar a margem de coluna]", () => {
    for (const uf of UFS) {
      const p = s.presidenteUf[uf] as EdgePayloadUf;
      const muns = (s.municipiosPresT1[uf] as UfDetailBlob).municipios;
      for (const c of p.candidatos) {
        const soma = muns.reduce((a, m) => a + (m.votos_reportados[c.id] ?? 0), 0);
        expect(soma, `${uf} / ${c.nome}`).toBe(c.votos_atuais);
      }
      // E a margem de linha continua de pé: o município fecha consigo mesmo.
      const totalUf = p.candidatos.reduce((a, c) => a + c.votos_atuais, 0);
      const totalMun = muns.reduce(
        (a, m) => a + Object.values(m.votos_reportados).reduce((x, y) => x + y, 0),
        0,
      );
      expect(totalMun).toBe(totalUf);
    }
  });

  it("há geografia de verdade, não só dispersão [mutação: pendor sorteado por log-normal em vez do medido em 2022]", () => {
    // O pendor sintético dá ao PT razão crescente com o índice da UF e ao PL o
    // inverso — o mesmo formato do dado real (PT 1,53 no PI, 0,48 em RR). Um
    // sorteio produziria dispersão SEM correlação entre os dois.
    const idDe = (sigla: string) =>
      s.presidente.national.candidatos.find((c) => c.partido === sigla)?.id;
    const pt = idDe("PT");
    const pl = idDe("PL");
    expect(pt).toBeDefined();
    expect(pl).toBeDefined();
    const share = (uf: string, id: number | undefined) =>
      (s.presidenteUf[uf] as EdgePayloadUf).candidatos.find((c) => c.id === id)?.pct_projetado ?? 0;
    const ptS = UFS.map((uf) => share(uf, pt));
    const plS = UFS.map((uf) => share(uf, pl));
    // Dispersão real entre estados.
    expect(Math.max(...ptS) - Math.min(...ptS)).toBeGreaterThan(8);
    // E anticorrelação: onde um sobe o outro desce. `Math.random()` no lugar
    // do pendor medido daria correlação ~0.
    const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const mPt = media(ptS);
    const mPl = media(plS);
    const cov = ptS.reduce((a, v, i) => a + (v - mPt) * ((plS[i] as number) - mPl), 0);
    const sPt = Math.sqrt(ptS.reduce((a, v) => a + (v - mPt) ** 2, 0));
    const sPl = Math.sqrt(plS.reduce((a, v) => a + ((v as number) - mPl) ** 2, 0));
    expect(cov / (sPt * sPl)).toBeLessThan(-0.7);
  });

  it("🔴 a cor de um candidato é a MESMA nas 27 UFs e no nacional [mutação: cor pelo rank local da UF]", () => {
    // Na corrida presidencial a cor é identidade, não colocação. Com a cor
    // vinda do rank local, o segundo colocado nacional herdava o
    // `--color-cand-1` (vermelho) nos estados onde lidera: o mesmo candidato
    // vermelho na home e azul na página do estado.
    //
    // ⚠️ Um teste que só verificasse "a cor é um token `var(--color-cand-N)`
    // válido" passaria com o defeito — foi assim que ele chegou à tela.
    const corNacional = new Map(
      s.presidente.national.candidatos.map((c) => [c.id, c.cor] as const),
    );
    let liderancasLocaisDiferentes = 0;
    for (const uf of UFS) {
      const p = s.presidenteUf[uf] as EdgePayloadUf;
      for (const c of p.candidatos) {
        expect(c.cor, `${uf} / ${c.nome}`).toBe(corNacional.get(c.id));
      }
      // Meta-asserção: o teste só discrimina onde a ordem local difere da
      // nacional. Se isso deixar de acontecer, ele vira decorativo e tem de
      // falhar avisando, em vez de passar em silêncio.
      if (p.candidatos[0]?.id !== s.presidente.national.candidatos[0]?.id) {
        liderancasLocaisDiferentes++;
      }
    }
    expect(
      liderancasLocaisDiferentes,
      "nenhuma UF tem líder diferente do nacional — a cor por rank local daria o " +
        "mesmo resultado e este teste não separaria as duas implementações",
    ).toBeGreaterThan(0);
  });

  it("a forma é a de `EdgePayloadUf`, sem os campos que só o Senado tem [mutação: copiar o payload do Senador]", () => {
    for (const uf of UFS) {
      const p = s.presidenteUf[uf] as EdgePayloadUf;
      expect(p.uf).toBe(uf);
      expect(p.cargo).toBe(1);
      expect(p.turno).toBe(1);
      expect(p.granularidade).toBe("zona");
      // Presidente elege 1 e o contrato manda NÃO emitir `vagas`; `p_eleito`
      // responde à pergunta do Senado e não tem sentido aqui.
      expect(Object.hasOwn(p, "vagas")).toBe(false);
      for (const c of p.candidatos) {
        expect(Object.hasOwn(c, "p_eleito")).toBe(false);
        expect(typeof c.sqcand).toBe("string");
        expect(c.ci95.lower).toBeLessThanOrEqual(c.pct_projetado);
        expect(c.pct_projetado).toBeLessThanOrEqual(c.ci95.upper);
      }
      const soma = p.candidatos.reduce((a, c) => a + c.pct_projetado, 0);
      expect(Math.abs(soma - 100)).toBeLessThanOrEqual(TOLERANCIA.pctSoma);
    }
  });
});

describe("simulacao-gerar — a corrida a governador por estado (`governador-uf.json`)", () => {
  // 2026-09-19. Este arquivo nasceu porque cargo 3 era o único majoritário sem
  // resumo por UF no modo simulado, e a rota caía na síntese a partir de
  // `por_uf[].top_candidatos` — que é `slice(0, TOP_CANDIDATOS_POR_UF)`.
  // Medido em `pnpm dev:sim` antes: `?uf=SP&cargo=gov` devolvia 4 ids e
  // `/municipios?uf=SP&cargo=gov` devolvia 7; os 3 que sobravam viravam
  // "Candidato 26004" no balão do hover (`lib/utils/municipio-votos.ts`).
  const s = gerar();

  it("🔴 traz a corrida INTEIRA de cada UF, não o pódio [mutação: cortar em TOP_CANDIDATOS_POR_UF]", () => {
    // A asserção que mata a mutação é a comparação contra `corridasGov`, que é
    // a MESMA fonte de `montarMunicipios` — é isso que garante que todo `id`
    // que aparece em `votos_reportados` tenha nome e partido no balão. Contar
    // "> 4" não bastaria: numa UF com 4 candidaturas o corte é invisível.
    let comCauda = 0;
    for (const c of s.corridasGov) {
      const p = s.governadorUf[c.ctx.uf] as EdgePayloadUf;
      expect(p, `governador-uf não tem ${c.ctx.uf}`).toBeDefined();
      expect(
        p.candidatos.map((x) => x.id),
        `ids de ${c.ctx.uf}`,
      ).toEqual(c.resultados.map((r) => r.cand.id));
      if (c.resultados.length > 4) comCauda++;
    }
    // E o teste precisa provar que tem o que discriminar: sem nenhuma UF com
    // mais de 4 candidaturas, o corte que ele persegue não existiria no dado
    // de teste e o `it` viraria decoração.
    expect(comCauda, "nenhuma UF com cauda — o teste não discrimina").toBeGreaterThan(0);
  });

  it("🔴 nenhum id do detalhe municipal fica órfão do resumo [mutação: montar o resumo de outra fonte]", () => {
    // A tradução literal do critério de aceite medido no navegador. É a forma
    // mais próxima do sintoma: o balão só sabe o nome de quem está no resumo.
    for (const uf of UFS) {
      const resumo = new Set(
        ((s.governadorUf[uf] as EdgePayloadUf).candidatos ?? []).map((c) => c.id),
      );
      const noMapa = new Set<number>();
      for (const m of (s.municipiosGovT1[uf]?.municipios ?? []) as Array<{
        votos_reportados?: Record<string, number>;
      }>) {
        for (const id of Object.keys(m.votos_reportados ?? {})) noMapa.add(Number(id));
      }
      expect(noMapa.size, `${uf} sem votos no mapa municipal`).toBeGreaterThan(0);
      expect(
        [...noMapa].filter((id) => !resumo.has(id)),
        `ids órfãos em ${uf}`,
      ).toEqual([]);
    }
  });

  it("não copia o que é do Senado: sem `vagas`, sem `p_eleito` [mutação: clonar montarSenadorUf]", () => {
    // Governador elege 1 (`vagasPorUf: 1`). Um `vagas: 2` herdado faria a tela
    // desenhar duas faixas de eleito numa corrida de um cargo só, e `p_eleito`
    // responderia a uma pergunta que não existe com uma vaga. As duas são
    // OMISSÕES, e por isso `Object.hasOwn` — `toBeUndefined()` passaria com a
    // chave presente valendo `undefined`, que é o estado que o contrato proíbe.
    for (const uf of UFS) {
      const p = s.governadorUf[uf] as EdgePayloadUf;
      expect(p.cargo, uf).toBe(3);
      expect(p.turno, uf).toBe(1);
      expect(p.granularidade, uf).toBe("zona");
      expect(Object.hasOwn(p, "vagas"), `vagas em ${uf}`).toBe(false);
      for (const c of p.candidatos) {
        expect(Object.hasOwn(c, "p_eleito"), `p_eleito em ${uf}/${c.id}`).toBe(false);
        // `cor` foi aposentada em 19/09 (ADR-0024): quem desenha resolve pela
        // SIGLA. Um arquivo que nasce hoje não a reintroduz.
        expect(Object.hasOwn(c, "cor"), `cor em ${uf}/${c.id}`).toBe(false);
        expect(typeof c.sqcand, `sqcand em ${uf}/${c.id}`).toBe("string");
        expect(c.ci95.lower).toBeLessThanOrEqual(c.pct_projetado);
        expect(c.pct_projetado).toBeLessThanOrEqual(c.ci95.upper);
      }
    }
  });

  it("o líder do resumo é o líder do mapa, e os números são os da UF [mutação: servir o bloco nacional]", () => {
    for (const l of s.governador.por_uf) {
      const p = s.governadorUf[l.sigla] as EdgePayloadUf;
      expect(p.candidatos[0]?.id, `líder de ${l.sigla}`).toBe(l.lider);
      expect(p.candidatos[0]?.pct_projetado).toBe(l.top_candidatos[0]?.pct);
      expect(p.pct_apurado).toBe(l.pct_apurado);
      // Σ votos apurados do resumo == votos apurados da UF: se o payload
      // servisse o bloco nacional (a união das 27), isto estouraria 27×.
      const soma = p.candidatos.reduce((a, c) => a + c.votos_atuais, 0);
      const ctx = s.ctxs.find((c) => c.uf === l.sigla);
      expect(soma, `Σ votos apurados de ${l.sigla}`).toBe(ctx?.votosApurados);
    }
  });

  it("`validarSaida` reprova um resumo cortado no pódio [mutação: a invariante não existir]", () => {
    // Prova que a rede de segurança do gerador discrimina — sem isto, as
    // invariantes acima só valeriam para o caminho feliz deste teste.
    const podado = {
      ...s,
      governadorUf: Object.fromEntries(
        Object.entries(s.governadorUf).map(([uf, p]) => [
          uf,
          { ...p, candidatos: p.candidatos.slice(0, 4) },
        ]),
      ),
    };
    expect(() => validarSaida(podado)).toThrow(/corrida inteira, não o pódio/);

    const comVagas = {
      ...s,
      governadorUf: Object.fromEntries(
        Object.entries(s.governadorUf).map(([uf, p]) => [uf, { ...p, vagas: 2 }]),
      ),
    };
    expect(() => validarSaida(comVagas)).toThrow(/'vagas' presente/);
  });
});

describe("simulacao-gerar — top_candidatos: votos e parcial por candidato (balão do mapa)", () => {
  // 2026-09-18 — o balão do mapa nacional (estilo NYT) ganhou as colunas
  // "Votos" e "Parcial", alimentadas por `top_candidatos[].votos_atuais`/
  // `.pct_atual`. Os dois são NOVOS aqui — `linhaUf()` passou a copiá-los do
  // MESMO `ResultadoCandUf` que já alimentava outro bloco do payload.
  //
  // 🔴 **Esse "outro bloco" NÃO é o mesmo nos 3 cargos**, e confundir os dois
  // foi o primeiro defeito que este arquivo pegou de si mesmo: para
  // Presidente, `national.candidatos[].votos_atuais` é a SOMA das 27 UFs
  // (`montarPresidente`, "o agregado nacional é a SOMA das UFs") — comparar
  // `top_candidatos` (uma UF) contra ele reprova sempre (23.391.066 no
  // nacional contra 332.372 numa UF só). O ground truth por UF de Presidente
  // é `presidenteUf[sigla].candidatos` (`montarPresidenteUf`, EdgeUfCandidate).
  // Para Governador/Senador, `idBase` torna cada `id` ÚNICO por (UF,
  // candidato) — ali `national.candidatos` NÃO agrega nada, é literalmente
  // uma linha por (UF, candidato), e o `id` de `top_candidatos` só existe
  // naquele UF. Os dois testes abaixo usam a fonte certa para cada caso.
  const s = gerar();

  it("Presidente: top_candidatos carrega votos_atuais/pct_atual IDÊNTICOS aos de presidenteUf[sigla].candidatos, POR UF [mutação: comparar/copiar de national.candidatos, que é o agregado das 27 UFs]", () => {
    let conferidos = 0;
    for (const linha of s.presidente.por_uf) {
      const p = s.presidenteUf[linha.sigla] as EdgePayloadUf;
      for (const tc of linha.top_candidatos) {
        const cand = p.candidatos.find((c) => c.id === tc.id);
        expect(cand, `${linha.sigla} / id ${tc.id} sem par em presidenteUf`).toBeDefined();
        expect(tc.votos_atuais, `${linha.sigla} / ${tc.nome}`).toBe(cand?.votos_atuais);
        expect(tc.pct_atual, `${linha.sigla} / ${tc.nome}`).toBe(cand?.pct_atual);
        conferidos++;
      }
    }
    expect(conferidos).toBeGreaterThan(0);
  });

  it("Governador/Senador: top_candidatos carrega votos_atuais/pct_atual IDÊNTICOS aos de national.candidatos (id único por UF nestes 2 cargos) [mutação: não copiar os dois campos em linhaUf / copiar de uma fonte paralela]", () => {
    for (const payload of [s.governador, s.senador]) {
      const natPorId = new Map(payload.national.candidatos.map((c) => [c.id, c] as const));
      let conferidos = 0;
      for (const linha of payload.por_uf) {
        for (const tc of linha.top_candidatos) {
          const nat = natPorId.get(tc.id);
          expect(nat, `${linha.sigla} / id ${tc.id} sem par em national.candidatos`).toBeDefined();
          expect(tc.votos_atuais, `${linha.sigla} / ${tc.nome}`).toBe(nat?.votos_atuais);
          expect(tc.pct_atual, `${linha.sigla} / ${tc.nome}`).toBe(nat?.pct_atual);
          conferidos++;
        }
      }
      // Meta-asserção: sem isto um payload com `por_uf` vazio passaria pelo
      // teste inteiro sem nunca ter comparado nada.
      expect(conferidos).toBeGreaterThan(0);
    }
  });

  it("os dois campos são SEMPRE emitidos (nunca opcionais nesta simulação) — 0 é o fato de UF sem apuração, não ausência [mutação: `if (pctApurado > 0)` guardando a emissão]", () => {
    // Ao contrário do modelo real (`api/model/project.py`, onde a imputação
    // nacional deixa `pct_atual` ausente), este gerador NUNCA imputa: toda UF
    // tem `shareAtual`/`votosAtuais` calculados, `0` incluso quando
    // `pctApurado <= 0` (`sharesApurados`). Os dois campos têm de existir em
    // TODA linha de TODO candidato do top-3, nos 3 cargos.
    for (const payload of [s.presidente, s.governador, s.senador]) {
      for (const linha of payload.por_uf) {
        for (const tc of linha.top_candidatos) {
          expect(Object.hasOwn(tc, "votos_atuais"), `${linha.sigla} / id ${tc.id}`).toBe(true);
          expect(Object.hasOwn(tc, "pct_atual"), `${linha.sigla} / id ${tc.id}`).toBe(true);
          expect(typeof tc.votos_atuais).toBe("number");
          expect(typeof tc.pct_atual).toBe("number");
        }
      }
    }
  });

  it("UF sem NENHUMA apuração: todo candidato do top-3 sai com votos_atuais=0 e pct_atual=0, não travesso [mutação: `sharesApurados` devolver o projetado quando pctApurado<=0]", () => {
    // Mesmo cenário de baixa apuração já usado alhures neste arquivo
    // ("ufs_apuradas conta só as UFs que REALMENTE apuraram") — a 0,08%
    // nacional várias UFs arredondam pct_apurado para 0 nos 3 cargos.
    const baixo = gerar({ pct: 0.08 });
    let ufsZeradasConferidas = 0;
    for (const payload of [baixo.presidente, baixo.governador, baixo.senador]) {
      for (const linha of payload.por_uf.filter((l) => l.pct_apurado === 0)) {
        ufsZeradasConferidas++;
        for (const tc of linha.top_candidatos) {
          expect(tc.votos_atuais, `${linha.sigla} / id ${tc.id}`).toBe(0);
          expect(tc.pct_atual, `${linha.sigla} / id ${tc.id}`).toBe(0);
        }
      }
    }
    expect(
      ufsZeradasConferidas,
      "nenhuma UF com pct_apurado 0 nos 3 cargos — este cenário parou de produzir " +
        "o caso que o teste precisa para discriminar",
    ).toBeGreaterThan(0);
  });

  it("pct_atual é coerente com pct (projetado) da mesma linha — nunca fora de [0,100] e nunca a mesma distância nula de todo mundo [mutação: pct_atual = pct_projetado]", () => {
    // "Coerente" não é "igual": a fixture teria de exercitar QUE os dois
    // divergem (apuração parcial normalmente diverge da projeção final), ou
    // uma implementação que colasse `pct_atual = pct` passaria disfarçada.
    let divergencias = 0;
    for (const payload of [s.presidente, s.governador, s.senador]) {
      for (const linha of payload.por_uf) {
        for (const tc of linha.top_candidatos) {
          expect(tc.pct_atual, `${linha.sigla} / id ${tc.id}`).toBeGreaterThanOrEqual(0);
          expect(tc.pct_atual, `${linha.sigla} / id ${tc.id}`).toBeLessThanOrEqual(100);
          if (Math.abs((tc.pct_atual as number) - tc.pct) > 0.01) divergencias++;
        }
      }
    }
    expect(
      divergencias,
      "pct_atual nunca diverge de pct em nenhuma linha — `pct_atual = pct` passaria " +
        "por este teste sem ser pego",
    ).toBeGreaterThan(0);
  });
});

describe("simulacao-gerar — cenários", () => {
  it("apertado deixa os dois primeiros com IC sobreposto e ninguém chamado [mutação: usar o perfil de `folgado`]", () => {
    const s = gerar({ cenario: "apertado" });
    const [a, b] = s.presidente.national.candidatos;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect((a?.pct_projetado ?? 0) - (b?.pct_projetado ?? 0)).toBeLessThan(3);
    expect(a?.pct_projetado_lower ?? 0).toBeLessThanOrEqual(b?.pct_projetado_upper ?? 0);
    expect(a?.p_fecha_1t).toBe(0);
    expect(s.presidente.national.p_segundo_turno_overall).toBeGreaterThan(0.9);
    expect(s.presidente.por_uf.filter((l) => l.chamada).length).toBe(0);
  });

  it("folgado põe o líder encostado nos 50% [mutação: perfil idêntico ao de apertado]", () => {
    const s = gerar({ cenario: "folgado" });
    const a = s.presidente.national.candidatos[0];
    expect(a?.pct_projetado ?? 0).toBeGreaterThan(45);
    expect(
      (a?.pct_projetado ?? 0) - (s.presidente.national.candidatos[1]?.pct_projetado ?? 0),
    ).toBeGreaterThan(15);
  });

  it("tres-vias deixa três dentro de 4 pp [mutação: perfil de dois competitivos]", () => {
    const s = gerar({ cenario: "tres-vias" });
    const [a, , c] = s.presidente.national.candidatos;
    expect((a?.pct_projetado ?? 0) - (c?.pct_projetado ?? 0)).toBeLessThan(4);
  });

  it("os 27 estados se repartem entre corridas decididas, apertadas e indefinidas [mutação: um feitio só]", () => {
    const s = gerar();
    for (const chave of ["feitio_governador", "feitio_senador"] as const) {
      const cont = new Map<string, number>();
      for (const l of s.manifest.por_uf) cont.set(l[chave], (cont.get(l[chave]) ?? 0) + 1);
      expect([...cont.keys()].sort()).toEqual(["apertada", "decidida", "indefinida"]);
      for (const v of cont.values()) expect(v).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("simulacao-gerar — determinismo", () => {
  it("mesma seed e mesmas flags produzem bytes idênticos [mutação: Math.random() ou Date.now() dentro da geração]", () => {
    const a = JSON.stringify(gerar());
    const b = JSON.stringify(gerar());
    expect(a).toBe(b);
  });

  it("trocar a seed muda os NÚMEROS, não só o manifest [mutação: ignorar --seed]", () => {
    // ⚠️ A primeira versão deste teste comparava `JSON.stringify` da saída
    // inteira — e passava com a seed ignorada, porque o manifest carrega o
    // campo `seed` e os textos diferiam mesmo com todos os números idênticos.
    // Verificado aplicando a mutação: ela sobrevivia. Comparar só os payloads
    // é o que faz o teste discriminar.
    const semManifest = (s: ReturnType<typeof gerar>) =>
      JSON.stringify([
        s.presidente,
        s.governador,
        s.senador,
        s.deputado,
        s.senadorUf,
        s.deputadoUf,
        s.municipiosPresT1,
      ]);
    expect(semManifest(gerar({ seed: "outra" }))).not.toBe(semManifest(gerar()));
  });

  it("trocar --pct muda o mapa, e o ts injetado é o único relógio [mutação: new Date() dentro de gerarSimulacao]", () => {
    expect(gerar({ pct: 60 }).presidente.pct_apurado_total).not.toBe(
      gerar({ pct: 25 }).presidente.pct_apurado_total,
    );
    expect(gerar().presidente.ts).toBe(TS);
    expect(gerar().senadorUf.SP?.ts).toBe(TS);
    expect(gerar().municipiosPresT1.SP?.ts).toBe(TS);
  });
});

describe("simulacao-gerar — detalhe municipal", () => {
  const s = gerar();

  it("a média dos municípios ponderada pelo eleitorado bate o pct da UF [mutação: remover a bisseção de escalarParaMedia]", () => {
    for (const c of s.ctxs) {
      const b = s.municipiosPresT1[c.uf] as UfDetailBlob;
      const peso = b.municipios.reduce((a, m) => a + (m.eleitores ?? 0), 0);
      expect(peso).toBe(c.eleitores);
      const media = b.municipios.reduce((a, m) => a + m.pct_apurado * (m.eleitores ?? 0), 0) / peso;
      expect(Math.abs(media - c.pctApurado)).toBeLessThanOrEqual(0.05);
    }
  });

  it("dentro da UF os municípios NÃO apuram no mesmo ritmo [mutação: pct uniforme = pct da UF]", () => {
    // O mapa municipal existe para mostrar essa textura. Uniforme não mostra
    // nada — e passaria no teste da média acima.
    const b = s.municipiosPresT1.SP as UfDetailBlob;
    const pcts = b.municipios.map((m) => m.pct_apurado);
    expect(Math.max(...pcts) - Math.min(...pcts)).toBeGreaterThan(5);
  });

  it('cargo é a STRING "pres", não o 1 numérico [mutação: reusar o Cargo de edge-config/types]', () => {
    // Há dois tipos chamados `Cargo` no repositório. `UfDetailBlob.cargo` é o
    // de `lib/config/calendar` — string.
    for (const uf of UFS) {
      const b = s.municipiosPresT1[uf] as UfDetailBlob;
      expect(b.cargo).toBe("pres");
      expect(b.turno).toBe(1);
      expect(b.uf).toBe(uf);
    }
  });

  it("a série temporal tem corpo e nunca regride [mutação: um ponto só, ou turnout não-monotônico]", () => {
    for (const uf of UFS) {
      const st = (s.municipiosPresT1[uf] as UfDetailBlob).series_temporais;
      expect(st).not.toBeNull();
      const t = st?.turnout ?? [];
      expect(t.length).toBeGreaterThan(10);
      for (let i = 1; i < t.length; i++) {
        expect(t[i]?.pct_apurado ?? 0).toBeGreaterThanOrEqual(t[i - 1]?.pct_apurado ?? 0);
      }
      // Apuração termina onde a UF está agora — nunca noutro número.
      expect(t[t.length - 1]?.pct_apurado).toBe(s.ctxs.find((c) => c.uf === uf)?.pctApurado);
      expect(st?.margem.length).toBe(t.length);
      expect(st?.p_vitoria.length).toBe(t.length);
      for (const p of st?.p_vitoria ?? []) {
        expect(p.p).toBeGreaterThanOrEqual(0);
        expect(p.p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("os votos de um município fecham com o total apurado dele [mutação: somar shares em vez de repartir o total]", () => {
    for (const uf of UFS) {
      for (const m of (s.municipiosPresT1[uf] as UfDetailBlob).municipios) {
        const soma = Object.values(m.votos_reportados).reduce((a, b) => a + b, 0);
        const lider = Math.max(0, ...Object.values(m.votos_reportados));
        expect(m.lider.votos).toBe(lider);
        expect(m.lider.margem_pp).toBeGreaterThanOrEqual(0);
        if (soma > 0) expect(m.lider.votos).toBeLessThanOrEqual(soma);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Camada 2 — os arquivos que a tela vai ler
// ═════════════════════════════════════════════════════════════════════════════

describe("simulacao-gerar — os arquivos gravados", () => {
  const presidente = lerArquivo<EdgePayload>("presidente.json");
  const governador = lerArquivo<EdgePayload>("governador.json");
  const senador = lerArquivo<EdgePayload>("senador.json");
  const deputado = lerArquivo<EdgePayloadDeputado>("deputado.json");
  const presidenteUf = lerArquivo<Record<string, EdgePayloadUf>>("presidente-uf.json");
  const senadorUf = lerArquivo<Record<string, EdgePayloadUf>>("senador-uf.json");
  const governadorUf = lerArquivo<Record<string, EdgePayloadUf>>("governador-uf.json");
  const deputadoUf = lerArquivo<Record<string, DeputadoUfDetail>>("deputado-uf.json");
  const municipios = lerArquivo<Record<string, UfDetailBlob>>("municipios-pres-t1.json");
  const municipiosGov = lerArquivo<Record<string, UfDetailBlob>>("municipios-gov-t1.json");
  const manifest = lerArquivo<Manifest>("manifest.json");

  it("🔴 nenhum candidato do mapa municipal de Governador fica sem nome no balão [mutação: apagar governador-uf.json]", () => {
    // 🔴 A tradução, sobre os BYTES, do critério que o dono conferiu no
    // navegador em 19/09:
    //
    //   GET /api/projection?uf=SP&cargo=gov        → 4 ids   (antes)
    //   GET /api/projection/municipios?uf=SP&…=gov → 7 ids
    //
    // Os 3 que sobravam viravam "Candidato 26004" no hover do coroplético,
    // porque `lib/utils/municipio-votos.ts` só sabe o nome de quem está na
    // lista que a moldura do mapa recebeu. A camada hermética já prova isso
    // sobre o objeto em memória; aqui é sobre o arquivo que a tela lê — que é
    // onde a regressão apareceria se alguém regenerasse sem este arquivo.
    for (const uf of UFS) {
      const resumo = new Set((governadorUf[uf]?.candidatos ?? []).map((c) => c.id));
      expect(resumo.size, `governador-uf.json não tem ${uf}`).toBeGreaterThan(0);
      const noMapa = new Set<number>();
      for (const m of municipiosGov[uf]?.municipios ?? []) {
        for (const id of Object.keys(m.votos_reportados ?? {})) noMapa.add(Number(id));
      }
      expect(noMapa.size, `municipios-gov-t1.json sem votos em ${uf}`).toBeGreaterThan(0);
      expect(
        [...noMapa].filter((id) => !resumo.has(id)),
        `ids órfãos em ${uf}`,
      ).toEqual([]);
    }
  });

  it("🔴 o percentual apurado de cada UF é o MESMO nos sete arquivos [mutação: deslocar o pct do Deputado pela cadência]", () => {
    // As urnas são as mesmas. Esta é a checagem que o dono usaria para
    // descobrir que a simulação é falsa — e a que um deslocamento por cargo,
    // ainda que bem-intencionado, quebraria.
    for (const uf of UFS) {
      const esperado = presidente.por_uf.find((l) => l.sigla === uf)?.pct_apurado;
      expect(esperado, `presidente.json não tem ${uf}`).toBeTypeOf("number");
      const vistos: Array<[string, number | undefined]> = [
        ["governador.json", governador.por_uf.find((l) => l.sigla === uf)?.pct_apurado],
        ["senador.json", senador.por_uf.find((l) => l.sigla === uf)?.pct_apurado],
        ["deputado.json", deputado.por_uf.find((l) => l.sigla === uf)?.pct_apurado],
        ["presidente-uf.json", presidenteUf[uf]?.pct_apurado],
        ["senador-uf.json", senadorUf[uf]?.pct_apurado],
        ["governador-uf.json", governadorUf[uf]?.pct_apurado],
        ["deputado-uf.json", deputadoUf[uf]?.pct_apurado],
      ];
      for (const [arquivo, v] of vistos) {
        expect(v, `${uf} em ${arquivo}`).toBe(esperado);
      }
      // E o mapa municipal fecha com o mesmo número, por média ponderada.
      const b = municipios[uf];
      expect(b, `municipios-pres-t1.json não tem ${uf}`).toBeDefined();
      const peso = (b?.municipios ?? []).reduce((a, m) => a + (m.eleitores ?? 0), 0);
      const media =
        (b?.municipios ?? []).reduce((a, m) => a + m.pct_apurado * (m.eleitores ?? 0), 0) / peso;
      expect(
        Math.abs(media - (esperado as number)),
        `média municipal de ${uf}`,
      ).toBeLessThanOrEqual(0.05);
    }
  });

  it("os quatro payloads publicam o mesmo pct nacional, e é o do manifest [mutação: cada cargo calcular o seu]", () => {
    for (const p of [presidente, governador, senador, deputado]) {
      expect(p.pct_apurado_total).toBe(manifest.pct_efetivo);
    }
    expect(manifest.erro_pp).toBeLessThanOrEqual(TOLERANCIA.pctNacional);
  });

  it("os arquivos trazem candidaturas REAIS, não placeholders [mutação: voltar aos nomes sintéticos]", () => {
    // A fixture antiga dizia "CANDIDATO 100" e "Candidato PT" — foi por causa
    // dela que o dono não conseguia avaliar o espaço que nome e rosto ocupam.
    const nomes = presidente.national.candidatos.map((c) => c.nome);
    expect(nomes.length).toBeGreaterThan(5);
    for (const n of nomes) expect(n).not.toMatch(/^CAND(IDATO)?\b/i);
    for (const c of presidente.national.candidatos) {
      expect(c.sqcand).toMatch(/^\d{11,12}$/);
    }
    for (const uf of UFS) {
      for (const c of [
        ...(senadorUf[uf]?.candidatos ?? []),
        ...(presidenteUf[uf]?.candidatos ?? []),
      ]) {
        expect(c.sqcand).toMatch(/^\d{11,12}$/);
      }
    }
  });

  it("as 27 UFs estão em todos os mapas por sigla [mutação: gerar só as UFs da fixture antiga]", () => {
    // `sen-current.json` cobria 25 (faltavam AP e RR) e `dep-uf.json`, 5.
    expect(Object.keys(presidenteUf).sort()).toEqual([...UFS]);
    expect(Object.keys(senadorUf).sort()).toEqual([...UFS]);
    expect(Object.keys(deputadoUf).sort()).toEqual([...UFS]);
    expect(Object.keys(municipios).sort()).toEqual([...UFS]);
    expect(senador.por_uf.length).toBe(27);
  });

  it("🔴 a bancada gravada tem a forma de uma Câmara: poucos grandes e cauda longa [mutação: peso por número de candidaturas]", () => {
    // Medido sobre o ENTREGÁVEL, com o cadastro real de 2026 e a âncora de
    // Governador 2022. É a tela que o dono abriu e reprovou: antes da âncora
    // saíam 26 agremiações em torno de 32 cadeiras e o NOVO como maior bancada
    // da Câmara. `Σ cadeiras == 513` passava com a bancada plana.
    const ags = deputado.bancada.por_agremiacao;
    const cadeiras = ags.map((a) => a.cadeiras);
    expect(cadeiras.reduce((a, b) => a + b, 0)).toBe(513);
    const ordenadas = [...cadeiras].sort((a, b) => a - b);
    const mediana = ordenadas[Math.floor(ordenadas.length / 2)] as number;
    expect(Math.max(...cadeiras) / Math.max(1, mediana)).toBeGreaterThanOrEqual(8);
    const top5 = [...cadeiras]
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((a, b) => a + b, 0);
    expect(top5 / 513).toBeGreaterThan(0.5);
    // Cauda: pelo menos um terço das legendas quase sem cadeira.
    expect(cadeiras.filter((c) => c <= 5).length).toBeGreaterThanOrEqual(
      Math.ceil(cadeiras.length / 3),
    );
    // E uma agremiação por linha: nem `sigla` nem `cod` repetidos.
    expect(new Set(ags.map((a) => a.cod)).size).toBe(ags.length);
    expect(new Set(ags.map((a) => a.sigla)).size).toBe(ags.length);
  });

  it("🔴 nos arquivos, a soma das 27 UFs bate com o nacional presidencial [mutação: gerar presidente-uf a partir de outra corrida]", () => {
    for (const c of presidente.national.candidatos) {
      const soma = UFS.reduce(
        (a, uf) => a + (presidenteUf[uf]?.candidatos.find((x) => x.id === c.id)?.votos_atuais ?? 0),
        0,
      );
      expect(soma, `${c.nome} (${c.partido})`).toBe(c.votos_atuais);
    }
    for (const l of presidente.por_uf) {
      expect(presidenteUf[l.sigla]?.candidatos[0]?.id, `líder de ${l.sigla}`).toBe(l.lider);
    }
  });

  it("🔴 nos arquivos, a cor do candidato não muda entre a home e a página do estado [mutação: cor pelo rank local]", () => {
    const corNacional = new Map(presidente.national.candidatos.map((c) => [c.id, c.cor] as const));
    for (const uf of UFS) {
      for (const c of presidenteUf[uf]?.candidatos ?? []) {
        expect(c.cor, `${uf} / ${c.nome}`).toBe(corNacional.get(c.id));
      }
    }
  });

  it("o manifest declara que o dado é simulado [mutação: remover o aviso]", () => {
    expect(manifest.aviso).toMatch(/SIMULADO/);
    expect(manifest.por_uf.length).toBe(27);
    expect(manifest.contagens.deputado_cadeiras_total).toBe(513);
  });
});

describe("simulacao-gerar — o bloco `votacao` (spec 021)", () => {
  const s = gerar();
  const nacionais = (() => {
    const g = gerar();
    return [
      ["presidente", g.presidente.votacao],
      ["governador", g.governador.votacao],
      ["senador", g.senador.votacao],
      ["deputado", g.deputado.votacao],
    ] as const;
  })();

  /** O bloco do presidente, com o `undefined` já descartado pelo teste (1). */
  function bloco(): EdgeVotacao {
    const v = s.presidente.votacao;
    if (v === undefined) throw new Error("presidente sem votacao — ver o teste (1)");
    return v;
  }

  it("as QUATRO telas nacionais carregam o bloco [mutação: emitir só no presidente]", () => {
    for (const [nome, v] of nacionais) {
      expect(v, nome).toBeDefined();
      expect(v?.contagens.aptos, nome).toBeGreaterThan(0);
    }
  });

  it("as quatro telas contam o MESMO eleitorado [mutação: somar só as UFs apuradas num dos cargos]", () => {
    const ref = JSON.stringify(nacionais[0][1]?.contagens);
    for (const [nome, v] of nacionais) {
      expect(JSON.stringify(v?.contagens), nome).toBe(ref);
    }
    // E o total é o eleitorado do país, não uma parcela dele.
    expect(nacionais[0][1]?.contagens.aptos).toBe(s.manifest.eleitorado_total);
  });

  it("`comparecimento + abstencao = instalados`, exato em inteiro [mutação: arredondar a abstenção em vez de subtrair]", () => {
    const c = bloco().contagens;
    expect(c.comparecimento + c.abstencao).toBe(c.instalados);
    expect(c.abstencao).toBeGreaterThan(0);
  });

  it("`validos+brancos+nulos+anulados+sub_judice = comparecimento` [mutação: anulados somados POR CIMA dos votáveis, não de dentro]", () => {
    const c = bloco().contagens;
    expect(c.validos + c.brancos + c.nulos + c.anulados + c.sub_judice).toBe(c.comparecimento);
    // `validos` é MENOR que o voto a candidato contado, porque anulados e sub
    // judice saem de dentro dele (`vvc = vv + van + vansj`).
    expect(c.validos).toBeLessThan(c.validos + c.anulados + c.sub_judice);
    // E o par brancos+nulos se reparte quase meio a meio, como no dado real
    // (50,21% medidos na captura do simulado do TSE). Sem esta asserção, um
    // default de 0 ou 1 em `brancosDoPar` passaria em todas as identidades e
    // publicaria uma tela com a fatia de nulos — ou de brancos — sumida.
    const pctBrancos = (100 * c.brancos) / (c.brancos + c.nulos);
    expect(pctBrancos).toBeGreaterThan(45);
    expect(pctBrancos).toBeLessThan(55);
  });

  it("🔴 as quatro fatias nomeadas NÃO somam o comparecimento [mutação: anulados: 0, subJudice: 0]", () => {
    const c = bloco().contagens;
    const quatro = c.validos + c.brancos + c.nulos;
    expect(quatro).toBeLessThan(c.comparecimento);
    expect(c.comparecimento - quatro).toBe(c.anulados + c.sub_judice);
    // A ordem de grandeza medida no dado real do TSE: 14,2% do comparecimento.
    // Um simulado com o buraco em 0,1% não exercitaria o RF-197 na tela.
    const buraco = (100 * (c.anulados + c.sub_judice)) / c.comparecimento;
    expect(buraco).toBeGreaterThan(10);
    expect(buraco).toBeLessThan(20);
  });

  it("🔴 `aptos > instalados` durante a apuração, e o residual do círculo 1 é positivo [mutação: instalados = aptos]", () => {
    const c = bloco().contagens;
    expect(s.manifest.pct_efetivo).toBeLessThan(100);
    expect(c.aptos).toBeGreaterThan(c.instalados);
    const residual = c.aptos - (c.validos + c.brancos + c.nulos + c.abstencao);
    expect(residual).toBeGreaterThan(0);
    // A 25% apurado o vão é o país ainda não contado — a maior fatia do
    // círculo 1, não um resíduo de arredondamento.
    expect((100 * residual) / c.aptos).toBeGreaterThan(50);
  });

  it("`instalados` acompanha o pct apurado [mutação: instalados proporcional a 100% sempre]", () => {
    const c = bloco().contagens;
    const pctInstalado = (100 * c.instalados) / c.aptos;
    expect(pctInstalado).toBeGreaterThan(s.manifest.pct_efetivo - 0.2);
    expect(pctInstalado).toBeLessThan(s.manifest.pct_efetivo + 0.2);
  });

  it("no fim da noite o cinza ESTACIONA no tamanho dos anulados [mutação: normalizar as quatro fatias para fechar em aptos]", () => {
    const cheio = gerar({ pct: 100 });
    const v = cheio.presidente.votacao;
    if (v === undefined) throw new Error("presidente sem votacao a 100%");
    const c = v.contagens;
    const residual = c.aptos - (c.validos + c.brancos + c.nulos + c.abstencao);
    // Não vai a zero: sobra exatamente anulados + sub judice + as seções que
    // nunca instalam. É a verdade, e é o que o RF-197 manda declarar.
    expect(residual).toBe(c.anulados + c.sub_judice + (c.aptos - c.instalados));
    expect(residual).toBeGreaterThan(0);
    expect(c.aptos - c.instalados).toBeGreaterThan(0);
    // ... e o vão permanente das seções é IRRELEVANTE ao lado dos anulados,
    // como no dado real (267 contra 19,7 milhões).
    expect(c.aptos - c.instalados).toBeLessThan((c.anulados + c.sub_judice) / 1000);
  });

  it("a projeção usa as bases certas: a 100% ela reencontra o contado [mutação: projetar válidos sobre `aptos` em vez do comparecimento]", () => {
    const cheio = gerar({ pct: 100 });
    const v = cheio.presidente.votacao;
    if (v === undefined) throw new Error("presidente sem votacao a 100%");
    const p = v.projetada;
    if (p === undefined) throw new Error("presidente sem projetada a 100%");
    const c = v.contagens;
    for (const k of ["validos", "brancos", "nulos", "abstencao"] as const) {
      const erroRel = Math.abs(p[k] - c[k]) / c[k];
      expect(erroRel, `${k}: projetado ${p[k]} contra contado ${c[k]}`).toBeLessThan(0.001);
    }
  });

  it("🔴 a projeção é CRUA: as quatro projetadas não fecham em `aptos` [mutação: fator de normalização]", () => {
    const v = bloco();
    const p = v.projetada;
    if (p === undefined) throw new Error("presidente sem projetada a 25%");
    const soma = p.validos + p.brancos + p.nulos + p.abstencao;
    const aptos = v.contagens.aptos;
    expect(soma).toBeLessThan(aptos);
    expect(aptos - soma).toBeGreaterThan(0);
    // O vão projetado é da ordem dos anulados projetados (14% do
    // comparecimento), não de arredondamento.
    expect((100 * (aptos - soma)) / aptos).toBeGreaterThan(5);
  });

  it('🔴 `--pct 0` publica o estado "não começou", não o "não sabemos" [mutação: omitir o bloco quando nada apurou]', () => {
    const zero = gerar({ pct: 0 });
    for (const [nome, v] of [
      ["presidente", zero.presidente.votacao],
      ["governador", zero.governador.votacao],
      ["senador", zero.senador.votacao],
      ["deputado", zero.deputado.votacao],
    ] as const) {
      expect(v, nome).toBeDefined();
      const c = v?.contagens;
      expect(c?.aptos, nome).toBeGreaterThan(0);
      expect(c?.validos, nome).toBe(0);
      expect(c?.brancos, nome).toBe(0);
      expect(c?.nulos, nome).toBe(0);
      expect(c?.abstencao, nome).toBe(0);
      expect(c?.instalados, nome).toBe(0);
      expect(c?.comparecimento, nome).toBe(0);
      // RF-195: sem base amostral não há projeção — o círculo 3 vai inteiro
      // para "aguardando", e é a AUSÊNCIA da chave que produz esse estado.
      expect(v?.projetada, nome).toBeUndefined();
    }
  });

  it("`projetarVotacao` devolve null sem base amostral e um objeto com ela [mutação: `some` virar `every`]", () => {
    const paradas = s.ctxs.map((c) => ({ ...c, pctApurado: 0 }));
    expect(projetarVotacao(paradas)).toBeNull();
    const uma = paradas.map((c, i) => (i === 0 ? { ...c, pctApurado: 1 } : c));
    expect(projetarVotacao(uma)).not.toBeNull();
  });

  it("`contagensVotacao` responde aos quatro parâmetros [mutação: parâmetro ignorado]", () => {
    const base = contagensVotacao(s.ctxs);
    const semAnulados = contagensVotacao(s.ctxs, {
      ...PARAMETROS_VOTACAO,
      anulados: 0,
      subJudice: 0,
    });
    expect(semAnulados.anulados).toBe(0);
    expect(semAnulados.sub_judice).toBe(0);
    // Sem anulados, os votáveis viram TODOS válidos — e o comparecimento não
    // muda, porque anulados saem de dentro dos votáveis.
    expect(semAnulados.validos).toBe(base.validos + base.anulados + base.sub_judice);
    expect(semAnulados.comparecimento).toBe(base.comparecimento);

    const semNaoInstaladas = contagensVotacao(s.ctxs, {
      ...PARAMETROS_VOTACAO,
      naoInstaladas: 0,
    });
    expect(semNaoInstaladas.instalados).toBeGreaterThan(base.instalados);

    const soBrancos = contagensVotacao(s.ctxs, { ...PARAMETROS_VOTACAO, brancosDoPar: 1 });
    expect(soBrancos.nulos).toBe(0);
    expect(soBrancos.brancos).toBe(base.brancos + base.nulos);
  });

  /**
   * Aplica a mesma poda aos QUATRO payloads nacionais.
   *
   * Poluir só um deles não serve para provar as invariantes (12b)/(12c): a
   * checagem de "as quatro telas contam o MESMO eleitorado" dispara primeiro e
   * mascara a que se quer medir. Um defeito real do gerador sai igual nos
   * quatro, porque os quatro chamam a mesma `blocoVotacao`.
   */
  function podarTodos(
    saida: ReturnType<typeof gerar>,
    f: (c: EdgeVotacaoContagens) => EdgeVotacaoContagens,
  ): void {
    for (const p of [saida.presidente, saida.governador, saida.senador, saida.deputado]) {
      const v = p.votacao;
      if (v === undefined) throw new Error("payload sem votacao");
      v.contagens = f(v.contagens);
    }
  }

  it("`validarSaida` reprova uma fixture sem anulados [mutação: a invariante (12b) não existir]", () => {
    const podre = gerar();
    // Move anulados e sub judice para dentro de `validos`: as duas identidades
    // do EA20 continuam fechando exatamente, e é por isso que a invariante
    // aritmética sozinha NÃO basta.
    podarTodos(podre, (c) => ({
      ...c,
      validos: c.validos + c.anulados + c.sub_judice,
      anulados: 0,
      sub_judice: 0,
    }));
    expect(() => validarSaida(podre)).toThrow(/anulados \+ sub_judice = 0/);
  });

  it("`validarSaida` reprova `instalados = aptos` a meio da apuração [mutação: a invariante (12c) não existir]", () => {
    const podre = gerar();
    // `instalados = aptos` com a abstenção reequilibrada: as duas identidades
    // do EA20 seguem fechando, e o círculo 1 fica sem fatia cinza.
    podarTodos(podre, (c) => ({
      ...c,
      instalados: c.aptos,
      abstencao: c.aptos - c.comparecimento,
    }));
    expect(() => validarSaida(podre)).toThrow(/não teria fatia 'Ainda não apurado'/);
  });

  it("`validarSaida` reprova a identidade `esi = c + a` quebrada [mutação: a invariante (12a) não existir]", () => {
    const podre = gerar();
    // +1 na abstenção: os quatro payloads seguem idênticos entre si, o `aptos`
    // segue batendo o manifest, e a SEGUNDA identidade também fecha — só a
    // primeira quebra. É a poda mais estreita que alcança esta linha.
    podarTodos(podre, (c) => ({ ...c, abstencao: c.abstencao + 1 }));
    expect(() => validarSaida(podre)).toThrow(/identidade 'esi = c \+ a'/);
  });

  it("`validarSaida` reprova a identidade `tv = vvc + vb + tvn` quebrada [mutação: a invariante (12a) não existir]", () => {
    const podre = gerar();
    // +1 nos válidos: a primeira identidade continua fechando (não mexe em
    // comparecimento, abstenção nem instalados), só a segunda quebra.
    podarTodos(podre, (c) => ({ ...c, validos: c.validos + 1 }));
    expect(() => validarSaida(podre)).toThrow(/identidade 'tv = vvc \+ vb \+ tvn'/);
  });

  it("`validarSaida` reprova projeção que estoura `aptos` [mutação: a invariante do residual do círculo 3 não existir]", () => {
    const podre = gerar();
    // RF-195 avisa explicitamente: o residual do círculo 3 PODE sair negativo
    // se as quatro projeções somarem mais que `aptos`, e um arco com fatia
    // negativa desenha errado em silêncio.
    for (const p of [podre.presidente, podre.governador, podre.senador, podre.deputado]) {
      const v = p.votacao;
      if (v === undefined || v.projetada === undefined) throw new Error("payload sem projetada");
      v.projetada = { ...v.projetada, validos: v.contagens.aptos };
    }
    expect(() => validarSaida(podre)).toThrow(/residual do círculo 3/);
  });

  it("`validarSaida` reprova o bloco ausente e as contagens divergentes [mutação: checar só o presidente]", () => {
    const semBloco = gerar();
    semBloco.deputado.votacao = undefined;
    expect(() => validarSaida(semBloco)).toThrow(/bloco 'votacao' ausente/);

    const divergente = gerar();
    const v = divergente.senador.votacao;
    if (v === undefined) throw new Error("senador sem votacao");
    v.contagens = { ...v.contagens, aptos: v.contagens.aptos + 1 };
    expect(() => validarSaida(divergente)).toThrow(/MESMO eleitorado/);

    // E a âncora que NÃO é recálculo: os quatro podem concordar entre si e
    // ainda assim não somarem o eleitorado do país.
    const todosErrados = gerar();
    podarTodos(todosErrados, (c) => ({ ...c, aptos: c.aptos + 1 }));
    expect(() => validarSaida(todosErrados)).toThrow(/eleitorado_total/);
  });

  it("`validarSaida` aceita a saída com votação em 0%, 25% e 100% [mutação: qualquer uma das invariantes (12)]", () => {
    expect(() => validarSaida(gerar({ pct: 0 }))).not.toThrow();
    expect(() => validarSaida(s)).not.toThrow();
    expect(() => validarSaida(gerar({ pct: 100 }))).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Spec 022 — a corrida em três círculos (RF-203 / RF-209)
//
// O simulado tem de ser HONESTO como o TSE: em toda abrangência, Σ votos das
// candidaturas `valido` == `validos`, e o mesmo para anulado e sub judice.
// Antes da spec o gerador espalhava os anulados pelas candidaturas sem marcar
// ninguém (medido em 26/09: Σ `votos_atuais` nacional = válidos + anulados +
// sub judice). Nenhum teste aqui depende de as contagens serem as mesmas nos
// três cargos — isso é coincidência da fixture, não contrato.
// ═════════════════════════════════════════════════════════════════════════════

describe("simulacao-gerar — spec 022, a corrida", () => {
  const s = gerar();

  function somaPorDestino(
    corrida: readonly { votos: number; destino?: string }[] | undefined,
  ): Record<string, number> {
    const out: Record<string, number> = { valido: 0, anulado: 0, sub_judice: 0, ausente: 0 };
    for (const e of corrida ?? [])
      out[e.destino ?? "ausente"] = (out[e.destino ?? "ausente"] ?? 0) + e.votos;
    return out;
  }

  it("🔴 Presidente nacional: Σ válidos, anulados e sub judice fecham nas contagens [mutação: alocar o vvc inteiro entre as candidaturas sem destinação]", () => {
    const v = s.presidente.votacao;
    const soma = somaPorDestino(v?.corrida);
    expect(soma.valido).toBe(v?.contagens.validos);
    expect(soma.anulado).toBe(v?.contagens.anulados);
    expect(soma.sub_judice).toBe(v?.contagens.sub_judice);
    expect(soma.ausente).toBe(0);
    expect(soma.anulado).toBeGreaterThan(0);
    expect(soma.sub_judice).toBeGreaterThan(0);
    expect(v?.corrida_por_partido).toBeUndefined();
    expect(v?.destino_pendente).toBeUndefined();
  });

  it("🔴 cada UF dos três cargos fecha com o agregado DA UF, não com o do país [mutação: copiar as contagens nacionais para a UF]", () => {
    for (const [nome, mapa] of [
      ["presidente", s.presidenteUf],
      ["governador", s.governadorUf],
      ["senador", s.senadorUf],
    ] as const) {
      for (const c of s.ctxs) {
        const v = mapa[c.uf]?.votacao;
        expect(v, `${nome}/${c.uf}`).toBeDefined();
        expect(v?.contagens.aptos, `${nome}/${c.uf}`).toBe(c.eleitores);
        // Spec 021 RF-192 emendado (26/09 noite): a UF projeta quando tem base.
        expect(v?.projetada !== undefined, `${nome}/${c.uf}`).toBe(c.pctApurado > 0);
        const soma = somaPorDestino(v?.corrida);
        expect(soma.valido, `${nome}/${c.uf}`).toBe(v?.contagens.validos);
        expect(soma.anulado, `${nome}/${c.uf}`).toBe(v?.contagens.anulados);
        expect(soma.sub_judice, `${nome}/${c.uf}`).toBe(v?.contagens.sub_judice);
      }
    }
  });

  it("a destinação é da CANDIDATURA: no Presidente, a mesma nas 27 UFs [mutação: designar por UF]", () => {
    const porId = new Map<number, Set<string | undefined>>();
    for (const c of s.ctxs) {
      for (const e of s.presidenteUf[c.uf]?.votacao?.corrida ?? []) {
        if (!porId.has(e.id)) porId.set(e.id, new Set());
        porId.get(e.id)?.add(e.destino);
      }
    }
    for (const [id, destinos] of porId) expect([...destinos], `id ${id}`).toHaveLength(1);
    // E exatamente uma anulada e uma sub judice.
    const nac = s.presidente.votacao?.corrida ?? [];
    expect(nac.filter((e) => e.destino === "anulado")).toHaveLength(1);
    expect(nac.filter((e) => e.destino === "sub_judice")).toHaveLength(1);
  });

  it("🔴 o líder e o 2º colocado nunca são anulados [mutação: designar entre TODAS as candidaturas]", () => {
    const [a, b] = s.presidente.national.candidatos;
    const destinoDe = (id: number | undefined) =>
      s.presidente.votacao?.corrida?.find((e) => e.id === id)?.destino;
    expect(destinoDe(a?.id)).toBe("valido");
    expect(destinoDe(b?.id)).toBe("valido");
    for (const c of s.ctxs) {
      const uf = s.governadorUf[c.uf];
      const lider = uf?.candidatos[0]?.id;
      expect(uf?.votacao?.corrida?.find((e) => e.id === lider)?.destino, c.uf).toBe("valido");
    }
  });

  it("🔴 Governador/Senador nacional: por PARTIDO, só voto válido [mutação: somar todas as destinações no partido]", () => {
    for (const [nome, p, mapa] of [
      ["governador", s.governador, s.governadorUf],
      ["senador", s.senador, s.senadorUf],
    ] as const) {
      const v = p.votacao;
      expect(v?.corrida, nome).toBeUndefined();
      const partidos = v?.corrida_por_partido ?? [];
      expect(
        partidos.reduce((a, x) => a + x.votos_validos, 0),
        nome,
      ).toBe(v?.contagens.validos);
      // Recalculado pelas UFs: a sigla de uma candidatura anulada não soma nada.
      const esperado = new Map<string, number>();
      for (const c of s.ctxs) {
        for (const e of mapa[c.uf]?.votacao?.corrida ?? []) {
          if (e.destino !== "valido") continue;
          esperado.set(e.partido, (esperado.get(e.partido) ?? 0) + e.votos);
        }
      }
      expect(new Map(partidos.map((x) => [x.partido, x.votos_validos])), nome).toEqual(esperado);
      expect(
        partidos.map((x) => x.partido),
        nome,
      ).toEqual([...partidos.map((x) => x.partido)].sort());
    }
  });

  it("Deputado não ganha corrida [mutação: montarDeputado usar o bloco dos majoritários]", () => {
    const v = s.deputado.votacao;
    expect(v?.corrida).toBeUndefined();
    expect(v?.corrida_por_partido).toBeUndefined();
    expect(v?.destino_pendente).toBeUndefined();
  });

  it("pct_atual conta a mesma história que votos_atuais [mutação: manter o share sorteado depois de repartir por destinação]", () => {
    for (const c of s.ctxs) {
      const p = s.presidenteUf[c.uf];
      if (c.votosApurados <= 0) continue;
      for (const x of p?.candidatos ?? []) {
        expect(
          Math.abs((x.pct_atual ?? 0) - (100 * x.votos_atuais) / c.votosApurados),
        ).toBeLessThan(0.006);
      }
    }
  });

  it('a 0% apurado a corrida sai SEM destino e sem pendência — "não começou" [mutação: publicar dvt antes da 1ª totalização / marcar pendência com voto zero]', () => {
    const zero = gerar({ pct: 0 });
    for (const e of zero.presidente.votacao?.corrida ?? []) {
      expect(e.destino).toBeUndefined();
      expect(e.votos).toBe(0);
    }
    expect(zero.presidente.votacao?.destino_pendente).toBeUndefined();
    expect(zero.governador.votacao?.corrida_por_partido).toEqual([]);
    for (const c of zero.ctxs) {
      for (const mapa of [zero.presidenteUf, zero.governadorUf, zero.senadorUf]) {
        const v = mapa[c.uf]?.votacao;
        expect(v?.destino_pendente, c.uf).toBeUndefined();
        expect(
          v?.corrida?.every((e) => e.destino === undefined && e.votos === 0),
          c.uf,
        ).toBe(true);
      }
    }
    expect(() => validarSaida(zero)).not.toThrow();
  });

  it("a 100% apurado todas as identidades seguem fechando [mutação: arredondamento independente por bolo]", () => {
    expect(() => validarSaida(gerar({ pct: 100 }))).not.toThrow();
  });

  it("🔴 UF com corrida pequena demais fica SEM anulados, nos quatro cargos, em vez de pôr voto anulado numa válida [mutação: ignorar `anulaveis`]", () => {
    // Alagoas real tem 2 candidaturas a governador (26/09). Reproduz: deixa 2.
    const alvo = "AL";
    const poucos: DadosSimulacao = {
      ...DADOS,
      candidatos: DADOS.candidatos.filter(
        (c) => !(c.cargo === 3 && c.uf === alvo && Number(c.nome_urna.split("-").at(-1)) >= 2),
      ),
    };
    const saida = gerarSimulacao(poucos, CLI_DEFAULT, TS);
    const ctx = saida.ctxs.find((c) => c.uf === alvo);
    expect(ctx?.anulaveis).toBe(false);
    for (const mapa of [saida.presidenteUf, saida.governadorUf, saida.senadorUf]) {
      const v = mapa[alvo]?.votacao;
      expect(v?.contagens.anulados).toBe(0);
      expect(v?.contagens.sub_judice).toBe(0);
      expect(somaPorDestino(v?.corrida).valido).toBe(v?.contagens.validos);
    }
    expect(saida.governadorUf[alvo]?.votacao?.corrida?.every((e) => e.destino === "valido")).toBe(
      true,
    );
    // O resto do país continua tendo anulados — a fixture não empobrece.
    expect(saida.presidente.votacao?.contagens.anulados).toBeGreaterThan(0);
    expect(() => validarSaida(saida)).not.toThrow();
  });

  it("`designarDestinos`: abaixo de 3 candidaturas todas válidas; acima, protege as `vagas + 1` primeiras e escolhe a de share mais próximo [mutação: limiar, proteção ou critério de escolha]", () => {
    expect(designarDestinos([60, 40], 1)).toEqual(["valido", "valido"]);
    // 3 candidaturas, 1 vaga: `min(vagas+1, n−2)` = 1 protegida, e as 2
    // restantes carregam os bolos — o 20 é o mais próximo de 8,70.
    expect(designarDestinos([50, 30, 20], 1)).toEqual(["valido", "anulado", "sub_judice"]);
    // Mais próximo de 8,70 é o 9 (índice 3); de 7,64 entre os que sobram é o 7
    // (índice 4) — e NÃO o 25 (índice 2), que é o 1º elegível.
    expect(designarDestinos([35, 30, 25, 9, 7, 1], 1)).toEqual([
      "valido",
      "valido",
      "valido",
      "sub_judice",
      "anulado",
      "valido",
    ]);
    // 🔴 O líder é o MAIS PRÓXIMO dos dois alvos (9 de 8,70; 8 de 7,64): só a
    // proteção o impede de ser anulado. Sem este caso a proteção era linha
    // não medida — a mutação `protegidas = 0` sobrevivia a tudo acima.
    expect(designarDestinos([9, 8, 7.6, 7, 1], 1)).toEqual([
      "valido",
      "valido",
      "sub_judice",
      "anulado",
      "valido",
    ]);
    // Duas vagas: protege 3.
    const sen = designarDestinos([30, 25, 20, 9, 8, 8], 2);
    expect(sen.slice(0, 3)).toEqual(["valido", "valido", "valido"]);
    expect(sen.filter((d) => d === "anulado")).toHaveLength(1);
    expect(sen.filter((d) => d === "sub_judice")).toHaveLength(1);
  });

  // ── `validarSaida` reprova cada forma de corrida desonesta ────────────────

  function comCorrida(f: (saida: ReturnType<typeof gerar>) => void): ReturnType<typeof gerar> {
    const saida = gerar();
    f(saida);
    return saida;
  }

  it("`validarSaida` reprova candidatura anulada contada como válida [mutação: a invariante (13) não existir]", () => {
    const podre = comCorrida((x) => {
      const e = x.presidente.votacao?.corrida?.find((y) => y.destino === "anulado");
      if (e === undefined) throw new Error("sem anulado");
      e.destino = "valido";
    });
    expect(() => validarSaida(podre)).toThrow(/candidaturas 'valido'/);
  });

  it("`validarSaida` reprova sub judice trocado por anulado na UF [mutação: checar só o nacional]", () => {
    const podre = comCorrida((x) => {
      const uf = s.ctxs.find((c) => c.pctApurado > 0 && c.anulaveis)?.uf as string;
      const e = x.senadorUf[uf]?.votacao?.corrida?.find((y) => y.destino === "sub_judice");
      if (e === undefined) throw new Error("sem sub judice");
      e.destino = "anulado";
    });
    expect(() => validarSaida(podre)).toThrow(/candidaturas 'anulado'/);
  });

  it("`validarSaida` reprova destino sumido sem `destino_pendente` [mutação: pendência não conferida]", () => {
    const podre = comCorrida((x) => {
      const e = x.governadorUf.SP?.votacao?.corrida?.find(
        (y) => y.destino === "valido" && y.votos > 0,
      );
      if (e === undefined) throw new Error("SP sem válido");
      delete e.destino;
    });
    expect(() => validarSaida(podre)).toThrow(/destino_pendente|candidaturas 'valido'/);
  });

  it("`validarSaida` reprova partido somando voto anulado [mutação: Σ por partido sem filtro]", () => {
    const podre = comCorrida((x) => {
      const p = x.governador.votacao?.corrida_por_partido?.[0];
      if (p === undefined) throw new Error("sem partido");
      p.votos_validos += 1;
    });
    expect(() => validarSaida(podre)).toThrow(/corrida_por_partido/);
  });

  it("`validarSaida` reprova corrida por candidatura no nacional de Governador e corrida no Deputado [mutação: RF-200/201 não conferidos]", () => {
    const gov = comCorrida((x) => {
      const v = x.governador.votacao;
      if (v === undefined) throw new Error("sem votacao");
      v.corrida = [];
    });
    expect(() => validarSaida(gov)).toThrow(/1º colocado nacional/);
    const dep = comCorrida((x) => {
      const v = x.deputado.votacao;
      if (v === undefined) throw new Error("sem votacao");
      v.corrida = [];
    });
    expect(() => validarSaida(dep)).toThrow(/Deputado Federal não tem colocados/);
  });

  it("`validarSaida` reprova UF sem `votacao` e UF com contagem do país [mutação: UF não conferida]", () => {
    const sem = comCorrida((x) => {
      const p = x.presidenteUf.RJ;
      if (p === undefined) throw new Error("sem RJ");
      p.votacao = undefined;
    });
    expect(() => validarSaida(sem)).toThrow(/presidente-uf.json\/RJ: bloco 'votacao' ausente/);
    const pais = comCorrida((x) => {
      const p = x.governadorUf.RJ;
      const nac = x.governador.votacao;
      if (p?.votacao === undefined || nac === undefined) throw new Error("sem RJ");
      p.votacao = { ...p.votacao, contagens: { ...nac.contagens } };
    });
    expect(() => validarSaida(pais)).toThrow(/governador-uf.json/);
  });

  it("`validarSaida` reprova id da corrida que não existe na lista de candidatos [mutação: usar o número de urna no lugar do id do payload]", () => {
    const podre = comCorrida((x) => {
      const e = x.senadorUf.MG?.votacao?.corrida?.[0];
      if (e === undefined) throw new Error("sem MG");
      e.id = 99_999_999;
    });
    expect(() => validarSaida(podre)).toThrow(/sem candidatura de mesmo id/);
  });
});

describe("simulacao-gerar — o painel Votação nas telas de UF (spec 021 RF-192 emendado)", () => {
  const s = gerar();
  const cheio = gerar({ pct: 100 });

  function comUf(f: (saida: ReturnType<typeof gerar>) => void): ReturnType<typeof gerar> {
    const saida = gerar();
    f(saida);
    return saida;
  }

  it("🔴 a 100% a projeção DA UF reencontra o contado DA UF [mutação: projetar a UF com as taxas do país]", () => {
    for (const [nome, mapa] of [
      ["presidente", cheio.presidenteUf],
      ["governador", cheio.governadorUf],
      ["senador", cheio.senadorUf],
    ] as const) {
      for (const c of cheio.ctxs) {
        const v = mapa[c.uf]?.votacao;
        const p = v?.projetada;
        if (v === undefined || p === undefined)
          throw new Error(`${nome}/${c.uf} sem projetada a 100%`);
        for (const k of ["validos", "brancos", "nulos", "abstencao"] as const) {
          const erroRel = Math.abs(p[k] - v.contagens[k]) / Math.max(1, v.contagens[k]);
          expect(erroRel, `${nome}/${c.uf}.${k}: ${p[k]} contra ${v.contagens[k]}`).toBeLessThan(
            0.001,
          );
        }
      }
    }
  });

  it("as UFs projetam com taxas DIFERENTES entre si [premissa do teste acima: sem isso ele não discrimina]", () => {
    const taxas = new Set(
      cheio.ctxs.map((c) => {
        const v = cheio.presidenteUf[c.uf]?.votacao;
        return v?.projetada ? (v.projetada.abstencao / v.contagens.aptos).toFixed(3) : "";
      }),
    );
    expect(taxas.size).toBeGreaterThan(5);
  });

  it("Deputado: cada UF tem `votacao` da UF, sem corrida, e a soma é o nacional [mutação: detalhe sem votacao / com corrida]", () => {
    const soma: Partial<Record<keyof EdgeVotacaoContagens, number>> = {};
    for (const c of s.ctxs) {
      const v = s.deputadoUf[c.uf]?.votacao;
      expect(v, c.uf).toBeDefined();
      expect(v && "corrida" in v, c.uf).toBe(false);
      expect(v?.contagens.aptos, c.uf).toBe(c.eleitores);
      expect(v?.projetada !== undefined, c.uf).toBe(c.pctApurado > 0);
      for (const [k, n] of Object.entries(v?.contagens ?? {})) {
        const kk = k as keyof EdgeVotacaoContagens;
        soma[kk] = (soma[kk] ?? 0) + n;
      }
    }
    expect(soma).toEqual(s.deputado.votacao?.contagens);
  });

  it("`validarSaida` reprova UF cujo arco 1 não fecha em aptos [mutação: a invariante não existir]", () => {
    const podre = comUf((x) => {
      const v = x.senadorUf.BA?.votacao;
      if (v === undefined) throw new Error("sem BA");
      // +1 em `aptos` NÃO serve: a fatia "Ainda não apurado" é `aptos −
      // instalados` e absorve o voto a mais — o arco fecha por identidade.
      // +1 em `validos` quebra a identidade `c = vv + vb + tvn + van + vansj`.
      v.contagens = { ...v.contagens, validos: v.contagens.validos + 1 };
    });
    expect(() => validarSaida(podre)).toThrow(/senador-uf.json\/BA: o arco 1 não fecha/);
  });

  it("`validarSaida` reprova projeção de UF que soma mais que aptos [mutação: a invariante não existir]", () => {
    const podre = comUf((x) => {
      const v = x.governadorUf.PE?.votacao;
      if (v?.projetada === undefined) throw new Error("sem PE projetada");
      v.projetada = { ...v.projetada, validos: v.contagens.aptos };
    });
    expect(() => validarSaida(podre)).toThrow(/governador-uf.json\/PE: residual do círculo 3/);
  });

  it("`validarSaida` confere o arco 3 da UF de Deputado e a soma das 27 contra o nacional [mutação: Deputado fora da conferência]", () => {
    const uf = s.ctxs.find((c) => c.pctApurado > 0)?.uf;
    if (uf === undefined) throw new Error("nenhuma UF apurada");
    const estoura = comUf((x) => {
      const v = x.deputadoUf[uf]?.votacao;
      if (v?.projetada === undefined) throw new Error("sem projetada");
      v.projetada = { ...v.projetada, validos: v.contagens.aptos };
    });
    expect(() => validarSaida(estoura)).toThrow(
      new RegExp(`deputado-uf.json/${uf}: residual do círculo 3`),
    );
    // +1 em `aptos` mantém o arco 1 fechado (a fatia "Ainda não apurado"
    // absorve) — só a soma contra o nacional pega.
    const somaErrada = comUf((x) => {
      const v = x.deputadoUf[uf]?.votacao;
      if (v === undefined) throw new Error("sem UF");
      v.contagens = { ...v.contagens, aptos: v.contagens.aptos + 1 };
    });
    expect(() => validarSaida(somaErrada)).toThrow(/deputado-uf.json: Σ contagens.aptos/);
  });

  it("`validarSaida` reprova UF apurada sem projetada, e Deputado de UF sem votacao ou com corrida", () => {
    const uf = s.ctxs.find((c) => c.pctApurado > 0)?.uf;
    if (uf === undefined) throw new Error("nenhuma UF apurada");
    const semProj = comUf((x) => {
      const v = x.presidenteUf[uf]?.votacao;
      if (v === undefined) throw new Error("sem UF");
      v.projetada = undefined;
    });
    expect(() => validarSaida(semProj)).toThrow(/votacao.projetada ausente com a UF/);

    const depSem = comUf((x) => {
      const d = x.deputadoUf[uf];
      if (d === undefined) throw new Error("sem UF");
      d.votacao = undefined;
    });
    expect(() => validarSaida(depSem)).toThrow(/deputado-uf.json\/\w\w: bloco 'votacao' ausente/);

    const depCorrida = comUf((x) => {
      const d = x.deputadoUf[uf];
      if (d?.votacao === undefined) throw new Error("sem UF");
      (d.votacao as Record<string, unknown>).corrida = [];
    });
    expect(() => validarSaida(depCorrida)).toThrow(/deputado-uf.json.*Deputado não tem colocados/);
  });
});
