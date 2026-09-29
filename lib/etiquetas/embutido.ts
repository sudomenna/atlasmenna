/**
 * lib/etiquetas/embutido.ts
 *
 * A **cópia do build** das etiquetas (spec 024, RF-231) — os arquivos que
 * `pnpm etiquetas:compilar` grava em `lib/data/etiquetas/` e que viajam com o
 * deploy. É o piso: se o Blob falhar, é isto que a tela lê (constituição § 7).
 *
 * ## Import literal, nunca `fs` com caminho montado
 *
 * Um `readFile(\`…/${uf}.json\`)` faria o bundler traçar o diretório inteiro
 * para dentro de cada função — foi assim que `lib/dev/simulacao.ts` pôs
 * 22.572 arquivos no pacote e derrubou produção por 10 h (17/09). Aqui cada
 * UF é um `import()` com caminho **literal**: o bundler vê exatamente 27
 * arquivos, cada um vira um pedaço carregado só quando a UF é pedida.
 */

import nacionalJson from "@/lib/data/etiquetas/nacional.generated.json" with { type: "json" };

import type { SiglaUf } from "./formato";

export const NACIONAL_EMBUTIDO: unknown = nacionalJson;

type Carregador = () => Promise<{ default: unknown }>;

export const CARREGADORES_UF: Readonly<Record<SiglaUf, Carregador>> = {
  AC: () => import("@/lib/data/etiquetas/uf/AC.generated.json", { with: { type: "json" } }),
  AL: () => import("@/lib/data/etiquetas/uf/AL.generated.json", { with: { type: "json" } }),
  AM: () => import("@/lib/data/etiquetas/uf/AM.generated.json", { with: { type: "json" } }),
  AP: () => import("@/lib/data/etiquetas/uf/AP.generated.json", { with: { type: "json" } }),
  BA: () => import("@/lib/data/etiquetas/uf/BA.generated.json", { with: { type: "json" } }),
  CE: () => import("@/lib/data/etiquetas/uf/CE.generated.json", { with: { type: "json" } }),
  DF: () => import("@/lib/data/etiquetas/uf/DF.generated.json", { with: { type: "json" } }),
  ES: () => import("@/lib/data/etiquetas/uf/ES.generated.json", { with: { type: "json" } }),
  GO: () => import("@/lib/data/etiquetas/uf/GO.generated.json", { with: { type: "json" } }),
  MA: () => import("@/lib/data/etiquetas/uf/MA.generated.json", { with: { type: "json" } }),
  MG: () => import("@/lib/data/etiquetas/uf/MG.generated.json", { with: { type: "json" } }),
  MS: () => import("@/lib/data/etiquetas/uf/MS.generated.json", { with: { type: "json" } }),
  MT: () => import("@/lib/data/etiquetas/uf/MT.generated.json", { with: { type: "json" } }),
  PA: () => import("@/lib/data/etiquetas/uf/PA.generated.json", { with: { type: "json" } }),
  PB: () => import("@/lib/data/etiquetas/uf/PB.generated.json", { with: { type: "json" } }),
  PE: () => import("@/lib/data/etiquetas/uf/PE.generated.json", { with: { type: "json" } }),
  PI: () => import("@/lib/data/etiquetas/uf/PI.generated.json", { with: { type: "json" } }),
  PR: () => import("@/lib/data/etiquetas/uf/PR.generated.json", { with: { type: "json" } }),
  RJ: () => import("@/lib/data/etiquetas/uf/RJ.generated.json", { with: { type: "json" } }),
  RN: () => import("@/lib/data/etiquetas/uf/RN.generated.json", { with: { type: "json" } }),
  RO: () => import("@/lib/data/etiquetas/uf/RO.generated.json", { with: { type: "json" } }),
  RR: () => import("@/lib/data/etiquetas/uf/RR.generated.json", { with: { type: "json" } }),
  RS: () => import("@/lib/data/etiquetas/uf/RS.generated.json", { with: { type: "json" } }),
  SC: () => import("@/lib/data/etiquetas/uf/SC.generated.json", { with: { type: "json" } }),
  SE: () => import("@/lib/data/etiquetas/uf/SE.generated.json", { with: { type: "json" } }),
  SP: () => import("@/lib/data/etiquetas/uf/SP.generated.json", { with: { type: "json" } }),
  TO: () => import("@/lib/data/etiquetas/uf/TO.generated.json", { with: { type: "json" } }),
};
