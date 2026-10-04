/**
 * components/blocks/UfLinksGrid.tsx
 *
 * **RF-162 / RF-163 (spec 019)** — as 27 unidades federativas como 27 links, e
 * nada além disso.
 *
 * ## Por que 27 links e não uma grade de rostos
 *
 * Decisão do dono do produto em 2026-09-13, e **não é opção em aberto**:
 * `/governador`, `/senador` e `/deputado-federal` são **27 corridas**, não uma.
 * É a mesma razão que produziu o RF-145 da spec 018 — no bloco nacional dos
 * cargos 3 e 5, `national.candidatos` é a união de 27 corridas sob o mesmo
 * espaço de `id`, e como em cargo majoritário o número na urna É o número do
 * partido, todo candidato do PT do país concorre sob o 13. Qualquer nome
 * atribuído ali é ambíguo **por construção**.
 *
 * Uma grade nacional com 180 rostos de governador, sem a UF ao lado, não
 * responderia a pergunta nenhuma. Os rostos entram pela página de UF, onde a
 * grade da spec 018 (T-14) já funciona e já é honesta — e é para lá que cada um
 * destes 27 links leva.
 *
 * Por isso o teste do RF-162 é **negativo**: "os 27 links estão lá" passa com
 * uma grade de rostos logo abaixo; "nenhum nome de candidatura no documento"
 * não passa.
 *
 * ## Forma
 *
 * Server Component puro, zero JavaScript de cliente (RNF-007a): é uma `<ul>`
 * de `<a href>`. Não usa `<Link>` do `next/link` de propósito — este bloco
 * aparece nas três rotas que **não** têm moldura de mapa persistente
 * (ADR-0033 § 1), então não há instância MapLibre a preservar na navegação, e
 * um `<a>` cru não arrasta o runtime do roteador para uma tela cujo orçamento
 * de aplicação é hoje zero.
 *
 * Lista semântica, nome da UF em texto (não só a sigla) e alvo de toque
 * `--tap-min` — RNF-023 e RNF-024. A ordem é a alfabética por nome, a mesma do
 * `<UfPicker>`: é a ordem que o leitor procura numa lista de estados, e não
 * carrega juízo nenhum sobre as corridas (constituição § 2).
 */

import { UfFlag } from "@/components/atoms/data/UfFlag";
import { ufsPorNome } from "@/components/atoms/maps/_shared";
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";

export interface UfLinksGridProps {
  /** Cargo da corrida — código do TSE, como em todo payload do produto. */
  cargo: CargoTse;
  /** UF corrente, quando houver. Ganha `aria-current="page"`. */
  atual?: string | null;
  /**
   * Spec 027 — as siglas a mostrar, quando a corrida não é das 27 (ex.: as 26
   * assembleias sem o DF). A ordem continua a alfabética por NOME. Ausente ⇒
   * as 27, como sempre.
   */
  ufs?: readonly string[];
  /**
   * Spec 027 — destino por sigla, por cima de {@link ufHrefPorCargo} (ex.: o
   * DF para `/uf/DF/deputado-distrital` na grade das assembleias). Sigla
   * ausente daqui ⇒ o destino padrão.
   */
  hrefPorUf?: Readonly<Record<string, string>>;
  /**
   * Spec 027 — o nome acessível da grade, por cima do padrão "Corridas de
   * {cargo} por unidade federativa". A grade das 27 casas mistura dois cargos
   * (26 Assembleias e a Câmara Legislativa do DF) e precisa dizer isso.
   */
  ariaLabel?: string;
  className?: string;
}

/**
 * Destino de uma UF na corrida corrente.
 *
 * Presidente é a exceção de rota, não de conceito: `/uf/SP` **é** a página
 * presidencial de São Paulo — a trilha presidencial nasceu antes das outras
 * três e ficou com o caminho sem sufixo. O slug das demais vem da tabela
 * canônica (`lib/config/cargos.ts`), nunca de literal aqui.
 */
export function ufHrefPorCargo(cargo: CargoTse, sigla: string): string {
  return cargo === 1 ? `/uf/${sigla}` : `/uf/${sigla}/${cargoInfo(cargo).slug}`;
}

export function UfLinksGrid({
  cargo,
  atual,
  ufs: siglas,
  hrefPorUf,
  ariaLabel,
  className,
}: UfLinksGridProps) {
  const filtro = siglas ? new Set(siglas.map((s) => s.toUpperCase())) : null;
  const ufs = ufsPorNome().filter((uf) => filtro === null || filtro.has(uf.sigla));
  const atualUpper = atual?.toUpperCase() ?? null;
  const info = cargoInfo(cargo);

  return (
    <nav
      aria-label={ariaLabel ?? `Corridas de ${info.label} por unidade federativa`}
      className={className}
      data-testid="uf-links-grid"
    >
      <ul
        className="grid"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-2)",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        }}
      >
        {ufs.map((uf) => {
          const eAtual = uf.sigla === atualUpper;
          return (
            <li key={uf.sigla}>
              <a
                aria-current={eAtual ? "page" : undefined}
                data-sigla={uf.sigla}
                data-testid="uf-links-grid-item"
                href={hrefPorUf?.[uf.sigla] ?? ufHrefPorCargo(cargo, uf.sigla)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-2)",
                  minHeight: "var(--tap-min)",
                  padding: "0 var(--space-3)",
                  border: "1px solid var(--border-hairline)",
                  borderRadius: "var(--radius-sm)",
                  font: "var(--type-body-sm)",
                  color: "var(--text-primary)",
                  textDecoration: "none",
                  ...(eAtual
                    ? {
                        background: "var(--surface-inverse)",
                        borderColor: "var(--surface-inverse)",
                        color: "var(--text-inverse)",
                      }
                    : null),
                }}
              >
                {/* O nome por extenso é o rótulo; a sigla é a etiqueta que quem
                    já sabe procura. Os dois em texto — um mapa colorido sem
                    lista textual paralela é o defeito que a constituição § 4
                    proíbe, e aqui não há nem mapa.

                    ⚠️ 2026-09-18 — `<UfBandeirasGrid>` nasceu com uma bandeira
                    ao lado destes mesmos dois rótulos, e isso **não** contradiz
                    o parágrafo acima. A bandeira entra lá com `aria-hidden` e
                    `focusable="false"`: ela é reconhecimento, não informação, e
                    o nome por extenso e a sigla continuam os dois em texto,
                    exatamente como aqui. A exigência de RF-162/163 é que o
                    rótulo seja texto — não que não possa haver ícone ao lado.
                    2026-10-04 — o dono pediu a bandeira aqui também (ADR-0070,
                    emenda): na fase SEM payload a capa de Deputado Federal
                    mostrava esta lista crua enquanto a Estadual, já com dado,
                    mostrava a grade com bandeiras. Mesmo arranjo do
                    `UfPicker`: bandeira + nome juntos, sigla à direita. */}
                <span className="flex min-w-0 items-center" style={{ gap: "var(--space-2)" }}>
                  <UfFlag sigla={uf.sigla} />
                  <span className="min-w-0 truncate">{uf.nome}</span>
                </span>
                <span className="flex-none" style={{ font: "var(--type-figure-sm)" }}>
                  {uf.sigla}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
