/**
 * app/(cand)/candidatos/page.tsx — T-13, spec 018 (RF-146 a RF-151).
 *
 * "Quem está concorrendo": nome de urna, foto, partido e número das
 * candidaturas publicáveis, por cargo e por UF. É a superfície que enche o mês
 * anterior a 04/10, quando ainda não há um voto apurado, com a informação que
 * já existe e já é pública.
 *
 * ## Zero JavaScript de aplicação (RF-146, RF-147)
 *
 * Medido em 13/09 contra o build de produção: esta rota baixa as **mesmas 8
 * requisições** de `/sobre-o-modelo`, a rota mais simples do site — 150.285 B
 * gz descontado o chunk `nomodule`, abaixo do piso de framework registrado
 * (RNF-007a-floor, 153.482 B, `docs/nfr/performance.md`). Pela definição
 * vigente do RNF-007a (ADR-0030: **total medido − piso**), o above-the-fold de
 * aplicação desta rota é zero, e a folga é o orçamento inteiro de 150 KB.
 *
 * ⚠️ Uma versão anterior deste bloco dizia "148,7 KiB de 150, sobram 1,3 KiB".
 * Aquele número media o **escopo antigo** da métrica, abandonado em 2026-09-07
 * — a folga real é de dezenas de KiB, não de 1,3. O que NÃO mudou é a
 * consequência, e ela é o motivo de o bloco existir: a rota é zero de
 * aplicação, e qualquer fronteira de cliente aberta aqui deixaria de ser.
 * Consequências, todas visíveis no código abaixo:
 *
 *   - filtro e busca por `<form method="get">` + `searchParams`. Sem `useState`,
 *     sem `onChange`, sem debounce. Funciona com JavaScript desligado, que é
 *     critério de aceitação do RF-147, não cortesia;
 *   - a paginação é `<a href="?limite=…#c-60">`, não um botão com handler —
 *     ver "Uma fatia por vez" abaixo;
 *   - tudo Server Component, inclusive o campo de busca
 *     (`<SearchField>`, a variante não-controlada de
 *     `components/atoms/controls/SearchInput.tsx`);
 *   - a foto é `<img>` nativo, não `next/image` — ver `<CandidateAvatar>`.
 *
 * ## Sem 5ª aba no `CargoTabs`
 *
 * `components/layout/CargoTabs.tsx` registra que "Deputado Federal" já não cabe
 * em 1/4 de 430px. `/candidatos` é rota de nível superior, como
 * `/sobre-o-modelo`, e **não emite `main[data-trilha]`** — o mecanismo de aba
 * corrente é CSS lendo esse atributo com `:has()`, então a ausência dele é
 * exatamente o estado "nenhuma aba marcada".
 *
 * ## Uma fatia por vez, nunca tudo
 *
 * São ~7.700 candidaturas publicáveis. A página lê **uma** fatia de
 * `(cargo, UF)` do Blob por render. Sem filtro escolhido, o default é
 * Presidente/`BR` — 12 candidaturas, a menor corrida do produto e a única
 * nacional. `readCandidatosUf` nunca lança: fatia ausente vira estado honesto
 * com a moldura da página inteira (constituição § 7), nunca 500.
 *
 * E dentro da fatia, **60 por vez** (`CANDIDATOS_POR_PAGINA`). Uma fatia já é
 * grande demais para desenhar inteira: cargo 6 em SP tem 1.061 publicáveis, e
 * o HTML de 1.061 cartões media 4.015.398 bytes no build de produção. Gzip
 * resolve a rede (109 KB), não a construção do DOM no celular fraco.
 *
 *   - `?limite=` controla o corte; entrada inválida degrada **fechado** para 60,
 *     como `?cargo=99` e `?uf=ZZ` já fazem (`parseLimite`);
 *   - "carregar mais" é um `<a href>` com **fragmento** (`?limite=120#c-60`),
 *     nunca um `<button>`: sem JavaScript, e a âncora é o que o torna
 *     equivalente a um botão. Sem ela o leitor volta ao topo e a solução fica
 *     pior que o botão que ela substitui;
 *   - o corte é de **exibição**. Nenhuma conta olha a lista cortada — nesta
 *     tela não há conta nenhuma, e a contagem exibida é sempre o total real.
 *
 * ## Prosa derivada, nunca literal (design 018 § D8)
 *
 * Nenhuma contagem, data ou rótulo de cargo escrito à mão. `fonte_ts` sai do
 * payload, a contagem sai do tamanho da lista **antes do corte**, o rótulo do
 * cargo sai de `lib/config/cargos.ts`. A lição custou quatro frases falsas de
 * uma vez na spec 017 quando a granularidade do Senador mudou.
 */

import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { SearchField } from "@/components/atoms/controls/SearchInput";
import { Panel } from "@/components/atoms/surfaces/Panel";
import {
  ancoraCandidato,
  CANDIDATOS_LIMITE_MAX,
  CANDIDATOS_POR_PAGINA,
  CandidatosGrid,
  formatarContagem,
  ordenarCandidatosPorNumero,
  parseLimite,
} from "@/components/blocks/CandidatosGrid";
// RF-150 — a atribuição de licença cc-by vive num bloco só desde 13/09, quando
// o RF-149 trouxe a segunda superfície que a exibe. Ver o cabeçalho de
// `CandidaturasFonte.tsx`.
import { CandidaturasFonte } from "@/components/blocks/CandidaturasFonte";
import { Footer } from "@/components/layout/Footer";
import {
  type CandidatoIdentidade,
  type CandidatosUnavailableReason,
  readCandidatosUf,
} from "@/lib/blob/candidatos";
import {
  CARGOS,
  type CargoTse,
  cargoInfo,
  cargoToken,
  parseCargoSegment,
} from "@/lib/config/cargos";
import { CATEGORIAS_CHIP } from "@/lib/etiquetas/catalogo";
import { lerEtiquetas } from "@/lib/etiquetas/leitor";
import { etiquetasDaLista } from "@/lib/etiquetas/telas";

/**
 * 12 horas — tem que bater com `CANDIDATOS_REVALIDATE_SECONDS`.
 *
 * ⚠️ **Precisa ser um literal.** O Next exige que os `export const` de
 * configuração de segmento sejam estaticamente analisáveis; trocar por
 * `CANDIDATOS_REVALIDATE_SECONDS` importado faz o build falhar com "Invalid
 * segment configuration export detected" — medido em 13/09, não suposto. Então
 * o número é duplicado por imposição da plataforma, não por descuido.
 *
 * E já divergiu: quando a constante virou 43.200 s, este literal ficou em
 * 3.600 com um comentário afirmando que eram "o mesmo". Como não dá para
 * importar, a sincronia é garantida por teste —
 * `tests/unit/pages/candidatos.test.tsx` compara os dois e reprova se
 * divergirem. É o teste que substitui o import.
 *
 * Identidade de candidatura não é dado vivo: quem se candidatou, com que número
 * e por que partido está fechado desde o registro. O único campo que ainda se
 * move é `situacao_julgamento`, e a defasagem só é honesta porque a tela data o
 * dado (RF-150).
 */
export const revalidate = 43_200;

export const metadata: Metadata = {
  title: "Candidatos 2026 — AtlasMenna",
  description:
    "Quem está concorrendo em 2026: nome de urna, partido e número das candidaturas " +
    "registradas no TSE, por cargo e por unidade da federação.",
};

// ---------------------------------------------------------------------------
// Domínio dos filtros
// ---------------------------------------------------------------------------

/**
 * As 27 UFs, mais `BR`.
 *
 * `BR` não é uma UF: é o que o CSV do TSE traz em `SG_UF` para candidatura
 * presidencial, e o que o caminho do Blob usa para o cargo 1
 * (`candidatos/uf/BR/pres.json`). Passa no padrão de duas letras sem caso
 * especial (design 018 § D1).
 *
 * ⚠️ Quinta cópia desta lista no repositório — as outras quatro estão nas
 * páginas de UF e em `lib/tse/targets.ts::TODAS_UFS`, nenhuma exportada.
 * Consolidar em `lib/config/` é limpeza devida; `lib/` está fora do território
 * desta tarefa.
 */
const UFS = [
  "BR",
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

const UF_SET = new Set<string>(UFS);

/** Cargo default: a menor corrida do produto e a única nacional. */
const CARGO_DEFAULT: CargoTse = 1;
/** UF default. Presidente mora sob `BR`. */
const UF_DEFAULT = "BR";

/**
 * Resultado de ler os filtros da URL.
 *
 * `invalido` existe separado de "sem resultado" de propósito: o RF-147 exige um
 * estado **nomeado** para `?cargo=99`, `?uf=ZZ` e `?cargo=7` (Deputado
 * Estadual, que existe no TSE e não no produto) — nunca 500, e nunca a lista
 * inteira em silêncio. Entrada inválida degrada fechado, como a
 * publicabilidade do ADR-0040.
 */
interface Filtros {
  cargo: CargoTse;
  uf: string;
  /**
   * O texto de busca, cru. Volta para o campo como `defaultValue` — é o que
   * mantém o formulário preenchido depois do submit (RF-148).
   */
  busca: string;
  /**
   * Quantas candidaturas **desenhar**. Nunca quantas existem, nunca quantas
   * entram numa conta. Já validado e limitado ao teto por `parseLimite`.
   */
  limite: number;
  invalido: boolean;
}

function primeiro(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

function lerFiltros(params: Record<string, string | string[] | undefined>): Filtros {
  const cargoRaw = primeiro(params.cargo).trim();
  const ufRaw = primeiro(params.uf).trim().toUpperCase();
  const busca = primeiro(params.q);

  // Ausente é default; presente e irreconhecível é INVÁLIDO. As duas coisas não
  // podem colapsar numa só, ou `?cargo=99` mostraria Presidente como se nada
  // tivesse acontecido.
  const cargo = cargoRaw ? parseCargoSegment(cargoRaw) : CARGO_DEFAULT;
  const ufValida = ufRaw ? UF_SET.has(ufRaw) : true;
  const invalido = cargo === null || !ufValida;

  // Sob filtro inválido os seletores voltam ao default, e não ao valor
  // recusado: repor "99" numa lista que não o contém deixaria o `<select>` num
  // estado que o leitor não consegue reproduzir nem desfazer.
  return {
    cargo: cargo ?? CARGO_DEFAULT,
    uf: ufRaw && ufValida ? ufRaw : UF_DEFAULT,
    busca,
    // `?limite=abc`, `?limite=-5` e `?limite=0` NÃO marcam a página como
    // inválida: são ruído num parâmetro de exibição, não um pedido de corrida
    // que não existe. Degradam para 60 e a página segue — `?cargo=99` é outra
    // coisa, porque ali o leitor pediu um cargo que o produto não cobre.
    limite: parseLimite(params.limite),
    invalido,
  };
}

// ---------------------------------------------------------------------------
// Busca (RF-148)
// ---------------------------------------------------------------------------

/** Sem acento, sem caixa — é como o leitor digita e não como o TSE grava. */
function dobra(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Casa contra nome de urna **e** nome completo.
 *
 * Os dois, e não só o de urna: quem procura "Luiz Inácio" precisa achar quem
 * está na urna como "LULA". Busca vazia ou só espaços equivale a sem filtro —
 * não a "nenhum resultado" (RF-148).
 */
function filtrarPorNome(
  candidatos: readonly CandidatoIdentidade[],
  busca: string,
): readonly CandidatoIdentidade[] {
  const alvo = dobra(busca.trim());
  if (!alvo) return candidatos;
  return candidatos.filter(
    (c) => dobra(c.nome_urna).includes(alvo) || dobra(c.nome).includes(alvo),
  );
}

// ---------------------------------------------------------------------------
// Estados sem grade
// ---------------------------------------------------------------------------

/**
 * O texto de cada motivo de indisponibilidade.
 *
 * "esta corrida não foi publicada" e "não conseguimos falar com o
 * armazenamento" são notícias diferentes para o leitor (constituição § 8), e é
 * por isso que `readCandidatosUf` devolve o motivo em vez de `null`.
 */
const TEXTO_INDISPONIVEL: Record<CandidatosUnavailableReason, string> = {
  not_configured:
    "A lista de candidaturas não está disponível neste ambiente — falta a configuração de " +
    "armazenamento.",
  not_found:
    "Ainda não publicamos a lista de candidaturas desta corrida. Ela entra assim que a " +
    "importação do cadastro do TSE cobrir este cargo e esta unidade da federação.",
  fetch_error:
    "Não conseguimos carregar a lista de candidaturas agora. O problema é nosso, não do TSE — " +
    "tente de novo em alguns minutos.",
  invalid:
    "A lista de candidaturas que recebemos não está no formato esperado, então preferimos não " +
    "mostrá-la.",
};

// ---------------------------------------------------------------------------
// Formulário (RF-147, RF-148)
// ---------------------------------------------------------------------------

/**
 * `<form method="get">`: o navegador monta a query string e navega. Sem
 * `action`, o submit vai para a própria rota.
 *
 * Os valores submetidos voltam como `defaultValue`/`defaultChecked` — é o que
 * mantém o formulário preenchido depois do submit, exigido pelo RF-148. Com
 * campo controlado isso viria de graça e custaria uma ilha client; aqui vem de
 * `searchParams`, que já está na mão.
 *
 * Cada campo tem `<label>` **visível** (RNF-022/RNF-024) e o botão é um
 * `<button type="submit">` de verdade — quem navega por teclado chega nele com
 * Tab e dispara com Enter, sem handler nenhum.
 */
function Filtros({ filtros }: { filtros: Filtros }) {
  const rotulo: CSSProperties = {
    font: "var(--type-kicker)",
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--text-secondary)",
    display: "block",
    marginBottom: "var(--space-1)",
  };

  const controle = {
    height: "var(--tap-min)",
    width: "100%",
    padding: "0 var(--space-3)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    font: "var(--type-body)",
  } as const;

  return (
    <form
      method="get"
      data-testid="candidatos-filtros"
      className="grid"
      style={{
        gap: "var(--space-3)",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        alignItems: "end",
      }}
    >
      <div>
        <label htmlFor="filtro-cargo" style={rotulo}>
          Cargo
        </label>
        <select
          id="filtro-cargo"
          name="cargo"
          data-testid="filtro-cargo"
          defaultValue={String(filtros.cargo)}
          style={controle}
        >
          {/*
            Rótulo e código saem de `lib/config/cargos.ts` — nunca literais, e a
            ORDEM é a da tabela canônica (a de exibição nas abas), não a
            numérica do TSE. Deputado Estadual não aparece porque não está na
            tabela: a rota não revela cargos que o produto não cobre (RF-147).
          */}
          {CARGOS.map((c) => (
            <option key={c.cd} value={String(c.cd)}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="filtro-uf" style={rotulo}>
          Unidade da federação
        </label>
        <select
          id="filtro-uf"
          name="uf"
          data-testid="filtro-uf"
          defaultValue={filtros.uf}
          style={controle}
        >
          {UFS.map((uf) => (
            <option key={uf} value={uf}>
              {uf === "BR" ? "BR — nacional (Presidente)" : uf}
            </option>
          ))}
        </select>
      </div>

      {/*
        `showLabel` — o rótulo fica VISÍVEL, não só no leitor de tela.
        `placeholder` não é nome acessível (WCAG 4.1.2) e some quando o leitor
        começa a digitar, que é justo quando ele mais precisa saber o que o
        campo é.

        O rótulo vai ACIMA (default de `<SearchField>`): inline, "BUSCAR POR
        NOME" quebra em duas linhas dentro da caixa de 44px em 375px e sobra
        menos de um terço da largura para o texto — medido no navegador em
        13/09. Acima, a busca também fica alinhada com os dois `<select>`.
        O componente já emite o próprio `<div>` nessa disposição.
      */}
      <SearchField
        id="filtro-busca"
        name="q"
        label="Buscar por nome"
        showLabel
        placeholder="Nome de urna ou nome completo"
        defaultValue={filtros.busca}
      />

      <button
        type="submit"
        data-testid="filtro-submit"
        style={{
          ...controle,
          background: "var(--surface-inverse)",
          color: "var(--text-inverse)",
          borderColor: "var(--surface-inverse)",
          font: "var(--type-label)",
          cursor: "pointer",
        }}
      >
        Filtrar
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Paginação sem JavaScript
// ---------------------------------------------------------------------------

/**
 * A query desta mesma corrida com outro `limite`.
 *
 * Montada a partir dos filtros **validados**, nunca dos `searchParams` crus:
 * refletir de volta o que o leitor mandou seria reintroduzir `?cargo=99` na
 * própria URL que a página emite. `q` só entra quando há busca, para a URL de
 * "carregar mais" não crescer um `&q=` vazio a cada clique.
 */
function urlComLimite(filtros: Filtros, limite: number, ancora: string): string {
  const qs = new URLSearchParams({
    cargo: String(filtros.cargo),
    uf: filtros.uf,
  });
  if (filtros.busca.trim()) qs.set("q", filtros.busca);
  qs.set("limite", String(limite));
  return `?${qs.toString()}#${ancora}`;
}

/**
 * "Mostrando 60 de 1.061" + os dois links. Só existe quando há mais.
 *
 * ## Por que `<a>` e não `<button>`
 *
 * Um botão exigiria handler, handler exige ilha client, e a rota inteira é zero
 * de aplicação (ver o cabeçalho). O link resolve com navegação do navegador — e
 * o que o torna **equivalente** ao botão é o fragmento: `#c-60` devolve o leitor
 * à primeira candidatura da fatia nova, exatamente onde ele parou. Sem ele o
 * navegador iria para o topo, e 60 cartões acima do ponto de leitura é pior que
 * o botão que o link substitui.
 *
 * ## Por que o total real aparece sempre
 *
 * "Mostrando 60" sozinho deixaria o leitor sem saber que a lista continua —
 * uma omissão que se lê como "esta corrida tem 60 candidatos". O número que
 * aparece ao lado é o da corrida inteira (constituição § 8).
 *
 * ## Por que "ver todas" existe
 *
 * SP tem 1.061 publicáveis: 18 cliques até o fim. Quem quer a lista completa
 * — para usar Ctrl+F, para conferir, para imprimir — pede uma vez só.
 */
function Paginacao({
  filtros,
  mostrando,
  total,
}: {
  filtros: Filtros;
  mostrando: number;
  total: number;
}) {
  if (mostrando >= total) return null;

  const ancora = ancoraCandidato(mostrando);
  // O teto de sanidade é o limite dos DOIS links. Sem esta linha, "ver todas"
  // numa corrida acima do teto emitiria `?limite=2500`, o `parseLimite`
  // devolveria 2.000 e o rótulo teria prometido 2.500 — o corte silencioso que
  // o teto existe para evitar viraria mentira na tela.
  const alcancavel = Math.min(total, CANDIDATOS_LIMITE_MAX);
  const proximo = Math.min(mostrando + CANDIDATOS_POR_PAGINA, alcancavel);
  const passo = proximo - mostrando;

  const link: CSSProperties = {
    color: "var(--accent-text)",
    // `--tap-min` de altura: o alvo de toque do RNF-024 vale para link, não só
    // para botão. `inline-flex` porque um `<a>` inline ignora `height`.
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--tap-min)",
    font: "var(--type-label)",
  };

  return (
    <div
      data-testid="candidatos-paginacao"
      style={{ marginTop: "var(--space-5)", display: "flex", flexDirection: "column" }}
    >
      <p
        data-testid="candidatos-paginacao-contagem"
        data-mostrando={mostrando}
        data-total={total}
        style={{ font: "var(--type-data)", color: "var(--text-secondary)", margin: 0 }}
      >
        {/* Os dois números saem do dado. Nenhum literal — design 018 § D8. */}
        Mostrando {formatarContagem(mostrando)} de {formatarContagem(total)} candidaturas.
      </p>

      {/*
        `passo === 0` só acontece quando o leitor já está no teto de sanidade
        numa corrida maior que ele. Aí não há mais o que oferecer, e a contagem
        acima continua dizendo a verdade sobre o tamanho real da corrida.
      */}
      {passo > 0 ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-5)" }}>
          <a
            data-testid="candidatos-carregar-mais"
            href={urlComLimite(filtros, proximo, ancora)}
            style={link}
          >
            Carregar mais {formatarContagem(passo)}
          </a>

          <a
            data-testid="candidatos-ver-todas"
            href={urlComLimite(filtros, alcancavel, ancora)}
            style={link}
          >
            {alcancavel === total
              ? `Ver todas as ${formatarContagem(total)}`
              : `Ver as ${formatarContagem(alcancavel)} primeiras`}
          </a>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidatosPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filtros = lerFiltros(params);
  const info = cargoInfo(filtros.cargo);

  // Spec 025 (RF-245) — cargos com etiqueta no catálogo. Presidente não tem.
  const cargoEtiquetado =
    filtros.cargo === 3 || filtros.cargo === 5 || filtros.cargo === 6 ? filtros.cargo : null;

  // As etiquetas começam a ser lidas JUNTO com as candidaturas, não depois
  // (auditoria de a11y/perf de 29/09, B2): até então a grade esperava as duas
  // leituras em série — inclusive com a chave `chips` desligada, quando o
  // resultado é descartado. A UF do Deputado é a pedida: `readCandidatosUf`
  // só aceita a fatia daquela UF (`isCandidatosUfSlice`). Nunca rejeita:
  // falha vira "sem etiqueta", nunca 500 (constituição § 7).
  const etiquetasPromessa =
    !filtros.invalido && cargoEtiquetado
      ? lerEtiquetas({ uf: cargoEtiquetado === 6 ? filtros.uf : null }).catch(() => null)
      : null;

  // Filtro inválido não vai ao Blob: pedir `candidatos/uf/ZZ/pres.json` seria
  // uma ida à origem para confirmar o que já se sabe. Degrada fechado.
  const resultado = filtros.invalido
    ? null
    : await readCandidatosUf(filtros.uf, cargoToken(filtros.cargo));

  const slice = resultado?.status === "ok" ? resultado.slice : null;
  const visiveis = slice ? filtrarPorNome(slice.candidatos, filtros.busca) : [];

  // ⚠️ ORDENA ANTES DE CORTAR. Invertido, "as 60 primeiras" seriam 60
  // candidaturas na ordem de leitura do Blob apresentadas como as 60 de menor
  // número — critério editorial acidental numa tela que não pode ter nenhum
  // (constituição § 2). A grade reordena depois; a operação é idempotente.
  const ordenados = ordenarCandidatosPorNumero(visiveis);
  const total = ordenados.length;
  // O único corte do arquivo, e ele é de EXIBIÇÃO. Nada aqui alimenta conta de
  // cadeira, percentual ou projeção — esta tela não faz conta nenhuma, e a
  // contagem que ela mostra vem de `total`, não de `exibidos.length`.
  const exibidos = ordenados.slice(0, filtros.limite);

  // Spec 025 (RF-245) — etiquetas editoriais das candidaturas EXIBIDAS, por
  // `sqcand`. Governador e Senador vêm do arquivo nacional; Deputado Federal,
  // do arquivo da UF. Vazio com a chave `chips` desligada. Não mexe na ordem
  // (número na urna) nem no corte.
  const etiquetas = slice && etiquetasPromessa ? await etiquetasPromessa : null;
  const etiquetasDaGrade =
    etiquetas && cargoEtiquetado
      ? etiquetasDaLista(
          etiquetas,
          exibidos,
          cargoEtiquetado,
          1,
          cargoEtiquetado === 5 ? [...CATEGORIAS_CHIP, "impeachment_stf"] : CATEGORIAS_CHIP,
        )
      : undefined;

  // O rótulo da seção sai do cargo e da UF **lidos**, não dos pedidos: se a
  // fatia veio, ela é autodescritiva e é ela que manda.
  const ufExibida = slice?.uf ?? filtros.uf;
  const tituloCorrida = `${info.label} · ${ufExibida}`;

  return (
    <main
      className="mx-auto flex flex-col"
      style={{
        maxWidth: 960,
        gap: "var(--space-8)",
        padding: "var(--space-10) var(--space-5) 0",
        // A barra de cargos é fixa no rodapé abaixo de 960px e flutua sobre o
        // conteúdo. Esta rota não é `main[data-trilha]`, então não recebe a
        // folga que `globals.css` dá às quatro rotas de corrida — reserva aqui,
        // como `/sobre-o-modelo` faz.
        paddingBottom: "calc(var(--space-16) + env(safe-area-inset-bottom))",
      }}
    >
      <header>
        <p
          style={{
            font: "var(--type-kicker)",
            letterSpacing: "var(--tracking-caps)",
            textTransform: "uppercase",
            color: "var(--accent-text)",
            margin: "0 0 var(--space-2)",
          }}
        >
          Eleições 2026
        </p>
        <h1 style={{ font: "var(--type-headline)", margin: "0 0 var(--space-3)" }}>
          Quem está concorrendo
        </h1>
        <p
          style={{
            font: "var(--type-deck)",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: "62ch",
          }}
        >
          As candidaturas que o TSE registrou e colocou na urna, por cargo e por unidade da
          federação. Aparecem também as que estão na urna com o registro sob recurso — elas recebem
          voto, e a situação fica escrita ao lado.
        </p>
      </header>

      <Panel rule="single" title="Filtrar" titleId="candidatos-filtros-heading" headingLevel={2}>
        <Filtros filtros={filtros} />
      </Panel>

      <Panel
        rule="double"
        kicker="Candidaturas"
        title={tituloCorrida}
        titleId="candidatos-corrida-heading"
        headingLevel={2}
      >
        <CandidaturasFonte fonteTs={slice?.fonte_ts ?? null} />

        {filtros.invalido ? (
          <p
            data-testid="candidatos-filtro-invalido"
            style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0 }}
          >
            Nenhuma candidatura para este filtro. O AtlasMenna cobre quatro cargos — Presidente,
            Governador, Senador e Deputado Federal — nas 27 unidades da federação.
          </p>
        ) : resultado && resultado.status === "unavailable" ? (
          <p
            data-testid="candidatos-indisponivel"
            data-reason={resultado.reason}
            style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0 }}
          >
            {TEXTO_INDISPONIVEL[resultado.reason]}
          </p>
        ) : (
          <>
            <CandidatosGrid
              candidatos={exibidos}
              etiquetas={etiquetasDaGrade}
              total={total}
              uf={ufExibida}
              rotulo={`Candidaturas a ${info.label} em ${ufExibida}`}
              textoVazio={
                filtros.busca.trim()
                  ? "Nenhuma candidatura desta corrida casa com a busca."
                  : "Nenhuma candidatura publicada para este filtro."
              }
            />
            <Paginacao filtros={filtros} mostrando={exibidos.length} total={total} />
          </>
        )}
      </Panel>

      <Footer />
    </main>
  );
}
