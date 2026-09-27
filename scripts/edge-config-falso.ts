/**
 * scripts/edge-config-falso.ts
 *
 * **Um Global Config de mentira, só para os portões e2e.** Serve as chaves de
 * `lib/edge-config/keys.ts` a partir das fixtures do modo simulado
 * (`tests/fixtures/simulacao/`), para que o SSR de `next start` leia DADO FIXO
 * em vez do Global Config de produção.
 *
 *   pnpm start:e2e        # sobe este servidor E o `next start -p 3100` filho
 *
 * ─── Por que existe (decisão do dono, 2026-09-26) ──────────────────────────
 *
 * Até aqui o `start:e2e` herdava o `EDGE_CONFIG` do `.env.local` — o `next
 * start` carrega esse arquivo sozinho —, então o SSR dos portões lia o payload
 * PUBLICADO EM PRODUÇÃO. Só leitura, mas não determinístico: duas execuções
 * mediam páginas diferentes, e um peso de página ou uma violação de axe mudava
 * sem que o código mudasse.
 *
 * Apagar o `EDGE_CONFIG` não resolve: fora do `pnpm dev` a fixture NUNCA entra
 * (`app/(pres)/page.tsx:564-565` e as guardas irmãs, o conserto de 13/09), e a
 * página cai no estado "Aguardando dados" — o portão auditaria outra página.
 * Este servidor mantém o app no caminho de PRODUÇÃO (o SDK oficial, o reader,
 * as guardas intactas) e troca só a fonte do dado.
 *
 * ─── Como o SDK chega aqui ─────────────────────────────────────────────────
 *
 * `@vercel/edge-config` aceita connection string com host arbitrário
 * (`parseExternalConnectionStringFromUrl`): com
 * `EDGE_CONFIG=http://127.0.0.1:3101/ecfg_e2efalso?token=e2e` o `get(chave)`
 * vira `GET /ecfg_e2efalso/item/<chave>?version=1`. Nada em `app/`, `lib/` ou
 * `components/` importa este arquivo nem sabe que ele existe.
 *
 * ─── Contrato ──────────────────────────────────────────────────────────────
 *
 *   - Só as chaves CANÔNICAS montadas pelos construtores de `keys.ts`:
 *       `projection-current-{pres,gov,sen,dep}-t1`  ← `<cargo>.json`
 *       `projection-uf-<UF>-{pres,gov,sen}-t1`      ← `<cargo>-uf.json`
 *     Nenhum alias legado, nenhuma chave com dois-pontos, nenhum turno 2 —
 *     o reader só pede esses no caminho de MISS, e aqui não há miss.
 *   - Chave desconhecida ⇒ **404, nunca um default.** O 404 leva o cabeçalho
 *     `x-edge-config-digest`, exatamente como a API real responde para "chave
 *     não gravada": o SDK devolve `undefined` e o reader classifica como
 *     `ausente`. Sem o cabeçalho o SDK lança `EDGE_CONFIG_NOT_FOUND` e o reader
 *     classificaria como `falha` (alarme) — que é outra coisa. Toda chave
 *     desconhecida é LOGADA em stderr: se o calendário virar para o turno 2 e
 *     as páginas caírem em "Aguardando", o log diz por quê.
 *   - Escuta só em `127.0.0.1`, e recusa subir se o `EDGE_CONFIG` do ambiente
 *     apontar para qualquer outro host — em particular para
 *     `edge-config.vercel.com`, que é produção.
 *   - Sem `Authorization: Bearer …` ⇒ 401, como a API real.
 *
 * ─── `--sem-blocos-novos` (Medição A, 2026-09-26) ──────────────────────────
 *
 * Retira, NA RESPOSTA (os arquivos não são tocados), o que a spec 022 e o
 * RF-209 acrescentaram ao payload: `votacao.corrida`,
 * `votacao.corrida_por_partido` e `votacao.destino_pendente` dos nacionais, e
 * o bloco `votacao` inteiro das UFs. Serve para medir o "antes" dos blocos
 * sobre o mesmo dado fixo. Não é modo de uso corrente.
 *
 * ─── Uso ───────────────────────────────────────────────────────────────────
 *
 *   tsx scripts/edge-config-falso.ts [--sem-blocos-novos] [-- <comando…>]
 *
 * A porta vem do próprio `EDGE_CONFIG` (fonte única). Com `-- <comando>`, o
 * comando sobe como filho herdando o ambiente, e o servidor morre junto com
 * ele. Sem comando, o servidor fica de pé sozinho até Ctrl-C.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Cargo } from "@/lib/config/calendar";
import { currentProjectionKey, ufProjectionKey } from "@/lib/edge-config/keys";

const DIR_SIMULACAO = path.join(process.cwd(), "tests", "fixtures", "simulacao");

/** Cargo da chave → nome-base do arquivo em `tests/fixtures/simulacao/`. */
const ARQUIVO_NACIONAL: Record<Cargo, string> = {
  pres: "presidente",
  gov: "governador",
  sen: "senador",
  dep: "deputado",
};

/**
 * Cargos com payload por UF no Global Config. Deputado fica de fora de
 * propósito: o detalhe por UF dele mora no Blob (`readDeputadoUfDetail`), não
 * numa chave — servir `deputado-uf.json` aqui inventaria uma chave que o
 * produto não lê.
 */
const CARGOS_UF = ["pres", "gov", "sen"] as const;

/** O único turno que as fixtures do simulado representam. */
const TURNO = 1 as const;

const DIGEST = "e2e-falso";

export interface OpcoesChaves {
  dir?: string;
  semBlocosNovos?: boolean;
}

function lerJson(dir: string, nome: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, `${nome}.json`), "utf8")) as unknown;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Medição A: tira os campos novos do bloco `votacao` NACIONAL (cópia). */
export function semBlocosNovosNacional(payload: unknown): unknown {
  if (!ehObjeto(payload) || !ehObjeto(payload.votacao)) return payload;
  const { corrida: _c, corrida_por_partido: _p, destino_pendente: _d, ...resto } = payload.votacao;
  return { ...payload, votacao: resto };
}

/** Medição A: tira o bloco `votacao` inteiro de um payload de UF (cópia). */
export function semBlocosNovosUf(payload: unknown): unknown {
  if (!ehObjeto(payload)) return payload;
  const { votacao: _v, ...resto } = payload;
  return resto;
}

/**
 * Monta o mapa chave → valor a partir das fixtures. As chaves vêm dos
 * construtores de `keys.ts`, nunca de literal: se o esquema de nome mudar, o
 * servidor falso muda junto em vez de servir chaves que ninguém pede.
 */
export function montarChaves(opts: OpcoesChaves = {}): Map<string, unknown> {
  const dir = opts.dir ?? DIR_SIMULACAO;
  const chaves = new Map<string, unknown>();

  for (const [cargo, nome] of Object.entries(ARQUIVO_NACIONAL) as [Cargo, string][]) {
    const bruto = lerJson(dir, nome);
    chaves.set(
      currentProjectionKey(cargo, TURNO),
      opts.semBlocosNovos ? semBlocosNovosNacional(bruto) : bruto,
    );
  }

  for (const cargo of CARGOS_UF) {
    const porUf = lerJson(dir, `${ARQUIVO_NACIONAL[cargo]}-uf`);
    if (!ehObjeto(porUf))
      throw new Error(`${ARQUIVO_NACIONAL[cargo]}-uf.json não é um mapa UF → payload`);
    for (const [sigla, payload] of Object.entries(porUf)) {
      chaves.set(
        ufProjectionKey(sigla, cargo, TURNO),
        opts.semBlocosNovos ? semBlocosNovosUf(payload) : payload,
      );
    }
  }

  return chaves;
}

/** Porta e id lidos do `EDGE_CONFIG`. Lança se ele não apontar para 127.0.0.1. */
export function lerConexao(edgeConfig: string | undefined): { porta: number; id: string } {
  if (!edgeConfig) throw new Error("EDGE_CONFIG ausente — o servidor falso lê a porta dele.");
  let url: URL;
  try {
    url = new URL(edgeConfig);
  } catch {
    throw new Error(`EDGE_CONFIG não é uma URL: "${edgeConfig}"`);
  }
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
    // Recusa, em vez de "corrigir": um EDGE_CONFIG de produção aqui significa
    // que o ambiente do teste está errado, e o comando filho leria produção.
    throw new Error(
      `EDGE_CONFIG precisa apontar para http://127.0.0.1 (recebido host "${url.hostname}"). ` +
        "O servidor falso não sobe — nem o comando filho — contra outro host.",
    );
  }
  const id = url.pathname.split("/")[1] ?? "";
  if (!id.startsWith("ecfg_")) throw new Error(`EDGE_CONFIG sem id ecfg_*: "${url.pathname}"`);
  const porta = Number(url.port);
  if (!Number.isInteger(porta) || porta <= 0) throw new Error("EDGE_CONFIG sem porta explícita.");
  return { porta, id };
}

export interface Resposta {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

/** Roteamento puro — testável sem abrir porta. */
export function responder(
  chaves: ReadonlyMap<string, unknown>,
  id: string,
  metodo: string,
  urlPath: string,
  autorizacao: string | undefined,
): Resposta {
  const json = { "content-type": "application/json" };
  if (!autorizacao?.startsWith("Bearer ")) {
    return { status: 401, headers: json, corpo: JSON.stringify({ error: "unauthorized" }) };
  }
  const { pathname } = new URL(urlPath, "http://127.0.0.1");
  const prefixo = `/${id}/item/`;
  if ((metodo === "GET" || metodo === "HEAD") && pathname.startsWith(prefixo)) {
    const chave = decodeURIComponent(pathname.slice(prefixo.length));
    if (chaves.has(chave)) {
      return {
        status: 200,
        headers: { ...json, "x-edge-config-digest": DIGEST },
        corpo: metodo === "HEAD" ? "" : JSON.stringify(chaves.get(chave)),
      };
    }
    return {
      status: 404,
      headers: { ...json, "x-edge-config-digest": DIGEST },
      corpo: JSON.stringify({ error: "not_found", key: chave }),
    };
  }
  // Qualquer outra rota (`/items`, `/digest`, id errado): 404 SEM digest — o
  // SDK trata como "este Global Config não existe", que é o que é.
  return { status: 404, headers: json, corpo: JSON.stringify({ error: "not_found" }) };
}

export function criarServidor(chaves: ReadonlyMap<string, unknown>, id: string): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = responder(chaves, id, req.method ?? "GET", req.url ?? "/", req.headers.authorization);
    if (r.status === 404) {
      process.stderr.write(`[edge-config-falso] 404 ${req.method} ${req.url}\n`);
    }
    res.writeHead(r.status, r.headers);
    res.end(r.corpo);
  });
}

async function main(argv: string[]): Promise<void> {
  const separador = argv.indexOf("--");
  const flags = separador === -1 ? argv : argv.slice(0, separador);
  const comando = separador === -1 ? [] : argv.slice(separador + 1);
  const semBlocosNovos = flags.includes("--sem-blocos-novos");

  const { porta, id } = lerConexao(process.env.EDGE_CONFIG);
  const chaves = montarChaves({ semBlocosNovos });
  const servidor = criarServidor(chaves, id);
  await new Promise<void>((ok) => servidor.listen(porta, "127.0.0.1", () => ok()));
  process.stderr.write(
    `[edge-config-falso] ${chaves.size} chaves em http://127.0.0.1:${porta}/${id}` +
      `${semBlocosNovos ? " (--sem-blocos-novos)" : ""}\n`,
  );

  if (comando.length === 0) return;

  const [exe, ...args] = comando;
  const filho = spawn(exe as string, args, { stdio: "inherit", env: process.env });
  const repassar = (sinal: NodeJS.Signals) => () => filho.kill(sinal);
  process.on("SIGINT", repassar("SIGINT"));
  process.on("SIGTERM", repassar("SIGTERM"));
  filho.on("exit", (codigo, sinal) => {
    servidor.close();
    process.exit(codigo ?? (sinal ? 1 : 0));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((erro: unknown) => {
    process.stderr.write(
      `[edge-config-falso] ${erro instanceof Error ? erro.message : String(erro)}\n`,
    );
    process.exit(1);
  });
}
