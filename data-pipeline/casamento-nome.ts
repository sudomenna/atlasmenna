// data-pipeline/casamento-nome.ts
//
// **Casamento por nome civil normalizado + data de nascimento**, generalizado
// para qualquer casa legislativa. É o mesmo método de `trajetoria-camara.ts`
// (ADR-0058, item 2) — porte fiel das regras, sem "melhoria":
//
//   1. **exato**: chave `(nome civil normalizado, data ISO)`;
//   2. **aproximado**, só entre pessoas **nascidas no mesmo dia**, se qualquer
//      uma de três regras valer:
//        (a) tokens em comum ≥ max(2, min(|A|, |B|) − 1), sobre os CONJUNTOS
//            de tokens — cobre sobrenome de casada acrescentado ou removido;
//        (b) primeiro e último token iguais — cobre nome do meio abreviado;
//        (c) o nome parlamentar da casa == nome de urna ou nome social do TSE —
//            cobre quem usa nome social diferente do civil registrado.
//
// ⚠️ `trajetoria-camara.ts` (worktree 3B, ainda fora da `main` ao escrever
// isto) tem a sua própria cópia destas quatro funções. Quando o 3B entrar, o
// certo é `trajetoria-camara.ts` importar daqui; até lá as duas precisam
// andar juntas — a alteração de uma regra vale para as duas ou para nenhuma.
//
// ─── A data de nascimento é PII e só existe como argumento ──────────────────
//
// Nome civil e nascimento (dos dois lados) são lidos em memória, servem ao
// casamento e morrem ali. Nada aqui grava, loga ou devolve nome ou data: o que
// `casar` devolve é a lista das PESSOAS DO HISTÓRICO que casaram (o chamador
// extrai delas o id público) e o modo. Constituição § 5, ADR-0039/0058/0062.
//
// Este módulo é puro: nem rede, nem banco, nem disco.

export type ModoCasamento = "exato" | "aproximado" | "nenhum";

/** O que o casamento precisa saber de uma pessoa do histórico da casa. */
export interface PessoaCasavel {
  /** Nome civil (`NomeCompletoParlamentar` no Senado). */
  nomeCivil: string;
  /** Nome parlamentar — o de exercício, não o civil. */
  nomeParlamentar: string;
  /** AAAA-MM-DD; `""` quando a casa não tem o dado. */
  nascimento: string;
}

/** O que o casamento precisa saber de uma candidatura. **Transitório.** */
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

export interface IndiceCasamento<P extends PessoaCasavel> {
  /** `"<nome civil normalizado>|<AAAA-MM-DD>"` → pessoas. */
  porNomeENascimento: ReadonlyMap<string, readonly P[]>;
  /** `AAAA-MM-DD` → pessoas nascidas nesse dia. */
  porNascimento: ReadonlyMap<string, readonly P[]>;
  /** Contagens para o log — nunca nomes nem datas. */
  total: number;
  semNascimento: number;
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/**
 * Tokens de um nome: NFD, descarta o que não é ASCII (os acentos combinantes
 * e qualquer letra fora do ASCII), maiúsculas, tudo que não é A–Z vira espaço.
 *
 * A ordem importa: o não-ASCII é **descartado** (não vira espaço) antes do
 * `upper`. `"D'ÁVILA"` → `["D", "AVILA"]`.
 */
export function tokensDoNome(nome: string | null | undefined): string[] {
  const ascii = (nome ?? "").normalize("NFD").replace(/[\u0080-￿]/g, "");
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

/** `DD/MM/AAAA` (TSE) → `AAAA-MM-DD`. Qualquer outra forma (`#NULO#`, vazio) → `""`. */
export function isoDeDataTse(data: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// ---------------------------------------------------------------------------
// Índice e casamento
// ---------------------------------------------------------------------------

/**
 * Indexa o histórico. Pessoa **sem** data de nascimento fica fora dos dois
 * índices — sem data não há como casar, e casar só por nome juntaria homônimos.
 */
export function construirIndice<P extends PessoaCasavel>(
  pessoas: readonly P[],
): IndiceCasamento<P> {
  const porNomeENascimento = new Map<string, P[]>();
  const porNascimento = new Map<string, P[]>();
  let semNascimento = 0;
  for (const p of pessoas) {
    if (!p.nascimento) {
      semNascimento++;
      continue;
    }
    const k = `${chaveDoNome(p.nomeCivil)}|${p.nascimento}`;
    porNomeENascimento.set(k, [...(porNomeENascimento.get(k) ?? []), p]);
    porNascimento.set(p.nascimento, [...(porNascimento.get(p.nascimento) ?? []), p]);
  }
  return { porNomeENascimento, porNascimento, total: pessoas.length, semNascimento };
}

/** Regra aproximada — ver o cabeçalho. Só se aplica a nascidos no mesmo dia. */
export function casaAproximado(cand: IdentificacaoCandidato, pessoa: PessoaCasavel): boolean {
  const ta = tokensDoNome(cand.nomeCivil);
  const tb = tokensDoNome(pessoa.nomeCivil);
  const a = new Set(ta);
  const b = new Set(tb);
  let comuns = 0;
  for (const t of a) if (b.has(t)) comuns++;
  const regraA = comuns >= Math.max(2, Math.min(a.size, b.size) - 1);

  const regraB = ta.length > 0 && tb.length > 0 && ta[0] === tb[0] && ta.at(-1) === tb.at(-1);

  const parlamentar = chaveDoNome(pessoa.nomeParlamentar);
  const outros = [chaveDoNome(cand.nomeUrna), chaveDoNome(cand.nomeSocial)].filter(
    (k) => k.length > 0,
  );
  const regraC = parlamentar.length > 0 && outros.includes(parlamentar);

  return regraA || regraB || regraC;
}

/**
 * Casa uma candidatura com o histórico: primeiro **exato**; se não houver,
 * **aproximado** entre os nascidos no mesmo dia. Sem data de nascimento
 * legível, não casa.
 */
export function casar<P extends PessoaCasavel>(
  cand: IdentificacaoCandidato,
  indice: IndiceCasamento<P>,
): { casados: readonly P[]; modo: ModoCasamento } {
  if (!cand.nascimento) return { casados: [], modo: "nenhum" };
  const exatos =
    indice.porNomeENascimento.get(`${chaveDoNome(cand.nomeCivil)}|${cand.nascimento}`) ?? [];
  if (exatos.length > 0) return { casados: exatos, modo: "exato" };
  const aproximados = (indice.porNascimento.get(cand.nascimento) ?? []).filter((p) =>
    casaAproximado(cand, p),
  );
  if (aproximados.length > 0) return { casados: aproximados, modo: "aproximado" };
  return { casados: [], modo: "nenhum" };
}
