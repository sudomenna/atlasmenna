/**
 * lib/config/cargos.ts
 *
 * **Mapa único dos cargos cobertos pelo SalaCofre.** Antes de 2026-09-11 esse
 * conhecimento estava espalhado por quatro lugares independentes, todos travados
 * em `1 | 3` e sem relação entre si:
 *
 *   - `lib/tse/targets.ts` — `Target.cargo`, `VALID_CARGOS`, `getActiveCargos`,
 *     `formatCargo`, `parseWhitelist` (código numérico do TSE);
 *   - `lib/edge-config/types.ts` — `Cargo = 1 | 3` (código numérico, no payload);
 *   - `lib/config/calendar.ts` — `Cargo = "pres" | "gov"` (token de chave, ADR-0012);
 *   - `app/api/ingest/[cargo]/route.ts` — `parseCargoSegment`, o único lugar que
 *     mapeava slug de URL para código.
 *
 * Estender a cobertura para Senador e Deputado Federal (ADR-0026) exigiria editar
 * os quatro em sincronia, sem nada que forçasse a sincronia. Este módulo é a
 * fonte única; os outros passam a derivar dele.
 *
 * Desde 2026-09-29 (spec 027, ADR-0066) a tabela cobre SEIS cargos: os quatro
 * de antes mais Deputado Estadual (7, 26 Assembleias) e Deputado Distrital (8,
 * Câmara Legislativa do DF). O que é novo além das linhas: a abrangência por
 * cargo (`ufsDoCargo` — o 7 não existe no DF, o 8 só existe lá) e o tipo
 * `CargoProporcional`, derivado das linhas com `proporcional: true`.
 *
 * ## O que NÃO muda
 *
 * Os **dois tipos `Cargo`** continuam separados de propósito (ADR-0026 item 2,
 * ADR-0028 item 2): o numérico (`CargoTse`) espelha o TSE e viaja no payload; o
 * de token (`lib/config/calendar.ts`) nomeia chaves do Global Config e caminhos
 * do Blob. Este módulo não os funde — dá o conversor explícito (`cargoToken`,
 * `cargoFromToken`) que antes não existia.
 *
 * Constituição § 9: nenhum I/O aqui. Tabela estática, funções puras.
 */

import type { Cargo as CargoToken } from "@/lib/config/calendar";

/**
 * Código numérico do cargo, como o TSE publica (campo `cd` em `carg[]` do EA20,
 * e o `-c<cargo4>` no nome do arquivo).
 *
 * 1 = Presidente · 3 = Governador · 5 = Senador · 6 = Deputado Federal ·
 * 7 = Deputado Estadual · 8 = Deputado Distrital.
 *
 * Os códigos 2 (Vice-Presidente) e 4 (Vice-Governador) existem no TSE e **não**
 * são cobertos: vice não tem votação própria.
 *
 * **7 e 8 entraram em 2026-09-29** (spec 027, ADR-0066). Até então as
 * assembleias estavam declaradas "fora do escopo do produto"; o dono pediu a
 * apuração das 26 Assembleias Legislativas (cargo 7) e da Câmara Legislativa do
 * DF (cargo 8, cargo SEPARADO no TSE) para 04/10. Moram na mesma eleição do
 * TSE que o federal (estadual, `21272`), com o mesmo leiaute "Proporcional | UF".
 * O que os distingue do 6 aqui é a abrangência (`ufsDoCargo`): o 7 não existe
 * no DF e o 8 só existe no DF.
 */
export type CargoTse = 1 | 3 | 5 | 6 | 7 | 8;

/**
 * Onde a corrida deste cargo acontece — quais UFs têm arquivo dele no TSE
 * (spec 027 RF-278, ADR-0066).
 *
 *   - `"todas-as-ufs"` — as 27 (Presidente, Governador, Senador, Deputado
 *     Federal; o DF elege governador, senadores e deputados federais);
 *   - `"ufs-sem-df"`   — as 26 UFs com Assembleia Legislativa (cargo 7): o DF
 *     não tem deputado **estadual**;
 *   - `"so-df"`        — só o DF (cargo 8, a Câmara Legislativa).
 *
 * Existe porque, sem ela, a enumeração de alvos pediria ao TSE o arquivo do
 * cargo 8 para as 26 UFs que não o têm (e o do 7 para o DF): endereços que não
 * existem, a cada rodada — 404 que também conta para o bloqueio de IP
 * (constituição § 1).
 */
export type Abrangencia = "todas-as-ufs" | "ufs-sem-df" | "so-df";

/**
 * Qual das DUAS eleições do pleito 2026 cobre este cargo (parâmetros
 * publicados pelo TSE em 17/09/2026, véspera do simulado): a Eleição
 * Federal (código `21270`) elege só o Presidente; a Eleição Estadual
 * (código `21272`) elege Governador, Senador e Deputado Federal. Os dois
 * códigos vivem no MESMO `codEleicao` (`ele<AAAA>/<dígitos>`, ver
 * `lib/tse/targets.ts::getCodEleicao`) — não são turnos nem ambientes, são
 * duas árvores de URL paralelas no CDN (`.../ele2026/21270/dados/...` vs
 * `.../ele2026/21272/dados/...`), inclusive para o EA14 de acompanhamento
 * (um `br-e021270-ab.json`, outro `br-e021272-ab.json`).
 */
export type Eleicao = "federal" | "estadual";

/** Metadados de um cargo coberto. */
export interface CargoInfo {
  /** Código do TSE. */
  readonly cd: CargoTse;
  /**
   * Eleição (no sentido do pleito 2026, ver `Eleicao`) a que este cargo
   * pertence — determina qual código de eleição resolver
   * (`getCodEleicaoDoCargo`, `lib/tse/targets.ts`). Presidente é o único
   * cargo `"federal"`; todos os outros são `"estadual"` (inclusive o Deputado
   * FEDERAL e os cargos 7/8 — o nome da eleição é do TSE, não da casa). Campo obrigatório
   * de propósito: não há valor "neutro" que sirva de default seguro — um
   * cargo estadual lido como federal (ou vice-versa) busca o EA20 do CÓDIGO
   * DE ELEIÇÃO ERRADO, um 404 sistemático que não é óbvio de diagnosticar.
   */
  readonly eleicao: Eleicao;
  /** Token de namespacing de chave (Global Config / Blob) — ADR-0012. */
  readonly token: CargoToken;
  /** Segmento de rota aceito por `/api/ingest/[cargo]` e pelas páginas. */
  readonly slug: string;
  /** Rótulo para leitor humano. */
  readonly label: string;
  /**
   * Vagas em disputa por UF. Presidente e Governador elegem 1 por abrangência;
   * o Senado renova **2/3** em 2026, o que são **2 vagas por UF** (54 no total)
   * — não 1, apesar de o kit de UI rotular "1 vaga"
   * (ver `docs/architecture/adrs/0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md`).
   * Os três cargos proporcionais (6, 7, 8) ficam `null`: o nº de cadeiras varia
   * por UF (federal 8 a 70; assembleias 24 a 94; distrital 24) e vem do próprio
   * arquivo do TSE (`carg[].nv`, RF-124), nunca desta tabela.
   */
  readonly vagasPorUf: number | null;
  /** `true` quando a disputa admite 2º turno. Senador e Deputado são turno único. */
  readonly temSegundoTurno: boolean;
  /**
   * `true` só para Presidente: é o único cargo com arquivo agregado nacional
   * (`br-c0001-...`) no CDN do TSE. Os demais só têm UF/município/zona, e o
   * agregado nacional deles é soma nossa.
   */
  readonly temArquivoBr: boolean;
  /**
   * `true` quando o cargo é proporcional (votos viram cadeiras via quociente).
   * É deste campo que derivam `CargoProporcional`, `isCargoProporcional` e o
   * `CargoMajoritario` do leitor (`lib/edge-config/reader.ts`) — nunca de uma
   * lista de códigos repetida em outro arquivo.
   */
  readonly proporcional: boolean;
  /** Quais UFs têm esta corrida — ver {@link Abrangencia} e {@link ufsDoCargo}. */
  readonly abrangencia: Abrangencia;
  /**
   * Granularidade de ingestão **padrão** deste cargo (ADR-0026 item 1).
   *
   * `"zona"` (~6.110 pares por cargo) é o que o estimador precisa para a
   * regra de três (ADR-0021, RF-011/012) — é o modo de Presidente e
   * Governador, e desde 2026-09-11 também de Senador e Deputado Federal.
   *
   * **Senador saiu de `"uf"` para `"zona"` em 2026-09-11**, emendando o
   * ADR-0026 item 1. Motivo medido: com um único boletim por estado, o bootstrap
   * do estimador tem uma só unidade de reamostragem — as 1.000 réplicas saem
   * idênticas, o IC95 fecha num ponto e `p_eleito` degenera para 0% ou 100%.
   * Verificado à parte: 1 observação produz **1** réplica distinta; 3 produzem
   * 10. Exibir aquilo como probabilidade afirmaria certeza que o modelo não tem
   * (constituição § 6), e a alternativa era publicar o cargo sem chance de
   * eleição. Decisão do usuário, com o custo aceito de baixar os três cargos
   * pesados de 35 para 25 rps.
   *
   * **Deputado Federal saiu de `"uf"` para `"zona"` em 2026-09-13**, mesmo
   * diagnóstico (ADR-0026, nota "2026-09-11 (b)"): um único arquivo por UF só
   * dá ao bootstrap do RF-127 uma unidade de reamostragem, e o IC95 degenera
   * do mesmo jeito. A diferença para o Senador é o volume: ~6.110 alvos a
   * `rpsMax=5` (ver abaixo) levariam ~1.222 s numa invocação só, muito acima
   * do `maxDuration` de 300 s — por isso a varredura é dividida em 6 fatias
   * (`/api/ingest/deputado-federal/<1..6>`, `sliceTargets` em
   * `lib/tse/targets.ts`), cada uma cobrindo ~1/6 do fan-out (~1.019 alvos,
   * ~204 s), disparadas a cada 5 min — a volta completa das 6 fatias leva
   * 30 min. Chave de emergência específica deste cargo — que EXIGE novo
   * deploy (variável de ambiente só chega a um deployment novo; corrigido em
   * 29/09, ADR-0063 D4): `TSE_DEPUTADO_GRANULARIDADE=uf`
   * (`lib/tse/targets.ts::getGranularidade`, documentado em
   * `docs/operations/runbook.md` § Variáveis de ambiente).
   *
   * **Deputado Estadual (7) e Distrital (8) nascem em `"uf"` (2026-09-29,
   * Fase 1 da spec 027, ADR-0067).** Um arquivo-resumo por casa — 26 alvos
   * para o 7, 1 (o DF) para o 8, sem arquivo `br-` —, o que entrega cadeiras
   * por partido na parcial, listas, marcas e Conferência sem tocar no ritmo do
   * federal. A Fase 2 (zona fatiada, intercalada com o 6) é outra entrega; se
   * ela subir, é aqui que o 7 muda para `"zona"`. Em `"uf"` o fatiamento e o
   * agregado aditivo do RF-199 não se aplicam (`listIngestTargets`).
   *
   * `TSE_DEPUTADO_GRANULARIDADE` (a chave de emergência que nasceu para o
   * cargo 6) vale desde 2026-09-29 para os TRÊS proporcionais — ver
   * `getGranularidade`, `lib/tse/targets.ts`.
   *
   * `TSE_GRANULARIDADE` no ambiente sobrepõe isto para TODOS os cargos —
   * é escotilha de diagnóstico, não configuração de produção. ⚠️ Com ela em
   * `zona`, os cargos 7/8 passam a varrer zona a zona **sem fatia** (a rota
   * fatiada aceita só o 6): ~6.110 alvos a 1 rps não cabem em 300 s. O vigia
   * do dia D (`pnpm vigia:armado --modo dia-d`) já reprova a variável.
   */
  readonly granularidade: "uf" | "zona";
  /**
   * Teto de requisições por segundo **deste cargo**, quando `TSE_MAX_RPS` não
   * está definida no ambiente (constituição § 1).
   *
   * Por que é por cargo, e não um número só: os quatro crons podem disparar no
   * MESMO minuto — a cadência de 5 minutos (Senador, e cada fatia de Deputado
   * Federal desde o ADR-0036) cai sobre a de 1 minuto de Presidente e
   * Governador **a cada múltiplo de 5**, não só nos minutos 0/15/30/45 como
   * quando Deputado era um cron único de 15 em 15 min. Cada cargo tem o seu
   * bucket dentro do processo (ADR-0068 — até 30/09 era um singleton de
   * processo, e a premissa "o Fluid Compute isola instâncias" era falsa), então
   * o que o TSE vê no IP é a **soma** dos tetos por cargo.
   *
   * As 6 fatias do cargo 6 são **intercaladas** em `vercel.ts` (fatia 1 nos
   * minutos 0 e 30, fatia 2 em 5 e 35, ..., fatia 6 em 25 e 55), de modo que
   * no máximo UMA delas está no ar por vez. É isso que mantém a contribuição
   * do Deputado em 5 rps e o agregado em 80 — seis fatias simultâneas dariam
   * 30 rps só dele, e 105 no total.
   *
   * Medido em 2026-09-11, com todos em 40: pico de **160 rps** com quatro
   * simultâneos e **120** com três — acima do teto documentado de 100, que
   * bloqueia o IP por 10 minutos. O default de 40 tinha sido calibrado para
   * DOIS cargos (2 x 40 = 80) e não sobreviveu à entrada de Senador e Deputado.
   *
   * Calibragem atual — pior caso agregado **82 rps** (Fase 1 da spec 027,
   * ADR-0067), 18% abaixo do teto:
   *
   *   | cargo               | alvos | rps | duração do ciclo                        |
   *   |---------------------|-------|-----|------------------------------------------|
   *   | Presidente          | 6.110 |  25 | ~244 s                                   |
   *   | Governador          | 6.110 |  25 | ~244 s                                   |
   *   | Senador             | 6.110 |  25 | ~244 s                                   |
   *   | Deputado Federal    | 6.110 |   5 | ~1.222 s inteiro; ~204 s POR FATIA (÷6)  |
   *   | Deputado Estadual   |    26 |   1 | ~26 s (um resumo por Assembleia)         |
   *   | Deputado Distrital  |     1 |   1 | ~1 s (o resumo do DF)                    |
   *
   * Os dois cargos das assembleias somam +2 ao agregado, não +27: o teto é de
   * TAXA, e cada um tem o seu processo a 1 rps. Era 80 até 2026-09-29; o
   * ADR-0036 já recusou 85, e a Fase 2 (7 intercalado na faixa de 5 rps do 6)
   * volta a 81.
   *
   * Os pesados caíram de 35 para 25 rps em 2026-09-11, quando Senador passou a
   * ser ingerido por zona (decisão do usuário — ver `granularidade`): três
   * cargos pesados a 35 dariam 110 rps agregados, acima do teto. A 25, o ciclo
   * mais longo vai a ~244 s, dentro do `maxDuration` de 300 s mas com menos
   * folga que antes — é o custo explícito da decisão, e o que torna a medição
   * de `duration_ms` no simulado 1 obrigatória, não opcional.
   *
   * **Deputado Federal NÃO mudou de rps em 2026-09-13**, quando saiu de UF
   * para zona (ver `granularidade`) — continua em 5, deliberadamente: o
   * orçamento agregado do IP (80 rps) já está comprometido pelos três
   * pesados, e Deputado é o cargo com menor urgência editorial dos quatro. O
   * que mudou foi dividir os ~6.110 alvos em 6 fatias por invocação
   * (`sliceTargets`, `lib/tse/targets.ts`) em vez de pedir todos numa
   * invocação só: a 5 rps, uma fatia de ~1.019 alvos leva ~204 s, dentro do
   * `maxDuration` de 300 s — o total sem fatiar (~1.222 s) não caberia.
   */
  readonly rpsMax: number;
}

/**
 * Tabela canônica. A ordem é a de exibição nas abas
 * (`components/layout/CargoTabs.tsx`), não a numérica do TSE.
 *
 * `as const`, e não uma anotação `readonly CargoInfo[]`: a anotação apagaria
 * os literais de cada linha, e é deles que `CargoProporcional` é DERIVADO (as
 * linhas com `proporcional: true`). Assim acrescentar um cargo proporcional
 * aqui já o põe no tipo — não há uma segunda lista de códigos para esquecer de
 * atualizar. A forma de cada linha (`CargoInfo`) é travada logo abaixo, por
 * atribuição tipada.
 *
 * ⚠️ O fim da tabela é o texto literal `] as const;` — o espelho Python
 * (`tests/unit/model/test_cargos_sync.py`) localiza a tabela por ele. Não
 * trocar por `] as const satisfies …`.
 */
export const CARGOS = [
  {
    cd: 1,
    eleicao: "federal",
    token: "pres",
    slug: "presidente",
    label: "Presidente",
    vagasPorUf: 1,
    temSegundoTurno: true,
    temArquivoBr: true,
    proporcional: false,
    abrangencia: "todas-as-ufs",
    granularidade: "zona",
    rpsMax: 25,
  },
  {
    cd: 3,
    eleicao: "estadual",
    token: "gov",
    slug: "governador",
    label: "Governador",
    vagasPorUf: 1,
    temSegundoTurno: true,
    temArquivoBr: false,
    proporcional: false,
    abrangencia: "todas-as-ufs",
    granularidade: "zona",
    rpsMax: 25,
  },
  {
    cd: 5,
    eleicao: "estadual",
    token: "sen",
    slug: "senador",
    label: "Senador",
    vagasPorUf: 2,
    temSegundoTurno: false,
    temArquivoBr: false,
    proporcional: false,
    abrangencia: "todas-as-ufs",
    granularidade: "zona",
    rpsMax: 25,
  },
  {
    cd: 6,
    eleicao: "estadual",
    token: "dep",
    slug: "deputado-federal",
    label: "Deputado Federal",
    vagasPorUf: null,
    temSegundoTurno: false,
    temArquivoBr: false,
    proporcional: true,
    abrangencia: "todas-as-ufs",
    granularidade: "zona",
    rpsMax: 5,
  },
  // Spec 027 (ADR-0066/0067) — Fase 1: um resumo por casa, 1 rps cada.
  {
    cd: 7,
    eleicao: "estadual",
    token: "est",
    slug: "deputado-estadual",
    label: "Deputado Estadual",
    vagasPorUf: null,
    temSegundoTurno: false,
    temArquivoBr: false,
    proporcional: true,
    abrangencia: "ufs-sem-df",
    granularidade: "uf",
    rpsMax: 1,
  },
  {
    cd: 8,
    eleicao: "estadual",
    token: "dis",
    slug: "deputado-distrital",
    label: "Deputado Distrital",
    vagasPorUf: null,
    temSegundoTurno: false,
    temArquivoBr: false,
    proporcional: true,
    abrangencia: "so-df",
    granularidade: "uf",
    rpsMax: 1,
  },
] as const;

/**
 * Trava de FORMA da tabela: cada linha tem de ser um `CargoInfo` (campo que
 * falta ou com tipo errado reprova no `tsc`). Faz o papel de um `satisfies`
 * sem mudar o texto `] as const;` que o espelho Python procura.
 */
const _formaDaTabela: readonly CargoInfo[] = CARGOS;

/** Uma linha da tabela, com os literais preservados. */
type LinhaDaTabela = (typeof CARGOS)[number];

/**
 * Os cargos proporcionais — `6 | 7 | 8` —, **derivados** da tabela (as linhas
 * com `proporcional: true`), não listados à mão. Spec 027 (ADR-0066).
 *
 * É o tipo que as funções de gravação e leitura do Deputado exigem SEM default
 * (`deputadoUfBlobPathname(cargo, uf)`, `readDeputadoProjection(cargo)`, …):
 * este repositório já pagou três vezes por conversor de cargo que escolhia
 * sozinho, e com três casas proporcionais o default "6" gravaria SP estadual
 * por cima de SP federal.
 */
export type CargoProporcional = Extract<LinhaDaTabela, { readonly proporcional: true }>["cd"];

/** Os tokens de chave dos cargos proporcionais — `"dep" | "est" | "dis"`, derivados. */
export type CargoTokenProporcional = Extract<
  LinhaDaTabela,
  { readonly proporcional: true }
>["token"];

/** Todos os códigos cobertos, na ordem da tabela. */
export const CARGOS_TSE: readonly CargoTse[] = CARGOS.map((c) => c.cd);

/** Os códigos proporcionais, na ordem da tabela (`[6, 7, 8]`). */
export const CARGOS_PROPORCIONAIS: readonly CargoProporcional[] = CARGOS.filter(
  (c): c is Extract<LinhaDaTabela, { readonly proporcional: true }> => c.proporcional,
).map((c) => c.cd);

const POR_CD = new Map<number, CargoInfo>(CARGOS.map((c) => [c.cd, c]));
const POR_TOKEN = new Map<string, CargoInfo>(CARGOS.map((c) => [c.token, c]));
const POR_SLUG = new Map<string, CargoInfo>(CARGOS.map((c) => [c.slug, c]));

/** Type guard — `true` se o número é um cargo coberto. */
export function isCargoTse(n: number): n is CargoTse {
  return POR_CD.has(n);
}

/**
 * Type guard — `true` se o número é um cargo coberto E proporcional (6, 7, 8).
 * Lê o campo `proporcional` da tabela; nunca uma lista de códigos à parte.
 */
export function isCargoProporcional(n: number): n is CargoProporcional {
  return POR_CD.get(n)?.proporcional === true;
}

// ---------------------------------------------------------------------------
// UFs por cargo — spec 027 RF-278 (ADR-0066)
// ---------------------------------------------------------------------------

/**
 * As 27 UFs da eleição (26 estados + DF), na ordem que `lib/tse/targets.ts`
 * sempre usou para os alvos de UF. Morava lá como `TODAS_UFS`, privada; veio
 * para cá em 2026-09-29 porque o conjunto de UFs passou a depender do cargo, e
 * quem responde "qual cargo existe onde" é esta tabela.
 */
export const UFS_DA_ELEICAO: readonly string[] = Object.freeze([
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
]);

const UFS_SEM_DF: readonly string[] = Object.freeze(UFS_DA_ELEICAO.filter((uf) => uf !== "DF"));
const SO_DF: readonly string[] = Object.freeze(["DF"]);

/**
 * As UFs em que a corrida deste cargo existe — lidas da `abrangencia` da
 * tabela. Presidente/Governador/Senador/Deputado Federal: as 27; Deputado
 * Estadual (7): as 26 sem o DF; Deputado Distrital (8): só `["DF"]`.
 *
 * Quem enumera alvos no TSE (`lib/tse/targets.ts`) e quem monta caminho de
 * Blob por cargo (`lib/blob/paths.ts`) filtram por aqui: o 8 nunca pede SP e o
 * 7 nunca pede o DF (spec 027 RF-278). Sem `default`: uma abrangência nova não
 * coberta pelo `switch` é erro de compilação (`never`) e, se escapar por um
 * `as`, lança.
 */
export function ufsDoCargo(cd: CargoTse): readonly string[] {
  const abrangencia = cargoInfo(cd).abrangencia;
  switch (abrangencia) {
    case "todas-as-ufs":
      return UFS_DA_ELEICAO;
    case "ufs-sem-df":
      return UFS_SEM_DF;
    case "so-df":
      return SO_DF;
    default: {
      const naoCoberta: never = abrangencia;
      throw new Error(`[cargos] abrangência não coberta: ${String(naoCoberta)} (cargo ${cd})`);
    }
  }
}

/** `true` se a corrida do cargo existe na UF (sigla em qualquer caixa). */
export function cargoExisteNaUf(cd: CargoTse, sigla: string): boolean {
  return ufsDoCargo(cd).includes(sigla.toUpperCase());
}

/** Metadados do cargo, ou `undefined` se não for coberto. */
export function cargoInfo(cd: CargoTse): CargoInfo {
  const info = POR_CD.get(cd);
  // Inalcançável pelo tipo; a guarda existe para o caso de um `as CargoTse`
  // indevido em código de borda.
  if (!info) throw new Error(`[cargos] código de cargo não coberto: ${cd}`);
  return info;
}

/**
 * Quantas cadeiras UMA corrida majoritária deste cargo elege por UF — lido da
 * tabela, **sem default** (2026-09-29, correção "os dois eleitos do Senado").
 *
 * Existe porque o padrão anterior era `cargoInfo(cd).vagasPorUf ?? 1` espalhado
 * pelos consumidores: o `?? 1` nunca disparava para os três majoritários, mas é
 * exatamente o default silencioso de conversor de cargo que este repositório já
 * pagou três vezes — um cargo novo sem `vagasPorUf` passaria a marcar só o líder
 * como eleito, sem erro. Cargo proporcional (Deputado Federal, Estadual ou
 * Distrital, `vagasPorUf: null`) não tem "corrida de N vagas por UF": pedir
 * isso dele é erro de programação, e lança.
 */
export function vagasDaCorrida(cd: CargoTse): number {
  const vagas = cargoInfo(cd).vagasPorUf;
  if (vagas === null) {
    throw new Error(`[cargos] cargo ${cd} é proporcional — não tem vagas por corrida majoritária`);
  }
  return vagas;
}

/** Código numérico do TSE → token de chave (`1` → `"pres"`). */
export function cargoToken(cd: CargoTse): CargoToken {
  return cargoInfo(cd).token;
}

/** Token de chave → código numérico (`"pres"` → `1`). */
export function cargoFromToken(token: CargoToken): CargoTse {
  const info = POR_TOKEN.get(token);
  if (!info) throw new Error(`[cargos] token de cargo desconhecido: ${token}`);
  return info.cd;
}

/**
 * Eleição (federal/estadual, ver `Eleicao`) a que este cargo pertence —
 * lê direto da tabela canônica, sem ternário nem `??`: Presidente (1) é
 * `"federal"`, todos os outros (3, 5, 6, 7, 8) são `"estadual"`. Usado por
 * `lib/tse/targets.ts::getCodEleicaoDoCargo` para resolver qual dos dois
 * códigos de eleição do pleito 2026 (`21270` federal, `21272` estadual)
 * corresponde a um cargo.
 */
export function eleicaoDoCargo(cd: CargoTse): Eleicao {
  return cargoInfo(cd).eleicao;
}

/**
 * Resolve o segmento de rota de `/api/ingest/[cargo]` e das páginas de cargo.
 *
 * Aceita o **código** (`"1"`, `"5"`) ou o **slug** (`"presidente"`,
 * `"deputado-federal"`), case-insensitive. Devolve `null` para qualquer outra
 * coisa — o caller responde 400, sem revelar quais valores existem.
 */
export function parseCargoSegment(raw: string): CargoTse | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const porSlug = POR_SLUG.get(s);
  if (porSlug) return porSlug.cd;
  const n = Number(s);
  return Number.isInteger(n) && isCargoTse(n) ? n : null;
}

/**
 * Pior caso agregado de requisições por segundo contra o IP do TSE: todos os
 * cargos cobertos disparando ao mesmo tempo.
 *
 * Não é hipótese — os crons de `vercel.ts` coincidem **a cada 5 minutos**,
 * porque a cadência de 5 min do Senador e das fatias de Deputado Federal cai
 * sobre a de 1 min dos majoritários. O teto documentado do TSE é 100 rps por
 * IP, com bloqueio de
 * 10 minutos, e a constituição § 1 exige margem **bem abaixo** disso, não
 * "exatamente no limite".
 *
 * Os crons das assembleias (7 e 8) disparam em minutos deslocados dos de 5 em
 * 5, mas isso NÃO os tira da soma: um ciclo de Senador ou de uma fatia do 6
 * dura ~4 min e ainda está no ar quando o 7/8 começa. Daí 82 na Fase 1
 * (ADR-0067), e não 80.
 */
export function piorCasoAgregadoRps(): number {
  return CARGOS.reduce((acc, c) => acc + c.rpsMax, 0);
}

/**
 * Teto de rps de um ciclo que cobre VÁRIOS cargos no mesmo processo.
 *
 * O ciclo genérico (`/api/ingest`, sem segmento) percorre os cargos
 * sequencialmente dentro de uma invocação, com **um** bucket. Sua contribuição
 * ao IP é a de um processo só, então ele pode usar o maior teto entre os cargos
 * que cobre — não a soma, e não o menor (que arrastaria o fan-out pesado a
 * 1.222 s, muito além do `maxDuration`).
 *
 * ⚠️ Sem chamador em produção desde 2026-09-30 (ADR-0068): o ciclo genérico
 * deixou de usar um bucket só — cada alvo paga no bucket do SEU cargo, no teto
 * do cargo. Fica exportada, inalterada, só para não ampliar o escopo da emenda.
 */
export function rpsMaxParaCargos(cargos: readonly CargoTse[]): number {
  if (cargos.length === 0) return Math.min(...CARGOS.map((c) => c.rpsMax));
  return Math.max(...cargos.map((c) => cargoInfo(c).rpsMax));
}
