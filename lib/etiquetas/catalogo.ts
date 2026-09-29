/**
 * lib/etiquetas/catalogo.ts
 *
 * **Fonte única** das etiquetas editoriais (spec 024, RF-220): categorias,
 * valores, rótulos, ordem de exibição, matriz alvo × categoria, herança por
 * partido, limiares do alinhamento e colchão do portão.
 *
 * Quem precisar de qualquer um destes números ou nomes importa daqui — o
 * validador (`data-pipeline/etiquetas-compilar.ts`), o resolvedor, o portão, o
 * vigia, os componentes e, na spec 025, a página de metodologia e o filtro.
 * Uma segunda cópia "equivalente" em outro arquivo é como dois lugares passam
 * a discordar em silêncio.
 *
 * ## Acrescentar um valor não exige migração
 *
 * Os arquivos gerados e publicados guardam **ids** (`"base_governo"`), nunca
 * rótulos nem posições. Um valor novo entra aqui, no fim da lista da
 * categoria (ou na posição de exibição desejada — a ordem é só de exibição),
 * e nada mais muda. O leitor trata id que não conhece como `a_classificar`
 * (`valorDoCatalogo` devolve `null`), então um arquivo publicado com um
 * catálogo mais novo que o do deploy nunca mostra texto cru na tela.
 *
 * ## `a_classificar` é sentinela, não valor
 *
 * Existe em toda categoria e **nunca** aparece como etiqueta (decisão do dono,
 * 29/09). Não está na lista `valores` de propósito: um laço que renderize
 * "todos os valores" não tem como esbarrar nela.
 */

/** Sentinela de "ainda não classificado". Nunca exibida. */
export const A_CLASSIFICAR = "a_classificar" as const;
export type AClassificar = typeof A_CLASSIFICAR;

// ---------------------------------------------------------------------------
// Alvos: a quem uma etiqueta pode se aplicar
// ---------------------------------------------------------------------------

/**
 * Cargo do TSE (3 Governador · 5 Senador · 6 Deputado Federal) ou os 27
 * senadores cujo mandato vai até 2031 e **não** estão em disputa em 2026
 * (`senado2031`, foto de `editorial/senado/mandato-2031.json`).
 */
export type AlvoEtiqueta = 3 | 5 | 6 | "senado2031";

export const ALVOS: readonly AlvoEtiqueta[] = [3, 5, 6, "senado2031"];

// ---------------------------------------------------------------------------
// Categorias e valores
// ---------------------------------------------------------------------------

export interface ValorDef {
  /** Id estável, snake_case. É o que vai para os arquivos. */
  readonly id: string;
  /**
   * Texto exibido. `null` = o valor existe para o dado mas **não vira
   * etiqueta** (hoje só `centrao: nao` — a marcação aparece só quando `sim`).
   */
  readonly rotulo: string | null;
}

export interface CategoriaDef {
  readonly id: string;
  /** Nome da categoria como título (metodologia, filtro). */
  readonly rotulo: string;
  /**
   * Nome da categoria para leitor de tela, em minúscula, lido antes do valor
   * ("campo ideológico: Esquerda"). `null` quando o rótulo do valor já diz
   * tudo ("Centrão").
   */
  readonly rotuloAcessivel: string | null;
  /** `true` ⇒ toda linha exige `turno` 1 ou 2 e cada turno resolve sozinho (RF-225). */
  readonly porTurno: boolean;
  /** `true` ⇒ aceita padrão por `partido:`/`federacao:` (RF-224). */
  readonly herdaDoPartido: boolean;
  readonly aplicaA: readonly AlvoEtiqueta[];
  /** Ordem de exibição fixa. Nunca contém `a_classificar`. */
  readonly valores: readonly ValorDef[];
}

export const CATEGORIAS = [
  {
    id: "campo_ideologico",
    rotulo: "Campo ideológico",
    rotuloAcessivel: "campo ideológico",
    porTurno: false,
    herdaDoPartido: true,
    aplicaA: [3, 5, 6, "senado2031"],
    valores: [
      { id: "esquerda", rotulo: "Esquerda" },
      { id: "centro_esquerda", rotulo: "Centro-esquerda" },
      { id: "centro", rotulo: "Centro" },
      { id: "centro_direita", rotulo: "Centro-direita" },
      { id: "direita", rotulo: "Direita" },
      { id: "sem_posicao_clara", rotulo: "Sem posição clara" },
    ],
  },
  {
    id: "palanque_presidencial",
    rotulo: "Palanque presidencial",
    rotuloAcessivel: "palanque presidencial",
    porTurno: true,
    herdaDoPartido: true,
    aplicaA: [3, 5, 6, "senado2031"],
    valores: [
      { id: "palanque_lula", rotulo: "Palanque de Lula" },
      { id: "palanque_flavio_bolsonaro", rotulo: "Palanque de Flávio Bolsonaro" },
      { id: "palanque_duplo", rotulo: "Palanque duplo" },
      { id: "sem_palanque_declarado", rotulo: "Sem palanque declarado" },
    ],
  },
  {
    id: "relacao_governo",
    rotulo: "Relação com o governo Lula",
    rotuloAcessivel: "relação com o governo Lula",
    porTurno: false,
    herdaDoPartido: true,
    aplicaA: [3, 5, 6, "senado2031"],
    valores: [
      { id: "base_governo", rotulo: "Base do governo" },
      { id: "oposicao", rotulo: "Oposição" },
      { id: "independente", rotulo: "Independente" },
    ],
  },
  {
    id: "centrao",
    rotulo: "Centrão",
    rotuloAcessivel: null,
    porTurno: false,
    herdaDoPartido: true,
    aplicaA: [3, 5, 6, "senado2031"],
    valores: [
      { id: "sim", rotulo: "Centrão" },
      { id: "nao", rotulo: null },
    ],
  },
  {
    id: "trajetoria_cargo",
    rotulo: "Trajetória no cargo",
    rotuloAcessivel: "trajetória no cargo",
    porTurno: false,
    // Decisão do dono (29/09): trajetória é fato individual, nunca do partido.
    herdaDoPartido: false,
    // `senado2031` fica de fora: quem segue até 2031 não é candidato em 2026,
    // e "tenta a reeleição" não tem referente para ele.
    aplicaA: [3, 5, 6],
    valores: [
      { id: "tenta_reeleicao", rotulo: "Tenta a reeleição" },
      { id: "volta_ao_cargo", rotulo: "Volta ao cargo" },
      { id: "estreante", rotulo: "Estreante no cargo" },
    ],
  },
  {
    id: "impeachment_stf",
    rotulo: "Impeachment de ministros do STF",
    rotuloAcessivel: "impeachment de ministros do STF",
    porTurno: false,
    herdaDoPartido: false,
    // Só Senado — inclusive os 27 que continuam (decisão do dono, 28/09).
    aplicaA: [5, "senado2031"],
    valores: [
      { id: "a_favor", rotulo: "A favor" },
      { id: "contra", rotulo: "Contra" },
      { id: "sem_posicao_publica", rotulo: "Sem posição pública" },
    ],
  },
] as const satisfies readonly CategoriaDef[];

export type CategoriaId = (typeof CATEGORIAS)[number]["id"];

type CategoriaPorId<C extends CategoriaId> = Extract<(typeof CATEGORIAS)[number], { id: C }>;
/** Os ids de valor válidos de UMA categoria (sem a sentinela). */
export type ValorId<C extends CategoriaId = CategoriaId> =
  CategoriaPorId<C>["valores"][number]["id"];

/** Ordem de exibição das categorias — a do array acima. */
export const ORDEM_CATEGORIAS: readonly CategoriaId[] = CATEGORIAS.map((c) => c.id);

const POR_ID: ReadonlyMap<string, CategoriaDef> = new Map(CATEGORIAS.map((c) => [c.id, c]));

export function isCategoriaId(v: string): v is CategoriaId {
  return POR_ID.has(v);
}

export function categoria(id: CategoriaId): CategoriaDef {
  const c = POR_ID.get(id);
  // Inalcançável pelo tipo; a guarda existe para JSON vindo de fora.
  if (!c) throw new Error(`categoria desconhecida: ${id}`);
  return c;
}

/**
 * O valor do catálogo, ou `null` quando o id não existe na categoria — o que
 * inclui `a_classificar` e ids de um catálogo mais novo que este deploy.
 */
export function valorDoCatalogo(cat: string, valor: string): ValorDef | null {
  const c = POR_ID.get(cat);
  if (!c) return null;
  return c.valores.find((v) => v.id === valor) ?? null;
}

/**
 * Rótulo exibível, ou `null` quando não há o que exibir: sentinela, id
 * desconhecido, categoria desconhecida ou valor sem rótulo (`centrao: nao`).
 * **Único** caminho de id → texto para a tela.
 */
export function rotuloDoValor(cat: string, valor: string | null | undefined): string | null {
  if (!valor || valor === A_CLASSIFICAR) return null;
  return valorDoCatalogo(cat, valor)?.rotulo ?? null;
}

export function aplicaA(cat: CategoriaId, alvo: AlvoEtiqueta): boolean {
  return categoria(cat).aplicaA.includes(alvo);
}

export function categoriasDoAlvo(alvo: AlvoEtiqueta): CategoriaId[] {
  return ORDEM_CATEGORIAS.filter((c) => aplicaA(c, alvo));
}

// ---------------------------------------------------------------------------
// Limiares — decididos pelo dono / fixados no plano de 29/09
// ---------------------------------------------------------------------------

/** Taxa nas votações disputadas **≥** este valor (0–100) ⇒ Base do governo. */
export const ALINHAMENTO_BASE_MIN = 65;
/** Taxa nas votações disputadas **≤** este valor (0–100) ⇒ Oposição. */
export const ALINHAMENTO_OPOSICAO_MAX = 35;
/** Menos votos disputados que isto ⇒ amostra pequena ⇒ vale o padrão do partido. */
export const ALINHAMENTO_MIN_VOTOS_DISPUTADAS = 30;
/** Data de corte dos dados de alinhamento, exibida na metodologia. */
export const ALINHAMENTO_CORTE = "2026-09-03";

/**
 * Colchão do portão de cobertura, em pontos percentuais: quem está a até isto
 * da última posição que elege conta como "com chance" (RF-233).
 */
export const PORTAO_MARGEM_PP = 5;

/**
 * Mapeamento da trajetória derivada (decisão do dono, 29/09) — cargo 6 pela
 * Câmara (`trajetoria-camara.json`), cargo 5 pelo Senado
 * (`trajetoria-senado.json`, que não emite `legislatura_atual`). Ausência do
 * `sqcand` no insumo **não** está aqui: ausência é `a_classificar`, nunca
 * estreante (RF-226).
 */
export const TRAJETORIA_PARA_VALOR = {
  em_exercicio: "tenta_reeleicao",
  legislatura_atual: "tenta_reeleicao",
  mandato_anterior: "volta_ao_cargo",
  estreante: "estreante",
} as const satisfies Record<string, ValorId<"trajetoria_cargo">>;

export type TrajetoriaDerivada = keyof typeof TRAJETORIA_PARA_VALOR;

/**
 * "Sem partido" como o Senado escreve (ex.: um dos 27 que seguem até 2031
 * está sem legenda). Vira `partido: null` — e o padrão por partido resolve
 * `a_classificar` para ele, nunca a etiqueta de um partido com esse nome.
 */
export const SEM_PARTIDO = /^(S\s*\/\s*PARTIDO|SEM\s+PARTIDO|S\/P|-|—)$/i;

// ---------------------------------------------------------------------------
// Hemiciclo por bloco (spec 025) — ordem fixa, esquerda → direita
// ---------------------------------------------------------------------------

/**
 * Ordem dos blocos de `relacao_governo` no hemiciclo por bloco (decisão do
 * dono, 29/09): Base do governo à esquerda, Independente e aguardando no
 * meio, Oposição à direita. "aguardando" agrupa a cadeira ainda não decidida
 * e — se algum dia chegar ali — a `a_classificar`, que nunca ganha rótulo
 * próprio. A posição reflete a relação com o governo, **não** posição
 * ideológica.
 */
export const ORDEM_BLOCOS_HEMICICLO = [
  "base_governo",
  "independente",
  "aguardando",
  "oposicao",
] as const;
export type BlocoHemiciclo = (typeof ORDEM_BLOCOS_HEMICICLO)[number];

export function blocoDoHemiciclo(valor: string | null | undefined): BlocoHemiciclo {
  if (valor === "base_governo" || valor === "independente" || valor === "oposicao") return valor;
  return "aguardando";
}

/**
 * Rótulo de cada bloco NAS VISÕES POR BLOCO (spec 025, RF-241). Diferente do
 * rótulo do valor ("Base do governo"): no Senado e na Câmara de 2027 o governo
 * pode ser outro (posse em 01/01/2027), e a classificação é a relação com o
 * governo **Lula** — o nome tem de dizer isso (ADR-0061, Consequências).
 * `aguardando` é genérico; cada visão diz o que falta ("aguardando apuração",
 * "sem dono ainda").
 */
export const ROTULO_BLOCO_HEMICICLO: Readonly<Record<BlocoHemiciclo, string>> = {
  base_governo: "Base do governo Lula",
  independente: "Independentes",
  aguardando: "Aguardando",
  oposicao: "Oposição ao governo Lula",
};

// ---------------------------------------------------------------------------
// Critérios publicados (constituição 1.6, § 2 (a); spec 025, RF-250)
// ---------------------------------------------------------------------------

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * O critério ESCRITO de cada categoria, como a página `/sobre-as-etiquetas`
 * o publica. `null` = o dono ainda não mandou o critério.
 *
 * 🔴 **Sem critério publicado, nenhuma etiqueta da categoria vai à tela** —
 * constituição § 2 (a): "o critério escrito de cada valor está publicado
 * ANTES de o valor ser usado". Não é convenção: `<EtiquetaEditorial>` devolve
 * nada para categoria sem critério ({@link categoriaExibivel}), o filtro não
 * oferece a categoria e nenhuma visão agregada que dependa dela é liberada. A
 * metodologia diz, para cada `null`, "critério em definição — nenhuma
 * etiqueta desta categoria é exibida", e essa frase é verdadeira por
 * construção, não por coincidência de nenhuma linha estar revisada.
 *
 * Os números saem das constantes deste arquivo — nunca repetidos no texto.
 */
export const CRITERIOS: Readonly<Record<CategoriaId, string | null>> = {
  campo_ideologico: null,
  palanque_presidencial: null,
  relacao_governo:
    "Relação com o governo Lula — não é posição ideológica. Deputado federal com mandato: a " +
    "taxa de votos iguais à orientação do governo nas votações nominais disputadas do plenário " +
    "da Câmara (aquelas em que a bancada da Oposição orientou o contrário do governo ou " +
    `orientou obstrução), com dados até ${dataBr(ALINHAMENTO_CORTE)}. Com ao menos ` +
    `${ALINHAMENTO_MIN_VOTOS_DISPUTADAS} votos nessas votações: ${ALINHAMENTO_BASE_MIN}% ou ` +
    `mais é Base do governo; ${ALINHAMENTO_OPOSICAO_MAX}% ou menos é Oposição; entre os dois é ` +
    `Independente. Com menos de ${ALINHAMENTO_MIN_VOTOS_DISPUTADAS} votos disputados, sem ` +
    "mandato na Câmara, e nas candidaturas a Governador e a Senador e nos senadores que seguem " +
    "até 2031: vale o padrão do partido (ou da federação), com a fonte indicada em cada padrão, " +
    "salvo classificação individual com fonte própria. Senador com mandato: a mesma regra, sobre " +
    "as votações do Senado, quando esse dado estiver publicado.",
  centrao: null,
  trajetoria_cargo:
    "Deputado federal: pelos registros da Câmara dos Deputados — em exercício hoje, ou com " +
    "exercício na legislatura atual (2023–2027), é Tenta a reeleição; com exercício só em " +
    "legislatura anterior, Volta ao cargo; sem exercício como deputado federal, Estreante no " +
    "cargo. Candidatura que o cruzamento com a Câmara não encontra fica sem etiqueta — ausência " +
    "nunca vira estreante. Senador: a mesma regra sobre os registros do Senado, quando esse dado " +
    "estiver publicado. Governador: só por classificação individual, com fonte.",
  impeachment_stf: null,
};

/** A categoria tem critério escrito e publicado? */
export function criterioPublicado(cat: string): boolean {
  return isCategoriaId(cat) && typeof CRITERIOS[cat] === "string";
}

/**
 * Uma etiqueta desta categoria PODE ir à tela? Hoje: sse o critério está
 * publicado (constituição § 2 (a)). Único ponto de decisão — o átomo, o filtro
 * e as visões perguntam aqui.
 */
export function categoriaExibivel(cat: string): boolean {
  return criterioPublicado(cat);
}

/**
 * Categorias que viram "chip" ao lado do nome do candidato (spec 025,
 * RF-245), na ordem do catálogo. O impeachment NÃO está aqui: fora do Senado
 * não se aplica, e no Senado ele aparece qualificado (ver
 * {@link QUALIFICADOR_VISIVEL}) só onde há espaço para a frase inteira.
 */
export const CATEGORIAS_CHIP: readonly CategoriaId[] = ORDEM_CATEGORIAS.filter(
  (c) => c !== "impeachment_stf",
);

/**
 * Categorias cujo valor sozinho não diz nada — "A favor" num cartão não diz a
 * favor de quê (open question 2 da spec 024). A etiqueta delas mostra, VISÍVEL,
 * o qualificador antes do valor: "Posição pública sobre impeachment de
 * ministros do STF: a favor". Nunca um "A favor" solto (spec 025, RF-246).
 */
export const QUALIFICADOR_VISIVEL: Readonly<Partial<Record<CategoriaId, string>>> = {
  impeachment_stf: "Posição pública sobre impeachment de ministros do STF",
};

// ---------------------------------------------------------------------------
// Visões com chave de publicação
// ---------------------------------------------------------------------------

/**
 * As superfícies que o dono liga e desliga sem deploy (RF-230/231). Na cópia
 * do build, as de `editorial/etiquetas/publicar.json` versionado (spec 025,
 * RF-253 — até 29/09 eram sempre desligadas, e um deploy apagava as visões).
 */
export const VISOES = ["chips", "filtro", "v1", "v2", "v3", "v4", "camara2027"] as const;
export type Visao = (typeof VISOES)[number];
export type ChavesPublicacao = Record<Visao, boolean>;

export function todasDesligadas(): ChavesPublicacao {
  return Object.fromEntries(VISOES.map((v) => [v, false])) as ChavesPublicacao;
}

/**
 * Alguma superfície com etiqueta está ligada? É o que decide se as páginas de
 * metodologia podem dizer "algumas telas mostram etiquetas" (constituição
 * § 8) — com tudo desligado, a frase seria falsa. Só `true` literal liga.
 */
export function algumaVisaoLigada(publicar: Readonly<Partial<ChavesPublicacao>>): boolean {
  return VISOES.some((v) => publicar[v] === true);
}

/**
 * Qual categoria cada visão agregada exige classificada nos candidatos com
 * chance (portão, RF-233). `chips` não é agregado: cada chip só aparece se
 * classificado, e o candidato não classificado simplesmente não ganha chip.
 * `filtro` É agregado (constituição § 2 (f)), mas tem UM portão POR
 * CATEGORIA — cada opção só existe com o portão dela aberto
 * (`categoriasDoFiltroLiberadas`, `lib/etiquetas/telas.ts`) —, por isso não
 * tem uma categoria única aqui. `v4` (renovação) lê trajetória.
 */
export const CATEGORIA_DA_VISAO: Readonly<Record<Visao, CategoriaId | null>> = {
  chips: null,
  filtro: null,
  v1: "relacao_governo",
  v2: "impeachment_stf",
  v3: "palanque_presidencial",
  v4: "trajetoria_cargo",
  camara2027: "relacao_governo",
};

// ---------------------------------------------------------------------------
// Chaves das linhas-fonte
// ---------------------------------------------------------------------------

/** Os cinco arquivos de `editorial/etiquetas/` e o tipo de chave de cada um. */
export const ARQUIVOS_FONTE = {
  "governador.csv": { tipo: "sqcand", cargo: 3 },
  "senador.csv": { tipo: "sqcand", cargo: 5 },
  "deputados-excecoes.csv": { tipo: "sqcand", cargo: 6 },
  "senado-2031.csv": { tipo: "senado", cargo: null },
  "partidos.csv": { tipo: "agremiacao", cargo: null },
} as const;
export type ArquivoFonte = keyof typeof ARQUIVOS_FONTE;

export const COLUNAS_FONTE = [
  "chave",
  "categoria",
  "valor",
  "turno",
  "fonte_url",
  "fonte_descricao",
  "data",
  "revisado",
  "revisado_em",
  "nota",
] as const;
