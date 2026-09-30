// data-pipeline/candidatos-parse.ts
//
// **Tudo o que é puro** na importação do cadastro de candidaturas 2026: o
// recorte de colunas, a regra de publicabilidade, a junção dos dois CSVs do
// TSE e a guarda de encolhimento. Nada aqui faz I/O — nem rede, nem banco, nem
// disco — para que cada regra seja testável contra linha literal, e não contra
// um mock de Postgres.
//
// O I/O e o CLI vivem em `candidatos-import.ts`; o desempate de colisão, em
// `candidatos-resolve.ts`.
//
// ─── O recorte de colunas é a conformidade de PII, e é aqui ─────────────────
//
// `consulta_cand_2026.csv` tem **50 colunas**, três delas PII:
// `NR_CPF_CANDIDATO`, `DS_EMAIL`, `NR_TITULO_ELEITORAL_CANDIDATO`. Elas não são
// lidas por nenhuma função deste arquivo — não entram em estrutura
// intermediária, não vazam por log, não chegam a Postgres (constituição § 5,
// RNF-019, ADR-0039). `DT_NASCIMENTO`, `DS_OCUPACAO` e a ficha completa também
// ficam fora, por decisão de escopo do dono do produto.
//
// A guarda que sobrevive a refactor é o teste de **conjunto exato de chaves**
// de `CandidatoRow` (`tests/unit/data-pipeline/candidatos-parse.test.ts`): ele
// reprova quando alguém acrescenta um campo, mesmo que o novo campo pareça
// inofensivo. Asserção positiva ("os campos certos estão lá") passaria com o
// CPF ao lado.
//
// ─── Colunas medidas 100% vazias — não usar como sinal de nada ──────────────
//
// Medido em 2026-09-13 no arquivo gerado pelo TSE em 12/09:
// `CD_SITUACAO_CANDIDATURA` (`-3`) e `DS_SITUACAO_CANDIDATURA` (`#NE`) valem
// para **100%** das 20.939 linhas do arquivo principal; `DS_SIT_TOT_TURNO`,
// `DS_SITUACAO_CANDIDATO_URNA`, `DS_SITUACAO_CANDIDATO_PLEITO`,
// `DS_SITUACAO_CASSACAO` e `NM_TIPO_DESTINACAO_VOTOS` idem no complementar.
// Um parser que derivasse publicabilidade de qualquer uma delas propagaria
// `#NE` em silêncio até a tela (RF-140).

import type { CargoTse } from "../lib/config/cargos.ts";

/**
 * Cargos cobertos pelo produto — espelha `CargoTse` de `lib/config/cargos.ts`
 * (1 Presidente · 3 Governador · 5 Senador · 6 Deputado Federal · 7 Deputado
 * Estadual · 8 Deputado Distrital).
 *
 * 7 e 8 entraram em 2026-09-29 (spec 027 RF-288): a reimportação do dono em
 * 02–03/10 passa a trazer as ~11.276 candidaturas das 26 Assembleias e da
 * Câmara Legislativa, publicadas em `candidatos/uf/<SIGLA>/est.json` e
 * `candidatos/uf/DF/dis.json` (`candidatosUfBlobPathname`, pelo token).
 *
 * O import de tipo acima existe para que a lista aqui **não possa** divergir
 * do canônico sem o typecheck acusar. Os demais códigos do CSV — 2 e 4 (vices,
 * sem votação própria) e 9/10 (suplentes de Senador) — são descartados **e
 * contados** (nunca em silêncio).
 */
export const CARGOS_PRODUTO: readonly CargoTse[] = [1, 3, 5, 6, 7, 8];

/** Ano do pleito coberto por esta importação. */
export const ANO_PLEITO = 2026;

/**
 * Queda máxima tolerada, por cargo, entre a importação vigente e a nova, antes
 * que o ciclo aborte (RF-152).
 *
 * **2% não é número da norma nem do TSE.** É a menor margem que não dispara com
 * a volatilidade observada — substituições e recursos movem dezenas por ciclo,
 * não centenas — e ainda pega um download truncado. Recalibrar com o histórico
 * das primeiras semanas por **medição**, não por palpite.
 */
export const LIMIAR_ENCOLHIMENTO = 0.02;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Uma candidatura, já unida e recortada — exatamente as colunas que
 * `candidatos` (migration 0008) recebe do parser.
 *
 * **O conjunto de chaves é contrato testado.** `fonte_ts`, `importado_ts` e
 * `foto_ok` não estão aqui de propósito: os dois primeiros são valores do
 * **ciclo**, não da linha (o importador os aplica no INSERT), e `foto_ok` é da
 * trilha de fotos (RF-142), que não escreve por este caminho.
 */
export interface CandidatoRow {
  /**
   * `SQ_CANDIDATO`. **String, nunca `number`**: `bigint` no Postgres, e o valor
   * medido tem **11 ou 12 dígitos** (`Number.MAX_SAFE_INTEGER` ainda cabe, mas
   * o hábito de converter é o que reaparece depois em 15 dígitos como candidato
   * trocado). É também a chave que endereça a foto no Blob.
   */
  sq_candidato: string;
  ano: number;
  /** `CD_ELEICAO` — medido: 6257 para Presidente, 6259 para os demais. */
  cd_eleicao: number;
  turno: number;
  cargo: CargoTse;
  /** `SG_UF`; **`"BR"`** em candidatura presidencial — é o que o CSV traz. */
  uf: string;
  /**
   * `NR_CANDIDATO`. `integer` porque há **zero** ocorrências de zero à esquerda
   * nos 8.323 registros dos quatro cargos (2 a 4 dígitos), medido em 13/09.
   * ⚠️ No payload publicado o número volta a ser **string** (design 018 § D2) —
   * o EA20 declara `cand[].n` como string e um join number×string falha calado.
   */
  numero: number;
  nome: string;
  /** `NM_URNA_CANDIDATO`; cai em `nome` se vier vazio (ver `nomeDeUrna`). */
  nome_urna: string;
  partido_sigla: string;
  partido_numero: number;
  partido_nome: string | null;
  /** `SG_FEDERACAO`; `null` em partido isolado (sentinela `#NULO` no CSV). */
  federacao_sigla: string | null;
  coligacao_nome: string | null;
  /** `DS_SITUACAO_JULGAMENTO` **cru**, como o TSE publica. Nunca normalizado. */
  situacao_julgamento: string;
  inserido_urna: boolean;
  substituido: boolean;
  sq_substituido: string | null;
  publicavel: boolean;
}

/** O que o arquivo complementar contribui para a junção. */
export interface RegistroComplementar {
  sqCandidato: string;
  /** `ST_CANDIDATO_INSERIDO_URNA` cru — quem decide publicabilidade. */
  inseridoUrna: string;
  situacaoJulgamento: string;
  substituido: string;
  sqSubstituido: string | null;
}

export interface Partido {
  numero: number;
  sigla: string;
  nome: string;
}

export interface FiltroImportacao {
  uf?: string | null;
  cargo?: number | null;
}

export interface ResultadoUniao {
  linhas: CandidatoRow[];
  /** Descartes por código de cargo fora do produto. Contados, nunca calados. */
  descartadosPorCargo: Map<number, number>;
  /** Descartes pelo filtro de `--uf` / `--cargo` do operador. */
  descartadosPorFiltro: number;
  /** Total de linhas lidas do arquivo principal. */
  lidas: number;
  /** Tabela de referência de partidos, do universo INTEIRO do CSV. */
  partidos: Map<number, Partido>;
  /** `DT_GERACAO` + `HH_GERACAO` da primeira linha — conferência cruzada. */
  geracaoDeclarada: string | null;
}

// ---------------------------------------------------------------------------
// Sentinelas e acesso a campo
// ---------------------------------------------------------------------------

/**
 * Sentinelas de "sem valor" do TSE. `#NULO` (sem `#` final) é o que aparece de
 * fato em `SG_FEDERACAO`; os outros vêm do acervo e ficam por robustez.
 */
const SENTINELAS = new Set(["", "#NULO", "#NULO#", "#NE", "-1", "-3", "NULL"]);

export function campo(
  campos: readonly string[],
  header: Map<string, number>,
  nome: string,
): string {
  const i = header.get(nome);
  if (i === undefined) {
    throw new Error(`Coluna obrigatória ausente no CSV do TSE: ${nome}`);
  }
  return (campos[i] ?? "").trim();
}

/** Valor opcional: sentinela do TSE vira `null`, o resto passa cru. */
export function opcional(v: string): string | null {
  const s = v.trim();
  return SENTINELAS.has(s) ? null : s;
}

// ---------------------------------------------------------------------------
// Publicabilidade — fail-closed (ADR-0040, RF-141)
// ---------------------------------------------------------------------------

/**
 * `publicavel = (ST_CANDIDATO_INSERIDO_URNA === "SIM")`, **fail-closed**.
 *
 * Qualquer outro valor devolve `false`: `"NÃO"`, string vazia, valor
 * desconhecido (`"TALVEZ"`), `undefined`, e a **ausência da linha** no arquivo
 * complementar. Não existe caminho de "assumir SIM na dúvida" — a falta de
 * sinal nunca preenche a lacuna com a opção mais otimista.
 *
 * A comparação é exata sobre o valor sem espaços: `"sim"` minúsculo **não**
 * publica. Case-folding aqui seria tolerância a um valor que o TSE nunca
 * emitiu (medido: só `SIM` e `NÃO` nas 20.939 linhas), e tolerância é
 * justamente o que o fail-closed recusa.
 */
export function ehPublicavel(inseridoUrna: string | null | undefined): boolean {
  if (inseridoUrna == null) return false;
  return inseridoUrna.trim() === "SIM";
}

/**
 * `NM_URNA_CANDIDATO` com fallback para `NM_CANDIDATO`.
 *
 * Medido: o nome de urna **nunca** vem vazio (0 em 20.939) e tem no máximo 30
 * caracteres. O fallback fica assim mesmo — é o campo que a tela mostra, e uma
 * linha sem ele renderizaria um card anônimo. `||` e não `??`: string vazia
 * precisa cair no fallback, e `??` só pega `null`/`undefined`.
 */
export function nomeDeUrna(nomeUrna: string, nomeCompleto: string): string {
  return nomeUrna.trim() || nomeCompleto.trim();
}

// ---------------------------------------------------------------------------
// Extração linha a linha
// ---------------------------------------------------------------------------

export function extrairComplementar(
  campos: readonly string[],
  header: Map<string, number>,
): RegistroComplementar {
  return {
    sqCandidato: campo(campos, header, "SQ_CANDIDATO"),
    inseridoUrna: campo(campos, header, "ST_CANDIDATO_INSERIDO_URNA"),
    situacaoJulgamento: campo(campos, header, "DS_SITUACAO_JULGAMENTO"),
    substituido: campo(campos, header, "ST_SUBSTITUIDO"),
    sqSubstituido: opcional(campo(campos, header, "SQ_SUBSTITUIDO")),
  };
}

/**
 * Une uma linha do arquivo principal ao seu par no complementar.
 *
 * **Lança quando o par não existe.** O join 1:1 é premissa medida (20.939 ×
 * 20.939, zero linha faltando em 12/09), não esperança: uma candidatura sem
 * situação seria publicada sem saber se está na urna, que é exatamente o que o
 * fail-closed do ADR-0040 existe para impedir. Degradar aqui com `continue`
 * importaria parcial em silêncio (RF-140).
 */
export function mapearCandidato(
  campos: readonly string[],
  header: Map<string, number>,
  complementar: RegistroComplementar | undefined,
): CandidatoRow {
  const sq = campo(campos, header, "SQ_CANDIDATO");
  if (!complementar) {
    throw new Error(
      `Join quebrado: SQ_CANDIDATO ${sq} existe em consulta_cand mas não em ` +
        `consulta_cand_complementar. O join 1:1 é premissa do RF-140 — nada foi importado.`,
    );
  }
  const nome = campo(campos, header, "NM_CANDIDATO");
  return {
    sq_candidato: sq,
    ano: ANO_PLEITO,
    cd_eleicao: Number(campo(campos, header, "CD_ELEICAO")),
    turno: Number(campo(campos, header, "NR_TURNO")),
    cargo: Number(campo(campos, header, "CD_CARGO")) as CargoTse,
    uf: campo(campos, header, "SG_UF"),
    numero: Number(campo(campos, header, "NR_CANDIDATO")),
    nome,
    nome_urna: nomeDeUrna(campo(campos, header, "NM_URNA_CANDIDATO"), nome),
    partido_sigla: campo(campos, header, "SG_PARTIDO"),
    partido_numero: Number(campo(campos, header, "NR_PARTIDO")),
    partido_nome: opcional(campo(campos, header, "NM_PARTIDO")),
    federacao_sigla: opcional(campo(campos, header, "SG_FEDERACAO")),
    coligacao_nome: opcional(campo(campos, header, "NM_COLIGACAO")),
    situacao_julgamento: complementar.situacaoJulgamento,
    inserido_urna: ehPublicavel(complementar.inseridoUrna),
    substituido: complementar.substituido.trim() === "S",
    sq_substituido: complementar.sqSubstituido,
    publicavel: ehPublicavel(complementar.inseridoUrna),
  };
}

// ---------------------------------------------------------------------------
// União dos dois arquivos
// ---------------------------------------------------------------------------

/**
 * Junta os dois CSVs por `SQ_CANDIDATO`, descarta os cargos fora do produto
 * (contando cada descarte) e aplica o filtro do operador.
 *
 * Recebe as linhas já parseadas — o I/O fica no importador, e esta função é o
 * **mesmo** código que o teste exercita. Ler os dois arquivos inteiros na
 * memória é barato aqui: 20.939 linhas, ~11 MB de CSV.
 */
export function unirCandidaturas(
  principais: readonly (readonly string[])[],
  headerPrincipal: Map<string, number>,
  complementares: readonly (readonly string[])[],
  headerComplementar: Map<string, number>,
  filtro: FiltroImportacao = {},
): ResultadoUniao {
  const porSq = new Map<string, RegistroComplementar>();
  for (const linha of complementares) {
    const reg = extrairComplementar(linha, headerComplementar);
    porSq.set(reg.sqCandidato, reg);
  }

  const cargosProduto = new Set<number>(CARGOS_PRODUTO);
  const linhas: CandidatoRow[] = [];
  const descartadosPorCargo = new Map<number, number>();
  const partidos = new Map<number, Partido>();
  let descartadosPorFiltro = 0;
  let geracaoDeclarada: string | null = null;

  for (const campos of principais) {
    if (geracaoDeclarada === null) {
      const dt = campo(campos, headerPrincipal, "DT_GERACAO");
      const hh = campo(campos, headerPrincipal, "HH_GERACAO");
      if (dt) geracaoDeclarada = `${dt} ${hh}`.trim();
    }

    // `partidos` é tabela de REFERÊNCIA: sai do universo inteiro do arquivo,
    // antes de qualquer filtro, para que um run `--cargo 1` não a encolha.
    const nrPartido = Number(campo(campos, headerPrincipal, "NR_PARTIDO"));
    if (Number.isFinite(nrPartido) && !partidos.has(nrPartido)) {
      partidos.set(nrPartido, {
        numero: nrPartido,
        sigla: campo(campos, headerPrincipal, "SG_PARTIDO"),
        nome: campo(campos, headerPrincipal, "NM_PARTIDO"),
      });
    }

    const cargo = Number(campo(campos, headerPrincipal, "CD_CARGO"));
    if (!cargosProduto.has(cargo)) {
      descartadosPorCargo.set(cargo, (descartadosPorCargo.get(cargo) ?? 0) + 1);
      continue;
    }
    if (filtro.cargo != null && cargo !== filtro.cargo) {
      descartadosPorFiltro++;
      continue;
    }
    if (filtro.uf != null && campo(campos, headerPrincipal, "SG_UF") !== filtro.uf) {
      descartadosPorFiltro++;
      continue;
    }

    // O join estoura AQUI, com o cargo já filtrado: uma linha de Deputado
    // Estadual sem par não derruba a importação dos quatro cargos do produto.
    linhas.push(
      mapearCandidato(
        campos,
        headerPrincipal,
        porSq.get(campo(campos, headerPrincipal, "SQ_CANDIDATO")),
      ),
    );
  }

  return {
    linhas,
    descartadosPorCargo,
    descartadosPorFiltro,
    lidas: principais.length,
    partidos,
    geracaoDeclarada,
  };
}

// ---------------------------------------------------------------------------
// Guarda de encolhimento (RF-152)
// ---------------------------------------------------------------------------

export interface ContagemCargoUf {
  cargo: number;
  uf: string;
  total: number;
}

export interface QuedaCargo {
  cargo: number;
  antes: number;
  depois: number;
  /** Fração perdida: `(antes - depois) / antes`. Negativa quando cresceu. */
  queda: number;
}

export interface AvaliacaoEncolhimento {
  ok: boolean;
  /** Um motivo por gatilho disparado, já em prosa, para o log e o alerta. */
  motivos: string[];
  porCargo: QuedaCargo[];
  /** Pares (cargo, UF) que tinham ≥ 1 publicável e passaram a ter 0. */
  zerados: Array<{ cargo: number; uf: string; antes: number }>;
}

/**
 * Compara publicáveis por cargo e por par (cargo, UF) entre a importação
 * vigente e a nova. É a rede contra um download truncado esvaziar o grid em
 * 03/10 — roda **dentro da transação, antes do COMMIT** (RF-152).
 *
 * Dois gatilhos, e o segundo não é redundante: um download truncado costuma
 * zerar um pedaço (uma UF inteira some) sem encolher o total além de 2%.
 *
 * "Cair **mais de** 2%" é literal: queda de exatamente 2% passa, 2,001% aborta.
 * Crescer nunca dispara. Cargo que não existia antes (`antes = 0`) também não
 * dispara — não há do que encolher na primeira importação.
 */
export function avaliarEncolhimento(
  antes: readonly ContagemCargoUf[],
  depois: readonly ContagemCargoUf[],
): AvaliacaoEncolhimento {
  const somaPorCargo = (xs: readonly ContagemCargoUf[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x.cargo, (m.get(x.cargo) ?? 0) + x.total);
    return m;
  };
  const porPar = (xs: readonly ContagemCargoUf[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(`${x.cargo}|${x.uf}`, (m.get(`${x.cargo}|${x.uf}`) ?? 0) + x.total);
    return m;
  };

  const antesCargo = somaPorCargo(antes);
  const depoisCargo = somaPorCargo(depois);
  const motivos: string[] = [];
  const porCargo: QuedaCargo[] = [];

  for (const [cargo, nAntes] of [...antesCargo.entries()].sort((a, b) => a[0] - b[0])) {
    const nDepois = depoisCargo.get(cargo) ?? 0;
    if (nAntes === 0) continue;
    const queda = (nAntes - nDepois) / nAntes;
    porCargo.push({ cargo, antes: nAntes, depois: nDepois, queda });
    if (queda > LIMIAR_ENCOLHIMENTO) {
      motivos.push(
        `cargo ${cargo}: ${nAntes.toLocaleString("pt-BR")} → ${nDepois.toLocaleString("pt-BR")} ` +
          `publicáveis (queda de ${(queda * 100).toFixed(2)}%, limiar ${LIMIAR_ENCOLHIMENTO * 100}%)`,
      );
    }
  }

  const antesPar = porPar(antes);
  const depoisPar = porPar(depois);
  const zerados: Array<{ cargo: number; uf: string; antes: number }> = [];
  for (const [chave, nAntes] of antesPar.entries()) {
    if (nAntes < 1) continue;
    if ((depoisPar.get(chave) ?? 0) > 0) continue;
    const [cargoStr, uf] = chave.split("|");
    zerados.push({ cargo: Number(cargoStr), uf: uf ?? "", antes: nAntes });
  }
  zerados.sort((a, b) => a.cargo - b.cargo || a.uf.localeCompare(b.uf));
  for (const z of zerados) {
    motivos.push(
      `par (cargo ${z.cargo}, ${z.uf}) tinha ${z.antes.toLocaleString("pt-BR")} publicáveis e passou a ter 0`,
    );
  }

  return { ok: motivos.length === 0, motivos, porCargo, zerados };
}

/** Contagem de publicáveis por (cargo, UF) a partir das linhas já unidas. */
export function contarPublicaveis(linhas: readonly CandidatoRow[]): ContagemCargoUf[] {
  const m = new Map<string, ContagemCargoUf>();
  for (const l of linhas) {
    if (!l.publicavel) continue;
    const k = `${l.cargo}|${l.uf}`;
    const cur = m.get(k);
    if (cur) cur.total++;
    else m.set(k, { cargo: l.cargo, uf: l.uf, total: 1 });
  }
  return [...m.values()].sort((a, b) => a.cargo - b.cargo || a.uf.localeCompare(b.uf));
}
