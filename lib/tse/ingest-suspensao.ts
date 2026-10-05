/**
 * lib/tse/ingest-suspensao.ts
 *
 * 🔴 05/10/2026 — trava da ingestão depois do fechamento do 1º turno.
 *
 * O TSE totalizou 100% (Presidente às 02:59, cargos estaduais às 06:08 de
 * 05/10) e o resultado publicado foi fechado por `pnpm fechamento:1t`
 * (Presidente com o agregado oficial — 12 arquivos de zona ficaram congelados
 * no TSE). Os crons de ingestão saíram de `vercel.ts`, mas uma chamada avulsa
 * (cron antigo num deployment anterior, disparo manual, `curl` de teste) ainda
 * rodaria um ciclo e o modelo regravaria o payload a partir da soma das zonas
 * — desfazendo o fechamento. Esta trava responde 200 sem fazer nada.
 *
 * São duas travas, independentes:
 *
 *   1. {@link INGESTAO_SUSPENSA_ATE} — até esse instante, NENHUM ciclo roda,
 *      de turno nenhum.
 *   2. {@link TURNOS_ENCERRADOS} — um ciclo cujo `TSE_TURNO` está aqui nunca
 *      roda, nem depois da data. É o que protege o 1º turno se alguém religar
 *      a ingestão para o 2º e esquecer `TSE_TURNO=2` no ambiente.
 *
 * Para o 2º turno (25/10/2026): antecipar `INGESTAO_SUSPENSA_ATE` se houver
 * simulado do TSE antes, religar `INGESTAO_CRONS_LIGADOS` em `vercel.ts` e
 * declarar `TSE_TURNO=2`. Roteiro em docs/operations/runbook.md § "Fechamento
 * do 1º turno".
 *
 * Constante de CÓDIGO de propósito, e não variável de ambiente nem chave do
 * Global Config: o objetivo é que nada mude isto sem um commit revisado.
 */

/** Até quando a ingestão fica suspensa (ISO, BRT). Manhã do 2º turno. */
export const INGESTAO_SUSPENSA_ATE = "2026-10-25T08:00:00-03:00";

/** Turnos cujo resultado está fechado — ingestão deles nunca mais roda. */
export const TURNOS_ENCERRADOS: readonly number[] = [1];

export type MotivoSuspensao = "ingestao_suspensa" | "turno_encerrado";

/** `true` enquanto `agora` for anterior a {@link INGESTAO_SUSPENSA_ATE}. */
export function ingestaoSuspensa(agora: Date, ate: string = INGESTAO_SUSPENSA_ATE): boolean {
  const limite = Date.parse(ate);
  if (!Number.isFinite(limite)) return true; // data ilegível ⇒ falha fechada
  return agora.getTime() < limite;
}

/** `true` se o turno do ciclo já foi fechado. */
export function turnoEncerrado(
  turno: number,
  encerrados: readonly number[] = TURNOS_ENCERRADOS,
): boolean {
  return encerrados.includes(turno);
}

/**
 * Os testes do ciclo de ingestão (que mockam banco e TSE) precisam atravessar
 * a trava; produção nunca tem `VITEST`. O teste da própria trava apaga a
 * variável para medir o caminho real.
 */
export function travaAtiva(env: Record<string, string | undefined> = process.env): boolean {
  return env.VITEST !== "true";
}
