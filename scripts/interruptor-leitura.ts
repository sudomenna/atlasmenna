/**
 * scripts/interruptor-leitura.ts — `pnpm leitura:interruptor`
 *
 * Liga, desliga e mostra o **interruptor da leitura da noite** (ADR-0072): a
 * chave `interruptor-leitura-noite` do Global Config, lida a cada ciclo do
 * cron `/api/internal/leitura-noite` e a cada render da home presidencial.
 *
 * 🔴 Falha fechada: chave AUSENTE = tudo DESLIGADO. Cada parte só liga com
 * `true` gravado (`interpretarInterruptorLeitura`, `lib/leitura/interruptor.ts`).
 *
 * ```
 *   pnpm leitura:interruptor                                  # mostra o estado (não grava)
 *   pnpm leitura:interruptor --noticias on --historico on     # mostra o que FARIA (não grava)
 *   pnpm leitura:interruptor --noticias on --historico on --confirmar ecfg_…   # grava
 *   pnpm leitura:interruptor --ia on --confirmar ecfg_…
 *   pnpm leitura:interruptor --ia off --confirmar ecfg_…      # o freio da IA
 *   pnpm leitura:interruptor --modelo anthropic/claude-sonnet-5.5 --confirmar ecfg_…
 *   pnpm leitura:interruptor --modelo padrao --confirmar ecfg_…   # volta ao modelo do código
 *   ... --por "plantao-noite"                                 # quem mexeu (auditoria)
 * ```
 *
 * **Mescla com o valor atual**: flag omitida mantém o que está gravado. Ligar a
 * IA não religa notícias desligadas, e vice-versa.
 *
 * Mesmas travas de `scripts/interruptor-projecao.ts` (`pnpm dep:projecao`), de
 * onde vêm `classificarStore`, `idDoStoreLido`, `carregarEnvDoInterruptor` e
 * `STORES_CONHECIDOS`:
 *   1. mostra o id E o nome do store alvo, lido da API da Vercel;
 *   2. RECUSA o store de ensaio (por id conhecido e por nome) — aqui sem
 *      exceção: não há ensaio da leitura num store que o site não lê;
 *   3. não grava sem `--confirmar <id>` DIGITADO, igual ao id mostrado;
 *   4. relê a chave depois de gravar e confere.
 *
 * Alvo: o store do `EDGE_CONFIG` (a string de LEITURA — a que o site usa).
 * Ambiente por lista branca (`EDGE_CONFIG`, `EDGE_CONFIG_TOKEN`,
 * `VERCEL_TEAM_ID`); nada de banco. O token nunca é impresso.
 *
 * Códigos de saída: 0 ok/simulação · 1 API da Vercel falhou · 2 falta
 * `EDGE_CONFIG`/`EDGE_CONFIG_TOKEN` · 3 store recusado ou id digitado errado ·
 * 64 uso errado.
 */

import { fileURLToPath } from "node:url";

import { interruptorLeituraNoiteKey } from "@/lib/edge-config/keys";
import { vercelApiUrl } from "@/lib/edge-config/writer";
import { interpretarInterruptorLeitura, MODELO_SLUG_PATTERN } from "@/lib/leitura/interruptor";
import { INTERRUPTOR_DESLIGADO, type InterruptorLeitura } from "@/lib/leitura/types";

import {
  carregarEnvDoInterruptor,
  classificarStore,
  idDoStoreLido,
  type PapelStore,
  STORES_CONHECIDOS,
} from "./interruptor-projecao";

// ---------------------------------------------------------------------------
// Argumentos (puro)
// ---------------------------------------------------------------------------

export interface MudancasLeitura {
  ia?: boolean;
  noticias?: boolean;
  historico?: boolean;
  /** Slug novo; `null` = remover (volta ao `MODELO_PADRAO` do código). */
  modelo?: string | null;
}

export interface ArgsLeitura {
  mudancas: MudancasLeitura;
  confirmar?: string;
  por?: string;
}

function onOff(flag: string, bruto: string | undefined): boolean | { erro: string } {
  const v = bruto?.trim().toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  return { erro: `${flag} precisa de on ou off (recebido: ${bruto ?? "nada"})` };
}

export function interpretarArgsLeitura(argv: readonly string[]): ArgsLeitura | { erro: string } {
  const args: ArgsLeitura = { mudancas: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const [nome, valorInline] = a.includes("=") ? a.split(/=(.*)/s, 2) : [a, undefined];
    const valor = () => valorInline ?? argv[++i];
    switch (nome) {
      case "--ia":
      case "--noticias":
      case "--historico": {
        const r = onOff(nome, valor());
        if (typeof r !== "boolean") return r;
        const campo = nome.slice(2) as "ia" | "noticias" | "historico";
        args.mudancas[campo] = r;
        break;
      }
      case "--modelo": {
        const bruto = valor()?.trim();
        if (bruto === "padrao" || bruto === "padrão") {
          args.mudancas.modelo = null;
          break;
        }
        if (!bruto || !MODELO_SLUG_PATTERN.test(bruto)) {
          return {
            erro:
              `--modelo precisa de um slug "provedor/modelo" do AI Gateway, ex. ` +
              `anthropic/claude-sonnet-5.5 (recebido: ${bruto ?? "nada"}); ` +
              "ou --modelo padrao para voltar ao modelo do código.",
          };
        }
        args.mudancas.modelo = bruto;
        break;
      }
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
  return args;
}

export function temMudancas(m: MudancasLeitura): boolean {
  return (
    m.ia !== undefined ||
    m.noticias !== undefined ||
    m.historico !== undefined ||
    m.modelo !== undefined
  );
}

/**
 * O valor a gravar: o atual (já interpretado) com as mudanças por cima. Flag
 * omitida mantém o valor atual; `modelo: null` remove o slug.
 */
export function mesclarInterruptor(
  atual: InterruptorLeitura,
  mudancas: MudancasLeitura,
  agoraIso: string,
  por?: string,
): InterruptorLeitura {
  const valor: InterruptorLeitura = {
    ia: mudancas.ia ?? atual.ia,
    noticias: mudancas.noticias ?? atual.noticias,
    historico: mudancas.historico ?? atual.historico,
  };
  const modelo = mudancas.modelo === undefined ? atual.modelo : (mudancas.modelo ?? undefined);
  if (modelo) valor.modelo = modelo;
  valor.em = agoraIso;
  valor.por = por ?? "pnpm leitura:interruptor";
  return valor;
}

export function descreverInterruptor(v: InterruptorLeitura): string {
  const s = (b: boolean) => (b ? "LIGADO" : "desligado");
  const quem = v.em ? ` · desde ${v.em}${v.por ? ` por ${v.por}` : ""}` : "";
  return (
    `ia ${s(v.ia)} · noticias ${s(v.noticias)} · historico ${s(v.historico)} · ` +
    `modelo ${v.modelo ?? "padrão do código"}${quem}`
  );
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface DependenciasLeitura {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  agora: () => Date;
  escrever: (linha: string) => void;
}

type LeituraChave = { valor: InterruptorLeitura; ausente: boolean } | { erroHttp: string };

async function lerChave(
  deps: DependenciasLeitura,
  id: string,
  token: string,
  chave: string,
): Promise<LeituraChave> {
  let res: Response;
  try {
    res = await deps.fetch(vercelApiUrl(`/v1/edge-config/${id}/item/${chave}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { erroHttp: `rede: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Chave inexistente: a API responde 204 sem corpo (medido em 03/10) ou 404.
  if (res.status === 404 || res.status === 204) {
    return { valor: { ...INTERRUPTOR_DESLIGADO }, ausente: true };
  }
  if (!res.ok) return { erroHttp: `HTTP ${res.status}` };
  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    return { erroHttp: "resposta que não é JSON" };
  }
  // `GET .../item/<key>` devolve o ITEM (`{ key, value, ... }`), não o valor.
  const bruto = (corpo as { value?: unknown } | null)?.value;
  if (bruto === undefined) return { valor: { ...INTERRUPTOR_DESLIGADO }, ausente: true };
  return { valor: interpretarInterruptorLeitura(bruto), ausente: false };
}

export async function executar(deps: DependenciasLeitura): Promise<number> {
  const out = deps.escrever;
  const args = interpretarArgsLeitura(deps.argv);
  if ("erro" in args) {
    out(`✖ ${args.erro}`);
    out(
      "Uso: pnpm leitura:interruptor [--ia on|off] [--noticias on|off] [--historico on|off] " +
        "[--modelo <provedor/modelo>|padrao] [--por R] [--confirmar <id do store>]",
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

  const chave = interruptorLeituraNoiteKey();
  const papel = classificarStore(id, slug);
  const rotulo: Record<PapelStore, string> = {
    producao: "PRODUÇÃO — o store que o site público lê",
    ensaio: "ENSAIO — o site público NÃO lê este store",
    desconhecido: "DESCONHECIDO — não é nenhum dos stores registrados no runbook",
  };
  out(`Store alvo: ${id} (${slug ?? "sem nome"}) — ${rotulo[papel]}`);
  out(`Chave: ${chave} — leitura da noite da home (IA, notícias, histórico)`);

  if (papel === "ensaio") {
    out(
      "✖ RECUSADO: este é o store de ENSAIO. Ligar aqui não liga nada no site. " +
        "Aponte o EDGE_CONFIG para o store de produção.",
    );
    return 3;
  }
  if (papel === "desconhecido") {
    const conhecidos = Object.keys(STORES_CONHECIDOS).join(", ");
    out(`⚠ store fora da lista conhecida (${conhecidos}) — confira o id antes de confirmar.`);
  }

  const atual = await lerChave(deps, id, token, chave);
  if ("erroHttp" in atual) {
    out(`✖ não consegui ler a chave ${chave}: ${atual.erroHttp}`);
    return 1;
  }
  out(
    `Estado atual: ${descreverInterruptor(atual.valor)}${
      atual.ausente ? " — chave AUSENTE ⇒ tudo desligado" : ""
    }`,
  );
  if (!temMudancas(args.mudancas)) {
    if (args.confirmar !== undefined) out("Nenhuma flag de mudança — nada a gravar.");
    return 0;
  }

  const valor = mesclarInterruptor(
    atual.valor,
    args.mudancas,
    deps.agora().toISOString(),
    args.por,
  );
  out(`Valor a gravar: ${JSON.stringify(valor)}`);
  if (args.confirmar === undefined) {
    out(`Nada gravado. Para gravar ${chave} em ${id}, repita com --confirmar ${id}`);
    return 0;
  }
  if (args.confirmar !== id) {
    out(
      `✖ o id digitado (${args.confirmar}) não é o do alvo (${id}). Nada foi gravado — ` +
        "confira se o EDGE_CONFIG aponta para o store que você quer.",
    );
    return 3;
  }

  try {
    const res = await deps.fetch(vercelApiUrl(`/v1/edge-config/${id}/items`), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ operation: "upsert", key: chave, value: valor }] }),
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

  const depois = await lerChave(deps, id, token, chave);
  if (
    "erroHttp" in depois ||
    depois.ausente ||
    depois.valor.ia !== valor.ia ||
    depois.valor.noticias !== valor.noticias ||
    depois.valor.historico !== valor.historico ||
    depois.valor.modelo !== valor.modelo
  ) {
    out(
      `✖ gravei, mas a releitura não confere: ${
        "erroHttp" in depois ? depois.erroHttp : descreverInterruptor(depois.valor)
      }. Rode \`pnpm leitura:interruptor\` de novo para ver o estado.`,
    );
    return 1;
  }
  out(`✔ Gravado e conferido em ${chave} (${id}): ${descreverInterruptor(depois.valor)}`);
  out(
    "O cron lê a chave a cada minuto: IA e notícias mudam no próximo ciclo; a home " +
      "reflete em até ~60 s (cache das páginas e do CDN).",
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
    process.stderr.write(
      `[leitura:interruptor] ${erro instanceof Error ? erro.message : String(erro)}\n`,
    );
    process.exit(1);
  });
}
