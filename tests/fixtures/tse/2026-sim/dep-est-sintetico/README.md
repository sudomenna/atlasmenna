# Deputado Estadual (cargo 7) — fixture SINTÉTICA, derivada de EA20 reais de cargo 6

> ⚠️ **Não é arquivo do TSE.** Os arquivos aqui são os agregados **reais** de Deputado Federal de Roraima do
> simulado de 28/09 (`../dep/rr/`, ver o README de lá) **relabelados** como Deputado Estadual.
>
> **Prefira os EA20 reais de cargo 7/8** de `../dep-est/` (RR, SP e DF, capturados em 29/09). Esta pasta cobre só
> os dois estados que a captura real não viu: o agregado com `and = "n"` (0%) e o com `tf = "s"` (totalização
> final — marcas oficiais de eleito).

## Por que existe

O ciclo do modelo para os cargos 7/8 na Fase 1 da spec 027 (resumo: só o agregado de cada casa, sem zonas)
precisava, para os estados de 0% e de totalização final, de um EA20 com a forma real — `carg[]`, `agr[]`,
`par[]`, `cand[]` com `dvt`, `e`/`v`/`s`, `dg`/`hg`, `tf`/`and` — e com `cd = "7"`. Inventar um do zero perderia exatamente o que os arquivos reais já provaram
(`dvt` "Válido (legenda)" e "Anulado sub judice", legenda recalculada, identidades `v.vv = Σ tvtn + tvtl`). O
eleitorado de RR é o mesmo para os dois cargos, então relabelar os votos é a menor mentira possível.

## A transformação (determinística; o código é a fonte)

Gerador: `tests/unit/model/_fixture_dep_est_sintetico.py`. O teste
`tests/unit/model/test_deputado_estadual.py::test_fixture_sintetica_e_a_transformacao_declarada` refaz a
transformação em memória a partir de `../dep/rr/` e compara com estes arquivos — a pasta não tem como derivar da
regra escrita.

1. `carg[].cd` `"6"` → `"7"`; `nmm`/`nmn` → `"Deputado Estadual"`, `nmf` → `"Deputada Estadual"`.
2. `carg[].nv` `"8"` → `"24"` (CF art. 27: a Assembleia de RR tem 3 × 8 = 24 deputados).
3. 🔴 **Recalculados pela NOSSA conta** (`api/model/cadeiras.py::distribuir_cadeiras`, ADR-0027), porque os do
   arquivo real valem para 8 cadeiras e contradiriam `nv = 24`:
   - `carg[].qe` e `agr[].vag`, nos momentos com `and ≠ "n"`;
   - `cand[].st` / `cand[].e` no momento final (`tf = "s"`): "Eleito por QP" para as cadeiras da fase 1
     (`deputado_payload._cadeiras_de_fase_1`), "Eleito por média" para as de sobra, "Suplente" para
     `resultado.suplentes`, "Não eleito" para o resto.

   **Consequência:** a Conferência (spec 026 RF-269) sobre estes arquivos dá `confere` **por construção**. O que
   ela prova aqui é o **encanamento** do cargo 7 — a conta roda, `comparou` traz as comparações certas, o payload
   sai sem "Câmara" — e **nunca** que o algoritmo concorda com o TSE. Essa prova continua sendo a dos EA20 reais
   de cargo 6 (`../dep/`), a dos reais de cargo 7 quando existirem (`../dep-est/`) e o golden de 2022
   (`scripts/build-cadeiras-golden.py --cargo 7`, que depende dos dados de 2022 que o dono baixa no navegador).

   Com `and = "n"` (m0) nada é recalculado: o TSE publica `qe = "0"` e um `vag` de rodada anterior (soma 8,
   herdada do arquivo real), que a Conferência não lê.

Todo o resto é o arquivo real, com o mesmo conteúdo e o mesmo formato (uma linha, sem espaços, UTF-8 cru — o
texto `payload::text` do jsonb, ver `../dep/README.md`): votos, `e`, `v`, `s`, `dg`/`hg`, `ele = 21272` (os
cargos 7/8 moram na mesma eleição do TSE que o 6), nomes sintéticos do simulado (`CANDIDATO 9276`, sem PII).

## Arquivos

Só os **agregados** de RR, e só os dois estados sem arquivo real — a Fase 1 não lê zonas, e os momentos
parciais existem em `../dep-est/rr/` (cargo 7 real a 7%).

| Momento | Arquivo | `and`/`tf` | `qe` | Σ `vag` | Marcas (`st`) |
|---|---|---|---|---|---|
| `m0-zero` | `rr/m0-zero/rr-c0007-e021272-u.json` | n/n | 0 (TSE) | 8 (resto do real) | — |
| `m3-final-tf` | `rr/m3-final-tf/rr-c0007-e021272-u.json` | f/s | 14.336 (nosso) | 24 | 3 por QP, 21 por média |

## Regravar

Não é preciso para os testes (eles leem o disco). Se a regra do gerador mudar:

```bash
.venv-model/bin/python3.14 -m tests.unit.model._fixture_dep_est_sintetico
```
