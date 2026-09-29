---
id: ADR-0064
title: Destino do voto na eleição proporcional — o modelo segue o `dvt` que o TSE publica por candidatura (só voto válido conta para o candidato, "Válido (legenda)" conta para o partido, "Anulado" e "Anulado sub judice" ficam fora do quociente eleitoral e do partidário); difere do majoritário (ADR-0053) porque o TSE trata o voto de forma diferente
status: accepted
date: 2026-09-29
amends: 0027
---

# ADR-0064 — Destino do voto no proporcional: seguir o `dvt` do TSE

## Status

Aceito (2026-09-29) — plano aprovado pelo dono.

**Emenda escopada ao [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md)**: precisa o
que é "voto nominal a candidato regularmente inscrito" e "votos de legenda" na **entrada** do
algoritmo. O algoritmo (quociente truncado, fases 1–3, art. 12-A) **não muda**, e o golden de 2022
(511/513) segue inalterado. **Contrasta com o [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md)
sem o emendar**: os dois seguem o mesmo princípio — fazer como o TSE faz — e por isso chegam a
destinos diferentes para o mesmo valor de `dvt`. Dois outros ADRs do mesmo plano dependem deste: o
[ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) projeta sobre a
entrada já filtrada aqui, e o [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) mostra na lista
o que aqui é excluído. A correção do `% apurado` da UF, que pertence ao mesmo pacote de correções de
entrada do modelo, está registrada no ADR-0063 porque define o que a trava de 25% significa.

## Contexto

**1. O modelo de cadeiras nunca lê o destino do voto.** `api/model/deputado.py:313` monta cada
`Candidato` com `votos_nominais=_int(cand.get("vap"))`. No EA20, `vap` é "quantidade de votos
**computados** para o candidato" — qualquer que seja a destinação —, e o campo que diz para onde o
voto foi, `cand[].dvt`, não é lido em nenhum ponto do caminho proporcional (`deputado.py` não contém
a palavra). O dicionário do EA20 lista quatro valores para a candidatura (`Válido`,
`Válido (legenda)`, `Anulado`, `Anulado sub judice`), publicados "somente após a primeira
totalização parcial" (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt`, atributo `dvt`).
Consequência direta: votos que o TSE marca como anulados ou sub judice entram em `votosPartido` e,
portanto, no quociente eleitoral, no quociente partidário, nas médias das sobras e na fila de
candidatos elegíveis do partido; e votos que o TSE marca como "Válido (legenda)" — do partido, não
do nome — entram como nominais de uma candidatura que pode aparecer eleita. A legenda vem de
`agr[].tvtl` (com fallback para a soma de `par[].tvtl`, `deputado.py:335-344`) e não corrige nada
disso. A magnitude ainda **não foi medida** em dado do simulado de cargo 6 (ver Pontos em aberto).

**2. O que foi validado não é o que roda.** O golden de 2022 que dá os 511/513
(`scripts/build-cadeiras-golden.py:13-14`) foi montado com `QT_VOTOS_NOMINAIS_VALIDOS` por candidato
e `QT_VOTOS_LEGENDA_VALIDOS` por partido — votos **válidos**. A produção alimenta o mesmo algoritmo
com `vap` bruto. O algoritmo foi aprovado com uma entrada e roda com outra; no golden a diferença é
invisível porque o dataset de 2022 é de votos válidos por construção.

**3. O quadro legal, sem reinterpretação.** O TSE produz `dvt` num quadro que o plano de 29/09 cita
assim: Código Eleitoral, art. 175, §§ 3º e 4º (voto dado a candidato inelegível ou sem registro é
nulo, com regra própria quando a decisão vem depois da eleição, caso em que o voto é contado para o
partido) e Lei 9.504/1997, art. 16-A e seu parágrafo único (candidato com registro sub judice
faz campanha; a validade do voto, e o cômputo dele para o partido, ficam condicionados ao deferimento
do registro). **Este ADR não interpreta esses dispositivos.** A decisão do dono é *seguir o TSE*: a
marcação que o TSE publica em `dvt` é a fonte, e nenhuma regra de elegibilidade é rederivada no
repositório. A própria árvore de totais do EA20 sustenta a leitura: `vvc = vv + van + vansj` e
`vv = vnom + vl` — votos **válidos** são nominais e de legenda, e anulados e sub judice ficam **fora**
de `vv` (atributos `vvc`, `vv`, `vnom`, `vl`, `van`, `vansj`).

**4. O majoritário chegou a outro lugar, pelo mesmo princípio.** O ADR-0053 (27/09) decidiu que a
candidatura "Anulado" sai da disputa e que "Anulado sub judice" **segue contando**, porque no cargo
majoritário o voto é da candidatura e o TSE a mantém formalmente na disputa (na captura real do
simulado, a candidatura sub judice chega com `st: "2º turno"` e `e: "s"`). No proporcional o mesmo voto
tem outro papel: além de ser "do candidato", é insumo do quociente que reparte as cadeiras de **todos**
os partidos da UF, e a marcação do TSE o mantém fora dele. Seguir o TSE nos dois cargos dá "conta" num
e "não conta" no outro; a divergência é do TSE, não do produto. O código já reflete a distinção em um
ponto: o mapa majoritário `_DESTINO_POR_DVT` (`api/model/project.py:4121`) **deliberadamente não
tem** "Válido (legenda)" — "é de cargo proporcional (voto que vai para a legenda, não para o nome)" —
e não tem default.

## Decisão

**1. O destino de cada candidatura é o `dvt` do TSE, por um mapa próprio do proporcional.** Novo
`_DESTINO_PROPORCIONAL` em `api/model/deputado.py`, com os quatro valores do dicionário, comparados
sem distinção de caixa e sem espaços nas pontas (como `destino_do_dvt`). Ele é **separado** do
`_DESTINO_POR_DVT` majoritário, e um não substitui o outro.

| `dvt` | Voto da candidatura | Vira `Candidato`? | Onde o voto conta |
|---|---|---|---|
| `Válido`, ou campo ausente | nominal | sim (`votos_nominais = vap`) | candidato, e por soma o partido |
| `Válido (legenda)` | vai para o partido | não | legenda efetiva |
| `Anulado` | anulado | não | em lugar nenhum — fora de QE e QP |
| `Anulado sub judice` | anulado sub judice | não | em lugar nenhum — fora de QE e QP |

Valor **fora do dicionário** é tratado como **ausente**, com aviso no log — nunca "desconhecido ⇒
anulado", nunca "desconhecido ⇒ válido" (a mesma regra do ADR-0053, decisão 4). O destino é
propriedade da candidatura, resolvido **uma vez por UF por ciclo**: se os arquivos do mesmo ciclo
divergirem para a mesma candidatura, vale a regra do ADR-0053 — tratar como ausente, com aviso.

**2. A legenda efetiva é ancorada nos totais que o TSE publica, não em soma nossa.** Por agremiação:

`legenda_efetiva = (tvtn + tvtl) − Σ vap das candidaturas elegíveis (Válido ou sem dvt)`,

com `tvtn` e `tvtl` tomados do `agr[]` quando existem, senão somados dos `par[]` (a mesma preferência
que o código já tem para `tvtl`). O dicionário não diz em qual dos dois totais o TSE soma o voto de
candidatura "Válido (legenda)"; a regra foi escrita para **não depender disso**: se ele estiver em
`tvtl`, o resultado é o próprio `tvtl`; se estiver em `tvtn`, o resultado é `tvtl` mais esses votos.
Nos dois casos o total do partido — Σ nominais elegíveis + legenda efetiva — é exatamente
`tvtn + tvtl`.

**Fallback**: se a conta der **negativa**, ou se `tvtn` não vier, a legenda efetiva é `tvtl` + Σ `vap`
das candidaturas "Válido (legenda)", com log em `warn` dizendo qual ramo. O fallback pode contar em
dobro se o TSE já tiver posto esses votos em `tvtl`; quem acusa é a invariante da decisão 3.

**3. Invariante: Σ dos totais das agremiações == `v.vv`, por arquivo.** Depois de aplicar as decisões
1 e 2, a soma dos totais de todas as agremiações de um arquivo tem de igualar o `vv` do mesmo
arquivo. Divergência gera **aviso** (com os dois números e o ramo da legenda usado) e **não altera**
o cálculo: é o alarme de que a nossa leitura do `dvt` discorda da aritmética do TSE, não uma
correção automática. Sem `vv` no arquivo, ou sem nenhum `dvt` nele, a checagem não roda.

**4. `dvt` ausente ⇒ resultado bit-idêntico ao de hoje.** Sem `dvt` em nenhuma candidatura do arquivo
(o estado normal antes da primeira totalização parcial e o de todo o dataset de 2022), todas as
candidaturas são elegíveis com `vap`, a legenda é a de hoje, e a saída do algoritmo é a mesma, byte
a byte. É o teste que protege o golden de 511/513 e o replay: nenhum dos dois tem `dvt`.

**5. O que a tela mostra.** Candidatura com destino diferente de `Válido` **aparece na lista** da sua
agremiação, com o **texto do destino** e `pct_validos = null`, e **nunca é eleita** (nunca é
`Candidato`, portanto nunca entra em `eleitos`, na marca de parcial, na de projeção). A linha
mostra o número que o TSE publicou como votos **computados**, rotulado como tal, e esse número
**nunca** é somado a total algum de votos válidos, nem entra em `pct_votos`. Onde a linha se
posiciona na lista é do [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md). O percentual das
demais linhas é sobre `vv` da UF — a base da conta de cadeiras —, **não** sobre `vvc`
([ADR-0018](0018-termometros-hero-1t.md) e [ADR-0020](0020-conformidade-res-23751-2026.md): bases não
intercambiáveis); a legenda da tela diz qual base é.

## Consequências

**Positivas**:
- Corrige um erro de entrada que distorce quociente eleitoral, quociente partidário, sobras e a fila
  de elegíveis sempre que houver candidatura anulada, sub judice ou "Válido (legenda)" no arquivo — e
  põe a produção a rodar com a mesma entrada (votos válidos) com que o algoritmo foi validado.
- Só há um mecanismo: a marcação do TSE. Nenhuma regra de elegibilidade nova vive no repositório, e a
  lei não é rederivada (mesma postura do ADR-0053).
- Dá à Conferência (RF-269 da spec 026) uma chance de convergir com o TSE: o `qe` e o `vag` que o TSE
  publica são calculados sobre votos válidos, e com `vap` bruto a nossa conta divergiria deles por
  construção em toda UF com candidatura excluída. É inferência do autor, a confirmar em W0.
- A invariante Σ == `vv` é um alarme barato e independente que detecta, em cada arquivo, se a leitura
  do `dvt` e os totais do TSE contam a mesma história.
- Custo zero fora do cargo 6, e zero onde não há `dvt`: o replay presidencial (MAE@1h 2,3623 pp,
  cobertura 82,5%) e o golden não se movem.

**Negativas**:
- **Nas primeiras horas, o erro continua.** `dvt` só existe depois da primeira totalização parcial;
  antes disso o comportamento é o de hoje, com anulados contados. Como há pouco voto nessa hora, o
  efeito é pequeno, mas não é zero, e a projeção ([ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md))
  só abre a 25% apurado, bem depois.
- **O resultado pode mudar entre ciclos sem que o modelo tenha errado.** Se o TSE reclassificar uma
  candidatura (sub judice que vira válida por deferimento, ou que vira anulada), quociente e cadeiras
  se movem: comportamento correto, mas visível para o leitor como uma cadeira que troca de dono.
- **Os dois cargos passam a tratar o mesmo `dvt` de forma diferente** (sub judice conta no
  majoritário, não no proporcional). Um leitor que compare Presidente e Deputado pode achar
  incoerente; a metodologia (`/sobre-o-modelo`, spec 011, § 8) precisa dizer que a diferença é a do
  TSE. Este ADR **não registra parecer jurídico**: é decisão do dono de seguir a marcação, e o ponto
  aberto do ADR-0053 (sub judice no denominador do majoritário) continua aberto lá.
- **A regra assume que `tvtn` e `tvtl` já excluem anulados e sub judice** (são "votos válidos" no
  dicionário e `vv` os exclui na árvore de totais). Se a medição de W0 mostrar `tvtn` incluindo
  sub judice, a legenda efetiva absorveria esses votos em silêncio e este ADR precisa de emenda.
- **Um único arquivo divergente devolve a candidatura excluída à conta inteira**, com aviso — o
  mesmo custo aceito no ADR-0053 para `dvt` inconsistente entre arquivos.
- **`Candidato` deixa de ser um-para-um com `cand[]`.** `combinar_entradas` e a leitura por zona
  precisam carregar o destino, e uma candidatura excluída sai da fila de elegíveis mas continua
  visível: mais uma superfície onde divergência entre pontos de consumo reproduziria o bug.

## Alternativas consideradas

- **Manter `vap` bruto (status quo).** Rejeitada: é o defeito descrito no Contexto 1, e roda o
  algoritmo com entrada diferente da validada.
- **Espelhar o ADR-0053: excluir só "Anulado" e manter "Anulado sub judice" na conta.** Rejeitada:
  contradiz a marcação do TSE e a árvore de totais dele (`vv` exclui sub judice), e faria a invariante
  Σ == `vv` falhar de forma sistemática em toda UF com sub judice.
- **Derivar a elegibilidade da situação de registro (indeferido, cassado, sub judice).** Rejeitada:
  é rederivar a lei — o TSE já a aplica e a publica —, e a fonte de erro passaria a ser nossa.
- **Usar só `tvtl` como legenda.** Rejeitada: perde em silêncio os votos "Válido (legenda)" quando o TSE
  os soma em `tvtn`. Permanece como parte do fallback.
- **Descontar votos anulados dos totais brutos (`tvan`, `tval`).** Rejeitada: são totais "computados"
  (incluem todo destino); partir do total válido publicado é mais curto e não depende de saber o que
  o TSE colocou em cada bucket de computados.
- **Falhar o ciclo quando a invariante divergir.** Rejeitada: um alarme que derruba a publicação na
  noite da apuração cria a falha que o § 7 quer evitar; a invariante avisa e o dado é do TSE.

## Pontos em aberto

- **A medição de W0 ainda não existe.** O plano manda medir, sobre os arquivos do simulado de cargo 6
  (RR e AP) e os agregados, o `dvt`, `tvtn`/`tvtl`, Σ == `vv`, `qe`/`vag` na parcial e `e`/`st`; as
  fixtures previstas (`tests/fixtures/tse/2026-sim/dep/`) não estão no repositório. Este ADR foi escrito
  antes dela, e a decisão 2 e a consequência negativa 4 dependem do resultado.
- **O `par[]` também traz `dvt`** (`Válido (legenda)`, `Anulado`, `Anulado sub judice`) — a destinação
  do voto do **partido**. Este ADR não o lê como decisão própria: usa os totais válidos publicados,
  que já devem refleti-lo. Confirmar em W0.
- **Os dispositivos legais foram citados a partir do plano de 29/09**; o texto não foi relido no
  Planalto na redação deste ADR (o ADR-0027 conferiu o dele em 11/09).
- **O texto exato do destino na linha** ("voto vai para a legenda", "anulado", "anulado sub judice") e
  a posição das linhas excluídas: spec 026 (RF-261/RF-268) e ADR-0065.
- **`pct_validos = null` também para "Válido (legenda)"**: o plano dizia "nulo se anulado ou sub judice";
  estendi ao terceiro destino porque o voto é válido mas não é nominal, e mostrar um percentual ao
  lado do nome sugeriria uma votação nominal que sustenta eleição. O dono pode reverter.
  > **Emenda 2026-09-29 (implementação).** O contrato congelado da spec 026 (design § 3.1 e fixtures
  > de contrato) e as frentes P e U foram construídos com `pct_validos` **numérico** para "Válido
  > (legenda)" — o voto é válido e o percentual é verdadeiro; a linha leva o texto do destino ("voto
  > vai para a legenda") ao lado, que desfaz a leitura de voto nominal. Vale o contrato; a troca para
  > `null` é uma linha (`_DESTINOS_SEM_PCT` em `api/model/deputado_payload.py`) se o dono preferir.

## Cross-refs

- [ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md) — o algoritmo, intocado; a entrada é
  precisada aqui (nota adicionada).
- [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — o contraste; mesmo princípio,
  outro destino; a decisão 4 dele (`dvt` desconhecido e divergente) é reaproveitada.
- [ADR-0018](0018-termometros-hero-1t.md), [ADR-0020](0020-conformidade-res-23751-2026.md) —
  denominadores não intercambiáveis (`vv` × `vvc`).
- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md),
  [ADR-0052](0052-agregado-uf-br-aditivo-coluna-nivel.md) — arquivos por zona e agregado de UF, onde a
  invariante é conferida.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — projeção sobre a
  entrada filtrada. [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) — a lista.
- Spec 017 — RF-121 (votos de legenda preservados) e RF-123 a RF-126 (quociente, fases, golden), a
  emendar. Spec `026-deputado-listas-projecao` —
  RF-261, RF-268, RF-269. Spec 011 — metodologia.
- Constituição § 1 (o dado do TSE não é alterado; o que o produto deriva é rotulado), § 2 (nenhum
  julgamento próprio: usa a palavra do TSE), § 6 (reprodutível de snapshot + código), § 8 (metodologia
  declara a diferença entre cargos): [../../constitution.md](../../constitution.md).
- `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt` — `dvt` (candidato e partido), `vap`,
  `tvtn`, `tvtl`, `tvan`, `tval`, `vvc`, `vv`, `vnom`, `vl`, `van`, `vansj`.
- Código: `api/model/deputado.py:313` e `:335-344`, `api/model/project.py:4108-4125`,
  `scripts/build-cadeiras-golden.py:13-14`.
