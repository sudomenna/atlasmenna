/**
 * tests/unit/components/cor-nunca-do-payload.test.ts
 *
 * Nenhum componente pinta lendo `.cor` do payload.
 *
 * ## Por que uma varredura de FONTE, e não sete testes de render
 *
 * Em 2026-09-19 o dono viu CAIADO/PSD **laranja na lista e verde na legenda do
 * mapa**, na mesma tela. A causa: o produtor grava
 * `cor: "var(--color-cand-{rank})"` (`api/model/project.py`) — a paleta por
 * COLOCAÇÃO do ADR-0013 —, e **oito** componentes liam esse campo direto,
 * enquanto o mapa sempre resolveu pela sigla.
 *
 * O ADR-0024 aposentou a cor por rank em **2026-09-07**. O produtor nunca mudou,
 * e nesses doze dias ninguém percebeu, porque:
 *
 *   - `--color-cand-1` é vermelho e `--color-cand-2` é azul — **exatamente** o
 *     que PT e PL receberiam pela paleta de partido. A divergência só é visível
 *     do 3º colocado em diante.
 *   - dois dos oito consumidores já tinham comentário no próprio arquivo
 *     avisando do problema (`ProjectionThermometers` nomeava a violação do axe;
 *     `lib/edge-config/types.ts` escrevia o argumento inteiro) — e mesmo assim
 *     seguiam lendo.
 *
 * Testar render componente a componente não impede o **nono**. Esta varredura
 * impede: qualquer arquivo novo que leia `.cor` de um candidato cai aqui, ainda
 * que ninguém se lembre deste defeito.
 *
 * ## O que a regra proíbe
 *
 * Ler `.cor` de um objeto de candidato/líder vindo do payload dentro de
 * `components/`, `app/` ou `lib/`. O certo é `candidateColor` (preenchimento com extensão) ou
 * `candidateMarkerColor` (marcador sem extensão), de
 * `components/blocks/_candidateColor.ts`.
 *
 * ## O limite
 *
 * É análise de TEXTO, não de tipos: quem renomear a variável antes de ler
 * (`const x = c; x.cor`) passa. Não é a fronteira que importa — o defeito real
 * nunca foi disfarçado, foi copiado literalmente de arquivo em arquivo.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 🔴 `app/` entrou em 2026-09-19, e a razão importa.
//
// A 1ª versão varria SÓ `components/` — e passou verde enquanto DUAS páginas
// (`app/(pres)/uf/[sigla]/page.tsx` e `app/(gov)/uf/[sigla]/governador/page.tsx`)
// seguiam montando `candidateColor[c.id] = c.cor` para alimentar o coroplético
// municipal. Eram **12** consumidores, não os 10 que eu contei.
//
// Quem os achou não foi esta varredura: foi o `tsc`, quando o campo virou
// opcional no contrato. Uma varredura que escolhe onde olhar herda o ponto cego
// de quem a escreveu — e o ponto cego foi supor que "tela" mora em
// `components/`.
//
// 🔴 **`lib/` entrou em 2026-09-20, e a razão é a MESMA lição, de novo.**
//
// Com `app/` dentro, a varredura seguia verde enquanto
// `lib/utils/municipio-votos.ts:113` fazia `cor: c?.cor ?? "var(--color-cand-other)"`
// — copiando o campo banido para dentro de um utilitário que DOIS componentes
// consomem (`<MunicipioExplorer>` e o balão de `<ChoroplethMapUF>`). A cor
// entrava na tela por baixo da fronteira que a varredura vigiava: nenhum
// arquivo de `components/` lia `.cor`, e o valor chegava lá mesmo assim.
//
// Pior: quando alguém foi olhar, os dois consumidores já tinham migrado para a
// sigla por conta própria. O campo estava **morto e errado ao mesmo tempo** —
// a combinação que nada na tela denuncia, e que espera a próxima pessoa que
// resolva usá-lo.
//
// Duas ampliações, duas vezes o mesmo erro de origem: supor que "tela" mora em
// `components/`. `lib/` fica.
const RAIZES = [
  { dir: resolve(process.cwd(), "components"), rotulo: "components" },
  { dir: resolve(process.cwd(), "app"), rotulo: "app" },
  { dir: resolve(process.cwd(), "lib"), rotulo: "lib" },
] as const;

/**
 * Onde `.cor` é legítimo: o produtor da própria cor, e os pontos que a recebem
 * já resolvida por um caller que usou os helpers.
 */
const PERMITIDOS = new Set<string>([
  // Define os helpers; lê `.cor` de ninguém.
  "components/blocks/_candidateColor.ts",
  // `m.cor` aqui é a cor que o CALLER já resolveu (prop `municipios[]`), não um
  // campo de candidato do payload — ver a docstring de `ChoroplethMunicipio`.
  "components/atoms/maps/ChoroplethMapUF.tsx",
  // Painel privado (ADR-0077): `sr.cor` / `l.cor` é a cor do CARGO
  // (`var(--painel-cargo-N)`), resolvida pela página de servidor
  // (`corDoCargo`, `components/painel/Faixas.tsx`) e passada por prop. O
  // painel não desenha candidatura nenhuma e não lê payload — só o retrato
  // operacional da noite.
  "components/painel/GraficoPorMinuto.tsx",
]);

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      arquivosDe(caminho, acc);
    } else if ([".ts", ".tsx"].includes(extname(nome))) {
      acc.push(caminho);
    }
  }
  return acc;
}

/** `algo.cor` / `algo?.cor`, fora de comentário e de string. */
const LEITURA_DE_COR = /(?<![\w$])[\w$]+\s*\??\.\s*cor\b(?!\s*[:=][^=])/;

function linhasSuspeitas(fonte: string): Array<{ n: number; texto: string }> {
  const out: Array<{ n: number; texto: string }> = [];
  let emBloco = false;
  fonte.split("\n").forEach((linha, i) => {
    const t = linha.trim();
    if (emBloco) {
      if (t.includes("*/")) emBloco = false;
      return;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) emBloco = true;
      return;
    }
    // `{/*` abre comentário JSX — o `ResultPanel` tem um, e ele cita
    // `candidato.cor` justamente para PROIBIR a leitura.
    if (t.startsWith("{/*")) {
      if (!t.includes("*/")) emBloco = true;
      return;
    }
    if (t.startsWith("//") || t.startsWith("*")) return;
    if (LEITURA_DE_COR.test(linha)) out.push({ n: i + 1, texto: t });
  });
  return out;
}

describe("nenhum componente pinta com a `cor` do payload", () => {
  it("varre components/, app/ E lib/ — tela, e o que alimenta a tela", () => {
    const infratores: string[] = [];
    for (const { caminho, rel } of RAIZES.flatMap((r) =>
      arquivosDe(r.dir).map((caminho) => ({
        caminho,
        rel: `${r.rotulo}/${caminho.slice(r.dir.length + 1)}`,
      })),
    )) {
      if (PERMITIDOS.has(rel)) continue;
      for (const { n, texto } of linhasSuspeitas(readFileSync(caminho, "utf8"))) {
        infratores.push(`${rel}:${n} → ${texto}`);
      }
    }

    expect(
      infratores,
      infratores.length === 0
        ? ""
        : `Estes pontos leem \`.cor\` de um candidato — a paleta por COLOCAÇÃO ` +
            `que o ADR-0024 aposentou em 2026-09-07:\n\n${infratores.join("\n")}\n\n` +
            `Use, de components/blocks/_candidateColor.ts:\n` +
            `  • candidateColor(partido, rank)       — preenchimento COM extensão ` +
            `(barra, hexágono, polígono, <rect>)\n` +
            `  • candidateMarkerColor(partido, rank) — MARCADOR sem extensão ` +
            `(bolinha, quadradinho de legenda, ponto de 8×8)\n\n` +
            `Se a leitura for legítima (a cor já vem resolvida pelo caller, não do ` +
            `payload), acrescente o arquivo a PERMITIDOS **com o motivo escrito** — ` +
            `e não porque o teste ficou vermelho.`,
    ).toEqual([]);
  });

  it("a varredura acha o padrão quando ele existe — senão não prova nada", () => {
    // Sem este caso, um regex quebrado faria o teste acima passar sempre,
    // varrendo tudo e não encontrando nada. É a diferença entre "está limpo" e
    // "eu não estou olhando".
    expect(linhasSuspeitas("const cor = lider?.cor ?? fallback;")).toHaveLength(1);
    expect(linhasSuspeitas("style={{ background: c.cor }}")).toHaveLength(1);
    // E não confunde a ESCRITA de uma propriedade `cor:` com a leitura dela.
    expect(linhasSuspeitas("  cor: candidateColor(c.partido, rank),")).toHaveLength(0);
    // Nem acusa comentário.
    expect(linhasSuspeitas("// antes era c.cor, do payload")).toHaveLength(0);
  });
});
