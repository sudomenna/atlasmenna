---
id: ADR-0043
title: Fase pré-eleição como campo próprio no payload, não derivada de `composition` nem de percentual apurado
status: accepted
date: 2026-09-13
---

# ADR-0043 — Fase pré-eleição como campo próprio, não derivada

## Status

Aceito. **Emendado pelo [ADR-0076](0076-placar-zerado-antes-do-primeiro-boletim.md) (2026-10-04):** o leiaute só-identidade de D7/D8 ("Quem está concorrendo", ordem por número na urna) foi substituído pelo leiaute normal de apuração zerado, com ordem sorteada; D1–D3, D5, D6 e "mede, cala" permanecem.

## Contexto

O dono do produto quer que as telas de apuração mostrem o placar **zerado com os dados reais dos
candidatos** — nome, foto, partido, número na urna — antes de 04/10/2026, em vez do texto de
espera atual. A objeção óbvia foi levantada explicitamente na sessão que motivou este ADR: um
placar zerado mostra a *forma* de um resultado, e a leitura natural de um leitor apressado é "a
apuração começou e ninguém pontuou ainda", não "a apuração ainda não começou". A decisão do dono do
produto foi mantida mesmo com a objeção nomeada. Este ADR registra **como fazer isso sem que a tela
minta** — não decide se vale a pena fazer (isso já foi decidido fora deste documento).

Um levantamento sobre o código em produção mostrou que um payload zerado — todos os campos de voto
e probabilidade em `0`, exatamente a forma que `EdgePayload`/`EdgePayloadUf` têm antes do primeiro
boletim do TSE — produz, hoje, sem nenhuma intervenção adicional, pelo menos cinco afirmações
falsas simultâneas na tela:

- **"Todas as unidades federativas estão com a apuração concluída."**
  (`components/blocks/RemainingPanel.tsx:186`) — a lista `pendentes` fica vazia quando `pct_apurado`
  de toda UF é `0`, e o componente lê isso como "nada falta", não como "nada começou". É o oposto
  exato do que o número quer dizer.
- **"Fulano vence no 1º turno"**, ao lado de um percentual de `0%`
  (`components/blocks/ChancesPanel.tsx:198`, alimentado por `EdgeCandidate.p_fecha_1t`) — o
  bootstrap do modelo, rodando sobre snapshots vazios, pode produzir qualquer probabilidade
  degenerada nas duas pontas; nada no componente distingue "o modelo calculou 0% de chance real" de
  "não há dado nenhum para calcular sobre".
- **Intervalo de confiança `[0,0; 0,0]`** publicado como se fosse uma estimativa
  (`components/blocks/BulletinPanel.tsx:106`, template de insight que lê
  `pct_projetado_lower`/`pct_projetado_upper`) — um IC95 de largura zero é, estatisticamente, o
  oposto de "ainda não sabemos nada"; é "temos certeza absoluta".
- **"Disputa entre 0 candidatos"**, ao lado de uma lista com 12 nomes visíveis
  (`components/atoms/badges/RaceTypeIndicator.tsx:64-73`) — o componente conta quantos candidatos
  cruzam `PCT_THRESHOLD_1T` em `pct_projetado`; com todo `pct_projetado = 0`, a contagem é
  estruturalmente zero, não importa quantos concorrem de fato.
- **27 UFs pintadas com a cor de identidade partidária do líder**, no modo "winner" do mapa nacional
  (`components/blocks/_NationalChoroplethMapImpl.tsx:209,215-219`) — a guarda que existe para "sem
  apuração ainda" (`const parcial = viewMode === "parcial"; if (parcial && row.pct_apurado === 0)
  return getCssVar("--map-uncounted")`, `:199-204`) só dispara em `viewMode === "parcial"`. Fora
  desse modo, `liderId` cai no fallback `row.top_candidatos?.[0]?.id ?? row.lider` (`:209`) — com
  `top_candidatos` presente e todo `pct = 0`, o primeiro item do array (ordem de inserção, não de
  votação) pinta a UF inteira como se aquele partido já a tivesse vencido.

Além desses cinco, há um sexto ponto estrutural: cinco carimbos `dado_ts`/`ts` diferentes
(nacional, por UF, por cargo) apareceriam ao lado de zero voto contado, com `HH:MM:SS` de precisão
de segundo — uma UI que já resolveu, no ADR-0038, a diferença entre "hora do cálculo" e "hora do
dado" continuaria mostrando as duas com a mesma autoridade visual de uma noite de apuração real,
mesmo quando o "dado" citado é a hora em que o time rodou o seed, não a hora de nenhum boletim do
TSE.

Nenhum desses cinco (seis) defeitos é bug de implementação — são a consequência lógica e correta do
código existente processando um payload com forma válida mas significado que ele nunca foi escrito
para representar. A pergunta que este ADR resolve é: **como o payload comunica "isto é um placar
zerado por não ter começado, não um placar zerado porque tudo empatou em zero"**, e **quais
componentes precisam ouvir esse sinal e quais não precisam**.

## Decisão

### D1 — Campo novo, opcional, de valor único

`fase?: "pre_eleicao"` entra em `EdgePayload` e `EdgePayloadDeputado` (e, por composição, em
`EdgePayloadUf` através do mesmo objeto nacional que já carrega `composition`/`dado_ts`). Ausência
do campo — o estado de todo payload real de apuração, hoje e depois de 04/10 — significa fase
normal. Não existe segundo valor de enum: o campo é opcional-presente-ou-ausente, nunca
opcional-com-dois-valores-possíveis.

### D2 — NÃO reusar `composition.pre_election`

Três razões convergem, e a primeira já decide sozinha.

1. **`composition.pre_election` nunca significou fase, e vai significar outra coisa em breve.**
   Hoje é uma constante gravada incondicionalmente pelos dois emissores do modelo:
   `api/model/project.py:4051` grava `{"pre_election": 0.0, "model": 1.0, "actual_results": 0.0}`
   sempre, e `api/model/deputado_payload.py:691` grava `{"pre_election": 0.0, "model": 0.0,
   "actual_results": 1.0}` sempre — nenhum dos dois lê nenhum sinal de calendário ou de percentual
   apurado para decidir esse número; é peso fixo de composição do modelo, documentado no próprio
   docstring (`project.py:3594`) como "v1 placeholder — a spec 008 vai ponderar pelas 3 fontes de
   verdade". Quando a spec 008 (brushing/linking, hoje `draft`) tornar esse peso dinâmico de
   verdade, `pre_election ≈ 0,95` às 20h05 de 04/10 com 0,01% das seções já apuradas será o valor
   **correto** do ponto de vista do modelo — e uma UI gateada nesse campo devolveria a tela ao modo
   "a eleição não começou" no exato minuto em que ela começou. É o falso positivo mais caro que este
   ADR poderia introduzir, plantado silenciosamente num campo que outra pessoa vai mexer por outro
   motivo, meses depois, sem saber que a UI também olha para ele.
2. **Dois `emptyPayload()` já gravam `pre_election: 1` sem querer dizer fase nenhuma** —
   `app/(gov)/governador/page.tsx:206` e `app/(sen)/senador/page.tsx:122` usam esse valor como
   payload de fallback estrutural (quando a leitura do Edge Config falha), não como sinal de "ainda
   não começou a eleição". Gatear em `pre_election === 1` acenderia o modo pré-eleição toda vez que
   o fallback estrutural entrasse em ação, mesmo em pleno 04/10.
3. **Soma-1 é invariante de peso, não discriminante binário.** `composition` é validado em runtime
   como três números que somam `1` (comentário em `types.ts:568-569`); `0,999` e `1,0` são a mesma
   coisa para o modelo (arredondamento de ponto flutuante) e coisas opostas para uma tela que decide
   "mostrar placar zerado normal" vs. "mostrar placar zerado com aviso". Um campo cuja tolerância
   correta é "soma aproximadamente 1" não deveria ser também o interruptor exato de um modo de UI.

### D3 — Campo opcional e de valor único, não booleano nem union de dois valores

Este desenho já tem precedente direto e testado no mesmo arquivo: `EdgePayload.dado_ts?: string |
null` (ADR-0038, `lib/edge-config/types.ts:588-625`) resolveu exatamente o mesmo problema de forma
— "como acrescentar um sinal novo sem tocar payloads existentes, sem exigir migração de fixture, e
sem introduzir um segundo lugar para esquecer de atualizar" — usando `?:` para "estado ausente" e
reservando outro valor para "estado explícito". `fase` segue o mesmo padrão, simplificado: como só
existe um estado a comunicar (pré-eleição), não há necessidade do terceiro estado `null` que
`dado_ts` precisa (lá, `null` significa "não foi possível calcular"; aqui não existe equivalente —
ou o payload é de pré-eleição, ou não é, sem meio-termo indeterminado).

Consequências práticas da escolha:

- **Zero mudança em fixtures existentes.** Os ~20 literais de payload espalhados em
  `tests/fixtures/edge-config/*.json` e nos testes inline (`writer.test.ts`, `edge-write.test.ts`,
  `deputado-federal.test.tsx`, `senador.test.tsx` etc.) continuam compilando e passando sem
  qualquer edição — nenhum deles precisa aprender a escrever `fase: undefined` explicitamente.
- **Zero mudança de schema Zod para a escrita não quebrar.** `app/api/internal/edge-write/route.ts`
  já usa `.passthrough()` nos pontos citados no ADR-0038 (`:120,152,206,229`) — o campo novo atravessa
  sem exigir edição do `bodySchema`/`deputadoBodySchema`. Tipagem explícita do lado do leitor é
  recomendada (para autocomplete e para os componentes que passam a checar `payload.fase ===
  "pre_eleicao"`), não obrigatória para a escrita funcionar.
- **Não existe o par `false`/`undefined` que o ADR-0038 já identificou como armadilha de
  colapso por `??`.** Com valor único, a única pergunta possível é "a chave está presente e vale
  `'pre_eleicao'`?" — não há segundo valor com que confundi-la.
- **A saída da fase é por omissão, não por desligamento explícito.** O orchestrator do modelo
  (`_do_project`/`_do_project_proporcional`) nunca escreve `fase` fora da janela de seed — o
  primeiro ciclo real de ingestão publica um payload sem essa chave, e ela desaparece do JSON no
  próximo upsert. Ninguém precisa lembrar de "desligar" nada às 20h00 de 04/10; o próprio fluxo de
  publicação normal já não escreve o campo.

### D4 — Preencher os 8 campos numéricos obrigatórios com zero e suprimir no consumo; NÃO torná-los anuláveis

Oito campos não têm valor honesto quando não há voto nenhum contado: `EdgeUfRow.lider`
(`types.ts:458`), `EdgeCandidate.rank` (`:288`), `p_fecha_1t` (`:308`), `p_vitoria` (`:276`),
`p_passa_2t` (`:298`), `pct_projetado_lower`/`pct_projetado_upper` (`:272,274`), e
`EdgeUfRow.margem_atual`/`margem_projetada` (`:460,462`) — contá-los juntos porque a decisão que os
afeta é a mesma. Duas rotas foram avaliadas:

- **Tornar os 8 campos `| null` no tipo.** Torna a mentira impossível **por tipo** — um `p_vitoria:
  null` não pode, por construção, ser lido como "33% de chance". Mas o raio de mudança é grande:
  `types.ts` (8 assinaturas), `api/model/project.py` e `api/model/deputado_payload.py` (os dois
  emissores, cada um decidindo quando emitir `null` em vez de número), o schema Zod de
  `edge-write/route.ts` (8 campos passam de obrigatórios a opcionais/nuláveis), 5 fixtures de teste,
  e cerca de 20 testes que hoje esperam `number` nesses pontos. Pior: o caminho anulável vira **código
  morto em 21 dias** — o Python nunca vai de fato emitir `null` neles fora da janela de seed, e o
  tipo carrega uma união que existe só para um estado transitório de três semanas.
- **Manter os 8 campos `number`, sempre `0` em fase pré-eleição, e suprimir a exibição no
  consumidor.** É a rota escolhida. Cada um dos oito campos numéricos permanece exatamente como é —
  nenhuma mudança de tipo, nenhuma mudança de schema, nenhuma mudança nos dois emissores Python além
  de já escreverem `0` (que é o valor natural de "nenhum voto contado ainda", não uma mentira em si
  mesmo). O que muda é **onde** cada consumidor lê `payload.fase` antes de decidir se aquele número
  específico deve virar texto na tela.

O trade-off é explícito e vale registrar as duas faces: (a) o caminho anulável eliminaria a classe
de erro por tipo, mas criaria uma união nunca exercitada de verdade fora do seed — código morto
adicional pronto pra apodrecer sem teste que o force; (b) N pontos de coalescência (`?? 0`, um por
componente consumidor) trocam um ponto único de verdade por N pontos onde um `?? 0` esquecido
recria a mentira em silêncio — exatamente a classe de defeito "default silencioso" que este projeto
já identificou como recorrente em outros contextos. A rota escolhida aceita o risco (b) porque o
raio de mudança é estritamente menor — `types.ts` + `project.py` + `deputado_payload.py` (nenhuma
mudança de assinatura, só literal `0`, já o caso hoje) contra 4 páginas + 4 componentes que ganham
um `if (payload.fase === "pre_eleicao") { ... }` — e porque (c) o custo de errar em (b) é visível na
tela (um número aparece onde não devia) e detectável por screenshot/teste de snapshot, enquanto
errar em (a) — esquecer de popular `null` num dos 8 pontos de emissão — seria silencioso do mesmo
jeito, só que atrás de uma união de tipo que dá falsa sensação de segurança.

**Exceção que confirma a regra: `ts` não entra nesta lista.** `ts` continua `string` e continua
**honesto** em fase pré-eleição — é genuinamente a hora em que o seed rodou, o mesmo contrato que
`ts` sempre teve (ADR-0038: "hora em que o modelo rodou", nunca prometeu ser hora de boletim). O que
tornava `ts` uma mentira ao lado de zero voto não era o valor em si, era a **exibição** dele com o
peso editorial de "última atualização de uma apuração em andamento" — e o único exibidor
identificado (`BulletinPanel`, que usa `ts` para carimbar insights textuais) já está coberto pela
supressão de D6/D7: em fase pré-eleição, `BulletinPanel` não gera nenhum insight de projeção, então
`ts` nunca chega à tela associado a um texto que pressupõe apuração em curso.

### D5 — Nenhum consumidor pode gatear em `pct_apurado_total === 0`

Às 20h01 de 04/10, o primeiro payload real da noite terá `pct_apurado_total` próximo de `0,01` —
um zero **medido**, resultado de segundos reais de segundos contadas, não a ausência estrutural do
seed. Qualquer lógica que trate "`pct_apurado_total` é (aproximadamente) zero" como sinônimo de
"estamos em fase pré-eleição" confundiria os dois casos e devolveria a tela ao modo de espera no
momento exato em que a apuração de fato começa — a noite de 04/10 replicando, ao vivo, o mesmo tipo
de falso-negativo que este projeto já pagou caro para descobrir tarde em outro contexto (percentual
medido sendo tratado como sinal binário). **`fase` é o único gatilho permitido**; `pct_apurado_total`
continua sendo métrica de progresso, nunca proxy de fase. Isto é registrado aqui como consequência
negativa aceita e vigiada por teste (ver Consequências) — não como problema resolvido.

### D6 — Nenhum gate de calendário

`new Date() < DATA_ELEICAO`, calculado numa rota com `revalidate: 60` e pré-renderização estática
(App Router, Next.js 16), congela a resposta do build: uma página gerada em 03/10 continuaria
dizendo "a eleição não começou" depois de 05/10, até o próximo build ou a próxima invalidação de
cache — e o inverso, gerar a página exatamente às 00:00 de 04/10 antes de qualquer boletim real
existir, teria uma janela de horas mostrando placar sem o aviso. **A fase vem do dado, sempre**: é o
Python quem decide se escreve `fase: "pre_eleicao"`, olhando para o que ele mesmo está processando
(ausência de qualquer snapshot no ciclo, condição que só é verdadeira antes do primeiro boletim
real), nunca a hora de parede de quem está lendo a página.

### D7 — O princípio que organiza as supressões: mede, cala; identifica, fala

Cada componente afetado se enquadra num de dois papéis, e o papel decide o comportamento em fase
pré-eleição:

- **Componente que mede** algo sobre a corrida — probabilidade (`ChancesPanel`), margem/IC
  (`BulletinPanel`, `ResultPanel`), quantos candidatos cruzam um limiar de projeção
  (`RaceTypeIndicator`), cobertura territorial (`RemainingPanel`), identidade do líder atual
  (`_NationalChoroplethMapImpl`, modo `winner`/`margin`) — **cala** em fase pré-eleição. Não exibe o
  número, não tenta reformular a frase para "soar certo com zero" (ex.: não vale trocar "vence no 1º
  turno" por "empatado em 0%" — a resposta correta é não renderizar o bloco). O mapa, especificamente,
  generaliza a guarda que hoje só existe para `viewMode === "parcial"` (`_NationalChoroplethMapImpl.tsx:199-204`):
  em fase pré-eleição, todo `view` (`winner`, `margin`, `swing`) pinta todas as UFs com
  `--map-uncounted`, independentemente de `viewMode` — a mesma cor neutra que já existe no design
  system, sem cor nova a introduzir.
- **Componente que mostra identidade** — nome, foto, partido, número na urna (`EdgeCandidate.nome`,
  `.partido`, `.id`, e `sqcand` quando presente, via ADR-0041/0042) — **fala**, porque é exatamente
  o que o dono do produto pediu: o leitor vê quem concorre antes de a apuração começar. Isso inclui
  o `<h1>`/título da tela e a ordenação da lista de candidatos.

### D8 — Mitigação do risco residual de leitura, no que é responsabilidade deste ADR

A objeção original — um placar zerado ainda pode ser lido como "ninguém pontuou" — não desaparece
com D1-D7; ela é **mitigada**, não eliminada, e a mitigação de UI listada aqui (duas camadas de
aviso textual explícito, `<h1>` reformulado para "Quem está concorrendo" em vez de um título que
sugira resultado, ordenação da lista por número na urna em vez de por `rank`/probabilidade, e
`poles={false}` — sem pódio nem destaque de "líder" — nos componentes que hoje assumem uma corrida
em andamento) é decisão de design de interface que cabe à spec 019 especificar em detalhe, não a
este ADR arquitetural. O que este documento garante é que a **mentira numérica** (probabilidade,
margem, IC, líder, "concluída") não é possível a partir do payload; a leitura errônea de um leitor
que não repara nos avisos textuais é um risco que o dono do produto assumiu conscientemente ao
manter a decisão apesar da objeção nomeada no Contexto.

## Alternativas rejeitadas

- **Reusar `composition.pre_election` como gatilho de fase.** Rejeitada (D2): o campo é uma
  constante hoje e vai virar peso dinâmico real quando a spec 008 sair de `draft` — um payload real
  de noite de apuração com `pre_election` alto (por bom motivo estatístico) acionaria o modo
  pré-eleição da UI no pior momento possível.
- **Campo booleano `preEleicao: boolean` em vez de `fase?: "pre_eleicao"`.** Rejeitada (D3): um
  booleano com default implícito (`false` quando ausente vs. `undefined` quando nunca escrito)
  reintroduz o par `false`/`undefined` que o ADR-0038 já registrou como fonte de colapso por `??` —
  o valor único evita a pergunta completamente.
- **Tornar os 8 campos numéricos (`lider`, `rank`, `p_vitoria`, `p_passa_2t`, `p_fecha_1t`,
  `pct_projetado_lower/upper`, `margem_*`) anuláveis.** Rejeitada (D4): elimina a mentira por tipo,
  mas troca um raio de mudança pequeno (2 arquivos Python continuam emitindo `0`, componentes ganham
  supressão condicional) por um raio grande (8 assinaturas de tipo, schema Zod, 2 emissores, 5
  fixtures, ~20 testes) para sustentar um caminho de código que nunca roda fora de uma janela de três
  semanas.
- **Gatear a fase em `pct_apurado_total === 0` ou `pct_apurado_total < ε`.** Rejeitada (D5): confunde
  "zero estrutural do seed" com "zero medido no primeiro segundo real de apuração" — o pior momento
  possível para essa confusão é exatamente 04/10 às 20h00.
- **Gatear a fase em `new Date() < DATA_ELEICAO`.** Rejeitada (D6): incompatível com pré-renderização
  estática e `revalidate: 60` — o relógio da build congela, não o relógio de parede do leitor.
- **Não implementar supressão granular por componente; aceitar as 5 mentiras numéricas do Contexto
  como custo do produto zerado.** Rejeitada (D7): contradiz diretamente a constituição § 1 ("a
  projeção é conteúdo derivado e precisa ser inconfundível com o oficial") e § 8 (transparência
  metodológica) — publicar `p_fecha_1t` degenerado ou "apuração concluída" quando ela não começou
  não é uma imprecisão tolerável, é uma afirmação factualmente falsa sobre o estado da eleição.

## Consequências

**Positivas**:

- O leitor ganha o que o dono do produto pediu — identidade real dos candidatos antes de 04/10 —
  sem que nenhum número mensurável (probabilidade, margem, IC, cobertura, "concluída") seja
  publicado com falsidade.
- Zero migração de fixture, zero mudança de schema de escrita, zero mudança de assinatura nos 8
  campos numéricos — o custo inteiro deste ADR está concentrado em (a) um campo novo opcional e (b)
  supressão condicional em um número pequeno e nomeado de componentes de leitura.
- A saída da fase é automática (D3) — nenhum passo manual em 04/10 pode ser esquecido, porque o
  fluxo normal de publicação do modelo já não escreve o campo.
- O padrão `?:` de campo único-opcional já tem precedente testado no mesmo arquivo (`dado_ts`,
  ADR-0038) — quem já entende aquele padrão entende este sem reaprender.
- A regra "mede, cala; identifica, fala" (D7) dá a qualquer implementador um critério mecânico para
  decidir, componente a componente, sem precisar consultar este ADR de novo a cada novo caso —
  inclusive para componentes futuros ainda não escritos.

**Negativas**:

- **O risco residual de leitura (D8) não é eliminado, só mitigado** — um leitor que não repara nos
  avisos textuais ainda pode ler "candidatos com zero ao lado do nome" como "ninguém votou neles
  ainda", quando a leitura correta é "a votação não começou". O dono do produto assumiu esse risco
  conscientemente; este ADR não o resolve, só impede que ele seja agravado por números mensuráveis
  falsos.
- **`composition.pre_election` continua existindo como constante ambígua de nome**, e nada neste ADR
  impede que outra pessoa, no futuro, reuse-o por engano como sinal de fase — exatamente o erro que
  D2 evita aqui. Mitigação parcial: o comentário em `lib/edge-config/types.ts:576-580`
  (`EdgeComposition`) deve ganhar uma nota apontando para este ADR e explicando por quê `fase` existe
  separadamente — tarefa do implementador, não deste documento.
- **A supressão condicional (D4/D7) é responsabilidade distribuída por ~8 componentes de
  consumo** (`RemainingPanel`, `ChancesPanel`, `BulletinPanel`, `RaceTypeIndicator`,
  `_NationalChoroplethMapImpl`, e potencialmente `NationalWinnerBanner`/`ResultPanel`/`ApuracaoMeta`
  — a lista completa cabe à spec 019, não a este ADR) — um componente novo escrito depois deste ADR
  sem consultar a regra de D7 pode reintroduzir exatamente uma das cinco mentiras do Contexto.
  Mitigação: `rf-coverage-checker`/`constitution-guard` devem ter um caso de teste dedicado a "payload
  com `fase: 'pre_eleicao'` não produz nenhum dos cinco textos do Contexto" — tarefa para a spec 019
  e para os gates de `shipped`.
- **`EDGE_CONFIG_STORE_GUARD_BYTES` (ADR-0032) não existe no código hoje** — busca em `lib/`
  confirma zero ocorrência; o writer atual só registra aviso, nunca recusa a escrita antes de chamar
  a API da Vercel. Este ADR **decide explicitamente não implementá-la** como parte do mesmo trabalho
  que estreia a escrita de payload de seed: transformar o caminho de escrita em algo que pode
  recusar, no mesmo PR que introduz um novo tipo de escrita nunca exercitado em produção (o seed
  pré-eleição), trocaria um bug de exibição — o assunto deste ADR — por risco de apagão de escrita na
  pior noite possível para descobrir esse bug, a da apuração real. A lacuna do ADR-0032 permanece
  registrada e não mitigada por este documento.
- **Nenhum teste hoje cobre o cenário "payload com `fase: 'pre_eleicao'`"** — os ~20 literais de
  payload citados em D3 não precisam mudar para continuar passando, mas isso também significa que
  nenhum deles hoje exercita o caminho novo; a spec 019 precisa introduzir fixture(s) dedicada(s)
  antes de qualquer implementação ser considerada coberta.

## Cross-refs

- [ADR-0032](0032-detalhe-municipal-vercel-blob.md) (limite real do Global Config e
  `EDGE_CONFIG_STORE_GUARD_BYTES`, nunca implementado — lacuna conhecida, não mitigada por este ADR,
  ver Consequências).
- [ADR-0038](0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) (`dado_ts?: string | null` — precedente
  direto do padrão de campo opcional-de-valor-único usado em D3; `ts` como relógio honesto do
  cálculo/seed, cuja exceção em D4 depende da mesma distinção que o ADR-0038 já formalizou entre
  "hora do dado" e "hora do cálculo").
- [ADR-0042](0042-cargo-uf-numero-chave-identidade-candidatura.md) (identidade de candidatura —
  nome, partido, `sqcand` em `EdgeUfRow.top_candidatos`; D7 depende desses campos existirem para que
  "identifica, fala" tenha o que mostrar).
- Constituição § 1 (a projeção é conteúdo derivado e precisa ser inconfundível com o oficial — D4/D7
  garantem que nenhuma probabilidade/margem/IC falsa seja publicada em fase pré-eleição).
- Constituição § 2 (neutralidade política — a ordenação por número na urna em vez de rank/pódio,
  citada em D8, evita que a fase pré-eleição favoreça visualmente qualquer candidatura).
- Constituição § 8 (transparência metodológica — o leitor precisa entender que está vendo uma lista
  de candidatos, não um resultado; os dois avisos textuais de D8 cumprem essa obrigação, com o
  detalhamento de texto/posição deferido à spec 019).
- Spec 019 (fase pré-eleição — UI, avisos, fixture de teste dedicada, lista completa de componentes
  a suprimir; a criar em paralelo por outro agente): deve listar este ADR no frontmatter `adrs:` e
  formalizar em EARS o comportamento de D7 componente a componente.
- `lib/edge-config/types.ts:576-580` (`EdgeComposition` — ganha comentário apontando para este ADR,
  explicando por que `pre_election` não é o sinal de fase).
- `components/blocks/RemainingPanel.tsx:183-188`, `ChancesPanel.tsx:170-202`,
  `BulletinPanel.tsx:106`, `components/atoms/badges/RaceTypeIndicator.tsx:64-73`,
  `_NationalChoroplethMapImpl.tsx:199-219` — os cinco pontos de consumo que motivaram este ADR e que
  precisam da supressão de D7.
- `app/(gov)/governador/page.tsx:206`, `app/(sen)/senador/page.tsx:122` — os dois `emptyPayload()`
  que já gravam `pre_election: 1` sem relação com fase (D2, item 2) — nada muda neles por este ADR,
  citados para que um futuro leitor não confunda os dois usos do mesmo campo.
- `api/model/project.py:4051`, `api/model/deputado_payload.py:691` — os dois pontos de emissão de
  `composition.pre_election` como constante, citados em D2 como prova de que o campo não carrega
  sinal de fase hoje nem deveria carregar no futuro.
