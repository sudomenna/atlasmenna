"""Projeção de Deputado Federal (spec 026 P2) e payload v2 (P3).

Três blocos, na ordem em que o ciclo os usa:

1. **Interruptor e trava** (`deputado_projecao.interruptor_do_corpo`,
   `avaliar_trava`) — RF-264/RF-265. Os limiares têm caso NO limiar (25,00000 ×
   24,99999; 2 × 1 zonas), e a ordem dos motivos é testada com duas condições
   falhando juntas. Os estados reais de RR e AP no simulado de 28/09 saem de
   `tests/fixtures/tse/2026-sim/dep/*/zonas-resumo.json`.
2. **Projeção** (`projetar_uf`) — RF-263. Contas feitas à mão (escala `te/esi`,
   razão das somas, imputação por estrato, maiores restos) e as identidades G1
   do ADR-0063: a 100% apurado, e com a mesma fração em todas as zonas,
   projeção == parcial.
3. **Payload v2** (`construir_payload_deputado`) — RF-260..RF-274. Todo payload
   montado aqui passa por `_contrato_deputado_v2` (o porte em Python das
   invariantes de `tests/unit/contrato/deputado-v2-fixtures.test.ts`), e cada
   regra tem o seu caso de borda: corte 60/61, puxador em 2·QE e 2·QE − 1,
   pisos com QE 1.003, via QP/sobra, ordem pelo apurado mesmo quando a
   projeção inverteria.

E o ciclo inteiro (`_do_project`) com `projecao_dep` no corpo, nos EA20 reais de
RR e AP, e o orçamento de bytes com o tamanho de 2022.
"""

from __future__ import annotations

import copy
import json
import math
import pathlib
import random
from fractions import Fraction
from typing import Any

import pytest

from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import (
    combinar_entradas,
    conferir_agregado_da_uf,
    extrair_entrada_proporcional,
)
from api.model.deputado_payload import (
    POSICOES_NO_BLOB,
    UfProporcional,
    construir_payload_deputado,
    regras_da_uf,
)
from api.model.deputado_projecao import (
    DESLIGADO,
    ESCALA,
    PCT_MINIMO_PADRAO,
    Interruptor,
    ZonaProjecao,
    _maiores_restos,
    avaliar_trava,
    interruptor_do_corpo,
    projetar_uf,
)
from api.model.project import estratos_da_projecao, pct_apurado_uf_proporcional
from tests.unit.model._contrato_deputado_v2 import (
    conferir_nacional,
    conferir_uf,
    linhas_de,
)
from tests.unit.model.test_deputado_payload import _FakeConn

DEP = pathlib.Path(__file__).parents[2] / "fixtures" / "tse" / "2026-sim" / "dep"
GOLDEN = pathlib.Path(__file__).parents[2] / "fixtures" / "model" / "cadeiras-golden-2022.json"

LIGADO = Interruptor(ligada=True, pct_minimo=PCT_MINIMO_PADRAO, origem="corpo")


def _ler(caminho: pathlib.Path) -> dict[str, Any]:
    return json.loads(caminho.read_text())


# ---------------------------------------------------------------------------
# Construtores de EA20 — o formato real, em miniatura
# ---------------------------------------------------------------------------


def _cand(sq: int, votos: int, *, dvt: str | None = None, nome: str | None = None) -> dict[str, Any]:
    c: dict[str, Any] = {
        "n": str(10_000 + sq % 90_000),
        "sqcand": str(sq),
        "nm": f"CANDIDATO {sq}",
        "nmu": nome or f"C{sq}",
        "e": "n",
        "vap": str(votos),
        "dt": "01/01/1970",
    }
    if dvt is not None:
        c["dvt"] = dvt
    return c


def _agr(n: str, sigla: str, cands: list[dict[str, Any]], *, legenda: int = 0) -> dict[str, Any]:
    """Partido isolado. Com `dvt` em algum candidato, publica `tvtn`/`tvtl` como
    o TSE (identidades medidas: `tvtn = Σ vap[Válido]`, `tvtl = legenda + Σ
    vap[Válido (legenda)]`)."""
    tem_dvt = any("dvt" in c for c in cands)
    par: dict[str, Any] = {"n": n, "sg": sigla, "nm": f"Partido {sigla}", "cand": cands}
    tvtl = legenda
    if tem_dvt:
        tvtn = sum(int(c["vap"]) for c in cands if c.get("dvt", "Válido") == "Válido")
        tvtl += sum(int(c["vap"]) for c in cands if c.get("dvt") == "Válido (legenda)")
        par["tvtn"] = str(tvtn)
    par["tvtl"] = str(tvtl)
    return {"n": n, "nm": f"Partido {sigla}", "tp": "i", "par": [par]}


def _env(
    agrs: list[dict[str, Any]],
    *,
    nv: str | None = "4",
    te: int,
    esi: int,
    tf: str = "n",
    andamento: str = "p",
) -> dict[str, Any]:
    """Envelope de uma zona (ou agregado). `v.vv` = soma válida medida pelo
    próprio extrator — é o que o TSE publica quando a regra do `dvt` fecha."""
    carg: dict[str, Any] = {"cd": "6", "agr": agrs}
    if nv is not None:
        carg["nv"] = nv
    env: dict[str, Any] = {"tf": tf, "and": andamento, "carg": [carg]}
    env["e"] = {"te": str(te), "esi": str(esi)}
    vv = extrair_entrada_proporcional(env).soma_validos if esi > 0 else 0
    env["v"] = {"vv": str(vv)}
    return env


def _zona(cod_zona: int, env: dict[str, Any]) -> ZonaProjecao:
    return ZonaProjecao(
        cod_zona=cod_zona,
        te=int(env["e"]["te"]),
        esi=int(env["e"]["esi"]),
        vv=int(env["v"]["vv"]),
        entrada=extrair_entrada_proporcional(env),
    )


def _zona_ab(cod: int, te: int, esi: int, a: int, b: int, *, nv: str = "4") -> ZonaProjecao:
    """Dois partidos, um candidato cada: A (cod 10, sq 1) e B (cod 20, sq 2)."""
    return _zona(
        cod,
        _env(
            [_agr("10", "PA", [_cand(1, a)]), _agr("20", "PB", [_cand(2, b)])],
            nv=nv,
            te=te,
            esi=esi,
        ),
    )


def _votos_projetados(zonas: list[ZonaProjecao], estratos: dict[int, int] | None = None) -> dict[str, int]:
    entrada = combinar_entradas([z.entrada for z in zonas])
    proj = projetar_uf(zonas, entrada, estrato_por_zona=estratos)
    assert proj is not None
    return {a.cod: a.votos_totais for a in proj.entrada.agremiacoes}


# ===========================================================================
# 1. Interruptor — `ProjectRequest.projecao_dep`, falha fechada (RF-265)
# ===========================================================================


@pytest.mark.parametrize(
    ("bruto", "ligada", "pct", "origem"),
    [
        (None, False, 25, "ausente"),
        ({"ligada": True}, True, 25, "corpo"),
        ({"ligada": False}, False, 25, "corpo"),
        ({"ligada": "true"}, False, 25, "corpo"),  # só o booleano liga
        ({"ligada": 1}, False, 25, "corpo"),
        ({}, False, 25, "corpo"),
        ({"ligada": True, "pct_minimo": 30}, True, 30, "corpo"),
        ({"ligada": True, "pct_minimo": 100}, True, 100, "corpo"),
        ({"ligada": True, "pct_minimo": 25.0}, True, 25, "corpo"),
        # O piso só sobe (ADR-0063): abaixo de 25 é ignorado, não desliga.
        ({"ligada": True, "pct_minimo": 10}, True, 25, "corpo"),
        # Decimal entre 25 e 100 sobe para o inteiro de cima — o mesmo `ceil`
        # que o ciclo TS aplica antes do POST (`lerProjecaoDepParaOModelo`).
        ({"ligada": True, "pct_minimo": 30.5}, True, 31, "corpo"),
        ({"ligada": True, "pct_minimo": 99.01}, True, 100, "corpo"),
        # 🔴 Inválido ⇒ IGNORADO (vale 25) e `ligada` PRESERVADO — ADR-0063 D4,
        # a mesma regra do leitor TS. Até 29/09 estes desligavam o interruptor
        # inteiro aqui, enquanto a tela os ignorava.
        ({"ligada": True, "pct_minimo": 101}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": 500}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": True}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": "30"}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": None}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": float("nan")}, True, 25, "corpo"),
        ({"ligada": True, "pct_minimo": float("inf")}, True, 25, "corpo"),
        # …e o inválido nunca LIGA quem veio desligado.
        ({"ligada": False, "pct_minimo": 500}, False, 25, "corpo"),
        ({"pct_minimo": 40}, False, 40, "corpo"),
        ([True], False, 25, "invalido"),
        ("ligada", False, 25, "invalido"),
    ],
)
def test_interruptor_do_corpo_falha_fechada(bruto: Any, ligada: bool, pct: int, origem: str) -> None:
    i = interruptor_do_corpo(bruto)
    assert (i.ligada, i.pct_minimo, i.origem) == (ligada, pct, origem)


def test_interruptor_abaixo_de_25_deixa_aviso_para_o_log() -> None:
    assert interruptor_do_corpo({"ligada": True, "pct_minimo": 10}).aviso == (
        "pct_minimo_abaixo_de_25_ignorado"
    )
    assert interruptor_do_corpo({"ligada": True, "pct_minimo": 30}).aviso is None


@pytest.mark.parametrize(
    ("pct", "aviso"),
    [
        (101, "pct_minimo_acima_de_100_ignorado"),
        (100.2, "pct_minimo_acima_de_100_ignorado"),
        (24.9, "pct_minimo_abaixo_de_25_ignorado"),
        (True, "pct_minimo_invalido_ignorado"),
        ("30", "pct_minimo_invalido_ignorado"),
        (None, "pct_minimo_invalido_ignorado"),
        (float("nan"), "pct_minimo_invalido_ignorado"),
    ],
)
def test_interruptor_pct_invalido_e_ignorado_com_aviso(pct: Any, aviso: str) -> None:
    """Todo `pct_minimo` ignorado deixa o `aviso` que vai para o log do ciclo
    (ADR-0063 D4, "ignorado, com log") — e nunca mexe em `ligada`."""
    i = interruptor_do_corpo({"ligada": True, "pct_minimo": pct})
    assert (i.ligada, i.pct_minimo, i.origem, i.aviso) == (True, 25, "corpo", aviso)


@pytest.mark.parametrize(
    "valor",
    [
        {"ligada": True},
        {"ligada": False},
        {"ligada": "true"},
        {"ligada": True, "pct_minimo": 10},
        {"ligada": True, "pct_minimo": 40},
        {"ligada": True, "pct_minimo": 40.2},
        {"ligada": True, "pct_minimo": 101},
        {"ligada": True, "pct_minimo": "40"},
        {"ligada": True, "pct_minimo": None},
        {"ligada": False, "pct_minimo": 500},
    ],
)
def test_interruptor_python_e_ts_concordam(valor: dict[str, Any]) -> None:
    """A tabela da regra TS (`interpretarInterruptor` + o `ceil` de
    `lerProjecaoDepParaOModelo`) escrita à mão: para a mesma chave, o modelo e a
    tela têm de chegar ao mesmo `ligada` e à mesma trava efetiva."""
    ligada_ts = valor.get("ligada") is True
    pct = valor.get("pct_minimo", 25)
    valido = (
        not isinstance(pct, bool)
        and isinstance(pct, (int, float))
        and math.isfinite(pct)
        and 25 <= pct <= 100
    )
    pct_ts = math.ceil(pct) if valido else 25
    i = interruptor_do_corpo(valor)
    assert (i.ligada, i.pct_minimo) == (ligada_ts, pct_ts)


# ===========================================================================
# 2. Trava — ordem fixa do design § 2.7 (RF-264)
# ===========================================================================


def _trava(**kw: Any) -> tuple[str, str | None]:
    base: dict[str, Any] = {
        "interruptor": LIGADO,
        "tem_coligacao": False,
        "lugares_a_preencher": 8,
        "pct_apurado": 60.0,
        "zonas_apuradas": 5,
        "zonas_total": 16,
        "te_zonas": 407_271,
        "te_agregado": 407_271,
    }
    base.update(kw)
    e = avaliar_trava(**base)
    return e.estado, e.motivo


def test_trava_liberada_com_todas_as_condicoes() -> None:
    assert _trava() == ("liberada", None)


@pytest.mark.parametrize(
    ("pct", "esperado"),
    [
        (25.0, ("liberada", None)),  # NO limiar
        (24.99999, ("aguardando", "pct_minimo")),
        (25.00001, ("liberada", None)),
        # Arredondado a 5 casas, como a tela publica: "25,00000%" nunca ao
        # lado de "aguarda 25%".
        (24.999996, ("liberada", None)),
        (24.999994, ("aguardando", "pct_minimo")),
        (0.0, ("aguardando", "pct_minimo")),
    ],
)
def test_trava_no_limiar_de_25(pct: float, esperado: tuple[str, str | None]) -> None:
    assert _trava(pct_apurado=pct) == esperado


def test_trava_pct_minimo_do_interruptor_sobe_o_piso() -> None:
    i30 = Interruptor(True, 30, "corpo")
    assert _trava(interruptor=i30, pct_apurado=29.99999) == ("aguardando", "pct_minimo")
    assert _trava(interruptor=i30, pct_apurado=30.0) == ("liberada", None)
    e = avaliar_trava(
        interruptor=i30,
        tem_coligacao=False,
        lugares_a_preencher=8,
        pct_apurado=10.0,
        zonas_apuradas=1,
        zonas_total=2,
        te_zonas=None,
        te_agregado=None,
    )
    assert e.payload()["pct_minimo"] == 30


@pytest.mark.parametrize(("zonas", "esperado"), [(1, ("aguardando", "zonas_minimas")), (2, ("liberada", None))])
def test_trava_duas_zonas_minimas(zonas: int, esperado: tuple[str, str | None]) -> None:
    """30% apurado numa única zona não libera (spec RF-264)."""
    assert _trava(pct_apurado=30.0, zonas_apuradas=zonas) == esperado


def test_trava_sem_nv_e_coligacao_e_interruptor() -> None:
    assert _trava(lugares_a_preencher=None) == ("aguardando", "sem_vagas")
    assert _trava(tem_coligacao=True) == ("indisponivel", "coligacao")
    assert _trava(interruptor=DESLIGADO) == ("indisponivel", "interruptor")


def test_trava_cobertura_fecha_quando_o_eleitorado_nao_fecha_com_o_agregado() -> None:
    """O AP de 28/09: as zonas lidas somam 505.610, o agregado 628.071."""
    assert _trava(te_zonas=505_610, te_agregado=628_071) == ("indisponivel", "cobertura")
    assert _trava(te_zonas=505_610, te_agregado=None) == ("liberada", None)
    assert _trava(te_zonas=None, te_agregado=628_071) == ("indisponivel", "cobertura")


@pytest.mark.parametrize(
    ("falhas", "motivo"),
    [
        ({"interruptor": DESLIGADO, "tem_coligacao": True}, "interruptor"),
        ({"tem_coligacao": True, "lugares_a_preencher": None}, "coligacao"),
        ({"lugares_a_preencher": None, "pct_apurado": 5.0}, "sem_vagas"),
        ({"pct_apurado": 5.0, "zonas_apuradas": 1}, "pct_minimo"),
        ({"zonas_apuradas": 1, "te_zonas": 1}, "zonas_minimas"),
        ({"interruptor": DESLIGADO, "te_zonas": 1}, "interruptor"),
    ],
)
def test_trava_duas_falhas_publicam_a_primeira_da_ordem(falhas: dict[str, Any], motivo: str) -> None:
    assert _trava(**falhas)[1] == motivo


def test_estado_publicado_omite_motivo_so_quando_liberada() -> None:
    lib = avaliar_trava(
        interruptor=LIGADO,
        tem_coligacao=False,
        lugares_a_preencher=8,
        pct_apurado=50.0,
        zonas_apuradas=3,
        zonas_total=4,
        te_zonas=None,
        te_agregado=None,
    ).payload()
    assert lib == {"estado": "liberada", "pct_minimo": 25, "zonas_apuradas": 3, "zonas_total": 4}
    agu = avaliar_trava(
        interruptor=LIGADO,
        tem_coligacao=False,
        lugares_a_preencher=8,
        pct_apurado=5.0,
        zonas_apuradas=3,
        zonas_total=4,
        te_zonas=None,
        te_agregado=None,
    ).payload()
    assert agu["motivo"] == "pct_minimo"


# --- a trava nos momentos REAIS do simulado de 28/09 ------------------------


def _estado_real(uf: str, momento: str) -> tuple[str, str | None, float, int, int]:
    resumo = _ler(DEP / uf / "zonas-resumo.json")["momentos"][momento]
    zonas = resumo["zonas"]
    ag = resumo["agregado"]
    linhas = [
        {"uf": uf.upper(), "cod_zona": z["zona"], "pct_apurado": 0.0, "payload": {"e": {"te": str(z["te"]), "esi": str(z["esi"])}}}
        for z in zonas
    ]
    agregado = {"payload": {"e": {"te": str(ag["te"]), "esi": str(ag["esi"])}}}
    pct, _fonte = pct_apurado_uf_proporcional(linhas, eleitorado_total_uf=0, agregado=agregado)
    apuradas = sum(1 for z in zonas if z["esi"] > 0 and z["vv"] > 0)
    e = avaliar_trava(
        interruptor=LIGADO,
        tem_coligacao=False,
        lugares_a_preencher=int(ag["nv"]),
        pct_apurado=pct,
        zonas_apuradas=apuradas,
        zonas_total=len(zonas),
        te_zonas=sum(z["te"] for z in zonas),
        te_agregado=ag["te"],
    )
    return e.estado, e.motivo, round(pct, 2), apuradas, len(zonas)


@pytest.mark.parametrize(
    ("uf", "momento", "esperado"),
    [
        # 1 zona de 16 com boletim, 20,19% do eleitorado — aguarda.
        ("rr", "inicial", ("aguardando", "pct_minimo", 20.19, 1, 16)),
        # 15 de 16, soma fecha exata com o agregado — libera.
        ("rr", "tardio", ("liberada", None, 94.33, 15, 16)),
        ("rr", "final", ("liberada", None, 100.0, 16, 16)),
        # AP acima de 25% o tempo todo, e a zona 0014 de Macapá fora da soma.
        ("ap", "inicial", ("indisponivel", "cobertura", 33.0, 7, 17)),
        ("ap", "tardio", ("indisponivel", "cobertura", 80.5, 17, 17)),
        ("ap", "final", ("indisponivel", "cobertura", 80.5, 17, 17)),
    ],
)
def test_trava_nos_momentos_reais_do_simulado(uf: str, momento: str, esperado: tuple) -> None:
    assert _estado_real(uf, momento) == esperado


# ===========================================================================
# 3. Projeção — contas à mão
# ===========================================================================


def test_escala_te_esi_e_imputacao_do_estado_inteiro() -> None:
    """Um estrato. Z1 inteira; Z2 com metade das seções (k = 2); Z3 sem boletim.

        X_A = 60 + 10·2 = 80   X_B = 40 + 30·2 = 100   T = 200   U = 200
        A = 80 + 200·80/200 = 160      B = 100 + 200·100/200 = 200
    """
    zonas = [
        _zona_ab(1, 100, 100, 60, 40),
        _zona_ab(2, 100, 50, 10, 30),
        _zona_ab(3, 200, 0, 0, 0),
    ]
    assert _votos_projetados(zonas) == {"10": 160, "20": 200}


def test_zona_com_esi_e_sem_voto_valido_nao_e_apurada() -> None:
    """`esi > 0 ∧ vv > 0` — com `vv = 0` a zona é IMPUTADA, e o voto que ela
    diz ter não entra (uma contagem sem voto válido é leitura incoerente)."""
    zonas = [
        _zona_ab(1, 100, 100, 60, 40),
        _zona_ab(2, 100, 100, 50, 50),
    ]
    # Z3 com esi cheio mas vv forçado a 0: imputada como 200 eleitores.
    z3 = _zona_ab(3, 200, 200, 1000, 0)
    z3 = ZonaProjecao(cod_zona=3, te=200, esi=200, vv=0, entrada=z3.entrada)
    assert not z3.apurada
    # X_A = 110, X_B = 90, T = 200, U = 200 → A = 220, B = 180. Os 1.000 de Z3
    # nunca aparecem.
    assert _votos_projetados([*zonas, z3]) == {"10": 220, "20": 180}


def _doze_zonas(reportadas: set[int]) -> list[ZonaProjecao]:
    """4 pequenas (te 100, B forte), 4 médias (200, empate), 4 grandes (400,
    A forte). Só as de `reportadas` têm boletim."""
    zonas = []
    for cod in range(1, 13):
        if cod <= 4:
            te, a, b = 100, 20, 80
        elif cod <= 8:
            te, a, b = 200, 100, 100
        else:
            te, a, b = 400, 300, 100
        if cod in reportadas:
            zonas.append(_zona_ab(cod, te, te, a, b))
        else:
            zonas.append(_zona_ab(cod, te, 0, 0, 0))
    return zonas


def test_pos_estratificacao_por_tercis_imputa_cada_zona_pelo_seu_porte() -> None:
    """As grandes apuraram primeiro (reduto de A). Estratificado:

        grandes  X_A=1200 X_B=400 (nada a imputar)
        médias   1 de 4: A = 100 + 600·100/200 = 400;  B = 400
        pequenas 1 de 4: A =  20 + 300· 20/100 =  80;  B = 80 + 300·80/100 = 320
        total    A = 1.680, B = 1.120

    Sem estratos, a proporção das grandes contaminaria as pequenas:
    A ≈ 1.945, B ≈ 855.
    """
    zonas = _doze_zonas({1, 5, 9, 10, 11, 12})
    estratos = estratos_da_projecao("SP", zonas)
    assert estratos is not None and sorted(set(estratos.values())) == [0, 1, 2]
    assert _votos_projetados(zonas, estratos) == {"10": 1680, "20": 1120}
    assert _votos_projetados(zonas, None) == {"10": 1945, "20": 855}


def test_estrato_sem_zona_apurada_cai_para_a_intensidade_da_uf() -> None:
    """Nenhuma pequena apurou: elas recebem a intensidade da UF inteira
    (hierarquia do ADR-0023)."""
    zonas = _doze_zonas({5, 9, 10, 11, 12})
    estratos = estratos_da_projecao("SP", zonas)
    entrada = combinar_entradas([z.entrada for z in zonas])
    proj = projetar_uf(zonas, entrada, estrato_por_zona=estratos)
    assert proj is not None and proj.fallback_uf is True and proj.n_estratos == 3
    # Pequenas (U = 400) pela UF: X_A = 1.300, X_B = 500, T = 1.800.
    # A = 1.200 + 400 (médias) + 400·1300/1800 = 1.888,9; B = 400 + 400 + 111,1.
    votos = {a.cod: a.votos_totais for a in proj.entrada.agremiacoes}
    assert votos == {"10": 1889, "20": 911}


def test_menos_de_12_zonas_e_um_estrato_so() -> None:
    zonas = _doze_zonas({1, 5, 9})[:11]
    assert estratos_da_projecao("RR", zonas) is None


def test_maiores_restos_preserva_o_total_e_desempata_pela_ordem_das_chaves() -> None:
    # 1,5 + 1,5 + 1,0 = 4 exatos: o resto maior empata, e a primeira chave leva.
    assert _maiores_restos([1_500_000, 1_500_000, 1_000_000]) == [2, 1, 1]
    rng = random.Random(3)
    for _ in range(200):
        micro = [rng.randrange(0, 50 * ESCALA) for _ in range(rng.randrange(1, 30))]
        votos = _maiores_restos(micro)
        assert sum(votos) == (sum(micro) + ESCALA // 2) // ESCALA
        assert all(abs(v * ESCALA - m) < ESCALA for v, m in zip(votos, micro, strict=True))


def test_arredondamento_da_projecao_preserva_o_total_exato() -> None:
    """Z1 (2 eleitores) com A 1 e B 1; Z2 (1 eleitor) sem boletim. Exatos:
    A = B = 1,5 — total 3. Maiores restos dá 2 + 1 (o empate de resto vai para
    a primeira chave); `round()` por chave daria 2 + 2 = 4 votos, um voto que
    não existe (o `round` do Python arredonda 1,5 para o par)."""
    zonas = [_zona_ab(1, 2, 2, 1, 1), _zona_ab(2, 1, 0, 0, 0)]
    assert _votos_projetados(zonas) == {"10": 2, "20": 1}


def test_projecao_e_independente_da_ordem_das_zonas() -> None:
    zonas = _doze_zonas({1, 2, 5, 9, 10})
    estratos = estratos_da_projecao("SP", zonas)
    base = _votos_projetados(zonas, estratos)
    embaralhadas = list(zonas)
    random.Random(11).shuffle(embaralhadas)
    assert _votos_projetados(embaralhadas, estratos) == base


def test_fracao_imputada_e_o_eleitorado_sem_boletim() -> None:
    zonas = [_zona_ab(1, 100, 100, 60, 40), _zona_ab(2, 100, 100, 50, 50), _zona_ab(3, 200, 0, 0, 0)]
    proj = projetar_uf(zonas, combinar_entradas([z.entrada for z in zonas]))
    assert proj is not None and proj.fracao_imputada == Fraction(1, 2)


def test_sem_zona_apurada_ou_sem_nv_nao_projeta() -> None:
    zonas = [_zona_ab(1, 100, 0, 0, 0), _zona_ab(2, 100, 0, 0, 0)]
    assert projetar_uf(zonas, combinar_entradas([z.entrada for z in zonas])) is None
    sem_nv = [_zona_ab(1, 100, 100, 60, 40, nv=None)]  # type: ignore[arg-type]
    assert projetar_uf(sem_nv, combinar_entradas([z.entrada for z in sem_nv])) is None


def test_anulado_e_sub_judice_nao_sao_projetados_e_valido_legenda_vai_para_a_legenda() -> None:
    """RF-263: o voto do sub judice não é projetado nem conta; o do `Válido
    (legenda)` é projetado dentro da legenda do partido (ADR-0064)."""

    def env(te: int, esi: int, k: int) -> dict[str, Any]:
        return _env(
            [
                _agr(
                    "10",
                    "PA",
                    [
                        _cand(1, 100 * k, dvt="Válido"),
                        _cand(3, 900 * k, dvt="Anulado sub judice"),
                        _cand(4, 50 * k, dvt="Válido (legenda)"),
                    ],
                    legenda=10 * k,
                ),
                _agr("20", "PB", [_cand(2, 200 * k, dvt="Válido")]),
            ],
            te=te,
            esi=esi,
        )

    zonas = [_zona(1, env(100, 100, 1)), _zona(2, env(100, 50, 1)), _zona(3, env(200, 0, 0))]
    entrada = combinar_entradas([z.entrada for z in zonas])
    proj = projetar_uf(zonas, entrada)
    assert proj is not None
    a = next(x for x in proj.entrada.agremiacoes if x.cod == "10")
    assert [c.cod for c in a.candidatos] == [1]  # nem o 3 nem o 4 são Candidato
    # Observado A: nominal 100 + 200 (k=2) = 300; legenda (10+50) + (10+50)·2 = 180.
    # T = 200, U = 200 → tudo ×2.
    assert a.candidatos[0].votos_nominais == 600
    assert a.votos_legenda == 360


# --- G1 — identidades do ADR-0063 ------------------------------------------


def _mundo(n_zonas: int, *, seed: int, fracao: Fraction | None = None) -> list[ZonaProjecao]:
    """3 agremiações × 6 candidatos, votos por zona com reduto; `fracao` põe
    TODAS as zonas com `esi = te·fracao` e votos já nessa fração."""
    rng = random.Random(seed)
    zonas = []
    for cod in range(1, n_zonas + 1):
        te = rng.choice([400, 800, 1200, 2000]) * 10
        agrs = []
        for i, (n, sg) in enumerate((("10", "PA"), ("20", "PB"), ("30", "PC"))):
            forca = rng.uniform(0.5, 2.0)
            cands = [
                _cand(100 * (i + 1) + j, int(te * 0.06 * forca * (1 - j * 0.15))) for j in range(6)
            ]
            agrs.append(_agr(n, sg, cands, legenda=int(te * 0.01 * forca)))
        env = _env(agrs, nv="10", te=te, esi=te)
        if fracao is not None:
            for agr in env["carg"][0]["agr"]:
                for par in agr["par"]:
                    par["tvtl"] = str(int(Fraction(int(par["tvtl"])) * fracao))
                    for c in par["cand"]:
                        c["vap"] = str(int(Fraction(int(c["vap"])) * fracao))
            env["e"]["esi"] = str(int(te * fracao))
            env["v"]["vv"] = str(extrair_entrada_proporcional(env).soma_validos)
        zonas.append(_zona(cod, env))
    return zonas


@pytest.mark.parametrize("seed", range(8))
def test_g1_a_100_por_cento_projecao_igual_a_parcial_cadeira_a_cadeira(seed: int) -> None:
    zonas = _mundo(15, seed=seed)
    entrada = combinar_entradas([z.entrada for z in zonas])
    parcial = distribuir_cadeiras(entrada.agremiacoes, 10)
    proj = projetar_uf(zonas, entrada, estrato_por_zona=estratos_da_projecao("SP", zonas))
    assert proj is not None
    assert proj.entrada.agremiacoes == entrada.agremiacoes  # voto a voto
    assert proj.resultado.cadeiras == parcial.cadeiras
    assert {k: [c.cod for c in v] for k, v in proj.resultado.eleitos.items()} == {
        k: [c.cod for c in v] for k, v in parcial.eleitos.items()
    }
    assert proj.fracao_imputada == 0


@pytest.mark.parametrize("seed", range(8))
def test_g1_mesma_fracao_em_todas_as_zonas_projecao_igual_a_parcial(seed: int) -> None:
    """Com metade das seções em TODAS as zonas, `k = 2` em todas: o voto
    projetado é exatamente o dobro do apurado, e as cadeiras são as mesmas —
    a distribuição é invariante à escala (o quociente dobra junto)."""
    zonas = _mundo(15, seed=seed, fracao=Fraction(1, 2))
    entrada = combinar_entradas([z.entrada for z in zonas])
    proj = projetar_uf(zonas, entrada, estrato_por_zona=estratos_da_projecao("SP", zonas))
    assert proj is not None
    for a_p, a_x in zip(entrada.agremiacoes, proj.entrada.agremiacoes, strict=True):
        assert a_x.votos_legenda == 2 * a_p.votos_legenda
        assert [c.votos_nominais for c in a_x.candidatos] == [2 * c.votos_nominais for c in a_p.candidatos]
    parcial = distribuir_cadeiras(entrada.agremiacoes, 10)
    # A invariância à escala é exata quando o QE não tem fração (a do art.
    # 106 é a única conta que não escala); com fração, o resultado de todas
    # as sementes daqui também coincide — medido, não suposto.
    assert proj.resultado.cadeiras == parcial.cadeiras
    assert {k: [c.cod for c in v] for k, v in proj.resultado.eleitos.items()} == {
        k: [c.cod for c in v] for k, v in parcial.eleitos.items()
    }


# ===========================================================================
# 4. Payload v2 — montado pelo produtor e conferido pelo contrato
# ===========================================================================


def _uf_v2(
    sigla: str,
    zonas: list[ZonaProjecao],
    *,
    pct: float,
    interruptor: Interruptor = LIGADO,
    agregado: dict[str, Any] | None = None,
    estratos: bool = True,
) -> UfProporcional:
    """O que `_do_project_proporcional` monta para uma UF, sem banco."""
    entrada = combinar_entradas([z.entrada for z in zonas])
    lugares = entrada.lugares_a_preencher
    resultado = distribuir_cadeiras(entrada.agremiacoes, lugares) if lugares else None
    if resultado is not None and resultado.quociente_eleitoral < 1:
        resultado = None
    te_agregado = int(agregado["e"]["te"]) if agregado is not None else None
    conferencia = conferir_agregado_da_uf(
        agregado,
        eleitorado_lido=sum(z.te for z in zonas),
        validos_lidos=entrada.votos_validos_tse,
        resultado_parcial=resultado,
    )
    com_e = [z.te for z in zonas if z.te > 0]
    estado = avaliar_trava(
        interruptor=interruptor,
        tem_coligacao=entrada.tem_coligacao,
        lugares_a_preencher=lugares,
        pct_apurado=pct,
        zonas_apuradas=sum(1 for z in zonas if z.apurada),
        zonas_total=len(zonas),
        te_zonas=sum(com_e) if com_e else None,
        te_agregado=te_agregado,
    )
    projecao = None
    if estado.liberada:
        projecao = projetar_uf(
            zonas, entrada, estrato_por_zona=estratos_da_projecao(sigla, zonas) if estratos else None
        )
    return UfProporcional(
        uf=sigla,
        pct_apurado=pct,
        entrada=entrada,
        resultado=resultado,
        conferencia=conferencia,
        projecao_estado=estado,
        projecao=projecao,
    )


def _publicar(ufs: list[UfProporcional]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    return construir_payload_deputado(
        ufs=ufs,
        divergencias_por_uf={},
        ts_iso="2026-10-04T23:00:00+00:00",
        cargo=6,
        turno=1,
        atualizacao_min=30,
        ufs_conhecidas=27,
        pct_apurado_total=50.0,
    )


def _publicar_e_conferir(ufs: list[UfProporcional]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    payload, detalhes = _publicar(ufs)
    for uf, d in detalhes.items():
        # `divergencias` do topo (v1) é o que o ciclo copia da conferência.
        d["divergencias"] = d["conferencia"]["divergencias"]
        conferir_uf(d)
    conferir_nacional(payload, detalhes)
    return payload, detalhes


def _agr_detalhe(detalhe: dict[str, Any], cod: str) -> dict[str, Any]:
    return next(a for a in detalhe["agremiacoes"] if a["cod"] == cod)


def test_payload_do_mundo_sintetico_cumpre_o_contrato_nos_tres_estados() -> None:
    zonas = _mundo(14, seed=5)
    parcial = [z if z.cod_zona % 3 else ZonaProjecao(z.cod_zona, z.te, 0, 0, z.entrada) for z in zonas]
    ufs = [
        _uf_v2("SP", parcial, pct=60.0),
        _uf_v2("RJ", parcial, pct=10.0),
        _uf_v2("MG", parcial, pct=60.0, interruptor=DESLIGADO),
    ]
    payload, detalhes = _publicar_e_conferir(ufs)
    assert detalhes["SP"]["projecao"]["estado"] == "liberada"
    assert detalhes["RJ"]["projecao"] == {
        "estado": "aguardando",
        "motivo": "pct_minimo",
        "pct_minimo": 25,
        "zonas_apuradas": 10,
        "zonas_total": 14,
    }
    assert detalhes["MG"]["projecao"]["motivo"] == "interruptor"
    sp = detalhes["SP"]
    assert sum(a["cadeiras_projetadas"] for a in sp["agremiacoes"]) == 10
    assert all("cadeiras_projetadas_ci95" not in a for a in sp["agremiacoes"])
    assert {row["sigla"]: row["projecao"]["estado"] for row in payload["por_uf"]} == {
        "MG": "indisponivel",
        "RJ": "aguardando",
        "SP": "liberada",
    }


def test_marca_de_projecao_nunca_sai_fora_de_liberada_mesmo_com_projecao_na_mao() -> None:
    """Invariante "marcas só com liberada": o produtor ignora um `ProjecaoUf`
    que chegue junto de um estado que não é `liberada`."""
    zonas = _mundo(14, seed=2)
    lib = _uf_v2("SP", zonas, pct=100.0)
    assert lib.projecao is not None
    agu = UfProporcional(
        uf="SP",
        pct_apurado=100.0,
        entrada=lib.entrada,
        resultado=lib.resultado,
        conferencia=lib.conferencia,
        projecao_estado=avaliar_trava(
            interruptor=DESLIGADO,
            tem_coligacao=False,
            lugares_a_preencher=10,
            pct_apurado=100.0,
            zonas_apuradas=14,
            zonas_total=14,
            te_zonas=None,
            te_agregado=None,
        ),
        projecao=lib.projecao,
    )
    _payload, detalhes = _publicar_e_conferir([agu])
    texto = json.dumps(detalhes["SP"])
    assert '"projecao": "' not in texto and "cadeiras_projetadas" not in texto
    assert "votos_projetados" not in texto and "projecao_apertada" not in texto


def test_g1_no_payload_a_100_por_cento_toda_marca_de_projecao_e_a_da_parcial() -> None:
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", _mundo(14, seed=9), pct=100.0)])
    for agr in detalhes["SP"]["agremiacoes"]:
        assert agr["cadeiras_projetadas"] == agr["cadeiras"]
        for linha in linhas_de(detalhes["SP"], agr):
            assert linha.get("projecao") == linha.get("parcial")
            assert "indefinido" not in linha and "projecao_apertada" not in linha


# --- o corte 60/61 (ADR-0065) -----------------------------------------------


def _uf_setenta_e_um() -> UfProporcional:
    """Uma agremiação com 71 candidatos (o máximo de SP: 70 lugares + 1)."""
    cands = [_cand(1000 + j, 5000 - 60 * j) for j in range(71)]
    outros = [_cand(9000 + j, 3000 - 100 * j) for j in range(5)]
    env = _env(
        [_agr("22", "PL", cands, legenda=500), _agr("13", "PT", outros, legenda=100)],
        nv="70",
        te=900_000,
        esi=900_000,
    )
    return _uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)


def test_corte_de_60_no_objeto_e_61_em_diante_na_lista() -> None:
    _payload, detalhes = _publicar_e_conferir([_uf_setenta_e_um()])
    sp = detalhes["SP"]
    pl = _agr_detalhe(sp, "22")
    assert pl["total_candidatos"] == 71
    no_objeto = [c["rank"] for c in pl["candidatos"]]
    # Todos elegem no PL (70 lugares, 71 + 5 candidatos), então os marcados
    # passam de 60 — ficam no objeto. O que NÃO tem marca vai para a lista.
    marcados_acima = [c["rank"] for c in pl["candidatos"] if c["rank"] > POSICOES_NO_BLOB]
    assert set(no_objeto) >= set(range(1, 61))
    restantes = [c["rank"] for b in sp.get("lista_restante", []) for c in b["candidatos"]]
    assert sorted(no_objeto + restantes) == list(range(1, 72))
    assert all(r > 60 for r in restantes)
    assert sp.get("lista", {}).get("restantes", 0) == len(restantes)
    assert all(
        "parcial" in c or c["sqcand"] == pl["corte"]["primeiro_fora"]
        for c in pl["candidatos"]
        if c["rank"] in marcados_acima
    )


def test_sem_marca_acima_de_60_o_objeto_tem_exatamente_60() -> None:
    """Poucas vagas: os ranks 61–71 do PL não têm marca e saem todos na lista."""
    cands = [_cand(1000 + j, 5000 - 60 * j) for j in range(71)]
    env = _env([_agr("22", "PL", cands, legenda=500)], nv="8", te=900_000, esi=900_000)
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)])
    pl = _agr_detalhe(detalhes["SP"], "22")
    assert len(pl["candidatos"]) == 60
    assert [c["rank"] for c in detalhes["SP"]["lista_restante"][0]["candidatos"]] == list(range(61, 72))
    assert detalhes["SP"]["lista"] == {"restantes": 11}


# --- puxadores, pisos, via -------------------------------------------------


def _uf_qe_2500(votos_puxador: int, *, sub_judice: int = 0) -> UfProporcional:
    """4 vagas, 10.000 válidos, QE 2.500 — numa zona só com voto (a outra sem
    boletim). A legenda do PA compensa o voto do puxador para o total ficar
    fixo, de modo que 2·QE e 2·QE − 1 são testáveis NO limiar."""
    pa = [_cand(1, votos_puxador, dvt="Válido"), _cand(2, 300, dvt="Válido")]
    if sub_judice:
        pa.append(_cand(9, sub_judice, dvt="Anulado sub judice"))
    agrs = [
        _agr("10", "PA", pa, legenda=6000 - votos_puxador - 300),
        _agr("20", "PB", [_cand(3, 2000, dvt="Válido"), _cand(4, 900, dvt="Válido")], legenda=100),
        _agr("30", "PC", [_cand(5, 900, dvt="Válido")], legenda=100),
    ]
    cheia = _env(agrs, nv="4", te=20_000, esi=20_000)
    vazia = _env(copy.deepcopy(agrs), nv="4", te=20_000, esi=0)
    for agr in vazia["carg"][0]["agr"]:
        for par in agr["par"]:
            par["tvtl"] = "0"
            par["tvtn"] = "0"
            for c in par["cand"]:
                c["vap"] = "0"
    uf = _uf_v2("SP", [_zona(1, cheia), _zona(2, vazia)], pct=100.0)
    assert uf.resultado is not None and uf.resultado.quociente_eleitoral == 2500
    return uf


@pytest.mark.parametrize(
    ("votos", "puxador"),
    [(2500, None), (4999, None), (5000, (2, 1)), (5699, (2, 1))],
)
def test_puxador_a_partir_de_duas_vezes_o_qe(votos: int, puxador: tuple[int, int] | None) -> None:
    """RF-273: 2·QE exato é puxador com excedente 1; 2·QE − 1 não é."""
    _payload, detalhes = _publicar_e_conferir([_uf_qe_2500(votos)])
    pa = _agr_detalhe(detalhes["SP"], "10")
    if puxador is not None:
        assert pa["puxadores"] == [{"sqcand": 1, "quocientes": puxador[0], "excedente": puxador[1]}]
    else:
        assert "puxadores" not in pa


def test_sub_judice_com_cinco_qe_nao_e_puxador_nem_tem_percentual() -> None:
    _payload, detalhes = _publicar_e_conferir([_uf_qe_2500(1000, sub_judice=12_500)])
    pa = _agr_detalhe(detalhes["SP"], "10")
    assert "puxadores" not in pa
    sj = next(c for c in pa["candidatos"] if c["sqcand"] == 9)
    assert sj["destino"] == "sub_judice" and sj["pct_validos"] is None and sj["votos"] == 12_500
    assert sj["rank"] == 1  # posição pelo voto apurado, mesmo fora da conta
    assert "parcial" not in sj
    # É o mais votado do estado — e está nos mais votados, com o destino.
    assert detalhes["SP"]["mais_votados"][0] == {"cod": "10", "sqcand": 9}


def test_regras_com_qe_1003_publicam_os_pisos_em_votos() -> None:
    """RF-274: QE 1.003 → 101, 803, 201 (⌈⌉ em inteiros, nunca `round`)."""
    assert regras_da_uf(1003, 4012, 4) == {
        "quociente_eleitoral": 1003,
        "votos_validos": 4012,
        "lugares_a_preencher": 4,
        "piso_candidato": 101,
        "piso_agremiacao_sobras": 803,
        "piso_candidato_sobras": 201,
    }
    assert regras_da_uf(1000, 4000, 4)["piso_candidato"] == 100


def test_via_qp_e_sobra_na_ordem_de_ocupacao() -> None:
    """A 5.000 (QP 2), B 3.000 (QP 1), C 2.000 (QP 0): a 4ª vaga vai para C
    nas sobras. A: qp, qp · B: qp · C: sobra."""
    agrs = [
        _agr("10", "PA", [_cand(1, 3000), _cand(2, 1000), _cand(3, 500)], legenda=500),
        _agr("20", "PB", [_cand(4, 2000), _cand(5, 500), _cand(6, 400)], legenda=100),
        _agr("30", "PC", [_cand(7, 1500), _cand(8, 400)], legenda=100),
    ]
    env = _env(agrs, nv="4", te=50_000, esi=50_000)
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)])
    vias = {
        c["sqcand"]: c.get("parcial")
        for a in detalhes["SP"]["agremiacoes"]
        for c in a["candidatos"]
        if "parcial" in c
    }
    assert vias == {1: "qp", 2: "qp", 4: "qp", 7: "sobra"}


def test_ordem_e_sempre_pelo_apurado_mesmo_quando_a_projecao_inverteria() -> None:
    """X lidera o apurado (101 × 30); Y é forte numa zona com 10% das seções,
    e a projeção o põe na frente (Y 230 × X 110). O rank é o do apurado."""

    def env(te: int, esi: int, x: int, y: int) -> dict[str, Any]:
        return _env(
            [_agr("10", "PA", [_cand(1, x), _cand(2, y)]), _agr("20", "PB", [_cand(3, 60)])],
            nv="2",
            te=te,
            esi=esi,
        )

    zonas = [_zona(1, env(1000, 1000, 100, 10)), _zona(2, env(1000, 100, 1, 22))]
    uf = _uf_v2("SP", zonas, pct=55.0)
    assert uf.projecao is not None
    proj = next(a for a in uf.projecao.entrada.agremiacoes if a.cod == "10")
    assert {c.cod: c.votos_nominais for c in proj.candidatos} == {1: 110, 2: 230}
    _payload, detalhes = _publicar_e_conferir([uf])
    pa = _agr_detalhe(detalhes["SP"], "10")
    assert [(c["sqcand"], c["rank"]) for c in pa["candidatos"]] == [(1, 1), (2, 2)]


def test_rank_empatado_poe_o_valido_antes_do_sub_judice() -> None:
    """Design § 3.1: `(−votos, destino, art. 110, sqcand)` — o destino vem
    antes do `sqcand`, então o válido de sqcand MAIOR fica na frente."""
    agrs = [
        _agr(
            "10",
            "PA",
            [_cand(50, 700, dvt="Válido"), _cand(5, 700, dvt="Anulado sub judice"), _cand(6, 100, dvt="Válido")],
            legenda=0,
        ),
        _agr("20", "PB", [_cand(7, 900, dvt="Válido")]),
    ]
    env = _env(agrs, nv="2", te=5000, esi=5000)
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)])
    pa = _agr_detalhe(detalhes["SP"], "10")
    assert [(c["sqcand"], c["rank"]) for c in pa["candidatos"]] == [(50, 1), (5, 2), (6, 3)]


def test_destinos_publicados_e_percentual_do_valido_legenda() -> None:
    """Contrato congelado (design § 2.2 e o teste TS): `null` exatamente para
    anulado e sub judice; `Válido (legenda)` tem percentual."""
    agrs = [
        _agr(
            "10",
            "PA",
            [
                _cand(1, 1000, dvt="Válido"),
                _cand(2, 300, dvt="Válido (legenda)"),
                _cand(3, 200, dvt="Anulado"),
                _cand(4, 100, dvt="Anulado sub judice"),
            ],
            legenda=50,
        ),
        _agr("20", "PB", [_cand(5, 800, dvt="Válido")]),
    ]
    env = _env(agrs, nv="2", te=5000, esi=5000)
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)])
    por_sq = {c["sqcand"]: c for c in _agr_detalhe(detalhes["SP"], "10")["candidatos"]}
    assert "destino" not in por_sq[1]
    assert por_sq[2]["destino"] == "valido_legenda" and por_sq[2]["pct_validos"] is not None
    assert por_sq[3]["destino"] == "anulado" and por_sq[3]["pct_validos"] is None
    assert por_sq[4]["destino"] == "sub_judice" and por_sq[4]["pct_validos"] is None


def test_objeto_v2_mantem_os_campos_v1() -> None:
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", _mundo(14, seed=4), pct=70.0)])
    sp = detalhes["SP"]
    for chave in ("ts", "uf", "pct_apurado", "quociente_eleitoral", "divergencias", "empates_indeterminados"):
        assert chave in sp
    for agr in sp["agremiacoes"]:
        assert "eleitos" in agr and "suplentes" in agr and len(agr["suplentes"]) <= 5


def test_puxadores_do_pais_ate_30_por_excedente() -> None:
    """16 UFs com dois puxadores cada: o nacional corta em 30, pelo excedente."""
    ufs = []
    for i, sigla in enumerate(sorted(["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE"])):
        base = 1000 + 10 * i
        agrs = [
            _agr("10", "PA", [_cand(10_000 * (i + 1) + 1, base * 25), _cand(10_000 * (i + 1) + 2, base * 25 - i)]),
            _agr("20", "PB", [_cand(10_000 * (i + 1) + 3, base * 25)], legenda=base * 25),
        ]
        env = _env(agrs, nv="10", te=500_000, esi=500_000)
        ufs.append(_uf_v2(sigla, [_zona(1, env), _zona(2, env)], pct=100.0))
    payload, _detalhes = _publicar_e_conferir(ufs)
    assert len(payload["puxadores"]) == 30
    assert len(payload["mais_votados"]) == 10


# ===========================================================================
# 5. EA20 REAIS do simulado — mini-UFs com os arquivos guardados
# ===========================================================================


def _zonas_reais(uf: str, momento: str) -> list[ZonaProjecao]:
    pasta = next(p for p in (DEP / uf).iterdir() if p.is_dir() and p.name.split("-")[1] == momento)
    zonas = []
    for arq in sorted(pasta.glob(f"{uf}0*-z*.json")):
        env = _ler(arq)
        cod_zona = int(arq.name.split("-z")[1][:4])
        zonas.append(
            ZonaProjecao(
                cod_zona=cod_zona,
                te=int(str(env["e"]["te"]).replace(".", "")),
                esi=int(str(env["e"].get("esi") or 0).replace(".", "")),
                vv=int(str((env.get("v") or {}).get("vv") or 0).replace(".", "")),
                entrada=extrair_entrada_proporcional(env),
            )
        )
    return zonas


@pytest.mark.parametrize(("uf", "momento"), [("rr", "tardio"), ("ap", "inicial"), ("rr", "final"), ("ap", "tardio")])
def test_projecao_nos_ea20_reais_cumpre_o_contrato(uf: str, momento: str) -> None:
    """Os arquivos reais guardados (4 zonas por momento, 2 no final) como uma
    mini-UF: `dvt` real (sub judice, Válido (legenda)), uma zona parcial em RR
    (3107×7 a 84,6%) e uma sem boletim no AP (06025×12). Sem o agregado a
    cobertura não é avaliável e a trava libera — é a projeção que se testa."""
    zonas = _zonas_reais(uf, momento)
    ufp = _uf_v2(uf.upper(), zonas, pct=60.0)
    assert ufp.projecao_estado is not None and ufp.projecao_estado.liberada
    _payload, detalhes = _publicar_e_conferir([ufp])
    d = detalhes[uf.upper()]
    assert sum(a["cadeiras_projetadas"] for a in d["agremiacoes"]) == 8
    if momento == "final":
        # G1 real: tudo a 100% → projeção == parcial.
        for agr in d["agremiacoes"]:
            assert agr["cadeiras_projetadas"] == agr["cadeiras"]


def test_ap_real_com_o_agregado_fecha_por_cobertura_e_a_conferencia_diz_o_tamanho() -> None:
    zonas = _zonas_reais("ap", "tardio")
    agregado = _ler(DEP / "ap" / "m2-tardio-pst84" / "ap-c0006-e021272-u.json")
    ufp = _uf_v2("AP", zonas, pct=80.5, agregado=agregado)
    assert (ufp.projecao_estado.estado, ufp.projecao_estado.motivo) == ("indisponivel", "cobertura")  # type: ignore[union-attr]
    _payload, detalhes = _publicar_e_conferir([ufp])
    conf = detalhes["AP"]["conferencia"]
    assert conf["estado"] == "diverge" and "eleitorado" in conf["comparou"]
    div = next(x for x in conf["divergencias"] if x["o_que"] == "eleitorado")
    assert div["tse"] == 628_071 and div["diferenca_pct"] < 0


def test_conferencia_compara_os_eleitos_do_tse_com_a_parcial_publicada() -> None:
    """Design 026 § 2.8: `eleitos` — `nosso` = eleitos NA PARCIAL (a marca da
    tela) que o TSE não elegeu. Aqui a nossa conta sobre o agregado bate com o
    TSE, mas a parcial publicada (a soma das zonas, que perdeu uma) elegeu
    outra pessoa em C: a Conferência tem de dizer isso."""
    agregado = _env(
        [
            _agr("10", "PA", [_cand(1, 3000), _cand(2, 1000), _cand(3, 500)], legenda=500),
            _agr("20", "PB", [_cand(4, 2000), _cand(5, 500)], legenda=500),
            _agr("30", "PC", [_cand(7, 1500), _cand(8, 400)], legenda=100),
        ],
        nv="4",
        te=50_000,
        esi=50_000,
        tf="s",
        andamento="f",
    )
    agregado["carg"][0]["qe"] = "2500"
    st = {1: "Eleito por QP", 2: "Eleito por QP", 4: "Eleito por QP", 7: "Eleito por média"}
    for agr in agregado["carg"][0]["agr"]:
        for c in agr["par"][0]["cand"]:
            c["st"] = st.get(int(c["sqcand"]), "Suplente")
    # A parcial publicada: em C, o 8 à frente do 7 (outra soma de zonas).
    parcial_env = copy.deepcopy(agregado)
    parcial_env["carg"][0]["agr"][2]["par"][0]["cand"][1]["vap"] = "1600"
    parcial_env["carg"][0]["agr"][2]["par"][0]["tvtl"] = "0"
    parcial = extrair_entrada_proporcional(parcial_env)
    resultado_parcial = distribuir_cadeiras(parcial.agremiacoes, 4)
    assert [c.cod for c in resultado_parcial.eleitos["30"]] == [8]

    sem_parcial = conferir_agregado_da_uf(agregado)
    assert sem_parcial.estado == "confere"
    com_parcial = conferir_agregado_da_uf(agregado, resultado_parcial=resultado_parcial)
    assert com_parcial.estado == "diverge"
    assert [(d.o_que, d.nosso, d.tse) for d in com_parcial.divergencias] == [("eleitos", 1, 1)]
    assert com_parcial.comparou == ("algoritmo", "eleitos")


# ===========================================================================
# 6. O ciclo inteiro — `_do_project` com `projecao_dep` no corpo
# ===========================================================================


def _linha(uf: str, cod_zona: int, env: dict[str, Any], *, nivel: str | None = None) -> dict[str, Any]:
    linha = {
        "cargo": 6,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": 0 if nivel == "uf" else 70_000 + cod_zona,
        "cod_zona": 0 if nivel == "uf" else cod_zona,
        "pct_apurado": 100.0,
        "payload": env,
    }
    if nivel:
        linha["nivel"] = nivel
    return linha


@pytest.fixture
def ciclo(monkeypatch: pytest.MonkeyPatch):
    from api.model import project as proj

    logs: list[tuple[str, str, dict[str, Any]]] = []
    original = proj._log

    def _log(level: str, msg: str, **ctx: Any) -> None:
        logs.append((level, msg, ctx))
        original(level, msg, **ctx)

    monkeypatch.setattr(proj, "_log", _log)
    monkeypatch.setattr(proj, "_alert_slack", lambda *a, **k: None)

    def _rodar(snapshots: list[dict], corpo: dict[str, Any], eleitorado: dict[str, int]):
        conn = _FakeConn(snapshots, eleitorado)
        publicados: list[tuple[dict, dict]] = []
        monkeypatch.setattr(proj, "_open_conn", lambda: conn)
        monkeypatch.setattr(
            proj, "post_edge_write", lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {}))
        )
        status, _r = proj._do_project(
            json.dumps({"cargo": 6, "turno": 1, "trigger_ts": "2026-10-04T21:00:00Z", **corpo}).encode()
        )
        assert status == 200
        return publicados[0], logs

    return _rodar


def _sp_tres_zonas() -> list[dict[str, Any]]:
    """SP com 3 zonas de 20.000: duas inteiras, uma sem boletim (66,7%)."""
    linhas = []
    for cod, esi in ((1, 20_000), (2, 20_000), (3, 0)):
        k = 1 if esi else 0
        agrs = [
            _agr("10", "PA", [_cand(1, (3000 + 400 * cod) * k), _cand(2, 900 * k)], legenda=200 * k),
            _agr("20", "PB", [_cand(3, (2600 - 300 * cod) * k), _cand(4, 1100 * k)], legenda=100 * k),
            _agr("30", "PC", [_cand(5, 1500 * k), _cand(6, 300 * k)], legenda=50 * k),
        ]
        linhas.append(_linha("SP", cod, _env(agrs, nv="4", te=20_000, esi=esi, andamento="p" if k else "n")))
    return linhas


def test_ciclo_sem_projecao_dep_publica_indisponivel_por_interruptor(ciclo) -> None:
    (payload, detalhes), logs = ciclo(_sp_tres_zonas(), {}, {"SP": 60_000})
    assert detalhes["SP"]["contrato"] == 2
    assert detalhes["SP"]["projecao"]["motivo"] == "interruptor"
    assert "cadeiras_projetadas" not in json.dumps(detalhes["SP"])
    linhas_log = [ctx for _l, msg, ctx in logs if msg == "dep_projecao"]
    assert len(linhas_log) == 1
    assert linhas_log[0]["interruptor"] == {"ligada": False, "pct_minimo": 25, "origem": "ausente"}
    # O que a trava diria ligada — no log, nunca no payload.
    assert linhas_log[0]["ufs"][0]["se_ligada"] == {"estado": "liberada", "motivo": None}
    assert "se_ligada" not in json.dumps(detalhes)
    assert payload["por_uf"][0]["projecao"] == detalhes["SP"]["projecao"]


def test_ciclo_com_interruptor_ligado_libera_e_loga_a_diferenca(ciclo) -> None:
    (payload, detalhes), logs = ciclo(_sp_tres_zonas(), {"projecao_dep": {"ligada": True}}, {"SP": 60_000})
    sp = detalhes["SP"]
    assert sp["projecao"] == {"estado": "liberada", "pct_minimo": 25, "zonas_apuradas": 2, "zonas_total": 3}
    sp["divergencias"] = sp["conferencia"]["divergencias"]
    conferir_uf(sp)
    conferir_nacional(payload, detalhes)
    assert sum(a["cadeiras_projetadas"] for a in sp["agremiacoes"]) == 4
    (linha_log,) = [ctx for _l, msg, ctx in logs if msg == "dep_projecao"]
    (uf_log,) = linha_log["ufs"]
    assert uf_log["uf"] == "SP" and uf_log["estado"] == "liberada"
    assert uf_log["fracao_imputada"] == pytest.approx(1 / 3, abs=1e-5)
    assert {"cadeiras_trocadas", "eleitos_trocados", "ms"} <= set(uf_log)


def test_ciclo_pct_minimo_absurdo_nao_derruba_o_corpo(ciclo) -> None:
    """Um `Field(ge=25, le=100)` daria 400 no corpo inteiro e apagaria a
    parcial; aqui o `pct_minimo` inválido é só IGNORADO (ADR-0063 D4): a trava
    fica no piso de 25, o interruptor segue ligado como a tela o lê, e o
    ciclo avisa no log."""
    (_payload, detalhes), logs = ciclo(
        _sp_tres_zonas(), {"projecao_dep": {"ligada": True, "pct_minimo": 500}}, {"SP": 60_000}
    )
    assert detalhes["SP"]["projecao"]["estado"] == "liberada"
    assert detalhes["SP"]["projecao"]["pct_minimo"] == 25
    avisos = [(lvl, msg, c) for lvl, msg, c in logs if msg.startswith("interruptor da projeção")]
    assert len(avisos) == 1
    lvl, msg, c = avisos[0]
    assert lvl == "warn" and "pct_minimo ignorado" in msg
    assert c["aviso"] == "pct_minimo_acima_de_100_ignorado" and c["ligada"] is True


def test_ciclo_interruptor_nao_objeto_desliga_com_aviso(ciclo) -> None:
    (_payload, detalhes), logs = ciclo(_sp_tres_zonas(), {"projecao_dep": [True]}, {"SP": 60_000})
    assert detalhes["SP"]["projecao"]["motivo"] == "interruptor"
    assert any(
        msg == "interruptor da projeção de deputado malformado — desligado" for _l, msg, _c in logs
    )


def test_ciclo_erro_no_calculo_vira_indisponivel_e_a_parcial_sai(ciclo, monkeypatch: pytest.MonkeyPatch) -> None:
    from api.model import project as proj

    def _explode(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(proj, "projetar_uf", _explode)
    (_payload, detalhes), logs = ciclo(_sp_tres_zonas(), {"projecao_dep": {"ligada": True}}, {"SP": 60_000})
    assert detalhes["SP"]["projecao"]["estado"] == "indisponivel"
    assert detalhes["SP"]["projecao"]["motivo"] == "erro"
    assert sum(a["cadeiras"] for a in detalhes["SP"]["agremiacoes"]) == 4
    assert any(level == "error" and "projeção de deputado falhou" in msg for level, msg, _c in logs)


def test_ciclo_deterministico_byte_a_byte(ciclo) -> None:
    """RF-263: mesmos snapshots + mesmo interruptor ⇒ a mesma saída (só `ts`,
    a hora do cálculo, muda)."""

    def _sem_ts(publicado: tuple[dict, dict]) -> str:
        payload, detalhes = copy.deepcopy(publicado)
        payload.pop("ts")
        for d in detalhes.values():
            d.pop("ts")
        return json.dumps([payload, detalhes], sort_keys=True)

    a, _ = ciclo(_sp_tres_zonas(), {"projecao_dep": {"ligada": True}}, {"SP": 60_000})
    b, _ = ciclo(_sp_tres_zonas(), {"projecao_dep": {"ligada": True}}, {"SP": 60_000})
    assert _sem_ts(a) == _sem_ts(b)


def test_ciclo_com_agregado_de_cobertura_completa_libera_e_confere(ciclo) -> None:
    linhas = _sp_tres_zonas()
    # O agregado soma as três zonas (a terceira com zero voto).
    agregado = copy.deepcopy(linhas[0]["payload"])
    somado = combinar_entradas([extrair_entrada_proporcional(x["payload"]) for x in linhas])
    for agr in agregado["carg"][0]["agr"]:
        a = next(x for x in somado.agremiacoes if x.cod == agr["n"])
        agr["par"][0]["tvtl"] = str(a.votos_legenda)
        for c in agr["par"][0]["cand"]:
            c["vap"] = str(next(x.votos_nominais for x in a.candidatos if x.cod == int(c["sqcand"])))
    agregado["e"] = {"te": "60000", "esi": "40000"}
    agregado["v"] = {"vv": str(somado.soma_validos)}
    agregado["carg"][0]["qe"] = str(distribuir_cadeiras(somado.agremiacoes, 4).quociente_eleitoral)
    agregado["dg"], agregado["hg"] = "04/10/2026", "20:15:30"
    (payload, detalhes), _ = ciclo(
        [*linhas, _linha("SP", 0, agregado, nivel="uf")], {"projecao_dep": {"ligada": True}}, {"SP": 60_000}
    )
    sp = detalhes["SP"]
    assert sp["projecao"]["estado"] == "liberada"
    assert sp["conferencia"]["estado"] == "confere"
    assert sp["conferencia"]["comparou"] == ["eleitorado", "algoritmo"]
    assert sp["quociente_eleitoral_tse"] == sp["quociente_eleitoral"]
    sp["divergencias"] = sp["conferencia"]["divergencias"]
    conferir_uf(sp)
    conferir_nacional(payload, detalhes)


# ===========================================================================
# 7. Peso — o tamanho de 2022, com nomes no pior caso
# ===========================================================================

#: 30 caracteres (o limite do nome de urna), todos com acento: o pior caso de
#: bytes por nome — 60 B em UTF-8, 180 B escapado em `\\uXXXX`.
_NOME_PIOR_CASO = "ÁÉÍÓÚÂÊÔÃÕÇÀÜÁÉÍÓÚÂÊÔÃÕÇÀÜÁÉÍÓ"


def _ufs_de_2022(nome: str | None) -> list[UfProporcional]:
    golden = _ler(GOLDEN)["ufs"]
    ufs = []
    for sigla, dados in sorted(golden.items()):
        agrs = [
            _agr(
                a["cod"][1:],
                "REPUBLICANOS",
                [_cand(sq, v, nome=nome) for sq, v in a["candidatos"]],
                legenda=a["legenda"],
            )
            for a in dados["agremiacoes"]
        ]
        total = sum(v for a in dados["agremiacoes"] for _sq, v in a["candidatos"])
        env = _env(agrs, nv=str(dados["vagas"]), te=total * 2, esi=total * 2)
        metade = copy.deepcopy(env)
        metade["e"]["esi"] = str(total)  # a mesma zona com metade das seções
        ufs.append(_uf_v2(sigla, [_zona(1, env), _zona(2, metade)], pct=60.0, estratos=False))
    return ufs


def test_peso_do_objeto_de_sp_e_do_post_de_escrita() -> None:
    """Design 026 § 10: POST < 3,5 MB (aviso) com 4,5 MB de teto.

    Medido com o tamanho REAL de 2022 (1.429 candidaturas em SP, 71 no PL), o
    nome de urna no pior caso de bytes (30 letras acentuadas) e a sigla mais
    longa em toda linha. Medições de 29/09 (compacto, UTF-8):

    | nome            | objeto SP | lista 61+ SP | 27 objetos | POST    |
    |-----------------|-----------|--------------|------------|---------|
    | pior caso       | 281,9 KB  | 18,2 KB      | 2,48 MB    | 2,51 MB |
    | realista (16 c.)| 219,0 KB  | 14,0 KB      | 1,95 MB    | 1,98 MB |

    O design estimava ~180 KB para SP; o realista dá ~219 KB. O POST com o
    `json.dumps` padrão (ASCII escapado) dava 4,28 MB no pior caso — daí
    `corpo_edge_write` compacto. Os tetos abaixo são guarda de regressão.

    04/10 — spec 026 RF-297 (voto projetado nas "eleitos + 7"): pior caso
    288.418 B no objeto de SP (260 linhas com o campo, +6,5 KB) e POST de
    2.620.136 B. Sem a regra (campo em toda linha válida do objeto) eram
    313.864 B — passava do teto abaixo; a regra é também a do peso.
    """
    from api.model.project import AVISO_CORPO_EDGE_WRITE_BYTES, corpo_edge_write

    payload, detalhes = _publicar(_ufs_de_2022(_NOME_PIOR_CASO))
    sp = {k: v for k, v in detalhes["SP"].items() if k != "lista_restante"}
    blob_sp = len(json.dumps(sp, ensure_ascii=False, separators=(",", ":")).encode())
    corpo = len(corpo_edge_write(payload, detalhes))
    assert blob_sp < 300_000, blob_sp
    assert corpo < AVISO_CORPO_EDGE_WRITE_BYTES, corpo
    assert len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()) < 25_000
