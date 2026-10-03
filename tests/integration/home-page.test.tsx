// @vitest-environment happy-dom
/**
 * tests/integration/home-page.test.tsx
 *
 * Smoke test do `app/(pres)/page.tsx` — verifica que a home renderiza usando o
 * fixture estável e contém todos os componentes esperados (RF-021..030.6).
 *
 * Não é E2E (sem browser real). Apenas valida a árvore SSR mínima e a
 * presença de signals dos componentes principais — guard contra regressões
 * estruturais (esquecer de mountar um block).
 *
 * Nomes de candidatos são parametrizados via fixture pra evitar acoplamento
 * com nomes específicos (fixture S05 usa "Candidato PT" / "Candidato PL"
 * em vez dos nomes históricos S04 "Lula"/"Bolsonaro").
 *
 * S07/Bloco 2 (ADR-0029) — "mapa primeiro"
 *   - A ordem dos blocos mudou; o CONTEÚDO não. O teste (v) fixa a nova
 *     ordem, e o (r) continua fixando as duas invariantes estruturais
 *     (`Footer` dentro do `<main data-trilha>`).
 *   - O `<h1>` deixou de ser "Apuração Presidencial 2026" acima da dobra e
 *     passou a ser o título do painel de resultado ("Projeção Atlas Menna" /
 *     "Resultado parcial"), na escala das outras seções. Continua único.
 *   - O `<LiveBadge>` da página saiu: o selo agora mora no `<TopBar>` do
 *     shell e é alimentado pela custom property que a página publica.
 *
 * S07/Fase 2 (ADR-0018 + ADR-0019)
 *   - 1T (fixture default, 11 candidatos): hero são os seis termômetros;
 *     `HeadlineScore`, `CandidateRanking` e a agulha `national-1t` saem.
 *   - 2T: a página lê `projection-current-t2.json` quando
 *     `FIXTURE_VARIANT=t2` — o único ponto de injeção do RSC, que não recebe
 *     props. Ali o layout `binary` continua idêntico ao de S06.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/(pres)/page";
import type { EdgeCandidate } from "@/lib/edge-config/types";
import fixture from "@/tests/fixtures/edge-config/projection-current.json" with { type: "json" };
import { candidatosComProjecao, payloadNormalApurando } from "@/tests/fixtures/spec-019/payloads";

/**
 * O reader é mockado desde 2026-09-13 porque ele passou a ser a VARIÁVEL do
 * teste, não um detalhe de ambiente: a home só cai na fixture sob
 * `NODE_ENV === "development"`, e o que acontece quando o Global Config está
 * vazio depende de qual dos dois — reader e ambiente — está em qual estado.
 * Antes disso o arquivo dependia de o reader real devolver `null` por falta de
 * credencial, o que é exatamente a condição de produção que fabricava os
 * números da fixture no site público.
 */
const readNationalProjectionMock = vi.fn();
const readArchivedProjectionMock = vi.fn();
/**
 * RF-149 (spec 018) — o estado "aguardando dados" desta rota passou a ler a
 * fatia de candidaturas do Blob. Sem este mock o arquivo faz uma requisição de
 * REDE de verdade (`BLOB_PUBLIC_BASE_URL` vem do `.env.local`), que o happy-dom
 * bloqueia por CORS e que degrada para `fetch_error`: passaria, mas por
 * acidente, devagar e dependendo do mundo lá fora. `not_configured` é a
 * degradação declarada — a grade não renderiza, e o que este arquivo mede
 * continua sendo exatamente o que ele media antes.
 *
 * A grade em si é testada em `tests/unit/pages/aguardando-candidatos.test.tsx`.
 */
vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", () => ({
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: (opts?: unknown) => readArchivedProjectionMock(opts),
}));

// Top-2 names do fixture — lidos dinâmicamente pra resistir a renomes.
const FIXTURE_CANDIDATOS = (
  fixture as { national: { candidatos: Array<{ id: number; nome: string }> } }
).national.candidatos;
const NOME_TOP1 = FIXTURE_CANDIDATOS[0]?.nome ?? "Candidato PT";
const NOME_TOP2 = FIXTURE_CANDIDATOS[1]?.nome ?? "Candidato PL";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Termômetros do hero — meters dentro da seção do bloco (não os de outros
 * blocos, como o medidor de P(2T) do `<ChancesPanel />`).
 *
 * Desde 2026-09-09 o hero de `multi-1t` é o `<ResultPanel>` do kit e esta
 * função devolve zero na home; ela fica porque os testes de 2T ainda precisam
 * provar que os termômetros também NÃO aparecem lá.
 */
function termometros(doc: Document): Element[] {
  return [
    ...doc.querySelectorAll(
      'section[aria-labelledby="projecao-termometros-heading"] [role="meter"]',
    ),
  ];
}

/** As linhas de candidato do painel de resultado, na ordem do DOM. */
function linhasDeCandidato(doc: Document): Element[] {
  return [...doc.querySelectorAll('[data-testid="candidate-result-row"]')];
}

/**
 * Todo teste ABAIXO deste ponto descreve a home **em `pnpm dev`**: reader vazio
 * e fixture no lugar do dado. É o que eles sempre descreveram — o que mudou é
 * que agora isso está dito, em vez de herdado de `NODE_ENV=test` mais a
 * ausência de credencial.
 *
 * O bloco "produção sem Global Config" no fim do arquivo sobrescreve os dois.
 */
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  readNationalProjectionMock.mockReset().mockResolvedValue(null);
  readArchivedProjectionMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage (integration / smoke)", () => {
  it("(a) o h1 é o título do painel de resultado, e os top-2 da fixture aparecem", async () => {
    // Server Component async — chamamos manualmente
    const node = await HomePage();
    const html = renderToStaticMarkup(node);

    expect(html).toContain(NOME_TOP1);
    expect(html).toContain(NOME_TOP2);

    // ADR-0029 § 5: em multi-1t o <h1> é o título do PAINEL de resultado, não
    // mais um título gigante acima da dobra — e continua havendo exatamente
    // um. Os dois textos ficam no DOM; `data-view-only` (cascata do shell)
    // revela o da base ativa.
    const doc = parse(html);
    const h1s = doc.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.getAttribute("id")).toBe("resultado-heading");
    expect(h1s[0]?.textContent).toContain("Projeção Atlas Menna");
    expect(h1s[0]?.textContent).toContain("Resultado parcial");
    expect(
      [...h1s[0]!.querySelectorAll("[data-view-only]")].map((s) =>
        s.getAttribute("data-view-only"),
      ),
    ).toEqual(["parcial", "proj"]);
  });

  it("(b) contém o footer constitucional § 1", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Não oficial");
    expect(html).toContain("TSE");
  });

  it("(c) em 1T NÃO renderiza a agulha nacional (ADR-0018 — P(2T) já está no TwoRoundIndicator)", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("Forecast nacional");
  });

  // 2026-09-08 — o painel "Unidades federativas" (`<DecisiveUFsGrid>`) saiu da
  // home: não existe no protótipo do kit. A tabela agrupada ("Placar por
  // estado") ficou, por decisão explícita do usuário, e desceu para depois do
  // boletim. A asserção de "UFs decisivas" foi removida com o bloco.
  it("(d) contém a tabela agrupada por margem", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Resultados por estado");
    // siglas conhecidas do fixture
    expect(html).toContain(">SP<");
    expect(html).toContain(">MG<");
  });

  it("(e) contém ForecastTransparency (constituição § 8)", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).toContain("O que está movendo o forecast");
  });

  // 2026-09-09 — em `multi-1t` o `<ApuracaoMeta>` deixou de ser um bloco: o
  // percentual apurado virou a `<Figure>` "Apurado" do `<ResultPanel>`, com a
  // nota "X de Y votos válidos" do kit. O par "UFs apuradas Y/27" e o
  // "HH:MM:SS" saíram deste painel; o horário continua na página, no
  // `<BulletinPanel>`, e o `<ApuracaoMeta>` continua íntegro no modo `binary`.
  it("(f) a figura 'Apurado' traz o percentual e o par apurado/projetado de votos", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const texto = doc.body.textContent ?? "";

    expect(texto).toContain("Apurado");
    // Fixture: 23,4% apurado, Σ votos_atuais = 33.475.321 → 143,1 mi projetados.
    expect(texto).toContain("23,4");
    expect(texto).toContain("33,5 mi de 143,1 mi votos válidos");
  });

  it("(g) publica o rótulo de apuração que alimenta o selo do TopBar (ADR-0029 § 4)", async () => {
    // O selo migrou para o `<TopBar>`, que é do layout e não lê dado. A ponte
    // é uma custom property em `:root` — ver `components/layout/ShellLiveBadge.tsx`.
    const node = await HomePage();
    const html = renderToStaticMarkup(node);

    // React NÃO escapa entidades dentro de `<style>` (verificado no markup
    // gerado) — se algum dia passar a escapar, `&quot;` chegaria ao CSS como
    // seis caracteres literais e a regra inteira quebraria em silêncio. Daí a
    // asserção ser sobre o literal exato, com aspas.
    const m = html.match(/--live-pct-label:"([^"]*)"/);
    expect(m, "a página precisa publicar --live-pct-label para o selo do TopBar").not.toBeNull();
    // Fixture: 23,4% apurado.
    expect(m?.[1]).toBe("23,4% apurado");
    // E o valor sanitizado nunca pode fechar o literal CSS.
    expect(m?.[1]).not.toMatch(/["\\]/);
  });

  // -------------------------------------------------------------------------
  // S05/F4 — Multi-candidato (Fase 4: pages dispatch + integração)
  // Fixture é 1T (turno=1) com 11 candidatos e P(2T)=0.65 → modo multi-1t.
  // -------------------------------------------------------------------------

  it("(h) TurnoBadge mostra '1º turno' no header (multi-1t)", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).toContain("1º turno");
    expect(html).toContain('aria-label="Turno atual: 1º turno"');
  });

  it("(i) RaceTypeIndicator mostra contagem de candidatos em 1T", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    // Fixture S05 tem 11 candidatos com pct >= 0,5% (todos passam o
    // threshold de 0,5% do RaceTypeIndicator em 1T).
    expect(html).toMatch(/Disputa entre \d+ candidatos/);
  });

  it("(j) P(2T)=65% é lida no ChancesPanel, e o TwoRoundIndicator não volta", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    // 2026-09-08 (ADR-0033, D19): o `TwoRoundIndicator` saiu da home. Ele
    // exibia `p_segundo_turno_overall` — a MESMA métrica do primeiro medidor
    // do `ChancesPanel`, que o protótipo (`App.jsx:350`) põe logo abaixo. A
    // home mostrava 65% duas vezes, a dois blocos de distância.
    // O dado continua na página, agora num lugar só.
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="65"');
    expect(html).toContain("Chance de ir ao 2º turno");
    // A frase do indicador removido não pode reaparecer.
    expect(html).not.toContain("65% de chance de ir a 2º turno");
  });

  // -------------------------------------------------------------------------
  // 2026-09-20 — QUEM o painel de chances nomeia acompanha a base ativa
  //
  // Mesma decisão do dono que fez o `<ResultPanel>` reordenar ("tudo acompanha
  // a base ativa"), e o mesmo defeito que já foi fechado na tela de Senador.
  // Aqui ele era pior: a home nomeava quem tem `rank === 1` — o rank de
  // PROJEÇÃO publicado pelo produtor —, então na visualização "Parcial" a
  // lista podia pôr B em primeiro e o painel, logo abaixo, dizer "A vence no
  // 1º turno". É a corrida de maior audiência do produto.
  //
  // A fixture separa as duas leituras de ponta a ponta:
  //   projeção → CANDIDATA TREZE (41,2%), `p_fecha_1t` 0,34
  //   contagem → CANDIDATO VINTE E DOIS (55% apurado), `p_fecha_1t` 0,07
  // -------------------------------------------------------------------------
  function candidatosComLideresDiferentes(): EdgeCandidate[] {
    return candidatosComProjecao().map((c, i) => {
      // Lidera a PROJEÇÃO e não a contagem.
      if (i === 0) return { ...c, pct_atual: 20 };
      // Lidera a CONTAGEM. `p_fecha_1t` != 0 de propósito: com 0 o teste
      // passaria mesmo se o painel ignorasse a candidatura e mostrasse um
      // medidor vazio.
      if (i === 1) return { ...c, pct_atual: 55, p_fecha_1t: 0.07 };
      return c;
    });
  }

  const medidorDe = (el: Element | null | undefined) => el?.querySelector('[role="meter"]');
  const notaDe = (el: Element | null | undefined) =>
    el?.querySelector('[data-testid="probability-meter-note"]')?.textContent ?? "";

  it("(j2) o nome anunciado acompanha a base — e leva junto o número DELE", async () => {
    readNationalProjectionMock.mockResolvedValue(
      payloadNormalApurando({ candidatos: candidatosComLideresDiferentes() }),
    );
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const painel = doc.querySelector('[data-testid="chances-panel-meters"]');
    const parcial = painel?.querySelector('[data-view-only="parcial"]');
    const proj = painel?.querySelector('[data-view-only="proj"]');

    expect(parcial, "medidor da base parcial").not.toBeNull();
    expect(proj, "medidor da base projeção").not.toBeNull();

    // 🔴 O par (nome, probabilidade) de CADA base sai do MESMO registro. É
    // este assert que impede a frase falsa: "CANDIDATO VINTE E DOIS vence no
    // 1º turno — 34%" seria o nome de quem lidera a contagem com a
    // probabilidade de quem lidera a projeção.
    expect(medidorDe(parcial)?.getAttribute("aria-label")).toBe(
      "CANDIDATO VINTE E DOIS vence no 1º turno",
    );
    expect(medidorDe(parcial)?.getAttribute("aria-valuenow")).toBe("7");
    expect(medidorDe(proj)?.getAttribute("aria-label")).toBe("CANDIDATA TREZE vence no 1º turno");
    expect(medidorDe(proj)?.getAttribute("aria-valuenow")).toBe("34");

    // E o percentual projetado da nota também: 33,7% é o da candidatura
    // nomeada na parcial; 41,2% é o da outra, e não pode vazar para cá.
    expect(notaDe(parcial)).toContain("Projeção 33,7%");
    expect(notaDe(parcial)).not.toContain("41,2%");
    expect(notaDe(proj)).toContain("Projeção 41,2%");

    // 🔴 Fecha o laço com a LISTA de cima, que é o bloco com que o painel
    // discordava: em cada base, quem o painel nomeia é quem a lista põe em 1º.
    const linhas = [...doc.querySelectorAll("[data-ord]")];
    const primeiraEm = (base: "parcial" | "proj") =>
      linhas.find((li) => (li.getAttribute("style") ?? "").includes(`--ord-${base}:0`))
        ?.textContent;
    expect(primeiraEm("parcial")).toContain("CANDIDATO VINTE E DOIS");
    expect(primeiraEm("proj")).toContain("CANDIDATA TREZE");
  });

  it("(j3) a nota nomeia o CANDIDATO, não 'o líder' — a frase segue verdadeira nas duas bases", async () => {
    // Enquanto o painel só falava de quem lidera a projeção, "a projeção do
    // líder fecha 50% + 1" era inofensivo. Com o nome acompanhando a base, na
    // parcial o nomeado lidera a CONTAGEM e pode não liderar a projeção — e o
    // anafórico passaria a apontar para outra pessoa dentro da mesma frase.
    readNationalProjectionMock.mockResolvedValue(
      payloadNormalApurando({ candidatos: candidatosComLideresDiferentes() }),
    );
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const painel = doc.querySelector('[data-testid="chances-panel-meters"]');

    for (const base of ["parcial", "proj"] as const) {
      const nota = notaDe(painel?.querySelector(`[data-view-only="${base}"]`));
      expect(nota, base).toContain("a projeção deste candidato fecha 50% + 1");
      expect(nota, base).not.toContain("a projeção do líder");
    }
  });

  it("(j4) bases que nomeiam a MESMA candidatura não duplicam medidor", async () => {
    // Contraprova de (j2): na fixture normal `pct_atual` e `pct_projetado`
    // apontam para a mesma pessoa, e o DOM tem de continuar sendo o de antes.
    readNationalProjectionMock.mockResolvedValue(payloadNormalApurando());
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const painel = doc.querySelector('[data-testid="chances-panel-meters"]');

    expect(painel?.querySelectorAll("[data-view-only]").length).toBe(0);
    // Os dois do protótipo: P(2º turno) + o do líder. Nem um a mais.
    expect(painel?.querySelectorAll('[role="meter"]').length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 2026-09-09 — o hero de `multi-1t` é o `<ResultPanel>` do kit (App.jsx:20).
  // Os seis termômetros do ADR-0018 saíram DESTA rota (seguem nas três outras)
  // e, com eles, brancos/nulos e abstenção — consequência declarada e aceita
  // pelo usuário. O que substitui os testes (k)/(k2)/(l) é a prova de que o
  // painel novo mostra a corrida inteira, com o colapso sendo só visual.
  // -------------------------------------------------------------------------

  it("(k) hero 1T = painel de resultado do kit, sem termômetros nesta rota", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));

    expect(termometros(doc)).toHaveLength(0);
    expect(doc.querySelector('[id^="termometro-"]')).toBeNull();

    // Duas figuras no topo do painel: "Apurado" e "Margem <primeiro nome>".
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("Apurado");
    expect(texto).toContain(`Margem ${NOME_TOP1.split(" ")[0]}`);
    // Barra de maioria com marcador em 50%, uma por base.
    expect(doc.querySelectorAll('[data-testid="vote-bar-marker"]')).toHaveLength(2);
  });

  it("(k2) as duas bases da margem ficam no HTML; a cascata revela a ativa", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));

    const parcial = doc.querySelector('[data-testid="result-margem-parcial"]');
    const proj = doc.querySelector('[data-testid="result-margem-proj"]');
    expect(parcial).not.toBeNull();
    expect(proj).not.toBeNull();
    // Fixture: 43,5 − 38,2 = 5,3 pp parcial; 43,2 − 38,0 = 5,2 pp projetado.
    expect(parcial?.textContent).toContain("+5,3");
    expect(parcial?.textContent).toContain("projeção +5,2 pp");
    expect(proj?.textContent).toContain("+5,2");
  });

  it("(l) TODOS os 11 candidatos da fixture ficam no DOM (ADR-0017 + D21)", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    const doc = parse(html);

    // Uma linha por candidato — inclusive os oito de rank >= 4, que antes
    // viviam num bloco "Composição de Outros" separado.
    expect(linhasDeCandidato(doc)).toHaveLength(FIXTURE_CANDIDATOS.length);
    for (const c of FIXTURE_CANDIDATOS) {
      expect(html).toContain(c.nome);
    }

    // O colapso do kit é aceito como efeito VISUAL (decisão D21) e só isso: as
    // linhas excedentes seguem no DOM, sem `hidden`, sem `<details>` e sem
    // `display: none` — o que os ADRs 0017 / 0029 § 7 / 0033 § 2 proíbem é a
    // remoção de nós, que é o que o kit faz (`rows.slice(0, limit)`).
    const botao = doc.querySelector('main [data-testid="button"][aria-expanded]');
    expect(botao?.textContent).toContain(`Todos os ${FIXTURE_CANDIDATOS.length} candidatos`);
    // O escopo é `[data-testid="panel"] details`, e não `main details`, desde
    // 2026-09-13: o `<details>` "debug: composition" do fim da página é filho
    // DIRETO do `<main>` e só existe sob `NODE_ENV === "development"` — que é
    // o ambiente que este arquivo agora declara explicitamente. A afirmação
    // sempre foi sobre a LISTA DE CANDIDATOS, que vive dentro de um `<Panel>`;
    // o alvo apertou, o que ela prova não mudou.
    expect(doc.querySelector('main [data-testid="panel"] details')).toBeNull();
    expect(doc.querySelector("main [hidden]")).toBeNull();
    expect(doc.querySelectorAll("main [data-extra-row]")).toHaveLength(
      FIXTURE_CANDIDATOS.length - 6,
    );
  });

  it("(m) em 1T o HeadlineScore e o CandidateRanking saem do fluxo (ADR-0018)", async () => {
    const node = await HomePage();
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain("headline-score-heading");
    expect(html).not.toMatch(/lidera, Candidato MDB briga pela 2ª vaga/);
    // O rank 3 continua visível — mas como termômetro do hero.
    expect(html).toContain("Candidato MDB");
  });

  it("(n) <main data-trilha='pres'> + kicker da trilha presidencial (ADR-0019)", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("pres");
    const kicker = doc.querySelector("[data-trilha-kicker]");
    expect(kicker?.getAttribute("data-trilha-kicker")).toBe("pres");
    expect(kicker?.textContent?.replace(/\s+/g, " ").trim()).toBe("PRESIDÊNCIA · Brasil");
  });

  // -------------------------------------------------------------------------
  // S07/Bloco 1 (ADR-0025) — gramática editorial: seções em <Panel>, três
  // blocos novos, e as duas invariantes estruturais da página.
  // -------------------------------------------------------------------------

  it("(r) o <Footer> continua DENTRO do <main data-trilha> desta página", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));

    const main = doc.querySelector("main[data-trilha]");
    expect(main).not.toBeNull();
    // A pergunta não é "existe um footer", é "ele está dentro do main" — o
    // shell global (app/layout.tsx) não fornece nenhum dos dois.
    const footer = main?.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("Não oficial");
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
  });

  it("(s) todo bloco do fluxo está dentro de um <Panel>, e nenhum Panel fica vazio", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));

    const panels = Array.from(doc.querySelectorAll('[data-testid="panel"]'));
    expect(panels.length).toBeGreaterThanOrEqual(8);
    for (const p of panels) {
      // Um Panel sem conteúdo desenharia um filete órfão — é exatamente o que
      // acontece se um bloco com gate próprio (RunoffScenarios) for envolvido
      // sem consultar o gate antes.
      expect((p.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("(t) os três blocos novos renderizam com dado do fixture", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const texto = doc.body.textContent ?? "";

    // Boletim (RF-026 + RF-044 por template)
    expect(doc.querySelector("#bulletin-panel-heading")?.textContent).toBe(
      "O que está acontecendo agora",
    );
    expect(doc.querySelectorAll('[data-testid="bulletin-list"] > li').length).toBeGreaterThan(0);

    // Redutos (RF-024 / RF-030.6) — desde 2026-09-10 é uma fileira de pílulas
    // (uma por candidato, até 5) e UMA tabela: a do candidato selecionado,
    // como no protótipo. As três colunas simultâneas de antes não cabiam na
    // coluna de painéis de 400px (ADR-0033 § 1).
    expect(doc.querySelector("#strongholds-panel-heading")?.textContent).toBe(
      "Onde cada candidato é mais forte",
    );
    expect(doc.querySelectorAll('[data-testid="stronghold-column"]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-testid="stronghold-chip"]').length).toBeGreaterThanOrEqual(
      2,
    );

    // O que falta apurar (RF-026 / RF-024)
    expect(doc.querySelector("#remaining-panel-heading")?.textContent).toBe(
      "O que ainda falta apurar",
    );
    expect(doc.querySelectorAll('[data-testid="remaining-table"] tbody tr').length).toBeGreaterThan(
      0,
    );

    // Fixture: 23,4% apurado → 76,6% por apurar; 14/27 UFs com boletim.
    expect(texto).toContain("76,6%");
  });

  it("(u) a projeção segue rotulada como não oficial já no kicker da 1ª seção (constituição § 1)", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const kickers = Array.from(doc.querySelectorAll('[data-testid="panel-kicker"]')).map(
      (k) => k.textContent,
    );
    expect(kickers[0]).toBe("Projeção Atlas Menna · não oficial");
  });

  // -------------------------------------------------------------------------
  // S07/Bloco 2 (ADR-0029) — mapa primeiro.
  // -------------------------------------------------------------------------

  // ADR-0033 § 1 emenda a asserção original destes dois testes. O mapa deixou
  // de ser um bloco desta página e virou a coluna persistente do
  // `<AppShellSplit>`, montada por `app/(pres)/layout.tsx` — quem fixa a
  // moldura agora é `tests/unit/shell/persistent-map-frame.test.tsx`. A ordem
  // interna do `<main>` (kicker → painel com o `<h1>` → termômetros → rodapé)
  // continua sendo a do ADR-0029 e continua fixada aqui.
  it("(v) o mapa saiu da página, e a ordem dentro do `<main>` é a do ADR-0029", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const main = doc.querySelector("main[data-trilha]");
    expect(main).not.toBeNull();

    // 1. Nenhum mapa nesta página. Um segundo choropleth nacional aqui seria o
    //    mesmo mapa duas vezes na mesma tela, e um segundo chunk do MapLibre.
    expect(doc.querySelector('[aria-label="Mapa coroplético do Brasil"]')).toBeNull();
    expect(doc.querySelector('[data-testid="map-view-toggle"]')).toBeNull();

    // 2. Índice de cada marcador na ordem do DOM dentro do <main>.
    const html = main?.innerHTML ?? "";
    const at = (marcador: string) => {
      const i = html.indexOf(marcador);
      expect(i, `marcador ausente: ${marcador}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    const kicker = at("data-trilha-kicker");
    const painel = at("Projeção Atlas Menna · não oficial");
    // 2026-09-09: o marcador de "primeiro conteúdo do painel" deixou de ser o
    // heading dos termômetros e passou a ser a primeira linha de candidato.
    const listaDeCandidatos = at("candidate-result-row");
    // Spec 020 — o bloco de evolução da apuração entrou no fluxo em 17/09,
    // abaixo do painel de resultado e acima do rodapé. Está na ordem esperada
    // desde então; o slot exato é fixado pelo teste (v2), logo abaixo.
    const serie = at('data-testid="serie-apuracao-chart"');
    const rodape = at("Não oficial. Fonte:");

    // TrilhaKicker imediatamente acima do painel que carrega o <h1>
    // (ADR-0019 preservado dentro da nova ordem).
    expect(kicker).toBeLessThan(painel);
    expect(painel).toBeLessThan(listaDeCandidatos);
    expect(listaDeCandidatos).toBeLessThan(serie);
    // O rodapé constitucional continua fechando a página.
    expect(serie).toBeLessThan(rodape);
  });

  /**
   * Spec 020 / RF-174 — o SLOT do bloco, não a presença dele.
   *
   * "Presente" passaria com o bloco em qualquer lugar da página, inclusive
   * acima do painel de resultado — que é o único lugar onde ele não pode
   * estar, porque lá vive o `<h1>`. Por isso as três asserções abaixo são
   * posicionais e a quarta reconta os `<h1>`.
   */
  it("(v2) a evolução da apuração fica ENTRE as chances e os redutos (slot T-01)", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const html = doc.querySelector("main[data-trilha]")?.innerHTML ?? "";
    const at = (marcador: string) => {
      const i = html.indexOf(marcador);
      expect(i, `marcador ausente: ${marcador}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    const chances = at('data-testid="chances-panel-meters"');
    const serie = at('data-testid="serie-apuracao-chart"');
    const redutos = at("strongholds-panel-heading");

    expect(chances).toBeLessThan(serie);
    expect(serie).toBeLessThan(redutos);

    // Sem série publicada (Fase 0 da spec), o bloco não desenha traçado nem
    // percentual nenhum — e mesmo assim NÃO some do DOM (ADR-0017).
    expect(doc.querySelector('[data-testid="serie-apuracao-chart"]')).not.toBeNull();
    expect(doc.querySelectorAll("[data-traco]")).toHaveLength(0);

    // 🔴 A contagem de `<h1>` não pode mudar: o bloco novo não é um heading de
    // página e nunca sobe acima do painel de resultado.
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.getAttribute("id")).toBe("resultado-heading");
  });

  it("(x) o painel de resultado é o PRIMEIRO conteúdo da coluna que rola", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    // O painel de resultado abre a página: é o bloco de maior valor
    // informativo, e a recomposição de 09/09 é a mudança mais provável de o
    // empurrar para baixo por acidente.
    const primeiro = doc.querySelector('main [data-testid="panel"]');
    expect(primeiro?.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe(
      "Projeção Atlas Menna · não oficial",
    );
    expect(primeiro?.querySelector("h1")?.getAttribute("id")).toBe("resultado-heading");
  });

  it("(y) 'Composição de Outros' traz parcial E projeção por candidato (ADR-0029 § 7)", async () => {
    const node = await HomePage();
    const doc = parse(renderToStaticMarkup(node));
    const linhas = [...doc.querySelectorAll("[data-testid='candidate-result-row']")];

    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      // 🔴 2026-09-20 (2ª rodada), refeito em 2026-09-27 (versão D): os DOIS
      // números continuam no HTML servido, que é o que este caso guarda — o
      // apurado grande sob `data-view-only="parcial"`, e o projetado grande +
      // "apurado X%" sob `data-view-only="proj"`.
      expect(linha.querySelector('[data-view-only="parcial"]')?.textContent).toMatch(/%/);
      expect(linha.querySelector('[data-view-only="proj"]')?.textContent).toMatch(/%.*apurado .*%/);
    }
    // Versão D — a home pede o selo de turno: ele existe, só nos dois cartões
    // de cada base, e sempre diz de que base vem (constituição § 1).
    const selos = [...doc.querySelectorAll('[data-testid="result-selo"]')];
    for (const base of ["parcial", "proj"]) {
      const n = doc.querySelectorAll(
        `[data-view-only="${base}"] > [data-testid="result-selo"]`,
      ).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
    for (const s of selos) expect(s.textContent).toMatch(/· (projeção|na parcial)$/);
    // E nada de collapsible entrou junto com o formato do kit (ADR-0017).
    // Escopado ao `<Panel>` pelo mesmo motivo do teste (l): o `<details>` de
    // debug é filho direto do `<main>` e é dev-only.
    expect(doc.querySelector('main [data-testid="panel"] details')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // S07/Fase 2 — modo binary (2º turno) permanece o layout de S06.
  // -------------------------------------------------------------------------

  describe("modo binary (2º turno, FIXTURE_VARIANT=t2)", () => {
    it("(o) renderiza a agulha nacional e o HeadlineScore, sem termômetros", async () => {
      vi.stubEnv("FIXTURE_VARIANT", "t2");
      const node = await HomePage();
      const doc = parse(renderToStaticMarkup(node));

      expect(doc.body.textContent).toContain("Forecast nacional");
      expect(doc.querySelector("#headline-score-heading")).not.toBeNull();
      expect(doc.body.textContent).not.toContain("Projeção do 1º turno");
      expect(termometros(doc)).toHaveLength(0);
      expect(doc.querySelector('[id^="termometro-"]')).toBeNull();
    });

    it("(p) badge de 2º turno e trilha presidencial preservados", async () => {
      vi.stubEnv("FIXTURE_VARIANT", "t2");
      const node = await HomePage();
      const doc = parse(renderToStaticMarkup(node));

      expect(doc.body.textContent).toContain("2º turno");
      expect(doc.querySelector("main")?.getAttribute("data-trilha")).toBe("pres");
      // O <h1> continua sendo o do HeadlineScore — e continua único.
      expect(doc.querySelectorAll("h1")).toHaveLength(1);
      expect(doc.querySelector("h1")?.getAttribute("id")).toBe("headline-score-heading");
    });

    it("(q) 'Composição de Outros' não aparece em 2T (só há dois candidatos)", async () => {
      vi.stubEnv("FIXTURE_VARIANT", "t2");
      const node = await HomePage();
      const html = renderToStaticMarkup(node);
      expect(html).not.toContain("Composição de Outros");
    });
  });
});

/**
 * ===================================================================
 * A home em PRODUÇÃO com o Global Config vazio — o defeito de 13/09
 * ===================================================================
 *
 * Em 13/09/2026 `https://atlasmenna.online` (público, sem login) publicava
 * "Candidato PT — 15.240.321 votos — 43,5%" e "23,4% APURADO" com a eleição
 * marcada para 04/10. Eram, byte a byte, os números de
 * `tests/fixtures/edge-config/projection-current.json`: `getInitialPayload()`
 * caía na fixture de forma INCONDICIONAL, e o store de produção estava vazio,
 * então caía sempre.
 *
 * É o padrão "rede de segurança de mão única" já catalogado neste projeto: o
 * fallback devia DEGRADAR e em vez disso FABRICOU dado com cara de verdadeiro.
 * A guarda existente (`NODE_ENV`) protegia `/governador`, `/senador` e
 * `/deputado-federal`, e ninguém conferiu se a home tinha a mesma.
 *
 * Os testes abaixo provam a DIREÇÃO, não a forma. Cada um nomeia a mutação que
 * deve derrubá-lo; asserções em string literal dos números da fixture, porque é
 * a regressão literal que precisa ser pega.
 */
describe("HomePage — produção sem Global Config (defeito 2026-09-13)", () => {
  /** Os números que apareceram no site público. Literais de propósito. */
  const NUMEROS_DA_FIXTURE = ["Candidato PT", "Candidato PL", "15.240.321", "23,4", "43,5"];

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    readNationalProjectionMock.mockReset().mockResolvedValue(null);
    readArchivedProjectionMock.mockReset().mockResolvedValue(null);
  });

  it("(z1) reader vazio: NENHUM número da fixture chega ao HTML", async () => {
    // Mutação que deve derrubar: voltar o `?? fixturePayload()` incondicional
    // em `getInitialPayload()`.
    const html = renderToStaticMarkup(await HomePage());

    for (const numero of NUMEROS_DA_FIXTURE) {
      expect(html).not.toContain(numero);
    }
  });

  it("(z2) reader vazio: a fixture não entra nem por `FIXTURE_VARIANT`", async () => {
    // Mutação que deve derrubá-lo: guardar a fixture por `FIXTURE_VARIANT` em
    // vez de por ambiente. A env é injetável por quem controla o deploy; o
    // caminho honesto não pode depender de ela estar ausente.
    vi.stubEnv("FIXTURE_VARIANT", "t2");
    const html = renderToStaticMarkup(await HomePage());

    for (const numero of NUMEROS_DA_FIXTURE) {
      expect(html).not.toContain(numero);
    }
  });

  it("(z3) reader vazio: a home diz, em texto, que está aguardando", async () => {
    // Mutação que deve derrubá-lo: renderizar o estado vazio SEM mensagem —
    // uma tela de zeros mudos é tão desonesta quanto uma de números falsos,
    // porque zero apurado e nada publicado não são a mesma notícia.
    const doc = parse(renderToStaticMarkup(await HomePage()));

    const aviso = doc.querySelector('[data-testid="pres-aguardando"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toContain("Aguardando o primeiro boletim");
    // Constituição § 1 — o rótulo "não oficial" e a fonte não somem no estado
    // vazio.
    expect(doc.body.textContent).toContain("não oficial");
    expect(doc.body.textContent).toContain("TSE");
  });

  it("(z4) reader vazio: nenhuma contagem, nenhum relógio, nenhum placar falso", async () => {
    // Mutação que deve derrubá-lo: renderizar a página cheia a partir de um
    // payload zerado. Ali o `<BulletinPanel>` carimbaria "Boletim HH:MM:SS" com
    // a hora do BUILD ao lado de nada apurado — um segundo número inventado,
    // de outra origem, com a mesma aparência de medição.
    const doc = parse(renderToStaticMarkup(await HomePage()));
    const texto = doc.body.textContent ?? "";

    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(0);
    expect(texto).not.toContain("votos válidos");
    expect(texto).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    // O único percentual admissível nesta tela é o 0% da metodologia.
    expect(texto).not.toMatch(/[1-9]\d*,\d\s*%/);
  });

  it("(z5) reader vazio: a estrutura da página sobrevive (constituição §§ 3 e 8)", async () => {
    // Mutação que deve derrubá-lo: devolver `null`/404 quando não há payload.
    // A página não pode sumir — nem virar 500 — antes do primeiro boletim.
    const doc = parse(renderToStaticMarkup(await HomePage()));

    const main = doc.querySelector("main");
    expect(main?.getAttribute("data-trilha")).toBe("pres");
    // <h1> único, como em todos os outros estados desta rota.
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    // § 8 — o bloco de metodologia existe em toda página de apuração, mesmo
    // quando ainda não há o que apurar.
    expect(doc.body.textContent).toContain("Metodologia");
    // § 1 — o <Footer> continua DENTRO do <main> (o shell global não o dá).
    expect(main?.querySelector("footer")).not.toBeNull();
  });

  it("(z6) reader COM payload: produção não muda nada no caminho feliz", async () => {
    // Mutação que deve derrubá-lo: uma guarda que bloqueie também o dado real
    // (ex.: `if (NODE_ENV === "production") return <AguardandoNacional />`).
    // A correção só pode calar a FIXTURE, nunca o Global Config.
    readNationalProjectionMock.mockResolvedValue(fixture);
    const doc = parse(renderToStaticMarkup(await HomePage()));

    expect(doc.body.textContent).toContain(NOME_TOP1);
    expect(doc.body.textContent).toContain(NOME_TOP2);
    expect(doc.querySelector('[data-testid="pres-aguardando"]')).toBeNull();
    expect(
      doc.querySelectorAll('[data-testid="candidate-result-row"]').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("(z8) payload publicado com `candidatos: []`: também cai na tela honesta", async () => {
    // Mutação que deve derrubá-lo: estreitar o gate para só `if (!payload)`.
    //
    // Este NÃO é o defeito de 13/09 — é o vizinho dele, e a rodada de mutação
    // do código final mostrou que nada o cobria. O orchestrator pode gravar o
    // envelope antes de a lista de candidaturas estar resolvida (é o que a
    // spec 018 acabou de mexer: identidade de candidatura vem do portal de
    // dados abertos, por um caminho diferente do boletim). Com a lista vazia e
    // sem este gate, a home monta a ESTRUTURA do placar sem nada dentro:
    // "Apurado 0%", "0 votos válidos apurados", barra de maioria e o
    // `<BulletinPanel>` carimbando o `ts` do ciclo. Forma de medição sem
    // medição — a mesma mentira da fixture, com outra origem.
    readNationalProjectionMock.mockResolvedValue({
      ...fixture,
      pct_apurado_total: 0,
      national: { ...(fixture as { national: object }).national, candidatos: [] },
    });
    const doc = parse(renderToStaticMarkup(await HomePage()));

    expect(doc.querySelector('[data-testid="pres-aguardando"]')).not.toBeNull();
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(0);
    expect(doc.body.textContent).not.toContain("votos válidos");
    // E o `ts` do payload não vira "Boletim HH:MM:SS" numa tela sem apuração.
    expect(doc.body.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("(z7) `NODE_ENV=development` com reader vazio: a fixture CONTINUA entrando", async () => {
    // Mutação que deve derrubá-lo: guardar por algo que também bloqueie dev
    // (`if (false)`, ou gate por `VERCEL_ENV` que em `pnpm dev` é undefined).
    // `pnpm dev` sem credencial Vercel precisa continuar inspecionável.
    vi.stubEnv("NODE_ENV", "development");
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain(NOME_TOP1);
    expect(html).toContain("15.240.321");
  });
});
