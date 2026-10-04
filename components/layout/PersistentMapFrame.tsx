"use client";

/**
 * components/layout/PersistentMapFrame.tsx
 *
 * O mapa que NÃO desmonta ao trocar de UF — a Decisão 1 do
 * [ADR-0033](../../docs/architecture/adrs/0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md)
 * ("jeito C": moldura persistente, endereço sempre muda).
 *
 * ## Por que ele busca o próprio dado
 *
 * Este componente é montado pelo `layout.tsx` do grupo de rotas — `(pres)`
 * para Presidente (`/` ↔ `/uf/[sigla]`), `(gov)` para Governador
 * (`/governador` ↔ `/uf/[sigla]/governador`). O App Router não desmonta um
 * segmento de layout quando só o `page.tsx` filho muda, e é exatamente isso
 * que faz o mapa sobreviver à navegação.
 *
 * Só que um `layout.tsx` ACIMA de um segmento dinâmico não recebe `sigla` por
 * `params` no servidor — quem recebe é o layout aninhado DENTRO do segmento.
 * Então a UF corrente é resolvida no cliente (`useParams()`), e o dado vem de
 * `GET /api/projection` em vez de props do `page.tsx`. É essa troca que
 * desacopla o ciclo de vida do mapa do ciclo de vida de cada página; receber
 * props do `page.tsx` recriaria o acoplamento que a decisão desfaz.
 *
 * O ADR nomeia o custo, e ele é real: passa a haver dois caminhos de dado para
 * a mesma projeção — este, client-side, e o que cada página ainda faz no
 * servidor para os próprios painéis. Os dois podem ficar dessincronizados por
 * alguns segundos, mitigado pela cadência de 60s (ADR-0011) e pelo cache de
 * CDN de 30s do endpoint (ADR-0002).
 *
 * ## 2026-09-09 (map-builder) — a moldura agora desce para o município
 *
 * O ADR autorizava uma primeira versão parcial em que a moldura mostrava
 * SEMPRE o nível Brasil — o trabalho de fazer o nível seguir a rota ficou
 * explicitamente marcado como tarefa do `map-builder`. É isto que este
 * arquivo passa a fazer: quando `sigla` está presente, a moldura troca o
 * mapa nacional (PMTiles de UF) pelo coroplético municipal
 * (`ChoroplethMapUF`/`UfLeaderMapLazy`, PMTiles de município) da própria UF,
 * com o dado vindo de `GET /api/projection/municipios?uf=<sigla>&cargo=<c>`
 * — o espelho client-side de `readUfDetail` (`lib/blob/uf-detail.ts`,
 * ADR-0032), que só pode rodar no servidor.
 *
 * `NationalMapBlock`/`_NationalChoroplethMapImpl` (nacional) e
 * `ChoroplethMapUF` (municipal) continuam sendo DUAS implementações MapLibre
 * distintas — fontes PMTiles diferentes (`ufs.pmtiles` vs
 * `municipios.pmtiles`), propriedades de feature diferentes (`SIGLA_UF` vs
 * `CD_MUN`), lógicas de enquadramento diferentes. Trocar de nível troca de
 * COMPONENTE React (tipos diferentes), então o React desmonta a árvore
 * anterior por inteiro — a instância `maplibregl.Map` de um nível é destruída
 * e uma nova é criada para o outro. Isto é exatamente a "primeira versão
 * aceitável" que o ADR nomeia ("mesmo que o `MapLibre.Map` interno ainda
 * reinicialize ao trocar de fonte") — o ganho desta mudança é o WRAPPER React
 * (este componente, o cabeçalho da moldura, os controles) não perder o
 * ciclo de vida na navegação Brasil↔UF; a instância WebGL em si ainda
 * reinicializa. Unificar as duas implementações numa única instância que faz
 * `flyTo` continua não especificado — fica para uma iteração futura.
 *
 * Governador (`cargo="gov"`) ganha o MESMO drill-down: no nível UF, mostra o
 * MESMO coroplético municipal que a rota presidencial usa, porque é o mesmo
 * tipo de dado (`EdgeUfMunicipio[]`) e o mesmo componente já existia para as
 * duas corridas antes desta mudança (`app/(gov)/uf/[sigla]/governador/page.tsx`).
 *
 * ## 2026-09-18 (map-builder) — o nível Brasil de Governador troca de mapa
 *
 * Até aqui o nível Brasil de Governador mostrava `<HexCartogramBrasil>` — um
 * cartograma hexagonal sem equivalente de "nível UF". Pedido do dono: o mesmo
 * coroplético MapLibre+PMTiles do nível Brasil de Presidente
 * (`NationalMapBlock` variant="frame"), pintado pelo partido do líder de CADA
 * UF na corrida de GOVERNADOR (não de Presidente) e com hover mostrando a
 * parcial daquela UF para Governador. `<HexCartogramBrasil>` continua no
 * repositório, intacto — só sai de uso NESTA rota; não há botão de
 * alternância entre os dois mapas nesta tela.
 *
 * O dado já serve o coroplético sem mudança de produtor: `EdgePayload` e
 * `EdgeUfRow` são os MESMOS tipos nos dois cargos, e `EdgeUfRow.top_candidatos`
 * já carrega `nome`/`partido`/`sqcand` resolvidos por UF em todo cargo
 * (RF-144/ADR-0042 item 3) — é o que faz o hover mostrar o nome real do
 * candidato do estado certo, e não "Candidato N" nem o nome de outra UF (ver
 * `buildHoverRows` em `_NationalChoroplethMapImpl.tsx`).
 *
 * ## 2026-09-18 (2ª rodada, map-builder) — Senador ganha a MESMA moldura
 *
 * Pedido do dono, ciente de uma diferença que a spec 016 nomeia: Senador tem
 * **2 vagas por UF**, não 1. Pintar cada UF pelo LÍDER LOCAL (como Presidente
 * e Governador já fazem) sugeriria um vencedor único onde a eleição elege
 * dois — decisão explícita do dono (D1): pintar mesmo assim, DESDE QUE o
 * rótulo de duas vagas fique explícito na própria superfície do mapa (ver
 * `escopo` abaixo, sufixo "· 2 vagas" só em `cargo === "sen"`).
 *
 * `cargo === "sen"` reaproveita o MESMO `<NationalMapBlock variant="frame">`
 * do nível Brasil de Presidente/Governador — mesma razão da entrada de
 * Governador acima (`EdgeUfRow`/`EdgeCandidate` são os mesmos tipos nos três
 * cargos). Uma diferença restante, e ela é AUSÊNCIA de recurso, não escolha de
 * design:
 *
 *   1. ✅ **Nível UF — EXISTE desde 2026-09-19** (pedido do dono). Este item
 *      afirmava o contrário até então, e a afirmação era verdadeira por três
 *      razões somadas: `spec 016 § Escopo/Fora` tirava "mapa municipal e
 *      maiores colégios" de escopo; `municipios-sen-t1.json` gravava
 *      `municipios: []` de propósito; e `/api/projection/municipios` não tinha
 *      ramo para `cargo=sen` — `resolveCargoETurno` caía no default
 *      PRESIDENCIAL para qualquer valor que não fosse `"gov"`, de modo que
 *      pedir o mapa do Senado pintaria o município errado sob o rótulo
 *      "Senado" em silêncio, a mesma classe de bug que já mordeu este
 *      repositório três vezes com conversor de cargo. Enquanto isso valia, os
 *      dois efeitos de busca do nível UF (`ufResumo`, `municipioDetalhe`) nem
 *      disparavam para `sen`: não bastava ignorar o resultado, a leitura não
 *      podia acontecer.
 *
 *      As três razões caíram na mesma rodada. O gerador do simulado passou a
 *      emitir municípios para os três cargos; `/api/projection/municipios` e
 *      `/api/projection?uf=` passaram a resolver cargo por TABELA, com **400
 *      `invalid_cargo`** para o que não conhecem — nunca mais o presidencial
 *      calado. A defesa deixou de ser "não pergunte" e passou a ser "a
 *      resposta é do cargo certo ou não é resposta", que é a forma forte: se
 *      um dia a tabela perder `sen`, o sintoma é 400 na tela, visível, e não
 *      um mapa bonito e errado.
 *
 *      ⚠️ O que NÃO mudou: a cobertura municipal é estruturalmente parcial em
 *      todos os cargos (`docs/reference/risks.md:78`), e `spec 016 §
 *      Escopo/Fora` ainda não foi emendada — pendência desta rodada, e
 *      enquanto durar o código contradiz a spec.
 *   2. **Sem `rankByLider`**, pela MESMA razão já documentada para `"gov"`
 *      logo abaixo: em corrida majoritária o número de urna é o número do
 *      partido, e o mesmo partido concorre em várias UFs com o mesmo número.
 *      `national.candidatos` do cargo 5 é a união de 27 corridas (RF-145,
 *      mesmo contrato de RF-145 para cargo 3) — reaproveita o argumento já
 *      escrito, não duplica.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { municipiosTotalFor, rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import { MapSkeleton } from "@/components/atoms/maps/MapSkeleton";
import { MapZoomControls } from "@/components/atoms/maps/MapZoomControls";
import {
  DetailUnavailable,
  type DetailUnavailableReason,
} from "@/components/atoms/surfaces/DetailUnavailable";
import { candidateColor } from "@/components/blocks/_candidateColor";
import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { CHIP_STYLE, NationalMapBlock } from "@/components/blocks/NationalMapBlock";
import { UfLeaderMapLazy } from "@/components/blocks/UfMapsLazy";
import { UfPicker, type UfPickerCargo } from "@/components/layout/UfPicker";
import { cargoFromToken, isExterior } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import type { EdgePayload, EdgePayloadUf, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { useDadoFrescorStore } from "@/lib/state/dado-freshness-store";
import { usePorUfStore } from "@/lib/state/por-uf-store";
import { formatPercent } from "@/lib/utils/format";
import { ehPlacarZerado } from "@/lib/zerado/marca";

/** Mesma cadência de escrita do orchestrator (ADR-0011). */
const REFRESH_MS = 60_000;

const CARGO_LABEL: Record<UfPickerCargo, string> = {
  pres: "Presidente",
  gov: "Governador",
  sen: "Senador",
};

/** Rota "nível Brasil" de cada cargo — o destino do link "← Brasil". */
const HOME_HREF: Record<UfPickerCargo, string> = {
  pres: "/",
  gov: "/governador",
  sen: "/senador",
};

export interface PersistentMapFrameProps {
  /** Grupo de rotas que hospeda esta moldura. */
  cargo: UfPickerCargo;
}

/** `params.sigla` vem como `string | string[] | undefined`. */
function siglaFromParams(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const sigla = value.toUpperCase();
  return /^[A-Z]{2}$/.test(sigla) ? sigla : null;
}

/** Resposta de `GET /api/projection/municipios`. */
type MunicipioDetalheState =
  | { status: "ok"; municipios: EdgeUfMunicipio[] }
  | { status: "unavailable"; reason: DetailUnavailableReason }
  | null; // null = ainda carregando

export function PersistentMapFrame({ cargo }: PersistentMapFrameProps) {
  const params = useParams<{ sigla?: string | string[] }>();
  const sigla = siglaFromParams(params?.sigla);

  const [payload, setPayload] = useState<EdgePayload | null>(null);
  const [ufResumo, setUfResumo] = useState<EdgePayloadUf | null>(null);
  const [municipioDetalhe, setMunicipioDetalhe] = useState<MunicipioDetalheState>(null);

  // Payload nacional do cargo — não depende da rota, só do grupo. Busca uma
  // vez por montagem da moldura (ou seja, uma vez por sessão de navegação
  // dentro do cargo) e revalida a cada 60s. Sem o intervalo o mapa congelaria
  // pela sessão inteira: agora que ele não remonta, ninguém mais o atualiza.
  //
  // ADR-0038 D4, segunda metade (2026-09-13) — este é também o único relógio
  // vivo do `dado_ts` no cliente. O `<DadoParadoBanner>` das páginas é irmão
  // desta árvore (ele vem do `page.tsx`, esta moldura vem do `layout.tsx`) e
  // não tinha como saber que o dado do TSE parou depois que a página abriu: o
  // veredito dele era calculado uma vez, no render de servidor. O payload que
  // já chega aqui a cada 60s carrega `dado_ts` (`lib/edge-config/types.ts:570`),
  // então publicá-lo na store (`lib/state/dado-freshness-store.ts`) não custa
  // requisição nem query novas — é um campo que já vinha e era descartado.
  useEffect(() => {
    // `pres` é o único sem query string (comportamento original do endpoint,
    // ADR-0033 § 1); `gov`/`sen` (e qualquer cargo futuro que ganhe moldura)
    // passam `?cargo=<token>` — `app/api/projection/route.ts` tem um ramo por
    // cargo, não um catch-all, então um cargo sem ramo lá devolve 503 em vez
    // de servir a corrida errada em silêncio.
    const url = cargo === "pres" ? "/api/projection" : `/api/projection?cargo=${cargo}`;
    // Token → código do TSE por função total (`"pres"` → 1, `"gov"` → 3), que
    // lança em token desconhecido. Um ternário aqui seria a terceira aparição
    // do mesmo bug nesta base: conversor de enum de cargo com ramo `default`
    // silencioso publicando na chave errada.
    const cargoTse = cargoFromToken(cargo);
    // `getState()`, não o hook: as ações do Zustand têm referência estável, e
    // assinar a store aqui só rerrenderizaria a moldura à toa.
    const { registrarPoller, publicarDadoTs } = useDadoFrescorStore.getState();
    const { publicarPorUf } = usePorUfStore.getState();
    // A baixa é dada no cleanup. O registro é o que AUTORIZA o banner a
    // reavaliar por tempo — sem ele, o banner fica com o veredito do servidor
    // em vez de inventar um a partir de uma semente que ninguém atualiza.
    const darBaixaNoPoller = registrarPoller(cargoTse);
    let vivo = true;
    const buscar = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = (await res.json()) as EdgePayload;
        if (!vivo) return;
        setPayload(json);
        // `json.dado_ts` vai CRU: `undefined` (payload pré-ADR-0038, em voo no
        // canary) e `null` (ciclo sem `dg`/`hg` parseável) são estados
        // diferentes, e um `??` aqui é o default silencioso que o ADR-0038 D1
        // proíbe no payload — não deixa de ser o mesmo erro por acontecer no
        // estado do cliente.
        //
        // Só publica se o payload concordar com o cargo desta moldura. A URL
        // acima já determina o cargo, então discordar significa que o endpoint
        // devolveu a corrida errada; publicar isso na chave deste cargo seria
        // mandar o relógio de um cargo para o banner de outro. Não publicar
        // deixa o último `dado_ts` conhecido valendo e o relógio de parede
        // andando — que é a degradação honesta.
        if (json.cargo === cargoTse) {
          publicarDadoTs(cargoTse, json.dado_ts);
          // 2026-10-04 — o `por_uf` vai junto, com a MESMA guarda de cargo: a
          // folha do município lê dele os eleitos definidos da UF
          // (`lib/state/por-uf-store.ts`). Payload malformado sem a lista não
          // publica nada — a folha fica sem o ✓, que é a omissão honesta.
          if (Array.isArray(json.por_uf)) publicarPorUf(cargo, json.por_uf);
        }
      } catch {
        // Silencioso de propósito: a moldura degrada para o esqueleto, e os
        // painéis da página (renderizados no servidor) seguem com o dado. Para
        // o banner, um `fetch` que falha é indistinguível de dado parado — e
        // deve mesmo acabar acendendo o aviso, porque a página perdeu a
        // capacidade de confirmar que o TSE avança.
      }
    };
    void buscar();
    const id = setInterval(() => void buscar(), REFRESH_MS);
    return () => {
      vivo = false;
      clearInterval(id);
      darBaixaNoPoller();
    };
  }, [cargo]);

  // Resumo da UF corrente — é o que dá o "% apurado" da etiqueta quando a rota
  // é de UF. Refaz a cada troca de `sigla`, sem tocar no mapa.
  //
  // 🔴 **2026-09-19 — o `&cargo=` desta URL é o conserto de um defeito, não um
  // parâmetro novo.** Até hoje a chamada era `?uf=${sigla}` seca, e o endpoint
  // cravava `cargo: "pres"`: a moldura de GOVERNADOR recebia a lista de
  // candidatos do PRESIDENTE. Os `id` não casavam com os `votos_reportados` de
  // governador, toda linha do balão caía no fallback `"Candidato {id}"` com
  // `partido: undefined` (`lib/utils/municipio-votos.ts:107-108`), a coluna
  // "Part." sumia inteira por `hasPartido`, e o coroplético ficava
  // `var(--color-tossup)`. Era invisível porque o payload respondia 200 com
  // forma válida — só o CONTEÚDO era de outra corrida.
  //
  // O bloqueio de `cargo === "sen"` que vivia aqui saiu junto. Ele existia
  // porque, sem `cargo` na URL, chamar este endpoint para Senador herdaria
  // dado presidencial sob o rótulo "Senado" em silêncio — o bloqueio era a
  // única defesa possível enquanto a rota mentia. Agora a rota responde pelo
  // cargo pedido, e um cargo fora da tabela responde **400 `invalid_cargo`**
  // em vez do presidencial calado, então a defesa mudou de lugar: deixou de
  // ser "não pergunte" e passou a ser "a resposta é do cargo certo ou não é
  // resposta".
  useEffect(() => {
    if (!sigla) {
      setUfResumo(null);
      return;
    }
    let vivo = true;
    const buscar = async () => {
      try {
        const res = await fetch(`/api/projection?uf=${sigla}&cargo=${cargo}`);
        if (!res.ok) return;
        const json = (await res.json()) as EdgePayloadUf;
        if (vivo) setUfResumo(json);
      } catch {
        // Idem: a etiqueta fica sem o percentual, o mapa não muda.
      }
    };
    void buscar();
    // 🔴 04/10 noite — renova sozinho (pedido do dono), mesma cadência do
    // payload nacional acima.
    const id = setInterval(() => void buscar(), REFRESH_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [sigla, cargo]);

  // Detalhe municipal da UF corrente (ADR-0032, via o espelho client-side em
  // `/api/projection/municipios`) — é o que pinta o coroplético por
  // município. Refaz a cada troca de `sigla` ou de `cargo` (Presidente e
  // Governador têm candidatos e cobertura diferentes na mesma UF).
  //
  // 🔴 **2026-09-19 — `sen` passou a disparar esta busca.** O bloqueio que
  // vivia aqui está preservado como memória, porque a armadilha que ele
  // descrevia continua real: `resolveCargoETurno` (`app/api/projection/
  // municipios/route.ts`) reconhecia SÓ `"gov"`, e qualquer outro valor —
  // inclusive `"sen"` — caía no default PRESIDENCIAL. Pedir `cargo=sen`
  // naquele mundo pintaria o coroplético municipal de Presidente sob o rótulo
  // "Senado", em silêncio: a mesma classe de bug que os conversores de cargo
  // desta base já pagaram três vezes.
  //
  // O que mudou não foi a avaliação do risco, foi a rota: ela agora resolve
  // por tabela (`Object.hasOwn`) e responde **400 `invalid_cargo`** para o que
  // não conhece, em vez do presidencial calado. Com isso a ausência deixou de
  // precisar ser protegida por omissão. Se algum dia a tabela perder `sen`, o
  // sintoma será 400 na tela — visível —, não um mapa bonito e errado.
  useEffect(() => {
    if (!sigla) {
      setMunicipioDetalhe(null);
      return;
    }
    let vivo = true;
    setMunicipioDetalhe(null);
    // 🔴 04/10 noite — renova sozinho a cada `REFRESH_MS` (pedido do dono: o
    // mapa municipal só mudava ao recarregar a página). Numa renovação, falha
    // NÃO substitui o último dado bom — o mapa não volta a cinza por um
    // soluço de rede (três estados e não-regressão, decisão de 14/09). O
    // "indisponível" só aparece se nunca houve dado bom nesta UF/cargo.
    const buscar = async () => {
      try {
        const res = await fetch(`/api/projection/municipios?uf=${sigla}&cargo=${cargo}`);
        if (!res.ok) return;
        const json = (await res.json()) as
          | { status: "ok"; municipios: EdgeUfMunicipio[] }
          | { status: "unavailable"; reason: DetailUnavailableReason };
        if (!vivo) return;
        setMunicipioDetalhe((anterior) =>
          json.status !== "ok" && anterior?.status === "ok" ? anterior : json,
        );
      } catch {
        if (!vivo) return;
        setMunicipioDetalhe((anterior) =>
          anterior?.status === "ok" ? anterior : { status: "unavailable", reason: "fetch_error" },
        );
      }
    };
    void buscar();
    const id = setInterval(() => void buscar(), REFRESH_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [sigla, cargo]);

  // RF-106 (spec 016) — "2 vagas por estado" já é texto de sempre nas duas
  // páginas de Senador (`app/(sen)/senador/page.tsx`,
  // `data-testid="senado-vagas-label"`); ESTE sufixo é o mesmo rótulo na
  // superfície NOVA — o cabeçalho da moldura do mapa —, decisão D1 do dono: o
  // mapa pinta o líder local (como Presidente/Governador), e uma corrida de 2
  // vagas ao lado de um mapa de 1 cor por UF sugeriria vencedor único sem
  // este aviso.
  // 🔴 `typeof … === "number"`, não `ufResumo ?`. O valor vem de `fetch` e é
  // apenas CASTADO para `EdgePayloadUf` — ninguém valida a forma no caminho.
  // Um 200 com corpo inesperado (rota devolvendo o payload nacional, deploy a
  // meio caminho, proxy que reescreve) fazia `.toFixed` estourar DENTRO do
  // render, e o erro não fica contido: derruba a moldura inteira, que é o
  // mapa da noite da apuração. Trocar um rótulo por uma tela branca é o pior
  // câmbio possível — constituição § 7. Com a guarda, a etiqueta perde o
  // percentual e o mapa continua de pé.
  //
  // Passou a importar em 2026-09-19: até então `sen` nem disparava a busca,
  // então este caminho não existia para um dos três cargos.
  const escopo = sigla
    ? `${CARGO_LABEL[cargo]} · ${rotuloDaUnidade(sigla)}${
        typeof ufResumo?.pct_apurado === "number"
          ? ` · ${formatPercent(ufResumo.pct_apurado, 1)} apurado`
          : ""
      }${cargo === "sen" ? " · 2 vagas" : ""}`
    : `${CARGO_LABEL[cargo]} · Brasil${cargo === "sen" ? " · 2 vagas" : ""}`;
  // Sempre string (o "Brasil" do cargo corrente) — usado tal qual pelos dois
  // chromes de nível UF abaixo. `NationalMapBlock` (nível Brasil) só desenha
  // o link "← Brasil" quando recebe `backHref`, então ali é passado
  // condicionalmente (`sigla ? homeHref : undefined`) — o próprio nível
  // Brasil não deve exibir um link "voltar para si mesmo".
  const homeHref = HOME_HREF[cargo];

  if (!payload) {
    // 2026-09-27 — envolto em `.canvasFill` (não solto): a partir desta
    // mudança `.split .map` (`AppShellSplit.module.css`) não tem mais altura
    // própria no celular (ela cresce com o cromo em fluxo abaixo do mapa,
    // que aqui ainda não existe — sem payload não há cromo a montar). Sem o
    // wrapper, `height="100%"` do esqueleto resolveria contra um pai
    // `height: auto` e a caixa colapsaria pra 0 até o 1º payload chegar.
    return (
      <div className={mapFrameStyles.canvasFill}>
        <MapSkeleton height="100%" />
      </div>
    );
  }

  // 🔴 RF-153/RF-157 — a moldura tem o payload (ela mesma o busca, ver o topo
  // deste arquivo), então é ela quem pergunta a fase. `isPreEleicao` lê o campo
  // `fase` e NADA além dele: gatear em `pct_apurado_total === 0` poria o mapa
  // em cinza às 20h01 de 04/10, com a apuração já correndo (ADR-0043 D5).
  const preEleicao = isPreEleicao(payload);
  // 🔴 ADR-0076 — placar zerado (marcado pela rota de leitura): o mapa é
  // desenhado, todo em `--map-uncounted`, sem legenda de líder — a mesma
  // supressão da fase pré, mas SEM a frase de espera no lugar do mapa.
  const zerado = ehPlacarZerado(payload);
  const mapaCinza = preEleicao || zerado;

  // Candidatos da UF (cor por candidato) — vem do resumo (ADR-0012), não do
  // detalhe municipal. Enquanto `ufResumo` ainda não chegou, o coroplético
  // pinta tudo em `--color-tossup` (mesmo fallback que as páginas de UF já
  // usavam antes desta mudança).
  // 🔴 A cor sai da SIGLA (ADR-0024), não de `c.cor` — que é a paleta por
  // COLOCAÇÃO do ADR-0013. Este mapa é o coroplético MUNICIPAL da moldura:
  // com a cor de rank, o mesmo partido saía de uma cor no mapa e de outra na
  // legenda ao lado, e uma ultrapassagem repintava municípios que não
  // mudaram de líder.
  //
  // O 2º argumento é o ÍNDICE + 1, não um `c.rank`: `EdgeUfCandidate` não
  // carrega rank (o array já chega ordenado pela corrida da UF — ADR-0012). Ele
  // só é consultado no fallback de sigla fora da paleta editorial.
  const corPorCandidato: Record<number, string> = {};
  (ufResumo?.candidatos ?? []).forEach((c, i) => {
    corPorCandidato[c.id] = candidateColor(c.partido, i + 1);
  });

  const municipiosDaUf =
    municipioDetalhe?.status === "ok" ? municipioDetalhe.municipios : ([] as EdgeUfMunicipio[]);
  // 🔴 04/10 — município sem voto apurado vem com um `lider` de 0 votos (o
  // primeiro candidato da lista); pintá-lo com essa cor inventava vencedor.
  // Sem voto = `--map-uncounted`, mesmo cinza do placar zerado (ADR-0076).
  const choropleth = municipiosDaUf.map((m) => ({
    cod_ibge: m.cod_ibge,
    cor:
      mapaCinza || !(m.pct_apurado > 0) || !(m.lider.votos > 0)
        ? "var(--map-uncounted)"
        : (corPorCandidato[m.lider.candidato_id] ?? "var(--color-tossup)"),
    pctApurado: m.pct_apurado,
  }));

  if (cargo === "gov") {
    if (sigla) {
      // Nível UF — mesmo coroplético municipal da rota presidencial. O
      // "quem lidera cada município" que antes vivia num Panel da própria
      // página de UF (`app/(gov)/uf/[sigla]/governador/page.tsx`) mudou
      // de endereço, não de conteúdo — ADR-0033 § 1.
      //
      // 🔴 2026-09-27 — o cabeçalho (h2 + `<UfPicker>`) já vivia EM FLUXO,
      // acima do mapa (não sobreposto) — só o "← Brasil" flutuava por cima do
      // canvas. Mas "em fluxo acima do mapa" ainda não é o pedido do dono
      // para o celular (versão B do protótipo): lá o mapa vem PRIMEIRO,
      // sem nada acima nem sobre ele, e o cabeçalho desce para depois. Por
      // isso o cabeçalho GANHA uma segunda marcação (`.mobileChrome`, mesmo
      // texto, sem `id` compartilhado — ver a nota de
      // `MapFrameMobile.module.css` sobre por que a troca é de marcação e não
      // só de CSS) — a cópia de desktop continua em `.desktopOverlay` (que
      // aqui vira "acima do canvas em fluxo", não overlay de verdade, mas a
      // MESMA classe de visibilidade por breakpoint). `aria-label` direto na
      // `<section>` substitui o antigo `aria-labelledby`/`id` compartilhado:
      // com duas cópias visuais do título, um `id` só nunca poderia estar nas
      // duas ao mesmo tempo sem duplicar o atributo (inválido em HTML).
      const heading = `${sigla} · quem lidera cada município`;
      return (
        <section aria-label={heading} className={mapFrameStyles.frameRootFlex}>
          <div
            className={[
              mapFrameStyles.desktopOverlay,
              "flex-wrap items-start justify-between",
            ].join(" ")}
            style={{ gap: "var(--space-2)" }}
          >
            <h2
              style={{
                margin: 0,
                font: "var(--type-kicker)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {heading}
            </h2>
            <UfPicker cargo="gov" atual={sigla} />
          </div>
          <div className={mapFrameStyles.canvasFlex}>
            {/* `detalhe`/`candidatos` (2026-09-18) — sem eles, o
                `<ChoroplethMapUF>` colore normalmente mas o `<HoverCard>`
                nunca aparece (as duas props são opcionais e checadas lá
                dentro); `candidatos` chega `undefined` enquanto `ufResumo`
                (busca client-side acima) ainda não resolveu — o balão
                aparece sozinho assim que resolver, sem exigir novo hover
                (ver docstring de `MunicipioTooltipState` em
                `ChoroplethMapUF.tsx`). */}
            <UfLeaderMapLazy
              ufSigla={sigla}
              choropleth={choropleth}
              height="100%"
              detalhe={municipiosDaUf}
              candidatos={ufResumo?.candidatos}
            />
            {municipioDetalhe?.status === "unavailable" && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "var(--surface-card)",
                  borderTop: "1px solid var(--border-hairline)",
                }}
              >
                <DetailUnavailable
                  label="A cor por município deste mapa"
                  reason={municipioDetalhe.reason}
                  style={{ borderTop: "none", padding: "var(--space-2) var(--space-3)" }}
                />
              </div>
            )}
            {/* "← Brasil" sobreposto ao canvas — SÓ DESKTOP. No celular ele
                desce para a barra, junto do "Escolher UF" (pedido do dono:
                "o ← Brasil vai para a barra ao lado do Escolher UF"). */}
            <Link
              href={homeHref}
              className={[mapFrameStyles.desktopOverlayInline, "pointer-events-auto absolute"].join(
                " ",
              )}
              style={{ ...CHIP_STYLE, top: "var(--space-2)", left: "var(--space-2)" }}
            >
              ← Brasil
            </Link>
            {/* ADR-0071 — +/−/⟲ sobre o mapa, canto inferior direito, SÓ
                DESKTOP; no celular a cópia fica na faixa abaixo (`.mobileChrome`). */}
            <MapZoomControls variant="desktop" />
          </div>
          <div className={mapFrameStyles.mobileChrome}>
            <MapZoomControls variant="bar" />
            <div className={mapFrameStyles.bar}>
              <Link href={homeHref} className={mapFrameStyles.btn}>
                ← Brasil
              </Link>
              <div className={mapFrameStyles.barSpacer} />
              <UfPicker cargo="gov" atual={sigla} />
            </div>
            <div className={mapFrameStyles.footer}>
              <h2 className={mapFrameStyles.title}>{heading}</h2>
            </div>
          </div>
        </section>
      );
    }

    if (preEleicao || payload.por_uf.length === 0) {
      // RF-157, aplicado ao "mapa" desta trilha. Antes desta mudança
      // (2026-09-18) quem pintava aqui era o cartograma hexagonal; agora é o
      // MESMO coroplético MapLibre+PMTiles do nível Brasil de Presidente (ver
      // o ramo abaixo) — mas nos dois casos a guarda de fase é a mesma: nada
      // com identidade partidária deve aparecer antes do 1º boletim. A guarda
      // de fase é defesa em profundidade: com o payload que o semeador grava
      // (`por_uf: []`) este ramo já entrava sozinho, mas a spec § D7 quer as
      // duas defesas coexistindo — a de não produzir as linhas e a de não
      // pintá-las se elas voltarem a existir.
      return (
        <section
          aria-labelledby="persistent-map-heading"
          className="absolute inset-0 flex flex-col"
          style={{ gap: "var(--space-3)", padding: "var(--space-4)", overflow: "hidden" }}
        >
          <div
            className="flex flex-wrap items-start justify-between"
            style={{ gap: "var(--space-2)" }}
          >
            <h2
              id="persistent-map-heading"
              style={{
                margin: 0,
                font: "var(--type-kicker)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {escopo}
            </h2>
            <UfPicker cargo="gov" atual={sigla} />
          </div>
          <p style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
            {preEleicao
              ? "A eleição ainda não começou. Os 27 estados aparecem coloridos aqui quando houver voto contado."
              : "Aguardando primeiros boletins do TSE para preencher o mapa."}
          </p>
        </section>
      );
    }

    // Nível Brasil, com dado — o MESMO coroplético MapLibre+PMTiles da trilha
    // Presidente (`NationalMapBlock` variant="frame"), pintado pelo partido do
    // líder de CADA UF na corrida de Governador (pedido do dono, 2026-09-18).
    // `<HexCartogramBrasil>` sai desta rota (fica no repositório, sem uso
    // aqui — decisão do dono, não é remoção do componente).
    //
    // 🔴 2026-09-18 (2ª rodada, achado do `constitution-guard`) — SEM
    // `rankByLider` aqui, de propósito. O ramo de Presidente logo abaixo
    // (`:477-479`) constrói um `Record<id, rank>` com
    // `Object.fromEntries(national.candidatos.map(c => [c.id, c.rank]))`, e
    // ali é seguro porque `id` é único no país inteiro (uma corrida
    // presidencial só). Em cargo 3, `id` é o NÚMERO DE URNA — que em corrida
    // majoritária é o número do PARTIDO — e o mesmo partido concorre a
    // governador em várias UFs com O MESMO número. `national.candidatos`
    // aqui é a união de 27 corridas (RF-145): copiar o mesmo
    // `Object.fromEntries` colapsaria, por `id`, o `rank` de até 27 UFs
    // diferentes num só valor — a ÚLTIMA UF do array vencendo em silêncio, e
    // as anteriores perdendo o próprio rank sem nenhum sinal.
    //
    // O alcance do que isso afetaria é estreito — `rankByLider` só alimenta
    // `resolveCandHex(rank)`/`colorForRank(rank)` em
    // `_NationalChoroplethMapImpl.tsx`, e só quando `partidoIsMapped()` é
    // falso (partido ausente ou sem token próprio, ADR-0024) — mas é
    // exatamente o padrão que duas outras correções desta rodada trataram
    // com cuidado (`buildHoverRows`, `StateResultSheet`), e não faz sentido
    // deixar um terceiro caso do mesmo defeito no código novo.
    //
    // `candidatoAId` continua vindo de `payload.national.candidato_a_id` —
    // e este SEM o mesmo problema: `compute_national`
    // (`api/model/project.py`) agrega por `candidato_id` ponderado pelo
    // eleitorado de cada UF (é uma soma nacional por NÚMERO/partido, não uma
    // concatenação), então é um valor ÚNICO e determinístico — "qual número
    // tem a maior fatia agregada do país" — não um artefato de sobrescrita.
    // O impl sintetiza `{ [candidatoAId]: 1 }` a partir dele (o mesmo
    // caminho back-compat pré-S05 documentado em
    // `_NationalChoroplethMapImpl.tsx`), o que é uma escolha determinística
    // e sem colisão — diferente do `Object.fromEntries` acima, que iterava
    // TODAS as 27 corridas e perdia informação a cada sobrescrita.
    return (
      <NationalMapBlock
        rows={payload.por_uf}
        turno={payload.turno}
        candidatoAId={payload.national.candidato_a_id}
        candidatos={payload.national.candidatos}
        variant="frame"
        cargo="gov"
        preEleicao={zerado}
        scopeLabel={escopo}
        action={<UfPicker cargo="gov" atual={sigla} />}
      />
    );
  }

  if (cargo === "sen") {
    if (sigla) {
      // 🔴 **Nível UF de Senador — 2026-09-19, pedido do dono.** Até hoje este
      // ramo devolvia um PAINEL DE TEXTO dizendo "o Senado ainda não tem mapa
      // por município", e a frase era verdadeira por três razões somadas:
      // `municipios-sen-t1.json` gravava `municipios: []`,
      // `/api/projection/municipios` não tinha ramo para `cargo=sen`, e
      // `/api/projection?uf=` ignorava `cargo`. As três caíram nesta rodada —
      // o gerador do simulado passou a emitir municípios para os três cargos,
      // e as duas rotas passaram a resolver cargo por tabela, com 400 para o
      // que não conhecem.
      //
      // O que NÃO mudou, e o mapa não pode fingir que mudou: a cobertura
      // municipal é estruturalmente parcial em todos os cargos — município sem
      // par (município × zona) apurado não recebe linha
      // (`docs/reference/risks.md:78`). O mapa mostra o que foi apurado, e o
      // `<DetailUnavailable>` abaixo é quem diz a ausência quando o detalhe
      // inteiro não veio.
      //
      // ⚠️ `spec 016 § Escopo/Fora` ainda diz por escrito que Senador não tem
      // dado municipal. A spec precisa de emenda — está na lista desta rodada.
      // 🔴 2026-09-27 — mesma troca de marcação do ramo gêmeo de Governador
      // acima: cabeçalho ganha cópia em `.mobileChrome` (barra + rodapé), o
      // "· 2 vagas" viaja com as DUAS cópias (é ressalva de decisão D1, não
      // decoração — ver o comentário original abaixo), e o `id`/
      // `aria-labelledby` compartilhado vira `aria-label` direto na
      // `<section>` (ver a nota do ramo de Governador para o motivo).
      const heading = `${sigla} · quem lidera cada município · 2 vagas`;
      return (
        <section aria-label={heading} className={mapFrameStyles.frameRootFlex}>
          <div
            className={[
              mapFrameStyles.desktopOverlay,
              "flex-wrap items-start justify-between",
            ].join(" ")}
            style={{ gap: "var(--space-2)" }}
          >
            <h2
              style={{
                margin: 0,
                font: "var(--type-kicker)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {/* 🔴 O sufixo "· 2 vagas" NÃO é decoração e não pode sair daqui.
                  A decisão D1 do dono autoriza pintar o Senado pelo LÍDER
                  LOCAL — como Presidente e Governador — **desde que** o rótulo
                  de duas vagas fique explícito na própria superfície do mapa.
                  O nível Brasil cumpre isso via `escopo` (ver o topo do
                  arquivo); o nível UF tem cabeçalho próprio e, sem esta linha,
                  cumpriria a metade conveniente da decisão: a cor de vencedor
                  único numa corrida que elege dois, sem a ressalva. */}
              {heading}
            </h2>
            <UfPicker cargo="sen" atual={sigla} />
          </div>
          <div className={mapFrameStyles.canvasFlex}>
            {/* `detalhe`/`candidatos` (2026-09-18) — sem eles, o
                `<ChoroplethMapUF>` colore normalmente mas o `<HoverCard>`
                nunca aparece (as duas props são opcionais e checadas lá
                dentro); `candidatos` chega `undefined` enquanto `ufResumo`
                (busca client-side acima) ainda não resolveu — o balão
                aparece sozinho assim que resolver, sem exigir novo hover
                (ver docstring de `MunicipioTooltipState` em
                `ChoroplethMapUF.tsx`). */}
            <UfLeaderMapLazy
              ufSigla={sigla}
              choropleth={choropleth}
              height="100%"
              detalhe={municipiosDaUf}
              candidatos={ufResumo?.candidatos}
            />
            {municipioDetalhe?.status === "unavailable" && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "var(--surface-card)",
                  borderTop: "1px solid var(--border-hairline)",
                }}
              >
                <DetailUnavailable
                  label="A cor por município deste mapa"
                  reason={municipioDetalhe.reason}
                  style={{ borderTop: "none", padding: "var(--space-2) var(--space-3)" }}
                />
              </div>
            )}
            <Link
              href={homeHref}
              className={[mapFrameStyles.desktopOverlayInline, "pointer-events-auto absolute"].join(
                " ",
              )}
              style={{ ...CHIP_STYLE, top: "var(--space-2)", left: "var(--space-2)" }}
            >
              ← Brasil
            </Link>
            {/* ADR-0071 — +/−/⟲ sobre o mapa, canto inferior direito, SÓ
                DESKTOP; no celular a cópia fica na faixa abaixo (`.mobileChrome`). */}
            <MapZoomControls variant="desktop" />
          </div>
          <div className={mapFrameStyles.mobileChrome}>
            <MapZoomControls variant="bar" />
            <div className={mapFrameStyles.bar}>
              <Link href={homeHref} className={mapFrameStyles.btn}>
                ← Brasil
              </Link>
              <div className={mapFrameStyles.barSpacer} />
              <UfPicker cargo="sen" atual={sigla} />
            </div>
            <div className={mapFrameStyles.footer}>
              <h2 className={mapFrameStyles.title}>{heading}</h2>
            </div>
          </div>
        </section>
      );
    }

    if (preEleicao || payload.por_uf.length === 0) {
      // Gêmeo do ramo equivalente de Governador logo acima — mesma guarda de
      // fase (RF-157), mesmo texto de espera.
      return (
        <section
          aria-labelledby="persistent-map-heading"
          className="absolute inset-0 flex flex-col"
          style={{ gap: "var(--space-3)", padding: "var(--space-4)", overflow: "hidden" }}
        >
          <div
            className="flex flex-wrap items-start justify-between"
            style={{ gap: "var(--space-2)" }}
          >
            <h2
              id="persistent-map-heading"
              style={{
                margin: 0,
                font: "var(--type-kicker)",
                letterSpacing: "var(--tracking-caps)",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {escopo}
            </h2>
            <UfPicker cargo="sen" atual={sigla} />
          </div>
          <p style={{ margin: 0, font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
            {preEleicao
              ? "A eleição ainda não começou. Os 27 estados aparecem coloridos aqui quando houver voto contado."
              : "Aguardando primeiros boletins do TSE para preencher o mapa."}
          </p>
        </section>
      );
    }

    // Nível Brasil, com dado — o MESMO coroplético MapLibre+PMTiles das
    // trilhas Presidente/Governador, pintado pelo partido do líder de CADA UF
    // na corrida de Senador. Sem `rankByLider` (ver o item 2 do docstring
    // "2026-09-18 (2ª rodada)" no topo do arquivo — reaproveita a MESMA razão
    // já escrita para `cargo === "gov"` acima, sem duplicar o comentário
    // inteiro).
    return (
      <NationalMapBlock
        rows={payload.por_uf}
        turno={payload.turno}
        candidatoAId={payload.national.candidato_a_id}
        candidatos={payload.national.candidatos}
        variant="frame"
        cargo="sen"
        preEleicao={zerado}
        scopeLabel={escopo}
        action={<UfPicker cargo="sen" atual={sigla} />}
      />
    );
  }

  if (sigla && isExterior(sigla)) {
    // ADR-0045 item 7 — o EXTERIOR (`/uf/ZZ`, só Presidente) não tem mapa:
    // as localidades (embaixadas, consulados) não têm geometria no país, e
    // inventar uma posição seria afirmar uma geografia que não existe. A
    // moldura mantém o cromo (← Brasil + seletor) e diz onde estão os números.
    // O seletor lista o Exterior no fim (cargo pres) e o botão diz "Exterior",
    // nunca a sigla crua "ZZ" do TSE (`rotuloDaUnidade`).
    return (
      <>
        <section aria-label="Exterior — sem mapa" className={mapFrameStyles.canvasFill}>
          <div
            className="flex h-full flex-col items-center justify-center text-center"
            style={{ padding: "var(--space-6)", gap: "var(--space-2)" }}
          >
            <p style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-xl, 1.25rem)" }}>
              Exterior
            </p>
            <p className="text-sm" style={{ color: "var(--color-text-muted)", maxWidth: "32ch" }}>
              O voto dos brasileiros que moram fora do país não tem mapa: as localidades estão na
              lista da página.
            </p>
          </div>
          <div
            className={[
              mapFrameStyles.desktopOverlay,
              "pointer-events-none absolute flex-wrap items-start justify-between",
            ].join(" ")}
            style={{
              top: "var(--space-3)",
              left: "var(--space-3)",
              right: "var(--space-3)",
              gap: "var(--space-2)",
            }}
          >
            <div
              className="pointer-events-auto flex min-w-0 items-center"
              style={{ gap: "var(--space-2)" }}
            >
              <Link href={homeHref} style={CHIP_STYLE}>
                ← Brasil
              </Link>
            </div>
            <div className="pointer-events-auto flex-none">
              <UfPicker cargo="pres" atual={sigla} />
            </div>
          </div>
        </section>
        <div className={mapFrameStyles.mobileChrome}>
          <div className={mapFrameStyles.bar}>
            <Link href={homeHref} className={mapFrameStyles.btn}>
              ← Brasil
            </Link>
            <div className={mapFrameStyles.barSpacer} />
            <UfPicker cargo="pres" atual={sigla} />
          </div>
        </div>
      </>
    );
  }

  if (sigla) {
    // Nível UF, Presidente — coroplético municipal preenche a moldura
    // inteira, com o mesmo chrome de overlay do nível Brasil.
    //
    // 🔴 2026-09-27 — era o único dos três cargos em que o cabeçalho inteiro
    // (não só o "← Brasil") flutuava sobre o mapa. `.desktopOverlay` some no
    // celular (`MapFrameMobile.module.css`); a cópia equivalente do celular
    // mora em `.mobileChrome`, IRMÃO da `<section>` do canvas (Fragment) —
    // mesmo padrão do nível Brasil (`NationalMapBlock.tsx`, `variant="frame"`).
    return (
      <>
        <section
          aria-label={`Mapa coroplético de ${sigla} por município`}
          className={mapFrameStyles.canvasFill}
        >
          {/* `detalhe`/`candidatos`: mesma nota da instância de "gov" acima. */}
          <UfLeaderMapLazy
            ufSigla={sigla}
            choropleth={choropleth}
            height="100%"
            detalhe={municipiosDaUf}
            candidatos={ufResumo?.candidatos}
          />
          {/* Chip "← Brasil" + "<SIGLA> · <N> mun." sobreposto ao coroplético
              municipal — SÓ DESKTOP. Mesma composição visual do chip do nível
              Brasil (`NationalMapBlock`, `variant="frame"`), texto conforme o
              protótipo (`App.jsx:314`). */}
          <div
            className={[
              mapFrameStyles.desktopOverlay,
              "pointer-events-none absolute flex-wrap items-start justify-between",
            ].join(" ")}
            style={{
              top: "var(--space-3)",
              left: "var(--space-3)",
              right: "var(--space-3)",
              gap: "var(--space-2)",
            }}
          >
            <div
              className="pointer-events-auto flex min-w-0 items-center"
              style={{ gap: "var(--space-2)" }}
            >
              <Link href={homeHref} style={CHIP_STYLE}>
                ← Brasil
              </Link>
              <span style={{ ...CHIP_STYLE, margin: 0 }}>
                {sigla}
                {municipiosTotalFor(sigla) > 0 ? ` · ${municipiosTotalFor(sigla)} mun.` : ""}
              </span>
            </div>
            {/* Canto superior direito — o seletor de UF do protótipo
                (`App.jsx:316`). Dentro da MESMA faixa `flex-wrap` do chip da
                esquerda, não numa caixa ancorada em `right`: a 375px as duas
                caixas se sobreporiam, e é esse o defeito que a faixa única já
                resolvia para o toggle do nível Brasil. */}
            <div className="pointer-events-auto flex-none">
              <UfPicker cargo="pres" atual={sigla} />
            </div>
          </div>
          {municipioDetalhe?.status === "unavailable" && (
            <div
              style={{
                position: "absolute",
                left: "var(--space-3)",
                right: "var(--space-3)",
                bottom: "var(--space-3)",
                background: "var(--surface-card)",
                border: "1px solid var(--border-hairline)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <DetailUnavailable
                label="A cor por município deste mapa"
                reason={municipioDetalhe.reason}
                style={{ borderTop: "none", padding: "var(--space-2) var(--space-3)" }}
              />
            </div>
          )}
          {/* ADR-0071 — +/−/⟲ sobre o mapa, SÓ DESKTOP (celular: faixa abaixo). */}
          <MapZoomControls variant="desktop" />
        </section>
        <div className={mapFrameStyles.mobileChrome}>
          <MapZoomControls variant="bar" />
          <div className={mapFrameStyles.bar}>
            <Link href={homeHref} className={mapFrameStyles.btn}>
              ← Brasil
            </Link>
            <div className={mapFrameStyles.barSpacer} />
            <UfPicker cargo="pres" atual={sigla} />
          </div>
          <div className={mapFrameStyles.footer}>
            <span className={mapFrameStyles.title}>
              {sigla}
              {municipiosTotalFor(sigla) > 0 ? ` · ${municipiosTotalFor(sigla)} mun.` : ""}
            </span>
          </div>
        </div>
      </>
    );
  }

  const rankByLider: Record<number, number> = Object.fromEntries(
    payload.national.candidatos.map((c, i) => [c.id, c.rank ?? i + 1]),
  );

  return (
    <NationalMapBlock
      rows={payload.por_uf}
      turno={payload.turno}
      candidatoAId={payload.national.candidato_a_id}
      rankByLider={rankByLider}
      candidatos={payload.national.candidatos}
      variant="frame"
      preEleicao={mapaCinza}
      cargo="pres"
      scopeLabel={escopo}
      backHref={sigla ? homeHref : undefined}
      // Nível Brasil: o seletor entra na faixa do canto direito, ao lado do
      // `<MapViewToggle>` (ver `action` em `NationalMapBlock`). O mapa
      // continua clicável para descer numa UF — o seletor é o caminho de
      // teclado e de quem sabe o nome do estado mas não onde ele fica.
      action={<UfPicker cargo="pres" atual={sigla} />}
    />
  );
}
