---
title: Regulamentação
description: Marco regulatório aplicável — Resolução TSE 23.751/2026 (arts. 264–269) e LGPD
status: stable
source: tse_docs/txt/apresentacao-interessados-2026.txt (fonte primária); ADR-0020
---

# Regulamentação

> **Reescrito em 2026-09-05.** A versão anterior desta página (redigida em 2026-05-17) afirmava que a
> resolução de 2026 estava "a ser publicada", que o TSE abandonaria o leiaute EA20 e que o AtlasMenna
> precisaria de cadastro prévio aprovado. **As três afirmações eram falsas.** A correção e a apuração dos
> fatos estão em [ADR-0020](../architecture/adrs/0020-conformidade-res-23751-2026.md).

## 1. Norma vigente

A norma que rege a divulgação de resultados por terceiros no pleito 2026 é a **Resolução TSE nº 23.751/2026**
("Atos gerais do processo eleitoral para as eleições 2026"). A matéria está no **Título III, Capítulo VI —
"Da Divulgação dos Resultados" — artigos 264 a 269**
(`tse_docs/txt/apresentacao-interessados-2026.txt:22-26`).

| Pleito | Resolução TSE | Aplicabilidade ao AtlasMenna |
|---|---|---|
| Eleição Geral 2022 | Res. 23.673/2021 | Referência histórica. Sem efeito. |
| Eleição Municipal 2024 | Res. 23.736/2024 | **Não rege este pleito.** Não é mais referência de práticas — foi a analogia com esta resolução que produziu as premissas falsas de maio/2026. |
| **Eleição Geral 2026** | **Res. TSE nº 23.751/2026, arts. 264–269** | **Rege o AtlasMenna em produção.** Publicada. |

### Artigos confirmados

Confirmados no material oficial disponível (slide "Divulgação de Resultados — Eleições 2026", julho/2026,
TSE/STI/CSELE/SETOT, audiência técnica). **Não invente artigos além destes** — o material é uma apresentação
oficial, não o texto integral da resolução, e a lista abaixo é exaustiva do que se pôde verificar.

| Artigo | Conteúdo confirmado | Citação |
|---|---|---|
| Arts. 264–269 (Título III, Cap. VI) | Capítulo que regula "Da Divulgação dos Resultados" | `apresentacao-interessados-2026.txt:25-26` |
| Art. 266 | TSE apresenta as definições do modelo de distribuição e os padrões tecnológicos e de segurança até 10/07/2026 | `:27-28` |
| Art. 265 §1º | Divulgação do resultado para Presidente da República liberada a partir das **17h de Brasília**, para todas as UFs e o exterior | `:30-34` |
| Art. 267, caput | Dados disponíveis em centro de dados do TSE até **04/04/2028** (18 meses do 1º turno); distribuição às entidades interessadas por arquivo digital ou programa de computador | `:37-43` |
| Art. 267 §2º | A **infraestrutura de comunicação** com o centro de dados é responsabilidade da entidade interessada | `:46-50` |
| Art. 267 §3º | As entidades **devem buscar os arquivos periodicamente**, à medida que forem atualizados, conforme os padrões da Justiça Eleitoral | `:52-55` |
| Art. 267 §4º | **Veda** promover qualquer alteração de conteúdo dos dados distribuídos pela Justiça Eleitoral | `:57-60` |
| Art. 268 | Veda **majorar o preço** de serviços em razão dos dados fornecidos | `:62-66` |
| Art. 269 | O descumprimento das exigências do capítulo **impede o acesso** da entidade ao centro de dados ou acarreta sua **desconexão** | `:68-71` |

**Não confirmado.** O material disponível não traz nenhum artigo tratando especificamente do tratamento de
votos válidos, anulados e anulados sub judice. A obrigação de decompor `v.vvc = v.vv + v.van + v.vansj` é
requisito de **schema do EA20** (ver [tse-2026-leiautes.md](./tse-2026-leiautes.md) § 2), não de artigo
localizável. Não citar "art. 265 §2º" como base para isso — esse parágrafo não existe na fonte disponível
(o art. 265 tem apenas §1º visível; os §§2º–4º pertencem ao art. 267).

## 2. Não existe cadastro prévio

**O AtlasMenna não precisa se cadastrar, credenciar ou homologar junto ao TSE, porque a Res. 23.751/2026 não
prevê nenhum desses procedimentos.**

O material oficial descreve as entidades que consomem os dados como "entidades interessadas na divulgação dos
resultados" (`apresentacao-interessados-2026.txt:42-43,48-55,104-106`) e enumera suas **obrigações**
(infraestrutura própria, busca periódica dos arquivos, não alteração de conteúdo, não majoração de preço).
Em nenhum ponto há processo de inscrição, aprovação ou homologação prévia. O termo é **descritivo** ("quem se
interessa em divulgar"), não um status administrativo a ser obtido. As strings `cadastr`, `credenci` e `inscri`
têm **zero ocorrências** no material oficial.

Consequências operacionais:

- O `User-Agent` enviado ao CDN do TSE **não pode declarar cadastro** (`lib/tse/client.ts`, constante
  `USER_AGENT`). O valor antigo — `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)` — afirmava um status
  inexistente. O formato correto identifica projeto, URL pública e contato verificável, sem menção a cadastro.
- Não há prazo administrativo a monitorar, nem aprovação a esperar. O risco "Cadastro TSE atrasado" está
  **fechado** ([risks.md](./risks.md)).
- A única via oficial de contato é o canal de suporte: `https://30308800.tse.jus.br`, assunto começando com
  `Resultados - Divulgação` (`apresentacao-interessados-2026.txt:246-247`) — canal de dúvida técnica, não de
  cadastro.

## 3. O leiaute EA20 foi mantido

A doc de maio/2026 afirmava que o TSE abandonaria o EA20 em favor de "um formato JSON novo" a ser definido em
audiência pública de julho. Isso confundiu **mudança de leiaute** com **mudança de formato de serialização**:
o EA20 sempre foi JSON, e segue listado como leiaute vigente no material de julho/2026
(`apresentacao-interessados-2026.txt:108-143`), sem qualquer menção a substituição.

O que de fato mudou foi a **estrutura interna** do EA20 (hierarquia `carg[] → (fed[] | agr[].par[]).cand[]`,
participação em objetos de raiz `s`/`e`/`v`, novo atributo `qe` — quociente eleitoral — e `idg` em todos os
JSON). O diff campo-a-campo contra a implementação está em
[tse-2026-leiautes.md](./tse-2026-leiautes.md) e já foi absorvido no pipeline (commit `c6395a3`).

Não existe plano de refactor "EA20 → JSON" e não há audiência pendente: a audiência técnica **já ocorreu**
(julho/2026) e seu material é a fonte primária citada nesta página.

## 4. Obrigações que recaem sobre o AtlasMenna

| Obrigação | Base | Como o AtlasMenna cumpre |
|---|---|---|
| Estabelecer infraestrutura própria de comunicação com o centro de dados | Art. 267 §2º | Cliente HTTP próprio em `lib/tse/`; nenhuma dependência de intermediário |
| Buscar os arquivos periodicamente, conforme os padrões da Justiça Eleitoral | Art. 267 §3º | Cron de ingestão com cadência e janela configuráveis; nomes de arquivo derivados da padronização documentada |
| **Não alterar o conteúdo dos dados distribuídos** | Art. 267 §4º | `snapshots.payload` guarda o envelope EA20 **cru e inalterado**; projeção é registro derivado, nunca gravado sobre o oficial (constituição §§ 1 e 10) |
| Não majorar preço de serviços em razão dos dados do TSE | Art. 268 | AtlasMenna é público e gratuito; não há serviço precificado |
| Não descumprir as exigências do capítulo, sob pena de bloqueio/desconexão | Art. 269 | Rate limiter, retry honrando `Retry-After` e proibição de sondagem são invariantes de engenharia (§ 5) |
| Rotular a projeção como não oficial | Art. 267 §4º + constituição § 1 | Footer "Não oficial. Fonte: TSE." em toda página, com link para `resultados.tse.jus.br`; tooltips e legendas atribuem fonte (TSE, IBGE) |

## 5. Limites técnicos do CDN do TSE

Literais na fonte primária (`apresentacao-interessados-2026.txt:213-228`, "Regras de consumo dos arquivos"):

- Os arquivos ficam disponíveis pela Internet no **Data Center / CDN**; caminho e nome obedecem a padronização
  detalhada em manuais próprios.
- **Máximo de 100 requisições por IP por segundo** → **bloqueio de 10 minutos, renovado**.
- **Requisição a endereço incorreto (404) também pode gerar bloqueio.** O limiar não é divulgado e não há como
  testá-lo com segurança.
- Os arquivos devem ser atualizados periodicamente.
- **"Não é possível listar os arquivos."** Não existem índices de diretório; a descoberta de *o que mudou*
  depende inteiramente dos arquivos de acompanhamento **EA14** (Brasil) e **EA15** (UF/município).

Invariantes de engenharia que decorrem disso (formalizados em
[ADR-0020](../architecture/adrs/0020-conformidade-res-23751-2026.md)):

1. **Rate limiter de saída obrigatório** (`lib/tse/rate-limiter.ts`), `TSE_MAX_RPS` com default **30** — teto
   de segurança bem abaixo dos 100 req/s documentados, absorvendo margem para relógio impreciso, retries e
   invocações concorrentes do cron.
2. **429/503 retryáveis, honrando `Retry-After`** (`lib/tse/retry.ts`) — um bloqueio de 10 minutos não pode
   derrubar o ciclo em silêncio.
3. **Proibição absoluta de sondar URL adivinhada** contra `resultados.tse.jus.br` ou
   `resultados-sim.tse.jus.br`. Toda URL vem de nome derivado deterministicamente da padronização documentada
   ([tse-2026-leiautes.md](./tse-2026-leiautes.md) § 1) ou de alvo confirmado por EA11/EA14/EA15. Para
   exercitar caminhos de erro, usar o CDN falso local (`scripts/tse-mock-server.ts`, `pnpm tse:mock`).
4. **Envelope Zod em `.passthrough()`, nunca `.strict()`** (`lib/tse/ea20-schema.ts`) — não há freeze de
   leiaute anunciado; o schema valida os campos que o AtlasMenna consome e tolera campos desconhecidos sem
   rejeitar o arquivo inteiro.

**Não confirmado**: se respostas **304 (Not Modified)** contam para o limite de 100 req/s. A fonte primária não
trata de cache condicional. O AtlasMenna trata como se contassem (posição conservadora) — ver risco aberto em
[risks.md](./risks.md).

## 6. Simulados e parâmetros oficiais

O material oficial define o que é um simulado — geração e disponibilização de dados simulados de eleição para
que os interessados coloquem suas soluções à prova, incluindo recebimento e totalização de 100% das seções — e
diz que **"a agenda de testes e demais informações serão divulgadas no site do TSE"**
(`apresentacao-interessados-2026.txt:229-237`). **As datas não constam do material oficial disponível neste
repositório**; as janelas de 15–17/09 e 22–24/09 (9h–12h e 14h–17h BRT) vêm da pesquisa de 2026-09-05 no site
do TSE, registrada em [`../_meta/handoff-2026-09-05.md`](../_meta/handoff-2026-09-05.md).

Confirmado na fonte primária (`:238-244`):

- Os **parâmetros oficiais** ficam disponíveis no site do TSE a partir de **sábado, 03/10/2026**.
- Os **códigos das eleições** vivem no arquivo de configuração de eleições (EA11), em
  `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`.

Protocolo operacional dos simulados: [../testing/tse-simulados.md](../testing/tse-simulados.md).

## 7. LGPD (Lei 13.709/2018)

Tratamento de dados pessoais **não se aplica** — o AtlasMenna não coleta, armazena nem processa PII por design
(constituição § 5). Analytics são agregadas e anonimizadas; cookies são apenas técnicos, sem tracking de
terceiros. Os dados consumidos do TSE são resultados agregados de urna, não dados pessoais de eleitores.

## 8. Quando esta página precisa ser revisada

- O TSE publicar alteração ou errata da Res. 23.751/2026, ou nova resolução para o 2º turno.
- O TSE publicar novo leiaute ou alterar campo de leiaute existente (não há freeze anunciado) — nesse caso,
  atualizar primeiro [tse-2026-leiautes.md](./tse-2026-leiautes.md).
- O TSE divulgar a agenda de simulados, os parâmetros oficiais (03/10) ou os códigos de eleição de 2026 no
  `ele-c.json`.
- Qualquer mudança regulatória dispara revisão imediata da constituição § 1 (constituição, § 1, último item).

## Cross-refs

- Constituição § 1 (conformidade regulatória, versão 1.1): [../constitution.md](../constitution.md#1-conformidade-regulatória-tse)
- ADR-0020 (conformidade sem cadastro prévio): [../architecture/adrs/0020-conformidade-res-23751-2026.md](../architecture/adrs/0020-conformidade-res-23751-2026.md)
- Leiautes TSE 2026 (fonte de verdade técnica): [./tse-2026-leiautes.md](./tse-2026-leiautes.md)
- Riscos abertos e fechados sobre o TSE: [./risks.md](./risks.md)
- Fontes de dados e URLs: [./data-sources.md](./data-sources.md)
- Spec de ingestão (RF-010): [../specs/001-ingestao-tse/](../specs/001-ingestao-tse/)
- Fonte primária: `tse_docs/txt/apresentacao-interessados-2026.txt`
