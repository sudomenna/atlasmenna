"""Do envelope EA20 para o cálculo de cadeiras (spec 017, RF-121 a RF-125.1).

`api/model/cadeiras.py` implementa o algoritmo do ADR-0027 e não sabe nada sobre
o TSE. Este módulo é a ponte: lê um envelope EA20 de cargo proporcional e produz
as `Agremiacao` que aquele algoritmo consome.

## A hierarquia, e por que `fed[]` NÃO é percorrida

A árvore do EA20 (documento oficial,
`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:417-434`) é:

    carg[]  ├── nv  (vagas no cargo)
            ├── qe  (quociente eleitoral — só cargo proporcional)
            ├── fed[]  (n, nm, sg, com, npar[])          ← só COMPOSIÇÃO
            └── agr[]  (Coligação | Federação | Partido isolado)
                 ├── tp ('c' | 'f' | 'i'), vag
                 └── par[] ── cand[]

`fed[]` **não tem `par[]` nem `cand[]`**: é um dicionário que diz quais partidos
compõem cada federação. Todo voto e todo candidato chegam por `agr[]`, e a
federação aparece ali como `agr[].tp == "f"` — que é exatamente a unidade de
agregação que o art. 6º-A da Lei 9.504 manda usar. Percorrer `fed[]` atrás de
candidatos devolveria lista vazia.

⚠️ **2026-09-29 — `agr[].n` NÃO é estável entre UFs.** É o id da inscrição da
agremiação naquela circunscrição. A chave que casa as UFs na bancada nacional
é o número do partido (isolado) ou o `fed[].n` da federação, que o `par[].nfed`
aponta — `chave_agremiacao`.

## Os três números que o TSE publica e que ninguém lia

`carg[].qe`, `carg[].nv` e `agr[].vag` são, respectivamente, o quociente
eleitoral, as vagas da circunscrição e as cadeiras que **o próprio TSE** atribuiu
a cada agremiação. Nenhum tinha consumidor no repositório até 2026-09-11.

Eles valem ouro por dois motivos:

1. **`nv` é a fonte de `lugares_a_preencher`** (RF-124): o número de cadeiras por
   UF sai do dado, nunca de tabela embutida. A Res.-TSE 23.748/2026 art. 7º § 1º
   remete à LC 78/1993 — errar esse denominador corrompe a projeção inteira.
   ⚠️ **2026-09-19**: a frase "a redistribuição pelo Censo 2022 (PLP 177/2023)
   tem desfecho não confirmado" saiu daqui — o PLP foi vetado em julho/2025 e o
   STF manteve as 513. Isto não afrouxa nada nesta alínea: o `nv` **por UF**
   continua vindo do TSE. O que a premissa falsa autorizava, e foi corrigido,
   era derivar o **total nacional** da soma das UFs presentes
   (`deputado_payload.py`).
2. **`qe` e `vag` são um golden AO VIVO.** Depois da totalização final, comparar
   nossa conta com a do TSE responde, com dado real, se o algoritmo do ADR-0027
   está certo — sem depender do dataset histórico de 2022. `conferir_contra_tse`
   faz isso e é o que torna o gate de 19/09 verificável mesmo antes do golden.

Enquanto a apuração é parcial, `vag` reflete o estado parcial e divergir dele é
esperado: a comparação só é conclusiva com `tf == "s"` (totalização final).

⚠️ **2026-09-29 — a conferência passou a ser feita de verdade.** No modo por
zona (o normal desde o ADR-0036), `combinar_entradas` zera `qe`/`vag` — com
razão: o `qe` de um arquivo de zona não é o da UF — e por isso
`conferir_contra_tse` sobre a entrada somada devolvia sempre `[]`, e a tela
afirmava "os nossos números batem com o TSE" sem ter comparado nada.
`conferir_agregado_da_uf` fecha isso: roda o algoritmo sobre os votos do
**próprio arquivo agregado da UF** e compara com o `qe`/`vag` (e, no final, o
conjunto de eleitos) daquele mesmo arquivo — a única comparação em que os dois
lados olham os mesmos votos —, e mede quanto do eleitorado da UF está na soma
das zonas que lemos.

## O destino do voto no proporcional (`cand.dvt`) — ADR-B, 2026-09-29

`cand.vap` é voto **computado**, não voto **válido**: inclui o voto dado a
candidatura anulada ou sub judice. O TSE diz o destino de cada voto em
`cand.dvt` (dicionário, `tse-ea20-arquivo-de-resultado-unificado.txt:798-805`),
e a decisão do dono é **seguir o TSE**, sem rederivar a lei:

  - `"Válido"` (ou `dvt` ausente) → o voto é do candidato, que entra no cálculo;
  - `"Válido (legenda)"` → o voto conta para a LEGENDA do partido (Lei 9.504
    art. 16-A p.ú.; CE art. 175 § 4º), e o candidato não disputa vaga;
  - `"Anulado"` / `"Anulado sub judice"` → fora do QE e do QP.

É diferente do majoritário (ADR-0053, `project.py::_DESTINO_POR_DVT`), onde o
voto anulado só sai da base "em disputa" da tela; aqui ele muda cadeira.
`dvt` ausente (no simulado, só com `and == "n"`) dá resultado **bit-idêntico**
ao anterior a esta regra — ver o ramo `not tem_destino` de
`extrair_entrada_proporcional`; com `dvt`, a legenda é
`_legenda_da_agremiacao`. Nas 27 capturas reais de cargo 6 (RR e AP) e nos
33 envelopes majoritários do simulado, a soma das agremiações fecha com o
`v.vv` do TSE em todos (`test_deputado_defeitos_p1.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from api.model.cadeiras import (
    Agremiacao,
    Candidato,
    ResultadoCadeiras,
    distribuir_cadeiras,
)
from api.model.dado_ts import DgHgInvalido, parse_dg_hg

CARGO_DEPUTADO_FEDERAL = 6

#: Prefixo do `cod` de uma agremiação do tipo `"c"` (coligação) — anomalia de
#: dado em cargo proporcional (ADR-0027, caso de borda 7). Exportado porque o
#: caller precisa detectá-la sem reconstruir a string.
PREFIXO_COLIGACAO = "coligacao:"

#: Prefixo do `cod` de uma FEDERAÇÃO: `fed:<fed[].n>` (2026-09-29, ver
#: `chave_agremiacao`). O prefixo torna a chave disjunta por construção do
#: número de partido isolado — hoje a lei já garante (partido tem 2 dígitos, a
#: federação observada tem 3), mas a garantia não pode depender disso.
PREFIXO_FEDERACAO = "fed:"


# ---------------------------------------------------------------------------
# Leitura de campos — o TSE publica tudo como string, em formato BR
# ---------------------------------------------------------------------------


def _int(raw: Any, default: int = 0) -> int:
    """`"1.234"` → `1234`. Campo ausente ou ilegível vira `default`.

    O separador de milhar do TSE é o ponto; não há decimal nestes campos.
    """
    if raw is None:
        return default
    texto = str(raw).strip().replace(".", "").replace(" ", "")
    if not texto:
        return default
    try:
        return int(texto)
    except ValueError:
        return default


def _nascimento(raw: Any) -> int | None:
    """`"31/12/1970"` → `19701231`, para o desempate do art. 110 (mais idoso).

    Devolve `None` quando ausente ou malformado — `cadeiras.py` trata isso como
    "data desconhecida" e desempata pelo código, de forma declarada.
    """
    if raw is None:
        return None
    partes = str(raw).strip().split("/")
    if len(partes) != 3:
        return None
    dia, mes, ano = partes
    if not (dia.isdigit() and mes.isdigit() and ano.isdigit()):
        return None
    if len(ano) != 4:
        return None
    return int(ano) * 10_000 + int(mes) * 100 + int(dia)


def _cod_candidato(cand: dict[str, Any]) -> int | None:
    """Identificador ÚNICO do candidato: `sqcand`, nunca o número de urna.

    `cand.n` é o número que o eleitor digita — ele se repete entre UFs e entre
    partidos no proporcional. Usá-lo como chave fundiria candidatos distintos.
    `sqcand` é o sequencial único do TSE (`ea20-schema.ts:80`).
    """
    seq = cand.get("sqcand")
    if seq is None:
        return None
    texto = str(seq).strip()
    return int(texto) if texto.isdigit() else None


def _texto(raw: Any) -> str:
    """Campo de texto do EA20, normalizado — nunca `None` para a tela.

    A sigla de partido **inapto** vem com `**` à direita no EA20 (dicionário
    oficial, elemento `par.sg`). O asterisco é um marcador de situação
    cadastral, não parte da sigla: exibi-lo colaria `PP**` no rótulo de uma
    barra. Ele é removido aqui, e a informação de inaptidão não é usada em
    lugar nenhum do produto hoje — se um dia for, tem de ser um campo próprio,
    não um sufixo de string.
    """
    if raw is None:
        return ""
    return str(raw).strip().rstrip("*").strip()


def _componentes(raw: Any) -> tuple[str, ...]:
    """`"PT/PCdoB/PV"` → `("PT", "PCdoB", "PV")` (campo `com` do EA20)."""
    if raw is None:
        return ()
    partes = [_texto(p) for p in str(raw).split("/")]
    return tuple(p for p in partes if p)


def _raiz(payload: Any) -> dict[str, Any] | None:
    """Desembrulha o `abr[0]` que alguns níveis do EA20 usam."""
    if not isinstance(payload, dict):
        return None
    abr = payload.get("abr")
    if isinstance(abr, list) and abr and isinstance(abr[0], dict):
        return abr[0]
    return payload


# ---------------------------------------------------------------------------
# A chave da agremiação — estável no país inteiro (2026-09-29)
# ---------------------------------------------------------------------------


def _numero_texto(raw: Any) -> str:
    """Campo numérico do EA20 como texto (`"13"`), `""` quando ausente."""
    return "" if raw is None else str(raw).strip()


def _unico(valores: Any) -> str | None:
    """O único valor não vazio da sequência; `None` se nenhum ou mais de um.

    Mais de um é dado contraditório (dois números de partido numa agremiação
    isolada, dois `nfed` numa federação). Escolher um seria adivinhar — quem
    chama cai no caminho degradado, que é declarado.
    """
    distintos = {v for v in valores if v}
    return next(iter(distintos)) if len(distintos) == 1 else None


def numero_da_federacao(
    agr: dict[str, Any], federacoes: dict[str, dict[str, Any]]
) -> str | None:
    """`fed[].n` da federação que esta `agr[]` (`tp == "f"`) representa.

    Duas fontes, nesta ordem:

      1. `par[].nfed` — "número da federação da qual o partido faz parte"
         (dicionário, elemento `par`). Todo `par[]` federado o traz; nas 135
         agremiações de federação dos envelopes reais do simulado (cargos 1,
         3, 5 e 6), sempre presente e sempre casando com um `fed[].n`.
      2. `carg[].fed[].npar` — o dicionário de federações lista os números dos
         partidos componentes: a federação cujo `npar` contém um dos `par[].n`
         desta agremiação. Só se exatamente uma casar.

    `None` quando nenhuma resolve sem ambiguidade.
    """
    pars = [p for p in agr.get("par") or [] if isinstance(p, dict)]
    nfed = _unico(_numero_texto(p.get("nfed")) for p in pars)
    if nfed is not None:
        return nfed
    numeros_par = {_numero_texto(p.get("n")) for p in pars} - {""}
    if not numeros_par:
        return None
    casadas = [
        numero
        for numero, fed in federacoes.items()
        if isinstance(fed.get("npar"), list)
        and numeros_par & {_numero_texto(x) for x in fed["npar"]}
    ]
    return casadas[0] if len(casadas) == 1 else None


def chave_agremiacao(
    agr: dict[str, Any], federacoes: dict[str, dict[str, Any]]
) -> str | None:
    """O `cod` da agremiação — a MESMA chave em todas as UFs.

    ## Por que não `agr[].n`

    Até 2026-09-29 o `cod` era `agr[].n`, sob a premissa de que ele seria o
    número do partido ("o PT é 13 em toda UF"). **Não é.** O dicionário diz
    "número da agremiação … conforme inscrição no Sistema de Candidaturas"
    (`tse-ea20-arquivo-de-resultado-unificado.txt:674-676`): é o id da
    INSCRIÇÃO daquela agremiação naquela circunscrição. Nos envelopes reais do
    simulado, RR e AP têm 21 agremiações em comum e **nenhum** `agr[].n` igual
    (o "P 9969" é `60140151` em RR e `60138197` em AP; `par[].n` é `73` nos
    dois), e o cadastro real de 2026 tem o mesmo padrão (o sequencial da
    agremiação, `SQ_COLIGACAO`, do PT é outro em cada uma das cinco UFs
    conferidas). Dentro de uma UF ele é estável, e por
    isso tudo o que é da UF funcionava; a bancada nacional, que casa as UFs por
    `cod`, listava cada partido uma vez por estado, sem somar nada.

    ## A regra

      - `tp == "i"` (partido isolado) → o número do partido, `par[].n` (`"13"`).
        Nacional por lei: é o número que o partido registra no TSE.
      - `tp == "f"` (federação) → `fed:<fed[].n>` (`"fed:101"`), o número da
        própria federação (`numero_da_federacao`). A federação tem abrangência
        nacional (Lei 9.096 art. 11-A) e um número só — `100`–`104` no cadastro
        real de 2026, o mesmo nas UFs conferidas. **Não** a lista dos partidos
        componentes: o `par[]` de um componente sem candidato na UF "pode ser
        suprimido" (dicionário, elemento `par`), e a mesma federação sairia com
        duas chaves — nos envelopes majoritários do simulado, 67 de 67
        federações vêm com componente suprimido.
      - `tp == "c"` (coligação, anomalia no proporcional) → `coligacao:<agr[].n>`,
        como sempre: nunca é somada nem exibida.

    Quando a regra não resolve sem ambiguidade (`par[]` ausente ou
    contraditório, federação sem `nfed` nem `npar` que case), a chave cai em
    `agr[].n` — correta dentro da UF, e a agremiação sai **separada** no
    nacional. Degradação declarada, nunca uma escolha arbitrária entre números.

    `None` sem `agr[].n` (a agremiação é ignorada, como sempre foi).
    """
    numero = _numero_texto(agr.get("n"))
    if not numero:
        return None
    tipo = str(agr.get("tp", "")).strip().lower()
    if tipo == "c":
        return f"{PREFIXO_COLIGACAO}{numero}"
    if tipo == "f":
        federacao = numero_da_federacao(agr, federacoes)
        return f"{PREFIXO_FEDERACAO}{federacao}" if federacao is not None else numero
    pars = [p for p in agr.get("par") or [] if isinstance(p, dict)]
    partido = _unico(_numero_texto(p.get("n")) for p in pars)
    return partido if partido is not None else numero


# ---------------------------------------------------------------------------
# Destino do voto (`cand.dvt`) e situação oficial (`cand.st`) — ADR-B
# ---------------------------------------------------------------------------

#: O voto é do candidato e entra no cálculo (mesmo tratamento de `dvt` ausente).
DESTINO_VALIDO = "valido"
#: O voto vai para a legenda do partido; o candidato não disputa vaga.
DESTINO_VALIDO_LEGENDA = "valido_legenda"
#: Voto anulado — fora de QE e QP.
DESTINO_ANULADO = "anulado"
#: Voto anulado sub judice — fora de QE e QP enquanto o TSE o marcar assim.
DESTINO_SUB_JUDICE = "sub_judice"
#: Valor de `dvt` presente e fora do dicionário. NÃO é "válido": o candidato
#: fica fora do cálculo (ver `destino_proporcional`).
DESTINO_DESCONHECIDO = "desconhecido"

#: `cand[].dvt` do EA20 → destino no cálculo proporcional (ADR-B, 2026-09-29).
#:
#: Os QUATRO valores do dicionário oficial para `cand.dvt`
#: (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:798-805`). O
#: irmão majoritário (`project.py::_DESTINO_POR_DVT`) omite `"Válido
#: (legenda)"` de propósito — lá ele é dado que não se entende; aqui é o caso
#: do art. 16-A p.ú. da Lei 9.504 (voto de candidato com registro negado depois
#: da eleição, que vale para o partido).
#:
#: 🔴 **Sem default.** Valor fora do dicionário não vira "válido": vira
#: `DESTINO_DESCONHECIDO`, o candidato sai do cálculo, e o voto só volta à
#: agremiação se o próprio TSE o tiver contado como válido (`tvtn`/`tvtl`, ver
#: `_legenda_da_agremiacao`). Dar vaga a quem o TSE marcou com um destino que
#: não entendemos é o erro que não se desfaz na tela.
_DESTINO_PROPORCIONAL: dict[str, str] = {
    "válido": DESTINO_VALIDO,
    "válido (legenda)": DESTINO_VALIDO_LEGENDA,
    "anulado": DESTINO_ANULADO,
    "anulado sub judice": DESTINO_SUB_JUDICE,
}

#: Destinos cujo voto nominal vira `Candidato` — `None` é `dvt` ausente, que o
#: TSE só publica "após a primeira totalização parcial" e que por isso é o
#: estado normal do começo da noite (bit-idêntico ao cálculo anterior à regra).
_DESTINOS_DO_CANDIDATO: frozenset[str | None] = frozenset({None, DESTINO_VALIDO})


def destino_proporcional(dvt: Any) -> str | None:
    """`cand[].dvt` → destino do voto no cálculo proporcional.

    `None` quando ausente ou vazio (tratado como válido); `DESTINO_DESCONHECIDO`
    quando presente e fora do dicionário — nunca um default silencioso.
    """
    if dvt is None:
        return None
    texto = str(dvt).strip()
    if not texto:
        return None
    return _DESTINO_PROPORCIONAL.get(texto.casefold(), DESTINO_DESCONHECIDO)


#: Situação oficial do candidato (`cand[].st`) → marca `tse` do payload.
#:
#: Dicionário oficial (`tse-ea20-arquivo-de-resultado-unificado.txt:825-833`):
#: "Eleito", "Eleito por QP", "Eleito por média", "Não eleito", "2º turno",
#: "Suplente". O campo "somente será preenchido quando houver totalização
#: final" — por isso só é lido com `tf == "s"`.
#:
#: | `st` do TSE         | marca           |
#: |---------------------|-----------------|
#: | Eleito por QP       | `eleito_qp`     |
#: | Eleito por média    | `eleito_media`  |
#: | Eleito              | `eleito`        |
#: | Suplente            | `suplente`      |
#: | Não eleito          | `nao_eleito`    |
#: | 2º turno            | — (majoritário; fora do mapa, sem marca)       |
#: | `st` ausente        | `eleito` se `cand.e == "s"`; senão sem marca   |
#:
#: As grafias sem acento entram por tolerância: "media"/"Nao eleito" não mudam
#: o sentido, e errar aqui só apagaria uma marca oficial.
_STATUS_TSE_POR_ST: dict[str, str] = {
    "eleito por qp": "eleito_qp",
    "eleito por média": "eleito_media",
    "eleito por media": "eleito_media",
    "eleito": "eleito",
    "suplente": "suplente",
    "não eleito": "nao_eleito",
    "nao eleito": "nao_eleito",
}


def status_tse_do_candidato(cand: dict[str, Any]) -> tuple[str | None, str | None]:
    """`(marca, st_desconhecido)` de um `cand[]` de arquivo com `tf == "s"`.

    `st` manda. Só com `st` AUSENTE, `cand.e == "s"` ainda diz "eleito" (sem
    a via, QP ou média — o `e` não a tem). `cand.e == "n"` sozinho **não** vira
    marca: não distingue suplente de não eleito, e escolher um seria inventar.

    `st` presente e fora do mapa **não** cai no `e`: o caso real é `"2º
    turno"`, que vem com `e == "s"` (dicionário: "caso o candidato tenha ido
    para o segundo turno, esse campo também será preenchido com s") e viraria
    "eleito". Devolve `(None, st)` para o chamador registrar.
    """
    st_bruto = cand.get("st")
    if st_bruto is not None and str(st_bruto).strip():
        texto = str(st_bruto).strip()
        marca = _STATUS_TSE_POR_ST.get(texto.casefold())
        if marca is not None:
            return marca, None
        return None, texto
    if str(cand.get("e", "")).strip().lower() == "s":
        return "eleito", None
    return None, None


# ---------------------------------------------------------------------------
# Extração
# ---------------------------------------------------------------------------


TipoAgremiacao = Literal["partido", "federacao", "coligacao"]


@dataclass(frozen=True)
class IdentidadeAgremiacao:
    """Quem é a agremiação — nome, sigla, tipo, composição.

    Vive **fora** de `cadeiras.Agremiacao` de propósito (design 017 D4): aquele
    dataclass é o contrato do algoritmo do ADR-0027 e não tem nada a ganhar
    conhecendo nome de partido. A identidade viaja num mapa paralelo chaveado
    pelo mesmo `cod` (`agr[].n`), e o algoritmo continua magro.
    """

    cod: str
    sigla: str
    nome: str
    tipo: TipoAgremiacao
    #: Siglas dos partidos componentes. `()` em partido isolado (RF-122).
    componentes: tuple[str, ...]


@dataclass(frozen=True)
class IdentidadeCandidato:
    """Quem é o candidato. Chaveado por `sqcand`, **nunca** por `cand.n`."""

    sqcand: int
    nome: str
    #: Sigla do partido dentro da agremiação — numa federação, distingue os
    #: componentes (RF-122); num partido isolado, repete a sigla da agremiação.
    partido: str
    #: `cod` da agremiação a que pertence.
    agremiacao: str
    #: `cand.n` — número de urna, só para EXIBIÇÃO (nunca chave: repete entre
    #: partidos e UFs). `None` quando o envelope não o traz.
    numero: str | None = None
    #: Destino do voto (`destino_proporcional(cand.dvt)`): `"valido"`,
    #: `"valido_legenda"`, `"anulado"`, `"sub_judice"`, `"desconhecido"` — ou
    #: `None` quando o TSE ainda não publicou `dvt` (tratado como válido).
    destino: str | None = None


@dataclass(frozen=True)
class EntradaProporcional:
    """Tudo que um envelope EA20 de cargo proporcional oferece ao cálculo."""

    agremiacoes: list[Agremiacao]
    #: `carg[].nv` — vagas da circunscrição. `None` quando o TSE não publicou.
    lugares_a_preencher: int | None
    #: `carg[].qe` — o quociente eleitoral do PRÓPRIO TSE, para conferência.
    quociente_eleitoral_tse: int | None
    #: `agr[].vag` — cadeiras que o TSE atribuiu a cada agremiação.
    vagas_tse: dict[str, int]
    #: `tf == "s"` — só com totalização final a conferência é conclusiva.
    totalizacao_final: bool
    #: `cod` → identidade da agremiação. Paralelo a `agremiacoes` (D4).
    identidade_agremiacoes: dict[str, IdentidadeAgremiacao] = field(default_factory=dict)
    #: `sqcand` → identidade do candidato. Paralelo aos `Candidato` (D4).
    #: Inclui quem ficou FORA do cálculo por destino (ADR-B) — a identidade
    #: existe para a tela, e a tela lista também o candidato anulado.
    identidade_candidatos: dict[int, IdentidadeCandidato] = field(default_factory=dict)
    #: `sqcand` → `cand.vap` de quem NÃO virou `Candidato` por destino
    #: (`valido_legenda`, `anulado`, `sub_judice`, `desconhecido`). Não entra em
    #: nenhuma conta de cadeira; existe para a lista da tela mostrar o voto
    #: computado dessas candidaturas sem reler o envelope.
    votos_fora_do_calculo: dict[int, int] = field(default_factory=dict)
    #: `sqcand` → situação oficial (`status_tse_do_candidato`), SÓ com
    #: `tf == "s"`. Vazio em qualquer outro caso — inclusive na entrada somada
    #: de várias zonas, pela mesma razão de `vagas_tse`.
    status_tse: dict[int, str] = field(default_factory=dict)
    #: `v.vv` do envelope — votos válidos da abrangência segundo o TSE. É o
    #: lado direito da invariante `soma_validos == votos_validos_tse`. `None`
    #: quando o envelope não traz `v.vv`.
    votos_validos_tse: int | None = None
    #: `cod`s de agremiação cuja legenda saiu pelo caminho de recurso (total
    #: válido do partido menos os nominais elegíveis deu NEGATIVO — ver
    #: `_legenda_da_agremiacao`). Vazio no caso normal.
    legendas_recalculadas: tuple[str, ...] = ()
    #: Valores de `dvt`/`st` presentes e fora do dicionário, como
    #: `"dvt=<valor>"`/`"st=<valor>"`. Ordenados e sem repetição.
    valores_desconhecidos: tuple[str, ...] = ()

    @property
    def soma_validos(self) -> int:
        """Σ votos válidos das agremiações (legenda + nominais no cálculo)."""
        return sum(a.votos_totais for a in self.agremiacoes)

    @property
    def diferenca_validos(self) -> int | None:
        """`soma_validos − v.vv`. `0` é a invariante; `None` sem `v.vv`.

        Com `dvt` publicado e `tvtn`/`tvtl` consistentes, a soma das
        agremiações é exatamente o `v.vv` do TSE. Diferença diferente de zero
        diz que algum voto foi contado onde o TSE não conta (ou o contrário).
        """
        if self.votos_validos_tse is None:
            return None
        return self.soma_validos - self.votos_validos_tse

    @property
    def tem_coligacao(self) -> bool:
        """Há agremiação do tipo `"c"` — anomalia em cargo proporcional.

        Coligação proporcional é vedada desde 2020 (CF art. 17 § 1º, EC
        97/2017). O ADR-0027 (caso de borda 7) manda **não processá-la como
        agremiação válida**; quem decide o que fazer com a UF inteira é o
        caller, que é quem sabe alertar.
        """
        return any(a.cod.startswith(PREFIXO_COLIGACAO) for a in self.agremiacoes)


def extrair_entrada_proporcional(
    payload: Any, cargo: int = CARGO_DEPUTADO_FEDERAL
) -> EntradaProporcional:
    """Lê um envelope EA20 e monta a entrada de `distribuir_cadeiras`.

    Cada `agr[]` vira **uma** `Agremiacao` — inclusive a federação, que é
    `tp == "f"` e já traz os partidos componentes em `par[]`. Somar os `par[]`
    aqui é o que a Lei 9.096 art. 11-A e a Lei 9.504 art. 6º-A mandam fazer, e é
    o que evita o erro de tratar uma federação como três partidos (medido em
    `tests/unit/model/test_cadeiras.py`: duas cadeiras de diferença).

    Agremiações do tipo `"c"` (coligação) são **descartadas com sinal**: coligação
    em eleição proporcional é vedada desde 2020 (CF art. 17 § 1º, EC 97/2017), e
    encontrá-la aqui é anomalia de dado, não caso a processar (ADR-0027, caso de
    borda 7). Elas saem em `agremiacoes` com `cod` prefixado por `"coligacao:"`
    para que o caller possa logar — nunca silenciosamente somadas.

    ## Identidade (design 017 D4)

    Nome, sigla, tipo e composição saem em `identidade_agremiacoes`; nome e
    partido de cada candidato, em `identidade_candidatos`. Dois mapas paralelos,
    não campos novos em `Agremiacao`/`Candidato` — o contrato do algoritmo do
    ADR-0027 continua sendo só voto e código.

    **A sigla da agremiação não existe no EA20.** `agr[]` publica `n`, `nm`,
    `tp` e `com`, mas **não** `sg` (dicionário oficial, `carg[].agr[]`). Ela é
    derivada: federação pega a sigla de `carg[].fed[]` com o mesmo número
    (`fed[].sg`); partido isolado pega a do seu único `par[].sg`. É o único
    ponto em que `fed[]` é lida — e mesmo aqui só por identidade: nenhum voto e
    nenhum candidato passam por ela.

    ## Destino do voto (ADR-B, 2026-09-29)

    Só vira `Candidato` quem tem `dvt` `"Válido"` ou ausente. O voto de quem
    tem `"Válido (legenda)"` vai para a legenda do partido; o de quem tem
    `"Anulado"`/`"Anulado sub judice"` sai de QE e QP. Os três ficam em
    `identidade_candidatos` (com `destino`) e em `votos_fora_do_calculo`. A
    legenda com destino publicado é `_legenda_da_agremiacao`.
    """
    raiz = _raiz(payload)
    if raiz is None:
        return EntradaProporcional([], None, None, {}, False)

    cargos = raiz.get("carg")
    if not isinstance(cargos, list):
        return EntradaProporcional([], None, None, {}, False)

    totalizacao_final = str(raiz.get("tf", "")).strip().lower() == "s"
    v_raiz = raiz.get("v") if isinstance(raiz.get("v"), dict) else {}
    votos_validos_tse = _int_ou_none(v_raiz.get("vv"))

    for carg in cargos:
        if not isinstance(carg, dict):
            continue
        if _int(carg.get("cd"), default=-1) != cargo:
            continue

        nv = carg.get("nv")
        qe = carg.get("qe")
        agremiacoes: list[Agremiacao] = []
        vagas_tse: dict[str, int] = {}
        identidade_agr: dict[str, IdentidadeAgremiacao] = {}
        identidade_cand: dict[int, IdentidadeCandidato] = {}
        votos_fora: dict[int, int] = {}
        status_tse: dict[int, str] = {}
        recalculadas: list[str] = []
        desconhecidos: set[str] = set()

        # `fed[]` só para IDENTIDADE (sigla/composição da federação) — nunca
        # para voto ou candidato, que chegam exclusivamente por `agr[]`.
        federacoes: dict[str, dict[str, Any]] = {}
        for fed in carg.get("fed") or []:
            if isinstance(fed, dict):
                numero_fed = str(fed.get("n", "")).strip()
                if numero_fed:
                    federacoes[numero_fed] = fed

        for agr in carg.get("agr") or []:
            if not isinstance(agr, dict):
                continue
            tipo = str(agr.get("tp", "")).strip().lower()
            numero = str(agr.get("n", "")).strip()
            # A chave é NACIONAL (`chave_agremiacao`), não o `agr[].n` — que é
            # o id da inscrição NESTA UF e não casa entre estados.
            cod = chave_agremiacao(agr, federacoes)
            if cod is None:
                continue

            candidatos: list[Candidato] = []
            legenda_dos_partidos = 0
            siglas_par: list[str] = []
            parciais: list[_LegendaDoPartido] = []
            tem_destino = False
            for par in agr.get("par") or []:
                if not isinstance(par, dict):
                    continue
                tvtl_par = _int(par.get("tvtl"))
                legenda_dos_partidos += tvtl_par
                sigla_par = _texto(par.get("sg"))
                if sigla_par:
                    siglas_par.append(sigla_par)
                nominais_no_calculo = 0
                for cand in par.get("cand") or []:
                    if not isinstance(cand, dict):
                        continue
                    destino = destino_proporcional(cand.get("dvt"))
                    if destino is not None:
                        tem_destino = True
                    if destino == DESTINO_DESCONHECIDO:
                        desconhecidos.add(f"dvt={str(cand.get('dvt')).strip()}")
                    votos = _int(cand.get("vap"))
                    # O voto "Válido (legenda)" não é somado aqui: ele chega à
                    # agremiação por `par.tvtl`, onde o TSE o põe (identidade
                    # medida — ver `_legenda_da_agremiacao`).
                    cod_cand = _cod_candidato(cand)
                    if cod_cand is None:
                        continue
                    if destino in _DESTINOS_DO_CANDIDATO:
                        candidatos.append(
                            Candidato(
                                cod=cod_cand,
                                votos_nominais=votos,
                                nascimento=_nascimento(cand.get("dt")),
                            )
                        )
                        nominais_no_calculo += votos
                    else:
                        votos_fora[cod_cand] = votos_fora.get(cod_cand, 0) + votos
                    # `nmu` (nome na urna) antes de `nm` (nome completo): é o
                    # nome pelo qual o eleitor conhece o candidato e o que o
                    # próprio TSE exibe. `nm` fica de reserva.
                    identidade_cand[cod_cand] = IdentidadeCandidato(
                        sqcand=cod_cand,
                        nome=_texto(cand.get("nmu")) or _texto(cand.get("nm")),
                        partido=sigla_par,
                        agremiacao=cod,
                        numero=_texto(cand.get("n")) or None,
                        destino=destino,
                    )
                    if totalizacao_final:
                        marca, st_desconhecido = status_tse_do_candidato(cand)
                        if marca is not None:
                            status_tse[cod_cand] = marca
                        if st_desconhecido is not None:
                            desconhecidos.add(f"st={st_desconhecido}")
                parciais.append(
                    _LegendaDoPartido(
                        tvtl=tvtl_par,
                        tvtn=_int_ou_none(par.get("tvtn")),
                        nominais_no_calculo=nominais_no_calculo,
                    )
                )

            # `fed[]` casa pelo número DA FEDERAÇÃO (`par[].nfed`), não pelo
            # `agr[].n`: no dado real os dois nunca coincidem, e até
            # 2026-09-29 a sigla de `fed[].sg` nunca era encontrada — a
            # federação saía com o `agr[].nm` no lugar da sigla.
            numero_fed = numero_da_federacao(agr, federacoes) if tipo == "f" else None
            identidade_agr[cod] = _identidade_agremiacao(
                cod=cod,
                tipo_bruto=tipo,
                agr=agr,
                siglas_par=siglas_par,
                fed=(
                    federacoes.get(numero_fed)
                    if numero_fed is not None
                    else federacoes.get(numero)
                ),
            )

            if not tem_destino:
                # `dvt` ausente em toda a agremiação — o caminho de ANTES do
                # ADR-B, byte a byte. `agr[].tvtl` é o agregado publicado; a
                # soma dos `par[].tvtl` é o mesmo número por construção.
                # Preferimos o agregado quando existe, e caímos na soma quando
                # o TSE o omite.
                legenda = _int(agr.get("tvtl"), default=legenda_dos_partidos)
                if agr.get("tvtl") is None:
                    legenda = legenda_dos_partidos
            else:
                legenda, recalculou = _legenda_da_agremiacao(parciais)
                if recalculou:
                    recalculadas.append(cod)

            agremiacoes.append(
                Agremiacao(cod=cod, votos_legenda=legenda, candidatos=tuple(candidatos))
            )
            if agr.get("vag") is not None:
                vagas_tse[cod] = _int(agr.get("vag"))

        return EntradaProporcional(
            agremiacoes=agremiacoes,
            lugares_a_preencher=_int(nv, default=0) or None,
            quociente_eleitoral_tse=_int(qe, default=0) or None,
            vagas_tse=vagas_tse,
            totalizacao_final=totalizacao_final,
            identidade_agremiacoes=identidade_agr,
            identidade_candidatos=identidade_cand,
            votos_fora_do_calculo=votos_fora,
            status_tse=status_tse,
            votos_validos_tse=votos_validos_tse,
            legendas_recalculadas=tuple(sorted(recalculadas)),
            valores_desconhecidos=tuple(sorted(desconhecidos)),
        )

    return EntradaProporcional([], None, None, {}, totalizacao_final)


def _int_ou_none(raw: Any) -> int | None:
    """Como `_int`, mas distingue "ausente/ilegível" (`None`) de zero.

    `tvtn` ausente e `tvtn == "0"` são coisas diferentes para a legenda: o
    primeiro não diz nada; o segundo diz que o partido não tem voto nominal
    válido — que é exatamente o caso do partido cujo único candidato foi
    anulado (medido na captura do simulado de 16/09, `par.tvtn = "0"` com
    `tvan = 54.758`).
    """
    if raw is None:
        return None
    texto = str(raw).strip().replace(".", "").replace(" ", "")
    if not texto:
        return None
    try:
        return int(texto)
    except ValueError:
        return None


@dataclass(frozen=True)
class _LegendaDoPartido:
    """O que um `par[]` informa para a legenda da agremiação (ADR-B)."""

    #: `par.tvtl` — votos válidos de legenda do partido.
    tvtl: int
    #: `par.tvtn` — votos válidos nominais do partido. `None` se ausente.
    tvtn: int | None
    #: Σ `vap` dos candidatos do partido que viraram `Candidato`.
    nominais_no_calculo: int


def _legenda_da_agremiacao(parciais: list[_LegendaDoPartido]) -> tuple[int, bool]:
    """Legenda efetiva de uma agremiação com `dvt` publicado → `(votos, recalculou)`.

    Regra do dono (ADR-B), por partido componente:

        legenda = (tvtn + tvtl) − Σ nominais que viraram `Candidato`

    Isto é: o total VÁLIDO que o TSE atribui ao partido, menos o que já está
    nos candidatos do cálculo. O que sobra é, por construção, o voto de
    legenda mais o voto de candidatura `"Válido (legenda)"` — **sem depender**
    de em qual dos dois campos o TSE o pôs. Voto anulado não entra: `tvtn` e
    `tvtl` são "votos VÁLIDOS" por definição do dicionário.

    ## O que o simulado mostrou (417 arquivos de cargo 6 com `and ≠ "n"`, RR e
    AP, capturados em 28/09 — `tests/fixtures/tse/2026-sim/dep/README.md`)

    Identidades exatas em 100% dos arquivos:
    `par.tvtn = Σ vap[dvt=Válido]`; `par.tvtl = par.tval + Σ vap[dvt=Válido
    (legenda)]`; `v.vv = Σ (tvtn + tvtl)`. Ou seja, o TSE põe o voto de
    candidatura "Válido (legenda)" DENTRO de `tvtl`, e a regra acima devolve
    exatamente `tvtl`.

    ## O recurso — `tvtl`, e só ele

    Dois casos não podem usar a subtração:

      - `tvtn` ausente — não há total válido de onde subtrair (nunca visto em
        arquivo real com voto; é envelope podado de teste);
      - a conta dá **negativo** — `tvtn` menor que os nominais que o próprio
        arquivo lista como válidos, dado inconsistente. Registrado em
        `legendas_recalculadas` para o chamador logar.

    Nos dois, a legenda é `tvtl`. ⚠️ A redação original da regra do dono dizia
    `tvtl + Σ vap("Válido (legenda)")`; com a identidade medida acima isso
    contaria esse voto DUAS vezes (ele já está em `tvtl`). Decisão registrada
    no relatório da frente P1 de 29/09 para o ADR-B.

    `par.dvt` (destino do voto de LEGENDA do partido) não é lido: `tvtl` já é
    "válidos de legenda", então partido com legenda anulada chega com `tvtl`
    sem esses votos — e, se não chegar, a invariante contra `v.vv` acusa.
    """
    total = 0
    recalculou = False
    for p in parciais:
        if p.tvtn is None:
            total += p.tvtl
            continue
        efetiva = p.tvtn + p.tvtl - p.nominais_no_calculo
        if efetiva < 0:
            recalculou = True
            efetiva = p.tvtl
        total += efetiva
    return total, recalculou


def _identidade_agremiacao(
    *,
    cod: str,
    tipo_bruto: str,
    agr: dict[str, Any],
    siglas_par: list[str],
    fed: dict[str, Any] | None,
) -> IdentidadeAgremiacao:
    """Nome, sigla, tipo e composição de uma `agr[]` (D4).

    `tp` do EA20 → tipo do payload: `"i"` → `"partido"`, `"f"` → `"federacao"`,
    `"c"` → `"coligacao"` (anomalia — nunca exibida, sempre logada).

    A sigla vem, nesta ordem: `fed[].sg` (só federação), a sigla do único
    `par[]` (partido isolado), o nome da agremiação, e por fim o próprio número.
    Nunca fica vazia: uma barra sem rótulo é pior que uma barra com o número.
    """
    tipo: TipoAgremiacao = (
        "federacao" if tipo_bruto == "f" else "coligacao" if tipo_bruto == "c" else "partido"
    )
    nome = _texto(agr.get("nm"))

    if tipo == "federacao":
        sigla = _texto((fed or {}).get("sg")) or nome or cod
        # `com` sai da própria agremiação quando publicado; `fed[].com` é o
        # mesmo dado no dicionário de federações. A lista de `par[].sg` é o
        # último recurso — ela é a composição de fato, só não vem ordenada
        # pelo TSE, por isso não é a primeira escolha.
        componentes = (
            _componentes(agr.get("com"))
            or _componentes((fed or {}).get("com"))
            or tuple(siglas_par)
        )
    elif tipo == "partido":
        sigla = (siglas_par[0] if siglas_par else "") or nome or cod
        # RF-122 / D5: partido isolado sai com `componentes` vazio — repetir a
        # própria sigla ali faria a tela desenhar "PT (PT)".
        componentes = ()
    else:
        sigla = nome or cod
        componentes = _componentes(agr.get("com")) or tuple(siglas_par)

    return IdentidadeAgremiacao(
        cod=cod,
        sigla=sigla,
        nome=nome or sigla,
        tipo=tipo,
        componentes=componentes,
    )


# ---------------------------------------------------------------------------
# Combinação de envelopes — a defesa contra o `Map.set` sobre linhas de par
# ---------------------------------------------------------------------------


def combinar_entradas(entradas: list[EntradaProporcional]) -> EntradaProporcional:
    """Soma N envelopes da MESMA UF em uma entrada só.

    O cargo 6 passou de granularidade UF para ZONA em 2026-09-13 (emenda ao
    ADR-0026 item 1 — mesmo diagnóstico de bootstrap que moveu o Senador em
    11/09: um único arquivo por UF só dá ao estimador uma unidade de
    reamostragem, e o IC95 degenera). Desde então o caso NORMAL é **várias**
    linhas de `(município, zona)` por UF — uma por par publicado pelo TSE —
    e esta função soma todas. O caso de **uma** única linha (devolvida sem
    cópia, abaixo, sem custo) volta a ser normal apenas quando o interruptor
    de emergência `TSE_DEPUTADO_GRANULARIDADE=uf`
    (`lib/tse/targets.ts::getGranularidade`) reverte o cargo à ingestão por
    UF — nesse modo o envelope único é o esperado, não uma escotilha de
    diagnóstico.

    De qualquer forma, a única coisa certa a fazer com os votos de várias
    linhas é **somar**: escolher uma e descartar as outras é o modo de falha
    que esta base já pagou caro desde a migration 0006 (ADR-0035) — o número
    sai plausível, menor, e sem erro nenhum.

    O que **não** é somado, porque somar seria inventar:

      - `quociente_eleitoral_tse` e `vagas_tse` viram `None`/`{}`. São grandezas
        da circunscrição inteira; a versão publicada num arquivo de zona não
        é conferível contra a nossa conta da UF, e `conferir_contra_tse`
        acusaria divergência que não existe.
      - `lugares_a_preencher` é o **máximo** dos publicados — a circunscrição é
        a mesma para todas as linhas, e vaga não encolhe.
      - `totalizacao_final` só é verdadeira se **todas** as linhas o disserem.
      - `status_tse` (situação oficial por candidato) vira `{}` pela mesma
        razão do `qe`: a marca oficial vem do agregado da UF
        (`conferir_agregado_da_uf`), não de uma soma de zonas.

    O que é somado além do voto do cálculo: `votos_fora_do_calculo` (por
    `sqcand`) e `votos_validos_tse` (`v.vv` — só quando TODAS as linhas o
    trazem; uma linha sem ele faria a soma parecer um `v.vv` que não é).
    """
    if not entradas:
        return EntradaProporcional([], None, None, {}, False)
    if len(entradas) == 1:
        return entradas[0]

    legenda_por_cod: dict[str, int] = {}
    votos_por_cand: dict[str, dict[int, int]] = {}
    nascimento_por_cand: dict[int, int | None] = {}
    ordem_cods: list[str] = []
    ordem_cands: dict[str, list[int]] = {}
    identidade_agr: dict[str, IdentidadeAgremiacao] = {}
    identidade_cand: dict[int, IdentidadeCandidato] = {}
    votos_fora: dict[int, int] = {}
    recalculadas: set[str] = set()
    desconhecidos: set[str] = set()

    for entrada in entradas:
        for sq, votos in entrada.votos_fora_do_calculo.items():
            votos_fora[sq] = votos_fora.get(sq, 0) + votos
        recalculadas.update(entrada.legendas_recalculadas)
        desconhecidos.update(entrada.valores_desconhecidos)
        for agremiacao in entrada.agremiacoes:
            cod = agremiacao.cod
            if cod not in legenda_por_cod:
                legenda_por_cod[cod] = 0
                votos_por_cand[cod] = {}
                ordem_cands[cod] = []
                ordem_cods.append(cod)
            legenda_por_cod[cod] += agremiacao.votos_legenda
            for cand in agremiacao.candidatos:
                if cand.cod not in votos_por_cand[cod]:
                    votos_por_cand[cod][cand.cod] = 0
                    ordem_cands[cod].append(cand.cod)
                votos_por_cand[cod][cand.cod] += cand.votos_nominais
                if nascimento_por_cand.get(cand.cod) is None:
                    nascimento_por_cand[cand.cod] = cand.nascimento
        for cod, ident in entrada.identidade_agremiacoes.items():
            identidade_agr.setdefault(cod, ident)
        for sq, ident_c in entrada.identidade_candidatos.items():
            atual = identidade_cand.get(sq)
            # A primeira leitura vence, com UMA exceção: uma linha que ainda
            # não tinha `dvt` (destino `None`) cede para a que já tem. Sem
            # isso, a ordem das zonas decidiria se a tela sabe que a
            # candidatura foi anulada.
            if atual is None or (atual.destino is None and ident_c.destino is not None):
                identidade_cand[sq] = ident_c

    agremiacoes = [
        Agremiacao(
            cod=cod,
            votos_legenda=legenda_por_cod[cod],
            candidatos=tuple(
                Candidato(
                    cod=sq,
                    votos_nominais=votos_por_cand[cod][sq],
                    nascimento=nascimento_por_cand.get(sq),
                )
                for sq in ordem_cands[cod]
            ),
        )
        for cod in ordem_cods
    ]

    lugares = [e.lugares_a_preencher for e in entradas if e.lugares_a_preencher is not None]
    validos_tse = [e.votos_validos_tse for e in entradas]

    return EntradaProporcional(
        agremiacoes=agremiacoes,
        lugares_a_preencher=max(lugares) if lugares else None,
        quociente_eleitoral_tse=None,
        vagas_tse={},
        totalizacao_final=all(e.totalizacao_final for e in entradas),
        identidade_agremiacoes=identidade_agr,
        identidade_candidatos=identidade_cand,
        votos_fora_do_calculo=votos_fora,
        status_tse={},
        votos_validos_tse=(
            sum(v for v in validos_tse if v is not None)
            if all(v is not None for v in validos_tse)
            else None
        ),
        legendas_recalculadas=tuple(sorted(recalculadas)),
        valores_desconhecidos=tuple(sorted(desconhecidos)),
    )


# ---------------------------------------------------------------------------
# Conferência contra o próprio TSE — o golden ao vivo
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Divergencia:
    """Uma discordância entre a nossa conta e a do TSE."""

    o_que: str
    nosso: int
    tse: int
    detalhe: str = ""


def conferir_contra_tse(
    resultado: ResultadoCadeiras, entrada: EntradaProporcional
) -> list[Divergencia]:
    """Compara nossa distribuição com os números que o TSE publica.

    É o golden que não depende de dataset histórico: o EA20 traz o quociente
    eleitoral (`carg[].qe`) e as cadeiras por agremiação (`agr[].vag`) calculados
    pelo próprio TSE. Se o ADR-0027 estiver implementado certo, os dois batem.

    **Só é conclusivo com totalização final** (`tf == "s"`). Durante a apuração
    parcial o TSE recalcula a cada boletim e divergir dele é esperado — por isso
    o caller deve tratar divergência parcial como observação, e divergência com
    `totalizacao_final=True` como **erro** que bloqueia a exibição de cadeiras.

    Devolve lista vazia quando bate, ou quando o TSE não publicou os campos.
    """
    divergencias: list[Divergencia] = []

    if entrada.quociente_eleitoral_tse is not None:
        if resultado.quociente_eleitoral != entrada.quociente_eleitoral_tse:
            divergencias.append(
                Divergencia(
                    o_que="quociente_eleitoral",
                    nosso=resultado.quociente_eleitoral,
                    tse=entrada.quociente_eleitoral_tse,
                    detalhe=(
                        "arredondamento do art. 106 (0,5 exato desce) ou definição "
                        "de votos válidos (brancos/nulos fora)"
                    ),
                )
            )

    for cod, vag_tse in sorted(entrada.vagas_tse.items()):
        nosso = resultado.cadeiras.get(cod, 0)
        if nosso != vag_tse:
            divergencias.append(
                Divergencia(
                    o_que=f"cadeiras[{cod}]",
                    nosso=nosso,
                    tse=vag_tse,
                    detalhe="distribuição de sobras ou cláusula dos 10%/20%",
                )
            )

    return divergencias


EstadoConferencia = Literal["confere", "diverge", "sem_dado_tse"]

#: O que a conferência pode ter comparado num ciclo (design 026 § 2.8) —
#: conjunto FECHADO, na ordem em que as comparações são feitas. A frase da
#: tela sai de `ConferenciaTse.comparou`: "batem com o TSE" só existe com
#: `"algoritmo"` ali dentro.
COMPARACOES = ("eleitorado", "algoritmo", "eleitos", "votos_validos")

#: Por que uma comparação NÃO foi feita (spec 027 design § 3.2) — conjunto
#: FECHADO, contrato com a tela. `"granularidade_uf"`: a parcial da UF saiu do
#: próprio agregado (Fase 1 dos cargos 7/8), e comparar "a soma das zonas" com
#: o agregado seria comparar o arquivo consigo mesmo.
MOTIVO_NAO_COMPAROU_GRANULARIDADE_UF = "granularidade_uf"


@dataclass(frozen=True)
class ConferenciaTse:
    """Resultado da conferência contra o agregado da UF (RF-269, 2026-09-29).

    `estado`:
      - `"confere"` — o TSE publicou `qe` e/ou `vag` e a nossa conta sobre os
        votos DAQUELE arquivo dá os mesmos números;
      - `"diverge"` — publicou, e ao menos um número difere
        (`divergencias` não vazio);
      - `"sem_dado_tse"` — não há o que comparar (`motivo` diz por quê). É o
        estado que substitui a afirmação falsa "batem" quando nada foi
        comparado.
    """

    estado: EstadoConferencia
    #: Hora de geração (`dg`/`hg`) do arquivo agregado conferido, ISO UTC.
    #: `None` sem arquivo ou com `dg`/`hg` ilegível.
    boletim_dado_ts: str | None
    #: `tf == "s"` NO AGREGADO — só aí divergir é erro (e alarme).
    totalizacao_final: bool
    divergencias: tuple[Divergencia, ...] = ()
    #: Por que a conta não pôde ser conferida (para o log; não vai ao
    #: payload): `sem_agregado`, `sem_cargo`, `apuracao_nao_iniciada`,
    #: `tse_nao_publicou`, `coligacao`, `sem_nv`, `sem_voto_valido`. `None`
    #: quando a conta foi conferida.
    motivo: str | None = None
    #: A leitura do agregado — de onde sai `status_tse` (marca oficial por
    #: candidato). `None` quando não houve arquivo.
    entrada: EntradaProporcional | None = None
    #: O que foi DE FATO comparado neste ciclo, subconjunto ordenado de
    #: `COMPARACOES` (spec 026 design § 2.8). Toda divergência pertence a uma
    #: comparação daqui; `confere` exige `"algoritmo"`.
    comparou: tuple[str, ...] = ()
    #: Spec 027 design § 3.2 — `(comparação, motivo)` do que seria comparado
    #: numa UF lida por zona e aqui NÃO foi, na ordem de `COMPARACOES`. Só em
    #: resumo (`parcial_do_agregado`): `eleitorado` sempre que há agregado;
    #: `votos_validos` só com `tf = "s"` (é quando a comparação seria feita).
    #: Vazio ⇒ o campo sai ausente do payload.
    nao_comparou: tuple[tuple[str, str], ...] = ()


def _boletim_dado_ts(payload: Any) -> str | None:
    """`dg`/`hg` do topo do agregado → ISO UTC, ou `None` (ausente/ilegível)."""
    raiz = _raiz(payload)
    if raiz is None:
        return None
    try:
        return parse_dg_hg(raiz.get("dg"), raiz.get("hg")).isoformat()
    except DgHgInvalido:
        return None


#: Marcas oficiais que contam como "eleito" na comparação do CONJUNTO de
#: eleitos. A via (QP × média) fica de fora de propósito: o rótulo do TSE não
#: coincide com a divisão `floor(votos/QE)` (RR final do simulado: a divisão dá
#: 6 por QP, o TSE rotula 3), então comparar a via acusaria divergência que não
#: é de cadeira. A marca `tse` do payload guarda o rótulo do TSE como veio.
_MARCAS_ELEITO = frozenset({"eleito", "eleito_qp", "eleito_media"})


def _divergencia_de_eleitos(
    resultado: ResultadoCadeiras, entrada: EntradaProporcional
) -> Divergencia | None:
    """O conjunto de eleitos, por PESSOA, contra o do TSE (só com `tf == "s"`).

    Uma divergência só, com as duas contagens (spec 026 design § 2.8):
    `nosso` = quantos a nossa conta elegeu e o TSE não; `tse` = o inverso;
    `detalhe` lista os `sqcand` dos dois lados. Até 2026-09-29 (P1) saía uma
    linha `eleito[<sqcand>]` por candidatura — a tela recebia N linhas para uma
    só pergunta ("quem só um dos lados elegeu?"), e o contrato v2 fechou na
    forma agregada. `None` quando os conjuntos coincidem.
    """
    oficiais = {sq for sq, marca in entrada.status_tse.items() if marca in _MARCAS_ELEITO}
    nossos = {c.cod for eleitos in resultado.eleitos.values() for c in eleitos}
    so_nossos = sorted(nossos - oficiais)
    so_tse = sorted(oficiais - nossos)
    if not so_nossos and not so_tse:
        return None

    def _lista(sqs: list[int]) -> str:
        return ", ".join(str(sq) for sq in sqs) if sqs else "nenhum"

    return Divergencia(
        o_que="eleitos",
        nosso=len(so_nossos),
        tse=len(so_tse),
        detalhe=(
            f"eleitos só no nosso cálculo: {_lista(so_nossos)}; "
            f"só no do TSE: {_lista(so_tse)}"
        ),
    )


def conferir_agregado_da_uf(
    payload: Any,
    cargo: int = CARGO_DEPUTADO_FEDERAL,
    *,
    eleitorado_lido: int | None = None,
    validos_lidos: int | None = None,
    resultado_parcial: ResultadoCadeiras | None = None,
    parcial_do_agregado: bool = False,
) -> ConferenciaTse:
    """A conferência de verdade contra o arquivo agregado da UF (RF-269).

    Duas perguntas, as duas respondidas com o agregado da UF (`nivel = "uf"`,
    já ingerido desde a spec 021):

    **1. A nossa CONTA é a do TSE?** Roda `distribuir_cadeiras` sobre os votos
    do **próprio** agregado e compara com o `qe`, o `vag` e — com
    totalização final — o conjunto de eleitos (`cand.st`) que o **mesmo**
    arquivo publica. As duas contas olham o mesmo boletim; divergir diz que a
    aritmética do ADR-0027 (ou a regra de destino do ADR-B) não é a do TSE.
    Nas capturas reais do simulado (RR e AP, 28/09) ela confere em todos os
    momentos — inclusive no empate de RR a 20% (P 9979 × P 9980, 21.262 votos
    cada), em que o desempate reproduz o do TSE.

    **2. Os nossos VOTOS cobrem a UF?** `eleitorado_lido` é Σ `e.te` das
    linhas de zona que somamos (quem chama mede); comparado com o `e.te` do
    agregado, diz que parte do estado não está na nossa soma — o caso real do
    AP, cuja zona 0014 de Macapá faltava na lista de zonas lidas (−19,5% do
    eleitorado). É estrutural (o `e.te` de uma zona não muda durante a noite),
    então não acusa atraso de boletim — só zona que não lemos.

    `and == "n"` (apuração não iniciada) não confere a conta: o `vag` desse
    arquivo é da rodada ANTERIOR (medido no simulado) e o `qe` é `"0"`.

    **Com totalização final** (`tf == "s"` no agregado), duas comparações a
    mais (spec 026 design § 2.8):

      - `eleitos` — o conjunto de eleitos, por pessoa (`cand.st`/`cand.e`),
        contra o `resultado_parcial`: as cadeiras que PUBLICAMOS (a soma das
        zonas), que é o que a marca "eleito na parcial" da tela diz. Sem
        `resultado_parcial` (chamador antigo), compara com a nossa conta
        sobre o próprio agregado — o comportamento de P1.
      - `votos_validos` — `validos_lidos` (Σ `v.vv` das zonas que somamos,
        medido por quem chama) contra o `v.vv` do agregado.

    **`parcial_do_agregado=True`** (spec 027 RF-285 — Fase 1 dos cargos 7/8,
    em que a ingestão grava só o resumo de cada casa): a parcial publicada saiu
    DESTE MESMO arquivo, não de uma soma de zonas. As duas comparações que
    medem "a nossa soma × o agregado" — `eleitorado` e `votos_validos` —
    comparariam o arquivo com ele mesmo e dariam "bate" por construção; ficam
    FORA de `comparou` (não comparadas), sejam quais forem `eleitorado_lido` e
    `validos_lidos`. `algoritmo` e `eleitos` seguem: comparam a NOSSA
    aritmética com a do TSE, e isso continua sendo informação.

    `comparou` diz quais comparações foram feitas, na ordem de `COMPARACOES`.
    `estado`: `diverge` se qualquer uma acusar; `confere` se a conta
    (`"algoritmo"`) foi conferida e nada acusou; `sem_dado_tse` se não houve
    conta a conferir (`motivo`). Parcial também é conferível — o TSE
    recalcula `qe`/`vag` a cada totalização —, mas só com `tf == "s"` divergir
    é erro. Quem decide alarmar é o chamador (este módulo não loga nem alerta).
    """
    if payload is None:
        return ConferenciaTse("sem_dado_tse", None, False, motivo="sem_agregado")

    raiz = _raiz(payload) or {}
    boletim = _boletim_dado_ts(payload)
    entrada = extrair_entrada_proporcional(payload, cargo=cargo)
    tf = entrada.totalizacao_final

    divergencias: list[Divergencia] = []
    comparou: list[str] = []

    # Spec 027 RF-285 — sem soma de zonas, não há o que comparar com o
    # agregado: o "lido" SERIA o agregado (ver o docstring). O que deixou de
    # ser comparado é DECLARADO (`nao_comparou`, design 027 § 3.2): a tela diz
    # "não comparado nesta fase", nunca cala nem afirma "confere".
    nao_comparou: list[tuple[str, str]] = []
    if parcial_do_agregado:
        eleitorado_lido = None
        validos_lidos = None
        nao_comparou.append(("eleitorado", MOTIVO_NAO_COMPAROU_GRANULARIDADE_UF))
        if tf:
            nao_comparou.append(("votos_validos", MOTIVO_NAO_COMPAROU_GRANULARIDADE_UF))

    e_raiz = raiz.get("e") if isinstance(raiz.get("e"), dict) else {}
    eleitorado_tse = _int_ou_none(e_raiz.get("te"))
    if eleitorado_lido is not None and eleitorado_tse:
        comparou.append("eleitorado")
        if eleitorado_lido != eleitorado_tse:
            cobertura = 100.0 * eleitorado_lido / eleitorado_tse
            divergencias.append(
                Divergencia(
                    o_que="eleitorado",
                    nosso=eleitorado_lido,
                    tse=eleitorado_tse,
                    detalhe=(
                        f"as zonas lidas somam {cobertura:.1f}% do eleitorado da UF "
                        "publicado pelo TSE — as cadeiras que publicamos não contam "
                        "os votos da parte que falta"
                    ),
                )
            )

    motivo = _motivo_sem_conferencia(raiz, entrada)
    resultado_agregado: ResultadoCadeiras | None = None
    # `lugares_a_preencher` não é `None` aqui (é um dos motivos); repetido
    # só para o verificador de tipos.
    if motivo is None and entrada.lugares_a_preencher is not None:
        resultado = distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher)
        if resultado.quociente_eleitoral < 1:
            motivo = "sem_voto_valido"
        else:
            resultado_agregado = resultado
            comparou.append("algoritmo")
            divergencias.extend(conferir_contra_tse(resultado, entrada))

    if tf and entrada.status_tse:
        base = resultado_parcial if resultado_parcial is not None else resultado_agregado
        if base is not None:
            comparou.append("eleitos")
            eleitos = _divergencia_de_eleitos(base, entrada)
            if eleitos is not None:
                divergencias.append(eleitos)

    if tf and validos_lidos is not None and entrada.votos_validos_tse is not None:
        comparou.append("votos_validos")
        if validos_lidos != entrada.votos_validos_tse:
            divergencias.append(
                Divergencia(
                    o_que="votos_validos",
                    nosso=validos_lidos,
                    tse=entrada.votos_validos_tse,
                    detalhe=(
                        "votos válidos somados das zonas que lemos × votos válidos "
                        "do boletim final do TSE"
                    ),
                )
            )

    if divergencias:
        estado: EstadoConferencia = "diverge"
    elif "algoritmo" in comparou:
        estado = "confere"
    else:
        estado = "sem_dado_tse"
    return ConferenciaTse(
        estado,
        boletim,
        tf,
        divergencias=tuple(divergencias),
        motivo=motivo,
        entrada=entrada,
        comparou=tuple(comparou),
        nao_comparou=tuple(nao_comparou),
    )


def _motivo_sem_conferencia(raiz: dict[str, Any], entrada: EntradaProporcional) -> str | None:
    """Por que a CONTA do agregado não é conferível — `None` se é."""
    if not entrada.agremiacoes and entrada.lugares_a_preencher is None:
        return "sem_cargo"
    if str(raiz.get("and", "")).strip().lower() == "n":
        return "apuracao_nao_iniciada"
    if entrada.quociente_eleitoral_tse is None and not entrada.vagas_tse:
        return "tse_nao_publicou"
    if entrada.tem_coligacao:
        return "coligacao"
    if entrada.lugares_a_preencher is None:
        return "sem_nv"
    return None


def anomalias_de_leitura(entradas: list[EntradaProporcional]) -> dict[str, Any] | None:
    """Resumo, para UM aviso por UF, das anomalias das leituras individuais.

    Cada arquivo é conferido sozinho — a invariante `Σ válidos das
    agremiações == v.vv` é **por arquivo** (ADR-B) —, mas o aviso é por UF:
    ~6.110 pares por ciclo com um `warn` cada inundariam o log justamente
    quando algo sistemático estivesse errado.

    `None` quando não há nada a dizer.
    """
    divergentes = [
        e.diferenca_validos
        for e in entradas
        if e.diferenca_validos is not None and e.diferenca_validos != 0
    ]
    recalculadas = sorted({c for e in entradas for c in e.legendas_recalculadas})
    desconhecidos = sorted({v for e in entradas for v in e.valores_desconhecidos})
    if not divergentes and not recalculadas and not desconhecidos:
        return None
    return {
        "n_leituras": len(entradas),
        "n_validos_divergentes": len(divergentes),
        "maior_diferenca_validos": max(divergentes, key=abs) if divergentes else 0,
        "legendas_recalculadas": recalculadas,
        "valores_desconhecidos": desconhecidos,
    }
