/**
 * lib/edge-config/keys.ts
 *
 * **Ponto único** de construção e validação de nomes de chave do Vercel
 * Global Config (ex-Edge Config). Nada no repositório deve montar uma chave
 * por concatenação ad hoc — quem precisa de uma chave chama uma das funções
 * daqui, e quem precisa de uma chave nova acrescenta uma função aqui.
 *
 * ## Por que este módulo existe
 *
 * A doc da Vercel (`/docs/global-config/global-config-limits`, seção
 * "Maximum item key name length", atualizada em 2026-07-29) é literal:
 *
 *   > Each key name in your Global Config can be up to 256 characters long.
 *   > The key name must adhere to the regex pattern `^[\w-]+$`, which is
 *   > equivalent to `/^[A-Za-z0-9_-]+$/`, and allows A-Z, a-z, 0-9, `_`,
 *   > and `-`.
 *
 * **Dois-pontos não está na lista.** O esquema adotado pelo ADR-0012 em S05
 * usava `:` como separador (`projection:current:pres:t1`,
 * `projection:uf:SP:pres:t1`, `projection:archive:pres:t1`). Se a API aplicar
 * o padrão documentado, NENHUMA dessas escritas jamais funcionou — e a
 * descoberta chegaria na noite da apuração, com a gravação recusada e a
 * projeção congelada.
 *
 * **VERIFICADO EMPIRICAMENTE em 2026-09-12** (`pnpm edge-config:smoke`, passo
 * (f), com token de escrita real): a API **RECUSA** `:`. Uma chave
 * `smoke-...:SP:pres:t1` volta `400 validation_error` — *"Key may contain
 * alphanumeric letters, \"_\" and \"-\" only."*
 *
 * Ou seja: o esquema original do ADR-0012, com `:`, **nunca teria funcionado**
 * — nenhuma projeção jamais seria gravada, em nenhum ambiente. A troca para
 * `-` não foi conservadorismo; era a única forma correta.
 *
 * O comentário anterior aqui dizia que não era possível verificar (sem token,
 * CLI deslogada, suíte toda mockada) e que, diante de caminho crítico não
 * testável, a escolha era o padrão documentado. A decisão estava certa e agora
 * está medida.
 *
 * ## O esquema
 *
 * Separador `-` no lugar de `:`, arity idêntica, semântica idêntica:
 *
 * ```
 *   projection-current-<cargo>-t<turno>      projection-current-pres-t1
 *   projection-uf-<SIGLA>-<cargo>-t<turno>   projection-uf-SP-pres-t1
 *   projection-archive-<cargo>-t<turno>      projection-archive-pres-t1
 *   projection-current                       (alias dinâmico legado, S04)
 *   projection-uf-<SIGLA>                    (alias legado por UF, S04)
 *   interruptor-projecao-dep                 (interruptor da projeção de Deputado Federal, spec 026)
 *   interruptor-projecao-est                 (interruptor das assembleias — cargos 7 E 8, spec 027)
 * ```
 *
 * A **decisão de fundo do ADR-0012 permanece intacta**: chaves nomeadas por
 * corrida e turno, em vez de uma chave única. Muda o separador, não o
 * esquema — cada corrida segue independente, a transição de turno segue sem
 * destruir o archive, e os aliases legados seguem existindo.
 *
 * Sigla de UF em MAIÚSCULA continua válida: o padrão documentado admite
 * explicitamente `A-Z`, então `projection-uf-SP-pres-t1` casa. Isso está
 * coberto por teste em `tests/unit/edge-config/keys.test.ts` — o resto do
 * esquema depende disso e não pode depender de leitura de olho.
 *
 * ## A trava
 *
 * `assertValidGlobalConfigKey` é chamada por TODOS os construtores daqui e
 * também no primitivo de escrita (`writeEdgePayload`, `lib/edge-config/
 * writer.ts`). Uma chave fora do padrão não chega à API da Vercel: ela morre
 * com uma exceção que diz qual caractere ofendeu e qual é o padrão.
 */

import type { Cargo, Turno } from "@/lib/config/calendar";
import type { CargoProporcional } from "@/lib/config/cargos";

// ---------------------------------------------------------------------------
// O padrão documentado
// ---------------------------------------------------------------------------

/**
 * Padrão de nome de chave aceito pelo Global Config, transcrito da doc:
 * `^[\w-]+$` "which is equivalent to `/^[A-Za-z0-9_-]+$/`".
 *
 * Escrito na forma expandida (e não `\w`) de propósito: em JS `\w` é
 * exatamente `[A-Za-z0-9_]` sem flag `u`, mas a forma explícita é a que a
 * própria doc usa para desambiguar, e é a que alguém consegue conferir
 * contra a doc sem precisar lembrar de regra de escape.
 */
export const GLOBAL_CONFIG_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** "Each key name in your Global Config can be up to 256 characters long." */
export const GLOBAL_CONFIG_KEY_MAX_LENGTH = 256;

/** `true` se `key` casa com o padrão documentado E cabe no limite de 256. */
export function isValidGlobalConfigKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= GLOBAL_CONFIG_KEY_MAX_LENGTH &&
    GLOBAL_CONFIG_KEY_PATTERN.test(key)
  );
}

/**
 * Valida `key` contra o padrão documentado; devolve a própria chave para
 * permitir uso inline (`return assertValidGlobalConfigKey(...)`).
 *
 * A mensagem é escrita para ser lida por quem acabou de introduzir a chave
 * errada — diz o que veio, qual caractere ofendeu, qual é o padrão, e de
 * onde o padrão vem. Uma exceção genérica ("invalid key") custaria uma
 * sessão de investigação no pior momento possível.
 *
 * @param key      Nome da chave a validar.
 * @param context  Rótulo opcional de quem construiu a chave, para o log
 *                 apontar a origem (ex. `"writeEdgePayload"`).
 * @throws Error quando a chave viola o padrão ou o limite de comprimento.
 */
export function assertValidGlobalConfigKey(key: string, context?: string): string {
  if (isValidGlobalConfigKey(key)) return key;

  const where = context ? ` (origem: ${context})` : "";

  if (key.length === 0) {
    throw new Error(`chave de Global Config inválida${where}: string vazia.`);
  }

  if (key.length > GLOBAL_CONFIG_KEY_MAX_LENGTH) {
    throw new Error(
      `chave de Global Config inválida${where}: ${key.length} caracteres, ` +
        `máximo ${GLOBAL_CONFIG_KEY_MAX_LENGTH} ` +
        `(doc Vercel /docs/global-config/global-config-limits § "Maximum item key name length"). ` +
        `Chave: ${key.slice(0, 80)}...`,
    );
  }

  const offenders = [...new Set(key.split("").filter((c) => !/[A-Za-z0-9_-]/.test(c)))];
  const colonHint = offenders.includes(":")
    ? ` O separador ":" NÃO é aceito pelo Global Config — use "-" ` +
      `(ver lib/edge-config/keys.ts e a nota de emenda do ADR-0012).`
    : "";

  throw new Error(
    `chave de Global Config inválida${where}: "${key}" contém ` +
      `${offenders.map((c) => `"${c}"`).join(", ")}. ` +
      `O padrão documentado é ${GLOBAL_CONFIG_KEY_PATTERN.source} — só A-Z, a-z, 0-9, "_" e "-" ` +
      `(doc Vercel /docs/global-config/global-config-limits § "Maximum item key name length").` +
      colonHint,
  );
}

// ---------------------------------------------------------------------------
// Componentes de chave
// ---------------------------------------------------------------------------

/**
 * Siglas de UF entram na chave literalmente. Uma sigla vinda de fora
 * (payload do orchestrator Python, query string) pode carregar qualquer
 * coisa, e é o único componente das nossas chaves que não é literal de
 * código — logo, é por onde uma chave inválida entraria. Validamos o
 * formato aqui em vez de deixar o `assert` genérico reclamar depois: o erro
 * fica muito mais informativo apontando "sigla", não "chave".
 */
const UF_SIGLA_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Normaliza e valida a sigla. Maiúscula é a forma canônica (`SP`, não `sp`)
 * — o padrão do Global Config aceita `A-Z`, então a caixa alta é segura e
 * é a que o repositório já usa em `EdgeUfRow.sigla`.
 *
 * @throws Error se a sigla não for exatamente 2 letras.
 */
function normaliseSigla(sigla: string, context: string): string {
  if (!UF_SIGLA_PATTERN.test(sigla)) {
    throw new Error(
      `sigla de UF inválida (origem: ${context}): "${sigla}". ` +
        `Esperado exatamente 2 letras (ex. "SP"). ` +
        `A sigla entra literalmente no nome da chave do Global Config, ` +
        `que precisa casar com ${GLOBAL_CONFIG_KEY_PATTERN.source}.`,
    );
  }
  return sigla.toUpperCase();
}

// ---------------------------------------------------------------------------
// Construtores canônicos — esquema atual (separador "-")
// ---------------------------------------------------------------------------

/**
 * Chave nacional da corrida ativa: `projection-current-<cargo>-t<turno>`.
 * Ex.: `projection-current-pres-t1`.
 */
export function currentProjectionKey(cargo: Cargo, turno: Turno): string {
  return assertValidGlobalConfigKey(
    `projection-current-${cargo}-t${turno}`,
    "currentProjectionKey",
  );
}

/**
 * Chave de drill-down por UF: `projection-uf-<SIGLA>-<cargo>-t<turno>`.
 * Ex.: `projection-uf-SP-pres-t1`.
 */
export function ufProjectionKey(sigla: string, cargo: Cargo, turno: Turno): string {
  const uf = normaliseSigla(sigla, "ufProjectionKey");
  return assertValidGlobalConfigKey(`projection-uf-${uf}-${cargo}-t${turno}`, "ufProjectionKey");
}

/**
 * Chave do snapshot congelado de um turno encerrado:
 * `projection-archive-<cargo>-t<turno>`. Ex.: `projection-archive-pres-t1`.
 */
export function archiveProjectionKey(cargo: Cargo, turno: Turno): string {
  return assertValidGlobalConfigKey(
    `projection-archive-${cargo}-t${turno}`,
    "archiveProjectionKey",
  );
}

/**
 * Alias dinâmico legado (S04): aponta para a corrida ativa resolvida por
 * `lib/config/calendar.ts`. Já casava com o padrão documentado antes desta
 * mudança — não tinha dois-pontos.
 */
export const LEGACY_CURRENT_ALIAS_KEY = "projection-current";

/** Alias legado por UF (S04): `projection-uf-<SIGLA>`. */
export function legacyUfAliasKey(sigla: string): string {
  const uf = normaliseSigla(sigla, "legacyUfAliasKey");
  return assertValidGlobalConfigKey(`projection-uf-${uf}`, "legacyUfAliasKey");
}

// ---------------------------------------------------------------------------
// Interruptor da projeção de Deputado Federal — spec 026 RF-265 (ADR-0063 D4)
// ---------------------------------------------------------------------------

/**
 * Nome da chave do interruptor (design 026 § 2.10). Constante, e não
 * construída a partir de cargo: cada interruptor tem o seu NOME escrito aqui,
 * por extenso — não um parâmetro que abra a porta para uma chave que ninguém
 * lê. Desde 2026-09-29 são DOIS (ver {@link INTERRUPTOR_PROJECAO_EST_KEY}).
 */
export const INTERRUPTOR_PROJECAO_DEP_KEY = "interruptor-projecao-dep";

/**
 * Interruptor da projeção das **assembleias** — Deputado Estadual (7) E
 * Deputado Distrital (8), uma chave só para os dois (spec 027 RF-287,
 * ADR-0066). Decisão do dono: a projeção das casas estaduais liga e desliga
 * junto, e separada da federal — ligar a federal não liga as assembleias.
 *
 * Mesma regra da chave do federal: falha fechada nos dois sentidos, AUSENTE =
 * desligada. Escrita por `pnpm dep:projecao --cargo estadual`
 * (`scripts/interruptor-projecao.ts`). O modelo Python lê a MESMA string.
 */
export const INTERRUPTOR_PROJECAO_EST_KEY = "interruptor-projecao-est";

/**
 * Chave do interruptor da projeção de Deputado Federal:
 * `interruptor-projecao-dep`. Valor: `InterruptorProjecaoDep`
 * (`lib/edge-config/types.ts`).
 *
 * 🔴 **Por que uma chave e não uma variável de ambiente.** Na Vercel, variável
 * de ambiente só chega a um deployment NOVO — mudá-la não muda nada no que já
 * está no ar. Na noite da eleição o deploy fica congelado das 16h às 05h, e o
 * interruptor tem de mexer sem deploy. Uma chave do Global Config é lida a
 * cada ciclo do modelo e a cada render.
 *
 * Escrita só por `pnpm dep:projecao` (`scripts/interruptor-projecao.ts`), que
 * confirma o store e recusa o de ensaio. Leitura: `readInterruptorProjecao`
 * (`lib/edge-config/reader.ts`) no TypeScript; o modelo Python lê a MESMA
 * string — mudar o nome aqui exige mudar lá.
 *
 * Falha fechada nos dois sentidos (ADR-0063 D4): chave AUSENTE = desligada.
 * Enquanto ninguém gravar `{ligada: true}` (passo da virada, 03/10), a
 * projeção não aparece.
 */
export function interruptorProjecaoDepKey(): string {
  return assertValidGlobalConfigKey(INTERRUPTOR_PROJECAO_DEP_KEY, "interruptorProjecaoDepKey");
}

/** Chave do interruptor das assembleias: `interruptor-projecao-est` (cargos 7 e 8). */
export function interruptorProjecaoEstKey(): string {
  return assertValidGlobalConfigKey(INTERRUPTOR_PROJECAO_EST_KEY, "interruptorProjecaoEstKey");
}

/**
 * A chave do interruptor que governa a projeção deste cargo proporcional:
 * 6 → `interruptor-projecao-dep`; 7 e 8 → `interruptor-projecao-est`.
 *
 * O `cargo` é obrigatório e o `switch` não tem `default` que escolha: um cargo
 * proporcional novo sem interruptor decidido é erro de compilação (`never`) e,
 * se escapar por um `as`, lança — nunca cai na chave do federal. É o conversor
 * de cargo com default silencioso que este repositório já pagou três vezes; a
 * versão dele aqui ligaria a projeção das assembleias pelo interruptor federal.
 */
export function interruptorProjecaoKey(cargo: CargoProporcional): string {
  switch (cargo) {
    case 6:
      return interruptorProjecaoDepKey();
    case 7:
    case 8:
      return interruptorProjecaoEstKey();
    default: {
      const naoCoberto: never = cargo;
      throw new Error(`[keys] cargo sem interruptor de projeção: ${String(naoCoberto)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Esquema DEPRECADO com dois-pontos — só leitura, com prazo de remoção
// ---------------------------------------------------------------------------

/**
 * **Data de remoção: 2026-10-26** (dia seguinte ao 2º turno, 25/10/2026).
 *
 * Tudo nesta seção existe por uma única razão: se a API da Vercel na verdade
 * TOLERA dois-pontos, então existe dado publicado sob o esquema antigo, e o
 * read path não pode ficar cego para ele durante a migração. É uma leitura
 * a mais **só no caminho de miss** — quando a chave nova já respondeu, nada
 * disto é chamado.
 *
 * Passado o 2º turno, apagar: esta seção inteira, os candidatos deprecados
 * em `lib/edge-config/reader.ts`, e os testes correspondentes em
 * `tests/unit/edge-config/keys.test.ts`. Se ficar, vira dívida permanente —
 * uma leitura extra por miss e um esquema fantasma que ninguém escreve.
 */
export const DEPRECATED_COLON_KEYS_REMOVAL_DATE = "2026-10-26";

/** DEPRECADO — remover em {@link DEPRECATED_COLON_KEYS_REMOVAL_DATE}. */
export function deprecatedColonCurrentProjectionKey(cargo: Cargo, turno: Turno): string {
  return `projection:current:${cargo}:t${turno}`;
}

/** DEPRECADO — remover em {@link DEPRECATED_COLON_KEYS_REMOVAL_DATE}. */
export function deprecatedColonUfProjectionKey(sigla: string, cargo: Cargo, turno: Turno): string {
  return `projection:uf:${normaliseSigla(sigla, "deprecatedColonUfProjectionKey")}:${cargo}:t${turno}`;
}

/** DEPRECADO — remover em {@link DEPRECATED_COLON_KEYS_REMOVAL_DATE}. */
export function deprecatedColonArchiveProjectionKey(cargo: Cargo, turno: Turno): string {
  return `projection:archive:${cargo}:t${turno}`;
}

/** DEPRECADO — remover em {@link DEPRECATED_COLON_KEYS_REMOVAL_DATE}. */
export const DEPRECATED_COLON_CURRENT_ALIAS_KEY = "projection:current";

/** DEPRECADO — remover em {@link DEPRECATED_COLON_KEYS_REMOVAL_DATE}. */
export function deprecatedColonLegacyUfAliasKey(sigla: string): string {
  return `projection:uf:${normaliseSigla(sigla, "deprecatedColonLegacyUfAliasKey")}`;
}
