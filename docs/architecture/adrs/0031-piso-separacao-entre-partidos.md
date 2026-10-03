---
id: ADR-0031
title: Piso de separação perceptual entre partidos (ΔE76 ≥ 12) na paleta editorial, não apenas distância ao hex oficial
status: accepted
date: 2026-09-08
---

# ADR-0031 — Piso de separação perceptual entre partidos, não apenas distância ao hex oficial

## Status

Aceito. Este ADR **emenda o ADR-0024** — não o supersede. A decisão de ter uma paleta editorial
própria por partido/federação continua integralmente vigente; este ADR acrescenta um **segundo
eixo de medição** que nem o ADR-0024 nem a constituição § 2 v1.3 cobriam: a distância entre as
cores da própria paleta, e não só entre cada cor e a marca do partido que ela representa. Inclui
proposta de emenda ao § 2 (**renumerada para v1.5 → v1.6 em 2026-09-20** — ver a nota na
seção de proposta) para o usuário aprovar; a edição de `docs/constitution.md`
não é feita por este documento.

## Contexto

A constituição § 2 v1.3 (fixada pelo ADR-0024) mede uma coisa: **ΔE76 ≥ 10 entre a cor editorial
do AtlasMenna e o hex oficial daquele partido** — a distância até a marca que a cor representa. É a
pergunta "isto não é a cor do PT". Nunca foi medida a pergunta simétrica — "isto não é a cor do
PSTU **também**" — porque nada no § 2, no ADR-0024 ou no processo de entrega do kit exigia comparar
os 31 tokens de partido **entre si**. O kit Atlas Menna (`docs/design-system/atlas-menna/tokens/
colors.css`) foi construído medindo cada cor contra a marca do respectivo partido, uma de cada vez;
nunca contra as outras 30 cores da própria paleta.

Medido em 2026-09-08 sobre os 465 pares das 31 bases (30 partidos + o fallback `outros`); 
em 2026-09-20 estendido para 496 pares (32 partidos + fallback, após PTB entrar), cinco
pares ficavam perceptualmente indistinguíveis:

| Par | ΔE76 |
|---|---|
| `--party-dc` `#3b6fb0` × `--party-pp` `#2c6fb0` | 2,52 |
| `--party-pco` `#a1332b` × `--party-pstu` `#9e2b2b` | 3,55 |
| `--party-pcb` `#b63a2e` × `--party-pco` `#a1332b` | 8,25 |
| `--party-mdb` `#2e8b57` × `--party-psd` `#2f8f6b` | 9,54 |
| `--party-pcb` `#b63a2e` × `--party-pstu` `#9e2b2b` | 9,98 |

Pior: a correção de acessibilidade de 2026-09-07, que criou o token `--party-<slug>-text` (a cor do
partido escurecida até alcançar 4,5:1 de contraste contra o papel, constituição § 4) tinha
**criado** uma colisão nova, invisível em qualquer auditoria que olhasse só as bases: PSB e PSOL
distavam ΔE76 10,51 como base (`#c9a227` × `#d6a400`) e **2,51** como texto (`#896c00` × `#8d6b00`).
Escurecer para satisfazer o § 4 comprimiu a distância que o § 2 supunha garantida — dois ouros
viraram o mesmo marrom exatamente no lugar em que a confusão é mais cara, um número escrito. Uma
correção de um princípio quebrou silenciosamente uma invariante de outro.

Uma paleta cujo propósito declarado é responder **qual** partido, e que dá a mesma cor a dois
deles, não cumpre o § 2 — mesmo respeitando a letra dele. A distinguibilidade entre as cores é
**consequência necessária** do propósito do § 2, não uma regra nova inventada pelo time: o § 2
nunca disse "meça só contra fora", disse "a cor identifica o partido" — e identificar dois partidos
diferentes com a mesma cor não é uma leitura estrita do texto, é uma lacuna que ninguém tinha
fechado porque ninguém tinha medido.

## Decisão

O gerador `scripts/gen-party-scale.ts` (seção 7b) passa a medir, além do ΔE76 contra os hexes
oficiais, o ΔE76 **entre cada par de partidos diferentes**, e falha a geração — código de saída ≠ 0
— se algum par ficar abaixo do piso.

**O gate.** `PARTY_SEPARATION_FLOOR = 12`. Medidos os três papéis que **identificam** um partido
sem rótulo que os desambigue — `--party-<slug>` (base: contorno, ponto, preenchimento),
`--party-<slug>-chip` (fundo do chip sólido) e `--party-<slug>-text` (a cor como tinta sobre
papel) — para os 496 pares de 32 partidos (2026-09-20: PTB adicionado), dá **1.488 medições**
(era 1.395 com 31 partidos). `--party-<slug>-ink` fica fora: é
preto ou branco fixo do kit, não cor de partido: duas siglas com a mesma tinta é o esperado, não um
defeito. O gerador refaz a conta e falha a geração se algo violar; `tests/unit/design-system/
party-separation.test.ts` refaz a mesma conta, com colorimetria **reimplementada** (não importada
do gerador), sobre o CSS commitado (`app/tokens-party.css`), a cada `pnpm test` — um teste que
importasse a função que quer verificar não verificaria nada. O par mais apertado hoje, depois da
correção, é `--party-democrata-text` (`#4b5563`) × `--party-outros-text` (`#6b7078`), a **12,09**.

**Emenda 2026-09-20 — o gate ganhou um SEGUNDO alvo e um SEGUNDO piso.** A conta acima mede
a paleta **contra ela mesma**, e só. Foi essa lacuna que deixou passar uma colisão real: quando a
cor de candidatura deixou de vir da posição na lista (ADR-0013, emenda de 2026-09-20), toda sigla
sem token próprio passou a usar a família `--party-outros` — e o nível 1 dela ficou a **ΔE76 2,39**
de `--map-uncounted`, o neutro de "sem apuração". Na view "margem" do mapa, um estado quase
empatado ficava indistinguível de um estado onde ninguém apurou nada, o que colide com a decisão
do dono de 2026-09-14 (não começou / não sabemos / apurando são TRÊS estados).

`tests/unit/design-system/party-separation.test.ts` passou a medir também o bloco `MAP_PAIRS`:
**101 medições por tema** contra `--map-uncounted` — `--party-outros` em 3 papéis mais os 5 níveis
da rampa, e os outros 32 partidos em 3 papéis —, com piso
**`MAP_UNCOUNTED_SEPARATION_FLOOR = 10`**, mais um teste de cobertura que trava o total (sem ele,
apagar metade do laço não reprovaria nada).

**Por que 10 e não 12 neste segundo alvo.** O piso de 12 carrega 2 unidades de folga específicas
contra *revisão de hex oficial de terceiro* — um partido pode mudar a própria cor e nos obrigar a
remedir. `--map-uncounted` é token nosso e não muda sozinho, então a folga não se aplica. O 10
reusa o `PISO_DELTA_E` que `components/blocks/_swingRamp.ts` (2026-09-18) já aplicava à mesma
pergunta, contra o mesmo `--map-uncounted`.

⚠️ **O que este gate NÃO fecha, e é dívida aberta:** ele mede os 32 partidos reais só nos três
papéis de identidade, **não nos níveis da rampa**. Medido em 2026-09-20: `--party-<slug>-1` de
**15 dos 32** partidos fica abaixo de 10 contra `--map-uncounted` no tema claro (4 no escuro), pior
real `--party-dc-1` a 7,44 — e o PTB, acrescentado no mesmo dia, nasceu a 7,56. É redesenho da
rampa inteira, não conserto pontual. Ver `docs/reference/dividas-tecnicas.md`.

**Por que o piso é 12, e não outro número.** É deliberadamente o mesmo `DELTA_E_FLOOR` que o
repositório já opera contra os hexes oficiais — a mesma pergunta perceptual ("estas duas cores são
a mesma?") não pode ter duas respostas diferentes conforme o lado da comparação. E 12 cai dentro de
um vão real do próprio dado: ordenados, os 465 pares iam 9,98 · 11,69 · **vão vazio** · 12,09 ·
12,13 — o piso separa dois agrupamentos que já existiam, em vez de cortar no meio de um. Custo
medido por piso candidato (pares reprovados / partidos envolvidos / hexes mínimos a mudar):

| Piso | Pares reprovados | Partidos envolvidos | Hexes a mudar (mínimo) |
|---|---|---|---|
| 10 | 6 | 9 | 5 |
| **12** | **7** | **11** | **6** |
| 14 | 14 | 19 | 9 |
| 16 | 15 | 20 | 10 |
| 18 | 20 | 24 | 10 |
| 20 | 25 | 25 | 14 |
| 25 | 41 | 30 | 16 |

10 cortaria rente ao mínimo constitucional sem folga nenhuma e absolveria pares que já se confundem
(ex.: PCB × PSTU passaria por 0,02, e Avante × PRD a 11,69, dois violetas, ficaria dentro). 14 já
dobra os pares reprovados e quase dobra os partidos envolvidos, e o que 14 "compraria" a mais são
azuis institucionais que já se distinguem lado a lado (DC × Republicanos a 12,13, PP × Republicanos
a 12,35) — pagar-se-ia meia paleta redesenhada para resolver confusão que ninguém tinha. 12 é o
ponto em que corrigir uma colisão real ainda é corrigir, não redesenhar.

**Por que os níveis 1..5 ficam fora do gate — e não por esquecimento.** Os cinco níveis de
intensidade (`--party-<slug>-1..5`) são alvos **absolutos** de L\*/C\* iguais para todos os
partidos (`RAMP_L = [90, 76, 58, 42, 29]`, `RAMP_C = [10, 26, 48, 66, 53]`) — é literalmente o que
o § 2 v1.3 exige ("apenas a intensidade pode variar, nunca a matiz"). Isso significa que o nível 1
de todo partido mora no mesmo círculo, L\* 90 / C\* 10, variando só em ângulo (matiz). Distribuídos
32 pontos nesse círculo (2026-09-20: com PTB), a menor distância possível no melhor arranjo geométrico é
`2 · 10 · sen(180°/32) ≈ 1,96` de ΔE76 — abaixo de qualquer piso razoável, e **matematicamente
abaixo de 12 por construção**, não por falha de escolha de hex. Exigir 12 ali seria exigir o
impossível. E é desnecessário: o nível comunica **margem** (1 = disputa apertada, 5 = decisivo),
não identidade — quem responde "qual partido" são a base, o chip e a tinta, os três papéis que o
gate cobre. `tests/unit/design-system/party-separation.test.ts` trava essa prova em código (a
`sen(π/31)` calculada e comparada ao piso), justamente para que uma futura tentativa de "consertar"
essa exclusão — apertando o gate para cobrir os níveis também — quebre em teste com a aritmética
explícita, em vez de travar a geração para sempre sem ninguém entender por quê.

**O gate irmão: colapso de croma no nível 5.** `LEVEL5_CHROMA_RATIO_FLOOR = 0.6` — o nível 5
("decisivo") não pode perder mais de 40% do croma do nível 4. Isto é sobre **comunicação**, não
estética: a rampa é lida como escala de margem, e cada degrau precisa continuar parecendo a cor do
partido, só mais densa — se um degrau muda de família perceptual (satura para cinza), ele mente
sobre a escala para o leitor, que aprende a ler "mais escuro e mais neutro" como "mais decisivo"
quando na verdade é só onde o solver de ΔE76 encontrou a saída mais barata. O solver que empurra
cores para fora do raio proibido de um hex oficial minimiza custo `(2·ΔL)² + ΔC²`; quando um oficial
escuro fica no caminho, reduzir croma é sistematicamente a saída mais barata, e nada no processo
reclamava disso antes deste ADR. Foi o caso do PP: nível 5 saía com C\* 15,0 contra C\* 43,8 do
nível 4 (razão 0,34, um cinza-ardósia) enquanto os outros 30 partidos ficavam entre 0,71 e 1,02. O
piso 0,60 fica no vão entre 0,34 (o defeito medido) e 0,71 (o pior caso legítimo, `--party-pl`,
limitado pelo gamut do azul) — pega o colapso sem encostar em nenhuma rampa que o gamut aperta
honestamente.

**Seis hexes mudaram** — calculados por `pnpm gen:party-scale --suggest` (gerador, seção 7c), com
cobertura mínima de vértices do grafo de colisão e menor deslocamento total no desempate, sem
olhar para quem é o partido em nenhuma das três regras:

| Partido | De | Para | ΔE76 do deslocamento | Motivo |
|---|---|---|---|---|
| `--party-avante` | `#7a4fb3` | `#794cae` | 1,64 | colidia com PRD (11,69) |
| `--party-pstu` | `#9e2b2b` | `#97272b` | 3,31 | triângulo PCB/PCO/PSTU |
| `--party-mdb` | `#2e8b57` | `#408a50` | 5,35 | colidia com PSD (9,54) |
| `--party-pco` | `#a1332b` | `#9d4227` | 9,79 | triângulo PCB/PCO/PSTU |
| `--party-psb` | `#c9a227` | `#b6a92a` | 12,10 | `-text` colidia com PSOL (2,51) |
| `--party-pp` | `#2c6fb0` | `#0f60b3` | 13,49 | rampa colapsada + DC (2,52) |

**O critério de resolução, e por que é politicamente neutro.** Três regras lexicográficas, nesta
ordem, implementadas em `pnpm gen:party-scale --suggest`:

1. **Menos hexes alterados** — se um par colide e nenhum dos dois se move, o par continua
   colidindo; o conjunto mínimo que resolve todo par em conflito é uma **cobertura de vértices** do
   grafo cujas arestas são as colisões, enumerada por força bruta componente conexa por componente
   conexa (2 a 4 vértices cada). Partidos com defeito próprio (o PP, cuja rampa colapsa
   independentemente de colidir com alguém) entram forçados antes da cobertura — o PP muda de
   qualquer forma, então arestas que ele toca (DC) já saem cobertas de graça.
2. Empatado, **menor deslocamento total** — soma dos ΔE76 entre hex antigo e novo, o que decide,
   por exemplo, qual dos três vermelhos do triângulo PCB/PCO/PSTU fica parado (o PCB).
3. Empatado, **ordem alfabética de slug** — desempate cego a qualquer atributo do partido: tamanho
   de bancada, espectro, relevância eleitoral.

Nenhuma das três regras conhece bancada, ideologia ou histórico eleitoral — a entrada do solver é
só a tabela de hexes e a tabela de oficiais. O teste do critério é o **DC**: ficou parado apesar de
estar na pior colisão da paleta inteira (2,52 com o PP), porque o PP já ia mudar por causa da
própria rampa e mover os dois violaria a regra 1. PSD, PSOL e PRD ficaram parados pelo mesmo
motivo em seus respectivos pares. Cada hex novo continua obedecendo todos os gates antigos (ΔE ≥ 12
dos oficiais daquele partido, rampa monotônica em L\*, matiz constante, chip/tinta e `-text` ≥
4,5:1) — nenhuma regra existente foi relaxada para acomodar a correção.

## Consequências

**Positivas**:
- A paleta agora cumpre, de forma auditável e recomputável (`pnpm gen:party-scale --report`), a
  promessa que ela sempre teve — responder **qual** partido — em vez de só cumprir a letra do § 2
  contra o hex oficial.
- O critério de resolução de colisão é mecânico e reproduzível: qualquer agente pode rodar
  `--suggest` e obter exatamente os mesmos seis hexes, sem julgamento humano sobre qual partido
  "merecia" manter sua cor — importante num produto de apuração eleitoral, onde essa aparência de
  arbítrio seria ela mesma um risco de neutralidade.
- O gate de colapso de croma impede que uma futura correção de ΔE76 (contra oficiais ou entre
  partidos) volte a produzir silenciosamente um nível 5 acinzentado — o defeito do PP não vai se
  repetir sem que a geração falhe.
- A exclusão dos níveis 1..5 do gate está provada em teste (não em comentário), o que impede que a
  próxima pessoa a mexer nisso trave a geração permanentemente tentando "consertar" uma
  impossibilidade aritmética.

**Negativas**:
- **Seis partidos deixaram de ter a cor que o designer originalmente escolheu** — `avante`, `mdb`,
  `pco`, `pp`, `psb`, `pstu`. A troca foi decidida por um solver geométrico cego, não por ninguém
  avaliando a identidade visual de cada partido; é o preço deliberado da neutralidade do critério.
- **O par mais apertado da paleta passa raspando**: `--party-democrata-text` × `--party-outros-text`
  a ΔE76 12,09, apenas **0,09 acima do piso**. Não passou pelo solver (ficou parado pela regra 1 —
  nenhum dos dois tocava outra colisão), mas qualquer mudança futura nas superfícies de papel
  (`--surface-page`, `--surface-card`) ou no hex do fallback `--party-outros` reabre este caso sem
  aviso — é o par que a próxima revisão da paleta precisa checar antes de qualquer outra coisa.
- **O dark mode (Bloco 2) vai reabrir tudo isto.** Nenhum destes tokens tem variante escura ainda —
  só PT e PL têm rampa desenhada no kit para `[data-theme="dark"]`. Medido contra os fundos escuros
  do kit (`#1C1F24`/`#14171B`), **13 das 31 bases já reprovam o piso de 3:1 de objeto gráfico**:
  `avante`, `democrata`, `pcb`, `pcdob`, `pco`, `pdt`, `pl`, `pp`, `pstu`, `pv`, `republicanos`,
  `uniao`, `up`. O Bloco 2 vai precisar gerar as 29 rampas escuras que faltam **e** rodar de novo
  todos os gates deste ADR (separação mútua, colapso de croma) e do ADR-0024 (ΔE contra oficiais,
  contraste) sobre a paleta escura inteira — nada aqui garante que os hexes escuros vão passar sem
  suas próprias correções. Este ADR resolve o tema claro; o escuro é trabalho não iniciado, não
  uma extensão trivial.
- **A rotação de matiz do PP** (272,3° → 280,9°) é o único hex da paleta que mudou de matiz — todos
  os outros cinco preservaram matiz e só mudaram L\*/C\*. É um precedente: corrigir um colapso de
  croma pode exigir girar matiz em vez de só ajustar L\*/C\*, o que o solver de sugestão já
  contempla (varredura de h ±60°) mas que qualquer revisão manual futura precisa saber que existe
  como saída legítima.
- **1.395 medições por execução de teste/geração é custo que cresce quadraticamente** com o número
  de partidos. Hoje (31 slugs) é barato; se a lista crescer de forma significativa (novas legendas,
  novas federações homologadas), este é o primeiro gate O(n²) do repositório a reconsiderar em
  custo de CI.

## Proposta de emenda ao § 2 da constituição

> 🔴 **RENUMERADA em 2026-09-20: esta proposta passa a ser `1.5 → 1.6`.**
> Ela foi escrita como "1.4 → 1.5" e **nunca foi aprovada nem aplicada**. Em
> 2026-09-20 o dono aprovou outra emenda ao mesmo § 2 — a exceção de ordem por
> base ativa, [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) —
> que ocupou a 1.5 e já está em `docs/constitution.md`. O texto abaixo continua
> válido no mérito (piso ΔE76 ≥ 12 **entre** as cores da paleta, que o § 2
> vigente ainda não menciona); só o rótulo de versão mudou. Quem aplicar deve
> escrever "Mudança 1.5 → 1.6" e conferir se 1.6 ainda está livre.


Texto para aprovação do usuário — a edição de `docs/constitution.md` (versão **1.5 → 1.6**, ver a
nota de renumeração acima; com nota de
cabeçalho análoga às mudanças anteriores) só deve ser feita **depois** da aprovação explícita, e não
é feita por este ADR. A mudança acrescenta uma frase ao primeiro parágrafo do § 2, sem alterar mais
nada:

> ## 2. Neutralidade política
>
> - Cores partidárias seguem uma **paleta editorial própria do AtlasMenna** — uma cor por
>   partido/federação, documentada com hex exato em `docs/design-system/tokens.md` — **nunca** as
>   cores oficiais de partido. Toda cor de partido deve ter **ΔE76 ≥ 10** em relação ao hex oficial
>   documentado do partido (manual de marca ou uso reiterado em material oficial), critério
>   auditável e verificável por qualquer agente ou revisor. **Toda cor de partido deve, além disso,
>   ter ΔE76 ≥ 10 de distância de toda cor de qualquer outro partido, nos tokens que identificam o
>   partido sem rótulo que os desambigue — a paleta existe para responder qual partido, e duas
>   cores indistinguíveis não respondem nada; esta exigência não se aplica às variações de
>   intensidade por margem dentro da rampa de um mesmo partido, que por construção variam apenas em
>   claridade/saturação, nunca em matiz.** A cor de cada partido é **estável durante toda a noite de
>   apuração** e entre as duas noites do pleito (1º e 2º turnos): não muda por rank, por ordem de
>   apuração, por margem ou por qualquer evento da corrida — apenas a **intensidade**
>   (claro↔saturado) pode variar com a margem projetada, nunca a matiz.
> - Nomes de candidatos e siglas partidárias aparecem **sempre na mesma ordem** dentro de uma mesma
>   corrida (sem favorecimento por ordem de leitura).
> - Insights gerados por templates **não emitem julgamento** ("Lula consolida vitória" é OK;
>   "vitória esmagadora" não é).
> - Quando há ambiguidade na atribuição de bloco político 2022→2026, exibir disclaimer explícito.

O piso constitucional proposto (≥ 10) fica, de propósito, igual ao piso já existente contra hexes
oficiais — a mesma folga de 2 unidades que o repositório aplica como margem operacional (12) segue
documentada em `DELTA_E_FLOOR`/`PARTY_SEPARATION_FLOOR` e em `docs/design-system/tokens.md`, não na
constituição, pelo mesmo motivo pelo qual o piso operacional de 12 contra oficiais também não está
no texto constitucional: a margem de segurança é uma decisão de engenharia revisável, o mínimo é o
princípio.

## Alternativas consideradas

- **Piso 10 (o mínimo constitucional, sem margem operacional)** — rejeitada: corta rente ao limite
  perceptual sem folga nenhuma, e absolve pares que a mesma pergunta ("são a mesma cor?") já
  reprovaria a olho — Avante × PRD ficaria dentro a 11,69.
- **Piso 14 ou acima** — rejeitada: o custo salta de correção para redesenho (7→14 pares, 11→19
  partidos, 6→9 hexes só entre 12 e 14; ver tabela na Decisão), comprando separação entre azuis
  institucionais que já se distinguem lado a lado.
- **Reatribuição manual das cores por julgamento de designer**, em vez de solver algorítmico —
  rejeitada: reintroduz exatamente a pergunta que a cobertura mínima + desempate alfabético existe
  para evitar — "quem decidiu que o PT mantém a cor e o MDB muda?" — inaceitável de aparência
  arbitrária num produto de apuração eleitoral.
- **Gatear só a cor base, sem `-chip`/`-text`** — rejeitada: foi exatamente a colisão PSB × PSOL no
  papel `-text` (10,51 na base, 2,51 na tinta) que motivou medir os três papéis; um gate só na base
  teria deixado essa colisão viva, do mesmo jeito que deixou originalmente, quando só o ΔE contra
  oficiais era medido.
- **Estender o gate aos níveis 1..5** — rejeitada por impossibilidade aritmética, não por escolha:
  ver a prova do círculo L\* 90/C\* 10 na Decisão, travada em teste.

## Cross-refs

- ADR-0024 (paleta editorial própria por partido — este ADR emenda, sem supersedir):
  [0024-paleta-editorial-por-partido.md](0024-paleta-editorial-por-partido.md)
- Constituição § 2 (v1.3 vigente hoje; proposta de emenda 1.4→1.5 acima):
  [../../constitution.md](../../constitution.md#2-neutralidade-política)
- Constituição § 4 (acessibilidade — a correção de contraste de 2026-09-07 é a origem da colisão
  PSB×PSOL que este ADR fecha; mesma dinâmica de "gate de um princípio compromete outro" nomeada
  como precedente): [../../constitution.md](../../constitution.md)
- Constituição, preâmbulo (exige ADR + versionamento explícito para mudar princípio):
  [../../constitution.md](../../constitution.md)
- `scripts/gen-party-scale.ts` — seção 7b (gate de separação e colapso de croma) e 7c (solver de
  colisão mínima): fonte de `PARTY_SEPARATION_FLOOR`, `LEVEL5_CHROMA_RATIO_FLOOR`,
  `separationFailureMessage`.
- `tests/unit/design-system/party-separation.test.ts` — prova independente sobre o CSS commitado,
  incluindo a prova aritmética de por que os níveis 1..5 ficam fora do gate.
- `docs/design-system/tokens.md` — seção de paleta, já atualizada com as tabelas de colisão, custo
  por piso, hexes trocados e a nota de dark mode reproduzidas neste ADR.
- `lib/utils/party-color.ts` — consumidor dos tokens gerados; não afetado em contrato por este ADR.
