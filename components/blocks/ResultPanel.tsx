/**
 * components/blocks/ResultPanel.tsx
 *
 * O painel de resultado do protótipo do kit
 * (`docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:20-43`),
 * traduzido para o SalaCofre. É o primeiro bloco de conteúdo da home e
 * substitui, ali, o trio `<ApuracaoMeta>` + `<ProjectionThermometers>` +
 * "Composição de Outros" (`<MinorCandidatesList>`): no protótipo os
 * candidatos menores não são um bloco à parte, são linhas da mesma lista.
 *
 * Server Component puro. O único pedaço client é o `<CandidateListCollapse>`,
 * que recebe as linhas já renderizadas como `children` — o payload, as linhas
 * e o `<PartyTag>` não entram no bundle do cliente (RNF-007a).
 *
 * ===========================================================================
 * Toda métrica desta tela, e de onde ela vem
 * ===========================================================================
 *
 * Nada aqui é buscado, recalculado ou inventado: o painel lê `EdgeCandidate[]`
 * e `pct_apurado_total` do mesmo payload que a página já tinha (ADR-0001).
 * Três números do protótipo, porém, **não existem no payload** e são derivados
 * na UI. Cada derivação está comentada no ponto de uso, e nenhuma delas é
 * apresentada como dado do TSE:
 *
 *   1. `counted` — soma de `votos_atuais` dos candidatos. É o total de votos
 *      **em candidato** já apurados; não inclui brancos e nulos, que vivem em
 *      `EdgeParticipacao` e não passam por este painel.
 *   2. `total`   — `counted ÷ (pct_apurado_total / 100)`. É **a mesma regra de
 *      três da projeção**, aplicada ao denominador: uma estimativa do universo
 *      de votos válidos ao final, não uma contagem do TSE. O rótulo do kit
 *      ("X de Y votos válidos") é, portanto, "apurado de projetado".
 *   3. `margem`  — a distância que decide a corrida. Em vaga única é
 *      `candidatos[0].pct − candidatos[1].pct`; com `vagas > 1` (spec 016,
 *      RF-104) é a do último a entrar para o primeiro a ficar de fora —
 *      `candidatos[vagas-1] − candidatos[vagas]`. O payload nacional não
 *      traz margem pronta (a que existe, `margem_pp`, é por UF).
 *
 * ===========================================================================
 * Parcial × Projeção: cascata, nunca estado React
 * ===========================================================================
 *
 * O protótipo alterna com a prop `showProj` (`App.jsx:32,37`). Aqui a base
 * enfatizada é `data-view` no `<html>`, escrito pelo `<ViewModeSwitch>` do
 * shell (ADR-0029 § 2), e a cascata de `app/globals.css` resolve o resto.
 * Duas ferramentas, com significados diferentes, ambas já em uso:
 *
 *   - `data-view-cell` — os dois números ficam visíveis; só muda a ênfase. É o
 *     que as linhas de candidato usam (`<CandidateResultRow>`).
 *   - `data-view-only` — exclusivo, para onde exibir os dois seria ilegível: a
 *     `<Figure>` de margem e a barra de votos. Segue o padrão já estabelecido
 *     pelo `<ProjectionThermometer>`, inclusive a regra de que o atributo mora
 *     num `<span>`/`<div>` externo e **nunca** na `<Figure>` (que declara
 *     `display: grid` inline, e inline vence folha de autor).
 *     Em ambos os casos o número da outra base continua legível na `note`.
 *   - `order` (2026-09-20) — a POSIÇÃO da linha na lista. Ver abaixo.
 *
 * Nenhum candidato é escondido em nenhum estado — ver `CandidateListCollapse`
 * e `ResultPanel.module.css` para o colapso da lista (decisão D21).
 *
 * ===========================================================================
 * 2026-09-20 — "tudo acompanha a base ativa"
 * ===========================================================================
 *
 * Decisão do dono, textual, depois de perguntado o que deveria acompanhar a
 * troca: **lista, numeração, destaque de margem e ocupação de vaga**. Antes
 * disso a home ordenava por projeção e as três rotas de UF por parcial, e
 * nenhuma das duas reagia ao controle.
 *
 * Seis coisas passaram a ser por base, e cada uma está comentada no ponto de
 * uso: a ordem das linhas (`order`), o número à esquerda (`rank`/`rankProj`),
 * o valor E O RÓTULO da figura de margem, o par que a `<VoteBar>` desenha,
 * quem ocupa vaga (e o texto do marcador), e quais linhas o colapso clipa.
 *
 * Duas coisas deliberadamente NÃO seguem a base, e as duas por escrito:
 *
 *   - a **cor** (`corRankDe`) — constituição § 2: estável a noite inteira,
 *     "não muda por rank". Uma candidatura sem partido mapeado trocaria de
 *     tinta a cada toque no botão;
 *   - a **densidade** (`compact`) — não está na lista do dono, e faria a
 *     altura das linhas saltar ao alternar.
 */

import type { CSSProperties, ReactNode } from "react";

import { VoteBar, type VoteBarSegment } from "@/components/atoms/bars/VoteBar";
import { CandidateAvatar } from "@/components/atoms/data/CandidateAvatar";
import { Figure } from "@/components/atoms/data/Figure";
import { PartyTag } from "@/components/atoms/data/PartyTag";
import { Panel, type PanelRule } from "@/components/atoms/surfaces/Panel";
import {
  CandidateResultRow,
  candidateResultRowProps,
} from "@/components/atoms/tables/CandidateResultRow";
import { candidateColor } from "@/components/blocks/_candidateColor";
import { ATRIBUTO_LISTA } from "@/components/blocks/_lista-por-base";
import { CandidateListCollapse } from "@/components/blocks/CandidateListCollapse";
import { ReordenaListaPorBase } from "@/components/blocks/ReordenaListaPorBase";
import { candidatoFotoUrl } from "@/lib/blob/paths";
import type { EdgeCandidate } from "@/lib/edge-config/types";
import { compete, haAnulada, NOTA_ANULADAS, queCompetem } from "@/lib/utils/destino-voto";
import { formatPp, formatVotesCompact } from "@/lib/utils/format";
import { nomeExibicao, primeiroNomeExibicao } from "@/lib/utils/nome-candidato";
import { ordensPorBase } from "@/lib/utils/rank-parcial";

/**
 * O que o painel lê de um candidato — o subconjunto comum a `EdgeCandidate`
 * (payload nacional) e `EdgeUfCandidate` (drill-down de UF).
 *
 * Ele existe porque as três rotas de UF passaram a usar ESTE painel em
 * 2026-09-09 e o payload de UF **não tem `rank`** (ver
 * `CandidateResultRowSource` em `components/atoms/tables/CandidateResultRow.tsx`,
 * que documenta o mesmo subconjunto do lado da linha). Sem o alargamento, a
 * alternativa seria uma segunda variante do painel para UF — que é exatamente
 * o que não se quer.
 *
 * Consequência de `rank` ser opcional, depois de 2026-09-20: ele deixou de
 * decidir o número exibido (o painel deriva as duas posições e passa as duas à
 * linha) e passou a ter UM papel só — ser a base estável que resolve a COR
 * quando a sigla não tem token próprio. Ver `corRankDe`.
 */
export type ResultPanelCandidate = Pick<
  EdgeCandidate,
  "id" | "nome" | "partido" | "cor" | "votos_atuais" | "pct_atual" | "pct_projetado" | "destino"
> & {
  rank?: number;
  /**
   * Chave de identidade da candidatura (ADR-0042). Só endereça a **foto**, via
   * `blobUrlFor(candidatoFotoBlobPathname(uf, sqcand))` (ADR-0041) — a URL não
   * viaja no payload, é derivada. Opcional porque só o cargo 1 a carrega: nos
   * cargos 3 e 5 o bloco nacional é a união de 27 corridas sob o mesmo espaço
   * de `id`, e um `sqcand` ali apontaria para a foto de outra pessoa (RF-145).
   */
  sqcand?: string;
};

export interface ResultPanelProps {
  /**
   * Candidatos do escopo, **em qualquer ordem** (`variant="medicao"`).
   *
   * 🔴 Mudou em 2026-09-20. Até então a ordem deste array ERA o ranking, e
   * cada rota entregava a sua: a home passava o array do payload (ordem do
   * produtor, projeção) e as três rotas de UF passavam `rankByParcial(...)`.
   * Com a decisão do dono de fazer tudo acompanhar a base ativa, uma ordem só
   * deixou de bastar — **o painel deriva as duas** (`ordensPorBase`) e a
   * cascata escolhe qual delas o leitor vê. Passar a lista já ordenada é
   * inofensivo e inútil.
   *
   * Em `variant="identidade"` continua valendo o oposto, e é requisito:
   * a ordem é a de quem chama (o número na urna, RF-161) e o painel não
   * reordena nada.
   */
  candidatos: ResultPanelCandidate[];
  /** `pct_apurado_total` do escopo (0–100). */
  pctApurado: number;
  /** Nota de rodapé do painel — a metodologia em uma frase. */
  note?: string;
  /**
   * Barra com marcador de 50% e três segmentos (líder · Outros · 2º). É a
   * leitura certa para uma corrida majoritária; `false` deixa a barra fora.
   *
   * Default: `vagas === 1`. Numa corrida de duas vagas a barra seria
   * ativamente enganosa — o marcador de 50% desenha a linha da maioria
   * absoluta, que não elege ninguém para o Senado e não é o corte de nada.
   */
  poles?: boolean;
  /**
   * Quantas cadeiras esta corrida elege (RF-105, spec 016). Default `1`.
   *
   * Com `vagas > 1` três coisas mudam, e as três são a mesma decisão — a
   * corrida deixa de ter um vencedor e passa a ter um CORTE:
   *
   *   1. as `vagas` primeiras linhas ganham o marcador de vaga, todas com o
   *      MESMO tratamento. Não há hierarquia visual entre 1º e 2º porque não
   *      há hierarquia no resultado: os dois são senadores;
   *   2. a margem exibida passa a ser a do `vagas`-ésimo para o
   *      `vagas+1`-ésimo — a distância que decide a última cadeira. Mostrar
   *      a margem do 1º sobre o 2º seria factualmente correto e
   *      jornalisticamente errado: ela não decide nada;
   *   3. a barra de maioria sai (ver `poles`).
   *
   * O valor vem de `EdgePayloadUf.vagas`, que por sua vez vem de
   * `lib/config/cargos.ts` — nenhuma tela hardcoda "2".
   */
  vagas?: number;
  /** Quantas linhas ficam visíveis antes do colapso. O kit usa 6. */
  limit?: number;
  /**
   * **RF-155 (spec 019)** — o que este painel está exibindo.
   *
   * - `"medicao"` (default) — o painel de sempre, sem uma linha de diferença:
   *   figuras "Apurado" e "Margem", barra de maioria com marcador em 50%, e
   *   linhas com posição, percentual parcial, percentual projetado e barra.
   * - `"identidade"` — **fase pré-eleição**. Fica o que identifica (nome,
   *   partido, cor); sai tudo que mede.
   *
   * ## Por que uma `variant` e não três booleanos
   *
   * O design 019 § D4 pesou as duas formas. Três props (`poles`, `margem`,
   * `rank`) dariam oito combinações, sete das quais ninguém testou e nenhuma
   * das quais tem consumidor previsto. Uma `variant` é **uma decisão, um nome
   * e um caminho testável**, e a semântica fica legível no ponto de uso:
   * `variant="identidade"` diz o que a tela está fazendo; `poles={false}
   * margem={false} rank={false}` diz o que ela não está.
   *
   * `poles` continua existindo e continua sendo a prop de quem tem duas vagas
   * (spec 016) — em `identidade` ela é **derivada**, não somada: a barra sai de
   * qualquer jeito.
   *
   * ## O que sai, e por quê, item a item
   *
   * - **`<VoteBar>`** — a barra 100% cinza "Outros" com o marcador de 50% é a
   *   figura mais eloquente da tabela de mentiras da spec: ela desenha uma
   *   corrida em que ninguém pontuou, com a linha da maioria absoluta traçada
   *   por cima.
   * - **a figura "Margem"** — `"+0,0 pp"` é um número medido sobre nada.
   * - **a figura "Apurado"** — `0,0%` com a nota "0 de 0 votos válidos", e a
   *   palavra "apurado" é da lista negra do RF-161.
   * - **a posição ordinal** — o `rank` é derivado de `pct_projetado`; com todo
   *   mundo em zero ele ordena pelo **desempate**, e produz um falso
   *   favoritismo estável entre recarregamentos (constituição § 2). É por isso
   *   também que quem chama passa a lista ordenada por número na urna
   *   (RF-161).
   * - **os dois percentuais e os votos de cada linha** — `0,0% parcial` e
   *   `0,0% proj.` ao lado de um nome são medição, e medição é o que esta
   *   fase não tem. A spec não os enumera porque enumera a figura e a barra;
   *   o critério que os alcança é o mesmo e é o do § D0: **mede, cala.**
   */
  variant?: "medicao" | "identidade";
  /**
   * Sigla da UF que endereça a **foto** das candidaturas (ADR-0041:
   * `candidatos/foto/<UF>/<sqcand>.jpg`).
   *
   * 🔴 É a UF da CORRIDA, não a da página. `"BR"` para Presidente — inclusive
   * em `/uf/SP`, porque a corrida presidencial é nacional e é sob `BR` que o
   * importador gravou as 13 fotos. Para Governador e Senador é a sigla do
   * estado. Errar isto não quebra nada visivelmente no servidor: monta uma URL
   * que existe sintaticamente e devolve 404 no navegador do leitor.
   *
   * Vale nas DUAS variantes desde 14/09 — o `variant="medicao"` passou a
   * exibir os mesmos miniavatares (era "ignorada fora do modo identidade").
   */
  ufDaFoto?: string;

  // --- repassados ao `<Panel>` ---
  kicker?: string;
  title?: ReactNode;
  titleId?: string;
  headingLevel?: 1 | 2 | 3 | 4;
  rule?: PanelRule;
  action?: ReactNode;
}

/**
 * Quantas fotos da lista saem com `loading="eager"`.
 *
 * Três — as do pódio. São as únicas que estão acima da dobra em todos os
 * tamanhos medidos; a 4ª já depende da altura da janela, e da 7ª em diante as
 * linhas estão dentro do `<CandidateListCollapse>`, fechado por CSS. Nenhuma
 * recebe `priority`/`fetchpriority="high"`: dar preload a um JPEG de ~4 KB
 * compete com o LCP real da página em vez de ajudá-lo (ver o bloco 4 no topo de
 * `<CandidateAvatar>`).
 *
 * 🔴 **O corte continua em 3 depois de 14/09, quando a linha compacta passou a
 * ter foto** — e é aí que ele deixa de ser detalhe. A home saiu de 5 fotos para
 * 12: se o corte acompanhasse a lista, seriam 12 requisições concorrendo com o
 * LCP no primeiro paint em vez de 3. O número é ditado pela DOBRA, não pelo
 * tamanho da lista; as 9 restantes chegam quando o leitor rola, e as 6 últimas
 * só depois de abrir o colapso — o navegador não baixa foto de linha que o CSS
 * mantém fechada.
 */
const AVATARES_EAGER = 3;

/**
 * Número com uma casa decimal em pt-BR, **sem** o `%` — a `<Figure>` recebe a
 * unidade em campo próprio, e `formatPercent` já traz o sinal colado.
 */
function umaCasa(valor: number): string {
  if (!Number.isFinite(valor)) return "—";
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** `formatPp` sem o sufixo — mesma razão de `umaCasa`. */
function ppSemUnidade(valor: number): string {
  return formatPp(valor).replace(" pp", "");
}

/**
 * Três segmentos: líder · Outros · 2º, na base pedida.
 *
 * 🔴 `corDe` vem de FORA desde 2026-09-20, e não é refactor gratuito: com a
 * lista reordenando por base, "o líder" é uma pessoa diferente em cada barra, e
 * o fallback de rank que esta função usava (`lider.rank ?? 1`) daria a
 * QUALQUER UM que liderasse a base o rank 1 — e portanto a cor 1. Numa
 * candidatura sem partido mapeado, apertar o botão de visualização trocaria a
 * cor dela, que é exatamente o que a constituição § 2 proíbe ("estável durante
 * toda a noite", "não muda por rank"). Quem chama resolve a cor por uma base
 * ESTÁVEL e a entrega pronta.
 */
function segmentos(
  lider: ResultPanelCandidate,
  segundo: ResultPanelCandidate,
  base: "atual" | "projetado",
  corDe: (c: ResultPanelCandidate) => string,
): VoteBarSegment[] {
  const a = base === "atual" ? lider.pct_atual : lider.pct_projetado;
  const b = base === "atual" ? segundo.pct_atual : segundo.pct_projetado;
  // O `id` é a identidade do segmento. O rótulo é o primeiro nome e pode
  // repetir entre dois candidatos — a fixture já expõe isso ("Candidato PT" e
  // "Candidato PL" viram os dois "Candidato").
  //
  // O corte é sobre o nome de EXIBIÇÃO, não sobre o cru: cortar o cru poria
  // "RONALDO" no rótulo da barra e "CAIADO" na linha logo abaixo, e caberia ao
  // leitor deduzir que são a mesma pessoa.
  return [
    {
      id: lider.id,
      label: primeiroNomeExibicao(lider.nome, lider.sqcand),
      pct: a,
      // Segmento do `<VoteBar>`: preenchimento com extensão ⇒ cor-base do
      // partido. `lider.cor` é a paleta por COLOCAÇÃO — e este arquivo já
      // avisava disso no chip, 140 linhas abaixo, sem aplicar aqui.
      color: corDe(lider),
    },
    // Sem `color`: o `<VoteBar>` cai em `--party-outros`, que é exatamente o
    // token que o kit usa aqui (`App.jsx:26`).
    { id: "outros", label: "Outros", pct: Math.max(0, 100 - a - b) },
    {
      id: segundo.id,
      label: primeiroNomeExibicao(segundo.nome, segundo.sqcand),
      pct: b,
      color: corDe(segundo),
    },
  ];
}

/**
 * Marcador de vaga — o mesmo em todas as `vagas` linhas (RF-105).
 *
 * Sem cor de partido (constituição § 2 e ADR-0024: quatro bases da paleta
 * reprovam contraste como texto) e sem número de ordem: escrever "1ª vaga" /
 * "2ª vaga" reintroduziria pela porta dos fundos a hierarquia que o
 * resultado não tem.
 *
 * "projetada" não é ornamento: enquanto a apuração corre, esta é a leitura do
 * modelo, não uma proclamação (constituição § 1 — nada aqui é oficial).
 *
 * 🔴 **E por isso o rótulo mudou de ser fixo em 2026-09-20.** Desde que a
 * ocupação de vaga passou a acompanhar a base ativa (decisão do dono, "tudo
 * acompanha a base ativa"), o marcador pode estar descrevendo a leitura do
 * MODELO ou a contagem PARCIAL do TSE, e são afirmações diferentes. Um
 * "Vaga projetada" ao lado de números parciais seria pior que o defeito que a
 * mudança corrige: diria que o modelo projeta uma coisa quando quem diz é o
 * boletim. A `base` escolhe o texto, e `"ambas"` põe os dois no DOM sob
 * `data-view-only` — que é o caso comum, porque quase sempre as duas bases
 * elegem as mesmas pessoas.
 *
 * Exportado desde 2026-09-18 (3ª rodada): `StateResultSheet.tsx` (a ficha que
 * o mapa nacional abre) é o SEGUNDO consumidor de RF-105 — reaproveita este
 * marcador em vez de desenhar um segundo badge com texto/estilo próprios, que
 * é exatamente o tipo de duplicação que já atrasou a correção de RF-104 por
 * uma rodada inteira. Ele não tem controle de base e continua chamando sem
 * argumento; o default `"proj"` preserva o texto que ele já mostrava.
 */
const VAGA_LABEL = { parcial: "Vaga na parcial", proj: "Vaga projetada" } as const;

export function VagaBadge({ base = "proj" }: { base?: "parcial" | "proj" | "ambas" } = {}) {
  return (
    <span
      data-testid="result-vaga-marker"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "2px var(--space-2)",
        border: "1px solid var(--accent-text)",
        borderRadius: "var(--radius-pill)",
        color: "var(--accent-text)",
        font: "var(--type-kicker)",
        letterSpacing: "var(--tracking-caps)",
        textTransform: "uppercase",
      }}
    >
      {base === "ambas" ? (
        <>
          <span data-view-only="parcial">{VAGA_LABEL.parcial}</span>
          <span data-view-only="proj">{VAGA_LABEL.proj}</span>
        </>
      ) : (
        VAGA_LABEL[base]
      )}
    </span>
  );
}

/**
 * Uma candidatura, e nada além dela: nome, sigla e cor (RF-155).
 *
 * Não é `<CandidateResultRow>` com props desligadas — aquela linha é uma grade
 * de quatro colunas construída em torno dos dois percentuais, e "desligar" as
 * colunas de número deixaria a grade, o `rank`, a barra e os rótulos
 * "parcial"/"proj." atrás de `if`s espalhados. Uma linha própria é menos código
 * e não deixa caminho por onde um percentual volte.
 *
 * Sem posição ordinal por decisão da spec, e **sem o número na urna** por
 * decisão desta implementação: ele aparece, com a foto, na grade de
 * candidaturas logo abaixo (`<CandidaturasAguardando>`), que é onde ele tem
 * contexto. Um algarismo solto à esquerda de cada nome, nesta lista, seria lido
 * como colocação — que é exatamente o que o RF-155 manda não haver.
 */
/**
 * Diâmetro do avatar da linha de identidade, em px.
 *
 * **26, e o número é medido, não escolhido por gosto.** A linha é
 * `box-sizing: border-box` com `min-height: var(--tap-min)` (44px), `padding`
 * de 8px em cima e embaixo e 1px de filete: sobram **27px** de caixa de
 * conteúdo dentro da altura que a linha já tinha. Um avatar de 28px empurra a
 * linha para 45px — medido no navegador em 14/09 —, e alargar a linha é
 * exatamente o que o pedido proibia. 26 cabe com 1px de folga para
 * arredondamento de fonte e zoom.
 *
 * Se o `--tap-min` ou o `padding` da linha mudarem, este número muda junto:
 * `AVATAR ≤ --tap-min − 2×padding − filete`.
 */
const AVATAR_LINHA_PX = 26;

function CandidaturaIdentidadeRow({
  candidato,
  ufDaFoto,
}: {
  candidato: ResultPanelCandidate;
  ufDaFoto: string;
}) {
  /*
   * A foto NÃO viaja no payload: é derivada de `sqcand` (ADR-0041/0042). Sem
   * `sqcand` — cargos 3 e 5, ou fixture antiga — ou sem Blob configurado,
   * `candidatoFotoUrl` devolve `null` e o `<CandidateAvatar>` cai nas iniciais,
   * com a MESMA caixa. É isso que mantém a linha do mesmo tamanho com e sem
   * foto.
   */
  const fotoUrl = candidatoFotoUrl(ufDaFoto, candidato.sqcand);
  // O nome que a tela mostra, e o mesmo que alimenta as iniciais do fallback:
  // com o cru, "VETERINÁRIO WILSON GRASSI" daria a bolinha "VG" ao lado do
  // texto "WILSON GRASSI".
  const nome = nomeExibicao(candidato.nome, candidato.sqcand);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center"
      data-testid="candidatura-identidade-row"
      style={{
        gap: "var(--space-2)",
        minHeight: "var(--tap-min)",
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--border-hairline)",
      }}
    >
      {/*
        28px dentro de uma linha cuja altura mínima é `--tap-min` (44px): o
        avatar cabe na altura que a linha JÁ tinha, então ele não alarga nada.
        `responsive={false}` fixa a caixa em px — o modo fluido do átomo tira a
        altura da proporção 161×225 do TSE e esticaria a linha para 39px.
        `objectPosition: center top` puxa o corte para cima porque a foto é
        retrato (161×225) e o rosto fica no terço superior; centralizado, o
        círculo cortaria a testa.

        🔴 A palavra-chave `top`, e NUNCA uma porcentagem: um `18%` aqui vira
        um `%` no atributo `style` do HTML, e a varredura do RF-161 — que
        procura percentual fabricado sobre o HTML renderizado — não distingue
        um número na tela de um dentro de um estilo. Ela reprovou este
        componente em 14/09, e estava certa em reprovar: quem tem de mudar é o
        valor cosmético, não a guarda.
      */}
      <CandidateAvatar
        nome={nome}
        fotoUrl={fotoUrl}
        rounded
        responsive={false}
        width={AVATAR_LINHA_PX}
        height={AVATAR_LINHA_PX}
        style={{ objectPosition: "center top" }}
      />
      <span className="min-w-0 truncate" style={{ font: "var(--type-body)", fontWeight: 500 }}>
        {nome}
      </span>
      <span className="flex-none">
        {/* 🔴 `candidateColor(sigla, rank)` e NÃO `candidato.cor`.
            O semeador grava `cor: colorForRank(0)` — cinza neutro — em TODA
            candidatura, de propósito: o campo do payload carrega a tinta do
            LÍDER, e em fase pré-eleição não há líder. Lê-lo direto aqui
            pintaria os 12 chips de partido do mesmo cinza, e a cor é uma das
            quatro coisas que o dono pediu no placar zerado (nome, foto,
            partido, cor).
            `candidateColor` resolve pela SIGLA quando o partido está na paleta
            editorial do ADR-0024, e só cai em `colorForRank` quando não está —
            com `rank` 0 para todos, nenhuma tinta sugere colocação. */}
        <PartyTag
          // `rank` é opcional em `ResultPanelCandidate`; `0` é o valor
          // correto do ausente aqui — significa "sem rank", que é o que a
          // fase pré é, e é o mesmo valor que o semeador grava. Não é um
          // `?? 0` de conveniência: com partido mapeado a cor vem da sigla e
          // o rank nem é consultado.
          color={candidateColor(candidato.partido, candidato.rank ?? 0)}
          sigla={candidato.partido}
          size="sm"
        />
      </span>
    </div>
  );
}

export function ResultPanel({
  candidatos,
  pctApurado,
  note,
  vagas = 1,
  poles,
  limit = 6,
  variant = "medicao",
  ufDaFoto = "BR",
  kicker,
  title,
  titleId,
  headingLevel = 2,
  rule = "double",
  action,
}: ResultPanelProps) {
  const identidade = variant === "identidade";
  // `vagas` chega do payload; um valor absurdo não pode marcar a lista
  // inteira nem quebrar o índice do corte.
  const nVagas = Number.isFinite(vagas)
    ? Math.max(1, Math.min(Math.trunc(vagas), candidatos.length || 1))
    : 1;
  const multiVaga = nVagas > 1;
  // A barra de maioria é a leitura de uma corrida de vaga única. Ver `poles`.
  // Em `identidade` ela sai independentemente do que o chamador passar: a
  // fase é mais forte que a contagem de vagas, e `poles={true}` ali seria uma
  // contradição, não uma configuração.
  const mostrarPoles = identidade ? false : (poles ?? !multiVaga);

  /* =========================================================================
   * AS DUAS ORDENS (2026-09-20) — "tudo acompanha a base ativa"
   *
   * Decisão do dono, textual. Até aqui a home usava `national.candidatos` como
   * veio (ordem do produtor: projeção) e as três rotas de UF ordenavam por
   * parcial — e nenhuma das duas reagia ao controle "Parcial / Projeção".
   * Agora as quatro telas seguem a base que está na tela: a ordem da lista, o
   * número à esquerda, o destaque de margem e a ocupação de vaga no Senado.
   *
   * 🔴 **O painel ordena sozinho.** Quem chama não precisa mais entregar a
   * lista ranqueada — e não adianta, porque uma ordem só não resolve o
   * problema. `ordensPorBase` é o ponto único das duas
   * (`lib/utils/rank-parcial.ts`), e o produtor Python porta o comparador de
   * parcial; um teste compara os dois lados.
   *
   * **A ordem do DOM é a da PROJEÇÃO**, e a razão está no bloco de `order` de
   * `app/globals.css`: é a base default, é a que o servidor escreve no
   * `<html>`, e portanto é a ordem em que a página abre para todo mundo antes
   * de qualquer hidratação.
   *
   * Em `identidade` NÃO se ordena nada: ali a lista não é ranking, a ordem é a
   * do número na urna e quem a fixa é quem chama (RF-161). Reordenar aqui
   * reintroduziria o falso favoritismo estável que aquele RF existe para não
   * haver.
   * ====================================================================== */
  const ordens = identidade ? null : ordensPorBase(candidatos);
  const naOrdemDoDom = ordens ? ordens.proj : candidatos;
  const porParcial = ordens ? ordens.parcial : candidatos;
  const porProj = ordens ? ordens.proj : candidatos;

  /**
   * O rank que resolve a COR — e ele é o mesmo nas duas bases, de propósito.
   *
   * `candidateColor` cai em `colorForRank` quando a sigla não tem token
   * próprio (ausente, desconhecida, federação). Se esse rank passasse a ser a
   * posição CORRENTE, apertar o botão de visualização trocaria a cor dessas
   * candidaturas — e a constituição § 2 exige que a cor seja estável durante
   * toda a noite e "não mude por rank" (o argumento inteiro está em
   * `candidateResultRowProps`, que o descobriu em 19/09).
   *
   * A base escolhida é exatamente o valor que este painel já usava antes de
   * haver duas ordens: o `rank` do payload quando ele existe (home), e a
   * posição na ordenação por PARCIAL quando não existe (as três rotas de UF,
   * que passavam `i + 1` sobre o array já ordenado por `rankByParcial`). Ou
   * seja: nenhuma cor muda hoje, e nenhuma pode mudar ao alternar.
   */
  const corRankDe = (c: ResultPanelCandidate): number =>
    c.rank ?? (ordens ? (ordens.posParcial.get(c.id) ?? 0) + 1 : 1);
  const corDe = (c: ResultPanelCandidate): string => candidateColor(c.partido, corRankDe(c));

  // RF-104 — os dois lados da margem que de fato decide a eleição, EM CADA
  // BASE. Vaga única: 1º vs 2º (o que o painel sempre fez). Duas vagas: o
  // último a entrar (índice `nVagas - 1`) vs o primeiro a ficar de fora
  // (`nVagas`). As duas listas são permutações do mesmo array, então "existe
  // duelo" é a mesma resposta nas duas — mas QUEM está dos dois lados não é.
  // 🔴 ADR-0053 / RF-213 — margem, vaga e barra de maioria são sobre quem
  // DISPUTA. A anulada está no fim das duas ordens (`ordensPorBase`), mas
  // "no fim" ainda pode ser a posição 2 de uma corrida de dois: `fora` seria
  // ela, e a margem mediria o líder contra quem não concorre. Sem anulada,
  // `queCompetem` devolve a mesma lista e nada muda.
  const disputaParcial = queCompetem(porParcial);
  const disputaProj = queCompetem(porProj);
  const dentroParcial = disputaParcial[nVagas - 1];
  const foraParcial = disputaParcial[nVagas];
  const dentroProj = disputaProj[nVagas - 1];
  const foraProj = disputaProj[nVagas];

  // O par líder+2º de cada base, para a barra de maioria. Uma tupla em vez de
  // dois índices soltos porque as duas barras só existem juntas: se uma base
  // não tem dois candidatos, nenhuma tem (são permutações do mesmo array).
  const par = (
    lista: ResultPanelCandidate[],
  ): [ResultPanelCandidate, ResultPanelCandidate] | null =>
    lista[0] != null && lista[1] != null ? [lista[0], lista[1]] : null;
  const duploParcial = par(disputaParcial);
  const duploProj = par(disputaProj);

  // DERIVAÇÃO 1 — o payload não traz "votos apurados" agregados; some-se os
  // dos candidatos. Brancos e nulos não entram (não são voto em candidato).
  const counted = candidatos.reduce((soma, c) => soma + (c.votos_atuais ?? 0), 0);

  // DERIVAÇÃO 2 — o universo de válidos ao final. É a MESMA regra de três que
  // produz a projeção (votos ÷ % apurado), aplicada ao denominador; não é um
  // número publicado pelo TSE. Sem apuração não há razão possível: a nota cai
  // para só o apurado, em vez de imprimir uma divisão por zero como se fosse
  // estimativa.
  const total = pctApurado > 0 ? counted / (pctApurado / 100) : null;
  const notaApurado =
    total === null
      ? `${formatVotesCompact(counted)} votos válidos apurados`
      : `${formatVotesCompact(counted)} de ${formatVotesCompact(total)} votos válidos`;

  // DERIVAÇÃO 3 — a margem que decide a corrida, nas duas bases. O payload
  // nacional não tem margem agregada pronta.
  //
  // 🔴 Cada margem sai do PAR DAQUELA BASE, e desde 2026-09-20 o rótulo
  // também. Antes o par vinha de uma ordenação só: a figura de projeção
  // mostrava o número projetado sob o nome de quem liderava a PARCIAL — dois
  // fatos verdadeiros costurados numa frase falsa.
  const temDuelo = dentroParcial != null && foraParcial != null;
  const margemParcial = temDuelo ? dentroParcial.pct_atual - foraParcial.pct_atual : 0;
  const margemProj =
    dentroProj != null && foraProj != null ? dentroProj.pct_projetado - foraProj.pct_projetado : 0;
  const rotuloMargem = (dentro: ResultPanelCandidate | undefined): string =>
    dentro == null
      ? "Margem"
      : multiVaga
        ? // RF-104 — o rótulo precisa dizer QUAL margem é esta. "Margem
          // <líder>" num painel de duas vagas seria lido como a distância do
          // 1º para o 2º, que é justamente a que não importa.
          `Margem para a ${nVagas}ª vaga`
        : `Margem ${primeiroNomeExibicao(dentro.nome, dentro.sqcand)}`;

  // A anulada nunca entra no colapso (ver `extras` abaixo): ela aparece
  // sempre, no fim. Então quem pode sobrar do `limit` são só as que competem —
  // contar a anulada aqui criaria um botão "Todos os N" que não esconde nada.
  const excedentes = Math.max(0, queCompetem(candidatos).length - limit);
  const temAnulada = !identidade && haAnulada(candidatos);

  const linhas = identidade
    ? candidatos.map((c) => (
        <li key={c.id}>
          <CandidaturaIdentidadeRow candidato={c} ufDaFoto={ufDaFoto} />
        </li>
      ))
    : naOrdemDoDom.map((c, i) => {
        // A posição desta linha em cada base. `i` é a posição no DOM, que é a
        // da projeção — usada só para o que é do DOM (as fotos `eager`).
        const iParcial = ordens?.posParcial.get(c.id) ?? i;
        const iProj = ordens?.posProj.get(c.id) ?? i;

        /*
         * DENSIDADE — e ela NÃO acompanha a base, de propósito.
         *
         * `compact` é a linha reduzida das candidaturas pequenas, não uma
         * afirmação sobre a corrida: o dono listou quatro coisas que seguem a
         * base (lista, numeração, margem, vaga) e densidade não é nenhuma
         * delas. Se seguisse, a ALTURA das linhas mudaria ao alternar e a
         * página saltaria sob o dedo do leitor — e, pior, a linha precisaria
         * existir duas vezes no DOM, que é o custo que `order` evita.
         *
         * O critério antigo (`índice >= 2`) era de uma ordem só. Aqui a linha
         * só é compacta se estiver fora do pódio NAS DUAS bases: assim ela
         * nunca aparece encolhida no topo da tela por ser pequena na outra
         * base. É estritamente mais conservador — só deixa de comprimir.
         */
        const compact = c.pct_atual < 3 && iParcial >= 2 && iProj >= 2;

        // 🔴 `iParcial + 1` como `fallbackRank`, e não a posição do DOM: é o
        // valor que resolve a COR, e ele tem de ser o mesmo nas duas bases
        // (ver `corRankDe`). O número EXIBIDO vem depois, explícito.
        const props = candidateResultRowProps(c, iParcial + 1, compact);

        // RF-105 — a ocupação de vaga acompanha a base. Consequência que o
        // dono aceitou explicitamente: trocar a visualização muda quem a tela
        // diz que está ocupando vaga. É por isso que o RÓTULO do marcador
        // também muda (ver `<VagaBadge>`) — a tela nunca diz "projetada" sob
        // números parciais.
        // ADR-0053 — a anulada não ocupa vaga, nem que a corrida tenha menos
        // candidaturas que disputam do que vagas.
        const disputa = compete(c);
        const ocupaParcial = multiVaga && disputa && iParcial < nVagas;
        const ocupaProj = multiVaga && disputa && iProj < nVagas;

        // Quais bases clipam esta linha no colapso. Em cada base o número de
        // linhas clipadas é o mesmo (`total - limit`); quais linhas, não.
        // ADR-0053 — a anulada fica SEMPRE visível (decisão do dono: "continua
        // aparecendo"). Como ela é a última das duas ordens, marcá-la como
        // excedente a esconderia justamente quando é a mais votada.
        const extras: string[] = [];
        if (disputa && iParcial >= limit) extras.push("parcial");
        if (disputa && iProj >= limit) extras.push("proj");

        return (
          <li
            data-extra-row={extras.length > 0 ? extras.join(" ") : undefined}
            // Gancho do seletor de `order` em `app/globals.css`. O valor diz
            // qual base a ordem do DOM segue — é contrato, não decoração: um
            // teste o afirma, porque tudo o que depende de ordem de DOM
            // (leitor de tela, `Ctrl+F`, as fotos `eager`) depende dele.
            data-ord="proj"
            data-vaga={
              ocupaParcial && ocupaProj
                ? "true"
                : ocupaParcial
                  ? "parcial"
                  : ocupaProj
                    ? "proj"
                    : undefined
            }
            key={c.id}
            style={{ "--ord-parcial": iParcial, "--ord-proj": iProj } as CSSProperties}
          >
            {ocupaParcial && ocupaProj ? (
              <VagaBadge base="ambas" />
            ) : ocupaParcial ? (
              <span data-view-only="parcial">
                <VagaBadge base="parcial" />
              </span>
            ) : ocupaProj ? (
              <span data-view-only="proj">
                <VagaBadge base="proj" />
              </span>
            ) : null}
            {/* A MESMA foto da tela de espera, no placar (pedido do dono,
                14/09). O `avatar` vai sempre presente: é a coluna que existe,
                não a foto. **Em toda linha, inclusive a compacta** — o dono viu
                a tela com as candidaturas abaixo de 3% sem rosto e pediu foto em
                todas, aceitando a linha mais alta que isso custa (55 → 77,6px
                nas que ainda cabiam numa linha só). No bloco nacional de
                Governador e Senador NENHUMA linha tem `sqcand` (RF-145), então
                as 12 caem juntas nas iniciais e continuam alinhadas entre si —
                é por isso que a decisão é da lista e não da linha.
                O NOME já sai de `candidateResultRowProps` em forma de exibição
                — o adaptador é o gargalo das três listas de resultado —, e é
                ele que alimenta as iniciais do fallback: a bolinha e o texto ao
                lado nunca discordam. */}
            <CandidateResultRow
              {...props}
              avatar={{
                fotoUrl: candidatoFotoUrl(ufDaFoto, c.sqcand),
                // `i`, a posição no DOM (= projeção), e não `iParcial`: o corte
                // é ditado pela DOBRA, e a dobra é a da base em que a página
                // abre. Ver `AVATARES_EAGER`.
                eager: i < AVATARES_EAGER,
              }}
              // 🔴 Os dois números da esquerda, explícitos, sobrescrevendo o
              // `rank` que `candidateResultRowProps` derivou. Sem isso a home
              // imprimiria o `rank` do payload (que é o da projeção) ao lado de
              // uma linha reposicionada pela cascata — e a lista sairia
              // "2, 1, 3" de cima para baixo na base parcial.
              rank={iParcial + 1}
              rankProj={iProj + 1}
              variant="kit"
            />
          </li>
        );
      });

  return (
    <Panel
      action={action}
      headingLevel={headingLevel}
      kicker={kicker}
      rule={rule}
      title={title}
      titleId={titleId}
    >
      {/* RF-155 — as duas figuras do topo são medição pura e NÃO CHEGAM AO DOM
          em fase pré: "Apurado 0,0% · 0 de 0 votos válidos" e "Margem +0,0 pp".
          Escondê-las por CSS não serviria: a métrica de aceitação do RF-161 é
          varrida sobre o HTML renderizado, e "apurado" e "pp" são duas das
          palavras que ela procura. */}
      {identidade ? null : (
        <div
          className="grid grid-cols-2"
          style={{ gap: "var(--space-4)", marginBottom: "var(--space-4)" }}
        >
          <Figure label="Apurado" note={notaApurado} unit="%" value={umaCasa(pctApurado)} />

          {/* A margem é a única figura que muda com a base. Os dois números
              ficam no HTML; a cascata revela o da base ativa, e a `note` de cada
              variante carrega o número da outra — nenhuma leitura fica
              indisponível em nenhum estado do controle.

              Sem `color`/`tone` de partido, ao contrário do kit (`tone={a.partido
              === 'PT' ? 'pt' : ...}`, App.jsx:32): pintar o algarismo com a cor
              de identidade é o defeito que o axe pegou em 2026-09-07 no 3º
              termômetro (`--color-cand-3` sobre o papel = 2,99:1, contra os
              4,5:1 da constituição § 4). Cor de preenchimento não vira tinta. */}
          {temDuelo ? (
            <>
              <span data-testid="result-margem-parcial" data-view-only="parcial">
                <Figure
                  label={rotuloMargem(dentroParcial)}
                  note={`projeção ${formatPp(margemProj)}`}
                  size="lg"
                  unit="pp"
                  value={ppSemUnidade(margemParcial)}
                />
              </span>
              <span data-testid="result-margem-proj" data-view-only="proj">
                <Figure
                  label={rotuloMargem(dentroProj)}
                  note={`parcial ${formatPp(margemParcial)}`}
                  size="lg"
                  unit="pp"
                  value={ppSemUnidade(margemProj)}
                />
              </span>
            </>
          ) : null}
        </div>
      )}

      {/* Barra de maioria. Duas, uma por base, pelo mesmo motivo da margem:
          dois preenchimentos sobrepostos na mesma barra são ilegíveis.

          🔴 Cada barra desenha o líder e o 2º DAQUELA BASE (2026-09-20). Antes
          as duas desenhavam o mesmo par, e a barra de projeção podia estar
          rotulada com quem liderava a parcial. A COR de cada segmento, porém,
          sai de `corDe` — presa a uma base estável —, então a mesma pessoa tem
          a mesma tinta nas duas barras. */}
      {mostrarPoles && duploParcial != null && duploProj != null ? (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <div data-view-only="parcial">
            <VoteBar
              marker={50}
              segments={segmentos(duploParcial[0], duploParcial[1], "atual", corDe)}
            />
          </div>
          <div data-view-only="proj">
            <VoteBar
              marker={50}
              segments={segmentos(duploProj[0], duploProj[1], "projetado", corDe)}
            />
          </div>
        </div>
      ) : null}

      {/* A lista inteira, sempre. Abaixo do `limit` não há colapso nem botão —
          seria um controle que não controla nada.

          Em `identidade` não há colapso em nenhum tamanho: a linha de
          candidatura é uma tira de nome e sigla, doze delas cabem onde seis
          linhas de resultado cabiam, e `<CandidateListCollapse>` é o único
          pedaço de cliente deste painel — abrir fronteira de JS para encolher
          uma lista que já é curta é o negócio errado (RNF-007a). `<ul>` e não
          `<ol>`: a ordem é a do número na urna, e uma lista ordenada é
          anunciada com índice, que é o que o RF-155 manda não haver. */}
      {/* 🔴 A reordenação da lista acontece no DOM, não só na pintura — é o que
          faz leitor de tela, teclado, `Ctrl+F` e copiar-colar receberem a mesma
          ordem que os olhos. Ver o docblock de `<ReordenaListaPorBase>`.

          Não é renderizado em `identidade` (fase pré): sem voto contado a ordem
          é a do número na urna e não segue base nenhuma — constituição § 2 v1.5,
          cuja exceção é expressa e não alcança esta tela. */}
      {identidade ? null : <ReordenaListaPorBase />}

      {identidade ? (
        <ul
          data-testid="result-identidade-lista"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}
        >
          {linhas}
        </ul>
      ) : excedentes > 0 ? (
        <CandidateListCollapse total={candidatos.length}>{linhas}</CandidateListCollapse>
      ) : (
        <ol
          {...{ [ATRIBUTO_LISTA]: "" }}
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}
        >
          {linhas}
        </ol>
      )}

      {/* ADR-0053 / RF-213 — a frase só existe quando há anulada na lista:
          sem ela, ninguém precisa saber que a regra existe. */}
      {temAnulada ? (
        <p
          data-testid="result-nota-anuladas"
          style={{
            margin: "var(--space-3) 0 0",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            textWrap: "pretty",
          }}
        >
          {NOTA_ANULADAS}
        </p>
      ) : null}

      {note ? (
        <p
          style={{
            margin: "var(--space-3) 0 0",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            textWrap: "pretty",
          }}
        >
          {note}
        </p>
      ) : null}
    </Panel>
  );
}
