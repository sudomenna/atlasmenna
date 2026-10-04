/**
 * components/blocks/StateResultSheet.tsx
 *
 * Folha de resumo de uma UF, aberta ao tocar/clicar num estado no mapa
 * nacional (`NationalChoroplethMap.tsx`). Decisão do usuário, 2026-09-08:
 * o clique não navega mais direto para `/uf/[sigla]` — abre esta folha
 * (`<Sheet>`), que leva um botão em destaque "Ver detalhes do estado" pra
 * quem quiser a página completa.
 *
 * Composição de referência: `MunSheet` do kit Atlas Menna
 * (`docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:196-208`) —
 * duas `<Figure>` no topo, linhas de candidato abaixo. Adaptado ao que o
 * payload REALMENTE tem (ver "O que fica de fora" abaixo).
 *
 * Contrato de dados — só `EdgeUfRow` + `EdgeCandidate[]` (nenhum campo
 * novo, nenhum número sintético):
 *   - Figuras: `pct_apurado` ("Apurado") e a margem exibida (`margemLabel`/
 *     `margemParaExibir`, `components/layout/UfPicker.tsx`) — em Presidente e
 *     Governador é `margem_projetada` ("Margem projetada", 1º−2º, a margem da
 *     disputa com 1 vaga); em Senador (2 vagas, RF-104) é `margemSegundaVaga`
 *     (2º−3º, a margem que decide a 2ª cadeira), `NaN`/"—" com menos de 3
 *     candidatos no top-3. O protótipo mostra "Eleitores" no lugar da segunda
 *     figura — esse campo NÃO existe em `EdgeUfRow` (nem por UF nem por
 *     município no payload nacional hoje, ver `docs/_meta/plano-redesign-
 *     2026-09-08.md` § "BiggestPanel"). Omitido, não inventado.
 *   - Líder: só existe como linha à parte em Presidente/Governador (1 vaga).
 *     ⚠️ **Desde 2026-09-21 quem é o líder sai de `liderIdPorBase(row,
 *     viewMode)`, NÃO de `row.lider`** — aquele campo carrega projeção apesar
 *     do nome (ver o cabeçalho de `lib/utils/lider-por-base.ts`), e usá-lo
 *     aqui destacaria, na base "Parcial", alguém que não é a primeira linha da
 *     própria lista desta folha. Resolvido o ID, a IDENTIDADE (nome/partido/
 *     sqcand) vem PRIMEIRO da linha da UF, e só cai para
 *     `candidatos[]` (nacional) como fallback. Mesma regra para cada linha do
 *     ranking. Ver "🔴 identidade" logo abaixo do componente para o porquê —
 *     é o mesmo defeito de RF-144/RF-145 que `buildHoverRows`
 *     (`_NationalChoroplethMapImpl.tsx`) já tinha corrigido; esta ficha
 *     lateral é o SEGUNDO consumidor da mesma linha de dado.
 *     **Em Senador (RF-105) não existe "o líder" com tratamento próprio**: as
 *     `vagas` primeiras linhas do ranking ganham o MESMO marcador
 *     (`<VagaBadge>`, reaproveitado de `ResultPanel.tsx`), sem que nenhuma
 *     vire um parágrafo isolado — o resultado não tem hierarquia entre 1º e
 *     2º, e a UI parou de inventar uma.
 *   - Candidatos: `row.top_candidatos` (id + `pct`), INTEIRO, sem `.slice()` —
 *     por isso a ficha passou de 3 para 4 linhas em 2026-09-19 sem nenhuma
 *     mudança de código: o dono decidiu naquele dia que as três telas de
 *     resumo de UF mostram quatro candidaturas, e o produtor passou a emitir
 *     quatro (`TOP_CANDIDATOS_POR_UF = 4`, `api/model/project.py`). A ausência
 *     de corte aqui é deliberada e continua: o contrato do campo não promete
 *     comprimento (`lib/edge-config/types.ts`), e um payload gravado antes
 *     dessa data traz 3 — a ficha renderiza o que houver.
 *     ⚠️ Esta ficha **não** tem a linha "Outros" do balão dos mapas: ela lista
 *     candidaturas, e `EdgeUfRow.outros` é um agregado sem `id` de urna e sem
 *     `sqcand` (ver a docstring do campo). Quem quiser a cauda aqui adiciona
 *     um bloco próprio, não um elemento do ranking.
 *
 * ## 🔴 2026-09-20 — a ficha mostra os DOIS números, e a docstring que dizia
 * ## o contrário estava VENCIDA
 *
 * Até esta data o bloco acima afirmava que "o payload só tem parcial agregada
 * por UF (`pct_apurado`), nunca por candidato". **Era falso desde
 * 2026-09-19.** `EdgeUfRow.top_candidatos[]` carrega, além de `pct`
 * (= `pct_projetado`), os campos `pct_atual` e `votos_atuais`
 * (`lib/edge-config/types.ts`), e o produtor os emite —
 * `api/model/project.py`, no bloco que monta `item_top`. A frase vencida foi
 * lida como descrição do dado e produziu, no mesmo dia, uma afirmação errada
 * ao dono ("a ficha não consegue acompanhar a base"). Ela sai daqui inteira;
 * o que fica é o contrato real, com a armadilha que ele traz junto.
 *
 * Decisão do dono, 2026-09-20: **a ficha do mapa mostra apurado e projetado;
 * as fichas MUNICIPAIS só mostram o apurado.** A segunda metade não custa
 * código — não existe projeção municipal, o modelo projeta por zona e agrega
 * para a UF (ADR-0021).
 *
 * ### 🔴 `pct_atual` é OPCIONAL, e a ausência NÃO é zero
 *
 * O campo falta em três situações legítimas, todas documentadas no tipo:
 * payload gravado antes de 2026-09-19; `model_fallback_tier`; e — mesmo em
 * payload novo — UF sem NENHUMA zona apurada em cargo 1, onde o número da UF
 * vem de `impute_uf_from_national` e "qual fração é desta candidatura" nunca
 * foi medido.
 *
 * Nesses casos a linha mostra **só a projeção**. Não há `?? 0` neste arquivo,
 * e não pode haver: "não temos o apurado desta candidatura" e "esta
 * candidatura teve 0%" são estados diferentes (decisão do dono de 14/09 —
 * não começou / não sabemos / apurando), e publicar `0,0%` no lugar do
 * primeiro é fabricar resultado eleitoral. O payload em TRANSIÇÃO produz o
 * caso misto (algumas candidaturas com o campo, outras sem) e a ficha
 * renderiza cada linha pelo que ela própria tem.
 *
 * ⚠️ As fixtures mentem em direções opostas e é fácil se enganar com elas:
 * `tests/fixtures/simulacao/governador.json` tem `pct_atual` em **106 de 106**
 * `top_candidatos`, enquanto `tests/fixtures/edge-config/projection-current.
 * json` e `gov-current.json` têm em **0 de 81** (foram capturadas antes de
 * 19/09). Ver a lição "fixture do simulado é mais rica que produção": passar
 * no simulado não prova o caminho da ausência, e passar nas de produção não
 * prova o caminho do par.
 *
 * ## ✅ A ficha acompanha a base ativa — inclusive a ORDEM (2026-09-21)
 *
 * ⚠️ **Este § dizia o oposto até 2026-09-21** ("O que a ficha continua NÃO
 * acompanhando: a ORDEM"). Ele descrevia corretamente o estado de então e o
 * dono decidiu fechá-lo; o texto antigo fica citado aqui porque foi ele que
 * documentou o defeito, não para descrever o código de hoje.
 *
 * Desde 2026-09-20 (commit `290b8de`, "tudo acompanha a base ativa") a lista
 * principal das telas troca de número E de ordem conforme o segmentado do
 * cabeçalho (`<ViewModeSwitch>`, `app/globals.css` bloco "ADR-0029 § 2").
 * Esta ficha ficou de fora por um dia, e isso tinha uma consequência concreta
 * em **Senador**, que elege DUAS cadeiras: a página da UF listava a dupla por
 * uma base e esta folha listava por outra, com o `<VagaBadge>` nas duas
 * primeiras linhas da SUA ordem. Com o seletor em "Parcial", as duas
 * superfícies do mesmo site **nomeavam duplas diferentes de eleitos** —
 * medido em 1 de 27 UFs na fixture do simulado a 25% apurado (SC: projeção
 * `CAROL DE TONI + DÉCIO LIMA`, apurado `CAROL DE TONI + CARLOS BOLSONARO`).
 *
 * **Decisão do dono, 2026-09-21** (dívida 2): a folha reordena, e o
 * `<VagaBadge>` **segue a base ativa** — em "Parcial" marca os dois mais
 * votados nos boletins chegados; em "Projeção", os dois da projeção. As duas
 * alternativas descartadas estão registradas na dívida: prender o selinho à
 * projeção (a ordem da lista deixaria de significar "quem se elege") e não ter
 * selinho em "Parcial" (a vista perderia quantas cadeiras estão em jogo).
 *
 * A reordenação usa `ordenarTopCandidatosPorBase`/`liderIdPorBase`
 * (`lib/utils/lider-por-base.ts`) — o MESMO ponto único do coroplético, que
 * por sua vez reaproveita os comparadores de `lib/utils/rank-parcial.ts` que
 * `<ResultPanel>` usa. Uma derivação governa ordem, cor e destaque nas três
 * superfícies: condição (b) da constituição § 2 v1.5.
 *
 * Por isso o rótulo `state-sheet-base-label` **mudou de afirmação** nesta
 * data. Ele dizia "Percentuais de projeção", que com os dois números na tela
 * passou a ser falso — e falso sobre o número, que é a pior metade. Agora ele
 * qualifica o que de fato é projeção e só isso: a ORDEM. As três propriedades
 * que o mantinham honesto continuam valendo, com a razão atualizada:
 *
 *   - **é incondicional de propósito.** Não leva `data-view-only` nem
 *     `data-view-cell` (os dois únicos contratos de `app/globals.css` que
 *     escondem ou recuam algo conforme `data-view`). ⚠️ A razão MUDOU em
 *     2026-09-21: era "a ordem é por projeção nas DUAS bases, então o aviso
 *     vale nas duas" — frase que morreu junto com o defeito. Agora o rótulo
 *     **nomeia** a base que a lista usou, então ele informa nas duas em vez de
 *     avisar sobre uma. E o que ele nomeia é `usouParcial`, não `viewMode`:
 *     com `pct_atual` ausente no corte, a ordem degrada para projeção mesmo
 *     com o seletor em "Parcial", e o rótulo tem de dizer a verdade sobre a
 *     lista que está na tela, não sobre o botão que foi apertado.
 *   - **fica acima do `<ul>`, nunca acima das `<Figure>`.** As figuras não são
 *     ordenadas por nada — são dois números soltos —, e um rótulo mais acima
 *     pareceria qualificá-las.
 *   - **é texto visível e não-`aria-hidden`**, então serve às duas audiências
 *     com um elemento só (duplicar em `sr-only` faria o leitor de tela ouvir a
 *     mesma frase duas vezes). O `aria-label` do `<ul>` carrega a mesma
 *     formulação, para quem salta direto para a lista e nunca passa pelo
 *     rótulo em ordem de leitura. E cada número segue auto-descrito na própria
 *     linha ("parcial" / "projeção"), que é o que descreve o dado para quem
 *     navega item a item, sem cabeçalho nem nome de lista no caminho.
 *
 * ## Largura medida a 360px
 *
 * Medido no Chromium headless em 2026-09-20, viewport 360×800, com o
 * `app/globals.css` COMPILADO (tokens de verdade) e as fontes reais do site
 * (Archivo / JetBrains Mono, `document.fonts.check` verde nas duas) — não com
 * a fonte padrão do navegador, que mediria outra tela. `getBoundingClientRect`
 * mede a CAIXA; os glifos foram medidos à parte com `Range.selectNodeContents`,
 * que é a única leitura que não confunde texto com padding.
 *
 * A ficha tem **360px** nas duas montagens (`Sheet.tsx`: no celular é
 * `left:0; right:0`, no desktop é `SIDE_BOX.width = 360`), e a coluna de
 * conteúdo mede **326px** (360 − 2×`--space-4` − 2×1px de filete).
 *
 * Fixture de pior caso real, tirada de `tests/fixtures/simulacao/governador.
 * json` (os nomes exibidos mais longos das 106 candidaturas, com as siglas que
 * NÃO abreviam):
 *
 * | layout | altura/linha | nomes truncados (de 4) | rolagem horizontal |
 * |---|---|---|---|
 * | antes (1 número à direita) | 38,75px | **1** | não |
 * | 2 números à direita | 43,00px | **3** | não |
 * | **atual** (números na própria linha) | 55,75px | **0** | não |
 *
 * Ou seja: a truncagem **já existia** antes desta mudança — "VALMIR DE
 * FRANCISQUINHO" pede 209,69px de glifos e recebia uma caixa de 173px —, e
 * dois números à direita a teriam levado de 1 para 3 de 4. Com a identidade
 * ocupando a linha inteira (326px), o mesmo nome cabe com folga e nenhum dos
 * quatro corta.
 *
 * O custo é altura: **+17px por linha** (38,75 → 55,75), ou +68px nas quatro
 * candidaturas; em Senador as duas linhas com `<VagaBadge>` vão de 68,75 para
 * 81,5px. A ficha já rola por dentro (`Sheet.tsx`, `overflow-y: auto`,
 * `maxHeight: 82vh`), então a altura extra não empurra a página.
 *
 * A linha dos números usa 84–92px (parcial) + 16px de `gap` + 70–78px
 * (projeção) = **170–186px dos 326** — sobra confortável, e é por isso que os
 * dois números cabem lado a lado ali embora não coubessem ao lado do nome.
 *
 * Rolagem horizontal: `documentElement.scrollWidth` = 360 = viewport nos seis
 * cenários medidos (pres/sen × completo/ausente/misto, mais o cartão lateral a
 * 1280px), e **zero** elementos com borda direita além do viewport. Inclusive
 * no caso patológico de um nome de 39 caracteres sem espaço: ele **quebra** —
 * a linha vai a 77,5px — em vez de cortar ou empurrar a página. Este projeto
 * já perdeu uma tela para 2.424px de rolagem lateral; a medida é a prova, não
 * a intenção.
 *
 * ## Cor
 *
 * A ficha **não decide cor**: os dois pontos de 8×8 (líder e linhas do
 * ranking) chamam `candidateMarkerColor` (`_candidateColor.ts`), o mesmo
 * helper do balão dos mapas e da lista. Ver o bloco 🔴 logo antes de
 * `resolveIdentidade` para a guarda duplicada que morava aqui até
 * 2026-09-20 e pintava federação pela colocação.
 *
 * A11y: o diálogo é o `<Sheet>` (aria-modal, Esc, foco preso/devolvido —
 * ver `components/atoms/overlays/Sheet.tsx`). O botão "Ver detalhes" é um
 * `<Link>` real (`<a href>`), não um `onClick` — funciona por teclado, com
 * Cmd/Ctrl+click abre em nova aba, e navega mesmo sem JS (SSR de verdade,
 * não uma âncora fake).
 *
 * Server Component puro (sem hooks) — o custo de cliente já está pago pelo
 * `<Sheet>` que este arquivo importa; nenhum JS adicional aqui.
 */

import Link from "next/link";
import type { CSSProperties } from "react";

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import { Figure } from "@/components/atoms/data/Figure";
import { Sheet } from "@/components/atoms/overlays/Sheet";
import { SeloPilula } from "@/components/atoms/tables/CandidateResultRow";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import { VagaBadge } from "@/components/blocks/ResultPanel";
import {
  margemLabel,
  margemParaExibir,
  type UfPickerCargo,
  ufHref,
  vagasPorCargo,
} from "@/components/layout/UfPicker";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import type { ViewMode } from "@/lib/state/view-mode";
import {
  compete,
  exibePercentual,
  haAnulada,
  notaAnuladas,
  votosDaAnulada,
} from "@/lib/utils/destino-voto";
import { definicaoDaUf } from "@/lib/utils/eleitos-definidos";
import { formatPercent, formatPp } from "@/lib/utils/format";
import { liderIdPorBase, ordenarTopCandidatosPorBase } from "@/lib/utils/lider-por-base";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { partyChipInk } from "@/lib/utils/party-color";
import { regraSeloNoMapaNacional, selosDoTopUf } from "@/lib/utils/selo-resultado";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

/** Mesma tabela de `GovernorCard.tsx` — sem módulo compartilhado em `lib/utils/**`
 * pra este propósito, então repetida aqui (padrão já existente no repo). */
const UF_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

export interface StateResultSheetProps {
  open: boolean;
  onClose: () => void;
  /** UF selecionada. `null` enquanto nada foi tocado no mapa. */
  row: EdgeUfRow | null;
  /** Lista nacional de candidatos — resolve nome/partido/cor por id. */
  candidatos: EdgeCandidate[];
  /** Desktop: cartão lateral não-modal (`Sheet.side`). Mobile: bottom sheet. */
  side?: boolean;
  /**
   * Qual corrida esta folha resume (2026-09-18, estendido 2026-09-18 pra
   * Senador) — decide o destino do CTA "Ver detalhes do estado" via
   * {@link ufHref}: `"pres"` → `/uf/<SIGLA>`, `"gov"` → `/uf/<SIGLA>/governador`,
   * `"sen"` → `/uf/<SIGLA>/senador`. Sem default de propósito: esta prop
   * nasce no dia em que um segundo cargo passa a abrir esta folha
   * (`NationalChoroplethMap.tsx` na trilha Governador), e um default
   * herdaria o valor do PRIMEIRO caller para sempre — a mesma classe de bug
   * que este repositório já pagou três vezes com conversores de cargo
   * silenciosos.
   */
  cargo: UfPickerCargo;
  /**
   * Base ativa do seletor Parcial/Projeção (2026-09-21) — decide a ORDEM da
   * lista, quem é "o líder" fora de `multiVaga` e quais linhas ganham o
   * `<VagaBadge>` em Senador.
   *
   * Default `"proj"`, o MESMO default de `NationalChoroplethMap.tsx:420`, que
   * é quem renderiza esta folha. Opcional (e não obrigatória) porque a folha
   * é montada em telas que ainda não têm seletor; `"proj"` preserva byte a
   * byte o comportamento anterior a esta data.
   */
  viewMode?: ViewMode;
  /**
   * Turno da corrida (`EdgePayload.turno`) — 2026-10-04. Só decide os selos de
   * base (`selosDaBase` desliga todo selo no 2º turno). Ausente ⇒ 1º turno, o
   * default de `selosDaBase`.
   */
  turno?: number | null;
}

/**
 * 🔴 **2026-09-20 — a ficha deixou de ter cor própria.**
 *
 * Até hoje este arquivo carregava DUAS coisas que não deviam existir aqui: uma
 * cópia local de `partidoIsMapped` e um `dotColor` que, quando a resposta era
 * não, desviava para `colorForRank(rank ?? 99)`. O caso em que a resposta é não
 * é, na prática, **federação** ("PSDB/CIDADANIA", "PSOL/REDE", "FEDERACAO
 * BRASIL DA ESPERANCA") e candidatura sem sigla — exatamente as candidaturas
 * cuja cor passava a depender da COLOCAÇÃO, que a constituição § 2 proíbe
 * ("não muda por rank, por ordem de apuração, por margem ou por qualquer
 * evento da corrida"). Ver o topo de `_candidateColor.ts` para o defeito
 * medido e para por que o destino certo é `--party-outros`.
 *
 * O ponto de 8×8 do líder e o de cada linha do ranking agora chamam
 * {@link candidateMarkerColor} direto — o MESMO helper que o balão dos mapas
 * (`_NationalChoroplethMapImpl.tsx`, `ChoroplethMapUF.tsx`) e a lista usam. É
 * de propósito que não sobrou nenhuma função de cor neste arquivo: a ficha é
 * aberta PELO mapa, por cima da lista, e guarda duplicada é literalmente o que
 * produziu o defeito de 2026-09-19 (CAIADO/PSD laranja na lista e verde na
 * legenda, mesma tela). Enquanto a cor da ficha for a chamada e não uma cópia
 * da regra, as três superfícies não têm como divergir.
 *
 * Por que `candidateMarkerColor` e não `candidateColor`: RNF-035 / WCAG SC
 * 1.4.11. O ponto é marcador de IDENTIDADE **sem extensão a perder**, então o
 * remédio é a variante legível (`--party-<slug>-text`), não o contorno de
 * `DATA_FILL_STROKE` — que serve a preenchimento COM extensão (barra,
 * segmento, região). Medido em 18/09, tema claro: PSOL 2,08 · PSB 2,19 ·
 * outros 2,39 · NOVO 2,72 contra o piso de 3:1. No escuro as quatro passam de
 * 9:1 — o problema é só do claro, e medir um tema só engana.
 */

/**
 * 🔴 **Identidade PRIMEIRO da própria linha da UF, nunca do array nacional
 * como fonte primária** — mesma regra de `buildHoverRows`
 * (`_NationalChoroplethMapImpl.tsx`), e pela MESMA razão (RF-144/RF-145,
 * ADR-0042 item 3): `EdgeUfRow.top_candidatos[]` sabe de que UF é e carrega
 * `nome`/`partido`/`sqcand` resolvidos por ela em TODO cargo; `national.
 * candidatos` (origem de `candidatosById`) só tem uma corrida de verdade em
 * cargo 1 — em cargo 3 (Governador) e 5 (Senador) é a UNIÃO de 27 corridas
 * sob o mesmo espaço de `id`, e `api/model/project.py` grava um PLACEHOLDER
 * (`"Candidato {id}"`) em `national.candidatos[].nome` fora do cargo 1.
 *
 * `cand` (de `candidatosById`) entra só como FALLBACK — payloads pré-ADR-0042,
 * cujo `top_candidatos` vinha sem `nome`/`partido`.
 *
 * 🔴 **`rank` saiu do retorno em 2026-09-20, e a ausência é o conserto.** Ele
 * existia por um motivo só: alimentar o antigo `dotColor`, que pintava pela
 * COLOCAÇÃO quando a sigla não tinha token próprio (federação, sigla ausente).
 * Removido o desvio, um campo `rank` sobrando aqui seria uma arma carregada —
 * o dado a um `??` de distância de voltar a escolher tinta. Agora a ficha
 * **não tem** a colocação em mãos no ponto em que pinta: reintroduzir o defeito
 * exige re-plumbar o campo, não esquecer de uma linha. O número da posição na
 * tela (`1.`, `2.`, …) continua vindo do índice do array, que é ordem de
 * leitura, não identidade.
 */
/** Uma entrada de `EdgeUfRow.top_candidatos[]`, nomeada para o guarda abaixo. */
type TopCandidato = EdgeUfRow["top_candidatos"][number];

/**
 * 🔴 **O único ponto em que a ficha decide se TEM o apurado da candidatura.**
 *
 * `pct_atual` é opcional no contrato (`lib/edge-config/types.ts`) e falta em
 * três situações legítimas — payload pré-2026-09-19, `model_fallback_tier`, e
 * UF sem nenhuma zona apurada em cargo 1, onde o número vem de
 * `impute_uf_from_national` e a fração por candidatura nunca foi medida. Num
 * payload em transição as três convivem com o caso completo na MESMA lista.
 *
 * É um guarda de tipo, e não um `?? 0` na hora de formatar, porque a diferença
 * entre os dois é a diferença entre omitir e **inventar**: `formatPercent(0, 1)`
 * devolve `"0,0%"`, e `"0,0%"` ao lado do rótulo "parcial" afirma que a
 * candidatura teve zero voto apurado — um dos três estados que o dono separou
 * em 14/09 (não começou / não sabemos / apurando). A ausência do campo é o
 * segundo estado; publicá-la como o terceiro é fabricar resultado eleitoral.
 *
 * `typeof === "number"` e não `Number.isFinite`: um `NaN` que chegasse aqui é
 * literalmente "não sabemos", e {@link formatPercent} já o desenha como "—"
 * ao lado do rótulo — que é a leitura certa. Excluí-lo faria a linha perder o
 * rótulo "parcial" e ficar indistinguível da linha que nunca teve o campo.
 */
function temParcialMedida(tc: TopCandidato): tc is TopCandidato & { pct_atual: number } {
  return typeof tc.pct_atual === "number";
}

/**
 * O rótulo colado em cada número ("parcial", "proj.").
 *
 * Mesmo vocabulário e mesma tipografia de `<CandidateResultRow>` — as palavras
 * do produto, não sinônimos novos. `marginLeft` em vez de `gap` porque os dois
 * são texto inline dentro do mesmo bloco: o rótulo precisa quebrar linha JUNTO
 * com o número se um dia quebrar, e um contêiner flex os separaria em caixas.
 */
const KICKER_NUMERO: CSSProperties = {
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  marginLeft: "var(--space-1)",
};

function resolveIdentidade(
  tc: { id: number; nome?: string; partido?: string; sqcand?: string } | undefined,
  cand: EdgeCandidate | undefined,
): {
  nomeBruto: string | undefined;
  partido: string | undefined;
  sqcand: string | undefined;
} {
  return {
    nomeBruto: tc?.nome ?? cand?.nome,
    partido: tc?.partido ?? cand?.partido,
    sqcand: tc?.sqcand ?? cand?.sqcand,
  };
}

export function StateResultSheet({
  open,
  onClose,
  row,
  candidatos,
  side = false,
  cargo,
  viewMode = "proj",
  turno,
}: StateResultSheetProps) {
  const candidatosById = new Map(candidatos.map((c) => [c.id, c]));
  const nomeUf = row ? (UF_NAMES[row.sigla] ?? row.sigla) : "Estado";
  // 🔴 2026-09-21 — a ficha passou a REORDENAR pela base ativa, e o dono
  // decidiu que o `<VagaBadge>` **segue a base** (dívida 2).
  //
  // O que isso conserta: Senador elege DUAS cadeiras, e até hoje esta folha
  // listava sempre em ordem de projeção enquanto a página da UF
  // (`<ResultPanel>`) já reordenava pela base ativa desde `290b8de`. Com o
  // seletor em "Parcial", as duas superfícies nomeavam **duplas diferentes de
  // eleitos**. Não era hipótese: medido em 1 de 27 UFs na fixture do simulado
  // a 25% apurado — em SC a projeção dava `CAROL DE TONI + DÉCIO LIMA` e o
  // apurado dava `CAROL DE TONI + CARLOS BOLSONARO`.
  //
  // `ordenarTopCandidatosPorBase` é o MESMO ponto único que o coroplético
  // usa para a cor e para a ordem do balão (`lib/utils/lider-por-base.ts`), e
  // ele reaproveita os comparadores de `lib/utils/rank-parcial.ts` — os
  // mesmos que `<ResultPanel>` usa. Uma derivação governa ordem, cor e
  // destaque nas três superfícies: é a condição (b) da constituição § 2 v1.5.
  //
  // Quando falta `pct_atual` em alguém do corte, a função devolve a ordem de
  // projeção INTEIRA — nunca trata ausência como zero (decisão do dono,
  // 14/09).
  //
  // 🔴 `usouParcial` (e NÃO `viewMode === "parcial"`) é o que rotula a lista.
  // Os dois divergem exatamente no caso que mais importa para o rótulo: base
  // "Parcial" pedida, mas `pct_atual` ausente em alguém do corte — a função
  // degrada para a ordem de PROJEÇÃO inteira, e um rótulo que lesse `viewMode`
  // afirmaria "ordem de apuração" sobre uma lista ordenada por projeção.
  const { ordenados: topPorBase, usouParcial } = row
    ? ordenarTopCandidatosPorBase(row.top_candidatos, viewMode)
    : { ordenados: [] as EdgeUfRow["top_candidatos"], usouParcial: false };
  const ordemLabel = usouParcial ? "votos apurados" : "projeção";
  // RF-105 — Senado é a única corrida desta ficha com mais de uma vaga por
  // UF. `vagasPorCargo` lê a tabela canônica (`lib/config/cargos.ts`); não é
  // um literal "2" solto aqui.
  const multiVaga = cargo === "sen";
  const vagas = multiVaga ? vagasPorCargo(cargo) : 1;
  // O rótulo do marcador segue a base que a lista DE FATO usou (`usouParcial`,
  // não `viewMode`): "Vaga projetada" sobre uma lista ordenada pelo apurado
  // diria que o modelo projeta o que quem diz é o boletim. Até esta data a
  // folha chamava `<VagaBadge />` sem base — "Vaga projetada" nas duas.
  const baseDoMarcador = usouParcial ? "parcial" : "proj";
  // 2026-09-29 / 2026-10-04 — o selo de BASE de cada linha, pelo ponto único
  // dos cartões das páginas (`selosDaBase`, via `selosDoTopUf`): Senador ⇒ os
  // ocupantes das vagas NA BASE DA LISTA (`ocupantesDasVagas`, o mesmo
  // conjunto do `<ResultPanel>`, do balão e dos cartões de `/senador`);
  // Governador ⇒ "2º turno · …"/"Vence(ria) no 1º turno · …"; Presidente na
  // UF ⇒ nenhum (decisão de 27/09); 2º turno ⇒ nenhum.
  const selos = row
    ? selosDoTopUf(topPorBase, baseDoMarcador, {
        regra: regraSeloNoMapaNacional(cargo),
        turno,
        vagas,
      })
    : new Map<number, string>();
  // 🔴 Identidade do líder — mesma regra de `resolveIdentidade` (RF-144/145):
  // a linha da própria UF (`top_candidatos`) primeiro, `candidatosById`
  // (nacional) só como fallback. `row.lider` é só o ID; o TOP_CANDIDATOS que
  // carrega esse ID pode não existir no top-3 (corrida com 4+ candidatos e
  // líder fora do recorte) — `candidatosById` cobre esse caso raro também.
  //
  // Usada só fora de `multiVaga`: em Senado não existe "o líder" com
  // tratamento próprio (RF-105) — ver o `<ul>` abaixo, onde as `vagas`
  // primeiras linhas ganham o MESMO marcador (`<VagaBadge>`), sem nenhuma
  // delas virar um parágrafo à parte.
  //
  // 🔴 2026-09-21 — `liderIdPorBase`, e NÃO mais `row.lider`. `row.lider` NÃO
  // é o líder apurado apesar do nome: `api/model/project.py` grava `lider` e
  // `top_candidatos[0].id` a partir do mesmo `ordered[0]`, ordenado por
  // `pct_projetado`. Mantê-lo aqui faria a folha DESTACAR alguém que, na base
  // "Parcial", não é mais a primeira linha da sua própria lista — o defeito
  // que esta mudança existe para fechar, na outra metade da tela.
  const liderId = row ? liderIdPorBase(row, viewMode) : undefined;
  const liderTop = liderId != null ? topPorBase.find((tc) => tc.id === liderId) : undefined;
  const liderCand = liderId != null ? candidatosById.get(liderId) : undefined;
  const liderIdentidade = resolveIdentidade(liderTop, liderCand);
  // 🔴 2026-10-04 (dono, dia do 1º turno) — a MESMA marca de vencedor do
  // balão do desktop (fundo cheio + ✓), e só para quem o produtor declarou
  // MATEMATICAMENTE eleito (`row.eleitos_definidos`). Ponto único:
  // `definicaoDaUf` (`lib/utils/eleitos-definidos.ts`) — decide quem é marcado
  // (por `id`, igual nas duas bases do seletor) e o texto de status
  // ("Matematicamente eleito(s)" / "2º turno definido"). Nada aqui lê
  // `chamada`, margem ou posição: projeção não elege ninguém (constituição § 1).
  const definicao = row ? definicaoDaUf(row) : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side={side}
      kicker={row ? `Estado · ${row.sigla}` : undefined}
      title={nomeUf}
    >
      {row ? (
        <>
          {/* 2026-10-04 — status da definição, no topo e visível: o mesmo texto
              do cabeçalho do balão do desktop. Só existe quando o produtor
              emitiu o campo; sem ele, nada (nunca "Chamada"). */}
          {definicao?.rotulo ? (
            <p
              data-testid="state-sheet-status"
              style={{
                margin: "0 0 var(--space-3)",
                font: "var(--type-kicker)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {definicao.rotulo}
            </p>
          ) : null}
          {/* RF-106 — "2 vagas por estado" precisa estar em TODA tela de
              Senador, sem exceção de fase (spec 016:149-152). A ficha cobre o
              resto da página quando aberta (mobile: bottom sheet; desktop:
              cartão sobre o mapa) — sem esta linha, abrir a ficha esconderia
              justamente o aviso que justifica pintar o mapa pelo 1º
              colocado. */}
          {multiVaga ? (
            <p
              data-testid="state-sheet-vagas-label"
              style={{
                margin: "0 0 var(--space-3)",
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
              }}
            >
              2 vagas por estado
            </p>
          ) : null}

          {/* biome-ignore lint/a11y/useSemanticElements: role=group em div é o correto para "grupo de métricas" (mesmo padrão de ApuracaoMeta.tsx); fieldset exigiria legend. */}
          <div
            role="group"
            aria-label={`Resumo da apuração em ${nomeUf}`}
            className="grid grid-cols-2"
            style={{ gap: "var(--space-4)", marginBottom: "var(--space-4)" }}
          >
            <Figure label="Apurado" value={formatPercent(row.pct_apurado, 1)} size="md" />
            {/* RF-104 — rótulo E número por cargo (`margemLabel`/
                `margemParaExibir`). Em Senador o número exibido é a margem de
                2º→3º (`margemSegundaVaga`, `UfPicker.tsx`), não
                `row.margem_projetada` (1º→2º) — que decide a disputa em
                Presidente/Governador (1 vaga), mas não decide nada em Senado
                (2 vagas). Menos de 3 candidatos no top-3 → `NaN` →
                `formatPp` devolve "—" (nunca "0,0 pp": ausência, não zero). */}
            {/* A margem é PROJETADA (`margem_projetada` / 2º→3º sobre
                `top_candidatos[].pct`) ⇒ cor da projeção (dono, 04/10). */}
            <Figure
              label={margemLabel(cargo)}
              value={formatPp(margemParaExibir(cargo, row))}
              size="md"
              color="var(--color-pct-proj)"
            />
          </div>

          {!multiVaga && liderIdentidade.nomeBruto ? (
            <p
              data-testid="state-sheet-lider"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                font: "var(--type-body-sm)",
                color: "var(--text-secondary)",
                margin: "0 0 var(--space-3)",
              }}
            >
              {/* Cor pela SIGLA, via o helper compartilhado — nunca pela
                  colocação. Ver o bloco 🔴 acima de `resolveIdentidade`. */}
              <span
                aria-hidden="true"
                data-testid="state-sheet-lider-dot"
                style={{
                  width: 8,
                  height: 8,
                  flex: "none",
                  borderRadius: "var(--radius-xs)",
                  background: candidateMarkerColor(liderIdentidade.partido),
                }}
              />
              Líder: {nomeExibicao(liderIdentidade.nomeBruto, liderIdentidade.sqcand)}
              {/* Texto desenhado ⇒ sigla abreviada (2026-09-19). A ficha é uma
                  coluna estreita ao lado do mapa. */}
              {liderIdentidade.partido ? ` (${siglaExibicao(liderIdentidade.partido)})` : ""}
            </p>
          ) : null}

          {/* 🔴 O rótulo da base — e ele mudou de AFIRMAÇÃO em 2026-09-20.
              Ver "O que a ficha continua NÃO acompanhando: a ORDEM" na
              docstring do arquivo.

              Dizia "Percentuais de projeção". Com `pct_atual` na tela ao lado
              de `pct`, essa frase virou falsa — e falsa sobre o NÚMERO, que é
              a metade que o leitor usa para decidir o que está acontecendo. O
              que continua sendo só projeção é a ORDEM das linhas (e, em
              Senador, o `<VagaBadge>` que marca as duas primeiras DESSA
              ordem), então é a ordem que o rótulo qualifica.

              Não é um rótulo a menos: é o mesmo elemento com o único trabalho
              que ainda lhe cabe. Cada NÚMERO passou a carregar o próprio
              rótulo na própria linha ("parcial" / "proj."), que é uma
              qualificação mais forte que uma frase geral no topo — ela viaja
              junto com o dado.

              🔴 **2026-09-21 — este parágrafo dizia o contrário.** Ele
              justificava a AUSÊNCIA de `data-view-only` assim: "a ordem é por
              projeção nas duas bases, e sumir na base 'Projeção' tiraria o
              aviso justamente de metade dos casos". Deixou de ser verdade no
              mesmo commit que fez a folha reordenar. Continua sem
              `data-view-only`, mas por outro motivo: o rótulo agora **nomeia a
              base que a lista de fato usou** ({@link ordemLabel}, derivado de
              `usouParcial`), então ele é informativo nas duas bases em vez de
              ser um aviso sobre uma só. Posição inalterada e ainda de
              propósito — acima do `<ul>` e ABAIXO das `<Figure>`, que não são
              ordenadas por nada e pareceriam qualificadas por ele. */}
          <p
            data-testid="state-sheet-base-label"
            style={{
              margin: "0 0 var(--space-2)",
              font: "var(--type-body-sm)",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            Em ordem de {ordemLabel}
          </p>

          <ul
            data-testid="state-sheet-candidatos"
            /* A MESMA formulação do rótulo visível acima, não um sinônimo —
               "projeção" é a palavra do produto (`ViewModeSwitch.tsx:28`,
               `lib/utils/uf-descricao-candidaturas.ts:112`). Está no nome
               acessível porque quem navega por lista salta o rótulo visível.
               Desde 2026-09-21 as duas pontas leem a MESMA variável, para que
               não possam divergir quando a base mudar. */
            aria-label={`Candidatos em ${nomeUf}, em ordem de ${ordemLabel}`}
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {topPorBase.map((tc, index) => {
              const cand = candidatosById.get(tc.id);
              // 🔴 Identidade PRIMEIRO de `tc` (a própria linha da UF), nunca
              // de `cand` (nacional) como fonte primária — ver
              // `resolveIdentidade` acima. Até 2026-09-18 (2ª rodada) esta
              // linha lia `cand.nome`/`cand.sqcand` direto, o mesmo defeito
              // que `buildHoverRows` já tinha corrigido: em cargo 3/5,
              // `cand.nome` é o PLACEHOLDER `"Candidato {id}"` (RF-145), e
              // `tc.nome`/`tc.partido` (quando presentes, RF-144) são o nome
              // real daquela UF.
              const identidade = resolveIdentidade(tc, cand);
              const nome = identidade.nomeBruto
                ? nomeExibicao(identidade.nomeBruto, identidade.sqcand)
                : `#${tc.id}`;
              const partido = identidade.partido ?? "";
              // RF-105 — as `vagas` primeiras linhas (2, só em Senado) ganham
              // o MESMO marcador (`<VagaBadge>`, reaproveitado de
              // `ResultPanel.tsx`). Não é "o 1º e o 2º": é "os dois
              // ocupantes", sem que nenhum dos dois vire um parágrafo à
              // parte (era isso que a antiga linha "Líder:" fazia).
              //
              // 🔴 O marcador é contado do TOPO, nunca do fim do array — por
              // isso a ficha passar de 3 para 4 linhas em 2026-09-19 não mexeu
              // nele: continuam marcadas a 1ª e a 2ª, e agora ficam DUAS de
              // fora em vez de uma. Uma regra escrita como "todas menos a
              // última" teria virado "as três primeiras" em silêncio no dia em
              // que o produtor passou a emitir quatro candidaturas.
              //
              // ADR-0053 / RF-213 — a anulada vem no fim
              // (`ordenarTopCandidatosPorBase`) e nunca ocupa vaga nem
              // recebe colocação.
              const disputa = compete(tc);
              const selo = selos.get(tc.id);
              // 2026-10-04 — matematicamente eleito (ver `definicao` acima).
              // O par (fundo, tinta) é o do balão: `partyChipInk`, contraste
              // medido ≥4,5:1 em todo partido e no par de `outros`.
              const eleito = definicao?.eleitos.has(tc.id) === true;
              const parEleito = eleito ? partyChipInk(identidade.partido) : undefined;
              return (
                <li
                  key={tc.id}
                  style={{
                    padding: "var(--space-2) 0",
                    borderBottom: "1px solid var(--border-hairline)",
                  }}
                >
                  {selo != null ? (
                    <div style={{ marginBottom: "var(--space-1)" }}>
                      {multiVaga ? (
                        // Mesmo texto (`VAGA_LABEL[base]`) e mesmo `data-testid`
                        // de sempre — o `<VagaBadge>` dos cartões.
                        <VagaBadge base={baseDoMarcador} />
                      ) : (
                        <SeloPilula testId="state-sheet-selo" texto={selo} />
                      )}
                    </div>
                  ) : null}
                  {/* 🔴 A identidade ocupa a LINHA INTEIRA, e os números vêm
                      abaixo. Até 2026-09-20 os dois dividiam uma linha só
                      (`justify-between`), o que bastava para UM número; com
                      dois, medido no Chrome a 360px, o nome perdia 37px e
                      **três de quatro candidaturas reais truncavam** — ver a
                      seção "Largura medida a 360px" na docstring do arquivo.

                      A regra de prioridade é a que `<CandidateResultRow>` já
                      registra e o dono já decidiu em 14/09: entre linha mais
                      alta e nome cortado, **o nome ganha**. Uma ficha que
                      escreve "WELLINGT…" identifica menos a pessoa do que
                      qualquer economia de altura compra. */}
                  <div
                    data-testid="state-sheet-cand-identidade"
                    data-eleito={eleito ? "true" : undefined}
                    className="flex min-w-0 items-center"
                    style={{
                      gap: "var(--space-2)",
                      // A faixa do eleito, como a do balão: fundo do partido e
                      // tinta legível sobre ele. Sangra `--space-2` para os
                      // lados (margem negativa + padding iguais) para que o
                      // texto continue alinhado com as linhas sem faixa.
                      ...(parEleito
                        ? {
                            background: parEleito.background,
                            color: parEleito.ink,
                            fontWeight: 600,
                            paddingBlock: "var(--space-1)",
                            paddingInline: "var(--space-2)",
                            marginInline: "calc(-1 * var(--space-2))",
                          }
                        : {}),
                    }}
                  >
                    {/* 🔴 A cor sai da SIGLA e só dela. `index` está bem
                        aqui ao lado e é a tentação: usá-lo para pintar
                        (`colorForRank(index + 1)`) devolveria o defeito que
                        2026-09-20 fechou — e devolveria já na forma pior,
                        porque desde `290b8de` a posição depende da base que
                        o leitor escolhe no botão Parcial/Projeção. */}
                    {eleito ? (
                      // ✓ no lugar do ponto, como no balão: a identidade
                      // partidária já está no FUNDO da faixa.
                      <span
                        aria-hidden="true"
                        data-testid="state-sheet-cand-check"
                        className="flex-none"
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        data-testid="state-sheet-cand-dot"
                        style={{
                          width: 8,
                          height: 8,
                          flex: "none",
                          borderRadius: "var(--radius-xs)",
                          background: candidateMarkerColor(identidade.partido),
                        }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      style={{ color: eleito ? undefined : "var(--text-muted)" }}
                    >
                      {disputa ? `${index + 1}.` : "—"}
                    </span>
                    {/* 🔴 Sem `truncate`: o nome QUEBRA em vez de cortar.
                        `minWidth: 0` porque, sem `overflow: hidden`, o
                        `min-width: auto` do item flex passa a valer a MAIOR
                        palavra e voltaria a empurrar a linha; `break-word` é o
                        último recurso para um token único maior que a coluna —
                        quebrar no meio da palavra ainda mostra o nome inteiro, e
                        reticências não. Mesma solução e mesma razão do ramo com
                        avatar de `<CandidateResultRow>`. */}
                    <span
                      data-testid="state-sheet-cand-nome"
                      className="min-w-0"
                      style={{
                        font: "var(--type-body)",
                        minWidth: 0,
                        overflowWrap: "break-word",
                      }}
                    >
                      {nome}
                      {eleito ? <span className="sr-only">, matematicamente eleito</span> : null}
                    </span>
                    <DestinoEtiqueta destino={tc.destino} />
                    {partido ? (
                      <span
                        className="flex-none"
                        style={{
                          font: "var(--type-kicker)",
                          letterSpacing: "var(--tracking-caps)",
                          textTransform: "uppercase",
                          // Sobre a faixa do eleito, a tinta da faixa (o
                          // secundário não tem contraste medido sobre o chip).
                          color: eleito ? undefined : "var(--text-secondary)",
                        }}
                      >
                        {/* Desenhado ⇒ abreviado (2026-09-19). */}
                        {siglaExibicao(partido)}
                      </span>
                    ) : null}
                  </div>

                  {/* 🔴 Os DOIS números, na própria linha — e o da esquerda só
                      existe quando o dado existe. Ver {@link temParcialMedida}
                      para por que a ausência não vira `0,0%`, e o bloco
                      "`pct_atual` é OPCIONAL" na docstring do arquivo para as
                      três situações legítimas em que ela acontece.

                      Mesma ordem de leitura de `<CandidateResultRow>` — parcial
                      à esquerda, projeção à direita —, para que as duas
                      superfícies não ensinem gramáticas diferentes. */}
                  <div
                    data-testid="state-sheet-cand-numeros"
                    className="flex items-baseline justify-end"
                    style={{
                      gap: "var(--space-4)",
                      marginTop: "var(--space-1)",
                      font: "var(--type-figure-sm)",
                    }}
                  >
                    {!exibePercentual(tc) ? (
                      // Emenda "opção A" ao ADR-0053 — a anulada não mostra
                      // percentual (o dela é sobre outra base): só os votos,
                      // ou nada quando o dado não os traz.
                      votosDaAnulada(tc.votos_atuais) !== null ? (
                        <span
                          data-testid="state-sheet-cand-votos-anulada"
                          className="flex-none"
                          style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}
                        >
                          {votosDaAnulada(tc.votos_atuais)}
                        </span>
                      ) : null
                    ) : temParcialMedida(tc) ? (
                      <span
                        data-testid="state-sheet-cand-parcial"
                        className="flex-none"
                        style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}
                      >
                        {formatPercent(tc.pct_atual, 1)}
                        <span style={{ ...KICKER_NUMERO, color: "var(--text-muted)" }}>
                          parcial
                        </span>
                      </span>
                    ) : null}
                    {exibePercentual(tc) ? (
                      <span
                        data-testid="state-sheet-cand-proj"
                        className="flex-none"
                        // 🔴 04/10 (dono): percentual projetado ⇒ cor da projeção.
                        style={{ color: "var(--color-pct-proj)", whiteSpace: "nowrap" }}
                      >
                        {formatPercent(tc.pct, 1)}
                        {/* Abreviado na tela (a linha é estreita), por extenso
                          para quem ouve. `aria-hidden` no desenhado + `sr-only`
                          com a palavra inteira, nunca os dois audíveis — senão o
                          leitor de tela ouve "proj. projeção". A parcial não
                          precisa do par: a palavra desenhada já é a inteira. */}
                        <span aria-hidden="true" style={KICKER_NUMERO}>
                          proj.
                        </span>
                        <span className="sr-only"> projeção</span>
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* ADR-0053 / RF-213 — só quando há anulada no corte. */}
          {haAnulada(row.top_candidatos) ? (
            <p
              data-testid="state-sheet-nota-anuladas"
              style={{
                margin: "var(--space-2) 0 0",
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                textWrap: "pretty",
              }}
            >
              {notaAnuladas(!multiVaga)}
            </p>
          ) : null}

          <Link
            href={ufHref(cargo, row.sigla)}
            data-testid="state-sheet-cta"
            className="mt-4 inline-flex items-center justify-center rounded-sm hover:brightness-125"
            style={{
              height: "var(--tap-min)",
              padding: "0 var(--space-4)",
              width: "100%",
              background: "var(--surface-inverse)",
              color: "var(--text-inverse)",
              border: "1px solid var(--surface-inverse)",
              font: "var(--type-label)",
              fontSize: "var(--text-sm)",
              letterSpacing: "0.02em",
              textDecoration: "none",
              transition: "filter var(--dur-fast) var(--ease-out)",
            }}
          >
            Ver detalhes do estado
          </Link>
        </>
      ) : null}
    </Sheet>
  );
}
