// data-pipeline/senado-fonte.ts
//
// **Cliente HTTP do Senado Federal — Dados Abertos** (`legis.senado.leg.br/dadosabertos`)
// com cache em disco. É a única porta de rede de `alinhamento-senado-cli.ts` e
// `trajetoria-senado-cli.ts`; o cálculo (`alinhamento-senado.ts`,
// `trajetoria-senado.ts`) é puro e nunca importa este arquivo.
//
// ─── O que a API faz e o cliente absorve (medido em 29/09/2026) ─────────────
//
// - **503 frequente**, `Content-Type: application/problem+json`, com
//   `retry-after: 15`. É intermitente: o mesmo endereço responde 200 na
//   tentativa seguinte. O cliente espera 15–20 s (nunca menos que o
//   `retry-after`, com teto de 30 s) e tenta de novo, até 8 vezes.
// - **Queda de conexão / timeout** em respostas grandes (1ª tentativa do
//   semestre 2023-01 das orientações). Mesmo tratamento do 503.
// - **200 com corpo que não é JSON** — tratado como falha transitória, não
//   gravado em cache.
// - Limite oficial de **10 req/s**. O cliente espaça as chamadas em ≥ 0,6 s.
// - 4xx (exceto 429) é definitivo: lança na hora, sem repetir.
//
// ─── Cache ──────────────────────────────────────────────────────────────────
//
// A resposta CRUA (o texto que o Senado devolveu, sem reserializar) vai para
// `build/senado/<chave>.json`, por escrita atômica (arquivo temporário +
// `rename`): uma interrupção no meio nunca deixa um JSON truncado que o
// próximo run leria como verdade. `build/` é gitignored.
//
// A CHAVE é do chamador, e é ela que decide a validade: recurso imutável
// (detalhe de senador, janela de datas já encerrada) usa chave fixa e vale
// para sempre; recurso vivo (lista de quem está em exercício, janela que
// contém "hoje") leva a data na chave, e um novo dia refaz a chamada.
// `atualizar: true` ignora o cache na leitura (e regrava).
//
// ⚠️ O cache de detalhe de senador contém a data de nascimento (é dado
// público do Senado, mas é o insumo do casamento em memória do ADR-0062 item
// 5). Ele vive só em `build/`, fora do git; nada daqui é copiado para
// `editorial/`.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SENADO_BASE = "https://legis.senado.leg.br/dadosabertos/";

/**
 * Token de produto simples: identifica o cliente (constituição § 1) sem
 * e-mail nem URL entre parênteses — a forma que o WAF do TSE aceita e que não
 * custa nada repetir aqui.
 */
export const SENADO_USER_AGENT = "AtlasMenna-ETL/0.1";

/** Espaço mínimo entre duas chamadas: o limite oficial é 10 req/s; usamos ~1,6. */
export const INTERVALO_MINIMO_MS = 600;
export const TENTATIVAS_MAX = 8;
export const TIMEOUT_MS = 120_000;

const STATUS_TRANSITORIOS = new Set([429, 500, 502, 503, 504]);
const CHAVE_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ErroSenado extends Error {
  readonly status: number | null;
  readonly url: string;
  constructor(mensagem: string, status: number | null, url: string) {
    super(mensagem);
    this.name = "ErroSenado";
    this.status = status;
    this.url = url;
  }
}

export interface PedidoSenado {
  /** Caminho relativo a `SENADO_BASE`, sem query. Ex.: `senador/lista/atual.json`. */
  caminho: string;
  /** Parâmetros de query. */
  consulta?: Readonly<Record<string, string>>;
  /** Nome do arquivo no cache (sem extensão). Decide a validade — ver o cabeçalho. */
  chave: string;
}

export interface EstatisticasCliente {
  chamadasDeRede: number;
  acertosDeCache: number;
  tentativasFalhas: number;
  porStatus: Readonly<Record<string, number>>;
  esperaTotalMs: number;
}

export interface OpcoesClienteSenado {
  cacheDir?: string;
  atualizar?: boolean;
  fetchImpl?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  agoraMs?: () => number;
  sorteio?: () => number;
  intervaloMinimoMs?: number;
  tentativasMax?: number;
  timeoutMs?: number;
  log?: (linha: string) => void;
}

export interface ClienteSenado {
  obter<T = unknown>(pedido: PedidoSenado): Promise<T>;
  estatisticas(): EstatisticasCliente;
}

/**
 * Espera antes da próxima tentativa: o `retry-after` do servidor (segundos),
 * com piso de 15 s e teto de 30 s, mais um jitter de 0–5 s. Sem `retry-after`
 * numérico vale 15 s. Resultado típico com `retry-after: 15`: 15–20 s.
 */
export function esperaEntreTentativasMs(
  retryAfter: string | null,
  sorteio = Math.random(),
): number {
  const t = retryAfter?.trim() ?? "";
  const seg = /^\d+$/.test(t) ? Number(t) : 15;
  const base = Math.min(Math.max(seg, 15), 30);
  return Math.round((base + sorteio * 5) * 1000);
}

/** URL completa de um pedido (a query em ordem de inserção). */
export function urlDoPedido(pedido: PedidoSenado): string {
  const url = new URL(pedido.caminho, SENADO_BASE);
  for (const [k, v] of Object.entries(pedido.consulta ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

function validarChave(chave: string): void {
  if (!CHAVE_VALIDA.test(chave) || chave.includes("..")) {
    throw new Error(`chave de cache inválida: ${JSON.stringify(chave)}`);
  }
}

async function lerCache(arquivo: string): Promise<{ texto: string; dados: unknown } | null> {
  let texto: string;
  try {
    texto = await readFile(arquivo, "utf8");
  } catch {
    return null;
  }
  try {
    return { texto, dados: JSON.parse(texto) };
  } catch {
    // Arquivo truncado ou corrompido: vale como ausente e é regravado.
    return null;
  }
}

/** Escrita atômica: arquivo temporário ao lado + `rename`. Nunca deixa um arquivo pela metade. */
export async function gravarArquivoAtomico(arquivo: string, texto: string): Promise<void> {
  const tmp = `${arquivo}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  try {
    await writeFile(tmp, texto, "utf8");
    await rename(tmp, arquivo);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function criarClienteSenado(opcoes: OpcoesClienteSenado = {}): ClienteSenado {
  const cacheDir = resolve(opcoes.cacheDir ?? "build/senado");
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agoraMs = opcoes.agoraMs ?? (() => Date.now());
  const sorteio = opcoes.sorteio ?? Math.random;
  const intervaloMs = opcoes.intervaloMinimoMs ?? INTERVALO_MINIMO_MS;
  const tentativasMax = opcoes.tentativasMax ?? TENTATIVAS_MAX;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS;
  const log = opcoes.log ?? (() => {});

  const stats = {
    chamadasDeRede: 0,
    acertosDeCache: 0,
    tentativasFalhas: 0,
    esperaTotalMs: 0,
  };
  const porStatus: Record<string, number> = {};
  const contar = (chave: string) => {
    porStatus[chave] = (porStatus[chave] ?? 0) + 1;
  };
  let ultimaChamadaMs = Number.NEGATIVE_INFINITY;

  const esperar = async (ms: number) => {
    if (ms <= 0) return;
    stats.esperaTotalMs += ms;
    await dormir(ms);
  };

  async function obter<T = unknown>(pedido: PedidoSenado): Promise<T> {
    validarChave(pedido.chave);
    const arquivo = join(cacheDir, `${pedido.chave}.json`);
    if (!opcoes.atualizar) {
      const noCache = await lerCache(arquivo);
      if (noCache) {
        stats.acertosDeCache++;
        return noCache.dados as T;
      }
    }

    const url = urlDoPedido(pedido);
    let ultimoErro = "";
    let ultimoStatus: number | null = null;
    for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
      await esperar(ultimaChamadaMs + intervaloMs - agoraMs());
      ultimaChamadaMs = agoraMs();
      stats.chamadasDeRede++;

      let retryAfter: string | null = null;
      let status: number | null = null;
      let texto: string | null = null;
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": SENADO_USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = res.status;
        retryAfter = res.headers.get("retry-after");
        contar(String(status));
        if (res.ok) texto = await res.text();
      } catch (err) {
        // Falha de rede, timeout ou corpo cortado: transitória.
        ultimoErro = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        status = null;
        contar("erro-de-rede");
      }
      ultimoStatus = status;

      if (status !== null && !(status >= 200 && status < 300) && !STATUS_TRANSITORIOS.has(status)) {
        throw new ErroSenado(`HTTP ${status} em ${url}`, status, url);
      }
      if (texto !== null) {
        let dados: T | undefined;
        try {
          dados = JSON.parse(texto) as T;
        } catch {
          ultimoErro = "200 com corpo que não é JSON";
          contar("json-invalido");
        }
        if (dados !== undefined) {
          await mkdir(cacheDir, { recursive: true });
          await gravarArquivoAtomico(arquivo, texto);
          return dados;
        }
      } else if (status !== null) {
        ultimoErro = `HTTP ${status}`;
      }

      stats.tentativasFalhas++;
      if (tentativa === tentativasMax) break;
      const espera = esperaEntreTentativasMs(retryAfter, sorteio());
      log(
        `  [senado] ${pedido.chave}: ${ultimoErro} — aguardando ${Math.round(espera / 1000)}s ` +
          `(tentativa ${tentativa}/${tentativasMax})`,
      );
      ultimoErro = "";
      await esperar(espera);
    }
    throw new ErroSenado(
      `${tentativasMax} tentativas esgotadas em ${url} (último status: ${ultimoStatus ?? "sem resposta"})`,
      ultimoStatus,
      url,
    );
  }

  return {
    obter,
    estatisticas: () => ({ ...stats, porStatus: { ...porStatus } }),
  };
}
