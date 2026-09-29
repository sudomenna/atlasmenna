// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoBlocos026.test.tsx — spec 026, os blocos de
 * servidor das telas de Deputado Federal:
 *
 *   - `<DeputadoConferencia>` (RF-269) — a frase sai do que FOI comparado; "batem"
 *     só com `confere` E `algoritmo` em `comparou` (M35/M6);
 *   - `<DeputadoRegras>` (RF-274) — todo número do payload (M21 no lado da tela);
 *   - `<DeputadoMaisVotados>` (RF-270, RF-271) — UF e país, destino no lugar do %;
 *   - `<DeputadoPuxadores>` / `<LinhaPuxadores>` (RF-273);
 *   - `<MarcaDeputado>` / `<LegendaMarcas>` (RF-262, RF-266, RF-267);
 *   - `<DeputadoMetodologia>` estendido (RF-266) — interruptor, trava e o "o que
 *     está movendo".
 *
 * Os dados saem das fixtures de contrato (`tests/fixtures/contrato/`).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DestinoDeputadoTexto,
  LegendaMarcas,
  MarcaDeputado,
} from "@/components/atoms/badges/MarcaDeputado";
import { DeputadoConferencia } from "@/components/blocks/DeputadoConferencia";
import {
  DeputadoMaisVotados,
  type LinhaMaisVotados,
} from "@/components/blocks/DeputadoMaisVotados";
import { DeputadoMetodologia } from "@/components/blocks/DeputadoMetodologia";
import { DeputadoPuxadores, LinhaPuxadores } from "@/components/blocks/DeputadoPuxadores";
import { DeputadoRegras } from "@/components/blocks/DeputadoRegras";
import type {
  DeputadoConferencia as ConferenciaDados,
  DeputadoProjecaoUf,
  DeputadoUfLinha,
  EdgeDeputadoDestaque,
  EdgeDeputadoPuxador,
  DeputadoRegras as RegrasDados,
} from "@/lib/blob/deputado-uf";
import { bitsDasMarcas, marcasDaLinha, projecaoVisivel } from "@/lib/utils/deputado-marcas";
import contratoNacional from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

interface UfFixture {
  uf: string;
  pct_apurado: number;
  totalizacao_final: boolean;
  regras: RegrasDados;
  projecao: DeputadoProjecaoUf;
  conferencia: ConferenciaDados;
  mais_votados: Array<{ cod: string; sqcand: number }>;
  agremiacoes: Array<{
    cod: string;
    sigla: string;
    cadeiras: number;
    cadeiras_projetadas?: number;
    candidatos: DeputadoUfLinha[];
    puxadores?: Array<{ sqcand: number; quocientes: number; excedente: number }>;
  }>;
}
const UFS = contratoUf as unknown as Record<"AC" | "AP" | "RR" | "SP", UfFixture>;
const NACIONAL = contratoNacional as unknown as {
  mais_votados: EdgeDeputadoDestaque[];
  puxadores: EdgeDeputadoPuxador[];
};

function doc(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}
function texto(node: React.ReactElement): string {
  return (doc(node).body.textContent ?? "").replace(/\s+/g, " ");
}

function conferenciaDe(uf: keyof typeof UFS, over: Partial<ConferenciaDados> = {}) {
  const d = UFS[uf];
  const siglaPorCod = new Map(d.agremiacoes.map((a) => [a.cod, a.sigla] as const));
  const nomePorSqcand = new Map(
    d.agremiacoes.flatMap((a) => a.candidatos.map((c) => [c.sqcand, c.nome] as const)),
  );
  return (
    <DeputadoConferencia
      conferencia={{ ...d.conferencia, ...over }}
      divergenciasV1={[]}
      totalizacaoFinal={d.totalizacao_final}
      siglaPorCod={siglaPorCod}
      nomePorSqcand={nomePorSqcand}
      titleId="conf"
    />
  );
}

// ---------------------------------------------------------------------------
// Conferência — RF-269
// ---------------------------------------------------------------------------

describe("DeputadoConferencia — a frase vem do que foi comparado (RF-269)", () => {
  it("🔴 SP `sem_dado_tse`: NÃO diz que os números batem", () => {
    const t = texto(conferenciaDe("SP"));
    // A única ocorrência de "batem" permitida é a que a NEGA.
    expect(t.replace("não dizemos que os números batem", "")).not.toMatch(/bat(em|e)\b/i);
    expect(t).not.toMatch(/Conferimos/);
    expect(t).toContain("não dizemos que os números batem");
  });

  it("RR `confere`: diz o que bateu e nomeia o HORÁRIO do boletim comparado", () => {
    const t = texto(conferenciaDe("RR"));
    // 23:30:04Z = 20:30:04 em Brasília.
    expect(t).toContain("Conferimos com o boletim do TSE das 20:30:04");
    expect(t).toContain("o quociente eleitoral e as cadeiras de cada agremiação");
    expect(t).toContain("o eleitorado das zonas que lemos fecha com o do boletim do TSE");
  });

  it("🔴 M35 — estado 'confere' SEM `algoritmo` em `comparou`: nenhuma afirmação de igualdade da conta", () => {
    const t = texto(conferenciaDe("RR", { comparou: ["eleitorado"] }));
    expect(t).not.toMatch(/Conferimos com/);
    expect(t).not.toContain("o quociente eleitoral e as cadeiras de cada agremiação");
    expect(t).toContain("conferimos só isto");
    expect(t).toContain("não dizemos que ela bate");
    const vazio = texto(conferenciaDe("RR", { comparou: [] }));
    expect(vazio).toContain("não dizemos que os números batem");
  });

  it("AP `diverge`: o eleitorado 19,5% abaixo, com os dois números; o resto do comparado, dito", () => {
    const d = doc(conferenciaDe("AP"));
    const t = (d.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).toContain("Há uma divergência entre a nossa conta e o boletim do TSE das 20:31:15");
    const item = d.querySelector("[data-o-que='eleitorado']")?.textContent ?? "";
    expect(item).toContain("505.610");
    expect(item).toContain("628.071");
    expect(item).toContain("19,5% abaixo");
    // `algoritmo` foi comparado e não divergiu: isso também é fato.
    expect(t).toContain("No resto do que comparamos, o quociente eleitoral e as cadeiras");
  });

  it("🔴 AP: divergência de ELEITORADO não é 'pequena diferença' — a tela diz que é estrutural, com o tamanho", () => {
    const d = doc(conferenciaDe("AP"));
    const frase = (d.querySelector("[data-testid='uf-conferencia']")?.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(frase).not.toContain("não indicam erro");
    expect(frase).not.toContain("pequenas diferenças");
    expect(frase).toContain("é estrutural");
    expect(frase).toContain("uma zona eleitoral do estado que não buscamos no TSE");
    // A magnitude: 19,5% e os 122.461 eleitores (628.071 − 505.610) que faltam.
    expect(frase).toContain("19,5% abaixo");
    expect(frase).toContain("122.461 eleitores a menos");
  });

  it("🔴 votos válidos divergentes (com totalização final) também são estruturais — nunca 'não indicam erro'", () => {
    const t = texto(
      <DeputadoConferencia
        conferencia={{
          estado: "diverge",
          boletim_dado_ts: "2026-10-05T02:00:00Z",
          totalizacao_final: true,
          comparou: ["eleitorado", "algoritmo", "eleitos", "votos_validos"],
          divergencias: [
            { o_que: "votos_validos", nosso: 980, tse: 1000, detalhe: "", diferenca_pct: -2 },
          ],
        }}
        divergenciasV1={[]}
        totalizacaoFinal={true}
        titleId="c"
      />,
    );
    expect(t).toContain("já é a totalização final");
    expect(t).toContain("é estrutural");
    expect(t).toContain("2,0% abaixo do total do TSE (20 votos a menos)");
    expect(t).not.toContain("não indicam erro");
  });

  it("sem divergência estrutural e antes da totalização final: 'pequenas diferenças… não indicam erro' continua", () => {
    const sp = texto(conferenciaDe("SP"));
    expect(sp).toContain("pequenas diferenças são esperadas e não indicam erro");
    expect(sp).not.toContain("estrutural");
    // Divergência só da conta (quociente), sem eleitorado: a frase de
    // andamento continua — essa pode mesmo ser do momento do boletim.
    const qe = texto(
      <DeputadoConferencia
        conferencia={undefined}
        divergenciasV1={[
          { o_que: "quociente_eleitoral", nosso: 210_400, tse: 210_401, detalhe: "x" },
        ]}
        totalizacaoFinal={false}
        titleId="c"
      />,
    );
    expect(qe).toContain("não indicam erro");
    expect(qe).not.toContain("estrutural");
  });

  it("AC `diverge` com `tf`: quantos eleitos só nossos e só do TSE, por NOME; cadeiras pela sigla", () => {
    const d = doc(conferenciaDe("AC"));
    const eleitos = d.querySelector("[data-o-que='eleitos']")?.textContent ?? "";
    expect(eleitos).toContain("1 só na nossa conta e 1 só na do TSE");
    expect(eleitos).toContain("Magalhães AC-15-02");
    expect(eleitos).toContain("Brandão AC-55-02");
    expect(eleitos).not.toMatch(/\d{11}/);
    const cadeiras = [...d.querySelectorAll("[data-o-que='cadeiras']")].map((x) => x.textContent);
    expect(cadeiras.join(" ")).toContain("MDB (número 15)");
    expect(d.body.textContent).toContain("já é a totalização final");
  });

  it("v1 sem `conferencia` e sem divergência: texto neutro, nunca o 'batem' antigo", () => {
    const t = texto(
      <DeputadoConferencia
        conferencia={undefined}
        divergenciasV1={[]}
        totalizacaoFinal={false}
        titleId="c"
      />,
    );
    expect(t).not.toContain("batem com os que o TSE publica");
    expect(t).toContain("não dizemos que os números batem");
  });

  it("v1 com divergência: ela aparece, com rótulo legível; chave desconhecida aparece crua", () => {
    const d = doc(
      <DeputadoConferencia
        conferencia={undefined}
        divergenciasV1={[
          { o_que: "quociente_eleitoral", nosso: 210_400, tse: 210_401, detalhe: "x" },
          { o_que: "chave_nova", nosso: 1, tse: 2, detalhe: "y" },
        ]}
        totalizacaoFinal={false}
        titleId="c"
      />,
    );
    const lista = d.querySelector("[data-testid='uf-divergencias']")?.textContent ?? "";
    expect(lista).toContain("Quociente eleitoral");
    expect(lista).toContain("210.401");
    expect(lista).toContain("chave nova");
    expect(d.body.textContent).toContain("Há 2 divergências");
  });
});

// ---------------------------------------------------------------------------
// Regras — RF-274
// ---------------------------------------------------------------------------

describe("DeputadoRegras — números do payload, nunca literais (RF-274)", () => {
  it("QE 1.003 ⇒ pisos 101, 803 e 201 — lidos do dado", () => {
    const d = doc(
      <DeputadoRegras
        uf="XX"
        titleId="r"
        regras={{
          quociente_eleitoral: 1003,
          votos_validos: 8024,
          lugares_a_preencher: 8,
          piso_candidato: 101,
          piso_agremiacao_sobras: 803,
          piso_candidato_sobras: 201,
        }}
      />,
    );
    expect(d.querySelector("[data-testid='dep-regras-qe']")?.textContent).toBe("1.003 votos");
    expect(d.querySelector("[data-testid='dep-regras-piso-candidato']")?.textContent).toBe(
      "101 votos",
    );
    expect(d.querySelector("[data-testid='dep-regras-piso-agremiacao']")?.textContent).toBe(
      "803 votos",
    );
    expect(d.querySelector("[data-testid='dep-regras-piso-sobras']")?.textContent).toBe(
      "201 votos",
    );
    expect(d.body.textContent).toContain("Regras com os números de XX");
  });

  it("🔴 o componente não recalcula: um piso 'errado' no dado aparece como veio", () => {
    const d = doc(
      <DeputadoRegras uf="SP" titleId="r" regras={{ ...UFS.SP.regras, piso_candidato: 7777 }} />,
    );
    expect(d.querySelector("[data-testid='dep-regras-piso-candidato']")?.textContent).toBe(
      "7.777 votos",
    );
  });

  it("sem regras: o bloco fica e diz quando aparecem — nenhum zero", () => {
    const t = texto(<DeputadoRegras uf="SP" titleId="r" regras={undefined} />);
    expect(t).toContain("aparecem aqui quando o TSE publicar quantas cadeiras");
    expect(t).not.toMatch(/\b0 votos/);
  });
});

// ---------------------------------------------------------------------------
// Mais votados — RF-270, RF-271
// ---------------------------------------------------------------------------

function maisVotadosUf(uf: keyof typeof UFS, interruptor = true): LinhaMaisVotados[] {
  const d = UFS[uf];
  const ctx = {
    totalizacaoFinal: d.totalizacao_final,
    projecaoVisivel: projecaoVisivel(d.projecao, interruptor),
  };
  return d.mais_votados.map((ref) => {
    const a = d.agremiacoes.find((x) => x.cod === ref.cod);
    const l = a?.candidatos.find((c) => c.sqcand === ref.sqcand) as DeputadoUfLinha;
    return {
      uf: d.uf,
      sqcand: l.sqcand,
      nome: l.nome,
      partido: l.partido,
      cod: ref.cod,
      sigla: a?.sigla ?? "",
      numero: l.numero,
      votos: l.votos,
      pct_validos: l.pct_validos,
      destino: l.destino,
      marcas: bitsDasMarcas(marcasDaLinha(l, ctx)),
    };
  });
}

describe("DeputadoMaisVotados", () => {
  it("RF-270 — UF: 10 linhas na ordem do produtor, com marcas e % dos válidos da UF", () => {
    const d = doc(
      <DeputadoMaisVotados escopo="uf" uf="RR" linhas={maisVotadosUf("RR")} titleId="mv" />,
    );
    const ls = [...d.querySelectorAll("[data-testid='dep-mais-votados-uf'] > li")];
    expect(ls).toHaveLength(10);
    expect(ls[0]?.textContent).toContain("Araújo RR-22-01");
    expect(ls[0]?.textContent).toContain("27,55%");
    expect(d.body.textContent).toContain("Mais votados em RR");
    expect(d.body.textContent).toContain("sobre os votos válidos de RR");
    expect(d.querySelectorAll("[data-marca='parcial']").length).toBeGreaterThan(0);
  });

  it("RF-270 — sub judice entre os 10: aparece, com o destino escrito, sem % e sem marca", () => {
    const d = doc(
      <DeputadoMaisVotados escopo="uf" uf="RR" linhas={maisVotadosUf("RR")} titleId="mv" />,
    );
    const sj = [...d.querySelectorAll("li")].find((l) => l.textContent?.includes("RR-13-01"));
    expect(sj?.textContent).toContain("sub judice — fora da conta");
    expect(sj?.textContent).not.toMatch(/\d%/);
    expect(sj?.querySelector("[data-marca]")).toBeNull();
  });

  it("RF-271 — país: cada linha diz a UF e que o % é 'dos válidos de {UF}'", () => {
    const d = doc(
      <DeputadoMaisVotados escopo="pais" linhas={NACIONAL.mais_votados} titleId="mvp" />,
    );
    const ls = [...d.querySelectorAll("[data-testid='dep-mais-votados-pais'] > li")];
    expect(ls).toHaveLength(NACIONAL.mais_votados.length);
    for (const [i, l] of ls.entries()) {
      const uf = NACIONAL.mais_votados[i]?.uf ?? "";
      expect(l.getAttribute("data-uf")).toBe(uf);
      if (NACIONAL.mais_votados[i]?.pct_validos !== null) {
        expect(l.textContent).toContain(`dos válidos de ${uf}`);
      }
    }
    expect(d.body.textContent).toContain("Mais votados do país");
    // A capa não tem marca.
    expect(d.querySelector("[data-marca]")).toBeNull();
  });

  it("sem linhas (v1 / payload antigo): o bloco não aparece", () => {
    expect(
      renderToStaticMarkup(
        <DeputadoMaisVotados escopo="uf" uf="SP" linhas={undefined} titleId="x" />,
      ),
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Puxadores — RF-273
// ---------------------------------------------------------------------------

describe("DeputadoPuxadores / LinhaPuxadores (RF-273)", () => {
  it("país: quocientes, excedente e 'não elege nome nenhum' em cada linha", () => {
    const d = doc(<DeputadoPuxadores puxadores={NACIONAL.puxadores} titleId="px" />);
    const ls = [...d.querySelectorAll("[data-testid='dep-puxadores-pais'] > li")];
    expect(ls).toHaveLength(NACIONAL.puxadores.length);
    expect(ls[0]?.textContent).toContain("fez 3 quocientes eleitorais de SP sozinho");
    expect(ls[0]?.textContent).toContain("os 2 de excedente somam para a agremiação");
    expect(ls[0]?.textContent).toContain("não elegem nome nenhum");
    expect(ls[1]?.textContent).toContain(
      "o 1 de excedente soma para a agremiação e não elege nome nenhum",
    );
  });

  it("vazio ⇒ diz que ninguém chegou lá; ausente ⇒ o painel não existe", () => {
    expect(texto(<DeputadoPuxadores puxadores={[]} titleId="px" />)).toContain(
      "Nenhum candidato chegou a duas vezes o quociente",
    );
    expect(renderToStaticMarkup(<DeputadoPuxadores puxadores={undefined} titleId="px" />)).toBe("");
  });

  it("na agremiação: nome pelo sqcand, números do payload", () => {
    const pl = UFS.SP.agremiacoes.find((a) => a.cod === "22");
    const nomes = new Map(pl?.candidatos.map((c) => [c.sqcand, c.nome] as const));
    const t = texto(<LinhaPuxadores uf="SP" puxadores={pl?.puxadores} nomePorSqcand={nomes} />);
    expect(t).toContain("Puxador: Araújo SP-22-01 fez 3 quocientes eleitorais de SP sozinho");
    expect(t).toContain("Puxador: Conceição SP-22-02 fez 2 quocientes eleitorais de SP sozinho");
  });
});

// ---------------------------------------------------------------------------
// Marcas e legenda — RF-262, RF-266, RF-267
// ---------------------------------------------------------------------------

describe("MarcaDeputado / LegendaMarcas", () => {
  it("texto primeiro: cada marca diz o nome dela; a do TSE cita o rótulo entre aspas, fora da caixa", () => {
    const d = doc(<MarcaDeputado marca={{ tipo: "tse", rotulo: "eleito_media" }} />);
    expect(d.querySelector("[data-marca='tse']")?.textContent).toBe("Eleito (TSE)");
    expect(d.querySelector("[data-citacao-tse]")?.textContent).toBe(
      "rótulo do TSE: “Eleito por média”",
    );
    expect(texto(<MarcaDeputado marca={{ tipo: "parcial", via: "sobra", apertada: true }} />)).toBe(
      "eleito na parcial· nas sobras· sobra apertada",
    );
    expect(texto(<MarcaDeputado marca={{ tipo: "projecao", via: "qp", apertada: false }} />)).toBe(
      "eleito na projeção · não oficial· pelo quociente",
    );
  });

  it("destino: o texto do RF-261", () => {
    expect(texto(<DestinoDeputadoTexto destino="valido_legenda" />)).toBe("votos para a legenda");
    expect(texto(<DestinoDeputadoTexto destino="anulado" />)).toBe("votos anulados");
    expect(texto(<DestinoDeputadoTexto destino="sub_judice" />)).toBe("sub judice — fora da conta");
  });

  it("legenda: só lista a marca que pode aparecer — projeção só visível, TSE só com `tf`", () => {
    const fechada = texto(
      <LegendaMarcas uf="SP" projecaoVisivel={false} totalizacaoFinal={false} />,
    );
    expect(fechada).toContain("eleito na parcial");
    expect(fechada).not.toMatch(/proje/i);
    expect(fechada).not.toContain("Eleito (TSE)");
    expect(fechada).toContain("votos válidos de SP");

    const aberta = texto(
      <LegendaMarcas uf="RR" projecaoVisivel totalizacaoFinal={false} temDestino />,
    );
    expect(aberta).toContain("eleito na projeção · não oficial");
    expect(aberta).toContain("sub judice — fora da conta");

    const final = texto(<LegendaMarcas uf="AC" projecaoVisivel totalizacaoFinal />);
    expect(final).toContain("Eleito (TSE)");
    expect(final).not.toContain("eleito na parcial");
    expect(final).not.toMatch(/proje/i);
  });
});

// ---------------------------------------------------------------------------
// Metodologia — RF-266
// ---------------------------------------------------------------------------

describe("DeputadoMetodologia estendido (RF-266)", () => {
  function metodologia(uf: keyof typeof UFS, interruptor: boolean) {
    const d = UFS[uf];
    const movendo = d.agremiacoes
      .filter((a) => a.cadeiras_projetadas !== undefined && a.cadeiras_projetadas !== a.cadeiras)
      .map((a) => ({ sigla: a.sigla, parcial: a.cadeiras, projetada: a.cadeiras_projetadas ?? 0 }));
    return doc(
      <DeputadoMetodologia
        pctApurado={d.pct_apurado}
        cadenciaMinutos={30}
        temDado
        temIntervalo
        variant="uf"
        uf={uf}
        projecao={d.projecao}
        interruptorLigado={interruptor}
        movendo={movendo}
      />,
    );
  }

  it("interruptor desligado: diz que está desligada, e nenhum 'o que está movendo'", () => {
    const d = metodologia("RR", false);
    expect(d.body.textContent).toContain("Neste momento a projeção está desligada no site");
    expect(d.querySelector("[data-testid='dep-movendo']")).toBeNull();
  });

  it("RR liberada + ligada: o 'o que está movendo' diz a fração estimada e só as agremiações que diferem", () => {
    const d = metodologia("RR", true);
    const mov = (d.querySelector("[data-testid='dep-movendo']")?.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(mov).toContain("O que está movendo a projeção · não oficial");
    // O PARÁGRAFO diz "não oficial" ele mesmo — não só o título (§ 1, § 8).
    const par = d.querySelector("[data-testid='dep-movendo'] p")?.textContent ?? "";
    expect(par).toContain("não oficial");
    // Sem a faixa da projeção (adiada, ADR-0063 D8 emendado): diz que é pontual.
    expect(par.replace(/\s+/g, " ")).toContain(
      "As cadeiras da projeção são um número pontual: a faixa delas ainda não é calculada, e a faixa que aparece ao lado de cada bancada é a da parcial.",
    );
    expect(mov).toContain("37,6% do eleitorado de RR ainda não foi apurado");
    expect(mov).toContain("imputado nas 3 zonas sem boletim");
    expect(mov).toContain("UNIÃO, 2 cadeiras na parcial e 1 na projeção");
    expect(mov).toContain("MDB, 1 cadeira na parcial e 2 na projeção");
    // "e nada mais": PL e PT batem entre parcial e projeção e não são citados.
    expect(mov).not.toContain("PL,");
    expect(mov).not.toContain("PT/PC do B/PV,");
  });

  it("capa (national): bloco compacto só com o interruptor ligado E algum estado com selo", () => {
    const capa = (ligado: boolean, ufs: { sigla: string; estado: string }[]) =>
      doc(
        <DeputadoMetodologia
          pctApurado={40}
          cadenciaMinutos={30}
          temDado
          temIntervalo
          interruptorLigado={ligado}
          projecaoPorUf={ufs}
        />,
      );
    const ufs = [
      { sigla: "RR", estado: "liberada" },
      { sigla: "SP", estado: "aguardando" },
    ];
    expect(capa(false, ufs).querySelector("[data-testid='dep-movendo']")).toBeNull();
    expect(capa(true, []).querySelector("[data-testid='dep-movendo']")).toBeNull();
    const t = (
      capa(true, ufs).querySelector("[data-testid='dep-movendo'] p")?.textContent ?? ""
    ).replace(/\s+/g, " ");
    expect(t).toContain("A projeção, que é não oficial, está liberada em 1 de 27 estados (RR)");
    expect(t).toContain("Nos demais, o selo de cada estado diz por que ela ainda não aparece.");
    const nenhuma = (
      capa(true, [{ sigla: "SP", estado: "aguardando" }]).querySelector(
        "[data-testid='dep-movendo'] p",
      )?.textContent ?? ""
    ).replace(/\s+/g, " ");
    expect(nenhuma).toContain("ainda não está liberada em nenhum estado");
    expect(nenhuma).toContain("não oficial");
  });

  it("SP aguardando + ligada: o estado da trava, e nenhum 'o que está movendo'", () => {
    const d = metodologia("SP", true);
    const t = (d.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).toContain("Em SP: 18,7% do eleitorado apurado e 388 de 1011 zonas com boletim.");
    expect(t).toContain("aparece a partir de 25% do eleitorado apurado (agora 18,7%)");
    expect(d.querySelector("[data-testid='dep-movendo']")).toBeNull();
  });

  it("a parcial continua dita como NÃO projeção; o limite do voto de reduto é declarado", () => {
    const t = metodologia("RR", true).body.textContent ?? "";
    expect(t).toContain("Os números da parcial não são uma projeção");
    expect(t).toContain("voto de reduto");
    expect(t).toContain("A ordem das listas nunca muda por causa dela");
  });
});
