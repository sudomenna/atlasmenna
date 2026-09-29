---
id: ADR-0066
title: Deputado Estadual (7) e Distrital (8) como cargos proporcionais do produto — tabela canônica com abrangência por cargo, caminhos e chaves próprios, cargo explícito sem default, totais fixos 1.035/24/1.059 e um interruptor único das assembleias, separado do federal
status: accepted
date: 2026-09-29
amends: 0044
---

# ADR-0066 — Cargos 7 e 8 como cargos proporcionais do produto

## Status

Aceito (2026-09-29) — decisão do dono, plano aprovado no mesmo dia.

**Emenda o [ADR-0044](0044-codigo-eleicao-por-cargo.md) no ponto em que ele declarava os cargos 7 e 8
"fora do escopo do produto"** (nota adicionada ao `## Status` daquele ADR; o corpo não foi reescrito). O
mecanismo do ADR-0044 vale sem alteração: os dois cargos entram na tabela `CARGOS` com `eleicao:
"estadual"`, o mesmo código de eleição (`21272`) do Governador, do Senador e do Deputado Federal.
**Estende, sem emendar,** o [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) (o algoritmo
de cadeiras) e o [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) (método
da projeção, trava de 25% e o padrão de interruptor em chave do Edge Config) aos dois cargos novos. As
cláusulas "fora de escopo: Deputado Estadual/Distrital" das specs 017, 018 e 026 deixam de valer; specs
estão abaixo de ADR na hierarquia, e quem as emenda é a frente de specs (spec `027-deputado-estadual-distrital`).

É o primeiro de dois ADRs do mesmo plano. O [ADR-0067](0067-orcamento-de-requisicoes-com-as-assembleias.md)
trata do que este ADR consome sem decidir: quantas requisições por segundo o TSE aceita e como os dois
cargos novos cabem nesse orçamento.

## Contexto

**1. É uma mudança de escopo, não uma linha de configuração.** Até 29/09 os cargos 7 (Deputado Estadual)
e 8 (Deputado Distrital) constavam como fora do produto em vários lugares: o Contexto do ADR-0044, o
docstring de `CargoTse` em `lib/config/cargos.ts` ("as assembleias estaduais estão fora do escopo do
produto") e as cláusulas "Fora" das specs 017, 018 e 026. Em 29/09 o dono decidiu cobri-los para a noite
de 04/10: as 26 Assembleias Legislativas (cargo 7, sem o Distrito Federal) e a Câmara Legislativa do
Distrito Federal (cargo 8), reaproveitando o que as specs 017 e 026 construíram para o cargo 6. A
exploração de 29/09, registrada no plano, estabeleceu quatro fatos: os cargos 7 e 8 vivem na **mesma
eleição do TSE** que o federal (21272), com o mesmo leiaute "Proporcional | UF"
(`tests/fixtures/tse/2026-sim/ele-c.json`); **nenhum arquivo `c0007`/`c0008` jamais foi baixado por este
projeto**; o banco não muda (`cargo` é `smallint` sem restrição em `snapshots`, `projections` e
`candidatos`, e `eleitorado` e `zonas` não dependem do cargo); e o cálculo de cadeiras
(`api/model/cadeiras.py`) já serve a qualquer casa, porque o tamanho vem do próprio arquivo do TSE
(`carg[].nv`, RF-124).

**2. Uma cópia ingênua do cargo 6 quebra em cinco lugares**, todos porque o cargo 6 é hoje o único
proporcional e a sua identidade está gravada onde deveria haver uma consulta à tabela:

- **(a) O ramo do modelo.** `_e_proporcional` (`api/model/project.py`) decide o ramo consultando
  `cargo_info` (`api/model/cargos.py`) e devolve `False` para qualquer cargo que não esteja na tabela.
  Um cargo 7 iria para o ramo majoritário — o cálculo de Governador — sem erro nem alerta. É o
  "default silencioso de conversor de cargo" que este repositório já pagou mais de uma vez.
- **(b) O caminho do Blob.** `lib/blob/paths.ts` documenta `deputado/uf/<SIGLA>.json` "sem cargo nem
  turno". Gravar SP estadual sobrescreveria SP federal, e a leitura de qualquer das duas telas mostraria
  a bancada da outra.
- **(c) A gravação.** O schema do corpo em `app/api/internal/edge-write/route.ts` aceita só
  `cargo: z.literal(6)` no payload proporcional; para 7 e 8 a resposta seria 400.
- **(d) "27 UFs" fixo.** `UFS_DA_ELEICAO = 27` (`api/model/project.py`) é o denominador do `% apurado`
  nacional e de `ufs_conhecidas`. O cargo 7 tem 26 UFs; o cargo 8 tem uma. Com o 27 fixo, o `%` nacional
  do cargo 8 nunca passaria de 3,7%.
- **(e) A enumeração de alvos.** `buildProductionTargetsUf` e `buildProductionTargetsZona`
  (`lib/tse/targets.ts`) não filtram UF por cargo. O cargo 8 pediria ao TSE, a cada rodada, os ~6.090
  endereços de par município×zona de outras UFs, que não existem para ele; e requisição a endereço
  incorreto (404) também pode bloquear o IP (`docs/reference/regulatory.md:108`, constituição § 1).

**3. O tamanho das casas é fato constitucional, e o 513 já ensinou o que acontece se ele for derivado do
que chegou.** O número de deputados de cada Assembleia decorre da bancada federal da UF: o triplo dela
e, atingidos 36, mais um por deputado federal acima de 12 (CF art. 27, caput); a Câmara Legislativa do DF
segue a mesma regra (CF art. 32, § 3º). Até 19/09 `deputado_payload._bancada_nacional` somava
`lugares_a_preencher` só das UFs presentes no payload, e com três estados pequenos apurados a tela
escrevia "26 cadeiras em disputa" (ADR-0027, nota de 19/09; comentário de `VAGAS_EM_DISPUTA_2026` em
`api/model/cargos.py`). A lição virou o fato fixo `TOTAL_CADEIRAS[6] = 513`, conferido contra a soma dos
`carg[].nv` quando as UFs publicam. O mesmo problema se repete, em escala maior, com 27 casas
apurando em ritmos diferentes na capa nacional.

**4. A projeção tem o mesmo desenho e uma validação a menos.** O dono escolheu projeção para as
assembleias, como no federal, com o custo de tempo aceito (ADR-0067). Mas a validação do ADR-0063 para o
cargo 6 apoia-se no golden de 2022 (511/513) e nos replays G2/G3, e **não há dado de 2022 por zona das
assembleias no repositório**: para conferir o cálculo e ensaiar a projeção, o dono precisa baixar os dois
conjuntos de 2022 do TSE (`build/tse-archives/`, fora do git; o portal bloqueia robôs). Enquanto não houver
esse dado, a projeção das assembleias não tem a base de confiança que a do federal tem.

## Decisão

**1. Os cargos 7 e 8 entram na tabela canônica** — `lib/config/cargos.ts` e o espelho `api/model/cargos.py`,
mantidos em sincronia por `tests/unit/model/test_cargos_sync.py` — como cargos proporcionais: `proporcional:
true`, `eleicao: "estadual"` (ADR-0044), `vagasPorUf: null`, `temSegundoTurno: false`, `temArquivoBr:
false`. `CargoTse` passa a `1 | 3 | 5 | 6 | 7 | 8`. A tabela ganha o campo obrigatório **`abrangencia`**,
declarado explicitamente em **todas** as entradas, sem valor padrão: o cargo 7 cobre as 26 UFs sem o
DF, o cargo 8 cobre só o DF, e os demais cobrem as 27 (Presidente, Governador, Senador e Deputado
Federal). Dele deriva `ufsDoCargo(cd)`. Todo consumidor que hoje enumera 27 UFs — a enumeração de alvos,
o denominador do `% apurado` nacional, `ufs_conhecidas`, os agregados nacionais, a conferência do total de
cadeiras — passa a ler `ufsDoCargo` e nunca a constante 27. Os valores literais de `abrangencia` são da
implementação; o que este ADR fixa é que o campo é obrigatório, explícito e o único lugar onde "quais UFs
este cargo tem" é dito.

**2. Nomes e caminhos por cargo, com o federal intocado.** A tabela abaixo é a referência; o federal não é
renomeado nem migrado.

| | Federal (inalterado) | Estadual (7) | Distrital (8) |
|---|---|---|---|
| slug / rota | `deputado-federal` | `deputado-estadual` (26 UFs) | `deputado-distrital` (só DF) |
| token (`CargoToken`) | `dep` | `est` | `dis` |
| chave nacional (Edge Config) | `projection-current-dep-t1` | `projection-current-est-t1` | `projection-current-dis-t1` |
| Blob da UF | `deputado/uf/<UF>.json` | `deputado-estadual/uf/<UF>.json` | `deputado-distrital/uf/DF.json` |
| Blob da lista 61+ (ADR-0065) | `deputado/uf-lista/<UF>.json` | `deputado-estadual/uf-lista/<UF>.json` | não há (ver Pontos em aberto) |
| interruptor da projeção | `interruptor-projecao-dep` | `interruptor-projecao-est` | o mesmo do estadual |
| total fixo de cadeiras | 513 | 1.035 | 24 |

O slug identifica um cargo de forma **biunívoca**: `parseCargoSegment` (slug ou código → `cd`) continua uma
função de um argumento. `/uf/DF/deputado-estadual` redireciona o leitor para `/uf/DF/deputado-distrital`;
isso é navegação, não resolução de cargo — nenhum código resolve "estadual" para 7 ou 8 conforme a UF.

**3. Cargo explícito em toda função de caminho e de leitura, sem default.** As funções de `lib/blob/paths.ts`,
o leitor de `lib/edge-config/reader.ts` e o construtor de chaves recebem o cargo como parâmetro
obrigatório; nenhuma tem um "cargo padrão" que sirva o federal quando o argumento falta. O tipo
`CargoMajoritario` passa a ser derivado de `proporcional` na tabela, não escrito à mão. A tabela passando
a conhecer 7 e 8 fecha o caso (a), mas não basta: `_e_proporcional` não pode continuar tratando "cargo fora
da tabela" como "majoritário". Cargo desconhecido deve falhar alto. A forma é da implementação; o teste
exigido é "cargo fora da tabela não chega ao ramo majoritário".

**4. Totais fixos de cadeiras: 1.035 (cargo 7), 24 (cargo 8), 1.059 no conjunto.** `TOTAL_CADEIRAS` e
`VAGAS_EM_DISPUTA_2026` (`api/model/cargos.py`) ganham `7: 1035` e `8: 24` — as Assembleias e a Câmara
Legislativa renovam-se por inteiro, então os dois dicionários coincidem, como no cargo 6. A conta, pela
regra da CF art. 27 acima (bancada federal `B` → casa `3B` se `B ≤ 12`, senão `36 + (B − 12)`):

- `B ≤ 12`: PB (12 → 36); ES e PI (10 → 30 cada); AL (9 → 27); AC, AM, AP, MS, MT, RN, RO, RR, SE e TO
  (8 → 24 cada). Subtotal das 14 UFs: 36 + 60 + 27 + 240 = 363.
- `B > 12`: SP (70 → 94); MG (53 → 77); RJ (46 → 70); BA (39 → 63); RS (31 → 55); PR (30 → 54);
  PE (25 → 49); CE (22 → 46); MA (18 → 42); GO e PA (17 → 41 cada); SC (16 → 40). Subtotal das 12 UFs: 672.
- **Cargo 7 = 363 + 672 = 1.035.** DF: 8 → 24 (cargo 8). **Conjunto = 1.059.**

A tabela de bancadas usada na derivação é a mesma que soma 513 (26 UFs = 505, mais os 8 do DF), o valor
já fixado em `TOTAL_CADEIRAS[6]` — esse fecho é a verificação cruzada da derivação. **O número por UF em
produção continua saindo de `carg[].nv`, nunca desta tabela** (RF-124; ADR-0027, Decisão): a tabela acima
é conferência e dado de teste do modo simulado. A conferência é a do 513, generalizada por cargo
(`deputado_payload.conferir_total_de_cadeiras`): quando todas as UFs **do cargo** (26 para o 7, uma para o
8) publicaram `nv`, a soma tem de bater com o total fixo; se não bater, o ciclo registra `error` e alerta,
sem alterar o cálculo. Na capa nacional, o "aguardando" é `1.059 − distribuídas`, nunca a soma das UFs
presentes.

**5. Um interruptor único para as assembleias, separado do federal.** A chave do Global Config
`interruptor-projecao-est` vale para os cargos 7 **e** 8, com o mesmo formato e a mesma semântica do
[ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) Decisão 4: `{ ligada,
pct_minimo?, em?, por? }`; dois pontos de leitura (o modelo a cada ciclo, a página a cada renderização);
**falha fechada** — só `ligada === true` liga; erro de leitura, valor inválido e chave ausente desligam;
`pct_minimo` só sobe; `em` e `por` nunca são publicados. É independente de `interruptor-projecao-dep`:
ligar ou desligar um não toca o outro. `scripts/interruptor-projecao.ts` ganha `--cargo estadual`, com as
mesmas travas de store (id confirmado, store de ensaio recusado por omissão, `--ensaio` explícito).

**6. A projeção das assembleias usa o mesmo método e a mesma trava da 026, e sobe desligada.** O método é o
do ADR-0063 (extrapolação por zona com pós-estratificação, imputação do estado inteiro, arredondamento
inteiro determinístico) e a trava é a dele (`% apurado` ponderado pelo eleitorado ≥ 25, ao menos 2 zonas
apuradas, `nv` publicado, sem coligação, interruptor ligado), executados pelo código genérico
`api/model/deputado_projecao.py`; a entrada já vem filtrada pelo destino do voto
([ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md)). **A diferença para o federal é o
estado inicial.** O ADR-0063 fixa que o federal nasce ligado porque o roteiro da virada grava
`{ ligada: true }`. Para as assembleias, o roteiro de 03/10 **não** grava `interruptor-projecao-est`; a
chave ausente vale desligada, e quem liga é o dono, depois de ver o ensaio e o resultado do G2 das
assembleias. O G2 depende de o dono baixar os dados de 2022; sem eles, a projeção das assembleias fica
desligada em 04/10 — o resto (parcial, listas, marcas, regras, Conferência) sobe do mesmo jeito. A meta de
validação é a do federal: golden 2022 por cargo (`scripts/build-cadeiras-golden.py`, hoje com `CARGO =
"6"` e o 513 fixos, a parametrizar), 511/513 no federal como régua, exceções explicadas; G1 e G2 pelo
`model-validator`.

**7. O algoritmo de cadeiras é o do ADR-0027, sem alteração.** A base legal que aquele ADR cita (Código
Eleitoral arts. 106–112; Res.-TSE 23.677/2021 com as redações de 23.734/2024 e 23.748/2026; ADIs
7228/7263/7325) é a das eleições proporcionais em geral; ver Pontos em aberto sobre a conferência.

## Alternativas consideradas

- **Slug único `deputado-estadual`, com o cargo resolvido pela UF (DF → 8, demais → 7).** Rejeitada:
  transformaria a relação slug → cargo, hoje de um argumento e biunívoca (`parseCargoSegment`,
  `/api/ingest/[cargo]`), numa função de dois argumentos. As rotas de ingestão não têm UF; a tabela é
  chaveada por código de cargo. Um resolvedor que decide o cargo por outro parâmetro é exatamente a
  família de default silencioso que o projeto já sofreu. O redirecionamento `/uf/DF/deputado-estadual`
  → distrital resolve a intenção do leitor sem isso.
- **Um interruptor único para os cargos 6, 7 e 8.** Rejeitada: as validações não são as mesmas. A do
  federal tem golden de 2022 e G2 com dado; a das assembleias não tem dado de 2022 no repositório.
  Acoplar os interruptores forçaria a escolha entre desligar a projeção do federal (validada) para
  cortar a das assembleias (não validada), ou manter esta ligada para não perder aquela.
- **Derivar os totais das UFs presentes no payload.** Rejeitada: é o defeito de 19/09 (`_bancada_nacional`
  somando só as UFs presentes: "26 cadeiras em disputa" com três estados apurados). O "aguardando" da
  capa deixaria de significar "ainda não distribuído".
- **Reaproveitar `deputado/uf/<UF>.json` com sufixo de cargo** (por exemplo `deputado/uf/SP-est.json`).
  Rejeitada: a rota da lista do ADR-0065 valida `sigla` contra as 27 UFs e devolve 404 fora delas;
  um sufixo obrigaria a afrouxar essa validação para aceitar texto arbitrário. Prefixos separados por
  cargo também deixam o teste "o prefixo é função do cargo" possível de escrever.
- **Modelar o Distrital como Estadual com `UF = DF`.** Rejeitada: o TSE publica o cargo 8 como cargo
  próprio, com arquivo próprio (`df-c0008-e021272-u.json`), e a casa é outra (Câmara Legislativa, não
  Assembleia). Fundi-los exigiria uma tabela de tradução no lugar da tabela de cargos.

## Consequências

**Positivas**:
- Cada uma das cinco quebras do Contexto 2 tem uma guarda com teste que precisa morrer na mutação
  (aplicada à mão): (a) cargo 7 cai no ramo proporcional e cargo desconhecido não chega ao majoritário;
  (b) gravar SP estadual não altera `deputado/uf/SP.json`; (c) a gravação aceita os cargos proporcionais
  da tabela e recusa os demais, sem literal; (d) o `% apurado` nacional divide por `len(ufsDoCargo)`,
  testado com o 7 (26) e o 8 (1); (e) os alvos do cargo 8 são só do DF e os do cargo 7 nunca o incluem.
- O federal fica **bit-idêntico**: nenhum caminho, chave ou interruptor dele muda, então não há migração
  na semana da eleição, e o replay presidencial (MAE@1h de PT em 2,3623 pp, cobertura de 82,5%) continua
  sendo o sinal de que o caminho compartilhado não foi contaminado.
- O total fixo protege o "aguardando" da capa nacional contra casas parciais e vira alarme de dado errado
  do TSE (soma dos `nv` diferente de 1.035/24). **Emenda de 29/09 (orquestrador, antes do merge):** com
  TODAS as UFs do cargo presentes, o total publicado passa a ser a soma dos `nv` — o dado do TSE rege a
  distribuição (RF-124) — e a divergência continua alarmando. Sem isso, o simulado de 29/09 (DF cargo 8
  com `nv = 28`) daria "aguardando = −4". Com UF faltando, vale o fixo (spec 027 RF-280).
- A projeção das assembleias pode ser cortada, ou nunca ligada, sem tocar a do federal.

**Negativas**:
- **A assimetria de nomes é permanente.** O federal mantém os nomes sem marca de cargo (`deputado/uf/`,
  `dep`, `interruptor-projecao-dep`); os cargos 7 e 8 carregam o cargo no caminho. A regra "sem cargo no
  caminho significa federal" é um acidente histórico que o código novo não pode generalizar, e
  `lib/blob/paths.ts` fica com um caso especial que só desaparece com uma migração que ninguém fará
  na semana da eleição.
- **Mais peças no ar na noite.** Duas chaves nacionais novas no Edge Config, até 27 objetos de Blob por
  cargo e as listas do 7. O espaço do Edge Config (+2 chaves nacionais) **não foi medido** (o aviso do
  projeto é em 780 KB), e o Blob de SP estadual tende a ser o mais pesado do produto: pela regra de registro (100% das vagas
  mais uma, ainda não conferida — ressalva do ADR-0065), até 95 candidaturas por agremiação, contra 71 em
  SP federal. O corpo da gravação pode passar de 3,5 MB; o plano prevê medir
  nos portões, um teto de peso próprio para `/uf/SP/deputado-estadual` e, se necessário, gravar em lotes.
  Nada disso foi medido ainda.
- **A tabela de 1.035/24 deriva da bancada federal por UF (LC 78/1993), que o ADR-0027 nunca verificou
  contra fonte primária**, e o texto da CF art. 27 e do art. 32, § 3º está aqui citado sem ter sido relido
  em planalto.gov.br nesta sessão. O fecho em 513 é evidência forte, não prova. O que protege de verdade
  é a conferência contra `carg[].nv`.
- **O interruptor único acopla 7 e 8.** O DF (24 cadeiras, 19 zonas) tem dinâmica bem diferente de SP
  (94 cadeiras), e uma projeção problemática numa Assembleia desliga também a do Distrito Federal.
  Aceito porque separar os dois cria mais uma chave para a mão do operador na noite.
- **A escala do risco de "cadeira projetada errada com o nome de uma pessoa ao lado"** (ADR-0063,
  Consequências) cresce para 1.059 cadeiras em 27 casas, cada uma com listas de até 95 nomes. O
  risco de voto de reduto a 25% apurado não é eliminado por este método. A postura "sobe desligada" é a
  única defensável sem G2, e mesmo ligada a projeção continua sendo "projeção · não oficial".
- **Débito documental.** As cláusulas "Fora" das specs 017, 018 e 026, o docstring de `CargoTse` e o
  Contexto do ADR-0044 continuam dizendo que os cargos 7 e 8 estão fora do escopo até serem emendados
  (a nota do ADR-0044 já foi aplicada). Os nomes de chaves e caminhos de `docs/architecture/data-model.md`
  precisam ganhar as linhas dos cargos 7 e 8.
- **Nenhum arquivo `c0007`/`c0008` foi jamais lido.** O padrão do endereço vem do documento do TSE e do
  `ele-c.json` do simulado, não de um arquivo real de cargo 7 ou 8. O Passo 0 do plano (baixar à mão três
  ou quatro arquivos enquanto o simulado estiver no ar) reduz o risco; se o simulado estiver fora do ar, o
  primeiro contato acontece em 04/10 (ADR-0067, Consequências).

## Pontos em aberto

- **Base legal das casas estaduais e distrital.** Que a regra do Código Eleitoral, da Res.-TSE 23.677/2021
  (inclusive o art. 12-A) e das ADIs 7228/7263/7325 é a mesma para as proporcionais estaduais e para a
  distrital é premissa do plano. O ADR-0027 a verificou para o Deputado Federal. Conferir no texto antes
  de a spec 027 ir a `shipped`.
- **Conferência do art. 27 da CF** (e do art. 32, § 3º) contra planalto.gov.br, como o ADR-0027 fez para os
  artigos do Código Eleitoral.
- **Distrital sem lista 61+.** A premissa do plano é que nenhuma agremiação registra mais de 60
  candidaturas ao cargo 8 (a regra de registro é 100% das vagas mais uma; para 24 vagas, 25). Mesma
  ressalva do ADR-0065: a conta está "não conferida"; contar em `candidatos` antes de decidir que a rota
  do cargo 8 não precisa de `uf-lista`.
- **Soma nacional na capa.** O plano prevê "soma por partido no Brasil (1.059 cadeiras)", com o aviso de
  que é a soma de 27 casas separadas, sem desenho de plenário. Este ADR só afirma o total fixo. Se essa
  soma incluir cadeiras **projetadas**, colide com o ADR-0063 Decisão 1 ("não há bancada nacional
  projetada"), e isso exigiria decisão nova. Enquanto ninguém decidir, a soma nacional é a da contagem
  parcial.
- **Tamanho real de cada casa.** A confirmação de que `carg[].nv` de cada UF bate com a conta acima é o
  que o Passo 0 (ou o primeiro ciclo de 04/10) mostra.

## Cross-refs

- [ADR-0001](0001-edge-config-no-read-path.md), [ADR-0012](0012-edge-config-chaves-nomeadas.md) — Edge Config no
  read path e a convenção de chaves (`lib/edge-config/keys.ts` valida contra `^[A-Za-z0-9_-]+$`).
- [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — o Blob como read path do drill-down de
  UF, agora um por cargo.
- [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) — algoritmo de cadeiras, sem alteração;
  `lugaresAPreencher` do dado do TSE; a nota de 19/09 sobre o total nacional.
- [ADR-0044](0044-codigo-eleicao-por-cargo.md) — emendado por este ADR; `eleicao` obrigatória por cargo.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — método, trava e padrão de
  interruptor, estendidos; [ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md) — entrada
  filtrada pelo `dvt`; [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) — listas em três faixas e a
  validação de `sigla` contra as UFs.
- [ADR-0067](0067-orcamento-de-requisicoes-com-as-assembleias.md) — orçamento de requisições, cadência e
  granularidade por fase.
- Spec 017 (`docs/specs/017-deputado-federal/`; RF-124 e RF-129), spec 018 e spec 026
  (`docs/specs/026-deputado-listas-projecao/`) — cláusulas "Fora" a emendar; spec
  `027-deputado-estadual-distrital` — implementa este ADR. Spec 011 (`sobre-o-modelo`) — parágrafo das
  assembleias, sem `<h2>` novo.
- Constituição § 1 (404 e teto de requisições), § 3 (banco fora do read path), § 6 (determinismo),
  § 7 (falha degradada), § 8 (transparência), § 9 (Edge Config), § 10 (snapshots append-only):
  [../../constitution.md](../../constitution.md).
- Código: `lib/config/cargos.ts`, `api/model/cargos.py` (`TOTAL_CADEIRAS`, `VAGAS_EM_DISPUTA_2026`),
  `api/model/project.py` (`_e_proporcional`, `UFS_DA_ELEICAO`), `lib/blob/paths.ts`,
  `app/api/internal/edge-write/route.ts`, `lib/tse/targets.ts`, `lib/edge-config/keys.ts`,
  `scripts/interruptor-projecao.ts`, `scripts/build-cadeiras-golden.py`.
