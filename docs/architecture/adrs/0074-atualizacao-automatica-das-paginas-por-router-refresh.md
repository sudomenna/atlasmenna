---
id: ADR-0074
title: Atualização automática das páginas por `router.refresh()` a cada minuto, com pausa no rodapé — não SWR por componente, não refresh guiado por `dado_ts`, não modo telão opt-in
status: accepted
date: 2026-10-04
amends: [0002, 0029]
---

# ADR-0074 — Atualização automática das páginas por `router.refresh()`

## Status

Aceito (2026-10-04). Decisão do dono, tomada na manhã do 1º turno, depois da revisão de UX do telão
(medida em produção a 1920×1080 e no código).

**Emenda o [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) Decisão 2** — a restrição de
que o shell global carrega só dois componentes de cliente (`<ViewModeSwitch>`, `<ThemeToggle>`), que o
teste `tests/unit/shell/static-shell.test.ts` (expectativa (e)) atribui a esse item — passa a admitir um
**terceiro**. **Emenda o [ADR-0002](0002-polling-cdn-cache.md)** só no que ele decidia para o
conteúdo das páginas ("cliente faz SWR poll a cada 5 s em `GET /api/projection`"): esse mecanismo nunca
foi montado em página alguma e é substituído aqui. O restante do ADR-0002 (pull, não push) permanece. Não
toca o [ADR-0011](0011-cadencia-60s.md) (cadência do servidor), o
[ADR-0025](0025-design-system-atlas-menna-restyle-in-place.md) §§ 2 e 5 (o shell não lê dado dinâmico) nem
o [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) (o mapa persistente
continua buscando `/api/projection` por conta própria).

Substitui, no nível de requisito, o mecanismo descrito no RF-027 da spec 003 (que passa a ter uma nota de
emenda, sem renumeração) e cria o RF-296.

## Contexto

**1. Nenhuma página se atualiza sozinha — e o RF-027 dizia que sim.** Medido em 04/10: o único
componente que busca dado por conta própria é o mapa persistente (`PersistentMapFrame`, `REFRESH_MS =
60_000`, `components/layout/PersistentMapFrame.tsx:153`, que consulta `/api/projection`). Todo o resto —
placar, listas, painéis — é HTML renderizado no servidor e fica congelado até o leitor apertar F5. As
telas de Deputado não têm mapa, então no telão da noite elas ficariam paradas. O RF-027 ("polling SWR de
`/api/projection` a cada 5 s") consta como ✅ em `docs/_meta/traceability.md:63` e em
`docs/design-system/components.md:168`, mas o `<SwrProvider>` de
`components/shared/swr-provider.tsx` **não é importado por nenhuma página** (varredura de 04/10: só o
próprio arquivo e comentários o citam). O mecanismo do ADR-0002 existe como código morto; o ✅ da
matriz descreve um comportamento que nunca esteve no ar.

**2. As páginas em produção são dinâmicas.** O `revalidate = 60` declarado nas rotas não vale quando o
build tem `EDGE_CONFIG`: o SDK busca com `no-store` e a rota sai dinâmica (`ƒ`; `CLAUDE.md` § 12), e a
medição de 04/10 confirma `cache-control: no-store` na resposta da página. Isso decide a mecânica: pedir
de novo o payload RSC da rota **renderiza no servidor** e devolve o que o servidor enxerga agora,
inclusive o que vem do Blob (`deputado/uf/<UF>.json`) e não passa por `/api/projection`.

**3. Restrições herdadas.** O shell (`app/layout.tsx`) é guardado por `static-shell.test.ts`: nenhum
`cookies()`, `headers()`, `connection()` nem `searchParams` ali (expectativas (a)–(d)), e só dois
clientes (expectativa (e), cuja mensagem diz que "qualquer terceiro nome aqui é um custo novo em JS
acima da dobra em TODAS as rotas, contra o teto de 150 KiB do RNF-007a: exige justificativa"). Este ADR é
essa justificativa. O motivo histórico da regra — manter estáticas as 54 páginas de UF — hoje é parcial
(em produção elas já são dinâmicas), mas a guarda continua útil: um `pnpm build` sem `.env.local`
(CI, worktree) ainda pré-renderiza, e a regra barata evita regredir isso por acidente. Acessibilidade:
conteúdo que se atualiza sozinho por mais de cinco segundos exige que o leitor possa pausar, parar,
ocultar ou controlar a frequência (WCAG SC 2.2.2; constituição § 4 pede WCAG 2.1 AA, que o inclui). O
conteúdo de apuração é defensável como "essencial" ao propósito da página, mas o dono preferiu não
apostar nessa exceção.

**4. Alternativas pesadas.** (a) **SWR por componente.** Cada bloco precisaria saber a sua fonte e
remontar no cliente a montagem que o servidor já faz: as páginas de Deputado compõem Edge Config, Blob da
UF e lista 61+, e `/api/*` passa pelo BotID (`proxy.ts:103`), o que acrescenta falha possível a cada
busca. É reescrever o read path de cada tela. (b) **Atualizar só quando o `dado_ts` mudar.** É o mais
econômico, mas exige um sinal barato de "mudou": nas rotas sem mapa não existe um — qualquer sinal seria
mais um `GET` por minuto por aba, e passaria pelo BotID. Adiado, não rejeitado. (c) **Modo telão opt-in**
(parâmetro de URL ou chave na tela). Rejeitado pelo dono: o leitor comum também deixa a página aberta
na noite inteira, e um opt-in deixaria o padrão quebrado.

## Decisão

Um componente de cliente, `components/layout/AtualizacaoAutomatica.tsx` (`"use client"`, devolve
`null`), montado em `app/layout.tsx` logo depois de `<CargoTabs placement="bottom" />`, chama
`router.refresh()` (`next/navigation`) a cada **60 s mais um atraso aleatório de 0 a 15 s** (o jitter
espalha o pico de abas abertas no mesmo instante). **Só roda com a aba visível** (Page Visibility): oculta,
não pede nada; ao voltar, se já passaram mais de 60 s desde a última atualização, atualiza na hora
(catch-up). **Só roda nas rotas de uma lista de permitidas**, por expressão regular em um único lugar: `/`,
as capas de cargo e `/uf/<UF>` com ou sem o cargo; `/candidatos` e `/sobre-*` ficam de fora. **Não roda**
quando o navegador declara `saveData` nem quando o leitor pausou. Vale para **todos os visitantes**, não só
para o operador do telão.

A pausa é uma linha no `<Footer>` — "Esta página se atualiza a cada minuto · Pausar/Retomar" —, uma ilha de
cliente de ~0,5 KB cuja escolha fica no `localStorage` (sem cookie, sem dado pessoal; o mesmo mecanismo do
tema, ADR-0025 § 5). Operável por teclado, é o atendimento ao SC 2.2.2 e a única mudança visível no
celular. A linha só aparece onde a atualização está ativa — o texto não pode prometer o que a rota ou o
`saveData` desligam.

`router.refresh()` preserva o estado de cliente da árvore e substitui só o que o servidor devolve. Isso
torna **obrigatórios, no mesmo commit**, dois consertos que de outro modo fariam a página parecer
atualizar enquanto mostrava dado velho:

- `components/blocks/DeputadoListaAgremiacao.tsx` (`:239-304`) guardava as linhas em `useState(() =>
  ordenarPorRank(linhasIniciais))`: as props novas chegavam e eram ignoradas. As linhas passam a ser
  **derivadas das props** (`useMemo` sobre `ordenarPorRank(linhasIniciais)`); o que veio da rota 61+ fica
  num estado `extras`, juntado por `unirPorSqcand`, de modo que a faixa aberta e os candidatos buscados
  sobrevivem à atualização.
- `components/blocks/ReordenaListaPorBase.tsx` (`:118-127`) reordena as listas por mutação direta do DOM
  depois do commit, com dependência `[base]`. Depois de uma atualização a ordem do servidor volta, e a
  base escolhida pelo leitor (ADR-0051) só continua valendo se a reordenação for reaplicada: o efeito
  passa a rodar a **cada commit**, sem array de dependências (a função já é idempotente).

A expectativa (e) de `static-shell.test.ts` passa a exigir três clientes, e `SHELL_FILES` inclui o novo
arquivo. Como a atualização é a mesma renderização de servidor que a página já faz, o `DadoParadoBanner`
das páginas de Deputado passa a ser **reavaliado no servidor a cada minuto**: aparece e some sozinho.

## Consequências

**Positivas**:
- As telas de Deputado, sem mapa, deixam de congelar no telão; todas as páginas de apuração se
  atualizam para todo visitante, sem F5.
- Zero endpoint novo, zero segundo caminho de montagem: a página mostra o que o servidor monta, com as
  mesmas regras (interruptor da projeção do ADR-0063, trava, rótulos). Nada de dado novo no cliente.
- Aba em segundo plano não gera carga; o jitter dilui o pico.
- Fecha a divergência entre documento e realidade do RF-027 e a do ✅ de `traceability.md:63`.
- Se uma rota voltar a ser estática, `router.refresh()` passa a buscar o que a CDN serve (no máximo o
  `revalidate = 60`): continua correto e fica mais barato.

**Negativas**:
- **Custo de renderização.** Cada aba visível gera ~1 renderização de servidor por minuto, sem cache
  (`no-store`) — antes era uma por visita. Com a meta de 20.000+ acessos simultâneos (RNF-001), todos
  visíveis, são ~333 renderizações por segundo; **não foi medido**. A promessa do ADR-0002 (CDN absorve
  99,8%) e o RNF-005 (cache hit > 99%) valem para `/api/projection`, **não** para este tráfego.
- **Defasagem.** O RNF-006 (< 90 s, ADR-0011) foi calculado com cron de 60 s + ~10 s de processamento +
  ~10 s de propagação. Somando o ciclo de atualização da página (até 75 s) o pior caso nas telas sem mapa é
  ~155 s e a média ~90 s (estimativa, não medida). Antes, nessas telas, a defasagem era ilimitada; ainda
  assim o pior caso passa do número do RNF-006. A constituição § 3 diz < 30 s e já estava renegociada
  pelo ADR-0011 sem emenda do texto.
- **Não há interruptor global sem deploy.** O padrão do ADR-0063 (interruptor em chave do Edge Config) não
  se aplica: o shell não lê Edge Config (expectativa (d)) e um `fetch` a `/api/*` passaria pelo BotID. A
  pausa é por leitor. Se a carga prejudicar a apuração com o deploy congelado (4/10, 16h–5h), a alavanca é
  o Instant Rollback da Vercel (segundos) e depois `git revert`. Se o dono quiser uma chave remota antes do
  2º turno (25/10), é decisão nova.
- **Terceiro cliente no shell**: JS acima da dobra em todas as rotas, contra o RNF-007a (o piso de
  framework já consome quase tudo). O componente é pequeno e a ilha da pausa tem ~0,5 KB, mas o número
  precisa ser medido pelo `a11y-perf-auditor`, não suposto.
- **Leitor de tela não é avisado.** Nenhuma região viva nova: anunciar a cada minuto seria ruído. Quem usa
  leitor de tela só descobre que os números mudaram relendo; o controle de pausa e o `ApuracaoMeta` são
  os únicos sinais.
- **Dois relógios por aba.** O mapa continua com o próprio `fetch` de 60 s e a página tem o seu: mapa e
  painéis podem divergir por até ~75 s. É a mesma classe de risco do ADR-0033 (dois caminhos de dado),
  agora com a segunda perna também no tempo.
- **Defeito latente de estado em cliente.** Um componente que copia prop para `useState` passa a mostrar
  dado velho em silêncio. Foram achados e consertados dois; **a varredura dos demais blocos não foi feita**.
  A mitigação é a conferência visual no `dev:sim`, não uma garantia.
- **Publicação no dia do 1º turno**, antes do congelamento das 16h (ADR-0063), em commits separados por
  frente. Nem o comportamento de rolagem e foco depois do refresh nem a permanência do mapa (a moldura vive
  no layout) foram medidos antes do aceite: ficam para os portões e a conferência visual do dia.

## Alternativas consideradas

- **SWR por componente (o desenho do ADR-0002/RF-027).** Rejeitada: reescreve o read path de cada tela no
  cliente e passa pelo BotID.
- **Atualizar só quando o `dado_ts` muda.** Adiada: sem sinal barato nas rotas sem mapa; seria mais uma
  requisição por minuto.
- **Modo telão opt-in.** Rejeitada pelo dono: o padrão continuaria quebrado para quem não o ativa.

## Cross-refs

- [ADR-0002](0002-polling-cdn-cache.md) — o mecanismo de cliente que nunca foi montado; emendado.
- [ADR-0011](0011-cadencia-60s.md) / RNF-006 — cadência do servidor e defasagem; o pior caso passa do
  número do RNF.
- [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) Decisão 2 — shell com dois clientes;
  emendado para três. [ADR-0025](0025-design-system-atlas-menna-restyle-in-place.md) §§ 2, 5 e 6 — shell
  sem dado dinâmico, `localStorage` e não cookie, `"use client"` restrito: respeitados.
- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) — mapa persistente e o
  caminho duplo de dado.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — a base escolhida pelo
  leitor que o conserto de `ReordenaListaPorBase` preserva.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — interruptor que a
  página relê a cada renderização; congelamento de 4/10.
- Spec 003 (RF-027 com nota de emenda, RF-296); spec 026 (`DeputadoListaAgremiacao`).
- NFRs: RNF-001, RNF-005, RNF-006, RNF-007a ([performance.md](../../nfr/performance.md)); RNF-024
  ([accessibility.md](../../nfr/accessibility.md)).
- Constituição § 3 (defasagem, bundle), § 4 (SC 2.2.2, teclado), § 5 (sem PII; `localStorage` de
  preferência) e § 7 (falha de atualização mantém o último conteúdo): [../../constitution.md](../../constitution.md).
- Pendente de propagação (spec-syncer): `traceability.md:63`, `components.md` (nova linha para
  `AtualizacaoAutomatica` e a ilha de pausa; `SWRProvider` como código morto), comentários em
  `lib/edge-config/reader.ts:32` e `app/api/projection/route.ts:60`, e remoção posterior de
  `swr-provider.tsx` e da dependência `swr` (fora do dia de hoje).
