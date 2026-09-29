"use client";

/**
 * components/blocks/DeputadoListaAgremiacao.tsx — spec 026 (RF-260, RF-261,
 * RF-272), ADR-0065, design 026 § 8.2–8.3.
 *
 * A lista de candidatos de UMA agremiação (partido ou federação) numa UF, em
 * três faixas:
 *
 *   1. posições 1–20 ........ visíveis;
 *   2. 21–60 (e toda linha com marca que o produtor tenha posto no objeto) —
 *      no documento, recortadas por CSS até o leitor pedir ("ver mais"). Nenhum
 *      nó sai do DOM, da árvore de acessibilidade ou da busca da página
 *      (ADR-0034 D21, ADR-0065 D1);
 *   3. 61 em diante ......... fora do documento; buscadas UMA vez por aba e por
 *      UF na rota `GET /uf/<UF>/deputado-federal/lista`, só no clique.
 *
 * ## Por que cliente, e por que tuplas
 *
 * As linhas chegam como {@link LinhaCompacta} (`lib/utils/deputado-marcas.ts`)
 * — posição fixa, marcas já derivadas no servidor — e são montadas AQUI. Se
 * chegassem como `children` pré-renderizados (o molde do
 * `<CandidateListCollapse>`), o dado sairia duas vezes no documento de SP: no
 * HTML e no payload RSC (o defeito medido no `/governador`, ADR-0065 D5). A
 * resposta da rota 61+ passa pela MESMA `paraLinhaCompacta`; as funções de
 * exibição do nome e da sigla entram por `import()` no clique, para não pesar
 * no bundle de quem nunca clica.
 *
 * ## A ordem nunca é decidida aqui
 *
 * `rank` do produtor (voto apurado). Nem marca nem projeção reordenam
 * (constituição § 2, ADR-0063 D5). A união com a faixa 3 é por `sqcand` —
 * nunca duplica — e reaplica a ordem do próprio `rank`.
 */

import { useEffect, useId, useRef, useState } from "react";

import { DestinoDeputadoTexto, MarcaDeputado } from "@/components/atoms/badges/MarcaDeputado";
import { Button } from "@/components/atoms/controls/Button";
import type { DeputadoUfLista } from "@/lib/blob/deputado-uf";
import {
  destinoDoCodigo,
  type ExibicaoLinha,
  fraseCorte,
  L,
  type LinhaCompacta,
  marcasDosBits,
  ordenarPorRank,
  paraLinhaCompacta,
  unirPorSqcand,
} from "@/lib/utils/deputado-marcas";
import { formatPercent, formatTimeHMS, formatVotes } from "@/lib/utils/format";

import styles from "./DeputadoListaAgremiacao.module.css";

/** Posições visíveis sem clique (ADR-0065 D1). */
export const FAIXA_VISIVEL = 20;

/** Última posição que o objeto da UF traz sem clique; daí em diante é a rota 61+. */
export const FAIXA_DOCUMENTO = 60;

/** O `corte` da agremiação, compacto (design § 2.3). */
export interface CorteCompacto {
  /** `sqcand` do último eleito na parcial — a linha de corte entra logo depois dela. */
  ultimoEleito: number;
  primeiroFora: number;
  diferenca: number;
  abaixoPiso10: boolean;
}

export interface DeputadoListaAgremiacaoProps {
  uf: string;
  /** Código da agremiação — chave para achar as linhas dela na resposta 61+. */
  cod: string;
  /** Sigla exibida da agremiação, para os nomes acessíveis ("PL", "PT/PC do B/PV"). */
  sigla: string;
  /** As linhas do objeto da UF, na ordem do `rank`. */
  linhas: readonly LinhaCompacta[];
  /** `total_candidatos` da agremiação (objeto + lista 61+). Ausente no objeto v1. */
  totalCandidatos?: number;
  /** `detail.lista.restantes > 0` — a UF tem lista 61+ publicada. */
  haListaRestante: boolean;
  /** Linha de corte da parcial (RF-272). `null` sem corte ou com totalização final. */
  corte?: CorteCompacto | null;
  /** Para derivar as marcas das linhas que chegam pela rota 61+ — mesma precedência. */
  totalizacaoFinal: boolean;
  projecaoVisivel: boolean;
  /** Federação: a coluna do partido existe. Partido isolado: não. */
  mostrarPartido: boolean;
  /** `ts` do objeto da UF — a lista 61+ de outro ciclo ganha o aviso das duas horas (ADR-0065 D4). */
  tsDetalhe: string;
  /** Objeto v1: a legenda da coluna não promete % nem número (RF-276). */
  semPercentual?: boolean;
}

// ---------------------------------------------------------------------------
// A busca da faixa 3 — uma vez por aba, por UF (RF-260)
// ---------------------------------------------------------------------------

/**
 * Cache em memória por UF. Guarda a PROMESSA, para que duas agremiações da
 * mesma UF clicadas em sequência (ou um segundo clique durante a busca)
 * dividam uma requisição só. Falha sai do cache — "tentar de novo" busca de
 * verdade.
 */
const cacheListas = new Map<string, Promise<DeputadoUfLista>>();

/** Só para testes: zera o cache entre casos. */
export function _limparCacheListas(): void {
  cacheListas.clear();
}

function ehLista(corpo: unknown, uf: string): corpo is DeputadoUfLista {
  if (typeof corpo !== "object" || corpo === null) return false;
  const c = corpo as Partial<DeputadoUfLista>;
  return (
    typeof c.ts === "string" &&
    typeof c.uf === "string" &&
    c.uf.toUpperCase() === uf.toUpperCase() &&
    Array.isArray(c.agremiacoes)
  );
}

function buscarLista(uf: string): Promise<DeputadoUfLista> {
  const chave = uf.toUpperCase();
  const emCache = cacheListas.get(chave);
  if (emCache) return emCache;
  const promessa = (async () => {
    const resposta = await fetch(`/uf/${chave}/deputado-federal/lista`);
    if (!resposta.ok) throw new Error(`lista 61+: HTTP ${resposta.status}`);
    const corpo: unknown = await resposta.json();
    if (!ehLista(corpo, chave)) throw new Error("lista 61+: corpo fora do contrato");
    return corpo;
  })();
  cacheListas.set(chave, promessa);
  promessa.catch(() => {
    if (cacheListas.get(chave) === promessa) cacheListas.delete(chave);
  });
  return promessa;
}

async function funcoesDeExibicao(mostrarPartido: boolean): Promise<ExibicaoLinha> {
  const [{ nomeExibicao }, { siglaExibicao }] = await Promise.all([
    import("@/lib/utils/nome-candidato"),
    import("@/lib/utils/sigla-partido"),
  ]);
  return { nome: nomeExibicao, partido: siglaExibicao, mostrarPartido };
}

type EstadoBusca =
  | { fase: "ociosa" }
  | { fase: "buscando" }
  | { fase: "pronta"; chegaram: number; tsLista: string }
  | { fase: "erro" };

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

export function DeputadoListaAgremiacao({
  uf,
  cod,
  sigla,
  linhas: linhasIniciais,
  totalCandidatos,
  haListaRestante,
  corte,
  totalizacaoFinal,
  projecaoVisivel,
  mostrarPartido,
  tsDetalhe,
  semPercentual = false,
}: DeputadoListaAgremiacaoProps) {
  const listaId = useId();
  const listaRef = useRef<HTMLOListElement>(null);
  const [aberta, setAberta] = useState(false);
  // A ordem é a do `rank` — reaplicada aqui, e não herdada da ordem de chegada.
  const [linhas, setLinhas] = useState<readonly LinhaCompacta[]>(() =>
    ordenarPorRank(linhasIniciais),
  );
  const [busca, setBusca] = useState<EstadoBusca>({ fase: "ociosa" });
  /**
   * Quem recebe o foco depois da busca: o `sqcand` da primeira linha nova, ou
   * `"lista"` — a própria `<ol>` — quando a busca não acrescentou ninguém.
   *
   * 🔴 O botão "mostrar todos" SAI do documento quando a busca termina (não há
   * mais o que buscar). Com o foco nele e sem linha nova para recebê-lo, o
   * foco caía no `<body>` e o leitor de teclado voltava ao topo da página. A
   * lista é o alvo estável: é o que o botão controla (`aria-controls`) e ela
   * nunca sai do documento.
   */
  const [focoEm, setFocoEm] = useState<number | "lista" | null>(null);

  useEffect(() => {
    if (focoEm === null) return;
    if (focoEm === "lista") {
      listaRef.current?.focus();
      return;
    }
    listaRef.current?.querySelector<HTMLLIElement>('li[tabindex="-1"]')?.focus();
  }, [focoEm]);

  const naFaixa2 = linhas.filter((l) => l[L.RANK] > FAIXA_VISIVEL).length;
  const restantes =
    haListaRestante && typeof totalCandidatos === "number" && busca.fase !== "pronta"
      ? Math.max(0, totalCandidatos - linhas.length)
      : 0;

  async function mostrarTodos() {
    // Durante a busca o botão fica `aria-disabled`, e não `disabled`:
    // `disabled` tira o foco do botão que o tem e o joga no `<body>`. O
    // atributo não bloqueia nada sozinho — este `return` é que ignora o clique.
    if (busca.fase === "buscando") return;
    setAberta(true);
    setBusca({ fase: "buscando" });
    try {
      const [lista, exibicao] = await Promise.all([
        buscarLista(uf),
        funcoesDeExibicao(mostrarPartido),
      ]);
      const daAgremiacao = lista.agremiacoes.find((a) => a.cod === cod)?.candidatos ?? [];
      const ctx = { totalizacaoFinal, projecaoVisivel };
      const novas = daAgremiacao.map((l) => paraLinhaCompacta(l, ctx, exibicao));
      const { linhas: unidas, acrescentadas } = unirPorSqcand(linhas, novas);
      setLinhas(unidas);
      setBusca({ fase: "pronta", chegaram: acrescentadas.length, tsLista: lista.ts });
      const primeira = [...acrescentadas].sort((a, b) => a[L.RANK] - b[L.RANK])[0];
      setFocoEm(primeira ? primeira[L.SQCAND] : "lista");
    } catch {
      setBusca({ fase: "erro" });
    }
  }

  const nomePorSq = new Map(linhas.map((l) => [l[L.SQCAND], l[L.NOME]] as const));
  const textoCorte = corte
    ? fraseCorte(
        { diferenca: corte.diferenca, primeiro_fora_abaixo_piso_10: corte.abaixoPiso10 },
        { ultimo: nomePorSq.get(corte.ultimoEleito), primeiro: nomePorSq.get(corte.primeiroFora) },
      )
    : null;

  const buscando = busca.fase === "buscando";
  const status =
    busca.fase === "buscando"
      ? "Carregando os demais candidatos…"
      : busca.fase === "pronta"
        ? busca.chegaram === 0
          ? `Nenhum candidato a mais de ${sigla} para mostrar.`
          : `${busca.chegaram} ${busca.chegaram === 1 ? "candidato carregado" : "candidatos carregados"}.`
        : busca.fase === "erro"
          ? "Não conseguimos carregar os demais candidatos agora. As posições que já estavam na página continuam aqui."
          : "";
  const avisoCiclos =
    busca.fase === "pronta" && busca.chegaram > 0 && busca.tsLista !== tsDetalhe
      ? `As posições a partir da ${FAIXA_DOCUMENTO + 1}ª vêm do cálculo gravado às ${formatTimeHMS(busca.tsLista)}; as anteriores, do das ${formatTimeHMS(tsDetalhe)}. Entre os dois a fronteira pode ter mudado.`
      : null;

  const itens: React.ReactElement[] = [];
  for (const l of linhas) {
    const rank = l[L.RANK];
    const destino = destinoDoCodigo(l[L.DESTINO]);
    const pct = l[L.PCT];
    const numero = l[L.NUMERO];
    const partido = l[L.PARTIDO];
    const meta = [numero === null ? null : `nº ${numero}`, partido || null]
      .filter(Boolean)
      .join(" · ");
    itens.push(
      <li
        key={l[L.SQCAND]}
        data-rank={rank}
        data-f={rank > FAIXA_VISIVEL ? "" : undefined}
        tabIndex={focoEm === l[L.SQCAND] ? -1 : undefined}
      >
        <span>{rank}º</span>
        <span>
          <b>{l[L.NOME]}</b>
          {meta ? <small>{meta}</small> : null}
          {marcasDosBits(l[L.MARCAS]).map((m) => (
            <MarcaDeputado key={m.tipo} marca={m} />
          ))}
        </span>
        <span>
          {formatVotes(l[L.VOTOS])}
          {destino ? (
            <small>
              {/* "Válido (legenda)": o % é verdadeiro e vem numérico (ADR-0064,
                  emenda); anulado e sub judice chegam com `pct` nulo. */}
              {pct !== null ? `${formatPercent(pct, 2)} · ` : null}
              <DestinoDeputadoTexto destino={destino} />
            </small>
          ) : pct !== null ? (
            <small>{formatPercent(pct, 2)}</small>
          ) : semPercentual ? null : (
            <small>—</small>
          )}
        </span>
      </li>,
    );
    if (textoCorte && l[L.SQCAND] === corte?.ultimoEleito) {
      itens.push(
        <li
          key="corte"
          data-corte=""
          data-f={rank > FAIXA_VISIVEL ? "" : undefined}
          data-testid="dep-corte"
        >
          {textoCorte}
        </li>,
      );
    }
  }

  return (
    <div className={styles.agremiacao} data-testid="dep-lista-agremiacao" data-cod={cod}>
      <p className={styles.legendaColunas}>
        {semPercentual
          ? "Por votos apurados: posição, candidato e votos."
          : `Por votos apurados: posição, candidato, número de urna${mostrarPartido ? ", partido" : ""}, votos e % dos válidos de ${uf}.`}
      </p>

      <ol
        ref={listaRef}
        id={listaId}
        className={styles.lista}
        data-collapsed={aberta ? "false" : "true"}
        aria-busy={buscando || undefined}
        aria-label={`Candidatos de ${sigla} em ${uf}, por votos apurados`}
        // Alvo de foco só quando a busca não trouxe linha (ver `focoEm`); fora
        // da ordem de tabulação sempre.
        tabIndex={focoEm === "lista" ? -1 : undefined}
      >
        {itens}
      </ol>

      <p className={styles.status} role="status">
        {status}
      </p>
      {avisoCiclos ? <p className={styles.status}>{avisoCiclos}</p> : null}

      {naFaixa2 > 0 || restantes > 0 ? (
        <div className={styles.acoes}>
          {naFaixa2 > 0 ? (
            <Button
              variant="secondary"
              size="md"
              aria-controls={listaId}
              aria-expanded={aberta}
              onClick={() => setAberta((v) => !v)}
              data-testid="dep-ver-mais"
            >
              {aberta
                ? "Mostrar menos"
                : `Ver mais ${naFaixa2} ${naFaixa2 === 1 ? "candidato" : "candidatos"} de ${sigla}`}
            </Button>
          ) : null}
          {restantes > 0 ? (
            <Button
              variant="ghost"
              size="md"
              aria-controls={listaId}
              aria-disabled={buscando}
              onClick={mostrarTodos}
              data-testid="dep-mostrar-todos"
            >
              {busca.fase === "erro"
                ? "Tentar de novo"
                : `Mostrar todos os ${totalCandidatos} candidatos de ${sigla}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
