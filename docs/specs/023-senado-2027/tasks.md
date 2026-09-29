---
id: 023-senado-2027
type: tasks
status: in_progress
spec: docs/specs/023-senado-2027/spec.md
started: 2026-09-29
---

# Tasks — spec 023 (Senado de 2027)

Frente A do plano de 29/09. Worktree isolado a partir de `a791e6d`; sem commit (o orquestrador
mescla). Base do vitest no worktree: **4208 passando**; 10 arquivos não coletam por falta de
`DATABASE_URL` (worktree sem `.env.local` — correto, e anterior a esta frente).

## Documentação

- [x] T1. `spec.md`, `design.md`, `tasks.md` (RF-215..RF-219, faixa reservada conferida por grep:
      nenhum uso anterior). ADRs: 0061 (hemiciclo generalizado) e 0062 (fontes parlamentares).
- [x] T2. Emenda à spec 016 — o "Fora" das 27 vagas aponta para esta spec.

## Geometria (`lib/utils/hemiciclo.ts`)

- [x] T3. `ARCOS_CAMARA`/`ARCOS_SENADO`, opção `arcos` em `arcosPara`/`layoutHemiciclo`,
      `theta`/`centro`/`raios` no layout, `marcaDeLimiar`, `pontoNoAngulo`, `EPS_ANGULO`
      (RF-216, D1, D7). 81 em 5 arcos = **10/13/16/19/23** (o plano dizia 22 no externo: soma 80).

## Componentes

- [x] T4. Retrato do `<CamaraHemiciclo>` **antes** da extração
      (`tests/fixtures/hemiciclo/camara-retrato.json`, gerado sobre `a791e6d`, 10 casos).
- [x] T5. `components/blocks/Hemiciclo.tsx` + `<CamaraHemiciclo>` casca, retrato igual (D5).
- [x] T6. `ordenarBancada` genérica (D4).

## Dado

- [x] T7. `lib/senado/mandato-2031.ts` — `validarFotoSenado` (27 um-por-UF / 54 dois-por-UF,
      partido da paleta ou `"S/Partido"` exato, legislatura final, `codigo_mandato` único, lista
      branca), `MANDATO_2031`, `dataDaFoto` (RF-215).
- [x] T8. `editorial/senado/mandato-2031.json` (27) e `mandato-2027.json` (54), foto de
      2026-09-29T04:47:02Z, versão do dado "29/09/2026 01:46:55". Gerados pelo script de T9 a
      partir da resposta salva pelo spike; conferidos linha a linha contra a saída independente
      do spike (0 diferenças).
- [x] T9. `data-pipeline/senado-mandatos-snapshot.ts` + `pnpm senado:snapshot` (acionado pelo
      dono; `--seco`, `--de-arquivo … --consultado-em …`). Até 8 tentativas com `retry-after`
      (mínimo 15 s); invariantes antes de gravar; gravação temporário + rename; JSON na forma do
      `biome format` (senão o pre-commit reprova a foto). Recorte da resposta em
      `tests/fixtures/senado/lista-atual.recorte.json`, com nome civil e e-mail trocados por
      marcadores.

## Derivação e tela

- [x] T10. `lib/utils/senado-2027.ts` — `derivarSenado2027`, fail-closed, "Sem partido"
      (RF-216, RF-217).
- [x] T11. `components/blocks/SenadoHemiciclo.tsx` — hemiciclo, legenda, lista, data, nota do
      suplente, painel com log `[senado-2027]` (RF-216, RF-218).
- [x] T12. `/senador`: painel logo depois da barra; barra na paleta de partido (RF-216, RF-219).

## Testes e mutações

- [x] T13. Testes: `hemiciclo-casas` (19), `camara-hemiciclo-retrato` (12), `senado-mandato-2031`
      (20), `senado-mandatos-snapshot` (15), `senado-2027` (24), `SenadoHemiciclo` (18),
      `senado-hemiciclo-peso` (2), `senador` (+8) — **+118**.
- [x] T14. Mutações à mão (registro abaixo).
- [x] T15. `pnpm lint` limpo, `pnpm typecheck` limpo, `pnpm test` **4208 → 4326 passando**, 0
      falhas; os mesmos 10 arquivos sem `DATABASE_URL` que já não coletavam antes.
- [x] T16. Navegador (`FIXTURE_VARIANT=sim next dev`, porta própria, worktree sem `.env.local`):
      `/senador` com 81 bolinhas, lista e data da foto; barra das 54 com `--party-*-text`; 375 px
      sem rolagem lateral (`scrollWidth` 375, nenhum elemento do bloco fora da tela); tema claro
      e escuro. Com o fixture de `pnpm dev` puro (`sen-current.json`, sem `partido` nos
      `top_candidatos`) o bloco **some** por `divergencia_composicao` — a recusa funcionando.

## Pendências (fora desta frente)

- `docs/_meta/traceability.md`, `index.json`, `docs/README.md`, `components.md`,
  `folder-structure.md` (pasta `editorial/` nova) — `spec-syncer`, na barreira.
- Portões: `constitution-guard`, `a11y-perf-auditor` (`/senador` nas rotas e2e de peso e axe),
  `rf-coverage-checker`.

## 🔴 MUTAÇÃO — registro

Aplicadas à mão em 2026-09-29, uma de cada vez, com o arquivo restaurado e conferido por `cmp`
depois de cada uma.

| # | mutação | onde | resultado |
|---|---|---|---|
| 1 | soma ≠ 81: pular um senador da foto no laço das que continuam | `lib/utils/senado-2027.ts` | 🔴 morta — 37 falhas (derivação, componente, página) |
| 2 | marca em `k`/`k+1` em vez de `k−1`/`k` | `lib/utils/hemiciclo.ts::marcaDeLimiar` | 🔴 morta — 4 falhas (propriedade de separação no Senado e na Câmara, marca 41, marca 40) |
| 3 | conferência com `composicao_vagas` removida (`if (false)`) | `lib/utils/senado-2027.ts` | 🔴 morta — 5 falhas (derivação ×3, painel, página) |
| 4 | barra das 54 de volta a `var(--color-cand-${i + 1})` | `app/(sen)/senador/page.tsx` | 🔴 morta — 2 falhas (RF-219 ×2) |
| 5 | cadeira que continua rotulada "eleitos em 2022" | `components/blocks/SenadoHemiciclo.tsx` | 🔴 morta — 3 falhas (varredura `eleit` no componente e na página, legenda) |
| 6 | contorno 0,42 → 0,4 | `components/blocks/Hemiciclo.tsx` | 🔴 morta — 9 falhas (retrato da Câmara) |
| 7 | `{...t.dados}` depois de `fill` (ordem de atributo) | `components/blocks/Hemiciclo.tsx` | 🔴 morta — 8 falhas, **só no retrato**: os testes antigos da Câmara não enxergam ordem de atributo; é por isso que o retrato existe |
| 8 | "decidida" com `>` em vez de `>=` 100 | `lib/utils/senado-2027.ts` | 🔴 morta — 8 falhas |
| 9 | sem `queCompetem` (anulada ocupa vaga) | `lib/utils/senado-2027.ts` | 🔴 morta — 24 falhas |
| 10 | reordenar `top_candidatos` por `pct` antes de cortar | `lib/utils/senado-2027.ts` | 🔴 morta — 1 falha (caso dedicado) |
| 11 | "S/Partido" sem caso especial (cai em `outros`) | `lib/utils/senado-2027.ts` | 🔴 morta — 2 falhas (derivação, componente) |

⚠️ A mutação 11 **não** é pega pelos testes da página, embora a foto real tenha um senador sem
partido (RJ): de propósito, os casos da página não fixam o conteúdo da foto real — ela é refeita
pelo dono e os números mudam. Quem trava a regra é a fixture fictícia.
