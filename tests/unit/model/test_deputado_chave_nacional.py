"""A chave da agremiação casa as UFs na bancada nacional (2026-09-29).

## O defeito

`_bancada_nacional` (`api/model/deputado_payload.py`) reconcilia as 27 UFs
por `cod`. Até 2026-09-29 o `cod` era o `agr[].n`, sob a premissa "o PT é 13
em toda UF" (design 017 D3). O dicionário do EA20 diz outra coisa — "número da
agremiação … conforme inscrição no Sistema de Candidaturas"
(`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:674-676`) — e os
envelopes reais do simulado confirmam: RR e AP têm 21 agremiações em comum e
NENHUM `agr[].n` igual. A bancada nacional listava cada partido uma vez por
UF, sem somar cadeira nenhuma; tudo o que era chaveado por `cod` no nacional
herdava o erro.

## A régua

Os testes com dado real usam os envelopes de TOTALIZAÇÃO FINAL de RR e AP
(`tests/fixtures/tse/2026-sim/dep/<uf>/m3-final-tf/`), em que a nossa conta
fecha com o `agr[].vag` do TSE (`test_deputado_defeitos_p1.py`). O oráculo da
reconciliação é a IDENTIDADE publicada (tipo + sigla), que não passa pela
chave — assim o teste não confere a chave contra ela mesma.

Os sintéticos cobrem o que o dado real não exercita no cargo 6: o componente
de federação suprimido do `par[]` numa UF (o dicionário permite; nos
envelopes majoritários do simulado acontece em 67 de 67 federações), o
`nfed` ausente e os caminhos degradados.
"""

from __future__ import annotations

import json
import pathlib
from collections import defaultdict
from typing import Any

import pytest

from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import (
    PREFIXO_COLIGACAO,
    chave_agremiacao,
    extrair_entrada_proporcional,
)
from api.model.deputado_payload import UfProporcional, construir_payload_deputado
from api.model.deputado_projecao import EstadoProjecao

DEP = pathlib.Path(__file__).parents[2] / "fixtures" / "tse" / "2026-sim" / "dep"


def _ler_final(uf: str) -> dict[str, Any]:
    caminho = DEP / uf / "m3-final-tf" / f"{uf}-c0006-e021272-u.json"
    return json.loads(caminho.read_text())


def _uf(sigla: str, envelope: dict[str, Any]) -> UfProporcional:
    """UF calculada, no contrato v2 (sem projeção liberada) — v2 é o que faz
    o ciclo publicar `mais_votados` e `puxadores` no nacional."""
    entrada = extrair_entrada_proporcional(envelope)
    assert entrada.lugares_a_preencher is not None
    return UfProporcional(
        uf=sigla,
        pct_apurado=100.0,
        entrada=entrada,
        resultado=distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher),
        projecao_estado=EstadoProjecao(
            estado="aguardando",
            motivo="pct_minimo",
            pct_minimo=25,
            zonas_apuradas=1,
            zonas_total=10,
        ),
    )


def _nacional(ufs: list[UfProporcional]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    return construir_payload_deputado(
        ufs=ufs,
        divergencias_por_uf={},
        ts_iso="2026-10-04T23:00:00+00:00",
        cargo=6,
        turno=1,
        atualizacao_min=15,
        ufs_conhecidas=27,
        pct_apurado_total=100.0,
    )


@pytest.fixture(scope="module")
def rr_ap() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    return _nacional([_uf("RR", _ler_final("rr")), _uf("AP", _ler_final("ap"))])


# ---------------------------------------------------------------------------
# O dado real — a premissa refutada e a chave que a substitui
# ---------------------------------------------------------------------------


def test_agr_n_do_tse_nao_casa_entre_ufs_mas_o_numero_do_partido_casa() -> None:
    """A premissa, medida: por sigla, as 21 agremiações comuns a RR e AP têm
    `agr[].n` diferente em TODAS — e `par[].n` igual em todas as isoladas.
    Se um dia o TSE passar a publicar o número do partido em `agr[].n`, este
    teste falha e avisa que a premissa mudou (e nada quebra: a chave nova
    continua certa)."""

    def _por_sigla(envelope: dict[str, Any]) -> dict[str, dict[str, Any]]:
        carg = next(c for c in envelope["carg"] if str(c["cd"]) == "6")
        return {agr["com"]: agr for agr in carg["agr"]}

    rr = _por_sigla(_ler_final("rr"))
    ap = _por_sigla(_ler_final("ap"))
    comuns = sorted(set(rr) & set(ap))

    assert len(comuns) == 21
    assert [s for s in comuns if rr[s]["n"] == ap[s]["n"]] == []
    isoladas = [s for s in comuns if rr[s]["tp"] == "i"]
    assert isoladas and all(
        rr[s]["par"][0]["n"] == ap[s]["par"][0]["n"] for s in isoladas
    )


def test_chave_e_o_numero_do_partido_ou_o_da_federacao() -> None:
    e = extrair_entrada_proporcional(_ler_final("rr"))
    sigla = {cod: i.sigla for cod, i in e.identidade_agremiacoes.items()}

    # "P 9969": `agr[].n` 60140151 em RR (60138197 em AP), `par[].n` 73.
    assert sigla["73"] == "P 9969"
    # FEDERAÇÃO 9995: `agr[].n` 60139975, `par[].nfed` = `fed[].n` = 101.
    assert sigla["fed:101"] == "F 9995", "a sigla sai de fed[].sg, casada por nfed"
    assert e.identidade_agremiacoes["fed:101"].tipo == "federacao"
    assert all(not cod.startswith("6013") and not cod.startswith("6014") for cod in sigla)


def test_partido_em_duas_ufs_sai_uma_vez_no_nacional_com_as_cadeiras_somadas(rr_ap) -> None:
    payload, detalhes = rr_ap
    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}

    # P 9980: 3 cadeiras em RR + 1 em AP (o `agr[].vag` do TSE nos dois).
    p9980 = [a for a in payload["bancada"]["por_agremiacao"] if a["sigla"] == "P 9980"]
    assert len(p9980) == 1, "o mesmo partido saiu uma vez por UF"
    assert p9980[0]["cod"] == "59"
    assert p9980[0]["cadeiras"] == 4

    # P 9969 não elege ninguém; ainda assim é UMA linha, com os votos somados.
    rr_p9969 = next(a for a in detalhes["RR"]["agremiacoes"] if a["sigla"] == "P 9969")
    ap_p9969 = next(a for a in detalhes["AP"]["agremiacoes"] if a["sigla"] == "P 9969")
    assert rr_p9969["cod"] == ap_p9969["cod"] == "73"
    assert por_cod["73"]["votos_validos"] == rr_p9969["votos_validos"] + ap_p9969["votos_validos"]


def test_federacao_em_duas_ufs_sai_uma_vez_no_nacional_com_as_cadeiras_somadas(rr_ap) -> None:
    """F 9995: 3 cadeiras em RR + 1 em AP. F 9996 é o caso que pega a chave
    "primeiro componente": o `par[]` vem 69, 84 em RR e 84, 69 em AP."""
    payload, _ = rr_ap
    federacoes = {
        a["sigla"]: a for a in payload["bancada"]["por_agremiacao"] if a["tipo"] == "federacao"
    }
    assert sorted(federacoes) == sorted(
        ["F 9995", "F 9996", 'Federacao teste para string longa especiais 99!@#$"TSE"']
    ), "federação duplicada (ou perdida) no nacional"
    assert federacoes["F 9995"]["cod"] == "fed:101"
    assert federacoes["F 9995"]["cadeiras"] == 4
    assert federacoes["F 9995"]["componentes"] == ["P 9984", "P 9992", "P 9999"]
    assert federacoes["F 9995"]["sigla_lider"] in federacoes["F 9995"]["componentes"]
    assert federacoes["F 9996"]["cod"] == "fed:100"
    assert federacoes["F 9996"]["cadeiras"] == 1


def test_bancada_nacional_bate_linha_a_linha_com_a_soma_das_ufs_por_identidade(rr_ap) -> None:
    """Oráculo independente da chave: agrupa as linhas das UFs por (tipo,
    sigla) e exige exatamente uma linha nacional por grupo, com cadeiras e
    votos somados."""
    payload, detalhes = rr_ap
    esperado: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"cadeiras": 0, "votos_nominais": 0, "votos_legenda": 0, "votos_validos": 0}
    )
    for detalhe in detalhes.values():
        for a in detalhe["agremiacoes"]:
            soma = esperado[(a["tipo"], a["sigla"])]
            for campo in soma:
                soma[campo] += a[campo]

    nacional = payload["bancada"]["por_agremiacao"]
    obtido = {
        (a["tipo"], a["sigla"]): {campo: a[campo] for campo in esperado[(a["tipo"], a["sigla"])]}
        for a in nacional
    }
    assert len(nacional) == len(esperado) == 25  # 24 em RR + 22 em AP − 21 comuns
    assert obtido == dict(esperado)


def test_soma_das_cadeiras_nacionais_e_a_soma_das_ufs(rr_ap) -> None:
    payload, detalhes = rr_ap
    por_uf = sum(a["cadeiras"] for d in detalhes.values() for a in d["agremiacoes"])
    nacional = sum(a["cadeiras"] for a in payload["bancada"]["por_agremiacao"])
    assert por_uf == nacional == payload["bancada"]["cadeiras_atribuidas"] == 16


def test_referencias_nacionais_resolvem_contra_a_bancada(rr_ap) -> None:
    """`mais_votados[].cod`, `puxadores[].cod` e `por_uf[].lider.cod` apontam
    para uma linha de `bancada.por_agremiacao` — e para a certa (mesma sigla)."""
    payload, _ = rr_ap
    sigla_por_cod = {a["cod"]: a["sigla"] for a in payload["bancada"]["por_agremiacao"]}

    assert len(payload["mais_votados"]) == 10
    assert payload["puxadores"], "sem puxador o teste abaixo seria vazio"
    for destaque in payload["mais_votados"] + payload["puxadores"]:
        assert sigla_por_cod.get(destaque["cod"]) == destaque["sigla"], destaque
    lideres = [linha["lider"] for linha in payload["por_uf"] if linha["lider"] is not None]
    assert len(lideres) == 2
    for lider in lideres:
        assert sigla_por_cod.get(lider["cod"]) == lider["sigla"], lider


# ---------------------------------------------------------------------------
# Sintéticos — o que o cargo 6 real não exercita
# ---------------------------------------------------------------------------


def _cand(sq: int, votos: int) -> dict[str, Any]:
    return {"n": str(1000 + sq), "sqcand": str(sq), "nmu": f"C{sq}", "e": "n", "vap": str(votos)}


def _par(numero: str, sigla: str, cands: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"n": numero, "sg": sigla, "nm": f"Partido {sigla}", "tvtl": "0", "cand": cands, **extra}


def _envelope(agrs: list[dict[str, Any]], *, nv: str, fed: list[dict[str, Any]] | None = None):
    carg: dict[str, Any] = {"cd": "6", "nv": nv, "agr": agrs}
    if fed is not None:
        carg["fed"] = fed
    return {"tf": "s", "carg": [carg]}


_FED_101 = {"n": "101", "nm": "Federação X", "sg": "PT/PC do B/PV", "npar": ["13", "43", "65"]}


def test_federacao_com_componente_suprimido_numa_uf_continua_uma_so() -> None:
    """O dicionário permite suprimir o `par[]` do partido sem candidato. Em SP
    a federação vem com 13 e 65; em MG, só com 65. Chave por lista de
    componentes (ou pelo primeiro) daria duas federações no nacional."""
    sp = _envelope(
        [
            {"n": "250001800310", "nm": "Federação X", "tp": "f", "par": [
                _par("13", "PT", [_cand(1, 900)], nfed="101"),
                _par("65", "PC do B", [_cand(2, 300)], nfed="101"),
            ]},
            {"n": "250001800999", "nm": "Partido Y", "tp": "i", "par": [
                _par("22", "PY", [_cand(3, 400)]),
            ]},
        ],
        nv="2",
        fed=[_FED_101],
    )
    mg = _envelope(
        [
            {"n": "130001800273", "nm": "Federação X", "tp": "f", "par": [
                _par("65", "PC do B", [_cand(4, 800)], nfed="101"),
            ]},
            {"n": "130001800888", "nm": "Partido Y", "tp": "i", "par": [
                _par("22", "PY", [_cand(5, 700)]),
            ]},
        ],
        nv="2",
        fed=[_FED_101],
    )
    payload, detalhes = _nacional([_uf("SP", sp), _uf("MG", mg)])

    assert {a["cod"] for a in detalhes["SP"]["agremiacoes"]} == {"fed:101", "22"}
    assert {a["cod"] for a in detalhes["MG"]["agremiacoes"]} == {"fed:101", "22"}
    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}
    assert sorted(por_cod) == ["22", "fed:101"]
    assert por_cod["fed:101"]["cadeiras"] + por_cod["22"]["cadeiras"] == 4
    assert por_cod["fed:101"]["votos_validos"] == 900 + 300 + 800
    assert por_cod["fed:101"]["sigla"] == "PT/PC do B/PV"


def test_federacao_sem_nfed_resolve_pelo_npar_do_dicionario() -> None:
    agr = {"n": "999", "tp": "f", "par": [_par("43", "PV", [])]}
    assert chave_agremiacao(agr, {"101": _FED_101}) == "fed:101"


def test_federacao_sem_como_resolver_cai_no_agr_n_declarado() -> None:
    """Sem `nfed` e sem `fed[]` que case sem ambiguidade, a chave degrada
    para o `agr[].n` — certo dentro da UF, separado no nacional. Nunca uma
    escolha entre números."""
    sem_nada = {"n": "999", "tp": "f", "par": [_par("43", "PV", [])]}
    assert chave_agremiacao(sem_nada, {}) == "999"

    contraditoria = {"n": "999", "tp": "f", "par": [
        _par("13", "PT", [], nfed="101"),
        _par("43", "PV", [], nfed="102"),
    ]}
    assert chave_agremiacao(contraditoria, {}) == "999"

    duas_casam = {"n": "999", "tp": "f", "par": [_par("43", "PV", [])]}
    outra = {"n": "102", "npar": ["43", "50"]}
    assert chave_agremiacao(duas_casam, {"101": _FED_101, "102": outra}) == "999"


def test_partido_isolado_sem_par_cai_no_agr_n() -> None:
    assert chave_agremiacao({"n": "60140151", "tp": "i"}, {}) == "60140151"
    assert chave_agremiacao({"n": "60140151", "tp": "i", "par": [_par("73", "P", [])]}, {}) == "73"


def test_coligacao_e_agremiacao_sem_numero_seguem_como_antes() -> None:
    assert chave_agremiacao({"n": "77", "tp": "c", "par": [_par("30", "PC", [])]}, {}) == (
        f"{PREFIXO_COLIGACAO}77"
    )
    assert chave_agremiacao({"tp": "i", "par": [_par("30", "PC", [])]}, {}) is None
