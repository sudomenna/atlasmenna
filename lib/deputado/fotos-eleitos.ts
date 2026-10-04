/**
 * lib/deputado/fotos-eleitos.ts — spec 026 RF-291 (decisão do dono de 03/10):
 * a mini-foto ao lado do nome SÓ de quem está sendo eleito, nas páginas de UF
 * de Deputado Federal, Estadual e Distrital.
 *
 * O servidor decide a URL; o componente cliente só a usa. Três motivos:
 *
 *   1. A URL sai de {@link candidatoFotoUrl} (`lib/blob/paths.ts`), que lê a
 *      base do Blob do AMBIENTE do servidor — o cliente não a tem, e derivar
 *      de novo lá seria a cópia que o `candidatoFotoUrl` existe para impedir.
 *   2. Se a foto existe é o `foto_ok` da fatia de candidaturas da UF × cargo
 *      (`readCandidatosUf`, Data Cache de 12 h) — leitura de servidor. Sem a
 *      fatia (indisponível, ou o `sqcand` não está nela) a linha eleita cai
 *      nas iniciais, nunca num `<img>` quebrado.
 *   3. Peso: só entram no mapa os eleitos COM foto, e cada lista recebe só o
 *      dela — o payload RSC não repete o mapa da UF inteira por agremiação.
 *
 * Quem é "eleito" é {@link ehEleitoNosBits}: os bits de marca já derivados
 * (parcial, ou TSE com a totalização final). Projeção sozinha não conta.
 */

import { candidatoFotoUrl } from "@/lib/blob/paths";
import { ehEleitoNosBits } from "@/lib/utils/deputado-marcas";

/** `sqcand` (como string) → URL pública da foto. Só eleitos com foto publicada. */
export type FotosDosEleitos = Readonly<Record<string, string>>;

/**
 * O mapa de fotos de um conjunto de linhas. `linhas` são pares
 * `[sqcand, bits de marca]` — a tupla da lista e a linha dos mais votados dão
 * os dois sem conversão.
 *
 * `comFoto` é o conjunto de `sqcand` (string — 11 a 12 dígitos, ADR-0042) com
 * `foto_ok: true` na fatia da UF × cargo. Vazio ⇒ mapa vazio ⇒ iniciais.
 */
export function fotosDosEleitos(
  uf: string,
  linhas: Iterable<readonly [sqcand: number, marcas: number]>,
  comFoto: ReadonlySet<string>,
): FotosDosEleitos {
  const fotos: Record<string, string> = {};
  for (const [sqcand, marcas] of linhas) {
    if (!ehEleitoNosBits(marcas)) continue;
    const sq = String(sqcand);
    if (!comFoto.has(sq)) continue;
    const url = candidatoFotoUrl(uf, sq);
    if (url) fotos[sq] = url;
  }
  return fotos;
}

/**
 * ADR-0076 (placar zerado) — o começo comum das URLs de foto da UF
 * (`…/candidatos/foto/<UF>/`), para o CLIENTE montar a URL de cada linha sem
 * um mapa `sqcand → URL` no payload (≈120 B por linha, ~1.000 linhas em SP).
 * `null` sem Blob configurado (⇒ iniciais).
 */
export function prefixoFotoDaUf(uf: string): string | null {
  const url = candidatoFotoUrl(uf, "0");
  return url?.endsWith("/0.jpg") ? url.slice(0, -"0.jpg".length) : null;
}
