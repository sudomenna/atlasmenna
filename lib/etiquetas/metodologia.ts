/**
 * lib/etiquetas/metodologia.ts — o que a página `/sobre-as-etiquetas` lista
 * (spec 025, RF-252; constituição 1.6 § 8): as classificações PUBLICADAS, com
 * fonte, data e origem, lidas dos arquivos que a tela usa (Blob ou cópia do
 * build — `lerEtiquetas`). Função pura.
 *
 * "Publicada" = presente no arquivo lido, o que já quer dizer revisada pelo
 * dono (linha com `revisado ≠ sim` nem entra no arquivo, RF-223). Categoria sem
 * critério publicado fica FORA da lista (e a página diz quantas linhas
 * aguardam o critério): a frase "nenhuma etiqueta desta categoria é exibida"
 * vale também aqui.
 */

import {
  type CategoriaId,
  categoriaExibivel,
  isCategoriaId,
  ORDEM_CATEGORIAS,
  rotuloDoValor,
} from "./catalogo";
import type { ArquivoNacional, ArquivoUf, Registros } from "./formato";

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
  origem: "individual" | "partido";
  fonte_url: string;
  fonte_descricao: string;
  data: string;
  revisado_em: string;
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
