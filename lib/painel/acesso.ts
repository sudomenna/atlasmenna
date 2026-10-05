/**
 * lib/painel/acesso.ts
 *
 * A senha do painel privado (`/painel`, ADR-0077): HTTP Basic Auth contra
 * `PAINEL_SENHA`. Qualquer nome de usuário serve; só a senha conta.
 *
 * Funções puras — usadas pelo `proxy.ts` (o portão) e pela própria página (a
 * segunda trava). Sem I/O: quem chama passa o cabeçalho e a senha do ambiente.
 *
 * ## Fail-closed
 *
 * Sem `PAINEL_SENHA` definida (ou vazia), {@link painelAutorizado} devolve
 * `false` para QUALQUER cabeçalho. Um ambiente que esqueceu a variável fica
 * trancado, nunca aberto — é o mesmo desenho do `segredoConfere`, que já trata
 * o segredo esperado ausente como "não confere".
 */

import { segredoConfere } from "@/lib/utils/segredo";

/** Valor do `WWW-Authenticate` da resposta 401 — é o que faz o navegador pedir a senha. */
export const PAINEL_WWW_AUTHENTICATE = 'Basic realm="Painel AtlasMenna", charset="UTF-8"';

/**
 * `true` para o caminho do painel e para TODAS as formas de transporte que o
 * Next usa para a mesma página:
 *
 *   - `/painel` e `/painel/` — o HTML;
 *   - `/painel/<qualquer coisa>` — sub-rotas futuras;
 *   - `/painel.rsc`, `/painel.segments/…` — o payload RSC servido como arquivo
 *     (o matcher do Next 16 já inclui esses sufixos ao casar `/painel`; a função
 *     os cobre também para que a decisão não dependa de um detalhe interno do
 *     framework);
 *   - `/_next/data/<build>/painel.json` — o prefixo de dados, pelo mesmo motivo.
 *
 * A navegação RSC comum (`/painel?_rsc=…`, cabeçalho `RSC: 1`) tem `pathname`
 * igual a `/painel` — a query não entra no caminho.
 *
 * Casa o SEGMENTO, não o texto: `/painelzinho` NÃO é o painel.
 */
export function ehRotaDoPainel(caminho: string): boolean {
  return /^(?:\/_next\/data\/[^/]+)?\/painel(?:$|[/.])/.test(caminho);
}

/**
 * Extrai a senha de um cabeçalho `Authorization: Basic <base64(usuario:senha)>`.
 *
 * - Esquema diferente de `Basic`, base64 inválido ou sem `:` → `null`.
 * - A senha é tudo DEPOIS do primeiro `:` (a RFC 7617 proíbe `:` no usuário,
 *   não na senha).
 * - Os bytes são lidos como UTF-8 (`charset="UTF-8"` no desafio), então uma
 *   senha com acento funciona.
 */
export function senhaDoBasicAuth(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(authorization.trim());
  if (!m?.[1]) return null;
  let decodificado: string;
  try {
    const binario = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    decodificado = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const doisPontos = decodificado.indexOf(":");
  if (doisPontos < 0) return null;
  return decodificado.slice(doisPontos + 1);
}

/**
 * `true` só quando o cabeçalho traz a senha certa E a senha está configurada.
 * Comparação em tempo constante (`segredoConfere`).
 */
export function painelAutorizado(
  authorization: string | null,
  senhaEsperada: string | undefined,
): boolean {
  if (!senhaEsperada) return false;
  return segredoConfere(senhaDoBasicAuth(authorization), senhaEsperada);
}
