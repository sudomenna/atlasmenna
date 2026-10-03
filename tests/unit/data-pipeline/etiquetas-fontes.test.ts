/**
 * tests/unit/data-pipeline/etiquetas-fontes.test.ts
 *
 * As portas de entrada do compilador de etiquetas (spec 024): o CSV editado à
 * mão (RF-221), o universo do TSE lido por lista branca de colunas (RF-222,
 * RF-229) e os insumos derivados de outras frentes (RF-226, RF-227, RF-229).
 */

import { describe, expect, it } from "vitest";

import { parseCsvEtiquetas, tokenizarCsv } from "@/data-pipeline/etiquetas-csv";
import {
  camposPessoais,
  lerAlinhamento,
  lerSenado2031,
  lerTrajetoria,
  partidoDaFoto,
} from "@/data-pipeline/etiquetas-insumos";
import { compilarEtiquetas } from "@/data-pipeline/etiquetas-nucleo";
import {
  candidaturaDeCampos,
  escolherArquivosTse,
  montarUniverso,
} from "@/data-pipeline/etiquetas-universo";

import { CABECALHO, entrada, fontesVazias } from "../etiquetas/_fixtures";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("RF-221 — CSV editado à mão", () => {
  it("aspas, vírgula e aspas dentro de campo, CRLF e BOM", () => {
    const texto =
      `﻿${CABECALHO}\r\n` +
      `federacao:PT/PC do B/PV,campo_ideologico,esquerda,,https://x.org,"Programa, página 3",2026-09-01,sim,2026-09-28,"dito ""assim"""\r\n`;
    const { linhas, erros } = parseCsvEtiquetas(texto, "partidos.csv");
    expect(erros).toEqual([]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.linha).toBe(2);
    expect(linhas[0]?.campos.chave).toBe("federacao:PT/PC do B/PV");
    expect(linhas[0]?.campos.fonte_descricao).toBe("Programa, página 3");
    expect(linhas[0]?.campos.nota).toBe('dito "assim"');
  });

  it("chave de federação com espaço e barra, sem aspas, compila", () => {
    const r = compilarEtiquetas(
      entrada({
        "partidos.csv":
          `${CABECALHO}\n` +
          "federacao:PT/PC do B/PV,centrao,nao,,https://x.org,Estatuto,2026-09-01,sim,2026-09-28,\n",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.nacional.padroes)).toEqual(["federacao:PT/PC DO B/PV"]);
  });

  it("quebra de linha dentro de aspas mantém o número da linha do registro", () => {
    const texto = `${CABECALHO}\na,b,c,,u,"linha1\nlinha2",d,sim,e,\nx,y,z,,u,v,d,sim,e,\n`;
    const r = tokenizarCsv(texto);
    expect(r.map((x) => x.linha)).toEqual([1, 2, 4]);
  });

  it("cabeçalho diferente (coluna trocada) é recusado de saída", () => {
    const { erros } = parseCsvEtiquetas(
      "categoria,chave,valor,turno,fonte_url,fonte_descricao,data,revisado,revisado_em,nota\n",
      "x.csv",
    );
    expect(erros[0]?.mensagem).toContain("cabeçalho deve ser exatamente");
  });

  it("número de colunas errado aponta a linha", () => {
    const { erros } = parseCsvEtiquetas(`${CABECALHO}\na,b,c\n`, "x.csv");
    expect(erros[0]).toMatchObject({ linha: 2 });
  });

  it("linhas em branco são ignoradas", () => {
    const { linhas, erros } = parseCsvEtiquetas(`${CABECALHO}\n\n\n`, "x.csv");
    expect([linhas.length, erros.length]).toEqual([0, 0]);
  });

  it("os cinco arquivos existem com o cabeçalho exato", () => {
    for (const texto of Object.values(fontesVazias())) {
      expect(parseCsvEtiquetas(texto, "x").erros).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Universo do TSE
// ---------------------------------------------------------------------------

const COLUNAS_TSE = [
  "SQ_CANDIDATO",
  "CD_CARGO",
  "SG_UF",
  "NM_CANDIDATO",
  "NM_SOCIAL_CANDIDATO",
  "NR_CPF_CANDIDATO",
  "DS_EMAIL",
  "DT_NASCIMENTO",
  "NR_TITULO_ELEITORAL_CANDIDATO",
  "SG_PARTIDO",
  "SG_FEDERACAO",
];
const HEADER = new Map(COLUNAS_TSE.map((c, i) => [c, i]));

function registroTse(over: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    SQ_CANDIDATO: "250002012345",
    CD_CARGO: "6",
    SG_UF: "SP",
    NM_CANDIDATO: "FULANO DE TAL CIVIL",
    NM_SOCIAL_CANDIDATO: "FULANA SOCIAL",
    NR_CPF_CANDIDATO: "12345678901",
    DS_EMAIL: "fulano@exemplo.org",
    DT_NASCIMENTO: "01/02/1970",
    NR_TITULO_ELEITORAL_CANDIDATO: "000011112222",
    SG_PARTIDO: "UNIÃO",
    SG_FEDERACAO: "UNIÃO/PP",
    ...over,
  };
  return COLUNAS_TSE.map((c) => base[c] ?? "");
}

describe("RF-229 — o universo lê só cinco colunas", () => {
  it("conjunto EXATO de chaves de CandidaturaUniverso", () => {
    const c = candidaturaDeCampos(registroTse(), HEADER);
    expect(Object.keys(c ?? {}).sort()).toEqual(["cargo", "federacao", "partido", "sqcand", "uf"]);
  });

  it("🔴 nenhum valor pessoal do CSV chega ao gerado", () => {
    const universo = montarUniverso([
      candidaturaDeCampos(registroTse(), HEADER)!,
      candidaturaDeCampos(
        registroTse({
          SQ_CANDIDATO: "250002012346",
          CD_CARGO: "3",
          SG_FEDERACAO: "#NULO",
          SG_PARTIDO: "PL",
        }),
        HEADER,
      )!,
    ]);
    const r = compilarEtiquetas(entrada({}, { universo }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tudo = JSON.stringify([r.nacional, r.ufs, r.historico]);
    for (const pessoal of [
      "FULANO DE TAL CIVIL",
      "FULANA SOCIAL",
      "12345678901",
      "fulano@exemplo.org",
      "01/02/1970",
      "000011112222",
    ]) {
      expect(tudo).not.toContain(pessoal);
    }
    expect(r.nacional.partidos).toMatchObject({ UNIAO: "UNIAO/PP", PL: null });
  });

  it("cargos fora de 3/5/6 são descartados", () => {
    for (const cargo of ["1", "2", "4", "7", "9", "10"]) {
      expect(candidaturaDeCampos(registroTse({ CD_CARGO: cargo }), HEADER)).toBeNull();
    }
  });

  it("BRASIL é a união — só ele é lido quando existe", () => {
    expect(
      escolherArquivosTse([
        "consulta_cand_2026_BR.csv",
        "consulta_cand_2026_SP.csv",
        "consulta_cand_2026_BRASIL.csv",
        "leiame.pdf",
      ]),
    ).toEqual(["consulta_cand_2026_BRASIL.csv"]);
    expect(escolherArquivosTse(["consulta_cand_2026_SP.csv", "consulta_cand_2026_BR.csv"])).toEqual(
      ["consulta_cand_2026_BR.csv", "consulta_cand_2026_SP.csv"],
    );
  });

  it("duplicata idêntica é descartada; divergente derruba", () => {
    const a = candidaturaDeCampos(registroTse(), HEADER)!;
    expect(montarUniverso([a, { ...a }]).candidaturas.size).toBe(1);
    expect(() => montarUniverso([a, { ...a, partido: "PL" }])).toThrow(/duas vezes/);
  });

  it("🔴 cadastro de 03/10 ('13-PT/65-PC do B/43-PV') dá a MESMA federação do de 12/09", () => {
    const de = (sg: string, sq: string) =>
      candidaturaDeCampos(registroTse({ SQ_CANDIDATO: sq, SG_FEDERACAO: sg }), HEADER)?.federacao;
    expect(de("13-PT/65-PC do B/43-PV", "250002012345")).toBe("PT/PC DO B/PV");
    expect(de("PT/PC do B/PV", "250002012346")).toBe("PT/PC DO B/PV");
    expect(de("44-UNIÃO/11-PP", "250002012347")).toBe("UNIAO/PP");
    expect(de("#NULO", "250002012348")).toBeNull();

    // E a linha `federacao:` escrita à mão no `partidos.csv` existe no universo.
    const universo = montarUniverso([
      candidaturaDeCampos(
        registroTse({ SG_PARTIDO: "PT", SG_FEDERACAO: "13-PT/65-PC do B/43-PV" }),
        HEADER,
      )!,
    ]);
    const r = compilarEtiquetas(
      entrada(
        {
          "partidos.csv":
            `${CABECALHO}\n` +
            "federacao:PT/PC do B/PV,centrao,nao,,https://x.org,Estatuto,2026-09-01,sim,2026-09-28,\n",
        },
        { universo },
      ),
    );
    expect(r.ok ? [] : r.erros.map((e) => e.mensagem)).toEqual([]);
  });

  it("membros de federação são os OBSERVADOS (PCDOB, não 'PC do B')", () => {
    const u = montarUniverso([
      { sqcand: "1", cargo: 6, uf: "SP", partido: "PCDOB", federacao: "PT/PC DO B/PV" },
      { sqcand: "2", cargo: 6, uf: "SP", partido: "PT", federacao: "PT/PC DO B/PV" },
    ]);
    expect([...(u.federacoes.get("PT/PC DO B/PV") ?? [])].sort()).toEqual(["PCDOB", "PT"]);
  });
});

// ---------------------------------------------------------------------------
// Insumos derivados
// ---------------------------------------------------------------------------

describe("insumos derivados — portas de entrada", () => {
  const traj = (extra: Record<string, unknown> = {}) => ({
    gerado_em: "2026-09-26T10:00:00Z",
    universo: 2,
    por_sqcand: { "250002000101": { t: "em_exercicio", camara_ids: [204554] } },
    ...extra,
  });

  it("🔴 trajetória/alinhamento com campo de dado pessoal são recusados", () => {
    expect(camposPessoais({ a: [{ dataNascimento: "x" }] })).toEqual(["$.a[0].dataNascimento"]);
    const t = lerTrajetoria(
      traj({ por_sqcand: { "250002000101": { t: "estreante", camara_ids: [], nome: "X" } } }),
      "camara",
    );
    expect(t.ok).toBe(false);
    const a = lerAlinhamento(
      {
        corte: "2026-09-03",
        por_deputado: { "1": { votos_disputadas: 40, taxa_disputadas: 50, cpf: "1" } },
      },
      "camara",
    );
    expect(a.ok).toBe(false);
  });

  it("trajetória: t desconhecido e ids inválidos são erro; senado_codigos no Senado", () => {
    expect(lerTrajetoria(traj({ por_sqcand: { "1": { t: "talvez" } } }), "camara").ok).toBe(false);
    expect(
      lerTrajetoria(traj({ por_sqcand: { "1": { t: "estreante", camara_ids: [-1] } } }), "camara")
        .ok,
    ).toBe(false);
    const s = lerTrajetoria(
      {
        gerado_em: "2026-09-29T00:00:00Z",
        universo: 1,
        fonte: "https://legis.senado.leg.br/x",
        por_sqcand: { "250002000011": { t: "mandato_anterior", senado_codigos: [5012] } },
      },
      "senado",
    );
    expect(s.ok && [...s.valor.por_sqcand.values()][0]).toEqual({
      t: "mandato_anterior",
      ids: ["5012"],
    });
    expect(s.ok && s.valor.fonte.fonte_url).toBe("https://legis.senado.leg.br/x");
  });

  it("alinhamento da Câmara: corte tem de ser o do catálogo; taxa fora de 0–100 e fração são erro", () => {
    expect(lerAlinhamento({ corte: "2026-09-10", por_deputado: {} }, "camara").ok).toBe(false);
    expect(
      lerAlinhamento(
        {
          corte: "2026-09-03",
          por_deputado: { "1": { votos_disputadas: 40, taxa_disputadas: 101 } },
        },
        "camara",
      ).ok,
    ).toBe(false);
    const fracao: Record<string, unknown> = {};
    for (let i = 1; i <= 12; i++)
      fracao[String(i)] = { votos_disputadas: 50, taxa_disputadas: 0.7 };
    const r = lerAlinhamento({ corte: "2026-09-03", por_deputado: fracao }, "camara");
    expect(r.ok === false && r.erros[0]).toContain("parece fração");
  });

  it("alinhamento do Senado: lê por_senador e aceita o próprio corte", () => {
    const r = lerAlinhamento(
      {
        corte: "2026-09-15",
        fonte: { descricao: "Senado — votações", url: "https://legis.senado.leg.br/" },
        universo: { votacoes: 100, disputadas: 60, excluidas_sem_sequencial: 2 },
        por_senador: { "5012": { votos_disputadas: 45, taxa_disputadas: 71.2 } },
      },
      "senado",
    );
    expect(r.ok && r.valor.por_id.get("5012")).toEqual({
      votos_disputadas: 45,
      taxa_disputadas: 71.2,
    });
    expect(r.ok && r.valor.fonte).toEqual({
      fonte_url: "https://legis.senado.leg.br/",
      fonte_descricao: "Senado — votações",
      data: "2026-09-15",
    });
  });

  it("🔴 carimbo de revisão (§ 2 (b)): sem bloco ou 'nao' ⇒ pendente; 'sim' exige data e nome", () => {
    const sem = lerTrajetoria(traj({ universo: 1 }), "camara");
    expect(sem.ok && sem.valor.revisao).toEqual({ estado: "pendente", motivo: "sem_carimbo" });
    const nao = lerTrajetoria(
      traj({ revisao: { revisado: "nao", revisado_em: null, por: null } }),
      "camara",
    );
    expect(nao.ok && nao.valor.revisao).toEqual({ estado: "pendente", motivo: "nao_revisado" });
    const sim = lerAlinhamento(
      {
        revisao: { revisado: "sim", revisado_em: "2026-09-28", por: " Dono " },
        corte: "2026-09-03",
        por_deputado: {},
      },
      "camara",
    );
    expect(sim.ok && sim.valor.revisao).toEqual({
      estado: "aprovado",
      revisado_em: "2026-09-28",
      por: "Dono",
    });
    for (const ruim of [
      { revisado: "sim", revisado_em: null, por: "Dono" },
      { revisado: "sim", revisado_em: "2026-09-28", por: null },
      { revisado: "sim", revisado_em: "2026-09-28", por: "   " },
      { revisado: "sim", revisado_em: "2026-02-30", por: "Dono" },
      { revisado: "talvez", revisado_em: null, por: null },
      "sim",
    ]) {
      const r = lerTrajetoria(traj({ revisao: ruim }), "camara");
      expect(r.ok, JSON.stringify(ruim)).toBe(false);
    }
  });

  it("foto do Senado: formato tolerante, só código/UF/partido, S/Partido ⇒ null", () => {
    const r = lerSenado2031({
      data_foto: "2026-09-29",
      senadores: [
        {
          codigo_parlamentar: 5012,
          uf: "rj",
          partido_atual: "S/Partido",
          nome: "NOME QUE NÃO PODE VAZAR",
        },
        { codigo: "5013", sigla_uf: "SP", sigla_partido: "PL" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.valor.senadores.entries()]).toEqual([
      ["5012", { uf: "RJ", partido: null }],
      ["5013", { uf: "SP", partido: "PL" }],
    ]);
    expect(r.valor.completo).toBe(false);
    expect(r.avisos[0]).toContain("indisponível para o portão");
    expect(JSON.stringify([...r.valor.senadores])).not.toContain("NOME QUE NÃO PODE VAZAR");
  });

  it("S/Partido e variantes", () => {
    for (const v of ["S/Partido", "S/PARTIDO", "Sem partido", "-", ""])
      expect(partidoDaFoto(v)).toBeNull();
    expect(partidoDaFoto("União")).toBe("UNIAO");
  });

  it("foto do Senado com código repetido é erro", () => {
    expect(
      lerSenado2031([
        { codigo: 1, uf: "SP" },
        { codigo: 1, uf: "RJ" },
      ]).ok,
    ).toBe(false);
  });
});
