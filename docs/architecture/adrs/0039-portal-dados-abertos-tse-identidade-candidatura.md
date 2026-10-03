---
id: ADR-0039
title: Portal de Dados Abertos do TSE (não a API REST do DivulgaCandContas) como fonte de identidade de candidatura — nome, foto e partido, com PII excluída por decisão de escopo
status: accepted
date: 2026-09-13
---

# ADR-0039 — Portal de Dados Abertos do TSE como fonte de identidade de candidatura

## Status

Aceito.

> **Nota 2026-09-29 — Emenda**: este ADR continua vigente e seu recorte de
> PII permanece a regra geral. O [ADR-0058](0058-trajetoria-camara-nome-nascimento-em-memoria.md)
> abre uma exceção estrita e transitória a esse recorte, para um único
> propósito: casar candidatos a Deputado Federal com o histórico da Câmara
> dos Deputados por nome civil + data de nascimento (RF-214, spec 018).
> `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO` passam a ser lidos em memória por
> uma única função (`trajetoriaDaLinha`), nunca persistidos, nunca logados,
> nunca escritos em arquivo exportado — ver o ADR-0058 para o mecanismo
> completo e a justificativa. A entrega foi dividida: o cálculo puro e a
> exportação offline (`editorial/derivados/trajetoria-camara.json`, sem banco)
> entram antes de 04/10; a integração ao import de candidatos e as colunas no
> banco ficam estacionadas até depois de 25/10.

## Contexto

Hoje `api/model/project.py:2810` e `:3275` escrevem `f"Candidato {id}"` como identidade de
candidatura em qualquer ponto do payload onde o nome não está disponível. Em 04/10/2026 isso
significa a tela dizendo "Candidato 13 lidera" — um número interno de sequência do banco, sem
nome, sem partido, sem foto, publicado como se fosse informação legível ao leitor. Não há hoje
nenhuma fonte de identidade de candidatura no pipeline: `snapshots` carrega `cand[].n` (número
de urna) e `cand[].vap`/`pvap` (votos), mas o EA20 de resultado não traz nome de candidato nem
partido por extenso — só o número. O gap é estrutural, não um defeito de um caminho de código:
não existe, em lugar nenhum do sistema, uma tabela que mapeie `(cargo, uf, número de urna,
sequencial) → nome, foto, partido`.

Duas fontes candidatas foram avaliadas em 2026-09-13, com medição contra a URL real, não
suposição de documentação:

**Portal de Dados Abertos** (`dadosabertos.tse.jus.br`, catálogo CKAN, arquivos hospedados em
`cdn.tse.jus.br`). O catálogo `package_show?id=candidatos-2026` devolve licença **cc-by**
("Creative Commons Atribuição") e 91 recursos. Os pacotes relevantes:

- `consulta_cand_2026.zip` — 3,0 MB, 20.939 linhas, 50 colunas, ISO-8859-1, separador `;`. A
  lista principal de candidaturas do país inteiro, um arquivo único.
- `consulta_cand_complementar_2026.zip` — 1,2 MB, mesmas 20.939 linhas, join 1:1 por
  `SQ_CANDIDATO` com o arquivo acima, zero linha faltando. Complementa a lista principal com
  campos de situação (ver ADR-0040).
- 28 ZIPs `foto_cand2026_<UF>_div.zip` — um por UF, fotos de divulgação de candidatura.

Os três conjuntos são regerados diariamente: `Last-Modified` HTTP em 12/09/2026 e `DT_GERACAO`
dentro do próprio CSV também em 12/09/2026, no dia em que esta pesquisa foi feita — convergência
entre o metadado de transporte e o metadado de conteúdo que dá confiança de que o arquivo é
realmente regerado, não apenas re-hospedado com timestamp de servidor desatualizado.

Três armadilhas medidas, que qualquer implementação precisa herdar como restrição, não como
nota de rodapé:

1. **O `last_modified` do próprio catálogo CKAN é metadado morto.** Ele registra 22/07/2026 para
   a lista de candidatos e 03/08/2026 para as fotos — ambas datas **anteriores** ao prazo de
   registro de candidatura (15/08/2026), o que prova que aquele campo não é atualizado a cada
   regeração do arquivo por trás dele. O frescor real (`fonte_ts` que a spec 018 deve expor ao
   leitor) tem que vir do header HTTP `Last-Modified` da resposta do arquivo, nunca do metadado
   do catálogo.
2. **`HEAD` devolve 403.** Para checar frescor sem baixar os 4,2 MB combinados a cada ciclo, o
   caminho medido e funcional é `GET` com `Range: bytes=0-1023`, que devolve `206 Partial
   Content` com o `Last-Modified` correto no header — o mesmo dado que um `HEAD` daria, se
   `HEAD` não estivesse bloqueado.
3. **Bloqueio de User-Agent na Akamai.** `cdn.tse.jus.br` e `dadosabertos.tse.jus.br` devolvem
   **403** para o User-Agent que `data-pipeline/_tse-common.ts:70` já usa em produção
   (`"AtlasMenna-ETL/0.1 (+menna@outsiders.digital)"`); sem header de UA (ou com UA genérico de
   navegador) os mesmos hosts devolvem 200/206. `curl` devolve 403 em qualquer configuração de
   UA testada — fingerprint de TLS, não de UA — então um 403 via `curl` **não prova** que o
   recurso saiu do ar; só prova que `curl` não passa. `resultados.tse.jus.br` (host da ingestão
   EA20 do dia D, spec 001) **não é afetado** — os três UAs testados contra ele devolvem 200.
   Consequência direta: **corrigir `_tse-common.ts` é pré-requisito** de qualquer implementação
   desta fonte, e a correção se propaga a todo consumidor do mesmo módulo compartilhado —
   `historical-import.ts`, `eleitorado-import.ts`, `zonas-import.ts` — que herdariam o mesmo 403
   se algum dia apontassem para `dadosabertos.tse.jus.br`/`cdn.tse.jus.br` em vez de
   `resultados.tse.jus.br`.

**API REST do DivulgaCandContas** (`divulgacandcontas.tse.jus.br/divulga/rest/v1`) foi
descartada como fonte de carga inicial por quatro razões, cada uma suficiente sozinha: (a) não é
documentada oficialmente — o que existe é engenharia reversa comunitária, sem contrato estável;
(b) não tem CORS, o que não importa para leitura server-side mas sinaliza que não foi desenhada
como API pública de consumo; (c) não tem endpoint de bulk por UF — é organizado por município,
o que exigiria milhares de requisições para montar a mesma lista que o CSV entrega em um único
download; (d) há relato público de 200-com-corpo-vazio para o ciclo eleitoral de 2026,
especificamente — um modo de falha silencioso que não dá para distinguir de "sem candidatos
naquele município" sem uma segunda fonte de verdade para comparar, o que anularia a vantagem de
usá-la.

**Recorte de PII — parte central desta decisão, não um apêndice de compliance.** O CSV de
50 colunas traz, junto dos campos de identidade, `NR_CPF_CANDIDATO`, `DS_EMAIL` e
`NR_TITULO_ELEITORAL_CANDIDATO`. Nenhum dos três deve ser mapeado para nenhuma estrutura
intermediária do pipeline, nem transitoriamente em memória além do escopo estrito do parser de
importação, e nenhum deve chegar a Postgres, Edge Config, Blob ou qualquer resposta HTTP —
constituição § 5 (sem PII coletada) não abre exceção para dado que o próprio TSE publica: dado
público de terceiro que identifica pessoa física ainda é PII quando o produto o republica. O
escopo de campos que ENTRAM no pipeline: nome (`NM_CANDIDATO`), nome de urna
(`NM_URNA_CANDIDATO`), número de urna, partido (sigla/número/nome), federação, coligação, cargo,
UF, situação de julgamento (ADR-0040) e foto. O escopo EXCLUI a ficha completa do candidato —
idade, ocupação, bens declarados, patrimônio — apesar de o CSV trazer parte desses campos
(`DS_OCUPACAO`, `DT_NASCIMENTO`): essa exclusão é decisão do dono do produto sobre superfície de
produto, não uma restrição legal adicional além do recorte de PII acima, e fica registrada aqui
como tal para que a próxima pessoa que olhar o CSV completo não presuma que "está disponível"
significa "deve entrar".

## Decisão

O Portal de Dados Abertos do TSE é a fonte de identidade de candidatura para 2026. A
implementação (spec 018, a criar) consome:

1. `consulta_cand_2026.zip` — nome, nome de urna, número, cargo, UF, partido, federação,
   coligação. **Duas chaves de junção, com papéis distintos:**
   - **`SQ_CANDIDATO` é a chave preferencial.** Global, estável, e presente nos DOIS lados:
     casa os dois CSVs do TSE entre si (D0) **e casa diretamente contra o payload do EA20** —
     `lib/tse/ea20-schema.ts:80` declara `sqcand: z.string()` **obrigatório** dentro de
     `cand[]`, com o comentário "sequencial único (usado para foto)"; `:58` repete em `vs[]`
     (vice/suplente). É também o que nomeia o arquivo de foto (`F<UF><SQ>_div.jpg`).
     Consequência prática: na noite da apuração, resolver foto e identidade por `sqcand`
     dispensa a função de resolução de colisão do ADR-0042 — por essa chave a colisão não
     existe.
   - **`(cargo, UF, número na urna)` é o fallback**, para quando só existe o número — o caso
     de `projections.candidato_id`, que é `integer` com semântica de número de urna. Não é
     única nem na fonte oficial; ver ADR-0042 para a regra de desempate.

   > **Correção 2026-09-13, antes de qualquer propagação.** A primeira redação deste item
   > afirmava que o `SQ_CANDIDATO` "nunca" servia para casar contra o EA20, "que não o
   > carrega". **É falso** — o schema do repositório declara `sqcand` como campo obrigatório
   > do candidato desde a spec 001. O erro importava: ele forçava todo o caminho ao vivo pela
   > chave que colide (ADR-0042) e escondia a rota mais simples. Corrigido em revisão, com o
   > schema lido, antes de o ADR ser commitado ou propagado a qualquer spec.
2. `consulta_cand_complementar_2026.zip` — join 1:1 por `SQ_CANDIDATO` contra o arquivo acima,
   fonte da situação de julgamento e publicabilidade (ADR-0040).
3. `foto_cand2026_<UF>_div.zip` — foto de divulgação, uma por candidato, servida ao leitor com
   atribuição "Fonte: TSE" (exigência da licença cc-by).

Reimportação é recorrente, não um carregamento único: os três conjuntos mudam diariamente até o
fechamento do prazo de julgamento e continuam mudando depois por substituição/recurso (ver
ADR-0040 para a cadência exata). O frescor exibido ao leitor (`fonte_ts`) vem do header
`Last-Modified` da resposta HTTP de cada arquivo — nunca do metadado do catálogo CKAN, que está
comprovadamente desatualizado (ver Contexto, armadilha 1) — obtido via `GET` com `Range:
bytes=0-1023` para checagem barata de frescor sem baixar o arquivo inteiro a cada verificação.

A precedência entre esta fonte e o EA20 é absoluta e unidirecional: **o EA20 é a autoridade na
noite da apuração; o CSV nunca sobrepõe o EA20**. O CSV serve o grid pré-eleição (nomes, fotos,
partidos, antes de qualquer voto existir) e continua servindo identidade durante a apuração, mas
quem está concorrendo é definido por quem aparece em `cand[]` do boletim — se uma substituição
de última hora entrar no EA20 e ainda não tiver propagado ao CSV (ou vice-versa: sair do CSV por
indeferimento mas continuar aparecendo em `cand[]` porque a urna já foi programada), o EA20
decide quem tem linha de voto na tela; o CSV decide, no máximo, se essa linha tem nome/foto ou
cai no fallback de hoje.

## Alternativas rejeitadas

- **API REST do DivulgaCandContas como fonte primária ou única.** Rejeitada pelas quatro razões
  do Contexto — sem documentação oficial, sem CORS, sem bulk por UF, relato de 200 vazio em
  2026. Fica registrada como possível fonte **complementar** de verificação pontual no futuro,
  nunca como carga inicial.
- **Raspar o site público de consulta de candidaturas (`divulgacandcontas.tse.jus.br`, a UI, não
  a API) via scraping HTML.** Não avaliada em profundidade porque o Portal de Dados Abertos já
  resolve o problema com um contrato mais estável (CSV versionado, licença explícita) — raspar
  HTML herdaria fragilidade a mudança de layout sem nenhum ganho de cobertura sobre o CSV.
- **Publicar `NR_CPF_CANDIDATO`/`DS_EMAIL`/`NR_TITULO_ELEITORAL_CANDIDATO` mascarados
  (ex. últimos 4 dígitos) em vez de omitir por completo.** Rejeitada sem meia medida: a
  constituição § 5 não distingue PII mascarada de PII plena para efeito de "sem PII coletada" —
  mascarar ainda é coletar e transformar, e não há requisito de produto que precise desse dado
  nem mascarado.
- **Importar a ficha completa (ocupação, bens, patrimônio) desde já, já que o CSV já traz.**
  Rejeitada por decisão de escopo do dono do produto: aumenta superfície de manutenção e de
  exposição de dado sensível-adjacente sem RF que a exija hoje. Pode ser revisitada em spec
  futura se um RF concreto pedir.

## Consequências

**Positivas**:
- Fecha o gap estrutural que hoje faz `api/model/project.py:2810`/`:3275` recorrerem a
  `f"Candidato {id}"` — a partir da spec 018, toda identidade publicada tem nome, partido e,
  quando disponível, foto, em vez de um número interno de sequência.
- Licença cc-by permite republicação com atribuição simples ("Fonte: TSE"), sem necessidade de
  acordo de uso adicional nem de análise jurídica de licenciamento — ao contrário do que uma
  fonte de dado eleitoral de terceiro (ex. Datafolha, spec 014) exigiria.
- Fonte oficial única para nome/foto/partido elimina divergência entre o que a tela de resultado
  (baseada em EA20) e a tela de identidade (baseada nesta fonte) chamam de "quem é o candidato
  13" — ambas descendem, em última instância, do mesmo órgão e do mesmo ciclo eleitoral.
- O recorte de PII (nenhum CPF, e-mail ou título de eleitor no pipeline) resolve preventivamente
  o risco de vazamento de dado sensível de terceiro antes que qualquer linha de código exista —
  mais barato que auditar depois.

**Negativas**:
- **Duas fontes de dado de candidato (EA20 + CSV) que podem divergir durante a apuração**, e a
  regra de precedência (EA20 manda em "quem tem linha", CSV manda em "que nome/foto aparece
  nessa linha") precisa ser implementada com disciplina — um bug de junção pode facilmente
  atribuir o nome errado ao número de urna certo, ou vice-versa, e nenhum teste deste ADR
  garante isso; cabe à implementação da spec 018.
- **Bloqueio de User-Agent na Akamai é uma dependência de correção fora do escopo desta spec**:
  `data-pipeline/_tse-common.ts:70` precisa mudar antes que qualquer chamada a
  `dadosabertos.tse.jus.br`/`cdn.tse.jus.br` funcione, e essa correção toca módulos
  compartilhados (`historical-import.ts`, `eleitorado-import.ts`, `zonas-import.ts`) que hoje
  não sofrem esse bloqueio porque apontam para `resultados.tse.jus.br`. Um ajuste malfeito no
  UA compartilhado poderia, em tese, introduzir regressão nesses três módulos por acoplamento
  não intencional — risco a vigiar na implementação, não mitigado por este ADR.
- **`Last-Modified` via `Range` é um proxy de frescor, não uma garantia de conteúdo novo**: o
  TSE pode regerar o arquivo com o mesmo conteúdo (ex. rodar o job diário sem nenhuma mudança de
  registro), e o `Last-Modified` avança mesmo assim — o sistema saberia que "o TSE tocou o
  arquivo hoje", não necessariamente "há candidatura nova ou alterada hoje". Distinguir as duas
  coisas exigiria comparar hash de conteúdo, não implementado nem exigido por este ADR.
- **91 recursos no catálogo, só 3 usados**: qualquer expectativa futura de "o Portal de Dados
  Abertos já cobre X" (bens, doações, prestação de contas) precisa ser verificada individualmente
  contra o recurso específico — a licença e a cadência medidas aqui valem para os três pacotes
  citados, não para o catálogo inteiro por extensão.
- **Sem verificação de que o CDN aceita o volume de chamadas diárias de checagem de frescor**
  (um `GET` com `Range` por ciclo de verificação, multiplicado pela cadência escolhida na
  implementação) — não medido, pendência operacional para a spec 018.

## Cross-refs

- [ADR-0040](0040-publicabilidade-candidatura-fail-closed.md) — decisão correlata e dependente:
  define qual subconjunto das 20.939 candidaturas deste CSV é publicável, usando o arquivo
  complementar citado aqui.
- [ADR-0032](0032-detalhe-municipal-vercel-blob.md) — precedente de payload composto por
  múltiplas fontes servidas ao cliente por um único fetch; a spec 018 deve avaliar se identidade
  de candidato cabe no payload de Edge Config existente (poucos KB por candidato) ou precisa do
  mesmo padrão de Blob usado para detalhe municipal, dependendo do volume final medido com foto
  incluída ou apenas referenciada por URL.
- Constituição § 1 (dado oficial intocável; regulatório — o TSE é a fonte, licença cc-by
  documentada explicitamente aqui), § 5 (sem PII coletada — recorte de campos é o mecanismo de
  conformidade), § 8 (transparência metodológica — `fonte_ts` exposto ao leitor, nunca o
  metadado morto do catálogo).
- Spec 018 (identidade de candidatura 2026 — nome, foto, partido), a criar: deve listar este ADR
  e o ADR-0040 no frontmatter `adrs:`.
- `data-pipeline/_tse-common.ts:70` — correção de User-Agent é pré-requisito de implementação,
  não coberta por este ADR.
- `api/model/project.py:2810`, `:3275` — pontos de origem do fallback `f"Candidato {id}"` que
  esta fonte substitui; a substituição em si é trabalho de implementação, fora do escopo deste
  documento.
