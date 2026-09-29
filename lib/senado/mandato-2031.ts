/**
 * lib/senado/mandato-2031.ts — a foto dos senadores em exercício: os 27 com
 * mandato até 2031 (e, para a visão de renovação, os 54 que ocupam hoje as
 * vagas em disputa). Spec 023, RF-215; ADR-0062 item 1; design 023 § D2.
 *
 * Em 2026 o Senado renova 54 das 81 cadeiras. As outras 27 são de quem foi
 * escolhido em 2022 e fica até 2031 — elas não estão na apuração e o TSE não
 * as publica. Para o hemiciclo de 81 cadeiras (RF-216) mostrar como o Senado
 * fica em 2027, o produto precisa saber de que partido é cada uma. A fonte é o
 * Senado Federal (Dados Abertos), numa foto datada e versionada em
 * `editorial/senado/mandato-2031.json`, tirada por
 * `data-pipeline/senado-mandatos-snapshot.ts` (`pnpm senado:snapshot`).
 *
 * ## O partido é o de quem ocupa a cadeira HOJE
 *
 * Decisão do dono (29/09): suplente em exercício conta pelo partido dele, não
 * pelo do titular. A tela diz isso em nota. E a foto envelhece — troca de
 * partido, suplente que assume depois dela —, por isso a data aparece na tela.
 *
 * ## "S/Partido" — senador sem partido hoje
 *
 * O Senado publica `"S/Partido"` para quem se desfiliou (Romário, RJ, saiu do
 * PL em 09/09/2026). Pela regra do dono — partido ATUAL, literalmente — a
 * cadeira NÃO é do PL, e também não é "Outros": ela aparece em cinza cheio com
 * o rótulo "Sem partido" (decisão do orquestrador, 29/09). {@link SEM_PARTIDO}
 * é a única sigla aceita fora da paleta, e só nesta grafia exata.
 *
 * ## 🔴 A sigla é a do TSE
 *
 * A paleta (`KNOWN_PARTY_SLUGS`, `lib/utils/party-color.ts`) conhece as siglas do
 * TSE. Na foto de 29/09 o Senado usa as mesmas (inclusive "PODE"); se um dia
 * publicar outra grafia, a invariante 2 reprova e a correspondência entra NO
 * SCRIPT DE FOTO — **este módulo recusa, não conserta**: uma tabela escondida
 * aqui mudaria a cor de uma cadeira sem ninguém ver (ADR-0062: invariantes
 * "nunca ajustados em silêncio").
 *
 * ## Invariantes (por arquivo)
 *
 *   1. exatamente `porUf` entradas por UF, nas 27 UFs do país (`REGIAO_DA_UF`)
 *      — 27 no arquivo de 2031, 54 no de 2027;
 *   2. todo `partido` normaliza para um partido da paleta
 *      (`normalizePartySlug(partido) !== "outros"`) ou é exatamente
 *      {@link SEM_PARTIDO};
 *   3. a última legislatura de todo mandato é a do arquivo (58 para 2031, 57
 *      para 2027);
 *   4. `codigo_mandato` não se repete;
 *   5. forma de cada campo, por LISTA BRANCA: campo fora dela reprova — nome
 *      civil, nascimento, contato e bloco não entram (constituição § 5).
 *
 * ## 🔴 Recusa em execução, nunca exceção
 *
 * Os validadores devolvem o erro; não lançam. Um `throw` no carregamento
 * derrubaria `/senador` inteira (constituição § 3 — degradar, não quebrar). Na
 * tela a recusa vira "hemiciclo não desenhado" + log (RF-217). A garantia DURA
 * é o teste `tests/unit/lib/senado-mandato-2031.test.ts`, que reprova o PR se o
 * arquivo versionado violar qualquer invariante — é lá que um erro de foto é
 * pego, antes de chegar a alguém.
 */

import dados2031 from "@/editorial/senado/mandato-2031.json" with { type: "json" };
import { REGIAO_DA_UF } from "@/lib/config/regioes";
import { TZ } from "@/lib/utils/format";
import { normalizePartySlug, PARTY_FALLBACK_SLUG } from "@/lib/utils/party-color";

export type ParticipacaoSenado = "Titular" | "Suplente em exercício";

/** A grafia exata com que o Senado publica o senador sem partido. */
export const SEM_PARTIDO = "S/Partido";

export interface SenadorEmExercicio {
  /** Sigla da UF, 2 letras maiúsculas. */
  uf: string;
  /** Código do parlamentar no Senado (Dados Abertos). Texto: é identificador. */
  codigo: string;
  nome_parlamentar: string;
  /**
   * Partido ATUAL de quem ocupa a cadeira, na grafia do TSE — ou exatamente
   * {@link SEM_PARTIDO}.
   */
  partido: string;
  participacao: ParticipacaoSenado;
  /** Nome parlamentar do titular, quando a cadeira está com o suplente. */
  titular_do_mandato?: string;
  /** Legislaturas do mandato (57 e 58 para quem vai até 2031). */
  legislaturas: number[];
  /** Código do mandato no Senado. Único entre as 81 cadeiras. */
  codigo_mandato: string;
}

export interface FotoSenado {
  fonte: string;
  fonte_url: string;
  /** Instante da consulta, ISO 8601. Vai para a tela como DD/MM/AAAA. */
  consultado_em: string;
  /** `Metadados.Versao` da resposta do Senado — a versão do dado, não da consulta. */
  versao_dataset: string;
  senadores: SenadorEmExercicio[];
}

/** Nomes do domínio desta spec. */
export type SenadorMandato2031 = SenadorEmExercicio;
export type Mandato2031 = FotoSenado;

export type ValidacaoFotoSenado =
  | { ok: true; mandato: FotoSenado }
  | { ok: false; erros: string[] };
export type ValidacaoMandato2031 = ValidacaoFotoSenado;

/** As 27 UFs, em ordem de sigla. */
export const UFS_DO_SENADO: readonly string[] = Object.keys(REGIAO_DA_UF).sort();

/** O que distingue os dois arquivos de foto. */
export interface RegraFoto {
  /** Cadeiras por UF no arquivo: 1 (mandato até 2031) ou 2 (até 2027). */
  porUf: number;
  /** Última legislatura de todo mandato do arquivo: 58 (2031) ou 57 (2027). */
  ultimaLegislatura: number;
}

export const REGRA_MANDATO_2031: RegraFoto = { porUf: 1, ultimaLegislatura: 58 };
export const REGRA_MANDATO_2027: RegraFoto = { porUf: 2, ultimaLegislatura: 57 };

const PARTICIPACOES: readonly ParticipacaoSenado[] = ["Titular", "Suplente em exercício"];

const CAMPOS_RAIZ = new Set(["fonte", "fonte_url", "consultado_em", "versao_dataset", "senadores"]);
const CAMPOS_SENADOR = new Set([
  "uf",
  "codigo",
  "nome_parlamentar",
  "partido",
  "participacao",
  "titular_do_mandato",
  "legislaturas",
  "codigo_mandato",
]);

function textoNaoVazio(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function dataIsoValida(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
}

/** `true` quando a sigla é aceita: da paleta, ou exatamente {@link SEM_PARTIDO}. */
export function partidoAceito(partido: string): boolean {
  return partido === SEM_PARTIDO || normalizePartySlug(partido) !== PARTY_FALLBACK_SLUG;
}

/**
 * Valida uma foto do Senado sob uma {@link RegraFoto}. Pura: não lê arquivo,
 * não loga, não lança. Devolve TODOS os erros de uma vez — quem conserta a
 * foto precisa da lista inteira, não do primeiro.
 */
export function validarFotoSenado(bruto: unknown, regra: RegraFoto): ValidacaoFotoSenado {
  const erros: string[] = [];
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return { ok: false, erros: ["a foto não é um objeto"] };
  }
  const raiz = bruto as Record<string, unknown>;

  for (const campo of Object.keys(raiz)) {
    if (!CAMPOS_RAIZ.has(campo)) erros.push(`campo fora da lista branca na raiz: "${campo}"`);
  }
  if (!textoNaoVazio(raiz.fonte)) erros.push("`fonte` ausente");
  if (!textoNaoVazio(raiz.fonte_url) || !/^https:\/\//.test(raiz.fonte_url as string)) {
    erros.push("`fonte_url` ausente ou não é https");
  }
  if (!dataIsoValida(raiz.consultado_em)) erros.push("`consultado_em` não é data ISO válida");
  if (!textoNaoVazio(raiz.versao_dataset)) erros.push("`versao_dataset` ausente");

  const lista = raiz.senadores;
  if (!Array.isArray(lista)) {
    erros.push("`senadores` não é lista");
    return { ok: false, erros };
  }

  const porUf = new Map<string, number>();
  const mandatos = new Map<string, number>();
  lista.forEach((s: unknown, i: number) => {
    const onde = `senadores[${i}]`;
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      erros.push(`${onde} não é objeto`);
      return;
    }
    const sen = s as Record<string, unknown>;
    for (const campo of Object.keys(sen)) {
      if (!CAMPOS_SENADOR.has(campo)) erros.push(`${onde}: campo fora da lista branca "${campo}"`);
    }
    const uf = sen.uf;
    if (typeof uf !== "string" || !(uf in REGIAO_DA_UF)) {
      erros.push(`${onde}: UF inválida (${JSON.stringify(uf)})`);
    } else {
      porUf.set(uf, (porUf.get(uf) ?? 0) + 1);
    }
    if (!textoNaoVazio(sen.codigo)) erros.push(`${onde}: \`codigo\` ausente (texto)`);
    if (!textoNaoVazio(sen.codigo_mandato)) {
      erros.push(`${onde}: \`codigo_mandato\` ausente (texto)`);
    } else {
      mandatos.set(sen.codigo_mandato, (mandatos.get(sen.codigo_mandato) ?? 0) + 1);
    }
    if (!textoNaoVazio(sen.nome_parlamentar)) erros.push(`${onde}: \`nome_parlamentar\` ausente`);
    if (!textoNaoVazio(sen.partido)) {
      erros.push(`${onde}: \`partido\` ausente`);
    } else if (!partidoAceito(sen.partido)) {
      erros.push(
        `${onde} (${String(uf)}): partido "${sen.partido}" não é conhecido da paleta nem é ` +
          `"${SEM_PARTIDO}" — use a sigla do TSE`,
      );
    }
    if (!PARTICIPACOES.includes(sen.participacao as ParticipacaoSenado)) {
      erros.push(
        `${onde}: \`participacao\` fora do vocabulário (${JSON.stringify(sen.participacao)})`,
      );
    }
    if (sen.participacao === "Suplente em exercício" && !textoNaoVazio(sen.titular_do_mandato)) {
      erros.push(`${onde}: suplente sem \`titular_do_mandato\``);
    }
    if (sen.participacao === "Titular" && sen.titular_do_mandato !== undefined) {
      erros.push(`${onde}: titular com \`titular_do_mandato\``);
    }
    const leg = sen.legislaturas;
    if (
      !Array.isArray(leg) ||
      leg.length === 0 ||
      !leg.every((l) => Number.isInteger(l) && (l as number) > 0)
    ) {
      erros.push(`${onde}: \`legislaturas\` não é lista de inteiros`);
    } else if (leg[leg.length - 1] !== regra.ultimaLegislatura) {
      erros.push(
        `${onde} (${String(uf)}): mandato termina na legislatura ${String(leg[leg.length - 1])}, ` +
          `não na ${regra.ultimaLegislatura}`,
      );
    }
  });

  for (const uf of UFS_DO_SENADO) {
    const n = porUf.get(uf) ?? 0;
    if (n !== regra.porUf) erros.push(`UF ${uf} aparece ${n} vez(es) — devem ser ${regra.porUf}`);
  }
  const esperado = UFS_DO_SENADO.length * regra.porUf;
  if (lista.length !== esperado) {
    erros.push(`a foto tem ${lista.length} entradas — devem ser ${esperado}`);
  }
  for (const [codigo, n] of mandatos) {
    if (n > 1) erros.push(`codigo_mandato ${codigo} repetido ${n} vezes`);
  }

  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, mandato: raiz as unknown as FotoSenado };
}

/** Os 27 com mandato até 2031: um por UF, legislatura final 58. */
export function validarMandato2031(bruto: unknown): ValidacaoMandato2031 {
  return validarFotoSenado(bruto, REGRA_MANDATO_2031);
}

/** Os 54 que ocupam hoje as vagas em disputa: dois por UF, legislatura final 57. */
export function validarMandato2027(bruto: unknown): ValidacaoFotoSenado {
  return validarFotoSenado(bruto, REGRA_MANDATO_2027);
}

/**
 * A foto versionada de `editorial/senado/mandato-2031.json`, já validada. Um
 * arquivo inválido NÃO lança — vira `{ ok: false }` e o hemiciclo não é
 * desenhado (ver o cabeçalho).
 */
export const MANDATO_2031: ValidacaoMandato2031 = validarMandato2031(dados2031);

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * A data da foto como a tela a escreve — DD/MM/AAAA no fuso do projeto
 * (`America/Sao_Paulo`). Fuso fixo: a mesma foto dá a mesma data em qualquer
 * servidor (constituição § 6). A foto de 29/09 foi tirada às 04h47 UTC — 01h47
 * em Brasília —, e é 29/09 nos dois.
 */
export function dataDaFoto(foto: Pick<FotoSenado, "consultado_em">): string {
  return FORMATO_DATA.format(new Date(foto.consultado_em));
}
