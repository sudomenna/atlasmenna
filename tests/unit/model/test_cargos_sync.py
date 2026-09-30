"""tests/unit/model/test_cargos_sync.py

A guarda de sincronia entre `api/model/cargos.py` (Python) e
`lib/config/cargos.ts` (a fonte canônica, TypeScript).

O espelho Python existe porque o orchestrator roda em Python e não tem como
importar o módulo TS (ver o cabeçalho de `api/model/cargos.py`). O risco óbvio
de um espelho é ele envelhecer em silêncio: alguém acrescenta o cargo 7 na
tabela TS, o Python continua com quatro linhas, e o modelo passa a projetar um
cargo com `vagas = 1` sem que nada reclame.

Este teste lê o `.ts` como TEXTO e confronta campo a campo. Ele não executa
TypeScript — o arquivo é um literal de objeto estático, e um parser de regex é
suficiente e não acrescenta dependência ao runtime Python (`requirements.txt`
continua com numpy/pydantic/psycopg).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.model.cargos import CARGOS, cargo_info, granularidade, vagas_por_uf

TS_PATH = Path(__file__).resolve().parents[3] / "lib" / "config" / "cargos.ts"

# Cada entrada da tabela TS é um objeto entre `{` e `}` dentro de `CARGOS`.
_ENTRY = re.compile(r"\{\s*cd:\s*(\d+),(.*?)\n  \}", re.DOTALL)


def _campo(corpo: str, nome: str) -> str:
    m = re.search(rf"{nome}:\s*([^,\n]+)", corpo)
    assert m is not None, f"campo `{nome}` não encontrado na entrada TS"
    return m.group(1).strip().strip('"')


def _parse_ts() -> list[dict[str, object]]:
    fonte = TS_PATH.read_text(encoding="utf-8")
    inicio = fonte.index("export const CARGOS")
    bloco = fonte[inicio : fonte.index("] as const;", inicio)]

    out: list[dict[str, object]] = []
    for m in _ENTRY.finditer(bloco):
        cd = int(m.group(1))
        corpo = m.group(2)
        vagas_raw = _campo(corpo, "vagasPorUf")
        out.append(
            {
                "cd": cd,
                "token": _campo(corpo, "token"),
                "slug": _campo(corpo, "slug"),
                "label": _campo(corpo, "label"),
                "vagas_por_uf": None if vagas_raw == "null" else int(vagas_raw),
                "tem_segundo_turno": _campo(corpo, "temSegundoTurno") == "true",
                "tem_arquivo_br": _campo(corpo, "temArquivoBr") == "true",
                "proporcional": _campo(corpo, "proporcional") == "true",
                "granularidade": _campo(corpo, "granularidade"),
                # Spec 027 RF-278 (ADR-0066) — quais UFs elegem o cargo.
                "abrangencia": _campo(corpo, "abrangencia"),
            }
        )
    return out


#: Campos que existem em `lib/config/cargos.ts` e que o espelho Python
#: deliberadamente NÃO carrega, com a razão.
#:
#: Esta lista não é burocracia: `rpsMax` foi acrescentado à tabela TS em
#: 2026-09-11, no mesmo dia em que o espelho nasceu. Sem a guarda abaixo, um
#: campo novo que o MODELO precisasse (uma segunda contagem de vagas, por
#: exemplo) entraria no `.ts` e o Python continuaria sem ele, em silêncio.
NAO_ESPELHADOS = {
    # Teto de requisições por segundo do cargo contra o CDN do TSE. É do
    # pipeline de ingestão (`lib/tse/rate-limiter.ts`); o modelo não faz I/O
    # de rede (constituição § 9) e não tem o que fazer com ele.
    "rpsMax",
    # A qual das duas eleições do pleito 2026 o cargo pertence — federal
    # (21270, só Presidente) ou estadual (21272, os demais). Ver ADR-0044.
    # Serve para uma única coisa: escolher o código que entra na URL do TSE
    # (`getCodEleicaoDoCargo`, `lib/tse/targets.ts`). O modelo lê `snapshots`
    # já gravados, filtrando por `cargo` — nunca monta URL e nunca pergunta de
    # qual árvore do CDN a linha veio. Decisão registrada em 2026-09-17.
    "eleicao",
}

#: Como cada campo do `.ts` se chama no espelho Python (camelCase → snake_case).
EQUIVALENCIA = {
    "cd": "cd",
    "token": "token",
    "slug": "slug",
    "label": "label",
    "vagasPorUf": "vagas_por_uf",
    "temSegundoTurno": "tem_segundo_turno",
    "temArquivoBr": "tem_arquivo_br",
    "proporcional": "proporcional",
    "granularidade": "granularidade",
    "abrangencia": "abrangencia",
}


def test_campo_novo_no_ts_obriga_uma_decisao_explicita():
    """A guarda que o `rpsMax` motivou.

    Um campo novo na tabela canônica cai aqui e o teste falha até que alguém
    decida: ou ele entra no espelho Python (e em `EQUIVALENCIA`), ou é
    declarado irrelevante para o modelo (e entra em `NAO_ESPELHADOS`, com a
    razão escrita). O que não pode acontecer é a terceira opção — ninguém
    notar.
    """
    fonte = TS_PATH.read_text(encoding="utf-8")
    inicio = fonte.index("export interface CargoInfo")
    corpo = fonte[inicio : fonte.index("\n}", inicio)]
    campos_ts = {m.group(1) for m in re.finditer(r"^  readonly (\w+):", corpo, re.M)}

    assert campos_ts, "o parser não achou campo nenhum em `CargoInfo` — regex quebrada"
    desconhecidos = campos_ts - set(EQUIVALENCIA) - NAO_ESPELHADOS
    assert not desconhecidos, (
        f"campo(s) novo(s) em lib/config/cargos.ts: {sorted(desconhecidos)}. "
        "Espelhe em api/model/cargos.py (e em EQUIVALENCIA) ou declare em "
        "NAO_ESPELHADOS dizendo por que o modelo não precisa."
    )


def test_o_parser_enxerga_a_tabela_ts():
    """Guarda do próprio teste: se a regex parar de casar (refactor do `.ts`),
    a lista vem vazia e TODAS as comparações abaixo passariam por vacuidade."""
    ts = _parse_ts()
    assert len(ts) >= 4
    # Spec 027 (29/09): Deputado Estadual (7) e Distrital (8). Este teste só
    # fecha depois que a frente TypeScript acrescentar as duas linhas (e o
    # campo `abrangencia`) em `lib/config/cargos.ts` — ver o relatório da
    # frente P.
    assert [c["cd"] for c in ts] == [1, 3, 5, 6, 7, 8]


def test_espelho_python_bate_campo_a_campo_com_o_ts():
    ts = {c["cd"]: c for c in _parse_ts()}
    py = {c["cd"]: c for c in CARGOS}

    assert set(ts) == set(py), (
        "tabela de cargos divergente entre lib/config/cargos.ts e "
        "api/model/cargos.py — acrescente o cargo faltante no espelho Python"
    )
    for cd, linha_ts in ts.items():
        assert py[cd] == linha_ts, f"cargo {cd} divergente"


def test_senador_tem_duas_vagas_e_granularidade_zona():
    """RF-102/RF-103 dependem destes dois valores literalmente.

    Senador saiu de `"uf"` para `"zona"` em 2026-09-11 (emenda ao ADR-0026
    item 1, decisão do usuário). Com um único boletim por estado o bootstrap
    tinha uma só unidade de reamostragem e `p_eleito` degenerava para 0% ou
    100% — ver `app/(sen)/uf/[sigla]/senador/page.tsx::temIncertezaMedida`,
    que permanece como guarda para o caso de a UF vir com uma zona só.
    """
    assert vagas_por_uf(5) == 2
    assert granularidade(5) == "zona"
    info = cargo_info(5)
    assert info is not None
    assert info["tem_segundo_turno"] is False


@pytest.mark.parametrize("cd", [1, 3])
def test_majoritarios_de_uma_vaga_seguem_em_uma_vaga(cd: int):
    assert vagas_por_uf(cd) == 1
    assert granularidade(cd) == "zona"


def test_cargo_desconhecido_degrada_para_o_default():
    """O orchestrator aceita `cargo` 1..99 no corpo do trigger; um código não
    coberto não pode derrubar o ciclo."""
    assert cargo_info(99) is None
    assert vagas_por_uf(99) == 1
    assert granularidade(99) == "zona"


@pytest.mark.parametrize(
    ("cd", "abrangencia"),
    [(1, "todas-as-ufs"), (3, "todas-as-ufs"), (5, "todas-as-ufs"), (6, "todas-as-ufs"),
     (7, "ufs-sem-df"), (8, "so-df")],
)  # fmt: skip
def test_abrangencia_de_cada_cargo(cd: int, abrangencia: str):
    """Spec 027 RF-278 — o DF não tem Assembleia Legislativa (CF art. 32 § 3º):
    elege deputado DISTRITAL, que é outro cargo no TSE (8)."""
    info = cargo_info(cd)
    assert info is not None
    assert info["abrangencia"] == abrangencia


def test_deputado_federal_nao_finge_ter_bancada_fixa():
    """Proporcional: a bancada varia de 8 a 70 por UF e vem de tabela própria.
    O espelho guarda `None` — nunca um número plausível e errado."""
    info = cargo_info(6)
    assert info is not None
    assert info["vagas_por_uf"] is None
    assert info["proporcional"] is True
