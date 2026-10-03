/**
 * scripts/vigia-ciclo.ts
 *
 * **Vigia externo** — confirma, de fora da Vercel, que um ciclo de ingestão
 * realmente rodou. Item 2 da sprint S08 (`docs/sprints/2026-S08-f7-enxergar.md`).
 *
 * Uso:
 *   pnpm vigia:ciclo
 *
 * 🔴 **NÃO** use `set -a; . ./.env.local; set +a` — era o uso documentado até
 * 2026-09-19 e põe o `DATABASE_URL` de PRODUÇÃO no ambiente. O script carrega
 * sozinho as duas variáveis de que precisa; ver `carregarEnvDoVigia` abaixo.
 *
 * ---------------------------------------------------------------------------
 * Por que um vigia de fora, se já existem 9 alarmes dentro
 * ---------------------------------------------------------------------------
 * **Todo alarme do projeto mora dentro do próprio ciclo.** Os 9 pontos de
 * `_alert_slack`/`notifySlack` só disparam a partir de código que roda **se o
 * cron for invocado**. Se a Vercel parar de invocar o cron, ou se a função
 * morrer antes do primeiro alerta, nada avisa — e o site segue servindo o
 * último payload, com cara de normalidade. É o modo de falha mais perigoso que
 * este produto tem, porque é silencioso e parece saúde.
 *
 * O `heartbeat` diurno de `vercel.ts:114-117` **não resolve isto**: ele aponta
 * para `/api/ingest`, isto é, para nós mesmos. Um vigia que mora dentro do
 * processo vigiado não é um vigia.
 *
 * Este script é feito para rodar num agendador **fora** da Vercel — hoje a
 * tarefa horária em `~/.claude/scheduled-tasks/vigia-tse-2026/`.
 *
 * ---------------------------------------------------------------------------
 * 🔴 Por que ele NÃO bate na porta do site
 * ---------------------------------------------------------------------------
 * Medido em 2026-09-18, contra produção:
 *
 *   GET https://atlasmenna.online/              → HTTP 200 (HTML)
 *   GET https://atlasmenna.online/api/projection → HTTP 403 {"error":"bot_detected"}
 *   GET https://atlasmenna.online/api/health     → HTTP 403 {"error":"bot_detected"}
 *
 * O Vercel BotID classifica qualquer cliente automatizado como robô, e **todas**
 * as rotas `/api/*` ficam fechadas para um vigia. É a mesma classe de defeito
 * que derrubou o primeiro ciclo manual de 17/09 (corrigido em `0bd95e0` para as
 * rotas de ingestão, que têm portão de autenticação próprio — as de leitura
 * continuam, corretamente, atrás do BotID).
 *
 * A página HTML responde, mas **só carrega a hora do boletim quando há
 * apuração**. Em fase pré-eleição não há carimbo nenhum no HTML, e
 * "não achei a hora" seria indistinguível de "o ciclo morreu" — exatamente a
 * confusão que este script existe para evitar.
 *
 * Por isso o vigia lê o **payload publicado na sua fonte** (o store do Global
 * Config), não pela porta do site. Bônus: se o app cair mas o store estiver
 * fresco, os dois sinais discordam — e essa discordância é informação.
 *
 * ---------------------------------------------------------------------------
 * Três estados, não dois — decisão do dono de 2026-09-14
 * ---------------------------------------------------------------------------
 * "Não começou", "não sabemos" e "apurando" são **três** estados distintos, e
 * o vigia não pode colapsá-los. Um vigia que grita em fase pré-eleição é um
 * vigia que ninguém lê em 04/10.
 *
 *   nao_comecou     → exit 0. Não há o que apurar; silêncio é o certo.
 *   fora_da_janela  → exit 0. O ciclo não deveria estar rodando agora.
 *   fresco          → exit 0. `dado_ts` dentro do limite.
 *   parado          → exit 2. 🔴 Dentro da janela e o boletim não anda.
 *   sem_payload     → exit 2. Dentro da janela e não há payload nenhum.
 *   indeterminado   → exit 1. Falta credencial — não dá para afirmar nada.
 *
 * 🔴 `indeterminado` é exit **1**, não 2, e a diferença importa: "não consegui
 * olhar" nunca pode sair com a mesma cara de "olhei e está parado". Foi
 * exatamente essa indistinção — um 403 permanente lido como "ainda não
 * publicado" — que custou dois dos três dias da janela de 15–17/09.
 *
 * ---------------------------------------------------------------------------
 * O relógio é o do boletim, não o do cálculo
 * ---------------------------------------------------------------------------
 * A frescura é medida por `dado_ts` (a hora que o TSE carimbou no boletim),
 * **nunca** por `ts` (a hora em que nós calculamos) — ADR-0038 D1. Um pipeline
 * que roda a cada minuto sobre um boletim congelado tem `ts` sempre novo e
 * `dado_ts` parado: é precisamente a falha que se quer pegar, e olhar `ts`
 * a esconderia.
 */

import { type ComFase, isPreEleicao } from "../lib/config/fase";
import {
  type IngestWindow,
  isWithinIngestWindow,
  parseIngestWindow,
} from "../lib/tse/ingest-window";
import { carregarEnvDoVigia } from "./_vigia-env";

// 🔴 Carga SELETIVA do `.env.local` — só `EDGE_CONFIG` e `INGEST_WINDOW`, que
// são as duas variáveis do vigia e nenhuma toca banco. O `DATABASE_URL` de
// PRODUÇÃO não entra no processo nem por acidente.
//
// A regra, o porquê e o incidente de 17/09 que a motivou estão em
// `scripts/_vigia-env.ts`. Módulo separado de propósito: esta chamada roda no
// topo, então importar ESTE arquivo num teste leria o `.env.local` real.
carregarEnvDoVigia();

// ---------------------------------------------------------------------------
// Núcleo puro — sem rede, sem env, sem relógio implícito. É o que os testes
// exercitam. A casca de I/O fica no fim do arquivo, atrás de `import.meta`.
// ---------------------------------------------------------------------------

/** Limite de silêncio antes de considerar o ciclo parado. */
export const LIMITE_SILENCIO_MIN_PADRAO = 15;

export type EstadoVigia =
  | "nao_comecou"
  | "fora_da_janela"
  | "fresco"
  | "parado"
  | "sem_payload"
  | "indeterminado";

export interface VeredictoVigia {
  estado: EstadoVigia;
  /** 0 = tudo certo · 2 = alarme · 1 = não deu para olhar. */
  exitCode: 0 | 1 | 2;
  /** Uma linha, escrita para leigo (CLAUDE.md § 0). */
  mensagem: string;
  /** Minutos desde o carimbo do boletim; `null` quando não há carimbo. */
  idadeMin: number | null;
}

/**
 * O mínimo do payload que o vigia precisa enxergar.
 *
 * Estende `ComFase` de propósito, em vez de redeclarar o campo de fase: o
 * literal da fase pré tem **quatro donos legítimos** no repositório e uma guarda
 * estrutural (RF-153, `tests/unit/config/fase.test.ts`) que varre `lib/`,
 * `data-pipeline/`, `scripts/` e `api/` por substring e reprova qualquer quinto.
 *
 * Este arquivo escreveu o literal à mão na primeira versão e **a guarda o pegou**
 * — inclusive dentro de um comentário, porque a varredura é textual. O conserto
 * é duplo: usar `isPreEleicao` para ler a fase, e batizar o estado do vigia de
 * `nao_comecou`, que é o vocabulário do dono ("não começou / não sabemos /
 * apurando", decisão de 14/09) e não colide com o campo do payload.
 */
export interface PayloadVigiado extends ComFase {
  dado_ts?: string | null;
}

export interface EntradaVigia {
  /** `null` = credencial ausente/erro de leitura. `undefined` = chave vazia. */
  payload: PayloadVigiado | null | undefined;
  /** Se a leitura foi possível. `false` ⇒ `indeterminado`, custe o que custar. */
  credencialOk: boolean;
  agora: Date;
  janela: IngestWindow;
  limiteMin?: number;
}

function minutosDesde(iso: string, agora: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (agora.getTime() - t) / 60_000;
}

/**
 * avaliarCiclo — decide o veredicto a partir de fatos já coletados.
 *
 * A ordem dos testes abaixo **não é arbitrária** e não deve ser reordenada sem
 * pensar: cada guarda anterior é o que torna a seguinte segura.
 *
 *   1. credencial  — sem ela não se afirma nada sobre o mundo.
 *   2. pré-eleição — antes de exigir frescura, saber se há o que apurar.
 *   3. janela      — antes de exigir frescura, saber se o ciclo deveria rodar.
 *   4. frescura    — só aqui a ausência de dado vira alarme.
 */
export function avaliarCiclo(e: EntradaVigia): VeredictoVigia {
  const limite = e.limiteMin ?? LIMITE_SILENCIO_MIN_PADRAO;

  if (!e.credencialOk) {
    return {
      estado: "indeterminado",
      exitCode: 1,
      idadeMin: null,
      mensagem:
        "Não consegui olhar: falta a credencial de leitura do payload publicado. " +
        "Isto NÃO quer dizer que o ciclo parou — quer dizer que o vigia está cego. " +
        "Conferir EDGE_CONFIG/EDGE_CONFIG_TOKEN no ambiente.",
    };
  }

  if (isPreEleicao(e.payload)) {
    return {
      estado: "nao_comecou",
      exitCode: 0,
      idadeMin: null,
      mensagem:
        "Fase pré-eleição: não há apuração para acontecer ainda, então não há " +
        "ciclo atrasado. Silêncio aqui é o comportamento certo.",
    };
  }

  const naJanela = isWithinIngestWindow(e.agora, e.janela);
  if (!naJanela) {
    return {
      estado: "fora_da_janela",
      exitCode: 0,
      idadeMin: e.payload?.dado_ts != null ? minutosDesde(e.payload.dado_ts, e.agora) : null,
      mensagem:
        `Fora da janela de ingestão (${e.janela.startHourBrt}h–${e.janela.endHourBrt}h): ` +
        "o ciclo não deveria estar rodando agora, então não há o que cobrar.",
    };
  }

  if (!e.payload) {
    return {
      estado: "sem_payload",
      exitCode: 2,
      idadeMin: null,
      mensagem:
        "🔴 Dentro da janela de ingestão e NÃO existe payload publicado. " +
        "Ou nenhum ciclo rodou desde o começo, ou o que foi publicado sumiu.",
    };
  }

  const carimbo = e.payload.dado_ts;
  if (carimbo == null) {
    return {
      estado: "parado",
      exitCode: 2,
      idadeMin: null,
      mensagem:
        "🔴 Dentro da janela e o payload publicado não tem hora de boletim do TSE. " +
        "A série não consegue desenhar ponto nenhum, e nada mais avisaria isso.",
    };
  }

  const idade = minutosDesde(carimbo, e.agora);
  if (idade == null) {
    return {
      estado: "parado",
      exitCode: 2,
      idadeMin: null,
      mensagem:
        `🔴 A hora do boletim publicada é ilegível (${carimbo}). ` +
        "Se o TSE mudou o formato da data, o parser precisa de conserto hoje.",
    };
  }

  if (idade > limite) {
    return {
      estado: "parado",
      exitCode: 2,
      idadeMin: idade,
      mensagem:
        `🔴 Série parada: o último boletim do TSE tem ${idade.toFixed(0)} minutos ` +
        `(limite ${limite}), e estamos dentro da janela de ingestão. ` +
        "O site continua no ar mostrando esse dado velho, sem avisar ninguém.",
    };
  }

  return {
    estado: "fresco",
    exitCode: 0,
    idadeMin: idade,
    mensagem:
      `Ciclo vivo: último boletim do TSE tem ${idade.toFixed(0)} minutos ` + `(limite ${limite}).`,
  };
}

// ---------------------------------------------------------------------------
// Casca de I/O — só roda quando o arquivo é executado como script.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const iLimite = args.indexOf("--limite-min");
  const limiteMin = iLimite >= 0 ? Number.parseInt(args[iLimite + 1] ?? "", 10) : undefined;
  if (limiteMin !== undefined && !Number.isFinite(limiteMin)) {
    console.error("--limite-min exige um número inteiro de minutos.");
    process.exit(1);
  }

  let janela: IngestWindow;
  try {
    janela = parseIngestWindow(process.env.INGEST_WINDOW);
  } catch (err) {
    console.error(`INGEST_WINDOW inválida: ${String(err)}`);
    process.exit(1);
    return;
  }

  let payload: PayloadVigiado | null | undefined;
  let credencialOk = true;
  try {
    // Import tardio: o módulo toca env na carga, e queremos o erro aqui
    // dentro do try, não na inicialização do processo.
    const { readNationalProjection } = await import("../lib/edge-config/reader");
    payload = (await readNationalProjection()) as PayloadVigiado | null;
    // `readProjection` devolve `null` tanto para "sem credencial" quanto para
    // "chave ausente". A distinção vem do ambiente, não do retorno.
    if (payload == null && !process.env.EDGE_CONFIG) credencialOk = false;
  } catch (err) {
    credencialOk = false;
    console.error(`[vigia] falha ao ler o payload publicado: ${String(err)}`);
  }

  const v = avaliarCiclo({
    payload,
    credencialOk,
    agora: new Date(),
    janela,
    limiteMin,
  });

  console.log(
    JSON.stringify({
      vigia: "ciclo",
      estado: v.estado,
      idade_min: v.idadeMin == null ? null : Number(v.idadeMin.toFixed(1)),
      janela: `${janela.startHourBrt}-${janela.endHourBrt}`,
      limite_min: limiteMin ?? LIMITE_SILENCIO_MIN_PADRAO,
      agora: new Date().toISOString(),
    }),
  );
  console.log(v.mensagem);
  process.exit(v.exitCode);
}

if (process.argv[1]?.includes("vigia-ciclo")) {
  void main();
}
