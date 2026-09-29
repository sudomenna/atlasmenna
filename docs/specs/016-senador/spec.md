---
id: 016-senador
title: Senador — corrida majoritária de 2 vagas por UF
status: shipped
priority: M
personas: [P1, P2, P3]
screens: [T-09, T-10]
requirements: [RF-100, RF-101, RF-102, RF-103, RF-104, RF-105, RF-106, RF-107, RF-108, RF-179, RF-184, RF-181, RF-185, RF-186, RF-187, RF-188, RF-180, RF-189, RF-191]
depends_on: [001-ingestao-tse, 002-modelo-estatistico]
apis: [GET /api/ingest/senador, POST /api/ingest/senador, GET /api/projection?cargo=senador]
components: [ResultPanel, CandidateListCollapse, ChancesPanel, CargoTabs, RaceHeader, ForecastTransparency, NationalChoroplethMap, ChoroplethMapUF, StateResultSheet, UfHoverLink, MunicipioTable, MunicipioExplorer, GovernorCard, HoverCard]
nfr: [RNF-001, RNF-002, RNF-003, RNF-006, RNF-022, RNF-023, RNF-024]
adrs: [0001, 0012, 0020, 0021, 0026, 0028, 0033, 0034, 0035, 0038, 0042, 0048, 0050, 0051, 0053, 0055, 0056, 0057]
opens_after: 2026-09-11
---

> **Promovida a `shipped` em 2026-09-20**, depois dos quatro portões de
> [`CLAUDE.md § 9`](../../../CLAUDE.md):
>
> | Portão | Veredito |
> |---|---|
> | Cobertura de RF | ✅ 9/9 RFs `M` com teste que discrimina (46 vitest + 29 pytest) |
> | Constituição | ✅ sem violação; 341 testes rodados em 10 arquivos |
> | Acessibilidade / performance | ❌ → ✅ **reprovou na primeira passada** e passou depois do conserto |
> | Documentação sincronizada | ✅ este commit |
>
> 🔴 **O portão de acessibilidade reprovou de verdade**, e vale registrar por quê: a coluna
> "Margem" da `<MunicipioTable>` — tela que esta spec passou a montar em 2026-09-20 — pintava
> **texto** com a cor de *preenchimento* do partido. Medido: PSOL **2,08:1** contra o piso de
> 4,5:1 do RNF-022. O defeito **não era de 20/09**: o handoff de 19/09 já o registrava, e ele
> sobreviveu a uma reescrita inteira do arquivo sem que nenhum teste o pegasse. Corrigido para
> `candidateMarkerColor` (a variante `-text`) nas três rotas de UF, e agora as **32 siglas**
> medem ≥ 4,50 contra `--surface-page`.
>
> ⚠️ **Margem de erro zero, e isto é dívida registrada**: as duas piores siglas (AGIR 4,502 ·
> REDE 4,505) ficam praticamente na linha. Qualquer mudança em `--paper-1` derruba 32 tokens de
> uma vez. Ver `docs/reference/dividas-tecnicas.md`.
>
> **O que NÃO bloqueou, por decisão de escopo:** o tom claro de 15 dos 32 partidos ainda se
> confunde com `--map-uncounted` no mapa — mas isso é o mesmo mapa que Presidente e Governador
> já usam em produção sob spec `shipped`, não é regressão nem é específico de Senador.


# Spec 016 — Senador

**Rotas**: `/senador` (nacional) e `/uf/[sigla]/senador` (por estado)
**Cargo TSE**: 5 · **Turno único** · **2 vagas por UF** · granularidade **zona**

## Status

`draft`. Escrita em 2026-09-11 a partir do [ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md),
que fixou ingestão e read path em 07/09 mas não gerou spec. Implementada no
mesmo dia: ingestão (6.110 alvos por ciclo, cron de 5 min), modelo, payload e as
duas rotas. Pendentes os gates (`rf-coverage-checker`, `constitution-guard`,
`a11y-perf-auditor`) e as duas open questions abaixo.

## Objetivo

Cobrir a disputa do Senado em 2026 com a mesma qualidade de projeção dos cargos
majoritários já cobertos, respeitando a diferença que muda tudo na leitura:
**são duas vagas por estado, não uma**. Um leitor que veja a tela de Senador com
a gramática de "quem está na frente" vai ler errado — o que importa é **quem são
os dois primeiros**, e a margem que interessa é a do **2º para o 3º**, não a do
1º para o 2º.

## Escopo

### Dentro

- Ingestão do cargo 5 em granularidade **zona** (6.110 pares por ciclo), cron de
  5 minutos — implementado em 2026-09-11. ⚠️ O ADR-0026 item 1 previa `uf`; a
  reversão para `zona` está registrada como emenda (b) naquele ADR e tem motivo
  medido: com um boletim por estado, `p_eleito` degenera para 0% ou 100%.
- Projeção pela regra de três do [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md),
  **zona a zona**, como Presidente e Governador.
- `p_eleito` para cada candidato — probabilidade de terminar entre os dois
  primeiros.
- Duas rotas, com o `<ResultPanel>` do [ADR-0034](../../architecture/adrs/0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
  adaptado a duas vagas.
- Agregado nacional por composição partidária das 54 vagas em disputa.
- **Mapa municipal (desde 2026-09-19).** Coroplético de municípios por UF,
  reaproveitado de Governador (spec 005 RF-005.2/RF-005.4). Acessível em `/uf/[sigla]/senador`
  via a moldura persistente (`PersistentMapFrame`, ADR-0033). ⚠️ Cobertura municipal é
  estruturalmente parcial em todos os cargos: município sem par (município × zona) apurado não
  recebe linha (`docs/reference/risks.md:78`).

### Fora
- ~~**As 27 vagas que não estão em disputa.** 2026 renova 2/3 do Senado; os
  senadores eleitos em 2022 com mandato até 2031 não aparecem na apuração e não
  devem aparecer como "eleitos" na tela.~~
  > 🔴 **EMENDADO em 2026-09-29 pela [spec 023](../023-senado-2027/spec.md)
  > (decisão do dono).** As 27 cadeiras que não estão em disputa **passam a
  > aparecer** em `/senador`, no hemiciclo de 81 cadeiras (RF-216), com o partido
  > atual de quem ocupa a cadeira hoje, suplente incluído (RF-215) — rotuladas
  > "mandato até 2031 — não estão em disputa" e **nunca** como "eleitos" (RF-218).
  > O que continua valendo desta linha: elas não entram na apuração, não entram
  > na contagem das 54 (RF-107) e não são apresentadas como resultado de 2026.
- **2º turno.** Não existe para este cargo.

## Requisitos Funcionais

### Ingestão e dado

**RF-100 — Ingestão do cargo 5 em granularidade de zona**

WHILE estamos na janela de apuração, the system SHALL acionar
`/api/ingest/senador` a cada 5 minutos, produzindo **6.110 alvos** (um por par
município×zona, sem arquivo agregado `br-`), conforme a emenda (b) do
[ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md).

**Aceitação**:
- Given `TSE_CARGOS` ausente, when `listIngestTargets(production, {cargo: 5})`
  roda, then devolve exatamente 6.110 alvos, todos `nivel: "zona"`.
- Given o orçamento de requisições, when os quatro crons coincidem, then o pior
  caso agregado é **80 rps** (3 × 25 + 1 × 5), 20% abaixo do teto do TSE.
- Given `TSE_CARGOS=1,3`, when o cron de Senador dispara, then nenhum alvo é
  produzido — a chave de desligamento tem precedência (`lib/tse/targets.ts::filterCargos`).

**RF-101 — Suplentes preservados no snapshot**

WHEN o parser lê um envelope EA20 de cargo 5, the system SHALL preservar o array
`vs[]` (vice/suplentes, `lib/tse/ea20-schema.ts:91`) no payload persistido, sem
descartá-lo.

**Aceitação**:
- Given um envelope com `vs: [{tp: "s1"...}, {tp: "s2"...}]`, when o snapshot é
  gravado, then os dois suplentes estão recuperáveis do payload bruto
  (constituição § 6 — todo valor exibido reproduzível do snapshot).

### Modelo

**RF-102 — Projeção por regra de três, zona a zona**

WHEN o modelo roda para cargo 5, the system SHALL aplicar a extrapolação do
ADR-0021 zona a zona, como nos demais majoritários, e rotular a saída com
`metodo.granularidade = "zona"`.

**Aceitação**:
- Given uma UF com 40% apurado, when o modelo projeta, then `pct_projetado` de
  cada candidato soma 100 sobre a base escolhida e `metodo.granularidade` é `"zona"`.
- Given uma UF sem nenhum arquivo apurado, when o modelo roda, then a UF sai como
  `aguardando`, **nunca** com projeção imputada do nacional — a composição
  partidária do Senado varia demais entre estados para que a imputação nacional
  signifique alguma coisa (diferença deliberada em relação ao RF-017 de Presidente).

**RF-103 — `p_eleito` para duas vagas**

WHEN o modelo calcula probabilidades para cargo 5, the system SHALL emitir
`p_eleito` por candidato = fração das reamostras do bootstrap em que aquele
candidato termina em **1º ou 2º lugar**, e NÃO `p_vitoria` (1º lugar).

**Aceitação**:
- Given 4 candidatos, when o modelo roda, then `Σ p_eleito ≈ 2,0` (duas vagas),
  não 1,0.
- Given um candidato em 3º com IC sobreposto ao 2º, when o modelo roda, then seu
  `p_eleito` é estritamente maior que zero.
- Given a mesma semente, when o modelo roda duas vezes, then a saída é idêntica
  bit a bit (constituição § 6).

**RF-104 — Margem relevante é a do 2º para o 3º, inclusive na intensidade da cor do mapa**

WHEN a UI exibe a margem de uma UF de Senador, the system SHALL exibir a
diferença entre o **2º e o 3º** colocados, rotulada como "margem para a 2ª vaga",
e não a diferença entre 1º e 2º. Esta margem alimenta três superfícies:
(1) a figura textual na ficha de estado (UR T-10);
(2) o rótulo da view de "margem" no seletor de visualizações;
(3) a intensidade da cor do estado no mapa nacional (`<NationalChoroplethMap>`, ADR-0048) — a cor avança do neutrino para o saturado conforme a margem 2º→3º cresce.

**Aceitação**:
- Given 1º com 40%, 2º com 30% e 3º com 29%, when a tela renderiza, then a
  margem exibida é **1 pp**, não 10 pp.
- Given uma UF com margem 2º→3º de 15 pp, when o mapa renderiza, then a cor é mais
  saturada que uma UF com margem 1 pp.

### Telas

**RF-105 — Painel de resultado com duas vagas (T-10), reaproveitado no mapa nacional**

WHEN `/uf/[sigla]/senador` renderiza, the system SHALL marcar visualmente os
**dois** primeiros colocados como ocupantes das vagas, com o mesmo tratamento —
sem hierarquia visual entre 1º e 2º, que não existe no resultado. Este mesmo
tratamento é reaproveitado na ficha (`<StateResultSheet>`) que abre ao tocar
num estado no mapa nacional (`/senador`, nivel Brasil, ADR-0048, ADR-0050), no
balão que abre ao passar o mouse sobre ele (desktop) e nos cartões "Estado a
estado" da capa `/senador` — em todo estado do selo de eleito (emenda de
2026-09-29, abaixo).

**Aceitação**:
- Given o payload de uma UF, when a tela renderiza, then exatamente 2 linhas
  carregam o marcador de vaga.
- Given a lista completa, when colapsada (ADR-0034 D21), then as 2 linhas de vaga
  permanecem no DOM, visíveis (ADR-0017).
- Given `/senador` (nível Brasil) + clique numa UF, when a ficha abre, then os
  dois ocupantes das vagas são marcados visualmente (mesmos `role="region"`/styles).

> 🔴 **Emenda 2026-09-29 (decisão do dono: "são 2 senadores eleitos. Os dois primeiros
> colocados de cada estado são eleitos").** Até esta data duas superfícies marcavam só o
> líder ou ninguém: o ✓ de corrida chamada no balão do mapa (só o 1º) e os cartões da capa
> `/senador` (nenhum selo, nota de 27/09 do RF-107). O selo de eleito passa a valer para os
> **dois ocupantes de vaga** em toda superfície de Senador e em todos os seus estados:
>
> | Estado do selo | Superfície | Quem leva |
> |---|---|---|
> | **Chamada** (a corrida decidida pelo modelo — ✓ com faixa de cor) | balão do mapa nacional (desktop) | os 2 primeiros que disputam **pela projeção** |
> | **Projetado** ("Vaga projetada") | página da UF, folha do toque (celular), balão do mapa | os 2 primeiros que disputam na base "Projeção" |
> | **Parcial** ("Vaga na parcial") | página da UF, folha do toque (celular), balão do mapa | os 2 primeiros que disputam na base "Parcial" |
> | **Eleito pela projeção** ("● ELEITO", o mesmo selo do cartão de governador) | cartões "Estado a estado" de `/senador` | os 2 primeiros que disputam na ordem do cartão (projeção), com apuração começada |
> | **Decidida** (UF com 100% apurado) | hemiciclo de 2027 (spec 023) | os 2 primeiros — já era assim |
>
> - **`chamada` no Senado passa a significar "as DUAS vagas decididas"**: margem da 2ª vaga
>   (2º − 3º que disputam, na base publicada) > 10 pp — `chamada_da_corrida`,
>   `api/model/project.py`. Com a margem do 1º sobre o 2º (a regra até esta data, herdada da
>   vaga única), um 40 / 29,9 / 29,8 era "chamado" e a tela proclamaria eleito um 2º empatado
>   com o 3º (constituição § 1). Menos de 3 candidaturas que disputam ⇒ não chamada.
>   Governador e Presidente: a regra de sempre (1º − 2º > 10), byte a byte.
> - **O rótulo segue a base que a lista DE FATO usou**: a folha do toque dizia "Vaga
>   projetada" também sob a ordem do apurado — corrigido (RF-184).
> - **Anulada nunca ocupa vaga** (ADR-0053 / RF-213): o 3º que disputa sobe. A ordem é a da
>   base ativa (ADR-0051); empate, o desempate do comparador de cada base.
> - **Não é resultado oficial.** O payload não carrega a situação de eleito do TSE (`st` do
>   EA20); "chamada" e "decidida" são leituras do modelo e da apuração, e os rótulos dizem
>   isso ("projetada", "na parcial", "Não oficial" na capa).
> - **Ponto único**: `lib/utils/vagas-eleitas.ts` (quem ocupa as vagas numa ordem) e
>   `vagasDaCorrida` (`lib/config/cargos.ts`, quantas — sem o default `?? 1`, que marcaria só
>   o líder em silêncio se a tabela perdesse o número).
> - O mapa continua pintando cada UF pela cor do 1º colocado (decisão D1, RF-106); a ressalva
>   "2 vagas" segue no nome acessível.
>
> **Aceitação adicional**:
> - Given uma UF chamada com 45 / 30 / 15 / 10 pela projeção, when o mouse passa sobre ela no
>   mapa nacional, then o ✓ aparece nas DUAS primeiras linhas do balão e não na 3ª.
> - Given a base "Parcial" com ordem diferente da projeção, when a folha do celular abre, then
>   as duas primeiras do apurado levam "Vaga na parcial".
> - Given uma candidatura anulada em 2º na projeção, when qualquer superfície renderiza, then a
>   2ª vaga vai para a 3ª que disputa, e a anulada não leva selo nenhum.
> - Given 40 / 29,9 / 29,8 pela projeção, when o modelo publica a UF de Senador, then
>   `chamada === false`; given 45 / 44 / 20, then `chamada === true`.
> - Given uma UF de Governador chamada, when o balão abre, then o ✓ continua só no líder.
>
> Testes: `tests/unit/components/senado-dois-eleitos.test.tsx`,
> `tests/unit/utils/vagas-eleitas.test.ts`, `tests/unit/model/test_chamada_senado_duas_vagas.py`,
> `tests/unit/pages/senador.test.tsx` (g).

**RF-106 — Rótulo explícito de duas vagas, incluindo no nome acessível do mapa**

WHEN qualquer tela de Senador renderiza, the system SHALL exibir o texto "2 vagas
por estado" junto ao título da corrida. Este aviso também entra no nome acessível
do mapa nacional (`aria-label` de `<NationalChoroplethMap>` no nível Brasil, ADR-0048 item 5, RNF-025/WCAG SC 4.1.2) — quem ouve "Por líder — Senado: 2 vagas por estado" sabe que a cor única não promete um vencedor único.

**Aceitação**:
- Given `/senador` ou `/uf/XX/senador`, when renderiza, then o texto está
  presente. ⚠️ O kit de UI rotula **"1 vaga"**
  (`docs/architecture/adrs/0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md:56`)
  — esse rótulo **não deve ser herdado**.
- Given `/senador` (nível Brasil) + leitor de tela, when navega para o mapa,
  then ouve a menção de "2 vagas por estado" no `aria-label`.

**RF-107 — Composição nacional das 54 vagas (T-09)**

WHEN `/senador` renderiza, the system SHALL exibir a contagem de vagas projetadas
por partido/federação, deixando explícito que são **as 54 em disputa**, não a
composição total de 81 cadeiras do Senado.

**Aceitação**:
- Given qualquer estado de apuração, when a tela renderiza, then o denominador
  exibido é 54 e há texto distinguindo-o das 81 cadeiras.

> **Nota 2026-09-27 (decisão do dono) — a lista "Estado a estado" de `/senador` (T-09).**
> Passou a usar o mesmo cartão da grade de `/governador` (`<GovernorCard cargo="sen">`):
> as quatro primeiras posições e "Outros", sempre em % dos votos válidos da UF, com o
> apurado no cabeçalho. ~~Sem o selo de status do governador ("● ELEITO" / "VAI A 2T"),
> que não se aplica a turno único com duas vagas; o rótulo acessível nomeia os dois
> primeiros.~~ **Revogado em 2026-09-29 (emenda do RF-105):** o "● ELEITO" volta ao
> cartão, nos DOIS ocupantes de vaga (a objeção de 27/09 era o selo só no líder); "VAI A
> 2T" / "EM APURAÇÃO" continuam fora. O rótulo acessível diz "eleitos" e nomeia os dois. Substitui a linha de 19/09 ("ocupantes · Fora das vagas · margem p/ 2ª vaga").
> A margem 2º→3º (RF-104) segue nas três superfícies que o RF lista — nenhuma delas é
> esta lista. Testes: `tests/unit/pages/senador.test.tsx` (f), (g), (g4), (g6) e
> `tests/unit/pages/anulada-paginas.test.tsx`.

**RF-108 — Transparência de cadência**

WHEN uma tela de Senador exibe projeção, the system SHALL exibir que a
atualização é a cada 5 minutos (constituição § 8, ADR-0026 item 5).

**Aceitação**:
- Given a tela renderizada, when o leitor busca a metodologia, then a cadência
  está legível sem clique.
- Nota: o aviso de "projeção em nível de estado" deixou de ser necessário quando
  o cargo passou a ser ingerido por zona. A guarda de tela
  (`temIncertezaMedida`) **permanece**, para o caso de uma UF vir com uma única
  zona apurada — aí o intervalo volta a ser degenerado e a chance não é exibida.

> ⚠️ **Nota 2026-09-27 ([ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md), RF-213 da spec 002).** `p_eleito` (RF-103), o líder e a margem 2º→3º (RF-104) já saem do modelo com toda candidatura de `dvt = "Anulado"` excluída do ranking de duas vagas — nenhuma lógica nova é necessária nesta spec. Candidatura `dvt = "Anulado sub judice"` continua elegível às duas vagas normalmente (ponto aberto, pendente confirmação jurídica). Isto é especialmente relevante para Senado: com 2 vagas por UF, uma candidatura anulada em 2º lugar hoje ocuparia uma vaga real no ranking de `p_eleito` — o RF-213 fecha esse caso.
>
> 🔴 **EMENDADO em 2026-09-27 (tarde), decisão do dono, opção A ([ADR-0053, emenda](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md#emenda-2026-09-27-tarde-a-lista-passa-a-mostrar-a-base-da-disputa)).** Além de sair do ranking de duas vagas, a candidatura `dvt = "Anulado"` também deixa de ter percentual na lista de candidatos (`<CandidateListCollapse>`, `<StateResultSheet>`) — mostra só o total de votos, em VOTOS (RF-210, 2 por eleitor). Quando há candidatura anulada na UF, o percentual de toda candidatura que compete passa a ser fração dos **votos em disputa** (`vvc − Σ votos das candidaturas anuladas`, em votos), não de `vvc` inteiro — a mesma base que decide `p_eleito`, líder e margem. Sem candidatura anulada na UF — o caso hoje observado —, nada muda.

### Cobertura municipal e tabela de municípios (S08/2026-09-19/20)

**RF-179 — Mapa municipal de Senador no nível UF**

WHEN um usuário acessa `/uf/[sigla]/senador` (página de resultado do Senado por estado), the system SHALL exibir um mapa coroplético de municípios do estado, colorido pela liderança em votos ou projeção, acompanhado de lista paginada de municípios.

**Aceitação**:
- Given a rota `/uf/SP/senador`, when renderiza, then um `<ChoroplethMapUF>` de São Paulo aparece com os municípios coloridos por líder (Senador cargo 5).
- Given município sem par (município × zona) apurado em nenhuma zona do estado, when o mapa renderiza, then o município recebe cor default (sem dados) ou é omitido da coloração (cobertura estruturalmente parcial — apenas pares município×zona com apuração recebem projeção).
- **Restrição de cobertura** — a cobertura municipal é estruturalmente parcial neste e em todos os cargos, dependendo da granularidade de zona apurada: `risks.md § XX` detalha que ~31% dos votos podem estar sob município sem par apurado. Este RF promete exibir o mapa; **não promete 100% de cobertura geográfica**.

**RF-184 — VagaBadge por base (Senador)**

WHEN um candidato ao Senado está visível em tabela de resultado em `/uf/[sigla]/senador` ou `/senador` (ficha de UF no mapa nacional), the system SHALL exibir um badge `<VagaBadge>` que indica seu estado de ocupação de vaga segundo a base ativa (Parcial/Projeção):
- Base Projeção: "Vaga projetada" se em top-2 na projeção, "Indefinido" caso contrário.
- Base Parcial: "Vaga na parcial" se em top-2 no apurado, "Indefinido" caso contrário.

**Aceitação**:
- Given candidato em 1º lugar na base projeção, when seletor = "proj", then badge diz "Vaga projetada".
- Given mesmo candidato em 4º lugar na base parcial, when seletor = "parcial", then badge diz "Indefinido" (4º não ocupa vaga, são apenas 2 vagas).
- Given candidato não em top-2 em nenhuma base, when renderiza em qualquer seletor, then badge exibe "Indefinido".
- Given a base muda do seletor Parcial/Projeção, when a linha re-renderiza, then o texto do badge acompanha a nova base sem latência.

## Requisitos Não-Funcionais

Herda RNF-001 (LCP), RNF-002/003 (Core Web Vitals), RNF-006 (defasagem <90 s —
aqui relaxada para a cadência de 5 min do cargo), RNF-022/023/024 (a11y).

## Degradação pré-acordada

Esta spec **não** tem cláusula de desistência — a que foi acordada em 07/09 vale
para a [spec 017](../017-deputado-federal/spec.md). Senador reaproveita o
estimador existente e não depende de módulo novo de cálculo.

## Open questions

1. **`p_eleito` com candidatura de partido nanico e IC muito largo** — o bootstrap
   pode dar `p_eleito` não desprezível a quem está a 20 pp do 2º. Definir um piso
   de exibição, ou exibir o número cru? Decidir com dado do simulado.
2. **Agregado nacional** — o TSE não publica arquivo `br-` para cargo 5
   (`lib/config/cargos.ts`, `temArquivoBr: false`), então a composição nacional é
   soma nossa das 27 UFs. Isso é **agregação**, não estimativa, e não fere a
   constituição § 6 — mas a tela precisa dizer de onde vem o número.

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26)

O painel "Votação" (RF-192..199) **não entra** na tela nacional `/senador`. Entra apenas na tela de UF `/uf/[sigla]/senador`, imediatamente após o `<ResultPanel>` (spec 021 RF-192 emendado, 2026-09-26 noite).

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) **não entra** na tela nacional `/senador`. Entra apenas em `/uf/[sigla]/senador` imediatamente depois do `<ResultPanel>`. Os três círculos ficam em "aguardando" (RF-210) até haver captura real de cargo 5 para medir como o TSE conta os dois votos por eleitor. O produtor já publica `corrida` (UF) para Senador; `corrida_por_partido` não é usado neste cargo.

### Spec 023 — Senado de 2027 (2026-09-29)

As 27 cadeiras com mandato até 2031 saem do "Fora" desta spec (ver a emenda no próprio item) e
entram em `/senador` no hemiciclo de 81 cadeiras, logo depois do bloco "As 54 vagas em disputa"
(RF-215..RF-218). A barra das 54 (RF-107) continua, agora pintada pela paleta de partido
(`textForParty`), a mesma do hemiciclo, e não mais pela posição no ranking (RF-219, ADR-0024).

### Spec 025 — Visões editoriais em `/senador` (2026-09-29)

Todas desligadas até o dono ligar a chave em `editorial/etiquetas/publicar.json` ([spec 025](../025-visoes-editoriais/spec.md)): **V1** "Senado de 2027: quem terá maioria" (as 81 cadeiras por bloco de relação com o governo Lula, marcas 41/49/54) e **V2** "Impeachment de ministros do STF no Senado de 2027", logo depois do hemiciclo de 81 por partido; **V4** "Renovação", só com UF de apuração concluída; o **filtro por etiqueta** e os chips nos cartões do "Estado a estado" (tokens no `<li>` de cada corrida; região sem corrida no filtro some). A página continua estática (ISR 60 s, sem `searchParams`).
