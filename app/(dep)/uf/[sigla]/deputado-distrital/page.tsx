/**
 * app/(dep)/uf/[sigla]/deputado-distrital/page.tsx — T-18, spec 027 (RF-281).
 *
 * A Câmara Legislativa do Distrito Federal (cargo 8) — só existe no DF. O
 * corpo é o módulo comum `app/(dep)/_pagina-uf-deputado.tsx`, o mesmo das
 * Assembleias e da bancada de cada UF na Câmara dos Deputados.
 *
 * Casca de rota: `revalidate`, `generateStaticParams` e `generateMetadata`
 * ficam aqui porque o Next os lê do próprio arquivo de rota.
 *
 * ## `/uf/SP/deputado-distrital` → 308 para `/uf/SP/deputado-estadual`
 *
 * Simétrico ao DF no estadual (open question 1 da spec 027: o dono pode
 * trocar por 404 — muda `destinoDaCasaTrocada`, em
 * `lib/utils/casa-legislativa.ts`). Sigla que não existe em casa nenhuma
 * (`ZZ`) cai no 404 do módulo comum.
 *
 * Não há `lista/route.ts` aqui (design 027 § 7.2): 24 cadeiras, nenhuma
 * agremiação passa de 60 candidaturas, e o objeto da UF já traz a lista
 * inteira.
 *
 * ISR: 60 s (ADR-0011). Pré-renderizada estática só para o DF.
 */

import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { destinoDaCasaTrocada } from "@/lib/utils/casa-legislativa";

import {
  metadataDaPaginaUf,
  paramsEstaticosDaCasa,
  renderPaginaUfDeputado,
} from "../../../_pagina-uf-deputado";

const CARGO = 8 as const;

export const revalidate = 60;

export function generateStaticParams() {
  return paramsEstaticosDaCasa(CARGO);
}

interface UFDeputadoDistritalPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({
  params,
}: UFDeputadoDistritalPageProps): Promise<Metadata> {
  const { sigla } = await params;
  return metadataDaPaginaUf(CARGO, sigla);
}

export default async function UFDeputadoDistritalPage({ params }: UFDeputadoDistritalPageProps) {
  const { sigla } = await params;
  const destino = destinoDaCasaTrocada(CARGO, sigla);
  if (destino) permanentRedirect(destino);
  return renderPaginaUfDeputado(CARGO, sigla);
}
