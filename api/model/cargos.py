"""api/model/cargos.py

Espelho Python da tabela canônica de cargos — `lib/config/cargos.ts`.

## Por que existe um espelho, e não um import

O orchestrator roda em Python (runtime Vercel `python3.14`, ver
`api/model/project.py`) e o catálogo de cargos é TypeScript. Não há
mecanismo de import entre os dois: o processo Python não carrega módulo TS,
e serializar a tabela em build time acrescentaria um passo de geração ao
`pnpm build` que nada mais no repositório usa.

O que este módulo NÃO é: uma segunda fonte de verdade. `lib/config/cargos.ts`
continua sendo a única — ele nasceu justamente para acabar com as quatro
cópias desalinhadas do mesmo conhecimento (ver o cabeçalho de lá). O que
protege a sincronia é um teste, não a boa vontade:
`tests/unit/model/test_cargos_sync.py` lê o `.ts` e falha se qualquer campo
aqui divergir do de lá. Um cargo novo, ou uma mudança de `vagas_por_uf`,
quebra o teste antes de chegar ao ar.

## O que o modelo lê daqui

Dois campos, e só:

  - `vagas_por_uf` — quantos eleitos a UF entrega. É o `vagas` de
    `p_vitoria.p_eleito` (RF-103): 1 para Presidente/Governador, **2** para
    Senador em 2026 (renovação de 2/3 → 54 vagas), `None` para Deputado
    Federal, que é proporcional e tem bancada variável por UF.
  - `granularidade` — `"zona"` ou `"uf"` (ADR-0026 item 1). Vai para
    `metodo.granularidade` no payload (RF-102): é a diferença que a tela de
    Senador precisa declarar ao leitor, porque a projeção dele NÃO é zona a
    zona como a de Presidente e Governador.

Constituição § 9: nenhum I/O, tabela estática e funções puras — igual ao
módulo TS que este espelha.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Granularidade = Literal["uf", "zona"]


class CargoInfo(TypedDict):
    """Subconjunto de `CargoInfo` (TS) que o modelo consome.

    `token`, `slug` e `label` entram porque o teste de sincronia os confere —
    é barato manter a linha inteira alinhada e caro descobrir depois que só
    metade estava.
    """

    cd: int
    token: str
    slug: str
    label: str
    vagas_por_uf: int | None
    tem_segundo_turno: bool
    tem_arquivo_br: bool
    proporcional: bool
    granularidade: Granularidade


CARGOS: tuple[CargoInfo, ...] = (
    {
        "cd": 1,
        "token": "pres",
        "slug": "presidente",
        "label": "Presidente",
        "vagas_por_uf": 1,
        "tem_segundo_turno": True,
        "tem_arquivo_br": True,
        "proporcional": False,
        "granularidade": "zona",
    },
    {
        "cd": 3,
        "token": "gov",
        "slug": "governador",
        "label": "Governador",
        "vagas_por_uf": 1,
        "tem_segundo_turno": True,
        "tem_arquivo_br": False,
        "proporcional": False,
        "granularidade": "zona",
    },
    {
        "cd": 5,
        "token": "sen",
        "slug": "senador",
        "label": "Senador",
        "vagas_por_uf": 2,
        "tem_segundo_turno": False,
        "tem_arquivo_br": False,
        "proporcional": False,
        "granularidade": "zona",
    },
    {
        "cd": 6,
        "token": "dep",
        "slug": "deputado-federal",
        "label": "Deputado Federal",
        "vagas_por_uf": None,
        "tem_segundo_turno": False,
        "tem_arquivo_br": False,
        "proporcional": True,
        "granularidade": "zona",
    },
)

_POR_CD: dict[int, CargoInfo] = {c["cd"]: c for c in CARGOS}


# ---------------------------------------------------------------------------
# Fatos da eleição de 2026 — não são configuração, e não se derivam do ciclo
# ---------------------------------------------------------------------------

#: Cadeiras da casa legislativa inteira, por cargo. O Senado tem 81 (3 por UF
#: × 27); em 2026 renova 2/3 delas. A Câmara tem **513**, e em 2026 as 513
#: estão em disputa (ver `VAGAS_EM_DISPUTA_2026`). Presidente e Governador não
#: têm "casa" — ficam fora do dicionário.
#:
#: **513, e não 531 — desfecho conhecido desde julho/2025.** O PLP 177/2023
#: elevaria a Câmara a 531 pela redistribuição do Censo 2022; foi aprovado pela
#: Câmara e pelo Senado em junho/2025, **vetado integralmente pela Presidência
#: da República em julho/2025**, e o **STF decidiu manter a distribuição atual
#: de 513** para este pleito, que é regido pela Resolução TSE 23.751/2026
#: (`docs/reference/regulatory.md`). Até 2026-09-19 vários documentos deste
#: repositório ainda descreviam o desfecho como "não confirmado" e derivavam
#: o total do runtime por causa disso; a premissa morreu, a decisão de ler o
#: número **por UF** do TSE não (RF-124 — ver `VAGAS_EM_DISPUTA_2026`).
TOTAL_CADEIRAS: dict[int, int] = {5: 81, 6: 513}

#: Cadeiras que a eleição de 2026 renova, por cargo. **54** para o Senado —
#: 2 por UF × 27 — e **513** para a Câmara, que renova **integralmente**. Essa
#: é a diferença entre as duas casas, e é por isso que o cargo 6 repete aqui o
#: número de `TOTAL_CADEIRAS` e o cargo 5 não: o Senado renova 2/3 de 81, a
#: Câmara renova 513 de 513.
#:
#: É o denominador que a tela nacional de Senador exibe (RF-107), e ele não
#: pode ser derivado das UFs que já apuraram: às 18h, com 4 estados apurados, a
#: derivação diria "8 vagas em disputa", o que é falso. O número é fixo desde
#: antes da urna abrir.
#:
#: O mesmo argumento vale, palavra por palavra, para a Câmara — e lá ele não é
#: hipotético: até 2026-09-19 `deputado_payload._bancada_nacional` somava
#: `lugares_a_preencher` só das UFs presentes, e com três estados pequenos
#: apurados a tela escrevia "26 cadeiras em disputa". RF-124 continua regendo o
#: número **por UF**, que segue saindo do dado publicado pelo TSE; o total
#: nacional é fato fixo, **conferido** contra a soma quando as 27 UFs tiverem
#: publicado o seu `carg[].nv` (`deputado_payload.conferir_total_de_cadeiras`).
VAGAS_EM_DISPUTA_2026: dict[int, int] = {5: 54, 6: 513}


# ---------------------------------------------------------------------------
# Cadência de ingestão por cargo — base do limiar de "dado parado" (ADR-0038 D3)
# ---------------------------------------------------------------------------

#: Cadência declarada da corrida proporcional, em minutos (RF-128, ADR-0026
#: item 5). Entra no payload para que a tela não a escreva à mão — foi assim
#: que quatro frases do Senador viraram falsas em 11/09.
#:
#: 30, não 15, desde 2026-09-13: o cargo 6 saiu de granularidade UF (um cron
#: `*/15`) para ZONA fatiada em 6 (`sliceTargets`, `lib/tse/targets.ts`) — os
#: crons de `vercel.ts` disparam uma fatia a cada 5 min, e a volta completa
#: das 6 fatias (garantia de que toda UF foi revisitada) leva 30 min, não 15.
#:
#: Mudou de casa em 2026-09-13 (ADR-0038 D3): nasceu em `api/model/project.py`
#: e continua reexportado de lá (`from api.model.cargos import
#: ATUALIZACAO_MIN_DEPUTADO`), então nenhum uso anterior quebra. Veio para cá
#: porque o limiar de alarme precisa **derivar** dela — repetir "30" em
#: `api/model/dado_ts.py` seria o segundo número a manter à mão, exatamente o
#: que o ADR proíbe — e `dado_ts.py` não pode importar de `project.py`, que é
#: quem importa `dado_ts`.
ATUALIZACAO_MIN_DEPUTADO = 30

#: Cadência de ingestão de cada cargo, em **segundos**. É o intervalo entre
#: duas leituras COMPLETAS do universo de alvos daquele cargo — não o intervalo
#: entre dois disparos de cron.
#:
#: A distinção só importa no cargo 6, e importa muito: `vercel.ts:192-240` tem
#: seis crons de 5 em 5 minutos, um por fatia (`/api/ingest/deputado-federal/
#: 1..6`). Derivar "300s" desse `*/5` diria que toda zona é revisitada a cada
#: 5 min, quando na verdade cada uma é revisitada uma vez por volta completa —
#: 30 min (ADR-0036). Um limiar de alarme calibrado nos 5 min gritaria em todo
#: ciclo saudável de Deputado.
#:
#: Cargo desconhecido fica FORA do dicionário de propósito: sem cadência
#: declarada não há limiar honesto a aplicar, e `cadencia_segundos` devolve
#: `None` em vez de um default que alarmaria no ritmo errado.
CADENCIA_SEGUNDOS: dict[int, int] = {
    1: 60,  # Presidente — ADR-0011 (cadência de 60s)
    3: 60,  # Governador — ADR-0011, mesmo cron
    5: 300,  # Senador — ADR-0026 nota (b): 5 min, mantidos na volta para zona
    6: ATUALIZACAO_MIN_DEPUTADO * 60,  # Deputado — ADR-0036: 6 fatias × 5 min
}


def total_cadeiras(cd: int) -> int | None:
    """Tamanho da casa legislativa do cargo, ou `None` quando não se aplica."""
    return TOTAL_CADEIRAS.get(int(cd))


def vagas_em_disputa(cd: int) -> int | None:
    """Cadeiras renovadas em 2026, ou `None` quando não se aplica."""
    return VAGAS_EM_DISPUTA_2026.get(int(cd))


def cadencia_segundos(cd: int) -> int | None:
    """Intervalo entre duas varreduras COMPLETAS do cargo, em segundos.

    `None` para cargo sem cadência declarada — o chamador não tem limiar a
    aplicar e não deve inventar um (ver `CADENCIA_SEGUNDOS`).
    """
    return CADENCIA_SEGUNDOS.get(int(cd))


def cargo_info(cd: int) -> CargoInfo | None:
    """Metadados do cargo, ou `None` quando o código não é coberto.

    `None` em vez de exceção: o orchestrator aceita `cargo` de 1 a 99 no corpo
    do trigger (`ProjectRequest`) e precisa degradar — um cargo desconhecido
    cai no comportamento default (1 vaga, granularidade de zona), nunca
    derruba o ciclo.
    """
    return _POR_CD.get(int(cd))


def vagas_por_uf(cd: int, default: int = 1) -> int:
    """Vagas em disputa por UF. `default` cobre cargo desconhecido e o
    proporcional (Deputado Federal, `vagas_por_uf = None`), cuja bancada vem
    de tabela própria e não desta."""
    info = cargo_info(cd)
    if info is None:
        return default
    vagas = info["vagas_por_uf"]
    return default if vagas is None else vagas


def votos_por_eleitor(cd: int) -> int | None:
    """Quantos votos UM eleitor deposita no cargo — a razão entre as duas
    unidades que o EA20 mistura no mesmo arquivo (spec 022 RF-210, spec 021
    RF-195c).

    O TSE publica `e.te`/`e.esi`/`e.c`/`e.a` em **pessoas** e `v.tv`/`v.vv`/
    `v.vb`/`v.tvn`/`v.van`/`v.vansj` em **votos**. Num cargo de um voto por
    eleitor as duas unidades coincidem e ninguém percebe a diferença. No
    Senado de 2026 (2 vagas) não coincidem: medido nas quatro capturas reais
    do simulado (`tests/fixtures/tse/2026-sim/senado/{df,ac,sp,rs}`),
    `v.tv == 2 × e.c` exato. Toda razão "voto ÷ comparecimento" sai o dobro.

    - Majoritário: `vagas_por_uf` — cada vaga é um voto (Senado: 2 em 2026;
      Presidente/Governador: 1).
    - Proporcional (Deputado Federal): **1** — voto único, na legenda ou no
      nome. Não é `vagas_por_uf` (que é `None` ali, e seria o tamanho da
      bancada, não o número de votos).

    🔴 **`None`, nunca um palpite**, para cargo desconhecido ou majoritário sem
    `vagas_por_uf` declarado. É o padrão "default silencioso em conversor de
    enum" que esta base já pagou três vezes: um `2` suposto para o Senado, ou
    um `1` suposto para qualquer cargo, publicaria projeção de voto na unidade
    errada sem erro nenhum. O chamador que recebe `None` NÃO projeta as
    métricas de voto (`project.py::compute_participacao`,
    `project.py::_votos_por_eleitor_ou_none`).

    Fonte: a MESMA tabela de onde saem `EdgePayloadUf.vagas` e o `vagas` de
    `p_eleito` (`vagas_por_uf`, espelho de `lib/config/cargos.ts`, conferido
    por `tests/unit/model/test_cargos_sync.py`).
    """
    info = cargo_info(cd)
    if info is None:
        return None
    if info["proporcional"]:
        return 1
    vagas = info["vagas_por_uf"]
    if vagas is None or int(vagas) < 1:
        return None
    return int(vagas)


def granularidade(cd: int, default: Granularidade = "zona") -> Granularidade:
    """Granularidade de ingestão do cargo (ADR-0026 item 1)."""
    info = cargo_info(cd)
    return info["granularidade"] if info is not None else default
