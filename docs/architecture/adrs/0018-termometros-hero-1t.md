---
id: ADR-0018
title: Seis termômetros de projeção como hero do 1º turno, não duelo top-2
status: superseded
date: 2026-09-05
supersedes: ADR-0017 (parcial — apenas a definição da Camada 1 em modo `multi-1t`)
amended_by: ADR-0029 # posição do hero no fluxo da página; conteúdo e denominadores inalterados
superseded_by: ADR-0034 # painel de resultado do protótipo substitui os termômetros como hero em 3 das 4 rotas; metodologia (denominadores, IC) segue vigente via ADR-0022 em /governador
---

# ADR-0018 — Seis termômetros de projeção como hero do 1º turno, não duelo top-2

## Status

Aceito (histórico — ver nota de 2026-09-10 abaixo: `superseded` desde então).

> **Nota 2026-09-08 (ADR-0029).** A posição de `<ProjectionThermometers />` no fluxo da página muda — passa a vir logo abaixo do bloco de mapa, não acima dele, como parte da recomposição "mapa primeiro" da home mobile-first. O conteúdo, os denominadores por categoria e o cálculo de IC por soma de resamples permanecem exatamente como decidido aqui. O usuário confirmou esta leitura em 2026-09-08, ao escolher manter os seis termômetros em vez de adotar o duelo top-2 do protótipo do kit: numa disputa de 9 candidatos, o padrão do protótipo reproduziria as razões (i) e (ii) que este ADR listou para rejeitá-lo.

> **Superseded em 2026-09-10 por [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md).** A reversão do hero do `multi-1t` registrada na nota de emenda do ADR-0029 (D17, 2026-09-08) deixou de ser só de posição: o ADR-0034 substitui inteiramente os seis termômetros pelo `<ResultPanel>` do kit na home e nas duas rotas de UF. As quatro razões pelas quais este ADR rejeitou o duelo top-2 (esconder o 3º colocado competitivo; omitir participação; misturar denominadores `v.vvc`/`e.c`/`e.esi`; IC de "Outros" incorreto por subtração) permanecem corretas como diagnóstico — o ADR-0034 não as refuta, registra que o usuário aceitou os custos que elas descrevem. A metodologia deste ADR (denominadores, IC de "Outros" por soma de resamples) continua sendo a fonte de verdade da única instância remanescente de `<ProjectionThermometers>`, em `/governador` (`variant="participacao-only"`, ADR-0022 — não revisto por este ADR nem pelo ADR-0034).

> **Emendado parcialmente em 2026-09-27 (tarde) por [ADR-0053, emenda "a lista passa a mostrar a base da disputa"](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md#emenda-2026-09-27-tarde-a-lista-passa-a-mostrar-a-base-da-disputa), decisão do dono.** A regra central deste ADR — candidatos e "Outros" sempre em percentual de `v.vvc` **inteiro**, sem exceção — deixa de valer quando a abrangência (Brasil para Presidente; a UF para Governador/Senador; município e mesorregião no escopo da UF) tem ao menos uma candidatura com `dvt = "Anulado"`. Nesse caso, todo percentual publicado e exibido de candidatura que ainda compete passa a ter como base os **votos em disputa** (`vvc − Σ votos das candidaturas anuladas`) — a mesma base que o ADR-0053 original já usa para decidir líder e 1º turno —, e a candidatura anulada perde percentual (mostra só votos, com etiqueta "Anulado"). Sem nenhuma candidatura anulada na abrangência — o caso observado em todos os ciclos do simulado até esta data — o denominador continua sendo `v.vvc` inteiro exatamente como decidido aqui, e nada nesta emenda muda o número exibido. A instância remanescente deste ADR (`/governador`, `variant="participacao-only"`) usa apenas os termômetros de participação (abstenção, brancos/nulos), que não são fração de `vvc` e por isso não são afetados por esta emenda.

> **Nota 2026-09-27 (decisão do dono, [ADR-0022](0022-participacao-governador-fora-do-dom.md#status) `deprecated`).** A instância remanescente citada nas duas notas acima e na nota de 2026-09-10 abaixo — `/governador`, `variant="participacao-only"` — saiu da rota: o dono removeu o bloco de participação nacional inteiro de `/governador`, nos dois estados do payload. `ProjectionThermometers` deixa de ter qualquer instância ativa no produto (já havia saído de `/`, `/uf/[sigla]` e `/uf/[sigla]/governador` pelo ADR-0034). Isto não reabre nem revisa a metodologia de denominadores/IC fixada por este ADR — ela permanece a fonte de verdade caso o componente volte a ser usado — apenas registra que hoje não há nenhum call site.

## Contexto

A home nacional despacha entre `mode: "binary"` e `mode: "multi-1t"` em `app/page.tsx:110-111`, a partir de `payload.turno` / `candidatos.length`. Hoje, em 1T com ~9–11 candidatos, o hero é o `<HeadlineScore />` (top-2 lado a lado, herdado do desenho binário de 2T) mais a `<NationalNeedle variant="national-1t" />` — que mede `p_segundo_turno` (probabilidade de a eleição **não** se decidir no 1º turno), não intenção de voto. O ADR-0017 (transparência total em 3 camadas) fixa a Camada 1 como esse top-2. Isso funciona bem em 2T, onde a disputa é literalmente binária, mas em 1T multi-candidato um "duelo" entre o 1º e o 2º colocado é uma leitura enganosa da corrida: esconde o 3º colocado quando ele é competitivo (caso Ciro/Tebet em 2022) e trata como irrelevante a distância real entre os dois líderes e o resto do campo.

Adicionalmente, o eleitorado que não vota em nenhum candidato — abstenção, votos brancos e nulos — é parte real da disputa em qualquer 1T brasileiro (tipicamente 20–25% do eleitorado combinado) e hoje é omitido inteiramente do hero. Isso é uma lacuna de transparência: a constituição § 8 exige que toda página com projeção mostre "o que está movendo o forecast", e um duelo top-2 sozinho não comunica que uma fração relevante do eleitorado não está sendo contada nesses dois números.

A restrição real de dados é o denominador. O TSE publica três bases distintas no EA20 (confirmado em `lib/tse/ea20-schema.ts:225-278` e `docs/reference/tse-2026-leiautes.md`): candidatos e o agregado de "Outros" são fração de `v.vvc` ("votos a votáveis concorrentes" — soma de válidos, anulados e anulados sub judice, o mesmo denominador do campo oficial `pvap`); brancos e nulos são fração do comparecimento (`e.c`); abstenção é fração do eleitorado das seções instaladas (`e.esi`). Misturar essas três bases num único denominador — por exemplo, normalizando tudo por eleitorado total — produziria percentuais de candidato divergentes dos publicados pelo TSE e pela imprensa, e o art. 267 §4º da Res. TSE 23.751/2026 veda alterar o conteúdo dos dados distribuídos pelo TSE.

Por fim, o agregado "Outros" (rank ≥ 4) hoje só existe como percentual pontual em `<MinorCandidatesList />` (ADR-0017, Camada 3), sem intervalo de confiança próprio — qualquer IC seria derivado por subtração `100 − Σtop3`, o que não é estatisticamente correto porque a variância de uma soma de resamples não é a variância residual da soma dos top-3.

## Decisão

Em `mode: "multi-1t"`, a Camada 1 (hero) passa a ser o bloco `<ProjectionThermometers />`: seis barras horizontais com faixa de incerteza (lower–upper) e marcador do valor apurado, uma por categoria — 1º, 2º e 3º colocados, "Outros candidatos" (agregado rank ≥ 4), brancos/nulos, abstenção. Este bloco **substitui** `<HeadlineScore />`, `<CandidateRanking />` e `<NationalNeedle variant="national-1t" />` no hero. Permanecem inalterados `<TwoRoundIndicator />` e `<RunoffScenarios />` — são específicos de 1T e não são recorte de duelo, apenas medem e ilustram `p_segundo_turno`. `<MinorCandidatesList />` deixa de ser lista solta na Camada 3 e passa a funcionar como "Composição de Outros" (detalhamento dos candidatos de rank ≥ 4 que compõem o termômetro-agregado), permanecendo sempre no DOM conforme ADR-0017. O modo `binary` (2º turno) **fica inalterado**: `<HeadlineScore />` continua sendo o hero do 2T.

Cada termômetro exibe explicitamente sua base de cálculo, sem normalização cruzada: candidatos e "Outros" em % de `v.vvc` (votos a votáveis concorrentes — mesmo denominador do `pvap` oficial do TSE); brancos/nulos em % de `e.c` (comparecimento); abstenção em % de `e.esi` (eleitorado das seções instaladas). A alternativa de normalizar tudo num único denominador foi rejeitada por produzir percentuais de candidato divergentes dos publicados pelo TSE/imprensa e por violar o art. 267 §4º da Res. TSE 23.751/2026 (veda alteração do conteúdo dos dados distribuídos).

O IC do termômetro "Outros" é calculado no modelo como soma dos resamples de bootstrap dos candidatos de rank ≥ 4 (mesmo mecanismo do ADR-0006), não por subtração `100 − Σtop3` na camada de apresentação; a subtração fica apenas como fallback degradado, quando o payload não trouxer os resamples agregados, e nesse caso o termômetro exibe rótulo explícito "IC indisponível".

Os termômetros de participação (brancos/nulos, abstenção) são extrapolados por regra de três a partir da taxa observada nas zonas já apuradas, ponderada por eleitorado — sem prior histórico de 2022 (não existe correlação direta de comparecimento 2022→2026 confiável o bastante para justificar um prior). Consequência assumida: em apuração muito baixa a estimativa é volátil, mitigada pela mesma penalização de CI de RF-018 (`inflate_ci_low_apurado`, ≥50% adicional com <5% apurado); e há viés potencial se as zonas que apuram primeiro tiverem perfil de participação atípico (ex.: zonas urbanas apuram antes de zonas rurais e têm comparecimento historicamente diferente). Esta é uma limitação conhecida, a reavaliar após o simulado TSE de 15–17/09/2026.

Este ADR **supera parcialmente** o ADR-0017 — apenas a definição de Camada 1 no modo `multi-1t`. A regra "todas as camadas sempre presentes no DOM, sem collapsibles" do ADR-0017 continua valendo integralmente, inclusive para os termômetros de participação que ainda não têm dado disponível (renderizam em estado "aguardando projeção", nunca omitidos do DOM). O ADR-0017 permanece **integralmente vigente** para o modo `binary` (2º turno), onde `<HeadlineScore />` segue sendo a Camada 1.

## Consequências

**Positivas**:
- Retrato mais honesto da corrida 1T: elimina o viés editorial de reduzir uma disputa de 9–11 candidatos a um duelo top-2, e dá ao 3º colocado (e ao agregado "Outros") um peso visual proporcional ao seu IC real.
- Participação (abstenção, brancos, nulos) deixa de ser dado omitido — atende constituição § 8 (transparência metodológica: "o que está movendo o forecast" passa a incluir quem não votou em ninguém).
- Denominadores corretos e rastreáveis: cada termômetro cita explicitamente sua base, o que facilita auditoria e evita que o SalaCofre publique um número que diverge do TSE por escolha de normalização.
- IC de "Outros" estatisticamente correto (soma de resamples, não subtração), consistente com o mesmo método já usado para candidatos individuais (ADR-0006).

**Negativas**:
- Retrabalho de UI: três componentes que hoje compõem o hero 1T (`HeadlineScore`, `CandidateRanking`, `NationalNeedle variant="national-1t"`) saem do fluxo principal, exigindo atualização de RF-030.5/RF-030.6 (spec 003) e possível regressão em testes existentes que assumem esse layout.
- Duas lógicas de hero coexistem no código (`mode: "binary"` com `HeadlineScore`, `mode: "multi-1t"` com `ProjectionThermometers`) — aumenta a superfície de manutenção do `app/page.tsx` e o risco de um refactor futuro em `HeadlineScore` quebrar contrato usado só por 2T sem que isso seja óbvio no 1T.
- Participação extrapolada por regra de três sem prior histórico é volátil em baixa apuração e sujeita a viés de composição das zonas que apuram cedo — limitação conhecida e explícita, não eliminada, apenas mitigada pela mesma penalização de RF-018.
- O IC real de "Outros" depende do pipeline do modelo persistir e expor os resamples agregados de rank ≥ 4 no payload; se essa mudança de contrato não acompanhar este ADR, o termômetro cai no fallback degradado (subtração), que é menos rigoroso e precisa de rotulagem clara para não passar falsa sensação de precisão ao leitor.
- Divergência de estrutura entre 1T e 2T (Camada 1 diferente) exige que qualquer alteração futura em `ADR-0017` ou em `HeadlineScore`/`CandidateRanking`/`NationalNeedle` avalie explicitamente se afeta um modo, o outro, ou ambos.

## Cross-refs

- ADR-0017 (transparência total em 3 camadas — parcialmente superado neste ADR, apenas Camada 1 em `multi-1t`): [0017-transparencia-total-3-camadas.md](0017-transparencia-total-3-camadas.md)
- ADR-0013 (tokens por rank — os termômetros de candidato usam a mesma paleta `--color-cand-1`…`--color-cand-6` + `--color-cand-other`): [0013-tokens-multi-candidato-por-rank.md](0013-tokens-multi-candidato-por-rank.md)
- ADR-0014 (`p_segundo_turno` como métrica de primeira classe — `<TwoRoundIndicator />` e `<RunoffScenarios />` continuam consumindo-a sem alteração): [0014-p-segundo-turno-primeira-classe.md](0014-p-segundo-turno-primeira-classe.md)
- ADR-0006 (bootstrap não-bayesiano — fonte do IC do termômetro "Outros" e, por extensão, dos termômetros de participação): [0006-bootstrap-nao-bayesiano.md](0006-bootstrap-nao-bayesiano.md)
- Schema TSE dos denominadores (`v.vvc`, `e.c`, `e.esi`): [../../reference/tse-2026-leiautes.md](../../reference/tse-2026-leiautes.md) e `lib/tse/ea20-schema.ts:225-278`
- Spec 003 (home nacional) — RF-030.5/RF-030.6 precisam ser atualizados para refletir `<ProjectionThermometers />` no modo `multi-1t`: `docs/specs/003-home-nacional/spec.md`
- Spec 002 (modelo estatístico) — RF-018 (`inflate_ci_low_apurado`) se aplica aos termômetros de participação; novo requisito é necessário para o bootstrap agregado de "Outros" e para a extrapolação de participação por regra de três: `docs/specs/002-modelo-estatistico/spec.md`
- Constituição § 1 (conformidade TSE — art. 267 §4º da Res. TSE 23.751/2026, veda alteração de conteúdo dos dados distribuídos) e § 8 (transparência metodológica): [../../constitution.md](../../constitution.md)
- NFR: `docs/nfr/accessibility.md` (fallback tabular e contraste WCAG AA para os seis termômetros, incluindo estado "aguardando projeção")
