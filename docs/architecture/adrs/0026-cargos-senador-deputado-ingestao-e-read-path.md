---
id: ADR-0026
title: Senador e Deputado Federal em crons próprios, granularidade UF, com Vercel Blob como exceção ao read path do ADR-0001 para Deputado
status: accepted
date: 2026-09-07
---

# ADR-0026 — Senador e Deputado Federal em crons próprios, granularidade UF, com Vercel Blob como exceção ao read path do ADR-0001 para Deputado

## Status

> **Correção 2026-09-07 (mesmo dia, pós-revisão).** A redação original deste ADR escrevia a chave
> de UF como `projection:uf:<cargo>:<sigla>`. O formato **real, já em produção**, é
> `projection:uf:<sigla>:<cargo>:t<turno>` (`lib/edge-config/reader.ts:170`), e o `<cargo>` ali é
> **string** (`"pres"` / `"gov"`, `lib/config/calendar.ts:24`), não o código numérico do TSE.
> As ocorrências foram corrigidas no texto abaixo. Não criar um segundo formato de chave:
> Senador e Deputado entram como `"sen"` e `"dep"` no mesmo padrão existente.

Aceito. Este ADR **emenda o ADR-0001** (não o supersede): Postgres continua fora do read path; Vercel Blob passa a compor o read path como um segundo mecanismo, ao lado do Edge Config, restrito ao cargo Deputado Federal.

> **Nota 2026-09-08 — Emenda ([ADR-0032](0032-detalhe-municipal-vercel-blob.md))**: dois pontos deste ADR ficaram desatualizados. (1) O "limite duro de 512 KB" do Edge Config citado abaixo é **1 MB por store inteiro** — a Vercel documenta 1 MB, não 512 KB, e renomeou o produto para "Global Config". (2) O Vercel Blob deixa de ser exclusivo do drill-down de Deputado Federal: o ADR-0032 reaproveita o mesmo mecanismo e o mesmo esquema de nomeação (`<recurso>:uf:<sigla>[:<cargo>:t<turno>].json`, pathname fixo, `allowOverwrite: true`) para o detalhe municipal e as séries temporais por UF de Presidente/Governador (`EdgePayloadUf.municipios` / `.series_temporais`), pelo mesmo motivo de volume que motivou a decisão original para Deputado. A decisão de granularidade UF/crons próprios para Senador e Deputado, abaixo, permanece integralmente vigente e não é afetada.

> **Nota 2026-09-11 — duas correções ([ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md), implementação da Fase 8 da S07).**
>
> **(1) Citação legal errada.** O item 3 da Decisão abaixo remete "art. 111 da Lei 9.504" para o
> método de cadeiras. Os artigos do quociente eleitoral, do quociente partidário, da cláusula dos
> 10% e das sobras estão no **Código Eleitoral (Lei 4.737/1965), arts. 106–112** — não na Lei
> 9.504/1997, que tem 107 artigos e cujos finais tratam de instruções do TSE, vigência e
> revogações. Conferido no texto compilado do Planalto em 2026-09-11. E o **art. 111 do Código
> Eleitoral foi declarado inconstitucional** pelo STF (ADIs 7228/7263/7325, mérito em 28/02/2024):
> implementá-lo ao pé da letra — eleger "os mais votados" quando nenhum partido atinge o quociente
> — produziria resultado errado. O substituto é o art. 12-A da Res.-TSE 23.677/2021. Ver ADR-0027.
>
> **(2) Mecanismo de cron.** O item 1 prevê que cada cron dispare `/api/ingest` com override de
> cargos **por query string** (`?cargos=5`, `?cargos=6`). Query string em `path` de cron **não é
> suportada pela Vercel** — achado (B) do [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md)
> D3, que também mostrou que o caminho documentado é distinguir crons por **segmento de rota**.
> Implementado em 2026-09-11 como `/api/ingest/senador` e `/api/ingest/deputado-federal`
> (`app/api/ingest/[cargo]/route.ts`, slugs em `lib/config/cargos.ts`). A decisão de granularidade
> UF e crons próprios, com as cadências de 5 e 15 min, permanece integralmente vigente.

> **Nota 2026-09-11 (b) — Senador passa a ser ingerido por ZONA.** O item 1 abaixo
> fixa `TSE_GRANULARIDADE=uf` para Senador e Deputado Federal. **Para Senador isso
> foi revertido no mesmo dia**, por decisão do usuário, depois de uma medição:
>
> Com um único arquivo por estado, o bootstrap do estimador (ADR-0021/0023) tem
> **uma só unidade de reamostragem**. As 1.000 réplicas saem idênticas, o IC95
> fecha num ponto e `p_eleito` (RF-103) degenera para exatamente 0% ou 100%.
> Verificado à parte: 1 observação produz **1** réplica distinta; 3 produzem 10.
> Publicar aquilo como probabilidade afirmaria uma certeza que o modelo não tem
> (constituição § 6), e a alternativa era publicar o cargo sem chance de eleição —
> que numa disputa de 2 vagas é justamente o número que o leitor precisa.
>
> **Custo aceito**, explícito: com três cargos pesados (Presidente, Governador,
> Senador — 6.110 alvos cada), o teto por cargo cai de 35 para **25 rps**, senão o
> agregado seria 110 rps, acima do teto de 100 do TSE. O ciclo mais longo vai de
> ~175 s para **~244 s**, dentro do `maxDuration` de 300 s mas com menos folga —
> o que torna a medição de `duration_ms` no simulado 1 **obrigatória**, não
> opcional. Tabela em `lib/config/cargos.ts`.
>
> **Deputado Federal permanece em `uf`**: é proporcional, o payload por UF já é o
> maior do produto (por isso vai para Blob), e quatro cargos pesados estourariam
> qualquer orçamento. A degradação pré-acordada da spec 017 não muda.

> **Nota 2026-09-13 — Deputado Federal também sai de `uf` para ZONA
> ([ADR-0036](0036-deputado-federal-granularidade-zona-fatiada.md)).** O parágrafo
> imediatamente acima ("Deputado Federal permanece em `uf`") está **superado**. Pelo mesmo
> diagnóstico que moveu Senador de UF para zona em 2026-09-11 (b): com granularidade `uf`, o
> cargo 6 tem **uma única unidade de reamostragem por UF** — o bootstrap do RF-127 (intervalo
> de cadeiras, spec 017) sairia degenerado, o IC95 fechando num ponto. Diferente de Senador,
> o volume de Deputado (~6.110 alvos; `rpsMax` do cargo **permanece 5**, não sobe) exige
> varrer em **6 fatias por invocação** (~1.019 alvos cada, ~204s), com **volta completa a
> cada 30 min** (era 15) — o ritmo de 5 rps, não o `maxDuration`, é o gargalo. A trava
> anti-overlap de `/api/ingest` (ADR-0035 D3) passa a ser por **(cargo, fatia)**, não só por
> cargo. Detalhe completo, alternativas rejeitadas e consequências no ADR-0036.

## Contexto

O AtlasMenna hoje cobre Presidente (cargo TSE 1) e Governador (cargo TSE 3), ambos ingeridos por um único cron de 60s (`vercel.ts:87-91`, ADR-0011) que dispara `/api/ingest`. `lib/tse/targets.ts:57` tipa `cargo: 1 | 3` e `getActiveCargos()` (`targets.ts:335-362`) lê a lista de cargos ativos de `TSE_CARGOS`; `lib/db/schema.ts` tipa `cargo` como `smallint` genérico (aceita qualquer valor sem migration). O usuário decidiu estender a cobertura a Senador (cargo 5) e Deputado Federal (cargo 6) até o 1º turno (04/10/2026) — ambos se decidem em turno único, sem 2º turno — com uma restrição operacional explícita: Deputado Federal pode atualizar a cada 15 minutos (ingestão mais pesada, menos urgência editorial que um cargo majoritário).

O orçamento de fan-out já está no limite com os 2 cargos atuais. Em granularidade **zona** (default de produção desde 1a8ed36, ~2.600 zonas), 2 cargos geram ~5.200 GETs/ciclo; a `TSE_MAX_RPS` default é 30 (teto 50, `lib/tse/rate-limiter.ts:144-146`), o que consome ~173s de um `maxDuration=180` (`app/api/ingest/route.ts:64`) já justificado como "orçamento de transição, sem folga" pelo próprio comentário do código. Adicionar 2 cargos nesse mesmo regime dobraria o fan-out para ~10.400 GETs/ciclo — inviável sob qualquer `TSE_MAX_RPS` permitido (teto 50 ⇒ ainda >180s). Em granularidade **UF**, o custo cai para 27 GETs/cargo/ciclo (`docs/reference/tse-2026-leiautes.md:264`), e nem Senador nem Deputado Federal têm arquivo agregado `br-` — só Presidente (cargo 1) tem esse arquivo (`tse-2026-leiautes.md:88-89`, `targets.ts:640-642`). O TSE limita a 100 req/s por IP com bloqueio de 10 minutos, e o limitador de saída (`getTseRateLimiter()`) é um singleton em memória do processo — não coordenado entre invocações concorrentes de crons distintos.

No read path, o Edge Config tem um limite duro de **512 KB por store inteiro** (não por chave — confirmado em `lib/edge-config/writer.ts:171,266,275,317,325`, que valida `hardLimit: 512*1024` e emite warn agregado em 450 KB). O payload nacional atual já ocupa até ~75 KB e cada UF até ~20 KB (`lib/edge-config/types.ts:22-26`), o que para 27 UFs por cargo já aproxima o teto quando Presidente e Governador coexistem. O EA20 proporcional (Deputado Federal e, em menor grau, Senador) tem hierarquia própria — `v.vl` (votos de legenda, `lib/tse/ea20-schema.ts:269`) e `CargoSchema → (FederacaoSchema | AgremiacaoSchema) → PartidoSchema → CandidatoSchema` (`ea20-schema.ts:77-160`, confirmado contra `docs/reference/tse-2026-leiautes.md:163-175`) — que produz um volume de candidatos por UF (513 vagas nacionais, dezenas por UF) incompatível com o orçamento de Edge Config. `@vercel/blob` já está declarado em `package.json:32` mas nenhum código do repositório o importa hoje (confirmado por grep em `app/`, `lib/`, `scripts/`).

## Decisão

**1. Ingestão em crons independentes, granularidade UF.** Senador (cargo 5) ganha um cron próprio a cada 5 minutos; Deputado Federal (cargo 6) a cada 15 minutos — ambos desacoplados do cron de 60s de Presidente/Governador. Cada cron dispara `/api/ingest` com um subconjunto de cargos restrito à sua corrida (ex.: `?cargos=5` e `?cargos=6`), o que exige estender `getActiveCargos()`/o handler para aceitar um override por query string, com fallback ao comportamento atual de `TSE_CARGOS` quando ausente (hoje o handler só lê `TSE_CARGOS` do ambiente — não há override por request, `app/api/ingest/route.ts:38,673-685`). Ambos usam `TSE_GRANULARIDADE=uf` (27 GETs/cargo/ciclo, sem arquivo `br-` para nenhum dos dois). Granularidade **zona** para Deputado fica permitida só como opção futura, condicionada a medir <180s no simulado 2 (~2.600 GETs a 30 rps ≈ 87s isoladamente — a folga real depende de não coincidir com o pico do cron de 60s de Presidente/Governador, que já consome ~173s do mesmo orçamento de rate limit compartilhado por IP).

**2. Tipos ampliados.** `Target.cargo` em `lib/tse/targets.ts:57` passa de `1 | 3` para `1 | 3 | 5 | 6` (e os pontos que fazem pattern-match exaustivo, como `VALID_CARGOS`, `formatCargo`, e os schemas de validação em `app/api/_internal/edge-write/route.ts:87`). O endpoint Python (`api/model/project.py`) passa a aceitar `cargo` 5 e 6 no corpo do trigger. Nota de implementação: o repositório hoje tem **dois tipos `Cargo` distintos e não relacionados** — `lib/edge-config/types.ts:45` (`1 | 3`, espelha o TSE) e `lib/config/calendar.ts:24` (`"pres" | "gov"`, usado para nomear chaves do Edge Config via ADR-0012). Este ADR estende ambos: o numérico para `1 | 3 | 5 | 6`, e o de calendário com novos tokens (`"sen"`, `"depfed"`) usados exclusivamente para namespacing de chave — a escolha exata do token cabe à implementação, mas deve evitar colisão com os dois existentes.

**3. Modelo.** Senador usa a regra de três (ADR-0021) em nível de UF — o `k` da UF, não da zona — com `p_eleito` calculado para top-2 dentro de cada UF (2 vagas por UF, renovação de 2/3 em 2026 → 54 vagas no total), sem noção de 2º turno; a UI rotula essa saída como "projeção UF-level" para não sugerir a mesma granularidade zonal do majoritário. Deputado Federal projeta votos por agremiação/candidato pela mesma regra de três; o **método de conversão de votos em cadeiras** (quociente eleitoral, quociente partidário, cláusula dos 10% do QE por candidato, distribuição de sobras, tratamento de federações como partido único, art. 111 da Lei 9.504) fica **fora de escopo deste ADR** — regista-se aqui apenas a fronteira: será formalizado em ADR-0027 junto da spec 017 (a criar), que também deve revisar o texto vigente dos arts. 106–111 da Lei 9.504 antes de implementar (coligações em proporcional são vedadas desde 2020; a redação exata pode ter sido alterada por lei/resolução posterior — não confirmado neste ADR).

**4. Read path.** Senador cabe no Edge Config: a chave de UF ganha o cargo explícito no namespace — `projection:uf:<sigla>:<cargo>:t<turno>` — com fallback para a chave legada sem cargo (`projection:uf:<sigla>`) reservada aos cargos 1/3, replicando o padrão que **já existe hoje** para `projection:current` (ADR-0012: `projection:current:<cargo>:t<turno>` com fallback para `projection:current`, `lib/edge-config/reader.ts:32-83`) — o reader de UF (`readUfProjection`, `reader.ts:159-183`) já monta `projection:uf:${sigla}:${cargo}:t${turno}` como chave primária, então o padrão de namespacing por cargo na chave de UF é continuidade de um mecanismo existente, não uma invenção deste ADR. Deputado Federal **não** cabe no Edge Config com folga: um payload por UF (top-30 candidatos + todas as agremiações + cadeiras, ~10–15 KB × 27 UFs ≈ 270–405 KB) consumiria isoladamente a maior parte ou a totalidade do orçamento de 512 KB do store inteiro — que já é compartilhado por Presidente, Governador e Senador. A decisão é usar **Vercel Blob** (`deputado:uf:<sigla>.json`, escrito com pathname fixo e `allowOverwrite: true` para produzir uma URL determinística, servido via CDN da Vercel) como read path para o drill-down por UF de Deputado, lido no servidor via `fetch` com `revalidate` (não client-side direto); a lista completa de candidatos por UF, usada só para busca textual, é carregada lazy no client a partir do mesmo blob. O resumo nacional de Deputado (cadeiras agregadas por partido/federação) é pequeno o bastante para caber no Edge Config e permanece lá. Isto é uma **exceção explícita ao ADR-0001**: Postgres continua fora do read path (nunca lido por requests de cliente), mas o read path deixa de ser Edge Config-only — passa a ser Edge Config para tudo, exceto o drill-down de UF de Deputado Federal, que vive em Blob. O ADR-0001 é emendado com uma nota apontando para este ADR; não é superseded, porque seu princípio central (Postgres fora do read path) permanece intacto.

**5. Transparência.** A UI exibe `ts` por payload e o texto "atualizado a cada 15 min" quando a corrida exibida é Deputado Federal, para que o leitor não presuma a mesma frescor do majoritário — constituição § 8 (transparência metodológica) exige que a cadência de atualização seja legível, não apenas a metodologia de projeção.

## Alternativas rejeitadas

- **Zona para os 4 cargos.** Rejeitada: ~4 cargos × ~2.600 zonas ≈ 10.400 GETs/ciclo estoura qualquer combinação de `maxDuration` e `TSE_MAX_RPS` permitida (teto 50 rps).
- **Edge Config também para Deputado Federal.** Rejeitada: o payload por UF (270–405 KB) não cabe com folga no orçamento de 512 KB do store inteiro, já compartilhado com Presidente/Governador/Senador.
- **Postgres no read path para Deputado.** Rejeitada: violaria o princípio central do ADR-0001 (custo de conexão, risco de acoplar a disponibilidade do site à do Neon sob carga de ~20k acessos simultâneos).
- **Neon + camada de cache (ex. Redis/KV) para Deputado.** Rejeitada por este ADR por adicionar uma peça de infraestrutura fora da stack canônica (constituição § 9 — 100% Vercel) sem necessidade, quando Vercel Blob já resolve o mesmo problema dentro da stack.

## Consequências

**Positivas**:
- Isolamento do pipeline de Presidente/Governador (P0 do produto): um cron de Deputado Federal lento ou com erro não compete pelo orçamento de 180s nem pelo lock anti-overlap do cron principal.
- Orçamento de rate limit previsível por cargo: 27 GETs a cada 5 min (Senador) e a cada 15 min (Deputado) são triviais frente ao teto de 100 req/s do TSE, mesmo somados ao pico do cron de 60s.
- Reaproveita um mecanismo de namespacing por cargo que já existe (ADR-0012) em vez de inventar um novo esquema de chaves.

**Negativas**:
- Dois read paths a monitorar em produção (Edge Config + Vercel Blob), cada um com seu próprio modo de falha e sua própria observabilidade — o runbook operacional precisa de uma seção dedicada a Blob.
- Latência maior e menos "ao vivo" para Deputado Federal por design (15 min vs. 60s dos demais cargos) — risco de percepção de inconsistência se o `ts` não for suficientemente visível na UI.
- Código de leitura duplicado no servidor: um caminho para Edge Config (`get()` do SDK) e outro para Blob (`fetch` com revalidate), com formatos de erro e de cache distintos.
- O limitador de saída (`getTseRateLimiter()`) é um singleton por instância de processo, não coordenado entre crons concorrentes; se Fluid Compute escalar horizontalmente sob invocações simultâneas do cron de 60s e do cron de Senador/Deputado, o teto agregado de 100 req/s do TSE pode, na prática, não ser respeitado de forma centralizada — mitigação recomendada (fora do escopo de implementação deste ADR): reduzir a margem de segurança do `TSE_MAX_RPS` proporcionalmente ao número de crons ativos, ou mover para um limitador coordenado externamente.
- Risco de a UI mostrar cargos com defasagens de atualização visivelmente diferentes na mesma tela (ex. página combinada com resultados de Presidente e Deputado) — mitigação: `ts` por cargo sempre visível (item 5 da Decisão), nunca um único "atualizado às" global quando a tela mistura cargos.

## Cross-refs

- ADR-0001 (Edge Config no read path — emendado por este ADR, não superseded): [0001-edge-config-no-read-path.md](0001-edge-config-no-read-path.md)
- ADR-0012 (chaves nomeadas por corrida/turno — precedente do namespacing por cargo reaproveitado aqui): [0012-edge-config-chaves-nomeadas.md](0012-edge-config-chaves-nomeadas.md)
- ADR-0021 (extrapolação do apurado por zona — base do estimador reaproveitado em nível de UF para Senador): [0021-extrapolacao-do-apurado-sem-2022.md](0021-extrapolacao-do-apurado-sem-2022.md)
- ADR-0020 (conformidade Res. 23.751/2026 — denominadores `vvc`/`c` aplicam-se igualmente a Senador/Deputado): [0020-conformidade-res-23751-2026.md](0020-conformidade-res-23751-2026.md)
- `docs/architecture/data-model.md` — precisa de seção nova descrevendo o payload Blob de Deputado Federal (schema, tamanho estimado, path pattern)
- `docs/reference/tse-2026-leiautes.md` § 6 (recomendação de fan-out) — precisa incorporar a tabela de GETs/ciclo para 4 cargos
- `docs/operations/runbook.md` — precisa de seção de monitoramento do Vercel Blob e dos 2 novos crons
- `vercel.ts` — precisa dos 2 novos crons (`/api/ingest` a cada 5 min para cargo 5, a cada 15 min para cargo 6) e de `functions` config se o handler precisar de `maxDuration` distinto por rota
- Constituição § 8 (transparência metodológica — cadência de atualização visível), § 9 (stack 100% Vercel — Blob está na stack canônica), § 10 (append-only — snapshots de cargos 5/6 seguem a mesma regra)
- Specs a criar: `docs/specs/016-senador/` e `docs/specs/017-deputado-federal/` (a segunda referencia o ADR-0027, ainda a escrever, para o método de cadeiras)
