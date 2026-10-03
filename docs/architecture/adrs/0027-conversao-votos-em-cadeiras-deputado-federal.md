---
id: ADR-0027
title: Conversão de votos em cadeiras para Deputado Federal — quociente eleitoral truncado (não round()), sobras em duas fases via médias (80/20 depois abertas), art. 111 substituído pelo art. 12-A pós-ADIs 7228/7263/7325
status: accepted
date: 2026-09-11
---

# ADR-0027 — Conversão de votos em cadeiras para Deputado Federal

## Status

Aceito, 2026-09-11.

Este ADR fecha a lacuna registrada no [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md)
(`:37`, `:75`), que reservou o "método de conversão de votos em cadeiras" para um ADR-0027 a
escrever — nunca escrito até hoje, apesar de a numeração já ter avançado até o ADR-0035. A
numeração dos ADRs **não pula**: este arquivo preenche o vão 0026→0028.

**Correção de premissa que este ADR registra formalmente**: o ADR-0026 (`:37`) cita "art. 111 da
Lei 9.504" como o dispositivo do quociente eleitoral. Isso é **incorreto**. Os artigos que regem
quociente eleitoral, quociente partidário, cláusula dos 10%, distribuição de sobras e o próprio
art. 111 estão no **Código Eleitoral (Lei nº 4.737/1965)**, artigos 106–112 — não na Lei
9.504/1997 (Lei das Eleições), que tem 107 artigos e cujos artigos finais tratam de instruções do
TSE, vigência e revogações, não de fórmula eleitoral. Texto conferido pessoalmente em
`planalto.gov.br` em 2026-09-11. Uma nota de emenda sugerida para o ADR-0026 está ao final deste
documento — **não aplicada** por este ADR; cabe ao `spec-syncer` ou a uma edição explícita
posterior.

> ⚠️ **Emenda 2026-09-19 — o desfecho do PLP 177/2023, citado em três pontos deste ADR como "sem
> desfecho confirmado", chegou e está fechado.** O PLP foi aprovado por Câmara e Senado em
> junho/2025, **vetado integralmente pela Presidência da República em julho/2025**, e o STF
> decidiu manter a distribuição de **513** cadeiras para o pleito de 2026, regido pela Resolução
> TSE 23.751/2026 (`docs/reference/regulatory.md`). Os três pontos afetados — Contexto (parágrafo
> final, sobre `lugaresAPreencher`), Alternativas consideradas (hardcodar a tabela por UF) e
> Consequências → Negativas (tabela de cadeiras por UF) — foram emendados com o texto original
> preservado e tachado, cada um com nota datada. **O método de conversão não é reaberto**:
> quociente eleitoral (art. 106), quociente partidário e cláusula dos 10% (arts. 107–108), sobras
> em duas fases (art. 109, interpretação conforme das ADIs 7228/7263/7325) e a Decisão de ler
> `lugaresAPreencher` do envelope do TSE, nunca de tabela hardcoded, permanecem intocados — o
> desfecho do PLP fecha apenas o **total nacional** (513, já tratado como fato conhecido neste
> ADR desde 11/09), não a distribuição **por UF**, que segue sendo o denominador do quociente
> eleitoral e segue vindo do dado do TSE. Fato do total nacional registrado em
> `api/model/cargos.py::TOTAL_CADEIRAS`/`VAGAS_EM_DISPUTA_2026` (2026-09-19).

> **Nota 2026-09-29 — emenda escopada à entrada do algoritmo ([ADR-0064](0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md)).**
> Onde o pseudocódigo abaixo diz "votos nominais a candidatos regularmente inscritos" e "votos de
> legenda", a entrada passa a ser derivada do `dvt` que o TSE publica por candidatura: só `Válido` (ou
> campo ausente) é voto nominal do candidato; `Válido (legenda)` conta para o partido; `Anulado` e
> `Anulado sub judice` ficam fora de QE e QP; a legenda efetiva é o total válido do partido
> (`tvtn + tvtl`) menos os nominais elegíveis. **O algoritmo — quociente truncado, fases 1 a 3,
> art. 12-A, a distinção `vagasObtidas` × `cadeiras` — não muda**, e sem `dvt` a saída é bit-idêntica
> à anterior (o golden de 2022, que é de votos válidos, segue em 511/513). Diferente do majoritário
> ([ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md)), onde sub judice continua
> contando, porque nos dois cargos vale o que o TSE marca.

## Contexto

O AtlasMenna projeta Deputado Federal (cargo TSE 6) desde o ADR-0026, que decidiu ingestão em
granularidade UF e read path via Vercel Blob, mas deixou **fora de escopo** o método de conversão
de votos em cadeiras — o núcleo aritmético que transforma `votosPartido`/`votosCandidato` em
número de cadeiras por partido e lista de eleitos, exibido ao vivo no dia da apuração
(04/10/2026). Errar esse cálculo não é um bug cosmético: é a projeção de quem ocupa uma cadeira na
Câmara dos Deputados sendo publicada errada, em tempo real, por um veículo que se anuncia como "não
oficial" mas que ainda assim tem obrigação de precisão frente à constituição do produto (§ 1, dado
derivado inconfundível com o oficial; § 6, determinismo reprodutível).

O sistema eleitoral proporcional brasileiro (Código Eleitoral, arts. 106–112) não é um cálculo
direto de proporção — é uma cascata de regras com pisos individuais e de partido, arredondamento
não-trivial, distribuição de sobras por médias sucessivas, e uma norma central (art. 111) que foi
**declarada inconstitucional pelo STF em 2024** e substituída por regulamento do TSE. Nenhuma
dessas nuances aparece em qualquer doc canônico do AtlasMenna hoje: `docs/reference/regulatory.md`
não cita os arts. 106–112, e o watch item mais próximo trata da Res. 23.751/2026 (atos gerais de
divulgação), não da fórmula de cadeiras. Federações (Lei 9.096/1995 art. 11-A; Lei 9.504/1997 art.
6º-A) contam como um único partido para todo o cálculo — o que o EA20 já expõe via
`FederacaoSchema` (`lib/tse/ea20-schema.ts:77-160`, citado no ADR-0026). Coligações em
proporcional são **vedadas desde as eleições de 2020** (CF art. 17 § 1º, redação da EC 97/2017,
art. 2º da própria emenda fixando a vedação a partir de 2020) — não há esse conceito para
Deputado Federal em 2026.

A norma operacional que implementa os artigos do Código Eleitoral é a **Res.-TSE nº 23.677/2021**,
com redação dada pela **Res.-TSE nº 23.734/2024** e pela **Res.-TSE nº 23.748/2026** — não a
Res. 23.751/2026, que trata de atos gerais de divulgação de resultados por terceiros (a norma que
já rege o § 1 da constituição do AtlasMenna, mas que **não** define fórmula de cadeiras). Essa
distinção é registrada aqui porque a memória de projeto associava genericamente "23.751/2026" a
qualquer norma TSE de 2026 — não é o caso para este ADR.

O ponto mais delicado do contexto é jurisprudencial. O STF julgou o mérito das **ADIs
7228/7263/7325 em 28/02/2024**: (a) deu **interpretação conforme** ao art. 109 § 2º do Código
Eleitoral para que **todas** as legendas — não só as que atingem os pisos de 80%/20% — participem
da distribuição de sobras prevista no inciso III, uma vez esgotadas as que atendem aos dois
pisos; e (b) **declarou a inconstitucionalidade do art. 111** do Código Eleitoral e do art. 13 da
Res.-TSE 23.677/2021 — o dispositivo que mandaria eleger "os candidatos mais votados,
individualmente", quando nenhum partido atinge o quociente eleitoral. Os embargos de declaração,
julgados em **13/03/2025**, derrubaram a modulação de efeitos temporais (6×5; o art. 27 da Lei
9.868/1999 exige 8 votos para modular) — **a decisão retroage a 2022**, o que significa que os
resultados oficiais de 2022 foram **recalculados** depois do trânsito em julgado e podem divergir
dos números proclamados à época. Isso importa diretamente para qualquer teste golden contra 2022
que a spec 017 venha a construir.

A Res.-TSE 23.677/2021 preencheu o buraco deixado pela inconstitucionalidade do art. 111 com o
**art. 12-A** (incluído pela Res. 23.734/2024, com o inciso II na redação dada pela Res.
23.748/2026): quando nenhum partido atinge o quociente eleitoral, aplica-se o próprio algoritmo de
médias — primeiro entre os que passam os pisos de 80%/20%, depois entre todos — às cadeiras
inteiras, não um "mais votados individualmente" fora da lógica partidária.

Por fim, o número de cadeiras por UF (`lugaresAPreencher`) **não está confirmado em fonte
primária estável** para 2026. A Res.-TSE 23.748/2026, art. 7º § 1º, remete à Lei Complementar
78/1993 para a distribuição, mas ~~há tramitação legislativa em curso (PLP 177/2023, que
discutiria elevar o total de 513 para 531 cadeiras) sem desfecho confirmado até 2026-09-11~~ o PLP
177/2023, que discutia elevar o total de 513 para 531 cadeiras, já teve desfecho — fechado desde
julho/2025, ver nota 2026-09-19 abaixo. O total nacional de 513 está confirmado para 2026; a
tabela **por UF** não está reproduzida nem verificada por este ADR contra nenhuma fonte primária.
Hardcodar essa tabela seria apostar num número que pode não bater no dia — ver Decisão.

> ⚠️ **Nota 2026-09-19 — o desfecho do PLP 177/2023 chegou, e está fechado.** O projeto foi
> aprovado pela Câmara e pelo Senado em junho/2025, **vetado integralmente pela Presidência da
> República em julho/2025**, e o STF decidiu manter a distribuição de **513** cadeiras para o
> pleito de 2026, regido pela Resolução TSE 23.751/2026 (`docs/reference/regulatory.md`). A
> Câmara de 04/10/2026 tem 513 cadeiras, todas em disputa — fato hoje declarado em
> `api/model/cargos.py::TOTAL_CADEIRAS` e `VAGAS_EM_DISPUTA_2026`, ao lado do Senado. Isto fecha a
> incerteza sobre o **total nacional**; não fecha a tabela **por UF**, que este ADR nunca
> reproduziu contra a LC 78/1993 e que continua saindo do dado do TSE, não de tabela hardcoded — a
> Decisão abaixo não é reaberta por esta nota, e o argumento que a sustenta passa a ser robustez
> contra qualquer divergência futura, não mais a espera de um desfecho pendente.

## Decisão

**O número de vagas por UF (`lugaresAPreencher`) vem do dado do TSE, nunca de tabela hardcoded no
AtlasMenna.** O EA20/EA12 da corrida proporcional declara o número de vagas a preencher por UF; o
pipeline lê esse campo do envelope oficial, com um smoke test contra o simulado (15–17/09 e
22–24/09) validando que a soma nacional bate 513. Errar o denominador do quociente eleitoral
corrompe toda a projeção da UF — não há justificativa para arriscar isso numa tabela mantida à
mão quando o próprio TSE publica o número.

**Algoritmo de conversão, em ordem de implementação:**

```
ENTRADA (por UF, por corrida de Deputado Federal):
  votosPartido[p]     — Σ votos nominais a candidatos regularmente inscritos de p
                         + votos de legenda dados a p (federação = 1 linha; Lei 9.096 art. 11-A,
                         Lei 9.504 art. 6º-A). Coligação não se aplica (vedada desde 2020,
                         CF art. 17 §1º, EC 97/2017) — se o EA20 trouxer marcador de coligação
                         numa corrida proporcional, é anomalia de dado a logar, não a processar.
  candidatos[p]       — candidatos de p com seus votos nominais individuais
  lugaresAPreencher   — lido do campo do TSE (EA20/EA12), NUNCA hardcoded (ver Contexto)
  votosValidos        — Σ votosPartido[p] sobre todos os p. Só contam votos nominais a
                         candidatos regularmente inscritos e votos de legenda — brancos e nulos
                         NÃO entram (Res.-TSE 23.677/2021 art. 9º parágrafo único; Lei 9.504
                         art. 5º). Como votosPartido[p] já os exclui por construção, votosValidos
                         é a soma direta.

FASE 0 — quociente eleitoral (Código Eleitoral art. 106)
  bruto   = votosValidos / lugaresAPreencher
  inteiro = floor(bruto)
  fracao  = bruto - inteiro
  QE = fracao > 0.5 ? inteiro + 1 : inteiro
  // *** NÃO é round(). fração == 0,5 EXATA fica na parte inteira (desce) — o texto diz
  // "desprezada a fração se igual ou inferior a meio, equivalente a um, se superior". Um
  // round() padrão (half up) arredondaria 0,5 para cima. Ver linha 1 da tabela de casos de
  // borda — esta é a classe de erro que passa despercebida em code review. ***
  assert QE >= 1  // se falhar com dado real do TSE, travar o ciclo e alertar — não deveria ocorrer

FASE 1 — quociente partidário e vagas diretas (art. 107, art. 108)
  para cada partido p:
    QP[p] = floor(votosPartido[p] / QE)              // "desprezada a fração" = floor puro,
                                                        // sem a regra do meio da Fase 0
    vagasObtidas[p] = QP[p]                            // conta para o denominador da média
                                                        // mesmo que nem todo QP seja ocupado
                                                        // agora — ver linha 2 da tabela
    elegiveis[p] = candidatos de p com voto nominal >= 0,10 * QE,     // piso do art. 108
                   ordenados por voto nominal desc (empate → art. 110, mais idoso)
    ocupadas[p] = min(QP[p], |elegiveis[p]|)
    eleger os `ocupadas[p]` primeiros de elegiveis[p]

  vagasRestantes = lugaresAPreencher - Σ ocupadas[p]
  // Se nenhum p tem QP[p] >= 1, vagasRestantes = lugaresAPreencher e vagasObtidas[p] = 0 para
  // todos — é o caso "nenhum partido atinge o QE". NÃO aplicar o art. 111 (declarado
  // inconstitucional, linha 8 da tabela). O fluxo segue normalmente para a Fase 2, só que
  // partindo de vagasObtidas=0 — é exatamente o que o art. 12-A da Res.-TSE 23.677/2021 manda.

FASE 2 — sobras restritas, pisos 80%/20% (art. 109 I/II + §2º)
  enquanto vagasRestantes > 0:
    candidatosFase2 = { p : votosPartido[p] >= 0,80 * QE
                           E existe candidato de p, AINDA NÃO ELEITO, com voto nominal
                             >= 0,20 * QE }
    // "ainda não eleito" — ver questão em aberto abaixo; leitura operacional adotada aqui.
    se candidatosFase2 == ∅: sair do laço (segue para Fase 3)
    para cada p em candidatosFase2:
      media[p] = votosPartido[p] / (vagasObtidas[p] + 1)
    pVencedor = argmax(media)   // empate → §6º maior votação total do partido; persistindo →
                                 // §7º maior voto nominal do candidato que disputa a vaga
    vagasObtidas[pVencedor] += 1
    eleger o próximo candidato não eleito de pVencedor (ordem de voto nominal)
    vagasRestantes -= 1

FASE 3 — sobras abertas, sem pisos (art. 109 III, pós-interpretação conforme
          das ADIs 7228/7263/7325)
  enquanto vagasRestantes > 0:
    candidatosFase3 = { p : existe ao menos um candidato de p ainda não eleito }
    // SEM exigência de 80%/20% — é exatamente o que a interpretação conforme do STF abriu:
    // antes da decisão, um partido que nunca atingisse os pisos ficaria fora da distribuição
    // de sobras para sempre; depois, entra aqui quando a Fase 2 se esgota.
    para cada p em candidatosFase3:
      media[p] = votosPartido[p] / (vagasObtidas[p] + 1)
    pVencedor = argmax(media)   // mesmos critérios de desempate da Fase 2
    vagasObtidas[pVencedor] += 1
    eleger o próximo candidato não eleito de pVencedor
    vagasRestantes -= 1

RETORNA:
  - eleitos[p]: lista de candidatos eleitos de p, na ordem em que ocuparam a vaga
  - cadeiras[p] = |eleitos[p]|   // *** É ESTE o número que vai para a TELA. ***
  - vagasObtidas[p]              // *** NUNCA vai para a tela. É só o denominador. ***
  - suplentes: candidatos não eleitos da mesma legenda, ordenados por voto nominal desc,
    empate por idade decrescente, SEM piso de votação nominal mínima (Código Eleitoral art. 112,
    parágrafo único, Lei 13.165/2015 — diferente do piso de 10% que vale só para a Fase 1)
```

**`vagasObtidas` e `cadeiras` são coisas diferentes, e confundi-las põe cadeira a mais na tela.**
`vagasObtidas[p]` é bookkeeping do denominador da média: por força do art. 11 § 5º da Res.-TSE
23.677/2021 (fundamento ADI 5.420/2015), ele conta o `QP[p]` **inteiro** mais as sobras já ganhas,
*ainda que não preenchidas*. `cadeiras[p]` é quantos candidatos de `p` de fato ocuparam vaga. Os
dois divergem exatamente quando `QP[p] > |elegiveis[p]|` — partido com quociente para 3 cadeiras
mas só 2 candidatos acima dos 10% do QE.

Exemplo mínimo: UF com 10 vagas, QE = 1.000, partido A com 3.500 votos (`QP = 3`) e 2 candidatos
acima de 100 votos. `ocupadas = 2`, `vagasObtidas = 3`. Exibir `vagasObtidas` mostraria **3
cadeiras para quem elegeu 2**, e a soma nacional fecharia em **11 de 10 vagas** — porque a vaga
não ocupada foi para as sobras e pode ter ido para outro partido, sendo contada duas vezes.

A implementação deve manter os dois campos com nomes distintos e **não** derivar um do outro. Um
teste que some `cadeiras[p]` sobre todos os partidos e compare com `lugaresAPreencher` pega essa
confusão imediatamente; um que some `vagasObtidas[p]` não pega nada — ele pode legitimamente
exceder o total.

**Tabela de casos de borda** (implementação deve ter teste unitário para cada linha):

| # | Caso | Regra | Fonte |
|---|---|---|---|
| 1 | Fração do quociente eleitoral exatamente 0,5 | Fica na parte inteira (desce) — **não** é `round()` padrão, que arredondaria para cima | Código Eleitoral art. 106 |
| 2 | `QP[p]` maior que o nº de candidatos de `p` com voto nominal ≥ 10% do QE | As vagas excedentes não são ocupadas nesta fase, mas o `QP[p]` inteiro permanece no denominador da média (`vagasObtidas[p] = QP[p]`, não o nº efetivamente ocupado) | Res.-TSE 23.677/2021 art. 11 § 5º, fundamento ADI 5.420/2015 |
| 2b | Soma de `cadeiras[p]` sobre todos os partidos | Tem de dar **exatamente** `lugaresAPreencher`. A soma de `vagasObtidas[p]` **não** tem essa propriedade e pode excedê-lo — são grandezas distintas (ver bloco acima) | Consequência do art. 11 § 5º combinado com o art. 108 |
| 3 | Partido com `QP[p] = 0` disputa sobras | Permitido — elegibilidade para sobras não exige `QP > 0`, só os pisos de voto (80%/20% na Fase 2, nenhum na Fase 3) | Código Eleitoral art. 109, redação Lei 14.211/2021 |
| 4 | Empate de médias entre 2+ partidos | 1º critério: maior votação total do partido; persistindo: maior votação nominal do candidato que disputa a vaga | Res.-TSE 23.677/2021 art. 11 §§ 6º–7º |
| 5 | Empate de votação nominal entre 2 candidatos do mesmo partido/federação | Mais idoso | Código Eleitoral art. 110 |
| 6 | Federação disputando cadeiras | Tratada como partido único: soma de votos, `QP`, médias e ordem interna dos candidatos calculados sobre o total da federação | Lei 9.096/1995 art. 11-A (Lei 14.208/2021); Lei 9.504/1997 art. 6º-A |
| 7 | Marcador de coligação aparece numa corrida proporcional | Não deveria ocorrer — coligação em proporcional é vedada desde 2020; tratar como anomalia de dado a logar/alertar, nunca como agremiação válida a processar | CF art. 17 § 1º, redação EC 97/2017 art. 2º |
| 8 | Nenhum partido atinge o QE (`QP[p] = 0` para todos) | O art. 111 do Código Eleitoral (eleger "mais votados individualmente") foi **declarado inconstitucional** — não implementar. Aplica-se o próprio algoritmo de médias (Fases 2 e 3) a todas as vagas, partindo de `vagasObtidas[p] = 0` | Res.-TSE 23.677/2021 art. 12-A (Res. 23.734/2024, inciso II na redação da Res. 23.748/2026); STF ADIs 7228/7263/7325 |

**Questão em aberto — não resolvida por este ADR.** O art. 109 § 2º exige, para a Fase 2, que o
partido "tenha candidato" com ≥ 20% do QE, sem dizer explicitamente "ainda não eleito". Não há
dispositivo nem acórdão localizado que resolva a ambiguidade. Leitura operacional adotada acima:
o candidato precisa estar não eleito, porque senão a vaga adicional que o partido ganharia não
teria a quem ser atribuída dentro da própria lógica do algoritmo (a vaga vai para o próximo
candidato não eleito por ordem de voto nominal — se todos os candidatos acima de 20% já
estivessem eleitos, a condição perderia sentido operacional). Recomendação: travar essa leitura
com fixture do simulado 2 (22–24/09) antes de shipped, e reabrir se o TSE/STF publicar algo que
contradiga.

## Alternativas consideradas

- **Implementar o art. 111 literal** ("mais votados individualmente" quando nenhum partido atinge
  o QE). Rejeitada: o dispositivo foi declarado inconstitucional pelo STF (ADIs 7228/7263/7325,
  mérito 28/02/2024) e substituído pelo art. 12-A da Res.-TSE 23.677/2021. Implementar o texto
  do Código Eleitoral sem checar a jurisprudência produziria um resultado juridicamente errado,
  ainda que "fiel à lei" na leitura mais ingênua.
- **Usar `round()` padrão para o quociente eleitoral.** Rejeitada: o texto do art. 106 não é
  arredondamento comum — fração exatamente igual a meio desce, não sobe. `round()`/`Math.round`
  da maioria das linguagens usa half-up (0,5 sobe), o que produziria QE errado em qualquer UF cuja
  divisão caia exatamente em `,5`.
- **Restringir toda a fase de sobras aos pisos de 80%/20%, sem fase aberta.** Rejeitada: violaria
  a interpretação conforme das ADIs 7228/7263/7325, que exige que **todos** os partidos disputem
  as sobras remanescentes uma vez esgotados os que atendem aos dois pisos.
- **Hardcodar a tabela de vagas por UF (LC 78/1993) no código.** Rejeitada: ~~a tabela por UF não
  está confirmada em fonte primária estável para 2026 (PLP 177/2023 em tramitação, desfecho não
  confirmado)~~ o PLP 177/2023 já teve desfecho (vetado em julho/2025, STF mantendo 513 — nota
  2026-09-19 no Contexto), mas a tabela por UF segue fora de qualquer fonte primária verificada
  por este ADR; o próprio TSE publica o número no envelope de dados, e usá-lo elimina o risco de
  divergência entre o número mantido à mão e o que o TSE realmente aplicar no dia — hoje por
  robustez contra qualquer mudança futura, não mais por aguardar um desfecho pendente.
- **Modelar federação como partidos separados, com atribuição posterior de cadeiras entre
  membros.** Rejeitada: a lei trata federação como partido único para o cálculo inteiro (QP,
  médias); separar depois introduziria uma etapa de atribuição interna sem base legal.
- **Ignorar a distinção entre "conta QP inteiro no denominador" vs. "conta só vagas ocupadas"
  (caso de borda #2) por simplicidade de implementação.** Rejeitada: é precisamente o tipo de
  simplificação que produz número de cadeira errado sem gerar nenhum erro visível — a mesma classe
  de defeito que o ADR-0035 documentou para zona/município. A Res.-TSE 23.677/2021 art. 11 § 5º
  e a ADI 5.420/2015 são explícitas sobre isso.

## Consequências

**Positivas**:
- O algoritmo é auditável linha a linha contra texto de lei e resolução vigentes, com fonte citada
  em cada fase e em cada caso de borda — qualquer revisor pode conferir sem depender de memória
  institucional.
- `lugaresAPreencher` vindo do dado do TSE, não hardcoded, remove um vetor de erro sistemático
  (tabela desatualizada) exatamente na variável que mais distorce o quociente eleitoral se errada.
- A distinção entre `QP[p]` (denominador da média) e `ocupadas[p]` (vagas efetivamente preenchidas
  na Fase 1) previne uma classe de erro sutil — partido com muitos votos e poucos candidatos
  qualificados teria sua força de barganha nas sobras subestimada se o código usasse só
  `ocupadas[p]`.
- Federação como partido único e ausência de coligação em proporcional são tratadas como
  invariantes de dado, não como casos a inferir do EA20 — reduz superfície de bug de parsing.

**Negativas**:
- **A tabela de cadeiras por UF não está confirmada em fonte primária estável.** A Res.-TSE
  23.748/2026 remete à LC 78/1993, mas ~~há tramitação legislativa em aberto (PLP 177/2023) sem
  desfecho conhecido em 2026-09-11~~ o PLP 177/2023 já teve desfecho — vetado em julho/2025, STF
  mantendo 513 (nota 2026-09-19 no Contexto) —, e isso fecha o **total nacional**, não a
  distribuição **por UF**, que este ADR nunca verificou contra a LC 78/1993 e continua sem fonte
  primária citada aqui. A decisão de ler `lugaresAPreencher` do dado do TSE mitiga o risco de
  número errado no código, mas não elimina o risco de o próprio TSE publicar um valor diferente do
  esperado sem aviso — só um smoke test no simulado detecta isso, não uma auditoria estática.
- **A questão "candidato ainda não eleito" no piso de 20% da Fase 2 permanece sem base legal ou
  jurisprudencial explícita.** A leitura operacional adotada é defensável, mas não é certeza
  jurídica — um caso real em que o texto literal e a leitura operacional divirjam pode exigir
  correção em produção, no pior momento possível (durante a apuração).
- **Qualquer golden test contra 2022 precisa usar os resultados recalculados pós-ADI, não os
  proclamados à época.** A retroação dos embargos (13/03/2025) significa que o resultado oficial
  de 2022 hoje é diferente do resultado divulgado na noite da eleição para pelo menos os casos em
  que o art. 111 (então vigente) teria sido aplicado. Usar dado de 2022 sem confirmar que é a
  versão recalculada produziria um fixture de teste **silenciosamente errado** — validado contra
  um número que o próprio TSE não sustenta mais.
- **O algoritmo tem três fases com laços de decisão (Fase 2, Fase 3) que dependem de recálculo de
  médias a cada vaga distribuída** — custo computacional não é o problema (número de vagas por UF
  é pequeno), mas é mais uma superfície de estado mutável (`vagasObtidas[p]`, listas de elegíveis
  que encolhem) que precisa de teste de regressão por fase, não só ponta a ponta.
- **Este ADR não define onde e como a UI comunica cadeiras "projetadas" vs. "cadeiras já
  matematicamente decididas"** (ex.: um partido pode ter QP garantido mesmo com poucos votos
  apurados, mas a projeção de sobras muda a cada atualização) — fica para a spec 017 decidir a
  semântica de exibição ao vivo; este ADR só define o cálculo.

## Cross-refs

- [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — reserva o método de
  conversão de votos em cadeiras para este ADR (`:37`, `:75`); citação de "art. 111 da Lei 9.504"
  ali é **incorreta** — ver nota de emenda sugerida abaixo, não aplicada por este ADR.
- [ADR-0001](0001-edge-config-no-read-path.md) — cadeiras agregadas por partido entram no read
  path (Edge Config ou Blob, conforme volume, a decidir na spec 017).
- [ADR-0020](0020-conformidade-res-23751-2026.md) — RF-010.3 e os denominadores `vvc`/`c`
  aplicam-se igualmente à corrida de Deputado Federal; este ADR não os altera.
- `api/model/cargos.py` (`TOTAL_CADEIRAS`, `VAGAS_EM_DISPUTA_2026`) — onde o total nacional de 513
  cadeiras (desfecho do PLP 177/2023: vetado em julho/2025, STF mantendo 513) está declarado desde
  2026-09-19, ao lado das 81/54 do Senado. Fonte da emenda no `## Status` e das notas de
  2026-09-19 no Contexto, Alternativas consideradas e Consequências → Negativas deste ADR.
- Constituição § 1 (dado oficial intocável; § 1 também exige identificação honesta perante o TSE —
  aplica-se à leitura do campo `lugaresAPreencher`, nunca sondado, sempre lido do envelope
  oficial), § 6 (determinismo — o algoritmo acima é puro e reprodutível a partir do snapshot
  persistido), § 8 (transparência metodológica — `/sobre-o-modelo` deve descrever, em linguagem
  acessível, como cadeiras são calculadas quando a spec 017 entrar).
- `docs/reference/regulatory.md` — pendente de seção nova citando Código Eleitoral arts. 106–112,
  Res.-TSE 23.677/2021 (23.734/2024, 23.748/2026), e as ADIs 7228/7263/7325 — watch item novo,
  distinto da Res. 23.751/2026 já registrada lá (propagação sugerida ao `spec-syncer`).
- `docs/reference/risks.md` — pendente de linha nova: questão em aberto sobre "candidato ainda não
  eleito" no piso de 20% da Fase 2, e risco de a tabela de vagas por UF divergir do esperado no
  simulado (propagação sugerida).
- Spec 017 (`docs/specs/017-deputado-federal/`, a criar pelo usuário) — implementa este algoritmo;
  deve referenciar ADR-0027 no frontmatter `adrs:` e construir os fixtures golden contra os
  resultados de 2022 **recalculados** pós-ADI, não os proclamados à época.
- `docs/testing/replay.md` — se a spec 017 adotar um gate de replay análogo ao OT-4 do modelo
  presidencial/governador, deve citar explicitamente a retroação da ADI como pré-condição de
  fixture válido.

## Nota de emenda sugerida ao ADR-0026 (não aplicada)

Sugestão de texto para acrescentar ao `## Status` de
`docs/architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md`, no mesmo padrão das
notas de emenda do ADR-0035:

> **Nota 2026-09-11 ([ADR-0027](0027-conversao-votos-em-cadeiras-deputado-federal.md)).** O texto
> original deste ADR (`:37`) cita "art. 111 da Lei 9.504" como o dispositivo do quociente
> eleitoral e da distribuição de cadeiras. Isso está incorreto: os artigos 106–112 que regem
> quociente eleitoral, quociente partidário, cláusula dos 10%, sobras e o próprio art. 111 estão
> no **Código Eleitoral (Lei nº 4.737/1965)**, não na Lei 9.504/1997. Adicionalmente, o art. 111
> do Código Eleitoral foi **declarado inconstitucional** pelo STF (ADIs 7228/7263/7325, mérito
> 28/02/2024) e substituído pelo art. 12-A da Res.-TSE 23.677/2021 — não é implementável como
> escrito. O método completo de conversão de votos em cadeiras está formalizado no ADR-0027; a
> decisão de granularidade UF/crons próprios para Senador e Deputado, registrada no corpo deste
> ADR, permanece integralmente vigente e não é afetada por esta correção de citação.

Esta nota **não foi aplicada** ao arquivo do ADR-0026 por este ADR-0027 — cabe ao orquestrador
decidir se despacha `spec-syncer` (ou edita diretamente) para propagá-la, junto da atualização de
`docs/_meta/index.json` (campo `note`/`amended_by` da entrada `0026`).
