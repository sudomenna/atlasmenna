/**
 * components/blocks/UfBandeirasGrid.tsx
 *
 * As 27 corridas estaduais como uma grade com bandeira, sigla e nome por
 * extenso — o formato que o dono pediu para o painel "Estado a estado".
 *
 * Server Component puro, zero JavaScript de cliente: é uma `<ul>` de `<a href>`
 * mais um sprite `<symbol>` embutido. Sem `<Link>` do `next/link`, pela mesma
 * razão de `UfLinksGrid`: esta trilha não tem moldura de mapa persistente
 * (ADR-0033 § 1), então não há instância MapLibre a preservar, e um `<a>` cru
 * não arrasta o runtime do roteador para uma tela cujo orçamento de aplicação
 * é zero.
 *
 * ## 🔴 Este componente NÃO pode perder dado — e é o risco óbvio dele
 *
 * A lista que ele substitui carregava, por estado, quem tem a maior bancada,
 * empates sem desempate previsto, vagas sem candidato elegível e o placar de
 * cadeiras. Trocar tudo isso por uma bandeira bonita seria apagar dado que
 * **existe** — o defeito que o ADR-0017 nomeia e que a constituição § 4 proíbe.
 *
 * Por isso os textos continuam todos aqui, vindos de `resumos`: a bandeira é
 * acréscimo, não substituição. E os 27 estados aparecem **sempre**, inclusive
 * os que ainda não têm boletim — geografia é identidade e fala, ao contrário de
 * progresso de apuração, que é medição e cala (a mesma regra que a spec 019
 * aplicou em `UfLinksGrid`).
 *
 * ## Por que não é `UfLinksGrid`
 *
 * `UfLinksGrid` é a grade da fase **sem payload**: 27 links e nada além disso,
 * por decisão explícita do RF-162/163. Esta é outra superfície — a tela com
 * apuração em curso —, e mistura rótulo com resumo de corrida. Alterar aquele
 * componente para servir aos dois casos desfaria a justificativa dele.
 *
 * ## Bandeira ausente é o caminho normal
 *
 * `<UfFlag>` devolve `null` quando a sigla não está na fonte gerada — hoje,
 * todas. O item renderiza só o nome e a sigla, sem buraco no layout e sem
 * ícone quebrado. Ver `components/atoms/data/UfFlag.tsx`.
 *
 * ## Acessibilidade
 *
 * `aria-label="Acre (AC)"` no link, nome por extenso **e** sigla em texto
 * visível, bandeira `aria-hidden` e `focusable="false"`, alvo de toque
 * `--tap-min` (RNF-023/024). A ordem é alfabética por nome — a mesma do
 * `<UfPicker>` e do `<UfLinksGrid>`: é a ordem que o leitor procura numa lista
 * de estados e não carrega juízo nenhum sobre as corridas (constituição § 2).
 */

import { UfFlag, UfFlagSprite } from "@/components/atoms/data/UfFlag";
import { ufsPorNome } from "@/components/atoms/maps/_shared";
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";

/** O que a página já sabe dizer sobre a corrida de uma UF. Texto pronto. */
export interface UfResumoCorrida {
  /** "maior bancada: PL (19)", "aguardando apuração", … */
  detalhe: string;
  /** Coluna da direita: "70 de 70", "vagas não publicadas", … */
  vagas: string;
  /**
   * Spec 026 (design § 8.4) — o selo do estado da projeção de Deputado nesta
   * UF ("projeção liberada · não oficial", …). Texto pronto, com "não oficial"
   * dentro (RF-266); ausente ⇒ nenhuma linha. Quem decide se há selo é a
   * página (interruptor desligado ⇒ nenhum).
   */
  selo?: string;
}

export interface UfBandeirasGridProps {
  /** Cargo da corrida — código do TSE, como em todo payload do produto. */
  cargo: CargoTse;
  /**
   * Sigla → resumo. Sigla ausente cai em {@link SEM_DADO} — que diz
   * "aguardando apuração", nunca zero: um `0 de 0` afirmaria que o estado não
   * elege ninguém (RF-124).
   */
  resumos?: Readonly<Record<string, UfResumoCorrida>>;
  /**
   * Spec 027 — as siglas a mostrar, quando a grade não é das 27 (ex.: as 26
   * assembleias sem o DF). A ordem continua a alfabética por NOME, não a desta
   * lista. Ausente ⇒ as 27, como sempre.
   */
  ufs?: readonly string[];
  /**
   * Spec 027 — destino por sigla, por cima do padrão `/uf/<UF>/<slug do
   * cargo>`. É o que deixa a grade das 27 casas mandar o DF para
   * `/uf/DF/deputado-distrital` enquanto as outras 26 vão para o estadual.
   * Sigla ausente daqui ⇒ o destino padrão.
   */
  hrefPorUf?: Readonly<Record<string, string>>;
  className?: string;
}

/**
 * O que um estado sem linha no payload mostra. **Nenhum número** — a ausência
 * de boletim não é um resultado zero (decisão do dono, 2026-09-14: "não
 * começou", "não sabemos" e "apurando" são três estados).
 */
export const SEM_DADO: UfResumoCorrida = {
  detalhe: "aguardando apuração",
  vagas: "vagas não publicadas",
};

export function UfBandeirasGrid({
  cargo,
  resumos,
  ufs: siglas,
  hrefPorUf,
  className,
}: UfBandeirasGridProps) {
  const filtro = siglas ? new Set(siglas.map((s) => s.toUpperCase())) : null;
  const ufs = ufsPorNome().filter((uf) => filtro === null || filtro.has(uf.sigla));
  const info = cargoInfo(cargo);

  return (
    <nav
      aria-label={`Corridas de ${info.label} por unidade federativa`}
      className={className}
      data-testid="uf-bandeiras-grid"
    >
      <UfFlagSprite />
      <ul
        className="grid"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-2)",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        }}
      >
        {ufs.map((uf) => {
          const resumo = resumos?.[uf.sigla] ?? SEM_DADO;
          return (
            <li key={uf.sigla}>
              <a
                aria-label={`${uf.nome} (${uf.sigla})`}
                data-testid="corrida-uf"
                data-uf={uf.sigla}
                href={hrefPorUf?.[uf.sigla] ?? `/uf/${uf.sigla}/${info.slug}`}
                className="flex items-center"
                style={{
                  gap: "var(--space-3)",
                  minHeight: "var(--tap-min)",
                  padding: "var(--space-2) var(--space-3)",
                  border: "1px solid var(--border-hairline)",
                  borderRadius: "var(--radius-sm)",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {/* Decorativa. Quando o arquivo não existe, some inteira — não
                    vira caixa vazia nem espaço reservado. */}
                <UfFlag sigla={uf.sigla} />

                <span className="min-w-0 flex flex-col" style={{ gap: "var(--space-1)" }}>
                  <span
                    className="inline-flex items-baseline"
                    style={{ gap: "var(--space-2)", font: "var(--type-body-sm)" }}
                  >
                    {/* Os dois rótulos em TEXTO — nome por extenso e sigla. É o
                        que mantém a grade legível sem depender da bandeira, e é
                        a mesma exigência de RF-162/163. */}
                    <span className="truncate">{uf.nome}</span>
                    <span className="flex-none" style={{ font: "var(--type-figure-sm)" }}>
                      {uf.sigla}
                    </span>
                  </span>

                  <span
                    className="min-w-0"
                    style={{
                      font: "var(--type-body-sm)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                      textWrap: "pretty",
                    }}
                  >
                    {resumo.detalhe}
                  </span>

                  <span
                    data-testid="corrida-vagas"
                    style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
                  >
                    {resumo.vagas}
                  </span>

                  {resumo.selo ? (
                    <span
                      data-testid="corrida-projecao"
                      style={{
                        font: "var(--type-body-sm)",
                        fontSize: "var(--text-xs)",
                        color: "var(--accent-text)",
                      }}
                    >
                      {resumo.selo}
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
