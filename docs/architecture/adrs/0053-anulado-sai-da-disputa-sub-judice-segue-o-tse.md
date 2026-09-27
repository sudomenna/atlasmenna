---
id: ADR-0053
title: Candidatura com dvt "Anulado" sai da disputa; "Anulado sub judice" segue contando como o TSE conta
status: accepted
date: 2026-09-27
---

# ADR-0053 — Candidatura com `dvt` "Anulado" sai da disputa; "Anulado sub judice" segue contando como o TSE conta

## Status

Aceito.

## Contexto

O modelo projeta cada candidatura como fração de `v.vvc` (votáveis concorrentes = válidos + anulados + anulados sub judice — mesmo denominador do campo oficial `pvap`, [ADR-0018](0018-termometros-hero-1t.md)). O caminho de projeção nunca lê `cand[].dvt` (destinação do voto, publicada pelo TSE **após a primeira totalização parcial**): `_extract_zone_candidatos` (`api/model/project.py:2207`) → `estimate_uf_candidatos` (`api/model/extrapolation.py:192`) → `compute_national` (`api/model/project.py:4575`) → `compute_p_fecha_1t` (`:3476`, limiar `>= 0.50`), `compute_two_round_scenarios` (`:3502`) e `p_vitoria`/`p_eleito` (`api/model/p_vitoria.py`) e, por UF, `lider`/`chamada` (margem > 10)/`vai_a_2t` (`top_pct < 50`) (`api/model/project.py:6140-6159`). O único lugar que hoje lê `dvt` é o bloco de **exibição** `votacao.corrida` (spec 022, `destino_do_dvt`, `api/model/project.py:3912`).

Isso significa que uma candidatura anulada pelo TSE — decisão definitiva de indeferimento de registro, cassação ou situação equivalente — continua competindo integralmente nas decisões de corrida. Rodando as funções reais sobre cenários derivados da captura real do simulado do TSE (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`: `vv` 100.982.116, `vvc` 120.704.576, `van` 9.218.887, `vansj` 10.503.573), foram medidas três consequências: (A) um líder com 46% de `vvc`, onde 16% de `vvc` é anulado ou sub judice, faz o site reportar `p_fecha_1t = 0` e `p_segundo_turno_overall = 1.0` mesmo quando, descontados os votos definitivamente anulados, o líder pode já ter maioria absoluta dos votos que de fato disputam a vaga; (B) uma candidatura anulada pode se tornar `lider`, entrar no par do 2º turno e, no Senado, ocupar uma das 2 vagas no ranking de `p_eleito`; (C) a faixa de erro é ampla — um líder entre 41,83% e 50% de `vvc` já tem mais de 50% dos votos válidos, dependendo de quanto de `vvc` está anulado. O replay 2022 não expõe nenhum desses casos porque o formato de 2022 não tem `dvt` (e naquele ano `vvc == vv`, sem anulados/sub judice a decompor).

A norma eleitoral (CF art. 77 § 2º para Presidente, art. 28 por remissão para Governador) define maioria absoluta sobre os votos **válidos**, excluindo brancos e nulos — mas nenhuma fonte confirmada no repositório trata especificamente do papel dos votos anulados e anulados sub judice nesse cômputo (`docs/reference/regulatory.md:46-50` documenta a lacuna: o material oficial disponível da Res. TSE 23.751/2026 não confirma artigo sobre o assunto). Na captura real do simulado, uma candidatura com `dvt: "Anulado sub judice"` chega com `st: "2º turno"` e `e: "s"` — o próprio TSE a mantém formalmente na disputa enquanto o caso não transita em julgado, o que distingue esse estado do `"Anulado"` definitivo.

## Decisão

1. **Candidatura com `dvt = "Anulado"` (decisão definitiva) deixa de competir** nas decisões de corrida: sai de `lider`, `cand_a`/`cand_b`, da agulha (`p_vitoria`), do par de `cenarios_2t`, de `chamada`, de `vai_a_2t` e, no Senado, do ranking de `p_eleito`. Seus votos saem da base da regra de maioria absoluta do 1º turno, que passa a ser `vvc − van` (válidos + sub judice) em vez de `vvc` inteiro.
2. **Candidatura com `dvt = "Anulado sub judice"` continua exatamente como hoje**: segue competindo, seus votos continuam na base, e nenhum comportamento muda. Isto é um ponto aberto (ver abaixo), não uma afirmação de que a lei confirma esse tratamento.
3. **A exibição não muda.** Os percentuais por candidato em listas, termômetros e mapas continuam sobre `vvc` inteiro ([ADR-0018](0018-termometros-hero-1t.md)) — a regra deste ADR afeta apenas as decisões de corrida (quem lidera, quem vai a 2º turno, quem é chamado, quem se elege ao Senado), nunca o número publicado ao leitor.
4. **Degradação segura.** Sem `dvt` publicado para a corrida inteira (comum antes da 1ª totalização parcial) ou com `dvt` divergente entre arquivos do mesmo ciclo para o mesmo candidato, o comportamento é idêntico ao vigente antes deste ADR — nenhuma exclusão, base = `vvc` inteiro — com aviso no log. Um valor de `dvt` fora do dicionário conhecido (`_DESTINO_POR_DVT`) é tratado como ausente para efeito desta regra: nunca "desconhecido ⇒ anulado", nunca "desconhecido ⇒ válido".
5. **Implementação na fronteira das decisões**, não em `_extract_zone_candidatos`: as candidaturas anuladas são retiradas depois da extração, e as frações remanescentes renormalizadas por `f_i / (1 − Σ f_anulados)` DEPOIS de `estimate_uf_candidatos` (que segue intocado — é ele que produz os percentuais publicados sobre `vvc`) e antes de alimentar `compute_national`, `compute_p_fecha_1t`, `compute_two_round_scenarios`, `p_vitoria`, `p_eleito` e o bloco por UF. Risco menor a 7 dias do 1º turno (04/10/2026) do que reabrir o extrator de zona, que alimenta todo o resto do pipeline (participação, "Outros", séries).

## Consequências

**Positivas**:
- Corrige um caso medido em que o site reportaria `p_fecha_1t = 0` para um candidato que, descontados os votos de anulação definitiva, já teria maioria absoluta — o erro (A) do contexto.
- Corrige o caso em que uma candidatura anulada poderia aparecer como `lider`, entrar no par de 2º turno ou ocupar uma vaga do Senado no ranking (`p_eleito`) — o erro (B).
- Preserva a exibição publicada (percentuais sobre `vvc`, conforme art. 267 §4º da Res. TSE 23.751/2026 e ADR-0018) intacta — a mudança é cirúrgica, restrita às decisões de corrida.
- Degradação segura garante que o replay 2022 (sem `dvt`) e qualquer ciclo antes da 1ª totalização parcial continuam bit-a-bit idênticos ao comportamento anterior — o gate OT-4 não é afetado.

**Negativas**:
- **A lista pode mostrar uma candidatura anulada com X% de `vvc` enquanto a agulha, o `p_fecha_1t` e o 1º/2º turno a ignoram inteiramente.** Isso precisa ser declarado explicitamente na metodologia (`/sobre-o-modelo`, spec 011) — sem essa nota, o leitor vê um número na lista que não bate com "quem está competindo" no resto da tela.
- **O simulado do TSE não reproduz o caso (A)/(B) de forma automática**: os cenários de simulado historicamente protegem o candidato do topo do ranking, então não há hoje um teste de regressão end-to-end contra dado real do TSE que force uma candidatura anulada a liderar. A cobertura depende de fixtures sintéticas construídas a partir da captura real (como as citadas no Contexto).
- **O tratamento de "Anulado sub judice" é uma decisão política registrada, não uma conclusão jurídica confirmada** (ver Ponto aberto). Se a orientação jurídica mudar, este ADR precisa de emenda ou superseder.
- **Complexidade duplicada na fronteira de decisão**: a exclusão e renormalização precisam ser aplicadas de forma consistente em cinco pontos de consumo (`compute_national`, `compute_p_fecha_1t`, `compute_two_round_scenarios`, `p_vitoria`/`p_eleito`, bloco por UF) — divergência entre esses pontos reintroduziria exatamente o bug que este ADR corrige.
- **Base de maioria absoluta (`vvc − van`) ainda não tem confirmação normativa própria** — é uma interpretação razoável do art. 77 §2º/art. 28 (maioria dos válidos, sem brancos/nulos), mas nenhum artigo da Res. 23.751/2026 confirma o tratamento específico de anulados/sub judice nesse cômputo (`docs/reference/regulatory.md:46-50`).

## Ponto aberto

**Os votos sub judice contam no denominador da maioria absoluta do 1º turno?** Este ADR assume que sim (mantém `vansj` na base `vvc − van`), seguindo o TSE, que mantém a candidatura sub judice formalmente em disputa (`st`/`e` observados na captura real). Pendente de confirmação jurídica pelo dono do produto antes do 1º turno (04/10/2026); se a orientação mudar, requer ADR de emenda ou substituição deste.

## Emenda 2026-09-27 (tarde): a lista passa a mostrar a base da disputa

### Contexto

A decisão 3 original deste ADR manteve a exibição intocada: todo percentual de candidato continuava sobre `vvc` inteiro ([ADR-0018](0018-termometros-hero-1t.md)), e só as decisões de corrida (líder, `p_fecha_1t`, chamada) passaram a ignorar a candidatura anulada. Isso produz três números diferentes contando a mesma corrida. Medido pelo dono com um exemplo de bancada: candidaturas Ana 45%, Bruno 30%, Carla (sub judice) 10% e Davi (anulado) 15%, todos percentuais de `vvc`. Com a decisão original, a lista mostraria "Ana 45%", o círculo 1 do gráfico "A corrida" ([spec 022](../../specs/022-corrida-em-tres-circulos/spec.md), base `contagens.validos`) mostraria "Ana 60%", e a decisão de corrida (RF-213, base `vvc − van`) apontaria "Ana venceu no 1º turno" com 53% — três números para a mesma pessoa, e só o terceiro conta a história que a própria tela também afirma ("Ana venceu"). É exatamente o caso descrito na consequência negativa já registrada acima ("a lista pode mostrar uma candidatura anulada com X% de `vvc` enquanto a agulha, o `p_fecha_1t` e o 1º/2º turno a ignoram inteiramente") — mas o problema alcança também as candidaturas que **continuam** competindo, não só a anulada.

### Decisão (opção A do dono)

Quando a abrangência da tela — Brasil para Presidente; a UF para Governador e Senador; município e mesorregião dentro do escopo da UF — tem ao menos uma candidatura com destino `"anulado"`, **todo percentual de candidatura que compete** passa a ser publicado e exibido sobre os **votos em disputa** = `vvc − Σ votos das candidaturas anuladas` (válidos + sub judice) — a mesma base que, desde a decisão original deste ADR, já decide 1º turno, líder, chamada e vagas. O líder mostrado com mais de 50% nessa base é exatamente quem vence no 1º turno: a lista e a decisão de corrida voltam a contar a mesma história. A candidatura anulada permanece na lista, ao final, com etiqueta "Anulado", mostrando **apenas o total de votos**, sem percentual algum. Sem nenhuma candidatura anulada na abrangência, nada muda: a base continua sendo `vvc` inteiro, igual ao `pvap` publicado pelo TSE — o caso observado em todos os ciclos do simulado até esta data. Sempre que a base publicada diverge do `pvap` do arquivo do TSE, a metodologia ([spec 011](../../specs/011-sobre-o-modelo/spec.md)) declara essa divergência explicitamente.

No gráfico "A corrida" ([spec 022](../../specs/022-corrida-em-tres-circulos/spec.md)): o **círculo 1** passa a ter como base os "votos em disputa" (`validos + sub_judice`, em vez de só `validos`), com a(s) candidatura(s) sub judice aparecendo como fatia própria e nomeada, ao lado das quatro maiores válidas + "Outros"; nos **círculos 2 e 3**, a fatia hoje rotulada "Anulados e sub judice" passa a se chamar apenas **"Anulados"** (`contagens.anulados`, isto é, `van`) — a candidatura sub judice sai dela e passa a contar dentro das fatias de candidatura/"Outros", já que compete. O **círculo de projeção** (RF-212) passa a ter como total `votacao.projetada.validos + Σ votos_projetados das candidaturas sub judice`, com as fatias divididas pela proporção de votos projetados entre quem compete (excluída a anulada). O painel "Votação" ([spec 021](../../specs/021-votacao-eleitorado/spec.md)) **não muda** — continua seguindo a árvore de contagem do TSE tal como publicada, sem excluir nada.

Isto substitui a decisão 3 original deste ADR ("a exibição não muda... continuam sobre `vvc` inteiro") sempre que há candidatura anulada na abrangência. Fora desse caso — hoje a totalidade dos ciclos observados — a decisão 3 original permanece exatamente como estava.

### Consequências

**Positivas**:
- O número que a lista mostra para um líder com mais de 50% conta a mesma história que o resto da tela: "lidera com X%" e "venceu no 1º turno" deixam de poder discordar sobre o mesmo candidato.
- Fecha o caso medido pelo dono (45% / 60% / 53% para a mesma pessoa, na mesma tela) sem introduzir uma quarta base nova — reaproveita exatamente a base que o RF-213 original já calcula para as decisões de corrida.
- Séries históricas e percentuais publicados por município (dentro do escopo da UF) herdam a mesma base sem regra própria: é o mesmo mecanismo de exclusão/renormalização de RF-213 ([spec 002](../../specs/002-modelo-estatistico/spec.md)), agora estendido também ao caminho de exibição.
- Continua degradando com segurança: sem nenhuma candidatura `"anulado"` na abrangência, a base publicada continua sendo `vvc` inteiro, idêntica ao `pvap` do TSE — nada nesta emenda muda o número exibido nesse caso.

**Negativas**:
- **Percentuais publicados deixam de bater com o `pvap` do TSE sempre que há candidatura anulada** — diferente de toda a exibição anterior a esta emenda (e de todo o ADR-0018, que nunca divergia do denominador oficial). Exige nota explícita na metodologia (spec 011, constituição § 8); sem ela, um leitor comparando com o boletim do TSE veria um número aparentemente "errado".
- **A candidatura anulada perde comparabilidade direta na lista**: mostra só votos absolutos, nunca um percentual — "quanto ela tirou em proporção de tudo" deixa de estar num só lugar e passa a exigir ida à metodologia ou ao painel "Votação" (que segue publicando a árvore completa do TSE, sem excluir nada).
- **O ADR-0018 deixa de valer "sempre `vvc`"** — qualquer leitura futura que cite aquele ADR como garantia de denominador único e invariável precisa primeiro checar se a abrangência tem candidatura anulada (ver nota de emenda parcial adicionada naquele ADR).
- **Mais um ponto de troca de base em cascata**: a lista de candidatos, os três círculos de "A corrida" (RF-202/204/205/212) e as séries por município agora precisam concordar sobre a mesma exclusão/renormalização — divergência entre esses pontos reproduziria a mesma classe de bug que esta emenda corrige (mesmo risco já registrado nas Consequências Negativas originais deste ADR sobre "complexidade duplicada na fronteira de decisão", agora estendido à camada de exibição).
- **O ponto aberto sobre sub judice no denominador (acima) passa a governar também o que a lista publica** — se a orientação jurídica mudar e sub judice sair do denominador da maioria absoluta, o mesmo corte precisa sair do denominador exibido, sob pena da lista voltar a divergir da decisão de corrida.

### Adendo — a margem e o selo de "chamada" seguem a mesma base (decisão do dono, 2026-09-27)

Com anulada no escopo, `margem_atual`, `margem_projetada` e `margem_projetada_ci` do `por_uf[]` passam a ser calculadas sobre os votos em disputa — a margem publicada é a diferença entre os dois primeiros que competem, como aparecem na lista (exemplo-guia: Ana 52,94 − Bruno 35,29 = 17,65, e não 15 sobre `vvc`). A `chamada` (`margem > 10`) e a agulha da UF (`margem/20`) usam essa margem. Consequência assumida: com anulada, a chamada pode sair um pouco antes, porque a mesma diferença de votos vale mais pontos sobre um total menor. A série da noite deixa de trazer a linha da anulada. Sem anulada, nada muda.

## Cross-refs

- [ADR-0018](0018-termometros-hero-1t.md) — denominador `v.vvc` (mesmo do `pvap` oficial); **emendado parcialmente** por esta decisão (ver nota adicionada naquele ADR) — deixa de valer "sempre `vvc`" quando há candidatura anulada na abrangência.
- [ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) — o replay 2022 não expõe este caso (sem `dvt`, `vvc == vv` em 2022).
- [ADR-0006](0006-bootstrap-nao-bayesiano.md) — bootstrap não-paramétrico consumido por `p_vitoria`/`p_eleito`, ponto de aplicação da renormalização.
- [ADR-0014](0014-p-segundo-turno-primeira-classe.md) — `p_segundo_turno_overall`/`cenarios_2t`, afetados pela exclusão.
- Spec: [002-modelo-estatistico](../../specs/002-modelo-estatistico/spec.md) — novo RF-213, emendado (2026-09-27, tarde) com o item de publicação/exibição.
- Spec: [022-corrida-em-tres-circulos](../../specs/022-corrida-em-tres-circulos/spec.md) — RF-202/203/204/205/212 emendados: base do círculo 1, fatia "Anulados", círculo de projeção.
- Spec: [003-home-nacional](../../specs/003-home-nacional/spec.md), [004-pagina-uf-presidencial](../../specs/004-pagina-uf-presidencial/spec.md), [005-pagina-uf-governador](../../specs/005-pagina-uf-governador/spec.md) — nota curta onde a lista de candidatos é descrita.
- Spec: [006-grid-governadores](../../specs/006-grid-governadores/spec.md) — nota em RF-006.8 (`lider`/`chamada`/`vai_a_2t` por UF), com adendo desta emenda.
- Spec: [016-senador](../../specs/016-senador/spec.md) — nota em RF-102/103/104 (`p_eleito`, líder, margem), com adendo desta emenda.
- [docs/reference/regulatory.md](../../reference/regulatory.md) — lacuna normativa confirmada sobre tratamento de anulados/sub judice.
- Constituição § 6 (determinismo) e § 8 (transparência metodológica): [../../constitution.md](../../constitution.md).
