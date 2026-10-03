---
id: ADR-0020
title: Conformidade com a Res. TSE 23.751/2026 sem cadastro prévio, não o regime de "interessado cadastrado" de 2024
status: accepted
date: 2026-09-05
---

# ADR-0020 — Conformidade com a Res. TSE 23.751/2026 sem cadastro prévio, não o regime de "interessado cadastrado" de 2024

## Status

Aceito.

### Emenda 2026-09-11 — RF-010.3 recalibrado para cron por cargo (ADR-0035 D3)

**Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D3).** RF-010.3
recalibrado: com o cron por cargo (Presidente e Governador em invocações separadas,
`/api/ingest/[cargo]`), cada processo roda seu próprio rate limiter singleton
(`lib/tse/rate-limiter.ts`), e `TSE_MAX_RPS_DEFAULT` subiu de 30 para 50 — o pior caso de duas
invocações simultâneas no mesmo IP soma exatamente 100 rps, o teto documentado do TSE, não acima
dele. Antes do cron por cargo, um único ciclo cobria todos os cargos sequencialmente e 30 rps era a
margem de segurança adequada para um único processo. O teto de 100 rps/IP e a proibição de sondar
URL seguem exatamente como este ADR definiu.

## Contexto

A documentação interna escrita em 2026-05-17 (constituição § 1, `docs/reference/regulatory.md`, `docs/operations/runbook.md`, RF-010 da spec 001, backlog da S07) foi redigida antes de a resolução do pleito 2026 ser publicada, e assumiu por analogia com a Res. TSE 23.736/2024 que: (a) o AtlasMenna precisaria se **cadastrar previamente** como "interessado na divulgação" e ter esse cadastro **aprovado** antes da janela de apuração; (b) o TSE abandonaria o leiaute EA20 em favor de "um formato JSON novo" a ser definido em audiência pública técnica prevista para julho/2026; e (c) a resolução vigente para 2026 ainda não existia. As três premissas motivaram, respectivamente, RF-010 (cadastro como requisito bloqueante), um plano de refactor do parser para um formato ainda desconhecido, e um "watch" indefinido sobre a publicação da norma.

Uma pesquisa em fonte primária feita em 2026-09-05 (a 29 dias do 1º turno) e a leitura dos 9 PDFs oficiais de leiaute do TSE (convertidos em `tse_docs/txt/*.txt`, catalogados em `docs/reference/tse-2026-leiautes.md`) derrubam as três premissas:

1. **A resolução está publicada.** É a **Res. TSE nº 23.751/2026**, e a divulgação de resultados por terceiros é tratada no **Título III, Capítulo VI, arts. 264 a 269** (`tse_docs/txt/apresentacao-interessados-2026.txt:22-26`, slide oficial "Divulgação de Resultados — Eleições 2026", julho/2026, TSE/STI/CSELE/SETOT).
2. **Não existe cadastro prévio de "interessado na divulgação" para 2026.** O material oficial descreve as entidades que consomem os dados como "entidades interessadas na divulgação dos resultados" (`apresentacao-interessados-2026.txt:42-43,48-55,104-106`) e lista suas obrigações (infraestrutura própria, busca periódica de arquivos, não alteração de conteúdo, não majoração de preço) — em nenhum momento um processo de inscrição, aprovação ou homologação prévia junto ao TSE. O termo é descritivo ("quem se interessa em divulgar"), não um status administrativo a ser obtido. RF-010 e a constituição § 1, ao tratarem "cadastro aprovado" como pré-condição bloqueante, descrevem um requisito **inverificável** — não há onde consultar esse status porque ele não existe.
3. **O leiaute EA20 foi mantido**, e sempre foi JSON — a doc de maio confundiu "mudança de leiaute" com "mudança de formato de serialização". O que muda de fato é a **estrutura interna** do EA20 2026 vs. o que a spec 001 assumia (herdado, sem confirmação documental, de um formato hipotético com array `abr[]` por arquivo): o EA20 real de 2026 tem candidatos em hierarquia `carg[] → (fed[] | agr[].par[]).cand[]` e participação em três objetos de raiz `s`/`e`/`v`, nunca em `abr[]` (`docs/reference/tse-2026-leiautes.md` § 2, `tse-ea20-arquivo-de-resultado-unificado.txt:174-469`). O slide de julho/2026 também confirma isso do lado do TSE: "Arquivos JSON... EA20 – Arquivo de resultado unificado" segue listado como leiaute vigente, sem menção a substituição (`apresentacao-interessados-2026.txt:108-143`).

Além de derrubar essas premissas, o material oficial expõe **limites operacionais duros e não-negociáveis** do CDN do TSE (`apresentacao-interessados-2026.txt:213-228`, seção "Regras de consumo dos arquivos"):

- **Máximo de 100 requisições por IP por segundo**; violar gera **bloqueio de 10 minutos, renovado** a cada nova violação durante o bloqueio.
- Uma **requisição malformada (404)** "também pode haver bloqueio" — o limiar exato não é divulgado, e não há como testá-lo com segurança.
- **"Não é possível listar os arquivos"** — não existem índices; o caminho e nome de cada arquivo seguem uma padronização fixa (`docs/reference/tse-2026-leiautes.md` § 1) e o direcionamento de "o que mudou" só vem dos arquivos de acompanhamento EA14 (Brasil) e EA15 (UF/município), nunca de uma listagem de diretório.
- **Não há freeze de leiaute anunciado.** O slide não promete estabilidade de schema entre a publicação e o dia D; o próprio EA20 (10/07/2026) é o documento mais recentemente revisado dos 9, o que sugere leiaute ainda em ajuste fino às vésperas do simulado.
- **Confirmação separada, no schema do próprio EA20** (não no texto da resolução): `v.tv` (total de votos) se decompõe em `v.vvc` (votos a votáveis concorrentes) + `v.vb` (brancos) + `v.tvn` (nulos) + `v.vscv`; e `v.vvc` por sua vez se decompõe em `v.vv` (válidos) + `v.van` (anulados) + `v.vansj` (anulados sub judice) (`tse-ea20-arquivo-de-resultado-unificado.txt:463-468,1207-1246`). Isto é, o próprio leiaute — não uma seção específica da resolução que este ADR conseguiu localizar no material disponível — exige que qualquer consumidor trate válidos, anulados e anulados sub judice como componentes distintos de `vvc`, e que `vvc` seja o denominador correto de "votos a candidatos", não `tv`. **Não confirmado**: se este tratamento decorre também de um artigo específico da resolução (o material disponível — um slide de apresentação, não o texto integral da resolução — mostra art. 265 §1º sobre horário de liberação para Presidente e art. 267 §§2º–4º sobre infraestrutura/periodicidade/vedação de alteração, mas nenhum parágrafo visível tratando especificamente de válidos/sub judice/anulados). Quem redigir RF-010 deve tratar a obrigação de decompor `vvc` como um requisito de **schema**, e citar a resolução apenas pelos artigos efetivamente confirmados abaixo.

Artigos confirmados no material disponível (`apresentacao-interessados-2026.txt:22-71`):

| Artigo | Conteúdo confirmado |
|---|---|
| Arts. 264–269 (Título III, Cap. VI) | Capítulo que regula "Da Divulgação dos Resultados" |
| Art. 265 §1º | Divulgação do resultado do cargo Presidente liberada a partir das 17h de Brasília, para todas as UFs e exterior |
| Art. 267, caput | Dados ficam disponíveis em centro de dados do TSE até 4 de abril de 2028 (18 meses do 1º turno); distribuição às entidades interessadas por arquivo digital/programa de computador |
| Art. 267 §2º | Infraestrutura de comunicação com o centro de dados é responsabilidade da entidade interessada |
| Art. 267 §3º | Entidades devem buscar os arquivos periodicamente à medida que são atualizados, conforme os padrões da Justiça Eleitoral |
| Art. 267 §4º | **Veda** qualquer alteração de conteúdo dos dados distribuídos pela Justiça Eleitoral |
| Art. 268 | Veda majorar preço de serviços em razão dos dados fornecidos pelo TSE |
| Art. 269 | Descumprimento das exigências do capítulo impede o acesso da entidade ao centro de dados, ou causa desconexão |

Esse conjunto de fatos — norma publicada e sem cadastro, EA20 mantido mas reestruturado, limites de taxa e ausência de índice, sem freeze de leiaute — exige uma decisão explícita de arquitetura sobre como o AtlasMenna se declara ao TSE, como opera o cliente HTTP e onde a fronteira entre "dado oficial intocado" e "conteúdo derivado" fica registrada. Sem isso, o simulado de 15–17/09 corre o risco concreto de: usar um User-Agent que declara um cadastro inexistente (falso perante o TSE); rejeitar respostas válidas por um schema Zod `.strict()` que presume um leiaute que não existe; e, na pior hipótese, provocar um bloqueio de IP de 10 minutos por sondagem de URL malformada durante a única janela de teste disponível antes do dia D.

## Decisão

O AtlasMenna opera **sem cadastro prévio**, porque a Res. 23.751/2026 não prevê nenhum. O `User-Agent` enviado em toda requisição ao CDN do TSE (`lib/tse/client.ts:60`, constante `USER_AGENT`) **não declara** cadastro ou credenciamento — o valor anterior, `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)`, era uma afirmação falsa sobre um status que não existe, e é substituído por um formato honesto: `AtlasMenna/1.0 (+<url>; <contato>)`, identificando o projeto por nome, URL pública e um contato verificável, sem qualquer menção a cadastro. O texto exato do contato (`lib/tse/client.ts:60`, hoje `contato: pendente`) permanece **decisão humana pendente** — este ADR não a resolve, apenas fixa o formato e a proibição de reintroduzir a menção a cadastro.

A conformidade com os arts. 264–269 vira requisito verificável de RF-010 (reescrito na Fase 3 da S07, citando este ADR): não há "status de cadastro" a checar, mas há três obrigações operacionais checáveis por código e três limites técnicos a respeitar por engenharia.

O `User-Agent` enviado em toda requisição ao CDN (`lib/tse/client.ts:60`) foi atualizado em 05/09 para nome do produto, URL do domínio próprio e uma caixa de e-mail nele — identificação honesta do projeto, sem qualquer menção a cadastro. A decisão que faltava (o texto exato do contato) foi tomada em 05/09. **Atualização 03/10:** a caixa nunca existiu (o domínio nunca teve registro MX), então o contato não era verificável; o valor passou a `AtlasMenna/1.0 (+https://atlasmenna.online)`, sem e-mail.

`snapshots.payload` continua a guardar o envelope EA20 **cru e inalterado**, byte a byte como recebido do TSE — em cumprimento direto ao art. 267 §4º, que veda "promover qualquer alteração de conteúdo dos dados distribuídos pela Justiça Eleitoral". A projeção estatística (bootstrap, IC, `p_segundo_turno`) é **conteúdo derivado**, nunca gravado sobre o mesmo registro do dado oficial, e deve ser **inconfundivelmente rotulada como não oficial** em toda superfície onde aparece (constituição § 1, já exige "Não oficial. Fonte: TSE." no footer — este ADR não cria essa obrigação, apenas a ancora explicitamente ao art. 267 §4º como justificativa regulatória, não só editorial).

Os limites técnicos do CDN do TSE viram **invariantes de engenharia**, não recomendações:

- **Rate limiter de saída obrigatório** (`lib/tse/rate-limiter.ts`, já implementado nesta sprint) — `TSE_MAX_RPS` com default **30** req/s, um teto de segurança bem abaixo do limite documentado de 100 req/s por IP, absorvendo margem para relógio impreciso, retries e execução concorrente de múltiplas invocações do cron.
- **429/503 retryáveis, honrando `Retry-After`** — um bloqueio de 10 minutos não pode derrubar silenciosamente o ciclo de ingestão; o cliente precisa aguardar o tempo indicado e retomar, não desistir nem repetir imediatamente.
- **Proibição absoluta de sondar URLs adivinhadas** contra `resultados.tse.jus.br` ou `resultados-sim.tse.jus.br` — como "não é possível listar os arquivos" e um 404 malformado pode bloquear o IP com limiar não divulgado, toda URL requisitada precisa vir de um nome de arquivo derivado deterministicamente da padronização documentada (`docs/reference/tse-2026-leiautes.md` § 1) ou de um alvo confirmado por EA11/EA14/EA15 — nunca de tentativa e erro.
- **Envelope Zod em `.passthrough()`, nunca `.strict()`** — como não há freeze de leiaute anunciado e o EA20 já mudou de estrutura entre 2024 e 2026 sem aviso prévio equivalente a um changelog público, o schema precisa validar os campos obrigatórios que o AtlasMenna consome e tolerar campos desconhecidos sem rejeitar o arquivo inteiro.

Este ADR **versiona a constituição § 1 para a versão 1.1** (o preâmbulo da constituição, `docs/constitution.md:10`, exige "justificativa explícita registrada em ADR + atualização desta constituição com versionamento" para mudar um princípio). O texto atual do § 1 afirma cadastro obrigatório e resolução "a ser publicada"; a versão 1.1 deve refletir os fatos acima — norma publicada (Res. 23.751/2026, arts. 264–269), ausência de cadastro, EA20 mantido — e citar este ADR como origem da mudança. A reescrita em si (texto final do § 1, `last_updated`) é trabalho de outro agente nesta mesma janela; este ADR é a referência que ele deve usar.

## Consequências

**Positivas**:
- User-Agent honesto — o AtlasMenna deixa de declarar ao TSE um status de cadastro que nunca existiu, eliminando um risco reputacional e de conformidade que passaria despercebido até alguém no TSE checar o header.
- RF-010 passa a ser um requisito **verificável por código e teste** (rate limit, retry, envelope tolerante, proibição de sondagem, rótulo "não oficial") em vez de um estado administrativo que ninguém consegue consultar.
- A chore "cadastro TSE aprovado" (`docs/reference/risks.md`, linha "Cadastro TSE atrasado") **deixa de bloquear** a S07 e a `pre-prod-checklist.md` — não há aprovação a esperar, nem prazo administrativo a monitorar.
- `snapshots.payload` cru + projeção rotulada como derivada dá ao AtlasMenna uma defesa documentada e auditável contra qualquer questionamento de que o produto estaria "alterando" dado oficial do TSE (art. 267 §4º).
- Rate limiter, retry e proibição de sondagem já estavam implementados nesta sprint (Fase 0 do plano S07) por necessidade técnica — este ADR formaliza *por que* essas escolhas são obrigatórias e não apenas boas práticas, dando a elas peso de invariante arquitetural em vez de detalhe de implementação que um refactor futuro poderia relaxar sem perceber a motivação regulatória.

**Negativas**:
- **`TSE_MAX_RPS` só é calibrável nos simulados de 15–17/09 e 22–24/09** — o valor default (30) é uma estimativa de segurança, não uma medição; se o volume real de GETs por ciclo (~55 com granularidade UF, ver `docs/reference/tse-2026-leiautes.md` § 6) interagir mal com latência de rede real do CDN, só o simulado revela isso, e há apenas duas janelas de teste antes do dia D.
- **Risco residual de schema quebrar no dia D**: sem freeze de leiaute anunciado pelo TSE, o `.passthrough()` protege contra rejeição total do arquivo, mas não contra o TSE adicionar ou renomear um campo que o AtlasMenna efetivamente consome (ex.: `v.vvc`, `s.psa`) entre o simulado de 22–24/09 e a apuração real de 04/10 — nesse caso o pipeline aceitaria o arquivo (passthrough) mas extrairia um valor ausente ou desatualizado, silenciosamente, a menos que haja validação de campo-a-campo além do parse Zod. Este ADR não resolve esse risco, apenas o nomeia; mitigação (alertas de campo ausente, monitoramento de schema drift) fica para o `tse-parser-builder` decidir em sprint futura.
- O contato do User-Agent segue **pendente** — este ADR fixa o formato honesto, mas não o conteúdo; enquanto `contato: pendente` estiver no código, o header tecnicamente ainda não cumpre o espírito do formato definido aqui (identificação verificável), embora já não seja mais falso como o valor anterior.
- A afirmação de que válidos/anulados/anulados-sub-judice precisam ser tratados como componentes distintos de `vvc` está confirmada pelo **schema do EA20**, não por um artigo específico da resolução que este ADR conseguiu localizar no material disponível (um slide de apresentação, não o texto integral da Res. 23.751/2026) — quem reescrever RF-010 deve tratar essa obrigação como requisito de schema, não citar um parágrafo de resolução não confirmado.
- Versionar a constituição para 1.1 é um evento raro e visível — qualquer leitor de PRs antigos que assumia "cadastro obrigatório" como verdade estável do produto precisa ser avisado explicitamente (via changelog ou nota na retrospectiva da S07) de que a premissa mudou, não apenas o texto.

**Neutras**:
- Este ADR não determina o valor final calibrado de `TSE_MAX_RPS`, nem decide entre fan-out UF vs. zona (`docs/reference/tse-2026-leiautes.md` § 6, decisão humana em aberto) — trata apenas da postura regulatória e dos invariantes de segurança (teto bem abaixo de 100 req/s, retry honrando `Retry-After`, sem sondagem). Ajustes finos de throughput são decisão operacional pós-simulado.

## Cross-refs

- ADR-0018 (seis termômetros do hero 1T — decisão de denominadores por categoria já cita art. 267 §4º como justificativa para não normalizar cruzado; este ADR formaliza a leitura completa da resolução que aquele ADR usa pontualmente): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- Constituição § 1 (conformidade regulatória) — a ser versionada para 1.1 citando este ADR: [../../constitution.md](../../constitution.md)
- Constituição § 9 (stack 100% Vercel) e § 10 (append-only) — `snapshots.payload` cru e inalterado já é prática append-only preexistente; este ADR ancora a mesma prática também ao art. 267 §4º: [../../constitution.md](../../constitution.md)
- `docs/reference/tse-2026-leiautes.md` — fonte técnica dos limites de taxa, ausência de índice, estrutura real do EA20 (`vvc`/`vv`/`van`/`vansj`) e recomendação de fan-out
- `docs/reference/regulatory.md` — a ser reescrito inteiro por outro agente nesta janela, substituindo a premissa de cadastro obrigatório e EA20 obsoleto pelos fatos deste ADR
- `docs/reference/risks.md` — linha "Cadastro TSE atrasado" a fechar; novas linhas a abrir para rate limit/bloqueio de IP, 304 contando para o limite, ausência de índice (dependência de EA14/EA15), e ausência de freeze de leiaute
- Spec 001 (`docs/specs/001-ingestao-tse/spec.md`) — RF-010 a reescrever citando este ADR; escopo "Cadastro como 'interessado na divulgação' (Resolução 23.736/2024)" (`spec.md:29`) fica obsoleto
- `lib/tse/client.ts:46-60` — `USER_AGENT`, já ajustado nesta sprint para não declarar cadastro; este ADR formaliza a obrigação de mantê-lo assim
- `lib/tse/rate-limiter.ts`, `lib/tse/ea20-schema.ts` (`.passthrough()`) — implementações que este ADR eleva a invariante arquitetural
- `tse_docs/txt/apresentacao-interessados-2026.txt` — fonte primária da Res. 23.751/2026 e dos limites operacionais citados
