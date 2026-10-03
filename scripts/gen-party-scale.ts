/**
 * scripts/gen-party-scale.ts
 *
 * Gera `app/tokens-party.css` — a paleta editorial por partido/federação
 * exigida pela constituição § 2 (v1.3) e fixada pelo ADR-0024.
 *
 * Uso:
 *   pnpm gen:party-scale              # regrava app/tokens-party.css
 *   pnpm gen:party-scale --report     # + tabela L*, C*, h, ΔE76 de auditoria
 *   pnpm gen:party-scale --check      # não escreve; falha se o arquivo estiver
 *                                     # fora de sincronia com a tabela-fonte
 *   pnpm gen:party-scale --suggest    # não escreve; calcula o conjunto MÍNIMO
 *                                     # de hexes a mudar quando dois partidos
 *                                     # colidem (seção 7c)
 *
 * Sai com código ≠ 0 (em qualquer modo de geração) se algum token — base, chip,
 * text ou nível — ficar a menos de `DELTA_E_FLOOR` de um hex oficial de
 * partido, se algum par `-chip`/`-ink` ou algum `-text` ficar abaixo de 4,5:1,
 * se a rampa de algum partido deixar de ser estritamente decrescente em L*, se
 * o nível 5 de alguém perder mais de 40% do croma do nível 4, **ou se dois
 * partidos diferentes ficarem a menos de `PARTY_SEPARATION_FLOOR` um do outro**
 * (seção 7b — o gate acrescentado em 2026-09-08).
 *
 * ---------------------------------------------------------------------------
 * Por que um gerador, e não CSS escrito à mão
 * ---------------------------------------------------------------------------
 * Cada partido precisa de 5 intensidades (`--party-<sigla>-1..5`) que variam
 * **só em intensidade, nunca em matiz** — é literalmente o texto do § 2 v1.3:
 *
 *   "apenas a **intensidade** (claro↔saturado) pode variar com a margem
 *    projetada, nunca a matiz"
 *
 * Escrever 30 × 5 = 150 hexes à mão não é auditável: ninguém consegue verificar
 * a olho que `--party-mdb-3` tem a mesma matiz de `--party-mdb`. Derivando os 5
 * níveis de um único hex base em CIE LCh — matiz (h) **fixa**, L* e C* variando
 * por nível — a invariante constitucional passa a valer por construção, e este
 * script vira o artefato que um revisor recomputa para conferir.
 *
 * ---------------------------------------------------------------------------
 * A guarda de ΔE76 mora aqui, não só na documentação
 * ---------------------------------------------------------------------------
 * A lição que motivou esta versão: **uma rampa derivada cria violação que a cor
 * base não tinha.** `--party-pp` (#2C6FB0) está a ΔE 20,5 do azul do PP; o
 * nível 5 derivado dele caía a ΔE 8,3 do #234F74 que o PP usa no site — abaixo
 * do mínimo constitucional, sem que nada no processo reclamasse. Por isso o
 * gerador carrega os hexes oficiais (`scripts/data/party-official-hexes.json`),
 * valida **base + 5 níveis contra todos os hexes de cada partido**, empurra o
 * que violar para fora do raio proibido preservando a matiz, e **falha** se
 * ainda assim sobrar violação. O mesmo cálculo é refeito sobre o CSS commitado
 * por `tests/unit/design-system/party-delta-e.test.ts`, para que nem edição
 * manual nem mudança na tabela de oficiais reintroduza o problema.
 *
 * ---------------------------------------------------------------------------
 * Hex pré-computado, nunca color-mix()/oklch()
 * ---------------------------------------------------------------------------
 * O MapLibre lê token de cor por `getComputedStyle` e passa a string para
 * `setPaintProperty`, que só aceita cor CSS literal. `color-mix()` e `oklch()`
 * chegam de volta do `getComputedStyle` como a função não resolvida (ou como
 * `oklch(...)`, que o parser de cores do MapLibre rejeita) — o mapa ficaria
 * cinza em silêncio. Por isso todo token emitido aqui é **#RRGGBB literal**.
 * Mesma regra de ouro documentada no topo de `app/globals.css`.
 *
 * ---------------------------------------------------------------------------
 * Determinismo (constituição § 6)
 * ---------------------------------------------------------------------------
 * Mesma tabela-fonte → byte a byte o mesmo arquivo. Sem `Math.random()`, sem
 * data/hora no conteúdo gerado, busca binária com número **fixo** de iterações,
 * varredura do solver de ΔE em grade fixa com desempate explícito.
 * `--check` existe para o CI provar isso.
 *
 * Cross-refs:
 *   - ADR-0024 `docs/architecture/adrs/0024-paleta-editorial-por-partido.md`
 *   - Constituição § 2 (v1.3) `docs/constitution.md`
 *   - Kit: `docs/design-system/atlas-menna/tokens/colors.css`
 *   - Hexes oficiais: `scripts/data/party-official-hexes.json`
 *   - Consumidor: `lib/utils/party-color.ts`
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ===========================================================================
// 1. TABELA-FONTE — sigla → hex base
// ===========================================================================
// **Este é o único lugar onde um hex editorial de partido é declarado.** Para
// adicionar um partido: acrescente uma linha aqui, uma entrada em
// `scripts/data/party-official-hexes.json` e a sigla em `KNOWN_PARTY_SLUGS`
// (`lib/utils/party-color.ts`); os 5 níveis saem sozinhos.
//
// Origem dos hexes: kit Atlas Menna,
// `docs/design-system/atlas-menna/tokens/colors.css:37-76`, com três correções
// e seis inclusões feitas em 2026-09-07 sob a leitura estrita do § 2 (ΔE76
// medido contra **todo** hex oficial documentado, não só a cor primária):
//
//   --party-pt            #C0223B → #C62E49   (era ΔE 6,25 de #B9142C, o fim
//                                              do gradiente no manual do PT)
//   --party-republicanos  #1F5FA8 → #2A548A   (era ΔE 2,92 de #005DAA, o
//                                              --primary-color do site)
//   --party-uniao         #2255A4 → #124287   (era ΔE 10,17 de #254AA5 —
//                                              passava a constituição, não a
//                                              margem operacional de 12)
//   + PDT, PSDB, PCdoB, PV, Solidariedade e MOBILIZA, que não tinham token.
//
// Com isso a paleta cobre os 30 partidos registrados para 2026. Note que
// **PMB não existe mais**: o TSE homologou a renomeação para DEMOCRATA em
// 02/12/2025 (nº 35), e MOBILIZA é o antigo PMN.
//
// ---------------------------------------------------------------------------
// Seis correções de 2026-09-08 — distância entre os NOSSOS partidos
// ---------------------------------------------------------------------------
// Até aqui, todo hex desta tabela tinha sido medido contra o **lado de fora**
// (a marca do partido) e nunca contra os outros 30 hexes da própria tabela. O
// kit chegou com cinco pares indistinguíveis a olho nu — `dc` × `pp` a ΔE76
// 2,52, `pco` × `pstu` a 3,55 — e uma rampa quebrada (o nível 5 do PP em cinza).
// A seção 7b passou a gatear isso; estes seis hexes são a resposta, calculada
// por `pnpm gen:party-scale --suggest` sob o critério da seção 7c (menos hexes
// primeiro, menor deslocamento total no desempate, ordem alfabética por último
// — nenhuma das três regras olha para quem é o partido):
//
//   --party-avante  #7A4FB3 → #794CAE   ΔE 1,64  (colidia com PRD a 11,69)
//   --party-mdb     #2E8B57 → #408A50   ΔE 5,35  (colidia com PSD a 9,54)
//   --party-pco     #A1332B → #9D4227   ΔE 9,79  (triângulo PCB/PCO/PSTU)
//   --party-pp      #2C6FB0 → #0F60B3   ΔE 13,49 (rampa colapsada + DC a 2,52)
//   --party-psb     #C9A227 → #B6A92A   ΔE 12,10 (o `-text` colidia com PSOL
//                                                 a 2,51 — dois ouros que viram
//                                                 o mesmo marrom ao escurecer)
//   --party-pstu    #9E2B2B → #97272B   ΔE 3,31  (triângulo PCB/PCO/PSTU)
//
// Note quem **não** mudou e por quê, porque é o teste do critério: o DC ficou
// parado embora estivesse na pior colisão da paleta (2,52 com o PP) — o PP
// mudava de qualquer forma por causa da própria rampa, e mover os dois violaria
// a regra 1. No triângulo vermelho PCB/PCO/PSTU, três arestas exigem dois
// vértices; o PCB ficou parado por ser a escolha de menor deslocamento total.
// PSD, PSOL e PRD ficaram parados pelo mesmo motivo em seus pares.
//
// O PP é o único caso em que o hex mudou de **matiz** de propósito (272,3° →
// 280,9°): seus três hexes oficiais (#133D6D, #54B8EA, #234F74) põem dois azuis
// na ponta escura da coluna, e o corredor que sobrava era estreito demais para
// o nível 5 — que saía com C* 15,0 contra C* 43,8 do nível 4 (razão 0,34,
// enquanto os outros 30 partidos ficavam entre 0,71 e 1,02). Girar a matiz abre
// o corredor: o nível 4 sobe para C* 53,9 e o nível 5 para C* 43,9 — razão
// **0,81**, exatamente o recuo que o kit desenhou (0,80) — e a distância do
// pior hex oficial do PP sobe de ΔE 20,5 para 24,4 de quebra.

interface PartyEntry {
  /** Slug do token: `--party-<slug>`. Minúsculo, sem acento, sem separador. */
  slug: string;
  /**
   * Hex base — a **cor de identidade** do partido, a que vale em chip, tag e
   * legenda. Não é mais o nível 4: desde a correção de 2026-09-07 os cinco
   * níveis são alvos de L* / C* (ver `LIGHT_RAMP`), e o base é a âncora de
   * **matiz** de todos eles.
   */
  base: string;
  /** Nome por extenso, só para o comentário do CSS gerado. */
  nome: string;
  /**
   * Cinza institucional: a rampa sai **acromática** (C* = 0 em todos os
   * níveis), variando só em L*. Sem isto, aplicar C* = 48 ao matiz residual de
   * um cinza (#9AA0A8 tem C* ≈ 3,6) produziria um azul de verdade no nível 3 —
   * e "outros" deixaria de ler como neutro, que é a única coisa que ele
   * precisa comunicar.
   */
  neutral?: boolean;
}

const PARTY_BASE: readonly PartyEntry[] = [
  // Polos presidenciais.
  { slug: "pt", base: "#C62E49", nome: "PT" },
  // 🔴 PL e PSD tiveram as bases TROCADAS entre si em 2026-09-19, a pedido do
  // dono. O PL era `#2247B8` (azul) e o PSD `#2F8F6B` (verde).
  //
  // Medido antes de trocar, contra `party-official-hexes.json`, com o piso de
  // `DELTA_E_FLOOR` = 12 que a constituição § 2 exige:
  //
  //   | partido | menor ΔE76 antes | menor ΔE76 depois |
  //   |---------|------------------|-------------------|
  //   | PL      | 13,54 (#2A3591)  | **78,73** (#0051A0) |
  //   | PSD     | 49,30 (#7FC341)  | **24,98** (#013F88) |
  //
  // A troca **melhora o elo mais fraco da paleta inteira**: o PL azul estava a
  // 1,54 do piso — a menor folga entre os 31 partidos —, e o gargalo passa a ser
  // o PSD a 24,98, o dobro do mínimo. É contraintuitivo (dar azul ao PSD, que
  // tem dois azuis oficiais) e mede bem justamente porque os azuis do PSD são
  // MUITO escuros (#022A59, #013F88) e o `#2247B8` é um azul médio.
  //
  // A separação ENTRE os dois não muda (ΔE 101,39): é o mesmo par de cores, só
  // que invertido — e por isso nenhuma distância entre partidos se altera.
  { slug: "pl", base: "#2F8F6B", nome: "PL" },
  // Demais partidos com token no kit.
  { slug: "psd", base: "#2247B8", nome: "PSD" },
  { slug: "novo", base: "#E07B1D", nome: "NOVO" },
  { slug: "avante", base: "#794CAE", nome: "Avante" },
  { slug: "missao", base: "#1E7F8C", nome: "Missão" },
  { slug: "prtb", base: "#6B7A2C", nome: "PRTB" },
  { slug: "up", base: "#8C2F5C", nome: "UP" },
  { slug: "pco", base: "#9D4227", nome: "PCO" },
  { slug: "dc", base: "#3B6FB0", nome: "DC" },
  { slug: "pstu", base: "#97272B", nome: "PSTU" },
  { slug: "pcb", base: "#B63A2E", nome: "PCB" },
  { slug: "democrata", base: "#4B5563", nome: "Democrata (ex-PMB)" },
  { slug: "republicanos", base: "#2A548A", nome: "Republicanos" },
  { slug: "psb", base: "#B6A92A", nome: "PSB" },
  { slug: "rede", base: "#3D8F3D", nome: "Rede" },
  { slug: "pp", base: "#0F60B3", nome: "PP" },
  { slug: "pode", base: "#2E9C8F", nome: "Podemos" },
  { slug: "cidadania", base: "#C46A9C", nome: "Cidadania" },
  { slug: "agir", base: "#7C6E5B", nome: "Agir" },
  { slug: "psol", base: "#D6A400", nome: "PSOL" },
  { slug: "mdb", base: "#408A50", nome: "MDB" },
  { slug: "uniao", base: "#124287", nome: "União Brasil" },
  { slug: "prd", base: "#6A5ACD", nome: "PRD" },
  // Incluídos em 2026-09-07 — hexes escolhidos com ΔE76 ≥ 25 contra toda a
  // paleta já existente (distinguíveis entre si) e revalidados contra os
  // hexes oficiais de cada um sob a mesma regra dos demais.
  { slug: "pdt", base: "#784B02", nome: "PDT" },
  { slug: "psdb", base: "#C37B61", nome: "PSDB" },
  { slug: "pcdob", base: "#6B4B7D", nome: "PCdoB" },
  { slug: "pv", base: "#AC2C92", nome: "PV" },
  { slug: "solidariedade", base: "#EB4784", nome: "Solidariedade" },
  { slug: "mobiliza", base: "#3E89F9", nome: "Mobiliza (ex-PMN)" },
  // Incluído em 2026-09-20: o PTB aparece nas fixtures (ex.:
  // tests/fixtures/edge-config/projection-current.json) e não tinha token
  // próprio — caía em `--party-outros`, o mesmo cinza que "sem apuração"
  // (defeito A do mesmo commit). Hex escolhido no maior vão de matiz livre da
  // paleta (missão h 213,8° ↔ outros h 263,8°, vão de 50°): sem fonte oficial
  // localizada nesta sessão (nenhuma pesquisa nova foi feita — ver nota em
  // `scripts/data/party-official-hexes.json`), então o piso de ΔE76 contra o
  // hex oficial não é aplicável, mesmo tratamento de `democrata`/`mobiliza`
  // acima. Continua sujeito aos DOIS pisos de separação de primeira mão: 12
  // contra os outros 30 partidos e 10 contra `--map-uncounted` (seção 4b) —
  // ambos medidos, não presumidos.
  { slug: "ptb", base: "#17759A", nome: "PTB" },
  // Fallback universal — sigla desconhecida, ausente, ou federação sem
  // composição resolvida (ADR-0024 § Decisão).
  { slug: "outros", base: "#9AA0A8", nome: "Outros / não mapeado", neutral: true },
];

/**
 * Estados de corrida que não pertencem a partido nenhum. Emitidos como hex
 * literal do kit, sem rampa: "empate" e "sem projeção" não têm intensidade por
 * margem — são justamente a ausência de margem.
 */
const STATE_TOKENS: ReadonlyArray<{ name: string; hex: string; nota: string }> = [
  { name: "tie", hex: "#B8BCC4", nota: "empate técnico" },
  { name: "none", hex: "#E1E4E8", nota: "sem projeção / não apurado" },
];

// ===========================================================================
// 2. A REGRA DA RAMPA
// ===========================================================================
// Matiz (h) do partido **preservada em todos os níveis**; L* e C* fixos por
// nível, iguais para todos os partidos. Nível 1 = disputa apertada (tossup),
// nível 5 = decisivo.
//
// ---------------------------------------------------------------------------
// De onde saem os cinco alvos (e por que o nível 4 deixou de ser o hex base)
// ---------------------------------------------------------------------------
// A versão anterior fixava L* / C* só nos níveis 1–3 e usava o **hex base** como
// nível 4, com o nível 5 relativo a ele. Isso só ordena quando o base é mais
// escuro que L* 58 — verdade para PT e PL, que originaram a regra, e falso
// para quem tem base clara. Medido no CSS que essa regra gerava:
//
//   --party-psol : nível 3 em L* 58,2 e nível 4 em L* 70,1 — o "decisivo"
//                  saía MAIS CLARO que o "provável";
//   --party-pode : níveis 3 e 4 em L* 58,2 e 58,4 — indistinguíveis;
//   --party-agir : croma despencava de C* 47,8 (nível 3) para 12,8 (nível 4),
//                  porque o base é um marrom dessaturado.
//
// A rampa é uma **escala de margem**, não a identidade do partido: quem carrega
// a identidade é `--party-<sigla>`. Então os cinco níveis passam a ser alvos
// absolutos, medidos nas rampas que o designer entregou para PT e PL:
//
//   nível | PT do kit    | PL do kit    | alvo adotado
//   ------|--------------|--------------|--------------
//     1   | 89,9 /  9,7  | 90,0 / 10,6  | L* 90 · C* 10
//     2   | 75,6 / 26,1  | 76,7 / 25,5  | L* 76 · C* 26
//     3   | 58,9 / 47,7  | 57,6 / 47,9  | L* 58 · C* 48
//     4   | 42,3 / 66,7  | 34,6 / 69,8  | L* 42 · C* 66
//     5   | 29,3 / 53,1  | 23,0 / 57,2  | L* 29 · C* 53
//
// Nos níveis 4 e 5 as duas rampas do kit divergem, e o alvo segue **o PT**:
//
//   - a cadência de L* do PT é a regular das duas (−14, −18, −16, −13 contra
//     −13, −19, −23, −12 do PL), e cadência regular é o que faz cada degrau da
//     escala valer o mesmo tanto de "margem" para o leitor;
//   - L* 23 (o nível 5 do PL) é escuro demais para servir de alvo universal:
//     em matizes de gamut estreito (`--party-pode`, h 183,6°) o croma máximo
//     em L* 23 cai para ~17, e os níveis 4 e 5 colapsariam num par de
//     verde-escuros quase iguais;
//   - C* 53 / C* 66 = 0,80, exatamente o fator de croma que a regra relativa
//     anterior já aplicava ao nível 5.
//
// Distância mínima entre níveis adjacentes: 13 unidades de L*, ~13× o limiar
// de percepção — a ordem é visível em todo degrau, em toda matiz.

/** Alvos de L* por nível (1..5). Estritamente decrescente por construção. */
const RAMP_L: readonly [number, number, number, number, number] = [90, 76, 58, 42, 29];

/** Alvos de C* por nível (1..5). Reduzidos ao gamut da matiz de cada partido. */
const RAMP_C: readonly [number, number, number, number, number] = [10, 26, 48, 66, 53];

/**
 * Rampas literais que o designer entregou no kit (tema claro), mantidas
 * **só como referência de auditoria**: `--report` mede o ΔE76 entre cada nível
 * gerado e o valor correspondente aqui, para que o desvio em relação ao
 * desenho original seja um número, não uma impressão.
 *
 * Elas deixaram de ser emitidas em 2026-09-07: medidas, as duas derivam 16,2°
 * (PT) e 16,5° (PL) de matiz entre os níveis 1 e 4 — o § 2 v1.3 proíbe
 * explicitamente ("apenas a intensidade pode variar, nunca a matiz"). Como o
 * hex base do PT mudou de qualquer forma (ΔE 6,25 de #B9142C), manter a rampa
 * literal significaria manter uma exceção constitucional para reproduzir uma
 * cor que já não é a do partido no produto.
 */
const KIT_RAMPS: Readonly<Record<string, readonly [string, string, string, string, string]>> = {
  pt: ["#F6DCE0", "#EBA9B3", "#DC6A7B", "#C0223B", "#8A1128"],
  pl: ["#DCE2F6", "#AEBCEB", "#6F86DA", "#2247B8", "#142E85"],
};

// ---------------------------------------------------------------------------
// BLOCO 2 — os alvos do TEMA ESCURO
// ---------------------------------------------------------------------------
// `buildRamp()` recebe os alvos por parâmetro justamente para que o tema escuro
// seja **uma chamada a mais**, não um segundo gerador. A guarda de ΔE76, o
// solver, o clamp de gamut e o gate de colapso de croma valem igual lá.
//
// De onde saem os cinco alvos escuros — mesmo método do tema claro: medir a
// rampa que o designer entregou (`tokens/colors.css:104-113`) e adotar os
// números, não os hexes.
//
//   nível | PT escuro do kit | PL escuro do kit | alvo adotado
//   ------|------------------|------------------|--------------
//     1   |  15,6 / 14,4     |  15,3 / 19,1     | L* 16 · C* 14
//     2   |  26,0 / 32,9     |  26,2 / 42,3     | L* 26 · C* 33
//     3   |  37,0 / 51,6     |  38,0 / 60,5     | L* 37 · C* 52
//     4   |  50,0 / 62,1     |  53,8 / 58,2     | L* 50 · C* 62
//     5   |  65,3 / 48,4     |  69,7 / 39,8     | L* 65 · C* 48
//
// A escala **inverte**: no escuro o "decisivo" é o mais CLARO, porque é a
// distância ao papel que comunica intensidade, e o papel agora é #14171b. Daí
// `ascending: true` — o gate de monotonicidade passa a cobrar L* estritamente
// crescente do nível 1 ao 5, e o solver empurra o piso de L* para cima em vez
// de para baixo.
//
// Como no claro, o alvo segue **o PT**: a cadência dele (+10,4, +11,0, +13,0,
// +15,3) é a regular das duas, e L* 69,7 (o nível 5 do PL) é claro demais para
// servir de alvo universal — em matiz de gamut estreito o croma desabaria.
// C*₅ / C*₄ = 48 / 62 = **0,77**, o mesmo recuo que o kit desenhou.
//
// **Por que os hexes escuros do kit NÃO são emitidos literalmente**, embora
// PT e PL sejam a referência de calibração: medidos, os dois derivam 16,7° (PT)
// e 8,5° (PL) de matiz entre os níveis 1 e 5, e o § 2 v1.3 proíbe
// explicitamente ("apenas a intensidade pode variar, nunca a matiz"). É
// exatamente o motivo pelo qual `KIT_RAMPS` (as rampas claras) também deixou de
// ser emitido em 2026-09-07. Emitir os literais compraria fidelidade ao
// desenho ao preço de uma exceção constitucional em cima justamente dos dois
// partidos mais visíveis da noite.

/** Alvos de L* por nível no tema escuro. Estritamente **crescente**. */
const DARK_RAMP_L: readonly [number, number, number, number, number] = [16, 26, 37, 50, 65];

/** Alvos de C* por nível no tema escuro. Reduzidos ao gamut de cada matiz. */
const DARK_RAMP_C: readonly [number, number, number, number, number] = [14, 33, 52, 62, 48];

/**
 * Rampas escuras literais do kit, mantidas **só como referência de auditoria**
 * (o `--report` mede o ΔE76 entre cada nível gerado e o valor daqui), pelo
 * mesmo motivo e com a mesma ressalva de `KIT_RAMPS`.
 */
const KIT_DARK_RAMPS: Readonly<Record<string, readonly [string, string, string, string, string]>> =
  {
    pt: ["#3a1f27", "#6b2634", "#a02a42", "#d4405a", "#f07a8e"],
    pl: ["#1e2540", "#29397a", "#3452b5", "#5b7be0", "#91a8f0"],
  };

/**
 * Os alvos de uma rampa, empacotados para `buildRamp()`. É este parâmetro que
 * torna o tema escuro "uma chamada a mais": a mesma função, os mesmos gates,
 * outros cinco pares (L*, C*) e o sentido da escala invertido.
 */
export interface RampTargets {
  readonly L: readonly [number, number, number, number, number];
  readonly C: readonly [number, number, number, number, number];
  /** `true` = L* cresce do nível 1 ao 5 (tema escuro). */
  readonly ascending: boolean;
}

// ===========================================================================
// 3. COLORIMETRIA — sRGB ↔ CIE XYZ ↔ Lab ↔ LCh (D65, observador 2°)
// ===========================================================================
// Implementada aqui de propósito: nenhuma dependência nova (culori, chroma-js,
// color). São ~60 linhas de fórmula fechada, e é a **mesma** conversão que o
// ΔE76 do § 2 usa — ter as duas coisas no mesmo arquivo é o que torna o
// critério constitucional recomputável por um revisor.

/** Ponto branco D65, observador padrão 2° (o mesmo que o sRGB assume). */
const WHITE_D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 } as const;

/** δ = 6/29 — quebra entre o ramo cúbico e o ramo linear de f() no CIELAB. */
const LAB_DELTA = 6 / 29;

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Lab {
  L: number;
  a: number;
  b: number;
}
interface Lch {
  L: number;
  C: number;
  h: number;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Hex inválido: "${hex}" (esperado #RRGGBB)`);
  }
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const byte = (v: number) => {
    // `v` já chegou dentro de [0, 255] (o clamp de gamut garante isso antes do
    // round). O min/max aqui é rede de segurança contra o épsilon do round —
    // não é clipping por canal, que distorceria a matiz.
    const n = Math.min(255, Math.max(0, Math.round(v)));
    return n.toString(16).padStart(2, "0");
  };
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** sRGB 8-bit → canal linear em [0, 1] (transfer function da IEC 61966-2-1). */
function srgbToLinear(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Canal linear em [0, 1] → sRGB em [0, 255] (não arredondado). */
function linearToSrgb(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return c * 255;
}

function rgbToLab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  // Matriz sRGB (D65) → XYZ.
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

  const f = (t: number) => (t > LAB_DELTA ** 3 ? Math.cbrt(t) : t / (3 * LAB_DELTA ** 2) + 4 / 29);
  const fx = f(X / WHITE_D65.X);
  const fy = f(Y / WHITE_D65.Y);
  const fz = f(Z / WHITE_D65.Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab → RGB linear (ainda **sem** clamp — pode sair de [0,1] fora do gamut). */
function labToLinearRgb(lab: Lab): { r: number; g: number; b: number } {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const finv = (t: number) => (t > LAB_DELTA ? t ** 3 : 3 * LAB_DELTA ** 2 * (t - 4 / 29));
  const X = WHITE_D65.X * finv(fx);
  const Y = WHITE_D65.Y * finv(fy);
  const Z = WHITE_D65.Z * finv(fz);

  return {
    r: 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    g: -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    b: 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  };
}

function labToLch(lab: Lab): Lch {
  const C = Math.hypot(lab.a, lab.b);
  // atan2(0, 0) = 0 é determinístico; para C ≈ 0 a matiz é indefinida e
  // irrelevante (nenhum nível acromático usa h).
  const deg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return { L: lab.L, C, h: (deg + 360) % 360 };
}

function lchToLab({ L, C, h }: Lch): Lab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function hexToLch(hex: string): Lch {
  return labToLch(rgbToLab(hexToRgb(hex)));
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex));
}

/**
 * ΔE76 (CIE 1976) entre dois hexes — a métrica que a constituição § 2 v1.3
 * exige (≥ 10) entre o hex editorial do AtlasMenna e o hex oficial do partido.
 * Distância euclidiana em Lab, sem correção de percepção; é justamente a
 * simplicidade que a torna auditável ("qualquer agente pode recomputar").
 */
export function deltaE76(hexA: string, hexB: string): number {
  const a = rgbToLab(hexToRgb(hexA));
  const b = rgbToLab(hexToRgb(hexB));
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

// ---------------------------------------------------------------------------
// Contraste WCAG — outra métrica, outro eixo
// ---------------------------------------------------------------------------
// ΔE76 e contraste WCAG **não são a mesma coisa e não se substituem**: ΔE76 mede
// distância perceptual em Lab (é a guarda de neutralidade política do § 2, "não
// pareça a cor do partido"), enquanto o contraste WCAG é uma razão de
// luminância relativa (é a guarda de legibilidade do § 4, "dá para ler o
// rótulo"). Uma cor pode estar a ΔE76 40 de outra e ainda assim ter 1,2:1 de
// contraste — dois azuis de mesma luminância, por exemplo. Por isso as duas
// medidas convivem aqui, cada uma com seu gate.
//
// A fórmula é a da WCAG 2.1 (SC 1.4.3): luminância relativa com a mesma
// linearização sRGB de `srgbToLinear`, e razão (L_claro + 0,05) / (L_escuro + 0,05).

/** Luminância relativa WCAG 2.1 de um hex sRGB, em [0, 1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Razão de contraste WCAG 2.1 entre dois hexes. Simétrica, em [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------
// Clamp de gamut
// ---------------------------------------------------------------------------
// Nem toda matiz alcança C* = 48 em L* = 58 dentro do sRGB — um amarelo não
// existe escuro e saturado, um azul não existe claro e saturado. A resposta
// **não** é clipar canal a canal (isso muda a matiz: cortar o vermelho de um
// laranja estourado o empurra para amarelo, e a invariante do § 2 é exatamente
// "nunca a matiz"). A resposta é **reduzir o croma** mantendo L* e h, até o
// ponto em que a cor volta a caber — o mesmo comportamento do `gamut mapping`
// do CSS Color 4.

/** Tolerância do teste de gamut: absorve o erro de ponto flutuante da matriz. */
const GAMUT_EPS = 1e-7;

function inGamut(L: number, C: number, h: number): boolean {
  const { r, g, b } = labToLinearRgb(lchToLab({ L, C, h }));
  return [r, g, b].every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
}

/**
 * Iterações da busca binária. **Fixo** (não é "até convergir") para garantir
 * determinismo bit a bit: 40 bisseções sobre [0, 200] dão precisão ~2e-10,
 * muito abaixo do passo de 1/255 do hex final.
 */
const GAMUT_SEARCH_STEPS = 40;

/** Teto de croma da busca. Nenhuma cor sRGB passa de C* ≈ 132. */
const GAMUT_SEARCH_CEILING = 200;

/** Maior C* que cabe no sRGB em (L*, h). Converge **por baixo**: sempre válido. */
function maxChroma(L: number, h: number): number {
  if (!inGamut(L, 0, h)) return 0;
  let lo = 0;
  let hi = GAMUT_SEARCH_CEILING;
  for (let i = 0; i < GAMUT_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lchToHex(L: number, C: number, h: number): string {
  const lin = labToLinearRgb(lchToLab({ L, C, h }));
  return rgbToHex({
    r: linearToSrgb(Math.min(1, Math.max(0, lin.r))),
    g: linearToSrgb(Math.min(1, Math.max(0, lin.g))),
    b: linearToSrgb(Math.min(1, Math.max(0, lin.b))),
  });
}

// ===========================================================================
// 4. HEXES OFICIAIS E O RAIO PROIBIDO
// ===========================================================================

/**
 * Piso operacional de ΔE76 contra hex oficial. A constituição § 2 v1.3 fixa o
 * **mínimo em 10**; aqui usamos 12 para deixar 2 unidades de folga contra
 * revisão de fonte — se um hex oficial for corrigido, ou uma fonte melhor
 * aparecer, uma cor a ΔE 10,3 vira violação constitucional com um ajuste
 * mínimo do lado do partido. A justificativa completa está no `_meta` de
 * `scripts/data/party-official-hexes.json`.
 */
export const DELTA_E_FLOOR = 12;

/**
 * Folga usada **durante a busca**, não na verificação. O solver trabalha em
 * L* / C* contínuos, mas o token emitido é hex de 8 bits por canal: o
 * arredondamento move a cor até ~0,5 unidade Lab e pode reempurrá-la para
 * dentro do raio proibido. Buscar com raio 12,75 e conferir com 12 no hex
 * final resolve isso sem tolerância escondida na verificação.
 */
const SEARCH_MARGIN = 0.75;

export interface OfficialHex {
  hex: string;
  role: string;
  source_type: string;
  url?: string;
  confidence?: string;
  note?: string;
}

interface OfficialEntry {
  party: string;
  official: OfficialHex[];
  note?: string;
}

const OFFICIAL_PATH = path.resolve(import.meta.dirname, "data", "party-official-hexes.json");

/**
 * Hexes oficiais por token, com fonte preservada. Ler do JSON (e não embutir a
 * tabela aqui) é o que permite ao teste em `tests/unit/design-system/` refazer
 * exatamente a mesma conta sobre o CSS commitado, sem importar o gerador.
 */
export function loadOfficialHexes(): Record<string, OfficialEntry> {
  const raw = JSON.parse(readFileSync(OFFICIAL_PATH, "utf8")) as Record<string, unknown>;
  const out: Record<string, OfficialEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_meta") continue;
    out[key] = value as OfficialEntry;
  }
  return out;
}

/**
 * Disco proibido de um hex oficial, projetado no plano (L*, C*) da matiz `h`.
 *
 * A geometria fecha em três linhas e é o que torna o empurrão auditável.
 * Escrevendo o oficial em Lab como (L₀, a₀, b₀) e o nosso ponto como
 * (L, C·cos h, C·sin h), com `p = a₀·cos h + b₀·sin h` (projeção do vetor de
 * croma do oficial sobre a nossa matiz) e `q² = a₀² + b₀² − p²` (o que sobra
 * perpendicular a ela):
 *
 *   ΔE76² = (L − L₀)² + (C − p)² + q²
 *
 * Ou seja: **a matiz fixa vira uma constante aditiva q²**. Ficar a ΔE ≥ r de um
 * oficial é exatamente ficar fora do disco de centro (L₀, p) e raio
 * √(r² − q²) no plano (L, C) — e se q ≥ r o oficial está longe o bastante *só*
 * por diferença de matiz, sem restringir nada. Nada aqui mexe em h.
 */
interface Disc {
  L: number;
  p: number;
  r: number;
  official: OfficialHex;
}

function discsForHue(h: number, officials: readonly OfficialHex[], radius: number): Disc[] {
  const rad = (h * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: Disc[] = [];
  for (const o of officials) {
    const lab = hexToLab(o.hex);
    const p = lab.a * cos + lab.b * sin;
    const q2 = Math.max(0, lab.a * lab.a + lab.b * lab.b - p * p);
    const r2 = radius * radius - q2;
    if (r2 > 0) out.push({ L: lab.L, p, r: Math.sqrt(r2), official: o });
  }
  return out;
}

/** Intervalos de C* proibidos em (L, h) — corte horizontal dos discos. */
function forbiddenChromaIntervals(L: number, discs: readonly Disc[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const d of discs) {
    const s2 = d.r * d.r - (L - d.L) ** 2;
    if (s2 > 0) {
      const s = Math.sqrt(s2);
      out.push([d.p - s, d.p + s]);
    }
  }
  return out;
}

// ===========================================================================
// 4b. `--map-uncounted` — o cinza de "sem apuração" não é um partido
// ===========================================================================
// **O defeito medido em 2026-09-20.** `--party-outros` (fallback universal de
// sigla sem token próprio — PTB e outros 8+ casos reais nas fixtures) força os
// 5 níveis da rampa a serem **puramente acromáticos** (C* = 0 em todo L*, ver
// `entry.neutral` em `buildRamp`). O nível 1 sai em L* 90 · C* 0, que é quase
// exatamente `--map-uncounted` (o cinza de "sem apuração" do mapa, L* 90,47 ·
// C* 2,31 no claro): ΔE76 **2,39**. Na vista "margem" do mapa nacional, o
// nível 1 é o de menor margem — um estado onde um candidato sem cor própria
// LIDERA por pouco fica visualmente indistinguível de um estado onde NINGUÉM
// apurou. Isso quebra a decisão do dono de 14/09: "não começou", "não sabemos"
// e "apurando" são três estados que nunca podem se confundir.
//
// **Por que 10, não 12.** `PARTY_SEPARATION_FLOOR` (12) responde "estas duas
// cores são o MESMO PARTIDO?" e carrega 2 unidades de folga contra revisão de
// fonte oficial — não se aplica aqui, porque `--map-uncounted` não é hex de
// terceiro sujeito a revisão, é token de primeira mão deste repositório. A
// pergunta certa é a mais simples, "sem apuração" e "há um número aqui" leem
// como a MESMA COR? — exatamente o que `components/blocks/_swingRamp.ts` já
// respondeu em 18/09 para o mesmo cinza, com o piso **10** da constituição §2
// (ver `PISO_DELTA_E` em `tests/unit/design-system/swing-ramp.test.ts`). Este
// gerador reusa o mesmo piso pela mesma razão, não um número novo.
//
// **A correção não é "outros" ficar colorido.** Aplicar os alvos de croma reais
// (`RAMP_C` = 10..66) ao resíduo de matiz do cinza produziria um azul de
// verdade no nível 3 — o comentário original de `entry.neutral` já registra
// essa armadilha, e ela continua válida. Em vez disso, cada nível neutro ganha
// só o croma MÍNIMO necessário, numa matiz FIXA e oposta à de
// `--map-uncounted` (o ponto mais eficiente para abrir distância), calculado
// em forma fechada: como a matiz é exatamente oposta, o vetor (a,b) do alvo e
// o de `--map-uncounted` somam em módulo em vez de cancelar, e
// `ΔE76² = ΔL² + (C + C_mapa)²` — sem essa simetria seria preciso buscar.
// Níveis já longes em L* (3, 4, 5 no claro; 3+ no escuro) já vencem o piso só
// pela distância em L* e recebem croma 0, exatamente como antes: a mudança só
// toca os níveis que de fato colidiam (1 nos dois temas; também o 2 no
// escuro), o menor deslocamento que resolve o defeito.
//
// Medido, o nível 1 sai com C* ≈ 10 (claro) / ≈ 9 (escuro) — a MESMA ordem de
// grandeza do croma que qualquer partido real já usa no próprio nível 1
// (`RAMP_C[0]` = 10): visualmente é a mesma sutileza de matiz que o nível mais
// claro de qualquer partido tem, só apontada para longe do cinza de ausência
// em vez de para a identidade de um partido.

const GLOBALS_CSS_PATH = path.resolve(import.meta.dirname, "..", "app", "globals.css");

/**
 * Piso de ΔE76 entre `--party-outros` (base, chip, tinta e os 5 níveis) e
 * `--map-uncounted`. Ver justificativa do "10, não 12" acima.
 */
export const MAP_UNCOUNTED_SEPARATION_FLOOR = 10;

/**
 * Folga de busca contra `--map-uncounted`, mesmo padrão de `SEARCH_MARGIN`
 * (linha ~610): o alvo contínuo mira `FLOOR + MARGIN` para sobreviver ao
 * arredondamento de 8 bits por canal e ao clamp de gamut sem cair abaixo do
 * piso no hex final.
 */
const MAP_UNCOUNTED_SEARCH_MARGIN = 2;

/**
 * `--map-uncounted` por tema, lido de `app/globals.css` — não de
 * `tokens-party.css`, porque não é token de partido. Mesmo padrão de
 * `loadOfficialHexes()`: ler do arquivo (não embutir o hex aqui) é o que
 * permite ao teste em `tests/unit/design-system/` refazer a mesma conta sem
 * importar este gerador. Os dois tokens (claro, escuro) são a 1ª e a 2ª
 * ocorrência de `--map-uncounted:` no arquivo, nesta ordem — o claro vem
 * antes de qualquer bloco `[data-theme="dark"]`.
 */
function loadMapUncounted(): { light: string; dark: string } {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
  const found = [...css.matchAll(/--map-uncounted:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) =>
    (m[1] as string).toLowerCase(),
  );
  if (found.length < 2) {
    throw new Error(
      `--map-uncounted: esperadas 2 ocorrências (claro, escuro) em app/globals.css, achadas ${found.length}.`,
    );
  }
  return { light: found[0] as string, dark: found[1] as string };
}

const MAP_UNCOUNTED = loadMapUncounted();

function mapUncountedHexFor(spec: ThemeSpec): string {
  return spec.id === "light" ? MAP_UNCOUNTED.light : MAP_UNCOUNTED.dark;
}

/**
 * Matiz oposta à de `--map-uncounted` — o ponto de fuga mais eficiente no
 * plano (a, b): afastar-se nessa direção soma módulos em vez de cancelar
 * parcialmente (ver derivação da seção 4b).
 */
function escapeHueFromMapUncounted(mapLab: Lab): number {
  const hueMap = (Math.atan2(mapLab.b, mapLab.a) * 180) / Math.PI;
  return (hueMap + 180 + 360) % 360;
}

/**
 * Croma mínimo, na matiz `escapeHueFromMapUncounted`, para que um ponto em
 * `L` fique a `floorWithMargin` de `--map-uncounted`. Fechado em forma
 * analítica (nunca busca): com a matiz exatamente oposta, o vetor (a, b) do
 * alvo é `C · (cos, sin)` na direção oposta à de `mapLab`, então a projeção do
 * vetor de `mapLab` sobre essa direção é `−C_mapa` e
 * `ΔE76² = ΔL² + (C − (−C_mapa))² = ΔL² + (C + C_mapa)²`. Isolando C:
 * `C = √(floorWithMargin² − ΔL²) − C_mapa`, e `0` quando a distância em L* já
 * basta sozinha (ou quando o alvo é inatingível nesse L — não ocorre nos
 * níveis usados aqui, ver comentário da seção 4b).
 */
function escapeChromaFromMapUncounted(L: number, mapLab: Lab, floorWithMargin: number): number {
  const mapC = Math.hypot(mapLab.a, mapLab.b);
  const dL = L - mapLab.L;
  const remaining = floorWithMargin * floorWithMargin - dL * dL;
  if (remaining <= 0) return 0;
  return Math.max(0, Math.sqrt(remaining) - mapC);
}

// ===========================================================================
// 5. O SOLVER — empurrar para fora do raio proibido sem tocar na matiz
// ===========================================================================
// Quando um nível cai dentro de algum disco, procuramos o ponto **mais próximo
// do alvo** que satisfaz, ao mesmo tempo:
//
//   (a) fora de todos os discos proibidos    → ΔE76 ≥ 12,75 contra todo oficial
//   (b) dentro do gamut sRGB                 → 0 ≤ C ≤ maxChroma(L, h)
//   (c) L* abaixo do nível anterior por pelo menos LEVEL_MIN_GAP
//                                            → a rampa continua ordenada
//
// minimizando `custo = (W_L·ΔL)² + ΔC²`. O peso W_L = 2 diz que **desviar em
// L* é duas vezes mais caro que desviar em C***, e a razão é assimétrica: L* é
// o eixo que ordena a escala (é ele que faz "decisivo" parecer mais forte que
// "provável"), enquanto um nível menos cromático apenas parece mais discreto —
// não mente sobre a margem.
//
// A busca é uma **grade fixa em L*** (±10 em passos de 0,25) com solução
// **fechada em C*** para cada L: dentro de um L, o melhor croma só pode ser o
// alvo (se livre) ou a borda de um intervalo proibido, do gamut, ou o zero.
// Grade fixa + desempate explícito = mesmo resultado em toda máquina, que é o
// que a constituição § 6 cobra.

/** Peso de ΔL* no custo, relativo a ΔC*. Ver comentário acima. */
const SOLVER_W_L = 2;

/** Amplitude da varredura em L*, para cada lado do alvo. */
const SOLVER_L_SLACK = 10;

/** Passo da varredura em L*. 0,25 é ~4× mais fino que o menor passo visível. */
const SOLVER_L_STEP = 0.25;

/** Distância mínima em L* entre dois níveis vizinhos, depois de empurrados. */
const LEVEL_MIN_GAP = 8;

/** Épsilon usado para sair de um intervalo aberto por dentro do contínuo. */
const INTERVAL_EPS = 1e-4;

/** Menor croma viável em (L, h) mais próximo do alvo. `null` = nenhum. */
function bestChromaAt(
  L: number,
  target: number,
  intervals: ReadonlyArray<[number, number]>,
  cMax: number,
): number | null {
  const feasible = (c: number) =>
    c >= 0 && c <= cMax && intervals.every(([lo, hi]) => !(c > lo && c < hi));

  const candidates: number[] = [Math.min(Math.max(target, 0), cMax)];
  for (const [lo, hi] of intervals) {
    candidates.push(lo - INTERVAL_EPS, hi + INTERVAL_EPS);
  }
  candidates.push(0, cMax);

  let best: number | null = null;
  let bestKey: [number, number] | null = null;
  for (const c of candidates) {
    if (!feasible(c)) continue;
    // Desempate explícito: menor |ΔC|; empatou, menor croma (mais conservador).
    const key: [number, number] = [round6(Math.abs(c - target)), round6(c)];
    if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

/** Arredonda para 6 casas — comparação de chaves imune a ruído de float. */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

interface SolvedLevel {
  L: number;
  C: number;
  /** Deslocado do alvo por causa do ΔE76 (não por causa do gamut). */
  pushed: boolean;
}

function solveLevel(
  targetL: number,
  targetC: number,
  h: number,
  discs: readonly Disc[],
  minL: number,
  maxL: number,
): SolvedLevel | null {
  const steps = Math.round(SOLVER_L_SLACK / SOLVER_L_STEP);
  let best: { L: number; C: number } | null = null;
  let bestKey: [number, number, number] | null = null;

  for (let k = -steps; k <= steps; k++) {
    const L = targetL + k * SOLVER_L_STEP;
    if (L < minL || L > maxL) continue;
    const cMax = maxChroma(L, h);
    const c = bestChromaAt(L, targetC, forbiddenChromaIntervals(L, discs), cMax);
    if (c === null) continue;
    const cost = (SOLVER_W_L * (L - targetL)) ** 2 + (c - targetC) ** 2;
    const key: [number, number, number] = [round6(cost), round6(Math.abs(L - targetL)), round6(c)];
    if (bestKey === null || lexLess(key, bestKey)) {
      best = { L, C: c };
      bestKey = key;
    }
  }
  if (best === null) return null;
  return {
    L: best.L,
    C: best.C,
    pushed: Math.abs(best.L - targetL) > 1e-9 || Math.abs(best.C - targetC) > 1e-9,
  };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv;
  }
  return false;
}

// ===========================================================================
// 5b. O PAR CHIP / TINTA — legibilidade do rótulo sobre a cor do partido
// ===========================================================================
// **O problema que este bloco resolve.** `<PartyTag filled>` pinta o fundo com
// a cor do partido e o rótulo com uma tinta. Enquanto a tinta era fixa
// (`--text-inverse`, quase branco), a sigla ficava ilegível em cima de todo
// partido de base clara — `--party-psol` (#d6a400) dava 2,21:1, `--party-psb`
// 2,34:1, `--party-novo` 2,89:1, `--party-outros` 2,55:1 — contra o mínimo de
// 4,5:1 da constituição § 4 (WCAG 2.1 AA, SC 1.4.3).
//
// **Por que nenhuma tinta fixa serve.** Medindo as 31 bases contra as duas
// tintas do kit (`--ink-0` #14171b e `--paper-0` #fbfbfc), 19 pedem a tinta
// clara e 12 pedem a escura. Qualquer escolha única reprova o outro grupo. A
// tinta, portanto, é **por partido**, e sai medida daqui — não escolhida a olho
// no componente.
//
// **Por que dois partidos ainda precisam de um chip diferente da base.** Verde
// de meio-tom é o caso em que as duas tintas falham ao mesmo tempo:
//
//   --party-mdb  #2e8b57 → 4,23:1 contra o preto, 4,10:1 contra o branco
//   --party-rede #3d8f3d → 4,45:1 contra o preto, 3,91:1 contra o branco
//
// Nenhuma tinta salva essas duas: a base está no meio da escala de luminância,
// longe dos dois extremos. A saída é **escurecer o fundo do chip**, o que é
// permitido pelo § 2 v1.3 — "apenas a intensidade (claro↔saturado) pode variar
// com a margem projetada, **nunca a matiz**" — e é exatamente o que o resto
// deste gerador já faz nos 5 níveis: L* desce, C* é reclampado ao gamut da
// matiz, h não se move. O chip escurecido continua sendo a cor do partido, uma
// intensidade dela.
//
// **Duas coisas que o chip escurecido não pode quebrar.** Escurecer move o
// ponto em Lab e pode empurrá-lo *para dentro* de um disco proibido de hex
// oficial (foi assim que `--party-pp` nível 5 caiu a ΔE 8,3 do azul do PP). Por
// isso a busca só aceita um candidato que passe **o mesmo** `DELTA_E_FLOOR` dos
// demais tokens, medido no hex final contra todos os oficiais do partido. E o
// gate de contraste abaixo falha a geração se algum par sobrar abaixo de 4,5:1.
//
// **Por que o token de tinta é hex literal e não `var(--ink-0)`.** O chip pode
// ser desenhado em contexto sem os tokens de tema resolvidos (um `<svg>`
// standalone, um e-mail, um snapshot de teste que só importa
// `tokens-party.css`). Emitindo `#14171b`/`#fbfbfc` literais, o par chega
// sempre completo — e o valor fica auditável no diff, que é o ponto de um
// arquivo gerado.

/** Tinta escura do kit — `--ink-0` em `app/globals.css`. */
const CHIP_INK_DARK = "#14171b";

/** Tinta clara do kit — `--paper-0` em `app/globals.css`. */
const CHIP_INK_LIGHT = "#fbfbfc";

/** Mínimo de contraste de texto da constituição § 4 (WCAG 2.1 AA, SC 1.4.3). */
export const CHIP_CONTRAST_FLOOR = 4.5;

/**
 * Passo da varredura em L* ao escurecer. 0,25 é o mesmo passo do solver de
 * ΔE76 — fino o bastante para o chip não escurecer mais do que o necessário, e
 * grosso o bastante para a busca ser um número fixo de iterações.
 */
const CHIP_L_STEP = 0.25;

interface GeneratedChip {
  /** Fundo do chip. Igual à base, ou uma intensidade mais escura dela. */
  hex: string;
  /** Tinta sobre o chip: `CHIP_INK_DARK` ou `CHIP_INK_LIGHT`, o que contrasta mais. */
  ink: string;
  /** Contraste WCAG medido entre `hex` e `ink`. */
  contrast: number;
  /**
   * `true` quando a base não admitia nenhuma tinta (ou colidia com outro
   * partido, no escuro) e o chip precisou se deslocar em L* — escurecendo no
   * tema claro, clareando no escuro.
   */
  moved: boolean;
  /** Melhor contraste que a **base** alcançava, com qualquer das duas tintas. */
  baseBestContrast: number;
  /** L* da base e do chip (contínuos, pré-arredondamento 8-bit). */
  baseL: number;
  chipL: number;
  /** ΔE76 entre a base e o chip — 0 quando o chip é a própria base. */
  deltaEFromBase: number;
  /** Pior ΔE76 do chip contra os hexes oficiais (`Infinity` se não há). */
  worstDeltaE: number;
  worstAgainst: OfficialHex | null;
}

/**
 * A tinta que contrasta mais com `hex`, e o contraste que ela dá. As duas
 * candidatas vêm do tema (`ThemeSpec.chipInks`), na ordem [escura, clara].
 */
function bestInkFor(
  hex: string,
  inks: readonly [string, string],
): { ink: string; contrast: number } {
  const [inkDark, inkLight] = inks;
  const dark = contrastRatio(hex, inkDark);
  const light = contrastRatio(hex, inkLight);
  // Desempate explícito (determinismo, § 6): empatou, fica a tinta escura.
  return dark >= light ? { ink: inkDark, contrast: dark } : { ink: inkLight, contrast: light };
}

/**
 * Resolve o par `--party-<slug>-chip` / `--party-<slug>-ink`.
 *
 * Caminho curto: se a base já admite alguma tinta com ≥ 4,5:1, o chip **é** a
 * base — a identidade do partido chega intacta ao componente, que é o
 * comportamento desejado em 29 dos 31 casos.
 *
 * Caminho longo: desce L* em passos de `CHIP_L_STEP` a partir da base, com C*
 * reclampado ao gamut da matiz a cada passo (h intocada), e para no **primeiro**
 * ponto que satisfaz as duas restrições ao mesmo tempo — contraste ≥ 4,5:1 com a
 * tinta clara e ΔE76 ≥ `DELTA_E_FLOOR` contra todos os oficiais do partido.
 * Parar no primeiro é o que mantém o chip o mais próximo possível da identidade.
 *
 * Devolve `null` quando nem o preto absoluto resolve — o que só aconteceria se a
 * matiz estivesse cercada pela paleta oficial do partido em toda a coluna de L*.
 */
function buildChip(
  themeBase: string,
  baseLch: Lch,
  entry: PartyEntry,
  officials: readonly OfficialHex[],
  spec: ThemeSpec,
  placed: readonly string[],
): GeneratedChip | null {
  const base = themeBase.toLowerCase();
  const fromBase = bestInkFor(base, spec.chipInks);
  const farEnough = (hex: string) =>
    !spec.separationAware ||
    placed.every((p) => deltaE76(hex, p) >= PARTY_SEPARATION_FLOOR + SEPARATION_SEARCH_MARGIN);

  if (fromBase.contrast >= CHIP_CONTRAST_FLOOR && farEnough(base)) {
    const { delta, official } = worstAgainstOfficials(base, officials);
    return {
      hex: base,
      ink: fromBase.ink,
      contrast: fromBase.contrast,
      moved: false,
      baseBestContrast: fromBase.contrast,
      baseL: baseLch.L,
      chipL: baseLch.L,
      deltaEFromBase: 0,
      worstDeltaE: delta,
      worstAgainst: official,
    };
  }

  // Índice inteiro em vez de `L -= passo` acumulado: mesmo resultado bit a bit
  // em qualquer máquina, sem erro de ponto flutuante somando ao longo da busca.
  // `spec.contrastStep` dá o sentido: −1 escurece (papel claro), +1 clareia
  // (papel escuro). A tinta-alvo é a oposta, e vem do tema pelo mesmo motivo.
  const [inkDark, inkLight] = spec.chipInks;
  const target = spec.contrastStep < 0 ? inkLight : inkDark;
  const room = spec.contrastStep < 0 ? baseLch.L : 100 - baseLch.L;
  const steps = Math.floor(room / CHIP_L_STEP);
  for (let k = 1; k <= steps; k++) {
    const L = baseLch.L + spec.contrastStep * k * CHIP_L_STEP;
    const C = Math.min(baseLch.C, maxChroma(L, baseLch.h));
    const hex = lchToHex(L, C, baseLch.h);
    if (contrastRatio(hex, target) < CHIP_CONTRAST_FLOOR) continue;
    const { delta, official } = worstAgainstOfficials(hex, officials);
    // O chip deslocado é medido contra os oficiais como qualquer outro token:
    // mover em L* pode empurrar a cor para dentro de um disco proibido.
    if (delta < DELTA_E_FLOOR) continue;
    if (!farEnough(hex)) continue;
    const ink = bestInkFor(hex, spec.chipInks);
    return {
      hex,
      ink: ink.ink,
      contrast: ink.contrast,
      moved: true,
      baseBestContrast: fromBase.contrast,
      baseL: baseLch.L,
      chipL: L,
      deltaEFromBase: deltaE76(base, hex),
      worstDeltaE: delta,
      worstAgainst: official,
    };
  }
  return null;
}

// ===========================================================================
// 5c. O TOKEN DE TEXTO — a cor do partido **carregando** texto sobre o papel
// ===========================================================================
// **O problema que este bloco resolve.** O par `-chip`/`-ink` da seção 5b
// resolve "rótulo em cima da cor do partido". O caso simétrico — **a cor do
// partido como tinta, em cima do papel** — não tinha token nenhum, e é o caso
// mais comum da tela: o número grande do `<ProjectionThermometer />`, o nome do
// líder numa lista, qualquer valor colorido por identidade.
//
// Medido em 2026-09-07 no CSS commitado, contra `--surface-page` (#f3f4f6), a
// superfície onde esse texto de fato cai, quatro bases reprovam o piso de 4,5:1
// da constituição § 4 — PSOL 2,08:1, PSB 2,20:1, o fallback cinza 2,39:1 e NOVO
// 2,72:1. Uma base que serve de contorno, ponto e legenda **não** serve
// automaticamente de tinta: são eixos diferentes (área grande de cor sólida
// contra traço fino de texto), e é exatamente a distinção que o § 4 cobra.
//
// **Por que não reusar `-chip`.** O chip é escolhido para contrastar com uma das
// duas tintas do kit (#14171b ou #fbfbfc), o que em 19 dos 31 partidos
// significa uma cor **clara** — o oposto do que um texto sobre papel claro
// precisa. `--party-psol-chip` é o próprio #d6a400 (7,85:1 contra a tinta
// escura, e 2,08:1 contra o papel). São dois problemas com duas respostas.
//
// **A saída é a mesma do chip: escurecer preservando a matiz.** O § 2 v1.3
// permite variar intensidade e proíbe variar matiz; escurecer em CIE LCh com h
// fixo e C* reclampado ao gamut é o que o resto deste gerador já faz. O token
// de texto continua sendo a cor do partido — uma intensidade dela.
//
// **As duas guardas que valem aqui igualzinho ao chip.**
//   1. escurecer move o ponto em Lab e pode empurrá-lo *para dentro* de um
//      disco proibido de hex oficial (foi assim que `--party-pp` nível 5 caiu a
//      ΔE 8,3 do azul do PP): só aceitamos candidato com ΔE76 ≥ `DELTA_E_FLOOR`
//      contra **todos** os oficiais do partido, medido no hex final;
//   2. o gate de contraste abaixo **falha a geração** se algum `-text` sobrar
//      abaixo de 4,5:1 em qualquer das duas superfícies de papel.
//
// **Por que duas superfícies e não uma.** O mesmo número aparece dentro de um
// card (`--surface-card`, #fbfbfc) e direto sobre o fundo da página
// (`--surface-page`, #f3f4f6). Exigir as duas é exigir a mais escura das duas,
// que é a página — mas medir as duas deixa o número no comentário do CSS e
// impede que uma futura troca de papel (um `--surface-sunken` mais escuro, por
// exemplo) passe despercebida.

/**
 * Superfícies de papel do kit sobre as quais um texto de partido pode cair —
 * `--surface-page` e `--surface-card` em `app/globals.css`. Hex literal pelo
 * mesmo motivo das tintas do chip: o token precisa ser auditável no diff.
 */
const TEXT_SURFACES: ReadonlyArray<{ token: string; hex: string }> = [
  { token: "--surface-page", hex: "#f3f4f6" },
  { token: "--surface-card", hex: "#fbfbfc" },
];

/** Mínimo de contraste de texto da constituição § 4 (WCAG 2.1 AA, SC 1.4.3). */
export const TEXT_CONTRAST_FLOOR = 4.5;

/** Passo da varredura em L* ao escurecer. O mesmo do chip, pelo mesmo motivo. */
const TEXT_L_STEP = 0.25;

interface GeneratedText {
  /** A tinta. Igual à base, ou uma intensidade mais escura dela. */
  hex: string;
  /** Contraste contra cada superfície de `TEXT_SURFACES`, na mesma ordem. */
  contrasts: number[];
  /** O pior dos contrastes acima — é ele que precisa passar de 4,5:1. */
  worstContrast: number;
  worstSurface: string;
  /**
   * `true` quando a base reprovava como texto (ou colidia com outro partido,
   * no escuro) e a tinta precisou se deslocar em L*.
   */
  moved: boolean;
  /** Pior contraste que a **base** alcançava, entre as superfícies. */
  baseWorstContrast: number;
  /** L* da base e da tinta (contínuos, pré-arredondamento 8-bit). */
  baseL: number;
  textL: number;
  /** ΔE76 entre a base e a tinta — 0 quando a tinta é a própria base. */
  deltaEFromBase: number;
  /** Pior ΔE76 da tinta contra os hexes oficiais (`Infinity` se não há). */
  worstDeltaE: number;
  worstAgainst: OfficialHex | null;
}

/** Contraste de `hex` contra cada superfície de papel do tema, e o pior deles. */
function surfaceContrasts(
  hex: string,
  surfaces: ReadonlyArray<{ token: string; hex: string }>,
): {
  contrasts: number[];
  worst: number;
  worstSurface: string;
} {
  const contrasts = surfaces.map((s) => contrastRatio(hex, s.hex));
  let worst = Number.POSITIVE_INFINITY;
  let worstSurface = "";
  for (const [i, c] of contrasts.entries()) {
    // `<` estrito: empatou, fica a primeira da lista (determinismo, § 6).
    if (c < worst) {
      worst = c;
      worstSurface = surfaces[i]?.token ?? "";
    }
  }
  return { contrasts, worst, worstSurface };
}

/**
 * Resolve `--party-<slug>-text`.
 *
 * Caminho curto: se a base já passa de 4,5:1 nas **duas** superfícies, a tinta
 * **é** a base — a identidade do partido chega intacta ao componente.
 *
 * Caminho longo: desce L* em passos de `TEXT_L_STEP` a partir da base, com C*
 * reclampado ao gamut da matiz a cada passo (h intocada), e para no **primeiro**
 * ponto que satisfaz as duas restrições ao mesmo tempo — contraste ≥ 4,5:1 em
 * toda superfície e ΔE76 ≥ `DELTA_E_FLOOR` contra todos os oficiais do partido.
 * Escurecer só aumenta o contraste contra papel claro, então o primeiro ponto
 * que passa é também o mais próximo possível da identidade.
 *
 * Devolve `null` quando nem o preto absoluto resolve — o que só aconteceria se a
 * matiz estivesse cercada pela paleta oficial do partido em toda a coluna de L*.
 */
function buildText(
  themeBase: string,
  baseLch: Lch,
  entry: PartyEntry,
  officials: readonly OfficialHex[],
  spec: ThemeSpec,
  placed: readonly string[],
): GeneratedText | null {
  const base = themeBase.toLowerCase();
  const fromBase = surfaceContrasts(base, spec.textSurfaces);
  const farEnough = (hex: string) =>
    !spec.separationAware ||
    placed.every((p) => deltaE76(hex, p) >= PARTY_SEPARATION_FLOOR + SEPARATION_SEARCH_MARGIN);

  if (fromBase.worst >= TEXT_CONTRAST_FLOOR && farEnough(base)) {
    const { delta, official } = worstAgainstOfficials(base, officials);
    return {
      hex: base,
      contrasts: fromBase.contrasts,
      worstContrast: fromBase.worst,
      worstSurface: fromBase.worstSurface,
      moved: false,
      baseWorstContrast: fromBase.worst,
      baseL: baseLch.L,
      textL: baseLch.L,
      deltaEFromBase: 0,
      worstDeltaE: delta,
      worstAgainst: official,
    };
  }

  // Índice inteiro em vez de `L -= passo` acumulado: mesmo resultado bit a bit
  // em qualquer máquina, sem erro de ponto flutuante somando ao longo da busca.
  // O sentido vem do tema: escurecer sobre papel claro, clarear sobre escuro.
  const room = spec.contrastStep < 0 ? baseLch.L : 100 - baseLch.L;
  const steps = Math.floor(room / TEXT_L_STEP);
  for (let k = 1; k <= steps; k++) {
    const L = baseLch.L + spec.contrastStep * k * TEXT_L_STEP;
    const C = Math.min(baseLch.C, maxChroma(L, baseLch.h));
    const hex = lchToHex(L, C, baseLch.h);
    const sc = surfaceContrasts(hex, spec.textSurfaces);
    if (sc.worst < TEXT_CONTRAST_FLOOR) continue;
    const { delta, official } = worstAgainstOfficials(hex, officials);
    // A tinta deslocada é medida contra os oficiais como qualquer outro token:
    // mover em L* pode empurrar a cor para dentro de um disco proibido.
    if (delta < DELTA_E_FLOOR) continue;
    if (!farEnough(hex)) continue;
    return {
      hex,
      contrasts: sc.contrasts,
      worstContrast: sc.worst,
      worstSurface: sc.worstSurface,
      moved: true,
      baseWorstContrast: fromBase.worst,
      baseL: baseLch.L,
      textL: L,
      deltaEFromBase: deltaE76(base, hex),
      worstDeltaE: delta,
      worstAgainst: official,
    };
  }
  return null;
}

// ===========================================================================
// 5d. O TEMA COMO PARÂMETRO — e a cor de identidade no escuro
// ===========================================================================
// Tudo acima foi escrito assumindo papel claro: as duas superfícies de
// `TEXT_SURFACES` são cinzas quase brancos, e `buildChip`/`buildText` ganham
// contraste **escurecendo**. No tema escuro as duas afirmações se invertem, e
// nada mais muda — por isso o tema entra como um `ThemeSpec` e não como um
// segundo gerador.
//
// ---------------------------------------------------------------------------
// O problema que o escuro traz e o claro não tinha: a BASE some
// ---------------------------------------------------------------------------
// `--party-<sigla>` é a cor de identidade — contorno de polígono, ponto,
// preenchimento de barra, legenda. Sobre papel claro as 31 bases funcionam
// como objeto gráfico. Sobre o papel escuro, **13 das 31 não chegam a 3:1**
// contra `--paper-0` #1c1f24 (WCAG 2.1 SC 1.4.11, objeto gráfico): PL 2,09 ·
// União 1,70 · PSTU 2,08 · Republicanos 2,15 · Democrata 2,19 · PDT 2,21 ·
// PCdoB 2,30 · PCO 2,55 · PP 2,63 · Avante 2,72 · PV 2,78 · PCB 2,86 · UP 2,11.
// São as cores escuras da paleta — as que o tema claro escolheu justamente por
// serem escuras.
//
// ---------------------------------------------------------------------------
// Por que NÃO se clareia "o mínimo necessário", partido a partido
// ---------------------------------------------------------------------------
// A saída óbvia — subir o L* de cada base violadora até bater 3:1 e parar — foi
// medida e **reprova o piso de separação do ADR-0031**: sete pares caem abaixo
// de ΔE76 12 (`dc × republicanos` 5,71, `pp × uniao` 7,59, `pl × prd` 8,58,
// `dc × uniao` 8,57, `pstu × pcb` 10,27, `republicanos × uniao` 11,61,
// `dc × pp` 11,92). O mecanismo é direto: os sete azuis institucionais da
// paleta se distinguem no claro **principalmente por L***, e mandar todo mundo
// parar na mesma linha de contraste é exatamente destruir esse eixo.
//
// ---------------------------------------------------------------------------
// A regra adotada: um mapa AFIM de L*, igual para os 31
// ---------------------------------------------------------------------------
// A base escura de cada partido é a base clara com
//
//   L*_escuro = LO + (L*_claro − L*_min) / (L*_max − L*_min) × (HI − LO)
//   C*_escuro = min( maxChroma(L*_escuro, h) , C*_claro × GANHO )
//   h         = INTOCADA
//
// Um mapa afim é monótono: preserva **a ordem e o espaçamento relativo** de L*
// da paleta inteira, que é o eixo que o clareamento ingênuo destruía. O ganho
// de croma compensa o que o gamut aperta ao subir de lightness — sem ele, os
// azuis desbotam para o mesmo lavanda.
//
// LO = 45, HI = 87 e GANHO = 1,30 não são escolha de gosto: são o ponto da
// família (LO, HI, GANHO) medido para maximizar a separação mínima entre
// partidos sujeita aos três pisos. O resultado é
//
//   contraste mínimo da base ......... 3,09:1  (União, o mais escuro)
//   ΔE76 mínimo contra hex oficial ... 12,32   (piso 12)
//   separação mínima entre partidos .. 13,13   (DC × Republicanos; piso 12)
//
// Nenhum piso foi relaxado, e nenhuma matiz se moveu: a identidade de cor de
// cada partido é a mesma nos dois temas — só a intensidade varia, que é
// literalmente o que o § 2 v1.3 autoriza.

/** L* da base escura do partido mais escuro da paleta. */
const DARK_BASE_L_LO = 45;

/** L* da base escura do partido mais claro da paleta. */
const DARK_BASE_L_HI = 87;

/** Ganho de croma aplicado antes do clamp de gamut, ao subir de lightness. */
const DARK_BASE_CHROMA_GAIN = 1.3;

/**
 * Descreve o que muda de um tema para o outro. Tudo o que o gerador faz —
 * rampa, chip, tinta de texto, gates — é função destes campos.
 */
export interface ThemeSpec {
  readonly id: "light" | "dark";
  /** Alvos dos 5 níveis e o sentido da escala. */
  readonly ramp: RampTargets;
  /** Superfícies de papel sobre as quais um `-text` pode cair. */
  readonly textSurfaces: ReadonlyArray<{ token: string; hex: string }>;
  /** As duas tintas candidatas do chip, na ordem [escura, clara]. */
  readonly chipInks: readonly [string, string];
  /**
   * Sentido do ajuste de L* que **ganha** contraste contra o papel do tema:
   * −1 escurece (papel claro), +1 clareia (papel escuro).
   */
  readonly contrastStep: -1 | 1;
  /**
   * Piso de contraste da BASE contra as superfícies do tema (WCAG 1.4.11,
   * objeto gráfico). `0` desliga o gate.
   *
   * No claro é 0 **de propósito**, e não por esquecimento: a base clara é
   * `PARTY_BASE` literal, a mesma tabela que o `--suggest` move quando há
   * colisão, e ligar um gate de contraste ali exigiria mover hexes por uma
   * razão que o tema claro nunca teve (a base clara é lida sobre papel claro
   * junto do rótulo textual, que tem seu próprio token `-text` medido em
   * 4,5:1). No escuro a base é **derivada**, então o piso é aplicável sem
   * mexer em nenhuma cor de identidade.
   */
  readonly baseContrastFloor: number;
  /**
   * Quando `true`, a busca de `-chip` e `-text` também exige separação de
   * `PARTY_SEPARATION_FLOOR` contra os partidos já posicionados.
   *
   * Ligado só no escuro, e a assimetria é o ponto: no claro, colisão se
   * resolve movendo o hex de `PARTY_BASE` (§ 7c) — a base é dado de entrada.
   * No escuro a base é derivada da clara, então mover `PARTY_BASE` para
   * resolver uma colisão que só existe no escuro degradaria o tema claro para
   * consertar o outro. O grau de liberdade que sobra é a própria intensidade
   * do token derivado — o mesmo que o § 2 v1.3 autoriza, e o mesmo que
   * `buildChip`/`buildText` já usam para ganhar contraste.
   */
  readonly separationAware: boolean;
  /** Estados de corrida (`tie` / `none`) no papel do tema. */
  readonly states: ReadonlyArray<{ name: string; hex: string; nota: string }>;
}

/** Superfícies de papel do tema escuro — `--paper-1` e `--paper-0` em dark. */
const DARK_TEXT_SURFACES: ReadonlyArray<{ token: string; hex: string }> = [
  { token: "--surface-page", hex: "#14171b" },
  { token: "--surface-card", hex: "#1c1f24" },
];

/** Estados de corrida no escuro — hexes do kit (`colors.css:117-118`). */
const DARK_STATE_TOKENS: ReadonlyArray<{ name: string; hex: string; nota: string }> = [
  { name: "tie", hex: "#4a505a", nota: "empate técnico" },
  { name: "none", hex: "#2b3037", nota: "sem projeção / não apurado" },
];

export const LIGHT_THEME: ThemeSpec = {
  id: "light",
  ramp: { L: RAMP_L, C: RAMP_C, ascending: false },
  textSurfaces: TEXT_SURFACES,
  chipInks: [CHIP_INK_DARK, CHIP_INK_LIGHT],
  contrastStep: -1,
  baseContrastFloor: 0,
  separationAware: false,
  states: STATE_TOKENS,
};

export const DARK_THEME: ThemeSpec = {
  id: "dark",
  ramp: { L: DARK_RAMP_L, C: DARK_RAMP_C, ascending: true },
  textSurfaces: DARK_TEXT_SURFACES,
  // As tintas do chip no escuro são os primitivos escuros do kit: `--paper-1`
  // (#14171b) e `--ink-0` (#eceef1). Hex literal pelo mesmo motivo do claro.
  chipInks: ["#14171b", "#eceef1"],
  contrastStep: 1,
  baseContrastFloor: 3,
  separationAware: true,
  states: DARK_STATE_TOKENS,
};

/**
 * A cor de identidade de um partido no tema do `spec`.
 *
 * No claro é `PARTY_BASE` literal. No escuro é o mapa afim documentado acima —
 * matiz intocada, L* remapeado para a faixa legível sobre papel escuro, croma
 * com ganho e clamp de gamut. Determinístico: a faixa de L* da paleta é
 * calculada da própria `PARTY_BASE`, sem estado externo.
 */
function themeBaseHex(entry: PartyEntry, spec: ThemeSpec): string {
  if (spec.id === "light") return entry.base.toLowerCase();
  const all = PARTY_BASE.map((e) => hexToLch(e.base).L);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const { L, C, h } = hexToLch(entry.base);
  const t = hi - lo <= 0 ? 0 : (L - lo) / (hi - lo);
  const targetL = DARK_BASE_L_LO + t * (DARK_BASE_L_HI - DARK_BASE_L_LO);
  const targetC = entry.neutral ? 0 : Math.min(maxChroma(targetL, h), C * DARK_BASE_CHROMA_GAIN);
  return lchToHex(targetL, targetC, h);
}

// ===========================================================================
// 6. GERAÇÃO
// ===========================================================================

interface GeneratedLevel {
  level: 1 | 2 | 3 | 4 | 5;
  hex: string;
  /** Lightness / croma / matiz medidos **no hex final** (pós-round 8-bit). */
  measured: Lch;
  /** Croma reduzido para caber no gamut sRGB da matiz. */
  clamped: boolean;
  /** Croma reduzido para não ficar acima do nível seguinte (anti-inversão). */
  ordered: boolean;
  /** Deslocado em L* / C* para sair do raio proibido de um hex oficial. */
  pushed: boolean;
  /** C* do alvo da rampa, antes de qualquer ajuste. */
  requestedChroma: number;
  /** C* depois do gamut e da ordenação, antes do empurrão de ΔE76. */
  gamutChroma: number;
  /** L* / C* efetivamente emitidos (contínuos, pré-arredondamento 8-bit). */
  effectiveL: number;
  effectiveChroma: number;
  /** Pior ΔE76 contra os hexes oficiais do partido (`Infinity` se não há). */
  worstDeltaE: number;
  worstAgainst: OfficialHex | null;
}

interface GeneratedParty {
  entry: PartyEntry;
  /** Tema em que esta instância foi construída. */
  spec: ThemeSpec;
  /**
   * Cor de identidade **neste tema** — `entry.base` no claro, a derivada do
   * mapa afim no escuro. É o que `--party-<slug>` recebe.
   */
  baseHex: string;
  baseLch: Lch;
  levels: GeneratedLevel[];
  /** Par de fundo/tinta do chip sólido — ver seção 5b. */
  chip: GeneratedChip;
  /** Cor do partido como **tinta sobre o papel** — ver seção 5c. */
  text: GeneratedText;
  officials: OfficialHex[];
  baseDeltaE: number;
  baseAgainst: OfficialHex | null;
}

function worstAgainstOfficials(
  hex: string,
  officials: readonly OfficialHex[],
): { delta: number; official: OfficialHex | null } {
  let delta = Number.POSITIVE_INFINITY;
  let official: OfficialHex | null = null;
  for (const o of officials) {
    const d = deltaE76(hex, o.hex);
    if (d < delta) {
      delta = d;
      official = o;
    }
  }
  return { delta, official };
}

/**
 * Constrói os 5 níveis de um partido. Três passadas, nesta ordem:
 *
 *   1. **alvo ∧ gamut** — C* do nível, reduzido ao que a matiz alcança em L*;
 *   2. **ordenação de croma** — varredura de trás para frente garantindo
 *      C₁ ≤ C₂ ≤ C₃ ≤ C₄ e C₅ ≤ C₄. É o que impede a inversão que existia em
 *      `--party-agir` (C* 47,8 → 12,8 do nível 3 para o 4): quando a matiz não
 *      alcança o croma do nível 4, o nível 3 desce junto em vez de o 4 ficar
 *      mais pálido que ele. O formato final é o do kit — croma sobe até o 4 e
 *      recua no 5;
 *   3. **empurrão de ΔE76** — só onde o alvo cai dentro de um disco proibido.
 *
 * A ordem importa: empurrar antes de ordenar faria a ordenação desfazer o
 * empurrão e reintroduzir a violação.
 */
function buildRamp(
  entry: PartyEntry,
  officials: readonly OfficialHex[],
  spec: ThemeSpec = LIGHT_THEME,
  placedChips: readonly string[] = [],
  placedTexts: readonly string[] = [],
): GeneratedParty {
  const themeBase = themeBaseHex(entry, spec);
  const baseLch = hexToLch(themeBase);
  const h = baseLch.h;
  const rampL = spec.ramp.L;
  const rampC = spec.ramp.C;
  const discs = entry.neutral ? [] : discsForHue(h, officials, DELTA_E_FLOOR + SEARCH_MARGIN);

  // Para um partido neutro ("outros"), os 5 níveis não usam a matiz da base
  // (que existe só para identidade em `--party-outros`/`-chip`/`-text`,
  // intocada abaixo): usam a matiz OPOSTA a `--map-uncounted` — ver seção 4b.
  // Para os 30 partidos reais, `levelHue` é a mesma `h` de sempre.
  const mapLab = entry.neutral ? hexToLab(mapUncountedHexFor(spec)) : null;
  const levelHue = mapLab !== null ? escapeHueFromMapUncounted(mapLab) : h;

  // Passada 1 — alvo ∧ gamut.
  //
  // Para "outros", o alvo por nível não é 0 fixo: é o croma MÍNIMO que separa
  // aquele L* de `--map-uncounted` pelo piso da seção 4b — 0 quando a própria
  // distância em L* já basta (a maioria dos níveis, ver comentário da 4b).
  const chroma: number[] = [];
  const clamped: boolean[] = [];
  const rawTarget: number[] = [];
  for (let i = 0; i < 5; i++) {
    const target =
      mapLab !== null
        ? escapeChromaFromMapUncounted(
            rampL[i] ?? 0,
            mapLab,
            MAP_UNCOUNTED_SEPARATION_FLOOR + MAP_UNCOUNTED_SEARCH_MARGIN,
          )
        : (rampC[i] ?? 0);
    const c = Math.min(target, maxChroma(rampL[i] ?? 0, levelHue));
    chroma.push(c);
    clamped.push(c < target - 1e-9);
    rawTarget.push(target);
  }

  // Passada 2 — ordenação de croma.
  //
  // Este passo assume a FORMA de `RAMP_C` (sobe do nível 1 ao 4, recua no 5) e
  // por isso só se aplica aos 30 partidos reais. O croma de fuga de "outros"
  // tem a forma OPOSTA por construção (maior perto de `--map-uncounted`,
  // caindo a 0 assim que a distância em L* já resolve sozinha — ver 4b): forçar
  // esta ordenação nele destruiria exatamente o croma que separa o nível 1.
  const ordered: boolean[] = [false, false, false, false, false];
  if (mapLab === null) {
    for (let i = 2; i >= 0; i--) {
      const next = chroma[i + 1] ?? 0;
      if ((chroma[i] ?? 0) > next) {
        chroma[i] = next;
        ordered[i] = true;
      }
    }
    if ((chroma[4] ?? 0) > (chroma[3] ?? 0)) {
      chroma[4] = chroma[3] ?? 0;
      ordered[4] = true;
    }
  }

  // Passada 3 — empurrão de ΔE76, com a rampa resolvida do topo para a base
  // para que o piso de L* de cada nível seja o L* **já decidido** do anterior.
  const levels: GeneratedLevel[] = [];
  let previousL: number | null = null;
  for (let i = 0; i < 5; i++) {
    const targetL = rampL[i] ?? 0;
    const targetC = chroma[i] ?? 0;
    // No escuro a escala sobe, então o piso do nível é o L* já decidido do
    // anterior MAIS o vão mínimo; no claro é o teto, MENOS o vão.
    const minL =
      previousL === null || spec.ramp.ascending === false
        ? targetL - SOLVER_L_SLACK
        : Math.max(targetL - SOLVER_L_SLACK, previousL + LEVEL_MIN_GAP);
    const maxL =
      previousL === null || spec.ramp.ascending === true
        ? targetL + SOLVER_L_SLACK
        : Math.min(targetL + SOLVER_L_SLACK, previousL - LEVEL_MIN_GAP);
    const solved = solveLevel(targetL, targetC, levelHue, discs, minL, maxL);
    if (solved === null) {
      throw new Error(
        `--party-${entry.slug}-${i + 1}: nenhum ponto em L* ∈ [${minL.toFixed(1)}, ${maxL.toFixed(1)}] ` +
          `na matiz ${levelHue.toFixed(1)}° fica a ΔE76 ≥ ${DELTA_E_FLOOR} de todos os hexes oficiais do partido.\n` +
          `A matiz base #${entry.base} está cercada demais pela paleta oficial: escolha outro hex base em PARTY_BASE.`,
      );
    }
    const hex = lchToHex(solved.L, solved.C, levelHue);
    const { delta, official } = worstAgainstOfficials(hex, officials);
    levels.push({
      level: (i + 1) as 1 | 2 | 3 | 4 | 5,
      hex,
      measured: hexToLch(hex),
      clamped: clamped[i] ?? false,
      ordered: ordered[i] ?? false,
      pushed: solved.pushed,
      requestedChroma: rawTarget[i] ?? 0,
      gamutChroma: targetC,
      effectiveL: solved.L,
      effectiveChroma: solved.C,
      worstDeltaE: delta,
      worstAgainst: official,
    });
    previousL = solved.L;
  }

  const chip = buildChip(themeBase, baseLch, entry, officials, spec, placedChips);
  if (chip === null) {
    throw new Error(
      `--party-${entry.slug}-chip (tema ${spec.id}): nenhuma intensidade da matiz ${h.toFixed(1)}° chega a ` +
        `${CHIP_CONTRAST_FLOOR.toFixed(1)}:1 com a tinta oposta sem cair a menos de ΔE76 ` +
        `${DELTA_E_FLOOR} de um hex oficial de ${entry.nome}.\n` +
        `A matiz base ${entry.base} está cercada pela paleta oficial do partido em toda a coluna ` +
        "de L*: escolha outro hex base em PARTY_BASE.",
    );
  }

  const text = buildText(themeBase, baseLch, entry, officials, spec, placedTexts);
  if (text === null) {
    throw new Error(
      `--party-${entry.slug}-text (tema ${spec.id}): nenhuma intensidade da matiz ${h.toFixed(1)}° chega a ` +
        `${TEXT_CONTRAST_FLOOR.toFixed(1)}:1 contra ${spec.textSurfaces.map((s) => s.hex).join(" e ")} ` +
        `sem cair a menos de ΔE76 ${DELTA_E_FLOOR} de um hex oficial de ${entry.nome}.\n` +
        `A matiz base ${entry.base} está cercada pela paleta oficial do partido em toda a coluna ` +
        "de L*: escolha outro hex base em PARTY_BASE.",
    );
  }

  const base = worstAgainstOfficials(themeBase.toLowerCase(), officials);
  return {
    entry,
    spec,
    baseHex: themeBase.toLowerCase(),
    baseLch,
    levels,
    chip,
    text,
    officials: [...officials],
    baseDeltaE: base.delta,
    baseAgainst: base.official,
  };
}

/**
 * Constrói os 31 partidos de **um tema**.
 *
 * No claro é um `map` — cada partido é independente. No escuro há uma ordem,
 * porque `-chip` e `-text` passam a exigir separação contra os partidos já
 * posicionados (`ThemeSpec.separationAware`), e "já posicionados" só existe se
 * houver ordem. Ela é a mesma do § 7c, e pela mesma razão de neutralidade:
 *
 *   1. **Quem não precisa se mover, não se move.** Primeira passada sem
 *      restrição de separação; quem sai com `moved: false` fica onde está.
 *      É a regra "menos hexes alterados" aplicada aqui.
 *   2. **Quem precisa se mover entra em ordem alfabética de slug** — desempate
 *      cego a bancada, espectro ou relevância eleitoral. Cada um enxerga os já
 *      colocados; o primeiro ponto que passa em contraste, ΔE76 contra os
 *      oficiais e separação vence.
 *
 * Nenhuma das duas olha para quem é o partido.
 */
function buildTheme(
  entries: readonly PartyEntry[],
  officialsOf: (slug: string) => readonly OfficialHex[],
  spec: ThemeSpec,
): GeneratedParty[] {
  const first = entries.map((e) => buildRamp(e, officialsOf(e.slug), spec));
  if (!spec.separationAware) return first;

  // Os dois papéis são posicionados de forma INDEPENDENTE: um partido pode
  // estar parado no chip e precisar andar na tinta de texto (ou o contrário).
  // Tratá-los juntos faria o parado ser comparado consigo mesmo e andar à toa.
  const alphabetical = [...first].sort((a, b) => (a.entry.slug < b.entry.slug ? -1 : 1));

  const placedChips = first.filter((p) => !p.chip.moved).map((p) => p.chip.hex);
  const chips = new Map(first.filter((p) => !p.chip.moved).map((p) => [p.entry.slug, p.chip]));
  for (const p of alphabetical) {
    if (chips.has(p.entry.slug)) continue;
    const chip = buildChip(
      p.baseHex,
      p.baseLch,
      p.entry,
      officialsOf(p.entry.slug),
      spec,
      placedChips,
    );
    if (chip === null) {
      throw new Error(
        `--party-${p.entry.slug}-chip (tema ${spec.id}): nenhuma intensidade da matiz ` +
          `${p.baseLch.h.toFixed(1)}° satisfaz ao mesmo tempo ${CHIP_CONTRAST_FLOOR.toFixed(1)}:1 ` +
          `com a tinta oposta, ΔE76 ${DELTA_E_FLOOR} dos hexes oficiais e ` +
          `ΔE76 ${PARTY_SEPARATION_FLOOR} dos outros partidos.`,
      );
    }
    placedChips.push(chip.hex);
    chips.set(p.entry.slug, chip);
  }

  const placedTexts = first.filter((p) => !p.text.moved).map((p) => p.text.hex);
  const texts = new Map(first.filter((p) => !p.text.moved).map((p) => [p.entry.slug, p.text]));
  for (const p of alphabetical) {
    if (texts.has(p.entry.slug)) continue;
    const text = buildText(
      p.baseHex,
      p.baseLch,
      p.entry,
      officialsOf(p.entry.slug),
      spec,
      placedTexts,
    );
    if (text === null) {
      throw new Error(
        `--party-${p.entry.slug}-text (tema ${spec.id}): nenhuma intensidade da matiz ` +
          `${p.baseLch.h.toFixed(1)}° satisfaz ao mesmo tempo ${TEXT_CONTRAST_FLOOR.toFixed(1)}:1 ` +
          `sobre o papel escuro, ΔE76 ${DELTA_E_FLOOR} dos hexes oficiais e ` +
          `ΔE76 ${PARTY_SEPARATION_FLOOR} dos outros partidos.`,
      );
    }
    placedTexts.push(text.hex);
    texts.set(p.entry.slug, text);
  }

  return first.map((p) => ({
    ...p,
    chip: chips.get(p.entry.slug) as GeneratedChip,
    text: texts.get(p.entry.slug) as GeneratedText,
  }));
}

// ===========================================================================
// 7. VALIDAÇÃO — o que faz a geração falhar
// ===========================================================================

interface Violation {
  token: string;
  hex: string;
  deltaE: number;
  official: OfficialHex;
  party: string;
}

/** Base + 5 níveis × todos os hexes oficiais do partido. Sem exceção. */
function deltaEViolations(parties: readonly GeneratedParty[]): Violation[] {
  const out: Violation[] = [];
  for (const p of parties) {
    const check = (token: string, hex: string) => {
      for (const o of p.officials) {
        const d = deltaE76(hex, o.hex);
        if (d < DELTA_E_FLOOR) {
          out.push({ token, hex, deltaE: d, official: o, party: p.entry.nome });
        }
      }
    };
    check(`--party-${p.entry.slug}`, p.baseHex);
    // O chip entra no mesmo gate: quando ele diverge da base (por escurecimento),
    // é uma cor nova, e cor nova de partido se mede contra os oficiais como
    // qualquer outra. `--party-<slug>-ink` fica **fora** de propósito: é preto ou
    // branco do kit, não uma cor de partido — medi-lo contra a paleta oficial
    // seria uma pergunta sem sentido.
    check(`--party-${p.entry.slug}-chip`, p.chip.hex);
    // Mesma regra para a tinta de texto (seção 5c): quando ela diverge da base,
    // é uma cor nova de partido, e escurecer pode empurrá-la para dentro de um
    // disco proibido exatamente como acontecia com o chip e com os níveis.
    check(`--party-${p.entry.slug}-text`, p.text.hex);
    for (const lv of p.levels) check(`--party-${p.entry.slug}-${lv.level}`, lv.hex);
  }
  return out;
}

/**
 * Gate de legibilidade da constituição § 4: todo par chip/tinta emitido precisa
 * dar ≥ 4,5:1. `buildChip` já só devolve pares que passam — este gate existe
 * para que uma mudança futura em `PARTY_BASE`, nas tintas, ou no próprio
 * `buildChip` não consiga emitir um chip ilegível em silêncio.
 */
function contrastViolations(
  parties: readonly GeneratedParty[],
): Array<{ party: GeneratedParty; contrast: number }> {
  return parties
    .filter((p) => p.chip.contrast < CHIP_CONTRAST_FLOOR)
    .map((p) => ({ party: p, contrast: p.chip.contrast }));
}

function formatContrastViolations(
  violations: ReadonlyArray<{ party: GeneratedParty; contrast: number }>,
): string {
  const lines = [
    `${violations.length} par(es) chip/tinta abaixo de ${CHIP_CONTRAST_FLOOR.toFixed(1)}:1 — ` +
      "a sigla ficaria ilegível sobre o chip sólido.",
    "Isso viola a constituição § 4 (WCAG 2.1 AA, SC 1.4.3: contraste mínimo de texto 4.5:1).",
    "",
  ];
  for (const { party, contrast } of violations) {
    const c = party.chip;
    lines.push(`  --party-${party.entry.slug}-chip: ${c.hex} (${party.entry.nome})`);
    lines.push(
      `    contraste ${contrast.toFixed(2)}:1 contra --party-${party.entry.slug}-ink ${c.ink}`,
    );
    lines.push(
      `    a base ${party.baseHex} alcançava no máximo ` +
        `${c.baseBestContrast.toFixed(2)}:1 com qualquer das duas tintas`,
    );
  }
  lines.push("");
  lines.push(
    "`buildChip` escurece o fundo (matiz preservada) até a tinta clara passar; se ele parou\n" +
      "antes, foi o piso de ΔE76 contra os hexes oficiais do partido que bloqueou a descida.\n" +
      "Nesse caso o hex base precisa mudar em PARTY_BASE — não relaxe nenhum dos dois pisos.",
  );
  return lines.join("\n");
}

/**
 * Gate de legibilidade da constituição § 4 para a tinta de texto: todo
 * `--party-<slug>-text` precisa dar ≥ 4,5:1 contra **cada** superfície de papel
 * de `TEXT_SURFACES`. `buildText` já só devolve tintas que passam — este gate
 * existe para que uma mudança futura em `PARTY_BASE`, nas superfícies, ou no
 * próprio `buildText` não consiga emitir um texto ilegível em silêncio.
 */
function textContrastViolations(
  parties: readonly GeneratedParty[],
): Array<{ party: GeneratedParty; contrast: number }> {
  return parties
    .filter((p) => p.text.worstContrast < TEXT_CONTRAST_FLOOR)
    .map((p) => ({ party: p, contrast: p.text.worstContrast }));
}

function formatTextContrastViolations(
  violations: ReadonlyArray<{ party: GeneratedParty; contrast: number }>,
): string {
  const lines = [
    `${violations.length} token(s) -text abaixo de ${TEXT_CONTRAST_FLOOR.toFixed(1)}:1 — ` +
      "o número/rótulo ficaria ilegível sobre o papel.",
    "Isso viola a constituição § 4 (WCAG 2.1 AA, SC 1.4.3: contraste mínimo de texto 4.5:1).",
    "",
  ];
  for (const { party, contrast } of violations) {
    const t = party.text;
    lines.push(`  --party-${party.entry.slug}-text: ${t.hex} (${party.entry.nome})`);
    for (const [i, s] of party.spec.textSurfaces.entries()) {
      lines.push(`    ${(t.contrasts[i] ?? 0).toFixed(2)}:1 contra ${s.token} ${s.hex}`);
    }
    lines.push(`    pior: ${contrast.toFixed(2)}:1 em ${t.worstSurface}`);
  }
  lines.push("");
  lines.push(
    "`buildText` escurece a tinta (matiz preservada) até as duas superfícies passarem; se ele\n" +
      "parou antes, foi o piso de ΔE76 contra os hexes oficiais do partido que bloqueou a\n" +
      "descida. Nesse caso o hex base precisa mudar em PARTY_BASE — não relaxe nenhum dos dois\n" +
      "pisos.",
  );
  return lines.join("\n");
}

/**
 * A rampa é lida como escala de margem — 1 = disputa apertada, 5 = decisivo —
 * então L* **precisa** cair estritamente do nível 1 ao 5. Onde não cai,
 * "decisivo" aparece mais claro que "provável" e a escala mente para o leitor.
 * Medido no hex final, não no alvo contínuo.
 */
function monotonicityViolations(parties: readonly GeneratedParty[]): string[] {
  const out: string[] = [];
  for (const p of parties) {
    for (let i = 1; i < p.levels.length; i++) {
      const prev = p.levels[i - 1];
      const cur = p.levels[i];
      if (!prev || !cur) continue;
      // No tema escuro a escala inverte: "decisivo" é o mais CLARO.
      const foraDeOrdem = p.spec.ramp.ascending
        ? cur.measured.L <= prev.measured.L
        : cur.measured.L >= prev.measured.L;
      if (foraDeOrdem) {
        out.push(
          `--party-${p.entry.slug} (tema ${p.spec.id}): nível ${cur.level} ` +
            `(L* ${cur.measured.L.toFixed(1)}) não é mais ` +
            `${p.spec.ramp.ascending ? "claro" : "escuro"} que o nível ${prev.level} ` +
            `(L* ${prev.measured.L.toFixed(1)})`,
        );
      }
    }
  }
  return out;
}

/** Aviso, não erro: croma caindo do nível 3 para o 4 (a rampa fica achatada). */
function chromaInversions(parties: readonly GeneratedParty[]): string[] {
  const out: string[] = [];
  for (const p of parties) {
    if (p.entry.neutral) continue;
    for (let i = 1; i < 4; i++) {
      const prev = p.levels[i - 1];
      const cur = p.levels[i];
      if (!prev || !cur) continue;
      // 0,6 absorve o ruído do arredondamento 8-bit.
      if (cur.measured.C < prev.measured.C - 0.6) {
        out.push(
          `--party-${p.entry.slug}: C* cai de ${prev.measured.C.toFixed(1)} (nível ${prev.level}) ` +
            `para ${cur.measured.C.toFixed(1)} (nível ${cur.level})`,
        );
      }
    }
  }
  return out;
}

function formatViolations(violations: readonly Violation[]): string {
  const lines = [
    `${violations.length} token(s) a menos de ΔE76 ${DELTA_E_FLOOR} de um hex oficial de partido.`,
    "Isso viola a constituição § 2 v1.3 (mínimo 10) ou a margem operacional deste repositório (12).",
    "",
  ];
  for (const v of violations) {
    lines.push(`  ${v.token}: ${v.hex}`);
    lines.push(
      `    ΔE76 ${v.deltaE.toFixed(2)} contra ${v.official.hex} — ${v.party}, ${v.official.role}`,
    );
    lines.push(
      `    fonte: ${v.official.source_type}${v.official.url ? ` · ${v.official.url}` : ""}` +
        `${v.official.confidence ? ` (confiança ${v.official.confidence})` : ""}`,
    );
  }
  lines.push("");
  lines.push(
    "Se o token violando é o base (`--party-<sigla>`), escolha outro hex em PARTY_BASE.\n" +
      "Se é um nível, o solver não achou saída na matiz do base — a matiz está cercada\n" +
      "pela paleta oficial do partido e o hex base precisa mudar de matiz.",
  );
  return lines.join("\n");
}

// ===========================================================================
// 7b. SEPARAÇÃO ENTRE PARTIDOS — a distância que o kit nunca mediu
// ===========================================================================
// **O problema que este bloco resolve.** Todos os gates acima medem a paleta
// contra o **lado de fora**: ΔE76 ≥ 12 do hex oficial do partido (§ 2), 4,5:1
// de contraste (§ 4). Nenhum media a paleta contra **ela mesma**. Medido em
// 2026-09-08 sobre o CSS commitado, os 465 pares das 31 bases traziam cinco
// colisões indistinguíveis a olho nu:
//
//   --party-dc  #3b6fb0 × --party-pp   #2c6fb0 → ΔE76  2,52
//   --party-pco #a1332b × --party-pstu #9e2b2b → ΔE76  3,55
//   --party-pcb #b63a2e × --party-pco  #a1332b → ΔE76  8,25
//   --party-mdb #2e8b57 × --party-psd  #2f8f6b → ΔE76  9,54
//   --party-pcb #b63a2e × --party-pstu #9e2b2b → ΔE76  9,98
//
// Isso vem do kit: o designer mediu cada cor contra a marca do partido, nunca
// contra as outras 30 cores da própria paleta. Uma paleta que existe para
// responder "**qual** partido" e entrega a mesma cor para dois deles não cumpre
// o § 2 — a distinguibilidade é o serviço, não um efeito colateral.
//
// ---------------------------------------------------------------------------
// Por que o piso é 12 — o mesmo número do gate contra os oficiais
// ---------------------------------------------------------------------------
// Medido sobre os 465 pares de partidos (a distância de um par é a **menor**
// entre os três papéis), quantos pares reprovariam em cada candidato de piso,
// quantos partidos ficariam envolvidos, e quantos hexes precisariam mudar para
// o piso passar (cobertura mínima do grafo de conflito, com o PP já contado —
// ele muda de qualquer forma, ver o bloco do colapso de croma):
//
//   piso | pares reprovados | partidos envolvidos | hexes a mudar (mínimo)
//   -----|------------------|---------------------|-----------------------
//     10 |                6 |                   9 |   5
//     12 |                7 |                  11 |   6
//     14 |               14 |                  19 |   9
//     16 |               15 |                  20 |  10
//     18 |               20 |                  24 |  10
//     20 |               25 |                  25 |  14
//     25 |               41 |                  30 |  16
//
// **12** é o escolhido, por três razões, nesta ordem:
//
//   1. **É o número que o repositório já opera.** `DELTA_E_FLOOR` = 12 é a
//      distância mínima que uma cor nossa mantém do hex oficial de um partido.
//      Se 12 é o bastante para dizer "esta cor **não é** a do PT", é o bastante
//      para dizer "esta cor não é a do PSTU". Um segundo número exigiria
//      justificar por que a mesma pergunta perceptual tem duas respostas — e a
//      resposta seria "nenhuma".
//   2. **12 cai dentro de um vão do próprio dado.** Ordenados, os pares vão
//      2,51 · 2,52 · 3,55 · 8,25 · 9,36 · 9,98 · **11,69** ··· **12,09** ·
//      12,13 · 12,35 — há um salto vazio entre 11,69 e 12,09. O piso separa
//      dois grupos que já existem, em vez de cortar no meio de um. Um piso de
//      10 cortaria rente: deixaria PCB × PSTU passar por 0,02 e absolveria
//      Avante × PRD (11,69), dois violetas. E 10 é justamente o mínimo
//      constitucional sem folga nenhuma — a mesma razão pela qual o gate contra
//      os oficiais opera em 12 e não em 10.
//   3. **Acima de 12 o custo deixa de ser "corrigir" e vira "redesenhar".** O
//      salto de 12 para 14 dobra os pares (7 → 14), quase dobra os partidos
//      envolvidos (11 → 19) e vai de 6 para 9 hexes; em 25 são 30 dos 31
//      partidos. E os pares que 14 compraria são azuis institucionais que já se
//      distinguem lado a lado (DC × Republicanos 12,13, PP × Republicanos
//      12,35, Republicanos × União 13,31): pagar-se-ia meia paleta para
//      resolver confusão que ninguém tem.
//
// ---------------------------------------------------------------------------
// Quais papéis entram — e por que os níveis 1..5 NÃO podem entrar
// ---------------------------------------------------------------------------
// Entram os três tokens que **são a cor de um partido** e aparecem sem rótulo
// que os desambigue: `--party-<slug>` (contorno, ponto, preenchimento),
// `--party-<slug>-chip` (fundo sólido) e `--party-<slug>-text` (a identidade
// como tinta). São exatamente os mesmos três que o gate contra os oficiais já
// cobre — `-ink` fica de fora nos dois pelo mesmo motivo: é preto ou branco do
// kit, não cor de partido.
//
// Medir `-text` não é opcional: **escurecer comprime distâncias**. PSB e PSOL
// distam ΔE 10,51 nas bases (#c9a227 × #d6a400) e **2,51** nas tintas
// (#896c00 × #8d6b00) — dois ouros que viram o mesmo marrom no lugar em que a
// confusão é mais cara, que é um número escrito. Gatear só as bases deixaria
// essa colisão viva.
//
// Os **níveis 1..5 não entram, e não é omissão**: eles são alvos absolutos de
// L* / C* iguais para todos os partidos (`RAMP_L` / `RAMP_C`), então o nível 1
// de todo mundo mora no círculo L* 90 / C* 10. Trinta e um pontos distribuídos
// nesse círculo ficam, no melhor caso possível, a 2·10·sen(180°/31) ≈ **2,02**
// de ΔE76 um do outro. Exigir 12 ali é aritmeticamente impossível — e não
// precisa ser exigido: o nível comunica **margem**, não identidade; quem
// responde "qual partido" é a base, o chip e a tinta.

/**
 * Piso de ΔE76 **entre partidos diferentes**, no mesmo papel visual. Ver a
 * tabela de medições e as três razões no comentário acima. Deliberadamente
 * igual a `DELTA_E_FLOOR`: é a mesma pergunta perceptual ("estas duas cores são
 * a mesma?"), feita contra a paleta oficial num caso e contra nós mesmos no
 * outro.
 */
export const PARTY_SEPARATION_FLOOR = 12;

/**
 * Papéis medidos par a par. Os mesmos três tokens que o gate contra os hexes
 * oficiais cobre — e pelo mesmo critério: são as cores que **identificam** um
 * partido, sem rótulo que as desambigue. Níveis ficam de fora por
 * impossibilidade aritmética (ver comentário acima), `-ink` por não ser cor de
 * partido.
 */
const SEPARATED_ROLES = ["base", "chip", "text"] as const;
type SeparatedRole = (typeof SEPARATED_ROLES)[number];

function roleHex(p: GeneratedParty, role: SeparatedRole): string {
  if (role === "base") return p.baseHex;
  if (role === "chip") return p.chip.hex;
  return p.text.hex;
}

function roleToken(slug: string, role: SeparatedRole): string {
  return role === "base" ? `--party-${slug}` : `--party-${slug}-${role}`;
}

interface SeparationPair {
  role: SeparatedRole;
  slugA: string;
  nomeA: string;
  hexA: string;
  slugB: string;
  nomeB: string;
  hexB: string;
  deltaE: number;
}

/**
 * Todos os pares (i < j) × todos os papéis, ordenados por ΔE76 crescente.
 * Ordenação total explícita (ΔE, papel, slugA, slugB) para que a saída de
 * `--report` seja byte-idêntica em qualquer máquina (§ 6).
 */
function separationPairs(parties: readonly GeneratedParty[]): SeparationPair[] {
  const out: SeparationPair[] = [];
  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      const a = parties[i];
      const b = parties[j];
      if (!a || !b) continue;
      for (const role of SEPARATED_ROLES) {
        const hexA = roleHex(a, role);
        const hexB = roleHex(b, role);
        out.push({
          role,
          slugA: a.entry.slug,
          nomeA: a.entry.nome,
          hexA,
          slugB: b.entry.slug,
          nomeB: b.entry.nome,
          hexB,
          deltaE: deltaE76(hexA, hexB),
        });
      }
    }
  }
  out.sort((x, y) => {
    if (x.deltaE !== y.deltaE) return x.deltaE - y.deltaE;
    if (x.role !== y.role) return x.role < y.role ? -1 : 1;
    if (x.slugA !== y.slugA) return x.slugA < y.slugA ? -1 : 1;
    return x.slugA === y.slugA ? (x.slugB < y.slugB ? -1 : 1) : 0;
  });
  return out;
}

function separationViolations(
  parties: readonly GeneratedParty[],
  floor: number = PARTY_SEPARATION_FLOOR,
): SeparationPair[] {
  return separationPairs(parties).filter((p) => p.deltaE < floor);
}

/**
 * As duas linhas que descrevem **uma** colisão: qual par de tokens, com que
 * hexes, a que ΔE76, contra qual piso, e quanto falta.
 *
 * Exportada de propósito — é o contrato que `party-separation.test.ts` trava.
 * Uma mensagem que diga só "a paleta tem colisões" transfere para quem for
 * corrigir todo o trabalho de descobrir onde; num arquivo com 31 partidos e 465
 * pares, isso é a diferença entre um gate útil e um gate que se contorna.
 */
export function separationFailureMessage(
  a: { token: string; hex: string; nome: string },
  b: { token: string; hex: string; nome: string },
  deltaE: number,
  floor: number = PARTY_SEPARATION_FLOOR,
): string {
  return (
    `  ${a.token} ${a.hex} (${a.nome})  ×  ${b.token} ${b.hex} (${b.nome})\n` +
    `    ΔE76 ${deltaE.toFixed(2)} — piso ${floor} (faltam ${(floor - deltaE).toFixed(2)})`
  );
}

function formatSeparationViolations(violations: readonly SeparationPair[]): string {
  const lines = [
    `${violations.length} par(es) de partidos a menos de ΔE76 ${PARTY_SEPARATION_FLOOR} ` +
      "entre si — dois partidos com a mesma cor.",
    "A paleta editorial existe para responder QUAL partido (constituição § 2); duas cores",
    "indistinguíveis não respondem nada.",
    "",
  ];
  for (const v of violations) {
    lines.push(
      separationFailureMessage(
        { token: roleToken(v.slugA, v.role), hex: v.hexA, nome: v.nomeA },
        { token: roleToken(v.slugB, v.role), hex: v.hexB, nome: v.nomeB },
        v.deltaE,
      ),
    );
  }
  lines.push("");
  lines.push(
    "Rode `pnpm gen:party-scale --suggest`: ele calcula o conjunto MÍNIMO de hexes a mudar\n" +
      "em PARTY_BASE (menos hexes primeiro, menor deslocamento total no desempate) e imprime\n" +
      "as linhas prontas. Não relaxe o piso.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Colapso de croma no nível 5
// ---------------------------------------------------------------------------
// O nível 5 é o "decisivo" — a cor mais carregada da escala de margem. O alvo
// do kit recua o croma de propósito (C* 53 sobre C* 66 do nível 4 = 0,80), o
// que mantém o nível 5 reconhecível como **a cor do partido**, só mais densa.
//
// O empurrão de ΔE76 pode destruir isso sem que nada reclame: quando um hex
// oficial escuro fica exatamente no caminho, o solver escapa **reduzindo o
// croma**, que é a saída mais barata no custo `(2·ΔL)² + ΔC²`. Foi o que
// acontecia com `--party-pp`, cujos três oficiais (#133D6D, #54B8EA, #234F74)
// põem dois azuis na ponta escura da coluna: o nível 5 saía com C* 15,0 contra
// C* 43,8 do nível 4 — razão **0,34**, um cinza-ardósia onde deveria estar o
// azul mais forte do PP. Medidos os 31 partidos, todos os outros ficavam entre
// 0,71 e 1,02.
//
// O piso de 0,60 fica no meio do vão vazio entre 0,34 (o defeito) e 0,71 (o
// pior caso legítimo, `--party-pl`, limitado pelo gamut do azul): pega o
// colapso e não encosta em nenhuma rampa que o gamut aperta honestamente.

/** Fração mínima do croma do nível 4 que o nível 5 precisa conservar. */
export const LEVEL5_CHROMA_RATIO_FLOOR = 0.6;

interface ChromaCollapse {
  party: GeneratedParty;
  c4: number;
  c5: number;
  ratio: number;
}

function chromaCollapses(parties: readonly GeneratedParty[]): ChromaCollapse[] {
  const out: ChromaCollapse[] = [];
  for (const p of parties) {
    if (p.entry.neutral) continue; // croma mínimo de fuga (seção 4b), não a rampa de matiz.
    const c4 = p.levels[3]?.measured.C ?? 0;
    const c5 = p.levels[4]?.measured.C ?? 0;
    if (c4 <= 0) continue;
    const ratio = c5 / c4;
    if (ratio < LEVEL5_CHROMA_RATIO_FLOOR) out.push({ party: p, c4, c5, ratio });
  }
  return out;
}

function formatChromaCollapses(collapses: readonly ChromaCollapse[]): string {
  const lines = [
    `${collapses.length} rampa(s) com colapso de croma no nível 5 — o "decisivo" perde a cor`,
    `do partido e lê como cinza. Mínimo: C*₅ ≥ ${LEVEL5_CHROMA_RATIO_FLOOR} × C*₄ ` +
      "(o kit recua 0,80).",
    "",
  ];
  for (const c of collapses) {
    lines.push(
      `  --party-${c.party.entry.slug}-5: ${c.party.levels[4]?.hex} (${c.party.entry.nome})`,
    );
    lines.push(
      `    C* ${c.c5.toFixed(1)} contra C* ${c.c4.toFixed(1)} do nível 4 — razão ` +
        `${c.ratio.toFixed(2)}`,
    );
  }
  lines.push("");
  lines.push(
    "O croma some porque escapar dos hexes oficiais do partido custa menos em C* que em L*\n" +
      "nessa matiz: a coluna está cercada. A saída é **girar a matiz do hex base** em\n" +
      "PARTY_BASE — `pnpm gen:party-scale --suggest` procura a rotação mínima que resolve.",
  );
  return lines.join("\n");
}

// ===========================================================================
// 7c. O SOLVER DE COLISÃO — qual conjunto mínimo de hexes precisa mudar
// ===========================================================================
// **Este bloco não roda na geração.** Ele é o modo `--suggest`, e existe para
// que a resposta à pergunta "de quem é a culpa quando dois partidos colidem?"
// seja **calculada**, não escolhida — a próxima pessoa que mexer em
// `PARTY_BASE` não pode ficar com a impressão de que a cor do partido X mudou
// porque alguém achou o partido Y mais importante. Num produto eleitoral isso
// não é detalhe de engenharia: é a neutralidade política do § 2.
//
// ---------------------------------------------------------------------------
// O critério, em três regras lexicográficas
// ---------------------------------------------------------------------------
//   1. **Menos hexes alterados.** Se um par colide e nenhum dos dois se move, o
//      par continua colidindo — então o conjunto de partidos que mudam precisa
//      tocar todo par em conflito. Isso é, literalmente, uma **cobertura de
//      vértices** do grafo cujas arestas são as colisões. Minimizar o número de
//      hexes alterados = achar a cobertura mínima. Enumerada por força bruta,
//      componente conexa por componente conexa (elas têm 2 a 4 vértices).
//   2. **Menor deslocamento total.** Entre coberturas mínimas empatadas em
//      tamanho, vence a que soma o menor ΔE76 entre hex antigo e novo. É o que
//      decide, por exemplo, qual dos três vermelhos do triângulo PCB/PCO/PSTU
//      fica parado.
//   3. **Ordem alfabética de slug**, se as duas primeiras empatarem. Desempate
//      cego a qualquer atributo do partido — tamanho de bancada, espectro,
//      relevância eleitoral. É o ponto em que a neutralidade fica explícita.
//
// Nenhuma das três olha para quem é o partido. A entrada do solver é a paleta e
// a tabela de hexes oficiais; ele não conhece bancada, ideologia nem histórico.
//
// ---------------------------------------------------------------------------
// Partidos "forçados": quem muda mesmo sem colidir com ninguém
// ---------------------------------------------------------------------------
// Um partido pode precisar de hex novo por um defeito **próprio**, não por
// colisão — hoje o caso é `--party-pp`, cuja matiz está tão cercada pelos
// próprios hexes oficiais que o nível 5 colapsa em cinza. Esses entram no
// conjunto antes da cobertura, e as arestas que eles tocam já saem cobertas de
// graça: o PP muda de qualquer jeito, então o DC (que só colidia com ele) não
// precisa mudar. Regra 1 respeitada sem exceção.
//
// ---------------------------------------------------------------------------
// Como cada cor nova é escolhida
// ---------------------------------------------------------------------------
// Varredura em grade **fixa** de CIE LCh em volta do hex atual (h ±60° em
// passos de 1°, L* ±15 e C* ±20 em passos de 1), candidatos ordenados por ΔE76
// crescente do hex antigo, e **o primeiro que passa em TODAS as regras vence**:
//
//   - ΔE76 ≥ `DELTA_E_FLOOR` de todo hex oficial daquele partido, medido na
//     base, no chip, na tinta e nos 5 níveis (o gate do § 2 já existente);
//   - rampa construível, L* estritamente decrescente, sem colapso de croma;
//   - chip/tinta ≥ 4,5:1 e `-text` ≥ 4,5:1 nas duas superfícies (§ 4);
//   - ΔE76 ≥ `PARTY_SEPARATION_FLOOR` de todo outro partido, nos três papéis.
//
// "O primeiro que passa, na ordem de ΔE76" é exatamente a regra 2 aplicada a um
// partido só. Quando há mais de um partido a mover na mesma componente, eles
// são colocados **em ordem alfabética**, cada um enxergando os já colocados —
// regra 3 outra vez, no único ponto em que a ordem poderia importar.

/** Amplitude e passo da grade de candidatos, em CIE LCh. Fixos (§ 6). */
const SUGGEST_H_SPAN = 60;
const SUGGEST_H_STEP = 1;
const SUGGEST_L_SPAN = 15;
const SUGGEST_L_STEP = 1;
const SUGGEST_C_SPAN = 20;
const SUGGEST_C_STEP = 1;

/** Teto de avaliações completas por partido. Rede de segurança, nunca atingido. */
const SUGGEST_MAX_EVALS = 4000;

/**
 * Folga usada **na busca**, não na verificação — o mesmo papel (e o mesmo
 * espírito) do `SEARCH_MARGIN` do solver de ΔE76 contra os oficiais.
 *
 * Sem ela o solver faz o mínimo literal: em 2026-09-08 ele resolvia
 * Avante × PRD movendo o Avante de #7a4fb3 para #7a4fb2 — **um bit** no canal
 * azul, deslocamento ΔE76 0,56, e o par pousava em 12,00. Passa no gate e não
 * resolve nada: o piso existe para que ninguém confunda os dois, e um par
 * encostado nele volta a violar com qualquer arredondamento, qualquer correção
 * de hex oficial, qualquer ajuste de superfície de papel.
 *
 * Buscando com 13 e conferindo com 12, o gate continua sendo exatamente o
 * número documentado — nenhuma tolerância escondida na verificação — e a
 * paleta emitida nasce com uma unidade de folga.
 */
const SEPARATION_SEARCH_MARGIN = 1;

/** A grade só depende do hex de origem — 6 bases, não 144 chamadas. */
const candidateCache = new Map<string, Array<{ hex: string; deltaE: number }>>();

/** Cache de `maxChroma` da varredura — a grade repete milhares de (L, h). */
const chromaCache = new Map<string, number>();
function maxChromaCached(L: number, h: number): number {
  const key = `${L.toFixed(4)}|${h.toFixed(4)}`;
  const hit = chromaCache.get(key);
  if (hit !== undefined) return hit;
  const v = maxChroma(L, h);
  chromaCache.set(key, v);
  return v;
}

/** Candidatos em gamut, sem repetição de hex, ordenados por ΔE76 do hex atual. */
function candidateHexes(base: string): Array<{ hex: string; deltaE: number }> {
  const cached = candidateCache.get(base);
  if (cached !== undefined) return cached;
  const { L: L0, C: C0, h: h0 } = hexToLch(base);
  const seen = new Set<string>();
  const out: Array<{ hex: string; deltaE: number }> = [];
  for (let dh = -SUGGEST_H_SPAN; dh <= SUGGEST_H_SPAN; dh += SUGGEST_H_STEP) {
    const h = (((h0 + dh) % 360) + 360) % 360;
    for (let dL = -SUGGEST_L_SPAN; dL <= SUGGEST_L_SPAN; dL += SUGGEST_L_STEP) {
      const L = L0 + dL;
      if (L <= 1 || L >= 99) continue;
      const cMax = maxChromaCached(L, h);
      for (let dC = -SUGGEST_C_SPAN; dC <= SUGGEST_C_SPAN; dC += SUGGEST_C_STEP) {
        const C = C0 + dC;
        if (C < 0 || C > cMax) continue;
        const hex = lchToHex(L, C, h);
        if (seen.has(hex)) continue;
        seen.add(hex);
        out.push({ hex, deltaE: deltaE76(base, hex) });
      }
    }
  }
  // Ordenação total (ΔE, hex) — determinismo bit a bit da sugestão.
  out.sort((a, b) => (a.deltaE !== b.deltaE ? a.deltaE - b.deltaE : a.hex < b.hex ? -1 : 1));
  candidateCache.set(base, out);
  return out;
}

/** Todo gate que depende de **um** partido só. `null` = passa. */
function selfViolation(p: GeneratedParty): string | null {
  const [v] = deltaEViolations([p]);
  if (v) return `${v.token} a ΔE76 ${v.deltaE.toFixed(2)} de ${v.official.hex}`;
  if (p.chip.contrast < CHIP_CONTRAST_FLOOR) {
    return `chip a ${p.chip.contrast.toFixed(2)}:1 (mínimo ${CHIP_CONTRAST_FLOOR})`;
  }
  if (p.text.worstContrast < TEXT_CONTRAST_FLOOR) {
    return `text a ${p.text.worstContrast.toFixed(2)}:1 (mínimo ${TEXT_CONTRAST_FLOOR})`;
  }
  const [m] = monotonicityViolations([p]);
  if (m) return m;
  const [c] = chromaCollapses([p]);
  if (c) return `croma do nível 5 a ${c.ratio.toFixed(2)} do nível 4`;
  return null;
}

/** `true` se `p` fica a ≥ `floor` de todos os `others` nos três papéis. */
function separatedFrom(
  p: GeneratedParty,
  others: readonly GeneratedParty[],
  floor: number,
): boolean {
  for (const o of others) {
    for (const role of SEPARATED_ROLES) {
      if (deltaE76(roleHex(p, role), roleHex(o, role)) < floor) return false;
    }
  }
  return true;
}

interface Placement {
  hex: string;
  party: GeneratedParty;
  deltaE: number;
}

/**
 * A cor nova de um partido: o candidato de menor ΔE76 do hex atual que passa em
 * todas as regras (ver o comentário do bloco). `null` = a grade não tem saída.
 */
function placeParty(
  entry: PartyEntry,
  officials: readonly OfficialHex[],
  others: readonly GeneratedParty[],
  floor: number,
): Placement | null {
  let evals = 0;
  for (const cand of candidateHexes(entry.base)) {
    // Rejeição barata primeiro: base contra oficiais e contra as bases alheias.
    if (worstAgainstOfficials(cand.hex, officials).delta < DELTA_E_FLOOR) continue;
    let clashes = false;
    for (const o of others) {
      if (deltaE76(cand.hex, roleHex(o, "base")) < floor) {
        clashes = true;
        break;
      }
    }
    if (clashes) continue;
    if (++evals > SUGGEST_MAX_EVALS) return null;

    let built: GeneratedParty;
    try {
      built = buildRamp({ ...entry, base: cand.hex }, officials);
    } catch {
      continue; // rampa insolúvel nessa matiz — candidato descartado.
    }
    if (selfViolation(built) !== null) continue;
    if (!separatedFrom(built, others, floor)) continue;
    return { hex: cand.hex, party: built, deltaE: cand.deltaE };
  }
  return null;
}

/** Componentes conexas do grafo de conflito, cada uma com slugs ordenados. */
function conflictComponents(
  slugs: readonly string[],
  edges: ReadonlyArray<[string, string]>,
): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const s of slugs) adj.set(s, new Set());
  for (const [a, b] of edges) {
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const s of [...slugs].sort()) {
    if (seen.has(s) || (adj.get(s)?.size ?? 0) === 0) continue;
    const stack = [s];
    const comp: string[] = [];
    seen.add(s);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    out.push(comp.sort());
  }
  return out;
}

/** Todas as coberturas de vértices de tamanho mínimo. Força bruta (n ≤ ~12). */
function minimumVertexCovers(
  vertices: readonly string[],
  edges: ReadonlyArray<[string, string]>,
): string[][] {
  const n = vertices.length;
  for (let k = 0; k <= n; k++) {
    const found: string[][] = [];
    const combine = (start: number, acc: string[]) => {
      if (acc.length === k) {
        const set = new Set(acc);
        if (edges.every(([a, b]) => set.has(a) || set.has(b))) found.push([...acc]);
        return;
      }
      for (let i = start; i < n; i++) combine(i + 1, [...acc, vertices[i] as string]);
    };
    combine(0, []);
    if (found.length > 0) return found;
  }
  return [];
}

interface Fix {
  slug: string;
  nome: string;
  from: string;
  to: string;
  deltaE: number;
}

/**
 * O conjunto mínimo de hexes a mudar em `PARTY_BASE`, pelas três regras
 * lexicográficas do comentário do bloco. `null` = nenhuma combinação resolve
 * dentro da grade de busca.
 */
function suggestFixes(
  entries: readonly PartyEntry[],
  official: Record<string, OfficialEntry>,
  floor: number,
): Fix[] | null {
  const officialsOf = (slug: string) => official[`--party-${slug}`]?.official ?? [];
  const built = new Map<string, GeneratedParty>();
  for (const e of entries) built.set(e.slug, buildRamp(e, officialsOf(e.slug)));
  const all = [...built.values()];

  // (a) forçados — defeito próprio, mudam independente de colisão.
  const forced = entries
    .filter((e) => selfViolation(built.get(e.slug) as GeneratedParty) !== null)
    .map((e) => e.slug)
    .sort();
  const forcedSet = new Set(forced);

  // (b) arestas de colisão que sobram depois dos forçados.
  const edges: Array<[string, string]> = [];
  const pairSeen = new Set<string>();
  for (const v of separationViolations(all, floor)) {
    if (forcedSet.has(v.slugA) || forcedSet.has(v.slugB)) continue;
    const key = `${v.slugA}|${v.slugB}`;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    edges.push([v.slugA, v.slugB]);
  }

  // (c) cobertura mínima, componente a componente; combinações = produto.
  const slugs = entries.map((e) => e.slug);
  const components = conflictComponents(slugs, edges);
  const perComponent = components.map((comp) => {
    const inner = edges.filter(([a, b]) => comp.includes(a) && comp.includes(b));
    return minimumVertexCovers(comp, inner);
  });

  let combos: string[][] = [[]];
  for (const options of perComponent) {
    const next: string[][] = [];
    for (const acc of combos) for (const opt of options) next.push([...acc, ...opt]);
    combos = next;
  }

  // (d) avalia cada combinação; guarda a de menor deslocamento total.
  let best: { fixes: Fix[]; total: number } | null = null;
  for (const combo of combos) {
    const movers = [...new Set([...forced, ...combo])].sort();
    const placed = new Map(built);
    const fixes: Fix[] = [];
    let ok = true;
    for (const slug of movers) {
      const entry = entries.find((e) => e.slug === slug);
      if (!entry) continue;
      placed.delete(slug);
      const r = placeParty(
        entry,
        officialsOf(slug),
        [...placed.values()],
        floor + SEPARATION_SEARCH_MARGIN,
      );
      if (r === null) {
        ok = false;
        break;
      }
      placed.set(slug, r.party);
      fixes.push({
        slug,
        nome: entry.nome,
        from: entry.base.toLowerCase(),
        to: r.hex,
        deltaE: r.deltaE,
      });
    }
    if (!ok) continue;
    const total = fixes.reduce((s, f) => s + f.deltaE, 0);
    const key = fixes.map((f) => f.slug).join(",");
    if (
      best === null ||
      total < best.total - 1e-9 ||
      (Math.abs(total - best.total) <= 1e-9 && key < best.fixes.map((f) => f.slug).join(","))
    ) {
      best = { fixes, total };
    }
  }
  return best?.fixes ?? null;
}

function formatFixes(fixes: readonly Fix[]): string {
  const lines = [
    "",
    `Conjunto mínimo: ${fixes.length} hex(es) a mudar em PARTY_BASE ` +
      `(deslocamento total ΔE76 ${fixes.reduce((s, f) => s + f.deltaE, 0).toFixed(2)}).`,
    "Critério: menos hexes primeiro; empatou, menor deslocamento total; empatou, ordem",
    "alfabética de slug. Nenhuma das três regras olha para quem é o partido.",
    "",
  ];
  for (const f of fixes) {
    lines.push(
      `  ${f.slug.padEnd(15)} ${f.from} → ${f.to}   (ΔE76 ${f.deltaE.toFixed(2)} · ${f.nome})`,
    );
  }
  return lines.join("\n");
}

// ===========================================================================
// 8. EMISSÃO DO CSS
// ===========================================================================

const HEADER = `/* =============================================================================
 * app/tokens-party.css — ARQUIVO GERADO. NÃO EDITE À MÃO.
 *
 *   Gerador : scripts/gen-party-scale.ts
 *   Comando : pnpm gen:party-scale
 *   Fonte   : a tabela \`PARTY_BASE\` (sigla → hex base) dentro do gerador,
 *             cujos hexes vêm do kit Atlas Menna
 *             (docs/design-system/atlas-menna/tokens/colors.css:37-76), e a
 *             tabela de hexes oficiais em scripts/data/party-official-hexes.json.
 *
 * Qualquer edição manual aqui é perdida na próxima geração. Para mudar uma
 * cor, mude \`PARTY_BASE\` no gerador e rode o comando acima.
 *
 * -----------------------------------------------------------------------------
 * O que estes tokens são
 * -----------------------------------------------------------------------------
 * A paleta editorial por partido/federação da constituição § 2 (v1.3), fixada
 * pelo ADR-0024. Uma cor por partido, **estável a noite inteira**: a matiz (h
 * em CIE LCh) é idêntica nos 5 níveis; só L* e C* mudam. O nível é função da
 * margem projetada — 1 = disputa apertada, 5 = decisivo — resolvido por
 * \`lib/utils/party-color.ts\`.
 *
 * \`--party-<sigla>\` é a cor de **identidade** (contorno, ponto, legenda);
 * \`--party-<sigla>-1..5\` é a **escala de margem**. Desde 2026-09-07 o nível 4
 * não é mais o hex base literal: os cinco níveis têm alvos de L* / C* iguais para
 * todos os partidos, o que é o que garante L* estritamente decrescente do 1 ao
 * 5 em toda matiz (antes, quem tinha base clara saía com o "decisivo" mais
 * claro que o "provável").
 *
 * Nunca são as cores oficiais dos partidos: § 2 v1.3 exige ΔE76 ≥ 10 contra o
 * hex oficial documentado, e este gerador aplica um piso de 12 — verificado
 * sobre a base e os 5 níveis de cada partido, contra **todos** os hexes
 * oficiais dele, e refeito sobre este arquivo por
 * \`tests/unit/design-system/party-delta-e.test.ts\`.
 *
 * -----------------------------------------------------------------------------
 * O par \`-chip\` / \`-ink\` — superfície sólida com rótulo legível
 * -----------------------------------------------------------------------------
 * \`--party-<sigla>-chip\` é o **fundo** de um chip sólido (\`<PartyTag filled>\`) e
 * \`--party-<sigla>-ink\` é a **tinta** a usar em cima dele. Os dois se usam
 * **sempre juntos**: o par é medido aqui em ≥ 4,5:1 (constituição § 4, WCAG 2.1
 * AA), e trocar um sem o outro desfaz a garantia.
 *
 * Não existe tinta única que sirva: das 31 bases, 19 pedem a tinta clara
 * (#fbfbfc) e 12 pedem a escura (#14171b). E duas — MDB (#2e8b57) e Rede
 * (#3d8f3d), verdes de meio-tom — reprovam com **as duas**, então o chip delas é
 * a base escurecida (mesma matiz, só L* e C* mudam, como manda o § 2 v1.3). Onde o
 * chip diverge da base, o comentário na linha diz de quanto e por quê.
 *
 * Em React, o par vem pronto de \`partyChipInk(sigla)\` em \`lib/utils/party-color.ts\`.
 *
 * -----------------------------------------------------------------------------
 * \`-text\` — a cor do partido ESCREVENDO sobre o papel
 * -----------------------------------------------------------------------------
 * O caso simétrico do chip. \`--party-<sigla>\` é área de cor (contorno, ponto,
 * preenchimento de barra); quando a mesma identidade precisa virar **texto** —
 * o número grande de um termômetro, o nome do líder numa lista — o token é
 * \`--party-<sigla>-text\`, medido aqui em ≥ 4,5:1 contra as duas superfícies de
 * papel do kit (\`--surface-page\` #f3f4f6 e \`--surface-card\` #fbfbfc).
 *
 * Não dá para reusar a base: medido contra #f3f4f6, PSOL dá 2,08:1, PSB 2,20:1,
 * o fallback cinza 2,39:1 e NOVO 2,72:1 — texto ilegível pelo § 4. Nem dá para
 * reusar o \`-chip\`, que em 19 dos 31 partidos é uma cor **clara** (ele foi
 * escolhido para contrastar com uma tinta, não com o papel). Onde a base já
 * passa, \`-text\` **é** a base; onde não passa, é a base escurecida na mesma
 * matiz (§ 2 v1.3 permite variar intensidade, nunca matiz), e o comentário na
 * linha diz de quanto e por quê.
 *
 * Em React: \`textForParty(sigla)\` em \`lib/utils/party-color.ts\`.
 *
 * -----------------------------------------------------------------------------
 * Duas regras que este arquivo não pode quebrar
 * -----------------------------------------------------------------------------
 * 1. \`@theme static\` — sem \`static\`, o Tailwind v4 descarta variáveis que não
 *    aparecem em nenhuma classe utilitária, e \`resolvePartyHex()\` receberia
 *    string vazia do \`getComputedStyle\`: o mapa ficaria cinza em silêncio.
 * 2. **Hex literal**, nunca \`color-mix()\` nem \`oklch()\` — o MapLibre lê estes
 *    tokens por \`getComputedStyle\` e passa a string direto para
 *    \`setPaintProperty\`, que não resolve nenhum dos dois.
 *
 * -----------------------------------------------------------------------------
 * O bloco \`[data-theme="dark"]\` no fim do arquivo
 * -----------------------------------------------------------------------------
 * Mesmo gerador, mesmos gates, outro tema (ADR-0025 § 5). Três diferenças, e
 * só três:
 *
 *   1. **A escala inverte.** Os alvos de L* sobem do nível 1 ao 5 — no papel
 *      escuro é a distância ao fundo que comunica intensidade, então o
 *      "decisivo" é o mais CLARO.
 *   2. **A cor de identidade é derivada, não literal.** \`--party-<sigla>\` no
 *      escuro é a base clara com L* remapeado por um mapa afim (matiz
 *      intocada) — sem isso, 13 das 31 bases ficariam abaixo de 3:1 sobre
 *      \`--paper-0\` #1c1f24 e sumiriam do mapa.
 *   3. **\`-chip\` e \`-text\` ganham contraste CLAREANDO**, não escurecendo, e a
 *      busca também exige separação de ΔE76 12 dos partidos já posicionados
 *      (ADR-0031) — no escuro esse é o único grau de liberdade disponível,
 *      porque mover \`PARTY_BASE\` degradaria o tema claro.
 *
 * Tudo o mais é idêntico: matiz estável por partido nos dois temas, ΔE76 ≥ 12
 * de todo hex oficial, 4,5:1 nos pares chip/tinta e nas tintas de texto, L*
 * monotônico, croma do nível 5 ≥ 0,60 do nível 4.
 * ========================================================================== */

@theme static {`;

/**
 * Abertura do bloco escuro. `:root[data-theme="dark"]` e não `@theme`:
 * `@theme` é diretiva de build do Tailwind v4 e não pode ser aninhada num
 * seletor. Como o `@theme static` acima emite tudo em `:root`, este bloco vence
 * por especificidade e por ordem, e as utilitárias geradas continuam apontando
 * para as mesmas variáveis — nenhuma classe nova, nenhum token duplicado.
 */
const DARK_BLOCK_HEADER = `/* =============================================================================
 * TEMA ESCURO (ADR-0025 § 5) — mesmos nomes, outra intensidade.
 *
 * A matiz de cada partido é **a mesma nos dois temas** (constituição § 2 v1.3:
 * só a intensidade pode variar). O que muda: a escala de margem sobe em vez de
 * descer, a cor de identidade é o mapa afim de L* documentado no gerador, e
 * chip/tinta clareiam em vez de escurecer.
 *
 * Os hexes escuros literais do kit (PT e PL, tokens/colors.css:104-113) são a
 * **referência de calibração**, não a saída: medidos, derivam 16,7° e 8,5° de
 * matiz do nível 1 ao 5, o que o § 2 v1.3 proíbe. \`--report\` imprime o ΔE76
 * entre cada nível gerado e o hex do kit, para que o desvio em relação ao
 * desenho original seja um número e não uma impressão.
 * ========================================================================== */

:root[data-theme="dark"] {`;

/**
 * As linhas de token de UM tema. O bloco claro sai dentro de `@theme static`
 * (é ele que gera as utilitárias do Tailwind); o escuro sai dentro de
 * `:root[data-theme="dark"]`, sobrescrevendo por especificidade os MESMOS
 * nomes — nenhuma utilitária nova é gerada, e `getComputedStyle` (MapLibre)
 * devolve o hex do tema ativo.
 */
function emitTokens(parties: readonly GeneratedParty[], spec: ThemeSpec): string[] {
  const out: string[] = [];
  for (const [i, party] of parties.entries()) {
    const { entry, baseLch } = party;
    const lch = `L* ${baseLch.L.toFixed(1)} · C* ${baseLch.C.toFixed(1)} · h ${baseLch.h.toFixed(1)}°`;
    const de = Number.isFinite(party.baseDeltaE)
      ? `ΔE76 ${party.baseDeltaE.toFixed(1)} de ${party.baseAgainst?.hex}`
      : "sem hex oficial conhecido";
    const origem = entry.neutral ? "rampa acromática (C* = 0) — cinza institucional" : de;
    // Sem linha em branco logo após a abertura do bloco — o formatter do Biome
    // a remove, e o arquivo gerado precisa já sair formatado (senão
    // `pnpm lint` e `pnpm gen:party-scale --check` brigam entre si).
    if (i > 0) out.push("");
    out.push(`  /* ${entry.nome} — base ${lch} · ${origem} */`);
    if (spec.id === "dark") {
      const claro = entry.base.toLowerCase();
      out.push(
        `  --party-${entry.slug}: ${party.baseHex}; ` +
          `/* mapa afim de L* a partir de ${claro} (matiz intacta) · ` +
          `${surfaceContrasts(party.baseHex, spec.textSurfaces).worst.toFixed(2)}:1 sobre o papel escuro */`,
      );
    } else {
      out.push(`  --party-${entry.slug}: ${party.baseHex};`);
    }

    // Par chip/tinta — sempre os dois juntos, nesta ordem, logo abaixo da base:
    // quem lê o arquivo precisa ver que são um par, não dois tokens soltos.
    const c = party.chip;
    const [inkDark] = spec.chipInks;
    const tinta = c.ink === inkDark ? "tinta escura" : "tinta clara";
    const verbo = spec.contrastStep < 0 ? "escurecida" : "clareada";
    if (c.moved) {
      out.push(
        `  --party-${entry.slug}-chip: ${c.hex}; ` +
          `/* base ${verbo} L* ${c.baseL.toFixed(1)} → ${c.chipL.toFixed(1)} (matiz intacta): ` +
          `a base parava em ${c.baseBestContrast.toFixed(2)}:1 com as duas tintas · ` +
          `agora ${c.contrast.toFixed(2)}:1 · ΔE76 ${c.deltaEFromBase.toFixed(1)} da base, ` +
          `${c.worstDeltaE.toFixed(1)} de ${c.worstAgainst?.hex} */`,
      );
    } else {
      out.push(
        `  --party-${entry.slug}-chip: ${c.hex}; ` +
          `/* = base · ${c.contrast.toFixed(2)}:1 com a tinta abaixo */`,
      );
    }
    out.push(
      `  --party-${entry.slug}-ink: ${c.ink}; ` +
        `/* ${tinta} sobre o chip — ${c.contrast.toFixed(2)}:1 (§ 4 exige 4.5:1) */`,
    );

    // Tinta de texto — o caso simétrico do chip: a cor do partido ESCREVENDO
    // sobre o papel, em vez de servindo de fundo para uma tinta.
    const t = party.text;
    const medidos = spec.textSurfaces
      .map((s, i) => `${(t.contrasts[i] ?? 0).toFixed(2)}:1 em ${s.hex}`)
      .join(" · ");
    if (t.moved) {
      // Sem hex oficial localizado (DEMOCRATA, MOBILIZA) não há distância a
      // declarar — dizer isso é mais honesto que imprimir "Infinity".
      const deTexto = Number.isFinite(t.worstDeltaE)
        ? `${t.worstDeltaE.toFixed(1)} de ${t.worstAgainst?.hex}`
        : "sem hex oficial conhecido";
      out.push(
        `  --party-${entry.slug}-text: ${t.hex}; ` +
          `/* base ${verbo} L* ${t.baseL.toFixed(1)} → ${t.textL.toFixed(1)} (matiz intacta): ` +
          `a base parava em ${t.baseWorstContrast.toFixed(2)}:1 sobre o papel · ` +
          `agora ${medidos} · ΔE76 ${t.deltaEFromBase.toFixed(1)} da base, ${deTexto} */`,
      );
    } else {
      out.push(`  --party-${entry.slug}-text: ${t.hex}; /* = base · ${medidos} */`);
    }

    for (const lv of party.levels) {
      const notes: string[] = [];
      if (lv.clamped) {
        notes.push(
          `C* ${lv.requestedChroma.toFixed(1)} → ${lv.gamutChroma.toFixed(1)} (gamut sRGB)`,
        );
      } else if (lv.ordered) {
        notes.push(`C* alinhado ao nível seguinte (${lv.gamutChroma.toFixed(1)})`);
      }
      if (lv.pushed) {
        const moves: string[] = [];
        const targetL = spec.ramp.L[lv.level - 1] ?? 0;
        if (Math.abs(lv.effectiveL - targetL) > 1e-9) {
          moves.push(`L* ${targetL.toFixed(1)} → ${lv.effectiveL.toFixed(1)}`);
        }
        if (Math.abs(lv.effectiveChroma - lv.gamutChroma) > 1e-9) {
          moves.push(`C* ${lv.gamutChroma.toFixed(1)} → ${lv.effectiveChroma.toFixed(1)}`);
        }
        notes.push(
          `${moves.join(", ")} p/ ΔE76 ${lv.worstDeltaE.toFixed(1)} de ${lv.worstAgainst?.hex}`,
        );
      }
      const flag = notes.length > 0 ? ` /* ${notes.join(" · ")} */` : "";
      out.push(`  --party-${entry.slug}-${lv.level}: ${lv.hex};${flag}`);
    }
  }

  out.push("");
  out.push("  /* Estados de corrida — sem partido, logo sem rampa por margem. */");
  for (const st of spec.states) {
    out.push(`  --party-${st.name}: ${st.hex.toLowerCase()}; /* ${st.nota} */`);
  }
  return out;
}

function emitCss(light: readonly GeneratedParty[], dark: readonly GeneratedParty[]): string {
  const out: string[] = [HEADER];
  out.push(...emitTokens(light, LIGHT_THEME));
  out.push("}");
  out.push("");
  out.push(DARK_BLOCK_HEADER);
  out.push(...emitTokens(dark, DARK_THEME));
  out.push("}");
  out.push("");
  return out.join("\n");
}

// ===========================================================================
// 9. CLI
// ===========================================================================

function report(parties: readonly GeneratedParty[], spec: ThemeSpec): string {
  const rows: string[] = [];
  rows.push("");
  rows.push(
    `Auditoria — tema ${spec.id}. L*, C*, h e ΔE76 medidos no hex final ` +
      "(pós-arredondamento 8-bit).",
  );
  rows.push(
    `A matiz (h) precisa ser constante e L* estritamente ${spec.ramp.ascending ? "crescente" : "decrescente"} dentro de cada partido.`,
  );
  rows.push("");
  for (const p of parties) {
    const baseDe = Number.isFinite(p.baseDeltaE)
      ? `ΔE ${p.baseDeltaE.toFixed(2)} (${p.baseAgainst?.hex})`
      : "sem oficial";
    const origem = spec.id === "dark" ? ` (de ${p.entry.base.toLowerCase()})` : "";
    rows.push(
      `${p.entry.nome} (--party-${p.entry.slug}) — base ${p.baseHex}${origem} · ${baseDe} · ` +
        `${surfaceContrasts(p.baseHex, spec.textSurfaces).worst.toFixed(2)}:1 sobre o papel`,
    );
    const c = p.chip;
    rows.push(
      `  chip   ${c.hex} + ink ${c.ink} → ${c.contrast.toFixed(2)}:1` +
        (c.moved
          ? `  (base dava ${c.baseBestContrast.toFixed(2)}:1 · deslocada ΔE76 ` +
            `${c.deltaEFromBase.toFixed(1)} · ΔE76 ${c.worstDeltaE.toFixed(2)} do oficial)`
          : "  (= base)"),
    );
    const t = p.text;
    rows.push(
      `  text   ${t.hex} → ${spec.textSurfaces.map((s, i) => `${(t.contrasts[i] ?? 0).toFixed(2)}:1 (${s.hex})`).join("  ")}` +
        (t.moved
          ? `  (base dava ${t.baseWorstContrast.toFixed(2)}:1 · deslocada ΔE76 ` +
            `${t.deltaEFromBase.toFixed(1)} · ΔE76 ${t.worstDeltaE.toFixed(2)} do oficial)`
          : "  (= base)"),
    );
    rows.push("  nível  hex        L*      C*      h       ΔE76   contra    nota");
    for (const lv of p.levels) {
      const notes = [
        lv.clamped ? "gamut" : "",
        lv.ordered ? "ordem" : "",
        lv.pushed ? "ΔE-push" : "",
      ]
        .filter(Boolean)
        .join("+");
      const de = Number.isFinite(lv.worstDeltaE) ? lv.worstDeltaE.toFixed(2) : "—";
      rows.push(
        `  ${String(lv.level).padEnd(6)} ${lv.hex}    ` +
          `${lv.measured.L.toFixed(1).padStart(5)}  ` +
          `${lv.measured.C.toFixed(1).padStart(5)}  ` +
          `${lv.measured.h.toFixed(1).padStart(6)}  ` +
          `${de.padStart(6)}   ${(lv.worstAgainst?.hex ?? "—").padEnd(9)} ${notes}`,
      );
    }
    const kit = (spec.id === "dark" ? KIT_DARK_RAMPS : KIT_RAMPS)[p.entry.slug];
    if (kit) {
      const diffs = p.levels.map(
        (lv, i) => `${lv.level}: ${deltaE76(lv.hex, kit[i] ?? lv.hex).toFixed(1)}`,
      );
      rows.push(`  desvio ΔE76 da rampa literal do kit → ${diffs.join("  ")}`);
    }
    rows.push("");
  }

  // Separação entre partidos — o gate da seção 7b, com número. É esta tabela
  // que a documentação (`docs/design-system/tokens.md`) cita: os pares que
  // sobraram apertados precisam estar escritos em algum lugar, com o valor, ou
  // a próxima revisão da paleta reintroduz a colisão sem perceber.
  const pairs = separationPairs(parties);
  rows.push(
    `Separação entre partidos (tema ${spec.id}) — ${pairs.length} comparações ` +
      `(${SEPARATED_ROLES.length} papéis × ${(parties.length * (parties.length - 1)) / 2} pares). ` +
      `Piso ${PARTY_SEPARATION_FLOOR}.`,
  );
  rows.push("Os 10 pares mais próximos:");
  rows.push("  ΔE76   papel   token A                     token B");
  for (const p of pairs.slice(0, 10)) {
    rows.push(
      `  ${p.deltaE.toFixed(2).padStart(5)}  ${p.role.padEnd(6)}  ` +
        `${`${roleToken(p.slugA, p.role)} ${p.hexA}`.padEnd(27)} ` +
        `${roleToken(p.slugB, p.role)} ${p.hexB}`,
    );
  }
  rows.push("");
  rows.push(
    "Contraste da base contra o papel do tema (WCAG 1.4.11, objeto gráfico; piso " +
      `${spec.baseContrastFloor > 0 ? `${spec.baseContrastFloor}:1` : "não aplicado neste tema"}):`,
  );
  const baseContrasts = parties
    .map((p) => ({
      slug: p.entry.slug,
      c: surfaceContrasts(p.baseHex, spec.textSurfaces).worst,
    }))
    .sort((a, b) => (a.c !== b.c ? a.c - b.c : a.slug < b.slug ? -1 : 1));
  for (const b of baseContrasts.slice(0, 5)) {
    rows.push(`  ${b.c.toFixed(2)}  --party-${b.slug}`);
  }
  rows.push(
    `  … maior: ${(baseContrasts.at(-1)?.c ?? 0).toFixed(2)} --party-${baseContrasts.at(-1)?.slug}`,
  );
  rows.push("");
  rows.push(
    "Razão C*₅ / C*₄ por partido (piso " +
      `${LEVEL5_CHROMA_RATIO_FLOOR}; o alvo do kit recua 0,80):`,
  );
  const ratios = parties
    .filter((p) => !p.entry.neutral)
    .map((p) => ({
      slug: p.entry.slug,
      ratio: (p.levels[4]?.measured.C ?? 0) / (p.levels[3]?.measured.C ?? 1),
    }))
    .sort((a, b) => (a.ratio !== b.ratio ? a.ratio - b.ratio : a.slug < b.slug ? -1 : 1));
  for (const r of ratios.slice(0, 5)) {
    rows.push(`  ${r.ratio.toFixed(2)}  --party-${r.slug}`);
  }
  rows.push(`  … maior: ${(ratios.at(-1)?.ratio ?? 0).toFixed(2)} --party-${ratios.at(-1)?.slug}`);
  rows.push("");
  return rows.join("\n");
}

/**
 * Toda a bateria de gates de UM tema. Devolve a mensagem de erro do primeiro
 * que reprovar, ou `null` quando passa. Nada é escrito em disco se algum tema
 * reprovar — os dois blocos moram no mesmo arquivo, e meio arquivo válido é
 * pior que nenhum.
 */
function runGates(parties: readonly GeneratedParty[], spec: ThemeSpec): string | null {
  const violations = deltaEViolations(parties);
  if (violations.length > 0) return formatViolations(violations);

  const lowContrast = contrastViolations(parties);
  if (lowContrast.length > 0) return formatContrastViolations(lowContrast);

  const lowTextContrast = textContrastViolations(parties);
  if (lowTextContrast.length > 0) return formatTextContrastViolations(lowTextContrast);

  if (spec.baseContrastFloor > 0) {
    const fracas = parties
      .map((p) => ({ p, c: surfaceContrasts(p.baseHex, spec.textSurfaces).worst }))
      .filter((x) => x.c < spec.baseContrastFloor);
    if (fracas.length > 0) {
      const lines = [
        `${fracas.length} cor(es) de identidade abaixo de ${spec.baseContrastFloor}:1 contra o ` +
          `papel do tema ${spec.id} — o contorno, o ponto e a barra do partido sumiriam.`,
        "Isso viola a WCAG 2.1 SC 1.4.11 (objeto gráfico) cobrada pela constituição § 4.",
        "",
      ];
      for (const f of fracas) {
        lines.push(`  --party-${f.p.entry.slug}: ${f.p.baseHex} — ${f.c.toFixed(2)}:1`);
      }
      lines.push("");
      lines.push(
        "No tema escuro a base é derivada por mapa afim de L*: ajuste DARK_BASE_L_LO /\n" +
          "DARK_BASE_L_HI / DARK_BASE_CHROMA_GAIN. Não relaxe o piso.",
      );
      return lines.join("\n");
    }
  }

  const monotonic = monotonicityViolations(parties);
  if (monotonic.length > 0) {
    return (
      `${monotonic.length} rampa(s) fora de ordem em L* (tema ${spec.id}) — a escala de margem\n` +
      "ficaria fora de ordem (o nível mais 'decisivo' não seria o mais destacado):\n" +
      monotonic.map((m) => `  ${m}`).join("\n")
    );
  }

  const collapses = chromaCollapses(parties);
  if (collapses.length > 0) return formatChromaCollapses(collapses);

  const tooClose = separationViolations(parties);
  if (tooClose.length > 0) return formatSeparationViolations(tooClose);

  return null;
}

/** Resumo de console de um tema, depois que todos os gates passaram. */
function summarize(parties: readonly GeneratedParty[], spec: ThemeSpec): void {
  const inkLight = parties.filter((p) => p.chip.ink === spec.chipInks[1]).length;
  const worstChip = parties.reduce((a, b) => (a.chip.contrast <= b.chip.contrast ? a : b));
  const worstText = parties.reduce((a, b) =>
    a.text.worstContrast <= b.text.worstContrast ? a : b,
  );
  const worstBase = parties.reduce((a, b) =>
    surfaceContrasts(a.baseHex, spec.textSurfaces).worst <=
    surfaceContrasts(b.baseHex, spec.textSurfaces).worst
      ? a
      : b,
  );
  const closest = separationPairs(parties)[0];
  const worstRatio = parties
    .filter((p) => !p.entry.neutral)
    .reduce((a, b) => {
      const ra = (a.levels[4]?.measured.C ?? 0) / (a.levels[3]?.measured.C ?? 1);
      const rb = (b.levels[4]?.measured.C ?? 0) / (b.levels[3]?.measured.C ?? 1);
      return ra <= rb ? a : b;
    });

  console.log(`\n— tema ${spec.id} —`);
  console.log(
    `ΔE76 ≥ ${DELTA_E_FLOOR} contra todo hex oficial: OK em ${parties.length * 8} tokens ` +
      "(base + chip + text + 5 níveis por partido; `-ink` é preto/branco do kit, não cor de partido).",
  );
  console.log(
    `Par chip/tinta ≥ ${CHIP_CONTRAST_FLOOR.toFixed(1)}:1 (§ 4): OK em ${parties.length} partidos ` +
      `— ${inkLight} com tinta clara, ${parties.length - inkLight} com tinta escura; ` +
      `pior par: --party-${worstChip.entry.slug} ${worstChip.chip.contrast.toFixed(2)}:1.`,
  );
  console.log(
    `Tinta de texto ≥ ${TEXT_CONTRAST_FLOOR.toFixed(1)}:1 sobre ${spec.textSurfaces.map((s) => s.hex).join(" e ")} ` +
      `(§ 4): OK em ${parties.length} partidos — pior: --party-${worstText.entry.slug}-text ` +
      `${worstText.text.worstContrast.toFixed(2)}:1 em ${worstText.text.worstSurface}.`,
  );
  if (spec.baseContrastFloor > 0) {
    console.log(
      `Cor de identidade ≥ ${spec.baseContrastFloor}:1 sobre o papel (WCAG 1.4.11): OK em ` +
        `${parties.length} partidos — pior: --party-${worstBase.entry.slug} ` +
        `${surfaceContrasts(worstBase.baseHex, spec.textSurfaces).worst.toFixed(2)}:1.`,
    );
  }
  console.log(
    `Separação entre partidos ≥ ${PARTY_SEPARATION_FLOOR} (§ 2 / ADR-0031): OK em ` +
      `${(parties.length * (parties.length - 1) * SEPARATED_ROLES.length) / 2} comparações ` +
      `(base, chip e text de cada par) — par mais próximo: ${roleToken(closest?.slugA ?? "", closest?.role ?? "base")} ` +
      `× ${roleToken(closest?.slugB ?? "", closest?.role ?? "base")} a ${closest?.deltaE.toFixed(2)}.`,
  );
  console.log(
    `Croma do nível 5 ≥ ${LEVEL5_CHROMA_RATIO_FLOOR} × nível 4: OK — pior razão ` +
      `${(
        (worstRatio.levels[4]?.measured.C ?? 0) / (worstRatio.levels[3]?.measured.C ?? 1)
      ).toFixed(2)} em --party-${worstRatio.entry.slug}.`,
  );

  const clamped = parties.flatMap((p) => p.levels.filter((lv) => lv.clamped));
  const pushed = parties.flatMap((p) =>
    p.levels.filter((lv) => lv.pushed).map((lv) => ({ slug: p.entry.slug, lv })),
  );
  console.log(`${clamped.length} nível(is) com croma reduzido ao gamut sRGB (matiz preservada).`);
  if (pushed.length === 0) {
    console.log("Nenhum nível precisou de empurrão por ΔE76.");
  } else {
    console.log(`${pushed.length} nível(is) empurrado(s) para fora do raio proibido.`);
  }

  const verbo = spec.contrastStep < 0 ? "escurecido" : "clareado";
  const movedChips = parties.filter((p) => p.chip.moved);
  if (movedChips.length === 0) {
    console.log(`Nenhum chip precisou ser ${verbo}.`);
  } else {
    console.log(`${movedChips.length} chip(s) ${verbo}(s):`);
    for (const p of movedChips) {
      const c = p.chip;
      console.log(
        `  --party-${p.entry.slug}-chip: ${p.baseHex} → ${c.hex} ` +
          `(${c.baseBestContrast.toFixed(2)}:1 → ${c.contrast.toFixed(2)}:1, ` +
          `ΔE76 ${c.deltaEFromBase.toFixed(1)} da base)`,
      );
    }
  }
  const movedTexts = parties.filter((p) => p.text.moved);
  if (movedTexts.length === 0) {
    console.log(`Nenhuma tinta de texto precisou ser ${verbo}a.`);
  } else {
    console.log(`${movedTexts.length} tinta(s) de texto ${verbo}(s):`);
    for (const p of movedTexts) {
      const t = p.text;
      console.log(
        `  --party-${p.entry.slug}-text: ${p.baseHex} → ${t.hex} ` +
          `(${t.baseWorstContrast.toFixed(2)}:1 → ${t.worstContrast.toFixed(2)}:1, ` +
          `ΔE76 ${t.deltaEFromBase.toFixed(1)} da base)`,
      );
    }
  }

  const inversions = chromaInversions(parties);
  if (inversions.length > 0) {
    console.warn(
      `AVISO — ${inversions.length} rampa(s) com croma caindo antes do nível 4 (tema ${spec.id}). ` +
        "L* continua ordenado (a escala não mente), mas o degrau fica mais achatado que o do kit.",
    );
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const wantReport = argv.includes("--report");
  const checkOnly = argv.includes("--check");
  const wantSuggest = argv.includes("--suggest");

  const official = loadOfficialHexes();
  const officialsOf = (slug: string) => official[`--party-${slug}`]?.official ?? [];

  // `--suggest` roda ANTES dos gates: ele existe justamente para quando eles
  // reprovam. Ver a seção 7c para o critério. Opera sobre o tema CLARO, porque
  // é lá que mora `PARTY_BASE` — no escuro a base é derivada.
  if (wantSuggest) {
    const fixes = suggestFixes(PARTY_BASE, official, PARTY_SEPARATION_FLOOR);
    if (fixes === null) {
      console.error(
        "Nenhuma combinação de hexes dentro da grade de busca resolve todos os conflitos.\n" +
          "Amplie SUGGEST_H_SPAN / SUGGEST_L_SPAN / SUGGEST_C_SPAN, ou reveja a tabela de\n" +
          "hexes oficiais — pode haver um partido com a matiz inteiramente cercada.",
      );
      process.exitCode = 1;
      return;
    }
    if (fixes.length === 0) {
      console.log(
        `Nada a mudar: os 31 partidos já ficam a ΔE76 ≥ ${PARTY_SEPARATION_FLOOR} entre si ` +
          "nos três papéis, e nenhuma rampa tem defeito próprio.",
      );
      return;
    }
    console.log(formatFixes(fixes));
    return;
  }

  const themes: ReadonlyArray<{ spec: ThemeSpec; parties: GeneratedParty[] }> = [
    { spec: LIGHT_THEME, parties: buildTheme(PARTY_BASE, officialsOf, LIGHT_THEME) },
    { spec: DARK_THEME, parties: buildTheme(PARTY_BASE, officialsOf, DARK_THEME) },
  ];

  // ---- gates: nada é escrito se algum tema falhar ------------------------
  for (const { spec, parties } of themes) {
    const erro = runGates(parties, spec);
    if (erro !== null) {
      console.error(`[tema ${spec.id}] ${erro}`);
      process.exitCode = 1;
      return;
    }
  }

  const light = themes[0] as { spec: ThemeSpec; parties: GeneratedParty[] };
  const dark = themes[1] as { spec: ThemeSpec; parties: GeneratedParty[] };
  const css = emitCss(light.parties, dark.parties);
  const target = path.resolve(import.meta.dirname, "..", "app", "tokens-party.css");

  if (checkOnly) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== css) {
      console.error(
        "app/tokens-party.css está fora de sincronia com a tabela-fonte.\n" +
          "Rode `pnpm gen:party-scale` e commite o resultado.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("app/tokens-party.css em sincronia com a tabela-fonte.");
    for (const { spec, parties } of themes) summarize(parties, spec);
    if (wantReport) {
      for (const { spec, parties } of themes) console.log(report(parties, spec));
    }
    return;
  }

  writeFileSync(target, css, "utf8");
  console.log(
    `app/tokens-party.css gerado — ${PARTY_BASE.length} partidos × 5 níveis + ` +
      `${STATE_TOKENS.length} estados, em 2 temas (claro + escuro).`,
  );
  for (const { spec, parties } of themes) summarize(parties, spec);

  const semFonte = PARTY_BASE.filter((e) => !e.neutral && officialsOf(e.slug).length === 0);
  if (semFonte.length > 0) {
    console.warn(
      `\nAVISO — ${semFonte.length} partido(s) sem hex oficial localizado. ` +
        "Não há do que se afastar,\nentão o piso de ΔE76 não é aplicável — revisitar quando houver fonte:",
    );
    for (const e of semFonte) console.warn(`  --party-${e.slug} (${e.nome})`);
  }

  if (wantReport) {
    for (const { spec, parties } of themes) console.log(report(parties, spec));
  }
}

// Só executa quando invocado como script. Sem esta guarda, `import` deste
// módulo (testes, ou qualquer consumidor de `deltaE76`/`hexToLch`) reescreveria
// `app/tokens-party.css` como efeito colateral.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
