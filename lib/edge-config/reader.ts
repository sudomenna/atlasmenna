/**
 * lib/edge-config/reader.ts
 *
 * Reader de baixo nível do Edge Config para o read path.
 *
 * Lê via SDK oficial `@vercel/edge-config` quando a connection string
 * `EDGE_CONFIG` está configurada. Em dev/preview sem credencial, faz
 * fallback determinístico para um payload "vazio" — comportamento espelhado
 * do `writer.ts` (no-op + warn estruturado em vez de throw).
 *
 * Covers
 *   - RF-019, RF-020 (leitura da projeção via Edge Config) — read side.
 *   - ADR-0001 (Edge Config como único caminho de leitura no read path).
 *   - ADR-0012 (S05/F4c — chaves nomeadas + alias dinâmico), com a nota de
 *     emenda de 2026-09-08: separador `-` no lugar de `:`, porque o padrão
 *     documentado do Global Config (`^[A-Za-z0-9_-]+$`) não admite
 *     dois-pontos. Nenhuma chave é montada aqui — tudo vem de
 *     `lib/edge-config/keys.ts`.
 *
 * ## 2026-09-14 — "falhou" deixou de ser igual a "não existe"
 *
 * As quatro funções faziam `catch { return null }`. Falha de rede e chave não
 * publicada chegavam à tela como a mesma coisa, **sem alarme nenhum** — a
 * classe de defeito que este projeto nomeia como rede de segurança de mão
 * única. Agora {@link LeituraEdge} separa os dois, a falha emite `logError`, e
 * a tela continua tratando os dois iguais **de propósito** (ela não pode
 * afirmar uma causa que não mediu). Ver spec 019 § RNF-010.
 *
 * Não-objetivos
 *   - Cache HTTP (delegado ao SDK / CDN).
 *   - Polling SWR no cliente (vive em `app/api/projection/route.ts` consumido
 *     via `useSWR` no front).
 *   - **Segunda cópia do último payload conhecido.** Se o Global Config inteiro
 *     ficar inacessível, os números não são preservados — não há de onde. O
 *     que a tela faz é não inventar zeros no lugar deles.
 */

import { get } from "@vercel/edge-config";

import { type Cargo, currentPresidentialTurno, type Turno } from "@/lib/config/calendar";
import {
  type CargoProporcional,
  type CargoTokenProporcional,
  cargoToken,
  isCargoProporcional,
} from "@/lib/config/cargos";
import {
  archiveProjectionKey,
  currentProjectionKey,
  DEPRECATED_COLON_CURRENT_ALIAS_KEY,
  deprecatedColonArchiveProjectionKey,
  deprecatedColonCurrentProjectionKey,
  deprecatedColonLegacyUfAliasKey,
  deprecatedColonUfProjectionKey,
  interruptorProjecaoKey,
  LEGACY_CURRENT_ALIAS_KEY,
  legacyUfAliasKey,
  ufProjectionKey,
} from "@/lib/edge-config/keys";
import type { EdgePayload, EdgePayloadDeputado, EdgePayloadUf } from "@/lib/edge-config/types";
import { logError, logWarn } from "@/lib/tse/log";

/**
 * Os cargos cujo payload **é** um `EdgePayload` — isto é, os majoritários.
 *
 * Existe para tornar a decisão D1 do design 017 impossível de violar por
 * engano. `EdgePayload.national` é `EdgeNational`, que é inteiramente
 * majoritário (`candidato_a_id`, `needle_position`, `p_segundo_turno_overall`,
 * `cenarios_2t`); a corrida proporcional de Deputado Federal não tem referente
 * para nenhum desses campos, e por isso tem tipo próprio
 * (`EdgePayloadDeputado`).
 *
 * Sem esta restrição, `readProjection({ cargo: "dep" })` compilaria e
 * devolveria o payload de Deputado **tipado como `EdgePayload`** — o consumidor
 * leria `payload.national.candidato_a_id`, receberia `undefined` em runtime e
 * renderizaria uma agulha e um "líder" para a Câmara. O design 017 é literal
 * quanto a isso: "`readProjection` não pode devolver `EdgePayloadDeputado`
 * tipado como `EdgePayload`".
 *
 * Quem quer o payload de Deputado chama {@link readDeputadoProjection}.
 *
 * **Derivado de `proporcional`** (2026-09-29, spec 027): era
 * `Exclude<Cargo, "dep">`, escrito quando só o 6 era proporcional. Com `est` e
 * `dis` no tipo de token, aquela forma passaria a aceitar as assembleias como
 * majoritárias — `readProjection({ cargo: "est" })` compilaria e leria o
 * payload proporcional tipado como `EdgePayload`. Agora quem tira os
 * proporcionais é a tabela (`CargoTokenProporcional`, `lib/config/cargos.ts`).
 */
export type CargoMajoritario = Exclude<Cargo, CargoTokenProporcional>;

/**
 * O resultado de uma leitura do Global Config, com **"não existe" e "falhou"
 * como estados distintos**.
 *
 * ## Por que dois estados e não um `null`
 *
 * Até 2026-09-14 as quatro funções deste módulo faziam `catch { return null }`,
 * e a consequência estava na tela: uma **falha de rede** e uma **chave ainda
 * não publicada** chegavam ao chamador como exatamente a mesma coisa, sem
 * alarme nenhum. A página então escolhia um texto — e qualquer texto que ela
 * escolhesse estaria errado metade das vezes. Dizer "a eleição ainda não
 * começou" às 21h de 04/10 durante uma queda do Global Config é falso com toda
 * a autoridade da marca; dizer "estamos com um problema" em 20/09 é falso do
 * outro lado.
 *
 * É o padrão de **rede de segurança de mão única** que este projeto já pagou
 * caro para descobrir: a guarda existe, parece cobrir o caso, e aponta para o
 * lado errado — e é o mesmo par que o `??` funde em
 * `lib/config/dado-freshness.ts` (`"ausente"` × `"indisponivel"`, ADR-0038).
 *
 * ## O que muda e o que NÃO muda
 *
 * **Não muda a tela**: os dois estados continuam caindo no mesmo ramo de
 * espera, porque em ambos o sistema não sabe o resultado, e um ramo que
 * afirmasse a causa afirmaria uma causa que ninguém mediu. O que muda é que a
 * falha deixa de ser **silenciosa para o operador** — ela vira uma linha de
 * `error` estruturada nos logs, que é o canal de alarme que o writer já usa
 * (`lib/edge-config/writer.ts`, `logError` de `lib/tse/log.ts`).
 *
 * ⚠️ **Limite explícito**: preservar os NÚMEROS quando o Global Config inteiro
 * fica inacessível exigiria uma segunda cópia do último payload conhecido em
 * outro lugar (Blob, ISR de longa duração). Isso **não** está implementado, e
 * a regra "nunca fabrique zeros" cobre o buraco pela via negativa: sem número
 * conhecido, a tela não mostra número.
 */
export type LeituraEdge<T> =
  | { estado: "ok"; valor: T }
  /** Nenhuma das chaves candidatas respondeu. Estado normal antes da 1ª gravação. */
  | { estado: "ausente" }
  /** O SDK lançou. O dado pode existir e não chegamos nele. **Alarme.** */
  | { estado: "falha"; erro: unknown };

/**
 * Tenta cada chave em ordem e devolve o primeiro valor não-vazio.
 *
 * Custo: uma leitura por chave, e **só no caminho de miss** — a primeira
 * chave que responder encerra a busca. No caminho saudável (chave nova
 * publicada) é exatamente uma leitura, igual a antes.
 *
 * A ordem sempre é: chave nova → chave deprecada com dois-pontos → alias.
 * A chave deprecada existe porque não foi possível verificar se a API da
 * Vercel de fato recusa `:`; se ela sempre aceitou, há dado publicado sob o
 * esquema antigo e o read path não pode ficar cego durante a migração.
 * **Remover essa camada em `DEPRECATED_COLON_KEYS_REMOVAL_DATE`
 * (2026-10-26, dia seguinte ao 2º turno)** — ver `lib/edge-config/keys.ts`.
 *
 * Uma chave que lança **encerra a busca** em vez de seguir para a próxima: se
 * o transporte caiu, as chaves seguintes cairiam pelo mesmo motivo, e insistir
 * só multiplicaria a latência de um render que já vai degradar.
 *
 * ⚠️ As chaves chegam como **função**, não como array pronto, e isso é
 * load-bearing: `ufProjectionKey` valida a sigla e **lança** para sigla
 * malformada (`lib/edge-config/keys.ts`). Antes de 2026-09-14 o `try` do
 * chamador envolvia também a montagem do array; passar a lista já construída
 * deixaria essa exceção escapar do read path e derrubar o render. Construir
 * dentro do `try` classifica o caso como `"falha"` — que é o classificado
 * certo: não é "a chave não existe", é "não conseguimos nem perguntar".
 */
async function getFirst<T>(construirChaves: () => readonly string[]): Promise<LeituraEdge<T>> {
  let keys: readonly string[];
  try {
    keys = construirChaves();
  } catch (erro) {
    return { estado: "falha", erro };
  }

  for (const key of keys) {
    let value: T | undefined;
    try {
      value = await get<T>(key);
    } catch (erro) {
      return { estado: "falha", erro };
    }
    if (value) return { estado: "ok", valor: value };
  }
  return { estado: "ausente" };
}

/**
 * O ponto único onde uma falha de leitura vira alarme, e o único lugar deste
 * módulo que converte {@link LeituraEdge} no `null` histórico.
 *
 * O canal é `logError` — a mesma emissão estruturada que o writer usa para as
 * falhas dele (`lib/tse/log.ts`, RNF-032/RNF-034). **Não** dispara
 * `notifySlack`: este código roda no read path, uma vez por render, e durante
 * uma queda de minutos isso seria um POST por request. O alarme de Slack
 * pertence a quem roda uma vez por ciclo (o writer e os crons), não a quem
 * roda uma vez por leitor.
 */
function resolver<T>(leitura: LeituraEdge<T>, ctx: Record<string, unknown>): T | null {
  if (leitura.estado === "ok") return leitura.valor;
  if (leitura.estado === "falha") {
    logError("global-config read failed", {
      ...ctx,
      erro: leitura.erro instanceof Error ? leitura.erro.message : String(leitura.erro),
    });
  }
  return null;
}

/**
 * Lê o payload nacional do Edge Config. Por default resolve a chave via
 * `lib/config/calendar.currentPresidentialRace()` — em 2026 antes de 25/10 retorna
 * `pres t1`, depois `pres t2`.
 *
 * Backward-compat, em duas camadas, ambas só no caminho de miss:
 *   1. `projection-current-<cargo>-t<turno>` — esquema atual.
 *   2. `projection:current:<cargo>:t<turno>` — esquema deprecado com
 *      dois-pontos, caso a API da Vercel o tenha aceitado. **Remover em
 *      2026-10-26** (ver `lib/edge-config/keys.ts`).
 *   3. `projection-current` / `projection:current` — alias dinâmico S04,
 *      sem cargo/turno. Só para a corrida ATIVA: caller que passou override
 *      explícito não cai aqui.
 *
 * Retorna `null` quando:
 *   - `EDGE_CONFIG` ausente (dev/preview sem credencial).
 *   - Chave não publicada ainda (pré-eleição absoluta).
 *   - **A leitura falhou** — e nesse caso, e só nesse, emite `logError`
 *     (2026-09-14). Os três casos continuam indistinguíveis para o LEITOR, de
 *     propósito: a tela não pode afirmar uma causa que não mediu. Quem precisa
 *     da distinção chama {@link readProjectionResult}.
 *
 * Caller decide o que fazer com `null` — `/api/projection` retorna 503
 * com `{ error: "no_payload" }`, e o page faz fallback para "Aguardando
 * dados". 🔴 O que o caller **não** pode fazer é fabricar um payload de zeros:
 * ver o ramo de espera de `/governador` e `/senador`, que substituiu os
 * `emptyPayload()` de 13/09.
 *
 * @param opts.cargo  **Obrigatório.** O cargo que se quer ler. Não há default:
 *                    o ADR-0028 removeu o default vindo do calendário porque
 *                    um caller distraído recebia o payload presidencial com
 *                    forma válida; substituí-lo por um literal `"pres"` teria
 *                    deixado o mesmo footgun de pé. Apontado pelo
 *                    `constitution-guard` em 2026-09-11 e fechado no mesmo dia:
 *                    todos os call sites já declaravam o cargo, então torná-lo
 *                    obrigatório não custou nada e eliminou o caminho errado.
 * @param opts.turno  Override do turno ativo. Default: `currentPresidentialTurno()`.
 */
export async function readProjection(opts: {
  cargo: CargoMajoritario;
  turno?: Turno;
}): Promise<EdgePayload | null> {
  return resolver(await readProjectionResult(opts), {
    fn: "readProjection",
    cargo: opts.cargo,
    turno: opts.turno,
  });
}

/**
 * {@link readProjection} **sem colapsar os dois estados de "não veio nada"**.
 *
 * Existe para quem precisa distinguir "a chave ainda não foi gravada" de "a
 * leitura falhou" — hoje `/status` e os testes; amanhã qualquer superfície que
 * queira reportar a queda ao operador. Nenhuma **tela de leitor** distingue os
 * dois: as duas caem no mesmo ramo de espera, porque a tela não pode afirmar
 * uma causa que não mediu (spec 019 § RNF-010).
 *
 * ⚠️ Esta função **não** alarma — quem alarma é `readProjection`. Duas
 * emissões para a mesma falha dariam ao operador a impressão de duas quedas.
 */
export async function readProjectionResult(opts: {
  cargo: CargoMajoritario;
  turno?: Turno;
}): Promise<LeituraEdge<EdgePayload>> {
  if (!process.env.EDGE_CONFIG) return { estado: "ausente" };
  // O calendário responde só pelo TURNO presidencial (ADR-0028). O cargo é
  // OBRIGATÓRIO e não tem default: qualquer default — vindo do calendário ou
  // literal — faria um caller distraído receber o payload presidencial com
  // forma válida e conteúdo errado.
  const turnoPresidencial = currentPresidentialTurno();
  const cargo = opts.cargo;
  const turno = opts.turno ?? turnoPresidencial;

  // O alias legado sem cargo (`projection-current`) só existiu para a corrida
  // presidencial — comparar contra o literal, não contra o que o calendário
  // devolve, para que ele nunca seja consultado em nome de outro cargo.
  const isActiveRace = cargo === "pres" && turno === turnoPresidencial;

  return getFirst<EdgePayload>(() => [
    currentProjectionKey(cargo, turno),
    // DEPRECADO — remover em 2026-10-26.
    deprecatedColonCurrentProjectionKey(cargo, turno),
    ...(isActiveRace
      ? [
          LEGACY_CURRENT_ALIAS_KEY,
          // DEPRECADO — remover em 2026-10-26.
          DEPRECATED_COLON_CURRENT_ALIAS_KEY,
        ]
      : []),
  ]);
}

/**
 * Projeção nacional da corrida **presidencial**.
 *
 * Nasceu como wrapper backward-compat de S04 (`readProjection()` sem args) e,
 * desde o ADR-0028 (2026-09-11), declara o cargo explicitamente em vez de
 * herdar um default. O nome continua sem o cargo por compatibilidade com os
 * callers; o que ele lê está fixado aqui, num lugar só.
 *
 * Presidente é o único cargo com arquivo agregado nacional no TSE
 * (`lib/tse/targets.ts` — só cargo 1 gera alvo `br-`), então "projeção
 * nacional" é, por construção, presidencial. Governador, Senador e Deputado
 * Federal não têm equivalente: seus agregados nacionais são somas de UF.
 */
export async function readNationalProjection(): Promise<EdgePayload | null> {
  return readProjection({ cargo: "pres", turno: currentPresidentialTurno() });
}

/**
 * Lê o payload ARQUIVADO de uma corrida — segmento `archive` em vez de
 * `current` (ADR-0012, S06/F1). Usado pra acessar o resultado final do 1T
 * a partir de uma página em mode 2T:
 *
 *   `projection-archive-<cargo>-t<turno>`  →  ex. `projection-archive-pres-t1`
 *
 * ⚠️ **Corrigido em 2026-09-18.** Este parágrafo dizia que *"o orchestrator
 * grava o archive na transição de turno (S07 — virada 1T→2T)"*. **Ninguém
 * grava essa chave** — `grep -rn archiveProjectionKey` acha só leitura, e
 * `api/model/` não menciona archive em lugar nenhum. A S07 fechou sem a
 * transição, e a frase ficou falsa no meio do caminho.
 *
 * Como funciona de verdade, e por que não precisou de job novo: a chave
 * `projection-current-<cargo>-t<N>` **carrega o turno**, e o turno ativo vem
 * do calendário. Virada a data de 25/10, o ciclo passa a escrever `-t2` e
 * ninguém mais toca `-t1` — que vira, **por construção**, o retrato final do
 * 1º turno. A leitura cai nele como terceiro degrau, e só para turno já
 * encerrado.
 *
 * A chave `projection-archive-*` segue suportada e tem precedência: se um dia
 * algo passar a gravá-la (para congelar antes da virada, ou para sobreviver a
 * uma reingestão de `-t1`), ela ganha sem mudar nada aqui. Simetria total com
 * `readProjection`: mesmo shape `EdgePayload`, mesma serialização.
 *
 * Comportamento de retorno
 *   - `null` quando `EDGE_CONFIG` ausente (dev/preview sem credencial).
 *   - `null` quando a chave archive ainda não foi gravada (caso comum
 *     pré-1T, ou se o orchestrator ainda não rodou a transição). UI deve
 *     degradar graciosamente — `<TurnoOneRecap recap={null} />` retorna
 *     `null` sem placeholder mentiroso (ADR-0016).
 *
 * Caller típico
 *   ```ts
 *   const recap = await readArchivedProjection({ cargo: "pres", turno: 1 });
 *   // ... <TurnoOneRecap recap={recap} />
 *   ```
 *
 * @param opts.cargo  **Obrigatório** — ver `readProjection`.
 * @param opts.turno  Turno arquivado. Default: turno ativo - 1 não faz
 *                    sentido aqui (caller passa explicitamente). Default
 *                    é turno ativo, que SÓ retornará algo se já houve
 *                    transição passada para o turno corrente.
 */
export async function readArchivedProjection(opts: {
  cargo: CargoMajoritario;
  turno?: Turno;
}): Promise<EdgePayload | null> {
  if (!process.env.EDGE_CONFIG) return null;
  // Ver a nota em `readProjection`: cargo nunca vem do calendário (ADR-0028).
  const cargo = opts.cargo;
  const turno = opts.turno ?? currentPresidentialTurno();

  // 🔴 O terceiro degrau existe porque os dois primeiros NUNCA SÃO ESCRITOS.
  //
  // Medido em 2026-09-18: `grep -rn archiveProjectionKey` acha só leitura, e
  // `grep -rn archive api/model/*.py` não acha nada. A docstring acima dizia
  // que "o orchestrator grava o archive na transição de turno (S07)" — a S07
  // fechou em 18/09 sem isso, e a afirmação ficou falsa no meio do caminho.
  // Sem o degrau, `<TurnoOneRecap>` seria `null` a noite inteira de 25/10.
  //
  // O congelamento já acontece SOZINHO, e é por isso que o degrau é seguro: a
  // chave `projection-current-<cargo>-t<N>` inclui o turno, e o turno ativo
  // vem do CALENDÁRIO (`currentPresidentialRace`). Virada a data, o ciclo
  // passa a escrever `-t2` e ninguém mais toca `-t1` — que vira, por
  // construção, o retrato final do turno encerrado.
  //
  // ⚠️ A guarda `turno < turnoAtivo` não é zelo: sem ela, pedir o "arquivo" do
  // turno em andamento devolveria o payload AO VIVO travestido de histórico,
  // e a tela mostraria o placar de agora como se fosse o resultado fechado do
  // turno anterior. É a mesma família de erro dos três estados — apresentar
  // uma coisa como outra.
  const turnoAtivo = currentPresidentialTurno();
  const turnoEncerrado = turno < turnoAtivo;

  return resolver(
    await getFirst<EdgePayload>(() => [
      archiveProjectionKey(cargo, turno),
      // DEPRECADO — remover em 2026-10-26.
      deprecatedColonArchiveProjectionKey(cargo, turno),
      // Só para turno JÁ ENCERRADO. Ver a nota acima.
      ...(turnoEncerrado ? [currentProjectionKey(cargo, turno)] : []),
    ]),
    { fn: "readArchivedProjection", cargo, turno, turnoEncerrado },
  );
}

/**
 * Lê o payload de drill-down de UMA UF do Edge Config.
 *
 * S05/F4c — chave para corridas com cargo/turno explícito:
 *   `projection-uf-<SIGLA>-<cargo>-t<turno>` (ex: `projection-uf-SP-pres-t1`).
 *
 * Backward-compat, só no caminho de miss: chave nomeada → chave deprecada
 * com dois-pontos (**remover em 2026-10-26**) → alias legado
 * `projection-uf-<SIGLA>` / `projection:uf:<SIGLA>` (S04).
 *
 * @param sigla UF de 2 letras. `lib/edge-config/keys.ts` valida o formato e
 *   normaliza para maiúscula — sigla malformada lança, e o `catch` desta
 *   função converte em `null` (mesma degradação de qualquer outra falha de
 *   leitura). O caller (`/api/projection?uf=`) já normaliza antes.
 * @param opts.cargo  Override do cargo. Default: cargo ativo.
 * @param opts.turno  Override do turno. Default: turno ativo.
 */
export async function readUfProjection(
  sigla: string,
  opts: { cargo: CargoMajoritario; turno?: Turno },
): Promise<EdgePayloadUf | null> {
  if (!process.env.EDGE_CONFIG) return null;
  // O calendário responde só pelo TURNO presidencial (ADR-0028). O cargo é
  // OBRIGATÓRIO e não tem default: qualquer default — vindo do calendário ou
  // literal — faria um caller distraído receber o payload presidencial com
  // forma válida e conteúdo errado.
  const turnoPresidencial = currentPresidentialTurno();
  const cargo = opts.cargo;
  const turno = opts.turno ?? turnoPresidencial;

  // O alias legado sem cargo (`projection-current`) só existiu para a corrida
  // presidencial — comparar contra o literal, não contra o que o calendário
  // devolve, para que ele nunca seja consultado em nome de outro cargo.
  const isActiveRace = cargo === "pres" && turno === turnoPresidencial;

  // A sigla malformada lança DENTRO de `getFirst` (o validador de
  // `lib/edge-config/keys.ts` roda na montagem da chave) e portanto chega aqui
  // como `"falha"` — que é o classificado certo: não é "a chave não existe", é
  // "não conseguimos nem perguntar".
  return resolver(
    await getFirst<EdgePayloadUf>(() => [
      ufProjectionKey(sigla, cargo, turno),
      // DEPRECADO — remover em 2026-10-26.
      deprecatedColonUfProjectionKey(sigla, cargo, turno),
      ...(isActiveRace
        ? [
            legacyUfAliasKey(sigla),
            // DEPRECADO — remover em 2026-10-26.
            deprecatedColonLegacyUfAliasKey(sigla),
          ]
        : []),
    ]),
    { fn: "readUfProjection", sigla, cargo, turno },
  );
}

/**
 * Lê o payload nacional de um cargo **proporcional** — `6` → chave
 * `projection-current-dep-t1` (design 017 § D1, ADR-0012); `7` →
 * `projection-current-est-t1`; `8` → `projection-current-dis-t1` (spec 027
 * RF-279, ADR-0066).
 *
 * 🔴 `cargo` é **obrigatório, sem default** (2026-09-29). Com três casas
 * proporcionais, um default `6` faria a capa estadual mostrar a Câmara dos
 * Deputados com forma válida — o conversor de cargo com default silencioso que
 * este repositório já pagou três vezes. Um número fora dos proporcionais
 * (vindo de um `as`) lança em vez de ler a chave de outro cargo.
 *
 * Função separada, e não um ramo de `readProjection`, porque o tipo de retorno
 * é outro: `EdgePayloadDeputado` não tem `national`, tem `bancada`. Ver
 * {@link CargoMajoritario} para o porquê de a separação estar no tipo e não
 * numa convenção de chamada.
 *
 * Sem alias legado e sem chave com dois-pontos: esta chave nasce em
 * 2026-09-12, depois da emenda de separador do ADR-0012 (2026-09-08) e depois
 * do fim do alias `projection-current` (que só existiu para a corrida
 * presidencial). Nunca houve dado publicado sob o esquema antigo para este
 * cargo, então não há nada para o qual degradar — uma leitura a mais no
 * caminho de miss seria custo sem contrapartida.
 *
 * Não recebe `turno`: os três proporcionais são turno único
 * (`temSegundoTurno: false` em `lib/config/cargos.ts`). Um parâmetro de turno
 * aqui só abriria a porta para uma chave `-t2` que nunca é escrita.
 *
 * Retorna `null` quando `EDGE_CONFIG` está ausente (dev/preview sem
 * credencial) ou quando a chave ainda não foi gravada. O caller degrada —
 * a página renderiza a estrutura inteira com "aguardando apuração"
 * (constituição § 3 e § 7).
 */
export async function readDeputadoProjection(
  cargo: CargoProporcional,
): Promise<EdgePayloadDeputado | null> {
  if (!isCargoProporcional(cargo)) {
    throw new Error(`readDeputadoProjection: cargo ${String(cargo)} não é proporcional`);
  }
  if (!process.env.EDGE_CONFIG) return null;

  const token = cargoToken(cargo);
  return resolver(await getFirst<EdgePayloadDeputado>(() => [currentProjectionKey(token, 1)]), {
    fn: "readDeputadoProjection",
    cargo: token,
    turno: 1,
  });
}

// ---------------------------------------------------------------------------
// Interruptor da projeção de Deputado Federal — spec 026 RF-265, ADR-0063 D4
// ---------------------------------------------------------------------------

/**
 * A trava da projeção em % apurado — o piso que o interruptor NÃO consegue
 * baixar (ADR-0063 D4: "o piso de 25% é decisão do dono e só muda por ADR").
 * Espelho TypeScript da constante do modelo Python; a trava que libera a
 * projeção é a do modelo, esta só valida o `pct_minimo` da chave.
 */
export const TRAVA_PROJECAO_DEP_PCT = 25;

/**
 * De onde veio o estado do interruptor. Vai para o operador (`pnpm
 * dep:projecao`, logs) e para o motivo que a tela mostra.
 *
 *   - `chave`    — a chave existe e tem forma válida;
 *   - `ausente`  — a chave não existe (ou não há Global Config configurado);
 *   - `invalida` — a chave existe com valor de forma inesperada;
 *   - `falha`    — a leitura lançou.
 *
 * É daqui — e não de `projecao.motivo`, cujo conjunto é fechado (design 026
 * § 2.7) — que a tela tira "desligada" (`chave`/`ausente`) × "não foi possível
 * ler o interruptor" (`invalida`/`falha`), a distinção que o ADR-0063 D4 exige.
 */
export type OrigemInterruptor = "chave" | "ausente" | "invalida" | "falha";

/**
 * O interruptor como a TELA o vê. Sem `em`/`por`, de propósito: são de
 * auditoria (ADR-0063 D4) e não podem nem chegar perto de um componente que
 * os serializasse no HTML.
 */
export interface InterruptorProjecaoLido {
  /** `true` só com `origem: "chave"`. */
  ligada: boolean;
  /** A trava em vigor: a da chave (25–100) ou, sem ela, {@link TRAVA_PROJECAO_DEP_PCT}. */
  pct_minimo: number;
  origem: OrigemInterruptor;
  /** A chave trazia um `pct_minimo` que foi IGNORADO (< 25 ou inválido). */
  pct_minimo_ignorado?: true;
}

/**
 * Interpreta o resultado de uma leitura da chave `interruptor-projecao-dep`.
 * Pura — é a regra inteira, e o script `pnpm dep:projecao` e o modo simulado a
 * reusam para dizer ao operador o mesmo que a tela vai fazer.
 *
 * 🔴 **Falha fechada nos DOIS sentidos** (ADR-0063 D4): só uma leitura
 * bem-sucedida com `ligada === true` liga. Chave AUSENTE desliga; leitura com
 * FALHA desliga; valor INVÁLIDO (não-objeto — inclusive `false`/`null`/`true`
 * crus —, ou `ligada` que não é booleano) desliga. "Começa ligada" é o passo
 * de 03/10 que grava `{ligada: true}` (`pnpm dep:projecao --ligar
 * --confirmar`), não um default daqui: um default ligado faria o "desligar"
 * gravado no store errado deixar a produção ligada com cara de desligada.
 *
 * `origem` separa "desligada pela operação" (`chave`/`ausente`) de "não foi
 * possível ler" (`invalida`/`falha`) — a tela diz coisas diferentes.
 *
 * `pct_minimo` só SOBE a trava: entre 25 e 100 vale; abaixo de 25, acima de
 * 100 ou não-numérico é IGNORADO (`pct_minimo_ignorado`, e vale 25) sem mexer
 * em `ligada` — ADR-0063 D4, "ignorado, com log". É a MESMA regra do lado
 * Python (`api/model/deputado_projecao.py::interruptor_do_corpo`) e a do design
 * 026 § 2.10 (alinhados em 29/09). Um valor decimal entre 25 e 100 vale como
 * veio aqui e sobe para o inteiro de cima no POST do modelo
 * (`lerProjecaoDepParaOModelo`) — o Python faz o mesmo `ceil` se o receber.
 * `em`/`por` não saem daqui.
 */
export function interpretarInterruptor(leitura: LeituraEdge<unknown>): InterruptorProjecaoLido {
  const piso = TRAVA_PROJECAO_DEP_PCT;
  if (leitura.estado === "ausente") return { ligada: false, pct_minimo: piso, origem: "ausente" };
  if (leitura.estado === "falha") return { ligada: false, pct_minimo: piso, origem: "falha" };

  const v = leitura.valor;
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ligada: false, pct_minimo: piso, origem: "invalida" };
  }
  const bruto = v as Record<string, unknown>;
  if (typeof bruto.ligada !== "boolean") {
    return { ligada: false, pct_minimo: piso, origem: "invalida" };
  }

  const saida: InterruptorProjecaoLido = {
    ligada: bruto.ligada,
    pct_minimo: piso,
    origem: "chave",
  };
  if (bruto.pct_minimo !== undefined) {
    const pct = bruto.pct_minimo;
    if (
      typeof pct === "number" &&
      Number.isFinite(pct) &&
      pct >= TRAVA_PROJECAO_DEP_PCT &&
      pct <= 100
    ) {
      saida.pct_minimo = pct;
    } else {
      saida.pct_minimo_ignorado = true;
    }
  }
  return saida;
}

/**
 * Tempo máximo da leitura da chave do interruptor, em ms. Esgotado ⇒ a leitura
 * é `falha` e a projeção fica DESLIGADA — o ADR-0063 D4 lista "tempo esgotado"
 * entre as leituras que desligam.
 *
 * Por que existe: a leitura roda a cada render das telas de Deputado e UMA vez
 * por ciclo de ingestão, antes do disparo do modelo
 * (`lerProjecaoDepParaOModelo`, `lib/tse/ingest-handler.ts`). Sem teto, um
 * Edge Config que não responde (sem lançar) prende as duas coisas pelo tempo
 * que o `fetch` do SDK quiser — no ciclo, isso segura o marcador final do
 * lock e o próximo ciclo. Com o teto, o pior caso é 2 s e a projeção apagada,
 * o mesmo estado de uma leitura que falhou. 2 s é folga larga sobre a leitura
 * típica do Edge Config (dezenas de ms) e curta perto do orçamento de 60 s do
 * ciclo.
 */
export const TIMEOUT_INTERRUPTOR_MS = 2_000;

/** O erro de tempo esgotado — distinto no log de uma falha que lançou. */
export class TempoEsgotadoInterruptor extends Error {
  constructor(ms: number) {
    super(`leitura do interruptor-projecao-dep sem resposta em ${ms} ms`);
    this.name = "TempoEsgotadoInterruptor";
  }
}

/**
 * `get` da chave com teto de tempo. O `setTimeout` é limpo em QUALQUER
 * desfecho — um timer pendurado por leitura seria um vazamento por render.
 * `Promise.race` inscreve-se nas duas promessas, então a rejeição tardia do
 * `get` que perdeu a corrida não vira `unhandledRejection`.
 */
async function getComTeto(chave: string, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const esgotado = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new TempoEsgotadoInterruptor(ms)), ms);
  });
  try {
    return await Promise.race([get<unknown>(chave), esgotado]);
  } finally {
    clearTimeout(timer);
  }
}

/** Avisos de uma vez por processo — o read path roda uma vez por leitor. */
const avisosDoInterruptor = new Set<string>();

function avisarUmaVez(chave: string, emitir: () => void): void {
  if (avisosDoInterruptor.has(chave)) return;
  avisosDoInterruptor.add(chave);
  emitir();
}

/** Só para os testes: zera os avisos de uma vez por processo. */
export function _reiniciarAvisosDoInterruptor(): void {
  avisosDoInterruptor.clear();
}

/**
 * Lê o interruptor da projeção de um cargo proporcional — `6` → chave
 * `interruptor-projecao-dep`; `7` e `8` → `interruptor-projecao-est` (spec 027
 * RF-287; `interruptorProjecaoKey`, `lib/edge-config/keys.ts`). Regra em
 * {@link interpretarInterruptor}: só `ligada === true` lido com sucesso liga;
 * tudo o mais desliga — para QUALQUER cargo.
 *
 * `cargo` obrigatório, sem default: o interruptor federal NÃO liga as
 * assembleias, e um default `6` faria exatamente isso.
 *
 * **Nunca lança, e nunca demora mais que {@link TIMEOUT_INTERRUPTOR_MS}.**
 * Chamada a cada render das telas de Deputado e pela rota da lista 61+ — é o
 * que faz "desligar" valer em até ~60 s mesmo com o objeto do Blob ainda
 * carregando as marcas do ciclo anterior (ver `aplicarInterruptorProjecao`,
 * `lib/blob/deputado-uf.ts`). Tempo esgotado é `falha` ⇒ desligada.
 *
 * Log: `falha`/`invalida` ⇒ `logError` a cada leitura (é alarme: a projeção
 * sumiu sem ninguém decidir); `ausente` e `pct_minimo` ignorado ⇒ `logWarn`
 * uma vez por processo (estado conhecido antes da virada; repetir por leitor
 * seria ruído).
 *
 * ⚠️ Não usa `getFirst`, de propósito: `getFirst` trata valor falsy como "não
 * existe" (`if (value)`). Aqui só `undefined` é ausência — um `false` cru
 * gravado à mão no painel é INVÁLIDO, e o operador precisa ver isso.
 */
export async function readInterruptorProjecao(
  cargo: CargoProporcional,
): Promise<InterruptorProjecaoLido> {
  // Falha FECHADA também aqui: um número fora dos proporcionais (por um `as`)
  // não escolhe chave nenhuma — desliga, com alarme. Nunca lança (contrato).
  let chave: string;
  try {
    chave = interruptorProjecaoKey(cargo);
  } catch (erro) {
    logError("interruptor de projeção sem chave para o cargo — projeção DESLIGADA", {
      fn: "readInterruptorProjecao",
      cargo,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return interpretarInterruptor({ estado: "falha", erro });
  }
  if (!process.env.EDGE_CONFIG) return interpretarInterruptor({ estado: "ausente" });

  let leitura: LeituraEdge<unknown>;
  try {
    const valor = await getComTeto(chave, TIMEOUT_INTERRUPTOR_MS);
    leitura = valor === undefined ? { estado: "ausente" } : { estado: "ok", valor };
  } catch (erro) {
    leitura = { estado: "falha", erro };
  }

  const lido = interpretarInterruptor(leitura);
  const comoLigar =
    chave === interruptorProjecaoKey(6)
      ? "pnpm dep:projecao --ligar --confirmar (passo da virada, 03/10)"
      : "pnpm dep:projecao --cargo estadual --ligar --confirmar";
  if (leitura.estado === "falha") {
    logError("global-config read failed", {
      fn: "readInterruptorProjecao",
      chave,
      efeito: "projeção DESLIGADA (falha fechada, ADR-0063)",
      tempoEsgotado: leitura.erro instanceof TempoEsgotadoInterruptor,
      erro: leitura.erro instanceof Error ? leitura.erro.message : String(leitura.erro),
    });
  } else if (lido.origem === "invalida") {
    logError(`${chave} inválido — projeção DESLIGADA`, {
      fn: "readInterruptorProjecao",
      chave,
      valor: String(JSON.stringify(leitura.estado === "ok" ? leitura.valor : null)).slice(0, 200),
    });
  } else if (lido.origem === "ausente") {
    avisarUmaVez(`${chave}:ausente`, () =>
      logWarn(`${chave} ausente — projeção DESLIGADA`, {
        fn: "readInterruptorProjecao",
        chave,
        comoLigar,
      }),
    );
  }
  if (lido.pct_minimo_ignorado) {
    avisarUmaVez(`${chave}:pct_minimo`, () =>
      logWarn(`${chave}: pct_minimo ignorado (só sobe a trava, 25–100)`, {
        fn: "readInterruptorProjecao",
        chave,
        piso: TRAVA_PROJECAO_DEP_PCT,
      }),
    );
  }
  return lido;
}
