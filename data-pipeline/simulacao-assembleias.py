"""Modo simulado das ASSEMBLEIAS — Deputado Estadual (7) e Distrital (8), spec 027 frente S, Fase 1.

Gera, em `tests/fixtures/simulacao/`, os arquivos que `lib/dev/simulacao.ts` (`pnpm dev:sim`) e o
Global Config/Blob falso dos portões e2e (`scripts/edge-config-falso.ts`) servem para os cargos 7 e 8:

    deputado-estadual.json            payload nacional  → `projection-current-est-t1`
    deputado-estadual-uf.json         UF → detalhe       → Blob `deputado-estadual/uf/<UF>.json`
    deputado-estadual-uf-lista.json   UF → lista 61+     → Blob `deputado-estadual/uf-lista/<UF>.json`
    deputado-distrital.json           payload nacional  → `projection-current-dis-t1`
    deputado-distrital-uf.json        { "DF": detalhe }  → Blob `deputado-distrital/uf/DF.json`

    .venv-model/bin/python3.14 data-pipeline/simulacao-assembleias.py   # da raiz do repositório

## Sem rede, sem banco, sem `pnpm sim`

`pnpm sim:full` lê o banco de PRODUÇÃO (só `SELECT`, mas lê) e é do federal. Este gerador não abre
conexão nenhuma, não faz rede e não lê `.env.local`: roda o **modelo Python real**
(`api/model/project.py::_do_project`, o mesmo ciclo que a Vercel executa) com uma conexão FALSA que
devolve, como linhas de `snapshots`, EA20 de cargo 7/8 — e captura o que ele mandaria ao
`/api/internal/edge-write`. A separação "lista 61+ fora do objeto da UF" é a do writer TS
(`lib/edge-config/writer.ts::separarListaRestante`), repetida aqui na mesma forma.

## De onde vêm os votos (Fase 1: `granularidade: "uf"`, sem `projecao`, `conferencia.nao_comparou`)

- **RR e SP (cargo 7) e DF (cargo 8)**: os EA20 REAIS do simulado oficial do TSE de 29/09
  (`tests/fixtures/tse/2026-sim/dep-est/`, ver o README de lá), com três ajustes declarados:
    1. **SP no pior caso de peso** (RF-289, design § 12): todo nome de urna de SP vira um nome
       sintético de 30 caracteres, carregado de acentos (cada `Ã` é 2 bytes em UTF-8), e cada
       agremiação de 94 candidatos ganha um 95º (sem voto) — o teto legal de `nv + 1`.
    2. **DF com 24 lugares**: o simulado publica `nv = 28` (README, surpresa 1); a casa real tem 24.
       As listas são cortadas no teto legal de 25 (`nv + 1`; saem as de menos votos), os totais e
       o comparecimento refeitos sobre o que ficou (mesmo % apurado), e `qe`/`agr[].vag` saem da
       nossa conta (`distribuir_cadeiras`).
    3. Nomes de urna de RR e DF também viram nomes sintéticos (os do simulado são "CANDIDATO 9716"),
       de tamanho variado — a tela precisa ser vista com nome de gente.
- **As outras 24 UFs do cargo 7**: derivadas de forma DETERMINÍSTICA do EA20 real de SP (o de RR
  não serve de base: três candidaturas com 25,67% cada, o resto com 0,09%), com o
  `nv` da CF art. 27 (`ASSEMBLEIAS`), o eleitorado aproximado da UF, um percentual apurado próprio e
  cada voto multiplicado por um fator pseudoaleatório por (UF, candidatura) tirado de SHA-256, com
  cauda pesada (alguns puxadores por casa).
  Todos os totais que o TSE deriva dos votos são REFEITOS (`par.tvtn/tvan/tvtl`, `v.vv/vnom/vl/vansj/
  tv`, `e.c/a/esi`, `s.st`) e `qe`/`vag` saem da nossa conta — a Conferência confere POR CONSTRUÇÃO,
  e por isso é encanamento, não prova de algoritmo (essa é a dos EA20 reais e do golden, RF-290).
  As listas são cortadas em `nv + 1` por agremiação (as de menos votos saem): MG, RJ e BA passam
  de 60 e têm lista 61+, como SP.
- **Três estados de propósito** (decisão do dono de 14/09: não começou ≠ não sabemos ≠ apurando):
  `NAO_COMECOU` (AC, AP) entram com o agregado a 0% (`and = "n"`); `AGUARDANDO` (RO, TO) não têm
  linha nenhuma — a UF fica em `ufs_aguardando`; as demais apuram.

Votos INVENTADOS, nomes INVENTADOS, partidos do simulado do TSE ("P 9990"). Uso exclusivo de
desenvolvimento local e dos portões e2e — nunca publicar em destino remoto (constituição §§ 1 e 8).
Determinístico: duas execuções dão os mesmos bytes (o `trigger_ts` é fixo; `lib/dev/simulacao.ts`
desloca o relógio na leitura). Depois de rodar: `biome format --write tests/fixtures/simulacao`.
"""

from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone
from typing import Any

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from api.model import project as proj  # noqa: E402
from api.model.cadeiras import distribuir_cadeiras  # noqa: E402
from api.model.cargos import ufs_do_cargo  # noqa: E402
from api.model.deputado import chave_agremiacao, extrair_entrada_proporcional  # noqa: E402

TSE = RAIZ / "tests" / "fixtures" / "tse" / "2026-sim"
DEP_EST = TSE / "dep-est"
ZERO_RR = TSE / "dep-est-sintetico" / "rr" / "m0-zero" / "rr-c0007-e021272-u.json"
DESTINO = RAIZ / "tests" / "fixtures" / "simulacao"

#: O instante do ciclo simulado. Fixo, para a saída ser determinística.
TRIGGER_TS = "2026-10-04T21:00:00Z"
#: O `ts` gravado nos objetos (o writer TS carimba o instante da gravação).
TS_PUBLICADO = "2026-10-04T21:00:00.000Z"
#: `ts` das linhas de `snapshots` — depois do corte de resíduo do simulado (04/10 03h UTC).
TS_SNAPSHOT = datetime(2026, 10, 4, 20, 55, tzinfo=timezone.utc)

#: CF art. 27 — tamanho de cada Assembleia (o mesmo de `test_deputado_estadual.py::ASSEMBLEIAS`).
ASSEMBLEIAS: dict[str, int] = {
    "SP": 94, "MG": 77, "RJ": 70, "BA": 63, "RS": 55, "PR": 54, "PE": 49, "CE": 46,
    "MA": 42, "GO": 41, "PA": 41, "SC": 40, "PB": 36, "ES": 30, "PI": 30, "AL": 27,
    "AC": 24, "AM": 24, "AP": 24, "MS": 24, "MT": 24, "RN": 24, "RO": 24, "RR": 24,
    "SE": 24, "TO": 24,
}  # fmt: skip
#: CF art. 32 § 3º — 3 × 8 federais.
DISTRITAL = 24

#: Eleitorado APROXIMADO por UF (ordem de grandeza do TSE, 2022) — dado de teste, não fonte.
ELEITORADO: dict[str, int] = {
    "MG": 16_290_000, "RJ": 12_830_000, "BA": 11_290_000, "RS": 8_590_000, "PR": 8_480_000,
    "PE": 7_020_000, "CE": 6_820_000, "MA": 5_040_000, "GO": 4_900_000, "PA": 6_080_000,
    "SC": 5_490_000, "PB": 3_090_000, "ES": 2_930_000, "PI": 2_570_000, "AL": 2_300_000,
    "AC": 597_000, "AM": 2_620_000, "AP": 550_000, "MS": 1_990_000, "MT": 2_470_000,
    "RN": 2_550_000, "RO": 1_220_000, "SE": 1_640_000, "TO": 1_090_000,
}  # fmt: skip

NAO_COMECOU = ("AC", "AP")
AGUARDANDO = ("RO", "TO")

PRENOMES = (
    "JOÃO", "JOSÉ", "MARIA", "ANTÔNIO", "CONCEIÇÃO", "SEBASTIÃO", "ESTÊVÃO", "INÊS", "LÚCIA",
    "MÁRCIO", "FÁBIO", "CÁSSIO", "LUÍS", "TÂNIA", "ROGÉRIO", "VALÉRIA", "MÔNICA", "SIMÃO", "CÉLIA",
    "ÍRIS", "ÂNGELA", "NAZARÉ", "GLÓRIA", "JOAQUIM", "BENEDITA", "DÉBORA", "ANDRÉ", "PATRÍCIA",
)  # fmt: skip
SOBRENOMES = (
    "GONÇALVES", "CONCEIÇÃO", "ASSUNÇÃO", "BRAGANÇA", "ARAÚJO", "MAGALHÃES", "GUIMARÃES",
    "FALCÃO", "LEÃO", "ROMÃO", "PAIXÃO", "ANUNCIAÇÃO", "DAMIÃO", "JORDÃO", "VILAÇA", "ASCENÇÃO",
    "BRANDÃO", "CORRÊA", "MÜLLER", "ESTÊVES", "SIMÕES", "GUSMÃO", "ALCÂNTARA", "CONSOLAÇÃO",
)  # fmt: skip
#: Teto do nome de urna no TSE.
MAX_NOME = 30


def _hash(*partes: object) -> int:
    return int.from_bytes(hashlib.sha256("|".join(map(str, partes)).encode()).digest()[:8], "big")


def _frac(*partes: object) -> float:
    """Número em [0, 1) determinístico."""
    return _hash(*partes) / 2**64


def nome_sintetico(uf: str, sqcand: str, *, longo: bool) -> str:
    """Nome de urna inventado, prenome + sobrenomes. `longo` ⇒ o mais perto de 30 caracteres (o teto
    do TSE) entre algumas combinações — o pior caso de peso é em BYTES, e cada vogal com til ou
    acento ocupa 2 em UTF-8."""
    melhor = ""
    for tentativa in range(40 if longo else 1):
        h = _hash("nome", uf, sqcand, tentativa)
        partes = [PRENOMES[h % len(PRENOMES)]]
        alvo = MAX_NOME if longo else 12 + (h >> 7) % 17
        for i in range(1, 8):
            s = SOBRENOMES[(h >> (5 * i + 3)) % len(SOBRENOMES)]
            if s in partes or len(" ".join([*partes, s])) > MAX_NOME:
                continue
            partes.append(s)
            if len(" ".join(partes)) >= alvo:
                break
        nome = " ".join(partes)
        if len(nome) > len(melhor):
            melhor = nome
        if len(melhor) == MAX_NOME:
            break
    return melhor


def _ler(caminho: pathlib.Path) -> dict[str, Any]:
    return json.loads(caminho.read_text(encoding="utf-8"))


def _carg(env: dict[str, Any]) -> dict[str, Any]:
    (carg,) = env["carg"]
    return carg


def _pct(parte: int, todo: int) -> str:
    return f"{(100 * parte / todo if todo else 0):.2f}".replace(".", ",")


def _pctn(parte: int, todo: int) -> str:
    return f"{(100 * parte / todo if todo else 0):.9f}".replace(".", ",")


def _refazer_cadeiras(env: dict[str, Any], cargo: int) -> None:
    """`qe` e `agr[].vag` pela nossa conta (os do arquivo valem para outro `nv`/outros votos)."""
    carg = _carg(env)
    if str(env.get("and", "")).lower() == "n":
        return
    nv = int(carg["nv"])
    entrada = extrair_entrada_proporcional(env, cargo=cargo)
    resultado = distribuir_cadeiras(entrada.agremiacoes, nv)
    carg["qe"] = str(resultado.quociente_eleitoral)
    # A chave é a NACIONAL (`chave_agremiacao`, b28e74b), nunca `agr[].n` (id da inscrição na UF).
    federacoes = {str(f["n"]).strip(): f for f in carg.get("fed") or [] if str(f.get("n", "")).strip()}
    for agr in carg["agr"]:
        cod = chave_agremiacao(agr, federacoes)
        agr["vag"] = str(resultado.cadeiras.get(cod, 0) if cod is not None else 0)


def _refazer_totais(env: dict[str, Any], *, van: int, vb: int, vn: int) -> None:
    """Totais de partido, agremiação e envelope a partir de `cand[].vap` — as identidades da spec 026
    (README de `dep-est/`): tvtn = Σ vap[Válido], tvan = Σ vap, tvtl = tval + Σ vap[Válido (legenda)],
    vv = Σ (tvtn + tvtl) = vnom + vl, vansj = Σ vap[Anulado sub judice], tv = vb + vn + vnt + van + vansj + vv."""
    carg = _carg(env)
    vnom = vl = vansj = 0
    for agr in carg["agr"]:
        for par in agr["par"]:
            validos = sum(int(c["vap"]) for c in par["cand"] if c.get("dvt") == "Válido")
            legenda_cand = sum(
                int(c["vap"]) for c in par["cand"] if c.get("dvt") == "Válido (legenda)"
            )
            sj = sum(int(c["vap"]) for c in par["cand"] if c.get("dvt") == "Anulado sub judice")
            tval = int(par.get("tval") or 0)
            par["tvtn"] = str(validos)
            par["tvan"] = str(sum(int(c["vap"]) for c in par["cand"]))
            par["tvtl"] = str(tval + legenda_cand)
            vnom += validos
            vl += tval + legenda_cand
            vansj += sj
        for campo in ("tval", "tvan", "tvtl", "tvtn"):
            if campo in agr:
                agr[campo] = str(sum(int(p.get(campo) or 0) for p in agr["par"]))
    vv = vnom + vl
    tv = vb + vn + van + vansj + vv
    v = env["v"]
    v.update(
        {
            "tv": str(tv),
            "vvc": str(vv + van + vansj),
            "vv": str(vv),
            "pvv": _pct(vv, tv),
            "pvvn": _pctn(vv, tv),
            "vnom": str(vnom),
            "pvnom": _pct(vnom, vv),
            "pvnomn": _pctn(vnom, vv),
            "vl": str(vl),
            "pvl": _pct(vl, vv),
            "pvln": _pctn(vl, vv),
            "van": str(van),
            "vsan": str(van),
            "vansj": str(vansj),
            "vb": str(vb),
            "vn": str(vn),
            "tvn": str(vn),
            "vnt": "0",
        }
    )
    for agr in carg["agr"]:
        for par in agr["par"]:
            for c in par["cand"]:
                c["pvap"] = _pct(int(c["vap"]), vv)
                c["pvapn"] = _pctn(int(c["vap"]), vv)


def _ajustar_apuracao(env: dict[str, Any], *, te: int, pct: float) -> None:
    """Eleitorado e seções coerentes com `v.tv` (comparecimento = votos totais)."""
    tv = int(env["v"]["tv"])
    esi = max(round(te * pct), tv)
    ts = max(1, te // 330)
    st = max(1, round(ts * pct))
    env["e"].update(
        {
            "te": str(te),
            "est": str(esi),
            "esi": str(esi),
            "esa": str(esi),
            "pest": _pct(esi, te),
            "pestn": _pctn(esi, te),
            "esnt": str(te - esi),
            "c": str(tv),
            "pc": _pct(tv, esi),
            "a": str(esi - tv),
            "pa": _pct(esi - tv, esi),
        }
    )
    env["s"].update(
        {
            "ts": str(ts),
            "st": str(st),
            "si": str(st),
            "sa": str(st),
            "pst": _pct(st, ts),
            "pstn": _pctn(st, ts),
            "snt": str(ts - st),
        }
    )
    env["and"] = "f" if pct >= 1 else "p"


def _trocar_nomes(env: dict[str, Any], uf: str, *, longo: bool) -> None:
    for agr in _carg(env)["agr"]:
        for par in agr["par"]:
            for c in par["cand"]:
                nome = nome_sintetico(uf, c["sqcand"], longo=longo)
                c["nm"] = nome
                c["nmu"] = nome


def _completar_95(env: dict[str, Any], uf: str) -> int:
    """Cada agremiação de `nv` candidatos ganha o (nv+1)-ésimo, sem voto — o teto legal."""
    carg = _carg(env)
    nv = int(carg["nv"])
    usados = {c["n"] for a in carg["agr"] for p in a["par"] for c in p["cand"]}
    acrescentados = 0
    for agr in carg["agr"]:
        if sum(len(p["cand"]) for p in agr["par"]) != nv:
            continue
        par = agr["par"][0]
        modelo = par["cand"][-1]
        numero = next(
            f"{par['n']}{k:03d}" for k in range(999, 0, -1) if f"{par['n']}{k:03d}" not in usados
        )
        usados.add(numero)
        novo = copy.deepcopy(modelo)
        sq = f"9{_hash('sq95', uf, agr['n']) % 10**7:07d}"
        novo.update(
            {
                "n": numero,
                "sqcand": sq,
                "seq": str(int(modelo.get("seq") or 0) + 1),
                "vap": "0",
                "dvt": "Válido",
                "nm": nome_sintetico(uf, sq, longo=True),
                "nmu": nome_sintetico(uf, sq, longo=True),
            }
        )
        par["cand"].append(novo)
        acrescentados += 1
    return acrescentados


#: Boletim do ciclo simulado, no horário de Brasília (`hg` do TSE): 17h50 = 20h50 UTC, 10 minutos antes
#: do `TRIGGER_TS` — dentro do limiar de "dado parado" (900 s) do ciclo.
DATA_BOLETIM, HORA_BOLETIM = "04/10/2026", "17:50:00"


def _datar(env: dict[str, Any]) -> dict[str, Any]:
    env["dg"] = env["dt"] = DATA_BOLETIM
    env["hg"] = env["ht"] = HORA_BOLETIM
    return env


def _cortar_listas(env: dict[str, Any], nv: int) -> None:
    """Teto legal de `nv + 1` candidaturas por agremiação (Lei 9.504, art. 10) — saem as de menos
    votos. Os totais NÃO são refeitos aqui: quem corta chama `_refazer_totais` depois."""
    for agr in _carg(env)["agr"]:
        cands = [c for par in agr["par"] for c in par["cand"]]
        if len(cands) <= nv + 1:
            continue
        cands.sort(key=lambda c: (-int(c["vap"]), c["sqcand"]))
        fora = {id(c) for c in cands[nv + 1 :]}
        for par in agr["par"]:
            par["cand"] = [c for c in par["cand"] if id(c) not in fora]


def derivar(base: dict[str, Any], uf: str, nv: int) -> dict[str, Any]:
    """Uma Assembleia de outra UF a partir de um EA20 real de cargo 7 — ver o cabeçalho."""
    env = copy.deepcopy(base)
    env["cdabr"] = uf.lower()
    carg = _carg(env)
    carg["nv"] = str(nv)
    te = ELEITORADO[uf]
    pct = round(0.12 + 0.76 * _frac("pct", uf), 3)
    # Escala: o comparecimento (≈ 85% do eleitorado das seções apuradas) sobre os votos da base.
    tv_base = int(base["v"]["tv"])
    escala = (0.85 * te * pct) / tv_base
    for agr in carg["agr"]:
        for par in agr["par"]:
            par["tval"] = str(round(int(par.get("tval") or 0) * escala))
            for c in par["cand"]:
                # Cauda pesada: a base de SP é quase plana (0,05% por candidatura), e uma Assembleia
                # sem puxador não exercita o bloco de puxadores nem o "mais votados do país".
                cauda = 1 + 300 * _frac("puxador", uf, c["sqcand"]) ** 300
                fator = (0.35 + 1.3 * _frac("voto", uf, c["sqcand"])) * cauda
                c["vap"] = str(round(int(c["vap"]) * escala * fator))
                c["sqcand"] = f"{ord(uf[0]) * 100 + ord(uf[1])}{c['sqcand']}"
                c["nm"] = c["nmu"] = nome_sintetico(uf, c["sqcand"], longo=False)
    _cortar_listas(env, nv)
    v = base["v"]
    _refazer_totais(
        env,
        van=round(int(v["van"]) * escala),
        vb=round(int(v["vb"]) * escala),
        vn=round(int(v["vn"]) * escala),
    )
    _ajustar_apuracao(env, te=te, pct=pct)
    _refazer_cadeiras(env, 7)
    return env


def zero(uf: str, nv: int) -> dict[str, Any]:
    """Agregado antes do primeiro boletim (`and = "n"`) — a fixture sintética de RR, com o `nv` e o
    eleitorado da UF."""
    env = copy.deepcopy(_ler(ZERO_RR))
    env["cdabr"] = uf.lower()
    _carg(env)["nv"] = str(nv)
    env["e"]["te"] = str(ELEITORADO[uf])
    env["e"]["esnt"] = str(ELEITORADO[uf])
    for agr in _carg(env)["agr"]:
        for par in agr["par"]:
            for c in par["cand"]:
                c["sqcand"] = f"{ord(uf[0]) * 100 + ord(uf[1])}{c['sqcand']}"
                c["nm"] = c["nmu"] = nome_sintetico(uf, c["sqcand"], longo=False)
    return env


# ---------------------------------------------------------------------------
# O ciclo do modelo, com banco e Edge falsos
# ---------------------------------------------------------------------------


class _Cursor:
    """As duas consultas do caminho proporcional (`snapshots` e `eleitorado`). Outra ⇒ erro alto."""

    def __init__(self, conn: _Conn) -> None:
        self._conn = conn
        self._linhas: list[tuple[Any, ...]] = []

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        if "FROM snapshots" in sql:
            cargo, turno, *_ = params
            self._linhas = [
                (uf, 0, 0, "uf", float(str(env["s"].get("pstn") or 0).replace(",", ".")), env, TS_SNAPSHOT)
                for uf, env in self._conn.envelopes.items()
                if (cargo, turno) == (self._conn.cargo, 1)
            ]
        elif "FROM eleitorado" in sql:
            self._linhas = [(uf, 0, int(env["e"]["te"])) for uf, env in self._conn.envelopes.items()]
        else:
            raise AssertionError(f"consulta inesperada: {sql[:80]}")

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._linhas

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_a: object) -> None:
        return None


class _Conn:
    def __init__(self, cargo: int, envelopes: dict[str, dict[str, Any]]) -> None:
        self.cargo = cargo
        self.envelopes = envelopes

    def cursor(self) -> _Cursor:
        return _Cursor(self)

    def commit(self) -> None:
        raise AssertionError("o caminho proporcional não escreve no banco")

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None

    def __enter__(self) -> _Conn:
        return self

    def __exit__(self, *_a: object) -> None:
        return None


def rodar_ciclo(
    cargo: int, envelopes: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    publicados: list[tuple[dict[str, Any], dict[str, dict[str, Any]]]] = []
    originais = (proj._open_conn, proj.post_edge_write, proj._alert_slack)
    proj._open_conn = lambda: _Conn(cargo, envelopes)  # type: ignore[assignment]
    proj.post_edge_write = lambda payload, payloads_uf=None: publicados.append(  # type: ignore[assignment]
        (payload, payloads_uf or {})
    )
    proj._alert_slack = lambda *_a, **_k: None  # type: ignore[assignment]
    try:
        status, resposta = proj._do_project(
            json.dumps({"cargo": cargo, "turno": 1, "trigger_ts": TRIGGER_TS}).encode()
        )
    finally:
        proj._open_conn, proj.post_edge_write, proj._alert_slack = originais
    if status != 200 or len(publicados) != 1:
        raise SystemExit(f"cargo {cargo}: o ciclo não publicou ({status}: {resposta})")
    return publicados[0]


def separar_lista(
    payloads_uf: dict[str, dict[str, Any]], ts: str, cargo: int
) -> tuple[dict[str, Any], dict[str, Any]]:
    """`lib/edge-config/writer.ts::separarListaRestante`: o objeto da UF sai sem o transporte, com
    `ts`/`uf`/`cargo` carimbados; a lista só existe se tiver ao menos uma linha."""
    detalhes: dict[str, Any] = {}
    listas: dict[str, Any] = {}
    for uf in sorted(payloads_uf):
        bruto = dict(payloads_uf[uf])
        restante = bruto.pop("lista_restante", None)
        detalhes[uf] = {**bruto, "ts": ts, "uf": uf, "cargo": cargo}
        if restante and any(bloco["candidatos"] for bloco in restante):
            listas[uf] = {
                "ts": ts,
                "cargo": cargo,
                "turno": 1,
                "contrato": 2,
                "uf": uf,
                "agremiacoes": restante,
            }
    return detalhes, listas


def _gravar(nome: str, dado: Any) -> int:
    texto = json.dumps(dado, ensure_ascii=False, indent=2) + "\n"
    (DESTINO / nome).write_text(texto, encoding="utf-8")
    return len(texto.encode())


def montar_estadual() -> dict[str, dict[str, Any]]:
    rr = _ler(DEP_EST / "rr" / "rr-c0007-e021272-u.json")
    sp = _ler(DEP_EST / "sp" / "sp-c0007-e021272-u.json")
    envelopes: dict[str, dict[str, Any]] = {}
    for uf in ufs_do_cargo(7):
        nv = ASSEMBLEIAS[uf]
        if uf in AGUARDANDO:
            continue
        if uf in NAO_COMECOU:
            envelopes[uf] = zero(uf, nv)
        elif uf == "RR":
            env = copy.deepcopy(rr)
            _trocar_nomes(env, uf, longo=False)
            envelopes[uf] = env
        elif uf == "SP":
            env = copy.deepcopy(sp)
            _trocar_nomes(env, uf, longo=True)
            _completar_95(env, uf)
            envelopes[uf] = env
        else:
            envelopes[uf] = derivar(sp, uf, nv)
    return envelopes


def montar_distrital() -> dict[str, dict[str, Any]]:
    bruto = _ler(DEP_EST / "df" / "df-c0008-e021272-u.json")
    df = copy.deepcopy(bruto)
    _carg(df)["nv"] = str(DISTRITAL)
    # Listas de 28 (o `nv` do simulado) → 25, o teto legal com 24 lugares; os totais e o
    # comparecimento são refeitos sobre o que ficou, mantendo o % apurado do arquivo.
    _cortar_listas(df, DISTRITAL)
    v = bruto["v"]
    _refazer_totais(df, van=int(v["van"]), vb=int(v["vb"]), vn=int(v["vn"]))
    te, esi = int(bruto["e"]["te"]), int(bruto["e"]["esi"])
    _ajustar_apuracao(df, te=te, pct=esi / te)
    _refazer_cadeiras(df, 8)
    _trocar_nomes(df, "DF", longo=False)
    return {"DF": df}


def main() -> None:
    saidas: dict[str, int] = {}
    for cargo, slug, envelopes in (
        (7, "deputado-estadual", montar_estadual()),
        (8, "deputado-distrital", montar_distrital()),
    ):
        payload, payloads_uf = rodar_ciclo(cargo, {uf: _datar(e) for uf, e in envelopes.items()})
        # O `ts` do ciclo é o relógio da máquina (`datetime.now`); fixado no do gatilho para a saída
        # ser determinística. `lib/dev/simulacao.ts` o troca por "agora" na leitura, de todo jeito.
        payload["ts"] = TS_PUBLICADO
        detalhes, listas = separar_lista(payloads_uf, TS_PUBLICADO, cargo)
        saidas[f"{slug}.json"] = _gravar(f"{slug}.json", payload)
        saidas[f"{slug}-uf.json"] = _gravar(f"{slug}-uf.json", detalhes)
        if listas:
            saidas[f"{slug}-uf-lista.json"] = _gravar(f"{slug}-uf-lista.json", listas)
        b = payload["bancada"]
        print(
            f"cargo {cargo}: {len(envelopes)} casas lidas · {b['ufs_calculadas']} calculadas · "
            f"{b['ufs_aguardando']} aguardando · {b['cadeiras_atribuidas']}/{b['total_cadeiras']} "
            f"cadeiras · listas 61+: {sorted(listas)}"
        )
    for nome, n in saidas.items():
        print(f"  {nome}: {n:,} B")


if __name__ == "__main__":
    main()
