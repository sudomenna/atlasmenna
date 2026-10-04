/**
 * components/blocks/BulletinPanel.tsx
 *
 * "Boletim" — o registro do momento da apuração, em linhas datadas.
 * Design system Atlas Menna (ADR-0025, Bloco 1), portado da ideia do
 * `BulletinPanel` de `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx:115`.
 *
 * Cobertura: RF-026 (estado da apuração + timestamp) e RF-044 (texto de
 * análise por template) na superfície nacional.
 *
 * ===== Texto: template determinístico, nunca LLM — NESTE bloco =====
 * Constituição § 2. O ADR-0072 (04/10/2026) revogou o ADR-0005 só para a
 * caixa "Análise" (`<InsightCard origem="ia">`), que pode trazer texto escrito
 * por IA. Aqui continua valendo "nunca LLM": toda sentença deste bloco sai de
 * regra fixa — ou de `buildBulletin()`, uma função pura de (payload) → itens
 * (mesma entrada, mesma saída; sem `Date.now()`, `Math.random()` nem rede), ou
 * do histórico da leitura da noite (`historico`, ADR-0072), cujas linhas o
 * cron monta com os templates de `lib/leitura/eventos.ts`.
 *
 * ===== Dois modos =====
 *   - SEM `historico` (ou vazio): o estado atual, montado por
 *     `buildBulletin()` e carimbado com o `ts` do ciclo do modelo — o
 *     comportamento de sempre.
 *   - COM `historico`: uma linha por mudança detectada, cada uma com a hora
 *     REAL em que o cron a viu, da mais nova para a mais antiga. As
 *     {@link HISTORICO_VISIVEL} primeiras ficam à vista; o resto vai num
 *     `<details>` (zero JS).
 *
 * As frases descrevem, não julgam: "aparece com", "a diferença projetada é
 * de", "a projeção indica", "matematicamente eleito". Nenhum adjetivo de mérito
 * ("expressiva", "esmagadora", "consolida") entra aqui — a constituição § 2
 * proíbe, e uma vez que a frase existe no código ela é dita a noite inteira.
 *
 * ===== Relação com os blocos vizinhos =====
 *   - `<BreakingNewsTicker />` (topo da página) rotaciona UM resultado
 *     definido por vez. Ticker é alerta; boletim é registro. Desde
 *     2026-10-04 nenhum dos dois lê `national.chamadas_recentes` nem
 *     `EdgeUfRow.chamada`: a definição vem de `eleitos_definidos`
 *     (`lib/utils/anuncios-definidos.ts`), a regra do balão do mapa.
 *   - `<InsightCard />` (RF-044) segue existindo com as frases de
 *     `payload.insights`, geradas server-side — ou, com a leitura da noite
 *     ligada, com a análise escrita por IA (ADR-0072). Não há sobreposição:
 *     aqui as frases nascem do estado numérico da corrida por regra fixa; lá,
 *     do engine de insights ou da IA.
 *
 * Server Component puro — sem estado, sem hooks, zero JS novo (RNF-007a).
 *
 * A11y: `<ol>` com um `<li>` por linha (o leitor anuncia "1 de 5"); o horário
 * vai em `<time dateTime>` para não ser lido como número solto.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import type { EdgeNational, EdgeUfRow, Turno } from "@/lib/edge-config/types";
import { eleitosNacionais, fraseEleitos } from "@/lib/utils/anuncios-definidos";
import { formatCI, formatPercent, formatPp, formatTimeHMS } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

export interface BulletinPanelProps {
  national: EdgeNational;
  rows: EdgeUfRow[];
  /** `EdgePayload.pct_apurado_total` (0–100). */
  pctApuradoTotal: number;
  /** `EdgePayload.ufs_apuradas`. */
  ufsApuradas: number;
  /** ISO 8601 do ciclo do modelo (`EdgePayload.ts`). */
  ts: string;
  turno: Turno;
  totalUfs?: number;
  /**
   * @deprecated 2026-10-04 — sem efeito: `national.chamadas_recentes` não é
   * mais repassado (o texto saía da `chamada` da projeção).
   */
  maxChamadas?: number;
  /**
   * Histórico da leitura da noite (ADR-0072) — `EventoBoletim[]` entra direto
   * (mesmos `id`, `ts`, `head`, `text`). Presente e não vazio ⇒ substitui o
   * `buildBulletin()`. `null`/ausente/vazio ⇒ comportamento de sempre.
   */
  historico?: BulletinItem[] | null;
  className?: string;
}

/** Linhas do histórico à vista; o resto vai para o `<details>`. */
export const HISTORICO_VISIVEL = 15;

export interface BulletinItem {
  /** Chave estável — usada como `key` e como `data-item`. */
  id: string;
  /** ISO 8601 da linha. */
  ts: string;
  /** Rótulo curto em caixa alta. */
  head: string;
  /** Sentença completa. */
  text: string;
}

/** `undefined` quando o array não tem o rank pedido. */
function byRank(national: EdgeNational, rank: number) {
  return (
    national.candidatos.find((c) => c.rank === rank) ?? national.candidatos[rank - 1] ?? undefined
  );
}

/**
 * Constrói o boletim. Exportada para o teste exercitar os templates sem
 * passar pelo DOM — o texto é o contrato aqui, não o markup.
 */
export function buildBulletin({
  national,
  rows,
  pctApuradoTotal,
  ufsApuradas,
  ts,
  turno,
  totalUfs = 27,
}: Omit<BulletinPanelProps, "className" | "historico">): BulletinItem[] {
  const items: BulletinItem[] = [];

  items.push({
    id: "apuracao",
    ts,
    head: "Apuração",
    // ADR-0045 — com o exterior no denominador (Presidente: 28), "unidades
    // federativas" seria falso: o exterior não é UF.
    text: `${formatPercent(pctApuradoTotal, 1)} das seções apuradas, com boletim em ${ufsApuradas} de ${totalUfs} ${totalUfs > 27 ? "unidades de apuração (27 UFs e o exterior)" : "unidades federativas"}.`,
  });

  // 🔊 2026-09-19 — as siglas deste painel NÃO abreviam, e isso é deliberado.
  //
  // A abreviação de `lib/utils/sigla-partido.ts` vale para sigla que é TOKEN
  // dentro de um layout (chip, coluna, rótulo colado ao nome), onde a largura é
  // finita. Aqui ela está dentro de uma FRASE que quebra linha na largura
  // inteira do painel — não há pixel em disputa. E `item.text` é a MESMA string
  // que o leitor de tela recebe: não existe `aria-label` separado para segurar
  // a versão inteira, então encurtar aqui encurtaria também o que é lido, que é
  // o lado que a decisão do dia mandou preservar.
  const lider = byRank(national, 1);
  const segundo = byRank(national, 2);

  if (lider) {
    items.push({
      id: "lideranca",
      ts,
      head: "Projeção",
      text: `${nomeExibicao(lider.nome, lider.sqcand)} (${lider.partido}) aparece com ${formatPercent(lider.pct_projetado, 1)} dos votos a votáveis na projeção, no intervalo de 95% ${formatCI(lider.pct_projetado_lower, lider.pct_projetado_upper)}.`,
    });
  }

  if (lider && segundo) {
    const delta = Math.abs(lider.pct_projetado - segundo.pct_projetado);
    items.push({
      id: "diferenca",
      ts,
      head: "Diferença",
      text: `A diferença projetada entre ${nomeExibicao(lider.nome, lider.sqcand)} e ${nomeExibicao(segundo.nome, segundo.sqcand)} (${segundo.partido}) é de ${formatPp(delta)}.`,
    });
  }

  // O 2º turno é uma pergunta só do 1º turno. Em turno 2 a métrica está vazia
  // de semântica (ver `p_segundo_turno_overall` em lib/edge-config/types.ts).
  if (turno === 1) {
    const p = national.p_segundo_turno_overall;
    items.push({
      id: "segundo-turno",
      ts,
      head: "Segundo turno",
      text:
        p == null
          ? "A probabilidade de segundo turno ainda não foi publicada nesta rodada do modelo."
          : `A projeção indica ${formatPercent(p * 100, 0)} de chance de a eleição ir a segundo turno.`,
    });
  }

  // 🔴 2026-10-04 (dono) — a linha de definição segue a regra do balão do mapa:
  // só afirma quem está MATEMATICAMENTE eleito (`EdgeUfRow.eleitos_definidos`,
  // via `lib/utils/anuncios-definidos.ts`), nunca a `chamada` da projeção. Até
  // esta data dizia "N unidades federativas já foram chamadas para o líder
  // local", contando `chamada === true`. Este painel é o da corrida NACIONAL
  // (Presidente): o eleito só existe quando o Brasil inteiro está definido, e
  // aí vira UMA frase, não uma contagem de UFs.
  const eleitos = eleitosNacionais(rows);
  const fraseEleito = eleitos.length > 0 ? fraseEleitos(eleitos, rows, national) : null;
  items.push({
    id: "definicao",
    ts,
    head: "Definição",
    text: fraseEleito
      ? `${fraseEleito} pela contagem oficial do TSE.`
      : "Nenhuma candidatura está matematicamente eleita até agora.",
  });

  // `national.chamadas_recentes` NÃO é mais repassado: o texto pronto dele
  // ("AP chamada para …") saía da `chamada` da projeção (decisão do dono,
  // 2026-10-04). `maxChamadas` fica na assinatura só por compatibilidade.

  return items;
}

/**
 * Histórico do mais novo para o mais antigo, pelo `ts` de cada linha. Ordena
 * aqui mesmo que o contrato já diga "mais novo primeiro": o painel não confia
 * na ordem de um objeto que veio da rede. `ts` ilegível vai para o fim, na
 * ordem em que veio. `id` repetido entra uma vez só, com o horário mais
 * antigo (a mesma regra da mesclagem do cron) — `id` é `key` e `data-item`.
 */
export function ordenarHistorico(historico: readonly BulletinItem[]): BulletinItem[] {
  const ordenado = historico
    .map((item, i) => ({ item, i, t: Date.parse(item.ts) }))
    .sort((a, b) => {
      const aOk = Number.isFinite(a.t);
      const bOk = Number.isFinite(b.t);
      if (!aOk && !bOk) return a.i - b.i;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return b.t - a.t || a.i - b.i;
    })
    .map(({ item }) => item);
  // Do mais antigo para o mais novo, o primeiro `id` visto fica.
  const vistos = new Set<string>();
  const unicos: BulletinItem[] = [];
  for (let i = ordenado.length - 1; i >= 0; i--) {
    const item = ordenado[i] as BulletinItem;
    if (vistos.has(item.id)) continue;
    vistos.add(item.id);
    unicos.push(item);
  }
  return unicos.reverse();
}

const NOTA_HISTORICO =
  "Cada linha registra uma mudança no horário em que foi detectada, montada por regra fixa a partir da contagem do TSE e da projeção não oficial do AtlasMenna. O resultado oficial é do TSE.";

const NOTA_ESTADO_ATUAL =
  "Linhas montadas por regra fixa a partir da contagem do TSE e da projeção não oficial do AtlasMenna, com o horário da última rodada do modelo. O resultado oficial é do TSE.";

function Linhas({
  items,
  testId,
  start,
}: {
  items: BulletinItem[];
  testId: string;
  start?: number;
}) {
  return (
    <ol data-testid={testId} start={start} className="m-0 list-none p-0">
      {items.map((item, i) => (
        <li
          key={item.id}
          data-item={item.id}
          className="grid grid-cols-[3.25rem_1fr]"
          style={{
            gap: "var(--space-3)",
            padding: "var(--space-3) 0",
            borderTop: i === 0 ? undefined : "1px solid var(--border-hairline)",
          }}
        >
          <time
            dateTime={item.ts}
            style={{ font: "var(--type-data)", color: "var(--text-secondary)" }}
          >
            {formatTimeHMS(item.ts)}
          </time>
          <span style={{ font: "var(--type-body-sm)", textWrap: "pretty" }}>
            <strong style={{ fontWeight: 600 }}>{item.head}</strong>{" "}
            <span style={{ color: "var(--text-secondary)" }}>{item.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function BulletinPanel({ className, historico, ...data }: BulletinPanelProps) {
  const comHistorico = Boolean(historico && historico.length > 0);
  const items = comHistorico ? ordenarHistorico(historico ?? []) : buildBulletin(data);
  const visiveis = comHistorico ? items.slice(0, HISTORICO_VISIVEL) : items;
  const anteriores = comHistorico ? items.slice(HISTORICO_VISIVEL) : [];

  return (
    <Panel
      kicker="Boletim"
      title="O que está acontecendo agora"
      titleId="bulletin-panel-heading"
      className={className}
    >
      <Linhas items={visiveis} testId="bulletin-list" />
      {anteriores.length > 0 ? (
        <details
          data-testid="bulletin-anteriores"
          style={{ borderTop: "1px solid var(--border-hairline)" }}
        >
          <summary
            style={{
              padding: "var(--space-3) 0",
              font: "var(--type-body-sm)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {anteriores.length === 1
              ? "Ver a 1 linha anterior"
              : `Ver as ${anteriores.length} linhas anteriores`}
          </summary>
          <Linhas
            items={anteriores}
            testId="bulletin-list-anteriores"
            start={HISTORICO_VISIVEL + 1}
          />
        </details>
      ) : null}
      <p
        data-testid="bulletin-nota"
        style={{
          margin: "var(--space-3) 0 0",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        {comHistorico ? NOTA_HISTORICO : NOTA_ESTADO_ATUAL}
      </p>
    </Panel>
  );
}
