---
id: ADR-0058
title: Trajetória na Câmara dos candidatos a Deputado Federal — fonte Câmara, casamento por nome + nascimento só em memória; entrega dividida (cálculo e exportação offline agora, banco depois de 25/10)
status: accepted
date: 2026-09-29
amends: 0039
---

# ADR-0058 — Trajetória na Câmara dos candidatos a Deputado Federal

## Status

Aceito (2026-09-29) — execução autorizada pelo dono; revisão final do dono pendente.

Este ADR **porta e atualiza** o texto redigido em 26/09/2026 no worktree
`agent-acd2b01db6bdcd962` sob o número 0053, que **colidia** com o ADR-0053 já ocupado na `main`
([ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md), anulado fora da disputa). Ele
nunca foi commitado com aquele número; nasce aqui como 0058. Duas coisas mudam em relação ao
texto de 26/09: (1) o requisito é **RF-214**, não RF-200 (item de Cross-refs); (2) a Decisão ganha
o item 5, que **divide a entrega** — a parte que grava no banco fica estacionada até depois de
25/10. O mecanismo de casamento (itens 1–4) é o do texto original.

Emenda o [ADR-0039](0039-portal-dados-abertos-tse-identidade-candidatura.md) (recorte de PII) com
uma exceção estrita, como o ADR-0039 passa a registrar em nota própria.

## Contexto

O dono do produto pediu para marcar, entre as 7.791 candidaturas a Deputado Federal (cargo 6) de
2026, quem concorre a um novo mandato e quem é estreante — um sinal que hoje não existe em lugar
nenhum do pipeline. O campo que deveria dar essa resposta, `ST_REELEICAO`, do arquivo
`consulta_cand_complementar_2026.zip`, vale `#NE` em **100%** das 7.791 linhas de cargo 6 (medido
em 26/09/2026 no arquivo gerado pelo TSE em 12/09/2026; a mesma ausência foi medida em 29/09 em
**todos** os cargos, no cache `build/tse-archives`) — o TSE simplesmente não publica esse dado para
2026, e não é um problema de leitura, é ausência na fonte.

A alternativa óbvia — casar candidato com deputado por CPF — não existe: o TSE não publica CPF
utilizável em nenhuma superfície pública do cadastro de candidaturas (o ADR-0039 já exclui o campo
do pipeline por PII), e o Portal de Dados Abertos da Câmara publica `cpf` **vazio em 100%** das
7.889 pessoas de `deputados.csv` (histórico completo desde 1826). As duas fontes — TSE e Câmara —
não compartilham nenhuma chave numérica estável. O que sobra em comum entre elas é nome civil e
data de nascimento, e só isso.

Duas restrições adicionais moldaram a decisão. Primeiro, o recorte de PII do ADR-0039 exclui
explicitamente `DT_NASCIMENTO` de qualquer estrutura do pipeline — mas casar por nome sozinho junta
homônimos (o Brasil tem dezenas de "José da Silva" na Câmara ao longo de dois séculos), o que
tornaria a classificação não confiável. Segundo, a API da Câmara é uma dependência externa nova,
fora do Portal de Dados Abertos do TSE já qualificado pelo ADR-0039, com timeouts observados acima
de 25s e sem garantia de estabilidade de contrato.

Uma terceira restrição apareceu em 29/09, ao tentar levar o worktree para a `main`, e é de
calendário, não de desenho. A véspera roda `pnpm candidatos:import` **contra produção** em 03/10
(`docs/operations/vespera-03-10.md:90`). O import do worktree grava duas colunas novas em
`candidatos` (`trajetoria_camara`, `camara_ids`) que só existem depois da migration 0011 — e a
0011 não está aplicada em produção. Mesclar o worktree inteiro antes de 03/10 significa que o import
de véspera tenta gravar colunas inexistentes e quebra no dia em que a lista de candidatos precisa
estar íntegra. Aplicar a migration na semana da eleição para evitar isso troca um risco por outro
(DDL em produção sob congelamento de deploy, `docs/operations/deployment.md:28-31`) por um sinal
que a tela consegue ter sem tocar no banco.

## Decisão

**1. Segunda fonte externa: o Portal de Dados Abertos da Câmara dos Deputados.**
`https://dadosabertos.camara.leg.br/arquivos/deputados/csv/deputados.csv` (todos que já exerceram
mandato desde 1826, 7.889 pessoas) e `GET /api/v2/deputados` (quem está em exercício hoje), com
cache em `build/camara/`.

**2. Casamento por nome civil normalizado + data de nascimento.** Primeiro por igualdade exata da
chave `(nome normalizado, data ISO)`; sem casamento exato, por uma regra aproximada aplicada **só**
entre pessoas nascidas no mesmo dia, que casa se qualquer uma de três condições vale — (a) tokens
de nome em comum acima de um limiar proporcional ao tamanho dos dois nomes, cobrindo sobrenome de
casada acrescentado ou removido; (b) primeiro e último token do nome iguais, cobrindo nome do meio
abreviado na Câmara; (c) o nome parlamentar da Câmara é igual ao nome de urna ou ao nome social do
TSE, cobrindo quem usa nome social diferente do civil registrado. As três regras e o limiar exato
estão em `casaAproximado` (`data-pipeline/trajetoria-camara.ts` no worktree), que é a fonte de
verdade sobre a mecânica — este ADR não a duplica.

**3. Quatro categorias internas, três rótulos públicos.** O resultado do casamento é uma de quatro
categorias — `em_exercicio` (deputado em exercício hoje), `legislatura_atual` (exerceu na 57ª
legislatura, 2023–2027, sem estar em exercício), `mandato_anterior` (exerceu só em legislatura
anterior) ou `estreante` (nunca exerceu). As quatro são preservadas no dado, para auditoria. O
rótulo público, na categoria editorial "Trajetória no cargo", é decisão do dono de 29/09:

| Categoria interna | Rótulo público |
|---|---|
| `em_exercicio` + `legislatura_atual` | Tenta a reeleição |
| `mandato_anterior` | Volta ao cargo |
| `estreante` | Estreante no cargo |

A junção das duas primeiras categorias tem uma consequência que este ADR registra como vantagem
concreta: a divisão `em_exercicio` × `legislatura_atual`, que a conferência de paridade abaixo
**não** validou de forma independente, não chega a nenhum rótulo público. Rótulos e sua governança
são da camada de etiquetas editoriais
([ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md)), não deste ADR.

**4. Ausência é "não calculado", nunca `estreante`.** Se o histórico da Câmara não puder ser
obtido, o cálculo aborta antes de produzir saída; o operador só contorna com decisão explícita
(`--sem-trajetoria` no caminho de import), caso em que o resultado fica **ausente** — porque
omissão de dado não é evidência de estreia. Um consumidor que não encontra um `sqcand` no arquivo
exportado trata como "não calculado".

**Exceção transitória e estrita ao corte de PII do ADR-0039**: `DT_NASCIMENTO` e
`NM_SOCIAL_CANDIDATO` do TSE são lidos em memória por **uma única função**, `trajetoriaDaLinha`
(`data-pipeline/candidatos-parse.ts` no worktree), viram argumento de `calcularTrajetoria` e morrem
ali — não entram em `CandidatoRow`, não são persistidos, não são logados, **não aparecem em nenhum
arquivo exportado**. A guarda de nome de coluna herdada da migration 0008 (reprova qualquer coluna
cujo nome case `cpf|email|titulo|nascimento`) continua valendo. O restante do recorte de PII do
ADR-0039 — CPF, e-mail, título de eleitor nunca lidos, ocupação e ficha completa fora do pipeline —
não muda. Sob a divisão do item 5, a invariante é "um único ponto de leitura"; em qual arquivo
esse ponto mora depois de a leitura sair do import é detalhe da renumeração do worktree, não
exceção nova.

*Acréscimo de 29/09, após a auditoria constitucional:* os **caches brutos das fontes oficiais
públicas** — `build/camara/` (arquivos da Câmara, que trazem `dataNascimento`), `build/senado/`
(respostas do Senado) e `build/tse-archives/` (cadastro do TSE, com `DT_NASCIMENTO`) — ficam **só
na máquina local**, sob `build/`, que é ignorado pelo git (`.gitignore`) e pela Vercel
(`.vercelignore`): nunca versionados, nunca publicados, nunca lidos pelo site. São cópia do dado
público na forma em que a fonte o distribui, não dado "gravado pelo produto" no sentido da
constituição § 5, e ficam fora da exceção deste item. O que **sai** deles, porém, segue a regra
inteira: nenhum arquivo derivado, exportado ou gerado a partir desses caches pode carregar data de
nascimento (nem CPF, título de eleitor ou e-mail) — a lista branca dos exportadores e os
testes de varredura dos arquivos em `editorial/derivados/` travam isso.

**5. Entrega dividida.**

*Entra agora (antes de 04/10):* o **cálculo puro** — normalização de nome, `casaAproximado`,
`calcularTrajetoria`, leitura da fonte da Câmara com cache, harness de paridade e testes — e a
**exportação offline** `data-pipeline/trajetoria-exportar.ts`, que roda **sem banco** e escreve o
arquivo estático versionado `editorial/derivados/trajetoria-camara.json`. Formato
`{ "<sqcand>": { "t": "<categoria interna>", "camara_ids": [...] } }` mais a contagem do universo
de candidaturas de cargo 6 (7.791), para que um consumidor consiga afirmar "este `sqcand` está fora
do arquivo" em vez de inferir "estreante" por ausência. Chave `sqcand` sempre texto. O arquivo é
insumo da camada de etiquetas editoriais (regra derivada de trajetória).

*Estacionado até depois de 25/10, e só com autorização expressa do dono:* a **migration 0011**
(`data-pipeline/migrations/0011_candidatos_trajetoria_camara.ts`), as colunas correspondentes em
`schema.ts`, a **integração no import** (`candidatos-import.ts` gravando as colunas) e o
**backfill** (`trajetoria-camara-backfill*.ts`). Ficam no branch do worktree, renumerado e
rebaseado, sem entrar na `main`. Enquanto isso, o import de 03/10 executa **exatamente** o mesmo
código e o mesmo schema que já estão em produção. O desenho original da persistência —
`candidatos.trajetoria_camara text` e `candidatos.camara_ids integer[]`, `NULL` fora do cargo 6 —
continua sendo o alvo da perna estacionada e não é reaberto aqui.

## Paridade medida em 29/09/2026

O texto de 26/09 afirmava paridade **7.791/7.791** contra o script de referência independente
`alinhamento-governo-camara/cruzar.py`, com os quatro totais. A auditoria de proveniência de 29/09
achou que a afirmação estava mal ancorada: `cruzar.py` grava `resultado.json` com **três**
categorias (`cruzar.py:47-57`), não quatro, e o CSV de referência (`referencia_trajetoria.csv`) não
é a saída dele. A conferência foi refeita nessa base, com `cruzar.py` rodando em diretório de
trabalho isolado e as categorias do TS colapsadas para as três da referência. Resultado:

- **7.791 de 7.791 iguais na categoria colapsada** — `em_exercicio` + `legislatura_atual` →
  `reeleicao`, `mandato_anterior` → `retorno`, `estreante` → `estreante`.
- Os **ids da Câmara** e o **modo de casamento** (exato ou aproximado) também coincidem nas 7.791.
- Totais do cálculo TS por categoria interna: `em_exercicio` 439 · `legislatura_atual` 70 ·
  `mandato_anterior` 197 · `estreante` 7.085.
- **O que a paridade não prova**: a separação `em_exercicio` × `legislatura_atual` (439 × 70) **não
  é verificada de forma independente** — a referência só distingue `reeleicao`. Os dois números
  são o que o cálculo TS produz a partir do mesmo `deputados_em_exercicio.json`, não um segundo
  parecer. Como o item 3 junta as duas no rótulo público, o defeito possível é interno e de
  auditoria, não de tela.
- A paridade também não é independência de método: `cruzar.py:37-43` reimplementa **as mesmas três
  regras aproximadas** (interseção de tokens, primeiro e último token, nome parlamentar igual ao de
  urna ou social) sobre a mesma chave `(nome normalizado, nascimento)`. É independência de **código**,
  não de **desenho** — uma falha sistemática da especificação de casamento passaria pelas duas
  implementações. O que a paridade elimina são erros de implementação do lado TS (normalização,
  desempate, categorização), não a possibilidade de o desenho errar.

## Alternativas rejeitadas

- **`ST_REELEICAO` como sinal.** Vazio em 100% dos casos — não é sinal, não existe.
- **`DS_OCUPACAO = "DEPUTADO"` como proxy de mandato federal.** Não distingue deputado
  estadual/distrital de federal: 64 candidatos medidos declaram essa ocupação e não têm registro na
  Câmara — são deputados estaduais/distritais, corretamente classificados como `estreante` por esta
  decisão.
- **Casar só por nome, sem data de nascimento.** Rejeitada por juntar homônimos sem nenhum segundo
  sinal — o histórico da Câmara cobre dois séculos e nomes civis se repetem.
- **Persistir a data de nascimento para permitir recálculo futuro sem reimportar o TSE.**
  Rejeitada: violaria a constituição § 5 sem necessidade — o recálculo, quando preciso, reimporta o
  CSV do TSE, que já é reimportado na cadência do
  [ADR-0040](0040-publicabilidade-candidatura-fail-closed.md).
- **Mesclar o worktree inteiro antes de 04/10.** Rejeitada pelo calendário do item de Contexto: o
  import de 03/10 quebraria contra um schema sem as colunas novas.
- **Aplicar a migration 0011 em produção antes de 03/10, para o import do worktree funcionar.**
  Rejeitada: DDL em produção na semana da eleição, com o import (caminho crítico da lista de
  candidatos) alterado no mesmo passo, para entregar um sinal que um arquivo estático entrega sem
  tocar em nada que já está no ar.

## Consequências

**Positivas**:
- Fecha um gap de produto que nenhuma fonte do TSE resolve sozinha, usando dado público e factual
  (quem já exerceu mandato), aplicado igualmente a todos os 7.791 candidatos de cargo 6 —
  neutralidade por construção (constituição § 2).
- **Zero risco para o import de 03/10 e para o banco de produção**: a perna que grava está fora da
  `main`, e a perna entregue não abre conexão de banco.
- A conferência de paridade agora diz o que prova e o que não prova, em vez de um número redondo
  sem proveniência.
- A auditoria fica embutida no dado: `camara_ids` no arquivo exportado permite reconstruir, a
  qualquer momento, por que uma candidatura recebeu a categoria que recebeu.
- Dos 513 deputados em exercício, 498 aparecem em alguma candidatura de 2026 (437 concorrendo de
  novo a Deputado Federal); os 15 restantes não constam do cadastro do TSE — consistente com
  decisão de não concorrer, não com falha de casamento (medição de 26/09, não repetida em 29/09).
- O arquivo estático é versionado no git e revisável por diff, no mesmo repositório da camada de
  etiquetas que o consome.

**Negativas**:
- **Falso "estreante" é possível.** Quando o nome civil E o nome de urna/social divergem totalmente
  do nome parlamentar e só a data de nascimento coincide com outra grafia não capturada pelas três
  regras aproximadas, o casamento falha e a candidatura vira `estreante` mesmo tendo mandato
  anterior. Risco residual, não eliminado, auditável via `camara_ids` (ausência de id é o próprio
  sinal do problema), mas não detectável sem investigação manual candidato a candidato. A paridade
  de 29/09 não o reduz: a referência usa a mesma especificação de casamento.
- **Dependência de uma API externa instável.** Timeouts acima de 25s foram observados contra
  `dadosabertos.camara.leg.br`; mitigado por cache em `build/camara/` e por validação de contagem
  antes de gravar (a paginação da lista "em exercício" é tratada como erro fatal, não como lista
  parcial silenciosa), mas a dependência em si não desaparece.
- **O arquivo exportado é um retrato na data da exportação.** Posse de suplente muda quem está em
  exercício a qualquer momento; a categoria não se corrige sozinha sem nova execução do exportador.
  Um suplente empossado depois da exportação aparece como `estreante` ou `mandato_anterior` no
  arquivo e passaria a `em_exercicio` só na próxima exportação — e, ao contrário do que o desenho
  do banco permitiria, não existe reimport automático que a refaça: a atualização é manual e
  disparada por alguém.
- **Duas fontes de verdade da trajetória até a perna do banco entrar** (depois de 25/10, se
  autorizada): o arquivo estático serve as etiquetas; `candidatos` no Postgres e as fatias de
  identidade de `/candidatos` não carregam o campo. Quem consultar o banco não encontra a trajetória.
- **A perna estacionada envelhece no branch.** Migration, `schema.ts`, integração no import e
  backfill ficam fora da `main` por quase um mês, com outros agentes mudando `candidatos-import.ts`;
  o rebase de W5 pode ser não trivial.
- **Preenchimento em produção, quando vier, exigirá backfill dedicado, não reimportação cega.** Um
  reimport completo do cadastro de candidaturas zeraria `foto_ok` e poderia regredir
  `situacao_julgamento` em relação ao estado já presente desde o cache de 12/09 — o backfill precisa
  atualizar **só** `trajetoria_camara` e `camara_ids`.
- **A junção das duas categorias no rótulo público esconde uma diferença real**: quem está em
  exercício e quem exerceu na legislatura e saiu recebem o mesmo "Tenta a reeleição". É decisão do
  dono e semanticamente defensável (ambos disputam novo mandato tendo exercido este), mas a
  distinção existe e só é legível no dado interno.

## Cross-refs

- [ADR-0039](0039-portal-dados-abertos-tse-identidade-candidatura.md) — define o recorte de PII
  geral que esta decisão emenda com uma exceção estrita e transitória (nascimento e nome social só
  em memória, nunca persistidos). Recebe nota de emenda apontando para este ADR.
- [ADR-0040](0040-publicabilidade-candidatura-fail-closed.md) — cadência de reimportação do cadastro
  de candidaturas, relevante para o backfill estacionado.
- [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — o número que o texto de 26/09
  ocupava no worktree; citado aqui só para registrar a renumeração.
- [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — governança das etiquetas
  editoriais; define o rótulo público "Trajetória no cargo" e as condições para exibi-lo.
- [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) — onde o arquivo
  exportado é compilado, publicado e juntado por `sqcand`.
- [ADR-0062](0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md) —
  usa os `camara_ids` deste arquivo como ponte entre candidato e `deputado_id` do alinhamento.
- Spec [018 — Identidade de candidatura](../../specs/018-identidade-candidatura/spec.md),
  **RF-214** — o requisito funcional que esta decisão implementa. RF-214 é numerado **fora da faixa
  original da spec** (018 usava RF-140..152) porque é emenda de 26–29/09/2026. A versão de 26/09
  usava RF-200 por ser então o primeiro número livre acima de RF-199; **essa justificativa morreu**:
  RF-200..RF-213 já estão ocupados na `main` por outras specs (`docs/_meta/traceability.md`), e
  RF-214 é o primeiro livre. O RF ainda **não existe** em nenhuma spec — a emenda à spec 018 que o
  cria é trabalho pendente (delegação a `spec-syncer`/`spec-implementer`).
- `data-pipeline/trajetoria-camara.ts` (`casaAproximado`, `calcularTrajetoria`) — a mecânica exata do
  casamento (normalização de nome, as três regras aproximadas, o limiar) e a categorização por
  precedência.
- `data-pipeline/trajetoria-camara-paridade.ts` — harness da conferência de paridade.
- `data-pipeline/candidatos-parse.ts` (`trajetoriaDaLinha`) — o único ponto do projeto que lê
  `DT_NASCIMENTO` e `NM_SOCIAL_CANDIDATO` do TSE.
- `data-pipeline/trajetoria-exportar.ts` e `editorial/derivados/trajetoria-camara.json` — perna
  entregue agora (a criar na renumeração).
- `data-pipeline/migrations/0011_candidatos_trajetoria_camara.ts`,
  `data-pipeline/trajetoria-camara-backfill*.ts` — perna estacionada.
- `docs/operations/vespera-03-10.md:90` (import de produção em 03/10) e
  `docs/operations/deployment.md:28-31` (congelamento de deploy) — as restrições de calendário que
  motivam a divisão.
- `/Users/tiagomenna/Projetos/alinhamento-governo-camara/cruzar.py` e `referencia_trajetoria.csv` —
  a referência independente da paridade (projeto externo, fora do repositório).
- Constituição [§ 5](../../constitution.md) (sem PII coletada — a exceção transitória é o mecanismo
  de conformidade, não uma quebra dela) e [§ 2](../../constitution.md) (neutralidade — atributo
  factual aplicado igualmente a todos os candidatos, sem juízo de valor).
