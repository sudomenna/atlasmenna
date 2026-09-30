/**
 * lib/edge-config/types.ts
 *
 * Canonical TypeScript shape of the Edge Config payload published by the
 * model orchestrator (spec 002) and consumed by every read-side surface
 * (RSC pages, `<HeadlineScore />`, mapa, drill-down de UF).
 *
 * Fonte de verdade: docs/architecture/data-model.md § "Payload do Edge Config".
 * Quando alterar o shape, atualize o markdown PRIMEIRO e replique aqui.
 *
 * Notes
 *   - Um payload encapsula UMA corrida: 1 cargo (1 = Presidente, 3 = Governador)
 *     × 1 turno. Múltiplas corridas vivem em chaves distintas.
 *   - Chave canônica nacional: `projection-current` (e.g. presidência turno 1).
 *     Para múltiplos cargos / turnos, sufixar a chave (ex.
 *     `projection-current-gov-uf-sp`). T14 finaliza o esquema definitivo de chaves.
 *   - Chave de drill-down por UF: `projection-uf-<sigla>` (ex. `projection-uf-SP`).
 *     Traz o RESUMO da UF — candidatos, agulha, bucket, mesorregiões. O
 *     detalhe municipal e as séries temporais NÃO vivem mais aqui (ADR-0032,
 *     ver abaixo).
 *   - Determinismo (constituição § 6): todos os números aqui são funções puras
 *     de (snapshots, historical_results, seed). Não há ruído introduzido na
 *     serialização.
 *   - **Fronteira Global Config × Blob (ADR-0032, 2026-09-08)**:
 *     `EdgePayloadUf.municipios` e `EdgePayloadUf.series_temporais` foram
 *     REMOVIDOS deste envelope e passaram a viver no Vercel Blob
 *     (`lib/blob/uf-detail.ts`, `municipios/uf/<SIGLA>/<cargo>/t<turno>.json`).
 *     Motivo medido, não estimado: 5.572 municípios a ~206 B cada = 1,10 MB só
 *     do array `municipios` para UM cargo — acima do limite do store INTEIRO.
 *     O tipo que o orchestrator ENVIA (com os dois campos) é `UfPayloadInput`;
 *     o tipo ARMAZENADO no Global Config é `EdgePayloadUf`. São distintos de
 *     propósito: o tipo armazenado não deve declarar campos que o store não
 *     guarda.
 *   - Tamanho-alvo: <30 KB para `projection-current` binário S04;
 *     **S05/F4c (multi-candidato 11 cands + cenarios_2t)**: <75 KB nacional.
 *     Por UF, o orçamento de 20 KB dos comentários S05 foi escrito quando
 *     `municipios` ainda estava inline; sem ele a UF típica fica na casa de
 *     poucos KB. `writeEdgePayload` warna em 450 KB por chave, e
 *     `guardStoreSize` mede o **store inteiro** contra o limite real de 1 MB
 *     (não os 512 KB que este cabeçalho citava até 2026-09-08 — número errado,
 *     corrigido pelo ADR-0032).
 *   - **S06/F4d (Fase 2 — mesorregião)**: adicionado `EdgePayloadUf.mesorregioes?`
 *     opcional. Footprint estimado por UF: ~80–120 bytes por mesorregião
 *     serializada (8 campos numéricos + nome + cod). SP tem ~15 mesorregiões
 *     → ~1.5–2 KB extras. UFs pequenas (SE = 2 meso) → <0.3 KB. Cabe no
 *     budget de 20 KB por UF sem regressão. Campo OPCIONAL: payload pode
 *     omitir quando `municipios.mesorregiao_cod` ainda não está populado.
 *   - Chaves nomeadas (S05/F4c — ADR-0012): além de `projection-current`,
 *     o orchestrator pode gravar `projection-current-pres-t1`,
 *     `-pres-t2`, `-gov-t1`, `-gov-t2`, e `projection-archive-pres-t1`
 *     (na transição 1T→2T). `projection-current` segue como ALIAS dinâmico
 *     resolvido por `lib/config/calendar.ts` → `(cargo, turno)` ativo.
 *   - **Separador `-`, não `:`** (emenda ao ADR-0012, 2026-09-08): o padrão
 *     documentado de nome de chave do Global Config é `^[A-Za-z0-9_-]+$` e
 *     não admite dois-pontos. Nenhuma chave é montada à mão — todas vêm de
 *     `lib/edge-config/keys.ts`, que também valida.
 */
import type { CargoProporcional, CargoTse } from "@/lib/config/cargos";

// ---------------------------------------------------------------------------
// Enums / unions (mantêm-se "magic-number-free" no resto do código)
// ---------------------------------------------------------------------------

/** Cargo TSE — os que o SalaCofre cobre (eleição geral 2026; 7 e 8 desde a spec 027). */
// Reexporta o tipo canônico (`lib/config/cargos.ts`) em vez de redeclará-lo:
// até 2026-09-11 esta linha era `1 | 3` e vivia dessincronizada de
// `lib/tse/targets.ts`, que tinha a mesma união repetida 12 vezes.
export type Cargo = CargoTse; // 1 Presidente, 3 Governador, 5 Senador, 6/7/8 Deputado Federal/Estadual/Distrital

/** Turno eleitoral. */
export type Turno = 1 | 2;

/**
 * Bandas da agulha (needle) — mapeiam `needle_position` em [-1, 1] para
 * uma narrativa. Bordas exatas vivem em `app/api/model/project/p_vitoria.py`
 * (T10) e em `docs/specs/002-modelo-estatistico/design.md § "Posição da
 * agulha"`. A duplicação aqui é intencional: o tipo serve como contrato com
 * o front-end, não como única fonte da regra.
 */
export type NeedleBand =
  | "very_likely_a"
  | "likely_a"
  | "lean_a"
  | "tossup"
  | "lean_b"
  | "likely_b"
  | "very_likely_b";

// ---------------------------------------------------------------------------
// Participação — abstenção, brancos/nulos e "Outros" (S07/Fase 1a)
// ---------------------------------------------------------------------------

/**
 * Denominador de uma métrica de participação. **Rotulado explicitamente**
 * porque o hero do 1º turno mistura três bases diferentes na mesma tela
 * (seis termômetros) — sem rótulo, o leitor somaria percentuais que não
 * pertencem ao mesmo universo.
 *
 *   - `"votaveis"` — % sobre os **votos a votáveis concorrentes**
 *     (válidos + anulados + sub judice). É a base do campo `pvap` do TSE,
 *     conforme o dicionário oficial de leiautes
 *     (`docs/reference/tse-2026-leiautes.md`). **Não** é "% dos válidos":
 *     o rótulo na UI deve dizer "% dos votos a votáveis".
 *   - `"comparecimento"` — % sobre quem compareceu (base de brancos/nulos).
 *   - `"eleitores_instalados"` — % sobre os eleitores aptos das seções já
 *     instaladas (base da abstenção). Não é o eleitorado total do país:
 *     enquanto a apuração corre, só as seções instaladas entram no
 *     denominador.
 */
export type ParticipacaoBase = "votaveis" | "comparecimento" | "eleitores_instalados";

/**
 * Segunda base de uma métrica de candidato — % sobre **quem compareceu**
 * (`e.c` do EA20), em contraste com a base default `votaveis` (`v.vvc`).
 *
 * Por que existe (S07/Fase 2 — decisão E2 do plano de extrapolação):
 *   O numerador é o MESMO nos dois casos (votos projetados do candidato);
 *   só o denominador muda. Publicar as duas bases custa uma divisão no
 *   estimador (mesmo `idx` de bootstrap → arrays pareados de verdade) e
 *   evita que o front-end tente derivar uma da outra, o que exigiria
 *   conhecer `vvc/c` e produziria um IC inventado.
 *
 * Identidade da base (EA20: `Σvap + vb + tvn + van + vansj + vscv = c`):
 *   candidatos + Outros + brancos + nulos = 100% de quem compareceu
 *   **menos** anulados e sub judice. O resíduo é pequeno e a legenda da UI
 *   o declara — não arredondamos para "somam 100". A abstenção fica FORA
 *   dessa soma (base própria `eleitores_instalados`).
 *
 * Percentuais em 0–100, como o resto do payload. `pct_atual` é `null`
 * quando ainda não há razão literal (nenhuma zona apurada).
 *
 * **Sempre opcional** onde aparece: payloads pré-S07/Fase 2 (e os três
 * fixtures de `tests/fixtures/edge-config/`) não têm a chave. Consumidor na
 * base `comparecimento` que não encontra o campo deve renderizar
 * "aguardando projeção" (ADR-0017 — permanece no DOM) e **nunca** cair de
 * volta no número de `votaveis`: seria exibir um valor sob o rótulo de
 * outro denominador.
 */
export interface EdgeBaseComparecimento {
  /** % observado agora sobre o comparecimento (0–100), ou null. */
  pct_atual: number | null;
  /** % projetado sobre o comparecimento (0–100). */
  pct_projetado: number;
  /** CI95 inferior (0–100). */
  lower: number;
  /** CI95 superior (0–100). */
  upper: number;
}

/**
 * Uma métrica de participação projetada pelo modelo (regra de três sobre
 * as zonas apuradas + bootstrap para o IC95 — spec 002 / api/model/turnout.py).
 *
 * Todos os percentuais em 0–100 (convenção do payload, ver `EdgeCandidate`).
 *
 * `pct_atual` é `null` quando ainda não há zona apurada suficiente para
 * uma razão literal — UI mostra o termômetro **sem** marcador de apurado
 * e escreve "sem apuração" (nunca esconde a métrica: ADR-0017).
 */
export interface EdgeParticipacaoMetric {
  /** % observado agora (razão literal das zonas apuradas), ou null. */
  pct_atual: number | null;
  /** % projetado ao final da apuração (0–100). */
  pct_projetado: number;
  /** CI95 inferior (0–100). */
  lower: number;
  /** CI95 superior (0–100). */
  upper: number;
  /** Denominador da métrica — dirige o rótulo exibido. */
  base: ParticipacaoBase;
}

/**
 * Bloco de participação do payload — S07/Fase 2 (hero de seis termômetros
 * no 1º turno). Cada métrica é **opcional**: o orchestrator OMITE a chave
 * quando não é calculável (0 zonas com aptos > 0, histórico ausente etc.).
 * Omitir ≠ zero. A UI renderiza o termômetro em estado "aguardando
 * projeção" — sempre no DOM (ADR-0017 proíbe esconder camadas).
 *
 * O bloco inteiro é opcional em `EdgeNational` / `EdgePayloadUf` para não
 * quebrar payloads e fixtures pré-S07.
 */
export interface EdgeParticipacao {
  /** Abstenção — sobre os eleitores das seções instaladas. */
  abstencao?: EdgeParticipacaoMetric & { base: "eleitores_instalados" };
  /**
   * Brancos + nulos agregados — sobre o comparecimento.
   *
   * ⚠️ Senado (spec 022 RF-210, 2026-09-27): o produtor calcula VOTOS sobre
   * VOTOS, `(vb + tvn) / tv`, com `tv = 2 × comparecimento`. O literal
   * `"comparecimento"` fica (é o nome do denominador no contrato), mas uma tela
   * de Senado que exiba esta métrica tem de dizer "dos votos", não "do
   * comparecimento". Nenhuma rota de Senado a exibe hoje (travado em
   * `tests/unit/pages/senador.test.tsx`). Idem `EdgeCandidate.comparecimento`.
   */
  brancos_nulos?: EdgeParticipacaoMetric & { base: "comparecimento" };
  /**
   * Agregado dos candidatos de rank ≥ 4 ("Outros candidatos"), com IC95
   * derivado do MESMO array de resamples do bootstrap dos candidatos —
   * por isso mora aqui e não é reconstruído no front-end. Quando ausente,
   * a UI cai em `100 − Σtop3` **sem faixa de incerteza** e com nota
   * "IC indisponível".
   *
   * Com anulada no escopo (emenda de 2026-09-27 ao ADR-0053, ver
   * {@link EdgeDestinoVoto}): a cauda é a que COMPETE (a anulada fica fora da
   * soma e de `n_candidatos`) e `pct_atual`/`pct_projetado`/`lower`/`upper`
   * são sobre os votos em disputa — IC com o MESMO fator do ponto. No bloco
   * `national` de Governador/Senador, sempre `vvc`. `comparecimento` (abaixo)
   * não muda, nem de cauda.
   */
  outros?: EdgeParticipacaoMetric & {
    base: "votaveis";
    n_candidatos: number;
    /**
     * Mesmo agregado na base `comparecimento` (S07/Fase 2). Opcional pelas
     * mesmas razões de `EdgeCandidate.comparecimento` — ausente ⇒ o
     * termômetro de "Outros" fica em "aguardando" quando a UI está nessa
     * base (nunca reaproveita o número de `votaveis`).
     */
    comparecimento?: EdgeBaseComparecimento;
  };
  /**
   * Metadados do cálculo — alimentam a transparência metodológica
   * (constituição § 8) e o rótulo de origem exigido por RF-062
   * ("projeção a partir do apurado", nunca "valor oficial" nem
   * "baseado em 2022").
   *
   * `tipo` era `string` livre até S07/Fase 2; virou união fechada porque a
   * UI ramifica o rótulo por valor:
   *   - `"extrapolacao_apurado"` — há zona apurada; a projeção é
   *     extrapolada do que já foi apurado (`k = te/esi`, regra de três).
   *   - `"imputado_nacional"` — NENHUMA zona desta UF apurou ainda; a
   *     projeção usa a proporção nacional como âncora provisória, com IC
   *     alargado (RF-017). Só existe para cargo 1: governador não tem
   *     agregado nacional equivalente e fica em "aguardando projeção".
   */
  metodo?: {
    tipo: "extrapolacao_apurado" | "imputado_nacional";
    n_zonas: number;
    pct_apurado: number;
    /**
     * Zonas sem urna apurada que entraram por imputação (proporção da UF,
     * decisão E3). Ausente ≡ 0. Só informativo — o share da UF não muda
     * com a imputação, apenas os votos absolutos.
     */
    n_zonas_imputadas?: number;
  };
}

// ---------------------------------------------------------------------------
// Bloco "votacao" — contagens ABSOLUTAS do eleitorado (spec 021, RF-199)
// ---------------------------------------------------------------------------

/**
 * As contagens absolutas do eleitorado de uma abrangência, **como o TSE as
 * publica** — sem projeção, sem regra de três, sem bootstrap.
 *
 * 🔴 Por que um bloco NOVO em vez de campos em {@link EdgeParticipacao}:
 * aquele bloco é de **estimativas** (cada métrica tem `pct_projetado`,
 * `lower`, `upper` e uma `base` declarada, e nasce de
 * `estimate_uf_participacao`). Este é de **fatos contados**. Misturar os dois
 * num objeto só faria um consumidor futuro somar um número projetado com um
 * apurado sem perceber a troca — o erro que `lider-por-base.ts` documenta
 * para `row.lider` e `margem_atual`, na outra ponta do payload.
 *
 * Fonte: os objetos de raiz `e` (eleitores) e `v` (votos) do EA20, no
 * agregado de nível `"br"`/`"uf"` que o pipeline já busca
 * (`lib/tse/targets.ts:61,245,256`). ⚠️ Nível `"br"` só existe para cargo 1
 * (`targets.ts:59`): nos demais cargos o nacional é a SOMA dos 27 agregados
 * de UF — soma de inteiros, exata.
 *
 * ## A aritmética, do dicionário oficial do TSE
 *
 * (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`)
 *
 *   `aptos` ──> totalizadas + não totalizadas
 *     totalizadas ──> `instalados` + não instaladas
 *       `instalados` ──> `comparecimento` + `abstencao`
 *   `comparecimento` ──> votáveis + `brancos` + `nulos` (+ vscv)
 *     votáveis ──> `validos` + `anulados` + `sub_judice`
 *
 * 🔴 **`validos + brancos + nulos + abstencao` NÃO soma `aptos`.** Soma
 * `instalados`, menos `anulados` e `sub_judice`. Medido na captura real do
 * simulado a 100% apurado (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`):
 * `aptos` 163.079.139 contra `instalados` 163.078.872 (**267** de diferença,
 * ou seja ~zero no fim da noite), e `anulados + sub_judice` = 19.722.460
 * votos, **14,2% do comparecimento**. Quem for desenhar isto: o residual do
 * RF-193 é derivado por SUBTRAÇÃO, nunca por um campo próprio.
 *
 * Todo campo é inteiro e não-negativo. O bloco inteiro é opcional para não
 * quebrar payloads e fixtures anteriores à spec 021 — ausente ⇒ o painel
 * renderiza `<DetailUnavailable>` (RF-198), nunca zeros.
 */
export interface EdgeVotacaoContagens {
  /** `e.te` — eleitores aptos da abrangência. O total do círculo 1 e do 3. */
  aptos: number;
  /** `e.esi` — eleitorado das seções instaladas. É aqui que `comparecimento + abstencao` fecha. */
  instalados: number;
  /** `e.c` — quem compareceu. Igual a `v.tv`. */
  comparecimento: number;
  /** `e.a` — abstenção. `instalados − comparecimento`. */
  abstencao: number;
  /** `v.vv` — votos válidos. ⚠️ NÃO confundir com `v.vvc` (votáveis concorrentes), ADR-0018. */
  validos: number;
  /** `v.vb` — votos em branco. */
  brancos: number;
  /** `v.tvn` — TOTAL de nulos (`v.vn` + `v.vnt`), não o `v.vn` stricto sensu. */
  nulos: number;
  /** `v.van` — anulados. Fatia própria "Anulados e sub judice" (RF-197, revertido em 2026-09-26). */
  anulados: number;
  /** `v.vansj` — anulados sub judice. Mesmo tratamento de `anulados`. */
  sub_judice: number;
}

/**
 * As mesmas quatro fatias do círculo 1, **projetadas** para o fim da apuração
 * (spec 021, RF-195).
 *
 * 🔴 **Publicadas CRUAS, sem nenhuma reescala — e a versão anterior deste
 * contrato estava errada.** Até 2026-09-26 este bloco tinha um campo
 * `fator_normalizacao` e a regra mandava esticar as quatro para fechar em
 * {@link EdgeVotacaoContagens.aptos}. A premissa era que o vão vinha do ruído
 * dos bootstraps ("somam perto de 100%"). **Está errada por duas ordens de
 * grandeza**, medido na captura real de 100% apurado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`), onde a verdade é
 * conhecida:
 *
 *   as 4 fatias ....... 143.356.412        aptos ....... 163.079.139
 *   vão ............... 19.722.727
 *     ├─ anulados + sub judice .. 19.722.460   (99,9986% do vão)
 *     └─ seções não instaladas ..        267   (0,0014% do vão)
 *
 * O ruído do bootstrap responde por ~0,0001%: as quatro projeções batem a
 * verdade com erro de +165, +15, +15 e +40 votos. O vão é **voto anulado**, e
 * voto anulado não projeta para zero. Fechar em `aptos` exigiria o fator
 * 1,1376 e publicaria **114.875.061 válidos contra os 100.982.116 reais —
 * 13.892.945 votos fabricados**, ao lado do círculo 2 exibindo o número
 * verdadeiro na mesma tela (constituição § 6).
 *
 * A resolução (decisão do dono, 2026-09-26) é a mesma regra do círculo 1: o
 * consumidor deriva a fatia "Ainda não apurado" **por subtração**
 * (`aptos − (validos + brancos + nulos + abstencao)`). O cinza não vai a zero
 * no fim da noite — ele estaciona no tamanho dos votos anulados, que é a
 * verdade, e o RF-197 já manda declarar essa soma na metodologia.
 *
 * ⚠️ Nenhum IC aqui, e não é esquecimento: a faixa de incerteza de cada
 * métrica continua em {@link EdgeParticipacao}, publicada sobre a base dela.
 */
export interface EdgeVotacaoProjetada {
  validos: number;
  brancos: number;
  nulos: number;
  abstencao: number;
}

/**
 * Destinação do voto de uma candidatura — `cand[].dvt` do EA20
 * (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:790-806`), spec
 * 022 RF-209. `"Válido"` ⇒ `"valido"`, `"Anulado"` ⇒ `"anulado"`,
 * `"Anulado sub judice"` ⇒ `"sub_judice"`.
 *
 * 🔴 O TSE só publica o campo "após a primeira totalização parcial". Ausente
 * ⇒ a entrada sai SEM `destino`, nunca com um default: valor desconhecido
 * também sai sem `destino` (e com aviso no log). "Desconhecido ⇒ válido"
 * poria votos anulados dentro de uma fatia com nome de candidato — medido na
 * captura real do simulado, o MAIS votado era `"Anulado sub judice"`.
 *
 * ## A base dos percentuais — emenda de 2026-09-27 ao ADR-0053
 *
 * Quando a abrangência tem ao menos uma candidatura de destino `"anulado"`,
 * TODO percentual publicado de candidatura que COMPETE (sem `destino`, ou
 * `"sub_judice"`) é sobre os **votos em disputa** = `vvc − Σ anuladas` — a
 * mesma base em que o modelo decide `p_fecha_1t`, `vai_a_2t`, líder e vagas.
 * Por isso quem compete soma 100% entre si, e "> 50% publicado" é o lado dos
 * 50% em que a decisão está.
 *
 * - **Escopo**: Presidente usa as anuladas NACIONAIS em toda abrangência
 *   (nacional, UF, município, mesorregião); Governador/Senador, as da própria
 *   UF, herdadas por município e mesorregião.
 * - **Sem anulada no escopo** ⇒ todo percentual é sobre `vvc` (ADR-0018),
 *   byte a byte igual a antes da emenda. Sub judice sozinha não muda nada.
 * - **A candidatura `destino === "anulado"`** mantém os campos numéricos (o
 *   tipo exige), com o percentual sobre `vvc` — todos os votos dados, o `pvap`
 *   oficial. A tela NÃO o exibe como percentual, e ele NÃO soma com os de quem
 *   compete (bases diferentes).
 * - **Margens**: `EdgeUfRow.margem_*` e a agulha de `EdgePayloadUf` também
 *   vão para os votos em disputa — a margem é a diferença exata dos dois
 *   primeiros que competem como aparecem em `top_candidatos[].pct`, e
 *   `chamada` (margem > 10) lê essa margem.
 * - **Série** (`EdgeSerieCandidato`): a linha da anulada não entra.
 * - **Fora da regra** (continuam como estavam): `comparecimento`
 *   (`EdgeBaseComparecimento`), `votacao.*`, `p_*` e a agulha nacional,
 *   `votos_*` (contagens) e o bloco `national` de Governador/Senador — ali o
 *   número de urna é a união de 27 corridas e não há "votos em disputa" de
 *   uma corrida nacional.
 * - Quem deriva percentual de CONTAGENS (`EdgeUfMunicipio.votos_reportados`,
 *   `lib/utils/municipio-votos.ts`) tem de tirar os votos das anuladas do
 *   denominador para bater com o resto do payload.
 */
export type EdgeDestinoVoto = "valido" | "anulado" | "sub_judice";

/**
 * Uma candidatura do arquivo AGREGADO da abrangência (spec 022 RF-209).
 *
 * ⚠️ Vem do MESMO arquivo que `EdgeVotacaoContagens` — é isso que faz os três
 * círculos fecharem por identidade do TSE. NÃO é a mesma coisa que
 * `EdgeCandidate.votos_atuais`, que é soma por zona e pode estar um ciclo
 * atrás ou à frente. Nome e demais dados de identidade: cruzar por `id` com a
 * lista `candidatos` do mesmo payload.
 */
export interface EdgeCorridaEntrada {
  /** Número de urna (`cand[].n`) — mesma chave de `EdgeCandidate.id`. */
  id: number;
  /** Sigla do partido — alimenta a cor via `candidateColor` (ADR-0024). */
  partido: string;
  /** `cand[].vap` — votos computados, inteiro ≥ 0. */
  votos: number;
  destino?: EdgeDestinoVoto;
}

/** Soma dos votos VÁLIDOS de um partido nas 27 UFs (spec 022 RF-201/209). */
export interface EdgeCorridaPartido {
  partido: string;
  /** Σ `vap` das candidaturas do partido com destino `"valido"`. */
  votos_validos: number;
}

/** O bloco `votacao` do payload — contado e, quando há base, projetado. */
export interface EdgeVotacao {
  contagens: EdgeVotacaoContagens;
  /** Ausente enquanto não houver zona apurada — o círculo 3 fica "aguardando" (RF-195). */
  projetada?: EdgeVotacaoProjetada;
  /**
   * Spec 022 — a corrida por CANDIDATURA, do agregado. Presidente nacional e
   * todo `EdgePayloadUf`. Ausente ⇒ "não sabemos" (RF-207).
   */
  corrida?: EdgeCorridaEntrada[];
  /**
   * Spec 022 — a corrida por PARTIDO, nacional de Governador e Senador.
   * OMITIDO enquanto `destino_pendente` (RF-209).
   */
  corrida_por_partido?: EdgeCorridaPartido[];
  /**
   * `true` quando alguma candidatura com votos da abrangência ainda está sem
   * destinação — a tela fica em "aguardando a separação dos votos válidos"
   * (RF-207). Ausente ⇒ todas as destinações conhecidas.
   */
  destino_pendente?: true;
}

/**
 * O bloco `votacao` de uma UF (spec 022 RF-209 + spec 021 RF-192 emendado).
 *
 * 🔴 **EMENDADO em 2026-09-26 (noite), decisão do dono**: o painel "Votação"
 * saiu das capas de Governador/Senador/Deputado e ENTROU nas quatro telas de
 * UF. Por isso este bloco ganhou `projetada` — até então a tela de UF não
 * tinha o painel, e o bloco trazia só o que "A corrida" usa.
 *
 * `projetada` sai da MESMA regra do nacional (`projetar_fatias_em_contagens`,
 * `api/model/project.py`), sobre as contagens e a participação projetada
 * **da UF**. Sem participação projetada da UF ⇒ ausente, e o arco 3 fica em
 * "aguardando projeção" (RF-195). Nunca a participação nacional no lugar da
 * UF: publicaria a abstenção do Brasil aplicada ao eleitorado de Roraima.
 *
 * Deputado Federal (cargo 6) publica este bloco no detalhe de UF do Blob
 * (`DeputadoUfDetail.votacao`), **sem** `corrida` (spec 022 RF-200) e, hoje,
 * sem `projetada`: o ciclo proporcional não calcula participação projetada.
 */
export interface EdgeVotacaoUf {
  contagens: EdgeVotacaoContagens;
  /** Ausente sem participação projetada DA UF — arco 3 em "aguardando" (RF-195). */
  projetada?: EdgeVotacaoProjetada;
  corrida?: EdgeCorridaEntrada[];
  destino_pendente?: true;
}

// ---------------------------------------------------------------------------
// Bloco "nacional" — alimenta <HeadlineScore />, agulha e barras
// ---------------------------------------------------------------------------

/**
 * Um candidato dentro do bloco nacional. Note que `pct_*` são porcentagens
 * (0–100), não frações (0–1) — segue a convenção do `data-model.md` linha
 * 122 (`pct_apurado_total: 0–100`). Probabilidades (`p_vitoria`) ficam em
 * [0, 1] porque é a convenção universal de stats.
 *
 * Multi-candidato (S05/F4c — ADR-0013, ADR-0014, ADR-0017):
 *   - `rank` substitui a noção binária "candidato A / B". É o ranking
 *     semântico do candidato (1 = líder por pct_projetado, 2 = segundo,
 *     ...), determinado em `compute_national` com tie-breaker estável.
 *   - `p_passa_2t` e `p_fecha_1t` são métricas multi-candidato derivadas
 *     do mesmo array de estimates do bootstrap (zero novo custo).
 */
export interface EdgeCandidate {
  id: number;
  nome: string;
  partido: string;
  /**
   * Destinação do voto desta candidatura (`cand[].dvt`, ADR-0053 / RF-213).
   * 🔴 **Emitido SÓ quando `"anulado"` ou `"sub_judice"`** — `"valido"`
   * nunca é gravado nesta lista (2026-09-27: 19 B por candidatura, ~6 KB no
   * Senado nacional, derrubavam a folga de 2× do limiar do payload).
   * `"anulado"` ⇒ NÃO compete: a tela a põe no fim da lista com a etiqueta
   * "Anulado" e a ignora ao derivar líder, margem, vagas e cor do mapa.
   * `"sub_judice"` ⇒ compete (segue o TSE), com etiqueta "Sub judice".
   * **Ausente** ⇒ compete: válida, OU o TSE ainda não publicou (antes da 1ª
   * totalização parcial), OU os arquivos divergiram — a tela nunca supõe
   * anulado e não distingue os três casos (quem precisa distinguir válido de
   * "ainda não publicado" é `votacao.corrida[]`, que continua emitindo
   * `"valido"`). Base dos percentuais: ver {@link EdgeDestinoVoto} — com
   * anulada no escopo, quem compete sai sobre os votos em disputa e a anulada
   * fica sobre `vvc` (e não é exibida). O tipo segue `EdgeDestinoVoto` para não quebrar consumidores; o
   * produtor não grava `"valido"` aqui.
   */
  destino?: EdgeDestinoVoto;
  /**
   * @deprecated **Não leia este campo.** Aposentado em 2026-09-19.
   *
   * Ele carrega `var(--color-cand-{rank})` — a paleta por **COLOCAÇÃO** do
   * ADR-0013, que o [ADR-0024] superou em 2026-09-07. A cor de um candidato vem
   * da **SIGLA**, via `candidateColor` / `candidateMarkerColor`
   * (`components/blocks/_candidateColor.ts`).
   *
   * Por que ler daqui é defeito, e não só estilo: a constituição § 2 exige que a
   * cor de um partido seja **estável durante toda a noite** e "não muda por
   * rank". Este campo **É** o rank — com ele, o 3º que ultrapassa o 2º ao vivo
   * faz os dois **trocarem de cor** no meio da apuração.
   *
   * Em 19/09 o dono viu o sintoma na tela: CAIADO/PSD **laranja na lista e verde
   * na legenda do mapa**, ao mesmo tempo. Dez superfícies liam o campo. Nenhuma
   * lê hoje, e `tests/unit/components/cor-nunca-do-payload.test.ts` varre
   * `components/` para que continue assim.
   *
   * **Opcional desde 19/09, e o produtor parou de emiti-lo** — payloads gravados
   * antes disso ainda o trazem, e por isso o campo continua declarado: removê-lo
   * do tipo quebraria o decode de um Global Config já publicado. A remoção
   * definitiva é limpeza pós-2º turno, junto com os tokens `--color-cand-*`
   * (ADR-0013 § Status).
   */
  cor?: string;
  votos_atuais: number;
  votos_projetados: number;
  /**
   * % do total apurado no momento (0–100). Base: `vvc`, ou — Presidente com
   * anulada nacional — os votos em disputa para quem compete; a anulada fica
   * em `vvc` (ver {@link EdgeDestinoVoto}). Governador/Senador: sempre `vvc`
   * neste bloco (união de 27 corridas).
   */
  pct_atual: number;
  /** % projetado pelo modelo (0–100). Mesma base de `pct_atual`. */
  pct_projetado: number;
  /** CI95 inferior (0–100). Mesma base e MESMO fator do ponto. */
  pct_projetado_lower: number;
  /** CI95 superior (0–100). Mesma base e MESMO fator do ponto. */
  pct_projetado_upper: number;
  /** Probabilidade de vitória em [0, 1]. */
  p_vitoria: number;
  /**
   * Rank semântico do candidato no agregado nacional (1 = líder por
   * `pct_projetado`, 2 = segundo, ...). Tie-breaker estável por
   * `candidato_id` ASC. Adicionado em S05/F4c — ADR-0013 (paleta visual
   * por rank) e ADR-0017 (transparência total: rank dirige qual camada
   * do hero/ranking exibe o candidato).
   *
   * Payloads pré-S05 não têm essa chave — consumidores devem coalescer
   * para `index + 1` no array `candidatos[]` (que já é ordenado por
   * pct_projetado desc desde S04).
   */
  rank: number;
  /**
   * Probabilidade em [0, 1] de o candidato terminar TOP-2 do 1º turno
   * — isto é, ir para o segundo turno OU ganhar no 1º (cobre os dois
   * "passa adiante"). Frequência empírica nos resamples do bootstrap
   * onde `pct_proj >= pct_2º_dos_outros`. Adicionado em S05/F4c
   * (ADR-0014) para a coluna "vai pro 2T" do ranking multi-camada
   * (RF-030.8). Em 2T, `p_passa_2t = p_vitoria` (degenera para a
   * mesma métrica). Pré-S05 ausente → consumidor usa fallback null/0.
   */
  p_passa_2t: number;
  /**
   * Probabilidade em [0, 1] de o candidato FECHAR o 1T sozinho
   * (`>= 50%+1` dos votos válidos no agregado nacional). Frequência
   * empírica nos resamples onde `pct_proj >= 50`. Adicionado em S05/F4c
   * (ADR-0014) para o gatilho "decisão no 1T" do HeadlineScore
   * (RF-030.9) e fonte do banner "fecha no 1T se >X". Sempre `0.0`
   * em payloads de 2T (vazio de semântica). Pré-S05 ausente →
   * consumidor coalesce para 0.
   */
  p_fecha_1t: number;
  /**
   * Identidade **global e estável** do candidato (`SQ_CANDIDATO` do TSE) —
   * ADR-0042 item 2. É a chave que endereça a foto (ADR-0041), via
   * `blobUrlFor(candidatoFotoBlobPathname(uf, sqcand))`; a URL em si não
   * viaja no payload porque é derivável desta chave.
   *
   * **`string`, não `number`** — tem 11 **ou** 12 dígitos, e comparar as duas
   * larguras como texto ordena errado em silêncio (`"99…"` vence `"100…"`).
   *
   * **Presente só em cargo 1 (Presidente)**, pela mesma razão que `nome`
   * (RF-145): em cargo 3 e 5 este bloco é a união de 27 corridas sob o mesmo
   * espaço de `id`, e um `sqcand` atribuído aqui apontaria para a foto de um
   * candidato de UF arbitrária. Para esses cargos a identidade mora em
   * {@link EdgeUfRow.top_candidatos}, que sabe de que UF é.
   */
  sqcand?: string;
  /**
   * Mesmo candidato na segunda base — % sobre quem compareceu (S07/Fase 2,
   * decisão E2). Os campos `pct_*` acima seguem sendo a base `votaveis`
   * (default da UI). Ver `EdgeBaseComparecimento` para a identidade da soma
   * e a regra de degradação quando o campo está ausente.
   */
  comparecimento?: EdgeBaseComparecimento;
}

export interface EdgeNational {
  /**
   * Candidatos da corrida. Ordenação canônica (FIX S04 — carry-over #1 da
   * retro S03):
   *   1. Líder semântico (id == `candidato_a_id`, rank == 1)
   *   2. Segundo lugar (id == `candidato_b_id`, rank == 2)
   *   3. Demais por `pct_projetado` desc, tie-breaker por `id` asc.
   *
   * S05/F4c — multi-candidato (ADR-0017): array passa a conter TODOS os
   * candidatos com presença no histórico/snapshot, não só top-2. UI usa
   * `rank` para distribuir nas 3 camadas (hero rank 1–2, ranking rank 3–6,
   * lista compacta rank 7+).
   *
   * Por que `candidato_a_id` / `candidato_b_id` continuam: backward-compat
   * com consumidores S04 que liam o "duelo" binário. Em S05 a semântica
   * é "líder e segundo por rank", não "duelo top-2 fechado".
   */
  candidatos: EdgeCandidate[];
  /** Posição da agulha em [-1, 1]. -1 = vitória certa de B, +1 = vitória certa de A. */
  needle_position: number;
  needle_band: NeedleBand;
  /**
   * ID do líder semântico (rank == 1) por `pct_projetado` agregado. Pode ser
   * `null` quando a projeção ainda não tem candidatos válidos (pré-apuração
   * / RF-017 caso degenerado total). Consumidores devem fazer fallback para
   * `candidatos[0]?.id`. S05+: equivale a `candidatos[rank == 1].id`.
   */
  candidato_a_id: number | null;
  /**
   * ID do segundo lugar (rank == 2). `null` quando há ≤1 candidato. Em
   * payloads S05+ multi-candidato a semântica continua "segundo por
   * pct_projetado", não "adversário binário".
   */
  candidato_b_id: number | null;
  /**
   * Probabilidade em [0, 1] de a eleição NÃO terminar no 1º turno (ou seja,
   * P(nenhum candidato fecha 50%+1 sozinho)). Calculado pelo orchestrator
   * a partir dos resamples do bootstrap (S05/F4c — ADR-0014). Frequência
   * empírica `mean(max(estimates_por_cand) < 0.50)`. `null` em payloads
   * de 2T (semântica vazia: o segundo turno JÁ é o cenário).
   *
   * Alimenta o medidor "P(2º turno)" do HeadlineScore (RF-030.7) e o
   * gatilho narrativo do banner "decidido no 1T se >X". Pré-S05 ausente →
   * consumidor coalesce para null e UI esconde o medidor.
   */
  p_segundo_turno_overall: number | null;
  /**
   * Top-3 pares (líder, segundo) mais prováveis no 2º turno — ordenados
   * por `prob` desc. Cada `par` é uma tupla de candidato_ids `[A, B]`.
   * Calculado por contagem de frequência nos resamples do bootstrap:
   * para cada resample, o par `(top1_rank, top2_rank)` é registrado;
   * os 3 pares mais frequentes entram aqui. Adicionado em S05/F4c
   * (ADR-0014).
   *
   * `[]` em payloads de 2T (não faz sentido projetar cenário 2T quando
   * já estamos no 2T). Alimenta o bloco "Cenários para o segundo turno"
   * (RF-030.8) com chips dos top-3 duelos. Pré-S05 ausente → consumidor
   * coalesce para `[]` e UI esconde a seção.
   */
  cenarios_2t: Array<{ par: [number, number]; prob: number }>;
  /**
   * Chamadas recentes (broadcast-style breaking news) emitidas pelo
   * orchestrator quando uma UF muda para `bucket === "chamada"` ou quando
   * a corrida nacional atinge gatilhos narrativos (decisão no 1T, K-1
   * convergência, etc.). Adicionado em S06/F4d (Fase 3) para alimentar
   * `<BreakingNewsTicker />` no topo de `/governador` e `/`.
   *
   * Cada item é uma sentença pronta para renderizar (NUNCA LLM —
   * constituição § 2, ADR-0005). Templates determinísticos por evento.
   *
   * Ordenação canônica: `ts` DESC (mais recente primeiro), top 5 itens
   * (ringbuffer no orchestrator). Pré-S06/F4d ausente — consumidor
   * coalesce para `[]` e UI esconde o ticker quando vazio.
   */
  chamadas_recentes?: Array<{ ts: string; texto: string }>;
  /**
   * Sinal binário "a eleição vai a 2º turno?" no agregado nacional —
   * `true` quando o orchestrator avalia que nenhum candidato fecha o 1T,
   * `false` quando há decisão no 1T (líder ≥ 50%+1), `null` quando
   * indeterminado / 2T (degenera).
   *
   * Adicionado em S06/F4d Fase 5 (carry-over): consumidores do
   * `<NationalWinnerBanner />` precisavam decidir entre "ELEITO" e
   * "vai a 2T" derivando heuristicamente de `p_segundo_turno_overall`
   * (`page.tsx`: `vai_a_2t_nacional = p < 0.01`). Eleva essa decisão para
   * o orchestrator: emite explícito + auditável, espelhando a semântica
   * já presente em `EdgeUfRow.vai_a_2t` (mas no agregado nacional).
   *
   * Pré-S06/F4d ausente — consumidor deve continuar derivando heuristicamente
   * do `p_segundo_turno_overall` (forward-compat). Em 2T, o orchestrator
   * deve emitir `null` (semântica vazia — já estamos no 2T).
   */
  vai_a_2t_nacional?: boolean | null;
  /**
   * Participação nacional (abstenção, brancos/nulos, "Outros") — S07/Fase 1a.
   * Alimenta os termômetros 4–6 do hero de 1º turno (`<ProjectionThermometers />`).
   *
   * **Opcional** para forward/backward-compat: payloads pré-S07 não têm a
   * chave, e o orchestrator omite métricas individuais quando não são
   * calculáveis. Semântica de 2º turno: o hero de 2T (modo `binary`) não
   * consome este bloco — o orchestrator pode omiti-lo inteiro em payloads
   * de turno 2.
   */
  participacao?: EdgeParticipacao;
}

// ---------------------------------------------------------------------------
// Bloco "por UF" — alimenta o choropleth e o ranking estadual
// ---------------------------------------------------------------------------

/**
 * Uma linha por UF (27 no total, incluindo DF). O contrato `data-model.md`
 * usa `chamada: boolean` para sinalizar se aquela UF já foi "chamada" para
 * um candidato (cf. design.md § "Chamada de UF").
 *
 * `margem_projetada_ci` é uma tupla [lower, upper] em pontos percentuais
 * (não fração). `swing_vs_2022` é pp também (positivo = swing em favor do
 * `lider`).
 */
export interface EdgeUfRow {
  /** Sigla de 2 letras maiúsculas (ex. "SP", "DF"). */
  sigla: string;
  pct_apurado: number; // 0–100
  /**
   * ID do candidato líder.
   *
   * 🔴 **NÃO é "o líder no momento", apesar de esta docstring ter afirmado
   * isso até 2026-09-20.** É o líder por `pct_projetado` — uma leitura do
   * MODELO, não da apuração. `api/model/project.py:5033,5266` grava
   * `int(ordered[0]["candidato_id"])`, onde `ordered` é
   * `sorted(rows, key=pct_projetado, reverse=True)`. O mesmo `ordered[0]`
   * alimenta `top_candidatos[0]` (linha 5081), então
   * **`lider === top_candidatos[0].id` em todo payload**.
   *
   * A frase antiga custou caro: `_NationalChoroplethMapImpl::resolveColor`
   * escolhia a cor da UF com `parcial ? row.lider : top_candidatos[0].id`,
   * acreditando nela — um ternário cujos dois braços dão o MESMO candidato.
   * A cor do mapa nunca mudou ao alternar Parcial/Projeção, em nenhum cargo,
   * desde que o seletor existe, e nenhum teste cobria a combinação.
   *
   * **Quem precisa do líder da base ATIVA usa `liderIdPorBase`**
   * (`lib/utils/lider-por-base.ts`), que deriva a ordem parcial dos
   * `top_candidatos[].pct_atual` — o único apurado por-candidato publicado.
   * Não existe campo "líder apurado" no payload; criar um é trabalho de
   * produtor (Python).
   */
  lider: number;
  /**
   * Margem em pontos percentuais.
   *
   * 🔴 **Também não é "atual".** `api/model/project.py:5267-5268` grava
   * `margem_atual` e `margem_projetada` com a MESMA variável
   * (`margem = top_pct - second_pct`, ambos `pct_projetado`) — os dois campos
   * carregam o mesmo número, e ele descreve a PROJEÇÃO. Mesmo desvio de
   * {@link EdgeUfRow.lider}, na outra metade da view "margin" do mapa.
   *
   * Quem precisa da margem da base ativa usa `margemPorBase`
   * (`lib/utils/lider-por-base.ts`).
   *
   * Base (emenda de 2026-09-27 ao ADR-0053, ver {@link EdgeDestinoVoto}): com
   * anulada no escopo da UF, a margem é sobre os votos em disputa — a
   * diferença EXATA entre os dois primeiros que competem como aparecem em
   * `top_candidatos[].pct`. Sem anulada, pp de `vvc`.
   */
  margem_atual: number;
  /** Margem projetada (pp). Mesma base de `margem_atual`. */
  margem_projetada: number;
  /** CI95 da margem projetada (pp). Mesma base, mesmo fator do ponto. */
  margem_projetada_ci: [number, number];
  /**
   * UF "chamada" para o líder? (design.md § "Chamada de UF") — `margem > 10`,
   * com a margem na base acima (votos em disputa quando há anulada no escopo).
   */
  chamada: boolean;
  /**
   * Swing em pp vs. 2022 (positivo = em favor do líder).
   *
   * S07/Fase 2 — o tipo passa a aceitar `null`: com a projeção extrapolada
   * do apurado (não mais swing vs. 2022), este campo deixa de ser insumo do
   * modelo e vira **comparação descritiva** (decisão E1: apurado de agora −
   * 2022, um fato observado). Fica `null` quando o número de 2022 não
   * existe para aquele par (UF, candidato) — consumidores devem exibir "—",
   * nunca 0, que leria como "não mudou nada".
   *
   * Na Fase 2 o orchestrator ainda emite `0.0` fixo (`api/model/project.py`);
   * o valor real chega na Fase 5 junto com `compute_swing_descritivo`.
   * Ampliar o tipo agora evita ter que mexer nos consumidores duas vezes.
   */
  swing_vs_2022: number | null;
  /**
   * Top-N candidatos da UF por `pct_projetado` desc. Adicionado em S05/F4c
   * (ADR-0017 — transparência total): a página de UF mostra TODOS os
   * candidatos visíveis, mas a home / mapa precisa de um resumo compacto
   * para chips e tooltips. `pct` é 0–100. Tie-breaker estável por
   * candidato_id ASC.
   *
   * ===========================================================================
   * 🔴 **NÃO é mais só "os N por projeção" (2026-09-21, RF-190)**
   * ===========================================================================
   *
   * O array é a **união** de dois conjuntos: as `TOP_CANDIDATOS_POR_UF` de
   * maior `pct_projetado` e as `RESGATE_POR_APURADO` de maior `pct_atual` da
   * corrida inteira (constantes em `api/model/project.py`). Motivo: quem
   * liderava os boletins apurados sem estar no corte por projeção caía dentro
   * de {@link EdgeUfRow.outros}, que não tem `id` nem nome — e desde
   * 2026-09-20 a UI pinta o mapa, ordena a lista e destaca o líder pela base
   * ATIVA (`lib/utils/lider-por-base.ts`). O payload silenciava exatamente a
   * pessoa que a tela precisava mostrar.
   *
   * **Três invariantes que o consumidor pode assumir:**
   *
   *   1. **Os `TOP_CANDIDATOS_POR_UF` primeiros índices continuam sendo o
   *      prefixo por projeção, na mesma ordem de sempre.** É o que permite a
   *      `margemSegundaVaga` (`lib/utils/margem-senado.ts`) seguir lendo
   *      `[1]`/`[2]` por POSIÇÃO. Os resgatados entram depois, nos índices
   *      `TOP_CANDIDATOS_POR_UF..`.
   *   2. **Partição exata com `outros`** — quem foi resgatado sai da cauda e
   *      de `outros.n_candidatos`. Ninguém aparece nos dois lados.
   *   3. **No caso normal nada é anexado** e o array tem o comprimento de
   *      sempre. No replay real de 2022 o resgate não dispararia em nenhuma
   *      das 133 observações (5 instantes × 27 UFs, incluindo 16 com menos de
   *      5% apurado) — 2022 foi uma corrida de dois.
   *
   * ⚠️ **O comprimento cresce.** Um consumidor que dependesse de "exatamente
   * 4" quebraria. Os que cortam (`GovernorCard.tsx`, `StrongholdsPanel.tsx`)
   * continuam corretos porque cortam o PREFIXO; o balão do mapa
   * (`buildHoverRows`) renderiza o array inteiro e cresce até 6 linhas, que é
   * a decisão do dono registrada na emenda de 2026-09-21 ao RF-177.
   *
   * **N era 3 e virou 4 em 2026-09-19** (pedido do dono — o balão de hover
   * dos mapas mostra 4 candidaturas + a linha "Outros"). O número mora em
   * `TOP_CANDIDATOS_POR_UF`, em `api/model/project.py`, e é o MESMO que
   * define a cauda que vira {@link EdgeUfRow.outros} — top e cauda
   * particionam a lista ordenada. Consumidor que quiser menos de 4 corta
   * com `.slice()`; quem ler pelo índice 0/1/2 continua correto. Payload
   * gravado antes desta data tem 3 entradas e nenhum `outros`, e isso é
   * legítimo — nada aqui promete um comprimento fixo.
   *
   * Pré-S05 ausente → consumidor coalesce para `[]` e UI degrada para
   * só `lider` + `margem_*` (comportamento S04).
   *
   * **Spec 018 / ADR-0042 item 3 — a linha da UF passa a carregar a própria
   * identidade.** Antes o consumidor cruzava `id` contra
   * `national.candidatos` para achar nome e partido, e esse cruzamento é o
   * defeito que o ADR-0042 existe para prevenir: em cargo 3 (Governador) e 5
   * (Senador) o bloco nacional é a **união de 27 corridas** sob o mesmo
   * espaço de `id`, então `id === 13` ali não é uma pessoa — é "o número 13
   * nalguma UF". Resolver nome por esse índice entrega o candidato do estado
   * errado. Aqui não: a linha já sabe de que UF é.
   *
   * Quem renderiza nome/partido a partir de `top_candidatos` deve ler
   * **destes campos**, nunca de um índice sobre `national.candidatos`.
   */
  top_candidatos: Array<{
    /** Número na urna — inalterado. */
    id: number;
    /**
     * 0–100. `pct_projetado` da UF: sobre `vvc`, ou — com anulada no escopo
     * desta UF — sobre os votos em disputa, para quem compete; a anulada fica
     * em `vvc` e não é exibida (ver {@link EdgeDestinoVoto}). A SELEÇÃO e a
     * ordem desta lista (projeção + resgate do RF-190) são feitas em `vvc` e
     * não mudam com a base: o fator é o mesmo para todas as que competem.
     */
    pct: number;
    /**
     * Nome resolvido pela cadeia do RF-144 (EA20 `nmu` → EA20 `nm` → cadastro
     * → placeholder). **Ausente** quando nada resolveu: o consumidor cai no
     * `"Cand {id}"` que já fazia. Opcional de propósito — sob
     * `model_fallback_tier`, e em todo payload gravado antes da spec 018, o
     * campo não existe e a tela tem de continuar renderizando.
     */
    nome?: string;
    /** Sigla. Ausente = consumidor cai no que já faz hoje ("—"). */
    partido?: string;
    /**
     * Destinação do voto desta candidatura (`cand[].dvt`, ADR-0053 / RF-213).
     * 🔴 **Emitido SÓ quando `"anulado"` ou `"sub_judice"`** — `"valido"`
     * nunca é gravado nesta lista (2026-09-27: 19 B por candidatura, ~6 KB no
     * Senado nacional, derrubavam a folga de 2× do limiar do payload).
     * `"anulado"` ⇒ NÃO compete: a tela a põe no fim da lista com a etiqueta
     * "Anulado" e a ignora ao derivar líder, margem, vagas e cor do mapa.
     * `"sub_judice"` ⇒ compete (segue o TSE), com etiqueta "Sub judice".
     * **Ausente** ⇒ compete: válida, OU o TSE ainda não publicou (antes da 1ª
     * totalização parcial), OU os arquivos divergiram — a tela nunca supõe
     * anulado e não distingue os três casos (quem precisa distinguir válido de
     * "ainda não publicado" é `votacao.corrida[]`, que continua emitindo
     * `"valido"`). Base dos percentuais: ver {@link EdgeDestinoVoto} — com
     * anulada no escopo, quem compete sai sobre os votos em disputa e a anulada
     * fica sobre `vvc` (e não é exibida). O tipo segue `EdgeDestinoVoto` para não quebrar consumidores; o
     * produtor não grava `"valido"` aqui.
     */
    destino?: EdgeDestinoVoto;
    /**
     * Identidade **global e estável** do candidato (ADR-0042 item 2) — é o
     * que liga esta linha à foto, via
     * `blobUrlFor(candidatoFotoBlobPathname(uf, sqcand))` (ADR-0041). A URL
     * da foto NÃO viaja no payload: é derivável desta chave, e guardá-la
     * duplicaria verdade e gastaria bytes de um store de 1 MB.
     *
     * **`string`, não `number`** — tem 11 **ou** 12 dígitos (5.569 das 20.939
     * candidaturas de 2026 têm 11). `Number()` sobrevive, mas comparar as
     * duas larguras como texto ordena errado em silêncio: `"99…"` (11) vence
     * `"100…"` (12). Se algum dia for preciso ordenar por ele, `BigInt`.
     */
    sqcand?: string;
    /**
     * Votos absolutos apurados deste candidato NESTA UF (2026-09-18, pedido
     * do dono — balão do mapa nacional estilo NYT). Mesmo nome/semântica de
     * {@link EdgeUfCandidate.votos_atuais}: `api/model/project.py` grava a
     * MESMA linha `(uf, candidato)` nos dois payloads. `0` é um FATO — zero
     * boletim chegado para este candidato nesta UF — não "não medimos"; por
     * isso este campo é sempre um número quando presente, nunca "0 disfarça
     * ausência". **Ausente** (não `0`) em payload pré-2026-09-18 e sob
     * `model_fallback_tier` — consumidor mostra "—", nunca "0".
     */
    votos_atuais?: number;
    /**
     * % de votos válidos APURADOS deste candidato nesta UF, 0–100
     * (2026-09-18, mesmo pedido acima). Mesmo nome/semântica de
     * {@link EdgeUfCandidate.pct_atual} — mas ao contrário de `votos_atuais`,
     * este campo pode faltar mesmo em payload novo: `api/model/project.py`
     * omite-o quando a UF não tem NENHUMA zona apurada e o número vem por
     * imputação nacional (cargo 1 apenas — `impute_uf_from_national`), caso
     * em que "qual fração é deste candidato" não foi medido, só o total
     * nacional foi. **Ausente ⇒ "—", nunca `0`** — decisão do dono de 14/09
     * (não começou / não sabemos / apurando são três estados distintos).
     *
     * Mesma base de `pct` (votos em disputa com anulada no escopo; a anulada
     * em `vvc`) — o "votos válidos" do rótulo é, com anulada, literal.
     */
    pct_atual?: number;
  }>;
  /**
   * Agregado de TODAS as candidaturas que ficaram FORA de `top_candidatos`
   * — a linha "Outros" do balão de hover dos mapas (2026-09-19, pedido do
   * dono: o balão passou de 3 para 4 linhas + esta).
   *
   * **É irmão de `top_candidatos`, não um elemento dele.** `top_candidatos`
   * tem contrato documentado de *candidaturas* (ver o bloco logo acima, e
   * spec 018 / ADR-0042): cada entrada tem um `id` de urna e um `sqcand` que
   * endereça a foto (ADR-0041). Este agregado não tem nem um nem outro — não
   * existe "o número da urna de Outros" — e precisa de `n_candidatos`, que
   * candidatura nenhuma tem. Enfiá-lo no mesmo array exigiria inventar um
   * `id` sentinela (`0`, `-1`, `999`), e um `id` sentinela num espaço de ids
   * de urna é exatamente como nasce o bug "o 13 de Alagoas" que o ADR-0042
   * existe para prevenir: alguém cruza esse id contra outra lista e recebe
   * uma pessoa de verdade. Por isso: campo próprio, shape próprio.
   *
   * **Vocabulário igual ao de `EdgeParticipacao.outros` (ver ~:195-206),
   * shape deliberadamente DIFERENTE.** Aquele é um `EdgeParticipacaoMetric`
   * e carrega IC95 vindo do MESMO array de resamples do bootstrap
   * (`compute_outros_estimates` soma resample a resample justamente para
   * preservar a faixa). Este **não tem IC nenhum**: é uma soma de PONTOS
   * (`Σ pct_projetado` da cauda), e ponto somado com ponto não produz
   * intervalo. Herdar `EdgeParticipacaoMetric` aqui prometeria uma faixa de
   * incerteza que ninguém calculou — a mesma classe de erro da emenda de
   * 17/09 ao ADR-0046 (número estimado exibido com cara de número medido).
   * Se um dia o balão quiser IC para "Outros", o caminho é o de lá
   * (`compute_outros_estimates` por UF), não alargar este tipo.
   *
   * **Ausente quando a cauda é vazia** — UF com `≤ 4` candidaturas no cargo.
   * Nunca um objeto zerado: "não há mais ninguém" e "os demais somam 0%" são
   * estados diferentes, e um `{ pct: 0 }` faria a tela escrever "Outros
   * 0,0%" numa corrida de três, que é uma linha falsa. Consumidor: campo
   * ausente ⇒ NÃO renderize a linha.
   */
  outros?: {
    /**
     * Σ `pct_projetado` da cauda, 0–100, base **votáveis** (`v.vvc` do EA20 —
     * ADR-0018: nunca "válidos", que é `v.vv`). MESMO denominador de
     * `top_candidatos[].pct`, por isso as cinco linhas do balão são somáveis.
     *
     * Com anulada no escopo da UF (emenda de 2026-09-27 ao ADR-0053, ver
     * {@link EdgeDestinoVoto}): a cauda é a que COMPETE — a anulada sai da soma
     * e de `n_candidatos` — e o número é sobre os votos em disputa, como o de
     * quem compete em `top_candidatos[]`. Se só a anulada sobrava na cauda, o
     * campo `outros` fica ausente.
     *
     * 🔴 É uma SOMA candidato a candidato, **nunca `100 − Σ(top 4)`**. Os
     * pontos de uma UF não fecham em 100 exatamente (cada um é a média de um
     * bootstrap próprio); a subtração empurraria esse resíduo de fechamento
     * para dentro de "Outros" e o publicaria como se fosse voto de alguém.
     * Quem alterar `api/model/project.py` aqui é pego por
     * `tests/unit/model/test_uf_outros.py`, cuja fixture soma 99,1 DE
     * PROPÓSITO para que as duas contas divirjam.
     */
    pct: number;
    /**
     * Σ `pct_atual` da cauda, 0–100, mesma base (e mesma cauda) de `pct`.
     *
     * **TUDO-OU-NADA**: presente só quando TODA candidatura da cauda foi
     * medida. Uma soma parcial diria "os demais somam 3,1%" quando 3,1% é o
     * que UM deles tem e dos outros não se sabe nada — medição servindo de
     * capa para ausência. Na prática some por UF inteira, porque é
     * `impute_uf_from_national` (cargo 1, UF sem nenhuma zona apurada) que
     * anula `pct_atual` de todos de uma vez. **Ausente ⇒ "—", nunca `0`.**
     */
    pct_atual?: number;
    /**
     * Σ `votos_atuais` da cauda. `0` é um **FATO** (zero boletim chegado para
     * todos os demais), não ausência — e por isso este campo pode existir com
     * valor `0` no mesmo objeto em que `pct_atual` está ausente. Só falta em
     * payload legado, cujas linhas de origem não carregavam o campo.
     */
    votos_atuais?: number;
    /**
     * Quantas candidaturas o agregado representa. `>= 1` sempre que `outros`
     * existe (é a própria condição de existência do campo). Serve o rótulo
     * "Outros (7)" e é a razão de este objeto não caber no shape de
     * `top_candidatos[]`.
     */
    n_candidatos: number;
  };
  /**
   * Para corridas de GOVERNADOR no 1T (cargo=3): `true` se o líder
   * projetado tem `pct_projetado >= 50%+1` (decide no 1T); `false` se
   * vai para 2º turno. `null` quando não aplicável (cargo presidencial
   * 1T — a decisão de 2T para presidente é NACIONAL, não estadual; ou
   * cargo gov em 2T). Adicionado em S05/F4c para o grid de governadores
   * (RF-040+ em S06).
   *
   * Em payloads presidenciais S05 fica sempre `null`. Pré-S05 ausente
   * → consumidor coalesce para null.
   */
  vai_a_2t: boolean | null;
  /**
   * Estado declarativo da UF para o grid de governadores e indicadores
   * de status no mapa. Adicionado em S05/F4c (ADR-0017):
   *
   *   - `"chamada"`: UF chamada para o líder (margem decisiva, ver
   *     `chamada: true`). Ortogonal ao `vai_a_2t`.
   *   - `"decidido_1t"`: governador eleito no 1T (`vai_a_2t === false`
   *     e `pct_projetado >= 50%+1`).
   *   - `"vai_2t"`: governador disputa 2T (`vai_a_2t === true`).
   *   - `"indefinido"`: ainda tossup, margem dentro do CI ou apuração
   *     baixa demais para chamar.
   *
   * Pré-S05 ausente → consumidor coalesce para `"chamada"` se
   * `chamada === true`, senão `"indefinido"`.
   */
  bucket: "decidido_1t" | "vai_2t" | "indefinido" | "chamada";
  /**
   * Total PROJETADO de votos em disputa da UF (ADR-0057 item 4, decisão do
   * dono de 2026-09-28) — na MESMA base dos `pct` de `top_candidatos[]` e de
   * `outros.pct`: válidos + sub judice, anulado fora (ADR-0053); no Senado,
   * votos (cada eleitor vota duas vezes). Cargos 1, 3 e 5.
   *
   * É o denominador que faz o consolidado REGIONAL da Projeção
   * (`lib/utils/consolidado-regiao.ts`): `pct / 100 × votos_disputa_projetados`
   * é o voto projetado de cada candidatura, somável entre UFs.
   *
   * **Ausente ⇒ sem projeção regional** ("—"), nunca uma estimativa — payload
   * gravado antes de 2026-09-28 não o tem. Opcional pelo mesmo motivo de
   * `dado_ts` (ADR-0035 D2: campo novo entra opcional).
   *
   * Produtor (`api/model/project.py`, `votos_disputa_projetados`): inteiro
   * `>= 0`, = `base_votaveis_projetada` da UF (o `Σ B_v` da regra de três, o
   * próprio denominador do `pct`) ÷ o fator da base em disputa — e não
   * `Σ votos_projetados`, que só coincide quando os pontos fecham em 100. Com
   * isso `pct / 100 × total ≈ EdgeUfCandidate.votos_projetados` a menos do
   * arredondamento. Também ausente (nunca `0` — não sabemos ≠ zero, decisão do
   * dono de 14/09) em UF sem base, sob `model_fallback_tier` e em UF com todas
   * as candidaturas anuladas.
   */
  votos_disputa_projetados?: number;
}

// ---------------------------------------------------------------------------
// "What's powering the forecast" — composição do modelo
// ---------------------------------------------------------------------------

/**
 * Pesos relativos das 3 fontes que alimentam a projeção. Soma deve ser 1
 * (validar em runtime no orchestrator — T12 — não em tipo).
 *
 * Antes de qualquer apuração: `pre_election` ≈ 1.
 * Durante a apuração: `actual_results` cresce até ≈ 1 no fim.
 * `model` é a contribuição da extrapolação do apurado (S07/Fase 2 — antes
 * era a extrapolação por swing vs. 2022).
 */
/**
 * 🔴 **`pre_election` NÃO é o sinal de fase.** Ver {@link EdgePayload.fase} e
 * o [ADR-0043](../../docs/architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md) D2.
 *
 * Hoje é constante nos quatro emissores — `0.0` em `api/model/project.py` e
 * em `api/model/deputado_payload.py`, `1` nos dois `emptyPayload()` de
 * TypeScript —, ou seja, já não mede fase nenhuma. E quando a spec 008 o
 * tornar peso dinâmico de verdade, ele valerá ~0,95 às 20h05 de 04/10 com
 * 0,01% apurado: esse será o valor **correto** para o modelo, e uma UI
 * gateada nele devolveria a tela ao modo "a eleição não começou" no minuto
 * exato em que ela começou. É uma rede de segurança de mão única — parece uma
 * guarda, aponta para o lado errado.
 */
export interface EdgeComposition {
  pre_election: number; // [0, 1]
  model: number; // [0, 1]
  actual_results: number; // [0, 1]
}

// ---------------------------------------------------------------------------
// Payload principal (chave `projection-current`)
// ---------------------------------------------------------------------------

export interface EdgePayload {
  /** Timestamp ISO 8601 do momento em que o modelo rodou. */
  ts: string;
  /**
   * ISO 8601 UTC — **a hora do dado do TSE** (`max(dg, hg)` entre os boletins
   * que entraram neste ciclo), não a hora em que o modelo rodou. ADR-0038 D1.
   *
   * É o SEGUNDO relógio, e `ts` acima continua sendo o primeiro, com o mesmo
   * significado de sempre. A diferença só importa — e importa muito — no
   * cenário de incidente: se a ingestão parar, o Python continua rodando sobre
   * os últimos snapshots do banco e carimbando um `ts` **fresco** sobre dado
   * **parado**, a cada ciclo, indefinidamente; `dado_ts` congela junto com o
   * TSE. Quem a tela mostra ao leitor passa a ser este; quem data a **escrita**
   * — `splitUfPayload` comparando Blob contra resumo (`lib/blob/uf-detail.ts`),
   * o carimbo de `emptyPayload()`, a validação de borda — continua sendo `ts`.
   *
   * ## Três estados na leitura, três textos — nunca um colapsando no outro
   *
   * Quem classifica é `avaliarFrescorDado` (`lib/config/dado-freshness.ts`):
   *
   *   - `string`  → "Dado do TSE: HH:MM:SS". Passando do limiar do cargo
   *                 (`limiarDadoParadoSegundos`), acende o banner de D4.
   *   - `null`    → nenhum boletim do ciclo trouxe `dg`/`hg` parseável. A tela
   *                 diz "indisponível neste ciclo" e **nunca** fabrica um
   *                 substituto a partir de `ts`: cair para o outro relógio
   *                 reintroduziria exatamente o problema que este campo existe
   *                 para resolver (ADR-0038 D1).
   *   - ausente   → payload gravado por código anterior ao ADR-0038, ou em voo
   *                 durante o canary do Rolling Release (constituição § 7). A
   *                 tela cai para o texto de hoje, associado a `ts`.
   *
   * Opcional no tipo porque o terceiro estado é real por alguns minutos a cada
   * deploy — e é `?:` em vez de `| undefined` justamente para que um payload de
   * teste ou uma fixture antiga continue compilando. `?:` e `| null` são
   * estados **diferentes** aqui, e é proibido colapsá-los com `??`.
   *
   * Do lado da ESCRITA nada precisou mudar: o `.passthrough()` de
   * `app/api/internal/edge-write/route.ts` já aceitava o campo antes de ele
   * existir aqui.
   */
  dado_ts?: string | null;
  /**
   * Quantos pares município×zona deste ciclo ficaram mais de 2 cadências atrás
   * do `dado_ts` **do próprio ciclo** — ADR-0038 D2.
   *
   * Sinal de OPERAÇÃO, nunca manchete: acende o cenário que o máximo sozinho
   * esconde — um par avança e os outros ~6.109 não. É relativo ao ciclo, e não
   * a `now()`, de propósito: quando o TSE simplesmente não tem novidade para
   * ninguém, todos os pares envelhecem juntos e a distância ao máximo continua
   * pequena, então o número **não** acende.
   *
   * `null`/ausente pelos mesmos dois motivos de `dado_ts`.
   */
  pares_atrasados?: number | null;
  cargo: Cargo;
  turno: Turno;
  /** % total apurado da corrida (0–100). */
  pct_apurado_total: number;
  /** Número de UFs com pelo menos 1 zona apurada (0–27). */
  ufs_apuradas: number;
  /**
   * Spec 021 (RF-199) — as contagens absolutas do eleitorado desta
   * abrangência, e a projeção normalizada das quatro fatias.
   *
   * Opcional: payloads anteriores à spec 021 não o têm, e o painel "Votação"
   * degrada para `<DetailUnavailable>` (RF-198) em vez de desenhar zeros.
   */
  votacao?: EdgeVotacao;
  national: EdgeNational;
  por_uf: EdgeUfRow[];
  /**
   * Frases curtas (1–3) geradas por template — NUNCA LLM (constituição § 2,
   * ADR-0005). Cada item é uma sentença completa pronta para renderizar.
   */
  insights: string[];
  composition: EdgeComposition;
  /**
   * **Ausente = fase normal.** Presente = o payload foi **semeado**, não
   * medido: não houve boletim nenhum, e cada número de voto, probabilidade,
   * margem e intervalo neste JSON é um zero **estrutural** — a ausência de
   * medição —, não uma medição que deu zero.
   *
   * Spec 019 / [ADR-0043](../../docs/architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md).
   *
   * ## Por que um campo próprio, e não algo que já existe
   *
   * Um payload zerado tem **forma válida** e significado que o produto nunca
   * foi escrito para representar. Sem este campo, o código existente —
   * correto, para o caso que os autores imaginaram — produz nove afirmações
   * falsas simultâneas, entre elas "Todas as unidades federativas estão com a
   * apuração concluída", "Fulano vence no 1º turno — 0%", um IC de 95%
   * `[0,0; 0,0]` (que é a forma tipográfica da certeza absoluta) e as 27 UFs
   * pintadas com a cor do partido de `top_candidatos[0]`.
   *
   * 🔴 **Nada pode derivar a fase de `pct_apurado_total`.** Às 20h01 de
   * 04/10 o valor real é `0.01` — um zero **medido** —, e por alguns minutos
   * antes disso ele passa por `0` com o orchestrator já rodando. Uma tela
   * gateada no percentual voltaria ao modo pré-eleição no minuto exato em que
   * a apuração começa. O mesmo vale para `por_uf.length`, para
   * {@link EdgeComposition.pre_election} e para data de calendário (que numa
   * rota com `revalidate` congela no build). Ver `lib/config/fase.ts`, que é
   * o **único** lugar autorizado a ler este campo.
   *
   * ## Por que opcional de valor único, e não booleano
   *
   * Mesmo molde de {@link EdgePayload.dado_ts} (ADR-0038): `?:` para "estado
   * ausente", sem segundo valor com que confundi-lo. Um `preEleicao: boolean`
   * reintroduziria o par `false`/`undefined` que já é fonte conhecida de
   * colapso por `??`. Consequências: nenhuma fixture existente precisa mudar,
   * e **a saída da fase é por omissão** — o orchestrator nunca escreve este
   * campo (RF-166), então o primeiro payload real de cada cargo o faz
   * desaparecer sozinho. Ninguém precisa lembrar de desligar nada às 20h.
   */
  fase?: "pre_eleicao";
  /**
   * RF-107 (spec 016) — composição das vagas em disputa por partido.
   * Presente só em cargo que elege mais de um por UF (hoje, Senador).
   */
  composicao_vagas?: EdgeComposicaoVagas;
  /**
   * Série temporal por candidatura do escopo **nacional** — o gráfico de
   * evolução da home (spec 020, RF-167..RF-176).
   *
   * ## Por que aqui, e não num Blob nacional
   *
   * [ADR-0046](../../docs/architecture/adrs/0046-serie-por-candidato-limitada-por-construcao.md)
   * D3. Não existe Blob nacional — {@link EdgePayloadUf} tem um
   * ({@link UfDetailBlob}, ADR-0032), este payload não. E criar um custaria
   * helper de caminho, módulo de leitura, ramo no writer, um `Promise.all` novo
   * na rota de maior tráfego do produto e um segundo relógio de frescor a
   * explicar ao leitor — quatro módulos e uma superfície de falha nova para
   * poupar 6,9 KB.
   *
   * ## O orçamento, em bytes medidos
   *
   * | | Bytes |
   * |---|---|
   * | payload nacional hoje | 17.301 B |
   * | + `serie_por_candidato` (4 candidaturas × 96 pontos × 2 bases) | +6.905 B |
   * | **total** | **~24.206 B** |
   * | teto de aviso por chave nacional (`EDGE_CONFIG_NATIONAL_WARN_BYTES`) | 75 KB |
   *
   * Cabe com folga de 3×, e o teto duro de **120 pontos** (ADR-0046 D2) garante
   * que continue cabendo por mais longa que a noite seja.
   *
   * ⚠️ O teto é em **pontos**, não em bytes (emenda de 2026-09-17): medida no
   * emissor real, a grade cheia de 120 pontos custa entre 8.822 e 9.066 B, e o
   * intervalo existe porque o comprimento do nome de urna é dado do TSE. Este
   * texto dizia "8.553 B por corrida, para sempre" — era estimativa vestida de
   * garantia. Ver a emenda no ADR-0046, que registra também por que a primeira
   * correção (8.775 B) também errou.
   *
   * ⚠️ **A mesma conta proíbe o caminho simétrico para UF.** 27 UF × 3 cargos ×
   * 6.905 B = **559.305 B**, que levariam o store de ~410 KB a ~969 KB — acima
   * do limiar de erro de 940.000 B do writer e a 31 KB do teto de 1 MB, com a
   * escrita **recusada na noite de 04/10**. Por isso {@link EdgePayloadUf} não
   * ganha campo nenhum: a série de UF vive no Blob, em
   * {@link EdgeUfSeriesTemporais.por_candidato}.
   *
   * **Opcional** porque payloads gravados antes da spec 020 seguem válidos — e
   * porque a fase pré-eleição não tem série para emitir. Ausente == "o produtor
   * não emitiu", que a tela trata como estado próprio (`sem_serie`), distinto
   * de "a fonte não respondeu".
   */
  serie_por_candidato?: EdgeSeriePorCandidato;
}

/**
 * RF-107 — quantas das vagas EM DISPUTA a projeção atribui a cada partido.
 *
 * É **agregação, não estimativa**: a contagem de quantas UFs têm um
 * candidato daquele partido entre os `vagas_por_uf` primeiros da projeção
 * estadual. Nenhum modelo nacional roda por trás — e é por isso que o bloco
 * pode existir mesmo sem o TSE publicar arquivo agregado `br-` para o cargo
 * (`temArquivoBr: false` em `lib/config/cargos.ts`; open question 2 da spec
 * 016). A tela precisa dizer isso ao leitor: o número é soma nossa das 27
 * corridas, não um dado nacional do TSE.
 *
 * Os dois denominadores existem porque confundi-los seria o erro de leitura
 * mais provável desta tela: em 2026 o Senado renova **54** das suas **81**
 * cadeiras. Uma contagem de vagas apresentada sobre 81 sugeriria que o
 * Senado inteiro está sendo eleito.
 */
export interface EdgeComposicaoVagas {
  /** Cadeiras que a eleição de 2026 renova. 54 no Senado. */
  vagas_em_disputa?: number;
  /** Tamanho da casa inteira. 81 no Senado — as 27 não renovadas seguem lá. */
  total_cadeiras?: number;
  /** Cadeiras por UF neste cargo (2 no Senado em 2026). */
  vagas_por_uf: number;
  /** UFs que já têm projeção — as que entregaram vaga a alguém. */
  ufs_projetadas: number;
  /**
   * UFs sem nenhum boletim. Sem este número a soma de `por_partido` não
   * fecharia com `vagas_em_disputa` e o leitor concluiria que sumiram vagas,
   * quando o que falta é apuração.
   */
  ufs_aguardando: number;
  /** Σ de `por_partido[].vagas` — `ufs_projetadas × vagas_por_uf`. */
  vagas_projetadas: number;
  /** Ordenado por vagas desc, sigla asc (determinismo — constituição § 6). */
  por_partido: Array<{ partido: string; vagas: number }>;
}

// ---------------------------------------------------------------------------
// Payload de drill-down por UF (chave `projection-uf-<sigla>`)
// ---------------------------------------------------------------------------

/**
 * CI95 inferior/superior em pp (0–100) — usado tanto na agregação UF quanto
 * por candidato individual. Mantemos uma struct nomeada (em vez de tuple
 * `[lower, upper]`) para evitar acesso posicional em consumidores e dar
 * nomes ao que está ambíguo num par numérico.
 */
export interface EdgeCi95 {
  lower: number; // 0–100
  upper: number; // 0–100
}

/**
 * Candidato dentro do drill-down de UF. Subset do `EdgeCandidate` nacional
 * (sem `p_vitoria` — só faz sentido no agregado nacional). `ci95` é o
 * intervalo de confiança do `pct_projetado`.
 *
 * `votos_atuais` e `votos_projetados` são absolutos NA UF — alimentam a
 * coluna "Votos" do `<CandidateRow />` (RF-033) e a métrica "Total: X
 * reportados" do wireframe da spec 004. Adicionados em S04/F2 para que a
 * página de UF deixe de exibir "—" no slot de votos.
 */
export interface EdgeUfCandidate {
  id: number;
  nome: string;
  partido: string;
  /**
   * Destinação do voto desta candidatura (`cand[].dvt`, ADR-0053 / RF-213).
   * 🔴 **Emitido SÓ quando `"anulado"` ou `"sub_judice"`** — `"valido"`
   * nunca é gravado nesta lista (2026-09-27: 19 B por candidatura, ~6 KB no
   * Senado nacional, derrubavam a folga de 2× do limiar do payload).
   * `"anulado"` ⇒ NÃO compete: a tela a põe no fim da lista com a etiqueta
   * "Anulado" e a ignora ao derivar líder, margem, vagas e cor do mapa.
   * `"sub_judice"` ⇒ compete (segue o TSE), com etiqueta "Sub judice".
   * **Ausente** ⇒ compete: válida, OU o TSE ainda não publicou (antes da 1ª
   * totalização parcial), OU os arquivos divergiram — a tela nunca supõe
   * anulado e não distingue os três casos (quem precisa distinguir válido de
   * "ainda não publicado" é `votacao.corrida[]`, que continua emitindo
   * `"valido"`). Base dos percentuais: ver {@link EdgeDestinoVoto} — com
   * anulada no escopo, quem compete sai sobre os votos em disputa e a anulada
   * fica sobre `vvc` (e não é exibida). O tipo segue `EdgeDestinoVoto` para não quebrar consumidores; o
   * produtor não grava `"valido"` aqui.
   */
  destino?: EdgeDestinoVoto;
  /** @deprecated Ver {@link EdgeCandidate.cor}. Aposentado em 2026-09-19. */
  cor?: string;
  /** Votos absolutos REPORTADOS no momento (TSE). */
  votos_atuais: number;
  /** Votos absolutos PROJETADOS (modelo) ao final da apuração da UF. */
  votos_projetados: number;
  /**
   * 0–100 sobre `vvc`, ou — com anulada no escopo desta UF (Presidente: as
   * nacionais; Gov/Sen: as da UF) — sobre os votos em disputa, para quem
   * compete. A anulada fica em `vvc` e não é exibida. Ver {@link EdgeDestinoVoto}.
   */
  pct_atual: number;
  /** 0–100. Mesma base de `pct_atual`. */
  pct_projetado: number;
  /** IC95 de `pct_projetado`, mesma base e MESMO fator do ponto. */
  ci95: EdgeCi95;
  /**
   * Mesmo candidato na segunda base — % sobre quem compareceu NESTA UF
   * (S07/Fase 2, decisão E2). `pct_atual`/`pct_projetado`/`ci95` acima
   * seguem na base `votaveis`. Ver `EdgeBaseComparecimento`.
   */
  comparecimento?: EdgeBaseComparecimento;
  /**
   * RF-103 (spec 016) — probabilidade em [0, 1] de o candidato terminar
   * entre os `EdgePayloadUf.vagas` primeiros, ou seja, de **se eleger**.
   *
   * Não é `p_vitoria` com outro nome. Numa corrida de duas vagas — o Senado
   * em 2026 — liderar não decide nada: o 2º colocado é senador exatamente
   * como o 1º. A frequência é medida POR CENÁRIO nas reamostras do bootstrap
   * (`api/model/p_vitoria.py::p_eleito`), não por comparação de
   * distribuições marginais, o que garante que a soma dos `p_eleito` da UF
   * fecha em `vagas` e não em 1.
   *
   * **Opcional**, e por três motivos distintos:
   *   1. payloads de Presidente/Governador não o trazem — lá a pergunta
   *      certa continua sendo `p_vitoria`;
   *   2. payloads gravados antes da spec 016 não o têm;
   *   3. ausência ≠ zero. `0.0` afirmaria "não se elege em cenário nenhum",
   *      que é um dado; a chave ausente diz "não foi calculado".
   *
   * ⚠️ **Leia junto com `ci95`.** Esta degeneração valia enquanto o cargo era
   * ingerido em granularidade UF: com uma única unidade de reamostragem por
   * estado, o bootstrap devolve réplicas idênticas, o `ci95` sai com largura
   * zero e este número degenera para 0 ou 1. **Senador saiu de UF em
   * 2026-09-11** e Deputado Federal no **ADR-0036 (13/09)**, então hoje isso só
   * acontece sob o interruptor de emergência `TSE_DEPUTADO_GRANULARIDADE=uf`. Ele continua correto
   * ("dado o ponto estimado, estes dois estão à frente") mas **não carrega
   * incerteza amostral** — quem for exibi-lo como "chance" precisa checar
   * `ci95.upper > ci95.lower` antes.
   */
  p_eleito?: number;
  /**
   * Identidade **global e estável** do candidato (`SQ_CANDIDATO` do TSE) —
   * ADR-0042 item 2; endereça a foto (ADR-0041) via
   * `blobUrlFor(candidatoFotoBlobPathname(uf, sqcand))`. A URL não viaja no
   * payload: é derivável desta chave.
   *
   * **`string`, não `number`** — 11 **ou** 12 dígitos; comparar as duas
   * larguras como texto ordena errado em silêncio.
   *
   * Ao contrário de {@link EdgeCandidate.sqcand}, aqui vem em **todo cargo**:
   * este payload é de UMA UF, então o par `(uf, numero)` que o resolve não é
   * ambíguo (spec 018, RF-144). Ausente quando o EA20 não trouxe `sqcand`
   * para aquele candidato, ou em payload pré-018.
   */
  sqcand?: string;
}

/**
 * Linha de município no drill-down de UF. Suficiente para alimentar
 * `<MunicipioTable />` (RF-037) e os mapas (`UFMapDuo`, `BubbleMap`).
 *
 * S04/F2 — antes só tínhamos `{cod_ibge, nome, pct_apurado, lider}`,
 * o que forçava `<MunicipioTable />` a usar placeholders para margem e
 * votos. Enriquecemos para que a tabela mostre dados reais.
 *
 * `votos_reportados` é um mapa `{candidato_id → votos}` (não um total) —
 * permite o caller calcular margem absoluta para qualquer par de
 * candidatos, e somar para obter o total do município. Pequeno em
 * bytes (até ~4–6 entradas por município = 30–60 bytes/município),
 * dentro do orçamento de payload UF.
 *
 * `cod_ibge` é STRING (char(7) IBGE — preserva zero à esquerda;
 * data-model.md § Municípios usa o mesmo tipo). Manter aqui como
 * string é canônico — `00000NN` não cabe em `number` sem perda.
 *
 * ===========================================================================
 * 🔴 NÃO existe campo projetado aqui, e isso é DECISÃO, não lacuna
 * ===========================================================================
 *
 * **Decisão do dono, 2026-09-21: o município permanece sem dado de projeção.**
 * Investigado a pedido dele antes de decidir; o relatório está resumido na
 * dívida 21 (`docs/reference/dividas-tecnicas.md`).
 *
 * Por isso o mapa de municípios é o único que **não acompanha o seletor
 * Parcial/Projeção** — não há uma segunda base para onde alternar. O que ele
 * pinta é a soma exata dos boletins que chegaram, e só.
 *
 * O motivo NÃO é falta de código. `fetch_municipio_aggregates`
 * (`api/model/project.py:1525-1684`) é uma soma bruta de `cand[].vap` por
 * município, sem o fator `k` da regra de três — uma cadeia paralela à da
 * projeção, que nunca lê município: `compute_uf_projections`
 * (`api/model/project.py:2386-2612`) recebe só zonas, e o bootstrap
 * (`api/model/extrapolation.py:190-370`) reamostra zonas.
 *
 * O motivo é estatístico. A incerteza é medida reamostrando as zonas de cada
 * grupo, e **5.380 dos 5.569 municípios (96,6%) têm uma zona só**
 * ([ADR-0035](../../docs/architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md),
 * Contexto: 189 municípios têm mais de uma). Reamostrar n=1 mil vezes devolve
 * um intervalo de **largura zero** — o site afirmaria certeza absoluta sobre
 * uma cidade onde quase nada foi contado. É exatamente a falsa precisão que o
 * RF-015 já proíbe para zonas imputadas
 * (`docs/specs/002-modelo-estatistico/spec.md:113`) e que a constituição § 1
 * proíbe em geral. E são as cidades pequenas — mediana de ~9.400 eleitores,
 * uma em cada quatro com menos de 5.000 — que cairiam nesse mecanismo
 * degenerado.
 *
 * ⚠️ Se alguém reabrir isto: **não** ratear a projeção da UF entre os
 * municípios, nem por regra de três local nem proporcional ao eleitorado.
 * Seria publicar número inventado com cara de apuração (constituição § 1 e
 * § 6). Reabrir custa ADR próprio, e o caminho estreito investigado foi
 * projetar **só o líder** do município, com a incerteza herdada da zona — não
 * uma série por candidato, que o
 * [ADR-0032](../../docs/architecture/adrs/0032-detalhe-municipal-vercel-blob.md)
 * já desaconselha por volume (+~3 MB por cargo).
 */
export interface EdgeUfMunicipio {
  cod_ibge: string;
  nome: string;
  pct_apurado: number; // 0–100
  /** Líder no município com a margem em pp sobre o segundo. */
  lider: {
    candidato_id: number;
    /** Partido do líder, para chip da tabela. */
    partido: string;
    /** Votos absolutos do líder no município. */
    votos: number;
    /**
     * Margem em pp sobre o 2º (sempre ≥ 0). Denominador: o total de votos do
     * município, ou — com anulada no escopo da UF e com voto no município —
     * os votos EM DISPUTA (total − votos das anuladas). O líder e o 2º são
     * sempre de quem compete. Ver {@link EdgeDestinoVoto}.
     */
    margem_pp: number;
  };
  /**
   * Votos absolutos por candidato no município. Sparse — só candidatos
   * com presença nos snapshots. Chave numérica (candidato_id).
   */
  votos_reportados: Record<number, number>;
  /**
   * Eleitorado apto do município — **soma exata** dos pares `(município,
   * zona)` que caem nele (`SUM(eleitores_aptos) GROUP BY uf,
   * cod_municipio_tse` em `fetch_municipio_eleitorado`, api/model/project.py).
   * Sem rateio: o CSV do TSE publica o eleitorado por par, então o total do
   * município é dado, não estimativa (ADR-0035 D2, constituição § 6).
   *
   * OPCIONAL de propósito (decisão D-d): payloads gravados antes da migration
   * 0006 e a fixture `tests/fixtures/blob/uf-municipios-pres-t1.json` seguem
   * válidos sem o campo. Ausente → o consumidor esconde o subtítulo
   * "N eleitores" e ordena a tabela só pelo que tiver.
   */
  eleitores?: number;
  /**
   * `true` quando o município é a capital da UF (`municipios.capital`, seed
   * estático das 27 capitais na migration 0006).
   *
   * OPCIONAL e **emitido só quando verdadeiro** — são 27 em ~5.570
   * municípios, e 644 `"capital": false` por payload de SP não pagariam o
   * próprio peso. Ausente == não é capital. Ordena o painel "Maiores
   * colégios eleitorais" (capital primeiro — decisão E4).
   */
  capital?: boolean;
}

/**
 * Série temporal **por candidatura** — forma colunar
 * ([ADR-0046](../../docs/architecture/adrs/0046-serie-por-candidato-limitada-por-construcao.md) D1).
 *
 * É a primeira série do projeto que precisa resolver "N candidatos × M pontos"
 * e não apenas "M pontos": as três séries de {@link EdgeUfSeriesTemporais}
 * (margem, p_vitoria, turnout) falam da **corrida**, uma única linha cada.
 *
 * ## Por que colunar, e não `Array<{ ts, pct }>` por candidato
 *
 * Medido sobre JSON minificado, janela de 8h, 4 candidaturas × 2 bases
 * (apurado e projetado):
 *
 * | Forma                       | 480 pontos | 96 pontos |
 * |-----------------------------|------------|-----------|
 * | Array de objetos `{ts,pct}` | 160.460 B  | 32.356 B  |
 * | **Colunar** (este tipo)     |  33.249 B  | **6.905 B** |
 *
 * O custo inteiro da forma rejeitada é a chave `"ts"` repetida 3.840 vezes —
 * a mesma string, byte a byte, guardada uma vez por PONTO em vez de uma vez
 * por SÉRIE.
 *
 * ## Teto por construção
 *
 * `SERIE_MAX_PONTOS = 120` (ADR-0046 D2): a cadência é o menor valor de
 * `[5, 10, 15, 30]` minutos tal que `ceil(janela_min / cadência) ≤ 120`. O teto
 * **re-bucketiza**, nunca corta o começo da noite. É esse teto — o de **pontos**
 * — que permite ao escopo nacional viver no Global Config sem reabrir o
 * ADR-0032 (ver {@link EdgePayload.serie_por_candidato}).
 *
 * ⚠️ **Não há teto constante em bytes** (emenda de 2026-09-17). Este texto dizia
 * "8.553 B por corrida, para sempre". Medida no emissor real, a grade cheia
 * custa entre 8.822 e 9.066 B — o intervalo depende do comprimento do nome de
 * urna, que é dado do TSE e não está sob nosso controle. A garantia que sustenta
 * a decisão é `≤ 120 pontos`, e é só essa.
 *
 * Cada balde é representado pelo ponto de **maior `dado_ts`** dentro dele (o
 * último), nunca pela média: média suavizaria descontinuidades e poderia fazer
 * uma quantidade quase-monotônica regredir, o que a spec 020 proíbe como
 * critério de aceitação (RF-168-b). E o balde é derivado do **epoch de
 * `dado_ts`**, não do índice do array — um ciclo perdido não desloca os pontos
 * publicados antes dele (constituição § 6, determinismo).
 */
export interface EdgeSeriePorCandidato {
  /**
   * Eixo horizontal compartilhado por TODAS as séries: ISO 8601 UTC compacto
   * (`2026-10-04T20:05:00Z`), ordem **ASC** (constituição § 6).
   *
   * O relógio é o do **dado** (`dado_ts`, a hora do boletim do TSE) e não `ts`,
   * a hora em que o modelo rodou (ADR-0038 D1). Com o relógio errado, uma
   * ingestão parada desenharia uma linha que continua avançando no eixo sobre
   * dado congelado.
   *
   * ⚠️ **Cada rótulo é o INÍCIO DO BALDE, não o `dado_ts` exato do boletim que
   * representa aquele balde** (emenda de 2026-09-17, Fase 2 — este texto dizia
   * "é `dado_ts`" e o produtor emite a grade). Dois motivos, e o primeiro é
   * obrigatório:
   *
   *   1. Um balde em que **nenhum** ciclo caiu precisa existir no eixo para
   *      virar `null` na coluna de cada candidatura, que é como o traço
   *      INTERROMPE (RF-175b). Um balde vazio não tem boletim para nomear —
   *      logo o eixo tem de ser a grade, não a lista de instantes reais.
   *      Publicar só os instantes medidos faria o furo virar um segmento reto
   *      interpolado, exatamente o que a spec 020 proíbe.
   *   2. A grade regular é o que torna `eixo.length <= SERIE_MAX_PONTOS`
   *      verdadeiro por construção e o que fixa o teto de bytes — o eixo é a
   *      string mais repetida do payload.
   *
   * Consequência para o consumidor, que precisa ser dita ao leitor de tela e
   * não escondida: a hora impressa na tabela acessível é a do balde
   * (`20:05:00`), não a do boletim (`20:07:13`). O erro é de no máximo uma
   * cadência, e é o preço de poder desenhar a ausência.
   *
   * **Contrato de comprimento:** `eixo.length === apurado.length ===
   * projetado.length` para todo candidato. É o que torna a forma colunar
   * legível: o valor de índice `i` de qualquer candidato pertence ao instante
   * `eixo[i]`.
   */
  eixo: string[];
  /**
   * Espaçamento nominal entre baldes, em minutos — **declarado pelo produtor,
   * nunca inferido** pelo consumidor a partir de `eixo`.
   *
   * Inferir de `eixo[1] - eixo[0]` daria a resposta errada exatamente quando
   * ela importa: o primeiro intervalo pode conter um furo (ciclo perdido, atraso
   * do TSE), e o consumidor passaria a noite inteira desenhando com a cadência
   * errada por causa de um buraco no começo.
   */
  cadencia_min: number;
  /**
   * As candidaturas do gráfico, **na ordem de exibição** — a ordem do array é
   * contrato (ADR-0046 D4, RF-170c). O consumidor renderiza na ordem recebida e
   * **não re-ordena**.
   *
   * O elenco é decidido no produtor, pelo comparador `pct_atual desc →
   * pct_projetado desc → candidato_id asc` (o mesmo de `rankByParcial`), e
   * **não** pelo rank que o Python já calcula só por `pct_projetado`: os dois
   * divergem exatamente quando apurado e projetado discordam de ordem — isto é,
   * na noite da apuração, com alguém olhando o gráfico e o painel de resultado
   * logo acima ao mesmo tempo.
   *
   * Consequência de produto aceita e registrada (ADR-0046, seção dedicada): a
   * candidatura que cai do elenco desaparece do gráfico **inclusive do seu
   * próprio passado**.
   */
  candidatos: EdgeSerieCandidato[];
}

/**
 * Uma candidatura dentro de {@link EdgeSeriePorCandidato} — duas colunas de
 * valores alinhadas ao `eixo` compartilhado.
 *
 * 🔴 **`null` é o valor de um balde sem ciclo — nunca `0`.**
 *
 * É a regra dos três estados do dono aplicada a um ponto de série. "Não
 * medimos neste balde" e "mediu-se zero por cento" são fatos diferentes, e
 * colapsá-los num `0` (ou num `?? 0` no consumidor) desenha um mergulho ao
 * chão que nunca aconteceu: um furo na linha vira uma queda a 0% e volta, ao
 * vivo, no meio da noite. O consumidor deve quebrar o traçado em dois no furo —
 * nunca interpolar, nunca zerar. É a mutação que este tipo mais teme, e o
 * motivo de as colunas serem `(number | null)[]` e não `number[]`.
 */
export interface EdgeSerieCandidato {
  /** `candidato_id` — o mesmo id de {@link EdgeCandidate.id}. */
  id: number;
  /** Nome de urna, como aparece na legenda e na tabela acessível. */
  nome: string;
  /**
   * Sigla do partido/federação. **A cor da linha sai DAQUI**, via
   * `colorForParty(partido)` (ADR-0024/ADR-0031) — nunca do campo
   * {@link EdgeCandidate.cor}, que ainda publica `var(--color-cand-{rank})`,
   * a cor por rank que o ADR-0024 aposentou.
   *
   * Consumir `cor` aqui reintroduziria o defeito no único componente do produto
   * onde ele seria visível como **movimento**: a linha trocaria de cor ao vivo,
   * no instante exato de uma ultrapassagem (ADR-0046 D5).
   */
  partido: string;
  /** `SQ_CANDIDATO` do TSE, quando conhecido. */
  sqcand?: string;
  /**
   * Fatia de votos **apurada** da candidatura em cada balde, 0–100, alinhada a
   * `eixo` por índice. `null` = balde sem medição (ver a nota do tipo).
   *
   * ⚠️ Não confundir com `pct_apurado`, que em toda a pilha é o **progresso da
   * apuração**. Aqui a grandeza é a fatia da candidatura — mesma unidade,
   * significado oposto.
   *
   * Base: a do placar do mesmo escopo (ver {@link EdgeDestinoVoto}). Com
   * anulada no escopo, cada ponto de quem compete é sobre os votos em disputa
   * DAQUELE balde, com o conjunto de anuladas de agora aplicado à noite
   * inteira; balde em que o apurado de uma anulada não foi medido vira `null`
   * (base desconhecida), nunca um número em outra base. A anulada não entra
   * no elenco, nem quando sobra vaga.
   */
  apurado: (number | null)[];
  /**
   * Fatia de votos **projetada** da candidatura em cada balde, 0–100, alinhada
   * a `eixo` por índice. `null` = balde sem medição. Mesma base de `apurado`.
   */
  projetado: (number | null)[];
}

/**
 * Séries temporais da corrida na UF. Cada array é ordenado por `ts` ASC
 * (constituição § 6 — determinismo). Janela = últimas 24h ou início da
 * apuração, o que for menor (filtro aplicado no orchestrator).
 *
 * Origem: SELECT em `projections` filtrado por (cargo, turno, uf), agrupado
 * por `ts` — cada ciclo do modelo (60s) gera 1 ponto. Em 8h de apuração
 * isso dá até 480 pontos por série × 3 séries = 1440 valores numéricos
 * (~30–40 KB serializado). Dentro do envelope ~5–10 KB declarado em
 * data-model.md? **Não.** Carry-over: se aproximar dos 450KB no payload
 * total da UF, paginar via chave separada `projection-uf-<sigla>-series`.
 */
export interface EdgeUfSeriesTemporais {
  /** Margem do líder ao longo do tempo (RF-040). Em pp. */
  margem: Array<{ ts: string; margem_pp: number }>;
  /** p_vitoria do líder ao longo do tempo (RF-041). p em [0, 1]. */
  p_vitoria: Array<{ ts: string; p: number }>;
  /** % apurado da UF ao longo do tempo (RF-042). Monotônico não-decrescente. */
  turnout: Array<{ ts: string; pct_apurado: number }>;
  /**
   * Série por candidatura desta UF (spec 020) — o gráfico de evolução das
   * páginas `/uf/[sigla]`, `/uf/[sigla]/governador` e `/uf/[sigla]/senador`.
   *
   * Mora **aqui dentro**, e portanto no objeto Blob do ADR-0032, e não numa
   * chave de Global Config: o multiplicador de 27 UF × 3 cargos torna a conta
   * proibitiva (559.305 B; ver {@link EdgePayload.serie_por_candidato} para a
   * conta inteira). ADR-0046 D3.
   *
   * Nada precisou mudar em `splitUfPayload` (`lib/blob/uf-detail.ts`) para
   * isto viajar: o destructuring já leva o objeto de séries **inteiro** ao
   * Blob, com o campo novo dentro.
   *
   * **Opcional** — blobs gravados antes da spec 020 seguem válidos, e
   * `isUfDetailBlob` é permissiva de propósito (exige apenas `ts`, `uf` e
   * `municipios` array).
   */
  por_candidato?: EdgeSeriePorCandidato;
}

/**
 * Linha agregada por mesorregião IBGE — S06/F4d (Fase 2).
 *
 * Adicionada para alimentar o bloco "Apuração por mesorregião" da página
 * `/uf/[sigla]/governador` (spec 005, print 3 NYT-style). A agregação é
 * feita server-side por `aggregate_by_mesorregiao` (api/model/project.py)
 * sobre `municipios.mesorregiao_cod` (migration 0005).
 *
 * Footprint: ~80–120 bytes por linha JSON. SP (~15 mesorregiões) gera
 * ~1.5–2 KB extras no payload UF — cabe no budget de 20 KB.
 *
 * Origem (agregação backend): cada município contribui com
 * `votos_reportados` agregados na mesorregião; `lider_*` é o candidato
 * com mais votos na mesorregião; `pct_apurado` é a média ponderada pelo
 * total de votos por município (consistência com agregação UF).
 *
 * `delta_vs_2022` é OPCIONAL (null quando não há histórico mapeado para
 * a mesorregião — caso comum em dev/preview enquanto seed histórico de
 * mesorregião não chega).
 *
 * Determinismo (constituição § 6): array ordenado por `cod` ASC.
 */
export interface EdgeMesorregiao {
  /** Código IBGE da mesorregião (4 chars, ex.: "3515" = SP / Metropolitana). */
  cod: string;
  /** Nome IBGE da mesorregião (ex.: "Metropolitana de São Paulo"). */
  nome: string;
  /** % apurado médio (ponderado pelo total de votos por município) na mesorregião. */
  pct_apurado: number; // 0–100
  /** ID do candidato líder agregado na mesorregião. */
  lider_candidato_id: number;
  /**
   * % do líder sobre o total de votos agregados — ou, com anulada no escopo
   * da UF e com voto na mesorregião, sobre os votos EM DISPUTA (total − votos
   * das anuladas). O líder é sempre de quem compete. Ver {@link EdgeDestinoVoto}.
   */
  lider_pct: number; // 0–100
  /** Margem em pp do líder sobre o 2º (≥ 0). Mesmo denominador de `lider_pct`. */
  margem: number; // 0–100
  /**
   * Swing em pp do `lider_pct` vs 2022 (positivo = ganho do líder atual
   * em relação ao líder de 2022 na mesma mesorregião). `null` quando
   * histórico 2022 não está mapeado para a mesorregião — UI deve
   * mostrar "—".
   */
  delta_vs_2022: number | null;
  /** Quantos municípios compõem a mesorregião (debug/tooltip). */
  num_municipios: number;
}

/**
 * Drill-down de UMA UF. Chave canônica: `projection-uf-<sigla>` (ex.
 * `projection-uf-SP`). ~5–10 KB por UF conforme data-model.md § "Payload do
 * Edge Config" linha 158. Inclui municípios para o mapa zoom-in.
 *
 * `needle_position` / `needle_band` aqui são da CORRIDA NESTA UF (governador
 * num turno; para presidente, refletem a vantagem do líder na UF). Quando a
 * spec for presidente turno 2 numa UF, a agulha vira o "termômetro" da UF
 * para a chamada do vencedor nacional.
 */
export interface EdgePayloadUf {
  /** Sigla de 2 letras maiúsculas (ex. "SP", "DF"). */
  uf: string;
  ts: string;
  /**
   * ISO 8601 UTC — a hora do dado do TSE **desta UF** (`max(dg, hg)` entre os
   * pares da UF que entraram no ciclo). ADR-0038 D1/D2. Ver
   * {@link EdgePayload.dado_ts} para os três estados e por que `null` e
   * ausente não podem ser colapsados.
   *
   * Por UF, e não só no agregado nacional, porque a ingestão degrada
   * **regionalmente** — um problema de rede específico, um lock preso que só
   * afeta parte do fan-out — sem que o nacional acuse nada. É o mesmo
   * argumento que já deu `ts` próprio ao Blob de detalhe municipal
   * (ADR-0032).
   */
  dado_ts?: string | null;
  /**
   * Pares desta UF mais de 2 cadências atrás do `dado_ts` do próprio ciclo —
   * ADR-0038 D2. Ver {@link EdgePayload.pares_atrasados}. Sinal de operação,
   * nunca manchete.
   */
  pares_atrasados?: number | null;
  cargo: Cargo;
  turno: Turno;
  pct_apurado: number; // 0–100
  candidatos: EdgeUfCandidate[];
  needle_position: number; // [-1, 1]
  needle_band: NeedleBand;
  /**
   * RF-105/RF-106 (spec 016) — quantas cadeiras esta UF elege nesta corrida.
   *
   * Existe para que a tela não precise hardcodar "2". O número é uma
   * propriedade da eleição, não do layout: em 2026 o Senado renova 2/3, o
   * que são **duas** vagas por estado; em 2030 será uma. Com o campo no
   * payload, a mudança é de dado.
   *
   * **Opcional**: Presidente e Governador elegem 1 e não emitem o campo;
   * payloads pré-spec-016 também não o têm. Consumidor ausente ⇒ 1.
   *
   * A fonte do valor é `lib/config/cargos.ts` (`vagasPorUf`), espelhada em
   * `api/model/cargos.py` com teste de sincronia.
   */
  vagas?: number;
  /**
   * RF-102/RF-108 (spec 016) — em que unidade a regra de três do ADR-0021
   * foi aplicada nesta UF.
   *
   * `"zona"` em Presidente e Governador (a projeção agrega ~200 zonas
   * independentes por estado); `"uf"` em Senador e Deputado Federal, que o
   * ADR-0026 item 1 ingere por UF — ali a projeção nasce de um único
   * boletim agregado do estado.
   *
   * Não é telemetria interna: a diferença muda o que a projeção significa, e
   * a constituição § 8 obriga a tela a dizê-lo (RF-108). **Opcional** para
   * payloads anteriores à spec 016.
   */
  granularidade?: "uf" | "zona";
  /**
   * `municipios` e `series_temporais` NÃO estão mais aqui — ADR-0032,
   * 2026-09-08. Os dois vivem no Vercel Blob, num objeto por UF/cargo/turno
   * (`lib/blob/uf-detail.ts` → `UfDetailBlob`), lido em paralelo com este
   * payload. Quem monta o payload para gravar usa `UfPayloadInput` (abaixo),
   * que ainda os carrega; quem LÊ do Global Config recebe este tipo, sem eles.
   *
   * A série por candidato que o ADR-0014 reservou como chave dedicada
   * `projection-uf-<sigla>-series-por-cand` fica resolvida antes de existir: o
   * destino dela é o mesmo objeto Blob (ou um irmão no mesmo esquema de
   * caminho), nunca uma chave nova de Global Config — uma série por candidato
   * multiplica o custo de `series_temporais` pelo número de candidatos.
   *
   * **Cumprido em 2026-09-17 (ADR-0046 D3):** a série de UF é
   * {@link EdgeUfSeriesTemporais.por_candidato}, dentro do mesmo objeto Blob.
   * Este tipo segue sem campo novo, e a reserva acima segue valendo para o
   * escopo de UF — o multiplicador de 27 é exatamente o que a proíbe aqui. O
   * escopo **nacional**, que não tem esse multiplicador nem tem Blob, entra em
   * {@link EdgePayload.serie_por_candidato} — campo aditivo numa chave que já
   * existe, não uma chave nova.
   */
  /**
   * Agregação por mesorregião IBGE — S06/F4d (Fase 2). Alimenta o bloco
   * "Apuração por mesorregião" da página `/uf/[sigla]/governador` (print 3
   * NYT-style). Lista ordenada por `cod` ASC (constituição § 6).
   *
   * **Optional** porque:
   *   - Payloads pré-S06/F4d não têm essa chave.
   *   - Em dev/preview o seed de `municipios.mesorregiao_cod` (migration
   *     0005) pode ainda não estar populado — orchestrator omite o campo
   *     em vez de emitir array vazio (semântica: "dado não disponível",
   *     não "zero mesorregiões").
   *
   * Consumidores devem coalescer para `[]` e UI deve esconder o bloco
   * inteiro quando ausente (não mostrar título "Apuração por mesorregião"
   * sem conteúdo).
   *
   * Footprint estimado: 80–120 bytes/linha. SP (~15 meso) ≈ 1.5–2 KB;
   * UFs pequenas (SE = 2 meso) ≈ <0.3 KB. Dentro do budget de 20 KB/UF.
   */
  mesorregioes?: EdgeMesorregiao[];
  /**
   * @deprecated S07/Fase 2 — o K-1 3-tier (ADR-0015) existia porque a
   * projeção usava 2022 como âncora e precisava de um plano B quando o
   * histórico da zona faltava. Com a projeção extrapolada do apurado
   * (regra de três por zona), o fallback deixa de ter função: UF sem urna
   * usa a proporção nacional e se declara via
   * `participacao.metodo.tipo === "imputado_nacional"`. A coluna
   * `projections.model_fallback_tier` permanece no schema (sem migration) e
   * o campo segue aqui só para não quebrar payloads já gravados — novos
   * consumidores não devem lê-lo. ADR-0021 (em elaboração) formaliza.
   *
   * K-1 3-tier fallback (ADR-0015 / spec 002 K-1) — qual tier do bootstrap
   * histórico foi efetivamente usado para esta UF nesta rodada do modelo:
   *
   *   - `1` ("ouro"): cobertura ≥ 80% de zonas com mapping direto histórico
   *     (cargo + UF + zona) — caminho default. Sem disclaimer extra na UI.
   *   - `2` ("prata"): tier 2 acionado por insuficiência de histórico no nível
   *     zona. Bootstrap usa pre-election polls (api/model/pre_election_polls.py)
   *     ou aproximação no nível UF. UI mostra disclaimer K-1 ("projeção
   *     baseada em pesquisa pré-eleição; precisão menor").
   *   - `3` ("bronze"): tier 3, último recurso — projeção sintetizada de
   *     prior nacional. UI mostra disclaimer reforçado.
   *
   * Adicionado em S06/F4d Fase 5 (carry-over): a Fase 4 casteava como
   * `unknown` (`(payload as { model_fallback_tier?: number })`) porque o
   * campo não estava no tipo formal. Aqui formalizamos: opcional pra
   * forward-compat com payloads pré-S05 que não emitiam o campo (consumidor
   * coalesce para `1` = tier ouro = sem disclaimer, comportamento default).
   *
   * Origem do dado: `projections.model_fallback_tier` (smallint, migration
   * 0004), populado pelo orchestrator em `_do_project` via `compute_uf_projections`.
   * O serializador `build_uf_payloads` em api/model/project.py é responsável
   * por propagar a coluna pro payload UF (S06/F4d Fase 5 — pode requerer
   * complemento Python pra serializar; tracked como carry-over técnico de
   * acompanhamento se ainda ausente no payload de produção).
   */
  model_fallback_tier?: 1 | 2 | 3;
  /**
   * Participação NESTA UF (abstenção, brancos/nulos, "Outros") — S07/Fase 1a.
   * Mesma semântica de `EdgeNational.participacao`, calculada sobre as zonas
   * da UF. Alimenta os termômetros das páginas `/uf/[sigla]` e
   * `/uf/[sigla]/governador` no 1º turno.
   *
   * **Opcional** — payloads pré-S07 não têm a chave; métricas não
   * calculáveis são omitidas individualmente (não emitir 0).
   */
  participacao?: EdgeParticipacao;
  /**
   * Spec 022 RF-209 + spec 021 RF-192 (emendado 26/09 noite) — contagens,
   * projeção e corrida do agregado da UF: alimenta o painel "Votação" e o
   * painel "A corrida" da tela de UF. **Opcional**: ausente ⇒
   * `<DetailUnavailable>` nos dois (RF-198 / RF-207).
   */
  votacao?: EdgeVotacaoUf;
}

/**
 * O payload de UF **como o orchestrator o envia** — resumo mais o detalhe que
 * o ADR-0032 tirou do Global Config.
 *
 * Existe porque a fronteira campo a campo é aplicada do lado TypeScript, num
 * ponto só (`splitUfPayload`, `lib/blob/uf-detail.ts`): o Python segue
 * emitindo `municipios` e `series_temporais` no mesmo objeto, e a rota
 * `/api/internal/edge-write` separa o que vai para cada mecanismo. Sem este
 * tipo, `EdgePayloadUf` teria que continuar declarando dois campos que o
 * Global Config não guarda mais — o tipo armazenado mentindo sobre o store.
 *
 * Consumidores de LEITURA nunca veem este tipo: `readUfProjection` devolve
 * `EdgePayloadUf`, e o detalhe vem de `readUfDetail` (Blob), em paralelo.
 */
export interface UfPayloadInput extends EdgePayloadUf {
  /** Municípios para drill-down do mapa + tabela RF-037. Destino: Blob. */
  municipios: EdgeUfMunicipio[];
  /**
   * Séries (margem, p_vitoria, turnout) dos charts RF-040/041/042. Destino:
   * Blob. Opcional — orchestrators pré-S04/F2 não emitem a chave.
   */
  series_temporais?: EdgeUfSeriesTemporais;
}

// ---------------------------------------------------------------------------
// Deputado Federal — a corrida PROPORCIONAL (spec 017 / ADR-0026 / ADR-0027)
// ---------------------------------------------------------------------------

/**
 * Payload nacional de Deputado Federal. Chave `projection-current-dep-t1` —
 * o mesmo esquema do ADR-0012 (`projection-current-<token>-t<turno>`), com o
 * token `"dep"` que `lib/config/cargos.ts` já declara. Nenhuma máquina de
 * chaves nova.
 *
 * ## Por que este tipo existe em vez de reusar `EdgePayload` (design 017, D1)
 *
 * `EdgePayload.national` é `EdgeNational`, e `EdgeNational` é inteiramente
 * majoritário: `candidato_a_id`/`candidato_b_id`, `needle_position`,
 * `needle_band`, `p_segundo_turno_overall`, `cenarios_2t`,
 * `vai_a_2t_nacional`. Numa corrida proporcional nenhum desses campos tem
 * referente — não existe líder da corrida, não existe duelo, não existe
 * segundo turno.
 *
 * O risco de reusar não é estético. Oito campos obrigatórios teriam de ser
 * preenchidos com valores inventados, e qualquer consumidor que já lê
 * `EdgeNational` (`<NationalNeedle>`, `<HeadlineScore>`, `/api/projection`)
 * renderizaria uma agulha e um "líder" para a Câmara dos Deputados.
 *
 * O precedente de `composicao_vagas?` pendurado em `EdgePayload` para o
 * Senador **não** se aplica: Senador é majoritário e `EdgeNational` cabe nele
 * de verdade.
 *
 * A consequência é que o read path precisa distinguir o cargo. A trava está
 * em `lib/edge-config/reader.ts`: `readProjection` só aceita cargo
 * majoritário (`CargoMajoritario`), então `readProjection({ cargo: "dep" })`
 * não compila. Quem quer este payload chama `readDeputadoProjection(cargo)`.
 *
 * Desde 2026-09-29 (spec 027) o MESMO envelope serve os três proporcionais:
 * 6 (Câmara dos Deputados, `projection-current-dep-t1`), 7 (as 26
 * Assembleias, `projection-current-est-t1`) e 8 (Câmara Legislativa do DF,
 * `projection-current-dis-t1`). O `cargo` é o discriminante que decide a chave
 * — por isso ele é `CargoProporcional`, e não mais o literal `6`.
 *
 * ## A visão nacional é soma nossa, não um agregado do TSE (design 017, D3)
 *
 * O TSE não publica arquivo `br-` para o cargo 6 (`temArquivoBr: false` em
 * `lib/config/cargos.ts`), e `compute_national` — que agrega por `cand.n`,
 * o número de urna — **não serve** aqui: no proporcional esse número se
 * repete entre UFs e entre partidos. A bancada é a soma das 27 corridas
 * estaduais, reconciliada por `cod` de agremiação. A tela precisa dizer isso
 * (constituição § 8).
 */
export interface EdgePayloadDeputado {
  /** Timestamp ISO 8601 do momento em que o modelo rodou. */
  ts: string;
  /**
   * ISO 8601 UTC — a hora do dado do TSE do ciclo proporcional. ADR-0038 D1.
   * Ver {@link EdgePayload.dado_ts} para os três estados.
   *
   * A distância entre `ts` e `dado_ts` é **maior** aqui do que em qualquer
   * outro cargo, e é por isso que o campo importa mais nesta tela: desde o
   * ADR-0036 a varredura do cargo 6 é fatiada em 6, uma fatia a cada 5 min, e
   * a volta completa leva 30 min. O modelo roda e carimba `ts` muito mais vezes
   * do que o conjunto do dado se renova.
   */
  dado_ts?: string | null;
  /**
   * Pares mais de 2 cadências atrás do `dado_ts` do próprio ciclo — ADR-0038
   * D2. Ver {@link EdgePayload.pares_atrasados}.
   *
   * A unidade é o **par** (município, zona), como nos outros três cargos:
   * desde o ADR-0036 o cargo 6 também chega ao modelo em granularidade de par
   * (~6.110 linhas). Antes disso era uma linha por UF, e o número não teria
   * sinal nenhum — 27 unidades não acusam cobertura parcial.
   */
  pares_atrasados?: number | null;
  /**
   * Discriminante do payload — 6, 7 ou 8 (`CargoProporcional`). Decide a chave
   * de Global Config e o prefixo do Blob (`writeDeputadoProjection`), e é o que
   * separa este tipo de `EdgePayload`.
   */
  cargo: CargoProporcional;
  /** Deputado Federal é turno único (`temSegundoTurno: false`). */
  turno: 1;
  /** % apurado somado sobre as UFs do cargo (27; 26 no estadual; só o DF no distrital) (0–100). */
  pct_apurado_total: number;
  /** UFs com pelo menos um boletim (0 até o nº de UFs do cargo — `ufsDoCargo`). */
  ufs_apuradas: number;
  /**
   * RF-128 — cadência do cron deste cargo, em minutos, **declarada pelo
   * produtor do payload**. A tela lê daqui; nenhum número de minuto é escrito
   * à mão no JSX (design 017, D8).
   *
   * O contrato do design 017 escreve `15`, que é a cadência de hoje
   * (`vercel.ts`). O tipo aqui é `number`, e não o literal `15`, por dois
   * motivos: uma mudança de cadência passa a ser mudança de **dado** em vez
   * de mudança de tipo, e o teste que prova que a tela DERIVA o número (em
   * vez de imprimi-lo) precisa poder injetar um valor diferente de 15 — com
   * o literal, esse teste não compilaria e a garantia de D8 ficaria sem prova.
   */
  /**
   * Ver {@link EdgePayload.fase}. Declarado aqui por simetria de contrato;
   * **nunca semeado** — a decisão do dono em 13/09 (RF-163) é que Deputado
   * Federal não entra na fase pré-eleição, porque esta tela lista cadeiras
   * por partido, não pessoas: semeá-la produziria "0 cadeiras" para cada
   * legenda, que é a mesma mentira em outra unidade, e nenhuma identidade
   * seria ganha, porque a tela não tem onde pôr rosto.
   */
  fase?: "pre_eleicao";
  atualizacao_min: number;
  bancada: EdgeBancadaNacional;
  /**
   * Spec 021 (RF-199) — as contagens absolutas do eleitorado desta
   * abrangência, e a projeção normalizada das quatro fatias.
   *
   * Opcional: payloads anteriores à spec 021 não o têm, e o painel "Votação"
   * degrada para `<DetailUnavailable>` (RF-198) em vez de desenhar zeros.
   */
  votacao?: EdgeVotacao;
  por_uf: EdgeDeputadoUfRow[];
  /**
   * Spec 026 RF-271 — os 10 mais votados do PAÍS, por voto apurado. Vem
   * pronto no payload para que a capa nunca leia os 27 Blobs de UF.
   * Ausente em payload v1 ⇒ o bloco não aparece.
   */
  mais_votados?: EdgeDeputadoDestaque[];
  /**
   * Spec 026 RF-273 — os puxadores do país (até 30), autocontidos pelo mesmo
   * motivo de `mais_votados`.
   */
  puxadores?: EdgeDeputadoPuxador[];
  /**
   * Frases curtas geradas por template — NUNCA LLM (ADR-0005,
   * constituição § 2).
   */
  insights: string[];
  composition: EdgeComposition;
}

/**
 * A bancada da Câmara como a projeção a vê: soma de `cadeiras` por agremiação
 * sobre as 27 UFs.
 *
 * Os três contadores de UF (`ufs_calculadas`, `ufs_aguardando`) e os dois de
 * cadeira (`total_cadeiras`, `cadeiras_atribuidas`) existem porque **a soma
 * não fecha durante a apuração**. Sem eles, o leitor que somar a lista por
 * agremiação e comparar com 513 conclui que sumiram cadeiras, quando o que
 * falta é apuração.
 */
export interface EdgeBancadaNacional {
  /**
   * O tamanho da Câmara: **513**, fato fixo desde antes da urna abrir
   * (`api/model/cargos.py::TOTAL_CADEIRAS`), e todas as 513 em disputa em 2026
   * — a Câmara renova integralmente, diferente do Senado, que renova 54 de 81.
   *
   * ⚠️ **Mudou em 2026-09-19.** Este campo era a **soma dos
   * `lugares_a_preencher` publicados**, derivada das UFs presentes no ciclo.
   * A soma crescia durante a noite: com três estados pequenos apurando, ela
   * dava 26, e a tela escrevia "26 cadeiras em disputa". A justificativa
   * antiga — "a redistribuição pelo Censo 2022 (PLP 177/2023) tem desfecho não
   * confirmado" — venceu: o PLP foi **vetado integralmente em julho/2025** e o
   * **STF manteve as 513** para este pleito (Resolução TSE 23.751/2026).
   *
   * **RF-124 continua valendo, e não é isto que ele rege**: o
   * `lugares_a_preencher` de **cada UF** segue vindo do dado publicado pelo
   * TSE, nunca de constante — é ele que divide os votos no quociente
   * eleitoral. A soma nacional virou conferência: quando as 27 UFs tiverem
   * publicado `carg[].nv` e a soma não fechar em 513, o ciclo loga `error` e
   * dispara o alarme (`api/model/deputado_payload.py::conferir_total_de_cadeiras`).
   */
  total_cadeiras: number;
  /**
   * Σ `por_agremiacao[].cadeiras`. **Menor** que `total_cadeiras` enquanto
   * houver UF sem dado — é a diferença que a tela precisa nomear.
   */
  cadeiras_atribuidas: number;
  /** UFs em que a distribuição de cadeiras já rodou. */
  ufs_calculadas: number;
  /** UFs sem boletim suficiente. `ufs_calculadas + ufs_aguardando === 27`. */
  ufs_aguardando: number;
  /**
   * Ordenado por `cadeiras` desc, depois `sigla` asc — desempate explícito,
   * constituição § 6. O consumidor reaplica a mesma regra em vez de confiar
   * na ordem recebida.
   */
  por_agremiacao: EdgeAgremiacaoBancada[];
}

/**
 * Uma agremiação (partido isolado ou federação) na bancada nacional.
 *
 * RF-122: federação é **uma** agremiação, com identidade própria e os
 * partidos componentes legíveis. Coligação (`agr[].tp === "c"`) é anomalia a
 * logar no pipeline, nunca a exibir — ela não existe em eleição proporcional
 * desde a EC 97/2017.
 */
export interface EdgeAgremiacaoBancada {
  /**
   * Chave NACIONAL da agremiação — a de reconciliação entre UFs: o número do
   * partido isolado (`"13"`) ou `"fed:<nº da federação>"` (`"fed:101"`). Opaca:
   * compare por igualdade, não interprete. ⚠️ NÃO é o `agr[].n` do EA20, que é
   * o id da inscrição na UF e muda de estado para estado (design 017 D3,
   * emenda de 2026-09-29; `api/model/deputado.py::chave_agremiacao`).
   */
  cod: string;
  sigla: string;
  nome: string;
  tipo: "partido" | "federacao";
  /**
   * RF-122 — siglas dos partidos componentes. `[]` em partido isolado.
   * Origem: `agr[].par[].sg` no EA20.
   */
  componentes: string[];
  /**
   * O partido que dá a **cor** — ADR-0024 linha 41: "federação usa a cor do
   * partido-líder". Componente com mais votos nominais, desempatado por sigla
   * ascendente (constituição § 6: sem desempate, a mesma federação mudaria de
   * cor entre dois ciclos, e o ADR exige cor estável a noite toda).
   *
   * Em partido isolado vale `sigla`. É essa igualdade que **elimina o ramo
   * especial na tela**: o consumidor chama `colorForParty(sigla_lider)` e
   * pronto, sem perguntar `tipo`.
   *
   * No nacional é o líder medido sobre a soma das 27 UFs — **não** a moda dos
   * líderes estaduais. Pode divergir do líder de uma UF específica, e isso é
   * esperado, não defeito.
   *
   * Sigla sem token em `app/tokens-party.css` cai em `--party-outros`, que é o
   * fallback documentado do ADR-0024. Envelope degradado que não traga o campo
   * cai no mesmo lugar: `colorForParty(undefined)` devolve `outros`, então
   * sigla nova nunca vira cor ausente nem erro visual.
   */
  sigla_lider: string;
  /**
   * RF-125.1 — candidatos **efetivamente eleitos**. NUNCA `vagas_obtidas`,
   * que é o bookkeeping do denominador da média (Res.-TSE 23.677 art. 11 § 5º,
   * ADI 5.420) e conta o quociente partidário inteiro ainda que não
   * preenchido — numa UF de 10 vagas, a soma de `vagas_obtidas` dá 11.
   *
   * `vagas_obtidas` não atravessa a fronteira do payload, sob nome nenhum
   * (design 017, D2).
   */
  cadeiras: number;
  /**
   * RF-127 — intervalo de 95% do número de cadeiras, `[inferior, superior]`.
   *
   * **Opcional por decisão de contrato** (design 017, D7): o caminho honesto
   * é rodar `distribuir_cadeiras` sobre cada resample do bootstrap e tomar o
   * percentil, e o custo disso ainda não foi medido contra a janela do cron.
   * O ponto central publica agora; o intervalo entra sem mudar o contrato
   * quando a medição disser que cabe.
   *
   * A tela tem de renderizar corretamente **com e sem** este campo.
   */
  cadeiras_ci95?: [number, number];
  /**
   * RF-127 — quantas das `cadeiras` foram atribuídas em rodada de sobra com
   * margem apertada. É a metade de RF-127 que sai sem depender de D7: a
   * cadeira marcada é exibida como indefinida, não com firmeza falsa.
   */
  cadeiras_indefinidas?: number;
  /** RF-130 — votos dados a candidatos. */
  votos_nominais: number;
  /**
   * RF-130 — votos dados à legenda (`v.vl` no EA20; existe neste cargo e não
   * nos majoritários). **Separado, nunca somado em silêncio**: legenda decide
   * cadeira, e escondê-la dentro de um total esconde o fato.
   */
  votos_legenda: number;
  /** `votos_nominais + votos_legenda` — os válidos da agremiação (ADR-0027). */
  votos_validos: number;
  /** % sobre os votos válidos nacionais (0–100). */
  pct_votos: number;
}

/**
 * Uma linha da tabela "estado a estado" do nacional. É **resumo**: a lista
 * nominal de eleitos e o detalhe por agremiação ficam no objeto de Blob
 * (`DeputadoUfDetail`, `lib/blob/deputado-uf.ts`), porque crescem com a
 * cobertura e o Global Config tem 1 MB para três cargos (RF-129, ADR-0026
 * item 4).
 */
export interface EdgeDeputadoUfRow {
  sigla: string;
  pct_apurado: number; // 0–100
  /**
   * RF-124 — `carg[].nv`, as vagas que esta UF elege. `null` quando o TSE
   * ainda não publicou: um `0` ali seria lido como "esta UF não elege
   * ninguém", e um default embutido corromperia o quociente.
   */
  lugares_a_preencher: number | null;
  /** RF-123 — `votos_válidos / lugares_a_preencher` com o arredondamento do art. 106. `null` sem dado. */
  quociente_eleitoral: number | null;
  /** Cadeiras já distribuídas nesta UF. */
  cadeiras_definidas: number;
  /** Cadeiras que o algoritmo não conseguiu preencher (sem candidato acima do piso). */
  vagas_nao_preenchidas: number;
  /**
   * Open question 3 da spec: empate de médias que sobrevive aos dois
   * desempates (maior votação total, depois maior nominal). A norma não prevê
   * sorteio — a decisão é **marcar como indeterminado**, nunca escolher.
   * Aqui é só a contagem; a lista nominal está no payload de UF.
   */
  empates_indeterminados: number;
  /** A agremiação com mais cadeiras na UF. `null` enquanto não há distribuição. */
  lider: { cod: string; sigla: string; cadeiras: number } | null;
  /**
   * Spec 026 (RF-264) — o estado da trava da projeção NESTA UF, para o selo
   * da grade da capa. É o mesmo objeto de `DeputadoUfDetail.projecao`, e a
   * capa o lê daqui para **nunca** precisar abrir os 27 Blobs.
   *
   * Opcional: payload v1 não tem a chave, e a capa então não desenha selo
   * nenhum ("não sabemos" ≠ "aguardando").
   */
  projecao?: DeputadoProjecaoUf;
}

// ---------------------------------------------------------------------------
// Deputado Federal — contrato v2 (spec 026: listas, projeção com trava, extras)
// ---------------------------------------------------------------------------
//
// Espelho do design 026 § 2 (`docs/specs/026-deputado-listas-projecao/design.md`),
// com os NOMES de lá. Tudo aqui é ADITIVO e OPCIONAL no objeto da UF: um
// objeto v1 (sem `contrato`) continua válido e renderizando (RF-276, § 2.12).
// O leitor tolerante — campo v2 malformado sai do objeto, nunca lança — mora em
// `lib/blob/deputado-uf.ts::sanearDeputadoUfDetail`.
//
// Os tipos moram AQUI, e não em `lib/blob/deputado-uf.ts`, porque o payload
// nacional (Global Config) também os usa e `lib/blob/deputado-uf.ts` já
// importa deste arquivo — o caminho inverso criaria um ciclo. Aquele módulo os
// reexporta.

/** Por onde a cadeira veio, na NOSSA conta: quociente partidário ou sobra (design § 2.2). */
export type DeputadoVia = "qp" | "sobra";

/**
 * `cand.st` do agregado mapeado — o RÓTULO do TSE, só com totalização final
 * (`tf = "s"`), e então em toda linha (RF-267). Nunca é comparado com a nossa
 * via (`parcial`/`projecao`): no simulado de 28/09 os dois não coincidem.
 */
export type DeputadoMarcaTse = "eleito_qp" | "eleito_media" | "eleito" | "suplente" | "nao_eleito";

/**
 * `cand.dvt` mapeado, **só quando NÃO é voto nominal válido**
 * ([ADR-0064](../../docs/architecture/adrs/0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md)).
 * Ausente = `Válido`, ou `dvt` ainda não publicado.
 */
export type DeputadoDestinoProporcional = "valido_legenda" | "anulado" | "sub_judice";

/**
 * Uma linha de candidato em `candidatos[]` (Blob) e em `lista_restante` /
 * `deputado/uf-lista/<UF>.json` — design § 2.2.
 *
 * Chaves opcionais são OMITIDAS, nunca `null` (exceto `pct_validos`, em que
 * `null` é o dado); booleano opcional só aparece como `true`.
 */
export interface DeputadoUfLinha {
  /** `cand.sqcand` — a identidade. NÚMERO no JSON (11 dígitos, cabe em 2^53). Nunca `cand.n`. */
  sqcand: number;
  /** `cand.nmu`, depois `cand.nm`. */
  nome: string;
  /** Sigla do PARTIDO (dentro da federação, o componente) — RF-122. */
  partido: string;
  /** `cand.n` — número de urna. Exibição, nunca chave: repete entre UFs e partidos. */
  numero?: number;
  /** `cand.vap` — voto apurado, qualquer que seja o destino. */
  votos: number;
  /** 1-based na agremiação, por voto apurado (design § 3.1). A tela ordena por ele e NUNCA reordena. */
  rank: number;
  /** % dos válidos da UF, 0–100, 5 casas. `null` ⇔ destino anulado ou sub judice. */
  pct_validos: number | null;
  /** Eleito na parcial, e por onde (na NOSSA conta). */
  parcial?: DeputadoVia;
  /** Sobra apertada na parcial (`_marcar_indefinidas`). Só com `parcial: "sobra"`. */
  indefinido?: true;
  /** Eleito na projeção. Só existe com `projecao.estado === "liberada"` na UF. */
  projecao?: DeputadoVia;
  /** Sobra apertada na projeção. Só com `projecao: "sobra"`. */
  projecao_apertada?: true;
  /** Rótulo do TSE, só com totalização final. */
  tse?: DeputadoMarcaTse;
  /** Só quando NÃO é voto nominal válido (ADR-0064). */
  destino?: DeputadoDestinoProporcional;
}

/** Os três estados da trava (RF-264, ADR-0063 D3). */
export type DeputadoProjecaoEstado = "liberada" | "aguardando" | "indisponivel";

/**
 * Motivo da trava — conjunto FECHADO, por estado (design § 2.7), avaliado em
 * ordem fixa pelo modelo; o primeiro que falha é o publicado.
 *
 *   - `aguardando` (resolve sozinho): `pct_minimo`, `zonas_minimas`, `sem_vagas`;
 *   - `indisponivel` (não resolve sem ação): `interruptor`, `coligacao`,
 *     `cobertura`, `erro`.
 *
 * Interruptor desligado e interruptor ILEGÍVEL publicam o mesmo `interruptor`:
 * a distinção que a tela precisa ("desligada" × "não foi possível ler",
 * ADR-0063 D4) está em `InterruptorProjecaoLido.origem`, que a página lê.
 */
export type DeputadoProjecaoMotivo =
  | "pct_minimo"
  | "zonas_minimas"
  | "sem_vagas"
  | "interruptor"
  | "coligacao"
  | "cobertura"
  | "erro";

/** Estado da projeção numa UF (design § 2.7). `por_uf[].projecao` é o MESMO objeto. */
export interface DeputadoProjecaoUf {
  estado: DeputadoProjecaoEstado;
  /** Ausente ⇔ `liberada`. */
  motivo?: DeputadoProjecaoMotivo;
  /** 25, ou o da chave do interruptor (que só SOBE). */
  pct_minimo: number;
  /** Zonas com `e.esi > 0 ∧ v.vv > 0`. */
  zonas_apuradas: number;
  /** Pares (município×zona) da UF na nossa tabela. */
  zonas_total: number;
}

/**
 * Linha de corte da agremiação, na PARCIAL (RF-272, design § 3.4). Ausente sem
 * eleito ou sem candidato válido de fora.
 */
export interface DeputadoCorte {
  /** `sqcand` do maior rank com `parcial`. */
  ultimo_eleito: number;
  /** `sqcand` do menor rank sem `parcial` e sem `destino`. */
  primeiro_fora: number;
  /** `votos(ultimo_eleito) − votos(primeiro_fora)` ≥ 0. */
  diferenca: number;
  /** `10·votos(primeiro_fora) < QE` — não herdaria vaga nem com mais votos (CE art. 108). */
  primeiro_fora_abaixo_piso_10?: true;
}

/**
 * Puxador (RF-273, design § 3.5): linha sem `destino` com
 * `excedente = ⌊votos/QE⌋ − 1 ≥ 1`.
 */
export interface DeputadoPuxador {
  sqcand: number;
  /** `⌊votos / QE⌋`. */
  quocientes: number;
  /** `quocientes − 1` ≥ 1. */
  excedente: number;
}

/** RF-274 — regras com os números da UF, em inteiros com teto (design § 2.6). */
export interface DeputadoRegras {
  /** === `DeputadoUfDetail.quociente_eleitoral`. */
  quociente_eleitoral: number;
  /** Σ `agremiacoes[].votos_validos`. */
  votos_validos: number;
  lugares_a_preencher: number;
  /** `⌈QE/10⌉` — art. 108: candidato precisa de ≥ 10% do QE para vaga de QP. */
  piso_candidato: number;
  /** `⌈4·QE/5⌉` — art. 109 § 2º I: agremiação com ≥ 80% do QE disputa sobra. */
  piso_agremiacao_sobras: number;
  /** `⌈QE/5⌉` — art. 109 § 2º II: candidato com ≥ 20% do QE na sobra restrita. */
  piso_candidato_sobras: number;
}

/** O que a Conferência de fato comparou (design § 2.8). */
export type DeputadoComparacao = "eleitorado" | "algoritmo" | "eleitos" | "votos_validos";

/** Chaves de divergência — conjunto FECHADO (amplia `CHAVES_DE_DIVERGENCIA` do Python). */
export type DeputadoDivergenciaChave =
  | "quociente_eleitoral"
  | "cadeiras"
  | "eleitos"
  | "eleitorado"
  | "votos_validos";

export interface DeputadoDivergencia {
  o_que: DeputadoDivergenciaChave;
  nosso: number;
  tse: number;
  detalhe: string;
  /** `100·(nosso − tse)/tse`, 5 casas, com sinal. Presente em `eleitorado` e `votos_validos`. */
  diferenca_pct?: number;
}

/**
 * RF-269 — a Conferência de verdade (design § 2.8). A frase "batem com o TSE"
 * só existe com `estado: "confere"`, e nomeia o horário do boletim.
 */
/**
 * Uma comparação que a Conferência NÃO pôde fazer neste ciclo, e por quê
 * (spec 027, design § 3.2). Hoje o único motivo é `granularidade_uf`: com o
 * cargo lido pelo resumo da UF (Fase 1 das assembleias), não há zonas para
 * somar eleitorado nem votos válidos por conta própria — e a comparação sai
 * como "não comparado", **nunca** como "confere" (RF-269 da 026 vale igual).
 */
export interface DeputadoNaoComparado {
  comparacao: "eleitorado" | "votos_validos";
  motivo: "granularidade_uf";
}

export interface DeputadoConferencia {
  estado: "confere" | "diverge" | "sem_dado_tse";
  /** Hora do boletim do agregado comparado. `null` sem agregado. */
  boletim_dado_ts: string | null;
  /** `tf` do agregado comparado. */
  totalizacao_final: boolean;
  /** O que foi DE FATO comparado neste ciclo. A frase da tela sai daqui. */
  comparou: DeputadoComparacao[];
  divergencias: DeputadoDivergencia[];
  /**
   * Spec 027 (design § 3.2) — o que NÃO foi comparado, com o motivo. Opcional
   * e aditivo: ausente num objeto anterior à spec 027 (ou quando tudo foi
   * comparado). O leitor descarta SÓ este campo se ele vier malformado.
   */
  nao_comparou?: DeputadoNaoComparado[];
}

/**
 * Um destaque do NACIONAL (RF-271, design § 2.9) — autossuficiente: a capa
 * NUNCA lê Blob.
 */
export interface EdgeDeputadoDestaque {
  uf: string;
  sqcand: number;
  nome: string;
  partido: string;
  /** Agremiação. */
  cod: string;
  /** Sigla da agremiação (a federação, quando há). */
  sigla: string;
  numero?: number;
  votos: number;
  /** % dos válidos DA UF DO CANDIDATO — o único denominador com sentido. */
  pct_validos: number | null;
  destino?: DeputadoDestinoProporcional;
}

/** Puxador do nacional (até 30, RF-273). */
export interface EdgeDeputadoPuxador extends EdgeDeputadoDestaque {
  /** O QE da UF dele. */
  quociente_eleitoral: number;
  /** `⌊votos/QE⌋`. */
  quocientes: number;
  /** `quocientes − 1` ≥ 1. */
  excedente: number;
}

/**
 * O VALOR da chave de Global Config `interruptor-projecao-dep` (RF-265,
 * [ADR-0063](../../docs/architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)
 * D4, design § 2.10). Escrito por `pnpm dep:projecao`; lido a cada render
 * (`readInterruptorProjecao`) e mandado ao modelo no corpo do POST
 * (`projecao_dep`, design § 2.11).
 *
 * Falha fechada nos dois sentidos: só uma leitura bem-sucedida com
 * `ligada === true` liga. "Começa ligada" é o passo da virada de 03/10.
 *
 * `em` e `por` são de AUDITORIA: nunca entram no payload nem no Blob, e a
 * leitura da tela nem os devolve.
 */
export interface InterruptorProjecaoDep {
  ligada: boolean;
  /** 25 ≤ x ≤ 100 — só SOBE a trava. Fora disso: ignorado, com log (ADR-0063 D4). */
  pct_minimo?: number;
  /** ISO 8601 de quando foi gravada. */
  em?: string;
  /** Rótulo curto de quem gravou ("dono", "plantao"). Nunca e-mail. */
  por?: string;
}
