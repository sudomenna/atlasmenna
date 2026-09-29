/**
 * app/sobre-as-etiquetas/classificacoes.csv/route.ts — a lista pública, em
 * planilha, de TODAS as classificações editoriais no ar (constituição 1.6
 * § 8; spec 025, RF-252): individuais, padrões de partido/federação e as
 * derivadas (trajetória, relação com o governo), uma por linha, com fonte,
 * data da fonte, data da revisão do dono e origem — e, na relação com o
 * governo derivada, os votos e a taxa medidos.
 *
 * Só dado publicado (= revisado): lê os mesmos arquivos que as telas
 * (`lerEtiquetas`). Estático com ISR, no mesmo piso da página que aponta para
 * cá — sem banco, sem Edge Config, sem `searchParams`.
 */

import { csvPublicoDasClassificacoes } from "@/lib/etiquetas/lista-publica";

export const revalidate = 60;

export async function GET(): Promise<Response> {
  const csv = await csvPublicoDasClassificacoes();
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'inline; filename="classificacoes-etiquetas.csv"',
    },
  });
}
