/**
 * app/(dep)/uf/[sigla]/deputado-federal/page.tsx — T-12, spec 017.
 *
 * A bancada de UMA UF na Câmara dos Deputados (cargo 6). O corpo da página
 * mora em `app/(dep)/_pagina-uf-deputado.tsx` desde a spec 027, compartilhado
 * com a Assembleia Legislativa de cada estado (cargo 7) e com a Câmara
 * Legislativa do DF (cargo 8). A história e as decisões da tela estão lá.
 *
 * Este arquivo é só a casca de rota: o Next lê `revalidate`,
 * `generateStaticParams` e `generateMetadata` do PRÓPRIO arquivo de rota (um
 * reexport não serve para a configuração de segmento), então os três ficam
 * aqui, e cada um delega ao módulo comum com o cargo escrito uma vez só.
 *
 * ISR: 60 s (ADR-0011). Pré-renderizada estática para as 27 UFs.
 */

import type { Metadata } from "next";

import {
  metadataDaPaginaUf,
  paramsEstaticosDaCasa,
  renderPaginaUfDeputado,
} from "../../../_pagina-uf-deputado";

const CARGO = 6 as const;

export const revalidate = 60;

export function generateStaticParams() {
  return paramsEstaticosDaCasa(CARGO);
}

interface UFDeputadoPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFDeputadoPageProps): Promise<Metadata> {
  const { sigla } = await params;
  return metadataDaPaginaUf(CARGO, sigla);
}

export default async function UFDeputadoFederalPage({ params }: UFDeputadoPageProps) {
  const { sigla } = await params;
  return renderPaginaUfDeputado(CARGO, sigla);
}
