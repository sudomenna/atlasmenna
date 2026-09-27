/**
 * Spec 022 (RF-209) — quanto o bloco da corrida custa no Global Config.
 *
 * ## Por que o número mora num teste, e não num relatório
 *
 * Três vezes neste repositório um tamanho de payload foi estimado e saiu
 * errado (amostra aleatória, `round` que devolveu 4 caracteres, nome acentuado
 * que custa 2 bytes por letra). A regra que ficou: forçar o PIOR caso de CADA
 * campo e pôr o número onde ele quebra alto quando o contrato mudar.
 *
 * ## O que é o pior caso aqui
 *
 * - toda contagem e todo `votos` com 9 dígitos (999.999.999 — acima do
 *   eleitorado do país inteiro, 158 milhões);
 * - `id` com 5 dígitos (o simulado usa ids sequenciais por UF, 27000+; o TSE
 *   usa 2 ou 3);
 * - sigla com 20 caracteres ASCII (a maior sigla real do cadastro de 2026 tem
 *   13 — `SOLIDARIEDADE`, medido nas fixtures do simulado; siglas não têm
 *   acento);
 * - `destino: "sub_judice"`, o valor mais longo, em TODA entrada;
 * - `destino_pendente: true` presente.
 *
 * Onde o bloco vai: `votacao` de `EdgePayloadUf` fica no RESUMO que
 * `splitUfPayload` (`lib/blob/uf-detail.ts:123`) manda para o Global Config —
 * só `municipios` e `series_temporais` vão para o Blob. Por isso ele conta no
 * limiar de 20 KiB por UF e no store inteiro.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  EdgeCorridaEntrada,
  EdgeCorridaPartido,
  EdgeVotacaoContagens,
  EdgeVotacaoUf,
} from "@/lib/edge-config/types";
import { GLOBAL_CONFIG_STORE_LIMIT_BYTES, limiarNacionalBytes } from "@/lib/edge-config/writer";

const RAIZ = process.cwd();
const WRITER = readFileSync(resolve(RAIZ, "lib/edge-config/writer.ts"), "utf8");

/** Lê uma constante NÃO exportada do writer — o teste quebra se ela mudar. */
function constanteDoWriter(nome: string): number {
  const m = WRITER.match(new RegExp(`const ${nome} = ([0-9_ *]+);`));
  if (m === null) throw new Error(`${nome} sumiu de lib/edge-config/writer.ts`);
  // Só produto de inteiros (`20 * 1024`, `780_000`) — é o que o writer usa.
  return (m[1] as string)
    .split("*")
    .map((x) => Number(x.replaceAll("_", "").trim()))
    .reduce((a, b) => a * b, 1);
}
const UF_WARN = constanteDoWriter("EDGE_CONFIG_UF_WARN_BYTES");
const STORE_WARN = constanteDoWriter("GLOBAL_CONFIG_STORE_WARN_BYTES");

const NOVE = 999_999_999;
const SIGLA_PIOR = "X".repeat(20);

function contagensPior(): EdgeVotacaoContagens {
  return {
    aptos: NOVE,
    instalados: NOVE,
    comparecimento: NOVE,
    abstencao: NOVE,
    validos: NOVE,
    brancos: NOVE,
    nulos: NOVE,
    anulados: NOVE,
    sub_judice: NOVE,
  };
}

function entradaPior(): EdgeCorridaEntrada {
  return { id: 99_999, partido: SIGLA_PIOR, votos: NOVE, destino: "sub_judice" };
}

function votacaoUfPior(n: number): EdgeVotacaoUf {
  return {
    contagens: contagensPior(),
    corrida: Array.from({ length: n }, entradaPior),
    destino_pendente: true,
  };
}

/** Custo em bytes de acrescentar `"votacao": <bloco>` a um objeto não vazio. */
function custoDaChave(bloco: unknown): number {
  return Buffer.byteLength(`,"votacao":${JSON.stringify(bloco)}`);
}

function lerFixture<T>(nome: string): T {
  return JSON.parse(readFileSync(resolve(RAIZ, `tests/fixtures/simulacao/${nome}`), "utf8")) as T;
}

type UfFixture = Record<
  string,
  { candidatos: unknown[]; municipios?: unknown; series_temporais?: unknown }
>;

/** O que `splitUfPayload` deixa no Global Config: tudo menos o detalhe. */
function resumoUf(p: UfFixture[string]): string {
  const { municipios: _m, series_temporais: _s, ...resumo } = p;
  return JSON.stringify(resumo);
}

describe("spec 022 — bytes do bloco da corrida", () => {
  it("🔴 o pior caso por UF é 244 + 87·n bytes (números medidos; mudar o contrato quebra aqui)", () => {
    // Mutação que morre: qualquer campo novo no contrato, ou `destino` ficar
    // mais longo, sem remedir o orçamento abaixo.
    expect(Buffer.byteLength(JSON.stringify(votacaoUfPior(0)))).toBe(244);
    expect(Buffer.byteLength(JSON.stringify(votacaoUfPior(12)))).toBe(1_287);
    expect(Buffer.byteLength(JSON.stringify(votacaoUfPior(18)))).toBe(1_809);
    expect(Buffer.byteLength(JSON.stringify(votacaoUfPior(60)))).toBe(5_463);
  });

  it("o limiar de 20 KiB por UF é o que este arquivo supõe", () => {
    expect(UF_WARN).toBe(20 * 1024);
    expect(STORE_WARN).toBe(780_000);
    expect(STORE_WARN).toBeLessThan(GLOBAL_CONFIG_STORE_LIMIT_BYTES);
  });

  it("🔴 toda UF real, com o bloco no pior caso, fica abaixo de 20 KiB — mesmo com 60 candidaturas", () => {
    // 60 = ~30 partidos com 2 candidaturas cada ao Senado. O maior elenco real
    // por UF nas fixtures é 18 (Senado, PI).
    const reprovas: string[] = [];
    for (const arquivo of ["presidente-uf.json", "governador-uf.json", "senador-uf.json"]) {
      for (const [uf, p] of Object.entries(lerFixture<UfFixture>(arquivo))) {
        const base = Buffer.byteLength(resumoUf(p));
        for (const n of [p.candidatos.length, 60]) {
          const total = base + custoDaChave(votacaoUfPior(n));
          if (total > UF_WARN) reprovas.push(`${arquivo}/${uf} n=${n}: ${total} B`);
        }
      }
    }
    expect(reprovas).toEqual([]);
  });

  it("🔴 os payloads nacionais reais, com a corrida no pior caso, seguem abaixo do limiar E com folga > 2×", () => {
    // Presidente ganha `corrida` (13 = elenco da captura real do TSE);
    // Governador/Senador ganham `corrida_por_partido` com 35 siglas (29 no
    // cadastro de 2026). A folga > 2× é a que
    // `tests/unit/edge-config/limiar-nacional.test.ts` exige dos payloads
    // reais — o acréscimo não pode ser o que a derruba quando a fixture for
    // regenerada.
    const corrida = Array.from({ length: 13 }, entradaPior);
    const partidos: EdgeCorridaPartido[] = Array.from({ length: 35 }, () => ({
      partido: SIGLA_PIOR,
      votos_validos: NOVE,
    }));
    const extra: Record<string, number> = {
      "presidente.json": Buffer.byteLength(`,"corrida":${JSON.stringify(corrida)}`),
      "governador.json": Buffer.byteLength(`,"corrida_por_partido":${JSON.stringify(partidos)}`),
      "senador.json": Buffer.byteLength(`,"corrida_por_partido":${JSON.stringify(partidos)}`),
    };
    expect(extra["presidente.json"]).toBe(1_143);
    expect(extra["governador.json"]).toBe(2_159);
    for (const [arquivo, acrescimo] of Object.entries(extra)) {
      const d = lerFixture<{ national?: { candidatos?: unknown[] } }>(arquivo);
      const bytes = Buffer.byteLength(JSON.stringify(d)) + acrescimo;
      const limiar = limiarNacionalBytes(d.national?.candidatos?.length ?? 0);
      expect(bytes, arquivo).toBeLessThan(limiar);
      expect(limiar / bytes, `folga de ${arquivo}`).toBeGreaterThan(2);
    }
  });

  it("🔴 o store inteiro, com o bloco em TODAS as 81 chaves de UF no pior caso, fica abaixo do aviso de 780 KB", () => {
    // Base: o que as fixtures do simulado ocupam HOJE no Global Config — os 4
    // nacionais e o resumo das 81 UFs majoritárias (Deputado por UF vai para o
    // Blob inteiro, `writeDeputadoProjection`). Não inclui chaves avulsas de
    // configuração, que são pequenas; por isso a checagem exige uma folga de
    // 100 KB abaixo do aviso, não só "abaixo".
    let base = 0;
    for (const arquivo of ["presidente.json", "governador.json", "senador.json", "deputado.json"]) {
      base += Buffer.byteLength(JSON.stringify(lerFixture(arquivo)));
    }
    let acrescimo = 0;
    for (const arquivo of ["presidente-uf.json", "governador-uf.json", "senador-uf.json"]) {
      for (const p of Object.values(lerFixture<UfFixture>(arquivo))) {
        base += Buffer.byteLength(resumoUf(p));
        acrescimo += custoDaChave(votacaoUfPior(p.candidatos.length));
      }
    }
    // Nacionais: a corrida e as duas somas por partido, no pior caso.
    acrescimo += 1_143 + 2 * 2_159;
    expect(base + acrescimo + 100_000).toBeLessThan(STORE_WARN);
    // O número, para quem ler o log do teste: ~90 KB de acréscimo.
    expect(acrescimo).toBeLessThan(100_000);
  });
});
