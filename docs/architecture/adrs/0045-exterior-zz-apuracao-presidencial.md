---
id: ADR-0045
title: Exterior (ZZ) entra na apuração presidencial como 28ª unidade, com pseudo-zona por localidade
status: accepted
date: 2026-09-17
---

# ADR-0045 — Exterior (ZZ) entra na apuração presidencial

## Status

Aceito em 2026-09-17, por decisão do dono do produto, com escopo completo (ingestão + modelo +
página própria). Supersede parcialmente a tarefa **T01 da spec 002**
(`docs/specs/002-modelo-estatistico/tasks.md:30-35`), que instituiu o filtro `uf <> 'ZZ'` como
correção de cobertura.

## Contexto

O eleitor domiciliado no exterior vota **apenas para Presidente da República** (Código Eleitoral,
art. 225): sem domicílio em estado ou município, não escolhe Governador, Senador nem Deputado. Para o
TSE, porém, o exterior não é um caso especial: é uma abrangência como qualquer outra, sob a sigla
`ZZ`, com pasta própria no CDN (`dados/zz/`) e os mesmos leiautes.

Medições feitas contra o ambiente de simulado em 17/09/2026 (arquivos reais em
`tests/fixtures/tse/2026-sim/`):

| Fato | Valor |
|---|---|
| Localidades (embaixadas, consulados, seções) | **184** |
| Zonas eleitorais | **1** (zona `0001` para todas as 184) |
| Eleitores aptos (`e.te` em `zz-c0001-e021270-u.json`) | **760.913** |
| Arquivos disponíveis | UF (`zz-c0001-…-u.json`), acompanhamento (`zz-e021270-ab.json`, 185 itens), par (`zz29254-z0001-…-u.json`) |
| Cargos com arquivo | só `c0001` (Presidente) |

O AtlasMenna exclui `ZZ` em **todas** as camadas, por decisões independentes tomadas ao longo de
S01–S03: `lib/tse/targets.ts` (`TODAS_UFS` com 27 siglas), `lib/tse/ea12-schema.ts:113`
(`excluirUfs` com default `["ZZ"]`), `data-pipeline/zonas-import.ts:111,140` e
`data-pipeline/validate-coverage.ts:22,31` (`uf <> 'ZZ'`), `data-pipeline/simulacao-gerar.ts:1001`,
`scripts/build-replay-fixtures.ts:103`. No banco, `historical_results` tem 28 linhas ZZ (2018 e 2022,
sempre cargo 1, zona única) e `eleitorado`, `zonas`, `municipios` e `candidatos` têm **zero**.

A consequência não é um número nacional errado — o total do país vem do arquivo BR do próprio TSE —,
mas uma **projeção cega**: o modelo nunca vê ~0,5% do eleitorado, que tem comportamento próprio,
apura cedo (fuso a favor, seções pequenas) e é noticiado de forma destacada em toda eleição
presidencial. Ingerir o dado e não exibi-lo seria pior: contraria a constituição § 8 (transparência
metodológica), porque o público veria "100% apurado" com uma abrangência inteira fora da conta.

## Decisão

**O exterior passa a ser a 28ª unidade de apuração, exclusivamente no cargo 1.**

1. **Escopo por cargo, declarado na tabela canônica.** `CargoInfo` ganha `abrangeExterior: boolean`
   (`true` só no cargo 1) e a tabela expõe `unidadesDeApuracao(cargo)` (27 ou 28). Nenhum ramo
   `default`, nenhum ternário sobre sigla: o escopo é dado da tabela, como `eleicao` no
   [ADR-0044](./0044-codigo-eleicao-por-cargo.md).

2. **Chave sintética em `municipios`, sem migration de schema.** As 184 localidades entram com
   `cod_ibge = 'ZZ' || lpad(cod_municipio_tse, 5, '0')` — 7 caracteres, o tamanho da coluna, sem
   colisão possível com código IBGE (que é só dígitos). `geo_centroid`, `populacao` e
   `mesorregiao_cod` já são nuláveis; `capital = false`. A carga vive em
   `zonas-import.ts --ea12 … --exterior`, na mesma transação e antes da checagem de chave
   estrangeira, porque o EA12 é a única fonte dos nomes.

3. **`zonas` recebe 184 pares** `(ZZ, cod_municipio_tse, 1)` com `fonte = 'ea12'`.

4. **`eleitorado` do exterior vem de 2022, não de 2024.** O CSV
   `eleitorado_local_votacao_2024` é de pleito municipal — o exterior não vota, e o arquivo não o
   contém (confirmado: zero linhas). Script novo `data-pipeline/eleitorado-exterior-import.ts` lê
   `eleitorado_local_votacao_2022`, filtra `SG_UF = 'ZZ'` e grava com `ano = 2026`;
   `eleitorado-import.ts` passa a apagar com `AND uf <> 'ZZ'` para que o reimport de 2024 não
   destrua o exterior. Confere-se o total contra `e.te` do `zz-e021270-ab.json`.

5. **Granularidade `zona`, com pseudo-zona por localidade no modelo.** A ingestão busca os 184 pares
   (cargo 1 passa de 6.110 para ~6.294 alvos, ≈ 252 s a 25 req/s, dentro do teto de 300 s). No
   modelo, as 184 linhas compartilham `cod_zona = 1` e seriam colapsadas em **uma** unidade por
   `merge_pairs_into_zonas` — o bootstrap degeneraria para intervalo de largura zero, que é uma
   afirmação de certeza vedada pela constituição § 6, e é a mesma patologia que tirou o Senador da
   granularidade `uf` em 11/09. Por isso, e **só para `ZZ`**, a chave de agrupamento passa a ser o
   código da localidade (`cod_zona := cod_municipio_tse`), tanto no merge quanto no `GROUP BY` do
   eleitorado. O caminho de detalhe municipal continua lendo as linhas cruas.

6. **`swing_vs_2022` é `null` no exterior.** O histórico existe, mas com zona única: não há
   variação intra-unidade que sustente o cálculo. A interface já trata ausência com travessão.

7. **Interface: linha e página, nunca hexágono.** O cartograma mantém as 27 siglas — inventar uma
   posição geográfica para o exterior seria afirmar uma geografia que não existe. O exterior aparece
   como linha "Exterior" na tabela nacional e como página `/uf/ZZ`, **apenas** na rota presidencial;
   Governador, Senador e Deputado devolvem 404 para `ZZ`. A página não carrega mapa: mostra painel
   estático e a lista das 184 localidades. Os contadores que hoje dizem "N de 27" passam a usar
   `unidadesDeApuracao(cargo)`.

8. **O que permanece excluindo `ZZ`**: `scripts/build-replay-fixtures.ts` (o replay 2022 é o gate
   OT-4 e sua série de referência não pode mudar de composição) e `data-pipeline/simulacao-gerar.ts`.

## Alternativas consideradas

**Manter o exterior fora.** Custo zero hoje, e o total nacional continuaria correto. Rejeitada
porque o erro é silencioso e cresce: a projeção seria publicada como nacional sem 760 mil eleitores,
sem nenhum aviso na tela, e a correção no dia 04/10 seria impossível.

**Ingerir sem exibir.** Alimentaria o modelo sem custo de interface. Rejeitada por contrariar a
constituição § 8: o leitor veria a apuração fechar sem saber que uma abrangência inteira estava
dentro da conta e fora da tela.

**Tratar o exterior como uma zona só (sem pseudo-zona).** Seria a leitura literal do dado do TSE.
Rejeitada porque produz intervalo de confiança de largura zero — o modelo afirmaria certeza sobre
uma unidade de 760 mil eleitores.

## Consequências

- **Positivas**: a projeção presidencial deixa de ser cega a ~0,5% do eleitorado; o produto ganha
  uma página que a imprensa cobre em toda eleição; a chave sintética abre caminho para qualquer
  abrangência futura sem código IBGE.
- **Custos**: ~18 arquivos tocados, 1 script novo de importação, +184 requisições por ciclo no cargo
  1 (folga medida de 48 s no limite de execução), e uma exceção declarada no modelo (`ZZ` agrupa por
  localidade) que precisa de teste próprio para não virar regra geral por descuido.
- **Riscos de regressão silenciosa**: o número 27 aparece literalmente em `BulletinPanel`,
  `ApuracaoMeta`, `RemainingPanel` e `StateGroupedTable`; a tabela `zonas` passa a conter linhas
  `ZZ` que, sem o filtro por cargo nos construtores de alvo, gerariam URLs `zz…-c0003` inexistentes
  para Governador — 184 respostas 404 por ciclo, e o TSE bloqueia IP por volume de 404.
- **RFs afetados**: spec 001 (fan-out), spec 002 (unidade de reamostragem), spec 003 (unidades na
  home), spec 004 (rota `/uf/ZZ`), spec 015 (detalhe sem mapa).

## Referências

- [ADR-0044 — código de eleição por cargo](./0044-codigo-eleicao-por-cargo.md)
- [ADR-0035 — par município×zona como unidade de ingestão](./0035-par-municipio-zona-unidade-de-ingestao.md)
- [ADR-0036 — Deputado Federal em zona fatiada](./0036-deputado-federal-granularidade-zona-fatiada.md)
- `docs/reference/tse-2026-leiautes.md` — leiautes EA12/EA14/EA15/EA20
- `tests/fixtures/tse/2026-sim/` — arquivos reais do simulado, incluindo os três do exterior
