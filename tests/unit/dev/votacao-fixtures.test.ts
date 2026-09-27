/**
 * tests/unit/dev/votacao-fixtures.test.ts
 *
 * O bloco `votacao` (spec 021) chegou aos ARQUIVOS de `tests/fixtures/simulacao/`,
 * não só ao gerador que os escreve.
 *
 * ===========================================================================
 * 🔴 Por que este arquivo existe separado dos testes do gerador
 * ===========================================================================
 *
 * `tests/unit/data-pipeline/simulacao-gerar.test.ts` prova que as FUNÇÕES
 * emitem o bloco. Isso não é a mesma coisa que o bloco estar no disco: entre
 * as duas há um comando que alguém precisa rodar (`pnpm sim:full`), e foi
 * exatamente essa fresta que produziu o defeito de 2026-09-26.
 *
 * Naquele dia o gerador já emitia `votacao`, os testes do gerador estavam
 * verdes, e o dono abriu `pnpm dev:sim` e viu **"A votação do eleitorado está
 * indisponível"** nas quatro telas — porque os arquivos em disco eram de
 * 21/09, cinco dias mais velhos que o código. A tela estava certa (RF-198:
 * bloco ausente vira `<DetailUnavailable>`, nunca zeros); o que faltava era a
 * regeração.
 *
 * ⚠️ Este arquivo é a única coisa que torna essa fresta VERMELHA em vez de
 * silenciosa. Sem ele, rodar `pnpm sim` sozinho (em vez de `sim:full`), ou uma
 * regressão futura no gerador, tira o painel do ar no simulado e a suíte
 * inteira continua verde — e quem for conferir vai achar que o componente
 * quebrou, não a fixture.
 *
 * ⚠️ **Se este teste ficar vermelho, a correção quase sempre é regenerar, não
 * mexer no código**: `set -a; . ./.env.local; set +a; pnpm sim:full` (NUNCA
 * `pnpm sim` sozinho — ele apaga a série da evolução e quebra 8 testes,
 * `CLAUDE.md § 12`).
 */

import { describe, expect, it } from "vitest";

import deputado from "../../../tests/fixtures/simulacao/deputado.json";
import governador from "../../../tests/fixtures/simulacao/governador.json";
import presidente from "../../../tests/fixtures/simulacao/presidente.json";
import senador from "../../../tests/fixtures/simulacao/senador.json";

interface Contagens {
  aptos: number;
  instalados: number;
  comparecimento: number;
  abstencao: number;
  validos: number;
  brancos: number;
  nulos: number;
  anulados: number;
  sub_judice: number;
}

/** Os quatro payloads nacionais que o RF-192 manda exibir o painel. */
const CARGOS: ReadonlyArray<readonly [string, { votacao?: { contagens?: Contagens } }]> = [
  ["presidente", presidente as never],
  ["governador", governador as never],
  ["senador", senador as never],
  ["deputado", deputado as never],
];

describe("fixtures do simulado — o bloco `votacao` está no DISCO (spec 021)", () => {
  for (const [nome, payload] of CARGOS) {
    it(`${nome}.json tem \`votacao.contagens\` com as 9 contagens`, () => {
      const c = payload.votacao?.contagens;
      expect(
        c,
        `\`${nome}.json\` não tem o bloco \`votacao\`. O painel "Votação" cai em ` +
          "`<DetailUnavailable>` no `pnpm dev:sim`. Quase sempre a correção é " +
          "REGENERAR, não mexer no código: `pnpm sim:full` (nunca `pnpm sim` sozinho).",
      ).toBeDefined();
      const contagens = c as Contagens;

      for (const campo of [
        "aptos",
        "instalados",
        "comparecimento",
        "abstencao",
        "validos",
        "brancos",
        "nulos",
        "anulados",
        "sub_judice",
      ] as const) {
        expect(Number.isInteger(contagens[campo]), `${nome}.${campo} não é inteiro`).toBe(true);
        expect(contagens[campo], `${nome}.${campo} é negativo`).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${nome}.json obedece às duas identidades do EA20`, () => {
      const c = payload.votacao?.contagens as Contagens;
      // Do dicionário oficial do TSE
      // (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`).
      // Estas duas são o que separa "o gerador inventou números" de "o gerador
      // fabricou uma apuração coerente" — e é a checagem que, no dado real,
      // fecha na UNIDADE.
      expect(
        c.comparecimento + c.abstencao,
        `${nome}: comparecimento + abstenção tem de ser o eleitorado das seções instaladas`,
      ).toBe(c.instalados);
      // No Senado de 2 vagas cada eleitor deposita DOIS votos: os campos de
      // voto somam `2 × comparecimento` (spec 022 RF-210 — medido nas capturas
      // reais do TSE, `tv == 2 × c` exato). O fator vem do payload, como a
      // tela o lê; ausente vale 1.
      const k =
        (payload as { composicao_vagas?: { vagas_por_uf?: number } }).composicao_vagas
          ?.vagas_por_uf ?? 1;
      expect(
        c.validos + c.brancos + c.nulos + c.anulados + c.sub_judice,
        `${nome}: válidos + brancos + nulos + anulados + sub judice tem de ser ${k} × o comparecimento`,
      ).toBe(k * c.comparecimento);
    });
  }

  it("o eleitorado apto é o MESMO nos quatro cargos", () => {
    // Quem pode votar é um fato do país, não de cada disputa. Quatro telas do
    // mesmo site declarando eleitorados diferentes é a contradição que a
    // constituição § 6 proíbe — e ela seria invisível olhando uma tela de cada
    // vez, que é como se confere na prática.
    const aptos = CARGOS.map(([nome, p]) => [nome, p.votacao?.contagens?.aptos] as const);
    const distintos = new Set(aptos.map(([, v]) => v));
    expect(distintos.size, `aptos divergentes entre cargos: ${JSON.stringify(aptos)}`).toBe(1);
  });

  it("há apuração parcial de verdade — `aptos > instalados`", () => {
    // 🔴 Guarda contra a fixture que não discrimina. Se o gerador emitisse
    // `aptos == instalados`, a fatia "Ainda não apurado" do círculo 1 sairia
    // ZERO em todas as telas, e o `dev:sim` nunca mostraria o estado que a
    // spec 021 inteira existe para representar — com a suíte verde. É a mesma
    // família da armadilha de 2026-09-21, em que três mutações sobreviveram
    // por coincidência do dado de teste.
    for (const [nome, p] of CARGOS) {
      const c = p.votacao?.contagens as Contagens;
      expect(
        c.aptos,
        `${nome}: sem eleitorado não apurado, o círculo 1 não tem o que mostrar`,
      ).toBeGreaterThan(c.instalados);
    }
  });

  it("há votos anulados/sub judice — senão o buraco do RF-197 fica invisível", () => {
    // O gerador não tinha conceito de anulado até 2026-09-26. Emitir zero
    // deixaria a fixture MAIS POBRE que produção: no dado real do TSE
    // `anulados + sub_judice` vale ~14% do comparecimento, e é por causa deles
    // que o cinza do círculo 3 não vai a zero no fim da noite (RF-195).
    for (const [nome, p] of CARGOS) {
      const c = p.votacao?.contagens as Contagens;
      expect(
        c.anulados + c.sub_judice,
        `${nome}: sem anulados, o simulado esconde o buraco que produção tem`,
      ).toBeGreaterThan(0);
    }
  });
});
