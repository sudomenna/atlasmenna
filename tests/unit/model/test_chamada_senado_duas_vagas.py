"""tests/unit/model/test_chamada_senado_duas_vagas.py

2026-09-29 — decisão do dono: "são 2 senadores eleitos" em cada estado. A tela
passou a marcar como eleitos (o ✓ de corrida chamada no balão do mapa) os DOIS
primeiros quando a UF de Senador é chamada — então `por_uf[].chamada` tem de
querer dizer "as duas vagas decididas", não "o líder folgado".

O que este arquivo trava (cada caso nomeia a mutação que mata):

  1. Senado (`vagas=2`) chama pela margem da ÚLTIMA vaga — 2º − 3º que
     competem —, nunca pela do 1º sobre o 2º (a regra antiga);
  2. `> 10` estrito, na base publicada;
  3. menos candidaturas que `vagas + 1` ⇒ `False` (a margem não existe);
  4. anulada fora da conta: o 3º que disputa sobe para a 2ª vaga
     (ADR-0053 / RF-213) — ponta a ponta por `build_edge_payload`;
  5. Presidente/Governador (`vagas` ausente) ⇒ a regra de sempre, 1º − 2º.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.model.project import (
    LIMIAR_CHAMADA_PP,
    AnuladosNaDecisao,
    build_edge_payload,
    chamada_da_corrida,
)


def _c(cand: int, pct: float) -> dict[str, Any]:
    return {"candidato_id": cand, "pct_projetado": pct}


# ---------------------------------------------------------------------------
# 1–3. A função
# ---------------------------------------------------------------------------


def test_senado_nao_chama_com_segunda_vaga_empatada() -> None:
    """Mata "Senado usa a margem 1º − 2º": 40 / 29,9 / 29,8 tem 10,1 pp entre o
    1º e o 2º (a regra antiga chamaria) e 0,1 pp na 2ª vaga."""
    competem = [_c(1, 40.0), _c(2, 29.9), _c(3, 29.8)]
    margem_1_2 = 40.0 - 29.9
    assert margem_1_2 > LIMIAR_CHAMADA_PP  # a fixture discrimina, de fato
    assert chamada_da_corrida(competem, 2, None, margem_1_2) is False


def test_senado_chama_quando_a_segunda_vaga_esta_decidida() -> None:
    """Mata "Senado nunca chama" e "vagas=1 no Senado": 45 / 44 / 20 tem 1 pp
    entre 1º e 2º (vaga única NÃO chamaria) e 24 pp na 2ª vaga."""
    competem = [_c(1, 45.0), _c(2, 44.0), _c(3, 20.0)]
    margem_1_2 = 1.0
    assert chamada_da_corrida(competem, 2, None, margem_1_2) is True
    # A mesma corrida lida como vaga única não é chamada — é isto que torna o
    # caso acima incapaz de passar com `vagas` ignorado.
    assert chamada_da_corrida(competem, None, None, margem_1_2) is False


def test_limiar_estrito() -> None:
    """Mata `>=`: 2ª vaga com exatamente 10 pp não é chamada."""
    competem = [_c(1, 50.0), _c(2, 30.0), _c(3, 20.0)]
    assert chamada_da_corrida(competem, 2, None, 20.0) is False
    competem[2] = _c(3, 19.99)
    assert chamada_da_corrida(competem, 2, None, 20.0) is True


def test_sem_terceiro_que_disputa_nao_chama() -> None:
    """Mata o `IndexError` e o "sem adversário = decidido"."""
    assert chamada_da_corrida([_c(1, 70.0), _c(2, 30.0)], 2, None, 40.0) is False
    assert chamada_da_corrida([], 2, None, 0.0) is False


def test_base_publicada() -> None:
    """A margem da 2ª vaga é medida na base publicada (`na_disputa`): com fator
    1,25 os 32 / 23,9 viram 40 / 29,875 — 10,125 pp, chamada; sem o fator,
    8,1 pp, não. Mata "mede a 2ª vaga sobre `vvc` cru"."""
    competem = [_c(1, 40.0), _c(2, 32.0), _c(3, 23.9)]
    assert chamada_da_corrida(competem, 2, None, 8.0) is False  # 8,1 pp
    assert chamada_da_corrida(competem, 2, 1.25, 10.0) is True  # 10,125 pp


def test_vaga_unica_segue_a_regra_de_sempre() -> None:
    """Governador/Presidente: só a margem 1º − 2º conta, byte a byte."""
    competem = [_c(1, 45.0), _c(2, 34.0), _c(3, 33.0)]
    assert chamada_da_corrida(competem, None, None, 11.0) is True
    assert chamada_da_corrida(competem, 1, None, 11.0) is True
    assert chamada_da_corrida(competem, None, None, 10.0) is False


# ---------------------------------------------------------------------------
# 4–5. Ponta a ponta — `build_edge_payload`
# ---------------------------------------------------------------------------


def _linha(cand: int, pct: float, cargo: int) -> dict[str, Any]:
    return {
        "cargo": cargo,
        "turno": 1,
        "uf": "SP",
        "candidato_id": cand,
        "pct_projetado": pct,
        "pct_apurado": 60.0,
    }


def _sp(
    shares: list[tuple[int, float]],
    *,
    cargo: int,
    vagas: int | None,
    anulados: AnuladosNaDecisao | None = None,
) -> dict[str, Any]:
    rows = [_linha(c, p, cargo) for c, p in shares]
    payload = build_edge_payload(
        cargo=cargo,
        turno=1,
        ts_iso="2026-10-04T20:00:00Z",
        uf_rows=rows,
        national_rows=[
            {"candidato_id": c, "pct_projetado": p, "rank": i + 1}
            for i, (c, p) in enumerate(shares)
        ],
        eleitorado_total_by_uf={"SP": 34_000_000},
        vagas=vagas,
        anulados=anulados,
    )
    (sp,) = [u for u in payload["por_uf"] if u["sigla"] == "SP"]
    return sp


def test_payload_senado_nao_chama_com_segunda_vaga_aberta() -> None:
    """A fiação: `build_edge_payload` passa `vagas` a `chamada_da_corrida`.
    Mata "a linha de `chamada` voltou a ser `margem > 10`" (40/29,9/29,8)."""
    sp = _sp([(1, 40.0), (2, 29.9), (3, 29.8)], cargo=5, vagas=2)
    assert sp["margem_projetada"] > LIMIAR_CHAMADA_PP  # a regra antiga chamaria
    assert sp["chamada"] is False
    assert sp["bucket"] == "indefinido"


def test_payload_senado_chama_as_duas_vagas() -> None:
    sp = _sp([(1, 45.0), (2, 44.0), (3, 11.0)], cargo=5, vagas=2)
    assert sp["chamada"] is True
    assert sp["bucket"] == "chamada"


def test_payload_senado_anulada_sai_e_o_terceiro_sobe() -> None:
    """Mata "anulada conta como 2ª vaga": 45 / ANUL 30 / 25 / 10. Contando a
    anulada, a 2ª vaga seria 30 − 25 = 5 pp (não chamaria); sem ela, quem
    disputa a 2ª vaga é o 25 contra o 10 — 15 pp na base publicada."""
    anul = AnuladosNaDecisao(
        nacional=frozenset(), por_uf={"SP": frozenset({9})}, uf_segue_nacional=False
    )
    sp = _sp([(1, 45.0), (9, 30.0), (2, 25.0), (3, 10.0)], cargo=5, vagas=2, anulados=anul)
    assert sp["chamada"] is True
    sem_anulada_na_conta = _sp([(1, 45.0), (9, 30.0), (2, 25.0), (3, 10.0)], cargo=5, vagas=2)
    assert sem_anulada_na_conta["chamada"] is False  # a fixture discrimina


@pytest.mark.parametrize("cargo", [1, 3])
def test_payload_vaga_unica_intocado(cargo: int) -> None:
    """Governador e Presidente (sem `vagas`): 45 / 34 / 33 — 11 pp do 1º sobre o
    2º ⇒ chamada, mesmo com o 2º e o 3º empatados. Mata "a regra de duas vagas
    vazou para a vaga única"."""
    uf = _sp([(1, 45.0), (2, 34.0), (3, 33.0)], cargo=cargo, vagas=None)
    assert uf["chamada"] is True
