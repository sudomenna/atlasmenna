// data-pipeline/_revisao-derivado.ts
//
// O **carimbo de revisão do dono** num insumo derivado de etiquetas
// (`editorial/derivados/*.json`) — constituição 1.6, § 2 (b): "sem revisão, a
// classificação não é exibida". Spec 024, RF-223 (emenda de 29/09, após a
// auditoria constitucional).
//
// A linha de CSV tem `revisado`/`revisado_em` por linha. A regra derivada
// (trajetória, alinhamento) classifica milhares de candidaturas de uma vez;
// a revisão é do ARQUIVO INTEIRO, carimbada no cabeçalho dele:
//
//   "revisao": { "revisado": "sim" | "nao", "revisado_em": "AAAA-MM-DD" | null, "por": "<nome>" | null }
//
// Regras (lidas por `lerCarimboRevisao`, aplicadas pelo compilador):
//   - sem o bloco `revisao` ⇒ PENDENTE (o insumo é tratado como AUSENTE);
//   - `revisado: "nao"` ⇒ PENDENTE;
//   - `revisado: "sim"` exige `revisado_em` (data real) e `por` (o nome de
//     quem revisou — revisão NOMINAL, § 2 (b)); faltando um ⇒ erro de
//     compilação, nunca "aprovado por omissão";
//   - o compilador ainda recusa `revisado_em` no futuro ou ANTERIOR à geração
//     do arquivo (a aprovação não pode ser de uma versão que ainda não existia).
//
// 🔴 **Regenerar zera a revisão.** Os quatro exportadores (`trajetoria:exportar`,
// `alinhamento:importar`, `alinhamento:senado`, `trajetoria:senado`) gravam
// SEMPRE `carimboPendente()`: um arquivo novo é conteúdo novo, e o dono revisa
// de novo antes de ele ir ao ar.
//
// Sem import nenhum: os exportadores rodam com `node --experimental-strip-types`,
// que não resolve o alias `@/`.

export const CAMPO_REVISAO = "revisao";

/** O bloco gravado no cabeçalho do arquivo derivado. */
export interface CarimboRevisao {
  revisado: "sim" | "nao";
  revisado_em: string | null;
  por: string | null;
}

/** O que todo exportador grava: pendente. Regenerar zera a revisão. */
export function carimboPendente(): CarimboRevisao {
  return { revisado: "nao", revisado_em: null, por: null };
}

export type RevisaoLida =
  | { estado: "aprovado"; revisado_em: string; por: string }
  | { estado: "pendente"; motivo: "sem_carimbo" | "nao_revisado" };

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function dataReal(s: string): boolean {
  const m = DATA.exec(s);
  if (!m) return false;
  const [, a, me, d] = m;
  const dt = new Date(Date.UTC(Number(a), Number(me) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(a) &&
    dt.getUTCMonth() === Number(me) - 1 &&
    dt.getUTCDate() === Number(d)
  );
}

/**
 * Lê o carimbo do JSON (já parseado) de um insumo derivado. Estrutural: o
 * "no futuro" e o "anterior à geração" dependem do relógio e da data do
 * arquivo, e ficam com o compilador.
 */
export function lerCarimboRevisao(
  json: unknown,
  arquivo: string,
): { ok: true; valor: RevisaoLida } | { ok: false; erros: string[] } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: true, valor: { estado: "pendente", motivo: "sem_carimbo" } };
  }
  const bruto = (json as Record<string, unknown>)[CAMPO_REVISAO];
  if (bruto === undefined)
    return { ok: true, valor: { estado: "pendente", motivo: "sem_carimbo" } };
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return { ok: false, erros: [`${arquivo}: \`revisao\` deve ser um objeto`] };
  }
  const r = bruto as Record<string, unknown>;
  const erros: string[] = [];
  const { revisado, revisado_em: em, por } = r;
  if (revisado !== "sim" && revisado !== "nao") {
    erros.push(
      `${arquivo}: revisao.revisado deve ser "sim" ou "nao" — veio ${JSON.stringify(revisado)}`,
    );
  }
  if (em !== null && em !== undefined && (typeof em !== "string" || !dataReal(em))) {
    erros.push(
      `${arquivo}: revisao.revisado_em deve ser AAAA-MM-DD ou null — veio ${JSON.stringify(em)}`,
    );
  }
  if (por !== null && por !== undefined && typeof por !== "string") {
    erros.push(`${arquivo}: revisao.por deve ser texto ou null`);
  }
  if (revisado === "sim") {
    if (typeof em !== "string" || em === "") {
      erros.push(`${arquivo}: revisao.revisado = "sim" exige revisado_em (a data da sua revisão)`);
    }
    if (typeof por !== "string" || por.trim() === "") {
      erros.push(`${arquivo}: revisao.revisado = "sim" exige por (quem revisou)`);
    }
  }
  if (erros.length > 0) return { ok: false, erros };
  if (revisado === "nao")
    return { ok: true, valor: { estado: "pendente", motivo: "nao_revisado" } };
  return {
    ok: true,
    valor: { estado: "aprovado", revisado_em: em as string, por: (por as string).trim() },
  };
}
