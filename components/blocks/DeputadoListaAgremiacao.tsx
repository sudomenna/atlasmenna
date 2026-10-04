"use client";

/**
 * components/blocks/DeputadoListaAgremiacao.tsx — spec 026 (RF-260, RF-261,
 * RF-272), ADR-0065, design 026 § 8.2–8.3.
 *
 * A lista de candidatos de UMA agremiação (partido ou federação) numa UF, em
 * três faixas:
 *
 *   1. o conjunto VISÍVEL POR PADRÃO — rank ≤ maior rank eleito + 7
 *      (`ultimoRankVisivelDasTuplas`; emenda 04/10, decisão do dono:
 *      "eleitos + 7"). Até 03/10 eram as posições 1–20;
 *   2. o resto das posições 1–60 (e toda linha com marca que o produtor tenha
 *      posto no objeto) — no documento, recortadas por CSS (`li[data-f]`) até
 *      o leitor pedir ("Mais N candidatos"). Nenhum nó sai do DOM, da árvore
 *      de acessibilidade ou da busca da página (ADR-0034 D21, ADR-0065 D1) —
 *      com UMA exceção declarada, a do `content-visibility: auto` nas
 *      agremiações longe da tela (decisão do dono, 30/09; ver o CSS Module).
 *      Se eleitos + 7 passa de 60, tudo o que está no documento fica visível;
 *   3. 61 em diante ......... fora do documento; buscadas UMA vez por aba, por
 *      cargo e por UF na rota `GET /uf/<UF>/<slug do cargo>/lista` (a
 *      {@link DeputadoListaAgremiacaoProps.rotaLista}), só no clique.
 *
 * ## Duas faixas — as assembleias (spec 027, decisão do dono de 03/10)
 *
 * Com {@link DeputadoListaAgremiacaoProps.duasFaixas} (cargos 7 e 8), a página
 * já cortou as linhas: por agremiação, o MESMO conjunto visível por padrão,
 * eleitos + 7 (`lib/deputado/lista-documento.ts`). Todas ficam VISÍVEIS — nada recortado
 * por CSS, nenhum "ver mais" —, e "mostrar todos" busca o RESTO na rota da
 * casa (tudo o que não está no documento, e não só 61+). A busca, o cache por
 * rota, o foco na primeira linha nova, `aria-busy`, a região viva e o "tentar
 * de novo" são os mesmos. O federal (sem a prop) segue nas três faixas.
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
 * ## Uma base por vez (decisão do dono, 04/10)
 *
 * As marcas seguem o seletor global Parcial/Projeção: na "Parcial" só "eleito
 * na parcial" (com "sobra apertada") e a linha de corte; na "Projeção" só
 * "eleito na projeção · não oficial" (com "apertada") e o voto projetado.
 * "Eleito (TSE)" nas duas. Com a projeção visível (`separaBases`) a `<ol>`
 * leva `data-proj` e o CSS Module esconde a base inativa por `display: none`
 * — fora da árvore de acessibilidade —, lendo ganchos que JÁ estão no markup
 * (`data-marca` da pílula, `data-corte`, o segundo `<small>` dos números).
 * Zero byte por linha, de propósito: `data-view-only` em cada pílula e em
 * cada voto projetado foi medido no pior caso de SP e estourava o teto das
 * listas (ver o teste de peso). Sem projeção visível, nada se esconde: as
 * marcas da parcial valem nas duas bases, e a legenda da página dá o aviso.
 *
 * ## A ordem nunca é decidida aqui
 *
 * `rank` do produtor (voto apurado). Nem marca nem projeção reordenam
 * (constituição § 2, ADR-0063 D5). A união com a faixa 3 é por `sqcand` —
 * nunca duplica — e reaplica a ordem do próprio `rank`.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { DestinoDeputadoTexto, MarcaDeputado } from "@/components/atoms/badges/MarcaDeputado";
import { Button } from "@/components/atoms/controls/Button";
import type { DeputadoUfLista } from "@/lib/blob/deputado-uf";
import type { FotosDosEleitos } from "@/lib/deputado/fotos-eleitos";
import {
  destinoDoCodigo,
  type ExibicaoLinha,
  fraseCorte,
  L,
  type LinhaCompacta,
  marcasDosBits,
  ordenarPorRank,
  paraLinhaCompacta,
  separaBases,
  textoVotoProjetado,
  ultimoRankVisivelDasTuplas,
  unirPorSqcand,
} from "@/lib/utils/deputado-marcas";
import { formatPercent, formatTimeHMS, formatVotes } from "@/lib/utils/format";
import { siglaNaFrase } from "@/lib/utils/termo-territorio";

import { AvatarEleito } from "./AvatarEleito";
import styles from "./DeputadoListaAgremiacao.module.css";

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
  /**
   * Spec 027 (design § 7.3) — o endereço da lista DESTA casa nesta UF
   * (`/uf/SP/deputado-federal/lista`, `/uf/SP/deputado-estadual/lista`,
   * `/uf/DF/deputado-distrital/lista`), ou `null` quando a casa não tem rota
   * de lista — e então nunca há botão "mostrar todos". Montado pelo servidor
   * (`rotaListaDaCasa`); este componente não conhece cargo.
   */
  rotaLista: string | null;
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
  /**
   * Spec 027 (decisão do dono de 03/10) — assembleias: as linhas recebidas são
   * TODO o documento (eleitos + 7), visíveis; a rota traz o resto.
   * Ausente no federal, que fica nas três faixas.
   */
  duasFaixas?: boolean;
  /**
   * Spec 027 — a sigla com artigo ("no DF", "do DF"). As telas das assembleias
   * passam `true`; ausente ⇒ o texto do federal ("em DF").
   */
  comArtigo?: boolean;
  /**
   * Spec 026 RF-291 (decisão do dono de 03/10) — `sqcand → URL` das fotos dos
   * ELEITOS desta lista (`fotosDosEleitos`, no servidor). Com o mapa, toda
   * linha eleita ganha a mini-foto (ou as iniciais, se o `sqcand` não está
   * nele); sem o mapa, nenhuma linha muda. Linhas que chegam pela rota da
   * lista não têm foto no mapa: se uma delas for eleita, sai com as iniciais.
   */
  fotos?: FotosDosEleitos;
  /**
   * ADR-0076 (placar zerado, 04/10) — avatar em TODA linha (foto do mapa ou
   * iniciais), não só nas eleitas. Ausente fora do placar zerado: a lista com
   * dado real não muda.
   */
  avatarEmTodos?: {
    /** `prefixoFotoDaUf` — `null` sem Blob (todas as linhas em iniciais). */
    prefixo: string | null;
    /** `sqcand` da agremiação SEM foto publicada (`foto_ok: false`) — iniciais. */
    semFoto: readonly number[];
  };
}

// ---------------------------------------------------------------------------
// A busca da faixa 3 — uma vez por aba, por casa e por UF (RF-260, spec 027)
// ---------------------------------------------------------------------------

/**
 * Cache em memória por ROTA — isto é, por cargo e por UF: a rota é
 * `/uf/<UF>/<slug do cargo>/lista`. Guarda a PROMESSA, para que duas
 * agremiações da mesma casa clicadas em sequência (ou um segundo clique durante
 * a busca) dividam uma requisição só. Falha sai do cache — "tentar de novo"
 * busca de verdade.
 *
 * 🔴 Spec 027: até 30/09 a chave era só a UF, e a URL tinha
 * `deputado-federal` fixo. Com a Assembleia Legislativa de SP ao lado da
 * bancada de SP na Câmara, na mesma aba, a chave só por UF faria a segunda
 * lista aberta ser a PRIMEIRA — os candidatos a deputado federal dentro da
 * página da Assembleia, com cara de dado certo.
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

function buscarLista(rota: string, uf: string): Promise<DeputadoUfLista> {
  const emCache = cacheListas.get(rota);
  if (emCache) return emCache;
  const promessa = (async () => {
    const resposta = await fetch(rota);
    if (!resposta.ok) throw new Error(`lista 61+: HTTP ${resposta.status}`);
    const corpo: unknown = await resposta.json();
    if (!ehLista(corpo, uf)) throw new Error("lista 61+: corpo fora do contrato");
    return corpo;
  })();
  cacheListas.set(rota, promessa);
  promessa.catch(() => {
    if (cacheListas.get(rota) === promessa) cacheListas.delete(rota);
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
  | { fase: "pronta"; chegaram: number; tsLista: string; aPartirDe: number | null }
  | { fase: "erro" };

/**
 * O rótulo de "mostrar todos" nas assembleias: a contagem é a do que FALTA
 * (`total_candidatos − linhas no documento`), porque o documento já não é um
 * bloco fixo de 60 — "todos os 95" ao lado de 9 linhas visíveis diria pouco.
 */
export function textoMostrarTodosDuasFaixas(restantes: number, sigla: string): string {
  return `Mostrar todos — mais ${restantes} ${restantes === 1 ? "candidato" : "candidatos"} de ${sigla}`;
}

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
  rotaLista,
  corte,
  totalizacaoFinal,
  projecaoVisivel,
  mostrarPartido,
  tsDetalhe,
  semPercentual = false,
  duasFaixas = false,
  comArtigo = false,
  fotos,
  avatarEmTodos,
}: DeputadoListaAgremiacaoProps) {
  const naUf = siglaNaFrase(uf, comArtigo);
  const listaId = useId();
  const listaRef = useRef<HTMLOListElement>(null);
  const [aberta, setAberta] = useState(false);
  /**
   * O que chegou da rota "mostrar todos" — e SÓ isso é estado. As linhas da
   * página são derivadas das props a cada render.
   *
   * 🔴 Até 04/10 as linhas inteiras moravam num `useState` inicializado com as
   * props: o primeiro render congelava a lista. Com a atualização automática
   * (`<AtualizacaoAutomatica>`, `router.refresh()` a cada minuto) as props
   * passam a mudar com o componente montado — voto, rank, marcas e corte novos
   * chegariam e a lista continuaria mostrando os do carregamento.
   *
   * Na união, a linha da PÁGINA vence a da rota (`unirPorSqcand`): ela é a do
   * objeto mais recente. Guardamos TODAS as linhas da resposta, e não só as
   * que faltavam no clique, para que a união seja refeita contra as linhas de
   * cada refresh.
   *
   * ⚠️ Limite conhecido: a resposta da rota é do momento do clique e não é
   * buscada de novo. Um candidato que saia do documento num refresh posterior
   * (ex.: 60º → 61º) e não estava naquela resposta some da lista "todos" até
   * o leitor recarregar a página.
   */
  const [extras, setExtras] = useState<readonly LinhaCompacta[]>([]);
  // A ordem é a do `rank` — reaplicada aqui, e não herdada da ordem de chegada.
  const linhas = useMemo(
    () => unirPorSqcand(ordenarPorRank(linhasIniciais), extras).linhas,
    [linhasIniciais, extras],
  );
  // ADR-0076 — no placar zerado, a foto de TODA linha (inclusive as que chegam
  // pela rota), montada aqui pelo prefixo: nenhum mapa de URL no payload.
  const fotosDasLinhas = useMemo((): FotosDosEleitos | undefined => {
    if (!avatarEmTodos) return fotos;
    const { prefixo, semFoto } = avatarEmTodos;
    const sem = new Set(semFoto);
    const mapa: Record<string, string> = {};
    if (prefixo) {
      for (const l of linhas) {
        if (!sem.has(l[L.SQCAND])) mapa[String(l[L.SQCAND])] = `${prefixo}${l[L.SQCAND]}.jpg`;
      }
    }
    return mapa;
  }, [avatarEmTodos, fotos, linhas]);
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

  // O conjunto visível por padrão (eleitos + 7, emenda 04/10): visível ⇔
  // rank ≤ R. As linhas da rota nunca carregam marca (ADR-0065 D1): não
  // mudam R. Duas faixas: o documento JÁ é o conjunto, nada recortado, nunca
  // "ver mais".
  const ultimoVisivel = duasFaixas ? Number.POSITIVE_INFINITY : ultimoRankVisivelDasTuplas(linhas);
  const naFaixa2 = linhas.filter((l) => l[L.RANK] > ultimoVisivel).length;
  const restantes =
    rotaLista !== null &&
    haListaRestante &&
    typeof totalCandidatos === "number" &&
    busca.fase !== "pronta"
      ? Math.max(0, totalCandidatos - linhas.length)
      : 0;

  async function mostrarTodos() {
    // Durante a busca o botão fica `aria-disabled`, e não `disabled`:
    // `disabled` tira o foco do botão que o tem e o joga no `<body>`. O
    // atributo não bloqueia nada sozinho — este `return` é que ignora o clique.
    if (busca.fase === "buscando" || rotaLista === null) return;
    setAberta(true);
    setBusca({ fase: "buscando" });
    try {
      const [lista, exibicao] = await Promise.all([
        buscarLista(rotaLista, uf),
        funcoesDeExibicao(mostrarPartido),
      ]);
      const daAgremiacao = lista.agremiacoes.find((a) => a.cod === cod)?.candidatos ?? [];
      const ctx = { totalizacaoFinal, projecaoVisivel };
      const novas = daAgremiacao.map((l) => paraLinhaCompacta(l, ctx, exibicao));
      const { acrescentadas } = unirPorSqcand(linhas, novas);
      setExtras(novas);
      const primeira = [...acrescentadas].sort((a, b) => a[L.RANK] - b[L.RANK])[0];
      setBusca({
        fase: "pronta",
        chegaram: acrescentadas.length,
        tsLista: lista.ts,
        aPartirDe: primeira ? primeira[L.RANK] : null,
      });
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
      ? `As posições a partir da ${duasFaixas ? (busca.aPartirDe ?? FAIXA_DOCUMENTO + 1) : FAIXA_DOCUMENTO + 1}ª vêm do cálculo gravado às ${formatTimeHMS(busca.tsLista)}; as anteriores, do das ${formatTimeHMS(tsDetalhe)}. Entre os dois a fronteira pode ter mudado.`
      : null;

  const itens: React.ReactElement[] = [];
  for (const l of linhas) {
    const rank = l[L.RANK];
    const destino = destinoDoCodigo(l[L.DESTINO]);
    const pct = l[L.PCT];
    const numero = l[L.NUMERO];
    const partido = l[L.PARTIDO];
    const votosProjetados = l[L.VOTOS_PROJ];
    const meta = [numero === null ? null : `nº ${numero}`, partido || null]
      .filter(Boolean)
      .join(" · ");
    itens.push(
      <li
        key={l[L.SQCAND]}
        data-rank={rank}
        data-f={rank > ultimoVisivel ? "" : undefined}
        tabIndex={focoEm === l[L.SQCAND] ? -1 : undefined}
      >
        {/* Texto montado como UMA string: `{rank}º` sairia `21<!-- -->º` no
            HTML — 8 bytes × ~1.000 linhas no documento de SP (G6, 30/09). */}
        {/* ADR-0076 — no placar zerado a ordem é SORTEIO: "1º, 2º" leria como
            colocação. A célula fica (vazia) para a grade não mudar. */}
        <span>{avatarEmTodos ? "" : `${rank}º`}</span>
        <span>
          <AvatarEleito
            nome={l[L.NOME]}
            sqcand={l[L.SQCAND]}
            marcas={l[L.MARCAS]}
            fotos={fotosDasLinhas}
            todos={avatarEmTodos !== undefined}
          />
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
          {/* Spec 026 RF-297 — o voto projetado, a mais, sob o apurado: nunca
              o substitui nem muda a ordem (ADR-0063 D5). A posição 9 da tupla
              só existe nas linhas "eleitos + 7" com a projeção visível. */}
          {votosProjetados !== undefined ? (
            <small>{textoVotoProjetado(votosProjetados)}</small>
          ) : null}
        </span>
      </li>,
    );
    if (textoCorte && l[L.SQCAND] === corte?.ultimoEleito) {
      itens.push(
        <li
          key="corte"
          data-corte=""
          data-f={rank > ultimoVisivel ? "" : undefined}
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
          : `Por votos apurados: posição, candidato, número de urna${mostrarPartido ? ", partido" : ""}, votos e % dos válidos ${naUf.de}.`}
      </p>

      <ol
        ref={listaRef}
        id={listaId}
        className={styles.lista}
        // Duas faixas: nada a recolher — o atributo nem existe (ADR-0065,
        // emenda de 03/10: "nem `data-collapsed`, nem recorte por CSS").
        data-collapsed={duasFaixas ? undefined : aberta ? "false" : "true"}
        // Uma base por vez (decisão do dono, 04/10) — ver o cabeçalho do arquivo.
        data-proj={separaBases({ totalizacaoFinal, projecaoVisivel }) ? "" : undefined}
        aria-busy={buscando || undefined}
        aria-label={`Candidatos de ${sigla} ${naUf.em}, por votos apurados`}
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
            // Padrão "disclosure" da APG: o RÓTULO é estável e o estado vai só
            // no `aria-expanded` (e, para quem vê, na seta que gira — desenhada
            // em CSS, sem glifo: um "▾" em texto cai no `incomplete` do axe
            // com o motivo `nonBmp`, "só símbolo").
            // Trocar o texto para "Mostrar menos" E virar o `aria-expanded`
            // dava ao leitor de tela dois sinais que se contradiziam ("mostrar
            // menos, recolhido"). Auditoria G6 da spec 026, 30/09.
            <Button
              variant="secondary"
              size="md"
              wrap
              className={styles.botao}
              aria-controls={listaId}
              aria-expanded={aberta}
              onClick={() => setAberta((v) => !v)}
              data-testid="dep-ver-mais"
            >
              {`Mais ${naFaixa2} ${naFaixa2 === 1 ? "candidato" : "candidatos"} de ${sigla}`}
            </Button>
          ) : null}
          {restantes > 0 ? (
            <Button
              variant="ghost"
              size="md"
              wrap
              aria-controls={listaId}
              aria-disabled={buscando}
              onClick={mostrarTodos}
              data-testid="dep-mostrar-todos"
            >
              {busca.fase === "erro"
                ? "Tentar de novo"
                : duasFaixas
                  ? textoMostrarTodosDuasFaixas(restantes, sigla)
                  : `Mostrar todos os ${totalCandidatos} candidatos de ${sigla}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
