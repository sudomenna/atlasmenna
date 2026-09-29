---
id: ADR-0049
title: Hemiciclo da Câmara com N cadeiras lido em runtime, 12 arcos fixos independentes de N, e cadeira indefinida marcada por anel colorido, não cinza chapado
status: accepted
date: 2026-09-18
---

# ADR-0049 — Hemiciclo da Câmara: geometria fixa, cadeira indefinida com anel colorido

## Status

Aceito. Decisão do dono na sessão de 2026-09-18, implementada no commit `16d4a26` (`feat(camara):
o hemiciclo de 513 cadeiras, pintado pelo que já está definido`):
`components/blocks/CamaraHemiciclo.tsx`, `lib/utils/hemiciclo.ts` e `lib/utils/bancada.ts` (novo,
extraído de `app/(dep)/deputado-federal/page.tsx`), consumidos em
`app/(dep)/deputado-federal/page.tsx:426`.

Nenhum RF publicado normatiza a **existência** do widget — RF-124, RF-125.1 e RF-127 (spec 017)
já regiam os dados que ele desenha antes deste commit, mas nenhum deles descreve a peça visual em
si (um assento por cadeira, arcos, cor por agremiação). Este ADR registra a decisão de
implementação e a lacuna de RF fica aberta para o próximo despacho, que emenda `docs/specs/
017-deputado-federal/spec.md` para lhe dar um RF próprio. ✅ **Lacuna fechada em 2026-09-19**:
RF-131, seção `### Telas` da spec 017.

> **Nota 2026-09-29 — Emenda parcial.** O [ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md)
> generaliza a geometria para duas casas (`ARCOS_CAMARA = 12`, inalterado, e `ARCOS_SENADO = 5`) e
> cria a **visão por bloco**, com marcas de limiar e ordem por relação com o governo **só nela**. Os
> itens 1–5 e 7 da Decisão seguem intactos. O item 6 ("sem marcador em 257", sem eixo ideológico)
> segue valendo **integralmente para a visão por partido** (`CamaraHemiciclo`); a frase "o produto
> não classifica partido" que o sustentava é reescrita pelo
> [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — a classificação passa a
> existir, só na camada de etiquetas, e a ordem das cunhas continua por tamanho.

> ⚠️ **Emenda de 2026-09-19 — a premissa do item 1 da Decisão morreu; a decisão, não.**
>
> Este ADR argumentava que `total_cadeiras` precisava ser lido em runtime porque "a
> redistribuição pelo Censo 2022 (PLP 177/2023) pode elevar a Câmara de 513 para 531 e não tem
> desfecho confirmado". **O desfecho existe, e é anterior a este ADR**: o PLP 177/2023 foi
> aprovado pela Câmara e pelo Senado em junho/2025, **vetado integralmente pela Presidência da
> República em julho/2025**, e o **STF decidiu manter a distribuição atual de 513** para este
> pleito, regido pela Resolução TSE 23.751/2026 (`docs/reference/regulatory.md`). A Câmara de
> 04/10/2026 tem **513 cadeiras, todas em disputa**.
>
> A premissa falsa não era decorativa: era o que autorizava
> `api/model/deputado_payload.py::_bancada_nacional` a **somar** os `lugares_a_preencher` das UFs
> presentes e chamar o resultado de `total_cadeiras`. Essa soma cresce durante a noite — com três
> estados pequenos apurando ela dá 26 —, e este widget é justamente quem deu a ela o maior
> destaque visual do produto, com a agravante de mudar de forma abaixo de 24 cadeiras
> (`arcosPara`). A frase "26 cadeiras em disputa" esteve no ar em `/deputado-federal`.
>
> O que **continua** valendo, e por outra razão: nenhuma camada deste widget escreve `513`. O
> número chega pelo payload, e é o **produtor** que o fixa (`api/model/cargos.py::TOTAL_CADEIRAS`,
> `VAGAS_EM_DISPUTA_2026` — os mesmos dicionários que o Senado já usava para 81/54), conferido
> contra a soma publicada pelo TSE quando as 27 UFs tiverem publicado `carg[].nv`
> (`conferir_total_de_cadeiras`). RF-124 nunca regeu o total nacional: ele rege o
> `lugares_a_preencher` de **uma UF**, que segue vindo do TSE e segue sendo o denominador do
> quociente eleitoral.
>
> **A geometria de 12 arcos não é reaberta por esta emenda.** O que muda é só o motivo pelo qual
> o total é lido em runtime. Onde o texto abaixo usa 531 como cenário, leia-o como **caso de
> robustez** — o desenho não pode assumir o tamanho da casa —, não como desfecho por vir.

## Contexto

**1. O produto pediu uma representação visual do plenário, e a página de Deputado só tinha
lista.** `/deputado-federal` já exibia a bancada como tabela de agremiações (cadeiras, votos
nominais, votos de legenda), mas nenhuma tela do produto mostrava a Câmara como o leitor a
reconhece — um hemiciclo de assentos. O precedente de zero-JS já existia para peças equivalentes:
`HexCartogramBrasil.tsx` (27 formas SVG inline) e `SerieApuracaoChart.tsx` (gráfico inteiro no
servidor), então a rota natural era outro componente Server-only, sem `next/dynamic` e sem
disputar o orçamento do chunk MapLibre — que em 18/09 estava em 285,3 KiB de 300 (RNF-007b,
medido nesta mesma sessão em [ADR-0048](0048-coropletico-substitui-cartograma-governador-estreia-senador.md)).

**2. O tamanho da Câmara não é uma constante do produto — é RF-124.** `docs/specs/
017-deputado-federal/spec.md:152-164` já exigia que `lugares_a_preencher` viesse do dado
publicado pelo TSE, nunca de constante embutida, ~~porque a redistribuição pelas cadeiras pelo
Censo 2022 (PLP 177/2023) pode elevar a Câmara de 513 para 531 e não tem desfecho confirmado~~
porque errar o denominador do quociente eleitoral corrompe a projeção inteira de uma UF.
~~`EdgeBancadaNacional.total_cadeiras` (`lib/edge-config/types.ts:1508-1531`) já carrega essa
soma em runtime.~~ Um hemiciclo desenhado com `513` hardcoded em qualquer camada — geometria,
teste ou componente — reproduziria exatamente o defeito que RF-124 existe para impedir, só que na
superfície visual em vez do cálculo do quociente eleitoral.

> ⚠️ **Corrigido em 2026-09-19** (ver a emenda no `## Status`). Duas coisas ficaram falsas neste
> parágrafo. A primeira é a premissa do Censo 2022: o PLP 177/2023 foi vetado em julho/2025 e o
> STF manteve as 513 — não há 531 por vir neste pleito. A segunda é mais séria e é um defeito, não
> uma imprecisão: `EdgeBancadaNacional.total_cadeiras` **carregava a soma das UFs presentes**, e
> este ADR a descreveu como se ela fosse o tamanho da Câmara. Não era — era um número que começava
> a noite em 26 e terminava em 513. Hoje o campo carrega o fato fixo do produtor
> (`api/model/cargos.py`), e a soma virou conferência com alarme. O argumento contra o `513`
> hardcoded **no widget** sobrevive inteiro: o desenho não pode assumir o tamanho da casa, e o
> teste de peso continua medindo 531 por isso.

**3. Nenhum dos três orçamentos de RNF-007 enxerga um widget sem `<script>`.**
`tests/e2e/perf-budget.spec.ts` mede os três tetos (above-the-fold, chunk do mapa, JS total) somando
`request.resourceType() === "script"`. Um SVG de ~513 `<circle>` renderizado no servidor é HTML,
não script — ele poderia dobrar de tamanho com os três gates permanecendo verdes. Isso não é uma
suposição: é o estado real na sessão que produziu este ADR.

**4. RF-127 já normatizava "intervalo, não só o número central" — mas o payload nacional não dá
material para desenhar a metade que falta.** `docs/specs/017-deputado-federal/spec.md:219-227`
exige que a tela marque cadeiras "cuja atribuição depende de sobras ainda indefinidas" e exiba o
intervalo. `EdgeAgremiacaoBancada` (`lib/edge-config/types.ts:1593,1599`) carrega os dois campos
separadamente: `cadeiras_indefinidas` (quantas, por agremiação) e `cadeiras_ci95` (intervalo de
95% do **total** da agremiação, opcional por decisão de contrato do design 017 § D7). O primeiro
identifica cadeiras individuais; o segundo é uma faixa agregada que não diz **de quem** seriam as
cadeiras em disputa dentro da faixa — informação que o payload nacional não carrega e que inventar
seria mentir com o desenho.

**5. O piso de contraste de não-texto (RNF-035) tinha sido criado nesta mesma janela e ainda não
alcançara Deputado.** `docs/nfr/accessibility.md:19-60` documenta que o critério "elemento
gráfico que carrega informação ⇒ 3:1" foi formalizado em 18/09 a partir de duas decisões já
tomadas (ADR-0047 D1 e `DATA_FILL_STROKE`), e que 4 das 33 cores-base de partido reprovam no tema
claro — entre elas PSOL (2,08:1), líder da federação PSOL-Rede. Qualquer componente novo que
pintasse identidade partidária com a cor-base herdaria essa reprovação; o hemiciclo é esse
componente.

**6. O dono pediu "coligações partidárias"; a Câmara proporcional não tem coligação desde 2020.**
`api/model/cadeiras.py:31-37` já documentava, antes deste commit, que coligação em proporcional é
vedada pela CF art. 17 § 1º (EC 97/2017) e que este produto não a modela — o que existe são
federações, tratadas como **uma** agremiação inteira (Lei 9.096 art. 11-A; Lei 9.504 art. 6º-A),
com a cor herdada do partido-líder (`sigla_lider`, `lib/edge-config/types.ts:1541-1571`, ADR-0024
linha 41). O hemiciclo herda esse contrato sem reabri-lo: cada cunha do desenho é uma agremiação
no sentido que `cadeiras.py` já define, não uma coligação que a lei não permite existir.

## Decisão

**1. `total_cadeiras` nunca é constante — nem no componente, nem na geometria.** Toda cadeira
desenhada sai do argumento `total` de `layoutHemiciclo(total)` (`lib/utils/hemiciclo.ts:184`), que
por sua vez vem de `EdgeBancadaNacional.total_cadeiras`. Nenhum arquivo dos três assume 513 como
default, limite ou divisor (`lib/utils/hemiciclo.ts:10-16`) — o teste de peso
(`tests/unit/components/camara-hemiciclo-peso.test.tsx:59-66`) mede explicitamente o caso 531
~~para provar que a mudança futura do Censo 2022 não exige tocar código~~ como caso de robustez:
um componente que passa em 531 é um componente que não escondeu 513 em lugar nenhum.

> ⚠️ **Reescrito em 2026-09-19 — a decisão é a mesma, o argumento é outro.** A redação original
> justificava a leitura em runtime pela mudança que o Censo 2022 poderia trazer. Essa razão morreu
> (PLP 177/2023 vetado em julho/2025, STF mantendo 513). A razão que **continua** válida separa
> duas perguntas que o texto original fundia:
>
> - **quantas cadeiras cada UF elege** é dado do TSE, nunca constante — é o denominador do
>   quociente eleitoral, e é isto que RF-124 rege (`carg[].nv`, por UF);
> - **quantas cadeiras a Câmara tem** é fato fixo desde antes da urna abrir — 513, todas em
>   disputa —, declarado em `api/model/cargos.py` ao lado das 81/54 do Senado, e **conferido**
>   contra a soma dos `carg[].nv` quando as 27 UFs a tiverem publicado
>   (`api/model/deputado_payload.py::conferir_total_de_cadeiras`; divergência vira `_log("error")`
>   + `_alert_slack`, que é literalmente o critério de aceitação do RF-124).
>
> Para **este componente** nada muda: ele continua desenhando o que o payload disser, sem `513` em
> nenhuma camada. O que mudou é quem produz o número do outro lado — e é lá que estava o defeito
> de produto que esta emenda registra.

**2. O número de arcos é uma constante de desenho — 12, `ARCOS_PADRAO`
(`lib/utils/hemiciclo.ts:76`) — e não é derivado de `N`.** Derivar arcos de `N` faria o plenário
mudar de forma estrutural ao cruzar um limiar entre 513 e 531, e o leitor leria essa mudança como
informação sobre a eleição quando ela é, na verdade, uma decisão do Congresso sobre o Censo. Com
12 arcos fixos, 513 → 531 apenas acrescenta uma ou duas cadeiras por arco. ⚠️ **2026-09-19**:
531 deixou de ser um desfecho por vir (PLP 177/2023 vetado; STF manteve 513) — leia-o aqui como
caso de robustez. **A decisão não é reaberta**, e o argumento que a sustenta sozinho é o da frase
seguinte, que nunca foi hipotético: a degradação no extremo pequeno acontece em toda apuração. A
única exceção guardada é o extremo pequeno — abaixo de duas cadeiras por arco a distribuição proporcional
produziria arcos vazios, que se leem como cadeira faltando; `arcosPara` (`lib/utils/hemiciclo.ts:
96-100`) reduz o número de arcos nesse caso, e não é hipotético: um payload degradado de 4 ou 10
cadeiras publicadas passa por ali na primeira meia hora da apuração.

Dentro de cada arco, os assentos são distribuídos proporcionalmente ao raio (arco externo comporta
mais) pelo método dos **maiores restos (Hare)**, com desempate por índice de arco crescente
(`assentosPorArco`, `lib/utils/hemiciclo.ts:124-142`) — sem o desempate, dois arcos com o mesmo
resto fracionário trocariam de lugar entre execuções, junto com a cor das cadeiras (constituição
§ 6). Os ângulos são uniformes em **centro de célula** (`θ = π(j + ½)/s`,
`lib/utils/hemiciclo.ts:229`), e todas as coordenadas são arredondadas a 3 casas decimais
(`arred`, `lib/utils/hemiciclo.ts:173-175`) porque `Math.cos` não é garantido bit a bit pelo padrão
da linguagem entre plataformas, e o SVG precisa sair byte a byte idêntico para o mesmo `total`
(constituição § 6).

**3. Cada cadeira tem um de três estados — `definida`, `indefinida`, `nao_atribuida`
(`components/blocks/CamaraHemiciclo.tsx:106,129-153`) — e a cadeira `indefinida` recebe cinza de
fundo com anel na cor da agremiação, não cinza chapado.** Decisão do dono, tomada com o
trade-off apresentado: cinza chapado seria mais fiel à frase original ("só pintar o que já está
definido") e produziria um desenho um pouco mais limpo. Ele escolheu o anel porque a cadeira
indefinida não é "de ninguém" — o modelo já a atribuiu a uma agremiação; o que está em aberto é a
margem apertada da rodada de sobras que a decidiu. Cinza chapado descartaria exatamente a
informação que RF-127 manda tornar legível
(`components/blocks/CamaraHemiciclo.tsx:165-188`, constante `ANEL_DA_AGREMIACAO_NA_INDEFINIDA`).
O cinza chapado continua reservado para a cadeira `nao_atribuida` — a UF que ainda não apurou o
suficiente — que é a decisão original do dono e permanece intacta (`CONTORNO_NEUTRO`,
`components/blocks/CamaraHemiciclo.tsx:163,206`).

**4. RF-127 entra pela metade neste widget, deliberadamente.** A metade que o hemiciclo carrega é
`cadeiras_indefinidas`, marcada cadeira a cadeira via o anel do item 3. A outra metade —
`cadeiras_ci95`, o intervalo de 95% — **não é desenhada aqui**: "entre 85 e 93 cadeiras" não tem
representação em bolinhas que não invente. Desenhar até o topo da faixa quebraria o invariante de
RF-125.1 (a soma deixaria de fechar em `total_cadeiras`); desenhar a faixa como um segundo
elemento exigiria saber **de quem** seriam as cadeiras em disputa, e o payload nacional não diz.
A decisão é travada por teste, não por convenção: `tests/unit/components/CamaraHemiciclo.test.tsx:
254-268` exige que o `outerHTML` do `<svg>` renderizado com `cadeiras_ci95` preenchido em todas as
linhas seja **string idêntica** ao renderizado sem nenhum valor — qualquer tentativa futura de
desenhar o intervalo (bolinhas extras, hachura, opacidade) derruba esse teste no ato.

**5. A cor de identidade usa `textForParty`, nunca `colorForParty`.**
(`components/blocks/CamaraHemiciclo.tsx:100,197,203`, função `pinturaDe`). A tabela de remédios do
RNF-035 (`docs/nfr/accessibility.md:48-51`) separa marcador de identidade (a cor diz *quem*) —
remédio `textForParty` — de preenchimento com extensão (a cor diz *quanto*/*onde*) — remédio
`DATA_FILL_STROKE`. Uma bolinha de cadeira é identidade pura, sem extensão a perder; a variante
`-text` passa 3:1 nas 4 superfícies, nos 2 temas, nos 31 partidos, sem exceção, e em 17 deles **é**
a cor-base — nada muda visualmente para a maioria das cadeiras. O anel neutro das cadeiras sem dono
usa `--text-secondary`, que o mesmo gate mede em ≥5,0:1 (`components/blocks/CamaraHemiciclo.tsx:
163`).

**6. A ordem das cadeiras reusa `ordenarBancada` — cadeiras desc, sigla asc — extraída para
`lib/utils/bancada.ts`, a mesma função que a lista de agremiações da página já usava.** A extração
existe para que a quarta cunha da esquerda e a quarta linha da lista sejam sempre a mesma
agremiação, inclusive em empate de cadeiras — com duas implementações da mesma regra, as duas
convergiriam por acaso na maioria das noites e divergiriam exatamente na noite em que um empate
acontecesse (`lib/utils/bancada.ts:9-16`). O desenho **não** tem rótulo de espectro nas
extremidades do arco, **não** tem marcador de maioria em 257, e o `<desc>` do SVG
(`components/blocks/CamaraHemiciclo.tsx:303-309`) declara em texto que a ordem é por tamanho de
bancada e não representa posição ideológica — o produto não classifica partido em
esquerda/direita (constituição § 2), e um traço no meio do arco ou um eixo ideológico afirmaria uma
medida que o modelo não faz.

**7. O hemiciclo herda, sem reabrir, a decisão de que federação é uma agremiação e coligação
proporcional não existe.** O pedido original usava o vocabulário de "coligações partidárias";
`api/model/cadeiras.py:31-37` já havia estabelecido, antes deste commit, que coligação em
proporcional foi extinta pela EC 97/2017 e que federações entram no cálculo como uma única
agremiação. Cada cunha do hemiciclo, e cada linha de `EdgeAgremiacaoBancada`, é uma agremiação
nesse sentido — o widget não introduz um segundo conceito de agrupamento partidário.

## Consequências

**Positivas**:
- Reaproveita um padrão já validado (Server Component, zero JS, SVG inline) em vez de abrir um
  quarto mecanismo de renderização gráfica no produto — os precedentes são
  `HexCartogramBrasil.tsx` e `SerieApuracaoChart.tsx`.
- A geometria sobrevive a qualquer `N` sem alteração de código — o número de arcos e a proporção
  de raios são independentes dele. ~~(Censo 2022: 513 → 531.)~~ ⚠️ **2026-09-19**: a mudança do
  Censo 2022 não vai acontecer neste pleito (PLP 177/2023 vetado em julho/2025; STF manteve 513),
  então o benefício real desta propriedade não é sobreviver a 531 — é **não ter escondido 513** em
  nenhuma camada do desenho, o que continua valendo e é o que o teste de 531 mede.
- Fecha, nesta tela, uma reprovação real de contraste (RNF-035) que existia desde 18/09 e ainda
  não alcançara Deputado — PSOL e as outras 3 cores-base reprovadas passam a usar
  `textForParty`.
- A extração de `ordenarBancada` para `lib/utils/bancada.ts` elimina uma classe de divergência
  silenciosa entre a lista e o desenho que só apareceria num empate de cadeiras, na noite da
  apuração.
- RF-125.1 (soma de cadeiras exibidas = `lugares_a_preencher`) fecha por construção no desenho: o
  invariante `Σ estados = total` não depende de o payload chegar coerente
  (`assentosDaBancada`, `components/blocks/CamaraHemiciclo.tsx:129-153`).

**Negativas**:
- **Nenhum dos três orçamentos de RNF-007 enxerga este widget** — todos somam
  `request.resourceType() === "script"`, e o hemiciclo é zero JavaScript. A mitigação é dupla e
  incompleta: `tests/unit/components/camara-hemiciclo-peso.test.tsx` prova um teto de 36 KiB sobre
  o markup determinístico do componente isolado, e `tests/e2e/perf-budget.spec.ts:82-99` ganhou um
  caso novo que mede o corpo do documento em `/deputado-federal` contra um teto de 300 KiB — mas
  esse teto está marcado **PROVISÓRIO** no próprio código, porque o gate de e2e não roda contra
  build local (o BotID derruba a navegação) e o número nunca foi medido de verdade, só derivado do
  markup de SSR. Um crescimento fino do widget pode passar despercebido até a primeira execução
  real do spec.
- **O widget dá o maior destaque visual do produto a um número — a bancada — cuja trava de
  sanidade contra multiplicação de votos existe, mas não alcança ninguém quando dispara.**
  `check_zona_merge_sanity` cobre o cargo 6 desde o commit `550fbb2` (13/09) — chamado em
  `api/model/project.py:5658` sempre que há eleitorado disponível — e nomeia por escrito o cenário
  exato que preocuparia aqui: "a bancada da Câmara sairia multiplicada por até 8× em silêncio"
  (`api/model/project.py:5648-5654`). Quando a trava dispara, ela loga em `error` e chama
  `_alert_slack` (`api/model/project.py:5250,5668`), mas `_alert_slack` sem `SLACK_WEBHOOK_URL`
  configurada apenas registra "slack alert skipped" (`api/model/project.py:5265-5276`) — a trava
  grita, mas para lugar nenhum alcançável fora do log do ciclo. ⚠️ **Correção de registro**: ao
  contrário do que outros documentos do repositório (`docs/reference/risks.md` na versão anterior
  a esta sessão, e a descrição corrente da própria mensagem de commit `16d4a26`) afirmam, a trava
  **não está ausente** — ela existe e cobre o cargo proporcional desde 13/09. O problema real e
  vigente é a ausência de `SLACK_WEBHOOK_URL`, não a ausência da trava.
- **As 27 bandeiras de UF não existem.** O encaixe está pronto — `<UfFlag>`/`<UfFlagSprite>`
  (`components/atoms/data/UfFlag.tsx`) e o gerador `scripts/gen-uf-flags.ts` — mas
  `scripts/data/bandeiras-uf/` tem 0 dos 27 arquivos esperados
  (`scripts/data/bandeiras-uf/PROVENIENCIA.md:21-30`), à espera do dono do produto. `<UfFlag>` sem
  entrada devolve `null` por desenho, então a grade de estados ao lado do hemiciclo mostra só nome
  e sigla em texto — funcional, mas visualmente incompleto até os arquivos chegarem.
- **O intervalo de RF-127 fica inteiramente fora do hemiciclo.** A legibilidade da incerteza
  agregada por agremiação depende só da lista textual ao lado
  (`aria-describedby` para `descritoPorId`, `components/blocks/CamaraHemiciclo.tsx:250-260,289-
  293`) — quem olha apenas o desenho, sem a lista, vê que uma cadeira está "apertada" (anel) mas
  não vê a largura da faixa que a cerca. É uma divisão de responsabilidade deliberada (item 4 da
  Decisão), não uma omissão, mas é uma dependência entre duas superfícies que precisa se manter
  ligada para a garantia de RF-127 valer por inteiro.
- **A geometria de 12 arcos foi calibrada para ~513 cadeiras** (o espaçamento angular e o radial
  "quase coincidem" nesse ponto, `lib/utils/hemiciclo.ts:71-74`) **e degrada de forma visível, não
  suave, no extremo pequeno.** Um payload com poucas dezenas de cadeiras publicadas — realista na
  primeira meia hora de apuração — aciona a guarda de `arcosPara` e produz um plenário com menos
  arcos, estruturalmente diferente do desenho final. O comportamento é intencional (evita arcos
  vazios), mas o leitor que atualiza a página no início da noite e de novo depois verá o hemiciclo
  mudar de forma dentro da mesma eleição — o mesmo tipo de instabilidade visual que o item 2 da
  Decisão evita para o eixo Censo 2022, reaparecendo no eixo tempo de apuração.
- **Nenhum RF publicado descreve o widget em si.** RF-124, RF-125.1 e RF-127 normatizam os dados
  que ele consome; nenhum normatiza a existência do hemiciclo, os três estados de cadeira, ou a
  regra de cor. Até a próxima emenda de `docs/specs/017-deputado-federal/spec.md`, quem ler apenas
  a spec não sabe que este componente existe.

## Alternativas consideradas

- **Derivar o número de arcos de `N`** — descartada: faria o plenário mudar de forma estrutural
  ao cruzar o limiar 513→531, comunicando ao leitor uma mudança sobre o Censo como se fosse
  informação sobre a eleição. ⚠️ **2026-09-19**: o limiar 513→531 não será cruzado neste pleito, e
  a descarte se sustenta pelo motivo gêmeo que **é** real todas as noites — `N` também varia com o
  tempo de apuração quando o payload chega degradado, e derivar arcos dele faria o plenário mudar
  de forma entre dois recarregamentos da mesma eleição (ver Consequências, negativa final).
- **Cadeira indefinida em cinza chapado, igual à cadeira sem dono** — apresentada ao dono como a
  leitura mais fiel ao pedido original, rejeitada por ele: descartaria a informação de "de quem é
  hoje" que o modelo já produz, e é exatamente essa legibilidade que RF-127 exige.
- **Desenhar `cadeiras_ci95` como bolinhas extras até o topo da faixa** — descartada: quebraria o
  invariante de RF-125.1 (a soma deixaria de fechar em `total_cadeiras`) e não há como saber de
  quem seriam as cadeiras adicionais.
- **Desenhar `cadeiras_ci95` como hachura ou opacidade variável, sem bolinha extra** — descartada
  pela mesma razão de fundo (a faixa não diz de quem), e travada por teste: o `<svg>` com e sem
  `cadeiras_ci95` tem de sair byte a byte idêntico.
- **Ordenar as cunhas por espectro ideológico** — descartada: o produto não mede posição
  ideológica de partido (constituição § 2), e o desenho passaria a afirmar uma classificação que
  não existe nos dados.

## Cross-refs

- [ADR-0024](0024-paleta-editorial-por-partido.md) — origem de `sigla_lider` como cor da
  federação (partido-líder por votos nominais) e do fallback de cor ausente para `outros`; o
  hemiciclo consome o mesmo campo, sem reabrir a decisão.
- [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) — origem da distinção
  `cadeiras` vs `vagas_obtidas` (RF-125.1) e do tratamento de federação como uma agremiação; o
  hemiciclo desenha exatamente `cadeiras`, nunca `vagas_obtidas`.
- [ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md) — motivo pelo qual o cargo 6
  passou a somar ~6.110 pares (município × zona) e por que a trava de sanidade contra
  multiplicação de votos importa especificamente aqui.
- [ADR-0047](0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D1 — precedente direto do
  remédio `textForParty` para marcador de identidade com extensão zero, aplicado aqui à cadeira.
- [ADR-0048](0048-coropletico-substitui-cartograma-governador-estreia-senador.md) — a mesma
  sessão mediu o chunk do MapLibre em 285,3 KiB de 300 (RNF-007b), o dado que motiva este ADR a
  manter o hemiciclo em zero JS.
- `docs/nfr/accessibility.md` (RNF-035, linhas 19-60) — fundamento normativo do item 5 da Decisão
  e da tabela de 4 cores-base reprovadas no tema claro.
- `docs/nfr/performance.md` (RNF-007a/b/c) — orçamentos que não enxergam este widget; ver
  Consequências, negativa 1.
- `docs/specs/017-deputado-federal/spec.md` — RF-124 (linhas 152-164), RF-125.1 (linhas 183-196) e
  RF-127 (linhas 219-227) normatizam os dados que este ADR desenha; nenhum RF ali descreve o
  widget — lacuna a fechar por emenda subsequente (fora do escopo deste ADR).
- `api/model/cadeiras.py:31-37` — fundamento da correção de premissa do item 7 (coligação vedada
  desde a EC 97/2017; federação como uma agremiação).
- `api/model/cargos.py` (`TOTAL_CADEIRAS`, `VAGAS_EM_DISPUTA_2026`) — onde o tamanho da Câmara
  passou a ser declarado em 2026-09-19, ao lado das 81/54 do Senado; e
  `api/model/deputado_payload.py::conferir_total_de_cadeiras` — a conferência contra a soma dos
  `carg[].nv` das 27 UFs, com `_log("error")` + `_alert_slack` em `api/model/project.py`. Fonte da
  emenda no `## Status`.
- `docs/reference/regulatory.md` — a Resolução TSE 23.751/2026, que rege este pleito e sob a qual
  a Câmara tem 513 cadeiras, todas em disputa.
- `api/model/project.py:5644-5677` — a trava de sanidade do cargo proporcional (`check_zona_merge_
  sanity`) e o alarme `_alert_slack`, citados na Consequências negativa 2.
- `scripts/data/bandeiras-uf/PROVENIENCIA.md` — estado das 27 bandeiras (0/27), citado na
  Consequências negativa 3.
- Constituição § 2 (neutralidade política) — fundamento da ordem por tamanho de bancada, sem eixo
  ideológico (item 6 da Decisão).
- Constituição § 4 (acessibilidade) — fundamento do `role="img"` + `aria-describedby` duplo do
  SVG.
- Constituição § 6 (determinismo) — fundamento do arredondamento a 3 casas e do desempate
  explícito em Hare e na varredura de ângulos (item 2 da Decisão).
- Arquivos que implementam esta decisão: `components/blocks/CamaraHemiciclo.tsx`,
  `lib/utils/hemiciclo.ts`, `lib/utils/bancada.ts`,
  `app/(dep)/deputado-federal/page.tsx:87,426`.
- Testes: `tests/unit/components/CamaraHemiciclo.test.tsx`,
  `tests/unit/components/camara-hemiciclo-peso.test.tsx`, `tests/unit/lib/hemiciclo.test.ts`,
  `tests/unit/pages/deputado-federal-hemiciclo.test.tsx`, `tests/e2e/perf-budget.spec.ts`.
