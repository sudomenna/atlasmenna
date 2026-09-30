/**
 * scripts/etiquetas-vigia.ts
 *
 * **Vigia das etiquetas** (spec 024, RF-234): avisa quando um candidato sem
 * classificação entra entre os 4 primeiros de qualquer corrida de Governador
 * ou Senador, ou quando uma agremiação com cadeira na Câmara não tem padrão —
 * para classificar e publicar (`pnpm etiquetas:publicar`) **antes** que o
 * portão de cobertura esconda a visão.
 *
 * Uso:
 *   pnpm etiquetas:vigia
 *   pnpm etiquetas:vigia --categorias relacao_governo,palanque_presidencial
 *   pnpm etiquetas:vigia --blob-base https://<store>.public.blob.vercel-storage.com
 *
 * Saída (mesmo contrato de `vigia:ciclo`, para o mesmo agendador):
 *   exit 0 → nada a classificar, ou fase pré-eleição
 *   exit 2 → 🔴 há alerta (uma linha por candidato/agremiação)
 *   exit 1 → não consegui olhar (sem `EDGE_CONFIG`, leitura falhou)
 *
 * Não é agendado por este script. Em 04/10, o dono decide a cadência (o plano
 * fala em 10 min) no mesmo agendador de `vigia:ciclo`.
 *
 * ---------------------------------------------------------------------------
 * 🔴 Carga do ambiente por LISTA BRANCA — nunca `.env.local` inteiro
 * ---------------------------------------------------------------------------
 * Mesmo molde de `scripts/_vigia-env.ts`: só `EDGE_CONFIG` (leitura do
 * payload) e `BLOB_PUBLIC_BASE_URL` (URL pública do Blob — não é segredo).
 * O `DATABASE_URL` de produção e o `BLOB_READ_WRITE_TOKEN` nunca entram no
 * processo. Sem `BLOB_PUBLIC_BASE_URL`, o vigia lê a cópia do build das
 * etiquetas — e avisa disso, porque ela pode estar atrás do que foi publicado.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CategoriaId, isCategoriaId } from "../lib/etiquetas/catalogo";
import { selecionarEnvDoVigia } from "./_vigia-env";

/** As ÚNICAS variáveis que este vigia lê. Nenhuma toca banco nem escreve. */
export const ENV_DO_VIGIA_ETIQUETAS = ["EDGE_CONFIG", "BLOB_PUBLIC_BASE_URL"] as const;

/** Pura: aplica a lista branca sobre o conteúdo de um `.env.local`. */
export function envDoVigiaEtiquetas(
  conteudo: string,
  ambiente: Record<string, string | undefined> = {},
): Record<string, string> {
  const todas = selecionarEnvDoVigia(conteudo, ambiente, ENV_DO_VIGIA_ETIQUETAS);
  const out: Record<string, string> = {};
  for (const k of ENV_DO_VIGIA_ETIQUETAS) {
    const v = todas[k];
    if (v) out[k] = v;
  }
  return out;
}

function carregarEnv(cwd: string = process.cwd()): void {
  let bruto = "";
  try {
    bruto = readFileSync(resolve(cwd, ".env.local"), "utf8");
  } catch {
    // Sem arquivo: CI/agendador, as variáveis vêm do ambiente.
  }
  const sel = envDoVigiaEtiquetas(bruto, process.env);
  for (const k of ENV_DO_VIGIA_ETIQUETAS) {
    const v = sel[k];
    if (v && !process.env[k]) process.env[k] = v;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const iBase = args.indexOf("--blob-base");
  if (iBase >= 0 && args[iBase + 1]) process.env.BLOB_PUBLIC_BASE_URL = args[iBase + 1];
  const iCat = args.indexOf("--categorias");
  const brutas = iCat >= 0 ? (args[iCat + 1] ?? "").split(",").filter(Boolean) : undefined;
  if (brutas?.some((c) => !isCategoriaId(c))) {
    console.error(`--categorias com categoria desconhecida: ${brutas.join(",")}`);
    process.exit(1);
  }
  const categorias = brutas?.filter(isCategoriaId) as CategoriaId[] | undefined;

  carregarEnv();
  if (!process.env.EDGE_CONFIG) {
    console.log(
      JSON.stringify({ vigia: "etiquetas", estado: "indeterminado", motivo: "sem EDGE_CONFIG" }),
    );
    console.log("Não consegui olhar: EDGE_CONFIG ausente (nem no ambiente, nem no .env.local).");
    process.exit(1);
  }

  // Imports tardios: os módulos tocam env na carga, e o env acabou de ser montado.
  const { readProjection, readDeputadoProjection } = await import("../lib/edge-config/reader");
  const { currentPresidentialTurno } = await import("../lib/config/calendar");
  const { lerEtiquetas } = await import("../lib/etiquetas/leitor");
  const { avaliarVigiaEtiquetas, formatarAlerta } = await import("../lib/etiquetas/vigia");

  const turnoGov = currentPresidentialTurno();
  let gov: Awaited<ReturnType<typeof readProjection>> = null;
  let sen: Awaited<ReturnType<typeof readProjection>> = null;
  let dep: Awaited<ReturnType<typeof readDeputadoProjection>> = null;
  try {
    [gov, sen, dep] = await Promise.all([
      readProjection({ cargo: "gov", turno: turnoGov }),
      readProjection({ cargo: "sen", turno: 1 }),
      readDeputadoProjection(6),
    ]);
  } catch (err) {
    console.log(
      JSON.stringify({ vigia: "etiquetas", estado: "indeterminado", motivo: String(err) }),
    );
    process.exit(1);
  }

  const etiquetas = await lerEtiquetas();
  const v = avaliarVigiaEtiquetas({
    gov,
    sen,
    dep,
    turnoGov,
    etiquetas,
    categorias,
  });

  console.log(
    JSON.stringify({
      vigia: "etiquetas",
      estado: v.estado,
      alertas: v.alertas.length,
      etiquetas_fonte: etiquetas.fonte,
      etiquetas_versao: etiquetas.versao,
      agora: new Date().toISOString(),
    }),
  );
  if (etiquetas.fonte === "embutido" && !process.env.BLOB_PUBLIC_BASE_URL) {
    console.log(
      "⚠️  lendo a cópia do build das etiquetas (sem BLOB_PUBLIC_BASE_URL) — pode estar atrás do que foi publicado.",
    );
  }
  for (const a of v.alertas) console.log(formatarAlerta(a));
  if (v.estado === "ok") console.log("✓ todos os candidatos vigiados estão classificados.");
  if (v.estado === "nao_comecou") console.log("Fase pré-eleição — nada a vigiar.");
  process.exit(v.estado === "alerta" ? 2 : 0);
}

if (process.argv[1]?.includes("etiquetas-vigia")) {
  void main();
}
