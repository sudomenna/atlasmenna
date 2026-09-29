---
id: ADR-0044
title: Código de eleição por cargo, não um único TSE_COD_ELEICAO — tabela CARGOS exaustiva, nenhuma eleição supre a outra
status: accepted
date: 2026-09-17
---

# ADR-0044 — Código de eleição por cargo, não um único `TSE_COD_ELEICAO`

## Status

Aceito. Implementado no mesmo dia em `lib/config/cargos.ts` (campo `eleicao`) e `lib/tse/targets.ts`
(`getCodEleicao(eleicao)`, `getCodEleicaoDoCargo`, `:293-367`).

> **Nota 2026-09-29 ([ADR-0066](0066-cargos-7-e-8-como-proporcionais-do-produto.md)).** Os cargos 7 e 8
> (Deputado Estadual e Distrital), que o Contexto abaixo cita como "fora do escopo do produto", passaram a
> ser cobertos por decisão do dono em 29/09. O mecanismo deste ADR vale **sem alteração**: os dois entram na
> tabela `CARGOS` com `eleicao: "estadual"` — a mesma eleição `21272` e a mesma
> `TSE_COD_ELEICAO_ESTADUAL`, nenhuma variável nova — e a tabela passa de quatro a seis entradas (onde a
> Decisão diz "cada uma das quatro entradas", leia-se cada uma das seis). A exaustividade por tipo
> (`CargoTse`) segue sendo o que impede uma entrada sem `eleicao`. A Eleição Municipal (`21274`, Conselheiro
> Distrital) continua fora de escopo. O corpo deste ADR não foi reescrito.

## Contexto

A página técnica do TSE e o CDN do simulado, verificados em 17/09/2026, revelam que o pleito 2026
(`pleito 17801`, ciclo `ele2026`) não é uma única eleição — são **duas árvores de URL paralelas** sob
o mesmo ciclo: a Eleição Ordinária Federal, código `21270`, que elege só o Presidente (cargo TSE 1); e
a Eleição Ordinária Estadual, código `21272`, que elege Governador (3), Senador (5) e Deputado Federal
(6) — os cargos 7/8 (Deputado Estadual/Distrital) também vivem nessa árvore mas estão fora do escopo
do produto. Há ainda uma Eleição Municipal, código `21274` (Conselheiro Distrital), igualmente fora de
escopo. Cada árvore tem sua própria hierarquia de pastas no CDN
(`<host>/<ambiente>/<ciclo>/<eleição>/dados/<uf>/…`) e seu próprio arquivo de acompanhamento nacional
EA14 — um por eleição (`br-e021270-ab.json` para a Federal, `br-e021272-ab.json` para a Estadual), não
um único arquivo compartilhado.

Antes desta decisão, `lib/tse/targets.ts::getCodEleicao()` lia um único valor de ambiente
(`TSE_COD_ELEICAO`, formato `ele<AAAA>/<dígitos>`) e o aplicava a **todos** os cargos ativos,
independente de qual dos dois pertencessem. Isso é uma suposição implícita de que existe um só código
de eleição no pleito — falsa para 2026, verdadeira só por acidente em ciclos anteriores onde o produto
cobria apenas Presidente. `docs/reference/tse-2026-leiautes.md:240-244` chegou a registrar
explicitamente "nenhuma mudança necessária" nessa função — conclusão errada, escrita antes de a
pesquisa de 17/09 revelar os dois códigos, e corrigida nesta mesma janela. Sob a suposição antiga,
ativar Senador/Deputado com `TSE_COD_ELEICAO=ele2026/21270` (o código certo só para Presidente)
buscaria o EA20 da eleição errada para os outros três cargos — um 404 sistemático em produção, ou
pior, um payload de outra eleição se por coincidência o código respondesse a algo.

A tabela `CARGOS` (`lib/config/cargos.ts`, ADR anterior que a introduziu para consolidar quatro
lugares divergentes de metadado de cargo) já existia como o ponto único de verdade sobre cada cargo
coberto. O projeto tem uma regra de bordo já sofrida quatro vezes: conversor de enum com ramo
`default` silencioso é fonte recorrente de incidente (o mais recente mandou todo um payload de
Senador para a chave do Presidente). Qualquer solução para o código de eleição por cargo precisava
evitar esse padrão.

## Decisão

O mapeamento cargo→eleição vive na tabela `CARGOS` (`lib/config/cargos.ts`), como campo **obrigatório**
`eleicao: "federal" | "estadual"` — não op­cional, não com default, exaustivo pelo tipo `CargoTse`.
Presidente é o único cargo `"federal"`; Governador, Senador e Deputado Federal são `"estadual"`. Não
há ramo `default`/`??` nessa atribuição: cada uma das quatro entradas da tabela declara seu valor
explicitamente, e adicionar um quinto cargo sem declarar `eleicao` é erro de compilação, não um
`undefined` silencioso em runtime.

`getCodEleicao(eleicao: Eleicao): string` (`lib/tse/targets.ts:332`) passa a exigir o parâmetro — não
há mais uma chamada sem argumento que sirva "para todos os cargos". A resolução de variáveis de
ambiente segue uma ordem estrita, sem uma eleição nunca suprir a outra:

1. A variável **específica** da eleição — `TSE_COD_ELEICAO_FEDERAL` ou `TSE_COD_ELEICAO_ESTADUAL`
   (`targets.ts:296-297`).
2. Se ausente, a variável **legada** `TSE_COD_ELEICAO` (compatibilidade com mock/testes que só
   conhecem um código) — mas essa variável legada é compartilhada pelas duas eleições apenas como
   *fallback simultâneo*, nunca como substituição cruzada: se `TSE_COD_ELEICAO_FEDERAL` está setada e
   `TSE_COD_ELEICAO_ESTADUAL` está ausente e `TSE_COD_ELEICAO` também está ausente, a resolução da
   eleição estadual **falha** — não cai silenciosamente no valor federal.
3. Nenhuma das duas presentes → `throw` explícito (`targets.ts:341-351`), com mensagem que nomeia a
   variável específica esperada e cita o formato (`"ele2026/21270"` / `"ele2026/21272"`).

`getCodEleicaoDoCargo(cargo: CargoTse)` (`targets.ts:366`) é o atalho que a maior parte do código
chama: resolve `eleicaoDoCargo(cargo)` via `CARGOS` e delega a `getCodEleicao`. Um EA14 de
acompanhamento nacional é lido por código de eleição, não um único arquivo global — Presidente lê
`br-e021270-ab.json`, os outros três leriam `br-e021272-ab.json` quando essa leitura existir para
eles. `TSE_BASE_URL` continua responsável só por host+ambiente (ex.
`.../simulado/simulado2026` no preview, `.../oficial` em produção) — a eleição é uma dimensão
ortogonal, resolvida por cargo, nunca embutida no base URL.

## Alternativas rejeitadas

- **Um único valor com mini-DSL** (`TSE_COD_ELEICAO="federal=ele2026/21270,estadual=ele2026/21272"`).
  Rejeitada: exigiria um parser novo só para essa sintaxe, e qualquer erro de parsing (vírgula
  faltando, chave grafada errado) tende a degradar para um default silencioso — exatamente o padrão
  que o projeto já sofreu quatro vezes com conversores de enum.
- **Descobrir os códigos em runtime**, lendo `ele-c.json` (EA11) na primeira requisição e cacheando.
  Rejeitada: adicionaria uma dependência de rede no arranque de cada cron/rota de ingestão, e os
  códigos de eleição são configuração **publicada** pelo TSE antes do pleito, não algo que precise ser
  descoberto a cada deploy — tratá-los como configuração estática (variável de ambiente) é consistente
  com o resto do projeto (`TSE_BASE_URL`, `TSE_MAX_RPS`, etc.).

## Consequências

**Positivas**:
- Elimina a classe de erro "cargo estadual lido com código federal (ou vice-versa)" — o TypeScript
  recusa compilar uma nova entrada de `CARGOS` sem `eleicao` declarado, e o `throw` em runtime nomeia
  exatamente qual variável falta, em vez de produzir um 404 silencioso contra o CDN do TSE.
- Reaproveita a tabela `CARGOS` já existente como fonte única, em vez de introduzir um segundo
  mecanismo de configuração paralelo.
- O padrão de precedência (específica → legada → erro, nunca cruzada) é o mesmo já usado em outros
  pontos do projeto para overrides por ambiente — não é um mecanismo novo a aprender.

**Negativas**:
- Três variáveis de ambiente no preview em vez de uma (`TSE_COD_ELEICAO_FEDERAL`,
  `TSE_COD_ELEICAO_ESTADUAL`, mais a legada mantida por compatibilidade) — superfície de configuração
  maior, com potencial de divergência entre ambientes se alguém esquecer de setar uma delas em
  produção antes de 03/10.
- Produção precisa dos dois valores específicos publicados a tempo do 1º turno (04/10/2026); o TSE
  ainda não publicou os códigos de produção ("oportunamente", conforme a página técnica em
  17/09/2026) — watch ativo até lá.
- `scripts/tse-mock-server.ts` precisa aprender a responder por `--ambiente` (simulado vs. oficial) e
  pelos dois códigos de eleição simultaneamente, mais complexidade de fixture de teste.
- Nenhum teste de integração hoje cobre o caminho "ambas as variáveis específicas ausentes, legada
  também ausente, dois cargos de eleições diferentes tentam resolver ao mesmo tempo" — o `throw` foi
  verificado por leitura de código, não por teste dedicado nesta janela.

## Cross-refs

- Spec 001 (`docs/specs/001-ingestao-tse/spec.md`) — RF-001 (fan-out de alvos) e RF-010.5 (segredo e
  variáveis de ambiente do cron) devem passar a citar este ADR e documentar as duas variáveis novas.
- [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) — introduziu Senador e Deputado
  Federal como cargos cobertos sob a suposição (agora corrigida) de um único código de eleição; este
  ADR não o supersede, só corrige uma premissa que ele carregava implicitamente.
- [ADR-0020](0020-conformidade-res-23751-2026.md) — a resolução de código de eleição por cargo não
  altera o teto de rps nem a lógica de conformidade regulatória; cargos continuam sendo enumerados do
  mesmo jeito, só a URL resolvida muda por eleição.
- `docs/operations/runbook.md` — precisa de seção documentando as duas variáveis de produção e o
  procedimento para setá-las quando o TSE publicar os códigos oficiais.
- `docs/reference/tse-2026-leiautes.md:240-244` — o texto "nenhuma mudança necessária" está
  desatualizado e deve ser corrigido para apontar este ADR.
- Constituição § 1 (conformidade regulatória — buscar o dado certo do cargo certo, sem adivinhação de
  URL).
