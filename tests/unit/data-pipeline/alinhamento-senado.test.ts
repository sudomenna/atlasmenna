// Alinhamento do Senado — `data-pipeline/alinhamento-senado.ts`.
//
// Roda sobre as fixtures enxutas de `tests/fixtures/senado/` (formato real da
// API, valores sintéticos). A janela tem 11 votações escolhidas para que cada
// regra do funil seja exercida por UM caso:
//
//   1001  Governo SIM  × Oposição NÃO        → disputada
//   1002  Governo NÃO  × Oposição SIM        → disputada
//   1003  Governo SIM  × Oposição SIM        → consenso (não disputada)
//   1004  Governo NÃO  × Oposição LIVRE      → não disputada
//   1005  Governo LIVRE                      → fora do universo
//   1006  Governo SIM  × Oposição OBSTRUÇÃO  → disputada
//   ----  aberta, sem sequencialVotacao      → excluída e contada
//   1008  secreta                            → fora
//   1009  sessão do Congresso (CN)           → fora
//   1010  sem nenhuma orientação             → fora
//   1011  Governo SIM  × Oposição NÃO        → disputada (é a última: define o corte)
//
// Os seis senadores (9001–9006) foram montados para que a mutação de cada
// regra mude o número de alguém — ver os "MUTAÇÃO ALVO" abaixo.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calcularAlinhamento,
  classificarVotacao,
  FONTE_ALINHAMENTO_SENADO,
  indexarOrientacoes,
  janelasSemestrais,
  montarArquivoAlinhamento,
  orientacaoDaBancada,
  orientacaoNormalizada,
  taxaComUmaCasa,
  votoContado,
} from "@/data-pipeline/alinhamento-senado.ts";
import { parseOrientacoes, parseVotacoes } from "@/data-pipeline/senado-parse.ts";

const lerFixture = (nome: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/senado", nome), "utf8"));

const votacoes = parseVotacoes(lerFixture("votacoes-janela.json"));
const orientacoes = indexarOrientacoes(parseOrientacoes(lerFixture("orientacoes-janela.json")));
const JANELA = { inicio: "2025-01-01", fim: "2025-12-31" };
const rodar = (extra: Partial<Parameters<typeof calcularAlinhamento>[2]> = {}) =>
  calcularAlinhamento(votacoes, orientacoes, { ...JANELA, ...extra });

const linha = (r: ReturnType<typeof rodar>, codigo: number) =>
  r.senadores.find((s) => s.codigo === codigo);

// ---------------------------------------------------------------------------
// Normalização e classificação da votação
// ---------------------------------------------------------------------------

describe("orientacaoNormalizada / orientacaoDaBancada", () => {
  it("normaliza caixa, acento e vazio", () => {
    expect(orientacaoNormalizada("SIM")).toBe("SIM");
    expect(orientacaoNormalizada("NÃO")).toBe("NAO");
    expect(orientacaoNormalizada("nao")).toBe("NAO");
    expect(orientacaoNormalizada("LIVRE")).toBe("LIVRE");
    expect(orientacaoNormalizada("OBSTRUÇÃO")).toBe("OBSTRUCAO");
    expect(orientacaoNormalizada(null)).toBe("AUSENTE");
    expect(orientacaoNormalizada("  ")).toBe("AUSENTE");
    expect(orientacaoNormalizada("TALVEZ")).toBe("OUTRA");
  });

  it("acha a bancada por nome sem acento nem espaço sobrando", () => {
    const o = [
      { partido: "PT", voto: "SIM" },
      { partido: " Governo ", voto: "NÃO" },
      { partido: "Oposição", voto: "SIM" },
    ];
    expect(orientacaoDaBancada(o, "governo")).toBe("NAO");
    expect(orientacaoDaBancada(o, "oposicao")).toBe("SIM");
    // "PT" com orientação SIM não é a bancada do Governo.
    expect(orientacaoDaBancada([{ partido: "PT", voto: "SIM" }], "governo")).toBe("AUSENTE");
  });

  it("duas entradas da mesma bancada com orientações diferentes lançam", () => {
    expect(() =>
      orientacaoDaBancada(
        [
          { partido: "Governo", voto: "SIM" },
          { partido: "Governo", voto: "NÃO" },
        ],
        "governo",
      ),
    ).toThrow(/conflitantes/);
  });
});

describe("classificarVotacao — universo e disputada", () => {
  const c = (gov: string | null, opo: string | null) =>
    classificarVotacao([
      { partido: "Governo", voto: gov },
      { partido: "Oposição", voto: opo },
    ]);

  it("Governo SIM/NÃO entra no universo; LIVRE e ausente, não", () => {
    expect(c("SIM", "SIM").noUniverso).toBe(true);
    expect(c("NÃO", "SIM").noUniverso).toBe(true);
    expect(c("LIVRE", "NÃO").noUniverso).toBe(false);
    expect(c(null, "NÃO").noUniverso).toBe(false);
  });

  // MUTAÇÃO ALVO: `!==` → `===` (disputada quando a Oposição CONCORDA), ou
  // remover a checagem de "oposto".
  it("disputada = Oposição orientou o contrário do Governo", () => {
    expect(c("SIM", "NÃO").disputada).toBe(true);
    expect(c("NÃO", "SIM").disputada).toBe(true);
    expect(c("SIM", "SIM").disputada).toBe(false);
    expect(c("NÃO", "NÃO").disputada).toBe(false);
  });

  // MUTAÇÃO ALVO: tratar Oposição LIVRE/ausente como "oposta".
  it("Oposição LIVRE ou sem orientação NÃO torna a votação disputada", () => {
    expect(c("SIM", "LIVRE").disputada).toBe(false);
    expect(c("SIM", null).disputada).toBe(false);
  });

  it("Oposição em OBSTRUÇÃO torna a votação disputada (o Senado tem essa orientação)", () => {
    expect(c("SIM", "OBSTRUÇÃO").disputada).toBe(true);
    expect(c("NÃO", "OBSTRUÇÃO").disputada).toBe(true);
  });

  // MUTAÇÃO ALVO: `noUniverso && (…)` → `(…)` (Governo LIVRE × Oposição NÃO
  // viraria "disputada").
  it("fora do universo nunca é disputada, mesmo com a Oposição orientando algo", () => {
    expect(c("LIVRE", "NÃO").disputada).toBe(false);
    expect(c("LIVRE", "OBSTRUÇÃO").disputada).toBe(false);
  });
});

describe("votoContado", () => {
  it("só Sim, Não, Abstenção e Obstrução entram na conta", () => {
    expect(votoContado("Sim")).toBe("SIM");
    expect(votoContado("Não")).toBe("NAO");
    expect(votoContado("Abstenção")).toBe("ABSTENCAO");
    expect(votoContado("Obstrução")).toBe("OBSTRUCAO");
  });

  it("ausências, presidente da sessão, P-NRV e voto secreto ficam de fora", () => {
    for (const s of [
      "AP",
      "MIS",
      "LS",
      "LP",
      "NCom",
      "NA",
      "P-NRV",
      "Presidente (art. 51 RISF)",
      "Votou",
      null,
      "",
    ]) {
      expect(votoContado(s)).toBeNull();
    }
  });

  it("`extras` faz uma sigla contar contra (só a sensibilidade usa)", () => {
    expect(votoContado("P-NRV", ["P-NRV"])).toBe("EXTRA");
    expect(votoContado("AP", ["P-NRV"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Funil e taxas sobre a janela de fixtures
// ---------------------------------------------------------------------------

describe("calcularAlinhamento — o funil", () => {
  const r = rodar();

  it("universo: 6 votações, 4 disputadas, 1 sem sequencial", () => {
    expect(r.universo).toEqual({ votacoes: 6, disputadas: 4, excluidas_sem_sequencial: 1 });
  });

  it("cada descarte tem o seu contador (nada some em silêncio)", () => {
    expect(r.diagnostico).toMatchObject({
      votacoes_na_janela: 11,
      secretas: 1,
      fora_do_plenario_do_senado: 1,
      abertas_nominais: 9,
      sem_sequencial: 1,
      sem_orientacao_do_governo: 1,
      governo_livre: 1,
      no_universo: 6,
      disputadas: 4,
    });
    // Conserva: tudo o que entrou na janela foi contado em exatamente um destino.
    const d = r.diagnostico;
    expect(
      d.secretas +
        d.fora_do_plenario_do_senado +
        d.sem_sequencial +
        d.sem_orientacao_do_governo +
        d.governo_livre +
        d.governo_outra +
        d.no_universo,
    ).toBe(d.votacoes_na_janela);
  });

  it("o corte é a data da última votação do UNIVERSO, não da última da janela", () => {
    // 2025-04-09 (1011). A janela tem votações até 04-09 também, mas 1010 (04-08)
    // está fora do universo e a secreta/CN (04-06/04-07) idem.
    expect(r.corte).toBe("2025-04-09");
    // Sem a 1011 o corte recua para a última que ainda está no universo (1006, 04-04).
    const semUltima = calcularAlinhamento(
      votacoes.filter((v) => v.sequencialVotacao !== 1011),
      orientacoes,
      JANELA,
    );
    expect(semUltima.corte).toBe("2025-04-04");
  });

  it("a janela de datas filtra (inclusive nas pontas)", () => {
    const a = rodar({ inicio: "2025-03-12", fim: "2025-04-01" });
    expect(a.diagnostico.votacoes_na_janela).toBe(2); // 1002 (03-12) e 1003 (04-01)
    expect(a.universo.votacoes).toBe(2);
    expect(a.universo.disputadas).toBe(1);
  });

  it("universo vazio: corte nulo, e montar o arquivo lança", () => {
    const vazio = rodar({ inicio: "2030-01-01", fim: "2030-12-31" });
    expect(vazio.corte).toBeNull();
    expect(() => montarArquivoAlinhamento(vazio)).toThrow(/universo vazio/);
  });

  it("a mesma votação em duas janelas de cache conta uma vez", () => {
    const dobrado = calcularAlinhamento([...votacoes, ...votacoes], orientacoes, JANELA);
    expect(dobrado.universo).toEqual({ votacoes: 6, disputadas: 4, excluidas_sem_sequencial: 1 });
    expect(linha(dobrado, 9001)?.votosDisputadas).toBe(4);
  });

  it("voto repetido do mesmo senador na mesma votação conta uma vez (e é contado)", () => {
    const v1 = votacoes.find((v) => v.sequencialVotacao === 1001);
    if (!v1) throw new Error("fixture sem a 1001");
    const dup = { ...v1, votos: [...v1.votos, ...v1.votos.slice(0, 1)] };
    const r2 = calcularAlinhamento(
      votacoes.map((v) => (v === v1 ? dup : v)),
      orientacoes,
      JANELA,
    );
    expect(r2.diagnostico.votos_repetidos_no_mesmo_registro).toBe(1);
    expect(linha(r2, 9001)?.votosDisputadas).toBe(4);
  });

  it("sequencial com orientações diferentes em duas janelas lança", () => {
    expect(() =>
      indexarOrientacoes([
        { sequencialVotacao: 1, orientacoesLideranca: [{ partido: "Governo", voto: "SIM" }] },
        { sequencialVotacao: 1, orientacoesLideranca: [{ partido: "Governo", voto: "NÃO" }] },
      ]),
    ).toThrow(/orientações diferentes/);
  });
});

describe("calcularAlinhamento — a taxa por senador (só nas disputadas)", () => {
  const r = rodar();

  // MUTAÇÃO ALVO: descartar o filtro de disputada. Com as 6 votações do
  // universo, 9001 teria 6 votos (não 4) e 9004 (que só vota Sim nas
  // consensuais) subiria de 33,3.
  it("9001: alinhou nas 4 disputadas → 100,0 (o denominador é 4, não 6)", () => {
    expect(linha(r, 9001)).toEqual({
      codigo: 9001,
      votosDisputadas: 4,
      alinhadasDisputadas: 4,
      taxaDisputadas: 100,
    });
  });

  it("9002: contra o Governo em todas → 0,0; o P-NRV da 1006 não entra no denominador", () => {
    expect(linha(r, 9002)).toMatchObject({
      votosDisputadas: 3,
      alinhadasDisputadas: 0,
      taxaDisputadas: 0,
    });
  });

  // MUTAÇÃO ALVO: abstenção contada como alinhada (`|| contado === "ABSTENCAO"`)
  // → 9003 iria de 3/4 = 75,0 para 4/4 = 100,0. E abstenção fora do denominador
  // daria 3/3 = 100,0.
  it("9003: a ABSTENÇÃO conta contra — entra no denominador e nunca no numerador → 75,0", () => {
    expect(linha(r, 9003)).toEqual({
      codigo: 9003,
      votosDisputadas: 4,
      alinhadasDisputadas: 3,
      taxaDisputadas: 75,
    });
  });

  it("9004: P-NRV na 1001 fica de fora; Sim/Não/Sim contra e a favor → 33,3", () => {
    expect(linha(r, 9004)).toMatchObject({
      votosDisputadas: 3,
      alinhadasDisputadas: 1,
      taxaDisputadas: 33.3,
    });
  });

  it("9005: AP e LS (ausências) ficam de fora → 1 de 2 = 50,0", () => {
    expect(linha(r, 9005)).toMatchObject({
      votosDisputadas: 2,
      alinhadasDisputadas: 1,
      taxaDisputadas: 50,
    });
  });

  // MUTAÇÃO ALVO: contar "Presidente (art. 51)" como voto.
  it("9006, o presidente da sessão, não tem linha (nenhum voto contou)", () => {
    expect(linha(r, 9006)).toBeUndefined();
    expect(r.senadores.map((s) => s.codigo)).toEqual([9001, 9002, 9003, 9004, 9005]);
    // Mas ele estava presente no universo:
    expect(r.diagnostico.senadores_no_universo).toBe(6);
    expect(r.diagnostico.senadores_com_voto_em_disputada).toBe(5);
  });

  // MUTAÇÃO ALVO: LIVRE dentro do universo. A 1005 (Governo LIVRE × Oposição NÃO)
  // passaria a "disputada" e todos votaram Sim nela: 9002 (0 → 1 alinhada de 4).
  it("Governo LIVRE fica de fora: a 1005 não muda ninguém", () => {
    const semLivre = calcularAlinhamento(
      votacoes.filter((v) => v.sequencialVotacao !== 1005),
      orientacoes,
      JANELA,
    );
    expect(semLivre.senadores).toEqual(r.senadores);
  });

  // MUTAÇÃO ALVO: tirar `|| oposicao === "OBSTRUCAO"` — a 1006 deixaria de ser disputada.
  it("a obstrução da Oposição torna a 1006 disputada: quem votou nela entra na conta", () => {
    // 9003 votou Sim (alinhado) na 1006; sem ela (só 1001, 1002, 1011) seria 2/3.
    expect(linha(r, 9003)?.votosDisputadas).toBe(4);
    expect(r.universo.disputadas).toBe(4);
  });

  it("Oposição LIVRE (1004) não cria votos em votação disputada", () => {
    // Na 1004 todos votam Não; se ela contasse como disputada, 9001 teria 5 votos.
    expect(linha(r, 9001)?.votosDisputadas).toBe(4);
  });

  it("partido da ÉPOCA do voto, só nas disputadas (para o relatório, fora do arquivo)", () => {
    const p = Object.fromEntries(r.porPartido.map((x) => [x.partido, x]));
    expect(p.PT).toEqual({ partido: "PT", votosDisputadas: 6, alinhadasDisputadas: 5 });
    expect(p.PL).toEqual({ partido: "PL", votosDisputadas: 3, alinhadasDisputadas: 0 });
    expect(p.PSD).toEqual({ partido: "PSD", votosDisputadas: 4, alinhadasDisputadas: 3 });
    expect(p.MDB).toEqual({ partido: "MDB", votosDisputadas: 3, alinhadasDisputadas: 1 });
  });
});

describe("sensibilidade — P-NRV contado contra", () => {
  it("entra no denominador e nunca no numerador (9004: 1/3 → 1/4; 9002: 0/3 → 0/4)", () => {
    const s = rodar({ contarContra: ["P-NRV"] });
    expect(linha(s, 9004)).toMatchObject({
      votosDisputadas: 4,
      alinhadasDisputadas: 1,
      taxaDisputadas: 25,
    });
    expect(linha(s, 9002)).toMatchObject({ votosDisputadas: 4, alinhadasDisputadas: 0 });
    // O arquivo publicado NUNCA usa isto: sem `contarContra`, o resultado é o de base.
    expect(linha(rodar(), 9004)?.votosDisputadas).toBe(3);
  });
});

describe("taxaComUmaCasa", () => {
  it("1 casa decimal, meio para cima, em aritmética de inteiros", () => {
    expect(taxaComUmaCasa(1, 3)).toBe(33.3);
    expect(taxaComUmaCasa(2, 3)).toBe(66.7);
    expect(taxaComUmaCasa(3, 4)).toBe(75);
    // 100·1/8 = 12,5 e 100·13/40 = 32,5 — meio exato (a ×10: 125 e 325).
    expect(taxaComUmaCasa(1, 8)).toBe(12.5);
    expect(taxaComUmaCasa(13, 40)).toBe(32.5);
    // 100·1/16 = 6,25 (a ×10: 62,5) → 6,3: meio para cima.
    expect(taxaComUmaCasa(1, 16)).toBe(6.3);
    expect(taxaComUmaCasa(0, 5)).toBe(0);
    expect(taxaComUmaCasa(5, 5)).toBe(100);
  });

  it("sem denominador lança (nunca NaN nem 0 de resgate)", () => {
    expect(() => taxaComUmaCasa(0, 0)).toThrow(/sem denominador/);
  });
});

describe("janelasSemestrais", () => {
  it("parte em semestres civis e corta a última no fim", () => {
    expect(janelasSemestrais("2023-02-01", "2024-03-10")).toEqual([
      { inicio: "2023-02-01", fim: "2023-06-30" },
      { inicio: "2023-07-01", fim: "2023-12-31" },
      { inicio: "2024-01-01", fim: "2024-03-10" },
    ]);
  });

  it("uma janela só quando cabe num semestre; fim no dia 30/06 e 31/12 não duplica", () => {
    expect(janelasSemestrais("2026-07-01", "2026-09-29")).toEqual([
      { inicio: "2026-07-01", fim: "2026-09-29" },
    ]);
    expect(janelasSemestrais("2025-01-01", "2025-06-30")).toEqual([
      { inicio: "2025-01-01", fim: "2025-06-30" },
    ]);
    expect(janelasSemestrais("2025-07-01", "2025-12-31")).toHaveLength(1);
    expect(janelasSemestrais("2025-06-30", "2025-07-01")).toEqual([
      { inicio: "2025-06-30", fim: "2025-06-30" },
      { inicio: "2025-07-01", fim: "2025-07-01" },
    ]);
  });

  it("as janelas são disjuntas e contíguas", () => {
    const j = janelasSemestrais("2023-02-01", "2026-09-29");
    expect(j).toHaveLength(8);
    for (let i = 1; i < j.length; i++) {
      const anterior = new Date(`${j[i - 1]?.fim}T00:00:00Z`);
      anterior.setUTCDate(anterior.getUTCDate() + 1);
      expect(j[i]?.inicio).toBe(anterior.toISOString().slice(0, 10));
    }
  });

  it("datas inválidas ou invertidas lançam", () => {
    expect(() => janelasSemestrais("2023-2-1", "2024-01-01")).toThrow(/AAAA-MM-DD/);
    expect(() => janelasSemestrais("2024-01-02", "2024-01-01")).toThrow(/depois do fim/);
  });
});

// ---------------------------------------------------------------------------
// O arquivo derivado
// ---------------------------------------------------------------------------

describe("montarArquivoAlinhamento — formato e lista branca", () => {
  const arq = montarArquivoAlinhamento(rodar());

  it("tem exatamente as chaves do contrato, na ordem", () => {
    expect(Object.keys(arq)).toEqual(["corte", "fonte", "universo", "por_senador"]);
    expect(arq.fonte).toEqual(FONTE_ALINHAMENTO_SENADO);
    expect(arq.corte).toBe("2025-04-09");
    expect(arq.universo).toEqual({ votacoes: 6, disputadas: 4, excluidas_sem_sequencial: 1 });
  });

  it("por_senador: chave = código (texto); valor = SÓ votos_disputadas e taxa_disputadas", () => {
    expect(Object.keys(arq.por_senador)).toEqual(["9001", "9002", "9003", "9004", "9005"]);
    for (const v of Object.values(arq.por_senador)) {
      expect(Object.keys(v)).toEqual(["votos_disputadas", "taxa_disputadas"]);
    }
    expect(arq.por_senador["9003"]).toEqual({ votos_disputadas: 4, taxa_disputadas: 75 });
  });

  // Asserção NEGATIVA: a positiva ("os campos certos estão lá") passaria com o
  // partido ou o nome ao lado.
  it("não carrega nome, partido, nascimento, CPF nem e-mail", () => {
    const s = JSON.stringify(arq);
    for (const proibido of [
      "Alfa",
      "Bravo",
      "Charlie",
      "PT",
      "PL",
      "PSD",
      "MDB",
      "nome",
      "partido",
      "nascimento",
      "cpf",
      "email",
      "@",
    ]) {
      // "PT" etc. só poderiam aparecer como VALOR de partido; a fonte diz "Senado Federal".
      expect(s, `vazou "${proibido}"`).not.toContain(proibido);
    }
    // A única data do arquivo é o corte.
    expect(s.match(/\d{4}-\d{2}-\d{2}/g)).toEqual(["2025-04-09"]);
  });

  it("a taxa vai de 0 a 100 com no máximo 1 casa; os votos são inteiros ≥ 1", () => {
    for (const v of Object.values(arq.por_senador)) {
      expect(v.taxa_disputadas).toBeGreaterThanOrEqual(0);
      expect(v.taxa_disputadas).toBeLessThanOrEqual(100);
      expect(Math.round(v.taxa_disputadas * 10)).toBeCloseTo(v.taxa_disputadas * 10, 9);
      expect(Number.isInteger(v.votos_disputadas)).toBe(true);
      expect(v.votos_disputadas).toBeGreaterThanOrEqual(1);
    }
  });
});
