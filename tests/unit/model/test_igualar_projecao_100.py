"""05/10/2026 — com 100% apurado (pst oficial), projeção == apuração."""

from api.model.project import _igualar_projecao_ao_apurado


def test_nacional_e_uf_em_100_igualam_e_abaixo_de_100_nao_mexe() -> None:
    nat = {
        "pct_apurado_total": 100,
        "national": {
            "candidatos": [
                {"pct_atual": 47.03, "pct_projetado": 47.12, "pct_projetado_lower": 46.7,
                 "pct_projetado_upper": 47.4, "votos_atuais": 10, "votos_projetados": 9}
            ]
        },
    }
    ufs = {
        "SP": {"pct_apurado": 100, "candidatos": [
            {"pct_atual": 51.93, "pct_projetado": 51.87, "ci95": {"lower": 50.9, "upper": 52.8},
             "votos_atuais": 5, "votos_projetados": 4,
             "comparecimento": {"pct_atual": 48.8, "pct_projetado": 48.85, "lower": 1, "upper": 2}}]},
        "BA": {"pct_apurado": 99.9, "candidatos": [
            {"pct_atual": 40, "pct_projetado": 41, "ci95": {"lower": 39, "upper": 43},
             "votos_atuais": 1, "votos_projetados": 2}]},
    }
    _igualar_projecao_ao_apurado(nat, ufs)
    c = nat["national"]["candidatos"][0]
    assert (c["pct_projetado"], c["pct_projetado_lower"], c["pct_projetado_upper"]) == (47.03,) * 3
    assert c["votos_projetados"] == 10
    sp = ufs["SP"]["candidatos"][0]
    assert sp["pct_projetado"] == 51.93 and sp["ci95"] == {"lower": 51.93, "upper": 51.93}
    assert sp["votos_projetados"] == 5 and sp["comparecimento"]["pct_projetado"] == 48.8
    ba = ufs["BA"]["candidatos"][0]
    assert ba["pct_projetado"] == 41 and ba["votos_projetados"] == 2

    quase = {"pct_apurado_total": 99.99, "national": {"candidatos": [{"pct_atual": 1, "pct_projetado": 2}]}}
    _igualar_projecao_ao_apurado(quase, {})
    assert quase["national"]["candidatos"][0]["pct_projetado"] == 2
