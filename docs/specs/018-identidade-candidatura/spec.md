---
id: 018-identidade-candidatura
title: Identidade de candidatura 2026 — nome, foto e partido
status: draft
priority: M
personas: [P1, P2, P3]
screens: [T-13, T-14]
requirements: [RF-140, RF-141, RF-142, RF-143, RF-144, RF-145, RF-146, RF-147, RF-148, RF-149, RF-150, RF-151, RF-152, RF-214]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 016-senador, 017-deputado-federal]
apis: []
components: [CandidatoAvatar, CandidatoCard, CandidatosGrid, CandidatosFiltros, CandidaturasFonte, Panel, Footer]
nfr: [RNF-002, RNF-003, RNF-007a, RNF-019, RNF-022, RNF-023, RNF-024]
adrs: [0039, 0040, 0041, 0042, 0058]
amends: [016-senador, 017-deputado-federal]
ship_blocked_on: []
---

# Spec 018 — Identidade de candidatura 2026

**Rota nova**: `/candidatos`
**Superfícies emendadas**: o estado "aguardando dados" das quatro páginas de
cargo, e o contrato `EdgeUfRow.top_candidatos` das specs 016 e 017.
**Fonte**: Portal de Dados Abertos do TSE, licença cc-by
([ADR-0039](../../architecture/adrs/0039-portal-dados-abertos-tse-identidade-candidatura.md)).

## Status

`draft`. Escrita em 2026-09-13, no mesmo dia dos quatro ADRs que a governam
(0039–0042) e sobre as medições feitas naquele dia contra os arquivos reais do
TSE. **Nenhuma linha de código desta spec existe**: não há tabela de
candidaturas, não há `putBinary`, não há imagem em `app/` nem em `components/`,
e `api/model/project.py:2810` e `:3275` continuam escrevendo
`f"Candidato {id}"`.

Esta spec **não decide de novo** o que os quatro ADRs já decidiram. Ela
especifica o comportamento que decorre deles, em EARS, e fixa por escrito as
cinco coisas que os ADRs deixam para a implementação: onde o nome entra no
payload, qual é a forma nova de `top_candidatos`, a cadeia de resolução de nome
degrau a degrau, onde os dados moram, e o que a tela pode e não pode fazer.

## Objetivo

Em 04/10/2026 nenhuma tela deste produto pode dizer "Candidato 13 lidera". O
leitor quer saber **quem** está ganhando — nome, partido, rosto —, e hoje o
sistema não tem, em lugar nenhum, uma estrutura que ligue número de urna a
pessoa. O gap é estrutural, não um defeito de um caminho de código.

Antes disso — no mês inteiro em que ainda não há voto —, as quatro páginas de
cargo exibem um parágrafo honesto dizendo que o primeiro boletim não chegou, e
mais nada. A mesma base que conserta o "Candidato 13" enche esse vazio com a
informação que já existe e já é pública: **quem está concorrendo**.

## Escopo

### Dentro

- Importação recorrente de `consulta_cand_2026.zip` + `consulta_cand_complementar_2026.zip`
  (20.939 candidaturas, join 1:1 por `SQ_CANDIDATO`, zero linha faltando) e dos
  28 `foto_cand2026_<UF>_div.zip`.
- **Nome, foto e partido.** Só isso.
- Regra de publicabilidade fail-closed (ADR-0040) e o texto de situação de
  julgamento ao lado da candidatura.
- Chave de identidade `(cargo, uf, numero)` + `sqcand`, com a função de
  resolução determinística do ADR-0042 item 5.
- Enriquecimento de `EdgeUfRow.top_candidatos` com `nome`, `partido` e `sqcand`
  — **emenda aos contratos das specs 016 e 017**.
- Rota `/candidatos`, com filtro por cargo e UF e busca por nome.
- Grade de candidaturas dentro do estado "aguardando dados" de cada página de
  cargo.

### Fora

- **A ficha do candidato** — idade, ocupação, bens declarados, patrimônio,
  redes sociais. Decisão de escopo do dono do produto, registrada no ADR-0039;
  o CSV traz parte desses campos e "está disponível" não significa "deve
  entrar".
- **Qualquer PII.** `NR_CPF_CANDIDATO`, `DS_EMAIL` e
  `NR_TITULO_ELEITORAL_CANDIDATO` existem no CSV de 50 colunas e não são
  mapeados, não transitam por estrutura intermediária, não chegam a Postgres,
  Blob, Edge Config, log ou resposta HTTP (constituição § 5, RNF-019).
  ⚠️ O EA20 também carrega `cand[].dt` (data de nascimento,
  `lib/tse/ea20-schema.ts:83`), que continua sendo persistido **cru** no
  snapshot porque a constituição § 1 proíbe alterar o dado oficial — e que
  **não** pode ser derivado para nenhuma superfície desta spec.
- ~~**Deputado Estadual e Distrital** (11.276 candidaturas). Fora do escopo do
  produto por `lib/config/cargos.ts`.~~ ⚠️ **Superado em 2026-09-29 pela
  [spec 027](../027-deputado-estadual-distrital/spec.md)** (RF-288): as candidaturas de cargo 7/8
  entram no cadastro, no publicador e em `/candidatos` a partir da reimportação de 02–03/10.
- **Vice e suplente.** Ver open question 3 — é o único item deste bloco que
  ainda não está fechado.
- **Uma 5ª aba no `CargoTabs`.** Não cabe: o rótulo "Deputado Federal" já
  precisou ser encurtado para caber em 1/4 de 430px
  (`components/layout/CargoTabs.tsx`, comentário do item `dep`). `/candidatos`
  é rota de nível superior, como `/sobre-o-modelo`.
- **`motivo_cassacao_2026.zip` como filtro.** 743 dos 988 candidatos citados
  nele continuam na urna (ADR-0040).

## O universo, medido em 2026-09-13

Estes números são a evidência da spec. Vieram de contagem sobre os arquivos
reais gerados pelo TSE em 12/09/2026, não de documentação nem de estimativa.

| | registradas | publicáveis (na urna) |
|---|---:|---:|
| Presidente (cargo 1) | 13 | **12** |
| Governador (cargo 3) | 200 | **180** |
| Senador (cargo 5) | 319 | **285** |
| Deputado Federal (cargo 6) | 7.791 | **7.221** |
| **total nos cargos do produto** | 8.323 | **7.698** |
| Deputado Estadual (fora do escopo) | 11.276 | — |
| **universo do arquivo** | **20.939** | 19.407 |

- **1.532 candidaturas (7,3%)** estão registradas e **fora da urna**. Não
  aparecem em tela nenhuma.
- **743 candidaturas estão na urna com registro indeferido sob recurso.** Elas
  recebem voto de eleitor real em 04/10. Aparecem, com a situação ao lado
  (RF-141).
- `NM_URNA_CANDIDATO`: máximo de 30 caracteres, **nunca vazio** — 0 ocorrências
  de vazio em 20.939 linhas.
- `SQ_CANDIDATO`: 11 ou 12 dígitos → `bigint` no Postgres, **`string`** em TypeScript
  e no payload (o mesmo cuidado que `api/model/deputado.py` já toma).
- Fotos: o ensaio no Acre deu **387 fotos para 387 candidaturas**, join 1:1 por
  `SQ_CANDIDATO`, zero órfã, zero nome fora do padrão `F<UF><SQ>_div.jpg`.
  JPEG **161×225 px**, 4,8–7,7 KB cada.
- Colisões de `(cargo, uf, numero)`: **52** brutas, **4** depois do filtro de
  publicabilidade — todas cargo 6 na Bahia, sob recurso, dois pares com o
  **mesmo nome** no mesmo número (`6|BA|2727` MARLI LIMA; `6|BA|2717` BRUNO
  ELIAS).

## Requisitos Funcionais

### Ingestão e dado

**RF-140 — Ingestão do cadastro de candidaturas, dois pacotes unidos por `SQ_CANDIDATO`**

WHEN o importador de candidaturas roda, the system SHALL baixar
`consulta_cand_2026.zip` e `consulta_cand_complementar_2026.zip` do Portal de
Dados Abertos, uni-los 1:1 por `SQ_CANDIDATO`, e persistir **somente** os campos
do recorte do [ADR-0039](../../architecture/adrs/0039-portal-dados-abertos-tse-identidade-candidatura.md)
— nome, nome de urna, número, cargo, UF, partido, federação, coligação, situação
de julgamento e publicabilidade.

**Aceitação**:
- Given os arquivos gerados em 12/09/2026, when o importador roda, then persiste
  **20.939** linhas, todas com `sqcand` distinto, e **zero** linha do arquivo
  principal sem par no complementar.
- Given uma linha sem par no join, when o importador a encontra, then o ciclo
  **falha com erro nomeado** e nada é publicado — o join 1:1 é premissa medida,
  não esperança; degradar aqui em silêncio publicaria candidatura sem situação.
- Given qualquer destino de escrita (Postgres, Blob, log estruturado, resposta
  HTTP), when o conteúdo é serializado, then as strings `cpf`, `email` e
  `titulo` **não ocorrem** — **asserção negativa**, porque a positiva ("os
  campos certos estão lá") passa com os errados presentes ao lado
  (constituição § 5, RNF-019).
- Given `CD_SITUACAO_CANDIDATURA` (`-3`) e `DS_SITUACAO_CANDIDATURA` (`#NE`) —
  que valem para **100%** das 20.939 linhas do arquivo principal —, when o
  parser lê, then ele **não** deriva publicabilidade nem texto de situação
  deles. Idem para `DS_SITUACAO_CANDIDATO_URNA`,
  `DS_SITUACAO_CANDIDATO_PLEITO`, `DS_SITUACAO_CASSACAO`,
  `NM_TIPO_DESTINACAO_VOTOS` e `DS_SIT_TOT_TURNO`, todos medidos em 100%
  `#NE`/`#NULO`.
- Given a checagem de frescor, when o importador pergunta se o arquivo mudou,
  then usa `GET` com `Range: bytes=0-1023` (`HEAD` devolve 403) e lê o
  `Last-Modified` **da resposta do arquivo**, nunca o `last_modified` do
  catálogo CKAN — que registra 22/07 e 03/08, datas anteriores ao prazo de
  registro de candidatura, e é comprovadamente metadado morto.

**RF-141 — Publicabilidade fail-closed; situação de julgamento é texto, nunca filtro**

WHEN o sistema decide se uma candidatura pode ser publicada, the system SHALL
publicá-la **se e somente se** `ST_CANDIDATO_INSERIDO_URNA === "SIM"`, tratando
qualquer outro valor — `"NÃO"`, string vazia, valor não reconhecido ou ausência
de linha — como não publicável; AND WHEN uma candidatura publicável tem
`DS_SITUACAO_JULGAMENTO` diferente de `DEFERIDO`, the system SHALL exibir esse
texto ao lado dela, sem nunca usá-lo como segundo filtro.

**Aceitação**:
- Given as 20.939 linhas, when a regra é aplicada, then **19.407** são
  publicáveis e **1.532** não; restritas aos quatro cargos cobertos, **7.698**
  são publicáveis.
- Given uma candidatura com `ST_CANDIDATO_INSERIDO_URNA` ausente ou com valor
  desconhecido, when a regra roda, then o resultado é `false` — não existe
  caminho de "assumir SIM na dúvida", e o teste injeta os três casos
  (`""`, `"TALVEZ"`, linha ausente) um a um.
- Given as **743** candidaturas na urna com registro indeferido sob recurso,
  when a tela renderiza, then elas **aparecem**, com o texto de situação
  visível — excluí-las mentiria por omissão sobre quem recebe voto; publicá-las
  sem ressalva mentiria por generalização.
- Given `motivo_cassacao_2026.zip`, when a publicabilidade é decidida, then esse
  arquivo **não participa** — 743 dos 988 candidatos citados nele continuam na
  urna, e usá-lo como filtro produziria exclusão indevida em massa.
- Given a tela, when exibe qualquer lista de candidaturas, then também exibe o
  aviso de que a lista muda até o fim da apuração (RF-150).

**RF-142 — Foto de candidato no Blob, binária, cache de um ano**

WHEN o importador processa uma UF, the system SHALL baixar
`foto_cand2026_<UF>_div.zip`, casar cada arquivo `F<UF><SQ>_div.jpg` com o
`sqcand` correspondente, e gravar no Vercel Blob em
`candidatos/foto/<UF>/<sqcand>.jpg` via `putBinary` com
`cacheControlMaxAge = BLOB_IMMUTABLE_MAX_AGE_SECONDS` (31.536.000 s),
**exclusivamente** para candidatura publicável em um dos quatro cargos cobertos.

**Aceitação**:
- Given o ZIP do Acre, when o importador roda, then casa **387 fotos com 387
  candidaturas**, 1:1, e não sobra órfã de nenhum lado.
- Given uma foto cujo `sqcand` não existe no cadastro, when encontrada, then é
  **logada e descartada**, nunca gravada — e a contagem de descartes entra no
  relatório do ciclo.
- Given uma candidatura com `publicavel = false`, when o importador roda, then
  **nenhuma** foto é escrita para ela — asserção negativa sobre o conjunto de
  caminhos gravados; a foto segue a mesma fronteira de "quem existe" do
  RF-141, e não introduz uma segunda regra de elegibilidade.
- Given a escrita da foto, when `putBinary` é chamado, then
  `cacheControlMaxAge` é 31.536.000 e **não** os 60 s de `putJson` — o teste
  afirma o número, porque "consertar" isso de volta para 60 por consistência
  com o módulo é o erro que o [ADR-0041](../../architecture/adrs/0041-foto-candidato-blob-binario-cache-um-ano.md)
  existe para prevenir.
- Given uma segunda execução sem mudança no TSE, when o importador roda, then
  nenhuma foto já presente é reescrita; a correção de foto pelo TSE exige
  `--force` explícito.
- Given `blobPathname` com extensão `"jpg"` (sem ponto), when chamado, then
  **lança** — mesma filosofia de erro cedo de `assertValidBlobSegment`.

**RF-143 — Chave de identidade e resolução determinística de colisão**

WHEN o sistema precisa saber quem concorre com um número numa corrida, the
system SHALL usar a chave `(cargo, uf, numero)` — nunca o número sozinho — e
SHALL resolver colisão pela função determinística do
[ADR-0042](../../architecture/adrs/0042-cargo-uf-numero-chave-identidade-candidatura.md)
item 5: (a) só publicáveis, (b) prefere `DS_SITUACAO_JULGAMENTO` começando em
`DEFERIDO`, (c) desempata pelo maior `sqcand`, (d) o EA20 tem precedência
absoluta sobre tudo isso na noite da apuração. O banco NÃO SHALL ter
`UNIQUE INDEX` sobre `(cargo, uf, numero)`.

**Aceitação**:
- Given a base de 2026, when as colisões são contadas, then há **52** brutas e
  **4** depois do filtro de publicabilidade — e o teste falha se aparecer uma
  quinta **ou se uma das quatro sumir**.
- Given os quatro casos reais da Bahia (`6|BA|2727` e `6|BA|2717`, cada um com
  dois registros, dois deles com nome idêntico), when a função resolve, then
  devolve o mesmo `sqcand` em 1.000 execuções seguidas, independentemente da
  ordem de leitura do banco (constituição § 6).
- Given uma migration que crie índice único sobre `(cargo, uf, numero)`, when o
  teste estrutural roda, then **reprova** — a constraint quebraria em produção
  contra dado real.
- Given `extract_partido_by_cand` (`api/model/project.py:1712`), when alguém
  "uniformizar" as duas funções sob a mesma assinatura, then o teste acusa: o
  dicionário de **partido** pode ser plano (o número de urna É o número do
  partido no majoritário); o de **nome** não pode, ou o candidato a governador
  do PT de São Paulo aparece nos outros 26 estados.

**RF-152 — Cadência de reimportação e guarda de encolhimento**

WHILE a janela até 04/10/2026 estiver aberta, the system SHALL reimportar o
cadastro na cadência do [ADR-0040](../../architecture/adrs/0040-publicabilidade-candidatura-fail-closed.md)
— diária até ~20/09, a cada 2–3 dias até 01/10, **obrigatória** em 02–03/10 —;
AND IF uma reimportação produzir menos candidaturas publicáveis que a
publicação vigente além do limiar, the system SHALL abortar mantendo a
publicação anterior intacta e acionar alerta.

**Aceitação**:
- Given a publicação vigente com 7.698 publicáveis nos quatro cargos, when uma
  reimportação produz menos de 98% disso, then **nada é publicado**, o Blob
  anterior permanece, e o alerta dispara nomeando o número novo e o antigo.
- Given um par (cargo, UF) que tinha ≥ 1 publicável e passa a ter 0, when a
  reimportação roda, then aborta pelo mesmo caminho — um download truncado
  costuma zerar um pedaço, não encolher tudo proporcionalmente.
- Given uma queda **legítima** (indeferimento em massa por decisão judicial),
  when o operador confirma, then `--force` publica, e o uso do `--force` fica
  registrado no log do ciclo.
- Given a janela obrigatória de 02–03/10, when a reimportação falha ali, then o
  alerta é **dedicado e distinguível** do alerta de rotina — entrar na apuração
  com a lista de 20/09 é um modo de falha específico, nomeado como negativa no
  próprio ADR-0040.
- Rationale do limiar de 2%: não é um número da norma nem do TSE; é a menor
  margem que não dispara com a volatilidade observada (substituições e recursos
  movem dezenas, não centenas, por ciclo) e ainda pega um download truncado.
  Recalibrar com o histórico das primeiras semanas, via nova medição, não por
  palpite.

**RF-214 — Trajetória na Câmara de cada candidatura a Deputado Federal**

> Emenda de 2026-09-26, renumerada em 2026-09-29
> ([ADR-0058](../../architecture/adrs/0058-trajetoria-camara-nome-nascimento-em-memoria.md)).
> O ID fica fora da faixa RF-140..152 da spec porque é emenda posterior a ela:
> em 29/09, RF-200..RF-213 já estavam ocupados na `main` por outras specs
> (`docs/_meta/traceability.md`) e RF-214 era o primeiro livre. O rascunho de
> 26/09 usava RF-200, justificado por um retrato que caducou quando a
> numeração da `main` avançou; o número não é reaberto.
>
> **Entrega dividida (ADR-0058 item 5).** Este RF entrega hoje o **cálculo** e
> a **exportação offline** para `editorial/derivados/trajetoria-camara.json`,
> sem banco. A **persistência em `candidatos`** — migration 0011
> (`trajetoria_camara text`, `camara_ids integer[]`), colunas em
> `lib/db/schema.ts`, integração em `candidatos-import.ts` e backfill — fica
> **adiada para depois de 25/10/2026, e só com autorização expressa do dono**:
> o import da véspera (`docs/operations/vespera-03-10.md:90`) roda contra
> produção, onde essas colunas não existem, e quebraria. Até lá o import de
> 03/10 executa exatamente o código e o schema que já estão em produção. O
> critério marcado *(perna estacionada)* só vale quando ela entrar.

WHEN a exportação offline da trajetória (`pnpm trajetoria:exportar`) processa o
cadastro de candidaturas do TSE, the system SHALL classificar cada candidatura
de cargo 6 em exatamente uma de quatro trajetórias — `em_exercicio` (deputado
federal em exercício hoje, segundo a API de Dados Abertos da Câmara),
`legislatura_atual` (exerceu mandato na 57ª legislatura, 2023–2027, e não está
em exercício), `mandato_anterior` (exerceu só em legislaturas anteriores) ou
`estreante` (nunca exerceu) — casando-a com o histórico `deputados.csv` da
Câmara por **nome civil normalizado + data de nascimento** e, sem casamento
exato, entre os deputados **nascidos no mesmo dia**, por qualquer de:
(a) tokens em comum ≥ max(2, min(|A|,|B|) − 1), (b) primeiro e último token
iguais, (c) nome parlamentar igual ao nome de urna ou ao nome social; AND the
system SHALL gravar `editorial/derivados/trajetoria-camara.json` com
**somente** a categoria (`t`) e o(s) id(s) público(s) do deputado
(`camara_ids`) por `sqcand`, com **toda** candidatura de cargo 6 do universo
presente (estreante com `camara_ids: []`) e a contagem `universo`; AND the
system SHALL ler `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO` em **um único ponto**
(`trajetoriaDaLinha`, `data-pipeline/trajetoria-camara-calculo.ts`), só em
memória e fora do caminho de import; AND IF o histórico da Câmara não puder ser
obtido, the system SHALL abortar sem gravar o arquivo — "não calculado", nunca
`estreante` por omissão.

**Aceitação**:
- Given o cadastro gerado pelo TSE em 12/09/2026 e o histórico da Câmara de
  26/09/2026, when a regra roda sobre as **7.791** candidaturas de cargo 6,
  then produz `estreante` 7.085 · `em_exercicio` 439 · `legislatura_atual` 70
  · `mandato_anterior` 197, **zero** candidatura casando com mais de um
  deputado, e **7.791/7.791** linhas iguais (categoria, ids da Câmara e modo de
  casamento) a `referencia_trajetoria.csv`
  (`data-pipeline/trajetoria-camara-paridade.ts`; medido de novo em 29/09). A
  divisão `em_exercicio` × `legislatura_atual` não é verificada de forma
  independente (ADR-0058, § Paridade) — e não chega a nenhum rótulo público.
- Given o arquivo exportado, when um consumidor procura um `sqcand` de cargo 6,
  then ele está lá — `universo` é igual ao número de chaves de `por_sqcand`; um
  `sqcand` fora do arquivo é "não calculado", nunca "estreante".
- Given `ST_REELEICAO` do arquivo complementar — `#NE` em **100%** das 7.791
  —, when a trajetória é calculada, then esse campo **não participa**.
- Given `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO`, lidos para o casamento, when o
  arquivo exportado ou o log são produzidos, then nenhum dos dois valores
  ocorre, nem nome algum — **asserção negativa**; nenhum outro arquivo de
  código lê essas colunas (teste de fio); e `CandidatoRow` continua com as
  mesmas 19 chaves — constituição § 5, RNF-019, ADR-0039 com a exceção estrita
  do ADR-0058.
- Given um deputado **estadual** que declara ocupação `DEPUTADO` e não tem
  registro na Câmara, when classificado, then é `estreante` — `DS_OCUPACAO`
  não é sinal de mandato federal.
- Given um candidato e um deputado com a **mesma data de nascimento** e nomes
  sem nenhuma das três regras em comum, when casados, then **não** casam; e o
  mesmo nome com data diferente também não.
- Given maior legislatura casada = 57 sem exercício hoje, then
  `legislatura_atual`; = 56, then `mandato_anterior` — a fronteira é
  exatamente a 57ª; e exercício hoje vence a legislatura.
- Given a exportação sem `--camara-refresh`, when roda, then não toca a rede e
  não cria nem escreve no diretório do cache da Câmara (modo só-cache); cache
  ausente aborta.
- Given a lista em exercício com menos de 500 ids, ou paginada, when baixada
  (`--camara-refresh`), then o ciclo aborta e a resposta **não** vira cache —
  cortada, ela rebaixaria deputados em exercício para `legislatura_atual` em
  silêncio.
- *(perna estacionada — só depois de 25/10, com autorização do dono)* Given
  candidaturas de cargo 6 já no banco, when a trajetória for persistida depois
  da migration 0011, then o preenchimento é um `UPDATE` **só** de
  `trajetoria_camara` e `camara_ids` (backfill dedicado, ROLLBACK por padrão),
  nunca reimport (DELETE + INSERT), que zeraria `foto_ok` e regravaria o
  cadastro; e nenhuma coluna de `candidatos` tem nome que case
  `cpf|email|titulo|nascimento` (a guarda da migration 0008 roda de novo na
  0011).

### Payload

**RF-144 — Nome real no payload de UF, resolvido em quatro degraus**

WHEN o orchestrator monta `EdgeUfRow.top_candidatos`, the system SHALL emitir
`{ id, pct, nome?, partido?, sqcand? }`, resolvendo `nome` nesta ordem — EA20
`cand[].nmu` → EA20 `cand[].nm` → fatia do cadastro por `(cargo, uf, numero)`
resolvida pelo RF-143 → `"Candidato {n}"` — e o cadastro NUNCA SHALL sobrepor o
EA20.

**Aceitação**:
- Given um EA20 com `nmu` preenchido e um cadastro com nome diferente para o
  mesmo `(cargo, uf, numero)`, when o payload é montado, then vence o **EA20** —
  o teste existe para essa direção, não só para a feliz.
- Given cada um dos quatro degraus isoladamente (EA20 com `nmu`; EA20 só com
  `nm`; sem EA20, com cadastro; sem nada), when o payload é montado, then o
  resultado é, respectivamente, nome de urna, nome completo, nome do cadastro e
  `"Candidato {n}"` — quatro testes, um por degrau, e não um teste do caminho
  feliz.
- Given um payload sem os campos novos (pré-018, ou sob `model_fallback_tier`),
  when a tela renderiza, then continua funcionando com `"Cand {id}"` — os três
  campos são **opcionais** de propósito.
- Given o guard de tamanho do store do Global Config (ADR-0032), when os campos
  novos entram, then o store continua abaixo do teto — medição obrigatória,
  não estimativa; o ADR-0042 registra isso como pendência explícita do
  implementador.

**RF-145 — Nome real proibido no bloco nacional de cargo 3 e 5**

WHERE o payload é o bloco nacional (`national.candidatos`) de cargo 3
(Governador) ou 5 (Senador), the system SHALL manter `nome = "Candidato {id}"` e
NÃO SHALL preencher nome real. WHERE o cargo é 1 (Presidente), the system SHALL
preencher o nome real.

**Aceitação**:
- Given o bloco nacional de cargo 3 serializado, when o teste procura qualquer
  nome do cadastro nele, then **não encontra** — asserção negativa; a positiva
  ("o placeholder está lá") passaria com nomes reais ao lado.
- Given o bloco nacional de cargo 1, when serializado, then os nomes reais estão
  lá.
- Rationale: em cargo 3 e 5, `national.candidatos` é a **união de 27 corridas**
  sob o mesmo espaço de `id` — o próprio `GovernorCard.tsx` já documenta isso em
  comentário. O `id` 13 ali não identifica uma pessoa; identifica "o número 13
  nalguma UF". Qualquer nome atribuído seria ambíguo **por construção**, não
  apenas impreciso.
- Consequência assumida, que a tela precisa absorver sem parecer defeito: o
  leitor vê nome completo na tela de Presidente e `Candidato 13` no bloco
  nacional de Governador. É diferença estrutural de corrida, não de qualidade
  de dado.

### Telas

**RF-146 — Rota `/candidatos`**

WHEN um leitor abre `/candidatos`, the system SHALL renderizar no servidor a
grade de candidaturas publicáveis dos quatro cargos cobertos, lida do Vercel
Blob, sem Edge Config e **sem JavaScript de aplicação novo**.

**Aceitação**:
- Given nenhuma apuração publicada (qualquer dia antes de 04/10), when a rota é
  aberta, then responde 200 com a grade completa — esta rota **não depende** do
  payload de apuração.
- Given o `CargoTabs`, when a rota renderiza, then **nenhuma aba nova** existe e
  **nenhuma aba** se marca como atual — `/candidatos` não emite
  `main[data-trilha]`, do mesmo modo que `/sobre-o-modelo`.
- Given a medição de bundle (`tests/e2e/perf-budget.spec.ts`), when a rota entra,
  then o above-the-fold de aplicação **não sobe** — RNF-007a está em 148,7 KiB
  de 150, com 1,3 KiB de folga.
- Given o Blob indisponível, when a rota renderiza, then exibe estado de
  indisponibilidade declarada e **mantém** a moldura da página
  (constituição § 7), nunca 500.

**RF-147 — Filtro por cargo e por UF, sem JavaScript**

WHEN o leitor submete o formulário de filtro, the system SHALL ler cargo e UF de
`searchParams` e devolver HTML já filtrado, via `<form method="get">`, sem
JavaScript de cliente.

**Aceitação**:
- Given um navegador com JavaScript desabilitado, when o leitor filtra, then
  funciona.
- Given `?cargo=6&uf=BA`, when a rota renderiza, then mostra só Deputado Federal
  na Bahia.
- Given `?cargo=99` ou `?uf=ZZ`, when a rota renderiza, then exibe estado vazio
  **nomeado** ("nenhuma candidatura para este filtro"), nunca 500 e nunca a
  lista inteira em silêncio — entrada inválida degrada fechado, como a
  publicabilidade.
- ~~Given `?cargo=7` (Deputado Estadual, existente no TSE e fora do produto), when
  a rota renderiza, then o mesmo estado vazio nomeado — a rota não revela
  cargos que o produto não cobre.~~ ⚠️ **Superado em 2026-09-29 pela
  [spec 027](../027-deputado-estadual-distrital/spec.md)** (RF-288): `?cargo=7` e `?cargo=8` são filtros
  válidos, cada um só nas UFs do cargo; a regra de não revelar cargo não coberto continua para os demais
  (ex.: `?cargo=2`, `?cargo=4`).

**RF-148 — Busca por nome**

WHEN o leitor submete texto de busca, the system SHALL casar contra
`NM_URNA_CANDIDATO` **e** `NM_CANDIDATO`, indiferente a acento e a caixa, e
SHALL exibir o **nome de urna** no card.

**Aceitação**:
- Given a busca `"jose"`, when submetida, then casa com `"JOSÉ"` e com
  `"José da Silva"`.
- Given busca vazia ou só espaços, when submetida, then equivale a sem filtro —
  não a "nenhum resultado".
- Given o nome de urna (máx. 30 caracteres, **nunca vazio** em 20.939 linhas),
  when o card renderiza, then nunca cai em estado de nome ausente; o nome
  completo fica disponível à busca sem ocupar o card.
- Given a busca combinada com cargo e UF, when submetida, then os três filtros
  se compõem (`AND`), e os valores permanecem preenchidos no formulário após o
  submit.

**RF-149 — Grade de candidatos no estado "aguardando dados" de cada cargo**

WHILE uma página de cargo está no estado sem voto apurado, the system SHALL
exibir a grade de candidaturas daquela corrida **abaixo** do parágrafo honesto
existente, sem substituí-lo nem reescrevê-lo.

**Aceitação**:
- Given o estado sem payload de `/deputado-federal`, when a página renderiza,
  then o parágrafo `data-testid="dep-aguardando"`
  (`app/(dep)/deputado-federal/page.tsx:650`) continua presente, **primeiro**, e
  a grade entra depois dele — acrescentar, nunca substituir.
- Given a chegada do primeiro boletim, when a página renderiza, then a grade sai
  e o resultado entra; a grade é o preenchimento de um vazio, não um bloco
  permanente.
- Given a grade de uma página de UF, when renderiza, then mostra só as
  candidaturas **daquela UF e daquele cargo** — a mesma chave
  `(cargo, uf, numero)` do RF-143.
- Given a grade, when renderiza, then leva a `/candidatos` por link, com o
  filtro daquela corrida já aplicado na URL.
- Given um leitor de tela, when percorre a grade, then encontra uma lista
  semântica com nome e partido em texto — a foto não carrega informação
  (RF-151), e a grade tem a alternativa textual que o RNF-023 exige.

**RF-150 — "Fonte: TSE" visível e carimbo de frescor**

WHEN qualquer superfície exibe nome ou foto vindos do cadastro, the system SHALL
exibir "Fonte: TSE" de forma visível — obrigação da licença cc-by, não escolha
editorial — mais o `fonte_ts` da importação e o aviso de que a lista de
candidaturas muda até o fim da apuração.

**Aceitação**:
- Given a importação, when `fonte_ts` é gravado, then o valor vem do header
  `Last-Modified` da resposta HTTP do arquivo, e **não** do `last_modified` do
  catálogo CKAN — asserção negativa contra 22/07/2026 e 03/08/2026, as duas
  datas mortas.
- Given um `fonte_ts` injetado no teste, when a tela renderiza, then ela diz
  **aquele** valor — o número sai do dado, nunca literal no JSX (lição D8 da
  spec 017: quatro frases viraram falsas de uma vez quando a granularidade
  mudou).
- Given o footer global, when a página renderiza, then "Não oficial. Fonte:
  TSE." continua lá (constituição § 1) — a atribuição do RF-150 é **adicional**
  e fica junto da grade, onde o dado está.
- Given a distinção entre as duas fontes, when a tela exibe as duas coisas na
  mesma página, then não confunde o `fonte_ts` do cadastro com o `dado_ts` da
  apuração ([ADR-0038](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md))
  — são relógios de dados diferentes, com cadências diferentes.

**RF-151 — Fallback de avatar quando não há foto**

IF uma candidatura publicável não tem foto no Blob, the system SHALL renderizar
um avatar de fallback com as **mesmas dimensões** da foto (161×225), e NÃO SHALL
omitir o card nem deixar o espaço colapsar.

**Aceitação**:
- Given uma candidatura sem foto, when o card renderiza, then ocupa exatamente o
  mesmo espaço de um card com foto — CLS **zero** (RNF-002; imagem sem dimensão
  declarada é a causa clássica).
- Given o avatar de fallback, when renderiza, then **não** usa `colorForParty`
  como preenchimento de área — PSOL (2,08:1) e NOVO (2,72:1) reprovam o piso de
  3:1 da WCAG 1.4.11 como cor-base, risco aberto em
  [risks.md](../../reference/risks.md).
- Given qualquer card, com ou sem foto, when renderiza, then nome e partido
  estão em **texto**; a identidade nunca depende da imagem.

## Requisitos Não-Funcionais

- **RNF-002 / RNF-003** — estas são as **primeiras imagens do produto**: não
  existe hoje nenhum `next/image` nem `<img>` em `app/` ou `components/`
  (verificado por grep em 13/09). Dimensões explícitas e `loading="lazy"` são
  requisito, não recomendação.
- **RNF-007a** — está em **148,7 KiB de 150**. Toda a spec é server-rendered;
  filtros e busca por `<form method="get">`. Zero JavaScript novo é restrição
  dura, não preferência.
- **RNF-019 / constituição § 5** — o recorte de PII do RF-140.
- **RNF-022 / RNF-023 / RNF-024** — contraste, alternativa textual da grade,
  navegação por teclado do formulário.
- Herda a política de cor da constituição § 2 via
  [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md): a
  identidade partidária no card usa **só** o par `partyChipInk` de
  `lib/utils/party-color.ts`, medido contra as duas tintas do kit.

## Telas

| Tela | O que é | Onde |
|---|---|---|
| **T-13** | `/candidatos` — grade nacional com filtro de cargo/UF e busca | `app/candidatos/page.tsx` (a criar) |
| **T-14** | Grade de candidaturas dentro do estado "aguardando dados" | estado das quatro páginas de cargo, nacionais e por UF |

T-14 é um **estado**, não uma rota: entra por composição dentro de telas que já
existem (T-01, T-09, T-11 e as de UF), abaixo do parágrafo que já está lá.

## Open questions

1. **O ADR-0039 afirma que o EA20 não carrega `SQ_CANDIDATO`. Ele carrega.**
   `lib/tse/ea20-schema.ts:80` declara `sqcand: z.string()` — **obrigatório**,
   não opcional — dentro de `cand[]`, com o comentário "sequencial único (usado
   para foto — ver instruções download)"; `vs[]` (vice/suplente) também o traz
   (`:58`). A frase do ADR-0039 ("o sequencial só serve para o join entre os dois
   CSVs do TSE entre si, nunca para casar contra o payload do EA20, que não o
   carrega") é falsa contra o schema em disco, e o ADR-0042 item 2 e o design da
   spec 017 § D6 tratam `sqcand` do EA20 como identidade desde sempre
   (`api/model/deputado.py:102-108`). **Consequência prática, e é grande**: na
   noite da apuração o join contra o cadastro pode ser feito por `sqcand`
   diretamente, o que dispensa a função de resolução de colisão do RF-143 para o
   caminho ao vivo e elimina de saída os 4 casos da Bahia. A cadeia de
   `(cargo, uf, numero)` continua necessária **antes** de existir boletim, onde
   não há EA20 nenhum.

   ✅ **RESOLVIDA em 2026-09-13, antes de qualquer commit ou propagação.** O
   ADR-0039 foi corrigido em revisão (o documento ainda não estava commitado nem
   referenciado por nenhuma spec, então a emenda foi feita no próprio item, com
   nota de correção visível, em vez de um ADR novo). O texto vigente declara
   `SQ_CANDIDATO` como **chave preferencial** — casa os dois CSVs entre si E o
   payload do EA20 — e `(cargo, UF, número)` como **fallback**, para quando só
   existe o número (`projections.candidato_id`). O achado está certo e a
   consequência foi incorporada: no caminho ao vivo, resolver por `sqcand`
   dispensa a função de desempate do RF-143 e elimina os 4 casos da Bahia.
2. **A correção de User-Agent do ADR-0039 já está no working tree, não
   commitada, e não foi feita por esta spec.** `data-pipeline/_tse-common.ts:70`
   traz `TSE_ETL_USER_AGENT = "AtlasMenna-ETL/0.1"` com comentário medindo o WAF
   em 13/09: a regra bloqueia UA com e-mail ou URL entre parênteses e aceita
   token de produto simples. O ADR-0039 chama a correção de "pré-requisito de
   implementação"; ela aparenta estar feita.

   ✅ **VERIFICADA contra o host real em 2026-09-13**, não só por leitura: o
   `downloadCached` corrigido baixou `motivo_cassacao_2026.zip` de
   `cdn.tse.jus.br` com sucesso (antes da correção, o mesmo host devolvia 403
   Akamai). Como os três importadores chamam exatamente essa função, o caminho
   de rede deles está coberto pela mesma prova.

   ⚠️ **O que NÃO foi verificado**: os três importadores não foram executados
   ponta a ponta (exigem banco). A prova cobre o download, não a ingestão. Vale
   uma execução real de pelo menos um deles antes de considerar a negativa
   fechada.
3. **Vice e suplente: a conta de fotos do ADR-0041 inclui quem esta spec não
   exibe.** O ADR estima "~8.400 fotos ≈ 43 MB"; os quatro cargos cobertos têm
   **7.698** candidaturas publicáveis. A diferença são vices (cargos 2 e 4) e
   suplentes de senador, cujos códigos de cargo **não estão** em
   `lib/config/cargos.ts`. Duas perguntas, nenhuma decidida: (a) o importador
   baixa a foto desses ~700 ou não; (b) a chapa presidencial exibe o vice — o
   EA20 já traz `cand[].vs[]` com `sqcand`, `nm` e `nmu`, e a spec 016 (RF-101)
   já preserva o array. Enquanto não decidido, o escopo desta spec é **7.698
   fotos ≈ 39 MB**, só titulares.
4. **Onde fica o estado "aguardando" nas trilhas `(pres)`, `(gov)` e `(sen)`.**
   Só `(dep)` tem função dedicada (`AguardandoNacional`,
   `app/(dep)/deputado-federal/page.tsx:650`). As outras três montam a página com
   fallback interno — `app/(gov)/governador/page.tsx:221` e
   `app/(sen)/senador/page.tsx:154` encadeiam `readProjection ?? …`. O RF-149
   precisa desses três pontos localizados antes de ser implementado; o parágrafo
   honesto a preservar não é o mesmo texto nas quatro.
5. **O guard de tamanho do store do Global Config nunca foi medido contra os
   campos novos de `top_candidatos`.** O ADR-0042 registra a pendência e não a
   resolve. Se estourar, a saída é o mesmo padrão do
   [ADR-0032](../../architecture/adrs/0032-detalhe-municipal-vercel-blob.md) —
   mover para Blob —, mas isso é decisão de arquitetura, não ajuste de
   implementação.
6. **Cadência de checagem de frescor contra o CDN não foi verificada quanto a
   volume.** O ADR-0039 declara a pendência explicitamente: um `GET` com `Range`
   por ciclo, multiplicado pela cadência, nunca foi medido contra o limite do
   CDN de dados abertos (que é outra propriedade, com outro WAF, que não a de
   `resultados.tse.jus.br`).

## Emenda às specs 016 e 017

`EdgeUfRow.top_candidatos` passa de `Array<{ id, pct }>`
(`lib/edge-config/types.ts:476`) para `Array<{ id, pct, nome?, partido?, sqcand? }>`.
Isso **emenda** o contrato de payload das specs
[016](../016-senador/spec.md) e [017](../017-deputado-federal/spec.md) — não as
supersede: a estrutura geral permanece e os três campos são opcionais.

Os dois consumidores que hoje resolvem nome por `id` sozinho — e que por isso
carregam o defeito que o ADR-0042 previne — são
`components/blocks/GovernorCard.tsx:130-143` e
`app/(sen)/senador/page.tsx:139-146`.

**A propagação do frontmatter `adrs:` e do texto das duas specs é do
`spec-syncer`**, não desta spec.

## Emenda da spec 025 — etiquetas em `/candidatos` (2026-09-29)

Com a chave `chips` ligada, cada candidatura exibida em `/candidatos` (Governador, Senador, Deputado Federal) ganha, sob o cartão, as etiquetas editoriais das categorias com critério publicado (RF-245, [spec 025](../025-visoes-editoriais/spec.md)); no Senado, também a posição sobre impeachment de ministros do STF, sempre qualificada (RF-246). O aviso com link para `/sobre-as-etiquetas` fica sob a grade. Nada muda na ordem (número na urna), no corte de 60 nem na rota ser zero JavaScript de aplicação: a etiqueta é Server Component.

## Cross-refs

- [ADR-0039](../../architecture/adrs/0039-portal-dados-abertos-tse-identidade-candidatura.md) — a fonte, a licença cc-by, as três armadilhas medidas, o recorte de PII
- [ADR-0040](../../architecture/adrs/0040-publicabilidade-candidatura-fail-closed.md) — publicabilidade fail-closed, situação como texto, cadência
- [ADR-0041](../../architecture/adrs/0041-foto-candidato-blob-binario-cache-um-ano.md) — `putBinary`, cache de 1 ano, `unoptimized`, esquema de caminho
- [ADR-0042](../../architecture/adrs/0042-cargo-uf-numero-chave-identidade-candidatura.md) — a chave, a função de resolução, a emenda a `top_candidatos`
- [ADR-0058](../../architecture/adrs/0058-trajetoria-camara-nome-nascimento-em-memoria.md) — RF-214: trajetória na Câmara, casamento por nome + nascimento só em memória, entrega dividida (exportação offline agora; banco depois de 25/10)
- [ADR-0038](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — precedente de "a hora do dado, não a hora do cálculo", aplicado aqui como `fonte_ts`
- [Design 018](./design.md) — contratos, caminhos, componentes e restrições de tela
- Constituição [§ 1](../../constitution.md) (TSE, dado oficial intocável, não oficial no footer), [§ 2](../../constitution.md) (cor), [§ 5](../../constitution.md) (sem PII), [§ 8](../../constitution.md) (transparência)
- `lib/config/cargos.ts` — os quatro cargos cobertos; Deputado Estadual está fora por aqui
