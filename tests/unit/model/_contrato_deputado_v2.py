"""As invariantes do contrato v2 de Deputado Federal, em Python (spec 026 P3.5).

Porte de `tests/unit/contrato/deputado-v2-fixtures.test.ts`: lá elas conferem as
fixtures escritas à mão; aqui conferem o que o PRODUTOR emite
(`deputado_payload.construir_payload_deputado`). Cada invariante é recalculada a
partir dos votos, nunca lida do campo que confere — conferir `regras` contra
`quociente_eleitoral` passaria com os dois errados do mesmo jeito.

Não é um arquivo de teste (sem `test_`): os testes chamam `conferir_uf` e
`conferir_nacional` sobre payloads que eles mesmos montam.

Duas diferenças DELIBERADAS em relação ao teste TS, porque lá a fixture foi
escrita para passar e aqui o dado é real:

  - `quociente_eleitoral_tse == quociente_eleitoral` com `confere` não é
    exigido: o design 026 § 2.8 diz que os dois podem diferir sem divergência
    de `algoritmo` (o nosso é sobre a soma das zonas, o do TSE sobre o
    agregado).
  - "`tse` em TODA linha com totalização final" só é exigido quando o
    agregado trouxe `st` para todos — o produtor não inventa marca.
"""

from __future__ import annotations

import json
from typing import Any

MOTIVOS = {
    "aguardando": {"pct_minimo", "zonas_minimas", "sem_vagas"},
    "indisponivel": {"interruptor", "coligacao", "cobertura", "erro"},
}
COMPARACAO_DA_CHAVE = {
    "eleitorado": "eleitorado",
    "quociente_eleitoral": "algoritmo",
    "cadeiras": "algoritmo",
    "eleitos": "eleitos",
    "votos_validos": "votos_validos",
}
ANULADOS = {"anulado", "sub_judice"}
ORDEM_DESTINO = {None: 0, "valido_legenda": 1, "sub_judice": 2, "anulado": 3}


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def _qe_art106(votos: int, lugares: int) -> int:
    inteiro, resto = divmod(votos, lugares)
    return inteiro + 1 if 2 * resto > lugares else inteiro


def _valido(linha: dict[str, Any]) -> bool:
    return "destino" not in linha


def _eleito_tse(linha: dict[str, Any]) -> bool:
    return str(linha.get("tse", "")).startswith("eleito")


def _marcada(linha: dict[str, Any]) -> bool:
    return "parcial" in linha or "projecao" in linha or _eleito_tse(linha)


def linhas_de(detalhe: dict[str, Any], agr: dict[str, Any]) -> list[dict[str, Any]]:
    """Todas as linhas de uma agremiação: as do objeto e as de `lista_restante`."""
    resto = next(
        (b["candidatos"] for b in detalhe.get("lista_restante", []) if b["cod"] == agr["cod"]),
        [],
    )
    return sorted([*agr["candidatos"], *resto], key=lambda linha: linha["rank"])


def todas_as_linhas(detalhe: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [(agr, linha) for agr in detalhe["agremiacoes"] for linha in linhas_de(detalhe, agr)]


def _pct_ok(valor: Any, parte: int, total: int) -> bool:
    if valor is None:
        return False
    esperado = round(100.0 * parte / total, 5) if total > 0 else 0.0
    return abs(valor - esperado) < 1e-9 and abs(valor * 1e5 - round(valor * 1e5)) < 1e-6


def conferir_uf(detalhe: dict[str, Any]) -> None:
    """Todas as invariantes de UM objeto de UF v2. Lança `AssertionError`."""
    uf = detalhe["uf"]
    assert detalhe["contrato"] == 2, uf
    assert detalhe["cargo"] == 6 and detalhe["turno"] == 1, uf
    serial = json.dumps(detalhe, ensure_ascii=False)
    assert '"sqcand": "' not in serial, f"{uf}: sqcand como string"
    assert "vagas_obtidas" not in serial, f"{uf}: vagas_obtidas publicado (D2)"

    vv_uf = sum(a["votos_validos"] for a in detalhe["agremiacoes"])
    qe = detalhe["quociente_eleitoral"]
    lugares = detalhe["lugares_a_preencher"]

    # Regras (design § 2.6) — só com QE.
    if qe is not None:
        assert qe == _qe_art106(vv_uf, lugares), uf
        r = detalhe["regras"]
        assert r["quociente_eleitoral"] == qe
        assert r["votos_validos"] == vv_uf
        assert r["lugares_a_preencher"] == lugares
        assert r["piso_candidato"] == _ceil_div(qe, 10)
        assert r["piso_agremiacao_sobras"] == _ceil_div(4 * qe, 5)
        assert r["piso_candidato_sobras"] == _ceil_div(qe, 5)
        soma = sum(a["cadeiras"] for a in detalhe["agremiacoes"])
        assert soma + detalhe["vagas_nao_preenchidas"] == lugares, uf
    else:
        assert "regras" not in detalhe, uf

    restantes_lista = 0
    for agr in detalhe["agremiacoes"]:
        rot = f"{uf}/{agr['sigla']}"
        linhas = linhas_de(detalhe, agr)
        assert agr["total_candidatos"] == len(linhas), rot
        # rank 1..N contíguo, votos não crescentes, desempate de destino.
        assert [linha["rank"] for linha in linhas] == list(range(1, len(linhas) + 1)), rot
        for a, b in zip(linhas, linhas[1:], strict=False):
            assert b["votos"] <= a["votos"], f"{rot}: rank {b['rank']} com mais voto"
            if a["votos"] == b["votos"]:
                assert ORDEM_DESTINO.get(a.get("destino"), 4) <= ORDEM_DESTINO.get(
                    b.get("destino"), 4
                ), f"{rot}: desempate de destino no rank {b['rank']}"
        no_blob = {linha["rank"] for linha in agr["candidatos"]}
        for r_ in range(1, min(60, len(linhas)) + 1):
            assert r_ in no_blob, f"{rot}: rank {r_} fora do objeto"
        primeiro_fora = (agr.get("corte") or {}).get("primeiro_fora")
        for linha in agr["candidatos"]:
            if linha["rank"] > 60:
                assert _marcada(linha) or linha["sqcand"] == primeiro_fora, (
                    f"{rot}: rank {linha['rank']} sem marca no objeto"
                )
        for bloco in detalhe.get("lista_restante", []):
            if bloco["cod"] == agr["cod"]:
                restantes_lista += len(bloco["candidatos"])
                for linha in bloco["candidatos"]:
                    assert linha["rank"] > 60, rot
                    assert not _marcada(linha), f"{rot}: marca na lista 61+"

        # Votos da agremiação fecham com as linhas (regra do dvt).
        assert agr["votos_validos"] == agr["votos_nominais"] + agr["votos_legenda"], rot
        nominais = sum(linha["votos"] for linha in linhas if _valido(linha))
        assert nominais == agr["votos_nominais"], rot
        if qe:
            assert agr["quociente_partidario"] == agr["votos_validos"] // qe, rot

        # % dos válidos: 5 casas; null exatamente para anulado e sub judice.
        for linha in linhas:
            if linha.get("destino") in ANULADOS:
                assert linha["pct_validos"] is None, rot
            else:
                assert _pct_ok(linha["pct_validos"], linha["votos"], vv_uf), (
                    f"{rot}/{linha['sqcand']}: pct {linha['pct_validos']}"
                )
            if not _valido(linha):
                assert "parcial" not in linha and "projecao" not in linha, rot
                assert not _eleito_tse(linha), rot

        # Parcial: eleitos == cadeiras == marcas; QP antes de sobra.
        parcial = [linha for linha in linhas if "parcial" in linha]
        assert len(parcial) == agr["cadeiras"] == len(agr["eleitos"]), rot
        assert {linha["sqcand"] for linha in parcial} == {e["sqcand"] for e in agr["eleitos"]}
        for e in agr["eleitos"]:
            linha = next(x for x in parcial if x["sqcand"] == e["sqcand"])
            assert bool(e.get("indefinido")) == bool(linha.get("indefinido")), rot
        if qe:
            elegiveis10 = sum(1 for linha in linhas if _valido(linha) and 10 * linha["votos"] >= qe)
            n_qp = sum(1 for linha in parcial if linha["parcial"] == "qp")
            assert n_qp == min(agr["quociente_partidario"], elegiveis10), rot
            assert [linha["parcial"] for linha in parcial] == ["qp"] * n_qp + ["sobra"] * (
                len(parcial) - n_qp
            ), f"{rot}: QP antes de sobra"
        for linha in linhas:
            if linha.get("indefinido"):
                assert linha["parcial"] == "sobra", rot
            if linha.get("projecao_apertada"):
                assert linha["projecao"] == "sobra", rot

        # Eleitos são os primeiros ranks válidos (design § 3.1).
        validas = [linha for linha in linhas if _valido(linha)]
        assert [linha["sqcand"] for linha in validas[: len(parcial)]] == [
            linha["sqcand"] for linha in parcial
        ], f"{rot}: eleito na parcial fora dos primeiros ranks válidos"

        # Linha de corte.
        fora = next(
            (linha for linha in linhas if _valido(linha) and "parcial" not in linha), None
        )
        if not parcial or fora is None:
            assert "corte" not in agr, rot
        else:
            c = agr["corte"]
            assert c["ultimo_eleito"] == parcial[-1]["sqcand"], rot
            assert c["primeiro_fora"] == fora["sqcand"], rot
            assert c["diferenca"] == parcial[-1]["votos"] - fora["votos"] >= 0, rot
            assert (c.get("primeiro_fora_abaixo_piso_10") is True) == (10 * fora["votos"] < qe)

        # Puxadores.
        esperados = (
            [
                {
                    "sqcand": linha["sqcand"],
                    "quocientes": linha["votos"] // qe,
                    "excedente": linha["votos"] // qe - 1,
                }
                for linha in linhas
                if _valido(linha) and linha["votos"] // qe - 1 >= 1
            ]
            if qe
            else []
        )
        assert agr.get("puxadores", []) == esperados, rot

    assert (detalhe.get("lista") or {}).get("restantes", 0) == restantes_lista, uf

    # Trava: marcas e cadeiras projetadas só com `liberada`.
    p = detalhe["projecao"]
    assert p["estado"] in ("liberada", "aguardando", "indisponivel")
    assert ("motivo" not in p) == (p["estado"] == "liberada"), uf
    if "motivo" in p:
        assert p["motivo"] in MOTIVOS[p["estado"]], uf
    assert p["zonas_apuradas"] <= p["zonas_total"], uf
    assert 25 <= p["pct_minimo"] <= 100, uf
    for agr in detalhe["agremiacoes"]:
        linhas = linhas_de(detalhe, agr)
        proj = [linha for linha in linhas if "projecao" in linha]
        if p["estado"] != "liberada":
            assert "cadeiras_projetadas" not in agr and "votos_projetados" not in agr, uf
            assert "cadeiras_projetadas_ci95" not in agr, uf
            assert proj == [] and not any(linha.get("projecao_apertada") for linha in linhas)
            continue
        assert len(proj) == agr["cadeiras_projetadas"], f"{uf}/{agr['sigla']}"
        faixa = agr.get("cadeiras_projetadas_ci95")
        if faixa is not None:
            assert faixa[0] <= agr["cadeiras_projetadas"] <= faixa[1], uf
    if p["estado"] == "liberada":
        soma = sum(a["cadeiras_projetadas"] for a in detalhe["agremiacoes"])
        assert soma <= lugares, uf

    # Marca do TSE só com totalização final.
    linhas_uf = [linha for _a, linha in todas_as_linhas(detalhe)]
    if not detalhe["totalizacao_final"]:
        assert all("tse" not in linha for linha in linhas_uf), uf

    # Conferência coerente.
    c = detalhe["conferencia"]
    assert detalhe["divergencias"] == c["divergencias"], uf
    for div in c["divergencias"]:
        comp = COMPARACAO_DA_CHAVE.get(div["o_que"])
        assert comp is not None, div
        assert comp in c["comparou"], div
        if div["o_que"] in ("eleitorado", "votos_validos"):
            assert div["diferenca_pct"] == round(100.0 * (div["nosso"] - div["tse"]) / div["tse"], 5)
    if not c["totalizacao_final"]:
        assert "eleitos" not in c["comparou"] and "votos_validos" not in c["comparou"], uf
    if c["estado"] == "confere":
        assert c["divergencias"] == [] and "algoritmo" in c["comparou"], uf
        assert c["boletim_dado_ts"] is not None, uf
    if c["estado"] == "sem_dado_tse":
        assert c["divergencias"] == [] and "algoritmo" not in c["comparou"], uf
        assert detalhe["quociente_eleitoral_tse"] is None, uf
    if c["estado"] == "diverge":
        assert c["divergencias"], uf
        for div in c["divergencias"]:
            if div["o_que"] == "eleitos":
                nossos = sum(1 for x in linhas_uf if "parcial" in x and not _eleito_tse(x))
                oficiais = sum(1 for x in linhas_uf if _eleito_tse(x) and "parcial" not in x)
                assert (div["nosso"], div["tse"]) == (nossos, oficiais), uf

    # Mais votados da UF: referências que resolvem, top 10.
    todas = sorted(todas_as_linhas(detalhe), key=lambda t: (-t[1]["votos"], t[1]["sqcand"]))
    assert detalhe["mais_votados"] == [
        {"cod": agr["cod"], "sqcand": linha["sqcand"]} for agr, linha in todas[:10]
    ], uf
    for ref in detalhe["mais_votados"]:
        agr = next(a for a in detalhe["agremiacoes"] if a["cod"] == ref["cod"])
        assert any(linha["sqcand"] == ref["sqcand"] for linha in agr["candidatos"]), ref

    # Agremiações na ordem canônica.
    ordenadas = sorted(
        detalhe["agremiacoes"],
        key=lambda a: (-a["cadeiras"], -a["votos_validos"], a["sigla"], a["cod"]),
    )
    assert [a["cod"] for a in detalhe["agremiacoes"]] == [a["cod"] for a in ordenadas], uf


def conferir_nacional(payload: dict[str, Any], detalhes: dict[str, dict[str, Any]]) -> None:
    """Invariantes do payload nacional v2 contra os objetos de UF do mesmo ciclo."""
    por_uf = {row["sigla"]: row for row in payload["por_uf"]}
    for uf, d in detalhes.items():
        assert por_uf[uf]["projecao"] == d["projecao"], uf
    todas = [
        (uf, agr, linha)
        for uf in sorted(detalhes)
        for agr, linha in todas_as_linhas(detalhes[uf])
    ]
    todas.sort(key=lambda t: (-t[2]["votos"], t[0], t[2]["sqcand"]))
    assert [(m["uf"], m["sqcand"]) for m in payload["mais_votados"]] == [
        (uf, linha["sqcand"]) for uf, _a, linha in todas[:10]
    ]
    for m, (uf, agr, linha) in zip(payload["mais_votados"], todas[:10], strict=True):
        assert m["nome"] == linha["nome"] and m["partido"] == linha["partido"]
        assert (m["cod"], m["sigla"]) == (agr["cod"], agr["sigla"])
        assert m["votos"] == linha["votos"] and m["pct_validos"] == linha["pct_validos"]
    esperado = []
    for uf in sorted(detalhes):
        d = detalhes[uf]
        for agr in d["agremiacoes"]:
            for p in agr.get("puxadores", []):
                linha = next(x for x in linhas_de(d, agr) if x["sqcand"] == p["sqcand"])
                esperado.append((p["excedente"], linha["votos"], uf, p["sqcand"]))
    esperado.sort(key=lambda t: (-t[0], -t[1], t[2], t[3]))
    assert [(p["uf"], p["sqcand"]) for p in payload["puxadores"]] == [
        (uf, sq) for _e, _v, uf, sq in esperado[:30]
    ]
    for p in payload["puxadores"]:
        assert p["quociente_eleitoral"] == detalhes[p["uf"]]["quociente_eleitoral"]
        assert p["quocientes"] == p["votos"] // p["quociente_eleitoral"]
        assert p["excedente"] == p["quocientes"] - 1
    assert payload["insights"] == []
    assert payload["composition"] == {"pre_election": 0.0, "model": 0.0, "actual_results": 1.0}
