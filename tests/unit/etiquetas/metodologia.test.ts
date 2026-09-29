/**
 * tests/unit/etiquetas/metodologia.test.ts — a lista pública de TODAS as
 * classificações no ar (constituição 1.6 § 8; spec 025, RF-252; auditoria de
 * 29/09): individuais e padrões (`linhasPublicadas`) e, agora, as derivadas
 * (`linhasDerivadasPublicadas`), com a medida; e o CSV público que as reúne.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

import { GET } from "@/app/sobre-as-etiquetas/classificacoes.csv/route";
import type { AlinhamentoInsumo, TrajetoriaInsumo } from "@/data-pipeline/etiquetas-insumos";
import {
  COLUNAS_CSV_CLASSIFICACOES,
  csvDasClassificacoes,
  type LinhaPublicada,
  linhasDerivadasPublicadas,
  linhasPublicadas,
} from "@/lib/etiquetas/metodologia";

import {
  compilarOk,
  csv,
  DEP_SP_PL,
  DEP_SP_PT,
  entrada,
  SEN_SP_PL,
  senadoTeste,
} from "./_fixtures";

type Revisao = TrajetoriaInsumo["revisao"];
const APROVADO: Revisao = { estado: "aprovado", revisado_em: "2026-09-28", por: "Dono" };
const PENDENTE: Revisao = { estado: "pendente", motivo: "nao_revisado" };

function traj(
  casa: "camara" | "senado",
  por: Record<string, { t: "em_exercicio" | "estreante"; ids?: string[] }>,
  universo: number,
  revisao: Revisao,
): TrajetoriaInsumo {
  return {
    casa,
    revisao,
    gerado_em: "2026-09-26T10:00:00Z",
    universo,
    por_sqcand: new Map(Object.entries(por).map(([k, v]) => [k, { t: v.t, ids: v.ids ?? [] }])),
    fonte: {
      fonte_url: `https://${casa}.exemplo/`,
      fonte_descricao: `Trajetória ${casa}`,
      data: "2026-09-26",
    },
  };
}

function alin(
  casa: "camara" | "senado",
  por: Record<string, [number, number]>,
  revisao: Revisao,
): AlinhamentoInsumo {
  return {
    casa,
    revisao,
    corte: "2026-09-03",
    por_id: new Map(
      Object.entries(por).map(([k, [v, t]]) => [k, { votos_disputadas: v, taxa_disputadas: t }]),
    ),
    fonte: {
      fonte_url: `https://${casa}.exemplo/votos`,
      fonte_descricao: "Votações, disputadas",
      data: "2026-09-03",
    },
  };
}

function compilar(revisao: Revisao) {
  return compilarOk(
    entrada(
      {
        // Linha individual para o PT de SP: vence a regra derivada na relação.
        "deputados-excecoes.csv": csv({
          chave: DEP_SP_PT,
          categoria: "relacao_governo",
          valor: "independente",
        }),
      },
      {
        senado2031: senadoTeste(),
        derivados: {
          trajetoria_camara: traj(
            "camara",
            {
              [DEP_SP_PT]: { t: "em_exercicio", ids: ["11"] },
              [DEP_SP_PL]: { t: "em_exercicio", ids: ["12"] },
            },
            5,
            revisao,
          ),
          alinhamento_camara: alin("camara", { "11": [100, 90], "12": [40, 20.123] }, revisao),
          trajetoria_senado: traj("senado", { [SEN_SP_PL]: { t: "estreante" } }, 2, revisao),
          alinhamento_senado: alin("senado", { "5000": [40, 80] }, revisao),
        },
      },
    ),
  );
}

describe("🔴 § 8 — as classificações por regra derivada entram na lista pública", () => {
  it("uma linha por candidatura e categoria EM VIGOR, com fonte, datas e a medida", () => {
    const r = compilar(APROVADO);
    const linhas = linhasDerivadasPublicadas(r.nacional, Object.values(r.ufs));
    const chave = (l: LinhaPublicada) => `${l.chave}|${l.categoria}|${l.valor}`;
    expect(linhas.map(chave)).toEqual([
      `${SEN_SP_PL}|trajetoria_cargo|estreante`,
      "senado:5000|relacao_governo|base_governo",
      `${DEP_SP_PT}|trajetoria_cargo|tenta_reeleicao`,
      // DEP_SP_PT NÃO aparece em relacao_governo: a linha individual vence.
      `${DEP_SP_PL}|relacao_governo|oposicao`,
      `${DEP_SP_PL}|trajetoria_cargo|tenta_reeleicao`,
    ]);
    for (const l of linhas) {
      expect(l.origem).toBe("derivado");
      expect(l.revisado_em).toBe("2026-09-28");
    }
    const pl = linhas.find((l) => l.chave === DEP_SP_PL && l.categoria === "relacao_governo");
    expect(pl?.medida).toEqual({ votos: 40, taxa: 20.12 });
    expect(pl?.fonte_url).toBe("https://camara.exemplo/votos");
    expect(pl?.data).toBe("2026-09-03");
    // Trajetória não tem medida.
    const tr = linhas.find((l) => l.chave === DEP_SP_PL && l.categoria === "trajetoria_cargo");
    expect(tr?.medida).toBeUndefined();
    // A individual segue na lista das linhas.
    const ind = linhasPublicadas(r.nacional, Object.values(r.ufs));
    expect(ind.map((l) => [l.chave, l.origem])).toContainEqual([DEP_SP_PT, "individual"]);
  });

  it("🔴 derivado sem a aprovação do dono ⇒ NENHUMA linha derivada (nem medida no gerado)", () => {
    const r = compilar(PENDENTE);
    expect(linhasDerivadasPublicadas(r.nacional, Object.values(r.ufs))).toEqual([]);
  });
});

describe("CSV público das classificações", () => {
  const base: LinhaPublicada = {
    chave: "partido:PT",
    alvo: "padrao",
    uf: null,
    partido: null,
    categoria: "relacao_governo",
    turno: null,
    valor: "base_governo",
    rotulo: "Base do governo",
    origem: "partido",
    fonte_url: "https://exemplo.org/a",
    fonte_descricao: 'Nota "oficial", 12/09',
    data: "2026-09-12",
    revisado_em: "2026-09-28",
  };

  it("cabeçalho fixo, aspas RFC 4180, sqcand só para candidatura, medida só quando há", () => {
    const texto = csvDasClassificacoes(
      [
        base,
        {
          ...base,
          chave: DEP_SP_PL,
          alvo: "deputado",
          uf: "SP",
          partido: "PL",
          valor: "oposicao",
          rotulo: "Oposição",
          origem: "derivado",
          fonte_descricao: "Votações",
          medida: { votos: 40, taxa: 20.12 },
        },
      ],
      new Map([[DEP_SP_PL, "FULANO DA SILVA"]]),
    );
    const [cab, l1, l2, fim] = texto.split("\n");
    expect(cab).toBe(COLUNAS_CSV_CLASSIFICACOES.join(","));
    expect(l1).toBe(
      'partido:PT,padrao,,,,,,relacao_governo,base_governo,Base do governo,,partido,https://exemplo.org/a,"Nota ""oficial"", 12/09",2026-09-12,2026-09-28,,',
    );
    expect(l2).toBe(
      `${DEP_SP_PL},deputado,SP,6,${DEP_SP_PL},FULANO DA SILVA,PL,relacao_governo,oposicao,Oposição,,derivado,https://exemplo.org/a,Votações,2026-09-12,2026-09-28,40,20.12`,
    );
    expect(fim).toBe("");
    // Nenhuma coluna de dado pessoal.
    expect(cab).not.toMatch(/nasc|cpf|titulo|mail|civil|social/i);
  });

  it("a rota serve o CSV da cópia do build — hoje só o cabeçalho (nada revisado, derivados pendentes)", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const texto = await res.text();
    expect(texto.split("\n")[0]).toBe(COLUNAS_CSV_CLASSIFICACOES.join(","));
    // Se um dia houver classificação revisada no ar, este número cresce — e o
    // teste de deriva garante que é a MESMA cópia do build.
    expect(texto.trim().split("\n")).toHaveLength(1);
  });
});
