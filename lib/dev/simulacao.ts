/**
 * lib/dev/simulacao.ts
 *
 * Modo de simulação local: um estado de apuração COMPLETO e COERENTE — os
 * quatro cargos, as oito telas, o mesmo instante — servido a partir de
 * `tests/fixtures/simulacao/` para revisão visual antes do simulado oficial do
 * TSE de 15–17/09/2026.
 *
 * ## Este é o único arquivo que sabe que a simulação existe
 *
 * As oito páginas e as duas rotas de API perguntam AQUI; nenhuma delas lê
 * `FIXTURE_VARIANT` por conta própria nem importa `tests/fixtures/simulacao/*`.
 * A regra não é estética: com o portão replicado em dez arquivos, auditar "a
 * simulação pode vazar?" vira dez leituras que precisam ser comparadas à mão, e
 * basta UMA delas divergir para a resposta mudar sem ninguém notar. Aqui a
 * pergunta tem um lugar só, e `varianteAtiva()` é a linha inteira da auditoria.
 *
 * ## Os dois portões, e por que são dois
 *
 * `simulacaoLigada()` exige `NODE_ENV === "development"` **E**
 * `FIXTURE_VARIANT` ∈ {`sim`, `sim-velho`}. As duas, e nunca `!== "production"`.
 *
 * O motivo é o histórico, não o zelo. Em 14/09/2026 este site público publicou
 * resultado eleitoral inventado pela terceira vez, e uma das causas anteriores
 * foi exatamente fixture escapando do caminho de desenvolvimento. A simulação é
 * PIOR que as fixtures antigas nesse cenário: ela carrega nomes, partidos e
 * fotos de políticos reais com votos inventados — vazada, não parece teste,
 * parece apuração (constituição §§ 1 e 8).
 *
 * Por que os dois e não só `FIXTURE_VARIANT`: variável de ambiente é injetável
 * por quem controla o deploy, então ela sozinha não é portão, é preferência.
 * Por que `=== "development"` e não `!== "production"`: a forma negada deixa
 * passar `test`, `preview` e qualquer string nova que alguém invente — a
 * ausência de um nome conhecido não é prova de que o ambiente é seguro.
 *
 * ## Por que lê do disco em vez de `import ... with { type: "json" }`
 *
 * 1. **O dado inventado não entra no bundle.** Import estático embute o JSON no
 *    artefato publicado mesmo que o portão nunca deixe lê-lo. Nomes e votos
 *    falsos de políticos reais ficariam dentro do que vai para produção,
 *    dependendo de um `if` para não aparecer. Lendo do disco, eles simplesmente
 *    não viajam.
 * 2. **Arquivo ausente não pode derrubar o caminho normal.** Estes arquivos são
 *    gerados fora deste módulo e podem não existir ainda; um import estático de
 *    caminho inexistente quebra `pnpm dev`, `pnpm build` e `pnpm typecheck`
 *    INTEIROS — inclusive o caminho de sempre, que é o que não pode regredir.
 *    Aqui, ausência devolve `null` e a tela segue exatamente como hoje.
 * 3. Efeito colateral bem-vindo: regenerar as fixtures e dar F5 basta; o cache
 *    abaixo é invalidado por `mtime`, sem reiniciar o `pnpm dev`.
 *
 * Só servidor: as dez chamadas são Server Components e route handlers (runtime
 * `nodejs`). Nenhum Client Component importa este módulo — `node:fs` no bundle
 * do cliente quebraria o build, o que torna a violação barulhenta, não sutil.
 *
 * ## Como liga
 *
 *     FIXTURE_VARIANT=sim       pnpm dev   # relógio reescrito para agora
 *     FIXTURE_VARIANT=sim-velho pnpm dev   # relógio como gravado (ver tarja âmbar)
 *
 * Qualquer outro valor — inclusive ausente, `t2` e `pre` — não passa por aqui.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { DeputadoUfDetail, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import type { UfDetailBlob } from "@/lib/blob/uf-detail";
// ⚠️ `Cargo` daqui, e NÃO de `@/lib/edge-config/types`. Existem dois tipos com
// este nome exato: o de `calendar` é a união de strings (`"pres" | "gov" | …`),
// o de `edge-config/types` é o código numérico do TSE (`1 | 3 | 5 | 6`). Quem
// nomeia o arquivo de municípios abaixo é a string, porque é ela que
// `UfDetailBlob` e a rota `/api/projection/municipios` já usam. Trocar um pelo
// outro compila em alguns pontos e produz `municipios-1-t1.json` — a mesma
// família de defeito silencioso de cargo que já mordeu este repositório.
import type { Cargo, Turno } from "@/lib/config/calendar";
import type { EdgePayload, EdgePayloadDeputado, EdgePayloadUf } from "@/lib/edge-config/types";

/**
 * `sim` reescreve o relógio; `sim-velho` serve como gravado.
 *
 * O segundo existe porque a reescrita apaga o único cenário em que a tarja
 * âmbar de dado parado (ADR-0038 D4) aparece — e essa tarja também precisa ser
 * revisada. Sem esta saída, ligar a simulação tornaria um estado de produto
 * invisível, que é como uma ferramenta de revisão passa a esconder justamente
 * o que deveria mostrar.
 */
type Variante = "sim" | "sim-velho";

const DIRETORIO = ["tests", "fixtures", "simulacao"] as const;

/**
 * A linha inteira da auditoria de vazamento. Ver o cabeçalho para por que as
 * duas condições, e por que `===` em vez de `!==`.
 */
function varianteAtiva(): Variante | null {
  if (process.env.NODE_ENV !== "development") return null;
  const variante = process.env.FIXTURE_VARIANT;
  if (variante === "sim") return "sim";
  if (variante === "sim-velho") return "sim-velho";
  return null;
}

/** `true` só sob os dois portões. Único predicado público do modo. */
export function simulacaoLigada(): boolean {
  return varianteAtiva() !== null;
}

/**
 * Resolve a fonte de um **RESULTADO ELEITORAL**: com a simulação ligada, ela é
 * a ÚNICA fonte, e a leitura normal — remota inclusive — nem chega a rodar.
 *
 * ## A regra, e o defeito de 2026-09-15 que a escreveu
 *
 * `GET /api/projection/municipios?uf=SP` devolvia `municipios: []` com 645
 * municípios de SP gerados no disco. `readUfDetail` rodava ANTES do caminho da
 * simulação e, com `BLOB_READ_WRITE_TOKEN` no `.env.local`, falava com o Blob
 * de PRODUÇÃO — que respondia `status: "ok"` com lista vazia. A rota retornava
 * ali, e todo o caminho da simulação virava código morto.
 *
 * A versão anterior desta função só protegia contra misturar simulação com a
 * FIXTURE antiga. Nada impedia a fonte REMOTA de ganhar **respondendo vazio**:
 * a rede de segurança de mão única de novo, numa direção que a guarda não
 * considerou. **Uma resposta vazia é uma resposta** — e por isso a condição não
 * pode ser "a fonte normal não trouxe nada", tem de ser "a simulação está
 * ligada".
 *
 * Daí a assinatura assíncrona e o segundo argumento ser um *thunk*: adiar a
 * leitura é o ponto. Ignorar o resultado remoto não bastaria — a leitura custa
 * rede, e nas páginas ela entra num `Promise.all` que atrasa a tela.
 *
 * ## O que é resultado, e o que não é
 *
 *   - **Resultado eleitoral** (voto, percentual, projeção, município, bancada):
 *     em modo simulação, NUNCA vem de fonte remota.
 *   - **Identidade de candidato** (`readCandidatosUf` — nome, partido, foto do
 *     cadastro real do TSE): sempre pode. Não é resultado, e é o que faz a foto
 *     de verdade aparecer na tela que o dono está revisando.
 *
 * Com a simulação desligada, isto devolve exatamente o que o segundo argumento
 * devolvia antes — o caminho de sempre não muda em nada.
 */
export async function resultadoEleitoral<T>(
  daSimulacao: () => T | null,
  daFonteNormal: () => Promise<T | null> | T | null,
): Promise<T | null> {
  if (simulacaoLigada()) return daSimulacao();
  return await daFonteNormal();
}

// ---------------------------------------------------------------------------
// Leitura do disco
// ---------------------------------------------------------------------------

const cache = new Map<string, { mtimeMs: number; dado: unknown }>();

/**
 * Lê e parseia um arquivo da simulação, ou `null` se ele não existir/não
 * parsear.
 *
 * Ausência é caminho ESPERADO, não exceção: os arquivos são gerados por outro
 * processo e podem faltar. Por isso nada aqui lança — quem chama trata `null`
 * como "sem simulação para esta tela", e a tela cai no estado honesto.
 *
 * O cache é chaveado por `mtime` e não por nome: um `statSync` por chamada
 * custa microssegundos e evita reparsear megabytes a cada request, sem congelar
 * a fixture na primeira leitura (regenerar + F5 funciona).
 */
function lerArquivo(nome: string): unknown {
  // `turbopackIgnore` NÃO é cosmético: sem ele o Turbopack lê este
  // `process.cwd()` como "pode ler qualquer arquivo do projeto" e traça o
  // repositório INTEIRO para dentro de cada função serverless — inclusive o
  // `package.json` da raiz, que tem `"type": "module"`. O launcher da Vercel é
  // CommonJS e passa a falhar com `require() of ES Module .../page.js`: TODAS
  // as páginas do site voltam 500. Foi o que derrubou a produção em 17/09
  // (deploy das 03h43 UTC), três dias depois de este módulo nascer — o build
  // anterior não tinha o módulo, então ninguém ligou uma coisa à outra.
  // O módulo é só de desenvolvimento; em produção este caminho nunca roda.
  const caminho = join(/*turbopackIgnore: true*/ process.cwd(), ...DIRETORIO, nome);

  let mtimeMs: number;
  try {
    mtimeMs = statSync(caminho).mtimeMs;
  } catch {
    return null; // ainda não gerado
  }

  const memorizado = cache.get(nome);
  if (memorizado && memorizado.mtimeMs === mtimeMs) return memorizado.dado;

  try {
    const dado: unknown = JSON.parse(readFileSync(caminho, "utf8"));
    cache.set(nome, { mtimeMs, dado });
    return dado;
  } catch (erro) {
    // Barulhento de propósito: JSON quebrado que vira silêncio faria a tela
    // cair no estado vazio e o dono procurar o bug na UI, não no arquivo.
    console.warn(`[simulacao] ${nome} ilegível — a tela cai no caminho honesto.`, erro);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Relógio
// ---------------------------------------------------------------------------

/**
 * Reescreve `ts` e `dado_ts` para o instante atual, e desloca as séries
 * temporais pelo MESMO delta.
 *
 * O produto data o dado (ADR-0038): passando do limiar do cargo, a tela acende
 * tarja âmbar e o selo do topo muda. Servindo o `ts` gravado na geração, depois
 * de uma hora revisando telas o dono veria alarme de dado velho em tudo — ruído
 * sobre o que ele não está avaliando.
 *
 * ⚠️ **`dado_ts` tem TRÊS estados e a reescrita não pode colapsá-los.** Ausente
 * = payload anterior ao ADR-0038 (a tela cai no texto de `ts`); `null` = nenhum
 * boletim do ciclo trouxe hora parseável ("indisponível neste ciclo"); string =
 * a hora do TSE. Só a string anda. Criar o campo onde ele não existia, ou
 * trocar `null` por uma hora, mudaria QUAL tela o dono revisa — e o ADR proíbe
 * colapsar os três em dois.
 *
 * ⚠️ **As séries são o outro relógio da tela** (`margem`, `p_vitoria`,
 * `turnout` — RF-040/041/042), e um `ts` nestes arrays é um ponto no eixo x, não
 * a idade do payload. Carimbar "agora" em todos colapsaria a série inteira num
 * instante só — um gráfico virando uma coluna. Deslocar pelo mesmo delta
 * preserva a forma e mantém a última medição encostada no cabeçalho, que é o
 * que o dono compara.
 */
function comRelogioAgora<T>(payload: T, agoraMs: number): T {
  const bruto = payload as Record<string, unknown>;
  const agoraIso = new Date(agoraMs).toISOString();
  const saida: Record<string, unknown> = { ...bruto, ts: agoraIso };

  if (typeof bruto.dado_ts === "string") saida.dado_ts = agoraIso;

  const originalMs = typeof bruto.ts === "string" ? Date.parse(bruto.ts) : Number.NaN;
  const delta = Number.isFinite(originalMs) ? agoraMs - originalMs : 0;
  const series = bruto.series_temporais;
  if (delta !== 0 && series !== null && typeof series === "object") {
    saida.series_temporais = deslocarSeries(series as Record<string, unknown>, delta);
  }

  // 🔴 A série por candidatura do payload NACIONAL mora no TOPO
  // (`EdgePayload.serie_por_candidato`), não dentro de `series_temporais` — que
  // é onde vivem `margem`/`p_vitoria`/`turnout` e onde o detalhe por UF guarda
  // a dele. São dois lugares, e o deslocador só olhava um.
  //
  // Encontrado em 18/09 OLHANDO A TELA, não por teste: com as fixtures da Fase 3
  // recém-geradas, a home mostrava o cabeçalho em "agora" e o gráfico parado no
  // horário da fixture, enquanto `/uf/SP` acompanhava — as duas telas da mesma
  // sessão de `dev:sim` discordando sobre que horas são. É literalmente o
  // defeito que a nota de `deslocarSeries` avisa ("o cabeçalho dizendo 'agora'
  // com o gráfico novo plantado horas atrás"), aparecendo pelo outro caminho.
  if (delta !== 0) {
    saida.serie_por_candidato = deslocarEixoPorCandidato(bruto.serie_por_candidato, delta);
  }

  // Spec 026 — o TERCEIRO relógio do detalhe de UF de Deputado: a Conferência
  // data o boletim do agregado que comparou (`conferencia.boletim_dado_ts`).
  // Sem andar junto, `/uf/RR/deputado-federal` diria "agora" no cabeçalho e
  // "boletim das 10h40" na Conferência — a mesma discordância de relógios que
  // a série por candidatura já teve. Anda pelo MESMO delta; `null` (sem
  // agregado) e data impossível ficam como estão.
  if (delta !== 0) {
    const conf = bruto.conferencia;
    if (conf !== null && typeof conf === "object") {
      const boletim = (conf as Record<string, unknown>).boletim_dado_ts;
      const ms = typeof boletim === "string" ? Date.parse(boletim) : Number.NaN;
      if (Number.isFinite(ms)) {
        saida.conferencia = { ...conf, boletim_dado_ts: new Date(ms + delta).toISOString() };
      }
    }
  }

  return saida as T;
}

/**
 * Desloca o eixo da série por candidatura (spec 020), preservando tudo o mais.
 *
 * O eixo é `string[]` de ISO, não uma lista de objetos com `ts` — por isso não
 * cabe no laço de pontos acima. Data impossível fica como está, pela mesma
 * razão registrada lá: inventar uma hora seria fabricar medição.
 */
function deslocarEixoPorCandidato(valor: unknown, deltaMs: number): unknown {
  if (valor === null || typeof valor !== "object") return valor;
  const serie = valor as Record<string, unknown>;
  if (!Array.isArray(serie.eixo)) return valor;

  return {
    ...serie,
    eixo: serie.eixo.map((iso: unknown) => {
      if (typeof iso !== "string") return iso;
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return iso;
      return new Date(ms + deltaMs).toISOString();
    }),
  };
}

/**
 * Soma `deltaMs` ao `ts` de cada ponto de cada série, preservando o resto.
 *
 * **Exportada para teste**, e só por isso: é função pura, sem I/O, e o defeito
 * que ela fecha (a série por candidatura ficando parada no relógio antigo) só
 * seria alcançável pelas funções públicas depois que a Fase 3 puser o campo
 * nas fixtures. Cobrir agora vale mais que esperar. Nenhum caminho de
 * produção a importa — a exportação não a põe em bundle de cliente, porque
 * este módulo inteiro é servidor-only.
 */
export function deslocarSeries(
  series: Record<string, unknown>,
  deltaMs: number,
): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...series };

  for (const [chave, valor] of Object.entries(series)) {
    // 🔴 A série por candidatura (spec 020) NÃO é um array de pontos: é um
    // objeto `{eixo, cadencia_min, candidatos}` cujo eixo é uma lista de ISO
    // puros. O `continue` genérico abaixo a deixava passar INTACTA, e o
    // resultado no `pnpm dev:sim` seria o cabeçalho dizendo "agora" com o
    // gráfico novo plantado horas atrás, enquanto os outros três acompanham.
    // Tratada por NOME, e não por uma heurística de forma: um ramo que tenta
    // adivinhar a estrutura é como um conversor com default silencioso — e o
    // último deste repositório mandou todo payload de Senador para a chave do
    // Presidente.
    if (chave === "por_candidato") {
      saida[chave] = deslocarEixoPorCandidato(valor, deltaMs);
      continue;
    }
    if (!Array.isArray(valor)) continue;
    saida[chave] = valor.map((ponto: unknown) => {
      if (ponto === null || typeof ponto !== "object") return ponto;
      const p = ponto as Record<string, unknown>;
      if (typeof p.ts !== "string") return ponto;
      const ms = Date.parse(p.ts);
      // Ponto com data impossível fica como está: inventar uma hora para ele
      // seria fabricar medição, que é a falha que este projeto persegue.
      if (!Number.isFinite(ms)) return ponto;
      return { ...p, ts: new Date(ms + deltaMs).toISOString() };
    });
  }

  return saida;
}

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

/** Aplica portão + relógio. `sim-velho` sai com o `ts` como gravado. */
function servir<T>(dado: unknown, variante: Variante): T | null {
  if (dado === null || typeof dado !== "object" || Array.isArray(dado)) return null;
  // Cópia rasa mesmo em `sim-velho`: o objeto no cache é compartilhado entre
  // requests, e devolver a referência convidaria uma mutação a distância.
  if (variante === "sim-velho") return { ...(dado as Record<string, unknown>) } as T;
  return comRelogioAgora(dado as T, Date.now());
}

/** Arquivo inteiro = um payload. */
function servirArquivo<T>(nome: string): T | null {
  const variante = varianteAtiva();
  if (!variante) return null;
  return servir<T>(lerArquivo(nome), variante);
}

/** Arquivo = `Record<sigla, payload>`. */
function servirDoMapa<T>(nome: string, sigla: string): T | null {
  const variante = varianteAtiva();
  if (!variante) return null;
  const mapa = lerArquivo(nome);
  if (mapa === null || typeof mapa !== "object") return null;
  const registro = (mapa as Record<string, unknown>)[sigla.toUpperCase()];
  return registro === undefined ? null : servir<T>(registro, variante);
}

/**
 * Tabela, e não ternário encadeado nem `??`.
 *
 * O default silencioso em conversor de cargo já mordeu este repositório três
 * vezes — a última mandava todo payload de Senador para a chave do Presidente.
 * Uma tabela indexada por união literal não tem ramo de fallback onde o erro
 * possa se esconder: cargo novo sem arquivo é erro de compilação, não uma tela
 * calada mostrando a corrida errada.
 */
const ARQUIVO_NACIONAL = {
  pres: "presidente.json",
  gov: "governador.json",
  sen: "senador.json",
} as const;

/** Payload nacional de Presidente, Governador ou Senador. */
export function simulacaoNacional(cargo: keyof typeof ARQUIVO_NACIONAL): EdgePayload | null {
  return servirArquivo<EdgePayload>(ARQUIVO_NACIONAL[cargo]);
}

/** Payload nacional de Deputado Federal — tipo próprio (design 017 § D1). */
export function simulacaoDeputadoNacional(): EdgePayloadDeputado | null {
  return servirArquivo<EdgePayloadDeputado>("deputado.json");
}

/** Resumo de UF de Senador (`/uf/[sigla]/senador`). */
export function simulacaoSenadorUf(sigla: string): EdgePayloadUf | null {
  return servirDoMapa<EdgePayloadUf>("senador-uf.json", sigla);
}

/**
 * Resumo de UF de Governador (`/uf/[sigla]/governador` e
 * `GET /api/projection?uf=&cargo=gov`).
 *
 * ## Por que este getter passou a existir em 2026-09-19
 *
 * Havia uma decisão escrita, em três arquivos, de que cargo 3 **não** precisava
 * de arquivo por UF: a síntese a partir do payload nacional, filtrada por
 * `por_uf[].top_candidatos`, recorta a corrida daquela UF com a votação dela,
 * porque candidatura a governador só existe num estado. O argumento está certo
 * e responde à pergunta errada — ele prova que os números do recorte são da UF,
 * não que o recorte tem a corrida inteira.
 *
 * E não tem: `top_candidatos` é `slice(0, 4)`. São Paulo tem 7 candidaturas a
 * governador. Como o detalhe municipal (`municipios-gov-t1.json`) reparte votos
 * entre TODAS elas, o balão do hover do coroplético encontrava `26004` em
 * `votos_reportados`, não achava ninguém com esse `id` na lista que a moldura
 * do mapa recebeu, e escrevia **"Candidato 26004"** sem partido.
 *
 * 🔴 Produção nunca teve esse defeito — lá o `EdgePayloadUf` real de governador
 * chega do orchestrator com `candidatos[]` completo, e a rota lê o payload em
 * vez de sintetizar. Era lacuna só do modo simulado; como é no simulado que o
 * dono confere, a lacuna estava na tela dele.
 *
 * Como `simulacaoUfPresidente`, este getter tem PRIORIDADE sobre a síntese, e
 * enquanto o arquivo não existir devolve `null` — a tela segue exatamente como
 * antes, com as 4 do pódio.
 */
export function simulacaoGovernadorUf(sigla: string): EdgePayloadUf | null {
  return servirDoMapa<EdgePayloadUf>("governador-uf.json", sigla);
}

/**
 * Resumo de UF presidencial (`/uf/[sigla]` e `GET /api/projection?uf=`).
 *
 * ## Por que este arquivo é necessário, e a síntese não basta
 *
 * Defeito visto no navegador em 2026-09-15: `/uf/SP` exibia o candidato líder
 * com 10.475.955 votos — exatamente o número NACIONAL da home. O percentual
 * apurado vinha certo (35,0%, a taxa de SP), porque a linha de `por_uf` chega;
 * a votação POR CANDIDATO daquele estado é que não chega.
 *
 * A causa é estrutural, não um bug: sem payload presidencial por UF, a página
 * cai em `synthesizeUfFromNational`, que mapeia os 12 candidatos nacionais com
 * os votos do Brasil inteiro. Para Governador o mesmo truque funciona — cada
 * candidatura estadual só existe num estado, e a síntese filtra por
 * `top_candidatos` —, mas a cédula presidencial é a mesma nos 27 estados, e não
 * há o que filtrar.
 *
 * Este getter tem PRIORIDADE sobre a síntese. Enquanto o arquivo não existir
 * ele devolve `null` e a tela segue como hoje, com o número nacional.
 */
export function simulacaoUfPresidente(sigla: string): EdgePayloadUf | null {
  return servirDoMapa<EdgePayloadUf>("presidente-uf.json", sigla);
}

/** Detalhe de UF de Deputado Federal (`/uf/[sigla]/deputado-federal`). */
export function simulacaoDeputadoUf(sigla: string): DeputadoUfDetail | null {
  return servirDoMapa<DeputadoUfDetail>("deputado-uf.json", sigla);
}

/**
 * Lista 61+ de Deputado Federal (`/uf/[sigla]/deputado-federal/lista`, spec
 * 026). `null` enquanto o gerador não emitir `deputado-uf-lista.json` — a rota
 * então responde lista vazia, nunca a do Blob remoto.
 */
export function simulacaoDeputadoUfLista(sigla: string): DeputadoUfLista | null {
  return servirDoMapa<DeputadoUfLista>("deputado-uf-lista.json", sigla);
}

/**
 * O VALOR bruto do interruptor da projeção no modo simulado
 * (`interruptor-projecao-dep.json`), ou `undefined` sem o arquivo — que é a
 * chave ausente, e portanto DESLIGADA (falha fechada, ADR-0063 D4;
 * `interpretarInterruptor`, `lib/edge-config/reader.ts`). Para revisar a tela
 * com a projeção, o arquivo precisa dizer `{"ligada": true}`; para revisá-la
 * desligada, `{"ligada": false}` ou nenhum arquivo.
 *
 * Não passa pelo relógio: não é resultado eleitoral, é decisão de operador.
 */
export function simulacaoInterruptorProjecao(): unknown {
  if (!varianteAtiva()) return undefined;
  const valor = lerArquivo("interruptor-projecao-dep.json");
  return valor === null ? undefined : valor;
}

// ---------------------------------------------------------------------------
// Assembleias — Deputado Estadual (7) e Distrital (8), spec 027 frente S
// ---------------------------------------------------------------------------

/** Os cargos proporcionais que NÃO são o federal. */
export type CargoAssembleia = 7 | 8;

/**
 * Os arquivos de cada casa, gerados por `data-pipeline/simulacao-assembleias.py`
 * (o modelo Python real sobre EA20 do simulado do TSE — sem banco). Tabela
 * fechada por cargo, sem ramo de fallback: ler `deputado.json` para o 7 poria
 * a bancada da Câmara dos Deputados na página da Assembleia com cara de dado
 * certo (o defeito do conversor de enum com default silencioso). O 8 não tem
 * lista 61+ (a Câmara Legislativa tem 24 lugares) — o arquivo nunca existe e
 * a leitura devolve `null`.
 */
const ARQUIVOS_ASSEMBLEIA: Readonly<
  Record<CargoAssembleia, { nacional: string; uf: string; lista: string }>
> = {
  7: {
    nacional: "deputado-estadual.json",
    uf: "deputado-estadual-uf.json",
    lista: "deputado-estadual-uf-lista.json",
  },
  8: {
    nacional: "deputado-distrital.json",
    uf: "deputado-distrital-uf.json",
    lista: "deputado-distrital-uf-lista.json",
  },
};

/** Payload nacional de uma casa (`projection-current-{est,dis}-t1` no simulado). */
export function simulacaoAssembleiaNacional(cargo: CargoAssembleia): EdgePayloadDeputado | null {
  return servirArquivo<EdgePayloadDeputado>(ARQUIVOS_ASSEMBLEIA[cargo].nacional);
}

/**
 * Detalhe da UF de uma casa (`/uf/[sigla]/deputado-{estadual,distrital}`).
 * A UF fora do cargo (o DF no 7, qualquer outra no 8) não está no mapa ⇒ `null`.
 */
export function simulacaoAssembleiaUf(
  cargo: CargoAssembleia,
  sigla: string,
): DeputadoUfDetail | null {
  return servirDoMapa<DeputadoUfDetail>(ARQUIVOS_ASSEMBLEIA[cargo].uf, sigla);
}

/** Lista 61+ de uma casa (`/uf/[sigla]/deputado-estadual/lista`). */
export function simulacaoAssembleiaUfLista(
  cargo: CargoAssembleia,
  sigla: string,
): DeputadoUfLista | null {
  return servirDoMapa<DeputadoUfLista>(ARQUIVOS_ASSEMBLEIA[cargo].lista, sigla);
}

/**
 * O VALOR bruto de `interruptor-projecao-est` no modo simulado
 * (`interruptor-projecao-est.json`), ou `undefined` sem o arquivo — chave
 * ausente, projeção das assembleias DESLIGADA. Na Fase 1 o gerador não emite
 * o arquivo de propósito: as assembleias não projetam (RF-285). É um arquivo
 * SEPARADO do federal — `-dep` nunca liga 7 e 8 (RF-287).
 */
export function simulacaoInterruptorProjecaoEst(): unknown {
  if (!varianteAtiva()) return undefined;
  const valor = lerArquivo("interruptor-projecao-est.json");
  return valor === null ? undefined : valor;
}

/**
 * Detalhe municipal — o que pinta o coroplético dentro da UF.
 *
 * ⚠️ **Esta fixture não estava na lista combinada e pode não existir.** Sem
 * ela, `simulacaoLigada()` faz a rota de municípios responder "indisponível"
 * em vez de cair na fixture municipal antiga: um mapa municipal de OUTRA
 * apuração ao lado do placar da simulação é a contradição exata que este
 * módulo existe para evitar, e o dono gastaria horas caçando um bug de UI que
 * não existe. Mapa mudo é revisável; mapa mentindo, não.
 *
 * O nome é derivado de cargo e turno, então basta o arquivo aparecer no
 * diretório para a rota passar a servi-lo — nenhuma mudança de código.
 */
export function simulacaoMunicipiosUf(
  sigla: string,
  cargo: Cargo,
  turno: Turno,
): UfDetailBlob | null {
  return servirDoMapa<UfDetailBlob>(`municipios-${cargo}-t${turno}.json`, sigla);
}
