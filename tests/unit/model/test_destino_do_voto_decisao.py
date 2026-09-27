"""ADR-0053 / spec 002 RF-213 — candidatura de voto ANULADO sai das decisões.

Decisão do dono (2026-09-27):
  1. `dvt = "Anulado"` ⇒ não compete: fora de líder, par, agulha, `p_vitoria`,
     `p_passa_2t`, `p_fecha_1t`, cenários do 2º turno, `chamada`, `vai_a_2t` e
     `p_eleito`. Os votos dela saem da base da regra dos 50% por reamostra:
     `f_i' = f_i / (1 − Σ f_anuladas)`.
  2. `dvt = "Anulado sub judice"` ⇒ segue o TSE: compete e fica na base.
  3. A exibição (`pct_*`, IC) continua sobre `vvc`.
  4. `dvt` ausente, ausente em parte, divergente ou desconhecido ⇒ ninguém é
     excluído, saída igual à de antes, aviso no log. Nunca default.
  5. Presidente decide com o destino nacional; Governador/Senador, com o da UF.

Os cenários partem da captura real do simulado
(`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`: `vvc` 120.704.576) —
cada UF é fatiada em zonas de ~1/600 desse `vvc`, com as frações da auditoria
de 2026-09-27 (líder 46% de `vvc` com 16% de `vvc` anulado, etc.).

Os testes E2E passam por `_do_project` inteiro (banco falso, `urlopen`
capturado): é a fiação que precisa ser provada, não só as funções.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest

from api.model import project as proj
from tests.unit.model.test_orchestrator import FakeConn

#: `vvc` da captura real do simulado (`br-c0001-e021270-u.json`).
VVC_CAPTURA = 120_704_576
#: Uma zona sintética ~ 1/600 do país — ordem de grandeza de uma zona real.
VVC_ZONA = VVC_CAPTURA // 600

ANULADO = "Anulado"
SUB_JUDICE = "Anulado sub judice"
VALIDO = "Válido"


# ---------------------------------------------------------------------------
# Construção de cenário
# ---------------------------------------------------------------------------


def _envelope(
    votos: dict[int, int],
    dvt: dict[int, str | None],
    *,
    cargo: int,
    vpe: int,
    tpabr: str,
) -> dict[str, Any]:
    """EA20 com `e`/`v`/`s` coerentes e `cand[].dvt` opcional por candidatura."""
    vvc = sum(votos.values())
    vb = vvc // 40
    tvn = vvc // 30
    comparecimento = (vvc + vb + tvn) // vpe
    te = int(comparecimento / 0.85)
    van = sum(v for c, v in votos.items() if dvt.get(c) == ANULADO)
    vansj = sum(v for c, v in votos.items() if dvt.get(c) == SUB_JUDICE)

    def _cand(cod: int) -> dict[str, Any]:
        c: dict[str, Any] = {
            "n": str(cod),
            "sqcand": f"{cod}0000000001",
            "nm": f"CANDIDATO {cod}",
            "nmu": f"CANDIDATO {cod}",
            "e": "n",
            "vap": str(votos[cod]),
        }
        if dvt.get(cod) is not None:
            c["dvt"] = dvt[cod]
        return c

    return {
        "ele": "999999",
        "t": "1",
        "f": "o",
        "tpabr": tpabr,
        "dg": "04/10/2026",
        "hg": "20:00:00",
        "carg": [
            {
                "cd": str(cargo),
                "agr": [
                    {
                        "n": str(cod),
                        "tp": "i",
                        "par": [{"n": str(cod), "sg": f"P{cod}", "cand": [_cand(cod)]}],
                    }
                    for cod in sorted(votos)
                ],
            }
        ],
        "s": {"ts": "1", "st": "1", "si": "1", "sa": "1", "psa": "100,00"},
        "e": {
            "te": str(te),
            "esi": str(te),
            "c": str(comparecimento),
            "a": str(te - comparecimento),
        },
        "v": {
            "tv": str(comparecimento * vpe),
            "vvc": str(vvc),
            "vv": str(vvc - van - vansj),
            "vnom": str(vvc - van - vansj),
            "van": str(van),
            "vansj": str(vansj),
            "vb": str(vb),
            "tvn": str(tvn),
            "vn": str(tvn),
            "vnt": "0",
        },
    }


def _votos_da_zona(shares: dict[int, float], j: int, escala: float) -> dict[int, int]:
    """Frações da UF com uma perturbação determinística de ±2% por zona —
    o bootstrap precisa de variância entre zonas para as probabilidades não
    degenerarem, e nenhum sorteio pode entrar no teste (constituição § 6)."""
    bruto = {c: f * (1.0 + 0.02 * math.sin(3.1 * j + c)) for c, f in shares.items()}
    tot = sum(bruto.values())
    return {c: int(round(VVC_ZONA * escala * f / tot)) for c, f in bruto.items()}


def _cenario(
    shares_by_uf: dict[str, dict[int, float]],
    dvt_de,  # (uf, zona|None, cod) -> str | None ; zona None = agregado
    *,
    cargo: int,
    vpe: int = 1,
    n_zonas: int = 6,
    escala_by_uf: dict[str, float] | None = None,
) -> tuple[list[dict], list[dict]]:
    snapshots: list[dict] = []
    eleitorado: list[dict] = []
    soma_br: dict[int, int] = {}
    for uf in sorted(shares_by_uf):
        shares = shares_by_uf[uf]
        escala = (escala_by_uf or {}).get(uf, 1.0)
        soma_uf: dict[int, int] = {}
        for j in range(1, n_zonas + 1):
            votos = _votos_da_zona(shares, j, escala)
            payload = _envelope(
                votos,
                {c: dvt_de(uf, j, c) for c in votos},
                cargo=cargo,
                vpe=vpe,
                tpabr="zona",
            )
            snapshots.append(
                {
                    "cargo": cargo,
                    "turno": 1,
                    "uf": uf,
                    "cod_zona": j,
                    "pct_apurado": 100.0,
                    "payload": payload,
                }
            )
            eleitorado.append(
                {"ano": 2026, "uf": uf, "cod_zona": j, "eleitores_aptos": int(payload["e"]["te"])}
            )
            for c, v in votos.items():
                soma_uf[c] = soma_uf.get(c, 0) + v
        # Agregado da UF (spec 021) — a fonte preferida do mapa de destino.
        snapshots.append(
            {
                "cargo": cargo,
                "turno": 1,
                "uf": uf,
                "cod_zona": 0,
                "nivel": "uf",
                "pct_apurado": 100.0,
                "payload": _envelope(
                    soma_uf,
                    {c: dvt_de(uf, None, c) for c in soma_uf},
                    cargo=cargo,
                    vpe=vpe,
                    tpabr="uf",
                ),
            }
        )
        for c, v in soma_uf.items():
            soma_br[c] = soma_br.get(c, 0) + v
    if cargo == 1:
        snapshots.append(
            {
                "cargo": cargo,
                "turno": 1,
                "uf": "BR",
                "cod_zona": 0,
                "nivel": "br",
                "pct_apurado": 100.0,
                "payload": _envelope(
                    soma_br,
                    {c: dvt_de("BR", None, c) for c in soma_br},
                    cargo=cargo,
                    vpe=vpe,
                    tpabr="br",
                ),
            }
        )
    return snapshots, eleitorado


def _dvt_fixo(mapa: dict[int, str | None]):
    return lambda _uf, _zona, cod: mapa.get(cod)


def _sem_dvt(_uf, _zona, _cod):
    return None


def _rodar(
    monkeypatch: pytest.MonkeyPatch,
    snapshots: list[dict],
    eleitorado: list[dict],
    *,
    cargo: int,
) -> dict[str, Any]:
    """`_do_project` inteiro; devolve `{payload, payloads_uf}` com `ts` neutro."""
    conn = FakeConn(snapshots, [], eleitorado)
    monkeypatch.setattr(proj, "_open_conn", lambda: conn)
    monkeypatch.setenv("MODEL_SECRET", "segredo-de-teste-rf213")
    monkeypatch.setenv("INTERNAL_BASE_URL", "http://localhost:13000")
    capturado: dict[str, Any] = {}

    class _Resp:
        status = 200

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *a):  # noqa: ANN001,ANN204
            return None

    def _urlopen(req, timeout=10):  # noqa: ANN001,ARG001
        capturado["body"] = req.data.decode("utf-8")
        return _Resp()

    monkeypatch.setattr(proj.urllib.request, "urlopen", _urlopen)
    status, resp = proj._do_project(
        json.dumps(
            {"cargo": cargo, "turno": 1, "trigger_ts": "2026-10-04T20:00:00Z"}
        ).encode("utf-8")
    )
    assert status == 200, resp
    assert resp["computed"] is True
    corpo = json.loads(capturado["body"])
    ts = corpo["payload"]["ts"]
    return json.loads(capturado["body"].replace(ts, "<TS>"))


def _cand(national: dict[str, Any], cid: int) -> dict[str, Any]:
    return next(c for c in national["candidatos"] if c["id"] == cid)


def _por_uf(payload: dict[str, Any], sigla: str) -> dict[str, Any]:
    return next(r for r in payload["por_uf"] if r["sigla"] == sigla)


# Candidaturas de Presidente usadas nos cenários.
LIDER, ANUL, SUBJ, X, Y = 13, 60, 57, 22, 89


# ---------------------------------------------------------------------------
# Cenário A — líder 46% de vvc, 16% de vvc anulado: já venceu
# ---------------------------------------------------------------------------

_SHARES_A = {LIDER: 0.46, ANUL: 0.16, SUBJ: 0.087, X: 0.20, Y: 0.093}


def test_a_lider_46_com_16_anulado_fecha_no_1o_turno(monkeypatch) -> None:
    snaps, eleit = _cenario(
        {"SP": _SHARES_A, "RJ": _SHARES_A},
        _dvt_fixo({ANUL: ANULADO, SUBJ: SUB_JUDICE, LIDER: VALIDO, X: VALIDO, Y: VALIDO}),
        cargo=1,
    )
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    nat = body["payload"]["national"]

    # 46 / 84 = 54,8% da base que conta.
    assert _cand(nat, LIDER)["p_fecha_1t"] > 0.99
    assert nat["p_segundo_turno_overall"] < 0.01
    assert nat["vai_a_2t_nacional"] is False
    assert nat["candidato_a_id"] == LIDER
    # A anulada não compete em nada…
    assert _cand(nat, ANUL)["p_vitoria"] == 0.0
    assert _cand(nat, ANUL)["p_passa_2t"] == 0.0
    assert _cand(nat, ANUL)["p_fecha_1t"] == 0.0
    # …mas a EXIBIÇÃO continua sobre vvc: 16% dela, 46% do líder.
    assert _cand(nat, ANUL)["pct_projetado"] == pytest.approx(16.0, abs=0.5)
    assert _cand(nat, LIDER)["pct_projetado"] == pytest.approx(46.0, abs=0.5)


def test_a_sem_dvt_o_mesmo_cenario_continua_indo_ao_2o_turno(monkeypatch) -> None:
    """O defeito medido na auditoria — prova que o cenário A discrimina."""
    snaps, eleit = _cenario({"SP": _SHARES_A, "RJ": _SHARES_A}, _sem_dvt, cargo=1)
    nat = _rodar(monkeypatch, snaps, eleit, cargo=1)["payload"]["national"]
    assert _cand(nat, LIDER)["p_fecha_1t"] == 0.0
    assert nat["p_segundo_turno_overall"] == 1.0


def test_a_exibicao_identica_com_e_sem_dvt(monkeypatch) -> None:
    """Regra 3 — todo percentual publicado é o mesmo; só as decisões mudam."""
    com, _ = _cenario(
        {"SP": _SHARES_A, "RJ": _SHARES_A},
        _dvt_fixo({ANUL: ANULADO, SUBJ: SUB_JUDICE}),
        cargo=1,
    )
    sem, eleit = _cenario({"SP": _SHARES_A, "RJ": _SHARES_A}, _sem_dvt, cargo=1)
    p_com = _rodar(monkeypatch, com, eleit, cargo=1)
    p_sem = _rodar(monkeypatch, sem, eleit, cargo=1)
    campos = ("pct_atual", "pct_projetado", "pct_projetado_lower",
              "pct_projetado_upper", "votos_atuais", "votos_projetados", "rank")
    for cid in _SHARES_A:
        for campo in campos:
            assert _cand(p_com["payload"]["national"], cid)[campo] == _cand(
                p_sem["payload"]["national"], cid
            )[campo], (cid, campo)
    for sigla in ("SP", "RJ"):
        assert p_com["payloads_uf"][sigla]["candidatos"] == p_sem["payloads_uf"][sigla][
            "candidatos"
        ]


# ---------------------------------------------------------------------------
# Cenário B — anulada é a 2ª em vvc: não entra no par
# ---------------------------------------------------------------------------

_SHARES_B = {LIDER: 0.40, ANUL: 0.30, X: 0.20, SUBJ: 0.10}


def test_b_anulada_segunda_nao_entra_no_par(monkeypatch) -> None:
    snaps, eleit = _cenario(
        {"SP": _SHARES_B, "RJ": _SHARES_B}, _dvt_fixo({ANUL: ANULADO}), cargo=1
    )
    nat = _rodar(monkeypatch, snaps, eleit, cargo=1)["payload"]["national"]
    assert nat["candidato_a_id"] == LIDER
    assert nat["candidato_b_id"] == X
    assert nat["cenarios_2t"], "cenários do 2º turno vazios"
    for cenario in nat["cenarios_2t"]:
        assert ANUL not in cenario["par"]
    assert nat["cenarios_2t"][0]["par"] == sorted([LIDER, X])
    assert _cand(nat, ANUL)["p_passa_2t"] == 0.0
    # Agulha e lista começam pelo par que compete.
    assert [c["id"] for c in nat["candidatos"][:2]] == [LIDER, X]


def test_b_sem_dvt_a_anulada_ocupa_o_par(monkeypatch) -> None:
    snaps, eleit = _cenario({"SP": _SHARES_B, "RJ": _SHARES_B}, _sem_dvt, cargo=1)
    nat = _rodar(monkeypatch, snaps, eleit, cargo=1)["payload"]["national"]
    assert nat["candidato_b_id"] == ANUL


def test_sub_judice_segunda_continua_no_par(monkeypatch) -> None:
    """Regra 2 — sub judice segue o TSE: compete e decide como antes."""
    shares = {LIDER: 0.40, SUBJ: 0.30, X: 0.20, Y: 0.10}
    snaps, eleit = _cenario(
        {"SP": shares, "RJ": shares}, _dvt_fixo({SUBJ: SUB_JUDICE}), cargo=1
    )
    nat = _rodar(monkeypatch, snaps, eleit, cargo=1)["payload"]["national"]
    assert nat["candidato_b_id"] == SUBJ
    assert nat["cenarios_2t"][0]["par"] == sorted([LIDER, SUBJ])
    assert _cand(nat, SUBJ)["p_passa_2t"] > 0.99


def test_presidente_uf_onde_a_anulada_lidera_usa_o_destino_nacional(monkeypatch) -> None:
    """Regra 5 — Presidente: a UF usa o destino nacional; o líder e a agulha
    da UF saem das que competem."""
    rj = {ANUL: 0.45, LIDER: 0.30, X: 0.20, SUBJ: 0.05}
    snaps, eleit = _cenario(
        {"SP": _SHARES_B, "RJ": rj}, _dvt_fixo({ANUL: ANULADO}), cargo=1
    )
    body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    linha = _por_uf(body["payload"], "RJ")
    assert linha["lider"] == LIDER
    assert linha["margem_projetada"] == pytest.approx(10.0, abs=1.0)
    # agulha da UF = margem entre as que competem / 20.
    assert body["payloads_uf"]["RJ"]["needle_position"] == pytest.approx(0.5, abs=0.05)
    # A lista da UF continua exibindo a anulada em 1º por projeção.
    assert body["payloads_uf"]["RJ"]["candidatos"][0]["id"] == ANUL


# ---------------------------------------------------------------------------
# Cenário C — líder no limiar da regra dos 50%
# ---------------------------------------------------------------------------


def _nacional(shares: dict[int, float], anulados: set[int]) -> dict[int, dict[str, Any]]:
    """`compute_national` com arrays constantes (sem ruído): a decisão no
    limiar sai exata, sem depender do bootstrap."""
    est = {"SP": {c: np.full(200, f, dtype=np.float64) for c, f in shares.items()}}
    rows, *_ = proj.compute_national(
        1, 1, est, {"SP": 1_000}, anulados=frozenset(anulados)
    )
    return {r["candidato_id"]: r for r in rows}


def test_c_lider_exatamente_no_limiar_fecha() -> None:
    # 0,375 / (1 − 0,25) = 0,5 exato em ponto flutuante.
    rows = _nacional({LIDER: 0.375, ANUL: 0.25, SUBJ: 0.10, X: 0.275}, {ANUL})
    assert rows[LIDER]["p_fecha_1t"] == 1.0
    assert rows[ANUL]["p_fecha_1t"] == 0.0


def test_c_lider_logo_abaixo_do_limiar_nao_fecha() -> None:
    # 0,37 / 0,75 = 49,3%: não fecha. Se o sub judice fosse tratado como
    # anulado, a base viraria 0,65 e daria 56,9% — fecharia.
    rows = _nacional({LIDER: 0.37, ANUL: 0.25, SUBJ: 0.10, X: 0.28}, {ANUL})
    assert rows[LIDER]["p_fecha_1t"] == 0.0


def test_c_sem_anulados_o_limiar_e_sobre_vvc() -> None:
    rows = _nacional({LIDER: 0.375, ANUL: 0.25, SUBJ: 0.10, X: 0.275}, set())
    assert rows[LIDER]["p_fecha_1t"] == 0.0


def test_c_p_vitoria_da_anulada_e_zero_e_o_lider_e_quem_compete() -> None:
    est = {"SP": {ANUL: np.full(50, 0.5), LIDER: np.full(50, 0.3), X: np.full(50, 0.2)}}
    rows, p_a, a, b, _ = proj.compute_national(
        1, 1, est, {"SP": 1}, anulados=frozenset({ANUL})
    )
    por_id = {r["candidato_id"]: r for r in rows}
    assert (a, b) == (LIDER, X)
    assert p_a == 1.0
    assert por_id[ANUL]["p_vitoria"] == 0.0
    assert por_id[LIDER]["p_vitoria"] == 1.0
    # Exibição: a anulada continua rank 1 por vvc.
    assert por_id[ANUL]["rank"] == 1
    assert por_id[ANUL]["pct_projetado"] == 50.0


def test_estimativas_para_decisao_sem_anulada_devolve_o_mesmo_objeto() -> None:
    est = {1: np.array([0.6, 0.5]), 2: np.array([0.4, 0.5])}
    assert proj.estimativas_para_decisao(est, frozenset({99})) is est
    assert proj.estimativas_para_decisao(est, frozenset()) is est


def test_estimativas_para_decisao_reescala_por_reamostra() -> None:
    est = {1: np.array([0.40, 0.30]), 2: np.array([0.20, 0.50]), 3: np.array([0.40, 0.20])}
    dec = proj.estimativas_para_decisao(est, frozenset({2}))
    assert set(dec) == {1, 3}
    np.testing.assert_allclose(dec[1], [0.40 / 0.80, 0.30 / 0.50])
    np.testing.assert_allclose(dec[3], [0.40 / 0.80, 0.20 / 0.50])


# ---------------------------------------------------------------------------
# Regra 4 — sem dvt, ausente em parte, divergente, desconhecido ⇒ idêntico
# ---------------------------------------------------------------------------


def _variantes_regra_4() -> dict[str, Any]:
    def divergente(uf, zona, cod):
        if cod != ANUL:
            return None
        return VALIDO if (uf, zona) == ("SP", 3) else ANULADO

    def ausente_em_parte(uf, zona, cod):
        if cod != ANUL:
            return None
        return None if (uf, zona) == ("RJ", 2) else ANULADO

    return {
        "divergente": divergente,
        "ausente_em_parte": ausente_em_parte,
        "desconhecido": _dvt_fixo({ANUL: "Cassado"}),
        "todos_validos": _dvt_fixo(dict.fromkeys(_SHARES_B, VALIDO)),
    }


@pytest.fixture
def payload_sem_dvt(monkeypatch) -> dict[str, Any]:
    snaps, eleit = _cenario({"SP": _SHARES_B, "RJ": _SHARES_B}, _sem_dvt, cargo=1)
    return _rodar(monkeypatch, snaps, eleit, cargo=1)


def test_sem_dvt_identico_ao_caminho_sem_a_regra(monkeypatch, payload_sem_dvt) -> None:
    """Payload inteiro (nacional + 27 UFs possíveis) igual ao do ciclo com a
    maquinaria de destino desligada — o comportamento anterior à regra."""
    monkeypatch.setattr(proj, "montar_destino_por_candidatura", lambda *_a, **_k: {})
    snaps, eleit = _cenario({"SP": _SHARES_B, "RJ": _SHARES_B}, _sem_dvt, cargo=1)
    assert _rodar(monkeypatch, snaps, eleit, cargo=1) == payload_sem_dvt


@pytest.mark.parametrize("variante", sorted(_variantes_regra_4()))
def test_regra_4_payload_identico_ao_sem_dvt(
    monkeypatch, caplog, payload_sem_dvt, variante
) -> None:
    snaps, eleit = _cenario(
        {"SP": _SHARES_B, "RJ": _SHARES_B}, _variantes_regra_4()[variante], cargo=1
    )
    with caplog.at_level("INFO", logger="api.model.project"):
        body = _rodar(monkeypatch, snaps, eleit, cargo=1)
    # `votacao` publica `destino` por candidatura (spec 022) — ali o `dvt` É o
    # dado exibido, então difere por construção. Todo o resto: idêntico.
    for p in (body, payload_sem_dvt):
        p["payload"].pop("votacao", None)
        for uf in p["payloads_uf"].values():
            uf.pop("votacao", None)
    assert body == payload_sem_dvt
    if variante != "todos_validos":
        assert f'"n_{variante}"' in caplog.text


def test_mapa_de_destino_por_escopo() -> None:
    snaps, _ = _cenario(
        {"SP": {LIDER: 0.5, ANUL: 0.3, SUBJ: 0.2}, "RJ": {LIDER: 0.5, ANUL: 0.3, SUBJ: 0.2}},
        _dvt_fixo({LIDER: VALIDO, ANUL: ANULADO, SUBJ: SUB_JUDICE}),
        cargo=1,
    )
    zonas, agregados = proj.particionar_por_nivel(snaps)
    destinos = proj.montar_destino_por_candidatura(zonas, agregados)
    for escopo in ("BR", "SP", "RJ"):
        assert destinos[(escopo, ANUL)] == "anulado"
        assert destinos[(escopo, SUBJ)] == "sub_judice"
        assert destinos[(escopo, LIDER)] == "valido"
    an = proj.anulados_na_decisao(destinos, 1)
    assert an.nacional == frozenset({ANUL})
    assert an.da_uf("RJ") == frozenset({ANUL})


def test_desconhecido_nunca_vira_anulado() -> None:
    snaps, _ = _cenario({"SP": _SHARES_B}, _dvt_fixo({ANUL: "Cassado"}), cargo=1)
    zonas, agregados = proj.particionar_por_nivel(snaps)
    destinos = proj.montar_destino_por_candidatura(zonas, agregados)
    assert ("SP", ANUL) not in destinos
    assert ("BR", ANUL) not in destinos


# ---------------------------------------------------------------------------
# Governador — o destino é o da UF
# ---------------------------------------------------------------------------

G45, G13, G22 = 45, 13, 22


def test_governador_lider_chamada_e_vai_a_2t_ignoram_a_anulada_da_uf(monkeypatch) -> None:
    sp = {G45: 0.47, G13: 0.33, G22: 0.20}
    rj = {G45: 0.40, G13: 0.35, G22: 0.25}

    def dvt(uf, _zona, cod):
        # O número 45 é anulado em SP e VÁLIDO no RJ: são candidaturas
        # diferentes com o mesmo número de urna.
        if cod == G45:
            return ANULADO if uf == "SP" else VALIDO
        return VALIDO

    snaps, eleit = _cenario({"SP": sp, "RJ": rj}, dvt, cargo=3)
    body = _rodar(monkeypatch, snaps, eleit, cargo=3)

    linha_sp = _por_uf(body["payload"], "SP")
    assert linha_sp["lider"] == G13
    # margem entre as que competem, em pp de vvc: 33 − 20.
    assert linha_sp["margem_projetada"] == pytest.approx(13.0, abs=1.0)
    assert linha_sp["chamada"] is True
    # 33 / 53 = 62% da base sem os anulados ⇒ decidido no 1º turno.
    assert linha_sp["vai_a_2t"] is False
    assert linha_sp["bucket"] == "chamada"
    # exibição intacta: a anulada segue no topo de `top_candidatos` por vvc.
    assert linha_sp["top_candidatos"][0]["id"] == G45

    # No RJ o 45 é válido e lidera normalmente.
    linha_rj = _por_uf(body["payload"], "RJ")
    assert linha_rj["lider"] == G45
    assert linha_rj["vai_a_2t"] is True


def test_governador_sem_dvt_a_anulada_lideraria(monkeypatch) -> None:
    sp = {G45: 0.47, G13: 0.33, G22: 0.20}
    snaps, eleit = _cenario({"SP": sp, "RJ": sp}, _sem_dvt, cargo=3)
    linha_sp = _por_uf(_rodar(monkeypatch, snaps, eleit, cargo=3)["payload"], "SP")
    assert linha_sp["lider"] == G45
    assert linha_sp["vai_a_2t"] is True


# ---------------------------------------------------------------------------
# Senado — anulada não ocupa vaga; Σ p_eleito das que competem = vagas
# ---------------------------------------------------------------------------

S451, S131, S221, S401 = 451, 131, 221, 401


def test_senado_anulada_nao_ocupa_vaga(monkeypatch) -> None:
    sp = {S451: 0.30, S131: 0.27, S221: 0.23, S401: 0.20}
    rj = {S131: 0.30, S221: 0.28, S401: 0.22, S451: 0.20}

    def dvt(uf, _zona, cod):
        return ANULADO if (uf, cod) == ("SP", S451) else VALIDO

    snaps, eleit = _cenario({"SP": sp, "RJ": rj}, dvt, cargo=5, vpe=2)
    body = _rodar(monkeypatch, snaps, eleit, cargo=5)

    cands_sp = {c["id"]: c for c in body["payloads_uf"]["SP"]["candidatos"]}
    assert cands_sp[S451]["p_eleito"] == 0.0
    assert cands_sp[S131]["p_eleito"] > 0.99
    assert cands_sp[S221]["p_eleito"] > 0.99
    competem = [c["p_eleito"] for cid, c in cands_sp.items() if cid != S451]
    assert sum(competem) == pytest.approx(2.0)
    # exibição: a anulada continua com o maior % de vvc da UF.
    assert cands_sp[S451]["pct_projetado"] == max(c["pct_projetado"] for c in cands_sp.values())

    # composição das vagas: SP elege 131 e 221; RJ elege 131 e 221.
    comp = body["payload"]["composicao_vagas"]
    por_partido = {p["partido"]: p["vagas"] for p in comp["por_partido"]}
    assert f"P{S451}" not in por_partido
    assert por_partido == {f"P{S131}": 2, f"P{S221}": 2}


def test_senado_sem_dvt_a_anulada_levaria_vaga(monkeypatch) -> None:
    sp = {S451: 0.30, S131: 0.27, S221: 0.23, S401: 0.20}
    snaps, eleit = _cenario({"SP": sp, "RJ": sp}, _sem_dvt, cargo=5, vpe=2)
    body = _rodar(monkeypatch, snaps, eleit, cargo=5)
    cands_sp = {c["id"]: c for c in body["payloads_uf"]["SP"]["candidatos"]}
    assert cands_sp[S451]["p_eleito"] > 0.99
