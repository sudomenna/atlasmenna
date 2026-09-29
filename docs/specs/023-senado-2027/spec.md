---
id: 023-senado-2027
title: Senado de 2027 — as 81 cadeiras, com os 27 mandatos até 2031
status: implementing
priority: M
personas: [P1, P2, P3]
screens: [T-09]
requirements: [RF-215, RF-216, RF-217, RF-218, RF-219]
depends_on: [016-senador, 019-fase-pre-eleicao]
apis: []
components: [Hemiciclo, CamaraHemiciclo, SenadoHemiciclo, VoteBar, Panel]
nfr: [RNF-002, RNF-007a, RNF-022, RNF-023, RNF-024, RNF-035]
adrs: [0001, 0024, 0043, 0049, 0053, 0061, 0062]
amends: [016-senador]
ship_blocked_on: []
---

# Spec 023 — Senado de 2027

**Rota emendada**: `/senador` (T-09).
**Pedido do dono (28–29/09/2026)**: manter a barra "As 54 vagas em disputa" e acrescentar o
gráfico de bolinhas — o mesmo desenho do plenário da Câmara — com as **81 cadeiras** do Senado,
para mostrar como a casa fica em 2027, ao vivo durante a apuração e depois dela.

> **Decisões de fundo:** [ADR-0061](../../architecture/adrs/0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md)
> (hemiciclo generalizado — arcos por casa, estados genéricos, marcas só na visão por bloco, barra
> das 54 na paleta de partido; emenda ao [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md))
> e [ADR-0062](../../architecture/adrs/0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md)
> (fontes parlamentares — foto do Senado Dados Abertos com data, invariantes por teste).

## Objetivo

Quem abre `/senador` na noite de 04/10 quer saber duas coisas: quem leva as 54 vagas em disputa
(a barra, que já existe) e **como fica o Senado inteiro** a partir de 2027. A segunda pergunta
exige as 27 cadeiras que não estão em disputa — os mandatos que vão até 2031 —, que até aqui a
tela só mencionava em texto.

## Escopo

### Dentro

- Foto datada dos **27 mandatos até 2031** (Senado Federal — Dados Abertos), em arquivo editado
  à mão e versionado: `editorial/senado/mandato-2031.json`.
- Hemiciclo de **81 cadeiras por partido** em `/senador`, logo depois do bloco "As 54 vagas em
  disputa", com quatro estados de cadeira.
- Generalização da geometria do hemiciclo: **arcos por casa** (12 na Câmara, 5 no Senado), sem
  mudar um byte do plenário da Câmara.
- Extração do componente de pintura `<Hemiciclo>`; `<CamaraHemiciclo>` vira casca.
- Geometria das **marcas de limiar** (entre a cadeira k−1 e a k, na leitura esquerda → direita)
  exposta e testada — sem ser desenhada nesta spec.
- A barra das 54 passa a usar a **paleta de partido**, a mesma do hemiciclo.

### Fora

- **Visão por bloco** (base do governo / oposição) e marcas 41/49/54 — spec 025 (V1), sobre as
  etiquetas editoriais da spec 024. Esta spec só expõe a geometria das marcas.
- **Etiquetas editoriais** em qualquer cadeira. O hemiciclo desta spec é por **partido**.
- **Os 54 que ocupam hoje as vagas em disputa** (`mandato-2027.json`) — servem à V4 (renovação),
  spec 025.
- O ramo "aguardando dados" (sem payload) de `/senador` — ver RF-216 e design § D6.
- Rotas de UF (`/uf/[sigla]/senador`).

## Emenda à spec 016

O item "As 27 vagas que não estão em disputa" saiu do "Fora" da
[spec 016](../016-senador/spec.md#fora): as 27 **aparecem**, rotuladas "mandato até 2031 — não
estão em disputa", e **nunca** como "eleitos" (RF-218). A regra de fundo da 016 continua: elas não
aparecem na apuração, não entram na contagem das 54 e não são apresentadas como resultado de 2026.

## Personas e jornadas

P1 (leitor geral) quer ver o Senado de 2027 de uma vez; P2 (jornalista) quer o total por partido
com a parcela que não estava em jogo separada; P3 (leitor de tela) precisa da mesma informação em
texto, na mesma ordem.

## Requisitos Funcionais

### Dado

**RF-215 — Foto datada dos 27 mandatos até 2031**

WHEN `/senador` monta o hemiciclo de 81 cadeiras, the system SHALL ler os 27 mandatos que não
estão em disputa de uma foto versionada do Senado Federal (`editorial/senado/mandato-2031.json`),
com fonte, URL, data da consulta e versão do dado, e SHALL recusar a foto (sem desenhar o
hemiciclo) se ela violar qualquer invariante: exatamente 27 entradas, exatamente uma por UF das
27, todo `partido` reconhecido pela paleta (`normalizePartySlug` ≠ fallback) **ou exatamente
`"S/Partido"`**, e nenhum campo fora da lista branca.

**Aceitação**:
- Given a foto versionada, when o teste do carregador roda, then ela tem 27 entradas, 27 UFs
  distintas e nenhum partido cai calado em `outros`.
- Given uma foto com 26 entradas, ou duas do mesmo estado, ou um partido desconhecido, ou um campo
  de nome civil/nascimento, when o carregador a lê, then devolve erro nomeando a invariante violada
  e o hemiciclo não é desenhado.
- Given a foto, when a tela renderiza, then a data da consulta aparece em texto visível
  ("Composição dos 27 mandatos até 2031 conforme o Senado em DD/MM/AAAA").
- Given uma cadeira ocupada hoje por suplente em exercício, when a foto é lida, then o partido é o
  de quem ocupa a cadeira hoje (decisão do dono), e a tela diz isso em nota.
- Given um senador hoje sem partido (`"S/Partido"`), when a tela renderiza, then a cadeira dele é
  cinza cheia, rotulada "Sem partido" na legenda e na lista — nunca na cor do partido antigo, nunca
  como "Outros".
- Given `pnpm senado:snapshot`, when a API do Senado responde, then as duas fotos (27 e 54) só são
  gravadas se todas as invariantes passarem, e o arquivo sai na forma do `biome format`.

### Tela

**RF-216 — Hemiciclo de 81 cadeiras por partido em `/senador`**

WHEN `/senador` renderiza com payload, the system SHALL exibir, logo depois do bloco "As 54 vagas
em disputa", um hemiciclo de exatamente 81 cadeiras em 5 arcos, ordenado por partido (total de
cadeiras desc → sigla asc, a mesma regra de `ordenarBancada`), em que cada cadeira tem um de quatro
estados:

| estado | origem | aparência |
|---|---|---|
| `continua_2031` | um dos 27 mandatos da foto | cheia, na cor do partido |
| `decidida` | vaga em disputa de UF com `pct_apurado ≥ 100` | cheia, na cor do partido |
| `projetada` | vaga em disputa, top-2 da UF na projeção, UF ainda não 100% | anel na cor do partido |
| `aguardando` | vaga em disputa sem UF projetada | cinza, anel neutro |

**Aceitação**:
- Given qualquer payload aceito, when o hemiciclo renderiza, then há exatamente 81 `<circle>` e a
  soma dos quatro estados é 81.
- Given fase pré-eleição (`fase: "pre_eleicao"`, ADR-0043), when renderiza, then há 27 cadeiras
  `continua_2031` e 54 `aguardando`, e nenhuma das palavras da lista negra do RF-161 aparece no
  bloco.
- Given uma UF com `pct_apurado: 100`, when renderiza, then as duas vagas dela são `decidida`;
  com `pct_apurado: 99,9`, são `projetada`.
- Given o plenário da Câmara, when renderiza depois da generalização, then o markup é **idêntico
  byte a byte** ao de antes (retrato em `tests/fixtures/hemiciclo/camara-retrato.json`).
- Given `/senador` sem payload (ramo "aguardando dados"), when renderiza, then o hemiciclo **não**
  aparece — o ramo continua sem número nenhum (spec 019, bloco (A)).

**RF-217 — As 54 vagas saem da mesma conta do produtor, ou o hemiciclo não é desenhado**

WHEN o hemiciclo deriva as 54 vagas em disputa, the system SHALL tomar, em cada UF de
`por_uf`, as duas primeiras candidaturas que competem (`destino ≠ "anulado"`, ADR-0053) na ordem
de `top_candidatos` (a ordem da projeção), AND IF o total por partido derivado divergir de
`composicao_vagas.por_partido`, OR `composicao_vagas` faltar fora da fase pré, OR a soma não fechar
em 81, the system SHALL não desenhar o hemiciclo e SHALL registrar no log do servidor uma linha com
a etiqueta `[senado-2027]` e o motivo.

**Aceitação**:
- Given um payload em que `composicao_vagas.por_partido` diz PL 2 e os `top_candidatos` dão PL 1,
  when a página renderiza, then o hemiciclo não aparece, a barra das 54 continua, e o log tem
  `[senado-2027]` com o motivo `divergencia_composicao`.
- Given uma UF com candidatura anulada em 2º lugar, when deriva, then a vaga vai à 3ª colocada que
  compete — a mesma escolha do produtor.
- Given um payload coerente, when deriva, then o total por partido das vagas em disputa é igual a
  `composicao_vagas.por_partido`, partido a partido.

**RF-218 — Texto, legenda e acessibilidade do hemiciclo**

WHEN o hemiciclo de 81 cadeiras renderiza, the system SHALL (a) expor o SVG como `role="img"`
com `<title>` e `<desc>`, e `aria-describedby` apontando para uma lista textual visível, um item
por partido, no formato "PL 14 — 9 até 2031 + 5 em 2026 (projeção)"; (b) exibir legenda dos quatro
estados com as contagens; (c) nomear as 27 cadeiras como "mandato até 2031 — não estão em
disputa" e **nunca** usar "eleito"/"eleita"/"eleitos" em nenhuma parte do bloco; (d) dizer que o
partido de uma cadeira que continua é o partido atual de quem a ocupa hoje, suplente incluído;
(e) caber em 375 px de largura sem rolagem horizontal; (f) pesar menos que o teto medido em teste.

**Aceitação**:
- Given o hemiciclo, when um leitor de tela chega ao SVG, then ouve o título e a descrição, e a
  lista textual está ligada pelo `aria-describedby`, com o alvo existente no documento.
- Given qualquer fase, when o bloco é varrido, then a raiz `eleit` ocorre zero vezes.
- Given a lista textual, when lida, then cada partido aparece uma vez, na mesma ordem das cunhas.
- Given 375 px, when renderiza, then nenhum elemento do bloco excede a largura (SVG com
  `viewBox` e `width: 100%`; lista com quebra de linha).
- Given o markup do bloco, when medido, then fica abaixo do teto de
  `tests/unit/components/senado-hemiciclo-peso.test.tsx`, com um `<g>` por trecho contíguo e
  nenhuma cor repetida por `<circle>`.

**RF-219 — A barra das 54 usa a paleta de partido**

WHEN a barra "As 54 vagas em disputa" renderiza, the system SHALL pintar cada segmento com a cor
de identidade do partido (`textForParty`, ADR-0024), a mesma do hemiciclo de 81, e NÃO com a cor
por posição no ranking (`--color-cand-N`, ADR-0013, superado).

**Aceitação**:
- Given PT 1ª e PL 2ª na composição, when a barra renderiza, then o segmento de PT usa
  `var(--party-pt-text)` e o de PL `var(--party-pl-text)`; nenhum segmento usa `--color-cand-`.
- Given o mesmo partido na barra e no hemiciclo, when a página renderiza, then as duas cores são a
  mesma string.

## Requisitos Não-Funcionais

- **RNF-002** — o bloco é abaixo da dobra e não tem JavaScript: não disputa o LCP.
- **RNF-007a** — zero JS; o custo é HTML, medido pelo teste de peso (RF-218 f).
- **RNF-022/023/024** — texto com contraste AA; gráfico com equivalente textual; ordem de leitura.
- **RNF-035** — a bolinha é marcador de identidade ⇒ `textForParty` (variante `-text`, 3:1).

## Telas

T-09 (`/senador`), bloco novo entre "As 54 vagas em disputa" e "Estado a estado".

## Open questions

1. ~~Fase sem payload~~ — decidido no design § D6: o ramo "aguardando dados" não ganha o
   hemiciclo nesta spec.
2. **`continua_2031` e `decidida` têm a mesma aparência** (cheia), como o plano do dono fixou. A
   distinção existe na ordem dentro da cunha (as que continuam vêm primeiro), na legenda e na lista
   textual. Se o dono quiser diferença visual, é uma linha em `pinturaDoAssento`.
3. ~~Sigla do Senado ≠ sigla do TSE~~ — na foto de 29/09 o Senado usa as siglas do TSE
   (inclusive "PODE"); a única grafia fora da paleta é `"S/Partido"`, tratada pela regra do
   RF-215. Se outra aparecer, o carregador reprova e a correspondência entra no script de foto
   (design § D2).
4. **A foto envelhece.** Ela não se atualiza sozinha (ADR-0062). Refazê-la antes de 04/10 é
   decisão do dono (`pnpm senado:snapshot`).
