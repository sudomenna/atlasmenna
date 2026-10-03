# Véspera da eleição — passo a passo para pôr o site "armado" (03/10/2026)

> **Para o dono.** Escrito para ser seguido na ordem, sem precisar lembrar de nada.
> Cada passo diz **o que fazer**, **o comando exato** (quando houver) e **o que você deve ver**.
> Se o que aparecer for diferente do "você deve ver", **pare** e chame o Claude com o print.
>
> Detalhe técnico e histórico: [`../sprints/_trilho-externo.md`](../sprints/_trilho-externo.md) § Item 2,
> [`../reference/risks.md`](../reference/risks.md) (linha "TODA a configuração do TSE existe apenas em
> `Preview`") e o cabeçalho de [`../../scripts/vigia-armado.ts`](../../scripts/vigia-armado.ts).

## Por que isto existe, em três frases

Para buscar resultados, o site precisa de **dois números de identificação da eleição** que o TSE só
publica na véspera. Eles têm de ser colocados no cofre de configuração de **Produção** da Vercel — o
robô que busca resultados a cada 30 s **só roda em Produção**. Se faltarem, na noite de 04/10 o site
mostra "Aguardando o primeiro boletim" a noite toda, igual à tela normal de antes das 17h, e
**ninguém percebe** que nada está sendo apurado.

---

## Parte 0 — Até 02/10 (preparação, 15 minutos, uma vez)

- [ ] **0.1. Religar a vigia de configuração.** Em 27/09 ela respondeu "não consegui olhar" — o
      programa da Vercel desta máquina provavelmente perdeu o login. Rode:
      ```bash
      cd ~/Projetos/AtlasMenna && vercel login
      ```
      ```bash
      cd ~/Projetos/AtlasMenna && vercel whoami
      ```
      **Você deve ver** o nome da conta (`sudomenna` ou a do time). Se pedir para "linkar", rode
      `vercel link` e escolha o projeto `atlasmenna`.

- [ ] **0.2. Rodar a vigia no modo "dia D".**
      ```bash
      cd ~/Projetos/AtlasMenna && pnpm vigia:armado --modo dia-d
      ```
      **Você deve ver**, ANTES de 03/10 (medido em 27/09): estado **"desarmado"**, `faltando` **vazio** e
      `sobrando` com **exatamente** `TSE_BASE_URL`, `INGEST_WINDOW` e `EDGE_CONFIG_ID`.
      Isso é **esperado**: desde 22/09 a produção está configurada para o **simulado** — os dois números
      da eleição que já existem lá são os do simulado, `TSE_BASE_URL` aponta para o site de simulado do
      TSE, `INGEST_WINDOW` é o horário diurno (9h–17h) e `EDGE_CONFIG_ID` desvia a gravação para um
      armazenamento que o site público não lê (por isso nenhum número de teste aparece no site).
      🔴 **NÃO mexa em nada disso antes de 03/10, e nunca em partes.** A virada é feita de uma vez na
      Parte 2 — tirar só o endereço deixaria os números do simulado apontando para o site real do TSE
      (endereço inexistente, que pode bloquear a máquina por 10 minutos); tirar só o desvio poria
      números do simulado no site público.
      - Se aparecer em `sobrando` qualquer outra (`INGEST_WINDOW_OVERRIDE`, `TSE_GRANULARIDADE`,
        `TSE_CARGOS`, `TSE_MAX_RPS`) ou em `faltando` qualquer coisa: **pare e chame o Claude**.

- [ ] **0.3. Olhar o TSE uma vez por dia** (manhã) até aparecerem os números de 2026:
      ```bash
      cd ~/Projetos/AtlasMenna && pnpm tse:watch --once
      ```
      **Você deve ver** `changed=false` enquanto nada mudou. Quando o TSE publicar, aparece em
      MAIÚSCULAS **`ELEIÇÃO GERAL 2026 DETECTADA`**.
      ⚠️ "mudou" (código 2) **não é prova sozinho**: em setembro o vigia gritou 8 vezes por lentidão
      de rede. Leia **qual linha** mudou; se for só um leiaute com tempo esgotado, rode de novo.

- [ ] **0.4. Combinar quem está de plantão em 03/10.** É o único passo do projeto que não pode ser
      antecipado. Anote o nome em [`../sprints/_D1-04out2026.md`](../sprints/_D1-04out2026.md) § "Quem
      está de plantão".

- [ ] **0.5. Apontar a vigia do terminal para a gaveta do site.** Em 27/09 o `pnpm vigia:ciclo`
      desta máquina lê a gaveta de **ensaio** do simulado (`salacofre-edge-config-preview`), não a
      que o site público mostra (`salacofre-edge-config`). Na noite de 04/10 ela gritaria "parado"
      em falso a noite toda — ou pior, ficaria calada quando devia gritar.
      1. Vercel → **Storage** → store **`salacofre-edge-config`** (o **sem** "preview") →
         **Tokens** → copie a linha de conexão (começa com `https://edge-config.vercel.com/`).
      2. Abra o arquivo `~/Projetos/AtlasMenna/.env.local`, ache a linha que começa com
         `EDGE_CONFIG=` (**não** `EDGE_CONFIG_ID` nem `EDGE_CONFIG_TOKEN`) e troque o que vem
         depois do `=` pelo que você copiou. Salve.
      3. Confira:
         ```bash
         cd ~/Projetos/AtlasMenna && pnpm vigia:ciclo
         ```
         **Você deve ver** `"idade_min":null`. Se vier um número grande (milhares de minutos),
         ainda está na gaveta do ensaio. Se disser que está "cega", a linha copiada foi a errada.
      (Origem: [`runbook.md`](./runbook.md) § "Desarmar" — o item estava lá e faltava aqui.)

---

## Parte 1 — 02 ou 03/10: lista de candidatos atualizada (o mais tarde possível)

Substituições e renúncias entram até a véspera. **A ordem não é sugestão** — rodar fora de ordem
publica a lista sem fotos, sem erro nenhum na tela.

- [ ] **1.1.** Nesta ordem, um de cada vez, esperando cada um terminar:
      ```bash
      cd ~/Projetos/AtlasMenna && set -a; . ./.env.local; set +a; pnpm candidatos:import --force
      ```
      ```bash
      cd ~/Projetos/AtlasMenna && set -a; . ./.env.local; set +a; pnpm candidatos:fotos --force
      ```
      ```bash
      cd ~/Projetos/AtlasMenna && set -a; . ./.env.local; set +a; pnpm candidatos:publish
      ```
      **Por que o `--force` nos dois primeiros:** sem ele, o computador reaproveita a lista e as
      fotos que baixou da última vez (a de 12/09) em vez de buscar as de hoje no TSE. Com ele,
      busca tudo de novo. As fotos demoram mais com `--force`, porque todas sobem de novo.

      Se o primeiro comando parar com **`CACHE VELHO`** em letras grandes, ele não gravou nada:
      a lista que ele leu é de outro dia. Confira se o `--force` está no comando e rode de novo.
- [ ] **1.2.** Redeploy de produção (ver 2.3). Sem ele o site serve a lista velha por até 12 horas.

---

## Parte 2 — 03/10: os dois números da eleição

- [ ] **2.0. De manhã, rodar o vigia do TSE** (0.3). Quando aparecer `ELEIÇÃO GERAL 2026 DETECTADA`,
      anote **os dois números**, **de onde vieram** e **o horário**:
      - **Eleição Federal** (Presidente) → vai em `TSE_COD_ELEICAO_FEDERAL`
      - **Eleição Estadual** (Governador, Senado, Deputado) → vai em `TSE_COD_ELEICAO_ESTADUAL`

      O valor tem o formato **`ele2026/<número>`** — exemplo de formato (NÃO são os números reais):
      `ele2026/12345`. O sistema recusa qualquer outro formato.
      🔴 **Nunca adivinhe e nunca reaproveite os números do simulado** (`21270`/`21272`, que são os que
      estão em Produção hoje): eles só existem no site de simulado do TSE. Os números `6257`/`6259` que apareceram e sumiram em 18/09 **também não servem**
      sem o TSE confirmá-los de novo.
      **Se até o meio-dia não aparecer nada:** abrir chamado no TSE, telefone **(61) 3030-8800**,
      portal `30308800.tse.jus.br`, assunto começando com **"Resultados - Divulgação"**. Não tente
      endereços na mão — endereço errado pode bloquear o acesso da máquina ao TSE por 10 minutos.

- [ ] **2.1. A virada no painel da Vercel — tudo de uma vez, nesta ordem, sem publicar no meio.**
      Vercel → projeto **atlasmenna** → **Settings** → **Environment Variables**. Filtre por
      **Production**.
      1. **Editar** `TSE_COD_ELEICAO_FEDERAL` → **Value** = o número **Federal** anotado
         (`ele2026/<número>`). Confira que o ambiente continua **só Production**.
      2. **Editar** `TSE_COD_ELEICAO_ESTADUAL` → **Value** = o número **Estadual** anotado.
      3. **Apagar** (em Production) `TSE_BASE_URL` — o endereço certo do dia D já é o padrão.
      4. **Apagar** (em Production) `INGEST_WINDOW` — o padrão é 17h–04h, o horário da noite.
      5. **Apagar** (em Production) `EDGE_CONFIG_ID` — 🔴 **o mais importante**: se sobrar, na noite o
         robô grava num armazenamento que o site não lê, e a tela fica "Aguardando" até o fim.
      ⚠️ **Não copie nada do ambiente Preview.** Uma eleição não supre a outra: sem a Estadual,
      Governador, Senado e Deputado não apuram. As mudanças só valem depois do passo 2.3.

- [ ] **2.2. Conferir com a vigia.**
      ```bash
      cd ~/Projetos/AtlasMenna && pnpm vigia:armado --modo dia-d
      ```
      **Você deve ver** estado **"armado"**, `faltando` e `sobrando` vazios. (A vigia confere que as
      configurações existem ou não — ela **não consegue ler os valores**, então confira duas vezes, no
      painel, que os dois números digitados são os do TSE de 03/10, e não os do simulado `21270`/`21272`.)

- [ ] **2.3. Redeploy de produção** — configuração nova só vale para uma publicação feita **depois**
      dela. Vercel → **Deployments** → o mais recente marcado **Production** → menu **⋯** →
      **Redeploy**. **Você deve ver** o novo deployment ficar **Ready** e **Current**.

- [ ] **2.4. Conferir que o sistema monta a lista de pedidos ao TSE sem erro** com o número
      Federal anotado (troque `<número>` pelo número, sem os sinais `<` `>`):
      ```bash
      cd ~/Projetos/AtlasMenna && set -a; . ./.env.local; set +a; TSE_COD_ELEICAO_FEDERAL=ele2026/<número> pnpm list-targets --env production --cargo 1
      ```
      **Você deve ver** `Total de alvos: 6133` (6.105 zonas + 27 estados + 1 nacional), sem
      mensagem de erro. Este passo prova que o número tem o formato certo e que a lista de zonas
      está completa — ele **não** lê a Vercel; quem confere a Vercel é o 2.2.
      (Até 27/09 este passo estava escrito sem o `.env.local` e sem o número, e quebrava.)
      ⚠️ **6.133 vale depois da correção ESTRUTURAL de zonas de 29/09** (`--so-estrutural
      --remover-fantasmas`: insere Macapá 14 e Noronha 4 em `zonas` e remove 7 pares que o TSE não
      lista — 6.138 + 2 − 7; [runbook § Zonas faltantes](./runbook.md)). Antes dela o número era
      **6.138**; se aparecer 6.138, a correção **não foi gravada** — pare e chame o Claude, não
      "conserte" o número neste passo. Os **pesos** (`--pesos-oficiais`, arquivo do TSE) não mudam
      este número: mexem só em `eleitorado`.

- [ ] **2.5. Recife zona 1 (PE 25313×0001) — decidir com a lista oficial da eleição real** (decisão
      do dono em 30/09). Em 29/09 o par foi removido de `zonas` como "fantasma" porque o EA12 do
      **simulado** não o lista; em 30/09 o cadastro oficial de 2026 (`perfil_eleitorado_2026.zip`)
      mostrou **117.216 eleitores** nele. Peça ao Claude: conferir se o EA12 da eleição **real**
      (config publicada com os números 6257/6259) lista Recife 0001.
      - **Se listar:** reinserir o par em `zonas` (o `desfazerSql` de
        `build/zonas-backup-20260929T181107Z.json` tem a linha) e gravar os pesos oficiais de PE:
        `pnpm db:zonas:faltantes --pesos-oficiais build/tse-archives/perfil_eleitorado_2026_AP-PE-DF.csv --uf PE --col-qt QT_ELEITORES` (simulação; depois `--escrever`). O 2.4 passa a esperar **6134**.
      - **Se não listar:** nada muda; PE fica com os pesos de 2024 (Σ −2,6% do oficial).
      AP e DF já estão com os pesos oficiais desde 30/09 (backup `build/zonas-backup-20260930T172318Z.json`).
      ✅ **FEITO em 03/10 ~14h20 (autorizado pelo dono).** O EA12 real (`ele2026/6259/config/mun-e006259-cm.json`,
      `dg` 02/10) **lista** Recife 0001 — e mostrou mais uma diferença: **RR Bonfim (03077) e Normandia (03115)
      passaram da zona 5 para a 9** (o perfil_eleitorado_2026 confirma). Gravado, cada passo com backup em `build/`:
      1. `--so-estrutural --ea12 <EA12 real>` → `zonas` +3 (PE 25313×1, RR 03077×9, RR 03115×9).
      2. `--pesos-oficiais … --uf PE` → PE fecha com o arquivo oficial (7.225.744; backup `20261003T171718Z`).
      3. Remoção de RR 03077×5 e 03115×5 (`zonas` e `eleitorado`; backup `20261003T171828Z`). Os 94/85 snapshots
         desses pares eram todos do simulado (antes do corte ADR-0054) e **continuam no banco** (§ 10); para isso a
         lista de fantasmas e a contagem de snapshots foram ajustadas só para essa execução e devolvidas ao estado
         anterior (o código na `main` não mudou).
      4. `--pesos-oficiais … --uf RR` → RR fecha com o arquivo oficial (401.496; backup `20261003T171841Z`).
      Conferência final: o banco bate par a par com o EA12 real — **6.106 pares, todos com peso, nenhum aviso**.
      O 2.4 passa a esperar **`Total de alvos: 6134`** (medido em 03/10 com `ele2026/6257`).

---

## Parte 3 — 03/10 depois das 17h: a prova de verdade

O robô só busca resultados entre **17h e 04h** (horário de Brasília). Às 17h de 03/10 ele já vai
rodar com os números novos — é o ensaio real da noite seguinte.

- [ ] **3.1. Às 17h05, olhar os registros da Vercel.** Vercel → projeto → **Logs** → filtrar por
      `/api/ingest`. **Você deve ver** chamadas com resposta **200** a cada minuto (duas por
      minuto é normal: Presidente e Governador), a linha `ingest ciclo concluído`, e **nenhuma**
      mensagem começando por **`Nem TSE_COD_ELEICAO`** (essa frase é exatamente o defeito que
      este passo a passo existe para evitar).
- [ ] **3.2. Olhar o site.** Na noite de 03/10 ainda não há voto: **você deve ver** a tela de espera
      ("Aguardando o primeiro boletim" ou a tela de pré-eleição). Se aparecer **qualquer percentual
      de candidato**, **pare e chame o Claude** — seria número que não devia estar lá.
- [ ] **3.3. O ensaio da vigia da noite.** De 17h a 23h59 a tarefa agendada **"Vigia da noite —
      1º turno"** roda a cada 10 min em modo **ensaio**. Na primeira rodada (17h00–17h10), abra o
      app do Claude e **aprove as permissões que ela pedir** — assim, na noite de 04/10, ela não
      trava esperando você. **Você deve ver** relatórios começando por "ENSAIO 03/10", e
      notificação no celular **só** se algo estiver vermelho.
- [ ] **3.4.** Se 3.1, 3.2 ou 3.3 falharem: **não mexa em mais nada** e chame o Claude com o print. Há a
      noite de 03/10 e a manhã de 04/10 para consertar; às 17h de 04/10 não há mais.

---

## Parte 4 — 04/10

O roteiro do dia está em [`../sprints/_D1-04out2026.md`](../sprints/_D1-04out2026.md).
