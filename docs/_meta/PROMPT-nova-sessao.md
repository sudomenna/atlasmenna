---
title: Prompt para iniciar a próxima sessão
description: Copie o bloco abaixo inteiro como primeira mensagem de uma sessão zerada
status: stable
---

# Prompt para a próxima sessão

Copie **tudo** dentro do bloco abaixo como a primeira mensagem.

---

```
Continuando o AtlasMenna. Leia primeiro, nesta ordem:

1. docs/_meta/handoff-2026-09-07-redesign.md   (estado atual — comece por aqui)
2. docs/architecture/adrs/0025-design-system-atlas-menna-restyle-in-place.md
3. docs/architecture/adrs/0024-paleta-editorial-por-partido.md   (status: proposed — leia a
   seção "Proposta de emenda ao § 2" e me peça aprovação ANTES de escrever código de cor)
4. docs/architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md
5. docs/design-system/atlas-menna/readme.md   (o kit de design; tokens em tokens/*.css)
6. docs/sprints/2026-S07-f6-simulado-hero-1t.md   (sprint ativa)

Branch: s07/simulado-ready-hero-1t. Árvore limpa fora de docs/_pitch/ e tse_docs/. O commit
5dee12d é o checkpoint do modelo (Fases 3b/5) e serve de ponto de rollback. Hoje é 2026-09-07
(ajuste se for outro dia). Simulados oficiais do TSE em 15-17/09 e 22-24/09; 1º turno 04/10.

Rodar testes exige: set -a; . ./.env.local; set +a
Baseline: 545 vitest, 145 pytest, typecheck limpo, lint 0 erros / 5 warnings.
O gate OT-4 do replay REPROVA — é esperado, está explicado no handoff do modelo
(docs/_meta/handoff-2026-09-07.md), e não bloqueia o redesign.

O QUE VAMOS FAZER: refazer a interface inteira sobre o design system "Atlas Menna" (editorial,
papel/tinta, Spectral/Archivo/JetBrains Mono, seções separadas por filetes, Parcial em tinta ×
Projeção em ocre, tema claro/escuro), direto nesta branch, para o simulado 1 já rodar na UI
nova; e implementar dois cargos novos, Senador (spec 016) e Deputado Federal (spec 017), até
o 1º turno. Seis decisões minhas já estão tomadas e NÃO devem ser reabertas — estão na tabela
"Decisões do usuário" do handoff.

COMECE PELO BLOCO 0 (fundação, behavior-neutral, não depende de aprovação nenhuma):
  1. Migrar os tokens de app/globals.css para Tailwind v4 `@theme static` com os VALORES
     ATUAIS (zero mudança visual). `static` é obrigatório — sem ele o Tailwind descarta
     variáveis não usadas em classe e lib/utils/cand-color.ts passa a devolver string vazia
     para o MapLibre, deixando o mapa cinza em silêncio.
  2. `--container-page: 1280px` e unificar os 7 wrappers <main> em max-w-page. Atenção: 3 deles
     usam max-w-container, que HOJE NÃO EMITE CSS — a home, /governador e o loading estão sem
     largura máxima e vão MUDAR visualmente; compare screenshots. Os outros 4 usam
     max-w-[1280px] hardcoded e a troca é neutra.
  3. Deletar tailwind.config.ts (nunca foi carregado) e remover framer-motion e d3-* do
     package.json (zero imports reais).
  4. Renomear as variáveis do next/font para --font-*-src e mapear com `@theme inline`.
  5. Criar tests/e2e/perf-budget.spec.ts com a receita do handoff e registrar a BASELINE de
     RNF-007a/b/c — todo bloco seguinte tem que medir delta ≤ 0.
  6. Gate: pnpm typecheck && pnpm lint && pnpm test, mais um snapshot de
     getComputedStyle(documentElement) antes/depois que precisa sair idêntico.

DEPOIS DO BLOCO 0, PARE E ME PERGUNTE duas coisas antes de seguir:
  (a) aprovação do texto da emenda ao § 2 da constituição (está no ADR-0024) — sem isso não
      existe código de cor por partido;
  (b) como resolver o "corrida ativa única" de lib/config/calendar.ts, que não comporta os 4
      cargos simultâneos de 04/10 (o handoff explica e recomenda uma saída).

INVARIANTES que quebram a suíte ou o mapa se forem violadas — estão listadas no handoff, mas
as três que mais importam: nomes de arquivo/export dos 46 componentes NÃO mudam; Footer e
main[data-trilha] continuam de posse da página (não vão para o layout); zero JS client novo
acima da dobra.

Trabalhe em blocos, com a árvore verde ao fim de cada um, e delegue para os subagents do
projeto (spec-implementer, map-builder, a11y-perf-auditor, constitution-guard,
rf-coverage-checker, spec-syncer, adr-author, tse-parser-builder, model-validator). Confira no
disco o que cada subagent reportar antes de aceitar — nesta sessão três ADRs vieram com uma
afirmação errada cada, todas plausíveis.
```

---

## Contexto extra (não precisa colar)

- O plano completo, com cronograma por bloco e a matriz componente-a-componente, está em
  `~/.claude/plans/indexed-painting-melody.md` (fora do repositório).
- O kit de design roda com `npx serve docs/design-system/atlas-menna` — abrir por `file://`
  não funciona, e o mapa do protótipo fica vazio porque `assets/geo/` ficou fora do repo.
- Handoff anterior (estado do **modelo**, ainda válido para OT-4 e pendências do Python):
  [`handoff-2026-09-07.md`](./handoff-2026-09-07.md).
