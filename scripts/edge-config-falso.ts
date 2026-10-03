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
 *       `projection-current-{est,dis}-t1`           ← `deputado-{estadual,distrital}.json`
 *                                                     (spec 027; opcionais — sem o arquivo,
 *                                                     a chave fica ausente)
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
 * ─── O BUILD também precisa dele (2026-09-29) ─────────────────────────────
 *
 * Até 29/09 só o `next start` subia com este servidor; o `.next` saía de um
 * `pnpm build` — que numa worktree, no CI ou num clone novo (sem `.env.local`)
 * não tem `EDGE_CONFIG`, e no checkout principal pega o de PRODUÇÃO do
 * `.env.local`. Sem ele, o Next pré-montava as rotas que leem o
 * Global Config (`/`, `/senador`, `/deputado-federal`, `/uf/SP/*` —
 * `revalidate = 60`) como ESTÁTICAS, com a casca "Esta página ainda não
 * recebeu dados", e o `next start` servia essa casca. A regeneração nunca
 * consertava: o SDK busca com `cache: "no-store"`
 * (`@vercel/edge-config/dist/index.next-js.js`, `createClient`), o Next lê
 * isso como uso dinâmico e aborta com "Page changed from static to dynamic at
 * runtime". Os portões de peso e de acessibilidade mediram a casca vazia.
 *
 * O conserto é montar o `.next` com este servidor de pé: `pnpm build:e2e`
 * (`--marcar-build`). Com o `EDGE_CONFIG` presente no build, o Next marca
 * essas rotas como dinâmicas (ƒ) — que é o que o README do SDK diz para
 * qualquer leitura com o padrão `no-store` e o que o `pnpm build` com o
 * `.env.local` já produzia —, e cada requisição lê o dado fixo daqui. ISR
 * "de verdade" contra um Global Config por HTTP não existe: só o caminho
 * local do SDK (o arquivo em `/opt/edge-config` das funções da Vercel) evita
 * o `fetch`.
 *
 * `--marcar-build` grava, depois de um `next build` que terminou bem,
 * {@link MARCA_BUILD_E2E} no `.next` com o `BUILD_ID`. `--exigir-build-e2e`
 * (o `start:e2e`) recusa subir se a marca faltar ou for de outro build: um
 * `pnpm build` comum depois do `build:e2e` troca o `BUILD_ID`, e o portão
 * voltaria a medir a casca sem ninguém ver.
 *
 * ─── O Blob também (spec 026, 2026-09-29) ─────────────────────────────────
 *
 * `/uf/SP/deputado-federal` lê o detalhe da UF do Vercel Blob
 * (`readDeputadoUfDetail`), não do Global Config — e com o
 * `BLOB_READ_WRITE_TOKEN` zerado pelo `build:e2e`/`start:e2e` a página
 * renderizava "Detalhe indisponível": o portão de peso media uma página sem a
 * parte que mais pesa (ADR-0065 D5). Agora este servidor também responde como
 * o CDN público do Blob, sob `/blob/`, e os dois scripts apontam
 * `BLOB_PUBLIC_BASE_URL=http://127.0.0.1:3101/blob` para cá
 * (`lib/blob/paths.ts::blobPublicBaseUrl` — o override que já existia para
 * os testes).
 *
 *   `/blob/deputado/uf/<UF>.json`        ← `deputado-uf.json[UF]`
 *   `/blob/deputado/uf-lista/<UF>.json`  ← `deputado-uf-lista.json[UF]` (se existir)
 *   `/blob/deputado-estadual/uf/<UF>.json`       ← `deputado-estadual-uf.json[UF]`
 *   `/blob/deputado-estadual/uf-lista/<UF>.json` ← `deputado-estadual-uf-lista.json[UF]`
 *   `/blob/deputado-distrital/uf/DF.json`        ← `deputado-distrital-uf.json.DF`
 *     (spec 027 RF-289; arquivos de `data-pipeline/simulacao-assembleias.py`,
 *     todos opcionais. O caminho sai de `deputadoUfBlobPathname(cargo, UF)`,
 *     que LANÇA para UF fora da casa — o DF no 7, qualquer outra no 8.)
 *
 * Qualquer outro caminho do Blob ⇒ 404, a resposta do CDN para objeto não
 * gravado. ⚠️ Isso muda três coisas FORA de Deputado, todas na direção de
 * produção: (1) as páginas passam a emitir `<img>` de foto de candidato (a URL
 * existe; o arquivo não — e o 404 da foto não é logado); (2) o detalhe
 * municipal de `/uf/SP*` passa de "não configurado" a "não publicado"
 * (`DetailUnavailable`, mesma caixa, outra frase); (3) as etiquetas tentam o
 * Blob e caem na cópia do build, como em produção sem objeto publicado.
 *
 * ─── O interruptor da projeção (ADR-0063) ──────────────────────────────────
 *
 * Chave `interruptor-projecao-dep`. Falha fechada: AUSENTE = DESLIGADA. Por
 * isso ela só é servida quando alguém pede:
 *
 *   `--projecao-ligada`     ⇒ `{ligada: true}`  — o estado pretendido da noite
 *                             (o passo de 03/10), e o que os portões medem:
 *                             é a página mais pesada;
 *   `--projecao-desligada`  ⇒ `{ligada: false}` — para medir a página sem;
 *   nenhum dos dois         ⇒ `interruptor-projecao-dep.json` da fixture, se
 *                             existir; senão, AUSENTE (= desligada).
 *
 * E a chave das assembleias, `interruptor-projecao-est` (cargos 7 e 8, spec
 * 027 RF-287/RF-289), independente da de cima — as flags NUNCA a tocam (`-dep`
 * não liga 7 e 8): `interruptor-projecao-est.json` da fixture, se existir;
 * senão `{ligada: false}`, que é como a produção a publica na Fase 1 (as
 * assembleias não projetam, RF-285).
 *
 * ─── Uso ───────────────────────────────────────────────────────────────────
 *
 *   tsx scripts/edge-config-falso.ts [--sem-blocos-novos] [--marcar-build]
 *                                    [--exigir-build-e2e]
 *                                    [--projecao-ligada|--projecao-desligada]
 *                                    [-- <comando…>]
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

import { deputadoUfBlobPathname, deputadoUfListaBlobPathname } from "@/lib/blob/paths";
import type { Cargo } from "@/lib/config/calendar";
import type { CargoProporcional } from "@/lib/config/cargos";
import {
  currentProjectionKey,
  interruptorProjecaoDepKey,
  interruptorProjecaoEstKey,
  ufProjectionKey,
} from "@/lib/edge-config/keys";

const DIR_SIMULACAO = path.join(process.cwd(), "tests", "fixtures", "simulacao");

/**
 * Cargo da chave → nome-base do arquivo em `tests/fixtures/simulacao/`.
 * Obrigatórios: sem eles o servidor não sobe (o simulado do federal existe
 * desde 14/09).
 */
const ARQUIVO_NACIONAL: Record<Exclude<Cargo, "est" | "dis">, string> = {
  pres: "presidente",
  gov: "governador",
  sen: "senador",
  dep: "deputado",
};

/**
 * As assembleias (spec 027 frente S): nacional e detalhe por UF de cada casa,
 * de `data-pipeline/simulacao-assembleias.py`. Opcionais — num diretório sem
 * eles a chave e o Blob ficam ausentes, e o portão reprova pela casca
 * ("Aguardando os dados", `data-testid="casas-aguardando"`) ou pelo "detalhe
 * indisponível", nunca mede outra página calado.
 */
const ARQUIVOS_ASSEMBLEIA: ReadonlyArray<{
  cargo: Extract<CargoProporcional, 7 | 8>;
  token: Extract<Cargo, "est" | "dis">;
  base: string;
}> = [
  { cargo: 7, token: "est", base: "deputado-estadual" },
  { cargo: 8, token: "dis", base: "deputado-distrital" },
];

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
  /**
   * `true` ⇒ serve `{ligada: true}`; `false` ⇒ `{ligada: false}`; ausente ⇒
   * a fixture `interruptor-projecao-dep.json`, ou a chave AUSENTE (= desligada).
   */
  projecaoLigada?: boolean;
}

/** Prefixo sob o qual este servidor imita o CDN público do Blob. */
export const PREFIXO_BLOB = "/blob/";

/** Arquivo opcional da fixture com o VALOR do interruptor. */
const ARQUIVO_INTERRUPTOR = "interruptor-projecao-dep";
/** Idem, das assembleias (spec 027). */
const ARQUIVO_INTERRUPTOR_EST = "interruptor-projecao-est";

function lerJson(dir: string, nome: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, `${nome}.json`), "utf8")) as unknown;
}

/** `lerJson`, ou `undefined` quando o arquivo não existe (fixture opcional). */
function lerJsonOpcional(dir: string, nome: string): unknown {
  if (!fs.existsSync(path.join(dir, `${nome}.json`))) return undefined;
  return lerJson(dir, nome);
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

  for (const { token, base } of ARQUIVOS_ASSEMBLEIA) {
    const bruto = lerJsonOpcional(dir, base);
    if (bruto !== undefined) chaves.set(currentProjectionKey(token, TURNO), bruto);
  }

  // Assembleias: fixture > `{ligada: false}` (Fase 1). As flags são do `-dep`.
  chaves.set(
    interruptorProjecaoEstKey(),
    lerJsonOpcional(dir, ARQUIVO_INTERRUPTOR_EST) ?? { ligada: false, por: "edge-config-falso" },
  );

  // Interruptor: flag > fixture > AUSENTE (= desligada, a regra de produção).
  if (opts.projecaoLigada !== undefined) {
    chaves.set(interruptorProjecaoDepKey(), {
      ligada: opts.projecaoLigada,
      por: "edge-config-falso",
    });
  } else {
    const interruptor = lerJsonOpcional(dir, ARQUIVO_INTERRUPTOR);
    if (interruptor !== undefined) chaves.set(interruptorProjecaoDepKey(), interruptor);
  }

  return chaves;
}

/**
 * Monta o mapa pathname do Blob → objeto, a partir das fixtures. Os caminhos
 * vêm de `lib/blob/paths.ts` — o mesmo construtor que o leitor usa.
 */
export function montarBlobs(opts: Pick<OpcoesChaves, "dir"> = {}): Map<string, unknown> {
  const dir = opts.dir ?? DIR_SIMULACAO;
  const blobs = new Map<string, unknown>();

  const porUf = lerJson(dir, "deputado-uf");
  if (!ehObjeto(porUf)) throw new Error("deputado-uf.json não é um mapa UF → detalhe");
  for (const [sigla, detalhe] of Object.entries(porUf)) {
    blobs.set(deputadoUfBlobPathname(6, sigla), detalhe);
  }

  const listas = lerJsonOpcional(dir, "deputado-uf-lista");
  if (listas !== undefined) {
    if (!ehObjeto(listas)) throw new Error("deputado-uf-lista.json não é um mapa UF → lista");
    for (const [sigla, lista] of Object.entries(listas)) {
      blobs.set(deputadoUfListaBlobPathname(6, sigla), lista);
    }
  }

  for (const { cargo, base } of ARQUIVOS_ASSEMBLEIA) {
    for (const [sufixo, caminho] of [
      ["uf", deputadoUfBlobPathname],
      ["uf-lista", deputadoUfListaBlobPathname],
    ] as const) {
      const mapa = lerJsonOpcional(dir, `${base}-${sufixo}`);
      if (mapa === undefined) continue;
      if (!ehObjeto(mapa)) throw new Error(`${base}-${sufixo}.json não é um mapa UF → objeto`);
      for (const [sigla, objeto] of Object.entries(mapa)) {
        // Lança para UF fora da casa (o DF no 7, outra UF no 8): fixture
        // errada não vira objeto no endereço de outra casa.
        blobs.set(caminho(cargo, sigla), objeto);
      }
    }
  }

  return blobs;
}

/**
 * `BLOB_PUBLIC_BASE_URL`, se declarado, tem de apontar para ESTE servidor:
 * `http://127.0.0.1:<porta do EDGE_CONFIG>/blob`. Qualquer outra coisa é
 * ambiente de teste errado — e recusamos em vez de "corrigir", como com o
 * `EDGE_CONFIG`: o comando filho leria o Blob de outro lugar.
 */
export function conferirBaseDoBlob(base: string | undefined, porta: number): void {
  if (!base) return;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`BLOB_PUBLIC_BASE_URL não é uma URL: "${base}"`);
  }
  const esperado = `http://127.0.0.1:${porta}${PREFIXO_BLOB.slice(0, -1)}`;
  const recebido = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  if (recebido !== esperado) {
    throw new Error(
      `BLOB_PUBLIC_BASE_URL precisa ser ${esperado} (recebido "${base}"). ` +
        "O servidor falso não sobe — nem o comando filho — lendo o Blob de outro lugar.",
    );
  }
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
  blobs: ReadonlyMap<string, unknown> = new Map(),
): Resposta {
  const json = { "content-type": "application/json" };
  const caminho = new URL(urlPath, "http://127.0.0.1").pathname;
  // O Blob é PÚBLICO — o CDN real não pede credencial, e este também não. Vem
  // antes do 401 do Global Config por isso.
  if ((metodo === "GET" || metodo === "HEAD") && caminho.startsWith(PREFIXO_BLOB)) {
    const pathname = decodeURIComponent(caminho.slice(PREFIXO_BLOB.length));
    if (blobs.has(pathname)) {
      return {
        status: 200,
        headers: { ...json, "cache-control": "public, max-age=60" },
        corpo: metodo === "HEAD" ? "" : JSON.stringify(blobs.get(pathname)),
      };
    }
    return { status: 404, headers: json, corpo: JSON.stringify({ error: "not_found" }) };
  }
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

/** Arquivo, dentro do `.next`, que diz "este build saiu do `build:e2e`". */
export const MARCA_BUILD_E2E = "e2e-edge-config.json";

export interface MarcaBuildE2e {
  build_id: string;
  /** Só o host:porta — nunca o token da connection string. */
  edge_config: string;
  gravada_em: string;
}

function lerBuildId(distDir: string): string | null {
  try {
    return fs.readFileSync(path.join(distDir, "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Grava a marca depois de um `next build` que terminou bem. Lança se não há `BUILD_ID`. */
export function gravarMarcaBuild(distDir: string, edgeConfig: string): MarcaBuildE2e {
  const buildId = lerBuildId(distDir);
  if (!buildId) throw new Error(`sem ${distDir}/BUILD_ID — o next build não produziu um build`);
  const url = new URL(edgeConfig);
  const marca: MarcaBuildE2e = {
    build_id: buildId,
    edge_config: `${url.protocol}//${url.host}`,
    gravada_em: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(distDir, MARCA_BUILD_E2E), `${JSON.stringify(marca, null, 2)}\n`);
  return marca;
}

export type ConferenciaBuild = { ok: true; marca: MarcaBuildE2e } | { ok: false; motivo: string };

/**
 * O `.next` saiu do `build:e2e`? Pura quanto ao ambiente (lê só `distDir`),
 * para o teste unitário cobrir os três jeitos de errar.
 */
export function conferirBuildE2e(distDir: string): ConferenciaBuild {
  const buildId = lerBuildId(distDir);
  if (!buildId) {
    return { ok: false, motivo: `não há build em ${distDir} — rode \`pnpm build:e2e\` antes.` };
  }
  let marca: Partial<MarcaBuildE2e> | null = null;
  try {
    marca = JSON.parse(fs.readFileSync(path.join(distDir, MARCA_BUILD_E2E), "utf8"));
  } catch {
    marca = null;
  }
  if (!marca || typeof marca.build_id !== "string") {
    return {
      ok: false,
      motivo:
        `o ${distDir} saiu de \`pnpm build\`, não de \`pnpm build:e2e\`: as rotas que leem o ` +
        'Global Config foram montadas sem dado e o portão mediria a casca "Esta página ainda ' +
        'não recebeu dados". Rode `pnpm build:e2e`.',
    };
  }
  if (marca.build_id !== buildId) {
    return {
      ok: false,
      motivo:
        `a marca do build:e2e é do build ${marca.build_id}, mas o ${distDir} é do build ` +
        `${buildId} (houve um \`pnpm build\` depois). Rode \`pnpm build:e2e\` de novo.`,
    };
  }
  return { ok: true, marca: marca as MarcaBuildE2e };
}

/**
 * Foto de candidato: a página emite a URL, a fixture não tem a imagem. São
 * dezenas por página — logar cada 404 afogaria os que importam.
 */
const PREFIXO_FOTO_SEM_LOG = `${PREFIXO_BLOB}candidatos/foto/`;

export function criarServidor(
  chaves: ReadonlyMap<string, unknown>,
  id: string,
  blobs: ReadonlyMap<string, unknown> = new Map(),
): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = responder(
      chaves,
      id,
      req.method ?? "GET",
      req.url ?? "/",
      req.headers.authorization,
      blobs,
    );
    if (r.status === 404 && !(req.url ?? "").startsWith(PREFIXO_FOTO_SEM_LOG)) {
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
  const ligada = flags.includes("--projecao-ligada");
  const desligada = flags.includes("--projecao-desligada");
  if (ligada && desligada) throw new Error("--projecao-ligada e --projecao-desligada juntos");
  const projecaoLigada = ligada ? true : desligada ? false : undefined;
  const marcarBuild = flags.includes("--marcar-build");
  const exigirBuildE2e = flags.includes("--exigir-build-e2e");
  const distDir = path.join(process.cwd(), ".next");

  const { porta, id } = lerConexao(process.env.EDGE_CONFIG);
  conferirBaseDoBlob(process.env.BLOB_PUBLIC_BASE_URL, porta);
  if (exigirBuildE2e) {
    const conf = conferirBuildE2e(distDir);
    if (!conf.ok) throw new Error(conf.motivo);
    process.stderr.write(`[edge-config-falso] build:e2e ${conf.marca.build_id} conferido\n`);
  }
  const chaves = montarChaves({ semBlocosNovos, projecaoLigada });
  const blobs = montarBlobs();
  const servidor = criarServidor(chaves, id, blobs);
  await new Promise<void>((ok) => servidor.listen(porta, "127.0.0.1", () => ok()));
  const interruptor =
    projecaoLigada === undefined
      ? chaves.has(interruptorProjecaoDepKey())
        ? "da fixture"
        : "AUSENTE (= desligada)"
      : projecaoLigada
        ? "ligado"
        : "desligado";
  process.stderr.write(
    `[edge-config-falso] ${chaves.size} chaves em http://127.0.0.1:${porta}/${id}` +
      ` + ${blobs.size} objetos de Blob em ${PREFIXO_BLOB} · interruptor ${interruptor}` +
      ` · assembleias: ${
        ARQUIVOS_ASSEMBLEIA.filter(({ token }) => chaves.has(currentProjectionKey(token, TURNO)))
          .map(({ token }) => token)
          .join("+") || "NENHUMA (o portão das três telas da spec 027 vai reprovar)"
      }` +
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
    const final = codigo ?? (sinal ? 1 : 0);
    if (final === 0 && marcarBuild) {
      const marca = gravarMarcaBuild(distDir, process.env.EDGE_CONFIG as string);
      process.stderr.write(
        `[edge-config-falso] build ${marca.build_id} marcado como build:e2e (${MARCA_BUILD_E2E})\n`,
      );
    }
    process.exit(final);
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
