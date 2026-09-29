# Deputado Estadual (cargo 7) e Distrital (cargo 8) — EA20 reais do simulado TSE, RR, SP e DF

Contrato de dados para a spec 027 (cobrir os cargos 7 e 8 reaproveitando o pipeline do cargo 6). São os **primeiros
arquivos `c0007`/`c0008` que o projeto viu**: nenhum tinha sido baixado antes de 29/09/2026. Todos são do **simulado
oficial do TSE**, eleição estadual `21272`, turno 1, e estão **byte a byte como o CDN os serviu** (`biome.json` isenta
`tests/fixtures/tse/2026-sim/**` do formatador — não reformatar).

## Origem

- **Base**: `https://resultados-sim.tse.jus.br/simulado/simulado2026`, ciclo `ele2026`, eleição `21272`.
- **Rede**: 10 requisições `GET` no total (orçamento fixado de antemão; o contador foi gravado **antes** de cada
  requisição, então falha também gastaria orçamento), **1,5 s de espaçamento mínimo**, sem redirect, sem repetição,
  `Accept-Encoding: gzip` (a resposta veio `content-encoding: gzip`, observado na #10). User-Agent do projeto
  (`lib/tse/client.ts:82`, o mesmo do ingest — `resultados-sim.tse.jus.br` não o bloqueia; o 403 do UA é só de
  `cdn.tse.jus.br`/`dadosabertos`). Nenhum banco, nenhum `.env.local`, nenhuma ingestão real.
- **Nenhuma URL adivinhada (constituição § 1).** Cada endereço foi derivado de arquivo publicado:
  o `ele-c.json` (EA11) dá `arq[tp=cm].dir = <base>/<ambiente>/<ciclo>/<cd_eleicao>/config` e
  `arq[tp=u].dir = …/<cd_eleicao>/dados/<uf>`; o nome dos arquivos vem das Instruções para download § 5 e os builders
  de `lib/tse/targets.ts:168-241`; os pares município×zona vieram do próprio `mun-e021272-cm.json` baixado.
  Todas as 10 respostas foram **200** — nenhum 404, nenhum 403, nenhum 429.
- **Estado do simulado**: rodada do dia 29/09 em andamento (`dt` 29/09/2026, `and = p`, 7% das seções); os arquivos
  estão em pontos diferentes da rodada (ver coluna `and` e `hg` abaixo).

### Requisições, na ordem

| # | UTC (29/09) | Status | Bytes (decodificado) | Endereço (a partir de `…/simulado/simulado2026/`) | `Last-Modified` | ETag |
|---|---|---|---|---|---|---|
| 1 | 18:05:57 | 200 | 1.857 | `comum/config/ele-c.json` | 18/09 15:55:29 GMT | `7128d499…` |
| 2 | 18:06:09 | 200 | 519.119 | `ele2026/21272/config/mun-e021272-cm.json` | 18/09 16:02:33 GMT | `16fbc92b…` |
| 3 | 18:06:41 | 200 | 118.193 | `ele2026/21272/dados/rr/rr-c0007-e021272-u.json` | 29/09 18:01:55 GMT | `0b321a57…` |
| 4 | 18:06:43 | 200 | 572.511 | `ele2026/21272/dados/sp/sp-c0007-e021272-u.json` | 29/09 18:03:01 GMT | `912ea863…` |
| 5 | 18:06:50 | 200 | 118.185 | `ele2026/21272/dados/rr/rr03018-z0001-c0007-e021272-u.json` | 29/09 18:01:54 GMT | `9f089273…` |
| 6 | 18:06:54 | 200 | 177.236 | `ele2026/21272/dados/df/df-c0008-e021272-u.json` | 29/09 18:01:51 GMT | `ef2a1d8e…` |
| 7 | 18:06:55 | 200 | 176.395 | `ele2026/21272/dados/df/df97012-z0001-c0008-e021272-u.json` | 29/09 18:01:48 GMT | `4230b878…` |
| 8 | 18:08:58 | 200 | 102.333 | `ele2026/21272/dados/rr/rr03085-z0008-c0007-e021272-u.json` | 29/09 16:23:22 GMT | `8b42015a…` |
| 9 | 18:09:00 | 200 | 152.636 | `ele2026/21272/dados/df/df97012-z0021-c0008-e021272-u.json` | 29/09 16:22:50 GMT | `3ea3421c…` |
| 10 | 18:10:22 | 200 | 569.857 | `ele2026/21272/dados/sp/sp71072-z0001-c0007-e021272-u.json` | 29/09 18:06:30 GMT | `e7fd38fe…` |

`cache-control: max-age=3…60` em todos os `u.json` (o do agregado do DF: `max-age=6`; o `ele-c.json`: `max-age=58`).

## Arquivos

| Arquivo | O que é |
|---|---|
| `ele-c.json` | EA11 de hoje. **Idêntico byte a byte** a `../ele-c.json` (14/09): `dg 14/09/2026 20:58:55`, mesmas 3 eleições. Confirma `7` (Deputado Estadual) e `8` (Deputado Distrital) na `21272`, ambos `tp: "2"` (proporcional), sob a abrangência `br` |
| `mun-e021272-cm.json` | EA12 **estadual** (nunca capturado antes): 27 abrangências (sem `zz`), 6.105 pares município×zona |
| `rr/rr-c0007-…-u.json` | Cargo 7, agregado de UF, Roraima |
| `rr/rr03018-z0001-c0007-…-u.json` | Cargo 7, Boa Vista × zona 0001 (a zona que já tem boletim) |
| `rr/rr03085-z0008-c0007-…-u.json` | Cargo 7, Rorainópolis × zona 0008 (**0%**, `and = n`) |
| `sp/sp-c0007-…-u.json` | Cargo 7, agregado de UF, São Paulo (o pior caso de tamanho) |
| `sp/sp71072-z0001-c0007-…-u.json` | Cargo 7, São Paulo (capital) × zona 0001 |
| `df/df-c0008-…-u.json` | **Cargo 8**, agregado do DF |
| `df/df97012-z0001-c0008-…-u.json` | Cargo 8, Brasília × zona 0001 (100%, `and = f`) |
| `df/df97012-z0021-c0008-…-u.json` | Cargo 8, Brasília × zona 0021 (**0%**, `and = n`) |

## O que foi conferido, arquivo a arquivo

Todos: `ele = 21272`, `t = 1`, `f = s`, `sup = n`, `dv = s`, `md`/`esae`/`mnae` **ausentes**, `carg` com **1** elemento,
`carg[0].fed` com as **mesmas 3 federações** (100, 101, 102) do cargo 6, `perg` ausente.

| Arquivo | `tpabr`/`cdabr` | `hg` (29/09) | `and`/`tf` | `s.ts` / `s.st` / `s.pst` / `s.psa` | `e.te` / `e.esi` / `e.pest` | `carg.cd` | `nv` | `qe` | agr / par / cand | `vv` | `vansj` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rr-c0007` | uf/rr | 15:01:38 | p/n | 1.620 / 114 / 7,04 / **100,00** | 407.271 / 26.870 / 6,60 | 7 | **24** | 930 | 20 / 24 / 480 | 22.320 | 531 |
| `rr03018-z0001-c0007` | zona/0001 | 15:01:44 | p/n | 613 / 114 / 18,60 / 100,00 | 157.104 / 26.870 / 17,10 | 7 | **24** | ausente | 20 / 24 / 480 | 22.320 | 531 |
| `rr03085-z0008-c0007` | zona/0008 | 13:21:04 | n/n | 89 / 0 / 0,00 / **0,00** | 22.034 / 0 / 0,00 | 7 | **24** | ausente | 20 / 24 / 480 | 0 | 0 |
| `sp-c0007` | uf/sp | 15:02:53 | p/n | 106.580 / 7.461 / 7,00 / 100,00 | 35.745.722 / 2.477.423 / 6,93 | 7 | **94** | 19.831 | 26 / 30 / 2.444 | 1.864.125 | 240.180 |
| `sp71072-z0001-c0007` | zona/0001 | 15:03:54 | f/n | 476 / 476 / 100,00 / 100,00 | 155.570 / 155.570 / 100,00 | 7 | **94** | ausente | 26 / 30 / 2.444 | 116.973 | 15.018 |
| `df-c0008` | uf/df | 15:01:38 | p/n | 7.009 / 491 / 7,01 / 100,00 | 2.187.571 / 149.661 / 6,84 | **8** | **28** | 4.207 | 26 / 30 / 728 | 117.807 | 9.331 |
| `df97012-z0001-c0008` | zona/0001 | 15:01:41 | f/n | 281 / 281 / 100,00 / 100,00 | 74.957 / 74.957 / 100,00 | 8 | **28** | ausente | 26 / 30 / 728 | 59.046 | 4.663 |
| `df97012-z0021-c0008` | zona/0021 | 13:21:08 | n/n | 354 / 0 / 0,00 / 0,00 | 113.690 / 0 / 0,00 | 8 | **28** | ausente | 26 / 30 / 728 | 0 | 0 |

- **`tf`** ficou `n` em todos: nenhum arquivo chegou à totalização final (`and = f` sem `tf = s` nas zonas 100%).
  O estado `tf = s` **não foi observado** para os cargos 7/8 (só existe no fim da rodada; o cargo 6 já o cobre).
- **`carg[].nv` está presente a 0%** (`and = n`), nos dois cargos — a resposta do Passo 0b de `docs/testing/tse-simulados.md`
  para os cargos 7 e 8: o denominador não depende de boletim. **Vale também nos arquivos de zona**: lá `nv` é o **da UF**
  (24, 94, 28), não o da zona.
- **`qe` só existe no agregado de UF** (`carg[0].qe`); nos arquivos de zona a chave **não vem**. Igual ao cargo 6.
  `qe = ⌊v.vv / nv⌋` exato nos três (22.320/24 = 930; 1.864.125/94 = 19.831,1; 117.807/28 = 4.207,4): é calculado sobre o
  **parcial**, muda a cada ciclo.
- **`agr[].vag`** vem em todas as agremiações, mas **a 0% vale `"0"` em todas**; com apuração, a soma de `vag` = `nv`
  (24, 94, 28): é a distribuição **provisória** de cadeiras do próprio TSE, não resultado.
- **`cand.dvt` / `par.dvt`**: presentes com voto (`Válido`, `Anulado sub judice`, e `Válido (legenda)` em nível de
  partido — em RR apareceu também 1 candidato `Válido (legenda)`); **ausentes só em `and = n`**. Nunca `Anulado` puro.
  Igual ao cargo 6.
- **`cand.st`** é a string vazia `""` em 100% dos candidatos (não ausente); **`cand.e`** é `"n"` em todos.
  `dt`/`ht` do envelope são `""` a 0% (não ausentes). O schema aceita as duas coisas (`optional()` + `z.string()`).
- **`s.psa` é binário**: `"0,00"` com `and = n`, `"100,00"` com qualquer boletim (`p` ou `f`) — inclusive no agregado a 7%.
  O que anda é `s.pst` e `e.esi/e.te` (`e.pest`). Mesma armadilha do cargo 6: `psa` não serve de medida de avanço.
- **Nenhum campo novo e nenhum campo ausente** em relação ao cargo 6: os conjuntos de chaves de `agr`, `par`, `cand` e
  `fed` são **idênticos** (`agr`: `com n nm par tp tval tvan tvtl tvtn vag`; `par`: `cand dvt n nfed nm sg tval tvan
  tvtl tvtn`; `cand`: `dt dvt e n nm nmu pvap pvapn seq sqcand st vap`). Nenhum `cand.vs`, nenhum `subs`.

### Identidades da spec 026 — valem para os cargos 7 e 8

Nos **6 arquivos com voto** (`and ≠ n`; 168 partidos): `par.tvtn = Σ cand.vap[dvt=Válido]`,
`par.tvan = Σ cand.vap[todos]`, `par.tvtl = par.tval + Σ cand.vap[dvt=Válido (legenda)]`,
`v.vv = Σ_par (tvtn + tvtl) = v.vnom + v.vl`, `v.vansj = Σ cand.vap[dvt=Anulado sub judice]` e
`v.tv = vb + vn + vnt + van + vansj + vv` — **zero exceções**. Nos 2 arquivos a 0% valem trivialmente (tudo 0).

Cruzamento agregado × zona: o conjunto `(par.n, cand.n, cand.sqcand)` de **cada arquivo de zona é idêntico ao do agregado
da UF** (RR 480 = 480 nas duas zonas; DF 728 = 728 nas duas; SP 2.444 = 2.444) — **cada zona lista todos os candidatos
da UF**, com `vap` só da fatia. Em SP nenhum candidato tem mais votos na zona que no agregado.
Em RR, neste momento, **toda a votação do estado está numa zona só** (Boa Vista × 0001: `v.vv`, `e.esi`, `s.st` e
`e.c` iguais aos do agregado) — é o mesmo padrão "1 de 16 zonas com boletim" de 28/09 no cargo 6.

## O parser atual aceita sem mudança

`EA20Schema.safeParse` (`lib/tse/ea20-schema.ts:329`) **passou nos 8 arquivos EA20**, com **0** chaves de raiz fora do
schema e **0** falhas de `parseEA20Numeric` em todos os campos numéricos de `s`/`e`/`v` e em `vap`/`pvap` dos
candidatos (8.512 candidatos, 17.024 valores). `EA12Schema.safeParse`
(`lib/tse/ea12-schema.ts`) **passou** em `mun-e021272-cm.json` (27 `abr`). Rodado por script descartável fora do repo,
com o schema real importado do worktree.

**O que o schema não faz por si** (fora do parse, é da frente T): `CargoTse = 1 | 3 | 5 | 6` (`lib/config/cargos.ts:42`)
não tem 7 nem 8, e o comentário de `cargos.ts:36-40` os declara **fora do escopo do produto** ("as assembleias estaduais").
Em execução: `isCargoTse(7)` é `false`, `parseCargoSegment("7")` devolve `null` e `cargoInfo(7 as CargoTse)` lança
(`cargos.ts:253-258`) — toda a fiação de alvos, rota `/api/ingest/<cargo>` e tabela `CARGOS` precisa ganhar as duas linhas.

## Surpresas de formato

1. 🔴 **`nv` do DF cargo 8 = 28, não 24.** A Câmara Legislativa tem 24 deputados distritais (CF art. 32 § 3º: o triplo da
   bancada federal, 8 × 3). O simulado publica **28**, e ele é internamente coerente: `qe = ⌊117.807/28⌋ = 4.207` e a soma
   de `agr[].vag` = 28. RR (24) e SP (94) batem com o esperado. Só serve como alerta: **`vagasDaCorrida` do cargo 8 nunca
   pode ser tabela embutida** (RF-124 / ADR-0027 já mandam ler `carg[].nv`), e qualquer teste que afirme 24 falha contra o
   simulado. Produção deve trazer 24 — **não verificado**, só o dia D diz.
2. **`agr.n` é identificador da agremiação naquele cargo, não o número do partido** (`60140174`, `60140119`, …): as
   agremiações do cargo 6 e do cargo 7 de RR têm `n` **diferentes** (0 em comum, 24 × 20). A chave estável entre cargos é
   `par.n` / `par.sg` (22 das 24 siglas do cargo 7 de RR existem no cargo 6). **Não juntar por `agr.n`.**
3. **Os partidos não são os mesmos entre cargos**: RR tem 28 partidos no cargo 6, **24** no cargo 7; DF cargo 8 tem 30.
   A lista de `par` de um cargo não vale para o outro.
4. **Número do candidato tem 5 dígitos** nos cargos 7 e 8 (`63019`; partido de 2 dígitos + 3), contra **4** no cargo 6
   (`cand.n` em 100% dos casos: 480, 2.444 e 728 candidatos com 5 dígitos; 192 com 4 no cargo 6).
5. **Candidatos por partido varia** dentro do mesmo arquivo (RR cargo 7: 24, 14, 10, 12, 6 ou 9; DF: 28, 15, 6, 7, 17, 11,
   19 ou 9), até `nv` por partido — não há teto único de "n candidatos por lista".
6. **Uma federação de teste com nome longo e caracteres especiais** (`Federacao teste para string longa especiais
   99!@#$"TSE"`, `n = 102`) aparece em `carg.fed[]` e em `agr[]` — já estava no cargo 6; com aspas duplas escapadas no JSON.
7. **`ele-c.json`: `Last-Modified` 18/09 15:55 GMT com `dg` 14/09/2026** — o arquivo foi regravado sem mudar a data de
   geração; o conteúdo é idêntico ao guardado de 14/09.
8. **Divergência de documentação sobre o caminho do EA12.** O EA12 estadual está em **`<eleição>/config/`** —
   `…/ele2026/21272/config/mun-e021272-cm.json` — como dizem a entrada `cm` do `ele-c.json` e o PDF de instruções
   (pasta 4). Os docs do repo escrevem **`comum/config/mun-e<n>-cm.json`** (`docs/specs/001-ingestao-tse/design.md:106`,
   `spec.md:107`, ADR-0035:120, `docs/reference/tse-2026-leiautes.md:248`, `data-pipeline/zonas-import.ts:9`,
   `lib/tse/ea12-schema.ts:11`). **Não testei `comum/config/…`** (seria sondar URL não publicada). Provável origem da
   confusão: o `ele-c.json` fica em `comum/config/`, e em 2022 o EA12 era um arquivo por UF nessa mesma pasta
   (`tse-2026-leiautes.md:247`).

## Volume — o que muda para a ingestão

O tamanho do arquivo é ~proporcional a `nv` (**4,9 KB/vaga em RR, 6,1 em SP, 6,3 no DF**; o cargo 6 de RR tinha 5,5
KB/vaga): **cada arquivo de zona carrega a lista inteira de candidatos da UF**, então SP × 779 pares repete 2.444
candidatos 779 vezes.

| Medido | Bruto | gzip -6 (estimado localmente) |
|---|---|---|
| agregado SP cargo 7 | 572.511 B | 67.858 B |
| zona SP cargo 7 | 569.857 B | 63.449 B |
| agregado / zona RR cargo 7 | 118.193 / 118.185 B | 13.688 / 13.612 B |
| agregado DF cargo 8 | 177.236 B | 21.194 B |

Extrapolação (**suposição, não medida**: vagas reais por UF de 2022, 1.035 estaduais; 5,5 KB/vaga): um ciclo completo do
cargo 7 (6.086 pares fora do DF) é da ordem de **1,8 GB descomprimidos (~200 MB em trânsito)**; só os 779 pares de SP,
por arquivo medido, dão **444 MB (~49 MB gzip)**. O cargo 8 (19 pares × ~177 KB) é ~3,4 MB. Somados, os cargos 7 e 8 têm
cerca do **dobro das vagas do cargo 6** (1.059 reais — suposição — contra 513), então o peso de armazenamento (`snapshots.payload` jsonb, uma linha
por zona por hash novo) e de banda **dobra** grosso modo — não é 13×: o "13× o arquivo do cargo 6 de RR" só compara
SP com um estado de 8 vagas.

## EA12 estadual × EA12 federal

Comparado com `../mun-e021270-cm.json` (guardado em 17/09; **não** rebaixado hoje — orçamento; mas `dg`/`hg` são os mesmos,
`14/09/2026 22:57:56`, o que aponta para gerados juntos):

- **27 abrangências × 28**: o federal tem `zz` (exterior, **184 pares**); o estadual não.
- **Nas 27 UFs os pares são idênticos**: 6.105 × 6.105, mesmo número de municípios por UF, nenhum par só de um lado.
- Logo **o buraco conhecido vale igual para os cargos 7 e 8**: Macapá `06050` zonas `0002 0010 0014` (a `0014` está no
  EA12 estadual) e Fernando de Noronha `30015` zona `0004` estão no EA12 e faltam na tabela `zonas` (commit `408ed2d`,
  importador `pnpm db:zonas:faltantes`, "nada gravado no banco" até 29/09). Os 7 pares que só a tabela tem (PE 25313 z1,
  5 do PI, 1 de SP — segundo o diagnóstico de `408ed2d` contra o EA12 **federal**) valem igual aqui, porque o EA12
  estadual é idêntico ao federal nas 27 UFs; não os conferi um a um.
- Alvos esperados: **cargo 7 = 26 agregados de UF + 6.086 pares** (6.105 − 19 do DF); **cargo 8 = 1 agregado + 19 pares**
  (DF tem 1 município, `97012`; a lista **pula as zonas 0007 e 0012**, igual ao federal). RR: 16 pares; SP: 779.
- Pares por UF (`abr[].mu[].z[]`): AC 23, AL 107, AP 18, AM 74, BA 450, CE 205, DF 19, ES 85, GO 259, MA 223, MT 147,
  MS 88, MG 898, PR 421, PB 230, PA 160, PE 208, PI 230, RJ 183, RN 172, RS 522, RO 56, RR 16, SC 315, SE 77, SP 779, TO 140.

## O que NÃO foi confirmado

- **Que o DF não tem cargo 7.** O `df-c0007-…` **não foi requisitado**, de propósito. A configuração publicada **não
  diz** qual UF tem qual cargo: o `ele-c.json` lista os 5 cargos só sob `br`; o EA12 não tem cargo; o EA14/EA15 não têm cargo;
  o EA20 (§ 2) dá 7 e 8 como "Proporcional | UF" **sem restringir UF**; a apresentação do TSE só conta "5 cargos" por UF.
  Só o conhecimento de domínio (DF elege Distrital, não Estadual) diz isso — e ele bate com o que o simulado serviu
  (cargo 8 no DF com `nv = 28`). A verificação pelo CDN custaria uma requisição que pode ser 404.
- **O estado final (`tf = s`) dos cargos 7/8** e o comportamento do agregado a 100%.
- **As outras 24 UFs** do cargo 7 (nenhuma requisição além de RR e SP) — o `nv` delas, o número de candidatos, o tamanho.
- **O cargo 7 no arquivo de município** (`<uf><mun5>-c0007-…`) — fora do escopo pedido.
- **Que a produção repita esses valores** (`nv` do DF, `qe`, lista de partidos): o simulado é sintético.

## `cand.dt` (data de nascimento)

Mantido **cru**, como em `../senado/*.json` e no `dep/` do cargo 6: os candidatos do simulado são sintéticos
(`CANDIDATO 9716`). ⚠️ O § 5 da constituição v1.6 diz que data de nascimento "nunca é gravada"; o acréscimo de 29/09
exclui só o cache local sob `build/`, **não** fixture versionada. É a mesma situação dos arquivos já commitados — decisão
do `constitution-guard`/dono se a fixture deve ter `dt` removido (mudaria a fidelidade "byte a byte").
