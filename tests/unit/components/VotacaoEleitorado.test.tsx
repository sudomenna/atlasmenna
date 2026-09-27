// @vitest-environment happy-dom
/**
 * tests/unit/components/VotacaoEleitorado.test.tsx
 *
 * Unit tests do painel `<VotacaoEleitorado />` — spec 021, os três arcos do
 * eleitorado (RF-192 a RF-198).
 *
 * ## O redesenho de 2026-09-26 e o que estes testes travam
 *
 * O dono viu na tela que o arco 3 (projeção) tinha uma fatia "Ainda não
 * apurado" — contradição, porque a projeção é para o FIM da apuração. Medindo
 * de que a fatia era feita, apareceu um defeito maior: ela misturava DUAS
 * coisas cuja proporção se inverte ao longo da noite (seção por apurar e voto
 * anulado). A 25% apurado o rótulo estava 96% certo no arco 1; às 23h estaria
 * 100% errado.
 *
 * Daí as regras que estes testes discriminam:
 *
 *   - arco 1 tem SEIS fatias, e `nao_apurado = aptos − instalados` — uma
 *     subtração específica, NÃO o resto de tudo. As fixtures fazem os dois
 *     números diferirem em ordens de grandeza, senão o teste não discrimina.
 *   - arco 2 tem CINCO fatias sobre `instalados`.
 *   - arco 3 tem CINCO fatias e **nenhuma** "Ainda não apurado"; o residual
 *     ali se chama "Anulados e sub judice".
 *   - `anulados + sub_judice == 0` ⇒ a fatia nova some dos três arcos.
 *
 * ## Por que os asserts olham `data-abs`/`data-pct` e não só texto
 *
 * O percentual formatado arredonda para uma decimal e sobrevive a mutações de
 * vários dígitos. Os atributos carregam o número bruto (`toFixed(4)`), e é
 * neles que a mutação morre. O texto formatado é verificado à parte, porque é
 * o que o leitor vê.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  angulosDasFatias,
  anuladosTotal,
  type Fatia,
  fatiasCirculo1,
  fatiasCirculo2,
  fatiasCirculo3,
  naoApuradoInstalacao,
  somaQuatro,
  VotacaoEleitorado,
} from "@/components/blocks/VotacaoEleitorado";
import type { EdgeVotacao, EdgeVotacaoContagens } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** Lê o próprio componente — usado pelos testes que são varredura de fonte. */
function readFonte(): string {
  return readFileSync(resolve(process.cwd(), "components/blocks/VotacaoEleitorado.tsx"), "utf8");
}

/**
 * Contagens da captura REAL do simulado do TSE a 100% apurado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`), citada na spec 021.
 *
 * 🔴 Esta fixture é a que mais DISCRIMINA a regra nova do `nao_apurado`:
 *   - pela regra nova (`aptos − instalados`) .......... 267
 *   - pela regra velha (resto de tudo) ......... 19.722.727
 * Quatro ordens de grandeza. Um teste que passasse nas duas não provaria nada.
 */
function contagensReais(over: Partial<EdgeVotacaoContagens> = {}): EdgeVotacaoContagens {
  return {
    aptos: 163_079_139,
    instalados: 163_078_872,
    comparecimento: 138_863_131,
    abstencao: 24_215_741,
    validos: 100_982_116,
    brancos: 9_118_018,
    nulos: 9_040_537,
    anulados: 9_218_887,
    sub_judice: 10_503_573,
    ...over,
  };
}

/**
 * Meio da noite. Satisfaz a identidade do TSE e cumpre, ao mesmo tempo, as
 * DUAS condições que o arco 1 precisa exercitar juntas: `anulados > 0` e
 * `aptos > instalados`.
 *
 *   nao_apurado pela regra nova ....  40.000.000  (aptos − instalados)
 *   nao_apurado pela regra velha ...  53.000.000  (resto de tudo)
 */
function contagensParciais(): EdgeVotacaoContagens {
  return {
    aptos: 100_000_000,
    instalados: 60_000_000,
    comparecimento: 48_000_000,
    abstencao: 12_000_000,
    validos: 30_000_000,
    brancos: 3_000_000,
    nulos: 2_000_000,
    anulados: 8_000_000,
    sub_judice: 5_000_000,
  };
}

/** Fim da noite: tudo instalado (`nao_apurado` zera), mas ainda há anulados. */
function contagensFechadas(): EdgeVotacaoContagens {
  return {
    aptos: 100_000_000,
    instalados: 100_000_000,
    comparecimento: 70_000_000,
    abstencao: 30_000_000,
    validos: 55_000_000,
    brancos: 5_000_000,
    nulos: 5_000_000,
    anulados: 3_000_000,
    sub_judice: 2_000_000,
  };
}

/** Sem anulados nem sub judice — a fatia nova tem de sumir dos três arcos. */
function contagensSemAnulados(): EdgeVotacaoContagens {
  return {
    aptos: 100_000_000,
    instalados: 100_000_000,
    comparecimento: 70_000_000,
    abstencao: 30_000_000,
    validos: 60_000_000,
    brancos: 5_000_000,
    nulos: 5_000_000,
    anulados: 0,
    sub_judice: 0,
  };
}

/** Pré-eleição (RF-193b): `aptos` publicado, nenhuma seção instalada. */
function contagensNaoComecou(): EdgeVotacaoContagens {
  return {
    aptos: 100_000_000,
    instalados: 0,
    comparecimento: 0,
    abstencao: 0,
    validos: 0,
    brancos: 0,
    nulos: 0,
    anulados: 0,
    sub_judice: 0,
  };
}

const SEIS = ["validos", "brancos", "nulos", "anulados", "abstencao", "nao_apurado"] as const;
const CINCO = ["validos", "brancos", "nulos", "anulados", "abstencao"] as const;

// ---------------------------------------------------------------------------
// Aritmética pura
// ---------------------------------------------------------------------------

describe("aritmética das fatias", () => {
  it("🔴 `naoApuradoInstalacao` é `aptos − instalados`, NÃO o resto de tudo", () => {
    // Mutação que morre: voltar ao resto de tudo. Na captura real a diferença
    // é de 267 contra 19.722.727 — quatro ordens de grandeza.
    const c = contagensReais();
    expect(naoApuradoInstalacao(c)).toBe(267);
    const restoDeTudo = c.aptos - (c.validos + c.brancos + c.nulos + c.abstencao);
    expect(restoDeTudo).toBe(19_722_727);
    expect(naoApuradoInstalacao(c)).not.toBe(restoDeTudo);

    // E no meio da noite os dois também diferem (40M contra 53M).
    const p = contagensParciais();
    expect(naoApuradoInstalacao(p)).toBe(40_000_000);
    expect(p.aptos - (p.validos + p.brancos + p.nulos + p.abstencao)).toBe(53_000_000);
  });

  it("`anuladosTotal` soma anulados E sub judice", () => {
    const c = contagensReais();
    expect(anuladosTotal(c)).toBe(19_722_460);
    expect(anuladosTotal(c)).not.toBe(c.anulados);
    expect(anuladosTotal(c)).not.toBe(c.sub_judice);
  });

  it("`somaQuatro` soma só as quatro que a projeção publica", () => {
    expect(somaQuatro({ validos: 1, brancos: 2, nulos: 3, abstencao: 4 })).toBe(10);
  });

  it("🔴 as SEIS fatias fecham em `aptos` por identidade do TSE", () => {
    // Vale na captura real E na parcial, que tem anulados > 0 e
    // aptos > instalados ao mesmo tempo.
    for (const c of [contagensReais(), contagensParciais(), contagensFechadas()]) {
      const f = fatiasCirculo1(c);
      expect(f).not.toBeNull();
      expect((f ?? []).reduce((s, x) => s + x.abs, 0)).toBe(c.aptos);
      expect((f ?? []).reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 10);
    }
  });

  it("🔴 quando a identidade NÃO fecha, o arco devolve null em vez de desenhar", () => {
    // `vscv` (votos sem candidato válido) existe no leiaute e o payload não o
    // carrega: se vier > 0, as seis somam MENOS que `aptos`.
    //
    // ⚠️ A primeira versão deste teste não discriminava nada. Ela somava 500 a
    // `instalados`, o que deixava `aptos − instalados` NEGATIVO — e aí quem
    // barrava era a guarda de negativo, uma linha acima. A checagem de soma
    // nunca era alcançada, e removê-la deixava a suíte verde. Descoberto
    // aplicando a mutação, em 2026-09-26.
    //
    // Este fixture tem `vscv = 1.000.000` com TODAS as seis fatias
    // não-negativas: é o único jeito de a execução chegar na checagem de soma.
    const vscv: EdgeVotacaoContagens = {
      aptos: 100_000_000,
      instalados: 60_000_000,
      comparecimento: 48_000_000, // 1M a mais que as cinco somam
      abstencao: 12_000_000,
      validos: 29_000_000,
      brancos: 3_000_000,
      nulos: 2_000_000,
      anulados: 8_000_000,
      sub_judice: 5_000_000,
    };
    expect(naoApuradoInstalacao(vscv)).toBe(40_000_000); // não-negativo
    expect(fatiasCirculo1(vscv)).toBeNull();

    // E a guarda de negativo continua valendo, por outro caminho.
    expect(fatiasCirculo1(contagensReais({ instalados: 999_999_999_999 }))).toBeNull();
  });

  it("🔴 fatia NEGATIVA com a soma batendo ⇒ null — a guarda de soma não pega isso", () => {
    // Achado aplicando mutação em 2026-09-26: a guarda de negativo e a de soma
    // se cobriam mutuamente nas fixtures anteriores, e cada uma sobrevivia à
    // remoção da outra. Este caso separa as duas.
    //
    // `instalados` MAIOR que `aptos` (payload torto) põe `nao_apurado` em
    // −10.000.000, e mesmo assim as seis somam exatamente `aptos` — a checagem
    // de soma passa e só a guarda de negativo barra. Sem ela, o arco sairia
    // com um setor de ângulo negativo, desenhando errado em silêncio.
    const negativa: EdgeVotacaoContagens = {
      aptos: 100_000_000,
      instalados: 110_000_000,
      comparecimento: 90_000_000,
      abstencao: 20_000_000,
      validos: 60_000_000,
      brancos: 10_000_000,
      nulos: 10_000_000,
      anulados: 5_000_000,
      sub_judice: 5_000_000,
    };
    expect(naoApuradoInstalacao(negativa)).toBe(-10_000_000);
    const seis =
      negativa.validos +
      negativa.brancos +
      negativa.nulos +
      anuladosTotal(negativa) +
      negativa.abstencao +
      naoApuradoInstalacao(negativa);
    expect(seis).toBe(negativa.aptos); // a soma BATE — só o negativo denuncia
    expect(fatiasCirculo1(negativa)).toBeNull();
  });

  it("🔴 arco 2: campo negativo com a soma batendo `instalados` ⇒ null", () => {
    // Mesma armadilha, no arco 2, que não tem `nao_apurado` e por isso precisa
    // do seu próprio caso: `validos` negativo compensado pelos outros.
    const negativa: EdgeVotacaoContagens = {
      aptos: 100_000_000,
      instalados: 60_000_000,
      comparecimento: 48_000_000,
      abstencao: 12_000_000,
      validos: -1_000_000,
      brancos: 20_000_000,
      nulos: 19_000_000,
      anulados: 5_000_000,
      sub_judice: 5_000_000,
    };
    const cinco =
      negativa.validos +
      negativa.brancos +
      negativa.nulos +
      anuladosTotal(negativa) +
      negativa.abstencao;
    expect(cinco).toBe(negativa.instalados); // a soma BATE
    expect(fatiasCirculo2(negativa)).toBeNull();
    // E o arco 1 também recusa, pelo mesmo motivo.
    expect(fatiasCirculo1(negativa)).toBeNull();
  });

  it("`angulosDasFatias` cobre 180° e devolve [] com total zero", () => {
    const fatias: Fatia[] = [
      { key: "validos", label: "v", abs: 50, pct: 50 },
      { key: "abstencao", label: "a", abs: 50, pct: 50 },
    ];
    const angs = angulosDasFatias(fatias, 100);
    expect(angs).toHaveLength(2);
    expect(angs[0]?.inicio).toBeCloseTo(180 + 0.6, 5);
    expect(angs[1]?.fim).toBeCloseTo(360 - 0.6, 5);
    expect(angulosDasFatias(fatias, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Arco 1 — RF-193
// ---------------------------------------------------------------------------

describe("RF-193 — arco 1: seis fatias sobre os aptos", () => {
  const c = contagensParciais();

  it("as seis saem na ordem canônica, com `anulados` entre nulos e abstenção", () => {
    expect((fatiasCirculo1(c) ?? []).map((f) => f.key)).toEqual([...SEIS]);
  });

  it("🔴 o arco fecha em 100% — soma das fatias == total", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const fig = doc.querySelector('[data-testid="votacao-circulo-1"]');
    expect(fig?.getAttribute("data-total")).toBe(String(c.aptos));
    expect(fig?.getAttribute("data-soma-abs")).toBe(String(c.aptos));
  });

  it("🔴 a fatia cinza é `aptos − instalados` — 40M, não os 53M do resto de tudo", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const cinza = doc.querySelector('[data-testid="votacao-circulo-1-fatia-nao_apurado"]');
    expect(cinza?.getAttribute("data-abs")).toBe("40000000");
    expect(cinza?.getAttribute("data-abs")).not.toBe("53000000");
    expect(cinza?.getAttribute("data-pct")).toBe("40.0000");
  });

  it("🔴 `anulados` é fatia NOMEADA, com a soma dos dois campos", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const fatia = doc.querySelector('[data-testid="votacao-circulo-1-fatia-anulados"]');
    expect(fatia?.getAttribute("data-abs")).toBe("13000000");
    const li = doc.querySelector('[data-testid="votacao-circulo-1-legenda-anulados"]');
    expect(li?.textContent ?? "").toContain("Anulados e sub judice");
    expect(li?.textContent ?? "").toContain("13.000.000");
  });

  it("fim da noite: `nao_apurado` zera e a fatia some, mas o arco segue fechando", () => {
    const f = contagensFechadas();
    expect(naoApuradoInstalacao(f)).toBe(0);
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: f }} />);
    expect(doc.querySelector('[data-testid="votacao-circulo-1-fatia-nao_apurado"]')).toBeNull();
    expect(
      doc.querySelector('[data-testid="votacao-circulo-1"]')?.getAttribute("data-soma-abs"),
    ).toBe(String(f.aptos));
    // E `anulados` continua lá, porque anulado não some com o fim da apuração.
    expect(doc.querySelector('[data-testid="votacao-circulo-1-fatia-anulados"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Arco 2 — RF-194
// ---------------------------------------------------------------------------

describe("RF-194 — arco 2: cinco fatias sobre os instalados", () => {
  const c = contagensParciais();

  it("🔴 a base é `instalados`, não `aptos` nem a soma das quatro", () => {
    // Mutação que morre: usar `aptos` (100M) ou a soma-das-quatro (47M).
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const fig = doc.querySelector('[data-testid="votacao-circulo-2"]');
    expect(fig?.getAttribute("data-total")).toBe("60000000");
    expect(fig?.getAttribute("data-total")).not.toBe(String(c.aptos));
    expect(fig?.getAttribute("data-total")).not.toBe("47000000");
  });

  it("cinco fatias, sem `nao_apurado`", () => {
    expect((fatiasCirculo2(c) ?? []).map((f) => f.key)).toEqual([...CINCO]);
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    expect(doc.querySelector('[data-testid="votacao-circulo-2-fatia-nao_apurado"]')).toBeNull();
  });

  it("🔴 os percentuais são sobre a base menor e somam 100", () => {
    const f2 = fatiasCirculo2(c) ?? [];
    // 30M de 60M instalados = 50,0%; sobre aptos seriam 30,0%.
    expect(f2.find((f) => f.key === "validos")?.pct).toBeCloseTo(50, 10);
    const f1 = fatiasCirculo1(c) ?? [];
    expect(f1.find((f) => f.key === "validos")?.pct).toBeCloseTo(30, 10);
    expect(f2.reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100, 10);
  });

  it("o rótulo do arco 2 nunca diz 'eleitores aptos'", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const base2 = doc.querySelector('[data-testid="votacao-circulo-2-base"]')?.textContent ?? "";
    expect(base2).toBe("eleitorado já apurado");
    expect(base2).not.toContain("aptos");
  });

  it("cinco fatias que não somam `instalados` ⇒ estado explícito", () => {
    const torto = contagensParciais();
    torto.instalados = 59_000_000; // as cinco somam 60M
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: torto }} />);
    expect(fatiasCirculo2(torto)).toBeNull();
    expect(doc.querySelector('[data-testid="votacao-circulo-2-inconsistente"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="votacao-circulo-2-sem-base"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Arco 3 — RF-195
// ---------------------------------------------------------------------------

describe("RF-195 — arco 3: projeção, e NENHUMA fatia 'ainda não apurado'", () => {
  const c = contagensParciais();
  const projetada = {
    validos: 50_000_000,
    brancos: 5_000_000,
    nulos: 4_000_000,
    abstencao: 28_000_000,
  }; // soma 87M; residual = 100M − 87M = 13M

  it("🔴 o arco 3 NÃO tem fatia 'Ainda não apurado' — em estado nenhum", () => {
    // O defeito que o dono viu: a projeção é para o FIM da apuração, quando
    // por definição não há seção por apurar. Mutação que morre: reintroduzir
    // a fatia, seja por subtração, seja copiando o arco 1.
    for (const v of [
      { contagens: c, projetada },
      { contagens: contagensFechadas(), projetada },
      { contagens: contagensReais(), projetada },
    ] as EdgeVotacao[]) {
      const doc = parse(<VotacaoEleitorado votacao={v} />);
      expect(doc.querySelector('[data-testid="votacao-circulo-3-fatia-nao_apurado"]')).toBeNull();
      expect(doc.querySelector('[data-testid="votacao-circulo-3-legenda-nao_apurado"]')).toBeNull();
      const legenda =
        doc.querySelector('[data-testid="votacao-circulo-3-legenda"]')?.textContent ?? "";
      expect(legenda).not.toContain("Ainda não apurado");
    }
  });

  it("🔴 o residual do arco 3 se chama 'Anulados e sub judice'", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c, projetada }} />);
    const fatia = doc.querySelector('[data-testid="votacao-circulo-3-fatia-anulados"]');
    expect(fatia?.getAttribute("data-abs")).toBe("13000000");
    const li = doc.querySelector('[data-testid="votacao-circulo-3-legenda-anulados"]');
    expect(li?.textContent ?? "").toContain("Anulados e sub judice");
  });

  it("cinco fatias, na ordem, e o anel fecha em `aptos`", () => {
    expect((fatiasCirculo3(c, projetada) ?? []).map((f) => f.key)).toEqual([...CINCO]);
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c, projetada }} />);
    expect(
      doc.querySelector('[data-testid="votacao-circulo-3"]')?.getAttribute("data-soma-abs"),
    ).toBe(String(c.aptos));
    expect((fatiasCirculo3(c, projetada) ?? []).reduce((s, f) => s + f.pct, 0)).toBeCloseTo(
      100,
      10,
    );
  });

  it("🔴 as projeções entram CRUAS — nenhuma reescala", () => {
    // 50M de 100M aptos = 50,0%. Reescalar para fechar (soma 87M ⇒ fator
    // 1,1494) daria 57,5% e um absoluto de 57.471.264 — votos fabricados.
    const f3 = fatiasCirculo3(c, projetada) ?? [];
    const validos = f3.find((f) => f.key === "validos");
    expect(validos?.abs).toBe(50_000_000);
    expect(validos?.pct).toBeCloseTo(50, 10);
    expect(validos?.pct).not.toBeCloseTo(57.47, 1);
  });

  it("🔴 `projetada` ausente ⇒ 'aguardando' PRESENTE no DOM", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const ag = doc.querySelector('[data-testid="votacao-circulo-3-aguardando"]');
    expect(ag).not.toBeNull();
    expect(ag?.textContent ?? "").toContain("Aguardando projeção");
    expect(doc.querySelector('[data-testid="votacao-circulo-3"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="votacao-circulo-3-legenda"]')).toBeNull();
  });

  it("🔴 projeção que soma MAIS que aptos ⇒ estado explícito, nunca fatia negativa", () => {
    const demais = {
      validos: 90_000_000,
      brancos: 10_000_000,
      nulos: 10_000_000,
      abstencao: 10_000_000,
    };
    expect(fatiasCirculo3(c, demais)).toBeNull();
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c, projetada: demais }} />);
    expect(doc.querySelector('[data-testid="votacao-circulo-3-inconsistente"]')).not.toBeNull();
    // NÃO é "aguardando": o dado chegou, e chegou errado.
    expect(doc.querySelector('[data-testid="votacao-circulo-3-aguardando"]')).toBeNull();
    expect(
      renderToStaticMarkup(<VotacaoEleitorado votacao={{ contagens: c, projetada: demais }} />),
    ).not.toContain("-20.000.000");
  });

  it("a metodologia explica por que o arco 3 não tem 'ainda não apurado'", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensReais(), projetada }} />);
    const met = doc.querySelector('[data-testid="votacao-metodologia"]')?.textContent ?? "";
    expect(met).toContain("sem reescala");
    expect(met).toContain("não existe fatia");
    expect(met).toContain("não chegam a zero");
    expect(met).not.toContain("normalizad");
  });
});

// ---------------------------------------------------------------------------
// anulados == 0
// ---------------------------------------------------------------------------

describe("anulados + sub judice == 0 ⇒ a fatia some dos três arcos", () => {
  const c = contagensSemAnulados();
  // Projeção cujo residual (= anulados projetados) também é zero.
  const projetada = {
    validos: 60_000_000,
    brancos: 5_000_000,
    nulos: 5_000_000,
    abstencao: 30_000_000,
  };

  it("🔴 nenhuma fatia nem linha de legenda de `anulados` em arco nenhum", () => {
    expect(anuladosTotal(c)).toBe(0);
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c, projetada }} />);
    for (const arco of ["votacao-circulo-1", "votacao-circulo-2", "votacao-circulo-3"]) {
      expect(doc.querySelector(`[data-testid="${arco}-fatia-anulados"]`)).toBeNull();
      expect(doc.querySelector(`[data-testid="${arco}-legenda-anulados"]`)).toBeNull();
      const legenda = doc.querySelector(`[data-testid="${arco}-legenda"]`)?.textContent ?? "";
      expect(legenda).not.toContain("Anulados");
    }
  });

  it("e os arcos continuam fechando em 100% sem ela", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c, projetada }} />);
    expect(
      doc.querySelector('[data-testid="votacao-circulo-1"]')?.getAttribute("data-soma-abs"),
    ).toBe(String(c.aptos));
    expect((fatiasCirculo2(c) ?? []).reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100, 10);
  });

  it("a frase de metodologia sobre anulados NÃO aparece (não afirmamos zero)", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const met = doc.querySelector('[data-testid="votacao-metodologia"]')?.textContent ?? "";
    expect(met).not.toContain("anulados e sub judice");
  });
});

// ---------------------------------------------------------------------------
// RF-198 vs RF-193b
// ---------------------------------------------------------------------------

describe("RF-198 vs RF-193b — 'não sabemos' e 'não começou' são estados diferentes", () => {
  it("`votacao` ausente ⇒ <DetailUnavailable>, e NENHUM arco", () => {
    for (const v of [undefined, null]) {
      const doc = parse(<VotacaoEleitorado votacao={v} />);
      expect(doc.querySelector('[data-testid="detail-unavailable"]')).not.toBeNull();
      expect(doc.querySelector('[data-testid="votacao-circulo-1"]')).toBeNull();
      expect(doc.querySelector('[data-testid="votacao-eleitorado"]')).toBeNull();
      // O painel NÃO some — Panel e título continuam lá (RF-198).
      expect(doc.querySelector('[data-testid="panel"]')).not.toBeNull();
    }
  });

  it("🔴 RF-193b — 'não começou' NÃO é <DetailUnavailable>: é o arco 100% cinza", () => {
    // Falha nas DUAS direções: colapsar "não começou" em ausência, ou aceitar
    // ausência como zeros.
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensNaoComecou() }} />);
    expect(doc.querySelector('[data-testid="detail-unavailable"]')).toBeNull();
    const cinza = doc.querySelector('[data-testid="votacao-circulo-1-fatia-nao_apurado"]');
    expect(cinza?.getAttribute("data-abs")).toBe("100000000");
    expect(cinza?.getAttribute("data-pct")).toBe("100.0000");
    for (const k of CINCO) {
      expect(doc.querySelector(`[data-testid="votacao-circulo-1-fatia-${k}"]`)).toBeNull();
    }
  });

  it("🔴 RF-193b — arco 2 sem base: nem NaN, nem '0%' fabricado", () => {
    const c = contagensNaoComecou();
    expect(fatiasCirculo2(c)).toEqual([]);
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: c }} />);
    const semBase = doc.querySelector('[data-testid="votacao-circulo-2-sem-base"]');
    expect(semBase).not.toBeNull();
    expect(semBase?.textContent ?? "").toContain("apuração ainda não começou");
    expect(doc.querySelector('[data-testid="votacao-circulo-2-legenda"]')).toBeNull();
    expect(renderToStaticMarkup(<VotacaoEleitorado votacao={{ contagens: c }} />)).not.toContain(
      "NaN",
    );
  });

  it("RF-193b — o arco 3 cai em 'aguardando'", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensNaoComecou() }} />);
    expect(doc.querySelector('[data-testid="votacao-circulo-3-aguardando"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RF-197
// ---------------------------------------------------------------------------

describe("RF-197 — anulados e sub judice: declarados, e distintos de nulo", () => {
  const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensReais() }} />);
  const met = doc.querySelector('[data-testid="votacao-metodologia"]')?.textContent ?? "";

  it("🔴 a SOMA dos dois é declarada", () => {
    // Mutação que morre: somar só um dos dois campos.
    expect(met).toContain("19.722.460");
    expect(met).toContain("anulados e sub judice");
  });

  it("🔴 o texto explica que anulado NÃO é nulo", () => {
    // São ramos diferentes da árvore do TSE e a tela põe os dois em cinza,
    // lado a lado — sem esta frase o leitor lê como sinônimo.
    expect(met).toContain("não se confundem com voto nulo");
    expect(met).toContain("não escolheu ninguém");
    expect(met).toContain("anulado foi dado a uma candidatura");
  });

  it("o texto diz que 'ainda não apurado' é só seção não instalada", () => {
    expect(met).toContain("seções ainda não");
    expect(met).toContain("e só isso");
  });
});

// ---------------------------------------------------------------------------
// RF-196
// ---------------------------------------------------------------------------

describe("RF-196 — todo percentual vem com o absoluto e a base declarada", () => {
  const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensParciais() }} />);

  it("cada linha traz percentual formatado E número absoluto", () => {
    for (const k of SEIS) {
      const li = doc.querySelector(`[data-testid="votacao-circulo-1-legenda-${k}"]`);
      expect(li, `legenda de ${k}`).not.toBeNull();
      const txt = li?.textContent ?? "";
      expect(txt).toMatch(/\d+,\d%/);
      expect(txt).toMatch(/\d\.\d{3}/);
    }
  });

  it("válidos: 30,0% e 30.000.000 na mesma linha", () => {
    const txt =
      doc.querySelector('[data-testid="votacao-circulo-1-legenda-validos"]')?.textContent ?? "";
    expect(txt).toContain("30,0%");
    expect(txt).toContain("30.000.000");
  });

  it("cada arco declara sua base, e as bases são nomeadas diferente", () => {
    const b1 = doc.querySelector('[data-testid="votacao-circulo-1-base"]')?.textContent ?? "";
    const b2 = doc.querySelector('[data-testid="votacao-circulo-2-base"]')?.textContent ?? "";
    expect(b1).toBe("eleitores aptos");
    expect(b2).toBe("eleitorado já apurado");
    expect(b1).not.toBe(b2);
  });

  it("cada linha carrega a base em `data-base`", () => {
    const li = doc.querySelector('[data-testid="votacao-circulo-2-legenda-validos"]');
    expect(li?.getAttribute("data-base")).toBe("eleitorado já apurado");
  });
});

// ---------------------------------------------------------------------------
// A11y e cor
// ---------------------------------------------------------------------------

describe("a11y e cor", () => {
  const votacao: EdgeVotacao = {
    contagens: contagensReais(),
    projetada: {
      validos: 100_982_116,
      brancos: 9_118_018,
      nulos: 9_040_537,
      abstencao: 24_215_741,
    },
  };
  const markup = renderToStaticMarkup(<VotacaoEleitorado votacao={votacao} />);
  const doc = parse(<VotacaoEleitorado votacao={votacao} />);

  const marcador = (arco: string, k: string) =>
    doc
      .querySelector(`[data-testid="${arco}-legenda-${k}"]`)
      ?.querySelector("span[aria-hidden='true']")
      ?.getAttribute("style") ?? "";

  it("🔴 nenhum `<text>` dentro do SVG — o axe não reprova contraste ali", () => {
    expect(doc.querySelectorAll("svg text").length).toBe(0);
    expect(doc.querySelectorAll("svg tspan").length).toBe(0);
  });

  it('cada SVG é `role="img"` com nome acessível', () => {
    const svgs = [...doc.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.getAttribute("role")).toBe("img");
      expect((svg.getAttribute("aria-label") ?? "").length).toBeGreaterThan(10);
    }
  });

  it("🔴 nenhuma `<table>` com `sr-only` — a tradução textual é a legenda VISÍVEL", () => {
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("sr-only");
    expect(doc.querySelectorAll('[data-testid="votacao-circulo-1-legenda"] li').length).toBe(6);
    expect(doc.querySelectorAll('[data-testid="votacao-circulo-2-legenda"] li').length).toBe(5);
    expect(doc.querySelectorAll('[data-testid="votacao-circulo-3-legenda"] li').length).toBe(5);
  });

  it("🔴 nenhum hex solto e nenhuma cor de partido (constituição § 2)", () => {
    const fonte = readFonte();
    const corpo = fonte.slice(fonte.indexOf("export const FATIA_COR"));
    const mapa = corpo.slice(0, corpo.indexOf("};") + 2);
    expect(mapa).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(mapa).not.toMatch(/--party-|--color-cand-|--color-pt|--color-pl/);
    expect(mapa.match(/var\(--[a-z0-9-]+\)/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("🔴 os TRÊS cinzas se distinguem dois a dois — brancos, nulos e anulados", () => {
    // O kit não tem três tons neutros que passem contraste nos dois temas, e a
    // fatia nova não pode parecer variação de "nulo" (são ramos diferentes da
    // árvore do TSE). Mutação que morre: dar a `anulados` o mesmo padrão de
    // `brancos`, ou nenhum.
    const b = marcador("votacao-circulo-1", "brancos");
    const n = marcador("votacao-circulo-1", "nulos");
    const a = marcador("votacao-circulo-1", "anulados");
    expect(b).toContain("repeating-linear-gradient"); // listras
    expect(a).toContain("radial-gradient"); // pontos
    expect(n).not.toContain("gradient"); // sólido
    expect(b).not.toBe(n);
    expect(a).not.toBe(n);
    expect(a).not.toBe(b);
  });

  it("🔴 `anulados` tem token PRÓPRIO — não herda a cor de brancos/nulos", () => {
    // O anulado está no ramo dos VOTÁVEIS, ao lado dos válidos; o nulo é irmão
    // de votáveis. Herdar a cor dos nulos contradiria a árvore do TSE na tela.
    //
    // ⚠️ Até 2026-09-26 nada afirmava isto: os testes olhavam só o PADRÃO, e
    // trocar o token de `anulados` pelo de brancos/nulos deixava a suíte verde
    // (mutação sobreviveu). É a regra nova mais fácil de desfazer sem perceber.
    const tokenDe = (k: string) =>
      /background:\s*(var\(--[a-z0-9-]+\))/.exec(marcador("votacao-circulo-1", k))?.[1];
    expect(tokenDe("anulados")).toBe("var(--ink-2)");
    expect(tokenDe("nulos")).toBe("var(--color-part-brancos-nulos)");
    expect(tokenDe("brancos")).toBe("var(--color-part-brancos-nulos)");
    expect(tokenDe("anulados")).not.toBe(tokenDe("nulos"));
    expect(tokenDe("anulados")).not.toBe(tokenDe("brancos"));
  });

  it("no arco, cada padrão sai com o seu `data-padrao`", () => {
    const p = (k: string) =>
      doc
        .querySelector(`[data-testid="votacao-circulo-1-padrao-${k}"]`)
        ?.getAttribute("data-padrao");
    expect(p("brancos")).toBe("listras");
    expect(p("anulados")).toBe("pontos");
    expect(p("nulos")).toBeUndefined();
  });

  it("🔴 o `<pattern>` de pontos tem id por arco — id de SVG é global", () => {
    // Três `<pattern id="pontos">` fariam os arcos 2 e 3 pintarem com a
    // definição do arco 1. Mutação que morre: fixar o id.
    const ids = [...doc.querySelectorAll("pattern")].map((p) => p.getAttribute("id"));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("🔴 e por INSTÂNCIA do painel — dois painéis na mesma página não colidem", () => {
    // Achado MEDINDO no navegador em 2026-09-26: com duas instâncias na mesma
    // página os ids se repetiam, e o segundo painel pintaria com a definição
    // do primeiro — silenciosamente, que é a pior forma de errar.
    // Mutação que morre: voltar a montar o id só a partir de `id`.
    const dois = parse(
      <>
        <VotacaoEleitorado votacao={votacao} titleId="painel-a" />
        <VotacaoEleitorado votacao={votacao} titleId="painel-b" />
      </>,
    );
    const ids = [...dois.querySelectorAll("pattern")].map((p) => p.getAttribute("id"));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    // E cada `url(#…)` aponta para um pattern que existe NESTE documento.
    for (const caminho of [...dois.querySelectorAll("path[stroke^='url(']")]) {
      const alvo = (caminho.getAttribute("stroke") ?? "").replace(/^url\(#|\)$/g, "");
      expect(dois.getElementById(alvo), `pattern ${alvo}`).not.toBeNull();
    }
  });

  it("o marcador pálido do residual tem contorno — é ele que dá a borda", () => {
    expect(marcador("votacao-circulo-1", "nao_apurado")).toContain("var(--border-strong)");
  });

  it("o marcador colorido é `aria-hidden` — a cor não carrega informação", () => {
    const li = doc.querySelector('[data-testid="votacao-circulo-1-legenda-validos"]');
    expect(li?.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

describe("RF-192 — o painel", () => {
  it("renderiza em <Panel> próprio, com heading amarrado por aria-labelledby", () => {
    const doc = parse(
      <VotacaoEleitorado
        votacao={{ contagens: contagensParciais() }}
        kicker="Presidente · Brasil"
      />,
    );
    const panel = doc.querySelector('[data-testid="panel"]');
    const id = panel?.getAttribute("aria-labelledby");
    expect(id).toBe("votacao-eleitorado-heading");
    expect(doc.getElementById(id ?? "")?.textContent).toBe("Votação");
    expect(doc.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe(
      "Presidente · Brasil",
    );
  });

  it("os três arcos saem na ordem: aptos, instalados, projeção", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensParciais() }} />);
    const figs = [...doc.querySelectorAll("figure")].map((f) => f.getAttribute("data-testid"));
    expect(figs).toEqual(["votacao-circulo-1", "votacao-circulo-2", "votacao-circulo-3"]);
  });

  it("é Server Component — nenhuma DIRETIVA `use client`", () => {
    const linhas = readFonte().split("\n");
    expect(linhas.filter((l) => /^\s*["']use client["']\s*;?\s*$/.test(l))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fundo opaco do rótulo central (2026-09-26) — o que deixa o axe medir
// ---------------------------------------------------------------------------

describe("rótulo central do arco — fundo opaco para o axe", () => {
  // Sem este fundo, o axe desce a pilha de fundo a partir do texto, encontra o
  // `<svg>` do arco antes de qualquer cor opaca e joga o nó em `incomplete`
  // (`imgNode`) — 24 casos reprovados no portão e2e de 26/09. O texto tem de
  // estar DENTRO de um elemento inline pintado com a superfície da página.
  it("🔴 o número e a base de cada arco vivem num inline com --surface-page", () => {
    const doc = parse(<VotacaoEleitorado votacao={{ contagens: contagensParciais() }} />);
    for (const n of [1, 2]) {
      for (const parte of ["total", "base"]) {
        const el = doc.querySelector(`[data-testid="votacao-circulo-${n}-${parte}"]`);
        const span = el?.firstElementChild as HTMLElement | null;
        expect(span?.tagName, `${n}-${parte}`).toBe("SPAN");
        expect(el?.childNodes.length, `${n}-${parte}: texto solto fora do span`).toBe(1);
        expect(span?.getAttribute("style") ?? "").toMatch(/background:\s*var\(--surface-page\)/);
      }
    }
  });
});
