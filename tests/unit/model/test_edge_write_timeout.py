"""O teto de tempo do POST `/api/internal/edge-write` (spec 026, 29/09).

Era 10 s, calibrado para corpos de dezenas de KB. Com o contrato v2 de
Deputado o corpo é de 1,9–2,5 MB e o endpoint grava o Global Config e até ~55
objetos no Blob antes de responder. O teto novo tem de:

  - ser o que `post_edge_write` passa ao `urlopen` (não uma constante solta);
  - ficar ABAIXO do `maxDuration` do próprio endpoint (esperar mais que ele
    não traz resposta);
  - caber no `maxDuration` da função do modelo com folga para o cálculo.

Os dois `maxDuration` são lidos dos arquivos de configuração, não copiados
aqui: se alguém baixar um deles, este teste cai.
"""

from __future__ import annotations

import json
import pathlib
import re
import urllib.error
from typing import Any

import pytest

from api.model import project as proj

RAIZ = pathlib.Path(__file__).resolve().parents[3]


def _max_duration_do_endpoint() -> int:
    texto = (RAIZ / "app/api/internal/edge-write/route.ts").read_text(encoding="utf-8")
    m = re.search(r"export const maxDuration = (\d+);", texto)
    assert m, "maxDuration do edge-write não encontrado"
    return int(m.group(1))


def _max_duration_do_modelo() -> int:
    texto = (RAIZ / "vercel.ts").read_text(encoding="utf-8")
    m = re.search(r'"api/model/project\.py":\s*\{\s*maxDuration:\s*(\d+)', texto)
    assert m, "maxDuration de api/model/project.py não encontrado em vercel.ts"
    return int(m.group(1))


def test_teto_cabe_entre_o_endpoint_e_a_funcao_do_modelo() -> None:
    endpoint = _max_duration_do_endpoint()
    modelo = _max_duration_do_modelo()
    assert proj.TIMEOUT_EDGE_WRITE_S == 25
    # Maior que o de antes (10 s cortava escrita que ia dar certo)…
    assert proj.TIMEOUT_EDGE_WRITE_S > 10
    # …menor que o do próprio endpoint…
    assert proj.TIMEOUT_EDGE_WRITE_S < endpoint, (proj.TIMEOUT_EDGE_WRITE_S, endpoint)
    # …e deixa ao menos 30 s da função do modelo para o cálculo do cargo 6
    # (~10,5 s do bootstrap da parcial nas 27 UFs, medido na frente P).
    assert modelo - proj.TIMEOUT_EDGE_WRITE_S >= 30, (modelo, proj.TIMEOUT_EDGE_WRITE_S)


class _Resposta:
    status = 200

    def __enter__(self) -> _Resposta:
        return self

    def __exit__(self, *_a: Any) -> None:
        return None


def test_post_edge_write_passa_o_teto_ao_urlopen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_SECRET", "segredo-de-teste")
    visto: dict[str, Any] = {}

    def _urlopen(req: Any, timeout: float | None = None) -> _Resposta:
        visto["timeout"] = timeout
        visto["corpo"] = json.loads(req.data.decode("utf-8"))
        return _Resposta()

    monkeypatch.setattr(proj.urllib.request, "urlopen", _urlopen)
    proj.post_edge_write({"cargo": 6}, {"SP": {"uf": "SP"}})
    assert visto["timeout"] == proj.TIMEOUT_EDGE_WRITE_S
    assert visto["corpo"] == {"payload": {"cargo": 6}, "payloads_uf": {"SP": {"uf": "SP"}}}


def test_tempo_esgotado_continua_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    """Estourar o teto loga e segue — nunca derruba o ciclo do modelo."""
    monkeypatch.setenv("MODEL_SECRET", "segredo-de-teste")
    logs: list[tuple[str, str, dict[str, Any]]] = []
    monkeypatch.setattr(proj, "_log", lambda nivel, msg, **ctx: logs.append((nivel, msg, ctx)))

    def _urlopen(_req: Any, timeout: float | None = None) -> _Resposta:
        raise urllib.error.URLError(TimeoutError(f"timed out after {timeout}"))

    monkeypatch.setattr(proj.urllib.request, "urlopen", _urlopen)
    proj.post_edge_write({"cargo": 6})
    assert any(nivel == "warn" and msg == "edge-write network error" for nivel, msg, _c in logs)
