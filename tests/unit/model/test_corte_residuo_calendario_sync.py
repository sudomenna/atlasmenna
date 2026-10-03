"""Guarda de sincronia: o corte de resíduo do simulado (Python) × o calendário
de corridas do site (TypeScript).

`api/model/project.py::_CORTE_RESIDUO_SIMULADO_POR_TURNO` copia à mão os
instantes de `lib/config/calendar.ts::CALENDAR_2026`, porque o módulo Python
não importa TS. Mesmo risco — e mesmo remédio — de `test_cargos_sync.py`: o
espelho envelhece em silêncio se o calendário mudar (ex.: TSE adiar o 2º
turno) e ninguém lembrar da cópia. Achado do constitution-guard em 27/09.

A regra comparada: o corte de cada turno é o **início mais tardio** daquele
turno no calendário — para o turno 1, 04/10 (e não a entrada "pré-apuração"
de 01/01); para o turno 2, 25/10.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path

from api.model.project import _CORTE_RESIDUO_SIMULADO_POR_TURNO, _VIRADA_PRODUCAO_1T

TS_PATH = Path(__file__).resolve().parents[3] / "lib" / "config" / "calendar.ts"

_ENTRADA = re.compile(
    r'\{\s*start:\s*"(?P<start>[^"]+)",\s*cargo:\s*"(?P<cargo>[a-z]+)",\s*turno:\s*(?P<turno>\d)\s*\}'
)


def _inicios_por_turno() -> dict[int, list[datetime]]:
    texto = TS_PATH.read_text(encoding="utf-8")
    bloco = texto.split("export const CALENDAR_2026", 1)[1].split("];", 1)[0]
    por_turno: dict[int, list[datetime]] = {}
    for m in _ENTRADA.finditer(bloco):
        por_turno.setdefault(int(m["turno"]), []).append(datetime.fromisoformat(m["start"]))
    return por_turno


def test_calendario_ts_e_legivel() -> None:
    """Se o formato de `CALENDAR_2026` mudar, esta guarda tem de quebrar alto
    em vez de comparar contra uma lista vazia."""
    por_turno = _inicios_por_turno()
    assert set(por_turno) == {1, 2}, por_turno


def test_corte_de_cada_turno_e_o_inicio_mais_tardio_do_turno_no_calendario() -> None:
    """Turno 2: igual ao calendário. Turno 1: a exceção da emenda de 03/10 ao
    ADR-0054 — o corte é a virada de produção (03/10 18:00 BRT), que tem de
    ficar ANTES do início do turno no calendário e no máximo 6 h antes dele
    (uma antecipação maior engoliria o ensaio de 03/10 de dia, que ainda era
    simulado). Se o calendário do turno 1 mudar, esta guarda quebra alto."""
    por_turno = _inicios_por_turno()
    assert set(_CORTE_RESIDUO_SIMULADO_POR_TURNO) == set(por_turno)
    for turno, inicios in por_turno.items():
        corte = _CORTE_RESIDUO_SIMULADO_POR_TURNO[turno]
        if turno == 1:
            assert corte == _VIRADA_PRODUCAO_1T
            assert max(inicios) - timedelta(hours=6) <= corte < max(inicios), (
                f"turno 1: corte {corte} fora da faixa (virada ≤ 6 h antes de {max(inicios)})"
            )
            continue
        assert corte == max(inicios), (
            f"turno {turno}: Python diz {corte}, "
            f"calendar.ts diz {max(inicios)} — atualize os dois juntos"
        )
