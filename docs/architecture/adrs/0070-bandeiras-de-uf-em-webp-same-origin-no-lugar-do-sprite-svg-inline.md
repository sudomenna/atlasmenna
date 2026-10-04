---
id: ADR-0070
title: Bandeiras de UF como arquivos WebP pequenos em `public/bandeiras/` servidos por `<img>`, não como sprite SVG inline
status: accepted
date: 2026-10-03
---

# ADR-0070 — Bandeiras de UF como WebP same-origin, não sprite SVG inline

## Status

Aceito (2026-10-03). Decisão do dono, tomada na véspera do 1º turno.

Este ADR **reverte uma decisão de desenho que nunca teve ADR**. O sprite inline foi construído em 18/09/2026
(commit `16d4a26`) e justificado apenas em `scripts/data/bandeiras-uf/PROVENIENCIA.md`, seção "Por que sprite
inline, e não `public/` nem Blob". Uma busca em `docs/architecture/adrs/` por "bandeira", "UfFlag" e "sprite"
só encontra o [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md), que **cita** o sprite como
encaixe pronto e as bandeiras como ausentes (0/27) — não o decide. Por isso nenhum ADR é marcado `superseded`;
o ADR-0049 é append-only e a descrição do encaixe (`<UfFlag>`/`<UfFlagSprite>`, `scripts/gen-uf-flags.ts`) que
ele traz fica **historicamente correta e atualmente obsoleta**. Quem lê o ADR-0049 deve ler este em seguida.

## Contexto

O pipeline de 18/09 foi desenhado antes de existir qualquer bandeira: `scripts/gen-uf-flags.ts` lê SVGs de
`scripts/data/bandeiras-uf/`, gera `lib/data/uf-flags.generated.ts`, e `components/atoms/data/UfFlag.tsx` emite
um `<symbol>` por UF num sprite inline e um `<use href>` por uso, com tetos de **4 KB por bandeira e 60 KB para
o sprite**. A motivação registrada: `/deputado-federal` tem orçamento de JavaScript de aplicação zero; 27 arquivos
seriam 27 idas à rede numa tela cujo argumento é não pagar rede; e uma falha de CDN na noite da apuração viraria
27 imagens quebradas ao lado de um resultado eleitoral. As bandeiras nunca foram fornecidas (0/27 até hoje) e o
pipeline nunca foi exercitado com dado real.

Em 03/10 o dono pediu as bandeiras e elas foram baixadas do Wikimedia Commons (todas em domínio público, via
Wikidata P41). O primeiro contato com dado real quebrou as premissas do sprite. Após otimização com svgo na
precisão de ícone, as bandeiras com brasão continuam muito acima do teto de 4 KB: AL 146,7 KB, RJ 65,7, RN 54,1,
PR 36,7, RS 27,9, SC 26,1, CE 8,2, AM 5,1 — o conjunto otimizado das 28 soma 393,6 KB. No tamanho em que são
desenhadas (21×15 px) o brasão ocupa cerca de 5 px de largura: os bytes não compram nenhum detalhe visível. Ao
mesmo tempo, o documento de `/deputado-federal` mediu 307,8 KiB em 30/09 contra o teto de 320 KiB
([docs/nfr/performance.md](../../nfr/performance.md), "Teto do documento HTML"; emenda de 30/09 ao
[ADR-0065](0065-listas-proporcionais-em-tres-faixas.md)) — folga de ~12 KiB. Um sprite inline injetado por
`dangerouslySetInnerHTML` num Server Component é contado duas vezes (HTML e payload RSC), de modo que mesmo as 20
bandeiras sem brasão não cabem nessa folga sem uma nova exceção de teto.

Três caminhos foram apresentados ao dono: (A) arquivos raster pequenos em `public/` referenciados por `<img>`
(recomendado); (B) manter o sprite e simplificar à mão os 8 brasões para caber em 4 KB — provavelmente ainda
exigindo elevar o teto de `/deputado-federal`, e menos fiel à bandeira oficial; (C) adiar. O custo de (A) é
reabrir exatamente a objeção que fundamentou o sprite (requisições extras e dependência de entrega), então ela
precisa ser enfrentada aqui, não ignorada.

## Decisão

Adotar (A). As bandeiras viram **arquivos WebP em `public/bandeiras/<UF>.webp`**, rasterizados com `sharp` a
**60 px de altura** (≈83–90 px de largura, cerca de 4× a altura de exibição de 15 px), qualidade 90: 0,5–1,9 KB
por arquivo, **29,3 KB no total** para as 27 UFs (a bandeira do Brasil foi gerada junto, mas não é publicada: nenhum
lugar escolhido a usa). Os SVGs originais (domínio público, Commons) continuam
versionados em `scripts/data/bandeiras-uf/` como fonte de auditoria; a receita de regeneração fica em
`PROVENIENCIA.md`.

A renderização é `<img alt="" width height decoding="async">` simples — decorativa, porque nome e sigla estão
sempre presentes como texto (constituição § 4) —, com `loading="lazy"` abaixo da dobra e carga imediata nos
títulos de página. Zero JavaScript de aplicação; o HTML cresce apenas pelas tags `<img>`. Uma borda de fio
(hairline) por token mantém visíveis as bandeiras de campo branco. Os arquivos são servidos do **próprio
deployment** (mesma origem, CDN da Vercel), não de CDN de terceiros — consistente com a constituição § 9.

Lugares de uso, escolhidos pelo dono: `UfBandeirasGrid` (páginas de deputado), `UfPicker` (seletor de estado),
`GovernorCard` e o `h1` das páginas de UF (presidente, governador, senador, deputado). **Não** entram no
`UfLinksGrid` (spec 019, deliberadamente sem bandeira) nem nos tooltips do mapa. O pipeline do sprite é
removido: gerador `scripts/gen-uf-flags.ts`, `lib/data/uf-flags.generated.ts`, `UfFlagSprite`, o script
`gen:uf-flags` e o teste dele.

**Calendário.** O dono decidiu publicar em 03/10, a um dia do 1º turno, contra a recomendação do orquestrador de
esperar até depois de 04/10. O argumento do orquestrador — mexer em página de resultado na véspera, com deploy
congelado das 16h às 5h em 04/10 ([ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md))
— fica registrado como risco aceito, não como objeção removida. Condição da decisão: os portões e2e de peso e de
acessibilidade (`pnpm build:e2e` + `pnpm start:e2e` + `pnpm test:e2e`) são executados **antes** de publicar.

## Consequências

**Positivas**:
- O custo no documento cai de quilobytes por bandeira (sprite) para ~300 B por bandeira (a tag `<img>`,
  presente no HTML e no payload RSC). Não zera: ver a emenda de 03/10 abaixo, que subiu o teto de
  `/deputado-federal`.
- 29,3 KB para as 27 contra 393,6 KB do SVG otimizado das 28; o único detalhe perdido é o brasão que, a 5 px, já não era
  legível.
- Fidelidade à bandeira oficial: os 8 brasões não precisam ser redesenhados à mão (alternativa B), com o risco
  de uma versão "inspirada" de símbolo oficial.
- Zero JavaScript de aplicação e nenhuma dependência de hidratação; o gerador, o arquivo gerado e o sprite
  somem do repositório.
- O modo de falha é benigno: se um arquivo não carregar, falta um ícone decorativo ao lado de nome e sigla que
  continuam no texto. Nenhum número de resultado depende da imagem.

**Negativas**:
- Reabre a objeção original do sprite: até **27 requisições extras** de mesma origem em páginas com o seletor ou
  a grade. Mitigação: HTTP/2 na Vercel, `loading="lazy"` abaixo da dobra, arquivos de ~1 KB cacheados pela CDN.
  O efeito da noite de apuração (cache frio no primeiro acesso após deploy) **não foi medido**.
- Uma falha da CDN ainda deixa imagens quebradas ao lado de resultado — era o cenário que o sprite eliminava.
  Fica reduzido a ícone decorativo ausente, mas não zero; `width`/`height` explícitos evitam deslocamento de
  layout (CLS) quando isso acontece.
- Raster não escala indefinidamente: a nitidez vale até ~4× a altura de 15 px. Os títulos, a ~20 px de altura,
  estão dentro da faixa; qualquer uso futuro maior que isso (cartaz, impressão, título grande) exige regerar a
  partir dos SVGs.
- Os tetos de 4 KB/bandeira e 60 KB/sprite desaparecem junto com o gerador. O substituto é um teste unitário
  sobre `public/bandeiras/`: exatamente os 27 arquivos `.webp`, nenhum a mais, e cada um com **no máximo 3 KB**
  (o maior, PR, tem 1.864 B). Um WebP regerado grande demais reprova a suíte. O portão de peso do e2e não pega
  esse caso: ele mede o documento, e a imagem é uma requisição à parte.
- As tags `<img>` também aparecem em HTML e payload RSC quando renderizadas por Server Component; é uma
  contagem pequena (dezenas de bytes por tag), mas **não medida** neste ADR — o portão e2e de peso da véspera é
  quem fecha o número.
- `<img>` simples dispensa o otimizador de imagens, o que evita transformação em runtime mas também significa
  que o tamanho certo é responsabilidade da regeneração (60 px de altura), não do framework.
- Publicar na véspera é um risco de calendário aceito pelo dono: um deploy a mais antes do congelamento de
  04/10 e, se o portão e2e reprovar, pouco tempo para corrigir.

## Cross-refs

- [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — descreve o sprite como encaixe pronto
  e as bandeiras como ausentes; fica obsoleto nesse ponto, sem ser marcado `superseded` (a decisão do sprite
  nunca foi dele).
- [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) — emenda de 30/09 do teto de 320 KiB de
  `/deputado-federal`, a folga que motivou a mudança.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — congelamento de deploy
  das 16h às 5h em 04/10.
- [ADR-0010](0010-mapa-dynamic-import.md) e [ADR-0030](0030-orcamento-above-the-fold-piso-framework-vs-aplicacao.md)
  — orçamento de JavaScript; a escolha de `<img>` o preserva.
- Constituição § 3 (performance), § 4 (acessibilidade — imagem decorativa com `alt=""`, nome e sigla em texto),
  § 7 (resiliência — modo de falha benigno), § 9 (stack 100% Vercel — mesma origem).
- NFRs: [performance.md](../../nfr/performance.md) ("Teto do documento HTML", `/deputado-federal` 320 KiB;
  RNF-007a), [accessibility.md](../../nfr/accessibility.md).
- Specs afetadas: 019 (`UfLinksGrid` fica deliberadamente sem bandeira) e as specs de página de UF e de
  deputado que listam `UfBandeirasGrid`, `UfPicker` e `GovernorCard` em `components:` — a conferir pelo
  `spec-syncer`.
- Proveniência e receita de regeneração: `scripts/data/bandeiras-uf/PROVENIENCIA.md` (seção "Por que sprite
  inline" a atualizar pelo agente de código).

## Emenda — 2026-10-03, teto de `/deputado-federal` 320 → 336 KiB (decisão do dono)

Medido no `build:e2e` da implementação (fixture do simulado): `/deputado-federal` mede **320.684 B
(313,2 KiB) sem as bandeiras** — já 5,4 KiB acima dos 307,8 KiB de 30/09, pelo crescimento do dado — e
**328.972 B (321,3 KiB) com elas**. As 27 tags da grade "Estado a estado" somam 8.288 B crus
(3.402 B no HTML + 4.860 B no payload RSC); comprimido (gzip -9), o documento passa de 39.664 B para
40.250 B, **+586 B** para o leitor. O portão de peso reprovou por 1,3 KiB.

Alternativas apresentadas: subir o teto; tirar as bandeiras só da grade dessa página; não publicar
hoje. O dono escolheu **subir o teto para 336 KiB**: cobre as bandeiras e deixa ~15 KiB de folga para
o crescimento da noite da apuração. Alterados `TETO_DOCUMENTO_POR_ROTA` em
`tests/e2e/perf-budget.spec.ts` e a linha da rota em `docs/nfr/performance.md`.

Na mesma medição, outras rotas com bandeiras: `/` +9,4 KiB, `/governador` +9,4, `/senador` +9,4,
`/deputado-estadual` +7,9 (27 cartões ou itens de grade cada); páginas de UF +0,3 KiB (uma bandeira
no título). `/` e `/uf/SP/senador` já estavam em `FALHAS_CONHECIDAS_DOCUMENTO`; `/governador` não é
medida pelo portão; `/senador` e `/deputado-estadual` seguem abaixo dos seus tetos.
