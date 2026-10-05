/**
 * scripts/_fechamento-1t-core.ts
 *
 * Núcleo PURO do fechamento do 1º turno (`scripts/fechamento-1t.ts`,
 * `pnpm fechamento:1t`). Nada aqui lê disco, rede ou `process.env` — só
 * transforma payloads já lidos. É o que o teste
 * (`tests/unit/scripts/fechamento-1t.test.ts`) exercita.
 *
 * ## O que o fechamento faz, e por quê (05/10/2026)
 *
 * 1. **Presidente (cargo 1): voto da soma das zonas → agregado oficial do TSE.**
 *    O TSE congelou 12 arquivos de zona do Presidente por volta das 21h de
 *    04/10; a nossa soma ficou sem votos em BA, MG e SP (nacional: Flávio
 *    −6.460, Lula −8.870). Os agregados por UF (`<uf>-c0001-e006257-u.json`,
 *    inclusive `zz`, o exterior) e o do Brasil (`br-…`) estão completos.
 *    Decisão do dono ("opção A"): publicar os números oficiais.
 *
 * 2. **Todo cargo: projeção == apuração.** Mesma regra de
 *    `_igualar_projecao_ao_apurado` (`api/model/project.py`): com 100%
 *    apurado, `pct_projetado`, IC, `votos_projetados` e o bloco
 *    `comparecimento` passam a ser o número apurado. Aqui ela é aplicada
 *    também ao que a função do modelo não alcança — `participacao`,
 *    `votacao.projetada`, `por_uf[].top_candidatos[].pct`/`margem_projetada`
 *    e o `cadeiras_ci95` do Deputado.
 *
 * ## Convenções do payload respeitadas (`build_edge_payload`/`build_uf_payloads`)
 *
 *   - `pct_atual` é sobre a base em disputa (`vvc`, Σ das candidaturas que
 *     competem). A candidatura de destino `"anulado"` (ADR-0053) fica fora da
 *     base e mantém o próprio percentual sobre Σ de todas as candidaturas.
 *     No Presidente de 2026 não há anulada (`van = 0` em todas as UFs), mas a
 *     regra está aqui para não fabricar percentual errado se houver.
 *   - UF: percentuais em 5 casas (`_frac_to_pct`). Nacional: sem arredondar
 *     (é como o modelo grava `pct_atual` nacional).
 *   - `comparecimento.pct_atual` = votos / comparecimento (`tv`).
 *   - "Outros" = cauda a partir do 4º colocado, sem a anulada.
 *   - Ordem: candidatos por votos decrescentes; `rank` nacional 1..n.
 *
 * ⚠️ O bloco `national.candidatos` de Governador e Senador é a UNIÃO de 27
 * corridas (o `pct_atual` é sobre o país inteiro, o `pct_projetado` é de cada
 * corrida) — igualar ali trocaria 51,9% por 3,6%. Ele NÃO é tocado aqui.
 */

// ---------------------------------------------------------------------------
// Tipos mínimos — o payload real é maior; mexemos só nestes campos
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

export interface TseCandidato {
  id: number;
  sqcand: string;
  vap: number;
  /** `dvt` do TSE ("Válido", "Anulado", …). */
  dvt: string;
}

export interface TseAgregado {
  /** Instante da totalização deste arquivo (`dg` + `hg`, BRT → ISO UTC). */
  dataHoraIso: string;
  /** Seções totalizadas / total (`s.st` / `s.ts`). */
  secoesTotalizadas: number;
  secoesTotal: number;
  candidatos: TseCandidato[];
  /** `e.te`, `e.esi`, `e.c`, `e.a`. */
  aptos: number;
  instalados: number;
  comparecimento: number;
  abstencao: number;
  /** `v.vv`, `v.vb`, `v.tvn`, `v.van`, `v.vansj`, `v.tv`. */
  validos: number;
  brancos: number;
  nulos: number;
  anulados: number;
  subJudice: number;
  totalVotos: number;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** "05/10/2026" + "02:59:31" (BRT, UTC-3, sem horário de verão) → ISO UTC. */
export function brtParaIso(dg: string, hg: string): string {
  const [d, m, a] = dg.split("/").map(Number);
  const [h, mi, s] = hg.split(":").map(Number);
  const ms = Date.UTC(a ?? 0, (m ?? 1) - 1, d ?? 1, (h ?? 0) + 3, mi ?? 0, s ?? 0);
  return new Date(ms).toISOString().replace(".000Z", "+00:00");
}

/** Lê um arquivo agregado `<abr>-c<cargo>-e<ele>-u.json` do TSE. */
export function parseTseAgregado(bruto: unknown): TseAgregado {
  const j = bruto as Obj;
  const s = (j.s ?? {}) as Obj;
  const e = (j.e ?? {}) as Obj;
  const v = (j.v ?? {}) as Obj;
  const carg = (j.carg as Obj[] | undefined)?.[0] ?? {};
  const candidatos: TseCandidato[] = [];
  for (const agr of (carg.agr as Obj[] | undefined) ?? []) {
    for (const par of (agr.par as Obj[] | undefined) ?? []) {
      for (const c of (par.cand as Obj[] | undefined) ?? []) {
        candidatos.push({
          id: num(c.n),
          sqcand: String(c.sqcand ?? ""),
          vap: num(c.vap),
          dvt: String(c.dvt ?? ""),
        });
      }
    }
  }
  if (candidatos.length === 0) throw new Error("agregado do TSE sem candidaturas (carg[0].agr)");
  return {
    dataHoraIso: brtParaIso(String(j.dg ?? ""), String(j.hg ?? "")),
    secoesTotalizadas: num(s.st),
    secoesTotal: num(s.ts),
    candidatos,
    aptos: num(e.te),
    instalados: num(e.esi),
    comparecimento: num(e.c),
    abstencao: num(e.a),
    validos: num(v.vv),
    brancos: num(v.vb),
    nulos: num(v.tvn),
    anulados: num(v.van),
    subJudice: num(v.vansj),
    totalVotos: num(v.tv),
  };
}

/** `true` quando o TSE marca o arquivo como 100% totalizado. */
export function tseCompleto(t: TseAgregado): boolean {
  return t.secoesTotal > 0 && t.secoesTotalizadas >= t.secoesTotal;
}

export const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function ehAnulado(c: Obj | undefined, t: TseCandidato | undefined): boolean {
  if (c && c.destino === "anulado") return true;
  return t ? /anulad/i.test(t.dvt) : false;
}

interface Percentuais {
  /** id → pct sobre a base em disputa (anulada: sobre Σ de todas). */
  pct: Map<number, number>;
  /** id → pct sobre o comparecimento (`tv`). */
  pctComp: Map<number, number>;
  baseDisputa: number;
  anulados: Set<number>;
}

function percentuais(
  t: TseAgregado,
  destinoPorId: Map<number, Obj>,
  arred: (x: number) => number,
): Percentuais {
  const anulados = new Set<number>();
  for (const c of t.candidatos) if (ehAnulado(destinoPorId.get(c.id), c)) anulados.add(c.id);
  const somaTodas = t.candidatos.reduce((s, c) => s + c.vap, 0);
  const baseDisputa = t.candidatos
    .filter((c) => !anulados.has(c.id))
    .reduce((s, c) => s + c.vap, 0);
  const pct = new Map<number, number>();
  const pctComp = new Map<number, number>();
  for (const c of t.candidatos) {
    const base = anulados.has(c.id) ? somaTodas : baseDisputa;
    pct.set(c.id, base > 0 ? arred((c.vap / base) * 100) : 0);
    pctComp.set(c.id, t.totalVotos > 0 ? arred((c.vap / t.totalVotos) * 100) : 0);
  }
  return { pct, pctComp, baseDisputa, anulados };
}

function contagensDe(t: TseAgregado): Obj {
  return {
    aptos: t.aptos,
    instalados: t.instalados,
    comparecimento: t.comparecimento,
    abstencao: t.abstencao,
    validos: t.validos,
    brancos: t.brancos,
    nulos: t.nulos,
    anulados: t.anulados,
    sub_judice: t.subJudice,
  };
}

function atualizarVotacao(votacao: unknown, t: TseAgregado): unknown {
  if (!votacao || typeof votacao !== "object") return votacao;
  const v = votacao as Obj;
  const out: Obj = { ...v, contagens: { ...((v.contagens as Obj) ?? {}), ...contagensDe(t) } };
  if (Array.isArray(v.corrida)) {
    const porId = new Map(t.candidatos.map((c) => [c.id, c.vap]));
    out.corrida = (v.corrida as Obj[]).map((r) =>
      porId.has(Number(r.id)) ? { ...r, votos: porId.get(Number(r.id)) } : r,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Igualar projeção == apuração (porte de `_igualar_projecao_ao_apurado`)
// ---------------------------------------------------------------------------

/** Igual a `_igualar` do modelo, linha a linha. Muta `cands`. */
export function igualarCandidatos(cands: unknown): void {
  if (!Array.isArray(cands)) return;
  for (const c of cands as Obj[]) {
    if (!c || typeof c !== "object" || c.pct_atual === null || c.pct_atual === undefined) continue;
    c.pct_projetado = c.pct_atual;
    if ("pct_projetado_lower" in c || "pct_projetado_upper" in c) {
      c.pct_projetado_lower = c.pct_atual;
      c.pct_projetado_upper = c.pct_atual;
    }
    if (c.ci95 && typeof c.ci95 === "object") c.ci95 = { lower: c.pct_atual, upper: c.pct_atual };
    if (c.votos_atuais !== null && c.votos_atuais !== undefined)
      c.votos_projetados = c.votos_atuais;
    const comp = c.comparecimento as Obj | undefined;
    if (
      comp &&
      typeof comp === "object" &&
      comp.pct_atual !== null &&
      comp.pct_atual !== undefined
    ) {
      comp.pct_projetado = comp.pct_atual;
      comp.lower = comp.pct_atual;
      comp.upper = comp.pct_atual;
    }
  }
}

/** Faixa `{pct_atual, pct_projetado, lower, upper}` colapsada no apurado. Muta. */
function igualarFaixa(f: unknown): void {
  if (!f || typeof f !== "object") return;
  const o = f as Obj;
  if (o.pct_atual === null || o.pct_atual === undefined) return;
  o.pct_projetado = o.pct_atual;
  if ("lower" in o) o.lower = o.pct_atual;
  if ("upper" in o) o.upper = o.pct_atual;
  igualarFaixa(o.comparecimento);
}

function igualarParticipacao(p: unknown): void {
  if (!p || typeof p !== "object") return;
  const o = p as Obj;
  igualarFaixa(o.abstencao);
  igualarFaixa(o.brancos_nulos);
  igualarFaixa(o.outros);
}

function igualarVotacaoProjetada(votacao: unknown): void {
  if (!votacao || typeof votacao !== "object") return;
  const v = votacao as Obj;
  const c = v.contagens as Obj | undefined;
  if (!c || !v.projetada || typeof v.projetada !== "object") return;
  v.projetada = {
    validos: c.validos,
    brancos: c.brancos,
    nulos: c.nulos,
    abstencao: c.abstencao,
  };
}

/** Uma linha de `por_uf` de cargo majoritário. Muta. */
function igualarLinhaPorUf(l: Obj): void {
  if (Number(l.pct_apurado ?? 0) < 100) return;
  const top = Array.isArray(l.top_candidatos) ? (l.top_candidatos as Obj[]) : [];
  for (const c of top) if (c.pct_atual !== null && c.pct_atual !== undefined) c.pct = c.pct_atual;
  const outros = l.outros as Obj | undefined;
  if (outros && outros.pct_atual !== null && outros.pct_atual !== undefined)
    outros.pct = outros.pct_atual;
  const competem = top.filter((c) => c.destino !== "anulado");
  if (competem.length >= 2) {
    const m = round5(Number(competem[0]?.pct_atual) - Number(competem[1]?.pct_atual));
    l.margem_atual = m;
    l.margem_projetada = m;
    if (Array.isArray(l.margem_projetada_ci)) l.margem_projetada_ci = [m, m];
  }
}

/** Payload UF de cargo majoritário (pres/gov/sen). Devolve cópia. */
export function igualarUfMajoritario<T>(payload: T): T {
  const p = clone(payload) as Obj;
  if (Number(p.pct_apurado ?? 0) < 100) return p as T;
  igualarCandidatos(p.candidatos);
  igualarParticipacao(p.participacao);
  igualarVotacaoProjetada(p.votacao);
  return p as T;
}

/**
 * Payload nacional de cargo majoritário. `candidatosNacionais` só no
 * Presidente — ver o ⚠️ do cabeçalho. Devolve cópia.
 */
export function igualarNacionalMajoritario<T>(
  payload: T,
  opts: { candidatosNacionais: boolean },
): T {
  const p = clone(payload) as Obj;
  if (Number(p.pct_apurado_total ?? 0) < 100) return p as T;
  if (opts.candidatosNacionais) igualarCandidatos((p.national as Obj | undefined)?.candidatos);
  if (Array.isArray(p.por_uf)) for (const l of p.por_uf as Obj[]) igualarLinhaPorUf(l);
  igualarVotacaoProjetada(p.votacao);
  return p as T;
}

/** Payload nacional de Deputado (6/7/8): IC de cadeiras colapsa. Devolve cópia. */
export function igualarDeputado<T>(payload: T): T {
  const p = clone(payload) as Obj;
  if (Number(p.pct_apurado_total ?? 0) < 100) return p as T;
  const bancada = p.bancada as Obj | undefined;
  const ufsAguardando = Number(bancada?.ufs_aguardando ?? 0);
  if (!bancada || ufsAguardando > 0) return p as T;
  for (const a of (bancada.por_agremiacao as Obj[] | undefined) ?? []) {
    if (Number(a.cadeiras_indefinidas ?? 0) !== 0) continue;
    if (Array.isArray(a.cadeiras_ci95)) a.cadeiras_ci95 = [a.cadeiras, a.cadeiras];
  }
  return p as T;
}

// ---------------------------------------------------------------------------
// Presidente: voto oficial do TSE
// ---------------------------------------------------------------------------

/** Payload UF do Presidente com os votos do agregado oficial da UF. Devolve cópia. */
export function aplicarTseUfPresidente<T>(payload: T, t: TseAgregado): T {
  const p = clone(payload) as Obj;
  const cands = (Array.isArray(p.candidatos) ? p.candidatos : []) as Obj[];
  const porId = new Map(cands.map((c) => [Number(c.id), c]));
  const { pct, pctComp, anulados } = percentuais(t, porId, round5);

  for (const tc of t.candidatos) {
    const c = porId.get(tc.id);
    if (!c) throw new Error(`UF ${String(p.uf)}: candidatura ${tc.id} do TSE ausente no payload`);
    c.votos_atuais = tc.vap;
    c.pct_atual = pct.get(tc.id);
    const comp = c.comparecimento as Obj | undefined;
    if (comp && typeof comp === "object") comp.pct_atual = pctComp.get(tc.id);
  }
  cands.sort((a, b) => Number(b.votos_atuais) - Number(a.votos_atuais));
  p.candidatos = cands;
  p.pct_apurado = 100;

  // participacao — mesmas bases que o modelo declara em `base`.
  const part = p.participacao as Obj | undefined;
  if (part) {
    const abst = part.abstencao as Obj | undefined;
    if (abst && t.instalados > 0) abst.pct_atual = round5((t.abstencao / t.instalados) * 100);
    const bn = part.brancos_nulos as Obj | undefined;
    if (bn && t.totalVotos > 0) bn.pct_atual = round5(((t.brancos + t.nulos) / t.totalVotos) * 100);
    const outros = part.outros as Obj | undefined;
    if (outros) {
      // Soma dos percentuais JÁ arredondados de cada candidatura, como o modelo
      // faz — somar votos e dividir dá 1e-5 de diferença e "muda" UF intacta.
      const cauda = cands.filter((c) => !anulados.has(Number(c.id))).slice(3);
      outros.pct_atual = round5(cauda.reduce((s, c) => s + Number(c.pct_atual ?? 0), 0));
      outros.n_candidatos = cauda.length;
      const oc = outros.comparecimento as Obj | undefined;
      if (oc)
        oc.pct_atual = round5(
          cauda.reduce(
            (s, c) => s + Number((c.comparecimento as Obj | undefined)?.pct_atual ?? 0),
            0,
          ),
        );
    }
    const metodo = part.metodo as Obj | undefined;
    if (metodo && "pct_apurado" in metodo) metodo.pct_apurado = 100;
  }
  p.votacao = atualizarVotacao(p.votacao, t);
  return p as T;
}

/** Linha `por_uf` do nacional do Presidente refeita do agregado da UF. Muta. */
function aplicarTseLinhaPorUf(l: Obj, t: TseAgregado): void {
  const topAntes = Array.isArray(l.top_candidatos) ? (l.top_candidatos as Obj[]) : [];
  const identPorId = new Map(topAntes.map((c) => [Number(c.id), c]));
  const { pct, anulados } = percentuais(t, identPorId, round5);
  const ordenados = [...t.candidatos].sort((a, b) => b.vap - a.vap);
  const competem = ordenados.filter((c) => !anulados.has(c.id));
  const nTop = Math.max(topAntes.length, 4);
  const top = competem.slice(0, nTop);
  const cauda = competem.slice(nTop);

  l.top_candidatos = top.map((tc) => {
    const antes = identPorId.get(tc.id) ?? {};
    return {
      ...antes,
      id: tc.id,
      pct: pct.get(tc.id),
      votos_atuais: tc.vap,
      pct_atual: pct.get(tc.id),
    };
  });
  // Identidade (nome/partido/sqcand) de quem entrou no top agora e não estava:
  // sem ela a linha sai sem nome. Não acontece no 1º turno de 2026 (o top 4 de
  // cada UF não muda), e o script recusa se acontecer — ver `faltaIdentidade`.
  if (cauda.length > 0 || l.outros) {
    const votos = cauda.reduce((s, c) => s + c.vap, 0);
    // Soma dos percentuais já arredondados — a mesma conta do modelo.
    const pctOutros = round5(cauda.reduce((s, c) => s + (pct.get(c.id) ?? 0), 0));
    l.outros = {
      pct: pctOutros,
      pct_atual: pctOutros,
      votos_atuais: votos,
      n_candidatos: cauda.length,
    };
  }
  l.lider = competem[0]?.id ?? l.lider;
  l.pct_apurado = 100;
  if ("votos_disputa_projetados" in l) l.votos_disputa_projetados = t.validos;
  igualarLinhaPorUf(l);
}

/** `true` se alguma linha `por_uf` ficou sem `nome` (candidatura nova no top). */
export function faltaIdentidade(payload: unknown): string[] {
  const out: string[] = [];
  for (const l of ((payload as Obj).por_uf as Obj[] | undefined) ?? [])
    for (const c of (l.top_candidatos as Obj[] | undefined) ?? [])
      if (!c.nome) out.push(`${String(l.sigla)}:${String(c.id)}`);
  return out;
}

/**
 * Nacional do Presidente com o agregado do Brasil (`br`) e os das UFs
 * (`porUf`, chave = sigla em maiúscula, inclusive `ZZ`). Devolve cópia.
 */
export function aplicarTseNacionalPresidente<T>(
  payload: T,
  br: TseAgregado,
  porUf: ReadonlyMap<string, TseAgregado>,
): T {
  const p = clone(payload) as Obj;
  const national = p.national as Obj;
  const cands = (national.candidatos as Obj[]) ?? [];
  const porId = new Map(cands.map((c) => [Number(c.id), c]));
  const { pct, pctComp } = percentuais(br, porId, (x) => x);

  for (const tc of br.candidatos) {
    const c = porId.get(tc.id);
    if (!c) throw new Error(`nacional: candidatura ${tc.id} do TSE ausente no payload`);
    c.votos_atuais = tc.vap;
    c.pct_atual = pct.get(tc.id);
    const comp = c.comparecimento as Obj | undefined;
    if (comp && typeof comp === "object") comp.pct_atual = round5(pctComp.get(tc.id) ?? 0);
  }
  cands.sort((a, b) => Number(b.votos_atuais) - Number(a.votos_atuais));
  cands.forEach((c, i) => {
    if ("rank" in c) c.rank = i + 1;
  });
  national.candidatos = cands;
  p.pct_apurado_total = 100;
  p.votacao = atualizarVotacao(p.votacao, br);

  for (const l of (p.por_uf as Obj[] | undefined) ?? []) {
    const t = porUf.get(String(l.sigla).toUpperCase());
    if (!t) throw new Error(`por_uf: sem agregado do TSE para ${String(l.sigla)}`);
    aplicarTseLinhaPorUf(l, t);
  }
  return p as T;
}

// ---------------------------------------------------------------------------
// Carimbo e diff
// ---------------------------------------------------------------------------

/** `ts` = agora, `dado_ts` = hora final do TSE, `encerrado: true`. Devolve cópia. */
export function carimbar<T>(payload: T, ts: string, dadoTs: string | null): T {
  const p = clone(payload) as Obj;
  p.ts = ts;
  if (dadoTs) p.dado_ts = dadoTs;
  p.encerrado = true;
  return p as T;
}

/** Caminhos-folha que mudaram entre `a` e `b` (sem `ts`). */
export function diffFolhas(a: unknown, b: unknown, prefixo = ""): string[] {
  if (a === b) return [];
  const ehObj = (x: unknown) => x !== null && typeof x === "object";
  if (!ehObj(a) || !ehObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) return [];
    return [prefixo || "(raiz)"];
  }
  const out: string[] = [];
  const ka = Object.keys(a as Obj);
  const kb = Object.keys(b as Obj);
  for (const k of new Set([...ka, ...kb])) {
    if (prefixo === "" && k === "ts") continue;
    out.push(...diffFolhas((a as Obj)[k], (b as Obj)[k], prefixo ? `${prefixo}.${k}` : k));
  }
  return out;
}
