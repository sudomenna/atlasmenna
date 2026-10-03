"""Spec 020 Fase 2 — o produtor emite a série por candidatura.

Cobre as quatro peças novas de `api/model/project.py`:

  - `cadencia_para_janela` / `SERIE_MAX_PONTOS` — o teto que re-bucketiza
    (T6, ADR-0046 D2);
  - `fetch_series_por_candidato` — o downsample dentro do SQL, último do balde,
    e o descarte da linha sem hora do boletim;
  - `anexar_ponto_corrente` — a defasagem de um ciclo entre a série e o placar
    ao lado (T4, RF-169);
  - `ordenar_por_parcial` / `montar_serie_por_candidato` — o elenco das quatro
    e a forma colunar (T2, RF-170; T5, RF-175b).

## A regra desta casa

Teste verde não prova nada. Cada bloco abaixo nomeia a MUTAÇÃO que ele mata, e
a fixture é construída para que essa mutação mude o resultado — não para que o
código passe. Duas mutações sobreviveram à primeira rodada da Fase 1 e as duas
lições estão aplicadas aqui:

  1. Sentinela **incoerente** (1 voto "valendo" 77,5%), porque com um sentinela
     coerente a aritmética re-inlineada devolve o mesmo número e o teste não
     discrimina nada.
  2. Comparação **posição a posição** de colunas e placeholders, porque
     `"dado_ts" in sql` continua verdadeiro com a coluna fora da lista, graças
     ao `%(dado_ts)s` do VALUES.

E a lição de 18/09, que é de outra natureza: asserção sobre o TEXTO do SQL não
prova o que a consulta DEVOLVE. `_ConnDeProjections`, mais abaixo, é um Postgres
de brinquedo que deriva o resultado do texto da consulta — é ele que torna
possível provar que corrigir só um dos dois lados da decisão não resolve nada.

Nenhum teste aqui toca banco: são fakes de conexão. `ALLOW_DB_WRITE_TESTS`
não tem nada a ver com este arquivo e não deve ser declarada para rodá-lo.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from api.model.project import (
    SERIE_CADENCIAS_MIN,
    SERIE_MAX_PONTOS,
    SeriePorCandidatoBruta,
    _balde_epoch,
    anexar_ponto_corrente,
    build_edge_payload,
    build_uf_payloads,
    cadencia_para_janela,
    fetch_series_por_candidato,
    montar_serie_por_candidato,
    ordenar_por_parcial,
)

RAIZ = Path(__file__).resolve().parents[3]

#: A hora do boletim, semanas longe do relógio de parede de qualquer máquina
#: que rode esta suíte — é o que permite afirmar que o eixo não saiu de `now()`.
BOLETIM = datetime(2026, 10, 4, 20, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fakes de conexão — leitura
# ---------------------------------------------------------------------------


class _CursorDeLeitura:
    def __init__(self, capturado: dict[str, Any], rows: list[tuple[Any, ...]]) -> None:
        self._capturado = capturado
        self._rows = rows

    def __enter__(self) -> _CursorDeLeitura:
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False

    def execute(self, sql: str, params: Any = None) -> None:
        self._capturado["sql"] = sql
        self._capturado["params"] = params

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class _ConnDeLeitura:
    def __init__(self, rows: list[tuple[Any, ...]] | None = None) -> None:
        self.capturado: dict[str, Any] = {}
        self._rows = rows or []

    def cursor(self) -> _CursorDeLeitura:
        return _CursorDeLeitura(self.capturado, self._rows)


class _ConnQueQuebra:
    """Banco sem a migration 0009 — a coluna não existe e a consulta estoura."""

    def cursor(self) -> Any:
        raise RuntimeError('column "pct_atual" does not exist')


# ---------------------------------------------------------------------------
# Construtores de fixture
# ---------------------------------------------------------------------------


def _ponto(momento: datetime, pct_atual: float | None, pct_proj: float | None):
    return {
        "momento": momento,
        "pct_atual": pct_atual,
        "pct_projetado": pct_proj,
    }


def _bruta(
    cadencia_min: int,
    pontos_por_escopo: dict[str | None, dict[int, list[tuple[datetime, Any, Any]]]],
) -> SeriePorCandidatoBruta:
    """Monta a estrutura bruta a partir de listas `(momento, atual, projetado)`.

    O balde de cada ponto é derivado do EPOCH (nunca do índice da lista), como
    no SQL — é a mesma função, `_balde_epoch`.
    """
    por_escopo: dict[str | None, dict[int, dict[int, dict[str, Any]]]] = {}
    for escopo, por_cand in pontos_por_escopo.items():
        for cid, pontos in por_cand.items():
            destino = por_escopo.setdefault(escopo, {}).setdefault(cid, {})
            for momento, pct_atual, pct_proj in pontos:
                destino[_balde_epoch(momento, cadencia_min)] = _ponto(
                    momento, pct_atual, pct_proj
                )
    return SeriePorCandidatoBruta(cadencia_min, por_escopo)


def _cand(cid: int, nome: str, partido: str, atual: float, proj: float):
    """Candidatura como ela chega do payload (o mesmo dicionário que a tela lê)."""
    return {
        "id": cid,
        "nome": nome,
        "partido": partido,
        "pct_atual": atual,
        "pct_projetado": proj,
    }


def _uf_row(uf: str, cid: int, votos: int | None, pct_atual: float | None, pct: float):
    return {
        "cargo": 1,
        "turno": 1,
        "uf": uf,
        "candidato_id": cid,
        "votos_projetados": (votos or 0) * 2,
        "votos_atuais": votos,
        "pct_atual": pct_atual,
        "pct_projetado": pct,
        "pct_projetado_lower": pct - 1,
        "pct_projetado_upper": pct + 1,
        "p_vitoria": None,
        "pct_apurado": 50.0,
    }


def _national_row(cid: int, pct_projetado: float, rank: int):
    """Linha nacional como `compute_national` a produz — SEM `pct_atual`."""
    return {
        "cargo": 1,
        "turno": 1,
        "uf": None,
        "candidato_id": cid,
        "votos_projetados": 1_000_000,
        "pct_projetado": pct_projetado,
        "pct_projetado_lower": pct_projetado - 1,
        "pct_projetado_upper": pct_projetado + 1,
        "p_vitoria": 0.5,
        "pct_apurado": None,
        "rank": rank,
        "p_passa_2t": 0.5,
        "p_fecha_1t": 0.1,
    }


# ===========================================================================
# T2 — o elenco das quatro
# ===========================================================================

#: Cinco candidaturas em que os DOIS critérios divergem, e não só no desempate:
#:
#:   por `pct_atual`     → [11, 22, 33, 44]
#:   por `pct_projetado` → [11, 33, 22, 55]
#:
#: A divergência é dupla de propósito: muda QUEM entra (44 ↔ 55) e muda a ORDEM
#: dos que ficam (22 ↔ 33). Com fixture em que só o 4º lugar troca, uma mutação
#: que ordene por projetado mas acerte o elenco por acaso passaria.
CINCO = [
    _cand(11, "Primeira", "PT", 35.0, 34.0),
    _cand(22, "Segunda", "PL", 30.0, 19.0),
    _cand(33, "Terceira", "PSD", 20.0, 29.0),
    _cand(44, "Quarta", "MDB", 10.0, 5.0),
    _cand(55, "Quinta", "NOVO", 5.0, 13.0),
]


def test_elenco_ordena_por_apurado_e_nao_por_projetado() -> None:
    """Mutação que este teste mata: ordenar por `pct_projetado`.

    É a mutação mais provável do projeto — o rank por `pct_projetado` já existe
    duas vezes neste arquivo, a dez linhas de distância dos dois call sites, e
    copiá-lo é o caminho de menor resistência. A divergência só apareceria
    quando apurado e projetado discordassem de ordem: isto é, na noite da
    apuração, com alguém olhando o gráfico e o painel de resultado ao mesmo
    tempo.
    """
    ordem = [c["id"] for c in ordenar_por_parcial(CINCO)]
    assert ordem == [11, 22, 33, 44, 55]

    # E o que a mutação produziria, escrito por extenso para a próxima pessoa
    # ver o que a asserção acima está descartando.
    por_projetado = [
        c["id"] for c in sorted(CINCO, key=lambda c: -c["pct_projetado"])
    ]
    assert por_projetado == [11, 33, 22, 55, 44]
    assert ordem != por_projetado


def test_elenco_da_serie_sao_as_quatro_do_criterio_apurado() -> None:
    """O gráfico recebe [11, 22, 33, 44] — 55 fica de fora, 44 entra."""
    bruta = _bruta(
        5,
        {
            "SP": {
                c["id"]: [(BOLETIM, c["pct_atual"], c["pct_projetado"])] for c in CINCO
            }
        },
    )
    serie = montar_serie_por_candidato(bruta, "SP", CINCO)
    assert serie is not None
    assert [c["id"] for c in serie["candidatos"]] == [11, 22, 33, 44]
    assert 55 not in {c["id"] for c in serie["candidatos"]}


def test_desempates_do_comparador_na_ordem_certa() -> None:
    """Antes da primeira zona apurada TODO `pct_atual` vale 0.

    Sem o desempate por `pct_projetado` a ordem cairia na do array de origem, e
    o gráfico abriria a noite com um elenco arbitrário. Sem o `id` asc final,
    dois empatados nos dois critérios trocariam de lugar entre ciclos — e a
    ordem do array é contrato de exibição (ADR-0046 D4).
    """
    zerados = [
        _cand(9, "Nona", "A", 0.0, 4.0),
        _cand(3, "Terceira", "B", 0.0, 9.0),
        _cand(1, "Primeira", "C", 0.0, 4.0),
    ]
    assert [c["id"] for c in ordenar_por_parcial(zerados)] == [3, 1, 9]


def test_ausencia_de_pct_atual_nao_desordena() -> None:
    """`None` conta como 0,0 — a MESMA conversão que o payload já faz.

    `build_uf_payloads` escreve `0.0` no payload quando a linha vem sem medição
    (candidatura imputada), e é esse payload que a tela ordena. Se aqui `None`
    valesse "abaixo de tudo", produtor e tela discordariam justamente na
    candidatura imputada — e em silêncio.
    """
    com_buraco = [
        {"id": 7, "pct_atual": None, "pct_projetado": 10.0},
        {"id": 8, "pct_atual": 0.0, "pct_projetado": 20.0},
    ]
    assert [c["id"] for c in ordenar_por_parcial(com_buraco)] == [8, 7]


def _criterios_do_comparador_ts(nome: str) -> list[tuple[str, str, str, str]]:
    """Os `return a.x - b.y;` do corpo de UMA função de `rank-parcial.ts`.

    🔴 O corte no próximo `export` não é zelo: até 2026-09-20 este teste fazia
    `split(nome)[1]` e lia o resto do ARQUIVO. Enquanto houve uma função só,
    dava no mesmo. No dia em que `rankByProjecao` entrou logo abaixo, a lista
    de critérios de `rankByParcial` passou a incluir os dela — o guarda
    reprovaria uma mudança que não houve, e (pior) deixaria de discriminar
    qual dos dois comparadores mudou.
    """
    fonte = (RAIZ / "lib" / "utils" / "rank-parcial.ts").read_text(encoding="utf-8")
    depois = fonte.split(f"export function {nome}")[1]
    corpo = re.split(r"\nexport ", depois)[0]
    return re.findall(r"return\s+([ab])\.(\w+)\s*-\s*([ab])\.(\w+);", corpo)


def test_comparador_python_tem_paridade_com_o_typescript() -> None:
    """O porte e o original têm de mudar no MESMO commit (ADR-0046 D4).

    `lib/utils/rank-parcial.ts` é o ponto único do lado da tela; este arquivo
    porta o mesmo critério para o produtor. Não há teste que rode os dois
    juntos, então o que existe é este: ler o TypeScript e exigir que os três
    critérios, nesta ordem e nestas direções, continuem lá. Mutação que ele
    mata: mudar o critério de um lado só — que não quebraria nada, e faria o
    gráfico mostrar um conjunto diferente do que a tabela ranqueia logo acima.
    """
    assert _criterios_do_comparador_ts("rankByParcial") == [
        ("b", "pct_atual", "a", "pct_atual"),  # desc
        ("b", "pct_projetado", "a", "pct_projetado"),  # desc
        ("a", "id", "b", "id"),  # asc
    ], "critério de `rankByParcial` mudou no TypeScript e não aqui"


def test_comparador_de_projecao_ts_e_o_do_produtor() -> None:
    """`rankByProjecao` (2026-09-20) tem de ser a ordem que ESTE arquivo grava.

    A tela passou a reordenar a lista quando o leitor troca para "Projeção", e
    o comparador que ela usa vive ao lado do de parcial. O gêmeo dele não é uma
    função nova: é a ordenação que `compute_national_projection` já usa para
    numerar `EdgeCandidate.rank` — `sorted(..., key=(-pct_projetado, id))`.

    Dois critérios, e a ausência do terceiro é o ponto. Um desempate por
    `pct_atual` no TypeScript faria, num empate de projeção, a POSIÇÃO da linha
    discordar do NÚMERO que veio no payload, na mesma tela. Mutação que este
    teste mata: acrescentar (ou inverter) um critério só do lado da tela.
    """
    assert _criterios_do_comparador_ts("rankByProjecao") == [
        ("b", "pct_projetado", "a", "pct_projetado"),  # desc
        ("a", "id", "b", "id"),  # asc
    ], "critério de `rankByProjecao` mudou no TypeScript e não aqui"


def test_ordem_do_payload_nacional_e_pct_projetado_depois_id() -> None:
    """O lado Python da paridade, medido no PAYLOAD — não no texto do código.

    `build_edge_payload` é quem grava `national.candidatos`, e é essa ordem que
    a tela reproduz quando o leitor está em "Projeção". A fixture é construída
    para que os dois desempates possíveis DISCORDEM: 2 e 5 empatam em projeção
    (30,0) e o 5 tem `pct_atual` muito maior. Se o produtor desempatasse por
    apurado, a ordem seria [9, 5, 2]; por `id`, é [9, 2, 5].

    Mutação que ele mata: alinhar o produtor ao "espelho simétrico" do
    comparador de parcial — que é exatamente a mudança tentadora de fazer no
    TypeScript e replicar aqui.
    """
    uf_rows = [
        _uf_row("SP", 9, 4_000_000, 40.0, 40.0),
        _uf_row("SP", 2, 3_000_000, 10.0, 30.0),
        _uf_row("SP", 5, 3_000_000, 90.0, 30.0),
    ]
    # 🔴 `pct_atual` EXPLÍCITO nas linhas nacionais, e não só nas de UF: é a
    # chave que o desempate errado leria, e `_national_row` não a traz. Sem
    # isto o teste passa com o produtor mutado — medido em 2026-09-20, e é
    # exatamente a armadilha do "teste que não discrimina".
    national_rows = [
        {**_national_row(5, 30.0, 3), "pct_atual": 90.0},
        {**_national_row(2, 30.0, 2), "pct_atual": 10.0},
        {**_national_row(9, 40.0, 1), "pct_atual": 0.0},
    ]
    payload = build_edge_payload(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=uf_rows,
        national_rows=national_rows,
        eleitorado_total_by_uf={"SP": 34_000_000},
    )

    assert [c["id"] for c in payload["national"]["candidatos"]] == [9, 2, 5]


# ===========================================================================
# T4 — o último ponto é o número publicado ao lado (RF-169)
# ===========================================================================


def _mundo_de_um_ciclo() -> tuple[list[dict], list[dict], SeriePorCandidatoBruta]:
    """Um ciclo corrente cujos números NÃO estão na série lida do banco.

    A série do banco para em 20h58 com valores propositalmente distantes; o
    ciclo corrente (21h00) traz outros. Se o ponto corrente não for anexado, o
    último ponto do gráfico será o de 20h58 — e discordará do placar ao lado na
    mesma tela, que é o defeito que o RF-169 nomeia.
    """
    uf_rows = [
        _uf_row("SP", 13, 6_000_000, 55.0, 54.0),
        _uf_row("SP", 22, 4_000_000, 45.0, 46.0),
        _uf_row("RR", 13, 100_000, 50.0, 51.0),
        _uf_row("RR", 22, 100_000, 50.0, 49.0),
    ]
    national_rows = [_national_row(13, 53.5, 1), _national_row(22, 46.5, 2)]
    antes = BOLETIM + timedelta(minutes=58)
    bruta = _bruta(
        5,
        {
            None: {13: [(antes, 12.0, 13.0)], 22: [(antes, 88.0, 87.0)]},
            "SP": {13: [(antes, 11.0, 12.0)], 22: [(antes, 89.0, 88.0)]},
        },
    )
    return uf_rows, national_rows, bruta


def test_ultimo_ponto_nacional_e_o_pct_atual_do_mesmo_payload() -> None:
    """Mutação que este teste mata: não anexar o ponto do ciclo corrente.

    A série é lida de `projections` centenas de linhas ANTES do INSERT do
    ciclo; publicada como vem do banco, ela sai 60 s atrasada em relação ao
    número que o mesmo payload imprime logo acima do gráfico. A asserção é na
    MESMA montagem: o valor do gráfico e o valor do placar saem do mesmo objeto.
    """
    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    ts_iso = (BOLETIM + timedelta(hours=1)).isoformat()

    bruta = anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=(BOLETIM + timedelta(hours=1)).isoformat(),
        ts_iso=ts_iso,
    )
    payload = build_edge_payload(
        cargo=1,
        turno=1,
        ts_iso=ts_iso,
        uf_rows=uf_rows,
        national_rows=national_rows,
        eleitorado_total_by_uf={"SP": 34_000_000, "RR": 400_000},
        cand_a_id=13,
        cand_b_id=22,
        partido_by_cand={13: "PT", 22: "PL"},
        serie_bruta=bruta,
    )

    serie = payload["serie_por_candidato"]
    placar = {c["id"]: c for c in payload["national"]["candidatos"]}
    for linha in serie["candidatos"]:
        esperado = round(placar[linha["id"]]["pct_atual"], 2)
        assert linha["apurado"][-1] == esperado, (
            f"último ponto da série do candidato {linha['id']} "
            f"({linha['apurado'][-1]}) discorda do placar ({esperado}) — "
            "a série saiu um ciclo atrasada"
        )
        assert linha["projetado"][-1] == round(
            placar[linha["id"]]["pct_projetado"], 2
        )

    # E o ponto ANTERIOR continua sendo o do banco — anexar não apagou a noite.
    assert serie["candidatos"][0]["apurado"][0] in (12.0, 88.0)


def test_ultimo_ponto_da_uf_e_o_pct_atual_da_mesma_uf() -> None:
    """Mesma exigência no escopo por UF, que é onde vivem 27 das 28 telas."""
    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    ts_iso = (BOLETIM + timedelta(hours=1)).isoformat()
    bruta = anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=(BOLETIM + timedelta(hours=1)).isoformat(),
        ts_iso=ts_iso,
    )
    payloads = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso=ts_iso,
        uf_rows=uf_rows,
        national_rows=national_rows,
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf={},
        partido_by_cand={13: "PT", 22: "PL"},
        serie_bruta=bruta,
    )
    sp = payloads["SP"]
    serie = sp["series_temporais"]["por_candidato"]
    placar = {c["id"]: c for c in sp["candidatos"]}
    for linha in serie["candidatos"]:
        assert linha["apurado"][-1] == round(placar[linha["id"]]["pct_atual"], 2)


def test_ponto_corrente_nacional_chama_a_razao_de_somas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """O ponto do ciclo não recomputa a razão de somas — ele a CHAMA.

    ⚠️ Sentinela **incoerente** de propósito: 1 voto de 10 "valendo" 77,5%. Com
    um sentinela coerente (775 de 1.000) a aritmética re-inlineada devolveria o
    mesmo número e o teste passaria com a mutação aplicada — foi exatamente o
    que aconteceu na primeira rodada da Fase 1.

    Mutação que este teste mata: `100 * votos / total` escrito de novo aqui. O
    gráfico e o placar divergiriam no quinto decimal, sem erro em lugar nenhum
    e sem como dizer qual dos dois está certo.
    """
    import api.model.project as proj

    def _sentinela(_uf_rows: list[dict[str, Any]]):
        return {13: 77.5, 22: 22.5}, {13: 1, 22: 9}, 10

    monkeypatch.setattr(proj, "pct_atual_nacional_por_candidato", _sentinela)

    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    bruta = proj.anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=(BOLETIM + timedelta(hours=1)).isoformat(),
        ts_iso=(BOLETIM + timedelta(hours=1)).isoformat(),
    )
    candidatos = [_cand(13, "A", "PT", 77.5, 53.5), _cand(22, "B", "PL", 22.5, 46.5)]
    serie = proj.montar_serie_por_candidato(bruta, None, candidatos)
    assert serie is not None
    por_id = {c["id"]: c for c in serie["candidatos"]}
    assert por_id[13]["apurado"][-1] == 77.5
    assert por_id[22]["apurado"][-1] == 22.5


def test_candidatura_sem_voto_em_uf_nenhuma_fica_none_no_ponto_corrente() -> None:
    """Furo de verdade, não `0.0` — e não preenchido na serialização.

    Uma candidatura que existe no nacional e não aparece em UF nenhuma não tem
    medição. `0` seria a afirmação "teve zero voto", e o gráfico desenharia um
    mergulho ao chão que nunca aconteceu.
    """
    uf_rows = [_uf_row("SP", 13, 1_000, 100.0, 100.0)]
    national_rows = [_national_row(13, 99.0, 1), _national_row(99, 1.0, 2)]
    bruta = anexar_ponto_corrente(
        SeriePorCandidatoBruta(5, {}),
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=BOLETIM.isoformat(),
        ts_iso=BOLETIM.isoformat(),
    )
    serie = montar_serie_por_candidato(
        bruta,
        None,
        [_cand(13, "A", "PT", 100.0, 99.0), _cand(99, "Z", "X", 0.0, 1.0)],
    )
    assert serie is not None
    orfa = next(c for c in serie["candidatos"] if c["id"] == 99)
    assert orfa["apurado"] == [None]
    assert orfa["projetado"] == [1.0]


def test_ponto_corrente_nao_muta_a_estrutura_lida() -> None:
    """`anexar_ponto_corrente` devolve estrutura nova — a de entrada sobrevive."""
    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    antes = {
        escopo: {cid: dict(b) for cid, b in cands.items()}
        for escopo, cands in bruta.por_escopo.items()
    }
    anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=(BOLETIM + timedelta(hours=1)).isoformat(),
        ts_iso=(BOLETIM + timedelta(hours=1)).isoformat(),
    )
    assert bruta.por_escopo == antes


def test_ponto_corrente_sem_relogio_nenhum_nao_inventa_hora() -> None:
    """Sem `dado_ts` E sem `ts` legível, o ponto não entra (ADR-0038 D1).

    Mutação que este teste mata: `dado_ts or datetime.now()`. Um ponto na hora
    errada do eixo é pior que um ponto a menos.
    """
    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    igual = anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=None,
        ts_iso="ontem à noite",
    )
    assert igual.por_escopo == bruta.por_escopo


def test_ponto_corrente_sem_hora_do_boletim_vira_buraco_e_nao_ponto() -> None:
    """🔴 Decisão do dono, 2026-09-18 — e ela REVOGA o design § 2.2d/§ 8.

    Até aqui esta função caía para `ts_iso` quando o boletim não trazia hora,
    espelhando o `COALESCE(dado_ts, ts)` da leitura. `ts_iso` é o relógio de
    CÁLCULO: o ponto entrava no eixo indistinguível de um ponto vindo de
    boletim, e como `pct_projetado` muda a cada ciclo mesmo sem dado novo do
    TSE, a linha da projeção marchava para a direita sobre uma ingestão parada.

    Mutação que este teste mata: `_dado_ts_para_coluna(dado_ts) or
    _dado_ts_para_coluna(ts_iso)`. A asserção é dupla de propósito — a
    estrutura tem de sair IGUAL à que entrou (nenhum balde novo em escopo
    nenhum) E o balde do `ts_iso` não pode existir em lugar nenhum. Só a
    primeira passaria se um dia o ponto caísse num balde já ocupado.
    """
    uf_rows, national_rows, bruta = _mundo_de_um_ciclo()
    ts_iso = (BOLETIM + timedelta(hours=1)).isoformat()

    cego = anexar_ponto_corrente(
        bruta,
        uf_rows=uf_rows,
        national_rows=national_rows,
        dado_ts=None,
        ts_iso=ts_iso,
    )

    assert cego.por_escopo == bruta.por_escopo
    balde_do_relogio_de_calculo = _balde_epoch(BOLETIM + timedelta(hours=1), 5)
    for escopo, por_cand in cego.por_escopo.items():
        for cid, baldes in por_cand.items():
            assert balde_do_relogio_de_calculo not in baldes, (
                f"escopo {escopo}, candidatura {cid}: o ponto do ciclo cego "
                "caiu no relógio de cálculo"
            )


# ===========================================================================
# T6 — o teto re-bucketiza, nunca corta
# ===========================================================================

#: Teto de pontos, escrito à mão de propósito — NÃO é `SERIE_MAX_PONTOS`.
#:
#: `len(eixo) <= SERIE_MAX_PONTOS` é tautológico: quem mudar a constante muda os
#: dois lados da comparação e o teste continua verde. O 120 literal é o acordo
#: do ADR-0046 D2, e é ele que sustenta a decisão D3 (a série cabe no Global
#: Config por CONSTRUÇÃO, qualquer que seja a duração da noite). Mudar a
#: constante do código passa a exigir mudar este número aqui — que é o mesmo
#: gesto de reabrir o ADR.
TETO_DE_PONTOS_DO_ADR = 120

# ---------------------------------------------------------------------------
# O ACORDO DE BYTES — um INTERVALO, nunca um número só
# ---------------------------------------------------------------------------
#
# 🔴 **Não existe teto CONSTANTE em bytes para esta série, e é por isso que os
# números abaixo são dois.** O peso depende do comprimento do `nome` de urna,
# que é dado do TSE (campo de até 30 caracteres) e não está sob nosso controle,
# e da presença de `sqcand`. O que é constante — e é o que de fato sustenta a
# decisão D3 do ADR-0046 — é o teto em **pontos**: ≤ 120, por construção.
#
# ## A história, porque ela é a única coisa que impede a terceira repetição
#
# Este acordo já foi escrito como número único DUAS vezes, e as duas erradas:
#
#   1. **8.553 B "para sempre"** — estimativa, nunca medida. O emissor real já
#      passava disso quando a frase foi escrita.
#   2. **8.775 B** (emenda de 2026-09-17) — medido, mas com valores passados por
#      `round(x, 2)`, e `round(41.2, 2)` devolve `41.2`: **quatro** caracteres,
#      não cinco. Uma fração grande dos 960 valores encolhia e o total saía
#      otimista.
#
# Os números abaixo vêm da terceira medição, que força **todo** valor a 5
# caracteres — o máximo real de um percentual de 0 a 100 com duas casas
# (`12.34`; `100.0` também dá 5). Por isso a fixture deste arquivo publica
# centavos que nunca terminam em zero: sem esse cuidado, ela reproduz o mesmo
# erro de medição e volta a mentir para baixo.
#
# ## Os dois extremos, ambos com a grade CHEIA (120 pontos)
#
#   - `SERIE_PISO_BYTES` = 8.822 B — nome de 4 caracteres, partido de 2, sem
#     `sqcand`. Piso ESTRUTURAL: o eixo e as oito colunas de números são o
#     payload quase inteiro, e nome/partido são ~2% dele.
#   - `SERIE_TETO_BYTES` = 9.066 B — nome de 30 (o limite do campo do TSE),
#     partido de 13, `sqcand` de 12 dígitos.
#
# Na noite real (~8 h ⇒ 96 pontos) os mesmos dois extremos dão 7.118 B e
# 7.362 B.
#
# ⚠️ **O limiar antigo, `< 9.000`, era violado por dado REAL**: 120 pontos com
# nome de urna de 28 caracteres dão 9.058 B. Ninguém viu porque a asserção nunca
# encostou em fixture realista. É a prova de que limiar redondo escolhido por
# conforto não protege coisa nenhuma — e é por isso que o teto abaixo NÃO é
# redondo, e que existe um teste dedicado ao pior caso logo depois da
# propriedade.
#
# ## O que o intervalo protege
#
# A escrita no Global Config na noite de 04/10. O writer recusa a chave acima de
# 940.000 B e a folga real é de ~521 KB — então não é o limite do store que está
# em jogo, é o acordo entre o documento e o código. Uma série que cresce (ou
# encolhe) em silêncio vai comendo essa folga sem que ninguém reabra o ADR.
#
#   - **Teto**: `SERIE_TETO_BYTES + SERIE_MARGEM_BYTES`. A margem é generosa de
#     propósito (~2%), porque apertá-la sobre um número que depende de dado do
#     TSE é plantar a próxima armadilha. O que ela compra está nomeado: um campo
#     novo por candidatura da ordem de um `sqcand` (~24 B × 4 = 96 B) passa; o
#     que ela NÃO compra é crescimento estrutural — uma casa decimal a mais
#     custa ~960 B, cinco vezes a margem.
#   - **Piso**: vale só com a grade CHEIA, porque é só aí que o volume é
#     comparável ao do documento. É a metade que o limiar antigo não tinha, e a
#     que discrimina de verdade: publicar uma casa decimal em vez de duas dá
#     7.862 B — passa folgado por baixo de 9.000, e no desenho vira escada de
#     ~2 px.
#
# ⚠️ Quem mexer em qualquer um dos dois está mudando o que o ADR-0046 promete
# sobre o tamanho da série, não ajustando um teste. O gesto correto é medir de
# novo (forçando os 5 caracteres), escrever a medição no ADR e só então trazer o
# número para cá. E não tente transformar o intervalo num número só: já falhou
# duas vezes, pelo mesmo motivo.
SERIE_PISO_BYTES = 8_822
SERIE_TETO_BYTES = 9_066
SERIE_MARGEM_BYTES = 200
SERIE_LIMITE_BYTES = SERIE_TETO_BYTES + SERIE_MARGEM_BYTES

#: Nome/partido do caso de PISO: 4 e 2 caracteres ASCII, sem `sqcand`.
_PISO_IDENTIDADE = (("Alfa", "PT"), ("Beta", "PL"), ("Gama", "PP"), ("Delt", "PV"))

#: Nome/partido/sqcand do caso de TETO: 30, 13 e 12 caracteres.
_TETO_NOME = "CANDIDATA DE NOME MUITO LONGO"
_TETO_PARTIDO = "SOLIDARIEDADE"


def _pct_de_cinco_caracteres(base: float, m: int) -> float:
    """Valor cujo publicado tem SEMPRE 5 caracteres — ver o bloco acima.

    Os centavos percorrem 11..19 e nunca terminam em zero, então `round(x, 2)`
    não encolhe a representação. O `+0,00137` mantém o arredondamento sendo
    exercido de verdade (o valor bruto tem mais casas que o publicado), sem
    mudar o resultado.
    """
    return base + (11 + (m % 9)) / 100 + 0.00137


def _bruta_janela_cheia(janela_min: int) -> SeriePorCandidatoBruta:
    """Um ponto por minuto na janela inteira, para 4 candidaturas.

    Granularidade de minuto (mais fina que qualquer cadência) para que o
    agrupamento seja exercido de verdade: se o corpo fatiasse em vez de
    re-bucketizar, o começo da janela sumiria e a asserção do primeiro ponto
    ficaria vermelha.
    """
    inicio = BOLETIM
    pontos: dict[int, list[tuple[datetime, Any, Any]]] = {}
    for n, cid in enumerate((11, 22, 33, 44)):
        pontos[cid] = [
            (
                inicio + timedelta(minutes=m),
                _pct_de_cinco_caracteres(20 + n * 7, m),
                _pct_de_cinco_caracteres(21 + n * 7, m),
            )
            # Janela semiaberta, como a do `WHERE`: `(agora - janela, agora]`.
            # Fechá-la dos dois lados daria 601 minutos numa janela de 600 e um
            # balde a mais que a fórmula do ADR-0046 D2 prevê.
            for m in range(janela_min)
        ]
    # Declara a MENOR cadência da lista, de propósito: é o corpo de
    # `montar_serie_por_candidato` que tem de subir até uma que caiba. Se a
    # fixture já declarasse a cadência certa, não haveria nada para
    # re-bucketizar e um `[-120:]` no lugar do agrupamento passaria despercebido
    # em toda janela maior que 10h.
    return SeriePorCandidatoBruta(
        SERIE_CADENCIAS_MIN[0],
        _bruta(1, {"SP": pontos}).por_escopo,
    )


@pytest.mark.parametrize("horas", list(range(1, 25)))
def test_teto_de_pontos_cadencia_minima_e_bytes(horas: int) -> None:
    """Propriedade, 1h a 24h: ≤ 120 pontos, cadência MÍNIMA, bytes no acordo.

    Mutação que este teste mata: o teto virar um `LIMIT` de SQL (ou uma fatia
    dos últimos 120 pontos). A asserção que discrimina é a do PRIMEIRO ponto do
    eixo: cortar deixaria o eixo com 120 pontos e a cadência certa, e só o
    começo da noite estaria faltando — exatamente o trecho que mostra quem
    largou na frente antes de o Norte/Nordeste apurar.

    A segunda mutação que ele mata é "pegar sempre a maior cadência da lista":
    caberia no teto e passaria em tudo, menos na asserção de minimalidade.
    """
    janela_min = horas * 60
    # Identidades do caso de PISO (`_PISO_IDENTIDADE`), não nomes de fantasia:
    # é o que faz a medição deste teste ser comparável à do ADR e o que dá
    # sentido à asserção de piso lá embaixo. Nomes mais curtos que estes
    # tornariam o payload menor que o piso documentado — sem defeito nenhum.
    candidatos = [
        _cand(cid, nome, partido, 40.0 - i * 10, 41.0 - i * 10)
        for i, (cid, (nome, partido)) in enumerate(
            zip((11, 22, 33, 44), _PISO_IDENTIDADE, strict=True)
        )
    ]
    serie = montar_serie_por_candidato(_bruta_janela_cheia(janela_min), "SP", candidatos)
    assert serie is not None

    cadencia = serie["cadencia_min"]

    # 🔴 O teto POR CONSTRUÇÃO, que é o que de fato sustenta o ADR-0046 D3 —
    # e escrito em número literal, não na constante do código (ver
    # `TETO_DE_PONTOS_DO_ADR`). A linha seguinte confere que as duas leituras
    # do teto continuam sendo a mesma: é ela que transforma uma mudança
    # silenciosa de `SERIE_MAX_PONTOS` numa falha.
    assert len(serie["eixo"]) <= TETO_DE_PONTOS_DO_ADR
    assert SERIE_MAX_PONTOS == TETO_DE_PONTOS_DO_ADR

    # A cadência é a MENOR da lista que cabe no teto — nenhuma menor serviria.
    assert cadencia == cadencia_para_janela(janela_min)
    assert math.ceil(janela_min / cadencia) <= SERIE_MAX_PONTOS
    for menor in SERIE_CADENCIAS_MIN:
        if menor < cadencia:
            assert math.ceil(janela_min / menor) > SERIE_MAX_PONTOS

    # 🔴 O começo da janela SOBREVIVE. É esta linha que separa re-bucketizar de
    # cortar: as outras asserções passam com as duas implementações.
    primeiro = datetime.fromisoformat(serie["eixo"][0].replace("Z", "+00:00"))
    assert primeiro == datetime.fromtimestamp(
        _balde_epoch(BOLETIM, cadencia), timezone.utc
    )

    # Todas as colunas têm o comprimento do eixo — é o que torna a forma
    # colunar legível: o valor de índice `i` pertence ao instante `eixo[i]`.
    for linha in serie["candidatos"]:
        assert len(linha["apurado"]) == len(serie["eixo"])
        assert len(linha["projetado"]) == len(serie["eixo"])

    # O acordo de bytes do ADR-0046, nos DOIS sentidos. Ver o bloco de
    # constantes acima para o que cada número protege, por que são dois e por
    # que nenhum deles é redondo.
    bytes_serie = len(json.dumps(serie, separators=(",", ":")).encode("utf-8"))
    assert bytes_serie <= SERIE_LIMITE_BYTES, (
        f"série de {horas}h ocupa {bytes_serie} B, acima do teto do ADR-0046 "
        f"({SERIE_TETO_BYTES} B + {SERIE_MARGEM_BYTES} B de margem). Meça de "
        "novo forçando valores de 5 caracteres e emende o ADR — não afrouxe o "
        "número aqui."
    )
    if len(serie["eixo"]) == TETO_DE_PONTOS_DO_ADR:
        assert bytes_serie >= SERIE_PISO_BYTES, (
            f"série de {horas}h com a grade CHEIA ocupa só {bytes_serie} B, "
            f"abaixo do piso estrutural do ADR-0046 ({SERIE_PISO_BYTES} B). "
            "Alguma coisa encolheu o payload: casas decimais a menos, pontos "
            "descartados ou uma base de dado que parou de ser publicada."
        )


def test_pior_caso_de_bytes_com_o_nome_de_urna_no_limite_do_TSE() -> None:
    """O OUTRO extremo do intervalo: nome de 30, partido de 13, `sqcand` de 12.

    A propriedade acima roda sobre o caso de PISO — identidades curtas. Sozinha,
    ela nunca encostaria no pior caso, e foi exatamente assim que o limiar
    redondo de 9.000 sobreviveu por tanto tempo parecendo suficiente. Este teste
    existe para que o outro extremo do intervalo seja MEDIDO, e não estimado.

    🔴 A asserção decisiva é a de que o pior caso passa dos 9.000 B. Ela não é
    decorativa: é a prova, dentro da suíte, de que o limiar anterior era violado
    por dado realista — nome de urna de 28 caracteres já dá 9.058 B — e de que
    ninguém teria visto, porque nenhuma fixture chegava perto.

    Nada disso ameaça a publicação: a folga do Global Config é de ~521 KB. O que
    está em jogo é o acordo entre o ADR e o código.
    """
    serie = montar_serie_por_candidato(
        _bruta_janela_cheia(10 * 60),
        "SP",
        [
            {
                "id": cid,
                # 30 caracteres: o limite do campo do TSE, que é quem decide
                # este número — não nós. É por isso que o acordo é um intervalo.
                "nome": f"{_TETO_NOME}{i}",
                "partido": _TETO_PARTIDO,
                "sqcand": f"28000160750{i}",
                "pct_atual": 40.0 - i * 10,
                "pct_projetado": 41.0 - i * 10,
            }
            for i, cid in enumerate((11, 22, 33, 44))
        ],
    )
    assert serie is not None
    assert len(serie["eixo"]) == TETO_DE_PONTOS_DO_ADR
    assert len(f"{_TETO_NOME}0") == 30

    bytes_serie = len(
        json.dumps(serie, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )

    assert bytes_serie > 9_000, (
        f"o pior caso mede {bytes_serie} B e deveria passar dos 9.000 B — se "
        "não passa mais, a fixture deixou de ser o pior caso (nome de 30, "
        "partido de 13, sqcand de 12) e esta asserção parou de provar o que "
        "prova: que o limiar redondo antigo era violado por dado real."
    )
    assert bytes_serie <= SERIE_LIMITE_BYTES, (
        f"o pior caso mede {bytes_serie} B, acima do teto do ADR-0046 "
        f"({SERIE_TETO_BYTES} B + {SERIE_MARGEM_BYTES} B de margem)."
    )
    # E ele é MAIOR que o piso: o intervalo existe porque o nome de urna varia,
    # e esta linha é a que impede alguém de colapsar os dois num número só.
    assert bytes_serie > SERIE_PISO_BYTES


def test_teto_vale_mesmo_quando_o_dado_excede_a_janela_declarada() -> None:
    """Dado mais largo que a janela: a cadência SOBE, o começo fica.

    Um boletim travado pode trazer `dado_ts` muito mais antigo que a janela de
    `ts`. O `WHERE` da consulta fecha essa porta, mas o teto não pode depender
    só dela — um `WHERE` não é exercível por teste unitário, e é justamente o
    tipo de guarda que se perde numa reescrita.
    """
    bruta = _bruta_janela_cheia(20 * 60)
    # Mesmo dado, mas declarando uma cadência de janela curta (5 min), que
    # sozinha daria 240 pontos.
    bruta = SeriePorCandidatoBruta(5, bruta.por_escopo)
    serie = montar_serie_por_candidato(
        bruta, "SP", [_cand(11, "Um", "PT", 40.0, 41.0)]
    )
    assert serie is not None
    assert len(serie["eixo"]) <= SERIE_MAX_PONTOS
    assert serie["cadencia_min"] > 5
    primeiro = datetime.fromisoformat(serie["eixo"][0].replace("Z", "+00:00"))
    assert primeiro == datetime.fromtimestamp(
        _balde_epoch(BOLETIM, serie["cadencia_min"]), timezone.utc
    )


def test_cadencia_para_janela_e_a_menor_que_cabe() -> None:
    """A tabela inteira, escrita à mão — sem recalcular a fórmula do código."""
    assert cadencia_para_janela(60) == 5  # 1h  →  12 pontos
    assert cadencia_para_janela(600) == 5  # 10h → 120 pontos, no limite
    assert cadencia_para_janela(601) == 10  # 1 minuto além, e sobe
    assert cadencia_para_janela(1_200) == 10  # 20h → 120 pontos
    assert cadencia_para_janela(1_440) == 15  # 24h →  96 pontos
    assert cadencia_para_janela(1_800) == 15  # 30h → 120 pontos


# ===========================================================================
# O balde é representado pelo ÚLTIMO, nunca pela média
# ===========================================================================


def test_balde_guarda_o_ultimo_ponto_e_nao_a_media() -> None:
    """Mutação que este teste mata: representar o balde pela média.

    Média suavizaria descontinuidades e poderia fazer uma quantidade
    quase-monotônica regredir — o que a regra dos três estados proíbe. Os três
    valores do balde (10, 90, 50) são escolhidos para que a média (50) coincida
    com um valor REAL que não é o último: um teste com valores mais gentis
    passaria com as duas implementações.
    """
    base = BOLETIM
    bruta = _bruta(
        1,
        {
            "SP": {
                11: [
                    (base + timedelta(minutes=0), 10.0, 10.0),
                    (base + timedelta(minutes=1), 90.0, 90.0),
                    (base + timedelta(minutes=2), 50.0, 50.0),
                ]
            }
        },
    )
    bruta = SeriePorCandidatoBruta(5, bruta.por_escopo)
    serie = montar_serie_por_candidato(bruta, "SP", [_cand(11, "Um", "PT", 50.0, 50.0)])
    assert serie is not None
    assert len(serie["eixo"]) == 1
    assert serie["candidatos"][0]["apurado"] == [50.0]  # o último, que é 50
    # A média dos três também dá 50 — por isso a asserção decisiva é a de que o
    # último ponto de um balde com média DIFERENTE do último vence:
    outro = _bruta(
        1,
        {
            "SP": {
                11: [
                    (base, 10.0, 10.0),
                    (base + timedelta(minutes=1), 90.0, 90.0),
                ]
            }
        },
    )
    serie2 = montar_serie_por_candidato(
        SeriePorCandidatoBruta(5, outro.por_escopo),
        "SP",
        [_cand(11, "Um", "PT", 90.0, 90.0)],
    )
    assert serie2 is not None
    assert serie2["candidatos"][0]["apurado"] == [90.0]  # média seria 50,0


# ===========================================================================
# T5 (lado do produtor) — furo continua furo
# ===========================================================================


def test_balde_sem_medicao_sai_null_e_nunca_zero() -> None:
    """Mutação que este teste mata: `?? 0` / `or 0.0` na serialização.

    Dois buracos diferentes, e os dois têm de sair `null`:
      1. balde sem ciclo nenhum (o meio do array);
      2. balde com ciclo, mas com `pct_atual` NULL na linha (medição ausente).
    """
    base = BOLETIM
    bruta = _bruta(
        5,
        {
            "SP": {
                11: [
                    (base, 30.0, 31.0),
                    # 20h05 não existe — ciclo perdido.
                    (base + timedelta(minutes=10), 32.0, 33.0),
                    (base + timedelta(minutes=15), None, 34.0),
                ]
            }
        },
    )
    serie = montar_serie_por_candidato(bruta, "SP", [_cand(11, "Um", "PT", 32.0, 34.0)])
    assert serie is not None
    assert serie["eixo"] == [
        "2026-10-04T20:00:00Z",
        "2026-10-04T20:05:00Z",
        "2026-10-04T20:10:00Z",
        "2026-10-04T20:15:00Z",
    ]
    apurado = serie["candidatos"][0]["apurado"]
    assert apurado == [30.0, None, 32.0, None]
    assert 0 not in apurado
    assert 0.0 not in apurado


def test_furo_no_meio_nao_desloca_os_pontos_anteriores() -> None:
    """Balde por epoch, nunca por índice (ADR-0046 D2, constituição § 6).

    Mutação que este teste mata: derivar o balde da posição na lista. Com um
    ciclo perdido, todos os pontos publicados DEPOIS dele mudariam de hora — e
    o eixo do gráfico contaria uma noite que não aconteceu.
    """
    # 🔴 Os dois instantes caem FORA da fronteira do balde (20h01m30 e
    # 20h11m45). É o que torna esta asserção capaz de discriminar: com os
    # instantes exatamente em cima de 20h00 e 20h10, um eixo construído a partir
    # do próprio instante — sem truncar para o balde — daria o mesmo resultado, e
    # a mutação sobreviveria. Medido: sobreviveu, na primeira rodada.
    base = BOLETIM + timedelta(minutes=1, seconds=30)
    com_furo = _bruta(
        5,
        {
            "SP": {
                11: [
                    (base, 30.0, 31.0),
                    (base + timedelta(minutes=10, seconds=15), 32.0, 33.0),
                ]
            }
        },
    )
    serie = montar_serie_por_candidato(
        com_furo, "SP", [_cand(11, "Um", "PT", 32.0, 33.0)]
    )
    assert serie is not None
    assert serie["eixo"] == [
        "2026-10-04T20:00:00Z",
        "2026-10-04T20:05:00Z",
        "2026-10-04T20:10:00Z",
    ]
    assert serie["candidatos"][0]["apurado"] == [30.0, None, 32.0]


# ===========================================================================
# Forma, cor e ausência
# ===========================================================================


def test_serie_nunca_publica_o_campo_cor() -> None:
    """A cor sai do PARTIDO (ADR-0046 D5 / RF-171).

    `cor` publica `var(--color-cand-{rank})`, a cor por rank que o ADR-0024
    aposentou. No gráfico ela seria visível como MOVIMENTO: a linha trocando de
    cor ao vivo, no instante exato de uma ultrapassagem.
    """
    bruta = _bruta(5, {"SP": {c["id"]: [(BOLETIM, 10.0, 11.0)] for c in CINCO}})
    serie = montar_serie_por_candidato(bruta, "SP", CINCO)
    assert serie is not None
    texto = json.dumps(serie)
    assert "--color-cand-" not in texto
    assert all("cor" not in linha for linha in serie["candidatos"])
    assert [linha["partido"] for linha in serie["candidatos"]] == [
        "PT",
        "PL",
        "PSD",
        "MDB",
    ]


def test_sem_serie_o_campo_some_do_payload() -> None:
    """"Ainda não publico série" é um estado nomeado, não um objeto vazio.

    O consumidor distingue "o Blob não respondeu" de "o Blob respondeu sem a
    série" (`sem_serie`) — e só consegue porque o campo é ausente, não vazio.
    """
    assert montar_serie_por_candidato(None, "SP", CINCO) is None
    assert montar_serie_por_candidato(SeriePorCandidatoBruta(5, {}), "SP", CINCO) is None
    vazia = SeriePorCandidatoBruta(5, {"SP": {}})
    assert montar_serie_por_candidato(vazia, "SP", CINCO) is None
    # Escopo com dado, mas de OUTRA candidatura que não entrou no elenco.
    alheia = _bruta(5, {"SP": {999: [(BOLETIM, 10.0, 11.0)]}})
    assert montar_serie_por_candidato(alheia, "SP", CINCO) is None

    payload = build_edge_payload(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=[_uf_row("SP", 13, 10, 100.0, 100.0)],
        national_rows=[_national_row(13, 99.0, 1)],
        eleitorado_total_by_uf={"SP": 34_000_000},
    )
    assert "serie_por_candidato" not in payload


def test_uf_sem_serie_mantem_as_tres_series_agregadas() -> None:
    """O campo novo é aditivo: blob antigo e caller legado seguem válidos."""
    payloads = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=[_uf_row("SP", 13, 10, 100.0, 100.0)],
        national_rows=[_national_row(13, 99.0, 1)],
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf={},
    )
    series = payloads["SP"]["series_temporais"]
    assert set(series) == {"margem", "p_vitoria", "turnout"}


def test_escopos_nao_se_misturam() -> None:
    """A série de SP não vaza para RR nem para o nacional."""
    bruta = _bruta(
        5,
        {
            "SP": {11: [(BOLETIM, 11.0, 11.0)]},
            "RR": {11: [(BOLETIM, 22.0, 22.0)]},
            None: {11: [(BOLETIM, 33.0, 33.0)]},
        },
    )
    um = [_cand(11, "Um", "PT", 1.0, 1.0)]
    assert montar_serie_por_candidato(bruta, "SP", um)["candidatos"][0]["apurado"] == [
        11.0
    ]
    assert montar_serie_por_candidato(bruta, "RR", um)["candidatos"][0]["apurado"] == [
        22.0
    ]
    assert montar_serie_por_candidato(bruta, None, um)["candidatos"][0]["apurado"] == [
        33.0
    ]


# ===========================================================================
# A consulta
# ===========================================================================


def _sql_de_uma_leitura() -> str:
    conn = _ConnDeLeitura([])
    fetch_series_por_candidato(conn, 1, 1, window_hours=24)
    return conn.capturado["sql"]


def test_sql_bucketiza_pelo_dado_ts_e_nunca_pelo_relogio_de_calculo() -> None:
    """🔴 Decisão do dono, 2026-09-18 — o `COALESCE(dado_ts, ts)` SAIU.

    Era o design da spec 020 (§ 2.2d; o § 8 item 2 o chamava de "carga, não
    defesa"), e a decisão o revoga: ciclo sem hora do TSE vira buraco, não
    ponto. Em produção, das 572 linhas sem `dado_ts` posteriores à migration
    0009, ZERO têm `pct_atual` — o que some é só a linha da projeção, e ela é
    justamente a que marchava para a direita sobre dado congelado.

    A asserção olha o ARGUMENTO do `floor(extract(epoch FROM …))`, e não a
    ausência da palavra no SQL: `COALESCE` poderia sumir do balde e ficar no
    `momento`, e o gráfico continuaria mentindo — foi assim que uma mutação
    sobreviveu na Fase 1. Por isso as três posições são conferidas uma a uma.
    """
    sql = _sql_de_uma_leitura()
    fonte_do_balde = re.search(r"floor\(extract\(epoch FROM ([^)]*\)?)\s*\)\s*/", sql)
    assert fonte_do_balde is not None, "expressão do balde não encontrada no SQL"
    assert fonte_do_balde.group(1).strip() == "dado_ts"

    # E o representante do balde é escolhido pelo MESMO relógio, em ordem DESC.
    assert re.search(r"ORDER BY uf, candidato_id, balde, momento DESC", sql)
    assert re.search(r"(?<![_\w])dado_ts AS momento", sql)

    # Nenhuma das três posições sobreviveu com o fallback.
    assert "COALESCE" not in sql.upper(), (
        "o relógio de cálculo voltou a ancorar a série (decisão de 18/09)"
    )


def test_sql_descarta_a_linha_sem_hora_do_boletim() -> None:
    """O filtro que a decisão de 18/09 nomeia, e o seu INVERSO.

    Mutação que este teste mata: `dado_ts IS NULL` no lugar de `IS NOT NULL` —
    o inverso exato do filtro, que publicaria SÓ os ciclos cegos e nenhum
    boletim. `"dado_ts IS" in sql` passaria nos dois casos.
    """
    sql = _sql_de_uma_leitura()
    assert "dado_ts IS NOT NULL" in sql
    assert re.search(r"dado_ts IS NULL", sql) is None


def test_sql_e_leitura_pura_e_limita_o_eixo_pelos_dois_relogios() -> None:
    """Constituição § 10 — append-only; e a janela vale para os dois relógios."""
    sql = _sql_de_uma_leitura()
    alto = sql.upper()
    for proibido in ("INSERT", "UPDATE", "DELETE", "ON CONFLICT"):
        assert proibido not in alto
    # Duas janelas, com papéis diferentes: `ts` é a coluna do índice
    # `ix_proj_serie` e limita a VARREDURA; `dado_ts` limita o EIXO. Sem a
    # segunda, um boletim travado há três dias entraria pela porta do `ts`
    # recente e esticaria o eixo para muito além da janela pedida.
    #
    # ⚠️ `"ts > NOW()" in sql` NÃO discrimina: `dado_ts > NOW()` contém essa
    # substring, e a asserção passaria com a janela do índice removida. O
    # lookbehind é o que separa as duas colunas.
    assert re.search(r"(?<![_\w])ts > NOW\(\)", sql), "janela da VARREDURA sumiu"
    assert "dado_ts > NOW()" in sql, "janela do EIXO sumiu"


# ---------------------------------------------------------------------------
# Um Postgres de brinquedo — a única forma de provar que os DOIS lados andam
# juntos
# ---------------------------------------------------------------------------
#
# `_ConnDeLeitura` devolve as linhas que recebeu, qualquer que seja o SQL: ele
# serve para inspecionar a CONSULTA, e não o resultado dela. Com ele, "voltar o
# `COALESCE(dado_ts, ts)` na leitura" não muda coisa nenhuma — e a mutação mais
# perigosa desta decisão é exatamente essa, porque ela sobrevive a corrigir só
# a outra metade (`anexar_ponto_corrente`).
#
# Este emulador fecha o buraco: ele DERIVA o comportamento do texto do SQL.
# Lê qual expressão o SQL usa como relógio, aplica o filtro de NULL que o SQL
# declara, bucketiza e resolve o `DISTINCT ON` pelo último do balde. Trocar a
# consulta troca o resultado, que é o que torna os dois testes abaixo capazes
# de discriminar.
#
# O que ele NÃO emula, de propósito: a janela `NOW() - interval`. As fixtures
# deste arquivo vivem em 04/10/2026 (`BOLETIM`), e amarrar o emulador ao
# relógio de parede faria estes testes mudarem de resultado conforme o dia em
# que a suíte roda. A janela é coberta por asserção de texto, logo acima.

#: As duas únicas expressões de relógio que o emulador conhece. Qualquer outra
#: levanta: um SQL novo tem de passar por aqui conscientemente, nunca ser
#: silenciosamente tratado como um dos dois casos conhecidos.
_RELOGIOS_CONHECIDOS = {
    "dado_ts": lambda linha: linha["dado_ts"],
    "COALESCE(dado_ts, ts)": lambda linha: linha["dado_ts"] or linha["ts"],
}


class _CursorDeProjections:
    def __init__(self, capturado: dict[str, Any], linhas: list[dict[str, Any]]) -> None:
        self._capturado = capturado
        self._linhas = linhas
        self._rows: list[tuple[Any, ...]] = []

    def __enter__(self) -> _CursorDeProjections:
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False

    @staticmethod
    def _relogio(sql: str):
        """Qual coluna o SQL usa como relógio — e ela tem de ser UMA só.

        ⚠️ `pytest.fail`, não `assert`: `fetch_series_por_candidato` engole
        `Exception` de propósito (série ausente não derruba o ciclo,
        constituição § 7), e um `AssertionError` daqui viraria "série vazia" —
        vermelho, mas com a causa apagada. `Failed` herda de `BaseException` e
        atravessa aquele `except`.
        """
        achado = re.search(r"floor\(extract\(epoch FROM ([^)]*\)?)\s*\)\s*/", sql)
        if achado is None:
            pytest.fail("expressão do balde não encontrada no SQL")
        balde = achado.group(1).strip()
        momento = re.search(r"([\w()., ]+?) AS momento", sql)
        if momento is None:
            pytest.fail("expressão de `momento` não encontrada no SQL")
        if balde != momento.group(1).strip():
            pytest.fail(
                "balde e `momento` saem de relógios DIFERENTES — o "
                f"representante do balde não é o último dele: balde={balde!r} "
                f"momento={momento.group(1).strip()!r}"
            )
        if balde not in _RELOGIOS_CONHECIDOS:
            pytest.fail(
                f"relógio {balde!r} desconhecido do emulador — ensine-o aqui "
                "antes de mudar a consulta"
            )
        return _RELOGIOS_CONHECIDOS[balde]

    def execute(self, sql: str, params: Any = None) -> None:
        self._capturado["sql"] = sql
        relogio = self._relogio(sql)
        largura = int(params["largura"])
        exige_nao_nulo = "dado_ts IS NOT NULL" in sql
        exige_nulo = re.search(r"dado_ts IS NULL", sql) is not None

        ultimo_do_balde: dict[tuple[Any, int, int], tuple[Any, ...]] = {}
        for linha in self._linhas:
            if exige_nao_nulo and linha["dado_ts"] is None:
                continue
            if exige_nulo and linha["dado_ts"] is not None:
                continue
            momento = relogio(linha)
            # `NULL > x` é NULL, e NULL reprova o `WHERE` — a linha não sai do
            # Postgres. Mesmo efeito aqui.
            if momento is None:
                continue
            balde = _balde_epoch(momento, largura // 60)
            chave = (linha["uf"], linha["candidato_id"], balde)
            anterior = ultimo_do_balde.get(chave)
            if anterior is None or momento > anterior[3]:
                ultimo_do_balde[chave] = (
                    linha["uf"],
                    linha["candidato_id"],
                    float(balde),
                    momento,
                    linha["pct_atual"],
                    linha["pct_projetado"],
                )
        self._rows = list(ultimo_do_balde.values())

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class _ConnDeProjections:
    def __init__(self, linhas: list[dict[str, Any]]) -> None:
        self.capturado: dict[str, Any] = {}
        self._linhas = linhas

    def cursor(self) -> _CursorDeProjections:
        return _CursorDeProjections(self.capturado, self._linhas)


def _eixo_do_balde(momento: datetime, cadencia_min: int) -> str:
    """Rótulo de eixo do balde que contém `momento` (`…T20:25:00Z`).

    Recalculado aqui a partir de `_balde_epoch` em vez de importado de
    `_eixo_iso`: a asserção é sobre a AUSÊNCIA de um instante no eixo, e
    reaproveitar a função que produz o eixo faria as duas pontas errarem
    juntas.
    """
    inicio = datetime.fromtimestamp(
        _balde_epoch(momento, cadencia_min), tz=timezone.utc
    )
    return inicio.strftime("%Y-%m-%dT%H:%M:%SZ")


def _linha_de_projections(
    *,
    dado_ts: datetime | None,
    ts: datetime,
    pct_atual: float | None,
    pct_projetado: float,
) -> dict[str, Any]:
    """Uma linha de `projections` como a 0009 a grava, para SP/candidatura 13."""
    return {
        "uf": "SP",
        "candidato_id": 13,
        "dado_ts": dado_ts,
        "ts": ts,
        "pct_atual": pct_atual,
        "pct_projetado": pct_projetado,
    }


#: A noite real em três ciclos: boletim, cego, boletim (decisão de 18/09).
#:
#: Os números vêm da medição de produção de 18/09 e não são decorativos:
#:
#:   - o ciclo cego tem `pct_atual` NULL, porque das 572 linhas sem `dado_ts`
#:     posteriores à 0009, ZERO têm `pct_atual`. Hora do boletim e voto medido
#:     vêm da mesma fonte;
#:   - o `pct_projetado` dele é DIFERENTE dos outros dois, porque o modelo
#:     reprojeta a cada ciclo mesmo sem dado novo (39 valores distintos naquelas
#:     572 linhas). É esse número que marchava para a direita sobre uma
#:     ingestão parada.
#:
#: O `ts` do ciclo cego (20:26) cai num balde ADIANTE dos dois boletins (20:00 e
#: 20:05), e essa folga é o que faz o teste discriminar pelo COMPRIMENTO do
#: eixo, e não só pelo valor de um ponto: com o relógio de cálculo de volta, a
#: grade vai de 20:00 a 20:25 — seis baldes onde cabem dois. Lag de ~20 min
#: entre o carimbo do TSE e o ciclo do modelo é o cenário normal, não o extremo.
_CICLO_CEGO_TS = BOLETIM + timedelta(minutes=26)
_TRES_CICLOS = [
    _linha_de_projections(
        dado_ts=BOLETIM,
        ts=BOLETIM + timedelta(minutes=20),
        pct_atual=41.11,
        pct_projetado=44.11,
    ),
    _linha_de_projections(
        dado_ts=None,
        ts=_CICLO_CEGO_TS,
        pct_atual=None,
        pct_projetado=47.11,
    ),
    _linha_de_projections(
        dado_ts=BOLETIM + timedelta(minutes=5),
        ts=BOLETIM + timedelta(minutes=32),
        pct_atual=42.11,
        pct_projetado=44.55,
    ),
]


def _serie_dos_tres_ciclos(conn: _ConnDeProjections) -> dict[str, Any]:
    bruta = fetch_series_por_candidato(conn, 1, 1)
    serie = montar_serie_por_candidato(bruta, "SP", [_cand(13, "A", "PT", 42.11, 44.55)])
    assert serie is not None
    return serie


def test_a_noite_com_um_ciclo_cego_tem_dois_pontos_e_nao_tres() -> None:
    """Boletim, ciclo cego, boletim — o eixo tem DOIS pontos.

    Mutação que este teste mata: `COALESCE(dado_ts, ts)` de volta em qualquer
    das três posições da consulta. Diferente das asserções de texto acima, esta
    passa pelo emulador: é o resultado que muda, não o `str`.

    Duas asserções e as duas necessárias. O comprimento do eixo pega o ponto a
    mais; a do `projetado` pega o caso em que o ciclo cego cai num balde JÁ
    ocupado e substitui o boletim como último do balde, sem mudar o
    comprimento.
    """
    serie = _serie_dos_tres_ciclos(_ConnDeProjections(_TRES_CICLOS))

    assert serie["eixo"] == ["2026-10-04T20:00:00Z", "2026-10-04T20:05:00Z"]

    # O instante do ciclo cego não está no eixo — nem ele, nem o balde dele.
    instante_cego = _eixo_do_balde(_CICLO_CEGO_TS, serie["cadencia_min"])
    assert instante_cego not in serie["eixo"]

    linha = serie["candidatos"][0]
    assert linha["projetado"] == [44.11, 44.55], (
        "a projeção do ciclo cego (47.11) entrou na série — a linha marchou "
        "para a direita sobre um ciclo em que nenhum boletim chegou"
    )
    assert linha["apurado"] == [41.11, 42.11]


def test_com_o_coalesce_de_volta_na_leitura_o_ciclo_cego_ressuscita(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A metade da decisão que mora na LEITURA — e a prova de que o emulador vê.

    🔴 Este é o caso que o dono destacou: corrigir só `anexar_ponto_corrente`
    não resolve nada. A linha do ciclo cego é gravada em `projections` com
    `dado_ts` NULL de qualquer jeito (o ADR-0038 D1 proíbe a coluna cair para
    outro relógio), e o `COALESCE` da consulta a traria de volta no ciclo
    seguinte, no mesmo lugar errado — a linha passaria a PISCAR: some no ciclo
    em que nasce, reaparece no seguinte.

    Aqui a consulta antiga é remontada a partir da atual e injetada. Se ela
    NÃO ressuscitasse o ciclo cego, o emulador seria cego ao SQL e o teste
    acima não provaria nada — é por isso que este existe.
    """
    import api.model.project as proj

    atual = proj._SERIE_POR_CANDIDATO_SQL
    antiga = (
        atual.replace(
            "floor(extract(epoch FROM dado_ts)",
            "floor(extract(epoch FROM COALESCE(dado_ts, ts))",
        )
        .replace("dado_ts AS momento", "COALESCE(dado_ts, ts) AS momento")
        .replace("          AND dado_ts IS NOT NULL\n", "")
        .replace("AND dado_ts > NOW()", "AND COALESCE(dado_ts, ts) > NOW()")
    )
    assert antiga != atual, (
        "a consulta de produção voltou a ser a antiga — o `COALESCE` está de "
        "volta na leitura (decisão do dono, 18/09)"
    )

    monkeypatch.setattr(proj, "_SERIE_POR_CANDIDATO_SQL", antiga)
    serie = _serie_dos_tres_ciclos(_ConnDeProjections(_TRES_CICLOS))

    instante_cego = _eixo_do_balde(_CICLO_CEGO_TS, serie["cadencia_min"])
    assert instante_cego in serie["eixo"]
    assert 47.11 in serie["candidatos"][0]["projetado"]
    assert len(serie["eixo"]) > 2


def test_sql_bucketiza_na_cadencia_mais_fina_qualquer_que_seja_a_janela() -> None:
    """A consulta é o PISO da cadência, não a cadência final.

    Mutação que este teste mata: derivar a largura do balde de `window_hours`.
    A janela de leitura é sempre 24h, mas às 19h a apuração tem uma hora de
    vida — e a série sairia em baldes de 15 min a noite inteira, com quatro
    pontos onde cabem doze. Quem decide a cadência é quem conhece o primeiro e o
    último ponto, e isso é a montagem, não a consulta.
    """
    for horas in (1, 8, 24):
        conn = _ConnDeLeitura([])
        bruta = fetch_series_por_candidato(conn, 1, 1, window_hours=horas)
        assert bruta.cadencia_min == SERIE_CADENCIAS_MIN[0]
        assert conn.capturado["params"]["largura"] == SERIE_CADENCIAS_MIN[0] * 60
        assert conn.capturado["params"]["janela"] == str(horas)


def test_cadencia_publicada_segue_a_noite_e_nao_a_janela_de_leitura() -> None:
    """Uma hora de apuração sai em baldes de 5 min, com a janela lida de 24h.

    É o caso de TODA a primeira metade da noite, e o que separa um gráfico
    legível de uma linha de quatro pontos.
    """
    uma_hora = _bruta_janela_cheia(60)
    serie = montar_serie_por_candidato(
        uma_hora, "SP", [_cand(11, "Um", "PT", 40.0, 41.0)]
    )
    assert serie is not None
    assert serie["cadencia_min"] == 5
    assert len(serie["eixo"]) == 12


def test_leitura_separa_escopos_e_preserva_none() -> None:
    """Linha nacional (`uf IS NULL`) vira o escopo `None`; NULL continua NULL."""
    balde = _balde_epoch(BOLETIM, 15)
    rows = [
        ("SP", 13, float(balde), BOLETIM, 55.0, 54.0),
        (None, 13, float(balde), BOLETIM, None, 53.5),
    ]
    bruta = fetch_series_por_candidato(_ConnDeLeitura(rows), 1, 1)
    assert bruta.por_escopo["SP"][13][balde]["pct_atual"] == 55.0
    assert bruta.por_escopo[None][13][balde]["pct_atual"] is None
    assert bruta.por_escopo[None][13][balde]["pct_projetado"] == 53.5


def test_falha_de_consulta_nao_derruba_o_ciclo() -> None:
    """Banco sem a 0009 → série vazia + warn, nunca exceção (constituição § 7).

    Série ausente é um estado que a tela sabe mostrar; ciclo derrubado por causa
    de um eixo horizontal não é.
    """
    bruta = fetch_series_por_candidato(_ConnQueQuebra(), 1, 1)
    assert bruta.por_escopo == {}
    assert bruta.cadencia_min == SERIE_CADENCIAS_MIN[0]


# ===========================================================================
# T2 ponta a ponta — o elenco nos DOIS escopos, saindo dos construtores reais
# ===========================================================================

#: Cinco candidaturas de UF em que apurado e projetado discordam de ordem.
#:
#:   por `pct_atual`     → [11, 22, 33, 44]
#:   por `pct_projetado` → [11, 33, 22, 55]
#:
#: É o cenário da noite de apuração: os votos já contados dizem uma coisa, a
#: projeção diz outra, e o gráfico tem de seguir a MESMA regra do painel de
#: resultado logo acima dele.
_CINCO_UF = [
    ("SP", 11, 3_500_000, 35.0, 34.0),
    ("SP", 22, 3_000_000, 30.0, 19.0),
    ("SP", 33, 2_000_000, 20.0, 29.0),
    ("SP", 44, 1_000_000, 10.0, 5.0),
    ("SP", 55, 500_000, 5.0, 13.0),
]


def _bruta_dos_cinco(escopo: str | None) -> SeriePorCandidatoBruta:
    return _bruta(
        5,
        {escopo: {cid: [(BOLETIM, pct, proj)] for _uf, cid, _v, pct, proj in _CINCO_UF}},
    )


def test_elenco_da_uf_sai_do_comparador_e_nao_do_rank_ja_calculado() -> None:
    """Mutação que este teste mata: usar a ordem que `build_uf_payloads` já tem.

    Dez linhas acima do call site existe um `sorted(rows, key=pct_projetado,
    reverse=True)` — o rank que identifica líder e segundo da UF. Reaproveitá-lo
    é o caminho de menor resistência, não quebra nada, e põe 55 no gráfico no
    lugar de 44 exatamente quando apurado e projetado discordam: na noite.
    """
    payloads = build_uf_payloads(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=[_uf_row(uf, cid, v, pct, proj) for uf, cid, v, pct, proj in _CINCO_UF],
        national_rows=[
            _national_row(cid, proj, i + 1)
            for i, (_uf, cid, _v, _pct, proj) in enumerate(_CINCO_UF)
        ],
        municipio_aggregates={},
        zona_municipio={},
        series_by_uf={},
        serie_bruta=_bruta_dos_cinco("SP"),
    )
    serie = payloads["SP"]["series_temporais"]["por_candidato"]
    assert [c["id"] for c in serie["candidatos"]] == [11, 22, 33, 44]


def test_elenco_nacional_sai_do_comparador_e_nao_da_ordem_semantica() -> None:
    """No nacional a ordem do array é semântica — líder, segundo, cauda.

    Mutação que este teste mata: publicar os quatro primeiros de
    `national.candidatos` como estão. Essa lista já vem ordenada por `cand_a`,
    `cand_b` e depois `pct_projetado` desc — que aqui é uma ordem diferente da
    do comparador, e traria 55 para dentro do gráfico.
    """
    payload = build_edge_payload(
        cargo=1,
        turno=1,
        ts_iso=BOLETIM.isoformat(),
        uf_rows=[_uf_row(uf, cid, v, pct, proj) for uf, cid, v, pct, proj in _CINCO_UF],
        national_rows=[
            _national_row(cid, proj, i + 1)
            for i, (_uf, cid, _v, _pct, proj) in enumerate(_CINCO_UF)
        ],
        eleitorado_total_by_uf={"SP": 34_000_000},
        cand_a_id=11,
        cand_b_id=33,
        serie_bruta=_bruta_dos_cinco(None),
    )
    ordem_do_placar = [c["id"] for c in payload["national"]["candidatos"]]
    ordem_do_grafico = [c["id"] for c in payload["serie_por_candidato"]["candidatos"]]

    assert ordem_do_grafico == [11, 22, 33, 44]
    # O placar tem outra ordem (semântica), e é isso que torna a asserção acima
    # capaz de discriminar: as duas listas NÃO podem ser copiadas uma da outra.
    assert ordem_do_placar[:4] != ordem_do_grafico


def test_datetime_ingenuo_do_driver_nao_cai_no_fuso_da_maquina(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Instante sem fuso é lido como UTC, nunca como hora local do servidor.

    `timestamptz` chega aware do psycopg, mas a coluna pode ser lida por um
    caminho que perde o fuso (driver legado, fixture, replay) — e aí
    `datetime.timestamp()` assume o fuso da MÁQUINA. Numa máquina em
    `America/Sao_Paulo` isso empurraria todo o eixo três horas para a frente, e
    o gráfico contaria uma noite que não aconteceu. O bug seria invisível num
    CI em UTC e visível na máquina de quem revisa — a pior combinação possível.

    O teste fixa `TZ` em `America/Sao_Paulo` justamente para não depender do
    fuso de quem roda a suíte: sem isso, ele passaria em UTC com a proteção
    removida. Medido: passava.
    """
    import time

    monkeypatch.setenv("TZ", "America/Sao_Paulo")
    time.tzset()
    try:
        ingenuo = datetime(2026, 10, 4, 20, 0, 0)  # sem tzinfo, de propósito
        rows = [("SP", 13, float(_balde_epoch(BOLETIM, 15)), ingenuo, 55.0, 54.0)]
        bruta = fetch_series_por_candidato(_ConnDeLeitura(rows), 1, 1)
        serie = montar_serie_por_candidato(
            bruta, "SP", [_cand(13, "A", "PT", 55.0, 54.0)]
        )
        assert serie is not None
        assert serie["eixo"] == ["2026-10-04T20:00:00Z"]
    finally:
        monkeypatch.undo()
        time.tzset()


# ===========================================================================
# Piso do fechamento das urnas — emenda de 03/10/2026 ao ADR-0054
# ===========================================================================


def test_piso_da_serie_e_o_fechamento_das_urnas_de_cada_turno() -> None:
    """17h BRT do dia de cada turno; turno desconhecido ⇒ piso neutro (época)."""
    from datetime import datetime, timedelta, timezone

    from api.model.project import _piso_da_serie

    brt = timezone(timedelta(hours=-3))
    assert _piso_da_serie(1) == datetime(2026, 10, 4, 17, 0, tzinfo=brt)
    assert _piso_da_serie(2) == datetime(2026, 10, 25, 17, 0, tzinfo=brt)
    assert _piso_da_serie(9) == datetime(1970, 1, 1, tzinfo=timezone.utc)


def test_consulta_recebe_o_piso_do_turno_e_o_aplica_so_depois_dele() -> None:
    """A consulta leva o piso do turno pedido e o usa nas duas metades: antes
    do instante (`NOW() < piso`) nada muda; depois, só `dado_ts >= piso`. Sem
    isso, às 17h de 04/10 o eixo começaria na véspera (zeros da virada e as
    linhas falsas de RR do incidente de 03/10)."""
    from api.model.project import _piso_da_serie

    for turno in (1, 2):
        conn = _ConnDeLeitura([])
        fetch_series_por_candidato(conn, 1, turno, window_hours=24)
        assert conn.capturado["params"]["piso"] == _piso_da_serie(turno)
        sql = " ".join(conn.capturado["sql"].split())
        assert "AND (NOW() < %(piso)s OR dado_ts >= %(piso)s)" in sql
