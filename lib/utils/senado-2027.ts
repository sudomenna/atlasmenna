/**
 * lib/utils/senado-2027.ts — as 81 cadeiras do Senado de 2027, derivadas do
 * payload de Senador + a foto dos 27 mandatos até 2031. Spec 023, RF-216/217;
 * ADR-0061 item 3; design 023 §§ D3, D4, D6.
 *
 * Função pura: sem I/O, sem relógio, sem log (constituição § 6). Quem loga a
 * recusa é o painel (`SenadoHemicicloPanel`).
 *
 * ## As 54 vagas saem da MESMA conta do produtor
 *
 * O produtor (`api/model/project.py:6841-6887`) conta, por UF, os
 * `vagas_por_uf` primeiros que competem na ordem da projeção e soma o partido
 * de cada um em `composicao_vagas.por_partido` (`:7286-7312`). Aqui a conta é
 * refeita sobre o que o payload publica:
 *
 *   1. `top_candidatos` **na ordem do array** — o prefixo é a ordem da projeção
 *      (invariante 1 de `EdgeUfRow.top_candidatos`). Não reordena por `pct`: o
 *      `pct` publicado é arredondado, e reordenar poderia desfazer um desempate
 *      que o produtor já fez.
 *   2. Sem as anuladas (`queCompetem`, ADR-0053). `sub_judice` compete.
 *   3. As `vagas_por_uf` primeiras. Partido ausente vira `"—"`, o mesmo
 *      marcador do produtor.
 *
 * ## 🔴 Falha fechada (RF-217)
 *
 * O total por partido derivado é conferido contra
 * `composicao_vagas.por_partido`. Se divergir — ou se a composição faltar fora
 * da fase pré, ou se a soma não fechar —, o resultado é `{ ok: false }` e o
 * hemiciclo não é desenhado. Duas fontes discordando sobre quem tem quantas
 * vagas, na mesma página, é pior que a ausência do desenho.
 *
 * ## "Decidida" = UF 100% apurada
 *
 * O campo é `EdgeUfRow.pct_apurado` (0–100, `lib/edge-config/types.ts`, gravado
 * por `api/model/project.py:7203` — média do apurado das zonas ponderada pelo
 * eleitorado TOTAL da UF). Limiar `>= 100`, estrito: o erro possível é só o
 * conservador (uma UF concluída que o ponto flutuante deixou em 99,999… segue
 * `projetada`). `chamada`/`bucket` NÃO servem: medem a margem do 1º sobre o
 * 2º, e no Senado a vaga é dos dois primeiros (spec 016, RF-104).
 *
 * ## Nenhum `81` nem `54` escrito à mão
 *
 * Total = cadeiras da foto (27, por invariante dela) + vagas em disputa
 * (`composicao_vagas.vagas_em_disputa`, ou `vagasPorUf × 27` da tabela
 * canônica). É 81 por construção, e a conferência recusa o payload que disser
 * outra coisa em `total_cadeiras`.
 *
 * ## Senador sem partido (`"S/Partido"`)
 *
 * A cadeira que continua com alguém hoje sem partido (Romário, RJ, desde
 * 09/09/2026) não é de partido nenhum — nem do antigo, nem de "Outros". Ela
 * entra como a linha {@link ROTULO_SEM_PARTIDO}, depois de todos os partidos
 * (não é bancada, não disputa lugar na ordem por tamanho), e a tela a pinta de
 * cinza cheio.
 */

import { cargoInfo } from "@/lib/config/cargos";
import { isPreEleicao } from "@/lib/config/fase";
import type { EdgePayload } from "@/lib/edge-config/types";
import {
  dataDaFoto,
  SEM_PARTIDO,
  UFS_DO_SENADO,
  type ValidacaoMandato2031,
} from "@/lib/senado/mandato-2031";
import { ordenarBancada } from "@/lib/utils/bancada";
import { queCompetem } from "@/lib/utils/destino-voto";

/** Estado de uma cadeira do Senado de 2027. Ordem = ordem dentro da cunha. */
export type EstadoCadeiraSenado = "continua_2031" | "decidida" | "projetada" | "aguardando";

export const ESTADOS_CADEIRA_SENADO: readonly EstadoCadeiraSenado[] = [
  "continua_2031",
  "decidida",
  "projetada",
  "aguardando",
] as const;

/**
 * UF com a apuração concluída. `EdgeUfRow.pct_apurado` vai de 0 a 100; o
 * limiar é o teto, estrito — ver o cabeçalho.
 */
export const PCT_UF_CONCLUIDA = 100;

/** Marcador de partido não resolvido — o mesmo `"—"` que o produtor grava. */
export const PARTIDO_DESCONHECIDO = "—";

/**
 * Chave da linha "sem partido". Tem hífen de propósito: {@link chavePartido}
 * só produz `[a-z0-9]`, então nenhuma sigla real colide com ela.
 */
export const CHAVE_SEM_PARTIDO = "sem-partido";

/** Como a linha "sem partido" aparece na legenda e na lista textual. */
export const ROTULO_SEM_PARTIDO = "Sem partido";

/** Uma cadeira, antes de ganhar posição no desenho. */
export interface CadeiraSenado {
  estado: EstadoCadeiraSenado;
  /** Sigla exibida. `null` em `aguardando` — não há partido a nomear. */
  sigla: string | null;
  /** Chave de agrupamento (ver {@link chavePartido}). `null` em `aguardando`. */
  chave: string | null;
}

/** Um partido no Senado de 2027 — uma linha da lista textual, uma cunha. */
export interface PartidoSenado2027 {
  chave: string;
  sigla: string;
  /** Total do partido: `continua + decidida + projetada`. */
  cadeiras: number;
  continua: number;
  decidida: number;
  projetada: number;
  /** `true` na linha dos senadores hoje sem partido ({@link CHAVE_SEM_PARTIDO}). */
  semPartido: boolean;
}

/**
 * A fase como ESTE bloco a trata. `"pre"` e não o literal do payload: o
 * literal de fase só vive nos quatro donos que o RF-153 permite (guarda em
 * `tests/unit/config/fase.test.ts`), e a leitura dele aqui passa por
 * `isPreEleicao` (`lib/config/fase.ts`).
 */
export type FaseSenado2027 = "pre" | "normal" | "sem_dados";

export interface Senado2027 {
  fase: FaseSenado2027;
  /** Cadeiras da casa: foto + vagas em disputa. 81. */
  total: number;
  vagasEmDisputa: number;
  /** Na ordem do desenho, esquerda → direita. `cadeiras.length === total`. */
  cadeiras: CadeiraSenado[];
  /** Partidos na ordem das cunhas (total desc → sigla asc); "sem partido" por último. */
  partidos: PartidoSenado2027[];
  /** Cadeiras por estado. Soma = `total`. */
  contagem: Record<EstadoCadeiraSenado, number>;
  /** Quantas das `continua_2031` são de senador hoje sem partido. */
  continuaSemPartido: number;
  /** DD/MM/AAAA da foto do Senado. */
  dataFoto: string;
}

export type MotivoRecusaSenado2027 =
  | "mandato_invalido"
  | "sem_composicao"
  | "divergencia_composicao"
  | "total_incoerente"
  | "vagas_excedentes";

export type ResultadoSenado2027 =
  | { ok: true; senado: Senado2027 }
  | { ok: false; motivo: MotivoRecusaSenado2027; detalhe: string };

/**
 * Chave de partido para casar a sigla do payload com a da foto: sem acento,
 * minúscula, só `[a-z0-9]` ("UNIÃO" ≡ "UNIAO" ≡ "União"). Diferente de
 * `normalizePartySlug`, NÃO colapsa sigla desconhecida em `outros` — dois
 * partidos fora da paleta continuam sendo dois. Sigla sem nenhum caractere
 * alfanumérico (o `"—"`) é a própria chave.
 */
export function chavePartido(sigla: string): string {
  const chave = sigla
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return chave.length > 0 ? chave : sigla.trim();
}

function recusa(motivo: MotivoRecusaSenado2027, detalhe: string): ResultadoSenado2027 {
  return { ok: false, motivo, detalhe };
}

interface VagaEmDisputa {
  estado: "decidida" | "projetada";
  sigla: string;
}

/** As vagas em disputa que o payload já atribui, UF a UF (passos 1–3 do cabeçalho). */
function vagasDerivadas(payload: EdgePayload, vagasPorUf: number): VagaEmDisputa[] {
  const vagas: VagaEmDisputa[] = [];
  for (const uf of payload.por_uf ?? []) {
    const estado = uf.pct_apurado >= PCT_UF_CONCLUIDA ? "decidida" : "projetada";
    for (const c of queCompetem(uf.top_candidatos ?? []).slice(0, vagasPorUf)) {
      vagas.push({ estado, sigla: c.partido ?? PARTIDO_DESCONHECIDO });
    }
  }
  return vagas;
}

/** Conta por chave de partido. */
function contarPorChave(siglas: Iterable<[string, number]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [sigla, n] of siglas) {
    const k = chavePartido(sigla);
    m.set(k, (m.get(k) ?? 0) + n);
  }
  return m;
}

function mapasIguais(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function descreverMapa(m: Map<string, number>): string {
  return [...m.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

/**
 * O Senado de 2027, ou a razão para não desenhá-lo.
 *
 * `payload === null` (a rota não recebeu dado) devolve 27 + 54 `aguardando`
 * com `fase: "sem_dados"` — a página hoje NÃO usa esse caso (design § D6), mas
 * a função o cobre para que a decisão de mostrá-lo ali seja uma linha.
 */
export function derivarSenado2027(
  payload: EdgePayload | null,
  mandato: ValidacaoMandato2031,
): ResultadoSenado2027 {
  if (!mandato.ok) {
    return recusa("mandato_invalido", mandato.erros.join("; "));
  }
  const foto = mandato.mandato;
  const continuas = foto.senadores.length;

  const vagasPorUfTabela = cargoInfo(5).vagasPorUf ?? 0;
  const pre = payload !== null && isPreEleicao(payload);
  const fase: FaseSenado2027 = payload === null ? "sem_dados" : pre ? "pre" : "normal";
  const composicao = payload?.composicao_vagas;

  const vagasPorUf = composicao?.vagas_por_uf ?? vagasPorUfTabela;
  const vagasEmDisputa = composicao?.vagas_em_disputa ?? vagasPorUf * UFS_DO_SENADO.length;

  if (
    vagasPorUf !== vagasPorUfTabela ||
    vagasEmDisputa !== vagasPorUfTabela * UFS_DO_SENADO.length
  ) {
    return recusa(
      "total_incoerente",
      `vagas por UF ${vagasPorUf} / em disputa ${vagasEmDisputa}; a tabela canônica diz ` +
        `${vagasPorUfTabela} × ${UFS_DO_SENADO.length}`,
    );
  }
  const total = continuas + vagasEmDisputa;
  if (composicao?.total_cadeiras !== undefined && composicao.total_cadeiras !== total) {
    return recusa(
      "total_incoerente",
      `payload diz ${composicao.total_cadeiras} cadeiras; foto (${continuas}) + em disputa ` +
        `(${vagasEmDisputa}) = ${total}`,
    );
  }

  // Fase pré e "sem dados": nenhuma vaga em disputa é atribuída. `por_uf` é
  // ignorado mesmo quando vem preenchido — top-2 de uma projeção zerada é a
  // ordem do desempate, não um resultado (spec 019, RF-161/162).
  let vagas: VagaEmDisputa[] = [];
  if (fase === "normal" && payload !== null) {
    if (!composicao) {
      return recusa("sem_composicao", "payload de Senador sem `composicao_vagas` fora da fase pré");
    }
    vagas = vagasDerivadas(payload, vagasPorUf);
    if (vagas.length > vagasEmDisputa) {
      return recusa("vagas_excedentes", `${vagas.length} vagas derivadas para ${vagasEmDisputa}`);
    }
    const derivado = contarPorChave(vagas.map((v) => [v.sigla, 1] as [string, number]));
    const publicado = contarPorChave(
      composicao.por_partido.map((p) => [p.partido, p.vagas] as [string, number]),
    );
    if (!mapasIguais(derivado, publicado) || vagas.length !== composicao.vagas_projetadas) {
      return recusa(
        "divergencia_composicao",
        `derivado [${descreverMapa(derivado)}] (Σ ${vagas.length}) ≠ composicao_vagas ` +
          `[${descreverMapa(publicado)}] (Σ ${composicao.vagas_projetadas})`,
      );
    }
  }

  // Partidos: soma das cadeiras que continuam com as da disputa.
  const porChave = new Map<string, PartidoSenado2027>();
  const linha = (sigla: string): PartidoSenado2027 => {
    const semPartido = sigla === SEM_PARTIDO;
    const chave = semPartido ? CHAVE_SEM_PARTIDO : chavePartido(sigla);
    let p = porChave.get(chave);
    if (!p) {
      p = {
        chave,
        sigla: semPartido ? ROTULO_SEM_PARTIDO : sigla,
        cadeiras: 0,
        continua: 0,
        decidida: 0,
        projetada: 0,
        semPartido,
      };
      porChave.set(chave, p);
    }
    return p;
  };
  // A sigla exibida é a do payload quando o partido disputa (a forma que a
  // barra das 54 também mostra); só a foto, quando ele só tem cadeira que
  // continua. Por isso a disputa entra primeiro.
  for (const v of vagas) {
    const p = linha(v.sigla);
    p[v.estado] += 1;
    p.cadeiras += 1;
  }
  for (const s of foto.senadores) {
    const p = linha(s.partido);
    p.continua += 1;
    p.cadeiras += 1;
  }
  const todas = [...porChave.values()];
  const partidos = [
    ...ordenarBancada(todas.filter((p) => !p.semPartido)),
    ...todas.filter((p) => p.semPartido),
  ];
  const continuaSemPartido = todas.filter((p) => p.semPartido).reduce((a, p) => a + p.continua, 0);

  const cadeiras: CadeiraSenado[] = [];
  for (const p of partidos) {
    for (const estado of ["continua_2031", "decidida", "projetada"] as const) {
      const n = estado === "continua_2031" ? p.continua : p[estado];
      for (let i = 0; i < n; i++) cadeiras.push({ estado, sigla: p.sigla, chave: p.chave });
    }
  }
  const aguardando = vagasEmDisputa - vagas.length;
  for (let i = 0; i < aguardando; i++) {
    cadeiras.push({ estado: "aguardando", sigla: null, chave: null });
  }

  if (cadeiras.length !== total) {
    return recusa("total_incoerente", `${cadeiras.length} cadeiras montadas para ${total}`);
  }

  const contagem: Record<EstadoCadeiraSenado, number> = {
    continua_2031: continuas,
    decidida: vagas.filter((v) => v.estado === "decidida").length,
    projetada: vagas.filter((v) => v.estado === "projetada").length,
    aguardando,
  };

  return {
    ok: true,
    senado: {
      fase,
      total,
      vagasEmDisputa,
      cadeiras,
      partidos,
      contagem,
      continuaSemPartido,
      dataFoto: dataDaFoto(foto),
    },
  };
}

/**
 * A linha da lista textual de um partido — o equivalente em texto da cunha
 * dele (constituição § 4, RF-218). Ex.: "PL 14 — 9 até 2031 + 5 em 2026
 * (projeção)".
 *
 * 🔴 Nunca "eleito": a cadeira que continua é "até 2031"; a da UF concluída é
 * "em 2026 (apuração concluída no estado)" — a base sempre dita (ADR-0055,
 * constituição § 1).
 */
export function textoDoPartido(p: PartidoSenado2027): string {
  const partes: string[] = [];
  if (p.continua > 0) partes.push(`${p.continua} até 2031`);
  if (p.decidida > 0) partes.push(`${p.decidida} em 2026 (apuração concluída no estado)`);
  if (p.projetada > 0) partes.push(`${p.projetada} em 2026 (projeção)`);
  return `${p.sigla} ${p.cadeiras} — ${partes.join(" + ")}`;
}
