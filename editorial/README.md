# Etiquetas editoriais — como preencher

Esta pasta guarda as **classificações que nós fazemos** dos candidatos: campo
ideológico, palanque presidencial, relação com o governo Lula, marcação
Centrão, trajetória no cargo e, só para o Senado, posição sobre impeachment de
ministros do STF.

Nada daqui vem do TSE nem do modelo. Por isso cada linha precisa dizer **de
onde tiramos** a informação e **quando**, e só vai ao ar depois que você
marcar como revisada.

---

## Os arquivos

Todos ficam em `editorial/etiquetas/` e podem ser abertos em qualquer
planilha (Google Sheets, Excel, Numbers). Ao salvar, escolha **CSV UTF-8**.

| Arquivo | Quem entra |
|---|---|
| `governador.csv` | candidatos a Governador |
| `senador.csv` | candidatos a Senador |
| `senado-2031.csv` | os 27 senadores que **não** estão em disputa (mandato até 2031) |
| `partidos.csv` | a classificação **padrão** de cada partido e de cada federação |
| `deputados-excecoes.csv` | deputado federal que foge do padrão do partido |
| `publicar.json` | quais visões ficam ligadas no site (ver "Ligar e desligar" abaixo) |

**Não mude a primeira linha** (o cabeçalho) nem a ordem das colunas. Se uma
coluna for renomeada ou trocada de lugar, o sistema recusa o arquivo inteiro.

---

## As colunas, uma por uma

`chave,categoria,valor,turno,fonte_url,fonte_descricao,data,revisado,revisado_em,nota`

| Coluna | O que escrever | Exemplo |
|---|---|---|
| `chave` | **quem** está sendo classificado — ver a tabela logo abaixo | `250002536736` |
| `categoria` | **o quê** — um dos seis nomes da lista "Categorias e valores" | `relacao_governo` |
| `valor` | **a classificação** — um dos valores permitidos daquela categoria | `base_governo` |
| `turno` | só para `palanque_presidencial`: `1` ou `2`. Nas outras, **deixe vazio** | `1` |
| `fonte_url` | o endereço da fonte (começa com `https://`) | `https://…/entrevista` |
| `fonte_descricao` | a fonte em poucas palavras | `Entrevista à Folha, 12/09` |
| `data` | a data **da fonte**, no formato ANO-MÊS-DIA | `2026-09-12` |
| `revisado` | `sim` quando você conferiu; `nao` enquanto for rascunho | `sim` |
| `revisado_em` | a data em que você conferiu (obrigatória com `sim`) | `2026-09-29` |
| `nota` | anotação sua. **Nunca é publicada** — fica só aqui | `confirmar com o diretório estadual` |

### Quem vai na coluna `chave`

| Arquivo | Formato da chave | Onde achar |
|---|---|---|
| `governador.csv`, `senador.csv`, `deputados-excecoes.csv` | o número de candidatura do TSE (11 ou 12 dígitos) | página `/candidatos` do site, ou o cadastro do TSE (`SQ_CANDIDATO`) |
| `senado-2031.csv` | `senado:` + o código do senador no Senado | `editorial/senado/mandato-2031.json` |
| `partidos.csv` | `partido:SIGLA` ou `federacao:SIGLA` | siglas do TSE — ver abaixo |

Siglas de partido de 2026: AGIR, AVANTE, CIDADANIA, DC, DEMOCRATA, MDB,
MISSÃO, MOBILIZA, NOVO, PCB, PCDOB, PCO, PDT, PL, PODE, PP, PRD, PRTB, PSB,
PSD, PSDB, PSOL, PSTU, PT, PV, REDE, REPUBLICANOS, SOLIDARIEDADE, UNIÃO, UP.

Federações: `PT/PC do B/PV`, `PSOL/REDE`, `PSDB/CIDADANIA`, `UNIÃO/PP`,
`PRD/SOLIDARIEDADE`. Escreva exatamente assim, com as barras — por exemplo
`federacao:PT/PC do B/PV`. Acento e maiúscula/minúscula não fazem diferença.

---

## Categorias e valores

Use o **valor da esquerda** na planilha; o texto da direita é o que aparece no
site.

**`campo_ideologico`**
`esquerda` Esquerda · `centro_esquerda` Centro-esquerda · `centro` Centro ·
`centro_direita` Centro-direita · `direita` Direita · `sem_posicao_clara` Sem posição clara

**`palanque_presidencial`** (sempre com `turno` 1 ou 2)
`palanque_lula` Palanque de Lula · `palanque_flavio_bolsonaro` Palanque de Flávio Bolsonaro ·
`palanque_duplo` Palanque duplo · `sem_palanque_declarado` Sem palanque declarado

**`relacao_governo`**
`base_governo` Base do governo · `oposicao` Oposição · `independente` Independente

**`centrao`**
`sim` aparece a etiqueta "Centrão" · `nao` não aparece nada

**`trajetoria_cargo`** (só na linha do candidato — nunca no partido)
`tenta_reeleicao` Tenta a reeleição · `volta_ao_cargo` Volta ao cargo · `estreante` Estreante no cargo

**`impeachment_stf`** (só Senado — candidatos e os 27 até 2031; nunca no partido)
`a_favor` A favor · `contra` Contra · `sem_posicao_publica` Sem posição pública

Não existe valor "a classificar": para deixar alguém sem classificação,
**simplesmente não escreva a linha**.

---

## Quem vale mais quando há mais de uma informação

1. A linha do **próprio candidato** (revisada).
2. A **regra automática** da Câmara ou do Senado — **só depois que você
   aprovar o arquivo dela** (ver "Aprovar um arquivo da regra automática",
   abaixo):
   - *relação com o governo* de quem já tem mandato: pela taxa de votos com o
     governo nas votações disputadas — **65% ou mais** = Base do governo,
     **35% ou menos** = Oposição, entre os dois = Independente. Com **menos de
     30 votos** disputados, vale o partido;
   - *trajetória* de deputados e senadores: de quem está no mandato, já teve
     mandato ou é estreante.
3. O **padrão do partido** (`partido:`).
4. O **padrão da federação** (`federacao:`), quando o partido não tem linha.
5. Sem nada disso, o candidato fica **sem etiqueta** — nada aparece no site.

Uma regra do sistema: se você classificar um partido que faz parte de uma
federação, a federação **também** precisa de linha na mesma categoria (é a
federação que ocupa as cadeiras na Câmara).

---

## Do arquivo ao site

1. **Preencha** a planilha e salve como CSV UTF-8.
2. **Compile**: `pnpm etiquetas:compilar`. O sistema confere cada linha e,
   havendo qualquer erro, **não grava nada** e diz o arquivo e a linha. Nada
   vai ao ar com erro.
3. **Salve a versão** (commit) — só publica o que está salvo.
4. **Publique**: `pnpm etiquetas:publicar` **só confere** — mostra o que
   gravaria e não grava nada. Para publicar de verdade:
   `pnpm etiquetas:publicar --confirmar`. O site mostra a mudança em até 1
   minuto, **sem deploy**. (Até 29/09 era o contrário: o comando sem nada
   publicava. Mudou para que ninguém publique sem querer.)

O histórico de tudo o que mudou (o quê, de → para, fonte e quando) é mantido
automaticamente e é público.

### Ligar e desligar as visões

`editorial/etiquetas/publicar.json` diz quais partes do site mostram
etiqueta. `true` liga, `false` desliga:

| Chave | O quê |
|---|---|
| `chips` | as etiquetas ao lado do nome do candidato |
| `filtro` | o filtro por etiqueta |
| `v1` | Senado 2027 por bloco |
| `v2` | placar do impeachment |
| `v3` | mapa dos palanques |
| `v4` | renovação |
| `camara2027` | Câmara 2027 por bloco |

Mudou o arquivo? **Compile** (`pnpm etiquetas:compilar`), salve a versão e
publique de novo. Compilar é obrigatório: a chave vai para dentro da cópia que
viaja com o deploy, e o publicador **recusa** publicar se o `publicar.json`
estiver diferente dessa cópia. Mesmo ligada, uma visão agregada **só aparece**
quando todos os candidatos com chance naquela corrida estão classificados — e
só em categoria cujo critério já está publicado no site.

✅ **Deploy não apaga visão** (mudou em 29/09). Até então a cópia que vai com o
deploy saía sempre com tudo desligado e, sendo mais nova que a última
publicação, apagava as visões até alguém publicar de novo. Agora ela leva o
MESMO `publicar.json` que você salvou: o que está ligado no arquivo continua
ligado depois do deploy, e também se o Blob sair do ar.

⚠️ Para **desligar às pressas**, publique com a chave em `false` (vale em até 1
minuto). A cópia do deploy que está no ar ainda diz `true` até o próximo deploy:
se o Blob cair justo nessa janela, a visão volta. É o preço de o deploy nunca
apagar nada.

### Voltar atrás

Desfaça a mudança na planilha (ou reverta o commit), compile, salve a versão
e publique. A versão nova é sempre maior, então o site troca em até 1 minuto.

---

## Aprovar um arquivo da regra automática

A regra automática (relação com o governo medida nas votações, e trajetória
no cargo) não sai de uma planilha sua: sai de quatro arquivos de dados em
`editorial/derivados/` — `trajetoria-camara.json`, `alinhamento-camara.json`,
`trajetoria-senado.json` e `alinhamento-senado.json`. Cada um classifica
centenas ou milhares de candidatos de uma vez, então **a revisão é do arquivo
inteiro**, e ele só vale no site depois que você o aprova.

A aprovação fica nas primeiras linhas do arquivo, no bloco `revisao`:

```json
"revisao": { "revisado": "nao", "revisado_em": null, "por": null },
```

Para aprovar, depois de conferir o arquivo (o relatório do
`pnpm etiquetas:compilar` ajuda: diz quantos candidatos cada regra
classificaria), troque para:

```json
"revisao": { "revisado": "sim", "revisado_em": "2026-09-30", "por": "Seu Nome" },
```

- `revisado_em` é a data em que você conferiu, no formato ANO-MÊS-DIA. Não
  pode ser no futuro, nem anterior à data em que o arquivo foi gerado.
- `por` é o seu nome — a revisão é nominal. Ele fica só aqui; não vai ao
  site.
- Depois: **compile**, salve a versão e publique, como qualquer mudança.

Enquanto o arquivo não está aprovado, a regra **não classifica ninguém**: o
compilador avisa "aguardando revisão do dono", a relação com o governo cai no
padrão do partido e a trajetória fica sem etiqueta. No site, a página "Como
classificamos os candidatos" mostra a data da aprovação de cada arquivo.

⚠️ **Refazer o arquivo apaga a aprovação.** Os comandos que geram esses
arquivos (`pnpm trajetoria:exportar`, `pnpm alinhamento:importar`,
`pnpm alinhamento:senado`, `pnpm trajetoria:senado`) sempre gravam
`"revisado": "nao"`. Dado novo precisa de revisão nova.

---

## O que nunca entra aqui

Data de nascimento, CPF, título de eleitor, e-mail, nome civil ou nome social.
A identificação é sempre pelo número de candidatura do TSE ou pelo código do
Senado.
