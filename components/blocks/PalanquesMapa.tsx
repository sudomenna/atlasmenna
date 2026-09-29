/**
 * components/blocks/PalanquesMapa.tsx
 *
 * Mapa dos palanques (V3 do plano de 29/09, spec 025): para cada UF, o palanque
 * presidencial do candidato a governador que lidera a corrida — e se o voto
 * daquele estado está casado ou dividido com quem lidera para presidente ali.
 *
 * **Server Component, zero JavaScript no navegador.** SVG de ladrilhos
 * hexagonais sobre `lib/data/uf-hex-layout.ts` (o mesmo layout do
 * `HexCartogramBrasil`). NÃO toca MapLibre nem PMTiles (ADR-0010): são 27
 * polígonos iguais, e o que se compara é um rótulo, não uma geografia.
 *
 * ## Dados
 *
 * Só dado puro (`PalanquesUf`, `_palanques.ts`): a página resolve o líder, o
 * palanque (pelo leitor de `lib/etiquetas/`) e o líder presidencial, e entrega
 * duas listas — uma por base. `palanquesDaBase` (mesmo arquivo) faz essa cola
 * para a página. O componente não lê etiqueta, não lê payload, não decide nada
 * além de desenhar.
 *
 * ## As duas bases, sem JS
 *
 * As duas seções saem no HTML, cada uma com `data-view-only` (`"parcial"` /
 * `"proj"`): a cascata de `app/globals.css` mostra só a da base ativa da chave
 * "Parcial / Projeção" e tira a outra da árvore de acessibilidade
 * (`display: none`). Mesma mecânica do painel "1º ou 2º turno" de
 * `/governador`. Por isso o elemento com `data-view-only` nunca recebe `display`
 * do CSS deste módulo.
 *
 * ## Cor (constituição § 2 e § 4)
 *
 * Não há cor: o palanque é um padrão de hachura em tinta neutra, e cada ladrilho
 * leva um CÓDIGO DE TEXTO (LU / FB / L+F / S/D). O casado/dividido é o contorno
 * (contínuo × tracejado) mais o sinal "=" / "≠" no texto. Ver o CSS para a
 * medição que justifica não usar preenchimento cinza.
 *
 * ## `a_classificar` nunca aparece
 *
 * Palanque `a_classificar`, valor desconhecido e "sem leitura" desenham o mesmo
 * ladrilho quieto: sem hachura, contorno pontilhado fino, código "—", e "—"
 * também na lista textual. Nenhuma string "a classificar" sai deste componente
 * nem entra na legenda. (A página ainda esconde a visão inteira pelo portão de
 * cobertura; este estado só aparece em teste e em dev.)
 *
 * ## Acessibilidade (RNF-025)
 *
 * `<svg role="img">` com `<title>`/`<desc>` e `aria-describedby` apontando para
 * a descrição e para o rótulo da lista textual paralela (mesma convenção do
 * mapa nacional, que aponta para o cabeçalho da lista — não para as 27 linhas),
 * `aria-details` para a lista. A lista é um `<ul>` de frases dentro de um
 * `<div className="sr-only">`; não há `<table>` (`sr-only` direto em tabela
 * estoura o layout — `tests/unit/design-system/sr-only-tabela.test.ts`). Nada
 * é interativo. A ordem da lista é a alfabética por sigla, fixa: nem a
 * etiqueta, nem a ordem de entrada, nem o resultado a mudam (RF-238).
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import {
  gridBounds,
  hexCenter,
  hexPoints,
  UF_HEX_POSITIONS,
  UF_LIST,
} from "@/lib/data/uf-hex-layout";
import { categoria, rotuloDoValor } from "@/lib/etiquetas/catalogo";

import {
  type BasePalanques,
  type CandidatoPalanque,
  type Casamento,
  casamento,
  type PalanquesUf,
  type PalanqueValor,
  type PresidentePalanque,
  palanqueValido,
  resumoCasamento,
} from "./_palanques";
import { EtiquetasAviso } from "./EtiquetasAviso";
import styles from "./PalanquesMapa.module.css";

export type {
  BasePalanques,
  CandidatoPalanque,
  LiderPresidencial,
  PalanquesUf,
  PalanqueValor,
  PresidentePalanque,
} from "./_palanques";

export interface PalanquesMapaProps {
  /** Base "Parcial" (contagem): os 27 ladrilhos como a contagem os vê. */
  parcial: readonly PalanquesUf[];
  /** Base "Projeção" (modelo). */
  projecao: readonly PalanquesUf[];
  /** Só rotula ("1º turno" / "2º turno"); o palanque já vem resolvido no turno certo. */
  turno: 1 | 2;
  /** Prefixo dos ids do DOM. Único por instância na página. Default `"palanques"`. */
  id?: string;
  /** `true` quando a página já mostra o `EtiquetasAviso` na mesma superfície. */
  semAviso?: boolean;
}

// ---------------------------------------------------------------------------
// Apresentação — o que é só desenho, indexado pelo id do catálogo
// ---------------------------------------------------------------------------

/**
 * Código de texto e padrão de hachura de cada valor do catálogo que o mapa sabe
 * desenhar. Valor NOVO no catálogo, sem entrada aqui, desenha o ladrilho quieto
 * (e some da legenda) em vez de inventar uma aparência; o teste de cobertura
 * acusa a lacuna.
 */
const PALANQUE_VISUAL = {
  palanque_lula: { codigo: "LU", padrao: "lula" },
  palanque_flavio_bolsonaro: { codigo: "FB", padrao: "flavio" },
  palanque_duplo: { codigo: "L+F", padrao: "duplo" },
  sem_palanque_declarado: { codigo: "S/D", padrao: "sem" },
} as const satisfies Record<string, { codigo: string; padrao: string }>;

type PalanqueDesenhavel = keyof typeof PALANQUE_VISUAL;

function desenhavel(v: string): v is PalanqueDesenhavel {
  return Object.keys(PALANQUE_VISUAL).includes(v);
}

const MARCA: Record<Casamento, string> = { casado: "=", dividido: "≠", nao_se_aplica: "" };
const TEXTO_CASAMENTO: Record<Casamento, string> = {
  casado: "casado",
  dividido: "dividido",
  nao_se_aplica: "não se aplica",
};

const RAIO = 26;
/** Folga entre ladrilhos: o polígono é desenhado menor para o contorno grosso caber. */
const FOLGA = 2;
const SEM_LEITURA = "—";

const LEGENDA_BASE: Record<BasePalanques, string> = {
  proj: "Palanque presidencial do candidato a governador que lidera a projeção em cada estado. Projeção do modelo, não é resultado oficial.",
  parcial:
    "Palanque presidencial do candidato a governador que lidera a contagem em cada estado, só com o que já foi apurado.",
};

const TITULO_BASE: Record<BasePalanques, string> = {
  proj: "pela projeção Atlas Menna (não oficial)",
  parcial: "pela contagem até agora",
};

const SIGLAS_ALFABETICAS: readonly string[] = [...UF_LIST].sort();

// ---------------------------------------------------------------------------
// Derivação de UMA UF
// ---------------------------------------------------------------------------

interface Derivada {
  /** id do catálogo que o mapa desenha, ou `null` = ladrilho quieto. */
  palanque: PalanqueDesenhavel | null;
  casamento: Casamento;
}

function derivar(u: PalanquesUf | undefined): Derivada {
  const valor = palanqueValido(u?.governador?.palanque);
  if (!desenhavel(valor)) return { palanque: null, casamento: "nao_se_aplica" };
  return { palanque: valor, casamento: casamento(valor, u?.presidente) };
}

function textoPalanque(v: PalanqueValor | string): string {
  return rotuloDoValor("palanque_presidencial", v) ?? SEM_LEITURA;
}

function textoCandidato(c: CandidatoPalanque): string {
  return c.partido ? `${c.nome} (${c.partido})` : c.nome;
}

function textoPresidente(p: PresidentePalanque | null | undefined): string {
  if (!p) return "sem leitura nesta base";
  if (p.lider === "lula") return "Lula";
  if (p.lider === "flavio_bolsonaro") return "Flávio Bolsonaro";
  return p.nome ?? "outro candidato";
}

function frase(sigla: string, u: PalanquesUf | undefined, d: Derivada): string {
  const gov = u?.governador;
  const quem = gov
    ? `${textoCandidato(gov)}, ${gov.papel === "eleito" ? "eleito" : "lidera"}`
    : "sem leitura nesta base";
  const palanque = d.palanque ? textoPalanque(d.palanque) : SEM_LEITURA;
  const voto = d.palanque ? TEXTO_CASAMENTO[d.casamento] : SEM_LEITURA;
  let s = `${UF_NOMES[sigla] ?? sigla} (${sigla}) — Governador: ${quem}. Palanque: ${palanque}. Presidente: ${textoPresidente(u?.presidente)}. Voto: ${voto}.`;
  if (u?.finalistas && u.finalistas.length > 0) {
    const lista = u.finalistas
      .map((f) => `${textoCandidato(f)}, ${textoPalanque(palanqueValido(f.palanque))}`)
      .join("; ");
    s += ` Finalistas: ${lista}.`;
  }
  return s;
}

const estados = (n: number) => `${n} ${n === 1 ? "estado" : "estados"}`;

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

/** Passo da hachura, em unidades do SVG. */
const PASSO = 5;
const CENTRO = PASSO / 2;

function Hachuras({ p }: { p: string }) {
  const base = { width: PASSO, height: PASSO, patternUnits: "userSpaceOnUse" } as const;
  const vertical = `M${CENTRO} 0V${PASSO}`;
  return (
    <defs>
      <pattern id={`${p}-h-lula`} {...base} patternTransform="rotate(45)">
        <rect width={PASSO} height={PASSO} className={styles.papel} />
        <path d={vertical} className={styles.traco} />
      </pattern>
      <pattern id={`${p}-h-flavio`} {...base} patternTransform="rotate(-45)">
        <rect width={PASSO} height={PASSO} className={styles.papel} />
        <path d={vertical} className={styles.traco} />
      </pattern>
      <pattern id={`${p}-h-duplo`} {...base} patternTransform="rotate(45)">
        <rect width={PASSO} height={PASSO} className={styles.papel} />
        <path d={`${vertical}M0 ${CENTRO}H${PASSO}`} className={styles.traco} />
      </pattern>
      <pattern id={`${p}-h-sem`} {...base}>
        <rect width={PASSO} height={PASSO} className={styles.papel} />
        <circle cx={CENTRO} cy={CENTRO} r={0.9} className={styles.ponto} />
      </pattern>
    </defs>
  );
}

function Amostra({ fill, className }: { fill: string; className?: string }) {
  return (
    <svg
      className={className ? `${styles.amostra} ${className}` : styles.amostra}
      width="26"
      height="20"
      viewBox="0 0 26 20"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="23" height="17" rx="2" fill={fill} />
    </svg>
  );
}

function Legenda({ p }: { p: string }) {
  const valores = categoria("palanque_presidencial").valores.filter(
    (v) => desenhavel(v.id) && v.rotulo,
  );
  return (
    <div className={styles.legenda}>
      <ul className={styles.legendaLista} aria-label="Legenda do palanque">
        {valores.map((v) => {
          if (!desenhavel(v.id)) return null;
          const { codigo, padrao } = PALANQUE_VISUAL[v.id];
          return (
            <li key={v.id}>
              <Amostra fill={`url(#${p}-h-${padrao})`} />
              <span className={styles.codigoLegenda}>{codigo}</span>
              <span>{v.rotulo}</span>
            </li>
          );
        })}
      </ul>
      <ul className={styles.legendaLista} aria-label="Legenda do voto casado ou dividido">
        <li>
          <Amostra fill="none" className={styles.amostraCasado} />
          <span className={styles.codigoLegenda}>{MARCA.casado}</span>
          <span>
            Voto casado: governador e presidente no mesmo palanque (o palanque duplo conta como
            casado).
          </span>
        </li>
        <li>
          <Amostra fill="none" className={styles.amostraDividido} />
          <span className={styles.codigoLegenda}>{MARCA.dividido}</span>
          <span>Voto dividido: um lidera no palanque de Lula, o outro no de Flávio Bolsonaro.</span>
        </li>
        <li>
          <Amostra fill="none" />
          <span className={styles.codigoLegenda} aria-hidden="true" />
          <span>
            Não se aplica, sem sinal: quem lidera para presidente é outro candidato, ou o governador
            não declarou palanque.
          </span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma base
// ---------------------------------------------------------------------------

function BaseMapa({
  base,
  ufs,
  turno,
  id,
}: {
  base: BasePalanques;
  ufs: readonly PalanquesUf[];
  turno: 1 | 2;
  id: string;
}) {
  const p = `${id}-${base}`;
  const porUf = new Map<string, PalanquesUf>();
  for (const u of ufs) {
    const sigla = u.uf.toUpperCase();
    if (!porUf.has(sigla)) porUf.set(sigla, u);
  }
  const derivadas = new Map(
    [...UF_LIST].map((sigla) => [sigla, derivar(porUf.get(sigla))] as const),
  );
  const { width, height } = gridBounds(RAIO);
  const resumo = resumoCasamento(ufs);
  const total = resumo.casado + resumo.dividido + resumo.naoSeAplica;
  const resumoTexto =
    total > 0
      ? `Voto casado em ${estados(resumo.casado)} · dividido em ${estados(resumo.dividido)} · não se aplica em ${estados(resumo.naoSeAplica)}.`
      : null;

  const desc =
    "Cada hexágono é um estado, todos do mesmo tamanho. A hachura e o código no hexágono dizem o palanque presidencial do candidato a governador que lidera; o contorno e o sinal = ou ≠ dizem se o voto está casado ou dividido com quem lidera para presidente no estado. O palanque duplo conta como casado com qualquer um dos dois líderes." +
    (resumoTexto ? ` ${resumoTexto}` : "");

  return (
    <div data-view-only={base} data-testid={`palanques-${base}`}>
      <figure className={styles.figura}>
        <figcaption className={styles.legendaTexto}>
          {turno}º turno. {LEGENDA_BASE[base]}
        </figcaption>
        <svg
          className={styles.mapa}
          role="img"
          aria-labelledby={`${p}-t`}
          aria-describedby={`${p}-d ${p}-lt`}
          aria-details={`${p}-l`}
          viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={`${p}-t`}>{`Mapa dos palanques dos governadores, ${TITULO_BASE[base]}`}</title>
          <desc id={`${p}-d`}>{desc}</desc>
          <Hachuras p={p} />
          {Object.entries(UF_HEX_POSITIONS).map(([sigla, pos]) => {
            const d = derivadas.get(sigla) ?? {
              palanque: null,
              casamento: "nao_se_aplica" as const,
            };
            const { x, y } = hexCenter(pos, RAIO);
            const visual = d.palanque ? PALANQUE_VISUAL[d.palanque] : null;
            const marca = d.palanque ? MARCA[d.casamento] : "";
            const codigo = visual
              ? marca
                ? `${visual.codigo} ${marca}`
                : visual.codigo
              : SEM_LEITURA;
            return (
              <g
                key={sigla}
                className={styles.ladrilho}
                data-uf={sigla}
                data-palanque={d.palanque ?? "nenhum"}
                data-casamento={d.palanque ? d.casamento : "nao_se_aplica"}
                fill={visual ? `url(#${p}-h-${visual.padrao})` : undefined}
              >
                <polygon points={hexPoints(x, y, RAIO - FOLGA)} />
                <text className={styles.sigla} x={x.toFixed(1)} y={(y - 2).toFixed(1)}>
                  {sigla}
                </text>
                <text className={styles.codigo} x={x.toFixed(1)} y={(y + 11).toFixed(1)}>
                  {codigo}
                </text>
              </g>
            );
          })}
        </svg>
        {resumoTexto ? <p className={styles.resumo}>{resumoTexto}</p> : null}
        <Legenda p={p} />
        <div className="sr-only">
          <p id={`${p}-lt`}>
            Lista dos 27 estados: governador que lidera, palanque, líder para presidente e voto
            casado ou dividido.
          </p>
          <ul id={`${p}-l`} aria-labelledby={`${p}-lt`}>
            {SIGLAS_ALFABETICAS.map((sigla) => {
              const u = porUf.get(sigla);
              const d = derivadas.get(sigla) ?? {
                palanque: null,
                casamento: "nao_se_aplica" as const,
              };
              return (
                <li key={sigla} data-uf={sigla} data-sqcand={u?.governador?.sqcand ?? undefined}>
                  {frase(sigla, u, d)}
                </li>
              );
            })}
          </ul>
        </div>
      </figure>
    </div>
  );
}

export function PalanquesMapa({
  parcial,
  projecao,
  turno,
  id = "palanques",
  semAviso = false,
}: PalanquesMapaProps) {
  return (
    <div className={styles.raiz} data-testid="palanques-mapa">
      <BaseMapa base="parcial" ufs={parcial} turno={turno} id={id} />
      <BaseMapa base="proj" ufs={projecao} turno={turno} id={id} />
      {semAviso ? null : <EtiquetasAviso />}
    </div>
  );
}
