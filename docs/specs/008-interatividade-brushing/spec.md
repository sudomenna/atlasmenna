---
id: 008-interatividade-brushing
title: Interatividade — Brushing & Linking
status: draft
priority: M
personas: [P1, P2, P3]
screens: [T-01, T-02, T-03, T-04, T-05]
requirements: [RF-045, RF-046, RF-047, RF-048, RF-049, RF-050, RF-294]
depends_on: []
apis: []
components: [HoverTooltip, BottomSheet, RealceHemiciclo, LegendaHemicicloCamara]
nfr: [RNF-003, RNF-022, RNF-024]
adrs: [0049, 0061]
---

# Spec 008 — Interatividade (Brushing & Linking)

## Objetivo

Toda visualização da mesma entidade reage coordenadamente: hover em uma UF no mapa nacional destaca a linha correspondente na tabela e no grid de UFs decisivas, e vice-versa. No mobile, tap substitui hover; tooltip vira bottom-sheet.

## Escopo

**In**:
- Hover store global (Zustand) — coordena entidades `{uf | municipio}`.
- Coordenação entre mapas, tabelas, gráficos.
- Tooltip flutuante com breakdown contextual.
- Comportamento mobile: tap-to-select + bottom-sheet.

**Out**:
- Lógica específica de cada tela (escopo das specs por tela).

## Requisitos Funcionais (EARS)

**RF-045 — Hover destaca entidade em todas as visualizações**

WHEN o usuário passa o mouse sobre uma entidade `{uf | municipio}` em qualquer visualização, the system SHALL destacar a mesma entidade em todas as outras visualizações coordenadas na mesma página.

**Aceitação**:
- Given usuário está em `/uf/sp`, when hover em município "Campinas" no mapa, then a linha "Campinas" da tabela é destacada AND o mesmo município é destacado no segundo mapa do duo.

**RF-046 — Hover em linha de tabela destaca nos mapas**

WHEN o usuário passa o mouse sobre uma linha de tabela representando uma entidade, the system SHALL destacar a entidade correspondente em todos os mapas da página.

**RF-047 — Click em UF/município navega para drill-down**

WHEN o usuário clica em uma UF (mapa nacional) ou município (mapa estadual), the system SHALL navegar respectivamente para `/uf/[sigla]` ou `/uf/[sigla]/municipio/[ibge]`.

**RF-048 — Tooltip flutuante com breakdown**

WHEN uma entidade está em hover state, the system SHALL exibir `<HoverTooltip />` flutuante com breakdown contextual (votos, %, swing, contribuição).

**RF-049 — Mobile: tap-to-select fixa o destaque**

WHERE o cliente é mobile (touch device), the system SHALL substituir hover por tap, fixando o destaque até o próximo tap ou tap fora.

**RF-050 — Tooltip vira bottom-sheet no mobile**

WHERE o cliente é mobile, the system SHALL renderizar o tooltip como bottom-sheet (`<BottomSheet />`) em vez de flutuante.

**RF-294 — Realce por grupo nos plenários, ligado à legenda, sem JavaScript**

WHILE o ponteiro estiver sobre uma cadeira ou sobre a linha da legenda de um grupo num plenário — partido no Senado de 2027 ([spec 023](../023-senado-2027/spec.md)), agremiação na Câmara ([spec 017](../017-deputado-federal/spec.md)), bloco nas visões por bloco das duas casas ([spec 025](../025-visoes-editoriais/spec.md)) —, the system SHALL esmaecer as cadeiras dos demais grupos (opacidade 0,2) e as linhas da legenda dos demais grupos (opacidade 0,45), destacar a linha do grupo apontado com fundo leve, e manter o grupo apontado intacto, nos dois sentidos (cadeira → legenda e legenda → cadeiras), sem JavaScript no cliente e apenas em dispositivos com ponteiro de passar (`@media (hover: hover)`).

Notas de implementação (decisão do dono, 03/10; referência visual: globalelectionsimulator.com `/brazil-senate` e `/brazil-legislative`):

- **Zero JavaScript** preservado ([ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md), [ADR-0061](../../architecture/adrs/0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md), spec 017, spec 023): CSS com `:has()` — metade estática em `RealceHemiciclo.module.css` (apaga tudo enquanto há algo sob o ponteiro) e uma regra por grupo num `<style>` emitido pelo servidor (`lib/utils/realce-hemiciclo.ts`), que devolve o grupo apontado. Valores do payload escapados (`\`, `"`, `<` → `\3c `).
- **Sem balão**. Apagar é imediato; voltar espera 80 ms, para andar entre bolinhas do mesmo grupo não piscar. Cadeiras sem dono / aguardando apagam junto.
- **Câmara**: ganha a legenda compacta `<LegendaHemicicloCamara>` sob o plenário — bolinha na cor das cadeiras (`textForParty(sigla_lider)`), **sigla inteira** (exceção do dono para as capas de Deputados), nº de cadeiras, mesma ordem das cunhas (`ordenarBancada`, só quem tem cadeira), `aria-hidden` (o equivalente textual continua sendo `#bancada-agremiacoes`). O `<CamaraHemiciclo>` em si não muda (retrato byte a byte).
- **Senado**: a lista textual `#senado-hemiciclo-lista` é a legenda ligada; a linha "Sem partido" tem a mesma chave das cadeiras dela.
- **Por bloco**: legenda e placar reagem; as marcas de limiar não esmaecem.

**Aceitação**:
- Given `/senador` num navegador com mouse, when o ponteiro entra numa cadeira do PT, then as cadeiras dos outros partidos e das vagas aguardando ficam com opacidade 0,2, as linhas dos outros partidos na lista com 0,45, e a linha do PT ganha fundo; when o ponteiro sai do desenho, then tudo volta a 1.
- Given `/deputado-federal`, when o ponteiro entra na linha de uma agremiação na legenda compacta, then as cadeiras dela ficam intactas e as das outras esmaecem.
- Given um dispositivo sem hover (toque), when o usuário toca uma cadeira, then nada fica esmaecido.
- Given o HTML servido, then a página não carrega nenhum script novo para o efeito, e o conjunto de chaves do `<style>` é igual ao dos `<g>` das cadeiras e ao das linhas da legenda (`tests/unit/components/RealceHemiciclo.test.tsx`).
- Given o pior caso de partidos, then o painel do Senado continua abaixo de 18 KiB de markup (`senado-hemiciclo-peso.test.tsx`) e a legenda + realce da Câmara abaixo de 8 KiB (`LegendaHemicicloCamara.test.tsx`).

## Requisitos Não-Funcionais aplicáveis

- INP <200ms ([RNF-003](../../nfr/performance.md)).
- Navegação por teclado ([RNF-024](../../nfr/accessibility.md)) — setas movem foco entre entidades.

## Open questions

- Quando um tap fora do mapa fecha o bottom-sheet vs quando mantém? (atual: tap fora fecha).

## Cross-refs

- Design: [./design.md](./design.md)
- Hover store: [../../design-system/state-global.md](../../design-system/state-global.md)
- Brushing nos mapas: [../../mapas/brushing-linking.md](../../mapas/brushing-linking.md)
- Mobile: [../../mapas/mobile.md](../../mapas/mobile.md)
- Plenários (RF-294): [../017-deputado-federal/spec.md](../017-deputado-federal/spec.md), [../023-senado-2027/spec.md](../023-senado-2027/spec.md), [../025-visoes-editoriais/spec.md](../025-visoes-editoriais/spec.md)
