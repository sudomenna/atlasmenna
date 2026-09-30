"""Gerador da fixture SINTÉTICA de Deputado Estadual (cargo 7) — spec 027.

**Prefira os EA20 REAIS de cargo 7/8** (`tests/fixtures/tse/2026-sim/dep-est/`,
capturados no simulado de 29/09: RR, SP e DF, todos em apuração parcial). Esta
fixture existe só para os DOIS estados que a captura real não viu:

  - `m0-zero` — o agregado com `and = "n"` (apuração não iniciada);
  - `m3-final-tf` — o agregado com `tf = "s"` (totalização final), de onde
    saem as marcas oficiais de eleito e a comparação `eleitos` da
    Conferência.

Para eles, sem inventar um EA20 do zero, pega os agregados REAIS de Deputado
Federal de Roraima do simulado de 28/09 (`tests/fixtures/tse/2026-sim/dep/rr/`,
ver o README de lá) e os relabela como cargo 7. A transformação é
determinística e pequena — e o teste
`test_deputado_estadual.py::test_fixture_sintetica_e_a_transformacao_declarada`
refaz a transformação em memória e compara com o que está no disco, então a
pasta não pode derivar da regra escrita aqui.

## O que muda (e só isso)

1. `carg[].cd` `"6"` → `"7"`; `nmm`/`nmn` → `"Deputado Estadual"`, `nmf` →
   `"Deputada Estadual"`.
2. `carg[].nv` `"8"` → `"24"` — o tamanho da Assembleia de RR (CF art. 27: 3 ×
   8 federais).
3. 🔴 **Os campos que o TSE CALCULA a partir de `nv` são recalculados pela
   NOSSA conta** (`cadeiras.distribuir_cadeiras`, ADR-0027), porque os do
   arquivo real valem para 8 cadeiras e contradiriam `nv = 24`:
     - `carg[].qe` (quociente eleitoral);
     - `agr[].vag` (cadeiras por agremiação);
     - com `tf = "s"`, `cand[].st` / `cand[].e` (eleito por QP / por média /
       suplente / não eleito).
   Consequência: sobre esta fixture a Conferência "confere" **por
   construção**. Ela prova o ENCANAMENTO do cargo 7 (que a conta roda, que as
   comparações certas aparecem em `comparou`, que o payload sai), **nunca**
   que o algoritmo concorda com o TSE. Essa prova continua sendo a dos EA20
   reais de cargo 6 (`test_deputado_projecao.py`) e, para as assembleias, a
   dos EA20 reais de cargo 7 quando existirem (`tests/fixtures/tse/2026-sim/
   dep-est/`, outra frente) e o golden de 2022 (`scripts/build-cadeiras-
   golden.py --cargo 7`).
   Com `and = "n"` (apuração não iniciada) nada é recalculado: o TSE publica
   `qe = "0"` e um `vag` de rodada anterior, que a Conferência não lê.

Tudo o mais — votos, eleitorado (`e`), totais (`v`), seções (`s`), `dg`/`hg`,
nomes sintéticos do simulado (`CANDIDATO 9276`) — é o arquivo real, byte a
byte no conteúdo. O eleitorado de RR é o mesmo para os dois cargos, e é por
isso que a transformação faz sentido.

Só os DOIS AGREGADOS de RR acima. A Fase 1 não lê zonas, e os momentos
parciais (m1, m2) existem em arquivo real de cargo 7 (`dep-est/rr/`).

Para regravar a pasta (não é preciso rodar para os testes — eles leem o disco):

    .venv-model/bin/python3.14 -m tests.unit.model._fixture_dep_est_sintetico
"""

from __future__ import annotations

import copy
import json
import pathlib
from typing import Any

from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import extrair_entrada_proporcional
from api.model.deputado_payload import _cadeiras_de_fase_1

RAIZ = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "tse" / "2026-sim"
ORIGEM = RAIZ / "dep" / "rr"
DESTINO = RAIZ / "dep-est-sintetico" / "rr"

CARGO = 7
VAGAS_RR = 24
MOMENTOS = ("m0-zero", "m3-final-tf")
ARQUIVO_ORIGEM = "rr-c0006-e021272-u.json"
ARQUIVO_DESTINO = "rr-c0007-e021272-u.json"


def transformar(envelope: dict[str, Any], vagas: int = VAGAS_RR) -> dict[str, Any]:
    """Um agregado real de cargo 6 → o agregado sintético de cargo 7 com
    `vagas` cadeiras (24 = RR; outro número serve aos testes que precisam de
    uma casa de outro tamanho com a mesma forma)."""
    saida = copy.deepcopy(envelope)
    carg = next(c for c in saida["carg"] if str(c.get("cd")) == "6")
    carg["cd"] = str(CARGO)
    carg["nv"] = str(vagas)
    carg["nmm"] = "Deputado Estadual"
    carg["nmn"] = "Deputado Estadual"
    carg["nmf"] = "Deputada Estadual"

    if str(saida.get("and", "")).strip().lower() == "n":
        return saida

    entrada = extrair_entrada_proporcional(saida, cargo=CARGO)
    resultado = distribuir_cadeiras(entrada.agremiacoes, vagas)
    carg["qe"] = str(resultado.quociente_eleitoral)
    for agr in carg["agr"]:
        agr["vag"] = str(resultado.cadeiras.get(str(agr["n"]), 0))

    if str(saida.get("tf", "")).strip().lower() == "s":
        fase_1 = _cadeiras_de_fase_1(entrada, resultado)
        st: dict[int, str] = {}
        for cod, eleitos in resultado.eleitos.items():
            for i, c in enumerate(eleitos):
                st[c.cod] = "Eleito por QP" if i < fase_1.get(cod, 0) else "Eleito por média"
        for suplentes in resultado.suplentes.values():
            for c in suplentes:
                st.setdefault(c.cod, "Suplente")
        for agr in carg["agr"]:
            for par in agr.get("par") or []:
                for cand in par.get("cand") or []:
                    sq = int(cand["sqcand"])
                    marca = st.get(sq, "Não eleito")
                    cand["st"] = marca
                    cand["e"] = "s" if marca.startswith("Eleito") else "n"
    return saida


def gerar() -> dict[str, dict[str, Any]]:
    """`{momento: envelope sintético}` — sem escrever nada."""
    return {
        momento: transformar(json.loads((ORIGEM / momento / ARQUIVO_ORIGEM).read_text()))
        for momento in MOMENTOS
    }


def serializar(envelope: dict[str, Any]) -> str:
    """O formato dos EA20 de `dep/` (uma linha, sem espaços, UTF-8 cru)."""
    return json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> int:
    for momento, envelope in gerar().items():
        destino = DESTINO / momento / ARQUIVO_DESTINO
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(serializar(envelope), encoding="utf-8")
        print(f"[dep-est-sintetico] {destino.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
