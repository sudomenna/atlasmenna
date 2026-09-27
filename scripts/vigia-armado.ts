/**
 * scripts/vigia-armado.ts
 *
 * **Vigia de CONFIGURAÇÃO** — confere, de fora da Vercel, que o ambiente que
 * o cron realmente invoca está armado para o que vem a seguir.
 *
 * Uso:
 *   pnpm vigia:armado --modo simulado
 *   pnpm vigia:armado --modo dia-d
 *
 * ---------------------------------------------------------------------------
 * 🔴 O incidente que este script existe para não repetir — 2026-09-22
 * ---------------------------------------------------------------------------
 *
 * A janela de simulado de 22/09 (9h–17h BRT) passou **inteira** sem que uma
 * única requisição nossa saísse para o TSE. A causa não foi o TSE, não foi
 * rede, não foi código: foi endereço.
 *
 * Toda a configuração do simulado — `TSE_BASE_URL`, `TSE_COD_ELEICAO_FEDERAL`,
 * `TSE_COD_ELEICAO_ESTADUAL`, `INGEST_WINDOW=9-17`, `CRON_ENABLED` — estava
 * cadastrada no ambiente **Preview**. E o Vercel Cron **só invoca o deployment
 * de produção**:
 *
 *   "To trigger a cron job, Vercel makes an HTTP GET request to your project's
 *    production deployment URL"  — vercel.com/docs/cron-jobs, lido em 22/09.
 *
 * Os 19 crons dispararam o dia todo, contra produção, que não tinha nenhuma
 * dessas variáveis. Entre 9h e 17h a produção usou o default de
 * `INGEST_WINDOW` (`"17-04"`, `lib/tse/ingest-window.ts:49`) e respondeu
 * `{skipped:"out_of_window"}` — registrado em `logDebug`, o nível mais baixo
 * do arquivo, isto é, invisível. Depois das 17h entrou na janela e passou a
 * quebrar a cada ~30 s com "Nem TSE_COD_ELEICAO_FEDERAL nem TSE_COD_ELEICAO
 * estão definidas", `"env":"production"` — e isso acontecia **todas as
 * noites**, sem ninguém ver.
 *
 * ---------------------------------------------------------------------------
 * Por que um vigia SEPARADO do `vigia:ciclo`
 * ---------------------------------------------------------------------------
 *
 * `vigia:ciclo` responde "o boletim andou?". É a pergunta certa, e ele estava
 * certo o tempo todo — só não teve chance de perguntar dentro da janela
 * (a tarefa agendada é cron LOCAL e o Mac dormiu das 22h35 de 21/09 às 17h14
 * de 22/09, 21h39 sem uma única corrida).
 *
 * Este script responde outra: **"a máquina está apontada para o lugar certo
 * ANTES de a janela abrir?"**. É a única das duas que pode ser respondida na
 * véspera, quando ainda dá tempo de consertar. Um vigia que só sabe dizer
 * "não andou" depois que a janela fechou chega sempre tarde demais.
 *
 * ---------------------------------------------------------------------------
 * O que dá e o que NÃO dá para conferir
 * ---------------------------------------------------------------------------
 *
 * `vercel env ls production --json` devolve os valores **criptografados**
 * (`type: "encrypted"`/`"sensitive"`). Então este script confere **presença e
 * ambiente**, nunca valor. É de propósito, e é suficiente: o defeito de 22/09
 * foi exatamente ausência — quatro variáveis que existiam só em `preview`.
 *
 * Conferir valor exigiria baixá-los para a máquina, e o `.env.local` deste
 * projeto já é uma armadilha conhecida (a primeira variável dele é o
 * `DATABASE_URL` de produção — ver `scripts/_vigia-env.ts`). Não vale o risco
 * para o ganho.
 *
 * ---------------------------------------------------------------------------
 * Três estados, como todo vigia deste projeto
 * ---------------------------------------------------------------------------
 *
 *   armado        → exit 0. Tudo que o modo exige está em production.
 *   desarmado     → exit 2. 🔴 Falta variável — o ciclo vai rodar em falso.
 *   indeterminado → exit 1. Não consegui olhar (CLI sem login, projeto não
 *                   linkado, rede). NUNCA sai com a mesma cara de "olhei e
 *                   está errado" — foi essa indistinção que custou dois dias
 *                   da janela de 15–17/09.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Núcleo puro — sem rede, sem env, sem processo. É o que os testes exercitam.
// ---------------------------------------------------------------------------

export type ModoVigia = "simulado" | "dia-d";

export type EstadoArmado = "armado" | "desarmado" | "indeterminado";

export interface VeredictoArmado {
  estado: EstadoArmado;
  exitCode: 0 | 1 | 2;
  /** Uma linha, escrita para leigo (CLAUDE.md § 0). */
  mensagem: string;
  faltando: string[];
  sobrando: string[];
}

/**
 * Uma variável como a API da Vercel a devolve. Só os três campos que
 * importam — o `value` vem criptografado e é deliberadamente ignorado.
 */
export interface EnvDaVercel {
  key: string;
  target?: string[] | string | null;
}

/**
 * O que cada modo EXIGE em `production`.
 *
 * ⚠️ `TSE_TARGETS_WHITELIST` não entra em nenhuma das listas: ele é lido
 * **apenas no ramo `preview`** de `lib/tse/targets.ts` (ver runbook,
 * "TSE_TARGETS_WHITELIST — inalterado (preview only)"). Exigi-lo em produção
 * daria uma falsa sensação de contenção de fan-out.
 */
export const EXIGIDAS: Record<ModoVigia, readonly string[]> = {
  // Simulado do TSE (janelas de setembro): produção precisa apontar para o
  // ambiente de teste, com os códigos de 2026 e a janela diurna.
  simulado: [
    "TSE_BASE_URL",
    "TSE_COD_ELEICAO_FEDERAL",
    "TSE_COD_ELEICAO_ESTADUAL",
    "INGEST_WINDOW",
    "CRON_SECRET",
    "MODEL_SECRET",
    "EDGE_CONFIG",
    "EDGE_CONFIG_TOKEN",
  ],
  // Noite de 04/10: os códigos continuam obrigatórios, mas o endereço e a
  // janela voltam ao default de produção — e por isso aparecem em PROIBIDAS.
  "dia-d": [
    "TSE_COD_ELEICAO_FEDERAL",
    "TSE_COD_ELEICAO_ESTADUAL",
    "CRON_SECRET",
    "MODEL_SECRET",
    "EDGE_CONFIG",
    "EDGE_CONFIG_TOKEN",
  ],
} as const;

/**
 * O que cada modo exige que NÃO exista em `production`.
 *
 * Esta metade é a que evita o erro simétrico: chegar em 04/10 com a produção
 * ainda apontada para o CDN de simulado e a janela diurna — isto é, o site
 * público servindo número de mentira na noite da eleição, e o ciclo mudo
 * das 17h em diante, que é justamente quando a apuração começa.
 */
export const PROIBIDAS: Record<ModoVigia, readonly string[]> = {
  simulado: [],
  "dia-d": [
    "TSE_BASE_URL",
    "INGEST_WINDOW",
    "INGEST_WINDOW_OVERRIDE",
    // 🔴 `EDGE_CONFIG_ID` desvia a ESCRITA do payload para outro store, sem
    // tocar na leitura (`EDGE_CONFIG`) — as duas variáveis são independentes
    // (`lib/edge-config/writer.ts:201-209` contra `reader.ts:252`).
    //
    // Isso é útil de propósito durante um simulado: dá para exercitar o ciclo
    // inteiro, inclusive a gravação, sem que um número de mentira apareça no
    // site público. E é catastrófico se sobrar: em 04/10 o site leria um store
    // que ninguém alimenta e mostraria "Aguardando o primeiro boletim" a noite
    // inteira — o modo de falha mais perigoso do produto, porque é
    // indistinguível da tela legítima de antes das 17h (`docs/reference/risks.md`).
    //
    // Produção hoje NÃO tem esta variável, e é assim que tem de chegar ao dia D:
    // sem ela, `resolveEdgeConfigId` extrai o id do próprio `EDGE_CONFIG`, e
    // escrita e leitura caem no mesmo store.
    "EDGE_CONFIG_ID",
    // Overrides globais de fan-out/taxa que só fazem sentido em janela
    // supervisionada. `TSE_GRANULARIDADE=uf` está documentado como quebrado no
    // modelo (runbook § variáveis de ambiente), e `TSE_CARGOS` deixado em `1,3`
    // faria Senador e Deputado nunca ingerirem na noite real.
    "TSE_GRANULARIDADE",
    "TSE_CARGOS",
    "TSE_MAX_RPS",
  ],
} as const;

function alvos(e: EnvDaVercel): string[] {
  if (Array.isArray(e.target)) return e.target;
  if (typeof e.target === "string") return [e.target];
  return [];
}

/**
 * avaliarArmado — decide o veredicto a partir da lista já coletada.
 *
 * `envs === null` significa "não consegui olhar", e isso é `indeterminado`
 * custe o que custar — nunca `desarmado`.
 */
export function avaliarArmado(
  modo: ModoVigia,
  envs: readonly EnvDaVercel[] | null,
): VeredictoArmado {
  if (envs === null) {
    return {
      estado: "indeterminado",
      exitCode: 1,
      faltando: [],
      sobrando: [],
      mensagem:
        "Não consegui olhar a configuração de produção na Vercel. Isto NÃO quer " +
        "dizer que está errada — quer dizer que o vigia está cego. Conferir se o " +
        "`vercel` CLI está logado (`vercel whoami`) e se a pasta está linkada ao projeto.",
    };
  }

  const emProducao = new Set(envs.filter((e) => alvos(e).includes("production")).map((e) => e.key));

  const faltando = EXIGIDAS[modo].filter((k) => !emProducao.has(k));
  const sobrando = PROIBIDAS[modo].filter((k) => emProducao.has(k));

  if (faltando.length === 0 && sobrando.length === 0) {
    return {
      estado: "armado",
      exitCode: 0,
      faltando: [],
      sobrando: [],
      mensagem:
        `Produção está armada para o modo "${modo}": as ${EXIGIDAS[modo].length} ` +
        "variáveis que o ciclo precisa estão lá, e nenhuma das que atrapalham.",
    };
  }

  const partes: string[] = [];
  if (faltando.length > 0) {
    partes.push(`FALTAM em produção: ${faltando.join(", ")}`);
  }
  if (sobrando.length > 0) {
    partes.push(`SOBRAM em produção (precisam sair): ${sobrando.join(", ")}`);
  }

  return {
    estado: "desarmado",
    exitCode: 2,
    faltando,
    sobrando,
    mensagem:
      `🔴 Produção NÃO está armada para o modo "${modo}". ${partes.join(" · ")}. ` +
      "O cron vai disparar mesmo assim e falhar em silêncio — foi exatamente " +
      "isso que custou a janela de simulado de 22/09.",
  };
}

// ---------------------------------------------------------------------------
// Casca de I/O — só roda quando o arquivo é executado como script.
// ---------------------------------------------------------------------------

function parseModo(args: string[]): ModoVigia | null {
  const i = args.indexOf("--modo");
  const bruto = i >= 0 ? args[i + 1] : undefined;
  if (bruto === "simulado" || bruto === "dia-d") return bruto;
  return null;
}

/** Lê a lista de env vars de produção. `null` = não deu para olhar. */
async function lerEnvsDeProducao(): Promise<EnvDaVercel[] | null> {
  try {
    const { stdout } = await execFileAsync("npx", ["vercel", "env", "ls", "production", "--json"], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    // A CLI mistura texto de progresso com o JSON em alguns caminhos; pegamos
    // do primeiro `{` em diante.
    const inicio = stdout.indexOf("{");
    if (inicio < 0) return null;
    const dados = JSON.parse(stdout.slice(inicio)) as { envs?: EnvDaVercel[] };
    return Array.isArray(dados.envs) ? dados.envs : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const modo = parseModo(process.argv.slice(2));
  if (modo === null) {
    console.error("Uso: pnpm vigia:armado --modo <simulado|dia-d>");
    process.exit(1);
    return;
  }

  const envs = await lerEnvsDeProducao();
  const v = avaliarArmado(modo, envs);

  console.log(
    JSON.stringify({
      vigia: "armado",
      modo,
      estado: v.estado,
      faltando: v.faltando,
      sobrando: v.sobrando,
      agora: new Date().toISOString(),
    }),
  );
  console.log(v.mensagem);
  process.exit(v.exitCode);
}

if (process.argv[1]?.includes("vigia-armado")) {
  void main();
}
