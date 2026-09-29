---
title: Design Tokens
description: Design system Atlas Menna — tipografia (Spectral/Archivo/JetBrains Mono), primitivos do kit (papel/tinta), accent ocre, cores de status, cores de partido/federação (paleta editorial), espaçamento, layout
status: stable
source: Bloco 1 do redesign (ADR-0024, ADR-0025)
last_updated: 2026-09-20
---

# Design Tokens

> **Onde cada token mora de verdade** (verificado em 2026-09-07, Bloco 1 do redesign Atlas Menna):
> **Cores, layout, fontes e espaçamento** são custom properties em `app/globals.css`, organizadas
> em um bloco `@theme static { … }` do Tailwind v4 (ADR-0025 § 3). O `static` é **obrigatório**:
> sem ele, o Tailwind v4 descarta variáveis que não aparecem em nenhuma classe utilitária.
> `lib/utils/cand-color.ts`, `lib/utils/party-color.ts` e MapLibre paint properties leem tokens
> por `getComputedStyle` em hex literal — sem `static`, o mapa fica cinza em silêncio e o party
> picker não resolveria cores.
>
> **Fora do `@theme static`** (em `:root` puro, por limitação de namespace):
> `--font-{serif,sans,mono}-src` — fontes injeta pelo `next/font` em `app/layout.tsx`;
> `--trilha-accent`/`--trilha-accent-soft` — cascata condicional por cargo (redefinidas por
> `main[data-trilha="..."]` em cada página).
>
> A **escala tipográfica** em Bloco 1 deixa de ser default do Tailwind v4 e passa a ser do
> **design system Atlas Menna**, com a mesma estrutura (12px xs… 64px 5xl) mas nomes e pesos
> novo (Spectral 400/600, Archivo 400, JetBrains Mono 400). O **espaçamento** e **breakpoints**
> seguem o default do Tailwind v4 — nenhuma customização.
> O bloco abaixo está anotado por origem.

## Fontes — Design system Atlas Menna

Carregadas via `next/font/google` em `app/layout.tsx`:

| Fonte | Peso | Uso | Variável |
|---|---|---|---|
| **Spectral** | 400, 600 | Títulos e display editorial (NYT-like) | `--font-serif-src` → `--font-serif` |
| **Archivo** | 400 | Corpo, UI | `--font-sans-src` → `--font-sans` |
| **JetBrains Mono** | 400 | Números em tabelas (tabulares) | `--font-mono-src` → `--font-mono` |

Global: `font-variant-numeric: tabular-nums` garante alinhamento vertical em contadores e tabelas.

---

## Primitivos do kit — Bloco 1

Cores base, contrastes medidos em 2026-09-07:

```css
/* app/globals.css — primitivos do kit em `@theme static` (ADR-0025 § 1) */
@theme static {
  /* Papel e tinta (base de luminância) */
  --paper-0: #fbfbfc;     /* fundo principal | LCP 0% */
  --paper-1: #f3f4f6;     /* alternativo · conta em @apply | fundo de card/panel */
  --paper-2: #e9ebee;     /* secundário · LCP elevada | fundo de input com focus */
  --paper-3: #dde0e4;     /* terciário · legado para bordas elevadas | não usado em Bloco 1 */

  /* Tinta — hierarquia de luminância */
  --ink-0: #14171b;       /* primária · 16.34:1 sobre paper-1; 17.38 sobre paper-0 | uso: texto principal */
  --ink-1: #2a2f36;       /* secundária · 12.25:1 sobre paper-1 | uso: texto de suporte */
  --ink-2: #5b636e;       /* terciária · 5.52:1 sobre paper-1 · WCAG AA | uso: texto muted OK */
  --ink-3: #8c949e;       /* decorativa · 2.79:1 sobre paper-1 | **REPROVA AA** — só ícones/bordas, nunca texto */

  /* Filete */
  --rule: #c9cdd3;        /* border padrão | ligação de papel */
  --rule-strong: #14171b; /* border de focus/active */

  /* Accent ocre — projeção, estado ao vivo, foco (narrativa central do design) */
  --accent: #c98a2b;           /* 2.67:1 sobre paper-1 | **uso: preenchimento e traço, nunca texto** */
  --accent-strong: #9e6a1c;    /* 4.21:1 sobre paper-1 | uso: hover/borda */
  --accent-text: #8e5d18;      /* 5.12:1 sobre paper-1; 5.45 sobre paper-0 · WCAG AAA | **uso: texto editorial do par "Parcial×Projeção"** */
  --accent-soft: #f4e7cf;      /* fundo suave acima do accent |  preenchimento de áreas highlight */
  --accent-ink: #3f2a08;       /* tinta sobre accent-soft */

  /* Status */
  --status-live: #c98a2b;      /* ao vivo = accent; no 1º turno é ao vivo, no 2º turno permanece como histórico */
  --status-final: #2f7d4f;     /* 4.58:1 sobre paper-1 | **uso: texto branco em fundo sólido, ver --color-success-strong** */
  --status-warn: #b4432f;      /* 5.04:1 sobre paper-1 | **uso: texto branco em fundo sólido, ver --color-warning-strong** */

  /* Mapa — hex literal, lido pelo MapLibre e party-color.ts */
  --map-stroke: #fbfbfc;       /* borda de UF/zona sobre PMTiles |  = paper-0 */
  --map-stroke-focus: #14171b; /* borda ao hover/seleção | = ink-0 */
  --map-uncounted: #e1e4e8;    /* fill de região sem dado | cinza neutro */

  /* Sombras */
  --shadow-float: 0 8px 24px rgba(20, 23, 27, 0.14);   /* card/tooltip descansando */
  --shadow-sheet: 0 -6px 20px rgba(20, 23, 27, 0.12);  /* bottom sheet subindo */

  /* Espaço */
  --space-1: 4px;     --space-2: 8px;     --space-3: 12px;    --space-4: 16px;
  --space-5: 20px;    --space-6: 24px;    --space-8: 32px;    --space-10: 40px;
  --space-12: 48px;   --space-16: 64px;

  /* Layout */
  --radius-xs: 2px;        /* borda sutil (input, seletor de data) */
  --radius-sm: 4px;        /* padrão (card, panel) */
  --radius-md: 8px;        /* relaxado (button hover, toolbar) */
  --radius-pill: 999px;    /* comprimido (badge, pill button) */

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);   /* easing material (entrada de drawer/tooltip) */
  --dur-fast: 120ms;                            /* duração padrão (fade de ícone, toggle) */

  /* Container */
  --container-page: 1280px;  /* max-width das 7 páginas (/, /uf/[sigla], /governador, /uf/[sigla]/governador, /sobre-o-modelo, /senador, /deputado-federal) */

  /* Cores neutras legadas — remapeadas em termos dos primitivos acima */
  --color-bg: var(--paper-0);
  --color-bg-muted: var(--paper-1);
  --color-text: var(--ink-0);
  --color-text-muted: var(--ink-2);
  --color-text-faint: #626a75;  /* 4.97:1 sobre paper-1 | texto desabilitado/placeholder OK */
  --color-border: var(--rule);


  /* Cores candidato por rank — LEGADO S05/F2. Mapping é por rank de apuração, não por
   * sigla — o rank muda durante a noite conforme candidatos atingem 1% da apuração.
   * Não usar em specs novas; usar --party-* em vez disso (constituição § 2 v1.3, ADR-0024).
   *
   * ⚠️ 2026-09-19: a justificativa "backward compat com specs 003/004" CAIU — as duas
   * specs afirmavam cor por posição, o que contradizia a norma desde 07/09, e foram
   * corrigidas. O único uso vivo destes tokens hoje é FALLBACK de sigla sem token
   * próprio, dentro de candidateColor/candidateMarkerColor. Nenhum componente os lê
   * direto: tests/unit/components/cor-nunca-da-posicao.test.ts (não por-payload)
   * varre components/ + app/ + lib/ e reprova. Remoção é limpeza pós-2º turno
   * (ADR-0013 § Status). */
  --color-pt: #d33732;  /* rank 1 — alias de --party-pt-3 */
  --color-pl: #2a52be;  /* rank 2 — alias de --party-pl-3 */
  --color-tossup: #d9d9d9;
  --color-pt-band: #c8d4ed;  /* banda clara de rank 1 — **note: invertida historicamente** */
  --color-pl-band: #f0c9c8;  /* banda clara de rank 2 — **note: invertida historicamente** */

  /* Multi-candidato (ADR-0013, S05/F2) — LEGADO por backward compat 003/004, substituído
   * por --party-* em specs novas (constituição § 2). Ver § "Paleta multi-candidato" */
  --color-cand-1: #d33732;   /* mesmo hex de --color-pt */
  --color-cand-2: #2a52be;   /* mesmo hex de --color-pl */
  --color-cand-3: #c97c1f;
  --color-cand-4: #4a8b3e;
  --color-cand-5: #7d4a8c;
  --color-cand-6: #5c5448;
  --color-cand-other: #6e6e6e;

  /* Versões "strong" — quando o token base não dá 4.5:1 em texto pequeno */
  --color-cand-1-strong: #a8221d;
  --color-cand-2-strong: #1d3a8a;
  --color-cand-3-strong: #9a5d12;
  --color-cand-4-strong: #346129;
  --color-cand-5-strong: #5a3568;
  --color-cand-6-strong: #3f3a32;

  /* Bands — hex explícito desde 2026-09-05 (antes aliasavam os tokens
   * partidários invertidos; ver § "Defeitos conhecidos") */
  --color-cand-band-1: #f0c9c8;  /* clareado de --color-cand-1 (#d33732) */
  --color-cand-band-2: #c8d4ed;  /* clareado de --color-cand-2 (#2a52be) */
  --color-cand-band-3: #ecd4b3;
  --color-cand-band-4: #c8dec1;
  --color-cand-band-5: #d7c5dd;
  --color-cand-band-6: #d4cfc2;
  --color-cand-band-other: #d9d9d9;

  /* Bandas de probabilidade da agulha (spec 003 + spec 004) — mapeiam
   * `NeedleBand` em lib/edge-config/types.ts. Cinzas neutros, sem cor
   * partidária: usados pelo <Needle /> no arco de fundo. */
  --color-band-tossup: #d9d9d9;
  --color-band-lean: #b8b8b8;
  --color-band-likely: #888888;
  --color-band-very_likely: #444444;

  /* Participação (S07/Fase 2) — ver § "Participação e trilhas" */
  --color-part-brancos-nulos: #565656;
  --color-part-brancos-nulos-band: #dcdcdc;
  --color-part-abstencao: #24504d;
  --color-part-abstencao-band: #cfe0de;

  /* Status */
  --color-success: #2c8e4a;
  --color-warning: #d97706;
  --color-error: #b91c1c;
  --color-live: #ef4444;

  /* Versões "strong" — usar quando o token carrega texto (rótulo colorido
   * ou fundo sólido + texto branco). Ver § "Status — variantes -strong". */
  --color-warning-strong: #b45309;
  --color-success-strong: #166534;

  /* Espaçamento — default do Tailwind v4 (nenhuma customização).
   * `--spacing: 0.25rem` e cada passo é `calc(var(--spacing) * n)`:
   *   1 4px · 2 8px · 3 12px · 4 16px · 5 20px · 6 24px · 8 32px
   * ATENÇÃO: 5/6/8 NÃO valem 24/32/48px. Esses eram os valores do
   * `tailwind.config.ts`, que nunca foi carregado pelo build v4 — o que está
   * na tela sempre foi a escala default. Verificado no CSS emitido em
   * 2026-09-07. */

  /* Breakpoints — default do Tailwind v4 (nenhuma customização).
   *   sm 640px · md 768px · lg 1024px · xl 1280px */

  /* Layout — `--container-page` vive no `@theme static` e é o que gera a
   * utilitária `max-w-page`, usada pelos 7 wrappers <main> do app. */
  --container-page: 1280px;
}

/* Fora do @theme (`:root` puro) — ver a nota do topo:
 *   --font-mono: "JetBrains Mono", monospace;
 *                                      (a fonte ainda não é carregada; entra
 *                                       no Bloco 1 via next/font)
 *   --max-width: 1280px                (legado, sem consumidor hoje)
 *   --trilha-accent: var(--color-text);
 *   --trilha-accent-soft: var(--color-bg-muted);
 *                                      ADR-0019 — default neutro, redefinidos
 *                                      por main[data-trilha="pres"|"gov"] logo
 *                                      abaixo. Ficam fora do @theme porque são
 *                                      cascata condicional por página, não
 *                                      token de tema global.
 */

/* Trilhas (S07/Fase 2) — ver § "Participação e trilhas" */
main[data-trilha="pres"] { --trilha-accent: #17365c; --trilha-accent-soft: #dbe3ee; }
main[data-trilha="gov"]  { --trilha-accent: #1c4d3a; --trilha-accent-soft: #d7e6dd; }

* { font-variant-numeric: tabular-nums; }
body { font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); }
h1, h2, h3 { font-family: var(--font-serif); font-weight: 600; }

/* Utilitário sr-only (a11y RNF-023) e reduced-motion global (RNF-026)
 * também vivem em app/globals.css — ver ./animations.md. */
```

## Paleta editorial por partido/federação (Bloco 1, ADR-0024)

> **Constituição § 2 v1.3 (2026-09-07)**: cor de partido é **editorial, não oficial** —
> ΔE76 ≥ 12 contra todo hex documentado do partido (limiar operacional: 12, não 10).
> Matiz **fixa a noite inteira** (pior erro perceptual seria associar a cor a um rival se ela
> vibrasse durante a campanha); só intensidade varia com margem projetada.
> **Desde 2026-09-08**, a paleta também é medida **contra ela mesma**: ΔE76 ≥ 12 entre partidos
> diferentes (ver "Distância entre os nossos partidos", abaixo).
> Validação em runtime: `scripts/gen-party-scale.ts` e gates
> `tests/unit/design-system/party-delta-e.test.ts` e `.../party-separation.test.ts`.

**32 partidos registrados** (31 em 2026-09-07 + PTB em 2026-09-20 — o PTB aparece no dado real e não
tinha token próprio, caindo no mesmo cinza de "sem apuração" tratado abaixo em
"`--party-outros` × `--map-uncounted`"; hex escolhido no maior vão de matiz livre da paleta, ΔE76
mínimo 15,82 de qualquer outro partido — ver nota de fonte oficial após a tabela). A tabela abaixo
foi **medida** a partir do `app/tokens-party.css` commitado e de
`scripts/data/party-official-hexes.json` — não digitada. Para regerar: `pnpm gen:party-scale --report`.

| Partido | Token base | Hex | ΔE76 mínimo contra oficial | Contraste sobre papel | Uso seguro |
|---|---|---|---|---|---|
| AGIR | `--party-agir` | `#7c6e5b` | 73.08 vs `#F2295B` | 4.50:1 | texto e preenchimento |
| AVANTE | `--party-avante` | `#794cae` | 42.18 vs `#BF247F` | 5.52:1 | texto e preenchimento |
| CIDADANIA | `--party-cidadania` | `#c46a9c` | 34.74 vs `#CA0088` | 3.24:1 | preenchimento com traço |
| DC | `--party-dc` | `#3b6fb0` | 14.72 vs `#0666BE` | 4.67:1 | texto e preenchimento |
| DEMOCRATA | `--party-democrata` | `#4b5563` | — (sem fonte oficial) | 6.87:1 | texto e preenchimento |
| MDB | `--party-mdb` | `#408a50` | 15.44 vs `#0A9246` | 3.84:1 | preenchimento com traço |
| MISSAO | `--party-missao` | `#1e7f8c` | 102.14 vs `#FCBE26` | 4.27:1 | preenchimento com traço |
| MOBILIZA | `--party-mobiliza` | `#3e89f9` | — (sem fonte oficial) | 3.10:1 | preenchimento com traço |
| NOVO | `--party-novo` | `#e07b1d` | 12.29 vs `#F17021` | 2.72:1 | **só preenchimento com traço** (reprova 3:1) |
| OUTROS | `--party-outros` | `#9aa0a8` | — (sem fonte oficial) | 2.39:1 | **só preenchimento com traço** (reprova 3:1) |
| PCB | `--party-pcb` | `#b63a2e` | 25.27 vs `#C20000` | 5.25:1 | texto e preenchimento |
| PCDOB | `--party-pcdob` | `#6b4b7d` | 25.25 vs `#0A4C8F` | 6.52:1 | texto e preenchimento |
| PCO | `--party-pco` | `#9d4227` | 24.18 vs `#A10005` | 5.89:1 | texto e preenchimento |
| PDT | `--party-pdt` | `#784b02` | 55.35 vs `#176939` | 6.80:1 | texto e preenchimento |
| PL | `--party-pl` | `#2247b8` | 13.54 vs `#2A3591` | 7.17:1 | texto e preenchimento |
| PODE | `--party-pode` | `#2e9c8f` | 92.38 vs `#602D91` | 3.04:1 | preenchimento com traço |
| PP | `--party-pp` | `#0f60b3` | 24.36 vs `#133D6D` | 5.71:1 | texto e preenchimento |
| PRD | `--party-prd` | `#6a5acd` | 28.49 vs `#0E509E` | 4.82:1 | texto e preenchimento |
| PRTB | `--party-prtb` | `#6b7a2c` | 40.86 vs `#01A64A` | 4.29:1 | preenchimento com traço |
| PSB | `--party-psb` | `#b6a92a` | 39.60 vs `#FFF200` | 2.19:1 | **só preenchimento com traço** (reprova 3:1) |
| PSD | `--party-psd` | `#2f8f6b` | 49.30 vs `#7FC341` | 3.63:1 | preenchimento com traço |
| PSDB | `--party-psdb` | `#c37b61` | 46.05 vs `#F7941E` | 3.02:1 | preenchimento com traço |
| PSOL | `--party-psol` | `#d6a400` | 15.55 vs `#FFC200` | 2.08:1 | **só preenchimento com traço** (reprova 3:1) |
| PSTU | `--party-pstu` | `#97272b` | 38.68 vs `#CC0000` | 7.23:1 | texto e preenchimento |
| PT | `--party-pt` | `#c62e49` | 12.01 vs `#B9142C` | 4.91:1 | texto e preenchimento |
| PTB | `--party-ptb` | `#17759a` | — (sem fonte oficial) | 4.71:1 | texto e preenchimento |
| PV | `--party-pv` | `#ac2c92` | 108.04 vs `#146332` | 5.41:1 | texto e preenchimento |
| REDE | `--party-rede` | `#3d8f3d` | 37.12 vs `#379E8D` | 3.67:1 | preenchimento com traço |
| REPUBLICANOS | `--party-republicanos` | `#2a548a` | 14.08 vs `#005CA9` | 6.98:1 | texto e preenchimento |
| SOLIDARIEDADE | `--party-solidariedade` | `#eb4784` | 63.81 vs `#F37021` | 3.31:1 | preenchimento com traço |
| UNIAO | `--party-uniao` | `#124287` | 14.09 vs `#254AA5` | 8.86:1 | texto e preenchimento |
| UP | `--party-up` | `#8c2f5c` | 58.26 vs `#C00810` | 7.13:1 | texto e preenchimento |

**Sem fonte oficial localizada** (dívida a revisitar, não problema resolvido):
`--party-democrata` (ex-PMB, renomeado pelo TSE em 02/12/2025 — o site usa a paleta padrão do
Tailwind, que não é identidade de marca), `--party-mobiliza` (ex-PMN — `mobiliza.org.br` fora do ar,
`pmn.org.br` com TLS expirado) e `--party-ptb` (Partido Trabalhista Brasileiro — incluído em
2026-09-20; ⚠️ diferente dos dois anteriores, aqui a busca por fonte oficial **não foi tentada**
nesta sessão, não foi tentada-e-falhou — a tarefa que incluiu o PTB foi instruída a não pesquisar.
Dívida a revisitar com uma sessão que possa pesquisar). O validador **não reprova** por ausência de
oficial (não há do que se afastar), mas o gerador avisa.

### Distância entre os nossos partidos (gate novo, 2026-09-08)

Até 07/09 toda cor desta paleta era medida contra o **lado de fora** — o hex oficial do partido
(§ 2) e o contraste sobre papel (§ 4). Nenhuma medida olhava para a paleta **contra ela mesma**, e
o kit chegou com cinco pares que ninguém distingue:

| Par | ΔE76 (antes) |
|---|---|
| `--party-dc` `#3b6fb0` × `--party-pp` `#2c6fb0` | **2,52** |
| `--party-pco` `#a1332b` × `--party-pstu` `#9e2b2b` | **3,55** |
| `--party-pcb` `#b63a2e` × `--party-pco` `#a1332b` | **8,25** |
| `--party-mdb` `#2e8b57` × `--party-psd` `#2f8f6b` | **9,54** |
| `--party-pcb` `#b63a2e` × `--party-pstu` `#9e2b2b` | **9,98** |

E uma sexta que só aparecia nas **tintas**: PSB e PSOL distavam 10,51 como base e **2,51** como
`-text` (`#896c00` × `#8d6b00`), porque escurecer para alcançar 4,5:1 comprime distâncias — uma
correção de a11y tinha criado uma colisão de identidade.

**O gate.** `PARTY_SEPARATION_FLOOR = 12` no gerador: todo par de partidos, nos **três papéis que
identificam** (`--party-<slug>`, `-chip`, `-text`), precisa de ΔE76 ≥ 12 — com os 32 partidos de
2026-09-20, 1488 medições (496 pares × 3; eram 1395/465 com os 31 de 07-08/09). Falha com código ≠ 0
e é refeito sobre o CSS commitado por `tests/unit/design-system/party-separation.test.ts`.

- **Por que 12**: é o mesmo `DELTA_E_FLOOR` que já vale contra os hexes oficiais — a mesma pergunta
  perceptual ("estas duas cores são a mesma?") não pode ter duas respostas. E 12 cai dentro de um
  vão do próprio dado: ordenados, os pares do kit iam 9,98 · **11,69** ··· **12,09** · 12,13. Custo
  por piso, medido: 10 → 6 pares reprovados / 5 hexes a mudar; **12 → 7 pares / 6 hexes**;
  14 → 14 pares / 9 hexes; 18 → 20 pares / 10 hexes; 25 → 41 pares / 16 hexes. Acima de 12 deixa de
  ser correção e vira redesenho, para resolver confusão que ninguém tem (os pares entre 12 e 14 são
  azuis institucionais que se distinguem lado a lado).
- **Por que os níveis 1..5 ficam fora**: são alvos absolutos de L\*/C\* iguais para todos, então o
  nível 1 de todo mundo mora no círculo L\* 90 / C\* 10 — 31 pontos ali ficam, no melhor arranjo
  possível, a **2,02** um do outro. Exigir 12 seria exigir o impossível, e é desnecessário: o nível
  comunica **margem**; quem responde "qual partido" são os três papéis gateados.
- **Por que `-ink` fica fora**: é preto ou branco do kit, não cor de partido.

**Como as colisões foram resolvidas — e por que este conjunto.** O critério está implementado em
`pnpm gen:party-scale --suggest` (gerador, seção 7c), em três regras lexicográficas, nenhuma delas
olhando para quem é o partido: (1) **menos hexes alterados** — o conjunto de quem muda precisa tocar
todo par em conflito, o que é uma cobertura mínima de vértices do grafo de colisão; (2) empatado,
**menor deslocamento total** (soma dos ΔE76 entre hex antigo e novo); (3) empatado, **ordem
alfabética de slug**. Toda cor nova continua obedecendo todas as regras antigas (ΔE ≥ 12 dos
oficiais daquele partido, rampa monotônica, matiz constante, chip/tinta e `-text` ≥ 4,5:1).

| Partido | De | Para | ΔE76 do deslocamento | Por quê |
|---|---|---|---|---|
| `--party-avante` | `#7a4fb3` | `#794cae` | 1,64 | colidia com PRD (11,69) |
| `--party-pstu` | `#9e2b2b` | `#97272b` | 3,31 | triângulo PCB/PCO/PSTU |
| `--party-mdb` | `#2e8b57` | `#408a50` | 5,35 | colidia com PSD (9,54) |
| `--party-pco` | `#a1332b` | `#9d4227` | 9,79 | triângulo PCB/PCO/PSTU |
| `--party-psb` | `#c9a227` | `#b6a92a` | 12,10 | o `-text` colidia com PSOL (2,51) |
| `--party-pp` | `#2c6fb0` | `#0f60b3` | 13,49 | rampa colapsada + DC (2,52) |

Quem **não** mudou é o teste do critério: o **DC ficou parado** apesar de estar na pior colisão da
paleta — o PP mudava de qualquer forma por causa da própria rampa (abaixo), então mover os dois
violaria a regra 1. No triângulo vermelho, três arestas exigem dois vértices e o **PCB** ficou
parado por ser a escolha de menor deslocamento total. PSD, PSOL e PRD ficaram parados pelo mesmo
motivo em seus pares.

**Os pares mais próximos que sobraram** (saída de `pnpm gen:party-scale --report`; nada abaixo de
12, mas estes são os que a próxima revisão da paleta precisa não piorar):

| ΔE76 | Papel | Par |
|---|---|---|
| 12,09 | `text` | `--party-democrata-text` `#4b5563` × `--party-outros-text` `#6b7078` |
| 12,13 | `base` | `--party-dc` `#3b6fb0` × `--party-republicanos` `#2a548a` |
| 12,13 | `chip` | `--party-dc-chip` `#3b6fb0` × `--party-republicanos-chip` `#2a548a` |
| 12,13 | `text` | `--party-dc-text` `#3b6fb0` × `--party-republicanos-text` `#2a548a` |
| 13,00 | `base` | `--party-rede` `#3d8f3d` × `--party-mdb` `#408a50` |
| 13,06 | `text` | `--party-rede-text` `#2c802f` × `--party-mdb-text` `#347e45` |
| 13,07 | `chip` | `--party-rede-chip` `#318433` × `--party-mdb-chip` `#388249` |
| 13,09 | `text` | `--party-pl-text` `#1a7f5c` × `--party-mdb-text` `#347e45` |
| 13,13 | `text` | `--party-psb-text` `#7a7200` × `--party-psol-text` `#8d6b00` |
| 13,15 | `base` | `--party-avante` `#794cae` × `--party-prd` `#6a5acd` |

Refeito em 2026-09-20 (`pnpm gen:party-scale --report`, 32 partidos). Um achado de passagem, não
defeito desta sessão: a linha que era `--party-psd-text × --party-mdb-text` em 08/09 já não existe —
virou `--party-pl-text × --party-mdb-text` porque **PL e PSD trocaram de hex base entre si em
2026-09-19** (a pedido do dono, ver comentário em `PARTY_BASE`); esta tabela não tinha sido refeita
desde então. PTB (incluído nesta sessão) não aparece nos 10 pares mais próximos — nos três papéis
(`base`/`chip`/`text`), o par mais próximo dele na paleta inteira é `--party-ptb-text` ×
`--party-missao-text`, a ΔE76 15,82, bem acima do piso.

O par mais apertado da paleta é o único que **não** passou pelo solver:
`--party-democrata-text` × `--party-outros-text`, a 12,09 — o cinza-azulado do Democrata contra o
cinza do fallback, ambos escurecidos para alcançar 4,5:1 sobre o papel. Passa o piso e por isso
ficou parado (regra 1), mas tem 0,09 de folga: qualquer mexida nas superfícies de papel ou no hex
do fallback reabre o caso.

### `--party-outros` × `--map-uncounted` (gate novo, 2026-09-20)

O gate acima mede a paleta **contra ela mesma** — mas nunca contra `--map-uncounted`
(`app/globals.css`), o cinza que o mapa usa para "sem apuração". Defeito medido em 2026-09-20: o
nível 1 de `--party-outros` (o fallback universal — qualquer sigla sem token próprio, e não é raro:
PTB antes desta sessão, e ainda hoje qualquer sigla nova que o TSE publique e este repositório não
tenha cadastrado) saía **puramente acromático** (rampa acromática por construção, C\* = 0 em todo
L\*) e caía a ΔE76 **2,39** de `--map-uncounted` no claro. Na vista "margem" do mapa nacional, o
nível 1 é o de menor margem: um estado onde uma candidatura sem cor própria **lidera por pouco**
ficava visualmente indistinguível de um estado onde **ninguém apurou** — quebrando a decisão do
dono de 14/09 de que "não começou", "não sabemos" e "apurando" são três estados que nunca podem se
confundir.

**Medido nos dois temas, nível 1 de todo partido contra `--map-uncounted`** (menores primeiro; o
piso é 10, ver abaixo):

| Tema claro | ΔE76 | | Tema escuro | ΔE76 |
|---|---|---|---|---|
| `--party-outros-1` (era) | **2,39** | | `--party-outros-1` (era) | **6,28** |
| `--party-dc-1` | 7,44 | | `--party-democrata-1` | 9,28 |
| `--party-democrata-1` | 7,72 | | `--party-pp-1` | 9,29 |
| `--party-mobiliza-1` | 7,81 | | `--party-republicanos-1` | 9,42 |
| `--party-pp-1` | 7,83 | | `--party-dc-1` | 9,51 |
| `--party-republicanos-1` | 7,91 | | *(outros-1 depois do fix: **11,96**)* | |
| … 9 outros entre 8,4 e 9,7 | | | | |
| *(outros-1 depois do fix: **12,18**)* | | | `--party-outros-2` (era) | 8,36 |
| | | | *(outros-2 depois do fix: **11,93**)* | |

**15 dos 31 partidos reais** ficam abaixo de 10 no claro (nível 1) e **4** no escuro — o mesmo
defeito perceptual, só que em cores que TÊM identidade própria (o problema ali é mais brando: um
partido real que lidera por pouco ainda tem cor de FUNDO própria nos outros papéis; `--party-outros`
não tem nenhuma). Esta sessão **não mexeu nesses 15+4** — é redesenho de rampa, não conserto pontual,
e fica como recomendação (ver abaixo), não como pendência bloqueante.

**Por que 10 e não 12.** `PARTY_SEPARATION_FLOOR` (12, acima) responde "estas duas cores são o MESMO
PARTIDO?" e carrega 2 unidades de folga contra revisão de fonte OFICIAL de terceiro — não se aplica
aqui, porque `--map-uncounted` não é hex de terceiro sujeito a revisão, é token de primeira mão deste
repositório. A pergunta certa é mais simples — "sem apuração" e "há um número aqui" leem como a
MESMA COR? — e é exatamente o que `components/blocks/_swingRamp.ts` já respondeu em 18/09 para o
mesmo cinza, com o piso **10** da constituição § 2 (`PISO_DELTA_E` em
`tests/unit/design-system/swing-ramp.test.ts`). `MAP_UNCOUNTED_SEPARATION_FLOOR` no gerador reusa
esse piso pela mesma razão, não é um número novo.

**A correção.** Não é pintar `--party-outros` de uma cor — isso reabriria a colisão original entre
"cinza institucional" e "cor de partido" (aplicar os alvos de croma reais, C\* 10‥66, ao resíduo de
matiz do cinza produziria um azul de verdade no nível 3). Cada nível da rampa neutra passa a receber
o croma **mínimo** que o separa de `--map-uncounted` pelo piso — **0** onde a distância em L\* já
resolve sozinha (a maioria: níveis 3–5 nos dois temas, nível 2 no claro), e uma matiz **fixa** e
**oposta** à de `--map-uncounted` (o ponto mais eficiente para abrir distância — os dois vetores
somam em módulo em vez de cancelar). Só os níveis que de fato colidiam mudam: nível 1 nos dois temas,
e também o nível 2 no escuro. O resultado é sutil por desenho: nível 1 sai com C\* ≈ 10 (claro) / ≈ 9
(escuro) — a MESMA ordem de grandeza que qualquer partido real já usa no próprio nível 1
(`RAMP_C[0]` = 10) — visualmente a mesma discrição, só apontada para longe da ausência de dado em vez
de para a identidade de um partido. Base, chip e tinta de `--party-outros` não mudaram (já estavam a
ΔE76 ≥ 24 de `--map-uncounted` nos dois temas).

Implementado em `scripts/gen-party-scale.ts` § 4b (`escapeChromaFromMapUncounted`,
`escapeHueFromMapUncounted`, `loadMapUncounted`) e gateado em
`tests/unit/design-system/party-separation.test.ts` (descreve `"--party-outros" × "--map-uncounted"`,
os dois temas).

**Recomendação para os 15+4 que sobraram** (fora do escopo desta correção): mover só o nível 1 (e o
2 no escuro) dos 15/4 partidos reais mais próximos exigiria a mesma técnica de croma-de-fuga, mas
aplicada à identidade de CADA partido — potencialmente reabrindo `PARTY_SEPARATION_FLOOR` entre eles
(o nível 1 já está deliberadamente fora desse gate por ser matematicamente impossível separar 31+
partidos num círculo de L\* 90 / C\* 10, ver "Os 5 níveis são escala de MARGEM" acima — introduzir
uma segunda restrição, "e também longe de `--map-uncounted`", ali é um problema de otimização maior,
não uma correção pontual). Rever numa sessão dedicada a rampa.

### O nível 5 não pode virar cinza

Gate irmão, no mesmo commit: **C\*₅ ≥ 0,60 × C\*₄**. O nível 5 é o "decisivo" — a cor mais carregada
da escala — e o alvo do kit recua o croma de propósito (C\* 53 sobre 66 = 0,80), o que o mantém
reconhecível como a cor do partido, só mais densa.

O empurrão de ΔE76 destruía isso em silêncio: quando um hex oficial escuro fica no caminho, escapar
**reduzindo o croma** é a saída mais barata no custo do solver. `--party-pp` saía com **C\* 15,0
contra C\* 43,8** do nível 4 — razão **0,34**, um cinza-ardósia onde deveria estar o azul mais forte
do PP — enquanto os outros 30 partidos ficavam entre 0,71 e 1,02. Causa: o PP tem **três** hexes
oficiais (`#133D6D`, `#54B8EA`, `#234F74`) e dois deles ficam na ponta escura, estreitando o
corredor.

A correção foi **girar a matiz do hex base**: `#2c6fb0` → `#0f60b3`, de 272,3° para 280,9°. O nível
4 sobe para C\* 53,9 e o nível 5 para **C\* 43,9** — razão **0,81**, exatamente o recuo desenhado no
kit — e a distância do pior hex oficial do PP sobe de ΔE 20,5 para **24,4** de quebra. O piso de
0,60 fica no vão entre 0,34 (o defeito) e 0,71 (o pior caso legítimo, `--party-pl`, limitado pelo
gamut do azul).

### Os 5 níveis são escala de MARGEM, não escala de UI

`--party-<sigla>-1..5` mapeia **margem projetada**, não intensidade decorativa: **1 = disputa
apertada, 5 = decisivo**. Quem resolve o nível é `intensityLevelForMargin()` em
`lib/utils/party-color.ts`, com limiares `[2, 5, 10, 15]` pp — três deles vindos do código que já
existia no mapa (`marginToColor` e `swingToColor`); só o de 5 pp é novo. Existe também
`intensityLevelForBand()`, que traduz as 4 bandas de `NeedleBand` (probabilidade) nos níveis 1–4;
o nível 5 não é uma quinta banda — corresponde ao estado de corrida chamada, que o payload já
carrega em campo próprio.

Invariantes garantidas por teste (`tests/unit/design-system/party-delta-e.test.ts`) e verificadas
por mim de forma independente em 2026-09-07 e refeitas em 2026-09-08: **L\* estritamente
decrescente do nível 1 ao 5 nos 32 partidos** (31 em 07-09/09 + PTB em 20/09), **matiz constante**
(maior desvio: 2,7° em `--party-pco`, com croma 9,9 = 0,47 unidade Lab, abaixo do limiar de
percepção) e **croma do nível 5 ≥ 60% do nível 4** (ver "O nível 5 não pode virar cinza"). Exceção
documentada à matiz constante: os 5 níveis de `--party-outros` (não é partido, não tem identidade a
proteger) — ver "`--party-outros` × `--map-uncounted`", abaixo.

### Contraste — o que estes tokens podem carregar

Medido sobre `--surface-page` (`#F3F4F6`) em 2026-09-07:

- **Quatro bases reprovam o piso de 3:1 de objeto gráfico já no tema claro**: `--party-psol`
  (2,08:1), `--party-psb` (2,19:1), `--party-outros` (2,39:1) e `--party-novo` (2,72:1) — os
  amarelos e laranjas. Elas **só podem** aparecer como preenchimento delimitado por traço
  (`--map-stroke` no mapa, borda no chip), **nunca** atrás de texto nem como preenchimento solto.
- **Para texto existe token próprio: `--party-<slug>-text`**, gerado e medido, com **≥ 4,5:1 sobre
  `--surface-page` e sobre `--surface-card`**. Catorze dos 32 partidos precisaram escurecer para
  alcançá-lo (PTB não é um deles: `#17759a` já dá 4,71:1 sobre `--surface-page` sem precisar mover) — `--party-psol` vai de `#d6a400` (2,08:1) para `#8d6b00` (4,51:1), o maior
  deslocamento da paleta (ΔE 30,1). Os escurecidos continuam a ΔE76 ≥ 12 dos hexes oficiais e com
  a matiz intacta. Consuma por `textForParty(sigla)`; **nunca** pinte número ou rótulo com
  `colorForParty()`, que devolve a cor de identidade — foi exatamente esse erro que produziu a
  única violação `serious` de axe da auditoria de 07/09 (número do 3º colocado a 2,99:1).
  O pior par da coluna de texto é `--party-agir`, em 4,5021:1.
- Os níveis **1 e 2** de qualquer partido são claros por construção (L\* 90 e 76): decorativos,
  jamais com texto por cima.
- Chip preenchido tem par próprio: **`--party-<slug>-chip`** (fundo) e **`--party-<slug>-ink`**
  (tinta), gerados e medidos. Nenhuma tinta fixa serviria — 21 bases pedem tinta clara e 10 pedem
  escura. Em **dois** partidos nenhuma das duas alcança 4,5:1 (MDB `#408a50`: 4,25 com preto e 4,09
  com branco; REDE `#3d8f3d`: 4,45 e 3,91), então o chip **escurece preservando a matiz** —
  MDB `#388249` (ΔE 3,05 da base) e REDE `#318433` (ΔE 4,17), ambos ainda a ΔE76 ≥ 12 dos hexes
  oficiais. O pior par da paleta é `--party-psd`, em 4,5048:1. Use `partyChipInk(sigla)`; **nunca**
  monte o chip com `colorForParty()`, que devolve a base e reintroduz a falha exatamente nesses dois.

**Dark mode ainda não existe para estes tokens** (é o Bloco 2). Medido contra os fundos escuros do
kit (`#1C1F24` / `#14171B`), **13 das 31 bases reprovariam o piso de 3:1**: `avante`, `democrata`,
`pcb`, `pcdob`, `pco`, `pdt`, `pl`, `pp`, `pstu`, `pv`, `republicanos`, `uniao`, `up`. O kit só traz
variante escura para PT e PL, então o Bloco 2 precisa gerar as demais — não é ajuste fino, é
paleta faltando.

### Geração e consumo

```bash
pnpm gen:party-scale            # regenera app/tokens-party.css (290 tokens; 281 antes do PTB)
pnpm gen:party-scale --check    # prova determinismo: saída byte-idêntica
pnpm gen:party-scale --report   # tabela ΔE76 / L* / C* / h + os 10 pares mais próximos
pnpm gen:party-scale --suggest  # conjunto MÍNIMO de hexes a mudar quando dois partidos colidem
```

O gerador **falha com código ≠ 0** se algum token violar ΔE76 < 12 contra um hex oficial, se dois
partidos ficarem a ΔE76 < 12 entre si em qualquer dos três papéis identificadores, se um par
`-chip`/`-ink` ou um `-text` cair abaixo de 4,5:1, se L\* deixar de ser estritamente decrescente, ou
se o nível 5 de alguém perder mais de 40% do croma do nível 4. `app/tokens-party.css` é importado por `app/globals.css` na
linha 4 — `@import` precisa vir antes de qualquer outra regra.

API de consumo (`lib/utils/party-color.ts`, exports reais):

| Função | O que faz |
|---|---|
| `colorForParty(sigla)` | sigla → `var(--party-<slug>)`; sigla desconhecida → `var(--party-outros)`. É cor de **área** (chip, barra, polígono do mapa) |
| `textForParty(sigla)` | sigla → `var(--party-<slug>-text)`, a variante legível **sobre o papel**. Em 18 dos 32 partidos **é** a base (PTB incluído — `#17759a` já passa 4,5:1 sem escurecer). Use para texto colorido por identidade **e para traçado de gráfico** — ver a nota abaixo |
| `partyChipInk(sigla)` | par `{ background, ink }` pronto para superfície sólida com rótulo em cima (≥ 4,5:1 medido pelo gerador) |
| `intensityForParty(sigla, nivel)` | sigla + nível 1..5 → `var(--party-<slug>-<n>)` |
| `intensityLevelForMargin(margemPp)` | margem em pp → nível 1..5 |
| `intensityLevelForBand(band)` | banda de `NeedleBand` → nível 1..4 |
| `resolvePartyHex(sigla, nivel?)` | hex resolvido por `getComputedStyle`, SSR-safe — é o **único** caminho de cor para o MapLibre, que não aceita `var()` em paint value |
| `normalizePartySlug(sigla)` | normaliza (`"PC do B"` → `pcdob`) |

**Traçado fino de gráfico usa `textForParty`, não a base** ([ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md)
D1, 2026-09-18). Uma linha de 1,5–2,5 px é objeto gráfico: WCAG 2.1 SC 1.4.11, piso **3:1** — e
sobre `--surface-page` (#f3f4f6) quatro bases reprovam esse piso (PSOL 2,08:1, PSB 2,19:1, o
fallback `outros` 2,39:1, NOVO 2,72:1). A base continua certa para **área** (o polígono do mapa, a
barra, o chip), onde a superfície é grande. No tema escuro nenhuma base reprova 3:1, então ali a
variante é escolha de coerência, não de contraste — e deixa oito tokens mais pálidos que a base.

**Federação não tem token próprio**: usa a cor do partido-líder (ADR-0024), e a composição vem do
feed EA20 (`fed[]`, `lib/tse/ea20-schema.ts`) — nunca de lista hardcoded, porque a composição muda
a cada eleição.

## Notas

- **Cores editorial, não oficial** — constituição § 2 v1.3.
- **Design system Atlas Menna** — Bloco 1 (ADR-0025 § 1).
- `tabular-nums` global garante alinhamento vertical de números em tabelas/contadores.
- Serif (Spectral) para headlines; sans (Archivo) para corpo (NYT-like).

## Paleta multi-candidato por rank (S05/F2, ADR-0013, **superseded por ADR-0024 em 2026-09-07**)

A partir de S05 (foundation 1T 2026) a UI deixa de mapear `cor` por sigla
partidária e passa a mapear por **rank** projetado — **essa decisão foi revertida em Bloco 1**
(2026-09-07) para usar a paleta editorial por partido (§ acima, ADR-0024).

O ADR-0013 permanece documentado aqui por referência histórica de specs 003/004 (que seguem
usando os tokens `--color-cand-*` legados via backward compat). Para specs novas (Senador,
Deputado, etc.) usar `--party-{sigla}-{nível}` em vez de rank-based.

### Regra — **LEGADO, não mais válido**

Esta seção descreve o comportamento pre-2026-09-07 e é **referência histórica para specs
003/004 que usam os tokens `--color-cand-*`**. Para specs novas (016+), usar `--party-*`
(§ acima, ADR-0024).

**Comportamento superseded em 2026-09-07:**
- Cores via tokens, **nunca** oficiais partidárias (constituição § 2).
- ~~Mapping é por **rank no payload publicado**, não por sigla~~. **2026-09-20: cor vem da
  sigla via `--party-*`, e rang não é mais usado** — validado por
  `tests/unit/components/cor-nunca-da-posicao.test.ts`.
- ~~**Color lock**: o orchestrator congela o rank~~. Substituído por cor fixa por sigla.

### Tabela de tokens

| Token                       | Hex       | Uso recomendado                                  |
| --------------------------- | --------- | ------------------------------------------------ |
| `--color-cand-1`            | `#d33732` | Líder projetado — alias visual de `--color-pt`   |
| `--color-cand-2`            | `#2a52be` | 2º — alias visual de `--color-pl`                |
| `--color-cand-3`            | `#c97c1f` | 3º — âmbar/ocre seco                             |
| `--color-cand-4`            | `#4a8b3e` | 4º — verde-oliva neutro (não REDE/PV oficial)    |
| `--color-cand-5`            | `#7d4a8c` | 5º — lilás-uva                                   |
| `--color-cand-6`            | `#5c5448` | 6º — taupe quente                                |
| `--color-cand-other`        | `#6e6e6e` | Rank 7+ ou pct < 1%                              |
| `--color-cand-N-strong`     | ver CSS   | Texto pequeno onde o token base não dá 4.5:1     |
| `--color-cand-band-1`       | `#f0c9c8` | Faixa clara do rank 1 (clareado de `#d33732`)    |
| `--color-cand-band-2`       | `#c8d4ed` | Faixa clara do rank 2 (clareado de `#2a52be`)    |
| `--color-cand-band-3..6`    | claro     | Fundos suaves: mapa fill, pull-quote bg, badges  |
| `--color-cand-band-other`   | `#d9d9d9` | Mesmo de `--color-tossup` — fallback para mapa   |

### Backward compatibility

- `--color-pt` e `--color-pl` continuam definidos com os mesmos hexes
  de `--color-cand-1` e `--color-cand-2`. Specs 003/004 que ainda
  consomem o payload v1 (PT vermelho, PL azul) seguem renderizando
  inalteradas.

### Defeitos conhecidos

- **`--color-pt-band` / `--color-pl-band` estão invertidos entre si**:
  `--color-pt-band` é `#c8d4ed` (azul claro) e `--color-pl-band` é `#f0c9c8`
  (rosa claro) — o oposto da cor-base de cada um. Este é um defeito conhecido
  (não corrigido de propósito — ver abaixo).
- Até 2026-09-05, `--color-cand-band-1/2` aliasavam esses dois tokens e
  herdavam a inversão — invisível enquanto o IC era só texto, evidente quando
  `<ProjectionThermometer />` passou a **desenhar** a faixa (candidato vermelho
  com faixa azul). Corrigido em `app/globals.css` com hex explícito derivado da
  própria cor do rank; os tokens legados ficaram intocados de propósito porque
  `/sobre-o-modelo` os usa como swatch de intensidade Lean/Likely — uso indevido,
  que deveria consumir `--color-band-lean` / `--color-band-likely`.

### Helper TS

`lib/utils/cand-color.ts` expõe `colorForRank(rank) →
"var(--color-cand-N)"` e `resolveCandHex(rank) → "#RRGGBB"` (este
último necessário para MapLibre `setPaintProperty`, que não aceita
`var()` em paint values).

### Watch a11y

Rank 3 (`#c97c1f` âmbar) e rank 5 (`#7d4a8c` lilás) têm contraste
WCAG marginal sobre branco em texto pequeno (~14px). Carry-over para
`a11y-perf-auditor` na Fase Gates de S05/F2: se reprovar, criar
variante `--color-cand-N-strong` para uso em legenda/labels.

## Participação e trilhas (S07/Fase 2)

> Cobertura: **RF-061** (hero de seis termômetros no 1º turno), **RF-062**
> (projeção de participação na UI) e **RF-063** (identidade visual por trilha).
> ADR-0018 e ADR-0019. Componentes: [`components.md`](./components.md#componentes-novos-da-s07fase-2-hero-1t--trilhas).

O hero do 1º turno deixa de ser um duelo e passa a ser **seis termômetros**
(1º, 2º, 3º colocados, "Outros candidatos", brancos/nulos e abstenção). As
duas últimas métricas não pertencem a candidato nenhum — precisam de cor
própria, nunca reaproveitada de `--color-cand-*` (que é por rank e muda de
dono durante a noite, ADR-0013).

### Tokens de participação

| Token                              | Hex       | Contraste s/ branco | Uso                                   |
| ---------------------------------- | --------- | ------------------- | ------------------------------------- |
| `--color-part-brancos-nulos`       | `#565656` | 7.34:1              | Termômetro de brancos e nulos         |
| `--color-part-brancos-nulos-band`  | `#dcdcdc` | —                   | Faixa de IC95 do mesmo termômetro     |
| `--color-part-abstencao`           | `#24504d` | 9.01:1              | Termômetro de abstenção               |
| `--color-part-abstencao-band`      | `#cfe0de` | —                   | Faixa de IC95 do mesmo termômetro     |

Ambos ≥ 7:1 (AAA para texto normal) e escolhidos para não colidirem com
`--color-cand-2` (`#2a52be`, azul vivo, 6.89:1) nem com `--color-cand-4`
(`#4a8b3e`, verde-oliva, 4.16:1): o cinza é acromático e o teal é ~2× mais
escuro que o oliva e muito menos saturado que o azul.

### Denominador rotulado

Os seis termômetros usam **três bases diferentes** e por isso não somam 100.
`lib/utils/participacao.ts` é a fonte dos rótulos:

| `ParticipacaoBase`       | Rótulo                                   | Métrica                     |
| ------------------------ | ---------------------------------------- | --------------------------- |
| `votaveis`               | `% dos votos a votáveis`                 | candidatos e "Outros"       |
| `comparecimento`         | `% do comparecimento`                    | brancos e nulos             |
| `eleitores_instalados`   | `% dos eleitores das seções instaladas`  | abstenção                   |

Nunca escrever "% dos válidos" para `votaveis`: o `pvap` do TSE é percentual
sobre **votos a votáveis concorrentes** (válidos + anulados + sub judice),
conforme o dicionário oficial em
[../reference/tse-2026-leiautes.md](../reference/tse-2026-leiautes.md).

### Identidade de trilha

`--trilha-accent` / `--trilha-accent-soft` dão identidade de navegação por
cargo (kicker, borda-topo do header, tab ativa, LiveBadge). São cores de
**navegação**, estáveis a noite inteira — não são cores de candidato nem de
partido (constituição § 2). O default no `:root` é neutro; cada página
declara a trilha no elemento `main`:

```css
main[data-trilha="pres"] { --trilha-accent: #17365c; --trilha-accent-soft: #dbe3ee; } /* 12.2:1 */
main[data-trilha="gov"]  { --trilha-accent: #1c4d3a; --trilha-accent-soft: #d7e6dd; } /* 9.7:1 */
```

## Status — variantes -strong (a11y-perf-auditor 2026-09-05)

`--color-success` (`#2c8e4a`) e `--color-warning` (`#d97706`) foram
auditados e falham WCAG 1.4.3 (meta ≥4.5:1) em todo uso que carrega
**texto** (rótulo, ou fundo sólido com texto branco por cima):

| Token base       | Hex       | Branco em cima | Como texto s/ `--color-bg-muted` |
| ----------------- | --------- | --------------- | --------------------------------- |
| `--color-warning` | `#d97706` | 3.18:1 ❌        | 3.05:1 ❌                          |
| `--color-success` | `#2c8e4a` | 4.14:1 ❌        | —                                  |

Mesmo padrão de `--color-cand-N-strong` (§ acima): o token base
**não muda** (segue servindo bordas, dots, fundos decorativos onde não
há texto por cima) e uma variante `-strong` escurecida cobre o caso
com texto:

| Token                     | Hex       | Branco em cima | s/ `--color-bg` (#fff) | s/ `--color-bg-muted` (#fafafa) |
| ------------------------- | --------- | --------------- | ----------------------- | --------------------------------- |
| `--color-warning-strong`  | `#b45309` | 5.02:1 ✅        | 5.02:1 ✅                | 4.81:1 ✅                          |
| `--color-success-strong`  | `#166534` | 7.13:1 ✅        | 7.13:1 ✅                | 6.83:1 ✅                          |

Consumidores trocados para `-strong` (todos tinham texto):
`components/blocks/GovernorCard.tsx` (chip "ELEITO"/"VAI A 2T", fundo
sólido + texto branco), `components/blocks/BreakingNewsTicker.tsx`
(rótulos "ÚLTIMAS CHAMADAS" e "AGORA", cor de texto),
`components/blocks/_NationalChoroplethMapImpl.tsx` (label "Chamada" no
tooltip). Mantidos no token base (decorativos, sem texto):
`app/uf/[sigla]/governador/page.tsx` (borda do aviso K-1),
`components/blocks/ForecastTransparency.tsx` (fill de barra) e
`components/atoms/charts/TurnoutAreaChart.tsx` (fill/stroke do gráfico).

Distinção vs paleta de candidato (constituição § 2): `--color-warning-strong`
(matiz 26°) e `--color-cand-3-strong` (matiz 33°, âmbar-tostado) têm ΔE76
17.3 — mais distintos que o par base já aceito hoje (`--color-warning` vs
`--color-cand-3`, ΔE76 11.8). `--color-success-strong` (matiz 143°, verde
puro) e `--color-cand-4-strong` (matiz 108°, verde-oliva) têm ΔE76 9.6 —
mesmo nível já aceito hoje entre `--color-success` e `--color-cand-4`
(ΔE76 9.6, ver "Tokens de participação" acima).

## Tokens editoriais neutros (spec 024/025 — ADR-0059, ADR-0060)

**Etiquetas editoriais** (spec 024, RF-235) e **mapa dos palanques** (spec 025 V3, RF-251)
não usam cor de partido. A constituição § 2 proíbe qualquer área de cor que fico a ΔE76 < 10
de uma cor da paleta de partido — confusão entre "candidato com chance" e "categoria editorial"
é justamente a armadilha. Ambas usam **apelidos de tokens semânticos do site**, que já trocam
de tema e já têm contraste medido nos dois temas:

### Etiqueta Editorial (`--etq-*`)

Moram em `components/atoms/data/EtiquetaEditorial.module.css`. Sem fundo:

| Token | Semântico | Valores | Contraste | Uso |
|---|---|---|---|---|
| `--etq-tinta` | `--text-primary` | Ink-0: #14171b | 16.34:1 (paper-1), 17.38 (paper-0) | Texto da etiqueta |
| `--etq-borda` | `--border-strong` | Ink-0: #14171b | idem | Borda tracejada 1px |
| `--etq-fundo` | — | `transparent` | — | Sem área de cor |

Estrutura: `<span>` inline com `border: 1px dashed`, `border-radius: 2px`, `text-transform: none` (caixa baixa), padding 1px × 4px, line-height 1.3. Dentro de um `<span>` do nome no cartão (spec 025 RF-245) ou da linha de UF (RF-246), nunca bloco. Nunca muda ordem. ΔE76 contra `--party-outros` (2,6) e menores cinzas da paleta é garantido pelo teste `tests/unit/design-system/etiqueta-editorial-contraste.test.tsx`.

### Palanques Mapa (`--pal-*`)

Moram em `components/blocks/PalanquesMapa.module.css`. Sem fundo; hachura (padrão SVG) + código de texto (2 caracteres):

| Token | Semântico | Valores | Contraste | Uso |
|---|---|---|---|---|
| `--pal-tinta` | `--text-primary` | Ink-0: #14171b | 16.34:1 sobre paper-1 | Hachura (stroke de `<pattern>`), texto do código |
| `--pal-borda` | `--border-strong` | Ink-0: #14171b | idem | Contorno do ladrilho (stroke width 1..2.5) |
| `--pal-papel` | `--surface-card` | #f3f4f6 | — | Paint-order de halo atrás do código |
| `--pal-quieto` | `--text-secondary` | Ink-1: #2a2f36 | 12.25:1 sobre paper-1 | Código e sigla quando sem leitura (palanque="nenhum") |
| `--pal-tenue` | `--border-hairline` | ??? (em desenvolvimento) | — | Contorno pontilhado de estado sem classificação |

Regra: texto **nunca é cor-only**; a hachura é sempre redundante (padrão em SVG), e o contorno casado/dividido é linha contínua vs tracejada + código "=" / "≠" (spec 025 RF-251 design). ΔE76 contra toda cor de partido nos dois temas, testado em `tests/unit/design-system/palanques-mapa-contraste.test.tsx`.

### Restrições da constituição 1.6

- § 2(d): paleta neutra com piso de ΔE76 ≥ 10 contra cores de partido — aqui garantido por teste.
- § 2(e): etiqueta nunca muda a ordem de candidatos — spec 025 RF-245 refuta com auxiliar de ordem invariante.
- § 4: código/redundância — regra deste catálogo, nunca só cor.
- § 8: link para `/sobre-as-etiquetas` em toda superfície com etiqueta — `<EtiquetasAviso />` (spec 025 RF-248).

## Cross-refs

- Constituição § 2 (neutralidade): [../constitution.md](../constitution.md#2-neutralidade-política)
- ADR-0013 (paleta multi-candidato + color lock): [../architecture/adrs/0013-tokens-multi-candidato-por-rank.md](../architecture/adrs/0013-tokens-multi-candidato-por-rank.md)
- ADR-0018 (hero 1T de termômetros — tokens `--color-part-*`): [../architecture/adrs/0018-termometros-hero-1t.md](../architecture/adrs/0018-termometros-hero-1t.md)
- ADR-0019 (identidade por trilha — `--trilha-accent*`): [../architecture/adrs/0019-identidade-visual-por-trilha.md](../architecture/adrs/0019-identidade-visual-por-trilha.md)
- Catálogo de componentes que consomem estes tokens: [./components.md](./components.md)
- Helper: [`lib/utils/cand-color.ts`](../../lib/utils/cand-color.ts)
- Grid: [./grid.md](./grid.md)
