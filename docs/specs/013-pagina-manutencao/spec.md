---
id: 013-pagina-manutencao
title: Página de Manutenção (T-08)
status: ready
priority: M
personas: [eleitor-geral, midia]
screens: [T-08]
requirements: [RF-058, RF-058.1, RF-058.2]
depends_on: []
apis: []
components: [MaintenancePageMessage, TurnoTransitionBanner]
nfr: [RNF-012, RNF-022, RNF-028]
adrs: [0001]
---

# Spec 013 — Página de Manutenção

**Rota**: `/manutencao`

## Objetivo

Página de fallback servida em **dois modos**, ambos NYT-style minimalistas:

1. **Indisponibilidade técnica** (modo "fallback"): todos os endpoints down — mensagem amigável + link para `resultados.tse.jus.br`. Último recurso.
2. **Transição entre 1º e 2º turno (D1→D2)** (modo "transicao", S06/F4d carry-over): janela ~21 dias entre 04/10/2026 e 25/10/2026. Conteúdo NYT-style explicando "Estamos preparando o 2º turno — volte em [data]" + recap do resultado oficial do 1º turno.

Ativação é **admin flag** (Edge Config `maintenance:mode` ∈ `"off" | "fallback" | "transicao"`). Lógica de ativação fica em [spec 010](../010-operacao-monitoramento/) — esta spec entrega só a página.

## Escopo

**In**:
- Página estática (sem fetch ao TSE / Postgres).
- Lê **apenas** `maintenance:mode` e `maintenance:context` (transição) do Edge Config — ambos ≤ 1 KB ([ADR-0001](../../architecture/adrs/0001-edge-config-no-read-path.md)).
- Modo `fallback`: mensagem genérica + link `resultados.tse.jus.br` + data/hora de última tentativa (best-effort).
- Modo `transicao`: hero recap 1T (placar nacional final + bandeira de quem vai a 2T) + countdown até 25/10 + CTA "Voltar em [data]".
- Manter brand do AtlasMenna (`<Footer />` constituição § 1, tipografia serif).
- Meta/OG ([RNF-028](../../nfr/seo.md)) — preview de share dignifica o estado da página.

**Out**:
- Lógica de quando ativar (escopo [spec 010](../010-operacao-monitoramento/)).
- Recap detalhado por UF (ler `projection:archive:pres:t1` é OK pro hero, mas drill-down por UF redireciona pra `/uf/[sigla]` com banner de "resultado consolidado").
- Componente novo de countdown — usa primitivo `<TurnoTransitionBanner />`.

## Requisitos Funcionais (EARS)

**RF-058 — Modo manutenção amigável**

IF todos os endpoints estiverem indisponíveis, the system SHALL servir `/manutencao` com mensagem amigável + link para `resultados.tse.jus.br`.

**Aceitação**:
- Given Edge Config indisponível (modo `fallback` ativo), when usuário acessa `/`, then é redirecionado para `/manutencao` com hero "fallback".
- Given `/manutencao` carrega em modo `fallback`, when usuário lê, then encontra link visível para `resultados.tse.jus.br` e timestamp da última tentativa.
- Given usuário com `prefers-reduced-motion: reduce`, when carrega `/manutencao`, then nenhuma animação dispara (constituição § 4).

**RF-058.1 — Modo transição 1T→2T**

WHEN `maintenance:mode === "transicao"`, the system SHALL servir `/manutencao` com layout NYT-style mostrando recap do 1T + countdown até 25/10/2026.

**Aceitação**:
- Given `maintenance:mode === "transicao"` e `maintenance:context.until_iso === "2026-10-25T08:00:00-03:00"`, when usuário acessa `/`, then vê o hero "Estamos preparando o 2º turno" com data formatada "domingo, 25 de outubro" e countdown em dias.
- Given recap está no Edge Config (`projection:archive:pres:t1`), when página renderiza, then exibe top-2 nacional do 1T (nome, partido, pct final) + bandeira "vai a 2T".
- Given `projection:archive:pres:t1` ainda não existe (transição pré-fechamento), when página renderiza, then `<TurnoTransitionBanner />` cai num estado degenerado mostrando só o countdown (sem hero recap).

**RF-058.2 — Roteamento e redirect**

WHEN `maintenance:mode !== "off"`, the system SHALL retornar `307 Redirect` de `/`, `/governador`, `/uf/[sigla]`, `/uf/[sigla]/governador` para `/manutencao` (middleware).

**Aceitação**:
- Given `maintenance:mode === "fallback"`, when usuário GET `/`, then resposta é `307 Location: /manutencao`.
- Given `maintenance:mode === "off"`, when usuário GET `/manutencao` diretamente, then página renderiza estado neutro "manutenção encerrada — volte para a home".

## Requisitos Não-Funcionais

- **Graceful degradation** ([RNF-012](../../nfr/availability.md)): página renderiza com 0 deps externas além de Edge Config (que tem SLA próprio); fallback de `fallback` quando `EDGE_CONFIG` env ausente em dev.
- **Contraste 4.5:1** ([RNF-022](../../nfr/accessibility.md)) — vale para countdown numérico grande tanto quanto pro corpo.
- **Meta/OG** ([RNF-028](../../nfr/seo.md)) — em modo `transicao`, OG dinâmico mostra "Resultado do 1º turno — AtlasMenna"; em `fallback`, OG estático genérico.

## Componentes envolvidos

- **`<TurnoTransitionBanner />`** (novo, components/blocks) — hero recap 1T + countdown. Props: `{ recap1T: EdgePayload | null; until: string; }`. Reusa `<HeadlineScore mode="binary">` em modo somente-leitura.
- **`<MaintenancePageMessage />`** (novo, components/blocks) — mensagem fallback genérica + link TSE. Props: `{ lastAttempt?: string }`.
- **`<Footer />`** (existente, constituição § 1) — sempre presente.

## Cross-refs

- Design: [./design.md](./design.md)
- Spec operação (decide quando ativar): [../010-operacao-monitoramento/](../010-operacao-monitoramento/)
- Disponibilidade: [../../nfr/availability.md](../../nfr/availability.md)
- A11y: [../../nfr/accessibility.md](../../nfr/accessibility.md)
- SEO/OG: [../../nfr/seo.md](../../nfr/seo.md)
- Snapshot histórico 1T (recap): chave `projection:archive:pres:t1` (S06/F4d, ADR-0016)
