"""Do resultado de cadeiras para o payload publicado (spec 017, design D5/D6).

`cadeiras.py` distribui as vagas e `deputado.py` traduz o EA20 para a entrada
daquele cálculo. Este módulo faz o último trecho: monta os dois JSONs que a tela
consome — `EdgePayloadDeputado` (nacional, Global Config) e `DeputadoUfDetail`
(por UF, Vercel Blob). O contrato dos dois está em
`docs/specs/017-deputado-federal/design.md`, D5 e D6, e é **ele** que manda: não
há tipo TypeScript espelhado aqui, e o lado TS é escrito contra o mesmo
documento.

## Três coisas que este módulo se recusa a fazer

**1. Publicar `vagas_obtidas`** (D2 / RF-125.1). Nem com esse nome, nem com
outro. É o denominador da média (Res.-TSE 23.677 art. 11 § 5º, ADI 5.420) e
conta quociente partidário não preenchido: numa UF de 10 vagas, a soma dá 11.
`Σ agremiacoes[].cadeiras == lugares_a_preencher` é a invariante que sai daqui.

**2. Somar votos de legenda aos nominais em silêncio** (RF-130). Os dois números
saem separados e o total sai explícito; a tela decide o que mostrar, mas não
pode ser enganada pelo payload.

**3. Fingir firmeza que a apuração não tem** (RF-127). Cadeira ganha em rodada
de sobras, com a margem para a próxima agremiação menor que a fatia de votos
ainda não apurada, sai com `indefinido: true`. Ver `_marcar_indefinidas`.

**4. Derivar o tamanho da Câmara do que já apurou** (2026-09-19). `total_cadeiras`
é fato fixo — 513, `cargos.TOTAL_CADEIRAS` — e não a soma dos
`lugares_a_preencher` das UFs presentes, que com três estados no ar diria "26
cadeiras em disputa". A soma continua medida, como **conferência**:
`conferir_total_de_cadeiras`.

## As duas metades de RF-127, e por que são duas

`cadeiras_ci95` (D5/D6) entrou em 2026-09-13, depois que o ADR-0036 moveu o
cargo 6 para granularidade de zona e deu ao bootstrap o que reamostrar. Ele é
**calculado fora daqui** (`api/model/cadeiras_bootstrap.py`) e chega pronto:
este módulo transporta, não sorteia — nada aqui consome RNG, e o payload
continua sendo função pura do que lhe entregam.

Ele **não** substitui `cadeiras_indefinidas`. São duas perguntas:

  - o **intervalo** responde "se o recorte de zonas já apuradas tivesse saído
    outro, quantas cadeiras esta agremiação teria?" — incerteza do que **já foi
    contado**;
  - a **marcação** responde "esta cadeira específica pode trocar de dono com o
    voto que **ainda falta** contar?" — e é determinística, em `Fraction`.

O intervalo não sabe nada do voto por vir, e a marcação não sabe nada de
variância geográfica. (Desde 2026-09-29 existe a PROJEÇÃO do voto por vir —
ADR-0063, `deputado_projecao.py` —, que supera o D9; ela sai em campos
próprios do contrato v2 e não altera nenhuma das duas metades da parcial.) Fundir as duas
apagaria uma das perguntas; derivar a marcação do intervalo a apagaria
justamente quando o intervalo é omitido (UF com menos de duas zonas apuradas,
ou o interruptor de emergência `TSE_DEPUTADO_GRANULARIDADE=uf`), que é quando o
dado está pior e o leitor mais precisa do aviso.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from fractions import Fraction
from typing import Any

from api.model.cadeiras import Agremiacao, ResultadoCadeiras
from api.model.cargos import (
    total_cadeiras as cadeiras_da_casa,
    vagas_em_disputa as cadeiras_em_disputa,
)
from api.model.dado_ts import RelogioDoDado
from api.model.deputado import (
    DESTINO_ANULADO,
    DESTINO_SUB_JUDICE,
    DESTINO_VALIDO_LEGENDA,
    ConferenciaTse,
    Divergencia,
    EntradaProporcional,
    IdentidadeAgremiacao,
    IdentidadeCandidato,
)
from api.model.deputado_projecao import EstadoProjecao, ProjecaoUf


def _pct(parte: int, total: int) -> float:
    """Percentual 0–100 com a mesma precisão do resto do payload (5 casas)."""
    if total <= 0:
        return 0.0
    return round(100.0 * parte / total, 5)


#: Valores possíveis de `divergencias[].o_que` no payload — conjunto FECHADO.
#:
#: A tela precisa rotular cada divergência para o leitor ("o quociente que
#: calculamos não bate com o do TSE"), e para isso ela mapeia esta chave para
#: uma frase. Um conjunto aberto obrigaria o outro lado a adivinhar strings
#: nossas: `conferir_contra_tse` produz `cadeiras[22]`, com o código da
#: agremiação embutido, o que gera uma chave nova por agremiação — e a chave
#: crua chegava à tela. Aqui ela é normalizada; o código da agremiação continua
#: visível, em `detalhe`.
#:
#: Acrescentar um valor aqui é mudança de contrato: combine com o lado TS antes.
#:
#: Spec 026 RF-269 (2026-09-29) acrescentou três, todos da conferência contra
#: o agregado da UF (`deputado.conferir_agregado_da_uf`, design 026 § 2.8):
#:   - `"eleitos"` — UMA linha: quantos a nossa parcial elegeu e o TSE não
#:     (`nosso`) e o inverso (`tse`), com os `sqcand` em `detalhe`; só com
#:     totalização final;
#:   - `"eleitorado"` — Σ `e.te` das zonas que somamos × `e.te` do agregado:
#:     parte do estado fora da nossa soma (o caso real do AP, zona 0014);
#:   - `"votos_validos"` — Σ `v.vv` das zonas × `v.vv` do agregado final.
CHAVES_DE_DIVERGENCIA = (
    "quociente_eleitoral",
    "cadeiras",
    "eleitos",
    "eleitorado",
    "votos_validos",
)

#: Chaves de divergência que carregam a MAGNITUDE (`diferenca_pct`, design 026
#: § 2.8): as duas que comparam tamanhos, não contas.
_CHAVES_COM_MAGNITUDE = frozenset({"eleitorado", "votos_validos"})

#: Versão do contrato do objeto da UF (design 026 § 2.4). Ausente ⇒ v1.
CONTRATO_V2 = 2

#: Quantas posições por agremiação vão no objeto da UF (ADR-0065: 20 visíveis
#: + 21–60 recortadas). Da 61ª em diante, só quem tem marca de eleito — o
#: resto vai para `lista_restante` (Blob `deputado/uf-lista/<UF>.json`).
POSICOES_NO_BLOB = 60

#: Mais votados da UF e do país (RF-270, RF-271).
MAX_MAIS_VOTADOS = 10

#: Puxadores do país no payload nacional (RF-273).
MAX_PUXADORES_NACIONAL = 30

#: `destino` interno (`deputado.destino_proporcional`) → valor publicado
#: (design 026 § 2.2). Tabela FECHADA: `"valido"`, `None` (dvt ainda não
#: publicado) e `"desconhecido"` não publicam `destino` — o último sai sem
#: percentual e fica fora da conta (ver `_linhas_da_agremiacao`).
_DESTINO_PUBLICADO: dict[str, str] = {
    DESTINO_VALIDO_LEGENDA: "valido_legenda",
    DESTINO_ANULADO: "anulado",
    DESTINO_SUB_JUDICE: "sub_judice",
}

#: Destinos cuja linha publica `pct_validos: null` (design 026 § 2.2 e o
#: contrato `tests/unit/contrato/deputado-v2-fixtures.test.ts`: "`null`
#: exatamente para anulado e sub judice"). ⚠️ O ADR-0064 (decisão 5 e pontos
#: em aberto) estende o `null` a `valido_legenda`; o contrato congelado em
#: 29/09 não — segue o contrato, e a divergência está no relatório da frente P.
_DESTINOS_SEM_PCT = frozenset({"anulado", "sub_judice"})

#: Ordem do `destino` no desempate do `rank` (design 026 § 3.1): válido <
#: `Válido (legenda)` < sub judice < anulado. `None` = válido/sem `dvt`; o
#: `"desconhecido"` (fora do cálculo, sem destino publicado) vai por último.
_ORDEM_DESTINO: dict[str | None, int] = {
    None: 0,
    "valido_legenda": 1,
    "sub_judice": 2,
    "anulado": 3,
}
_ORDEM_DESTINO_DESCONHECIDO = 4

#: Marcas oficiais que contam como "eleito" (a mesma regra da Conferência).
_TSE_ELEITO = frozenset({"eleito", "eleito_qp", "eleito_media"})

#: Art. 110 — candidatura sem data de nascimento conhecida vai para o fim do
#: empate (`cadeiras._ordenar_candidatos`).
_SEM_NASCIMENTO = 99_999_999

#: Quantos suplentes por agremiação entram no payload de UF (D6). A lista
#: completa de não eleitos de uma federação grande passa de 100 nomes numa UF
#: como SP — e o payload por UF já é a maior carga do produto (RNF-007a).
MAX_SUPLENTES = 5


def normalizar_divergencia(divergencia: Divergencia) -> dict[str, Any]:
    """`Divergencia` → a linha do payload, com `o_que` numa chave fechada.

    `conferir_contra_tse` nomeia a divergência de cadeiras como
    `cadeiras[<cod>]`, o que é ótimo em log e ruim em contrato: a tela recebe
    uma chave diferente por agremiação e não tem como mapeá-la para uma frase.
    A chave vira `"cadeiras"` e o código vai para `detalhe`, onde a tela já
    mostra texto.

    Chave desconhecida (alguém acrescentou uma comparação em `deputado.py` e
    esqueceu deste mapa) passa adiante como está, e não some: a divergência
    perdida seria pior que uma chave que a tela não sabe rotular.

    `eleitorado` e `votos_validos` levam `diferenca_pct` — `100·(nosso − tse)
    / tse`, 5 casas, com sinal (design 026 § 2.8): é o número que a tela
    escreve ("19,5% abaixo do boletim do TSE").
    """
    o_que = divergencia.o_que
    detalhe = divergencia.detalhe
    if o_que.startswith("cadeiras["):
        cod = o_que[len("cadeiras[") : -1]
        o_que = "cadeiras"
        detalhe = f"agremiação {cod} — {detalhe}" if detalhe else f"agremiação {cod}"
    linha: dict[str, Any] = {
        "o_que": o_que,
        "nosso": divergencia.nosso,
        "tse": divergencia.tse,
        "detalhe": detalhe,
    }
    if o_que in _CHAVES_COM_MAGNITUDE and divergencia.tse:
        linha["diferenca_pct"] = round(
            100.0 * (divergencia.nosso - divergencia.tse) / divergencia.tse, 5
        )
    return linha


def conferencia_payload(conferencia: ConferenciaTse) -> dict[str, Any]:
    """`DeputadoUfDetail.conferencia` (spec 026 RF-269, design § 2.8).

    `{estado, boletim_dado_ts, totalizacao_final, comparou, divergencias}`. O
    `motivo` do `sem_dado_tse` fica no log: o contrato tem três estados, e a
    tela diz "o TSE ainda não publicou o que conferir" sem precisar do porquê
    interno. `comparou` é o que foi DE FATO comparado — a frase "batem com o
    TSE" só existe com `"algoritmo"` ali. `divergencias` sai normalizado
    (`CHAVES_DE_DIVERGENCIA`), igual ao campo v1 do topo.
    """
    return {
        "estado": conferencia.estado,
        "boletim_dado_ts": conferencia.boletim_dado_ts,
        "totalizacao_final": conferencia.totalizacao_final,
        "comparou": list(conferencia.comparou),
        "divergencias": [normalizar_divergencia(d) for d in conferencia.divergencias],
    }


@dataclass(frozen=True)
class UfProporcional:
    """Uma UF pronta para virar payload.

    `resultado is None` significa "não deu para calcular" — sem
    `lugares_a_preencher` publicado não há quociente eleitoral, e inventar o
    denominador corromperia a UF inteira (RF-124). A UF continua aparecendo,
    com os campos nulos, e é contada em `ufs_aguardando`.
    """

    uf: str
    pct_apurado: float
    entrada: EntradaProporcional
    resultado: ResultadoCadeiras | None
    #: RF-127 — `{cod: (baixo, alto)}` vindo de
    #: `cadeiras_bootstrap.intervalo_de_cadeiras`. `None` (ou `cod` ausente)
    #: quando não há intervalo honesto a publicar para esta UF; o campo é
    #: opcional no contrato (D5/D6) exatamente para isso. Chega pronto: este
    #: módulo não sorteia nada.
    cadeiras_ci95: dict[str, tuple[int, int]] | None = None
    #: RF-269 — a conferência contra o agregado da UF
    #: (`deputado.conferir_agregado_da_uf`). `None` omite a chave
    #: `conferencia` do detalhe (chamador antigo); o ciclo sempre a passa.
    conferencia: ConferenciaTse | None = None
    #: Spec 026 RF-264 — o estado da trava da projeção desta UF
    #: (`deputado_projecao.avaliar_trava`). `None` omite a chave `projecao`
    #: (chamador antigo); o ciclo sempre a passa, e então o objeto é v2.
    projecao_estado: EstadoProjecao | None = None
    #: Spec 026 RF-263 — a projeção, SÓ com `projecao_estado` liberada. Com
    #: qualquer outro estado este campo é ignorado: nenhuma marca, número ou
    #: faixa de projeção sai (RF-264).
    projecao: ProjecaoUf | None = None
    #: RF-127 emendado (ADR-0063 decisão 8) — `{cod: (baixo, alto)}` das
    #: cadeiras PROJETADAS. `None` quando não medida; nunca `[n, n]`.
    cadeiras_projetadas_ci95: dict[str, tuple[int, int]] | None = None


# ---------------------------------------------------------------------------
# Identidade — o payload nunca sai sem rótulo
# ---------------------------------------------------------------------------


def _identidade(entrada: EntradaProporcional, cod: str) -> IdentidadeAgremiacao:
    """Identidade da agremiação, ou um rótulo mínimo derivado do código.

    Envelope sem `nm`/`sg` é degradação de dado, não motivo para a barra sair
    anônima: o número da agremiação é público e identifica a legenda na urna.
    """
    ident = entrada.identidade_agremiacoes.get(cod)
    if ident is not None:
        return ident
    return IdentidadeAgremiacao(
        cod=cod, sigla=cod, nome=cod, tipo="partido", componentes=()
    )


def _identidade_cand(entrada: EntradaProporcional, sqcand: int) -> IdentidadeCandidato:
    return entrada.identidade_candidatos.get(sqcand) or IdentidadeCandidato(
        sqcand=sqcand, nome=str(sqcand), partido="", agremiacao=""
    )


# ---------------------------------------------------------------------------
# Cor da federação — ADR-0024
# ---------------------------------------------------------------------------


def _votos_por_componente(
    entrada: EntradaProporcional, agremiacao: Agremiacao
) -> dict[str, int]:
    """Votos **nominais** somados por partido componente da agremiação.

    Só nominais: o voto de legenda chega agregado na agremiação (`agr[].tvtl`)
    e o rateio dele por partido componente não é reconstruível a partir do que
    o extrator guarda. Misturar um número que existe com um que não existe
    produziria líder diferente conforme o dado do dia — e a cor tem de ser
    estável a noite inteira (ADR-0024).

    Partido isolado devolve `{sigla: votos}` — um componente só, que é ele
    mesmo. Nenhum caso especial precisa existir a jusante.
    """
    votos: dict[str, int] = {}
    for cand in agremiacao.candidatos:
        sigla = _identidade_cand(entrada, cand.cod).partido
        if not sigla:
            continue
        votos[sigla] = votos.get(sigla, 0) + cand.votos_nominais
    return votos


def _sigla_lider(votos_por_componente: dict[str, int], sigla_agremiacao: str) -> str:
    """O partido que dá a cor (ADR-0024): o componente com mais votos nominais.

    **Empate desempata por sigla ascendente** (constituição § 6). Sem critério
    declarado, dois ciclos sobre o mesmo dado poderiam pintar a mesma federação
    de cores diferentes — e o ADR-0024 exige cor estável durante toda a noite,
    o que é uma propriedade do algoritmo, não de sorte na ordem do dicionário.

    Sem componente identificável (envelope degradado, `par[].sg` ausente), cai
    na sigla da própria agremiação: a tela resolve para `--party-outros` como
    resolveria de qualquer forma, mas por um caminho declarado.
    """
    if not votos_por_componente:
        return sigla_agremiacao
    return min(votos_por_componente.items(), key=lambda kv: (-kv[1], kv[0]))[0]


# ---------------------------------------------------------------------------
# RF-127 — a metade que sai agora: marcar a cadeira que ainda pode mudar de dono
# ---------------------------------------------------------------------------


def _cadeiras_de_fase_1(entrada: EntradaProporcional, resultado: ResultadoCadeiras) -> dict[str, int]:
    """Quantas cadeiras de cada agremiação vieram do quociente partidário.

    `eleitos[cod]` sai de `distribuir_cadeiras` **na ordem em que as vagas foram
    ocupadas**: primeiro as da fase 1, depois as de sobras. Então basta saber
    onde a fase 1 termina — e isso é `min(QP, nº de candidatos acima de 10% do
    QE)`, a mesma regra do art. 108 que o algoritmo aplica.

    Recalculado aqui em vez de devolvido por `cadeiras.py` de propósito: o
    algoritmo passou nos 511/513 e não se mexe nele para acrescentar
    instrumentação. A regra é curta e está coberta por teste próprio.
    """
    qe = resultado.quociente_eleitoral
    if qe < 1:
        return {a.cod: 0 for a in entrada.agremiacoes}
    piso_10 = Fraction(qe, 10)
    fase_1: dict[str, int] = {}
    for agremiacao in entrada.agremiacoes:
        elegiveis = sum(1 for c in agremiacao.candidatos if c.votos_nominais >= piso_10)
        fase_1[agremiacao.cod] = min(resultado.quociente_partidario.get(agremiacao.cod, 0), elegiveis)
    return fase_1


def _marcar_indefinidas(
    entrada: EntradaProporcional,
    resultado: ResultadoCadeiras,
    pct_apurado: float,
) -> set[int]:
    """`sqcand` das cadeiras que ainda dependem de sobra indefinida (RF-127).

    A regra, declarada em vez de arbitrada por constante mágica:

        a cadeira marginal de sobras de uma agremiação é **indefinida**
        enquanto a distância entre a média com que ela foi ganha e a melhor
        média de quem ficou de fora for menor que a fatia de votos que a UF
        ainda não apurou.

    Em 100% apurado a fatia é zero e nada é marcado — sobra empatada de verdade
    já sai em `empates_indeterminados`, que é outra coisa. Em 20% apurado, a
    fatia é 80% e quase toda cadeira de sobra é marcada, o que é honesto: a essa
    altura da noite ela realmente não está decidida.

    Só a cadeira **marginal** de cada agremiação entra (a última que ela ganhou
    em sobras). As anteriores foram ganhas com folga maior, por construção do
    algoritmo de médias, e marcá-las diria que a bancada inteira está no ar.

    Toda a aritmética é `Fraction`: a comparação decide uma cadeira, e um erro
    de 1e-15 decidiria junto (constituição § 6).
    """
    if resultado.quociente_eleitoral < 1:
        return set()
    if entrada.totalizacao_final:
        # `tf == "s"`: o TSE fechou a totalização. Não há voto por vir, e
        # marcar uma cadeira como indefinida aqui diria o contrário do que o
        # dado diz — mesmo que `s.psa` ainda não tenha chegado a 100,00.
        return set()

    fracao_faltante = max(Fraction(0), 1 - Fraction(pct_apurado).limit_denominator(10**6) / 100)
    if fracao_faltante <= 0:
        return set()

    votos = {a.cod: a.votos_totais for a in entrada.agremiacoes}
    fase_1 = _cadeiras_de_fase_1(entrada, resultado)

    # Melhor média entre quem ainda tem candidato a quem dar a próxima vaga —
    # é quem tomaria a cadeira se o dado virasse.
    melhor_perdedora = Fraction(0)
    for agremiacao in entrada.agremiacoes:
        cod = agremiacao.cod
        eleitos_cod = {c.cod for c in resultado.eleitos.get(cod, [])}
        if all(c.cod in eleitos_cod for c in agremiacao.candidatos):
            continue  # lista esgotada: não pode receber mais nada
        media = Fraction(votos.get(cod, 0), resultado.vagas_obtidas.get(cod, 0) + 1)
        melhor_perdedora = max(melhor_perdedora, media)

    indefinidas: set[int] = set()
    for cod, eleitos_cod in resultado.eleitos.items():
        if len(eleitos_cod) <= fase_1.get(cod, 0):
            continue  # nenhuma cadeira de sobra
        vagas_obtidas = resultado.vagas_obtidas.get(cod, 0)
        if vagas_obtidas < 1:
            continue
        # Média com que a ÚLTIMA vaga desta agremiação foi ganha: o algoritmo
        # incrementou `vagas_obtidas` logo depois de usá-la como denominador.
        media_vitoriosa = Fraction(votos.get(cod, 0), vagas_obtidas)
        if media_vitoriosa <= 0:
            continue
        margem = (media_vitoriosa - melhor_perdedora) / media_vitoriosa
        if margem <= fracao_faltante:
            indefinidas.add(eleitos_cod[-1].cod)
    return indefinidas


# ---------------------------------------------------------------------------
# Spec 026 — a lista inteira de cada agremiação (contrato v2, design § 2.2–3.5)
# ---------------------------------------------------------------------------


def _ceil_div(num: int, den: int) -> int:
    """`⌈num/den⌉` em inteiros (design 026 § 2.6): `−(−a // b)`."""
    return -(-num // den)


def regras_da_uf(quociente_eleitoral: int, votos_validos: int, lugares: int) -> dict[str, Any]:
    """`DeputadoRegras` (design 026 § 2.6, RF-274) — os pisos em VOTOS.

    `distribuir_cadeiras` compara `votos ≥ Fraction(QE, 10)` (e `QE/5`,
    `4·QE/5`); o menor inteiro que satisfaz `v ≥ QE/10` é exatamente
    `⌈QE/10⌉`. O número publicado é, portanto, o que vale na conta — nunca um
    `round()` de float, que erraria para baixo em metade dos QEs.
    """
    return {
        "quociente_eleitoral": quociente_eleitoral,
        "votos_validos": votos_validos,
        "lugares_a_preencher": lugares,
        "piso_candidato": _ceil_div(quociente_eleitoral, 10),
        "piso_agremiacao_sobras": _ceil_div(4 * quociente_eleitoral, 5),
        "piso_candidato_sobras": _ceil_div(quociente_eleitoral, 5),
    }


@dataclass
class _Linha:
    """Uma candidatura antes de virar `DeputadoUfLinha` (design 026 § 2.2)."""

    sqcand: int
    votos: int
    #: Voto nominal elegível (é `Candidato` no cálculo).
    valido: bool
    #: `destino` publicado (`valido_legenda`/`anulado`/`sub_judice`) ou `None`.
    destino: str | None
    #: Destino interno fora da tabela publicada (`"desconhecido"`): fora do
    #: cálculo, sem `destino` publicado e sem percentual.
    desconhecido: bool
    nascimento: int | None
    rank: int = 0
    parcial: str | None = None
    indefinido: bool = False
    projecao: str | None = None
    projecao_apertada: bool = False
    tse: str | None = None

    @property
    def marcada(self) -> bool:
        """Tem marca de eleito — na parcial, na projeção ou pelo TSE."""
        return self.parcial is not None or self.projecao is not None or self.tse in _TSE_ELEITO


def _ordem_destino(linha: _Linha) -> int:
    if linha.desconhecido:
        return _ORDEM_DESTINO_DESCONHECIDO
    return _ORDEM_DESTINO.get(linha.destino, _ORDEM_DESTINO_DESCONHECIDO)


def _chave_rank(linha: _Linha) -> tuple[int, int, int, int]:
    """`(−votos, destino, art. 110, sqcand)` — design 026 § 3.1.

    Entre as linhas válidas é exatamente a fila de `cadeiras._ordenar_candidatos`
    (`−votos`, mais idoso, código), então os eleitos na parcial são sempre os
    primeiros ranks válidos, na ordem em que ocuparam a vaga. A projeção NUNCA
    entra aqui (constituição § 2; ADR-0063 decisão 5).
    """
    nasc = linha.nascimento if linha.nascimento is not None else _SEM_NASCIMENTO
    return (-linha.votos, _ordem_destino(linha), nasc, linha.sqcand)


def _marcas_de_eleito(
    entrada: EntradaProporcional,
    resultado: ResultadoCadeiras,
    cod: str,
    apertadas: set[int],
) -> dict[int, tuple[str, bool]]:
    """`{sqcand: (via, apertada)}` dos eleitos de uma agremiação numa conta.

    A via é a NOSSA (design 026 § 2.2): as primeiras `min(QP, elegíveis ≥ 10%
    do QE)` vagas, na ordem de ocupação, são `"qp"` (`_cadeiras_de_fase_1`) e
    as demais `"sobra"`. `apertada` só existe em vaga de sobra — é o que
    `_marcar_indefinidas` marca. Nunca comparada ao rótulo `st` do TSE.
    """
    eleitos = resultado.eleitos.get(cod, [])
    fase_1 = _cadeiras_de_fase_1(entrada, resultado).get(cod, 0)
    saida: dict[int, tuple[str, bool]] = {}
    for i, cand in enumerate(eleitos):
        via = "qp" if i < fase_1 else "sobra"
        saida[cand.cod] = (via, via == "sobra" and cand.cod in apertadas)
    return saida


def _linhas_da_agremiacao(
    entrada: EntradaProporcional,
    agremiacao: Agremiacao,
    fora_por_agremiacao: dict[str, list[int]],
) -> list[_Linha]:
    """Todas as candidaturas da agremiação — as do cálculo e as que ficaram fora.

    Válida é quem é `Candidato` na soma (voto `votos_nominais`). As demais vêm
    de `identidade_candidatos` com o voto COMPUTADO de `votos_fora_do_calculo`
    (ADR-0064: aparecem na lista, com o voto, e nunca são eleitas). A
    pertença ao cálculo decide a validade, não a identidade: uma candidatura
    reclassificada no meio da noite aparece como a conta a trata.
    """
    linhas: list[_Linha] = []
    validos: set[int] = set()
    for cand in agremiacao.candidatos:
        validos.add(cand.cod)
        linhas.append(
            _Linha(
                sqcand=cand.cod,
                votos=cand.votos_nominais,
                valido=True,
                destino=None,
                desconhecido=False,
                nascimento=cand.nascimento,
            )
        )
    for sq in fora_por_agremiacao.get(agremiacao.cod, []):
        if sq in validos:
            continue
        ident = entrada.identidade_candidatos.get(sq)
        destino_interno = ident.destino if ident is not None else None
        publicado = _DESTINO_PUBLICADO.get(destino_interno) if destino_interno else None
        linhas.append(
            _Linha(
                sqcand=sq,
                votos=entrada.votos_fora_do_calculo.get(sq, 0),
                valido=False,
                destino=publicado,
                desconhecido=publicado is None,
                nascimento=None,
            )
        )
    linhas.sort(key=_chave_rank)
    for i, linha in enumerate(linhas):
        linha.rank = i + 1
    return linhas


def _fora_por_agremiacao(entrada: EntradaProporcional) -> dict[str, list[int]]:
    """`{cod: [sqcand, ...]}` das candidaturas FORA do cálculo, ordem de `sqcand`."""
    saida: dict[str, list[int]] = {}
    for sq in sorted(entrada.votos_fora_do_calculo):
        ident = entrada.identidade_candidatos.get(sq)
        if ident is None:
            continue
        saida.setdefault(ident.agremiacao, []).append(sq)
    return saida


def _numero(ident: IdentidadeCandidato) -> int | None:
    """`cand.n` → número de urna (exibição). `None` quando ausente ou não numérico."""
    if ident.numero is None:
        return None
    texto = ident.numero.strip()
    return int(texto) if texto.isdigit() else None


def _linha_payload(
    entrada: EntradaProporcional, linha: _Linha, votos_validos_uf: int
) -> dict[str, Any]:
    """`DeputadoUfLinha` (design 026 § 2.2). Opcionais OMITIDOS, nunca `null`
    (exceto `pct_validos`, em que `null` é o dado)."""
    ident = _identidade_cand(entrada, linha.sqcand)
    saida: dict[str, Any] = {
        "sqcand": linha.sqcand,
        "nome": ident.nome,
        "partido": ident.partido,
    }
    numero = _numero(ident)
    if numero is not None:
        saida["numero"] = numero
    saida["votos"] = linha.votos
    saida["rank"] = linha.rank
    sem_pct = linha.desconhecido or linha.destino in _DESTINOS_SEM_PCT
    saida["pct_validos"] = None if sem_pct else _pct(linha.votos, votos_validos_uf)
    if linha.parcial is not None:
        saida["parcial"] = linha.parcial
        if linha.indefinido:
            saida["indefinido"] = True
    if linha.projecao is not None:
        saida["projecao"] = linha.projecao
        if linha.projecao_apertada:
            saida["projecao_apertada"] = True
    if linha.tse is not None:
        saida["tse"] = linha.tse
    if linha.destino is not None:
        saida["destino"] = linha.destino
    return saida


def _corte(linhas: list[_Linha], quociente_eleitoral: int) -> dict[str, Any] | None:
    """Linha de corte NA PARCIAL (design 026 § 3.4, RF-272).

    `ultimo_eleito` = maior rank com `parcial`; `primeiro_fora` = menor rank
    válido sem `parcial`. Como os eleitos são os primeiros ranks válidos,
    `diferenca ≥ 0`. `primeiro_fora_abaixo_piso_10` só aparece verdadeiro:
    `10·votos < QE` — ele só entraria por sobra aberta.
    """
    eleitos = [linha for linha in linhas if linha.parcial is not None]
    fora = next(
        (linha for linha in linhas if linha.valido and linha.parcial is None), None
    )
    if not eleitos or fora is None:
        return None
    ultimo = eleitos[-1]
    corte: dict[str, Any] = {
        "ultimo_eleito": ultimo.sqcand,
        "primeiro_fora": fora.sqcand,
        "diferenca": ultimo.votos - fora.votos,
    }
    if 10 * fora.votos < quociente_eleitoral:
        corte["primeiro_fora_abaixo_piso_10"] = True
    return corte


def _puxadores(linhas: list[_Linha], quociente_eleitoral: int) -> list[dict[str, Any]]:
    """Puxadores da agremiação (design 026 § 3.5, RF-273), por rank.

    Linha válida com `excedente = ⌊votos/QE⌋ − 1 ≥ 1` — votos ≥ 2·QE (spec
    026, open question 1: "puxador" é quem de fato leva voto a mais para a
    legenda; o dono pode trocar para 1·QE). Anulado e sub judice nunca, por
    maior que seja o voto computado: esse voto não conta para ninguém.
    """
    if quociente_eleitoral < 1:
        return []
    saida: list[dict[str, Any]] = []
    for linha in linhas:
        if not linha.valido:
            continue
        quocientes = linha.votos // quociente_eleitoral
        excedente = quocientes - 1
        if excedente >= 1:
            saida.append(
                {"sqcand": linha.sqcand, "quocientes": quocientes, "excedente": excedente}
            )
    return saida


# ---------------------------------------------------------------------------
# D6 — payload por UF (Vercel Blob)
# ---------------------------------------------------------------------------


def _candidato_payload(
    entrada: EntradaProporcional,
    sqcand: int,
    votos: int,
    ordem: int,
    indefinidas: set[int],
    status_tse: dict[int, str] | None = None,
) -> dict[str, Any]:
    ident = _identidade_cand(entrada, sqcand)
    saida: dict[str, Any] = {
        "sqcand": sqcand,
        "nome": ident.nome,
        "partido": ident.partido,
        "votos": votos,
        "ordem": ordem,
    }
    if sqcand in indefinidas:
        saida["indefinido"] = True
    # Spec 026 RF-267 — a situação oficial, só quando o agregado da UF trouxe
    # totalização final. Ausente é "o TSE ainda não proclamou", nunca "não
    # eleito".
    marca_tse = (status_tse or {}).get(sqcand)
    if marca_tse is not None:
        saida["tse"] = marca_tse
    return saida


def _codigos_em_empate(resultado: ResultadoCadeiras) -> list[str]:
    """Códigos de agremiação envolvidos em empate que a norma não resolve (D6).

    Lê `empates_agremiacoes`, que é dado. A versão anterior procurava o código
    **dentro da frase** de `empates_indeterminados` — funcionava, tinha teste, e
    teria quebrado calada no dia em que alguém reescrevesse a mensagem, num
    caso raro demais para alguém notar. A frase segue existindo; ela só não é
    mais fonte de dado.

    Um empate envolve 2+ agremiações e a UF pode ter mais de um — daí o
    achatamento com deduplicação, ordenado para determinismo (constituição § 6).
    """
    return sorted({cod for empate in resultado.empates_agremiacoes for cod in empate})


def construir_detalhe_uf(
    *,
    dados: UfProporcional,
    ts_iso: str,
    cargo: int,
    turno: int,
    divergencias: list[dict[str, Any]],
    relogio: RelogioDoDado | None = None,
    votacao: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """`DeputadoUfDetail` (D6) — o payload que vai para `deputado/uf/<SIGLA>.json`.

    `votacao` (spec 021 RF-192 emendado em 2026-09-26, noite) chega pronto de
    `project.py::build_votacao_uf_payloads` — este módulo transporta e nunca
    deriva. Chave OMITIDA quando `None`: ausência é "não sabemos" e a tela cai
    em `<DetailUnavailable>` (RF-198); um `null` publicado seria um terceiro
    estado que o contrato não tem.

    `relogio` (ADR-0038 D2) é o relógio do dado medido só sobre os pares desta
    UF. `None` — o default — publica `dado_ts`/`pares_atrasados` como `null`,
    que é o estado "hora do dado indisponível neste ciclo"; nunca cai para
    `ts_iso`, que é a hora do cálculo e responde a outra pergunta.

    ## Contrato v2 (spec 026, design § 2.2–2.8) — aditivo

    Com `dados.projecao_estado` presente (o ciclo sempre o passa), o objeto
    sai com `contrato: 2` e, por agremiação, `candidatos` (ranks 1..60 ∪ toda
    candidatura com marca ∪ o primeiro de fora da linha de corte),
    `total_candidatos`, `corte`, `puxadores` e — só com a projeção liberada —
    `cadeiras_projetadas`, `votos_projetados` e a faixa; por UF, `regras`,
    `projecao`, `mais_votados` e `lista`. As posições > 60 sem marca saem em
    `lista_restante` (TRANSPORTE: o writer TS as tira do objeto e grava
    `deputado/uf-lista/<UF>.json`, design § 2.5). `eleitos`, `suplentes`,
    `divergencias` e `indefinido` continuam com a semântica v1 (§ 2.12).
    """
    entrada = dados.entrada
    resultado = dados.resultado
    conferencia = dados.conferencia
    v2 = dados.projecao_estado is not None

    # A totalização da UF é final quando as zonas somadas OU o agregado do TSE
    # dizem que é: `tf == "s"` no agregado é a palavra do TSE sobre a UF
    # inteira, e a marca oficial (RF-267) sai dele. Com ela, nenhuma cadeira é
    # "apertada" (RF-262) — não há voto por vir.
    tf_uf = entrada.totalizacao_final or (
        conferencia is not None and conferencia.totalizacao_final
    )
    entrada_tf = (
        entrada if tf_uf == entrada.totalizacao_final else replace(entrada, totalizacao_final=tf_uf)
    )

    indefinidas = (
        _marcar_indefinidas(entrada_tf, resultado, dados.pct_apurado)
        if resultado is not None
        else set()
    )

    votos_validos_uf = sum(a.votos_totais for a in entrada.agremiacoes)
    # RF-267 — a marca oficial sai do AGREGADO da UF, nunca da soma das zonas
    # (`combinar_entradas` a zera, como zera `qe`/`vag`).
    status_tse = (
        conferencia.entrada.status_tse
        if conferencia is not None and conferencia.entrada is not None
        else None
    )

    # Spec 026 RF-263/264 — a projeção só existe com a trava liberada. Fora
    # disso, NENHUM campo de projeção sai, mesmo que o chamador tenha passado
    # um `ProjecaoUf` (invariante "marcas só com liberada").
    projecao = (
        dados.projecao
        if dados.projecao_estado is not None and dados.projecao_estado.liberada
        else None
    )
    apertadas_projecao = (
        _marcar_indefinidas(
            replace(projecao.entrada, totalizacao_final=tf_uf),
            projecao.resultado,
            dados.pct_apurado,
        )
        if projecao is not None
        else set()
    )
    fora_por_agremiacao = _fora_por_agremiacao(entrada) if v2 else {}
    todas_as_linhas: list[tuple[str, _Linha]] = []
    lista_restante: list[dict[str, Any]] = []

    agremiacoes: list[dict[str, Any]] = []
    for agremiacao in entrada.agremiacoes:
        cod = agremiacao.cod
        ident = _identidade(entrada, cod)
        nominais = sum(c.votos_nominais for c in agremiacao.candidatos)
        validos = agremiacao.votos_totais

        eleitos_cod = resultado.eleitos.get(cod, []) if resultado is not None else []
        suplentes_cod = resultado.suplentes.get(cod, []) if resultado is not None else []

        linha: dict[str, Any] = {
            "cod": cod,
            "sigla": ident.sigla,
            "nome": ident.nome,
            "tipo": ident.tipo,
            "componentes": list(ident.componentes),
            # ADR-0024 — a federação usa a cor do partido-líder. Aqui o
            # líder é medido NESTA UF; no payload nacional, na soma das 27.
            # Os dois podem divergir, e não é inconsistência (ver
            # `_bancada_nacional`).
            "sigla_lider": _sigla_lider(
                _votos_por_componente(entrada, agremiacao), ident.sigla
            ),
            "votos_nominais": nominais,
            "votos_legenda": agremiacao.votos_legenda,
            "votos_validos": validos,
            "pct_votos": _pct(validos, votos_validos_uf),
            "quociente_partidario": (
                resultado.quociente_partidario.get(cod, 0) if resultado is not None else 0
            ),
            "cadeiras": len(eleitos_cod),
            # Sem `cadeiras_indefinidas` aqui de propósito: D6 não o tem, e
            # o contrato manda. A contagem por agremiação que o payload
            # nacional precisa sai de `eleitos[].indefinido` — um campo, uma
            # verdade.
            "eleitos": [
                _candidato_payload(
                    entrada, c.cod, c.votos_nominais, i + 1, indefinidas, status_tse
                )
                for i, c in enumerate(eleitos_cod)
            ],
            "suplentes": [
                _candidato_payload(
                    entrada, c.cod, c.votos_nominais, i + 1, indefinidas, status_tse
                )
                for i, c in enumerate(suplentes_cod[:MAX_SUPLENTES])
            ],
        }
        # RF-127 — a faixa só aparece quando foi medida. Ausente é a forma de
        # dizer "não temos intervalo para esta UF"; `[n, n]` diria o contrário.
        faixa = (dados.cadeiras_ci95 or {}).get(cod)
        if faixa is not None:
            linha["cadeiras_ci95"] = [faixa[0], faixa[1]]

        if v2:
            restante = _agremiacao_v2(
                linha=linha,
                entrada=entrada,
                agremiacao=agremiacao,
                resultado=resultado,
                indefinidas=indefinidas,
                status_tse=status_tse if tf_uf else None,
                projecao=projecao,
                apertadas_projecao=apertadas_projecao,
                cadeiras_projetadas_ci95=dados.cadeiras_projetadas_ci95,
                fora_por_agremiacao=fora_por_agremiacao,
                votos_validos_uf=votos_validos_uf,
                todas_as_linhas=todas_as_linhas,
            )
            if restante:
                lista_restante.append({"cod": cod, "candidatos": restante})
        agremiacoes.append(linha)

    # Determinismo (constituição § 6): cadeiras desc, votos desc, sigla asc e,
    # por último, o código — dois partidos com a mesma sigla não existem, mas a
    # ordenação não pode depender disso.
    agremiacoes.sort(key=lambda a: (-a["cadeiras"], -a["votos_validos"], a["sigla"], a["cod"]))
    # `lista_restante` na ORDEM das agremiações do objeto (design § 2.5).
    ordem_agr = {a["cod"]: i for i, a in enumerate(agremiacoes)}
    lista_restante.sort(key=lambda bloco: ordem_agr[bloco["cod"]])

    # `quociente_eleitoral_tse` (v1): o `carg.qe` do agregado quando a conta
    # dele foi conferida (design § 2.8). No modo por zona a soma não tem `qe`
    # (`combinar_entradas` o zera) — era sempre `null`, e a Conferência dizia
    # "batem" do mesmo jeito. Sem conferência (chamador antigo), o de antes.
    quociente_tse = entrada.quociente_eleitoral_tse
    if conferencia is not None:
        quociente_tse = (
            conferencia.entrada.quociente_eleitoral_tse
            if conferencia.entrada is not None and "algoritmo" in conferencia.comparou
            else None
        )

    detalhe: dict[str, Any] = {
        # `ts` = hora do cálculo; `dado_ts` = hora do boletim mais recente
        # desta UF (ADR-0038 D1). Os dois convivem: quando a ingestão para, o
        # primeiro anda e o segundo congela.
        "ts": ts_iso,
        "dado_ts": relogio.dado_ts if relogio is not None else None,
        "pares_atrasados": relogio.pares_atrasados if relogio is not None else None,
        "cargo": cargo,
        "turno": turno,
        **({"contrato": CONTRATO_V2} if v2 else {}),
        "uf": dados.uf,
        "pct_apurado": round(float(dados.pct_apurado), 5),
        "lugares_a_preencher": entrada.lugares_a_preencher,
        "quociente_eleitoral": resultado.quociente_eleitoral if resultado is not None else None,
        "quociente_eleitoral_tse": quociente_tse,
        "totalizacao_final": tf_uf,
        "divergencias": divergencias,
        "agremiacoes": agremiacoes,
        "vagas_nao_preenchidas": (
            resultado.vagas_nao_preenchidas if resultado is not None else 0
        ),
        "empates_indeterminados": (
            _codigos_em_empate(resultado) if resultado is not None else []
        ),
    }
    if votacao is not None:
        detalhe["votacao"] = votacao
    if v2 and resultado is not None and entrada.lugares_a_preencher is not None:
        detalhe["regras"] = regras_da_uf(
            resultado.quociente_eleitoral,
            sum(a["votos_validos"] for a in agremiacoes),
            entrada.lugares_a_preencher,
        )
    if dados.projecao_estado is not None:
        detalhe["projecao"] = dados.projecao_estado.payload()
    # Spec 026 RF-269 — aditivo. `divergencias` (acima) continua existindo
    # para o leitor v1; o ciclo passa a enchê-lo com as MESMAS divergências
    # desta conferência (`project.py::_do_project_proporcional`).
    if conferencia is not None:
        detalhe["conferencia"] = conferencia_payload(conferencia)
    if v2:
        detalhe["mais_votados"] = _mais_votados_da_uf(todas_as_linhas)
        restantes = sum(len(bloco["candidatos"]) for bloco in lista_restante)
        if restantes > 0:
            detalhe["lista"] = {"restantes": restantes}
            # TRANSPORTE (design § 2.1/2.5): sai do objeto no writer TS.
            detalhe["lista_restante"] = lista_restante
    return detalhe


def _agremiacao_v2(
    *,
    linha: dict[str, Any],
    entrada: EntradaProporcional,
    agremiacao: Agremiacao,
    resultado: ResultadoCadeiras | None,
    indefinidas: set[int],
    status_tse: dict[int, str] | None,
    projecao: ProjecaoUf | None,
    apertadas_projecao: set[int],
    cadeiras_projetadas_ci95: dict[str, tuple[int, int]] | None,
    fora_por_agremiacao: dict[str, list[int]],
    votos_validos_uf: int,
    todas_as_linhas: list[tuple[str, _Linha]],
) -> list[dict[str, Any]]:
    """Os campos v2 de UMA agremiação, escritos em `linha`; devolve as linhas > 60.

    As linhas vão para `todas_as_linhas` (para os mais votados da UF e do
    país) já com as marcas.
    """
    cod = agremiacao.cod
    linhas = _linhas_da_agremiacao(entrada, agremiacao, fora_por_agremiacao)

    parcial = (
        _marcas_de_eleito(entrada, resultado, cod, indefinidas) if resultado is not None else {}
    )
    proj = (
        _marcas_de_eleito(projecao.entrada, projecao.resultado, cod, apertadas_projecao)
        if projecao is not None
        else {}
    )
    for item in linhas:
        if item.sqcand in parcial:
            item.parcial, item.indefinido = parcial[item.sqcand]
        if item.sqcand in proj:
            item.projecao, item.projecao_apertada = proj[item.sqcand]
        if status_tse is not None:
            item.tse = status_tse.get(item.sqcand)
        todas_as_linhas.append((cod, item))

    qe = resultado.quociente_eleitoral if resultado is not None else 0
    corte = _corte(linhas, qe) if resultado is not None else None
    primeiro_fora = corte["primeiro_fora"] if corte is not None else None

    no_blob = [
        item
        for item in linhas
        if item.rank <= POSICOES_NO_BLOB or item.marcada or item.sqcand == primeiro_fora
    ]
    restante = [
        item
        for item in linhas
        if not (item.rank <= POSICOES_NO_BLOB or item.marcada or item.sqcand == primeiro_fora)
    ]

    linha["candidatos"] = [_linha_payload(entrada, item, votos_validos_uf) for item in no_blob]
    linha["total_candidatos"] = len(linhas)
    if projecao is not None:
        linha["cadeiras_projetadas"] = len(projecao.resultado.eleitos.get(cod, []))
        faixa = (cadeiras_projetadas_ci95 or {}).get(cod)
        if faixa is not None:
            linha["cadeiras_projetadas_ci95"] = [faixa[0], faixa[1]]
        agr_proj = next(a for a in projecao.entrada.agremiacoes if a.cod == cod)
        linha["votos_projetados"] = agr_proj.votos_totais
    if corte is not None:
        linha["corte"] = corte
    puxadores = _puxadores(linhas, qe)
    if puxadores:
        linha["puxadores"] = puxadores
    return [_linha_payload(entrada, item, votos_validos_uf) for item in restante]


def _mais_votados_da_uf(todas_as_linhas: list[tuple[str, _Linha]]) -> list[dict[str, Any]]:
    """Top 10 da UF por voto apurado, como REFERÊNCIA (design 026 § 2.4, § 3.2).

    Todas as linhas (objeto ∪ lista 61+), `(−votos, sqcand)`. Inclui anulado
    e sub judice (spec 026, open question 2): esconder o mais votado do estado
    porque o registro está em juízo seria esconder o fato. Resolve sempre no
    objeto da UF — quem está entre os 10 mais votados do estado tem rank ≤ 10
    na própria agremiação.
    """
    ordenadas = sorted(todas_as_linhas, key=lambda par: (-par[1].votos, par[1].sqcand))
    return [
        {"cod": cod, "sqcand": item.sqcand} for cod, item in ordenadas[:MAX_MAIS_VOTADOS]
    ]


# ---------------------------------------------------------------------------
# D5 — payload nacional (Global Config)
# ---------------------------------------------------------------------------


def _linha_uf(detalhe: dict[str, Any], dados: UfProporcional) -> dict[str, Any]:
    """`EdgeDeputadoUfRow` (D5) — o resumo da UF que cabe no payload nacional."""
    agremiacoes = detalhe["agremiacoes"]
    lider = None
    if dados.resultado is not None and agremiacoes and agremiacoes[0]["cadeiras"] > 0:
        # `agremiacoes` já está ordenado por cadeiras desc com desempate
        # declarado — o líder é o primeiro, sem nova ordenação.
        topo = agremiacoes[0]
        lider = {"cod": topo["cod"], "sigla": topo["sigla"], "cadeiras": topo["cadeiras"]}

    linha: dict[str, Any] = {
        "sigla": dados.uf,
        "pct_apurado": detalhe["pct_apurado"],
        "lugares_a_preencher": detalhe["lugares_a_preencher"],
        "quociente_eleitoral": detalhe["quociente_eleitoral"],
        "cadeiras_definidas": sum(a["cadeiras"] for a in agremiacoes),
        "vagas_nao_preenchidas": detalhe["vagas_nao_preenchidas"],
        "empates_indeterminados": len(detalhe["empates_indeterminados"]),
        "lider": lider,
    }
    # Spec 026 design § 2.7 — o MESMO objeto do Blob da UF, byte a byte: a
    # capa mostra o selo sem ler Blob (RF-271).
    if "projecao" in detalhe:
        linha["projecao"] = detalhe["projecao"]
    return linha


def _linhas_do_detalhe(detalhe: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """`(agremiação, linha)` de TODAS as candidaturas de um objeto de UF v2 —
    as do objeto e as de `lista_restante`."""
    por_cod = {a["cod"]: a for a in detalhe["agremiacoes"]}
    saida = [(a, c) for a in detalhe["agremiacoes"] for c in a.get("candidatos", [])]
    for bloco in detalhe.get("lista_restante", []):
        agr = por_cod[bloco["cod"]]
        saida.extend((agr, c) for c in bloco["candidatos"])
    return saida


def _destaque(uf: str, agr: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    """`EdgeDeputadoDestaque` (design 026 § 2.9) — autossuficiente: a capa
    escreve a linha sem ler Blob nenhum. `pct_validos` é o da UF DO
    CANDIDATO, o único denominador com sentido."""
    saida: dict[str, Any] = {
        "uf": uf,
        "sqcand": c["sqcand"],
        "nome": c["nome"],
        "partido": c["partido"],
        "cod": agr["cod"],
        "sigla": agr["sigla"],
    }
    if "numero" in c:
        saida["numero"] = c["numero"]
    saida["votos"] = c["votos"]
    saida["pct_validos"] = c["pct_validos"]
    if "destino" in c:
        saida["destino"] = c["destino"]
    return saida


def _destaques_nacionais(
    detalhes_ordenados: list[tuple[UfProporcional, dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
    """`(mais_votados, puxadores)` do país (RF-271, RF-273), ou `None` sem v2.

    Mais votados: todas as linhas das UFs, `(−votos, uf, sqcand)`, 10
    primeiras (design § 3.3). Puxadores: a união dos puxadores das UFs,
    `(−excedente, −votos, uf, sqcand)`, até 30 (design § 3.5).
    """
    todas: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    puxadores: list[dict[str, Any]] = []
    algum_v2 = False
    for dados, detalhe in detalhes_ordenados:
        if detalhe.get("contrato") != CONTRATO_V2:
            continue
        algum_v2 = True
        linhas = _linhas_do_detalhe(detalhe)
        por_sq = {c["sqcand"]: (agr, c) for agr, c in linhas}
        todas.extend((dados.uf, agr, c) for agr, c in linhas)
        qe = detalhe["quociente_eleitoral"]
        for agr in detalhe["agremiacoes"]:
            for p in agr.get("puxadores", []):
                agr_c, c = por_sq[p["sqcand"]]
                puxadores.append(
                    {
                        **_destaque(dados.uf, agr_c, c),
                        "quociente_eleitoral": qe,
                        "quocientes": p["quocientes"],
                        "excedente": p["excedente"],
                    }
                )
    if not algum_v2:
        return None
    todas.sort(key=lambda t: (-t[2]["votos"], t[0], t[2]["sqcand"]))
    mais_votados = [_destaque(uf, agr, c) for uf, agr, c in todas[:MAX_MAIS_VOTADOS]]
    puxadores.sort(key=lambda p: (-p["excedente"], -p["votos"], p["uf"], p["sqcand"]))
    return mais_votados, puxadores[:MAX_PUXADORES_NACIONAL]


def conferir_total_de_cadeiras(
    *, ufs: list[UfProporcional], cargo: int, ufs_conhecidas: int
) -> Divergencia | None:
    """RF-124 — a soma das vagas publicadas bate com o tamanho da casa?

    `total_cadeiras` do payload **não** é mais esta soma (ver
    `_bancada_nacional`): é fato fixo, 513 para a Câmara. Mas a soma continua
    sendo medida, porque ela é a única leitura independente que temos do
    denominador de cada UF — e o critério de aceitação do RF-124 é literalmente
    "quando o valor de uma UF diverge do que o TSE publica, o ciclo registra
    erro e aciona alerta". Errar o `carg[].nv` de uma UF corrompe o quociente
    eleitoral dela inteiro; a soma nacional é o sino que toca quando isso
    acontece.

    **Só conclusiva com as 27 UFs publicadas.** Com menos, a divergência é
    esperada — é o começo da noite, não um defeito —, e alarmar ali seria o
    alarme que ninguém olha às 21h porque tocou 26 vezes às 18h. `None`
    significa "nada a reportar", e é o retorno em três situações distintas:
    cargo sem tamanho de casa declarado, UFs de menos, ou soma que fecha.

    Devolve `Divergencia` — o mesmo tipo de `deputado.conferir_contra_tse` — e
    **não** loga nem alerta: este módulo é puro (constituição § 9). Quem chama
    (`api/model/project.py`, ramo proporcional) é que faz o `_log("error")` e o
    `_alert_slack`, exatamente como já faz com a divergência de quociente.
    """
    esperado = cadeiras_em_disputa(cargo)
    if esperado is None:
        return None

    publicadas = [
        int(d.entrada.lugares_a_preencher)
        for d in ufs
        if d.entrada.lugares_a_preencher is not None
    ]
    if len(publicadas) < ufs_conhecidas:
        return None

    soma = sum(publicadas)
    if soma == esperado:
        return None

    return Divergencia(
        o_que="total_cadeiras",
        nosso=esperado,
        tse=soma,
        detalhe=(
            f"as {len(publicadas)} UFs publicaram `carg[].nv` e a soma deu "
            f"{soma}, não {esperado} — o denominador do quociente eleitoral de "
            "pelo menos uma UF está errado"
        ),
    )


def _bancada_nacional(
    detalhes_ordenados: list[tuple[UfProporcional, dict[str, Any]]],
    ufs_conhecidas: int,
    cadeiras_ci95_nacional: dict[str, tuple[int, int]] | None = None,
    *,
    cargo: int,
) -> dict[str, Any]:
    """`EdgeBancadaNacional` (D5) — soma de 27 corridas, não um modelo nacional.

    As agremiações são reconciliadas por `cod` (`agr[].n`), que é estável no país
    inteiro: o PT é 13 em toda UF. A identidade (sigla, nome, composição) vem da
    primeira UF em ordem alfabética que a publicou — se uma UF vier sem rótulo, a
    seguinte completa, mas nenhuma sobrescreve a anterior.

    **`sigla_lider` nacional é a soma das 27 UFs**, não a moda dos líderes
    estaduais (ADR-0024). Contar "em quantos estados cada componente lidera"
    daria peso igual a Roraima e a São Paulo, e mudaria de resposta conforme a
    ordem em que as UFs apuram — a cor trocaria no meio da noite, que é
    exatamente o que o ADR proíbe.

    Como consequência, **o líder nacional pode ser diferente do líder de uma UF
    específica**, e isso não é inconsistência: são duas perguntas diferentes
    ("quem puxa a federação no Brasil" e "quem puxa a federação neste estado"),
    respondidas pelo mesmo critério sobre recortes diferentes.
    """
    cadeiras: dict[str, int] = {}
    indefinidas: dict[str, int] = {}
    nominais: dict[str, int] = {}
    legenda: dict[str, int] = {}
    validos: dict[str, int] = {}
    identidade: dict[str, dict[str, Any]] = {}
    componentes_br: dict[str, dict[str, int]] = {}
    ordem: list[str] = []

    soma_publicada = 0
    cadeiras_atribuidas = 0
    ufs_calculadas = 0

    for dados, detalhe in detalhes_ordenados:
        if detalhe["lugares_a_preencher"] is not None:
            soma_publicada += int(detalhe["lugares_a_preencher"])
        if dados.resultado is not None:
            ufs_calculadas += 1
        # Votos nominais por componente, SOMADOS país afora — o insumo do
        # líder nacional. Lido da entrada da UF, não do detalhe: o payload de
        # UF publica o líder já resolvido, e reconstruir o Brasil a partir de
        # 27 respostas prontas é justamente a moda que o docstring recusa.
        votos_componente_da_uf = {
            agremiacao.cod: _votos_por_componente(dados.entrada, agremiacao)
            for agremiacao in dados.entrada.agremiacoes
        }
        for cod_agr, por_sigla in votos_componente_da_uf.items():
            acumulado = componentes_br.setdefault(cod_agr, {})
            for sigla_componente, votos_componente in por_sigla.items():
                acumulado[sigla_componente] = (
                    acumulado.get(sigla_componente, 0) + votos_componente
                )
        for agremiacao in detalhe["agremiacoes"]:
            cod = agremiacao["cod"]
            if cod not in cadeiras:
                cadeiras[cod] = 0
                indefinidas[cod] = 0
                nominais[cod] = 0
                legenda[cod] = 0
                validos[cod] = 0
                ordem.append(cod)
            # Soma, nunca sobrescrita: uma agremiação aparece em até 27 linhas,
            # e `dict[cod] = valor` aqui seria a bancada do último estado lido.
            cadeiras[cod] += agremiacao["cadeiras"]
            cadeiras_atribuidas += agremiacao["cadeiras"]
            indefinidas[cod] += sum(1 for e in agremiacao["eleitos"] if e.get("indefinido"))
            nominais[cod] += agremiacao["votos_nominais"]
            legenda[cod] += agremiacao["votos_legenda"]
            validos[cod] += agremiacao["votos_validos"]

            atual = identidade.get(cod)
            if atual is None:
                identidade[cod] = {
                    "sigla": agremiacao["sigla"],
                    "nome": agremiacao["nome"],
                    "tipo": agremiacao["tipo"],
                    "componentes": list(agremiacao["componentes"]),
                }
            elif not atual["componentes"] and agremiacao["componentes"]:
                atual["componentes"] = list(agremiacao["componentes"])

    validos_br = sum(validos.values())
    por_agremiacao = [
        {
            "cod": cod,
            "sigla": identidade[cod]["sigla"],
            "nome": identidade[cod]["nome"],
            "tipo": identidade[cod]["tipo"],
            "componentes": identidade[cod]["componentes"],
            # ADR-0024 — soma das 27 UFs; ver o docstring desta função.
            "sigla_lider": _sigla_lider(
                componentes_br.get(cod, {}), identidade[cod]["sigla"]
            ),
            "cadeiras": cadeiras[cod],
            "cadeiras_indefinidas": indefinidas[cod],
            "votos_nominais": nominais[cod],
            "votos_legenda": legenda[cod],
            "votos_validos": validos[cod],
            "pct_votos": _pct(validos[cod], validos_br),
        }
        for cod in ordem
    ]
    # RF-127 — a faixa da bancada. Vem pronta de
    # `cadeiras_bootstrap.intervalo_nacional`, que soma RÉPLICAS das UFs e só
    # então tira o percentil: somar as faixas das 27 UFs daria uma faixa larga
    # e errada (a soma dos percentis não é o percentil da soma). Agremiação sem
    # entrada ali sai sem `cadeiras_ci95`, e não com `[n, n]`.
    for linha_agr in por_agremiacao:
        faixa = (cadeiras_ci95_nacional or {}).get(linha_agr["cod"])
        if faixa is not None:
            linha_agr["cadeiras_ci95"] = [faixa[0], faixa[1]]
    # D5: cadeiras desc, depois sigla asc. `cod` fecha o desempate para que a
    # ordem não dependa da ordem de leitura das UFs.
    por_agremiacao.sort(key=lambda a: (-a["cadeiras"], a["sigla"], a["cod"]))

    # O tamanho da casa é FATO FIXO, não a soma das UFs que já publicaram
    # (2026-09-19). Somar produzia um número que **cresce durante a noite**: às
    # 18h, com três estados pequenos no ar, a soma dava 26 e a tela escrevia
    # "26 cadeiras em disputa" — falso, e em destaque máximo desde que o
    # hemiciclo (ADR-0049) passou a usar o mesmo número como denominador, o que
    # ainda por cima mudava a forma do plenário abaixo de 24 cadeiras
    # (`lib/utils/hemiciclo.ts::arcosPara`).
    #
    # É o mesmo argumento que `cargos.VAGAS_EM_DISPUTA_2026` já fazia para o
    # Senado desde a spec 016 ("às 18h, com 4 estados apurados, a derivação
    # diria '8 vagas em disputa'"); o cargo 6 só estava fora dos dois
    # dicionários.
    #
    # **Isto não afrouxa o RF-124**, que rege o `lugares_a_preencher` de **uma
    # UF** — ele continua vindo do TSE, sem constante embutida, e é ele que
    # divide os votos no quociente eleitoral. O que passa a ser fato fixo é o
    # total nacional, que o RF nunca regeu, e a soma vira **conferência**:
    # `conferir_total_de_cadeiras` acima.
    #
    # Cargo fora de `TOTAL_CADEIRAS` cai na soma, que é o único número
    # disponível. Não é um default silencioso: `construir_payload_deputado` só
    # é chamada para o cargo 6, e um cargo proporcional novo sem fato declarado
    # deve entrar no dicionário antes de chegar aqui.
    fato = cadeiras_da_casa(cargo)
    total = fato if fato is not None else soma_publicada

    return {
        "total_cadeiras": total,
        "cadeiras_atribuidas": cadeiras_atribuidas,
        "ufs_calculadas": ufs_calculadas,
        "ufs_aguardando": max(0, ufs_conhecidas - ufs_calculadas),
        "por_agremiacao": por_agremiacao,
    }


def construir_payload_deputado(
    *,
    ufs: list[UfProporcional],
    divergencias_por_uf: dict[str, list[dict[str, Any]]],
    ts_iso: str,
    cargo: int,
    turno: int,
    atualizacao_min: int,
    ufs_conhecidas: int,
    pct_apurado_total: float,
    cadeiras_ci95_nacional: dict[str, tuple[int, int]] | None = None,
    dado_ts: str | None = None,
    pares_atrasados: int | None = None,
    relogio_by_uf: dict[str, RelogioDoDado] | None = None,
    votacao: dict[str, Any] | None = None,
    votacao_by_uf: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Monta `EdgePayloadDeputado` (D5) e o mapa `sigla → DeputadoUfDetail` (D6).

    Devolve os dois juntos porque o nacional é **derivado** dos detalhes de UF:
    a bancada é a soma das 27 corridas (D3), e recalculá-la de outra fonte
    abriria espaço para os dois números divergirem na mesma tela.

    `ufs_conhecidas` é quantas UFs a eleição tem (27), vinda de quem chamou —
    não é contada a partir das UFs presentes, senão `ufs_aguardando` seria
    sempre zero e o leitor concluiria que a bancada já fechou.

    `cadeiras_ci95_nacional` (RF-127) é a faixa da bancada, já agregada por
    `cadeiras_bootstrap.intervalo_nacional`. `None` — o default — publica o
    payload sem faixa nenhuma, que é o estado correto enquanto não houver duas
    zonas apuradas em nenhuma UF.

    `dado_ts`/`pares_atrasados`/`relogio_by_uf` (ADR-0038 D1/D2) são o relógio
    do DADO — a hora que o TSE carimbou, não a que o modelo rodou. Chegam
    prontos de `_relogio_do_ciclo` (`project.py`); este módulo transporta e
    nunca deriva: derivar aqui daria uma segunda resposta para a mesma pergunta
    na mesma tela. Todos `None` por default — o payload sai com os dois campos
    explicitamente nulos, que é "hora do dado indisponível", nunca a ausência
    da chave.

    `votacao` (spec 021, RF-199/RF-195) chega pronto de
    `project.py::build_votacao_payload` — este módulo transporta e nunca
    deriva, pela mesma razão do relógio acima. ⚠️ Diferente de `dado_ts`, a
    chave é **OMITIDA** quando `None`, não publicada nula: ausência é "não
    sabemos" e faz a tela cair em `<DetailUnavailable>` (RF-198), enquanto um
    `null` publicado seria um terceiro estado que o contrato não tem.

    `votacao_by_uf` (spec 021 RF-192 emendado, 26/09 noite) é o `votacao` de
    cada UF, pronto de `project.py::build_votacao_uf_payloads`; vai para o
    detalhe da UF (Blob), onde a tela `/uf/[sigla]/deputado-federal` o lê. UF
    sem entrada ⇒ chave omitida no detalhe dela.

    ⚠️ Nível `"br"` não existe no cargo 6 (`temArquivoBr` só é `true` no
    cargo 1): o nacional aqui é a soma dos 27 agregados de UF — soma de
    contagens inteiras, exata, sem projeção envolvida.
    """
    ordenadas = sorted(ufs, key=lambda d: d.uf)
    detalhes: dict[str, dict[str, Any]] = {}
    pares: list[tuple[UfProporcional, dict[str, Any]]] = []
    for dados in ordenadas:
        detalhe = construir_detalhe_uf(
            dados=dados,
            ts_iso=ts_iso,
            cargo=cargo,
            turno=turno,
            divergencias=divergencias_por_uf.get(dados.uf, []),
            relogio=(relogio_by_uf or {}).get(dados.uf),
            votacao=(votacao_by_uf or {}).get(dados.uf),
        )
        detalhes[dados.uf] = detalhe
        pares.append((dados, detalhe))

    bancada = _bancada_nacional(
        pares, ufs_conhecidas, cadeiras_ci95_nacional, cargo=cargo
    )
    destaques = _destaques_nacionais(pares)

    payload = {
        # Os dois relógios, lado a lado (ADR-0038 D1): `ts` é quando o modelo
        # rodou — inalterado — e `dado_ts` é quando o TSE gerou o boletim mais
        # recente do ciclo. `atualizacao_min` abaixo diz de quanto em quanto
        # tempo o segundo DEVERIA avançar.
        "ts": ts_iso,
        "dado_ts": dado_ts,
        "pares_atrasados": pares_atrasados,
        "cargo": cargo,
        "turno": turno,
        "pct_apurado_total": round(float(pct_apurado_total), 5),
        "ufs_apuradas": sum(1 for d in ordenadas if d.pct_apurado > 0),
        # RF-128 — a cadência é declarada pelo produtor do dado. A tela não a
        # deriva de `ts` (lição de 11/09: número escrito à mão no JSX vira
        # mentira em silêncio quando a cadência muda).
        "atualizacao_min": atualizacao_min,
        "bancada": bancada,
        # Spec 021 (RF-199/RF-195) — chave OMITIDA quando ausente; ver docstring.
        **({"votacao": votacao} if votacao is not None else {}),
        # Spec 026 RF-271/RF-273 — do próprio ciclo, nunca do Blob.
        **(
            {"mais_votados": destaques[0], "puxadores": destaques[1]}
            if destaques is not None
            else {}
        ),
        "por_uf": [_linha_uf(detalhe, dados) for dados, detalhe in pares],
        # ADR-0005 — insights são template determinístico, nunca LLM. Vazio até
        # os templates da corrida proporcional existirem; lista vazia é a
        # ausência honesta, e a tela já sabe lidar com ela.
        "insights": [],
        # `composition` descreve a BANCADA deste payload, que é a parcial: a
        # aritmética do ADR-0027 sobre o voto já apurado — `actual_results: 1`
        # é o que ela é. A projeção de Deputado (ADR-0063, que superou o § D9
        # do design 017) existe, mas é outro número: por UF, no Blob e em
        # `por_uf[].projecao`, nunca somada numa bancada nacional. Design 026,
        # D10 revisto: o valor ficou, o porquê mudou — e o ADR-0063 D1 proíbe
        # declarar `model: 0` sobre número que o modelo produziu; aqui não há
        # nenhum.
        "composition": {"pre_election": 0.0, "model": 0.0, "actual_results": 1.0},
    }
    return payload, detalhes
