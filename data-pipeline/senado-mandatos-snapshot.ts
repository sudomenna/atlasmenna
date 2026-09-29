// data-pipeline/senado-mandatos-snapshot.ts
//
// **A foto do Senado** — spec 023, RF-215; ADR-0062 item 1.
//
// Lê a lista de senadores em exercício do Senado Federal (Dados Abertos) e
// grava duas fotos datadas em `editorial/senado/`:
//
//   - `mandato-2031.json` — os 27 com mandato até 2031 (segunda legislatura
//     do mandato = 58), um por UF. É o que o hemiciclo de 81 cadeiras usa.
//   - `mandato-2027.json` — os 54 que ocupam hoje as vagas em disputa em 2026
//     (segunda legislatura = 57), dois por UF. Para a visão de renovação.
//
// Uso (acionado pelo dono, NUNCA pela CI nem por cron):
//
//   pnpm senado:snapshot                  # consulta a API e grava
//   pnpm senado:snapshot --seco           # consulta e valida, não grava
//   pnpm senado:snapshot --de-arquivo <resposta.json> --consultado-em <ISO>
//                                         # refaz a foto de uma resposta salva
//
// ─── O que este script NÃO toca ─────────────────────────────────────────────
//
// Banco, Blob, Edge Config: nenhum. Não lê `.env.local` e não precisa de
// variável nenhuma. A única rede é UM `GET` público ao Senado.
//
// ─── Lista branca (constituição § 5, ADR-0062) ──────────────────────────────
//
// A resposta do Senado traz nome civil, sexo, e-mail, telefones, foto, bloco.
// Nada disso é gravado: a foto leva UF, código, nome parlamentar, partido,
// participação, titular (se suplente), legislaturas e código do mandato. O
// validador de `lib/senado/mandato-2031.ts` reprova qualquer campo a mais.
//
// ─── Tudo ou nada ───────────────────────────────────────────────────────────
//
// As invariantes (27 um-por-UF; 54 dois-por-UF; 81 códigos de mandato
// distintos; partido da paleta ou "S/Partido") são conferidas ANTES de gravar.
// Se uma falha, nada é gravado — nem a foto que passou. As duas são escritas
// em arquivo temporário e renomeadas (a troca é atômica por arquivo).
//
// ─── A API ──────────────────────────────────────────────────────────────────
//
// `GET https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json` com
// `Accept: application/json`. Responde 503 com frequência (`retry-after: 15`):
// até 8 tentativas, esperando o `retry-after` (ou 15 s, no mínimo). Limite
// oficial de 10 req/s — aqui é uma requisição por tentativa.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  type FotoSenado,
  type ParticipacaoSenado,
  type SenadorEmExercicio,
  UFS_DO_SENADO,
  type ValidacaoFotoSenado,
  validarMandato2027,
  validarMandato2031,
} from "@/lib/senado/mandato-2031";

export const URL_LISTA_ATUAL = "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json";
export const FONTE = "Senado Federal — Dados Abertos";

/** Segunda legislatura do mandato de quem fica até 2031 (eleitos em 2022). */
export const LEGISLATURA_FINAL_2031 = "58";
/** Segunda legislatura do mandato de quem sai em 2027 (vagas em disputa em 2026). */
export const LEGISLATURA_FINAL_2027 = "57";

export const TENTATIVAS = 8;
export const ESPERA_MINIMA_MS = 15_000;

// ---------------------------------------------------------------------------
// Forma da resposta — só o que a foto lê. O resto passa sem ser olhado.
// ---------------------------------------------------------------------------

const LegislaturaSchema = z.object({ NumeroLegislatura: z.string() });

const ParlamentarSchema = z.object({
  IdentificacaoParlamentar: z.object({
    CodigoParlamentar: z.string(),
    NomeParlamentar: z.string(),
    UfParlamentar: z.string(),
    SiglaPartidoParlamentar: z.string(),
  }),
  Mandato: z.object({
    CodigoMandato: z.string(),
    UfParlamentar: z.string().optional(),
    DescricaoParticipacao: z.string(),
    PrimeiraLegislaturaDoMandato: LegislaturaSchema,
    SegundaLegislaturaDoMandato: LegislaturaSchema,
    Titular: z.object({ NomeParlamentar: z.string() }).optional(),
  }),
});

const RespostaSchema = z.object({
  ListaParlamentarEmExercicio: z.object({
    Metadados: z.object({ Versao: z.string() }),
    Parlamentares: z.object({ Parlamentar: z.array(ParlamentarSchema) }),
  }),
});

type Parlamentar = z.infer<typeof ParlamentarSchema>;

/** "Titular" ⇒ titular; "1º Suplente", "2º Suplente"… ⇒ suplente em exercício. */
export function participacaoDe(descricao: string): ParticipacaoSenado | null {
  const d = descricao.trim();
  if (d === "Titular") return "Titular";
  if (/suplente/i.test(d)) return "Suplente em exercício";
  return null;
}

/** Um parlamentar da resposta → uma linha da foto, pela lista branca. */
export function senadorDaResposta(p: Parlamentar): SenadorEmExercicio {
  const id = p.IdentificacaoParlamentar;
  const m = p.Mandato;
  const participacao = participacaoDe(m.DescricaoParticipacao);
  if (participacao === null) {
    throw new Error(
      `participação desconhecida para ${id.NomeParlamentar} (${id.UfParlamentar}): ` +
        `"${m.DescricaoParticipacao}"`,
    );
  }
  const suplente = participacao === "Suplente em exercício";
  if (suplente && !m.Titular?.NomeParlamentar) {
    throw new Error(
      `suplente sem titular na resposta: ${id.NomeParlamentar} (${id.UfParlamentar})`,
    );
  }
  return {
    uf: id.UfParlamentar,
    codigo: id.CodigoParlamentar,
    nome_parlamentar: id.NomeParlamentar,
    partido: id.SiglaPartidoParlamentar,
    participacao,
    ...(suplente ? { titular_do_mandato: m.Titular?.NomeParlamentar as string } : {}),
    legislaturas: [
      Number(m.PrimeiraLegislaturaDoMandato.NumeroLegislatura),
      Number(m.SegundaLegislaturaDoMandato.NumeroLegislatura),
    ],
    codigo_mandato: m.CodigoMandato,
  };
}

export interface FotosSenado {
  mandato2031: FotoSenado;
  mandato2027: FotoSenado;
}

export type ResultadoFotos = { ok: true; fotos: FotosSenado } | { ok: false; erros: string[] };

/**
 * A resposta da API → as duas fotos, validadas. Pura: não lê rede nem disco.
 * `consultadoEm` é o instante da consulta (ISO); na foto refeita de um arquivo
 * salvo, é o de quando o arquivo foi baixado — nunca "agora".
 */
export function montarFotos(
  resposta: unknown,
  consultadoEm: string,
  fonteUrl: string = URL_LISTA_ATUAL,
): ResultadoFotos {
  const lida = RespostaSchema.safeParse(resposta);
  if (!lida.success) {
    return { ok: false, erros: [`resposta fora da forma esperada: ${lida.error.message}`] };
  }
  const { Metadados, Parlamentares } = lida.data.ListaParlamentarEmExercicio;

  const erros: string[] = [];
  const por2031: SenadorEmExercicio[] = [];
  const por2027: SenadorEmExercicio[] = [];
  for (const p of Parlamentares.Parlamentar) {
    let linha: SenadorEmExercicio;
    try {
      linha = senadorDaResposta(p);
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    const segunda = p.Mandato.SegundaLegislaturaDoMandato.NumeroLegislatura;
    if (segunda === LEGISLATURA_FINAL_2031) por2031.push(linha);
    else if (segunda === LEGISLATURA_FINAL_2027) por2027.push(linha);
    else
      erros.push(
        `${linha.nome_parlamentar} (${linha.uf}): mandato termina na legislatura ${segunda}`,
      );
  }

  // Ordem estável: UF, depois código do mandato — o diff entre duas fotos
  // mostra só o que mudou.
  const ordem = (a: SenadorEmExercicio, b: SenadorEmExercicio) =>
    a.uf !== b.uf ? (a.uf < b.uf ? -1 : 1) : Number(a.codigo_mandato) - Number(b.codigo_mandato);
  por2031.sort(ordem);
  por2027.sort(ordem);

  const base = {
    fonte: FONTE,
    fonte_url: fonteUrl,
    consultado_em: consultadoEm,
    versao_dataset: Metadados.Versao,
  };
  const foto2031: FotoSenado = { ...base, senadores: por2031 };
  const foto2027: FotoSenado = { ...base, senadores: por2027 };

  const v2031: ValidacaoFotoSenado = validarMandato2031(foto2031);
  const v2027: ValidacaoFotoSenado = validarMandato2027(foto2027);
  if (!v2031.ok) erros.push(...v2031.erros.map((e) => `mandato-2031: ${e}`));
  if (!v2027.ok) erros.push(...v2027.erros.map((e) => `mandato-2027: ${e}`));

  const todos = [...por2031, ...por2027].map((s) => s.codigo_mandato);
  const esperado = UFS_DO_SENADO.length * 3;
  if (new Set(todos).size !== esperado || todos.length !== esperado) {
    erros.push(
      `esperados ${esperado} códigos de mandato distintos nas duas fotos; ` +
        `vieram ${todos.length}, ${new Set(todos).size} distintos`,
    );
  }

  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, fotos: { mandato2031: foto2031, mandato2027: foto2027 } };
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;
export type Esperar = (ms: number) => Promise<void>;

/** `retry-after` em segundos → ms, nunca abaixo de {@link ESPERA_MINIMA_MS}. */
export function esperaDe(retryAfter: string | null): number {
  const s = Number(retryAfter);
  return Number.isFinite(s) && s > 0 ? Math.max(ESPERA_MINIMA_MS, s * 1000) : ESPERA_MINIMA_MS;
}

/**
 * `GET` com nova tentativa em 503/429/5xx e em erro de rede. Qualquer outro
 * status (404, 400…) é erro definitivo: tentar de novo não muda a resposta.
 */
export async function buscarLista(
  buscar: Buscar = fetch,
  esperar: Esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  tentativas: number = TENTATIVAS,
  log: (msg: string) => void = console.log,
): Promise<unknown> {
  let motivo = "";
  for (let t = 1; t <= tentativas; t++) {
    let espera = ESPERA_MINIMA_MS;
    let resp: Response | null = null;
    try {
      resp = await buscar(URL_LISTA_ATUAL, { headers: { Accept: "application/json" } });
    } catch (e) {
      motivo = e instanceof Error ? e.message : String(e);
    }
    if (resp) {
      if (resp.ok) return await resp.json();
      motivo = `HTTP ${resp.status}`;
      if (resp.status !== 429 && resp.status < 500) {
        throw new Error(`${URL_LISTA_ATUAL}: ${motivo} — erro definitivo, sem nova tentativa`);
      }
      espera = esperaDe(resp.headers.get("retry-after"));
    }
    if (t < tentativas) {
      log(`  tentativa ${t}/${tentativas}: ${motivo}; nova tentativa em ${espera / 1000}s`);
      await esperar(espera);
    }
  }
  throw new Error(`${URL_LISTA_ATUAL}: ${tentativas} tentativas sem resposta (${motivo})`);
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

/**
 * JSON com 2 espaços e as listas curtas de números numa linha só — a forma
 * que o `biome format` dá. Sem isso a foto recém-tirada reprovaria no hook de
 * pre-commit (`biome check` na árvore inteira).
 */
export function jsonDaFoto(foto: FotoSenado): string {
  return `${JSON.stringify(foto, null, 2).replace(
    /\[\s+(-?\d+(?:,\s+-?\d+)*)\s+\]/g,
    (_, corpo: string) => `[${corpo.split(/,\s+/).join(", ")}]`,
  )}\n`;
}

/** Grava as duas fotos: temporário + rename, só depois de as duas validarem. */
export function gravarFotos(fotos: FotosSenado, dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const alvos: Array<[string, FotoSenado]> = [
    [path.join(dir, "mandato-2031.json"), fotos.mandato2031],
    [path.join(dir, "mandato-2027.json"), fotos.mandato2027],
  ];
  for (const [alvo, foto] of alvos) writeFileSync(`${alvo}.tmp`, jsonDaFoto(foto));
  for (const [alvo] of alvos) renameSync(`${alvo}.tmp`, alvo);
  return alvos.map(([alvo]) => alvo);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  deArquivo: string | null;
  consultadoEm: string | null;
  saida: string;
  seco: boolean;
}

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = { deArquivo: null, consultadoEm: null, saida: "editorial/senado", seco: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seco") cli.seco = true;
    else if (a === "--de-arquivo") cli.deArquivo = argv[++i] ?? null;
    else if (a === "--consultado-em") cli.consultadoEm = argv[++i] ?? null;
    else if (a === "--saida") cli.saida = argv[++i] ?? cli.saida;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (cli.deArquivo && !cli.consultadoEm) {
    throw new Error(
      "--de-arquivo exige --consultado-em <ISO>: a data da foto é a da consulta que gerou o " +
        "arquivo, nunca a de agora",
    );
  }
  return cli;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  let resposta: unknown;
  let consultadoEm: string;
  if (cli.deArquivo) {
    resposta = JSON.parse(readFileSync(cli.deArquivo, "utf8"));
    consultadoEm = cli.consultadoEm as string;
    console.log(`Foto do Senado a partir de ${cli.deArquivo} (consultado em ${consultadoEm})`);
  } else {
    consultadoEm = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    console.log(`Consultando ${URL_LISTA_ATUAL} …`);
    resposta = await buscarLista();
  }

  const r = montarFotos(resposta, consultadoEm);
  if (!r.ok) {
    console.error("Foto RECUSADA — nada foi gravado:");
    for (const e of r.erros) console.error(`  - ${e}`);
    process.exit(2);
  }
  const { mandato2031, mandato2027 } = r.fotos;
  const contagem = new Map<string, number>();
  for (const s of mandato2031.senadores)
    contagem.set(s.partido, (contagem.get(s.partido) ?? 0) + 1);
  console.log(`  versão do dado       : ${mandato2031.versao_dataset}`);
  console.log(`  mandato até 2031     : ${mandato2031.senadores.length}`);
  console.log(`  mandato até 2027     : ${mandato2027.senadores.length}`);
  console.log(
    `  partidos (2031)      : ${[...contagem.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([p, n]) => `${p} ${n}`)
      .join(", ")}`,
  );
  if (cli.seco) {
    console.log("  --seco: nada gravado");
    return;
  }
  for (const alvo of gravarFotos(r.fotos, cli.saida))
    console.log(`  gravado              : ${alvo}`);
}

// Só executa quando invocado como script. Sem esta guarda, `import` num teste
// dispararia uma consulta à API do Senado.
const invocadoComoScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (invocadoComoScript) {
  main().catch((err) => {
    console.error("Falha em senado-mandatos-snapshot:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
