/**
 * lib/etiquetas/metodologia.ts — o que a página `/sobre-as-etiquetas` lista
 * (spec 025, RF-252; constituição 1.6 § 8): as classificações PUBLICADAS, com
 * fonte, data e origem, lidas dos arquivos que a tela usa (Blob ou cópia do
 * build — `lerEtiquetas`). Função pura.
 *
 * "Publicada" = presente no arquivo lido, o que já quer dizer revisada pelo
 * dono (linha com `revisado ≠ sim` nem entra no arquivo, RF-223; derivado sem
 * o carimbo de aprovação do arquivo inteiro também não — RF-223 emendado em
 * 29/09). Categoria sem critério publicado fica FORA da lista (e a página diz
 * quantas linhas aguardam o critério): a frase "nenhuma etiqueta desta
 * categoria é exibida" vale também aqui.
 *
 * Três origens (constituição § 8): `individual` e `partido` saem das linhas
 * (`linhasPublicadas`); `derivado` sai da regra medida, candidatura a
 * candidatura, SÓ onde ela está em vigor — a precedência é a do resolvedor
 * (`linhasDerivadasPublicadas`): quem tem linha individual na categoria não
 * aparece aqui por ela. A página mostra as duas primeiras; a lista completa
 * (com as derivadas e a medida) é o CSV público `/sobre-as-etiquetas/classificacoes.csv`.
 */

import {
  type CategoriaId,
  categoriaExibivel,
  isCategoriaId,
  ORDEM_CATEGORIAS,
  rotuloDoValor,
} from "./catalogo";
import type {
  ArquivoNacional,
  ArquivoUf,
  InsumoDerivado,
  MedidaAlinhamento,
  Registros,
} from "./formato";
import {
  derivadosDaUf,
  indiceDeputadosDaUf,
  insumosMajoritario,
  insumosSenador2031,
} from "./montagem";
import { type InsumosResolucao, resolverCategoria } from "./resolver";

export type AlvoPublicado = "padrao" | "governador" | "senador" | "senado2031" | "deputado";

export interface LinhaPublicada {
  /** `partido:PT`, `federacao:PT/PC DO B/PV`, o `sqcand` ou `senado:COD`. */
  chave: string;
  alvo: AlvoPublicado;
  uf: string | null;
  partido: string | null;
  categoria: CategoriaId;
  turno: 1 | 2 | null;
  valor: string;
  rotulo: string;
  origem: "individual" | "partido" | "derivado";
  fonte_url: string;
  fonte_descricao: string;
  data: string;
  /** Data da revisão do dono — da linha, ou (derivado) da aprovação do arquivo inteiro. */
  revisado_em: string;
  /** Só derivado de alinhamento: a medida que produziu a classificação. */
  medida?: MedidaAlinhamento;
}

const ORDEM_ALVO: readonly AlvoPublicado[] = [
  "padrao",
  "governador",
  "senador",
  "senado2031",
  "deputado",
];

function dosRegistros(
  regs: Registros | undefined,
  base: Omit<LinhaPublicada, "categoria" | "turno" | "valor" | "rotulo" | keyof Registros[string]>,
): LinhaPublicada[] {
  const out: LinhaPublicada[] = [];
  if (!regs) return out;
  for (const [k, r] of Object.entries(regs)) {
    const [cat, t] = k.split(":");
    if (!cat || !isCategoriaId(cat)) continue;
    const rotulo = rotuloDoValor(cat, r.valor);
    if (rotulo === null) continue;
    out.push({
      ...base,
      categoria: cat,
      turno: t === "1" ? 1 : t === "2" ? 2 : null,
      valor: r.valor,
      rotulo,
      fonte_url: r.fonte_url,
      fonte_descricao: r.fonte_descricao,
      data: r.data,
      revisado_em: r.revisado_em,
    });
  }
  return out;
}

/**
 * Todas as linhas publicadas — padrões por partido/federação, linhas
 * individuais de Governador, Senador e dos 27 que seguem até 2031 e, com os
 * arquivos de UF, as exceções individuais de Deputado Federal. Ordem estável:
 * alvo, UF, chave, categoria (do catálogo), turno — nunca por valor.
 */
export function linhasPublicadas(
  nacional: ArquivoNacional,
  ufs: readonly ArquivoUf[] = [],
): LinhaPublicada[] {
  const linhas: LinhaPublicada[] = [];
  for (const [chave, regs] of Object.entries(nacional.padroes)) {
    linhas.push(
      ...dosRegistros(regs, { chave, alvo: "padrao", uf: null, partido: null, origem: "partido" }),
    );
  }
  for (const [sq, c] of Object.entries(nacional.candidatos)) {
    linhas.push(
      ...dosRegistros(c.x, {
        chave: sq,
        alvo: c.cargo === 3 ? "governador" : "senador",
        uf: c.uf,
        partido: c.partido,
        origem: "individual",
      }),
    );
  }
  for (const [cod, s] of Object.entries(nacional.senado2031.senadores)) {
    linhas.push(
      ...dosRegistros(s.x, {
        chave: `senado:${cod}`,
        alvo: "senado2031",
        uf: s.uf,
        partido: s.partido,
        origem: "individual",
      }),
    );
  }
  for (const u of ufs) {
    for (const [sq, regs] of Object.entries(u.excecoes)) {
      linhas.push(
        ...dosRegistros(regs, {
          chave: sq,
          alvo: "deputado",
          uf: u.uf,
          partido: null,
          origem: "individual",
        }),
      );
    }
  }
  return ordenarLinhas(linhas);
}

/** As categorias que têm regra derivada. */
const CATEGORIAS_DERIVADAS = ["trajetoria_cargo", "relacao_governo"] as const;

function ordenarLinhas(linhas: LinhaPublicada[]): LinhaPublicada[] {
  const cmp = (a: string | null, b: string | null) =>
    (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
  return linhas.sort(
    (a, b) =>
      ORDEM_ALVO.indexOf(a.alvo) - ORDEM_ALVO.indexOf(b.alvo) ||
      cmp(a.uf, b.uf) ||
      cmp(a.chave, b.chave) ||
      ORDEM_CATEGORIAS.indexOf(a.categoria) - ORDEM_CATEGORIAS.indexOf(b.categoria) ||
      (a.turno ?? 0) - (b.turno ?? 0),
  );
}

/**
 * As classificações por REGRA DERIVADA em vigor, uma por candidatura e
 * categoria — resolvidas pelo MESMO resolvedor da tela, então só entra quem a
 * regra de fato classifica (a linha individual, quando existe, vence e fica em
 * {@link linhasPublicadas}). Cada linha leva a fonte do arquivo derivado, a
 * data do dado, a data da aprovação do arquivo e, na relação com o governo,
 * os votos e a taxa. Ordem estável: alvo, UF, chave, categoria.
 */
export function linhasDerivadasPublicadas(
  nacional: ArquivoNacional,
  ufs: readonly ArquivoUf[] = [],
): LinhaPublicada[] {
  const linhas: LinhaPublicada[] = [];
  const emitir = (
    ins: InsumosResolucao,
    base: Pick<LinhaPublicada, "chave" | "alvo" | "uf" | "partido">,
    medida: MedidaAlinhamento | undefined,
  ) => {
    for (const cat of CATEGORIAS_DERIVADAS) {
      if (!ins.derivados?.[cat]) continue;
      const r = resolverCategoria(ins, cat, 1);
      if (r.estado !== "classificado" || r.etiqueta.origem !== "derivado") continue;
      const rotulo = r.etiqueta.rotulo;
      if (rotulo === null) continue;
      const insumo = r.etiqueta.chave_origem.replace(/^derivado:/, "") as InsumoDerivado;
      linhas.push({
        ...base,
        categoria: cat,
        turno: null,
        valor: r.etiqueta.valor,
        rotulo,
        origem: "derivado",
        fonte_url: r.etiqueta.fonte_url,
        fonte_descricao: r.etiqueta.fonte_descricao,
        data: r.etiqueta.data,
        revisado_em: nacional.derivados[insumo]?.revisado_em ?? "",
        ...(cat === "relacao_governo" && medida ? { medida } : {}),
      });
    }
  };
  for (const [sq, c] of Object.entries(nacional.candidatos)) {
    if (!c.d) continue;
    emitir(
      insumosMajoritario(nacional, sq, c),
      { chave: sq, alvo: c.cargo === 3 ? "governador" : "senador", uf: c.uf, partido: c.partido },
      c.m,
    );
  }
  for (const [cod, s] of Object.entries(nacional.senado2031.senadores)) {
    if (!s.d) continue;
    emitir(
      insumosSenador2031(nacional, cod, s),
      { chave: `senado:${cod}`, alvo: "senado2031", uf: s.uf, partido: s.partido },
      s.m,
    );
  }
  for (const u of ufs) {
    const comDerivado = derivadosDaUf(u);
    if (comDerivado.size === 0) continue;
    const indice = indiceDeputadosDaUf(u, nacional);
    for (const sq of comDerivado.keys()) {
      const ins = indice.get(sq);
      if (!ins) continue;
      emitir(ins, { chave: sq, alvo: "deputado", uf: u.uf, partido: ins.partido }, u.medidas?.[sq]);
    }
  }
  return ordenarLinhas(linhas);
}

// ---------------------------------------------------------------------------
// A lista pública em CSV (constituição § 8)
// ---------------------------------------------------------------------------

/** As colunas do CSV público, nesta ordem. */
export const COLUNAS_CSV_CLASSIFICACOES = [
  "chave",
  "alvo",
  "uf",
  "cargo",
  "sqcand",
  "nome_urna",
  "partido",
  "categoria",
  "valor",
  "rotulo",
  "turno",
  "origem",
  "fonte_url",
  "fonte_descricao",
  "data",
  "revisado_em",
  "votos_disputadas",
  "taxa_disputadas",
] as const;

const CARGO_DO_ALVO: Record<AlvoPublicado, string> = {
  padrao: "",
  governador: "3",
  senador: "5",
  deputado: "6",
  senado2031: "",
};

function campoCsv(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * O CSV público com TODAS as classificações no ar (individuais, padrões de
 * partido/federação e derivadas), uma por linha. `nomes`: `sqcand` ou
 * `senado:COD` → nome de urna (ou nome parlamentar), quando conhecido — sem
 * ele a coluna sai vazia, nunca inventada. Só dado público: nenhuma coluna de
 * nascimento, documento ou nome civil existe aqui.
 */
export function csvDasClassificacoes(
  linhas: readonly LinhaPublicada[],
  nomes: ReadonlyMap<string, string> = new Map(),
): string {
  const out = [COLUNAS_CSV_CLASSIFICACOES.join(",")];
  for (const l of linhas) {
    const ehCandidatura = l.alvo === "governador" || l.alvo === "senador" || l.alvo === "deputado";
    const registro: Record<(typeof COLUNAS_CSV_CLASSIFICACOES)[number], string> = {
      chave: l.chave,
      alvo: l.alvo,
      uf: l.uf ?? "",
      cargo: CARGO_DO_ALVO[l.alvo],
      sqcand: ehCandidatura ? l.chave : "",
      nome_urna: nomes.get(l.chave) ?? "",
      partido: l.partido ?? "",
      categoria: l.categoria,
      valor: l.valor,
      rotulo: l.rotulo,
      turno: l.turno === null ? "" : String(l.turno),
      origem: l.origem,
      fonte_url: l.fonte_url,
      fonte_descricao: l.fonte_descricao,
      data: l.data,
      revisado_em: l.revisado_em,
      votos_disputadas: l.medida ? String(l.medida.votos) : "",
      taxa_disputadas: l.medida ? String(l.medida.taxa) : "",
    };
    out.push(COLUNAS_CSV_CLASSIFICACOES.map((c) => campoCsv(registro[c])).join(","));
  }
  return `${out.join("\n")}\n`;
}

/** Separa o que vai à tela (critério publicado) do que aguarda critério. */
export function separarPorCriterio(linhas: readonly LinhaPublicada[]): {
  exibiveis: LinhaPublicada[];
  aguardandoCriterio: Partial<Record<CategoriaId, number>>;
} {
  const exibiveis: LinhaPublicada[] = [];
  const aguardandoCriterio: Partial<Record<CategoriaId, number>> = {};
  for (const l of linhas) {
    if (categoriaExibivel(l.categoria)) exibiveis.push(l);
    else aguardandoCriterio[l.categoria] = (aguardandoCriterio[l.categoria] ?? 0) + 1;
  }
  return { exibiveis, aguardandoCriterio };
}

/** Quantas classificações cada regra derivada produziu (Senado no nacional, Câmara nas UFs). */
export function contagemDerivada(
  nacional: ArquivoNacional,
  ufs: readonly ArquivoUf[] = [],
): {
  senado: Record<"relacao_governo" | "trajetoria_cargo", number>;
  camara: Record<"relacao_governo" | "trajetoria_cargo", number>;
} {
  const senado = { relacao_governo: 0, trajetoria_cargo: 0 };
  for (const c of Object.values(nacional.candidatos)) {
    if (c.d?.relacao_governo) senado.relacao_governo++;
    if (c.d?.trajetoria_cargo) senado.trajetoria_cargo++;
  }
  for (const s of Object.values(nacional.senado2031.senadores)) {
    if (s.d?.relacao_governo) senado.relacao_governo++;
  }
  const camara = { relacao_governo: 0, trajetoria_cargo: 0 };
  for (const u of ufs) {
    for (const l of Object.values(u.alinhamento)) camara.relacao_governo += l?.length ?? 0;
    for (const l of Object.values(u.trajetoria)) camara.trajetoria_cargo += l?.length ?? 0;
  }
  return { senado, camara };
}
