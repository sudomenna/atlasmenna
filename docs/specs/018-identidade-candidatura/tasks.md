---
id: 018-identidade-candidatura
type: tasks
status: in_progress
spec: docs/specs/018-identidade-candidatura/spec.md
started: 2026-09-29
scope: RF-214 (emenda ADR-0058) — frente C do plano de 29/09; ADR-0062 item 2 (alinhamento)
---

# Tasks — spec 018, emenda RF-214 (trajetória na Câmara)

Escopo **só** da emenda RF-214 e do importador de alinhamento que a acompanha
(ADR-0062 item 2). Os RFs originais da spec (RF-140..152) não são tocados aqui.

Porte do worktree `agent-acd2b01db6bdcd962` (base `92c4492`, 26/09), onde o
trabalho existia como RF-200 / ADR-0053 — os dois números colidiam com a
`main` e foram renumerados para **RF-214** e **ADR-0058** em todo arquivo,
comentário e teste portado. O ADR-0053 antigo e a nota ao ADR-0039 **não** foram
portados: a `main` já tem as versões renumeradas.

## Entregue agora (ADR-0058 item 5, "entra agora")

- [x] T1. `data-pipeline/trajetoria-camara.ts` — casamento puro (normalização,
  `casaAproximado`, `calcularTrajetoria`, parsing das fontes da Câmara). Mecânica
  **idêntica** à do worktree (diff só em comentário); `literalArrayInt`
  (serializador do `UNNEST` do import) ficou com a perna estacionada. (RF-214)
- [x] T2. `data-pipeline/trajetoria-camara-fonte.ts` — cache `build/camara/`,
  timeout + novas tentativas, sanidade 500–513 / ≥ 7.000; **novo modo
  `somenteCache`**: nunca rede, nunca `mkdir`/escrita no diretório — cache
  ausente lança. (RF-214)
- [x] T3. `data-pipeline/trajetoria-camara-calculo.ts` — `trajetoriaDaLinha`
  mudou para cá: é o **único** ponto que lê `DT_NASCIMENTO` e
  `NM_SOCIAL_CANDIDATO`, fora do caminho de import. Universo = o mesmo recorte
  do import (`unirCandidaturas` com `cargo: 6`, sem alterá-lo); só cache salvo
  `camaraRefresh`. (RF-214)
- [x] T4. `data-pipeline/trajetoria-camara-paridade.ts` — adaptado à saída nova
  do cálculo (sem `CandidatoRow` estendido). (RF-214)
- [x] T5. `data-pipeline/trajetoria-exportar.ts` + `pnpm trajetoria:exportar` —
  grava `editorial/derivados/trajetoria-camara.json` no formato contratado,
  já no formato do `biome`. (RF-214)
- [x] T6. `data-pipeline/alinhamento-importar.ts` + `pnpm alinhamento:importar`
  (o script passa `--corte 2026-09-03`) — lista branca de 3 colunas, recusa de
  coluna de dado pessoal, recusa de `raw/` e `votos.csv`, sha256 da entrada,
  guarda de escala. (ADR-0062 item 2; RF da spec de etiquetas, a criar)
- [x] T7. Testes: `trajetoria-camara`, `-fonte`, `-calculo`, `trajetoria-exportar`,
  `alinhamento-importar`, `derivados-editoriais` (os dois JSON versionados) em
  `tests/unit/data-pipeline/`; fixture sintética em `_trajetoria-fixtures.ts`.
- [x] T8. Execução real dos dois exportadores e da paridade (abaixo).
- [x] T9. Spec 018: RF-214 em EARS, `requirements:` + `adrs:` (0058), cross-ref.

## Estacionado até depois de 25/10 (só com autorização do dono)

Fica no branch do worktree `agent-acd2b01db6bdcd962`, **intocado**:

- [ ] migration `data-pipeline/migrations/0011_candidatos_trajetoria_camara.ts`
- [ ] colunas `trajetoria_camara` / `camara_ids` em `lib/db/schema.ts`
- [ ] integração em `candidatos-import.ts` e `candidatos-parse.ts`
  (`CandidatoRow` 19 → 21 chaves; o teste de conjunto de chaves da `main`
  continua travando em 19)
- [ ] backfill (`trajetoria-camara-backfill.ts`, `-backfill-plano.ts`) e testes
- [ ] o bloco "[⚠️ REGRESSÃO]" do worktree

Motivo: `docs/operations/vespera-03-10.md:90` roda `pnpm candidatos:import`
contra produção em 03/10, onde as colunas da 0011 não existem.

## Execução real — 29/09/2026 (sem banco, sem rede)

Caches: TSE `build/tse-archives` do repositório principal (gerado pelo TSE em
12/09/2026 19:31:30); Câmara `build/camara` do worktree antigo (26/09, só
leitura — mtimes conferidos antes e depois).

| Saída | Tamanho | Conteúdo |
|---|---|---|
| `editorial/derivados/trajetoria-camara.json` | 473.320 B | universo 7.791 · `em_exercicio` 439 · `legislatura_atual` 70 · `mandato_anterior` 197 · `estreante` 7.085 · 0 SQ duplicado · 0 candidatura com > 1 deputado |
| `editorial/derivados/alinhamento-camara.json` | 43.605 B | 643 deputados (612 com ≥ 30 votos disputados) · corte 2026-09-03 · sha256 `84e3c8e4…31d3a0` |

**Paridade** (`trajetoria-camara-paridade.ts` contra
`alinhamento-governo-camara/referencia_trajetoria.csv`): **7.791/7.791 iguais**
em categoria (4 categorias), ids da Câmara e modo de casamento; exit 0. Os
limites do que isso prova estão no ADR-0058 § Paridade.

**Corte conferido à mão** (não pelo importador, que lê só 3 colunas): a última
votação em `votacoes.csv` do projeto externo é de 2026-09-03, e o máximo de
`ultima_votacao` em `alinhamento.csv` também. A escala de
`taxa_alinhamento_disputadas` é percentual: mínimo 0,0, máximo 100,0, uma casa.

**Junção trajetória × alinhamento** (regra do dono: ≥ 65 Base · ≤ 35 Oposição;
< 30 votos disputados → critério do partido): 706 candidaturas de cargo 6 com
exatamente 1 id da Câmara; 508 têm linha no alinhamento (438 `em_exercicio` +
70 `legislatura_atual`; 1 em exercício sem linha, provável suplente empossado
depois do corte); 20 com < 30 disputadas; **488 rotuláveis pela taxa: Base 331
· Independente 47 · Oposição 110**. Os 197 `mandato_anterior` não têm voto na
57ª e caem no critério do partido.

## Mutações à mão — 29/09/2026

Cada mutação aplicada sozinha, suíte do módulo rodada, arquivo restaurado e
conferido por sha256.

| # | 🔴 MUTAÇÃO | Resultado | Teste que mata |
|---|---|---|---|
| M1 | Exportador descarta os estreantes (`continue` em `estreante`) | 🔴 MUTAÇÃO morta (4 falhas) | `trajetoria-exportar` › "TODA candidatura do universo está presente", "universo … bate com as chaves" |
| M2 | `universo` contado errado (só quem tem mandato) | 🔴 MUTAÇÃO morta (1) | `trajetoria-exportar` › "universo é a contagem … e bate com as chaves" |
| M3 | Dado pessoal vaza: `trajetoriaDaLinha` devolve o nascimento e o exportador espalha o objeto na entrada | 🔴 MUTAÇÃO morta (5) | `trajetoria-camara-calculo` › "o que sai do cálculo não carrega data…"; `trajetoria-exportar` › "formato exato, chave a chave", "é JSON que volta idêntico". O teste de texto não caiu porque o serializador escreve só `t` e `camara_ids` — lista branca também na escrita |
| M4a | Importador aceita coluna proibida (recusa desligada) | 🔴 MUTAÇÃO morta (9) | `alinhamento-importar` › "RECUSA cabeçalho com …" (8 casos) + "lista TODAS" |
| M4b | Recusa por nome exato e com caixa (`DT_NASCIMENTO`, `nr_cpf` passariam) | 🔴 MUTAÇÃO morta (4) | `alinhamento-importar` › "RECUSA … DT_NASCIMENTO / NOME_CIVIL / nr_cpf / ufNascimento" |
| M5a | Escala da taxa trocada (÷ 100) | 🔴 MUTAÇÃO morta (4) | `alinhamento-importar` › "a taxa sai na MESMA escala do CSV (0–100)" |
| M5b | Guarda de arquivo inteiro em fração (0–1) removida | 🔴 MUTAÇÃO morta (1) | `alinhamento-importar` › "arquivo inteiro em fração (0–1) é recusado" |
| M6 | Modo só-cache cai no download | 🔴 MUTAÇÃO morta (1) | `trajetoria-camara-fonte` › "somenteCache com cache ausente lança SEM tocar a rede" |
| M7 | Segundo ponto de leitura de `DT_NASCIMENTO` (no `candidatos-parse.ts`) | 🔴 MUTAÇÃO morta (1) | `trajetoria-camara-calculo` › "só trajetoria-camara-calculo.ts lê as colunas…" |
| M8 | Ordem lexicográfica das chaves (em vez de numérica) | 🔴 MUTAÇÃO morta (2) | `trajetoria-exportar` › "chaves em ordem numérica crescente" |

## Pendências fora desta frente

- `docs/_meta/traceability.md` e `docs/_meta/index.json` (RF-214 → spec 018,
  testes) — `spec-syncer`, na barreira.
- `docs/architecture/folder-structure.md` — emenda para `editorial/derivados/`
  (ADR-0062 cita como pendente).
- O RF do importador de alinhamento pertence à spec de etiquetas editoriais
  (a criar); hoje ele é governado só pelo ADR-0062.
