---
id: ADR-0061
title: Hemiciclo generalizado — arcos por casa (12 na Câmara, 5 no Senado), componente genérico, estados de cadeira do Senado e visão por bloco com marcas de limiar só nela; emenda ao ADR-0049
status: accepted
date: 2026-09-29
amends: 0049
---

# ADR-0061 — Hemiciclo generalizado: arcos por casa e visão por bloco

## Status

Aceito (2026-09-29) — execução autorizada pelo dono; revisão final do dono pendente.

**Emenda parcial ao [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md)** — não o
supersede. A geometria de 12 arcos, os três estados da cadeira da Câmara, `textForParty` como cor de
identidade e a ordem da **visão por partido** (cadeiras desc, sigla asc, sem marca em 257 e sem eixo
ideológico) continuam exatamente como estão. Muda o que estava implícito e agora é falso: que o
hemiciclo é "da Câmara" e que **nenhum** desenho do produto pode ter marca de limiar ou ordem por
posição. A visão por bloco é nova, e a regra de o que ela pode e não pode fazer é o item 4 da
Decisão.

## Contexto

O dono pediu, em 28–29/09, o Senado de 2027 desenhado como a Câmara: as **81 cadeiras**, com as 27
que não estão em disputa pintadas pelo partido **atual** de quem as ocupa (suplente incluído), e as
54 em disputa preenchidas pela apuração. O mesmo desenho, agora por **bloco** (relação com o governo)
em vez de por partido, serve ao Senado 2027 e à Câmara 2027. Duas coisas do ADR-0049 atrapalham. A
primeira é técnica: a geometria (`lib/utils/hemiciclo.ts`) só conhece `ARCOS_PADRAO = 12`
(linha 85), travado por `tests/unit/lib/hemiciclo.test.ts:92-96`. Com 12 arcos, 81 cadeiras viram um
pontilhado: a soma dos assentos por arco é proporcional ao raio, então o espaçamento angular fica em
torno de 34 unidades do `viewBox` enquanto o radial é 5, e o raio da bolinha (0,4 do menor
espaçamento) cai para 2 — bolinhas minúsculas espalhadas num arco enorme. Com 5 arcos o espaçamento
angular sai em 13,66 e o radial em 13,75: bolinhas redondas e uniformes, que é a razão original dos 12
arcos para 513 (o ADR-0049 calibrou "quase coincidem").

A segunda é de regra. O ADR-0049 escreveu, no item 6 da Decisão, que o desenho **não** tem marcador em
257 e **não** ordena por espectro, e justificou pela frase "o produto não classifica partido". O
[ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) tira o chão da segunda metade
dessa frase — a classificação passa a existir, na camada de etiquetas — mas **não muda** o motivo
para a primeira metade continuar valendo na visão por partido: a ordem por tamanho não afirma nada e
uma marca de maioria naquele desenho afirmaria uma leitura que a página evita. O que a visão por bloco
faz é outra coisa: seu propósito **é** medir a distância entre um bloco e os limiares de votação da
casa (maioria absoluta, três quintos, dois terços). Ela precisa de marcas, e as marcas precisam morar
só nela.

Há ainda uma dívida que o Senado carrega desde antes: a barra "As 54 vagas em disputa" pinta cada
segmento por **posição na lista** (`var(--color-cand-${i+1})`,
`app/(sen)/senador/page.tsx:235`), o que o [ADR-0024](0024-paleta-editorial-por-partido.md) vetou —
o comentário acima da linha ainda cita o ADR-0013, superseded. Com um hemiciclo por partido na mesma
página, o mesmo partido apareceria com duas cores, uma na barra e outra nas bolinhas.

## Decisão

**1. Arcos por casa, com o padrão da Câmara intacto.** `lib/utils/hemiciclo.ts` ganha
`ARCOS_CAMARA = 12` (o valor de hoje; `ARCOS_PADRAO` permanece exportado como o mesmo número, para o
teste de `:92-96` e os importadores atuais não mudarem) e `ARCOS_SENADO = 5`. `layoutHemiciclo` e
`arcosPara` aceitam o número de arcos como parâmetro opcional, com a Câmara como default; a guarda
de extremo pequeno (`total < 2 · arcos`) vale para o número recebido. Com 81 cadeiras e 5 arcos, o
método de Hare do projeto (`assentosPorArco`) dá **10 / 13 / 16 / 19 / 23** — as cotas são
10,06 / 13,13 / 16,20 / 19,27 / 22,34, os pisos somam 80 e a maior fração (0,34, no arco externo)
recebe a 81ª cadeira. (O plano de 29/09 escreve 22 no arco externo: é o piso da cota, não o
resultado.) A geometria passa a **expor o ângulo de cada cadeira** (`theta`) no `AssentoGeometria`,
para as marcas do item 4 caírem entre a cadeira k−1 e a k sem recalcular trigonometria fora do
módulo. O número de arcos continua sendo **constante de desenho por casa**, nunca derivado de `N` —
o argumento do ADR-0049 item 2, agora aplicado a cada casa.

**2. Componente genérico, `CamaraHemiciclo` como casca.** Extrai-se `components/blocks/Hemiciclo.tsx`,
puramente apresentacional: recebe a fila de cadeiras já pintada (estado, cor, rótulo), o número de
arcos e os textos de acessibilidade, e não sabe o que é Câmara nem Senado. `CamaraHemiciclo` passa a
derivar as cadeiras (`assentosDaBancada`) e delegar, e a saída dele tem de ser **idêntica byte a byte**
à de hoje. A garantia é dos testes que já existem e **não podem ser editados**: o retrato
(`outerHTML`) de `tests/unit/components/CamaraHemiciclo.test.tsx`, o teto de peso
(`camara-hemiciclo-peso.test.tsx`) e o caso de CI95 idêntico com e sem o campo
(`CamaraHemiciclo.test.tsx:254-268`). Se algum precisar mudar, a extração não é byte-idêntica e não
vale.

**3. `SenadoHemiciclo`, visão por partido.** Ordem por tamanho de bancada, como a Câmara, e o mesmo
`<desc>` ("a ordem é por tamanho e não representa posição ideológica"). Cada cadeira tem um de quatro
estados: **continua até 2031** (cheia, na cor do partido de quem a ocupa hoje); **decidida** (cheia;
a UF está 100% apurada, então os dois primeiros são fato); **projetada** (cinza com **anel na cor do
partido**, a mesma gramática do ADR-0049 item 3 para "não está firme"); **aguardando** (cinza
neutro, sem dono). A soma é sempre **81 = 27 + 54**. As 27 vêm do arquivo da foto do Senado (ADR de
fontes parlamentares); as 54 vêm do **top-2 de `por_uf` na base de projeção**. **Falha fechada**: se
o total por partido derivado desse top-2 diferir de `composicao_vagas.por_partido`, o gráfico **não
é desenhado** e um log é gravado — duas fontes de verdade discordando sobre quem tem quantas vagas
é pior do que a ausência do desenho. Acessibilidade: `role="img"` com `<desc>` e uma lista textual
("PL 14 — 9 até 2031 + 5 em 2026 (projeção)"), e a **data da foto** visível na tela. As 27 cadeiras
são rotuladas **"mandato até 2031 — não estão em disputa"**, **nunca** "eleitos", e "decidida" nomeia a
base ("UF 100% apurada"), nunca "eleito" solto (constituição § 1; ADR-0055). Isso emenda a spec 016,
que punha as 27 vagas em "Fora" (`docs/specs/016-senador/spec.md:87-90`).

**4. `HemicicloPorBloco`, visão por bloco (V1 do Senado e Câmara 2027).**

- **Ordem fixa pelo catálogo**: **Base do governo à esquerda → Independente e aguardando no meio →
  Oposição à direita**. A ordem é decisão do dono de 29/09 e não muda com a apuração.
- **Marcas de limiar fora do arco externo, só nesta visão**: Senado **41 / 49 / 54** (maioria
  absoluta, três quintos e dois terços de 81) e Câmara **257 / 308 / 342** (de 513), contadas a
  partir da esquerda, posicionadas no ângulo entre a cadeira k−1 e a cadeira k.
- **Placar em texto** ao lado ("Base do governo 34 — faltam 7 para 41").
- **Tokens neutros `--bloco-*`** (`docs/design-system/tokens.md`) — nunca a cor de partido, nunca
  vermelho/azul (condição 4 do § 2).
- O **`<desc>`** declara que a posição **reflete a relação com o governo, não a ideologia**. O
  desenho nomeia os blocos pelo catálogo — nunca por eixo esquerda–direita.

**A regra do ADR-0049 "sem marcador em 257" (`CamaraHemiciclo.tsx:34-36`) continua valendo, inteira,
para a visão por partido**, cuja ordem por tamanho não diz nada sobre limiar. Nenhuma marca de
limiar e nenhuma ordem por bloco pode aparecer em `CamaraHemiciclo` nem em `SenadoHemiciclo`. Os
comentários que dizem "o produto não classifica partido" são reescritos (ADR-0059 item 5); os `<desc>`
que dizem que a ordem por tamanho "não representa posição ideológica" **ficam**, porque descrevem a
visão por partido.

**5. Cor da barra das 54 vagas alinhada à paleta de partido.** O segmento passa de
`var(--color-cand-${i+1})` para a cor do partido, via `textForParty` — a **mesma** das bolinhas do
hemiciclo —, para o mesmo partido não aparecer com duas cores na página. Quita a dívida do ADR-0024
naquela linha e entra junto do desenho (frente do Senado 2027).

## Consequências

**Positivas**:
- Uma geometria e um componente para as duas casas, em zero JavaScript e com o padrão da Câmara
  protegido por três testes que não mudam — a extração não pode alterar o que já está no ar.
- **A ordem por partido e a ordem por bloco não se confundem**: cada uma vive em seu próprio
  componente, com suas próprias regras. A regra "sem marca de limiar" fica escrita por visão, não
  por casa.
- O ângulo de cada cadeira exposto pela geometria dá às marcas precisão testável (mutação:
  `k` no lugar de `k−1` desloca a marca em uma cadeira e quebra o teste).
- A falha fechada evita o pior desenho possível: um hemiciclo que soma 81 e discorda da barra ao
  lado.
- A barra deixa de contradizer o ADR-0024, e a página do Senado passa a ter uma cor por partido.

**Negativas**:
- **A ordem Base → Oposição, da esquerda para a direita, será lida como eixo político.** O `<desc>`
  diz que não é ideologia; o olho lê um arco com um lado e o outro. A Base do governo Lula reúne, em
  boa parte, partidos que o público associa à esquerda, e a Oposição, à direita, então a leitura
  "esquerda–direita" tende a coincidir com o que o desenho diz ser outra coisa. A mitigação é texto,
  placar e metodologia — e é uma mitigação, não uma garantia.
- **"Base do governo" em "Câmara 2027" e "Senado 2027" pode enganar.** A classificação é a
  **relação com o governo Lula**, e a casa de 2027 funcionará diante do governo que tomar posse em
  01/01/2027, que pode ser outro. O rótulo do bloco precisa dizer "governo Lula", não "governo"; a
  decisão de texto é da spec das visões.
- **As marcas medem uma direção só.** Contadas a partir da esquerda, dizem quão perto a **Base** está
  de cada limiar; a distância da **Oposição**, contada da direita, não é desenhada, e só o placar em
  texto pode dizer a simetria. O critério simétrico (condição 7 do § 2) fica dependente desse texto.
- **Duas figuras de peso na mesma página.** `/deputado-federal` passa a ter o hemiciclo por partido e
  o por bloco (o plano estima +~30 KB de HTML); nenhum dos orçamentos de RNF-007 enxerga HTML
  (mesma limitação do ADR-0049), e a mitigação é o mesmo teto de markup do componente isolado e a
  inclusão das rotas nos e2e de peso.
- **Marcas fora do arco externo brigam por espaço no celular**, onde a largura mal comporta o desenho.
  Tocar no `viewBox` para abrir margem muda o desenho — não a Câmara por partido, que é congelada,
  mas o teste de peso de 81 e o de legibilidade em 375 px precisam de casos próprios.
- **O log da falha fechada não alcança ninguém sozinho.** Sem alarme ligado a ele — e o alerta do
  projeto, quando `SLACK_WEBHOOK_URL` não está configurada, só registra (ADR-0049, Consequências) —,
  o hemiciclo some da tela sem que alguém o veja sumir.
- **A cor da barra das 54 vai contra a tabela do RNF-035.** `docs/nfr/accessibility.md:48-51` manda
  cor-base + `DATA_FILL_STROKE` para "preenchimento com extensão" (barra) e reserva `textForParty` a
  marcador de identidade. Usar `textForParty` na barra é a escolha coerente com o hemiciclo da mesma
  página (em 17 dos 31 partidos as duas cores são a mesma; PSOL, PSB, NOVO e "Outros" diferem), mas
  se afasta da tabela nesses quatro. O contorno de extensão da barra tem de ser **mantido**, e
  `tests/unit/design-system/contraste-nao-texto.test.ts` precisa medir o caso — a conferir na
  implementação.
- **As duas casas se comportam diferente no começo da noite.** A Câmara muda de forma abaixo de 24
  cadeiras publicadas (`arcosPara`, ADR-0049 Consequências); o Senado, com 81 fixas (27 pintadas e 54
  cinza até apurar), nunca muda de forma — a guarda `total < 2 · arcos` não dispara com 81 ≥ 10.
  Quem mantiver os dois precisa saber que "a forma muda no começo da noite" só vale para a Câmara.

## Alternativas consideradas

- **Reusar os 12 arcos para 81 cadeiras.** Rejeitada pelo cálculo com a geometria do projeto:
  bolinha de raio ~2 com espaçamento angular ~34, um pontilhado e não um plenário.
- **Derivar o número de arcos de `N` por casa.** Rejeitada pelo mesmo motivo do ADR-0049 item 2 — o
  desenho mudaria de forma por razão que o leitor lê como informação.
- **Um componente por casa, sem extrair o genérico.** Rejeitada: duplicaria a lógica que o ADR-0049
  já mostrou que diverge em silêncio (o caso de `ordenarBancada`) e não daria garantia byte a byte.
- **Marcas de limiar também na visão por partido.** Rejeitada pelo ADR-0049 e mantida: a ordem por
  tamanho não mede distância a limiar, e uma marca ali afirmaria o contrário do que a página diz.
- **Ordem por bloco com a Oposição à esquerda, ou por ordem alfabética dos blocos.** Não adotada:
  o dono fixou Base → Independente/aguardando → Oposição; a ordem alfabética misturaria o meio.

## Cross-refs

- [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — emendado; items 1–5 e 7
  intocados, item 6 restringido à visão por partido.
- [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — a classificação e a ordem
  Base → Oposição como decisão; as condições do § 2.
- [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) — o portão de
  cobertura que decide se a visão por bloco aparece; as chaves `publicar.v1` e
  `publicar.camara2027`.
- [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md) — a
  foto dos 27 que continuam até 2031.
- [ADR-0024](0024-paleta-editorial-por-partido.md) e
  [ADR-0047](0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) — `textForParty` para marcador de
  identidade; [ADR-0055](0055-resultpanel-top2-cartoes-versao-d.md) — nunca "eleito" solto.
- `docs/nfr/accessibility.md` (RNF-035, tabela de remédios) — a tensão registrada na negativa da cor
  da barra.
- `lib/utils/hemiciclo.ts:85` (`ARCOS_PADRAO`), `tests/unit/lib/hemiciclo.test.ts:92-96`,
  `components/blocks/CamaraHemiciclo.tsx:34-36` (a regra sem marca em 257),
  `app/(sen)/senador/page.tsx:235` (a barra das 54), `docs/specs/016-senador/spec.md:87-90`.
- Constituição § 1 (rótulos que nomeiam a base), § 2 (condições da classificação editorial; ordem),
  § 4 (`role="img"` + lista textual), § 6 (determinismo: Hare e 3 casas decimais).
- Specs afetadas: 016 (as 27 saem de "Fora"), 017 (visão por bloco; a proibição do 257 vale só para a
  visão por partido), 023 (Senado 2027) e 025 (visões editoriais), a criar.
