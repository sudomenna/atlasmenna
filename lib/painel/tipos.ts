/**
 * lib/painel/tipos.ts
 *
 * O formato do **retrato** do painel privado (`/painel`, ADR-0077): um arquivo
 * JSON gerado UMA vez a partir do banco (`pnpm painel:retrato`) com tudo o que
 * o sistema fez numa noite de apuração. A página lê só este arquivo — nunca o
 * banco (ADR-0001).
 *
 * 🔴 O retrato é privado. Ele NÃO é commitado (o repositório é público) e vive
 * no Vercel Blob com `access: "private"`. Este módulo só tem tipos e
 * constantes; quem lê o arquivo é `lib/painel/ler.ts`, que NUNCA pode ser
 * importado por um arquivo `"use client"` (trava em
 * `tests/unit/painel/retrato-fora-do-cliente.test.ts`).
 *
 * Todos os horários são BRT (UTC−3 fixo — não há horário de verão desde 2019),
 * em ISO 8601 com o deslocamento explícito: `2026-10-04T19:07:00-03:00`.
 */

/** Versão do formato. Muda quando um campo muda de sentido ou some. */
export const VERSAO_RETRATO = 1 as const;

/** Caminho no Vercel Blob (privado). Sem sufixo aleatório: regravar substitui. */
export const PAINEL_BLOB_PATHNAME = "painel/retrato-1t-2026.json";

/**
 * Caminho local, relativo à raiz do repositório — sob `build/`, que o git
 * ignora. É o arquivo que `pnpm dev` lê (só em `NODE_ENV=development`).
 */
export const PAINEL_ARQUIVO_LOCAL = ["build", "painel", "retrato-1t-2026.json"] as const;

/** Deslocamento do horário de Brasília, em ms (UTC−3 fixo). */
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Os cargos que a ingestão cobriu, na ordem fixa de exibição. */
export const CARGOS_DO_PAINEL = [1, 3, 5, 6, 7, 8] as const;
export type CargoDoPainel = (typeof CARGOS_DO_PAINEL)[number];

/** Só estes gravam rodadas em `projections` (Deputado tem caminho próprio). */
export const CARGOS_COM_RODADA = [1, 3, 5] as const;

/** Chave de cargo nos mapas do JSON (as chaves de objeto JSON são texto). */
export type ChaveCargo = `${CargoDoPainel}`;

/** Uma série por cargo, alinhada ao eixo de minutos ({@link EixoMinutos}). */
export type SeriePorCargo = Record<ChaveCargo, number[]>;

export interface EixoMinutos {
  /** Primeiro minuto do eixo (BRT). O índice `i` de toda série é `inicio + i` minutos. */
  inicio: string;
  /** Quantidade de minutos — o tamanho de TODA série de {@link SeriesPorMinuto}. */
  minutos: number;
}

export interface SeriesPorMinuto {
  /**
   * Pedidos ao TSE **estimados**: o banco guarda só o total de pedidos de cada
   * ciclo, não a hora de cada pedido. O total é espalhado proporcionalmente
   * pelo intervalo `[fim − duração, fim]` do ciclo (ver `espalharPorMinuto`).
   */
  pedidosEstimados: SeriePorCargo;
  /** Arquivos do TSE que trouxeram novidade (linhas de `snapshots`) — exato. */
  novidades: SeriePorCargo;
  /** Ciclos concluídos, no minuto do FIM do ciclo. */
  ciclosConcluidos: SeriePorCargo;
  /** Erros do ciclo, no minuto do fim. */
  erros: SeriePorCargo;
  /** Arquivos que o TSE respondeu "não existe" (404), no minuto do fim. */
  naoEncontrados: SeriePorCargo;
  /** Pedidos que o TSE recusou por excesso (429), no minuto do fim. */
  bloqueios: SeriePorCargo;
  /** Segundos que o ciclo esperou de propósito para não passar do limite, no minuto do fim. */
  esperaSegundos: SeriePorCargo;
  /** Rodadas da projeção (uma rodada = um horário distinto em `projections`). */
  rodadasProjecao: SeriePorCargo;
}

/** Um ciclo de ingestão — um pedido em lote ao TSE para um cargo (e uma fatia). */
export interface CicloPainel {
  /** Início = `fim − duração` (ou o marcador de início, se o ciclo não terminou). */
  inicio: string;
  /** `null` = o ciclo começou e não deixou registro de fim (interrompido). */
  fim: string | null;
  cargo: CargoDoPainel;
  /** Fatia do Deputado Federal (1 a 6); `null` nos outros cargos. */
  fatia: number | null;
  duracaoS: number | null;
  pedidos: number | null;
  novidades: number | null;
  inalterados: number | null;
  naoEncontrados: number | null;
  erros: number | null;
  bloqueios: number | null;
  esperaS: number | null;
  modeloAcionado: boolean;
  /** Motivo do abandono, quando o ciclo saiu cedo (`notes.aborted`). */
  abortado: string | null;
}

/** Uma rodada da projeção: um horário distinto em `projections` para um cargo. */
export interface RodadaPainel {
  cargo: CargoDoPainel;
  hora: string;
  /** Hora do boletim do TSE usado na rodada (ADR-0038); `null` se ilegível. */
  horaDoBoletim: string | null;
}

/** Projeção de um cargo parada por mais tempo que o limite. */
export interface BuracoProjecao {
  cargo: CargoDoPainel;
  /** Última rodada antes do buraco. */
  de: string;
  /** Primeira rodada depois do buraco. */
  ate: string;
  minutos: number;
  /** Ciclos que pediram a projeção dentro do buraco. */
  acionamentos: number;
  /** Desses, quantos não produziram rodada nenhuma. */
  acionamentosSemRodada: number;
  /**
   * `"falha"` — o modelo foi chamado e não gravou;
   * `"sem-novidade"` — nenhum ciclo pediu projeção (o TSE não mudou nada).
   */
  tipo: "falha" | "sem-novidade";
}

/** Uma sequência de ciclos (cargo, fatia) parada por mais que o dobro do intervalo normal. */
export interface BuracoCiclos {
  cargo: CargoDoPainel;
  fatia: number | null;
  de: string;
  ate: string;
  minutos: number;
  /** Intervalo mediano entre dois fins de ciclo dessa sequência, em minutos. */
  medianaMinutos: number;
}

/** Arquivo do TSE cuja última versão guardada na noite ficou incompleta. */
export interface ArquivoParado {
  cargo: CargoDoPainel;
  nivel: "zona" | "uf" | "br";
  uf: string;
  codMunicipioTse: number;
  municipio: string | null;
  zona: number;
  /** Hora da última novidade guardada deste arquivo. */
  ultimaNovidade: string;
  secoesTotalizadas: number;
  secoesTotal: number;
}

/**
 * Episódio de bloqueio pelo TSE (respostas 429 — "pedidos demais").
 *
 * O contador de bloqueios é do PROCESSO, não do ciclo
 * (`lib/tse/client.ts::getClientStats`): dois ciclos rodando ao mesmo tempo na
 * mesma máquina relatam o MESMO número. Por isso o episódio junta os ciclos
 * que se sobrepõem no tempo e dá uma faixa honesta, não um total inventado.
 */
export interface EpisodioBloqueio {
  de: string;
  ate: string;
  /** Menor total possível: o maior valor relatado por um ciclo do episódio. */
  minimo: number;
  /** Maior total possível: a soma do que cada ciclo relatou. */
  maximo: number;
  ciclos: { cargo: CargoDoPainel; fatia: number | null; bloqueios: number }[];
}

export interface PontoApurado {
  hora: string;
  /** 0–100. */
  pct: number;
}

/** Correção publicada no código (commit), com a hora do REGISTRO — não a hora em que entrou no ar. */
export interface CorrecaoPainel {
  hash: string;
  hora: string;
  titulo: string;
}

export interface TotaisCargo {
  cargo: CargoDoPainel;
  ciclos: number;
  interrompidos: number;
  pedidos: number;
  /** Linhas de `snapshots` (arquivos com novidade) — exato. */
  novidades: number;
  erros: number;
  naoEncontrados: number;
  bloqueios: number;
  esperaS: number;
  duracaoMedianaS: number | null;
  duracaoMaximaS: number | null;
  /** Ciclos com mais de 300 s (a cadência de 5 minutos). */
  ciclosAcimaDe300s: number;
  /** `null` para os cargos que não gravam rodada (Deputado). */
  rodadas: number | null;
}

export interface RetratoPainel {
  versao: typeof VERSAO_RETRATO;
  geradoEm: string;
  turno: number;
  janela: { de: string; ate: string };
  eixo: EixoMinutos;
  cargos: { cd: CargoDoPainel; nome: string }[];
  porMinuto: SeriesPorMinuto;
  ciclos: CicloPainel[];
  rodadas: RodadaPainel[];
  buracosProjecao: BuracoProjecao[];
  buracosCiclos: BuracoCiclos[];
  arquivosParados: ArquivoParado[];
  episodiosDeBloqueio: EpisodioBloqueio[];
  apuradoPresidente: {
    /** Σ seções totalizadas das UFs ÷ total — a conta que o site exibia. */
    somaDosEstados: PontoApurado[];
    /** O arquivo nacional do TSE (`br`), que atrasava em relação às UFs. */
    arquivoBrasil: PontoApurado[];
  };
  correcoes: CorrecaoPainel[];
  totais: TotaisCargo[];
  fonte: {
    gitRef: string;
    linhasIgnoradas: number;
    janelaCorrecoes: { de: string; ate: string };
  };
}
