/**
 * tests/unit/config/dado-freshness.test.ts — ADR-0038 D1/D3/D4.
 *
 * Três coisas são medidas aqui, e nenhuma é "a função devolve algo":
 *
 *   1. **Os quatro estados de `dado_ts` são quatro.** O ADR exige
 *      (D5, último parágrafo) que a implementação venha com teste que force
 *      presente-fresco, presente-velho, `null` e ausente. O risco real não é
 *      uma função quebrada — é um `??` que funde `null` com `undefined`, ou um
 *      fallback que faz "não sei" virar "é assim". Por isso as asserções abaixo
 *      são de PAR: cada estado prova que produz o texto dele **e** que não
 *      produz o do vizinho.
 *   2. **O limiar é por cargo, e difere entre cargos.** Um teste que só
 *      verificasse "180 s dispara em 200 s" passaria com a tabela inteira
 *      preenchida com 60 — por isso há asserção cruzada: o mesmo lag que é
 *      incidente para Presidente é ciclo normal para Deputado.
 *   3. **A cadência não é um número paralelo mantido à mão.** O último bloco lê
 *      os crons reais de `vercel.ts` e deriva a cadência de cada cargo deles.
 *      Se alguém mudar o cron sem mudar a tabela — ou o contrário — este
 *      arquivo quebra antes do deploy.
 */

import { describe, expect, it } from "vitest";

import { CARGOS_TSE, type CargoTse, parseCargoSegment } from "@/lib/config/cargos";
import {
  avaliarFrescorDado,
  CADENCIA_SEGUNDOS,
  fraseFrescorDado,
  LIMIAR_EM_CADENCIAS,
  limiarDadoParadoSegundos,
  rotuloFrescorDado,
  textoCadencia,
  textoDadoParado,
} from "@/lib/config/dado-freshness";
import vercelConfig from "@/vercel";

/** Hora de referência fixa — nada aqui pode depender do relógio da máquina. */
const AGORA = Date.parse("2026-10-04T23:00:00-03:00");
/** `ts` do modelo: deliberadamente DIFERENTE de qualquer `dado_ts` abaixo. */
const TS_MODELO = "2026-10-04T22:59:58-03:00";

function dadoTsHa(segundos: number): string {
  return new Date(AGORA - segundos * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// (1) Os quatro estados
// ---------------------------------------------------------------------------

describe("avaliarFrescorDado — os quatro estados de `dado_ts` (ADR-0038 D1)", () => {
  it("(a) presente e fresco → estado 'fresco', e o texto carrega a hora DO DADO, não a do modelo", () => {
    const dadoTs = dadoTsHa(30);
    const frescor = avaliarFrescorDado(dadoTs, 1, AGORA);

    expect(frescor.estado).toBe("fresco");

    const { label, value } = rotuloFrescorDado(frescor, TS_MODELO);
    expect(label).toBe("Dado do TSE");
    // O rótulo antigo não pode sobreviver ao lado do valor novo.
    expect(label).not.toBe("Última atualização");
    // 23:00:00 menos 30 s. Se a implementação caísse para `ts` (22:59:58),
    // este valor seria outro — é a asserção que separa os dois relógios.
    expect(value).toBe("22:59:30");
    expect(value).not.toBe("22:59:58");
  });

  it("(b) presente e além do limiar → estado 'parado', e o banner tem o que dizer", () => {
    const frescor = avaliarFrescorDado(dadoTsHa(600), 1, AGORA);

    expect(frescor.estado).toBe("parado");
    if (frescor.estado !== "parado") throw new Error("narrowing");

    expect(frescor.lagSegundos).toBe(600);
    expect(frescor.limiarSegundos).toBe(180);

    const texto = textoDadoParado(frescor);
    expect(texto).toContain("10 minutos");
    // Proporcional à cadência do cargo (D4) — não um "60s" fixo herdado da
    // spec 003.
    expect(texto).toContain("a cada minuto");
    // Constituição § 7 / RNF-010: a página CONTINUA mostrando o que tem.
    expect(texto).toContain("último apurado conhecido");

    // ...e o carimbo primário continua sendo a hora do dado: "parado" não
    // esconde o número, só acrescenta o aviso.
    expect(rotuloFrescorDado(frescor, TS_MODELO).label).toBe("Dado do TSE");
  });

  it("(c) `null` explícito → 'indisponivel': diz que não sabe, e NUNCA cai para `ts`", () => {
    const frescor = avaliarFrescorDado(null, 1, AGORA);

    expect(frescor.estado).toBe("indisponivel");

    const { label, value } = rotuloFrescorDado(frescor, TS_MODELO);
    expect(value).toBe("indisponível neste ciclo");
    // As duas negativas são o ponto do teste: o valor não pode ser a hora do
    // modelo disfarçada, nem o rótulo legado.
    expect(value).not.toContain("22:59:58");
    expect(value).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(label).not.toBe("Última atualização");

    // E não há banner de "parado": não se mede defasagem de um relógio que não
    // existe neste ciclo.
    expect(frescor.estado).not.toBe("parado");
  });

  it("(d) chave ausente → 'ausente': a tela se comporta como ANTES do ADR, com `ts`", () => {
    const frescor = avaliarFrescorDado(undefined, 1, AGORA);

    expect(frescor.estado).toBe("ausente");

    const { label, value } = rotuloFrescorDado(frescor, TS_MODELO);
    expect(label).toBe("Última atualização");
    expect(value).toBe("22:59:58");
    // Durante o canary a tela NÃO pode estrear o texto novo sobre um campo que
    // o payload não tem — seria afirmar hora do TSE sem ter hora do TSE.
    expect(label).not.toBe("Dado do TSE");
    expect(value).not.toBe("indisponível neste ciclo");
  });

  it("(e) `null` e ausente são estados DIFERENTES — é o `??` que este teste existe para impedir", () => {
    const comNull = avaliarFrescorDado(null, 1, AGORA);
    const semCampo = avaliarFrescorDado(undefined, 1, AGORA);

    expect(comNull.estado).not.toBe(semCampo.estado);
    expect(rotuloFrescorDado(comNull, TS_MODELO)).not.toEqual(
      rotuloFrescorDado(semCampo, TS_MODELO),
    );
    expect(fraseFrescorDado(comNull, TS_MODELO)).not.toBe(fraseFrescorDado(semCampo, TS_MODELO));
  });

  it("(f) string impossível de datar cai em 'indisponivel', não em 'ausente'", () => {
    // O produtor CONHECE o campo (senão não o teria enviado). Cair para o texto
    // de `ts` aqui seria fabricar o substituto que D1 proíbe.
    const frescor = avaliarFrescorDado("nao-e-uma-data", 1, AGORA);
    expect(frescor.estado).toBe("indisponivel");
    expect(rotuloFrescorDado(frescor, TS_MODELO).value).not.toBe("22:59:58");
  });

  it("(g) relógio do boletim adiantado não vira lag negativo", () => {
    // BRT fixo −03:00 sem DST do lado do TSE (`calculateLagSeconds`) contra o
    // relógio do servidor: os dois podem discordar por alguns segundos.
    const frescor = avaliarFrescorDado(dadoTsHa(-45), 1, AGORA);
    expect(frescor.estado).toBe("fresco");
    if (frescor.estado !== "fresco") throw new Error("narrowing");
    expect(frescor.lagSegundos).toBe(0);
    expect(frescor.lagSegundos).toBeGreaterThanOrEqual(0);
  });

  it("(h) `fraseFrescorDado` produz quatro frases distintas, e só duas falam em hora do TSE", () => {
    const [fresco, parado, indisponivel, ausente] = [
      fraseFrescorDado(avaliarFrescorDado(dadoTsHa(30), 1, AGORA), TS_MODELO),
      fraseFrescorDado(avaliarFrescorDado(dadoTsHa(600), 1, AGORA), TS_MODELO),
      fraseFrescorDado(avaliarFrescorDado(null, 1, AGORA), TS_MODELO),
      fraseFrescorDado(avaliarFrescorDado(undefined, 1, AGORA), TS_MODELO),
    ];

    expect(new Set([fresco, parado, indisponivel, ausente]).size).toBe(4);

    // "fresco" e "parado" compartilham o TEMPLATE de propósito — o carimbo é o
    // mesmo nos dois; quem avisa da parada é o banner, não esta frase.
    const template = /^Dado do TSE às \d{2}:\d{2}:\d{2}$/;
    expect(fresco).toMatch(template);
    expect(parado).toMatch(template);
    expect(fresco).toBe("Dado do TSE às 22:59:30");
    expect(parado).toBe("Dado do TSE às 22:50:00");

    // Os outros dois NÃO podem cair nesse template: um diz que não sabe, o
    // outro fala do relógio da escrita.
    expect(indisponivel).not.toMatch(template);
    expect(indisponivel).toBe("Hora do dado indisponível neste ciclo");
    expect(ausente).not.toMatch(template);
    // O fallback de rollout é LITERALMENTE o texto de hoje — há teste de página
    // (`deputado-federal.test.tsx`) que depende desta redação.
    expect(ausente).toBe("Atualizado às 22:59:58");
  });
});

// ---------------------------------------------------------------------------
// (2) O limiar por cargo
// ---------------------------------------------------------------------------

describe("limiar de dado parado — por cargo, derivado da cadência (ADR-0038 D3)", () => {
  it("(a) ×3 a cadência, nos quatro cargos", () => {
    expect(LIMIAR_EM_CADENCIAS).toBe(3);
    expect(limiarDadoParadoSegundos(1)).toBe(180);
    expect(limiarDadoParadoSegundos(3)).toBe(180);
    expect(limiarDadoParadoSegundos(5)).toBe(900);
    // 90 min. Três voltas completas das 6 fatias de 30 min (ADR-0036), NUNCA
    // três vezes os 5 min entre fatias (que daria 900 e igualaria o Senador).
    expect(limiarDadoParadoSegundos(6)).toBe(5400);
    expect(limiarDadoParadoSegundos(6)).not.toBe(limiarDadoParadoSegundos(5));
    expect(limiarDadoParadoSegundos(6)).not.toBe(limiarDadoParadoSegundos(1));
    // Spec 027 Fase 1: as assembleias leem um resumo por casa numa invocação só
    // (sem fatia), a cada 5 min — o limiar é o do Senador, não o do federal.
    expect(limiarDadoParadoSegundos(7)).toBe(900);
    expect(limiarDadoParadoSegundos(8)).toBe(900);
  });

  it("(b) dispara ALÉM do limiar, não aquém — e o limiar exato ainda é tolerado", () => {
    // Exatamente 3 cadências é o pior caso previsto pelo ADR-0011 (dois ciclos
    // perdidos), não incidente.
    expect(avaliarFrescorDado(dadoTsHa(180), 1, AGORA).estado).toBe("fresco");
    expect(avaliarFrescorDado(dadoTsHa(181), 1, AGORA).estado).toBe("parado");
    expect(avaliarFrescorDado(dadoTsHa(179), 1, AGORA).estado).toBe("fresco");
  });

  it("(c) o MESMO lag classifica diferente em cargos diferentes", () => {
    // 40 minutos parados. Incidente para Presidente, Governador e Senador;
    // ciclo perfeitamente normal para Deputado Federal, que anda de 30 em 30.
    const lag = 40 * 60;
    expect(avaliarFrescorDado(dadoTsHa(lag), 1, AGORA).estado).toBe("parado");
    expect(avaliarFrescorDado(dadoTsHa(lag), 3, AGORA).estado).toBe("parado");
    expect(avaliarFrescorDado(dadoTsHa(lag), 5, AGORA).estado).toBe("parado");
    expect(avaliarFrescorDado(dadoTsHa(lag), 6, AGORA).estado).toBe("fresco");

    // E 100 minutos acende também o Deputado — senão o teste acima passaria
    // com o cargo 6 nunca acendendo.
    expect(avaliarFrescorDado(dadoTsHa(100 * 60), 6, AGORA).estado).toBe("parado");
  });

  it("(d) o texto do banner é proporcional à cadência do cargo", () => {
    expect(textoCadencia(1)).toBe("a cada minuto");
    expect(textoCadencia(5)).toBe("a cada 5 minutos");
    expect(textoCadencia(6)).toBe("a cada 30 minutos");
    // O número que o ADR-0036 substituiu não pode reaparecer.
    expect(textoCadencia(6)).not.toContain("15");

    const dep = avaliarFrescorDado(dadoTsHa(100 * 60), 6, AGORA);
    if (dep.estado !== "parado") throw new Error("narrowing");
    const texto = textoDadoParado(dep);
    expect(texto).toContain("a cada 30 minutos");
    expect(texto).toContain("1h40"); // e não "100 minutos"
    expect(texto).not.toContain("a cada minuto");
  });

  it("(e) todo cargo coberto tem cadência declarada — nenhum cai em `undefined`", () => {
    for (const cd of CARGOS_TSE) {
      expect(CADENCIA_SEGUNDOS[cd], `cargo ${cd}`).toBeGreaterThan(0);
      expect(Number.isFinite(limiarDadoParadoSegundos(cd)), `cargo ${cd}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (3) A guarda contra o cron — a cadência não é número paralelo
// ---------------------------------------------------------------------------

/**
 * Converte o campo de MINUTO de um cron em "de quantos em quantos minutos esta
 * entrada dispara".
 *
 * Trata as três formas que `vercel.ts` usa hoje: `*` (todo minuto), passo
 * (`*` barra `N`) e lista explícita (`0,30`). A lista precisa ser
 * uniformemente espaçada **no relógio**, então o gap final volta pelo módulo
 * 60 — `0,30` são dois disparos separados por 30 min, não por 30 e depois 30
 * "até o fim da hora".
 */
function periodoEmMinutos(campoMinuto: string): number {
  if (campoMinuto === "*") return 1;

  const passo = campoMinuto.match(/^\*\/(\d+)$/);
  if (passo) return Number(passo[1]);

  const valores = campoMinuto
    .split(",")
    .map(Number)
    .sort((a, b) => a - b);
  if (valores.some(Number.isNaN)) {
    throw new Error(`campo de minuto não reconhecido: "${campoMinuto}"`);
  }
  if (valores.length === 1) return 60;

  const primeiro = valores[0] as number;
  const ultimo = valores[valores.length - 1] as number;
  // O primeiro gap fecha o ciclo pela virada da hora: em `0,30`, o disparo das
  // :00 vem 30 min depois do das :30 da hora anterior.
  const gaps = valores.map((v, i) =>
    i === 0 ? primeiro + 60 - ultimo : v - (valores[i - 1] as number),
  );
  const unicos = new Set(gaps);
  if (unicos.size !== 1) {
    throw new Error(`cron com espaçamento irregular (${campoMinuto}) — este parser não cobre`);
  }
  return gaps[0]!;
}

describe("a cadência da tabela bate com os crons reais de `vercel.ts` (ADR-0038 D3)", () => {
  /** Cadência observada em `vercel.ts`, por cargo, derivada do cron. */
  const observado = new Map<CargoTse, number>();
  /** Quantas FATIAS distintas cada cargo tem (1 para quem não é fatiado). */
  const fatias = new Map<CargoTse, Set<string>>();

  for (const cron of vercelConfig.crons ?? []) {
    // `/api/ingest/<slug>` ou `/api/ingest/<slug>/<fatia>`. O heartbeat diário
    // (`/api/ingest`, sem slug) não é cadência de cargo nenhum.
    const m = cron.path.match(/^\/api\/ingest\/([a-z-]+)(?:\/(\d+))?$/);
    if (!m) continue;

    // Pelo `parseCargoSegment` da tabela canônica — o mesmo que a rota usa —,
    // e não por um mapa de slugs escrito aqui: o mapa à mão ignorava em
    // silêncio qualquer cargo novo (spec 027 acrescentou 7 e 8).
    const cargo = parseCargoSegment(m[1] as string);
    expect(cargo, cron.path).not.toBeNull();
    if (cargo === null) continue;

    const periodo = periodoEmMinutos(cron.schedule.split(" ")[0] as string);
    const anterior = observado.get(cargo);
    // As duas janelas (apuração e simulado) repetem o mesmo padrão de minuto;
    // se um dia divergirem, o `Math.min` mantém a leitura conservadora e o
    // teste abaixo denuncia.
    observado.set(cargo, anterior === undefined ? periodo : Math.min(anterior, periodo));

    if (!fatias.has(cargo)) fatias.set(cargo, new Set());
    fatias.get(cargo)?.add(m[2] ?? "unica");
  }

  it("(a) os seis cargos aparecem nos crons", () => {
    expect([...observado.keys()].sort()).toEqual([1, 3, 5, 6, 7, 8]);
    expect([...observado.keys()].sort()).toEqual([...CARGOS_TSE].sort());
  });

  it("(b) Presidente, Governador, Senador e as assembleias: a cadência é o próprio período do cron", () => {
    expect(observado.get(1)).toBe(CADENCIA_SEGUNDOS[1] / 60);
    expect(observado.get(3)).toBe(CADENCIA_SEGUNDOS[3] / 60);
    expect(observado.get(5)).toBe(CADENCIA_SEGUNDOS[5] / 60);
    // Spec 027 Fase 1: 7 e 8 sem fatia, um resumo por casa a cada 5 min.
    expect(observado.get(7)).toBe(CADENCIA_SEGUNDOS[7] / 60);
    expect(observado.get(8)).toBe(CADENCIA_SEGUNDOS[8] / 60);
    expect(fatias.get(7)?.size).toBe(1);
    expect(fatias.get(8)?.size).toBe(1);
  });

  it("(c) Deputado Federal: a cadência é a VOLTA COMPLETA das 6 fatias, não o intervalo entre elas", () => {
    // A armadilha, escrita como asserção. Em `vercel.ts` há 6 entradas de cron
    // para o cargo 6, intercaladas de 5 em 5 minutos — ler "5 min" daquilo é a
    // leitura errada, e foi a que travou a tentativa anterior desta
    // implementação. Cada fatia cobre ~1/6 do fan-out e REPETE a cada 30 min;
    // o conjunto do dado só se renova por inteiro na volta completa.
    expect(fatias.get(6)?.size).toBe(6);
    expect(observado.get(6)).toBe(30);
    expect(observado.get(6)).not.toBe(5);
    expect(CADENCIA_SEGUNDOS[6] / 60).toBe(observado.get(6));

    // Os outros três não são fatiados — senão a asserção acima não
    // discriminaria nada.
    expect(fatias.get(1)?.size).toBe(1);
    expect(fatias.get(5)?.size).toBe(1);
  });

  it("(d) o limiar publicado é exatamente ×3 a cadência observada no cron", () => {
    for (const [cargo, minutos] of observado) {
      expect(limiarDadoParadoSegundos(cargo), `cargo ${cargo}`).toBe(
        minutos * 60 * LIMIAR_EM_CADENCIAS,
      );
    }
  });
});
