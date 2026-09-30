---
id: ADR-0065
title: Listas de candidaturas proporcionais em três faixas — 20 visíveis, 21 a 60 já na página e recortadas por CSS, 61 em diante buscadas no clique por rota fora de `/api`; emenda escopada ao ADR-0017 e teto de peso próprio para /uf/SP/deputado-federal
status: accepted
date: 2026-09-29
amends: 0017
---

# ADR-0065 — Listas de candidaturas proporcionais em três faixas

## Status

Aceito (2026-09-29) — plano aprovado pelo dono.

> **Emenda 2026-09-30 (decisões do dono sobre a auditoria G6 da spec 026).**
>
> 1. **Tetos de documento revistos pela medição.** Os ≈ 480 KiB do D5 eram escolha, e a auditoria
>    mediu `/uf/SP/deputado-federal` em **532.994 B (520,5 KiB)** — 8% acima —, com a fixture do
>    simulado e o Blob servido (`build:e2e`/`start:e2e`). Mediu também as outras UFs, que a nota do
>    RNF dizia estarem "no teto global" de 300 KiB e não eram medidas: RJ **453.476 B (442,8 KiB)**,
>    MG **451.813 B (441,2 KiB)**, RS 360, BA 353, PR 332, PE 321 KiB; e a capa `/deputado-federal`
>    em **315.242 B (307,8 KiB)**. Decisão: **manter as 60 linhas por agremiação** no documento e
>    adotar **560 KiB** para toda página de UF de Deputado — o portão mede SP, RJ e MG — e
>    **320 KiB** para a capa, ambos exceções nomeadas em `tests/e2e/perf-budget.spec.ts`
>    (`TETO_DOCUMENTO_POR_ROTA`) e em `docs/nfr/performance.md`. O teto global de 300 KiB não muda.
> 2. **`content-visibility: auto` fica, como exceção conhecida.** Velocidade acima da árvore de
>    acessibilidade fora da tela: uma agremiação longe da tela, pulada pelo navegador, só entra na
>    árvore de acessibilidade à medida que o leitor se aproxima dela. Isto contradiz a letra do D1
>    ("nenhum nó sai da árvore de acessibilidade") para as listas **longe da tela** — o texto
>    continua no DOM e na busca da página. O axe também não decide o contraste das agremiações
>    puladas (motivos `bgOverlap`, `elmPartiallyObscuring`, `elmPartiallyObscured` e
>    `shortTextContent`, medidos em 30/09 — com o `content-visibility` desligado, a mesma página cai
>    para zero). O portão de acessibilidade isenta só esses motivos, só dentro do bloco de uma
>    agremiação (e do painel de regras logo depois da última), e **só com prova**: repete o axe com o `content-visibility` desligado e exige zero
>    violação e zero indecidido sem a isenção (`tests/e2e/_isencoes-axe.ts`,
>    `tests/e2e/a11y-audit.spec.ts`); as listas trazidas à tela e abertas, a 375 e 320 px, passam em
>    `tests/e2e/deputado-listas.spec.ts`. A conferir com VoiceOver e NVDA no bug bash.

**Emenda escopada ao [ADR-0017](0017-transparencia-total-3-camadas.md).** O ADR-0017 proíbe
collapsible — `display:none`, `hidden`, `<details>` — e foi escrito para as ~11 candidaturas de uma
corrida majoritária. Esta emenda vale **só** para a lista de candidaturas por agremiação numa eleição
**proporcional** (`/uf/[sigla]/deputado-federal`), onde uma lista tem dezenas de linhas. Para as corridas
majoritárias o ADR-0017 segue integral. **`<details>` continua proibido**: o mecanismo aqui é recorte
por CSS mais botão, o já admitido pelo [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
D21, que este ADR reaproveita sem emendar. A novidade que de fato foge da letra do ADR-0017 é a
terceira faixa (Decisão 1): linhas que **não estão no documento** até o leitor pedir.

Depende de dois ADRs do mesmo plano: o
[ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md) define quem tem posição na lista e
quem aparece sem posição, e o [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)
define as marcas de eleição que as linhas carregam.

## Contexto

**1. O pedido.** Em 29/09 o dono pediu que a página de cada estado mostre, para cada partido ou
federação, os 20 candidatos mais votados visíveis; um "carregar mais" até os 60 mais votados, que já
vêm na página escondidos; e, do 61º em diante, busca só quando o leitor clica. Cada linha mostra votos,
% dos votos válidos da UF e as marcas de eleição (na parcial, na projeção, oficial do TSE). Hoje o
payload de UF carrega `eleitos` e `suplentes` por agremiação; o contrato novo é aditivo e mantém os
dois campos para compatibilidade.

**2. Por que o ADR-0017 não cabe como está.** Os argumentos dele eram três: esconder candidatura de 3%
a 5% atrás de um clique é viés editorial (Ciro e Tebet em 2022); collapsible quebra a narrativa linear
de leitor de tela; e a restrição real era densidade em 375 px com 11 candidatos, um problema de
tipografia, não de visibilidade. Uma agremiação de deputado em SP (70 vagas, dezenas de agremiações)
não é esse problema: a lista de uma só legenda tem mais linhas do que a corrida presidencial inteira, e
ninguém defende que todas as linhas de todas as legendas precisam estar visíveis ao mesmo tempo. O que o
ADR-0017 protege sobrevive, porém, em três propriedades que esta decisão mantém: **nenhuma candidatura é
inalcançável**; **a ordem é por voto contado, não por escolha do produto**; e **o que é recortado
continua na página** sempre que o custo permite. O ADR-0034 D21 já distinguiu ocultar de recortar
preservando a árvore, medido em 09/09 com 11 linhas; e a `MunicipioTable` já pagina **removendo** nós
(20 + 40, `d5765c4`), como o ADR-0034 registra nas Consequências — o projeto tem os dois precedentes.

**3. O peso.** O corpo do documento dessas rotas não é enxergado pelos três orçamentos do RNF-007 (só
somam script; ver [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md), negativa 1).
O portão de peso do documento (`tests/e2e/perf-budget.spec.ts`) tem um teto global de 300 KiB
(`BUDGET_DOCUMENT_BYTES`, `:167`), com `/deputado-federal` medido em 79,7 KiB e `/` em 212,2 KiB. A
estimativa do plano é que o Blob de SP vá de 31 para ~180 KB. O mesmo arquivo registra um precedente
que importa: `/governador` mede 325.635 B porque o consolidado por região e os 27 cartões "saem duas
vezes: no HTML e no payload RSC do `<RegiaoRecolhivel>`". E há uma armadilha de medição: `build:e2e`/`start:e2e` zeram
`BLOB_READ_WRITE_TOKEN`, então `/uf/SP/deputado-federal` renderiza "Detalhe indisponível" — sem o Blob
servido, o portão mede uma página vazia (a mesma classe de erro que o arquivo já documenta para
`/uf/SP`).

**4. Onde a rota da terceira faixa mora.** O BotID (ADR-0009) roda em `/api/*` — o `matcher` de
`proxy.ts` é `["/api/:path*"]`. O registro do projeto mostra o efeito: toda rota `/api/*` de produção
responde 403 `bot_detected` a cliente automatizado, e só página HTML responde 200
(`docs/operations/runbook.md:1067-1075`, medido em 18/09; `docs/sprints/2026-S08-f7-enxergar.md:143-148`),
e o ADR-0049 registra que ele "derruba a navegação" do e2e. Uma rota de leitura que o leitor aciona por
clique, e que o portão RF-277 precisa exercitar com Playwright, correria o mesmo risco sob `/api` — é
inferência do autor, não medição desta rota. O dado que ela devolve, além disso, já é público: os Blobs
do projeto têm URL pública determinística (`allowOverwrite: true`, `addRandomSuffix: false`,
`lib/blob/write.ts`).

## Decisão

**1. Três faixas por agremiação, por posição na lista (`rank`).**

- **Faixa 1 — posições 1 a 20:** visíveis.
- **Faixa 2 — posições 21 a 60:** no documento, no DOM e na árvore de acessibilidade, **recortadas
  visualmente** pela mesma mecânica do D21 (`data-collapsed` na lista, `height: 0; overflow: hidden` por
  CSS — nunca `display:none`, `hidden` ou `<details>`). Um botão ("carregar mais") com
  `aria-expanded` e `aria-controls` as revela. Busca por texto na página (Ctrl+F) e leitor de tela as
  encontram sem interação.
- **Faixa 3 — posição 61 em diante:** **não estão no documento.** Um segundo botão, explícito, busca
  as linhas na rota da Decisão 3; a resposta é guardada em memória do cliente (nada persiste). A
  busca marca a região `aria-busy`, anuncia o resultado numa região viva, leva o foco à primeira linha
  nova e, em erro, mostra a mensagem com "tentar de novo". Não há carga automática por rolagem: a busca
  é só no clique.
- **Candidatura com marca de eleito fica sempre na página**, qualquer que seja a posição (o conjunto
  publicado por agremiação é as posições 1 a 60 **mais** toda candidatura com marca de eleito — na
  parcial, na projeção ou pelo TSE). A cláusula existe para que, se a nossa ordem e o TSE divergirem
  sobre quem foi eleito, a linha divergente apareça em vez de ficar atrás de um clique. A faixa 3,
  portanto, **nunca carrega marca de eleição nem dado de projeção**, e o interruptor do ADR-0063 não
  precisa alcançá-la.
- **Candidatura sem posição** (destino `Anulado`, `Anulado sub judice` ou `Válido (legenda)`, ADR-0064)
  forma o último grupo da lista e está sempre na página; a faixa 3, ao chegar, entra **antes** dele.
  > **Emenda 2026-09-29 (implementação).** O contrato congelado da spec 026 (design § 3.1) e as
  > frentes P e U ordenam essas linhas **pelos votos apurados, entre as demais**, com `rank` e o texto
  > do destino na própria linha (nunca marca de eleição). Vale o contrato; voltar ao "último grupo"
  > é uma troca de chave de ordenação (`_chave_rank` em `api/model/deputado_payload.py`) se o dono
  > preferir.
- A lista une o que já tem e o que chegou **por `sqcand`**: nunca duplica uma candidatura.
- **Escopo da emenda ao ADR-0017:** só esta lista. `<details>` segue proibido em qualquer parte.

**2. Ordem e posição: voto contado, sem escolha do produto.** As linhas de uma agremiação seguem o
**voto apurado** (`votos_nominais` válidos do ADR-0064), decrescente. `rank` é a posição nessa ordem, e
o desempate é **ordem de alocação** (a ordem em que `distribuir_cadeiras` ocupou as vagas, que já
resolve empate entre candidatos do mesmo partido pelo mais idoso, ADR-0027 caso 5) e, por fim,
`sqcand` crescente — de modo que a posição concorde sempre com quem ganhou a cadeira e o resultado seja
determinístico (§ 6). Nem a projeção, nem as marcas, nem etiqueta editorial (§ 2, condição (e)) alteram
a posição. Não há controle de base na tela, então a base fixa é a apurada (ADR-0051). A ordem das
agremiações entre si continua a de `ordenarBancada` (cadeiras decrescente, sigla crescente).

**3. A rota da faixa 3 fica fora de `/api`.** `app/(dep)/uf/[sigla]/deputado-federal/lista/route.ts`,
`GET`, devolve as posições 61+ da UF lidas do Blob `deputado/uf-lista/<UF>.json` (construtor novo em
`lib/blob/paths.ts`, no molde de `deputadoUfBlobPathname`, `:207`). A leitura usa
`fetch(..., { next: { revalidate: 60 } })`, como `lib/blob/deputado-uf.ts:263`, e a resposta sai com
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. A sigla é conferida contra a lista
fechada das 27 UFs (maiúscula normalizada) — qualquer outra é 404, e nenhum caminho de Blob é montado
com entrada livre. **Erro nunca é cacheável:** falha na leitura do Blob responde com `no-store`, para que
um soluço não fique 60 s + 300 s no CDN. Estar fora de `/api` significa estar fora do BotID; isso não
abre dado novo — o Blob já é público — e o cache do CDN absorve rajada.

**4. Como o dado chega.** O modelo põe as posições 61+ em `payloads_uf[UF].lista_restante` (o schema do
corpo de escrita descarta chaves novas no topo **sem erro**; só `payload` e `payloads_uf` são
`.passthrough()`), e o escritor (`lib/edge-config/writer.ts`, ~`:1354-1395`) as separa e grava como
objeto próprio. O Blob principal `deputado/uf/<UF>.json` leva `lista?: { restantes }` — quantas linhas
faltam, o suficiente para o botão dizer o número e sumir quando é zero. As duas peças levam o mesmo
`dado_ts`; o cliente une por `sqcand` e, se os `dado_ts` diferirem, **mostra a hora de cada uma** em
vez de fingir um instante só, porque a fronteira 60/61 pode ter mudado entre os dois ciclos.

**5. Peso: teto próprio para uma rota, não afrouxamento do global.** `/uf/SP/deputado-federal` tem teto
de documento de **≈ 480 KiB** (decisão do dono; ~70 KiB gzip — **revisto para 560 KiB, e estendido a RJ
e MG, na emenda de 30/09**; a capa ganhou 320 KiB), medido no e2e **com o Blob servido** —
o servidor falso serve também o Blob, e `BLOB_PUBLIC_BASE_URL` aponta para ele em `build:e2e` e
`start:e2e`; o portão que achar a casca vazia reprova. O teto global de 300 KiB **não muda**; a rota
entra na lista de peso com o seu. Dois mecanismos seguram o número: **tuplas compactas** — o componente
cliente `DeputadoListaAgremiacao` recebe cada linha como uma tupla, não como objeto ou elemento
pré-renderizado, para o dado não sair duas vezes (HTML e payload RSC, o defeito do `/governador`) — e
**`content-visibility: auto` por agremiação**, com `contain-intrinsic-size` para a rolagem não saltar.

## Consequências

**Positivas**:
- Toda candidatura é alcançável e nenhuma é escondida por critério do produto: 60 por agremiação já
  estão na página, buscáveis e na árvore de acessibilidade; o resto está a um clique.
- O peso ganha um teto **declarado e medido**, no lugar de crescer com o dado; e a medição, por fim,
  acontece com o Blob servido, não sobre uma casca vazia.
- Reaproveita a mecânica do D21 e o padrão de Blob + rota já usados, sem um terceiro modo de lista.
- A rota não abre exposição nova (Blob público, cache de CDN) e é exercitável pelo Playwright do gate.
- Uma faixa 3 que **nunca** carrega marca nem projeção não depende do interruptor.

**Negativas**:
- **Pela primeira vez numa lista de candidaturas, linhas ficam fora do documento por razão de peso.**
  Leitor de tela e Ctrl+F não encontram as posições 61+ sem clicar; o princípio de "narrativa linear
  sem interação" do ADR-0017 se perde nessa faixa. O precedente é a `MunicipioTable` (20 + 40), e a
  emenda o assume, não o esconde.
- **O D21 foi medido com 11 linhas.** Aqui são até 40 linhas recortadas por agremiação, dezenas de
  agremiações em SP: a escala da árvore de acessibilidade e do layout **não foi medida**. Para o leitor
  de tela, cada agremiação passa a ser 60 linhas percorridas sem interação, ruído de navegação; a
  mitigação prevista é título por agremiação para navegar por cabeçalhos, a confirmar no gate de
  acessibilidade (RF-277).
- **Linha recortada não pode ter elemento focável** (foco em conteúdo invisível reprova o SC 2.4.7).
  Hoje a linha é texto; qualquer link ou botão que entre depois quebra essa premissa.
- **As linhas deixam de ser Server Components.** No `<ResultPanel>` o D21 preservava isso como razão
  2 (RNF-007a: linhas chegam por `children`). Aqui, para não duplicar o dado, a linha é montada no
  cliente a partir de tupla; o custo em JS do bundle da rota não foi medido, e o componente de linha
  e a busca entram no bundle.
- **Duas peças escritas em momentos diferentes.** A fronteira 60/61 pode divergir entre elas; a união
  por `sqcand` evita duplicata, mas a posição exibida pode saltar, e o aviso de horas é mitigação, não
  cura.
- **Rota sem BotID.** Quem quiser raspar a lista lê a rota ou o Blob direto; o ganho de não ter BotID
  (clique testável, sem falso 403) é pago em não ter camada extra contra volume.
- **O POST de escrita cresce.** O plano estima ~2–2,5 MB por ciclo contra o limite de 4,5 MB da função
  (aviso em 3,5 MB); a faixa 3 vai no mesmo POST, e os 27 Blobs somam ~1,5 MB por ciclo. Mais 27
  objetos por ciclo são mais escritas para o Blob.
- **O teto de ≈ 480 KiB é escolha, não medida da noite.** É 60% acima do teto global e mais que o dobro
  do maior documento medido (`/`, 212,2 KiB). O próprio spec de peso já registra que um teto calibrado
  num dia leve reprova (ou deixa passar) no pior momento; apertar ou confirmar exige medir com payload
  de noite de eleição, e o replay tem esse dado. Se o número medido ficar longe de 480, o teto deve ser
  revisto por ADR, não por edição do teste.
- **`content-visibility: auto` degrada para renderização normal** onde não é suportado; o ganho de
  layout desaparece ali sem aviso.

## Alternativas consideradas

- **Todas as linhas no documento, recortadas (sem rota).** Rejeitada pelo dono pelo peso: o documento
  cresce com todas as candidaturas de SP, duplicadas em HTML e RSC.
- **Paginar removendo nós também nas posições 21 a 60** (como a `MunicipioTable`). Rejeitada: perde
  busca de página e árvore de acessibilidade em 40 linhas por agremiação, sem que o peso justifique — o
  corte de 60 já limita o documento.
- **`<details>`/`<summary>`.** Rejeitada: o ADR-0017 o proíbe e esta emenda não o reabre.
- **Rota sob `/api`.** Rejeitada: BotID (`proxy.ts`) e o portão RF-277 precisa exercitar o clique.
- **Buscar o Blob direto do navegador, sem rota.** Rejeitada: exigiria levar ao cliente a base pública do
  Blob (`BLOB_PUBLIC_BASE_URL` é configuração de servidor), e a política de cache e de erro ficaria
  fora do app.
- **Server Action para a busca.** Rejeitada: é `POST`, sem cache de CDN.
- **Carregar a faixa 3 por rolagem (`IntersectionObserver`).** Rejeitada: a busca é só no clique
  (decisão do dono); a automática buscaria para quem só rola, anularia o ganho de peso e move o foco
  sem pedido.
- **Ordenar a lista por projeção ou por marca.** Rejeitada: § 2 e ADR-0051; a projeção é selo, não
  critério.

## Pontos em aberto

- **A faixa 3 pode ser quase vazia.** Pela regra de registro de candidaturas (Lei 9.504, art. 10, na
  redação da Lei 14.211/2021), a lembrança do autor é que cada partido registra no máximo 100% das
  vagas mais uma: em SP, 71; em MG, 54; nenhum outro estado passa de 60. Se for isso, a faixa 3 só
  existe em SP e tem no máximo 11 linhas por agremiação, e a rota, o Blob por UF e o botão custam
  mais do que entregam. **Não foi conferido** — nem o texto legal, nem os dados de 2026 (o autor não
  tem, no repositório, a contagem de candidaturas por lista). Vale contar em `candidatos/uf/<UF>/dep.json`
  antes de construir a rota; a decisão do dono (20/60/61+) fica de pé nesta redação, e o dono pode
  trocar a rota por "posições 61+ no documento".
- **Rótulos exatos dos dois botões**, texto do destino nas linhas sem posição e classes de CSS:
  design da spec 026 (RF-260, RF-261).
- **Valores de `contain-intrinsic-size`** e a altura recortada: medição no navegador.
- **Custo de JS do componente de linha e da busca** no bundle da rota (RNF-007a/c): a medir no portão.

## Cross-refs

- [ADR-0017](0017-transparencia-total-3-camadas.md) — emendado (nota adicionada).
- [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md) — D21, a mecânica de recorte;
  precedente da `MunicipioTable` nas Consequências.
- [ADR-0009](0009-botid-vercel.md) — BotID em `/api/*`. [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md)
  — os orçamentos de script não enxergam peso de documento.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — ordem por base fixa.
- [ADR-0057](0057-consolidado-regional-capas-governador-senador-presidente.md) — colapso visual sem
  tirar do DOM, e o consolidado que sai duas vezes (HTML e RSC).
- [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) — Blobs públicos.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — marcas e
  interruptor. [ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md) — candidaturas sem
  posição.
- Spec `026-deputado-listas-projecao` — RF-260, RF-261, RF-277. Spec 017 — RF-129 (drill-down por UF
  vem do Blob) e RF-130 (voto de legenda visível), a emendar. NFRs: `docs/nfr/performance.md` (RNF-007a/b/c; o teto de documento vive em
  `tests/e2e/perf-budget.spec.ts`), `docs/nfr/accessibility.md`.
- Constituição § 2 (ordem sem escolha do produto), § 3 (peso e desempenho), § 4 (teclado, leitor de
  tela, alvo de toque), § 6 (desempate determinístico), § 8 (a legenda diz a base do percentual):
  [../../constitution.md](../../constitution.md).
- Código: `components/blocks/CandidateListCollapse.tsx`, `components/blocks/ResultPanel.module.css:44-47`,
  `proxy.ts`, `lib/blob/paths.ts:207`, `lib/blob/deputado-uf.ts:193,263`, `lib/blob/write.ts`,
  `lib/edge-config/writer.ts:1354-1395`, `tests/e2e/perf-budget.spec.ts:109-167`,
  `app/api/internal/edge-write/route.ts:273`.
