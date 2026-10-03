---
id: ADR-0068
title: Um bucket de taxa por cargo dentro do processo, não um singleton por processo — o teto de cada cargo vale para todas as invocações dele na mesma instância, e cargos diferentes não se afetam; emenda o ADR-0035 (D3) e a premissa "Fluid Compute isola instâncias"
status: accepted
date: 2026-09-30
amends: 0035
---

# ADR-0068 — Limitador de taxa do TSE por cargo

## Status

Aceito (2026-09-30).

**Emenda o [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) (D3 e a emenda "teto recuado de 50 para
40") num único ponto: a premissa de que "o Fluid Compute isola instâncias por invocação concorrente, cada uma
com seu próprio rate limiter singleton".** A premissa é falsa, e o pior caso agregado que ela sustentava só
passa a ser verdadeiro com esta decisão (Contexto 2 e 3). O que o ADR-0035 fixou continua valendo: o teto de
100 rps por IP do TSE (RF-010.3), a recusa de operar no limite, o lock anti-overlap por cargo, o cron por
cargo e a pendência do limitador coordenado entre instâncias, que **continua pendente**. O que este ADR muda
é a **unidade de isolamento do bucket**: de "o processo" para "o cargo dentro do processo". Nota curta
aplicada ao corpo do ADR-0035; o restante dele não foi reescrito.

**Escopo nesta base (main).** Vale para os cargos que a main tem — 1 (Presidente), 3 (Governador), 5 (Senador)
e 6 (Deputado Federal) —, com os tetos de `lib/config/cargos.ts` (25, 25, 25, 5; soma **80 rps**). A spec 027
(Deputado Estadual e Distrital, cargos 7 e 8 a 1 rps cada, pior caso de 82/81 rps) **vai acrescentar** esses
cargos ao mesmo mapa, sem mudar o mecanismo; os ADRs dela (0066 e 0067) ainda não estão na main. Este ADR foi
escrito de modo que entre na main **antes** da 027: o defeito que ele corrige já existe hoje, com ou sem ela.

## Contexto

**1. O que o código fazia.** `getTseRateLimiter(cargo?)` (`lib/tse/rate-limiter.ts`) devolvia um **singleton
de processo**: a primeira chamada lia o teto do cargo informado (`cargoInfo(cargo).rpsMax`, ou o default de
5 rps sem cargo) e o congelava; toda chamada seguinte, de qualquer cargo, recebia o mesmo bucket. O próprio
`ingest-handler.ts` documentava o efeito: "quem chama primeiro decide". E quem chamava depois nem sempre
informava cargo: `fetchEA20` (`lib/tse/client.ts`) e `detectChangedUfs` (`lib/tse/acompanhamento.ts`) chamavam
`getTseRateLimiter()` sem argumento, de modo que o cargo só chegava ao bucket pelo `ingest-handler`, uma vez
por ciclo, antes do primeiro fetch. O ciclo genérico (`/api/ingest`, sem cargo, preview e disparo manual)
percorria os cargos em sequência com **um** bucket, à maior taxa entre os cargos cobertos
(`rpsMaxParaCargos`): isso levava os alvos do cargo 6 a 25 rps, cinco vezes o teto que o ADR-0036 fixou para
ele.

**2. A premissa que não se sustenta.** Os comentários de `rate-limiter.ts`, de `lib/config/cargos.ts`
(`rpsMax`) e o D3 do ADR-0035 supõem que o Fluid Compute dá a cada invocação concorrente uma instância
própria, logo um bucket próprio. Não dá: o Fluid Compute **reaproveita instâncias e multiplexa invocações
concorrentes na mesma instância** (o glossário do projeto já o descreve como "multiplexing",
`docs/reference/glossary.md`, e o comentário de `ingest-handler.ts` sobre `waitedMs` já parte disso ao
reportar um delta). O singleton de processo, portanto, não era "um bucket por invocação": era um bucket
compartilhado por tudo que caísse na instância, com a taxa de quem chegou primeiro.

**3. Por que isso importa para 04/10, com ou sem a spec 027.** Os crons de Presidente e Governador disparam
todo minuto e os de Senador e das fatias do Deputado Federal a cada 5, coincidindo a cada múltiplo de 5
(`vercel.ts`). Três efeitos, nas duas direções:

- **Divisão silenciosa do teto.** Presidente e Governador concorrentes na mesma instância dividem os 25 rps de
  um bucket só: cada um anda a ~12,5 rps e 6.110 alvos levam ~489 s (conta: 6.110 / 12,5; **não medido** em
  produção, onde não se sabe se alguma instância já serviu os dois), contra o `maxDuration` de 300 s. Com
  Senador e uma fatia do Deputado na mesma instância, a conta é ~19.400 alvos / 25 rps ≈ 777 s (simulado: ver
  Decisão 5).
- **Congelamento para baixo.** Uma instância que atenda primeiro uma fatia do cargo 6 (5 rps) prende o bucket
  em 5 rps; se o Presidente cair nela depois, ~6.138 alvos a 5 rps são ~1.228 s. O ciclo do cargo mais
  importante da noite não termina, sem erro. Com a spec 027, os cargos 7 e 8 (1 rps) agravam o mesmo defeito
  (~6.110 s).
- **Congelamento para cima.** No ciclo genérico, os alvos do cargo 6 andavam a 25 rps (ver item 1).

**4. O que o pior caso agregado supõe.** ADR-0035 (emenda de 11/09) trata o pior caso como a **soma dos tetos
por cargo** (80 rps; `piorCasoAgregadoRps()`) e o apresenta como a garantia contra os 100 rps do TSE
(`docs/reference/regulatory.md`; constituição § 1). Essa soma supõe **buckets independentes por cargo**. Com
o singleton, a soma era, em alguns cenários, menor (instâncias compartilhadas) e, no congelamento, o que ela
descreve nem era o que rodava; ela só descreve o código se o bucket for, de fato, por cargo.

## Decisão

**1. Um bucket por cargo, em mapa, criado sob demanda com o `rpsMax` do cargo.** `getTseRateLimiter(cargo)`
passa a manter um mapa `cargo → TokenBucket` no processo. A primeira chamada de um cargo cria o bucket dele,
com o teto de `cargoInfo(cargo).rpsMax` (`lib/config/cargos.ts`) e as mesmas regras de antes para
`TSE_MAX_RPS` (override global, com floor 1 e ceiling 50, aplicado a **cada** bucket). A taxa de um cargo
**nunca** é decidida por uma chamada de outro cargo. Chamadas **sem cargo** (`tse-watch`, diagnóstico, script
avulso) recebem um bucket **próprio**, no default seguro de 5 rps (`TSE_MAX_RPS_DEFAULT`), e nunca o de um
cargo. `resetTseRateLimiter()` descarta todos os buckets.

**2. O cargo do alvo chega ao cliente sem default.** `fetchEA20` (`lib/tse/client.ts`) e `detectChangedUfs`
(`lib/tse/acompanhamento.ts`) passam a receber o `cargo` do alvo ou do ciclo como parâmetro **obrigatório no
tipo**, e a passá-lo a `getTseRateLimiter`. Esquecer o cargo é erro de compilação, não um bucket de 5 rps
silencioso; só `getTseRateLimiter()` em si continua aceitando a ausência, para os chamadores fora do caminho de
ingestão. O ciclo genérico deixa de usar "a maior taxa entre os cargos cobertos": cada alvo paga no bucket do
seu cargo. A leitura do EA14 (um arquivo por **eleição**, não por cargo) é paga no bucket do cargo do primeiro
alvo daquela eleição no ciclo — sempre um cargo que o ciclo já cobre.

**3. Semântica de compartilhamento.** Invocações concorrentes **do mesmo cargo** na mesma instância dividem o
bucket do cargo: o teto do cargo vale para o conjunto, por IP, não por invocação. Cargos **diferentes** na
mesma instância não se afetam: cada um anda no seu ritmo. `waitedMs` (e as demais estatísticas do bucket) é
**por cargo**; o ciclo reporta o delta do bucket do cargo dele, e o ciclo genérico soma os deltas dos buckets
que tocou.

**4. O pior caso agregado permanece como garantia, agora com a premissa satisfeita.** A garantia contra os 100
rps continua sendo a **soma dos tetos por cargo**: 80 rps nesta base (25 + 25 + 25 + 5), 82 rps quando a spec
027 acrescentar os cargos 7 e 8 a 1 rps (ADR-0067 dela). Ela passa a valer porque o bucket de cada cargo é, de
fato, independente e tem o teto do cargo. Vale sob condições que este ADR **não** cria, apenas nomeia: (a) há
no máximo um ciclo em voo por `(cargo, fatia)`, o que é o lock anti-overlap do ADR-0035 D3 e do ADR-0036; (b)
as fatias do cargo 6 nunca estão no ar ao mesmo tempo, o que é a intercalação de minutos de cron do ADR-0036.
O bucket por cargo **não impõe** nenhuma das duas: duas fatias do cargo 6 na mesma instância dividiriam um
bucket de 5 rps (mais lento, não mais rápido), mas em instâncias diferentes somariam 10.

**5. Prova exigida e entregue.**

- `tests/unit/tse/rate-limiter-por-cargo.test.ts` (17 casos, relógio real, sem rede): (i) criar o bucket de
  menor teto (cargo 6) primeiro não altera a taxa do cargo 1; (ii) duas "invocações" do mesmo cargo consomem do
  mesmo bucket, com a taxa agregada no teto do cargo e não no dobro; (iii) chamada sem cargo não usa nem cria o
  bucket de um cargo; (iv) `fetchEA20` e `detectChangedUfs` pagam no bucket do cargo que recebem; (v) uma
  varredura do código de produção falha se alguém chamar `getTseRateLimiter()` sem cargo ou se um chamador novo
  aparecer fora dos três autorizados.
- `tests/unit/tse/ingest-carga-por-cargo.test.ts` (teste de carga simulada, relógio falso): roda
  **`runIngestCycle` de verdade**, concorrente, para os cargos 1, 3, 5 e uma fatia do 6 (1/6) no mesmo
  processo, sobre o gerador de alvos de produção com 6.110 pares sintéticos (6.138 alvos no cargo 1 — com o
  BR —, 6.137 nos cargos 3 e 5, 1.023 na fatia 1/6 do cargo 6), em duas ordens de chegada (Presidente primeiro;
  fatia do Deputado primeiro). Resultado medido (simulado): **cada ciclo pesado termina em 244,5 s; a fatia do
  cargo 6, em 203,6 s** (contra 300 s de `maxDuration`); taxa em regime, por cargo, **exatamente** no teto (25,
  25, 25, 5) e soma em regime **80 rps**, nunca acima.
- Mutações do projeto: reverter o mapa para singleton derruba 18 casos (os 12 do limitador e 6 do teste de
  carga — ciclo do Presidente a 775 s com o Presidente primeiro e a 3.886 s com a fatia do Deputado primeiro);
  passar `cargo: 1` fixo a `fetchEA20` no handler derruba 8 casos do teste de carga.

**6. O comentário errado sai.** As afirmações "o Fluid Compute isola instâncias" e "cada invocação tem seu
próprio bucket" em `rate-limiter.ts` e `lib/config/cargos.ts` (`rpsMax`) são removidas e substituídas pela
descrição correta (Contexto 2), apontando para este ADR. O texto "buckets independentes garantem a média, não o
pico instantâneo" permanece verdadeiro entre INSTÂNCIAS e continua sendo a pendência do limitador coordenado
(a rajada inicial de cada bucket foi resolvida na emenda de 2026-10-03).

## Alternativas consideradas

- **Rotas separadas por cargo** (uma função Vercel por cargo, sem compartilhar processo entre cargos).
  Rejeitada: não resolve a concorrência do **mesmo** cargo na mesma instância (duas invocações do cargo 1
  continuariam dividindo ou multiplicando o bucket sem regra), multiplica funções e entradas de cron, e o
  limite do plano Vercel não foi conferido. Além disso, o fatiamento por segmento de rota já existe para o
  cargo 6 (ADR-0036) e cobre outro problema.
- **Contador coordenado entre instâncias** (limitador distribuído com estado compartilhado). Rejeitada nesta
  janela: o ADR-0035 já o deixou pendente, e continua fora: custo de infraestrutura e de novo modo de falha (o
  que o ciclo faz quando o contador cai?) na semana da eleição, sem medição de `rateLimited` que o justifique.
  Ele resolveria também o pico instantâneo entre instâncias, que este ADR não resolve.
- **Todos os cargos no mesmo bucket, na menor taxa** ou **na maior**. Rejeitada: na menor, o Presidente estoura
  o `maxDuration`; na maior, o cargo 6 recebe 25 rps, cinco vezes o teto do ADR-0036.
- **Manter o singleton e confiar que a primeira chamada de cada instância é "do cargo certo".** Rejeitada:
  é o estado anterior, e depende de a instância nunca receber dois cargos, o que o Fluid Compute não garante.

## Consequências

**Positivas**:
- O teto de cada cargo passa a ser o que o ciclo realmente recebe, independentemente de qual cargo chegou
  primeiro à instância. O Presidente não pode mais ficar a 5 rps por causa de uma fatia do Deputado, nem o
  cargo 6 a 25 rps no ciclo genérico por causa do Presidente.
- Corrige também o caso de hoje: Presidente e Governador concorrentes na mesma instância deixam de dividir
  25 rps e passam a ter 25 cada, ~244 s por ciclo, dentro dos 300 s.
- A conta de 80 rps (e a de 82, com a spec 027) passa a descrever o código. Antes, era uma premissa não
  verificada.
- `waitedMs` por cargo torna a leitura de `rateLimited` do simulado inequívoca (qual cargo esperou), o que é
  insumo para decidir o limitador coordenado que o ADR-0035 deixou pendente.
- Sem dependência nova, sem infraestrutura nova, sem mudança em cron, rota, schema ou payload.

**Negativas**:
- **A garantia de 80 rps continua dependendo de duas coisas fora do limitador**: o lock anti-overlap por
  `(cargo, fatia)` e os minutos do `vercel.ts`. O lock é uma leitura de `ingest_log` seguida de uma escrita, não
  atômica, e o handler segue sem ele se a gravação do marcador falhar. Duas instâncias do **mesmo** cargo em
  voo ao mesmo tempo têm buckets independentes e somam o dobro do teto do cargo; este ADR não cobre isso, e só
  o limitador coordenado cobriria.
- ~~**A rajada inicial não é tratada, e o teste de carga a mede.**~~ **RESOLVIDA em 2026-10-03 (ver "Emenda de
  2026-10-03" abaixo).** Redação original, preservada: cada bucket começava cheio (burst = taxa); com os quatro
  ciclos começando no mesmo instante e um CDN de latência zero, o **primeiro segundo** somava 156 requisições
  (49 + 49 + 49 + 9), acima dos 100 rps do TSE se ele contar por segundo; em regime a soma era 80. Não era
  efeito deste ADR (o singleton tinha o mesmo burst), e era a pendência que o ADR-0035 registra ("buckets
  independentes garantem a média, não o pico instantâneo").
- **Invocações concorrentes do mesmo cargo na mesma instância agora competem pelo teto**: cada uma fica mais
  lenta do que rodando sozinha. É o que o teto por IP exige, mas é também um risco de `maxDuration` se uma
  invocação duplicada (por exemplo, disparo manual no meio da janela) dividir o bucket com o ciclo do cron. O
  lock mitiga; não elimina.
- **O ciclo genérico (`/api/ingest`) disparado à mão durante a janela de apuração soma no IP**, como antes:
  ele tem buckets próprios por cargo, em outra invocação. Nada nesta decisão o limita em relação aos crons. O
  runbook já o restringe a preview e ensaio.
- **O bucket "sem cargo" (5 rps) não entra em `piorCasoAgregadoRps()`.** Hoje nenhum caminho de produção o
  usa (`lib/` só o pede em `ingest-handler.ts`, `client.ts` e `acompanhamento.ts`, sempre com cargo; o teste
  `rate-limiter-por-cargo.test.ts` varre `lib/`, `app/`, `scripts/`, `data-pipeline/` e `api/` atrás de
  chamada sem argumento e de chamador novo). Se algum dia um chamador de cron o usar, a conta passa de 80 a
  85, e este ADR precisa ser revisto.
- **`TSE_MAX_RPS` continua sendo override global e agora se aplica a cada bucket**: com ele definido, o
  agregado é (número de cargos concorrentes) × (valor), não a soma dos tetos de `cargos.ts`. É o
  comportamento de antes e a razão de o vigia do dia D reprovar a variável; não muda, mas deixa de ser
  mitigado pelo compartilhamento acidental.
- **`rpsMaxParaCargos` (`lib/config/cargos.ts`) ficou sem chamador em produção.** Era a regra do ciclo
  genérico "a maior taxa entre os cargos cobertos", que esta decisão remove. Permanece exportada, sem mudança,
  para não ampliar o escopo; pode ser removida em limpeza posterior.
- **Mais um mapa de estado de processo.** O que o `ingest-handler` lê para `waitedMs` deixa de ser um único
  objeto; quem lê as estatísticas do limitador precisa escolher o cargo. É pequeno, mas é superfície de erro
  na hora de integrar.

## Cross-refs

- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md): emendado (D3 e a emenda do teto de 40: a
  premissa "Fluid Compute isola instâncias"). Lock por cargo, cron por cargo e a pendência do limitador
  coordenado permanecem.
- [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md): `rpsMax = 5` do cargo 6, fatiamento e lock
  por `(cargo, fatia)`, intocados.
- [ADR-0020](0020-conformidade-res-23751-2026.md) (RF-010.3): o teto de 100 rps por IP e a proibição de sondar
  endereço seguem como ele definiu; a nota de 11/09 aplicada a ele, que repete a premissa do singleton por
  invocação, fica defasada.
- Spec 027 (`docs/specs/027-deputado-estadual-distrital/`, branch `feat/027-estadual`; ADR-0066, ADR-0067):
  acrescenta os cargos 7 e 8 (1 rps) ao mesmo mapa; o pior caso passa de 80 a 82 rps (81 na Fase 2). O
  Contexto 1 do ADR-0067 ("o `rpsMax` de cada cargo vale por invocação") passa a valer "por cargo, por
  instância".
- Spec 001 (`docs/specs/001-ingestao-tse/`): RF-010.3 (teto de requisições) deve passar a citar este ADR.
- Constituição § 1 (teto bem abaixo do limite documentado; a garantia passa a ser verdadeira por construção do
  bucket, não por premissa), § 7 (falha degradada: o cargo atrasado degrada o próprio ciclo, não o dos outros).
- Código: `lib/tse/rate-limiter.ts` (`getTseRateLimiter`), `lib/tse/client.ts` (`fetchEA20`),
  `lib/tse/acompanhamento.ts` (`detectChangedUfs`), `lib/tse/ingest-handler.ts` (`runIngestCycle`),
  `lib/config/cargos.ts` (`rpsMax`, `piorCasoAgregadoRps`).
- Testes: `tests/unit/tse/rate-limiter-por-cargo.test.ts`, `tests/unit/tse/ingest-carga-por-cargo.test.ts`.
- NFRs sob impacto: janela de ingestão e `maxDuration` de 300 s (ciclos de 6.110 alvos a 25 rps, ~244 s);
  `docs/operations/runbook.md` (§ "O que NÃO é problema: fan-out e rate limit", que desde 22/09 descreve o
  limitador como "token bucket **por cargo**" — leitura do `rpsMax` por cargo, que era verdadeira só para a
  taxa inicial; a afirmação passa a valer por inteiro com este ADR).

## Emenda de 2026-10-03 — rajada inicial de 2 tokens (pendência do burst resolvida)

**Achado** (constitution-guard, § 1, severidade alta, pré-existente): `createTokenBucket` usava
`capacity = burst ?? ratePerSec`, então todo bucket de produção nascia cheio e emitia até 2 × taxa no 1º segundo.
Os quatro ciclos disparam juntos a cada múltiplo de 5 minutos e o teste de carga mediu **156 requisições no 1º
segundo** (49 + 49 + 49 + 9) contra os 100 req/s por IP do TSE (bloqueio de 10 minutos).

**Decisão** (aprovada pelo dono, véspera do 1º turno): os buckets por cargo e o bucket sem cargo são criados com
`burst = TSE_BURST_INICIAL = 2` (`lib/tse/rate-limiter.ts`). Taxas (`rpsMax`), locks e crons não mudam.
`createTokenBucket` mantém o default `burst = ratePerSec` para quem o chamar direto; só `getTseRateLimiter` fixa a
rajada.

**Por que 2 e não 1.** Com capacidade 1, o `refill()` descarta o excedente quando o `setTimeout` dispara alguns
ms depois do devido (o token que acumularia além de 1 é cortado), e a taxa efetiva a 25 rps caiu de 2% a 26%
medido — o ciclo de ~244 s chegaria perto dos 300 s de `maxDuration`. Com capacidade 2, uma batida atrasada do
timer cabe no segundo token.

**Medido** (`tests/unit/tse/ingest-carga-por-cargo.test.ts`, relógio simulado, 304 instantâneo, os quatro ciclos
juntos, nas duas ordens de chegada):

| | antes (burst = taxa) | depois (burst = 2) |
|---|---|---|
| Pico do agregado, qualquer janela de 1 s (deslizante e fixa) | **156** | **84** |
| Teto teórico (taxa + 2 por cargo: 27 + 27 + 27 + 7) | 160 (2 × 80) | 88 |
| Ciclo Presidente / Governador / Senador (6.110 + agregados) | 244,5 s (244.520 / 244.480 / 244.480 ms) | 245,4 s (245.440 / 245.400 / 245.400 ms) |
| Fatia do Deputado Federal (cargo 6, 5 rps) | 203,6 s | 204,2 s |

O custo é ~0,9 s por ciclo (a rajada gasta é menor), longe dos 300 s. O pico de 84 fica abaixo do teórico de 88
porque o teste conta janelas de 1 s em aberto à direita (26 + 26 + 26 + 6); o gate usa o 88, que vale para
qualquer janela.

**Travado em teste**: o teste de carga reprova se **qualquer** janela de 1 s do agregado passar de 88 (e exige
< 100); a duração dos ciclos pesados segue ≤ 300 s e ≈ (N − 2) / taxa; um bucket recém-criado de 25 rps entrega no
máximo 2 sem esperar (`rate-limiter.test.ts`). Mutação à mão: voltar `capacity = ratePerSec` derruba 11 casos e o
gate de pico reprova com "expected 156 to be less than or equal to 88"; desfeita.

**O que NÃO muda**: a pendência do limitador **coordenado entre instâncias** segue aberta (buckets de instâncias
diferentes não se coordenam; duas instâncias do mesmo cargo ainda somam o dobro do teto do cargo, e quem evita
isso é o lock anti-overlap). O pico de 88 supõe uma instância por cargo.
