/**
 * tests/unit/etiquetas/visoes.test.ts — as visões agregadas da spec 025
 * (V1, V2, Câmara 2027, V4) e as três portas de cada uma: chave ligada,
 * critério publicado, portão de cobertura. Etiquetas compiladas de verdade
 * (`_visoes-fixtures.ts`).
 *
 * O critério é LIDO do catálogo; onde a visão depende de uma categoria ainda
 * sem critério (impeachment, hoje), o caso "com critério" liga
 * `categoriaExibivel` por mock — o único jeito de exercitar a visão antes de o
 * dono mandar o critério, sem inventar um no código.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const exibivelMock = vi.hoisted(() => ({ forcar: false }));
vi.mock("@/lib/etiquetas/catalogo", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/catalogo")>();
  return {
    ...m,
    categoriaExibivel: (c: string) => exibivelMock.forcar || m.categoriaExibivel(c),
  };
});

import type { EdgeBancadaNacional } from "@/lib/edge-config/types";
import { ORDEM_BLOCOS_HEMICICLO } from "@/lib/etiquetas/catalogo";
import {
  ordenarPorBloco,
  placarImpeachment,
  relacaoDaAgremiacao,
  visaoCamara2027,
  visaoRenovacaoSenado,
  visaoSenado2027PorBloco,
} from "@/lib/etiquetas/visoes";
import { validarMandato2027 } from "@/lib/senado/mandato-2031";
import {
  cand,
  mandatoDeTeste,
  payloadSenado,
  payloadTresUfs,
  ufRow,
} from "@/tests/fixtures/senado/payload-senado";

import { CODIGOS_2031, etiquetasDeTeste, relacaoFixa, universoDoPayload } from "./_visoes-fixtures";

beforeEach(() => {
  exibivelMock.forcar = false;
});

function v1Aberta(ligadas: ("v1" | "v2" | "v4")[] = ["v1"]) {
  const payload = payloadTresUfs();
  return {
    payload,
    etiquetas: etiquetasDeTeste({
      universo: universoDoPayload(payload, 5),
      relacaoPorPartido: relacaoFixa,
      ligadas,
    }),
  };
}

describe("RF-240 — ordenarPorBloco: ordem FIXA do catálogo, qualquer que seja a entrada", () => {
  it("Base → Independentes → aguardando → Oposição, e a soma é a entrada", () => {
    const v = ordenarPorBloco([
      { bloco: "oposicao", origem: "projetada" },
      { bloco: "aguardando", origem: "aguardando" },
      { bloco: "base_governo", origem: "continua_2031" },
      { bloco: "independente", origem: "decidida" },
      { bloco: "base_governo", origem: "projetada" },
    ]);
    expect(v.cadeiras.map((c) => c.bloco)).toEqual([
      "base_governo",
      "base_governo",
      "independente",
      "aguardando",
      "oposicao",
    ]);
    expect(ORDEM_BLOCOS_HEMICICLO).toEqual([
      "base_governo",
      "independente",
      "aguardando",
      "oposicao",
    ]);
    expect(v.total).toBe(5);
    expect(v.porOrigem.base_governo).toEqual({ continua_2031: 1, projetada: 1 });
  });

  it("🔴 a entrada permutada não muda a saída (ordem invariante)", () => {
    const base = [
      { bloco: "oposicao", origem: "projetada" },
      { bloco: "base_governo", origem: "continua_2031" },
      { bloco: "independente", origem: "decidida" },
    ] as const;
    const a = ordenarPorBloco([...base]);
    const b = ordenarPorBloco([...base].reverse());
    expect(b).toEqual(a);
  });
});

describe("RF-242 — V1, Senado de 2027 por bloco", () => {
  it("🔴 chave desligada ⇒ oculta (e nada é desenhado)", () => {
    const { payload, etiquetas } = v1Aberta([]);
    const r = visaoSenado2027PorBloco(payload, mandatoDeTeste(), etiquetas);
    expect(r).toMatchObject({ ok: false, motivo: "desligada" });
  });

  it("🔴 portão: um candidato com chance sem classificação ⇒ oculta, com quem bloqueia", () => {
    const payload = payloadTresUfs();
    const etiquetas = etiquetasDeTeste({
      universo: universoDoPayload(payload, 5),
      // PDT (3º no RJ, a 8 pontos da 2ª vaga) fica fora da chance; o PSD
      // (1º no RJ) sem classificação bloqueia.
      relacaoPorPartido: (s) => (s === "PSD" ? null : relacaoFixa(s)),
      ligadas: ["v1"],
    });
    const r = visaoSenado2027PorBloco(payload, mandatoDeTeste(), etiquetas);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("portao");
    // O PSD também tem senadores até 2031 na foto fictícia: bloqueiam junto.
    expect(r.bloqueantes.some((b) => b.corrida === "RJ" && b.motivo === "a_classificar")).toBe(
      true,
    );
    expect(r.bloqueantes.some((b) => b.corrida === "senado2031")).toBe(true);
  });

  it("🔴 portão: um dos 27 que seguem até 2031 sem classificação ⇒ oculta", () => {
    const payload = payloadTresUfs();
    const etiquetas = etiquetasDeTeste({
      universo: universoDoPayload(payload, 5),
      relacaoPorPartido: (s) => (s === "PODE" ? null : relacaoFixa(s)),
      ligadas: ["v1"],
    });
    const r = visaoSenado2027PorBloco(payload, mandatoDeTeste(), etiquetas);
    expect(r).toMatchObject({ ok: false, motivo: "portao" });
  });

  it("aberta: 81 cadeiras, blocos na ordem do catálogo, nada 'a classificar'", () => {
    const { payload, etiquetas } = v1Aberta();
    const r = visaoSenado2027PorBloco(payload, mandatoDeTeste(), etiquetas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.visao;
    expect(v.total).toBe(81);
    expect(Object.values(v.contagem).reduce((a, b) => a + b, 0)).toBe(81);
    // 3 UFs projetadas ⇒ 6 vagas atribuídas; 48 aguardando.
    expect(v.contagem.aguardando).toBe(48);
    // Foto fictícia: PL 9, PP 3 ⇒ 12 na oposição; + PL (SP, MG) e PP (RJ) nas vagas ⇒ 15.
    expect(v.contagem.oposicao).toBe(15);
    // PT 3 + PSB 1 ⇒ 4; + PT (SP) ⇒ 5.
    expect(v.contagem.base_governo).toBe(5);
    expect(v.contagem.independente).toBe(81 - 48 - 15 - 5);
    // Blocos contíguos, na ordem fixa.
    const sequencia = v.cadeiras.map((c) => c.bloco).filter((b, i, a) => a[i - 1] !== b);
    expect(sequencia).toEqual(ORDEM_BLOCOS_HEMICICLO.filter((b) => v.contagem[b] > 0));
    expect(v.porOrigem.oposicao.continua_2031).toBe(12);
    expect(v.porOrigem.oposicao.decidida).toBe(1); // PP, RJ 100%
  });

  it("recusa do Senado (composição divergente) ⇒ oculta, como o hemiciclo por partido", () => {
    const { etiquetas } = v1Aberta();
    const payload = payloadTresUfs({
      composicao_vagas: {
        vagas_em_disputa: 54,
        total_cadeiras: 81,
        vagas_por_uf: 2,
        ufs_projetadas: 3,
        ufs_aguardando: 24,
        vagas_projetadas: 6,
        por_partido: [{ partido: "PL", vagas: 6 }],
      },
    });
    expect(visaoSenado2027PorBloco(payload, mandatoDeTeste(), etiquetas)).toMatchObject({
      ok: false,
      motivo: "recusa_senado",
    });
  });
});

describe("RF-243 — V2, impeachment de ministros do STF", () => {
  function impeachmentAberto(valorDe: (chave: string) => string = () => "a_favor") {
    const payload = payloadTresUfs();
    const universo = universoDoPayload(payload, 5);
    return {
      payload,
      etiquetas: etiquetasDeTeste({
        universo,
        relacaoPorPartido: relacaoFixa,
        ligadas: ["v2"],
        linhas: {
          "senado-2031.csv": CODIGOS_2031.map((c) => ({
            chave: `senado:${c}`,
            categoria: "impeachment_stf",
            valor: valorDe(`senado:${c}`),
          })),
          "senador.csv": universo.map((u) => ({
            chave: u.sqcand,
            categoria: "impeachment_stf",
            valor: valorDe(u.sqcand),
          })),
        },
      }),
    };
  }

  it("🔴 sem critério publicado de impeachment ⇒ oculta, mesmo ligada e coberta", () => {
    const { payload, etiquetas } = impeachmentAberto();
    const r = placarImpeachment(payload, mandatoDeTeste(), etiquetas);
    // Hoje o catálogo não tem critério de impeachment (constituição § 2 (a)).
    expect(r).toMatchObject({ ok: false, motivo: "sem_criterio" });
  });

  it("com critério: 81 linhas, limiar 54 (dois terços do total), contagem por posição", () => {
    exibivelMock.forcar = true;
    const { payload, etiquetas } = impeachmentAberto((ch) =>
      ch.startsWith("senado:900") ? "contra" : "a_favor",
    );
    const r = placarImpeachment(payload, mandatoDeTeste(), etiquetas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.visao.total).toBe(81);
    expect(r.visao.limiar).toBe(54);
    expect(r.visao.linhas).toHaveLength(81);
    expect(r.visao.contagem.aguardando).toBe(48);
    // Linhas por UF (alfabética); a UF nunca é reordenada pela posição.
    const ufs = r.visao.linhas.map((l) => l.uf);
    expect(ufs).toEqual([...ufs].sort());
    expect(
      r.visao.contagem.a_favor + r.visao.contagem.contra + r.visao.contagem.sem_posicao_publica,
    ).toBe(33);
  });

  it("🔴 portão: um senador até 2031 sem posição ⇒ oculta", () => {
    exibivelMock.forcar = true;
    const payload = payloadTresUfs();
    const universo = universoDoPayload(payload, 5);
    const etiquetas = etiquetasDeTeste({
      universo,
      ligadas: ["v2"],
      linhas: {
        "senado-2031.csv": CODIGOS_2031.slice(1).map((c) => ({
          chave: `senado:${c}`,
          categoria: "impeachment_stf",
          valor: "contra",
        })),
        "senador.csv": universo.map((u) => ({
          chave: u.sqcand,
          categoria: "impeachment_stf",
          valor: "contra",
        })),
      },
    });
    expect(placarImpeachment(payload, mandatoDeTeste(), etiquetas)).toMatchObject({
      ok: false,
      motivo: "portao",
    });
  });
});

describe("RF-244 — Câmara 2027 por bloco", () => {
  function bancada(): EdgeBancadaNacional {
    return {
      total_cadeiras: 20,
      cadeiras_atribuidas: 17,
      ufs_calculadas: 3,
      ufs_aguardando: 24,
      por_agremiacao: [
        {
          cod: "22",
          sigla: "PL",
          nome: "PL",
          tipo: "partido",
          componentes: [],
          sigla_lider: "PL",
          cadeiras: 8,
          votos_nominais: 1,
          votos_legenda: 0,
          votos_validos: 1,
          pct_votos: 1,
        },
        {
          cod: "13",
          sigla: "FE BRASIL",
          nome: "Federação Brasil da Esperança",
          tipo: "federacao",
          componentes: ["PT", "PCdoB", "PV"],
          sigla_lider: "PT",
          cadeiras: 6,
          votos_nominais: 1,
          votos_legenda: 0,
          votos_validos: 1,
          pct_votos: 1,
        },
        {
          cod: "55",
          sigla: "PSD",
          nome: "PSD",
          tipo: "partido",
          componentes: [],
          sigla_lider: "PSD",
          cadeiras: 3,
          votos_nominais: 1,
          votos_legenda: 0,
          votos_validos: 1,
          pct_votos: 1,
        },
      ],
    } as unknown as EdgeBancadaNacional;
  }

  function etiquetasCamara(fedLinha = true) {
    const universo = [
      { sqcand: "250000000001", cargo: 6 as const, uf: "SP", partido: "PL", federacao: null },
      {
        sqcand: "250000000002",
        cargo: 6 as const,
        uf: "SP",
        partido: "PT",
        federacao: "PT/PC DO B/PV",
      },
      {
        sqcand: "250000000003",
        cargo: 6 as const,
        uf: "SP",
        partido: "PCDOB",
        federacao: "PT/PC DO B/PV",
      },
      {
        sqcand: "250000000004",
        cargo: 6 as const,
        uf: "SP",
        partido: "PV",
        federacao: "PT/PC DO B/PV",
      },
      { sqcand: "250000000005", cargo: 6 as const, uf: "SP", partido: "PSD", federacao: null },
    ];
    return etiquetasDeTeste({
      universo,
      comFoto: false,
      ligadas: ["camara2027"],
      linhas: {
        "partidos.csv": [
          { chave: "partido:PL", categoria: "relacao_governo", valor: "oposicao" },
          { chave: "partido:PSD", categoria: "relacao_governo", valor: "independente" },
          ...(fedLinha
            ? [
                {
                  chave: "federacao:PT/PC do B/PV",
                  categoria: "relacao_governo",
                  valor: "base_governo",
                },
              ]
            : []),
        ],
      },
    });
  }

  it("🔴 a federação do payload ('FE BRASIL') casa com a do cadastro pelos partidos-membro", () => {
    const e = etiquetasCamara();
    const r = relacaoDaAgremiacao(
      { sigla: "FE BRASIL", tipo: "federacao", componentes: ["PT", "PCdoB", "PV"] },
      e,
    );
    expect(r.estado === "classificado" && r.etiqueta.valor).toBe("base_governo");
    // Membros que apontam para federações diferentes ⇒ a_classificar, nunca palpite.
    expect(
      relacaoDaAgremiacao({ sigla: "X", tipo: "federacao", componentes: ["PT", "PL"] }, e).estado,
    ).toBe("a_classificar");
  });

  it("aberta: 20 cadeiras, 3 sem dono, blocos pelo padrão da agremiação", () => {
    const r = visaoCamara2027(bancada(), etiquetasCamara());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.visao.total).toBe(20);
    expect(r.visao.semDono).toBe(3);
    expect(r.visao.contagem).toEqual({
      base_governo: 6,
      independente: 3,
      aguardando: 3,
      oposicao: 8,
    });
    // Ordem das agremiações = a do payload (a etiqueta não reordena).
    expect(r.visao.agremiacoes.map((a) => a.sigla)).toEqual(["PL", "FE BRASIL", "PSD"]);
  });

  it("🔴 portão: agremiação com cadeira sem padrão ⇒ oculta", () => {
    expect(visaoCamara2027(bancada(), etiquetasCamara(false))).toMatchObject({
      ok: false,
      motivo: "portao",
    });
  });

  it("chave desligada ⇒ oculta", () => {
    const e = etiquetasDeTeste({ comFoto: false });
    expect(visaoCamara2027(bancada(), e)).toMatchObject({ ok: false, motivo: "desligada" });
  });
});

describe("RF-249 — V4, renovação do Senado", () => {
  function payloadRenovacao() {
    // AC concluída (100%): 111 (PL, tenta a reeleição) e 222 (PT, estreante)
    // ficam com as vagas; 333 (MDB, tenta a reeleição) perde. SP em 60%: fora.
    return payloadSenado(
      [
        ufRow("AC", 100, [cand(111, "PL", 40), cand(222, "PT", 30), cand(333, "MDB", 20)]),
        ufRow("SP", 60, [cand(444, "PSD", 50), cand(555, "PL", 30)]),
      ],
      // Contado à mão: AC → PL, PT; SP → PSD, PL.
      [
        { partido: "PL", vagas: 2 },
        { partido: "PSD", vagas: 1 },
        { partido: "PT", vagas: 1 },
      ],
    );
  }

  function mandato2027() {
    // 54 cadeiras: AC com os dois de hoje (PL e MDB); o resto preenchido.
    const ufs = [
      "AC",
      "AL",
      "AM",
      "AP",
      "BA",
      "CE",
      "DF",
      "ES",
      "GO",
      "MA",
      "MG",
      "MS",
      "MT",
      "PA",
      "PB",
      "PE",
      "PI",
      "PR",
      "RJ",
      "RN",
      "RO",
      "RR",
      "RS",
      "SC",
      "SE",
      "SP",
      "TO",
    ];
    const senadores = ufs.flatMap((uf, i) =>
      [0, 1].map((j) => ({
        uf,
        codigo: String(7000 + i * 2 + j),
        nome_parlamentar: `Atual ${uf} ${j}`,
        partido: uf === "AC" ? (j === 0 ? "PL" : "MDB") : "PSD",
        participacao: "Titular",
        legislaturas: [56, 57],
        codigo_mandato: String(6000 + i * 2 + j),
      })),
    );
    return validarMandato2027({
      fonte: "teste",
      fonte_url: "https://exemplo.org",
      consultado_em: "2026-09-29T12:00:00Z",
      versao_dataset: "x",
      senadores,
    });
  }

  function etiquetasRenovacao(faltando?: string) {
    const payload = payloadRenovacao();
    const universo = universoDoPayload(payload, 5);
    const traj: Record<string, string> = {
      [cand(111, "PL", 0).sqcand as string]: "tenta_reeleicao",
      [cand(222, "PT", 0).sqcand as string]: "estreante",
      [cand(333, "MDB", 0).sqcand as string]: "tenta_reeleicao",
    };
    return {
      payload,
      etiquetas: etiquetasDeTeste({
        universo,
        comFoto: false,
        ligadas: ["v4"],
        linhas: {
          "senador.csv": Object.entries(traj)
            .filter(([sq]) => sq !== faltando)
            .map(([sq, v]) => ({ chave: sq, categoria: "trajetoria_cargo", valor: v })),
        },
      }),
    };
  }

  it("mudou de mãos = a PESSOA; troca de partido é o número secundário; só UF concluída", () => {
    const { payload, etiquetas } = etiquetasRenovacao();
    const m = mandato2027();
    expect(m.ok).toBe(true);
    const r = visaoRenovacaoSenado(payload, m, etiquetas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.visao.ufs.map((u) => u.uf)).toEqual(["AC"]);
    expect(r.visao.vagas).toBe(2);
    // 222 (estreante) ocupa uma cadeira que não era dele ⇒ 1 mudou de mãos.
    expect(r.visao.mudaramDeMaos).toBe(1);
    // Hoje: PL + MDB; eleitos: PL + PT ⇒ 1 vaga trocou de partido.
    expect(r.visao.trocaDePartido).toBe(1);
    expect(r.visao.ufs[0]?.derrotados.map((d) => d.nome)).toEqual(["Candidatura 333"]);
  });

  it("🔴 portão: uma candidatura da UF concluída sem trajetória ⇒ oculta", () => {
    const { payload, etiquetas } = etiquetasRenovacao(cand(333, "MDB", 0).sqcand as string);
    expect(visaoRenovacaoSenado(payload, mandato2027(), etiquetas)).toMatchObject({
      ok: false,
      motivo: "portao",
    });
  });

  it("nenhuma UF concluída ⇒ oculta (o que é projeção não 'mudou de mãos')", () => {
    const { etiquetas } = etiquetasRenovacao();
    const payload = payloadSenado(
      [ufRow("SP", 60, [cand(444, "PSD", 50)])],
      [{ partido: "PSD", vagas: 1 }],
    );
    expect(visaoRenovacaoSenado(payload, mandato2027(), etiquetas)).toMatchObject({
      ok: false,
      motivo: "sem_dados",
    });
  });
});
