"""ADR-0053 / spec 002 RF-213 — o destino do voto CHEGA À TELA.

`test_destino_do_voto_decisao.py` prova que o modelo tira a candidatura de
voto anulado das DECISÕES. Este arquivo prova a outra metade: a tela deriva
líder, ordem e cor por conta própria a partir das listas, e só sabe quem é
anulado se o payload disser. O contrato (`lib/edge-config/types.ts`):

  - `EdgeCandidate.destino?`      — `national.candidatos[]`;
  - `EdgeUfCandidate.destino?`    — `EdgePayloadUf.candidatos[]`;
  - `EdgeUfRow.top_candidatos[].destino?`.

Ausente ⇒ a tela trata como "compete". Por isso a regra de ouro: `destino` só
sai quando o mapa de `montar_destino_por_candidatura` o conhece — nunca um
default — e sai do MESMO mapa que decidiu (decisão e etiqueta não discordam).

E, desde 2026-09-27, só sai quando é `"anulado"` ou `"sub_judice"`: `"valido"`
equivale a ausente para a tela e custava 19 B por candidatura, o que derrubava
a folga de 2× do payload nacional. `votacao.corrida[]` NÃO segue esta regra.

Escopo:
  - Presidente: destino NACIONAL, inclusive nas listas por UF;
  - Governador/Senador: o da UF; no bloco nacional, NADA — ali o número de
    urna é a união de 27 corridas (a mesma razão de RF-145 não pôr nome).

E o líder de cada MUNICÍPIO (a cor do mapa) pula a anulada; sub judice compete.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.model import project as proj
from tests.unit.model.test_destino_do_voto_decisao import (
    ANUL,
    ANULADO,
    LIDER,
    SUB_JUDICE,
    SUBJ,
    VALIDO,
    X,
    Y,
    _cand,
    _cenario,
    _dvt_fixo,
    _por_uf,
    _rodar,
    _sem_dvt,
)

_SHARES = {LIDER: 0.40, ANUL: 0.30, X: 0.15, SUBJ: 0.10, Y: 0.05}
_DVT_PRES = {ANUL: ANULADO, SUBJ: SUB_JUDICE, LIDER: VALIDO, X: VALIDO, Y: VALIDO}


def _achar_destinos(obj: Any, caminho: str = "") -> list[str]:
    """Todo caminho do JSON que carrega a chave `destino`, fora de `votacao`
    (lá o `dvt` É o dado exibido pela spec 022, e existe por construção)."""
    achados: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "votacao":
                continue
            if k == "destino":
                achados.append(caminho)
            achados.extend(_achar_destinos(v, f"{caminho}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            achados.extend(_achar_destinos(v, f"{caminho}[{i}]"))
    return achados


def _top(linha: dict[str, Any], cid: int) -> dict[str, Any]:
    return next(t for t in linha["top_candidatos"] if t["id"] == cid)


def _uf_cand(body: dict[str, Any], sigla: str, cid: int) -> dict[str, Any]:
    return next(c for c in body["payloads_uf"][sigla]["candidatos"] if c["id"] == cid)


# ---------------------------------------------------------------------------
# Presidente — destino nacional, nos três lugares
# ---------------------------------------------------------------------------


def test_presidente_destino_nos_tres_lugares(monkeypatch) -> None:
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, _dvt_fixo(_DVT_PRES), cargo=1)
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    nat = body["payload"]["national"]
    # `"valido"` NÃO é emitido nas listas (2026-09-27) — `None` = chave ausente.
    esperado = {ANUL: "anulado", SUBJ: "sub_judice", LIDER: None, X: None, Y: None}

    for cid, destino in esperado.items():
        assert _cand(nat, cid).get("destino", None) == destino, cid
    for sigla in ("SP", "RJ"):
        linha = _por_uf(body["payload"], sigla)
        for t in linha["top_candidatos"]:
            assert t.get("destino", None) == esperado[t["id"]], (sigla, t["id"])
        for cid, destino in esperado.items():
            assert _uf_cand(body, sigla, cid).get("destino", None) == destino, (sigla, cid)
    # ...mas a `votacao.corrida[]` segue dizendo `"valido"` (spec 022): lá ele
    # se distingue de "o TSE ainda não publicou".
    corrida = {e["id"]: e.get("destino") for e in body["payload"]["votacao"]["corrida"]}
    assert corrida[LIDER] == "valido"

    # A anulada CONTINUA na lista (a tela é quem a leva para o fim), e o
    # rank/percentual dela não mudam — `rank` 2 pela projeção.
    assert _cand(nat, ANUL)["rank"] == 2
    assert _cand(nat, ANUL)["pct_projetado"] == pytest.approx(30.0, abs=0.5)
    assert _top(_por_uf(body["payload"], "SP"), ANUL)["pct"] == pytest.approx(30.0, abs=0.5)


def test_presidente_lista_da_uf_usa_o_destino_nacional_e_nao_o_da_uf(monkeypatch) -> None:
    """ANUL anulado em SP e válido no RJ: para Presidente é UMA candidatura, e
    os arquivos divergem ⇒ o destino nacional não existe ⇒ nenhuma lista, nem
    a de SP (onde o `("SP", ANUL)` é conhecido), pode etiquetá-la. É o que
    discrimina "escopo nacional" de "escopo da UF" no cargo 1."""

    def dvt(uf, _zona, cod):
        if cod == ANUL:
            return VALIDO if uf == "RJ" else ANULADO
        if cod == SUBJ:
            return SUB_JUDICE
        return VALIDO

    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, dvt, cargo=1)
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    assert "destino" not in _cand(body["payload"]["national"], ANUL)
    for sigla in ("SP", "RJ"):
        assert "destino" not in _top(_por_uf(body["payload"], sigla), ANUL)
        assert "destino" not in _uf_cand(body, sigla, ANUL)
        # as outras, coerentes em todo arquivo, seguem etiquetadas (a
        # válida não leva etiqueta desde 2026-09-27; a sub judice, sim).
        assert _uf_cand(body, sigla, SUBJ)["destino"] == "sub_judice"
        assert "destino" not in _uf_cand(body, sigla, LIDER)


# ---------------------------------------------------------------------------
# Ausência — nunca default
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("cargo", "vpe"), [(1, 1), (3, 1), (5, 2)])
def test_sem_dvt_nenhum_destino_em_lugar_nenhum(monkeypatch, cargo, vpe) -> None:
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, _sem_dvt, cargo=cargo, vpe=vpe)
    body = _rodar(monkeypatch, snaps, eleit, cargo=cargo)
    assert _achar_destinos(body) == []


@pytest.mark.parametrize(("cargo", "vpe"), [(1, 1), (3, 1), (5, 2)])
def test_sem_dvt_payload_identico_ao_de_antes(monkeypatch, cargo, vpe) -> None:
    """Payload INTEIRO (nacional + UFs, `votacao` inclusive) igual ao do ciclo
    com a maquinaria de destino desligada — isto é, ao de antes do RF-213."""
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, _sem_dvt, cargo=cargo, vpe=vpe)
    atual = _rodar(monkeypatch, snaps, eleit, cargo=cargo)
    monkeypatch.setattr(proj, "montar_destino_por_candidatura", lambda *_a, **_k: {})
    antes = _rodar(monkeypatch, snaps, eleit, cargo=cargo)
    assert atual == antes


def test_so_quem_tem_dvt_ganha_destino(monkeypatch) -> None:
    """Só a anulada traz `dvt`; as demais ficam SEM `destino` — não viram
    `"valido"` por omissão."""
    snaps, eleit = _cenario({"SP": _SHARES, "RJ": _SHARES}, _dvt_fixo({ANUL: ANULADO}), cargo=1)
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    nat = body["payload"]["national"]
    assert _cand(nat, ANUL)["destino"] == "anulado"
    for cid in (LIDER, X, SUBJ, Y):
        assert "destino" not in _cand(nat, cid), cid
        assert "destino" not in _uf_cand(body, "SP", cid), cid
    for t in _por_uf(body["payload"], "RJ")["top_candidatos"]:
        assert ("destino" in t) == (t["id"] == ANUL), t


def test_destino_de_nunca_devolve_default() -> None:
    an = proj.anulados_na_decisao({("SP", 45): "anulado"}, 3)
    assert an.destino_de("SP", 45) == "anulado"
    assert an.destino_de("SP", 13) is None
    assert an.destino_de("RJ", 45) is None
    assert an.destino_de(None, 45) is None
    assert proj.SEM_ANULADOS.destino_de("SP", 45) is None
    assert proj.SEM_ANULADOS.destino_de(None, 45) is None


def test_destino_de_so_devolve_anulado_ou_sub_judice() -> None:
    """2026-09-27: `"valido"` está no mapa (é dado coerente) mas NÃO é
    exibido nas listas — `destino_de` devolve `None`. Sub judice e anulado,
    sim, nos dois escopos (Presidente nacional; Gov/Sen da UF)."""
    pres = proj.anulados_na_decisao(
        {("BR", 1): "valido", ("BR", 2): "sub_judice", ("BR", 3): "anulado"}, 1
    )
    for sigla in (None, "SP"):
        assert pres.destino_de(sigla, 1) is None
        assert pres.destino_de(sigla, 2) == "sub_judice"
        assert pres.destino_de(sigla, 3) == "anulado"
    gov = proj.anulados_na_decisao(
        {("SP", 1): "valido", ("SP", 2): "sub_judice", ("SP", 3): "anulado"}, 3
    )
    assert gov.destino_de("SP", 1) is None
    assert gov.destino_de("SP", 2) == "sub_judice"
    assert gov.destino_de("SP", 3) == "anulado"


# ---------------------------------------------------------------------------
# Governador / Senador — destino da UF; número repetido não vaza
# ---------------------------------------------------------------------------

G45, G13, G22 = 45, 13, 22


def test_governador_destino_da_uf_sem_vazar_entre_ufs(monkeypatch) -> None:
    """O 45 é anulado em SP e válido no RJ; o 13 só tem `dvt` em SP. São
    candidaturas diferentes com o mesmo número de urna."""
    sp = {G45: 0.47, G13: 0.33, G22: 0.20}
    rj = {G45: 0.40, G13: 0.35, G22: 0.25}

    def dvt(uf, _zona, cod):
        if cod == G45:
            return ANULADO if uf == "SP" else VALIDO
        if cod == G13:
            return SUB_JUDICE if uf == "SP" else None
        return None

    snaps, eleit = _cenario({"SP": sp, "RJ": rj}, dvt, cargo=3)
    body = _rodar(monkeypatch, snaps, eleit, cargo=3)
    linha_sp = _por_uf(body["payload"], "SP")
    linha_rj = _por_uf(body["payload"], "RJ")

    assert _top(linha_sp, G45)["destino"] == "anulado"
    assert _uf_cand(body, "SP", G45)["destino"] == "anulado"
    # válido no RJ ⇒ SEM chave (2026-09-27), e o "anulado" de SP não vaza.
    assert "destino" not in _top(linha_rj, G45)
    assert "destino" not in _uf_cand(body, "RJ", G45)

    assert _top(linha_sp, G13)["destino"] == "sub_judice"
    assert _uf_cand(body, "SP", G13)["destino"] == "sub_judice"
    # o 13 do RJ não tem `dvt` — o "sub_judice" de SP não pode vazar para cá.
    assert "destino" not in _top(linha_rj, G13)
    assert "destino" not in _uf_cand(body, "RJ", G13)

    # 22 sem `dvt` em lugar nenhum.
    assert "destino" not in _top(linha_sp, G22)
    assert "destino" not in _uf_cand(body, "RJ", G22)

    # Bloco nacional de Governador: união de 27 corridas ⇒ nenhum destino.
    for c in body["payload"]["national"]["candidatos"]:
        assert "destino" not in c, c


def test_governador_nacional_sem_destino_mesmo_quando_todas_as_ufs_concordam(
    monkeypatch,
) -> None:
    """Todas as UFs dizem "Anulado" para o 45: a chave `("BR", 45)` existe no
    mapa, mas NÃO identifica uma candidatura — o bloco nacional segue sem."""
    sp = {G45: 0.47, G13: 0.33, G22: 0.20}
    snaps, eleit = _cenario(
        {"SP": sp, "RJ": sp}, _dvt_fixo({G45: ANULADO, G13: VALIDO, G22: VALIDO}), cargo=3
    )
    zonas, agregados = proj.particionar_por_nivel(snaps)
    assert proj.montar_destino_por_candidatura(zonas, agregados)[("BR", G45)] == "anulado"
    body = _rodar(monkeypatch, snaps, eleit, cargo=3)
    for c in body["payload"]["national"]["candidatos"]:
        assert "destino" not in c, c
    assert _uf_cand(body, "RJ", G45)["destino"] == "anulado"


S451, S131, S221, S401 = 451, 131, 221, 401


def test_senado_destino_da_uf(monkeypatch) -> None:
    sp = {S451: 0.30, S131: 0.27, S221: 0.23, S401: 0.20}
    rj = {S131: 0.30, S221: 0.28, S401: 0.22, S451: 0.20}

    def dvt(uf, _zona, cod):
        return ANULADO if (uf, cod) == ("SP", S451) else VALIDO

    snaps, eleit = _cenario({"SP": sp, "RJ": rj}, dvt, cargo=5, vpe=2)
    body = _rodar(monkeypatch, snaps, eleit, cargo=5)
    assert _uf_cand(body, "SP", S451)["destino"] == "anulado"
    assert _top(_por_uf(body["payload"], "SP"), S451)["destino"] == "anulado"
    # válido ⇒ SEM chave (2026-09-27); o "anulado" de SP não vaza para o RJ.
    assert "destino" not in _uf_cand(body, "RJ", S451)
    assert "destino" not in _top(_por_uf(body["payload"], "RJ"), S451)
    assert "destino" not in _uf_cand(body, "SP", S131)
    for c in body["payload"]["national"]["candidatos"]:
        assert "destino" not in c, c


# ---------------------------------------------------------------------------
# Líder do município — pula a anulada, mantém a sub judice
# ---------------------------------------------------------------------------


def _uf_rows(sigla: str, shares: dict[int, float], cargo: int) -> list[dict[str, Any]]:
    return [
        {
            "cargo": cargo,
            "turno": 1,
            "uf": sigla,
            "candidato_id": cid,
            "pct_projetado": 100.0 * f,
            "pct_projetado_lower": 100.0 * f - 1.0,
            "pct_projetado_upper": 100.0 * f + 1.0,
            "pct_apurado": 50.0,
        }
        for cid, f in shares.items()
    ]


def _municipios(
    votos_by_uf: dict[str, dict[int, int]],
    shares_by_uf: dict[str, dict[int, float]],
    *,
    cargo: int,
    anulados: proj.AnuladosNaDecisao | None,
) -> dict[str, dict[str, Any]]:
    """Um município por UF, `build_uf_payloads` direto: o produtor do Blob de
    municípios (`m.lider.candidato_id` em `lib/blob/uf-detail.ts`)."""
    uf_rows: list[dict[str, Any]] = []
    municipio_aggregates: dict[tuple[str, int], dict[str, Any]] = {}
    zona_municipio: dict[tuple[str, int, int], dict[str, Any]] = {}
    for i, sigla in enumerate(sorted(votos_by_uf)):
        uf_rows += _uf_rows(sigla, shares_by_uf[sigla], cargo)
        votos = votos_by_uf[sigla]
        municipio_aggregates[(sigla, 1000 + i)] = {
            "pct_apurado": 50.0,
            "votos_por_candidato": dict(votos),
            "total_votos": sum(votos.values()),
        }
        zona_municipio[(sigla, 1000 + i, 1)] = {
            "uf": sigla,
            "cod_municipio_tse": 1000 + i,
            "cod_ibge": f"35{i:05d}",
            "nome": f"MUNICIPIO {sigla}",
        }
    out = proj.build_uf_payloads(
        cargo=cargo,
        turno=1,
        ts_iso="2026-10-04T20:00:00Z",
        uf_rows=uf_rows,
        national_rows=[],
        municipio_aggregates=municipio_aggregates,
        zona_municipio=zona_municipio,
        series_by_uf={},
        anulados=anulados,
    )
    return {sigla: out[sigla]["municipios"][0] for sigla in out}


def test_lider_do_municipio_pula_a_anulada_e_mantem_a_sub_judice() -> None:
    votos = {ANUL: 500, SUBJ: 400, LIDER: 300}
    shares = {ANUL: 0.4, SUBJ: 0.35, LIDER: 0.25}
    an = proj.anulados_na_decisao(
        {("BR", ANUL): "anulado", ("BR", SUBJ): "sub_judice", ("BR", LIDER): "valido"}, 1
    )
    m = _municipios({"SP": votos}, {"SP": shares}, cargo=1, anulados=an)["SP"]
    assert m["lider"]["candidato_id"] == SUBJ
    assert m["lider"]["votos"] == 400
    # margem entre as que COMPETEM (400 − 300), em pp do total do município
    # — que segue incluindo a anulada (base `vvc`, exibição).
    assert m["lider"]["margem_pp"] == pytest.approx(100.0 * 100 / 1200)
    assert m["votos_reportados"] == votos

    # Sem destino conhecido: exatamente como antes — a anulada lidera.
    sem = _municipios({"SP": votos}, {"SP": shares}, cargo=1, anulados=None)["SP"]
    assert sem["lider"]["candidato_id"] == ANUL
    vazio = proj.anulados_na_decisao({}, 1)
    assert _municipios({"SP": votos}, {"SP": shares}, cargo=1, anulados=vazio)["SP"] == sem


def test_lider_do_municipio_sub_judice_na_frente_continua_lider() -> None:
    votos = {SUBJ: 500, ANUL: 400, LIDER: 300}
    shares = {SUBJ: 0.4, ANUL: 0.35, LIDER: 0.25}
    an = proj.anulados_na_decisao({("BR", ANUL): "anulado", ("BR", SUBJ): "sub_judice"}, 1)
    m = _municipios({"SP": votos}, {"SP": shares}, cargo=1, anulados=an)["SP"]
    assert m["lider"]["candidato_id"] == SUBJ
    # o 2º da margem é quem compete (300), não a anulada (400).
    assert m["lider"]["margem_pp"] == pytest.approx(100.0 * 200 / 1200)


def test_lider_do_municipio_governador_usa_o_destino_da_uf() -> None:
    """45 anulado em SP, válido no RJ: no município do RJ o 45 lidera."""
    votos = {G45: 500, G13: 400, G22: 100}
    shares = {G45: 0.5, G13: 0.4, G22: 0.1}
    an = proj.anulados_na_decisao({("SP", G45): "anulado", ("RJ", G45): "valido"}, 3)
    ms = _municipios(
        {"SP": votos, "RJ": votos}, {"SP": shares, "RJ": shares}, cargo=3, anulados=an
    )
    assert ms["SP"]["lider"]["candidato_id"] == G13
    assert ms["RJ"]["lider"]["candidato_id"] == G45


# ---------------------------------------------------------------------------
# Líder da mesorregião — mesma regra do município
# ---------------------------------------------------------------------------


def _meso(votos: dict[int, int], fora: frozenset[int] | set[int] | None) -> dict[str, Any]:
    municipios = [
        {
            "cod_ibge": f"350000{i}",
            "uf": "SP",
            "mesorregiao_cod": "3501",
            "mesorregiao_nome": "Norte",
            "pct_apurado": 50.0,
            "lider": {"candidato_id": 0, "votos": 0, "partido": "—", "margem_pp": 0.0},
            # dois municípios com metade dos votos cada — a soma é `votos`.
            "votos_reportados": {c: v // 2 for c, v in votos.items()},
        }
        for i in range(2)
    ]
    kwargs: dict[str, Any] = {} if fora is None else {"fora_da_decisao": fora}
    (m,) = proj.aggregate_by_mesorregiao({"sigla": "SP"}, municipios, **kwargs)
    return m


def test_lider_da_mesorregiao_pula_a_anulada_e_mantem_a_sub_judice() -> None:
    m = _meso({ANUL: 500, SUBJ: 400, LIDER: 300}, frozenset({ANUL}))
    assert m["lider_candidato_id"] == SUBJ
    # pp do total da mesorregião, que segue incluindo a anulada (base vvc).
    assert m["lider_pct"] == pytest.approx(100.0 * 400 / 1200)
    assert m["margem"] == pytest.approx(100.0 * (400 - 300) / 1200)


def test_lider_da_mesorregiao_sub_judice_na_frente_e_margem_entre_as_que_competem() -> None:
    m = _meso({SUBJ: 500, ANUL: 400, LIDER: 300}, frozenset({ANUL}))
    assert m["lider_candidato_id"] == SUBJ
    assert m["margem"] == pytest.approx(100.0 * (500 - 300) / 1200)


def test_lider_da_mesorregiao_so_a_anulada_com_voto_volta_a_ser_lider() -> None:
    m = _meso({ANUL: 500}, frozenset({ANUL}))
    assert m["lider_candidato_id"] == ANUL
    assert m["lider_pct"] == pytest.approx(100.0)


def test_lider_da_mesorregiao_degenerada_sem_votos_pula_a_anulada() -> None:
    # total 0: líder = menor id ENTRE OS QUE COMPETEM (13 é anulado ⇒ 22).
    m = _meso({LIDER: 0, X: 0}, frozenset({LIDER}))
    assert m["lider_candidato_id"] == X
    assert _meso({LIDER: 0, X: 0}, None)["lider_candidato_id"] == LIDER


@pytest.mark.parametrize("fora", [frozenset(), set()])
def test_lider_da_mesorregiao_sem_destino_identico_ao_de_antes(fora) -> None:
    votos = {ANUL: 500, SUBJ: 400, LIDER: 300}
    assert _meso(votos, fora) == _meso(votos, None)
    assert _meso(votos, None)["lider_candidato_id"] == ANUL


def _mesos_via_uf_payloads(
    votos: dict[int, int],
    shares: dict[int, float],
    *,
    cargo: int,
    siglas: tuple[str, ...],
    anulados: proj.AnuladosNaDecisao | None,
) -> dict[str, dict[str, Any]]:
    """A fiação: `build_uf_payloads` passa `fora_da_uf` à mesorregião."""
    uf_rows: list[dict[str, Any]] = []
    municipio_aggregates: dict[tuple[str, int], dict[str, Any]] = {}
    zona_municipio: dict[tuple[str, int, int], dict[str, Any]] = {}
    for i, sigla in enumerate(siglas):
        uf_rows += _uf_rows(sigla, shares, cargo)
        municipio_aggregates[(sigla, 1000 + i)] = {
            "pct_apurado": 50.0,
            "votos_por_candidato": dict(votos),
            "total_votos": sum(votos.values()),
        }
        zona_municipio[(sigla, 1000 + i, 1)] = {
            "uf": sigla,
            "cod_municipio_tse": 1000 + i,
            "cod_ibge": f"35{i:05d}",
            "nome": f"MUNICIPIO {sigla}",
            "mesorregiao_cod": f"{3501 + i}",
            "mesorregiao_nome": f"MESO {sigla}",
        }
    out = proj.build_uf_payloads(
        cargo=cargo,
        turno=1,
        ts_iso="2026-10-04T20:00:00Z",
        uf_rows=uf_rows,
        national_rows=[],
        municipio_aggregates=municipio_aggregates,
        zona_municipio=zona_municipio,
        series_by_uf={},
        anulados=anulados,
    )
    return {sigla: out[sigla]["mesorregioes"][0] for sigla in out}


def test_mesorregiao_via_uf_payloads_presidente_pula_anulada_mantem_sub_judice() -> None:
    votos = {ANUL: 500, SUBJ: 400, LIDER: 300}
    shares = {ANUL: 0.4, SUBJ: 0.35, LIDER: 0.25}
    an = proj.anulados_na_decisao(
        {("BR", ANUL): "anulado", ("BR", SUBJ): "sub_judice", ("BR", LIDER): "valido"}, 1
    )
    com = _mesos_via_uf_payloads(votos, shares, cargo=1, siglas=("SP",), anulados=an)
    assert com["SP"]["lider_candidato_id"] == SUBJ
    sem = _mesos_via_uf_payloads(votos, shares, cargo=1, siglas=("SP",), anulados=None)
    assert sem["SP"]["lider_candidato_id"] == ANUL


def test_mesorregiao_via_uf_payloads_governador_usa_o_destino_da_uf() -> None:
    votos = {G45: 500, G13: 400, G22: 100}
    shares = {G45: 0.5, G13: 0.4, G22: 0.1}
    an = proj.anulados_na_decisao({("SP", G45): "anulado", ("RJ", G45): "valido"}, 3)
    ms = _mesos_via_uf_payloads(votos, shares, cargo=3, siglas=("SP", "RJ"), anulados=an)
    assert ms["SP"]["lider_candidato_id"] == G13
    assert ms["RJ"]["lider_candidato_id"] == G45
