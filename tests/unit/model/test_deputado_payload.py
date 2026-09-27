"""Do cálculo de cadeiras ao payload publicado — spec 017, design D5/D6.

O cálculo já é coberto por `test_cadeiras.py` (21 casos de borda) e pelo golden
de 2022 (511/513). O que se mede aqui é o **transporte**: o que sai do algoritmo
chega à tela com a forma certa, sem o campo que não pode atravessar a fronteira,
e sem perder a soma no caminho.

Três armadilhas específicas deste trecho, todas verificadas por mutação (quebrar
o código de propósito e conferir que o teste cai):

1. **`vagas_obtidas` vazando** (D2/RF-125.1). Testado por asserção **negativa**:
   a string não pode ocorrer no JSON serializado. A asserção positiva —
   "`cadeiras` está certo" — passaria com os dois campos publicados.
2. **Bancada sobrescrita em vez de somada.** A mesma agremiação aparece em até
   27 UFs; `dict[cod] = valor` produziria a bancada do último estado lido. É o
   modo de falha que esta base já pagou desde a migration 0006.
3. **Agregado nacional por número de urna** (D3). `compute_national` tem de
   RECUSAR o cargo proporcional — silenciar com um `if` deixaria as linhas por
   UF certas e a nacional inválida, que é o pior dos dois mundos.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import (
    combinar_entradas,
    conferir_contra_tse,
    extrair_entrada_proporcional,
)
from api.model.deputado_payload import (
    UfProporcional,
    conferir_total_de_cadeiras,
    construir_payload_deputado,
)

# ---------------------------------------------------------------------------
# Construtores de envelope EA20 — o formato real, em miniatura
# ---------------------------------------------------------------------------


def _cand(sq: int, nome: str, votos: int) -> dict[str, Any]:
    return {
        "n": str(1000 + sq),
        "sqcand": str(sq),
        "nm": f"{nome} NOME COMPLETO",
        "nmu": nome,
        "e": "n",
        "vap": str(votos),
        "pvap": "0,00",
    }


def _partido(
    numero: str, sigla: str, legenda: int, candidatos: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "n": numero,
        "sg": sigla,
        "nm": f"Partido {sigla}",
        "tvtl": str(legenda),
        "cand": candidatos,
    }


def _agr_partido(
    numero: str, sigla: str, legenda: int, candidatos: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "n": numero,
        "nm": f"Partido {sigla}",
        "tp": "i",
        "tvtl": str(legenda),
        "par": [_partido(numero, sigla, legenda, candidatos)],
    }


def _agr_federacao(
    numero: str, nome: str, partidos: list[dict[str, Any]], com: str | None = None
) -> dict[str, Any]:
    agr: dict[str, Any] = {
        "n": numero,
        "nm": nome,
        "tp": "f",
        "par": partidos,
    }
    if com is not None:
        agr["com"] = com
    return agr


def _envelope(
    agremiacoes: list[dict[str, Any]],
    *,
    nv: str | None,
    qe: str | None = None,
    tf: str = "n",
    fed: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    carg: dict[str, Any] = {"cd": "6", "agr": agremiacoes}
    if nv is not None:
        carg["nv"] = nv
    if qe is not None:
        carg["qe"] = qe
    if fed is not None:
        carg["fed"] = fed
    return {"tf": tf, "carg": [carg]}


def _uf(
    sigla: str,
    envelope: dict[str, Any],
    pct_apurado: float = 100.0,
    *,
    calcular: bool = True,
) -> UfProporcional:
    entrada = extrair_entrada_proporcional(envelope)
    resultado = None
    if calcular and entrada.lugares_a_preencher is not None:
        resultado = distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher)
    return UfProporcional(
        uf=sigla, pct_apurado=pct_apurado, entrada=entrada, resultado=resultado
    )


def _payload(ufs: list[UfProporcional], **kwargs: Any) -> tuple[dict, dict]:
    return construir_payload_deputado(
        ufs=ufs,
        divergencias_por_uf=kwargs.pop("divergencias_por_uf", {}),
        ts_iso=kwargs.pop("ts_iso", "2026-10-04T21:00:00+00:00"),
        cargo=kwargs.pop("cargo", 6),
        turno=kwargs.pop("turno", 1),
        atualizacao_min=kwargs.pop("atualizacao_min", 15),
        ufs_conhecidas=kwargs.pop("ufs_conhecidas", 27),
        pct_apurado_total=kwargs.pop("pct_apurado_total", 100.0),
        # O que sobrar vai adiante e, se não existir lá, estoura: engolir kwarg
        # desconhecido faria um teste que passa a testar outra coisa.
        **kwargs,
    )


# ---------------------------------------------------------------------------
# O cenário central — QP maior que a lista de elegíveis
# ---------------------------------------------------------------------------


def _envelope_dez_vagas() -> dict[str, Any]:
    """10 vagas, QE exato de 1.000, e um partido com quociente para 3 cadeiras
    e só 2 candidatos acima dos 10% do QE.

    É o cenário do caso de borda 2b do ADR-0027: `Σ vagas_obtidas` = 11 e
    `Σ cadeiras` = 10. Sem ele, o teste da asserção negativa não teria poder —
    num cenário em que as duas grandezas coincidem, publicar a errada passaria.

        A: 2.500 + 900 nominais + 100 legenda = 3.500  → QP 3, só 2 elegíveis
        B: 1.000 + 900 + 600 + 500            = 3.000  → QP 3, 4 candidatos
        C: 1.000 + 800 + 700                  = 2.500  → QP 2, 3 candidatos
        D:   600 + 400                        = 1.000  → QP 1, 2 candidatos
        ---------------------------------------------
        válidos = 10.000; 10 vagas; QE = 1.000
    """
    return _envelope(
        [
            _agr_partido("10", "PA", 100, [_cand(1, "ANA", 2500), _cand(2, "BRUNO", 900)]),
            _agr_partido(
                "20",
                "PB",
                0,
                [
                    _cand(3, "CARLA", 1000),
                    _cand(4, "DAVI", 900),
                    _cand(5, "ELIS", 600),
                    _cand(6, "FABIO", 500),
                ],
            ),
            _agr_partido(
                "30",
                "PC",
                0,
                [_cand(7, "GIL", 1000), _cand(8, "HELO", 800), _cand(9, "IVO", 700)],
            ),
            _agr_partido("40", "PD", 0, [_cand(10, "JOANA", 600), _cand(11, "KAIO", 400)]),
        ],
        nv="10",
    )


def test_o_cenario_distingue_cadeiras_de_vagas_obtidas() -> None:
    """Guarda do próprio cenário: se ele parar de distinguir, o teste seguinte
    vira decorativo e ninguém percebe."""
    uf = _uf("SP", _envelope_dez_vagas())
    assert uf.resultado is not None
    assert uf.resultado.quociente_eleitoral == 1000
    assert sum(uf.resultado.cadeiras.values()) == 10
    assert sum(uf.resultado.vagas_obtidas.values()) == 11, (
        "o cenário deixou de ter partido com QP acima do nº de elegíveis"
    )


def test_vagas_obtidas_nao_atravessa_a_fronteira() -> None:
    """RF-125.1 / D2 — asserção NEGATIVA sobre o payload serializado.

    Nem com esse nome nem com outro: o teste procura a string no JSON inteiro,
    e depois confere a invariante que só a grandeza certa satisfaz
    (`Σ cadeiras == lugares_a_preencher`).
    """
    uf = _uf("SP", _envelope_dez_vagas())
    payload, detalhes = _payload([uf])

    bruto_uf = json.dumps(detalhes["SP"], ensure_ascii=False)
    bruto_nacional = json.dumps(payload, ensure_ascii=False)

    assert "vagas_obtidas" not in bruto_uf
    assert "vagas_obtidas" not in bruto_nacional
    # 11 é a soma de `vagas_obtidas` neste cenário — se ela vazasse com outro
    # nome, o número apareceria onde a soma de cadeiras deveria estar.
    assert sum(a["cadeiras"] for a in detalhes["SP"]["agremiacoes"]) == 10
    assert detalhes["SP"]["lugares_a_preencher"] == 10
    assert payload["bancada"]["cadeiras_atribuidas"] == 10


def test_cadeiras_por_agremiacao_sao_as_efetivamente_ocupadas() -> None:
    """O partido com quociente para 3 e 2 candidatos elegíveis sai com **2**."""
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas())])
    por_sigla = {a["sigla"]: a for a in detalhes["SP"]["agremiacoes"]}

    assert por_sigla["PA"]["cadeiras"] == 2, "publicou o quociente, não os eleitos"
    assert por_sigla["PA"]["quociente_partidario"] == 3
    assert por_sigla["PB"]["cadeiras"] == 4
    assert por_sigla["PC"]["cadeiras"] == 3
    assert por_sigla["PD"]["cadeiras"] == 1


# ---------------------------------------------------------------------------
# RF-130 — legenda visível, nunca somada em silêncio
# ---------------------------------------------------------------------------


def test_voto_de_legenda_sai_separado_do_nominal() -> None:
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas())])
    pa = next(a for a in detalhes["SP"]["agremiacoes"] if a["sigla"] == "PA")

    assert pa["votos_nominais"] == 3400
    assert pa["votos_legenda"] == 100
    assert pa["votos_validos"] == 3500, "o total não fecha com a soma das duas partes"
    assert pa["pct_votos"] == 35.0


# ---------------------------------------------------------------------------
# RF-122 — federação é uma agremiação, com os componentes legíveis
# ---------------------------------------------------------------------------


def test_federacao_sai_com_sigla_propria_e_partidos_componentes() -> None:
    """A sigla NÃO existe em `agr[]` — vem de `carg[].fed[]` pelo mesmo número."""
    env = _envelope(
        [
            _agr_federacao(
                "99",
                "Federação Brasil da Esperança",
                [
                    _partido("13", "PT", 200, [_cand(1, "ANA", 3000)]),
                    _partido("65", "PCdoB", 100, [_cand(2, "BRUNO", 500)]),
                ],
            ),
            _agr_partido("20", "PB", 0, [_cand(3, "CARLA", 1200)]),
        ],
        nv="2",
        fed=[
            {
                "n": "99",
                "nm": "Federação Brasil da Esperança",
                "sg": "FE BRASIL",
                "com": "PT/PCdoB",
                "npar": ["13", "65"],
            }
        ],
    )
    _, detalhes = _payload([_uf("SP", env)])
    agremiacoes = detalhes["SP"]["agremiacoes"]

    fed = next(a for a in agremiacoes if a["cod"] == "99")
    assert fed["tipo"] == "federacao"
    assert fed["sigla"] == "FE BRASIL"
    assert fed["componentes"] == ["PT", "PCdoB"], "partidos componentes ilegíveis"
    assert fed["votos_validos"] == 200 + 100 + 3000 + 500, "federação não somou os par[]"

    isolado = next(a for a in agremiacoes if a["cod"] == "20")
    assert isolado["tipo"] == "partido"
    assert isolado["sigla"] == "PB"
    assert isolado["componentes"] == [], "partido isolado não tem composição a exibir"


def test_candidato_carrega_o_partido_dentro_da_federacao() -> None:
    """Numa federação, saber de qual partido é o eleito é o ponto (RF-122)."""
    env = _envelope(
        [
            _agr_federacao(
                "99",
                "Fed",
                [
                    _partido("13", "PT", 0, [_cand(1, "ANA", 3000)]),
                    _partido("65", "PCdoB", 0, [_cand(2, "BRUNO", 2000)]),
                ],
                com="PT/PCdoB",
            )
        ],
        nv="2",
    )
    _, detalhes = _payload([_uf("SP", env)])
    eleitos = detalhes["SP"]["agremiacoes"][0]["eleitos"]

    assert [e["nome"] for e in eleitos] == ["ANA", "BRUNO"]
    assert [e["partido"] for e in eleitos] == ["PT", "PCdoB"]
    assert [e["sqcand"] for e in eleitos] == [1, 2], "identidade não é o sqcand"
    assert [e["ordem"] for e in eleitos] == [1, 2]


# ---------------------------------------------------------------------------
# ADR-0024 — a federação usa a cor do partido-líder
# ---------------------------------------------------------------------------


def _federacao(numero: str, nome: str, partidos: list[tuple[str, str, int, int]]) -> dict[str, Any]:
    """Federação com `(numero, sigla, votos_nominais, legenda)` por componente."""
    return _agr_federacao(
        numero,
        nome,
        [
            _partido(num, sg, legenda, [_cand(int(num) * 100 + i, f"CAND {sg}", votos)])
            for i, (num, sg, votos, legenda) in enumerate(partidos)
        ],
        com="/".join(p[1] for p in partidos),
    )


def test_federacao_declara_o_partido_lider_para_a_tela_poder_pintar() -> None:
    """Sem este campo, toda federação cai em `--party-outros` — as maiores
    bancadas da Câmara sairiam cinza na tela principal (ADR-0024)."""
    env = _envelope(
        [_federacao("99", "Fed", [("13", "PT", 3000, 0), ("65", "PCdoB", 500, 0)])],
        nv="2",
    )
    _, detalhes = _payload([_uf("SP", env)])
    fed = detalhes["SP"]["agremiacoes"][0]

    assert fed["tipo"] == "federacao"
    assert fed["sigla_lider"] == "PT"


def test_partido_isolado_lidera_a_si_mesmo() -> None:
    """`sigla_lider == sigla` — a tela não precisa de caso especial."""
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas())])

    for agremiacao in detalhes["SP"]["agremiacoes"]:
        assert agremiacao["sigla_lider"] == agremiacao["sigla"]


def test_lider_da_federacao_e_medido_em_votos_nominais() -> None:
    """Votos nominais do componente — não contagem de candidatos, não o total
    da agremiação.

    O PT entra aqui com voto de legenda alto (9.000) e voto nominal baixo
    (1.000); o PV, com 2.000 nominais e nenhuma legenda. O líder é o PV.

    **Ressalva honesta sobre o que este teste prova.** A metade "não é legenda"
    da afirmação é um registro de decisão, não uma propriedade discriminada: o
    voto de legenda por partido componente (`par[].tvtl`) não é guardado pelo
    extrator, então nenhuma mutação do código atual consegue usá-lo. O que o
    teste de fato discrimina é o critério — trocar "soma de votos nominais" por
    "número de candidatos" o derruba, e essa é a implementação errada plausível.
    """
    env = _envelope(
        [
            _federacao(
                "99",
                "Fed",
                [("13", "PT", 1000, 9000), ("44", "PV", 2000, 0), ("65", "PCdoB", 900, 0)],
            )
        ],
        nv="2",
    )
    _, detalhes = _payload([_uf("SP", env)])

    assert detalhes["SP"]["agremiacoes"][0]["sigla_lider"] == "PV"


def test_empate_entre_componentes_desempata_por_sigla_ascendente() -> None:
    """Determinismo (constituição § 6) — e o ADR-0024 exige cor estável a noite
    inteira. Sem critério declarado, dois ciclos sobre o MESMO dado poderiam
    pintar a federação de cores diferentes."""
    env = _envelope(
        [_federacao("99", "Fed", [("13", "PT", 2000, 0), ("65", "PCdoB", 2000, 0)])],
        nv="2",
    )
    _, detalhes = _payload([_uf("SP", env)])

    assert detalhes["SP"]["agremiacoes"][0]["sigla_lider"] == "PCdoB"


def test_lider_nacional_e_a_soma_das_27_nao_a_moda_dos_estados() -> None:
    """Contar "em quantos estados cada componente lidera" daria a Roraima o
    mesmo peso de São Paulo e trocaria de resposta conforme a ordem de
    apuração — a cor mudaria no meio da noite.

    Aqui o PV lidera no AC (que apura primeiro, em ordem alfabética) e o PT
    lidera no Brasil. O líder nacional diferir do líder de uma UF é esperado.
    """
    ac = _envelope(
        [_federacao("99", "Fed", [("13", "PT", 100, 0), ("44", "PV", 300, 0)])], nv="2"
    )
    sp = _envelope(
        [_federacao("99", "Fed", [("13", "PT", 5000, 0), ("44", "PV", 200, 0)])], nv="2"
    )
    payload, detalhes = _payload([_uf("AC", ac), _uf("SP", sp)])

    assert detalhes["AC"]["agremiacoes"][0]["sigla_lider"] == "PV"
    assert detalhes["SP"]["agremiacoes"][0]["sigla_lider"] == "PT"
    assert payload["bancada"]["por_agremiacao"][0]["sigla_lider"] == "PT", (
        "o líder nacional veio de um estado em vez da soma dos 27"
    )


def test_agremiacao_sem_componente_identificavel_nao_fica_sem_lider() -> None:
    """Envelope degradado: `sigla_lider` cai na sigla da agremiação, por um
    caminho declarado — nunca string vazia."""
    env = _envelope(
        [{"n": "10", "nm": "Partido X", "tp": "i", "par": [
            {"n": "10", "cand": [_cand(1, "ANA", 500)]}]}],
        nv="1",
    )
    _, detalhes = _payload([_uf("SP", env)])
    agremiacao = detalhes["SP"]["agremiacoes"][0]

    assert agremiacao["sigla_lider"] == agremiacao["sigla"] == "Partido X"


def test_suplentes_saem_limitados_a_cinco() -> None:
    env = _envelope(
        [
            _agr_partido(
                "10",
                "PA",
                0,
                [_cand(i, f"C{i}", 1000 - i * 10) for i in range(1, 12)],
            )
        ],
        nv="2",
    )
    _, detalhes = _payload([_uf("SP", env)])
    agremiacao = detalhes["SP"]["agremiacoes"][0]

    assert agremiacao["cadeiras"] == 2
    assert len(agremiacao["suplentes"]) == 5, "a lista de suplentes não foi cortada"
    assert [s["ordem"] for s in agremiacao["suplentes"]] == [1, 2, 3, 4, 5]


# ---------------------------------------------------------------------------
# D5 — a bancada é SOMA de 27 corridas
# ---------------------------------------------------------------------------


def _envelope_simples(pa_votos: int, pb_votos: int, vagas: int = 2) -> dict[str, Any]:
    return _envelope(
        [
            _agr_partido("10", "PA", 0, [_cand(1, "ANA", pa_votos)]),
            _agr_partido("20", "PB", 0, [_cand(2, "BRUNO", pb_votos)]),
        ],
        nv=str(vagas),
    )


def test_bancada_soma_as_ufs_em_vez_de_sobrescrever() -> None:
    """A mesma agremiação aparece em 27 UFs — `dict[cod] = x` daria a última."""
    ufs = [
        _uf("SP", _envelope_simples(3000, 1000)),
        _uf("RJ", _envelope_simples(1000, 3000)),
    ]
    payload, _ = _payload(ufs)
    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}

    assert por_cod["10"]["cadeiras"] == 2, "a bancada nacional não somou as duas UFs"
    assert por_cod["20"]["cadeiras"] == 2
    assert por_cod["10"]["votos_validos"] == 4000
    assert payload["bancada"]["cadeiras_atribuidas"] == 4
    # `total_cadeiras` é 513 (fato fixo) e não 4 (a soma das duas UFs) desde
    # 2026-09-19. O que este teste mede — a bancada somada em vez de
    # sobrescrita — vive em `cadeiras_atribuidas`, acima.
    assert payload["bancada"]["total_cadeiras"] == 513


def test_bancada_ordena_por_cadeiras_e_desempata_por_sigla() -> None:
    """Determinismo (constituição § 6): ordenação com desempate declarado."""
    ufs = [
        # PB leva 2 cadeiras; PA e PC levam 1 cada (empate a desempatar).
        _uf(
            "SP",
            _envelope(
                [
                    _agr_partido("10", "PA", 0, [_cand(1, "ANA", 1000)]),
                    _agr_partido("20", "PB", 0, [_cand(2, "BRUNO", 2100), _cand(3, "CID", 1900)]),
                    _agr_partido("30", "PC", 0, [_cand(4, "DORA", 1000)]),
                ],
                nv="4",
            ),
        )
    ]
    payload, _ = _payload(ufs)
    ordem = [(a["sigla"], a["cadeiras"]) for a in payload["bancada"]["por_agremiacao"]]

    assert ordem == [("PB", 2), ("PA", 1), ("PC", 1)]


def test_ufs_aguardando_fecha_a_conta_das_27() -> None:
    """Sem esse número, o leitor conclui que sumiram cadeiras (D5)."""
    payload, _ = _payload([_uf("SP", _envelope_simples(3000, 1000))])
    bancada = payload["bancada"]

    assert bancada["ufs_calculadas"] == 1
    assert bancada["ufs_aguardando"] == 26
    assert bancada["ufs_calculadas"] + bancada["ufs_aguardando"] == 27


def test_uf_sem_nv_publicado_nao_inventa_quociente() -> None:
    """RF-124 — sem `carg[].nv` não há denominador, e chutar corrompe a UF."""
    sem_nv = _uf("AC", _envelope_simples(3000, 1000), calcular=False)
    assert sem_nv.entrada.lugares_a_preencher == 2  # sanidade do helper

    entrada_sem = extrair_entrada_proporcional(
        _envelope([_agr_partido("10", "PA", 0, [_cand(1, "ANA", 10)])], nv=None)
    )
    uf_sem = UfProporcional(uf="AC", pct_apurado=12.0, entrada=entrada_sem, resultado=None)

    payload, detalhes = _payload([uf_sem])

    assert detalhes["AC"]["lugares_a_preencher"] is None
    assert detalhes["AC"]["quociente_eleitoral"] is None
    assert detalhes["AC"]["agremiacoes"][0]["cadeiras"] == 0
    # A asserção original aqui era `total_cadeiras == 0` ("somou vaga que o TSE
    # não publicou"). Ela media a coisa certa pelo lugar errado: o total
    # nacional é fato fixo desde 2026-09-19 e não reage a `nv` ausente. O que
    # não pode aparecer é **cadeira** vinda de uma UF sem denominador.
    assert payload["bancada"]["total_cadeiras"] == 513
    assert payload["bancada"]["cadeiras_atribuidas"] == 0, (
        "distribuiu cadeira numa UF em que o TSE não publicou `carg[].nv`"
    )
    assert payload["bancada"]["ufs_calculadas"] == 0
    assert payload["por_uf"][0]["lider"] is None


def test_linha_de_uf_traz_o_lider_e_a_contagem_de_empates() -> None:
    payload, _ = _payload([_uf("SP", _envelope_dez_vagas(), pct_apurado=42.5)])
    linha = payload["por_uf"][0]

    assert linha["sigla"] == "SP"
    assert linha["pct_apurado"] == 42.5
    assert linha["lugares_a_preencher"] == 10
    assert linha["quociente_eleitoral"] == 1000
    assert linha["cadeiras_definidas"] == 10
    assert linha["vagas_nao_preenchidas"] == 0
    assert linha["empates_indeterminados"] == 0
    assert linha["lider"] == {"cod": "20", "sigla": "PB", "cadeiras": 4}


def test_cadencia_e_totais_saem_do_payload_nao_da_tela() -> None:
    """RF-128 / D8 — `15 min` e o total de cadeiras são dado, não texto no JSX."""
    payload, _ = _payload([_uf("SP", _envelope_dez_vagas())], atualizacao_min=15)

    assert payload["atualizacao_min"] == 15
    assert payload["cargo"] == 6
    assert payload["turno"] == 1
    assert payload["insights"] == []
    assert payload["composition"] == {
        "pre_election": 0.0,
        "model": 0.0,
        "actual_results": 1.0,
    }
    assert "national" not in payload, (
        "payload de Deputado não pode carregar o bloco majoritário (D1) — um "
        "consumidor de `EdgeNational` desenharia agulha e líder para a Câmara"
    )


# ---------------------------------------------------------------------------
# RF-127 — a metade que sai agora: marcar o que ainda pode mudar de dono
# ---------------------------------------------------------------------------


def _indefinidos(detalhe: dict[str, Any]) -> set[str]:
    return {
        eleito["nome"]
        for agremiacao in detalhe["agremiacoes"]
        for eleito in agremiacao["eleitos"]
        if eleito.get("indefinido")
    }


def test_cadeira_de_sobra_apertada_sai_marcada_com_apuracao_parcial() -> None:
    """Com metade dos votos por apurar, a cadeira ganha por média de 750 contra
    500 (margem de 33%) ainda pode trocar de dono — e a tela precisa dizer."""
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas(), pct_apurado=50.0)])

    # As duas cadeiras de sobra deste cenário: a 4ª de PB (DAVI... FABIO) e a
    # 3ª de PC (IVO). As de quociente partidário nunca são marcadas.
    assert _indefinidos(detalhes["SP"]) == {"FABIO", "IVO"}


def test_nada_fica_indefinido_com_a_uf_totalmente_apurada() -> None:
    """Em 100% apurado a fatia que falta é zero — firmeza deixa de ser falsa."""
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas(), pct_apurado=100.0)])
    assert _indefinidos(detalhes["SP"]) == set()


def test_margem_maior_que_a_fatia_por_apurar_nao_e_marcada() -> None:
    """A marcação é comparação, não carimbo: 90% apurado e margem de 33% não
    dá indefinido."""
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas(), pct_apurado=90.0)])
    assert _indefinidos(detalhes["SP"]) == set()


def test_totalizacao_final_encerra_a_indefinicao_mesmo_com_psa_atrasado() -> None:
    """`tf == "s"` é o TSE dizendo que não vem mais voto.

    O `s.psa` pode ficar em 99,9 por arredondamento; a totalização final é o
    fato. Marcar cadeira como indefinida depois dela contradiria o dado.
    """
    env = _envelope_dez_vagas()
    env["tf"] = "s"
    _, detalhes = _payload([_uf("SP", env, pct_apurado=50.0)])

    assert detalhes["SP"]["totalizacao_final"] is True
    assert _indefinidos(detalhes["SP"]) == set()


def test_bancada_nacional_conta_as_cadeiras_indefinidas() -> None:
    payload, _ = _payload([_uf("SP", _envelope_dez_vagas(), pct_apurado=50.0)])
    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}

    assert por_cod["20"]["cadeiras_indefinidas"] == 1
    assert por_cod["30"]["cadeiras_indefinidas"] == 1
    assert por_cod["10"]["cadeiras_indefinidas"] == 0, (
        "cadeira de quociente partidário não depende de sobra"
    )


def test_intervalo_de_cadeiras_fica_ausente_enquanto_nao_for_calculado() -> None:
    """D7 — `cadeiras_ci95` é opcional. Ausente é honesto; `[n, n]` seria falso."""
    payload, detalhes = _payload([_uf("SP", _envelope_dez_vagas())])

    assert all("cadeiras_ci95" not in a for a in payload["bancada"]["por_agremiacao"])
    assert all("cadeiras_ci95" not in a for a in detalhes["SP"]["agremiacoes"])


def test_intervalo_calculado_atravessa_para_o_payload_de_uf() -> None:
    """D6 — a faixa chega pronta de `cadeiras_bootstrap`; este módulo transporta.

    `[baixo, alto]` como lista, e não tupla: o contrato é JSON.
    """
    uf = _uf("SP", _envelope_dez_vagas())
    uf = UfProporcional(
        uf=uf.uf,
        pct_apurado=uf.pct_apurado,
        entrada=uf.entrada,
        resultado=uf.resultado,
        cadeiras_ci95={"10": (1, 3), "20": (2, 4)},
    )
    _, detalhes = _payload([uf])

    por_cod = {a["cod"]: a for a in detalhes["SP"]["agremiacoes"]}
    assert por_cod["10"]["cadeiras_ci95"] == [1, 3]
    assert por_cod["20"]["cadeiras_ci95"] == [2, 4]
    # Agremiação sem entrada no mapa sai SEM o campo — não com `[n, n]`.
    assert "cadeiras_ci95" not in por_cod["30"]
    assert "cadeiras_ci95" not in por_cod["40"]


def test_intervalo_nacional_atravessa_para_a_bancada() -> None:
    """D5 — a faixa da bancada vem agregada de fora, não somada aqui.

    Somar as faixas das 27 UFs daria a faixa errada; quem sabe agregar é
    `cadeiras_bootstrap.intervalo_nacional`, que soma réplicas.
    """
    payload, _ = _payload(
        [_uf("SP", _envelope_dez_vagas())],
        cadeiras_ci95_nacional={"10": (2, 4)},
    )

    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}
    assert por_cod["10"]["cadeiras_ci95"] == [2, 4]
    assert "cadeiras_ci95" not in por_cod["20"]


# ---------------------------------------------------------------------------
# Empate que a norma não resolve (spec 017, open question 3)
# ---------------------------------------------------------------------------


def _envelope_empatado() -> dict[str, Any]:
    """Duas agremiações idênticas em tudo que a norma usa para desempatar:
    mesma média, mesma votação total, mesma votação nominal do candidato que
    disputa a vaga (Res. 23.677 art. 11 §§ 6º–7º esgotados)."""
    return _envelope(
        [
            _agr_partido("10", "PA", 0, [_cand(1, "ANA", 400), _cand(2, "BRUNO", 100)]),
            _agr_partido("20", "PB", 0, [_cand(3, "CARLA", 400), _cand(4, "DAVI", 100)]),
        ],
        nv="3",
    )


def test_empate_indeterminado_sai_como_codigo_de_agremiacao() -> None:
    """D6 pede os códigos — a tela marca barras, não lê frase de log."""
    uf = _uf("SP", _envelope_empatado())
    assert uf.resultado is not None
    assert uf.resultado.empates_indeterminados, "o cenário deixou de empatar"

    payload, detalhes = _payload([uf])

    assert detalhes["SP"]["empates_indeterminados"] == ["10", "20"]
    assert payload["por_uf"][0]["empates_indeterminados"] == 2


# ---------------------------------------------------------------------------
# Conferência contra o próprio TSE
# ---------------------------------------------------------------------------


def test_divergencia_contra_o_tse_entra_no_payload_da_uf() -> None:
    env = _envelope_dez_vagas()
    env["carg"][0]["qe"] = "1234"  # o TSE diz outro quociente
    uf = _uf("SP", env)
    assert uf.resultado is not None
    divergencias = [
        {"o_que": d.o_que, "nosso": d.nosso, "tse": d.tse, "detalhe": d.detalhe}
        for d in conferir_contra_tse(uf.resultado, uf.entrada)
    ]

    _, detalhes = _payload([uf], divergencias_por_uf={"SP": divergencias})

    assert detalhes["SP"]["quociente_eleitoral"] == 1000
    assert detalhes["SP"]["quociente_eleitoral_tse"] == 1234
    assert detalhes["SP"]["divergencias"][0]["o_que"] == "quociente_eleitoral"
    assert detalhes["SP"]["totalizacao_final"] is False


def test_o_que_da_divergencia_sai_num_conjunto_fechado() -> None:
    """A tela mapeia `o_que` para uma frase. `cadeiras[22]` — com o código da
    agremiação embutido — geraria uma chave nova por agremiação, e a tela
    ficaria adivinhando strings nossas.
    """
    from api.model.deputado import Divergencia
    from api.model.deputado_payload import CHAVES_DE_DIVERGENCIA, normalizar_divergencia

    linha = normalizar_divergencia(
        Divergencia(o_que="cadeiras[22]", nosso=13, tse=14, detalhe="sobras ou 10%/20%")
    )

    assert linha["o_que"] == "cadeiras"
    assert linha["o_que"] in CHAVES_DE_DIVERGENCIA
    assert "22" in linha["detalhe"], "o código da agremiação sumiu do payload"
    assert linha["nosso"] == 13 and linha["tse"] == 14


def test_chave_desconhecida_passa_adiante_em_vez_de_sumir() -> None:
    """Uma comparação nova em `deputado.py` sem entrada neste mapa é melhor
    exibida sem rótulo bonito do que silenciosamente descartada."""
    from api.model.deputado import Divergencia
    from api.model.deputado_payload import normalizar_divergencia

    linha = normalizar_divergencia(Divergencia(o_que="coisa_nova", nosso=1, tse=2))
    assert linha["o_que"] == "coisa_nova"


def test_ciclo_publica_divergencia_com_chave_normalizada(ciclo_deputado) -> None:
    env = _envelope_dez_vagas()
    env["carg"][0]["agr"][0]["vag"] = "99"  # o TSE diz 99 cadeiras para PA
    _status, _resposta, publicados = ciclo_deputado([_snapshot("SP", env)])
    _payload_nac, detalhes = publicados[0]

    chaves = {d["o_que"] for d in detalhes["SP"]["divergencias"]}
    assert chaves == {"cadeiras"}, f"chave fora do conjunto fechado: {chaves}"


def test_sem_divergencia_o_campo_sai_vazio_nao_ausente() -> None:
    _, detalhes = _payload([_uf("SP", _envelope_dez_vagas())])
    assert detalhes["SP"]["divergencias"] == []


# ---------------------------------------------------------------------------
# D3 — `compute_national` recusa cargo proporcional
# ---------------------------------------------------------------------------


def test_compute_national_recusa_cargo_proporcional() -> None:
    """Recusa explícita, não `if` silencioso: agregar por número de urna no
    proporcional funde candidatos de UFs e partidos diferentes."""
    import numpy as np

    from api.model.project import CargoProporcionalError, compute_national

    estimates = {"SP": {1234: np.array([0.4, 0.5, 0.6])}}

    with pytest.raises(CargoProporcionalError):
        compute_national(
            cargo=6,
            turno=1,
            estimates_by_uf=estimates,
            eleitorado_total_by_uf={"SP": 1000},
        )


@pytest.mark.parametrize("cargo", [1, 3, 5])
def test_compute_national_continua_valendo_para_cargo_majoritario(cargo: int) -> None:
    import numpy as np

    from api.model.project import compute_national

    estimates = {
        "SP": {
            100: np.array([0.55, 0.56, 0.54]),
            200: np.array([0.45, 0.44, 0.46]),
        }
    }
    rows, _p_a, cand_a, cand_b, _outros = compute_national(
        cargo=cargo,
        turno=1,
        estimates_by_uf=estimates,
        eleitorado_total_by_uf={"SP": 1000},
    )

    assert len(rows) == 2
    assert (cand_a, cand_b) == (100, 200)


# ---------------------------------------------------------------------------
# Combinação de envelopes — soma, nunca sobrescrita
# ---------------------------------------------------------------------------


def test_duas_linhas_da_mesma_uf_somam_os_votos() -> None:
    """O modo de falha padrão desde a migration 0006: escolher uma linha de par
    e descartar as outras devolve um número menor, plausível e sem erro."""
    a = extrair_entrada_proporcional(_envelope_simples(1000, 500))
    b = extrair_entrada_proporcional(_envelope_simples(2000, 700))

    combinada = combinar_entradas([a, b])
    por_cod = {ag.cod: ag for ag in combinada.agremiacoes}

    assert por_cod["10"].votos_totais == 3000
    assert por_cod["20"].votos_totais == 1200
    assert len(por_cod["10"].candidatos) == 1, "o mesmo sqcand virou dois candidatos"
    assert por_cod["10"].candidatos[0].votos_nominais == 3000


def test_combinacao_de_uma_linha_so_devolve_a_propria_entrada() -> None:
    """O caso normal (um envelope por UF) não paga nada nem muda nada."""
    a = extrair_entrada_proporcional(_envelope_simples(1000, 500))
    assert combinar_entradas([a]) is a


def test_combinacao_nao_confere_contra_qe_parcial_do_tse() -> None:
    """`qe`/`vag` de um arquivo de zona não são conferíveis contra a conta da
    UF inteira — mantê-los acusaria divergência inexistente."""
    env = _envelope_simples(1000, 500)
    env["carg"][0]["qe"] = "700"
    env["carg"][0]["agr"][0]["vag"] = "1"
    a = extrair_entrada_proporcional(env)
    b = extrair_entrada_proporcional(env)

    combinada = combinar_entradas([a, b])

    assert combinada.quociente_eleitoral_tse is None
    assert combinada.vagas_tse == {}
    assert combinada.lugares_a_preencher == 2


# ---------------------------------------------------------------------------
# O ciclo inteiro — `_do_project` com cargo 6
# ---------------------------------------------------------------------------


#: `ts` default para linhas de fixture que não especificam um — usado só
#: quando a UF não tem conflito de família (sentinela x zona real), caso em
#: que `_discard_zero_zona_sentinel_when_real_zonas_exist` nem olha o `ts`.
#: Testes que EXERCITAM o desempate por frescor passam `"ts"` explícito e
#: distinto em cada linha da fixture — ver `test_uf_com_mais_de_uma_linha_de_zona_loga_info_nao_warn`.
_DEFAULT_TS = datetime(2026, 1, 1, tzinfo=timezone.utc)


class _FakeCursor:
    """Só as duas queries que o caminho proporcional faz. Qualquer outra é
    erro de teste — e falha alto, em vez de devolver vazio."""

    def __init__(self, conn: "_FakeConn") -> None:
        self._conn = conn
        self._rows: list[tuple] = []

    def execute(self, sql: str, params: tuple) -> None:
        self._conn.sqls.append(sql)
        if "FROM snapshots" in sql:
            # 7 colunas desde a spec 021 — `nivel` entre `cod_zona` e
            # `pct_apurado`, com default `"zona"` igual ao `COALESCE` da query
            # (mantém as fixtures pré-021 válidas; agregado declara `"nivel"`).
            cargo, turno = params
            self._rows = [
                (
                    s["uf"],
                    s.get("cod_municipio_tse", 0),
                    s["cod_zona"],
                    s.get("nivel") or "zona",
                    s["pct_apurado"],
                    s["payload"],
                    s.get("ts", _DEFAULT_TS),
                )
                for s in self._conn.snapshots
                if s["cargo"] == cargo and s["turno"] == turno
            ]
        elif "FROM eleitorado" in sql:
            if self._conn.eleitorado_quebrado:
                raise RuntimeError('relation "eleitorado" does not exist')
            # `eleitorado_zonas` existe para a guarda de sanidade do ciclo
            # proporcional, que lê por `(uf, cod_zona)` real — o default
            # continua emitindo a zona-sentinela, como os testes anteriores
            # esperam.
            if self._conn.eleitorado_zonas is not None:
                self._rows = [
                    (uf, zona, aptos)
                    for (uf, zona), aptos in self._conn.eleitorado_zonas.items()
                ]
            else:
                self._rows = [(uf, 0, aptos) for uf, aptos in self._conn.eleitorado.items()]
        else:
            raise AssertionError(f"query inesperada no caminho proporcional: {sql[:80]}")

    def fetchall(self) -> list[tuple]:
        return self._rows

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *a: Any) -> None:
        return None


class _FakeConn:
    def __init__(
        self,
        snapshots: list[dict],
        eleitorado: dict[str, int],
        eleitorado_quebrado: bool = False,
        eleitorado_zonas: dict[tuple[str, int], int] | None = None,
    ) -> None:
        self.snapshots = snapshots
        self.eleitorado = eleitorado
        self.eleitorado_quebrado = eleitorado_quebrado
        self.eleitorado_zonas = eleitorado_zonas
        self.sqls: list[str] = []

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self)

    def commit(self) -> None:  # pragma: no cover - não usado no caminho proporcional
        raise AssertionError("caminho proporcional não escreve no banco")

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None

    def __enter__(self) -> "_FakeConn":
        return self

    def __exit__(self, *a: Any) -> None:
        return None


@pytest.fixture
def ciclo_deputado(monkeypatch: pytest.MonkeyPatch):
    """Roda `_do_project` para o cargo 6 e devolve o que teria ido ao Edge."""
    from api.model import project as proj

    def _rodar(
        snapshots: list[dict],
        eleitorado: dict[str, int] | None = None,
        eleitorado_quebrado: bool = False,
        eleitorado_zonas: dict[tuple[str, int], int] | None = None,
        trigger_ts: str = "2026-10-04T21:00:00Z",
    ) -> tuple[int, dict, list[tuple[dict, dict]]]:
        # `{}` é um caso de teste (banco sem eleitorado), não "use o default" —
        # por isso o sentinel é `None`, e não a falsidade do dict.
        if eleitorado is None:
            eleitorado = {"SP": 30_000_000, "RJ": 12_000_000}
        conn = _FakeConn(snapshots, eleitorado, eleitorado_quebrado, eleitorado_zonas)
        publicados: list[tuple[dict, dict]] = []
        monkeypatch.setattr(proj, "_open_conn", lambda: conn)
        monkeypatch.setattr(
            proj,
            "post_edge_write",
            lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
        )
        status, resposta = proj._do_project(
            json.dumps(
                {"cargo": 6, "turno": 1, "trigger_ts": trigger_ts}
            ).encode()
        )
        return status, resposta, publicados

    return _rodar


def _snapshot(uf: str, envelope: dict[str, Any], pct: float = 100.0) -> dict[str, Any]:
    """Linha como a ingestão de nível `uf` grava: sentinelas em zona/município
    (`lib/tse/targets.ts::buildUfTarget`)."""
    return {
        "cargo": 6,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "pct_apurado": pct,
        "payload": envelope,
    }


def test_ciclo_do_cargo_6_publica_bancada_e_detalhe_por_uf(ciclo_deputado) -> None:
    status, resposta, publicados = ciclo_deputado(
        [
            _snapshot("SP", _envelope_dez_vagas()),
            _snapshot("RJ", _envelope_simples(3000, 1000)),
        ]
    )

    assert status == 200
    assert resposta["computed"] is True
    assert resposta["uf_count"] == 2
    assert len(publicados) == 1

    payload, detalhes = publicados[0]
    assert payload["cargo"] == 6
    # 30, não 15, desde 2026-09-13 — ver ATUALIZACAO_MIN_DEPUTADO em
    # api/model/project.py: o cargo 6 passou a ser ingerido em 6 fatias
    # disparadas a cada 5 min, e a volta completa leva 30 min.
    assert payload["atualizacao_min"] == 30
    # 513 (fato fixo), não 12 (a soma de SP+RJ): com duas UFs no ar, a soma
    # diria "12 cadeiras em disputa" na tela. Ver `cargos.TOTAL_CADEIRAS`.
    assert payload["bancada"]["total_cadeiras"] == 513
    assert payload["bancada"]["cadeiras_atribuidas"] == 12
    assert sorted(detalhes) == ["RJ", "SP"]
    assert detalhes["SP"]["uf"] == "SP"
    assert "vagas_obtidas" not in json.dumps(publicados[0], ensure_ascii=False)


def test_ciclo_do_cargo_6_publica_votacao_no_detalhe_da_uf(ciclo_deputado) -> None:
    """Spec 021 RF-192 emendado (26/09 noite) — o painel "Votação" da tela
    `/uf/[sigla]/deputado-federal` lê `DeputadoUfDetail.votacao`.

    SP tem linha agregada (`nivel = "uf"`) ⇒ `votacao` com as contagens DO
    agregado; RJ não tem ⇒ chave OMITIDA ("não sabemos", RF-198), nunca
    zeros. Nunca `corrida` (spec 022 RF-200). Sem `projetada`: o ciclo
    proporcional não calcula participação projetada, e a regra é "sem a da
    UF ⇒ aguardando", nunca emprestar outra.
    """
    agregado_sp = {
        **_snapshot("SP", {
            "e": {"te": "1000", "esi": "900", "c": "700", "a": "200"},
            "v": {"vv": "600", "vb": "40", "tvn": "30", "van": "20", "vansj": "10"},
        }),
        "nivel": "uf",
    }
    status, _resposta, publicados = ciclo_deputado(
        [
            _snapshot("SP", _envelope_dez_vagas()),
            _snapshot("RJ", _envelope_simples(3000, 1000)),
            agregado_sp,
        ]
    )
    assert status == 200
    payload, detalhes = publicados[0]

    assert detalhes["SP"]["votacao"] == {
        "contagens": {
            "aptos": 1000,
            "instalados": 900,
            "comparecimento": 700,
            "abstencao": 200,
            "validos": 600,
            "brancos": 40,
            "nulos": 30,
            "anulados": 20,
            "sub_judice": 10,
        }
    }
    assert "votacao" not in detalhes["RJ"], "UF sem agregado é 'não sabemos'"
    # O nacional segue sendo a soma dos agregados de UF (só SP aqui).
    assert payload["votacao"]["contagens"]["aptos"] == 1000
    # E o agregado não entrou no modelo: a bancada de SP é a das zonas.
    assert payload["bancada"]["cadeiras_atribuidas"] == 12


def test_construir_detalhe_omite_votacao_quando_none() -> None:
    """Chave OMITIDA, não `null` — o contrato tem dois estados, não três."""
    _nac, detalhes = _payload([_uf("RJ", _envelope_simples(3000, 1000))])
    assert "votacao" not in detalhes["RJ"]
    _nac2, detalhes2 = _payload(
        [_uf("RJ", _envelope_simples(3000, 1000))],
        votacao_by_uf={"RJ": {"contagens": {"aptos": 1}}},
    )
    assert detalhes2["RJ"]["votacao"] == {"contagens": {"aptos": 1}}


def test_uf_com_mais_de_uma_linha_de_zona_loga_info_nao_warn(
    ciclo_deputado, caplog: pytest.LogCaptureFixture
) -> None:
    """Desde 2026-09-13 (cargo 6 em granularidade zona, emenda ao ADR-0026
    item 1) mais de uma linha por UF é o caminho NORMAL — cada par
    (município, zona) chega como uma linha própria. Não pode soar como aviso
    operacional (`warn`) num caminho que agora acontece o tempo todo."""
    linha_a = {
        "cargo": 6,
        "turno": 1,
        "uf": "SP",
        "cod_municipio_tse": 71072,
        "cod_zona": 1,
        "pct_apurado": 50.0,
        "payload": _envelope_simples(1000, 500),
    }
    linha_b = {
        "cargo": 6,
        "turno": 1,
        "uf": "SP",
        "cod_municipio_tse": 12345,
        "cod_zona": 2,
        "pct_apurado": 60.0,
        "payload": _envelope_simples(2000, 700),
    }

    with caplog.at_level("INFO", logger="api.model.project"):
        status, resposta, _publicados = ciclo_deputado([linha_a, linha_b])

    assert status == 200
    assert resposta["computed"] is True

    mensagens = [r.message for r in caplog.records]
    assert any(
        "mais de uma linha (zona)" in m and '"level": "info"' in m for m in mensagens
    ), mensagens
    # O `warn` que este teste proíbe é o da GRANULARIDADE — "mais de uma linha
    # por UF" não pode soar como incidente num caminho que virou o normal.
    # Desde o ADR-0038 o ciclo também avisa quando nenhum par traz `dg`/`hg`
    # legível, e os envelopes sintéticos daqui não trazem: esse warn é sobre
    # outro assunto (o relógio do dado) e tem teste próprio em
    # `test_dado_ts.py`. Filtrar por assunto, e não afrouxar para "qualquer
    # warn serve", é o que mantém a tripwire original de pé.
    warns_de_zona = [
        m
        for m in mensagens
        if '"level": "warn"' in m and "dg/hg" not in m and "dado_ts" not in m
    ]
    assert not warns_de_zona, warns_de_zona


def test_ciclo_do_cargo_6_nao_passa_por_compute_national(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D3 — o caminho proporcional não pode nem encostar no agregado por
    número de urna. Se encostar, este teste derruba o ciclo."""
    from api.model import project as proj

    def _proibido(**kwargs: Any):  # pragma: no cover - só roda se houver bug
        raise AssertionError("cargo proporcional chegou em compute_national")

    monkeypatch.setattr(proj, "compute_national", _proibido)

    status, _resposta, publicados = ciclo_deputado([_snapshot("SP", _envelope_dez_vagas())])

    assert status == 200
    assert publicados


def test_pct_apurado_nacional_e_ponderado_e_a_uf_ausente_pesa_zero(
    ciclo_deputado,
) -> None:
    """A UF que ainda não apurou entra no DENOMINADOR com peso cheio — sem
    isso o número nacional infla justamente no começo da noite."""
    _status, _resposta, publicados = ciclo_deputado(
        [_snapshot("SP", _envelope_dez_vagas(), pct=100.0)],
        {"SP": 30_000_000, "RJ": 10_000_000},
    )
    payload, _detalhes = publicados[0]

    assert payload["pct_apurado_total"] == 75.0
    assert payload["ufs_apuradas"] == 1


def test_banco_sem_eleitorado_degrada_o_pct_sem_apagar_a_bancada(
    ciclo_deputado,
) -> None:
    """Constituição § 7 — o eleitorado só pondera um número; perdê-lo não pode
    levar as cadeiras junto."""
    status, resposta, publicados = ciclo_deputado(
        [_snapshot("SP", _envelope_dez_vagas(), pct=100.0)], {}
    )
    payload, _detalhes = publicados[0]

    assert status == 200
    assert resposta["uf_count"] == 1
    assert payload["bancada"]["cadeiras_atribuidas"] == 10
    # Média simples sobre as 27 UFs da eleição: uma apurada a 100%.
    assert payload["pct_apurado_total"] == pytest.approx(100 / 27, abs=1e-4)


def test_uf_sem_voto_ainda_fica_aguardando_sem_quociente_zero(ciclo_deputado) -> None:
    """Quociente eleitoral 0 não é quociente baixo: é a ausência dele.

    A UF que ainda não tem voto válido publica as vagas (`carg[].nv` existe
    desde antes da urna abrir) e nada mais. Contá-la como "calculada" faria
    `ufs_aguardando` mentir, e publicar `quociente_eleitoral: 0` poria um
    número falso na tela.
    """
    zerada = _envelope(
        [
            _agr_partido("10", "PA", 0, [_cand(1, "ANA", 0)]),
            _agr_partido("20", "PB", 0, [_cand(2, "BRUNO", 0)]),
        ],
        nv="8",
    )
    _status, resposta, publicados = ciclo_deputado(
        [_snapshot("SP", _envelope_dez_vagas()), _snapshot("RJ", zerada, pct=0.0)]
    )
    payload, detalhes = publicados[0]
    linha_rj = next(linha for linha in payload["por_uf"] if linha["sigla"] == "RJ")

    assert resposta["uf_count"] == 1
    assert detalhes["RJ"]["quociente_eleitoral"] is None
    assert linha_rj["lugares_a_preencher"] == 8, "as vagas publicadas continuam visíveis"
    assert linha_rj["cadeiras_definidas"] == 0
    assert linha_rj["vagas_nao_preenchidas"] == 0, (
        "vaga 'não preenchida' é a que sobrou de uma distribuição — não houve nenhuma"
    )
    assert payload["bancada"]["ufs_calculadas"] == 1
    assert payload["bancada"]["ufs_aguardando"] == 26
    assert payload["bancada"]["total_cadeiras"] == 513, (
        "o total é o tamanho da Câmara, não a soma do `nv` das UFs presentes"
    )
    assert linha_rj["lugares_a_preencher"] == 8, (
        "o `nv` POR UF continua vindo do TSE — é ele que RF-124 rege"
    )


def test_query_de_eleitorado_quebrada_nao_derruba_o_ciclo(ciclo_deputado) -> None:
    """A tabela `eleitorado` pondera um percentual. Se a query falhar, o que
    não pode acontecer é a bancada inteira sumir junto (constituição § 7)."""
    status, resposta, publicados = ciclo_deputado(
        [_snapshot("SP", _envelope_dez_vagas())], eleitorado_quebrado=True
    )
    payload, _detalhes = publicados[0]

    assert status == 200
    assert resposta["uf_count"] == 1
    assert payload["bancada"]["cadeiras_atribuidas"] == 10


def test_uf_com_coligacao_fica_fora_do_calculo_de_cadeiras(ciclo_deputado) -> None:
    """ADR-0027, caso de borda 7 — coligação proporcional é vedada desde 2020.

    Encontrar uma significa dado corrompido: distribuir cadeiras a partir dele
    publicaria uma bancada falsa com aparência normal.
    """
    env = _envelope_dez_vagas()
    env["carg"][0]["agr"].append(
        {
            "n": "77",
            "nm": "Coligação Impossível",
            "tp": "c",
            "par": [_partido("77", "PX", 0, [_cand(90, "ZEZE", 900)])],
        }
    )

    status, resposta, publicados = ciclo_deputado([_snapshot("SP", env)])
    payload, detalhes = publicados[0]

    assert status == 200
    assert resposta["uf_count"] == 0, "a UF com coligação entrou no cálculo"
    assert payload["bancada"]["cadeiras_atribuidas"] == 0
    assert payload["bancada"]["ufs_aguardando"] == 27
    assert detalhes["SP"]["quociente_eleitoral"] is None


def test_alerta_sem_slack_configurado_nao_derruba_o_ciclo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regressão de um defeito achado ao escrever o caminho proporcional.

    `_alert_slack` promete não levantar (constituição § 7), mas sem
    `SLACK_WEBHOOK_URL` ela chamava `_log(level, msg, msg=...)` — dois valores
    para o mesmo parâmetro, `TypeError`. Ou seja: em todo ambiente sem Slack,
    o primeiro alerta derrubava o ciclo que o alerta existia para reportar.
    """
    from api.model.project import _alert_slack

    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    _alert_slack("error", "mensagem de alerta", cargo=6, uf="SP")


def test_ciclo_sem_snapshot_nao_publica_payload_vazio(ciclo_deputado) -> None:
    status, resposta, publicados = ciclo_deputado([])

    assert status == 200
    assert resposta["computed"] is False
    assert resposta["uf_count"] == 0
    assert publicados == [], "publicou bancada zerada por cima da anterior"


# ---------------------------------------------------------------------------
# RF-127 — o intervalo no ciclo inteiro (ADR-0036: cargo 6 em granularidade
# zona, que é o que tornou o bootstrap possível)
# ---------------------------------------------------------------------------


def _envelope_de_zona(forte: str) -> dict[str, Any]:
    """10 vagas numa zona em que a agremiação `forte` é reduto (5× o resto).

    Zonas idênticas entre si dariam um bootstrap sem nada a medir: qualquer
    sorteio devolveria o mesmo total e a faixa fecharia no ponto. O desequilíbrio
    aqui é o que a geografia eleitoral real tem — e é o que o intervalo mede.
    """

    def v(cod: str, base: int) -> int:
        return base * 5 if cod == forte else base

    # Seis candidatos por agremiação — 18 para 10 vagas. Com lista curta as
    # vagas se esgotariam por falta de gente e o resultado deixaria de depender
    # do voto, que é o que o bootstrap mede.
    nomes = ["ANA", "BRUNO", "CARLA", "DAVI", "ELIS", "FABIO"]
    return _envelope(
        [
            _agr_partido(
                cod,
                sigla,
                v(cod, 40),
                [
                    _cand(inicio + i, f"{sigla}-{nome}", v(cod, base - i * 45))
                    for i, nome in enumerate(nomes)
                ],
            )
            for cod, sigla, inicio, base in (
                ("10", "PA", 1, 320),
                ("20", "PB", 11, 310),
                ("30", "PC", 21, 300),
            )
        ],
        nv="10",
    )


def _zonas_da_uf(uf: str, n: int, pct: float = 60.0) -> list[dict[str, Any]]:
    """`n` linhas de par (município, zona) da mesma UF — o caminho NORMAL desde
    o ADR-0036."""
    return [
        {
            "cargo": 6,
            "turno": 1,
            "uf": uf,
            "cod_municipio_tse": 70000 + j,
            "cod_zona": j + 1,
            "pct_apurado": pct,
            "payload": _envelope_de_zona(["10", "20", "30"][j % 3]),
        }
        for j in range(n)
    ]


def _faixas(payload: dict[str, Any]) -> dict[str, list[int]]:
    return {
        a["cod"]: a["cadeiras_ci95"]
        for a in payload["bancada"]["por_agremiacao"]
        if "cadeiras_ci95" in a
    }


def test_ciclo_com_zonas_publica_intervalo_de_cadeiras(ciclo_deputado) -> None:
    """RF-127 ponta a ponta: das linhas de par ao `cadeiras_ci95` dos dois payloads."""
    _, _, publicados = ciclo_deputado(_zonas_da_uf("SP", 12))
    payload, detalhes = publicados[0]

    faixas = _faixas(payload)
    assert set(faixas) == {"10", "20", "30"}

    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}
    for cod, (baixo, alto) in faixas.items():
        assert baixo <= por_cod[cod]["cadeiras"] <= alto, cod

    uf_por_cod = {a["cod"]: a for a in detalhes["SP"]["agremiacoes"]}
    for cod in faixas:
        baixo, alto = uf_por_cod[cod]["cadeiras_ci95"]
        assert baixo <= uf_por_cod[cod]["cadeiras"] <= alto, cod


def test_interruptor_de_emergencia_publica_cadeiras_sem_intervalo(
    ciclo_deputado,
) -> None:
    """`TSE_DEPUTADO_GRANULARIDADE=uf` devolve o cargo a UMA linha sentinela por
    UF (`cod_zona = 0`). Uma unidade de reamostragem dá mil réplicas idênticas —
    a faixa some do payload, e o número continua.

    É o lado que importa do limiar: sem esta guarda, acionar o interruptor
    publicaria `[n, n]` como se fosse certeza medida.
    """
    _, _, publicados = ciclo_deputado([_snapshot("SP", _envelope_de_zona("10"))])
    payload, detalhes = publicados[0]

    assert _faixas(payload) == {}
    assert all("cadeiras_ci95" not in a for a in detalhes["SP"]["agremiacoes"])
    assert payload["bancada"]["cadeiras_atribuidas"] == 10, (
        "o número tinha de continuar: só a faixa é omitida"
    )


def test_uf_com_uma_zona_so_nao_impede_a_faixa_das_outras(ciclo_deputado) -> None:
    """Começo da noite: SP com 12 zonas, RJ com uma. RJ entra na bancada como
    constante (ponto sem variância medida) e SP mantém sua faixa."""
    _, _, publicados = ciclo_deputado(_zonas_da_uf("SP", 12) + _zonas_da_uf("RJ", 1))
    payload, detalhes = publicados[0]

    assert _faixas(payload) != {}
    assert all("cadeiras_ci95" in a for a in detalhes["SP"]["agremiacoes"])
    assert all("cadeiras_ci95" not in a for a in detalhes["RJ"]["agremiacoes"])
    assert detalhes["RJ"]["agremiacoes"], "o RJ tinha de continuar publicando as cadeiras"

    # A faixa nacional cobre o ponto nacional, que já inclui as cadeiras do RJ.
    por_cod = {a["cod"]: a for a in payload["bancada"]["por_agremiacao"]}
    for cod, (baixo, alto) in _faixas(payload).items():
        assert baixo <= por_cod[cod]["cadeiras"] <= alto, cod


def test_mesmo_snapshot_e_mesmo_trigger_devolvem_o_mesmo_intervalo(
    ciclo_deputado,
) -> None:
    """Constituição § 6 — a projeção é reproduzível a partir do snapshot
    persistido e do código versionado. Uma seed não determinística passaria em
    todo o resto da suíte e cairia aqui."""
    linhas = _zonas_da_uf("SP", 12)
    _, _, primeiro = ciclo_deputado(linhas)
    _, _, segundo = ciclo_deputado(linhas)

    assert _faixas(primeiro[0][0]) == _faixas(segundo[0][0])
    assert _faixas(primeiro[0][0]) != {}


def test_cada_uf_sorteia_as_proprias_zonas(ciclo_deputado) -> None:
    """A seed é derivada de `(seed_base, UF)`, não uma só para o ciclo inteiro.

    Duas UFs com dado IDÊNTICO precisam sortear conjuntos de zonas diferentes.
    Com uma seed única as duas veriam o mesmo recorte, e a soma nacional
    contaria o mesmo erro amostral duas vezes — a faixa da bancada sairia mais
    larga do que a independência entre estados justifica.
    """
    linhas = _zonas_da_uf("SP", 12) + [
        {**linha, "uf": "RJ"} for linha in _zonas_da_uf("SP", 12)
    ]
    _, _, publicados = ciclo_deputado(linhas)
    _, detalhes = publicados[0]

    sp = {a["cod"]: tuple(a["cadeiras_ci95"]) for a in detalhes["SP"]["agremiacoes"]}
    rj = {a["cod"]: tuple(a["cadeiras_ci95"]) for a in detalhes["RJ"]["agremiacoes"]}
    assert {a["cod"]: a["cadeiras"] for a in detalhes["SP"]["agremiacoes"]} == {
        a["cod"]: a["cadeiras"] for a in detalhes["RJ"]["agremiacoes"]
    }, "as duas UFs precisam ter o MESMO ponto para o teste medir só o sorteio"
    assert sp != rj


# ---------------------------------------------------------------------------
# A guarda de sanidade está LIGADA ao ciclo proporcional (2026-09-13)
#
# Os testes unitários de `check_zona_merge_sanity` cobrem a função. Não cobrem
# o fio: mutar a chamada para fora de `_do_project_proporcional` passava nos
# 370 testes. Uma trava que ninguém verifica estar ligada é uma trava que some
# no primeiro refactor — e esta só é exercitada na noite em que importa.
# ---------------------------------------------------------------------------


def _snapshot_par(
    uf: str, cod_municipio_tse: int, cod_zona: int, envelope: dict[str, Any], te: int
) -> dict[str, Any]:
    """Linha de par (município, zona) — o que a ingestão grava desde o
    ADR-0036 — com `e.te`, que é o campo que a guarda compara."""
    payload = dict(envelope)
    payload["e"] = {"te": str(te)}
    return {
        "cargo": 6,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": cod_municipio_tse,
        "cod_zona": cod_zona,
        "pct_apurado": 100.0,
        "payload": payload,
    }


def test_ciclo_proporcional_aciona_a_guarda_quando_a_premissa_da_fatia_cai(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dois pares da MESMA zona trazendo, cada um, o eleitorado da zona
    inteira (1.000 contra 1.000 reais) — razão 2,0, o sinal de que o arquivo
    do par não traz a fatia. O ciclo tem de gritar.

    Sem isto, se a premissa do Passo 0 cair, a bancada da Câmara sai
    multiplicada por até 8× **em silêncio**, enquanto os outros três cargos
    disparam alarme.
    """
    from api.model import project as proj

    alertas: list[tuple] = []
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )

    env = _envelope_de_zona("10")
    status, _resposta, _pub = ciclo_deputado(
        [
            _snapshot_par("SP", 71072, 1, env, te=1_000),
            _snapshot_par("SP", 67016, 1, env, te=1_000),
        ],
        eleitorado_zonas={("SP", 1): 1_000},
    )

    assert status == 200, "a guarda NÃO pode abortar o ciclo (constituição § 7)"
    # Procura o alarme DESTA guarda em vez de assumir que é o primeiro: o mesmo
    # ciclo ganhou (ou vai ganhar) outros alarmes — o de dado parado, por
    # exemplo. Assumir `alertas[0]` faria este teste ficar vermelho quando
    # outro alarme legítimo disparasse antes, e alguém leria isso como "a
    # trava contra multiplicação quebrou". Ver a nota no par deste teste.
    multiplicacao = [a for a in alertas if "multiplicação" in a[1]]
    assert multiplicacao, f"a guarda não acionou o alarme — a chamada saiu do ciclo? alertas={alertas}"
    nivel, _mensagem, ctx = multiplicacao[0]
    assert nivel == "error"
    assert ctx["n_violacoes"] == 1


def test_ciclo_proporcional_fica_calado_quando_a_premissa_se_confirma(
    ciclo_deputado, monkeypatch: pytest.MonkeyPatch
) -> None:
    """O outro lado, sem o qual o teste acima passaria com uma guarda que
    grita sempre: os mesmos dois pares trazendo cada um a sua FATIA (500 +
    520 contra 1.000) não geram alarme nenhum.
    """
    from api.model import project as proj

    alertas: list[tuple] = []
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )

    env = _envelope_de_zona("10")
    status, _resposta, _pub = ciclo_deputado(
        [
            _snapshot_par("SP", 71072, 1, env, te=500),
            _snapshot_par("SP", 67016, 1, env, te=520),
        ],
        eleitorado_zonas={("SP", 1): 1_000},
    )

    assert status == 200
    # ⚠️ A asserção é sobre ESTE alarme, não sobre o silêncio do ciclo inteiro.
    # `assert not alertas` seria mais forte e **errado**: o mesmo ciclo tem
    # outros alarmes legítimos (dado parado, por exemplo), e um deles disparar
    # aqui deixaria este teste vermelho parecendo que a trava contra
    # multiplicação passou a gritar sempre. Um teste que fica vermelho pela
    # razão errada é pior que um que não existe — manda consertar o lugar
    # errado.
    multiplicacao = [a for a in alertas if "multiplicação" in a[1]]
    assert not multiplicacao, f"alarme falso com a premissa confirmada: {multiplicacao}"
# ADR-0038 — o relógio do DADO no payload do cargo 6
# ---------------------------------------------------------------------------


def _com_relogio(envelope: dict[str, Any], dg: str, hg: str) -> dict[str, Any]:
    """O mesmo envelope, com o carimbo de geração que todo EA20 real traz no
    topo (`lib/tse/ea20-schema.ts:337-338`, ambos obrigatórios)."""
    return {**envelope, "dg": dg, "hg": hg}


def test_payload_do_deputado_carrega_os_dois_relogios() -> None:
    """`ts` (hora do cálculo) e `dado_ts` (hora do boletim) convivem — é a
    diferença entre os dois que revela ingestão parada (ADR-0038 D1)."""
    from api.model.dado_ts import RelogioDoDado

    ufs = [_uf("SP", _envelope_simples(3000, 1000))]
    relogio_sp = RelogioDoDado(
        dado_ts="2026-10-04T23:15:30+00:00",
        pares_atrasados=4,
        n_pares=210,
        n_sem_campos=0,
        n_malformados=0,
    )

    payload, detalhes = _payload(
        ufs,
        ts_iso="2026-10-04T23:59:00+00:00",
        dado_ts="2026-10-04T23:15:30+00:00",
        pares_atrasados=9,
        relogio_by_uf={"SP": relogio_sp},
    )

    assert payload["ts"] == "2026-10-04T23:59:00+00:00"
    assert payload["dado_ts"] == "2026-10-04T23:15:30+00:00"
    assert payload["pares_atrasados"] == 9
    assert detalhes["SP"]["ts"] == "2026-10-04T23:59:00+00:00"
    assert detalhes["SP"]["dado_ts"] == "2026-10-04T23:15:30+00:00"
    assert detalhes["SP"]["pares_atrasados"] == 4


def test_payload_do_deputado_sem_relogio_publica_null_e_nao_copia_o_ts() -> None:
    """O `null` é um estado publicável ("hora do dado indisponível"); copiar
    `ts` no lugar dele devolveria a mentira que o ADR-0038 foi escrito para
    tirar da tela."""
    payload, detalhes = _payload(
        [_uf("SP", _envelope_simples(3000, 1000))],
        ts_iso="2026-10-04T23:59:00+00:00",
    )

    assert payload["dado_ts"] is None
    assert payload["pares_atrasados"] is None
    assert detalhes["SP"]["dado_ts"] is None
    assert detalhes["SP"]["pares_atrasados"] is None
    assert payload["ts"] == "2026-10-04T23:59:00+00:00"


def test_ciclo_do_cargo_6_publica_o_dado_ts_lido_dos_envelopes(
    ciclo_deputado,
) -> None:
    """Ponta a ponta: `dg`/`hg` de cada par entram em `fetch_snapshots`, o
    máximo vira `dado_ts` nacional e cada UF carrega o máximo DELA."""
    sp = _snapshot("SP", _com_relogio(_envelope_dez_vagas(), "04/10/2026", "20:15:30"))
    rj = _snapshot("RJ", _com_relogio(_envelope_simples(3000, 1000), "04/10/2026", "19:00:00"))

    status, _resposta, publicados = ciclo_deputado([sp, rj])
    assert status == 200

    payload, detalhes = publicados[0]
    # 20:15:30 BRT = 23:15:30 UTC — o mais recente dos dois.
    assert payload["dado_ts"] == "2026-10-04T23:15:30+00:00"
    assert payload["pares_atrasados"] == 1, "RJ está 75 min atrás do máximo"
    assert detalhes["SP"]["dado_ts"] == "2026-10-04T23:15:30+00:00"
    assert detalhes["RJ"]["dado_ts"] == "2026-10-04T22:00:00+00:00"
    # O relógio do cálculo continua sendo outro campo, com outro valor.
    assert payload["ts"] != payload["dado_ts"]


def test_ciclo_do_cargo_6_com_envelope_podado_publica_null(ciclo_deputado) -> None:
    """As fixtures sintéticas — e as do replay 2022 — não têm `dg`/`hg`. O
    ciclo roda inteiro, publica bancada, e o relógio do dado sai `null`."""
    status, resposta, publicados = ciclo_deputado(
        [_snapshot("SP", _envelope_simples(3000, 1000))]
    )

    assert status == 200
    assert resposta["computed"] is True
    payload, detalhes = publicados[0]
    assert payload["dado_ts"] is None
    assert payload["pares_atrasados"] is None
    assert detalhes["SP"]["dado_ts"] is None
    assert isinstance(payload["ts"], str), "a hora do cálculo continua publicada"


# ---------------------------------------------------------------------------
# RF-124 — o total nacional é fato fixo; a soma das UFs vira conferência
# ---------------------------------------------------------------------------
#
# O defeito que esta seção tranca (corrigido em 2026-09-19): `total_cadeiras`
# era a soma dos `lugares_a_preencher` das UFs **presentes** no ciclo, e com
# três estados pequenos apurando a tela nacional escrevia "26 cadeiras em
# disputa". O número também é o denominador do hemiciclo (ADR-0049), que abaixo
# de 24 cadeiras redesenha o plenário com menos arcos — o erro tinha o maior
# destaque visual do produto.


#: Bancada de cada UF na Câmara segundo a distribuição vigente em 2026 (LC
#: 78/1993): 27 números que somam **513**. É dado de teste, não tabela de
#: produção — o `carg[].nv` de cada UF continua vindo do TSE (RF-124). Está
#: aqui para que a conferência possa ser exercitada nos dois lados: uma soma
#: que fecha e uma que não fecha.
BANCADAS_513: dict[str, int] = {
    "SP": 70, "MG": 53, "RJ": 46, "BA": 39, "RS": 31, "PR": 30, "PE": 25,
    "CE": 22, "MA": 18, "GO": 17, "PA": 17, "SC": 16, "PB": 12, "ES": 10,
    "PI": 10, "AL": 9, "AC": 8, "AM": 8, "AP": 8, "DF": 8, "MS": 8, "MT": 8,
    "RN": 8, "RO": 8, "RR": 8, "SE": 8, "TO": 8,
}


def _ufs_das_27(bancadas: dict[str, int]) -> list[UfProporcional]:
    return [
        _uf(sigla, _envelope_simples(3000, 1000, vagas=nv))
        for sigla, nv in sorted(bancadas.items())
    ]


def test_total_de_cadeiras_e_o_tamanho_da_camara_nao_a_soma_dos_presentes() -> None:
    """Três estados pequenos no ar ⇒ 513, nunca 24.

    É a frase da tela: `{bancada.total_cadeiras} cadeiras em disputa`
    (`app/(dep)/deputado-federal/page.tsx`). Somando, ela diria "24".
    """
    ufs = [
        _uf("AC", _envelope_simples(3000, 1000, vagas=8)),
        _uf("AP", _envelope_simples(3000, 1000, vagas=8)),
        _uf("RR", _envelope_simples(3000, 1000, vagas=8)),
    ]
    payload, _ = _payload(ufs)
    bancada = payload["bancada"]

    soma_dos_presentes = sum(
        linha["lugares_a_preencher"] for linha in payload["por_uf"]
    )
    assert soma_dos_presentes == 24, "sanidade da fixture"
    assert bancada["total_cadeiras"] == 513
    assert bancada["ufs_aguardando"] == 24


def test_a_soma_das_27_que_fecha_em_513_nao_produz_divergencia() -> None:
    assert (
        conferir_total_de_cadeiras(
            ufs=_ufs_das_27(BANCADAS_513), cargo=6, ufs_conhecidas=27
        )
        is None
    )


def test_a_soma_das_27_fora_de_513_produz_divergencia() -> None:
    """RF-124, critério de aceitação: o `nv` de alguma UF diverge do TSE."""
    bancadas = {**BANCADAS_513, "SP": 71}  # 514
    divergencia = conferir_total_de_cadeiras(
        ufs=_ufs_das_27(bancadas), cargo=6, ufs_conhecidas=27
    )

    assert divergencia is not None
    assert divergencia.o_que == "total_cadeiras"
    assert divergencia.nosso == 513
    assert divergencia.tse == 514


def test_menos_de_27_ufs_nunca_produz_divergencia() -> None:
    """🔴 A metade que faz o alarme valer alguma coisa.

    Às 18h a soma é pequena e isso é o estado NORMAL. Um alarme que toca 26
    vezes no começo da noite é um alarme que ninguém olha às 21h.
    """
    for n in (1, 3, 26):
        parciais = dict(sorted(BANCADAS_513.items())[:n])
        assert sum(parciais.values()) < 513, "sanidade: a soma parcial é menor"
        assert (
            conferir_total_de_cadeiras(
                ufs=_ufs_das_27(parciais), cargo=6, ufs_conhecidas=27
            )
            is None
        ), f"alarmou com {n} UFs"


def test_uf_sem_nv_publicado_nao_conta_como_uf_presente_na_conferencia() -> None:
    """26 UFs com `nv` + 1 sem ⇒ as 27 linhas existem, a conferência não.

    Sem isto, a UF que ainda não publicou `carg[].nv` completaria a contagem de
    27 e faria a conferência alarmar por falta de dado, não por dado errado.
    """
    com_nv = _ufs_das_27(dict(sorted(BANCADAS_513.items())[:26]))
    sem_nv = UfProporcional(
        uf="TO",
        pct_apurado=0.0,
        entrada=extrair_entrada_proporcional(
            _envelope([_agr_partido("10", "PA", 0, [_cand(1, "ANA", 10)])], nv=None)
        ),
        resultado=None,
    )

    assert len(com_nv) + 1 == 27
    assert (
        conferir_total_de_cadeiras(
            ufs=[*com_nv, sem_nv], cargo=6, ufs_conhecidas=27
        )
        is None
    )


def test_ciclo_com_as_27_fora_de_513_alarma_e_nao_aborta(
    ciclo_deputado, caplog: pytest.LogCaptureFixture
) -> None:
    """Constituição § 7 — o alarme torna ruidoso, não fatal.

    O denominador suspeito é de UMA UF; apagar a bancada inteira por causa
    dele seria pior que publicá-la com ruído no log.
    """
    bancadas = {**BANCADAS_513, "SP": 71}  # 514
    snapshots = [
        _snapshot(sigla, _envelope_simples(3000, 1000, vagas=nv))
        for sigla, nv in sorted(bancadas.items())
    ]

    with caplog.at_level("INFO", logger="api.model.project"):
        status, resposta, publicados = ciclo_deputado(snapshots, {})

    assert status == 200, "o ciclo abortou por causa do alarme"
    assert resposta["computed"] is True
    payload, _detalhes = publicados[0]
    assert payload["bancada"]["total_cadeiras"] == 513

    erros = [
        m
        for m in (r.message for r in caplog.records)
        if '"level": "error"' in m and "fecha com o tamanho da casa" in m
    ]
    assert len(erros) == 1, [r.message for r in caplog.records]
    assert '"tse": 514' in erros[0]
    assert '"nosso": 513' in erros[0]

    # E o alarme foi ACIONADO, não só logado: sem `SLACK_WEBHOOK_URL` o
    # `_alert_slack` registra "slack alert skipped", que é a prova de que
    # passou por ele. Sem esta asserção, remover a chamada do alarme deixaria
    # o teste verde com o `_log` sozinho.
    assert [
        m
        for m in (r.message for r in caplog.records)
        if "slack alert skipped" in m and "RF-124" in m
    ], [r.message for r in caplog.records]


def test_ciclo_com_as_27_fechando_em_513_nao_alarma(
    ciclo_deputado, caplog: pytest.LogCaptureFixture
) -> None:
    snapshots = [
        _snapshot(sigla, _envelope_simples(3000, 1000, vagas=nv))
        for sigla, nv in sorted(BANCADAS_513.items())
    ]

    with caplog.at_level("INFO", logger="api.model.project"):
        status, _resposta, publicados = ciclo_deputado(snapshots, {})

    assert status == 200
    assert publicados[0][0]["bancada"]["total_cadeiras"] == 513
    assert not [
        m
        for m in (r.message for r in caplog.records)
        if "fecha com o tamanho da casa" in m
    ]


def test_ciclo_com_poucas_ufs_nao_alarma(
    ciclo_deputado, caplog: pytest.LogCaptureFixture
) -> None:
    """O começo da noite: 2 UFs, soma 12, e nenhum alarme."""
    with caplog.at_level("INFO", logger="api.model.project"):
        status, _resposta, publicados = ciclo_deputado(
            [
                _snapshot("SP", _envelope_dez_vagas()),
                _snapshot("RJ", _envelope_simples(3000, 1000)),
            ]
        )

    assert status == 200
    assert publicados[0][0]["bancada"]["total_cadeiras"] == 513
    assert not [
        m
        for m in (r.message for r in caplog.records)
        if "fecha com o tamanho da casa" in m
    ]
