/**
 * lib/painel/ler.ts
 *
 * Leitura do retrato do painel privado (ADR-0077) — o ÚNICO lugar que sabe
 * onde o retrato mora.
 *
 *   - `NODE_ENV=development` → o arquivo local `build/painel/retrato-1t-2026.json`
 *     (gerado por `pnpm painel:retrato`, sem `--escrever`);
 *   - qualquer outro ambiente → `fetch` da URL SECRETA do Vercel Blob, lida
 *     da variável de servidor `PAINEL_RETRATO_URL` (plano B do ADR-0077: a
 *     store do projeto é pública e recusou `access: "private"`; o retrato fica
 *     num caminho com 32 bytes aleatórios, `painel/<segredo>/…`).
 *
 * 🔴 A URL é o segredo. Ela nunca sai deste módulo: não vai para o resultado
 * (nem nos motivos de falha, que a página mostra), não vai para log, não vai
 * para props. E nenhum arquivo `"use client"` pode mencioná-la (trava em
 * `tests/unit/painel/retrato-fora-do-cliente.test.ts`).
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

import {
  CARGOS_DO_PAINEL,
  PAINEL_ARQUIVO_LOCAL,
  type RetratoPainel,
  VERSAO_RETRATO,
} from "./tipos";

export type LeituraRetrato =
  | { status: "ok"; retrato: RetratoPainel; origem: "arquivo-local" | "blob" }
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
  if (r.corridaPresidente === undefined) return null;
  if (r.corridaPresidente !== null && !corridaValida(r.corridaPresidente)) return null;
  return r as RetratoPainel;
}

/**
 * A corrida do Presidente tem colunas paralelas: todas as listas de um bloco
 * precisam ter o mesmo tamanho, e uma lista por candidato. Uma coluna curta
 * desenharia um candidato deslocado no tempo sem erro nenhum.
 */
function corridaValida(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const { candidatos, apuracao, projecao, conferencia, trocas } = c as Record<string, unknown>;
  if (!Array.isArray(candidatos) || candidatos.length === 0) return false;
  if (!Array.isArray(trocas) || !conferencia || typeof conferencia !== "object") return false;
  const nc = candidatos.length;
  const colunas = (bloco: unknown, simples: string[], porCandidato: string[]): boolean => {
    if (!bloco || typeof bloco !== "object") return false;
    const b = bloco as Record<string, unknown>;
    const t = b.t;
    if (!Array.isArray(t)) return false;
    for (const k of simples) {
      const v = b[k];
      if (!Array.isArray(v) || v.length !== t.length) return false;
    }
    for (const k of porCandidato) {
      const v = b[k];
      if (!Array.isArray(v) || v.length !== nc) return false;
      if (!v.every((linha) => Array.isArray(linha) && linha.length === t.length)) return false;
    }
    return true;
  };
  return (
    colunas(apuracao, ["apurado"], ["pct", "votos"]) &&
    colunas(projecao, ["tBoletim"], ["pct", "lo", "hi", "pVitoria"])
  );
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
 * O ponto de leitura do Blob, isolado. A URL vem SÓ do ambiente do servidor,
 * e os motivos devolvidos são genéricos de propósito: a página os exibe, e um
 * motivo com a URL dentro entregaria o segredo a quem visse a tela.
 */
async function lerBlobSecreto(): Promise<LeituraRetrato> {
  const url = process.env.PAINEL_RETRATO_URL;
  if (!url) {
    return {
      status: "ausente",
      motivo: "o endereço do retrato não está configurado neste ambiente",
    };
  }
  let resposta: Response;
  try {
    resposta = await fetch(url, { cache: "no-store" });
  } catch (e) {
    // Só o tipo do erro: a mensagem de um erro de rede pode carregar a URL.
    console.warn("[painel] leitura do retrato falhou (rede)", e instanceof Error ? e.name : "?");
    return { status: "erro", motivo: "a leitura do retrato falhou" };
  }
  if (resposta.status === 404) {
    return { status: "ausente", motivo: "o retrato ainda não foi publicado" };
  }
  if (!resposta.ok) {
    console.warn("[painel] leitura do retrato falhou", resposta.status);
    return { status: "erro", motivo: "a leitura do retrato falhou" };
  }
  try {
    const retrato = validarRetrato(JSON.parse(await resposta.text()));
    return retrato
      ? { status: "ok", retrato, origem: "blob" }
      : { status: "erro", motivo: "o retrato publicado não tem o formato esperado" };
  } catch {
    return { status: "erro", motivo: "o retrato publicado não é JSON válido" };
  }
}

export async function lerRetrato(): Promise<LeituraRetrato> {
  if (process.env.NODE_ENV === "development") return lerArquivoLocal();
  return lerBlobSecreto();
}
