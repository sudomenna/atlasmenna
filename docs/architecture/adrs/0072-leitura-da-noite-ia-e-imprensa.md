---
id: ADR-0072
title: Leitura da noite — texto da caixa "Análise" da home escrito por LLM e publicado sem revisão, painel "Na imprensa" só com links e Boletim como histórico; supersede o ADR-0005 apenas na caixa Análise
status: accepted
date: 2026-10-04
supersedes: ADR-0005 (parcial — apenas a caixa "Análise / Leitura do modelo" da home presidencial)
---

# ADR-0072 — Leitura da noite: IA na caixa "Análise", manchetes em "Na imprensa", Boletim como histórico

## Status

Aceito (2026-10-04). Decisão do dono, tomada às 09h20 do dia do 1º turno; o código congela às 12h do mesmo dia.

**Supersede parcialmente o [ADR-0005](0005-templates-nao-llm.md)** — só na caixa "Análise / Leitura do modelo" da
home presidencial. Em todas as outras superfícies (páginas de UF, Governador, Senador, Deputados, Boletim, qualquer
texto analítico fora dessa caixa) o ADR-0005 segue em vigor: texto por template, sem LLM, **até nova decisão do
dono**. Pelo critério registrado na nota de 2026-09-05 do [ADR-0017](0017-transparencia-total-3-camadas.md) para
supersessão parcial, o ADR-0005 mantém `status: accepted` no frontmatter e narra, na seção Status, a parte
substituída.

**Emenda o § 6 da constituição** (1.6 → 1.7), só no item "Templates de insights não usam LLM". O § 2
(neutralidade) **não muda** e continua valendo para o texto escrito pelo modelo (ver Decisão 8).

## Contexto

**1. A caixa estava vazia em produção.** O modelo grava `"insights": []` em todo ciclo
(`api/model/project.py:7496`), e as frases por regra de Presidente (`insightsPresidente`) só existiam no gerador do
modo simulado (`data-pipeline/simulacao-gerar.ts`): em produção nada as montava. O Boletim ("O que está acontecendo
agora") tinha outro limite: `buildBulletin()` (`components/blocks/BulletinPanel.tsx`) é função pura do payload
corrente, carimbada com o `ts` do ciclo do modelo — não guarda o que já aconteceu e não registra a hora em que cada
fato foi visto.

**2. O que o ADR-0005 argumentava, e o que sobra dele.** O ADR-0005 rejeitou LLM por três razões: custo e latência
por chamada no pico ("50–100 chamadas por segundo por usuário"), risco de alucinação "inaceitável numa eleição", e
saída determinística, auditável e testável (constituição § 2 e § 6). A primeira razão **não se aplica** a esta
arquitetura: quem chama o modelo é um cron, no máximo uma vez a cada 4 minutos, e o leitor só lê um JSON pronto — o
custo não cresce com a audiência. **As outras duas continuam valendo, e é nelas que o dono decidiu assumir o
risco.** Este ADR não finge o contrário.

**3. A decisão do dono.** Em 2026-10-04, às 09h20, o dono decidiu explicitamente: o texto da caixa passa a ser
escrito por LLM e **publicado automaticamente, sem revisão humana e sem verificador de números ou de adjetivos** —
nas palavras dele, "máxima liberdade", "pode publicar tudo sozinha sempre". A única trava de conteúdo que ele exigiu é
uma instrução no prompt: "sem adjetivos de mérito sobre candidatos". Pediu também o painel "Na imprensa" (manchetes
de veículos) e que o Boletim vire um histórico da noite. A janela é de horas: o código congela às 12h.

## Decisão

**1. Caixa "Análise" escrita por LLM.** Claude Sonnet 5.5 (slug padrão `anthropic/claude-sonnet-5.5`, trocável sem
deploy pelo campo `modelo` do interruptor) via **Vercel AI Gateway**, com o pacote `ai` (AI SDK v7) e o
`@ai-sdk/gateway` — dependência nova, registrada em [tech-stack.md](../tech-stack.md). O modelo recebe um JSON
compacto derivado do payload da projeção presidencial, os eventos recentes do Boletim e as frases anteriores, e
devolve 2 a 4 frases (limpas de markdown e cortadas em 400 caracteres — limpeza de forma, não de conteúdo). O texto é
publicado **automaticamente, sem revisão humana e sem verificador** depois da geração. A instrução de sistema
(`INSTRUCAO_SISTEMA`, `lib/leitura/ia.ts`) leva a trava do dono e, além dela, instruções de fidelidade (usar só
números do JSON, separar "apurado" de "projeção não oficial", nunca declarar alguém eleito ou vencedor);
**todas existem só no prompt — nenhuma é conferida depois da geração**. Nenhuma requisição de leitor chama o modelo, e
`ai` é importado em um único arquivo, fora do bundle do leitor. Nenhuma manchete entra no prompt.

**2. Reserva por regra fixa.** As frases de `insightsPresidente` (`lib/insights/presidente.ts`, templates
deterministas, no espírito do ADR-0005) passam a aparecer em produção quando a IA está desligada, falha ou o texto tem
mais de 20 minutos. O `<InsightCard>` distingue a origem (`data-origem="ia"` ou `"regra"`) e troca a nota de rodapé;
a caixa deixa de ficar vazia.

**3. Painel "Na imprensa".** Manchetes de feeds RSS públicos de dez fontes — G1, Folha, Estadão, UOL, Poder360, CNN
Brasil, Agência Brasil, BBC News Brasil, Metrópoles e uma busca do Google Notícias —, buscadas pelo cron, no servidor,
a cada 5 minutos. O produto guarda e mostra **só título, veículo, hora e link; nunca o texto da matéria**. Até 8
manchetes na tela, no máximo 2 por veículo, da mais nova para a mais antiga. O painel só aparece a partir das **17h de
Brasília do dia de cada turno** (art. 265 §1º, ver Consequências) e só com coleta de menos de 60 minutos.

**4. Boletim como histórico da noite.** Cada mudança que o cron detecta entre um ciclo e o seguinte — início, marcos
de % apurado, mudança de líder na contagem e na projeção, UF chamada, cenário de 2º turno, todas as UFs apuradas — vira
uma linha com a **hora real em que o cron a viu**; as anteriores ficam (até 40). Continua **por regra fixa, sem IA**;
o identificador do evento é determinístico, então o mesmo evento visto duas vezes não duplica a linha.

**5. Arquitetura.**

- **Cron novo** `/api/internal/leitura-noite`, a cada minuto, `* 20-23,0-7 * * *` (UTC, ou seja, 17h às 5h BRT),
  **separado da ingestão e da projeção**. Lê `projection-current-pres-t1` (só leitura), deriva os eventos, busca os
  feeds no máximo a cada 5 minutos e chama a IA no máximo a cada 4 minutos — quando o apurado anda 2 pp ou mais, quando
  há evento novo ou quando o último texto tem mais de 10 minutos.
- **Armazenamento no Vercel Blob**, não no Edge Config: um JSON em `leitura/pres/t1.json` (contrato em
  `lib/leitura/types.ts`). O limite de 1 MB do store inteiro é da projeção (nota de 2026-09-08 do
  [ADR-0001](0001-edge-config-no-read-path.md)). O Blob já é o segundo mecanismo admitido no read path
  ([ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md),
  [ADR-0032](0032-detalhe-municipal-vercel-blob.md)); Postgres continua fora dele.
- **Leitura pela home** em `lib/leitura/ler.ts`: nunca lança; qualquer falha (sem `EDGE_CONFIG`, Edge Config lento,
  Blob 404, JSON torto, schema inválido) vira "leitura vazia", e a página renderiza como se esta decisão não existisse.

**6. Interruptor sem deploy.** Chave `interruptor-leitura-noite` no Global Config do Edge Config, valor `{ ia,
noticias, historico, modelo? }` — três chaves independentes. **Falha fechada, campo a campo**: só `=== true` liga;
chave ausente, erro de leitura ou valor torto desligam. Tudo **sobe desligado**; ligar é um passo do roteiro do dia
D. Operação por `pnpm leitura:interruptor` (`scripts/interruptor-leitura.ts`), nas mesmas travas do `pnpm
dep:projecao` do [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md): mostra id e nome do
store, recusa o store de ensaio, exige `--confirmar <id>` digitado e relê a chave depois de gravar. Vale a regra geral
do ADR-0063 D4: interruptor que precisa agir sem deploy vive no Edge Config, nunca em variável de ambiente.

**7. Rótulo.** O texto da IA vai sempre com a nota: "Texto escrito por inteligência artificial a partir da projeção
não oficial do AtlasMenna, publicado automaticamente, sem revisão humana; pode conter erros. Atualizado às HH:MM. O
resultado oficial é do TSE." (`components/blocks/InsightCard.tsx`). A reserva por regra fixa leva a sua própria nota.

**8. Escopo e § 2.** O ADR-0005 é superseded **só na caixa Análise**. A neutralidade do § 2 continua valendo para o
texto do modelo: ele é conteúdo do AtlasMenna e responde por neutralidade como qualquer outro. O que muda é o
**mecanismo**: com template, a garantia era estrutural (o texto não consegue julgar); com o LLM, é uma instrução de
prompt sem verificação. Se o texto violar o § 2, isso é uma violação do produto — não um uso permitido pela exceção —
e o remédio é desligar `ia`.

## Consequências

**Positivas**:

- A caixa deixa de ficar vazia em produção: sempre há texto, de IA ou de regra.
- O custo não depende da audiência: a chamada é do cron, no máximo uma a cada 4 minutos (teto de 180 chamadas em 12
  horas). A estimativa é de cerca de US$ 3 por noite — **estimativa, não medida**.
- A IA fica **fora do caminho da projeção**: rota própria, só leitura sobre a chave da projeção, chave própria no
  Blob, nenhuma escrita no payload, no Postgres, em `snapshots` ou em `projections`. Se o cron ou o gateway caírem,
  regride só a caixa, o painel e o histórico; placar, projeção e ingestão não percebem.
- O remédio não depende de deploy: três interruptores independentes, falha fechada, operáveis com o código congelado.
- O Boletim ganha memória e hora real, e o leitor passa a ver o que aconteceu antes.
- Nada de terceiros no navegador do leitor: os feeds são buscados no servidor e a página mostra texto e link.
- O pacote `ai` não entra no bundle do leitor (só `lib/leitura/ia.ts`, chamado pelo cron) — o orçamento do RNF-007a
  não deveria mudar; **a conferir** pelo `a11y-perf-auditor`.

**Negativas — riscos aceitos expressamente pelo dono em 2026-10-04**:

- **Alucinação de números e de fatos.** Nada compara o texto com o JSON que o modelo recebeu. A frase pode afirmar um
  número, uma posição ou uma probabilidade que não está nos dados — e, o pior caso, confundir projeção (não oficial)
  com apurado (oficial), o erro que o § 1 trata como obrigação regulatória (art. 267 §4º). O rótulo avisa; não
  corrige. O texto anterior volta para o prompt seguinte, então um erro pode ser repetido no ciclo seguinte.
- **Tom e neutralidade.** "Sem adjetivos de mérito" é uma instrução, e um modelo pode julgar sem adjetivo: pela
  escolha do que destacar, pela ordem em que cita os candidatos, pelo verbo. Não há verificação de simetria entre
  candidatos. O texto é lido sob a marca do AtlasMenna.
- **Ausência de revisão.** Ninguém lê o texto antes de ele ir ao ar. Quem o detecta é uma pessoa olhando a home — não
  há alarme sobre o conteúdo.
- **Ausência de verificador.** Nenhuma checagem automática de número, de adjetivo ou de menção a candidato depois da
  geração. As travas de exibição que existem (texto com menos de 20 minutos; `% apurado` em que foi escrito a no
  máximo 5 pp do que a página mostra, `lib/leitura/ler.ts`) tratam de **atualidade**, não de **conteúdo**.
- **O remédio é rápido, não imediato.** Desligar `ia` leva até 2 minutos (alvo do dono; **não medido**); nesse
  intervalo o texto ruim continua no ar, e nada recolhe o que já foi lido ou copiado.
- **Sem registro do que foi publicado.** O contrato guarda só o último texto (`ia`, um objeto, não uma lista) e o
  Blob é reescrito a cada ciclo. O que a caixa disse às 21h37 não se reconstrói depois, salvo log que esta decisão não
  prevê. Quem quiser responder a uma reclamação sobre um texto específico não terá o texto.
- **Risco jurídico e reputacional.** Um texto escrito por máquina, sobre candidatos, em rede aberta, na noite da
  eleição, sob a marca do produto, sem revisão. Este ADR não registra parecer jurídico.

**Negativas — demais**:

- **Primeira exceção ao "sem LLM", e precedente.** A emenda 1.7 é escopada à caixa Análise da home, mas outras
  superfícies passam a ter o argumento "a home já tem". Estender exige decisão do dono (ADR novo).
- **Reprodutibilidade (§ 6) não vale para o texto.** O mesmo JSON pode gerar outro texto. A projeção continua
  reproduzível a partir dos snapshots e do código versionado — o texto do modelo é derivado dela e não entra no
  modelo, mas **não é determinístico**, e a constituição passa a dizer isso.
- **Manchetes são conteúdo de terceiros, não verificado.** Um título pode trazer afirmação falsa, difamatória ou
  partidária sobre candidato e aparece na home com a moldura do AtlasMenna, que não pode corrigi-lo. A seleção
  mecânica (mais nova primeiro, no máximo 8, no máximo 2 por veículo) limita a captura do painel por um veículo, não o
  conteúdo. A escolha das dez fontes é editorial e do dono (§ 2: lista fechada, mesma regra para todos), e o Google
  Notícias é uma **busca por palavras-chave**, que traz veículos que ninguém escolheu um a um.
- **Tirar uma fonte exige deploy.** A lista de feeds é código (`lib/leitura/feeds.ts`); o interruptor `noticias`
  desliga o painel inteiro, não um veículo.
- **A trava das 17h é analogia, não exigência literal.** O art. 265 §1º libera a divulgação do **resultado** de
  Presidente a partir das 17h de Brasília ([regulatory.md](../../reference/regulatory.md)); o artigo não trata de
  manchetes. A trava do painel é uma aplicação conservadora por analogia, decidida pelo dono.
- **O Boletim mostra a hora em que o cron viu, não a hora do fato.** Se o cron parar, os eventos aparecem atrasados
  quando ele voltar; uma mudança que ocorra e se desfaça entre dois ciclos não vira linha; o histórico guarda no
  máximo 40 linhas.
- **Mais uma peça que pode falhar em silêncio.** Se o cron parar, tudo degrada para um estado seguro (IA vai à
  reserva em 20 minutos, manchetes somem em 60, histórico para de crescer), mas nenhum alarme desta decisão avisa. O
  sinal é a home.
- **O Blob é público.** Tudo que o ciclo grava nele, inclusive a mensagem do último erro da IA (`ia_tentativa.erro`),
  é legível por qualquer pessoa: a mensagem não pode carregar segredo nem detalhe interno.
- **Ponto novo de leitura no render da home.** Cada renderização lê o interruptor no Edge Config (teto de 2 s; falha =
  leitura vazia) e, se algo estiver ligado, o Blob (revalidação de 60 s). Pior caso: a home espera até 2 s por um
  Edge Config lento.
- **Extrator de RSS artesanal** (sem dependência nova, `lib/leitura/feeds.ts`): um feed que mude de formato pode passar
  a render zero manchetes daquele veículo sem aviso.
- **Entrega no dia da eleição.** O código congela às 12h e a verificação em produção prevista é a conferência das 17h
  do roteiro do dia D ([_D1](../../sprints/_D1-04out2026.md)). "Sobe desligado" mantém baixo o risco de publicar;
  não elimina o de ligar.
- **Sem alarme de gasto.** O teto de chamadas é do código; não há orçamento nem alerta no gateway registrado aqui.

**Mitigações (o que de fato reduz o risco)**:

- Interruptor de três chaves, sem deploy, falha fechada, tudo desligado ao subir; ligar em duas etapas (histórico e
  imprensa primeiro, IA depois).
- Reserva por regra fixa: a caixa nunca fica presa num texto velho nem vazia.
- Rótulo sempre presente no texto da IA, com hora de atualização e a frase "o resultado oficial é do TSE".
- Trava das 17h: o cron só roda das 17h às 5h BRT e o painel de imprensa só aparece depois das 17h do dia do turno.
- IA fora do caminho da projeção (Decisão 5) e fora do bundle do leitor.
- Notícias só como link; nenhuma manchete entra no prompt, o que fecha a porta de texto de terceiros virar instrução
  para o modelo.

## Alternativas consideradas

- **Manter só templates (ADR-0005) também em produção.** Não escolhida como caminho principal pelo dono. Permanece
  como **reserva** (Decisão 2).
- **LLM com revisão humana antes de publicar.** Descartada por decisão do dono (publicação automática).
- **LLM com verificador de números e de adjetivos.** Descartada por decisão do dono ("sem verificador"). É o primeiro
  candidato se o dono quiser reduzir o risco antes do 2º turno (Pontos em aberto).
- **Chamar o modelo na requisição do leitor.** Rejeitada: é o argumento de custo e latência do próprio ADR-0005, e
  poria a chamada no render da home.
- **Embutir a IA no ciclo de ingestão e projeção.** Rejeitada: falha ou lentidão do gateway atrasaria ou derrubaria a
  projeção. Rota própria é a decisão de manter a IA fora do caminho dela.
- **Gravar a leitura no Edge Config.** Rejeitada: o limite do store é da projeção, e o Blob já é read path admitido.
- **Interruptor por variável de ambiente.** Rejeitada pelo ADR-0063 D4: só vale em deployment novo, e o código está
  congelado.
- **Mostrar resumo ou trecho das matérias.** Rejeitada pelo dono: só título, veículo, hora e link.

## Pontos em aberto

- **Registro dos textos publicados.** Decidir se o ciclo grava cada texto em log estruturado ou em arquivo
  append-only para auditoria e correção. Hoje só o último existe.
- **Depois da noite.** O cron roda **todas as noites** 17h–5h BRT, não só a de 04/10. Falta decidir se `ia` é desligada
  ao fim da apuração ou se o ciclo se recusa a chamar o modelo para um payload parado — o teto de custo (180
  chamadas/12 h) assume noite com apuração andando. O `lib/leitura/ciclo.ts` não foi conferido quanto a isso.
- **2º turno (25/10).** O cron desta decisão lê só `projection-current-pres-t1`. O 2º turno exige apontar o cron para a
  chave de t2 (a leitura da home e o `INICIO_DIVULGACAO` já distinguem o turno). A conferir antes de 25/10.
- **Verificador de números.** Não adotado. Conferir que cada número da frase existe no JSON de entrada seria barato e
  cobriria o risco principal (alucinação de número); fica registrado como a primeira medida possível.
- **Medição "desligar → sumir em 2 minutos".** Não feita.
- **Retenção de prompts no gateway e no provedor.** Não verificada. O que se envia é dado público e agregado (nenhum
  dado de leitor, § 5).
- **`/sobre-o-modelo` (constituição § 8)** ainda não menciona a caixa escrita por IA; hoje a divulgação é só o rótulo
  na própria caixa. Spec 011 a emendar.
- **Spec 003 (home)** ainda não tem RF para a caixa por IA, o painel "Na imprensa" nem o Boletim histórico, e
  [insights-templates.md](../../design-system/insights-templates.md) ainda diz "Sem LLM" sem ressalva.

## Cross-refs

- [ADR-0005](0005-templates-nao-llm.md) — superseded **parcialmente** (só a caixa Análise da home).
- [ADR-0001](0001-edge-config-no-read-path.md), [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md),
  [ADR-0032](0032-detalhe-municipal-vercel-blob.md) — read path: Edge Config e Blob; Postgres fora.
- [ADR-0012](0012-edge-config-chaves-nomeadas.md) — convenção de chaves (`interruptor-leitura-noite`).
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — o molde do interruptor (falha
  fechada, `pnpm dep:projecao`) e a regra "interruptor sem deploy vive no Edge Config".
- [ADR-0059](0059-classificacao-editorial-de-candidatos-governanca.md) — precedente de emenda à constituição com
  risco assumido pelo dono.
- [ADR-0020](0020-conformidade-res-23751-2026.md) e [regulatory.md](../../reference/regulatory.md) — art. 265 §1º
  (17h de Brasília) e art. 267 §4º.
- Specs afetadas: [003-home-nacional](../../specs/003-home-nacional/spec.md) (caixa Análise, Boletim, painel "Na
  imprensa") e [011-sobre-o-modelo](../../specs/011-sobre-o-modelo/spec.md) — a conferir pelo `spec-syncer`.
- Constituição: § 1 (projeção rotulada como não oficial, art. 267 §4º), § 2 (neutralidade, inalterado), § 3 (home), § 5
  (nenhum dado de leitor vai ao gateway), § 6 (**emendado**, 1.7), § 7 (degradação para a reserva), § 8
  (transparência), § 9 (AI Gateway, Blob, Cron e Edge Config são produtos Vercel; a inferência em si corre no provedor
  do modelo, atrás do gateway), § 10 (nada toca `snapshots`):
  [../../constitution.md](../../constitution.md).
- NFRs: RNF-002 e RNF-007a ([performance.md](../../nfr/performance.md)).
- Operação: adendo "04/10 — leitura da noite" em [_D1-04out2026.md](../../sprints/_D1-04out2026.md).
- Stack: [tech-stack.md](../tech-stack.md) (`ai` + AI Gateway).
- Código: `lib/leitura/` (`types`, `interruptor`, `eventos`, `feeds`, `ia`, `ciclo`, `ciclo-producao`, `ler`),
  `lib/insights/presidente.ts`, `components/blocks/NaImprensaPanel.tsx`, `components/blocks/InsightCard.tsx`,
  `components/blocks/BulletinPanel.tsx`, `scripts/interruptor-leitura.ts`.
