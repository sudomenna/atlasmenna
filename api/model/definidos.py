"""api/model/definidos.py

Quem está **matematicamente eleito pela contagem** — os campos opcionais
`por_uf[].eleitos_definidos` e `por_uf[].segundo_turno_definido` do payload
nacional dos cargos 1, 3 e 5 (decisão do dono, 04/10/2026).

## Por que existe, ao lado de `chamada`

`por_uf[].chamada` (`project.py::chamada_da_corrida`) é uma leitura da
PROJEÇÃO: margem projetada > 10 pp. O dono decidiu que o fundo colorido + ✓ do
balão do mapa nacional só aparece quando a vitória é um FATO da contagem — não
uma estimativa, por folgada que seja. `chamada` continua existindo (outras
telas a usam); estes campos são uma segunda pergunta, com resposta mais estrita.

## As três regras (decisões do dono, 04/10)

  - **Governador (3)** — o TSE responde. Campo `md` do EA20 de abrangência UF
    (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:590-600`):
    `md == "e"` ⇒ eleito o líder da CONTAGEM entre os que competem (destino
    diferente de anulado, ADR-0053); `md == "s"` ⇒ 2º turno definido (só no
    1º turno). O `md` só existe enquanto `tf == "n"`; depois da totalização
    final valem as marcas por candidatura (`cand[].st`/`cand[].e`).
  - **Presidente (1)** — ninguém é eleito por UF. Só o arquivo `br` decide:
    `md == "e"` (ou a totalização final) ⇒ o eleito ganha o campo em toda UF
    em que aparece em `top_candidatos`. `md == "s"` nacional NÃO vira nada
    por UF.
  - **Senador (5, 2 vagas)** — o TSE **não publica `md` para o Senado**. A conta
    é nossa e conservadora:

        R = aptos − comparecimento − abstenção     (e.te − e.c − e.a da UF)

    é o teto de eleitores que ainda podem ter voto somado. Ordenadas as
    candidaturas que competem pelos votos absolutos apurados, a k-ésima
    (k ≤ vagas) está definida se `votos_k − votos_(vagas+1) > R` — estrito;
    sem (vagas+1)-ésima, os votos dela são 0.

    **Por que basta comparar com a primeira de fora.** Cada eleitor dá no
    máximo UM voto a uma mesma candidatura (os dois votos do Senado vão para
    candidaturas distintas). Então um eleitor restante aumenta a diferença
    `votos_k − votos_j` em no máximo 1 a favor de `j`, e os R restantes, em no
    máximo R. Se a k-ésima está mais de R à frente da (vagas+1)-ésima, está
    mais de R à frente de TODAS as que estão abaixo dela, e nenhuma delas
    pode ultrapassá-la: no fim, só as `k−1 < vagas` de cima podem estar à
    frente, e ela fica com uma vaga. Igualdade (`== R`) permite empate ⇒ não
    definida.

    Tudo tem de sair do MESMO arquivo (os votos e o R): misturar votos mais
    novos com um R mais velho, ou o contrário, pode quebrar a garantia.

## Totalização final (`tf == "s"`)

A marca `cand[].e == "s"` do TSE quer dizer "eleito **ou** vai ao 2º turno"
(dicionário, `:809-813`). Lida sozinha, num 1º turno de Governador com 2º
turno, marcaria os DOIS finalistas como eleitos. Por isso a ordem é:

  1. `esae == "s"` (sem atribuição de eleito) ⇒ nada;
  2. `cand[].st` presente em alguma candidatura ⇒ ele decide: `Eleito`,
     `Eleito por QP`, `Eleito por média` ⇒ eleito; `2º turno` ⇒ 2º turno;
  3. sem `st` em nenhuma: `cand[].e == "s"`. Onde o 2º turno é possível (vaga
     única no 1º turno), UMA marca é eleito e DUAS são 2º turno; qualquer
     outra contagem é dado que não entendemos ⇒ nada. Sem 2º turno possível
     (Senado, ou o próprio 2º turno), as marcas são os eleitos — se forem
     mais que as vagas, nada.

## Nunca inventar

Dado ausente ⇒ resultado vazio ⇒ o produtor OMITE os campos (nunca `[]`, nunca
`false`). Este módulo é puro: recebe a leitura já extraída do EA20
(`project.py::ler_definicao_agregado`) e devolve ids.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, NamedTuple, TypedDict


class CandidaturaContada(TypedDict, total=False):
    """Uma candidatura de UM arquivo agregado do TSE."""

    id: int  # `cand.n`
    votos: int  # `cand.vap`
    destino: str  # "valido" | "anulado" | "sub_judice" — ausente se o TSE não publicou
    e: str  # `cand.e` cru ("s"/"n")
    st: str  # `cand.st` cru — só após a totalização final


class LeituraAgregado(NamedTuple):
    """O que as regras precisam de UM arquivo agregado (`uf` ou `br`)."""

    md: str | None  # "e" | "s" | "n" | None (ausente)
    tf: bool  # `tf == "s"`
    esae: bool  # `esae == "s"`
    candidaturas: list[CandidaturaContada]
    #: `e.te − e.c − e.a` do MESMO arquivo; `None` quando não dá para saber.
    restantes: int | None


class Definicao(NamedTuple):
    """Resultado de uma corrida: ids eleitos e se o 2º turno está definido."""

    eleitos: tuple[int, ...] = ()
    segundo_turno: bool = False


VAZIA = Definicao()


def _norm(texto: Any) -> str:
    return str(texto or "").strip().casefold()


def _competem(cands: Iterable[CandidaturaContada]) -> list[CandidaturaContada]:
    """Sem as de voto anulado (ADR-0053). Sub judice COMPETE (decisão do
    dono); sem destino publicado também — o TSE só o publica após a 1ª
    totalização parcial."""
    return [c for c in cands if c.get("destino") != "anulado"]


def _ordenadas_por_votos(cands: Iterable[CandidaturaContada]) -> list[CandidaturaContada]:
    # Desempate por id: determinismo (constituição § 6). Onde o empate importa,
    # as regras abaixo comparam VALORES, não posições, e o desempate não decide.
    return sorted(cands, key=lambda c: (-int(c.get("votos") or 0), int(c["id"])))


def lider_da_contagem(cands: Iterable[CandidaturaContada]) -> int | None:
    """Id da que competem com mais votos; `None` se não há ou se há empate
    no topo (um `md == "e"` com empate seria dado que não entendemos)."""
    ordem = _ordenadas_por_votos(_competem(cands))
    if not ordem:
        return None
    if len(ordem) > 1 and int(ordem[0].get("votos") or 0) == int(ordem[1].get("votos") or 0):
        return None
    return int(ordem[0]["id"])


_ST_ELEITO = ("eleito", "eleito por qp", "eleito por média", "eleito por media")
_ST_SEGUNDO_TURNO = ("2º turno", "2° turno", "2o turno", "segundo turno")


def definicao_pela_totalizacao(
    leitura: LeituraAgregado,
    *,
    vagas: int,
    segundo_turno_possivel: bool,
) -> Definicao:
    """Depois de `tf == "s"`: as marcas que o próprio TSE pôs em cada
    candidatura. Ver a docstring do módulo, § Totalização final."""
    if leitura.esae:
        return VAZIA
    cands = leitura.candidaturas
    com_st = [c for c in cands if _norm(c.get("st"))]
    if com_st:
        eleitos = tuple(sorted(int(c["id"]) for c in com_st if _norm(c.get("st")) in _ST_ELEITO))
        segundo = segundo_turno_possivel and any(
            _norm(c.get("st")) in _ST_SEGUNDO_TURNO for c in com_st
        )
        if len(eleitos) > vagas:
            return VAZIA
        if eleitos and segundo:
            return VAZIA  # eleito E 2º turno no mesmo arquivo: contraditório
        return Definicao(eleitos=eleitos, segundo_turno=segundo)

    marcados = sorted(int(c["id"]) for c in cands if _norm(c.get("e")) == "s")
    if segundo_turno_possivel:
        if len(marcados) == 1:
            return Definicao(eleitos=(marcados[0],))
        if len(marcados) == 2:
            return Definicao(segundo_turno=True)
        return VAZIA
    if 0 < len(marcados) <= vagas:
        return Definicao(eleitos=tuple(marcados))
    return VAZIA


def definicao_vaga_unica(leitura: LeituraAgregado | None, *, turno: int) -> Definicao:
    """Presidente (arquivo `br`) e Governador (arquivo `uf`): o `md` do TSE."""
    if leitura is None:
        return VAZIA
    segundo_turno_possivel = int(turno) == 1
    if leitura.tf:
        return definicao_pela_totalizacao(
            leitura, vagas=1, segundo_turno_possivel=segundo_turno_possivel
        )
    md = _norm(leitura.md)
    if md == "e":
        lider = lider_da_contagem(leitura.candidaturas)
        return Definicao(eleitos=(lider,)) if lider is not None else VAZIA
    if md == "s" and segundo_turno_possivel:
        return Definicao(segundo_turno=True)
    return VAZIA


def definicao_senado(leitura: LeituraAgregado | None, *, vagas: int = 2) -> Definicao:
    """Senador: a conta própria conservadora (docstring do módulo)."""
    if leitura is None:
        return VAZIA
    if leitura.tf:
        return definicao_pela_totalizacao(leitura, vagas=vagas, segundo_turno_possivel=False)
    restantes = leitura.restantes
    if restantes is None or restantes < 0:
        return VAZIA
    ordem = _ordenadas_por_votos(_competem(leitura.candidaturas))
    if not ordem:
        return VAZIA
    primeira_fora = int(ordem[vagas].get("votos") or 0) if len(ordem) > vagas else 0
    eleitos = tuple(
        sorted(
            int(c["id"])
            for c in ordem[:vagas]
            if int(c.get("votos") or 0) - primeira_fora > restantes
        )
    )
    return Definicao(eleitos=eleitos)


class Definidos(NamedTuple):
    """Tudo o que `build_edge_payload` precisa: por UF (Gov/Sen) e o
    nacional (Presidente)."""

    por_uf: Mapping[str, Definicao] = {}
    nacional: Definicao = VAZIA


def campos_definidos(
    cargo: int,
    turno: int,
    sigla: str,
    ids_top: Iterable[int],
    definidos: Definidos | None,
) -> dict[str, Any]:
    """As chaves a acrescentar em `por_uf[]` — `{}` quando nada está definido.

    `eleitos_definidos` só leva ids que estão em `top_candidatos` (é contra
    eles que a tela procura), em ordem crescente (determinismo).
    `segundo_turno_definido: True` só em Governador, 1º turno.
    """
    if definidos is None:
        return {}
    cargo = int(cargo)
    if cargo == 1:
        definicao = definidos.nacional
    elif cargo in (3, 5):
        definicao = definidos.por_uf.get(sigla, VAZIA)
    else:
        return {}
    presentes = set(int(i) for i in ids_top)
    out: dict[str, Any] = {}
    eleitos = sorted(i for i in definicao.eleitos if i in presentes)
    if eleitos:
        out["eleitos_definidos"] = eleitos
    if cargo == 3 and int(turno) == 1 and definicao.segundo_turno and not eleitos:
        out["segundo_turno_definido"] = True
    return out
