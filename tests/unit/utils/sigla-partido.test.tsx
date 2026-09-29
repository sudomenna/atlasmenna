// @vitest-environment happy-dom
/**
 * tests/unit/utils/sigla-partido.test.ts
 *
 * `siglaExibicao()` — a sigla do partido como ela é DESENHADA
 * (`lib/utils/sigla-partido.ts`), mais o contrato de `<PartyTag abreviar>` e a
 * exceção da home de Deputados.
 *
 * Cada caso nomeia, no comentário, a MUTAÇÃO que ele mata. Um teste que não
 * sabe dizer isso não é um teste — é uma nota de rodapé
 * (`feedback_teste_que_nao_discrimina`).
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WinnerBanner } from "@/components/atoms/banners/WinnerBanner";
import { PartyTag } from "@/components/atoms/data/PartyTag";
import { ABREVIACOES_DE_SIGLA, siglaExibicao } from "@/lib/utils/sigla-partido";

/**
 * Código-fonte sem comentários — mesmo helper de `PartyTag.test.tsx`, e pela
 * mesma razão invertida: a home de Deputados EXPLICA em comentário por que não
 * abrevia, citando `siglaExibicao` e este arquivo pelo nome. Sem a limpeza, a
 * asserção "esta rota não chama siglaExibicao" reprovaria por causa da própria
 * prosa que a documenta.
 */
function codigoSemComentarios(caminho: string): string {
  return readFileSync(caminho, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function texto(node: React.ReactElement): string {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
  return doc.querySelector("[data-testid='party-tag']")?.textContent?.trim() ?? "";
}

describe("siglaExibicao — as cinco da tabela", () => {
  // ⚠️ Cinco `it` e não um `it.each`/laço: quando a tabela quebrar, a falha
  // tem de dizer QUAL sigla quebrou. Um laço único reporta "1 failed" e manda
  // quem está de plantão às 20h de 04/10 abrir o diff para descobrir o resto.

  // Mata: apagar a linha REPUBLICANOS da tabela, ou trocar o valor por outro.
  // É a sigla do caso medido (`CandidateResultRow.tsx:266-271`: 174px pedidos,
  // 49px dados) — a razão de tudo isto existir.
  it("(a) REPUBLICANOS → REP", () => {
    expect(siglaExibicao("REPUBLICANOS")).toBe("REP");
  });

  // Mata: apagar a linha CIDADANIA.
  it("(b) CIDADANIA → CID", () => {
    expect(siglaExibicao("CIDADANIA")).toBe("CID");
  });

  // Mata: apagar a linha SOLIDARIEDADE.
  it("(c) SOLIDARIEDADE → SOL", () => {
    expect(siglaExibicao("SOLIDARIEDADE")).toBe("SOL");
  });

  // Mata: apagar a linha DEMOCRATA. Também trava a colisão que um corte
  // automático produziria — "DEM" é de DEMOCRATA, e "DC" (Democracia Cristã)
  // convive com ela na paleta de `app/tokens-party.css`.
  it("(d) DEMOCRATA → DEM", () => {
    expect(siglaExibicao("DEMOCRATA")).toBe("DEM");
  });

  // Mata: apagar a linha MOBILIZA.
  it("(e) MOBILIZA → MOB", () => {
    expect(siglaExibicao("MOBILIZA")).toBe("MOB");
  });

  // Mata: acrescentar uma sexta abreviação sem o dono ter pedido. A lista é
  // uma decisão editorial de 2026-09-19, não um parâmetro de layout — quem
  // crescer a tabela tem de vir mexer aqui e explicar.
  it("(f) a tabela tem exatamente as cinco siglas que o dono pediu", () => {
    expect(Object.keys(ABREVIACOES_DE_SIGLA).sort()).toEqual([
      "CIDADANIA",
      "DEMOCRATA",
      "MOBILIZA",
      "REPUBLICANOS",
      "SOLIDARIEDADE",
    ]);
  });
});

describe("siglaExibicao — fora da tabela volta inalterada", () => {
  // 🔴 Mata: QUALQUER truncagem automática por comprimento
  // (`sigla.slice(0, 3)`, `length > 6 ? ... : ...`, `?? primeiras 3 letras`).
  // "PODEMOS" tem 7 letras, também estoura a coluna de 400px, e o dono NÃO
  // pediu para abreviá-la — um corte genérico publicaria "POD" numa eleição
  // nacional por decisão de um `slice`.
  it("(g) PODEMOS volta inteira — a regra não é comprimento, é a lista", () => {
    expect(siglaExibicao("PODEMOS")).toBe("PODEMOS");
  });

  // Mata: um `slice(0, 3)` aplicado sem checar a tabela — "PT" continuaria
  // "PT" e passaria despercebido. Este caso sozinho não basta (por isso o (g)
  // acima), mas trava o caminho curto: sigla curta não pode ganhar padding,
  // sufixo nem reticências.
  it("(h) PT volta inteira", () => {
    expect(siglaExibicao("PT")).toBe("PT");
  });

  // Mata: devolver `""`, `"—"` ou um default qualquer para sigla desconhecida
  // em vez da entrada. Uma sigla nova (partido recém-registrado, federação)
  // tem de aparecer FEIA e certa, nunca bonita e inventada.
  it("(i) sigla inexistente volta exatamente como chegou", () => {
    expect(siglaExibicao("PARTIDO NOVO QUALQUER")).toBe("PARTIDO NOVO QUALQUER");
  });

  // Mata: rodar a abreviação ANTES do `??` de ausência nos chamadores, ou
  // engolir o sentinela. `MunicipioExplorer` passa `row.partido ?? "—"` e o
  // balão do mapa passa "—"; os dois têm de atravessar intactos.
  it("(j) os sentinelas de ausência atravessam — '—' e '?'", () => {
    expect(siglaExibicao("—")).toBe("—");
    expect(siglaExibicao("?")).toBe("?");
  });
});

describe("siglaExibicao — entrada em qualquer caixa", () => {
  // 🔴 Mata: comparar sem normalizar (`ABREVIACOES[sigla]` cru, ou um
  // `===` contra a forma em caixa alta). O EA20 do TSE não promete caixa:
  // `lib/utils/party-color.ts` já documenta `" pt "`, `"PT"` e `"União"` como
  // formas plausíveis do mesmo campo. Sem normalizar, "Republicanos" passaria
  // inteiro e voltaria à coluna estreita que motivou tudo isto.
  it("(k) 'Republicanos' em caixa mista abrevia igual", () => {
    expect(siglaExibicao("Republicanos")).toBe("REP");
  });

  // Mata: normalizar só a caixa e esquecer o `trim()`.
  it("(l) espaço nas pontas não impede a abreviação", () => {
    expect(siglaExibicao("  solidariedade  ")).toBe("SOL");
  });

  // Mata: devolver a chave normalizada em vez do valor da tabela. A saída é
  // sempre a forma que o dono escreveu — "REP", nunca "Rep" nem "REPUBLICANOS".
  it("(m) a saída é a forma do dono, não a caixa da entrada", () => {
    expect(siglaExibicao("cidadania")).toBe("CID");
  });
});

describe("<PartyTag> — o chip abrevia por default e guarda a sigla inteira", () => {
  // Mata: esquecer de ligar `siglaExibicao` no átomo. São oito componentes
  // que passam por aqui; se o chip não abreviar, quase nada abrevia.
  it("(n) o texto do chip é a sigla abreviada", () => {
    expect(texto(<PartyTag sigla="REPUBLICANOS" />)).toBe("REP");
  });

  // 🔴 Mata: abreviar também o `data-sigla`. Esse atributo é chave de máquina
  // (seletor de teste, depuração, casamento por sigla); abreviá-lo faria a
  // tela e o DOM discordarem sobre qual partido é aquele — e é a mesma classe
  // de perda de informação que a restrição "não abreviar no payload" evita.
  it("(o) data-sigla continua com a sigla INTEIRA", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<PartyTag sigla="SOLIDARIEDADE" />),
      "text/html",
    );
    const chip = doc.querySelector("[data-testid='party-tag']");
    expect(chip?.getAttribute("data-sigla")).toBe("SOLIDARIEDADE");
    expect(chip?.textContent?.trim()).toBe("SOL");
  });

  // 🔴🔴 O CASO QUE O DONO VAI CONFERIR PRIMEIRO.
  //
  // Mata: trocar o default de `abreviar` para `true` SEM a prop de escape, ou
  // ignorar a prop dentro do átomo. A home de Deputados
  // (`app/(dep)/deputado-federal/page.tsx`) é a exceção explícita do pedido de
  // 2026-09-19 — lá a sigla rotula uma BANCADA, tem a largura da coluna
  // inteira, e o dono quer o nome inteiro.
  //
  // Hoje aquela página imprime `agr.sigla` em texto puro e não chama este
  // átomo — o teste (q) abaixo é quem trava isso. Este aqui trava o OUTRO
  // caminho de vazamento: no dia em que a linha da bancada virar `<PartyTag>`,
  // `abreviar={false}` tem de continuar funcionando.
  it("(p) abreviar={false} imprime a sigla inteira — o escape da home de Deputados", () => {
    expect(texto(<PartyTag sigla="REPUBLICANOS" abreviar={false} />)).toBe("REPUBLICANOS");
    expect(texto(<PartyTag sigla="MOBILIZA" abreviar={false} />)).toBe("MOBILIZA");
  });
});

describe("a home de Deputados não abrevia", () => {
  // 🔴🔴 Mata: alguém "uniformizar" a home de Deputados passando as siglas da
  // bancada por `siglaExibicao` — o jeito mais provável de a exceção do dono
  // morrer em silêncio, porque a tela continua parecendo certa para quem não
  // sabe que existe uma exceção.
  //
  // A asserção é sobre o CÓDIGO-FONTE da rota, e é de propósito: renderizar a
  // página exigiria payload de Edge Config e não provaria nada sobre as cinco
  // siglas (nenhuma delas precisa estar na fixture do dia). O que a exceção
  // diz é "esta rota não tem abreviação nenhuma", e é isso que se mede.
  it("(q) app/(dep)/deputado-federal/page.tsx não chama siglaExibicao em lugar nenhum", () => {
    // Caminho relativo à raiz do repo, como `PartyTag.test.tsx` já faz: sob o
    // transform do vitest `import.meta.url` não é uma URL `file:`, e
    // `readFileSync(new URL(...))` estoura com "The URL must be of scheme file".
    const fonte = codigoSemComentarios("app/(dep)/deputado-federal/page.tsx");
    // Sem o `import` não há como chamar; sem a chamada não há como abreviar.
    // As duas asserções juntas resistem a um import via alias ou re-export.
    expect(fonte).not.toContain("sigla-partido");
    expect(fonte).not.toContain("siglaExibicao(");
  });

  // Mata: mover a exceção para o lugar errado. A página de UF de Deputado
  // (`/uf/SP/deputado-federal`) lista PESSOAS numa coluna estreita e ABREVIA —
  // o dono isentou a home, não o cargo. Sem este caso, "Deputado não abrevia"
  // vira uma regra por cargo e apaga a correção da tela apertada.
  it("(r) a página de UF de Deputado ABREVIA — a isenção é da home, não do cargo", () => {
    // Spec 027: o corpo da página de UF saiu do arquivo de rota e virou o
    // módulo comum dos três cargos proporcionais; a casca de rota não monta
    // linha nenhuma.
    const fonte = codigoSemComentarios("app/(dep)/_pagina-uf-deputado.tsx");
    // Spec 026: as linhas viraram tuplas montadas por `paraLinhaCompacta`, e a
    // abreviação entra como a função de exibição do partido — a MESMA que o
    // cliente aplica às posições 61+ (`DeputadoListaAgremiacao`).
    expect(fonte).toMatch(/partido:\s*siglaExibicao\b/);
  });
});

describe("o que é LIDO mantém a sigla inteira", () => {
  // 🔴 A decisão de 2026-09-19, travada em código: abreviar é de PIXEL. O que
  // o leitor de tela recebe continua "REPUBLICANOS", porque em áudio não há
  // largura a economizar e "REP" é ambíguo dito em voz alta.
  //
  // Mata: aplicar `siglaExibicao` dentro de um `aria-label` — a "limpeza"
  // óbvia que alguém faria para eliminar a divergência visto/ouvido. O alvo é
  // o `<WinnerBanner>` porque nele a mesma sigla sai pelos DOIS canais no
  // mesmo elemento: `aria-label` (inteira) e `<span>` visível (abreviada).
  it("(s) <WinnerBanner>: aria-label inteiro, texto visível abreviado", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <WinnerBanner
          candidato="Fulano de Tal"
          partido="REPUBLICANOS"
          ufSigla="RS"
          cor="var(--party-outros)"
          rank={1}
        />,
      ),
      "text/html",
    );
    const banner = doc.querySelector("[role='status']");
    expect(banner?.getAttribute("aria-label")).toContain("(REPUBLICANOS)");
    expect(banner?.getAttribute("aria-label")).not.toContain("(REP)");
    // …e, no mesmo elemento, o que se VÊ é a abreviação.
    expect(banner?.textContent).toContain("REP");
    expect(banner?.textContent).not.toContain("REPUBLICANOS");
  });
});
