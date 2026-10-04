"""04/10/2026 — `% apurado` = seções totalizadas / total (`s.st/s.ts`), não `s.psa`.

Números reais do `br-c0001-e006257-u.json` das 17h24 do 1º turno: o TSE dizia
1,42% e o site mostrava 9,1%, porque `psa = sa/si` conta só seções já
totalizadas e dá 100% em qualquer par com uma urna contada.
"""

from api.model.zona_merge import _psa_merged, pct_totalizado


def _payload(st: str, ts: str, sa: str, si: str, psa: str) -> dict:
    return {"s": {"st": st, "ts": ts, "sa": sa, "si": si, "psa": psa}}


def test_pct_totalizado_usa_st_sobre_ts_e_nao_psa() -> None:
    p = _payload("7105", "499248", "7103", "7103", "100,00")
    assert abs(pct_totalizado(p, 100.0) - 1.42314) < 1e-4


def test_pct_totalizado_sem_ts_devolve_o_fallback() -> None:
    assert pct_totalizado({"s": {"psa": "37,5"}}, 37.5) == 37.5
    assert pct_totalizado({"s": {"st": "3", "ts": "0"}}, 9.0) == 9.0
    assert pct_totalizado(None, 4.0) == 4.0


def test_merge_de_pares_soma_st_e_ts() -> None:
    rows = [
        {"payload": _payload("1", "100", "1", "1", "100,00")},
        {"payload": _payload("0", "300", "0", "0", "0,00")},
    ]
    pct, fallback = _psa_merged(rows)  # type: ignore[arg-type]
    assert fallback is False
    assert pct == 100.0 * 1 / 400
