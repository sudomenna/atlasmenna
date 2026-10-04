/**
 * lib/utils/senado-nomes-das-vagas.ts — spec 016, RF-301 (decisão do dono,
 * 04/10/2026: "o usuário poder enxergar todos os senadores eleitos").
 *
 * QUEM ocupa as vagas de cada partido em "As 54 vagas em disputa" (capa
 * `/senador`), nas duas bases da chave "Parcial / Projeção". Até esta data a
 * seção só contava vagas por partido; os 54 nomes existiam espalhados nos 27
 * cartões "Estado a estado".
 *
 * Função pura, sem I/O e sem relógio (constituição § 6): mesmo payload ⇒
 * mesma saída. **Nenhuma leitura nova** — tudo sai do payload que a capa já
 * lê, pelas MESMAS derivações que já desenham a contagem:
 *
 * | base | quem ocupa | de onde vem o nome |
 * |---|---|---|
 * | Projeção | `vagasDerivadas` (`senado-2027.ts`), conferida contra `composicao_vagas` | a própria vaga (`top_candidatos[].nome` da UF) |
 * | Parcial | `vagasNaParcial` (`senado-parcial.ts`) — a fonte de `composicaoNaParcial` | `por_uf[uf].top_candidatos`, casado pelo `id` |
 *
 * ## 🔴 Falha fechada na Projeção (o mesmo princípio do RF-217)
 *
 * A contagem por partido que a tela mostra na Projeção é a PUBLICADA
 * (`composicao_vagas.por_partido`); os nomes são DERIVADOS de `top_candidatos`.
 * Se as duas contas discordarem — partido a partido, por {@link chavePartido},
 * ou no total —, nenhum nome é devolvido (`null`) e a seção fica como era: só
 * a contagem. "PL 9" com oito nomes embaixo seria duas fontes discordando na
 * mesma linha. O caso real é o payload sem `partido` em `top_candidatos`
 * (`tests/fixtures/edge-config/sen-current.json`): toda vaga derivada cai em
 * `"—"` e nada fecha.
 *
 * Na Parcial não há o que conferir: contagem e nomes saem da mesma lista
 * (`vagasNaParcial`).
 *
 * ## Ordem: sigla da UF, e depois a ordem da vaga
 *
 * Dentro de cada partido, os nomes vêm **por sigla de UF** (code units, sem
 * locale — § 6); duas vagas da mesma UF no mesmo partido ficam na ordem da
 * vaga (a da base: projeção ou apurado). É a ordem geográfica, fixa, e não
 * uma escolha por nome nem por partido (constituição § 2).
 *
 * ## Nunca nome nem zero fabricado
 *
 * UF `aguardando` na Parcial (sem apurado, sem `pct_atual`, ou com anulada que
 * não deixa provar o 2º lugar — `vagasDaUfNaParcial`) **não vira nome**: ela
 * vai para {@link NomesDasVagas.ufsAguardando}, a linha "aguardando apuração".
 * Se a soma das vagas sem dono por UF não bater com o total "aguardando" que a
 * tela imprime, a lista de UFs é `null` e a linha fica só com o número.
 */

import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { chavePartido, vagasDerivadas } from "@/lib/utils/senado-2027";
import { vagasNaParcial } from "@/lib/utils/senado-parcial";

/**
 * Ressalva de UMA linha de nome — o selo da base vale para a lista inteira e é
 * escrito uma vez; aqui só o que foge dele.
 *
 * - `"concluida"` — UF com 100% apurado (`PCT_UF_CONCLUIDA`): a vaga é a
 *   mesma nas duas bases ("decidida", `senado-2027.ts`). Não é "eleito": o
 *   resultado oficial é do TSE (constituição § 1).
 * - `"sem_apuracao"` — só na Projeção: UF sem voto apurado. O cartão da UF não
 *   põe selo de vaga nesse caso (`pct_apurado > 0`); a linha diz por quê.
 */
export type RessalvaDaVaga = "concluida" | "sem_apuracao";

/** Um nome numa vaga, pronto para a tela. */
export interface NomeDaVaga {
  uf: string;
  /** Como o cartão da UF mostra (ver {@link nomeComoNoCartao}). */
  nome: string;
  ressalva?: RessalvaDaVaga;
}

export interface NomesDasVagas {
  /** Por {@link chavePartido}; cada lista já na ordem de UF. */
  porPartido: ReadonlyMap<string, readonly NomeDaVaga[]>;
  /**
   * UFs com vaga ainda sem dono, por sigla. `null` quando a soma das vagas sem
   * dono não fecha com o "aguardando apuração" que a tela imprime.
   */
  ufsAguardando: readonly string[] | null;
}

/**
 * O nome de uma candidatura exatamente como o `<GovernorCard>` o escreve
 * (`components/blocks/GovernorCard.tsx`, função `linha`): `nomeExibicao` sobre
 * o nome de urna, e `Cand <id>` quando o payload não traz nome (pré-018). A
 * regra está repetida aqui, e não importada, porque o cartão não a exporta; o
 * teste `senador.test.tsx` (RF-301) confere que os dois escrevem igual.
 */
export function nomeComoNoCartao(c: {
  id: number;
  nome?: string | null;
  sqcand?: string | null;
}): string {
  return c.nome ? nomeExibicao(c.nome, c.sqcand) : `Cand ${c.id}`;
}

interface Linha extends NomeDaVaga {
  chave: string;
}

/** Ordem por sigla de UF, em code units; `sort` é estável ⇒ a ordem da vaga fica. */
function porUf(a: Linha, b: Linha): number {
  return a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0;
}

function agrupar(linhas: Linha[], vagasPorUf: number, aguardandoNaTela: number): NomesDasVagas {
  const ordenadas = [...linhas].sort(porUf);
  const porPartido = new Map<string, NomeDaVaga[]>();
  const atribuidasPorUf = new Map<string, number>();
  for (const { chave, ...nome } of ordenadas) {
    const lista = porPartido.get(chave);
    if (lista) lista.push(nome);
    else porPartido.set(chave, [nome]);
    atribuidasPorUf.set(nome.uf, (atribuidasPorUf.get(nome.uf) ?? 0) + 1);
  }

  // As UFs da linha "aguardando": as que têm menos donos que vagas. A soma das
  // vagas sem dono tem de ser o número que a tela imprime; se não for (vaga
  // fora das 27, UF repetida, `vagas_em_disputa` incoerente), a lista não sai.
  const ufs: string[] = [];
  let semDono = 0;
  let coerente = true;
  for (const uf of UFS_DO_SENADO) {
    const faltam = vagasPorUf - (atribuidasPorUf.get(uf) ?? 0);
    if (faltam < 0) coerente = false;
    if (faltam > 0) {
      ufs.push(uf);
      semDono += faltam;
    }
  }
  const foraDas27 = [...atribuidasPorUf.keys()].some((uf) => !UFS_DO_SENADO.includes(uf));
  const ufsAguardando = coerente && !foraDas27 && semDono === aguardandoNaTela ? ufs : null;

  return { porPartido, ufsAguardando };
}

function contarPorChave(pares: Iterable<[string, number]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [sigla, n] of pares) {
    const k = chavePartido(sigla);
    m.set(k, (m.get(k) ?? 0) + n);
  }
  return m;
}

function mesmasContagens(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Os nomes na **Projeção**, ou `null` quando a derivação não fecha com
 * `composicao_vagas` (ver o cabeçalho) ou o payload não tem composição.
 */
export function nomesNaProjecao(payload: EdgePayload, vagasPorUf: number): NomesDasVagas | null {
  const composicao = payload.composicao_vagas;
  if (!composicao) return null;

  const vagas = vagasDerivadas(payload, vagasPorUf);
  const derivado = contarPorChave(vagas.map((v) => [v.sigla, 1] as [string, number]));
  const publicado = contarPorChave(
    composicao.por_partido.map((p) => [p.partido, p.vagas] as [string, number]),
  );
  if (vagas.length !== composicao.vagas_projetadas || !mesmasContagens(derivado, publicado)) {
    return null;
  }

  // `pct_apurado` da UF — a primeira linha de cada sigla, como em toda leitura
  // de `por_uf` que precisa de uma só.
  const apuradoDaUf = new Map<string, number>();
  for (const row of payload.por_uf ?? []) {
    if (!apuradoDaUf.has(row.sigla)) apuradoDaUf.set(row.sigla, row.pct_apurado);
  }

  const linhas: Linha[] = vagas.map((v) => {
    const ressalva: RessalvaDaVaga | undefined =
      v.estado === "decidida"
        ? "concluida"
        : !((apuradoDaUf.get(v.uf) ?? 0) > 0)
          ? "sem_apuracao"
          : undefined;
    return {
      chave: chavePartido(v.sigla),
      uf: v.uf,
      nome: nomeComoNoCartao(v),
      ...(ressalva ? { ressalva } : {}),
    };
  });

  const emDisputa = composicao.vagas_em_disputa ?? vagasPorUf * UFS_DO_SENADO.length;
  return agrupar(linhas, vagasPorUf, Math.max(0, emDisputa - composicao.vagas_projetadas));
}

/**
 * Os nomes na **Parcial** — "se a apuração parasse agora". Mesma lista que
 * `composicaoNaParcial` conta; o nome vem pelo `id` em `top_candidatos` da UF.
 */
export function nomesNaParcial(
  porUfRows: readonly EdgeUfRow[],
  vagasPorUf: number,
  vagasEmDisputa: number,
): NomesDasVagas {
  const vagas = vagasNaParcial(porUfRows, vagasPorUf);
  // Primeira ocorrência de cada sigla — a mesma que `vagasNaParcial` leu.
  const linhaDaUf = new Map<string, EdgeUfRow>();
  for (const row of porUfRows) if (!linhaDaUf.has(row.sigla)) linhaDaUf.set(row.sigla, row);

  const linhas: Linha[] = vagas.map((v) => {
    const c = linhaDaUf.get(v.uf)?.top_candidatos?.find((t) => t.id === v.id);
    return {
      chave: chavePartido(v.sigla),
      uf: v.uf,
      nome: nomeComoNoCartao(c ?? { id: v.id }),
      ...(v.estado === "decidida" ? { ressalva: "concluida" as const } : {}),
    };
  });

  return agrupar(linhas, vagasPorUf, Math.max(0, vagasEmDisputa - vagas.length));
}

/**
 * Os nomes de UMA linha de partido — só quando são exatamente tantos quantos
 * a linha conta. Qualquer diferença (duas grafias da mesma sigla na lista,
 * por exemplo) ⇒ `null`, e a linha fica só com o número.
 */
export function nomesDoPartido(
  nomes: NomesDasVagas | null,
  partido: string,
  vagas: number,
): readonly NomeDaVaga[] | null {
  const lista = nomes?.porPartido.get(chavePartido(partido));
  return lista && lista.length === vagas ? lista : null;
}
