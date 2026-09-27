# Fixtures reais do simulado TSE 2026 (1ª janela)

Baixados em 2026-09-17 de `https://resultados-sim.tse.jus.br/simulado/simulado2026`, usando **apenas**
os endereços publicados pelo TSE na aba Informações da página técnica e os construtores de
`lib/tse/targets.ts` sobre a lista oficial de zonas do EA12 — **nenhuma URL adivinhada**
(constituição § 1). Estado dos arquivos: fim da janela da tarde de 16/09 (`dt`/`ht` 16/09, `psa` 100%).

Parâmetros publicados: pleito `17801`, ciclo `ele2026`, ambiente `simulado2026`; eleições `21270`
(Federal — Presidente), `21272` (Estadual — Governador, Senador, Deputados), `21274` (Municipal —
Conselheiro Distrital).

## Arquivos

| Arquivo | Leiaute | O que é |
|---|---|---|
| `ele-c.json` | EA11 | Configuração de eleições. **Sem `c` na raiz** — o ciclo vive em `pl[].c` |
| `mun-e021270-cm.json` | EA12 | 5.755 municípios em 28 abrangências; `cdi` = código IBGE, `z[]` = zonas. 6.289 pares (6.105 sem o exterior) |
| `br-e021270-ab.json` | EA14 | Acompanhamento Brasil (29 itens) |
| `ac-e021270-ab.json` | EA15 | Acompanhamento do Acre (23 itens, `tpabr: "mun"`) |
| `zz-e021270-ab.json` | EA15 | Acompanhamento do exterior — 185 itens (184 localidades + a abrangência) |
| `br-c0001-e021270-u.json` | EA20 | Presidente, nível Brasil |
| `ac-c0003-e021272-u.json` | EA20 | Governador do Acre — o único arquivo sob a eleição **estadual** |
| `zz-c0001-e021270-u.json` | EA20 | Exterior, nível UF — 760.913 aptos |
| `zz29254-z0001-c0001-e021270-u.json` | EA20 | Exterior, par Abidjã × zona 0001 |
| `ac01392-c0001-e021270-u.json` | EA20 | Rio Branco, nível município |
| `ac01392-z0001-…` e `ac01392-z0009-…` | EA20 | Os dois pares de Rio Branco |
| `ac01007-c0001-…` e `ac01007-z0009-…` | EA20 | Bujari — o outro município da zona 0009 |

## Subpasta `df/` — eleitorado real do DF (2ª janela, 24/09)

Baixados em **2026-09-27** de `https://resultados-sim.tse.jus.br/simulado/simulado2026`
(eleição `21270`, Presidente), a partir da lista oficial de zonas do EA12 acima
(`mun-e021270-cm.json`, abrangência `df`, município `97012`) — **nenhuma URL adivinhada**.
Estado dos arquivos: `dg`/`hg` **24/09/2026 16:12:48–53** (2ª janela do simulado, 22–24/09).

Motivo da coleta: a tabela `eleitorado` (Postgres) não tem o DF — sua fonte é o CSV de
eleitorado da eleição **municipal** de 2024, e o DF não tem eleição municipal. Este
simulado é a fonte usada para preencher a lacuna (ver `docs/operations/runbook.md`
§ "Carregar o eleitorado do DF").

| Arquivo | Leiaute | O que é |
|---|---|---|
| `df-e021270-ab.json` | EA15 | Acompanhamento do DF — 2 itens: `mun` (97012) + `uf` (df), ambos com o mesmo `e.te` (DF só tem 1 município) |
| `df-c0001-e021270-u.json` | EA20 | Presidente, nível UF (DF) — agregado das 19 zonas |
| `df97012-z<zona>-c0001-e021270-u.json` | EA20 | Presidente, par Brasília (97012) × zona — 19 arquivos, zonas `0001 0002 0003 0004 0005 0006 0008 0009 0010 0011 0013 0014 0015 0016 0017 0018 0019 0020 0021` (a lista pula 0007 e 0012 — o EA12 não lista essas zonas para 97012, e não é gap de coleta) |

Conferência (feita por `data-pipeline/eleitorado-df-import.ts`, modo simulação):
Σ `e.te` das 19 zonas = **2.187.571**, exatamente igual ao `e.te` de `df-c0001-e021270-u.json`
e de `df-e021270-ab.json`.

⚠️ **Ressalva de proveniência**: nas 27 UFs, o `e.te` deste simulado fica entre +0,2% e +4,5%
acima do que `eleitorado-import.ts` calculou do CSV de 2024 (crescimento normal do cadastro),
exceto AC (+17%) e AP (+10%), fora dessa faixa — não investigado a fundo, mas tratado como
plausível (cadastro cresce de forma desigual por UF).

## Para que servem

> ✅ **Desde 18/09 estes arquivos são GUARDA, não só amostra.**
> `tests/unit/tse/simulado-2026-real.test.ts` (17 casos) os lê em toda corrida da suíte.
> Antes disso o único consumidor era o script manual `verify-fatia-premise.ts`, e as duas
> afirmações abaixo eram prosa de README conferida à mão uma vez — prosa de README não
> reprova build.

- **Passo 0 do protocolo** (`pnpm verify-fatia-premise`): os pares de Rio Branco e Bujari, que
  dividem a zona 0009, são o que prova que cada arquivo de zona traz **a fatia do município**, e não
  a zona inteira repetida. Veredito medido em 17/09: **FATIA CONFIRMADA**.

  🔴 **O teste automatizado prova o mesmo SEM BANCO**, por dois caminhos independentes — o
  script exige `DATABASE_URL` e por isso não roda em toda corrida:

  | | Rio Branco (`ac01392`) | Bujari (`ac01007`) |
  |---|---|---|
  | município, `e.te` | 279.602 | 25.657 |
  | zona 0001 | 150.897 | — |
  | zona 0009 | **128.705** | **25.657** |
  | soma das zonas | 279.602 ✅ fecha | 25.657 ✅ fecha |

  1. a mesma zona 0009 dá **128.705 para um município e 25.657 para o outro** — se cada
     arquivo trouxesse a zona inteira, os dois seriam idênticos;
  2. o arquivo do **município fecha exatamente** com a soma dos arquivos das zonas dele — se
     cada zona trouxesse o próprio total, a soma de Rio Branco estouraria o município.

  A (2) é a prova forte: ela também falha num mundo em que os números são diferentes **mas
  errados**. Mutação aplicada em 18/09 (fabricar o mundo da multiplicação, pondo o total nos
  dois arquivos): **3 testes vermelhos**.

  ⚠️ `e.te` é o total de eleitores. **Não confundir com `e.a`, que é abstenção**, nem com
  `e.c`, que é comparecimento — os três convivem no mesmo objeto e os dois últimos são
  maiores em alguns arquivos, o que faz um erro de campo parecer plausível.

- **Validação dos leiautes**: `EA20Schema`, `EA14Schema` e `EA15Schema` passam em todos os
  arquivos — agora **verificado em toda corrida**, contra o que o TSE de fato mandou.

  Por que isso importa e não é redundante com `tests/unit/tse/ea20-fixtures-2026.test.ts`:
  aquelas fixtures são **derivadas do dicionário de campos** (o TSE não publica exemplo de
  JSON completo), então provam que o parser casa com a **documentação**. Um simulado existe
  justamente para revelar onde documentação e realidade divergem. Mutação em 18/09 (exigir
  no schema um campo que o TSE não manda): **10 testes vermelhos**.
- **Exterior**: os três arquivos `zz*` são a base do [ADR-0045](../../../../docs/architecture/adrs/0045-exterior-zz-apuracao-presidencial.md).

## Regras

Estes arquivos são cópias byte a byte do CDN do TSE. **Não reformatar** — `biome.json` os isenta do
formatador justamente para preservar a fidelidade. Para atualizar, baixe de novo; não edite à mão.
