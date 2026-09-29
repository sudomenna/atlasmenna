/**
 * components/atoms/data/EtiquetasLinha.tsx
 *
 * As etiquetas editoriais de UM candidato numa linha compacta (spec 024,
 * RF-236). Recebe a resolução inteira (`Etiquetas.resolver(...)`) e mostra:
 *
 *   - só as categorias pedidas (`categorias`; padrão = todas);
 *   - **na ordem do catálogo**, sempre — nunca na ordem em que chegaram;
 *   - só as classificadas com rótulo; o resto some sem deixar buraco;
 *   - nada (`null`) quando não sobra nenhuma.
 *
 * `<span>` inline de ponta a ponta: mora dentro do `<span>` do nome no
 * cartão (e dentro de `<a>` no /senador). Não reordena candidatos, não lê
 * nada de fora — é apresentação pura (RF-238).
 */

import { type CategoriaId, ORDEM_CATEGORIAS } from "@/lib/etiquetas/catalogo";
import type { EtiquetaResolvida, Resolucao } from "@/lib/etiquetas/resolver";

import { EtiquetaEditorial } from "./EtiquetaEditorial";
import styles from "./EtiquetaEditorial.module.css";

export interface EtiquetasLinhaProps {
  resolucoes: Partial<Record<CategoriaId, Resolucao>> | null | undefined;
  categorias?: readonly CategoriaId[];
}

export function EtiquetasLinha({ resolucoes, categorias }: EtiquetasLinhaProps) {
  if (!resolucoes) return null;
  const pedidas = new Set<CategoriaId>(categorias ?? ORDEM_CATEGORIAS);
  const visiveis: EtiquetaResolvida[] = [];
  for (const cat of ORDEM_CATEGORIAS) {
    if (!pedidas.has(cat)) continue;
    const r = resolucoes[cat];
    if (r?.estado === "classificado" && r.etiqueta.rotulo !== null) visiveis.push(r.etiqueta);
  }
  if (visiveis.length === 0) return null;
  return (
    <span
      className={styles.linha}
      // Sem a chave em produção (nem como `undefined`: o payload RSC a escreve
      // como `"data-testid":"$undefined"` em cada cartão).
      {...(process.env.NODE_ENV === "production" ? {} : { "data-testid": "etiquetas-linha" })}
    >
      {visiveis.map((e) => (
        <EtiquetaEditorial key={e.categoria} categoria={e.categoria} valor={e.valor} />
      ))}
    </span>
  );
}
