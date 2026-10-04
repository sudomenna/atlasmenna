/**
 * lib/config/dado-freshness.ts
 *
 * **O relógio do dado, e o que a tela diz sobre ele.** Lado de leitura do
 * [ADR-0038](../../docs/architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)
 * — D1 (os quatro estados de `dado_ts`) e o gatilho de D4 (o banner amarelo).
 *
 * ## O problema que este módulo fecha
 *
 * `EdgePayload.ts` sempre foi honesto no doc-comment ("o momento em que o
 * modelo rodou") e sempre foi apresentado como desonesto na tela:
 * `<ApuracaoMeta>` rotulava esse valor como "Última atualização", e o leitor
 * entende isso como "quando o TSE atualizou". Se a ingestão para — TSE fora do
 * ar, cron falhando, lock preso — o modelo continua rodando sobre os últimos
 * snapshots do banco e carimbando um `ts` **fresco** sobre dado **parado**, a
 * cada ciclo, indefinidamente. `dado_ts` (`max(dg, hg)` dos boletins do ciclo,
 * ADR-0038 D1) é o relógio que congela junto com o TSE, e é dele que saem tanto
 * o texto primário de frescor quanto o banner.
 *
 * A spec 003 já nomeava o estado "Erro de dados (>60s sem update)"
 * (`docs/specs/003-home-nacional/spec.md:108`) desde a redação original, e a
 * constituição § 7 exige "graceful degradation (último valor conhecido + banner
 * amarelo)" (RNF-010/RNF-012) — mas "sem update" nunca teve um relógio que
 * medisse "update de quê". Este módulo é esse relógio.
 *
 * ## Por que o limiar é por cargo, e é ×3
 *
 * Um limiar absoluto compartilhado seria ruidoso para um cargo e cego para
 * outro: "60 s" calibrado para Presidente dispararia a cada ciclo **normal** de
 * Deputado Federal (cadência de 30 min); calibrado para Deputado, ficaria cego
 * a meia hora de silêncio na corrida presidencial. ×3 dá margem para **dois
 * ciclos perdidos completos** antes de acender — folgado o bastante para não
 * confundir jitter de cron com incidente, apertado o bastante para acender bem
 * antes de um leitor humano notar que a tela não anda (ADR-0038 D3).
 *
 * ## Por que a cadência mora aqui, e não em `CargoInfo`
 *
 * `lib/config/cargos.ts` é espelhado em `api/model/cargos.py` com guarda de
 * sincronia (`tests/unit/model/test_cargos_sync.py`): um campo novo lá obriga
 * uma decisão no espelho Python. Cadência de **cron de ingestão** é
 * conhecimento do read path — o modelo não faz I/O de rede — então mora neste
 * módulo, com a sua própria guarda: `tests/unit/config/dado-freshness.test.ts`
 * lê `vercel.ts` como texto e falha se a tabela abaixo divergir dos crons de
 * verdade.
 *
 * Zero I/O: tabela estática e funções puras (constituição § 9). O gatilho do
 * banner é calculado **no servidor**, a partir do `dado_ts` que já veio no
 * JSON — nenhuma chamada nova ao TSE, nenhuma query nova (ADR-0038 D4).
 */

import { inicioDaCobrancaDeAtraso } from "@/lib/config/calendar";
import type { CargoTse } from "@/lib/config/cargos";
import { formatTimeHMS } from "@/lib/utils/format";

/**
 * Cadência de ingestão de cada cargo, em segundos, espelhando os crons de
 * `vercel.ts`:
 *
 * | Cargo                       | cron (campo de minuto)            | cadência |
 * |-----------------------------|-----------------------------------|----------|
 * | 1 Presidente / 3 Governador | todo minuto                       | 60 s     |
 * | 5 Senador                   | passo de 5                        | 300 s    |
 * | 6 Deputado Federal          | 6 fatias, cada uma `0,30`…`25,55` | 1.800 s  |
 * | 7 Deputado Estadual         | `2,7,…,57` (de 5 em 5)            | 300 s    |
 * | 8 Deputado Distrital        | `3,8,…,58` (de 5 em 5)            | 300 s    |
 *
 * 7 e 8 (spec 027 Fase 1, ADR-0067) leem um resumo por casa numa invocação
 * só — sem fatia —, então a cadência do dado é o próprio período do cron. Se
 * a Fase 2 fatiar o 7 junto com o 6, esta linha passa a ser a volta completa,
 * como a do 6.
 *
 * Presidente e Governador a 60 s vêm do ADR-0011; Senador a 5 min, do ADR-0026
 * item 1 (nota (b)).
 *
 * ⚠️ **O cargo 6 é a linha em que é fácil errar.** Em `vercel.ts` há SEIS
 * entradas de cron para Deputado Federal, uma por fatia
 * (`/api/ingest/deputado-federal/1..6`), e elas estão intercaladas de 5 em 5
 * minutos. Ler "dispara a cada 5 min" daquilo é a leitura errada: cada fatia
 * cobre ~1/6 do fan-out (~1.019 dos ~6.110 alvos) e **repete a cada 30 min**.
 * O conjunto do dado do cargo só se renova por inteiro na volta completa —
 * 30 min (ADR-0036), que é o mesmo número que o Python publica em
 * `atualizacao_min` (RF-128). Um limiar montado sobre 5 min acenderia o banner
 * em todo ciclo saudável desta corrida.
 */
export const CADENCIA_SEGUNDOS: Readonly<Record<CargoTse, number>> = {
  1: 60,
  3: 60,
  5: 300,
  6: 1800,
  7: 300,
  8: 300,
};

/**
 * Quantas cadências o dado pode ficar parado antes de a tela reclamar.
 *
 * ×1 dispararia a cada tick de cron atrasado por motivo transitório de
 * infraestrutura — o próprio ADR-0011 assume que um ciclo pode ocasionalmente
 * demorar mais sem que isso seja incidente (ADR-0038 D3).
 */
export const LIMIAR_EM_CADENCIAS = 3;

/**
 * Limiar de "dado parado" deste cargo, em segundos. **Derivado**, nunca
 * literal: se a cadência de um cargo mudar, o limiar acompanha sozinho, sem
 * exigir uma segunda edição sincronizada em outro lugar (ADR-0038 D3).
 *
 * Hoje: 180 s (Presidente/Governador), 900 s (Senador), 5.400 s (Deputado).
 */
export function limiarDadoParadoSegundos(cargo: CargoTse): number {
  return CADENCIA_SEGUNDOS[cargo] * LIMIAR_EM_CADENCIAS;
}

/**
 * Os quatro estados de `dado_ts` (ADR-0038 D1 § "Compatibilidade de leitura").
 *
 * Quatro, e não três, porque `"fresco"` e `"parado"` são o mesmo estado de
 * **dado** com consequências de **tela** opostas — e o tipo discriminado é o
 * que impede um `if` esquecido de tratar "parado" como "fresco".
 *
 * O motivo de os quatro serem quatro não é purismo de tipo. Em 2026-09-12,
 * nesta mesma base, um conserto colapsou "não sei" em "é assim" numa prop
 * booleana e a tela publicou em produção uma afirmação sobre granularidade numa
 * página que não tinha dado nenhum (commit `e6fdb3c`). Foi achado olhando o
 * site no ar, não os testes. `"indisponivel"` (o produtor sabe e não tinha o
 * que pôr) e `"ausente"` (o produtor não conhece o campo) são exatamente o par
 * que um `??` funde.
 */
export type FrescorDado =
  | {
      /** `dado_ts` presente e dentro do limiar do cargo. Nada muda na tela. */
      estado: "fresco";
      dadoTs: string;
      lagSegundos: number;
      limiarSegundos: number;
      cargo: CargoTse;
    }
  | {
      /** `dado_ts` presente e além do limiar. Acende o banner de D4. */
      estado: "parado";
      dadoTs: string;
      lagSegundos: number;
      limiarSegundos: number;
      cargo: CargoTse;
    }
  | {
      /**
       * `dado_ts` presente e explicitamente `null` — nenhum boletim do ciclo
       * trouxe `dg`/`hg` parseável. **Nenhum banner de "parado"**: não há como
       * medir defasagem de um relógio que não existe neste ciclo. A
       * transparência cabível é o próprio texto dizer "indisponível"
       * (constituição § 8: melhor dizer que não sabemos do que inventar).
       */
      estado: "indisponivel";
      cargo: CargoTse;
    }
  | {
      /**
       * Chave ausente do payload — gravado por código anterior ao ADR-0038, ou
       * em voo durante o canary do Rolling Release (constituição § 7). A tela
       * se comporta como antes, com o texto associado a `ts`. Não é a correção
       * final, mas também não é uma mentira nova: é o mesmo grau de imprecisão
       * que já existia em produção, por uma janela de minutos em vez de
       * indefinidamente.
       */
      estado: "ausente";
      cargo: CargoTse;
    };

/**
 * Classifica o `dado_ts` de um payload.
 *
 * `undefined` e `null` são estados **diferentes**, e é por isso que o parâmetro
 * aceita os dois separadamente: `undefined` é "o produtor não conhece o campo"
 * (rollout), `null` é "o produtor conhece e não tinha o que pôr" (ciclo sem
 * `dg`/`hg` parseável). Colapsar os dois num `??` é o default silencioso que
 * este projeto já pagou caro para descobrir tarde — passe o campo **cru**.
 *
 * @param dadoTs   `payload.dado_ts`, sem coalescer.
 * @param cargo    Código do TSE; decide o limiar.
 * @param agoraMs  Injetável para teste. Em produção é a hora do servidor no
 *                 momento do render (ADR-0038 D4: o cálculo é do servidor, a
 *                 partir do número que já veio no JSON).
 */
export function avaliarFrescorDado(
  dadoTs: string | null | undefined,
  cargo: CargoTse,
  agoraMs: number = Date.now(),
): FrescorDado {
  if (dadoTs === undefined) return { estado: "ausente", cargo };
  if (dadoTs === null) return { estado: "indisponivel", cargo };

  const ms = Date.parse(dadoTs);
  // String presente mas impossível de datar cai em "indisponivel", não em
  // "ausente": o produtor CONHECE o campo (senão não o teria enviado), e cair
  // para o texto de `ts` aqui seria fabricar o substituto que D1 proíbe.
  if (!Number.isFinite(ms)) return { estado: "indisponivel", cargo };

  const limiarSegundos = limiarDadoParadoSegundos(cargo);
  // `Math.max(0, …)`: o relógio do boletim (BRT fixo −03:00, sem DST — ver
  // `calculateLagSeconds`, `lib/tse/metrics.ts`) e o do servidor podem
  // discordar por alguns segundos, e um lag negativo viraria "não avançam há
  // −1 minuto" na tela. Mesma classe de vazamento que o `data-lag-minutes` de
  // `DetailUnavailable.tsx` tinha (ADR-0038 D5).
  const lagSegundos = Math.max(0, Math.round((agoraMs - ms) / 1000));

  // O atraso só é COBRADO a partir do fechamento das urnas (04/10, decisão do
  // dono): antes das 17h do dia da eleição o TSE não publica apuração, e às
  // 17h01 o boletim zerado da véspera não está "parado há 20 horas". O
  // `lagSegundos` exibido continua sendo a idade real do dado.
  const inicio = inicioDaCobrancaDeAtraso(agoraMs);
  const atrasoCobrado =
    inicio === "antes-do-fechamento"
      ? 0
      : Math.max(0, Math.round((agoraMs - (inicio === null ? ms : Math.max(ms, inicio))) / 1000));

  return {
    // `>`, não `>=`: o limiar é o último valor ainda tolerado. Exatamente três
    // cadências é o pior caso previsto pelo próprio ADR-0011 (dois ciclos
    // perdidos), não um incidente.
    estado: atrasoCobrado > limiarSegundos ? "parado" : "fresco",
    dadoTs,
    lagSegundos,
    limiarSegundos,
    cargo,
  };
}

// ---------------------------------------------------------------------------
// Textos — um por estado, nunca um substituindo o outro em silêncio
// ---------------------------------------------------------------------------

/**
 * Rótulo primário de frescor, ADR-0038 D1 item 1: "Dado do TSE" **substitui**
 * "Última atualização" como o texto que o leitor vê. A palavra mudou porque o
 * número mudou de significado — manter o rótulo antigo sobre um valor novo
 * trocaria uma imprecisão por outra.
 */
export const ROTULO_DADO_TS = "Dado do TSE";

/**
 * O rótulo de hoje, preservado **só** para o estado `"ausente"` (payload
 * pré-ADR-0038). Continua descrevendo corretamente o que `ts` é: a hora da
 * nossa escrita.
 */
export const ROTULO_TS_LEGADO = "Última atualização";

/** Valor mostrado quando o ciclo não produziu hora do dado (estado `null`). */
export const VALOR_DADO_TS_INDISPONIVEL = "indisponível neste ciclo";

/**
 * O par rótulo/valor do carimbo de frescor, para as superfícies que exibem
 * frescor como **figura** (`<ApuracaoMeta>` e o `<Figure>` do design system).
 *
 * `ts` só é lido no estado `"ausente"` — é o fallback de rollout de D1 item 3,
 * e o único lugar do read path onde o relógio de escrita volta a aparecer como
 * frescor para o leitor.
 */
export function rotuloFrescorDado(
  frescor: FrescorDado,
  ts: string,
): { label: string; value: string } {
  switch (frescor.estado) {
    case "fresco":
    case "parado":
      return { label: ROTULO_DADO_TS, value: formatTimeHMS(frescor.dadoTs) };
    case "indisponivel":
      return { label: ROTULO_DADO_TS, value: VALOR_DADO_TS_INDISPONIVEL };
    case "ausente":
      return { label: ROTULO_TS_LEGADO, value: formatTimeHMS(ts) };
  }
}

/**
 * A mesma resolução em forma de **frase**, para as superfícies que já escrevem
 * o carimbo em prosa (as duas telas de Deputado Federal).
 *
 * O texto do estado `"ausente"` é literalmente o de hoje ("Atualizado às
 * HH:MM:SS") porque é isso que D1 item 3 manda: durante o canary, a tela se
 * comporta **como antes**, sem uma frase nova sobre um campo que o payload não
 * tem.
 */
export function fraseFrescorDado(frescor: FrescorDado, ts: string): string {
  switch (frescor.estado) {
    case "fresco":
    case "parado":
      return `${ROTULO_DADO_TS} às ${formatTimeHMS(frescor.dadoTs)}`;
    case "indisponivel":
      return `Hora do dado ${VALOR_DADO_TS_INDISPONIVEL}`;
    case "ausente":
      return `Atualizado às ${formatTimeHMS(ts)}`;
  }
}

/** "1 minuto" / "47 minutos" / "2 horas" / "3h20" — nunca "200 minutos". */
function humanizarDuracao(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  return `${horas}h${String(resto).padStart(2, "0")}`;
}

/**
 * "a cada minuto" / "a cada 5 minutos" / "a cada 30 minutos", derivado da mesma
 * tabela que produz o limiar — nunca um número escrito à mão no JSX (design 017
 * § D8: foi assim que quatro frases da tela de Senador viraram falsas em 11/09).
 */
export function textoCadencia(cargo: CargoTse): string {
  const minutos = CADENCIA_SEGUNDOS[cargo] / 60;
  return minutos === 1 ? "a cada minuto" : `a cada ${minutos} minutos`;
}

/**
 * O texto do banner de D4, **partido no único pedaço que muda com o tempo**.
 *
 * Três frases, e nenhuma é redundante. A primeira é o fato. A segunda existe
 * porque o ADR pede um texto **proporcional à cadência do cargo**, não o "60 s"
 * fixo herdado da spec 003: dizer "não avançam há 47 minutos" numa tela de
 * Deputado Federal, sem dizer que aquela corrida anda de 30 em 30 minutos,
 * deixa o leitor sem régua para julgar se 47 minutos é muito. A terceira é a
 * exigência da constituição § 7 e de RNF-010/RNF-012 — a página **continua**
 * mostrando o último valor conhecido, e precisa dizer isso em vez de deixar o
 * leitor supor que os números sumiram.
 *
 * A partição não é estética: `duracao` é a **única** parte que muda enquanto a
 * queda dura (`antes` e `depois` dependem só do cargo, que é fixo), e o banner
 * precisa poder isolá-la num nó próprio para tirá-la da live region — senão a
 * frase inteira é reanunciada a cada minuto, por horas. Ver a seção "A11y" de
 * `components/atoms/banners/DadoParadoBanner.tsx`.
 *
 * `antes` termina em espaço e `depois` começa em ponto **de propósito**: a
 * concatenação `antes + duracao + depois` tem de reproduzir a frase ao pé da
 * letra, que é o que `textoDadoParado` abaixo garante e o teste afere.
 */
export function partesDadoParado(frescor: Extract<FrescorDado, { estado: "parado" }>): {
  antes: string;
  duracao: string;
  depois: string;
} {
  return {
    antes: "Os dados do TSE não avançam há ",
    duracao: humanizarDuracao(frescor.lagSegundos),
    depois:
      `. Esta corrida é atualizada ${textoCadencia(frescor.cargo)}. ` +
      `A página segue mostrando o último apurado conhecido.`,
  };
}

/**
 * A mesma frase, inteira, para quem não precisa do recorte — o texto de
 * referência dos testes e de qualquer superfície futura em que o aviso seja uma
 * string só. Derivada de `partesDadoParado`, nunca escrita duas vezes: duas
 * cópias da mesma prosa são duas cópias que divergem.
 */
export function textoDadoParado(frescor: Extract<FrescorDado, { estado: "parado" }>): string {
  const { antes, duracao, depois } = partesDadoParado(frescor);
  return `${antes}${duracao}${depois}`;
}
