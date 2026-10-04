/**
 * components/blocks/ProjectionThermometers.tsx
 *
 * Hero do 1º turno — seis termômetros de projeção no lugar do "duelo".
 *
 * Ordem canônica (`variant="full"`):
 *   1. 1º colocado        · % dos votos a votáveis
 *   2. 2º colocado        · % dos votos a votáveis
 *   3. 3º colocado        · % dos votos a votáveis
 *   4. Outros candidatos  · % dos votos a votáveis
 *   5. Brancos e nulos    · % do comparecimento
 *   6. Abstenção          · % dos eleitores das seções instaladas
 *
 * `variant="participacao-only"` renderiza apenas 5 e 6 (usado em
 * `/governador`, onde a corrida é estadual e não há "top 3 nacional").
 *
 * Denominador misto e rotulado: os seis números NÃO somam 100 e nunca
 * deveriam ser somados. Cada termômetro carrega o rótulo da sua base e o
 * bloco fecha com uma legenda única explicando as três (ver
 * `lib/utils/participacao.ts` e o dicionário TSE em
 * `docs/reference/tse-2026-leiautes.md` — `pvap` é % sobre votos a
 * **votáveis concorrentes**, não sobre válidos puros).
 *
 * Duas bases (S07/Fase 2, decisão E2)
 *   `base="votaveis"` (default) lê `pct_projetado`/`ci95` do candidato;
 *   `base="comparecimento"` lê o bloco opcional `candidato.comparecimento`
 *   (e `participacao.outros.comparecimento`). O numerador é o mesmo nos dois
 *   casos — só o denominador muda. Quando o payload não traz o bloco da
 *   segunda base, o termômetro entra em **"aguardando projeção"**: exibir o
 *   número de `votaveis` sob o rótulo "% do comparecimento" seria mostrar um
 *   valor de outro universo com o rótulo errado, pior que não mostrar nada.
 *   O átomo que alterna a base existe (`components/atoms/controls/BaseToggle.tsx`,
 *   S07/Fase 5), mas ainda NÃO está ligado às rotas: ler `searchParams` em
 *   `/`, `/uf/[sigla]` e `/uf/[sigla]/governador` tira as três de
 *   estático/SSG e as torna dinâmicas (medido no `next build` da Fase 5 —
 *   54 páginas pré-renderizadas deixam de existir). Enquanto a decisão de
 *   arquitetura não é tomada, todos os callers usam o default e nada muda
 *   na tela.
 *
 * Rótulo de origem (RF-062)
 *   Linha única sob o `<h2>`, lida de `participacao.metodo`: diz que o número
 *   é **projeção a partir do apurado** (nunca resultado oficial, nunca
 *   "baseado em 2022"), com quantas zonas entraram e quanto já apurou. Quando
 *   a UF ainda não tem urna nenhuma, o texto avisa que a projeção é
 *   provisória e vem da proporção nacional (`metodo.tipo`).
 *
 * Transparência (ADR-0017): brancos/nulos e abstenção ficam SEMPRE no DOM.
 * Quando o modelo ainda não emitiu a métrica, o termômetro aparece em
 * estado "aguardando projeção" — nunca é escondido.
 *
 * Server Component puro (sem `"use client"`, sem `framer-motion`) — o bloco
 * é above-the-fold e não pode custar bundle (RNF-007a).
 *
 * O 2º turno NÃO usa este bloco: o modo `binary` das páginas segue com
 * `<HeadlineScore />` intocado.
 */

import {
  ProjectionThermometer,
  type ThermometerBase,
} from "@/components/atoms/bars/ProjectionThermometer";
import { Figure } from "@/components/atoms/data/Figure";
import { candidateColor } from "@/components/blocks/_candidateColor";
import type {
  EdgeCandidate,
  EdgeParticipacao,
  EdgeParticipacaoMetric,
  EdgeUfCandidate,
} from "@/lib/edge-config/types";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import {
  denominadorLabel,
  outrosCount,
  outrosFallback,
  type ProjectionBase,
} from "@/lib/utils/participacao";
import { intensityForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

const HEADING_ID = "projecao-termometros-heading";
const ORIGEM_ID = "projecao-termometros-origem";

/** Candidato nacional (`pct_projetado_lower/upper`) ou de UF (`ci95`). */
type AnyCand = EdgeCandidate | EdgeUfCandidate;

/**
 * Base exibível pelo bloco. Subconjunto de `ParticipacaoBase`:
 * `eleitores_instalados` é base exclusiva da abstenção, nunca de candidato.
 *
 * O tipo passou a viver em `lib/utils/participacao.ts` na Fase 5, para que
 * `components/atoms/controls/BaseToggle.tsx` possa usá-lo sem que um atom
 * importe de um block. Reexportado aqui para não quebrar quem já importava
 * daqui.
 */
export type { ProjectionBase };

export interface ProjectionThermometersProps {
  /** Candidatos já ordenados por `pct_projetado` desc (rank 1 primeiro). */
  candidatos: EdgeCandidate[] | EdgeUfCandidate[];
  /** Bloco `participacao` do payload — opcional; ausência degrada, não quebra. */
  participacao?: EdgeParticipacao | null;
  /**
   * Denominador dos 4 primeiros termômetros (candidatos + Outros).
   * Default `"votaveis"` — a tela abre nessa base (decisão E2b). Brancos/
   * nulos e abstenção têm base fixa e não são afetados.
   */
  base?: ProjectionBase;
  variant?: "full" | "participacao-only";
  heading?: string;
  className?: string;
}

/**
 * Métrica já resolvida na base ativa. `null` significa "o payload não trouxe
 * esta base para este item" → termômetro em "aguardando projeção".
 */
type BaseMetric = {
  pct: number;
  lower: number;
  upper: number;
  atual: number | null;
} | null;

/**
 * Resolve o IC95 dos dois shapes de candidato do payload:
 * nacional (`pct_projetado_lower/upper`) e UF (`ci95.lower/upper`).
 */
function ciOf(c: AnyCand): { lower: number; upper: number } {
  if ("ci95" in c) {
    return { lower: c.ci95.lower, upper: c.ci95.upper };
  }
  return { lower: c.pct_projetado_lower, upper: c.pct_projetado_upper };
}

/**
 * Métrica do candidato na base pedida. Em `comparecimento` NÃO há fallback
 * para `votaveis`: sem o bloco `comparecimento` no payload devolvemos `null`
 * e o chamador renderiza "aguardando" (ver cabeçalho do arquivo).
 */
function metricOf(c: AnyCand, base: ProjectionBase): BaseMetric {
  if (base === "comparecimento") {
    const m = c.comparecimento;
    if (!m) return null;
    return {
      pct: m.pct_projetado,
      lower: m.lower,
      upper: m.upper,
      atual: m.pct_atual !== null && Number.isFinite(m.pct_atual) ? m.pct_atual : null,
    };
  }
  const ci = ciOf(c);
  return {
    pct: c.pct_projetado,
    lower: ci.lower,
    upper: ci.upper,
    atual: Number.isFinite(c.pct_atual) ? c.pct_atual : null,
  };
}

/** Rank do payload; fallback para a posição no array (já ordenado). */
function rankOf(c: AnyCand, index: number): number {
  return "rank" in c && Number.isFinite(c.rank) ? c.rank : index + 1;
}

/**
 * Rótulo de origem do número (RF-062) — sempre presente, nas 4 rotas e nos
 * dois variants. Determinístico: só depende de `participacao.metodo`.
 */
function origemLabel(metodo: EdgeParticipacao["metodo"]): string {
  if (!metodo) return "Aguardando primeira apuração";
  if (metodo.tipo === "imputado_nacional") {
    return "Projeção provisória a partir da proporção nacional — sem urna desta UF ainda";
  }
  const zonas = Number.isFinite(metodo.n_zonas) ? metodo.n_zonas.toLocaleString("pt-BR") : "—";
  const apurado = Number.isFinite(metodo.pct_apurado) ? formatPercent(metodo.pct_apurado, 1) : "—";
  return `Projeção a partir do apurado · ${zonas} zonas · ${apurado} apurado`;
}

export function ProjectionThermometers({
  candidatos,
  participacao,
  base = "votaveis",
  variant = "full",
  heading = "Projeção do 1º turno",
  className,
}: ProjectionThermometersProps) {
  const soCandidatos = variant !== "participacao-only";
  const top3: AnyCand[] = soCandidatos ? candidatos.slice(0, 3) : [];
  const top3Metrics = top3.map((c) => metricOf(c, base));

  // "Outros": preferimos o agregado do modelo (tem IC derivado do mesmo
  // bootstrap dos candidatos). Sem ele, resto aritmético 100 − Σtop3, sem
  // faixa e com nota — mesmo padrão de `<GovernorCard />`.
  //
  // O resto aritmético só existe na base `votaveis`: em `comparecimento`
  // não dá para derivar "Outros" de 100 − Σtop3 (a soma dessa base fecha em
  // 100 menos brancos, nulos e o resíduo de anulados/sub judice), então sem
  // o campo no payload o termômetro fica em "aguardando".
  const outrosMetric = participacao?.outros;
  const outrosN = outrosMetric?.n_candidatos ?? outrosCount(candidatos);
  const outros: BaseMetric =
    base === "comparecimento"
      ? outrosMetric?.comparecimento
        ? {
            pct: outrosMetric.comparecimento.pct_projetado,
            lower: outrosMetric.comparecimento.lower,
            upper: outrosMetric.comparecimento.upper,
            atual: outrosMetric.comparecimento.pct_atual,
          }
        : null
      : (() => {
          const pct = outrosMetric?.pct_projetado ?? outrosFallback(candidatos);
          return {
            pct,
            lower: outrosMetric?.lower ?? pct,
            upper: outrosMetric?.upper ?? pct,
            atual: outrosMetric?.pct_atual ?? null,
          };
        })();
  const outrosPct = outros?.pct ?? 0;
  // Copy contraditória (achado a11y-perf-auditor 2026-09-05): em
  // `/uf/SP/governador`, `candidatos` trazia só os 3 do payload (nenhum
  // "outro" listado, `outrosN = candidatos.length − 3 = 0`) mas o resto
  // aritmético `100 − Σtop3` ainda dava 10,3% — porque `votaveis` (pvap do
  // TSE) inclui anulados + sub judice, que ficam no denominador sem
  // pertencer a candidato nenhum. "Outros · 0 candidatos" ao lado de
  // "10,3%" lia como contradição. Quando o resto é não-trivial mas não há
  // nenhum candidato adicional conhecido, a nota correta é "resíduo" —
  // nunca afirmar "0 candidatos" ao lado de um número positivo.
  const outrosResiduoSemCandidato = outrosN === 0 && outrosPct > 0.05;
  const outrosSubtitulo = outrosMetric
    ? `${outrosN} candidatos`
    : outros === null
      ? undefined
      : outrosResiduoSemCandidato
        ? "resíduo do total (anulados/sub judice) · IC indisponível"
        : `${outrosN} candidatos · IC indisponível`;

  // Escala comum aos 4 primeiros termômetros: barras de 5% ficariam
  // invisíveis ao lado de barras de 40% numa escala fixa de 0–100.
  // Calculada sobre a base ATIVA — em `comparecimento` os percentuais são
  // menores (denominador maior) e uma escala herdada de `votaveis` deixaria
  // todas as barras encolhidas. Termômetros em "aguardando" não contribuem.
  const uppers = soCandidatos
    ? [...top3Metrics, outros]
        .map((m) => m?.upper)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  const scaleMax =
    uppers.length > 0 ? Math.min(100, Math.ceil((Math.max(...uppers) + 5) / 10) * 10) : 100;

  const origem = origemLabel(participacao?.metodo);

  // "Apurado" agregado (ADR-0029 § 6) — o mesmo número que a linha de origem
  // já cita por extenso, promovido a `<Figure>` no cabeçalho do bloco. Sai
  // como `null` (e o `Figure` não é renderizado) quando o modelo ainda não
  // publicou `metodo`, em vez de imprimir "0,0%", que seria afirmar apuração
  // zerada quando o que existe é ausência de medida.
  const apuradoBruto = participacao?.metodo?.pct_apurado;
  const apurado =
    typeof apuradoBruto === "number" && Number.isFinite(apuradoBruto) ? apuradoBruto : null;

  // `participacao-only` só renderiza 2 termômetros (brancos/nulos +
  // abstenção): numa grid de 3 colunas sobrava uma coluna vazia em
  // `/governador` (achado a11y-perf-auditor 2026-09-05).
  //
  // 2026-09-09 — o `md:grid-cols-2` daquela correção SAIU. `md:` mede a
  // VIEWPORT, e desde o ADR-0033 § 1 o único call site desta variante
  // (`/governador`) não vive mais na viewport: vive na coluna de painéis do
  // `<AppShellSplit>`, que mede `--container-sidebar` (400px) fixos —
  // 336px de conteúdo. Numa janela de 1280px o `md:` disparava, dava 156px
  // por coluna e o rótulo "Brancos e nulos" saía truncado em "Brancos e…"
  // (medido em 1280×900: `scrollWidth` 107 contra `clientWidth` 81). Coluna
  // única: cada termômetro recebe os 336px e o rótulo cabe inteiro.
  //
  // `full` mantém as 3 colunas. Não porque esteja certo naquele contexto, mas
  // porque a variante não tem nenhum call site desde os cortes de 09/09 —
  // mudá-la aqui seria alterar um caminho que nenhuma tela exercita.
  const gridColsClass = soCandidatos ? "md:grid-cols-3" : "";

  return (
    <section
      aria-labelledby={HEADING_ID}
      // A origem do número faz parte do que o bloco significa (RF-062 /
      // constituição § 8): quem navega por landmarks tem que ouvir "projeção
      // a partir do apurado" junto com o título, não só quem lê a linha.
      aria-describedby={ORIGEM_ID}
      data-variant={variant}
      className={["flex flex-col", className].filter(Boolean).join(" ")}
      style={{ gap: "var(--space-3)" }}
    >
      {/* Cabeçalho do bloco: título à esquerda, `<Figure>` do "Apurado"
          agregado à direita (ADR-0029 § 6). O `Figure` é o átomo do kit para
          número-manchete e sai em mono — a mesma família dos seis algarismos
          abaixo, o que amarra a leitura "esta é a fatia já contada, aqueles
          são os projetados a partir dela". Só aparece quando o modelo já
          publicou `metodo.pct_apurado`; sem ele, o cabeçalho é só o título. */}
      <div className="flex items-end justify-between" style={{ gap: "var(--space-3)" }}>
        <h2 id={HEADING_ID} style={{ font: "var(--type-title)", color: "var(--text-primary)" }}>
          {heading}
        </h2>
        {apurado !== null && (
          <Figure align="right" label="Apurado" size="sm" value={formatPercent(apurado, 1)} />
        )}
      </div>

      {/* Origem do número (RF-062): a projeção é extrapolada do que já foi
          apurado — nunca resultado oficial, nunca "baseado em 2022". Linha
          única, presente nas 4 rotas e nos dois variants. */}
      <p
        id={ORIGEM_ID}
        data-testid="projecao-origem"
        data-metodo={participacao?.metodo?.tipo ?? "aguardando"}
        style={{
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
        }}
      >
        {origem}
      </p>

      <div
        className={["grid grid-cols-1", gridColsClass].filter(Boolean).join(" ")}
        style={{ gap: "var(--space-5) var(--space-6)" }}
      >
        {top3.map((c, i) => {
          const rank = rankOf(c, i);
          const m = top3Metrics[i] ?? null;
          return (
            <ProjectionThermometer
              key={c.id}
              id={`termometro-cand-${c.id}`}
              titulo={nomeExibicao(c.nome, c.sqcand)}
              // Desenhado ⇒ abreviado (2026-09-19). `subtitulo` é a linha de
              // apoio do termômetro, e três deles dividem a largura da coluna.
              // 🔴 SÓ aqui: `candidateColor(c.partido)` abaixo continua
              // recebendo a sigla INTEIRA, porque cor é sempre da sigla
              // completa (ADR-0024 / constituição § 2). O `aria-label` do átomo
              // é montado só do `titulo`, então nada do que é lido muda.
              subtitulo={siglaExibicao(c.partido)}
              base={base}
              // `cor` é preenchimento (faixa + tick). O número grande NÃO usa
              // esta cor: sai na cor ÚNICA `--color-pct-votos` (decisão do
              // dono, 2026-10-03; até então era `textForParty` pela sigla —
              // ver o docblock de `<ProjectionThermometer />`).
              // Era daqui que vinha a violação `serious` do axe de 2026-09-07 —
              // `c.cor` do payload chega como `var(--color-cand-3)`, 2,99:1.
              //
              // ⚠️ 2026-09-19: aquele comentário nomeava o sintoma e deixava a
              // CAUSA no ar — o payload seguia sendo lido. Agora a cor sai da
              // SIGLA (ADR-0024), e `c.cor` não é mais consultada aqui.
              //
              // 🔴 **2026-09-20 — faltavam DOIS dos três.** O preenchimento já
              // vinha da sigla desde 19/09, mas a faixa de IC seguia na paleta
              // por COLOCAÇÃO e a tinta do número grande caía nela também,
              // dentro do átomo, porque este caller passava `rank` e NÃO
              // passava `partido`. O mesmo termômetro saía com o tick na cor
              // do partido, o intervalo de confiança na cor da colocação e o
              // número grande numa terceira — três cadeias, uma candidatura, e
              // duas delas trocando de tinta a cada ultrapassagem.
              // `intensityForParty(sigla, 1)` é o degrau mais claro da rampa do
              // PRÓPRIO partido: mesma matiz, que é o que o § 2 v1.3 autoriza
              // variar.
              cor={candidateColor(c.partido)}
              corBand={intensityForParty(c.partido, 1)}
              partido={c.partido}
              pctProjetado={m?.pct ?? 0}
              pctLower={m?.lower ?? 0}
              pctUpper={m?.upper ?? 0}
              pctAtual={m?.atual ?? null}
              scaleMax={scaleMax}
              size={rank === 1 ? "hero" : "compact"}
              aguardando={m === null}
            />
          );
        })}

        {soCandidatos && (
          <ProjectionThermometer
            id="termometro-outros"
            titulo="Outros candidatos"
            subtitulo={outrosSubtitulo}
            base={base}
            cor="var(--color-cand-other)"
            corBand="var(--color-cand-band-other)"
            // Sem `corTexto`: "Outros candidatos" é percentual de votos e cai
            // na cor ÚNICA `--color-pct-votos` (decisão do dono, 2026-10-03).
            // Até então o número saía no neutro `--color-cand-other`.
            pctProjetado={outros?.pct ?? 0}
            pctLower={outros?.lower ?? 0}
            pctUpper={outros?.upper ?? 0}
            pctAtual={outros?.atual ?? null}
            scaleMax={scaleMax}
            aguardando={outros === null}
          />
        )}

        {/* As duas cores de participação são das poucas que servem de
            preenchimento E de texto: #565656 mede 6,67:1 e #24504d mede 8,19:1
            sobre --surface-page (o comentário em globals.css traz as medidas).
            Por isso `corTexto` é declarado igual a `cor` aqui — explicitamente,
            porque é uma medição, não uma coincidência. */}
        <ParticipacaoTermometro
          id="termometro-brancos-nulos"
          titulo="Brancos e nulos"
          base="comparecimento"
          cor="var(--color-part-brancos-nulos)"
          corBand="var(--color-part-brancos-nulos-band)"
          corTexto="var(--color-part-brancos-nulos)"
          metric={participacao?.brancos_nulos}
        />

        <ParticipacaoTermometro
          id="termometro-abstencao"
          titulo="Abstenção"
          base="eleitores_instalados"
          cor="var(--color-part-abstencao)"
          corBand="var(--color-part-abstencao-band)"
          corTexto="var(--color-part-abstencao)"
          metric={participacao?.abstencao}
        />
      </div>

      {/* Legenda do denominador — condicional ao variant. Antes desta
          correção (achado a11y-perf-auditor 2026-09-05), `/governador`
          (variant="participacao-only") herdava a legenda de `full` inteira,
          citando "votos a votáveis" e "candidatos e Outros" numa tela que
          não tem nenhum candidato nem termômetro de Outros — categoria
          inexistente na tela confundia o leitor. */}
      {soCandidatos && base === "comparecimento" ? (
        // Na base do comparecimento a soma FECHA (é o mesmo universo), mas
        // não em 100 exatos: o EA20 põe anulados e sub judice dentro de `c`
        // sem que pertençam a candidato, branco ou nulo. Declaramos o
        // resíduo em vez de arredondar a identidade para "somam 100".
        <p
          style={{
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          Candidatos, Outros, brancos e nulos somam 100% de quem compareceu (resíduo: anulados e sub
          judice). Abstenção tem base própria — {denominadorLabel("eleitores_instalados")}.
        </p>
      ) : soCandidatos ? (
        <p
          style={{
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          Denominadores diferentes — os seis números não somam 100. {denominadorLabel("votaveis")}{" "}
          (candidatos e Outros: válidos + anulados + sub judice, conforme o TSE) ·{" "}
          {denominadorLabel("comparecimento")} (brancos e nulos) ·{" "}
          {denominadorLabel("eleitores_instalados")} (abstenção).
        </p>
      ) : (
        <p
          style={{
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          Denominadores diferentes — os dois números abaixo não são comparáveis entre si.{" "}
          {denominadorLabel("comparecimento")} (brancos e nulos) ·{" "}
          {denominadorLabel("eleitores_instalados")} (abstenção).
        </p>
      )}
    </section>
  );
}

/**
 * Termômetro de uma métrica de participação. Quando `metric` é `undefined`
 * (orchestrator ainda não emitiu), renderiza em estado "aguardando
 * projeção" — presente no DOM, com meter zerado (ADR-0017).
 */
function ParticipacaoTermometro({
  id,
  titulo,
  base,
  cor,
  corBand,
  corTexto,
  metric,
}: {
  id: string;
  titulo: string;
  base: ThermometerBase;
  cor: string;
  corBand: string;
  /** Obrigatório aqui de propósito: participação NÃO é percentual de votos de
   *  candidato, então não pode cair no default do átomo (`--color-pct-votos`,
   *  a cor única dos percentuais de votos desde 2026-10-03). */
  corTexto: string;
  metric?: EdgeParticipacaoMetric;
}) {
  return (
    <ProjectionThermometer
      id={id}
      titulo={titulo}
      base={base}
      cor={cor}
      corBand={corBand}
      corTexto={corTexto}
      pctProjetado={metric?.pct_projetado ?? 0}
      pctLower={metric?.lower ?? 0}
      pctUpper={metric?.upper ?? 0}
      pctAtual={metric?.pct_atual ?? null}
      scaleMax={100}
      aguardando={metric === undefined}
      // A linha "↑ X% proj" da Parcial (2026-10-03) é de percentual de votos
      // de candidatura — participação fica fora, como fica da cor única.
      indicadorProjecao={false}
    />
  );
}
