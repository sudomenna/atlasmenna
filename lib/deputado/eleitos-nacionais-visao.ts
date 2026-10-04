/**
 * lib/deputado/eleitos-nacionais-visao.ts — spec 026 RF-299 e RF-300.
 *
 * O que o NAVEGADOR deriva da resposta de `GET /deputado-federal/eleitos`
 * ({@link EleitosNacionais}, `lib/deputado/eleitos-nacionais.ts`): a visão do
 * cenário projetado nacional e o rótulo do misto.
 *
 * Mora fora do agregador de propósito: aquele módulo lê o Blob por tabela e
 * nunca vai ao navegador; este não importa nada além de tipos — é o que a
 * ilha `<BancadaEleitosNacional>` carrega acima da dobra, e precisa ser
 * pequeno.
 *
 * ## Dois pontos de leitura do interruptor (ADR-0063 D4, emenda 04/10 (2) item 5)
 *
 * A rota lê o interruptor e omite a projeção quando ele está desligado; a
 * PÁGINA, que o lê a cada renderização, entrega o estado dela à ilha
 * (`ligadaNaPagina`). Com a página dizendo "desligada", toda projeção da
 * resposta é IGNORADA aqui — o CDN pode servir, por até 60 s + 60 s, uma
 * resposta montada antes do desligamento.
 */

import type { EleitosNacionais, LinhaEleitoNacional } from "./eleitos-nacionais";

/** Índices da {@link LinhaEleitoNacional}, para ninguém ler `linha[6]` sem nome. */
export const LN = {
  UF: 0,
  SQCAND: 1,
  NOME: 2,
  PARTIDO: 3,
  NUMERO: 4,
  VOTOS: 5,
  PCT: 6,
  MARCAS: 7,
  FOTO: 8,
} as const;

export type { EleitosNacionais, LinhaEleitoNacional };

/** O que a tela usa do cenário, já com os dois pontos de leitura do interruptor. */
export interface VisaoDoCenario {
  /** A projeção vale nesta tela: a página E a rota a leram ligada. */
  ligada: boolean;
  /** UFs cuja projeção conta (vazio com `ligada: false`). */
  liberadas: ReadonlySet<string>;
  /** X — UFs liberadas. */
  x: number;
  /** Y — UFs com dado que contam a parcial (inclui as liberadas que a página desligou). */
  y: number;
  /** W — UFs com totalização final (contam o resultado do TSE). */
  w: number;
  /** Z — UFs sem dado, fora da conta. */
  z: number;
  /** O tamanho da casa (`ufs_total`, da lista fechada da rota — nunca um literal). */
  total: number;
  /** Há cenário a mostrar: projeção ligada E ao menos uma UF liberada (X > 0). */
  pronto: boolean;
  /** `cod` → parcial e cenário. Com a projeção desligada, `cenario === parcial`. */
  porCod: ReadonlyMap<string, { sigla: string; parcial: number; cenario: number }>;
}

/**
 * A visão do cenário a partir da resposta da rota e do interruptor lido pela
 * página. Pura e determinística.
 *
 * Com X = 0 (`pronto: false`) a tela NÃO chama a parcial de "cenário
 * projetado" (RF-300): os números do `porCod` continuam valendo, mas o
 * chamador mostra só a parcial.
 */
export function visaoDoCenario(dados: EleitosNacionais, ligadaNaPagina: boolean): VisaoDoCenario {
  const ligada = ligadaNaPagina && !dados.projecao_desligada;
  const liberadas: ReadonlySet<string> = new Set(ligada ? dados.ufs_liberadas : []);
  const x = liberadas.size;
  // Uma UF que a rota liberou e a página desligou conta a parcial.
  const y = dados.ufs_parcial.length + (ligada ? 0 : dados.ufs_liberadas.length);
  const porCod = new Map<string, { sigla: string; parcial: number; cenario: number }>();
  for (const a of dados.agremiacoes) {
    porCod.set(a.cod, {
      sigla: a.sigla,
      parcial: a.parcial,
      cenario: ligada ? a.cenario : a.parcial,
    });
  }
  return {
    ligada,
    liberadas,
    x,
    y,
    w: dados.ufs_tse.length,
    z: dados.ufs_sem_dado.length,
    total: dados.ufs_total,
    pronto: ligada && x > 0,
    porCod,
  };
}

/**
 * "projeção em 19 de 27 estados; nos outros 8, a parcial" — X, Y e o total
 * vêm da {@link VisaoDoCenario}, nunca escritos à mão (design 017 D8). Acrescenta
 * "em W, o resultado do TSE" e "Z sem dado agora, fora da conta" quando há.
 *
 * Não leva "não oficial": quem chama põe o rótulo inteiro no MESMO elemento
 * (RF-266).
 */
export function rotuloDoMisto(v: VisaoDoCenario): string {
  const partes = [`projeção em ${v.x} de ${v.total} ${v.total === 1 ? "estado" : "estados"}`];
  if (v.y > 0) partes.push(v.y === 1 ? "no outro, a parcial" : `nos outros ${v.y}, a parcial`);
  if (v.w > 0) partes.push(`em ${v.w}, o resultado do TSE`);
  if (v.z > 0) partes.push(`${v.z} sem dado agora, fora da conta`);
  return partes.join("; ");
}

/** A frase de quando a projeção está desligada (ADR-0063 emenda 04/10 (2), item 1). */
export const FRASE_PROJECAO_DESLIGADA =
  "A projeção de deputados está desligada agora — mostrando a parcial.";

/** X = 0: não há cenário a chamar de projetado (RF-300). */
export const FRASE_NENHUMA_LIBERADA =
  "Nenhum estado tem a projeção · não oficial liberada ainda — mostrando a parcial.";
