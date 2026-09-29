---
id: 024-etiquetas-editoriais
type: design
title: Etiquetas editoriais — design técnico da infraestrutura
status: ready
date: 2026-09-29
spec: ./spec.md
adrs: [0024, 0032, 0053, 0058, 0059, 0060, 0062]
requirements: [RF-220, RF-221, RF-222, RF-223, RF-224, RF-225, RF-226, RF-227, RF-228, RF-229, RF-230, RF-231, RF-232, RF-233, RF-234, RF-235, RF-236, RF-237, RF-238, RF-239]
---

# Design 024 — Etiquetas editoriais (infraestrutura)

> Escrito junto com a implementação da frente B (29/09). Tudo aqui está
> **desligado**: nenhuma página importa `lib/etiquetas/` ainda, e a cópia do
> build sai com todas as chaves de visão em `false`. As telas vêm na spec 025.

## 1. Arquitetura

```
editorial/etiquetas/*.csv ─┐                         ┌─ lib/data/etiquetas/*.generated.json  (cópia do build)
editorial/senado/…json ────┤  pnpm etiquetas:compilar│        │
editorial/derivados/*.json ┼──────────────────────────┤        │  pnpm etiquetas:publicar (dono)
build/tse-archives/… ──────┘   (valida, resolve,      └─ …/historico.json     ▼
                                meta, histórico)                    Blob etiquetas/v1/{uf/<UF>,historico,nacional}.json
                                                                              │ revalidate 60
                                          lib/etiquetas/leitor.ts ◀───────────┘  (maior `versao` vence;
                                            │                                     Blob falhou ⇒ cópia do build)
                     ┌──────────────────────┼─────────────────────┐
              portao.ts (visão agregada)  juncao.ts (lista)   vigia.ts ◀── scripts/etiquetas-vigia.ts (Edge Config)
                                              │
                              EtiquetasLinha / EtiquetaEditorial / EtiquetasAviso
```

Etiqueta **nunca** entra no Edge Config nem no modelo (ADR-0060). A junção é
por `sqcand` na hora de montar a página.

### Módulos

| Arquivo | Papel | Puro? |
|---|---|---|
| `lib/etiquetas/catalogo.ts` | fonte única: categorias, valores, rótulos, ordem, matriz, limiares, visões | sim |
| `lib/etiquetas/formato.ts` | contrato dos arquivos, guardas, normalização de `sqcand`/sigla | sim |
| `lib/etiquetas/resolver.ts` | precedência (RF-224/225) | sim |
| `lib/etiquetas/montagem.ts` | insumos de resolução por tipo de alvo — o MESMO para compilador e leitor | sim |
| `lib/etiquetas/leitor.ts` | Blob + cópia do build, objeto `Etiquetas` | I/O (fetch) |
| `lib/etiquetas/embutido.ts` | imports literais dos gerados (27 UFs sob demanda) | — |
| `lib/etiquetas/caminhos.ts` | `etiquetas/v1/...` no Blob | sim |
| `lib/etiquetas/portao.ts` | portão de cobertura (RF-233) | sim |
| `lib/etiquetas/juncao.ts` | lista de candidatos + etiquetas, ordem preservada (RF-238) | sim |
| `lib/etiquetas/vigia.ts` | avaliação do vigia (RF-234) | sim |
| `data-pipeline/etiquetas-csv.ts` | CSV RFC 4180 | sim |
| `data-pipeline/etiquetas-universo.ts` | universo do TSE, 5 colunas | parcial (leitura de disco isolada) |
| `data-pipeline/etiquetas-insumos.ts` | foto do Senado e 4 derivados, com recusa de dado pessoal | sim |
| `data-pipeline/etiquetas-nucleo.ts` | validação, montagem, meta, histórico | sim |
| `data-pipeline/etiquetas-compilar.ts` | CLI do compilador | I/O |
| `data-pipeline/etiquetas-publicar.ts` | publicador (dependências injetadas) | I/O |
| `scripts/etiquetas-vigia.ts` | CLI do vigia, env por lista branca | I/O |

## 2. Contratos

### 2.1 Fonte (`editorial/etiquetas/*.csv`)

`chave,categoria,valor,turno,fonte_url,fonte_descricao,data,revisado,revisado_em,nota`
— UTF-8, vírgula, RFC 4180. Cabeçalho exato e na ordem.

| Arquivo | Chave | Alvo |
|---|---|---|
| `governador.csv` | `sqcand` (só dígitos) | cargo 3 |
| `senador.csv` | `sqcand` | cargo 5 |
| `deputados-excecoes.csv` | `sqcand` | cargo 6 |
| `senado-2031.csv` | `senado:CODIGO` | senado2031 |
| `partidos.csv` | `partido:SIGLA` / `federacao:SIGLA` | todos os alvos da categoria |

Sigla comparada normalizada (sem acento, maiúscula, espaços colapsados):
`federacao:PT/PC do B/PV` ≡ `PT/PC DO B/PV`; `partido:União` ≡ `UNIAO`.
`editorial/etiquetas/publicar.json` = `{ chips, filtro, v1, v2, v3, v4, camara2027: boolean }`
— lido pelo **compilador** (vai para a cópia do build, fora do `conteudo_sha256`)
e pelo **publicador** (que recusa quando ele diverge da cópia do build). Emenda de
29/09, spec 025 RF-253; o parser único é `lerChavesPublicacao` (`formato.ts`).

### 2.2 Insumos de outras frentes (todos opcionais)

| Arquivo | Forma | Uso |
|---|---|---|
| `editorial/senado/mandato-2031.json` | lista (raiz ou `senadores`/`cadeiras`/…), itens com `codigo`/`codigo_parlamentar`, `uf`, `partido`/`partido_atual`; data em `data_foto`/`foto`/`data`/`gerado_em` | universo de `senado:` e os 27 do portão; `completo` só com 27 em 27 UFs; `"S/Partido"` ⇒ `partido: null` |
| `derivados/trajetoria-camara.json` | `{ gerado_em, universo, fonte?, por_sqcand: { sq: { t, camara_ids[] } } }` | trajetória cargo 6; ids do alinhamento |
| `derivados/alinhamento-camara.json` | `{ corte: "2026-09-03", fonte, por_deputado: { id: { votos_disputadas, taxa_disputadas } } }` | relação cargo 6 |
| `derivados/trajetoria-senado.json` | `{ gerado_em, fonte, universo, por_sqcand: { sq: { t, senado_codigos[] } } }` | trajetória cargo 5; ids do alinhamento |
| `derivados/alinhamento-senado.json` | `{ corte, fonte{descricao,url}, universo{…}, por_senador: { cod: { votos_disputadas, taxa_disputadas } } }` | relação cargo 5 e senado2031 |

`taxa_disputadas` em **0–100**. Recusados: taxa fora de [0,100]; todas ≤ 1 com
≥ 10 entradas (fração); corte da Câmara ≠ `ALINHAMENTO_CORTE`; qualquer chave
com nome de dado pessoal (`PADRAO_CAMPO_PESSOAL`); `universo` ≠ candidaturas do
cargo no TSE; `sqcand` de outro cargo.

**Vários ids** (mesma pessoa com mais de um registro): soma dos votos
disputados + taxa ponderada pelos votos; o mínimo de 30 vale sobre a soma; id
repetido conta uma vez; independe da ordem.

### 2.3 Gerados / publicados (`FORMATO_ETIQUETAS = "etiquetas/v1"`)

```ts
Registro = { valor, fonte_url, fonte_descricao, data, revisado_em }   // lista branca; `nota` nunca
Registros = { [categoria | "palanque_presidencial:1|2"]: Registro }
Meta      = { versao, gerado_em, conteudo_sha256, git_sha|null }

nacional = { formato, meta, publicar: {7 × boolean — no build, as do publicar.json versionado},
  derivados: { trajetoria_camara|alinhamento_camara|trajetoria_senado|alinhamento_senado: {fonte_url,fonte_descricao,data}|null },
  partidos: { PARTIDO: FEDERACAO|null },                 // observado no TSE (+ partidos da foto do Senado)
  padroes:  { "partido:PT" | "federacao:PT/PC DO B/PV": Registros },
  candidatos: { sq: { uf, cargo: 3|5, partido, x?: Registros, d?: { relacao_governo?, trajetoria_cargo? } } },
  senado2031: { disponivel, foto, senadores: { cod: { uf, partido|null, x?, d? } } } }

uf/<UF> = { formato, meta, uf,
  por_partido: { PARTIDO: [sq…] },                       // TODOS os candidatos a Deputado Federal da UF
  trajetoria:  { tenta_reeleicao|volta_ao_cargo|estreante: [sq…] },
  alinhamento: { base_governo|oposicao|independente: [sq…] },   // só quem passou do mínimo
  excecoes:    { sq: Registros } }

historico = { formato, meta, entradas: [{ em, versao, chave, categoria, turno, de, para,
                                         fonte_url, fonte_descricao, data, resumo? }] }  // append-only
```

**Por que matéria-prima e não o valor resolvido.** 7.791 deputados; gravar o
resolvido repetiria o padrão do partido centenas de vezes por UF. Os arquivos
guardam o que é distinto; a resolução (`resolver.ts` + `montagem.ts`) é a mesma
função no compilador e no leitor. `origem` (`individual | derivado | partido`),
fonte e data saem da resolução (`EtiquetaResolvida`).

**Tamanhos** (29/09, fontes vazias; minificado / gzip): nacional 28 KB / 5 KB
(519 candidaturas a Governador e Senador + 30 partidos); SP 17 KB / 3,6 KB
(1.131 deputados); 27 UFs 125 KB. **Pior caso medido** (tudo classificado
individualmente, fonte de ~220 caracteres por linha, trajetória e alinhamento
para os 7.791): nacional **1,3 MB** (gzip 16,5 KB), SP 50 KB, 27 UFs 1,4 MB,
histórico da primeira compilação 2,9 MB. O nacional fica abaixo do limite de
2 MB por item do Data Cache do Next; o histórico não — ele **não** é lido pelo
leitor, e a página de metodologia (spec 025) precisa lê-lo de outro jeito
(ver § 7). Uso realista (padrão por partido + ~600 linhas individuais):
~150 KB no nacional.

### 2.4 Versão e deriva

- `versao` = `max(anterior + 1, epoch em segundos)` quando o conteúdo muda;
  **preservada** (com `gerado_em`) quando o `conteudo_sha256` não muda. Por
  isso recompilar as mesmas fontes dá o mesmo resultado.
- O publicador carimba `max(epoch, versao_do_Blob + 1, versao_do_build + 1)` e
  o `git_sha`.
- **Deriva** (`tests/unit/data-pipeline/etiquetas-deriva.test.ts`): recompila
  as fontes versionadas e compara o JSON (não os bytes — o `biome format`
  reformata) com os gerados versionados. Exige o cadastro do TSE em
  `build/tse-archives/consulta_cand_2026/` (fora do git, 11 MB) ou
  `ETIQUETAS_TSE_CACHE`; sem ele (CI, worktree novo) o teste é **pulado com o
  motivo no nome**. A segunda rede é o publicador, que recompila e recusa
  gerado divergente — e só roda na máquina do dono, onde o cadastro existe.
  `pnpm etiquetas:conferir` faz a mesma checagem à mão.

## 3. Fluxos

### 3.1 Compilar (`pnpm etiquetas:compilar`)

1. Lê os 5 CSVs (ausente = erro), o universo (só `_BRASIL.csv`, ou a união dos
   por-UF com deduplicação), a foto do Senado e os 4 derivados (ausentes =
   `null`).
2. Valida linha a linha (RF-222); duplicata `(chave, categoria, turno)`;
   federação explícita quando um membro **observado** tem linha na mesma
   `(categoria, turno)`; trajetórias contra o universo.
3. **Qualquer erro ⇒ nada é gravado** (tudo ou nada), com arquivo:linha.
4. Só linhas `revisado=sim` entram (RF-223).
5. Monta nacional + 27 UFs, meta, histórico; grava; `biome format`.

### 3.2 Publicar (`pnpm etiquetas:publicar [--dry-run]`)

Ambiente por lista branca (`BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_BASE_URL`) —
**nunca** `set -a; . ./.env.local`. Recusa: árvore suja; HEAD atrás de
`origin/main` (referência local — `git fetch` antes); validação; deriva;
`publicar.json` inválido; versão do Blob ilegível. Reconstrói cada arquivo
por lista branca (`projetar*`), grava com `putJson` (`cacheControlMaxAge: 60`)
na ordem 27 UFs → histórico → **nacional por último**. Escrita pulada
interrompe antes do nacional (a versão nova não fica visível pela metade).

### 3.3 Ler (`lerEtiquetas({ uf? })`)

Nacional e UF escolhem cada um, pela **maior `versao`** (empate ⇒ build), entre
Blob (`fetch` + `next.revalidate: 60`, sem `AbortSignal`) e cópia do build.
Blob ausente/404/rede/corpo inválido ⇒ build, sem lançar. ~~Da cópia do build,
`publicar` é **forçado** a tudo desligado, diga o arquivo o que disser.~~ Desde
29/09 (spec 025, RF-253) as chaves são as do arquivo escolhido, e a cópia do build
carrega as do `publicar.json` versionado — deploy não apaga visão.

API: `Etiquetas.resolver(sqcand: string|number, cargo: 3|5|6, turno)`,
`.classificadas(...)`, `.senador2031(cod, turno)`, `.padraoDoPartido(sigla,
turno)` (partido → federação), `.padraoDaAgremiacao(sigla, "partido"|"federacao", turno)`
(sem herança — para a Câmara 2027), `.viewLigada(visao)`, `.senado2031`.
Atalhos async: `etiquetasDe`, `padraoDoPartido`, `viewLigada`.
Cargo 6 exige a UF carregada. `sqcand` de outro cargo não herda nada.

### 3.4 Portão (`lib/etiquetas/portao.ts`)

`comChance(corrida)` → membros (ordem de entrada) + `exigeUniverso`.
`avaliarCorridas(corridas, classificado)`, `avaliarSenado2031`,
`avaliarCamara2027`, `juntarPortoes`, `corridaDeUfRow(row, …)` (adaptador de
`EdgeUfRow`). Regras no cabeçalho do módulo e no RF-233. Decisões:

- **Pré-eleição** ⇒ a corrida inteira + universo (não há voto para medir chance).
- **Parcial com 0% apurado** não entra (empate estrutural em zero).
- **Sem número numa base** ⇒ com chance (não dá para descartar).
- **Cauda** (`outros`) é soma; se a soma alcança o colchão, exige o universo
  da corrida; sem universo, bloqueia com `cauda_sem_universo`.
- Tolerância `1e-9` no colchão (5,0 pp exatos entram).

`CATEGORIA_DA_VISAO` (catálogo) diz qual categoria cada visão exige.

### 3.5 Vigia (`pnpm etiquetas:vigia`)

Env por lista branca (`EDGE_CONFIG`, `BLOB_PUBLIC_BASE_URL`). Lê gov (turno do
calendário), sen (t1) e dep do Edge Config; top-4 nas duas bases (Parcial só
com apuração), anulado fora; alerta por candidato com as categorias que
faltam (padrão: relação, palanque do turno, impeachment no Senado — na ordem
do catálogo); Deputado: agremiação com cadeira > 0 sem padrão. Exit 0/2/1
como `vigia:ciclo` (stdout; não há Slack no vigia externo). **Não agendado.**
Verificado em 29/09 contra `scripts/edge-config-falso.ts` + fixture do
simulado: 214 alertas (esperado com as fontes vazias), exit 2.

## 4. Componentes (não ligados a páginas)

| Componente | Arquivo | RF |
|---|---|---|
| `EtiquetaEditorial` | `components/atoms/data/EtiquetaEditorial.tsx` (+ `.module.css`) | RF-235 |
| `EtiquetasLinha` | `components/atoms/data/EtiquetasLinha.tsx` | RF-236 |
| `EtiquetasAviso` | `components/blocks/EtiquetasAviso.tsx` (+ `.module.css`) | RF-237 |

`EtiquetaEditorial({ categoria, valor })`: `<span data-etiqueta data-valor>`
com `<span class="sr-only">, <categoria>: </span>` + rótulo. `null` para
sentinela, id desconhecido, `centrao: nao`. `EtiquetasLinha({ resolucoes,
categorias? })`: `<span>` inline, ordem do catálogo. `EtiquetasAviso()`:
`<p>` com o texto literal + `<Link href="/sobre-as-etiquetas">`.

### 4.1 Tokens locais (para `docs/design-system/tokens.md` na barreira)

| Token | Valor | Claro | Escuro |
|---|---|---|---|
| `--etq-tinta` | `var(--text-primary)` | ink-0 `#14171b` | `#eceef1` |
| `--etq-borda` | `var(--border-strong)` (1px **tracejada**) | rule-strong `#14171b` | `#eceef1` |
| `--etq-fundo` | `transparent` | — | — |

**Sem área de cor**, por medição: `--surface-sunken` ficava a ΔE76 2,6 de
`--party-none` e 8,5 dos níveis 1 de DC/PP/Democrata; `--text-secondary` como
borda, a 6,3 do Democrata (`#4b5563`). Com tinta/borda ink-0: C* < 10, ΔE76
mínimo ≥ 10 contra toda cor de partido do mesmo tema (menos as `-ink`, que
são a tinta do site), contraste ≥ 4,5:1 sobre paper-0/1/2 nos dois temas
(`tests/unit/design-system/etiqueta-editorial-contraste.test.tsx`). Tracejado
e caixa baixa distinguem de `DestinoEtiqueta` (dado do TSE: contínuo, caixa
alta). Tema pelos semânticos — seletor `:global` é recusado pelo Biome em CSS
module, e `light-dark()` dependeria do pipeline de CSS.

## 5. ADRs

- ADR-0059 — governança da classificação editorial (constituição 1.6, § 2 (a)–(h)).
- ADR-0060 — etiquetas fora do payload: repo como fonte, Blob + cópia no build, chaves por visão.
- ADR-0062 — fontes parlamentares: lista branca na importação e na publicação.
- ADR-0058 — trajetória na Câmara (insumo `trajetoria-camara.json`).
- ADR-0024 (paleta de partido — o ΔE), ADR-0053 (anulado fora da disputa), ADR-0032 (Blob).

## 6. Riscos técnicos

| Risco | Mitigação |
|---|---|
| ~~Deploy com compilação nova apaga as visões até republicar~~ | resolvido em 29/09 (spec 025, RF-253): a cópia do build leva o `publicar.json` versionado |
| Blob fora do ar logo depois de um "desligar às pressas" | a cópia do build no ar ainda diz `true` até o próximo deploy — custo conhecido, no guia editorial |
| Nacional grande no pior caso (1,3 MB) | abaixo de 2 MB do Data Cache; se crescer, deduplicar fontes numa tabela (`fontes[]` + índice) — mudança de formato `v2` |
| Histórico > 2 MB no pior caso | não é lido pelo leitor; a metodologia lê de outro jeito |
| Cadastro do TSE muda (substituição) | teste de deriva acusa localmente; compilar de novo; o universo dos derivados precisa bater |
| `import()` de JSON com atributo no Turbopack | conferido em 29/09: `next build` compila e `next dev` serve uma rota que carrega SP e RJ |

## 7. Pendências para a spec 025 / frente de telas

> ✅ **Atendidas em 29/09 pela [spec 025](../025-visoes-editoriais/design.md)**:
> `/sobre-as-etiquetas` lê o histórico por `lerHistoricoEtiquetas` (Blob ou build,
> mostra as 50 mais recentes e aponta para o arquivo inteiro); `comEtiquetas`/o
> auxiliar de invariância nas superfícies; impeachment sempre qualificado
> (RF-246); `/sobre-as-etiquetas` nas rotas e2e de peso e acessibilidade.

- `/sobre-as-etiquetas` deve ler o histórico sem passar pelo Data Cache de 2 MB
  (paginação ou cópia do build).
- Usar `comEtiquetas` + `expectOrdemInvariante` em toda superfície que juntar
  etiqueta a candidatos.
- Chips de impeachment fora da V2 precisam de qualificador visível (open question).
- Primeira página que importar `leitor.ts` roda `pnpm build` e o e2e de peso.
