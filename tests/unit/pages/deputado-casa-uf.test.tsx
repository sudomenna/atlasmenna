// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-casa-uf.test.tsx — spec 027 (RF-281, RF-283,
 * RF-284), frente U-a.
 *
 * O módulo comum `app/(dep)/_pagina-uf-deputado.tsx` renderizado para os TRÊS
 * cargos proporcionais — antes de existir rota estadual. As leituras entram
 * pelo adaptador `_dados-da-casa.ts`, mockado aqui: o que se mede é que o
 * TEXTO da página acompanha o cargo e a UF (nenhum "Deputado Federal" ou
 * "deste estado" sobrou no corpo) e que o cargo chega ao adaptador.
 *
 * O federal continua coberto, sem mock de adaptador, por
 * `tests/unit/pages/deputado-federal.test.tsx` — que passa pela casca de rota
 * de verdade.
 *
 * Mutações aplicadas à mão (29/09): `rotulo` fixo em "Deputado Federal" no
 * módulo derruba os casos de 7 e 8; o termo do território fixo em "estado"
 * derruba o do DF; `ufTemCasa` trocado por "as 27" derruba o 404 do 7 no DF.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  metadataDaPaginaUf,
  paramsEstaticosDaCasa,
  renderPaginaUfDeputado,
} from "@/app/(dep)/_pagina-uf-deputado";
import type { DeputadoUfDetail, DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import contratoNacional from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

const lerDadosDaCasaMock = vi.fn();
const lerCandidaturasAguardandoMock = vi.fn();

vi.mock("@/app/(dep)/_dados-da-casa", () => ({
  lerDadosDaCasa: (cargo: number, sigla: string) => lerDadosDaCasaMock(cargo, sigla),
  lerCandidaturasAguardando: (cargo: number, sigla: string) =>
    lerCandidaturasAguardandoMock(cargo, sigla),
  lerListaDaCasa: vi.fn(),
}));

const DESLIGADO = { ligada: false, pct_minimo: 25, origem: "ausente" } as const;

function nacional(): EdgePayloadDeputado {
  const n = structuredClone(contratoNacional) as unknown as EdgePayloadDeputado;
  // Uma linha para o DF, para o caso do distrital (resumo presente, detalhe 404).
  const ac = n.por_uf.find((u) => u.sigla === "AC");
  if (ac) n.por_uf.push({ ...structuredClone(ac), sigla: "DF", lugares_a_preencher: 24 });
  return n;
}

function detalheSp(): DeputadoUfDetailResult {
  const d = structuredClone(
    (contratoUf as unknown as Record<string, DeputadoUfDetail>).SP,
  ) as DeputadoUfDetail;
  return { status: "ok", detail: d, url: "https://blob.test/sp.json" };
}

const NAO_ACHADO: DeputadoUfDetailResult = {
  status: "unavailable",
  reason: "not_found",
  url: null,
};

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function render(cargo: 6 | 7 | 8, sigla: string): Promise<Document> {
  return parse(renderToStaticMarkup(await renderPaginaUfDeputado(cargo, sigla)));
}

function textoDe(doc: Document): string {
  return (doc.body.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  lerDadosDaCasaMock.mockReset();
  lerCandidaturasAguardandoMock.mockReset();
  lerCandidaturasAguardandoMock.mockResolvedValue(null);
});

describe("RF-281 — a página da casa acompanha o cargo", () => {
  it("cargo 7 em SP: título, casa, kickers e seletor do estadual — nada de federal", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: detalheSp(),
      interruptor: DESLIGADO,
    });
    const doc = await render(7, "sp");
    const t = textoDe(doc);

    // O adaptador recebeu o cargo e a sigla normalizada.
    expect(lerDadosDaCasaMock).toHaveBeenCalledWith(7, "SP");

    expect(doc.querySelector("h1")?.textContent).toBe("Deputado Estadual SP");
    // 2026-10-03 — bandeira da UF no `<h1>`, decorativa e sem `lazy` (acima
    // da dobra). O texto do título acima não mudou por causa dela.
    const bandeira = doc.querySelector("h1 img");
    expect(bandeira?.getAttribute("src")).toBe("/bandeiras/SP.webp");
    expect(bandeira?.getAttribute("alt")).toBe("");
    expect(bandeira?.hasAttribute("loading")).toBe(false);
    // RF-284 — o nome da casa na frase das vagas.
    expect(doc.querySelector("[data-testid='uf-vagas-label']")?.textContent).toContain(
      "em disputa na Assembleia Legislativa de São Paulo",
    );
    // Os kickers que diziam "Deputado Federal · SP".
    const kickers = [...doc.querySelectorAll("[data-testid='panel-kicker']")].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Deputado Estadual · SP");
    expect(kickers).toContain("Bancada do estado");
    // 🔴 Nenhum "Deputado Federal" no corpo da página do estadual — só no
    // seletor, que oferece o outro cargo pelo rótulo curto ("Federal").
    expect(t).not.toContain("Deputado Federal");
    expect(t).not.toContain("Câmara dos Deputados");

    // RF-283 — o seletor aponta a MESMA UF, com o estadual atual.
    const atual = doc.querySelector("[data-testid='seletor-deputado'] [aria-current='page']");
    expect(atual?.textContent).toBe("Estadual");
    expect(
      doc.querySelector("[data-testid='seletor-deputado'] [data-cargo='6']")?.getAttribute("href"),
    ).toBe("/uf/SP/deputado-federal");
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("dep");
  });

  it("cargo 8 no DF: Câmara Legislativa, 'do Distrito Federal', seletor Federal · Distrital", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: NAO_ACHADO,
      interruptor: DESLIGADO,
    });
    const doc = await render(8, "DF");

    expect(lerDadosDaCasaMock).toHaveBeenCalledWith(8, "DF");
    expect(doc.querySelector("h1")?.textContent).toBe("Deputado Distrital DF");
    expect(doc.querySelector("[data-testid='uf-vagas-label']")?.textContent).toContain(
      "24 cadeiras em disputa na Câmara Legislativa do Distrito Federal",
    );
    const kickers = [...doc.querySelectorAll("[data-testid='panel-kicker']")].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Bancada do Distrito Federal");
    expect(kickers).not.toContain("Bancada do estado");
    // O detalhe indisponível fala do território certo.
    expect(doc.querySelector("[data-testid='uf-detalhe-indisponivel']")?.textContent).toContain(
      "para o Distrito Federal",
    );
    expect(textoDe(doc)).not.toMatch(/est(e|ado) estado/);

    const seletor = doc.querySelector("[data-testid='seletor-deputado']");
    expect(seletor?.textContent).toBe("FederalDistrital");
    expect(seletor?.querySelector("[aria-current='page']")?.getAttribute("href")).toBe(
      "/uf/DF/deputado-distrital",
    );
  });

  it("aguardando dados (7 e 8): título, território e a grade pedida com o cargo certo", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: null,
      detalhe: NAO_ACHADO,
      interruptor: DESLIGADO,
    });

    const sp = await render(7, "SP");
    expect(sp.querySelector("h1")?.textContent).toBe("Deputado Estadual SP — Aguardando dados");
    expect(sp.querySelector("[data-testid='uf-dep-aguardando']")?.textContent).toContain(
      "A apuração deste estado",
    );
    expect(lerCandidaturasAguardandoMock).toHaveBeenCalledWith(7, "SP");
    // O seletor existe também sem dado — é navegação, não medição.
    expect(sp.querySelector("[data-testid='seletor-deputado']")).not.toBeNull();

    const df = await render(8, "DF");
    expect(df.querySelector("h1")?.textContent).toBe("Deputado Distrital DF — Aguardando dados");
    expect(df.querySelector("h1 img")?.getAttribute("src")).toBe("/bandeiras/DF.webp");
    expect(df.querySelector("[data-testid='uf-dep-aguardando']")?.textContent).toContain(
      "A apuração do Distrito Federal",
    );
    expect(lerCandidaturasAguardandoMock).toHaveBeenCalledWith(8, "DF");
  });

  it("federal no DF: o território é o Distrito Federal (a única mudança visível do federal)", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: NAO_ACHADO,
      interruptor: DESLIGADO,
    });
    const doc = await render(6, "DF");
    expect(doc.querySelector("h1")?.textContent).toBe("Deputado Federal DF");
    // A frase das vagas do federal continua falando da UF, não da casa.
    expect(doc.querySelector("[data-testid='uf-vagas-label']")?.textContent).toContain(
      "em disputa em DF",
    );
    const kickers = [...doc.querySelectorAll("[data-testid='panel-kicker']")].map(
      (k) => k.textContent,
    );
    expect(kickers).toContain("Bancada do Distrito Federal");
  });

  it("🔴 sigla fora das UFs da casa ⇒ 404 ANTES de ler qualquer coisa", async () => {
    // Estadual no DF (a casca do estadual redireciona antes; aqui é a rede),
    // distrital fora do DF.
    await expect(renderPaginaUfDeputado(7, "DF")).rejects.toThrow();
    await expect(renderPaginaUfDeputado(8, "SP")).rejects.toThrow();
    await expect(renderPaginaUfDeputado(6, "XX")).rejects.toThrow();
    expect(lerDadosDaCasaMock).not.toHaveBeenCalled();
  });
});

describe("rota e metadata por cargo (casca fina)", () => {
  it("paramsEstaticosDaCasa: 27 · 26 sem o DF · só o DF", () => {
    expect(paramsEstaticosDaCasa(6)).toHaveLength(27);
    const est = paramsEstaticosDaCasa(7).map((p) => p.sigla);
    expect(est).toHaveLength(26);
    expect(est).not.toContain("DF");
    expect(paramsEstaticosDaCasa(8)).toEqual([{ sigla: "DF" }]);
  });

  it("metadata: título e endereço canônico do cargo", () => {
    const fed = metadataDaPaginaUf(6, "sp");
    expect(fed.title).toBe("Deputado Federal SP — Apuração 2026 | AtlasMenna");
    expect(fed.alternates?.canonical).toBe("/uf/SP/deputado-federal");

    // Spec 027 (RF-284, frente U-b): nas assembleias o título nomeia a CASA.
    const est = metadataDaPaginaUf(7, "SP");
    expect(est.title).toBe(
      "Deputado Estadual SP — Assembleia Legislativa de São Paulo · Apuração 2026 | AtlasMenna",
    );
    expect(est.alternates?.canonical).toBe("/uf/SP/deputado-estadual");

    const dis = metadataDaPaginaUf(8, "DF");
    expect(dis.alternates?.canonical).toBe("/uf/DF/deputado-distrital");
    expect(String(dis.description)).toContain("Deputado Distrital no DF");
  });
});

describe("spec 027 (véspera 03/10) — o texto do DF e o painel Votação em modo resumo", () => {
  // O objeto do SP do contrato, relabelado como o DF e lido em modo resumo
  // (`granularidade: "uf"`, como as assembleias na Fase 1), com `votacao`.
  //
  // Mutações aplicadas à mão e desfeitas (03/10), que estes casos derrubam:
  //   - M-S4: `comArtigo` da página fixo em `false` — cai "no DF / do DF";
  //   - M-S5: `siglaNaFrase` ignorando `comArtigo` (artigo sempre no DF) — cai
  //     "o federal no DF guarda o texto de sempre";
  //   - M-S6: a página sem `semProjecao` — cai "sem arco 3 nem 'zona'".
  function detalheDf(granularidade: "uf" | "zona"): DeputadoUfDetailResult {
    const r = detalheSp();
    if (r.status !== "ok") throw new Error("fixture");
    const d = r.detail as DeputadoUfDetail & Record<string, unknown>;
    d.uf = "DF";
    d.granularidade = granularidade;
    d.votacao = {
      contagens: {
        aptos: 2_000_000,
        instalados: 1_500_000,
        comparecimento: 1_200_000,
        abstencao: 300_000,
        validos: 1_000_000,
        brancos: 80_000,
        nulos: 70_000,
        anulados: 30_000,
        sub_judice: 20_000,
      },
    };
    return r;
  }

  it("🔴 distrital no DF: 'no DF' / 'do DF', nunca 'em DF' / 'de DF'", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: detalheDf("uf"),
      interruptor: DESLIGADO,
    });
    const doc = await render(8, "DF");
    const t = textoDe(doc);
    expect(doc.querySelector("#mais-votados-uf-heading")?.textContent).toBe("Mais votados no DF");
    expect(t).toContain("votos válidos do DF");
    expect(doc.querySelector("#regras-heading")?.textContent).toBe("Regras com os números do DF");
    expect(t).not.toMatch(/\b(em|de) DF\b/);
  });

  it("🔴 distrital no DF em modo resumo: Votação sem arco 3 nem 'zona apurada'", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: detalheDf("uf"),
      interruptor: DESLIGADO,
    });
    const doc = await render(8, "DF");
    const painel = doc.querySelector("[data-testid='votacao-eleitorado']");
    expect(painel).not.toBeNull();
    expect(doc.querySelector("[data-testid='votacao-circulo-3']")).toBeNull();
    expect(doc.querySelector("[data-testid='votacao-circulo-1-visao']")).toBeNull();
    expect(textoDe(doc)).not.toContain("zona apurada");
  });

  it("o federal no DF guarda o texto de sempre ('em DF') e o arco 3 'aguardando'", async () => {
    lerDadosDaCasaMock.mockResolvedValue({
      nacional: nacional(),
      detalhe: detalheDf("zona"),
      interruptor: DESLIGADO,
    });
    const doc = await render(6, "DF");
    expect(doc.querySelector("#mais-votados-uf-heading")?.textContent).toBe("Mais votados em DF");
    expect(doc.querySelector("[data-testid='votacao-circulo-3-aguardando']")).not.toBeNull();
  });
});
