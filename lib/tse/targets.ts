/**
 * lib/tse/targets.ts — Tabela de targets (UF/BR × cargo [× zona]) para o pipeline de ingestão.
 *
 * Responsabilidades:
 *  - Construir URLs canônicas EA20 do CDN TSE (host configurável — RF-001).
 *  - Materializar a lista de targets conforme o env (preview vs production).
 *  - Cache leve em memória do processo com TTL ~5min por env.
 *
 * Cobre: RF-001 (descoberta de endpoints), decisão D-4 (whitelist preview).
 * ADRs: 0001 (Edge Config no read path — Postgres só no write path), 0002, 0011.
 *
 * ---------------------------------------------------------------------------
 * REESCRITA — 2026-09-05 (hardening pré-simulado, 9 PDFs oficiais TSE 2026)
 * ---------------------------------------------------------------------------
 *
 * O builder de URL anterior (`buildEA20Url`) montava:
 *   `${base}/${codEleicao}/dados/${uf}/${uf}${munic}/${uf}${munic}-c${cargo}-z${zona}-e${eleicao}.json`
 * contra o confirmado em `docs/reference/tse-2026-leiautes.md` (fonte:
 * tse_docs/txt/tse-instrucoes-para-download-2026.txt § 3 tabela "ID da Pasta 6"
 * + tse-ea20-arquivo-de-resultado-unificado.txt § 2):
 *   1. NÃO há subpasta de município — "dados/<uf|br|zz>" é pasta FOLHA
 *      ("não há subpastas abaixo dela e os arquivos estarão diretamente
 *      armazenados nessa pasta").
 *   2. A ordem dos tokens no nome é `-z<ZONA>-c<CARGO>`, não `-c-z`.
 *   3. Falta o sufixo `-u` (arquivo "unificado").
 *   4. Existem arquivos agregados de UF (`<uf>-c<cargo>-e<eleicao>-u.json`) e
 *      de Brasil (`br-c<cargo>-e<eleicao>-u.json>`) — granularidade de zona
 *      não é a única opção.
 *   5. O código do município é zero-padded a 5 dígitos (não usado sem padding
 *      como antes — coincidência de "80055" já ter 5 dígitos escondeu o bug).
 *
 * Toda URL malformada é um risco de bloqueio de IP por 404 seguido de rajada
 * (ver FAQ técnica do simulado, citada em lib/tse/client.ts) — daí a
 * reescrita completa em vez de patch incremental.
 */

import { eq } from "drizzle-orm";
import {
  CARGOS_TSE,
  type CargoTse,
  cargoExisteNaUf,
  cargoInfo,
  type Eleicao,
  eleicaoDoCargo,
  isCargoTse,
  ufsDoCargo,
} from "@/lib/config/cargos";
import { db, schema } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Nível de abrangência de um target.
 *   - "zona": arquivo de resultado unificado da zona eleitoral (mais granular;
 *     é a unidade da regra de três do modelo — `k = te/esi` por zona, spec 002
 *     RF-011/RF-012, ADR-0021).
 *   - "uf": arquivo agregado da UF inteira (1 GET cobre todos os municípios/
 *     zonas da UF).
 *   - "br": arquivo agregado nacional (só existe para cargo 1 — Presidente).
 */
export type TargetNivel = "zona" | "uf" | "br";

export interface Target {
  uf: string;
  cargo: CargoTse;
  nivel: TargetNivel;
  /** Sentinel 0 quando `nivel !== "zona"` — ver comentário em `listIngestTargets`. */
  codMunicipioTse: number;
  /** Sentinel 0 quando `nivel !== "zona"` — ver comentário em `listIngestTargets`. */
  codZona: number;
  url: string;
  codEleicao: string;
}

// ---------------------------------------------------------------------------
// Base URL (host do CDN TSE — configurável)
// ---------------------------------------------------------------------------

/** Host de produção do CDN de resultados TSE. Sem barra final. */
const DEFAULT_TSE_BASE_URL = "https://resultados.tse.jus.br/oficial";

/**
 * getTseBaseUrl — resolve o host base do CDN TSE a partir de `TSE_BASE_URL`.
 *
 * Aceita:
 *   - Ausente → default de produção (`DEFAULT_TSE_BASE_URL`).
 *   - Qualquer URL `https:` (produção `resultados.tse.jus.br` ou o ambiente
 *     de simulado `resultados-sim.tse.jus.br`).
 *   - `http://localhost` ou `http://127.0.0.1` (qualquer porta) — exclusivo
 *     para apontar ao mock local (`scripts/tse-mock-server.ts`) em dev/testes.
 *   - Qualquer outro valor (ex.: `http://` para um host de produção real,
 *     ou um scheme desconhecido) → throw. Nunca aceitar `http://` puro para
 *     um host de produção evita downgrade silencioso de TLS.
 *
 * Barra final é removida (normaliza para o mesmo formato de
 * DEFAULT_TSE_BASE_URL) para que os builders de URL sempre concatenem com um
 * único `/` explícito.
 */
export function getTseBaseUrl(): string {
  const raw = process.env.TSE_BASE_URL;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TSE_BASE_URL;
  }

  const trimmed = raw.trim().replace(/\/$/, "");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `[targets] TSE_BASE_URL inválida: "${raw}" — não é uma URL válida. ` +
        `Use o default (produção), a URL do ambiente de simulado, ou http://localhost:<porta> para o mock.`,
    );
  }

  const isHttps = parsed.protocol === "https:";
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

  if (!isHttps && !isLocalHttp) {
    throw new Error(
      `[targets] TSE_BASE_URL inválida: "${raw}" — apenas https:// (produção/simulado) ou ` +
        `http://localhost|127.0.0.1 (mock local) são aceitos.`,
    );
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Helpers de formatação — compartilhados por todos os builders de URL
// ---------------------------------------------------------------------------

/** Extrai o segmento numérico de `codEleicao` (ex.: "ele2026/619" → "619") e
 *  zero-pad a 6 dígitos, conforme `e<ELEICA>` do dicionário de nomes
 *  (Instruções para download § 5). */
function formatEleicaoSuffix(codEleicao: string): string {
  const parts = codEleicao.split("/");
  const numericPart = parts[parts.length - 1] ?? codEleicao;
  return numericPart.padStart(6, "0");
}

function formatCargo(cargo: CargoTse): string {
  return String(cargo).padStart(4, "0");
}

function formatZona(codZona: number): string {
  return String(codZona).padStart(4, "0");
}

/** <código município> = 5 posições, zero-padded (Instruções § 5). */
function formatMunicipio(codMunicipioTse: number): string {
  return String(codMunicipioTse).padStart(5, "0");
}

// ---------------------------------------------------------------------------
// URL builders — um por tipo de arquivo (Instruções § 3 tabela "ID da Pasta 6"
// + EA20 § 2 + EA14/EA15 § 2)
// ---------------------------------------------------------------------------

/**
 * Arquivo de resultado unificado de ZONA ELEITORAL.
 * Formato confirmado: `<uf><município>-z<zona>-c<cargo>-e<eleição>-u.json`
 * Exemplo (EA20 § 2): `sp71072-z0001-c0003-e999999-u.json`
 */
export function buildEA20UrlZona(args: {
  codEleicao: string;
  uf: string;
  codMunicipioTse: number;
  codZona: number;
  cargo: CargoTse;
  baseUrl?: string;
}): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const ufLower = args.uf.toLowerCase();
  const munStr = formatMunicipio(args.codMunicipioTse);
  const fileName =
    `${ufLower}${munStr}-z${formatZona(args.codZona)}-c${formatCargo(args.cargo)}` +
    `-e${formatEleicaoSuffix(args.codEleicao)}-u.json`;

  return `${baseUrl}/${args.codEleicao}/dados/${ufLower}/${fileName}`;
}

/**
 * Arquivo de resultado unificado de MUNICÍPIO.
 * Formato confirmado: `<uf><município>-c<cargo>-e<eleição>-u.json`
 * Exemplo (EA20 § 2): `sp71072-c0003-e999999-u.json`
 */
export function buildEA20UrlMunicipio(args: {
  codEleicao: string;
  uf: string;
  codMunicipioTse: number;
  cargo: CargoTse;
  baseUrl?: string;
}): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const ufLower = args.uf.toLowerCase();
  const munStr = formatMunicipio(args.codMunicipioTse);
  const fileName = `${ufLower}${munStr}-c${formatCargo(args.cargo)}-e${formatEleicaoSuffix(args.codEleicao)}-u.json`;

  return `${baseUrl}/${args.codEleicao}/dados/${ufLower}/${fileName}`;
}

/**
 * Arquivo de resultado unificado de UF (agregado — todos os municípios/zonas
 * da UF em 1 arquivo).
 * Formato confirmado: `<uf>-c<cargo>-e<eleição>-u.json`
 * Exemplo (EA20 § 2): `sp-c0003-e999999-u.json`
 */
export function buildEA20UrlUf(args: {
  codEleicao: string;
  uf: string;
  cargo: CargoTse;
  baseUrl?: string;
}): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const ufLower = args.uf.toLowerCase();
  const fileName = `${ufLower}-c${formatCargo(args.cargo)}-e${formatEleicaoSuffix(args.codEleicao)}-u.json`;

  return `${baseUrl}/${args.codEleicao}/dados/${ufLower}/${fileName}`;
}

/**
 * Arquivo de resultado unificado do BRASIL (agregado nacional — só existe
 * para cargo Presidente, código 0001; EA20 § 2 tabela de cargos).
 * Formato confirmado: `br-c<cargo>-e<eleição>-u.json`
 * Exemplo (EA20 § 2): `br-c0003-e999999-u.json` (tabela usa 0003 como
 * exemplo genérico de formatação; na prática só 0001/Presidente existe em BR).
 */
export function buildEA20UrlBr(args: {
  codEleicao: string;
  cargo: CargoTse;
  baseUrl?: string;
}): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const fileName = `br-c${formatCargo(args.cargo)}-e${formatEleicaoSuffix(args.codEleicao)}-u.json`;

  return `${baseUrl}/${args.codEleicao}/dados/br/${fileName}`;
}

/**
 * Arquivo de acompanhamento BRASIL (EA14) — sem cargo no nome.
 * Formato confirmado: `br-e<eleição>-ab.json`
 */
export function buildEA14Url(args: { codEleicao: string; baseUrl?: string }): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const fileName = `br-e${formatEleicaoSuffix(args.codEleicao)}-ab.json`;

  return `${baseUrl}/${args.codEleicao}/dados/br/${fileName}`;
}

/**
 * Arquivo de acompanhamento por UF (EA15) — sem cargo no nome.
 * Formato confirmado: `<uf>-e<eleição>-ab.json`
 */
export function buildEA15Url(args: { codEleicao: string; uf: string; baseUrl?: string }): string {
  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const ufLower = args.uf.toLowerCase();
  const fileName = `${ufLower}-e${formatEleicaoSuffix(args.codEleicao)}-ab.json`;

  return `${baseUrl}/${args.codEleicao}/dados/${ufLower}/${fileName}`;
}

/**
 * buildEA20Url — mantido por compatibilidade com chamadores/testes
 * existentes. Delega para `buildEA20UrlZona` (mesma granularidade do
 * comportamento antigo), mas agora com o nome/ordem/sufixo CORRETOS.
 *
 * @deprecated Prefira os builders nomeados (`buildEA20UrlZona`,
 * `buildEA20UrlMunicipio`, `buildEA20UrlUf`, `buildEA20UrlBr`) em código novo
 * — a assinatura posicional aqui existe só para não quebrar call sites
 * antigos durante a migração.
 */
export function buildEA20Url(
  codEleicao: string,
  uf: string,
  codMunicipioTse: number,
  codZona: number,
  cargo: CargoTse,
  baseUrl: string = getTseBaseUrl(),
): string {
  return buildEA20UrlZona({ codEleicao, uf, codMunicipioTse, codZona, cargo, baseUrl });
}

// ---------------------------------------------------------------------------
// codEleicao loader
// ---------------------------------------------------------------------------

/**
 * Nome da env var específica de cada eleição — nunca a mesma para as duas,
 * e nunca usada para resolver a outra (ver `getCodEleicao`).
 */
const ENV_VAR_COD_ELEICAO: Record<Eleicao, string> = {
  federal: "TSE_COD_ELEICAO_FEDERAL",
  estadual: "TSE_COD_ELEICAO_ESTADUAL",
};

const COD_ELEICAO_REGEX = /^ele\d{4}\/\d+$/;

/**
 * Lê o código de eleição de UMA das duas eleições do pleito 2026 (parâmetros
 * publicados pelo TSE em 17/09/2026): a Eleição Federal (`21270`, só
 * Presidente) e a Eleição Estadual (`21272`, Governador/Senador/Deputado
 * Federal) — ver `lib/config/cargos.ts::Eleicao`. Throw explícito se ausente
 * ou com formato inválido — o pipeline não pode operar sem saber, com
 * certeza, qual eleição está sendo apurada (uma URL malformada apontando
 * para o TSE real pode disparar o bloqueio de IP por 10min descrito na FAQ
 * técnica do simulado).
 *
 * Formato exigido: `ele<AAAA>/<dígitos>` — ex.: "ele2026/21270",
 * "ele2026/21272". Confirmado contra o `ele-c.json` real (Instruções § 3 +
 * EA11 § 3): o path é `<ciclo>/<eleição>` — `ciclo` é literalmente a pasta
 * "ele<AAAA>" e `eleição` é o `pl[].e[].cd` numérico do EA11.
 *
 * Resolução, **por eleição** — a específica NUNCA supre a outra eleição:
 *   1. `TSE_COD_ELEICAO_FEDERAL` / `TSE_COD_ELEICAO_ESTADUAL` (a específica
 *      desta `eleicao`), se definida.
 *   2. Senão, `TSE_COD_ELEICAO` (legado, de quando o pleito tinha um único
 *      código) — supre qualquer uma das duas que esteja ausente, mas NUNCA
 *      as duas ao mesmo tempo com valores diferentes: é o mesmo valor legado
 *      para as duas, o que só faz sentido enquanto uma delas ainda não tem
 *      sua env específica configurada.
 *   3. Nenhuma das duas definida → throw. Setar só `TSE_COD_ELEICAO_FEDERAL`
 *      não dá à eleição estadual nenhum valor — ela lança do mesmo jeito.
 *      Autorizar essa travessia é exatamente o modo de falha "default
 *      silencioso em conversor de enum" que esta base já pagou 4 vezes (ver
 *      a nota em `parseWhitelist`): um cargo estadual buscando o EA20 sob o
 *      código federal é um 404 sistemático, não óbvio de diagnosticar.
 */
export function getCodEleicao(eleicao: Eleicao): string {
  const envVar = ENV_VAR_COD_ELEICAO[eleicao];
  const specific = process.env[envVar]?.trim();
  const legacy = process.env.TSE_COD_ELEICAO?.trim();

  const value = specific && specific !== "" ? specific : legacy;

  if (!value || value === "") {
    throw new Error(
      `[targets] Nem ${envVar} nem TSE_COD_ELEICAO (legado) estão definidas para a eleição ` +
        `"${eleicao}". Configure ${envVar} com o código desta eleição (ex.: ` +
        `"ele2026/21270" para federal, "ele2026/21272" para estadual), ou TSE_COD_ELEICAO ` +
        "como fallback temporário enquanto as duas envs específicas não existem.",
    );
  }

  if (!COD_ELEICAO_REGEX.test(value)) {
    throw new Error(
      `[targets] Código de eleição inválido para "${eleicao}" (via ${envVar} ou TSE_COD_ELEICAO): ` +
        `"${value}" — formato esperado "ele<AAAA>/<dígitos>" (ex.: "ele2026/21270"). Uma URL ` +
        "malformada pode disparar bloqueio de IP no TSE — corrija antes de retomar.",
    );
  }

  return value;
}

/**
 * Resolve o código de eleição de um CARGO — atalho sobre `getCodEleicao`
 * que evita o chamador ter de saber qual eleição cobre qual cargo
 * (`eleicaoDoCargo`, `lib/config/cargos.ts`). É este o caminho que
 * `listIngestTargets` usa; nenhum ponto do pipeline resolve `codEleicao` por
 * conta própria a partir de um cargo.
 */
export function getCodEleicaoDoCargo(cargo: CargoTse): string {
  return getCodEleicao(eleicaoDoCargo(cargo));
}

// ---------------------------------------------------------------------------
// Cargos ativos (env-configurável)
// ---------------------------------------------------------------------------

// Deriva da tabela canônica (`lib/config/cargos.ts`) em vez de repetir a lista:
// acrescentar um cargo lá passa a bastar, e não há como os dois divergirem.
const VALID_CARGOS = CARGOS_TSE;

/**
 * getActiveCargos — lê `TSE_CARGOS` do ambiente (default: "1,3").
 *
 * Formato: lista separada por vírgula de cargos suportados (1=Presidente,
 * 3=Governador). Tokens inválidos são ignorados com um warn (mesmo padrão
 * de tolerância de `parseWhitelist`); se nenhum token válido sobrar, cai no
 * default `[1, 3]`.
 *
 * Substitui o antigo array hardcoded `CARGOS_ATIVOS`/`ACTIVE_CARGOS` — usado
 * tanto por `buildProductionTargets` quanto pelo model-trigger em
 * `app/api/ingest/route.ts`.
 */
export function getActiveCargos(): Array<CargoTse> {
  // Default deliberadamente NÃO é "todos os cargos cobertos". Senador (5) e
  // Deputado Federal (6) têm crons próprios, com cadência distinta (ADR-0026
  // item 1); se entrassem no ciclo genérico de 60 s, um único ciclo pediria
  // ~4 × 6.110 ≈ 24.440 arquivos — os quatro cargos cobertos são "zona" desde
  // 2026-09-13 (Deputado Federal foi o último a migrar) — muito além do que
  // qualquer `TSE_MAX_RPS`/`maxDuration` permitido comporta numa invocação só.
  // Quem quer 5/6 pede pelo segmento de rota (`/api/ingest/senador`,
  // `/api/ingest/deputado-federal/<fatia>`), e aí `filterCargos` honra o pedido.
  // O mesmo vale para 7/8 (spec 027): `/api/ingest/deputado-estadual` e
  // `/api/ingest/deputado-distrital`, crons próprios — não entram aqui.
  const DEFAULT_CARGOS = "1,3";
  const raw = (process.env.TSE_CARGOS ?? DEFAULT_CARGOS).trim() || DEFAULT_CARGOS;

  const result: Array<CargoTse> = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const num = Number(trimmed);
    if (!isCargoTse(num)) {
      console.warn(
        `[targets] Cargo inválido "${trimmed}" em TSE_CARGOS — suportados: ${VALID_CARGOS.join(", ")}. Token ignorado.`,
      );
      continue;
    }
    if (!result.includes(num)) {
      result.push(num);
    }
  }

  if (result.length === 0) {
    console.warn("[targets] TSE_CARGOS não produziu nenhum cargo válido. Usando default [1, 3].");
    return [1, 3];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Granularidade (env-configurável)
// ---------------------------------------------------------------------------

const VALID_GRANULARIDADES = ["uf", "zona"] as const;
export type TseGranularidade = (typeof VALID_GRANULARIDADES)[number];

/**
 * getGranularidade — lê `TSE_GRANULARIDADE` do ambiente (default: "zona" desde 2026-09-05, E4).
 *
 * Decisão (2026-09-05, hardening pré-simulado): agora que se confirma a
 * existência de arquivos agregados de UF e Brasil (Divergência 3 do
 * diagnóstico pré-simulado — ver docs/reference/tse-2026-leiautes.md § fan-out),
 * o ciclo de ingestão NÃO precisa mais fazer ~2.600 zonas × cargo GETs por
 * ciclo para ter visão nacional/UF — 27 UFs × cargo (+ 1 BR para Presidente)
 * cobrem o mesmo dado agregado com ~28 GETs por cargo.
 *
 *   - "uf" (opt-in): 27 UFs × cargos ativos + 1 BR (só cargo 1). Cabe
 *     folgadamente no maxDuration/rate-limit. É o suficiente para as telas
 *     nacional/UF (specs 003/004).
 *   - "zona": granularidade completa (~2.600 zonas × cargos ativos). É a
 *     granularidade do modelo: a extrapolação do apurado projeta zona a zona
 *     (spec 002 RF-011/RF-012, ADR-0021) — ver recomendação de fan-out no
 *     relatório desta tarefa. NÃO usar como default em produção sem EA14/EA15 gating (Fase
 *     1b) ou o ciclo estoura o rate limit de 100 req/s.
 *
 * IMPORTANTE (limitação conhecida, não resolvida aqui): a tabela `snapshots`
 * (lib/db/schema.ts) tem `cod_zona: integer NOT NULL` como parte da chave de
 * dedup (`cargo, turno, uf, cod_zona`). Targets de nível "uf"/"br" usam os
 * sentinels `codZona=0` (e `uf="BR"` para o nacional) para caber no schema
 * atual SEM migração — `uf` sempre diferencia UFs reais entre si e de "BR",
 * e nenhuma zona real usa o código 0 (zonas começam em 0001), então não há
 * colisão. Essa é uma decisão pragmática de curto prazo — recomenda-se ADR
 * formal (coluna `nivel` dedicada) no hardening pós-simulado; ver relatório.
 */
export function getGranularidade(cargo?: CargoTse): TseGranularidade {
  // Default `zona` desde 2026-09-05 (decisão E4 do plano de projeção por regra
  // de três): o modelo precisa de dado por zona, e o modo `uf` está quebrado no
  // modelo (`eleitorado` não tem linha `(uf, 0)` → peso 0). `uf` segue aceito
  // como opt-in explícito para ciclos leves de diagnóstico.
  //
  // Desde 2026-09-11 (ADR-0026 item 1) o default é **por cargo**, não global.
  // Deputado Federal nasceu em `uf` (27 GETs/ciclo) e saiu para `zona` em
  // 2026-09-13 — mesmo diagnóstico de bootstrap que moveu o Senador em 11/09
  // (ver `CargoInfo.granularidade`, lib/config/cargos.ts). `TSE_GRANULARIDADE`
  // continua sobrepondo TUDO — é escotilha de diagnóstico, e por isso vem antes.
  const envRaw = process.env.TSE_GRANULARIDADE?.trim().toLowerCase();

  // Interruptor de emergência dos cargos PROPORCIONAIS. Nasceu (2026-09-13)
  // específico do cargo 6: reverte Deputado Federal a `uf` — e, por
  // consequência, à cadência de fato de antes (o fatiamento em
  // `listIngestTargets` só se aplica a granularidade "zona", então em "uf" cada
  // uma das 6 invocações por ciclo devolve o agregado completo de 27 UFs) —
  // sem tocar Presidente/Governador/Senador. Diferente de `TSE_GRANULARIDADE`,
  // que é global. Documentado em docs/operations/runbook.md § Variáveis de
  // ambiente. ⚠️ Exige novo deploy (variável de ambiente, ADR-0063 D4).
  //
  // Desde 2026-09-29 (spec 027) vale para TODO cargo proporcional (6, 7 e 8 —
  // `cargoInfo(c).proporcional`, lido da tabela). O nome fica, por ser o que o
  // runbook e o vigia conhecem. Na Fase 1 os cargos 7/8 já estão em `uf`, e
  // `=uf` não muda nada neles; quando a Fase 2 puser o 7 em zona fatiada, a
  // mesma chave reverte os dois deputados juntos — que é o que se quer num
  // incidente do pipeline fatiado, que é um só para os dois.
  const overrideDeputadoRaw =
    cargo !== undefined && cargoInfo(cargo).proporcional
      ? process.env.TSE_DEPUTADO_GRANULARIDADE?.trim().toLowerCase()
      : undefined;

  const padraoDoCargo = cargo !== undefined ? cargoInfo(cargo).granularidade : "zona";
  // Precedência: TSE_DEPUTADO_GRANULARIDADE (específica do cargo 6) >
  // TSE_GRANULARIDADE (global) > padrão do cargo. **O mais específico vence.**
  //
  // ⚠️ Invertido em 2026-09-13, no mesmo dia em que a ordem oposta foi escrita.
  // O motivo é concreto, não estético: `TSE_GRANULARIDADE=zona` está setada no
  // ambiente `preview` desde o armamento do simulado — e, com a ordem anterior,
  // ela **desativava em silêncio** o interruptor de emergência do cargo 6
  // justamente no único ambiente onde ele poderia ser testado antes de 04/10.
  // `TSE_GRANULARIDADE` é declarada no `lib/config/cargos.ts` como "escotilha de
  // diagnóstico, não configuração de produção"; um interruptor de incidente não
  // pode perder para uma escotilha de diagnóstico esquecida ligada.
  const raw = overrideDeputadoRaw || envRaw || padraoDoCargo;
  if ((VALID_GRANULARIDADES as readonly string[]).includes(raw)) {
    return raw as TseGranularidade;
  }
  console.warn(
    `[targets] TSE_GRANULARIDADE/TSE_DEPUTADO_GRANULARIDADE inválida: "${raw}" — valores aceitos: "uf" | "zona". Usando default "zona".`,
  );
  return "zona";
}

/** Sentinel de zona/município para targets de nível "uf"/"br" — ver nota em `getGranularidade`. */
const SENTINEL_ZONA_OU_MUNICIPIO = 0;

// A lista estática das 27 UFs que morava aqui (`TODAS_UFS`) foi para
// `lib/config/cargos.ts` em 2026-09-29 (`UFS_DA_ELEICAO`/`ufsDoCargo`): desde a
// spec 027 o conjunto de UFs de um cargo depende do cargo (o 7 não existe no
// DF, o 8 só existe lá), e quem responde isso é a tabela canônica. Continua
// estática — granularidade "uf" não consulta `zonas`.

// ---------------------------------------------------------------------------
// Whitelist parser (env preview)
// ---------------------------------------------------------------------------

/**
 * Formatos aceitos em TSE_TARGETS_WHITELIST:
 *   "SP:1"          → SP × cargo Presidente
 *   "SP:1,SP:3"     → SP × Presidente + SP × Governador
 *   "SP:1,RJ:1"     → SP e RJ × Presidente
 *   "SP:1,RJ:3,MG:1,MG:3" → múltiplas combinações
 *   "SP:5", "SP:6"  → Senador e Deputado Federal (ver correção abaixo)
 *
 * Se a variável estiver ausente ou inválida, usa o default "SP:1".
 *
 * ⚠️ **Correção 2026-09-13.** Até esta data a validação era literal —
 * `if (cargoNum !== 1 && cargoNum !== 3)` — escrita quando a eleição cobria
 * só dois cargos. Senador (5) e Deputado Federal (6) entraram em 2026-09-11
 * e a lista **nunca foi atualizada**: qualquer token `SP:5`/`SP:6` era
 * descartado com um `console.warn` que ninguém lê num cron. Como a whitelist
 * só vale no ambiente `preview` — que é o do simulado oficial do TSE —, o
 * efeito era que **os dois cargos novos não podiam ser exercitados no único
 * ambiente onde há chance de testá-los com dado real antes de 04/10**.
 *
 * É a **quarta** ocorrência da mesma família nesta base: constante literal de
 * cargo que envelheceu em silêncio quando a eleição cresceu de 2 para 4
 * cargos (ver a nota de `cargoFromTseNumeric` e a memória do projeto). A
 * validação agora deriva de `isCargoTse`, a fonte única em
 * `lib/config/cargos.ts` — acrescentar um cargo lá passa a bastar.
 */
function parseWhitelist(raw: string | undefined): Array<{ uf: string; cargo: CargoTse }> {
  const DEFAULT_WHITELIST = "SP:1";
  const input = (raw ?? DEFAULT_WHITELIST).trim() || DEFAULT_WHITELIST;

  const result: Array<{ uf: string; cargo: CargoTse }> = [];

  for (const token of input.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const [rawUf, rawCargo] = trimmed.split(":");
    if (!rawUf || !rawCargo) {
      console.warn(`[targets] Token inválido em TSE_TARGETS_WHITELIST: "${trimmed}" — ignorado.`);
      continue;
    }

    const uf = rawUf.trim().toUpperCase();
    const cargoNum = Number(rawCargo.trim());

    // Deriva de `isCargoTse` (fonte única, lib/config/cargos.ts) em vez de
    // listar cargos aqui — ver a correção de 2026-09-13 no docstring acima.
    if (!Number.isInteger(cargoNum) || !isCargoTse(cargoNum)) {
      console.warn(
        `[targets] Cargo inválido "${rawCargo}" em token "${trimmed}" — cargos cobertos: ${CARGOS_TSE.join(", ")}. Token ignorado.`,
      );
      continue;
    }

    result.push({ uf, cargo: cargoNum });
  }

  if (result.length === 0) {
    console.warn(
      "[targets] TSE_TARGETS_WHITELIST não produziu nenhum token válido. Usando default SP:1.",
    );
    result.push({ uf: "SP", cargo: 1 });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cache em memória (módulo-level, TTL 5min)
// ---------------------------------------------------------------------------

interface CacheEntry {
  targets: Target[];
  expiresAt: number;
}

/**
 * Chave do cache inclui `codigosPorCargo`, `baseUrl` e `granularidade` além
 * de `env` — sem isso, trocar `TSE_BASE_URL`/`TSE_GRANULARIDADE` (ex.: para
 * apontar ao mock local em dev, ou para alternar uf↔zona) reaproveitaria
 * targets construídos com a config antiga até o TTL expirar, silenciosamente.
 *
 * `codigosPorCargo` — não mais um único `codEleicao` — porque desde
 * 2026-09-17 (parâmetros do TSE 2026) cada cargo pode resolver um código de
 * eleição DIFERENTE (federal para Presidente, estadual para os outros três;
 * ver `lib/config/cargos.ts::eleicaoDoCargo`). É a string
 * `"<cargo>:<codEleicao>,<cargo>:<codEleicao>,..."` de TODOS os cargos do
 * ciclo — trocar só `TSE_COD_ELEICAO_ESTADUAL` precisa invalidar o cache dos
 * cargos estaduais sem tocar no cache do Presidente, e vice-versa.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function cacheKey(
  env: "preview" | "production",
  codigosPorCargo: string,
  baseUrl: string,
  granularidade: string,
  cargoFiltro: CargoTse | undefined,
  fatia: { indice: number; total: number } | undefined,
): string {
  // `fatia` PRECISA compor a chave: sem isso, a fatia 1 do cargo 6 (chamada
  // dentro do mesmo TTL de 5min que a fatia 2) reaproveitaria o cache da
  // fatia 1 pra responder à fatia 2 — cada invocação varreria sempre o
  // mesmo sexto do país, o mesmo modo de falha do default silencioso em
  // conversor de enum que esta base já pagou 3 vezes.
  const fatiaChave = fatia ? `${fatia.indice}/${fatia.total}` : "all";
  return `${env}|${codigosPorCargo}|${baseUrl}|${granularidade}|${cargoFiltro ?? "all"}|${fatiaChave}`;
}

/**
 * clearTargetsCache — limpa o cache em memória do módulo.
 *
 * Uso: testes que trocam `TSE_BASE_URL`/`TSE_COD_ELEICAO`/`TSE_TARGETS_WHITELIST`/
 * `TSE_GRANULARIDADE` entre casos e precisam de uma lista de targets
 * recém-materializada, e scripts de longa duração (ex.: `tse-watch.ts`) que
 * trocam de ambiente em runtime sem reiniciar o processo.
 */
export function clearTargetsCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// listIngestTargets (função principal)
// ---------------------------------------------------------------------------

export interface ListIngestTargetsOptions {
  /**
   * Restringe os alvos a um único cargo. `undefined` (default) mantém o
   * comportamento anterior: todos os cargos ativos (`getActiveCargos()` /
   * `TSE_CARGOS`).
   *
   * Usado pelo cron por cargo (ADR-0035 D3, `app/api/ingest/[cargo]/route.ts`):
   * cada invocação do cron cobre só um cargo, então nunca precisa enumerar
   * o outro. Quando `cargo` não está entre os cargos ativos (`TSE_CARGOS`),
   * o resultado é uma lista vazia — não há fallback silencioso para "todos".
   */
  cargo?: CargoTse;
  /**
   * Restringe os alvos DESTE cargo a uma fatia de um total de `total`,
   * quando a granularidade EFETIVA do cargo (após `getGranularidade`, que já
   * aplica o interruptor `TSE_DEPUTADO_GRANULARIDADE`) é `"zona"`. Ignorado
   * silenciosamente para cargos resolvidos em `"uf"` — fatiar um agregado de
   * 27 alvos não faz sentido, e a regra explícita é "sem fatia, ou cargo em
   * uf, o comportamento não muda".
   *
   * `indice` é 1-based (`1..total`). Introduzido para o cron do cargo 6
   * (`/api/ingest/deputado-federal/<indice>`, ADR-0026 emenda 2026-09-13):
   * ~6.110 alvos a 5 rps levariam ~1.222 s numa invocação só, acima do
   * `maxDuration` de 300 s — divididos em 6 fatias de ~1.019 alvos (~204 s
   * cada), a varredura completa leva 30 min. Ver `sliceTargets` para o
   * contrato de cobertura/disjunção.
   */
  fatia?: { indice: number; total: number };
}

/**
 * Retorna a lista materializada de targets para o ciclo de ingestão.
 *
 * @param env
 *   - 'preview'    → whitelist via TSE_TARGETS_WHITELIST (default: SP × Presidente).
 *   - 'production' → todas as UFs (ou zonas, conforme `TSE_GRANULARIDADE`) × cargos ativos.
 * @param opts.cargo — restringe a um único cargo (ver `ListIngestTargetsOptions`).
 * @param opts.fatia — restringe a uma fatia do cargo, só quando ele resolve
 *   para granularidade "zona" (ver `ListIngestTargetsOptions.fatia`).
 *
 * Cache por 5 minutos no estado do módulo — Fluid Compute reutiliza instâncias,
 * evitando N queries ao Neon por ciclo de 60s. Chave do cache inclui
 * `codEleicao`, o host base (`TSE_BASE_URL`), a granularidade, o cargo e a
 * fatia — ver `cacheKey`.
 *
 * Cobre: RF-001 (descoberta de endpoints), decisão D-4 (whitelist preview).
 */
export async function listIngestTargets(
  env: "preview" | "production",
  opts: ListIngestTargetsOptions = {},
): Promise<Target[]> {
  const baseUrl = getTseBaseUrl();
  const cargoFiltro = opts.cargo;

  // Cada cargo tem sua granularidade (ADR-0026 item 1, emendado em
  // 2026-09-13 para o cargo 6): Presidente, Governador, Senador e Deputado
  // Federal em zona — Deputado tem o interruptor de emergência
  // `TSE_DEPUTADO_GRANULARIDADE` (ver `getGranularidade`). O ciclo é montado
  // cargo a cargo e concatenado — um ciclo de `/api/ingest` com
  // `TSE_CARGOS=1,3,5,6` produziria ~4 × 6.110 ≈ 24.440 alvos, por isso o
  // default de `getActiveCargos` continua excluindo 5 e 6 (ver comentário lá).
  const cargosDoCiclo = filterCargos(getActiveCargos(), cargoFiltro);
  const assinaturaGranularidade = cargosDoCiclo.map((c) => `${c}:${getGranularidade(c)}`).join(",");
  // Desde 2026-09-17 (parâmetros do TSE 2026) cada cargo resolve o SEU
  // próprio código de eleição — federal para Presidente, estadual para os
  // outros três (`getCodEleicaoDoCargo`). Resolvido AQUI, antes do loop, só
  // para compor a chave do cache com `cargo:código` de cada cargo do ciclo —
  // o loop abaixo resolve de novo por cargo (barato: é leitura de env, não
  // I/O), mantendo cada builder isolado a um único código.
  const codigosPorCargo = cargosDoCiclo.map((c) => `${c}:${getCodEleicaoDoCargo(c)}`).join(",");
  const key = cacheKey(
    env,
    codigosPorCargo,
    baseUrl,
    assinaturaGranularidade,
    cargoFiltro,
    opts.fatia,
  );

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.targets;
  }

  const targets: Target[] = [];
  for (const cargo of cargosDoCiclo) {
    const codEleicao = getCodEleicaoDoCargo(cargo);
    const granularidade = getGranularidade(cargo);
    let targetsDoCargo: Target[];
    if (env === "preview") {
      targetsDoCargo =
        granularidade === "zona"
          ? await buildPreviewTargetsZona(codEleicao, baseUrl, cargo)
          : buildPreviewTargetsUf(codEleicao, baseUrl, cargo);
    } else {
      targetsDoCargo =
        granularidade === "zona"
          ? await buildProductionTargetsZona(codEleicao, baseUrl, cargo)
          : buildProductionTargetsUf(codEleicao, baseUrl, cargo);
    }

    // RF-199 (spec 021) — o agregado que o próprio TSE publica (targets
    // "uf"/"br") se SOMA aos de zona em produção, sempre — nunca os
    // substitui, e não depende de `TSE_GRANULARIDADE` (que continua
    // proibida no dia D, `scripts/vigia-armado.ts`). Só entra quando a
    // granularidade efetiva do cargo já é "zona" — quando é "uf" (via
    // `TSE_GRANULARIDADE=uf`/`TSE_DEPUTADO_GRANULARIDADE=uf`), o branch
    // acima JÁ devolveu o agregado, e somar de novo duplicaria as 27 UFs.
    //
    // Entra ANTES do fatiamento, de propósito: assim o cargo 6 particiona os
    // 27 (+1 BR só para cargo 1) alvos agregados junto com os de zona, pela
    // MESMA garantia de `sliceTargets` (cobertura exata, disjunção par a
    // par, estabilidade) — sem tratamento especial por cargo. O custo é
    // pequeno e concentrado numa única fatia por rodada, não multiplicado
    // pelas 6 invocações do cron fatiado.
    // Fatiamento só é válido em granularidade "zona" (ver docstring de
    // `ListIngestTargetsOptions.fatia`) — um cargo resolvido em "uf" (padrão
    // ou via `TSE_DEPUTADO_GRANULARIDADE=uf`) ignora `opts.fatia` por
    // completo e devolve o agregado inteiro, sem mudança de comportamento.
    if (opts.fatia !== undefined && granularidade === "zona") {
      targetsDoCargo = sliceTargets(targetsDoCargo, opts.fatia.indice, opts.fatia.total);
    }

    // 🔴 04/10/2026 18h20 — o agregado entra DEPOIS do fatiamento: as 27 UFs
    // em TODA fatia (+27 GETs a cada 5 min), não numa só a cada 30 min. O
    // `% apurado` oficial exibido no Deputado sai deste arquivo.
    if (env === "production" && granularidade === "zona") {
      targetsDoCargo = [...targetsDoCargo, ...buildProductionTargetsUf(codEleicao, baseUrl, cargo)];
    }

    targets.push(...targetsDoCargo);
  }

  cache.set(key, { targets, expiresAt: now + CACHE_TTL_MS });
  return targets;
}

// ---------------------------------------------------------------------------
// Fatiamento determinístico — cron do cargo 6 por fatia (ADR-0026, emenda
// 2026-09-13)
// ---------------------------------------------------------------------------

/**
 * Chave canônica e estável de um target — usada para ORDENAR antes de
 * fatiar. Não pode depender da ordem em que o Postgres devolve as linhas: a
 * query de `zonas` em `buildProductionTargetsZona` não tem `ORDER BY`, e o
 * Postgres não garante ordem estável sem um. Sem esta chave, "a fatia 3 de
 * agora" poderia não ser "a fatia 3 de daqui a 5 minutos" — a atribuição
 * dependeria de um acidente do plano de execução do banco, não da
 * identidade do target.
 */
function chaveCanonicaDoTarget(t: Pick<Target, "uf" | "codMunicipioTse" | "codZona">): string {
  return `${t.uf}|${String(t.codMunicipioTse).padStart(6, "0")}|${String(t.codZona).padStart(5, "0")}`;
}

/**
 * sliceTargets — particiona `targets` em `numFatias` fatias quase iguais, de
 * forma determinística e estável entre invocações.
 *
 * Contrato (provado em targets.test.ts por mutação, não só por leitura):
 *   - **Cobertura exata**: a união de TODAS as fatias (`1..numFatias`) é
 *     exatamente `targets` — sem sobra.
 *   - **Disjunção par a par**: nenhum target aparece em mais de uma fatia.
 *   - **Estabilidade**: a fatia de um target depende só da SUA identidade
 *     (`uf`, `codMunicipioTse`, `codZona`) — nunca da posição em que chegou
 *     no array de entrada. Embaralhar `targets` antes de chamar não muda o
 *     resultado.
 *
 * `fatia` é 1-based (`1..numFatias`) — espelha o segmento de rota
 * `/api/ingest/deputado-federal/<fatia>`. Uma fatia fora de faixa lança em
 * vez de degradar silenciosamente para a fatia 1 — uma fatia inválida caindo
 * num default varreria sempre o mesmo sexto do país, o mesmo modo de falha
 * do default silencioso em conversor de enum que esta base já pagou 3 vezes.
 */
export function sliceTargets(
  targets: readonly Target[],
  fatia: number,
  numFatias: number,
): Target[] {
  if (!Number.isInteger(numFatias) || numFatias < 1) {
    throw new Error(`[targets] sliceTargets: numFatias inválido (${numFatias})`);
  }
  if (!Number.isInteger(fatia) || fatia < 1 || fatia > numFatias) {
    throw new Error(`[targets] sliceTargets: fatia ${fatia} fora de 1..${numFatias}`);
  }

  const ordenados = [...targets].sort((a, b) => {
    const ka = chaveCanonicaDoTarget(a);
    const kb = chaveCanonicaDoTarget(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const n = ordenados.length;
  const base = Math.floor(n / numFatias);
  const resto = n % numFatias;
  // As primeiras `resto` fatias levam 1 alvo a mais, pra distribuir o resto
  // sem deixar uma única fatia desproporcionalmente maior que as outras
  // (6.110 / 6 = 1.018,33 → 2 fatias de 1.019 + 4 fatias de 1.018).
  const indiceZeroBased = fatia - 1;
  const start = indiceZeroBased * base + Math.min(indiceZeroBased, resto);
  const tamanho = base + (indiceZeroBased < resto ? 1 : 0);

  return ordenados.slice(start, start + tamanho);
}

// ---------------------------------------------------------------------------
// Targets — granularidade "uf" (opt-in; default é "zona")
// ---------------------------------------------------------------------------

function buildUfTarget(uf: string, cargo: CargoTse, codEleicao: string, baseUrl: string): Target {
  return {
    uf,
    cargo,
    nivel: "uf",
    codMunicipioTse: SENTINEL_ZONA_OU_MUNICIPIO,
    codZona: SENTINEL_ZONA_OU_MUNICIPIO,
    url: buildEA20UrlUf({ codEleicao, uf, cargo, baseUrl }),
    codEleicao,
  };
}

function buildBrTarget(cargo: CargoTse, codEleicao: string, baseUrl: string): Target {
  return {
    uf: "BR",
    cargo,
    nivel: "br",
    codMunicipioTse: SENTINEL_ZONA_OU_MUNICIPIO,
    codZona: SENTINEL_ZONA_OU_MUNICIPIO,
    url: buildEA20UrlBr({ codEleicao, cargo, baseUrl }),
    codEleicao,
  };
}

/**
 * filterCargos — resolve quais cargos um ciclo cobre.
 *
 * `cargoFiltro === undefined` é o ciclo genérico (`/api/ingest`): devolve os
 * cargos ativos como estão. O default de `TSE_CARGOS` é `"1,3"` de propósito —
 * ver `getActiveCargos`.
 *
 * `cargoFiltro` definido é o ciclo por cargo (`/api/ingest/[cargo]`, o caminho
 * do cron de produção desde ADR-0035 D3). Aí **o próprio segmento de rota é a
 * autorização**: pedir `/api/ingest/senador` já diz qual cargo ingerir, e exigir
 * que ele também estivesse em `TSE_CARGOS` faria o cron de Senador rodar e não
 * ingerir nada, em silêncio — exatamente o modo de falha que esta base já pagou
 * caro três vezes.
 *
 * `TSE_CARGOS` continua valendo como **chave de desligamento**: quando definida
 * explicitamente no ambiente, um cargo fora dela é barrado mesmo que a rota o
 * peça. É como se desliga um cargo em produção sem mexer em `vercel.ts`.
 */
function filterCargos(
  cargosAtivos: ReadonlyArray<CargoTse>,
  cargoFiltro: CargoTse | undefined,
): Array<CargoTse> {
  if (cargoFiltro === undefined) return [...cargosAtivos];

  const killSwitchAtivo = (process.env.TSE_CARGOS ?? "").trim() !== "";
  if (killSwitchAtivo) {
    return cargosAtivos.filter((c) => c === cargoFiltro);
  }
  return [cargoFiltro];
}

/**
 * Preview, granularidade "uf": 1 target por entrada da whitelist para ESTE
 * cargo — sem tocar o DB (a lista de UFs vem literalmente da whitelist, não
 * de `zonas`).
 *
 * `cargo` é obrigatório (desde 2026-09-17): cada cargo pode resolver um
 * `codEleicao` diferente (federal vs estadual), então esta função nunca
 * pode varrer "todos os cargos ativos" sob um único código — quem decide o
 * conjunto de cargos do ciclo é `listIngestTargets`, chamando esta função
 * UMA VEZ por cargo, cada vez com o código certo.
 */
function buildPreviewTargetsUf(codEleicao: string, baseUrl: string, cargo: CargoTse): Target[] {
  const whitelist = whitelistDoCargo(cargo);
  return whitelist.map(({ uf }) => buildUfTarget(uf, cargo, codEleicao, baseUrl));
}

/**
 * As entradas da whitelist de preview para ESTE cargo, só nas UFs em que a
 * corrida dele existe (`ufsDoCargo`, spec 027 RF-278). Um `DF:7` ou `SP:8`
 * digitado no ambiente seria um endereço que o TSE não publica — 404 a cada
 * rodada, que conta para o bloqueio de IP (constituição § 1). Sai com `warn`,
 * como qualquer outro token inválido da whitelist.
 */
function whitelistDoCargo(cargo: CargoTse): Array<{ uf: string; cargo: CargoTse }> {
  const doCargo = parseWhitelist(process.env.TSE_TARGETS_WHITELIST).filter(
    (entry) => entry.cargo === cargo,
  );
  const validas = doCargo.filter((entry) => cargoExisteNaUf(cargo, entry.uf));
  for (const entry of doCargo) {
    if (!validas.includes(entry)) {
      console.warn(
        `[targets] TSE_TARGETS_WHITELIST: "${entry.uf}:${cargo}" — o cargo ${cargo} não existe ` +
          `nessa UF (${cargoInfo(cargo).label}). Token ignorado.`,
      );
    }
  }
  return validas;
}

/**
 * Produção, granularidade "uf": um alvo por UF EM QUE O CARGO EXISTE
 * (`ufsDoCargo` — 27 para os cargos 1/3/5/6, 26 sem o DF para o 7, só o DF
 * para o 8; spec 027 RF-278) + 1 BR quando o cargo é Presidente (único cargo
 * com arquivo de abrangência Brasil, EA20 § 2 tabela de cargos).
 *
 * É o modo PADRÃO dos cargos 7/8 na Fase 1 (ADR-0067) e, para os demais, o
 * agregado aditivo do RF-199 somado aos alvos de zona.
 *
 * `cargo` é obrigatório pelo mesmo motivo de `buildPreviewTargetsUf` acima —
 * ver o comentário lá.
 */
function buildProductionTargetsUf(codEleicao: string, baseUrl: string, cargo: CargoTse): Target[] {
  const targets: Target[] = [];

  for (const uf of ufsDoCargo(cargo)) {
    targets.push(buildUfTarget(uf, cargo, codEleicao, baseUrl));
  }

  if (cargo === 1) {
    targets.push(buildBrTarget(1, codEleicao, baseUrl));
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Targets — granularidade "zona" (unidade da regra de três do modelo)
// ---------------------------------------------------------------------------

async function buildPreviewTargetsZona(
  codEleicao: string,
  baseUrl: string,
  cargo: CargoTse,
): Promise<Target[]> {
  const whitelist = whitelistDoCargo(cargo);

  const targets: Target[] = [];

  for (const { uf } of whitelist) {
    const zonas = await db
      .select({
        codZona: schema.zonas.codZona,
        codMunicipioTse: schema.zonas.codMunicipioTse,
        uf: schema.zonas.uf,
      })
      .from(schema.zonas)
      .where(eq(schema.zonas.uf, uf));

    for (const zona of zonas) {
      targets.push({
        uf: zona.uf,
        cargo,
        nivel: "zona",
        codMunicipioTse: zona.codMunicipioTse,
        codZona: zona.codZona,
        url: buildEA20UrlZona({
          codEleicao,
          uf: zona.uf,
          codMunicipioTse: zona.codMunicipioTse,
          codZona: zona.codZona,
          cargo,
          baseUrl,
        }),
        codEleicao,
      });
    }
  }

  return targets;
}

/**
 * Em produção: todos os pares (uf, cod_municipio_tse, cod_zona) de `zonas` ×
 * ESTE cargo (ADR-0035 D3, cron por cargo).
 *
 * `cargo` é obrigatório (desde 2026-09-17): o `codEleicao` recebido vale para
 * um único cargo — federal para Presidente, estadual para os outros três —, e
 * varrer aqui uma lista de cargos publicaria os demais sob o código errado.
 * Quem decide o conjunto de cargos do ciclo é `listIngestTargets`
 * (`filterCargos`), chamando esta função uma vez por cargo.
 *
 * Só as zonas das UFs em que o cargo EXISTE (`ufsDoCargo`, spec 027 RF-278):
 * a tabela `zonas` não depende de cargo e tem as ~6.110 do país, mas o cargo 8
 * só tem arquivo no DF e o 7 não tem no DF. Sem este filtro, um cargo 8 em
 * zona pediria ~6.090 endereços que não existem por rodada. O filtro é em
 * JavaScript, não num `WHERE`, de propósito: a consulta continua a mesma para
 * todo cargo, e a regra fica num lugar só (a tabela de cargos).
 */
async function buildProductionTargetsZona(
  codEleicao: string,
  baseUrl: string,
  cargo: CargoTse,
): Promise<Target[]> {
  const todas = await db
    .select({
      codZona: schema.zonas.codZona,
      codMunicipioTse: schema.zonas.codMunicipioTse,
      uf: schema.zonas.uf,
    })
    .from(schema.zonas);
  const zonas = todas.filter((z) => cargoExisteNaUf(cargo, z.uf));

  const targets: Target[] = [];

  for (const zona of zonas) {
    targets.push({
      uf: zona.uf,
      cargo,
      nivel: "zona",
      codMunicipioTse: zona.codMunicipioTse,
      codZona: zona.codZona,
      url: buildEA20UrlZona({
        codEleicao,
        uf: zona.uf,
        codMunicipioTse: zona.codMunicipioTse,
        codZona: zona.codZona,
        cargo,
        baseUrl,
      }),
      codEleicao,
    });
  }

  return targets;
}
