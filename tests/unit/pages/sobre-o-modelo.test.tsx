/**
 * tests/unit/pages/sobre-o-modelo.test.tsx — Spec 011 (RF-054) + constituição
 * § 8 (v1.2) + ADR-0021.
 *
 * A página `/sobre-o-modelo` é a superfície onde o produto explica ao leitor
 * COMO a projeção é feita. Desde o ADR-0021 o método é **extrapolação do
 * apurado por zona** (regra de três, `k = te/esi`); 2022 saiu do cálculo e
 * ficou só como comparação descritiva. Enquanto a página descrevesse swing
 * como método, ela estaria factualmente errada sobre o próprio produto — que
 * é exatamente o que a constituição § 8 proíbe.
 *
 * Estes testes travam isso: a página não pode voltar a ensinar swing.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import SobreOModeloPage, { metadata } from "@/app/sobre-o-modelo/page";

// A página é async desde 29/09 (lê as chaves das etiquetas); renderiza uma vez.
let MARKUP = "";
beforeAll(async () => {
  MARKUP = renderToStaticMarkup(await SobreOModeloPage());
});

function html(): string {
  return MARKUP;
}

/**
 * Texto corrido da seção "5 · Cadeiras", sem tags.
 *
 * As asserções da faixa de cadeiras precisam ser **locais**: a página inteira
 * fala de projeção o tempo todo — é o método das outras três corridas — e uma
 * busca no markup inteiro passaria por acidente. O recorte vai do `id` da
 * seção até o `</section>` seguinte, o que inclui o callout final dela.
 */
function textoSecaoCadeiras(): string {
  const markup = html();
  const inicio = markup.indexOf('id="sec-cadeiras"');
  expect(inicio).toBeGreaterThan(-1);
  const fim = markup.indexOf("</section>", inicio);
  expect(fim).toBeGreaterThan(inicio);
  return markup
    .slice(inicio, fim)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("/sobre-o-modelo (spec 011 / ADR-0021)", () => {
  it("(a) não descreve swing como método — nem no corpo, nem na metadata", () => {
    const markup = html();
    expect(markup.toLowerCase()).not.toContain("swing");
    expect((metadata.description ?? "").toLowerCase()).not.toContain("swing");
  });

  it("(b) explica a regra de três por zona com o fator de escala k", () => {
    const markup = html();
    expect(markup).toContain("regra de três por zona");
    expect(markup).toContain("k = eleitores aptos da zona");
    // A frase-âncora do método, em prosa de leigo.
    expect(markup).toContain("a partir do que cada zona já apurou");
  });

  it("(c) diz que 2022 é comparação, não insumo do cálculo", () => {
    const markup = html();
    expect(markup).toContain("não entra nessa conta");
    expect(markup).toContain("Não entram no cálculo da projeção");
  });

  it("(d) declara o viés de composição e a limitação do intervalo", () => {
    const markup = html();
    expect(markup).toContain("viés de composição");
    expect(markup).toContain("projeção a partir do apurado");
    // UF sem zona apurada herda o nacional — não mais "resultado de 2022".
    expect(markup).toContain("proporção observada no país");
  });

  it("(e) mantém as seções obrigatórias da RF-054", () => {
    const markup = html();
    for (const heading of [
      "O que estamos calculando",
      "A unidade mínima: a regra de três por zona",
      "o bootstrap",
      "a agulha",
      "O time por trás do AtlasMenna",
      "De onde vêm os dados",
    ]) {
      expect(markup).toContain(heading);
    }
    // Constituição § 1 — footer não oficial + fonte TSE.
    expect(markup).toContain("Não oficial. Fonte:");
  });

  it("(f) não promete comportamentos que o código não tem", () => {
    const markup = html();
    // Não existe circuit breaker por volatilidade nem "modelo desabilitado"
    // por falta de mapeamento 2022 (ADR-0015 superseded pelo ADR-0021).
    expect(markup).not.toContain("bloco político mapeável");
    expect(markup).not.toContain("recolher a projeção");
  });
});

/**
 * A faixa de cadeiras — RF-127, ADR-0036 e ADR-0037.
 *
 * Em 2026-09-13 nasceu um **segundo** intervalo no produto, de natureza
 * diferente do bootstrap dos majoritários: ele reamostra zonas já apuradas e
 * refaz a distribuição de cadeiras, e no cargo 6 **não há projeção de voto**
 * (design 017 § D9). A constituição § 8 obriga esta página a detalhar como o
 * intervalo é construído e quais são as limitações conhecidas — e até este
 * commit ela não sabia que o segundo intervalo existia.
 *
 * Estes testes travam as quatro coisas que precisam estar ditas (o que mede,
 * o que não mede, por que varia entre estados, quando não aparece), a
 * limitação do ADR-0037, e proíbem a frase que seria falsa.
 */
describe("/sobre-o-modelo — a faixa de cadeiras (RF-127 / ADR-0036 / ADR-0037)", () => {
  it("(g) explica o que a faixa mede: reamostrar as zonas já apuradas e refazer a conta", () => {
    const texto = textoSecaoCadeiras();
    expect(texto).toContain("zonas eleitorais chegaram primeiro");
    // `N_RESAMPLES_CADEIRAS` e os dois percentis, em prosa.
    expect(texto).toContain("Embaralhamos mil vezes");
    expect(texto).toContain("2,5% mais altos");
    expect(texto).toContain("2,5% mais baixos");
  });

  it("(h) diz que a faixa NÃO mede o voto que falta, e aponta a cadeira indefinida", () => {
    const texto = textoSecaoCadeiras();
    expect(texto).toContain("não mede é o voto que ainda não chegou");
    // A marcação é quem carrega o "ainda vem voto" (design 017 § D7/§ D9).
    expect(texto).toContain("indefinida");
    expect(texto).toContain("rodada de sobras");
  });

  it("(i) explica por que a faixa é mais larga em estado pequeno — e que isso está certo", () => {
    const texto = textoSecaoCadeiras();
    expect(texto).toContain("mais larga em uns estados do que em outros, e isso está certo");
    expect(texto).toContain("Roraima");
    expect(texto).toContain("São Paulo");
  });

  it("(j) diz quando a faixa não aparece: menos de duas zonas com voto", () => {
    const texto = textoSecaoCadeiras();
    // `MIN_ZONAS_PARA_INTERVALO`, e o motivo de ela ser omitida em vez de sair
    // colada no número.
    expect(texto).toContain("menos de duas zonas com voto");
    expect(texto).toContain("largura zero");
  });

  it("(k) declara a limitação do ADR-0037 — a faixa nacional é mais estreita que a realidade", () => {
    const markup = html();
    expect(markup).toContain("A faixa nacional de cadeiras é mais estreita do que a realidade.");
    expect(markup).toContain("entra nessa soma como número fixo");
    // A parte que não pode ficar subentendida: é pior quanto mais cedo.
    expect(markup).toContain("pior no começo da noite");
    expect(markup).toContain("0037-uf-sem-faixa-entra-como-constante-no-nacional.md");
  });

  it("(l) não afirma que a faixa prevê, projeta ou estima o resultado final", () => {
    const texto = textoSecaoCadeiras();
    // Asserção negativa que discrimina: derruba o teste se um verbo de
    // previsão aparecer com o resultado final por objeto — mas só quando
    // **não** estiver negado, para que a frase honesta ("ela não prevê o
    // resultado final") continue permitida. Verificado por mutação nos dois
    // sentidos.
    expect(texto).not.toMatch(
      /(?<!não |nem |nunca |sem )(prev[êe]|projeta|estima|antecipa|adivinha)\w*[^.]{0,60}\b(resultado|n[úu]mero|bancada|total)\s+final/i,
    );
    // E a negação precisa estar escrita, não subentendida.
    expect(texto).toContain("não quer dizer que a bancada está perto do número final");
  });
});

/**
 * Spec 027 (emenda da spec 011) — as assembleias legislativas na seção 5, SEM
 * `<h2>` novo (a página tem oito; o teste de integração conta).
 *
 * Mutação aplicada à mão (29/09): tirar o parágrafo derruba o primeiro caso;
 * escrever nele que "a projeção das assembleias está ligada" derruba o segundo.
 */
describe("/sobre-o-modelo — as assembleias na seção de cadeiras (spec 027)", () => {
  function paragrafoAssembleias(): string {
    const markup = html();
    const inicio = markup.indexOf('data-testid="sobre-o-modelo-assembleias"');
    expect(inicio).toBeGreaterThan(-1);
    // Dentro da seção 5: depois do título dela, antes do fim dela.
    const secao = markup.indexOf('id="sec-cadeiras"');
    expect(inicio).toBeGreaterThan(secao);
    expect(inicio).toBeLessThan(markup.indexOf("</section>", secao));
    const fim = markup.indexOf("</p>", inicio);
    return markup
      .slice(inicio, fim)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  }

  it("diz a regra (CE 106–109), uma casa por estado, o tamanho (CF art. 27) e a Câmara Legislativa do DF", () => {
    const p = paragrafoAssembleias();
    expect(p).toContain("assembleias legislativas");
    expect(p).toContain("artigos 106 a 109");
    expect(p).toContain("artigo 27");
    expect(p).toContain("Câmara Legislativa");
    expect(p).toContain("27 casas");
    // Os números de conferência do art. 27: SP 94, os menores e o DF 24.
    expect(p).toContain("94 estaduais");
    expect(p).toContain("têm 24");
  });

  it("não fala de projeção das assembleias — ela depende de interruptor que o dono liga depois", () => {
    const p = paragrafoAssembleias().toLowerCase();
    expect(p).not.toMatch(/proje[çc]/);
    expect(p).not.toMatch(/ligad/);
  });
});
