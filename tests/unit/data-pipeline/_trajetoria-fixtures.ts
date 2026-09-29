// Fixture SINTÉTICA compartilhada pelos testes do cálculo e da exportação da
// trajetória na Câmara (spec 018, RF-214, ADR-0058). Nomes e datas inventados;
// reproduzem os padrões medidos em 26/09 (nome social diferente do civil,
// deputado estadual com ocupação "DEPUTADO", a mesma pessoa em dois cargos),
// não as pessoas.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  construirIndiceCamara,
  type DeputadoCamara,
  type IndiceCamara,
} from "@/data-pipeline/trajetoria-camara.ts";

export const COLS_PRINCIPAL = [
  "DT_GERACAO",
  "HH_GERACAO",
  "NR_TURNO",
  "CD_ELEICAO",
  "SG_UF",
  "CD_CARGO",
  "SQ_CANDIDATO",
  "NR_CANDIDATO",
  "NM_CANDIDATO",
  "NM_URNA_CANDIDATO",
  "NM_SOCIAL_CANDIDATO",
  "DT_NASCIMENTO",
  "DS_OCUPACAO",
  "NR_PARTIDO",
  "SG_PARTIDO",
  "NM_PARTIDO",
  "SG_FEDERACAO",
  "NM_COLIGACAO",
] as const;

export const COLS_COMPLEMENTAR = [
  "SQ_CANDIDATO",
  "ST_CANDIDATO_INSERIDO_URNA",
  "DS_SITUACAO_JULGAMENTO",
  "ST_SUBSTITUIDO",
  "SQ_SUBSTITUIDO",
] as const;

export const H_PRINCIPAL = new Map<string, number>(COLS_PRINCIPAL.map((c, i) => [c, i]));
export const H_COMPLEMENTAR = new Map<string, number>(COLS_COMPLEMENTAR.map((c, i) => [c, i]));

export function linhaPrincipal(o: Record<string, string>): string[] {
  const base: Record<string, string> = {
    DT_GERACAO: "12/09/2026",
    HH_GERACAO: "19:31:30",
    NR_TURNO: "1",
    CD_ELEICAO: "6259",
    SG_UF: "SP",
    CD_CARGO: "6",
    NR_CANDIDATO: "1234",
    NM_SOCIAL_CANDIDATO: "#NULO",
    DS_OCUPACAO: "EMPRESÁRIO",
    NR_PARTIDO: "12",
    SG_PARTIDO: "PX",
    NM_PARTIDO: "PARTIDO X",
    SG_FEDERACAO: "#NULO",
    NM_COLIGACAO: "#NE",
  };
  return COLS_PRINCIPAL.map((c) => o[c] ?? base[c] ?? "");
}

export const linhaComplementar = (sq: string): string[] => [sq, "SIM", "DEFERIDO", "N", "-1"];

/**
 * Seis linhas do arquivo principal. SQs com 11 e 12 dígitos, fora de ordem,
 * para a ordenação numérica ser posta à prova.
 */
export const PRINCIPAIS: string[][] = [
  // em exercício, casamento exato
  linhaPrincipal({
    SQ_CANDIDATO: "250000000001",
    NM_CANDIDATO: "FULANO DE TAL",
    NM_URNA_CANDIDATO: "FULANO",
    DT_NASCIMENTO: "02/01/1970",
  }),
  // deputado ESTADUAL: ocupação "DEPUTADO", sem registro na Câmara
  linhaPrincipal({
    SQ_CANDIDATO: "90000000002",
    NM_CANDIDATO: "BELTRANO SILVA",
    NM_URNA_CANDIDATO: "BELTRANO",
    DT_NASCIMENTO: "03/03/1975",
    DS_OCUPACAO: "DEPUTADO",
  }),
  // a mesma pessoa do primeiro, mas concorrendo a Governador (cargo 3)
  linhaPrincipal({
    SQ_CANDIDATO: "250000000003",
    CD_CARGO: "3",
    NR_CANDIDATO: "12",
    NM_CANDIDATO: "FULANO DE TAL",
    NM_URNA_CANDIDATO: "FULANO",
    DT_NASCIMENTO: "02/01/1970",
  }),
  // só casa pelo nome social — mandato em legislatura anterior
  linhaPrincipal({
    SQ_CANDIDATO: "100000000004",
    NM_CANDIDATO: "RAFAELA MOTA DUARTE",
    NM_URNA_CANDIDATO: "RAFAELA DUARTE",
    NM_SOCIAL_CANDIDATO: "RAFA BRANDÃO",
    DT_NASCIMENTO: "04/04/1990",
  }),
  // exerceu na 57ª e não está em exercício hoje
  linhaPrincipal({
    SQ_CANDIDATO: "100000000005",
    NM_CANDIDATO: "CICRANA PEREIRA",
    NM_URNA_CANDIDATO: "CICRANA",
    DT_NASCIMENTO: "05/05/1980",
  }),
  // estreante sem data de nascimento legível
  linhaPrincipal({
    SQ_CANDIDATO: "100000000006",
    NM_CANDIDATO: "JOANA SEM DATA",
    NM_URNA_CANDIDATO: "JOANA",
    DT_NASCIMENTO: "#NULO#",
  }),
];

export const COMPLEMENTARES: string[][] = PRINCIPAIS.map((l) =>
  linhaComplementar(l[H_PRINCIPAL.get("SQ_CANDIDATO") as number] as string),
);

/** Tudo o que a saída NUNCA pode conter: datas de nascimento, nomes, ocupação. */
export const PROIBIDOS_NA_SAIDA = [
  "02/01/1970",
  "1970-01-02",
  "03/03/1975",
  "1975-03-03",
  "04/04/1990",
  "1990-04-04",
  "05/05/1980",
  "1980-05-05",
  "FULANO",
  "BELTRANO",
  "RAFA",
  "BRANDÃO",
  "CICRANA",
  "JOANA",
  "DEPUTADO",
  "EMPRESÁRIO",
  "nascimento",
  "nome",
];

export function deputado(over: Partial<DeputadoCamara>): DeputadoCamara {
  return {
    id: 101,
    nomeParlamentar: "Fulano Parlamentar",
    nomeCivil: "FULANO DE TAL",
    nascimento: "1970-01-02",
    legislaturaInicial: 55,
    legislaturaFinal: 56,
    ...over,
  };
}

export const DEPUTADOS: DeputadoCamara[] = [
  deputado({ id: 7, nomeCivil: "FULANO DE TAL", legislaturaInicial: 56, legislaturaFinal: 57 }),
  deputado({
    id: 15,
    nomeCivil: "RAFAELA COSTA BRANDAO",
    nomeParlamentar: "Rafa Brandão",
    nascimento: "1990-04-04",
    legislaturaInicial: 52,
    legislaturaFinal: 53,
  }),
  deputado({
    id: 31,
    nomeCivil: "CICRANA PEREIRA",
    nomeParlamentar: "Cicrana",
    nascimento: "1980-05-05",
    legislaturaInicial: 57,
    legislaturaFinal: 57,
  }),
];

export const EM_EXERCICIO = [7];

export const indiceFixture = (): IndiceCamara => construirIndiceCamara(DEPUTADOS, EM_EXERCICIO);

/** O que a fixture tem de produzir, por SQ. */
export const ESPERADO = {
  "250000000001": { trajetoria: "em_exercicio", camaraIds: [7] },
  "90000000002": { trajetoria: "estreante", camaraIds: null },
  "100000000004": { trajetoria: "mandato_anterior", camaraIds: [15] },
  "100000000005": { trajetoria: "legislatura_atual", camaraIds: [31] },
  "100000000006": { trajetoria: "estreante", camaraIds: null },
} as const;

// ---------------------------------------------------------------------------
// Em disco — o formato real dos caches (TSE latin1 `;` com aspas; Câmara UTF-8)
// ---------------------------------------------------------------------------

const csvTse = (linhas: readonly (readonly string[])[]) =>
  `${linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n")}\n`;

/** Grava `consulta_cand_2026_BRASIL.csv` e o complementar sob `tseDir`. */
export function gravarCacheTse(
  tseDir: string,
  mkdir: (p: string) => void,
  principais: readonly (readonly string[])[] = PRINCIPAIS,
  complementares: readonly (readonly string[])[] = COMPLEMENTARES,
): void {
  mkdir(join(tseDir, "consulta_cand_2026"));
  mkdir(join(tseDir, "consulta_cand_complementar_2026"));
  writeFileSync(
    join(tseDir, "consulta_cand_2026/consulta_cand_2026_BRASIL.csv"),
    csvTse([COLS_PRINCIPAL, ...principais]),
    "latin1",
  );
  writeFileSync(
    join(tseDir, "consulta_cand_complementar_2026/consulta_cand_complementar_2026_BRASIL.csv"),
    csvTse([COLS_COMPLEMENTAR, ...complementares]),
    "latin1",
  );
}

/**
 * Grava `deputados.csv` e `deputados_em_exercicio.json` sob `camaraDir`, com os
 * `DEPUTADOS` da fixture mais enchimento até passar a sanidade da fonte
 * (≥ 7.000 no histórico, 500–513 em exercício). O enchimento nasce em 1800 —
 * nenhum candidato da fixture casa com ele.
 */
export function gravarCacheCamara(camaraDir: string): void {
  const cab =
    '"uri";"nome";"idLegislaturaInicial";"idLegislaturaFinal";"nomeCivil";"cpf";"dataNascimento"';
  const reais = DEPUTADOS.map(
    (d) =>
      `"https://x/api/v2/deputados/${d.id}";"${d.nomeParlamentar}";"${d.legislaturaInicial}";"${d.legislaturaFinal}";"${d.nomeCivil}";"";"${d.nascimento}"`,
  );
  const enchimento = Array.from(
    { length: 7000 },
    (_, i) =>
      `"https://x/api/v2/deputados/${100000 + i}";"P${i}";"10";"11";"PESSOA ${i}";"";"1800-01-01"`,
  );
  writeFileSync(
    join(camaraDir, "deputados.csv"),
    `﻿${[cab, ...reais, ...enchimento].join("\n")}\n`,
    "utf8",
  );
  const ids = [...EM_EXERCICIO, ...Array.from({ length: 509 }, (_, i) => 100000 + i)];
  writeFileSync(
    join(camaraDir, "deputados_em_exercicio.json"),
    JSON.stringify({ dados: ids.map((id) => ({ id })), links: [] }),
    "utf8",
  );
}
