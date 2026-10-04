---
id: ADR-0046
title: Série por candidato limitada por construção — forma colunar, teto de 120 pontos, elenco decidido no produtor, sem chave nova de Global Config
status: accepted
date: 2026-09-17
amends: 0032
---

# ADR-0046 — Série por candidato limitada por construção, não uma chave nova de Global Config

## Status

Aceito. Este ADR **emenda o ADR-0032** — não o supersede. O princípio central do ADR-0032 (resumo
limitado por construção fica em Global Config; detalhe que cresce com cobertura municipal ou com o
tempo decorrido de apuração vai para o Vercel Blob) permanece intacto e não é reaberto. O que este
ADR acrescenta é um **critério** que o ADR-0032 não precisou nomear porque, em 08/09, a série por
candidato ainda não existia como problema concreto: uma série que cresce com o tempo decorrido, mas
cujo crescimento é **limitado por construção** (teto duro de pontos, re-bucketizado, nunca cortado —
D2 abaixo), deixa de pertencer automaticamente ao lado "Blob" da divisória quando o escopo é nacional
em vez de por-UF. É a mesma divisória do ADR-0032, com um eixo a mais para decidir de que lado cada
série cai. Nasce da spec 020 ("Evolução da apuração", `docs/specs/020-evolucao-da-apuracao/spec.md`),
escrita na mesma sessão a partir de um protótipo visual e de cinco decisões do dono do produto.

## Contexto

As telas de Presidente, Governador e Senador vão ganhar um gráfico de linhas — uma por candidatura à
frente, fatia de votos no eixo vertical, horário do boletim no horizontal, alternando entre apurado e
projetado pelo `ViewModeSwitch` que já existe. Isso precisa de uma **série temporal por candidato**,
que hoje não existe em nenhum payload: `EdgePayloadUf.series_temporais` (`EdgeUfSeriesTemporais`,
`lib/edge-config/types.ts:912-919`) carrega `margem`, `p_vitoria` e `turnout` — três séries sobre a
**corrida**, cada uma um único array de `{ ts, valor }`, nunca um array por candidato. Publicar a
série nova é a primeira vez que o payload precisa resolver a forma de "N candidatos × M pontos", não
apenas de "M pontos".

Essa escolha esbarra numa decisão já registrada. O ADR-0032 (2026-09-08) tirou `municipios` e
`series_temporais` inteiros da chave de Global Config e os moveu para o objeto Blob de detalhe de UF
(`UfDetailBlob`, `lib/blob/uf-detail.ts:77-92`) exatamente pelo critério "detalhe que cresce com
cobertura municipal ou com o tempo decorrido de apuração" — e foi além, deixando resolvida de
antemão a pergunta que motiva este ADR: o comentário que ficou em
`lib/edge-config/types.ts:1042-1047` diz que a série por candidato, quando existisse, teria como
destino "o mesmo objeto Blob... nunca uma chave nova de Global Config", com a justificativa de que
"uma série por candidato multiplica o custo de `series_temporais` pelo número de candidatos".

Essa reserva foi escrita pensando só na página de UF. A spec 020 põe o widget também na home nacional
(tela T-01, entre o painel de Chances e o de Redutos) — um escopo que o mecanismo de Blob do
ADR-0032 não cobre (não existe Blob nacional; `EdgePayload`, `lib/edge-config/types.ts:599`, só vive
em Global Config) e onde o argumento "multiplica pelo número de candidatos" não pesa do mesmo jeito,
porque não há o termo ×27 UF que torna `municipios`/`series_temporais` proibitivos no ADR-0032. Reler
literalmente o ADR-0032 aplicaria a mesma proibição ao caso nacional sem nunca ter precificado esse
caso separadamente do caso por-UF — é essa lacuna que D3 fecha.

Duas outras perguntas bloqueiam qualquer implementação: qual critério decide as 4 candidaturas "à
frente agora" (D4), e se a cor da linha pode carregar rank como carregava antes do ADR-0024 aposentar
esse esquema (D5). As duas exigem que produtor (o orchestrator Python) e consumidor (o widget)
concordem antes que qualquer lado escreva código.

## Decisão

### D1 — Forma colunar, não array de objetos

A série é publicada como um eixo compartilhado — `eixo: string[]` de `dado_ts` ISO 8601, ordem ASC
(constituição § 6) — mais um array paralelo por candidato para cada base: `apurado: (number|null)[]`
e `projetado: (number|null)[]`, no lugar de um array de objetos `{ ts, pct }` por candidato. Medido
sobre JSON minificado, janela de 8h, 4 candidaturas × 2 bases:

| Forma | 480 pontos (sem teto) | 96 pontos (com D2, cadência 5 min) |
|---|---|---|
| Array de objetos `{ts, pct}` | 160.460 B | 32.356 B |
| Colunar (eixo + arrays paralelos) | 33.249 B | **6.905 B** |

O custo inteiro da forma antiga é a chave `"ts"` repetida 3.840 vezes (480 pontos × 4 candidatos × 2
bases) — a mesma string, byte a byte, guardada uma vez por candidato em vez de uma vez por ponto.

### D2 — Cadência adaptativa com teto duro de 120 pontos

`SERIE_MAX_PONTOS = 120`. A cadência é o menor valor de `[5, 10, 15, 30]` minutos tal que
`ceil(janela_min / cadência) ≤ 120`. O teto **re-bucketiza** — nunca corta o começo da noite. Cada
balde é representado pelo ponto de **maior `dado_ts`** dentro dele (o último), nunca pela média:
média suavizaria descontinuidades e poderia fazer uma quantidade quase-monotônica regredir, o que a
própria spec 020 proíbe como critério de aceitação (RF-168-b: "o balde é representado pelo **último**,
nunca pela média — média suavizaria descontinuidades e poderia fazer uma quantidade quase-monotônica
regredir"). O balde é derivado do **epoch de `dado_ts`**, não do índice do array, para que um ciclo
perdido não desloque os pontos anteriores — determinismo, constituição § 6.

Consequência: **teto por construção** — nenhuma noite de apuração, por mais longa que seja, publica
uma série por candidato maior que o pior caso abaixo, porque o número de pontos nunca passa de 120
independentemente de quantas horas a contagem durar.

> ⚠️ **Emenda de 2026-09-17 (Fase 2): não existe teto constante em BYTES.**
>
> Este parágrafo dizia **8.553 B por corrida, para sempre**. Medido contra o emissor real
> (`montar_serie_por_candidato`, JSON minificado, 4 candidaturas × 2 bases), com **todo** valor no
> comprimento máximo de um percentual 0–100 com duas casas (`12.34` — cinco caracteres):
>
> | Grade | Piso (nome 4, sem `sqcand`) | Teto (nome 30, `sqcand` 12) |
> |---|---|---|
> | 120 pontos (grade cheia) | 8.822 B | **9.066 B** |
> | 96 pontos (a noite real, ~8 h) | 7.118 B | 7.362 B |
>
> **O número depende do comprimento do nome de urna**, que é dado do TSE (campo de até 30
> caracteres) e não está sob nosso controle. Por isso nenhum número único serve como teto — 8.553 B
> era uma estimativa apresentada como garantia, e é assim que ela envelheceu mal.
>
> 🔴 **A primeira tentativa de emenda, no mesmo dia, errou de novo e registra a armadilha**: mediu
> 8.775 B usando valores aleatórios passados por `round(x, 2)`, sem notar que `round(41.2, 2)`
> devolve `41.2` — quatro caracteres. Boa parte dos 960 valores encolhia e o total saía otimista.
> **Ao medir tamanho de payload, force o pior caso de cada campo; não confie em amostra aleatória.**
>
> Consequência prática do número certo: o limiar de 9.000 B do teste de propriedade T6 **era
> violado por dado real** (120 pontos com nome de urna de 28 caracteres dá 9.058 B), e ninguém viu
> porque a fixture nunca encostou em nome realista.
>
> **Nada disso muda a operação**: a folga do Global Config até o limiar de erro do writer
> (940.000 B) é de ~521 KB. E o teto **por construção** (≤ 120 pontos) segue verdadeiro — é ele, e
> não a contagem de bytes, que sustenta a decisão D3.

A cadência de 5 minutos não é nova no projeto: `SERIE_PASSO_MIN = 5`
(`data-pipeline/simulacao-gerar.ts:2820`) e `CADENCIA_MIN = 5` (`app/(sen)/uf/[sigla]/senador/page.tsx:72`)
já usam o mesmo valor. A justificativa aqui não é só de peso — é de densidade de pixel. A coluna da
rota de UF mede `--container-sidebar: 400px` (`app/globals.css:108`); com `padX=32` sobram 336px de
área útil de gráfico. 480 pontos dariam 0,7 px por ponto — sub-pixel, invisível como linha contínua.
A 5 min (96 pontos numa janela de 8h) são 3,5 px/ponto, a primeira cadência da lista onde o traço tem
alguma chance de ser lido como linha, não como ruído.

### D3 — Destino por escopo: UF no Blob que já existe, nacional em campo novo dentro do payload que já existe

Série por UF entra em `UfDetailBlob.series_temporais.por_candidato`
(`lib/blob/uf-detail.ts:77-92`) — o mesmo objeto Blob que o ADR-0032 já criou, sem esquema novo, sem
caminho novo. Série **nacional** entra num campo novo (`serie_por_candidato`) dentro do `EdgePayload`
da chave de Global Config **que já existe** (`lib/edge-config/types.ts:599`) — não numa chave nova.

A conta que decide, por escopo:

- **UF em Global Config (rejeitada).** 27 UF × 3 cargos (Presidente, Governador, Senador) × 6.905 B
  (D1, 96 pontos) = **559.305 B** adicionais. O store nacional está hoje em ~410 KB; somar isso leva o
  total a ~969 KB — acima do limiar de erro `GLOBAL_CONFIG_STORE_CRITICAL_BYTES = 940_000`
  (`lib/edge-config/writer.ts:339`) e a ~31 KB do teto duro
  `GLOBAL_CONFIG_STORE_LIMIT_BYTES = 1_000_000` (`lib/edge-config/writer.ts:300`). Escrita **recusada**
  na noite de 04/10, exatamente quando o dado mais importa — o mesmo padrão de falha que o ADR-0032 já
  documentou para `municipios`.
- **Nacional em Global Config (aceita).** +6.905 B sobre os ~17.301 B que o payload nacional já
  ocupa hoje, levando-o a ~24.206 B — bem abaixo do `EDGE_CONFIG_NATIONAL_WARN_BYTES` de 75 KB
  (`lib/edge-config/writer.ts:388`).
- **Blob nacional novo (rejeitada).** Custaria um helper de caminho novo, um módulo de leitura novo,
  um ramo novo no writer, um `Promise.all` novo na rota de maior tráfego do produto (a home) e um
  segundo `ts` de frescor a explicar ao leitor, ao lado de `dado_ts` (ADR-0038) — quatro módulos e uma
  superfície de falha nova, para poupar 6,9 KB num store que hoje tem ~583 KB livres antes de bater no
  limiar de erro.

**Este é o ponto em que este ADR reabre o ADR-0032, e a reabertura precisa ser explícita.** A
*letra* do ADR-0032 — "nunca uma chave nova de Global Config" — é respeitada: `serie_por_candidato`
é um campo dentro de uma chave que já existe, não uma chave nova (mesmo padrão que o ADR-0038 já usou
para `dado_ts`/`pares_atrasados`, campos aditivos na chave existente). O *espírito* do ADR-0032 —
"detalhe que cresce com o tempo vai para onde o volume não ameaça o store inteiro" — precisa do
critério novo que D2 introduz: uma série cujo crescimento tem **teto duro por construção** (120
pontos, nunca mais, D2) não cresce da mesma forma que `municipios` (que cresce com cobertura, sem
teto, até 100% dos 5.572 municípios) ou que a série por-UF (que multiplica por 27). No escopo
nacional, sem o multiplicador de UF, o teto duro de D2 é pequeno o bastante para caber folgado no
orçamento por chave (`EDGE_CONFIG_NATIONAL_WARN_BYTES`, 75 KB) sem se aproximar do orçamento de store
inteiro que motivou o ADR-0032. No escopo por-UF, o multiplicador de 27 continua valendo, e a série
por candidato continua no Blob — a divisória do ADR-0032 não muda de lado para esse caso. O
ADR-0032 estava certo sobre o volume que conhecia (municípios, sem teto); não tinha como prever um
tipo de detalhe com teto duro por construção, porque esse tipo não existia como problema em 08/09.

### D4 — Elenco decidido no produtor, pelo mesmo comparador da tela

As 4 candidaturas são escolhidas no Python, a cada ciclo, pelo comparador `pct_atual desc →
pct_projetado desc → candidato_id asc` — o mesmo comparador de `rankByParcial`, hoje triplicado em
`app/(pres)/uf/[sigla]/page.tsx:267`, `app/(gov)/uf/[sigla]/governador/page.tsx:209` e
`app/(sen)/uf/[sigla]/senador/page.tsx:154`, e a ser extraído para `lib/utils/rank-parcial.ts`. **Não**
é o rank que o Python já calcula em `api/model/project.py:3155-3157` (`ordered = sorted(rows, key=lambda
r: float(r.get("pct_projetado") or 0.0), reverse=True)`) para identificar líder/segundo — aquele
ordena só por `pct_projetado`. Usar esse rank faria o elenco do gráfico divergir das primeiras linhas
do painel de resultado logo acima, e a divergência só apareceria quando apurado e projetado
discordassem de ordem — isto é, exatamente na noite de apuração, exatamente quando alguém está
olhando os dois ao mesmo tempo.

O consumidor **não re-ordena**: renderiza na ordem recebida. A ordem do array vira contrato entre
produtor e widget.

Por que a escolha é do produtor, não da tela: para a tela escolher em runtime, o payload teria que
carregar todos os candidatos, não só 4 — 12 candidatos em forma colunar a 96 pontos = 14.809 B contra
6.905 B de 4 candidatos — e mesmo assim a tela não teria como reconstruir a série de quem não veio no
payload. A decisão de elenco só pode ser tomada por quem tem acesso ao histórico completo, e esse é o
orchestrator, não o cliente.

Regra de desenho: os 4 do **último** ponto (ciclo corrente), com a série **completa** deles desde o
início da janela — não 4 séries que começam em pontos diferentes conforme cada um entrou no top-4.

### D5 — Cor e rank são eixos distintos

O rank escolhe **quem entra** no gráfico (D4); o partido escolhe **de que cor** a linha é, via
`colorForParty(candidato.partido)` (`lib/utils/party-color.ts:203`). O widget **não** consome o campo
`cor` do payload (`EdgeCandidate.cor`, `lib/edge-config/types.ts:264`), que ainda publica
`var(--color-cand-{rank})` (`api/model/project.py:3750`) — a cor por rank que o ADR-0024 aposentou em
favor de uma paleta editorial estável por partido/federação (ΔE76 ≥ 10 contra o hex oficial, elevado
a ≥ 12 pelo ADR-0031 para separação entre partidos). Consumir `cor` aqui reintroduziria o defeito no
único componente do produto onde ele seria visível como **movimento**: a linha trocaria de cor ao
vivo, no meio da noite, no exato momento de uma ultrapassagem — o cenário que o color lock do
ADR-0013 existia para evitar e que o ADR-0024 eliminou por construção (cor fixa por partido, não
recalculada por rank). Isso não conflita com o elenco dinâmico de D4: quem entra e sai do gráfico é
uma pergunta de rank; de que cor cada um que está lá é uma pergunta de partido. São eixos ortogonais,
e o payload já carrega os dois separadamente (`candidato_id`/rank de um lado, `partido` do outro).

> ⚠️ **Emenda de 2026-09-18 ([ADR-0047](0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D1):
> a variante do token muda; a fonte da cor, não.** O resolvedor escrito acima —
> `colorForParty(candidato.partido)` — devolve `--party-<sigla>`, a cor de **identidade**, calibrada
> como cor de **área**. O que o widget desenha é um traço de 1,5–2,5 px, que é objeto gráfico: WCAG
> 2.1 SC 1.4.11, piso **3:1**. Medido contra `--surface-page` (#f3f4f6), quatro bases reprovam esse
> piso — PSOL 2,08:1, PSB 2,19:1, o fallback `outros` 2,39:1 e NOVO 2,72:1. Por decisão do dono, o
> componente passa a resolver a cor por **`textForParty`** (`--party-<sigla>-text`, a mesma matiz
> noutra intensidade), que leva os quatro a ~4,5:1 e, em **17 dos 31 partidos, é a própria base** —
> PT, PL e UNIÃO entre eles, nenhum pixel muda no tema claro.
>
> **Tudo o que D5 protege continua intacto**: `textForParty` também deriva da **sigla do partido**,
> o widget segue sem consumir `EdgeCandidate.cor`/`var(--color-cand-{rank})`, e a linha continua sem
> trocar de cor numa ultrapassagem. Muda **qual variante do token do partido** é usada, não de onde
> a cor vem. O custo (oito tokens mais pálidos no tema escuro, sem que contraste exigisse) está
> medido e registrado no ADR-0047.

> ⚠️ **Emenda de 2026-10-04 (decisão do dono): o gráfico ganhou chave própria.** A alternância
> apurado/projetado deixou de ser do `ViewModeSwitch` do shell: o widget tem uma chave
> "Apuração | Projeção" independente (`SerieBaseAlternavel.tsx`, abre em Apuração), e os grupos
> passaram de `data-view-only` para `data-serie-only`. O formato da série, o teto e a régua única
> não mudam. Detalhe no RF-172 da spec 020.

## Consequência de produto, registrada explicitamente

Com D4, a candidatura que cai do top-4 desaparece do gráfico **inclusive do seu próprio passado**, e
a ultrapassagem que a derrubou fica invisível: vê-se o resultado dela (ela não está mais na linha),
não o evento (o momento em que a linha que a superou cruzou a dela). Isso não é um efeito colateral
de D1–D3 (forma/volume/destino) nem de D5 (cor) — é consequência direta de D4, uma decisão de produto
do dono, tomada com essa consequência já nomeada e aceita (spec 020, "Decisões do dono", D-A).
Mitigado por rótulo explícito ("as 4 candidaturas à frente agora") e pela tabela acessível que RF-176
exige ao lado do gráfico; **não resolvido** — não há versão deste desenho que mostre a ultrapassagem
sem também mostrar quem caiu, e mostrar quem caiu exigiria abandonar o teto de 4 linhas que motiva
D4 em primeiro lugar.

## Alternativas rejeitadas

- **Array de objetos `{ts, pct}` por candidato (D1).** Rejeitada: 4,8× mais pesado que a forma
  colunar a 480 pontos, 4,7× a 96 pontos — o custo inteiro é a chave `"ts"` repetida por ponto em vez
  de uma vez por candidato.
- **Cortar os pontos mais antigos ao bater o teto, em vez de re-bucketizar (D2).** Rejeitada:
  apagaria o começo da noite — exatamente o trecho que mostra quem largou na frente antes de o Norte/
  Nordeste apurar, um dos dois eventos que a spec 020 existe para mostrar.
- **Representar cada balde pela média dos pontos que caem nele (D2).** Rejeitada: suaviza
  descontinuidades reais e pode fazer uma grandeza quase-monotônica (percentual apurado) regredir
  entre dois baldes — a spec 020 proíbe isso explicitamente como critério de aceitação (RF-168-b).
- **Bucket derivado do índice do array em vez do epoch de `dado_ts` (D2).** Rejeitada: um ciclo
  perdido deslocaria todos os pontos publicados depois dele, quebrando o determinismo que a
  constituição § 6 exige — o mesmo ponto que já rejeitou o índice como fonte de bucket noutras partes
  do pipeline.
- **Série por UF em Global Config (D3).** Rejeitada: 559.305 B adicionais levam o store de ~410 KB a
  ~969 KB, acima do limiar de erro de 940.000 B e a 31 KB do teto duro de 1 MB — escrita recusada na
  noite de 04/10.
- **Objeto Blob nacional novo (D3).** Rejeitada: quatro módulos novos (caminho, leitura, escrita,
  fetch paralelo na rota de maior tráfego) e um segundo relógio de frescor, para poupar 6,9 KB num
  store com ~583 KB de folga antes do limiar de erro.
- **Elenco escolhido pelo rank que o Python já calcula por `pct_projetado` (D4).** Rejeitada: divergiria
  do painel de resultado (que ordena por `pct_atual`) exatamente quando apurado e projetado discordam
  de ordem — isto é, na noite de apuração, quando alguém está olhando os dois painéis ao mesmo tempo.
- **Elenco escolhido pela tela, a partir de todos os candidatos publicados (D4).** Rejeitada: exigiria
  publicar a série de todos, não só 4 — 12 candidatos custam mais que o dobro de 4 (14.809 B contra
  6.905 B) — e mesmo assim a tela não teria a série de quem não veio, então "escolher na tela" não é
  sequer possível sem já ter pago o custo que a escolha existe para evitar.
- **Consumidor reordena o array recebido (D4).** Rejeitada: quebraria o contrato "ordem do array =
  ordem de exibição" e reabriria, no cliente, uma decisão que já foi tomada no produtor com acesso a
  mais informação (histórico completo) do que o cliente tem.
- **Widget consome `EdgeCandidate.cor` (`var(--color-cand-{rank})`) (D5).** Rejeitada: reintroduz cor
  por rank no único lugar do produto onde a troca de cor seria visível como movimento ao vivo — o
  defeito que o ADR-0024 eliminou por construção ao aposentar o ADR-0013.

## Consequências

**Positivas**:
- A forma colunar (D1) e o teto de 120 pontos (D2) juntos fixam um custo máximo **conhecido e
  limitado** por série publicada (8.822–9.066 B; ver a emenda acima — o custo é limitado, mas não
  constante, porque depende do nome de urna), o que nunca existiu para nenhuma série temporal do
  projeto até agora — `EdgeUfSeriesTemporais` (margem/p_vitoria/turnout) não tem teto declarado hoje.
- D3 resolve a tensão entre "a letra do ADR-0032 proíbe chave nova" e "o espírito do ADR-0032 proíbe
  volume que ameace o store inteiro" nomeando o critério que faltava (teto duro por construção muda
  de que lado da divisória um detalhe cai) — sem abrir uma terceira forma de armazenamento e sem
  reescrever nenhuma decisão do ADR-0032 sobre `municipios` ou sobre a série por UF.
- D4 mantém o elenco do gráfico consistente com o painel de resultado que fica logo acima dele na
  mesma tela, em vez de introduzir uma segunda fonte de verdade sobre "quem está na frente" que pode
  divergir da primeira exatamente quando isso mais confundiria o leitor.
- D5 evita reabrir, no único widget do produto onde seria visível como movimento ao vivo, um defeito
  que o ADR-0024 já eliminou por construção em todo o resto da UI.
- Zero infraestrutura nova: reaproveita o Blob do ADR-0032, a chave de Global Config já existente, o
  `colorForParty` do ADR-0024 (desde a emenda de 18/09, a variante `textForParty` do mesmo token de
  partido — ADR-0047 D1), e o comparador que a tela já usa — a única peça de código genuinamente
  nova é o cálculo da série em si (bucketização + seleção de elenco no produtor).

**Negativas**:
- **A candidatura que cai do top-4 desaparece do gráfico inclusive do seu próprio passado, e a
  ultrapassagem que a derrubou fica invisível como evento** (ver seção dedicada acima) — não
  resolvido, consequência direta e aceita de D4.
- `rankByParcial` continua triplicado no momento desta decisão (três arquivos, três implementações
  idênticas) — este ADR nomeia a extração para `lib/utils/rank-parcial.ts` como necessária para D4
  não criar uma **quarta** cópia no orchestrator Python (que precisa do mesmo comparador, só que em
  Python), mas não a executa; fica para a implementação da spec 020.
- O comparador de D4 precisa ser **portado para Python** com paridade exata ao TypeScript
  (`pct_atual desc → pct_projetado desc → candidato_id asc`) — divergência de precisão de ponto
  flutuante ou de critério de desempate entre as duas linguagens produziria um elenco diferente do
  rank exibido na tela, silenciosamente, sem erro nem teste que capture por si só a divergência.
- D3 resolve o caso nacional hoje, com o volume medido hoje (4 candidatos, 96 pontos, 6.905 B). Se o
  teto de D2 mudar (`SERIE_MAX_PONTOS` subir) ou se o produto decidir publicar mais de 4 candidatos no
  nacional no futuro, a conta de D3 precisa ser refeita — este ADR não garante que o campo cabe sob
  qualquer teto futuro, só sob o teto que D2 fixa agora.
- O campo `cor` do payload (`var(--color-cand-{rank})`) continua sendo escrito pelo Python
  (`api/model/project.py:3750`) sem nenhum consumidor migrado por este ADR além do widget novo — os
  componentes que ainda leem `cor` diretamente (fallback do ADR-0024, pré-migração) continuam expostos
  ao mesmo risco de cor-por-rank que este ADR evita só para o widget novo, não para o produto inteiro.
- O nacional em Global Config (D3) soma ao payload que a home já lê no servidor a cada requisição —
  não é uma leitura nova (D3 evita isso deliberadamente), mas é mais 6.905 B por resposta na rota de
  maior tráfego do produto, não medido aqui em termos de latência (RNF-002), só de tamanho de payload.

## Cross-refs

- [ADR-0032](0032-detalhe-municipal-vercel-blob.md) — emendado por este ADR: a divisória
  resumo-limitado-por-construção (Global Config) vs. detalhe-que-cresce (Blob) ganha o critério de
  teto duro por construção (D2/D3), sem mudar o destino de `municipios` nem da série por UF.
- [ADR-0001](0001-edge-config-no-read-path.md) — Edge Config/Global Config no read path; nenhum novo
  ponto de leitura Postgres é introduzido por este ADR.
- [ADR-0011](0011-cadencia-60s.md) — a cadência de 60s do modelo é o piso a partir do qual D2 deriva
  cadências maiores (5/10/15/30 min) para a série publicada; a série não é publicada por ciclo, é
  agregada por balde.
- [ADR-0012](0012-edge-config-chaves-nomeadas.md) — nenhuma chave nova: `serie_por_candidato` (D3)
  entra na chave nacional nomeada que já existe.
- [ADR-0017](0017-transparencia-total-3-camadas.md) — precedente de "nunca sai do DOM" aplicado aqui
  à candidatura que cai do top-4: ela sai da **série**, mas RF-176 (spec 020) mantém a tabela
  acessível completa como registro, não o esconde do leitor de tela.
- [ADR-0024](0024-paleta-editorial-por-partido.md) — base de D5: cor por partido/federação, não por
  rank; `EdgeCandidate.cor`/`var(--color-cand-{rank})` mantido só por compatibilidade, não consumido
  pelo widget novo.
- [ADR-0031](0031-piso-separacao-entre-partidos.md) — piso de separação perceptual (ΔE76 ≥ 12) entre
  as cores de partido que D5 reaproveita via `colorForParty` — e, desde a emenda de 18/09
  (ADR-0047 D1), via `textForParty`, gerada sob o mesmo piso de separação.
- [ADR-0038](0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — `dado_ts` é o relógio que compõe o
  eixo `eixo: string[]` de D1/D2; a série usa a hora do boletim do TSE, não a hora em que o modelo
  rodou. Desde o [ADR-0047](0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D2 (18/09),
  ciclo **sem** `dado_ts` não entra no eixo de forma alguma — não há `COALESCE` para o relógio de
  cálculo, nem na leitura nem no ponto corrente.
- Constituição § 2 (neutralidade política — base do ADR-0024/0031 que D5 aplica), § 6 (determinismo —
  bucket derivado de epoch, não de índice, D2), § 9 (stack 100% Vercel — nenhuma infraestrutura nova):
  [../../constitution.md](../../constitution.md)
- `docs/specs/020-evolucao-da-apuracao/spec.md` — spec que motiva este ADR; RF-167 a RF-176 dependem
  diretamente de D1–D5.
- `lib/edge-config/types.ts` (`EdgePayload:599`, `EdgePayloadUf:977`, `EdgeUfSeriesTemporais:912-919`,
  comentário de reserva `:1034-1047`) — campo novo `serie_por_candidato` a adicionar em `EdgePayload`;
  schema Python↔TypeScript a manter em paridade.
- `lib/blob/uf-detail.ts` (`UfDetailBlob:77-92`) — campo novo `por_candidato` dentro de
  `series_temporais`.
- `lib/edge-config/writer.ts` (`GLOBAL_CONFIG_STORE_CRITICAL_BYTES = 940_000:339`,
  `GLOBAL_CONFIG_STORE_LIMIT_BYTES = 1_000_000:300`, `EDGE_CONFIG_NATIONAL_WARN_BYTES:388`) — base da
  conta de D3.
- `api/model/project.py` (rank por `pct_projetado`, `:3155-3157`; `cor` por rank, `:3750`) — o rank que
  D4 explicitamente **não** reaproveita; o campo `cor` que D5 explicitamente **não** consome.
- `app/(pres)/uf/[sigla]/page.tsx:267`, `app/(gov)/uf/[sigla]/governador/page.tsx:209`,
  `app/(sen)/uf/[sigla]/senador/page.tsx:154` — as três cópias de `rankByParcial` que D4 reaproveita e
  que a implementação da spec 020 deve extrair para `lib/utils/rank-parcial.ts` (não existe hoje).
- `lib/utils/party-color.ts:203` (`colorForParty`) — resolvedor de cor que D5 exigia até 18/09;
  desde a emenda (ADR-0047 D1) o widget usa `textForParty` (`:277`), a variante legível do **mesmo**
  token de partido. A fonte da cor (a sigla) não mudou.
- `app/globals.css:108` (`--container-sidebar: 400px`) — base da justificativa de densidade de D2.
- `data-pipeline/simulacao-gerar.ts:2820` (`SERIE_PASSO_MIN = 5`), `app/(sen)/uf/[sigla]/senador/page.tsx:72`
  (`CADENCIA_MIN = 5`) — precedentes já existentes da cadência de 5 min escolhida em D2.
