/**
 * lib/config/calendar.ts
 *
 * Calendário canônico da corrida PRESIDENCIAL 2026. Single source of truth
 * para "em que turno está a corrida presidencial neste instante" — alimenta:
 *
 *   - O alias dinâmico de `projection-current` no Global Config (ADR-0012, separador corrigido em 08/09).
 *     Antes de 04/10 → resolve para `(pres, 1)`; entre 04/10 e 25/10
 *     → `(pres, 2)`; antes de cada janela de governador também aliasa
 *     conforme a UF.
 *   - O dia D para o roadmap (`docs/product/roadmap.md`).
 *   - O badge "Próximo turno em X dias" do header (RF-090, S07).
 *
 * Adicionado em S05/F4c (ADR-0012). Substitui a constante implícita
 * `cargo=1, turno=1` espalhada por orchestrator, writer e reader.
 *
 * ## Não existe "a" corrida ativa (ADR-0028, implementado em 2026-09-11)
 *
 * Até 2026-09-11 este módulo exportava `currentRace()`/`currentCargo()` com a
 * semântica de "qual corrida está ativa", e o read path
 * (`lib/edge-config/reader.ts`) usava o `cargo` devolvido como DEFAULT quando o
 * caller não passava um. Isso só funcionava porque havia dois cargos e o
 * `CALENDAR_2026` só tem entradas `pres`: um caller que esquecesse o cargo
 * recebia silenciosamente o payload presidencial, com forma válida e conteúdo
 * errado. Com quatro cargos (Presidente, Governador, Senador, Deputado Federal
 * — ADR-0026) isso vira um defeito à espera de acontecer.
 *
 * O ADR-0028 resolveu por **corrida explícita por rota**: quem lê declara o
 * cargo, sempre; o calendário responde só pelo TURNO presidencial. Daí os nomes
 * `currentPresidentialRace`/`currentPresidentialTurno`, e a remoção de
 * `currentCargo()` — que era redundante por construção (`CALENDAR_2026` não tem
 * entrada que não seja `pres`).
 *
 * Constituição § 9 (stack Vercel): nenhum I/O aqui — datas hardcoded da
 * resolução TSE 2026. Se TSE publicar mudança de calendário, atualizar
 * `CALENDAR_2026` (e abrir ADR se for grande). Determinismo § 6: a
 * função `currentPresidentialRace(now)` é pura, mesmo input → mesmo output.
 */

/**
 * Token de cargo para **namespacing de chave** do Global Config / Blob
 * (ADR-0012) — não é o código numérico do TSE.
 *
 * Mapeamento para o código do TSE (`lib/edge-config/types.ts`):
 * `pres` = 1, `gov` = 3, `sen` = 5, `dep` = 6, `est` = 7, `dis` = 8.
 *
 * `est` (Deputado Estadual, 26 Assembleias) e `dis` (Deputado Distrital,
 * Câmara Legislativa do DF) entraram em 2026-09-29 (spec 027, ADR-0066). São
 * tokens DISTINTOS de `dep` de propósito: o mesmo token para os três cargos
 * proporcionais faria SP estadual gravar por cima de SP federal
 * (`projection-current-dep-t1`) — chave válida, conteúdo de outra casa.
 *
 * Os dois tipos `Cargo` do repositório continuam **deliberadamente separados**
 * (ADR-0026 item 2, ADR-0028 item 2): este nomeia chaves, o numérico espelha o
 * TSE. Não fundir; a conversão explícita entre os dois é `cargoToken`
 * (`lib/edge-config/keys.ts`).
 */
export type Cargo = "pres" | "gov" | "sen" | "dep" | "est" | "dis";

/** Turno eleitoral. */
export type Turno = 1 | 2;

/**
 * Uma corrida no calendário. `start` é o instante em que a corrida fica
 * ATIVA — geralmente o "dia da apuração" das 7h BRT. A corrida continua
 * ativa até `start` da próxima corrida.
 *
 * Só existem entradas `cargo: "pres"` aqui, por desenho (ADR-0028 item 1): os
 * demais cargos não têm calendário próprio — Governador acompanha o
 * presidencial, e Senador e Deputado Federal se decidem em turno único.
 *
 * `start` aceita `Date` ou string ISO 8601 — convertido in-place pelo
 * helper `currentPresidentialRace`. Mantemos string nas constantes pra facilitar
 * grep/diff sem precisar montar `new Date(2026, 9, 4, ...)`.
 */
export interface Race {
  start: Date | string;
  cargo: Cargo;
  turno: Turno;
}

/**
 * Calendário 2026 — datas conhecidas:
 *
 *   - 1º turno: 04/10/2026 (domingo). Janela ativa: 04/10 até 25/10.
 *   - 2º turno: 25/10/2026 (domingo). Janela ativa: 25/10 até fim do ano.
 *
 * Antes de 04/10/2026 a "corrida ativa" é `(pres, 1)` por convenção
 * (preview / pré-apuração / dev local) — não é apuração de verdade, mas
 * o consumer precisa de uma chave determinística pra ler.
 *
 * Governador segue o mesmo calendário do presidente em 2026 (eleição geral);
 * Senador e Deputado Federal se decidem em **turno único**, em 04/10 — não há
 * 2º turno para eles (ADR-0026). Nenhum dos três tem entrada aqui: quem lê
 * declara o cargo (ADR-0028), e este calendário só responde pelo turno
 * presidencial.
 */
/**
 * Fechamento das urnas nos dois turnos de 2026 — 17h de Brasília (20h UTC).
 * Antes disso, no dia da eleição, o TSE não publica apuração: o último dado é
 * o boletim zerado da véspera, e "não avança" por definição. Quem mede atraso
 * de dado (`avaliarFrescorDado`) conta a partir daqui (decisão do dono 04/10:
 * o aviso de dado parado aparecia no Estadual às 9h, "há 19 horas").
 */
export const FECHAMENTO_URNAS_2026: readonly string[] = [
  "2026-10-04T20:00:00Z",
  "2026-10-25T20:00:00Z",
];

/** Janela antes do fechamento em que o dia já é "dia da eleição". */
const DIA_DA_ELEICAO_MS = 24 * 60 * 60 * 1000;

/**
 * Desde quando o atraso de um dado do TSE pode ser cobrado, no instante
 * `agoraMs`:
 *
 * - `"antes-do-fechamento"` — é dia de eleição e as urnas ainda não fecharam:
 *   nenhum dado pode avançar, então não existe atraso a cobrar;
 * - um número (ms) — o fechamento mais recente já passado: o atraso conta a
 *   partir do MAIS NOVO entre ele e o dado (às 17h01 o dado de ontem não está
 *   "parado há 20 horas" — a apuração acabou de começar);
 * - `null` — nenhum fechamento passou ainda e não é dia de eleição (pré-1º
 *   turno, simulados do TSE): o atraso conta a partir do próprio dado.
 */
export function inicioDaCobrancaDeAtraso(agoraMs: number): "antes-do-fechamento" | number | null {
  let maisRecente: number | null = null;
  for (const iso of FECHAMENTO_URNAS_2026) {
    const fechamento = Date.parse(iso);
    if (agoraMs < fechamento && agoraMs >= fechamento - DIA_DA_ELEICAO_MS) {
      return "antes-do-fechamento";
    }
    if (fechamento <= agoraMs && (maisRecente === null || fechamento > maisRecente)) {
      maisRecente = fechamento;
    }
  }
  return maisRecente;
}

export const CALENDAR_2026: Race[] = [
  // Pré-apuração — alias default antes do 1T.
  { start: "2026-01-01T00:00:00-03:00", cargo: "pres", turno: 1 },
  // 1T — 04/10/2026, 17h BRT (fechamento das urnas; antes disso é "warmup").
  // Usamos 00:00 BRT do dia 04 para que devs trabalhando de manhã já vejam
  // o estado "1T ativo".
  { start: "2026-10-04T00:00:00-03:00", cargo: "pres", turno: 1 },
  // 2T — 25/10/2026, 00:00 BRT. A virada do alias deve coincidir com a
  // archival do payload 1T (`projection-archive-pres-t1`). Essa archival é
  // feita por job dedicado em S07 (não nessa sprint).
  { start: "2026-10-25T00:00:00-03:00", cargo: "pres", turno: 2 },
];

/**
 * Resolve em que **turno da corrida presidencial** o instante `now` cai.
 * Default: `Date.now()`.
 *
 * **Não** responde "qual cargo está ativo" — essa pergunta não tem resposta
 * única desde que o produto passou a cobrir quatro cargos simultâneos
 * (ADR-0028). O `cargo` do `Race` devolvido é sempre `"pres"`; quem precisa de
 * outro cargo passa o seu explicitamente ao reader.
 *
 * Algoritmo: encontra a Race com maior `start` <= `now`. Se nenhuma
 * (now anterior a TODAS as datas — improvável dado o sentinel
 * 2026-01-01), retorna a primeira do calendário (default `pres t1`).
 *
 * @example
 * currentPresidentialRace(new Date("2026-09-15"))
 * // → { cargo: "pres", turno: 1, start: "2026-01-01T..." }
 *
 * currentPresidentialRace(new Date("2026-11-01"))
 * // → { cargo: "pres", turno: 2, start: "2026-10-25T..." }
 */
export function currentPresidentialRace(now: Date = new Date()): Race {
  const t = now.getTime();
  // Ordena por start ASC e pega a última cujo start <= now.
  const sorted = [...CALENDAR_2026].sort((a, b) => {
    const ta = a.start instanceof Date ? a.start.getTime() : new Date(a.start).getTime();
    const tb = b.start instanceof Date ? b.start.getTime() : new Date(b.start).getTime();
    return ta - tb;
  });
  let active: Race | null = null;
  for (const race of sorted) {
    const ts = race.start instanceof Date ? race.start.getTime() : new Date(race.start).getTime();
    if (ts <= t) {
      active = race;
    } else {
      break;
    }
  }
  // `sorted` é construído a partir de `CALENDAR_2026` que tem >=1 entry;
  // fallback seguro pro Race default (`pres t1` 2026-01-01).
  return active ?? sorted[0] ?? { start: "2026-01-01T00:00:00-03:00", cargo: "pres", turno: 1 };
}

/**
 * Shortcut: turno da corrida presidencial (1 ou 2).
 *
 * É o único dado do calendário que a moldura global precisa — o `<TurnoSwitch>`
 * e o `layout.tsx` usam isto para saber que turno destacar, sem consultar
 * cargo nenhum.
 */
export function currentPresidentialTurno(now?: Date): Turno {
  return currentPresidentialRace(now).turno;
}

// `currentCargo()` existiu até 2026-09-11 e foi REMOVIDA (ADR-0028 item 4):
// devolvia sempre `"pres"` por construção, e todo call site que a usasse
// estaria perguntando algo que não tem resposta única. Não recriar — quem
// precisa de um cargo passa o seu explicitamente.
