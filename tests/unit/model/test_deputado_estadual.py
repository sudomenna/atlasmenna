"""Deputado Estadual (7) e Distrital (8) no modelo — spec 027, frente P, Fase 1.

Os cargos 7/8 reaproveitam o ramo proporcional do Deputado Federal (cargo 6,
specs 017/026). O que é do CARGO sai da tabela `api/model/cargos.py`; o que
este arquivo prova, por requisito:

- **RF-278 — cobertura e UFs por cargo.** 7 e 8 caem no ramo PROPORCIONAL (o
  modo de falha era cair calado no de governador); o Estadual existe em 26
  UFs (sem o DF) e o Distrital só no DF; `% apurado` nacional, "aguardando" e
  o sino do RF-124 contam só as UFs do cargo.
- **RF-280 — totais fixos.** 1.035 e 24, conferidos contra a CF art. 27; com
  casas faltando o total é o fixo (nunca a soma das presentes); com todas
  presentes é a soma do TSE, e o DF de `nv = 28` do simulado alarma.
- **RF-285 — Fase 1 em resumo e Conferência honesta.** O modelo recebe só o
  agregado de cada casa; o ciclo publica o payload v2 sem "Câmara", sem
  projeção, e a Conferência não compara o agregado consigo mesmo.
- **RF-290 — golden de 2022 parametrizado.** `scripts/build-cadeiras-golden.py
  --cargo` (o 6 continua gerando a fixture de sempre, byte a byte).

Dados: os EA20 REAIS de cargo 7/8 do simulado de 29/09
(`tests/fixtures/tse/2026-sim/dep-est/`, RR/SP/DF a ~7%) e, só para os dois
estados que a captura não viu (0% e totalização final), a fixture sintética
`dep-est-sintetico/` (ver o README de lá — ela confere "por construção").
"""

from __future__ import annotations

import copy
import csv
import importlib.util
import json
import pathlib
import re
from typing import Any

import pytest

from api.model import cargos
from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import conferir_agregado_da_uf, extrair_entrada_proporcional
from api.model.deputado_payload import (
    UfProporcional,
    conferir_total_de_cadeiras,
    construir_payload_deputado,
)
from tests.unit.model._contrato_deputado_v2 import conferir_nacional, conferir_uf
from tests.unit.model._fixture_dep_est_sintetico import gerar, serializar
from tests.unit.model.test_deputado_payload import _FakeConn

RAIZ = pathlib.Path(__file__).resolve().parents[3]
TSE = RAIZ / "tests" / "fixtures" / "tse" / "2026-sim"
DEP_EST = TSE / "dep-est"
SINTETICO = TSE / "dep-est-sintetico" / "rr"
DEP_RR = TSE / "dep" / "rr"
GOLDEN_6 = RAIZ / "tests" / "fixtures" / "model" / "cadeiras-golden-2022.json"

RR7 = DEP_EST / "rr" / "rr-c0007-e021272-u.json"
SP7 = DEP_EST / "sp" / "sp-c0007-e021272-u.json"
DF8 = DEP_EST / "df" / "df-c0008-e021272-u.json"

#: Bancada federal de 2026 por UF (513 — o PLP 177/2023 foi vetado e o STF
#: manteve a distribuição; `api/model/cargos.py::TOTAL_CADEIRAS`).
BANCADA_FEDERAL = {
    "SP": 70, "MG": 53, "RJ": 46, "BA": 39, "RS": 31, "PR": 30, "PE": 25, "CE": 22,
    "MA": 18, "GO": 17, "PA": 17, "SC": 16, "PB": 12, "ES": 10, "PI": 10, "AL": 9,
    "AC": 8, "AM": 8, "AP": 8, "MS": 8, "MT": 8, "RN": 8, "RO": 8, "RR": 8, "SE": 8,
    "TO": 8, "DF": 8,
}  # fmt: skip


def _cf_art_27(federais: int) -> int:
    """CF art. 27, caput: o triplo da bancada federal até 36; acima disso, +1
    por deputado federal além de 12."""
    return 3 * federais if federais <= 12 else 36 + (federais - 12)


#: A lista de conferência da spec 027 (plano de 29/09) — escrita à mão de
#: propósito, para que o teste abaixo confira a regra contra ela e as duas
#: contra `TOTAL_CADEIRAS`.
ASSEMBLEIAS = {
    "SP": 94, "MG": 77, "RJ": 70, "BA": 63, "RS": 55, "PR": 54, "PE": 49, "CE": 46,
    "MA": 42, "GO": 41, "PA": 41, "SC": 40, "PB": 36, "ES": 30, "PI": 30, "AL": 27,
    "AC": 24, "AM": 24, "AP": 24, "MS": 24, "MT": 24, "RN": 24, "RO": 24, "RR": 24,
    "SE": 24, "TO": 24,
}  # fmt: skip


def _ler(caminho: pathlib.Path) -> dict[str, Any]:
    return json.loads(caminho.read_text(encoding="utf-8"))


def _com_nv(envelope: dict[str, Any], nv: int, *, cargo: int) -> dict[str, Any]:
    """O mesmo agregado com outro `carg[].nv` — e `qe`/`vag` refeitos pela nossa
    conta, para que o arquivo continue coerente (os do TSE valem para o `nv`
    original). Só para montar casas de outro tamanho com votos reais."""
    saida = copy.deepcopy(envelope)
    carg = next(c for c in saida["carg"] if str(c["cd"]) == str(cargo))
    carg["nv"] = str(nv)
    if str(saida.get("and", "")).lower() != "n":
        entrada = extrair_entrada_proporcional(saida, cargo=cargo)
        resultado = distribuir_cadeiras(entrada.agremiacoes, nv)
        carg["qe"] = str(resultado.quociente_eleitoral)
        for agr in carg["agr"]:
            agr["vag"] = str(resultado.cadeiras.get(str(agr["n"]), 0))
    return saida


def _linha(cargo: int, uf: str, envelope: dict[str, Any], *, nivel: str | None = "uf") -> dict[str, Any]:
    """Uma linha de `snapshots` como a Fase 1 grava: o agregado da UF, com
    `nivel = "uf"` e os sentinelas `cod_zona = cod_municipio_tse = 0`."""
    linha: dict[str, Any] = {
        "cargo": cargo,
        "turno": 1,
        "uf": uf,
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "pct_apurado": 100.0,
        "payload": envelope,
    }
    if nivel is not None:
        linha["nivel"] = nivel
    return linha


def _eleitorado(envelopes: dict[str, dict[str, Any]], extra: dict[str, int] | None = None) -> dict[str, int]:
    """Eleitorado por UF = o `e.te` do próprio agregado (o que a tabela
    `eleitorado` diria), mais as UFs de `extra`."""
    base = {uf: int(env["e"]["te"]) for uf, env in envelopes.items()}
    return {**base, **(extra or {})}


@pytest.fixture
def ciclo(monkeypatch: pytest.MonkeyPatch):
    """Roda `_do_project` para o cargo pedido e devolve o que teria ido ao Edge,
    os logs e os alertas."""
    from api.model import project as proj

    logs: list[tuple[str, str, dict[str, Any]]] = []
    alertas: list[tuple[str, str, dict[str, Any]]] = []
    monkeypatch.setattr(proj, "_log", lambda level, msg, **ctx: logs.append((level, msg, ctx)))
    monkeypatch.setattr(
        proj, "_alert_slack", lambda level, msg, **ctx: alertas.append((level, msg, ctx))
    )

    def _rodar(
        cargo: int,
        snapshots: list[dict[str, Any]],
        eleitorado: dict[str, int],
        corpo: dict[str, Any] | None = None,
    ):
        logs.clear()
        alertas.clear()
        conn = _FakeConn(snapshots, eleitorado)
        publicados: list[tuple[dict, dict]] = []
        monkeypatch.setattr(proj, "_open_conn", lambda: conn)
        monkeypatch.setattr(
            proj,
            "post_edge_write",
            lambda payload, payloads_uf=None: publicados.append((payload, payloads_uf or {})),
        )
        status, resposta = proj._do_project(
            json.dumps(
                {"cargo": cargo, "turno": 1, "trigger_ts": "2026-10-04T21:00:00Z", **(corpo or {})}
            ).encode()
        )
        assert status == 200, resposta
        assert len(publicados) == 1, "o ciclo não publicou"
        payload, detalhes = publicados[0]
        return resposta, payload, detalhes, list(logs), list(alertas)

    return _rodar


def _alarmes_do_total(alertas: list[tuple[str, str, dict[str, Any]]]) -> list[dict[str, Any]]:
    return [ctx for _l, msg, ctx in alertas if "RF-124" in msg]


# ===========================================================================
# RF-278 — cobertura: o ramo, as UFs, o % apurado nacional
# ===========================================================================


def test_rf278_cargos_7_e_8_seguem_o_ramo_proporcional(monkeypatch: pytest.MonkeyPatch) -> None:
    """🔴 O teste que mais importa da frente P.

    `_do_project` desvia para o ciclo proporcional por `_e_proporcional`, que
    lê a tabela. Cargo que não está lá (ou está sem `proporcional: True`) cai
    CALADO no ramo majoritário — o de governador: bootstrap de share por
    número de urna, "líder", `p_vitoria` — e publica uma assembleia como se
    fosse uma corrida de um vencedor, sem erro nenhum.
    """
    from api.model import project as proj

    assert proj._e_proporcional(7) is True
    assert proj._e_proporcional(8) is True

    rotas: list[int] = []

    def _proporcional(req: Any, _t0: int) -> tuple[int, dict[str, Any]]:
        rotas.append(req.cargo)
        return 200, {"rota": "proporcional"}

    def _majoritario_proibido() -> Any:
        raise AssertionError("cargo proporcional abriu o banco pelo ramo majoritário")

    monkeypatch.setattr(proj, "_do_project_proporcional", _proporcional)
    monkeypatch.setattr(proj, "_open_conn", _majoritario_proibido)
    for cargo in (7, 8):
        status, resposta = proj._do_project(
            json.dumps({"cargo": cargo, "turno": 1, "trigger_ts": "2026-10-04T21:00:00Z"}).encode()
        )
        assert (status, resposta) == (200, {"rota": "proporcional"}), cargo
    assert rotas == [7, 8]

    # E a guarda de `compute_national` (número de urna se repete) vale para eles.
    for cargo in (7, 8):
        with pytest.raises(proj.CargoProporcionalError, match="Deputado (Estadual|Distrital)"):
            proj.compute_national(cargo, 1, {}, {})


def test_rf278_abrangencia_de_cada_cargo() -> None:
    assert len(cargos.UFS_BRASIL) == 27 and "ZZ" not in cargos.UFS_BRASIL
    for cd in (1, 3, 5, 6):
        assert cargos.ufs_do_cargo(cd) == cargos.UFS_BRASIL
    estadual = cargos.ufs_do_cargo(7)
    assert len(estadual) == 26 and "DF" not in estadual
    assert set(estadual) == set(ASSEMBLEIAS)
    assert cargos.ufs_do_cargo(8) == ("DF",)
    assert cargos.ufs_do_cargo(99) == ()


def test_rf278_todo_cargo_proporcional_declara_o_que_o_ciclo_le() -> None:
    """A tabela é o que o ciclo lê: um proporcional sem qualquer um destes
    campos quebraria em produção (cadência → `atualizacao_min`), publicaria
    total que cresce durante a noite (sem fato fixo) ou ficaria sem o painel
    "Votação" (fora de `CARGOS_COM_VOTACAO_UF`, em silêncio)."""
    from api.model import project as proj

    proporcionais = [c["cd"] for c in cargos.CARGOS if c["proporcional"]]
    assert proporcionais == [6, 7, 8]
    for cd in proporcionais:
        assert cargos.total_cadeiras(cd) is not None, cd
        assert cargos.vagas_em_disputa(cd) == cargos.total_cadeiras(cd), cd
        cadencia = cargos.cadencia_segundos(cd)
        assert cadencia is not None and cadencia % 60 == 0, cd
        assert cargos.ufs_do_cargo(cd), cd
        assert cargos.votos_por_eleitor(cd) == 1, cd
        assert cargos.vagas_por_uf(cd, default=-1) == -1, "proporcional não tem vaga fixa por UF"
        assert cd in proj.CARGOS_COM_VOTACAO_UF, cd
        assert cd not in proj.CARGOS_COM_CORRIDA, cd
    assert cargos.granularidade(7) == cargos.granularidade(8) == "uf"


def test_rf278_pct_nacional_pondera_so_as_ufs_do_cargo() -> None:
    """Até 29/09 o universo era a tabela `eleitorado` INTEIRA (com o `ZZ`)."""
    from api.model.project import pct_apurado_nacional_proporcional as pct

    eleitorado = {uf: 1_000_000 for uf in cargos.UFS_BRASIL}
    eleitorado["DF"] = 2_200_000
    eleitorado["ZZ"] = 700_000  # exterior — não vota para deputado nenhum

    # Distrital: o DF inteiro apurado é 100%, não 2,2/28,9 ≈ 7,6%.
    assert pct({"DF": 100.0}, eleitorado, cargos.ufs_do_cargo(8)) == pytest.approx(100.0)
    # Estadual: as 26 inteiras são 100% — o DF (sem assembleia) não pesa.
    todas_26 = {uf: 100.0 for uf in cargos.ufs_do_cargo(7)}
    assert pct(todas_26, eleitorado, cargos.ufs_do_cargo(7)) == pytest.approx(100.0)
    # Câmara: as 27 inteiras são 100% — o ZZ não fica no denominador.
    todas_27 = {uf: 100.0 for uf in cargos.UFS_BRASIL}
    assert pct(todas_27, eleitorado, cargos.ufs_do_cargo(6)) == pytest.approx(100.0)
    # Parcial: a UF ausente pesa cheio no denominador.
    assert pct({"SP": 50.0}, eleitorado, cargos.ufs_do_cargo(7)) == pytest.approx(50.0 / 26)
    # UF fora do cargo não entra nem no numerador.
    assert pct({"DF": 100.0}, eleitorado, cargos.ufs_do_cargo(7)) == 0.0
    # Sem eleitorado: média simples sobre as UFs do cargo, a ausente conta 0.
    assert pct({"DF": 80.0}, {}, cargos.ufs_do_cargo(8)) == pytest.approx(80.0)
    assert pct({"SP": 52.0}, {}, cargos.ufs_do_cargo(7)) == pytest.approx(2.0)


def test_rf278_distrital_com_o_df_inteiro_apurado_publica_100_por_cento(ciclo) -> None:
    df = _ler(DF8)
    df["e"]["esi"] = df["e"]["te"]  # todas as seções do DF totalizadas
    eleitorado = _eleitorado({"DF": df}, {uf: 5_000_000 for uf in cargos.UFS_BRASIL if uf != "DF"})
    eleitorado["ZZ"] = 700_000

    _r, payload, detalhes, _logs, _alertas = ciclo(8, [_linha(8, "DF", df)], eleitorado)

    assert set(detalhes) == {"DF"}
    assert payload["pct_apurado_total"] == pytest.approx(100.0)
    assert payload["bancada"]["ufs_aguardando"] == 0
    assert payload["bancada"]["ufs_calculadas"] == 1


def test_rf278_estadual_com_as_26_casas_nao_aguarda_nenhuma(ciclo) -> None:
    """E o sino do RF-124 passa a poder tocar com 26 (era "27", para sempre
    mudo nas assembleias)."""
    rr = _ler(RR7)
    envelopes = {uf: _com_nv(rr, nv, cargo=7) for uf, nv in ASSEMBLEIAS.items()}
    linhas = [_linha(7, uf, env) for uf, env in sorted(envelopes.items())]

    _r, payload, detalhes, _logs, alertas = ciclo(7, linhas, _eleitorado(envelopes))
    bancada = payload["bancada"]
    assert len(detalhes) == 26
    assert bancada["ufs_aguardando"] == 0
    assert bancada["ufs_calculadas"] == 26
    assert bancada["total_cadeiras"] == 1035
    assert bancada["cadeiras_atribuidas"] == 1035
    assert _alarmes_do_total(alertas) == []

    # Uma casa publicada com uma cadeira a MENOS: com as 26 presentes o sino
    # toca — e só toca porque o universo é 26. Esperando 27, 1.034 ≤ 1.035
    # seria "começo da noite" para sempre. (Com uma a MAIS tocaria de
    # qualquer jeito: soma acima da casa é conclusiva mesmo com UF faltando —
    # por isso o caso que discrimina é o de baixo.)
    for nv_sp, soma in ((93, 1034), (95, 1036)):
        envelopes["SP"] = _com_nv(rr, nv_sp, cargo=7)
        linhas = [_linha(7, uf, env) for uf, env in sorted(envelopes.items())]
        _r, payload, _d, logs, alertas = ciclo(7, linhas, _eleitorado(envelopes))
        (alarme,) = _alarmes_do_total(alertas)
        assert (alarme["esperado"], alarme["soma_publicada"]) == (1035, soma)
        assert any(level == "error" and "tamanho da casa" in msg for level, msg, _c in logs)
        assert payload["bancada"]["total_cadeiras"] == soma, "todas presentes ⇒ o total é o do TSE"
        assert payload["bancada"]["cadeiras_atribuidas"] == soma


def test_rf278_linha_de_uf_fora_do_cargo_e_descartada_com_alarme(ciclo) -> None:
    """Cargo 7 no DF não existe (o DF elege distrital). Uma linha dessas
    somaria a bancada de outra casa na das Assembleias."""
    rr = _ler(RR7)
    df = copy.deepcopy(rr)
    _r, payload, detalhes, logs, alertas = ciclo(
        7, [_linha(7, "RR", rr), _linha(7, "DF", df)], _eleitorado({"RR": rr, "DF": df})
    )
    assert set(detalhes) == {"RR"}
    assert [row["sigla"] for row in payload["por_uf"]] == ["RR"]
    assert any(
        level == "error" and "fora da abrangência" in msg and ctx["ufs"] == ["DF"]
        for level, msg, ctx in logs
    )
    assert any(ctx.get("ufs") == ["DF"] for _l, _m, ctx in alertas)


# ===========================================================================
# RF-280 — totais fixos
# ===========================================================================


def test_rf280_tamanho_das_casas_sai_da_cf_art_27() -> None:
    assert sum(BANCADA_FEDERAL.values()) == cargos.total_cadeiras(6) == 513
    for uf, estaduais in ASSEMBLEIAS.items():
        assert _cf_art_27(BANCADA_FEDERAL[uf]) == estaduais, uf
    assert sum(ASSEMBLEIAS.values()) == cargos.total_cadeiras(7) == 1035
    assert _cf_art_27(BANCADA_FEDERAL["DF"]) == cargos.total_cadeiras(8) == 24
    assert cargos.vagas_em_disputa(7) == 1035 and cargos.vagas_em_disputa(8) == 24


def _uf_real(sigla: str, envelope: dict[str, Any], cargo: int) -> UfProporcional:
    entrada = extrair_entrada_proporcional(envelope, cargo=cargo)
    assert entrada.lugares_a_preencher is not None
    return UfProporcional(
        uf=sigla,
        pct_apurado=7.0,
        entrada=entrada,
        resultado=distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher),
    )


def _publicar(ufs: list[UfProporcional], cargo: int) -> dict[str, Any]:
    payload, _detalhes = construir_payload_deputado(
        ufs=ufs,
        divergencias_por_uf={},
        ts_iso="2026-10-04T21:00:00+00:00",
        cargo=cargo,
        turno=1,
        atualizacao_min=5,
        ufs_conhecidas=len(cargos.ufs_do_cargo(cargo)),
        pct_apurado_total=1.0,
    )
    return payload


def test_rf280_duas_assembleias_no_ar_nao_encolhem_a_casa() -> None:
    """A lição de 19/09 (a Câmara "de 26 cadeiras"): com RR e AC no ar, a
    soma das presentes é 48; a casa continua tendo 1.035."""
    rr = _ler(RR7)
    bancada = _publicar([_uf_real("RR", rr, 7), _uf_real("AC", rr, 7)], 7)["bancada"]
    assert bancada["total_cadeiras"] == 1035
    assert bancada["cadeiras_atribuidas"] == 48
    assert bancada["total_cadeiras"] - bancada["cadeiras_atribuidas"] == 987, "o aguardando"
    assert bancada["ufs_aguardando"] == 24


def test_rf280_conferencia_do_total_com_26_casas_e_com_o_df() -> None:
    rr = _ler(RR7)
    casas = [_uf_real(uf, _com_nv(rr, nv, cargo=7), 7) for uf, nv in sorted(ASSEMBLEIAS.items())]
    assert conferir_total_de_cadeiras(ufs=casas, cargo=7, ufs_conhecidas=26) is None
    # 25 casas: o começo da noite, soma menor que a casa — nada a dizer.
    assert conferir_total_de_cadeiras(ufs=casas[:25], cargo=7, ufs_conhecidas=26) is None
    # 26 com uma cadeira a mais: divergência.
    errada = [*casas[:-1], _uf_real("TO", _com_nv(rr, 25, cargo=7), 7)]
    divergencia = conferir_total_de_cadeiras(ufs=errada, cargo=7, ufs_conhecidas=26)
    assert divergencia is not None
    assert (divergencia.nosso, divergencia.tse) == (1035, 1036)

    df_24 = _uf_real("DF", _com_nv(_ler(DF8), 24, cargo=8), 8)
    assert conferir_total_de_cadeiras(ufs=[df_24], cargo=8, ufs_conhecidas=1) is None
    df_real = _uf_real("DF", _ler(DF8), 8)
    divergencia = conferir_total_de_cadeiras(ufs=[df_real], cargo=8, ufs_conhecidas=1)
    assert divergencia is not None and (divergencia.nosso, divergencia.tse) == (24, 28)


def test_rf280_df_do_simulado_com_nv_28_publica_28_e_alarma(ciclo) -> None:
    """O simulado de 29/09 serviu o DF com `nv = 28` (a casa tem 24). Com o
    fato fixo sozinho a tela diria "24 cadeiras" com 28 distribuídas
    ("aguardando −4"). Com todas as UFs do cargo presentes, o total é o do
    TSE, e a divergência grita."""
    df = _ler(DF8)
    _r, payload, _d, _logs, alertas = ciclo(8, [_linha(8, "DF", df)], _eleitorado({"DF": df}))
    bancada = payload["bancada"]
    assert (bancada["total_cadeiras"], bancada["cadeiras_atribuidas"]) == (28, 28)
    (alarme,) = _alarmes_do_total(alertas)
    assert (alarme["esperado"], alarme["soma_publicada"]) == (24, 28)

    df_24 = _com_nv(df, 24, cargo=8)
    _r, payload, _d, _logs, alertas = ciclo(8, [_linha(8, "DF", df_24)], _eleitorado({"DF": df_24}))
    assert (payload["bancada"]["total_cadeiras"], payload["bancada"]["cadeiras_atribuidas"]) == (24, 24)
    assert _alarmes_do_total(alertas) == []

    # O lado de baixo: o TSE publica MENOS que a casa. É o caso que separa
    # "todas presentes ⇒ o do TSE" de "nunca abaixo do fixo": o total é 23,
    # não 24 (senão "aguardando 1" para sempre), e o sino toca.
    df_23 = _com_nv(df, 23, cargo=8)
    _r, payload, _d, _logs, alertas = ciclo(8, [_linha(8, "DF", df_23)], _eleitorado({"DF": df_23}))
    assert (payload["bancada"]["total_cadeiras"], payload["bancada"]["cadeiras_atribuidas"]) == (23, 23)
    (alarme,) = _alarmes_do_total(alertas)
    assert (alarme["esperado"], alarme["soma_publicada"]) == (24, 23)


def test_rf280_casa_faltando_nunca_publica_total_menor_que_o_distribuido() -> None:
    """Com UFs faltando o total é o fato fixo — mas nunca MENOR que o que as
    presentes já publicaram (UF que falta só soma). Passar do fato com UFs
    faltando é divergência conclusiva, e a conferência a acusa."""
    rr = _ler(RR7)
    casas = [_uf_real("SP", _com_nv(rr, 600, cargo=7), 7), _uf_real("MG", _com_nv(rr, 500, cargo=7), 7)]
    bancada = _publicar(casas, 7)["bancada"]
    assert bancada["total_cadeiras"] == 1100
    assert bancada["cadeiras_atribuidas"] <= bancada["total_cadeiras"]
    divergencia = conferir_total_de_cadeiras(ufs=casas, cargo=7, ufs_conhecidas=26)
    assert divergencia is not None and (divergencia.nosso, divergencia.tse) == (1035, 1100)


def test_rf280_atualizacao_min_sai_da_cadencia_do_cargo() -> None:
    from api.model.project import atualizacao_min_do_cargo

    assert atualizacao_min_do_cargo(6) == cargos.ATUALIZACAO_MIN_DEPUTADO == 30
    assert atualizacao_min_do_cargo(7) == 5
    assert atualizacao_min_do_cargo(8) == 5
    with pytest.raises(ValueError, match="sem cadência"):
        atualizacao_min_do_cargo(99)


# ===========================================================================
# RF-285 — Fase 1 em resumo, e a Conferência que não compara o arquivo consigo
# ===========================================================================


def test_rf285_zonas_para_o_modelo_nao_avisa_em_cargo_de_resumo(monkeypatch: pytest.MonkeyPatch) -> None:
    """Para 7/8 o agregado como entrada É o caminho normal da Fase 1; um `warn`
    em todo ciclo saudável é o aviso que ninguém lê na noite em que importa.
    Para cargo configurado em zona continua `warn`."""
    from api.model import project as proj

    logs: list[tuple[str, str]] = []
    monkeypatch.setattr(proj, "_log", lambda level, msg, **_ctx: logs.append((level, msg)))
    agregado = _linha(7, "RR", {})

    for cargo, nivel_esperado in ((7, "info"), (8, "info"), (6, "warn"), (1, "warn"), (None, "warn")):
        logs.clear()
        assert proj.zonas_para_o_modelo([], [agregado], cargo=cargo) == [agregado]
        assert [level for level, _m in logs] == [nivel_esperado], cargo


def test_rf285_conferencia_em_resumo_nao_compara_o_agregado_consigo_mesmo() -> None:
    """Sobre o agregado REAL de cargo 6 de RR com totalização final (números do
    TSE, não nossos): com a parcial saída do próprio agregado, `eleitorado` e
    `votos_validos` ficam FORA de `comparou` — seriam "batem" por construção —,
    e a conta (`algoritmo`) e os `eleitos` continuam sendo comparados."""
    env = _ler(DEP_RR / "m3-final-tf" / "rr-c0006-e021272-u.json")
    entrada = extrair_entrada_proporcional(env, cargo=6)
    te = int(env["e"]["te"])
    assert entrada.lugares_a_preencher is not None
    parcial = distribuir_cadeiras(entrada.agremiacoes, entrada.lugares_a_preencher)

    zonas = conferir_agregado_da_uf(
        env, cargo=6, eleitorado_lido=te, validos_lidos=entrada.votos_validos_tse, resultado_parcial=parcial
    )
    assert zonas.comparou == ("eleitorado", "algoritmo", "eleitos", "votos_validos")

    resumo = conferir_agregado_da_uf(
        env,
        cargo=6,
        eleitorado_lido=te,
        validos_lidos=entrada.votos_validos_tse,
        resultado_parcial=parcial,
        parcial_do_agregado=True,
    )
    assert resumo.comparou == ("algoritmo", "eleitos")
    assert resumo.estado == "confere" and resumo.divergencias == ()

    # O que decide é a ORIGEM da parcial, não a igualdade: mesmo com números
    # "lidos" diferentes, no resumo eles não são comparados.
    mentira = conferir_agregado_da_uf(
        env,
        cargo=6,
        eleitorado_lido=te - 1,
        validos_lidos=(entrada.votos_validos_tse or 0) + 1,
        resultado_parcial=parcial,
        parcial_do_agregado=True,
    )
    assert mentira.comparou == ("algoritmo", "eleitos")
    assert mentira.divergencias == ()


@pytest.mark.parametrize(("arquivo", "cargo"), [(RR7, 7), (SP7, 7), (DF8, 8)])
def test_rf285_conta_das_assembleias_confere_com_o_tse_nos_ea20_reais(arquivo: pathlib.Path, cargo: int) -> None:
    """A prova NÃO circular da frente P: sobre os agregados reais de cargo 7/8
    do simulado (RR 24, SP 94, DF 28 cadeiras, ~7% apurado), o quociente e as
    cadeiras por agremiação que a NOSSA conta dá são os que o TSE publicou no
    mesmo arquivo."""
    env = _ler(arquivo)
    conferencia = conferir_agregado_da_uf(env, cargo=cargo, parcial_do_agregado=True)
    assert conferencia.comparou == ("algoritmo",)
    assert conferencia.estado == "confere", conferencia.divergencias
    # E o arquivo de um cargo não é lido como o de outro.
    assert extrair_entrada_proporcional(env, cargo=6).agremiacoes == []


#: O que `conferir_uf`/`conferir_nacional` (contrato v2 da spec 026, escritos
#: para o cargo 6 em zona) recebem no lugar da `projecao` AUSENTE do resumo:
#: um estado não liberado. Com ele, as invariantes de lá passam a exigir que
#: nenhuma marca, número ou faixa de projeção apareça no objeto — que é
#: exatamente o que "projeção não calculada" tem de garantir.
_PROJECAO_AUSENTE_NA_CONFERENCIA = {
    "estado": "indisponivel",
    "motivo": "interruptor",
    "pct_minimo": 25,
    "zonas_apuradas": 0,
    "zonas_total": 0,
}


def _como_cargo_6_em_zona(detalhe: dict[str, Any]) -> dict[str, Any]:
    """O objeto de resumo nos termos do contrato da 026: cargo 6 (o número é
    conferido à parte) e a projeção ausente como não liberada."""
    assert "projecao" not in detalhe
    return {**detalhe, "cargo": 6, "projecao": _PROJECAO_AUSENTE_NA_CONFERENCIA}


def _nacional_em_zona(payload: dict[str, Any]) -> dict[str, Any]:
    assert all("projecao" not in row for row in payload["por_uf"])
    return {
        **payload,
        "por_uf": [{**row, "projecao": _PROJECAO_AUSENTE_NA_CONFERENCIA} for row in payload["por_uf"]],
    }


_NAO_COMPAROU_ELEITORADO = {"comparacao": "eleitorado", "motivo": "granularidade_uf"}
_NAO_COMPAROU_VALIDOS = {"comparacao": "votos_validos", "motivo": "granularidade_uf"}


def test_rf285_ciclo_do_estadual_em_resumo_publica_o_payload_v2(ciclo) -> None:
    rr, sp = _ler(RR7), _ler(SP7)
    resposta, payload, detalhes, logs, _alertas = ciclo(
        7, [_linha(7, "RR", rr), _linha(7, "SP", sp)], _eleitorado({"RR": rr, "SP": sp})
    )

    assert resposta["computed"] is True and resposta["uf_count"] == 2
    assert payload["cargo"] == 7
    assert payload["atualizacao_min"] == 5
    assert payload["bancada"]["total_cadeiras"] == 1035
    assert payload["bancada"]["ufs_aguardando"] == 24
    for uf, nv in (("RR", 24), ("SP", 94)):
        d = detalhes[uf]
        assert d["cargo"] == 7 and d["contrato"] == 2, uf
        assert d["lugares_a_preencher"] == nv, "o tamanho da casa sai do `carg[].nv` (RF-124)"
        assert sum(a["cadeiras"] for a in d["agremiacoes"]) + d["vagas_nao_preenchidas"] == nv
        assert all(a["candidatos"] for a in d["agremiacoes"]), "as listas por agremiação saem"
        assert d["granularidade"] == "uf", uf
        # Conferência honesta: a conta foi comparada; o eleitorado, declarado
        # NÃO comparado (design 027 § 3.2). Válidos: só com `tf = "s"`.
        assert d["conferencia"]["comparou"] == ["algoritmo"], uf
        assert d["conferencia"]["nao_comparou"] == [_NAO_COMPAROU_ELEITORADO], uf
        assert d["conferencia"]["estado"] == "confere", uf
        assert d["quociente_eleitoral_tse"] == d["quociente_eleitoral"], uf
        # Projeção: nem calculada, nem estado de trava (RF-285).
        assert "projecao" not in d, uf
        # Uma "zona" só (o agregado) ⇒ sem intervalo de cadeiras (RF-127).
        assert all("cadeiras_ci95" not in a for a in d["agremiacoes"])
        conferir_uf(_como_cargo_6_em_zona(d))
    conferir_nacional(
        _nacional_em_zona(payload), {uf: _como_cargo_6_em_zona(d) for uf, d in detalhes.items()}
    )

    serial = json.dumps([payload, detalhes], ensure_ascii=False)
    assert "Câmara" not in serial and "Deputado Federal" not in serial
    assert "cadeiras_projetadas" not in serial
    assert not [msg for level, msg, _c in logs if level == "warn" and "nivel=zona" in msg]
    assert [ctx["cargo"] for level, msg, ctx in logs if "resumo" in msg] == [7]


def test_rf285_resumo_com_totalizacao_final_confere_os_eleitos(ciclo) -> None:
    """Sintético (a captura real não viu `tf = "s"` nos cargos 7/8): a
    comparação `eleitos` — a que prova as marcas oficiais — roda em resumo.
    Aqui ela confere POR CONSTRUÇÃO (ver o README da fixture); o que o teste
    prova é que ela é FEITA, e que eleitorado/válidos não."""
    final = _ler(SINTETICO / "m3-final-tf" / "rr-c0007-e021272-u.json")
    _r, _p, detalhes, _logs, _alertas = ciclo(7, [_linha(7, "RR", final)], _eleitorado({"RR": final}))
    rr = detalhes["RR"]
    assert rr["totalizacao_final"] is True
    assert rr["conferencia"]["comparou"] == ["algoritmo", "eleitos"]
    assert rr["conferencia"]["nao_comparou"] == [_NAO_COMPAROU_ELEITORADO, _NAO_COMPAROU_VALIDOS]
    assert rr["conferencia"]["estado"] == "confere"
    marcas = [c.get("tse") for a in rr["agremiacoes"] for c in a["candidatos"] if c.get("tse")]
    assert sum(1 for m in marcas if m.startswith("eleito")) == 24


def test_rf285_resumo_antes_do_primeiro_boletim_fica_aguardando(ciclo) -> None:
    zero = _ler(SINTETICO / "m0-zero" / "rr-c0007-e021272-u.json")
    resposta, payload, detalhes, _logs, _alertas = ciclo(7, [_linha(7, "RR", zero)], _eleitorado({"RR": zero}))
    rr = detalhes["RR"]
    assert resposta["computed"] is False
    assert rr["quociente_eleitoral"] is None and rr["lugares_a_preencher"] == 24
    assert rr["conferencia"] == {
        "estado": "sem_dado_tse",
        "boletim_dado_ts": rr["conferencia"]["boletim_dado_ts"],
        "totalizacao_final": False,
        "comparou": [],
        "divergencias": [],
        "nao_comparou": [_NAO_COMPAROU_ELEITORADO],
    }
    assert rr["granularidade"] == "uf" and "projecao" not in rr
    assert payload["bancada"]["cadeiras_atribuidas"] == 0
    assert payload["bancada"]["total_cadeiras"] == 1035


def test_rf285_interruptor_ligado_em_resumo_nao_calcula_a_projecao(ciclo, monkeypatch: pytest.MonkeyPatch) -> None:
    """Se o interruptor das assembleias for ligado ainda na Fase 1, nada muda:
    em resumo a projeção não é calculada (design 027 § 3.2) — nem a trava. A
    projeção das assembleias é da Fase 2 (zonas)."""
    from api.model import project as proj

    def _proibido(**_k: Any) -> Any:
        raise AssertionError("projeção (ou trava) calculada em modo resumo")

    monkeypatch.setattr(proj, "_projecao_da_uf", _proibido)
    sp = _ler(SP7)
    sp["e"]["esi"] = sp["e"]["te"]  # nem com 100% apurado
    _r, payload, detalhes, logs, _alertas = ciclo(
        7, [_linha(7, "SP", sp)], _eleitorado({"SP": sp}), {"projecao_dep": {"ligada": True}}
    )
    assert "projecao" not in detalhes["SP"]
    assert "projecao" not in payload["por_uf"][0]
    assert "projetad" not in json.dumps([payload, detalhes])
    (linha_log,) = [ctx for _l, msg, ctx in logs if msg == "dep_projecao"]
    assert linha_log["ufs"] == [], "nenhuma UF projetada em resumo"


def test_rf285_cargo_6_em_zona_publica_granularidade_zona_e_o_resto_da_026(ciclo) -> None:
    """O 6 continua por zona: `granularidade: "zona"`, a projeção como na 026
    (estado de trava presente) e a Conferência sem `nao_comparou` — ela compara
    o eleitorado da soma das zonas com o do agregado, como sempre."""
    momento = DEP_RR / "m2-tardio-pst94"
    linhas: list[dict[str, Any]] = []
    for arquivo in sorted(momento.glob("rr?????-z????-c0006-e021272-u.json")):
        mun, zona = re.match(r"rr(\d{5})-z(\d{4})", arquivo.name).groups()  # type: ignore[union-attr]
        linhas.append(
            {**_linha(6, "RR", _ler(arquivo), nivel="zona"), "cod_municipio_tse": int(mun), "cod_zona": int(zona)}
        )
    assert len(linhas) == 4
    agregado = _ler(momento / "rr-c0006-e021272-u.json")
    linhas.append(_linha(6, "RR", agregado))

    _r, payload, detalhes, _logs, _alertas = ciclo(6, linhas, _eleitorado({"RR": agregado}))
    rr = detalhes["RR"]
    assert rr["granularidade"] == "zona"
    assert rr["projecao"]["motivo"] == "interruptor" and rr["projecao"]["zonas_total"] == 4
    assert payload["por_uf"][0]["projecao"] == rr["projecao"]
    assert "nao_comparou" not in rr["conferencia"]
    assert "eleitorado" in rr["conferencia"]["comparou"]
    assert payload["atualizacao_min"] == 30
    assert payload["bancada"]["total_cadeiras"] == 513


# ===========================================================================
# A fixture sintética é a transformação declarada, e nada mais
# ===========================================================================


def _sem_os_campos_declarados(envelope: dict[str, Any]) -> dict[str, Any]:
    """O envelope sem os campos que o README da fixture declara mudados."""
    saida = copy.deepcopy(envelope)
    carg = saida["carg"][0]
    for chave in ("cd", "nv", "qe", "nmm", "nmn", "nmf"):
        carg.pop(chave, None)
    for agr in carg["agr"]:
        agr.pop("vag", None)
        for par in agr["par"]:
            for cand in par["cand"]:
                cand.pop("st", None)
                cand.pop("e", None)
    return saida


def test_fixture_sintetica_e_a_transformacao_declarada() -> None:
    gerados = gerar()
    assert set(gerados) == {"m0-zero", "m3-final-tf"}
    for momento, envelope in gerados.items():
        disco = (SINTETICO / momento / "rr-c0007-e021272-u.json").read_text(encoding="utf-8")
        assert serializar(envelope) == disco, f"{momento}: a pasta derivou do gerador"
        # Tirando os campos declarados no README, é o arquivo real de cargo 6.
        original = _ler(DEP_RR / momento / "rr-c0006-e021272-u.json")
        assert _sem_os_campos_declarados(envelope) == _sem_os_campos_declarados(original), momento
        assert envelope["carg"][0]["cd"] == "7" and envelope["carg"][0]["nv"] == "24"


# ===========================================================================
# RF-290 — o golden de 2022, parametrizado por cargo
# ===========================================================================


def _script_golden() -> Any:
    caminho = RAIZ / "scripts" / "build-cadeiras-golden.py"
    spec = importlib.util.spec_from_file_location("build_cadeiras_golden", caminho)
    assert spec is not None and spec.loader is not None
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


_CAMPOS_CAND = [
    "DT_GERACAO", "CD_CARGO", "NR_TURNO", "SQ_CANDIDATO", "QT_VOTOS_NOMINAIS_VALIDOS",
    "NR_FEDERACAO", "SG_FEDERACAO", "NR_PARTIDO", "SG_PARTIDO", "DS_SIT_TOT_TURNO",
]  # fmt: skip
_CAMPOS_PART = ["CD_CARGO", "NR_TURNO", "NR_PARTIDO", "QT_VOTOS_LEGENDA_VALIDOS"]


def _escrever_csv(caminho: pathlib.Path, campos: list[str], linhas: list[dict[str, Any]]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with caminho.open("w", encoding="latin-1", newline="") as fh:
        escritor = csv.DictWriter(fh, fieldnames=campos, delimiter=";")
        escritor.writeheader()
        escritor.writerows(linhas)


def _csvs_de_uma_uf(
    cargo: str, agremiacoes: list[dict[str, Any]], eleitos_qp: set[int], eleitos: set[int], geracao: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Linhas de candidato e de partido que o script leria para produzir
    exatamente `agremiacoes` (a forma da fixture)."""
    cand: list[dict[str, Any]] = []
    part: list[dict[str, Any]] = []
    for agr in agremiacoes:
        cod = agr["cod"]
        federacao = cod.startswith("F")
        numero = cod[1:]
        nr_partido = f"fed{numero}" if federacao else numero
        for sq, votos in agr["candidatos"]:
            if sq in eleitos_qp:
                situacao = "ELEITO POR QP"
            elif sq in eleitos:
                situacao = "ELEITO POR MÉDIA"
            else:
                situacao = "NÃO ELEITO"
            cand.append(
                {
                    "DT_GERACAO": geracao,
                    "CD_CARGO": cargo,
                    "NR_TURNO": "1",
                    "SQ_CANDIDATO": str(sq),
                    "QT_VOTOS_NOMINAIS_VALIDOS": str(votos),
                    "NR_FEDERACAO": numero if federacao else "-1",
                    "SG_FEDERACAO": agr["rotulo"] if federacao else "#NULO#",
                    "NR_PARTIDO": nr_partido,
                    "SG_PARTIDO": "X" if federacao else agr["rotulo"],
                    "DS_SIT_TOT_TURNO": situacao,
                }
            )
        part.append(
            {
                "CD_CARGO": cargo,
                "NR_TURNO": "1",
                "NR_PARTIDO": nr_partido,
                "QT_VOTOS_LEGENDA_VALIDOS": str(agr["legenda"]),
            }
        )
    return cand, part


def _rodar_script(monkeypatch: pytest.MonkeyPatch, pasta: pathlib.Path, argv: list[str]) -> int:
    monkeypatch.chdir(pasta)
    return _script_golden().main(argv)


def test_rf290_golden_exige_o_cargo_e_so_aceita_proporcional() -> None:
    script = _script_golden()
    assert script.CARGOS_PROPORCIONAIS == (6, 7, 8)
    with pytest.raises(SystemExit):
        script.main([])
    with pytest.raises(SystemExit):
        script.main(["--cargo", "5"])
    assert str(script.saida_do_cargo(6)) == "tests/fixtures/model/cadeiras-golden-2022.json"
    assert str(script.saida_do_cargo(7)) == "tests/fixtures/model/cadeiras-golden-2022-c7.json"
    assert str(script.saida_do_cargo(8)) == "tests/fixtures/model/cadeiras-golden-2022-c8.json"


def test_rf290_golden_do_cargo_6_sai_byte_a_byte_o_de_antes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    """Sem os 8 GB de 2022 (o dono os baixa no navegador), o teste REMONTA os
    CSVs a partir da fixture commitada — com linhas de cargo 7 e 8 no meio,
    que o `--cargo 6` tem de ignorar — e exige que o script parametrizado
    devolva a MESMA fixture, byte a byte."""
    bruto = GOLDEN_6.read_bytes()
    golden = json.loads(bruto)
    (geracao,) = re.findall(r"\['([^']+)'\]", golden["_nota"])
    base = tmp_path / "build" / "tse-archives"
    for uf, dados in golden["ufs"].items():
        cand, part = _csvs_de_uma_uf(
            "6", dados["agremiacoes"], set(dados["eleitos_por_qp_tse"]), set(dados["eleitos_tse"]), geracao
        )
        # Ruído de outro cargo no mesmo arquivo (como no dataset real).
        ruido_c, ruido_p = _csvs_de_uma_uf(
            "7", [{"cod": "P99", "rotulo": "RUIDO", "legenda": 5, "candidatos": [[1, 999_999]]}], set(), {1}, geracao
        )
        _escrever_csv(base / "votacao_candidato_munzona_2022" / f"votacao_candidato_munzona_2022_{uf}.csv", _CAMPOS_CAND, cand + ruido_c)
        _escrever_csv(base / "votacao_partido_munzona_2022" / f"votacao_partido_munzona_2022_{uf}.csv", _CAMPOS_PART, part + ruido_p)

    assert _rodar_script(monkeypatch, tmp_path, ["--cargo", "6"]) == 0
    assert (tmp_path / "tests" / "fixtures" / "model" / "cadeiras-golden-2022.json").read_bytes() == bruto


def _mini_uf(cargo: str, vagas: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidatos = [[int(f"{cargo}{i:05d}"), 10_000 - i] for i in range(vagas + 2)]
    return _csvs_de_uma_uf(
        cargo,
        [{"cod": "P10", "rotulo": "PA", "legenda": 100, "candidatos": candidatos}],
        set(),
        {sq for sq, _v in candidatos[:vagas]},
        "11/09/2026",
    )


def test_rf290_golden_do_distrital_le_so_o_df(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path) -> None:
    base = tmp_path / "build" / "tse-archives"
    por_uf = {"DF": [("6", 8), ("8", 24)], "SP": [("6", 70), ("7", 94)]}
    for uf, cargos_da_uf in por_uf.items():
        cand: list[dict[str, Any]] = []
        part: list[dict[str, Any]] = []
        for cargo, vagas in cargos_da_uf:
            c, p = _mini_uf(cargo, vagas)
            cand += c
            part += p
        _escrever_csv(base / "votacao_candidato_munzona_2022" / f"votacao_candidato_munzona_2022_{uf}.csv", _CAMPOS_CAND, cand)
        _escrever_csv(base / "votacao_partido_munzona_2022" / f"votacao_partido_munzona_2022_{uf}.csv", _CAMPOS_PART, part)

    assert _rodar_script(monkeypatch, tmp_path, ["--cargo", "8"]) == 0
    saida = json.loads((tmp_path / "tests" / "fixtures" / "model" / "cadeiras-golden-2022-c8.json").read_text())
    assert list(saida["ufs"]) == ["DF"]
    assert saida["ufs"]["DF"]["vagas"] == 24
    assert all(str(c[0]).startswith("8") for a in saida["ufs"]["DF"]["agremiacoes"] for c in a["candidatos"])

    # O 7 com só SP: faltam 25 casas e 941 cadeiras — sai com erro (exit 2),
    # e a fixture do 6 não é tocada.
    assert _rodar_script(monkeypatch, tmp_path, ["--cargo", "7"]) == 2
    assert (tmp_path / "tests" / "fixtures" / "model" / "cadeiras-golden-2022-c7.json").exists()
    assert not (tmp_path / "tests" / "fixtures" / "model" / "cadeiras-golden-2022.json").exists()
