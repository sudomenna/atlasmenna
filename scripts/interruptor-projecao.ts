/**
 * scripts/interruptor-projecao.ts — `pnpm dep:projecao`
 *
 * Liga, desliga e mostra o **interruptor da projeção de Deputado Federal**
 * (spec 026 RF-265, [ADR-0063](../docs/architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)
 * D4): a chave `interruptor-projecao-dep` do Global Config, lida a cada ciclo
 * do modelo e a cada render das telas.
 *
 * 🔴 **Falha fechada nos dois sentidos**: chave AUSENTE = DESLIGADA. A
 * projeção só aparece depois que alguém grava `{ligada: true}` — o passo da
 * virada de 03/10 (`pnpm dep:projecao --ligar --confirmar <id do store>`).
 *
 * ```
 *   pnpm dep:projecao                              # mostra o estado (não grava)
 *   pnpm dep:projecao --desligar                   # mostra o que FARIA (não grava)
 *   pnpm dep:projecao --desligar --confirmar ecfg_…     # grava (o id DIGITADO)
 *   pnpm dep:projecao --ligar --confirmar ecfg_…
 *   pnpm dep:projecao --pct 40 --confirmar ecfg_…       # SOBE a trava para 40% (25–100)
 *   pnpm dep:projecao --ligar --sem-pct --confirmar ecfg_…  # volta à trava do modelo (25%)
 *   pnpm dep:projecao --ensaio --desligar --confirmar ecfg_…  # SÓ no store de ensaio
 *   ... --por "plantao-noite"                      # quem mexeu (auditoria; nunca publicado)
 * ```
 *
 * ---------------------------------------------------------------------------
 * 🔴 Por que o script existe, em vez de editar a chave no painel da Vercel
 * ---------------------------------------------------------------------------
 *
 * O risco do interruptor não é o clique — é o **store errado**. Até a véspera
 * há dois stores com o mesmo formato (`docs/operations/runbook.md`, § "Estado
 * aplicado em 22/09"): o que o site LÊ (`salacofre-edge-config`) e o de
 * ENSAIO do simulado (`salacofre-edge-config-preview`), para onde o `.env.local`
 * aponta até o passo 0.5 da véspera. Desligar a projeção no store de ensaio às
 * 21h de 04/10 não desliga nada — e o operador acharia que desligou.
 *
 * Por isso o script:
 *   1. mostra o id E o nome (slug) do store alvo, lido da API da Vercel;
 *   2. **recusa o store de ensaio** (por id conhecido e por nome), salvo com
 *      `--ensaio` — que então SÓ aceita o de ensaio (o ensaio de 03/10);
 *   3. não grava sem a confirmação DIGITADA do id: `--confirmar <id>` tem de
 *      ser exatamente o id que ele mostrou (design 026 § 2.10: "pede
 *      confirmação digitada"). Sem ela, mostra o valor que gravaria;
 *   4. relê a chave depois de gravar e confere.
 *
 * O alvo é o store do `EDGE_CONFIG` (a string de LEITURA — é ela que o site
 * usa), e **nunca** o `EDGE_CONFIG_ID`: esse desvia só a escrita do modelo, e
 * durante o simulado aponta justamente para o ensaio.
 *
 * ---------------------------------------------------------------------------
 * Ambiente — lista BRANCA, nunca o `.env.local` inteiro
 * ---------------------------------------------------------------------------
 *
 * Mesmo molde de `scripts/_vigia-env.ts`: do `.env.local` só entram
 * `EDGE_CONFIG`, `EDGE_CONFIG_TOKEN` e `VERCEL_TEAM_ID`. O `DATABASE_URL` de
 * produção nunca é carregado — este script não toca banco. O ambiente real
 * vence o arquivo (`EDGE_CONFIG=... pnpm dep:projecao` aponta outro store).
 * O token nunca é impresso.
 *
 * ---------------------------------------------------------------------------
 * Códigos de saída
 * ---------------------------------------------------------------------------
 *   0  — estado mostrado, ou gravado e conferido, ou simulação sem `--confirmar <id>`
 *   1  — a API da Vercel falhou (ler o store, ler a chave, gravar ou conferir)
 *   2  — falta `EDGE_CONFIG` ou `EDGE_CONFIG_TOKEN`
 *   3  — store RECUSADO (ensaio sem `--ensaio`, ou outro com `--ensaio`), ou o id
 *        digitado em `--confirmar` não é o do alvo
 *   64 — uso errado (flags incompatíveis)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { interruptorProjecaoDepKey } from "@/lib/edge-config/keys";
import {
  type InterruptorProjecaoLido,
  interpretarInterruptor,
  TRAVA_PROJECAO_DEP_PCT,
} from "@/lib/edge-config/reader";
import type { InterruptorProjecaoDep } from "@/lib/edge-config/types";
import { vercelApiUrl } from "@/lib/edge-config/writer";

import { selecionarEnvDoVigia } from "./_vigia-env";

// ---------------------------------------------------------------------------
// Stores conhecidos
// ---------------------------------------------------------------------------

export type PapelStore = "producao" | "ensaio" | "desconhecido";

/**
 * Os dois stores do time, medidos em 22/09 (`vercel global-config list`,
 * runbook § "Estado aplicado em 22/09"). Os ids não são segredo — são o
 * nome do recurso, não a credencial.
 */
export const STORES_CONHECIDOS: Readonly<Record<string, { papel: PapelStore; slug: string }>> = {
  ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl: { papel: "producao", slug: "salacofre-edge-config" },
  ecfg_fdlfvusqgth3gc8eaxloahrvrsgh: { papel: "ensaio", slug: "salacofre-edge-config-preview" },
};

/** Nome de store que indica ensaio/preview — segunda trava, além do id. */
const SLUG_DE_ENSAIO = /(preview|ensaio|staging)/i;

/**
 * O papel do store. Qualquer sinal de ensaio vence: um id de produção com nome
 * de preview é contradição, e na dúvida o script recusa.
 */
export function classificarStore(id: string, slug: string | null): PapelStore {
  const conhecido = STORES_CONHECIDOS[id];
  if (conhecido?.papel === "ensaio") return "ensaio";
  if (slug !== null && SLUG_DE_ENSAIO.test(slug)) return "ensaio";
  if (conhecido?.papel === "producao") return "producao";
  return "desconhecido";
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

export interface ArgsInterruptor {
  acao: "status" | "ligar" | "desligar" | "ajustar";
  /** `--pct N` — trava em % apurado; só SOBE (25–100). */
  pct?: number;
  /** `--sem-pct` — remove o `pct_minimo` (volta à trava do modelo). */
  semPct: boolean;
  /** `--confirmar <id>` — o id do store, DIGITADO. Só grava se for o do alvo. */
  confirmar?: string;
  /** `--ensaio` (ou `--store-ensaio`) — o alvo TEM de ser o store de ensaio. */
  ensaio: boolean;
  por?: string;
}

export function interpretarArgs(argv: readonly string[]): ArgsInterruptor | { erro: string } {
  const args: ArgsInterruptor = {
    acao: "status",
    semPct: false,
    ensaio: false,
  };
  let ligar = false;
  let desligar = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const [nome, valorInline] = a.includes("=") ? a.split(/=(.*)/s, 2) : [a, undefined];
    const valor = () => valorInline ?? argv[++i];
    switch (nome) {
      case "--ligar":
        ligar = true;
        break;
      case "--desligar":
        desligar = true;
        break;
      case "--confirmar": {
        const bruto = valor();
        if (!bruto || !/^ecfg_[A-Za-z0-9]+$/.test(bruto)) {
          return {
            erro:
              "--confirmar precisa do id do store, digitado (ex.: --confirmar ecfg_…). " +
              "Rode sem ele primeiro: o script mostra o id do alvo.",
          };
        }
        args.confirmar = bruto;
        break;
      }
      case "--ensaio":
      case "--store-ensaio":
        args.ensaio = true;
        break;
      case "--sem-pct":
        args.semPct = true;
        break;
      case "--pct": {
        const bruto = valor();
        const n = Number(bruto);
        if (
          bruto === undefined ||
          bruto === "" ||
          !Number.isFinite(n) ||
          n < TRAVA_PROJECAO_DEP_PCT ||
          n > 100
        ) {
          return {
            erro:
              `--pct precisa de um número entre ${TRAVA_PROJECAO_DEP_PCT} e 100 (recebido: ` +
              `${bruto ?? "nada"}). O interruptor só SOBE a trava; o piso de ` +
              `${TRAVA_PROJECAO_DEP_PCT}% só muda por ADR (ADR-0063).`,
          };
        }
        args.pct = n;
        break;
      }
      case "--por": {
        const bruto = valor();
        if (!bruto) return { erro: "--por precisa de um rótulo (ex.: --por plantao-noite)" };
        args.por = bruto;
        break;
      }
      default:
        return { erro: `flag desconhecida: ${a}` };
    }
  }

  if (ligar && desligar) return { erro: "--ligar e --desligar juntos não fazem sentido" };
  if (args.pct !== undefined && args.semPct) return { erro: "--pct e --sem-pct juntos" };
  if (desligar && (args.pct !== undefined || args.semPct)) {
    return { erro: "--pct/--sem-pct só com --ligar ou sozinhos; --desligar preserva a trava" };
  }
  if (ligar) args.acao = "ligar";
  else if (desligar) args.acao = "desligar";
  else if (args.pct !== undefined || args.semPct) args.acao = "ajustar";
  return args;
}

/**
 * O valor a gravar. `atual` é a leitura interpretada da chave.
 *
 * `ajustar` (só `--pct`/`--sem-pct`) mantém o `ligada` que está valendo —
 * inclusive o DESLIGADO da chave ausente — e por isso recusa quando o estado
 * atual não é confiável (`falha`/`invalida`): "manter" um
 * desligado-por-falha gravaria uma decisão que ninguém tomou.
 */
export function montarValor(
  atual: InterruptorProjecaoLido,
  args: ArgsInterruptor,
  agoraIso: string,
): InterruptorProjecaoDep | { erro: string } {
  let ligada: boolean;
  if (args.acao === "ligar") ligada = true;
  else if (args.acao === "desligar") ligada = false;
  else if (atual.origem === "chave" || atual.origem === "ausente") ligada = atual.ligada;
  else {
    return {
      erro:
        `o estado atual da chave não é confiável (${atual.origem}); diga explicitamente ` +
        "--ligar ou --desligar junto com --pct",
    };
  }

  const valor: InterruptorProjecaoDep = { ligada };
  // Só carrega adiante uma trava SUBIDA; 25 é a do modelo e não precisa ser gravada.
  const pctAnterior =
    atual.origem === "chave" && atual.pct_minimo > TRAVA_PROJECAO_DEP_PCT
      ? atual.pct_minimo
      : undefined;
  const pct = args.semPct ? undefined : (args.pct ?? pctAnterior);
  if (pct !== undefined) valor.pct_minimo = pct;
  valor.em = agoraIso;
  valor.por = args.por ?? "pnpm dep:projecao";
  return valor;
}

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

/** As ÚNICAS variáveis que este script lê. Nenhuma toca banco. */
export const ENV_DO_INTERRUPTOR = ["EDGE_CONFIG", "EDGE_CONFIG_TOKEN", "VERCEL_TEAM_ID"] as const;

/** Lê `.env.local` pela lista branca; o ambiente real vence. Arquivo ausente é silencioso. */
export function carregarEnvDoInterruptor(cwd: string = process.cwd()): void {
  let bruto: string;
  try {
    bruto = readFileSync(resolve(cwd, ".env.local"), "utf8");
  } catch {
    return;
  }
  const selecionado = selecionarEnvDoVigia(bruto, process.env, ENV_DO_INTERRUPTOR);
  for (const chave of ENV_DO_INTERRUPTOR) {
    const valor = selecionado[chave];
    if (valor && !process.env[chave]) process.env[chave] = valor;
  }
}

/** O id do store que o SITE lê — o do `EDGE_CONFIG`, nunca o `EDGE_CONFIG_ID`. */
export function idDoStoreLido(edgeConfig: string | undefined): string | null {
  if (!edgeConfig) return null;
  return edgeConfig.match(/ecfg_[A-Za-z0-9]+/)?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** O que a chave diz, para o operador: a leitura interpretada + a auditoria. */
interface LeituraDaChave {
  lido: InterruptorProjecaoLido;
  em?: string;
  por?: string;
}

export interface Dependencias {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  agora: () => Date;
  escrever: (linha: string) => void;
}

function descreverEstado({ lido: l, em, por }: LeituraDaChave): string {
  const estado = l.ligada ? "LIGADA" : "DESLIGADA";
  const porque: Record<InterruptorProjecaoLido["origem"], string> = {
    chave: "gravada na chave",
    ausente: "chave AUSENTE ⇒ desligada (falha fechada; a virada grava --ligar)",
    falha: "a leitura FALHOU ⇒ desligada (falha fechada)",
    invalida: "valor INVÁLIDO na chave ⇒ desligada (falha fechada)",
  };
  const trava =
    l.pct_minimo > TRAVA_PROJECAO_DEP_PCT
      ? ` · trava SUBIDA para ${l.pct_minimo}% apurado`
      : ` · trava do modelo (${TRAVA_PROJECAO_DEP_PCT}%)`;
  const ignorado = l.pct_minimo_ignorado
    ? " · pct_minimo da chave IGNORADO (< 25 ou inválido)"
    : "";
  const quem = em ? ` · desde ${em}${por ? ` por ${por}` : ""}` : "";
  return `${estado}${trava}${ignorado} — ${porque[l.origem]}${quem}`;
}

async function lerChave(
  deps: Dependencias,
  id: string,
  token: string,
): Promise<LeituraDaChave | { erroHttp: string }> {
  const url = vercelApiUrl(`/v1/edge-config/${id}/item/${interruptorProjecaoDepKey()}`);
  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { erroHttp: `rede: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status === 404) return { lido: interpretarInterruptor({ estado: "ausente" }) };
  if (!res.ok) return { erroHttp: `HTTP ${res.status}` };
  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    return { erroHttp: "resposta que não é JSON" };
  }
  // `GET .../item/<key>` devolve o ITEM (`{ key, value, ... }`), não o valor.
  const valor = (corpo as { value?: unknown } | null)?.value;
  const lido = interpretarInterruptor(
    valor === undefined ? { estado: "ausente" } : { estado: "ok", valor },
  );
  const bruto = (typeof valor === "object" && valor !== null ? valor : {}) as {
    em?: unknown;
    por?: unknown;
  };
  return {
    lido,
    ...(typeof bruto.em === "string" ? { em: bruto.em } : {}),
    ...(typeof bruto.por === "string" ? { por: bruto.por } : {}),
  };
}

/** Roda o comando e devolve o código de saída. Sem `process.exit` aqui — testável. */
export async function executar(deps: Dependencias): Promise<number> {
  const out = deps.escrever;
  const args = interpretarArgs(deps.argv);
  if ("erro" in args) {
    out(`✖ ${args.erro}`);
    out(
      "Uso: pnpm dep:projecao [--ligar|--desligar] [--pct N|--sem-pct] [--por R] " +
        "[--confirmar <id do store>] [--ensaio]",
    );
    return 64;
  }

  const id = idDoStoreLido(deps.env.EDGE_CONFIG);
  const token = deps.env.EDGE_CONFIG_TOKEN;
  if (!id || !token) {
    out(
      `✖ falta ${!id ? "EDGE_CONFIG (a string de leitura do store)" : "EDGE_CONFIG_TOKEN"} — ` +
        "no .env.local ou no ambiente.",
    );
    return 2;
  }

  // 1. Qual store é este — pelo nome que a própria Vercel dá a ele.
  let slug: string | null = null;
  try {
    const res = await deps.fetch(vercelApiUrl(`/v1/edge-config/${id}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      out(`✖ não consegui ler o store ${id} (HTTP ${res.status}). Nada foi gravado.`);
      return 1;
    }
    const meta = (await res.json()) as { slug?: unknown };
    slug = typeof meta.slug === "string" ? meta.slug : null;
  } catch (e) {
    out(`✖ não consegui ler o store ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const papel = classificarStore(id, slug);
  const rotulo: Record<PapelStore, string> = {
    producao: "PRODUÇÃO — o store que o site público lê",
    ensaio: "ENSAIO — o site público NÃO lê este store",
    desconhecido: "DESCONHECIDO — não é nenhum dos dois stores registrados no runbook",
  };
  out(`Store alvo: ${id} (${slug ?? "sem nome"}) — ${rotulo[papel]}`);

  // 2. A trava do store errado — vale também para só LER: um "está ligada"
  //    lido no store de ensaio é a mesma mentira que um desligar gravado lá.
  if (args.ensaio && papel !== "ensaio") {
    out("✖ --ensaio pedido, mas o alvo não é o store de ensaio. Nada foi feito.");
    return 3;
  }
  if (!args.ensaio && papel === "ensaio") {
    out(
      "✖ RECUSADO: este é o store de ENSAIO. Desligar aqui não desliga o site. " +
        "Aponte o EDGE_CONFIG para o store de produção (passo 0.5 da véspera) — " +
        "ou use --ensaio se o ensaio é de propósito.",
    );
    return 3;
  }
  if (papel === "desconhecido") {
    out("⚠ store fora da lista conhecida — confira o id acima antes de confirmar.");
  }

  // 3. O estado atual.
  const atual = await lerChave(deps, id, token);
  if ("erroHttp" in atual) {
    out(`✖ não consegui ler a chave ${interruptorProjecaoDepKey()}: ${atual.erroHttp}`);
    return 1;
  }
  out(`Estado atual: ${descreverEstado(atual)}`);
  if (args.acao === "status") return 0;

  // 4. O valor novo.
  const valor = montarValor(atual.lido, args, deps.agora().toISOString());
  if ("erro" in valor) {
    out(`✖ ${valor.erro}`);
    return 64;
  }
  out(`Valor a gravar: ${JSON.stringify(valor)}`);
  if (args.confirmar === undefined) {
    out(`Nada gravado. Para gravar em ${id}, repita com --confirmar ${id}`);
    return 0;
  }
  if (args.confirmar !== id) {
    out(
      `✖ o id digitado (${args.confirmar}) não é o do alvo (${id}). Nada foi gravado — ` +
        "confira se o EDGE_CONFIG aponta para o store que você quer.",
    );
    return 3;
  }

  // 5. Grava.
  try {
    const res = await deps.fetch(vercelApiUrl(`/v1/edge-config/${id}/items`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: interruptorProjecaoDepKey(), value: valor }],
      }),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      out(`✖ a gravação falhou (HTTP ${res.status}): ${corpo.slice(0, 300)}`);
      return 1;
    }
  } catch (e) {
    out(`✖ a gravação falhou: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  // 6. Relê e confere.
  const depois = await lerChave(deps, id, token);
  if (
    "erroHttp" in depois ||
    depois.lido.origem !== "chave" ||
    depois.lido.ligada !== valor.ligada ||
    depois.lido.pct_minimo !== (valor.pct_minimo ?? TRAVA_PROJECAO_DEP_PCT)
  ) {
    out(
      `✖ gravei, mas a releitura não confere: ${
        "erroHttp" in depois ? depois.erroHttp : descreverEstado(depois)
      }. Rode \`pnpm dep:projecao\` de novo para ver o estado.`,
    );
    return 1;
  }
  out(`✔ Gravado e conferido: ${descreverEstado(depois)}`);
  out(
    valor.ligada
      ? "LIGAR é lento: a projeção só aparece quando o modelo rodar o próximo ciclo de " +
          "Deputado (volta completa de 30 min) com a trava aberta."
      : "DESLIGAR é rápido: a tela deixa de mostrar a projeção em até ~60 s (cache das " +
          "páginas e do CDN) — confira na página.",
  );
  return 0;
}

async function main(): Promise<void> {
  carregarEnvDoInterruptor();
  const codigo = await executar({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    agora: () => new Date(),
    escrever: (linha) => process.stdout.write(`${linha}\n`),
  });
  process.exit(codigo);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((erro: unknown) => {
    process.stderr.write(`[dep:projecao] ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  });
}
