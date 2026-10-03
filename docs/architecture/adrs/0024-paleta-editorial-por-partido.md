---
id: ADR-0024
title: Paleta editorial própria por partido/federação, não tokens por rank de apuração
status: accepted
date: 2026-09-07
supersedes: ADR-0013
---

# ADR-0024 — Paleta editorial própria por partido/federação, não tokens por rank de apuração

## Status

**Aceito em 2026-09-07.** O usuário aprovou o texto da emenda ao § 2 reproduzido abaixo, e a
`docs/constitution.md` foi atualizada de 1.2 para 1.3 com a nota de cabeçalho correspondente —
cumprindo o preâmbulo, que exige justificativa em ADR **e** versionamento explícito para mudar um
princípio invariante. A partir daqui, código de cor por partido está liberado.

Este ADR **supersede o ADR-0013** ("Tokens visuais de candidato por rank de apuração, não por partido"). O frontmatter do ADR-0013 foi atualizado para `status: superseded` / `superseded_by: ADR-0024` na
mesma data.

> **Nota 2026-09-19 — a decisão vigorava havia 12 dias; a IMPLEMENTAÇÃO fechou hoje.** Este ADR foi aceito em 07/09, mas o produtor (`api/model/project.py`) continuou gravando `cor: "var(--color-cand-{rank})"` no payload, e **dez** superfícies liam esse campo direto — pintando por colocação numa base cuja norma já era pintar por partido. O dono achou pela tela: **CAIADO/PSD laranja na lista e verde na legenda do mapa, ao mesmo tempo**.
>
> Passou despercebido porque `--color-cand-1` é vermelho e `--color-cand-2` é azul — **exatamente** o que PT e PL receberiam pela paleta de partido. As duas fontes só discordam a partir do **3º colocado**, e nenhum teste olhava além dos dois primeiros. É o caso geral: *quando duas fontes coincidem nos casos mais comuns, o teste precisa ir buscar o caso em que elas discordam.*
>
> **Como a garantia é dada hoje** — a cor é função pura da SIGLA, e o rank só entra quando a sigla não tem token próprio (aí `colorForParty` devolveria `--party-outros` para todos e a tela perderia a distinção entre candidatos):
>
> | superfície | função | de onde |
> |---|---|---|
> | preenchimento **com extensão** (barra, hexágono, polígono, `<rect>`) | `candidateColor(partido, rank)` | `components/blocks/_candidateColor.ts` |
> | **marcador** sem extensão (bolinha, quadradinho de legenda, ponto de 8×8) | `candidateMarkerColor(partido, rank)` | idem |
> | fundo grande **com texto em cima** | `partyChipInk(sigla)` — par medido de fundo **e** tinta | `lib/utils/party-color.ts` |
>
> A distinção entre as duas primeiras é a de [`docs/nfr/accessibility.md`](../../nfr/accessibility.md) (§ RNF-035): num preenchimento com extensão o remédio de contraste é o contorno; num ponto de 8×8 **não há extensão a contornar**, e o remédio é a variante `-text`. Usar a errada não é detalhe: em 18 dos 32 partidos (2026-09-20: com PTB) as duas coincidem, e é justamente por isso que a troca passaria sem ninguém ver.
>
> **A trava é uma varredura de FONTE**, `tests/unit/components/cor-nunca-do-payload.test.ts`: lê `components/` inteiro e reprova qualquer leitura de `.cor` de candidato. Testar render componente a componente não impediria o décimo primeiro — e não é hipótese: **três dos dez foram encontrados pela varredura**, depois de a leitura manual do código ter dado o trabalho por terminado. Entre eles, a faixa que declara o eleito e o que alimenta o coroplético municipal.
>
> ⚠️ **O que continua aberto**: o produtor **ainda grava** o campo `cor` por rank, citando o ADR-0013 em `api/model/project.py`. Ninguém mais o lê, e a varredura garante que continue assim — mas o campo segue no payload. Removê-lo mexe no que é publicado e ficou para decisão do dono.
>
> ⚠️ **Um acoplamento que quase passou batido**: `NationalWinnerBanner` escolhia a cor do TEXTO com `shouldUseDarkText(rank)` — *"ranks 1 e 2 têm fundos escuros (vermelho/azul)"*. Verdade **só** enquanto o fundo vinha da colocação. Trocar o fundo para a cor do partido e deixar essa função de pé daria texto branco sobre fundo claro num rank 1 de partido claro. Sempre que uma decisão de contraste for tomada a partir do `rank`, ela é uma premissa sobre a paleta antiga disfarçada de regra de acessibilidade.

> **Nota 2026-09-08 — Emenda**: Este ADR continua vigente e a decisão central (paleta editorial própria por partido, ΔE76 ≥ 10 contra o hex oficial) permanece intacta. Porém, [ADR-0031](0031-piso-separacao-entre-partidos.md) (2026-09-08) acrescenta um segundo eixo de medição que este ADR não cobria: a distância entre as próprias cores da paleta (não só entre cada cor e a marca do partido que ela representa). Cinco pares de partidos estavam perceptualmente indistinguíveis entre si — e uma sexta colisão, invisível nas bases, tinha sido criada pela correção de contraste de acessibilidade de 07/09. O ADR-0031 fixa `PARTY_SEPARATION_FLOOR = 12` e um gate irmão contra colapso de croma no nível 5, propõe emenda ao § 2 (v1.4 → v1.5), e documenta seis hexes trocados. Ver ADR-0031 para o texto completo.

## Contexto

O usuário decidiu adotar o design system "Atlas Menna" (kit copiado em `docs/design-system/atlas-menna/`, export do Claude Design `a2991f9b-6ed8-40ac-88a7-308c8dc9ea42`, 2026-09-07). O kit define, em `tokens/colors.css`, uma paleta editorial com **uma cor fixa por partido/federação**: `--party-pt` (`#C0223B`) e `--party-pl` (`#2247B8`) com 5 intensidades cada (`--party-pt-1..5`, `--party-pl-1..5`, mapeando margem — de claro/tossup a saturado/decisivo, com variantes próprias em `[data-theme="dark"]`), mais **30 tokens de partido único** (2026-09-20: 29 + PTB novo, `--party-ptb`) para os demais e um fallback `--party-outros` (`#9AA0A8`). `--party-tie` e `--party-none` cobrem estados de empate e ausência de projeção. Total: 32 bases (PT, PL, 30 demais) + 1 fallback.

Hoje vigora o ADR-0013: cor por **rank de apuração**, não por partido — `--color-cand-1`…`--color-cand-6` + `--color-cand-other`, com "color lock" (o orchestrator Python congela o rank de um candidato no primeiro snapshot em que `pct_apurado ≥ 1%`, para a cor não trocar durante a noite). O payload do Edge Config publica `cor: "var(--color-cand-N)"` por candidato (`lib/edge-config/types.ts:228-293`, campo `EdgeCandidate.cor`), e `lib/utils/cand-color.ts` resolve esse token em hex via `getComputedStyle` para o MapLibre, que não aceita `var()` em paint values.

O rank-based deixou de servir por três razões concretas, não hipotéticas:

1. **Grid de 27 governadores** (spec 006, `<GovernorCard />` + `<HexCartogramBrasil />`): em cada UF o "rank 1" é sempre `--color-cand-1` (vermelho), não importa o partido do líder local. O leitor que varre as 27 UFs vê um mapa "vermelho" onde na verdade lideram 27 partidos distintos — a cor comunica "quem é o líder desta UF na paleta", não "qual partido governa esta UF", que é a pergunta editorial real de um grid nacional de governadores.
2. **Senado 2026 (2 vagas por UF)**: rank pressupõe uma corrida com 1º/2º/3º colocado ordenados por um único vencedor. Numa corrida de 2 vagas simultâneas por UF, "rank 1" e "rank 2" não são "quem lidera" e "quem está atrás" — são os dois eleitos, e um terceiro competitivo (rank 3) tem exatamente o mesmo status de "fora" que o rank 7 num duelo presidencial. O conceito de rank perde o significado que tinha nas corridas binárias/multi-candidato de 1 vaga (presidente, governador).
3. **Deputado Federal (proporcional por partido/federação)**: a unidade de disputa não é mais o candidato individual isolado, mas o desempenho do partido/federação na coligação proporcional — dezenas de candidatos por UF, eleitos por quociente eleitoral e sobra de legenda. Rank por candidato individual não produz uma leitura visual coerente quando o que importa é "quantas cadeiras cada partido/federação conquistou", e cor por partido é a única forma de agregar visualmente essa informação num mapa ou grid.

O § 2 da constituição diz: "Cores partidárias seguem padrão NYT-like (azul/vermelho), **nunca** cores oficiais de partido." A leitura correta desse texto — confirmada relendo o §, não inferida — é que ele proíbe **hexes oficiais de partido** (a cor que o próprio partido usa em material de campanha, logo, bandeira), não a **associação cor↔partido** em si. O ADR-0013 escolheu ir além do que o § 2 exige, evitando também a associação cor↔partido (por rank em vez de por sigla) como forma de neutralidade adicional — uma escolha de implementação legítima em 2026-05-17 (S05/F4c), mas que hoje colide com a necessidade editorial de comunicar "qual partido" em telas com múltiplos cargos e resultados agregados por sigla.

## Decisão

A UI adota uma **paleta editorial própria por partido/federação**, estável durante toda a noite de apuração (e entre as duas noites do pleito, 04/10 e 25/10), com hexes pré-computados documentados em `docs/design-system/tokens.md` e definidos como custom properties em `app/globals.css` (tokens `--party-<sigla>`, mais `--party-<sigla>-1..5` para as intensidades por margem de PT e PL, em versões light e `[data-theme="dark"]`). **Nunca** os hexes oficiais de partido — critério objetivo e auditável: **ΔE76 (CIE76 delta-E) ≥ 10** entre o hex editorial do AtlasMenna e o hex oficial documentado do partido (manual de marca do partido ou uso reiterado em material oficial). O kit Atlas Menna já traz 25 hexes prontos (`docs/design-system/atlas-menna/tokens/colors.css:37-76`): `--party-pt` `#C0223B`, `--party-pl` `#2247B8`, e os 23 demais listados no Contexto acima. `docs/design-system/tokens.md` precisa **formalizar o cálculo de ΔE76** contra o hex oficial de cada partido e **definir os hexes que faltam** — não como pré-condição do aceite (dado em 2026-09-07), mas como **gate do Bloco 1**: nenhum componente pode ir ao ar com cor por partido antes disso estar escrito e auditável. Faltam hoje: PDT, PSDB, PCdoB, PV, Solidariedade, PMB e as federações partidárias registradas para 2026 (a checar contra o registro do TSE) não têm token no kit hoje.

Federação usa a cor do partido-líder da federação (o partido com mais votos/cadeiras dentro da federação na corrida em questão) — não uma cor própria de federação, para não multiplicar a paleta com identidades que mudam a cada eleição conforme a composição de federações se reconfigura. Partido sem token definido (sigla nova, erro de mapeamento, ou processamento incompleto) cai em `--party-outros` (`#9AA0A8`), nunca em erro visual ou cor ausente.

A UI passa a derivar a cor de `EdgeCandidate.partido` via um novo helper `lib/utils/party-color.ts` (a criar — fora do escopo deste ADR, que fixa a decisão, não a implementação), análogo em forma a `lib/utils/cand-color.ts` mas mapeando sigla→token em vez de rank→token. O campo `cor` do payload do Edge Config (`EdgeCandidate.cor`, hoje `var(--color-cand-N)`) é **mantido por compatibilidade** — não é removido do contrato — mas passa a ser **ignorado pela UI**: nenhum componente novo deve consumir `c.cor` diretamente; todos devem resolver a cor a partir de `c.partido` via `party-color.ts`. O **color lock** do ADR-0013 (congelar rank no primeiro snapshot com `pct_apurado ≥ 1%`) torna-se **desnecessário**: a cor de um partido não depende de quando ele cruza um limiar de apuração, então não há mais "troca de cor" a prevenir. O mecanismo de color lock no orchestrator Python pode ser removido numa limpeza futura, mas não precisa ser removido **por este ADR** — ele simplesmente deixa de ter efeito observável na UI a partir do momento em que os componentes migrarem para `party-color.ts`.

Os tokens `--color-cand-1`…`--color-cand-6` (+ `--color-cand-other`, + bandas) **não são removidos agora**. Ficam como **alias/fallback até depois do 2º turno** (25/10/2026): qualquer componente ou payload que ainda não migrou para `party-color.ts`, ou qualquer caso em que `partido` esteja ausente/não mapeado, continua resolvendo pelo mecanismo antigo sem quebrar. A remoção formal dos tokens de rank é tarefa de limpeza pós-D2, fora do escopo e da urgência deste ADR — o objetivo aqui é não introduzir uma segunda mudança de contrato de payload na mesma janela crítica que já tem o 1º turno em 4 semanas.

## Proposta de emenda ao § 2 da constituição

Texto para aprovação do usuário — a edição de `docs/constitution.md` (versão 1.2 → 1.3, com nota de cabeçalho análoga às mudanças 1.0→1.1 e 1.1→1.2) só deve ser feita **depois** da aprovação explícita, e não é feita por este ADR:

> ## 2. Neutralidade política
>
> - Cores partidárias seguem uma **paleta editorial própria do AtlasMenna** — uma cor por partido/federação, documentada com hex exato em `docs/design-system/tokens.md` — **nunca** as cores oficiais de partido. Toda cor de partido deve ter **ΔE76 ≥ 10** em relação ao hex oficial documentado do partido (manual de marca ou uso reiterado em material oficial), critério auditável e verificável por qualquer agente ou revisor. A cor de cada partido é **estável durante toda a noite de apuração** e entre as duas noites do pleito (1º e 2º turnos): não muda por rank, por ordem de apuração, por margem ou por qualquer evento da corrida — apenas a **intensidade** (claro↔saturado) pode variar com a margem projetada, nunca a matiz.
> - Nomes de candidatos e siglas partidárias aparecem **sempre na mesma ordem** dentro de uma mesma corrida (sem favorecimento por ordem de leitura).
> - Insights gerados por templates **não emitem julgamento** ("Lula consolida vitória" é OK; "vitória esmagadora" não é).
> - Quando há ambiguidade na atribuição de bloco político 2022→2026, exibir disclaimer explícito.

## Consequências

**Positivas**:
- Resolve a limitação concreta do grid de 27 governadores: o mapa nacional passa a comunicar "qual partido lidera cada UF", a pergunta editorial que o produto precisa responder, em vez de "qual é o rank 1 desta UF na paleta local".
- Habilita cargos futuros que dependem estruturalmente de identidade por partido — Senado (2 vagas/UF) e Deputado Federal (proporcional por legenda) não têm leitura visual coerente com cor por rank de candidato individual.
- Cor estável a noite inteira **por construção** (não por color lock ativo): elimina a necessidade de o orchestrator congelar rank em tempo real, removendo uma classe inteira de bug potencial (cor trocando no meio da apuração se o color lock falhar).
- Critério objetivo e auditável (ΔE76 ≥ 10) substitui um julgamento subjetivo de "isso parece com a cor oficial?" por um número que qualquer agente (`constitution-guard` incluído) pode recomputar.

**Negativas**:
- **Risco de percepção de partidarismo.** É o trade-off central que o ADR-0013 foi desenhado para evitar: cor fixa e estável por partido, ano após ano, aproxima-se mais da identidade visual que o próprio partido cultiva do que uma cor por rank, que muda de dono a cada corrida. O critério ΔE76 ≥ 10 garante que o hex não é literalmente a cor oficial, mas não elimina a possibilidade de um leitor de longo prazo aprender "AtlasMenna = vermelho é PT" e ler viés editorial nisso — risco que o produto assume conscientemente nesta decisão, não um efeito colateral não examinado.
- Contraste precisa ser **medido por token**, em light e dark, contra os fundos reais de uso (chip de texto, fill de mapa, barra de termômetro) — meta WCAG 4.5:1 para texto e 3:1 para UI/gráficos (constituição § 4). Os 25 hexes do kit não vêm com essa auditoria feita; é gate obrigatório do `a11y-perf-auditor` antes de qualquer componente migrado ser promovido a `shipped`, e falhas esperadas nos tons mais claros das intensidades 1–2 (uso decorativo apenas, nunca com texto por cima, seguindo o padrão já estabelecido para `--color-cand-N-strong`).
- **24 arquivos de teste** hoje afirmam `var(--color-cand-N)` (verificado por grep em 2026-09-07: `tests/unit/components/{DecisiveUFsGrid,ProjectionThermometers,ProjectionThermometer,HeadlineScore,MunicipioWaffleGrid,GovernorCard,HexCartogramBrasil,TurnoOneRecap,NationalWinnerBanner,StateGroupedTable,Needle,CandidateBar,MinorCandidatesList,CandidateRanking,RaceTypeIndicator,UFPage,RunoffScenarios}.test.tsx`, `tests/unit/utils/cand-color.test.ts`, `tests/unit/insights/generate.test.ts`, `tests/integration/{governador-page,uf-governador-page}.test.tsx`, `tests/unit/model/test_orchestrator.py`, mais 3 fixtures JSON em `tests/fixtures/edge-config/`) — todos precisam ser revisitados: os que passam a consumir `party-color.ts` mudam a asserção; os que ficam no fallback de rank (candidato sem partido mapeado) continuam válidos como estão.
- `.claude/agents/constitution-guard.md:47` tem uma regra de grep que hoje permite uma lista fechada de tokens (`color-pt|color-pl|color-success|...`) e reprova qualquer hex fora dela — a introdução de 25 novos tokens `--party-*` exige atualizar essa allowlist (ou trocar o critério para "hex só é permitido se estiver declarado em `tokens.md`/`globals.css`, nunca hardcoded em componente"), senão o próprio guardião constitucional vai reprovar falsamente a implementação deste ADR.
- Dois sistemas de cor de candidato coexistem durante a transição (`--color-cand-*` por rank + `--party-*` por sigla) até a limpeza pós-2º turno — mesmo risco de confusão já nomeado no ADR-0019 para trilha vs. candidato, agora entre rank vs. partido.
- ADR-0017 (todos os candidatos do 1T em 3 camadas fixas) e ADR-0018 (seis termômetros como hero do 1T) **continuam integralmente válidos** — a estrutura de camadas e a escolha de quais métricas aparecem no hero são ortogonais a qual token de cor cada camada usa. Nenhuma seção desses dois ADRs precisa ser revisitada por este.

## Alternativas consideradas

- **Manter rank (ADR-0013)** — rejeitada: resolve neutralidade de forma mais conservadora, mas não escala para grid multi-UF nem para cargos com múltiplos vencedores por circunscrição (Senado) ou disputa proporcional por legenda (Deputado Federal), que são exatamente os cargos que motivam esta mudança.
- **Híbrido — rank para presidente, partido para os demais cargos** — rejeitada: manter dois sistemas de cor *permanentemente* (não apenas durante uma janela de transição) significa que o mesmo candidato pode aparecer com cores diferentes dependendo da página, o que é pior para o leitor que já precisa distinguir trilha presidencial de trilha governador (ADR-0019) e agora teria que aprender uma terceira regra ("aqui a cor é por rank, ali é por partido"). O custo de manutenção de dois sistemas de cor de candidato *definitivos* supera o ganho de manter presidente "mais neutro" que os demais cargos.
- **Cores oficiais de partido** — rejeitada categoricamente pela constituição § 2, sem ambiguidade: o § 2 nunca permitiu isso, com ADR-0013 ou com este ADR-0024. Não é uma alternativa real, é o limite que ambas as decisões respeitam.

## Cross-refs

- ADR-0013 (tokens de candidato por rank — superseded por este ADR, se aceito): [0013-tokens-multi-candidato-por-rank.md](0013-tokens-multi-candidato-por-rank.md)
- ADR-0017 (3 camadas fixas do 1T — estrutura permanece; só o token de cor consumido por cada camada muda): [0017-transparencia-total-3-camadas.md](0017-transparencia-total-3-camadas.md)
- ADR-0018 (seis termômetros do hero 1T — mesma observação): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- ADR-0019 (identidade visual por trilha — precedente do mesmo risco "dois sistemas de cor coexistindo" e da mesma exigência de distinguibilidade perceptual entre canais de cor com significados diferentes): [0019-identidade-visual-por-trilha.md](0019-identidade-visual-por-trilha.md)
- Constituição § 2 (neutralidade política — texto vigente hoje interpretado como proibindo hex oficial, não associação cor↔partido; proposta de emenda 1.2→1.3 acima): [../../constitution.md](../../constitution.md#2-neutralidade-política)
- Constituição § 4 (acessibilidade — contraste 4.5:1 texto / 3:1 UI, gate obrigatório para os novos tokens `--party-*`): [../../constitution.md](../../constitution.md)
- Constituição, preâmbulo (exige ADR + versionamento explícito para mudar princípio — `docs/constitution.md:11`, mesmo mecanismo usado pelo ADR-0020 e pelo ADR-0021): [../../constitution.md](../../constitution.md)
- Design system: `docs/design-system/atlas-menna/readme.md` e `docs/design-system/atlas-menna/tokens/colors.css` (fonte dos 25 hexes de partido) — a adoção mais ampla do kit (restyle-in-place, Tailwind v4 `@theme static`) é tratada por um ADR à parte referenciado no próprio readme do kit, fora do escopo deste documento.
- `docs/design-system/tokens.md` — precisa formalizar: os 25 hexes por partido/federação com ΔE76 documentado contra o hex oficial, os hexes que faltam (PDT, PSDB, PCdoB, PV, Solidariedade, PMB, federações 2026), a auditoria de contraste WCAG por token em light/dark, e a nota de depreciação de `--color-cand-1..6` pós-2º turno.
- `lib/edge-config/types.ts:228-293` (`EdgeCandidate.cor`, `EdgeCandidate.partido`) — contrato do payload não muda de shape; muda apenas qual campo a UI consome.
- `lib/utils/cand-color.ts` (mecanismo de rank, mantido como fallback) e `lib/utils/party-color.ts` (a criar — mapeamento sigla→token).
- `.claude/agents/constitution-guard.md:47` — regra de detecção de hex hardcoded precisa de nova allowlist ou novo critério para os tokens `--party-*`.
- Specs afetadas: `docs/specs/003-home-nacional/spec.md`, `docs/specs/004-pagina-uf-presidencial/spec.md`, `docs/specs/005-pagina-uf-governador/spec.md`, `docs/specs/006-grid-governadores/spec.md` (todas consomem ADR-0013 hoje via `adrs:` no frontmatter).
