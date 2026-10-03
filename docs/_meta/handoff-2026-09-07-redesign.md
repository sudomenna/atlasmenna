---
title: Handoff — 2026-09-07, redesign Atlas Menna + cargos Senador e Deputado
description: Plano aprovado, decisões do usuário, ADRs escritos e o que a próxima sessão executa primeiro
status: stable
branch: s07/simulado-ready-hero-1t
supersedes: handoff-2026-09-07.md (que continua válido para o estado do MODELO)
---

# Handoff — 2026-09-07 (redesign)

> **Este é o documento mais recente.** Ordem de leitura:
> este arquivo → [`handoff-2026-09-07.md`](./handoff-2026-09-07.md) (estado do **modelo**, ainda válido)
> → [`../sprints/2026-S07-f6-simulado-hero-1t.md`](../sprints/2026-S07-f6-simulado-hero-1t.md) (sprint viva).
> O plano completo do redesign está em `~/.claude/plans/indexed-painting-melody.md` (fora do repo)
> e resumido aqui na íntegra operacional.

## Estado em uma frase

O trabalho do modelo (Fases 3b/5) foi **commitado** em `5dee12d` como ponto de rollback, e a
sessão seguinte começa o **redesign completo da interface** sobre o design system "Atlas Menna",
direto na branch da S07, para rodar o simulado 1 (15–17/09) já na UI nova — mais duas specs
novas de cargo (Senador e Deputado Federal) até o 1º turno.

## O que aconteceu nesta sessão

1. **Commit `5dee12d`** — checkpoint do modelo: 44 arquivos das Fases 3b/5 (extrapolação sem 2022,
   pós-estratificação, correção do denominador de `pct_apurado`, replay honesto, ADR-0022/0023,
   BaseToggle desligado, specs 002/011 reescritas, sprints re-baselinadas). **Fora do commit**:
   `docs/_pitch/`, `tse_docs/Switchcraft.pdf`.
2. **Kit de design copiado** para `docs/design-system/atlas-menna/` (81 arquivos, 400 KB; sem
   `assets/geo/` — o AtlasMenna usa MapLibre + PMTiles). Ver o `README.md` de lá para rodar o
   protótipo (`npx serve docs/design-system/atlas-menna`).
3. **Três ADRs escritos** (ver § ADRs abaixo).
4. **Plano aprovado** pelo usuário, com seis decisões que **não devem ser reabertas**.

## Decisões do usuário — não reabrir

| # | Decisão | Ressalva dada |
|---|---|---|
| D1 | Escopo: **todas as 5 rotas**, incluindo `/sobre-o-modelo` | — |
| D2 | Janela: **agora, direto na branch `s07`**; a UI nova vai para o simulado 1 | risco de misturar mudança visual grande com a primeira ingestão de dado real |
| D3 | **Híbrido**: shell do design + **todos** os blocos RF-bound atuais restilizados; nenhum RF removido | — |
| D4 | **Cor por partido/federação** (ADR-0024, supersede ADR-0013, emenda § 2 da constituição) | muda um princípio invariante a 4 semanas do 1º turno; o usuário reafirmou |
| D5 | **4 cargos na navegação** (Presidente · Governador · Senador · Dep. Federal) | Senador/Deputado desabilitados até as specs shipparem |
| D6 | **Senador e Deputado Federal até 04/10** (specs 016 e 017) | não cabe na capacidade junto com o redesign sem risco ao núcleo presidencial; o usuário reafirmou |
| D7 | **Deputado atualiza a cada 15 min**; Senador a cada 5 min; ambos em granularidade UF | — |

Prioridade em caso de aperto: **P0 pipeline/simulado › P1 redesign › P2 Senador › P3 Deputado.**

## ADRs escritos nesta sessão

| ADR | Status | Conteúdo |
|---|---|---|
| [0024](../architecture/adrs/0024-paleta-editorial-por-partido.md) | **`proposed` — BLOQUEIA implementação de cor** | Paleta editorial por partido/federação, ΔE76 ≥ 10 contra o hex oficial. Supersede ADR-0013. Traz o **texto exato da emenda ao § 2** para o usuário aprovar. |
| [0025](../architecture/adrs/0025-design-system-atlas-menna-restyle-in-place.md) | `accepted` | Restyle-in-place (não árvore v2); tokens em Tailwind v4 `@theme static`; remoção de `tailwind.config.ts`; fontes Spectral/Archivo/JetBrains Mono via `next/font`; dark mode por `data-theme` + `localStorage`; remoção de `framer-motion` e `d3-*`. |
| [0026](../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) | `accepted` | Cargos 5 e 6: crons próprios (Senador 5 min, Deputado 15 min), granularidade UF, chave de UF com cargo, Vercel Blob como read path do drill-down de Deputado — **emenda** ao ADR-0001, não supersede. |

> ⚠️ **O ADR-0024 está `proposed` de propósito.** A constituição (preâmbulo, linha 11) exige ADR
> **mais** atualização versionada explícita para mudar um princípio. **Nenhum código de cor por
> partido deve ser escrito antes de o usuário aprovar o texto da emenda ao § 2** (o texto está na
> seção "Proposta de emenda" do ADR-0024). Aprovado o texto: editar `docs/constitution.md` de
> 1.2 → 1.3 com nota de cabeçalho no padrão das mudanças 1.0→1.1 e 1.1→1.2, virar o 0024 para
> `accepted` e marcar o 0013 como `superseded`.

## Achados verificados que mudam a leitura do código

- **`tailwind.config.ts` nunca foi carregado.** `app/globals.css:1` é só `@import "tailwindcss"`
  (v4, sem `@theme`/`@config`). Consequências reais hoje: `max-w-container` (3 usos) e
  `bg-bg-muted` (1) **não emitem CSS** — a home e `/governador` estão sem largura máxima —
  e `text-xs..4xl` (~178 usos) usam a escala default do v4, não os 12→48px que `tokens.md` afirma.
- **`@theme static` é obrigatório** (não `@theme` puro): sem `static` o Tailwind descarta variáveis
  não usadas em classe, e `lib/utils/cand-color.ts` — que lê tokens por `getComputedStyle` para
  alimentar o MapLibre em **hex** — passaria a receber string vazia. Mapa cinza, silenciosamente.
- **`framer-motion` e `d3-array/scale/shape` são dependências mortas**: zero imports reais em
  `app/`, `components/`, `lib/` (só aparecem em comentários e em `docs/design-system/animations.md`,
  que documenta código que não existe).
- **27 arquivos citam `--color-cand-*`** (24 testes + 3 fixtures JSON) — todos entram na mudança
  de cor por partido. O número "13" que circulou antes estava errado.
- **Senado 2026 tem 2 vagas por UF** (renovação de 2/3). O protótipo do kit diz "1 vaga" — está
  errado para 2026.
- **Orçamento de requisições**: granularidade zona (~2.600 zonas) com 2 cargos já consome ~173 s
  contra `maxDuration=180`. Cargos 5 e 6 **só cabem em granularidade UF** (27 GETs/ciclo cada),
  em crons próprios.
- **`@vercel/blob` está no `package.json` sem nenhum uso** — é a base do read path do Deputado.

### Duas correções ao que os ADRs afirmam (conferidas no disco em 07/09)

- **A chave de UF já é namespaced por cargo.** `lib/edge-config/reader.ts:170` monta
  `projection:uf:${sigla}:${cargo}:t${turno}` como chave primária, com fallback legado
  `projection:uf:${sigla}` só para a corrida ativa. O ADR-0026 propõe a forma
  `projection:uf:<cargo>:<sigla>`, que **inverte a ordem dos segmentos**. Use o formato que já
  existe (`projection:uf:<sigla>:<cargo>:t<turno>`) e não crie um segundo padrão de chave;
  ajuste o texto do ADR na primeira edição.
- **O orçamento de 512 KB é mais apertado do que parecia.** `lib/edge-config/writer.ts:158-168`
  avisa a partir de 450 KB, e `lib/edge-config/types.ts:22-26` documenta payload nacional de até
  ~75 KB e UF de até ~20 KB. Com Presidente + Governador + Senador o store fica perto do teto —
  **medir o tamanho real do store antes de adicionar o Senador**, e confirmar se o limite de
  512 KB da Vercel é por store ou por request (o ADR-0026 afirma "por store inteiro"; o código
  valida por request de escrita). Isso pode empurrar o Senador para Blob também.
- **Existem DOIS tipos `Cargo` e o modelo de calendário assume UMA corrida ativa por vez.**
  `lib/edge-config/types.ts:45` tem `Cargo = 1 | 3` (código TSE, numérico) e
  `lib/config/calendar.ts:24` tem `Cargo = "pres" | "gov"` (string). A chave real de UF usa a
  **string**: `projection:uf:<sigla>:pres:t1`. Pior: `currentRace()` (`calendar.ts:105`) devolve
  **uma** corrida ativa a partir de um calendário linear, e `readUfProjection`/`readProjection`
  usam esse default. Em 04/10 as quatro corridas acontecem **simultaneamente** — o modelo de
  "corrida ativa única" não comporta 4 cargos ao mesmo tempo. Isto **não é um detalhe de tipo**,
  é uma decisão de arquitetura que precisa ser resolvida no início do Bloco 3 (spec 016), antes
  de escrever qualquer código de Senador: ou a corrida ativa passa a ser explícita por rota
  (cada página declara seu cargo, `currentRace()` vira só default do 1T/2T presidencial), ou o
  calendário passa a devolver um conjunto. Recomendação: **explícita por rota** — as páginas de
  cargo já sabem qual cargo são.
- **`/api/ingest` não aceita override de cargos por query string** hoje (`route.ts:38` só lê
  `TSE_CARGOS` do ambiente). Os crons próprios do ADR-0026 dependem dessa extensão.

## Ordem de execução da próxima sessão

### Bloco 0 — fundação honesta (o que fazer primeiro)
Tudo isto é **behavior-neutral** e não depende da aprovação do § 2:

1. `@theme static` em `app/globals.css` com os **valores atuais** (nenhuma mudança visual) e
   `--container-page: 1280px`. Unificar os 7 wrappers `<main>` em `max-w-page`: **3 estão
   quebrados** com `max-w-container`, que não emite CSS (`app/page.tsx`, `app/governador/page.tsx`,
   `app/loading.tsx`) — essas três páginas ganham largura máxima que hoje não têm, então **compare
   screenshots antes/depois**; as outras **4 usam `max-w-[1280px]`** hardcoded e funcionam
   (`app/uf/[sigla]/page.tsx` ×2, `app/uf/[sigla]/governador/page.tsx` ×2), troca sem efeito
   visual. O único `bg-bg-muted` quebrado está em `components/blocks/DecisiveUFsGrid.tsx:128`.
2. Deletar `tailwind.config.ts`; remover `framer-motion` e `d3-*` do `package.json`.
3. Renomear as variáveis do `next/font` para `--font-sans-src`/`--font-serif-src` e mapear com
   `@theme inline` (evita colisão `@theme` × classe no `<html>`).
4. Criar `tests/e2e/perf-budget.spec.ts` (Playwright já configurado, `tests/e2e/` vazio): somar
   `request.sizes().responseBodySize` dos recursos `script` até o `load` → **baseline RNF-007a**
   (o chunk `nomodule` nunca é requisitado por navegador moderno, então sai por construção);
   classificar o chunk do MapLibre → RNF-007b; total → RNF-007c.
5. Verificar que o Biome aceita `@theme` (o `biome.json` inclui `**/*.css`).
6. Gate: `pnpm typecheck && pnpm lint && pnpm test` (545) + snapshot de
   `getComputedStyle(documentElement)` das `--*` idêntico antes/depois.

### Bloco 1 — tokens + atoms + home (só após o § 2 aprovado, para a parte de cor)
Tokens do design em 3 camadas; `scripts/gen-party-scale.ts` (intensidades por margem em **hex**
pré-computado, light e dark) e `lib/utils/party-color.ts`; fontes novas; atoms novos (`Panel`,
`Figure`, `Button`, `VoteBar`, `ProbabilityMeter`, `PartyTag`, `MapLegend`, `TopBar`, `TabBar`,
`ThemeToggle`, `Sheet`, `HoverCard`); `CandidateRow` com o visual do design; shell em
`app/layout.tsx` + `RaceLayout` + `RaceHeader` refatorado; home recomposta com todos os blocos
como `Panel`s + 3 blocos novos (`StrongholdsPanel`, `RemainingPanel`, `BulletinPanel`);
atualizar os 27 arquivos que citam `--color-cand-*`. Em paralelo: `map-builder` repinta o mapa
nacional (5 degraus por margem, traço cor de papel, rótulos mono, `HoverCard`).

### Bloco 2 — UF, governadores, sobre-o-modelo, dark mode
Duas frentes paralelas (`/uf/[sigla]` + `/uf/[sigla]/governador`; `/governador` +
`/sobre-o-modelo` saindo do CSS Module), depois dark mode com contraste medido por token.

### Gate G1 (meta 12/09)
Paralelo: `constitution-guard` · `a11y-perf-auditor` · `rf-coverage-checker` (003/004/005/006/011).
Sequencial: `spec-syncer`. Buffer 13–14/09. **15–17/09 congelar a UI nas janelas 9–12h e 14–17h.**

### Blocos 3 e 4 — specs 016 (Senador) e 017 (Deputado Federal)
Specs escritas em 08–09/09; código 15–24/09; validação no simulado 2. Detalhe completo no plano.
**Degradação pré-acordada do Deputado**: se em 19/09 o módulo de cadeiras não passar nos testes
golden de 2022, 017 shippa como "parcial por partido/federação, sem projeção de cadeiras";
se em 24/09 nem isso estiver verde, a aba fica desabilitada e o cargo vai para 2030.

## Invariantes da migração (quebrar isto quebra a suíte ou o mapa)

1. Nomes de arquivo/export dos 46 componentes **não mudam** (42 testes importam por nome).
   Nome novo do kit vira componente novo ou variante — nunca rename.
2. `@theme static`, sempre. Adicionar um teste que lê o CSS emitido e exige `--party-outros`.
3. Cores ligadas a dado continuam `style` inline com `var(--…)`; cromo vai para classes.
   Tokens lidos pelo MapLibre são **hex** — nada de `color-mix()`/`oklch()`.
4. `Footer` e `main[data-trilha]` continuam **de posse da página** (4–6 testes de página
   dependem disso). Só `TopBar`/`TabBar` entram em `app/layout.tsx`.
5. Zero JS client novo acima da dobra (RNF-007a não tem folga). O gate mede **delta ≤ 0**.
6. Tema por `localStorage` + script inline anti-flash. **Nunca** `cookies()` ou `searchParams`
   no layout — tornaria dinâmicas as 54 páginas de UF (precedente do `BaseToggle`).
7. Árvore verde (typecheck + vitest + lint) ao fim de **cada** bloco.

## Pendências herdadas (do handoff do modelo, ainda abertas)

- Tentativa 3 do gate OT-4 (MAE@1h 2,590/2,070 pp contra 2 pp; cobertura IC95 79,5%) — **bloqueia
  promover a spec 002 a `shipped`**. A ressalva epistêmica continua valendo: a ordem de apuração
  do replay é sintética.
- `compute_swing_descritivo`, `brancos_nulos` no mesmo `idx` dos candidatos, assert de percentil
  do RF-015.
- Caixa de contato do User-Agent antes de 15/09; chamado ao TSE em 12/09 se as URLs do simulado
  não saírem.
- Visão municipal cobre 2.180 de 5.572 municípios sem avisar o leitor (dívida sob a constituição § 8).
- `spec-syncer` ainda não propagou os ADRs 0024–0026 para `index.json`, `traceability.md` e as
  specs — fazer depois que o 0024 for aceito.
