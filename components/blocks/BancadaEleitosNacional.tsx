"use client";

/**
 * components/blocks/BancadaEleitosNacional.tsx — spec 026 RF-299 e RF-300
 * (ADR-0063, emenda de 04/10 (2)).
 *
 * As ilhas cliente do painel "Bancada apurada — Quem fica com as cadeiras" da
 * capa `/deputado-federal`:
 *
 *   - {@link BancadaNacionalContexto} — envolve o painel e entrega às ilhas o
 *     que a PÁGINA leu no servidor: o interruptor da projeção (RF-265, o
 *     segundo ponto de leitura), o total de cadeiras e a cor de cada
 *     agremiação. Ao escolher "Projeção" (ou ao chegar nela, que é a base
 *     padrão do site) com a projeção ligada, é ele quem dispara a busca;
 *   - {@link BarraCenarioNacional} — a barra: a da parcial vem pronta do
 *     servidor (`children`); com o cenário na mão, ganha a versão do cenário
 *     sob `[data-view-only]` (cascata de `app/globals.css`) e o rótulo do
 *     misto;
 *   - {@link BancadaLinhaNacional} — uma por agremiação: o número (a parcial,
 *     e em "Projeção" o cenário em ocre com a parcial nomeada ao lado — a
 *     Decisão 5 do ADR-0063: o da projeção nunca substitui o da parcial), o
 *     botão "Ver os eleitos" e a lista aberta;
 *   - {@link CenarioSemLinha} — agremiação com cadeira no cenário e sem linha
 *     no painel (RF-300). Hoje não acontece — `bancada.por_agremiacao` lista
 *     toda agremiação de qualquer UF, inclusive com zero (`api/model/
 *     deputado_payload.py::_bancada_nacional`) —, mas os dois lados vêm de
 *     fontes diferentes (Edge Config e Blob) e podem ser de ciclos diferentes.
 *
 * ## Uma busca por aba, 60 s em memória
 *
 * A resposta de `GET /deputado-federal/eleitos` mora numa store de módulo,
 * compartilhada por todas as ilhas: abrir o PT e depois o PL faz UMA
 * requisição; ir para "Projeção" e depois abrir uma agremiação também. Vale
 * 60 s; a página se atualiza sozinha por `router.refresh()` (ADR-0074), o que
 * re-renderiza as ilhas, e o efeito SEM array de dependências revalida a
 * cada render — com a resposta fresca, não faz nada. A lista aberta continua
 * aberta e acompanha (RF-299). Falha bloqueia nova tentativa automática por
 * 60 s; "Ver os eleitos" e "Tentar de novo" forçam.
 *
 * ## Peso (o teto da capa NÃO sobe por esta emenda)
 *
 * O HTML por agremiação ganha só `<div data-acoes="">` (a reserva do botão).
 * O botão, a região e a lista só nascem no navegador, depois de montados; os
 * textos longos moram aqui, no JS, carregado uma vez. A lista aberta (selos,
 * avatar, formatação) é outro pedaço de JS, buscado no primeiro clique
 * (`next/dynamic`).
 *
 * ## Nada de projeção sem "não oficial" (RF-266) e nada no HTML do servidor
 *
 * O cenário só existe com a resposta da rota, que só chega no navegador: o
 * HTML que o servidor manda é a parcial, idêntico ao de antes da emenda. E
 * com a página dizendo "desligada", qualquer projeção da resposta é ignorada
 * (`visaoDoCenario`).
 */

import dynamic from "next/dynamic";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { VoteBar, type VoteBarSegment } from "@/components/atoms/bars/VoteBar";
import {
  type EleitosNacionais,
  FRASE_NENHUMA_LIBERADA,
  FRASE_PROJECAO_DESLIGADA,
  rotuloDoMisto,
  type VisaoDoCenario,
  visaoDoCenario,
} from "@/lib/deputado/eleitos-nacionais-visao";
import { useViewMode } from "@/lib/state/view-mode-client";

import estilos from "./BancadaEleitosNacional.module.css";

/** O endereço da rota — fora de `/api` (ADR-0065 D3, BotID). */
export const ROTA_ELEITOS_NACIONAIS = "/deputado-federal/eleitos";

/** Quanto a resposta vale em memória — o mesmo `s-maxage` da rota. */
export const VALIDADE_ELEITOS_MS = 60_000;

// ---------------------------------------------------------------------------
// A store — uma busca por aba (RF-299, RF-300)
// ---------------------------------------------------------------------------

export interface EstadoEleitosNacionais {
  dados: EleitosNacionais | null;
  /** `Date.now()` de quando `dados` chegou. */
  em: number;
  buscando: boolean;
  /** A última busca falhou: `sem_dado` (404 — nenhuma UF com dado) ou `erro`. */
  falha: "sem_dado" | "erro" | null;
  falhaEm: number;
}

const INICIAL: EstadoEleitosNacionais = {
  dados: null,
  em: 0,
  buscando: false,
  falha: null,
  falhaEm: 0,
};

let estado: EstadoEleitosNacionais = INICIAL;
const ouvintes = new Set<() => void>();

function publicar(parcial: Partial<EstadoEleitosNacionais>): void {
  estado = { ...estado, ...parcial };
  for (const ouvir of ouvintes) ouvir();
}

function assinar(ouvir: () => void): () => void {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

/** O estado da busca, para qualquer ilha. No servidor (e na hidratação), sempre o inicial. */
export function useEleitosNacionais(): EstadoEleitosNacionais {
  return useSyncExternalStore(
    assinar,
    () => estado,
    () => INICIAL,
  );
}

class SemDado extends Error {}

function ehEleitosNacionais(corpo: unknown): corpo is EleitosNacionais {
  if (typeof corpo !== "object" || corpo === null) return false;
  const c = corpo as Partial<EleitosNacionais>;
  return (
    Array.isArray(c.agremiacoes) &&
    Array.isArray(c.ufs_liberadas) &&
    Array.isArray(c.ufs_parcial) &&
    Array.isArray(c.ufs_tse) &&
    Array.isArray(c.ufs_sem_dado) &&
    typeof c.ufs_total === "number" &&
    typeof c.projecao_desligada === "boolean"
  );
}

async function buscar(): Promise<EleitosNacionais> {
  const resposta = await fetch(ROTA_ELEITOS_NACIONAIS);
  if (resposta.status === 404) throw new SemDado();
  if (!resposta.ok) throw new Error(`eleitos nacionais: HTTP ${resposta.status}`);
  const corpo: unknown = await resposta.json();
  if (!ehEleitosNacionais(corpo)) throw new Error("eleitos nacionais: corpo fora do contrato");
  return corpo;
}

/**
 * Busca a resposta se ela não está em memória, ou se já passou de 60 s. Uma
 * busca por vez. Depois de uma falha, só tenta de novo em 60 s — a não ser
 * que `forcar` (o clique do leitor). Com uma resposta anterior em memória, uma
 * falha NÃO a apaga: a tela segue com ela.
 */
export function garantirEleitosNacionais(forcar = false): void {
  if (estado.buscando) return;
  const agora = Date.now();
  if (estado.dados && agora - estado.em < VALIDADE_ELEITOS_MS) return;
  if (!forcar && estado.falha && agora - estado.falhaEm < VALIDADE_ELEITOS_MS) return;
  publicar({ buscando: true });
  buscar().then(
    (dados) => publicar({ dados, em: Date.now(), buscando: false, falha: null }),
    (e: unknown) =>
      publicar({
        buscando: false,
        falha: e instanceof SemDado ? "sem_dado" : "erro",
        falhaEm: Date.now(),
      }),
  );
}

/** Só para testes: devolve a store ao estado inicial. */
export function _reiniciarEleitosNacionais(): void {
  estado = INICIAL;
  ouvintes.clear();
}

const nuncaMuda = () => () => {};

/** `false` no servidor e na hidratação; `true` depois de montado. */
function useMontado(): boolean {
  return useSyncExternalStore(
    nuncaMuda,
    () => true,
    () => false,
  );
}

function useVisao(ligada: boolean): VisaoDoCenario | null {
  const { dados } = useEleitosNacionais();
  return useMemo(() => (dados ? visaoDoCenario(dados, ligada) : null), [dados, ligada]);
}

// ---------------------------------------------------------------------------
// O contexto — o que a página leu no servidor
// ---------------------------------------------------------------------------

/**
 * `[cod, cor]` — a cor de cada agremiação do painel, já resolvida pelo
 * servidor (ADR-0024). Um terceiro elemento `0` marca a agremiação SEM linha
 * na lista (a capa esconde quem tem zero na parcial — decisão do dono, 04/10):
 * a cor serve à barra do cenário, e {@link CenarioSemLinha} a acrescenta se
 * ela tiver cadeira no cenário.
 */
export type CorDaAgremiacao =
  | readonly [cod: string, cor: string]
  | readonly [cod: string, cor: string, semLinha: 0];

interface ContextoBancada {
  /** O interruptor da projeção que a PÁGINA leu agora (RF-265). */
  ligada: boolean;
  /** `bancada.total_cadeiras` — o denominador da barra. */
  total: number;
  /** As agremiações do painel, na ordem dele, com a cor. */
  cores: readonly CorDaAgremiacao[];
}

const Contexto = createContext<ContextoBancada>({ ligada: false, total: 0, cores: [] });

export interface BancadaNacionalContextoProps extends ContextoBancada {
  children: ReactNode;
}

/**
 * Envolve o painel. Na base "Projeção", com a projeção ligada, busca o
 * cenário (RF-300 — não depende de o leitor abrir uma agremiação). Efeito sem
 * array de dependências: a cada `router.refresh()` revalida (ADR-0074).
 */
export function BancadaNacionalContexto({
  ligada,
  total,
  cores,
  children,
}: BancadaNacionalContextoProps) {
  const modo = useViewMode();
  useEffect(() => {
    if (ligada && modo === "proj") garantirEleitosNacionais();
  });
  const valor = useMemo(() => ({ ligada, total, cores }), [ligada, total, cores]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

// ---------------------------------------------------------------------------
// A barra
// ---------------------------------------------------------------------------

/** O aviso curto de quando o cenário não está na tela — ou o rótulo do misto. */
function legendaDaBarra(
  ligada: boolean,
  st: EstadoEleitosNacionais,
  visao: VisaoDoCenario | null,
): string | null {
  if (!ligada) return FRASE_PROJECAO_DESLIGADA;
  if (visao) {
    if (!visao.ligada) return FRASE_PROJECAO_DESLIGADA;
    if (!visao.pronto) return FRASE_NENHUMA_LIBERADA;
    return `Cenário projetado nacional · projeção · não oficial, pontual: ${rotuloDoMisto(visao)}. A parcial de cada agremiação continua ao lado.`;
  }
  if (st.buscando) return "Carregando o cenário · projeção · não oficial…";
  if (st.falha === "sem_dado") {
    return "O cenário · projeção · não oficial ainda não está disponível — mostrando a parcial.";
  }
  if (st.falha === "erro") {
    return "Não deu para carregar o cenário · projeção · não oficial agora — mostrando a parcial.";
  }
  return null;
}

/** Os segmentos do cenário, na ordem do painel (a da parcial — ADR-0063 D5). */
function segmentosDoCenario(
  visao: VisaoDoCenario,
  cores: readonly CorDaAgremiacao[],
  total: number,
): { segmentos: VoteBarSegment[]; aguardando: number } {
  const segmentos: VoteBarSegment[] = [];
  const doPainel = new Set<string>();
  for (const [cod, cor] of cores) {
    doPainel.add(cod);
    const a = visao.porCod.get(cod);
    if (a && a.cenario > 0) {
      segmentos.push({ id: cod, label: a.sigla, pct: (a.cenario * 100) / total, color: cor });
    }
  }
  let soma = 0;
  for (const [cod, a] of visao.porCod) {
    soma += a.cenario;
    if (!doPainel.has(cod) && a.cenario > 0) {
      segmentos.push({
        id: cod,
        label: a.sigla,
        pct: (a.cenario * 100) / total,
        color: "var(--party-outros)",
      });
    }
  }
  const aguardando = total - soma;
  if (aguardando > 0) {
    segmentos.push({
      id: "aguardando",
      label: "aguardando apuração",
      pct: (aguardando * 100) / total,
      color: "var(--surface-sunken)",
    });
  }
  return { segmentos, aguardando };
}

/**
 * A barra do painel. `children` é a barra da parcial, pronta do servidor; sem
 * cenário ela fica como está. Com o cenário, as duas ficam no DOM, cada uma
 * sob `[data-view-only]` — a escondida sai da árvore de acessibilidade (RF-180).
 */
export function BarraCenarioNacional({ children }: { children: ReactNode }) {
  const { ligada, total, cores } = useContext(Contexto);
  const st = useEleitosNacionais();
  const visao = useVisao(ligada);
  const montado = useMontado();

  const legenda = montado ? legendaDaBarra(ligada, st, visao) : null;
  const cenario = visao?.pronto && total > 0 ? segmentosDoCenario(visao, cores, total) : null;

  return (
    <>
      {cenario && visao ? (
        <>
          <div data-view-only="parcial">{children}</div>
          <div data-view-only="proj" data-testid="bancada-barra-cenario">
            <VoteBar
              ariaLabel={`Cenário projetado nacional das ${total} cadeiras · projeção · não oficial, pontual (${rotuloDoMisto(visao)}): ${cenario.segmentos
                .filter((s) => s.id !== "aguardando")
                .map((s) => `${s.label} ${visao.porCod.get(String(s.id))?.cenario ?? 0}`)
                .join(
                  ", ",
                )}${cenario.aguardando > 0 ? `, ${cenario.aguardando} aguardando apuração` : ""}`}
              marker={null}
              segments={cenario.segmentos}
              showLabels={false}
            />
          </div>
        </>
      ) : (
        children
      )}
      {/* Reservada desde o servidor (vazia), para o aviso não empurrar a lista
          quando chegar; só na base "Projeção". */}
      <p
        data-view-only="proj"
        className={estilos.legendaBarra}
        data-testid="bancada-cenario-legenda"
      >
        {legenda}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A linha de cada agremiação
// ---------------------------------------------------------------------------

/** O número da parcial — a marcação de sempre do painel (RF-125.1; o (c0) mede a célula). */
function NumeroParcial({ cadeiras }: { cadeiras: number }) {
  return (
    <>
      <span data-testid="bancada-cadeiras">{cadeiras}</span>
      <span className="sr-only"> cadeiras conquistadas</span>
    </>
  );
}

const ESTILO_NUMERO = { font: "var(--type-figure-sm)", color: "var(--text-primary)" } as const;
const ESTILO_MEIO = { gap: "var(--space-1)" } as const;

/**
 * O rótulo do cenário de uma agremiação (RF-300): o número, "projeção · não
 * oficial", "pontual", o misto e a parcial COM O NOME DELA — tudo no mesmo
 * elemento (RF-266).
 */
function RotuloCenario({
  cenario,
  parcial,
  visao,
}: {
  cenario: number;
  parcial: number;
  visao: VisaoDoCenario;
}) {
  return (
    <span data-view-only="proj" className={estilos.rotuloCenario} data-testid="bancada-cenario">
      <b>{cenario}</b> no cenário · projeção · não oficial, pontual — {rotuloDoMisto(visao)} ·{" "}
      <b>{parcial}</b> na parcial
    </span>
  );
}

const Lista = dynamic(
  () => import("./BancadaEleitosNacionalLista").then((m) => m.BancadaEleitosNacionalLista),
  {
    ssr: false,
    loading: () => <p className={estilos.status}>Carregando os eleitos…</p>,
  },
);

export interface BancadaLinhaNacionalProps {
  /** A chave nacional da agremiação (`bancada.por_agremiacao[].cod`). */
  cod: string;
  /** A sigla inteira (exceção do dono para as capas de Deputados, 19/09). */
  sigla: string;
  /** A parcial, do payload nacional — o número que a linha sempre mostra. */
  cadeiras: number;
  /** O miolo da coluna do texto (sigla, nome, votos), renderizado no servidor. */
  identidade: ReactNode;
  /** A coluna da faixa (RF-127), renderizada no servidor. */
  faixa: ReactNode;
}

/**
 * O conteúdo de uma `<li>` da bancada (a grade de três colunas é da `<li>`):
 * número · texto · faixa, e numa segunda faixa da grade o botão "Ver os
 * eleitos" e a lista.
 */
export function BancadaLinhaNacional({
  cod,
  sigla,
  cadeiras,
  identidade,
  faixa,
}: BancadaLinhaNacionalProps) {
  const { ligada } = useContext(Contexto);
  const st = useEleitosNacionais();
  const visao = useVisao(ligada);
  const montado = useMontado();
  const modo = useViewMode();
  const [aberta, setAberta] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const regiaoId = useId();

  // Sem array de dependências DE PROPÓSITO: aberta, a lista acompanha cada
  // `router.refresh()` (ADR-0074). Com a resposta fresca, não faz nada.
  useEffect(() => {
    if (aberta) garantirEleitosNacionais();
  });

  const cenario = visao?.pronto ? visao.porCod.get(cod)?.cenario : undefined;

  function alternar() {
    if (!aberta) garantirEleitosNacionais(true);
    setAberta((v) => !v);
  }

  function recolher() {
    setAberta(false);
    botao.current?.focus();
  }

  const status = st.dados
    ? ""
    : st.buscando
      ? "Carregando os eleitos…"
      : st.falha === "sem_dado"
        ? "A lista de eleitos ainda não está disponível."
        : st.falha === "erro"
          ? "Não deu para carregar a lista agora."
          : "";

  return (
    <>
      <span style={ESTILO_NUMERO}>
        {cenario === undefined ? (
          <NumeroParcial cadeiras={cadeiras} />
        ) : (
          <>
            <span data-view-only="parcial">
              <NumeroParcial cadeiras={cadeiras} />
            </span>
            <span data-view-only="proj" className={estilos.numeroCenario}>
              <span data-testid="bancada-cadeiras-cenario">{cenario}</span>
              <span className="sr-only"> cadeiras no cenário · projeção · não oficial</span>
            </span>
          </>
        )}
      </span>

      <span className="min-w-0 flex flex-col" style={ESTILO_MEIO}>
        {identidade}
        {cenario !== undefined && visao ? (
          <RotuloCenario cenario={cenario} parcial={cadeiras} visao={visao} />
        ) : null}
      </span>

      {faixa}

      {/* A reserva do botão vem do servidor vazia (peso — ver o cabeçalho). */}
      <div data-acoes="">
        {montado ? (
          <button
            ref={botao}
            type="button"
            aria-expanded={aberta}
            aria-controls={regiaoId}
            onClick={alternar}
            data-testid="bancada-ver-eleitos"
          >
            {aberta ? "Esconder os eleitos" : "Ver os eleitos"}
            <span className="sr-only"> de {sigla}</span>
          </button>
        ) : null}
      </div>

      {montado ? (
        <div
          id={regiaoId}
          className={estilos.regiao}
          hidden={!aberta}
          data-testid="bancada-eleitos"
        >
          {aberta ? (
            <>
              <p className={estilos.status} role="status">
                {status}
              </p>
              {st.dados ? (
                <Lista dados={st.dados} ligada={ligada} cod={cod} sigla={sigla} modo={modo} />
              ) : null}
              <div className={estilos.acoesLista}>
                {!st.dados && st.falha && !st.buscando ? (
                  <button
                    type="button"
                    className={estilos.recolher}
                    onClick={() => garantirEleitosNacionais(true)}
                    data-testid="bancada-eleitos-tentar"
                  >
                    Tentar de novo
                  </button>
                ) : null}
                <button
                  type="button"
                  className={estilos.recolher}
                  onClick={recolher}
                  data-testid="bancada-eleitos-recolher"
                >
                  Recolher
                  <span className="sr-only"> os eleitos de {sigla}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Agremiação com cadeira no cenário e sem linha no painel (RF-300)
// ---------------------------------------------------------------------------

const ESTILO_LINHA = {
  gridTemplateColumns: "3rem minmax(0, 1fr) auto",
  columnGap: "var(--space-3)",
  padding: "var(--space-3) 0",
  borderBottom: "1px solid var(--border-hairline)",
} as const;

/**
 * Linhas acrescentadas ao fim da lista, só na base "Projeção": parcial zero,
 * com o rótulo do cenário. Por JS e não por `[data-view-only]` — a cascata
 * revela com `display: revert`, que numa `<li>` desfaria a grade.
 */
export function CenarioSemLinha() {
  const { ligada, cores } = useContext(Contexto);
  const visao = useVisao(ligada);
  const modo = useViewMode();
  if (!visao?.pronto || modo !== "proj") return null;
  const doPainel = new Set(cores.filter((c) => c.length === 2).map(([cod]) => cod));
  // Na ordem do painel (a da parcial), e depois as que ele nem conhece.
  const ordem = new Map(cores.map(([cod], i) => [cod, i]));
  const extras = [...visao.porCod]
    .filter(([cod, a]) => !doPainel.has(cod) && a.cenario > 0)
    .sort(([a], [b]) => (ordem.get(a) ?? cores.length) - (ordem.get(b) ?? cores.length));
  return (
    <>
      {extras.map(([cod, a]) => (
        <li
          key={cod}
          data-testid="bancada-linha-cenario"
          data-cod={cod}
          className="grid items-baseline"
          style={ESTILO_LINHA}
        >
          <span style={ESTILO_NUMERO}>
            <span className={estilos.numeroCenario}>{a.cenario}</span>
            <span className="sr-only"> cadeiras no cenário · projeção · não oficial</span>
          </span>
          <span className="min-w-0 flex flex-col" style={ESTILO_MEIO}>
            <span style={{ font: "var(--type-body-sm)" }}>{a.sigla}</span>
            <RotuloCenario cenario={a.cenario} parcial={0} visao={visao} />
          </span>
          <span />
        </li>
      ))}
    </>
  );
}
