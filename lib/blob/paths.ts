/**
 * lib/blob/paths.ts
 *
 * **Ponto único** de construção de caminho e de URL do Vercel Blob — o
 * equivalente, para o Blob, do que `lib/edge-config/keys.ts` é para o Global
 * Config. Nada no repositório deve montar um pathname de blob por
 * concatenação ad hoc.
 *
 * ## Por que este módulo existe
 *
 * O [ADR-0026](../../docs/architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md)
 * abriu o Vercel Blob como segundo mecanismo do read path, restrito ao
 * drill-down de UF de Deputado Federal. O
 * [ADR-0032](../../docs/architecture/adrs/0032-detalhe-municipal-vercel-blob.md)
 * generalizou a exceção para o detalhe municipal e as séries temporais de
 * Presidente/Governador, e foi **explícito** quanto a não abrir um segundo
 * padrão:
 *
 *   > "a implementação que materializa este ADR e a que materializa o ADR-0026
 *   > devem compartilhar o mesmo módulo de escrita/leitura Blob — não é
 *   > opcional, é a razão de existir um 'esquema de caminho' único em vez de
 *   > dois ad hoc."
 *
 * Por isso os dois recursos saem daqui: {@link ufDetailBlobPathname} (municípios
 * + séries, ADR-0032) e {@link deputadoUfBlobPathname} (drill-down de Deputado
 * Federal, ADR-0026). Os dois são a MESMA função de base
 * ({@link blobPathname}), com qualificadores diferentes.
 *
 * ## O esquema
 *
 * ```
 *   municipios/uf/<SIGLA>/<cargo>/t<turno>.json   municipios/uf/SP/pres/t1.json
 *   deputado/uf/<SIGLA>.json                      deputado/uf/SP.json
 *   deputado/uf-lista/<SIGLA>.json                deputado/uf-lista/SP.json
 *   candidatos/uf/<SIGLA>/<cargo>.json            candidatos/uf/SP/dep.json
 *   candidatos/index.json                         candidatos/index.json
 *   candidatos/foto/<SIGLA>/<SQ_CANDIDATO>.jpg    candidatos/foto/SP/250002553928.jpg
 * ```
 *
 * **Separador `/`, não `:`.** Os dois ADRs escreveram o caminho com
 * dois-pontos (`municipios:uf:SP:pres:t1.json`). Medido contra o store real em
 * 2026-09-08: o `put()` aceita dois-pontos, **mas a URL pública volta
 * percent-encoded** (`municipios%3Auf%3ASP%3Apres%3At1.json`). Como o ADR-0032
 * manda construir a URL a partir do pathname *sem lookup*, dois-pontos exigiria
 * `encodeURIComponent` em todo uso — e uma concatenação ingênua produziria um
 * 404 que só aparece em produção. Com `/` a URL sai limpa e o GET responde 200.
 *
 * Isto **não contraria** a decisão dos ADRs: o *onde* (Blob), o *recurso* e os
 * *qualificadores* (`uf`, `<sigla>`, `<cargo>`, `t<turno>`) seguem idênticos —
 * muda o separador, como já mudou no Global Config quando `keys.ts` trocou `:`
 * por `-` pelo mesmo tipo de motivo (padrão da plataforma, não gosto).
 *
 * ## A URL é determinística, e é derivada — nunca guardada
 *
 * `put()` com pathname fixo e `allowOverwrite: true` devolve sempre a mesma
 * URL (verificado empiricamente contra o store real: escrita, releitura,
 * sobrescrita e remoção). Então o read path **não precisa de índice nem de
 * lookup**: monta a URL a partir do pathname e do host público do store.
 *
 * O host sai do próprio `BLOB_READ_WRITE_TOKEN`, cujo formato é
 * `vercel_blob_rw_<storeId>_<segredo>`; o host público é
 * `https://<storeid em minúsculas>.public.blob.vercel-storage.com`. Nenhum
 * segredo vaza: só o `storeId` é usado, e ele já é público por construção (é o
 * subdomínio que qualquer leitor do site vê). `BLOB_PUBLIC_BASE_URL` existe
 * como override explícito — é o que os testes usam, e é a saída caso a Vercel
 * mude o formato do token.
 */

import type { Cargo, Turno } from "@/lib/config/calendar";
import { type CargoProporcional, cargoExisteNaUf, cargoInfo } from "@/lib/config/cargos";

// ---------------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------------

/**
 * Um segmento de caminho de blob. Deliberadamente MAIS restrito do que o que o
 * Blob aceita: só o alfabeto que o Global Config já admite em nome de chave
 * (`^[A-Za-z0-9_-]+$`). Assim o mesmo dado (sigla, cargo, turno) produz um
 * identificador válido nos dois mecanismos, e nenhum caractere precisa de
 * escape na URL.
 */
export const BLOB_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Siglas de UF entram literalmente no caminho — validadas como em `keys.ts`. */
const UF_SIGLA_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Valida um segmento; devolve o próprio para permitir uso inline.
 *
 * A mensagem aponta o caractere ofensor e a origem, pela mesma razão de
 * `assertValidGlobalConfigKey`: um caminho errado só falharia em produção, com
 * um 404 mudo do CDN.
 *
 * @throws Error quando o segmento é vazio ou tem caractere fora do padrão.
 */
export function assertValidBlobSegment(segment: string, context: string): string {
  if (BLOB_PATH_SEGMENT_PATTERN.test(segment)) return segment;

  if (segment.length === 0) {
    throw new Error(`segmento de caminho de Blob inválido (origem: ${context}): string vazia.`);
  }

  const offenders = [...new Set(segment.split("").filter((c) => !/[A-Za-z0-9_-]/.test(c)))];
  const colonHint = offenders.includes(":")
    ? ` O separador ":" produz URL percent-encoded no Blob — o esquema deste repositório usa "/" ` +
      `entre segmentos (ver lib/blob/paths.ts).`
    : "";

  throw new Error(
    `segmento de caminho de Blob inválido (origem: ${context}): "${segment}" contém ` +
      `${offenders.map((c) => `"${c}"`).join(", ")}. ` +
      `O padrão é ${BLOB_PATH_SEGMENT_PATTERN.source}.` +
      colonHint,
  );
}

/** Normaliza e valida a sigla — maiúscula é a forma canônica, como em `keys.ts`. */
function normaliseSigla(sigla: string, context: string): string {
  if (!UF_SIGLA_PATTERN.test(sigla)) {
    throw new Error(
      `sigla de UF inválida (origem: ${context}): "${sigla}". ` +
        `Esperado exatamente 2 letras (ex. "SP"). ` +
        `A sigla entra literalmente no caminho do blob.`,
    );
  }
  return sigla.toUpperCase();
}

// ---------------------------------------------------------------------------
// Construtores de pathname
// ---------------------------------------------------------------------------

/**
 * Extensão de arquivo aceita: ponto + minúsculas/dígitos. O ponto faz parte do
 * valor de propósito — `".jpg"`, nunca `"jpg"`. Ver {@link blobPathname}.
 */
const BLOB_EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

/**
 * Junta segmentos validados com `/` e acrescenta a extensão.
 *
 * É a única função que produz um pathname neste repositório — os construtores
 * nomeados abaixo apenas escolhem os segmentos.
 *
 * A extensão é parâmetro desde o
 * [ADR-0041](../../docs/architecture/adrs/0041-foto-candidato-blob-binario-cache-um-ano.md)
 * item 2, quando a foto de candidato trouxe o primeiro binário do produto. O
 * default `".json"` preserva os chamadores anteriores **byte a byte**: nenhum
 * deles precisou mudar, e essa é a razão de o parâmetro ser o terceiro e ter
 * default em vez de ser obrigatório.
 *
 * Extensão malformada **lança**, pela mesma filosofia de erro cedo que
 * {@link assertValidBlobSegment} aplica aos segmentos: `"jpg"` sem ponto,
 * corrigido em silêncio, produziria `candidatos/foto/SP/250002553928jpg` — um
 * caminho que grava sem reclamar e só aparece como 404 mudo do CDN.
 */
export function blobPathname(
  segments: readonly string[],
  context: string,
  extension: string = ".json",
): string {
  if (segments.length === 0) {
    throw new Error(`caminho de Blob vazio (origem: ${context}).`);
  }
  if (!BLOB_EXTENSION_PATTERN.test(extension)) {
    throw new Error(
      `extensão de Blob inválida (origem: ${context}): "${extension}". ` +
        `O padrão é ${BLOB_EXTENSION_PATTERN.source} — o ponto faz parte do valor ` +
        `(use ".jpg", não "jpg").`,
    );
  }
  return `${segments.map((s) => assertValidBlobSegment(s, context)).join("/")}${extension}`;
}

/**
 * Detalhe por UF de uma corrida majoritária (ADR-0032): municípios + séries
 * temporais de Presidente/Governador.
 *
 * `municipios/uf/<SIGLA>/<cargo>/t<turno>.json` — ex. `municipios/uf/SP/pres/t1.json`.
 *
 * Os qualificadores são os mesmos da chave de Global Config
 * (`projection-uf-SP-pres-t1`, ADR-0012): Presidente e Governador coexistem em
 * cargo e turno simultâneos, então o caminho precisa dos dois.
 */
export function ufDetailBlobPathname(sigla: string, cargo: Cargo, turno: Turno): string {
  const uf = normaliseSigla(sigla, "ufDetailBlobPathname");
  return blobPathname(["municipios", "uf", uf, cargo, `t${turno}`], "ufDetailBlobPathname");
}

/**
 * O primeiro segmento do caminho de Blob de um cargo proporcional (spec 027
 * RF-279, ADR-0066):
 *
 *   6 → `deputado`            (Deputado Federal — INALTERADO desde 2026-09-12)
 *   7 → `deputado-estadual`   (26 Assembleias)
 *   8 → `deputado-distrital`  (Câmara Legislativa do DF)
 *
 * 🔴 Sem cargo no caminho, o objeto de SP estadual seria gravado em
 * `deputado/uf/SP.json` — POR CIMA do de SP federal, com JSON válido e sem
 * erro. O federal fica onde sempre esteve: renomear o prefixo dele obrigaria a
 * republicar os 27 objetos e a mudar o servidor falso dos portões às vésperas
 * de 04/10, por nada.
 *
 * `switch` sem `default` que escolha: um cargo proporcional novo sem prefixo
 * decidido é erro de compilação (`never`) e, se escapar por um `as`, lança.
 *
 * Exportado para o escritor nomear as falhas no log pelo MESMO prefixo do
 * caminho (`deputado/uf-lista/SP` para o federal, como antes da spec 027).
 */
export function prefixoBlobDeputado(
  cargo: CargoProporcional,
  context = "prefixoBlobDeputado",
): string {
  switch (cargo) {
    case 6:
      return "deputado";
    case 7:
      return "deputado-estadual";
    case 8:
      return "deputado-distrital";
    default: {
      const naoCoberto: never = cargo;
      throw new Error(
        `cargo sem caminho de Blob de Deputado (origem: ${context}): ${String(naoCoberto)}`,
      );
    }
  }
}

/**
 * Valida que a corrida do cargo existe na UF (`ufsDoCargo`) antes de montar o
 * caminho: `deputado-distrital/uf/SP.json` e `deputado-estadual/uf/DF.json` não
 * são objetos que existam — montar um deles é erro de quem chamou, e lançar
 * aqui impede tanto a gravação quanto a leitura de um endereço fantasma
 * (spec 027 RF-278).
 */
function siglaDoCargo(cargo: CargoProporcional, sigla: string, context: string): string {
  const uf = normaliseSigla(sigla, context);
  if (!cargoExisteNaUf(cargo, uf)) {
    throw new Error(
      `UF sem corrida de ${cargoInfo(cargo).label} (origem: ${context}): "${uf}" — ` +
        `ver ufsDoCargo em lib/config/cargos.ts.`,
    );
  }
  return uf;
}

/**
 * Drill-down por UF de um cargo proporcional (ADR-0026; spec 027 RF-279).
 *
 * `<prefixo>/uf/<SIGLA>.json` — `deputado/uf/SP.json` (federal),
 * `deputado-estadual/uf/SP.json`, `deputado-distrital/uf/DF.json`. Sem turno:
 * os três se decidem em turno único. O cargo é **obrigatório, sem default**
 * (ver {@link prefixoBlobDeputado}).
 *
 * Nasceu antes do consumidor, e de propósito: o ADR-0032 exige que os dois
 * recursos saiam do mesmo esquema, e um construtor que nasce junto do
 * consumidor nasce como segundo padrão. O consumidor chegou em 2026-09-12 —
 * `lib/blob/deputado-uf.ts` (leitura) e `writeDeputadoProjection` em
 * `lib/edge-config/writer.ts` (escrita).
 *
 * ⚠️ O comentário anterior dizia "o cargo 6 não é ingerido hoje". Isso deixou
 * de ser verdade em **2026-09-11**, quando a ingestão do cargo 6 entrou. Desde
 * o **ADR-0036 (2026-09-13)** ela é em granularidade zona (par município×zona,
 * ~6.110 alvos), varrida em 6 fatias a cada 5 min — **volta completa em 30
 * min**, não mais 15.
 */
export function deputadoUfBlobPathname(cargo: CargoProporcional, sigla: string): string {
  const ctx = "deputadoUfBlobPathname";
  const prefixo = prefixoBlobDeputado(cargo, ctx);
  const uf = siglaDoCargo(cargo, sigla, ctx);
  return blobPathname([prefixo, "uf", uf], ctx);
}

/**
 * Lista RESTANTE de candidaturas de um cargo proporcional numa UF — os ranks
 * **61 em diante** de cada agremiação (spec 026 RF-260, ADR-0065).
 *
 * `<prefixo>/uf-lista/<SIGLA>.json` — ex. `deputado/uf-lista/SP.json` (federal,
 * inalterado), `deputado-estadual/uf-lista/SP.json`,
 * `deputado-distrital/uf-lista/DF.json` (spec 027 RF-279). Cargo obrigatório.
 *
 * Objeto próprio, e não mais um campo de `deputado/uf/<SIGLA>.json`, porque a
 * página não os usa no primeiro render: os 60 primeiros de cada agremiação já
 * vêm no objeto da UF, e o resto só é pedido quando o leitor clica em "ver
 * todos". Colocá-los no objeto principal custaria ~5× o peso da página de SP
 * para servir um clique que a maioria não dá. O escritor
 * (`writeDeputadoUfDetails`, `lib/edge-config/writer.ts`) separa o campo de
 * transporte `lista_restante` e grava os dois objetos no mesmo ciclo.
 *
 * `uf-lista`, e não `uf/<SIGLA>/lista`: com um segmento a mais sob
 * `deputado/uf/`, o prefixo `deputado/uf/SP` casaria os dois objetos, e quem
 * listar o store por prefixo passaria a ver dois recursos onde havia um.
 */
export function deputadoUfListaBlobPathname(cargo: CargoProporcional, sigla: string): string {
  const ctx = "deputadoUfListaBlobPathname";
  const prefixo = prefixoBlobDeputado(cargo, ctx);
  const uf = siglaDoCargo(cargo, sigla, ctx);
  return blobPathname([prefixo, "uf-lista", uf], ctx);
}

// ---------------------------------------------------------------------------
// Identidade de candidatura — spec 018 (ADR-0039 a ADR-0042)
// ---------------------------------------------------------------------------

/**
 * Fatia de identidade de candidatura de UMA UF e UM cargo (ADR-0039).
 *
 * `candidatos/uf/<SIGLA>/<cargo>.json` — ex. `candidatos/uf/SP/dep.json`.
 *
 * Fatiado por UF × cargo, e não um arquivo nacional único, pela mesma linha
 * divisória do ADR-0032: são ~8.400 candidaturas, e a página que precisa da
 * lista sempre precisa de uma UF e um cargo — baixar as outras 26 UFs para
 * mostrar uma seria latência sem contrapartida. Sem turno no caminho: a
 * identidade de quem se candidatou não muda entre 1º e 2º turno (ADR-0042 —
 * a chave é `sqcand`, global e estável).
 */
export function candidatosUfBlobPathname(sigla: string, cargo: Cargo): string {
  const uf = normaliseSigla(sigla, "candidatosUfBlobPathname");
  return blobPathname(["candidatos", "uf", uf, cargo], "candidatosUfBlobPathname");
}

/**
 * Índice único das fatias de candidatura — `candidatos/index.json`.
 *
 * Existe para que o consumidor saiba **o que foi publicado e quando** sem ter
 * de sondar 27 × 4 caminhos e interpretar 404s: um 404 numa fatia é
 * ambíguo entre "esta UF não tem este cargo" e "o importador não rodou", e a
 * diferença importa para o leitor (constituição § 8).
 */
export function candidatosIndexBlobPathname(): string {
  return blobPathname(["candidatos", "index"], "candidatosIndexBlobPathname");
}

/**
 * Foto oficial de UM candidato (ADR-0041 item 5).
 *
 * `candidatos/foto/<SIGLA>/<SQ_CANDIDATO>.jpg` — ex.
 * `candidatos/foto/SP/250002553928.jpg`.
 *
 * `sqCandidato` é **`string`**, e não `number`, de propósito: são 11 ou 12 dígitos, o
 * tipo no banco é `bigint`, e converter para `number` no meio do caminho é
 * convidar uma perda de precisão que só apareceria como foto do candidato
 * errado. Só dígitos, então passa em {@link BLOB_PATH_SEGMENT_PATTERN} sem
 * escape nenhum — mesma premissa de URL limpa do resto do esquema.
 *
 * A extensão é `.jpg` porque o TSE publica JPEG 161×225 px (ADR-0041,
 * contexto). É o primeiro binário do produto; a escrita é
 * `putBinary` em `lib/blob/write.ts`, com cache de 1 ano — ver
 * `BLOB_IMMUTABLE_MAX_AGE_SECONDS` lá para o porquê de não serem os 60 s do
 * JSON de apuração.
 */
export function candidatoFotoBlobPathname(sigla: string, sqCandidato: string): string {
  const uf = normaliseSigla(sigla, "candidatoFotoBlobPathname");
  return blobPathname(["candidatos", "foto", uf, sqCandidato], "candidatoFotoBlobPathname", ".jpg");
}

// ---------------------------------------------------------------------------
// Host público do store
// ---------------------------------------------------------------------------

/** `vercel_blob_rw_<storeId>_<segredo>`. */
const BLOB_TOKEN_PATTERN = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9]+$/;

/** Sufixo do host público de um store de Vercel Blob. */
const BLOB_PUBLIC_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Base pública do store, sem barra final — ex.
 * `https://jbtu251tioj3y57z.public.blob.vercel-storage.com`.
 *
 * Ordem de resolução:
 *   1. `BLOB_PUBLIC_BASE_URL` (override explícito; o que os testes usam).
 *   2. Derivada do `storeId` embutido no `BLOB_READ_WRITE_TOKEN`.
 *   3. `null` — ambiente sem Blob configurado (dev/preview sem credencial).
 *      Caller degrada; não lança.
 */
export function blobPublicBaseUrl(): string | null {
  const override = process.env.BLOB_PUBLIC_BASE_URL;
  if (override) return override.replace(/\/+$/, "");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const storeId = BLOB_TOKEN_PATTERN.exec(token)?.[1];
  if (!storeId) return null;

  return `https://${storeId.toLowerCase()}${BLOB_PUBLIC_HOST_SUFFIX}`;
}

/**
 * URL pública determinística de um pathname. `null` quando o ambiente não tem
 * Blob configurado — o read path trata isso como "detalhe indisponível", não
 * como erro (ADR-0032 item 3).
 */
export function blobUrlFor(pathname: string): string | null {
  const base = blobPublicBaseUrl();
  return base ? `${base}/${pathname}` : null;
}

/**
 * URL da foto de UM candidato, ou `null` — **e nunca lança**.
 *
 * As três portas para `null` são estado normal, não erro, e é por isso que elas
 * moram juntas aqui em vez de em cada tela:
 *
 *   1. `sqcand` ausente. É o caso **por contrato** no bloco nacional de
 *      Governador e Senador: ali as 27 corridas dividem o mesmo espaço de `id`
 *      e uma foto apontaria para a pessoa errada (RF-145).
 *   2. Ambiente sem Blob configurado — `blobUrlFor` devolve `null` (ADR-0032
 *      item 3). É o estado de qualquer preview sem credencial, e do harness de
 *      teste.
 *   3. Sigla malformada. {@link candidatoFotoBlobPathname} lança nesse caso, e
 *      aqui isso vira fallback em vez de 500: a moldura da página é obrigação
 *      da constituição § 7, e uma rota de UF com sigla inválida já é 404 pelo
 *      roteador — não precisa derrubar o render por causa de um avatar.
 *
 * Existe porque a derivação estava COPIADA em `<CandidateCard>` e no
 * `<ResultPanel>`, e a terceira cópia ia nascer com esta mudança. É o mesmo
 * motivo do `lib/utils/nome-candidato.ts`: quem deriva por conta própria
 * diverge em silêncio.
 */
export function candidatoFotoUrl(
  sigla: string,
  sqCandidato: string | null | undefined,
): string | null {
  if (!sqCandidato) return null;
  try {
    return blobUrlFor(candidatoFotoBlobPathname(sigla, sqCandidato));
  } catch {
    return null;
  }
}

/**
 * Leitura da noite (ADR-0072): histórico do Boletim, manchetes e análise por
 * IA da home presidencial, gravados pelo cron `/api/internal/leitura-noite`.
 *
 * `leitura/pres/t<turno>.json` — ex. `leitura/pres/t1.json`.
 */
export function leituraNoiteBlobPathname(turno: Turno): string {
  return blobPathname(["leitura", "pres", `t${turno}`], "leituraNoiteBlobPathname");
}
