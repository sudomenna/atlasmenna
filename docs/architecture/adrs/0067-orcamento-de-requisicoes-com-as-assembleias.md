---
id: ADR-0067
title: Orçamento de requisições ao TSE com as assembleias — Fase 1 em resumo a 1 rps por cargo; Fase 2 com o cargo 7 intercalado na faixa de 5 rps do cargo 6, volta de 60 min para os dois e pior caso de 81 rps; emenda a cadência e o pior caso do ADR-0036
status: accepted
date: 2026-09-29
amends: 0036
---

# ADR-0067 — Orçamento de requisições com as assembleias

## Status

Aceito (2026-09-29) — plano aprovado pelo dono, que aceitou o custo de tempo descrito abaixo.

**Emenda o [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) em dois pontos**: o pior caso
agregado de requisições, que ele fixou em 80 rps, passa a 82 na Fase 1 e a 81 na Fase 2; e, **só se a Fase 2
subir**, a volta completa do cargo 6 passa de 30 para 60 minutos. O que o ADR-0036 fixou continua valendo: granularidade por zona, fatiamento
em 6 por segmento de rota, trava anti-overlap por `(cargo, fatia)`, `rpsMax = 5` para o cargo 6 e a recusa de
subir a faixa a 10 rps. Nota curta aplicada ao `## Status` do ADR-0036; o corpo dele não foi reescrito.

É o segundo de dois ADRs do mesmo plano. O [ADR-0066](0066-cargos-7-e-8-como-proporcionais-do-produto.md)
decide o que são os cargos 7 e 8 no produto; este decide quanto eles podem custar ao TSE.

## Contexto

**1. O teto é do TSE, e a margem é da constituição.** O TSE aceita no máximo 100 requisições por IP por
segundo e bloqueia o IP por 10 minutos, renovados, acima disso (`docs/reference/regulatory.md:107`);
requisição a endereço incorreto (404) também pode gerar bloqueio (`:108`). A constituição § 1 exige margem
bem abaixo do teto. O projeto está calibrado em **80 rps de pior caso**: três cargos pesados (Presidente,
Governador e Senador) a 25 rps cada, mais 5 rps do Deputado Federal (`lib/config/cargos.ts`,
`piorCasoAgregadoRps()`; teste fixo em `tests/unit/config/cargos.test.ts:85`). O pior caso é a **soma dos
tetos**, não uma medida de média: os crons coincidem a cada múltiplo de 5 minutos, o `rpsMax` de cada cargo
vale por invocação, e o TSE vê a soma no IP. Foi medido em 11/09 com os quatro cargos a 40 rps: pico de
160 rps (`lib/config/cargos.ts:136-153`; ADR-0035, emenda "teto de requisições recuado de 50 para 40"). O ADR-0036
(`:214-218`) recusou subir para 85 rps para preservar a margem do dia D.

**2. A faixa do Deputado não tem folga.** O cargo 6 é varrido em 6 fatias de ~1.019 alvos, ~204 s cada a
5 rps, uma disparada a cada 5 minutos (`vercel.ts`: fatia 1 nos minutos 0 e 30, fatia 2 em 5 e 35, e assim
por diante até a fatia 6 em 25 e 55). Isso ocupa **todos os 12 slots de 5 minutos da hora**: não há
minuto livre onde encaixar um segundo cargo fatiado sem duplicar a faixa para 10 rps. A duração da fatia
(~204 s) também é o que protege o teto de `maxDuration` de 300 s: uma fatia nunca invade o slot seguinte.

**3. A demanda nova.** O cargo 7 tem tantos pares município×zona quanto o federal menos os do DF
(~6.090 alvos, o plano); o cargo 8 tem os do DF (~21 arquivos, contando o resumo). Em granularidade UF, os
dois juntos são 27 arquivos por rodada (26 do cargo 7, um do cargo 8). Cargo 7 por zona a 5 rps exige as
mesmas 6 fatias de ~1.015 alvos, ~203 s cada. O dono escolheu **projeção** para as assembleias
(ADR-0066), e projeção exige zona: com um arquivo por UF o bootstrap tem uma única unidade de reamostragem
e o intervalo degenera (ADR-0036, Contexto), e a projeção não tem de onde extrapolar (ADR-0063).

**4. Os ciclos pesados não têm para onde ceder.** Baixar os três pesados de 25 para abrir espaço
esbarraria no `maxDuration`: 6.110 alvos a 22 rps são ~278 s (~279 s com os 6.137 alvos da contagem do
plano de 29/09), com 21 a 22 s de folga sob os 300 s. Hoje, a 25 rps, o ciclo tem ~244 s, e o comentário
do cron do Senador em `vercel.ts` já registra que "a folga aqui é a mais apertada do projeto".

## Decisão

**1. Duas fases, com degradação pré-acordada.** O pior caso de cada estado, na soma dos tetos por cargo:

| | Presidente | Governador | Senador | Deputado Federal | Estadual (7) | Distrital (8) | Pior caso |
|---|---|---|---|---|---|---|---|
| Hoje | 25 | 25 | 25 | 5 | — | — | 80 |
| Fase 1 | 25 | 25 | 25 | 5 | 1 | 1 | 82 |
| Fase 2 | 25 | 25 | 25 | 5 (faixa dividida com o 7) | 5 (mesma faixa) | 1 | 81 |

**2. Fase 1 — assembleias pelo resumo do estado.** Os cargos 7 e 8 passam a `granularidade: "uf"`, `rpsMax: 1`
cada, com um cron de 5 em 5 minutos por cargo nas duas janelas usadas pelos demais (apuração e simulado).
Cada rodada pede só o arquivo-resumo de cada casa: 27 arquivos, ~27 s. O cargo 6 **não muda**: 5 rps, 6
fatias, volta de 30 minutos. A Fase 1 entrega cadeiras por partido na parcial, listas, marcas, mais
votados, puxadores, regras, Conferência e selo do TSE; **não entrega projeção nem intervalo de cadeiras**
(um arquivo por UF, `k_a = 1`, o diagnóstico do ADR-0036 continua verdadeiro; o bootstrap já omite o
intervalo abaixo de 2 zonas com voto, ADR-0063 Decisão 3).

**3. Fase 2 — zonas, projeção e volta de 60 minutos.** O cargo 7 passa a `granularidade: "zona"`, `rpsMax:
5`, em 6 fatias **intercaladas com as 6 do cargo 6 na mesma faixa de 5 rps**: as fatias do cargo 6 disparam
nos minutos 0, 10, 20, 30, 40 e 50, as do cargo 7 nos minutos 5, 15, 25, 35, 45 e 55. Cada slot de 5 minutos
continua com uma fatia só e cada fatia dispara **uma vez por hora**: a volta completa é de **60 minutos para
os dois cargos** (12 fatias × 5 min; antes, 30 min para o cargo 6). A rota de ingestão fatiada
(`app/api/ingest/[cargo]/[fatia]/route.ts`) passa a aceitar o cargo 7; a trava anti-overlap por
`(cargo, fatia)` do ADR-0036 já impede que a fatia 1 do cargo 7 bloqueie a fatia 1 do cargo 6. O cargo 8
passa a zona (~21 arquivos), `rpsMax: 1`, **sem fatia**, com cron próprio de 5 em 5 minutos. A projeção
dos cargos 7 e 8 sobe atrás de `interruptor-projecao-est`, desligada (ADR-0066 Decisão 6).

**4. A cadência declarada acompanha o cron.** `CADENCIA_SEGUNDOS` (`api/model/cargos.py`; o plano prevê o
espelho em TypeScript) passa a ser, por cargo: Fase 1 — 6: 1.800 (inalterado), 7 e 8: 300; Fase 2 — 6 e 7:
3.600, 8: 300. `ATUALIZACAO_MIN_DEPUTADO`, hoje uma constante única, passa a ser por cargo. É a cadência
de **varredura completa**, não o intervalo entre disparos (`api/model/cargos.py`, comentário de
`CADENCIA_SEGUNDOS`), e o payload a leva à tela em `atualizacao_min` (RF-128: o texto de frescor da tela
sai do payload, não do JSX). Como cadência e cron são declarados em dois lugares, um teste lê o `vercel.ts`
e exige que a volta completa de cada cargo fatiado, calculada a partir dos crons, seja igual à cadência
declarada dele.

**5. O pior caso é modelado por faixa, não pela soma dos `rpsMax`.** Com `rpsMax` de 5 nos cargos 6 e 7,
a soma ingênua que `piorCasoAgregadoRps()` faz hoje daria 25 + 25 + 25 + 5 + 5 + 1 = **86**: falharia
o teste fixo, ou levaria alguém a "consertar" derrubando um teto. O que garante 81 não é a tabela, é o
`vercel.ts`: os cargos 6 e 7 nunca têm fatia no ar ao mesmo tempo. A tabela de cargos passa a declarar que
6 e 7 dividem **uma faixa** (o nome do atributo é da implementação), e `piorCasoAgregadoRps()` conta cada
faixa uma vez, pelo maior teto dela. Dois testes protegem a invariante do lado do cron: nenhum slot de 5
minutos tem fatia do cargo 6 e do cargo 7 juntas, e a duração esperada de uma fatia (~204 s) fica abaixo
dos 300 s entre fatias consecutivas. O teste fixo em `cargos.test.ts` passa a exigir **82** na Fase 1 e
**81** na Fase 2.

**6. Degradação pré-acordada, decidida na sexta 02/10, às 18h, com o dono.** Fase 2 verde: sobe tudo, com a
projeção das assembleias desligada até o dono ligar. Fase 2 não verde: sobe **só a Fase 1**, e o cargo 6
continua em 30 minutos (nenhum cron dele muda). Fase 1 não verde: **nada dos cargos 7 e 8 sobe**; as
assembleias entram depois de 05/10, com os arquivos finais do TSE, que continuam no ar. "Verde" é o
conjunto de portões do plano de 29/09 (testes, e2e, identidade G1, replay presidencial inalterado); este
ADR fixa a árvore de decisão, não os limiares. **A escolha é feita antes do congelamento de deploy de
16h às 05h de 04/10** (ADR-0063, Contexto 2 e 3): variável de ambiente só age em deployment novo, então não existe
volta de fase durante a noite. O que se corta em tempo real é a projeção, pelo interruptor.

## Alternativas consideradas

- **Subir a faixa do Deputado para 10 rps** (85 rps agregados), mantendo 30 minutos para o 6 e o 7.
  Rejeitada: é o valor que o ADR-0036 (`:214-218`) já recusou pela margem do dia D. O TSE bloqueia o IP
  por 10 minutos renovados acima de 100 (`docs/reference/regulatory.md:107`), e o pico medido é a soma dos
  tetos (`lib/config/cargos.ts:136-153`). Com 85 a margem cai de 20 para 15 rps, e não haveria a mesma
  reserva para retry, relógio impreciso e coincidência de crons.
- **Baixar os três pesados de 25 para ~22 rps** para abrir espaço. Rejeitada: o ciclo de 6.137 alvos a 22 rps
  vai a ~279 s contra o `maxDuration` de 300 s. Qualquer atraso do TSE numa noite de pico estoura a
  invocação e o ciclo não termina, no cargo que mais importa. Trocar folga de tempo dos três cargos
  principais por frescor de um proporcional inverte a prioridade que o próprio `lib/config/cargos.ts` já
  registra (o Deputado é o cargo de menor urgência editorial dos quatro).
- **Cargo 7 em resumo para sempre, sem projeção.** Rejeitada pelo dono: a alternativa lhe foi oferecida e ele
  escolheu projeção, aceitando os 60 minutos. Ela continua sendo, na prática, o que a Fase 1 entrega se a
  Fase 2 não subir.
- **Encaixar as fatias do cargo 7 em minutos livres.** Rejeitada por não existirem: as fatias do cargo 6
  ocupam os 12 slots de 5 minutos da hora (Contexto 2).

## Consequências

**Positivas**:
- A Fase 2 não sobe a taxa por cargo; o custo dela é **tempo**, não requisições. O pior caso sobe só o
  1 rps do cargo 8 (80 → 81), abaixo do 85 que o ADR-0036 recusou.
- A Fase 1 é independente do ritmo do federal: não toca o cargo 6, e a decisão de sexta reverte para ela
  sem desmontar nada.
- Reaproveita o mecanismo do ADR-0036 sem código de exceção novo: fatiamento por segmento de rota, trava
  por `(cargo, fatia)`, `sliceTargets`.
- O ponto de decisão tem data, dono e árvore, o que evita a decisão improvisada na véspera.

**Negativas**:
- **O federal fica mais lento: 30 → 60 minutos por volta na Fase 2.** É o custo que o dono aceitou. Para o
  leitor, a bancada parcial da Câmara passa a ter até uma hora de idade mais a duração da fatia. A tela
  acompanha sozinha (RF-128, `atualizacao_min` vem do payload); o que **não** acompanha e precisa ser
  atualizado à mão: o texto de frescor onde ele for literal, os vigias, o runbook, o roteiro
  `docs/operations/vespera-03-10.md`, `docs/nfr/availability.md:23` (que lista 1.800 s) e os comentários de
  `vercel.ts` e `api/model/cargos.py`.
- **O alarme de "dado parado" e o banner amarelo só disparam depois de 3 horas.** O limiar do ADR-0038
  (D3, D4) é 3 × a cadência declarada: para o cargo 6 era 5.400 s (90 min) e passa a 10.800 s (180 min) na
  Fase 2, e o cargo 7 nasce igual (na Fase 1, o cargo 7 tem 900 s). Numa noite de ~11 horas (janela
  17h–04h), uma parada do Deputado pode passar até 3 horas sem aviso. O
  desenho do ADR-0038 (limiar derivado da cadência) faz essa mudança acontecer **sozinha**, sem que ninguém a
  decida. Não é resolvido aqui: ver Pontos em aberto.
- **O texto do ADR-0063 sobre "ligar é lento" foi escrito sobre 30 minutos.** A Decisão 4 e as Consequências
  do ADR-0063 citam a volta de 30 min do ADR-0036 como o tempo para a projeção aparecer depois de ligada.
  Com a Fase 2, esse número passa a 60 para o federal. Se a referência era a volta e não o ciclo do
  modelo, a assimetria "desligar rápido, ligar lento" piora. Quem corrige o número é uma nota naquele ADR,
  não este.
- **A margem cai de 20 para 19 rps na Fase 2 (18 na Fase 1).** É pequena e ainda abaixo dos 85 recusados,
  mas é a primeira vez que o teto calibrado sobe desde o ADR-0036, e a invariante de 81 depende de os
  minutos do `vercel.ts` estarem certos. Uma edição de minuto de cron leva o pior caso a 86 sem que
  nenhum tipo reclame; só o teste do Decisão 5 pega.
- **Primeiro contato com endereços de cargo 7 e 8.** Nenhum arquivo `c0007`/`c0008` foi jamais pedido ao TSE
  por este projeto (ADR-0066). Um erro de padrão de endereço na Fase 2 são ~1.015 requisições a 404 por
  fatia, no mesmo IP que serve Presidente, Governador e Senador; na Fase 1 são 27 por rodada. Uma busca
  textual em `lib/tse` (por freio, circuito, sequência de 404) não achou nenhum limitador de rajada de 404;
  a proteção é o filtro de UF por cargo (ADR-0066 Decisão 1), o Passo 0 do plano (baixar à mão três ou
  quatro arquivos enquanto o simulado estiver no ar) e o alarme de erro de leitura no primeiro ciclo. É a
  razão de a Fase 1 existir como degradação.
- **Número de crons: 19 hoje, 23 na Fase 1, 33 na Fase 2** (cargo 7: 6 fatias × 2 janelas; cargo 8: 2;
  a contagem segue a convenção atual de duas janelas por cargo). **O limite do plano Vercel não foi
  conferido** e precisa sê-lo antes de a implementação registrar os crons. Se o limite apertar, uma saída
  sem efeito no pior caso é fundir as duas janelas de cada cargo numa expressão só, já que o handler
  responde `{ skipped: "out_of_window" }` fora da janela de `INGEST_WINDOW` sem custo real (comentário do
  cron do simulado em `vercel.ts`); isso muda invocações vazias, não requisições ao TSE.
- **A granularidade dos cargos 7 e 8 é mais uma decisão de deploy.** `TSE_DEPUTADO_GRANULARIDADE` é
  variável de ambiente, e hoje só vale para o cargo 6 (`getGranularidade`, `lib/tse/targets.ts`); o plano a
  estende a todo cargo proporcional, de modo que uma variável reverte 6, 7 e 8 juntos, e só com deploy
  (ADR-0063, Contexto 3). Trocar `uf` por `zona` depois do primeiro ciclo de 04/10 mistura duas famílias
  de linhas em `snapshots`, que é append-only (constituição § 10). O ramo proporcional decide por frescor
  qual família sobrevive (`_discard_zero_zona_sentinel_when_real_zonas_exist`, ADR-0036, nota de 13/09), mas
  os testes de direção que provam isso foram escritos e verificados por mutação para o cargo 6, não para o 7
  e o 8. Regra: a granularidade de 7 e 8 não muda depois do primeiro ciclo de 04/10, e os testes de direção
  precisam ser parametrizados para os dois.
- **A Fase 1 entrega as assembleias sem intervalo e sem projeção.** Se a Fase 2 não subir, o produto
  publica a bancada parcial das 27 casas sem nenhuma indicação de "ainda vem voto" além do `% apurado`.
  A spec 027 precisa dizer isso na tela; este ADR só registra que é o estado consciente da Fase 1.
- **`TSE_CARGOS` em produção, se existir, é chave de desligamento** e precisa listar 7 e 8 na virada de 03/10
  (ação do dono, roteiro `docs/operations/vespera-03-10.md`; `getActiveCargos`, `lib/tse/targets.ts`). Sem
  isso os crons rodam e não fazem nada.

## Pontos em aberto

- **Limiar de "dado parado" dos cargos fatiados.** O limiar de 3 × a volta (ADR-0038) é, para o Deputado,
  pouco sensível: cada fatia roda a cada 10 minutos por cargo, mas a volta é de 60. Derivar o limiar do
  intervalo entre fatias e não da volta detectaria uma parada em ~30 minutos em vez de 180. Isso é emenda
  ao ADR-0038 (D3), não deste ADR, e não foi decidido. Enquanto ninguém decidir, vale o efeito automático
  descrito nas Consequências.
- **Limite de crons do plano Vercel.** Não conferido (Consequências).
- **Duração real das fatias do cargo 7** (~203 s esperados a 5 rps, mesma ordem das do 6) **e do ciclo do
  cargo 8** (~21 s): nada foi medido. `duration_ms` no ensaio de 03/10 é a primeira medida.
- **O Passo 0** (arquivos reais de cargo 7 e 8 do simulado) pode não ser possível se o simulado já estiver
  fora do ar; nesse caso o primeiro contato é o primeiro ciclo de 04/10.

## Cross-refs

- [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) — emendado por este ADR (cadência e pior
  caso do cargo 6). Fatiamento, trava por `(cargo, fatia)` e `rpsMax = 5` reaproveitados sem alteração.
- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) — par município×zona, o teto recuado de 50 para 40
  e a medição de 160 rps; [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — segmento de rota
  como mecanismo de fatia.
- [ADR-0038](0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — D3/D4: o limiar de dado parado deriva da
  cadência declarada; `docs/nfr/availability.md:23` repete os números de 1.800 s.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — variável de ambiente só
  age em deployment novo; deploy congelado de 16h às 05h em 04/10; as menções a 30 minutos.
- [ADR-0066](0066-cargos-7-e-8-como-proporcionais-do-produto.md) — os cargos 7 e 8; filtro de UF por cargo;
  `interruptor-projecao-est`.
- Spec 001 (`docs/specs/001-ingestao-tse/`) — crons e orçamento de requisições; spec 017 RF-128 (cadência
  visível, agora por cargo); spec `027-deputado-estadual-distrital`.
- Constituição § 1 (teto de requisições bem abaixo do limite documentado; 404), § 7 (falha degradada),
  § 8 (transparência: cadência legível), § 10 (snapshots append-only):
  [../../constitution.md](../../constitution.md).
- `docs/reference/regulatory.md:107-108`; `docs/operations/runbook.md` e `docs/operations/vespera-03-10.md`
  (frescor, vigias, `TSE_CARGOS`) — a atualizar.
- Código: `lib/config/cargos.ts` (`rpsMax`, `piorCasoAgregadoRps`), `tests/unit/config/cargos.test.ts:85`,
  `vercel.ts`, `api/model/cargos.py` (`CADENCIA_SEGUNDOS`, `ATUALIZACAO_MIN_DEPUTADO`),
  `lib/tse/targets.ts` (`getGranularidade`, `getActiveCargos`, `sliceTargets`),
  `lib/tse/ingest-handler.ts` (trava por `(cargo, fatia)`).
