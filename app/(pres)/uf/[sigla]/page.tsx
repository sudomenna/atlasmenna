/**
 * app/uf/[sigla]/page.tsx — Spec 004 (Página de UF Presidencial)
 *
 * Server Component. `generateStaticParams` lista as 27 UFs (PR-IBGE).
 *
 * Pipeline:
 *   1. Lê, EM PARALELO, os dois read paths (ADR-0032):
 *        a. `readUfProjection(sigla, { cargo: "pres", turno })` — o RESUMO,
 *           no Global Config (ADR-0001).
 *        b. `readUfDetail(sigla, ...)` — o DETALHE (municípios + séries), no
 *           Vercel Blob. Nunca em série: a página não espera o Blob para
 *           renderizar o resumo.
 *      Os dois falham de forma independente, e a página degrada **por seção**:
 *      as seções de detalhe mostram estado "detalhe indisponível" explícito,
 *      sempre no DOM (`<DetailUnavailable>`, ADR-0017), nunca somem.
 *   2. Identifica líder por `pct_projetado` desc (EdgePayloadUf não tem
 *      `candidato_a_id`/`candidato_b_id` ainda — flagado em tasks.md como
 *      risco/enhancement).
 *   3. Compõe a tela conforme wireframe da spec.
 *
 * Mapas: importados via `next/dynamic({ ssr: false })` (ADR-0010) para
 * manter o bundle above-the-fold <150KB (RNF-007a).
 *
 * Fallback: quando reader retorna `null` (pré-eleição / Edge Config vazio),
 * renderiza mensagem "Aguardando dados" — UX não quebra (constituição § 3).
 *
 * RFs cobertos (após os cortes de 2026-09-08 e os de 2026-09-09 — ver as duas
 * seções do protótipo no fim deste bloco):
 *   RF-033 (candidate rows, agora dentro do `<ResultPanel>`),
 *   RF-037 (municipios table), RF-043 (forecast transparency).
 *
 * DEIXARAM de ter implementação nesta rota: RF-031 (breadcrumb) e RF-032
 * (winner banner), cortados em 09/09; RF-035, RF-036 (mapas duo), RF-038
 * (swing arrows), RF-039 (agulha estadual), RF-040, RF-041, RF-042 (séries) e
 * RF-044 (insight), cortados antes. A spec 004 regride — sincronização de
 * traceability/status é tarefa separada (`spec-syncer`).
 *
 * S07/Fase 2
 *   - Dispatch de modo idêntico ao da home: `binary` quando `turno === 2`
 *     ou há exatamente 2 candidatos; `multi-1t` caso contrário.
 *   - Em `multi-1t`, `<ProjectionThermometers />` (ADR-0018) abre a projeção,
 *     acima da lista de candidatos (o IC vem de `ci95`).
 *   - Identidade da trilha presidencial: `<main data-trilha="pres">`,
 *     kicker "PRESIDÊNCIA" e breadcrumb de profundidade real (ADR-0019).
 *
 * ===== S07/Bloco 2 — mapa primeiro (ADR-0029) =====
 * Esta rota recebe a MESMA recomposição que a home. Como lá, a mudança é de
 * ORDEM e de invólucro, não de conteúdo: **nenhum bloco RF-bound saiu**.
 *
 *   1. O coroplético de municípios (`UfLeaderMapLazy`, RF-034) sobe do meio da
 *      página para PRIMEIRO conteúdo, com altura de hero (ADR-0029 § 1). O
 *      `<UFBreadcrumb>` (RF-031) fica acima dele — é uma linha, e tirar a
 *      orientação de "onde estou" do topo custaria mais do que ganha.
 *   2. O `<RaceHeader>` com `<h1>` grande saiu da primeira dobra. O `<h1>`
 *      continua único: virou o TÍTULO DO PAINEL de resultado, na escala de
 *      qualquer outra seção (ADR-0029 § 5), com o `<TrilhaKicker>` acima e o
 *      `<TurnoBadge>` ao lado. Ele alterna "Resultado parcial" / "Projeção
 *      Atlas Menna" pelo controle do shell, por cascata (nenhum JS novo).
 *   3. As linhas de candidato passaram de `<CandidateRow>` (avatar + votos +
 *      um único percentual, o projetado) para `<CandidateResultRow>` —
 *      parcial e projeção lado a lado, ADR-0029 § 7. O leitor passa a poder
 *      conferir a coluna "parcial" contra o boletim do TSE (constituição § 8).
 *   4. Cada seção virou um `<Panel>` com filete e kicker (ADR-0025).
 *   5. Novo: `<MunicipioExplorer>` — tocar num município abre a folha no
 *      `<Sheet>`. (O `<ChancesPanel>` também entrou aqui no Bloco 2, mas saiu
 *      em 2026-09-08 — ver abaixo.)
 *
 * ===== 2026-09-08 — a rota passa a seguir o protótipo do kit =====
 * Decisão do usuário: corta-se desta página tudo que não está em
 * `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx`. Saíram:
 * `<ChancesPanel>` (no protótipo é NACIONAL, `App.jsx:350` — migrou para
 * `app/page.tsx`), `<InsightCard>`, o `<Panel>` "Volume e estimativa"
 * (`UfMapDuoLazy`), o `<Panel>` "Comparação" (`UfSwingArrowMapLazy`), o
 * `<Panel>` "Forecast" (`<Needle>`), o `<Panel>` "Ao longo da noite" (os três
 * charts) e o `<NewsClippingPlaceholder>`.
 *
 * Duas exceções que NÃO são cortadas apesar de não estarem no protótipo:
 * `<ForecastTransparency>` (constituição § 8 — toda página com projeção) e
 * `<Footer>` (constituição § 1 — "Não oficial. Fonte: TSE.").
 *
 * ===== 2026-09-09 — a projeção vira o `<ResultPanel>` do kit (decisão D23) =====
 * Esta rota recebe o MESMO painel que a home já usa desde `b7c1bbb`
 * (`components/blocks/ResultPanel.tsx`), e não uma segunda variante dele. O
 * motivo imediato foi de layout: com o shell de duas colunas (ADR-0033 § 1), a
 * coluna de painéis mede `--container-sidebar` (400px), e os seis termômetros
 * do ADR-0018 — desenhados para a página inteira — passaram a se sobrepor e a
 * truncar os próprios rótulos ali dentro.
 *
 * Saíram desta rota (decisão D23 do usuário — o que o protótipo não tem):
 *
 *   - `<UFBreadcrumb>` (RF-031) — o protótipo não tem breadcrumb; a
 *     orientação "onde estou" fica com o `<CargoTabs>` do shell e com o
 *     título do painel, que nomeia a UF.
 *   - `<WinnerBanner>` (RF-032) — sem contraparte no protótipo.
 *   - `<TrilhaKicker>` (ADR-0019) — idem. Com ele fora, o `<ResultPanel>`
 *     volta ao filete duplo padrão do `<Panel>` (era `rule="none"` porque o
 *     kicker desenhava o filete da seção).
 *   - `<ProjectionThermometers>` (ADR-0018) — dá lugar ao `<ResultPanel>`.
 *     Consequência declarada, a mesma que a home aceitou em 09/09: brancos,
 *     nulos e abstenção saem DESTA TELA. O dado segue em
 *     `EdgePayloadUf.participacao`, e o bloco continua íntegro em
 *     `/governador` (onde o ADR-0022 o torna obrigatório). Isto emenda de fato
 *     o ADR-0018 nesta rota; a formalização é trabalho de `adr-author`.
 *   - As duas `<Figure>` "Apurado" e "Última atualização" e a `<section
 *     aria-labelledby="candidates-heading">` montada à mão — o `<ResultPanel>`
 *     resolve as três: "Apurado" com a nota "X de Y votos válidos", "Margem
 *     <líder>" no lugar do relógio, e a lista de candidatos com `variant="kit"`.
 *
 * Ficam, contra o protótipo e por regra de nível mais alto:
 * `<MunicipioExplorer>`/`<MunicipioTable>` (constituição § 4 — é a lista
 * textual paralela do mapa municipal, que no protótipo seria "Maiores colégios
 * eleitorais"), `<ForecastTransparency>` (§ 8) e `<Footer>` (§ 1).
 *
 * O `<h1>` continua único e continua sendo o título do painel de resultado
 * (ADR-0029 § 5), alternando "Resultado parcial" / "Projeção Atlas Menna" por
 * CASCATA (`data-view-only`), nunca por estado React.
 *
 * A rota é pré-renderizada estática (27 UFs × 2 trilhas): nada aqui pode ler
 * `searchParams`, `cookies()` ou `headers()`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TurnoBadge } from "@/components/atoms/badges/TurnoBadge";
import { DadoParadoBanner } from "@/components/atoms/banners/DadoParadoBanner";
import { SerieApuracaoChart } from "@/components/atoms/charts/SerieApuracaoChart";
import { UfFlag } from "@/components/atoms/data/UfFlag";
import { rotuloDaUnidade } from "@/components/atoms/maps/_shared";
import {
  DetailFreshness,
  DetailUnavailable,
  type DetailUnavailableReason,
} from "@/components/atoms/surfaces/DetailUnavailable";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import { CandidaturasAguardando } from "@/components/blocks/CandidaturasAguardando";
import { CorridaTresCirculos } from "@/components/blocks/CorridaTresCirculos";
import { ForecastTransparency } from "@/components/blocks/ForecastTransparency";
import { MunicipioExplorer } from "@/components/blocks/MunicipioExplorer";
import type { MunicipioRow } from "@/components/blocks/MunicipioTable";
import { ResultPanel } from "@/components/blocks/ResultPanel";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import { Footer } from "@/components/layout/Footer";
import {
  municipiosFrom,
  readUfDetail,
  seriePorCandidatoFrom,
  type UfDetailResult,
} from "@/lib/blob/uf-detail";
import { currentPresidentialTurno } from "@/lib/config/calendar";
import { cargoExisteNaUf, isExterior, ufsDoCargo } from "@/lib/config/cargos";
import { avaliarFrescorDado } from "@/lib/config/dado-freshness";
import { isPreEleicao } from "@/lib/config/fase";
import {
  resultadoEleitoral,
  simulacaoLigada,
  simulacaoMunicipiosUf,
  simulacaoNacional,
  simulacaoUfPresidente,
} from "@/lib/dev/simulacao";
import { readNationalProjection, readUfProjection } from "@/lib/edge-config/reader";
import type { EdgePayload, EdgePayloadUf, EdgeUfMunicipio } from "@/lib/edge-config/types";
import { primeiroNomeExibicao } from "@/lib/utils/nome-candidato";
import { resolverModoUf } from "@/lib/zerado/majoritario";
import nationalFixture from "@/tests/fixtures/edge-config/projection-current.json" with {
  type: "json",
};

/**
 * Título do painel de resultado — e o `<h1>` da página (ADR-0029 § 5).
 * Os dois textos ficam no DOM; `data-view-only` (cascata em
 * `app/globals.css`) revela o da base ativa e tira o outro da árvore de
 * acessibilidade com `display: none`. Mesma mecânica da home.
 */
function ResultTitle({ sigla }: { sigla: string }) {
  // ADR-0045 — "Exterior", nunca "ZZ" (a bandeira já é `null` para ZZ).
  const rotulo = rotuloDaUnidade(sigla);
  return (
    <>
      {/* Bandeira decorativa (`alt=""`), uma só para os dois textos. */}
      <UfFlag sigla={sigla} width={25} height={18} eager inline />
      <span data-view-only="parcial">{rotulo} — Resultado parcial</span>
      <span data-view-only="proj">{rotulo} — Projeção Atlas Menna</span>
    </>
  );
}

// Mapas isolados em `UfMapsLazy` (Client Component) que internamente faz
// `next/dynamic({ ssr: false })`. Mantém ADR-0010 (chunk separado) mesmo
// com Next 16 proibindo `ssr: false` em Server Components.

// As unidades de apuração PRESIDENCIAIS: as 27 UFs (DF incluído — carry-over
// S03) e, desde o ADR-0045, o exterior (`ZZ`). Lidas da tabela canônica
// (`ufsDoCargo(1)`), nunca uma lista local: o exterior só existe NESTA rota —
// `/uf/ZZ/governador`, `/senador` e as de deputado continuam 404, porque o
// eleitor no exterior vota só para Presidente (Código Eleitoral, art. 225).
const UNIDADES_PRESIDENCIAIS = ufsDoCargo(1);

export function generateStaticParams() {
  return UNIDADES_PRESIDENCIAIS.map((sigla) => ({ sigla }));
}

interface UFPageProps {
  params: Promise<{ sigla: string }>;
}

export async function generateMetadata({ params }: UFPageProps): Promise<Metadata> {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();
  const rotulo = rotuloDaUnidade(sigla);
  const title = `${rotulo} — Apuração Presidencial 2026 | AtlasMenna`;
  const description = isExterior(sigla)
    ? "Apuração presidencial 2026 no exterior: votos dos eleitores que moram fora do Brasil, localidade por localidade."
    : `Apuração presidencial 2026 em ${sigla}: projeção em tempo real, mapa de municípios, swing vs 2022.`;
  return {
    // RNF-027 — URL canônica /uf/<SIGLA>.
    alternates: { canonical: `/uf/${sigla}` },
    title,
    description,
    // RNF-028 — Meta/OG. Imagens dinâmicas (RF-051) ficam para spec 009;
    // aqui só textuais.
    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      siteName: "AtlasMenna",
      url: `/uf/${sigla}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

/**
 * O que `detalheLido` vale quando a leitura remota nem roda (modo simulação).
 *
 * `"not_configured"` e não um motivo novo: é literalmente o que o leitor do
 * Blob devolveria num ambiente sem credencial, e é o texto que a tela já sabe
 * mostrar. Inventar um motivo aqui obrigaria `<DetailUnavailable>` a aprender
 * um estado que só existe em desenvolvimento.
 */
const SEM_DETALHE_REMOTO: UfDetailResult = {
  status: "unavailable",
  reason: "not_configured",
  url: null,
};

/**
 * Sintetiza um `EdgePayloadUf` a partir de um payload nacional, espelhando a
 * lógica de `/api/projection?uf=`. Usado apenas quando o reader retorna
 * null E não há `EDGE_CONFIG` (dev/preview sem credencial). Em produção
 * com Edge Config configurado, esta função nunca é chamada.
 *
 * A origem virou PARÂMETRO em 2026-09-15: sob `FIXTURE_VARIANT=sim` a mesma
 * síntese roda sobre o nacional da simulação. Antes ela lia `nationalFixture`
 * por dentro, e era o único ponto da rota capaz de ignorar o seletor de fixture
 * em silêncio — esta tela mostraria a simulação e o mapa ao lado, outra coisa.
 * Quem escolhe a origem é o chamador; esta função só dá forma.
 */
function synthesizeUfFromNational(sigla: string, national: EdgePayload): EdgePayloadUf | null {
  const row = national.por_uf.find((u) => u.sigla === sigla);
  if (!row) return null;
  return {
    uf: sigla,
    ts: national.ts,
    cargo: national.cargo,
    turno: national.turno,
    pct_apurado: row.pct_apurado,
    candidatos: national.national.candidatos.map((c) => ({
      id: c.id,
      nome: c.nome,
      partido: c.partido,
      // `cor` não é repassada — ver a nota em `_candidateColor.ts`.
      votos_atuais: c.votos_atuais,
      votos_projetados: c.votos_projetados,
      pct_atual: c.pct_atual,
      pct_projetado: c.pct_projetado,
      ci95: { lower: c.pct_projetado_lower, upper: c.pct_projetado_upper },
      // ADR-0053 / RF-213 — só quando existe (ausente ⇒ compete).
      ...(c.destino ? { destino: c.destino } : {}),
    })),
    // Dev-only. Desde os cortes de 09/09 esta rota não tem mais consumidor
    // para `participacao` (os termômetros do ADR-0018 saíram, ver o cabeçalho
    // do arquivo); o campo continua aqui porque `EdgePayloadUf` o declara e a
    // fixture sintetizada deve ter a mesma forma do payload real.
    participacao: national.national.participacao,
    needle_position: row.lider === national.national.candidato_a_id ? 0.4 : -0.4,
    needle_band: "lean_a",
  };
}

/**
 * Motivo a exibir no estado "detalhe indisponível" da seção de municípios, ou
 * `null` quando há detalhe para mostrar.
 *
 * Separa dois casos que o ADR-0032 trata como notícias diferentes: a fonte não
 * respondeu (`result.reason`) vs. respondeu e não há município apurado
 * (`"empty"`). Os dois continuam no DOM; nenhum esconde o bloco (ADR-0017).
 */
function municipioDetailReason(
  result: UfDetailResult,
  quantidade: number,
): "not_configured" | "not_found" | "fetch_error" | "invalid" | "empty" | null {
  if (result.status !== "ok") return result.reason;
  return quantidade === 0 ? "empty" : null;
}

/**
 * Converte municípios do payload (EdgeUfMunicipio) em rows da tabela.
 * S04/F2: o payload agora inclui margem e votos_reportados por município.
 *
 * 2026-09-11 (ADR-0035 D2): passa adiante `eleitores` e `capital`, que o
 * payload passou a publicar. Os dois são OPCIONAIS no payload e seguem
 * opcionais aqui — um Blob gravado antes da migration 0006 continua válido, e
 * `<MunicipioTable>` já sabe cair no estado "dado indisponível" sem eles.
 * `capital` é emitido só quando `true`: ausência == não é capital.
 */
function toMunicipioRows(
  municipios: EdgeUfMunicipio[],
  candidateColor: Record<number, string>,
  candidateShortName: Record<number, string>,
): MunicipioRow[] {
  return municipios.map((m) => {
    const liderId = m.lider.candidato_id;
    const totalVotos = Object.values(m.votos_reportados).reduce((a, b) => a + b, 0);
    return {
      cod_ibge: m.cod_ibge,
      nome: m.nome,
      lider: liderId,
      liderCor: candidateColor[liderId] ?? "var(--color-text)",
      liderNome: candidateShortName[liderId] ?? `#${liderId}`,
      margemPp: m.lider.margem_pp,
      pctApurado: m.pct_apurado,
      votosReportados: totalVotos,
      eleitorado: m.eleitores,
      capital: m.capital,
    };
  });
}

export default async function UFPage({ params }: UFPageProps) {
  const { sigla: raw } = await params;
  const sigla = raw.toUpperCase();

  if (!cargoExisteNaUf(1, sigla)) {
    notFound();
  }
  // ADR-0045 — o exterior nunca aparece ao leitor como "ZZ": título, kickers e
  // série usam "Exterior". A bandeira (`<UfFlag>`) já não desenha nada para ZZ.
  const rotulo = rotuloDaUnidade(sigla);
  const exterior = isExterior(sigla);

  // Os DOIS read paths, em paralelo (ADR-0032 item 3). O resumo vem do Global
  // Config; o detalhe municipal e as séries vêm do Vercel Blob. Nunca em série:
  // a página não espera o Blob para renderizar o resumo, e os dois falham de
  // forma independente.
  //
  // Cargo e turno são declarados aqui e passados aos DOIS lados (ADR-0028): sem
  // isso, `readUfProjection` cairia num default e o Blob viria de um literal —
  // duas resoluções independentes que podem divergir em silêncio. O calendário
  // responde só pelo turno; o cargo é desta rota, e esta rota é presidencial.
  const turno = currentPresidentialTurno();

  // 🔴 **Simulação ligada ⇒ nenhuma das duas leituras remotas roda.** Com
  // `BLOB_READ_WRITE_TOKEN` no `.env.local`, `readUfDetail` fala com o Blob de
  // PRODUÇÃO e responde `ok` com `municipios: []` — uma resposta vazia é uma
  // resposta, e ela ganhava da simulação (defeito de 2026-09-15, visto em
  // `/api/projection/municipios`). Adiar a leitura, e não só ignorá-la, também
  // tira do `Promise.all` uma ida à rede que seguraria a tela à toa.
  const emSimulacao = simulacaoLigada();
  const [payloadDoStore, detalheLido] = emSimulacao
    ? [null, SEM_DETALHE_REMOTO]
    : await Promise.all([
        readUfProjection(sigla, { cargo: "pres", turno }),
        readUfDetail(sigla, { cargo: "pres", turno }),
      ]);
  let payload = payloadDoStore;

  // 🔴 ADR-0076 — modo zerado: chave da UF ausente, fase pré ou lista vazia ⇒
  // o layout da apuração com as candidaturas do cadastro em 0 (ordem sorteada).
  // Leitura que FALHOU nunca entra aqui. Fora da simulação local.
  let zerado = false;
  if (!emSimulacao) {
    const r = await resolverModoUf(payloadDoStore, "pres", turno, sigla);
    payload = r.payload;
    zerado = r.zerado;
  }

  // Detalhe municipal sob `FIXTURE_VARIANT=sim`, e SÓ sob ele: esta rota nunca
  // teve fallback de dev para o Blob, então com o modo desligado `detalhe` é
  // literalmente `detalheLido` e nada muda. Ligado, a tabela de municípios e o
  // coroplético passam a contar a mesma história que o placar acima — e, se o
  // arquivo municipal da simulação não existir, o bloco segue no estado
  // "detalhe indisponível" que ele já mostra hoje em `pnpm dev`, em vez de
  // pescar a fixture municipal de outra apuração.
  const detalheSim = emSimulacao ? simulacaoMunicipiosUf(sigla, "pres", turno) : null;
  const detalhe: UfDetailResult = detalheSim
    ? { status: "ok", detail: detalheSim, url: "simulacao://dev" }
    : detalheLido;

  /**
   * Spec 020 (RF-168 a RF-171) — a série por candidatura desta UF, do MESMO
   * `readUfDetail` que a seção de municípios consome. Nenhuma leitura nova
   * entra no read path (RNF-002), e é o motivo de a série de UF morar no Blob
   * e não numa chave de Global Config (ADR-0046 D3).
   *
   * 🔴 Repassada **como veio**: a ordem de `candidatos` é contrato do produtor
   * (ADR-0046 D4 / RF-170c), os `null` de `apurado`/`projetado` são furos e
   * não zeros (RF-175b), e `cadencia_min` é declarada — nunca inferida de
   * `eixo[1] - eixo[0]`, que erraria justamente quando o primeiro intervalo
   * contém um ciclo perdido.
   *
   * Declarada antes do ramo de espera porque os DOIS ramos a usam: o Blob é
   * lido em paralelo com o resumo e não depende de o resumo existir.
   */
  const serie = seriePorCandidatoFrom(detalhe);

  /**
   * Por que a série não pode ser desenhada (RF-175) — só consultado quando
   * `serie` é `null` e a corrida não está em fase pré.
   *
   * As duas causas têm correções OPOSTAS e por isso não podem cair no mesmo
   * texto: `result.reason` é a fonte não ter respondido (rede, chave, formato),
   * e `"sem_serie"` é a fonte ter respondido **sem** o campo — o produtor não
   * publicou. Colapsá-las manda quem opera na noite de 04/10 caçar rede quando
   * o que faltou foi publicação.
   */
  const motivoSerie: DetailUnavailableReason =
    detalhe.status !== "ok" ? detalhe.reason : "sem_serie";

  // Fallback de DESENVOLVIMENTO: quando o reader retorna `null` (chave UF ainda
  // não publicada OR sem EDGE_CONFIG), `pnpm dev` sintetiza a partir do fixture
  // nacional, para que `/uf/SP` possa ser inspecionada de verdade sem
  // credencial Vercel.
  //
  // O portão é `=== "development"`, e não `!== "production"`, desde 2026-09-13.
  // A forma antiga já barrava produção — o defeito de `atlasmenna.online`
  // publicando os números da fixture era da HOME, não desta rota —, mas deixava
  // `NODE_ENV=test` passar, e com isso o caminho honesto abaixo nunca era
  // exercitado por um teste que não mockasse o reader. Agora as cinco rotas de
  // cargo usam o MESMO portão (`/`, `/uf/[sigla]`, `/governador`, `/senador`,
  // `/deputado-federal`), que é o que torna a regra auditável de uma vez só em
  // vez de cinco leituras que precisam ser comparadas à mão.
  // 1º) O payload PRESIDENCIAL POR UF da simulação, quando existe. Tem
  //     prioridade sobre a síntese abaixo, e o motivo é o defeito de
  //     2026-09-15: `/uf/SP` mostrava o líder com 10.475.955 votos, que é o
  //     número do BRASIL. O percentual apurado vinha certo (a linha de `por_uf`
  //     chega), a votação por candidato não — a síntese mapeia os 12 candidatos
  //     nacionais com os votos do país inteiro, porque a cédula presidencial é
  //     a mesma nos 27 estados e não há o que filtrar. Ver
  //     `simulacaoUfPresidente`.
  if (!payload) payload = simulacaoUfPresidente(sigla);

  // 2º) A síntese a partir do nacional — o comportamento de hoje, e o que
  //     continua valendo enquanto `presidente-uf.json` não existir. A origem é
  //     escolhida por `resultadoEleitoral`: simulação quando ligada, a fixture
  //     de sempre caso contrário, nunca as duas. Com o modo desligado isto é,
  //     linha a linha, o que a rota já fazia.
  if (!payload) {
    const national = await resultadoEleitoral(
      () => simulacaoNacional("pres"),
      () =>
        process.env.NODE_ENV === "development" ? (nationalFixture as unknown as EdgePayload) : null,
    );
    if (national) payload = synthesizeUfFromNational(sigla, national);
  }

  // Pré-eleição absoluta OR Edge Config vazio. UX gentil (constituição § 3), e
  // nenhum número inventado: a tela não afirma percentual, contagem nem hora.
  if (!payload) {
    // RF-149 — a corrida desta tela é a NACIONAL: as candidaturas a Presidente
    // na cédula de qualquer estado são as mesmas 12 do país, e a fatia mora sob
    // `BR` (design 018 § D1). `sigla` endereça a projeção, não o cadastro.
    // 🔴 Spec 020 (RF-174d) — a fase é lida do payload NACIONAL, e é lida
    // **aqui dentro**, no único ramo que não consegue respondê-la sozinho.
    //
    // Esta rota não tem payload próprio em fase pré: o semeador grava apenas
    // as três chaves nacionais mais o alias (`data-pipeline/projection-seed.ts`
    // § chavesDeDestino), nunca uma chave de UF. Sem perguntar ao nacional,
    // este ramo funde dois estados distintos — "a eleição não começou" e "não
    // sabemos" — no mesmo texto de espera.
    //
    // **Custo: zero hop a mais.** O ramo já esperava por `CandidaturasAguardando`
    // (uma ida ao Blob); a leitura do nacional entra no MESMO `Promise.all` e
    // termina dentro daquela espera. O caminho feliz — a rota de maior tráfego
    // com dado, na noite de 04/10 — não ganha leitura nenhuma (RNF-002).
    //
    // `isPreEleicao(null)` é `false` por contrato de `lib/config/fase.ts`: uma
    // falha de leitura do Global Config não pode virar uma afirmação sobre o
    // calendário eleitoral.
    const [grade, nacional] = await Promise.all([
      CandidaturasAguardando({ cargo: 1, uf: "BR" }),
      readNationalProjection(),
    ]);

    // Ponto ÚNICO de fase desta rota (RF-153 / RF-174d). Uma segunda leitura
    // aqui — ou, pior, uma data de calendário — reabriria o defeito que o
    // ADR-0043 fechou.
    const preNacional = isPreEleicao(nacional);

    return (
      <main
        data-trilha="pres"
        className="mx-auto flex min-h-screen max-w-page flex-col px-5 py-6"
        style={{ gap: "var(--space-6)" }}
      >
        {/* O `<UFBreadcrumb>` saiu daqui junto com o da página cheia (D23):
            manter a navegação só no caminho de erro deixaria duas gramáticas
            para a mesma rota. Quem volta usa o `<CargoTabs>` do shell. */}
        <div>
          <h1 className="mt-4 text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
            <UfFlag sigla={sigla} width={34} height={24} eager inline />
            {rotulo} — Aguardando dados
          </h1>
          <p
            className="mt-2 text-sm"
            data-testid="uf-aguardando"
            style={{ color: "var(--color-text-muted)" }}
          >
            A projeção para esta UF começa quando o TSE divulgar os primeiros boletins. Não oficial.
            Fonte: TSE.
          </p>
        </div>

        {/* Acrescentar, nunca substituir: a grade entra DEPOIS do parágrafo. */}
        {grade}

        {/* Spec 020 (RF-174, RF-175) — o bloco existe também AQUI, e é neste
            ramo que ele paga o próprio aluguel: com o nacional em fase pré ele
            desenha os eixos e diz "disponível apenas no dia das eleições";
            sem nacional nenhum ele diz por que a série não chegou. Os dois
            textos são estados diferentes, que o parágrafo de espera acima não
            distingue.

            🔴 A ORDEM das perguntas é o contrato do design § 6, e ela começa
            pela fase: antes de 04/10 o Blob legitimamente não tem série, e
            perguntar ao Blob primeiro trocaria "ainda não é hora" por "a fonte
            não respondeu" em todos os dias que antecedem a eleição.

            A série sai do MESMO `readUfDetail` que a seção de municípios usa,
            já resolvido lá em cima — nenhuma leitura nova (RNF-002). */}
        <Panel kicker="Evolução da apuração">
          {serie || preNacional ? (
            <SerieApuracaoChart
              cadenciaMin={serie ? serie.cadencia_min : 5}
              candidatos={serie ? serie.candidatos : []}
              eixo={serie ? serie.eixo : []}
              escopo={rotulo}
              preEleicao={preNacional}
              titleId="serie-apuracao-heading"
            />
          ) : (
            <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
          )}
        </Panel>

        <Footer />
      </main>
    );
  }

  // ADR-0038 D4 — frescor do DADO desta UF, calculado no servidor a partir do
  // `dado_ts` que já veio no payload. Cargo do payload, não literal: o limiar
  // é por cargo (D3).
  const frescorDado = avaliarFrescorDado(payload.dado_ts, payload.cargo);

  // O dispatch `binary` | `multi-1t` saiu com os termômetros (D23): o
  // `<ResultPanel>` é o mesmo nos dois turnos — em 2T a corrida tem dois
  // candidatos e a lista simplesmente tem duas linhas.

  // Maps de id → cor / nome curto para os componentes de mapa+tabela.
  // 🔴 A cor sai da SIGLA (ADR-0024), não de `c.cor` — a paleta por COLOCAÇÃO
  // do ADR-0013, que o produtor parou de emitir em 19/09.
  //
  // 🔴 **`candidateMarkerColor`, nunca `candidateColor`** — este mapa tem UM
  // destino, e ele é TEXTO: `MunicipioRow.liderCor`, que `<MunicipioTable>`
  // usa como `color:` da coluna "Margem" ("PT +12,3%"). Ver a nota do campo
  // em `components/blocks/MunicipioTable.tsx`. A variante de preenchimento
  // reprovava o piso de 4,5:1 da constituição § 4 / RNF-022 em 14 das 31
  // siglas — pior caso PSOL 2,08:1 sobre a página, e "outros" (o destino de
  // toda FEDERAÇÃO) 2,39:1. Gate executável:
  // `tests/unit/design-system/municipio-contraste.test.tsx`.
  //
  // O coroplético municipal NÃO lê este mapa — ele monta o seu em
  // `components/layout/PersistentMapFrame.tsx` (preenchimento de polígono ⇒
  // cor-base) e pinta o balão com `textForParty`. As duas superfícies seguem
  // coerentes porque a MATIZ é a mesma; só a luminância muda, que é
  // exatamente o que o § 2 permite variar.
  const candidateColor: Record<number, string> = {};
  const candidateShortName: Record<number, string> = {};
  payload.candidatos.forEach((c) => {
    candidateColor[c.id] = candidateMarkerColor(c.partido);
    // Primeiro nome do nome de EXIBIÇÃO. Este mapa alimenta a coluna
    // "margem" da tabela de municípios e o rótulo curto do mapa; cortar o cru
    // poria "RONALDO" na tabela e "CAIADO" no painel da mesma página.
    candidateShortName[c.id] = primeiroNomeExibicao(c.nome, c.sqcand);
  });

  // Detalhe do Blob. `municipiosFrom`/`seriesFrom` coalescem para vazio quando
  // indisponível — o estado explícito é decidido logo abaixo, não aqui.
  const municipios = municipiosFrom(detalhe);
  const municipioReason = municipioDetailReason(detalhe, municipios.length);

  const municipioRows = toMunicipioRows(municipios, candidateColor, candidateShortName);

  return (
    <main
      data-trilha="pres"
      className="mx-auto flex min-h-screen max-w-page flex-col px-4 py-6 md:px-6 md:py-10"
      // Mesma medida da home: 32px é a maior distância entre seções; a
      // separação editorial é feita pelo filete e pelo kicker do `<Panel>`.
      style={{ gap: "var(--space-8)" }}
    >
      {/* ADR-0038 D4/D5 — o SEGUNDO sinal de frescor desta página, e o
          primeiro que mede o TSE. `dado_ts` vem do `EdgePayloadUf` desta UF
          (D2: por UF, porque a ingestão degrada regionalmente sem que o
          nacional acuse nada), cru, sem `??`.

          Ele NÃO se funde com o `<DetailFreshness>` lá embaixo: aquele compara
          dois relógios de ESCRITA (o Blob ficou para trás do resumo) e
          continua correto para o que mede (D5). São duas falhas de causas
          diferentes, e uma frase só obrigaria o leitor a adivinhar qual das
          duas está acontecendo.

          `escopo="uf"` porque este `dado_ts` é o DESTA UF. O relógio vivo que a
          moldura do mapa publica a cada 60 s é o NACIONAL — que é o `max` sobre
          todos os pares e portanto nunca mais velho que o desta UF. O banner só
          o usa no sentido em que a desigualdade vale: nacional parado ⇒ esta UF
          parada (acende sem recarga); nacional fresco não prova nada sobre esta
          UF (não apaga o aviso que o servidor já tinha dado). */}
      {zerado ? null : <DadoParadoBanner frescor={frescorDado} escopo="uf" />}

      {/* O coroplético "{sigla} · quem lidera cada município" (RF-034)
          MUDOU DE ENDEREÇO em 2026-09-09 (map-builder): não vive mais aqui —
          vive na coluna do mapa (`<PersistentMapFrame>`, ADR-0033 § 1), que
          agora desce para o nível município quando a rota é de UF. Manter os
          dois seria duplicação (o mesmo mapa nas duas colunas). O conteúdo
          desta seção não tinha nada além do mapa e do aviso de indisponível
          — os dois migraram juntos; nada ficou órfão. */}

      {/* Seção 1 — a projeção, no `<ResultPanel>` do kit (o MESMO componente
          da home). Primeiro conteúdo da coluna de painéis, e por isso com o
          filete duplo padrão do `<Panel>` — o `rule="none"` da home existe
          porque lá o `<TrilhaKicker>` desenha o filete, e aqui ele saiu (D23).

          O kicker carrega o "não oficial" da constituição § 1; o título é o
          `<h1>` único da página (ADR-0029 § 5), alternando por cascata. O
          `<TurnoBadge>` fica no slot `action`, como os badges de estado da
          home. */}
      {/* Sem `ufDaFoto`: o default `"BR"` do painel é o CERTO aqui, e isso é
          uma decisão, não um esquecimento. A corrida presidencial é nacional, e
          é sob `BR` que as 13 fotos foram gravadas
          (`candidatos/foto/BR/<sqcand>.jpg`, ADR-0041) — passar `sigla` nesta
          rota montaria `candidatos/foto/SP/…` e devolveria 404. As rotas de
          Governador e Senador fazem o oposto, e pelo mesmo motivo. */}
      <ResultPanel
        action={<TurnoBadge turno={payload.turno} />}
        // 🔴 Sem `rankByParcial` aqui desde 2026-09-20: o `<ResultPanel>`
        // deriva as DUAS ordens (parcial e projeção) e a cascata escolhe a da
        // base ativa. Entregar uma ordem só voltaria a congelar a lista numa
        // base — que é o defeito que a mudança corrigiu.
        candidatos={payload.candidatos}
        headingLevel={1}
        kicker="Projeção Atlas Menna · não oficial"
        note="Projeção por regra de três: votos apurados ÷ % apurado em cada município, somados na UF."
        pctApurado={payload.pct_apurado}
        // 🔴 SEM selo (decisão do dono, 2026-09-27): quem vai ao 2º turno é
        // decidido pelo Brasil, não pelo estado. "2º turno" no 2º colocado de
        // SP diria algo falso quando ele é o 3º no país.
        selo="nenhum"
        title={<ResultTitle sigla={sigla} />}
        titleId="resultado-heading"
        variant={zerado ? "zerado" : "medicao"}
      />

      {/* Spec 022 (RF-200/201) — "A corrida" da UF em três círculos,
          imediatamente depois do `<ResultPanel>` e ANTES do "Votação" (dono,
          2026-09-27). Uma corrida só ⇒ fatias por
          CANDIDATURA, com o nome cruzado por `id` em `payload.candidatos`.
          ⚠️ O payload sintetizado em desenvolvimento não traz `votacao` e cai
          em `<DetailUnavailable>` (RF-207) — não quebra. */}
      {zerado ? null : (
        <CorridaTresCirculos
          kicker={`Presidente · ${rotulo}`}
          modo="candidatura"
          votacao={payload.votacao}
          candidatos={payload.candidatos}
          titleId="corrida-tres-circulos-heading"
        />
      )}

      {/* Spec 021 RF-192 (EMENDADO em 2026-09-26, noite, decisão do dono) —
          "Votação" DA UF: o eleitorado deste estado em três círculos, logo
          depois de "A corrida" (ordem invertida pelo dono em 2026-09-27). `payload.votacao`
          é o agregado da UF (spec 022 RF-209); `projetada` sai da
          participação projetada DA UF, nunca da nacional.
          Payload sem `votacao` (fallback sintético em desenvolvimento, ou UF
          sem agregado) ⇒ `<DetailUnavailable>` (RF-198) — não quebra. */}
      {zerado ? null : (
        <VotacaoEleitorado
          kicker={`Presidente · ${rotulo}`}
          votacao={payload.votacao}
          titleId="votacao-uf-heading"
        />
      )}

      {/* Seção 1b — spec 020 (RF-174): a evolução da apuração, no slot T-03
          (entre o painel de resultado e o de municípios). Nunca acima do
          painel: o `<h1>` da página vive nele.

          Fase 2 — a série vem de `serie`, resolvida a partir do MESMO
          `readUfDetail` que a seção de municípios consome logo abaixo. Sem
          série o bloco continua no DOM e diz POR QUE ela falta: `reason` da
          leitura quando a fonte não respondeu, `"sem_serie"` quando ela
          respondeu e o produtor não publicou (RF-175). Zeros de enfeite estão
          fora de questão, e um bloco que some também (ADR-0017).

          🔴 `preEleicao={false}`, e isso é uma DECISÃO, não um esquecimento.
          Chegar até aqui significa que `readUfProjection` devolveu payload
          desta UF — e payload de UF só existe porque o orchestrator o gravou.
          O semeador da fase pré escreve apenas as chaves NACIONAIS (o conjunto
          de `chavesDeDestino()` em `data-pipeline/projection-seed.ts`), nunca
          uma chave de UF; logo, este ramo é inalcançável em fase pré, e
          perguntar a fase aqui custaria uma leitura por render na rota de
          maior tráfego do produto para receber sempre a mesma resposta
          (RNF-002: nenhuma leitura nova no read path). Quem precisa da
          pergunta é o ramo de espera, acima, e é lá que ela é feita.

          Se algum dia o produtor passar a gravar UF em fase pré, o campo
          `fase` virá no payload e o lugar certo de lê-lo será `isPreEleicao`
          sobre ele — não uma segunda fonte inventada aqui. */}
      <Panel kicker="Evolução da apuração">
        {serie || zerado ? (
          <SerieApuracaoChart
            cadenciaMin={serie ? serie.cadencia_min : 5}
            candidatos={serie ? serie.candidatos : []}
            eixo={serie ? serie.eixo : []}
            escopo={rotulo}
            preEleicao={false}
            zerado={zerado && !serie}
            titleId="serie-apuracao-heading"
          />
        ) : (
          <DetailUnavailable label="A evolução da apuração" reason={motivoSerie} />
        )}
      </Panel>

      {/* Seção 2 — RF-037: municípios. Tocar num município abre a folha
          (`<Sheet>`) com os números dele (S07/Bloco 2).

          O `<Panel>` NÃO some mais quando não há município: desde o ADR-0032 a
          fonte deste bloco é o Vercel Blob, que falha independentemente do
          resumo, e esconder a seção comunicaria "não existe" quando a verdade é
          "não chegou". Estado explícito, sempre no DOM (ADR-0017). */}
      <Panel kicker={exterior ? "Localidades no exterior" : "Municípios"}>
        {municipioReason === null ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            {detalhe.status === "ok" && (
              <DetailFreshness ts={detalhe.detail.ts} resumoTs={payload.ts} />
            )}
            <MunicipioExplorer
              ufSigla={sigla}
              municipios={municipios}
              rows={municipioRows}
              candidatos={payload.candidatos}
              // 2026-10-04, pedido do dono (mesmo corte de governador e
              // senador): só os 25 maiores colégios eleitorais na lista; o
              // resto abre pelo mapa.
              limiteLista={25}
              // 2026-10-04 (dono) — SEM selo de base, como o `<ResultPanel>`
              // acima (2º turno é decidido pelo Brasil). Só o eleito
              // definido, que no Presidente o produtor emite apenas quando o
              // Brasil inteiro está decidido.
              cargo="pres"
              selo={{ regra: "nenhum" }}
            />
          </div>
        ) : (
          <DetailUnavailable label="O detalhe por município" reason={municipioReason} />
        )}
      </Panel>

      {/* Seção 3 — RF-043: forecast transparency. Constituição § 8 exige o
          bloco em toda página com projeção — fica mesmo não estando no
          protótipo. */}
      <Panel kicker="Metodologia">
        <ForecastTransparency pctApurado={payload.pct_apurado} variant="uf" />
      </Panel>

      <Footer />
    </main>
  );
}
