/**
 * lib/painel/ler.ts
 *
 * Leitura do retrato do painel privado (ADR-0077) — o ÚNICO lugar que sabe
 * onde o retrato mora.
 *
 *   - `NODE_ENV=development` → o arquivo local `build/painel/retrato-1t-2026.json`
 *     (gerado por `pnpm painel:retrato`, sem `--escrever`);
 *   - qualquer outro ambiente → `get()` PRIVADO do Vercel Blob
 *     (`painel/retrato-1t-2026.json`, `access: "private"`).
 *
 * Nunca o banco: a página do painel não toca Postgres (ADR-0001).
 *
 * 🔴 Este módulo é de SERVIDOR. Importá-lo — direta ou indiretamente — num
 * arquivo `"use client"` mandaria o código de leitura (e, num build que
 * embutisse o retrato, os dados) para um chunk público em `/_next/static`.
 * Trava: `tests/unit/painel/retrato-fora-do-cliente.test.ts`.
 *
 * Nada aqui lança: ausência e erro viram um resultado que a página mostra com
 * honestidade ("o retrato ainda não foi gerado"), sem derrubar a rota.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "@vercel/blob";

import {
  CARGOS_DO_PAINEL,
  PAINEL_ARQUIVO_LOCAL,
  PAINEL_BLOB_PATHNAME,
  type RetratoPainel,
  VERSAO_RETRATO,
} from "./tipos";

export type LeituraRetrato =
  | { status: "ok"; retrato: RetratoPainel; origem: "arquivo-local" | "blob-privado" }
  | { status: "ausente"; motivo: string }
  | { status: "erro"; motivo: string };

/**
 * Confere a FORMA do retrato antes de a página confiar nele: versão, as listas
 * e o tamanho de cada série por minuto. Um arquivo de outra versão (ou
 * truncado) vira `null` — a página mostra "retrato ilegível" em vez de
 * desenhar um gráfico com buracos que não existiram.
 */
export function validarRetrato(dado: unknown): RetratoPainel | null {
  if (!dado || typeof dado !== "object") return null;
  const r = dado as Partial<RetratoPainel>;
  if (r.versao !== VERSAO_RETRATO) return null;
  if (!r.eixo || typeof r.eixo.minutos !== "number" || typeof r.eixo.inicio !== "string") {
    return null;
  }
  const listas = [
    r.ciclos,
    r.rodadas,
    r.buracosProjecao,
    r.buracosCiclos,
    r.arquivosParados,
    r.episodiosDeBloqueio,
    r.correcoes,
    r.totais,
    r.cargos,
  ];
  if (!listas.every(Array.isArray)) return null;
  if (
    !r.apuradoPresidente ||
    !Array.isArray(r.apuradoPresidente.somaDosEstados) ||
    !Array.isArray(r.apuradoPresidente.arquivoBrasil)
  ) {
    return null;
  }
  const pm = r.porMinuto;
  if (!pm || typeof pm !== "object") return null;
  const n = r.eixo.minutos;
  for (const serie of Object.values(pm)) {
    if (!serie || typeof serie !== "object") return null;
    for (const cd of CARGOS_DO_PAINEL) {
      const v = (serie as Record<string, unknown>)[String(cd)];
      if (!Array.isArray(v) || v.length !== n) return null;
    }
  }
  return r as RetratoPainel;
}

function lerArquivoLocal(): LeituraRetrato {
  // `turbopackIgnore` NÃO é cosmético (ver `lib/dev/simulacao.ts`): sem ele o
  // Turbopack lê `process.cwd()` como "pode ler qualquer arquivo do projeto" e
  // traça o repositório inteiro para dentro da função — foi o que derrubou a
  // produção em 17/09. Este caminho só roda em desenvolvimento.
  const caminho = join(/*turbopackIgnore: true*/ process.cwd(), ...PAINEL_ARQUIVO_LOCAL);
  let bruto: string;
  try {
    bruto = readFileSync(caminho, "utf8");
  } catch {
    return {
      status: "ausente",
      motivo: `arquivo local ${PAINEL_ARQUIVO_LOCAL.join("/")} não existe — rode pnpm painel:retrato`,
    };
  }
  try {
    const retrato = validarRetrato(JSON.parse(bruto));
    return retrato
      ? { status: "ok", retrato, origem: "arquivo-local" }
      : { status: "erro", motivo: "o arquivo local não tem o formato esperado" };
  } catch {
    return { status: "erro", motivo: "o arquivo local não é JSON válido" };
  }
}

/**
 * O ponto de leitura do Blob, isolado: se a store não aceitar blob privado,
 * é só aqui que muda.
 */
async function lerBlobPrivado(): Promise<LeituraRetrato> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { status: "ausente", motivo: "este ambiente não tem credencial do Blob" };
  }
  try {
    const r = await get(PAINEL_BLOB_PATHNAME, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) {
      return { status: "ausente", motivo: "o retrato ainda não foi publicado no Blob privado" };
    }
    const texto = await new Response(r.stream).text();
    const retrato = validarRetrato(JSON.parse(texto));
    return retrato
      ? { status: "ok", retrato, origem: "blob-privado" }
      : { status: "erro", motivo: "o retrato do Blob não tem o formato esperado" };
  } catch (e) {
    console.warn("[painel] leitura do retrato no Blob falhou", e);
    return { status: "erro", motivo: "a leitura do retrato no Blob falhou" };
  }
}

export async function lerRetrato(): Promise<LeituraRetrato> {
  if (process.env.NODE_ENV === "development") return lerArquivoLocal();
  return lerBlobPrivado();
}
