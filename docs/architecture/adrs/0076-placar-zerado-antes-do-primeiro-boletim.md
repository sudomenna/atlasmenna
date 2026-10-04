---
id: ADR-0076
title: Antes do primeiro boletim, toda página de resultado abre no leiaute normal de apuração com tudo zerado, montado na renderização a partir do cadastro publicado — não na tela de espera
status: accepted
date: 2026-10-04
supersedes: ADR-0043 (parcial — D7/D8, apenas o leiaute só-identidade "Quem está concorrendo" e a ordem por número na urna)
amends: [0043]
---

# ADR-0076 — Placar zerado antes do primeiro boletim

## Status

Aceito (2026-10-04, ~12h40 BRT). Decisão do dono, tomada no dia do 1º turno; entregue na mesma tarde.

**Supersede parcialmente o [ADR-0043](0043-fase-pre-eleicao-campo-proprio-nao-derivada.md)**: o leiaute
só-identidade de D7/D8 (h1 "Quem está concorrendo", lista por número na urna, `poles={false}`) deixa de ser
o que a tela mostra antes do primeiro boletim. **Permanecem em vigor** o campo `fase?: "pre_eleicao"` (D1–D3),
a regra "nunca gatear em `pct_apurado_total === 0`" (D5), a **ausência de gate de calendário** (D6) e o
princípio "identifica, fala; mede, cala" (D7), agora aplicado dentro do leiaute de apuração. ADR-0043 não muda
de `status` (continua `accepted`), por ser parcial. **Emenda também a spec 019 RF-133**
("sem dado, nenhum número"), só nos casos chave ausente / `fase: "pre_eleicao"` / lista de candidatos vazia.

## Contexto

O ADR-0043 resolveu "placar zerado com a identidade dos candidatos" montando uma tela **diferente** da de
apuração: banner "A eleição ainda não começou", h1 "Quem está concorrendo", grade de identidade ordenada por
número, e, onde não havia payload algum, a tela de espera ("Esta página ainda não recebeu dados",
"Aguardando dados"). O próprio ADR registrou que a objeção "zero parece resultado" era mitigada, não
eliminada (D8), e que o dono a assumia.

Na manhã de 04/10 o dono reavaliou o que o leitor vê **antes do primeiro boletim** (por volta das 17h de
Brasília, hora em que a transição acontece ao vivo). Duas coisas pesaram: (i) a tela de espera e a de apuração são duas telas a manter e a testar, e a transição entre elas
às 17h é o momento de maior audiência e menor margem de erro; (ii) o leitor que abre o site às 16h59 e o que
abre às 17h01 devem ver a **mesma** página, mudando apenas os números. Também havia páginas — Deputado
Estadual/Distrital, UFs sem payload — em que nem o leiaute de identidade existia e o leitor caía em "Esta
página ainda não recebeu dados".

Alternativas consideradas: (a) manter o ADR-0043 como está — rejeitada pelo dono pelos motivos acima;
(b) publicar um payload de seed zerado no Edge Config/Blob com todos os candidatos — rejeitada: é **escrita em
produção** na véspera do pico, com o risco de sobrescrita/ordem que o ADR-0043 D4/Consequências já tratou
com cautela, e o dado publicado seria fabricado (viola o espírito da regra de 14/09, "nunca fabricar zeros
de resgate"); (c) **montar o zerado na renderização, só leitura**, a partir do cadastro de candidatos já
publicado — escolhida. Restrições: constituição § 1 (não afirmar além do dado), § 2 (neutralidade — qualquer
ordem fixa por número ou alfabeto põe alguém em primeiro), regra de 14/09 ("três estados e não-regressão";
nunca fabricar zeros para cobrir **falha**), ADR-0074 (atualização automática a cada minuto: a ordem não pode
mudar entre ciclos), e a janela de 12h do runbook (`docs/sprints/_D1-04out2026.md`, passo 0.8).

## Decisão

**1. Leiaute único.** Antes do primeiro boletim, toda página de resultado — Presidente, Governador, Senador,
Deputado Federal, Estadual e Distrital; nacional e por UF — abre no leiaute **normal** de apuração, com tudo
zerado: todos os candidatos com foto e `0,0%`, "0% apurado", mapas em cinza, gráfico de evolução com eixos
vazios. **Nenhuma frase de espera**: o estado é dito apenas por "0% apurado". Somem o banner "A eleição ainda
não começou", "Esta página ainda não recebeu dados", "Aguardando dados" e a grade "Quem está concorrendo".

**2. Montagem na renderização, sem escrita.** O payload zerado é construído em `lib/zerado/` a partir do
cadastro publicado (Blob `candidatos/uf/<UF>/<token>.json`, lido por `readCandidatosUf`). **Nada é gravado**
no Edge Config nem no Blob. O primeiro payload real que traga candidatos assume **página a página** sozinho
(cada rota decide na própria leitura, sem sincronismo global). Reversão = redeploy do deployment anterior.

**3. Gatilho, por página.** O modo zerado liga quando a leitura (a) devolveu **chave ausente**, ou (b) devolveu
payload com `fase: "pre_eleicao"`, ou (c) devolveu payload real com **lista de candidatos vazia** (o primeiro
ciclo de zero voto, às 17h). **Nunca** quando a leitura **falhou**: falha continua mostrando "não recebemos
dados", sem número algum — a regra de 14/09 "nunca fabricar zeros para cobrir falha" fica intacta. Sem gate de
relógio (ADR-0043 D6): a decisão vem do dado, não de `new Date()`.

**4. Ordem sorteada e fixa.** Candidatos de todos os cargos, e as agremiações (partido/federação) nas listas de
deputado, são ordenados por sorteio diário determinístico (`lib/zerado/ordem.ts`): FNV-1a de 32 bits sobre
`seed|sqcand`, com `seed` = data do turno (`"2026-10-04"`, `"2026-10-25"`). A mesma ordem para todo leitor e
a cada recarga. Neutralidade (constituição § 2): ninguém é primeiro por número na urna nem por alfabeto;
estabilidade: a lista do telão não pula a cada atualização automática (ADR-0074). Isto **substitui** a
ordenação por número na urna do ADR-0043 D8.

**5. "Identifica, fala; mede, cala" dentro do leiaute de apuração (ADR-0043 D7).** Em modo zerado ficam
ocultos: chances/probabilidades, intervalos, "vence no 1º turno", contagem do tipo de corrida, painel de
restantes, redutos, agulha, margem, as pílulas "2º turno · projeção" e "Vaga projetada", as cores de líder nos
mapas, "mais votados"/"puxadores" e qualquer marca de eleito. Aparecem: nome, foto, partido, número, `0,0%`,
"0% apurado".

## Consequências

**Positivas**:
- Uma única tela de apuração do primeiro ao último boletim; às 17h só os números mudam, sem troca de leiaute.
- **Nenhuma escrita em produção** (Edge Config/Blob/banco) para a mudança: rollback por redeploy.
- Cobre os cargos e UFs que a tela de identidade do ADR-0043 não cobria (Estadual/Distrital, UFs sem payload).
- Ordem neutra e estável: mesma lista para todos e entre recargas, compatível com a atualização automática.
- A regra de 14/09 (nunca zeros fabricados para cobrir **falha de leitura**) é preservada e testável: o
  gatilho distingue "ausente/pré/vazio" de "falhou".

**Negativas**:
- **Leitor apressado pode ler zeros como "ninguém votou"** — risco que o ADR-0043 já nomeou (Contexto, D8) e
  que o dono aceitou outra vez; agora **agravado**, porque o aviso textual de espera foi retirado de propósito
  e só "0% apurado" conta o estado.
- **Congelamento de código de 12h do runbook do dia D** (`docs/sprints/_D1-04out2026.md`, passo 0.8) foi
  **suspenso pelo dono só para esta mudança**; ela entrou menos de 5 horas antes das 17h, com **verificação
  reduzida** (menos que o roteiro normal de gates antes de entrar no ar). Risco de regressão residual no
  horário de maior audiência.
- **Dependência de leitura do Blob de cadastro no render**: se `readCandidatosUf` falhar, a página cai em "não
  recebemos dados" (sem número), e o leitor perde a identidade que a tela do ADR-0043 também exigia do payload.
- **A lógica de "zerado" mora no consumidor**, em `lib/zerado/` e nas páginas: um componente novo que ignore o
  modo zerado reintroduz as mentiras numéricas do ADR-0043 (chances, "concluída", líder em cor). Mitigação:
  a lista de ocultação do item 5 é teste de página, não convenção.
- Carregamento extra de Blob por página zerada (custo de RNF-002/RNF-007a não medido no modo zerado) e a
  transição (3c) depende do primeiro ciclo real trazer candidatos; um ciclo de 17h com lista vazia em dado
  *real* é tratado como zerado — por desenho, mas confunde "ainda sem voto" com "sem candidatos" se o cadastro
  também estiver vazio (a página então fica sem lista).
- O sorteio é **determinístico e público**: quem ler o código pode prever a ordem. Aceito: o objetivo é
  neutralidade e estabilidade, não segredo.
- ADR-0043 fica com dois leiautes descritos no histórico (o dele e este); o leitor futuro precisa seguir a
  nota de emenda para saber qual vale.

## Cross-refs

- [ADR-0043](0043-fase-pre-eleicao-campo-proprio-nao-derivada.md) — supersedido parcialmente (D7/D8 leiaute e
  ordem); D1–D3, D5, D6 e o princípio de D7 permanecem.
- [ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md) — origem da exigência de ordem estável.
- [ADR-0075](0075-marca-de-eleito-so-com-eleicao-matematicamente-definida.md) — marca de eleito oculta em modo
  zerado.
- [ADR-0038](0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — nenhum carimbo de dado em modo zerado
  (não há dado).
- Spec 019 RF-133 — emendado nos casos ausente/pré/vazio; specs de página a listar este ADR em `adrs:`:
  `docs/specs/019-fase-pre-eleicao/spec.md` e as specs das páginas de cargo (Presidente, Governador, Senador,
  Deputado Federal/Estadual).
- Constituição § 1 (não afirmar além do dado — o item 5 e o gatilho do item 3), § 2 (neutralidade — item 4),
  § 8 (transparência metodológica — o estado é dito por "0% apurado").
- Memória do projeto: regra de 14/09 "três estados e não-regressão" (não fabricar zeros para cobrir falha).
- Runbook do dia D: `docs/sprints/_D1-04out2026.md` passo 0.8 (congelamento de 12h, suspenso para esta mudança).
- NFRs sob impacto: RNF-002 (LCP), RNF-007a (bundle above-the-fold), disponibilidade (gatilho distingue
  falha de ausência).
