/**
 * tests/unit/etiquetas/vigia.test.ts
 *
 * O vigia das etiquetas (spec 024, RF-234): top-4 nas duas bases, anulado
 * fora, agremiação com cadeira, silêncio na pré-eleição, e a carga do
 * ambiente por lista branca (nunca `DATABASE_URL`).
 */

import { describe, expect, it } from "vitest";

import type { EdgePayload, EdgePayloadDeputado } from "@/lib/edge-config/types";
import type { ArquivoUf } from "@/lib/etiquetas/formato";
import { montarEtiquetas } from "@/lib/etiquetas/leitor";
import type { CandidatoNaCorrida } from "@/lib/etiquetas/portao";
import {
  avaliarVigiaEtiquetas,
  formatarAlerta,
  TOP_VIGIADO,
  topNasDuasBases,
} from "@/lib/etiquetas/vigia";
import { ENV_DO_VIGIA_ETIQUETAS, envDoVigiaEtiquetas } from "@/scripts/etiquetas-vigia";

import {
  compilarOk,
  csv,
  entrada,
  GOV_RJ_PSD,
  GOV_SP_PL,
  GOV_SP_PT,
  SEN_SP_PL,
  SEN_SP_PT,
} from "./_fixtures";
import { expectOrdemInvariante } from "./ordem-invariante";

function etiquetas(fontes: Parameters<typeof entrada>[0] = {}) {
  const r = compilarOk(entrada(fontes));
  return montarEtiquetas(r.nacional, "embutido", r.ufs.SP as ArquivoUf);
}

function payload(
  cargo: 3 | 5,
  linhas: Array<{ sigla: string; pct_apurado: number; top: unknown[] }>,
  fase?: "pre_eleicao",
): EdgePayload {
  return {
    cargo,
    turno: 1,
    ...(fase ? { fase } : {}),
    por_uf: linhas.map((l) => ({
      sigla: l.sigla,
      pct_apurado: l.pct_apurado,
      top_candidatos: l.top,
    })),
  } as unknown as EdgePayload;
}

const CLASSIFICADO_GOV = [
  { categoria: "relacao_governo", valor: "base_governo" },
  { categoria: "palanque_presidencial", valor: "palanque_lula", turno: "1" },
];

describe("RF-234 — top-4 nas duas bases", () => {
  it("o top vigiado é 4", () => {
    expect(TOP_VIGIADO).toBe(4);
  });

  it("união de Projeção e Parcial, na ordem de entrada, sem anulado", () => {
    const c = (
      s: string,
      p: number,
      a: number | null,
      destino?: "anulado",
    ): CandidatoNaCorrida => ({
      sqcand: s,
      pct_projetado: p,
      pct_atual: a,
      destino,
    });
    const lista = [
      c("1", 50, 1),
      c("2", 40, 2),
      c("3", 30, 3),
      c("4", 20, 4),
      c("5", 1, 60),
      c("6", 60, 0, "anulado"),
    ];
    expect(topNasDuasBases(lista, 4, 10).map((x) => x.sqcand)).toEqual(["1", "2", "3", "4", "5"]);
    expect(topNasDuasBases(lista, 4, 0).map((x) => x.sqcand)).toEqual(["1", "2", "3", "4"]);
  });

  it("🔴 a seleção não depende de quem está classificado (RF-238)", () => {
    const lista = ["11", "12", "13", "14", "15"].map((s, i) => ({
      sqcand: s,
      pct_projetado: 50 - i * 7,
      pct_atual: i * 9,
    }));
    expectOrdemInvariante({
      ids: lista.map((x) => x.sqcand),
      ordenar: () => topNasDuasBases(lista, 4, 50).map((x) => String(x.sqcand)),
    });
  });
});

describe("RF-234 — alertas", () => {
  it("alerta quem entra no top-4 sem classificação, dizendo o que falta", () => {
    const e = etiquetas({
      "governador.csv": csv(...CLASSIFICADO_GOV.map((l) => ({ chave: GOV_SP_PT, ...l }))),
    });
    const v = avaliarVigiaEtiquetas({
      gov: payload(3, [
        {
          sigla: "SP",
          pct_apurado: 30,
          top: [
            { id: 13, pct: 45, pct_atual: 44, sqcand: GOV_SP_PT },
            { id: 22, pct: 40, pct_atual: 41, sqcand: GOV_SP_PL, nome: "Fulano" },
            { id: 99, pct: 10, nome: "Sem Sqcand" },
          ],
        },
      ]),
      sen: null,
      dep: null,
      turnoGov: 1,
      etiquetas: e,
    });
    expect(v.estado).toBe("alerta");
    expect(v.alertas.map((a) => [a.chave, a.motivo, a.faltam])).toEqual([
      [GOV_SP_PL, "a_classificar", ["palanque_presidencial", "relacao_governo"]],
      [null, "sem_sqcand", ["palanque_presidencial", "relacao_governo"]],
    ]);
    expect(formatarAlerta(v.alertas[0]!)).toContain("Governador SP: Fulano nº 22");
  });

  it("Senado vigia também o impeachment", () => {
    const v = avaliarVigiaEtiquetas({
      gov: null,
      sen: payload(5, [
        { sigla: "SP", pct_apurado: 5, top: [{ id: 131, pct: 30, sqcand: SEN_SP_PT }] },
      ]),
      dep: null,
      turnoGov: 1,
      etiquetas: etiquetas(),
    });
    expect(v.alertas[0]?.faltam).toEqual([
      "palanque_presidencial",
      "relacao_governo",
      "impeachment_stf",
    ]);
  });

  it("anulado no top não gera alerta; classificado não gera alerta", () => {
    const e = etiquetas({
      "governador.csv": csv(...CLASSIFICADO_GOV.map((l) => ({ chave: GOV_SP_PT, ...l }))),
    });
    const v = avaliarVigiaEtiquetas({
      gov: payload(3, [
        {
          sigla: "SP",
          pct_apurado: 30,
          top: [
            { id: 13, pct: 45, sqcand: GOV_SP_PT },
            { id: 22, pct: 40, sqcand: GOV_SP_PL, destino: "anulado" },
          ],
        },
      ]),
      sen: null,
      dep: null,
      turnoGov: 1,
      etiquetas: e,
    });
    expect(v).toEqual({ estado: "ok", alertas: [] });
  });

  it("pré-eleição: silêncio", () => {
    const v = avaliarVigiaEtiquetas({
      gov: payload(
        3,
        [{ sigla: "RJ", pct_apurado: 0, top: [{ id: 1, pct: 0, sqcand: GOV_RJ_PSD }] }],
        "pre_eleicao",
      ),
      sen: null,
      dep: null,
      turnoGov: 1,
      etiquetas: etiquetas(),
    });
    expect(v.estado).toBe("nao_comecou");
  });

  it("Deputado: agremiação com cadeira sem padrão", () => {
    const dep = {
      cargo: 6,
      turno: 1,
      bancada: {
        por_agremiacao: [
          { sigla: "PL", nome: "Partido Liberal", tipo: "partido", cadeiras: 90 },
          {
            sigla: "PT/PC do B/PV",
            nome: "Federação Brasil da Esperança",
            tipo: "federacao",
            cadeiras: 80,
          },
          { sigla: "PCO", nome: "PCO", tipo: "partido", cadeiras: 0 },
        ],
      },
    } as unknown as EdgePayloadDeputado;
    const v = avaliarVigiaEtiquetas({
      gov: null,
      sen: null,
      dep,
      turnoGov: 1,
      etiquetas: etiquetas({
        "partidos.csv": csv(
          { chave: "partido:PL", categoria: "relacao_governo", valor: "oposicao" },
          {
            chave: "partido:PL",
            categoria: "palanque_presidencial",
            valor: "palanque_flavio_bolsonaro",
            turno: "1",
          },
        ),
      }),
    });
    expect(v.alertas.map((a) => [a.chave, a.motivo])).toEqual([["PT/PC do B/PV", "agremiacao"]]);
  });

  it("categorias escolhidas pelo operador", () => {
    const v = avaliarVigiaEtiquetas({
      gov: payload(3, [
        { sigla: "SP", pct_apurado: 10, top: [{ id: 1, pct: 10, sqcand: GOV_SP_PL }] },
      ]),
      sen: null,
      dep: null,
      turnoGov: 1,
      etiquetas: etiquetas(),
      categorias: ["campo_ideologico"],
    });
    expect(v.alertas[0]?.faltam).toEqual(["campo_ideologico"]);
  });

  void SEN_SP_PL;
});

describe("RF-234 — ambiente por lista branca", () => {
  const ENV_LOCAL = [
    "DATABASE_URL=postgres://producao",
    "BLOB_READ_WRITE_TOKEN=vercel_blob_rw_x_y",
    'EDGE_CONFIG="https://edge-config.vercel.com/ecfg_x?token=abc=="',
    "BLOB_PUBLIC_BASE_URL=https://store.public.blob.vercel-storage.com",
    "CRON_SECRET=segredo",
  ].join("\n");

  it("🔴 só EDGE_CONFIG e BLOB_PUBLIC_BASE_URL entram — nunca banco nem token de escrita", () => {
    const sel = envDoVigiaEtiquetas(ENV_LOCAL, {});
    expect(Object.keys(sel).sort()).toEqual(["BLOB_PUBLIC_BASE_URL", "EDGE_CONFIG"]);
    expect(sel.EDGE_CONFIG).toBe("https://edge-config.vercel.com/ecfg_x?token=abc==");
    expect([...ENV_DO_VIGIA_ETIQUETAS]).toEqual(["EDGE_CONFIG", "BLOB_PUBLIC_BASE_URL"]);
  });

  it("o ambiente real vence o arquivo, e só para as chaves da lista", () => {
    const sel = envDoVigiaEtiquetas(ENV_LOCAL, { EDGE_CONFIG: "https://outro", DATABASE_URL: "x" });
    expect(sel).toEqual({
      EDGE_CONFIG: "https://outro",
      BLOB_PUBLIC_BASE_URL: "https://store.public.blob.vercel-storage.com",
    });
  });
});
