// @vitest-environment happy-dom
/**
 * tests/unit/pages/uf-governador-foto.test.tsx
 *
 * **A foto nas 54 páginas de estado** — o pedaço do pedido de 14/09 que chegou
 * quebrado: `/uf/SP/governador` mostrava "FH", "T", "VM" em vez dos rostos de
 * Fernando Haddad, Tarcísio e Vivian Mendes.
 *
 * ## A causa, e por que ela é sutil
 *
 * O bloco NACIONAL de Governador não carrega `sqcand`, e isso está **certo por
 * contrato** (RF-145): em cargo 3 aquele array é a união de 27 corridas sob o
 * mesmo espaço de `id`, e um `sqcand` ali endereçaria a foto de alguém de outra
 * UF. `synthesizeGovUfFromFixture` montava a lista do estado FILTRANDO esse
 * bloco — e herdava a ausência junto.
 *
 * O dado sempre existiu no lugar certo: `por_uf[].top_candidatos[]` traz `id`,
 * `pct`, `nome`, `partido` **e `sqcand`**, resolvido pelo par `(uf, numero)`, e
 * portanto sabendo de que estado é.
 *
 * ## 🔴 Por que este arquivo não afirma "o avatar renderizou"
 *
 * Porque era exatamente isso que passava enquanto o defeito existia: sem
 * `sqcand`, o `<CandidateAvatar>` cai nas INICIAIS — que são um avatar, com a
 * mesma caixa e o mesmo `data-testid` de caixa. Um teste de presença passa com
 * "FH" na tela.
 *
 * Então cada asserção aqui mede uma das três coisas que as iniciais NÃO têm:
 *   1. existe `<img>` (`candidate-avatar-photo`), não a caixa de fallback;
 *   2. o `src` carrega o `sqcand` EXATO de `top_candidatos` — se ele fosse
 *      inventado ou herdado de outro candidato, o conjunto não bateria;
 *   3. o caminho é `/candidatos/foto/SP/`, **nunca** `/BR/` — o default do
 *      painel é `"BR"`, e sob ele todas as fotos de governador dão 404
 *      (verificado contra o store real em 14/09: SP → 200, BR → 404).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgePayload } from "@/lib/edge-config/types";

const BLOB_BASE = "https://teste123.public.blob.vercel-storage.com";

// `sq_candidato` reais de 2026 (cargo 3, SP), conferidos contra a tabela
// `candidatos`. Reais de propósito: são os mesmos que o `curl` provou
// responderem 200 sob `SP` e 404 sob `BR`.
const SQ_HADDAD = "250002549705";
const SQ_TARCISIO = "250002541303";
const SQ_VIVIAN = "250002544912";

/**
 * Nacional de governador no formato REAL: a união das corridas, **sem
 * `sqcand`** (RF-145), e com a identidade de cada UF só em `top_candidatos`.
 *
 * `comSqcand: false` derruba o `sqcand` das linhas da UF para exercitar o
 * degrade — é o par negativo, não um segundo caminho feliz.
 *
 * `idColidido` reproduz o cenário que o RF-145 descreve: o MESMO `id` valendo
 * pessoas diferentes em estados diferentes, de modo que o bloco nacional guarde
 * um nome e a linha da UF, outro. É a única forma de provar de QUAL das duas
 * fontes a identidade saiu — com as duas concordando, os dois caminhos passam.
 */
function nacionalGov(opts: { comSqcand?: boolean; idColidido?: boolean } = {}): EdgePayload {
  const { comSqcand = true, idColidido = false } = opts;
  const pessoas = [
    { id: 26000, nome: "FERNANDO HADDAD", partido: "PT", pct: 31.2, sqcand: SQ_HADDAD },
    { id: 26001, nome: "TARCÍSIO", partido: "REPUBLICANOS", pct: 29, sqcand: SQ_TARCISIO },
    { id: 26002, nome: "VIVIAN MENDES", partido: "UP", pct: 26.4, sqcand: SQ_VIVIAN },
  ];

  return {
    ts: "2026-10-04T20:00:00-03:00",
    cargo: 3,
    turno: 1,
    pct_apurado_total: 42,
    national: {
      candidatos: [
        // 🔴 Um candidato de OUTRA UF no mesmo array, e sem `sqcand`: é a forma
        // real do bloco nacional de cargo 3, e é o que torna o teste honesto —
        // a síntese tem de recortar a corrida de SP e não pode buscar
        // identidade aqui.
        { id: 1000, nome: "TIÃO BOCALOM", partido: "PSDB", rank: 1, pct: 29.7 },
        ...pessoas.map((p, i) => ({
          id: p.id,
          // Sob `idColidido`, o nacional guarda para ESTE `id` o nome de quem
          // usa o mesmo número noutro estado.
          nome: idColidido ? `HOMÔNIMO DE OUTRA UF ${i}` : p.nome,
          partido: idColidido ? "XXX" : p.partido,
          rank: i + 1,
        })),
      ].map((c) => ({
        id: c.id,
        nome: c.nome,
        partido: c.partido,
        cor: `var(--color-cand-${c.rank})`,
        rank: c.rank,
        votos_atuais: 2_000_000,
        votos_projetados: 5_000_000,
        pct_atual: 30,
        pct_projetado: 30,
        pct_projetado_lower: 28,
        pct_projetado_upper: 32,
        p_vitoria: 0.5,
        p_passa_2t: 0.5,
        p_fecha_1t: 0,
      })),
      participacao: null,
      candidato_a_id: 26000,
      candidato_b_id: 26001,
      needle_position: 0.1,
      needle_band: "lean_a",
      p_segundo_turno_overall: 0.5,
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 42,
        lider: 26000,
        margem_pp: 2.2,
        bucket: "lean_a",
        top_candidatos: pessoas.map((p) => ({
          id: p.id,
          pct: p.pct,
          nome: p.nome,
          partido: p.partido,
          ...(comSqcand ? { sqcand: p.sqcand } : {}),
        })),
      },
    ],
  } as unknown as EdgePayload;
}

let nacionalAtual: EdgePayload | null = nacionalGov();

// A simulação é o caminho que o dono estava olhando (`FIXTURE_VARIANT=sim`) e o
// único em que a síntese roda. Mockada, nunca modificada.
vi.mock("@/lib/dev/simulacao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/dev/simulacao")>();
  return {
    ...real,
    simulacaoLigada: () => true,
    simulacaoNacional: () => nacionalAtual,
    simulacaoMunicipiosUf: () => null,
    resultadoEleitoral: async (daSimulacao: () => unknown) => daSimulacao(),
  };
});

// Sem leitura remota: é o `null` do reader que leva a página para a síntese.
vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: vi.fn(async () => null),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  readDeputadoProjection: vi.fn(async () => null),
}));

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/blob/uf-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob/uf-detail")>()),
  readUfDetail: async () => ({ status: "unavailable", reason: "not_configured", url: null }),
}));

import UFGovernadorPage from "@/app/(gov)/uf/[sigla]/governador/page";

beforeEach(() => {
  process.env.BLOB_PUBLIC_BASE_URL = BLOB_BASE;
  nacionalAtual = nacionalGov();
});

async function renderSP(): Promise<Document> {
  const node = await UFGovernadorPage({ params: Promise.resolve({ sigla: "sp" }) });
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

const fotos = (doc: Document) => [
  ...doc.querySelectorAll('[data-testid="candidate-avatar-photo"]'),
];

describe("/uf/[sigla]/governador — o rosto, e não as iniciais", () => {
  it("🔴 as três linhas têm FOTO, não a caixa de iniciais", async () => {
    const doc = await renderSP();

    expect(
      doc.querySelectorAll('[data-testid="candidate-result-row"]').length,
      "as três candidaturas de SP precisam estar na tela",
    ).toBe(3);
    // Com o defeito, este número era 0 e o de `candidate-avatar-fallback` era 3.
    expect(fotos(doc).length, "sem isto a tela mostra FH / T / VM").toBe(3);
    expect(
      doc.querySelectorAll('[data-testid="candidate-avatar-fallback"]').length,
      "e nenhuma linha pode cair nas iniciais",
    ).toBe(0);
  });

  it("🔴 o `sqcand` vem de `top_candidatos` — não é inventado nem herdado", async () => {
    const doc = await renderSP();

    // Conjuntos, não posições: casar por índice testaria a ordenação da
    // fixture, que não é o que esta asserção afirma.
    const obtidos = new Set(
      fotos(doc).map((f) => (f.getAttribute("src") ?? "").replace(/^.*\/(\d+)\.jpg$/, "$1")),
    );
    expect(obtidos).toEqual(new Set([SQ_HADDAD, SQ_TARCISIO, SQ_VIVIAN]));
  });

  it("🔴 a foto sai sob a sigla do ESTADO, nunca sob `BR`", async () => {
    const doc = await renderSP();

    for (const f of fotos(doc)) {
      const src = f.getAttribute("src") ?? "";
      expect(src).toContain("/candidatos/foto/SP/");
      // Medido contra o store real em 14/09: sob `BR` cada uma destas responde
      // 404, e o leitor veria uma imagem quebrada. O default do painel é "BR",
      // então só a rota passando `ufDaFoto={sigla}` impede isso.
      expect(src, "o default `BR` do painel daria 404 em toda foto de governador").not.toContain(
        "/foto/BR/",
      );
    }
    expect(fotos(doc)[0]?.getAttribute("src")).toBe(
      `${BLOB_BASE}/candidatos/foto/SP/${SQ_HADDAD}.jpg`,
    );
  });

  it("(par) sem `sqcand` na linha da UF, cai nas iniciais — nada é inventado", async () => {
    // O par negativo. Sem ele, uma implementação que fabricasse um `sqcand` a
    // partir do `id` passaria em tudo acima — e poria o rosto de outra pessoa
    // na tela, que é o dano que o RF-145 existe para impedir.
    nacionalAtual = nacionalGov({ comSqcand: false });
    const doc = await renderSP();

    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]').length).toBe(3);
    expect(fotos(doc).length, "sem `sqcand` não pode nascer URL de foto").toBe(0);
    expect(
      doc.querySelectorAll('[data-testid="candidate-avatar-fallback"]').length,
      "as iniciais ocupam a MESMA caixa — a linha não muda de tamanho",
    ).toBe(3);
  });

  it("🔴 candidato de outra UF não entra na corrida do estado (RF-145)", async () => {
    // O nacional carrega TIÃO BOCALOM (id 1000, candidato do Acre). Ele não é
    // de SP e não pode aparecer aqui — nem o nome, nem o rosto.
    const doc = await renderSP();
    const texto = doc.querySelector("main")?.textContent ?? "";

    // "HADDAD", e não "FERNANDO HADDAD": `SQ_HADDAD` é o `sq_candidato` REAL, e
    // desde 14/09 ele tem decisão editorial em `NOMES_EDITORIAIS` (o nome de
    // urna cortava na coluna de 132px). O que esta asserção afirma continua
    // sendo a PROCEDÊNCIA — a linha de SP está na tela, a do Acre não.
    expect(texto).toContain("HADDAD");
    expect(texto, "candidato de outra UF não entra na corrida de SP").not.toContain("TIÃO BOCALOM");
  });

  it("🔴 com os dois lados DISCORDANDO, quem vence é a linha da UF", async () => {
    // Sem este caso, uma implementação que lesse nome e partido do bloco
    // nacional passa em tudo — porque na fixture real as duas fontes
    // concordam. Elas concordarem é sorte do dado, não garantia do código.
    //
    // O que está em jogo não é cosmético: a foto sai de `top_candidatos` e o
    // nome sairia do nacional, então um `id` compartilhado entre dois estados
    // poria o ROSTO de uma pessoa ao lado do NOME de outra.
    nacionalAtual = nacionalGov({ idColidido: true });
    const doc = await renderSP();
    const texto = doc.querySelector("main")?.textContent ?? "";

    // Ver a nota do caso anterior: o nome de exibição de `SQ_HADDAD` é
    // "HADDAD" desde a decisão editorial de 14/09. A asserção segue sendo sobre
    // de ONDE o nome veio, não sobre qual é.
    expect(texto, "o nome tem de vir da mesma linha de onde veio a foto").toContain("HADDAD");
    expect(texto, "o nome do bloco nacional não pode vazar para a tela").not.toContain("HOMÔNIMO");

    // E a foto continua sendo a do candidato de SP.
    expect(fotos(doc)[0]?.getAttribute("src")).toContain(SQ_HADDAD);
  });

  it("🔴 `destino` também é SÓ da linha da UF: ausente ali não herda o do bloco nacional [mutação: `daUf?.destino ?? c.destino`]", async () => {
    // Desde 2026-09-27 as listas não emitem `"valido"` — ausente na linha da
    // UF é "compete". O bloco nacional de cargo 3 é a união de 27 corridas:
    // o `destino` que ele guardar para este `id` é de OUTRA candidatura.
    nacionalAtual = nacionalGov({ idColidido: true });
    for (const c of nacionalAtual.national.candidatos) {
      if (c.id === 26000) c.destino = "anulado";
    }
    const doc = await renderSP();
    const texto = doc.querySelector("main")?.textContent ?? "";
    expect(texto).toContain("HADDAD");
    expect(texto, "etiqueta herdada do bloco nacional").not.toContain("Anulado");
  });
});
