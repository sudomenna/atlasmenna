# AtlasMenna — Documentação

Documentação Spec-Driven Development (SDD) do AtlasMenna — plataforma web pública para apuração das eleições brasileiras de 2026 com projeção estatística em tempo real.

> **Versão**: SDD v1.0 (picotada do PRD v0.1 em 2026-05-17)
> **Status do código**: 8 rotas em produção (Presidente, Governador, Senador, Deputado Federal + páginas de suporte), 3.492 testes de unidade, 626 testes de integração
> **Owner**: Tiago Menna · menna@outsiders.digital

---

## Por onde começar

| Você quer... | Vá para |
|---|---|
| Entender o produto em 2 minutos | [product/vision.md](./product/vision.md) |
| Ver os princípios não-negociáveis | [constitution.md](./constitution.md) |
| Trabalhar numa feature | [specs/](./specs/) |
| Entender a arquitetura | [architecture/overview.md](./architecture/overview.md) |
| Ver decisões de design técnico | [architecture/adrs/](./architecture/adrs/) |
| Ver metas de performance/a11y/etc | [nfr/](./nfr/) |
| Ver cronograma macro (F1–F8) | [product/roadmap.md](./product/roadmap.md) |
| Ver planejamento de sprints | [sprints/](./sprints/) |
| Ver sprint ativa | `grep -l "status: active" docs/sprints/*.md` |
| Ver matriz de cobertura RF→spec→teste | [_meta/traceability.md](./_meta/traceability.md) |
| Carregar o índice via agente de IA | [_meta/index.json](./_meta/index.json) |
| Ver o PRD original (snapshot v0.1) | [PRD.md](./PRD.md) |

---

## Specs (23)

| # | Spec | Status | Prioridade | Telas |
|---|---|---|---|---|
| 001 | [Ingestão TSE](./specs/001-ingestao-tse/) | shipped | M | — |
| 001.1 | [Refactor parser TSE EA20→JSON](./specs/001.1-tse-json-refactor/) | superseded | M | — |
| 002 | [Modelo estatístico](./specs/002-modelo-estatistico/) | implementing | M | — |
| 003 | [Home Nacional Presidencial](./specs/003-home-nacional/) | shipped | M | T-01 |
| 004 | [Página UF Presidencial](./specs/004-pagina-uf-presidencial/) | shipped | M | T-03 |
| 005 | [Página UF Governador](./specs/005-pagina-uf-governador/) | shipped | M | T-04 |
| 006 | [Grid Governadores](./specs/006-grid-governadores/) | shipped | M | T-02 |
| 008 | [Interatividade Brushing](./specs/008-interatividade-brushing/) | draft | M | transversal |
| 009 | [Compartilhamento e Meta](./specs/009-compartilhamento-meta/) | draft | S | transversal |
| 010 | [Operação e Monitoramento](./specs/010-operacao-monitoramento/) | draft | M | T-07 |
| 011 | [Sobre o Modelo](./specs/011-sobre-o-modelo/) | shipped | M | T-06 |
| 012 | [Dashboard /_status](./specs/012-dashboard-status/) | draft | M | T-07 |
| 013 | [Página de Manutenção](./specs/013-pagina-manutencao/) | ready | M | T-08 |
| 014 | [Boca de urna + recorte demográfico](./specs/014-boca-de-urna/) | draft | S | — |
| 015 | [Drill-down município](./specs/015-drill-down-municipio/) | draft | S | — |
| 016 | [Senador](./specs/016-senador/) | draft | M | T-09, T-10 |
| 017 | [Deputado Federal](./specs/017-deputado-federal/) | shipped | M | T-11, T-12 |
| 018 | [Identidade de Candidatura](./specs/018-identidade-candidatura/) | draft | M | T-13, T-14 |
| 019 | [Fase pré-eleição](./specs/019-fase-pre-eleicao/) | draft | M | T-15, T-16 |
| 020 | [Evolução da apuração](./specs/020-evolucao-da-apuracao/) | draft | M | T-01, T-03, T-04, T-10 |
| 021 | [Votação — o eleitorado inteiro](./specs/021-votacao-eleitorado/) | draft | M | T-01, T-03, T-10, T-12 |
| 022 | [A corrida em três círculos](./specs/022-corrida-em-tres-circulos/) | implementing | M | T-01, T-03, T-10 |
| 023 | [Senado de 2027](./specs/023-senado-2027/) | implementing | M | T-09 |
| 024 | [Etiquetas editoriais](./specs/024-etiquetas-editoriais/) | implementing | M | — |
| 025 | [Visões editoriais](./specs/025-visoes-editoriais/) | implementing | S | T-02, T-09, T-10, T-13 |

Cada spec contém `spec.md` (requirements em EARS) e `design.md` (decisões técnicas). `tasks.md` será adicionado no início da implementação de cada uma.

---

## Estrutura

```
docs/
├── README.md                          # você está aqui
├── PRD.md                             # snapshot v0.1 (read-only)
├── constitution.md                    # princípios não-negociáveis
├── product/                           # vision, personas, use-cases, metrics, roadmap
├── specs/                             # 20 specs (1 superseded: 001.1; 19 ativas)
├── architecture/                      # overview, stack, data, APIs, ADRs
├── design-system/                     # tokens, grid, components, animations
├── mapas/                             # PMTiles, MapLibre, brushing, mobile
├── nfr/                               # performance, a11y, security, observability
├── testing/                           # unit, integration, e2e, replay, load
├── operations/                        # runbook, alerts, deployment, checklist
├── reference/                         # glossário, fontes, regulação, riscos
└── _meta/                             # conventions, traceability, index.json
```

---

## Convenções

Antes de criar/editar specs, ler [_meta/conventions.md](./_meta/conventions.md):

- IDs e nomenclatura (RF-NNN, RNF-NNN, T-NN, ADR-NNNN).
- Frontmatter padrão de `spec.md` e `design.md`.
- Sintaxe EARS para requisitos: `WHEN/WHILE/IF/WHERE <gatilho>, the system SHALL <comportamento>`.
- Cross-refs por path relativo, sem duplicação de conteúdo.
- PRD.md é read-only — toda edição vai pras specs.

---

## Status atual

- **Documentação**: contagens medidas no disco em 2026-09-19 — **153 RFs** (66 do PRD: RF-001..RF-060 mais RF-030.1..RF-030.6; 87 acrescentados pelas specs), todos na matriz principal de [_meta/traceability.md](./_meta/traceability.md); **49 ADRs** (46 accepted + 3 superseded); **37 RNFs** vigentes (35 IDs-base RNF-001..RNF-035, sendo que RNF-007 não vale sozinho e conta como RNF-007a/b/c); **20 specs** (19 ativas + 1 superseded: 001.1).
  > **Critério**, para os números pararem de divergir entre arquivos: RF com sufixo decimal conta como identificador próprio (`RF-030` e `RF-030.1` são dois); ADR é arquivo `.md` no diretório; RNF "vigente" exclui o ID desdobrado e inclui os desdobramentos, e não conta `RNF-007a-floor`, que é linha informacional. Os mesmos critérios estão escritos em [_meta/traceability.md](./_meta/traceability.md) §§ Cobertura, RNFs e ADRs.
- **Código**: Implementação em progresso (S07 Fase 8: specs 001–006 + 016 shipped/implementing; **017 (Deputado Federal) implementada em 12/09, `shipped`, 4 gates PASS**; specs 002/008-013 em draft/ready; specs 014-015 diferidas; spec 019 em draft).
- **Próximo passo**: Simulado TSE 1 (15–17/09) — ver [roadmap](./product/roadmap.md) e [sprint S07 ativa](./sprints/2026-S07-f6-simulado-hero-1t.md).
