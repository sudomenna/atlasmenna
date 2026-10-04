/**
 * lib/zerado/marca.ts
 *
 * O marcador de TELA do placar zerado (ADR-0076) no JSON que
 * `/api/projection` devolve à moldura do mapa. Módulo à parte, sem import
 * nenhum, para a moldura (componente de cliente) não arrastar o reader do
 * Edge Config nem o do Blob para o pacote do navegador.
 *
 * 🔴 Só de leitura para a tela. O payload zerado nunca vai a escritor
 * nenhum (Edge Config, Blob, banco) — e o campo não existe no contrato do
 * `EdgePayload`, então um escritor que o recebesse o rejeitaria pelo tipo.
 */

/** Nome do campo acrescentado pela rota de leitura. */
export const CAMPO_ZERADO = "zerado" as const;

/** Acrescenta o marcador (cópia; não muta). */
export function comMarcaZerado<T extends object>(payload: T): T & { zerado: true } {
  return { ...payload, [CAMPO_ZERADO]: true } as T & { zerado: true };
}

/** O payload que chegou à tela é o placar zerado? Igualdade exata com `true`. */
export function ehPlacarZerado(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Record<string, unknown>)[CAMPO_ZERADO] === true
  );
}
