// data-pipeline/simulacao-gerar.ts
//
// **O gerador de estado eleitoral simulado** — uma FERRAMENTA DE
// DESENVOLVIMENTO. Produz, a partir do cadastro REAL de 2026 que já está no
// Postgres, um conjunto coerente de payloads "como se a apuração estivesse em
// N%", para que o dono do produto revise as quatro telas de cargo num estado
// único e crível antes do simulado do TSE de 15–17/09.
//
//   pnpm sim                                  # 25%, cenário apertado
//   pnpm sim -- --pct 62 --cenario folgado
//   pnpm sim -- --seed outra-noite --out /tmp/sim
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 1. Este script NÃO escreve em destino remoto. Nunca.
// ════════════════════════════════════════════════════════════════════════════
//
// Em 2026-09-14 02:10 UTC o site público exibiu "CANDIDATO 100 — 55,0% — 100%
// apurado" três semanas antes do pleito, porque um `pnpm dev` de pé na 3000
// com as credenciais de produção do Global Config no ambiente virou destino de
// escrita de um caminho que ninguém sabia que existia
// (`tests/setup/no-remote-writes.ts` conta a cadeia inteira).
//
// Um gerador de dado FALSO rodando num shell que acabou de fazer
// `set -a; . ./.env.local; set +a` é exatamente a mesma combinação: dado
// inventado de um lado, credencial de produção do outro. Por isso:
//
//   - não importa `lib/edge-config/writer.ts`, nem `lib/blob/write.ts`;
//   - não chama `fetch` para lugar nenhum;
//   - a ÚNICA saída é `fs.writeFile` dentro do diretório de `--out`.
//
// Há um teste que lê o **texto-fonte deste arquivo** e falha se qualquer um
// desses nomes reaparecer (`tests/unit/data-pipeline/simulacao-gerar.test.ts`).
// Ele existe porque a garantia que importa aqui não é sobre o que o código faz
// hoje — é sobre o que o próximo editor não pode acrescentar sem perceber.
//
// A conexão com o banco é de LEITURA: só `SELECT`. Nenhum `INSERT`, `UPDATE`
// nem `DELETE` — o gerador não tem o que gravar lá.
//
// ════════════════════════════════════════════════════════════════════════════
// 2. Determinismo é requisito, não conveniência
// ════════════════════════════════════════════════════════════════════════════
//
// Mesma `--seed` + mesmas flags ⇒ **bytes idênticos**. O dono vai iterar em
// CSS com essas fixtures carregadas, e um número que muda a cada reload
// transformaria toda diferença visual numa dúvida ("mudou porque mexi no CSS
// ou porque o dado mudou?"). Constituição § 6 pelo mesmo motivo de sempre.
//
// Consequências no código: nenhum `Math.random()`, nenhum `Date.now()` dentro
// da geração (o relógio entra UMA vez, em `ts`, e é injetável), nenhuma
// iteração sobre `Object.keys` sem ordenação explícita, nenhum `sort` sem
// critério de desempate.
//
// ════════════════════════════════════════════════════════════════════════════
// 3. O que é medido e o que é inventado — a fronteira, explícita
// ════════════════════════════════════════════════════════════════════════════
//
// MEDIDO (sai do banco ou de fixture do repositório, nunca digitado aqui):
//   - nome, nome de urna, partido, número e `sq_candidato` de cada
//     candidatura, com o MESMO filtro de publicabilidade de
//     `candidatos-publish.ts` (`publicavel`, ADR-0040 fail-closed);
//   - eleitorado apto por UF — `SUM(eleitores_aptos) GROUP BY uf`, **com
//     agregação**: a tabela é por par (município × zona), e lê-la sem `SUM`
//     já inflou número neste projeto antes (gate OT-4);
//   - comparecimento por UF — medido em `historical_results` 2022/1T/cargo 1:
//     `Σ votos ÷ Σ aptos`, entre 70,6% (AL) e 78,3% (CE). A coluna
//     `eleitorado.comparecimento_pct_historico` existe mas está **NULL nas
//     6.085 linhas**, então não há de onde lê-la; ver o aviso no manifest;
//   - `lugares_a_preencher` por UF — lido de
//     `tests/fixtures/edge-config/dep-current.json`, a única tabela das 513
//     cadeiras que existe no repositório. Não digitada aqui: o produto inteiro
//     trata esse número como dado do TSE (RF-124), e uma segunda cópia à mão
//     seria a próxima a divergir.
//
// INVENTADO (e é o ponto do script — mas declarado como tal no manifest):
//   - quanto cada candidatura tem de voto;
//   - quanto de cada UF já apurou;
//   - as probabilidades.
//
// ════════════════════════════════════════════════════════════════════════════
// 4. 🔴 O campo `fase` NÃO é emitido
// ════════════════════════════════════════════════════════════════════════════
//
// `EdgePayload.fase` tem exatamente um valor — o exportado como
// `FASE_PRE_ELEICAO` por `lib/config/fase.ts`, que é o dono do literal — e
// significa "este placar está zerado por não ter começado". Este payload representa o
// oposto — está apurando. Emitir `fase` aqui faria as telas anunciarem "a
// eleição ainda não começou" em cima de um placar de 25%.
//
// São três estados, decisão do dono em 14/09: **não começou** (`fase`
// presente) / **não sabemos** (payload ausente) / **apurando** (payload SEM
// `fase`). Este gerador produz o terceiro. Ver ADR-0043 e `lib/config/fase.ts`.
//
// `dado_ts` também **não** é emitido, pelo mesmo tipo de razão (ADR-0038): ele
// é a hora do dado NO TSE, e aqui não houve TSE nenhum. Inventar um relógio de
// fonte é precisamente a mentira que aquele campo existe para impedir. As
// quatro fixtures atuais também não o trazem, e a tela já sabe degradar.
//
// `ts` é honesto e continua sendo o que sempre prometeu: a hora em que o
// cálculo rodou — aqui, a hora em que o gerador rodou.
//
// ════════════════════════════════════════════════════════════════════════════
// 5. Um percentual de apuração por UF, compartilhado pelos quatro cargos
// ════════════════════════════════════════════════════════════════════════════
//
// As urnas são as mesmas. Se SP aparecer com 44,3% no Presidente e 39,1% no
// Senador, a simulação se denuncia na primeira conferência — e essa é
// exatamente a checagem que o dono faria. `pctPorUf` é calculado UMA vez e os
// seis arquivos o consomem.
//
// Deputado Federal **não** recebe percentual deslocado, ainda que o cargo
// tenha cadência própria (`atualizacao_min: 15`, ADR-0036: 6 fatias de 5 min,
// volta completa em 30). A cadência atrasa o **dado**, não a urna; o repo já
// expressa esse atraso por `dado_ts`/`atualizacao_min`, e transformá-lo em
// "menos por cento apurado" contaria uma segunda história sobre o mesmo fato.
//
// ════════════════════════════════════════════════════════════════════════════
// 6. O mapa não pode ficar uniforme — o perfil de velocidade
// ════════════════════════════════════════════════════════════════════════════
//
// Percentuais medidos no replay real de 2022, todos no MESMO instante (15 min
// após o fechamento). MS já tinha 85% e a Bahia 25%: a diferença entre as UFs
// é a coisa mais visível do mapa na primeira hora, e um choropleth de 27
// estados no mesmo tom não exercita nada.
//
// O perfil vira um multiplicador, e o multiplicador é renormalizado por
// bisseção para que o total nacional **ponderado pelo eleitorado** bata o
// `--pct` pedido dentro de 0,1 pp. A bisseção (e não uma divisão direta)
// porque o teto de 100% por UF torna a relação não-linear: com `--pct 90`,
// MS satura e as lentas têm de subir mais para compensar.
//
// ════════════════════════════════════════════════════════════════════════════
// 7. Decisões de identidade que divergem do óbvio — confira estas
// ════════════════════════════════════════════════════════════════════════════
//
// (a) **`id` é o número na urna SÓ no cargo 1.** Em Governador e Senador o
//     bloco nacional é a união de 27 corridas, e a UI indexa
//     `national.candidatos` por `id` para resolver `por_uf.top_candidatos[].id`
//     (`app/(sen)/senador/page.tsx:244`, `GovernorCard`). Com o número de urna
//     como `id`, o 13 de Alagoas e o 13 do Acre colidiriam e a tela mostraria o
//     candidato do estado errado — o defeito que o ADR-0042 existe para
//     prevenir. Então nesses cargos `id` é um sequencial único
//     (`ordemUf * 1000 + ordemNaUf`), como já fazem as fixtures atuais
//     (`3011`, `5000`). `top_candidatos` carrega `nome`/`partido`/`sqcand`
//     próprios, que é o caminho pós-spec-018 e não depende do índice.
//
// (b) **`EdgeCandidate.sqcand` só no cargo 1.** O tipo é explícito
//     (`types.ts:324`): em cargo 3 e 5 um `sqcand` no bloco nacional
//     endereçaria a foto de um candidato de UF arbitrária. A identidade desses
//     cargos vai onde ela sabe de que UF é — `por_uf[].top_candidatos[].sqcand`
//     e os arquivos por UF (`governador-uf.json` desde 19/09, `senador-uf.json`),
//     que é de onde as telas estaduais leem o rosto.
//
// (c) **Quem lidera é função da `--seed`.** Não há favorito codificado. A
//     alternativa — escrever à mão quem fica com 35% e quem fica com 2% —
//     seria o repositório inventando um prognóstico sobre pessoas reais, que é
//     o que a constituição § 2 proíbe. Trocar a seed reembaralha.
//
// ════════════════════════════════════════════════════════════════════════════
// 8. Roda em `tsx`
// ════════════════════════════════════════════════════════════════════════════
//
// Como `candidatos-publish`, `projection-seed` e `replay-2022`: importa de
// `@/lib/`, e o loader `--experimental-strip-types` do Node não resolve o
// alias `@/` do `tsconfig.json`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// As MESMAS funções que a tela usa para desenhar os arcos — o validador não
// reimplementa a aritmética, para não divergir dela em silêncio.
import {
  fatiasCirculo1,
  fatiasCirculo2,
  fatiasCirculo3,
} from "@/components/blocks/VotacaoEleitorado";
import type {
  DeputadoUfAgremiacao,
  DeputadoUfCandidato,
  DeputadoUfDetail,
} from "@/lib/blob/deputado-uf";
import type { UfDetailBlob } from "@/lib/blob/uf-detail";
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";
import { ehMunicipioDeVerdade } from "@/lib/config/malha-ibge";
import type {
  EdgeAgremiacaoBancada,
  EdgeCandidate,
  EdgeCorridaEntrada,
  EdgeCorridaPartido,
  EdgeDestinoVoto,
  EdgeNational,
  EdgePayload,
  EdgePayloadDeputado,
  EdgePayloadUf,
  EdgeUfCandidate,
  EdgeUfMunicipio,
  EdgeUfRow,
  EdgeUfSeriesTemporais,
  EdgeVotacao,
  EdgeVotacaoContagens,
  EdgeVotacaoProjetada,
  EdgeVotacaoUf,
  NeedleBand,
} from "@/lib/edge-config/types";
import { colorForRank } from "@/lib/utils/cand-color";
import { getPool } from "./_tse-common.ts";
import { ANO_PLEITO } from "./candidatos-parse.ts";

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_local, "..");

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

export type Cenario = "apertado" | "folgado" | "tres-vias";

const CENARIOS: readonly Cenario[] = ["apertado", "folgado", "tres-vias"] as const;

export interface CliSimulacao {
  /** % nacional apurado pedido, ponderado pelo eleitorado. 0–100. */
  pct: number;
  cenario: Cenario;
  seed: string;
  /** Diretório de saída, relativo à raiz do repositório ou absoluto. */
  out: string;
  /**
   * ADR-0053 / RF-213 — cenário OPCIONAL `--anulado-lidera <UF>`: nesta UF a
   * candidatura mais forte a Governador e a Senador tem o voto ANULADO e
   * lidera o apurado. Ausente no default (e no `CLI_DEFAULT`): sem a flag, a
   * saída é byte a byte a de sempre. Ver {@link FRACAO_ANULADOS_CENARIO}.
   */
  anuladoLidera?: string;
}

export const CLI_DEFAULT: CliSimulacao = {
  pct: 25,
  // `apertado` é o default porque é o cenário que exercita MAIS UI: intervalos
  // sobrepostos, nenhum vencedor projetado, nenhuma corrida chamada. Um cenário
  // decidido esconde metade dos estados visuais que precisam de revisão.
  cenario: "apertado",
  seed: "salacofre-simulado-2026",
  out: "tests/fixtures/simulacao",
};

export function parseCli(argv: readonly string[]): CliSimulacao {
  const cli: CliSimulacao = { ...CLI_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--pct") {
      if (v === undefined) throw new Error("--pct exige um número (ex.: --pct 25)");
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(`--pct fora de 0..100: "${v}"`);
      }
      cli.pct = n;
      i++;
    } else if (a === "--cenario") {
      if (v === undefined) throw new Error(`--cenario exige um de: ${CENARIOS.join(", ")}`);
      // Lookup explícito, nunca `?? "apertado"`: um valor não reconhecido
      // virando o default em silêncio é o molde do defeito que neste repo já
      // mandou payload de Senador para a chave do Presidente.
      const achado = CENARIOS.find((c) => c === v);
      if (achado === undefined) {
        throw new Error(`--cenario não reconhece "${v}". Aceita: ${CENARIOS.join(", ")}.`);
      }
      cli.cenario = achado;
      i++;
    } else if (a === "--seed") {
      if (v === undefined || v.length === 0) throw new Error("--seed exige um valor");
      cli.seed = v;
      i++;
    } else if (a === "--out") {
      if (v === undefined || v.length === 0) throw new Error("--out exige um diretório");
      cli.out = v;
      i++;
    } else if (a === "--anulado-lidera") {
      // Lookup explícito na lista de UFs, nunca um default: `--anulado-lidera`
      // sem UF, ou com UF inexistente, é erro alto.
      const uf = UFS.find((u) => u === v);
      if (uf === undefined) {
        throw new Error(`--anulado-lidera exige uma UF (ex.: --anulado-lidera SP); veio "${v}".`);
      }
      cli.anuladoLidera = uf;
      i++;
    } else if (a?.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  return cli;
}

// ═════════════════════════════════════════════════════════════════════════════
// Aleatoriedade determinística
// ═════════════════════════════════════════════════════════════════════════════

function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Gerador pseudoaleatório semeado (mulberry32).
 *
 * `derive(tag)` cria um fluxo INDEPENDENTE a partir da mesma seed. É o que
 * impede que acrescentar um sorteio no meio do Presidente desloque todos os
 * números do Deputado: cada cargo, cada UF e cada agremiação puxa do próprio
 * fluxo, nomeado. Sem isso, qualquer edição futura reescreveria os seis
 * arquivos inteiros e a revisão do dono viraria ruído.
 */
export class Rng {
  private estado: number;
  private readonly semente: string;
  /** Meia-normal guardada do par de Box–Muller. */
  private normalGuardada: number | null = null;

  constructor(semente: string) {
    this.semente = semente;
    this.estado = fnv1a(semente) || 1;
  }

  derive(tag: string): Rng {
    return new Rng(`${this.semente}|${tag}`);
  }

  /** Uniforme em [0, 1). */
  u(): number {
    this.estado = (this.estado + 0x6d2b79f5) | 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniforme em [a, b). */
  entre(a: number, b: number): number {
    return a + (b - a) * this.u();
  }

  /** Normal padrão (Box–Muller). */
  normal(): number {
    if (this.normalGuardada !== null) {
      const g = this.normalGuardada;
      this.normalGuardada = null;
      return g;
    }
    // `1 - u()` porque `u()` pode devolver 0 e `log(0)` é -∞.
    const u1 = 1 - this.u();
    const u2 = this.u();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u2;
    this.normalGuardada = r * Math.sin(th);
    return r * Math.cos(th);
  }

  /** Permutação de Fisher–Yates — determinística, in-place sobre uma cópia. */
  embaralhar<T>(itens: readonly T[]): T[] {
    const out = [...itens];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.u() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Aritmética — arredondamento e alocação inteira
// ═════════════════════════════════════════════════════════════════════════════

function r1(x: number): number {
  return Math.round(x * 10) / 10;
}
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
function r4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/**
 * Reparte `total` votos entre `pesos` por **maiores restos**.
 *
 * Existe para que a invariante "a soma dos votos dos candidatos bate com o
 * total de votos válidos da UF" seja verdadeira por CONSTRUÇÃO e não por
 * tolerância. Arredondar cada parcela independentemente deixa um resíduo de
 * até N/2 votos, e um resíduo é exatamente o tipo de coisa que a tela mostra
 * como "os números não fecham".
 */
export function alocarInteiros(total: number, pesos: readonly number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0 || total <= 0) return pesos.map(() => 0);
  const exatos = pesos.map((p) => (p / soma) * total);
  const piso = exatos.map((x) => Math.floor(x));
  let resto = total - piso.reduce((a, b) => a + b, 0);
  // Desempate por índice ASC — sem ele, dois pesos com o mesmo resto trocariam
  // de posição conforme o algoritmo de ordenação (constituição § 6).
  const ordem = exatos
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of ordem) {
    if (resto <= 0) break;
    piso[i] = (piso[i] as number) + 1;
    resto--;
  }
  return piso;
}

/**
 * Reparte uma MATRIZ de inteiros respeitando as duas margens ao mesmo tempo:
 * a soma de cada linha bate `linhas[m]` e a de cada coluna bate `colunas[c]`.
 *
 * Existe para o mapa municipal. `alocarInteiros` por município garante a
 * margem de linha (os votos de um município fecham com o que ele apurou), mas
 * deixa a de coluna solta — e aí a soma dos votos de um candidato nos 645
 * municípios de São Paulo não bate com o total dele em São Paulo. É um erro
 * pequeno em cada célula e visível no total, que é a pior combinação: a tela
 * do estado e a do município se contradizem e nada acusa.
 *
 * Duas fases:
 *   1. **Ajuste proporcional iterativo** sobre a matriz de preferência, até as
 *      duas margens baterem em número real.
 *   2. **Arredondamento que preserva as margens**: chão em tudo, e as unidades
 *      que sobraram distribuídas por maior parte fracionária, respeitando o que
 *      falta em cada linha E em cada coluna. O passo de reparo no fim existe
 *      porque a fase gulosa pode empacar; como Σ faltas de linha == Σ faltas de
 *      coluna, sempre há para onde mandar.
 *
 * ## 🔴 2026-09-19 — a margem ZERO envenenava a matriz inteira com `NaN`
 *
 * Achado ao acrescentar a invariante (10b) de `validarSaida` (Σ votos do
 * município = votos do candidato na UF). Uma linha com margem `0` — um
 * município que ainda não apurou nada, que é o estado NORMAL no começo da
 * noite — era zerada na 1ª iteração; na 2ª, o fator de escala da linha virava
 * `0 / 0 = NaN`, e a normalização de coluna seguinte espalhava esse `NaN` por
 * **todas** as linhas. O resultado não era um número errado: era
 * `votos_reportados: {}` em todos os municípios do estado, `lider.votos: 0` e
 * `margem_pp: 0`, com forma perfeitamente válida.
 *
 * Silencioso nos dois sentidos: o JSON serializa `NaN` como `null`, e nenhuma
 * checagem olhava o conteúdo das células — só a média de `pct_apurado`, que não
 * depende desta matriz. Reproduz com qualquer `--pct` baixo o bastante para um
 * município arredondar para `0,0` (o caso de MG em
 * `tests/unit/data-pipeline/simulacao-gerar.test.ts` com `pct: 0.08`).
 *
 * Conserto: fator `0` quando a linha somou `0`. É o valor CERTO, não um
 * remendo — `soma === 0` só acontece depois de a própria linha ter sido zerada
 * por `linhas[m] === 0`, e uma linha de margem zero tem de continuar zerada. O
 * caso impossível (`soma === 0` com margem positiva, que seria margem
 * insatisfazível) sai como erro alto, nunca como `NaN` calado.
 */
export function alocarMatriz(
  linhas: readonly number[],
  colunas: readonly number[],
  pesos: readonly (readonly number[])[],
): number[][] {
  const nL = linhas.length;
  const nC = colunas.length;
  const totalL = linhas.reduce((a, b) => a + b, 0);
  const totalC = colunas.reduce((a, b) => a + b, 0);
  if (totalL !== totalC) {
    throw new Error(
      `alocarMatriz: margens incompatíveis — linhas somam ${totalL}, colunas ${totalC}`,
    );
  }
  if (totalL === 0) return linhas.map(() => new Array<number>(nC).fill(0));

  const x = pesos.map((linha) => linha.map((v) => Math.max(1e-12, v)));
  for (let it = 0; it < 12; it++) {
    for (let m = 0; m < nL; m++) {
      const soma = (x[m] as number[]).reduce((a, b) => a + b, 0);
      // Ver a nota "a margem ZERO envenenava a matriz" no docblock. Linha
      // zerada ⇒ fator 0; linha zerada com margem POSITIVA é margem
      // insatisfazível e sai alto, nunca como `NaN` que se espalha.
      if (soma === 0 && (linhas[m] as number) > 0) {
        throw new Error(
          `alocarMatriz: linha ${m} zerou com margem ${linhas[m]} — margem insatisfazível`,
        );
      }
      const f = soma === 0 ? 0 : (linhas[m] as number) / soma;
      for (let c = 0; c < nC; c++) (x[m] as number[])[c] = ((x[m] as number[])[c] as number) * f;
    }
    for (let c = 0; c < nC; c++) {
      let soma = 0;
      for (let m = 0; m < nL; m++) soma += (x[m] as number[])[c] as number;
      // A passagem de COLUNA nunca produziu `NaN` e fica como estava: o
      // `1e-12` no denominador torna `0 / 0` em `0`, e não em `NaN`. Mudá-la
      // junto seria alterar números que ninguém pediu para mudar — o defeito
      // era só do lado da linha, onde não havia denominador protegido.
      const f = (colunas[c] as number) / Math.max(1e-12, soma);
      for (let m = 0; m < nL; m++) (x[m] as number[])[c] = ((x[m] as number[])[c] as number) * f;
    }
  }

  const y = x.map((linha) => linha.map((v) => Math.floor(v)));
  const faltaL = linhas.map((v, m) => v - (y[m] as number[]).reduce((a, b) => a + b, 0));
  const faltaC = colunas.map((v, c) => {
    let soma = 0;
    for (let m = 0; m < nL; m++) soma += (y[m] as number[])[c] as number;
    return v - soma;
  });

  const celulas: Array<{ m: number; c: number; frac: number }> = [];
  for (let m = 0; m < nL; m++) {
    for (let c = 0; c < nC; c++) {
      const v = (x[m] as number[])[c] as number;
      celulas.push({ m, c, frac: v - Math.floor(v) });
    }
  }
  // Desempate por (linha, coluna) ASC — determinismo, constituição § 6.
  celulas.sort((a, b) => b.frac - a.frac || a.m - b.m || a.c - b.c);
  for (const { m, c } of celulas) {
    if ((faltaL[m] as number) <= 0 || (faltaC[c] as number) <= 0) continue;
    (y[m] as number[])[c] = ((y[m] as number[])[c] as number) + 1;
    faltaL[m] = (faltaL[m] as number) - 1;
    faltaC[c] = (faltaC[c] as number) - 1;
  }
  for (let m = 0; m < nL; m++) {
    while ((faltaL[m] as number) > 0) {
      const c = faltaC.findIndex((v) => v > 0);
      if (c < 0) break;
      (y[m] as number[])[c] = ((y[m] as number[])[c] as number) + 1;
      faltaL[m] = (faltaL[m] as number) - 1;
      faltaC[c] = (faltaC[c] as number) - 1;
    }
  }
  return y;
}

/** Normaliza um vetor de pesos para somar 1. Vetor nulo devolve uniforme. */
function normalizar(pesos: readonly number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0) return pesos.map(() => 1 / Math.max(1, pesos.length));
  return pesos.map((p) => p / soma);
}

// ═════════════════════════════════════════════════════════════════════════════
// Perfil de velocidade de apuração por UF
// ═════════════════════════════════════════════════════════════════════════════

/**
 * % apurado de cada UF **no mesmo instante** (15 min após o fechamento) no
 * replay real de 2022. É a fonte da heterogeneidade do mapa.
 *
 * As 16 do grupo lento estavam todas em ~25 naquele minuto. TO e SE entram no
 * grupo lento (não há medição separada delas no recorte que temos).
 */
export const PERFIL_VELOCIDADE_2022: Readonly<Record<string, number>> = {
  MS: 85,
  DF: 80,
  SP: 75.6,
  PR: 75,
  MG: 70,
  ES: 69.4,
  GO: 66.7,
  RJ: 66.2,
  MT: 59.4,
  RS: 59.4,
  SC: 51.8,
  AC: 25,
  AL: 25,
  AM: 25,
  AP: 25,
  BA: 25,
  CE: 25,
  MA: 25,
  PA: 25,
  PB: 25,
  PE: 25,
  PI: 25,
  RN: 25,
  RO: 25,
  RR: 25,
  SE: 25,
  TO: 25,
};

/** As 27 siglas, em ordem alfabética — a ordem canônica de toda saída. */
export const UFS: readonly string[] = Object.keys(PERFIL_VELOCIDADE_2022).sort();

/**
 * Distribui o `--pct` nacional entre as UFs segundo o perfil, de modo que o
 * agregado **ponderado pelo eleitorado** volte a bater o pedido.
 *
 * Bisseção sobre o fator multiplicativo, e não uma divisão fechada, porque o
 * teto de 100% por UF quebra a linearidade: a partir de ~`--pct 70` o MS
 * satura e o fator tem de subir mais do que a conta direta indicaria para o
 * nacional ainda fechar.
 *
 * Cada UF é arredondada a 1 casa ANTES da conferência: é o número que vai ao
 * arquivo, e conferir sobre o não-arredondado deixaria o manifest provando uma
 * coisa e o payload dizendo outra.
 */
export function distribuirPctPorUf(
  pctAlvo: number,
  eleitoradoPorUf: Readonly<Record<string, number>>,
): Record<string, number> {
  const ufs = UFS.filter((uf) => (eleitoradoPorUf[uf] ?? 0) > 0);
  const pesoTotal = ufs.reduce((a, uf) => a + (eleitoradoPorUf[uf] as number), 0);

  const comFator = (f: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const uf of ufs) {
      const v = (PERFIL_VELOCIDADE_2022[uf] as number) / 100;
      out[uf] = r1(Math.min(100, Math.max(0, pctAlvo * f * v)));
    }
    return out;
  };
  const nacional = (m: Record<string, number>): number =>
    ufs.reduce((a, uf) => a + (m[uf] as number) * (eleitoradoPorUf[uf] as number), 0) / pesoTotal;

  if (pctAlvo <= 0) return comFator(0);

  let lo = 0;
  let hi = 64;
  let melhor = comFator(1);
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const m = comFator(mid);
    const n = nacional(m);
    melhor = m;
    if (Math.abs(n - pctAlvo) < 1e-6) break;
    if (n < pctAlvo) lo = mid;
    else hi = mid;
  }
  return melhor;
}

// ═════════════════════════════════════════════════════════════════════════════
// Cenários
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Participação nacional (share dos votos a votáveis) dos 4 primeiros, por
 * cenário. O restante é repartido pela cauda com decaimento geométrico.
 *
 * Os números existem para produzir **estados de UI distintos**, e é assim que
 * devem ser lidos:
 *
 *   - `apertado` — 1º e 2º a ~1,2 pp, dentro do IC95 um do outro a 25%
 *     apurado: nenhum vencedor projetado, agulha em `tossup`, terceiro com
 *     peso suficiente para o bloco "Cenários para o 2º turno" ter o que dizer.
 *   - `folgado` — líder com o IC cruzando os 50%: é o único cenário em que
 *     `p_fecha_1t` sai do zero e o gatilho "decisão no 1T" acende.
 *   - `tres-vias` — três dentro de 3 pp: máxima indefinição, e o único em que
 *     `cenarios_2t` distribui probabilidade por mais de um par.
 */
const PERFIL_CENARIO: Readonly<Record<Cenario, readonly number[]>> = {
  apertado: [35.8, 34.6, 16.1, 7.5],
  folgado: [48.4, 26.9, 13.2, 5.5],
  "tres-vias": [30.1, 28.9, 27.4, 5.6],
};

/**
 * Share nacional de cada candidatura presidencial, na ordem em que o sorteio
 * as colocou. Os 4 primeiros vêm do cenário; a cauda decai geometricamente
 * sobre o que sobrou, o que reproduz a forma real de uma cauda de 8 nanicos
 * (poucos décimos cada) sem inventar um número por candidato.
 */
export function sharesPresidenciais(cenario: Cenario, n: number): number[] {
  const topo = PERFIL_CENARIO[cenario];
  const shares: number[] = [];
  let usado = 0;
  for (let i = 0; i < Math.min(topo.length, n); i++) {
    shares.push(topo[i] as number);
    usado += topo[i] as number;
  }
  const cauda = n - shares.length;
  if (cauda > 0) {
    const sobra = 100 - usado;
    const pesos: number[] = [];
    for (let i = 0; i < cauda; i++) pesos.push(0.55 ** i);
    const norm = normalizar(pesos);
    for (const p of norm) shares.push(sobra * p);
  }
  return shares;
}

/**
 * Os três feitios de corrida estadual. O dono precisa ver os TRÊS no grid de
 * Governador e no de Senador — 27 estados com o mesmo feitio não mostram o
 * que a tela faz quando a corrida está decidida nem quando está em aberto.
 */
export type FeitioUf = "decidida" | "apertada" | "indefinida";

const SHARES_FEITIO: Readonly<Record<FeitioUf, readonly number[]>> = {
  decidida: [57.5, 24.0, 11.0, 4.0],
  apertada: [38.5, 35.4, 15.6, 4.5],
  indefinida: [31.2, 29.0, 26.4, 6.2],
};

/**
 * Reparte as 27 UFs entre os três feitios em cotas aproximadamente iguais
 * (9/9/9) e embaralha com a seed.
 *
 * Cota, e não sorteio livre: um sorteio independente por UF pode devolver 22
 * corridas decididas e nenhuma indefinida — e aí a tela que o dono precisava
 * revisar não aparece. A cota garante que os três estados de UI existam
 * sempre; a seed decide quem cai em qual.
 */
export function repartirFeitios(rng: Rng, ufs: readonly string[]): Record<string, FeitioUf> {
  const feitios: FeitioUf[] = [];
  const ordem: FeitioUf[] = ["decidida", "apertada", "indefinida"];
  for (let i = 0; i < ufs.length; i++) feitios.push(ordem[i % 3] as FeitioUf);
  const sorteadas = rng.embaralhar(ufs);
  const out: Record<string, FeitioUf> = {};
  sorteadas.forEach((uf, i) => {
    out[uf] = feitios[i] as FeitioUf;
  });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Incerteza e probabilidades
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Meia-largura do IC95 de um share, em pontos percentuais.
 *
 * `sqrt(p(1−p)) · sqrt((100−pct)/pct)`: cresce quando a corrida está dividida
 * (p perto de 0,5), encolhe conforme a apuração avança e **zera em 100%
 * apurado** — que é a propriedade que uma fórmula só com `1/sqrt(pct)` não
 * tem, e cuja falta deixaria um IC de ±0,9 pp num placar totalmente apurado.
 *
 * O piso de 0,15 pp existe porque um IC de largura zero é a forma tipográfica
 * da certeza absoluta, e a spec 019 já documenta o estrago que isso faz na
 * tela.
 */
export function meiaLarguraIc(share: number, pctApurado: number): number {
  if (pctApurado <= 0) return 0;
  if (pctApurado >= 100) return 0.15;
  const p = Math.min(0.999, Math.max(0.001, share / 100));
  const bruto = 2.3 * Math.sqrt(p * (1 - p)) * Math.sqrt((100 - pctApurado) / pctApurado);
  return Math.max(0.15, bruto) * 100 * 0.01;
}

const N_RESAMPLES = 2000;

/**
 * Quantas candidaturas entram em `EdgeUfRow.top_candidatos[]`.
 *
 * Espelha `TOP_CANDIDATOS_POR_UF` de `api/model/project.py` (era 3 até
 * 2026-09-19; virou 4 a pedido do dono, junto com a linha "Outros"). Os dois
 * arquivos precisam concordar porque a fixture de simulação é lida pela MESMA
 * UI que consome o payload real — um gerador que cortasse em 3 faria
 * `pnpm dev:sim` mostrar uma tela que produção não mostra, que é exatamente o
 * modo de erro registrado na memória durável "a fixture do simulado é mais
 * rica que produção" (18/09), só que na direção contrária.
 *
 * Como no Python, é UM nome para DOIS usos — o `slice(0, N)` do topo e o
 * `slice(N)` da cauda que vira `outros`. Dois literais divergem em silêncio e
 * republicariam a 5ª candidatura nos dois lugares.
 */
const TOP_CANDIDATOS_POR_UF = 4;

/**
 * Quantas candidaturas são RESGATADAS pela ordem do APURADO quando ficam fora
 * do corte por projeção.
 *
 * Espelha `RESGATE_POR_APURADO` de `api/model/project.py` (2026-09-21,
 * decisão do dono), e existe aqui pelo MESMO motivo do irmão acima: a UI que
 * lê esta fixture é a que lê o payload real. Um gerador sem o resgate faria
 * `pnpm dev:sim` esconder exatamente a tela que esta mudança existe para
 * mostrar — e o defeito só apareceria em produção, na noite da apuração.
 *
 * São 2 porque são os dois postos que a derivação por base consome: o #1
 * (cor do mapa, topo do balão, linha "Líder:") e o #2 (intensidade do mapa e,
 * em Senador, a 2ª cadeira). Ver a docstring da constante no Python.
 */
const RESGATE_POR_APURADO = 2;

/**
 * O prefixo por projeção (índices 0..N-1, ordem intacta) mais os resgatados
 * por `pct_atual`, anexados ao FIM.
 *
 * 🔴 Anexados ao fim, nunca no meio: `margemSegundaVaga`
 * (`lib/utils/margem-senado.ts:43`) lê `top_candidatos[1]`/`[2]` por POSIÇÃO,
 * então um resgatado no índice 1 trocaria em silêncio o par que decide a 2ª
 * vaga do Senado.
 *
 * ⚠️ Diferença legítima em relação ao Python: lá o filtro é
 * `pct_atual is not None` (a imputação nacional de `impute_uf_from_national`
 * produz `None`); aqui `shareAtual` é sempre um número — `sharesApurados`
 * devolve `0` explícito quando `pctApurado <= 0`, e `0` É o fato. Por isso
 * não há filtro de ausência: não existe ausência neste gerador.
 */
export function selecionarComResgate<T extends { shareAtual: number; cand: { id: number } }>(
  resultados: readonly T[],
): { selecionados: T[]; cauda: T[] } {
  const prefixo = resultados.slice(0, TOP_CANDIDATOS_POR_UF);
  const idsPrefixo = new Set(prefixo.map((r) => r.cand.id));
  // 🔴 UNIÃO: a ordem por apurado sai da corrida INTEIRA, e só depois se
  // remove quem já está no prefixo. Pegar "os 2 melhores entre os excluídos"
  // resgataria sempre 2 em toda UF com 6+ candidaturas — inclusive os dois
  // ÚLTIMOS do apurado — e apagaria a linha "Outros". Mesmo erro que a
  // primeira versão do lado Python cometeu.
  const resgatados = [...resultados]
    // Empate desempata por id, como no Python: o mesmo insumo tem de gerar o
    // mesmo arquivo, senão o `git diff` da fixture vira ruído.
    .sort((a, b) => b.shareAtual - a.shareAtual || a.cand.id - b.cand.id)
    .slice(0, RESGATE_POR_APURADO)
    .filter((r) => !idsPrefixo.has(r.cand.id));
  const selecionados = [...prefixo, ...resgatados];
  const ids = new Set(selecionados.map((r) => r.cand.id));
  // Complemento por ID, não por índice — com o resgate, topo e cauda deixaram
  // de ser dois fatiamentos do mesmo número, e um `slice(N)` republicaria o
  // resgatado dentro de "Outros" também.
  return { selecionados, cauda: resultados.filter((r) => !ids.has(r.cand.id)) };
}

export interface ResultadoProbabilidades {
  pVitoria: number[];
  pTop2: number[];
  pFecha1t: number[];
  /** P(ninguém fecha o 1T sozinho). */
  pSegundoTurno: number;
  /** Frequência dos pares (1º, 2º) por índice, top-3. */
  paresTop3: Array<{ par: [number, number]; prob: number }>;
  /** P(terminar entre os `vagas` primeiros) — a pergunta do Senado. */
  pEleito: number[];
}

/**
 * Probabilidades por **contagem de cenário**, não por comparação de
 * distribuições marginais.
 *
 * A distinção não é acadêmica: com duas vagas (Senado), a soma dos `p_eleito`
 * de uma UF tem de fechar em 2, e só fecha se cada reamostra for avaliada
 * inteira, decidindo quem ficou entre os dois primeiros NAQUELE cenário. Compare
 * marginais e a soma dá qualquer coisa. É a mesma razão pela qual
 * `api/model/p_vitoria.py::p_eleito` faz por cenário.
 *
 * O mesmo laço entrega `p_vitoria` (soma 1), `p_passa_2t` (soma 2) e
 * `p_fecha_1t`, porque sai tudo do mesmo conjunto de reamostras — e números
 * tirados de reamostras diferentes se contradiriam entre si na mesma tela.
 */
export function probabilidades(
  rng: Rng,
  shares: readonly number[],
  pctApurado: number,
  vagas: number,
): ResultadoProbabilidades {
  const n = shares.length;
  const sd = shares.map((s) => meiaLarguraIc(s, pctApurado) / 1.96);
  const vit = new Array<number>(n).fill(0);
  const top2 = new Array<number>(n).fill(0);
  const fecha = new Array<number>(n).fill(0);
  const eleito = new Array<number>(n).fill(0);
  const pares = new Map<string, number>();
  let semDecisao = 0;

  for (let it = 0; it < N_RESAMPLES; it++) {
    const amostra = shares.map((s, i) => s + (sd[i] as number) * rng.normal());
    // Desempate por índice ASC: sem ele, duas amostras idênticas (possível com
    // sd 0 em 100% apurado) trocariam de ordem sem critério.
    const idx = amostra
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map((x) => x.i);
    const primeiro = idx[0] as number;
    const segundo = idx.length > 1 ? (idx[1] as number) : primeiro;
    vit[primeiro] = (vit[primeiro] as number) + 1;
    top2[primeiro] = (top2[primeiro] as number) + 1;
    if (idx.length > 1) top2[segundo] = (top2[segundo] as number) + 1;
    for (let k = 0; k < Math.min(vagas, idx.length); k++) {
      const j = idx[k] as number;
      eleito[j] = (eleito[j] as number) + 1;
    }
    if ((amostra[primeiro] as number) >= 50) {
      fecha[primeiro] = (fecha[primeiro] as number) + 1;
    } else {
      semDecisao++;
      const chave = `${primeiro}|${segundo}`;
      pares.set(chave, (pares.get(chave) ?? 0) + 1);
    }
  }

  const paresTop3 = [...pares.entries()]
    .map(([k, c]) => {
      const [a, b] = k.split("|");
      return { par: [Number(a), Number(b)] as [number, number], prob: c / N_RESAMPLES };
    })
    // Desempate por par ASC — duas frequências iguais não podem depender da
    // ordem de inserção no Map.
    .sort((x, y) => y.prob - x.prob || x.par[0] - y.par[0] || x.par[1] - y.par[1])
    .slice(0, 3)
    .map((x) => ({ par: x.par, prob: r4(x.prob) }));

  return {
    pVitoria: vit.map((c) => r4(c / N_RESAMPLES)),
    pTop2: top2.map((c) => r4(c / N_RESAMPLES)),
    pFecha1t: fecha.map((c) => r4(c / N_RESAMPLES)),
    pSegundoTurno: r4(semDecisao / N_RESAMPLES),
    paresTop3,
    pEleito: eleito.map((c) => r4(c / N_RESAMPLES)),
  };
}

/** Posição da agulha a partir das probabilidades do 1º e do 2º. */
export function agulha(pLider: number, pSegundo: number): { pos: number; band: NeedleBand } {
  const pos = r4(Math.max(-1, Math.min(1, pLider - pSegundo)));
  const abs = Math.abs(pos);
  let band: NeedleBand;
  if (abs >= 0.9) band = pos > 0 ? "very_likely_a" : "very_likely_b";
  else if (abs >= 0.6) band = pos > 0 ? "likely_a" : "likely_b";
  else if (abs >= 0.2) band = pos > 0 ? "lean_a" : "lean_b";
  else band = "tossup";
  return { pos, band };
}

// ═════════════════════════════════════════════════════════════════════════════
// Dados de entrada — o que é MEDIDO
// ═════════════════════════════════════════════════════════════════════════════

/** Uma candidatura como o gerador a lê. Recorte explícito, nunca `SELECT *`. */
export interface CandidatoBruto {
  cargo: CargoTse;
  uf: string;
  numero: number;
  nome_urna: string;
  partido_sigla: string;
  partido_numero: number;
  federacao_sigla: string | null;
  /** `bigint` no banco — lido como texto, jamais `Number()` (ADR-0042). */
  sq_candidato: string;
}

/** Um município real, com o eleitorado já agregado sobre as suas zonas. */
export interface MunicipioBruto {
  cod_ibge: string;
  cod_municipio_tse: number;
  uf: string;
  nome: string;
  populacao: number;
  capital: boolean;
  /** `SUM(eleitores_aptos)` do município. `0` quando a tabela não o cobre. */
  aptos: number;
}

export interface EleitoradoUf {
  /** `SUM(eleitores_aptos) GROUP BY uf` — agregado, nunca lido por par. */
  aptos: number;
  /** Fração em [0,1] de aptos que viram voto a candidato. Medida em 2022. */
  comparecimento: number;
  /** Pares (município × zona) da UF — alimenta `participacao.metodo.n_zonas`. */
  pares: number;
  fonte: "medido" | "derivado_2022";
}

export interface DadosSimulacao {
  eleitorado: Readonly<Record<string, EleitoradoUf>>;
  candidatos: readonly CandidatoBruto[];
  /** `lugares_a_preencher` por UF — Σ = 513. */
  cadeirasPorUf: Readonly<Record<string, number>>;
  /** Cadência do cron de Deputado Federal, em minutos (RF-128, design 017 D8). */
  atualizacaoMin: number;
  /** `partidos.numero → partidos.nome`. */
  nomePartido: Readonly<Record<number, string>>;
  /**
   * Sigla → share nacional do partido em 2022 (1º turno, cargos 1 e 3), em
   * 0–100. É o que ordena a lista de cada corrida — ver `candidaturasDaUf`.
   */
  forcaPartido: Readonly<Record<string, number>>;
  /**
   * Sigla → share NACIONAL do partido na eleição de Governador de 2022 (0–100).
   * É a âncora do tamanho das bancadas da Câmara — ver `SQL_FORCA_CAMARA`.
   */
  forcaCamaraNacional: Readonly<Record<string, number>>;
  /** `uf → sigla → share DENTRO daquela UF` em Governador 2022 (0–100). */
  forcaCamaraUf: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * `uf → sigla → razão` entre o share do partido NAQUELA UF e o share dele no
   * país, na eleição PRESIDENCIAL de 2022. É o pendor geográfico medido: PT
   * 1,53 no Piauí e 0,48 em Roraima; PL exatamente ao contrário (1,61 em RR,
   * 0,46 no PI).
   *
   * Substituiu um pendor sorteado por log-normal. O sorteio produzia dispersão,
   * mas dispersão sem geografia: o Nordeste podia sair mais bolsonarista que
   * Santa Catarina, e o dono — que conhece o mapa — leria a tela como defeito.
   * Partido sem votação presidencial em 2022 fica em 1,0 (sem pendor).
   */
  pendorPresUf: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * O menor share nacional estritamente positivo observado em 2022. É o piso
   * das legendas que não existiam (ou não lançaram governador) naquele ano —
   * um número MEDIDO, e não um "0,1% parece razoável".
   */
  pisoForcaCamara: number;
  /** Municípios reais, com eleitorado agregado por `SUM`/`GROUP BY`. */
  municipios: readonly MunicipioBruto[];
  /** O que o gerador teve de contornar. Vai inteiro para o manifest. */
  avisos: readonly string[];
}

/**
 * `lugares_a_preencher` das 27 UFs, lido da fixture do repositório.
 *
 * **Não é digitado aqui de propósito.** O `lugares_a_preencher` de cada UF é
 * dado publicado pelo TSE (RF-124: "NUNCA de constante embutida no código"), e
 * não existe tabela estática dele em `lib/` — só esta fixture. Uma segunda
 * cópia à mão seria a próxima a divergir do resto.
 *
 * ⚠️ **2026-09-19** — o **total nacional** é outra coisa, e não se deriva daqui:
 * ele é fato fixo (513, `api/model/cargos.py::TOTAL_CADEIRAS`), porque a soma
 * das UFs presentes cresce durante a noite. A conferência contra 513 abaixo é a
 * mesma que `deputado_payload.conferir_total_de_cadeiras` faz no ciclo real.
 *
 * A conferência contra 513 é feita aqui, e não só em teste: um arquivo
 * truncado produziria quocientes eleitorais errados em silêncio.
 */
export async function carregarTabelaDeputado(): Promise<{
  cadeirasPorUf: Record<string, number>;
  atualizacaoMin: number;
}> {
  const bruto = await readFile(
    resolve(ROOT, "tests/fixtures/edge-config/dep-current.json"),
    "utf8",
  );
  const j = JSON.parse(bruto) as {
    atualizacao_min?: number;
    por_uf?: Array<{ sigla?: string; lugares_a_preencher?: number }>;
  };
  const out: Record<string, number> = {};
  for (const linha of j.por_uf ?? []) {
    if (typeof linha.sigla === "string" && typeof linha.lugares_a_preencher === "number") {
      out[linha.sigla] = linha.lugares_a_preencher;
    }
  }
  const soma = Object.values(out).reduce((a, b) => a + b, 0);
  if (Object.keys(out).length !== 27 || soma !== 513) {
    throw new Error(
      `Tabela de cadeiras inconsistente: ${Object.keys(out).length} UFs somando ${soma} ` +
        `(esperado 27 UFs somando 513). Fonte: tests/fixtures/edge-config/dep-current.json.`,
    );
  }
  if (typeof j.atualizacao_min !== "number") {
    throw new Error("dep-current.json sem `atualizacao_min` — a cadência é dado, não constante.");
  }
  return { cadeirasPorUf: out, atualizacaoMin: j.atualizacao_min };
}

const SQL_CANDIDATOS = `
  SELECT cargo, uf, numero, nome_urna, partido_sigla, partido_numero,
         federacao_sigla, sq_candidato::text AS sq_candidato
    FROM candidatos
   WHERE ano = $1
     AND publicavel
     AND cargo = ANY($2::int2[])
   ORDER BY cargo, uf, numero, sq_candidato
`;

/** `SUM`/`GROUP BY` explícitos — ver o bloco 3 do cabeçalho. */
const SQL_ELEITORADO = `
  SELECT uf,
         SUM(eleitores_aptos)::bigint AS aptos,
         COUNT(*)::int                AS pares
    FROM eleitorado
   GROUP BY uf
   ORDER BY uf
`;

/**
 * Comparearimento medido: votos a candidato em 2022 (1º turno, Presidente)
 * sobre os aptos de hoje. Sai entre 70,6% e 78,3% conforme a UF.
 *
 * É daqui, e não de `eleitorado.comparecimento_pct_historico`, porque aquela
 * coluna está **NULL nas 6.085 linhas** (medido em 2026-09-14). Ler uma coluna
 * vazia e cair num default de 75% para todo mundo entregaria um mapa com o
 * mesmo comparecimento em Alagoas e no Ceará — e um número inventado
 * disfarçado de medição é pior que um número declaradamente inventado.
 */
const SQL_VOTOS_2022 = `
  SELECT uf, SUM(votos)::bigint AS votos
    FROM historical_results
   WHERE ano = 2022 AND turno = 1 AND cargo = 1
   GROUP BY uf
`;

const SQL_ZONAS = `SELECT uf, COUNT(*)::int AS pares FROM zonas GROUP BY uf`;

const SQL_PARTIDOS = `SELECT numero, nome FROM partidos ORDER BY numero`;

/** Força de cada partido em 2022 — a ordem das listas sai daqui. */
const SQL_FORCA_PARTIDO = `
  SELECT partido, SUM(votos)::bigint AS votos
    FROM historical_results
   WHERE ano = 2022 AND turno = 1 AND cargo IN (1, 3)
   GROUP BY partido
`;

/**
 * Força de cada partido **por UF** na eleição de Governador de 2022 — a âncora
 * do tamanho das bancadas da Câmara.
 *
 * ## Por que Governador, e não Deputado Federal
 *
 * Porque Deputado Federal **não existe** em `historical_results`: a tabela só
 * tem `cargo` 1 e 3 (medido em 2026-09-14). Sem âncora, a primeira versão deste
 * gerador pesava as legendas pelo NÚMERO DE CANDIDATURAS que cada uma lançou no
 * estado — que é um sinal real, mas quase plano: todo partido lança lista cheia.
 * O resultado foram 26 agremiações empatadas em torno de 32 cadeiras, com o
 * NOVO como maior bancada da Câmara. Não é só irreal: apaga a hierarquia que é
 * justamente o que o gráfico de bancada existe para mostrar.
 *
 * Governador de 2022 é a melhor âncora medida disponível: mesma eleição, mesmo
 * eleitorado, e produz a forma certa — poucas legendas grandes e cauda longa
 * (PT 20,5% · PL 13,6% · UNIÃO 11,0% · REPUBLICANOS 10,2% … PCO 0,01%).
 *
 * ⚠️ **Não é proxy perfeito e não deve ser lido como previsão.** O NOVO sai
 * inflado (6,55% nacionais que são, na prática, a votação do Zema em Minas), e
 * voto majoritário concentra em quem tem chance de ganhar, o que o proporcional
 * não faz. É boa o bastante para a FORMA da distribuição, que é o que a tela
 * precisa exercitar, e está declarada no manifest como aproximação.
 *
 * Por UF, e não só nacional, porque a tabela "estado a estado" mostra o líder
 * de cada UF: com âncora só nacional, o mesmo partido lideraria os 27 estados.
 */
const SQL_FORCA_CAMARA = `
  SELECT uf, partido, SUM(votos)::bigint AS votos
    FROM historical_results
   WHERE ano = 2022 AND turno = 1 AND cargo = 3
   GROUP BY uf, partido
`;

/**
 * Municípios + eleitorado agregado POR MUNICÍPIO.
 *
 * ⚠️ `eleitorado` é por par (município × zona): o `SUM`/`GROUP BY` é a
 * diferença entre 158 milhões de eleitores e um número inflado. A junção é
 * `LEFT`, não `INNER`, porque o DF tem município e **não** tem linha de
 * eleitorado — com `INNER` Brasília sumiria do mapa em silêncio, que é
 * exatamente o modo de falha que o gate OT-4 documentou (3.392 municípios
 * invisíveis).
 */
/**
 * Votação presidencial de 2022 por UF e partido — a fonte do pendor geográfico.
 *
 * `ZZ` (exterior) fica de fora: não é unidade federativa e não entra em nenhum
 * dos sete arquivos.
 */
const SQL_PENDOR_PRES = `
  SELECT uf, partido, SUM(votos)::bigint AS votos
    FROM historical_results
   WHERE ano = 2022 AND turno = 1 AND cargo = 1 AND uf <> 'ZZ'
   GROUP BY uf, partido
`;

const SQL_MUNICIPIOS = `
  SELECT m.cod_ibge::text            AS cod_ibge,
         m.cod_municipio_tse,
         m.uf,
         m.nome,
         COALESCE(m.populacao, 0)    AS populacao,
         COALESCE(m.capital, false)  AS capital,
         COALESCE(e.aptos, 0)::bigint AS aptos
    FROM municipios m
    LEFT JOIN (
      SELECT uf, cod_municipio_tse, SUM(eleitores_aptos)::bigint AS aptos
        FROM eleitorado
       GROUP BY uf, cod_municipio_tse
    ) e ON e.uf = m.uf AND e.cod_municipio_tse = m.cod_municipio_tse
   ORDER BY m.uf, m.cod_ibge
`;

/** Cargos que o gerador cobre. Os quatro do produto. */
export const CARGOS_SIMULADOS: readonly CargoTse[] = [1, 3, 5, 6] as const;

export async function carregarDados(): Promise<DadosSimulacao> {
  const pool = getPool();
  const avisos: string[] = [];
  try {
    const [cands, elei, votos22, zonas, parts, forca, muns, forcaCam, pendor] = await Promise.all([
      pool.query(SQL_CANDIDATOS, [ANO_PLEITO, CARGOS_SIMULADOS]),
      pool.query(SQL_ELEITORADO),
      pool.query(SQL_VOTOS_2022),
      pool.query(SQL_ZONAS),
      pool.query(SQL_PARTIDOS),
      pool.query(SQL_FORCA_PARTIDO),
      pool.query(SQL_MUNICIPIOS),
      pool.query(SQL_FORCA_CAMARA),
      pool.query(SQL_PENDOR_PRES),
    ]);

    const aptosPorUf = new Map<string, number>();
    const paresPorUf = new Map<string, number>();
    for (const r of elei.rows as Array<{ uf: string; aptos: string; pares: number }>) {
      aptosPorUf.set(r.uf.trim().toUpperCase(), Number(r.aptos));
      paresPorUf.set(r.uf.trim().toUpperCase(), r.pares);
    }
    const votosPorUf = new Map<string, number>();
    for (const r of votos22.rows as Array<{ uf: string; votos: string }>) {
      votosPorUf.set(r.uf.trim().toUpperCase(), Number(r.votos));
    }
    const zonasPorUf = new Map<string, number>();
    for (const r of zonas.rows as Array<{ uf: string; pares: number }>) {
      zonasPorUf.set(r.uf.trim().toUpperCase(), r.pares);
    }

    // Comparecimento nacional medido — o denominador do contorno do DF abaixo.
    let somaAptos = 0;
    let somaVotos = 0;
    for (const [uf, a] of aptosPorUf) {
      const v = votosPorUf.get(uf);
      if (v === undefined) continue;
      somaAptos += a;
      somaVotos += v;
    }
    const comparecimentoNacional = somaVotos / somaAptos;

    const eleitorado: Record<string, EleitoradoUf> = {};
    for (const uf of UFS) {
      const aptos = aptosPorUf.get(uf);
      const votos = votosPorUf.get(uf);
      if (aptos !== undefined && votos !== undefined) {
        eleitorado[uf] = {
          aptos,
          comparecimento: votos / aptos,
          pares: paresPorUf.get(uf) ?? zonasPorUf.get(uf) ?? 1,
          fonte: "medido",
        };
        continue;
      }
      // ── O DF ──────────────────────────────────────────────────────────────
      // `eleitorado` tem ZERO linhas de DF (medido em 2026-09-14; é o gap
      // registrado desde o fechamento da F1). Mas `historical_results` tem as
      // 950 linhas de 2022, com 1.762.575 votos.
      //
      // Então o DF entra pelo outro lado: o volume de voto dele é FATO medido,
      // e o eleitorado — que só serve de peso na normalização do percentual
      // nacional — é retrodeduzido pelo comparecimento nacional. Inventar um
      // número redondo para o DF, ou deixá-lo de fora das 27, seriam as duas
      // saídas piores: a primeira mente, a segunda apagaria a capital do mapa.
      if (votos !== undefined) {
        eleitorado[uf] = {
          aptos: Math.round(votos / comparecimentoNacional),
          comparecimento: comparecimentoNacional,
          pares: zonasPorUf.get(uf) ?? 1,
          fonte: "derivado_2022",
        };
        avisos.push(
          `${uf}: sem linhas em 'eleitorado'. Eleitorado retrodeduzido de ` +
            `historical_results 2022 (${votos.toLocaleString("pt-BR")} votos ÷ ` +
            `comparecimento nacional ${(comparecimentoNacional * 100).toFixed(1)}%).`,
        );
        continue;
      }
      throw new Error(`Sem eleitorado nem histórico para ${uf} — não dá para ancorar volume.`);
    }

    avisos.push(
      "eleitorado.comparecimento_pct_historico está NULL nas 6.085 linhas; o " +
        "comparecimento por UF foi medido em historical_results 2022/1T/cargo 1.",
    );

    const nomePartido: Record<number, string> = {};
    for (const r of parts.rows as Array<{ numero: number; nome: string }>) {
      nomePartido[r.numero] = r.nome;
    }

    const candidatos = (cands.rows as CandidatoBruto[]).map((r) => ({
      ...r,
      uf: String(r.uf).trim().toUpperCase(),
      partido_sigla: String(r.partido_sigla).trim(),
      nome_urna: String(r.nome_urna).trim(),
    }));

    const forcaLinhas = forca.rows as Array<{ partido: string; votos: string }>;
    const totalForca = forcaLinhas.reduce((a, r) => a + Number(r.votos), 0);
    const forcaPartido: Record<string, number> = {};
    for (const r of forcaLinhas) {
      forcaPartido[r.partido.trim().toUpperCase()] = (100 * Number(r.votos)) / totalForca;
    }

    const municipiosBrutos: MunicipioBruto[] = (
      muns.rows as Array<Omit<MunicipioBruto, "aptos"> & { aptos: string }>
    ).map((m) => ({
      ...m,
      cod_ibge: String(m.cod_ibge).trim(),
      uf: String(m.uf).trim().toUpperCase(),
      nome: String(m.nome).trim(),
      aptos: Number(m.aptos),
    }));

    // 🔴 A malha do IBGE que alimenta a tabela `municipios` inclui corpos
    // d'água como feições próprias (`lib/config/malha-ibge.ts`). Sem este
    // recorte o gerador os trata como município: eles caem no ramo `aptos <= 0`
    // logo abaixo, recebem peso rateado pela população e **ganham voto**.
    //
    // Foi o que o dono viu em 2026-09-19: a Lagoa dos Patos na tela do RS com
    // "100% apurado · LULA · PT · 1 voto · 100,0%". Medido nas três fixtures.
    //
    // Excluir aqui, e não na tela, porque a fixture é lida por teste, por
    // `pnpm dev:sim` e pelo painel municipal — três consumidores que
    // redescobririam a mesma regra, e um deles esqueceria.
    const naoMunicipios = municipiosBrutos.filter((m) => !ehMunicipioDeVerdade(m.cod_ibge));
    const municipios = municipiosBrutos.filter((m) => ehMunicipioDeVerdade(m.cod_ibge));
    if (naoMunicipios.length > 0) {
      avisos.push(
        `${naoMunicipios.length} feição(ões) da malha do IBGE descartada(s) por não ` +
          `ser(em) município: ${naoMunicipios.map((m) => `${m.uf}/${m.nome}`).join(", ")}.`,
      );
    }

    // ⚠️ Este aviso NÃO é sobre corpos d'água — eles já saíram acima. Aqui
    // sobram municípios de VERDADE cujo eleitorado a tabela não tem, e isso é
    // um buraco de dado a investigar, não um recorte a fazer. Em 19/09 os dois
    // nomes eram DF/Brasília e PE/Fernando de Noronha, ambos com eleitor de
    // verdade (Brasília tem ~2 milhões). Manter o aviso separado é o que
    // impede que "não é município" e "faltou dado deste município" voltem a
    // ser lidos como a mesma coisa — foi essa confusão que escondeu as lagoas.
    const semAptos = municipios.filter((m) => m.aptos <= 0);
    if (semAptos.length > 0) {
      avisos.push(
        `${semAptos.length} município(s) sem eleitorado na tabela — peso rateado ` +
          `pela população: ${semAptos.map((m) => `${m.uf}/${m.nome}`).join(", ")}.`,
      );
    }

    // ── âncora das bancadas da Câmara e do pendor presidencial ───────────
    //
    // As duas saem do mesmo molde: share nacional, share dentro da UF, e a
    // razão entre eles. `agruparShares` existe para que os dois cálculos sejam
    // literalmente o mesmo código — duas cópias "equivalentes" é como eles
    // divergiriam em silêncio.
    const agruparShares = (linhas: Array<{ uf: string; partido: string; votos: string }>) => {
      const nacional = new Map<string, number>();
      const porUfBruto = new Map<string, Map<string, number>>();
      let total = 0;
      for (const l of linhas) {
        const sigla = l.partido.trim().toUpperCase();
        const uf = l.uf.trim().toUpperCase();
        const v = Number(l.votos);
        nacional.set(sigla, (nacional.get(sigla) ?? 0) + v);
        total += v;
        let m = porUfBruto.get(uf);
        if (m === undefined) {
          m = new Map<string, number>();
          porUfBruto.set(uf, m);
        }
        m.set(sigla, (m.get(sigla) ?? 0) + v);
      }
      const shareNacional: Record<string, number> = {};
      for (const [k, v] of nacional) shareNacional[k] = (100 * v) / Math.max(1, total);
      const shareUf: Record<string, Record<string, number>> = {};
      for (const [uf, m] of porUfBruto) {
        const t = [...m.values()].reduce((a, b) => a + b, 0);
        const linha: Record<string, number> = {};
        for (const [k, v] of m) linha[k] = (100 * v) / Math.max(1, t);
        shareUf[uf] = linha;
      }
      return { shareNacional, shareUf };
    };

    const cam = agruparShares(
      forcaCam.rows as Array<{ uf: string; partido: string; votos: string }>,
    );
    // Piso MEDIDO — o menor share estritamente positivo que existe no dado —, e
    // não um "0,1% parece razoável". É o que as legendas criadas depois de 2022
    // (AVANTE, DEMOCRATA, MISSÃO, MOBILIZA) recebem.
    const positivos = Object.values(cam.shareNacional).filter((v) => v > 0);
    const pisoForcaCamara = positivos.length > 0 ? Math.min(...positivos) : 0.01;

    const pres = agruparShares(
      pendor.rows as Array<{ uf: string; partido: string; votos: string }>,
    );
    const pendorPresUf: Record<string, Record<string, number>> = {};
    for (const uf of UFS) {
      const linha: Record<string, number> = {};
      for (const [sigla, sUf] of Object.entries(pres.shareUf[uf] ?? {})) {
        const sNac = pres.shareNacional[sigla] ?? 0;
        if (sNac > 0) linha[sigla] = sUf / sNac;
      }
      pendorPresUf[uf] = linha;
    }

    const tabelaDep = await carregarTabelaDeputado();
    return {
      eleitorado,
      candidatos,
      cadeirasPorUf: tabelaDep.cadeirasPorUf,
      atualizacaoMin: tabelaDep.atualizacaoMin,
      nomePartido,
      forcaPartido,
      forcaCamaraNacional: cam.shareNacional,
      forcaCamaraUf: cam.shareUf,
      pisoForcaCamara,
      pendorPresUf,
      municipios,
      avisos,
    };
  } finally {
    await pool.end();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Contexto por UF — o volume de voto, ancorado no eleitorado real
// ═════════════════════════════════════════════════════════════════════════════

export interface ContextoUf {
  uf: string;
  /** % apurado desta UF. **O mesmo número nos quatro cargos** (bloco 5). */
  pctApurado: number;
  eleitores: number;
  /** Fração de aptos que vira voto a candidato, medida em 2022. */
  comparecimento: number;
  pares: number;
  /** Votos a candidato ao FINAL da apuração desta UF. */
  votosFinais: number;
  /** Votos a candidato JÁ apurados. */
  votosApurados: number;
  /** Fração de brancos+nulos sobre o comparecimento. */
  brancosNulos: number;
  fonteEleitorado: "medido" | "derivado_2022";
  /**
   * Spec 022 — a UF pode carregar votos anulados e sub judice POR CANDIDATURA
   * INTEIRA em todos os cargos majoritários? Ver `ufAnulavel`.
   *
   * `false` ⇒ `anulados = sub_judice = 0` nesta UF, nos QUATRO cargos (as
   * contagens desta fixture são as mesmas nos quatro — não se conserta isso
   * aqui). É o preço de não mentir: uma corrida com 2 candidaturas não tem como
   * pôr voto anulado E voto sub judice em candidaturas inteiras e ainda deixar
   * uma válida.
   */
  anulaveis: boolean;
  /**
   * Spec 022 RF-210 — quantos votos cada eleitor dá NESTE cargo. `1` em
   * {@link montarContextos} (Presidente, Governador, Deputado); o Senado de
   * 2026 ganha o seu por {@link ctxDoCargo}, a partir de
   * {@link votosPorEleitorDoCargo}.
   *
   * 🔴 Com `votosPorEleitor = k > 1` os campos de VOTO deste contexto
   * (`votosApurados`, `votosFinais`) estão na escala de `k` votos por eleitor
   * — são o `vvc` do cargo, como no TSE. O comparecimento (PESSOAS) continua
   * saindo de {@link votaveisUmVoto}, a régua de um cargo de um voto só: é o
   * mesmo eleitorado nos quatro cargos.
   */
  votosPorEleitor: number;
  /**
   * Fração de brancos+nulos sobre o TOTAL DE VOTOS (`tv`). Só é lida com
   * `votosPorEleitor > 1` — com um voto por eleitor votos e pessoas coincidem,
   * e a fração é `brancosNulos` (que é o valor posto por `montarContextos`).
   */
  brancosNulosPorVoto: number;
  /**
   * Os votos a candidato de um cargo de UM voto por eleitor — a régua de
   * PESSOAS de onde o comparecimento sai ({@link urnaDaUf}). Com
   * `votosPorEleitor = 1` são `votosApurados`/`votosFinais` do próprio
   * contexto.
   */
  votaveisUmVoto: { apurados: number; finais: number };
  /**
   * ADR-0053 / RF-213 — SÓ no cenário `--anulado-lidera <UF>`, e só nessa UF:
   * a fração dos votáveis (`vvc`) que é voto anulado, no lugar de
   * `PARAMETROS_VOTACAO.anulados`. Ausente em todo o resto (inclusive no
   * default), e aí nada muda. Lida em UM lugar, {@link repartirVotaveis} —
   * contagens e candidaturas continuam saindo da mesma conta.
   *
   * Vale para a UF inteira, nos quatro cargos (o contexto é o mesmo objeto):
   * as contagens de voto dos cargos de um voto por eleitor seguem idênticas
   * entre si, como a invariante (12) exige. Ver {@link aplicarCenarioAnulado}.
   */
  fracaoAnulados?: number;
}

/**
 * Quantas candidaturas uma corrida precisa para carregar as três destinações
 * (spec 022): uma anulada, uma sub judice e pelo menos uma válida.
 */
export const MIN_CANDIDATURAS_PARA_DESTINO = 3;

/**
 * A UF é "anulável" quando TODA corrida majoritária dela (Presidente,
 * Governador, Senador) tem candidaturas bastantes para as três destinações.
 *
 * 🔴 Existe porque o dado real tem corrida pequena: Governador de Alagoas sai
 * com **2** candidaturas do banco (medido em 26/09 em
 * `tests/fixtures/simulacao/governador-uf.json`). Como as contagens desta
 * fixture são as mesmas nos quatro cargos, a UF inteira fica sem anulados —
 * e não uma candidatura válida ganha votos anulados sem ser marcada, que era
 * o defeito que a spec 022 veio consertar.
 */
export function ufAnulavel(dados: DadosSimulacao, uf: string): boolean {
  const n = (cargo: CargoTse, onde: string): number =>
    dados.candidatos.filter((c) => c.cargo === cargo && c.uf === onde).length;
  return (
    n(1, "BR") >= MIN_CANDIDATURAS_PARA_DESTINO &&
    n(3, uf) >= MIN_CANDIDATURAS_PARA_DESTINO &&
    n(5, uf) >= MIN_CANDIDATURAS_PARA_DESTINO
  );
}

export function montarContextos(
  dados: DadosSimulacao,
  pctPorUf: Readonly<Record<string, number>>,
  rng: Rng,
): ContextoUf[] {
  return UFS.map((uf) => {
    const e = dados.eleitorado[uf];
    if (e === undefined) throw new Error(`Sem eleitorado para ${uf}`);
    const pct = pctPorUf[uf] ?? 0;
    const votosFinais = Math.round(e.aptos * e.comparecimento);
    // Jitter por UF com fluxo próprio: acrescentar sorteio noutro cargo não
    // pode mexer nestes números (ver `Rng.derive`).
    const bn = rng.derive(`bn|${uf}`).entre(0.062, 0.089);
    const votosApurados = Math.round((votosFinais * pct) / 100);
    return {
      uf,
      pctApurado: pct,
      eleitores: e.aptos,
      comparecimento: e.comparecimento,
      pares: e.pares,
      votosFinais,
      votosApurados,
      brancosNulos: bn,
      fonteEleitorado: e.fonte,
      anulaveis: ufAnulavel(dados, uf),
      votosPorEleitor: 1,
      brancosNulosPorVoto: bn,
      votaveisUmVoto: { apurados: votosApurados, finais: votosFinais },
    };
  });
}

/**
 * Spec 022 RF-210 — quantos votos cada eleitor dá num cargo. **Fonte única**:
 * `vagasPorUf` de `lib/config/cargos.ts` — a mesma de que sai o `vagas` do
 * payload de UF do Senado e a `composicao_vagas.vagas_por_uf` do nacional.
 * Presidente e Governador elegem 1 (1 voto); o Senado de 2026 renova 2/3,
 * 2 vagas por UF, e cada eleitor vota DUAS vezes (`tv == 2 × c`, medido nas
 * capturas reais `tests/fixtures/tse/2026-sim/senado/`). Deputado Federal é
 * proporcional: um voto só (nominal ou de legenda), apesar das 8–70 cadeiras.
 *
 * Sem `vagasPorUf` num cargo majoritário é erro alto — um default aqui é
 * exatamente o conversor silencioso que já mordeu esta base três vezes.
 */
export function votosPorEleitorDoCargo(cargo: CargoTse): number {
  const info = cargoInfo(cargo);
  if (info.proporcional) return 1;
  if (info.vagasPorUf === null || !Number.isSafeInteger(info.vagasPorUf) || info.vagasPorUf < 1) {
    throw new Error(`[simulacao] cargo ${cargo}: vagasPorUf ${String(info.vagasPorUf)} inválido`);
  }
  return info.vagasPorUf;
}

/**
 * Faixa MEDIDA de brancos+nulos sobre o total de votos (`(vb + tvn) / tv`) no
 * Senado, nas quatro capturas reais do simulado do TSE a 100% apurado
 * (`tests/fixtures/tse/2026-sim/senado/{df,ac,sp,rs}-c0005-e021272-u.json`):
 * DF 5,91% · SP 6,80% · RS 7,51% · AC 7,57%. Brancos e nulos ficam ~meio a
 * meio (49,6–52,0%), dentro do `brancosDoPar` de 50,21% medido no
 * Presidente — por isso a repartição do par reusa {@link PARAMETROS_VOTACAO}.
 *
 * Não é o dobro dos brancos+nulos do Presidente: num voto de duas vagas o
 * eleitor pode dar um voto válido e um branco, e a taxa por VOTO é própria.
 */
export const BRANCOS_NULOS_POR_VOTO_SENADO = { min: 0.0591, max: 0.0757 } as const;

/**
 * O contexto de UMA UF no cargo pedido. Cargo de um voto por eleitor devolve
 * o MESMO objeto (Presidente, Governador e Deputado não mudam em nada).
 *
 * Com `k = votosPorEleitorDoCargo(cargo) > 1` (o Senado): mesmo eleitorado,
 * mesmo `pctApurado`, mesmo comparecimento em pessoas — e `votosApurados` /
 * `votosFinais` passam a ser os votos a candidato do cargo (`vvc`), na escala
 * de `k` votos por eleitor, por {@link urnaDaUf}. Brancos+nulos por voto
 * sorteados por UF na faixa medida ({@link BRANCOS_NULOS_POR_VOTO_SENADO}),
 * com fluxo próprio (`rng.derive`), para não mexer em nenhum outro número.
 */
export function ctxDoCargo(ctx: ContextoUf, cargo: CargoTse, rng: Rng): ContextoUf {
  const k = votosPorEleitorDoCargo(cargo);
  if (k === 1) return ctx;
  const { min, max } = BRANCOS_NULOS_POR_VOTO_SENADO;
  const semVotos: ContextoUf = {
    ...ctx,
    votosPorEleitor: k,
    brancosNulosPorVoto: rng.derive(`bnVoto|${ctx.uf}`).entre(min, max),
    votaveisUmVoto: { ...ctx.votaveisUmVoto },
  };
  return {
    ...semVotos,
    votosApurados: urnaDaUf(semVotos, "apurado").votaveis,
    votosFinais: urnaDaUf(semVotos, "final").votaveis,
  };
}

/**
 * Constrói o bloco de participação de uma circunscrição.
 *
 * A abstenção é **derivada**, não sorteada: se o comparecimento medido diz que
 * 74,6% dos aptos de SP viram voto a candidato, e brancos+nulos são 7,4% de
 * quem compareceu, então quem compareceu foi 74,6/(1−0,074) = 80,6% e a
 * abstenção é 19,4%. Sortear os três independentemente produziria uma
 * identidade que não fecha — e a identidade `candidatos + outros + brancos +
 * nulos = comparecimento` está escrita no tipo (`EdgeParticipacao`), é
 * exatamente o tipo de coisa que o leitor soma na tela.
 */
function blocoParticipacao(
  ctxs: readonly ContextoUf[],
  pctApurado: number,
  nZonas: number,
  outros?: { pct: number; n: number },
): NonNullable<EdgeNational["participacao"]> {
  const aptos = ctxs.reduce((a, c) => a + c.eleitores, 0);
  const votaveis = ctxs.reduce((a, c) => a + c.votosFinais, 0);
  const bnFrac =
    ctxs.reduce((a, c) => a + c.votosFinais * c.brancosNulos, 0) / Math.max(1, votaveis);
  const compareceram = votaveis / (1 - bnFrac);
  const abstPct = 100 * (1 - compareceram / Math.max(1, aptos));
  const bnPct = 100 * bnFrac;
  // Meia-largura estreita: participação é medida sobre MUITO mais unidades que
  // o share de um candidato, então o IC dela é naturalmente mais apertado.
  const hwA = meiaLarguraIc(abstPct, pctApurado) * 0.45;
  const hwB = meiaLarguraIc(bnPct, pctApurado) * 0.45;
  const bloco: NonNullable<EdgeNational["participacao"]> = {
    abstencao: {
      pct_atual: pctApurado > 0 ? r1(abstPct * 0.965) : null,
      pct_projetado: r1(abstPct),
      lower: r1(abstPct - hwA),
      upper: r1(abstPct + hwA),
      base: "eleitores_instalados",
    },
    brancos_nulos: {
      pct_atual: pctApurado > 0 ? r1(bnPct * 0.972) : null,
      pct_projetado: r1(bnPct),
      lower: r1(bnPct - hwB),
      upper: r1(bnPct + hwB),
      base: "comparecimento",
    },
    metodo: {
      tipo: "extrapolacao_apurado",
      n_zonas: nZonas,
      pct_apurado: r1(pctApurado),
    },
  };
  if (outros !== undefined) {
    const hwO = meiaLarguraIc(outros.pct, pctApurado) * 0.8;
    bloco.outros = {
      pct_atual: pctApurado > 0 ? r1(outros.pct * 0.99) : null,
      pct_projetado: r1(outros.pct),
      lower: r1(Math.max(0, outros.pct - hwO)),
      upper: r1(outros.pct + hwO),
      base: "votaveis",
      n_candidatos: outros.n,
    };
  }
  return bloco;
}

// ═════════════════════════════════════════════════════════════════════════════
// Votação — as contagens absolutas do eleitorado (spec 021, RF-199 + RF-195)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * As três coisas que o modelo de votos deste gerador **não tem** e que o dado
 * real do TSE tem. Sem elas o simulado seria mais POBRE que produção, e o
 * painel "Votação" exibiria no `pnpm dev:sim` um estado que a noite real nunca
 * produz — a armadilha que esta base já pagou duas vezes.
 *
 * O modelo do gerador é `comparecimento = votáveis + brancos + nulos`, com
 * `instalados == aptos` e `validos == votáveis`. Faltam, portanto: a repartição
 * do par brancos+nulos, os votos anulados/sub judice (que saem de DENTRO dos
 * votáveis, `vvc = vv + van + vansj`) e as seções que nunca instalam.
 *
 * Os defaults são MEDIDOS na captura do simulado oficial do TSE a 100% apurado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`) e reconferidos aqui
 * campo a campo contra as identidades do dicionário EA20
 * (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`):
 * `c + a = esi` ✓, `tv = c` ✓, `vvc = vv + van + vansj` ✓,
 * `vv + vb + tvn + van + vansj = tv` ✓.
 *
 * | o que | medido | de onde |
 * |---|---|---|
 * | seções nunca instaladas | 267 de 163.079.139 = 1,6372e-6 | `(te − esi) / te` |
 * | anulados | 7,6376% dos votáveis | `van / vvc` |
 * | sub judice | 8,7019% dos votáveis | `vansj / vvc` |
 * | brancos no par brancos+nulos | 50,2133% | `vb / (vb + tvn)` |
 *
 * 🔴 **Por que nenhum deles pode ser zero.** `anulados + sub_judice` são
 * **14,2% do comparecimento** no dado real — é exatamente o buraco que as
 * quatro fatias nomeadas do círculo 1 deixam de fora (RF-197). Zerá-los faria
 * as quatro fecharem no comparecimento, e o simulado nunca exercitaria o caso
 * que a spec 021 existe para representar. O mesmo vale para as seções não
 * instaladas: com `instalados == aptos` o residual do círculo 1 seria zero no
 * fim da noite, quando a verdade é que ele **estaciona** no tamanho dos votos
 * anulados (RF-195).
 *
 * ⚠️ O par brancos+nulos deste gerador vale 6,2–8,9% do comparecimento
 * (`montarContextos`), contra 13,08% medidos na captura real. Essa diferença é
 * ANTERIOR a esta spec — ela vem de `ContextoUf.brancosNulos`, que alimenta o
 * `participacao` já publicado — e mexer nela reescreveria números de outras
 * telas. Fica registrada, fora de escopo.
 */
export interface ParametrosVotacao {
  /** Fração de `aptos` em seções que nunca são instaladas: `(te − esi) / te`. */
  naoInstaladas: number;
  /** `van` como fração dos votáveis (`vvc`). */
  anulados: number;
  /** `vansj` como fração dos votáveis (`vvc`). */
  subJudice: number;
  /** `vb / (vb + tvn)` — como o par brancos+nulos do gerador se reparte. */
  brancosDoPar: number;
}

/** Os quatro parâmetros medidos. Exportados para o teste usar os MESMOS. */
export const PARAMETROS_VOTACAO: ParametrosVotacao = {
  naoInstaladas: 1.6372e-6,
  anulados: 0.076376,
  subJudice: 0.087019,
  brancosDoPar: 0.502133,
};

/**
 * Os votáveis apurados da UF (`vvc`) repartidos pela destinação do voto:
 * `vvc = vv + van + vansj`.
 *
 * 🔴 **Ponto ÚNICO desta conta** (spec 022). As contagens (`contagensDaUf`) e
 * a repartição dos votos entre as candidaturas (`resolverCorridaUf`) leem
 * daqui — é o que faz Σ votos das candidaturas `valido` == `validos` (e o
 * mesmo para anulado e sub judice) valer por CONSTRUÇÃO, como no TSE, em vez
 * de por tolerância. Duas cópias da conta divergiriam no arredondamento.
 *
 * `votaveis` é o apurado por padrão; com `ctx.votosFinais` é o FIM DE NOITE
 * — a mesma conta aplicada ao total que as candidaturas projetam (ver
 * `resolverCorridaUf`). A 100% os dois coincidem, e é por isso que a projeção
 * reencontra o contado na unidade.
 */
export function repartirVotaveis(
  ctx: ContextoUf,
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
  votaveis: number = ctx.votosApurados,
): { validos: number; anulados: number; subJudice: number } {
  const fracaoAnulados = ctx.fracaoAnulados === undefined ? par.anulados : ctx.fracaoAnulados;
  const anulados = ctx.anulaveis ? Math.round(votaveis * fracaoAnulados) : 0;
  const subJudice = ctx.anulaveis ? Math.round(votaveis * par.subJudice) : 0;
  return { validos: votaveis - anulados - subJudice, anulados, subJudice };
}

/**
 * O que sai da urna de UMA UF num instante, **na unidade do cargo**:
 * `comparecimento` em PESSOAS; `votaveis` (o `vvc`), `brancos` e `nulos` em
 * VOTOS. Ponto ÚNICO da conta (spec 022 RF-210): {@link contagensDaUf}, o fim
 * de noite ({@link fimDeNoiteDaCorrida}) e os `votosApurados`/`votosFinais`
 * do contexto de Senado ({@link ctxDoCargo}) saem daqui.
 *
 * O comparecimento sai SEMPRE da régua de um voto por eleitor
 * (`ctx.votaveisUmVoto`, com `ctx.brancosNulos` sobre o comparecimento) — é o
 * mesmo eleitorado nos quatro cargos:
 *
 *     bn1 = round(votaveis1 × bn / (1 − bn));  comparecimento = votaveis1 + bn1
 *
 * Com `k = ctx.votosPorEleitor`:
 *
 *   - `k = 1`: `votaveis = votaveis1`, e o par brancos+nulos é `bn1` — a conta
 *     de sempre, byte a byte;
 *   - `k > 1` (o Senado): o total de votos é `tv = k × comparecimento` EXATO
 *     (medido nas capturas reais: `tv == 2 × c` nas 4 UFs), brancos+nulos
 *     são `round(tv × ctx.brancosNulosPorVoto)` e `votaveis = tv − brancos −
 *     nulos`. Nunca "dividir os votos por k": não existe meio eleitor.
 *
 * Em qualquer `k`: `votaveis + brancos + nulos == k × comparecimento`, exato
 * em inteiro, por construção.
 */
export function urnaDaUf(
  ctx: ContextoUf,
  instante: "apurado" | "final",
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): { comparecimento: number; votaveis: number; brancos: number; nulos: number } {
  const k = ctx.votosPorEleitor;
  if (!Number.isSafeInteger(k) || k < 1) {
    throw new Error(`[simulacao] ${ctx.uf}: votosPorEleitor ${k} não é inteiro ≥ 1`);
  }
  const votaveis1 =
    instante === "apurado" ? ctx.votaveisUmVoto.apurados : ctx.votaveisUmVoto.finais;
  // brancos+nulos tal que a fração SOBRE O COMPARECIMENTO seja exatamente
  // `ctx.brancosNulos` — a mesma base que `blocoParticipacao` declara.
  const bn1 = Math.round((votaveis1 * ctx.brancosNulos) / (1 - ctx.brancosNulos));
  const comparecimento = votaveis1 + bn1;
  const bnTotal = k === 1 ? bn1 : Math.round(k * comparecimento * ctx.brancosNulosPorVoto);
  const brancos = Math.round(bnTotal * par.brancosDoPar);
  return {
    comparecimento,
    votaveis: k * comparecimento - bnTotal,
    brancos,
    nulos: bnTotal - brancos,
  };
}

/**
 * As 9 contagens de UMA UF no instante `ctx.pctApurado`.
 *
 * 🔴 **Toda identidade sai por SOMA ou SUBTRAÇÃO de inteiros.** O consumidor
 * deriva o residual do círculo 1 subtraindo (RF-193), então um vão de
 * arredondamento apareceria na tela como fatia que não fecha.
 *
 * ⚠️ Medido, para não sobrar crédito onde não há: as DUAS identidades valem por
 * construção porque `comparecimento` é montado a partir das mesmas parcelas que
 * a soma confere — não porque a subtração conserte arredondamento. Trocar
 * `nulos = bnTotal − brancos` por um segundo `Math.round`, ou `comparecimento =
 * votaveis + brancos + nulos` por `Math.round(votaveis / (1 − bn))`, produz
 * saída BYTE A BYTE IDÊNTICA nos quatro cargos a 0%, 0,08%, 25% e 100%
 * (conferido em 26/09): `votaveis` é inteiro, logo
 * `round(votaveis + f) = votaveis + round(f)`. A subtração fica porque garante
 * `brancos + nulos == bnTotal` na fronteira do 0,5 — não porque um teste
 * discrimine as duas formas, e nenhum discrimina.
 *
 * Senado (spec 022 RF-210, `ctx.votosPorEleitor = k > 1`): `aptos`,
 * `instalados`, `comparecimento` e `abstencao` em PESSOAS, iguais aos dos
 * outros cargos; `validos + brancos + nulos + anulados + sub_judice == k ×
 * comparecimento`, exato — ver {@link urnaDaUf}.
 */
function contagensDaUf(
  ctx: ContextoUf,
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacaoContagens {
  const aptos = ctx.eleitores;
  // `votaveis` é voto A CANDIDATO já contado, isto é `vvc` do EA20 e não
  // `vv`: anulados e sub judice saem de DENTRO dele (`vvc = vv + van + vansj`),
  // nunca por cima. Somá-los por cima inflaria o comparecimento e faria a
  // abstenção deste bloco contradizer o `pct_projetado` que
  // `blocoParticipacao` publica na mesma tela (19,4% viraria ~6%).
  const urna = urnaDaUf(ctx, "apurado", par);
  if (urna.votaveis !== ctx.votosApurados) {
    // O contexto guarda os votáveis do cargo como cache (`ctxDoCargo`); as
    // candidaturas foram repartidas sobre ELE. Divergir aqui é a corrida e as
    // contagens contando votos diferentes.
    throw new Error(
      `[simulacao] ${ctx.uf}: votáveis da urna ${urna.votaveis} ≠ votosApurados do contexto ` +
        `${ctx.votosApurados} (votosPorEleitor ${ctx.votosPorEleitor})`,
    );
  }
  const { comparecimento, brancos, nulos } = urna;
  const { validos, anulados, subJudice } = repartirVotaveis(ctx, par, urna.votaveis);
  // `esi` CRESCE com a apuração: uma seção só entra em `est` — e portanto em
  // `esi` — quando o boletim dela é totalizado. É daí que vem o tamanho do vão
  // do círculo 1 durante a noite (o país ainda não contado), encolhendo até o
  // resíduo permanente das seções que nunca instalam.
  const instalados = Math.round((aptos * ctx.pctApurado * (1 - par.naoInstaladas)) / 100);
  if (instalados < comparecimento) {
    // Sem clamp de propósito: `Math.max` aqui zeraria a abstenção em silêncio,
    // e o que o clamp esconderia é uma contradição real entre o comparecimento
    // contado de baixo para cima (votos) e o eleitorado instalado derivado de
    // cima para baixo (pct). Só é alcançável com `eleitorado.comparecimento`
    // acima de ~92%, que não existe no cadastro — se aparecer, o dono precisa
    // ver, não ter o número consertado por baixo do pano.
    throw new Error(
      `[simulacao] ${ctx.uf}: comparecimento ${comparecimento} > instalados ${instalados} ` +
        `(pctApurado ${ctx.pctApurado}, comparecimento medido ${ctx.comparecimento}). ` +
        `A identidade 'comparecimento + abstencao = instalados' do EA20 não fecha.`,
    );
  }
  return {
    aptos,
    instalados,
    comparecimento,
    abstencao: instalados - comparecimento,
    validos,
    brancos,
    nulos,
    anulados,
    sub_judice: subJudice,
  };
}

/**
 * As contagens NACIONAIS: a soma dos 27 agregados de UF.
 *
 * Mesma escolha do produtor real (`somar_contagens_agregadas`,
 * `api/model/project.py:3719`): nível `"br"` só existe para cargo 1
 * (`lib/tse/targets.ts:59`), e nos outros três o nacional é a soma dos 27
 * agregados — soma de contagens inteiras, exata, sem projeção. Para o cargo 1
 * os dois caminhos dão o MESMO número por identidade, então aqui existe **um
 * só**: um segundo caminho paralelo seria uma chance de os dois divergirem
 * sem ninguém ver.
 */
export function contagensVotacao(
  ctxs: readonly ContextoUf[],
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacaoContagens {
  const total: EdgeVotacaoContagens = {
    aptos: 0,
    instalados: 0,
    comparecimento: 0,
    abstencao: 0,
    validos: 0,
    brancos: 0,
    nulos: 0,
    anulados: 0,
    sub_judice: 0,
  };
  const chaves = Object.keys(total) as Array<keyof EdgeVotacaoContagens>;
  for (const ctx of ctxs) {
    const c = contagensDaUf(ctx, par);
    for (const k of chaves) total[k] += c[k];
  }
  return total;
}

/**
 * As quatro fatias do círculo 3 (RF-195), em CONTAGEM ABSOLUTA e **cruas**.
 *
 * ⚠️ Desde 2026-09-27 só o Deputado (cargo 6) projeta por aqui. Os cargos com
 * corrida (1, 3, 5) projetam por {@link fimDeNoiteDaCorrida}, para que a
 * `projetada` e os `votos_projetados` das candidaturas sejam o mesmo fim de
 * noite.
 *
 * Espelha `projetar_fatias_em_contagens` (`api/model/project.py:3827`):
 *   - a abstenção projeta sobre `instalados`, e no fim da noite
 *     `instalados → aptos`, logo `abstencao = p_abstencao × aptos`;
 *   - válidos/brancos/nulos projetam sobre o comparecimento, e o comparecimento
 *     do fim da noite é `aptos − abstencao`.
 *
 * 🔴 **Nenhuma reescala.** As quatro NÃO fecham em `aptos`, e o vão não é ruído
 * de bootstrap: é voto anulado, e voto anulado não projeta para zero. O
 * consumidor deriva o cinza por subtração, a mesma regra do círculo 1.
 *
 * ⚠️ Divergência deliberada do produtor real: o Python lê `pct_projetado`, que
 * é o percentual JÁ ARREDONDADO a 1 casa que `participacao` publica; aqui as
 * frações vêm cruas das mesmas quantidades que `blocoParticipacao` usa. Meia
 * casa decimal sobre 163 milhões de aptos valeria ±81 mil votos — e dois
 * cargos deste gerador (5 e 6) nem publicam `participacao`, então não haveria
 * de onde ler o número arredondado.
 *
 * Devolve `null` quando não há base amostral (nenhuma UF com apuração) — o
 * círculo 3 vai INTEIRO para "aguardando projeção", no DOM
 * (RF-195, ADR-0017/ADR-0018). `projetada` ausente é o que produz esse estado.
 */
export function projetarVotacao(
  ctxs: readonly ContextoUf[],
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacaoProjetada | null {
  if (!ctxs.some((c) => c.pctApurado > 0)) return null;
  const aptos = ctxs.reduce((a, c) => a + c.eleitores, 0);
  const votaveisFinais = ctxs.reduce((a, c) => a + c.votosFinais, 0);
  if (aptos <= 0 || votaveisFinais <= 0) return null;
  const bnFrac = ctxs.reduce((a, c) => a + c.votosFinais * c.brancosNulos, 0) / votaveisFinais;
  const compareceram = votaveisFinais / (1 - bnFrac);
  const abstencao = Math.round(aptos - compareceram);
  const comparecimento = aptos - abstencao;
  if (comparecimento < 0) return null;
  // `validos` é a fatia dos votáveis que sobra depois de anulados e sub judice
  // — a mesma hierarquia de `contagensDaUf`, para que as duas pontas do painel
  // (contado e projetado) não usem definições diferentes de "válido".
  const pValidos = (1 - bnFrac) * (1 - par.anulados - par.subJudice);
  return {
    validos: Math.round(pValidos * comparecimento),
    brancos: Math.round(bnFrac * par.brancosDoPar * comparecimento),
    nulos: Math.round(bnFrac * (1 - par.brancosDoPar) * comparecimento),
    abstencao,
  };
}

/**
 * O bloco `votacao` de um payload nacional (spec 021) — desde 2026-09-27 só
 * o de Deputado (cargo 6), que não tem corrida. Os cargos 1, 3 e 5 projetam
 * pela corrida, em {@link blocoVotacaoDaCorrida}; as contagens são as mesmas.
 *
 * `contagens` está SEMPRE presente, porque no simulado — como em produção — o
 * `aptos` chega no mesmo envelope que todo o resto: `e.te` é conhecido antes do
 * primeiro boletim. Com `--pct 0` isso publica de propósito o estado **"não
 * começou"** (RF-193b): `aptos > 0` e as quatro fatias em zero, que a tela
 * desenha como círculo 100% cinza.
 *
 * ⚠️ O terceiro estado — bloco AUSENTE, "não sabemos", `<DetailUnavailable>`
 * (RF-198) — não é alcançável por este gerador, e é de propósito: ele é o
 * estado de quem não recebeu nada do TSE, e o simulado sempre tem o cadastro
 * de eleitorado em mão. Quem precisar dele na tela usa uma fixture anterior à
 * spec 021, que não tem a chave.
 */
export function blocoVotacao(
  ctxs: readonly ContextoUf[],
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacao {
  const bloco: EdgeVotacao = { contagens: contagensVotacao(ctxs, par) };
  const projetada = projetarVotacao(ctxs, par);
  if (projetada !== null) bloco.projetada = projetada;
  return bloco;
}

/**
 * O fim de noite de UMA corrida de UF, lido dos votos PROJETADOS das
 * candidaturas — a `projetada` dos cargos com corrida (1, 3 e 5).
 *
 * 🔴 **Decisão do dono (2026-09-27): as duas projeções saem do MESMO fim de
 * noite.** O modelo real projeta o fim da noite por dois caminhos — Σ
 * `votos_projetados` das candidaturas e a participação projetada — e no replay
 * 2022 eles concordam em 0,02% (spec 022 RF-212). Este gerador inventava os
 * dois separadamente (`projetarVotacao` pela participação, `resolverCorridaUf`
 * pelo perfil), e na tela do `dev:sim` o círculo de projeção da corrida
 * discordava da lista de candidaturas em 7–15%. Aqui só existe um:
 *
 *   - `validos` = Σ `votos_projetados` das candidaturas `valido` — EXATO;
 *   - `brancos + nulos` sobre o comparecimento do fim de noite, com a MESMA
 *     conta de {@link contagensDaUf} (`votaveis × bn / (1 − bn)`, depois a
 *     subtração), sobre `votaveis = Σ votos_projetados` de TODAS as
 *     candidaturas (`== ctx.votosFinais`, invariante 2);
 *   - `abstencao = aptos − comparecimento`, sem clamp.
 *
 * Consequência por construção: o residual do círculo 3
 * (`aptos − validos − brancos − nulos − abstencao`) é EXATAMENTE Σ
 * `votos_projetados` das candidaturas `anulado` e `sub_judice`. E a 100%
 * apurado as quatro reencontram o contado — `validos` e `brancos`/`nulos` na
 * unidade, `abstencao` a menos das seções nunca instaladas.
 *
 * Senado (spec 022 RF-210, `k = ctx.votosPorEleitor = 2`): `validos`,
 * `brancos` e `nulos` em VOTOS, `abstencao` em PESSOAS — a divisão de
 * unidades de `fatiasCirculo3(c, p, k)`. O residual do círculo 3 passa a ser
 * `k × aptos − (validos + brancos + nulos + k × abstencao)`, e continua
 * EXATAMENTE Σ `votos_projetados` das `anulado` e `sub_judice`, porque o
 * total de votos do fim de noite é `k × comparecimento` ({@link urnaDaUf}).
 *
 * Deputado (cargo 6) não tem corrida e segue em {@link projetarVotacao}.
 */
export function fimDeNoiteDaCorrida(
  c: CorridaUf,
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacaoProjetada {
  let votaveis = 0;
  let validos = 0;
  for (const r of c.resultados) {
    votaveis += r.votosProjetados;
    if (r.destino === "valido") validos += r.votosProjetados;
  }
  // Brancos, nulos e o comparecimento do fim de noite pela MESMA conta das
  // contagens ({@link urnaDaUf}) — em PESSOAS o comparecimento, em VOTOS o
  // resto (Senado, RF-210). Os votáveis dela são Σ `votos_projetados` de
  // TODAS as candidaturas por construção (`resolverCorridaUf`); divergir é
  // um segundo fim de noite reaparecendo.
  const urna = urnaDaUf(c.ctx, "final", par);
  if (urna.votaveis !== votaveis) {
    throw new Error(
      `[simulacao] ${c.ctx.uf}: Σ votos_projetados ${votaveis} ≠ votáveis do fim de noite ` +
        `${urna.votaveis} — as candidaturas e a urna projetam noites diferentes.`,
    );
  }
  const { brancos, nulos } = urna;
  const abstencao = c.ctx.eleitores - urna.comparecimento;
  if (abstencao < 0) {
    // Sem clamp, pela mesma razão de `contagensDaUf`: o que o clamp esconderia
    // é uma contradição real entre o comparecimento e o eleitorado.
    throw new Error(
      `[simulacao] ${c.ctx.uf}: comparecimento projetado ${urna.comparecimento} > aptos ` +
        `${c.ctx.eleitores} — o fim de noite não cabe no eleitorado.`,
    );
  }
  return { validos, brancos, nulos, abstencao };
}

/**
 * A `projetada` de uma abrangência com corrida: a SOMA dos fins de noite das
 * UFs dela ({@link fimDeNoiteDaCorrida}). Nacional = Σ das 27, como os
 * `votos_projetados` nacionais do Presidente (`montarPresidente`) — soma de
 * inteiros, exata.
 *
 * UF a 0% entra na soma nacional (os votos projetados dela entram na lista
 * nacional do Presidente também); `null` só quando NENHUMA UF apurou (RF-195).
 */
export function projetarVotacaoDaCorrida(
  corridas: readonly CorridaUf[],
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacaoProjetada | null {
  if (!corridas.some((c) => c.ctx.pctApurado > 0)) return null;
  const total: EdgeVotacaoProjetada = { validos: 0, brancos: 0, nulos: 0, abstencao: 0 };
  for (const c of corridas) {
    const f = fimDeNoiteDaCorrida(c, par);
    total.validos += f.validos;
    total.brancos += f.brancos;
    total.nulos += f.nulos;
    total.abstencao += f.abstencao;
  }
  return total;
}

/**
 * O bloco `votacao` de uma abrangência com corrida (cargos 1, 3 e 5):
 * contagens pela mesma {@link contagensVotacao} de todo mundo, projeção pela
 * corrida ({@link projetarVotacaoDaCorrida}).
 */
export function blocoVotacaoDaCorrida(
  corridas: readonly CorridaUf[],
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeVotacao {
  const bloco: EdgeVotacao = {
    contagens: contagensVotacao(
      corridas.map((c) => c.ctx),
      par,
    ),
  };
  const projetada = projetarVotacaoDaCorrida(corridas, par);
  if (projetada !== null) bloco.projetada = projetada;
  return bloco;
}

// ═════════════════════════════════════════════════════════════════════════════
// Spec 022 — a corrida em três círculos (RF-209)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `EdgeCorridaEntrada[]` de uma corrida de UF — o que o agregado da UF do TSE
 * traria: uma entrada por candidatura, `votos` = apurado, ordem por `id`.
 *
 * `destino` AUSENTE com a UF a 0% apurado: o TSE só publica `dvt` "após a
 * primeira totalização parcial". Com todo voto em zero isso não pende nada
 * (RF-207), e a fixture passa a exercitar a entrada sem destino de graça.
 *
 * `id` é o mesmo `id` de `candidatos[]` do payload (o número na urna no
 * Presidente, o sequencial por UF nos outros dois — bloco 7(a)): é a chave
 * que a tela usa para achar o nome.
 */
export function corridaDaUf(c: CorridaUf): EdgeCorridaEntrada[] {
  const publicado = destinoPublicadoNaUf(c);
  return [...c.resultados]
    .sort((a, b) => a.cand.id - b.cand.id)
    .map((r) => ({
      id: r.cand.id,
      partido: r.cand.partido,
      votos: r.votosAtuais,
      ...(publicado ? { destino: r.destino } : {}),
    }));
}

/**
 * O TSE já publicou a destinação (`dvt`) desta corrida DE UF? Só "após a
 * primeira totalização parcial" — aqui, UF com apuração > 0. É o ponto ÚNICO
 * da regra para Governador e Senador: a `corrida` da UF ({@link corridaDaUf}),
 * o `destino` das listas de candidaturas e o filtro de quem compete
 * ({@link competidores}) leem daqui, e por isso não têm como divergir.
 */
function destinoPublicadoNaUf(c: CorridaUf): boolean {
  return c.ctx.pctApurado > 0;
}

/**
 * O mesmo para o Presidente, cuja destinação é NACIONAL (a do arquivo `br`):
 * publicada assim que QUALQUER UF apurou, e aplicada em toda UF — o produtor
 * faz igual ("Presidente decide com o destino NACIONAL em toda UF",
 * `api/model/project.py`). Ponto único de {@link corridaNacionalPresidente}.
 */
function destinoPublicadoNoPais(corridas: readonly CorridaUf[]): boolean {
  return corridas.some((c) => c.ctx.pctApurado > 0);
}

/**
 * ADR-0053 / RF-213 — quem DISPUTA a corrida: as candidaturas cujo destino
 * publicado não é `"anulado"`, na ordem de `resultados` (rank por projetado).
 * "Anulado sub judice" compete (segue o TSE). Destino não publicado ⇒ todas
 * competem — degradação segura do ADR, nunca "desconhecido ⇒ anulado".
 *
 * É daqui que saem líder, margem, agulha, vagas e cor do mapa; a LISTA
 * publicada continua com todas (a tela põe a anulada no fim, com etiqueta).
 */
function competidores(
  resultados: readonly ResultadoCandUf[],
  destinoPublicado: boolean,
): ResultadoCandUf[] {
  return destinoPublicado ? resultados.filter((r) => r.destino !== "anulado") : [...resultados];
}

/**
 * `destino` de uma candidatura nas três LISTAS (`national.candidatos`,
 * `por_uf[].top_candidatos`, `EdgePayloadUf.candidatos`) — espelho de
 * `AnuladosNaDecisao.destino_de` do produtor: `{ destino }` SÓ quando a
 * destinação já foi publicada (RF-209) E é `"anulado"` ou `"sub_judice"`.
 * `"valido"` nunca é emitido aqui (2026-09-27): para a tela equivale a
 * ausente, e custava 19 B por candidatura — derrubava a folga de 2× do
 * payload nacional (`tests/unit/edge-config/limiar-nacional.test.ts`).
 * `votacao.corrida[]` ({@link corridaDaUf}) NÃO usa isto: lá `"valido"`
 * precisa se distinguir de "ainda não publicado".
 */
function destinoNaLista(
  destino: EdgeDestinoVoto,
  destinoPublicado: boolean,
): { destino?: EdgeDestinoVoto } {
  return destinoPublicado && destino !== "valido" ? { destino } : {};
}

/** {@link destinoNaLista} de um resultado de UF. */
function campoDestino(
  r: ResultadoCandUf,
  destinoPublicado: boolean,
): { destino?: EdgeDestinoVoto } {
  return destinoNaLista(r.destino, destinoPublicado);
}

/** `true` se alguma entrada com voto está sem destino — espelho do produtor. */
function corridaPendente(corrida: readonly EdgeCorridaEntrada[]): boolean {
  return corrida.some((e) => e.votos > 0 && e.destino === undefined);
}

/**
 * O `votacao` de um `EdgePayloadUf` de cargo 1, 3 ou 5 (spec 022 RF-209 +
 * spec 021 RF-192 emendado em 2026-09-26, noite).
 *
 * `contagens` e `projetada` saem de {@link blocoVotacaoDaCorrida} sobre UMA
 * UF — a MESMA função do nacional, aplicada à corrida da UF. Um segundo
 * caminho de projeção só para UF seria uma chance de a tela de UF e a capa
 * divergirem sem ninguém ver; e a soma das 27 `projetada` de UF é, por
 * construção, a `projetada` nacional (quando as 27 apuraram).
 *
 * ⚠️ Divergência deliberada do produtor real desde 2026-09-27: lá
 * (`build_votacao_uf_payloads`, `api/model/project.py`) a `projetada` sai da
 * participação DA UF, e a Σ das candidaturas só CONCORDA com ela (0,02%–0,16%
 * no replay 2022). Aqui as duas são o mesmo número — ver
 * {@link fimDeNoiteDaCorrida}.
 */
export function votacaoDaUf(c: CorridaUf): EdgeVotacaoUf {
  const corrida = corridaDaUf(c);
  const bloco: EdgeVotacaoUf = { ...blocoVotacaoDaCorrida([c]), corrida };
  if (corridaPendente(corrida)) bloco.destino_pendente = true;
  return bloco;
}

/**
 * O `votacao` do detalhe de UF de Deputado Federal (`deputado-uf.json`,
 * spec 021 RF-192 emendado em 2026-09-26, noite). Contagens e projeção da UF
 * pela mesma {@link blocoVotacao}; **nunca** corrida (spec 022 RF-200).
 *
 * ⚠️ Divergência conhecida do produtor real: o ciclo proporcional de produção
 * não calcula participação projetada, então lá o detalhe sai SEM `projetada`
 * (arco 3 "aguardando"). Aqui sai com ela, pela mesma razão por que o
 * `votacao` nacional de Deputado deste gerador já sai com ela — ver a nota em
 * {@link projetarVotacao}. Quem conferir a tela de UF de Deputado no
 * `dev:sim` está vendo o simulado mais rico que produção nesse arco.
 */
export function votacaoDeputadoUf(ctx: ContextoUf): NonNullable<DeputadoUfDetail["votacao"]> {
  return blocoVotacao([ctx]);
}

/**
 * A corrida NACIONAL do Presidente: a soma das 27 UFs por candidatura — o
 * que o arquivo `br` do TSE traz, e pela mesma identidade (a soma dos
 * agregados de UF É o agregado BR).
 *
 * A destinação é da candidatura (`designarDestinos` roda UMA vez para o país),
 * e é publicada assim que QUALQUER UF apurou.
 */
export function corridaNacionalPresidente(corridas: readonly CorridaUf[]): EdgeCorridaEntrada[] {
  const publicado = destinoPublicadoNoPais(corridas);
  const porId = new Map<number, EdgeCorridaEntrada>();
  for (const c of corridas) {
    for (const r of c.resultados) {
      const e = porId.get(r.cand.id);
      if (e === undefined) {
        porId.set(r.cand.id, {
          id: r.cand.id,
          partido: r.cand.partido,
          votos: r.votosAtuais,
          ...(publicado ? { destino: r.destino } : {}),
        });
      } else {
        if (e.destino !== undefined && e.destino !== r.destino) {
          throw new Error(
            `[simulacao] candidatura ${r.cand.id} com destino ${e.destino} numa UF e ` +
              `${r.destino} noutra — a destinação é da candidatura (spec 022).`,
          );
        }
        e.votos += r.votosAtuais;
      }
    }
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/**
 * A corrida NACIONAL de Governador/Senador: Σ votos das candidaturas `valido`
 * por sigla, nas 27 UFs (RF-201/RF-209). Anulada e sub judice NÃO somam no
 * partido (RF-203). Ordem por sigla — a da tela é por votos (RF-202).
 */
export function corridaPorPartido(corridas: readonly CorridaUf[]): EdgeCorridaPartido[] {
  const soma = new Map<string, number>();
  for (const c of corridas) {
    // UF a 0% não publicou destino (`corridaDaUf`): o produtor real não sabe
    // quem é válido ali, e o voto dela é zero de qualquer forma. Pular a UF
    // mantém a saída IGUAL à do produtor nesse estado (`[]` a 0% no país).
    if (!destinoPublicadoNaUf(c)) continue;
    for (const r of c.resultados) {
      if (r.destino !== "valido") continue;
      soma.set(r.cand.partido, (soma.get(r.cand.partido) ?? 0) + r.votosAtuais);
    }
  }
  return [...soma.entries()]
    .map(([partido, votos_validos]) => ({ partido, votos_validos }))
    .sort((a, b) => (a.partido < b.partido ? -1 : a.partido > b.partido ? 1 : 0));
}

// ═════════════════════════════════════════════════════════════════════════════
// Presidente (cargo 1, turno 1)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Shares por UF de uma corrida NACIONAL.
 *
 * Cada UF recebe um "pendor regional" log-normal sobre o share nacional, e
 * depois o conjunto é **recentrado** por cinco passadas para que a média
 * ponderada pelos votos volte a ser exatamente o perfil do cenário. Sem o
 * recentramento, o agregado nacional seria o perfil mais o viés acumulado dos
 * 27 sorteios — e o `--cenario folgado`, que existe para deixar o líder
 * encostado nos 50%, poderia sair em 46% ou 51% conforme a seed. O cenário
 * pedido é um contrato com o dono, não uma sugestão.
 */
export function sharesPorUf(
  rng: Rng,
  ctxs: readonly ContextoUf[],
  cands: readonly CandidaturaUf[],
  sharesNacionais: readonly number[],
  pendorPresUf: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Record<string, number[]> {
  const n = sharesNacionais.length;
  const porUf: Record<string, number[]> = {};
  for (const c of ctxs) {
    const r = rng.derive(`pendor|${c.uf}`);
    const pendor = pendorPresUf[c.uf] ?? {};
    const v = sharesNacionais.map((s, i) => {
      // 🔴 O pendor é MEDIDO, não sorteado: a razão entre o share do partido
      // naquela UF e o dele no país, na presidencial de 2022. É o que faz o
      // Piauí e Roraima votarem diferente — e votarem diferente na direção
      // certa, que um log-normal não tem como acertar.
      const medido = pendor[(cands[i] as CandidaturaUf).partido] ?? 1;
      // Jitter pequeno por cima, para que dois partidos com o mesmo perfil de
      // 2022 não saiam com o mesmo mapa até a última casa.
      const jitter = Math.exp(r.normal() * (i < 4 ? 0.07 : 0.02));
      return Math.max(1e-6, s * medido * jitter);
    });
    porUf[c.uf] = normalizar(v).map((x) => x * 100);
  }
  for (let iter = 0; iter < 5; iter++) {
    const votos = ctxs.reduce((a, c) => a + c.votosFinais, 0);
    const nac: number[] = new Array(n).fill(0);
    for (const c of ctxs) {
      const v = porUf[c.uf] as number[];
      for (let i = 0; i < n; i++) nac[i] = (nac[i] as number) + (v[i] as number) * c.votosFinais;
    }
    for (let i = 0; i < n; i++) nac[i] = (nac[i] as number) / votos;
    for (const c of ctxs) {
      const v = porUf[c.uf] as number[];
      const corrigido = v.map(
        (x, i) => x * ((sharesNacionais[i] as number) / Math.max(1e-9, nac[i] as number)),
      );
      porUf[c.uf] = normalizar(corrigido).map((x) => x * 100);
    }
  }
  return porUf;
}

/**
 * Shares do que já foi APURADO, a partir dos shares finais.
 *
 * O desvio encolhe com a apuração e **zera em 100%**: um placar totalmente
 * apurado em que o apurado ainda diverge do projetado seria uma contradição
 * que a tela mostra lado a lado. É a mesma razão pela qual o IC zera lá.
 */
function sharesApurados(rng: Rng, finais: readonly number[], pctApurado: number): number[] {
  if (pctApurado <= 0) return finais.map(() => 0);
  const forca = 0.09 * Math.sqrt((100 - pctApurado) / 100);
  const v = finais.map((s) => Math.max(1e-6, s * Math.exp(rng.normal() * forca)));
  return normalizar(v).map((x) => x * 100);
}

export interface CandidaturaUf {
  /** `id` do payload. Número de urna no cargo 1; sequencial único nos demais. */
  id: number;
  numero: number;
  nome: string;
  partido: string;
  sqcand: string;
  uf: string;
}

/**
 * Candidaturas de um cargo numa UF, na ordem em que vão receber os shares do
 * cenário — isto é, da mais forte para a mais fraca.
 *
 * ## Por que a ordem NÃO é sorteada
 *
 * A primeira versão deste gerador embaralhava a lista com a seed, pelo
 * argumento de que escrever à mão quem fica com 35% seria o repositório
 * inventando um prognóstico sobre pessoas reais. O argumento continua correto,
 * mas o resultado não servia: com a seed default o placar presidencial saía com
 * o PCO e o AVANTE na frente e o PT em 0,25%. Uma tela assim não é neutra, é
 * **quebrada** — e o dono, que vai usar estas fixtures para julgar layout,
 * concluiria que o bug está no código.
 *
 * A saída é não escolher nem sortear: **medir**. A ordem sai da força do
 * partido em 2022 (`historical_results`, 1º turno, cargos 1 e 3 somados), que é
 * fato registrado no banco. Ninguém aqui opinou sobre 2026; o que a lista diz é
 * "em 2022 estes partidos tiveram estes votos".
 *
 * ## O que a seed ainda decide, e por quê
 *
 * A moeda entre o 1º e o 2º colocados. Quem VENCE a simulação continua sendo
 * sorteio, porque é exatamente aí que um número fixo viraria prognóstico
 * (constituição § 2). Trocar `--seed` troca o vencedor sem despencar a lista
 * inteira em nanicos.
 *
 * Partido sem voto em 2022 (MISSÃO, DEMOCRATA, MOBILIZA, PRD) tem força 0 e cai
 * na cauda, desempatado pelo número na urna.
 */
function candidaturasDaUf(
  dados: DadosSimulacao,
  rng: Rng,
  cargo: CargoTse,
  uf: string,
  idBase: number,
): CandidaturaUf[] {
  const ordenadas = dados.candidatos
    .filter((c) => c.cargo === cargo && c.uf === uf)
    .sort((a, b) => {
      const fa = dados.forcaPartido[a.partido_sigla] ?? 0;
      const fb = dados.forcaPartido[b.partido_sigla] ?? 0;
      // Desempate por número na urna e depois por `sq_candidato`: sem os dois,
      // a ordem de chegada do Postgres vazaria para a saída.
      return fb - fa || a.numero - b.numero || (a.sq_candidato < b.sq_candidato ? -1 : 1);
    });

  if (ordenadas.length > 1 && rng.u() < 0.5) {
    const a = ordenadas[0] as CandidatoBruto;
    ordenadas[0] = ordenadas[1] as CandidatoBruto;
    ordenadas[1] = a;
  }

  return ordenadas.map((c, i) => ({
    id: idBase === 0 ? c.numero : idBase + i,
    numero: c.numero,
    nome: c.nome_urna,
    partido: c.partido_sigla,
    sqcand: c.sq_candidato,
    uf: c.uf,
  }));
}

/** Preenche um vetor de shares até `n` posições com cauda geométrica. */
function completarShares(base: readonly number[], n: number): number[] {
  const out = base.slice(0, n);
  let usado = out.reduce((a, b) => a + b, 0);
  const cauda = n - out.length;
  if (cauda > 0) {
    const sobra = Math.max(0.4, 100 - usado);
    const pesos: number[] = [];
    for (let i = 0; i < cauda; i++) pesos.push(0.6 ** i);
    for (const p of normalizar(pesos)) out.push(sobra * p);
    usado = out.reduce((a, b) => a + b, 0);
  }
  return normalizar(out).map((x) => x * 100);
}

// ═════════════════════════════════════════════════════════════════════════════
// Uma corrida numa circunscrição — o núcleo compartilhado pelos três cargos
// majoritários
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoCandUf {
  cand: CandidaturaUf;
  /**
   * Spec 022 — destinação do voto desta candidatura. É da CANDIDATURA (no
   * Presidente, a mesma nas 27 UFs), como o `cand[].dvt` do TSE.
   */
  destino: EdgeDestinoVoto;
  shareFinal: number;
  /**
   * % dos votáveis apurados (`vvc`), como o `pvap` do TSE. Desde a spec 022 é
   * DERIVADO dos votos (`100 × votosAtuais / vvc`): a repartição por
   * destinação mexe nos votos, e o percentual publicado não pode contar outra
   * história que o número ao lado dele.
   */
  shareAtual: number;
  votosProjetados: number;
  votosAtuais: number;
  rank: number;
  pVitoria: number;
  pTop2: number;
  pFecha1t: number;
  pEleito: number;
  lower: number;
  upper: number;
}

export interface CorridaUf {
  ctx: ContextoUf;
  resultados: ResultadoCandUf[];
  pSegundoTurno: number;
  paresTop3: Array<{ par: [number, number]; prob: number }>;
}

/**
 * Quem, numa corrida, tem o voto anulado e quem tem o voto sub judice (spec
 * 022). Uma candidatura de cada; o resto é válido.
 *
 * `shares` está na ordem de `cands` — da mais forte para a mais fraca
 * (`candidaturasDaUf`). As `vagas + 1` primeiras ficam PROTEGIDAS sempre que
 * sobrar gente: anular o líder, ou quem disputa a última vaga, trocaria a
 * corrida que o dono está conferindo por outra.
 *
 * Entre as elegíveis, a escolhida é a de share final MAIS PRÓXIMO do tamanho
 * da fatia que ela vai carregar (`par.subJudice`, depois `par.anulados`): o
 * voto dela é forçado a esse tamanho por `resolverCorridaUf`, e a escolha
 * mais próxima é a que menos afasta o `pct_atual` do `pct_projetado` dela.
 * Empate ⇒ a mais fraca (maior índice), determinístico.
 *
 * Abaixo de {@link MIN_CANDIDATURAS_PARA_DESTINO} candidaturas, todas válidas
 * — e a UF, por `ufAnulavel`, também não tem anulados para repartir.
 */
export function designarDestinos(
  shares: readonly number[],
  vagas: number,
  par: ParametrosVotacao = PARAMETROS_VOTACAO,
): EdgeDestinoVoto[] {
  const n = shares.length;
  const destinos: EdgeDestinoVoto[] = shares.map(() => "valido");
  if (n < MIN_CANDIDATURAS_PARA_DESTINO) return destinos;
  const protegidas = Math.min(vagas + 1, n - 2);
  const maisProxima = (alvo: number): number => {
    let melhor = -1;
    for (let i = protegidas; i < n; i++) {
      if (destinos[i] !== "valido") continue;
      const d = Math.abs((shares[i] as number) - alvo);
      const dm =
        melhor < 0 ? Number.POSITIVE_INFINITY : Math.abs((shares[melhor] as number) - alvo);
      if (d <= dm) melhor = i;
    }
    return melhor;
  };
  destinos[maisProxima(par.subJudice * 100)] = "sub_judice";
  destinos[maisProxima(par.anulados * 100)] = "anulado";
  return destinos;
}

/**
 * ADR-0053 / RF-213 — fração dos votáveis anulada na UF do cenário
 * `--anulado-lidera`. **Metade**, e não um número "realista": com `vansj`
 * em {@link PARAMETROS_VOTACAO}.subJudice (8,7%), sobram 41,3% de válidos, e
 * nenhuma candidatura válida alcança a anulada NO APURADO em feitio nenhum
 * (no `decidida`, 24/(24+4+…) do bolo de válidos chega a ~39% — um 40% aqui
 * já não garantiria). A garantia é por construção, não por sorte da seed.
 */
export const FRACAO_ANULADOS_CENARIO = 0.5;

/**
 * Destinos da corrida estadual na UF do cenário `--anulado-lidera`: a
 * candidatura MAIS FORTE (índice 0) é a anulada — é o caso (B) do ADR-0053,
 * que {@link designarDestinos} nunca produz porque protege o topo. A sub
 * judice segue a regra de sempre; a anulada que a regra escolheria volta a
 * ser válida (uma anulada por corrida, como no default).
 */
function destinosDoCenarioAnulado(shares: readonly number[], vagas: number): EdgeDestinoVoto[] {
  const destinos = designarDestinos(shares, vagas);
  const antiga = destinos.indexOf("anulado");
  if (antiga < 0 || destinos[0] !== "valido") {
    throw new Error(
      "[simulacao] --anulado-lidera: a corrida não comporta uma anulada no topo " +
        `(destinos ${destinos.join(",")}) — escolha uma UF anulável.`,
    );
  }
  destinos[antiga] = "valido";
  destinos[0] = "anulado";
  return destinos;
}

/**
 * Aplica o cenário `--anulado-lidera <UF>` aos contextos: devolve os MESMOS
 * objetos, exceto o da UF pedida, que ganha `fracaoAnulados`. Sem UF, devolve
 * o array intacto — o default não passa por aqui.
 *
 * ⚠️ Efeito colateral declarado: o contexto é o da UF nos quatro cargos, então
 * no PRESIDENTE a anulada nacional (uma candidatura fraca no perfil) também
 * recebe metade dos votáveis dessa UF e lidera o apurado dela, com
 * `pct_projetado` pequeno. É o preço de não afrouxar a invariante (12) — os
 * cargos de um voto por eleitor contam os mesmos votos neste gerador.
 */
export function aplicarCenarioAnulado(
  ctxs: readonly ContextoUf[],
  uf: string | undefined,
): ContextoUf[] {
  if (uf === undefined) return [...ctxs];
  const alvo = ctxs.find((c) => c.uf === uf);
  if (alvo === undefined) throw new Error(`[simulacao] --anulado-lidera: UF ${uf} desconhecida`);
  if (!alvo.anulaveis || alvo.pctApurado <= 0) {
    throw new Error(
      `[simulacao] --anulado-lidera ${uf}: a UF precisa ser anulável (≥ ${MIN_CANDIDATURAS_PARA_DESTINO} ` +
        `candidaturas em cada corrida majoritária) e ter apuração > 0 (tem ${alvo.pctApurado}%) — ` +
        "senão a destinação não é publicada e não há o que ver na tela.",
    );
  }
  return ctxs.map((c) => (c === alvo ? { ...c, fracaoAnulados: FRACAO_ANULADOS_CENARIO } : c));
}

/**
 * Reparte os votáveis apurados entre as candidaturas POR DESTINAÇÃO (spec
 * 022): o bolo de válidos só entre as válidas, o de anulados só entre as
 * anuladas, o de sub judice só entre as sub judice — cada um por maiores
 * restos sobre o share apurado de quem está no grupo.
 *
 * Os três bolos saem de `repartirVotaveis`, a MESMA conta das contagens, então
 * as três identidades do TSE valem por construção. Bolo positivo sem ninguém
 * no grupo é defeito do chamador e sai como erro alto — distribuí-lo entre as
 * válidas recriaria exatamente o voto anulado sem marca que a spec conserta.
 *
 * `votaveis` escolhe o instante: o apurado (`ctx.votosApurados`, o padrão) ou
 * o fim de noite (`ctx.votosFinais`). É a MESMA repartição nos dois — ver
 * `resolverCorridaUf`.
 */
function alocarPorDestino(
  ctx: ContextoUf,
  pesos: readonly number[],
  destinos: readonly EdgeDestinoVoto[],
  votaveis: number = ctx.votosApurados,
): number[] {
  const bolos = repartirVotaveis(ctx, PARAMETROS_VOTACAO, votaveis);
  const porDestino: Record<EdgeDestinoVoto, number> = {
    valido: bolos.validos,
    anulado: bolos.anulados,
    sub_judice: bolos.subJudice,
  };
  const votos: number[] = pesos.map(() => 0);
  for (const destino of ["valido", "anulado", "sub_judice"] as const) {
    const idx = destinos.flatMap((d, i) => (d === destino ? [i] : []));
    const bolo = porDestino[destino];
    if (idx.length === 0) {
      if (bolo > 0) {
        throw new Error(
          `[simulacao] ${ctx.uf}: ${bolo} votos ${destino} e nenhuma candidatura ${destino} ` +
            `para carregá-los — o voto ficaria sem dono (spec 022).`,
        );
      }
      continue;
    }
    const w = idx.map((i) => pesos[i] as number);
    const partes = alocarInteiros(bolo, w.some((x) => x > 0) ? w : w.map(() => 1));
    idx.forEach((i, k) => {
      votos[i] = partes[k] as number;
    });
  }
  return votos;
}

/**
 * Resolve uma corrida numa UF: votos inteiros, ranks, ICs e probabilidades.
 *
 * Os votos saem por maiores restos sobre o total da UF, de modo que
 * `Σ votos_candidatos === votosFinais` **exatamente**, tanto no projetado
 * quanto no apurado. Essa é a primeira invariante que o dono conferiria, e a
 * única forma de ela nunca falhar é os votos serem repartidos a partir do
 * total, em vez de somados a partir das partes.
 *
 * 🔴 **Um fim de noite só (decisão do dono, 2026-09-27).** Os votos
 * PROJETADOS saem por destinação, exatamente como os apurados: o bolo de
 * válidos do fim de noite (`repartirVotaveis` sobre `votosFinais`) só entre
 * as válidas, e assim por diante. Até 27/09 eles saíam por `alocarInteiros`
 * sobre o total, e a candidatura anulada ficava com o share do perfil (≈1–4%)
 * no projetado e com a fatia medida de anulados (7,6%) no apurado. Duas
 * consequências medidas na fixture: Σ `votos_projetados` das válidas passava
 * `votacao.projetada.validos` em +7,3% (BR Presidente) a +15,2% (AC), e a
 * 100% apurado o `votos_projetados` de cada candidata NÃO reencontrava o
 * `votos_atuais` dela — o gerador contradizia a própria contagem final.
 * Agora a 100% os dois são iguais na unidade (os pesos coincidem:
 * `sharesApurados` a 100% devolve `sharesFinais`), e {@link fimDeNoiteDaCorrida}
 * lê a `projetada` DESTES votos.
 *
 * ⚠️ O que NÃO mudou, e fica declarado: `pct_projetado` continua sendo o share
 * do perfil (`sharesFinais`), não `votos_projetados ÷ votosFinais`. É a mesma
 * distância que `pct_atual` já tinha de `pct_projetado` a 100% desde a spec
 * 022 — mexer no share mexeria em rank, probabilidade e agulha.
 */
export function resolverCorridaUf(
  rng: Rng,
  ctx: ContextoUf,
  cands: readonly CandidaturaUf[],
  sharesFinais: readonly number[],
  vagas: number,
  destinos: readonly EdgeDestinoVoto[],
): CorridaUf {
  if (destinos.length !== cands.length) {
    throw new Error(
      `[simulacao] ${ctx.uf}: ${destinos.length} destinos para ${cands.length} candidaturas`,
    );
  }
  const atuais = sharesApurados(rng.derive(`apurado|${ctx.uf}`), sharesFinais, ctx.pctApurado);
  // O fim de noite por DESTINAÇÃO, pela mesma função do apurado — ver acima.
  const votosProj = alocarPorDestino(ctx, sharesFinais, destinos, ctx.votosFinais);
  // Spec 022 — os votos apurados saem por DESTINAÇÃO; o share publicado sai
  // dos votos, para `pct_atual` e `votos_atuais` contarem a mesma história.
  const votosAt = alocarPorDestino(ctx, atuais, destinos);
  const vvc = ctx.votosApurados;
  const prob = probabilidades(rng.derive(`prob|${ctx.uf}`), sharesFinais, ctx.pctApurado, vagas);

  const bruto = cands.map((cand, i) => {
    const s = sharesFinais[i] as number;
    const hw = meiaLarguraIc(s, ctx.pctApurado);
    return {
      cand,
      destino: destinos[i] as EdgeDestinoVoto,
      shareFinal: s,
      shareAtual: vvc > 0 ? (100 * (votosAt[i] as number)) / vvc : 0,
      votosProjetados: votosProj[i] as number,
      votosAtuais: votosAt[i] as number,
      rank: 0,
      pVitoria: prob.pVitoria[i] as number,
      pTop2: prob.pTop2[i] as number,
      pFecha1t: prob.pFecha1t[i] as number,
      pEleito: prob.pEleito[i] as number,
      // Clampado em [0,100]: um limite inferior negativo é aritmeticamente
      // possível num share pequeno com pouca apuração, e a tela o exibiria
      // como "-1,4% dos votos".
      lower: Math.max(0, s - hw),
      upper: Math.min(100, s + hw),
    };
  });

  // Rank por share projetado desc, desempate por `id` ASC (ADR-0013).
  const ordenado = [...bruto].sort((a, b) => b.shareFinal - a.shareFinal || a.cand.id - b.cand.id);
  ordenado.forEach((r, i) => {
    r.rank = i + 1;
  });

  return {
    ctx,
    resultados: ordenado,
    pSegundoTurno: prob.pSegundoTurno,
    paresTop3: prob.paresTop3,
  };
}

/**
 * `EdgeCandidate` a partir de um resultado. `sqcand` só quando pedido;
 * `destino` só quando a destinação da abrangência já foi publicada (RF-213).
 */
function edgeCandidate(
  r: ResultadoCandUf,
  comSqcand: boolean,
  destinoPublicado: boolean,
): EdgeCandidate {
  const c: EdgeCandidate = {
    id: r.cand.id,
    nome: r.cand.nome,
    partido: r.cand.partido,
    ...campoDestino(r, destinoPublicado),
    cor: colorForRank(r.rank),
    votos_atuais: r.votosAtuais,
    votos_projetados: r.votosProjetados,
    pct_atual: r2(r.shareAtual),
    pct_projetado: r2(r.shareFinal),
    pct_projetado_lower: r2(r.lower),
    pct_projetado_upper: r2(r.upper),
    p_vitoria: r.pVitoria,
    rank: r.rank,
    p_passa_2t: r.pTop2,
    p_fecha_1t: r.pFecha1t,
  };
  if (comSqcand) c.sqcand = r.cand.sqcand;
  return c;
}

/**
 * A linha de UF do choropleth.
 *
 * `chamada` é derivada — `p_vitoria` do líder ≥ 0,995 com apuração suficiente
 * — e não escrita à mão por UF. `forcarNaoChamada` existe só para o cenário
 * `apertado`, cuja definição inclui "nenhuma corrida chamada": ali a ausência
 * de chamada é o que se quer exercitar na tela, e deixá-la emergir do sorteio
 * tornaria o cenário não reprodutível na propriedade que o define.
 */
function linhaUf(
  corrida: CorridaUf,
  vagas: number,
  forcarNaoChamada: boolean,
  ehGovernador: boolean,
  destinoPublicado: boolean,
): EdgeUfRow {
  const { ctx, resultados } = corrida;
  // ADR-0053 / RF-213 — líder e margem (e daí a cor do mapa, a chamada e o
  // balde) saem só de quem COMPETE; a anulada segue em `top_candidatos`, com
  // `destino`, para a tela pô-la no fim com a etiqueta.
  const disputa = competidores(resultados, destinoPublicado);
  const lider = disputa[0];
  const segundo = disputa[1];
  if (lider === undefined) throw new Error(`UF ${ctx.uf} sem candidatura que compete`);

  const margemProj = lider.shareFinal - (segundo?.shareFinal ?? 0);
  const margemAtual = ctx.pctApurado > 0 ? lider.shareAtual - (segundo?.shareAtual ?? 0) : 0;
  const hwMargem = meiaLarguraIc(lider.shareFinal, ctx.pctApurado) * 1.45;

  const chamada =
    !forcarNaoChamada &&
    ctx.pctApurado >= 25 &&
    (vagas === 1 ? lider.pVitoria >= 0.995 : (segundo?.pEleito ?? 0) >= 0.99);

  const fecha1t = lider.shareFinal >= 50;
  const vaiA2t = ehGovernador ? !fecha1t : null;

  // A margem ainda cabe dentro da incerteza? Então não há o que declarar.
  const margemIndefinida = margemProj - hwMargem <= 0;

  let bucket: EdgeUfRow["bucket"];
  if (chamada) bucket = "chamada";
  else if (vagas > 1) {
    // Senado: só `"chamada"` e `"indefinido"`. `"decidido_1t"` e `"vai_2t"`
    // são semântica de GOVERNADOR — o rótulo que a UI monta a partir deles
    // fala em turno, e o Senado não tem segundo turno. É também o que a
    // fixture `sen-current.json` faz (25 linhas, todas `"indefinido"`).
    bucket = "indefinido";
  } else if (ehGovernador) {
    if (margemIndefinida) bucket = "indefinido";
    else bucket = fecha1t ? "decidido_1t" : "vai_2t";
  } else {
    // Presidente: `"decidido_1t"` e `"vai_2t"` são semântica de GOVERNADOR —
    // quem decide o 2º turno presidencial é o agregado nacional, não o estado
    // (por isso `vai_a_2t` é `null` aqui). Uma UF presidencial marcada
    // "decidido_1t" faria a tela afirmar que São Paulo elegeu o presidente no
    // 1º turno. Só há dois estados honestos: chamada, ou ainda não.
    bucket = "indefinido";
  }

  return {
    sigla: ctx.uf,
    pct_apurado: ctx.pctApurado,
    lider: lider.cand.id,
    margem_atual: r2(margemAtual),
    margem_projetada: r2(margemProj),
    margem_projetada_ci: [
      r2(Math.max(-100, margemProj - hwMargem)),
      r2(Math.min(100, margemProj + hwMargem)),
    ],
    chamada,
    // `null`, nunca `0`: um zero aqui leria como "não mudou nada desde 2022",
    // que é uma afirmação. Não há dado de swing numa simulação.
    swing_vs_2022: null,
    top_candidatos: selecionarComResgate(resultados).selecionados.map((r) => ({
      id: r.cand.id,
      pct: r2(r.shareFinal),
      nome: r.cand.nome,
      partido: r.cand.partido,
      // RF-213 — o MESMO `destino` de `votacao.corrida` da abrangência que
      // decide (a UF; no Presidente, o país). Ausente antes da publicação.
      ...campoDestino(r, destinoPublicado),
      // Aqui `sqcand` SEMPRE vai: esta linha sabe de que UF é, e é ela que
      // endereça a foto (ADR-0041/0042). É o oposto do bloco nacional de
      // cargo 3/5, onde a mesma chave apontaria para o estado errado.
      sqcand: r.cand.sqcand,
      // 2026-09-18 (pedido do dono — balão do mapa nacional estilo NYT):
      // MESMOS campos/MESMOS valores que `edgeCandidate()` grava em
      // `EdgeUfCandidate` logo acima — `r` é o MESMO `ResultadoCandUf` desta
      // UF, então isto não é uma segunda conta, é o valor que esta função já
      // tinha na mão. `votosAtuais`/`shareAtual` nunca são `null` neste
      // gerador (ao contrário do modelo real — `impute_uf_from_national` não
      // existe aqui): `sharesApurados` devolve `0` explícito quando
      // `pctApurado <= 0`, e `0` É o fato correto (nenhuma zona simulada como
      // apurada ainda) — por isso os dois campos vão SEMPRE, nunca opcionais
      // aqui, ao contrário de `api/model/project.py`.
      votos_atuais: r.votosAtuais,
      pct_atual: r2(r.shareAtual),
    })),
    // 2026-09-19 (mesmo pedido do dono): a linha "Outros" do balão. Cauda =
    // o complemento EXATO do `slice` acima sobre a MESMA lista já ordenada,
    // pelo mesmo `TOP_CANDIDATOS_POR_UF` — top e cauda particionam
    // `resultados`, sem sobra nem sobreposição.
    //
    // 🔴 Soma candidato a candidato, NUNCA `100 − Σ(top 4)`. Aqui a diferença
    // é ainda mais visível que no modelo real: `validarSaida` exige
    // `Σ r2(shareFinal) === 100 ± TOLERANCIA.pctSoma` — ou seja, a soma dos
    // pontos arredondados fecha PERTO de 100, não EM 100. Subtrair jogaria
    // esse resíduo de arredondamento dentro de "Outros" e o publicaria como
    // voto de alguém. Mesma regra e mesma razão de `api/model/project.py`
    // (ver o bloco `cauda`/`outros_top` em `build_edge_payload`).
    //
    // `votos_atuais`/`pct_atual` vão SEMPRE aqui, ao contrário do modelo
    // real: `sharesApurados` devolve `0` explícito quando `pctApurado <= 0` e
    // não existe imputação nacional neste gerador — então `0` é sempre o fato
    // "nenhuma zona simulada como apurada", nunca "não medimos" (mesmo
    // argumento já escrito para as linhas de `top_candidatos` acima).
    //
    // `undefined` quando a corrida tem ≤ 4 candidaturas: chave AUSENTE do
    // JSON emitido (`JSON.stringify` omite `undefined`), nunca `{ pct: 0 }` —
    // "não há mais ninguém" e "os demais somam 0%" são estados diferentes.
    // 🔴 `cauda` de `selecionarComResgate`, e NÃO `resultados.slice(N)`: com o
    // resgate por apurado, quem foi resgatado está no topo E estaria naquele
    // fatiamento. Publicá-lo nos dois lugares faria `Σtop + outros` passar de
    // 100% sem nenhuma exceção ser levantada.
    outros: outrosDaCauda(selecionarComResgate(resultados).cauda),
    vai_a_2t: vaiA2t,
    bucket,
  };
}

/**
 * Agregado "Outros" de uma cauda já ordenada — `undefined` se ela for vazia.
 *
 * Soma direta sobre os membros; jamais `100 − Σ(topo)`. Ver o comentário em
 * `linhaUf` e o bloco irmão em `api/model/project.py`.
 */
function outrosDaCauda(cauda: readonly ResultadoCandUf[]): EdgeUfRow["outros"] {
  if (cauda.length === 0) return undefined;
  return {
    pct: r2(cauda.reduce((a, r) => a + r.shareFinal, 0)),
    pct_atual: r2(cauda.reduce((a, r) => a + r.shareAtual, 0)),
    votos_atuais: cauda.reduce((a, r) => a + r.votosAtuais, 0),
    n_candidatos: cauda.length,
  };
}

function contarZonas(ctxs: readonly ContextoUf[]): number {
  return ctxs.reduce((a, c) => a + Math.round((c.pares * c.pctApurado) / 100), 0);
}

function ufsApuradas(linhas: readonly { pct_apurado: number }[]): number {
  return linhas.filter((l) => l.pct_apurado > 0).length;
}

/** Média ponderada pelos votos FINAIS — o percentual nacional efetivo. */
function pctNacional(ctxs: readonly ContextoUf[]): number {
  const peso = ctxs.reduce((a, c) => a + c.eleitores, 0);
  return ctxs.reduce((a, c) => a + c.pctApurado * c.eleitores, 0) / peso;
}

// ═════════════════════════════════════════════════════════════════════════════
// Payload de Presidente
// ═════════════════════════════════════════════════════════════════════════════

export interface SaidaPresidente {
  payload: EdgePayload;
  /** Corridas por UF — é com elas que `validarSaida` confere a soma de votos. */
  corridas: CorridaUf[];
}

export function montarPresidente(
  dados: DadosSimulacao,
  ctxs: readonly ContextoUf[],
  rng: Rng,
  cenario: Cenario,
  ts: string,
): SaidaPresidente {
  const r = rng.derive("pres");
  // Cargo 1 vive sob a UF "BR" na tabela `candidatos`. `idBase: 0` ⇒ o `id` do
  // payload É o número na urna, como no orchestrator real e em
  // `projection-seed` (RF-161) — e aqui não há ambiguidade, porque a corrida
  // presidencial é uma só.
  const cands = candidaturasDaUf(dados, r.derive("ordem"), 1, "BR", 0);
  if (cands.length === 0) throw new Error("Nenhuma candidatura a Presidente publicável no banco.");

  const nacionais = sharesPresidenciais(cenario, cands.length);
  const porUf = sharesPorUf(r.derive("uf"), ctxs, cands, nacionais, dados.pendorPresUf);
  // Spec 022 — a destinação é da CANDIDATURA: decidida UMA vez, sobre o perfil
  // nacional, e aplicada igual nas 27 UFs. Decidir por UF daria a mesma pessoa
  // "válida" num estado e "anulada" no outro — e a soma nacional dela não
  // teria destino.
  const destinos = designarDestinos(nacionais, 1);
  const corridas = ctxs.map((c) =>
    resolverCorridaUf(r, c, cands, porUf[c.uf] as number[], 1, destinos),
  );

  // O agregado nacional é a SOMA das UFs, não um número paralelo: se ele fosse
  // recalculado do perfil, a conta do leitor que somasse os 27 estados não
  // fecharia com a manchete.
  const totalProj = corridas.reduce((a, c) => a + c.ctx.votosFinais, 0);
  const totalAt = corridas.reduce((a, c) => a + c.ctx.votosApurados, 0);
  const votosProj = cands.map((_, i) =>
    corridas.reduce(
      (a, c) =>
        a +
        (c.resultados.find((x) => x.cand.id === (cands[i] as CandidaturaUf).id)?.votosProjetados ??
          0),
      0,
    ),
  );
  const votosAt = cands.map((_, i) =>
    corridas.reduce(
      (a, c) =>
        a +
        (c.resultados.find((x) => x.cand.id === (cands[i] as CandidaturaUf).id)?.votosAtuais ?? 0),
      0,
    ),
  );
  // `pct_projetado` nacional é o PERFIL ponderado pelo volume de cada UF — a
  // mesma grandeza do `pct_projetado` de UF (`shareFinal`) — e não
  // `votos_projetados ÷ total`. Desde 2026-09-27 os `votos_projetados` saem
  // por destinação (`resolverCorridaUf`): as válidas encolhem para caber no
  // bolo de válidos e a anulada cresce até a fatia medida de anulados. Ler o
  // share dos votos moveria o cenário pedido (o líder do `folgado` cairia de
  // ~48% para ~44,6%) e poria a candidatura sub judice em 3º no ranking — o
  // cenário é um contrato com o dono (ver `sharesPorUf`).
  const sharesNac = cands.map(
    (cand) =>
      corridas.reduce(
        (a, c) =>
          a +
          (c.resultados.find((x) => x.cand.id === cand.id)?.shareFinal ?? 0) * c.ctx.votosFinais,
        0,
      ) / Math.max(1, totalProj),
  );
  const sharesNacAt = votosAt.map((v) => (totalAt > 0 ? (100 * v) / totalAt : 0));

  const pct = pctNacional(ctxs);
  const prob = probabilidades(r.derive("prob-nacional"), sharesNac, pct, 1);

  const linhas = cands
    .map((cand, i) => ({
      cand,
      i,
      share: sharesNac[i] as number,
      shareAt: sharesNacAt[i] as number,
      votosProjetados: votosProj[i] as number,
      votosAtuais: votosAt[i] as number,
    }))
    .sort((a, b) => b.share - a.share || a.cand.id - b.cand.id);

  // RF-213 — a destinação do Presidente é NACIONAL, e é a mesma nas 27 UFs.
  const destinoPublicado = destinoPublicadoNoPais(corridas);
  const candidatos: EdgeCandidate[] = linhas.map((l, idx) => {
    const hw = meiaLarguraIc(l.share, pct);
    return {
      id: l.cand.id,
      nome: l.cand.nome,
      partido: l.cand.partido,
      ...destinoNaLista(destinos[l.i] as EdgeDestinoVoto, destinoPublicado),
      cor: colorForRank(idx + 1),
      votos_atuais: l.votosAtuais,
      votos_projetados: l.votosProjetados,
      pct_atual: r2(l.shareAt),
      pct_projetado: r2(l.share),
      pct_projetado_lower: r2(Math.max(0, l.share - hw)),
      pct_projetado_upper: r2(Math.min(100, l.share + hw)),
      p_vitoria: prob.pVitoria[l.i] as number,
      rank: idx + 1,
      p_passa_2t: prob.pTop2[l.i] as number,
      p_fecha_1t: prob.pFecha1t[l.i] as number,
      // Cargo 1 é o único em que `sqcand` no bloco nacional é inequívoco.
      sqcand: l.cand.sqcand,
    };
  });

  const lider = candidatos[0];
  const segundo = candidatos[1];
  if (lider === undefined) throw new Error("Corrida presidencial sem líder — impossível.");

  const { pos, band } = agulha(lider.p_vitoria, segundo?.p_vitoria ?? 0);
  const porUfLinhas = corridas.map((c) =>
    linhaUf(c, 1, cenario === "apertado", false, destinoPublicado),
  );

  // `cenarios_2t` reindexado de posição-no-array-de-cands para `id` — o
  // consumidor recebe ids de candidato, nunca índices internos.
  const cenarios2t = prob.paresTop3.map((p) => ({
    par: [(cands[p.par[0]] as CandidaturaUf).id, (cands[p.par[1]] as CandidaturaUf).id] as [
      number,
      number,
    ],
    prob: p.prob,
  }));

  const outrosPct = candidatos.slice(3).reduce((a, c) => a + c.pct_projetado, 0);
  const national: EdgeNational = {
    candidatos,
    needle_position: pos,
    needle_band: band,
    candidato_a_id: lider.id,
    candidato_b_id: segundo?.id ?? null,
    p_segundo_turno_overall: prob.pSegundoTurno,
    cenarios_2t: cenarios2t,
    chamadas_recentes: [],
    vai_a_2t_nacional: prob.pSegundoTurno >= 0.5,
    participacao: blocoParticipacao(ctxs, pct, contarZonas(ctxs), {
      pct: outrosPct,
      n: Math.max(0, candidatos.length - 3),
    }),
  };

  return {
    payload: {
      ts,
      cargo: 1,
      turno: 1,
      pct_apurado_total: r1(pct),
      ufs_apuradas: ufsApuradas(porUfLinhas),
      // Spec 022 — `corrida` (por candidatura) sai das MESMAS corridas de UF
      // cujos `vvc` compõem as contagens: fecha por construção.
      votacao: { ...blocoVotacaoDaCorrida(corridas), corrida: corridaNacionalPresidente(corridas) },
      national,
      por_uf: porUfLinhas,
      insights: insightsPresidente(candidatos, prob.pSegundoTurno, pct, porUfLinhas),
      composition: composicao(pct),
    },
    corridas,
  };
}

/**
 * Pesos da composição do modelo. Somam 1 (o orchestrator valida em runtime).
 *
 * Trajetória: no começo da noite quase tudo vem da extrapolação; no fim, quase
 * tudo é resultado apurado. `pre_election` fica fixo em 0 porque é o que os
 * quatro emissores reais gravam hoje — e porque ele **não é sinal de fase**
 * (ADR-0043 D2).
 */
function composicao(pct: number): EdgePayload["composition"] {
  const apurado = Math.min(1, pct / 100);
  return { pre_election: 0, model: r2(1 - apurado), actual_results: r2(apurado) };
}

const pt = (n: number): string => n.toLocaleString("pt-BR");
const pp = (n: number): string => n.toFixed(1).replace(".", ",");

/** Frases por TEMPLATE — nunca LLM (constituição § 2, ADR-0005). */
function insightsPresidente(
  cands: readonly EdgeCandidate[],
  pSegundoTurno: number,
  pct: number,
  linhas: readonly EdgeUfRow[],
): string[] {
  const a = cands[0];
  const b = cands[1];
  if (a === undefined) return [];
  const out: string[] = [
    `${a.nome} (${a.partido}) à frente com ${pp(a.pct_projetado)}% — intervalo de ${pp(a.pct_projetado_lower)}% a ${pp(a.pct_projetado_upper)}% com ${pp(pct)}% apurado.`,
  ];
  if (b !== undefined) {
    const margem = a.pct_projetado - b.pct_projetado;
    const sobrepoe = a.pct_projetado_lower <= b.pct_projetado_upper;
    out.push(
      sobrepoe
        ? `Diferença de ${pp(margem)} pp para ${b.nome} (${b.partido}) — os intervalos se sobrepõem, não há vencedor projetado.`
        : `${a.nome} abre ${pp(margem)} pp sobre ${b.nome} (${b.partido}), acima da margem de incerteza.`,
    );
  }
  out.push(
    `P(2º turno) = ${pp(pSegundoTurno * 100)}%. ${linhas.filter((l) => l.chamada).length} de 27 unidades federativas já chamadas.`,
  );
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Payloads de Governador e Senador — 27 corridas sob um envelope
// ═════════════════════════════════════════════════════════════════════════════

export interface CorridaEstadual {
  cargo: CargoTse;
  corridas: CorridaUf[];
  feitios: Record<string, FeitioUf>;
}

export function montarCorridasEstaduais(
  dados: DadosSimulacao,
  ctxs: readonly ContextoUf[],
  rng: Rng,
  cargo: CargoTse,
): CorridaEstadual {
  const r = rng.derive(`cargo-${cargo}`);
  const vagas = cargoInfo(cargo).vagasPorUf ?? 1;
  const feitios = repartirFeitios(r.derive("feitios"), UFS);
  const corridas = ctxs.map((ctxEleitorado) => {
    // Spec 022 RF-210 — o Senado conta VOTOS, `vagas` por eleitor: o contexto
    // do cargo tem o mesmo eleitorado e os votáveis na escala do cargo.
    // Governador devolve o mesmo objeto (`ctxDoCargo`).
    const ctx = ctxDoCargo(ctxEleitorado, cargo, r);
    const ordem = UFS.indexOf(ctx.uf);
    // `idBase` sequencial por UF — ver o bloco 7(a) do cabeçalho. Sem ele, o
    // 13 de Alagoas e o 13 do Acre colidem no índice que a tela monta sobre
    // `national.candidatos`, e o card do estado mostra a pessoa errada.
    const cands = candidaturasDaUf(
      dados,
      r.derive(`ordem|${ctx.uf}`),
      cargo,
      ctx.uf,
      (ordem + 1) * 1000,
    );
    if (cands.length === 0) throw new Error(`${ctx.uf}: nenhuma candidatura a cargo ${cargo}.`);
    const shares = completarShares(SHARES_FEITIO[feitios[ctx.uf] as FeitioUf], cands.length);
    // Spec 022 — UF que não é anulável (ver `ufAnulavel`) não tem bolo de
    // anulados; a corrida dela sai toda válida.
    const destinos = ctx.anulaveis
      ? ctx.fracaoAnulados === undefined
        ? designarDestinos(shares, vagas)
        : destinosDoCenarioAnulado(shares, vagas)
      : shares.map((): EdgeDestinoVoto => "valido");
    return resolverCorridaUf(r, ctx, cands, shares, vagas, destinos);
  });
  return { cargo, corridas, feitios };
}

export function montarPayloadEstadual(
  estadual: CorridaEstadual,
  ctxs: readonly ContextoUf[],
  ts: string,
): EdgePayload {
  const { cargo, corridas } = estadual;
  const ehGov = cargo === 3;
  const vagas = cargoInfo(cargo).vagasPorUf ?? 1;
  const pct = pctNacional(ctxs);

  // Ordem: UF asc, depois rank asc. Agrupar por UF (em vez de ordenar por
  // percentual) é o que as fixtures atuais fazem e é o que faz sentido num
  // bloco que é a união de 27 corridas — um "ranking nacional" de governadores
  // ordenaria percentuais de universos diferentes lado a lado.
  const candidatos: EdgeCandidate[] = [];
  for (const c of corridas) {
    for (const res of c.resultados) {
      // `comSqcand: false` — bloco 7(b) do cabeçalho: aqui a chave apontaria
      // para a foto de um candidato de UF arbitrária. A identidade destes
      // cargos vive em `top_candidatos` e no arquivo por UF.
      candidatos.push(edgeCandidate(res, false, destinoPublicadoNaUf(c)));
    }
  }

  const linhas = corridas.map((c) => linhaUf(c, vagas, false, ehGov, destinoPublicadoNaUf(c)));
  const chamadas = linhas.filter((l) => l.chamada);

  const national: EdgeNational = {
    candidatos,
    // Não há corrida nacional de Governador nem de Senador: a agulha nacional
    // não tem referente. Zero + `tossup` é o "sem sinal" que o tipo permite —
    // e o que NÃO se pode fazer é derivar uma agulha da maior UF, que a tela
    // leria como se fosse do país.
    needle_position: 0,
    needle_band: "tossup",
    candidato_a_id: null,
    candidato_b_id: null,
    p_segundo_turno_overall: null,
    cenarios_2t: [],
    chamadas_recentes: chamadas.slice(0, 5).map((l) => {
      // O chamado é o `lider` (quem compete, RF-213) — não `top_candidatos[0]`,
      // que pode ser uma anulada no topo da lista.
      const t = l.top_candidatos.find((x) => x.id === l.lider);
      return {
        ts,
        texto: `${l.sigla} chamada para ${t?.nome ?? "o líder"} (${t?.partido ?? "—"}) com ${pp(l.pct_apurado)}% apurado.`,
      };
    }),
    vai_a_2t_nacional: null,
  };
  if (ehGov) {
    national.participacao = blocoParticipacao(ctxs, pct, contarZonas(ctxs));
  }

  const payload: EdgePayload = {
    ts,
    cargo,
    turno: 1,
    pct_apurado_total: r1(pct),
    ufs_apuradas: ufsApuradas(linhas),
    // Spec 022 — 27 corridas não têm 1º colocado nacional: por PARTIDO (RF-201).
    votacao: {
      ...blocoVotacaoDaCorrida(corridas),
      corrida_por_partido: corridaPorPartido(corridas),
    },
    national,
    por_uf: linhas,
    insights: ehGov ? insightsGovernador(linhas) : insightsSenador(linhas, corridas),
    composition: composicao(pct),
  };

  if (cargo === 5) {
    const projetadas = linhas.filter((l) => l.pct_apurado > 0).length;
    const porPartido = new Map<string, number>();
    for (const c of corridas) {
      if (c.ctx.pctApurado <= 0) continue;
      // As vagas vão para quem COMPETE (ADR-0053): uma anulada no topo não
      // ocupa cadeira.
      for (const res of competidores(c.resultados, destinoPublicadoNaUf(c)).slice(0, vagas)) {
        porPartido.set(res.cand.partido, (porPartido.get(res.cand.partido) ?? 0) + 1);
      }
    }
    payload.composicao_vagas = {
      // 27 × 2 = 54 das 81 cadeiras. Os dois denominadores existem porque
      // confundi-los é o erro de leitura mais provável desta tela: em 2026 o
      // Senado renova 2/3, não a casa inteira.
      vagas_em_disputa: UFS.length * vagas,
      total_cadeiras: UFS.length * 3,
      vagas_por_uf: vagas,
      ufs_projetadas: projetadas,
      ufs_aguardando: UFS.length - projetadas,
      vagas_projetadas: projetadas * vagas,
      por_partido: [...porPartido.entries()]
        .map(([partido, v]) => ({ partido, vagas: v }))
        .sort((a, b) => b.vagas - a.vagas || a.partido.localeCompare(b.partido, "pt-BR")),
    };
  }

  return payload;
}

function insightsGovernador(linhas: readonly EdgeUfRow[]): string[] {
  const vai2t = linhas.filter((l) => l.vai_a_2t === true).length;
  const chamadas = linhas.filter((l) => l.chamada).length;
  const indef = linhas.filter((l) => l.bucket === "indefinido").length;
  return [
    `Governadores: ${linhas.length} corridas em apuração — recorte por status no filtro acima.`,
    `${vai2t} estados caminham para 2º turno segundo a projeção; ${chamadas} já chamados para o líder.`,
    `${indef} corridas seguem indefinidas — margem dentro do intervalo de incerteza.`,
  ];
}

function insightsSenador(linhas: readonly EdgeUfRow[], corridas: readonly CorridaUf[]): string[] {
  const decididas = linhas.filter(
    (l) => l.bucket === "decidido_1t" || l.bucket === "chamada",
  ).length;
  const disputadas = corridas.filter((c) => {
    const disputa = competidores(c.resultados, destinoPublicadoNaUf(c));
    const seg = disputa[1];
    const ter = disputa[2];
    return seg !== undefined && ter !== undefined && seg.shareFinal - ter.shareFinal < 3;
  }).length;
  return [
    `Senado: 2 vagas por estado, ${linhas.length * 2} em disputa — a soma é nossa, das 27 corridas, não um agregado do TSE.`,
    `${decididas} estados com as duas vagas praticamente definidas.`,
    `${disputadas} estados com disputa pela 2ª vaga dentro de 3 pontos.`,
  ];
}

/**
 * O mapa `sigla → EdgePayloadUf` da corrida PRESIDENCIAL — a votação de cada
 * candidato DENTRO de cada estado.
 *
 * ## Por que este arquivo existe
 *
 * Sem ele, `/uf/SP` não tem de onde tirar a votação estadual e a página cai no
 * bloco nacional: São Paulo aparecia com os 10.475.955 votos do Brasil inteiro
 * e os 35,6% nacionais, com o percentual apurado correto ao lado. É o pior
 * feitio de erro de dado — cada número é plausível sozinho, e a contradição só
 * aparece para quem somar os estados.
 *
 * Os números daqui são a MESMA corrida que alimenta `presidente.json`: o bloco
 * nacional é a soma destas 27 linhas, não um cálculo paralelo. Por construção,
 * Σ votos de um candidato nas 27 UFs == o total nacional dele.
 *
 * ⚠️ `vagas` é **omitido** de propósito: Presidente elege 1 e o contrato manda
 * não emitir o campo (`EdgePayloadUf.vagas`, consumidor ausente ⇒ 1).
 * `p_eleito` também não vai — ali a pergunta certa é `p_vitoria`, e o campo
 * ausente diz "não foi calculado", enquanto um `0` afirmaria "não se elege em
 * cenário nenhum".
 */
export function montarPresidenteUf(
  corridas: readonly CorridaUf[],
  nacionais: readonly EdgeCandidate[],
  ts: string,
): Record<string, EdgePayloadUf> {
  // 🔴 **A cor é do RANK NACIONAL, sempre.** Corrida presidencial é UMA só, e a
  // cor nela é identidade — "quem é este candidato" —, não colocação.
  //
  // A primeira versão usava `colorForRank(r.rank)` com o rank calculado DENTRO
  // da UF. Em São Paulo, onde o segundo colocado nacional lidera, ele herdava o
  // `--color-cand-1` (#d33732, vermelho) que pertence ao líder nacional em todo
  // o resto do produto: o mesmo candidato saía vermelho na home e azul na
  // página do estado. O mapa pintava SP com a cor de um e a página do estado
  // mostrava o outro com a mesma tinta.
  //
  // É a mesma troca que o "color lock" do orchestrator (`lib/utils/cand-color.ts`)
  // impede no TEMPO — congelar o rank quando o candidato cruza 1% apurado —,
  // só que no ESPAÇO. Um congelamento que vale entre dois instantes e não vale
  // entre duas telas não protege coisa nenhuma.
  //
  // ⚠️ Não vale para Governador e Senador: lá cada estado é uma corrida própria,
  // com candidatos próprios, e o rank local É o rank. `montarSenadorUf` e o
  // bloco nacional daqueles cargos seguem com `colorForRank(r.rank)`, e está
  // certo.
  const corPorId = new Map(nacionais.map((c) => [c.id, c.cor]));
  // RF-213 — Presidente: destinação NACIONAL em toda UF (como o produtor).
  const destinoPublicado = destinoPublicadoNoPais(corridas);
  const out: Record<string, EdgePayloadUf> = {};
  for (const c of corridas) {
    const candidatos: EdgeUfCandidate[] = c.resultados.map((r) => ({
      id: r.cand.id,
      nome: r.cand.nome,
      partido: r.cand.partido,
      ...campoDestino(r, destinoPublicado),
      cor: corPorId.get(r.cand.id) ?? colorForRank(r.rank),
      votos_atuais: r.votosAtuais,
      votos_projetados: r.votosProjetados,
      pct_atual: r2(r.shareAtual),
      pct_projetado: r2(r.shareFinal),
      ci95: { lower: r2(r.lower), upper: r2(r.upper) },
      sqcand: r.cand.sqcand,
    }));
    // A ordem é a mesma de `resultados` (rank por projetado), e é isso que
    // garante `candidatos[0].id === por_uf.lider` — salvo se o 1º for uma
    // candidatura anulada (RF-213): aí o `lider` é o 1º que COMPETE, e a
    // agulha também é entre quem compete.
    const disputa = competidores(c.resultados, destinoPublicado);
    const { pos, band } = agulha(disputa[0]?.pVitoria ?? 0, disputa[1]?.pVitoria ?? 0);
    out[c.ctx.uf] = {
      uf: c.ctx.uf,
      ts,
      cargo: 1,
      turno: 1,
      pct_apurado: c.ctx.pctApurado,
      candidatos,
      needle_position: pos,
      needle_band: band,
      granularidade: cargoInfo(1).granularidade,
      // Spec 022 (RF-209) — o agregado DA UF, não o do Brasil.
      votacao: votacaoDaUf(c),
    };
  }
  return out;
}

/** O mapa `sigla → EdgePayloadUf` que as telas estaduais de Senador leem. */
export function montarSenadorUf(
  estadual: CorridaEstadual,
  ts: string,
): Record<string, EdgePayloadUf> {
  const vagas = cargoInfo(5).vagasPorUf ?? 2;
  const out: Record<string, EdgePayloadUf> = {};
  for (const c of estadual.corridas) {
    const publicado = destinoPublicadoNaUf(c);
    // Agulha e vagas entre quem COMPETE (RF-213).
    const disputa = competidores(c.resultados, publicado);
    const lider = disputa[0];
    const segundo = disputa[1];
    const candidatos: EdgeUfCandidate[] = c.resultados.map((r) => ({
      id: r.cand.id,
      nome: r.cand.nome,
      partido: r.cand.partido,
      ...campoDestino(r, publicado),
      cor: colorForRank(r.rank),
      votos_atuais: r.votosAtuais,
      votos_projetados: r.votosProjetados,
      pct_atual: r2(r.shareAtual),
      pct_projetado: r2(r.shareFinal),
      ci95: { lower: r2(r.lower), upper: r2(r.upper) },
      // Numa corrida de duas vagas, `p_vitoria` responde à pergunta errada:
      // o 2º colocado é senador exatamente como o 1º (RF-103).
      p_eleito: r.pEleito,
      sqcand: r.cand.sqcand,
    }));
    // Agulha da UF: distância entre quem já tem a 2ª vaga e quem a disputa.
    const { pos, band } = agulha(segundo?.pEleito ?? 0, disputa[2]?.pEleito ?? 0);
    out[c.ctx.uf] = {
      uf: c.ctx.uf,
      ts,
      cargo: 5,
      turno: 1,
      pct_apurado: c.ctx.pctApurado,
      candidatos,
      needle_position: lider === undefined ? 0 : pos,
      needle_band: lider === undefined ? "tossup" : band,
      vagas,
      granularidade: cargoInfo(5).granularidade,
      // Spec 022 (RF-209). Em VOTOS, `vagas` por eleitor (RF-210): a tela
      // multiplica as pessoas por este mesmo `vagas`.
      votacao: votacaoDaUf(c),
    };
  }
  return out;
}

/**
 * O mapa `sigla → EdgePayloadUf` que as telas estaduais de Governador leem.
 *
 * ## Por que este arquivo passou a existir em 2026-09-19
 *
 * Até esta data, cargo 3 era o único majoritário sem arquivo por UF, e havia
 * uma justificativa escrita para isso em três lugares (`app/(gov)/uf/[sigla]/
 * governador/page.tsx`, `app/api/projection/route.ts` e o § de `sqcand` de
 * `scripts/gerar-outros-fixtures.py` — este terceiro **removido em
 * 2026-09-21**, ver dívida 20): a síntese a partir do payload nacional
 * **filtrada por `por_uf[].top_candidatos`** recorta a corrida daquela UF com a
 * votação dela, porque candidatura a governador só existe num estado. Isso é
 * verdade e continua sendo — mas responde à pergunta errada.
 *
 * A pergunta certa não é "os números do recorte estão certos?", e sim "o
 * recorte tem a corrida INTEIRA?". E não tem: `top_candidatos` é, por
 * definição, `slice(0, TOP_CANDIDATOS_POR_UF)` — hoje **4**. São Paulo tem
 * **7** candidaturas a governador; as 3 da cauda ficam de fora da síntese.
 *
 * Medido em `pnpm dev:sim` antes desta mudança:
 *
 *     GET /api/projection?uf=SP&cargo=gov        → 4 ids (26000..26003)
 *     GET /api/projection/municipios?uf=SP&…=gov → 7 ids (26000..26006)
 *
 * O detalhe municipal reparte os votos entre **todas** as candidaturas, então
 * o balão do hover do coroplético encontra `26004` em `votos_reportados` e não
 * acha ninguém com esse `id` na lista de candidatos que a moldura do mapa
 * recebeu. `lib/utils/municipio-votos.ts` então cai no fallback honesto e
 * escreve **"Candidato 26004"**, sem partido — que é exatamente a queixa que o
 * dono levantou ("o balão mostra Candidato 13 em vez do nome").
 *
 * 🔴 **Em produção o defeito não existe**: lá o `EdgePayloadUf` real de
 * governador é publicado pelo orchestrator com `candidatos[]` completo, e o
 * ramo `?uf=&cargo=gov` da rota lê esse payload em vez de sintetizar. A lacuna
 * era só do modo simulado — mas o simulado é onde o dono confere, então a
 * lacuna estava na tela dele.
 *
 * ## Espelha `montarSenadorUf`, menos nos dois pontos em que os cargos diferem
 *
 * 1. **`vagas` é OMITIDO.** Governador elege 1 (`vagasPorUf: 1`,
 *    `lib/config/cargos.ts`) e o contrato manda não emitir o campo —
 *    `EdgePayloadUf.vagas` diz "consumidor ausente ⇒ 1". Copiar o `vagas: 2`
 *    do Senado faria `<StateResultSheet>` desenhar duas faixas de eleito numa
 *    corrida de um cargo só.
 * 2. **`p_eleito` é OMITIDO.** Ali a pergunta certa é `p_vitoria`: com uma
 *    vaga, liderar decide. O campo ausente diz "não foi calculado"; um `0`
 *    afirmaria "não se elege em cenário nenhum", que é um dado — e falso para
 *    quem tem 26% dos votos. É a mesma regra que `montarPresidenteUf` já segue.
 *
 * A **agulha** segue daí: distância de `p_vitoria` entre 1º e 2º, como no
 * presidencial, e não a distância de `p_eleito` entre 2º e 3º que o Senado usa
 * (lá a fronteira é a 2ª vaga). Governador tem 2º turno (`temSegundoTurno:
 * true`), e o payload sai sempre com `turno: 1` como os demais desta fixture —
 * a simulação é de 1º turno inteira; um `turno: 2` aqui contradiria as outras
 * oito telas sem que nada mais mudasse.
 *
 * `sqcand` vai para TODA candidatura, como em `montarSenadorUf` — este payload
 * é de UMA UF, e o par `(uf, numero)` que o resolve não é ambíguo (spec 018,
 * RF-144). É o que endereça a foto (ADR-0041), e é a razão de o bloco nacional
 * de cargo 3 **não** carregar a chave: lá ela apontaria para o rosto de um
 * candidato de UF arbitrária (bloco 7(b) do cabeçalho deste arquivo).
 */
export function montarGovernadorUf(
  estadual: CorridaEstadual,
  ts: string,
): Record<string, EdgePayloadUf> {
  const out: Record<string, EdgePayloadUf> = {};
  for (const c of estadual.corridas) {
    const publicado = destinoPublicadoNaUf(c);
    // Agulha entre quem COMPETE (RF-213).
    const disputa = competidores(c.resultados, publicado);
    const lider = disputa[0];
    const candidatos: EdgeUfCandidate[] = c.resultados.map((r) => ({
      id: r.cand.id,
      nome: r.cand.nome,
      partido: r.cand.partido,
      ...campoDestino(r, publicado),
      // 🔴 **Sem `cor`**, ao contrário dos dois irmãos acima — e é deliberado,
      // não esquecimento. `EdgeUfCandidate.cor` foi marcado `@deprecated` em
      // 19/09 (`a631a14`: "o produtor para de emitir a cor por colocação"), e
      // no MESMO dia `sintetizarUf` (`app/api/projection/route.ts`) parou de
      // repassá-lo. Quem desenha resolve pela SIGLA (`colorForParty`,
      // ADR-0024/ADR-0031). Emitir o campo num arquivo que nasce hoje
      // reintroduziria a cor por colocação pela porta dos fundos, e o corpo de
      // resposta de `?uf=&cargo=gov` mudaria de forma sem necessidade — hoje
      // ele já sai sem `cor`, pela síntese. `montarSenadorUf` e
      // `montarPresidenteUf` seguem emitindo por herança; podá-los é outra
      // frente.
      votos_atuais: r.votosAtuais,
      votos_projetados: r.votosProjetados,
      pct_atual: r2(r.shareAtual),
      pct_projetado: r2(r.shareFinal),
      ci95: { lower: r2(r.lower), upper: r2(r.upper) },
      // Sem `p_eleito` — ver o ponto 2 da docstring.
      sqcand: r.cand.sqcand,
    }));
    const { pos, band } = agulha(lider?.pVitoria ?? 0, disputa[1]?.pVitoria ?? 0);
    out[c.ctx.uf] = {
      uf: c.ctx.uf,
      ts,
      cargo: 3,
      turno: 1,
      pct_apurado: c.ctx.pctApurado,
      candidatos,
      needle_position: lider === undefined ? 0 : pos,
      needle_band: lider === undefined ? "tossup" : band,
      // Sem `vagas` — ver o ponto 1 da docstring.
      granularidade: cargoInfo(3).granularidade,
      // Spec 022 (RF-209).
      votacao: votacaoDaUf(c),
    };
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Deputado Federal — a corrida PROPORCIONAL
// ═════════════════════════════════════════════════════════════════════════════

export interface CandidatoProporcional {
  sqcand: number;
  nome: string;
  partido: string;
  votos: number;
}

export interface AgremiacaoSim {
  cod: string;
  sigla: string;
  nome: string;
  tipo: "partido" | "federacao";
  componentes: string[];
  siglaLider: string;
  votosNominais: number;
  votosLegenda: number;
  candidatos: CandidatoProporcional[];
}

export interface ResultadoCadeiras {
  qe: number;
  qp: Record<string, number>;
  eleitos: Record<string, CandidatoProporcional[]>;
  suplentes: Record<string, CandidatoProporcional[]>;
  cadeiras: Record<string, number>;
  /** Cadeiras ganhas em rodada de sobra com margem apertada (RF-127). */
  indefinidas: Record<string, number>;
  vagasNaoPreenchidas: number;
  /** Códigos em empate que sobreviveu aos dois desempates da norma. */
  empates: string[];
}

/**
 * QE = votos válidos ÷ lugares, com o arredondamento LITERAL do art. 106.
 *
 * Porte fiel de `api/model/cadeiras.py::quociente_eleitoral`, inclusive no
 * detalhe que parece capricho: **0,5 exato DESCE** ("desprezada a fração se
 * igual ou inferior a meio"). `Math.round` sobe, e a comparação é feita em
 * inteiros (`2·resto > lugares`) para não haver erro de representação.
 */
export function quocienteEleitoral(votosValidos: number, lugares: number): number {
  if (lugares < 1) throw new Error(`lugares deve ser >= 1, recebido ${lugares}`);
  if (votosValidos < 0) throw new Error(`votos não pode ser negativo: ${votosValidos}`);
  const inteiro = Math.floor(votosValidos / lugares);
  const resto = votosValidos - inteiro * lugares;
  return 2 * resto > lugares ? inteiro + 1 : inteiro;
}

/**
 * Distribui as cadeiras de uma UF — porte do ADR-0027 / `api/model/cadeiras.py`.
 *
 * **É um porte, não uma segunda fonte de verdade.** A implementação canônica é
 * a Python, que roda na apuração real; esta existe porque o gerador é um script
 * TypeScript e chamar o Python daqui custaria mais do que o valor de uma
 * fixture de desenvolvimento. As fases e os pisos são os mesmos — se
 * divergirem, quem está certa é a Python.
 *
 *   0. Quociente eleitoral (art. 106).
 *   1. Quociente partidário e vagas diretas, com o piso de 10% do QE por
 *      candidato (arts. 107 e 108).
 *   2. Sobras restritas: só agremiações com ≥80% do QE e candidato não eleito
 *      com ≥20% do QE (art. 109 I/II + § 2º).
 *   3. Sobras abertas: esgotada a fase 2, todos participam sem piso (art. 109
 *      III na interpretação das ADIs 7228/7263/7325).
 *
 * As médias são comparadas por multiplicação cruzada em inteiros, nunca por
 * divisão em `float`: duas médias que empatam na matemática podem diferir no
 * 17º dígito em ponto flutuante, e o desempate da norma nunca chegaria a rodar.
 */
export function distribuirCadeiras(
  ags: readonly AgremiacaoSim[],
  lugares: number,
): ResultadoCadeiras {
  if (lugares < 1) throw new Error(`lugares deve ser >= 1, recebido ${lugares}`);
  const cods = ags.map((a) => a.cod);
  if (new Set(cods).size !== cods.length) {
    throw new Error(`código de agremiação repetido: ${cods.sort().join(", ")}`);
  }

  const votos: Record<string, number> = {};
  for (const a of ags) votos[a.cod] = a.votosNominais + a.votosLegenda;
  const votosValidos = Object.values(votos).reduce((x, y) => x + y, 0);
  const qe = quocienteEleitoral(votosValidos, lugares);

  const eleitos: Record<string, CandidatoProporcional[]> = {};
  const vagasObtidas: Record<string, number> = {};
  const qp: Record<string, number> = {};
  const indefinidas: Record<string, number> = {};
  const fila: Record<string, CandidatoProporcional[]> = {};
  for (const a of ags) {
    eleitos[a.cod] = [];
    vagasObtidas[a.cod] = 0;
    qp[a.cod] = 0;
    indefinidas[a.cod] = 0;
    // Ordem de ocupação: mais votos primeiro, desempate por `sqcand` ASC —
    // declarado, porque "ordem de chegada do dado" faria o resultado depender
    // de como o banco serializou as linhas (constituição § 6).
    fila[a.cod] = [...a.candidatos].sort((x, y) => y.votos - x.votos || x.sqcand - y.sqcand);
  }

  if (qe < 1) {
    return {
      qe,
      qp,
      eleitos,
      suplentes: Object.fromEntries(
        ags.map((a) => [a.cod, [...(fila[a.cod] as CandidatoProporcional[])]]),
      ),
      cadeiras: Object.fromEntries(ags.map((a) => [a.cod, 0])),
      indefinidas,
      vagasNaoPreenchidas: lugares,
      empates: [],
    };
  }

  // ── Fase 1 — quociente partidário e vagas diretas ─────────────────────────
  for (const a of ags) {
    qp[a.cod] = Math.floor((votos[a.cod] as number) / qe);
    // `vagasObtidas` recebe o QP INTEIRO, não o que for ocupado: é o
    // denominador da média (Res. 23.677 art. 11 § 5º, ADI 5.420).
    vagasObtidas[a.cod] = qp[a.cod] as number;
    const elegiveis = (fila[a.cod] as CandidatoProporcional[]).filter((c) => c.votos * 10 >= qe);
    for (const c of elegiveis.slice(0, qp[a.cod] as number)) {
      (eleitos[a.cod] as CandidatoProporcional[]).push(c);
    }
  }

  const proximo = (cod: string, piso: number | null): CandidatoProporcional | null => {
    const ja = new Set((eleitos[cod] as CandidatoProporcional[]).map((c) => c.sqcand));
    for (const c of fila[cod] as CandidatoProporcional[]) {
      if (ja.has(c.sqcand)) continue;
      if (piso !== null && c.votos < piso) continue;
      return c;
    }
    return null;
  };

  const empates: string[] = [];

  /** Uma rodada de sobra. `false` quando não há mais candidato elegível. */
  const rodada = (restrita: boolean): boolean => {
    const pisoCand = restrita ? qe / 5 : null;
    const concorrentes = ags
      .filter((a) => !(restrita && (votos[a.cod] as number) * 5 < 4 * qe))
      .filter((a) => proximo(a.cod, pisoCand) !== null)
      .map((a) => a.cod);
    if (concorrentes.length === 0) return false;

    const chave = (cod: string) => ({
      v: votos[cod] as number,
      d: (vagasObtidas[cod] as number) + 1,
      nominal: proximo(cod, pisoCand)?.votos ?? 0,
    });
    // `a.v/a.d` vs `b.v/b.d` sem divisão — ver o comentário do cabeçalho.
    const compara = (ca: string, cb: string): number => {
      const a = chave(ca);
      const b = chave(cb);
      const esq = a.v * b.d;
      const dir = b.v * a.d;
      if (esq !== dir) return esq > dir ? 1 : -1;
      if (a.v !== b.v) return a.v > b.v ? 1 : -1; // § 6º — maior votação total
      if (a.nominal !== b.nominal) return a.nominal > b.nominal ? 1 : -1; // § 7º
      return 0;
    };

    const ordenados = [...concorrentes].sort((x, y) => compara(y, x) || x.localeCompare(y));
    const melhor = ordenados[0] as string;
    const vice = ordenados[1];

    // Empate que a norma NÃO resolve: mesma média, mesma votação total, mesma
    // votação nominal. Registrado para a tela marcar como indeterminado —
    // nunca escolhido por critério inventado (spec 017, open question 3).
    if (vice !== undefined && compara(melhor, vice) === 0) {
      if (!empates.includes(melhor)) empates.push(melhor);
      if (!empates.includes(vice)) empates.push(vice);
    } else if (vice !== undefined) {
      // Sobra apertada — a cadeira sai, mas com a firmeza que o cálculo tem.
      const a = chave(melhor);
      const b = chave(vice);
      if (b.v * a.d * 100 >= a.v * b.d * 99) {
        indefinidas[melhor] = (indefinidas[melhor] as number) + 1;
      }
    }

    const cand = proximo(melhor, pisoCand);
    if (cand === null) return false;
    (eleitos[melhor] as CandidatoProporcional[]).push(cand);
    vagasObtidas[melhor] = (vagasObtidas[melhor] as number) + 1;
    return true;
  };

  let ocupadas = ags.reduce((a, x) => a + (eleitos[x.cod] as CandidatoProporcional[]).length, 0);
  let restantes = lugares - ocupadas;
  while (restantes > 0 && rodada(true)) restantes--;
  while (restantes > 0 && rodada(false)) restantes--;

  ocupadas = ags.reduce((a, x) => a + (eleitos[x.cod] as CandidatoProporcional[]).length, 0);

  const suplentes: Record<string, CandidatoProporcional[]> = {};
  const cadeiras: Record<string, number> = {};
  for (const a of ags) {
    const ja = new Set((eleitos[a.cod] as CandidatoProporcional[]).map((c) => c.sqcand));
    suplentes[a.cod] = (fila[a.cod] as CandidatoProporcional[])
      .filter((c) => !ja.has(c.sqcand))
      .slice(0, 5);
    cadeiras[a.cod] = (eleitos[a.cod] as CandidatoProporcional[]).length;
  }

  return {
    qe,
    qp,
    eleitos,
    suplentes,
    cadeiras,
    indefinidas,
    vagasNaoPreenchidas: lugares - ocupadas,
    empates: empates.sort(),
  };
}

/**
 * Monta as agremiações de uma UF a partir das candidaturas reais.
 *
 * O peso de cada legenda parte do **número de candidaturas que ela de fato
 * lançou naquele estado** — que é dado medido, não sorteio —, amaciado por
 * expoente 0,85 e perturbado pela seed. Um partido com 100 nomes em SP e outro
 * com 4 não podem sair com a mesma bancada, e é esse o sinal que existe no
 * banco.
 *
 * Federação é UMA agremiação (RF-122). Coligação em proporcional não existe
 * desde a EC 97/2017, e por isso não há esse ramo aqui.
 */
/**
 * `chave da agremiação → cod`, calculado sobre o cadastro INTEIRO.
 *
 * 🔴 Tem de ser global, e a primeira versão disto não era. O `cod` saía do menor
 * `partido_numero` **entre os componentes presentes naquela UF** — e uma
 * federação não lança os mesmos partidos nos 27 estados. Onde só o PSDB tinha
 * lista, o cod era o do PSDB; onde PSDB e CIDADANIA tinham, era o do CIDADANIA.
 * A reconciliação nacional, que casa por `cod`, então via **duas agremiações**
 * e a tela mostrava "PSDB/CIDADANIA" duas vezes, com 29 e 9 cadeiras.
 *
 * O `cod` é a identidade da agremiação (`agr[].n` no EA20, estável
 * nacionalmente). Derivá-lo de um recorte estadual é o mesmo erro de categoria
 * que o ADR-0042 documenta para `sqcand`.
 */
export function codPorAgremiacao(dados: DadosSimulacao): Record<string, string> {
  const menor = new Map<string, number>();
  for (const c of dados.candidatos) {
    const chave = c.federacao_sigla ?? c.partido_sigla;
    const atual = menor.get(chave);
    if (atual === undefined || c.partido_numero < atual) menor.set(chave, c.partido_numero);
  }
  const out: Record<string, string> = {};
  // Ordem de chave ASC só para o objeto sair determinístico na inspeção.
  for (const chave of [...menor.keys()].sort()) out[chave] = String(menor.get(chave));
  return out;
}

export function montarAgremiacoesUf(
  dados: DadosSimulacao,
  rng: Rng,
  uf: string,
  totalValidos: number,
  cods: Readonly<Record<string, string>>,
): AgremiacaoSim[] {
  const doUf = dados.candidatos
    .filter((c) => c.cargo === 6 && c.uf === uf)
    .sort((a, b) => a.numero - b.numero || (a.sq_candidato < b.sq_candidato ? -1 : 1));

  const grupos = new Map<string, CandidatoBruto[]>();
  for (const c of doUf) {
    const chave = c.federacao_sigla ?? c.partido_sigla;
    const cur = grupos.get(chave);
    if (cur) cur.push(c);
    else grupos.set(chave, [c]);
  }

  const chaves = [...grupos.keys()].sort();
  const tamanhos = chaves.map((k) => (grupos.get(k) as CandidatoBruto[]).length);
  const medianaCand = [...tamanhos].sort((a, b) => a - b)[Math.floor(tamanhos.length / 2)] ?? 1;
  const forcaUfMap = dados.forcaCamaraUf[uf] ?? {};

  // 🔴 O peso da legenda é ANCORADO em 2022, não no tamanho da lista.
  //
  // A primeira versão pesava só por `g.length ** 0.85` — quantas candidaturas a
  // legenda lançou naquele estado. É sinal real, mas quase plano: todo partido
  // lança lista cheia. O resultado foram 26 agremiações empatadas em torno de
  // 32 cadeiras, com o NOVO como maior bancada da Câmara. Uma Câmara é o
  // oposto disso — quatro ou cinco legendas grandes e uma cauda longa —, e é
  // justamente a hierarquia que o gráfico de bancada existe para mostrar.
  const pesos = chaves.map((k, i) => {
    const g = grupos.get(k) as CandidatoBruto[];
    const componentes = [...new Set(g.map((c) => c.partido_sigla))];
    // Federação soma a força dos componentes — ela É uma agremiação (RF-122).
    const fNac = componentes.reduce(
      (a, sigla) => a + (dados.forcaCamaraNacional[sigla] ?? dados.pisoForcaCamara),
      0,
    );
    const fUf = componentes.reduce((a, sigla) => a + (forcaUfMap[sigla] ?? 0), 0);
    // Partido que não lançou governador naquela UF em 2022 não é punido por
    // isso: cai inteiro no nacional. Onde houve medição na UF, ela pesa 45% —
    // o bastante para o líder mudar de estado para estado sem que uma única
    // eleição estadual de 2022 decida a bancada de 2026 sozinha.
    const base = fUf > 0 ? 0.45 * fUf + 0.55 * fNac : fNac;
    // O tamanho da lista continua contando, mas amortecido (expoente 0,30):
    // é informação real sobre estrutura partidária no estado, e não pode
    // voltar a dominar.
    const escala = ((tamanhos[i] as number) / Math.max(1, medianaCand)) ** 0.3;
    return Math.max(1e-6, base * escala * Math.exp(rng.derive(`peso|${uf}|${k}`).normal() * 0.3));
  });
  const totais = alocarInteiros(totalValidos, pesos);

  return chaves.map((chave, i) => {
    const g = grupos.get(chave) as CandidatoBruto[];
    const total = totais[i] as number;
    const r = rng.derive(`ag|${uf}|${chave}`);
    // Voto de legenda entre 4% e 9% do total da agremiação — separado, nunca
    // somado em silêncio: legenda decide cadeira (RF-130).
    const legenda = Math.round(total * r.entre(0.04, 0.09));
    const nominais = total - legenda;

    // Votos nominais por candidatura: Zipf sobre uma ordem embaralhada pela
    // seed. A cabeça de chapa leva a maior parte, como numa lista real.
    const ordem = r.derive("ordem").embaralhar(g);
    const zipf = ordem.map((_, k) => 1 / (k + 1) ** 1.15);
    const votosCand = alocarInteiros(nominais, zipf);
    const candidatos: CandidatoProporcional[] = ordem.map((c, k) => ({
      sqcand: Number(c.sq_candidato),
      nome: c.nome_urna,
      partido: c.partido_sigla,
      votos: votosCand[k] as number,
    }));

    const ehFed = g[0]?.federacao_sigla !== null && g[0]?.federacao_sigla !== undefined;
    const componentes = ehFed ? [...new Set(g.map((c) => c.partido_sigla))].sort() : [];

    // O partido que dá a COR (ADR-0024): componente com mais votos nominais,
    // desempatado por sigla ASC. Sem o desempate, a mesma federação mudaria de
    // cor entre dois ciclos, e o ADR exige cor estável a noite toda.
    const porPartido = new Map<string, number>();
    for (const c of candidatos)
      porPartido.set(c.partido, (porPartido.get(c.partido) ?? 0) + c.votos);
    const siglaLider = ehFed
      ? ([...porPartido.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        )[0]?.[0] ?? chave)
      : chave;

    // `cod` vem do mapa GLOBAL (ver `codPorAgremiacao`), nunca dos componentes
    // presentes nesta UF — foi assim que a mesma federação virou duas linhas na
    // bancada nacional.
    const numeros = g.map((c) => c.partido_numero).sort((a, b) => a - b);
    const cod = cods[chave] ?? String(numeros[0] ?? 0);

    return {
      cod,
      sigla: chave,
      nome: ehFed ? chave : (dados.nomePartido[numeros[0] ?? 0] ?? chave),
      tipo: ehFed ? ("federacao" as const) : ("partido" as const),
      componentes,
      siglaLider,
      votosNominais: nominais,
      votosLegenda: legenda,
      candidatos,
    };
  });
}

export interface SaidaDeputado {
  payload: EdgePayloadDeputado;
  porUf: Record<string, DeputadoUfDetail>;
}

export function montarDeputado(
  dados: DadosSimulacao,
  ctxs: readonly ContextoUf[],
  rng: Rng,
  ts: string,
): SaidaDeputado {
  const r = rng.derive("dep");
  // Calculado UMA vez, sobre o cadastro inteiro — ver `codPorAgremiacao`.
  const cods = codPorAgremiacao(dados);
  const porUf: Record<string, DeputadoUfDetail> = {};
  const linhas: EdgePayloadDeputado["por_uf"] = [];

  /** Acumulador nacional, reconciliado por `cod` de agremiação (RF-122). */
  const nacional = new Map<
    string,
    {
      cod: string;
      sigla: string;
      nome: string;
      tipo: "partido" | "federacao";
      componentes: string[];
      porPartido: Map<string, number>;
      cadeiras: number;
      indefinidas: number;
      nominais: number;
      legenda: number;
    }
  >();

  let ufsCalculadas = 0;

  for (const ctx of ctxs) {
    const lugares = dados.cadeirasPorUf[ctx.uf];
    if (lugares === undefined) throw new Error(`Sem lugares_a_preencher para ${ctx.uf}`);

    // UF sem boletim: `lugares_a_preencher` continua sendo FATO (vem da tabela
    // do TSE), mas quociente e cadeiras ficam `null`/0 — um zero no quociente
    // leria como "o quociente é zero", que é outra afirmação.
    if (ctx.pctApurado <= 0 || ctx.votosApurados <= 0) {
      porUf[ctx.uf] = {
        ts,
        cargo: 6,
        turno: 1,
        uf: ctx.uf,
        pct_apurado: ctx.pctApurado,
        lugares_a_preencher: lugares,
        quociente_eleitoral: null,
        quociente_eleitoral_tse: null,
        totalizacao_final: false,
        divergencias: [],
        agremiacoes: [],
        vagas_nao_preenchidas: lugares,
        empates_indeterminados: [],
        votacao: votacaoDeputadoUf(ctx),
      };
      linhas.push({
        sigla: ctx.uf,
        pct_apurado: ctx.pctApurado,
        lugares_a_preencher: lugares,
        quociente_eleitoral: null,
        cadeiras_definidas: 0,
        vagas_nao_preenchidas: lugares,
        empates_indeterminados: 0,
        lider: null,
      });
      continue;
    }

    ufsCalculadas++;
    const ags = montarAgremiacoesUf(dados, r, ctx.uf, ctx.votosApurados, cods);
    const res = distribuirCadeiras(ags, lugares);
    const validosUf = ags.reduce((a, x) => a + x.votosNominais + x.votosLegenda, 0);

    const agremiacoes: DeputadoUfAgremiacao[] = ags
      .map((a) => {
        const validos = a.votosNominais + a.votosLegenda;
        const paraCand = (c: CandidatoProporcional, i: number): DeputadoUfCandidato => ({
          sqcand: c.sqcand,
          nome: c.nome,
          partido: c.partido,
          votos: c.votos,
          ordem: i + 1,
        });
        const eleitos = (res.eleitos[a.cod] as CandidatoProporcional[]).map(paraCand);
        const indef = res.indefinidas[a.cod] as number;
        // As cadeiras marcadas como indefinidas são as ÚLTIMAS da lista: são
        // as ganhas em rodada de sobra apertada (RF-127).
        for (let k = eleitos.length - indef; k < eleitos.length; k++) {
          const e = eleitos[k];
          if (e !== undefined) e.indefinido = true;
        }
        const linha: DeputadoUfAgremiacao = {
          cod: a.cod,
          sigla: a.sigla,
          nome: a.nome,
          tipo: a.tipo,
          componentes: a.componentes,
          sigla_lider: a.siglaLider,
          votos_nominais: a.votosNominais,
          votos_legenda: a.votosLegenda,
          votos_validos: validos,
          pct_votos: r2((100 * validos) / Math.max(1, validosUf)),
          quociente_partidario: res.qp[a.cod] as number,
          cadeiras: res.cadeiras[a.cod] as number,
          eleitos,
          suplentes: (res.suplentes[a.cod] as CandidatoProporcional[]).map(paraCand),
        };
        return linha;
      })
      // Determinismo declarado: cadeiras desc, depois sigla asc.
      .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla, "pt-BR"));

    porUf[ctx.uf] = {
      ts,
      cargo: 6,
      turno: 1,
      uf: ctx.uf,
      pct_apurado: ctx.pctApurado,
      lugares_a_preencher: lugares,
      quociente_eleitoral: res.qe,
      // Numa simulação não existe TSE para divergir: o quociente "deles" é o
      // nosso. Inventar uma divergência aqui poria na tela um conflito que não
      // aconteceu (constituição § 8 vale nos dois sentidos).
      quociente_eleitoral_tse: res.qe,
      totalizacao_final: false,
      divergencias: [],
      agremiacoes,
      vagas_nao_preenchidas: res.vagasNaoPreenchidas,
      empates_indeterminados: res.empates,
      votacao: votacaoDeputadoUf(ctx),
    };

    const lider = agremiacoes[0];
    linhas.push({
      sigla: ctx.uf,
      pct_apurado: ctx.pctApurado,
      lugares_a_preencher: lugares,
      quociente_eleitoral: res.qe,
      cadeiras_definidas: agremiacoes.reduce((a, x) => a + x.cadeiras, 0),
      vagas_nao_preenchidas: res.vagasNaoPreenchidas,
      empates_indeterminados: res.empates.length,
      lider:
        lider === undefined
          ? null
          : { cod: lider.cod, sigla: lider.sigla, cadeiras: lider.cadeiras },
    });

    for (const a of ags) {
      const cur = nacional.get(a.cod) ?? {
        cod: a.cod,
        sigla: a.sigla,
        nome: a.nome,
        tipo: a.tipo,
        componentes: a.componentes,
        porPartido: new Map<string, number>(),
        cadeiras: 0,
        indefinidas: 0,
        nominais: 0,
        legenda: 0,
      };
      cur.cadeiras += res.cadeiras[a.cod] as number;
      cur.indefinidas += res.indefinidas[a.cod] as number;
      cur.nominais += a.votosNominais;
      cur.legenda += a.votosLegenda;
      for (const c of a.candidatos) {
        cur.porPartido.set(c.partido, (cur.porPartido.get(c.partido) ?? 0) + c.votos);
      }
      nacional.set(a.cod, cur);
    }
  }

  const validosNacionais = [...nacional.values()].reduce((a, x) => a + x.nominais + x.legenda, 0);
  const porAgremiacao: EdgeAgremiacaoBancada[] = [...nacional.values()]
    .map((a) => {
      const validos = a.nominais + a.legenda;
      const linha: EdgeAgremiacaoBancada = {
        cod: a.cod,
        sigla: a.sigla,
        nome: a.nome,
        tipo: a.tipo,
        // UNIÃO dos componentes vistos nas 27 UFs, não os da primeira UF lida.
        // Mesmo erro de categoria do `cod`: uma federação não lança os mesmos
        // partidos em todo estado, e `componentes` da primeira UF alfabética
        // fazia a bancada nacional do PSOL/REDE se declarar só "PSOL".
        componentes:
          a.tipo === "federacao" ? [...a.porPartido.keys()].sort((x, y) => x.localeCompare(y)) : [],
        // Líder nacional = componente com mais votos nominais SOMADOS nas 27
        // UFs — não a moda dos líderes estaduais. Pode divergir do líder de uma
        // UF específica, e isso é esperado, não defeito.
        sigla_lider:
          a.tipo === "federacao"
            ? ([...a.porPartido.entries()].sort(
                (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
              )[0]?.[0] ?? a.sigla)
            : a.sigla,
        cadeiras: a.cadeiras,
        votos_nominais: a.nominais,
        votos_legenda: a.legenda,
        votos_validos: validos,
        pct_votos: r2((100 * validos) / Math.max(1, validosNacionais)),
      };
      if (a.indefinidas > 0) linha.cadeiras_indefinidas = a.indefinidas;
      return linha;
    })
    .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla, "pt-BR"));

  const totalCadeiras = Object.values(dados.cadeirasPorUf).reduce((a, b) => a + b, 0);
  const atribuidas = porAgremiacao.reduce((a, x) => a + x.cadeiras, 0);
  const pct = pctNacional(ctxs);

  const payload: EdgePayloadDeputado = {
    ts,
    cargo: 6,
    turno: 1,
    pct_apurado_total: r1(pct),
    ufs_apuradas: ufsApuradas(linhas),
    // Lido da fixture do repositório, não digitado: a cadência é dado
    // (design 017 D8), e a tela DERIVA o texto deste número.
    atualizacao_min: dados.atualizacaoMin,
    bancada: {
      total_cadeiras: totalCadeiras,
      cadeiras_atribuidas: atribuidas,
      ufs_calculadas: ufsCalculadas,
      ufs_aguardando: ctxs.length - ufsCalculadas,
      por_agremiacao: porAgremiacao,
    },
    votacao: blocoVotacao(ctxs),
    por_uf: linhas,
    insights: [
      `Câmara: ${pt(atribuidas)} de ${pt(totalCadeiras)} cadeiras já atribuídas — a soma é nossa, das ${ufsCalculadas} corridas estaduais com boletim, não um agregado nacional do TSE.`,
      `${porAgremiacao[0]?.sigla ?? "—"} é a maior bancada projetada, com ${pt(porAgremiacao[0]?.cadeiras ?? 0)} cadeiras.`,
      `${pt(porAgremiacao.reduce((a, x) => a + (x.cadeiras_indefinidas ?? 0), 0))} cadeiras saíram de rodada de sobra apertada e estão marcadas como indefinidas.`,
    ],
    composition: composicao(pct),
  };

  return { payload, porUf };
}

// ═════════════════════════════════════════════════════════════════════════════
// Detalhe municipal — o mapa por dentro do estado
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Escala `vel` por um fator único até que a média de `alvo` ponderada por
 * `pesos` bata o alvo, com os valores já arredondados a 1 casa e limitados a
 * [0, 100].
 *
 * Mesma bisseção de `distribuirPctPorUf`, e pela mesma razão: o teto de 100%
 * torna a relação não-linear, e o arredondamento tem de entrar ANTES da
 * conferência — senão o arquivo diz uma coisa e a prova, outra.
 */
function escalarParaMedia(
  alvo: number,
  pesos: readonly number[],
  vel: readonly number[],
): number[] {
  const total = pesos.reduce((a, b) => a + b, 0);
  const comFator = (f: number) => vel.map((v) => r1(Math.min(100, Math.max(0, alvo * f * v))));
  const media = (xs: readonly number[]) =>
    xs.reduce((a, x, i) => a + x * (pesos[i] as number), 0) / Math.max(1, total);
  if (alvo <= 0 || total <= 0) return comFator(0);
  let lo = 0;
  let hi = 64;
  let melhor = comFator(1);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    melhor = comFator(mid);
    const m = media(melhor);
    if (Math.abs(m - alvo) < 1e-6) break;
    if (m < alvo) lo = mid;
    else hi = mid;
  }
  return melhor;
}

/** Quantos pontos a série temporal de uma UF carrega, e o passo entre eles. */
const SERIE_PONTOS = 24;
const SERIE_PASSO_MIN = 5;

/**
 * Série da noite de uma UF: `turnout` monotônico não-decrescente (RF-042),
 * `margem` e `p_vitoria` do líder convergindo para o valor de agora.
 *
 * 24 pontos a 5 minutos — duas horas de apuração. Um ponto só transformaria o
 * gráfico numa coluna, que é a única coisa que não dá para avaliar num gráfico
 * de série temporal.
 *
 * A margem começa mais ruidosa e vai assentando: no início da noite as
 * primeiras zonas apuradas não são amostra representativa do estado, e é isso
 * que o leitor vê balançar.
 */
function serieDaUf(
  rng: Rng,
  corrida: CorridaUf,
  tsFinal: string,
  destinoPublicado: boolean,
): EdgeUfSeriesTemporais {
  const fim = Date.parse(tsFinal);
  // Margem e p_vitoria do líder entre quem COMPETE (RF-213).
  const disputa = competidores(corrida.resultados, destinoPublicado);
  const lider = disputa[0];
  const segundo = disputa[1];
  const margemFinal = (lider?.shareAtual ?? 0) - (segundo?.shareAtual ?? 0);
  const pFinal = lider?.pVitoria ?? 0;
  const serie: EdgeUfSeriesTemporais = { margem: [], p_vitoria: [], turnout: [] };

  for (let k = 1; k <= SERIE_PONTOS; k++) {
    const t = new Date(fim - (SERIE_PONTOS - k) * SERIE_PASSO_MIN * 60_000).toISOString();
    const frac = k / SERIE_PONTOS;
    // Expoente < 1: a apuração corre rápido no começo e desacelera, que é a
    // forma real da curva — uma reta contaria outra história.
    const pctT = r1(corrida.ctx.pctApurado * frac ** 0.75);
    serie.turnout.push({ ts: t, pct_apurado: pctT });
    const ruido = (1 - frac) * 4.5 * rng.normal();
    serie.margem.push({ ts: t, margem_pp: r2(margemFinal + ruido) });
    serie.p_vitoria.push({
      ts: t,
      p: r4(Math.min(1, Math.max(0, pFinal + (1 - frac) * 0.22 * rng.normal()))),
    });
  }
  return serie;
}

/**
 * Cargos que ganham detalhe municipal no simulado.
 *
 * Tabela de união literal, não `string`: é ela que dá nome ao arquivo
 * (`municipios-<cargo>-t1.json`) e preenche `UfDetailBlob.cargo`. Um cargo novo
 * sem entrada aqui é erro de compilação — que é o oposto do conversor com ramo
 * `default`, o defeito que esta base já pagou três vezes.
 *
 * `dep` está fora: Deputado Federal não tem detalhe municipal (o drill-down do
 * cargo 6 é `deputado-uf.json`, por agremiação, ADR-0026).
 */
export type CargoMunicipal = "pres" | "gov" | "sen";

/**
 * O mapa `sigla → UfDetailBlob` com os 5.570 municípios reais, para UM cargo.
 *
 * ⚠️ `cargo` aqui é a string `"pres" | "gov" | "sen"`, **não** o `1 | 3 | 5`
 * numérico dos payloads de Global Config: `UfDetailBlob.cargo` é o `Cargo` de
 * `lib/config/calendar`, e existem dois tipos com esse nome no repositório.
 * Conferido contra `tests/fixtures/blob/uf-municipios-pres-t1.json`.
 *
 * A textura interna do estado importa: municípios grandes e a capital apuram
 * mais devagar que as cidades pequenas — é essa diferença que o mapa municipal
 * existe para mostrar, e um estado pintado de um tom só não mostra nada. A
 * média ponderada pelo eleitorado volta a bater o `pct_apurado` da UF, o que
 * mantém a coerência com os outros arquivos.
 *
 * ===== 2026-09-19 — a função deixa de ser presidencial =====
 *
 * Ela recebia `corridasPres` e cravava `cargo: "pres"`. O resultado era que
 * `/uf/<sigla>/governador` e `/uf/<sigla>/senador` nunca tiveram mapa municipal
 * em `pnpm dev:sim` — as fixtures dos dois cargos existiam com `municipios: []`
 * e a tela mostrava o estado `"empty"`.
 *
 * 🔴 **O `rng` NÃO é derivado por cargo, e isso é decisão.** `r =
 * rng.derive("municipios")` é o mesmo nos três, então eleitorado, velocidade de
 * apuração e `pct_apurado` de cada município saem IDÊNTICOS nas três corridas —
 * que é o que o mundo faz: a mesma urna publica os quatro cargos de uma vez, e
 * um município 40% apurado no Presidente e 12% no Governador seria um estado
 * impossível pintado lado a lado nas duas telas. O que muda entre cargos é a
 * repartição dos votos, porque `corrida.resultados` é outro.
 *
 * Efeito colateral aproveitado: como a derivação não mudou, o
 * `municipios-pres-t1.json` sai byte a byte igual ao de antes desta mudança.
 */
export function montarMunicipios(
  dados: DadosSimulacao,
  ctxs: readonly ContextoUf[],
  corridas: readonly CorridaUf[],
  rng: Rng,
  ts: string,
  cargo: CargoMunicipal,
): Record<string, UfDetailBlob> {
  const r = rng.derive("municipios");
  const out: Record<string, UfDetailBlob> = {};

  for (const ctx of ctxs) {
    const corrida = corridas.find((c) => c.ctx.uf === ctx.uf);
    if (corrida === undefined) throw new Error(`Sem corrida de ${cargo} para ${ctx.uf}`);
    // RF-213 — a destinação que decide: a nacional no Presidente, a da UF nos
    // outros dois (a MESMA regra das listas e de `por_uf[].lider`).
    const destinoPublicado =
      cargo === "pres" ? destinoPublicadoNoPais(corridas) : destinoPublicadoNaUf(corrida);
    const muns = dados.municipios.filter((m) => m.uf === ctx.uf);
    if (muns.length === 0) throw new Error(`Sem municípios para ${ctx.uf}`);

    // Peso: eleitorado do município; sem ele, a população; sem as duas, 1. O
    // total é redistribuído para fechar EXATAMENTE com o eleitorado da UF, o
    // que faz o caso do DF (1 município, zero linhas de eleitorado) sair certo
    // sem ramo especial.
    const pesos = muns.map((m) =>
      m.aptos > 0 ? m.aptos : m.populacao > 0 ? m.populacao * 0.7 : 1,
    );
    const eleitores = alocarInteiros(ctx.eleitores, pesos);

    const mediana = [...eleitores].sort((a, b) => a - b)[Math.floor(eleitores.length / 2)] ?? 1;
    const vel = muns.map((m, i) => {
      const e = Math.max(1, eleitores[i] as number);
      const porte = (e / Math.max(1, mediana)) ** -0.18;
      const jitter = Math.exp(r.derive(`vel|${m.cod_ibge}`).normal() * 0.28);
      // Capital é o maior colégio e o que mais demora — vale como classe
      // própria porque é o município que o leitor procura primeiro no mapa.
      return Math.max(0.05, porte * jitter * (m.capital ? 0.85 : 1));
    });
    const pcts = escalarParaMedia(ctx.pctApurado, eleitores, vel);

    // Votos apurados por município repartidos A PARTIR do total da UF (peso =
    // eleitorado × percentual apurado), e não calculados um a um. É o que faz
    // Σ municípios == votos apurados da UF exatamente, sem resto órfão.
    //
    // `corrida.ctx`, não `ctx`: no Senado (RF-210) os votos da corrida estão
    // na escala de 2 por eleitor, e as duas margens de `alocarMatriz` têm de
    // somar o mesmo total. Nos outros cargos é o mesmo objeto.
    const apuradosPorMun = alocarInteiros(
      corrida.ctx.votosApurados,
      eleitores.map((e, i) => e * (pcts[i] as number)),
    );

    // Preferência de cada município por cada candidatura: o share da UF com um
    // pendor municipal. As duas margens — total do município e total do
    // candidato na UF — são fechadas por `alocarMatriz`, para que a página do
    // município e a do estado nunca se contradigam.
    const preferencia = muns.map((m, i) => {
      const rm = r.derive(`mun|${m.cod_ibge}`);
      void i;
      return corrida.resultados.map((res, k) =>
        Math.max(1e-9, res.shareAtual * Math.exp(rm.normal() * (k < 4 ? 0.3 : 0.08))),
      );
    });
    const matriz = alocarMatriz(
      apuradosPorMun,
      corrida.resultados.map((res) => res.votosAtuais),
      preferencia,
    );

    const municipios: EdgeUfMunicipio[] = muns.map((m, i) => {
      const el = eleitores[i] as number;
      const pct = pcts[i] as number;
      const apurados = apuradosPorMun[i] as number;
      const votos = matriz[i] as number[];

      const reportados: Record<number, number> = {};
      let v1 = -1;
      let v2 = -1;
      let lider: ResultadoCandUf | undefined;
      corrida.resultados.forEach((res, k) => {
        const v = votos[k] as number;
        // Sparse por contrato (`EdgeUfMunicipio.votos_reportados`): quem não
        // teve voto neste município não ocupa bytes em 5.570 objetos.
        if (v > 0) reportados[res.cand.id] = v;
        // ADR-0053 / RF-213 — a anulada tem voto (fica em `votos_reportados`)
        // mas não disputa: não lidera o município nem pinta o mapa, e a
        // margem é sobre o 2º que COMPETE. Sub judice compete.
        if (destinoPublicado && res.destino === "anulado") return;
        if (v > v1) {
          v2 = v1;
          v1 = v;
          lider = res;
        } else if (v > v2) v2 = v;
      });

      const linha: EdgeUfMunicipio = {
        cod_ibge: m.cod_ibge,
        nome: m.nome,
        pct_apurado: pct,
        lider: {
          candidato_id: lider?.cand.id ?? 0,
          partido: lider?.cand.partido ?? "—",
          votos: Math.max(0, v1),
          // Margem em pp sobre o 2º, sempre ≥ 0, sobre os votos do município.
          margem_pp: apurados > 0 ? r2((100 * (Math.max(0, v1) - Math.max(0, v2))) / apurados) : 0,
        },
        votos_reportados: reportados,
        eleitores: el,
      };
      // Emitido só quando verdadeiro: são 27 em 5.570, e 5.543
      // `"capital": false` não pagariam o próprio peso.
      if (m.capital) linha.capital = true;
      return linha;
    });

    out[ctx.uf] = {
      ts,
      uf: ctx.uf,
      cargo,
      // Turno 1 nos três: Senador não tem 2º turno, e Presidente/Governador em
      // 2T seriam `municipios-<cargo>-t2.json`, arquivo à parte que este
      // gerador ainda não produz.
      turno: 1,
      municipios,
      series_temporais: serieDaUf(r.derive(`serie|${ctx.uf}`), corrida, ts, destinoPublicado),
    };
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Manifest — a prova, para conferir sem abrir os payloads
// ═════════════════════════════════════════════════════════════════════════════

export interface LinhaManifest {
  uf: string;
  pct_apurado: number;
  eleitores_aptos: number;
  comparecimento_pct: number;
  votos_validos_projetados: number;
  votos_apurados: number;
  fonte_eleitorado: "medido" | "derivado_2022";
  feitio_governador: FeitioUf;
  feitio_senador: FeitioUf;
}

export interface Manifest {
  /** ⚠️ Fica em primeiro lugar no arquivo de propósito. */
  aviso: string;
  gerado_ts: string;
  gerador: string;
  pct_pedido: number;
  /** Média das UFs ponderada pelo eleitorado — o que o arquivo REALMENTE tem. */
  pct_efetivo: number;
  erro_pp: number;
  cenario: Cenario;
  seed: string;
  arquivos: string[];
  eleitorado_total: number;
  votos_validos_projetados_total: number;
  contagens: {
    presidente_candidatos: number;
    governador_candidatos: number;
    governador_ufs: number;
    senador_candidatos: number;
    senador_ufs: number;
    deputado_agremiacoes: number;
    deputado_cadeiras_atribuidas: number;
    deputado_cadeiras_total: number;
    municipios: number;
  };
  por_uf: LinhaManifest[];
  avisos: string[];
  /**
   * Presente só quando gerado com `--anulado-lidera <UF>` (ADR-0053 / RF-213):
   * diz ao dono QUAL UF tem a anulada no topo, para ele ir direto à tela.
   */
  cenario_anulado_lidera?: { uf: string; fracao_anulados: number };
}

export interface SaidaSimulacao {
  presidente: EdgePayload;
  governador: EdgePayload;
  senador: EdgePayload;
  deputado: EdgePayloadDeputado;
  senadorUf: Record<string, EdgePayloadUf>;
  deputadoUf: Record<string, DeputadoUfDetail>;
  /** A votação presidencial DENTRO de cada estado — 27 UFs. */
  presidenteUf: Record<string, EdgePayloadUf>;
  /**
   * A corrida a governador DENTRO de cada estado — 27 UFs, **inteira**.
   *
   * Acréscimo de 19/09. O que faltava não eram os números (a síntese por
   * `top_candidatos` acertava os dela); era a CAUDA — ver a docstring de
   * `montarGovernadorUf`.
   */
  governadorUf: Record<string, EdgePayloadUf>;
  /**
   * Detalhe municipal — o mapa por dentro do estado, um arquivo POR CARGO.
   *
   * Os três são a MESMA geografia com a MESMA velocidade de apuração (ver a
   * docstring de `montarMunicipios`); o que muda é a repartição dos votos.
   * Sem `gov` e `sen` aqui, `/uf/<sigla>/governador` e `/uf/<sigla>/senador`
   * ficam sem mapa municipal em `pnpm dev:sim` — que era o estado até 19/09.
   */
  municipiosPresT1: Record<string, UfDetailBlob>;
  municipiosGovT1: Record<string, UfDetailBlob>;
  municipiosSenT1: Record<string, UfDetailBlob>;
  manifest: Manifest;
  /** Intermediários — o que permite conferir a soma de votos por UF. */
  ctxs: ContextoUf[];
  corridasPres: CorridaUf[];
  corridasGov: CorridaUf[];
  corridasSen: CorridaUf[];
}

/** Nome de arquivo → chave da saída. Uma fonte só para script e teste. */
export const ARQUIVOS: Readonly<Record<string, keyof SaidaSimulacao>> = {
  "presidente.json": "presidente",
  "governador.json": "governador",
  "senador.json": "senador",
  "deputado.json": "deputado",
  "presidente-uf.json": "presidenteUf",
  "governador-uf.json": "governadorUf",
  "senador-uf.json": "senadorUf",
  "deputado-uf.json": "deputadoUf",
  "municipios-pres-t1.json": "municipiosPresT1",
  // 🔴 Os nomes têm de casar EXATAMENTE com o que `simulacaoMunicipiosUf`
  // monta (`lib/dev/simulacao.ts`: `municipios-${cargo}-t${turno}.json`) — é o
  // nome do arquivo, e não uma tabela de código, que liga a rota ao dado.
  "municipios-gov-t1.json": "municipiosGovT1",
  "municipios-sen-t1.json": "municipiosSenT1",
  "manifest.json": "manifest",
};

// ═════════════════════════════════════════════════════════════════════════════
// Geração
// ═════════════════════════════════════════════════════════════════════════════

export function gerarSimulacao(
  dados: DadosSimulacao,
  cli: CliSimulacao,
  ts: string,
): SaidaSimulacao {
  const raiz = new Rng(`${cli.seed}|${cli.cenario}|${cli.pct}`);

  const eleitoradoPorUf: Record<string, number> = {};
  for (const uf of UFS) eleitoradoPorUf[uf] = dados.eleitorado[uf]?.aptos ?? 0;
  const pctPorUf = distribuirPctPorUf(cli.pct, eleitoradoPorUf);
  // `--anulado-lidera` (ADR-0053 / RF-213): sem a flag, os mesmos contextos.
  const ctxs = aplicarCenarioAnulado(
    montarContextos(dados, pctPorUf, raiz.derive("ctx")),
    cli.anuladoLidera,
  );

  const pres = montarPresidente(dados, ctxs, raiz, cli.cenario, ts);
  const presidente = pres.payload;
  const gov = montarCorridasEstaduais(dados, ctxs, raiz, 3);
  const sen = montarCorridasEstaduais(dados, ctxs, raiz, 5);
  const governador = montarPayloadEstadual(gov, ctxs, ts);
  const senador = montarPayloadEstadual(sen, ctxs, ts);
  const senadorUf = montarSenadorUf(sen, ts);
  const governadorUf = montarGovernadorUf(gov, ts);
  const presidenteUf = montarPresidenteUf(pres.corridas, presidente.national.candidatos, ts);
  const dep = montarDeputado(dados, ctxs, raiz, ts);
  // Um detalhe municipal por cargo majoritário. As três chamadas passam o
  // MESMO `raiz`: é isso que faz o eleitorado e o `pct_apurado` de cada
  // município saírem idênticos nos três arquivos (ver `montarMunicipios`).
  const municipiosPresT1 = montarMunicipios(dados, ctxs, pres.corridas, raiz, ts, "pres");
  const municipiosGovT1 = montarMunicipios(dados, ctxs, gov.corridas, raiz, ts, "gov");
  const municipiosSenT1 = montarMunicipios(dados, ctxs, sen.corridas, raiz, ts, "sen");

  const pctEfetivo = pctNacional(ctxs);
  const manifest: Manifest = {
    aviso:
      "DADO SIMULADO. Nomes, partidos, números de urna e eleitorado são reais; " +
      "votos, percentuais de apuração e probabilidades são INVENTADOS por " +
      "data-pipeline/simulacao-gerar.ts. Uso exclusivo de desenvolvimento local — " +
      "estes arquivos nunca devem ser publicados em destino remoto.",
    gerado_ts: ts,
    gerador: "data-pipeline/simulacao-gerar.ts",
    pct_pedido: cli.pct,
    pct_efetivo: r1(pctEfetivo),
    erro_pp: r2(Math.abs(pctEfetivo - cli.pct)),
    cenario: cli.cenario,
    seed: cli.seed,
    arquivos: Object.keys(ARQUIVOS).sort(),
    eleitorado_total: ctxs.reduce((a, c) => a + c.eleitores, 0),
    votos_validos_projetados_total: ctxs.reduce((a, c) => a + c.votosFinais, 0),
    contagens: {
      presidente_candidatos: presidente.national.candidatos.length,
      governador_candidatos: governador.national.candidatos.length,
      governador_ufs: governador.por_uf.length,
      senador_candidatos: senador.national.candidatos.length,
      senador_ufs: senador.por_uf.length,
      deputado_agremiacoes: dep.payload.bancada.por_agremiacao.length,
      deputado_cadeiras_atribuidas: dep.payload.bancada.cadeiras_atribuidas,
      deputado_cadeiras_total: dep.payload.bancada.total_cadeiras,
      municipios: dados.municipios.length,
    },
    por_uf: ctxs.map((c) => ({
      uf: c.uf,
      pct_apurado: c.pctApurado,
      eleitores_aptos: c.eleitores,
      comparecimento_pct: r2(c.comparecimento * 100),
      votos_validos_projetados: c.votosFinais,
      votos_apurados: c.votosApurados,
      fonte_eleitorado: c.fonteEleitorado,
      feitio_governador: gov.feitios[c.uf] as FeitioUf,
      feitio_senador: sen.feitios[c.uf] as FeitioUf,
    })),
    avisos: [...dados.avisos],
  };
  // Só com a flag — o manifest do default não ganha chave nenhuma.
  if (cli.anuladoLidera !== undefined) {
    manifest.cenario_anulado_lidera = {
      uf: cli.anuladoLidera,
      fracao_anulados: FRACAO_ANULADOS_CENARIO,
    };
  }

  return {
    presidente,
    governador,
    senador,
    deputado: dep.payload,
    senadorUf,
    governadorUf,
    presidenteUf,
    deputadoUf: dep.porUf,
    municipiosPresT1,
    municipiosGovT1,
    municipiosSenT1,
    manifest,
    ctxs,
    corridasPres: pres.corridas,
    corridasGov: gov.corridas,
    corridasSen: sen.corridas,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Validação das invariantes — falha em vez de gravar
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tolerâncias, exportadas para que o teste use EXATAMENTE as mesmas.
 *
 * Duas tolerâncias diferentes de propósito: soma de percentuais arredondados a
 * 2 casas acumula até `n·0,005` pp, enquanto probabilidades arredondadas a 4
 * casas acumulam muito menos. Uma tolerância única e frouxa esconderia erro
 * real do lado das probabilidades.
 */
export const TOLERANCIA = {
  /** Soma de percentuais de uma corrida, em pp. */
  pctSoma: 0.1,
  /** Soma de probabilidades. */
  prob: 0.01,
  /** Distância entre o `--pct` pedido e o efetivo, em pp. */
  pctNacional: 0.1,
} as const;

function erro(msg: string): never {
  throw new Error(`[simulacao] invariante violada: ${msg}`);
}

/**
 * Confere tudo que o dono não pode tropeçar enquanto caça bug de UI.
 *
 * Roda ANTES de gravar: um arquivo que viola invariante não chega ao disco.
 * O teste chama a mesma função, então o que protege a geração é o mesmo que o
 * teste exercita — e não duas listas de regras que podem divergir.
 */
export function validarSaida(s: SaidaSimulacao): void {
  const { presidente, governador, senador, deputado, senadorUf, deputadoUf, ctxs, manifest } = s;
  const governadorUf = s.governadorUf;

  // (1) Um percentual de apuração por UF, igual nos SETE arquivos que o
  // publicam (`governador-uf.json` entrou em 19/09). Uma checagem que cobre
  // seis de sete é uma checagem que autoriza o sétimo a divergir.
  for (const c of ctxs) {
    const vistos: Array<[string, number | undefined]> = [
      ["presidente.json", presidente.por_uf.find((l) => l.sigla === c.uf)?.pct_apurado],
      ["governador.json", governador.por_uf.find((l) => l.sigla === c.uf)?.pct_apurado],
      ["senador.json", senador.por_uf.find((l) => l.sigla === c.uf)?.pct_apurado],
      ["deputado.json", deputado.por_uf.find((l) => l.sigla === c.uf)?.pct_apurado],
      ["senador-uf.json", senadorUf[c.uf]?.pct_apurado],
      ["governador-uf.json", governadorUf[c.uf]?.pct_apurado],
      ["deputado-uf.json", deputadoUf[c.uf]?.pct_apurado],
    ];
    for (const [arquivo, v] of vistos) {
      if (v !== c.pctApurado) {
        erro(`${c.uf} em ${arquivo} tem pct_apurado ${String(v)}, esperado ${c.pctApurado}`);
      }
    }
  }

  // (2) Votos fecham com o total da UF, e (3) percentuais somam 100.
  const corridas: Array<[string, readonly CorridaUf[]]> = [
    ["presidente", s.corridasPres],
    ["governador", s.corridasGov],
    ["senador", s.corridasSen],
  ];
  for (const [nome, lista] of corridas) {
    for (const c of lista) {
      const somaProj = c.resultados.reduce((a, x) => a + x.votosProjetados, 0);
      const somaAt = c.resultados.reduce((a, x) => a + x.votosAtuais, 0);
      if (somaProj !== c.ctx.votosFinais) {
        erro(`${nome}/${c.ctx.uf}: Σ votos projetados ${somaProj} ≠ ${c.ctx.votosFinais}`);
      }
      if (somaAt !== c.ctx.votosApurados) {
        erro(`${nome}/${c.ctx.uf}: Σ votos apurados ${somaAt} ≠ ${c.ctx.votosApurados}`);
      }
      const somaPct = c.resultados.reduce((a, x) => a + r2(x.shareFinal), 0);
      if (Math.abs(somaPct - 100) > TOLERANCIA.pctSoma) {
        erro(`${nome}/${c.ctx.uf}: Σ pct_projetado = ${somaPct.toFixed(3)}, esperado 100`);
      }
      const somaVit = c.resultados.reduce((a, x) => a + x.pVitoria, 0);
      if (Math.abs(somaVit - 1) > TOLERANCIA.prob) {
        erro(`${nome}/${c.ctx.uf}: Σ p_vitoria = ${somaVit.toFixed(4)}, esperado 1`);
      }
    }
  }

  // Presidente: a corrida nacional inteira.
  const somaPctPres = presidente.national.candidatos.reduce((a, c) => a + c.pct_projetado, 0);
  if (Math.abs(somaPctPres - 100) > TOLERANCIA.pctSoma) {
    erro(`presidente: Σ pct_projetado = ${somaPctPres.toFixed(3)}, esperado 100`);
  }
  const somaVitPres = presidente.national.candidatos.reduce((a, c) => a + c.p_vitoria, 0);
  if (Math.abs(somaVitPres - 1) > TOLERANCIA.prob) {
    erro(`presidente: Σ p_vitoria = ${somaVitPres.toFixed(4)}, esperado 1`);
  }
  const somaTop2Pres = presidente.national.candidatos.reduce((a, c) => a + c.p_passa_2t, 0);
  if (Math.abs(somaTop2Pres - 2) > TOLERANCIA.prob) {
    erro(`presidente: Σ p_passa_2t = ${somaTop2Pres.toFixed(4)}, esperado 2`);
  }

  // (4) IC contém o ponto estimado, e (5) probabilidades em [0,1].
  const majoritarios: Array<[string, EdgePayload]> = [
    ["presidente", presidente],
    ["governador", governador],
    ["senador", senador],
  ];
  for (const [nome, p] of majoritarios) {
    for (const c of p.national.candidatos) {
      if (!(c.pct_projetado_lower <= c.pct_projetado && c.pct_projetado <= c.pct_projetado_upper)) {
        erro(
          `${nome}/${c.id} (${c.nome}): IC não contém o ponto — ` +
            `${c.pct_projetado_lower} ≤ ${c.pct_projetado} ≤ ${c.pct_projetado_upper} é falso`,
        );
      }
      for (const [campo, v] of [
        ["p_vitoria", c.p_vitoria],
        ["p_passa_2t", c.p_passa_2t],
        ["p_fecha_1t", c.p_fecha_1t],
      ] as const) {
        if (!(v >= 0 && v <= 1)) erro(`${nome}/${c.id}: ${campo} = ${v} fora de [0,1]`);
      }
    }
    // (6) `ufs_apuradas` tem de bater com quantas UFs REALMENTE apuraram.
    const reais = p.por_uf.filter((l) => l.pct_apurado > 0).length;
    if (p.ufs_apuradas !== reais) {
      erro(`${nome}: ufs_apuradas = ${p.ufs_apuradas}, mas ${reais} UFs têm apuração > 0`);
    }
    // (7) O percentual do arquivo é o percentual do manifest.
    if (p.pct_apurado_total !== manifest.pct_efetivo) {
      erro(`${nome}: pct_apurado_total ${p.pct_apurado_total} ≠ manifest ${manifest.pct_efetivo}`);
    }
    // (8) 🔴 Nenhum payload de apuração pode carregar `fase`.
    if ("fase" in p)
      erro(`${nome}: campo 'fase' presente — este payload é de apuração, não de pré-eleição`);
  }
  if ("fase" in deputado) erro("deputado: campo 'fase' presente");
  if (deputado.ufs_apuradas !== deputado.por_uf.filter((l) => l.pct_apurado > 0).length) {
    erro("deputado: ufs_apuradas não bate com as UFs com apuração > 0");
  }
  if (deputado.pct_apurado_total !== manifest.pct_efetivo) {
    erro(
      `deputado: pct_apurado_total ${deputado.pct_apurado_total} ≠ manifest ${manifest.pct_efetivo}`,
    );
  }

  // Senado: `p_eleito` de uma UF soma `vagas`, não 1.
  for (const uf of UFS) {
    const p = senadorUf[uf];
    if (p === undefined) erro(`senador-uf.json não tem ${uf} — são 27, sem exceção`);
    const vagas = p.vagas ?? 1;
    const soma = p.candidatos.reduce((a, c) => a + (c.p_eleito ?? 0), 0);
    if (Math.abs(soma - vagas) > TOLERANCIA.prob) {
      erro(`senador-uf/${uf}: Σ p_eleito = ${soma.toFixed(4)}, esperado ${vagas}`);
    }
    for (const c of p.candidatos) {
      if (!(c.ci95.lower <= c.pct_projetado && c.pct_projetado <= c.ci95.upper)) {
        erro(`senador-uf/${uf}/${c.id}: ci95 não contém pct_projetado`);
      }
      if (c.sqcand === undefined) erro(`senador-uf/${uf}/${c.id}: sem sqcand — a foto não resolve`);
    }
  }

  // 🔴 Governador: o resumo da UF traz a corrida INTEIRA, e não o pódio.
  //
  // Esta é a invariante que existe por causa do defeito de 19/09, e a ordem das
  // checagens é a ordem de importância. A primeira é a que o defeito quebrava:
  // a síntese que a rota usava até aqui montava a lista a partir de
  // `por_uf[].top_candidatos`, que é `slice(0, 4)` por definição — em SP saíam
  // 4 dos 7, e o balão do mapa municipal escrevia "Candidato 26004" para os 3
  // que sobravam, porque `votos_reportados` do detalhe municipal reparte entre
  // TODAS as candidaturas. Comparar contra `corridasGov` (a mesma fonte de
  // `montarMunicipios`) é o que faz a checagem discriminar: um `slice` que
  // reaparecesse aqui — por corte de tamanho, por reaproveitamento de
  // `linhaUf`, por qualquer motivo — mata a geração em vez de chegar à tela.
  //
  // As duas últimas são o contrário: campos que NÃO podem aparecer. Copiar
  // `montarSenadorUf` sem podar é o erro provável, e ele é silencioso — um
  // `vagas: 2` faria a tela desenhar duas faixas de eleito numa corrida de um
  // cargo só, e `p_eleito` responderia a uma pergunta que não existe com uma
  // vaga.
  const idsDaCorridaGov = new Map(
    s.corridasGov.map((c) => [c.ctx.uf, c.resultados.map((r) => r.cand.id)] as const),
  );
  for (const uf of UFS) {
    const p = governadorUf[uf];
    if (p === undefined) erro(`governador-uf.json não tem ${uf} — são 27, sem exceção`);
    if (p.cargo !== 3) erro(`governador-uf/${uf}: cargo ${p.cargo} — esperado 3`);
    const esperados = idsDaCorridaGov.get(uf) ?? [];
    const obtidos = p.candidatos.map((c) => c.id);
    if (obtidos.length !== esperados.length || obtidos.some((id, i) => id !== esperados[i])) {
      erro(
        `governador-uf/${uf}: ${obtidos.length} candidaturas [${obtidos.join(",")}], ` +
          `esperadas ${esperados.length} na mesma ordem [${esperados.join(",")}] — ` +
          "o resumo da UF é a corrida inteira, não o pódio",
      );
    }
    if (p.vagas !== undefined) {
      erro(
        `governador-uf/${uf}: 'vagas' presente (${p.vagas}) — governador elege 1 e omite o campo`,
      );
    }
    for (const c of p.candidatos) {
      if (!(c.ci95.lower <= c.pct_projetado && c.pct_projetado <= c.ci95.upper)) {
        erro(`governador-uf/${uf}/${c.id}: ci95 não contém pct_projetado`);
      }
      if (c.sqcand === undefined) {
        erro(`governador-uf/${uf}/${c.id}: sem sqcand — a foto não resolve`);
      }
      if (c.p_eleito !== undefined) {
        erro(
          `governador-uf/${uf}/${c.id}: 'p_eleito' presente — com 1 vaga a pergunta é p_vitoria`,
        );
      }
    }
  }

  // (9) Deputado: as cadeiras fecham com os lugares de cada UF.
  for (const uf of UFS) {
    const d = deputadoUf[uf];
    if (d === undefined) erro(`deputado-uf.json não tem ${uf} — são 27, sem exceção`);
    const lugares = d.lugares_a_preencher ?? 0;
    const soma = d.agremiacoes.reduce((a, x) => a + x.cadeiras, 0);
    if (soma + d.vagas_nao_preenchidas !== lugares) {
      erro(
        `deputado-uf/${uf}: ${soma} cadeiras + ${d.vagas_nao_preenchidas} vagas não preenchidas ≠ ${lugares}`,
      );
    }
  }
  const somaBancada = deputado.bancada.por_agremiacao.reduce((a, x) => a + x.cadeiras, 0);
  if (somaBancada !== deputado.bancada.cadeiras_atribuidas) {
    erro(
      `deputado: Σ cadeiras ${somaBancada} ≠ cadeiras_atribuidas ${deputado.bancada.cadeiras_atribuidas}`,
    );
  }
  if (deputado.bancada.ufs_calculadas + deputado.bancada.ufs_aguardando !== UFS.length) {
    erro("deputado: ufs_calculadas + ufs_aguardando ≠ 27");
  }

  // (10) Município → UF: a média ponderada pelo eleitorado fecha com a UF.
  //
  // É a checagem que denuncia uma simulação falsa por dentro: o mapa municipal
  // pode (e deve) variar bastante, mas somado de volta tem de dar o mesmo
  // número que os outros arquivos publicam para aquele estado.
  //
  // 🔴 Roda nos TRÊS cargos desde 19/09, e não só no presidencial. Enquanto
  // `municipios-gov-t1.json` e `municipios-sen-t1.json` saíam com
  // `municipios: []`, não havia o que conferir; agora que eles têm 5.570 linhas
  // cada, são estas invariantes — e só elas — que impedem as duas novas
  // fixtures de mentir em silêncio. Uma checagem que cobre um cargo de três é
  // uma checagem que autoriza os outros dois a divergirem.
  const detalhesMunicipais: Array<[string, Record<string, UfDetailBlob>, CargoMunicipal]> = [
    ["municipios-pres-t1", s.municipiosPresT1, "pres"],
    ["municipios-gov-t1", s.municipiosGovT1, "gov"],
    ["municipios-sen-t1", s.municipiosSenT1, "sen"],
  ];
  for (const [arquivo, mapa, cargoEsperado] of detalhesMunicipais) {
    for (const c of ctxs) {
      const blob = mapa[c.uf];
      if (blob === undefined) erro(`${arquivo}.json não tem ${c.uf} — são 27, sem exceção`);
      // A checagem de cargo é a que pega o erro mais barato e mais caro ao
      // mesmo tempo: um `montarMunicipios` chamado com a corrida de um cargo e
      // o rótulo de outro produziria um arquivo com forma perfeita e conteúdo
      // da corrida errada — exatamente o defeito que esta rodada conserta na
      // outra ponta, no endpoint.
      if (blob.cargo !== cargoEsperado)
        erro(`${arquivo}/${c.uf}: cargo "${blob.cargo}" — esperado "${cargoEsperado}"`);
      if (blob.municipios.length === 0)
        erro(`${arquivo}/${c.uf}: nenhum município — a fixture existiria mas o mapa ficaria mudo`);
      const peso = blob.municipios.reduce((a, m) => a + (m.eleitores ?? 0), 0);
      if (peso !== c.eleitores) {
        erro(`${arquivo}/${c.uf}: Σ eleitores ${peso} ≠ eleitorado da UF ${c.eleitores}`);
      }
      const media =
        blob.municipios.reduce((a, m) => a + m.pct_apurado * (m.eleitores ?? 0), 0) / peso;
      if (Math.abs(media - c.pctApurado) > 0.05) {
        erro(
          `${arquivo}/${c.uf}: média ponderada ${media.toFixed(3)}% ≠ pct_apurado da UF ${c.pctApurado}%`,
        );
      }
      const t = blob.series_temporais?.turnout ?? [];
      for (let k = 1; k < t.length; k++) {
        if ((t[k]?.pct_apurado ?? 0) < (t[k - 1]?.pct_apurado ?? 0)) {
          erro(
            `${arquivo}/${c.uf}: turnout da série regride no ponto ${k} — apuração não volta atrás`,
          );
        }
      }
      if (t.length > 0 && t[t.length - 1]?.pct_apurado !== c.pctApurado) {
        erro(`${arquivo}/${c.uf}: último ponto da série ≠ pct_apurado da UF`);
      }
    }
  }

  // (10b) 🔴 Σ votos do município = votos apurados do CANDIDATO na UF, cargo a
  // cargo. Sem isto, a tela do município e a do estado podem contar histórias
  // diferentes sobre a mesma pessoa — e foi justamente por não existir arquivo
  // municipal de gov/sen que ninguém precisou conferir isso até hoje.
  const corridasPorCargo: Array<[string, Record<string, UfDetailBlob>, readonly CorridaUf[]]> = [
    ["municipios-pres-t1", s.municipiosPresT1, s.corridasPres],
    ["municipios-gov-t1", s.municipiosGovT1, s.corridasGov],
    ["municipios-sen-t1", s.municipiosSenT1, s.corridasSen],
  ];
  for (const [arquivo, mapa, corridas] of corridasPorCargo) {
    for (const corrida of corridas) {
      const blob = mapa[corrida.ctx.uf];
      if (blob === undefined) continue; // já reportado em (10)
      const somaPorCand = new Map<number, number>();
      for (const m of blob.municipios) {
        for (const [id, v] of Object.entries(m.votos_reportados ?? {})) {
          somaPorCand.set(Number(id), (somaPorCand.get(Number(id)) ?? 0) + v);
        }
      }
      for (const res of corrida.resultados) {
        const somado = somaPorCand.get(res.cand.id) ?? 0;
        if (somado !== res.votosAtuais) {
          erro(
            `${arquivo}/${corrida.ctx.uf}/${res.cand.id} (${res.cand.nome}): ` +
              `Σ votos dos municípios ${somado} ≠ votos apurados na UF ${res.votosAtuais}`,
          );
        }
      }
    }
  }

  // (11) O percentual efetivo bate o pedido.
  if (manifest.erro_pp > TOLERANCIA.pctNacional) {
    erro(
      `pct nacional efetivo ${manifest.pct_efetivo} está a ${manifest.erro_pp} pp do pedido ${manifest.pct_pedido}`,
    );
  }

  // (12) Votação (spec 021): as identidades do EA20 valem em CONTAGEM INTEIRA
  // nos QUATRO payloads nacionais, e nenhum residual pode sair negativo — uma
  // fatia negativa desenha errado em silêncio (RF-193, RF-195).
  //
  // As checagens de riqueza (b) e (c) existem porque o modelo de votos deste
  // gerador NÃO tem anulados nem seções não instaladas: emitir zero nas duas
  // passaria em toda checagem aritmética e ainda assim produziria uma fixture
  // mais POBRE que produção, em que o painel nunca mostra a fatia cinza nem o
  // buraco de 14,2% do comparecimento. É a armadilha registrada nesta base, e
  // o único jeito de ela não voltar é uma invariante que reprove o zero.
  const temBaseAmostral = ctxs.some((c) => c.pctApurado > 0);
  //
  // Spec 022 RF-210 — cada eleitor dá `k` votos no cargo, e `k` é lido do
  // PAYLOAD, como a tela lê (`composicao_vagas.vagas_por_uf` no nacional do
  // Senado; ausente ⇒ 1 voto por eleitor), e não recalculado aqui: um `k`
  // errado no produtor tem de sair como número que não fecha com o que a
  // tela vai multiplicar.
  const nacionais: Array<[string, EdgeVotacao | undefined, number]> = [
    ["presidente", presidente.votacao, votosPorEleitorPublicado(presidente)],
    ["governador", governador.votacao, votosPorEleitorPublicado(governador)],
    ["senador", senador.votacao, votosPorEleitorPublicado(senador)],
    ["deputado", deputado.votacao, 1],
  ];
  // ⚠️ A referência é o PRIMEIRO payload, não uma segunda chamada a
  // `contagensVotacao(ctxs)`. Recalcular com a mesma função aqui seria
  // tautológico — e, pior, faria as invariantes (b) e (c) abaixo virarem código
  // morto: um defeito de parâmetro sai igual nos dois lados e passaria batido,
  // enquanto qualquer poda de teste esbarraria na comparação antes de chegar
  // nelas. A âncora que NÃO é recálculo é o `eleitorado_total` do manifest, que
  // soma `ctxs` por outro caminho.
  //
  // As quantidades de PESSOAS são as mesmas nos quatro cargos (é o mesmo
  // eleitorado); os campos de VOTO só são comparáveis entre cargos com o
  // mesmo `k` — o Senado conta 2 votos por eleitor (RF-210).
  let referencia: EdgeVotacaoContagens | undefined;
  const referenciaVotos = new Map<number, EdgeVotacaoContagens>();
  for (const [nome, v, k] of nacionais) {
    if (v === undefined) {
      erro(`${nome}: bloco 'votacao' ausente — a spec 021 emenda as QUATRO telas nacionais`);
    }
    if (!Number.isSafeInteger(k) || k < 1) {
      erro(`${nome}: votos por eleitor publicado = ${k} — não é inteiro ≥ 1 (RF-210)`);
    }
    const c = v.contagens;
    for (const [campo, n] of Object.entries(c)) {
      if (!Number.isInteger(n) || n < 0) {
        erro(`${nome}: votacao.contagens.${campo} = ${n} não é inteiro ≥ 0`);
      }
      const chave = campo as keyof EdgeVotacaoContagens;
      const deVoto = CAMPOS_DE_VOTO.has(chave);
      const esperado = (deVoto ? (referenciaVotos.get(k) ?? c) : (referencia ?? c))[chave];
      if (n !== esperado) {
        erro(
          `${nome}: votacao.contagens.${campo} = ${n}, mas o país tem ${esperado} — ` +
            (deVoto
              ? `os cargos de ${k} voto(s) por eleitor contam os MESMOS votos`
              : "as quatro telas contam o MESMO eleitorado"),
        );
      }
    }
    referencia ??= c;
    if (!referenciaVotos.has(k)) referenciaVotos.set(k, c);
    if (c.aptos !== manifest.eleitorado_total) {
      erro(
        `${nome}: votacao.contagens.aptos = ${c.aptos} ≠ eleitorado_total ` +
          `${manifest.eleitorado_total} do manifest`,
      );
    }
    // (a) as duas identidades do dicionário EA20, exatas em inteiro.
    if (c.comparecimento + c.abstencao !== c.instalados) {
      erro(
        `${nome}: comparecimento ${c.comparecimento} + abstencao ${c.abstencao} ` +
          `≠ instalados ${c.instalados} (identidade 'esi = c + a' do EA20)`,
      );
    }
    conferirVotosPorEleitor(nome, c, k);
    if (c.instalados > c.aptos) {
      erro(`${nome}: instalados ${c.instalados} > aptos ${c.aptos} — 'esi ≤ te' é hierarquia`);
    }
    // ⚠️ Piso do residual do círculo 1. É DERIVÁVEL das três checagens acima
    // (`residual1 = (aptos − instalados) + anulados + sub_judice`, e as três
    // parcelas já são forçadas ≥ 0), então nenhum teste o alcança sem primeiro
    // desligar uma delas — fica como piso explícito para o dia em que alguém
    // mexer na ordem, não como invariante coberta.
    const residual1 = k * c.aptos - (c.validos + c.brancos + c.nulos + k * c.abstencao);
    if (residual1 < 0) {
      erro(`${nome}: residual do círculo 1 = ${residual1} < 0 — a quinta fatia desenharia errado`);
    }
    // (b) o buraco de anulados + sub judice TEM de existir: são 14,2% do
    // comparecimento no dado real, e são o assunto do RF-197.
    if (c.comparecimento > 0 && c.anulados + c.sub_judice === 0) {
      erro(
        `${nome}: anulados + sub_judice = 0 com comparecimento ${c.comparecimento} — ` +
          `a fixture ficaria mais pobre que produção e o RF-197 nunca seria exercitado`,
      );
    }
    // (c) enquanto a apuração não fecha, a fatia cinza do círculo 1 existe.
    if (manifest.pct_efetivo < 100 && c.aptos <= c.instalados) {
      erro(
        `${nome}: aptos ${c.aptos} ≤ instalados ${c.instalados} a ${manifest.pct_efetivo}% ` +
          `apurado — o círculo 1 não teria fatia 'Ainda não apurado'`,
      );
    }
    // (d) `projetada` presente se e só se há base amostral (RF-195).
    if (temBaseAmostral !== (v.projetada !== undefined)) {
      erro(
        `${nome}: votacao.projetada ${v.projetada === undefined ? "ausente" : "presente"} com ` +
          `${temBaseAmostral ? "" : "nen"}huma UF apurada — RF-195`,
      );
    }
    const p = v.projetada;
    if (p !== undefined) {
      for (const [campo, n] of Object.entries(p)) {
        if (!Number.isInteger(n) || n < 0) {
          erro(`${nome}: votacao.projetada.${campo} = ${n} não é inteiro ≥ 0`);
        }
      }
      const residual3 = k * c.aptos - (p.validos + p.brancos + p.nulos + k * p.abstencao);
      if (residual3 < 0) {
        erro(`${nome}: residual do círculo 3 = ${residual3} < 0 — as projeções estouram aptos`);
      }
    }
  }

  // (13) Spec 022 — a corrida é HONESTA como o TSE: em toda abrangência,
  // Σ votos das candidaturas `valido` == `validos`, Σ `anulado` == `anulados`,
  // Σ `sub_judice` == `sub_judice`. Antes desta spec o gerador espalhava os
  // anulados pelas candidaturas sem marcar ninguém (Σ `votos_atuais` =
  // válidos + anulados + sub judice, medido em 26/09) — um círculo "só
  // válidos" montado ali poria voto anulado numa fatia com nome.
  //
  // (14) Decisão do dono (27/09) — na mesma passada, em cada abrangência com
  // corrida: Σ `votos_projetados` das `valido` == `projetada.validos`, exato
  // (`conferirProjecaoDaCorrida`).
  validarCorrida(s);

  // (15) ADR-0053 / RF-213 — o `destino` das LISTAS é o de `votacao.corrida`
  // da mesma abrangência, e nenhum `lider` é uma candidatura anulada.
  validarDestinoNasListas(s);
}

/** `id → destino` (ou `undefined`, se ainda não publicado) de uma corrida. */
function destinoPorId(
  corrida: readonly EdgeCorridaEntrada[] | undefined,
): Map<number, EdgeDestinoVoto | undefined> {
  return new Map((corrida ?? []).map((e) => [e.id, e.destino] as const));
}

/**
 * (15) ADR-0053 / RF-213. Reprova:
 *
 *   - candidatura de uma lista (`national.candidatos`, `por_uf[].top_candidatos`,
 *     `EdgePayloadUf.candidatos`) cujo `destino` difere do de `votacao.corrida`
 *     da abrangência que decide — a do PAÍS no Presidente (em toda UF, como o
 *     produtor), a da UF em Governador e Senador. "Difere" inclui um lado com
 *     destino e o outro sem: emitir `destino` antes da 1ª totalização é
 *     inventar o `dvt`; omiti-lo depois faz a tela tratar a anulada como quem
 *     compete. ÚNICA exceção (2026-09-27): a corrida diz `"valido"` e a lista
 *     não traz `destino` — as listas não emitem `"valido"` (`destinoNaLista`).
 *     A lista trazer `"valido"` explícito também reprova: é o byte que a
 *     regra existe para economizar;
 *   - candidatura de uma lista que não está na corrida (a comparação acima
 *     passaria em silêncio, com `undefined` dos dois lados);
 *   - `por_uf[].lider` ou `municipios[].lider.candidato_id` que seja uma
 *     candidatura `"anulado"` — ela pintaria o mapa com a cor de quem não
 *     disputa.
 */
function validarDestinoNasListas(s: SaidaSimulacao): void {
  const conferir = (
    nome: string,
    lista: ReadonlyArray<{ id: number; destino?: EdgeDestinoVoto }>,
    ref: ReadonlyMap<number, EdgeDestinoVoto | undefined>,
  ): void => {
    for (const x of lista) {
      if (!ref.has(x.id)) {
        erro(`${nome}: candidatura ${x.id} fora de votacao.corrida — destino sem referência`);
      }
      // A lista omite `"valido"` (`destinoNaLista`): corrida `"valido"` ⇔ lista
      // sem `destino`. Qualquer outra divergência reprova.
      const esperado = ref.get(x.id) === "valido" ? undefined : ref.get(x.id);
      if (x.destino !== esperado) {
        erro(
          `${nome}: candidatura ${x.id} com destino ${String(x.destino)}, mas votacao.corrida ` +
            `da abrangência diz ${String(ref.get(x.id))} (ADR-0053 / RF-213)`,
        );
      }
    }
  };
  const liderCompete = (
    nome: string,
    lider: number,
    ref: ReadonlyMap<number, EdgeDestinoVoto | undefined>,
  ): void => {
    if (ref.get(lider) === "anulado") {
      erro(`${nome}: lider ${lider} é candidatura ANULADA — não disputa (ADR-0053 / RF-213)`);
    }
  };

  // Presidente — a destinação nacional vale em toda UF.
  const refPres = destinoPorId(s.presidente.votacao?.corrida);
  conferir("presidente.json/national", s.presidente.national.candidatos, refPres);
  for (const l of s.presidente.por_uf) {
    conferir(`presidente.json/por_uf/${l.sigla}`, l.top_candidatos, refPres);
    liderCompete(`presidente.json/por_uf/${l.sigla}`, l.lider, refPres);
  }
  for (const [uf, p] of Object.entries(s.presidenteUf)) {
    conferir(`presidente-uf.json/${uf}`, p.candidatos, refPres);
  }
  for (const [uf, blob] of Object.entries(s.municipiosPresT1)) {
    for (const m of blob.municipios) {
      liderCompete(`municipios-pres-t1/${uf}/${m.cod_ibge}`, m.lider.candidato_id, refPres);
    }
  }

  // Governador e Senador — a destinação é a da UF.
  const estaduais = [
    ["governador", s.governador, s.governadorUf, s.municipiosGovT1, "gov"],
    ["senador", s.senador, s.senadorUf, s.municipiosSenT1, "sen"],
  ] as const;
  for (const [nome, nacional, porUf, municipios, sufixo] of estaduais) {
    const refUf = new Map<string, Map<number, EdgeDestinoVoto | undefined>>();
    const refUniao = new Map<number, EdgeDestinoVoto | undefined>();
    for (const [uf, p] of Object.entries(porUf)) {
      const ref = destinoPorId(p.votacao?.corrida);
      refUf.set(uf, ref);
      for (const [id, d] of ref) refUniao.set(id, d);
      conferir(`${nome}-uf.json/${uf}`, p.candidatos, ref);
    }
    // Os ids são únicos entre as 27 UFs (bloco 7(a)): a união é a referência
    // da lista nacional, que é a concatenação das 27 corridas.
    conferir(`${nome}.json/national`, nacional.national.candidatos, refUniao);
    for (const l of nacional.por_uf) {
      const ref = refUf.get(l.sigla) ?? new Map();
      conferir(`${nome}.json/por_uf/${l.sigla}`, l.top_candidatos, ref);
      liderCompete(`${nome}.json/por_uf/${l.sigla}`, l.lider, ref);
    }
    for (const [uf, blob] of Object.entries(municipios)) {
      const ref = refUf.get(uf) ?? new Map();
      for (const m of blob.municipios) {
        liderCompete(`municipios-${sufixo}-t1/${uf}/${m.cod_ibge}`, m.lider.candidato_id, ref);
      }
    }
  }
}

/**
 * Os campos de VOTO de `EdgeVotacaoContagens` (spec 022 RF-210). Os outros
 * quatro — `aptos`, `instalados`, `comparecimento`, `abstencao` — são PESSOAS.
 */
const CAMPOS_DE_VOTO: ReadonlySet<keyof EdgeVotacaoContagens> = new Set([
  "validos",
  "brancos",
  "nulos",
  "anulados",
  "sub_judice",
] as const);

/**
 * Quantos votos por eleitor um payload NACIONAL declara — o que a tela
 * multiplicaria. Só o Senado publica (`composicao_vagas.vagas_por_uf`);
 * ausente é um voto por eleitor, como `EdgePayloadUf.vagas` ausente.
 */
function votosPorEleitorPublicado(p: EdgePayload): number {
  return p.composicao_vagas?.vagas_por_uf ?? 1;
}

/**
 * Spec 022 RF-210 — a identidade `tv = vv + vb + tvn + van + vansj` do EA20 com
 * a UNIDADE certa: `tv == k × comparecimento`, exato em inteiro. Com `k = 1`
 * é a identidade de sempre; no Senado (`k = 2`) é o que as capturas reais
 * medem nas 4 UFs. Reprova nos dois sentidos: Senado com votos "de
 * Presidente" (1 por eleitor) e Presidente/Governador com votos em dobro.
 */
function conferirVotosPorEleitor(nome: string, c: EdgeVotacaoContagens, k: number): void {
  const soma = c.validos + c.brancos + c.nulos + c.anulados + c.sub_judice;
  if (soma !== k * c.comparecimento) {
    erro(
      `${nome}: validos+brancos+nulos+anulados+sub_judice = ${soma} ≠ ${k} × comparecimento ` +
        `${c.comparecimento} (identidade 'tv = vvc + vb + tvn' do EA20, ${k} voto(s) por ` +
        `eleitor — spec 022 RF-210)`,
    );
  }
}

/**
 * As três identidades de destinação numa corrida por candidatura, mais a
 * coerência de `destino_pendente` com as entradas. Devolve nada; reprova alto.
 */
function conferirCorrida(
  nome: string,
  corrida: readonly EdgeCorridaEntrada[] | undefined,
  contagens: EdgeVotacaoContagens,
  destinoPendente: true | undefined,
  idsDoPayload: ReadonlySet<number>,
): void {
  if (corrida === undefined) {
    erro(`${nome}: votacao.corrida ausente — o simulado sempre tem o agregado (spec 022)`);
  }
  const soma: Record<EdgeDestinoVoto, number> = { valido: 0, anulado: 0, sub_judice: 0 };
  const vistos = new Set<number>();
  for (const e of corrida) {
    if (!Number.isInteger(e.votos) || e.votos < 0) {
      erro(`${nome}: corrida[${e.id}].votos = ${e.votos} não é inteiro ≥ 0`);
    }
    if (vistos.has(e.id)) erro(`${nome}: id ${e.id} repetido na corrida`);
    vistos.add(e.id);
    if (!idsDoPayload.has(e.id)) {
      erro(
        `${nome}: corrida[${e.id}] sem candidatura de mesmo id no payload — a tela não acha o nome`,
      );
    }
    if (e.destino !== undefined) soma[e.destino] += e.votos;
  }
  const alvo: Array<[EdgeDestinoVoto, keyof EdgeVotacaoContagens]> = [
    ["valido", "validos"],
    ["anulado", "anulados"],
    ["sub_judice", "sub_judice"],
  ];
  for (const [destino, campo] of alvo) {
    if (soma[destino] !== contagens[campo]) {
      erro(
        `${nome}: Σ votos das candidaturas '${destino}' = ${soma[destino]} ≠ ` +
          `contagens.${campo} ${contagens[campo]} — a corrida não fecha como o TSE`,
      );
    }
  }
  const pende = corridaPendente(corrida);
  if (pende !== (destinoPendente === true)) {
    erro(`${nome}: destino_pendente ${String(destinoPendente)} com entrada pendente = ${pende}`);
  }
}

function validarCorrida(s: SaidaSimulacao): void {
  const { presidente, governador, senador, deputado, ctxs } = s;

  // Nacional do Presidente: por candidatura.
  const vp = presidente.votacao;
  if (vp === undefined) erro("presidente: bloco 'votacao' ausente");
  if (vp.corrida_por_partido !== undefined) {
    erro("presidente: corrida_por_partido presente — uma corrida só é por candidatura (RF-201)");
  }
  conferirCorrida(
    "presidente",
    vp.corrida,
    vp.contagens,
    vp.destino_pendente,
    new Set(presidente.national.candidatos.map((c) => c.id)),
  );
  conferirProjecaoDaCorrida(
    "presidente",
    vp.projetada,
    presidente.national.candidatos,
    destinosPublicados(vp.corrida),
  );

  // Nacional de Governador e Senador: por partido, e nunca por candidatura.
  for (const [nome, p] of [
    ["governador", governador],
    ["senador", senador],
  ] as const) {
    const v = p.votacao;
    if (v === undefined) erro(`${nome}: bloco 'votacao' ausente`);
    if (v.corrida !== undefined) {
      erro(`${nome}: votacao.corrida presente — 27 corridas não têm 1º colocado nacional (RF-201)`);
    }
    if (v.destino_pendente === undefined && v.corrida_por_partido === undefined) {
      erro(`${nome}: corrida_por_partido ausente sem destino_pendente (RF-209)`);
    }
    if (v.corrida_por_partido !== undefined) {
      const somaPartidos = v.corrida_por_partido.reduce((a, x) => a + x.votos_validos, 0);
      if (somaPartidos !== v.contagens.validos) {
        erro(
          `${nome}: Σ corrida_por_partido = ${somaPartidos} ≠ contagens.validos ` +
            `${v.contagens.validos} — só voto válido entra num partido (RF-203)`,
        );
      }
    }
    // O nacional destes dois cargos não publica destinação por candidatura
    // (RF-201), e a UF a 0% também não (`corridaDaUf`) — mas a `projetada`
    // nacional soma o fim de noite das 27. A destinação vem então das corridas
    // internas, que são de onde os `candidatos` do payload saíram.
    conferirProjecaoDaCorrida(
      nome,
      v.projetada,
      p.national.candidatos,
      new Map(
        (nome === "governador" ? s.corridasGov : s.corridasSen).flatMap((c) =>
          c.resultados.map((r) => [r.cand.id, r.destino] as const),
        ),
      ),
    );
  }

  // Deputado: nada de corrida (RF-200).
  const vd = deputado.votacao;
  if (
    vd !== undefined &&
    (vd.corrida !== undefined ||
      vd.corrida_por_partido !== undefined ||
      vd.destino_pendente !== undefined)
  ) {
    erro("deputado: votacao com corrida — Deputado Federal não tem colocados (RF-200)");
  }

  // Cada UF, nos três cargos majoritários: o agregado DA UF, e a soma das 27
  // contagens de UF é a contagem nacional (a mesma identidade do produtor).
  const mapas: Array<[string, Record<string, EdgePayloadUf>, EdgePayload]> = [
    ["presidente-uf.json", s.presidenteUf, presidente],
    ["governador-uf.json", s.governadorUf, governador],
    ["senador-uf.json", s.senadorUf, senador],
  ];
  for (const [arquivo, mapa, nacional] of mapas) {
    const somaUf: Partial<Record<keyof EdgeVotacaoContagens, number>> = {};
    for (const c of ctxs) {
      const p = mapa[c.uf];
      const v = p?.votacao;
      if (p === undefined || v === undefined) {
        erro(`${arquivo}/${c.uf}: bloco 'votacao' ausente (spec 022 RF-209)`);
      }
      // `k` do PAYLOAD, como a página lê (`EdgePayloadUf.vagas`, ausente ⇒ 1
      // voto por eleitor) — ver (12).
      conferirVotacaoUf(`${arquivo}/${c.uf}`, v, c, p.vagas ?? 1);
      // O mesmo eleitorado da UF nos três cargos: as PESSOAS do Senado são as
      // do Presidente — só os votos mudam de escala (RF-210).
      const pessoasRef = s.presidenteUf[c.uf]?.votacao?.contagens;
      for (const campo of ["aptos", "instalados", "comparecimento", "abstencao"] as const) {
        if (pessoasRef !== undefined && v.contagens[campo] !== pessoasRef[campo]) {
          erro(
            `${arquivo}/${c.uf}: contagens.${campo} = ${v.contagens[campo]}, mas a UF tem ` +
              `${pessoasRef[campo]} no Presidente — é o MESMO eleitorado (spec 022 RF-210)`,
          );
        }
      }
      conferirCorrida(
        `${arquivo}/${c.uf}`,
        v.corrida,
        v.contagens,
        v.destino_pendente,
        new Set(p.candidatos.map((x) => x.id)),
      );
      conferirProjecaoDaCorrida(
        `${arquivo}/${c.uf}`,
        v.projetada,
        p.candidatos,
        destinosPublicados(v.corrida),
      );
      for (const [k, n] of Object.entries(v.contagens)) {
        const kk = k as keyof EdgeVotacaoContagens;
        somaUf[kk] = (somaUf[kk] ?? 0) + n;
      }
    }
    conferirSomaDasUfs(arquivo, somaUf, nacional.votacao?.contagens);
  }

  // Deputado por UF (spec 021 RF-192 emendado): o painel "Votação" da tela de
  // UF, sem corrida (spec 022 RF-200). Mesmas invariantes das três acima.
  const somaDep: Partial<Record<keyof EdgeVotacaoContagens, number>> = {};
  for (const c of ctxs) {
    const v = s.deputadoUf[c.uf]?.votacao;
    if (v === undefined) {
      erro(`deputado-uf.json/${c.uf}: bloco 'votacao' ausente (spec 021 RF-192 emendado)`);
    }
    if ("corrida" in v || "destino_pendente" in v) {
      erro(`deputado-uf.json/${c.uf}: votacao com corrida — Deputado não tem colocados (RF-200)`);
    }
    conferirVotacaoUf(`deputado-uf.json/${c.uf}`, v, c, 1);
    for (const [k, n] of Object.entries(v.contagens)) {
      const kk = k as keyof EdgeVotacaoContagens;
      somaDep[kk] = (somaDep[kk] ?? 0) + n;
    }
  }
  conferirSomaDasUfs("deputado-uf.json", somaDep, deputado.votacao?.contagens);
}

/** A destinação por `id` que a corrida publicada declara (sem as pendentes). */
function destinosPublicados(
  corrida: readonly EdgeCorridaEntrada[] | undefined,
): ReadonlyMap<number, EdgeDestinoVoto> {
  const m = new Map<number, EdgeDestinoVoto>();
  for (const e of corrida ?? []) if (e.destino !== undefined) m.set(e.id, e.destino);
  return m;
}

/**
 * (14) Decisão do dono (2026-09-27) — as duas projeções saem do MESMO fim de
 * noite: numa abrangência com corrida e `projetada`, Σ `votos_projetados` das
 * candidaturas `valido` == `projetada.validos`, **exato em inteiro**. É a
 * conta que o círculo de projeção da corrida faz na tela (spec 022 RF-212):
 * total = `projetada.validos`, fatias pela proporção de `votos_projetados`.
 * Com as duas projeções inventadas separadamente, a lista de candidaturas e o
 * círculo discordavam em 7–15% na fixture de 26/09.
 *
 * Igualdade, não tolerância: no gerador as duas são a mesma soma
 * ({@link fimDeNoiteDaCorrida}), então qualquer diferença — mesmo de 1 voto —
 * é um segundo caminho de projeção reaparecendo.
 *
 * Candidatura da lista sem destinação conhecida com `projetada` presente
 * também reprova: sem ela não há como separar as válidas, e somá-la (ou
 * pulá-la) em silêncio mudaria o total que a invariante confere.
 *
 * O teto (`projetada` somando mais que `aptos`) é conferido ANTES, nas mesmas
 * abrangências: (12)(d) no nacional e `conferirVotacaoUf` em cada UF.
 */
function conferirProjecaoDaCorrida(
  nome: string,
  projetada: EdgeVotacaoProjetada | undefined,
  candidatos: ReadonlyArray<Pick<EdgeCandidate, "id" | "votos_projetados">>,
  destinos: ReadonlyMap<number, EdgeDestinoVoto>,
): void {
  if (projetada === undefined) return;
  let somaValidos = 0;
  for (const c of candidatos) {
    const d = destinos.get(c.id);
    if (d === undefined) {
      erro(
        `${nome}: candidatura ${c.id} sem destinação com votacao.projetada presente — ` +
          `não há como separar os votos projetados válidos (decisão do dono 27/09)`,
      );
    }
    if (d === "valido") somaValidos += c.votos_projetados;
  }
  if (somaValidos !== projetada.validos) {
    erro(
      `${nome}: Σ votos_projetados das candidaturas 'valido' = ${somaValidos} ≠ ` +
        `votacao.projetada.validos ${projetada.validos} — as duas projeções não saem do ` +
        `mesmo fim de noite (decisão do dono 27/09, spec 022 RF-212)`,
    );
  }
}

/** Σ das contagens das 27 UFs == contagens nacionais (identidade do produtor). */
function conferirSomaDasUfs(
  arquivo: string,
  somaUf: Partial<Record<keyof EdgeVotacaoContagens, number>>,
  nac: EdgeVotacaoContagens | undefined,
): void {
  if (nac === undefined) erro(`${arquivo}: nacional sem votacao`);
  for (const [k, n] of Object.entries(nac)) {
    if (somaUf[k as keyof EdgeVotacaoContagens] !== n) {
      erro(
        `${arquivo}: Σ contagens.${k} das UFs = ${String(somaUf[k as keyof EdgeVotacaoContagens])} ` +
          `≠ nacional ${n} — a UF e o país contam votos diferentes`,
      );
    }
  }
}

/**
 * O painel "Votação" de UMA UF (spec 021 RF-192 emendado em 2026-09-26,
 * noite) desenha os três arcos com as MESMAS funções da tela
 * (`fatiasCirculo1`/`fatiasCirculo2`/`fatiasCirculo3`), com o MESMO
 * `votosPorEleitor` que a página passa (`EdgePayloadUf.vagas`, spec 022
 * RF-210). Reprova:
 *
 *   - `validos+brancos+nulos+anulados+sub_judice ≠ votosPorEleitor ×
 *     comparecimento` — Senado com votos "de Presidente", ou o contrário;
 *   - arco 1 que não fecha em `aptos` (a tela diria "não é possível montar
 *     este gráfico" — num simulado isso é defeito do gerador, não estado);
 *   - `projetada` presente sem base amostral na UF, ou ausente com ela
 *     (RF-195 — a mesma regra do nacional, sobre a UF);
 *   - projeção que soma mais que `aptos` (residual negativo desenharia torto).
 */
function conferirVotacaoUf(
  nome: string,
  v: Pick<EdgeVotacaoUf, "contagens" | "projetada">,
  ctx: ContextoUf,
  votosPorEleitor: number,
): void {
  // Spec 022 RF-210 — a identidade com a unidade do cargo, com mensagem
  // própria (as fatias abaixo também não fechariam, mas diriam só "não fecha").
  conferirVotosPorEleitor(nome, v.contagens, votosPorEleitor);
  if (
    fatiasCirculo1(v.contagens, votosPorEleitor) === null ||
    fatiasCirculo2(v.contagens, votosPorEleitor) === null
  ) {
    erro(`${nome}: o arco 1 não fecha em aptos ${v.contagens.aptos} (spec 021 RF-193)`);
  }
  const temBase = ctx.pctApurado > 0;
  if (temBase !== (v.projetada !== undefined)) {
    erro(
      `${nome}: votacao.projetada ${v.projetada === undefined ? "ausente" : "presente"} com a UF ` +
        `a ${ctx.pctApurado}% apurado — RF-195`,
    );
  }
  const p = v.projetada;
  if (p === undefined) return;
  for (const [campo, n] of Object.entries(p)) {
    if (!Number.isInteger(n) || n < 0)
      erro(`${nome}: votacao.projetada.${campo} = ${n} não é inteiro ≥ 0`);
  }
  if (fatiasCirculo3(v.contagens, p, votosPorEleitor) === null) {
    const soma = p.validos + p.brancos + p.nulos + votosPorEleitor * p.abstencao;
    erro(
      `${nome}: residual do círculo 3 < 0 — a projeção soma ${soma} > ` +
        `${votosPorEleitor} × aptos ${v.contagens.aptos}`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Gravação — a ÚNICA saída deste script
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Serializa como o Biome formata JSON (2 espaços + nova linha final).
 *
 * Não é capricho: `biome.json` inclui `**\/*.json` no lint, e o CI deste
 * repositório já ficou vermelho 8 runs seguidos por sujeira de formatação.
 * Um gerador que produz arquivo que o próprio `pnpm lint` reprova é um
 * gerador quebrado.
 */
const LARGURA_LINHA = 100;

/**
 * As duas regras que `JSON.stringify(x, null, 2)` NÃO segue, e que o Biome
 * aplica às fixtures que já existem no repositório:
 *
 *   1. **Objeto não-vazio sempre quebra**, mesmo curto — por isso
 *      `{"id": 3011, "pct": 40.7}` aparece em quatro linhas em
 *      `gov-current.json`.
 *   2. **Array colapsa quando cabe** e nenhum elemento seu quebrou — por isso
 *      `"margem_projetada_ci": [16.4, 21.9]` e `"componentes": ["PT", "PV"]`
 *      aparecem numa linha só.
 *
 * A largura disponível é medida a partir da COLUNA em que o valor começa (o
 * indent mais a chave), e não do indent — senão um array pendurado numa chave
 * longa colapsaria e estouraria a linha.
 */
function formatarJson(valor: unknown, nivel: number, coluna: number): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";

  // ⚠️ `nivel` e `coluna` são coisas DIFERENTES e a primeira versão disto as
  // confundiu: a indentação vem da profundidade na árvore, e a largura
  // disponível, da coluna em que o valor começa (indentação + a chave à
  // esquerda dele). Usar a coluna como indentação produz um escadão que cresce
  // com o tamanho dos nomes das chaves.
  const dentro = " ".repeat((nivel + 1) * 2);
  const fora = " ".repeat(nivel * 2);

  if (Array.isArray(valor)) {
    if (valor.length === 0) return "[]";
    const partes = valor.map((v) => formatarJson(v, nivel + 1, (nivel + 1) * 2));
    const compacto = `[${partes.join(", ")}]`;
    if (!partes.some((p) => p.includes("\n")) && coluna + compacto.length <= LARGURA_LINHA) {
      return compacto;
    }
    return `[\n${partes.map((p) => dentro + p).join(",\n")}\n${fora}]`;
  }

  const obj = valor as Record<string, unknown>;
  // `Object.keys` preserva a ordem de inserção, que é a ordem em que o gerador
  // monta cada payload — determinismo (constituição § 6) sem `sort` implícito.
  const chaves = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (chaves.length === 0) return "{}";
  const linhas = chaves.map((k) => {
    const rotulo = JSON.stringify(k);
    const valorFmt = formatarJson(obj[k], nivel + 1, dentro.length + rotulo.length + 2);
    return `${dentro}${rotulo}: ${valorFmt}`;
  });
  return `{\n${linhas.join(",\n")}\n${fora}}`;
}

/**
 * Serializa como o Biome formata JSON.
 *
 * Não é capricho: `biome.json` inclui `**\/*.json` no lint, e o CI deste
 * repositório já ficou vermelho 8 runs seguidos por sujeira de formatação. Um
 * gerador que produz arquivo reprovado pelo próprio `pnpm lint` é um gerador
 * quebrado.
 */
function serializar(valor: unknown): string {
  return `${formatarJson(valor, 0, 0)}\n`;
}

export async function gravar(saida: SaidaSimulacao, outDir: string): Promise<string[]> {
  const destino = resolve(ROOT, outDir);
  await mkdir(destino, { recursive: true });
  const escritos: string[] = [];
  for (const nome of Object.keys(ARQUIVOS).sort()) {
    const chave = ARQUIVOS[nome] as keyof SaidaSimulacao;
    const caminho = resolve(destino, nome);
    await writeFile(caminho, serializar(saida[chave]), "utf8");
    escritos.push(caminho);
  }
  return escritos;
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const t0 = Date.now();
  const cli = parseCli(process.argv.slice(2));
  // O relógio entra UMA vez, aqui. Tudo abaixo é função pura de (dados, cli, ts).
  const ts = new Date().toISOString();

  console.log("[simulacao] gerando estado eleitoral SIMULADO — uso local, nunca publicado");
  console.log(`  pct pedido : ${cli.pct}`);
  console.log(`  cenário    : ${cli.cenario}`);
  console.log(`  seed       : ${cli.seed}`);
  console.log(`  saída      : ${cli.out}`);
  if (cli.anuladoLidera !== undefined) {
    console.log(`  anulado lidera (ADR-0053): ${cli.anuladoLidera} — Governador e Senador`);
  }

  const dados = await carregarDados();
  const saida = gerarSimulacao(dados, cli, ts);
  validarSaida(saida);
  const escritos = await gravar(saida, cli.out);

  const m = saida.manifest;
  console.log("\n=== Resumo ===");
  console.log(
    `  pct efetivo (ponderado pelo eleitorado): ${pp(m.pct_efetivo)}%  (erro ${pp(m.erro_pp)} pp)`,
  );
  console.log(`  eleitorado total     : ${pt(m.eleitorado_total)}`);
  console.log(`  votos válidos finais : ${pt(m.votos_validos_projetados_total)}`);
  console.log(
    `  candidaturas         : pres ${m.contagens.presidente_candidatos} · gov ${m.contagens.governador_candidatos} · sen ${m.contagens.senador_candidatos}`,
  );
  console.log(
    `  bancada              : ${m.contagens.deputado_agremiacoes} agremiações, ${m.contagens.deputado_cadeiras_atribuidas}/${m.contagens.deputado_cadeiras_total} cadeiras`,
  );
  console.log("\n  pct apurado por UF:");
  for (const l of m.por_uf) {
    console.log(
      `    ${l.uf}  ${pp(l.pct_apurado).padStart(5)}%   ${pt(l.eleitores_aptos).padStart(12)} aptos` +
        `   gov:${l.feitio_governador.padEnd(10)} sen:${l.feitio_senador}` +
        (l.fonte_eleitorado === "derivado_2022" ? "   ⚠ eleitorado derivado" : ""),
    );
  }
  if (m.avisos.length > 0) {
    console.log("\n  avisos:");
    for (const a of m.avisos) console.log(`    - ${a}`);
  }
  console.log("\n  arquivos:");
  for (const c of escritos) console.log(`    ${c}`);
  console.log(`\n  tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Só executa quando invocado como script — sem esta guarda, um `import` num
// teste dispararia o ciclo inteiro contra o banco.
const invocadoComoScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (invocadoComoScript) {
  main().catch((err) => {
    console.error("Falha em simulacao-gerar:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
