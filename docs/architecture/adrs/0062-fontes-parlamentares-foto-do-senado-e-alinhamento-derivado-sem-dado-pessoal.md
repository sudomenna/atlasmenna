---
id: ADR-0062
title: Fontes parlamentares — foto dos 27 senadores com mandato até 2031 (Senado Dados Abertos) e alinhamento ao governo derivado do projeto externo da Câmara, por lista branca e sem dado pessoal; casamento por nome e nascimento só em memória
status: accepted
date: 2026-09-29
---

# ADR-0062 — Fontes parlamentares: foto do Senado e alinhamento derivado da Câmara

## Status

Aceito (2026-09-29) — execução autorizada pelo dono; revisão final do dono pendente.

Um spike só de leitura (API do Senado: os 27 com mandato até 2031, os 54 atuais, disponibilidade de
data de nascimento e orientação do governo por votação) corre em paralelo a este ADR. Onde uma
decisão abaixo depende do resultado dele, o texto diz "condicionado ao spike" em vez de presumir.

## Contexto

As etiquetas do [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) e as visões do
[ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md) precisam de dois dados
que o TSE não publica. O primeiro é **quem ocupa hoje as 27 cadeiras do Senado que não estão em
disputa em 2026** (os senadores eleitos em 2022, com mandato até 2031), e por qual partido: sem isso
não existe hemiciclo de 81 cadeiras. O segundo é um **critério medido de relação com o governo** para
o deputado com mandato: a fração de votações nominais disputadas em que o voto dele coincidiu com a
orientação do governo.

O segundo já existe fora do repositório. O projeto
`/Users/tiagomenna/Projetos/alinhamento-governo-camara/` foi construído a partir da API de dados
abertos da Câmara (`dadosabertos.camara.leg.br/api/v2`): **871 votações nominais de plenário** no
universo (desde 2023 até 03/09/2026; 238 em 2023, 224 em 2024, 316 em 2025, 93 em 2026), 597 delas
"disputadas" (a bancada "Oposição" orientou o contrário do governo ou orientou obstrução). Foi
conferido contra os arquivos anuais da Câmara (37.012 votos presentes nas duas fontes, zero
divergência) e contra o Poder360 para 2023–24 (Câmara toda 72,6% contra 72%; PL 32,4% contra 30%; PT
97,5% contra 97%). A taxa das votações disputadas é a que separa apoio de consenso: no projeto, o PL
cai de 32% para 12% e o Centrão de ~75% para ~65% quando só as disputadas contam.

Esse projeto tem, porém, uma armadilha para quem o consome: a pasta `raw/` guarda o
`deputados.csv` da Câmara, que traz `dataNascimento` (é o que `cruzar.py` usa para casar candidato e
deputado), e o projeto mantém `votos.csv` com 354.597 votos individuais. Trazer a pasta inteira para
o repositório importaria dado pessoal e volume que nenhuma etiqueta precisa. Do lado do Senado o
problema é diferente: a fonte oficial é uma API que pode ser instável, e a foto precisa ser tirada
**já**, com data, em vez de lida a cada renderização.

## Decisão

**1. A foto do Senado é um arquivo estático, tirado agora, com data.** Um script de coleta offline
lê o **Senado Federal — Dados Abertos** (`legis.senado.leg.br/dadosabertos`; os endpoints exatos
ficam a cargo do script e são conferidos pelo spike) e grava
`editorial/senado/mandato-2031.json`: os **27 senadores cujo mandato termina em 2031**, com o partido
**atual de quem ocupa a cadeira hoje — suplente em exercício incluído**. Campos, por lista branca:
UF, código do parlamentar, nome, partido atual, condição (titular ou suplente em exercício), data da
foto e URL de origem. Nenhuma data de nascimento, documento ou contato. Invariantes verificados por
teste e **nunca ajustados em silêncio**: **exatamente 27**, **um por UF**, todo partido existe na
paleta. A **data da foto é mostrada na tela**. Uma segunda foto, `editorial/senado/mandato-2027.json`,
guarda os **54 atuais ocupantes das cadeiras em disputa**, para a visão de renovação. A foto tem de
ser refeita à mão quando o dono quiser — ela não se atualiza sozinha.

**2. O alinhamento entra por lista branca, e só o que a regra precisa.**
`data-pipeline/alinhamento-importar.ts` lê **apenas** `alinhamento.csv` do projeto externo e aceita
**somente** as colunas `deputado_id`, `votos_disputadas` e `taxa_alinhamento_disputadas`, mais a
**data de corte** (03/09/2026), informada explicitamente na chamada e gravada no resultado, não
inferida de arquivo. Grava `editorial/derivados/alinhamento-camara.json`. O importador **recusa**
qualquer entrada que traga coluna de data de nascimento ou CPF (`dataNascimento`, `cpf`), **nunca lê
`raw/`** e não abre `votos.csv`. O arquivo derivado registra também a fonte (o projeto e a data da
coleta, 26/09/2026), o corte e, recomendado, o hash do CSV de entrada — o projeto de origem não está
neste repositório e o arquivo derivado é o único elo de proveniência dentro dele.

**3. A regra usa `votos_disputadas`, não `amostra_pequena`.** O `amostra_pequena` do projeto de origem
marca menos de 30 votos válidos **totais** (14 deputados, em geral suplentes de passagem). A regra do
dono é menos de **30 votos em votações disputadas** — outro denominador. O importador leva
`votos_disputadas` justamente para que a regra (≥ 65% Base, ≤ 35% Oposição, entre → Independente, com
limiares e piso de 30 juntos em `lib/etiquetas/catalogo.ts`, [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md)
item 3) seja aplicada sobre o número certo. Usar a coluna `amostra_pequena` seria um erro silencioso.

**4. A junção do deputado passa pela trajetória, não por nome.** O candidato chega ao `deputado_id`
pelos `camara_ids` de `editorial/derivados/trajetoria-camara.json`
([ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md)), que já resolveu o casamento por
nome e nascimento. O alinhamento não carrega nome, partido nem nascimento; quem não tem `camara_ids`,
ou tem mais de um, ou não tem linha no alinhamento, cai no critério do partido.

**5. Casamento por nome e nascimento só em memória.** O casamento com a Câmara (ADR-0058) e, mais
tarde, com o Senado — para a trajetória de candidato a Senador e para ligar o ocupante atual de uma
cadeira em disputa ao candidato — lê data de nascimento em memória, por uma única função, sem
persistir, sem logar e sem escrever em nenhum arquivo exportado; é a mesma exceção estrita do
ADR-0039 e do ADR-0058, **condicionada ao spike** confirmar que a API do Senado expõe a data de
nascimento. Se não expõe, o casamento do Senado precisará de outro meio, a definir em spec, e este
ADR não o fixa.

## Consequências

**Positivas**:
- **Sem dado pessoal no repositório.** A foto do Senado tem só dado público de parlamentar (nome,
  partido, código); o alinhamento carrega três campos numéricos por `deputado_id`. Um teste que
  varre os arquivos gerados atrás de data de nascimento e CPF trava a regressão (mutação prevista no
  plano).
- **Critério medido e verificado por terceiros**, com a conferência com o Poder360, no lugar de
  presumir a posição do deputado pelo partido.
- **A lista branca e a recusa de colunas fecham o caminho** por onde a `raw/` — que tem
  `dataNascimento` — poderia entrar por engano.
- A regra de 30 votos disputados evita rotular por ruído (suplente de passagem), com o número certo.
- O arquivo estático torna o Senado independente da API oficial na renderização: nada muda se ela
  cair na noite da eleição.

**Negativas**:
- **A proveniência do alinhamento vive fora do repositório.** Se o projeto externo mudar, sumir ou
  for recalculado, o arquivo derivado fica órfão, com só os metadados e o hash como rastro. Não há
  como regerar o alinhamento a partir do repositório; trazer o método para dentro dele é trabalho
  posterior a 25/10.
- **O corte é 03/09/2026.** Votações de setembro e o comportamento mais recente de quem trocou de
  partido não estão incluídos; o projeto de origem registra o partido do **último voto** e o
  histórico de quem mudou carrega votos dados sob outro partido. O rótulo de "Relação" de um
  deputado que trocou de partido no fim da legislatura descreve o passado dele.
- **Só a Câmara é medida.** O critério é simétrico **dentro** de cada casa, não **entre** as duas: o
  deputado com mandato é rotulado pela sua taxa, o senador pelo partido (com exceção individual).
  Isso é uma assimetria metodológica real entre Câmara 2027 e Senado 2027 — a condição 7 do § 2
  exige "o mesmo critério para todos" —, e ela só se fecharia se a orientação do governo por votação
  existir para o Senado (o spike verifica) e alguém decidir medi-la, o que está fora do escopo desta
  entrega.
- **"Votar com o governo" não é "ser da base".** O projeto de origem diz isso, e a taxa das
  disputadas é a melhor aproximação de apoio, não uma definição dele. Limiares diferentes dariam
  outra composição (ADR-0059, Consequências).
- **Os 27 são um retrato.** A cadeira de um senador que seja eleito governador em 2026 passará a um
  suplente em 2027, e a foto seguirá dizendo o partido de quem a ocupa hoje — decisão do dono,
  registrada com nota na tela. Um senador que morra, renuncie ou tenha suplente empossado depois da
  foto também a desatualiza.
- **A invariante "exatamente 27" pode falhar por acaso legítimo** (vaga sem suplente empossado, por
  exemplo). A regra manda o teste **falhar**, não ajustar; isso obriga alguém a olhar, e o custo é
  ter alguém para olhar em 03/10.
- **Dependência de uma API externa que não controlamos** para a foto: mitigada por tirá-la agora.
  Além disso, as siglas de partido que o Senado usa nem sempre coincidem com as chaves da paleta do
  produto; o invariante "todo partido existe na paleta" detecta o descompasso, mas a correção é uma
  tabela de correspondência que ainda precisa ser escrita.

## Alternativas consideradas

- **Trazer o projeto de alinhamento inteiro para o repositório, `raw/` incluída.** Rejeitada: importa
  `dataNascimento` e 354.597 votos individuais que nenhuma regra usa.
- **Recalcular o alinhamento dentro do repositório a partir da API da Câmara.** Rejeitada pelo
  prazo (quatro dias) e porque a base existente já foi validada; fica como trabalho posterior a
  25/10 para tirar a proveniência de fora do repositório.
- **Usar a taxa geral de alinhamento, não a das disputadas.** Rejeitada no ADR-0059, com a evidência
  do PL (32% → 12%).
- **Digitar à mão os 27 senadores.** Rejeitada: a fonte oficial já tem partido e código, e
  transcrição manual troca um risco de instabilidade de API por um de erro de digitação sem prova.
- **Ler a API do Senado a cada renderização.** Rejeitada: dependência de rede no caminho de
  renderização, sem necessidade para dado que muda em escala de semanas.
- **Persistir a data de nascimento para recalcular sem reimportar.** Rejeitada, pelo mesmo motivo do
  ADR-0058: violaria a constituição § 5 sem necessidade.

## Cross-refs

- [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md) — `camara_ids`, a ponte entre
  candidato e `deputado_id`, e a exceção de PII em memória.
- [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — a regra 65/35/30, o corte de
  03/09/2026 e as condições do § 2.
- [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) — onde os
  arquivos derivados são compilados e publicados.
- [ADR-0061](0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md) — consome os 27 do
  Senado para o hemiciclo de 81.
- [ADR-0039](0039-portal-dados-abertos-tse-identidade-candidatura.md) — recorte de PII.
- `/Users/tiagomenna/Projetos/alinhamento-governo-camara/LEIAME.md` e `alinhamento.csv` — o método, a
  validação e as colunas de origem (projeto externo, fora do repositório).
- `docs/architecture/folder-structure.md` — emenda pendente para `editorial/senado/` e
  `editorial/derivados/`.
- Constituição § 2 (condição 7, critério simétrico), § 5 (sem PII) e § 8 (data da foto e corte
  visíveis na metodologia).
- Specs: 023 (Senado 2027, foto dos 27) e a de etiquetas editoriais (alinhamento, casamento), a
  criar.
