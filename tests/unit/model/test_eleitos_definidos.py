"""tests/unit/model/test_eleitos_definidos.py

04/10/2026 — decisão do dono: o fundo colorido + ✓ do balão do mapa nacional
sai de `por_uf[].eleitos_definidos` / `segundo_turno_definido` (eleito pela
CONTAGEM), não mais de `chamada` (margem projetada > 10 pp).

Cada caso nomeia a mutação que mata:

  - Governador: `md` e/s/n/ausente; líder da contagem SEM a anulada;
    `md == "s"` só vale no 1º turno.
  - Totalização final: `st` decide; sem `st`, UMA marca `e == "s"` é eleito e
    DUAS são 2º turno (a marca do TSE quer dizer "eleito ou 2º turno");
    `esae == "s"` ⇒ nada.
  - Senado: `votos_k − votos_3º == R` ⇒ NÃO definido; `R + 1` ⇒ definido;
    um definido e o outro não; anulada fora; `R` ausente ⇒ nada; 3º ausente
    ⇒ 0 voto; a lista COMPLETA do arquivo, não o top da projeção.
  - Presidente: `md == "e"` do arquivo `br` vai a toda UF em que o eleito está
    em `top_candidatos`, e só a elas; `md == "s"` nacional não vira nada.
  - Payload: chaves AUSENTES (nunca `[]`/`false`) quando nada está definido.
"""

from __future__ import annotations

from typing import Any

from api.model.definidos import (
    Definicao,
    Definidos,
    LeituraAgregado,
    campos_definidos,
    definicao_pela_totalizacao,
    definicao_senado,
    definicao_vaga_unica,
    lider_da_contagem,
)
from api.model.project import (
    build_edge_payload,
    ler_definicao_agregado,
    montar_definidos,
)

# ---------------------------------------------------------------------------
# Construtores
# ---------------------------------------------------------------------------


def _cand(cid: int, votos: int, *, destino: str | None = "valido", **extra: str) -> dict[str, Any]:
    c: dict[str, Any] = {"id": cid, "votos": votos}
    if destino is not None:
        c["destino"] = destino
    c.update(extra)
    return c


def _leitura(
    cands: list[dict[str, Any]],
    *,
    md: str | None = None,
    tf: bool = False,
    esae: bool = False,
    restantes: int | None = None,
) -> LeituraAgregado:
    return LeituraAgregado(md=md, tf=tf, esae=esae, candidaturas=cands, restantes=restantes)  # type: ignore[arg-type]


_DVT = {"valido": "Válido", "anulado": "Anulado", "sub_judice": "Anulado sub judice"}


def _ea20(
    cands: list[tuple[int, int, str]],
    *,
    cargo: int,
    te: int = 1_000,
    c: int = 500,
    a: int = 100,
    esna: int | str | None = 0,
    md: str | None = None,
    tf: str | None = None,
    esae: str | None = None,
    marcas: dict[int, dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Envelope EA20 real mínimo: `carg[].agr[].par[].cand[]` + `e`."""
    lista = []
    for cid, votos, destino in cands:
        item: dict[str, Any] = {
            "n": str(cid),
            "sqcand": str(9000 + cid),
            "nm": f"C{cid}",
            "nmu": f"C{cid}",
            "e": "n",
            "vap": str(votos),
            "pvap": "0,00",
            "dvt": _DVT[destino],
        }
        item.update((marcas or {}).get(cid, {}))
        lista.append(item)
    root: dict[str, Any] = {
        "ele": "6259",
        "t": "1",
        "f": "o",
        "tpabr": "uf",
        "cdabr": "sp",
        "carg": [
            {
                "cd": str(cargo),
                "agr": [{"n": "1", "nm": "A", "tp": "i", "par": [{"n": "10", "sg": "PX", "nm": "P", "cand": lista}]}],
            }
        ],
        "s": {"psa": "50,00"},
        "e": {"te": str(te), "c": str(c), "a": str(a)},
        "v": {},
    }
    if esna is not None:
        root["e"]["esna"] = str(esna)
    for chave, valor in (("md", md), ("tf", tf), ("esae", esae)):
        if valor is not None:
            root[chave] = valor
    return root


def _snap(uf: str, nivel: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "uf": uf,
        "cod_municipio_tse": 0,
        "cod_zona": 0,
        "nivel": nivel,
        "pct_apurado": 50.0,
        "payload": payload,
        "ts": "2026-10-04T21:00:00Z",
    }


# ---------------------------------------------------------------------------
# Governador / vaga única — o `md` do TSE
# ---------------------------------------------------------------------------


def test_md_e_elege_o_lider_da_contagem() -> None:
    """Mata "ignora o md": md='e' ⇒ o líder; o mesmo arquivo sem md ⇒ nada."""
    cands = [_cand(10, 600), _cand(20, 300), _cand(30, 100)]
    assert definicao_vaga_unica(_leitura(cands, md="e"), turno=1) == Definicao(eleitos=(10,))
    assert definicao_vaga_unica(_leitura(cands, md=None), turno=1) == Definicao()
    assert definicao_vaga_unica(_leitura(cands, md="n"), turno=1) == Definicao()


def test_md_e_ignora_a_anulada_no_topo() -> None:
    """Mata "líder sem filtrar destino": a anulada tem mais voto, o eleito é
    a primeira que COMPETE. Sub judice compete."""
    cands = [_cand(10, 900, destino="anulado"), _cand(20, 500, destino="sub_judice"), _cand(30, 100)]
    assert definicao_vaga_unica(_leitura(cands, md="e"), turno=1) == Definicao(eleitos=(20,))


def test_md_s_e_segundo_turno_so_no_primeiro_turno() -> None:
    cands = [_cand(10, 400), _cand(20, 350), _cand(30, 250)]
    assert definicao_vaga_unica(_leitura(cands, md="s"), turno=1) == Definicao(segundo_turno=True)
    assert definicao_vaga_unica(_leitura(cands, md="s"), turno=2) == Definicao()


def test_md_e_no_segundo_turno() -> None:
    cands = [_cand(10, 400), _cand(20, 600)]
    assert definicao_vaga_unica(_leitura(cands, md="e"), turno=2) == Definicao(eleitos=(20,))


def test_md_e_com_empate_no_topo_nao_elege() -> None:
    assert lider_da_contagem([_cand(1, 5), _cand(2, 5)]) is None
    assert definicao_vaga_unica(_leitura([_cand(1, 5), _cand(2, 5)], md="e"), turno=1) == Definicao()


def test_leitura_ausente_nao_define() -> None:
    assert definicao_vaga_unica(None, turno=1) == Definicao()
    assert definicao_senado(None) == Definicao()


# ---------------------------------------------------------------------------
# Totalização final
# ---------------------------------------------------------------------------


def test_tf_st_decide() -> None:
    cands = [_cand(10, 600, st="Eleito", e="s"), _cand(20, 400, st="Não eleito", e="n")]
    assert definicao_vaga_unica(_leitura(cands, tf=True), turno=1) == Definicao(eleitos=(10,))


def test_tf_st_decide_sem_a_marca_e() -> None:
    """Mata "ignora st": a situação basta, mesmo sem `e` legível."""
    cands = [_cand(10, 600, st="Eleito"), _cand(20, 400, st="Não eleito")]
    assert definicao_vaga_unica(_leitura(cands, tf=True), turno=1) == Definicao(eleitos=(10,))
    sen = [_cand(1, 600, st="Eleito"), _cand(2, 500, st="Eleito"), _cand(3, 100, st="Não eleito")]
    assert definicao_senado(_leitura(sen, tf=True)) == Definicao(eleitos=(1, 2))


def test_tf_st_segundo_turno() -> None:
    cands = [
        _cand(10, 450, st="2º turno", e="s"),
        _cand(20, 400, st="2º turno", e="s"),
        _cand(30, 150, st="Não eleito", e="n"),
    ]
    assert definicao_vaga_unica(_leitura(cands, tf=True), turno=1) == Definicao(segundo_turno=True)


def test_tf_sem_st_duas_marcas_e_segundo_turno_nao_dois_eleitos() -> None:
    """Mata "e == 's' ⇒ eleito" cru: no 1º turno com 2º turno o TSE marca os
    DOIS finalistas com e='s'. Nenhum deles está eleito."""
    cands = [_cand(10, 450, e="s"), _cand(20, 400, e="s"), _cand(30, 150, e="n")]
    assert definicao_vaga_unica(_leitura(cands, tf=True), turno=1) == Definicao(segundo_turno=True)
    um = [_cand(10, 600, e="s"), _cand(20, 400, e="n")]
    assert definicao_vaga_unica(_leitura(um, tf=True), turno=1) == Definicao(eleitos=(10,))


def test_tf_ignora_md_residual() -> None:
    """Depois de tf='s' o md some; se sobrar, quem decide são as marcas."""
    cands = [_cand(10, 600, e="n"), _cand(20, 400, e="s")]
    assert definicao_vaga_unica(_leitura(cands, tf=True, md="e"), turno=2) == Definicao(eleitos=(20,))


def test_tf_esae_nao_atribui() -> None:
    cands = [_cand(10, 600, st="Eleito", e="s")]
    assert definicao_vaga_unica(_leitura(cands, tf=True, esae=True), turno=1) == Definicao()


def test_tf_senado_duas_marcas_sao_os_dois_eleitos() -> None:
    cands = [_cand(1, 600, e="s"), _cand(2, 500, e="s"), _cand(3, 100, e="n")]
    assert definicao_senado(_leitura(cands, tf=True)) == Definicao(eleitos=(1, 2))
    tres = [_cand(1, 600, e="s"), _cand(2, 500, e="s"), _cand(3, 100, e="s")]
    assert definicao_pela_totalizacao(_leitura(tres, tf=True), vagas=2, segundo_turno_possivel=False) == Definicao()


# ---------------------------------------------------------------------------
# Senado — a conta própria
# ---------------------------------------------------------------------------


def test_senado_no_limiar_exato_nao_define() -> None:
    """Mata `>` → `>=`: diferença para o 3º IGUAL a R permite empate."""
    r = 100
    cands = [_cand(1, 500), _cand(2, 300 + r), _cand(3, 300)]
    # 1º: 500 − 300 = 200 > 100 ⇒ definido; 2º: 400 − 300 = 100 == R ⇒ não.
    assert definicao_senado(_leitura(cands, restantes=r)) == Definicao(eleitos=(1,))


def test_senado_um_acima_do_limiar_define() -> None:
    r = 100
    cands = [_cand(1, 500), _cand(2, 300 + r + 1), _cand(3, 300)]
    assert definicao_senado(_leitura(cands, restantes=r)) == Definicao(eleitos=(1, 2))


def test_senado_compara_com_o_terceiro_nao_com_o_segundo() -> None:
    """Mata "compara cada um com o seguinte": 1º e 2º colados (diferença 1),
    os dois bem acima do 3º ⇒ os DOIS definidos."""
    cands = [_cand(1, 501), _cand(2, 500), _cand(3, 100)]
    assert definicao_senado(_leitura(cands, restantes=300)) == Definicao(eleitos=(1, 2))


def test_senado_nenhum_definido() -> None:
    cands = [_cand(1, 500), _cand(2, 450), _cand(3, 400)]
    assert definicao_senado(_leitura(cands, restantes=200)) == Definicao()


def test_senado_anulada_fora_da_conta() -> None:
    """A anulada é a 2ª em votos; quem disputa a 2ª vaga é a 3ª, e a
    primeira de fora passa a ser a 4ª."""
    cands = [_cand(1, 900), _cand(2, 800, destino="anulado"), _cand(3, 500), _cand(4, 100)]
    assert definicao_senado(_leitura(cands, restantes=300)) == Definicao(eleitos=(1, 3))
    # Com a anulada contada como competidora, o 3º seria a primeira de fora
    # (500) e só o 1º estaria definido — a fixture discrimina.
    sem_filtro = [dict(c, destino="valido") for c in cands]
    assert definicao_senado(_leitura(sem_filtro, restantes=300)) == Definicao(eleitos=(1,))


def test_senado_sem_restantes_nada() -> None:
    cands = [_cand(1, 900), _cand(2, 800), _cand(3, 0)]
    assert definicao_senado(_leitura(cands, restantes=None)) == Definicao()
    assert definicao_senado(_leitura(cands, restantes=-1)) == Definicao()


def test_senado_sem_terceiro_conta_zero() -> None:
    cands = [_cand(1, 101), _cand(2, 100)]
    assert definicao_senado(_leitura(cands, restantes=100)) == Definicao(eleitos=(1,))


def test_senado_fim_da_apuracao_restantes_zero() -> None:
    cands = [_cand(1, 500), _cand(2, 301), _cand(3, 300)]
    assert definicao_senado(_leitura(cands, restantes=0)) == Definicao(eleitos=(1, 2))


# ---------------------------------------------------------------------------
# Leitura do EA20
# ---------------------------------------------------------------------------


def test_ler_agregado_restantes_e_campos() -> None:
    payload = _ea20(
        [(1, 300, "valido"), (2, 200, "anulado")],
        cargo=5,
        te=1_000,
        c=500,
        a=100,
        md="n",
        tf="n",
        marcas={1: {"e": "s", "st": "Eleito"}},
    )
    leitura = ler_definicao_agregado(payload, 5)
    assert leitura is not None
    assert leitura.restantes == 400  # 1000 − 500 − 100
    assert leitura.md == "n" and leitura.tf is False and leitura.esae is False
    por_id = {c["id"]: c for c in leitura.candidaturas}
    assert por_id[1] == {"id": 1, "votos": 300, "destino": "valido", "e": "s", "st": "Eleito"}
    assert por_id[2]["destino"] == "anulado"


def test_restantes_soma_esna() -> None:
    """Mata "tira o esna": 1000 − 500 − 100 + 50 = 450."""
    payload = _ea20([(1, 300, "valido")], cargo=5, te=1_000, c=500, a=100, esna=50)
    leitura = ler_definicao_agregado(payload, 5)
    assert leitura is not None and leitura.restantes == 450


def test_senado_esna_no_limiar_desfaz_a_definicao() -> None:
    """Sem a soma do esna, R = 50 e a 2ª (folga 60 sobre a 3ª) estaria
    definida; com esna = 10, R = 60 == folga ⇒ NÃO definida (limiar exato).
    Com esna = 9, R = 59 < 60 ⇒ definida."""
    cands = [(1, 900, "valido"), (2, 540, "valido"), (3, 480, "valido")]
    no_limiar = _ea20(cands, cargo=5, te=10_000, c=9_000, a=950, esna=10)
    defin = montar_definidos([_snap("SP", "uf", no_limiar)], 5, 1, 2)
    assert defin is not None and defin.por_uf["SP"] == Definicao(eleitos=(1,))
    abaixo = _ea20(cands, cargo=5, te=10_000, c=9_000, a=950, esna=9)
    defin = montar_definidos([_snap("SP", "uf", abaixo)], 5, 1, 2)
    assert defin is not None and defin.por_uf["SP"] == Definicao(eleitos=(1, 2))


def test_esna_ilegivel_ou_negativo_e_nao_sabemos() -> None:
    for valor in ("xx", "-5"):
        payload = _ea20([(1, 300, "valido")], cargo=5, esna=valor)
        leitura = ler_definicao_agregado(payload, 5)
        assert leitura is not None and leitura.restantes is None, valor


def test_esna_ausente() -> None:
    """Ausente: deriva de esi − esa; sem eles e com seção totalizada ⇒ None;
    nada totalizado (sem c/a) ⇒ R = te, o teto absoluto."""
    p = _ea20([(1, 300, "valido")], cargo=5, te=1_000, c=500, a=100, esna=None)
    assert ler_definicao_agregado(p, 5).restantes is None  # type: ignore[union-attr]
    p["e"].update({"esi": "600", "esa": "570"})
    assert ler_definicao_agregado(p, 5).restantes == 430  # type: ignore[union-attr]
    p["e"]["esa"] = "700"  # esa > esi: incoerente
    assert ler_definicao_agregado(p, 5).restantes is None  # type: ignore[union-attr]
    vazio = _ea20([(1, 0, "valido")], cargo=5, te=1_000, c=0, a=0, esna=None)
    del vazio["e"]["c"], vazio["e"]["a"]
    assert ler_definicao_agregado(vazio, 5).restantes == 1_000  # type: ignore[union-attr]


def test_ler_agregado_candidatura_ilegivel_derruba_restantes() -> None:
    payload = _ea20([(1, 300, "valido"), (2, 200, "valido")], cargo=5)
    payload["carg"][0]["agr"][0]["par"][0]["cand"][1]["vap"] = "xx"
    leitura = ler_definicao_agregado(payload, 5)
    assert leitura is not None and leitura.restantes is None


def test_senado_usa_a_lista_completa_do_arquivo() -> None:
    """O 3º pela contagem não precisa estar no top da projeção: a conta lê
    todas as candidaturas do arquivo. 6 candidaturas, a primeira de fora é a
    3ª em votos (480): com R=50, só o 1º está definido."""
    payload = _ea20(
        [(1, 900, "valido"), (2, 520, "valido"), (3, 480, "valido"), (4, 10, "valido"), (5, 5, "valido"), (6, 1, "valido")],
        cargo=5,
        te=10_000,
        c=9_000,
        a=950,  # R = 50
    )
    defin = montar_definidos([_snap("SP", "uf", payload)], 5, 1, 2)
    assert defin is not None
    assert defin.por_uf["SP"] == Definicao(eleitos=(1,))


# ---------------------------------------------------------------------------
# montar_definidos — por cargo
# ---------------------------------------------------------------------------


def test_montar_governador_md() -> None:
    sp = _ea20([(10, 600, "valido"), (20, 300, "valido")], cargo=3, md="e")
    rj = _ea20([(10, 400, "valido"), (20, 350, "valido"), (30, 250, "valido")], cargo=3, md="s")
    mg = _ea20([(10, 400, "valido"), (20, 350, "valido")], cargo=3, md="n")
    defin = montar_definidos(
        [_snap("SP", "uf", sp), _snap("RJ", "uf", rj), _snap("MG", "uf", mg)], 3, 1, 1
    )
    assert defin is not None
    assert defin.por_uf == {"SP": Definicao(eleitos=(10,)), "RJ": Definicao(segundo_turno=True)}


def test_montar_presidente_so_le_o_br() -> None:
    """md='e' numa linha `uf` do Presidente não decide nada: só o `br`."""
    uf_com_md = _ea20([(13, 600, "valido"), (22, 300, "valido")], cargo=1, md="e")
    assert montar_definidos([_snap("SP", "uf", uf_com_md)], 1, 1, 1) is None
    br = _ea20([(13, 600, "valido"), (22, 300, "valido")], cargo=1, md="e")
    defin = montar_definidos([_snap("BR", "br", br), _snap("SP", "uf", uf_com_md)], 1, 1, 1)
    assert defin is not None and defin.nacional == Definicao(eleitos=(13,))
    br_s = _ea20([(13, 450, "valido"), (22, 400, "valido")], cargo=1, md="s")
    defin_s = montar_definidos([_snap("BR", "br", br_s)], 1, 1, 1)
    assert defin_s is not None and defin_s.nacional == Definicao(segundo_turno=True)


def test_montar_outros_cargos_e_sem_agregado() -> None:
    assert montar_definidos([], 3, 1, 1) is None
    sp = _ea20([(10, 600, "valido")], cargo=6, md="e")
    assert montar_definidos([_snap("SP", "uf", sp)], 6, 1, None) is None


# ---------------------------------------------------------------------------
# campos_definidos + build_edge_payload
# ---------------------------------------------------------------------------


def test_campos_presidente_so_onde_o_eleito_esta_no_top() -> None:
    defin = Definidos(nacional=Definicao(eleitos=(13,)))
    assert campos_definidos(1, 1, "SP", [13, 22], defin) == {"eleitos_definidos": [13]}
    assert campos_definidos(1, 1, "RR", [22, 30], defin) == {}


def test_campos_presidente_segundo_turno_nacional_nao_vira_nada() -> None:
    defin = Definidos(nacional=Definicao(segundo_turno=True))
    assert campos_definidos(1, 1, "SP", [13, 22], defin) == {}


def test_campos_segundo_turno_so_governador_primeiro_turno() -> None:
    defin = Definidos(por_uf={"SP": Definicao(segundo_turno=True)})
    assert campos_definidos(3, 1, "SP", [1, 2], defin) == {"segundo_turno_definido": True}
    assert campos_definidos(3, 2, "SP", [1, 2], defin) == {}
    assert campos_definidos(5, 1, "SP", [1, 2], defin) == {}


def _linha(uf: str, cand: int, pct: float, cargo: int) -> dict[str, Any]:
    return {
        "cargo": cargo,
        "turno": 1,
        "uf": uf,
        "candidato_id": cand,
        "pct_projetado": pct,
        "pct_apurado": 60.0,
    }


def _payload(cargo: int, definidos: Definidos | None, turno: int = 1) -> dict[str, dict[str, Any]]:
    shares = [(1, 50.0), (2, 30.0), (3, 20.0)]
    rows = [_linha(uf, c, p, cargo) for uf in ("SP", "RJ") for c, p in shares]
    payload = build_edge_payload(
        cargo=cargo,
        turno=turno,
        ts_iso="2026-10-04T21:00:00Z",
        uf_rows=rows,
        national_rows=[{"candidato_id": c, "pct_projetado": p, "rank": i + 1} for i, (c, p) in enumerate(shares)],
        eleitorado_total_by_uf={"SP": 34_000_000, "RJ": 12_000_000},
        vagas=2 if cargo == 5 else None,
        definidos=definidos,
    )
    return {u["sigla"]: u for u in payload["por_uf"]}


def test_payload_sem_definidos_nao_emite_chave() -> None:
    for uf in _payload(3, None).values():
        assert "eleitos_definidos" not in uf
        assert "segundo_turno_definido" not in uf


def test_payload_governador_emite_e_omite() -> None:
    linhas = _payload(3, Definidos(por_uf={"SP": Definicao(eleitos=(1,))}))
    assert linhas["SP"]["eleitos_definidos"] == [1]
    assert "eleitos_definidos" not in linhas["RJ"]  # ausente, nunca []
    assert "segundo_turno_definido" not in linhas["SP"]
    # `chamada` continua com a regra dela (margem 20 pp > 10).
    assert linhas["SP"]["chamada"] is True


def test_payload_governador_segundo_turno() -> None:
    linhas = _payload(3, Definidos(por_uf={"RJ": Definicao(segundo_turno=True)}))
    assert linhas["RJ"]["segundo_turno_definido"] is True
    assert "eleitos_definidos" not in linhas["RJ"]
    assert "segundo_turno_definido" not in linhas["SP"]


def test_payload_senado_dois_eleitos() -> None:
    linhas = _payload(5, Definidos(por_uf={"SP": Definicao(eleitos=(1, 2))}))
    assert linhas["SP"]["eleitos_definidos"] == [1, 2]
    assert "eleitos_definidos" not in linhas["RJ"]


def test_payload_presidente_propaga_a_todas_as_ufs_com_o_eleito() -> None:
    linhas = _payload(1, Definidos(nacional=Definicao(eleitos=(1,))))
    assert linhas["SP"]["eleitos_definidos"] == [1]
    assert linhas["RJ"]["eleitos_definidos"] == [1]


def test_payload_presidente_eleito_fora_do_top_nao_aparece() -> None:
    linhas = _payload(1, Definidos(nacional=Definicao(eleitos=(99,))))
    for uf in linhas.values():
        assert "eleitos_definidos" not in uf
