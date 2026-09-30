"""Do EA20 para o cálculo de cadeiras — `api/model/deputado.py` (spec 017).

O módulo é uma ponte fina, mas é onde moram três decisões que, erradas, produzem
número plausível e falso:

1. **Federação é UMA agremiação.** Tratá-la como N partidos muda a conta de
   cadeiras — `test_cadeiras.py::test_caso6_*` mede duas cadeiras de diferença
   num cenário realista.
2. **`sqcand`, não `cand.n`.** O número de urna se repete entre UFs e partidos no
   proporcional; usá-lo como chave funde candidatos distintos.
3. **`lugares_a_preencher` vem de `carg[].nv`**, nunca de tabela embutida
   (RF-124) — errar o denominador do quociente corrompe a UF inteira.

E `conferir_contra_tse` é o golden que **não** depende do dataset histórico: o
EA20 traz o quociente (`carg[].qe`) e as cadeiras (`agr[].vag`) calculados pelo
próprio TSE.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.model.cadeiras import distribuir_cadeiras
from api.model.deputado import (
    conferir_contra_tse,
    extrair_entrada_proporcional,
)


def _cand(seq: int, numero: str, votos: int, nasc: str | None = None) -> dict[str, Any]:
    c: dict[str, Any] = {
        "n": numero,
        "sqcand": str(seq),
        "nm": f"Candidato {seq}",
        "nmu": f"Cand {seq}",
        "e": "n",
        "vap": f"{votos:,}".replace(",", "."),  # formato BR: separador de milhar
        "pvap": "0,00",
    }
    if nasc is not None:
        c["dt"] = nasc
    return c


def _envelope(
    agremiacoes: list[dict[str, Any]],
    *,
    nv: str | None = "8",
    qe: str | None = None,
    tf: str = "s",
    cargo: str = "6",
) -> dict[str, Any]:
    carg: dict[str, Any] = {"cd": cargo, "agr": agremiacoes}
    if nv is not None:
        carg["nv"] = nv
    if qe is not None:
        carg["qe"] = qe
    return {"tf": tf, "carg": [carg]}


# ---------------------------------------------------------------------------
# Federação — a decisão que mais muda o resultado
# ---------------------------------------------------------------------------


def test_federacao_vira_uma_agremiacao_com_todos_os_candidatos() -> None:
    """`agr[].tp == "f"` é a unidade; os `par[]` dentro dela são somados.

    Lei 9.096 art. 11-A + Lei 9.504 art. 6º-A: a federação atua como um único
    partido para contagem de votos e obtenção de cadeiras.
    """
    env = _envelope(
        [
            {
                "n": "99",
                "nm": "Federação X",
                "tp": "f",
                "tvtl": "300",
                "par": [
                    {"n": "10", "sg": "PA", "nm": "A", "tvtl": "200", "cand": [_cand(1, "1010", 2500)]},
                    {"n": "11", "sg": "PB", "nm": "B", "tvtl": "100", "cand": [_cand(2, "1110", 900)]},
                ],
            }
        ]
    )
    e = extrair_entrada_proporcional(env)

    assert len(e.agremiacoes) == 1, "federação saiu como mais de uma agremiação"
    fed = e.agremiacoes[0]
    assert fed.cod == "99"
    assert len(fed.candidatos) == 2, "candidatos dos dois partidos deviam estar juntos"
    assert fed.votos_legenda == 300
    assert fed.votos_totais == 300 + 2500 + 900


def test_partidos_isolados_ficam_separados() -> None:
    env = _envelope(
        [
            {"n": "10", "nm": "A", "tp": "i", "tvtl": "100", "par": [
                {"n": "10", "sg": "PA", "nm": "A", "tvtl": "100", "cand": [_cand(1, "1010", 500)]}]},
            {"n": "20", "nm": "B", "tp": "i", "tvtl": "50", "par": [
                {"n": "20", "sg": "PB", "nm": "B", "tvtl": "50", "cand": [_cand(2, "2010", 400)]}]},
        ]
    )
    e = extrair_entrada_proporcional(env)

    assert sorted(a.cod for a in e.agremiacoes) == ["10", "20"]


def test_coligacao_em_proporcional_e_marcada_nao_somada_em_silencio() -> None:
    """Coligação proporcional é vedada desde 2020 (CF art. 17 § 1º, EC 97/2017).

    Encontrar uma é anomalia de dado (ADR-0027, caso de borda 7). O extrator a
    devolve com `cod` prefixado, para o caller poder logar — nunca a mistura com
    as agremiações legítimas sem deixar rastro.
    """
    env = _envelope(
        [
            {"n": "77", "nm": "Coligação Y", "tp": "c", "tvtl": "10", "par": [
                {"n": "30", "sg": "PC", "nm": "C", "tvtl": "10", "cand": [_cand(1, "3010", 100)]}]},
            {"n": "10", "nm": "A", "tp": "i", "tvtl": "5", "par": [
                {"n": "10", "sg": "PA", "nm": "A", "tvtl": "5", "cand": [_cand(2, "1010", 200)]}]},
        ]
    )
    e = extrair_entrada_proporcional(env)

    cods = {a.cod for a in e.agremiacoes}
    assert "coligacao:77" in cods, "coligação sumiu sem rastro"
    assert "10" in cods
    assert "77" not in cods, "coligação entrou como agremiação normal"


# ---------------------------------------------------------------------------
# Os três campos do TSE que ninguém lia
# ---------------------------------------------------------------------------


def test_lugares_a_preencher_vem_de_nv_nao_de_tabela() -> None:
    """RF-124 — o denominador do quociente sai do dado publicado."""
    env = _envelope([], nv="70")
    assert extrair_entrada_proporcional(env).lugares_a_preencher == 70


def test_nv_ausente_vira_none_em_vez_de_um_palpite() -> None:
    """Sem `nv` não há como calcular o quociente — e inventar é pior que parar."""
    env = _envelope([], nv=None)
    assert extrair_entrada_proporcional(env).lugares_a_preencher is None


def test_quociente_e_vagas_do_tse_sao_lidos_para_conferencia() -> None:
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "vag": "4", "par": [
            {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(1, "1010", 100)]}]}],
        qe="1.234",
    )
    e = extrair_entrada_proporcional(env)

    assert e.quociente_eleitoral_tse == 1234, "separador de milhar não foi tratado"
    assert e.vagas_tse == {"10": 4}


def test_totalizacao_final_e_lida() -> None:
    assert extrair_entrada_proporcional(_envelope([], tf="s")).totalizacao_final is True
    assert extrair_entrada_proporcional(_envelope([], tf="n")).totalizacao_final is False


# ---------------------------------------------------------------------------
# Identidade do candidato e desempate
# ---------------------------------------------------------------------------


def test_usa_sqcand_e_nao_o_numero_de_urna() -> None:
    """O número de urna se repete entre partidos e UFs no proporcional.

    Duas agremiações com candidatos de número **igual** têm de produzir códigos
    distintos — senão os dois viram um só no cálculo.
    """
    env = _envelope(
        [
            {"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [
                {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(111, "1010", 500)]}]},
            {"n": "20", "nm": "B", "tp": "i", "tvtl": "0", "par": [
                {"n": "20", "sg": "PB", "nm": "B", "cand": [_cand(222, "1010", 400)]}]},
        ]
    )
    e = extrair_entrada_proporcional(env)

    cods = [c.cod for a in e.agremiacoes for c in a.candidatos]
    assert cods == [111, 222], "o extrator usou o número de urna como identidade"
    assert len(set(cods)) == 2


def test_candidato_sem_sqcand_e_descartado_nao_vira_zero() -> None:
    """Sem identidade não dá para ordenar nem desempatar — melhor descartar."""
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [{"n": "10", "sg": "PA", "nm": "A",
            "cand": [{"n": "1010", "nm": "X", "nmu": "X", "e": "n", "vap": "500", "pvap": "0"}]}]}]
    )
    e = extrair_entrada_proporcional(env)
    assert e.agremiacoes[0].candidatos == ()


def test_data_de_nascimento_vira_inteiro_comparavel() -> None:
    """Art. 110 — empate elege o mais idoso. `dd/mm/aaaa` → AAAAMMDD."""
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [{"n": "10", "sg": "PA", "nm": "A",
            "cand": [_cand(1, "1010", 100, "31/12/1970"), _cand(2, "1011", 100, "01/01/1985")]}]}]
    )
    cands = extrair_entrada_proporcional(env).agremiacoes[0].candidatos

    assert cands[0].nascimento == 19701231
    assert cands[1].nascimento == 19850101
    assert cands[0].nascimento < cands[1].nascimento, "o mais idoso tem de vir antes"


@pytest.mark.parametrize("ruim", ["", "31-12-1970", "1970-12-31", "31/12/70", "abc", None])
def test_data_malformada_vira_none_em_vez_de_numero_errado(ruim: Any) -> None:
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [{"n": "10", "sg": "PA", "nm": "A",
            "cand": [_cand(1, "1010", 100, ruim)]}]}]
    )
    assert extrair_entrada_proporcional(env).agremiacoes[0].candidatos[0].nascimento is None


# ---------------------------------------------------------------------------
# Robustez do envelope
# ---------------------------------------------------------------------------


def test_desembrulha_abr_zero() -> None:
    """Alguns níveis do EA20 embrulham a raiz em `abr[0]`."""
    interno = _envelope([{"n": "10", "nm": "A", "tp": "i", "tvtl": "7", "par": [
        {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(1, "1010", 100)]}]}])
    assert extrair_entrada_proporcional({"abr": [interno]}).agremiacoes[0].votos_legenda == 7


def test_ignora_cargo_diferente() -> None:
    """Um envelope de Presidente não pode produzir agremiações de Deputado."""
    env = _envelope([{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [
        {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(1, "1010", 100)]}]}], cargo="1")
    e = extrair_entrada_proporcional(env, cargo=6)

    assert e.agremiacoes == []
    assert e.lugares_a_preencher is None


@pytest.mark.parametrize("lixo", [None, {}, [], "texto", {"carg": "nao é lista"}])
def test_envelope_degenerado_nao_levanta(lixo: Any) -> None:
    """Constituição § 7 — degradar é melhor que ficar mudo, e mudo é melhor que quebrar."""
    e = extrair_entrada_proporcional(lixo)
    assert e.agremiacoes == []


def test_legenda_cai_na_soma_dos_partidos_quando_o_agregado_falta() -> None:
    env = _envelope(
        [{"n": "99", "nm": "Fed", "tp": "f", "par": [
            {"n": "10", "sg": "PA", "nm": "A", "tvtl": "120", "cand": [_cand(1, "1010", 100)]},
            {"n": "11", "sg": "PB", "nm": "B", "tvtl": "80", "cand": [_cand(2, "1110", 100)]}]}]
    )
    assert extrair_entrada_proporcional(env).agremiacoes[0].votos_legenda == 200


# ---------------------------------------------------------------------------
# O golden ao vivo — conferência contra os números do próprio TSE
# ---------------------------------------------------------------------------


def _cenario_consistente() -> dict[str, Any]:
    """Envelope cujo `qe` e `vag` batem com o que o algoritmo produz.

    Votos válidos = 2.500 + 900 + 3.100 + 300 + 150 = 6.950; 8 vagas.
    6.950 / 8 = 868,75 → fração > 0,5 → QE 869.
    """
    return _envelope(
        [
            {"n": "99", "nm": "Fed", "tp": "f", "tvtl": "300", "par": [
                {"n": "10", "sg": "PA", "nm": "A", "tvtl": "300",
                 "cand": [_cand(1, "1010", 2500), _cand(2, "1011", 900)]}]},
            {"n": "20", "nm": "C", "tp": "i", "tvtl": "150", "par": [
                {"n": "20", "sg": "PC", "nm": "C", "tvtl": "150",
                 "cand": [_cand(3, "2010", 3100)]}]},
        ],
        nv="8",
        qe="869",
    )


def test_conferencia_silencia_quando_bate_com_o_tse() -> None:
    e = extrair_entrada_proporcional(_cenario_consistente())
    r = distribuir_cadeiras(e.agremiacoes, e.lugares_a_preencher or 1)

    assert r.quociente_eleitoral == 869, "o cenário deixou de ser consistente"
    assert conferir_contra_tse(r, e) == []


def test_conferencia_acusa_quociente_divergente() -> None:
    """Se o arredondamento do art. 106 regredir, é aqui que aparece."""
    env = _cenario_consistente()
    env["carg"][0]["qe"] = "870"  # um a mais que o correto
    e = extrair_entrada_proporcional(env)
    r = distribuir_cadeiras(e.agremiacoes, e.lugares_a_preencher or 1)

    divs = conferir_contra_tse(r, e)
    assert [d.o_que for d in divs] == ["quociente_eleitoral"]
    assert divs[0].nosso == 869 and divs[0].tse == 870


def test_conferencia_acusa_cadeira_divergente() -> None:
    """A divergência que importa: o TSE deu N cadeiras e nós demos outro número."""
    env = _cenario_consistente()
    env["carg"][0]["agr"][0]["vag"] = "99"
    e = extrair_entrada_proporcional(env)
    r = distribuir_cadeiras(e.agremiacoes, e.lugares_a_preencher or 1)

    divs = [d for d in conferir_contra_tse(r, e) if d.o_que.startswith("cadeiras[")]
    assert len(divs) == 1
    assert divs[0].tse == 99


# ---------------------------------------------------------------------------
# Identidade (design 017 D4) — o que a tela precisa e o algoritmo não
# ---------------------------------------------------------------------------


def test_sigla_da_federacao_vem_de_fed_porque_agr_nao_tem_sigla() -> None:
    """`agr[]` publica `n`, `nm`, `tp` e `com` — **não** `sg`.

    O design 017 (D4) supunha `agr[].sg`; o dicionário oficial não o tem. A
    sigla da federação sai de `carg[].fed[]` — é identidade (e chave, ver
    `chave_agremiacao`): voto e candidato continuam chegando exclusivamente
    por `agr[]`.

    ⚠️ 2026-09-29: o casamento é pelo número DA FEDERAÇÃO (`par[].nfed` =
    `fed[].n`), não pelo `agr[].n`. Este teste tinha os dois iguais (`"99"`);
    no dado real nunca são (`agr[].n` é o id da inscrição na UF, oito dígitos
    no simulado), e a sigla de `fed[]` não era encontrada.
    """
    env = _envelope(
        [
            {
                "n": "60139975",
                "nm": "Federação Brasil da Esperança",
                "tp": "f",
                "par": [
                    {"n": "13", "sg": "PT", "nm": "Partido A", "nfed": "101",
                     "cand": [_cand(1, "1310", 10)]},
                    {"n": "65", "sg": "PCdoB", "nm": "Partido B", "nfed": "101",
                     "cand": [_cand(2, "6510", 5)]},
                ],
            }
        ]
    )
    env["carg"][0]["fed"] = [
        {"n": "101", "nm": "Federação Brasil da Esperança", "sg": "FE BRASIL",
         "com": "PT/PCdoB", "npar": ["13", "65"]}
    ]

    identidades = extrair_entrada_proporcional(env).identidade_agremiacoes
    assert list(identidades) == ["fed:101"], "a chave é o número da federação, não o agr[].n"
    ident = identidades["fed:101"]

    assert ident.sigla == "FE BRASIL"
    assert ident.tipo == "federacao"
    assert ident.componentes == ("PT", "PCdoB")


def test_partido_isolado_pega_a_sigla_do_proprio_par_e_nao_tem_componentes() -> None:
    env = _envelope(
        [{"n": "13", "nm": "Partido dos Trabalhadores", "tp": "i", "tvtl": "0", "par": [
            {"n": "13", "sg": "PT", "nm": "Partido dos Trabalhadores",
             "cand": [_cand(1, "1310", 100)]}]}]
    )
    ident = extrair_entrada_proporcional(env).identidade_agremiacoes["13"]

    assert ident.sigla == "PT"
    assert ident.nome == "Partido dos Trabalhadores"
    assert ident.tipo == "partido"
    assert ident.componentes == (), "partido isolado não pode listar a si mesmo"


def test_sigla_de_partido_inapto_perde_o_marcador_de_asterisco() -> None:
    """O EA20 marca partido inapto com `**` à direita da sigla. É situação
    cadastral, não nome — exibir `PP**` numa barra seria colar dado de outro
    domínio no rótulo."""
    env = _envelope(
        [{"n": "11", "nm": "Progressistas", "tp": "i", "tvtl": "0", "par": [
            {"n": "11", "sg": "PP**", "nm": "Progressistas", "cand": [_cand(1, "1110", 10)]}]}]
    )
    assert extrair_entrada_proporcional(env).identidade_agremiacoes["11"].sigla == "PP"


def test_agremiacao_sem_nome_nem_sigla_cai_no_numero_nunca_em_branco() -> None:
    """Degradação (constituição § 7): barra com número é pior que barra com
    sigla, e muito melhor que barra anônima."""
    env = _envelope([{"n": "77", "tp": "i", "par": [{"n": "77", "cand": [_cand(1, "7710", 10)]}]}])
    ident = extrair_entrada_proporcional(env).identidade_agremiacoes["77"]

    assert ident.sigla == "77"
    assert ident.nome == "77"


def test_identidade_do_candidato_traz_nome_de_urna_e_partido() -> None:
    """`nmu` antes de `nm`: é o nome pelo qual o eleitor conhece o candidato.

    E `partido` é a sigla **dentro** da agremiação — numa federação é o que
    distingue os componentes (RF-122).
    """
    env = _envelope(
        [{"n": "99", "nm": "Fed", "tp": "f", "par": [
            {"n": "13", "sg": "PT", "nm": "A", "cand": [_cand(1, "1310", 100)]},
            {"n": "65", "sg": "PCdoB", "nm": "B", "cand": [_cand(2, "6510", 50)]}]}]
    )
    identidades = extrair_entrada_proporcional(env).identidade_candidatos

    assert identidades[1].nome == "Cand 1", "usou o nome completo em vez do de urna"
    assert identidades[1].partido == "PT"
    assert identidades[2].partido == "PCdoB"
    assert identidades[2].agremiacao == "99", "candidato perdeu o vínculo com a agremiação"


def test_coligacao_e_detectavel_sem_reconstruir_string() -> None:
    env = _envelope(
        [{"n": "77", "nm": "Coligação Y", "tp": "c", "par": [
            {"n": "30", "sg": "PC", "nm": "C", "cand": [_cand(1, "3010", 100)]}]}]
    )
    entrada = extrair_entrada_proporcional(env)

    assert entrada.tem_coligacao is True
    assert entrada.identidade_agremiacoes["coligacao:77"].tipo == "coligacao"


def test_envelope_sem_coligacao_nao_dispara_o_alarme() -> None:
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "par": [
            {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(1, "1010", 100)]}]}]
    )
    assert extrair_entrada_proporcional(env).tem_coligacao is False


def test_conferencia_nao_inventa_divergencia_quando_o_tse_omite() -> None:
    """Sem `qe` nem `vag` publicados, não há o que conferir — e silêncio é certo."""
    env = _envelope(
        [{"n": "10", "nm": "A", "tp": "i", "tvtl": "0", "par": [
            {"n": "10", "sg": "PA", "nm": "A", "cand": [_cand(1, "1010", 900)]}]}],
        nv="2",
    )
    e = extrair_entrada_proporcional(env)
    r = distribuir_cadeiras(e.agremiacoes, 2)

    assert e.quociente_eleitoral_tse is None
    assert conferir_contra_tse(r, e) == []
