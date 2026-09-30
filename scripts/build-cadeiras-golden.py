"""Gera o golden de cadeiras de 2022 de um cargo proporcional (spec 017 RF-126;
spec 027 RF-290 para as assembleias).

Roda offline, sobre dois datasets abertos do TSE que ficam em `build/`
(git-ignored, ~8,3 GB somados). A fixture resultante é o que o teste commitado
lê. `--cargo` é OBRIGATÓRIO desde 2026-09-29 — um default escolheria em
silêncio a casa errada:

    .venv-model/bin/python3.14 scripts/build-cadeiras-golden.py --cargo 6

| `--cargo` | casa | saída | total esperado |
|---|---|---|---|
| 6 | Câmara dos Deputados | `tests/fixtures/model/cadeiras-golden-2022.json` (a de sempre, ~0,23 MB) | 513 |
| 7 | 26 Assembleias Legislativas | `tests/fixtures/model/cadeiras-golden-2022-c7.json` | 1.035 |
| 8 | Câmara Legislativa do DF | `tests/fixtures/model/cadeiras-golden-2022-c8.json` | 24 |

O total esperado sai de `api/model/cargos.py::TOTAL_CADEIRAS` (o mesmo fato que
o payload publica), e as UFs esperadas de `ufs_do_cargo` — o 7 não existe no
DF, o 8 só existe no DF. Com `--cargo 6` a saída é byte a byte a de antes do
parâmetro: mesmo caminho, mesma nota, mesma forma (o teste
`test_deputado_estadual.py::test_golden_script_*` roda o script sobre CSVs em
miniatura e confere isso).

## 🔴 O que falta para o 7 e o 8 (29/09)

**Os golden das assembleias NÃO foram gerados**, e nenhum teste os lê ainda. Os
dois datasets de 2022 não estão em `build/` desta máquina, e o CDN do TSE
recusa robô (ver "Duas armadilhas", 2). O caminho:

1. o dono baixa no navegador, de
   https://dadosabertos.tse.jus.br/dataset/resultados-2022, os conjuntos
   `votacao_candidato_munzona_2022` e `votacao_partido_munzona_2022` (os
   mesmos arquivos por UF servem aos três cargos: o CSV traz `CD_CARGO`) e os
   descompacta em `build/tse-archives/<nome do conjunto>/`;
2. roda `--cargo 7` e `--cargo 8` (exit 0 = total e UFs conferem; 2 = não);
3. só então nasce o teste do golden das assembleias, espelho de
   `tests/unit/model/test_cadeiras_golden_2022.py` — com a meta do federal
   (as divergências contra o resultado oficial listadas e explicadas uma a uma,
   como as 2 de 511/513), e SEM `skip` quando a fixture falta: um golden que
   pula em silêncio é um golden que ninguém percebe que não roda.

## De onde vem cada campo

| campo | origem |
|---|---|
| votos nominais por candidato | `votacao_candidato_munzona_2022_<UF>.csv`, `QT_VOTOS_NOMINAIS_VALIDOS`, somado sobre (município, zona) e sobre `ST_VOTO_EM_TRANSITO` |
| votos de legenda | `votacao_partido_munzona_2022_<UF>.csv`, `QT_VOTOS_LEGENDA_VALIDOS` |
| agremiação | `NR_FEDERACAO` quando há federação, senão `NR_PARTIDO` — federação é UMA agremiação (Lei 9.096 art. 11-A; Lei 9.504 art. 6º-A) |
| vagas da UF | contagem de `DS_SIT_TOT_TURNO` começando em "ELEITO" |
| **gabarito** | `DS_SIT_TOT_TURNO` — desfecho oficial por candidato, não reconstrução nossa |

## Duas armadilhas que este script já pagou

1. **O cargo 6 NÃO está no arquivo `_BR`** do dataset de partido — só nos de UF.
   Ler a legenda de `_BR` devolve zero para todo mundo, silenciosamente. Custou
   6 cadeiras na primeira medição (505/513 em vez de 511/513), com o padrão
   enganoso de exatamente uma cadeira errada por UF grande.
2. **Baixar o dataset de candidato exige navegador.** O CDN do TSE responde 403
   a cliente automatizado, inclusive com o User-Agent do próprio projeto e com
   `GET` parcial. O caminho é o portal de dados abertos, à mão:
   https://dadosabertos.tse.jus.br/dataset/resultados-2022

## Sobre a data de geração do dataset

O script imprime o `DT_GERACAO` dos CSVs. Ele importa: os embargos da ADI 7228,
julgados em 13/03/2025, derrubaram a modulação e fizeram a decisão **retroagir a
2022**. Um dataset gerado antes disso traria a distribuição proclamada à época,
não a recalculada — e um golden contra ela passaria com um algoritmo errado.
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from api.model.cargos import CARGOS, total_cadeiras, ufs_do_cargo  # noqa: E402

TURNO = "1"
NULO = ("-1", "", "#NULO#")
DIR_CAND = pathlib.Path("build/tse-archives/votacao_candidato_munzona_2022")
DIR_PART = pathlib.Path("build/tse-archives/votacao_partido_munzona_2022")

#: Cargos proporcionais da tabela canônica — os únicos com golden de cadeiras.
CARGOS_PROPORCIONAIS: tuple[int, ...] = tuple(c["cd"] for c in CARGOS if c["proporcional"])


def saida_do_cargo(cargo: int) -> pathlib.Path:
    """Caminho da fixture. O 6 mantém o nome de antes do parâmetro — o teste
    e a documentação do federal apontam para ele."""
    if cargo == 6:
        return pathlib.Path("tests/fixtures/model/cadeiras-golden-2022.json")
    return pathlib.Path(f"tests/fixtures/model/cadeiras-golden-2022-c{cargo}.json")


def _legenda_por_partido(uf: str, cargo: str) -> dict[str, int]:
    """Votos de legenda por número de partido. ⚠️ arquivo da UF, nunca `_BR`."""
    fonte = DIR_PART / f"votacao_partido_munzona_2022_{uf}.csv"
    total: dict[str, int] = collections.defaultdict(int)
    with fonte.open(encoding="latin-1", newline="") as fh:
        for r in csv.DictReader(fh, delimiter=";"):
            if r["CD_CARGO"] == cargo and r["NR_TURNO"] == TURNO:
                total[r["NR_PARTIDO"]] += int(r["QT_VOTOS_LEGENDA_VALIDOS"] or 0)
    return total


def _uf(caminho: pathlib.Path, cargo: str) -> dict | None:
    uf = caminho.stem[-2:]
    legenda = _legenda_por_partido(uf, cargo)

    votos: dict[str, int] = collections.defaultdict(int)
    meta: dict[str, dict[str, str]] = {}
    geracao = ""
    with caminho.open(encoding="latin-1", newline="") as fh:
        for r in csv.DictReader(fh, delimiter=";"):
            if r["CD_CARGO"] != cargo or r["NR_TURNO"] != TURNO:
                continue
            geracao = geracao or r["DT_GERACAO"]
            sq = r["SQ_CANDIDATO"]
            votos[sq] += int(r["QT_VOTOS_NOMINAIS_VALIDOS"] or 0)
            meta.setdefault(sq, r)
    if not meta:
        return None

    grupos: dict[str, list[str]] = collections.defaultdict(list)
    partidos: dict[str, set[str]] = collections.defaultdict(set)
    for sq, r in meta.items():
        cod = f"F{r['NR_FEDERACAO']}" if r["NR_FEDERACAO"] not in NULO else f"P{r['NR_PARTIDO']}"
        grupos[cod].append(sq)
        partidos[cod].add(r["NR_PARTIDO"])

    eleito = lambda m: m["DS_SIT_TOT_TURNO"].startswith("ELEITO")  # noqa: E731
    return {
        "_geracao": geracao,
        "vagas": sum(1 for m in meta.values() if eleito(m)),
        "agremiacoes": [
            {
                "cod": cod,
                "rotulo": (
                    meta[sqs[0]]["SG_FEDERACAO"]
                    if cod.startswith("F")
                    else meta[sqs[0]]["SG_PARTIDO"]
                ),
                "legenda": sum(legenda[p] for p in partidos[cod]),
                "candidatos": sorted(([int(s), votos[s]] for s in sqs), key=lambda x: -x[1]),
            }
            for cod, sqs in grupos.items()
        ],
        "eleitos_tse": sorted(int(s) for s, m in meta.items() if eleito(m)),
        "eleitos_por_qp_tse": sorted(
            int(s) for s, m in meta.items() if m["DS_SIT_TOT_TURNO"] == "ELEITO POR QP"
        ),
    }


def _argumentos(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument(
        "--cargo",
        type=int,
        required=True,
        choices=CARGOS_PROPORCIONAIS,
        help="código TSE do cargo proporcional: 6 (federal), 7 (estadual), 8 (distrital)",
    )
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    cargo = _argumentos(argv).cargo
    esperado_total = total_cadeiras(cargo)
    esperadas_ufs = set(ufs_do_cargo(cargo))
    saida = saida_do_cargo(cargo)

    if not DIR_CAND.exists() or not DIR_PART.exists():
        print(f"[golden] datasets ausentes em {DIR_CAND} / {DIR_PART}", file=sys.stderr)
        print("[golden] baixe em https://dadosabertos.tse.jus.br/dataset/resultados-2022", file=sys.stderr)
        return 1

    ufs: dict[str, dict] = {}
    geracoes: set[str] = set()
    for caminho in sorted(DIR_CAND.glob("*_2022_??.csv")):
        if caminho.stem.endswith("_BR"):
            continue
        dados = _uf(caminho, str(cargo))
        if dados is None:
            continue
        geracoes.add(dados.pop("_geracao"))
        ufs[caminho.stem[-2:]] = dados

    vagas = sum(u["vagas"] for u in ufs.values())
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(
        json.dumps(
            {
                "_nota": (
                    "Gabarito = DS_SIT_TOT_TURNO do TSE, não reconstrução nossa. "
                    "Gerado por scripts/build-cadeiras-golden.py. "
                    f"DT_GERACAO dos CSVs: {sorted(geracoes)}."
                ),
                "ufs": ufs,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(
        f"[golden] cargo {cargo} · {len(ufs)} UFs · {vagas} vagas · "
        f"{saida.stat().st_size / 1024:.0f} KB → {saida}"
    )
    print(f"[golden] DT_GERACAO dos CSVs do TSE: {sorted(geracoes)}")
    falhou = False
    if vagas != esperado_total:
        print(f"[golden] ⚠️ esperado {esperado_total} vagas, veio {vagas}", file=sys.stderr)
        falhou = True
    if set(ufs) != esperadas_ufs:
        print(
            f"[golden] ⚠️ UFs do cargo {cargo}: faltam {sorted(esperadas_ufs - set(ufs))}, "
            f"sobram {sorted(set(ufs) - esperadas_ufs)}",
            file=sys.stderr,
        )
        falhou = True
    return 2 if falhou else 0


if __name__ == "__main__":
    raise SystemExit(main())
