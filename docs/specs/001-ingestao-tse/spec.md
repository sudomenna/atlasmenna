---
id: 001-ingestao-tse
title: Ingestão de dados do TSE
status: shipped
priority: M
personas: []
screens: []
requirements: [RF-001, RF-002, RF-003, RF-004, RF-005, RF-006, RF-007, RF-008, RF-009, RF-010, RF-010.1, RF-010.2, RF-010.3, RF-010.4, RF-010.5, RF-010.6]
depends_on: []
apis: [GET /api/ingest, POST /api/ingest, GET /api/ingest/[cargo], POST /api/ingest/[cargo]]
components: []
nfr: [RNF-006, RNF-009, RNF-011, RNF-012, RNF-016, RNF-031, RNF-032, RNF-033, RNF-034]
adrs: [0001, 0002, 0008, 0011, 0012, 0020, 0035, 0038]
---

# Spec 001 — Ingestão de dados do TSE

## Objetivo

Consumir o feed público de resultados do TSE (formato EA20) com cadência adequada, validação rigorosa, deduplicação por ETag e persistência append-only, alimentando o pipeline do modelo estatístico dentro do orçamento de defasagem TSE→tela de <90s ([RNF-006](../../nfr/performance.md), revisado por [ADR-0011](../../architecture/adrs/0011-cadencia-60s.md)).

## Escopo

**In**:
- Polling agendado durante a janela de apuração.
- Ingestão de arquivos EA20 por **par (UF, município, zona) × cargo** — o default de `TSE_GRANULARIDADE` é `zona`, que desde [ADR-0035](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md) D1 significa um alvo por par, ~6.110 por cargo. O modo `uf` (agregados de UF/Brasil, ~55 alvos) segue disponível como opt-in de diagnóstico, mas **está quebrado no modelo** (a zona-sentinela 0 não tem peso em `eleitorado`).
- Persistência de snapshots em Postgres (append-only), com o payload EA20 cru em JSONB. *(O dual-write para Vercel Blob previsto originalmente ficou em backlog — decisão D-3 em [tasks.md](./tasks.md).)*
- Carga inicial de referências históricas (2018, 2022) e mapeamento geográfico.
- Conformidade operacional com a **Res. TSE nº 23.751/2026, arts. 264–269** — sem cadastro
  prévio, que a norma não prevê ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)):
  integridade do dado recebido, rotulagem do conteúdo derivado, rate limiting de saída,
  requisição condicional e proibição de sondagem de URL.

**Out**:
- Cálculo da projeção (escopo da [spec 002](../002-modelo-estatistico/spec.md)).
- Visualização dos dados (escopo das specs 003+).

## Personas e jornadas

Spec de back-end pura — não tem persona direta. Atende **todas** as personas indiretamente.

## Requisitos Funcionais (EARS)

### Conectividade e formato

**RF-001 — Consumo do feed TSE via CDN pública**

WHEN o sistema precisa atualizar a apuração, the system SHALL consumir os arquivos de resultado unificado (leiaute **EA20**, JSON) do CDN público do TSE, cujo host é configurável por `TSE_BASE_URL` — produção `https://resultados.tse.jus.br/oficial`, simulado `https://resultados-sim.tse.jus.br/simulado/simulado2026`, mock local em dev — e SHALL derivar cada URL da padronização documentada em [tse-2026-leiautes.md § 1](../../reference/tse-2026-leiautes.md).

**Aceitação**:
- Given `TSE_BASE_URL` e `TSE_COD_ELEICAO` válidos, when `/api/ingest` é acionado, then o sistema faz GET para a URL canônica de cada alvo ativo, na granularidade configurada por `TSE_GRANULARIDADE` (`uf` — default, ~55 GETs/ciclo — ou `zona`, ~5.200 GETs/ciclo).
- Given a granularidade `uf`, when as URLs são montadas, then seguem `<uf>-c<cargo4>-e<eleicao6>-u.json` (e `br-c0001-...-u.json` para Presidente), sob a pasta-folha `/<ciclo>/<eleição>/dados/<br|uf>/`.
- Given resposta 200 com payload EA20, when o schema Zod (`lib/tse/ea20-schema.ts`, `.passthrough()` em todos os níveis) valida os campos consumidos (`dg`, `hg`, `f`, `tpabr`, `cdabr`, `s`, `e`, `v`), then o snapshot é aceito, mesmo com campos desconhecidos presentes.
- Given resposta 200 cujo envelope não traz um campo consumido, when o parse roda, then falha fail-fast com log estruturado e o ciclo segue nos demais alvos.

**Nota (2026-09-05)**: a versão anterior deste RF fixava o host de produção no texto e presumia granularidade de zona como única opção. O host virou configurável no hardening pré-simulado (`lib/tse/targets.ts`, `getTseBaseUrl`) porque o ambiente de simulado do TSE é outro domínio; a granularidade virou configurável porque existem arquivos agregados de UF e Brasil ([tse-2026-leiautes.md § 1](../../reference/tse-2026-leiautes.md)). Ver também a seção "Granularidade" em [design.md](./design.md).

**RF-002 — Polling automático a cada 60s durante janela de apuração (17h–04h)**

WHILE estamos na janela de apuração (17h00–04h00 horário oficial do dia D), the system SHALL acionar `/api/ingest` a cada 60 segundos via Vercel Cron.

**Aceitação**:
- Given a hora é 16:59:59 do dia D, when o cron é avaliado, then nenhuma execução dispara.
- Given a hora é 17:00:00, when o cron é avaliado, then a primeira execução dispara dentro de ±60s.
- Given a hora é 04:00:01, when o cron é avaliado, then nenhuma nova execução dispara.

**Nota histórica**: a versão inicial deste RF assumia 15s. Cadência foi revisada para 60s em [ADR-0011](../../architecture/adrs/0011-cadencia-60s.md) devido à granularidade mínima do Vercel Cron (1/min) e robustez operacional vs. complexidade de self-loop dentro da função. Defasagem TSE→tela ajustada de <30s para <90s em [RNF-006](../../nfr/performance.md).

**RF-003 — Suporte a ETag (If-None-Match)**

WHEN o sistema faz GET de um arquivo EA20, the system SHALL enviar header `If-None-Match` com o último ETag conhecido daquele arquivo.

**Aceitação**:
- Given o TSE responde 304 Not Modified, when o cliente processa, then nenhum download adicional é feito e o arquivo é pulado do ciclo.
- Given o TSE responde 200, when o cliente processa, then o novo ETag é persistido em `snapshots.etag`.

**Nota (2026-09-05)**: tratamos a requisição condicional como economia de banda, **não** de cota — um 304 é dimensionado como se contasse no limite de 100 req/s por IP do TSE, igual a um 200. ⚠️ **Isto é uma postura conservadora, não um fato documentado**: o material oficial do TSE não diz nada sobre cache condicional (`304` só aparece lá como código de pleito). Se o TSE confirmar que 304 não consome cota, o orçamento do ciclo pode ser reavaliado. Pergunta aberta para o canal `30308800.tse.jus.br` antes de 15/09. O orçamento do ciclo é dimensionado por RF-010.4.

### Persistência

**RF-004 — Snapshots append-only**

WHEN um novo snapshot é recebido com hash SHA256 diferente do último armazenado, the system SHALL inserir um novo registro em `snapshots` SEM atualizar registros existentes.

**Aceitação**:
- Given a tabela `snapshots` tem N linhas, when um snapshot novo chega, then a tabela tem N+1 linhas e nenhuma linha anterior foi alterada.

**RF-005 — Replay completo da apuração**

WHEN um operador executa `scripts/replay-2022.ts`, the system SHALL reproduzir cronologicamente todos os snapshots persistidos e re-executar o modelo a cada passo.

**Aceitação**:
- Given snapshots de 2022 persistidos, when o script roda, then um relatório é gerado com MAE por candidato em t = {15min, 30min, 1h, 2h, final}.

### Referências históricas e geográficas

**RF-006 — Histórico 2022 em granularidade de zona**

WHEN o sistema é inicializado pela primeira vez, the system SHALL ter `historical_results` populado para `ano=2022, turno IN (1,2), cargo IN (1,3)` com granularidade de zona.

**RF-007 — Histórico 2018 (Should)**

WHEN o sistema é inicializado, the system SHOULD ter `historical_results` populado para `ano=2018` em granularidade de zona — usado para análises secundárias.

**RF-008 — Mapeamento par (município, zona) ↔ UF (IBGE × TSE)**

WHEN o sistema é inicializado, the system SHALL ter `municipios` e `zonas` populados com mapeamento IBGE × TSE em granularidade de **par** (município, zona) — isto é, `zonas` terá PK `(uf, cod_municipio_tse, cod_zona)` — de forma que cada arquivo EA20 de par tenha alvo de ingestão correspondente. Fonte primária: EA12 (`comum/config/mun-e<n>-cm.json`, arquivo único nacional, `abr[].mu[].z[]`); fallback até o EA12 2026 existir: DISTINCT `(uf, cod_municipio_tse, cod_zona)` de `eleitorado WHERE ano=2026` ([ADR-0035 D1](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)).

**Aceitação**:
- Given o EA12 2026 publicado, when `zonas-import --ea12 <path>` roda, then `SELECT COUNT(DISTINCT (uf, cod_municipio_tse, cod_zona)) FROM zonas` ≥ 6.000 (estimativa TSE: ~6.083 pares).
- Given nenhum EA12 2026 antes de 15/09, when fallback CSV roda, then `SELECT COUNT(*) FROM zonas` ≥ 6.000 (medido em 2026-09-11: 6.085 pares do eleitorado 2024).
- Given um arquivo EA20 de par `sp71072-z0001-c0003-e*-u.json`, when o ciclo enumera alvos, then a tabela `zonas` tem linha `(uf='sp', cod_municipio_tse=71072, cod_zona=1)`.

**RF-009 — Eleitorado por par (município, zona) para 2026**

WHEN o sistema é inicializado, the system SHALL ter `eleitorado` populado com `eleitores_aptos` por **par** (município, zona) para `ano=2026` — PK `(ano, uf, cod_municipio_tse, cod_zona)` — de forma que somas e agregações sejam exatas ([ADR-0035 D2](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)).

**Aceitação**:
- Given o CSV de eleitorado 2024 (`build/tse-archives/eleitorado_local_votacao_2024/`), when `eleitorado-import.ts` roda, then `SELECT COUNT(*) FROM eleitorado WHERE ano=2026` ≥ 6.000 e `SUM(eleitores_aptos) BETWEEN 155M AND 157M`.
- Given um par `(uf='mg', cod_municipio_tse=3106200, cod_zona=1)` com dois snapshots de turnos distintos, when `fetch_eleitorado_por_par` agrega, then `SELECT SUM(eleitores_aptos) FROM eleitorado WHERE uf='mg' AND cod_municipio_tse=3106200 AND cod_zona=1 AND ano=2026` = total exato para aquele par em 2026.

### Conformidade regulatória

**RF-010 — Conformidade com a Res. TSE 23.751/2026 (arts. 264–269), sem cadastro prévio**

WHILE o sistema consome os arquivos de divulgação de resultados do TSE, the system SHALL operar em conformidade com o Título III, Capítulo VI (**arts. 264 a 269**) da **Res. TSE nº 23.751/2026**, **sem depender de cadastro, credenciamento ou homologação prévia** — nenhum desses institutos existe na norma vigente para 2026 ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)) — satisfazendo simultaneamente RF-010.1 a RF-010.6.

**Aceitação**:
- Given qualquer ambiente que aponte para um host do TSE (produção ou simulado), when um ciclo de ingestão roda, then RF-010.1..RF-010.6 são satisfeitos simultaneamente.
- Given o repositório (código, headers HTTP e documentação pública), when se busca por declaração de cadastro/credenciamento perante o TSE, then não existe nenhuma — `grep -rin "cadastr\|credenci" lib/ app/` não retorna afirmação de status junto ao TSE.

**Notas de escopo deste RF**:

1. **Nada aqui depende de um ato administrativo do TSE.** O RF anterior exigia "status do cadastro aprovado" — requisito inverificável, porque não há processo de inscrição nem endpoint/registro onde consultar tal status. As obrigações abaixo são todas verificáveis por código e por teste.
2. **Decomposição de votos é requisito de schema, não de artigo.** O EA20 decompõe `v.vvc` (votos a votáveis concorrentes) em `v.vv` (válidos) + `v.van` (anulados) + `v.vansj` (anulados sub judice), e `v.vvc` — não `v.tv` — é o denominador de "votos a candidatos". Essa obrigação está confirmada no **dicionário de dados do EA20**; **não** foi possível confirmar um parágrafo específico da Res. 23.751/2026 que a imponha (o material disponível é o slide oficial de apresentação, não o texto integral). Ver ADR-0020, seção "Consequências". O tratamento correto dos denominadores é requisito do modelo — [spec 002](../002-modelo-estatistico/spec.md) — não deste RF.
3. Art. 268 (vedação de majorar preço de serviços em razão dos dados do TSE) e art. 269 (descumprimento impede acesso) não geram requisito de código: o AtlasMenna é gratuito e não cobra por acesso (constituição § 1).

---

**RF-010.1 — Integridade do dado oficial recebido (art. 267 §4º)**

WHEN um arquivo EA20 é aceito por um ciclo de ingestão, the system SHALL persistir em `snapshots.payload` o envelope **exatamente como recebido** do TSE — sem alterar, normalizar, arredondar, reordenar ou remover campos — e SHALL NOT atualizar nem apagar snapshots já gravados.

**Aceitação**:
- Given um EA20 com campos ainda não previstos pelo schema, when o snapshot é gravado, then o payload persistido preserva esses campos inalterados (schema `.passthrough()` em todos os níveis).
- Given `N` snapshots gravados, when chega um snapshot com hash SHA-256 diferente, then a tabela tem `N+1` linhas e a linha anterior permanece idêntica (constituição § 10 — append-only).
- Given a projeção estatística é calculada, when ela é persistida, then vai para `projections`/Edge Config, **nunca** sobre `snapshots.payload`.

**RF-010.2 — Projeção rotulada como conteúdo derivado, inconfundível com o oficial**

WHERE uma superfície pública exibe número derivado (projeção, intervalo de confiança, probabilidade de vitória, cenários de 2º turno), the system SHALL rotulá-lo como **não oficial** e atribuir ao TSE a fonte do dado apurado ("Não oficial. Fonte: TSE."), de forma que nenhum leitor confunda projeção com resultado oficial.

**Aceitação**:
- Given qualquer rota pública renderizada, when o HTML é inspecionado, then contém "Não oficial" e a atribuição de fonte ao TSE (constituição § 1; `components/layout/Footer.tsx`).
- Given um bloco de projeção, when renderizado, then o valor projetado é rotulado como projeção, com o percentual **apurado** exibido em marcação visual distinta do projetado.

**RF-010.3 — Rate limiter de saída obrigatório, com restrições por invocação e agregadas**

WHILE o pipeline emite requisições ao CDN do TSE, the system SHALL passar **cada tentativa** (inclusive retries) por um rate limiter de saída (token bucket, `lib/tse/rate-limiter.ts`). The system SHALL enforce **duas restrições de taxa simultâneas**, ambas bem abaixo do limite documentado do TSE de **100 req/s por IP** (cuja violação gera **bloqueio de 10 minutos, renovado** a cada nova violação durante o bloqueio):

1. **Por invocação**: cada processo de ingestão (`/api/ingest/[cargo]`, `/api/ingest/deputado-federal/<fatia>` ou `/api/ingest` fan-out) SHALL manter a taxa no **teto do seu cargo**, declarado no campo `rpsMax` da tabela canônica `lib/config/cargos.ts` — **25 req/s** para Presidente, Governador e Senador e **5 req/s** para Deputado Federal —, e em **≤ 50 req/s** (ceiling supervisionado em simulado) em qualquer hipótese, inclusive com `TSE_MAX_RPS` explícita.
2. **Agregada**: com os **quatro** cargos potencialmente em paralelo (cada um em processo Fluid Compute isolado com seu próprio rate limiter singleton), o pior caso de **quatro invocações simultâneas no mesmo IP** SHALL somar **≤ 80 req/s** (25 + 25 + 25 + 5) — **ainda bem abaixo do teto de 100 rps/IP do TSE** (constituição § 1, margem de segurança para retries e operações de monitoramento no mesmo IP) ([ADR-0026, nota 2026-09-11 b](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) e [ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md), que emendam [ADR-0035 D3](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)).

**Aceitação**:
- Given `TSE_MAX_RPS` ausente **e** um cargo informado, when o limiter é criado, then a taxa efetiva por invocação é o `rpsMax` daquele cargo em `lib/config/cargos.ts` (25 ou 5 req/s).
- Given `TSE_MAX_RPS` ausente **e nenhum cargo informado** (`tse-watch`, diagnóstico, chamadas avulsas), when o limiter é criado, then a taxa efetiva é o **menor** `rpsMax` da tabela (**5 req/s**) — o valor seguro quando não se sabe quem mais está no ar.
- Given `TSE_MAX_RPS` acima do teto de segurança de 50 req/s, when o limiter é criado, then a taxa é clampada a 50 req/s e nunca ultrapassa esse ceiling (modo supervisionado).
- Given os quatro cargos emitindo requisições em paralelo no mesmo IP do TSE, when a soma dos tetos da tabela é calculada (`piorCasoAgregadoRps()`), then o agregado é ≤ 80 req/s — o que faz o teste falhar automaticamente se um cargo novo entrar na tabela ou um `rpsMax` subir.
- Given um cargo de granularidade zona, when o ciclo roda ao teto do cargo, then a duração projetada cabe no `maxDuration` de 300 s — ~244 s a 25 rps para os pesados, e ~204 s por fatia para Deputado Federal, cuja varredura é dividida em 6 (ADR-0036) justamente porque os 6.110 alvos a 5 rps levariam ~1.222 s de uma vez.
- Given uma resposta 429 ou 503, when o cliente trata o erro, then a requisição é **retryável** e o `Retry-After` indicado é honrado (`max(backoff, retryAfterMs)`), em vez de derrubar o ciclo ou repetir imediatamente.
- Given um ciclo completo, when os contadores são lidos, then `rateLimited` (429 observados) e `waitedMs` são reportados em `ingest_log` e disparam alerta quando `rateLimited > 0`.

**Histórico**: em 2026-09-05 o ceiling era 80 req/s, acima do teto exigido aqui, e desceu para **50** com o default em 30. Em 2026-09-11 o cron passou a ser por cargo — duas invocações no mesmo IP — e o default subiu para 50, o que punha o agregado em exatamente 100. A auditoria constitucional do mesmo dia recusou esse valor (§ 1 exige teto "bem abaixo") e o default recuou para **40**, agregado 80. Ainda em 2026-09-11, a entrada de Senador e Deputado Federal (ADR-0026) levou os crons de dois para **quatro**: 4 × 40 daria **160 rps**, e o default único deu lugar a um teto **por cargo**, com Senador reclassificado para zona (por isso os pesados caíram de 35 para 25 — 3 × 35 seria 110). Em 2026-09-13 o ADR-0036 levou Deputado Federal também para zona **sem** mexer no seu rps: manteve 5 e dividiu a varredura em 6 fatias, preservando o agregado em 80. A fonte canônica é `lib/config/cargos.ts` (`rpsMax`); `lib/tse/rate-limiter.ts` e `tests/unit/tse/rate-limiter.test.ts` derivam dela em vez de repetir números.

**RF-010.4 — Requisição condicional ciente de que 304 consome cota**

WHEN o sistema refaz o GET de um arquivo EA20 já conhecido, the system SHALL enviar `If-None-Match` com o último ETag conhecido e SHALL contabilizar a resposta **304 no orçamento de taxa** como uma requisição plena — a requisição condicional economiza banda, não cota.

⚠️ **Base da exigência**: postura conservadora de engenharia, **não** regra documentada pelo TSE. O material oficial é silente sobre cache condicional. O requisito permanece como está até que o TSE responda; se confirmar que 304 não consome cota, este RF deve ser revisto — e não o contrário.

**Aceitação**:
- Given um ETag conhecido, when o GET é feito, then `If-None-Match` é enviado e o token do rate limiter foi adquirido antes do envio.
- Given o TSE responde 304, when o cliente processa, then nenhum snapshot é gravado, mas a requisição já contou no orçamento do ciclo.
- Given um ciclo em que todos os alvos respondem 304, when o dimensionamento do ciclo é avaliado, then o número de requisições planejadas — não o número de downloads — é o que se compara ao limite do TSE.

**RF-010.5 — Proibição absoluta de sondar URL adivinhada**

IF uma URL do CDN do TSE não puder ser derivada deterministicamente da padronização documentada ([tse-2026-leiautes.md § 1](../../reference/tse-2026-leiautes.md)) ou de um alvo confirmado por EA11 (configuração), EA14 ou EA15 (acompanhamento), the system SHALL NOT requisitá-la — nunca por tentativa e erro, varredura ou enumeração — porque **não existem índices de arquivo** no CDN e um **404 malformado também pode bloquear o IP**, com limiar não divulgado pelo TSE.

**Aceitação**:
- Given um alvo de qualquer nível (br/uf/município/zona), when sua URL é construída, then vem de um builder (`buildEA20UrlBr|Uf|Municipio|Zona`, `buildEA14Url`, `buildEA15Url`) alimentado por `TSE_COD_ELEICAO` validado — nenhuma URL montada ad hoc no call site.
- Given `TSE_COD_ELEICAO` ausente ou fora do formato `ele<AAAA>/<dígitos>`, when o ciclo inicia, then falha com erro explícito **antes** de qualquer GET.
- Given um script operacional de monitoramento (`pnpm tse:watch`), when ele roda, then só requisita URLs de uma lista de alvos preenchida por humano — zero URLs adivinhadas.
- Given a documentação operacional, when é lida, then não instrui ninguém a forçar 404 contra o CDN do TSE.

**RF-010.6 — Identificação honesta no User-Agent**

WHEN o sistema faz qualquer requisição ao CDN do TSE, the system SHALL enviar um `User-Agent` que identifique o projeto por nome, URL pública e contato verificável, e SHALL NOT declarar cadastro, credenciamento ou homologação junto ao TSE.

**Aceitação**:
- Given qualquer requisição, when os headers são inspecionados, then há `User-Agent` no formato `AtlasMenna/<versão> (+<url pública>)` — hoje `AtlasMenna/1.0 (+https://atlasmenna.online)`, sem e-mail desde 03/10 (a caixa declarada antes nunca existiu) — e `Accept: application/json`.
- Given o valor do `User-Agent`, when se busca por "cadastr"/"credenci"/"homolog", then não há ocorrência.

## Requisitos Não-Funcionais aplicáveis

- Defasagem TSE → tela <90s — [RNF-006](../../nfr/performance.md) (revisado de <30s por [ADR-0011](../../architecture/adrs/0011-cadencia-60s.md)) [⚠️ meta de S07 adiada para re-calibração pós-simulado 1 — medida local em 05/09 com mock indicou ~130–160s em modo `zona`].
- Recuperação automática após falha do TSE — [RNF-011](../../nfr/availability.md).
- Graceful degradation com último valor conhecido — [RNF-012](../../nfr/availability.md).
- Endpoint `/api/ingest` cron-only — [RNF-016](../../nfr/security.md).
- Logs estruturados e métricas custom — [RNF-032, RNF-033, RNF-034](../../nfr/observability.md).

## Telas

Nenhuma tela direta. O dashboard `/_status` ([spec 012](../012-dashboard-status/spec.md)) consome métricas deste pipeline.

## Open questions

**Resolvidas** (2026-09-05):

- ~~Caso o TSE mude formato EA20 sem aviso, qual o tempo máximo aceitável para hotfix?~~ — o TSE **não anuncia freeze de leiaute**, então a estratégia deixou de ser "hotfix rápido" e passou a ser tolerância estrutural: schema `.passthrough()` em todos os níveis (nunca `.strict()`), fixtures do simulado como regressão, e `pnpm tse:watch` monitorando `ele-c.json` + os 9 leiautes publicados. Risco residual (campo consumido renomeado silenciosamente) está nomeado em [ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md).
- ~~Persistir EA20 raw em Blob além de JSONB no Postgres?~~ — decidido **só Postgres** (`snapshots.payload` JSONB, decisão D-3 em [tasks.md](./tasks.md)). Dual-write para Blob fica em backlog por custo.

**Abertas**:

- **Granularidade do fan-out em produção** — `TSE_GRANULARIDADE=uf` (default, ~55 GETs/ciclo) atende as telas, mas **não** alimenta o swing zona-a-zona vs. 2022 exigido por RF-011/RF-012 da [spec 002](../002-modelo-estatistico/spec.md), porque o arquivo agregado de UF já vem sem a granularidade de zona. O desenho recomendado é **híbrido** (UF/BR a cada ciclo para as telas; zona só nas UFs que o EA14 sinalizar como alteradas), mas a escolha entre híbrido e "zona escopado por EA14" depende de medir latência e volume no simulado de 15–17/09. **Decisão humana pendente** — ver [design.md § Granularidade](./design.md) e [tse-2026-leiautes.md § 6](../../reference/tse-2026-leiautes.md).
- **Texto de contato do User-Agent** (RF-010.6) — URL ou e-mail público verificável, hoje `contato: pendente`.

## Cross-refs

- Design técnico: [./design.md](./design.md)
- Leiautes oficiais TSE 2026 (fonte de verdade técnica): [../../reference/tse-2026-leiautes.md](../../reference/tse-2026-leiautes.md)
- ADR-0020 (conformidade Res. 23.751/2026, sem cadastro): [../../architecture/adrs/0020-conformidade-res-23751-2026.md](../../architecture/adrs/0020-conformidade-res-23751-2026.md)
- Modelo de dados: [../../architecture/data-model.md](../../architecture/data-model.md)
- APIs internas: [../../architecture/apis-internas.md](../../architecture/apis-internas.md)
- Constituição §§ 1, 7, 10: [../../constitution.md](../../constitution.md)
