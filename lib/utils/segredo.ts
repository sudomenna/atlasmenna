/**
 * lib/utils/segredo.ts
 *
 * Comparação de segredo em tempo constante — evita que a latência da resposta
 * revele quantos caracteres do segredo estavam certos.
 *
 * Morava dentro de `proxy.ts` até 05/10/2026. Saiu para cá quando o painel
 * privado (`/painel`, ADR-0077) passou a precisar da MESMA comparação em dois
 * lugares: no `proxy.ts` (o portão) e na própria página (a segunda trava, caso
 * o portão algum dia deixe uma variante de caminho passar). Duas cópias da
 * mesma função de segurança são o caminho para uma delas divergir.
 *
 * Sem I/O, sem dependência — roda igual no proxy e no servidor.
 */

/**
 * `true` só quando `fornecido` e `esperado` existem, não são vazios e são
 * idênticos. Ausência de qualquer um dos dois é **sempre** `false` — é o que
 * faz um segredo não configurado no ambiente fechar o portão em vez de abri-lo.
 *
 * O tamanho diferente sai cedo (revela o tamanho, não o conteúdo) — o mesmo
 * comportamento que a função tinha dentro do `proxy.ts`.
 */
export function segredoConfere(fornecido: string | null, esperado: string | undefined): boolean {
  if (!fornecido || !esperado || fornecido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < fornecido.length; i++) {
    diff |= fornecido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}
