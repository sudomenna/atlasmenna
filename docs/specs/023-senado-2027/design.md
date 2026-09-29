---
id: 023-senado-2027
type: design
title: Senado de 2027 — Design Técnico
status: ready
---

# Spec 023 — Design técnico

## Arquitetura

Nada muda no produtor (`api/model/`) nem no payload do Edge Config. O hemiciclo de 81 é
**derivação pura na hora de montar a página**, a partir de duas fontes que já existem ou são
estáticas:

```
EdgePayload (cargo 5, Global Config)          editorial/senado/mandato-2031.json
  ├─ por_uf[].top_candidatos[]  (54 vagas)       (27 mandatos, foto datada)
  ├─ por_uf[].pct_apurado       (decidida?)               │
  ├─ composicao_vagas           (conferência)             │ lib/senado/mandato-2031.ts
  └─ fase                       (pré?)                    │ (valida invariantes)
            │                                             │
            └──────────► lib/utils/senado-2027.ts ◄───────┘
                         derivarSenado2027()  — pura, fail-closed
                                   │
                                   ▼
          components/blocks/SenadoHemiciclo.tsx  (Server Component, zero JS)
                                   │ usa
                                   ▼
          components/blocks/Hemiciclo.tsx  ◄── components/blocks/CamaraHemiciclo.tsx (casca)
                                   │ usa
                                   ▼
          lib/utils/hemiciclo.ts  (geometria; arcos por casa)
```

ADR-0001 intacto: nada lê Postgres; a foto é um JSON do repositório, empacotado no build.

## D1 — Geometria: arcos por casa, fixos, nunca derivados de N

`lib/utils/hemiciclo.ts` ganha a opção `arcos` em `layoutHemiciclo(total, { arcos })` e em
`arcosPara(total, arcos)`. Duas constantes nomeiam as casas:

| constante | valor | casa | distribuição |
|---|---|---|---|
| `ARCOS_CAMARA` (= `ARCOS_PADRAO`) | 12 | Câmara, 513 | 27/30/33/35/38/41/44/47/50/53/56/59 |
| `ARCOS_SENADO` | 5 | Senado, 81 | **10/13/16/19/23** |

⚠️ **Correção ao plano.** O plano de 29/09 dizia "10/13/16/19/22" — isso soma **80**. Com os
raios igualmente espaçados de 45 a 100 e o resto por maiores restos (Hare), as cotas são
10,06/13,13/16,20/19,27/22,34; o piso soma 80 e a cadeira de resto vai ao arco de maior fração, o
externo: **10/13/16/19/23**. O raio da bolinha sai do menor dos dois espaçamentos (radial 13,75;
angular 13,66 no arco externo), e os dois quase coincidem — as bolinhas saem redondas, como na
Câmara com 12 arcos.

A filosofia do arquivo não muda — o número de arcos é **constante por casa**, não função de `N`:
derivá-lo de `N` faria o desenho mudar de forma ao cruzar um limiar, e o leitor leria a mudança
de forma como informação. O que muda é que "a casa" passa a ser um argumento. O default continua
12, e o plenário da Câmara sai **byte a byte igual** (D5).

## D2 — A foto dos 27 mandatos

Arquivo `editorial/senado/mandato-2031.json` (pasta `editorial/` nova — a emenda a
`docs/architecture/folder-structure.md` é do `spec-syncer`, na barreira):

```json
{
  "fonte": "Senado Federal — Dados Abertos",
  "fonte_url": "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json",
  "consultado_em": "2026-09-29T04:47:02Z",
  "versao_dataset": "29/09/2026 01:46:55",
  "senadores": [
    {
      "uf": "AC",
      "codigo": "5672",
      "nome_parlamentar": "Alan Rick",
      "partido": "REPUBLICANOS",
      "participacao": "Titular",
      "legislaturas": [57, 58],
      "codigo_mandato": "596"
    },
    {
      "uf": "MA",
      "codigo": "6359",
      "nome_parlamentar": "Lourdinha Pereira",
      "partido": "PSB",
      "participacao": "Suplente em exercício",
      "titular_do_mandato": "Flávio Dino",
      "legislaturas": [57, 58],
      "codigo_mandato": "602"
    }
  ]
}
```

Códigos são **texto** (são identificadores, e o Senado os publica como texto). A foto de 29/09
tem 27 senadores — PL 9, REPUBLICANOS 4, PSD 3, PT 3, PP 3, UNIÃO 2, MDB 1, PSB 1 e **1 sem
partido** (Romário, RJ, desfiliado do PL em 09/09/2026) — e dois suplentes em exercício (MA e PI).
Uma segunda foto, `editorial/senado/mandato-2027.json`, guarda os 54 que ocupam hoje as vagas em
disputa (dois por UF, legislatura final 57), para a visão de renovação (spec 025). Nome civil,
nascimento, contato e bloco **não** entram (lista branca, ADR-0062; constituição § 5).

**`partido` é a sigla na forma do TSE**, a que a paleta conhece — ou exatamente `"S/Partido"`.
Na foto de 29/09 o Senado usa as mesmas siglas do TSE (inclusive "PODE"); se um dia publicar
outra grafia, a invariante reprova e a correspondência entra no **script de foto**, nunca no
carregador: o carregador **recusa**, não conserta (ADR-0062 — invariantes "nunca ajustados em
silêncio").

**Senador sem partido (`"S/Partido"`).** Pela regra do dono — partido ATUAL, literalmente — a
cadeira de quem se desfiliou não é do partido antigo, e também não pode cair calada em "Outros".
Decisão do orquestrador (29/09): o carregador aceita **exatamente** `"S/Partido"` fora da paleta;
a derivação a transforma na linha "Sem partido" (chave `sem-partido`, que nenhuma sigla real
produz), posta **depois** de todos os partidos (não é bancada, não disputa lugar na ordem por
tamanho); o componente a pinta de **cinza cheio** (`--text-secondary`) e a nomeia na legenda e na
lista ("Sem partido 1 — 1 até 2031").

**Carregador `lib/senado/mandato-2031.ts`**:

- `validarFotoSenado(bruto, regra)` — pura. Devolve `{ ok: true, mandato }` ou
  `{ ok: false, erros: string[] }` com **todos** os erros. Invariantes: lista branca de campos
  (raiz e senador); **exatamente `porUf` por UF** nas 27 UFs de `REGIAO_DA_UF`
  (`validarMandato2031`: 1 ⇒ 27; `validarMandato2027`: 2 ⇒ 54); partido da paleta ou
  `"S/Partido"` exato; legislatura final 58 (2031) ou 57 (2027); `codigo_mandato` único;
  `consultado_em` ISO; `fonte_url` https; `participacao ∈ {"Titular", "Suplente em exercício"}`;
  `titular_do_mandato` presente só no suplente.
- `MANDATO_2031` — o resultado da validação do JSON versionado.
- `dataDaFoto` — DD/MM/AAAA em `America/Sao_Paulo`.

🔴 **Recusa em execução, nunca exceção.** Um `throw` no carregamento do módulo derrubaria
`/senador` inteira (constituição § 3 — degradar, não quebrar). A validação em execução devolve o
erro e o hemiciclo simplesmente não aparece (RF-217/D8). A garantia **dura** fica no teste
(`tests/unit/lib/senado-mandato-2031.test.ts`), que reprova o PR se o arquivo versionado violar
qualquer invariante — é lá que um erro de foto é pego, antes de chegar à tela.

**O script `data-pipeline/senado-mandatos-snapshot.ts` (`pnpm senado:snapshot`)** — acionado pelo
dono, nunca pela CI. Um `GET` a `senador/lista/atual.json` (`Accept: application/json`), até 8
tentativas esperando o `retry-after` (mínimo 15 s — a API responde 503 com frequência); seleção
pela segunda legislatura do mandato (58 ⇒ 27; 57 ⇒ 54); as duas validações e os 81 códigos de
mandato distintos conferidos **antes** de gravar, tudo ou nada; gravação temporário + rename; JSON
na forma do `biome format` (senão o hook de pre-commit reprova a foto recém-tirada). `--seco`
valida sem gravar; `--de-arquivo <resposta> --consultado-em <ISO>` refaz a foto de uma resposta
salva — foi assim que a foto versionada foi gerada, e ela confere linha a linha com a extração
independente do spike. Teste de deriva: o recorte versionado da resposta
(`tests/fixtures/senado/lista-atual.recorte.json`, com nome civil e e-mail trocados por
marcadores) produz **byte a byte** os dois arquivos de `editorial/senado/`.

A fixture `tests/fixtures/senado/mandato-2031.fixture.json` é **fictícia** (nomes "Senador(a) de
teste XX", códigos 9xxx) e trava as regras sem depender do conteúdo da foto real, que muda quando
o dono a refaz.

## D3 — Derivação das 54 vagas: a mesma conta do produtor

`lib/utils/senado-2027.ts::derivarSenado2027(payload, mandato)`.

O produtor (`api/model/project.py:6841-6887`) conta, para cada UF de `uf_by_sigla`:
`ordered = sorted(rows, key=pct_projetado, reverse=True)`, `competem = ordered − anuladas da UF`,
`eleitos_da_uf = competem[:vagas]`, e soma `partido_by_cand[candidato_id]` (ou `"—"`) em
`composicao_por_partido`. O agregado sai ordenado em `composicao_vagas.por_partido`
(`api/model/project.py:7286-7312`).

A derivação no cliente reproduz essa conta sobre o que o payload publica:

1. Para cada linha de `por_uf`: `top_candidatos` **na ordem do array** — que é
   `ordered[:TOP_CANDIDATOS_POR_UF]` seguido dos resgatados do RF-190 (invariante 1 de
   `EdgeUfRow.top_candidatos`, `lib/edge-config/types.ts`). **Não reordena por `pct`**: o `pct`
   publicado é arredondado, e reordenar poderia inverter um empate que o produtor desempatou.
2. Filtra `destino === "anulado"` (ADR-0053: anulada não compete; `sub_judice` compete).
3. Toma as `vagas_por_uf` primeiras (2). Partido = `partido ?? "—"` (o mesmo `"—"` do produtor).
4. Estado: `decidida` se `pct_apurado >= 100`, senão `projetada`.

**O campo de "UF 100% apurada" é `EdgeUfRow.pct_apurado`** (0–100, `lib/edge-config/types.ts`,
interface `EdgeUfRow`), gravado por `api/model/project.py:7203` a partir da média do
`pct_apurado` das zonas ponderada pelo eleitorado **total** da UF (`:2880-2904` e `:5199-5210` —
zona ausente conta 0%). O limiar é `>= 100`, estrito: 99,99% é `projetada`. O erro possível é só
o conservador (uma UF já concluída que o ponto flutuante deixou em 99,999… continua com anel), e
nunca o contrário. `chamada`/`bucket` **não** servem: descrevem a margem do 1º sobre o 2º, e no
Senado a vaga é dos dois primeiros (spec 016, RF-104).

**Conferência (fail-closed).** O total por partido derivado é comparado com
`composicao_vagas.por_partido`, partido a partido, pela chave de sigla (sem acento, minúscula, só
`[a-z0-9]`; `"—"` vira a própria chave). Também: `Σ derivadas === composicao_vagas.vagas_projetadas`
e, se `total_cadeiras` vier, `27 + vagas_em_disputa === total_cadeiras`. Qualquer divergência ⇒
`{ ok: false, motivo }`. Motivos: `mandato_invalido`, `sem_composicao`, `divergencia_composicao`,
`total_incoerente`, `vagas_excedentes`.

A conferência não é redundância: ela pega exatamente os casos em que a tela e o texto da barra
contariam histórias diferentes — `top_candidatos` sem `partido` (identidade não resolvida, RF-144)
enquanto o produtor resolveu o partido por outro caminho (`partido_by_cand`), payload anterior à
spec 018, ou uma mudança futura no produtor que ninguém refletiu aqui.

**Vagas em disputa:** `composicao_vagas.vagas_em_disputa`, ou, sem ela (fase pré),
`vagasPorUf(5) × 27` da tabela canônica (`lib/config/cargos.ts`). Nenhum `54` nem `81` literal:
o total é `mandato.senadores.length + vagas_em_disputa`, e é 81 **por construção** porque a foto
tem 27 e a tabela diz 2 × 27.

## D4 — Ordem das cadeiras

Mesma regra da Câmara: **total de cadeiras do partido desc → sigla asc (`pt-BR`)**, pela própria
`ordenarBancada` (`lib/utils/bancada.ts`), que passa a ser genérica sobre
`{ cadeiras, sigla }` — mesmo corpo, mesma regra, nenhum chamador muda. O total do partido é
`continua_2031 + decidida + projetada`.

Dentro da cunha de cada partido: `continua_2031` → `decidida` → `projetada`. A linha "Sem
partido" (D2) vem depois de todos os partidos; as `aguardando` fecham a fila, à direita, como as
`nao_atribuida` da Câmara. A lista textual segue a mesma ordem das cunhas.

A ordem é por **tamanho**, não por posição ideológica, e o `<desc>` diz isso — o hemiciclo por
bloco (V1, spec 025) é outra visão, com outra ordem, registrada no ADR-0061 item 4.

## D5 — `<Hemiciclo>` genérico e `<CamaraHemiciclo>` casca

`components/blocks/Hemiciclo.tsx` é só pintura: recebe o `layout`, os trechos já pintados
(`{ estado, fill, stroke, atributos, inicio, fim }`), título, descrição, ids, legenda (nó React) e
moldura. Agrupa cada trecho contíguo num `<g>` com `fill`/`stroke`/`stroke-width`, e as bolinhas
não repetem cor. Exporta os tokens neutros (`CINZA_ASSENTO`, `CONTORNO_NEUTRO`) e o agrupador
`agruparEmTrechos`.

`<CamaraHemiciclo>` mantém a API, `assentosDaBancada`, os três estados, o texto e a legenda; só a
pintura do SVG vai para `<Hemiciclo>`. **Garantia**: o markup de hoje foi retratado **antes** da
extração (`tests/fixtures/hemiciclo/camara-retrato.json`, gerado sobre `a791e6d`, 10 casos que
cobrem os três estados, singular/plural da legenda, extremo pequeno, `null`, moldura e simulado), e
`tests/unit/components/camara-hemiciclo-retrato.test.tsx` exige igualdade de string.

## D6 — As fases

| fase | o que o hemiciclo mostra | por quê |
|---|---|---|
| **pré** (`fase: "pre_eleicao"`) | 27 `continua_2031` + 54 `aguardando` | Os 27 mandatos são fato, não medição: existem antes da urna abrir. As 54 ficam cinzas sem afirmar nada. O texto evita a lista negra do RF-161 (`projeç`, `apurado`, `boletim`…) — a legenda só nomeia os dois estados presentes. `por_uf` é **ignorado** na fase pré, mesmo preenchido (`payloadPreEleicaoComPercentual`): top-2 de uma projeção zerada é a ordem do desempate. |
| **normal, apurando** | os quatro estados | RF-216/217. |
| **normal, 27 UFs 100%** | 27 `continua_2031` + 54 `decidida` | O Senado de 2027 completo. |
| **sem payload** (`AguardandoSenado`) | **nada** | Esse ramo é "não sabemos" — alcançado também por falha de leitura — e a página promete ali "número nenhum" (spec 019, bloco (A) de `fase-pre-eleicao.test.tsx`). "54 aguardando apuração" durante uma falha de leitura seria afirmar que a apuração não começou. A função pura aceita `payload = null` e devolve 27 + 54 (testado), então incluir o bloco ali é uma linha, se o dono decidir. |

Payload normal **sem** `composicao_vagas` (legado, `model_fallback_tier`) ⇒ `sem_composicao` ⇒
não desenha: não há o que conferir.

## D7 — Marcas de limiar (geometria só)

A visão por bloco (spec 025) vai pôr marcas **fora do arco externo** em 41/49/54 (Senado) e
257/308/342 (Câmara): "k cadeiras antes da marca, na leitura esquerda → direita". Esta spec expõe
e testa a geometria, sem desenhar nada:

- `AssentoGeometria.theta` — o ângulo de cada cadeira (rad; π = esquerda, 0 = direita).
- `HemicicloLayout.centro` e `raios` — para quem desenha converter ângulo em ponto.
- `marcaDeLimiar(layout, k)` — para `1 ≤ k ≤ total − 1`, o ângulo da marca entre a cadeira `k−1` e
  a `k` (média dos dois θ), mais `empate`, `arcosAntes` e `arcosDepois`.
- `pontoNoAngulo(layout, theta, raio)` — o ponto em coordenadas do `viewBox`.

🔴 **O empate entre arcos é o caso da maioria do Senado.** Com 10/13/16/19/23, os arcos de
contagem ímpar (13, 19, 23) têm uma cadeira exatamente no centro (θ = π/2). Na leitura, as 39
primeiras estão à esquerda do centro, e as cadeiras 39, 40 e 41 (índice 0) são a coluna central
dos arcos 1, 3 e 4. **A marca de 41 cai entre a cadeira 40 e a 41 — a mesma coluna.** Nenhuma
linha radial separa as duas; a marca fica no ângulo da coluna, com `empate: true`,
`arcosAntes: [1, 3]` e `arcosDepois: [4]`, e quem desenha decide como mostrar o corte dentro da
coluna.

⚠️ **Achado: o desempate "por arco" da varredura depende do último bit do θ.** O comentário de
`layoutHemiciclo` diz que duas cadeiras no mesmo ângulo desempatam pelo arco interno. Só que
`(π · 6,5) / 13 = 1,5707963267948968` e `(π · 9,5) / 19 = 1,5707963267948966` — em ponto
flutuante, a coluna central do arco de 13 **não** empata com a do arco de 19; ela vem antes por
ser 2 ulp maior. Multiplicação e divisão IEEE-754 são corretamente arredondadas, então a ordem é
determinística entre plataformas (constituição § 6 intacta) — mas é o bit, e não a regra escrita,
que decide. Medido: na coluna central da Câmara (513, sete arcos com cadeira em π/2) a leitura
percorre os arcos **7, 0, 2, 3, 9, 11, 5** — não 0, 2, 3, 5, 7, 9, 11 como o comentário promete.
Mudar a ordenação mudaria o plenário da Câmara (D5 exige byte a byte), então a ordenação
**fica**, e `marcaDeLimiar` trata como empate qualquer par com `|Δθ| < EPS_ANGULO` (1e-9). No
Senado de 81 o bit e a regra concordam (arco 1 antes dos arcos 3 e 4). Os dois fatos estão
travados em `tests/unit/lib/hemiciclo-casas.test.ts`.

**Dado para a spec 025:** a maioria da Câmara (257) **também** cai na coluna central —
`arcosAntes: [7, 0, 2, 3]`, `arcosDepois: [9, 11, 5]`. As marcas 49/54 (Senado) e 308/342
(Câmara) não têm empate.

## D8 — Fail-closed e log

`derivarSenado2027` é pura: devolve o motivo, não loga. `<SenadoHemicicloPanel>` (Server
Component) recebe o motivo, emite **uma** linha
`console.warn("[senado-2027] hemiciclo não desenhado: <motivo> — <detalhe>")` e devolve `null`. O
bloco inteiro (painel incluso) some; a barra das 54 e o resto da página ficam.

## D9 — A barra das 54 na paleta de partido

`app/(sen)/senador/page.tsx`: `color: \`var(--color-cand-${Math.min(i + 1, 11)})\`` →
`color: textForParty(p.partido)`. Quita a dívida do ADR-0024 (cor por sigla, nunca por posição)
e faz o mesmo partido ter a mesma cor na barra e no hemiciclo — a mesma função, a mesma sigla.

## Componentes

| componente | arquivo | novo? |
|---|---|---|
| `Hemiciclo` | `components/blocks/Hemiciclo.tsx` | novo (extraído) |
| `CamaraHemiciclo` | `components/blocks/CamaraHemiciclo.tsx` | casca, mesma saída |
| `SenadoHemiciclo` / `SenadoHemicicloPanel` | `components/blocks/SenadoHemiciclo.tsx` | novo |

O registro em `docs/design-system/components.md` é do `spec-syncer`, na barreira.

## Fluxo na página

`/senador`, ramo com payload: `pre = isPreEleicao(payload)` (já existe) → bloco "As 54 vagas em
disputa" (inalterado, exceto a cor) → **`<SenadoHemicicloPanel payload={payload}
mandato={MANDATO_2031} />`** → "Estado a estado". Na página: três imports (`SenadoHemicicloPanel`,
`MANDATO_2031`, `textForParty`), a linha de JSX e a cor da barra (D9); nada mais muda. O ramo
`AguardandoSenado` não é tocado (D6).

## ADRs aplicáveis

- [ADR-0001](../../architecture/adrs/0001-edge-config-no-read-path.md) — sem Postgres no read path.
- [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md) — cor por sigla.
- [ADR-0043](../../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md) — fase pelo campo `fase`.
- [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — geometria fixa, anel na cadeira não firme; **emendado** pelo ADR-0061.
- [ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — anulada não ocupa vaga.
- [ADR-0061](../../architecture/adrs/0061-hemiciclo-generalizado-arcos-por-casa-e-visao-por-bloco.md) — hemiciclo generalizado: arcos por casa (item 1), componente genérico com a Câmara byte a byte (item 2), `SenadoHemiciclo` e fail-closed (item 3), marcas só na visão por bloco (item 4), barra das 54 em `textForParty` (item 5 — a tensão com a tabela do RNF-035, que reserva `textForParty` ao marcador de identidade, está registrada lá como consequência negativa).
- [ADR-0062](../../architecture/adrs/0062-fontes-parlamentares-foto-do-senado-e-alinhamento-derivado-sem-dado-pessoal.md) — foto do Senado: arquivo estático com data, invariantes por teste, nunca ajustados em silêncio; a tabela de correspondência de sigla Senado → paleta ainda por escrever.

## Riscos técnicos

| risco | mitigação |
|---|---|
| Foto do Senado fica velha (troca de partido, suplente assume) | Data visível; nova foto é um PR com o teste de invariantes. |
| Senador que continua assume outro cargo em 2027 e o suplente é de outro partido | Nota na tela: vale quem ocupa hoje (decisão do dono). |
| Produtor muda a regra das vagas e o cliente não acompanha | Conferência com `composicao_vagas` (D3) — o hemiciclo some em vez de mentir. |
| `top_candidatos` sem `partido` numa UF | Mesma conferência: diverge ⇒ some, com log. |
| Peso do HTML | 81 bolinhas em poucos `<g>`; teto em teste (RF-218 f). |
