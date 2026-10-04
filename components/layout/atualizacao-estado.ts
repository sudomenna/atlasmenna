/**
 * components/layout/atualizacao-estado.ts
 *
 * Contrato da atualização automática das páginas de apuração (04/10/2026,
 * decisão do dono: "atualização automática para todos os visitantes").
 *
 * Dois consumidores, e só eles:
 *   - `<AtualizacaoAutomatica>` (shell, `app/layout.tsx`) — chama
 *     `router.refresh()` a cada minuto;
 *   - `<PausaAtualizacao>` (no `<Footer>` de cada página) — o controle
 *     "Pausar / Retomar" que a WCAG 2.2.2 exige de todo conteúdo que se
 *     atualiza sozinho (constituição § 4).
 *
 * ## Por que um módulo à parte, sem React e sem `"use client"`
 *
 * Os dois componentes precisam ler e escrever o MESMO estado de pausa, e o
 * evento `storage` do navegador NÃO dispara na aba que escreveu — só nas
 * outras. Daí um `CustomEvent` próprio, publicado por `gravarPausada`, que a
 * mesma aba escuta. Uma store em `zustand` faria o mesmo, mas puxaria a
 * biblioteca para o JS do shell em TODAS as rotas (RNF-007a); isto aqui são
 * algumas dezenas de linhas.
 *
 * Sem `"use client"` de propósito: não exporta componente, e uma diretiva aqui
 * transformaria as constantes em referências de cliente se algum Server
 * Component as importasse (a armadilha documentada em
 * `components/blocks/_lista-por-base.ts`). Mora em `components/layout/` e não
 * em `@/lib` pelo mesmo motivo do caso (c2) de
 * `tests/unit/shell/static-shell.test.ts`: o layout não deve alcançar módulo
 * de `@/lib` que dependa de DOM/React.
 *
 * ## Por que `localStorage` e nunca cookie
 *
 * O mesmo do tema (ADR-0025 § 5): cookie exigiria `cookies()` no servidor e
 * tiraria rotas do pré-render. A pausa é preferência do visitante, vive no
 * navegador dele e não é PII (constituição § 5) — a chave guarda a string
 * `"pausada"` ou nada.
 */

/** Intervalo-base entre duas atualizações. */
export const ATUALIZACAO_INTERVALO_MS = 60_000;

/**
 * Atraso aleatório somado a cada intervalo (0 a 15 s). Sem ele, todas as abas
 * abertas no mesmo minuto — o fechamento das urnas às 17h — atualizariam em
 * fila indiana no mesmo segundo, para sempre.
 */
export const ATUALIZACAO_JITTER_MS = 15_000;

/** Chave do `localStorage`. */
export const ATUALIZACAO_STORAGE_KEY = "atlas:atualizacao";

/** Único valor gravado. Ausência da chave = atualização ligada. */
export const ATUALIZACAO_VALOR_PAUSADA = "pausada";

/** Evento da MESMA aba (o `storage` só chega às outras). */
export const ATUALIZACAO_EVENTO = "atlas:atualizacao";

/**
 * As rotas que se atualizam sozinhas — lista de PERMITIDAS, não de proibidas:
 * rota nova não ganha atualização sem alguém decidir.
 *
 *   /                                       Presidente (nacional)
 *   /governador /senador
 *   /deputado-federal /deputado-estadual    capas de cargo
 *   /uf/XX                                  Presidente na UF
 *   /uf/XX/(governador|senador|deputado-federal|deputado-estadual|deputado-distrital)
 *
 * Ficam de fora `/candidatos`, `/sobre-o-modelo`, `/sobre-as-etiquetas`,
 * `/manutencao` e qualquer rota de API — nada nelas muda durante a apuração.
 * Barra final opcional.
 */
export const ROTAS_COM_ATUALIZACAO =
  /^\/(?:(?:governador|senador|deputado-federal|deputado-estadual|uf\/[A-Za-z]{2}(?:\/(?:governador|senador|deputado-federal|deputado-estadual|deputado-distrital))?)\/?)?$/;

export function rotaComAtualizacao(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && ROTAS_COM_ATUALIZACAO.test(pathname);
}

/**
 * `navigator.connection.saveData` — o visitante pediu ao navegador para
 * economizar dados. Atualizar a cada minuto contraria o pedido.
 */
export function economiaDeDados(): boolean {
  if (typeof navigator === "undefined") return false;
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conexao?.saveData === true;
}

/**
 * Valor em memória quando o `localStorage` lança (janela anônima com storage
 * bloqueado): a pausa vale para a sessão e some no reload — melhor que um
 * botão que não faz nada. `null` = sem valor em memória, ler do storage.
 */
let pausadaEmMemoria: boolean | null = null;

export function lerPausada(): boolean {
  if (pausadaEmMemoria !== null) return pausadaEmMemoria;
  try {
    return localStorage.getItem(ATUALIZACAO_STORAGE_KEY) === ATUALIZACAO_VALOR_PAUSADA;
  } catch {
    return false;
  }
}

export function gravarPausada(pausada: boolean): void {
  pausadaEmMemoria = pausada;
  try {
    if (pausada) localStorage.setItem(ATUALIZACAO_STORAGE_KEY, ATUALIZACAO_VALOR_PAUSADA);
    else localStorage.removeItem(ATUALIZACAO_STORAGE_KEY);
    // Gravou: o storage volta a ser a fonte, e uma mudança vinda de outra aba
    // (evento `storage`) passa a valer aqui também.
    pausadaEmMemoria = null;
  } catch {
    // Storage indisponível — fica o valor em memória.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ATUALIZACAO_EVENTO));
  }
}

/**
 * Assina mudanças na pausa: as desta aba (`CustomEvent`) e as de outras abas
 * (`storage`). Formato de `subscribe` do `useSyncExternalStore`.
 */
export function assinarPausa(aoMudar: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const aoStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== ATUALIZACAO_STORAGE_KEY) return;
    pausadaEmMemoria = null;
    aoMudar();
  };
  window.addEventListener(ATUALIZACAO_EVENTO, aoMudar);
  window.addEventListener("storage", aoStorage);
  return () => {
    window.removeEventListener(ATUALIZACAO_EVENTO, aoMudar);
    window.removeEventListener("storage", aoStorage);
  };
}

/** Só para testes. */
export function __resetAtualizacaoForTests(): void {
  pausadaEmMemoria = null;
  try {
    localStorage.removeItem(ATUALIZACAO_STORAGE_KEY);
  } catch {
    // nada
  }
}
