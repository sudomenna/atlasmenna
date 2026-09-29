---
id: ADR-0036
title: Deputado Federal em granularidade zona (par município×zona), fatiado em 6 por invocação, volta completa em 30 min — não UF a cada 15 min
status: accepted
date: 2026-09-13
amends: 0026
---

# ADR-0036 — Deputado Federal em granularidade zona, fatiado em 6, volta completa em 30 min

## Status

Aceito. Este ADR **emenda o ADR-0026** — especificamente o item 1 da Decisão e a nota
"2026-09-11 (b)" (Senador sai de UF para ZONA), que fixavam `granularidade: "uf"` para o
cargo 6 (Deputado Federal) e a tratavam como definitiva ("Deputado Federal permanece em
`uf`"). Não supersede o ADR-0026: o resto do item 1 (crons próprios, cadências desacopladas
do cron de 60s dos majoritários), o item 4 (Vercel Blob como read path do drill-down de UF)
e o item 3 (regra de três + ADR-0027 para conversão em cadeiras) permanecem intocados. Nota
de emenda aplicada ao `## Status` do ADR-0026.

> **Nota 2026-09-13 (implementação) — o interruptor exigido por este ADR nasceu quebrado, e
> foi consertado antes de qualquer deploy.** A Decisão, abaixo, fixa como requisito um
> interruptor de reversão sem deploy. Ele foi implementado como
> `TSE_DEPUTADO_GRANULARIDADE=uf` — e a revisão da implementação encontrou que **acioná-lo
> não revertia nada: congelava o dado, em silêncio.**
>
> `_discard_zero_zona_sentinel_when_real_zonas_exist` (`api/model/project.py`) era puramente
> estrutural — "se a UF tem alguma linha `cod_zona > 0`, descarte a linha `cod_zona = 0`",
> sem nenhuma noção de tempo. Foi escrita para a transição `uf` → `zona`, onde está correta,
> e o próprio docstring dizia isso. **A direção inversa nunca foi considerada porque, até
> este ADR, ninguém podia percorrê-la de propósito.** Com o interruptor acionado no meio da
> apuração, as linhas `(uf, 0, 0)` novas seriam descartadas em favor dos pares congelados no
> instante da virada, e `snapshots` é append-only (constituição § 10) — os pares velhos
> nunca saem. Sem erro, sem alerta, e com o `ts` do payload sendo a hora do **cálculo**
> (`project.py:3863`), não a do dado: a tela mostraria número parado com horário fresco.
>
> Uma rede de segurança que falha assim é pior que nenhuma, porque o operador acredita ter
> revertido. **Corrigido**: o filtro passa a decidir por **frescor** — por UF, a família
> (sentinela ou zonas reais) cujo `ts` mais recente for maior sobrevive, nas duas direções;
> UF com uma família só mantém o que tem; sem `ts` confiável, falha aberto. Travado por
> quatro testes de direção, verificados por mutação — inclusive a mutação que apaga o `ts`,
> que reabriria a dupla contagem.
>
> O problema mais amplo — `ts` de payload ser a hora do cálculo em **todos** os cargos, o
> que torna dado parado invisível ao leitor (constituição § 8) — é pré-existente, não é
> criado por este ADR, e está registrado à parte.

> **Nota 2026-09-19 (emenda) — a correção de 2026-09-13 04:16 (`9cf8a2d`) foi verdadeira por
> 17 minutos, e ninguém voltou para atualizá-la.** A alínea "Granularidade" da Decisão e as
> entradas correspondentes em Consequências (Positivas, Negativas) e Cross-refs afirmavam,
> desde aquele commit, que `check_zona_merge_sanity` **não** cobria o cargo 6. Isso deixou de
> ser verdade em `550fbb2` (2026-09-13 04:33), 17 minutos depois: a trava passou a ser chamada
> também no ramo proporcional (`api/model/project.py:5658`, dentro de
> `_do_project_proporcional`, `:5573`). Cronologia completa, medida nesta sessão:
>
> | hora | commit | o quê |
> |---|---|---|
> | 02:11 | `e2f3240` | cria a exposição — cargo 6 passa a granularidade zona, sem trava |
> | 04:16 | `9cf8a2d` | corrige o ADR (afirmava que a trava vinha junto) — correto no instante em que foi escrito |
> | 04:33 | `550fbb2` | implementa a trava no ramo proporcional — a correção das 04:16 envelhece |
>
> Seis dias depois, a afirmação vencida havia se propagado para `docs/reference/risks.md`,
> para o handoff de 2026-09-19 e para a priorização do dono como trabalho pendente — quando já
> estava feito desde a madrugada de 13/09. Este ADR foi emendado nos quatro pontos afetados
> (Decisão, duas ocorrências em Consequências e uma em Cross-refs) para refletir o estado
> real; o texto original de cada ponto foi preservado, tachado, com a correção ao lado — ver
> as notas datadas 2026-09-19 abaixo. Dois resíduos reais substituem a dívida fechada: o
> alarme Slack não tem destino configurado (`SLACK_WEBHOOK_URL` ausente das 27 chaves de
> `.env.local`) e a guarda do ramo proporcional vive dentro de `if eleitorado:` — uma falha em
> `fetch_eleitorado` desliga a trava em silêncio (ambos detalhados em Consequências →
> Negativas).

> **Nota 2026-09-29 ([ADR-0067](0067-orcamento-de-requisicoes-com-as-assembleias.md)) — cadência e pior
> caso emendados.** A entrada dos cargos 7 e 8 (Deputado Estadual e Distrital) no orçamento de requisições
> muda duas afirmações da Decisão abaixo. **(i)** "o pior caso agregado permanece 80 rps" passa a **82** na
> Fase 1 do ADR-0067 e a **81** na Fase 2. **(ii)** Se a Fase 2 subir, a "volta completa em 30 minutos" do
> cargo 6 passa a **60**: as 6 fatias do cargo 6 e as 6 do cargo 7 se intercalam na mesma faixa de 5 rps
> (cargo 6 nos minutos 0/10/20/…, cargo 7 nos 5/15/25/…). Continuam intactos o fatiamento em 6 por
> segmento de rota, a trava anti-overlap por `(cargo, fatia)`, `rpsMax = 5` e a recusa de subir a faixa a
> 10 rps (85 rps agregados), que o ADR-0067 mantém. Se a Fase 2 não subir, o cargo 6 segue em 30 minutos e
> este ADR vale como está, com pior caso de 82. O corpo deste ADR não foi reescrito.

## Contexto

RF-127 (spec 017, `docs/specs/017-deputado-federal/spec.md:201-209`) exige que a tela de
Deputado exiba **intervalo**, não só o número central, de cadeiras projetadas por
partido/federação — é o único requisito que ainda falta para a spec sair de `implementing`
para `shipped` (`ship_blocked_on: [rf-127-intervalo-de-cadeiras]`, `docs/_meta/index.json`).
O intervalo vem do mesmo mecanismo usado nos outros três cargos: bootstrap não-paramétrico
(ADR-0006) sobre **unidades geográficas apuradas**. `api/model/extrapolation.py:264-265`
sorteia um único `idx = rng.integers(0, k_a, size=(n_resamples, k_a))` por UF, compartilhado
por todos os candidatos e pelas duas bases (votáveis/comparecimento) — a docstring do módulo
(`:69-75`) é explícita: "um ÚNICO bootstrap por UF (não um por candidato, não um por base)".
`k_a` é o número de **zonas apuradas** que entram nesse sorteio.

Com `granularidade: "uf"` (o valor que o ADR-0026 fixou para o cargo 6 e que
`lib/config/cargos.ts:184` ainda declara), o TSE entrega **um único arquivo por UF** para
Deputado — ou seja, `k_a = 1`. As 1.000 réplicas do bootstrap saem idênticas entre si, e o
IC95 fecha num ponto: exatamente o diagnóstico que, em 2026-09-11, tirou o Senador de `uf`
para `zona` (nota "2026-09-11 (b)" do ADR-0026: "1 observação produz 1 réplica distinta; 3
produzem 10"). Publicar aquilo como intervalo de confiança afirmaria uma certeza que o
modelo não tem — constituição § 6 (determinismo do modelo: "cada valor pode ser reproduzido
a partir do snapshot persistido"; um IC de largura zero não é reprodução, é artefato de
amostra única).

Não há alternativa dentro do arquivo de UF já hoje baixado. O envelope EA20 de abrangência
UF **não tem repartição geográfica interna**: confirmado em `lib/tse/ea20-schema.ts:22-32`
(cada arquivo JSON representa **uma única** abrangência — a hierarquia de candidatos é
`carg[] → (fed[] | agr[].par[]) → cand[]`, partidária, sem nível de zona ou município) e em
`docs/reference/tse-2026-leiautes.md:109-118` (mesma conclusão, tirada do documento oficial
do TSE: "não há array de abrangências dentro do arquivo"). O TSE **publica**, separadamente,
arquivos de zona e de município para o cargo 0006 — o mesmo cargo, outra abrangência, outro
arquivo (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt`) — e os construtores de
URL já existem e já são agnósticos ao cargo: `buildEA20UrlZona`
(`lib/tse/targets.ts:161-177`) recebe `cargo: CargoTse` como parâmetro comum aos quatro
cargos cobertos, sem nenhum código específico de Presidente/Governador que precise ser
generalizado.

## Decisão

**Granularidade.** O cargo 6 passa a ser ingerido em `granularidade: "zona"` — o par
(município, zona), unidade de ingestão fixada pelo ADR-0035 para os demais cargos — em vez
de `"uf"`. Isso muda `lib/config/cargos.ts:184` (fora do escopo desta tarefa de
documentação; a implementação corre em paralelo). Não há mudança na fonte do dado nem no
schema: é o mesmo builder `buildEA20UrlZona` já usado por Presidente, Governador e Senador.

> ⚠️ **Correção 2026-09-13 (pós-publicação).** A redação original desta alínea dizia que o
> cargo 6 passaria a usar "o mesmo `merge_pairs_into_zonas`/`check_zona_merge_sanity` que
> recompõe pares em zona antes do estimador". **É falso, e a parte que importa não é a
> nomenclatura.** `merge_pairs_into_zonas` e `check_zona_merge_sanity` são chamados **só no
> ramo majoritário** (`api/model/project.py:4143` e `:4171`). O ramo proporcional lê
> `fetch_snapshots` direto (`:3832`) e soma os pares por `combinar_entradas`
> (`api/model/deputado.py:412`). Erro apontado por outra sessão em 13/09, verificado nos dois
> ramos — a frase entrou porque eu a afirmei no briefing e ninguém a conferiu contra o código.
>
> **A consequência operacional está registrada em Consequências → Negativas** e é o motivo
> desta correção existir: a trava de sanidade contra multiplicação de votos **não acompanha**
> o cargo 6.
>
> ⚠️ **Segunda correção, 2026-09-19 — a correção acima foi verdadeira por 17 minutos.**
> Cronologia exata, medida nesta sessão: `e2f3240` (13/09 02:11) cria a exposição —
> granularidade zona no cargo 6, sem trava; `9cf8a2d` (13/09 04:16) é o commit desta correção,
> e estava certo no instante em que foi escrito; `550fbb2` (13/09 04:33) implementa a trava no
> ramo proporcional. **A partir de 04:33 de 13/09, a frase "`check_zona_merge_sanity` é
> chamada só no ramo majoritário" deixou de ser verdade** — ninguém voltou a este parágrafo
> para atualizá-la, e ela se propagou por seis dias para `docs/reference/risks.md`, o handoff
> de 19/09 e a priorização do dono.
>
> Estado verificado em 2026-09-19: `check_zona_merge_sanity` é chamada nos **dois** ramos —
> majoritário, após `merge_pairs_into_zonas` (`api/model/project.py:5999` chama o merge,
> `:6027` chama a guarda) — e proporcional, em modo `merged_rows=None`
> (`api/model/project.py:5658`, dentro de `_do_project_proporcional`, `:5573`, sob
> `if eleitorado:` em `:5657`). O modo `merged_rows=None` tem docstring própria
> (`api/model/zona_merge.py:565-580`) explicando que somar `Σ e.te` dos pares é idêntico ao
> que o merge produziria — mesmos limiares, mesma semântica de log, "uma guarda só, dois
> chamadores". As linhas `:4143`/`:4171`/`:3832` citadas no parágrafo original já não
> correspondem ao conteúdo descrito nem em 13/09 à tarde — os arquivos cresceram, e ninguém
> conferiu de novo antes de propagar a afirmação. `combinar_entradas`
> (`api/model/deputado.py`) continua em `:412`, por coincidência.
>
> O que continua verdadeiro do parágrafo original: o ramo proporcional realmente não chama
> `merge_pairs_into_zonas` (só o majoritário faz a recomposição de pares antes do estimador) —
> a diferença de **agregação** entre os dois ramos é real e permanece. O que era falso, e
> ficou falso de novo assim que a correção envelheceu, foi a inferência de que essa diferença
> de agregação implicava ausência de **guarda**. Ver Consequências → Negativas para os dois
> resíduos reais que sobram depois de 04:33 de 13/09.

**`rpsMax` do cargo 6 não muda: continua 5.** O teto por cargo não é reaberto por este ADR.
`piorCasoAgregadoRps()` (`lib/config/cargos.ts:248-250`) soma os quatro `rpsMax` —
25+25+25+5 — e o pior caso agregado **permanece 80 rps**, 20% abaixo do teto documentado de
100 do TSE (constituição § 1). Subir o teto do cargo 6 para acelerar o ciclo comprometeria a
margem calibrada em 2026-09-11 (ADR-0035, emenda "teto de requisições recuado de 50 para
40"; `lib/config/cargos.ts:107-111`, pico medido de 160 rps com quatro cargos simultâneos a
40 cada).

**Fatiamento em 6, por segmento de rota.** ~6.110 alvos a 5 rps são ~1.222 s de ciclo —
muito além do `maxDuration` de 300 s (`app/api/ingest/[cargo]/route.ts`, ADR-0035 D3). A
varredura completa se divide em **6 fatias** de ~1.019 alvos cada, ~204 s por fatia
(1.222/6), com ~96 s de margem sob o teto de 300 s. Cada fatia é identificada por
**segmento de rota** — `/api/ingest/deputado-federal/<n>`, `n` de 1 a 6 — não por query
string: é o mesmo precedente já fixado na nota "2026-09-11" do ADR-0026 (achado (B) do
ADR-0035 D3), que documentou que a Vercel não suporta query string em `path` de cron e que o
mecanismo correto, com exemplo literal na doc oficial, é o segmento de rota.

**Cadência: 5 minutos por fatia, volta completa em 30 minutos.** Seis crons de `*/5`
disparando fatias 1 a 6 em sequência cobrem o universo completo a cada 30 min — o dobro dos
15 min que o ADR-0026 havia fixado. O gargalo é o próprio ritmo de 5 rps: 6.110/5 = 1.222 s
≈ 20,4 min é o piso teórico da varredura completa, qualquer que seja o fatiamento; 30 min (6
fatias × 5 min) é o primeiro múltiplo de 5 acima desse piso que também alinha em um cron
limpo.

**Requisito de implementação descoberto nesta análise: a trava anti-overlap precisa passar a
ser por `(cargo, fatia)`, não só por cargo.** Hoje (`lib/tse/ingest-handler.ts:401-443`) o
lock é por cargo: a última linha de `ingest_log` cujo `notes.cargo` bate com o cargo do
ciclo, dentro de uma janela de 6 min (`OVERLAP_LOCK_WINDOW_MS`, `:419`), determina se um
ciclo anterior ainda está em voo. Com 6 fatias do mesmo cargo disparando a cada 5 min, a
fatia 2 encontraria a marca da fatia 1 (mesmo `cargo`, idade <6 min) e seria pulada por
engano — nenhum ciclo além do primeiro rodaria. A chave do lock precisa incluir a fatia
(`notes.cargo` + `notes.fatia`, ou um marcador composto equivalente); a janela de 6 min pode
continuar servindo cada fatia isoladamente, já que cada fatia sozinha roda em ~204 s.

**Requisito de implementação: interruptor de reversão sem deploy.** A mudança altera o
pipeline de ingestão a 21 dias da eleição, sem nenhum envelope EA20 real de cargo 6 jamais
processado por este sistema (ver Consequências). A implementação deve prover um mecanismo —
reaproveitando ou estendendo a escotilha `TSE_GRANULARIDADE` já documentada em
`lib/config/cargos.ts:93-95` ("sobrepõe isto para TODOS os cargos — é escotilha de
diagnóstico") ou um equivalente específico ao cargo 6 — que devolva o cargo 6 a
`granularidade: "uf"` por variável de ambiente, sem exigir novo deploy, caso o simulado de
15–17/09 ou a apuração real revelem um problema. Este ADR fixa o requisito; a forma exata
(variável nova vs. extensão da existente) fica com a implementação.

## Alternativas rejeitadas

- **Manter a varredura por UF a cada 15 min em paralelo à varredura detalhada por zona**,
  preservando a cadência atual do número principal enquanto o intervalo usaria só o dado
  fino. Rejeitada: `combinar_entradas` (`api/model/deputado.py:412-496`) **soma** quando
  encontra mais de uma linha da mesma UF no banco — é o comportamento correto para o caso
  que a função foi desenhada a resolver (pares de zona da mesma UF), mas linhas de UF e
  linhas de par coexistindo na mesma tabela `snapshots` produziriam **votos contados em
  dobro, em silêncio**: o mesmo voto entraria uma vez pelo arquivo agregado de UF e outra
  vez pela soma dos pares daquela UF. É o modo de falha "default silencioso" que já mordeu
  este repositório três vezes. Os 30 min de cadência são o preço de tornar esse
  duplo-cômputo impossível por construção, não uma escolha arbitrária.
- **Subir `rpsMax` do cargo 6 de 5 para 10 e varrer em 3 fatias**, preservando os 15 min de
  volta completa. Rejeitada: levaria `piorCasoAgregadoRps()` a 85 rps, reabrindo uma
  calibragem fechada em 2026-09-11 (ADR-0035) depois de uma medição de pico de 160 rps com
  os quatro cargos simultâneos — o ganho seria 15 min de latência ao preço da margem de
  segurança do dia D, 21 dias antes da eleição.
- **Granularidade de município** (~5.570 alvos) em vez de par (município, zona), para
  reduzir o fan-out sem depender da premissa da fatia por par ainda não confirmada contra
  dado real (Passo 0, `docs/testing/tse-simulados.md:46-51`). Rejeitada por três motivos: a
  economia de requisições é irrisória (5.570 contra 6.110, ~9%); `VALID_GRANULARIDADES`
  (`lib/tse/targets.ts:377`) só aceita `["uf", "zona"]` — adicionar um terceiro valor seria
  encanamento novo só para este cargo; e o risco da premissa não é novo nem exclusivo do
  cargo 6 — se a premissa cair, Presidente, Governador e Senador caem junto, e o produto
  inteiro para. Não se compra segurança nova adicionando uma terceira granularidade a um
  problema que já existe nos outros três cargos.

## Consequências

**Positivas**:
- RF-127 fica possível: a unidade de reamostragem do bootstrap, depois de os pares serem
  agrupados por `cod_zona` (em `_entradas_por_zona`, **não** por `merge_pairs_into_zonas`,
  que é do ramo majoritário), passa a ser a **zona real** — 2.644
  zonas distintas `(uf, cod_zona)` no país (medido em `zonas`, 2026-09-13), média de **97,9
  zonas por UF**. Nenhuma UF fica com `k_a = 1`.
- O cargo 6 passa a usar o mesmo **caminho de ingestão** dos outros três cargos (mesmo
  builder de URL, mesma tabela `zonas`, mesmos alvos) — menos código de exceção no pipeline.
  ⚠️ **Corrigido em 13/09, 04:16**: isto vale para a ingestão, **não** para a agregação. Os
  dois ramos do modelo continuam distintos — o majoritário recompõe pares em zona via
  `merge_pairs_into_zonas` antes do estimador, o proporcional soma direto por
  `combinar_entradas`. ~~E a trava de sanidade não é compartilhada — ver Negativas.~~
  ⚠️ **Segunda correção, 2026-09-19**: essa última frase deixou de ser verdade 17 minutos
  depois, em `550fbb2` (04:33): `check_zona_merge_sanity` passou a ser chamada nos dois ramos
  (`api/model/project.py:5658` no proporcional, `:6027` no majoritário) — a guarda é uma só,
  com dois chamadores (`api/model/zona_merge.py:578-580`). O que continua diferente entre os
  ramos é só a agregação, não a cobertura da guarda. Ver Negativas para o estado atual e os
  dois resíduos reais.
- Nenhum dado novo é inventado: o par (município, zona) já é publicado pelo TSE para o cargo
  6 (mesma tabela oficial que já cobre os outros três,
  `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt`); a mudança pede um arquivo
  diferente do mesmo cargo, não cria uma nova fonte.

**Negativas**:
- ✅ **RESOLVIDO em 2026-09-13 04:33 (`550fbb2`).** ~~A trava de sanidade contra
  multiplicação de votos NÃO cobre o cargo 6 — e esta decisão é o que criou a exposição.~~
  `check_zona_merge_sanity` (`api/model/zona_merge.py`) passou a ser chamada também no ramo
  proporcional, em modo `merged_rows=None` (`api/model/project.py:5658`, dentro de
  `_do_project_proporcional`, `:5573`), 17 minutos depois do commit que registrou a lacuna
  (`9cf8a2d`, 04:16) — a mesma madrugada de implementação que a criou (`e2f3240`, 02:11) a
  fechou. O ramo majoritário continua chamando a guarda depois de `merge_pairs_into_zonas`
  (`api/model/project.py:5999` o merge, `:6027` a guarda); o proporcional chama a mesma
  função direto sobre os pares crus, sem o merge — os dois modos medem a mesma razão `Σ e.te
  dos pares / eleitorado da zona`, com os mesmos limiares (`api/model/zona_merge.py:565-580`).
  **Esta correção só foi propagada para este ADR em 2026-09-19** — por seis dias o texto
  abaixo, escrito antes das 04:33, esteve desatualizado em `docs/reference/risks.md`, no
  handoff de 19/09 e na priorização do dono.

  ~~Antes desta decisão o cargo 6 não tinha exposição nenhuma — um arquivo por UF, nada a
  somar. Depois dela, se a premissa da fatia por município (Passo 0,
  `docs/testing/tse-simulados.md`) for falsa, os votos de Deputado multiplicam por até 8× em
  ~62% das zonas em silêncio, enquanto os outros três cargos gritam.~~ Isto descreve
  corretamente a janela de exposição real, entre 02:11 e 04:33 de 13/09 (22 minutos) — não o
  estado atual, nem nunca esteve em produção com dado real (`snapshots` só tinha linhas de
  cargo 3 até aquela data).

  ~~Registrado como dívida aberta, com prazo 04/10. A redação original deste ADR afirmava o
  contrário (que a trava vinha junto), o que escondeu a lacuna por algumas horas — ver a
  correção na Decisão.~~ A dívida fechou dentro da mesma madrugada, 21 dias antes do prazo —
  não pelas "algumas horas" que a correção original estimava, mas por 17 minutos.

  **Dois resíduos reais substituem a dívida fechada** (não reabrir a dívida antiga — estes são
  os dois problemas que sobram, registrados em 2026-09-19):
  1. **O alarme não tem destino.** `_alert_slack` (`api/model/project.py:5250`) lê
     `os.environ.get("SLACK_WEBHOOK_URL")` (`:5265`); ausente, loga "slack alert skipped —
     SLACK_WEBHOOK_URL ausente" (`:5276`) e retorna, best-effort que nunca levanta
     (constituição § 7). A variável não está entre as 27 chaves de `.env.local` (medido em
     2026-09-19). Sem ela, a guarda continua detectando e logando — mas ninguém fora dos logs
     estruturados é avisado. Objetivo declarado da sprint ativa S08 — Enxergar, travado no
     dono.
  2. **A guarda do ramo proporcional vive dentro de `if eleitorado:`**
     (`api/model/project.py:5657`). Acima, `fetch_eleitorado` degrada para `eleitorado = {}`
     num `except` com `_log("warn", ...)` (`:5633-5638`) — degradação deliberada (constituição
     § 7: perder o eleitorado pesa o `pct_apurado_total`, não derruba a bancada). Consequência
     não deliberada: **uma falha na consulta ao eleitorado desliga a trava em silêncio**, no
     mesmo ciclo em que ela mais faria falta. Registrado como observação, não como defeito a
     corrigir já — o trade-off de não abortar o ciclo por causa do eleitorado é legítimo; o
     acoplamento entre essa degradação e a guarda de multiplicação é um efeito colateral que
     ninguém decidiu de propósito.
- **A cadência de atualização cai pela metade**: 30 min contra os 15 min que o ADR-0026
  havia fixado e que a UI hoje anuncia (`vercel.ts:143`, comentário "atualizado a cada 15
  min"). O texto da tela de Deputado precisa mudar para **"atualizado a cada 30 min"** —
  ADR-0026 item 5, constituição § 8 (transparência metodológica: a cadência de atualização
  precisa ser legível, não presumida). Isto não é opcional nem cosmético: o texto atual,
  depois desta decisão, está simplesmente errado.
- **O intervalo será visivelmente mais largo e mais grosseiro nas UFs pequenas do que nas
  grandes, na mesma tela.** A distribuição de zonas por UF é muito desigual: RR tem 8 zonas
  (16 pares), AC 9 (23), AP 10 (17), DF 19 (19) — contra SP com 394 (780), MG 304 (898), BA
  199 (450) (medido em `zonas`, 2026-09-13). Isso **não é degeneração** — 8 unidades de
  reamostragem ainda geram milhares de réplicas distintas, ao contrário da UF com 1 unidade
  que motivou originalmente esta mudança — e é estatisticamente **correto**: um estado
  pequeno tem mesmo mais incerteza residual num bootstrap de zonas. Mas é uma diferença
  perceptível entre estados numa mesma tela nacional, e a constituição § 8 pede que o leitor
  consiga entender o que está vendo, não apenas que o número esteja certo. Fica registrada
  como consequência a acompanhar na UI (ex.: nota metodológica ou `n_zonas` visível no
  drill-down), não como defeito a corrigir por este ADR.
- O cargo 6 passa a depender da mesma premissa não verificada dos outros três cargos: que o
  arquivo de par traz a **fatia** da zona naquele município, não a zona inteira repetida
  (ADR-0035, "Negativas — a de primeira grandeza"). Antes desta mudança, o cargo 6 estava
  isolado desse risco por estar em UF; depois, ele herda a mesma dependência do Passo 0 do
  simulado (`docs/testing/tse-simulados.md:46-51`). Se o Passo 0 reprovar, o Deputado
  detalhado para junto com os outros três — não é um risco novo, mas é um risco novo **para
  este cargo**.
- Mudança no pipeline de ingestão a **21 dias da eleição**, sem nenhuma validação prévia: a
  tabela `snapshots` tem hoje 898 linhas, **todas de cargo 3** (medido em 2026-09-13) —
  nenhuma linha de cargo 1, 5 ou 6, real ou de mock. O primeiro contato deste sistema com um
  envelope EA20 real de Deputado Federal, em qualquer granularidade, será o simulado de
  15–17/09. É por isso que o interruptor de reversão sem deploy (Decisão, acima) é
  obrigatório, não uma precaução opcional.
- A trava anti-overlap por `(cargo, fatia)` é uma peça nova de estado (`ingest_log.notes`),
  com seu próprio modo de falha: se a fatia não for gravada corretamente na marca, o
  comportamento regride silenciosamente para o lock por cargo de hoje — uma fatia
  bloquearia as outras cinco sem erro visível.

## Cross-refs

- [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — item 1 (granularidade
  por cargo) e nota "2026-09-11 (b)" (Senador uf→zona pelo mesmo diagnóstico), emendados por
  este ADR. Nota de emenda aplicada ao `## Status`.
- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) — D1/D2 fixam o par (município,
  zona) como unidade de ingestão, reaproveitada aqui sem alteração. `merge_pairs_into_zonas`
  não é reaproveitado pelo ramo proporcional (soma direto por `combinar_entradas`, sem
  recompor pares em zona) — essa parte da correção de 13/09 04:16 continua verdadeira.
  ⚠️ **O que não continua verdadeiro** (corrigido em 2026-09-19): ~~a trava
  `check_zona_merge_sanity` que o acompanha **não** é reaproveitada~~ — ela **é**
  reaproveitada, desde `550fbb2` (13/09 04:33), chamada em modo `merged_rows=None` também no
  ramo proporcional (`api/model/project.py:5658`). Ver a segunda correção na Decisão e o
  estado resolvido em Negativas. D3 fixa o precedente de segmento de rota para distinguir
  invocações e a trava anti-overlap por cargo, que este ADR estende para `(cargo, fatia)`.
- [ADR-0006](0006-bootstrap-nao-bayesiano.md) — bootstrap não-paramétrico cuja unidade de
  reamostragem motiva esta decisão inteira.
- [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) — método de conversão de
  votos em cadeiras, intocado por este ADR; RF-127 projeta o **intervalo** em torno do
  resultado que aquele ADR já calcula.
- Spec 017 (`docs/specs/017-deputado-federal/spec.md`) — RF-127 (`:201-209`) destravado por
  esta decisão; `ship_blocked_on: [rf-127-intervalo-de-cadeiras]` e `adrs:` no frontmatter
  devem passar a listar `0036` (propagação sugerida ao `spec-syncer` — não editado por este
  ADR, escopo de outro agente em paralelo).
- `docs/testing/tse-simulados.md:46-51` (Passo 0 — premissa da fatia por município, ainda
  não verificada contra dado real) — o cargo 6 passa a depender dela como os demais.
- `docs/operations/runbook.md` — precisa de seção/atualização descrevendo o cron de 6 fatias
  e a nova trava por `(cargo, fatia)` (propagação sugerida).
- Constituição § 1 (teto de requisições bem abaixo do limite documentado — `rpsMax` do cargo
  6 não muda, pior caso agregado permanece 80 rps), § 6 (determinismo do modelo — um IC de
  largura zero não é reprodução, é artefato de amostra única), § 8 (transparência
  metodológica — cadência de atualização legível; a UI precisa dizer "a cada 30 min", não
  15).
