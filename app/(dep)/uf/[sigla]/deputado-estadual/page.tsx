/**
 * app/(dep)/uf/[sigla]/deputado-estadual/page.tsx — T-18, spec 027 (RF-281).
 *
 * A Assembleia Legislativa de UMA UF (cargo 7), nas 26 UFs que têm
 * Assembleia. O corpo é o módulo comum `app/(dep)/_pagina-uf-deputado.tsx`, o
 * mesmo da bancada de cada UF na Câmara dos Deputados (cargo 6): a regra de
 * cadeiras é a mesma (CE arts. 106–109), e o que muda — nome da casa, dado,
 * rota da lista — entra pelo `cargo`.
 *
 * Casca de rota: o Next lê `revalidate`, `generateStaticParams` e
 * `generateMetadata` do PRÓPRIO arquivo de rota (um reexport não serve para a
 * configuração de segmento), então os três ficam aqui, e cada um delega ao
 * módulo comum com o cargo escrito uma vez só.
 *
 * ## `/uf/DF/deputado-estadual` → 308 para `/uf/DF/deputado-distrital`
 *
 * O DF não tem Assembleia: a casa dele é a Câmara Legislativa (cargo 8). Quem
 * chega aqui pelo DF — link antigo, URL digitada, o seletor de outra tela — é
 * levado, ANTES de qualquer leitura, à página da casa que existe
 * (`permanentRedirect`, 308). Sigla que não existe em casa nenhuma (`ZZ`) cai
 * no 404 do módulo comum.
 *
 * ISR: 60 s (ADR-0011). Pré-renderizada estática para as 26 UFs; o DF não
 * entra em `generateStaticParams` e é resolvido sob demanda — no redirect.
 */

import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { destinoDaCasaTrocada } from "@/lib/utils/casa-legislativa";

import {
  metadataDaPaginaUf,
  paramsEstaticosDaCasa,
  renderPaginaUfDeputado,
} from "../../../_pagina-uf-deputado";

const CARGO = 7 as const;

export const revalidate = 60;

export function generateStaticParams() {
  return paramsEstaticosDaCasa(CARGO);
}

interface UFDeputadoEstadualPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFDeputadoEstadualPageProps): Promise<Metadata> {
  const { sigla } = await params;
  return metadataDaPaginaUf(CARGO, sigla);
}

export default async function UFDeputadoEstadualPage({ params }: UFDeputadoEstadualPageProps) {
  const { sigla } = await params;
  const destino = destinoDaCasaTrocada(CARGO, sigla);
  if (destino) permanentRedirect(destino);
  return renderPaginaUfDeputado(CARGO, sigla);
}
