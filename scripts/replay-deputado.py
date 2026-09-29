"""G2 — replay sintético da projeção de Deputado Federal (spec 026, ADR-0063 § 7).

    .venv-model/bin/python3.14 scripts/replay-deputado.py [--sementes 20] [--ufs SP,MG] [--json saida.json]

## A pergunta

A 25% apurado, quantas cadeiras (e quantos eleitos) a PROJEÇÃO erra em relação
ao resultado final — e quantas a PARCIAL ("se a contagem parasse agora") erra?
O dono decide ligar o interruptor olhando este número (ADR-0063: o resultado a
25% é reportado, e nenhum limiar do código depende dele).

## O que é sintético, e por quê

Não existe dado de 2022 por zona no repositório, nem a ordem de chegada dos
boletins de 2022 para deputado (ADR-0063, Contexto 4). O replay usa:

  - **os totais reais de 2022** por candidatura e legenda
    (`tests/fixtures/model/cadeiras-golden-2022.json`, 27 UFs, 9.675
    candidaturas, 513 cadeiras) — o "resultado final" é a nossa conta
    (`distribuir_cadeiras`) sobre eles, não o `DS_SIT_TOT_TURNO` do TSE;
  - **o tamanho real das zonas de 2026** (`tests/fixtures/replay-2022/
    snapshots.json`, `eleitorado`, 2.619 zonas de 26 UFs; o DF, ausente ali,
    recebe 19 zonas de tamanho sorteado);
  - **uma geografia inventada**: cada zona ganha um porte (log do eleitorado),
    duas coordenadas de "região" e um comparecimento; cada agremiação tem uma
    inclinação por porte e por região, e cada candidatura um reduto regional
    próprio. O `σ` da concentração regula quanto o voto se amontoa;
  - **três ordens de chegada**: aleatória, grandes zonas primeiro (o viés de
    composição do ADR-0023) e por região (uma região inteira antes das outras
    — o risco de "voto de reduto" que o ADR-0063 nomeia).

Em cada ponto (25–90% do eleitorado), as zonas da ordem chegam inteiras e a
zona da fronteira chega pela metade das seções que faltam para o ponto. A
projeção é `deputado_projecao.projetar_votos` — a MESMA conta do ciclo — com a
pós-estratificação por tercis de `project._compute_estratos_por_uf`. Com menos
de 2 zonas apuradas a trava fecha: a tela mostra só a parcial, e o replay
conta a projeção como a parcial (é o que o leitor vê).

G3 (geografia real de 2022) só roda se `build/tse-archives/
votacao_candidato_munzona_2022/` existir — ver `--geografia-real`.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time
from dataclasses import dataclass

import numpy as np

RAIZ = pathlib.Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from api.model.cadeiras import Agremiacao, Candidato, ResultadoCadeiras, distribuir_cadeiras  # noqa: E402
from api.model.deputado_projecao import ZONAS_MINIMAS, projetar_votos  # noqa: E402
from api.model.project import _compute_estratos_por_uf  # noqa: E402

GOLDEN = RAIZ / "tests" / "fixtures" / "model" / "cadeiras-golden-2022.json"
ZONAS_2026 = RAIZ / "tests" / "fixtures" / "replay-2022" / "snapshots.json"
G3_DIR = RAIZ / "build" / "tse-archives" / "votacao_candidato_munzona_2022"

#: σ do log da afinidade zona × agremiação/candidatura.
CONCENTRACOES = {"baixa": 0.15, "media": 0.5, "alta": 1.0}
ORDENS = ("aleatoria", "grandes_primeiro", "regional")
PONTOS = (25, 30, 40, 50, 60, 70, 80, 90)

#: O DF não está no `eleitorado` da fixture do replay presidencial.
_DF_ZONAS = 19
_DF_ELEITORADO = 2_200_000


@dataclass(frozen=True)
class Uf:
    sigla: str
    vagas: int
    #: `(cod, linha da legenda, ((sqcand, linha), ...))` — a ordem das linhas.
    plano: list[tuple[str, int, tuple[tuple[int, int], ...]]]
    totais: np.ndarray  # int64 (linhas,)
    te: np.ndarray  # int64 (zonas,)
    cod_zona: np.ndarray  # int64 (zonas,)
    estratos: list[int | None]
    #: A inclinação de cada linha para o sorteio de afinidade (fixa por UF).
    agremiacao_da_linha: np.ndarray  # int64 (linhas,) índice da agremiação
    e_legenda: np.ndarray  # bool (linhas,)


def carregar() -> list[Uf]:
    golden = json.loads(GOLDEN.read_text())["ufs"]
    eleitorado = json.loads(ZONAS_2026.read_text())["eleitorado"]
    por_uf: dict[str, list[tuple[int, int]]] = {}
    for z in eleitorado:
        if z["eleitores_aptos"] > 0:
            por_uf.setdefault(z["uf"], []).append((int(z["cod_zona"]), int(z["eleitores_aptos"])))
    rng_df = np.random.default_rng(61)
    if "DF" not in por_uf:
        media = _DF_ELEITORADO / _DF_ZONAS
        por_uf["DF"] = [
            (i + 1, int(media * rng_df.uniform(0.5, 1.5))) for i in range(_DF_ZONAS)
        ]

    ufs: list[Uf] = []
    for sigla in sorted(golden):
        dados = golden[sigla]
        plano = []
        totais: list[int] = []
        agr_linha: list[int] = []
        leg: list[bool] = []
        for ia, a in enumerate(dados["agremiacoes"]):
            i_leg = len(totais)
            totais.append(int(a["legenda"]))
            agr_linha.append(ia)
            leg.append(True)
            cands = []
            for sq, votos in a["candidatos"]:
                cands.append((int(sq), len(totais)))
                totais.append(int(votos))
                agr_linha.append(ia)
                leg.append(False)
            plano.append((a["cod"], i_leg, tuple(cands)))
        zonas = sorted(por_uf[sigla])
        cod = np.array([c for c, _ in zonas], dtype=np.int64)
        te = np.array([t for _, t in zonas], dtype=np.int64)
        mapa, _pesos = _compute_estratos_por_uf(sigla, {(sigla, int(c)): int(t) for c, t in zonas})
        estratos = [mapa.get(int(c)) if mapa else None for c in cod]
        ufs.append(
            Uf(
                sigla=sigla,
                vagas=int(dados["vagas"]),
                plano=plano,
                totais=np.array(totais, dtype=np.int64),
                te=te,
                cod_zona=cod,
                estratos=estratos,
                agremiacao_da_linha=np.array(agr_linha, dtype=np.int64),
                e_legenda=np.array(leg, dtype=bool),
            )
        )
    return ufs


def _repartir(totais: np.ndarray, pesos: np.ndarray) -> np.ndarray:
    """Cada linha de `totais` repartida pelas zonas em proporção a `pesos`,
    com soma EXATA por linha (maiores restos; empate → zona de menor índice)."""
    soma = pesos.sum(axis=1, keepdims=True)
    brutos = totais[:, None] * pesos / soma
    pisos = np.floor(brutos).astype(np.int64)
    faltam = totais - pisos.sum(axis=1)
    restos = brutos - pisos
    ordem = np.argsort(-restos, axis=1, kind="stable")
    posicao = np.empty_like(ordem)
    linhas = np.arange(ordem.shape[0])[:, None]
    posicao[linhas, ordem] = np.arange(ordem.shape[1])[None, :]
    return pisos + (posicao < faltam[:, None]).astype(np.int64)


def geografia(uf: Uf, sigma: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """`(votos por linha × zona, coordenada regional das zonas)`."""
    n_z = uf.te.size
    porte = np.log(uf.te.astype(np.float64))
    porte = (porte - porte.mean()) / (porte.std() or 1.0)
    regiao = rng.uniform(-1.0, 1.0, n_z)
    regiao2 = rng.uniform(-1.0, 1.0, n_z)
    comparecimento = rng.uniform(0.70, 0.85, n_z)
    n_agr = int(uf.agremiacao_da_linha.max()) + 1
    u = rng.normal(0.0, 1.0, n_agr)  # inclinação por porte
    v = rng.normal(0.0, 1.5, n_agr)  # inclinação regional
    c = rng.normal(0.0, 1.5, uf.totais.size)  # reduto da candidatura
    c[uf.e_legenda] = 0.0
    a = uf.agremiacao_da_linha
    log_af = sigma * (
        u[a][:, None] * porte[None, :] + v[a][:, None] * regiao[None, :] + c[:, None] * regiao2[None, :]
    )
    pesos = (uf.te * comparecimento)[None, :] * np.exp(log_af - log_af.max(axis=1, keepdims=True))
    return _repartir(uf.totais, pesos), regiao


def ordem_de_chegada(uf: Uf, ordem: str, regiao: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    if ordem == "aleatoria":
        return rng.permutation(uf.te.size)
    if ordem == "grandes_primeiro":
        return np.argsort(-(uf.te * rng.uniform(0.8, 1.2, uf.te.size)), kind="stable")
    return np.argsort(regiao + rng.normal(0.0, 0.2, uf.te.size), kind="stable")


def _agremiacoes(uf: Uf, votos: list[int]) -> list[Agremiacao]:
    return [
        Agremiacao(
            cod=cod,
            votos_legenda=votos[i_leg],
            candidatos=tuple(Candidato(cod=sq, votos_nominais=votos[i]) for sq, i in cands),
        )
        for cod, i_leg, cands in uf.plano
    ]


def _erro(x: ResultadoCadeiras, verdade: ResultadoCadeiras) -> tuple[int, int]:
    """`(cadeiras fora do lugar, eleitos fora do lugar)` contra o final."""
    cods = set(x.cadeiras) | set(verdade.cadeiras)
    cadeiras = sum(abs(x.cadeiras.get(k, 0) - verdade.cadeiras.get(k, 0)) for k in cods) // 2
    ex = {c.cod for v in x.eleitos.values() for c in v}
    ev = {c.cod for v in verdade.eleitos.values() for c in v}
    return cadeiras, len(ex ^ ev) // 2


def rodar_uf(
    uf: Uf,
    sigma: float,
    semente: int,
    *,
    pontos: tuple[int, ...] = PONTOS,
    estratificar: bool = True,
) -> dict[tuple[str, int], tuple[int, int, int, int, int]]:
    """`{(ordem, ponto): (cad parcial, cad projeção, eleitos parcial, eleitos projeção, trava fechada)}`."""
    estratos = uf.estratos if estratificar else [None] * uf.te.size
    rng = np.random.default_rng(semente)
    matriz, regiao = geografia(uf, sigma, rng)
    verdade = distribuir_cadeiras(_agremiacoes(uf, uf.totais.tolist()), uf.vagas)
    total = int(uf.te.sum())
    saida = {}
    for ordem in ORDENS:
        seq = ordem_de_chegada(uf, ordem, regiao, rng)
        acumulado = np.cumsum(uf.te[seq])
        for ponto in pontos:
            alvo = total * ponto // 100
            n_inteiras = int(np.searchsorted(acumulado, alvo, side="right"))
            esi = np.zeros(uf.te.size, dtype=np.int64)
            contados = np.zeros_like(matriz)
            inteiras = seq[:n_inteiras]
            esi[inteiras] = uf.te[inteiras]
            contados[:, inteiras] = matriz[:, inteiras]
            if n_inteiras < seq.size:
                z = int(seq[n_inteiras])
                antes = int(acumulado[n_inteiras - 1]) if n_inteiras else 0
                parcial_z = alvo - antes
                if parcial_z > 0:
                    esi[z] = parcial_z
                    contados[:, z] = matriz[:, z] * parcial_z // int(uf.te[z])
            vv = contados.sum(axis=0)
            apurada = (esi > 0) & (vv > 0)
            parcial_votos = contados.sum(axis=1).tolist()
            parcial = distribuir_cadeiras(_agremiacoes(uf, parcial_votos), uf.vagas)
            fechada = int(apurada.sum()) < ZONAS_MINIMAS
            if fechada:
                projecao = parcial
            else:
                votos_proj, _fb, _ne = projetar_votos(contados, uf.te, esi, apurada, estratos)
                projecao = distribuir_cadeiras(_agremiacoes(uf, votos_proj), uf.vagas)
            cp, ep = _erro(parcial, verdade)
            cx, ex = _erro(projecao, verdade)
            saida[(ordem, ponto)] = (cp, cx, ep, ex, int(fechada))
    return saida


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sementes", type=int, default=20)
    ap.add_argument("--ufs", default="", help="lista separada por vírgula (default: as 27)")
    ap.add_argument("--concentracoes", default=",".join(CONCENTRACOES))
    ap.add_argument("--json", default="", help="grava os resultados crus")
    ap.add_argument(
        "--sem-estratos", action="store_true", help="projeção sem pós-estratificação (comparação)"
    )
    ap.add_argument("--pontos", default="", help="ex.: 25,100 (default: 25–90)")
    ap.add_argument("--geografia-real", action="store_true", help="G3 (exige build/tse-archives)")
    args = ap.parse_args()

    if args.geografia_real:
        if not G3_DIR.exists():
            print(f"G3: {G3_DIR} ausente — baixe o conjunto (plano da spec 026, § Verificação).")
            return 2
        print("G3: o leitor de votacao_candidato_munzona_2022 ainda não foi escrito.")
        return 2

    ufs = carregar()
    if args.ufs:
        pedidas = set(args.ufs.split(","))
        ufs = [u for u in ufs if u.sigla in pedidas]
    concs = [c for c in args.concentracoes.split(",") if c]
    pontos = tuple(int(p) for p in args.pontos.split(",")) if args.pontos else PONTOS
    print(f"G2 · {len(ufs)} UFs · {sum(u.vagas for u in ufs)} cadeiras · {len(concs)} concentrações × "
          f"{len(ORDENS)} ordens × {args.sementes} sementes · pontos {pontos}"
          + (" · SEM pós-estratificação" if args.sem_estratos else ""), flush=True)

    # (conc, ordem, ponto, semente) → soma nacional das métricas.
    acum: dict[tuple[str, str, int, int], np.ndarray] = {}
    t0 = time.perf_counter()
    for conc in concs:
        sigma = CONCENTRACOES[conc]
        for semente in range(args.sementes):
            for iu, uf in enumerate(ufs):
                # Semente por (concentração, semente, UF): determinístico (§ 6).
                s = (semente * 1_000_003 + iu * 7_919 + int(sigma * 1000)) & 0xFFFFFFFF
                resultado = rodar_uf(
                    uf, sigma, s, pontos=pontos, estratificar=not args.sem_estratos
                )
                for (ordem, ponto), m in resultado.items():
                    chave = (conc, ordem, ponto, semente)
                    acum[chave] = acum.get(chave, np.zeros(5, dtype=np.int64)) + np.array(m)
        print(f"  {conc}: {time.perf_counter() - t0:.0f}s", flush=True)

    total_cad = sum(u.vagas for u in ufs)
    print()
    print(f"Cadeiras e eleitos FORA DO LUGAR contra o resultado final (soma de {len(ufs)} UFs, "
          f"{total_cad} cadeiras) — média [máximo] em {args.sementes} sementes")
    print(f"{'ponto':>5} {'concentração':<12} {'ordem':<17} {'cad. parcial':>13} {'cad. projeção':>14} "
          f"{'eleitos parcial':>16} {'eleitos projeção':>17} {'proj. melhor':>12} {'trava 2 zonas':>13}")
    linhas_json = []
    for ponto in pontos:
        for conc in concs:
            for ordem in ORDENS:
                ms = np.array([acum[(conc, ordem, ponto, s)] for s in range(args.sementes)])
                media = ms.mean(axis=0)
                maximo = ms.max(axis=0)
                melhor = float(np.mean(ms[:, 1] < ms[:, 0]))
                pior = float(np.mean(ms[:, 1] > ms[:, 0]))
                print(f"{ponto:>4}% {conc:<12} {ordem:<17} {media[0]:>6.1f} [{maximo[0]:>3}] "
                      f"{media[1]:>7.1f} [{maximo[1]:>3}] {media[2]:>9.1f} [{maximo[2]:>3}] "
                      f"{media[3]:>10.1f} [{maximo[3]:>3}] {melhor:>6.0%}/{pior:>4.0%} {media[4]:>9.1f}")
                linhas_json.append({
                    "ponto": ponto, "concentracao": conc, "ordem": ordem,
                    "cadeiras_parcial_media": media[0], "cadeiras_parcial_max": int(maximo[0]),
                    "cadeiras_projecao_media": media[1], "cadeiras_projecao_max": int(maximo[1]),
                    "eleitos_parcial_media": media[2], "eleitos_parcial_max": int(maximo[2]),
                    "eleitos_projecao_media": media[3], "eleitos_projecao_max": int(maximo[3]),
                    "projecao_melhor": melhor, "projecao_pior": pior,
                    "ufs_com_trava_fechada_media": media[4],
                })
        print()
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(linhas_json, indent=1))
    print(f"tempo total: {time.perf_counter() - t0:.0f}s ('proj. melhor' = % das sementes em que a "
          "projeção erra MENOS cadeiras que a parcial / % em que erra MAIS)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
