---
id: 017-deputado-federal
title: Design — payload, read path e telas do Deputado Federal
status: draft
date: 2026-09-12
spec: ./spec.md
adrs: [0001, 0012, 0026, 0027, 0032, 0035, 0036, 0037]
requirements: [RF-121, RF-122, RF-124, RF-125.1, RF-127, RF-128, RF-129, RF-130]
---

# Design 017 — payload, read path e telas

> Escrito em 2026-09-12 pelo orquestrador, **antes** da implementação, para ser o
> contrato entre o lado Python (`api/model/`) e o lado TypeScript
> (`lib/edge-config/`, `lib/blob/`, `app/`). Os dois lados são implementados em
> paralelo; este arquivo é a única fonte da forma do JSON.
>
> O cálculo de cadeiras (`api/model/cadeiras.py` + `api/model/deputado.py`) já
> está pronto e validado — 511/513 contra 2022. Este documento cobre **só** o que
> falta: transportar o resultado até a tela.

## D1 — Deputado NÃO reusa `EdgePayload`

`EdgePayload.national` é `EdgeNational`, que é inteiramente majoritário:
`candidato_a_id`/`candidato_b_id`, `needle_position`, `needle_band`,
`p_segundo_turno_overall`, `cenarios_2t`, `vai_a_2t_nacional`. Numa corrida
proporcional nenhum desses campos tem referente — não existe líder da corrida,
não existe duelo, não existe segundo turno.

Reusar a interface obrigaria a preencher oito campos obrigatórios com valores
inventados, e o risco não é estético: um consumidor que já lê `EdgeNational`
renderizaria uma agulha e um "líder" para a Câmara.

**Decisão**: tipo próprio, `EdgePayloadDeputado`, na chave
`projection-current-dep-t1` — o esquema de chave do ADR-0012 já comporta
(`projection-current-<token>-t<turno>`; `token = "dep"` está em
`lib/config/cargos.ts`). Nenhuma máquina de chaves nova.

A consequência é que o reader precisa distinguir o cargo. Mecanismo a critério
de quem implementa (união discriminada por `cargo`, ou função de leitura
separada), com uma restrição: **`readProjection` não pode devolver
`EdgePayloadDeputado` tipado como `EdgePayload`.**

O precedente de `composicao_vagas?` pendurado em `EdgePayload` para o Senador
**não** se aplica: Senador é majoritário e `EdgeNational` cabe nele de verdade.

## D2 — `vagas_obtidas` não atravessa a fronteira

`ResultadoCadeiras` tem dois contadores por agremiação e eles divergem
(ADR-0027, caso de borda 2b):

- `cadeiras[cod]` — candidatos **efetivamente eleitos**. Soma exatamente
  `lugares_a_preencher`.
- `vagas_obtidas[cod]` — bookkeeping do denominador da média (Res.-TSE 23.677
  art. 11 § 5º, ADI 5.420). Conta o quociente partidário inteiro ainda que não
  preenchido. Numa UF de 10 vagas, a soma dá 11.

**`vagas_obtidas` não aparece em nenhum payload** — nem nacional, nem por UF, nem
sob outro nome. Fica dentro de `cadeiras.py`.

**Teste obrigatório, por asserção negativa** (RF-125.1): serializar um payload de
UF e afirmar que a string `"vagas_obtidas"` **não** ocorre nele, e que
`Σ agremiacoes[].cadeiras == lugares_a_preencher`. A asserção positiva
("`cadeiras` está certo") passaria com os dois campos presentes.

## D3 — Nacional é soma de 27 corridas, não um modelo nacional

`compute_national` agrega por `cand.n` (número de urna). No proporcional esse
número **se repete entre UFs e entre partidos** — agregar por ele funde
candidatos distintos. O resultado de hoje para `cargo=6` é lixo silencioso: as
linhas por UF ficam corretas e a linha nacional, inválida.

**Decisão**: `cargo=6` **não passa** por `compute_national`. A visão nacional do
Deputado é a **bancada** — soma de `cadeiras` por agremiação sobre as 27 UFs, com
as agremiações reconciliadas por `cod`, a chave **nacional** da agremiação (ver a
emenda abaixo).

⚠️ **Emenda de 2026-09-29 — `agr[].n` NÃO é estável nacionalmente.** Este
parágrafo dizia "reconciliadas por `cod` (o `agr[].n`, estável nacionalmente)", e
o código seguia: "o PT é 13 em toda UF". O dicionário do EA20 define `agr[].n`
como "número da agremiação … conforme inscrição no Sistema de Candidaturas"
(`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:674-676`) — o id da
**inscrição** daquela agremiação naquela circunscrição. Nos EA20 reais do simulado
(`tests/fixtures/tse/2026-sim/dep/{rr,ap}/m3-final-tf/`), RR e AP têm 21
agremiações em comum e **nenhum** `agr[].n` igual (o "P 9969" é `60140151` em RR e
`60138197` em AP; `par[].n` é `73` nos dois). A bancada nacional listava cada
partido uma vez por UF, sem somar cadeira nenhuma, e tudo o que o nacional chaveia
por `cod` (`sigla_lider`, `cadeiras_ci95`, `lider`, `mais_votados[].cod`,
`puxadores[].cod`) herdava o erro.

A chave passa a ser (`api/model/deputado.py::chave_agremiacao`):

| `agr[].tp` | `cod` | Por que é nacional |
|---|---|---|
| `"i"` — partido isolado | `par[].n` — o número do partido (`"13"`) | é o número que o partido registra no TSE, o mesmo em toda UF |
| `"f"` — federação | `"fed:" + fed[].n` (`"fed:101"`), o número da **própria federação**, apontado por `par[].nfed` (ou, sem `nfed`, pelo `fed[].npar` que casar sem ambiguidade) | a federação tem abrangência nacional (Lei 9.096 art. 11-A) e um número só: `100`–`104` no cadastro real de 2026, iguais nas UFs conferidas. **Não** a lista dos componentes: o `par[]` de um componente sem candidato na UF "pode ser suprimido" (dicionário, elemento `par`) — a mesma federação sairia com duas chaves |
| `"c"` — coligação (anomalia) | `"coligacao:" + agr[].n`, como antes | nunca é somada nem exibida |

O prefixo `fed:` torna as duas famílias disjuntas por construção (hoje a lei já
as separa — partido tem 2 dígitos, federação 3 —, mas a garantia não depende
disso). Quando a regra não resolve sem ambiguidade (`par[]` ausente ou
contraditório), a chave degrada para `agr[].n`: certa dentro da UF, separada no
nacional — degradação declarada, nunca uma escolha entre números. A chave vale
igual no objeto da UF e no nacional: o `cod` de uma linha de UF é o `cod` da linha
nacional correspondente.

Isso é agregação, não estimativa — mesma natureza de `EdgeComposicaoVagas` do
Senador, e a tela precisa dizer isso: o número é soma nossa das 27 corridas, não
um agregado publicado pelo TSE (`temArquivoBr: false` para o cargo 6).

Implementação: uma guarda explícita que faz `compute_national` recusar cargo
proporcional (`cargoInfo(cargo).proporcional`), com teste — não um `if` que
silencia.

## D4 — Identidade das agremiações

`extrair_entrada_proporcional` hoje carrega só `cod` e votos; nome, sigla, tipo e
composição são descartados. A tela precisa deles (RF-122: "partidos componentes
legíveis"; RF-130: legenda distinguível do nominal). Candidato idem — hoje só
`sqcand` e votos, sem nome.

Enriquecer **sem quebrar** os 28 testes de `deputado.py` nem a assinatura que
`cadeiras.py` consome: `Agremiacao`/`Candidato` são o contrato do algoritmo e
devem continuar magros. A identidade viaja num mapa paralelo, chaveado por `cod`
e por `sqcand`.

Campos de origem no EA20: `agr[].nm`, `agr[].tp`, `agr[].par[].sg` (componentes),
`cand[].nm`, `cand[].sqcand`.

⚠️ **Correção de 2026-09-12, medida contra o dicionário oficial**: `agr[].sg` **não
existe**. O EA20 publica em `agr[]` apenas `n`, `nm`, `tp` e `com`. A sigla é
derivada:

- federação (`tp == "f"`) → `carg[].fed[].sg`, casando pelo número **da
  federação** — `par[].nfed` = `fed[].n` (emenda de 2026-09-29: casava pelo
  `agr[].n`, que no dado real nunca coincide com `fed[].n`; a sigla de `fed[]`
  nunca era encontrada e a federação saía com o `agr[].nm` no lugar);
- partido isolado (`tp == "i"`) → `par[0].sg`.

Isso significa que `fed[]` **é** percorrida — mas **só para identidade**, nunca
para voto nem para candidato. A regra de `deputado.py` continua valendo onde
importa: todo voto e todo candidato vêm por `agr[]`.

`tipo` deriva de `agr[].tp`: `"i"` → `"partido"`, `"f"` → `"federacao"`.
`"c"` (coligação) continua sendo anomalia a logar, nunca a exibir. Quando
aparece, a UF inteira sai do cálculo de cadeiras e entra como "aguardando" —
bancada falsa com cara de normal é pior que ausência declarada.

## D5 — Contrato: payload nacional (`projection-current-dep-t1`)

```ts
interface EdgePayloadDeputado {
  ts: string;                  // ISO 8601
  cargo: 6;
  turno: 1;                    // turno único
  pct_apurado_total: number;   // 0–100
  ufs_apuradas: number;        // 0–27
  /** RF-128 — cadência declarada, não derivada da tela. */
  /** 30 desde o ADR-0036 (13/09): a volta completa das 6 fatias. Era 15. */
  atualizacao_min: 30;
  bancada: EdgeBancadaNacional;
  por_uf: EdgeDeputadoUfRow[];
  insights: string[];          // template, NUNCA LLM (ADR-0005)
  composition: EdgeComposition;
}

interface EdgeBancadaNacional {
  /** 513. Vem da soma dos `lugares_a_preencher` publicados, não de constante (RF-124). */
  total_cadeiras: number;
  /** Σ cadeiras já distribuídas — menor que `total_cadeiras` enquanto houver UF sem dado. */
  cadeiras_atribuidas: number;
  ufs_calculadas: number;
  /** Sem este número a soma não fecha e o leitor conclui que sumiram cadeiras. */
  ufs_aguardando: number;
  /** Ordenado por cadeiras desc, depois `sigla` asc (determinismo, constituição § 6). */
  por_agremiacao: EdgeAgremiacaoBancada[];
}

interface EdgeAgremiacaoBancada {
  cod: string;                 // chave nacional: nº do partido ("13") ou "fed:<fed[].n>" (D3, emenda 29/09) — NÃO `agr[].n`
  sigla: string;
  nome: string;
  tipo: "partido" | "federacao";
  /** Siglas componentes. `[]` em partido isolado. RF-122. */
  componentes: string[];
  /**
   * O partido que dá a COR (ADR-0024 linha 41: "federação usa a cor do
   * partido-líder"). Componente com mais votos nominais; empate desempata por
   * sigla ascendente (constituição § 6 — sem isso, a mesma federação poderia
   * mudar de cor entre dois ciclos, e o ADR exige cor estável a noite toda).
   * Partido isolado: igual a `sigla`, sem caso especial na tela.
   * No nacional é a soma das 27 UFs, **não** a moda dos líderes estaduais —
   * pode divergir do líder de uma UF, e isso é esperado.
   */
  sigla_lider: string;
  /** RF-125.1 — eleitos. NUNCA `vagas_obtidas`. */
  cadeiras: number;
  /** RF-127, opcional — preenchido só se o intervalo for calculado (ver D7). */
  cadeiras_ci95?: [number, number];
  /** RF-127 — cadeiras cuja atribuição ainda depende de sobra indefinida. */
  cadeiras_indefinidas?: number;
  votos_nominais: number;      // RF-130
  votos_legenda: number;       // RF-130 — separado, nunca somado em silêncio
  votos_validos: number;       // nominais + legenda
  pct_votos: number;           // 0–100 sobre os válidos nacionais
}

interface EdgeDeputadoUfRow {
  sigla: string;
  pct_apurado: number;                      // 0–100
  lugares_a_preencher: number | null;       // `carg[].nv`; null = TSE não publicou
  quociente_eleitoral: number | null;
  cadeiras_definidas: number;
  vagas_nao_preenchidas: number;
  /** Contagem. A lista nominal fica no payload de UF. */
  empates_indeterminados: number;
  lider: { cod: string; sigla: string; cadeiras: number } | null;
}
```

## D6 — Contrato: payload por UF (Blob, `deputado/uf/<SIGLA>.json`)

Vai para o Vercel Blob, não para o Global Config (RF-129, ADR-0026 item 4): o
limite de 1 MB do Global Config já é dividido por três cargos, e esta é a maior
carga do produto.

```ts
interface DeputadoUfDetail {
  ts: string;
  cargo: 6;
  turno: 1;
  uf: string;                               // sigla
  pct_apurado: number;
  lugares_a_preencher: number | null;
  quociente_eleitoral: number | null;
  /** `carg[].qe` — o quociente do PRÓPRIO TSE. Conferência, não fonte. */
  quociente_eleitoral_tse: number | null;
  /** `tf == "s"`. Sem isso, divergência é esperada e não é erro. */
  totalizacao_final: boolean;
  /**
   * Saída de `conferir_contra_tse`. `[]` quando bate.
   *
   * `o_que` é um **conjunto fechado e documentado**:
   * `"quociente_eleitoral" | "cadeiras"` (`CHAVES_DE_DIVERGENCIA` em
   * `api/model/deputado_payload.py`). O código da agremiação vai em `detalhe`,
   * não embutido na chave — a tela não deve estar decifrando strings do
   * modelo. Chave desconhecida **passa adiante** em vez de sumir: divergência
   * perdida é pior que divergência sem rótulo bonito.
   */
  divergencias: Array<{ o_que: string; nosso: number; tse: number; detalhe: string }>;
  agremiacoes: DeputadoUfAgremiacao[];
  vagas_nao_preenchidas: number;
  /** Códigos de agremiação em empate que sobreviveu aos dois desempates. */
  empates_indeterminados: string[];
}

interface DeputadoUfAgremiacao {
  cod: string;                 // a MESMA chave nacional de D5 (D3, emenda 29/09)
  sigla: string;
  nome: string;
  tipo: "partido" | "federacao";
  componentes: string[];
  /** Como em D5, mas medido **nesta UF**. */
  sigla_lider: string;
  votos_nominais: number;
  votos_legenda: number;
  votos_validos: number;
  pct_votos: number;
  quociente_partidario: number;
  cadeiras: number;                         // eleitos
  cadeiras_ci95?: [number, number];
  eleitos: DeputadoUfCandidato[];
  suplentes: DeputadoUfCandidato[];         // primeiros 5 por agremiação
}

interface DeputadoUfCandidato {
  sqcand: number;                           // identidade. NUNCA `cand.n`
  nome: string;
  partido: string;                          // sigla do partido dentro da federação
  votos: number;
  ordem: number;                            // 1-based dentro da agremiação
  /** RF-127 — eleito por sobra ainda indefinida. */
  indefinido?: boolean;
}
```

`sqcand` é a identidade porque `cand.n` (número de urna) se repete entre UFs e
entre partidos no proporcional.

## D7 — Intervalo de cadeiras (RF-127): opcional no contrato, decidido por medição

RF-127 pede intervalo, não só o número central. O caminho honesto é rodar
`distribuir_cadeiras` sobre cada resample do bootstrap e tomar o percentil — não
existe atalho que produza um intervalo com significado.

O custo não é conhecido. Por isso `cadeiras_ci95` e `cadeiras_indefinidas` são
**opcionais** neste contrato: o ponto central entra agora, o intervalo entra sem
mudar o contrato quando a medição disser que cabe na janela do cron (30 min desde
o ADR-0036; era 15 quando isto foi escrito) e no
teto de execução da função.

**Medido em 2026-09-12** (Apple M4, Python 3.14.3, dado real de 2022 — 27 UFs,
613 agremiações, 9.675 candidatos):

| | custo |
|---|---|
| ciclo completo das 27 UFs, sem intervalo | **21 ms** (+2,2 ms de serialização) |
| redistribuição de cadeiras, 1.000 resamples × 27 UFs | **11,0 s** |
| idem, 200 resamples | **~2,2 s** |

`maxDuration` da função é 60 s e a janela do cron é 30 min (era 15 quando isto
foi medido). **Cabe com folga**,
mesmo supondo o Python da Vercel 3× mais lento.

**O custo nunca foi o obstáculo.** O que falta é o que alimenta o intervalo: o
bootstrap de voto **por agremiação**.

> **Correção 2026-09-13.** A redação anterior dizia que "`extrapolation.py`
> resampleia candidato-por-zona". **Descreve a implementação antiga.** O código
> sorteia **zonas** — um único `idx` por UF (`extrapolation.py:264-265`),
> compartilhado por todos os candidatos e pelas duas bases, exatamente para
> preservar o pareamento entre eles (docstring em `:69-75`; a mudança está
> registrada em `project.py:1409-1411`). A conclusão não muda, mas o motivo sim,
> e ele importa para o desenho novo: o padrão a replicar é **um `idx` de unidades
> geográficas compartilhado por todas as agremiações**, e o obstáculo real era o
> cargo 6 ter **uma única unidade geográfica por UF** — não o eixo do sorteio.

O obstáculo foi removido em 2026-09-13: o
[ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md)
move o cargo 6 para granularidade de par município×zona (2.644 zonas distintas,
média de 97,9 por UF), varrida em 6 fatias com volta completa a cada 30 min.
Construir o bootstrap por agremiação sobre essas unidades é trabalho de
modelagem, não de orçamento de CPU — ver D9.

O intervalo passou a existir em **2026-09-13** (`api/model/cadeiras_bootstrap.py`):
IC95 por UF sobre 1.000 reamostragens das zonas, omitido quando a UF tem menos
de 2 zonas com voto — inclusive sob o interruptor de emergência, que devolve
uma zona-sentinela só. A **marcação continua existindo ao lado dele**, e não é
redundante: o intervalo mede a variância do recorte **já apurado**, e não sabe
nada do voto que ainda falta contar — no cargo 6 não há projeção de voto (D9).
A marcação é o único campo do payload que carrega o "ainda vem voto", e é
justamente onde o intervalo é omitido que ela mais importa. Definição da
marcação (fixada em 12/09, sem constante mágica):

> A cadeira marginal de sobras de uma agremiação é `indefinido` enquanto a
> distância entre a média com que ela foi ganha e a melhor média de quem ficou de
> fora for **menor que a fatia de votos ainda não apurada**.

Aritmética em `Fraction`; some sozinha em 100% apurado e com `tf == "s"`.

### Tamanho real do payload — mede o dobro do estimado

Medido em 12/09: nacional **13,4 KB**; maior UF **31,1 KB** (SP); soma das 27
**542,9 KB**. A estimativa de "10–15 KB × 27" da spec estava por baixo. Reforça
D6: 543 KB quase preencheriam sozinhos o 1 MB do Global Config que três cargos
dividem. O drill-down **tem** de ir para o Blob.

## D9 — O número central é voto apurado, não voto projetado (estado de 12/09)

> 🔴 **Superado em 2026-09-29** pela [spec 026](../026-deputado-listas-projecao/spec.md) e pelo
> ADR-0063 dela (projeção de deputado com trava de 25% e interruptor no Edge Config). O número
> central **continua** sendo o voto apurado (`cadeiras`, `bancada`); o que deixa de valer é "a
> projeção não existe": ela passa a existir em campos próprios, rotulada "projeção · não
> oficial". Contrato em [design 026 § 2](../026-deputado-listas-projecao/design.md). O texto
> abaixo fica como registro.

⚠️ **Escopo, não defeito.** As cadeiras que saem hoje são a aritmética do
ADR-0027 sobre o que **já foi contado** — "como ficaria a bancada se a apuração
parasse agora". Não são projeção.

O escopo da spec menciona projeção por regra de três (ADR-0021) em nível de UF, e
isso **não existe** para o cargo 6. É a mesma peça que falta para o intervalo de
RF-127: um modelo da corrida proporcional em granularidade de UF.

**Consequência obrigatória para a tela** (constituição § 8): ela **não pode
chamar isso de projeção**. Diz o que é — cadeiras com os votos já apurados,
com o percentual apurado ao lado.

## D9.1 — `carg[].nv` a 0% apurado: NÃO confirmado

Uma versão anterior deste documento deixou passar como fato que o TSE publica
`carg[].nv` (as vagas da UF) desde o primeiro ciclo, mesmo a 0% apurado. **Isso
era inferência, não medição, e foi retirado em 12/09.**

O que há: o banco tem 898 snapshots com `nv` presente, mas **todos os 898 são do
nosso próprio mock** (`scripts/tse-mock-server.ts:523` escreve `nv: "1"` fixo) —
identificáveis pela assinatura `COLIGACAO SINTETICA` e pelas siglas `S11`. Não
existe **nenhum** snapshot de cargo 6 no banco, nem dado real do TSE a 0%. As
fixtures do repositório trazem `nv`, mas nenhuma é de cargo proporcional nem está
a 0%.

A favor: o dicionário oficial descreve `nv` como "vagas disponíveis na
abrangência" — propriedade do cargo, não da contagem. Contra: o parser
(`lib/tse/ea20-schema.ts`) o marca `optional()`, ou seja, quem o escreveu também
não quis apostar.

**Consequência**: nenhuma para o código — os dois caminhos estão implementados e
testados (sem `nv`, a UF fica "aguardando" e não entra em `total_cadeiras`). Mas
a tela **não pode assumir 513 cedo**. A checagem entra no protocolo do simulado:
`nv` presente nos 27 envelopes de cargo 6 no primeiro ciclo, e Σ `nv` == 513.

## D10 — `composition` e `insights` no cargo 6

> **Emendado em 2026-09-29** ([spec 026](../026-deputado-listas-projecao/spec.md), ADR-0063): o
> valor não muda, a razão sim. `bancada` continua sendo só voto contado, então `composition`
> segue `{0, 0, 1}`; a projeção vive fora dela, em campos próprios.

`composition` = `{pre_election: 0, model: 0, actual_results: 1}`. Decorre de D9:
não há prior nem modelo por trás do número, só voto contado. (Hoje o campo não
alimenta nenhuma tela — só saída de debug na home presidencial — então a decisão
não tem consequência visual; tem consequência de honestidade quando alimentar.)

`insights` = `[]`. Os templates determinísticos (ADR-0005) da corrida
proporcional não existem. A tela **tem de renderizar bem com a lista vazia** —
não é estado de erro, é o estado do dia 15.

## D8 — Prosa da tela derivada, nunca literal

Lição de 11/09 (quatro frases viraram falsas ao mudar a granularidade do
Senador): nenhum número ou nome de cargo escrito à mão no JSX.

- `30 min` (RF-128) sai de `atualizacao_min` do payload — nunca literal no JSX.
- `513` sai de `bancada.total_cadeiras`.
- Vagas da UF saem de `lugares_a_preencher`.
- Nome, slug e proporcionalidade do cargo saem de `lib/config/cargos.ts`.

E **asserção negativa** nos testes de tela: o teste proíbe a frase errada (por
exemplo, que a página afirme um total de cadeiras que não veio do payload), em
vez de só conferir a certa.

## Cross-refs

- [Spec 017](./spec.md) — RFs e a degradação pré-acordada
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — o método
- [ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) — read path híbrido
- `lib/blob/uf-detail.ts::readUfDetail` — molde do leitor
- `lib/config/cargos.ts` — tabela canônica
