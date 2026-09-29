---
id: 024-etiquetas-editoriais
title: Etiquetas editoriais de candidaturas — catálogo, compilação, publicação, leitura e portão de cobertura
status: implementing
priority: S
personas: [P1, P2, P3]
screens: []
requirements: [RF-220, RF-221, RF-222, RF-223, RF-224, RF-225, RF-226, RF-227, RF-228, RF-229, RF-230, RF-231, RF-232, RF-233, RF-234, RF-235, RF-236, RF-237, RF-238, RF-239]
depends_on: [016-senador, 017-deputado-federal, 018-identidade-candidatura]
apis: []
components: [EtiquetaEditorial, EtiquetasLinha, EtiquetasAviso]
nfr: [RNF-012, RNF-019, RNF-022, RNF-023, RNF-024]
adrs: [0001, 0024, 0032, 0039, 0040, 0051, 0053, 0058, 0059, 0060, 0062]
ship_blocked_on: [emenda da constituição 1.6 aprovada (ADR-0059), página /sobre-as-etiquetas]
---

# Spec 024 — Etiquetas editoriais

**Rotas novas**: nenhuma nesta spec (a página `/sobre-as-etiquetas` e as
visões V1–V4 / Câmara 2027 são da spec 025 e da frente de telas).
**Superfícies emendadas**: nenhuma — esta spec entrega **infraestrutura
desligada**. Nenhuma página importa nada daqui até a frente de telas.

**Pedido do dono (2026-09-28/29)**: classificar candidaturas a Governador,
Senador e Deputado Federal — e os 27 senadores que seguem até 2031 — em seis
categorias editoriais, publicáveis **sem deploy**, com fonte, data e revisão
do dono em cada classificação.

## Objetivo

Quero poder dizer, na tela, "este candidato é do campo X, está no palanque de
Y, é base/oposição ao governo" **com a fonte e a data ao lado**, sem que isso
toque o modelo, a ordem dos candidatos ou o payload do Edge Config, e sem que
uma visão agregada apareça antes de todos os candidatos com chance estarem
classificados.

## Contexto medido

- **O TSE não diz quem tenta a reeleição.** `ST_REELEICAO` vem `#NE` em 100%
  das candidaturas (medido em 29/09 no cache `build/tse-archives`). Trajetória
  e alinhamento vêm de insumos derivados das duas casas
  (`editorial/derivados/{trajetoria,alinhamento}-{camara,senado}.json`,
  produzidos por outra frente); Governador, só por linha individual.
- **Nada de etiqueta no Edge Config.** O payload nacional do Senado tem
  ~9 B/candidato de folga no teste de 2× (`tests/unit/edge-config/limiar-nacional.test.ts`).
  A junção é por `sqcand` na hora de montar a página.
- **`sqcand` tem dois tipos no repositório.** `EdgeUfRow.top_candidatos[].sqcand`
  e `EdgeUfCandidate.sqcand` são `string`; `DeputadoUfCandidato.sqcand` é
  `number` (`lib/blob/deputado-uf.ts:54`). A junção normaliza para texto.
- **Universo de 29/09** (cache TSE, arquivo `_BRASIL`): 200 candidaturas a
  Governador, 319 a Senador, 7.791 a Deputado Federal (1.131 em SP); 30
  partidos; 5 federações (`PSDB/CIDADANIA`, `PT/PC do B/PV`, `PSOL/REDE`,
  `PRD/SOLIDARIEDADE`, `UNIÃO/PP`). `SQ_CANDIDATO` tem 11 ou 12 dígitos.

## Escopo

**In**
- Catálogo fechado e único (`lib/etiquetas/catalogo.ts`).
- Formato da fonte editada à mão (`editorial/etiquetas/*.csv`) e guia leigo
  (`editorial/README.md`).
- Compilador/validador (`data-pipeline/etiquetas-compilar.ts`) com
  precedência, regras derivadas (trajetória, alinhamento), histórico e teste
  de deriva.
- Publicador no Blob (`data-pipeline/etiquetas-publicar.ts`), acionado pelo dono.
- Leitor no servidor (`lib/etiquetas/leitor.ts`): Blob + cópia no build,
  chaves por visão.
- Portão de cobertura (`lib/etiquetas/portao.ts`) e vigia
  (`scripts/etiquetas-vigia.ts`).
- Três componentes **não ligados a páginas**: `EtiquetaEditorial`,
  `EtiquetasLinha`, `EtiquetasAviso`.

**Out**
- Qualquer edição de página, `GovernorCard`, `ResultPanel`,
  `CandidateResultRow`, `RegiaoConsolidada`, `globals.css`, `layout.tsx`.
- Página `/sobre-as-etiquetas`, filtro por etiqueta, hemiciclo por bloco,
  visões V1–V4 e Câmara 2027 (spec 025 / frente de telas).
- Preenchimento das classificações (frente de dados; os CSVs nascem só com
  cabeçalho).
- Emenda da constituição e ADRs (frente de governança).
- Categoria "governo do estado" e perfil dos eleitos (decisão do dono: não entram).

## Requisitos funcionais

### Catálogo e fonte

**RF-220 — Catálogo único, fechado e ordenado**

WHERE uma categoria, um valor, um rótulo, uma ordem de exibição, a matriz
cargo × categoria, a herança por partido, os limiares do alinhamento ou o
colchão do portão forem usados em qualquer lugar do sistema, the system SHALL
lê-los de `lib/etiquetas/catalogo.ts` e de nenhum outro lugar.

Categorias e valores (ordem de exibição fixa; `a_classificar` é sentinela de
todas e nunca é exibida):

| Categoria | Valores (rótulo) | Por turno | Herda do partido | Aplica-se a |
|---|---|---|---|---|
| `campo_ideologico` | Esquerda · Centro-esquerda · Centro · Centro-direita · Direita · Sem posição clara | não | sim | 3, 5, 6, senado2031 |
| `palanque_presidencial` | Palanque de Lula · Palanque de Flávio Bolsonaro · Palanque duplo · Sem palanque declarado | **sim (1/2)** | sim | 3, 5, 6, senado2031 |
| `relacao_governo` | Base do governo · Oposição · Independente | não | sim | 3, 5, 6, senado2031 |
| `centrao` | Centrão (só quando `sim`; `nao` nunca vira etiqueta) | não | sim | 3, 5, 6, senado2031 |
| `trajetoria_cargo` | Tenta a reeleição · Volta ao cargo · Estreante no cargo | não | **não** | 3, 5, 6 |
| `impeachment_stf` | A favor · Contra · Sem posição pública | não | **não** | 5, senado2031 |

**Aceitação**:
- Given o catálogo, when um valor novo é acrescentado a uma categoria, then
  nenhum arquivo gerado nem publicado precisa ser migrado (os gerados guardam
  ids, e o leitor trata id desconhecido como `a_classificar`).
- Given `ALINHAMENTO_BASE_MIN = 65`, `ALINHAMENTO_OPOSICAO_MAX = 35`,
  `ALINHAMENTO_MIN_VOTOS_DISPUTADAS = 30`, `PORTAO_MARGEM_PP = 5`, when
  qualquer módulo precisa de um deles, then importa do catálogo.
- Given o hemiciclo por bloco (spec 025), when ordena os blocos de
  `relacao_governo`, then usa `ORDEM_BLOCOS_HEMICICLO` = base → independente
  → aguardando → oposição.

**RF-221 — Fonte editada à mão, em formato longo**

WHEN o dono (ou Claude, para revisão do dono) registra uma classificação, the
system SHALL aceitá-la como uma linha de CSV em `editorial/etiquetas/`
(`governador.csv`, `senador.csv`, `senado-2031.csv`, `partidos.csv`,
`deputados-excecoes.csv`) com as colunas
`chave,categoria,valor,turno,fonte_url,fonte_descricao,data,revisado,revisado_em,nota`,
onde `chave` é um `sqcand` do TSE, `partido:SIGLA`, `federacao:SIGLA` ou
`senado:CODIGO`, e cada arquivo aceita só o tipo de chave que lhe cabe.

**Aceitação**:
- Given `partidos.csv` com uma chave `sqcand`, when compila, then falha
  apontando arquivo e linha.
- Given `editorial/README.md`, when um não-engenheiro o lê, then sabe
  preencher uma linha sem ajuda.

### Compilação

**RF-222 — Validação que falha alto**

WHEN o compilador roda, the system SHALL recusar a compilação inteira (código
de saída ≠ 0, lista de erros com arquivo:linha) se qualquer linha: tiver chave
fora do universo (candidatura do TSE no cargo do arquivo, partido/federação
presente no universo, código da foto do Senado); tiver categoria ou valor fora
do catálogo, ou categoria não aplicável ao alvo; tiver `fonte_url`,
`fonte_descricao`, `data` ou `revisado` vazios, `data` inválida ou no futuro,
`revisado` fora de `sim`/`nao`, `revisado_em` ausente com `revisado=sim`;
repetir `(chave, categoria, turno)`; ou se uma federação do universo tiver
algum partido-membro com linha em `(categoria, turno)` sem linha própria
`federacao:` na mesma `(categoria, turno)`.

**Aceitação**:
- Given uma linha sem `fonte_url`, when compila, then falha e nada é gravado.
- Given `data` = amanhã, when compila, then falha.
- Given `partido:PT` com `campo_ideologico` e sem `federacao:PT/PC do B/PV`
  na mesma categoria, when compila, then falha.

**RF-223 — Linha não revisada não vai ao ar; derivado não aprovado também não**

IF uma linha tem `revisado ≠ sim`, the system SHALL compilá-la como se não
existisse (o candidato fica `a_classificar` naquela categoria, ou cai na
próxima regra da precedência), sem deixar de validá-la.

**Emenda de 2026-09-29 (auditoria constitucional, § 2 (b)).** A regra
derivada classifica milhares de candidaturas de uma vez, e até esta data ia ao
ar sem revisão nenhuma — só as linhas de CSV passavam pelo `revisado`. Agora
cada insumo derivado (`editorial/derivados/trajetoria-camara.json`,
`alinhamento-camara.json`, `trajetoria-senado.json`, `alinhamento-senado.json`)
traz no cabeçalho o carimbo de revisão do dono sobre o **arquivo inteiro**:
`"revisao": { "revisado": "sim"|"nao", "revisado_em": "AAAA-MM-DD"|null, "por": <nome>|null }`.
IF o carimbo falta ou diz `"nao"`, the system SHALL tratar o insumo como
AUSENTE (RF-226/227: ninguém classificado por ele; relação com o governo cai
no padrão do partido; trajetória fica `a_classificar`), sem deixar de
validá-lo, e SHALL listá-lo no relatório de cobertura como "aguardando
revisão do dono". IF `"revisado": "sim"` vier sem `revisado_em` (data real)
ou sem `por`, com `revisado_em` no futuro, ou com `revisado_em` anterior à
geração do arquivo (`gerado_em` em BRT na trajetória, `corte` no
alinhamento), the system SHALL recusar a compilação. Os quatro exportadores
SHALL gravar sempre `"revisado": "nao"` — **regenerar zera a revisão**. A
data da aprovação viaja na proveniência pública (`derivados.<insumo>.revisado_em`).

**Aceitação**:
- Given uma linha válida com `revisado=nao`, when compila, then o gerado não a
  contém e a resolução daquela categoria não a usa.
- Given `trajetoria-camara.json` válido com `"revisado": "nao"` (ou sem o
  bloco), when compila, then nenhum deputado tem trajetória derivada,
  `derivados.trajetoria_camara` é `null` e o relatório lista o arquivo como
  aguardando revisão.
- Given `"revisado": "sim"` sem `por`, ou com `revisado_em` anterior ao
  `gerado_em`, when compila, then falha.
- Given `pnpm trajetoria:exportar` (ou `alinhamento:importar`,
  `alinhamento:senado`, `trajetoria:senado`), when grava, then o carimbo sai
  `"nao"`, `null`, `null`.

**RF-224 — Precedência**

WHEN uma categoria de um candidato é resolvida, the system SHALL aplicar,
nesta ordem, a primeira que existir: linha individual (`sqcand` / `senado:`)
revisada → regra derivada (alinhamento para `relacao_governo`, trajetória para
`trajetoria_cargo`, só cargo 6) → padrão do partido (`partido:SIGLA`) →
padrão da federação (`federacao:SIGLA`) → `a_classificar`. Padrão por partido
ou federação só vale nas categorias que herdam (RF-220).

**Aceitação**:
- Given linha individual e padrão do partido para a mesma categoria, when
  resolve, then vale a individual, com `origem: "individual"`.
- Given só o padrão do partido para `trajetoria_cargo`, when compila, then
  falha (categoria que não herda).

**RF-225 — Palanque por turno, sem vazamento**

WHILE a categoria é `palanque_presidencial`, the system SHALL exigir `turno`
1 ou 2 em toda linha e resolver cada turno **só** com linhas daquele turno;
nas demais categorias, `turno` SHALL ser vazio.

**Aceitação**:
- Given só uma linha de turno 2, when resolve o turno 1, then `a_classificar`
  (e vice-versa).

**RF-226 — Trajetória derivada da Câmara (cargo 6) e do Senado (cargo 5)**

WHERE `editorial/derivados/trajetoria-camara.json` (cargo 6) ou
`editorial/derivados/trajetoria-senado.json` (cargo 5) existir **com o
carimbo de revisão aprovado pelo dono** (RF-223, emenda de 29/09 — sem ele, o
arquivo vale como ausente), the system
SHALL mapear `em_exercicio` e `legislatura_atual` → Tenta a reeleição,
`mandato_anterior` → Volta ao cargo, `estreante` → Estreante no cargo;
`sqcand` ausente do arquivo SHALL ficar `a_classificar` (ausência nunca vira
estreante); e SHALL recusar a compilação se `universo` divergir do número de
candidaturas daquele cargo no universo do TSE, ou se um `sqcand` do arquivo
não for candidatura daquele cargo. Governador só tem trajetória por linha
individual.

**Aceitação**:
- Given `universo` = 7.790 e o TSE com 7.791 candidaturas a Deputado Federal,
  when compila, then falha (idem Senador).
- Given o arquivo ausente, when compila, then a trajetória fica
  `a_classificar` e a compilação passa.
- Given o arquivo presente sem aprovação do dono, when compila, then o mesmo
  que ausente — mas o universo e o formato continuam validados.

**RF-227 — Relação com o governo de quem tem mandato, pelo alinhamento**

WHERE houver insumo de alinhamento **aprovado pelo dono** (RF-223, emenda de
29/09) — `alinhamento-camara.json` (pelos `camara_ids` da trajetória da
Câmara, cargo 6, que também precisa estar aprovada) ou
`alinhamento-senado.json` (pelos `senado_codigos` da trajetória do Senado,
cargo 5, e pelo próprio código de cada um dos 27 de senado2031) — e o
parlamentar tiver dado, the
system SHALL somar `votos_disputadas` dos ids e calcular a taxa ponderada
pelos votos; IF a soma for ≥ 30, the system SHALL classificar taxa ≥ 65 como
Base do governo, taxa ≤ 35 como Oposição e o resto como Independente; caso
contrário (soma < 30, sem id, sem dado), SHALL cair no padrão do partido. O
mínimo de 30 conta **votos disputados**, não todos os votos válidos. Para
quem a regra classifica, the system SHALL gravar a medida junto (`votos` e
`taxa` com 2 casas — `m` no nacional, `medidas` no arquivo de UF), para a
lista pública de classificações (constituição § 8); a classificação usa a
taxa sem arredondar.

**Aceitação**:
- Given o alinhamento aprovado e a trajetória da mesma casa sem aprovação,
  then o alinhamento não classifica nenhum candidato daquela casa (sem ids).
- Given taxa exatamente 65 com 30 votos, then Base; 64,99 → Independente.
- Given taxa exatamente 35, then Oposição; 35,01 → Independente.
- Given 29 votos e taxa 90, then padrão do partido.
- Given taxa fora de [0, 100] ou campo de dado pessoal no arquivo, then a
  compilação falha.
- Given um dos 27 de senado2031 "S/Partido" sem dado de alinhamento, then
  `a_classificar` (nunca o padrão de um partido chamado "S/Partido").

**RF-228 — Saída do compilador, determinística e com proveniência**

WHEN o compilador termina sem erro, the system SHALL gravar
`lib/data/etiquetas/nacional.generated.json` (Governador, Senador,
senado2031, padrões de partido/federação, chaves de visão ~~**todas
desligadas**~~ **as de `editorial/etiquetas/publicar.json`** — emenda de
29/09, RF-253 da spec 025 —, meta), `lib/data/etiquetas/uf/<UF>.generated.json` (Deputado
Federal: candidaturas por partido + trajetória e alinhamento derivados +
exceções individuais) para as 27 UFs e `lib/data/etiquetas/historico.json`;
cada valor resolvido SHALL carregar `origem` (`individual` | `derivado` |
`partido`), fonte e data; e recompilar as mesmas fontes SHALL produzir o
mesmo conteúdo, com a mesma `versao` e o mesmo `gerado_em` (a comparação é
do JSON, não dos bytes: o `biome format` reformata os gerados).

**Aceitação**:
- Given os gerados versionados e as fontes versionadas, when o teste de deriva
  recompila, then o conteúdo bate (pulado, com o motivo no nome do teste,
  quando o cadastro do TSE não existe — ver design § Deriva).

**RF-229 — Nenhum dado pessoal nos gerados; lista branca de campos**

The system SHALL garantir que nenhum arquivo gerado ou publicado contém data
de nascimento, CPF, título de eleitor, e-mail, nome civil ou nome social;
SHALL recusar insumo derivado que traga campo com esses nomes; e SHALL montar
os arquivos por **lista branca** de campos — em particular a coluna `nota`
dos CSVs (anotação interna do dono) nunca sai do repositório editorial
(ADR-0062).

**Aceitação**:
- Given um CSV do TSE sintético com CPF, nascimento, nome civil e nome social
  preenchidos, when compila, then nenhum desses valores aparece nos gerados.
- Given uma linha com `nota` preenchida, then o texto da nota não aparece em
  nenhum gerado nem publicado.

### Publicação e leitura

**RF-230 — Publicação pelo dono, sem deploy**

WHEN o dono roda `pnpm etiquetas:publicar`, the system SHALL apenas conferir
e listar o que gravaria — **sem gravar** — a menos que o comando traga
`--confirmar` (emenda de 29/09: o padrão era gravar, e `--dry-run` protegia;
agora é o inverso). Com `--confirmar`, the system SHALL recusar se a
árvore do git estiver suja, se HEAD estiver atrás de `origin/main`, se o
validador falhar, se os gerados divergirem da recompilação ou se não
conseguir ler a versão hoje no Blob; SHALL carimbar o sha do git e uma
`versao` estritamente maior que a do Blob e a do build; SHALL aplicar as
chaves por visão de `editorial/etiquetas/publicar.json`; SHALL reconstruir
cada arquivo público campo a campo (lista branca); SHALL gravar com
`cacheControlMaxAge: 60` (`lib/blob/write.ts`); e SHALL gravar
`etiquetas/v1/uf/<UF>.json` e `etiquetas/v1/historico.json` antes de
`etiquetas/v1/nacional.json`.

**Aceitação**:
- Given `git status --porcelain` não vazio, when publica, then recusa sem
  gravar nada.
- Given o Blob com `versao` 100 e o build com 90, when publica, then grava
  `versao` > 100.
- Given uma escrita, then o objeto sai com `cacheControlMaxAge` 60 — com o
  padrão do SDK (um mês), a correção "em minutos" não chegaria à tela.

**RF-231 — Leitura: Blob ou cópia do build, a maior versão**

WHEN uma página no servidor pede etiquetas, the system SHALL ler
`etiquetas/v1/*` do Blob com `revalidate: 60` e a cópia do build, usar a de
maior `versao` e, IF o Blob falhar (ausente, rede, corpo inválido), SHALL usar
a cópia do build sem erro (constituição § 7); ~~as chaves por visão da cópia do
build SHALL estar sempre desligadas~~ as chaves por visão SHALL ser as do
arquivo escolhido, e a cópia do build SHALL carregar as do `publicar.json`
versionado.

> 🔴 **EMENDADO em 2026-09-29 — [spec 025, RF-253](../025-visoes-editoriais/spec.md)
> (ADR-0060, emenda).** A versão anterior forçava a cópia do build a tudo
> desligado. Combinado com "vence a maior `versao`", um deploy que levasse uma
> compilação mais nova que a última publicação apagava as visões em silêncio
> (open question 5 abaixo). Agora Blob e build carregam o mesmo `publicar.json`
> e o publicador recusa quando divergem.

**Aceitação**:
- Given Blob fora do ar, when lê, then devolve a cópia do build, com as chaves
  que o `publicar.json` versionado liga (tudo `false` no de hoje).
- Given o dono ligou `v1`, compilou e publicou, when um deploy leva uma
  compilação mais nova, then `viewLigada("v1")` continua `true`.

**RF-232 — Junção por `sqcand` normalizado**

WHEN uma tela junta etiqueta a candidato, the system SHALL normalizar `sqcand`
para texto decimal (aceitando `number` e `string`) antes de procurar.

**Aceitação**:
- Given `250002012345` (number) e `"250002012345"` (string), then as duas
  leituras devolvem a mesma etiqueta.

### Portão e vigia

**RF-233 — Portão de cobertura**

WHERE uma visão agregada depende de uma categoria, the system SHALL só
liberá-la quando todo candidato "com chance" estiver classificado nela, sendo
"com chance", por corrida: as posições que elegem (Governador 1º turno: 2;
2º turno: os 2 finalistas; Senado: as vagas da UF) **mais** quem estiver a até
`PORTAO_MARGEM_PP` pontos da última posição que elege, calculado em Parcial
(`pct_atual`) **e** em Projeção (`pct_projetado`), unidos; candidatura
anulada fica de fora; `sqcand` ausente conta como não classificado; e, para
visões do Senado inteiro, os 27 de senado2031; para a Câmara 2027, toda
agremiação com cadeira > 0. O portão SHALL devolver a lista de quem bloqueia.

**Aceitação**:
- Given 3º colocado a exatamente 5,0 pp do 2º, then está com chance; a 5,01,
  não.
- Given alguém fora do top-2 na Projeção mas dentro na Parcial, then entra.
- Given fase pré-eleição, then o conjunto é a corrida inteira.

**RF-234 — Vigia das etiquetas**

WHEN `pnpm etiquetas:vigia` roda, the system SHALL carregar do `.env.local`
apenas as variáveis da sua lista branca (nunca `DATABASE_URL`), ler os
payloads de Governador, Senador e Deputado do Edge Config e sair com código 2
e uma linha por alerta quando um candidato sem classificação entrar entre os 4
primeiros de qualquer corrida (em qualquer das duas bases), ou quando uma
agremiação com cadeira não tiver padrão; código 1 quando não conseguir olhar;
código 0 em fase pré-eleição ou sem alerta.

**Aceitação**:
- Given um `.env.local` com `DATABASE_URL`, when o vigia carrega o ambiente,
  then `DATABASE_URL` não entra no processo.

### Componentes

**RF-235 — `EtiquetaEditorial`**

WHEN uma etiqueta classificada é exibida, the system SHALL renderizá-la como
`<span>` de texto sem área de cor (fundo transparente, borda tracejada; tinta
e borda neutras com croma C* < 10, ΔE76 ≥ 10 contra toda cor de partido e
contraste ≥ 4,5:1 / 3:1 nos dois temas), nunca interativa, com separador
`sr-only` e o nome da categoria só para leitor de tela; e SHALL não
renderizar nada para `a_classificar`, valor desconhecido ou `centrao = nao`.

**Aceitação**:
- Given `a_classificar`, then o HTML é vazio.
- Given a etiqueta dentro de um `<a>`, then não há elemento interativo
  aninhado.

**RF-236 — `EtiquetasLinha`**

WHEN um candidato tem etiquetas, the system SHALL mostrá-las numa linha
compacta, na ordem do catálogo, só das categorias pedidas, e nada quando não
houver nenhuma classificada.

**RF-237 — `EtiquetasAviso`**

WHERE uma superfície mostra etiqueta, the system SHALL poder exibir o aviso
"Classificação editorial do AtlasMenna, com fonte e data — não é dado do TSE
nem resultado do modelo." com link para `/sobre-as-etiquetas`.

**RF-238 — Etiqueta nunca muda a ordem**

The system SHALL produzir a mesma ordem de candidatos com etiquetas
presentes, ausentes, parciais ou permutadas (constituição § 2): a junção
etiqueta ↔ lista (`lib/etiquetas/juncao.ts::comEtiquetas`) preserva a ordem
de entrada, e o portão e o vigia devolvem suas listas na ordem de entrada.

**Aceitação**:
- Given o auxiliar de invariância de ordem (`tests/unit/etiquetas/ordem-invariante.ts`),
  when aplicado à junção, ao portão e à seleção do vigia, then passa — e toda
  superfície da spec 025 que juntar etiqueta a candidatos SHALL usá-lo.

**RF-239 — Histórico público de alterações**

WHEN uma compilação muda alguma classificação efetiva (linha revisada nova,
alterada ou removida; insumo derivado alterado), the system SHALL acrescentar
a `historico.json` uma entrada por mudança com o quê, de → para, fonte, data
e quando — sem nunca reescrever entradas anteriores.

**Aceitação**:
- Given uma recompilação sem mudança, then o histórico não ganha entrada.

## Requisitos não-funcionais aplicáveis

- [RNF-012](../../nfr/availability.md) — Blob fora ⇒ cópia do build.
- [RNF-019](../../nfr/security.md) — sem dado pessoal (RF-229).
- [RNF-022](../../nfr/accessibility.md) — contraste da etiqueta (RF-235).
- [RNF-023/024](../../nfr/accessibility.md) — texto, não cor; nada interativo.

## Open questions

- ? **Palanque de quem apoia Caiado (PSD) ou Zema (Novo).** O catálogo não tem
  valor que caiba; hoje o único destino possível é "Sem palanque declarado",
  que é impreciso. O catálogo aceita valor novo sem migração (RF-220) —
  decisão do dono.
- ~~? **Chip de impeachment fora do placar.**~~ **Resolvida (spec 025, RF-246):**
  a etiqueta de impeachment mostra SEMPRE a frase qualificada, visível
  ("Posição pública sobre impeachment de ministros do STF: a favor"), e só em
  superfícies do Senado — nunca nos cartões das capas.
- ? **Contrato de `editorial/senado/mandato-2031.json`** (produzido pela frente
  023): o compilador lê com tolerância (`codigo`/`codigo_parlamentar`, `uf`,
  `partido`/`partido_atual`); confirmar na barreira.
- ? **Corte do alinhamento do Senado.** O da Câmara está preso ao catálogo
  (`ALINHAMENTO_CORTE = 2026-09-03`; outro corte derruba a compilação). O do
  Senado é aceito como vier e viaja na proveniência
  (`derivados.alinhamento_senado.data`). Prender também?
- ~~? **Visões apagam depois de deploy.**~~ **Resolvida (spec 025, RF-253,
  2026-09-29):** a cópia do build passa a carregar o `publicar.json` versionado
  (fora do `conteudo_sha256` — ligar uma chave não gera versão nem histórico); o
  leitor honra as chaves de qualquer fonte; o publicador recusa `publicar.json`
  diferente da cópia do build. Deploy depois de publicação não apaga visão
  (teste em `tests/unit/etiquetas/leitor.test.ts`).
