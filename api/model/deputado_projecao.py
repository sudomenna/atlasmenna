"""Projeção de Deputado Federal — votos, cadeiras e eleitos (spec 026, ADR-0063).

Até 2026-09-29 o cargo 6 só tinha a **parcial**: a aritmética do ADR-0027 sobre
o voto já apurado ("como ficaria a bancada se a contagem parasse agora", design
017 D9). O ADR-0063 superou o D9 e mandou construir a projeção: o voto de cada
candidatura e de cada legenda projetado para o total da UF, **zona a zona**, e
a mesma `distribuir_cadeiras` aplicada a ele.

Este módulo é **puro**: sem I/O, sem log, sem relógio. Quem lê o banco, loga a
linha `dep_projecao` e decide publicar é `project.py::_do_project_proporcional`.
O contrato do que sai daqui para o payload está no design da spec 026 (§ 2.7 e
§ 5); o payload propriamente é `deputado_payload.py`.

## A unidade: o par município×zona

A unidade de ingestão desde o ADR-0036 é o par (município, zona) — cada par tem
o seu próprio EA20, com `e.te` (eleitorado) e `e.esi` (eleitorado das seções já
totalizadas). O design 026 (§ 2.7, vocabulário da spec) conta `zonas_apuradas`
e `zonas_total` em pares, e é em pares que a regra de três é aplicada: o fator
`k = te/esi` é o do arquivo que o TSE publicou. O **estrato** de um par é o da
zona real a que ele pertence (tercis de eleitorado por `cod_zona`, a mesma
função do majoritário, `project.py::_compute_estratos_por_uf`) — o que mantém o
limiar do ADR-0023 ("≥ 12 zonas") com o sentido de lá: RR (8 zonas), AC, AP e
ZT ficam num estrato só, como o ADR-0063 registra.

## O método (ADR-0063, decisão 2; design 026 § 5)

Para cada chave — `(cod, sqcand)` de candidatura válida e `(cod, 0)` da legenda
da agremiação (já com os votos `Válido (legenda)`, ADR-0064) —:

1. **Zona apurada** ⇔ `e.esi > 0 ∧ v.vv > 0`.
2. **Escala**: o voto observado da zona apurada é multiplicado por
   `k = te/esi` (regra de três do ADR-0021).
3. **Razão das somas por estrato**: intensidade = Σ voto escalado ÷ Σ `te`
   das zonas apuradas do estrato. Nunca média de percentuais.
4. **Imputação do estado inteiro**: cada zona sem boletim recebe `te` × a
   intensidade do seu estrato; estrato sem nenhuma zona apurada cai para a
   intensidade da UF inteira (a hierarquia de fallback do ADR-0023).
5. **Arredondamento inteiro** por maiores restos, desempate pela ordem fixa das
   chaves (constituição § 6).
6. **Distribuição**: `cadeiras.distribuir_cadeiras`, intocada.

Algebricamente o voto projetado de uma chave é
`Σ_estrato W_s · X_s / T_s`, com `W_s` = eleitorado total do estrato, `X_s` =
voto escalado das zonas apuradas do estrato e `T_s` = eleitorado delas — o
estimador pós-estratificado do ADR-0023, em contagem absoluta.

## "Aritmética exata" sem `Fraction` por zona

`Fraction` por zona e por chave é exato e inviável: a soma de mil frações com
denominadores distintos carrega um denominador de milhares de dígitos, e SP tem
~1.000 pares × ~1.100 chaves. A conta aqui é **inteira, em ponto fixo**: cada
termo `voto · te / esi` é guardado em micro-votos (`ESCALA = 10**6`), truncado
para baixo, e tudo o que vem depois é soma e divisão inteira. É exato no sentido
que a constituição § 6 exige — inteiro, independente de plataforma, sem `float`
decidindo nada — com um erro declarado menor que um milionésimo de voto por
termo. Na identidade que importa (G1: zona 100% apurada, `esi == te`) o termo é
`voto · 10**6` sem resto, e a projeção reproduz a parcial bit a bit.

⚠️ O limite do `int64`: `voto · te` ≤ ~10¹² (uma candidatura não tem mais voto
numa zona do que eleitores nela) e o termo em micro-votos ≤ `te · 10**6` ≤
~10¹² — muito abaixo de 2⁶³ ≈ 9,2·10¹⁸. A multiplicação por `ESCALA` é feita
DEPOIS da divisão inteira (identidade `⌊a·S/b⌋ = ⌊a/b⌋·S + ⌊(a mod b)·S/b⌋`),
então nenhum intermediário passa de ~10¹⁸. A imputação, que multiplica
eleitorado de estrato (até ~10⁷) por voto em micro-votos (até ~10¹⁵), é feita
em `int` do Python, que não transborda.

## A trava (design 026 § 2.7)

`avaliar_trava` aplica as seis condições na ORDEM FIXA do design; o primeiro
motivo que falha é o publicado (a sétima, `erro`, é de quem chama: o cálculo
lançou ou não fechou). Nenhuma condição olha para `s.psa` — o `% apurado` é o da
spec 026 RF-275 (`project.py::pct_apurado_uf_proporcional`).

## O interruptor chega no corpo do POST

O ciclo TS (`lib/tse/ingest-handler.ts`) lê a chave `interruptor-projecao-dep`
do Global Config e manda o estado em `ProjectRequest.projecao_dep` (design 026
§ 2.11). Python **não** lê o Edge Config — recebe, normaliza aqui
(`interruptor_do_corpo`, falha fechada) e registra no log do ciclo, que é o que
torna a projeção reproduzível: snapshots + código + o estado do interruptor
naquele ciclo.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from fractions import Fraction
from typing import Any, Literal

import numpy as np

from api.model.cadeiras import Agremiacao, Candidato, ResultadoCadeiras, distribuir_cadeiras
from api.model.cadeiras_bootstrap import _montar_matriz
from api.model.deputado import EntradaProporcional

# ---------------------------------------------------------------------------
# Constantes do contrato
# ---------------------------------------------------------------------------

#: Piso da trava, em % apurado da UF (ADR-0063 decisão 3; decisão do dono).
#: O interruptor pode SUBIR este número (`pct_minimo`), nunca baixá-lo.
PCT_MINIMO_PADRAO = 25

#: Teto do `pct_minimo` do interruptor. Acima disso a projeção nunca abriria —
#: é valor inválido, não trava "muito alta", e é IGNORADO (vale o piso), como
#: todo `pct_minimo` inválido (ADR-0063 D4; `interruptor_do_corpo`).
PCT_MINIMO_TETO = 100

#: Mínimo de zonas apuradas (ADR-0063: o mesmo mínimo com que o bootstrap do
#: RF-127 omite o intervalo, `cadeiras_bootstrap.MIN_ZONAS_PARA_INTERVALO`).
ZONAS_MINIMAS = 2

#: Casas decimais do `% apurado` publicado. A trava compara o número já
#: arredondado a estas casas — o que a tela mostra —, para que "25,00000%
#: apurado" e "aguarda 25%" nunca apareçam juntos.
CASAS_PCT = 5

#: Ponto fixo da conta (micro-votos). Ver o docstring do módulo.
ESCALA = 10**6

EstadoTrava = Literal["liberada", "aguardando", "indisponivel"]

#: Motivos, conjunto FECHADO por estado (design 026 § 2.7). Acrescentar um é
#: mudança de contrato com a tela.
MOTIVOS_AGUARDANDO = ("pct_minimo", "zonas_minimas", "sem_vagas")
MOTIVOS_INDISPONIVEL = ("interruptor", "coligacao", "cobertura", "erro")


# ---------------------------------------------------------------------------
# Interruptor — `ProjectRequest.projecao_dep`, falha fechada
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Interruptor:
    """O interruptor como o ciclo o entende, já normalizado.

    `ligada` só é `True` quando o corpo trouxe `{"ligada": true, ...}` válido.
    `origem` é para o log (`dep_projecao`): `"corpo"` (lido), `"ausente"`
    (campo não veio — ingestão antiga ou chave ausente no Global Config) ou
    `"invalido"` (veio, mas não é o que o contrato diz).
    """

    ligada: bool
    pct_minimo: int
    origem: Literal["corpo", "ausente", "invalido"]
    #: Por que o `pct_minimo` pedido não foi usado como veio — `None` se foi.
    aviso: str | None = None


DESLIGADO = Interruptor(ligada=False, pct_minimo=PCT_MINIMO_PADRAO, origem="ausente")


def interruptor_do_corpo(bruto: Any) -> Interruptor:
    """`ProjectRequest.projecao_dep` → `Interruptor`. Nunca lança.

    Falha fechada (ADR-0063 decisão 4; RF-265): ausente, não-objeto e
    `ligada` que não é exatamente `true` desligam. `pct_minimo` — a MESMA
    regra do leitor TS (`lib/edge-config/reader.ts::interpretarInterruptor`)
    e do design 026 § 2.10, alinhados em 29/09:

      - ausente → 25;
      - número finito entre 25 e 100 → ele, arredondado para CIMA se vier
        decimal (o TS já manda `ceil`; `ceil` erra para o lado de travar mais,
        nunca menos);
      - menor que 25, maior que 100, não numérico, booleano, `null`, NaN ou
        infinito → **ignorado**: vale 25, com `aviso` para o log, e `ligada`
        fica como veio. ADR-0063 D4: "valor menor que 25 ou inválido é
        ignorado, com log". Até 29/09 os inválidos desligavam o interruptor
        INTEIRO aqui, enquanto o TS só ignorava o `pct_minimo` — a tela e o
        modelo discordavam sobre a mesma chave.

    Por que não validar isso no Pydantic (`Field(ge=25, le=100)`, como o
    rascunho do design § 2.11): um valor fora da faixa derrubaria o corpo
    INTEIRO com 400, e o ciclo deixaria de publicar até a parcial — uma chave
    de projeção malformada apagaria a Câmara da tela. Aqui ela no máximo
    deixa a trava no piso (constituição § 7).
    """
    if bruto is None:
        return DESLIGADO
    if not isinstance(bruto, Mapping):
        return Interruptor(False, PCT_MINIMO_PADRAO, "invalido", aviso="nao_e_objeto")

    pct = PCT_MINIMO_PADRAO
    aviso: str | None = None
    if "pct_minimo" in bruto:
        pct_bruto = bruto["pct_minimo"]
        # `bool` é subclasse de `int` em Python — `True` não é 1% aqui.
        if (
            isinstance(pct_bruto, bool)
            or not isinstance(pct_bruto, (int, float))
            or not math.isfinite(pct_bruto)
        ):
            aviso = "pct_minimo_invalido_ignorado"
        elif pct_bruto < PCT_MINIMO_PADRAO:
            aviso = "pct_minimo_abaixo_de_25_ignorado"
        elif pct_bruto > PCT_MINIMO_TETO:
            aviso = "pct_minimo_acima_de_100_ignorado"
        else:
            pct = math.ceil(pct_bruto)

    ligada = bruto.get("ligada") is True
    return Interruptor(ligada=ligada, pct_minimo=pct, origem="corpo", aviso=aviso)


# ---------------------------------------------------------------------------
# Entrada — um par município×zona
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ZonaProjecao:
    """Um par (município, zona) como a projeção o lê.

    `entrada` é a MESMA leitura de envelope de que a soma da UF (a parcial)
    saiu — nunca uma releitura. `te`/`esi`/`vv` vêm dos objetos de raiz `e`/`v`
    do mesmo envelope (`project.py::_extract_zone_participacao`); `te = 0`
    quando o envelope não traz `e` legível (o par existe, mas não sabemos o
    tamanho dele: não é apurado nem imputável).
    """

    cod_zona: int
    te: int
    esi: int
    vv: int
    entrada: EntradaProporcional

    @property
    def apurada(self) -> bool:
        """Design 026 § 5.1: `e.esi > 0 ∧ v.vv > 0` (e `te` conhecido)."""
        return self.esi > 0 and self.vv > 0 and self.te > 0


def contar_zonas(zonas: Sequence[ZonaProjecao]) -> tuple[int, int]:
    """`(zonas_apuradas, zonas_total)` do objeto `projecao` (design 026 § 2.7)."""
    return sum(1 for z in zonas if z.apurada), len(zonas)


# ---------------------------------------------------------------------------
# Trava
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EstadoProjecao:
    """`DeputadoProjecaoUf` (design 026 § 2.7) — o que a UF publica sempre."""

    estado: EstadoTrava
    motivo: str | None
    pct_minimo: int
    zonas_apuradas: int
    zonas_total: int

    def payload(self) -> dict[str, Any]:
        """O objeto do contrato. `motivo` ausente ⇔ `liberada`."""
        saida: dict[str, Any] = {"estado": self.estado}
        if self.motivo is not None:
            saida["motivo"] = self.motivo
        saida["pct_minimo"] = self.pct_minimo
        saida["zonas_apuradas"] = self.zonas_apuradas
        saida["zonas_total"] = self.zonas_total
        return saida

    @property
    def liberada(self) -> bool:
        return self.estado == "liberada"


def avaliar_trava(
    *,
    interruptor: Interruptor,
    tem_coligacao: bool,
    lugares_a_preencher: int | None,
    pct_apurado: float,
    zonas_apuradas: int,
    zonas_total: int,
    te_zonas: int | None,
    te_agregado: int | None,
) -> EstadoProjecao:
    """Trava da projeção de uma UF — as condições na ordem FIXA do design § 2.7.

    | # | Condição                                      | Falha ⇒                     |
    |---|-----------------------------------------------|-----------------------------|
    | 1 | interruptor ligado e válido                   | `indisponivel`/`interruptor`|
    | 2 | nenhuma agremiação coligação (`tp = "c"`)     | `indisponivel`/`coligacao`  |
    | 3 | `carg.nv` publicado                           | `aguardando`/`sem_vagas`    |
    | 4 | `% apurado` ≥ `pct_minimo`                    | `aguardando`/`pct_minimo`   |
    | 5 | zonas apuradas ≥ 2                            | `aguardando`/`zonas_minimas`|
    | 6 | Σ `e.te` das zonas == `e.te` do agregado      | `indisponivel`/`cobertura`  |

    A 7ª (`erro`) é de quem calcula. A ordem é a do contrato: com duas
    condições falhando, o motivo publicado é sempre o mesmo (§ 6).

    `pct_apurado` é comparado **arredondado a 5 casas** — o número que a tela
    mostra. Sem isso, 24,999996% seria publicado como "25,00000% apurado" ao
    lado de "projeção a partir de 25%".

    `te_agregado is None` (sem agregado da UF no ciclo): a condição 6 não é
    avaliável e passa — a Conferência diz `sem_dado_tse` (design § 2.7).
    `te_zonas is None` (nenhum par com `e` legível) com agregado presente
    falha a 6: não sabemos quanto do estado a soma cobre.
    """

    def _saida(estado: EstadoTrava, motivo: str | None) -> EstadoProjecao:
        return EstadoProjecao(
            estado=estado,
            motivo=motivo,
            pct_minimo=interruptor.pct_minimo,
            zonas_apuradas=zonas_apuradas,
            zonas_total=zonas_total,
        )

    if not interruptor.ligada:
        return _saida("indisponivel", "interruptor")
    if tem_coligacao:
        return _saida("indisponivel", "coligacao")
    if lugares_a_preencher is None or lugares_a_preencher < 1:
        return _saida("aguardando", "sem_vagas")
    if round(float(pct_apurado), CASAS_PCT) < interruptor.pct_minimo:
        return _saida("aguardando", "pct_minimo")
    if zonas_apuradas < ZONAS_MINIMAS:
        return _saida("aguardando", "zonas_minimas")
    if te_agregado is not None and te_zonas != te_agregado:
        return _saida("indisponivel", "cobertura")
    return _saida("liberada", None)


def com_erro(estado: EstadoProjecao) -> EstadoProjecao:
    """A 7ª condição do design § 2.7: o cálculo lançou ou não fechou."""
    return replace(estado, estado="indisponivel", motivo="erro")


# ---------------------------------------------------------------------------
# Projeção
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProjecaoUf:
    """Resultado da projeção de uma UF liberada.

    `entrada` é a `EntradaProporcional` da UF com os votos PROJETADOS (inteiros),
    as MESMAS agremiações e candidaturas na MESMA ordem da parcial — é o que
    `deputado_payload._marcar_indefinidas` e `_cadeiras_de_fase_1` precisam
    para a marca "apertada" e a via QP/sobra da projeção.
    """

    entrada: EntradaProporcional
    resultado: ResultadoCadeiras
    #: Fração do eleitorado da UF (Σ `te` das zonas conhecidas) que foi
    #: IMPUTADA — o "o que está movendo" da tela (RF-266) diz esse número.
    fracao_imputada: Fraction
    #: Quantos estratos a UF usou (1 = sem pós-estratificação).
    n_estratos: int
    #: `True` quando algum estrato sem zona apurada caiu para a intensidade
    #: da UF inteira (fallback do ADR-0023).
    fallback_uf: bool


@dataclass(frozen=True)
class _Plano:
    """A matriz voto × zona e o que é preciso para remontar as agremiações."""

    #: `(linhas, zonas)` int64 — voto observado de cada chave em cada par.
    votos: np.ndarray
    #: `(cod, linha da legenda, ((sqcand, linha, nascimento), ...))`, na ordem
    #: de `entrada_uf` (`cadeiras_bootstrap._PlanoAgremiacao`).
    plano: list[tuple[str, int, tuple[tuple[int, int, int | None], ...]]]


def _plano(zonas: Sequence[ZonaProjecao], entrada_uf: EntradaProporcional) -> _Plano | None:
    """A matriz de `cadeiras_bootstrap._montar_matriz`, em inteiros.

    Reusa o construtor do intervalo da parcial — que confere, linha a linha,
    que a soma das zonas É o voto da UF já publicado — em vez de montar uma
    segunda matriz com uma segunda chance de errar. `None` quando a
    decomposição não fecha: a projeção descreveria outra corrida.
    """
    montado = _montar_matriz([z.entrada for z in zonas], entrada_uf)
    if montado is None:
        return None
    matriz, plano = montado
    # float64 de votos inteiros é exato (≤ 2^53); a volta a int é sem perda.
    return _Plano(votos=np.rint(matriz).astype(np.int64), plano=plano)


def _escalados(votos: np.ndarray, te: np.ndarray, esi: np.ndarray) -> np.ndarray:
    """`⌊voto · te · ESCALA / esi⌋` por célula, em int64, sem transbordar.

    `⌊a·S/b⌋ = ⌊a/b⌋·S + ⌊(a mod b)·S/b⌋` — a multiplicação por `ESCALA` vem
    depois da divisão, e nenhum intermediário passa de ~10¹⁸.
    """
    a = votos * te[None, :]
    q, r = np.divmod(a, esi[None, :])
    return q * ESCALA + (r * ESCALA) // esi[None, :]


def _maiores_restos(exatos_micro: list[int]) -> list[int]:
    """Micro-votos → votos inteiros, com o total preservado (maiores restos).

    O total inteiro é o total exato arredondado para o mais próximo (0,5 sobe
    — só acontece com restos que somam exatamente meio voto). Cada chave leva
    o piso, e as unidades que faltam vão para os maiores restos; empate de
    resto, para a chave que vem primeiro na ordem fixa (a de `entrada_uf`).
    Determinístico e inteiro do começo ao fim.
    """
    pisos = [v // ESCALA for v in exatos_micro]
    restos = [v - p * ESCALA for v, p in zip(exatos_micro, pisos, strict=True)]
    total_micro = sum(exatos_micro)
    total = (total_micro + ESCALA // 2) // ESCALA
    faltam = total - sum(pisos)
    if faltam > 0:
        ordem = sorted(range(len(restos)), key=lambda i: (-restos[i], i))
        for i in ordem[:faltam]:
            pisos[i] += 1
    return pisos


def _estratos_das_zonas(
    zonas: Sequence[ZonaProjecao], estrato_por_zona: Mapping[int, int] | None
) -> list[int | None]:
    """O estrato de cada par (o da sua zona real), ou `None` sem estratificação."""
    if not estrato_por_zona:
        return [None] * len(zonas)
    return [estrato_por_zona.get(z.cod_zona) for z in zonas]


def _projetar_micro(
    escalados: np.ndarray,
    te: np.ndarray,
    apurada: np.ndarray,
    estratos: list[int | None],
) -> tuple[list[int], bool, int]:
    """Voto projetado de cada linha, em micro-votos (int do Python).

    `escalados` só tem sentido nas colunas apuradas. Devolve também se algum
    estrato caiu para a intensidade da UF e quantos estratos a UF usou.
    """
    n_linhas = escalados.shape[0]
    idx_ap = np.flatnonzero(apurada)
    # Soma inteira do voto escalado das zonas apuradas: X da UF inteira.
    x_uf = [int(v) for v in escalados[:, idx_ap].sum(axis=1)] if idx_ap.size else [0] * n_linhas
    t_uf = int(te[idx_ap].sum()) if idx_ap.size else 0

    # Grupos: estrato conhecido, e `None` para par sem estrato (sem
    # estratificação na UF, ou zona fora do mapa de estratos).
    grupos: dict[int | None, list[int]] = {}
    for j, s in enumerate(estratos):
        grupos.setdefault(s, []).append(j)

    projetado = list(x_uf)
    fallback = False
    for s, colunas in sorted(grupos.items(), key=lambda kv: (kv[0] is None, kv[0] or 0)):
        cols = np.array(colunas, dtype=np.int64)
        ap = cols[apurada[cols]]
        nao_ap = cols[~apurada[cols]]
        u = int(te[nao_ap].sum()) if nao_ap.size else 0
        if u == 0:
            continue
        t_s = int(te[ap].sum()) if (s is not None and ap.size) else 0
        if s is not None and t_s > 0:
            x_s = [int(v) for v in escalados[:, ap].sum(axis=1)]
            den = t_s
        else:
            # Estrato sem nenhuma zona apurada — ou par sem estrato: a
            # intensidade da UF inteira (ADR-0023, mesmo fallback).
            if s is not None:
                fallback = True
            x_s = x_uf
            den = t_uf
        if den <= 0:
            continue
        for i in range(n_linhas):
            # `u · x / den`, inteiro, truncado: micro-votos imputados.
            projetado[i] += (u * x_s[i]) // den
    n_estratos = len([s for s in grupos if s is not None]) or 1
    return projetado, fallback, n_estratos


def projetar_votos(
    votos: np.ndarray,
    te: np.ndarray,
    esi: np.ndarray,
    apurada: np.ndarray,
    estratos: list[int | None],
) -> tuple[list[int], bool, int]:
    """O miolo da projeção sobre a matriz voto × zona → votos inteiros por linha.

    `votos` é `(linhas, zonas)` int64 (voto OBSERVADO); `te`/`esi` int64 e
    `apurada` bool por zona; `estratos` o estrato de cada zona (`None` = sem
    estratificação). Devolve `(votos projetados, fallback_uf, n_estratos)`.
    Separado de `projetar_uf` para que o replay sintético
    (`scripts/replay-deputado.py`) meça exatamente esta conta sem montar uma
    `EntradaProporcional` por zona.
    """
    # Só as colunas apuradas são escaladas; as outras nunca são lidas. `esi`
    # das não apuradas vira 1 só para a divisão não estourar.
    esi_seguro = np.where(apurada, esi, 1)
    escalados = _escalados(votos, te, esi_seguro)
    escalados[:, ~apurada] = 0
    micro, fallback, n_estratos = _projetar_micro(escalados, te, apurada, estratos)
    return _maiores_restos(micro), fallback, n_estratos


def projetar_uf(
    zonas: Sequence[ZonaProjecao],
    entrada_uf: EntradaProporcional,
    *,
    estrato_por_zona: Mapping[int, int] | None = None,
) -> ProjecaoUf | None:
    """Projeta os votos da UF inteira e distribui as cadeiras sobre eles.

    `zonas` são TODOS os pares da UF lidos no ciclo (apurados ou não), na
    ordem em que a soma `entrada_uf` foi feita. `estrato_por_zona` é
    `{cod_zona: estrato}` (`project.py::_compute_estratos_por_uf`) ou `None`
    (UF abaixo de 12 zonas: um estrato só).

    Devolve `None` quando não há o que projetar honestamente: sem `nv`, sem
    zona apurada, decomposição que não fecha com a soma, ou nenhum voto
    válido projetado (quociente zero). Quem chama publica `indisponivel/erro`
    nesses casos — a trava já garantiu que nenhum deles é o estado normal.
    """
    lugares = entrada_uf.lugares_a_preencher
    if lugares is None or lugares < 1 or not zonas:
        return None
    montado = _plano(zonas, entrada_uf)
    if montado is None:
        return None

    te = np.array([max(0, z.te) for z in zonas], dtype=np.int64)
    esi = np.array([z.esi for z in zonas], dtype=np.int64)
    apurada = np.array([z.apurada for z in zonas], dtype=bool)
    if not apurada.any():
        return None

    estratos = _estratos_das_zonas(zonas, estrato_por_zona)
    votos, fallback, n_estratos = projetar_votos(montado.votos, te, esi, apurada, estratos)

    agremiacoes: list[Agremiacao] = []
    for cod, i_legenda, cands in montado.plano:
        agremiacoes.append(
            Agremiacao(
                cod=cod,
                votos_legenda=votos[i_legenda],
                candidatos=tuple(
                    Candidato(cod=sq, votos_nominais=votos[i], nascimento=nasc)
                    for sq, i, nasc in cands
                ),
            )
        )
    entrada_projetada = replace(entrada_uf, agremiacoes=agremiacoes)
    resultado = distribuir_cadeiras(agremiacoes, lugares)
    if resultado.quociente_eleitoral < 1:
        return None

    te_total = int(te.sum())
    te_imputado = int(te[~apurada].sum())
    fracao = Fraction(te_imputado, te_total) if te_total > 0 else Fraction(0)
    return ProjecaoUf(
        entrada=entrada_projetada,
        resultado=resultado,
        fracao_imputada=fracao,
        n_estratos=n_estratos,
        fallback_uf=fallback,
    )


# ---------------------------------------------------------------------------
# O que mudou entre parcial e projeção — para o log `dep_projecao`
# ---------------------------------------------------------------------------


def diferenca_parcial_projecao(
    parcial: ResultadoCadeiras, projecao: ResultadoCadeiras
) -> dict[str, Any]:
    """Quantas cadeiras e quantos eleitos mudam de dono entre as duas contas.

    `cadeiras_trocadas` = Σ max(0, projetadas − parcial) por agremiação (uma
    cadeira que sai de A para B conta uma vez). `eleitos_trocados` = metade da
    diferença simétrica dos conjuntos de eleitos. `agremiacoes` lista as que
    mudam, `cod → [parcial, projetada]`, em ordem de código.
    """
    cods = sorted(set(parcial.cadeiras) | set(projecao.cadeiras))
    mudam = {
        cod: [parcial.cadeiras.get(cod, 0), projecao.cadeiras.get(cod, 0)]
        for cod in cods
        if parcial.cadeiras.get(cod, 0) != projecao.cadeiras.get(cod, 0)
    }
    trocadas = sum(max(0, p - a) for a, p in mudam.values())
    eleitos_p = {c.cod for v in parcial.eleitos.values() for c in v}
    eleitos_x = {c.cod for v in projecao.eleitos.values() for c in v}
    return {
        "cadeiras_trocadas": trocadas,
        "eleitos_trocados": len(eleitos_p ^ eleitos_x) // 2,
        "agremiacoes": mudam,
    }
