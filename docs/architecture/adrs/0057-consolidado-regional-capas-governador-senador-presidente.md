---
id: ADR-0057
title: Capas de Governador, Senador e a home de Presidente agrupam por região IBGE, com consolidado regional recolhível no topo — campo novo `votos_disputa_projetados` no payload de UF
status: accepted
date: 2026-09-28
---

# ADR-0057 — Capas de Governador, Senador e Presidente agrupam por região IBGE, com consolidado regional recolhível

## Status

Aceito. Decisão do dono na sessão de 2026-09-28, a partir do protótipo
`docs/design-system/prototipos/capas-regioes-2026-09-28/` (versões A, B, C — três versões, C
escolhida com dois ajustes). Dois `spec-implementer` (produtor Python e web) implementam em
paralelo a partir deste ADR; a promoção a `shipped` das specs afetadas segue os 4 gates de sempre
(RF, constituição, NFR, sync) antes de fechar.

## Contexto

`/governador` e `/senador` renderizam hoje uma lista de 27 `<GovernorCard>` (spec 006) e cards
equivalentes de Senado (spec 016) na ordem em que `EdgeUfRow[]` chega no payload — alfabética por
sigla, sem nenhum agrupamento. O dono pediu para agrupar essas 27 UFs pelas cinco regiões do IBGE
(Norte, Nordeste, Centro-Oeste, Sudeste, Sul) e, no topo de cada região, mostrar um consolidado da
disputa ali — "quem lidera a região e por quanto", derivado somando os votos dos estados daquela
região.

A pergunta agregadora muda de cargo para cargo. Em Governador e Senador, cada UF tem candidatos
diferentes disputando cargos diferentes (27 corridas distintas por Governador; 27 por Senador, cada
uma valendo 1 vaga na fatia deste ciclo) — o único jeito de somar é **por partido**: "quanto o PT
somou nos estados desta região", não "quanto um candidato específico somou", porque não existe um
candidato único que dispute a região inteira. Em Presidente, ao contrário, o candidato **é** o
mesmo em todo o país — então o consolidado regional soma **por candidato**, exatamente como o
consolidado nacional já faz.

Cinco versões de layout foram desenhadas no protótipo (README da pasta): A (faixa de região acima
dos cards), B (cartão de região no formato do cartão de estado, com atalhos de navegação) e C
(região recolhível, cabeçalho sempre visível com barra empilhada + legenda, botão para abrir/fechar
os cards). O dono escolheu C, com dois ajustes sobre o protótipo original: 6 partidos + "Outros" em
vez de 4 (com 4, o Sudeste chegava a ter 43% em "Outros" — número grande demais para dizer algo),
e as regiões vêm **abertas** por padrão ao carregar a página, não fechadas.

O protótipo revelou uma lacuna de produtor: para calcular a Projeção regional (Σ do `pct`
projetado de cada candidatura × o total de votos em disputa projetado da UF), falta ao payload
nacional o próprio total projetado por UF — hoje só o `%` viaja em `EdgeUfRow.top_candidatos[].pct`.
O protótipo contornou isso estimando o total como `contado ÷ % apurado`, mas essa conta só fecha
porque o gerador do modo simulado distribui a apuração de forma uniforme entre UFs; com apuração
real e desigual entre municípios/zonas, o mesmo cálculo enviesaria o total para cima ou para baixo
conforme o ritmo de apuração de cada UF, não conforme o resultado. A alternativa de ler os 27
payloads de UF por render (que já carregam dado mais fino) foi descartada por custo: 27 leituras de
Edge Config por render de uma única página de capa, contra uma leitura hoje.

## Decisão

**1. Mapa estático de regiões, novo módulo `lib/config/regioes.ts`.** As 27 UFs são atribuídas às 5
regiões do IBGE por uma tabela fixa em código (não derivada de nenhum payload), na ordem
Norte → Nordeste → Centro-Oeste → Sudeste → Sul. O agrupamento vale **só** nas três capas nacionais
— `/governador`, `/senador` e a home de Presidente `/` — e não altera nenhuma tela de UF
(`/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`).

**2. Consolidado regional no topo de cada região, versão C do protótipo.** Cabeçalho sempre
visível com o nome da região, "N estados", "Na região: `<partido/candidato líder>` X%", o % apurado
da região, uma barra empilhada 100% por partido/candidato, a legenda com os percentuais e a base
usada ("Projeção · % dos votos válidos em disputa" ou equivalente para Parcial). Um botão abre e
fecha os cards de estado daquela região; fechar **não tira nada do DOM** — é o mesmo mecanismo de
colapso visual do ADR-0017/ADR-0034 D21 (atributo no contêiner, CSS decide altura, `aria-expanded`
no botão). Seis maiores partidos/candidatos + "Outros"; regiões abertas por padrão ao carregar.

**3. Cálculo por cargo.** Governador e Senador: consolidado **por partido**. Presidente: consolidado
**por candidato** (mesmo candidato em todo o país). Base de votos: votos em disputa — válidos mais
sub judice, com a candidatura anulada fora (ADR-0053) — a mesma base já usada nos cards de estado.
No Senado os percentuais continuam "dos votos" (cada eleitor vota duas vezes), sem mudança de
convenção. **Parcial** é a soma de `votos_atuais` de cada candidatura da região, agrupada por
partido/candidato. **Projeção** é a soma, por UF, de `top_candidatos[].pct × EdgeUfRow
.votos_disputa_projetados` (item 4) — nunca a soma direta dos `%` das 27 UFs, que erraria ao tratar
UFs de tamanhos muito diferentes como pesos iguais. "Outros" da região junta os partidos além dos 6
maiores **e** a cauda "Outros" de cada UF (o payload nacional só detalha 4 candidaturas por UF —
ADR-0017/RF-190 —, então os votos da cauda não podem ser creditados ao partido de origem).
Desempate: votos desc, e no empate, ordem alfabética pt-BR da sigla/nome — a mesma regra neutra do
resto do produto (constituição § 2, ADR-0051).

**4. Campo novo no payload nacional: `EdgeUfRow.votos_disputa_projetados?: number`.** Emitido pelo
produtor `api/model/project.py`, cargos 1 (Presidente), 3 (Governador) e 5 (Senador), na mesma
etapa e mesma base que já calcula `top_candidatos[].pct` (votos em disputa da UF, ADR-0053) — não
uma segunda fonte de verdade sobre o total, apenas o denominador que já existe implicitamente
exposto como campo. **Ausência do campo (payload emitido antes desta mudança) faz a Projeção
regional mostrar "—", nunca uma estimativa** — decisão preexistente do dono (14/09,
`tres_estados_e_nao_regressao`: "não sabemos" e "medimos zero" são estados diferentes; já
formalizada em ADR-0043/ADR-0051) aplicada aqui ao caso de um campo ausente em payload antigo, e
não a um dado zerado.

**5. `/governador`: filtros de status agem só nos cards, nunca no consolidado.** Quando o leitor
filtra por "eleito"/"2º turno"/"aguardando" (RF-006.2), os cards de estado que não batem o filtro
saem de vista, mas o consolidado da região continua somando **todos** os estados da região, com ou
sem filtro ativo — o consolidado é sempre a leitura completa da região, não uma leitura do que está
visível na tela.

**6. Home `/`: a seção nova entra além do "Placar por estado" (`StateGroupedTable`, ADR-0033),
posicionada **antes** dele.** Usa o mesmo formato de card de `/governador`, adaptado ao cálculo por
candidato do item 3. Os cards de Presidente na nova seção **não recebem selo de turno** — regra do
ADR-0055: quem decide o 2º turno de Presidente é o total nacional, não o estado, e um selo por
UF/região afirmaria algo que só o resultado nacional pode afirmar.

## Consequências

**Positivas**:
- Uma pergunta que hoje exige somar 27 cards de cabeça ("quem lidera o Nordeste?") passa a ter
  resposta direta no topo da região, sem nenhuma nova fonte de dado — reaproveita
  `EdgeUfRow.top_candidatos[]` e `votos_atuais` que já existem.
- Mesmo mecanismo de agrupamento (`lib/config/regioes.ts`) serve as três capas — Governador, Senador
  e a home de Presidente —, sem inventar um esquema de região por cargo.
- Colapso visual reaproveita o padrão já testado do ADR-0017/ADR-0034 D21 (nós sempre no DOM) em vez
  de um mecanismo novo de esconder card.
- O campo novo `votos_disputa_projetados` é aditivo e opcional — payload existente sem o campo
  continua válido para todo consumidor atual; só o consolidado regional de Projeção degrada para
  "—" na ausência dele, nunca quebra.

**Negativas**:
- **"Outros" da região é estruturalmente subestimado por design.** A cauda "Outros" de cada UF (além
  dos 4 primeiros que o payload nacional detalha, ADR-0017/RF-190) entra inteira em "Outros" da
  região, mesmo quando um desses partidos da cauda é grande o bastante para merecer nome próprio em
  alguma UF — limitação aceita do payload nacional (27 leituras de UF por render foi a alternativa
  descartada por custo), não um bug de agregação.
- **Duas semânticas de "consolidado" no mesmo componente visual entre cargos** — por partido em
  Governador/Senador, por candidato em Presidente — quem mantiver o componente precisa lembrar qual
  agregação vale em qual cargo; divergir os dois em uma correção futura reproduz a mesma classe de
  erro já registrada para outras regras condicionadas por cargo (ADR-0028, ADR-0048 item 7).
- **A Projeção regional fica muda ("—") em qualquer payload gravado antes desta mudança**, mesmo que
  a Parcial da mesma região esteja disponível — uma tela pode mostrar Parcial cheia e Projeção "—"
  lado a lado até o produtor novo rodar pela primeira vez em produção.
- **O filtro de status em `/governador` passa a ter dois comportamentos simultâneos na mesma
  tela** (esconde cards, mas não muda o consolidado) — leitura possivelmente contraintuitiva para
  quem espera que o consolidado reflita "o que estou vendo agora"; decisão explícita do dono, não
  uma omissão.

## Alternativas consideradas

- **Estimar o total projetado por UF como `contado ÷ % apurado`** (o que o protótipo fez) —
  rejeitada para produção: só é exata quando a apuração avança uniformemente entre UFs, premissa que
  o gerador do modo simulado cumpre e a apuração real não cumpre; enviesaria a Projeção regional pelo
  ritmo de apuração de cada UF, não pelo resultado.
- **Ler os 27 payloads de UF por render das capas nacionais** — rejeitada por custo: transforma 1
  leitura de Edge Config em 27 por render, sem necessidade, quando o total projetado cabe como um
  campo escalar a mais na linha que a capa já lê.
- **4 partidos/candidatos + "Outros" no consolidado** (versão C original do protótipo) — rejeitada
  pelo dono: no Sudeste "Outros" chegava a 43%, número grande demais para uma legenda dizer algo
  útil sobre a região.
- **Regiões fechadas por padrão** — rejeitada pelo dono: a informação do consolidado deve estar
  visível na primeira renderização, não atrás de um clique.
- **Versão A (faixa de região sem recolher) e versão B (cartão de região com atalhos de
  navegação)** — descritas no protótipo, ambas rejeitadas em favor de C por não oferecerem o
  controle de abrir/fechar por região que o dono pediu.

## Cross-refs

- [ADR-0017](0017-transparencia-total-3-camadas.md) / [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
  D21 — mecanismo de colapso visual (nós sempre no DOM) reaproveitado para abrir/fechar região.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — desempate neutro
  (votos desc, alfabético no empate) e o princípio "ausência ≠ zero" que rege o campo novo do item 4.
- [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — base de votos em disputa
  (válidos + sub judice, anulado fora) usada no consolidado regional, idêntica à dos cards de UF.
- [ADR-0055](0055-resultpanel-top2-cartoes-versao-d.md) — regra de selo de turno de Presidente por
  rota; fundamenta o item 6 (cards de Presidente na home sem selo de turno).
- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) — "Placar por estado"
  (`StateGroupedTable`), painel existente da home junto ao qual a nova seção entra (antes dele).
- [ADR-0042](0042-cargo-uf-numero-chave-identidade-candidatura.md) — `EdgeUfRow.top_candidatos`
  como fonte de identidade por UF; o consolidado regional não introduz uma segunda resolução de
  nome/partido.
- Constituição § 2 (ordem neutra por métrica de voto, nunca por juízo editorial) —
  [../../constitution.md](../../constitution.md).
- Payload/tipos: `lib/edge-config/types.ts` (`EdgeUfRow`, campo novo `votos_disputa_projetados?`),
  `api/model/project.py` (emissão do campo, cargos 1/3/5).
- Novo módulo: `lib/config/regioes.ts` (mapa estático UF → região IBGE, ordem fixa das 5 regiões).
- Protótipo e decisão do dono:
  [docs/design-system/prototipos/capas-regioes-2026-09-28/README.md](../../design-system/prototipos/capas-regioes-2026-09-28/README.md).
- Specs que devem passar a citar este ADR no frontmatter `adrs:`:
  `docs/specs/003-home-nacional/spec.md`, `docs/specs/006-grid-governadores/spec.md`,
  `docs/specs/016-senador/spec.md`.
