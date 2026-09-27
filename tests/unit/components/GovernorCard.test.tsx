// @vitest-environment happy-dom
/**
 * tests/unit/components/GovernorCard.test.tsx — S06/F4d (Fase 3).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GovernorCard } from "@/components/blocks/GovernorCard";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function mkCand(id: number, nome: string, partido: string, rank: number): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${rank})`,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    pct_projetado_lower: 0,
    pct_projetado_upper: 0,
    p_vitoria: 0,
    rank,
    p_passa_2t: 0,
    p_fecha_1t: 0,
  };
}

function mkUf(overrides: Partial<EdgeUfRow> & Pick<EdgeUfRow, "sigla" | "bucket">): EdgeUfRow {
  const base: EdgeUfRow = {
    sigla: overrides.sigla,
    pct_apurado: 70,
    lider: 1,
    margem_atual: 10,
    margem_projetada: 10,
    margem_projetada_ci: [5, 15],
    chamada: false,
    swing_vs_2022: 0,
    // Spec 018 / ADR-0042 — a partir daqui `nome`/`partido` vêm da PRÓPRIA
    // linha da UF, não do índice sobre `national.candidatos`. A fixture
    // reflete um payload pós-018; o caso pré-018 (campos ausentes) tem teste
    // dedicado no bloco "(j)".
    top_candidatos: [
      { id: 1, pct: 41.2, nome: "Tarcísio", partido: "REP", sqcand: "250002553928" },
      { id: 2, pct: 27.8, nome: "Boulos", partido: "PSOL", sqcand: "250002553929" },
      { id: 3, pct: 14.1, nome: "Márcio França", partido: "PSB", sqcand: "50002553930" },
      { id: 4, pct: 8.0, nome: "Datena", partido: "PSDB", sqcand: "50002553931" },
    ],
    // RF-006.8 (2026-09-27) — o selo lê `vai_a_2t`, não `bucket`. O default é
    // o que o produtor grava para cada bucket; um teste que queira a
    // combinação incoerente (`chamada` + `vai_a_2t: true`, o caso real de ES,
    // GO e MG no simulado) passa o campo explícito.
    vai_a_2t: VAI_A_2T_DO_BUCKET[overrides.bucket],
    bucket: overrides.bucket,
  };
  return { ...base, ...overrides };
}

const VAI_A_2T_DO_BUCKET: Record<EdgeUfRow["bucket"], boolean | null> = {
  chamada: false,
  decidido_1t: false,
  vai_2t: true,
  indefinido: null,
};

const candidatos: EdgeCandidate[] = [
  mkCand(1, "Tarcísio", "REP", 1),
  mkCand(2, "Boulos", "PSOL", 2),
  mkCand(3, "Márcio França", "PSB", 3),
  mkCand(4, "Datena", "PSDB", 4),
];

/**
 * A cauda somada pelo produtor (`EdgeUfRow.outros`, 2026-09-19).
 *
 * 🔴 Os números são escolhidos para DISCRIMINAR, não para fechar bonito. O
 * top-4 da fixture soma 91,1 — logo `100 − Σtop` daria **8,9%**, e a soma real
 * da cauda é **7,3%**. São dois textos diferentes na tela ("8.9%" vs "7.3%"),
 * então qualquer volta à subtração é visível num `toContain`. E `91,1 + 7,3 =
 * 98,4`: a fixture NÃO fecha em 100 de propósito, para que uma normalização
 * introduzida no componente também apareça.
 */
const OUTROS_SP: NonNullable<EdgeUfRow["outros"]> = { pct: 7.3, n_candidatos: 5 };

/** As `li` do ranking (o bloco mobile é `div`/`span`, não produz `li`). */
function linhas(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>("li"));
}

/**
 * O percentual de cada linha — `lastElementChild`, o último `<span>` da `li`.
 *
 * Deliberadamente NÃO um `toContain` sobre o texto da linha inteira: "8%" é
 * substring de "27.8%" e de "48%", então a asserção frouxa passa com a linha
 * errada e com o número errado.
 */
function pctsExibidos(doc: Document): string[] {
  return linhas(doc).map((li) => li.lastElementChild?.textContent ?? "");
}

describe("<GovernorCard />", () => {
  it("(a) bucket=chamada → chip ● ELEITO no líder", () => {
    const uf = mkUf({ sigla: "SP", bucket: "chamada" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    expect(doc.body.textContent ?? "").toContain("● ELEITO");
  });

  it("(b) bucket=decidido_1t → ● ELEITO", () => {
    const uf = mkUf({ sigla: "SP", bucket: "decidido_1t" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    expect(doc.body.textContent ?? "").toContain("● ELEITO");
  });

  it("(c) bucket=vai_2t → VAI A 2T", () => {
    const uf = mkUf({ sigla: "RJ", bucket: "vai_2t" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("VAI A 2T");
    expect(text).not.toContain("ELEITO");
  });

  it("🔴 (c2) bucket=chamada com vai_a_2t=true → VAI A 2T, nunca ELEITO (RF-006.8)", () => {
    // Margem grande não é eleição: líder com 38,5% e 13pp de folga vai ao 2º
    // turno. Até 2026-09-27 este card dizia "● ELEITO" (ES, GO, MG no simulado).
    const uf = mkUf({ sigla: "ES", bucket: "chamada", vai_a_2t: true });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("VAI A 2T");
    expect(text).not.toContain("ELEITO");
    expect(doc.querySelector("article")?.getAttribute("aria-label")).toContain(
      "vai ao segundo turno",
    );
  });

  it("(c3) bucket=decidido_1t com vai_a_2t=null (2º turno / legado) → EM APURAÇÃO", () => {
    const uf = mkUf({ sigla: "SP", bucket: "decidido_1t", vai_a_2t: null });
    const text = parse(<GovernorCard uf={uf} candidatos={candidatos} />).body.textContent ?? "";
    expect(text).toContain("EM APURAÇÃO");
    expect(text).not.toContain("ELEITO");
  });

  it("(d) bucket=indefinido → EM APURAÇÃO", () => {
    const uf = mkUf({ sigla: "MG", bucket: "indefinido" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    expect(doc.body.textContent ?? "").toContain("EM APURAÇÃO");
  });

  it("(e) renderiza as QUATRO candidaturas + a linha Outros quando o payload traz o campo", () => {
    // 2026-09-19 — eram três até esta data. Mutação alvo: voltar o
    // `.slice(0, 4)` de `GovernorCard.tsx` para `.slice(0, 3)` derruba a
    // asserção de "Datena" (o 4º da fixture).
    const uf = mkUf({ sigla: "SP", bucket: "chamada", outros: OUTROS_SP });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Tarcísio");
    expect(text).toContain("Boulos");
    expect(text).toContain("Márcio França");
    expect(text).toContain("Datena");
    expect(text).toContain("Outros");
    // Cinco linhas no ranking: as 4 candidaturas + o agregado.
    expect(linhas(doc)).toHaveLength(5);
  });

  it("(f) três candidaturas e nenhum campo `outros` → não exibe 'Outros'", () => {
    const uf = mkUf({
      sigla: "SP",
      bucket: "chamada",
      top_candidatos: [
        { id: 1, pct: 50 },
        { id: 2, pct: 30 },
        { id: 3, pct: 20 },
      ],
    });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    expect(doc.body.textContent ?? "").not.toContain("Outros");
  });

  it("(g) aria-label descreve UF + status + líder", () => {
    const uf = mkUf({ sigla: "SP", bucket: "chamada" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    const article = doc.querySelector("article");
    const label = article?.getAttribute("aria-label") ?? "";
    expect(label).toContain("São Paulo");
    expect(label).toContain("Tarcísio");
    expect(label).toContain("eleito");
  });

  it("(h) renderiza fallback mobile single-line via classes responsivas", () => {
    const uf = mkUf({ sigla: "SP", bucket: "chamada" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    // O wrapper mobile usa `sm:hidden`; o desktop `hidden sm:block`.
    const html = doc.body.innerHTML;
    expect(html).toContain("sm:hidden");
    expect(html).toContain("sm:block");
  });

  it("(i) nome longo da UF aparece (não só sigla) no desktop", () => {
    const uf = mkUf({ sigla: "SP", bucket: "chamada" });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    expect(doc.body.textContent ?? "").toContain("São Paulo");
  });

  // -------------------------------------------------------------------
  // Spec 018 / ADR-0042 — identidade pelo par (UF, número)
  // -------------------------------------------------------------------

  it("(j) payload PRÉ-018 (sem `nome` em top_candidatos) → placeholder, nunca o nome do índice nacional", () => {
    // Mutação alvo: remover o fallback, ou fazê-lo voltar a `candIndex`. A
    // segunda é a pior: o índice é `national.candidatos`, que em cargo 3 é a
    // união de 27 corridas — devolveria "Tarcísio" em qualquer estado.
    const uf = mkUf({
      sigla: "BA",
      bucket: "chamada",
      top_candidatos: [
        { id: 1, pct: 50 },
        { id: 2, pct: 30 },
      ],
    });
    const text = parse(<GovernorCard uf={uf} candidatos={candidatos} />).body.textContent ?? "";

    expect(text).toContain("Cand 1");
    expect(text).not.toContain("Tarcísio");
    expect(text).not.toContain("Boulos");
  });

  it("(k) duas UFs com o MESMO número 13 exibem nomes diferentes", () => {
    // O coração do ADR-0042: em cargo majoritário o número na urna é o número
    // do partido, então todo governador do PT do país é o 13. `candidatos` é
    // deliberadamente o bloco nacional colidente — se o componente ainda o
    // consultasse para nome, os dois cards diriam a mesma coisa.
    const nacionalColidente: EdgeCandidate[] = [mkCand(13, "Candidato 13", "PT", 1)];
    const sp = mkUf({
      sigla: "SP",
      bucket: "chamada",
      top_candidatos: [{ id: 13, pct: 55, nome: "Fernando de SP", partido: "PT" }],
    });
    const ba = mkUf({
      sigla: "BA",
      bucket: "chamada",
      top_candidatos: [{ id: 13, pct: 52, nome: "Jaqueline da BA", partido: "PT" }],
    });

    const textoSp =
      parse(<GovernorCard uf={sp} candidatos={nacionalColidente} />).body.textContent ?? "";
    const textoBa =
      parse(<GovernorCard uf={ba} candidatos={nacionalColidente} />).body.textContent ?? "";

    expect(textoSp).toContain("Fernando de SP");
    expect(textoSp).not.toContain("Jaqueline da BA");
    expect(textoBa).toContain("Jaqueline da BA");
    expect(textoBa).not.toContain("Fernando de SP");
  });

  it("(l) `partido` vem da linha da UF; ausente → travessão, não o do índice nacional", () => {
    const uf = mkUf({
      sigla: "SP",
      bucket: "chamada",
      top_candidatos: [{ id: 1, pct: 50, nome: "Alguém" }],
    });
    const text = parse(<GovernorCard uf={uf} candidatos={candidatos} />).body.textContent ?? "";

    expect(text).toContain("Alguém");
    expect(text).not.toContain("REP");
  });

  // -------------------------------------------------------------------
  // 2026-09-19 — de 3 para 4 candidaturas, e "Outros" migrado para o
  // campo `uf.outros` (decisão do dono; produtor em
  // `TOP_CANDIDATOS_POR_UF = 4`, `api/model/project.py`).
  //
  // O gatilho antigo era `top_candidatos.length > 3 && (100 − Σtop) > 0.5`.
  // Com o array em 3 ele nunca disparava — código morto. Com o array em 4 ele
  // dispararia SEMPRE, e a subtração devolveria o 4º colocado + o resíduo de
  // fechamento dentro de "Outros". Os três casos abaixo existem para que essa
  // volta não passe em silêncio.
  // -------------------------------------------------------------------

  it("(m) o 4º colocado é LINHA PRÓPRIA e não é absorvido por 'Outros'", () => {
    // Mata as duas mutações de uma vez:
    //   1. `.slice(0, 4)` → `.slice(0, 3)`: "Datena" some da tela.
    //   2. `showOutros = length > 3 && (100 − Σtop) > 0.5`: "Datena" continua
    //      na tela, mas "Outros" vira 8.9% (100 − 91.1) em vez de 7.3%.
    const uf = mkUf({ sigla: "SP", bucket: "chamada", outros: OUTROS_SP });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    const rows = linhas(doc);

    // 4ª linha = a candidatura, com seu próprio percentual.
    expect(rows[3]?.textContent ?? "").toContain("Datena");
    expect(rows[3]?.lastElementChild?.textContent).toBe("8%");

    // 5ª linha = o agregado, com o número que o PRODUTOR somou.
    expect(rows[4]?.textContent ?? "").toContain("Outros");
    expect(rows[4]?.lastElementChild?.textContent).toBe("7,3%");
    // 🔴 O número da subtração não pode aparecer em lugar nenhum do card —
    // nas duas pontuações, porque a troca de ponto por vírgula (2026-09-20)
    // não pode ter sido o que fez a asserção parar de discriminar.
    expect(doc.body.textContent ?? "").not.toContain("8,9%");
    expect(doc.body.textContent ?? "").not.toContain("8.9%");
  });

  it("(n) quatro candidaturas e `outros` AUSENTE → nenhuma linha 'Outros'", () => {
    // Este é o caso que o teste (f) NÃO cobre: com 4 no array, o gatilho
    // antigo (`length > 3`) dispararia e inventaria a linha. Cauda vazia é o
    // estado normal de uma corrida com ≤ 4 candidaturas — o produtor OMITE o
    // campo em vez de emitir `{ pct: 0 }` (decisão do dono, 14/09: "não há
    // mais ninguém" ≠ "os demais somam 0%").
    const uf = mkUf({ sigla: "SP", bucket: "chamada" }); // base: 4 cands, sem `outros`
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);

    expect(uf.outros).toBeUndefined();
    expect(doc.body.textContent ?? "").toContain("Datena");
    expect(doc.body.textContent ?? "").not.toContain("Outros");
    expect(linhas(doc)).toHaveLength(4);
  });

  it("(o) não normaliza: Σ(top 4) + Outros fica em 98,4 e a tela publica isso", () => {
    // Normalizar fabricaria o fechamento em 100 — mesma classe de erro da
    // subtração. Mutação alvo: qualquer reescala de `pct` (por exemplo
    // `pct * 100 / (sumTop + outros.pct)`) muda os cinco números exibidos.
    const uf = mkUf({ sigla: "SP", bucket: "chamada", outros: OUTROS_SP });
    const doc = parse(<GovernorCard uf={uf} candidatos={candidatos} />);
    // Linha a linha, e não num `textContent` do card inteiro: "8%" é
    // substring de "27.8%", então um `toContain` global passaria mesmo com a
    // 4ª linha ausente. (Foi o primeiro jeito que escrevi este teste — não
    // discriminava nada.)
    expect(pctsExibidos(doc)).toEqual(["41,2%", "27,8%", "14,1%", "8%", "7,3%"]);
  });
});
