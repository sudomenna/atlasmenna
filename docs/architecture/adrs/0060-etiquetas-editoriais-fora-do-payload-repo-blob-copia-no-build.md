---
id: ADR-0060
title: Etiquetas editoriais fora do payload — repositório como fonte, cópia embutida no build mais publicação no Blob por script do dono, junção por sqcand na hora de renderizar, chaves por visão e portão de cobertura
status: accepted
date: 2026-09-29
---

# ADR-0060 — Etiquetas editoriais fora do payload: repositório, Blob, cópia no build

## Status

Aceito (2026-09-29) — execução autorizada pelo dono; revisão final do dono pendente.

Implementa, na camada de dados, as condições do § 2 ("Classificação editorial") fixadas no
[ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md). Não emenda nenhum ADR anterior;
usa, sem alterá-los, o Blob do [ADR-0032](0032-detalhe-municipal-vercel-blob.md) e o read path do
[ADR-0001](0001-edge-config-no-read-path.md).

## Contexto

As etiquetas editoriais (campo, palanque, relação com o governo, trajetória, impeachment) precisam
de um lugar para morar, e o lugar decide duas coisas que importam mais do que o formato: **quem pode
mudá-las e com que atrito**, e **o que acontece com o produto quando algo dá errado**. A janela é
estreita. Produção vira em 03/10; o 1º turno é 04/10; em 04/10 o deploy fica **congelado das 16h às
05h** (`docs/operations/deployment.md:28-31`), e o dono decidiu que cada visão entra no ar quando
ficar pronta, inclusive durante a apuração. Uma correção de classificação errada — que é uma
alegação sobre uma pessoa nomeada — não pode esperar um deploy que não existe naquele intervalo.

Os candidatos naturais eram três. O **Edge Config** (o payload de apuração) é o caminho quente do
produto, mas leva a apuração escrita pelo ciclo do modelo a cada 60 s, e a condição 5 do § 2 proíbe
etiqueta ali: mistura ciclos de vida — apuração é automática e append-only, etiqueta é curadoria
humana e revisável — e amarra uma correção editorial ao escritor do payload nacional. O tamanho é um
argumento de apoio, e **modesto**: o Senado nacional tem folga de aproximadamente **9 B por
candidato** contra o piso de 2× do alarme calibrado (`tests/unit/edge-config/limiar-nacional.test.ts:94-104`,
medição de 29/09 registrada no plano; não repetida por este ADR). Isso não quer dizer que etiquetas
não caberiam no store de 1 MB — caberiam com folga —, quer dizer que qualquer campo por candidato
que crescesse o payload nacional derrubaria o teste que garante que o alarme não é decorativo. O
**Postgres** está fora do read path por decisão (ADR-0001) e transformaria cada correção numa
escrita no banco de produção na semana da eleição. E uma **cópia só no repositório**, compilada no
build, é a mais segura e a mais rígida: qualquer mudança vira deploy.

A escolha, então, é combinar duas coisas com propriedades opostas: uma cópia **embutida no build**
(determinística, sem I/O de rede, sempre presente) e uma cópia **publicada no Blob** (mutável sem
deploy). O leitor escolhe entre as duas por um número de versão, não por horário.

## Decisão

**1. O repositório é a fonte de verdade.** As classificações vivem em `editorial/`, editadas à mão:
`editorial/etiquetas/*.csv` em formato longo, uma linha por classificação (`governador.csv`,
`senador.csv`, `senado-2031.csv`, `partidos.csv` — com federações explícitas —,
`deputados-excecoes.csv`; colunas `chave` — `sqcand`, `partido:SIGLA`, `federacao:COD` ou
`senado:COD` —, `categoria`, `valor`, `turno` (só palanque), `fonte_url`, `fonte_descricao`, `data`,
`revisado`, `revisado_em`, `nota`), mais os derivados gerados por script em
`editorial/derivados/*.json` (trajetória, [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md);
alinhamento, [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md))
e as fotos do Senado em `editorial/senado/`. Cada mudança
tem diff, autor e data no git — que é o registro que a condição 8 do § 2 exige, antes de qualquer
tela.

**2. O compilador valida e emite.** `data-pipeline/etiquetas-compilar.ts` rejeita: chave inexistente
no universo do TSE (cache `build/tse-archives`) ou na foto do Senado; valor ou cargo que o catálogo
(`lib/etiquetas/catalogo.ts`) não permite; fonte, data ou revisão ausentes; data futura; duplicata de
`(chave, categoria, turno)`; federação sem valor explícito. A precedência é exceção por `sqcand` >
regra derivada (alinhamento, trajetória) > padrão do partido > `a_classificar`; linha com
`revisado ≠ sim` compila como `a_classificar`. Emite `lib/data/etiquetas/nacional.generated.json`,
`uf/<UF>.generated.json` e `historico.json`. Um teste de deriva exige que o gerado versionado seja
idêntico à recompilação.

**3. Duas cópias, uma regra de escolha.** A cópia **embutida** em `lib/data/etiquetas/*.generated.json`
é importada só em código de servidor (`server-only`): nenhum byte de etiqueta chega ao JavaScript do
navegador (RNF-007a); as etiquetas chegam como texto no HTML. A cópia **publicada** é gravada por
script acionado **pelo dono** (`data-pipeline/etiquetas-publicar.ts`) em
`etiquetas/v1/nacional.json`, `etiquetas/v1/uf/<UF>.json` e `etiquetas/v1/historico.json`, com o
**sha do git** e uma **`versao` inteira e monotônica**. O leitor lê o Blob por `fetch` com
`next: { revalidate: 60 }` — mesmo mecanismo e mesma estrutura de resultado discriminado de
`lib/blob/candidatos.ts` (que revalida a cada 12 h por outra razão; a cadência de 60 s é a dos
leitores irmãos `lib/blob/deputado-uf.ts:193` e `lib/blob/uf-detail.ts:97`) — e **vence a cópia de
maior `versao`**, comparada como inteiro, nunca por data. **Se o Blob falhar, vale a cópia
embutida** (constituição § 7). A escrita usa o primitivo único `putJson` (`lib/blob/write.ts`) com
`cacheControlMaxAge` de 60 s: sem isso o default do `@vercel/blob` é um mês e o CDN serviria a
classificação de ontem sem erro visível (`lib/blob/write.ts:11-18`). Os caminhos moram em
`lib/blob/paths.ts`, o ponto único de nome de objeto do ADR-0032. Reverter é republicar o conteúdo
anterior com `versao` maior.

**4. Chaves por visão dentro do arquivo publicado.** `publicar.{chips, filtro, v1, v2, v3, v4,
camara2027}` moram no arquivo publicado, junto do dado e sob a mesma `versao`; no build, o padrão é
**tudo desligado**. O dono liga e desliga uma visão sem deploy — o único meio de o fazer durante o
congelamento de 04/10. Chave e dado no mesmo arquivo garantem que nunca exista uma visão ligada
sobre dado de outra versão. Variável de ambiente não serve: mudar env na Vercel só vale para o
próximo deploy.

**5. Junção na hora de renderizar, por `sqcand` normalizado para texto.** Nada é gravado no payload
de apuração. `/senador` e `/governador` juntam `por_uf[].top_candidatos[].sqcand` ao arquivo
`nacional`; as páginas de UF juntam `EdgeUfCandidate.sqcand` ao arquivo `uf/<UF>`; `/candidatos`, as
fatias de identidade ao `uf/<UF>`; `/deputado-federal` usa o **padrão por partido/federação** da
bancada (`bancada.por_agremiacao`) à noite, e, após o resultado, os 513 eleitos compilados offline.
`sqcand` vem como **texto** em `EdgeUfRow.top_candidatos[]` e em `EdgeUfCandidate` e como **número** em
`DeputadoUfCandidato.sqcand` (`lib/blob/deputado-uf.ts:54`): a junção normaliza os dois lados para
texto, com teste que cobre número, texto e ausente. O campo é opcional nos tipos do payload; **`sqcand`
ausente conta como não classificado**. `/senador` continua estático (ISR): a leitura passa pelo Data
Cache do Next e não o torna dinâmico.

**6. Portão de cobertura, função pura.** `lib/etiquetas/portao.ts` decide se uma visão agregada pode
aparecer. Em cada corrida, "tem chance" são as posições que **elegem** (Governador no 1º turno: os
dois primeiros; no 2º turno: os finalistas; Senado: as duas vagas) **mais** quem está a até **5 pontos
percentuais** da última posição que elege. O cálculo é feito **nas duas bases** — Parcial e Projeção
— e usa a **união** delas, porque o leitor pode trocar de base e a visão não pode valer numa e não
na outra. Candidato anulado fica de fora (ADR-0053). Também entram no portão os 27 senadores que
continuam (para as visões V1 e V2) e todo partido ou federação com cadeira (para a Câmara 2027). O
colchão é por **margem**, não por posição, para a fronteira não pular a cada troca de segundo lugar.

**7. Vigia.** `scripts/etiquetas-vigia.ts`, a cada 10 minutos, avisa quando um candidato sem etiqueta
entra entre os **quatro primeiros** de qualquer corrida — antes de ele chegar ao portão, para dar
tempo de classificar. Carrega o ambiente por **lista branca**, no molde de `scripts/_vigia-env.ts`:
nenhuma variável que toque banco.

## Consequências

**Positivas**:
- **Correção sem deploy, em minutos.** No pior caso, da ordem de dois minutos (60 s de CDN + 60 s de
  Data Cache — estimativa, não medida): o único caminho compatível com o congelamento de 04/10.
- **O modelo e o payload de apuração não sabem que etiqueta existe.** Nenhuma mudança no Edge Config,
  no writer, nem no alarme calibrado; a condição 5 do § 2 é estrutural, não só de convenção.
- **Falha fechada.** Blob fora do ar, arquivo malformado ou publicação ausente resultam em cópia
  embutida com tudo desligado: o produto perde uma camada opcional, não mostra etiqueta que ninguém
  consegue verificar.
- **Auditável de ponta a ponta**: cada linha tem fonte, data e revisão no CSV; cada mudança tem
  diff no git; cada publicação tem sha e `versao`.
- **Zero JavaScript de dado no navegador**: `server-only` mantém o RNF-007a intacto.
- **Reverter é uma operação, não uma investigação**: republicar o conteúdo anterior com `versao`
  maior.

**Negativas**:
- **Blob fora do ar apaga as visões que o dono ligou.** O padrão embutido é tudo desligado; se o
  Blob falhar durante a apuração, as visões somem exatamente quando estão no ar. É a direção segura,
  mas é uma perda em direção contrária ao "último valor conhecido" do § 7. Se o Data Cache do Next
  segue servindo o último valor bom numa revalidação que falha **não foi verificado por este ADR** e
  precisa ser conferido na implementação.
- **Duas fontes com árbitro numérico.** A regra "maior `versao` vence" é simples, mas erros de
  `versao` são silenciosos: publicar a partir de um branch atrasado gera `versao` maior com conteúdo
  **mais antigo**. "Recusar árvore suja" não pega isso; a spec de etiquetas precisa exigir que o
  publicador confira a posição do branch e leia a `versao` corrente do Blob antes de incrementar.
- **Publicar não passa pelos portões de um deploy.** Não há lint, teste nem CI entre o CSV e a tela.
  O publicador **tem de** rodar o mesmo validador do compilador e o teste de deriva antes de subir;
  arquivo que não valida não sobe. Sem isso, o mecanismo que resolve o congelamento também contorna
  a única verificação automática que existe.
- **O arquivo do Blob é público e legível por qualquer um.** Só pode conter o que a tela e a
  metodologia já mostram. A coluna livre `nota` do CSV **não pode** sair para o arquivo publicado sem
  decisão explícita; o compilador deve emitir por lista branca de campos, e a lista é decisão da
  spec, ainda aberta.
- **Etiqueta e dado de apuração podem discordar no tempo.** Um candidato pode ser exibido na apuração
  antes de a etiqueta (ou a `versao`) chegar; a junção por `sqcand` é feita a cada renderização, e a
  ausência vira "sem etiqueta" — que, numa lista com outros candidatos etiquetados, pode ser lida
  como omissão editorial. A condição 6 do § 2 proíbe o "A classificar" na tela, mas não impede essa
  leitura em superfícies que não são agregadas.
- **O portão tem parâmetros arbitrários.** Os 5 pontos percentuais e o critério "posições que elegem"
  são escolha editorial. O portão se adapta bem à apuração que se aproxima, mas **a cobertura só
  crescer durante a noite é um objetivo, não uma garantia**: um candidato sem etiqueta que entra na
  margem derruba a visão. É para isso que o vigia existe, e ele tem as limitações abaixo.
- **O vigia herda a fraqueza dos vigias locais do projeto.** Se ele roda na máquina do dono, para com
  a máquina (a vigia agendada perdeu o dia 22/09 inteiro por isso). Um aviso que pode não sair na
  noite do dia D não é uma garantia.
- **A junção depende de `sqcand` presente e estável.** A fixture do simulado é mais rica que a
  produção; o caminho em que `sqcand` falta ou vem como número (deputados) precisa de teste próprio e
  de conferência contra a produção real, não só contra o simulado.
- **Mais uma pasta de conteúdo e mais superfície de escrita**: `editorial/`,
  `lib/etiquetas/`, `lib/data/etiquetas/` e `data-pipeline/etiquetas-*` não constam de
  `docs/architecture/folder-structure.md`, que precisa de emenda.

## Alternativas consideradas

- **Etiquetas no payload do Edge Config, junto de `top_candidatos`.** Rejeitada: proibida pela
  condição 5 do § 2, mistura a curadoria humana com o escritor do payload nacional a cada 60 s e não
  cabe no alarme calibrado (~9 B por candidato de folga no Senado até o piso de 2×).
- **Etiquetas no Postgres, lidas pela página.** Rejeitada: banco no read path é vetado pelo ADR-0001
  e cada correção viraria escrita em produção na semana da eleição.
- **Só a cópia embutida (toda mudança é deploy).** Rejeitada: incompatível com o congelamento de
  04/10 (16h–05h) e com a decisão de o dono ligar visões durante a apuração.
- **Só o Blob, sem cópia no build.** Rejeitada: sem cópia embutida não há degradação (§ 7) — Blob
  fora do ar deixaria o produto sem fonte —, e o build deixaria de ser reprodutível.
- **Chaves por visão em variável de ambiente.** Rejeitada: mudança de env só vale no próximo deploy.
- **Chaves por visão fora do arquivo (por exemplo, no Edge Config).** Rejeitada: separar chave e dado
  permite uma visão ligada sobre uma `versao` de dado que não a sustenta.

## Emenda 2026-09-29 (spec 025): as chaves da cópia do build vêm do `publicar.json` versionado

**O que mudou no item 4.** "No build, o padrão é **tudo desligado**" deixou de valer. Combinado com
"vence a maior `versao`" (item 3), ele armava uma armadilha para a noite da eleição, registrada como
open question 5 da spec 024: um deploy que levasse uma compilação **mais nova** que a última
publicação fazia a cópia do build vencer — e apagava, em silêncio, toda visão que o dono tinha
ligado, até alguém publicar de novo. Com o deploy congelado das 16h às 5h de 04/10, ninguém
publicaria a tempo de perceber.

**Decisão (autorizada pelo dono na execução do plano de 29/09; revisão final pendente):**

1. O compilador lê `editorial/etiquetas/publicar.json` (ausente ou inválido ⇒ a compilação falha) e
   grava as chaves na cópia do build — **fora** do `conteudo_sha256`: ligar uma visão não é mudar
   classificação, não gera `versao` nova nem entrada no histórico.
2. O leitor honra as chaves do arquivo escolhido, **qualquer que seja a fonte** (Blob ou build).
3. O publicador recusa publicar quando `publicar.json` diverge das chaves da cópia do build: Blob e
   build carregam sempre o mesmo arquivo, e quem vence pela versão não muda o que está ligado.

**Consequências.** Deploy nunca apaga visão (travado em `tests/unit/etiquetas/leitor.test.ts`,
"deploy depois da publicação"). A primeira negativa deste ADR ("Blob fora do ar apaga as visões que
o dono ligou") também deixa de valer: com o Blob fora, vale o `publicar.json` do último deploy — o
"último valor conhecido" do § 7. **Custo novo, conhecido:** desligar às pressas é publicar com a
chave em `false`; a cópia do build no ar continua dizendo `true` até o próximo deploy, e se o Blob
cair nessa janela a visão volta. Mudar uma chave exige compilar (o cadastro do TSE precisa estar na
máquina de quem compila), como já exigia mudar uma classificação.

Spec: [025, RF-253](../../specs/025-visoes-editoriais/spec.md); emenda correspondente nos RF-228 e
RF-231 da [spec 024](../../specs/024-etiquetas-editoriais/spec.md).

## Cross-refs

- [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — governança e as condições
  do § 2; este ADR é o mecanismo, aquele é o limite.
- [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md) — `editorial/derivados/trajetoria-camara.json`.
- [ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md) — as visões cujo
  aparecimento o portão de cobertura controla.
- [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md) —
  `editorial/senado/` e `editorial/derivados/alinhamento-camara.json`.
- [ADR-0001](0001-edge-config-no-read-path.md) — banco nunca no read path; Edge Config é o caminho
  quente da apuração e não recebe etiqueta.
- [ADR-0032](0032-detalhe-municipal-vercel-blob.md) — Blob como segundo destino e ponto único de
  caminho (`lib/blob/paths.ts`); [ADR-0011](0011-cadencia-60s.md) — a cadência de 60 s.
- [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — anulado fora da base do portão.
- `lib/blob/candidatos.ts` (molde do leitor), `lib/blob/deputado-uf.ts:193` e
  `lib/blob/uf-detail.ts:97` (cadência de 60 s), `lib/blob/write.ts:11-18` (`cacheControlMaxAge`),
  `data-pipeline/candidatos-publish.ts` (molde do publicador), `scripts/_vigia-env.ts` (lista
  branca), `tests/unit/edge-config/limiar-nacional.test.ts` (folga do payload).
- `docs/operations/deployment.md:28-31` — congelamento de 04/10.
- `docs/architecture/folder-structure.md` — emenda pendente (`editorial/`, `lib/etiquetas/`,
  `lib/data/etiquetas/`).
- Constituição § 2 (condições da classificação editorial), § 3 (RNF-007a, `server-only`), § 7
  (degradação graciosa), § 9 (Blob é Vercel: a stack segue 100% Vercel).
- Specs afetadas: 006, 016, 017, 004/005 (superfícies que exibem etiqueta), 018 (`/candidatos`) e a
  spec de etiquetas editoriais, a criar.
