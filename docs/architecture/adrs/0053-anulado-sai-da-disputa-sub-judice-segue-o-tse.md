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

## Cross-refs

- [ADR-0018](0018-termometros-hero-1t.md) — denominador `v.vvc` (mesmo do `pvap` oficial), inalterado pela exibição.
- [ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) — o replay 2022 não expõe este caso (sem `dvt`, `vvc == vv` em 2022).
- [ADR-0006](0006-bootstrap-nao-bayesiano.md) — bootstrap não-paramétrico consumido por `p_vitoria`/`p_eleito`, ponto de aplicação da renormalização.
- [ADR-0014](0014-p-segundo-turno-primeira-classe.md) — `p_segundo_turno_overall`/`cenarios_2t`, afetados pela exclusão.
- Spec: [002-modelo-estatistico](../../specs/002-modelo-estatistico/spec.md) — novo RF-213.
- Spec: [006-grid-governadores](../../specs/006-grid-governadores/spec.md) — nota em RF-006.8 (`lider`/`chamada`/`vai_a_2t` por UF).
- Spec: [016-senador](../../specs/016-senador/spec.md) — nota em RF-102/103/104 (`p_eleito`, líder, margem).
- [docs/reference/regulatory.md](../../reference/regulatory.md) — lacuna normativa confirmada sobre tratamento de anulados/sub judice.
- Constituição § 6 (determinismo) e § 8 (transparência metodológica): [../../constitution.md](../../constitution.md).
