// data-pipeline/trajetoria-camara.ts
//
// **Trajetória na Câmara** de cada candidatura a Deputado Federal (cargo 6):
// quem concorre a um novo mandato e quem é estreante (spec 018, RF-214,
// ADR-0058).
//
// Tudo aqui é **puro** — nem rede, nem banco, nem disco. O I/O (baixar e
// guardar em cache o histórico da Câmara) vive em `trajetoria-camara-fonte.ts`;
// a leitura das colunas do TSE, em `trajetoria-camara-calculo.ts`
// (`trajetoriaDaLinha`) — caminho de cálculo/exportação, **não** o import.
//
// ─── Entrega dividida (ADR-0058 item 5) ─────────────────────────────────────
//
// Na `main` este módulo alimenta só a exportação offline
// (`trajetoria-exportar.ts` → `editorial/derivados/trajetoria-camara.json`) e a
// paridade. A persistência em `candidatos` (migration 0011, colunas em
// `schema.ts`, integração no import e backfill) está ESTACIONADA até depois de
// 25/10, e só com autorização do dono: o import de 03/10 roda contra produção,
// onde essas colunas não existem.
//
// ─── Por que casar por nome + data de nascimento ────────────────────────────
//
// `ST_REELEICAO` do arquivo complementar do TSE vale `#NE` em **100%** das
// 7.791 candidaturas de cargo 6 (medido em 26/09 no arquivo gerado em 12/09) —
// não serve de sinal. O histórico da Câmara (`deputados.csv`, 7.889 pessoas
// desde 1826) traz o CPF **vazio**. O que sobra em comum entre as duas fontes é
// o nome civil e a data de nascimento.
//
// ─── A data de nascimento é PII e não sai desta passagem ────────────────────
//
// A data de nascimento (dos dois lados) e o nome social do TSE existem aqui só
// como argumento de função, dentro do casamento. Não entram em `CandidatoRow`,
// não vão a Postgres, não são logados, não aparecem no arquivo exportado
// (constituição § 5, RNF-019, ADR-0039 com a exceção estrita do ADR-0058). O
// que sai daqui é só a CATEGORIA e o(s) id(s) públicos do deputado na API da
// Câmara, para auditoria.
//
// ─── Porte fiel ─────────────────────────────────────────────────────────────
//
// O algoritmo é o de `alinhamento-governo-camara/cruzar.py`, validado em 26/09
// contra as 7.791 candidaturas (estreante 7.085 · em exercício 439 ·
// legislatura atual 70 · mandato anterior 197; 0 candidaturas casando com mais
// de um deputado). A paridade linha a linha é conferida por
// `data-pipeline/trajetoria-camara-paridade.ts`. Qualquer "melhoria" na regra
// de casamento precisa passar por lá antes — e muda o número acima.

/** Único cargo para o qual a trajetória é calculada (Deputado Federal). */
export const CARGO_TRAJETORIA = 6;

/**
 * A legislatura em curso: a 57ª, de 01/02/2023 a 31/01/2027. Quem exerceu
 * mandato nela mas não está em exercício hoje é `legislatura_atual`.
 *
 * ⚠️ Vira 58 em 01/02/2027. Para a eleição de 2026 é constante.
 */
export const LEGISLATURA_ATUAL = 57;

/**
 * As quatro categorias internas (ADR-0058 item 3), na ordem em que o arquivo
 * exportado e a paridade as contam. São também os valores do CHECK da coluna
 * `candidatos.trajetoria_camara` da migration 0011 — estacionada até depois de
 * 25/10, fora da `main`.
 */
export const TRAJETORIAS = [
  "em_exercicio",
  "legislatura_atual",
  "mandato_anterior",
  "estreante",
] as const;

export type TrajetoriaCamara = (typeof TRAJETORIAS)[number];

export type ModoCasamento = "exato" | "aproximado" | "nenhum";

/** Um deputado do histórico da Câmara (`deputados.csv`). */
export interface DeputadoCamara {
  /** Último segmento de `uri` — o id público da API da Câmara. */
  id: number;
  /** `nome` — o **nome parlamentar**, não o civil. */
  nomeParlamentar: string;
  nomeCivil: string;
  /** `dataNascimento`, AAAA-MM-DD; `""` quando a Câmara não tem o dado. */
  nascimento: string;
  legislaturaInicial: number;
  legislaturaFinal: number;
}

/**
 * O que o casamento precisa saber de uma candidatura. **Transitório**: vive só
 * durante a chamada de `casarComCamara` — ver o cabeçalho deste arquivo.
 */
export interface IdentificacaoCandidato {
  /** `NM_CANDIDATO` — nome civil. */
  nomeCivil: string;
  /** `NM_URNA_CANDIDATO`. */
  nomeUrna: string;
  /** `NM_SOCIAL_CANDIDATO`, já sem sentinela (`#NULO` → `null`). */
  nomeSocial: string | null;
  /** `DT_NASCIMENTO` convertido para AAAA-MM-DD; `""` quando ilegível. */
  nascimento: string;
}

export interface IndiceCamara {
  /** `"<nome civil normalizado>|<AAAA-MM-DD>"` → deputados. */
  porNomeENascimento: ReadonlyMap<string, readonly DeputadoCamara[]>;
  /** `AAAA-MM-DD` → deputados nascidos nesse dia. */
  porNascimento: ReadonlyMap<string, readonly DeputadoCamara[]>;
  /** Ids em exercício hoje (API `/deputados`). */
  emExercicio: ReadonlySet<number>;
  /** Contagens para o log — nunca nomes nem datas. */
  totalDeputados: number;
  semNascimento: number;
}

export interface ResultadoCasamento {
  /** Ids casados, ordem crescente, sem repetição. Vazio = sem casamento. */
  ids: number[];
  /** Maior legislatura entre `inicial` e `final` de todos os casados. */
  maiorLegislatura: number | null;
  modo: ModoCasamento;
}

export interface Trajetoria {
  trajetoria: TrajetoriaCamara;
  /** `null` quando estreante — não há id a auditar. */
  camaraIds: number[] | null;
  modo: ModoCasamento;
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/**
 * Tokens de um nome: NFD, descarta o que não é ASCII (os acentos combinantes
 * e qualquer letra fora do ASCII), maiúsculas, tudo que não é A–Z vira espaço.
 *
 * A ordem importa e é a do `cruzar.py`: o não-ASCII é **descartado** (não vira
 * espaço) antes do `upper`. `"D'ÁVILA"` → `["D", "AVILA"]`.
 */
export function tokensDoNome(nome: string | null | undefined): string[] {
  const ascii = (nome ?? "").normalize("NFD").replace(/[\u0080-\uFFFF]/g, "");
  return ascii
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Tokens reunidos por um espaço — a chave de comparação de nome inteiro. */
export function chaveDoNome(nome: string | null | undefined): string {
  return tokensDoNome(nome).join(" ");
}

/** `DD/MM/AAAA` (TSE) → `AAAA-MM-DD` (Câmara). Qualquer outra forma → `""`. */
export function isoDeDataTse(data: string): string {
  const p = data.trim().split("/");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : "";
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

/**
 * Indexa o histórico. Deputado **sem** data de nascimento fica fora dos dois
 * índices — sem data não há como casar, e casar só por nome juntaria homônimos
 * de séculos diferentes.
 */
export function construirIndiceCamara(
  deputados: readonly DeputadoCamara[],
  emExercicio: Iterable<number>,
): IndiceCamara {
  const porNomeENascimento = new Map<string, DeputadoCamara[]>();
  const porNascimento = new Map<string, DeputadoCamara[]>();
  let semNascimento = 0;
  for (const d of deputados) {
    if (!d.nascimento) {
      semNascimento++;
      continue;
    }
    const k = `${chaveDoNome(d.nomeCivil)}|${d.nascimento}`;
    porNomeENascimento.set(k, [...(porNomeENascimento.get(k) ?? []), d]);
    porNascimento.set(d.nascimento, [...(porNascimento.get(d.nascimento) ?? []), d]);
  }
  return {
    porNomeENascimento,
    porNascimento,
    emExercicio: new Set(emExercicio),
    totalDeputados: deputados.length,
    semNascimento,
  };
}

// ---------------------------------------------------------------------------
// Casamento
// ---------------------------------------------------------------------------

/**
 * Regra aproximada, aplicada só entre pessoas **nascidas no mesmo dia**. Casa
 * se QUALQUER uma das três vale:
 *
 *  (a) tokens em comum ≥ max(2, min(|A|, |B|) − 1), sobre os CONJUNTOS de
 *      tokens — cobre sobrenome de casada acrescentado ou removido;
 *  (b) primeiro e último token iguais — cobre nome do meio abreviado na Câmara
 *      (`"JOÃO CARLOS DE M. R. B. FARIAS"`);
 *  (c) nome parlamentar da Câmara == nome de urna ou nome social do TSE —
 *      cobre quem usa nome social diferente do civil registrado na Câmara.
 */
export function casaAproximado(cand: IdentificacaoCandidato, dep: DeputadoCamara): boolean {
  const ta = tokensDoNome(cand.nomeCivil);
  const tb = tokensDoNome(dep.nomeCivil);
  const a = new Set(ta);
  const b = new Set(tb);
  let comuns = 0;
  for (const t of a) if (b.has(t)) comuns++;
  const regraA = comuns >= Math.max(2, Math.min(a.size, b.size) - 1);

  const regraB = ta.length > 0 && tb.length > 0 && ta[0] === tb[0] && ta.at(-1) === tb.at(-1);

  const parlamentar = chaveDoNome(dep.nomeParlamentar);
  const outros = [chaveDoNome(cand.nomeUrna), chaveDoNome(cand.nomeSocial)].filter(
    (k) => k.length > 0,
  );
  const regraC = parlamentar.length > 0 && outros.includes(parlamentar);

  return regraA || regraB || regraC;
}

/**
 * Casa uma candidatura com o histórico: primeiro **exato** (nome civil
 * normalizado + data de nascimento); se não houver, **aproximado** entre os
 * nascidos no mesmo dia. Sem data de nascimento legível, não casa.
 */
export function casarComCamara(
  cand: IdentificacaoCandidato,
  indice: IndiceCamara,
): ResultadoCasamento {
  let casados: readonly DeputadoCamara[] = [];
  let modo: ModoCasamento = "nenhum";
  if (cand.nascimento) {
    casados =
      indice.porNomeENascimento.get(`${chaveDoNome(cand.nomeCivil)}|${cand.nascimento}`) ?? [];
    if (casados.length > 0) {
      modo = "exato";
    } else {
      casados = (indice.porNascimento.get(cand.nascimento) ?? []).filter((d) =>
        casaAproximado(cand, d),
      );
      if (casados.length > 0) modo = "aproximado";
    }
  }
  const ids = [...new Set(casados.map((d) => d.id))].sort((x, y) => x - y);
  const legs = casados.flatMap((d) => [d.legislaturaInicial, d.legislaturaFinal]);
  return {
    ids,
    maiorLegislatura: legs.length > 0 ? Math.max(...legs) : null,
    modo,
  };
}

/**
 * Categoria, nesta precedência:
 *   sem casamento                          → `estreante`
 *   algum id casado em exercício hoje      → `em_exercicio`
 *   maior legislatura == 57 (a atual)      → `legislatura_atual`
 *   caso contrário                         → `mandato_anterior`
 */
export function categorizarTrajetoria(
  casamento: ResultadoCasamento,
  emExercicio: ReadonlySet<number>,
): TrajetoriaCamara {
  if (casamento.ids.length === 0) return "estreante";
  if (casamento.ids.some((id) => emExercicio.has(id))) return "em_exercicio";
  if (casamento.maiorLegislatura === LEGISLATURA_ATUAL) return "legislatura_atual";
  return "mandato_anterior";
}

/** Casamento + categoria, na forma que a exportação consome. */
export function calcularTrajetoria(cand: IdentificacaoCandidato, indice: IndiceCamara): Trajetoria {
  const casamento = casarComCamara(cand, indice);
  return {
    trajetoria: categorizarTrajetoria(casamento, indice.emExercicio),
    camaraIds: casamento.ids.length > 0 ? casamento.ids : null,
    modo: casamento.modo,
  };
}

// (`literalArrayInt`, o serializador de `camara_ids` para o `UNNEST` do import,
// fica com a perna estacionada do ADR-0058 — nada na `main` grava no banco.)

// ---------------------------------------------------------------------------
// Parsing das fontes da Câmara (texto já lido — o I/O fica na `-fonte`)
// ---------------------------------------------------------------------------

/**
 * Registros de um CSV `;` com aspas duplas (RFC 4180: `""` é aspa literal,
 * newline dentro de aspas é parte do campo). Remove o BOM do começo.
 */
export function registrosCsv(texto: string, separador = ";"): string[][] {
  const s = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const out: string[][] = [];
  let reg: string[] = [];
  let cur = "";
  let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          aspas = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      aspas = true;
    } else if (ch === separador) {
      reg.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      reg.push(cur);
      cur = "";
      if (reg.length > 1 || reg[0] !== "") out.push(reg);
      reg = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== "" || reg.length > 0) {
    reg.push(cur);
    if (reg.length > 1 || reg[0] !== "") out.push(reg);
  }
  return out;
}

const COLUNAS_DEPUTADOS = [
  "uri",
  "nome",
  "idLegislaturaInicial",
  "idLegislaturaFinal",
  "nomeCivil",
  "dataNascimento",
] as const;

/**
 * `deputados.csv` da Câmara → `DeputadoCamara[]`. Lança se faltar coluna ou se
 * um id/legislatura não for inteiro — um histórico parcialmente lido faria
 * ex-deputados virarem "estreantes" em silêncio.
 */
export function parseDeputadosCsv(texto: string): DeputadoCamara[] {
  const [cab, ...linhas] = registrosCsv(texto);
  if (!cab) throw new Error("deputados.csv vazio");
  const pos = new Map(cab.map((c, i) => [c.trim(), i]));
  for (const c of COLUNAS_DEPUTADOS) {
    if (!pos.has(c)) throw new Error(`deputados.csv sem a coluna obrigatória ${c}`);
  }
  const get = (l: string[], c: (typeof COLUNAS_DEPUTADOS)[number]) =>
    (l[pos.get(c) as number] ?? "").trim();
  const inteiro = (v: string, o: string, n: number) => {
    const x = Number(v);
    if (v === "" || !Number.isSafeInteger(x)) {
      throw new Error(`deputados.csv linha ${n}: ${o} não inteiro (${JSON.stringify(v)})`);
    }
    return x;
  };
  return linhas.map((l, i) => {
    const n = i + 2;
    const uri = get(l, "uri");
    return {
      id: inteiro(uri.split("/").at(-1) ?? "", "id da uri", n),
      nomeParlamentar: get(l, "nome"),
      nomeCivil: get(l, "nomeCivil"),
      nascimento: get(l, "dataNascimento"),
      legislaturaInicial: inteiro(get(l, "idLegislaturaInicial"), "idLegislaturaInicial", n),
      legislaturaFinal: inteiro(get(l, "idLegislaturaFinal"), "idLegislaturaFinal", n),
    };
  });
}

/**
 * Resposta de `GET /api/v2/deputados?itens=1000` → ids em exercício. Lança se
 * a resposta vier paginada (`links[rel=next]`): uma lista em exercício cortada
 * rebaixaria deputados em exercício para `legislatura_atual` sem aviso.
 */
export function parseEmExercicioJson(texto: string): number[] {
  const j = JSON.parse(texto) as {
    dados?: Array<{ id?: unknown }>;
    links?: Array<{ rel?: string }>;
  };
  if (!Array.isArray(j.dados)) throw new Error("deputados em exercício: resposta sem `dados`");
  if ((j.links ?? []).some((l) => l.rel === "next")) {
    throw new Error("deputados em exercício: resposta paginada — a lista viria incompleta");
  }
  return j.dados.map((d, i) => {
    const id = Number(d.id);
    if (!Number.isSafeInteger(id)) throw new Error(`deputados em exercício: item ${i} sem id`);
    return id;
  });
}
