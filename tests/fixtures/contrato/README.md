# Fixtures de contrato — Deputado Federal v2 (spec 026)

Escritas à mão no formato de produção, para as frentes T, P, S e U trabalharem contra o mesmo alvo
até o modo simulado emitir v2 (`docs/specs/026-deputado-listas-projecao/design.md` § 2 e § 9).
Os números fecham por construção: foram passados pelo algoritmo real de cadeiras
(`api/model/cadeiras.py`) e por `_marcar_indefinidas`, e as invariantes estão em
`tests/unit/contrato/deputado-v2-fixtures.test.ts` — recalculadas a partir dos votos, nunca lidas do
campo que conferem.

| Arquivo | O que é |
|---|---|
| `deputado-uf-v2.json` | Mapa `sigla → DeputadoUfDetail` v2 (`deputado/uf/<UF>.json`), 4 UFs |
| `deputado-uf-lista.json` | Mapa `sigla → DeputadoUfLista` (`deputado/uf-lista/<UF>.json`), só ranks > 60 |
| `deputado-nacional-v2.json` | `EdgePayloadDeputado` v2 (`projection-current-dep-t1`), derivado das 4 UFs |

## Os quatro estados

| UF | % apurado | Trava | Conferência | O que exercita |
|---|---|---|---|---|
| AC | 100, `tf` | `liberada` (projeção = parcial) | `diverge` — cadeiras e eleitos | marca do TSE com precedência; rótulo do TSE ≠ nossa via; `nao_eleito`; sem `numero` |
| AP | 80,5 | `indisponivel` / `cobertura` | `diverge` — eleitorado −19,5% | o achado real do simulado de 28/09 (par Macapá×0014 fora da tabela `zonas`); chapa inteira sub judice |
| RR | 62,4 | `liberada` | `confere` | parcial ≠ projeção; sobra apertada nas duas; os três destinos; puxador; corte abaixo do piso de 10% |
| SP | 18,7 | `aguardando` / `pct_minimo` | `sem_dado_tse` | `dvt` ausente; lista 61+ (só SP tem agremiação com mais de 60 candidatos); dois puxadores |

Os nomes são sintéticos (`Sobrenome UF-cod-nn`), os `sqcand` são números de 11 dígitos inventados e o
`zonas_total` de SP é ilustrativo. O eleitorado do AP (505.610 × 628.071) é o número real medido em
`tests/fixtures/tse/2026-sim/dep/README.md` § 4.

## O caso v1 continua em outro lugar

`tests/fixtures/blob/dep-uf.json` **fica intocado** e é o caso v1 — objeto gravado antes do deploy do
v2, sem `contrato`, sem `candidatos`. O leitor tolerante (RF-276) é testado contra ele. Não o migre: o
teste de contrato acima falha se ele ganhar `contrato` ou `candidatos`.
