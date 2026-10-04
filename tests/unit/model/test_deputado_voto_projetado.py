"""Spec 026 RF-297 — voto projetado por candidatura no Deputado Federal.

Decisão do dono (04/10/2026), emenda do ADR-0063 D1: o voto que a projeção
calcula para cada candidatura (`ProjecaoUf.entrada`) passa a ser publicado nas
linhas do objeto da UF — só nas "eleitos + 7" (marcadas na parcial ou na
projeção + as 7 primeiras válidas sem marca, por rank), só com a trava
`liberada`, só no cargo 6 e NUNCA na lista 61+ (servida crua pela rota, que não
lê o interruptor — RF-265). A ordem nunca muda (ADR-0063 D5).

As invariantes do contrato (`_contrato_deputado_v2.conferir_uf`) conferem a
regra inteira em todo payload montado por `_publicar_e_conferir`; os testes
daqui fixam os casos de borda que ela sozinha não força a existir.
"""

from __future__ import annotations

import copy
import json
from typing import Any

from api.model.deputado_payload import (
    NAO_ELEITOS_COM_VOTO_PROJETADO,
    POSICOES_NO_BLOB,
    construir_detalhe_uf,
)
from api.model.deputado_projecao import DESLIGADO, ZonaProjecao
from tests.unit.model._contrato_deputado_v2 import linhas_de
from tests.unit.model.test_deputado_projecao import (
    _agr,
    _agr_detalhe,
    _cand,
    _env,
    _mundo,
    _publicar,
    _publicar_e_conferir,
    _uf_v2,
    _zona,
)


def _com_campo(detalhe: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        linha
        for agr in detalhe["agremiacoes"]
        for linha in agr["candidatos"]
        if "votos_projetados" in linha
    ]


def _parcial_de(zonas: list[ZonaProjecao]) -> list[ZonaProjecao]:
    """Um terço das zonas sem boletim — a projeção imputa, e difere do apurado."""
    return [z if z.cod_zona % 3 else ZonaProjecao(z.cod_zona, z.te, 0, 0, z.entrada) for z in zonas]


def test_constante_e_a_decisao_do_dono() -> None:
    assert NAO_ELEITOS_COM_VOTO_PROJETADO == 7


def test_voto_projetado_so_sai_com_a_trava_liberada() -> None:
    parcial = _parcial_de(_mundo(14, seed=5))
    _payload, detalhes = _publicar_e_conferir(
        [
            _uf_v2("SP", parcial, pct=60.0),
            _uf_v2("RJ", parcial, pct=10.0),
            _uf_v2("MG", parcial, pct=60.0, interruptor=DESLIGADO),
        ]
    )
    assert detalhes["SP"]["projecao"]["estado"] == "liberada"
    assert _com_campo(detalhes["SP"]), "SP liberada sem nenhum voto projetado"
    assert _com_campo(detalhes["RJ"]) == []
    assert _com_campo(detalhes["MG"]) == []
    assert "votos_projetados" not in json.dumps(detalhes["RJ"]["agremiacoes"][0]["candidatos"])


def test_voto_projetado_e_o_da_conta_da_projecao_e_difere_do_apurado() -> None:
    zonas = _parcial_de(_mundo(14, seed=5))
    uf = _uf_v2("SP", zonas, pct=60.0)
    assert uf.projecao is not None
    proj = {c.cod: c.votos_nominais for a in uf.projecao.entrada.agremiacoes for c in a.candidatos}
    _payload, detalhes = _publicar_e_conferir([uf])
    linhas = _com_campo(detalhes["SP"])
    assert all(linha["votos_projetados"] == proj[linha["sqcand"]] for linha in linhas)
    # A projeção imputou zonas sem boletim: o voto projetado é maior que o apurado.
    assert any(linha["votos_projetados"] > linha["votos"] for linha in linhas)


def test_eleitos_mais_sete_por_agremiacao() -> None:
    """4 vagas, uma agremiação com 20 candidatos: as marcadas + exatamente 7."""
    cands = [_cand(1000 + j, 5000 - 100 * j) for j in range(20)]
    outros = [_cand(9000 + j, 3000 - 100 * j) for j in range(3)]
    env = _env(
        [_agr("22", "PL", cands, legenda=500), _agr("13", "PT", outros, legenda=100)],
        nv="4",
        te=900_000,
        esi=900_000,
    )
    _payload, detalhes = _publicar_e_conferir(
        [_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)]
    )
    pl = _agr_detalhe(detalhes["SP"], "22")
    marcadas = [c for c in pl["candidatos"] if "parcial" in c or "projecao" in c]
    com = [c for c in pl["candidatos"] if "votos_projetados" in c]
    assert len(marcadas) >= 1
    assert len(com) == len(marcadas) + 7
    # As que têm o número são um prefixo do rank — nunca pula para o voto projetado.
    assert [c["rank"] for c in com] == list(range(1, len(com) + 1))
    # A 8ª sem marca não tem.
    assert "votos_projetados" not in next(c for c in pl["candidatos"] if c["rank"] == len(com) + 1)


def test_nunca_na_lista_61_mais() -> None:
    """71 candidatos, 8 vagas: a lista 61+ existe e nenhuma linha dela leva o campo."""
    cands = [_cand(1000 + j, 5000 - 60 * j) for j in range(71)]
    env = _env([_agr("22", "PL", cands, legenda=500)], nv="8", te=900_000, esi=900_000)
    _payload, detalhes = _publicar_e_conferir(
        [_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)]
    )
    sp = detalhes["SP"]
    restante = [c for b in sp["lista_restante"] for c in b["candidatos"]]
    assert restante and all(c["rank"] > POSICOES_NO_BLOB for c in restante)
    assert "votos_projetados" not in json.dumps(sp["lista_restante"])
    assert len(_com_campo(sp)) == 8 + 7


def test_nunca_na_lista_61_mais_mesmo_quando_a_regra_alcancaria() -> None:
    """60 marcadas no topo da agremiação? Não — mas 7 sem marca podem cair em 61+
    quando a agremiação tem poucas linhas fora do corte no objeto. Força: 66
    vagas num PL de 71, as 5 restantes sem marca ficam nos ranks 67–71 e entram
    na regra; só as que estão no OBJETO levam o número."""
    cands = [_cand(1000 + j, 5000 - 60 * j) for j in range(71)]
    env = _env([_agr("22", "PL", cands, legenda=500)], nv="66", te=900_000, esi=900_000)
    _payload, detalhes = _publicar_e_conferir(
        [_uf_v2("SP", [_zona(1, env), _zona(2, env)], pct=100.0)]
    )
    sp = detalhes["SP"]
    assert "votos_projetados" not in json.dumps(sp.get("lista_restante", []))


def test_a_100_por_cento_o_projetado_e_o_apurado() -> None:
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", _mundo(14, seed=9), pct=100.0)])
    linhas = _com_campo(detalhes["SP"])
    assert linhas
    assert all(linha["votos_projetados"] == linha["votos"] for linha in linhas)


def test_ordem_e_rank_nao_mudam_com_o_voto_projetado() -> None:
    """ADR-0063 D5: o rank é o do apurado, mesmo quando o projetado inverteria."""
    _payload, detalhes = _publicar_e_conferir([_uf_v2("SP", _parcial_de(_mundo(14, seed=3)), pct=60.0)])
    for agr in detalhes["SP"]["agremiacoes"]:
        linhas = linhas_de(detalhes["SP"], agr)
        assert [linha["rank"] for linha in linhas] == list(range(1, len(linhas) + 1))
        votos = [linha["votos"] for linha in linhas]
        assert votos == sorted(votos, reverse=True)


def test_determinismo_duas_execucoes_mesmo_json() -> None:
    zonas = _parcial_de(_mundo(14, seed=7))
    a = _publicar([_uf_v2("SP", copy.deepcopy(zonas), pct=60.0)])
    b = _publicar([_uf_v2("SP", copy.deepcopy(zonas), pct=60.0)])
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert _com_campo(a[1]["SP"])


def test_so_no_cargo_6() -> None:
    """Estadual/Distrital: fora (spec 027 não tem projeção; decisão do dono)."""
    uf = _uf_v2("SP", _parcial_de(_mundo(14, seed=5)), pct=60.0)
    assert uf.projecao is not None
    kw: dict[str, Any] = {"dados": uf, "ts_iso": "2026-10-04T23:00:00+00:00", "turno": 1, "divergencias": []}
    federal = construir_detalhe_uf(cargo=6, **kw)
    estadual = construir_detalhe_uf(cargo=7, **kw)
    assert _com_campo(federal)
    assert _com_campo(estadual) == []


def test_mais_votados_nacional_nao_leva_o_voto_projetado() -> None:
    payload, _detalhes = _publicar_e_conferir([_uf_v2("SP", _parcial_de(_mundo(14, seed=5)), pct=60.0)])
    assert "votos_projetados" not in json.dumps(payload["mais_votados"])
    assert "votos_projetados" not in json.dumps(payload.get("puxadores", []))


# ---------------------------------------------------------------------------
# Emenda 04/10 — o corte é o do visível por padrão: maior rank marcado + 7
# ---------------------------------------------------------------------------


def _linha(rank: int, *, parcial: bool = False, projecao: bool = False, destino: str | None = None):
    from api.model.deputado_payload import _Linha

    return _Linha(
        sqcand=1000 + rank,
        votos=100_000 - rank,
        valido=destino is None,
        destino=destino,
        desconhecido=False,
        nascimento=None,
        rank=rank,
        parcial="qp" if parcial else None,
        projecao="qp" if projecao else None,
    )


def test_visivel_e_o_maior_rank_marcado_mais_sete() -> None:
    from api.model.deputado_payload import VISIVEIS_ABAIXO_DO_CORTE, _ultimo_rank_visivel

    assert VISIVEIS_ABAIXO_DO_CORTE == 7
    assert _ultimo_rank_visivel([_linha(r) for r in range(1, 61)]) == 7
    assert _ultimo_rank_visivel([_linha(r, parcial=r == 1) for r in range(1, 61)]) == 8
    # Projeção elege o 12º sem o 11º (o caso de MG/PT no simulado): conta do 12º.
    linhas = [_linha(r, parcial=r <= 10, projecao=r <= 10 or r == 12) for r in range(1, 61)]
    assert _ultimo_rank_visivel(linhas) == 19
    # Linha com destino ocupa uma das 7 posições (a tela as mostra).
    linhas = [_linha(r, parcial=r <= 3, destino="anulado" if r == 5 else None) for r in range(1, 61)]
    assert _ultimo_rank_visivel(linhas) == 10
