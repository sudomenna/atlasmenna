/**
 * lib/etiquetas/caminhos.ts
 *
 * Caminhos das etiquetas no Vercel Blob (spec 024, RF-230/231) —
 * `etiquetas/v1/{nacional,historico,uf/<UF>}.json`. Montados pelo mesmo
 * validador de segmento de `lib/blob/paths.ts`: um segundo esquema de caminho
 * é o que o ADR-0032 existe para impedir. Mora aqui, e não em `paths.ts`, só
 * para esta frente não disputar um arquivo compartilhado com as outras.
 *
 * `v1` é a versão do **formato** (`FORMATO_ETIQUETAS`), não da classificação:
 * mudar o contrato de forma incompatível ganha `v2` e os dois convivem
 * durante o deploy.
 */

import { blobPathname } from "@/lib/blob/paths";

import { isSiglaUf } from "./formato";

export function etiquetasNacionalBlobPathname(): string {
  return blobPathname(["etiquetas", "v1", "nacional"], "etiquetasNacionalBlobPathname");
}

export function etiquetasHistoricoBlobPathname(): string {
  return blobPathname(["etiquetas", "v1", "historico"], "etiquetasHistoricoBlobPathname");
}

export function etiquetasUfBlobPathname(sigla: string): string {
  const uf = sigla.toUpperCase();
  if (!isSiglaUf(uf)) {
    throw new Error(`etiquetasUfBlobPathname: UF inválida "${sigla}"`);
  }
  return blobPathname(["etiquetas", "v1", "uf", uf], "etiquetasUfBlobPathname");
}
