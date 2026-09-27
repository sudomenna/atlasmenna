// @vitest-environment happy-dom
/**
 * tests/unit/components/senado-votos-por-eleitor.test.tsx
 *
 * Spec 022 RF-210 + spec 021 RF-195c (decisão do dono, 2026-09-27) — o Senado
 * contado em VOTOS, 2 por eleitor, nos dois painéis: "Votação"
 * (`VotacaoEleitorado`) e "A corrida" (`CorridaTresCirculos`).
 *
 * ## Por que as capturas REAIS, e não números à mão
 *
 * O defeito que este arquivo fecha só existe porque o TSE conta o Senado de um
 * jeito que ninguém desenhou: nas capturas do simulado, cargo 5, 2 vagas
 * (`tests/fixtures/tse/2026-sim/senado/{df,ac,sp,rs}-c0005-e021272-u.json`),
 * `tv == 2 × c`. Os campos de voto vêm em votos; `aptos`, `instalados`,
 * `comparecimento` e `abstencao` em pessoas. Uma fixture montada à mão
 * carregaria a MINHA leitura dessa regra; lida do arquivo do TSE, ela carrega
 * a regra do TSE. As contagens saem do arquivo exatamente como o produtor as
 * mapeia (`e.te/esi/c/a`, `v.vv/vb/tvn/van/vansj`).
 *
 * ## O que discrimina o quê
 *
 * As quatro capturas estão a 100% apurado: `te == esi`, e o "Ainda não
 * apurado" é ZERO. Um teste só com elas não pegaria o esquecimento do × k
 * nessa fatia (0 × 2 = 0 × 1). Por isso cada captura ganha uma variante
 * PARCIAL, com {@link NAO_INSTALADOS} eleitores a mais em `aptos` — a
 * identidade continua valendo (`2·aptos = tv + 2a + 2·(aptos − esi)`) e a
 * fatia passa a ter valor.
 *
 * A projeção de teste é a própria verdade da captura (`vv`, `vb`, `tvn`, `a`):
 * com ela o residual do arco 3 tem de ser EXATAMENTE `van + vansj` — um número
 * que só sai certo se a abstenção projetada entrar × 2 e os votos não.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CorridaTresCirculos,
  circuloAptos,
  circuloComparecimento,
  circuloValidos,
  fatiasDaCorrida,
  ordenarCandidaturas,
} from "@/components/blocks/CorridaTresCirculos";
import {
  fatiasCirculo1,
  fatiasCirculo2,
  fatiasCirculo3,
  VotacaoEleitorado,
} from "@/components/blocks/VotacaoEleitorado";
import type {
  EdgeCorridaEntrada,
  EdgeDestinoVoto,
  EdgeVotacao,
  EdgeVotacaoContagens,
  EdgeVotacaoProjetada,
} from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// As capturas
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function lerCaptura(arquivo: string): Json {
  return JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/tse", arquivo), "utf8"));
}

/** `cand[].dvt` → destinação, SEM default: valor desconhecido quebra o teste. */
function destino(dvt: unknown): EdgeDestinoVoto {
  if (dvt === "Válido") return "valido";
  if (dvt === "Anulado") return "anulado";
  if (dvt === "Anulado sub judice") return "sub_judice";
  throw new Error(`dvt desconhecido na captura: ${String(dvt)}`);
}

interface Captura {
  uf: string;
  contagens: EdgeVotacaoContagens;
  corrida: EdgeCorridaEntrada[];
  /** A verdade da captura como se fosse a projeção: votos em votos, abstenção em pessoas. */
  projetada: EdgeVotacaoProjetada;
  /** `v.tv` — o total de votos que o TSE publica. */
  tv: number;
  /** `carg[0].nv` — vagas em disputa. */
  nv: number;
}

function captura(arquivo: string, uf: string): Captura {
  const d = lerCaptura(arquivo);
  const e = d.e as Record<string, string>;
  const v = d.v as Record<string, string>;
  const n = (x: string | undefined) => Number(x);
  const carg = (d.carg as Json[])[0] as Json;
  const corrida: EdgeCorridaEntrada[] = [];
  for (const agr of carg.agr as Json[]) {
    for (const par of agr.par as Json[]) {
      for (const cand of par.cand as Json[]) {
        corrida.push({
          id: Number(cand.n),
          partido: String(par.sg),
          votos: Number(cand.vap),
          destino: destino(cand.dvt),
        });
      }
    }
  }
  return {
    uf,
    contagens: {
      aptos: n(e.te),
      instalados: n(e.esi),
      comparecimento: n(e.c),
      abstencao: n(e.a),
      validos: n(v.vv),
      brancos: n(v.vb),
      nulos: n(v.tvn),
      anulados: n(v.van),
      sub_judice: n(v.vansj),
    },
    corrida,
    projetada: { validos: n(v.vv), brancos: n(v.vb), nulos: n(v.tvn), abstencao: n(e.a) },
    tv: n(v.tv),
    nv: Number(carg.nv),
  };
}

const SENADO: Captura[] = [
  captura("2026-sim/senado/df-c0005-e021272-u.json", "DF"),
  captura("2026-sim/senado/ac-c0005-e021272-u.json", "AC"),
  captura("2026-sim/senado/sp-c0005-e021272-u.json", "SP"),
  captura("2026-sim/senado/rs-c0005-e021272-u.json", "RS"),
];

/** Presidente, 1 vaga, mesma bateria do simulado — a regra antiga tem de seguir valendo. */
const PRESIDENTE = captura("2026-sim/br-c0001-e021270-u.json", "BR");

/** Eleitores de seções ainda não instaladas, na variante parcial. */
const NAO_INSTALADOS = 50_000;

/** A captura no meio da noite: `aptos > instalados`, a identidade intacta. */
function parcial(c: EdgeVotacaoContagens): EdgeVotacaoContagens {
  return { ...c, aptos: c.aptos + NAO_INSTALADOS };
}

const soma = (xs: readonly { abs: number }[]) => xs.reduce((s, x) => s + x.abs, 0);
const abs = (xs: readonly { key: string; abs: number }[] | null, key: string) =>
  xs?.find((f) => f.key === key)?.abs;

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}
const q = (doc: Document, testid: string) => doc.querySelector(`[data-testid="${testid}"]`);

// ---------------------------------------------------------------------------
// A premissa — se o TSE mudar a regra, este bloco quebra primeiro
// ---------------------------------------------------------------------------

describe("RF-210 — as identidades medidas nas capturas reais do Senado", () => {
  it.each(SENADO)("$uf: 2 vagas, tv == 2×c, votos fecham em tv, c + a == esi", (cap) => {
    const c = cap.contagens;
    expect(cap.nv).toBe(2);
    expect(cap.tv).toBe(2 * c.comparecimento);
    expect(c.validos + c.brancos + c.nulos + c.anulados + c.sub_judice).toBe(cap.tv);
    expect(c.comparecimento + c.abstencao).toBe(c.instalados);
    const validas = cap.corrida.filter((x) => x.destino === "valido");
    expect(validas.reduce((s, x) => s + x.votos, 0)).toBe(c.validos);
  });
});

// ---------------------------------------------------------------------------
// "Votação" (spec 021 RF-195c)
// ---------------------------------------------------------------------------

describe("RF-195c — os arcos do 'Votação' FECHAM com 2 por eleitor", () => {
  it.each(SENADO)("$uf: arco 1 fecha em aptos×2 com k=2, e NÃO fecha com k=1", (cap) => {
    for (const c of [cap.contagens, parcial(cap.contagens)]) {
      const f = fatiasCirculo1(c, 2);
      expect(f).not.toBeNull();
      expect(soma(f ?? [])).toBe(c.aptos * 2);
      expect(abs(f, "abstencao")).toBe(c.abstencao * 2);
      expect(abs(f, "nao_apurado")).toBe((c.aptos - c.instalados) * 2);
      // Os votos entram como vêm.
      expect(abs(f, "validos")).toBe(c.validos);
      expect(abs(f, "anulados")).toBe(c.anulados + c.sub_judice);
      expect(fatiasCirculo1(c, 1)).toBeNull();
      expect(fatiasCirculo1(c)).toBeNull();
    }
  });

  it.each(SENADO)("$uf: 'Ainda não apurado' parcial = 2 × os eleitores não instalados", (cap) => {
    expect(abs(fatiasCirculo1(parcial(cap.contagens), 2), "nao_apurado")).toBe(2 * NAO_INSTALADOS);
  });

  it.each(SENADO)("$uf: arco 2 fecha em instalados×2 com k=2, e NÃO fecha com k=1", (cap) => {
    const c = cap.contagens;
    const f = fatiasCirculo2(c, 2);
    expect(f).not.toBeNull();
    expect(soma(f ?? [])).toBe(c.instalados * 2);
    expect(abs(f, "abstencao")).toBe(c.abstencao * 2);
    expect(abs(f, "brancos")).toBe(c.brancos);
    expect(fatiasCirculo2(c, 1)).toBeNull();
  });

  it.each(SENADO)("$uf: arco 3 fecha em aptos×2 e o residual é EXATAMENTE van + vansj", (cap) => {
    const c = cap.contagens;
    const f = fatiasCirculo3(c, cap.projetada, 2);
    expect(f).not.toBeNull();
    expect(soma(f ?? [])).toBe(c.aptos * 2);
    expect(abs(f, "abstencao")).toBe(cap.projetada.abstencao * 2);
    expect(abs(f, "validos")).toBe(cap.projetada.validos);
    // A verdade do TSE: o que sobra no fim da noite é o anulado, em votos.
    expect(abs(f, "anulados")).toBe(c.anulados + c.sub_judice);
    // Com 1 por eleitor a projeção passa do eleitorado: não fecha.
    expect(fatiasCirculo3(c, cap.projetada, 1)).toBeNull();
    expect(fatiasCirculo3(c, cap.projetada)).toBeNull();
  });

  it.each(SENADO)("$uf: no painel, os três arcos desenham com k=2", (cap) => {
    const votacao: EdgeVotacao = { contagens: parcial(cap.contagens), projetada: cap.projetada };
    const doc = parse(<VotacaoEleitorado votacao={votacao} votosPorEleitor={2} />);
    for (const n of [1, 2, 3] as const) {
      expect(q(doc, `votacao-circulo-${n}-inconsistente`)).toBeNull();
      expect(q(doc, `votacao-circulo-${n}`)?.querySelector("svg")).not.toBeNull();
      const fig = q(doc, `votacao-circulo-${n}`);
      expect(fig?.getAttribute("data-soma-abs")).toBe(fig?.getAttribute("data-total"));
    }
    expect(q(doc, "votacao-circulo-1")?.getAttribute("data-total")).toBe(
      String((cap.contagens.aptos + NAO_INSTALADOS) * 2),
    );
    expect(q(doc, "votacao-circulo-2")?.getAttribute("data-total")).toBe(
      String(cap.contagens.instalados * 2),
    );
    expect(q(doc, "votacao-eleitorado")?.getAttribute("data-votos-por-eleitor")).toBe("2");
  });

  it.each(SENADO)("$uf: no painel, com k=1 os arcos 1, 2 e 3 dizem 'não fecha'", (cap) => {
    const votacao: EdgeVotacao = { contagens: cap.contagens, projetada: cap.projetada };
    const doc = parse(<VotacaoEleitorado votacao={votacao} />);
    for (const n of [1, 2, 3] as const) {
      expect(q(doc, `votacao-circulo-${n}-inconsistente`)).not.toBeNull();
    }
    expect(doc.querySelectorAll("svg")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// "A corrida" (spec 022 RF-210)
// ---------------------------------------------------------------------------

describe("RF-210 — os círculos da corrida FECHAM com 2 por eleitor", () => {
  it.each(SENADO)("$uf: círculo 1 fecha em válidos com qualquer k (já é voto)", (cap) => {
    const fatias = fatiasDaCorrida(ordenarCandidaturas(cap.corrida));
    const f = circuloValidos(fatias, cap.contagens);
    expect(soma(f ?? [])).toBe(cap.contagens.validos);
  });

  it.each(SENADO)("$uf: círculo 2 fecha em comparecimento×2 (= tv) com k=2", (cap) => {
    const fatias = fatiasDaCorrida(ordenarCandidaturas(cap.corrida));
    const c = cap.contagens;
    const f = circuloComparecimento(fatias, c, 2);
    expect(soma(f ?? [])).toBe(cap.tv);
    expect(circuloComparecimento(fatias, c, 1)).toBeNull();
    expect(circuloComparecimento(fatias, c)).toBeNull();
  });

  it.each(SENADO)("$uf: círculo 3 fecha em aptos×2, abstenção e não apurado × 2", (cap) => {
    const fatias = fatiasDaCorrida(ordenarCandidaturas(cap.corrida));
    const c = parcial(cap.contagens);
    const f = circuloAptos(fatias, c, 2);
    expect(f).not.toBeNull();
    expect(soma(f ?? [])).toBe(c.aptos * 2);
    expect(abs(f, "abstencao")).toBe(c.abstencao * 2);
    expect(abs(f, "nao_apurado")).toBe(2 * NAO_INSTALADOS);
    expect(abs(f, "brancos")).toBe(c.brancos);
    expect(circuloAptos(fatias, c, 1)).toBeNull();
  });

  it.each(
    SENADO,
  )("$uf: no painel, os três desenham com k=2, e 2 e 3 'não fecham' com k=1", (cap) => {
    const votacao: EdgeVotacao = { contagens: parcial(cap.contagens), corrida: cap.corrida };
    const doc2 = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacao} votosPorEleitor={2} />,
    );
    for (const n of [1, 2, 3] as const) {
      expect(q(doc2, `corrida-circulo-${n}-nao-fecha`)).toBeNull();
      const fig = q(doc2, `corrida-circulo-${n}`);
      expect(fig?.querySelector("svg")).not.toBeNull();
      expect(fig?.getAttribute("data-soma-abs")).toBe(fig?.getAttribute("data-total"));
    }
    expect(q(doc2, "corrida-circulo-2")?.getAttribute("data-total")).toBe(String(cap.tv));
    expect(q(doc2, "corrida-tres-circulos")?.getAttribute("data-estado")).toBe("apurando");

    const doc1 = parse(<CorridaTresCirculos modo="candidatura" votacao={votacao} />);
    expect(q(doc1, "corrida-circulo-1-nao-fecha")).toBeNull();
    expect(q(doc1, "corrida-circulo-2-nao-fecha")).not.toBeNull();
    expect(q(doc1, "corrida-circulo-3-nao-fecha")).not.toBeNull();
  });

  it("🔴 o círculo de projeção NÃO leva fator: total = `projetada.validos`", () => {
    const cap = SENADO[2] as Captura;
    const votacao: EdgeVotacao = {
      contagens: cap.contagens,
      corrida: cap.corrida,
      projetada: cap.projetada,
    };
    const candidatos = cap.corrida.map((x) => ({ id: x.id, votos_projetados: x.votos }));
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacao}
        candidatos={candidatos}
        votosPorEleitor={2}
      />,
    );
    const fig = q(doc, "corrida-projecao");
    expect(fig?.getAttribute("data-total")).toBe(String(cap.projetada.validos));
    expect(fig?.getAttribute("data-soma-abs")).toBe(String(cap.projetada.validos));
  });
});

// ---------------------------------------------------------------------------
// Base nomeada e metodologia
// ---------------------------------------------------------------------------

describe("RF-210 / RF-196 — a base é nomeada em votos, e a metodologia diz por quê", () => {
  const cap = SENADO[0] as Captura;
  const votacao: EdgeVotacao = {
    contagens: cap.contagens,
    corrida: cap.corrida,
    projetada: cap.projetada,
  };

  it("🔴 k=2: as três bases do 'Votação' e as bases 2 e 3 da corrida dizem 'votos (2 por eleitor)'", () => {
    const v = parse(<VotacaoEleitorado votacao={votacao} votosPorEleitor={2} />);
    for (const n of [1, 2, 3] as const) {
      expect(q(v, `votacao-circulo-${n}-base`)?.textContent).toContain("votos (2 por eleitor)");
      expect(q(v, `votacao-circulo-${n}-base`)?.textContent).not.toMatch(/^eleitores/);
    }
    const c = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacao} votosPorEleitor={2} />,
    );
    expect(q(c, "corrida-circulo-1-base")?.textContent).toBe("votos válidos");
    for (const n of [2, 3] as const) {
      expect(q(c, `corrida-circulo-${n}-base`)?.textContent).toContain("votos (2 por eleitor)");
    }
  });

  it("k=1: as bases seguem em eleitores, sem 'por eleitor'", () => {
    const v = parse(<VotacaoEleitorado votacao={{ contagens: PRESIDENTE.contagens }} />);
    expect(q(v, "votacao-circulo-1-base")?.textContent).toBe("eleitores aptos");
    expect(q(v, "votacao-circulo-2-base")?.textContent).toBe("eleitorado já apurado");
    expect(v.body.textContent).not.toContain("por eleitor");
    const c = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: PRESIDENTE.contagens, corrida: PRESIDENTE.corrida }}
      />,
    );
    expect(q(c, "corrida-circulo-2-base")?.textContent).toBe("eleitores que votaram");
    expect(q(c, "corrida-circulo-3-base")?.textContent).toBe("eleitores aptos");
    expect(c.body.textContent).not.toContain("por eleitor");
  });

  it("🔴 k=2: a frase do Senado está nos dois painéis, nas DUAS visões, sem jargão", () => {
    const v = parse(<VotacaoEleitorado votacao={votacao} votosPorEleitor={2} />);
    const c = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacao} votosPorEleitor={2} />,
    );
    for (const [doc, id] of [
      [v, "votacao-metodologia-votos"],
      [c, "corrida-metodologia-votos"],
    ] as const) {
      const p = q(doc, id);
      expect(p?.textContent).toMatch(/No Senado cada eleitor dá dois votos/);
      expect(p?.textContent).toMatch(/contam votos, e não eleitores/);
      expect(p?.hasAttribute("data-view-only")).toBe(false);
      expect(p?.textContent).not.toMatch(/RF-|payload|\bk\b|tv\b|vv\b|votosPorEleitor/);
    }
    // As frases que citam os aptos dizem as DUAS quantidades, cada uma com o nome.
    expect(q(v, "votacao-metodologia-parcial")?.textContent).toMatch(
      /votos dos [\d.]+ eleitores aptos/,
    );
  });

  it("k=1: nenhuma frase do Senado", () => {
    const v = parse(<VotacaoEleitorado votacao={{ contagens: PRESIDENTE.contagens }} />);
    expect(q(v, "votacao-metodologia-votos")).toBeNull();
    const c = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: PRESIDENTE.contagens, corrida: PRESIDENTE.corrida }}
      />,
    );
    expect(q(c, "corrida-metodologia-votos")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Presidente / Governador — inalterados
// ---------------------------------------------------------------------------

describe("RF-210 — Presidente e Governador seguem com 1 por eleitor", () => {
  it("🔴 a captura real do Presidente fecha SEM o argumento, e NÃO fecha com 2", () => {
    const c = PRESIDENTE.contagens;
    expect(soma(fatiasCirculo1(c) ?? [])).toBe(c.aptos);
    expect(soma(fatiasCirculo2(c) ?? [])).toBe(c.instalados);
    expect(fatiasCirculo1(c, 2)).toBeNull();
    expect(fatiasCirculo2(c, 2)).toBeNull();
    const fatias = fatiasDaCorrida(ordenarCandidaturas(PRESIDENTE.corrida));
    expect(soma(circuloComparecimento(fatias, c) ?? [])).toBe(c.comparecimento);
    expect(soma(circuloAptos(fatias, c) ?? [])).toBe(c.aptos);
    expect(circuloComparecimento(fatias, c, 2)).toBeNull();
  });

  it("o painel do Presidente, sem a prop, desenha e marca 1 por eleitor", () => {
    const v = parse(<VotacaoEleitorado votacao={{ contagens: PRESIDENTE.contagens }} />);
    expect(q(v, "votacao-eleitorado")?.getAttribute("data-votos-por-eleitor")).toBe("1");
    expect(q(v, "votacao-circulo-1-inconsistente")).toBeNull();
    const c = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: PRESIDENTE.contagens, corrida: PRESIDENTE.corrida }}
      />,
    );
    expect(q(c, "corrida-tres-circulos")?.getAttribute("data-votos-por-eleitor")).toBe("1");
    for (const n of [1, 2, 3] as const) {
      expect(q(c, `corrida-circulo-${n}-nao-fecha`)).toBeNull();
    }
  });

  it("🔴 k fracionário é recusado MESMO quando a conta fecharia", () => {
    // Sem este caso a guarda era decorativa (mutação sobreviveu em 2026-09-27):
    // com k = 0 ou NaN a soma já não bate, e o `null` saía por coincidência.
    // Aqui, 1,5 voto por eleitor FECHA: votos 6 = 1,5 × comparecimento 4, e
    // 6 + 1,5 × (abstenção 4 + não instalados 2) = 15 = 1,5 × aptos 10.
    const c: EdgeVotacaoContagens = {
      aptos: 10,
      instalados: 8,
      comparecimento: 4,
      abstencao: 4,
      validos: 6,
      brancos: 0,
      nulos: 0,
      anulados: 0,
      sub_judice: 0,
    };
    const p: EdgeVotacaoProjetada = { validos: 6, brancos: 0, nulos: 0, abstencao: 4 };
    const fatias = fatiasDaCorrida(
      ordenarCandidaturas([{ id: 1, partido: "PT", votos: 6, destino: "valido" }]),
    );
    expect(fatiasCirculo1(c, 1.5)).toBeNull();
    expect(fatiasCirculo2(c, 1.5)).toBeNull();
    expect(fatiasCirculo3(c, p, 1.5)).toBeNull();
    expect(circuloComparecimento(fatias, c, 1.5)).toBeNull();
    expect(circuloAptos(fatias, c, 1.5)).toBeNull();
  });

  it("🔴 `votosPorEleitor` inválido no 'Votação' ⇒ <DetailUnavailable>", () => {
    for (const k of [0, -1, 1.5, Number.NaN]) {
      const doc = parse(
        <VotacaoEleitorado votacao={{ contagens: PRESIDENTE.contagens }} votosPorEleitor={k} />,
      );
      expect(q(doc, "detail-unavailable")).not.toBeNull();
      expect(doc.querySelectorAll("svg")).toHaveLength(0);
    }
    expect(fatiasCirculo1(PRESIDENTE.contagens, 0)).toBeNull();
    expect(fatiasCirculo2(PRESIDENTE.contagens, 1.5)).toBeNull();
    expect(fatiasCirculo3(PRESIDENTE.contagens, PRESIDENTE.projetada, -1)).toBeNull();
  });
});
