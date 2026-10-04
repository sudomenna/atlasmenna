---
id: ADR-0075
title: Marca de eleito só com eleição matematicamente definida (`eleitos_definidos`), não pela chamada da projeção
status: accepted
date: 2026-10-04
amends: [0017]
---

# ADR-0075 — Marca de eleito só com eleição matematicamente definida (`eleitos_definidos`)

## Status

Aceito (2026-10-04). Decisão do dono, tomada no dia do 1º turno.

Não supersede nenhum ADR. **Emenda o [ADR-0017](0017-transparencia-total-3-camadas.md)** no que ele
deixou como placeholder para a "chamada" de corrida: `EdgeUfRow.chamada` (projeção) deixa de ser o gatilho
de qualquer marca de eleito nos mapas, gavetas, cartões e faixa "AGORA"/Boletim. O campo permanece no
contrato para outras telas. Reforça o [ADR-0055](0055-resultpanel-top2-cartoes-versao-d.md) (nunca "Eleito"
solto vindo de projeção) e usa o [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) para
definir quem compete.

## Contexto

**1. A marca de eleito vinha da projeção.** Até 04/10, o balão do mapa nacional
(Presidente/Governador/Senador) pintava fundo cheio + ✓ e escrevia "Chamada" quando
`EdgeUfRow.chamada === true`. Esse booleano é leitura da **projeção**: `chamada_da_corrida` em
`api/model/project.py`, com `LIMIAR_CHAMADA_PP = 10.0` — margem projetada acima de 10 pp (no Senado,
2º − 3º colocado). Ele independia do seletor Parcial/Projeção, de modo que a base "Parcial" (contagem
real) exibia um selo derivado da base "Projeção". O caso que expôs o problema: **Senado de MT com 27%
apurado mostrando dois "eleitos"**. A gaveta mobile não tinha marca alguma e os cartões mostravam
"● ELEITO" também pela projeção. Isso é dizer ao leitor que algo está decidido quando só está provável —
risco direto à constituição § 1 (não afirmar o que o dado não sustenta).

**2. O TSE publica a definição oficial só em parte dos cargos.** O campo `md` do EA20 (dicionário:
`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:189,414,590-600`) existe **apenas para
Presidente, Governador e Prefeito**, e só enquanto a totalização não terminou (`tf='n'`): `'e'` = eleito,
`'s'` = segundo turno. Para Senado não há `md`. Para o proporcional (Deputados) a eleição depende de
quociente e sobras, fora do alcance deste ADR. Depois da totalização final (`tf='s'`), cada candidatura
traz `st` (situação: Eleito, Eleito por QP, Eleito por média, 2º turno) e `e`.

**3. Alternativas consideradas.** (a) Manter `chamada` e só mudar o rótulo para "Projeção indica" —
rejeitada: continua pintando fundo cheio e ✓, que o leitor lê como resultado, e continua independente do
seletor. (b) Subir o limiar de `chamada` — rejeitada: continua sendo uma opinião estatística com ponto de
corte arbitrário, e o Senado de MT mostra que qualquer limiar fixo erra cedo na noite. (c) Esperar só o
`tf='s'` para qualquer marca — rejeitada: joga fora o `md` oficial do TSE, que chega muito antes, e a prova
aritmética do Senado, que é verificável. (d) **Marca só quando a eleição está definida por fonte oficial ou
por prova aritmética** — escolhida.

## Decisão

A marca visual de eleito (fundo colorido + ✓) aparece **somente para candidato matematicamente eleito**,
**idêntica nas duas bases** do seletor Parcial/Projeção, no balão do mapa, na gaveta do estado, na gaveta
de município, nos cartões e na faixa "AGORA"/Boletim. A fonte, por cargo:

- **Presidente.** Ninguém é eleito por UF. A marca só aparece quando o **Brasil** está definido — EA20 de
  abrangência `br` com `md='e'`, ou `tf='s'` — e então o eleito aparece em todas as UFs em que está no top.
- **Governador.** Campo oficial `md` do EA20 de abrangência UF: `'e'` marca eleito o líder da contagem que
  compete; `'s'` marca `segundo_turno_definido`.
- **Senado (TSE não publica `md`).** Cálculo próprio, conservador. Entre os candidatos que **competem**
  (anulada fora, sub judice dentro — ADR-0053), ordenados por votos apurados, o candidato *k* ∈ {1º, 2º} é
  definido se `votos_k − votos_3º > R`, com `R = te − c − a + esna` lidos do **mesmo** arquivo UF
  (eleitores das seções ainda não totalizadas, incluindo as não apuradas). A prova: cada eleitor dá no
  máximo um voto a um mesmo candidato (os dois votos do Senado vão a candidatos distintos), logo nenhum
  candidato ganha mais que `R` votos adicionais; se a vantagem sobre o 3º supera `R`, o 3º — e portanto
  qualquer outro de fora — não alcança *k*. Candidatura ilegível ⇒ `R` indisponível ⇒ nada é marcado.
  Critério estrito (desigualdade `>`).
- **Após totalização final (`tf='s'`).** `cand.st` decide: Eleito / Eleito por QP / Eleito por média =
  eleito; "2º turno" = 2º turno. Sem `st`, usa-se `cand.e='s'`, com a ressalva de que no dicionário
  `e='s'` significa "eleito **ou** 2º turno": uma marca = eleito, duas marcas = 2º turno, onde o 2º turno é
  possível. `esae='s'` ⇒ nada é marcado.

**Contrato.** `EdgeUfRow.eleitos_definidos?: number[]` (ausente quando vazio) e
`segundo_turno_definido?: true` (só Governador, 1º turno). `chamada` permanece. Falha no cálculo registra
aviso e **omite os campos** — nunca derruba o payload.
`definicao_oficial?: true` (04/10, para o 2º turno) acompanha os dois quando a definição veio do TSE (`md`, ou `tf='s'` em qualquer cargo) e falta na conta própria do Senado; a atribuição do Senado passa a "Definição oficial do TSE" com ele.

**Rótulos.** "Matematicamente eleito(s)" e "2º turno definido"; escopo explícito "No estado:" / "No país:"
na gaveta de município e em Presidente; no Senado, atribuição "Cálculo do AtlasMenna sobre a contagem do
TSE". Nunca "Eleito" solto vindo de projeção (ADR-0055). Os selos por base (Parcial/Projeção) continuam
descrevendo **posição**, não eleição.

**Fora de escopo.** Deputado (proporcional): a marca de eleito já tem fundo cheio apenas em "Eleito (TSE)"
após a totalização final (spec 026).

**Implementação** (registro; código fora do escopo deste ADR): `api/model/definidos.py`;
`api/model/project.py` (`ler_definicao_agregado`, `montar_definidos`, `_montar_definidos_seguro`);
`lib/utils/eleitos-definidos.ts`; `lib/utils/selo-resultado.ts`; `HoverCard.tsx`;
`_NationalChoroplethMapImpl.tsx`; `StateResultSheet.tsx`; `MunicipioExplorer.tsx`; `GovernorCard.tsx`;
`lib/state/por-uf-store.ts`.

## Consequências

**Positivas**:
- A marca de eleito deixa de poder contradizer a contagem: ou há fonte oficial do TSE, ou há prova
  aritmética reproduzível a partir do mesmo arquivo. O caso Senado MT com 27% apurado não pode mais ocorrer.
- Marca idêntica nas duas bases do seletor e em todas as superfícies (balão, gavetas, cartões, Boletim) —
  uma única regra, um único campo no contrato.
- O Governador usa o dado oficial (`md`), sem opinião do AtlasMenna; só o Senado carrega cálculo próprio,
  e com atribuição explícita na tela.
- Falha isolada (`_montar_definidos_seguro`) degrada para "sem marca", sem afetar o resto do payload.

**Negativas**:
- O mapa passa boa parte da noite **sem fundo colorido**: a projeção continua mostrando posição, mas não há
  mais a sensação de "corrida decidida" que a `chamada` dava cedo.
- No Senado a definição tende a sair só **perto do fim** da apuração: `R` só encolhe quando as seções são
  totalizadas, e o critério (voto máximo possível de todo eleitor restante contra o 3º) é deliberadamente
  mais pessimista que qualquer projeção.
- **Sem histerese**: uma leitura ruim num ciclo (arquivo UF ilegível, candidatura faltando) omite os campos
  e o ✓ some até o ciclo seguinte. É o lado seguro para a constituição § 1, mas o leitor pode ver a marca
  piscar.
- O **modo simulado não emite os campos** (fixture não ajustada); telas de ensaio não exercitam a marca de
  ponta a ponta.
- A prova do Senado assume que votos já apurados não são removidos. Anulação posterior de candidatura
  (ADR-0053) depois de marcado é um caso residual que a regra não cobre, e o `tf='s'` com `st` do TSE
  passa a prevalecer.
- Dois mecanismos paralelos continuam no contrato (`chamada` e `eleitos_definidos`); quem consumir o campo
  errado reintroduz o problema. Os consumidores de marca visual devem ler apenas `eleitos_definidos`.
- A ambiguidade de `e='s'` ("eleito ou 2º turno") sem `st` é resolvida por contagem de marcas, heurística
  que só vale onde o 2º turno é possível.

## Cross-refs

- ADRs: [ADR-0017](0017-transparencia-total-3-camadas.md) (emendado — chamada placeholder),
  [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) (quem compete),
  [ADR-0055](0055-resultpanel-top2-cartoes-versao-d.md) (nunca "Eleito" de projeção; selos por base),
  [ADR-0005](0005-templates-nao-llm.md) e [ADR-0072](0072-leitura-da-noite-ia-e-imprensa.md) (textos do
  Boletim/faixa "AGORA" usam o novo campo e os rótulos acima).
- Constituição: § 1 (não afirmar além do dado) — princípio load-bearing desta decisão.
- Fonte regulatória: dicionário EA20, `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:189,414,590-600`.
- Specs a verificar para listar este ADR em `adrs:`: mapa nacional / home, páginas de UF e de cargo
  (Presidente, Governador, Senador), spec 022 (corrida), spec 026 (Deputado Federal — fora de escopo,
  citar só a fronteira), spec do Boletim/Análise (ADR-0072).
- NFRs sob impacto: confiabilidade/precisão dos dados exibidos; RNF-007a/b (a lógica em
  `lib/utils/eleitos-definidos.ts` é pequena, mas toca o chunk do mapa).
