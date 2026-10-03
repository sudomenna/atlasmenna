---
id: ADR-0016
title: Recap do 1º turno como header fixo acima do hero do 2º turno, não como widget colapsável
status: accepted
date: 2026-05-18
---

# ADR-0016 — Recap do 1º turno como header fixo acima do hero do 2º turno, não como widget colapsável

## Status

Aceito.

## Contexto

Entre 04/10/2026 (D1) e 25/10/2026 (D2), o site AtlasMenna transiciona do 1º turno presidencial para o 2º. Durante o 2T, a pergunta central do leitor é binária ("A vs B, quem ganha?"), mas há uma pergunta secundária imediata, persistente durante os ~21 dias da janela e particularmente densa no dia D2 em si: "como foi que A e B chegaram aqui?". Em corridas hipotéticas (Lula 36% × Bolsonaro 31% × Tarcísio 22% × demais) o leitor que chega na home pela primeira vez em 25/10 não tem o contexto do 1T memorizado — e a constituição § 8 (transparência total) exige que o site não exiba números do 2T como se tivessem nascido do nada.

Três alternativas de UX foram consideradas para apresentar o recap do 1T no 2T:

1. **Widget colapsável** (acordeão fechado por default, abre on-click) — minimiza footprint vertical mas esconde transparência metodológica atrás de interação.
2. **Página dedicada `/sobre-o-1t`** linkada do `<Footer />` ou de `/sobre-o-modelo` — preserva home limpa mas exige navegação extra, e quebra a leitura "do mais quente pro mais frio" da home NYT-style.
3. **Header fixo acima do hero** — banner horizontal compacto com top-3 do 1T + label "fulano e ciclano avançaram ao 2T", sempre visível em mode 2T.

A referência visual do NYT Upshot 2024 (recebida via 3 prints em 2026-05-18) usa exatamente o padrão (3): o recap fica logo abaixo do título da página e acima do scoreboard atual, sem decoração interativa, comunicando passado e presente na ordem temporal natural.

Adicionalmente, o componente `<TurnoOneRecap />` precisa de uma decisão de placement antes mesmo da spec 003 (home) ser ativada para 2T — caso contrário cada caller (home, página de UF, futura `/relatorio-final-1t`) pode posicionar de forma diferente, criando inconsistência.

## Decisão

`<TurnoOneRecap />` renderiza como **header fixo acima do hero do 2T**, sempre visível, sem collapse/expand.

Convenções de layout:

- Posicionamento: primeiro filho do container principal da home em mode 2T, antes de `<HeadlineScore mode="binary">`.
- Altura compacta (banner horizontal de ~80–100px desktop, scroll natural em mobile <640px) — não compete visualmente com o hero do 2T.
- Conteúdo: top-3 candidatos do 1T com pct_apurado_final + sigla partido, e label textual `"<A> e <B> avançaram para o 2º turno"`. Sem agulha, sem CI, sem barra 50%+1 — esses são detalhes que o leitor pode consultar em `/relatorio-final-1t` (S07).
- Estilo visual: borda inferior fina + tipografia ½ escala do hero, cor de fundo neutra (`var(--color-bg-muted)`). Subordina visualmente o passado ao presente sem escondê-lo.
- Gate de renderização: o componente lê `projection:archive:pres:t1` (chave gravada pelo orchestrator na virada de turno, ADR-0012). Se a chave não existe (pré-D1, ou erro de orchestrator), `<TurnoOneRecap />` retorna `null` — degradação graciosa, não placeholder.
- Cobertura: `<TurnoOneRecap />` é Server Component. Não precisa de `aria-live` (conteúdo estático no momento em que a página renderiza), mas usa `<header>` semântico e `aria-label` descritivo no container.

Decisões adjacentes incluídas neste ADR:

- O `<TwoRoundIndicator />` (medidor P(2T)) é **removido** em mode 2T — ele só tem semântica em 1T (probabilidade de NÃO encerrar no 1T). `HeadlineScore mode="binary"` já não monta esse componente; o caller é responsável por não passá-lo no DOM em 2T.
- A probabilidade `p_segundo_turno_overall` (`EdgeNational`) é deliberadamente **não exibida no recap**. Em retrospectiva ela foi 1.0 (a eleição realmente foi a 2T), e mostrar 1.0 retroativamente é trivial. Ela vira métrica histórica relevante só na página `/relatorio-final-1t` da S07, com timeline ao longo da apuração.

## Consequências

**Positivas**:

- Continuidade narrativa: o leitor que entra na home em 25/10 vê "passado → presente" em ordem natural, sem precisar clicar para descobrir como A e B chegaram lá.
- Transparência metodológica (constituição § 8) ganha primeiro plano sem virar ruído — o footprint vertical é controlado pela altura compacta do banner.
- Determinismo: o componente lê chave Edge Config arquivada (`projection:archive:pres:t1`), não recalcula. Mesma página, mesma chave Edge Config → mesmo render (constituição § 6).
- Permite testes unitários simples: componente burro que recebe `recap: EdgePayloadNational | null` e renderiza ou retorna `null`.

**Negativas**:

- Footprint vertical permanente em mobile (~80px) reduz altura disponível para o hero do 2T. Mitigação: layout compacto, tipografia ½ escala, sem barras grandes.
- Caso o orchestrator falhe ao arquivar `projection:archive:pres:t1` no momento da virada (entre as 22h de D1 e 06h de D2), o recap não renderiza e o leitor perde o contexto. Mitigação: `data-pipeline/archive-turno-1.ts` é chore documentado da S07 com retry exponencial e alerta em `/_status` quando a chave está vazia em mode 2T.
- O bloco `<TwoRoundIndicator />` morre na transição — caller que esquecer de não passá-lo terá um medidor com `pSegundoTurno = null` que o componente já trata (retorna null), mas o slot vazio no layout pode causar inconsistências mid-deploy. Mitigação: a remoção é feita no mesmo PR que ativa o mode 2T (Fase 4 da S06).
- A página `/relatorio-final-1t` (S07 carry-over) precisa ser construída para que o leitor que quer mais detalhes do 1T tenha um destino — sem ela, o recap fica como dado órfão.

## Cross-refs

- ADR-0012 (chaves nomeadas Edge Config, incluindo `projection:archive:<cargo>:t<turno>`): [0012-edge-config-chaves-nomeadas.md](0012-edge-config-chaves-nomeadas.md)
- ADR-0014 (`p_segundo_turno_overall` como métrica de primeira classe — relevante porque a discussão de "mostrar 1.0 no recap?" se origina aqui): [0014-p-segundo-turno-primeira-classe.md](0014-p-segundo-turno-primeira-classe.md)
- ADR-0017 (transparência total das 3 camadas — `<TurnoOneRecap />` é a 4ª camada implícita: o "passado" como contexto fixo): [0017-transparencia-total-3-camadas.md](0017-transparencia-total-3-camadas.md)
- Constituição § 8 (transparência metodológica): [../../constitution.md](../../constitution.md)
- Spec 003 (home nacional, modo 2T): `docs/specs/003-home-nacional/spec.md`
- Sprint S06: [../../sprints/2026-S06-f4d-2t-governadores.md](../../sprints/2026-S06-f4d-2t-governadores.md)
