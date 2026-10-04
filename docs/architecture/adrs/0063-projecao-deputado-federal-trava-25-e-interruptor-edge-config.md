---
id: ADR-0063
title: Projeção de votos e de cadeiras de Deputado Federal — extrapolação do estado inteiro por zona, com trava de 25% apurado e interruptor em chave do Edge Config; supera o D9 do design da spec 017
status: accepted
date: 2026-09-29
amends: [0021, 0023]
---

# ADR-0063 — Projeção de Deputado Federal: trava de 25% e interruptor no Edge Config

## Status

Aceito (2026-09-29) — plano aprovado pelo dono.

> **Emenda 2026-10-04 (decisão do dono, manhã do 1º turno — voto projetado por candidatura, só
> Deputado Federal).** A Decisão 1 listava "votos projetados por candidatura (chave `sqcand`)" entre o
> que a projeção produz, mas o contrato publicado levava por linha só a marca "eleito na projeção" (e
> `votos_projetados` por agremiação): o número de cada candidato ficava no modelo e nunca chegava à tela.
> Passa a ser publicado e exibido, com as ressalvas abaixo. A Decisão 5 (nunca ordena, nunca substitui o
> apurado) permanece. Texto no fim deste arquivo (§ "Emenda 2026-10-04 — Decisão").

> **Emenda 2026-10-04 (2) (decisão do dono, dia do 1º turno — bancada nacional projetada como cenário
> misto rotulado, só Deputado Federal).** A última frase da Decisão 1 ("Não há bancada nacional
> projetada…") é **revogada em parte**: a capa `/deputado-federal` passa a mostrar, com o seletor do topo em
> "Projeção", o cenário projetado nacional de cada agremiação — UF com projeção liberada conta a projeção,
> UF travada conta a parcial, e o número sempre diz isso no rótulo — e a lista nacional dos candidatos
> eleitos de cada agremiação. Tudo montado na leitura, a partir dos objetos por UF do Blob: o payload do
> Edge Config e o modelo não mudam. As Decisões 3, 4 e 5 permanecem; a 4 ganha uma extensão (dois pontos de
> leitura do interruptor também na rota nova) e a 5 é explicitada para o cenário. Texto no fim deste
> arquivo (§ "Emenda 2026-10-04 (2) — Decisão").

**Supera o D9 do design da spec 017** ("o número central é voto apurado, não voto projetado; no cargo 6
não existe projeção de voto; a tela não pode chamar isso de projeção") **e a redação do D10**
(`composition.model = 0`, justificado por "decorre de D9"), e **emenda o RF-127** (o intervalo de
cadeiras vale também para a projeção, quando ela existe). **Estende, sem superseder, o
[ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) e o
[ADR-0023](0023-pos-estratificacao-por-porte-de-zona.md)** ao cargo 6, e **não toca o
[ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md)**: o algoritmo de cadeiras é o mesmo
— muda só de onde vêm os votos que ele recebe. D9 e D10 vivem num `design.md`, abaixo de ADR na
hierarquia; quem emenda a spec 017 é a frente de specs (spec `026-deputado-listas-projecao` e a
emenda da 017), não este ADR.

É o primeiro de três ADRs do mesmo plano. Os outros dois tratam de coisas que este ADR consome sem
decidir: o [ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md) fixa quais votos
entram na conta (a entrada da projeção já vem filtrada por ele) e o
[ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) fixa como as listas de candidaturas são
mostradas.

## Contexto

**1. O D9 tinha uma razão, e a razão foi removida.** O design da spec 017 (§ D9, escrito em 12/09)
diz que as cadeiras que saem do cargo 6 são "a aritmética do ADR-0027 sobre o que já foi contado —
como ficaria a bancada se a apuração parasse agora", e proíbe a tela de chamá-las de projeção,
porque o cargo 6 tinha **uma única unidade geográfica por UF** e portanto nenhuma unidade de
reamostragem nem de extrapolação. O próprio design registra que o obstáculo caiu em 13/09:
o [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) moveu o cargo para par
município×zona (2.644 zonas distintas, média de 97,9 por UF, volta completa a cada 30 min), e
acrescenta que "construir o bootstrap por agremiação sobre essas unidades é trabalho de modelagem,
não de orçamento de CPU". O bootstrap do RF-127 foi construído em 13/09; a projeção de voto, não — e
o D9 ficou de pé depois de perder o motivo, sem argumento novo.

**2. Só contar não responde à pergunta da noite.** "Cadeiras na parcial" responde a "e se a contagem
parasse agora". Não responde a "como fica a bancada" — e o risco é o mesmo que o
[ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) nomeou como central para o cargo majoritário: as
primeiras zonas a apurar não são uma amostra do estado. A marcação `indefinida` do RF-127 é, nas
palavras do design, "o único campo do payload que carrega o 'ainda vem voto'", e o IC95 de
`api/model/cadeiras_bootstrap.py` "mede a variância do recorte já apurado e não sabe nada do voto que
ainda falta contar". Em 29/09 o dono decidiu construir a projeção agora, com quatro condições: **(i)**
projetar o **estado inteiro** zona a zona — a zona sem boletim recebe voto imputado a partir das
apuradas parecidas, estratificadas por tamanho; **(ii)** só liberar a partir de **25% apurado** no
estado; **(iii)** poder **desligar sem deploy**; **(iv)** rotular sempre como não oficial. A janela é
curta: corte de código em 02/10 às 18h, virada em 03/10, eleição em 04/10 com deploy congelado das
16h às 05h.

**3. Variável de ambiente não é interruptor de runtime na Vercel.** O plano de 29/09 registra como
fato verificado que, na Vercel, uma variável de ambiente só chega a um **deployment novo**; mudar o
valor não altera o que já está no ar. Dois textos do repositório afirmam o contrário para
`TSE_DEPUTADO_GRANULARIDADE`: `docs/operations/runbook.md:870` ("Interruptor de emergência […] sem
deploy") e `vercel.ts:184` ("Interruptor de emergência sem deploy"). Ambos estão errados: o
interruptor existe, mas exige redeploy — e a noite de 04/10 é justamente a janela em que redeploy
não existe. O único mecanismo do projeto que muda estado em produção sem deploy é uma chave do
Global Config do Edge Config, que já é o substrato do read path ([ADR-0001](0001-edge-config-no-read-path.md))
e tem convenção de chaves nomeadas ([ADR-0012](0012-edge-config-chaves-nomeadas.md)).

**4. O que não se tem: validação contra a noite real.** Não há dado de 2022 por zona no repositório
(`build/` só tem 2026; `historical_results` só carrega os cargos 1 e 3) e nunca houve a **ordem de
chegada dos boletins de 2022** para deputado — o ADR-0023 já registrou a mesma limitação para o
cargo majoritário, e mediu que a estratificação por porte melhorou o ponto em ~20% sem mover a
cobertura do IC (78,8% → 79,5%): a incerteza residual está *dentro* dos estratos. O piso de 25% é
escolha do dono, não conclusão de um replay. O risco que isso cria tem nome, **voto de reduto**:
um candidato forte em um grupo de zonas que apura primeiro aparece superrepresentado entre as
zonas apuradas do seu estrato de tamanho, e a imputação estende o excesso às zonas do mesmo estrato
que ainda não reportaram.

## Decisão

**1. A projeção de Deputado Federal passa a existir**, por UF: votos projetados por candidatura
(chave `sqcand`) e por legenda (chave `legenda:<cod>`), cadeiras projetadas por agremiação e
eleitos projetados por candidatura. O princípio é o dos ADR-0021/0023 — **extrapolação do apurado
por zona, sem 2022 como insumo** —, aplicado à corrida proporcional. O D9 deixa de valer. Do D10
fica só o que não dependia do D9: `insights = []` (os templates do
[ADR-0005](0005-templates-nao-llm.md) para corrida proporcional continuam inexistentes e este ADR
não os cria). O valor de `composition` sob projeção liberada é definido no design da spec 026, com
uma restrição que este ADR fixa: nunca declarar `model: 0` sobre um número que o modelo produziu.
Não há bancada nacional projetada: o contrato leva a projeção **por UF**, e a capa nacional mostra
só o selo de estado da projeção de cada UF.

> **Emenda 2026-10-04 (2).** A frase acima ("Não há bancada nacional projetada…") foi **revogada em
> parte** pelo dono: a capa passa a mostrar um cenário nacional misto, sempre rotulado, montado na leitura
> a partir dos objetos por UF — ver § "Emenda 2026-10-04 (2) — Decisão". O contrato continua levando a
> projeção **por UF**, e nada do payload nem do modelo muda. O texto original fica como foi decidido em
> 29/09.

**2. Método.** Todas as etapas em aritmética exata; nada de `float` decidindo cadeira.

- **Unidade e critério.** A unidade é a zona (os pares município×zona somados em memória por
  `zona_merge`, [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md)). Zona **apurada** =
  `esi > 0 ∧ vv > 0`.
- **Escala.** `k = te/esi` por zona apurada; a contagem observada de cada chave é multiplicada por
  `k` (a mesma regra de três do ADR-0021).
- **Razão das somas por chave**, nunca média de percentuais: uma razão por `sqcand` e por
  `legenda:<cod>`.
- **Pós-estratificação por tercis de `te`** (ADR-0023) para UF com **12 ou mais zonas**; abaixo
  disso, estrato único — o ADR-0023 registrou que isso deixa de fora RR, AC, AP e ZT.
- **Imputação do estado inteiro** (decisão do dono). Cada zona **sem boletim** recebe, por chave,
  o eleitorado da zona vezes a intensidade de voto por eleitor apto das zonas apuradas do **mesmo
  estrato**; estrato sem nenhuma zona apurada cai para a intensidade da UF inteira — a mesma
  hierarquia de fallback do ADR-0023. A forma exata da fórmula é a do design da spec 026.
- **Arredondamento inteiro determinístico**, em `Fraction`, com regra de desempate fixa e ordem de
  chaves fixa (constituição § 6). Nunca `round()` de float.
- **Distribuição de cadeiras** pela função existente (`api/model/cadeiras.py::distribuir_cadeiras`,
  ADR-0027), **sem alteração** — o algoritmo passou nos 511/513 do golden de 2022 e não se mexe
  nele para acrescentar instrumentação. A entrada da projeção é a mesma já filtrada pelo
  [ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md): candidatura cujo destino não
  é `Válido` não é chave `sqcand` da projeção; seus votos entram na chave de legenda
  (`Válido (legenda)`) ou em lugar nenhum (anulada, sub judice), inclusive na intensidade imputada.

**3. Trava, por UF, todas as condições juntas.** A projeção só é `liberada` quando:
`% apurado` da UF **≥ 25** **e** há **pelo menos 2 zonas apuradas** (o mesmo mínimo com que o
bootstrap do RF-127 já omite o intervalo: menos de 2 zonas com voto) **e** `nv` (vagas da UF) foi
publicado — sem ele não existe quociente eleitoral (RF-124; o design 017 § D9.1 nunca confirmou `nv`
a 0% apurado) **e** o dado da UF não traz coligação (ADR-0027, caso de borda 7: coligação em
proporcional é anomalia, a UF já sai "aguardando") **e** o interruptor está ligado. O requisito de
95% de cobertura de zonas, cogitado no rascunho do plano, **saiu**: o dono optou por imputar o
estado inteiro, e a trava é só a de 25%.

O **`% apurado` da UF passa a ser ponderado pelo eleitorado**. Hoje `api/model/project.py:7924`
toma o **maior** `pct_apurado` entre as linhas da UF (`max(...)`): uma única zona a 90% faz o estado
inteiro valer 90%. Para a trava isso é abrir no primeiro boletim adiantado; para o RF-127, desligar
a marcação `indefinida` antes da hora. O princípio fixado aqui: média dos `pct_apurado` **ponderada
pelo eleitorado**, com denominador o eleitorado **conhecido de toda a UF**, de modo que a zona ainda
sem boletim conte como **zero** e não como ausente (sem isso, uma zona só reportando continuaria
valendo o estado inteiro). A fórmula exata é a do RF-275 da spec 026. A correção (frente P1) entra
**antes** da projeção (P2) e vale também para a marcação do RF-127; é registrada aqui porque
define o que os 25% significam.

O estado publicado por UF é `liberada | aguardando | indisponivel`, sempre com `motivo` em texto.
Lido como: `aguardando` = condição que a apuração resolve sozinha (abaixo de 25%, menos de 2 zonas,
`nv` ainda ausente); `indisponivel` = condição que mais apuração não resolve (interruptor desligado,
leitura do interruptor falhou, coligação no dado). A tela **nunca** mostra número de projeção fora de
`liberada` e sempre diz por quê.

**4. O interruptor é uma chave do Global Config, não uma variável de ambiente.**

- **Chave** `interruptor-projecao-dep` (construída por `lib/edge-config/keys.ts`, que valida contra
  `^[A-Za-z0-9_-]+$`, ADR-0012), valor `{ ligada: boolean, pct_minimo?: number, em?: string,
  por?: string }`.
- **Dois pontos de leitura, de propósito.** O **modelo** lê a chave a cada ciclo, antes de calcular;
  desligada, não calcula a projeção e o payload sai sem nenhum campo de projeção. A **página** lê a
  chave a cada renderização (`readInterruptorProjecao`) e, desligada, **ignora** qualquer campo de
  projeção que o payload já traga; a capa nacional faz o mesmo com o selo por UF. Só o ponto do
  modelo deixaria a projeção publicada no ar até a próxima volta do cargo (30 min); o ponto da
  página limita o "some" ao tempo de regeneração da página (`revalidate = 60`). O alvo é
  **desligar → sumir em até 60 s**, e ainda **não foi medido** — o ensaio de 03/10 mede.
- **Falha fechada.** Lida com sucesso, só `ligada === true` liga. Erro de leitura, tempo esgotado,
  valor que não é objeto, `ligada` que não é booleano, **e chave ausente**, desligam — com motivo
  distinto para "desligada pela operação" e "não foi possível ler o interruptor", e log em `error`
  no segundo caso. O leitor do projeto já distingue chave ausente de leitura falhada
  (`LeituraEdge`, `readProjectionResult` em `lib/edge-config/reader.ts`); o teste exige que as duas
  saiam desligadas.
- **"Começa ligada" é um passo do roteiro, não um default de código.** O dono escolheu só a trava
  de 25%, então o estado pretendido na noite é ligado; ele é obtido gravando
  `{ ligada: true, em, por }` na virada (roteiro de 03/10). Sem essa gravação a projeção fica
  desligada e a tela diz que está.
- **`pct_minimo` só sobe.** Valor entre 25 e 100 substitui o mínimo da trava; valor menor que 25
  ou inválido é **ignorado, com log**: o piso de 25% é decisão do dono e só muda por ADR. É o
  botão que o dono pode usar sem deploy se o replay G2 mostrar que 25% é cedo demais.
- **`em` e `por` são de auditoria** (log e operador). **Nunca** entram no payload nem no Blob, que
  são públicos.
- **`pnpm dep:projecao`** (`scripts/interruptor-projecao.ts`) mostra o estado atual, mostra o id e
  o nome do store que vai ler ou escrever, exige que o operador confirme o id e **recusa por
  omissão o store de ensaio** (`salacofre-edge-config-preview`). O risco é concreto: em 27/09 o
  `.env.local` desta máquina aponta para o store de ensaio, não para o que o site público lê
  (`salacofre-edge-config`, `docs/operations/vespera-03-10.md` § 0.5). Um "desligar" gravado no
  store errado deixaria a produção ligada com a sensação de estar desligada. O ensaio do
  interruptor previsto para 03/10 acontece no store de ensaio **de propósito**, então ele exige
  pedir o ensaio de forma explícita; nunca é o padrão.
- **Regra geral registrada.** Nenhum interruptor que precise agir sem deploy é variável de
  ambiente; vive numa chave do Edge Config. As variáveis existentes continuam válidas como
  configuração **de deploy**, e os dois textos citados no Contexto (3) passam a dizer "exige novo
  deploy — indisponível de 16h a 05h em 04/10". A correção dos textos é da frente T do plano; este
  ADR só a exige.

**5. Rotulagem e ordem.**

- **A projeção é sempre "projeção · não oficial"** (constituição § 1, art. 267 § 4º), nunca é
  confundível com o dado do TSE, e a página traz o bloco "o que está movendo o forecast" (§ 8) e a
  metodologia em `/sobre-o-modelo` (spec 011, sem `<h2>` novo).
- **Nunca "eleito" sozinho.** Os únicos rótulos são "eleito na parcial", "eleito na projeção · não
  oficial" e "Eleito (TSE)"; este último, quando existe, tem precedência sobre os dois. Cor nunca é
  o único sinal (§ 4).
- **A projeção nunca ordena nada.** A ordem das listas segue o voto apurado. O § 2 só admite ordem
  que acompanha a base quando há controle explícito, visível e reversível do leitor
  ([ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md)); a tela de Deputado
  não tem esse controle, então a base fixa é a apurada, e a marca de projeção é um selo sobre a
  linha, não um critério de posição.
- **O número da projeção nunca substitui o da parcial**: os dois convivem na tela, cada um com o
  seu nome.

**6. Determinismo (§ 6): sem linhas novas em `projections`.** A projeção é reproduzível dos snapshots
(append-only, § 10) mais o código versionado, e **não** grava linha em `projections`. Isso segue um
precedente já decidido: o dono tirou o cargo 6 da série persistida em 17/09
(`api/model/project.py:2025-2040`, `CARGOS_COM_SERIE_PERSISTIDA = {1, 3, 5}` — 7.791 candidaturas
× ~480 ciclos seriam ~3,7 milhões de linhas). Há uma segunda razão, técnica e independente:
`projections.candidato_id` é `integer` (int4, `lib/db/schema.ts:236`, máximo 2.147.483.647) e não
comporta o `sqcand`, que tem 11–12 dígitos; gravar exigiria migration, e migrações deste projeto são
manuais, numeradas e estacionadas na semana da eleição (ver o adiamento da 0011 no
[ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md)). É uma **exceção assumida** ao
terceiro item do § 6 ("toda execução do modelo é persistida em `projections`"), que já existia para
o cargo 6 e que este ADR não reinterpreta; se o dono quiser fechá-la, o caminho é emenda da
constituição.

**7. Validação, limites e degradação pré-acordada.**

- **G1 — identidades.** A 100% apurado, projeção == parcial cadeira a cadeira; com a mesma fração
  apurada em todas as zonas, projeção == parcial.
- **G2 — replay sintético.** Totais do golden de 2022 espalhados pelas zonas de 2026, com 3 níveis
  de concentração regional × 3 ordens de chegada × 20 sementes, pontos de 25% a 90%. Métrica:
  cadeiras e eleitos trocados, projeção contra parcial. O resultado a 25% é **reportado ao dono e
  não sobe a trava sozinho**: nenhum limiar do código depende de G2.
- **G3 — geografia real de 2022**, só se o dono baixar os dois conjuntos de dados abertos do TSE
  (`votacao_candidato_munzona_2022` e `votacao_partido_munzona_2022`, em `build/tse-archives/`,
  fora do git). Mesmo com ele, o replay testa a **geografia**, não o **ritmo** da noite: a ordem
  real de chegada dos boletins de 2022 não existe.
- **G4 — simulado.** `SELECT` só de leitura sobre os snapshots de cargo 6: quando a trava abre,
  tempo do ciclo, comportamento da Conferência.
- **G5 — replay presidencial inalterado**: MAE@1h de PT 2,3623 pp e cobertura de 82,5%. Se mudar sem
  o modelo presidencial ter mudado, a projeção de deputado contaminou o caminho compartilhado.
- **Degradação pré-acordada:** se a validação falhar feio, a projeção **sobe desligada** e o resto
  (listas, parcial, regras, Conferência) sobe normalmente. O interruptor existe para isso.

**8. RF-127 vale para a projeção.** Quando a projeção está liberada, o número de **cadeiras
projetadas** de cada agremiação sai acompanhado do intervalo (`cadeiras_projetadas_ci95`) e das
cadeiras marcadas como apertadas, reaproveitando a definição de `_marcar_indefinidas`
(`api/model/deputado_payload.py:249`). O número central sozinho nunca é publicado. O intervalo da
parcial, que já existe, não é retirado.

> **Emenda 2026-09-29 (implementação) — faixa da projeção ADIADA; decisão do dono pendente.** O
> bootstrap de `cadeiras_projetadas_ci95` (tasks 026, P2.5) custou ~10,5 s nas 27 UFs, o mesmo do
> bootstrap da parcial; os dois juntos (~21 s locais) deixariam o ciclo de Deputado perto do
> `maxDuration` de 60 s da função do modelo. O orquestrador adiou o campo para depois de 04/10 — ele
> é opcional no contrato (design 026 § 2.3) e sai **ausente**. Enquanto isso, a regra "número central
> nunca sozinho" é cumprida **pelo rótulo**, não pela faixa: na tela da UF o número projetado sai como
> "N cadeiras · projeção pontual · não oficial", e a faixa que já existia ao lado de cada bancada — a
> da **parcial** — passou a levar o nome **visível** "faixa da parcial" (antes o nome era só para
> leitor de tela, e um "12 a 15 cadeiras" ao lado de "13 cadeiras na projeção" se lia como a faixa da
> projeção). A faixa da parcial **nunca** é apresentada como se fosse a da projeção. Isso é um desvio
> assumido do texto desta decisão; **o dono decide depois** entre (a) aceitar o rótulo "pontual" como
> cumprimento suficiente até o 2º turno, (b) exigir a faixa (voltando ao orçamento de tempo do ciclo)
> ou (c) esconder o número projetado de cadeiras enquanto não houver faixa. Código:
> `app/(dep)/uf/[sigla]/deputado-federal/page.tsx` (`intervaloProjetado`, `uf-intervalo-rotulo`).

## Consequências

**Positivas**:
- A promessa do produto — projeção, não só contagem — passa a valer para o cargo que tinha a maior
  distância entre o que a tela dizia e o que a bancada seria: a 25% apurado, a tela deixa de mostrar
  só "o que as primeiras zonas contaram".
- Reaproveita peças já validadas (extrapolação por zona, estratos por tercil, `distribuir_cadeiras`
  com golden 511/513, `_marcar_indefinidas`); não inventa método estatístico novo, que seria
  irrecuperável em quatro dias.
- O interruptor é operável na noite congelada, com dois pontos de leitura que limitam o tempo de
  "desligar" ao da regeneração da página, e falha fechada — o pior caso de uma leitura ruim é
  esconder projeção, o mesmo estado do site de hoje.
- Fecha um erro de registro que induzia decisão errada: o runbook e o `vercel.ts` diziam que
  `TSE_DEPUTADO_GRANULARIDADE` age "sem deploy", o que faria alguém tentá-lo às 22h.
- Conserta, de passagem, o `% apurado` de estado (`max` → ponderado), que afetava também a marcação
  `indefinida` do RF-127.

**Negativas**:
- **Não há validação contra a noite real, e o interruptor nasce ligado.** G2 é sintético (ordens de
  chegada inventadas por nós, como o replay do ADR-0023); G3 depende de o dono baixar arquivos e só
  testa geografia; o piso de 25% é escolha, não medida. Se a projeção estiver errada às 20h, o que a
  desliga é uma pessoa que percebeu. Não existe alarme que compare projeção com parcial (só uma linha
  de log estruturada por ciclo, `dep_projecao`), e o vigia do ciclo não olha precisão.
- **Voto de reduto a 25% é o risco central e não é eliminável por este método.** A imputação por
  estrato de tamanho não enxerga geografia dentro do estrato; o ADR-0023 mediu o resíduo (cobertura
  do IC praticamente parada). Mitigações — rótulo "não oficial", marca "apertada", intervalo,
  interruptor — comunicam ou limitam, não corrigem.
- **Uma cadeira "projetada" errada é publicada em rede aberta na noite da eleição**, com o nome de
  uma pessoa ao lado. O rótulo do § 1 é obrigação regulatória, não anteparo suficiente contra o
  leitor que lê só a marca.
- **Ligar é lento, desligar é rápido.** Desligar age na regeneração da página (alvo 60 s); ligar
  precisa de um ciclo do modelo para o campo aparecer (a volta completa do cargo é de 30 min,
  ADR-0036). A assimetria é deliberada e precisa constar do runbook.
- **Falha fechada esconde a projeção diante de qualquer soluço de leitura do Edge Config**, mesmo
  com o interruptor ligado — e trata **chave ausente** como desligada (decisão minha, ver abaixo).
  Custa disponibilidade da projeção; compra a garantia de que o botão de desligar nunca "não pega".
- **Exceção ao § 6 fica no papel.** A constituição continua com o texto absoluto sobre
  `projections`; a projeção de deputado é mais um caso fora dele. Além disso, o Blob de cada UF tem
  caminho fixo e é reescrito a cada ciclo: o que o site mostrou às 21h37 só se reconstrói por replay
  dos snapshots com o código do commit publicado, não por arquivo.
- **O D9 some, e a spec 017 diverge deste ADR até ser emendada.** Quem ler só o `design.md` da 017
  vai achar que a tela "não pode chamar de projeção". A hierarquia resolve o conflito (ADR vence
  design), mas o custo de leitura existe até a emenda entrar.
- **Outros textos do repositório podem repetir o mesmo erro de "sem deploy".** Foram achados dois
  (runbook `:870`, `vercel.ts:184`) buscando por `TSE_DEPUTADO_GRANULARIDADE`; as demais variáveis
  não foram auditadas.

## Alternativas consideradas

- **Manter o D9 (só parcial, sem projeção).** Rejeitada pelo dono: entrega o número mais defensável
  e o menos útil na hora em que o leitor mais pergunta "como fica".
- **Trava mais alta ou exigir cobertura de zonas (o rascunho previa 95%).** Rejeitada: o dono
  escolheu imputar o estado inteiro e travar em 25%. O caminho para apertar sem deploy é
  `pct_minimo` na chave do interruptor.
- **Projetar só a partir das zonas apuradas, sem imputar as demais.** Rejeitada como decisão do dono
  (estado inteiro); produziria totais de UF que dependem de quais zonas já chegaram, sem a
  ponderação por tamanho que o ADR-0023 justifica.
- **Interruptor por variável de ambiente.** Rejeitada por fato: só age em deployment novo, e o deploy
  está congelado de 16h às 05h em 04/10.
- **Interruptor no Postgres.** Rejeitada: o banco não entra no caminho de leitura da página
  (ADR-0001, constituição § 3) e adicionaria uma dependência de rede à renderização.
- **Interruptor como campo no payload ou no Blob.** Rejeitada: quem escreve o payload é o ciclo do
  modelo, então virar o interruptor dependeria de uma volta de 30 min e da mesma cadeia que se
  quer poder cortar; e dois escritores no mesmo objeto criam corrida.
- **Gravar a projeção em `projections`.** Rejeitada: int4 não comporta `sqcand`, exigiria migration
  na semana da eleição, e o cargo 6 já estava fora da série persistida por decisão de 17/09.
- **Ordenar as listas pela projeção.** Rejeitada: § 2 e ADR-0051 (não há controle de base do
  leitor nesta tela) e porque projeção não é número contado.
- **Modelo hierárquico ou bayesiano para a imputação.** Rejeitada pelo prazo e pelo ADR-0006
  (não-bayesiano): nenhum prior de 2022 por zona existe no repositório.

## Detalhes que este ADR fixa onde o plano não dizia (o dono pode mudar)

1. **Chave ausente = desligada.** A alternativa era "ausente = ligada" (nada a gravar na virada). Fiquei
   com o lado que falha fechado, também porque o modo de falha do store errado (ver item 4 da
   Decisão) é mais perigoso quando o padrão é ligado.
2. **`pct_minimo` só sobe** (mínimo efetivo = max(25, valor)).
3. **`em` e `por` nunca são publicados.**
4. **O script recusa o store de ensaio por omissão**, e o ensaio de 03/10 no store de ensaio pede
   declaração explícita. O plano dizia "recusa o store de ensaio" e também "ensaio no store de
   ensaio"; conciliei assim.
5. **Zona sem boletim conta zero no `% apurado`** (denominador = eleitorado conhecido da UF inteira).
6. **Significado de `aguardando` × `indisponivel`**, descrito no item 3 da Decisão; o mapeamento
   fino é do design da spec 026.

## Pontos em aberto

- **Método do intervalo de cadeiras projetadas.** Este ADR fixa a obrigação (Decisão 8), não o
  procedimento. A direção natural é reamostrar zonas apuradas com `idx` compartilhado por UF (ADR-0021)
  e por estrato (ADR-0023), refazendo a imputação a cada reamostra; o design da spec 026 decide.
- **O que é "falhar feio" em G2.** Não há limiar numérico no plano. A decisão de subir desligada é do
  dono em 02/10, olhando o resultado a 25%.
- **Fórmula exata do `% apurado` ponderado** (RF-275) e forma exata da imputação: design da
  spec 026.
- **Medição do desligar → sumir em 60 s**: não feita; é o ensaio de 03/10.

## Emenda 2026-10-04 — Decisão (voto projetado por candidatura, Deputado Federal)

**Contexto.** O modelo calcula o voto projetado de cada candidato válido
(`api/model/deputado_projecao.py:538-554`), mas só as cadeiras por agremiação e a marca "eleito na
projeção" chegavam ao pacote publicado. Na noite da eleição o leitor pergunta quantos votos o modelo
espera de quem está sendo eleito e de quem está logo abaixo do corte. Deputado não tem 2º turno: o que
não subir hoje não sobe mais. Isto vale **só para o Federal**; o Estadual e o Distrital não têm projeção
(Fase 2 da spec 027).

**Decisão.**

1. **Publicação (Decisão 1 emendada).** Com `projecao.estado === "liberada"`, o campo `votos_projetados`
   (inteiro) vai em cada linha de candidato válido de `candidatos` no objeto da UF. **Nunca** vai para
   `lista_restante`: a rota 61+ serve esse JSON cru e não lê o interruptor (RF-265, ADR-0065 D1). Nunca
   vai em linha com `destino` (anulado, sub judice, válido de legenda). Fora de `liberada`, ou com o
   interruptor desligado, o campo não existe: a leitura da página o remove no mesmo ponto em que já remove
   `projecao` e `projecao_apertada` de cada linha, então "desligar → sumir" continua agindo na regeneração
   da página (alvo de 60 s, Decisão 4). Vale a ressalva do runbook para os demais campos de projeção: o
   arquivo JSON público do Blob da UF ainda traz o campo até o ciclo seguinte do modelo (até 30 min).
2. **Exibição.** Sob o voto apurado, no mesmo elemento do rótulo, "projeção ≈ 652 mil · não oficial" (§ 1,
   Decisão 5), na cor de projeção, em forma compacta e arredondada a milhar ("mil", "mi"), nunca ao voto.
   Aparece em três conjuntos: as linhas **eleitas** (na parcial ou na projeção), os **7 primeiros não
   marcados por agremiação**, por `rank` de apuração (escolha do dono, "eleitos + 7"), e o "Mais votados
   da UF". Nunca em página nacional. O critério é o mesmo para toda agremiação e depende só do voto
   apurado, sem juízo editorial (§ 2).
3. **A Decisão 5 permanece.** O número convive com o apurado, cada um com o seu nome: nunca reordena a
   lista, nunca substitui o voto contado, nunca é "eleito" sozinho. A legenda de marcas ganha uma linha.
4. **Formatação.** Valores de 999.500 a 999.999 saem hoje como "1.000 mil" (`lib/utils/format.ts:167`) e
   passam a sair como "1 mi".

**Ressalva estatística (registrada, não resolvida).** Voto de deputado é **concentrado em redutos**: a
imputação por estrato de tamanho (ADR-0023) não enxerga geografia dentro do estrato, e o risco de "voto de
reduto" que as Negativas acima nomeiam é maior no nível do candidato do que no da agremiação — a legenda
soma muitos candidatos e zonas, a pessoa depende de onde estão os seus. O número por candidato é, portanto,
**mais instável** que o de cadeiras. Ele é arredondado a milhar para não vender precisão e sai **sem faixa
de incerteza**: o intervalo já havia sido adiado até para as cadeiras (emenda de 29/09) e nunca existiu
bootstrap por candidato. Isso não é coberto pela letra da Decisão 8 (que fala de cadeiras), mas contraria o
seu espírito — número central sozinho —, e fica aceito pelo dono com o rótulo, o "≈", a trava de 25%, o
interruptor e a metodologia como únicas mitigações; nenhuma delas é estatística.

**Peso do documento.** No pior caso de SP são ~280 linhas × ~62 B ≈ 17 KB, acima da folga de ~15,5 KB sob
o teto da emenda de 30/09 do [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md). O teto das páginas
de UF de Deputado (SP, RJ e MG) sobe de 560 KiB para **~590 KiB**; o valor final é o **medido** pelo
implementador com o pior caso de cada campo (nomes acentuados, "999 mil"), e o teto do teste de peso das
listas (`DeputadoListaAgremiacao.peso.test.tsx`, 384 KiB) sobe na mesma medida. O novo valor entra em
`docs/nfr/performance.md` e em `tests/e2e/perf-budget.spec.ts`, com o motivo ao lado. O dono aprovou o
custo ao escolher "eleitos + 7".

**Consequências desta emenda.**

- *Positivas*: responde à pergunta da noite no nível da pessoa; o interruptor continua desligando tudo
  (campo removido na leitura); nada do modelo muda além da publicação (o replay presidencial permanece
  idêntico, G5).
- *Negativas*: um número pontual **por pessoa**, inclusive de quem não está marcado como eleito, publicado
  em rede aberta; quem lê "projeção ≈ 640 mil" ao lado de um candidato fora do corte pode lê-lo como
  "quase eleito". O erro de uma pessoa fica visível individualmente, e não diluído numa bancada. O arquivo
  público do Blob guarda o campo até o ciclo seguinte ao desligar. O teto de peso sobe de novo
  (560 → ~590 KiB), o segundo aumento em poucos dias (o primeiro foi a emenda de 30/09 do ADR-0065).
- *Propagação*: spec 026 (RF-297), spec 011 (`/sobre-o-modelo` e `<DeputadoMetodologia>` precisam dizer
  que o número por candidato é pontual e sem faixa — constituição § 8), `docs/specs/026-.../design.md` §
  2.2 (campo na linha), runbook (a ressalva do Blob cobre o campo novo).

## Emenda 2026-10-04 (2) — Decisão (bancada nacional projetada como cenário misto rotulado, Deputado Federal)

**Contexto.** O painel "Bancada apurada — Quem fica com as cadeiras" da capa `/deputado-federal` diz
quantas cadeiras cada agremiação tem na parcial (o `bancada` do payload nacional, no Edge Config), mas não
**quem** são os eleitos — para ver nomes o leitor abre as 27 páginas de UF —, e com o seletor do topo em
"Projeção" não mostra número nenhum, porque a Decisão 1 e o § "Fora" da spec 026 vetaram a bancada nacional
projetada: "somar projeções de UFs liberadas com parciais de UFs aguardando produziria um número sem nome".
No dia do 1º turno o dono pediu as duas coisas — a lista nacional de eleitos por agremiação e o número da
Projeção — e respondeu à objeção do "número sem nome" dando nome ao número: o que foi somado fica declarado
no próprio rótulo.

A restrição de implementação é o dia da eleição: mexer no modelo Python ou na gravação do payload do Edge
Config arrisca a apuração da noite, então a solução tem de **só ler** o que já é publicado. E já é publicado:
cada objeto de UF do Blob (`deputado/uf/<UF>.json`, lido por `readDeputadoUfDetail`) traz toda candidatura
com marca — parcial, projeção ou TSE — qualquer que seja o `rank` (ADR-0065 D1: candidatura marcada fica
sempre no documento; a faixa 61+ nunca carrega marca), e o `cod` de cada agremiação do objeto é a chave
**nacional** (design 017 D3, emenda de 29/09), igual ao `cod` de `bancada.por_agremiacao` — o casamento entre
UFs é igualdade de string.

Dois pontos desta emenda tocam decisões acima e se leem com elas. A **Decisão 5** diz que "o número da
projeção nunca substitui o da parcial": um número nacional que *trocasse* o da linha ao virar o seletor a
contrariaria (o precedente da casa é o RF-180 da spec 003 — a coluna Parcial fica no DOM em qualquer base,
só a ênfase tipográfica muda). E a **Decisão 4** limita o "desligar → sumir" ao tempo de regeneração da
página: uma rota nova com cache de CDN de 60 s mais 300 s de `stale-while-revalidate` que carrega dado de
projeção, se copiada tal e qual do molde de `/lista` (ADR-0065 D3), **não** obedeceria a esse limite. A faixa
61+ podia ignorar o interruptor porque nunca leva projeção; esta rota leva.

**Decisão.**

1. **A bancada nacional projetada passa a existir, como cenário misto rotulado.** Por agremiação nacional
   (`cod`), o cenário é a soma, sobre as UFs com dado, de `cadeiras_projetadas` nas UFs com projeção visível
   (`liberada` e interruptor ligado — `projecaoVisivel`) e de `cadeiras`, a parcial, nas demais. O número
   **nunca aparece sem o rótulo** "projeção em X de 27 estados; nos outros Y, a parcial" — X e Y derivados
   dos dados, nunca escritos à mão, e "Z sem dado agora, fora da conta" quando uma UF não pôde ser lida —,
   nem sem "projeção · não oficial" (§ 1) e "pontual" (emenda de 29/09: sem faixa, é o rótulo que cumpre a
   Decisão 8). Cada nome listado diz de onde veio: "eleito na projeção · não oficial" (UF liberada),
   "parcial — projeção ainda travada neste estado" (UF travada) ou "Eleito (TSE)", que tem precedência sobre
   os dois (RF-267). Com X = 0 não há cenário projetado — a tela diz que nenhum estado tem projeção liberada
   e mostra a parcial. Com o interruptor desligado nenhum dado de projeção sai, e a tela mostra a parcial
   com o aviso "A projeção de deputados está desligada agora — mostrando a parcial." A Decisão 1 fica
   revogada **só** nesta parte: o contrato continua levando a projeção **por UF**.

2. **A soma é feita na leitura, por uma rota fora de `/api`.** Um agregador puro
   (`lib/deputado/eleitos-nacionais.ts`) recebe as 27 UFs lidas do Blob e o estado do interruptor e devolve,
   por agremiação, `parcial`, `cenario`, as UFs de cada base e as linhas dos candidatos. A rota
   `GET /deputado-federal/eleitos` (`app/(dep)/deputado-federal/eleitos/route.ts`, `nodejs`,
   `force-dynamic`) o monta lendo o interruptor, as 27 UFs em paralelo e as fotos dos eleitos. Sucesso:
   `Cache-Control: public, s-maxage=60, stale-while-revalidate=60`; nenhuma UF com dado: 404 `no-store`;
   erro: 502 `no-store`. UF que falha ou não existe vai para `ufs_sem_dado` e **nunca** vira zero. A rota
   fica fora de `/api` pelo motivo do ADR-0065 D3 (o BotID roda em `/api/*`, ADR-0009), e não abre dado novo:
   os Blobs de UF já são públicos. Não toca Postgres (ADR-0001; o read path é Edge Config e Blob,
   ADR-0026). A capa **não** chama a rota no servidor — o RF-271 segue valendo. Uma ilha cliente pequena,
   montada por linha da bancada, busca no primeiro clique em "Ver os eleitos" **ou** ao escolher "Projeção"
   no seletor, uma vez por aba, com a resposta guardada em memória por 60 s e compartilhada entre as linhas.
   Se a rota falha, falha só o recurso novo: a capa e os números da bancada seguem como estão (§ 7).

3. **O que não muda.** Voto projetado por candidato continua proibido em página nacional (emenda de
   04/10 (1), item 2; RF-297): o agregador e a rota o descartam, e a lista nacional carrega só voto apurado.
   O hemiciclo do topo continua desenhando a parcial (ADR-0049). A **ordem** das agremiações na bancada
   continua a da parcial (`ordenarBancada`): a projeção nunca ordena (Decisão 5, ADR-0051); dentro da lista
   aberta, a ordem é UF por sigla e depois `rank` de apuração. O § 2 admitiria reordenar pelo seletor, sob
   as condições (a) a (c); isso fica adiado, não rejeitado. A capa de Deputado Estadual não muda, e a
   exclusão da bancada nacional projetada das assembleias (spec 027 § Fora; ADR-0066, ponto em aberto "Soma
   nacional na capa") continua valendo — estendê-la exige decisão própria.

4. **A Decisão 5 vale para o cenário: os dois números convivem.** Em "Projeção" a linha mostra o cenário em
   evidência, na cor de projeção, e **mantém a parcial visível, com o nome dela**. Virar o seletor muda a
   ênfase; não apaga o que foi contado.

5. **A Decisão 4 se estende: dois pontos de leitura do interruptor também aqui.** A rota lê o interruptor e
   omite a projeção quando ele está desligado; a página — que já o lê a cada renderização, para o selo por
   UF — entrega o estado à ilha, e a ilha **ignora** qualquer campo de projeção que a resposta traga quando
   a página diz "desligada". Assim o "desligar → sumir" continua limitado à regeneração da página (alvo de
   60 s, ainda não medido) e à atualização automática (ADR-0074), e não ao cache da rota. O que sobra é da
   mesma classe da ressalva do Blob: o corpo em cache no CDN pode conter projeção até o fim da janela de
   cache, sem aparecer na tela.

**Alternativas consideradas.**

- *Calcular o cenário nacional no modelo e publicá-lo no payload.* Rejeitada: no dia da eleição qualquer
  mudança no modelo Python ou na escrita do Edge Config arrisca a apuração da noite.
- *Ler as 27 UFs no servidor, na renderização da capa.* Rejeitada: viola o RF-271 (a capa não lê Blob de
  UF), põe 27 leituras no caminho do LCP (§ 3, RNF-002) e engorda o documento com listas que o leitor não
  pediu.
- *Rota sob `/api`.* Rejeitada pelo ADR-0065 D3: o BotID responde 403 a cliente automatizado e derruba o
  portão e2e.
- *Cenário só com as UFs liberadas, ignorando as travadas.* Rejeitada: seria um "país" feito de parte dos
  estados, que cresce com o avanço da apuração — o número sem nome que a spec 026 vetou.
- *Manter o veto (só parcial na capa).* Rejeitada pelo dono: o leitor pergunta "como fica a bancada", e a
  capa nacional seria a única tela de Deputado sem resposta.
- *Trocar o número da linha pelo cenário ao virar o seletor.* Rejeitada por contrariar a Decisão 5 (item 4).

**Consequências desta emenda.**

- *Positivas*:
  - Responde na capa à pergunta "quem", sem 27 cliques e sem tocar no modelo; se a rota cair, só ela cai.
  - É reversível: tirar a ilha devolve a capa de antes, sem migração de dado.
  - O interruptor continua desligando tudo, agora com o ponto de leitura da página também sobre a rota.
  - A soma é aritmética inteira sobre números que o modelo já publicou; não cria método estatístico novo.
- *Negativas*:
  - **O número nacional mistura duas bases.** O rótulo é a única mitigação, e quem lê só "12 cadeiras" vê um
    número que não é nem a parcial nem a projeção pura. Pior: o misto **se move por composição, não por
    voto** — quando uma UF passa dos 25% e vira "liberada", o cenário salta ao trocar parcial por projeção
    naquela UF, sem boletim novo, e a fração X de 27 sobe ao longo da noite. Cedo, com X pequeno, o número é
    quase a parcial com selo de projeção (por isso o X = 0 não se chama cenário).
  - **Pontual, sem faixa.** O intervalo de cadeiras projetadas foi adiado (emenda de 29/09) e faixa de uma
    UF não se soma à de outra; o cenário nacional não tem faixa nem como ter, com as peças existentes. Vale o
    rótulo "pontual" — o mesmo desvio assumido da Decisão 8, agora numa tela que mais gente lê.
  - **Nomes de pessoas, em escala nacional.** A lista põe numa só tela dezenas de "eleito na projeção · não
    oficial" de UFs diferentes. O erro de uma projeção de UF (voto de reduto, Negativas acima) fica mais
    visível e mais fácil de ser lido como resultado — o risco da emenda (1), ampliado.
  - **A linha pode estar numa ordem que o cenário desmente.** A agremiação com cenário maior pode ficar
    abaixo de outra com cenário menor, porque a ordem é a da parcial.
  - **Desencontro entre fontes.** A linha vem do Edge Config (payload nacional, da última renderização da
    página) e a lista vem do Blob por UF; os dois podem ser de ciclos diferentes — o cargo 6 roda fatiado
    (ADR-0036). Somam-se o Data Cache de 60 s do Blob, o `s-maxage` de 60 s e o `stale-while-revalidate` de
    300 s da rota e os 60 s da memória do cliente: de alguns segundos, no caso comum, a alguns minutos, no
    pior. O `cadeiras` da linha e a contagem de nomes da lista podem divergir por um ciclo, e nenhum dos dois
    é ajustado para igualar o outro; cada um leva o seu nome. A janela de 300 s é a do molde `/lista`, cujo
    dado muda pouco; aqui o dado muda a cada ciclo, e a janela pode ser apertada (por exemplo, SWR de 60 s)
    sem mudar o desenho.
  - **Fan-out de leitura.** Cada falha de cache faz 27 leituras de Blob e 1 de Edge Config. O CDN absorve em
    regime, mas o custo da primeira requisição de cada região depois de expirar não foi medido.
  - **Peso.** A ilha por linha entra no JS e no HTML da capa (botão e `aria-*` em cada linha). O teto de
    peso do documento e o RNF-007a **não sobem** por esta emenda; se estourarem, para-se e leva-se o número
    ao dono.
  - **A exceção ao § 6 se estende.** O cenário não é gravado: reproduz-se dos objetos de UF mais o código,
    mas o Blob é reescrito a cada ciclo, e o que a tela mostrou às 21h37 só se reconstrói por replay.
  - **A Decisão 1 continua no arquivo.** Quem ler só ela conclui que a bancada nacional projetada não
    existe; a nota ao lado dela e esta seção resolvem, ao custo de leitura (como na emenda de 29/09).
- *Propagação*: spec 026 (RF-299 e RF-300; § Fora emendado; § Telas), design 026 (nota junto do contrato
  nacional), spec 011 (`/sobre-o-modelo`, seção "Cadeiras", e o `<DeputadoMetodologia>` da capa precisam
  explicar o cenário misto — § 8), `docs/design-system/components.md` (`BancadaEleitosNacional`), runbook (a
  ressalva do Blob cobre também a rota nova), `docs/nfr/performance.md` se o teto da capa mudar.

## Cross-refs

- [ADR-0001](0001-edge-config-no-read-path.md) — Edge Config no read path; Postgres fora dele.
- [ADR-0005](0005-templates-nao-llm.md) — `insights = []` permanece.
- [ADR-0006](0006-bootstrap-nao-bayesiano.md) — o intervalo continua bootstrap não-paramétrico.
- [ADR-0012](0012-edge-config-chaves-nomeadas.md) — convenção de chaves e regex de `keys.ts`.
- [ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md), [ADR-0023](0023-pos-estratificacao-por-porte-de-zona.md)
  — o método, agora estendido ao cargo 6 (nota adicionada nos dois).
- [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) — o algoritmo de cadeiras,
  intocado.
- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md),
  [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) — pares somados em zona; cadência
  de 30 min.
- [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — o hemiciclo segue
  desenhando a parcial; qual base ele passa a desenhar, se alguma, é decisão da spec 026.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — por que a projeção não
  ordena.
- [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md) — precedente de migration
  estacionada na semana da eleição.
- [ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md) — entrada filtrada pelo `dvt`.
- [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) — listas.
- Spec 017 ([design.md § D9, D10](../../specs/017-deputado-federal/design.md); RF-127 em
  [spec.md](../../specs/017-deputado-federal/spec.md)) — emendada pela frente de specs. Spec
  `026-deputado-listas-projecao` — RF-263 a RF-266, RF-275. Spec 011
  ([sobre-o-modelo](../../specs/011-sobre-o-modelo/spec.md)) — metodologia da projeção.
- Constituição § 1 (rótulo não oficial, art. 267 § 4º), § 2 (ordem), § 3 (banco fora do read path),
  § 4 (cor nunca sozinha), § 6 (reprodutibilidade; exceção do cargo 6), § 7 (falha degradada),
  § 8 (bloco "o que está movendo"), § 9 (Edge Config), § 10 (snapshots append-only):
  [../../constitution.md](../../constitution.md).
- Código: `api/model/cadeiras.py`, `api/model/deputado_payload.py:226-290`,
  `api/model/project.py:2025-2040` e `:7924`, `lib/edge-config/keys.ts`,
  `lib/db/schema.ts:236`, `proxy.ts`. Textos a corrigir: `docs/operations/runbook.md:870`,
  `vercel.ts:184`. Operação: `docs/operations/vespera-03-10.md` § 0.5.
- Emenda de 04/10 (2): [ADR-0009](0009-botid-vercel.md) e [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md)
  D3 — a rota fora de `/api`; [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — Blob como
  read path; [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) — cargo 6 fatiado;
  [ADR-0049](0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — hemiciclo segue na parcial;
  [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — a ordem não segue o cenário;
  [ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md) — a lista aberta acompanha a
  atualização da página; [ADR-0066](0066-cargos-7-e-8-como-proporcionais-do-produto.md) — a soma nacional
  das assembleias continua fora. Spec 026: RF-299 e RF-300; spec 003: RF-180 (precedente: a parcial fica no
  DOM em qualquer base). Constituição § 1 (rótulo), § 2 (ordem), § 3 (banco fora do read path), § 4 (cor
  nunca sozinha), § 6 (exceção do cargo 6), § 7 (falha isolada), § 8 (metodologia da capa).
