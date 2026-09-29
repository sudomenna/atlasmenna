---
id: 025-visoes-editoriais
type: design
title: Visões editoriais — design técnico
status: ready
date: 2026-09-29
spec: ./spec.md
adrs: [0024, 0049, 0053, 0055, 0057, 0059, 0060, 0061, 0062]
requirements: [RF-240, RF-241, RF-242, RF-243, RF-244, RF-245, RF-246, RF-247, RF-248, RF-249, RF-250, RF-251, RF-252, RF-253]
---

# Design 025 — Visões editoriais

> Frente F do plano de 29/09. Tudo continua **desligado** em produção: a cópia do
> build carrega o `editorial/etiquetas/publicar.json` versionado, que está todo em
> `false`, e só duas categorias têm critério publicado. Nada muda na tela até o dono
> ligar uma chave — e, para quatro categorias, mandar o critério.

## 1. Mapa

```
lerEtiquetas() ─┬─► lib/etiquetas/telas.ts   ──► chips (GovernorCard, ResultPanel, CandidatosGrid)
 (Blob | build) │    editorialDaCapa             tokens data-etq ──► EtiquetaFiltro (CSS :has)
                │    etiquetasDaLista            opções do <select>
                ├─► lib/etiquetas/visoes.ts  ──► V1 / V2 (SenadoDe2027Panel)
                │    3 portas: chave ·           Câmara 2027 (Camara2027Panel)
                │    critério · portão           V4 (RenovacaoPanel)
                ├─► components/blocks/_palanques-capa.ts ──► V3 (PalanquesMapa, outra frente)
                │    (lê Presidente só depois das 3 portas)
                └─► lib/etiquetas/metodologia.ts ──► /sobre-as-etiquetas
lib/utils/hemiciclo-bloco.ts ──► HemicicloPorBloco (sobre Hemiciclo) ──► V1, Câmara 2027
```

Toda leitura acontece na PÁGINA (Server Component async) e desce por props: os
testes de página renderizam com `renderToStaticMarkup`, que não aceita componente
assíncrono aninhado.

## 2. As três portas (`lib/etiquetas/visoes.ts`)

Toda visão agregada devolve `{ ok: true, visao }` ou `{ ok: false, motivo }` com
`motivo ∈ desligada | sem_criterio | sem_dados | recusa_senado | portao`. A ordem das
portas: chave (`viewLigada`) → critério (`categoriaExibivel`) → dados → portão. O
painel não desenha nada em `ok: false` e loga uma linha quando é `portao` (a visão
foi pedida e não apareceu — o vigia lista quem falta).

| Visão | Chave | Categoria | Portão |
|---|---|---|---|
| V1 | `v1` | `relacao_governo` | `avaliarCorridas` (27 UFs do Senado, universo por UF) + `avaliarSenado2031` com os CÓDIGOS DA FOTO que o desenho usa |
| V2 | `v2` | `impeachment_stf` | idem, em impeachment |
| Câmara 2027 | `camara2027` | `relacao_governo` | `avaliarCamara2027` sobre a resolução de cada agremiação |
| V4 | `v4` | `trajetoria_cargo` | `avaliarUniverso` (novo, `portao.ts`) — a corrida INTEIRA de cada UF concluída |
| V3 | `v3` | `palanque_presidencial` | `avaliarCorridas` nas 27 de Governador, no turno da página |

`Etiquetas` ganhou (leitor): `universo(cargo, uf)` (todos os `sqcand` da corrida, do
arquivo nacional), `federacaoDoPartido(sigla)`, `nacional` e `arquivoUf` crus (só a
metodologia usa). `lerHistoricoEtiquetas()` lê o histórico (Blob ou build, maior
versão; o build por `import()` literal, sob demanda).

## 3. Visão por bloco

### 3.1 Varredura (`layoutPorBloco`)

Mesmas cadeiras e pontos de `layoutHemiciclo`; a ordem esquerda → direita é refeita
com θ quantizado a 1e-9 rad e desempate por arco crescente. Motivo: a varredura por
partido decide a coluna central pelo último bit do θ (design 023 § D7) — na Câmara,
arcos 7, 0, 2, 3, 9, 11, 5. Com ela, a marca de 257 deixaria antes e depois
intercalados no raio (7 antes, 5 depois), e nenhum traço honesto os separaria. A
visão por partido NÃO muda (byte a byte).

### 3.2 Marcas (`limiaresDaCasa`, `marcaDoBloco`)

- Limiar do TOTAL: ⌊N/2⌋+1, ⌈3N/5⌉, ⌈2N/3⌉. Nenhum 81/513/41/257 literal.
- Sem empate: `marcaDeLimiar` (média dos θ de k−1 e k).
- Com empate: marca no ângulo da coluna + `raioCorte` = meio entre o último arco de
  antes e o primeiro de depois (garantido contíguo pela varredura; se não for, a marca
  não é desenhada). Senado 41: antes arcos 1 e 3, depois arco 4 (2 + 1). Câmara 257:
  antes 0, 2, 3, 5, depois 7, 9, 11 (4 + 3).
- Desenho: traço radial de `R_ext + r + 1,5` a `+7`, número a `+14`; no empate, um
  traço tangencial de ±1,3 r na coluna. `viewBox` com folga de 24 unidades
  (`Hemiciclo` ganhou `folga`, `defs`, `sobreposicao` e `tracejado` por trecho —
  opcionais; ausentes, a saída é a de antes, travada pelo retrato da Câmara).

### 3.3 Pintura

| Bloco | fill | stroke |
|---|---|---|
| Base do governo Lula | `--text-primary` | `--text-primary` |
| Independentes | `url(#…-hachura)` (tinta 45% sobre papel, 45°) | `--text-primary` |
| Oposição ao governo Lula | `--surface-card` (vazada) | `--text-primary` |
| sem dono | `--surface-sunken` | `--text-secondary`, tracejado |

Sem tom de cinza intermediário por medição (script de 29/09 contra
`app/tokens-party.css`): #2a2f36 → ΔE 11,0 no claro mas 4,5 no escuro (#d3d7dc);
#5b636e → 5,9; #808892 → 6,6 — todos contra os níveis de "Outros". Só a tinta
`--text-primary` passa ΔE ≥ 10 nos dois temas
(`tests/unit/design-system/hemiciclo-bloco-neutro.test.ts`).

**Sem firmeza por cadeira** na visão por bloco: o hemiciclo por partido logo acima
já distingue "até 2031 / apuração concluída / projeção" cadeira a cadeira; aqui o
placar em texto detalha a origem por bloco. Mesmo tratamento da barra das 54.

### 3.4 Texto

`<desc>` com a ordem, as contagens, "reflete a relação com o governo Lula, não
posição ideológica" e os limiares; placar por bloco (com a origem); lista de limiares
com a frase dos DOIS lados ("Base do governo Lula 34 — faltam 7 para 41; Oposição ao
governo Lula 30 — faltam 11 para 41"); nota do empate em texto.

## 4. Listas e filtro (`lib/etiquetas/telas.ts`)

- `exibiveis(r, categorias)`: só categoria com critério e valor classificado com
  rótulo.
- `etiquetasDasCorridas`: por UF, os membros de `comChance` (portão), chips de
  `CATEGORIAS_CHIP` e tokens `categoria:valor` (Senado: + impeachment) em ordem de
  catálogo. Com `chips` e `filtro` desligados, mapa vazio.
- `editorialDaCapa`: `cartao()` (chips + tokens, `/governador` — `data-etq` no
  `<article>`), `chips()` (sem tokens, `/senador` — os tokens vão no `<li>` que
  envolve o `<a>`, para a lista não ficar com `<li>` vazio e o vão da grade), `filtro`,
  `aviso`.
- `etiquetasDaLista`: toda candidatura (páginas de UF, `/candidatos`); `sqcand`
  numérico ou texto.

**Filtro** (`EtiquetaFiltro`, cliente): `data-filtro` no invólucro e, com um
token escolhido, UMA regra num `<style>` filho do próprio invólucro
(`regraDoFiltro`; token validado pela forma do catálogo antes de virar CSS):

```css
main:has([data-filtro="T"]) [data-etq]:not([data-etq~="T"]),
main:has([data-filtro="T"]) [data-regiao]:not(:has([data-etq~="T"])) {display:none}
```

(a segunda linha só com `esconderRegiaoVazia`). *Emenda de 29/09 (auditoria de
a11y/perf, B1)*: até então o CSS module tinha uma regra por token (20, com
`:has()`, 6,9 KB crus) — folha que bloqueia a renderização de toda rota, com o
filtro desligado inclusive. A região viva da contagem, vazia, fica fora da
VISTA e dentro da árvore de acessibilidade (M3).

Contagem: o efeito conta `[data-etq]` da mesma `<main>` com o token; `aria-live`.

**Região**: em `/senador` some a região sem corrida no filtro (`data-regioes`); em
`/governador` fica (o consolidado segue somando todos os estados — ADR-0057 item 5
fala do filtro de status; o de etiqueta segue a mesma leitura).

**Etiqueta no cartão**: `<EtiquetasLinha>` é o último filho do `<span>` do nome — o
CSS da linha (`.c li > span:nth-child(2) > span`) dá a margem de 0,25rem e não é
tocado. `EtiquetaEditorial.module.css` ganhou `text-transform: none` (a linha do
`ResultPanel` é caixa alta) e quebra normal para a frase do impeachment.

**Peso** (`tests/unit/components/etiquetas-peso.test.tsx`): pior caso +4,3 KiB por
cartão (4 × 5 chips + tokens) ⇒ ~116 KiB nos 27 da capa, antes de gzip; hoje ~15 KiB.

## 5. Critério como porta (RF-250)

`CRITERIOS` (catálogo) guarda o texto; `criterioPublicado`/`categoriaExibivel` são o
único ponto de decisão. O átomo `EtiquetaEditorial` devolve nada para categoria sem
critério; `exibiveis`, `opcoesDoFiltro`, as visões e o V3 perguntam o mesmo. Os
números do critério (65/35/30, 03/09/2026) saem das constantes — nunca repetidos.

## 6. Chaves da cópia do build (RF-253)

`EntradaCompilacao.publicar` ← `lerChavesPublicacao(publicar.json)` (movido para
`formato.ts`, reexportado pelo publicador). Fora do `conteudo_sha256`: ligar uma
chave não gera versão nova nem entrada no histórico. Leitor: `publicar` do arquivo
escolhido, qualquer fonte. Publicador: recusa `publicar.json` ≠ cópia do build.
Cenário travado em teste: publica com `v1` ligada (Blob B > build A) → compilação
nova C > B vai no deploy → C vence e `v1` segue ligada. Custo conhecido: desligar às
pressas é publicar com `false`; o build no ar ainda diz `true` até o próximo deploy,
e se o Blob cair nessa janela a visão volta.

## 7. Metodologia (`/sobre-as-etiquetas`)

Estática (ISR 60 s). Lê: nacional + 27 UFs (Blob ou build), histórico, cadastro de
identidade só das UFs/cargos com linha individual (nome de urna), foto do Senado.
Nove seções com `<h2>`; resumo das classificações no ar (`resumoDasClassificacoes`:
categoria × origem e por cargo — tamanho do catálogo, nunca do dado) e o link do
CSV com a lista inteira; na seção do portão, os senadores até 2031 sem
classificação que prendem o V1/V2 ligados (`pendenciasSenado2031`, até 10 por
visão); registro com as 50 mais recentes e link para o arquivo inteiro (Blob
público, ou o repositório). Canal de correção: o repositório público (o mesmo que
`/sobre-o-modelo` já cita). Nenhum link abre aba nova. *Emenda de 29/09
(auditoria de a11y/perf, A3/B6)*: até então a página listava as individuais e os
padrões linha a linha — ~2,5 KB por linha, 2,6 MB com 1.018 linhas.

**Peso das visões (29/09, A2).** V2 e Câmara 2027 usam classes
(`SenadoDe2027Panel.module.css`, `Camara2027Panel.module.css`) em vez de `style`
inline (o Next escreve cada `style` no HTML e de novo no payload RSC); a lista
das 81 do V2 fica num `<details>` recolhido; as fontes saem numeradas uma vez
(`lib/etiquetas/fontes.ts`); o chip (`EtiquetaEditorial`, `EtiquetasLinha`) não
leva `data-etiqueta`/`data-valor`/`data-testid` no build de produção.

## 8. Onde cada coisa entrou nas páginas

| Página | O quê | Onde |
|---|---|---|
| `/senador` | V1, V2 (`SenadoDe2027Panel`), V4 (`RenovacaoPanel`) | depois do `SenadoHemicicloPanel` |
| `/senador` | filtro (`esconderRegiaoVazia`), `data-etq` no `<li>`, chips, aviso | painel "Estado a estado" |
| `/governador` | V3 (`PalanquesMapa` via `palanquesDaCapa`) | depois do "1º ou 2º turno" |
| `/governador` | filtro, chips + `data-etq` no cartão, aviso | logo depois do `<nav>` de status / fim da seção |
| `/deputado-federal` | `Camara2027Panel` | depois do painel da Câmara (plenário por partido) |
| `/uf/[sigla]/governador` · `/senador` | `etiquetas` no `ResultPanel` | chips sob o nome; aviso dentro do painel |
| `/candidatos` | `etiquetas` no `CandidatosGrid` | sob cada cartão; aviso sob a grade |
| `/sobre-o-modelo` | um parágrafo com link | seção 6 (Limitações) |

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Critério ausente deixa V2/V3 e 4 categorias fora da noite | RF-250 é a regra; o dono precisa mandar os critérios antes do deploy de 03/10 |
| Ordem Base → Oposição lida como eixo esquerda–direita | `<desc>`, título "governo Lula", metodologia (ADR-0061, Consequências) |
| HTML de `/governador` com chips no pior caso | teto por cartão em teste; categorias podem ser cortadas nos cartões |
| Blob fora ⇒ build com as chaves do último deploy | documentado (§ 6); o § 7 da constituição é o motivo |
