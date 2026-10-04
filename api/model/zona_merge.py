"""
api/model/zona_merge.py

Soma em memória dos pares `(município, zona)` de volta à **zona** — a unidade
do estimador (ADR-0021/0023, decisão E5 do plano de 11/09).

Por que existe
--------------
A partir da migration 0006 (ADR-0035 D1) o TSE é ingerido por **par**
`(uf, cod_municipio_tse, cod_zona)`: o EA20 de zona é publicado um arquivo por
par, e 62,5 % das zonas cobrem de 2 a 8 municípios
(`docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md`). `snapshots`
passou a ter uma linha por par.

O **modelo não muda**: a unidade continua sendo a zona e os estratos continuam
sendo por porte de zona (ADR-0021/0023). Logo, entre `fetch_snapshots` e o
estimador é preciso recompor a zona somando seus pares. É o que este módulo faz
— **em memória, nunca persistido** (constituição § 1: o dado cru do TSE fica
intocado; § 6: todo valor é reproduzível a partir do snapshot + código).

Contrato
--------
`merge_pairs_into_zonas(rows)` recebe as linhas devolvidas por
`fetch_snapshots` (dicts com `uf`, `cod_municipio_tse`, `cod_zona`,
`pct_apurado`, `payload`) e devolve **uma linha por `(uf, cod_zona)`**, no
mesmo formato — nada a jusante muda.

Três casos:

1. **Zona com 1 par** → a linha é devolvida **inalterada** (o mesmo objeto; o
   payload não é reconstruído, byte a byte idêntico). É o caso das fixtures de
   replay 2022, que têm uma linha por zona — por isso o gate OT-4 não se move.
2. **Zona com N pares** → envelope EA20 **sintético** com a soma dos campos
   aditivos (ver `_E_ADITIVOS`/`_V_ADITIVOS`/`_S_ADITIVOS`) e `cand[].vap`
   somado por `cand[].n` (o número do candidato é a chave; candidato ausente em
   um par conta 0 lá).
3. **Par sentinela** (`cod_municipio_tse = 0`, gravado por alvos de nível
   `uf`/`br`) → descartado quando a zona tem par real, mesmo padrão de
   `_discard_zero_zona_sentinel_when_real_zonas_exist` em `project.py`. Zona que
   só tem o sentinela mantém o sentinela (é o único dado disponível).

Exceção declarada — o exterior (`ZZ`, ADR-0045 item 5)
------------------------------------------------------
No exterior, as ~186 localidades (embaixadas, consulados) compartilham a zona
`0001`. Pela regra acima viram UMA unidade e o bootstrap degenera para
intervalo de largura zero — afirmação de certeza vedada pela constituição § 6.
Só para `uf = "ZZ"`, a chave de agrupamento passa a ser `cod_zona :=
cod_municipio_tse` (`chave_de_zona`), de modo que cada localidade é uma unidade
e a linha de saída carrega esse `cod_zona`. A MESMA chave é a do `GROUP BY` do
eleitorado em `project.fetch_eleitorado`, e é isso que casa peso com leitura.
Nenhuma outra UF é afetada (teste próprio em `test_exterior_zz.py`); o par
sentinela (`cod_municipio_tse = 0`) do exterior não é reescrito.

Campos derivados
----------------
- `psa` (`s.psa`, % de seções apuradas) e o `pct_apurado` da linha:
  `100 · Σsa / Σsi`. Quando `s.si` falta em algum par, cai para a **média
  ponderada por `e.te`** dos `psa` de cada par e registra um log `warn`.
- `pvap`/`pvapn` de cada candidato: recalculados como `100 · Σvap / Σvvc`
  (definição oficial — percentual sobre votos a votáveis concorrentes, ver
  `_extract_zone_candidate_pcts`). Sem `Σvvc > 0`, ficam como estavam.

Campos **não aditivos ou desconhecidos** (percentuais `p*` fora os acima,
metadados de envelope como `dg`/`hg`/`idg`/`cdabr`, nomes, `sqcand`, …) são
**preservados do par de maior `e.te`** — o par dominante da zona. É uma escolha
deliberada: reescrevê-los exigiria uma regra de agregação que o dicionário do
TSE não define, e nenhum deles é lido pelo pipeline (o modelo lê `e.*`, `v.*`,
`s.psa` e `cand[].vap` — todos somados aqui). Empate de `e.te` resolve pelo
primeiro par na ordem de entrada.

Determinismo (§ 6)
------------------
A soma é comutativa: permutar a ordem de entrada não muda **nenhum valor**
devolvido. A **ordem** das linhas de saída segue a primeira aparição de cada
zona na entrada — preservada de propósito, porque `compute_uf_projections`
monta o vetor de zonas nessa ordem e o bootstrap reamostra índices desse vetor;
reordenar aqui mudaria os sorteios (e, com eles, o gate OT-4) sem mudar o
método.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from api.model.cargos import UF_EXTERIOR

# Mesmo formato de linha de `project.fetch_snapshots` (dict solto).
SnapshotRow = dict[str, Any]

# ---------------------------------------------------------------------------
# Logging — JSON-line, espelha `_log` de project.py (importar de lá criaria
# import circular: project.py importa este módulo).
# ---------------------------------------------------------------------------

_logger = logging.getLogger("api.model.zona_merge")
if not _logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(_h)
    _logger.setLevel(logging.INFO)


def _log(level: str, msg: str, **ctx: Any) -> None:
    payload = {"level": level, "msg": msg, **ctx}
    _logger.info(json.dumps(payload, default=str))


# ---------------------------------------------------------------------------
# Campos aditivos do EA20 (contagens absolutas — `lib/tse/ea20-schema.ts`)
# ---------------------------------------------------------------------------

# `e` (eleitores). Percentuais (`pc`, `pa`, `pest`, …) NÃO entram.
_E_ADITIVOS = ("te", "est", "esnt", "esi", "esni", "esa", "esna", "c", "a")

# `v` (votos). `tv` = vb+vn+vnt+van+vansj+vv; todos são contagens.
_V_ADITIVOS = (
    "tv",
    "vvc",
    "vv",
    "vnom",
    "vl",
    "van",
    "vansj",
    "vb",
    "tvn",
    "vn",
    "vnt",
    "vscv",
    "vsan",
)

# `s` (seções). `psa`/`pst`/`psi`/… são percentuais — tratados à parte.
_S_ADITIVOS = ("ts", "st", "snt", "si", "sni", "sa", "sna")


def _num(raw: Any) -> float | None:
    """Número do EA20 (string BR ou já numérico) → float. `None` se ausente
    ou inválido — nunca levanta.

    Cópia byte-a-byte de `project._parse_br_number` (importar de `project`
    aqui seria circular: `project` importa este módulo). Mantida idêntica de
    propósito — se o TSE algum dia publicar separador de milhar, os dois
    parsers têm de mudar juntos, senão o total da zona divergiria do total do
    par lido pelo mesmo pipeline.
    """
    if raw is None:
        return None
    try:
        if isinstance(raw, str):
            return float(raw.replace(",", "."))
        return float(raw)
    except (TypeError, ValueError):
        return None


def _fmt_int(x: float) -> str:
    """Contagem somada → string de dígitos, o formato em que o TSE publica
    contagens no EA20 (sem separador de milhar)."""
    return str(int(round(x)))


def _fmt_pct_br(x: float, casas: int = 2) -> str:
    """Percentual → string BR (vírgula decimal), como o TSE publica."""
    return f"{x:.{casas}f}".replace(".", ",")


def _te_of(row: SnapshotRow) -> float:
    """`e.te` (eleitorado total) do par — critério de "par dominante"."""
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return 0.0
    e = payload.get("e")
    if not isinstance(e, dict):
        return 0.0
    return _num(e.get("te")) or 0.0


def _cargos(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    carg = payload.get("carg")
    return [c for c in carg if isinstance(c, dict)] if isinstance(carg, list) else []


def _sum_group(
    payloads: list[dict[str, Any]], grupo: str, campos: tuple[str, ...]
) -> dict[str, str] | None:
    """Soma os campos aditivos de um grupo de raiz (`e`, `v` ou `s`).

    Campo ausente em um par conta 0. Campo ausente em TODOS os pares não é
    emitido (não inventamos um zero onde o TSE não publicou nada).
    """
    presentes: dict[str, float] = {}
    for p in payloads:
        g = p.get(grupo)
        if not isinstance(g, dict):
            continue
        for campo in campos:
            v = _num(g.get(campo))
            if v is None:
                continue
            presentes[campo] = presentes.get(campo, 0.0) + v
    if not presentes:
        return None
    return {campo: _fmt_int(valor) for campo, valor in presentes.items()}


def _psa_merged(rows: list[SnapshotRow]) -> tuple[float, bool]:
    """`psa` da zona = `100 · Σsa / Σsi` (decisão D-g do plano de 11/09).

    Devolve `(psa, usou_fallback)`. Fallback (quando algum par não publica
    `s.si`, ou `Σsi = 0`): média dos `psa` de cada par ponderada por `e.te`.
    """
    soma_sa = 0.0
    soma_si = 0.0
    si_completo = True
    for r in rows:
        payload = r.get("payload")
        s = payload.get("s") if isinstance(payload, dict) else None
        s = s if isinstance(s, dict) else {}
        sa = _num(s.get("sa"))
        si = _num(s.get("si"))
        if si is None:
            si_completo = False
        else:
            soma_si += si
        soma_sa += sa or 0.0

    if si_completo and soma_si > 0:
        return 100.0 * soma_sa / soma_si, False

    # Fallback ponderado por eleitorado do par.
    num = 0.0
    den = 0.0
    for r in rows:
        payload = r.get("payload")
        s = payload.get("s") if isinstance(payload, dict) else None
        s = s if isinstance(s, dict) else {}
        psa = _num(s.get("psa"))
        if psa is None:
            psa = float(r.get("pct_apurado") or 0.0)
        peso = _te_of(r)
        num += psa * peso
        den += peso
    return (num / den if den > 0 else 0.0), True


def _cand_nodes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os dicts de candidato do payload, nos DOIS formatos aceitos pelo
    pipeline (mesmo contrato de `project._iter_cands`):

      - envelope EA20 real: `carg[] → agr[] → par[] → cand[]`;
      - payload achatado legado `{cand: [...]}` (replay 2022 e fixtures
        sintéticas). Não deveria aparecer numa zona multi-par — mas se
        aparecer, somar é melhor que ignorar em silêncio.
    """
    out: list[dict[str, Any]] = []
    cargos = _cargos(payload)
    if cargos:
        for carg in cargos:
            for agr in carg.get("agr") or []:
                if not isinstance(agr, dict):
                    continue
                for par in agr.get("par") or []:
                    if not isinstance(par, dict):
                        continue
                    out.extend(c for c in par.get("cand") or [] if isinstance(c, dict))
        return out
    raiz = payload.get("cand")
    if isinstance(raiz, list):
        out.extend(c for c in raiz if isinstance(c, dict))
    return out


def _vap_por_numero(payloads: list[dict[str, Any]]) -> dict[str, float]:
    """`{numero_do_candidato: Σ vap}` sobre todos os pares da zona.

    A chave é o `cand[].n` **como string crua** do TSE — é o identificador do
    candidato na urna e o que liga o mesmo candidato entre pares.
    """
    out: dict[str, float] = {}
    for p in payloads:
        for cand in _cand_nodes(p):
            n = cand.get("n")
            if n is None:
                continue
            vap = _num(cand.get("vap"))
            if vap is None:
                continue
            out[str(n)] = out.get(str(n), 0.0) + vap
    return out


def _merge_estrutura_candidatos(
    base_payload: dict[str, Any], outros: list[dict[str, Any]]
) -> None:
    """Completa, **in place**, a hierarquia `carg[]→agr[]→par[]→cand[]` do
    payload base com os nós que só existem nos demais pares.

    Necessário porque um candidato pode ter votos num par e não aparecer no
    outro (partido sem candidato naquele município, por exemplo) — a zona tem
    de conhecer a união. Nós novos entram como cópia profunda da origem; o
    `vap` de todos é reescrito depois por `_aplicar_vap`.
    """
    for outro in outros:
        if not _cargos(outro):
            # Payload achatado legado `{cand: [...]}` — sem hierarquia. Só une
            # se o BASE também for achatado; misturar os dois formatos na mesma
            # zona não acontece no pipeline (quem grava é sempre o mesmo) e
            # produziria um envelope híbrido.
            if _cargos(base_payload):
                _log(
                    "warn",
                    "zona_merge: pares com formatos de payload diferentes na "
                    "mesma zona — candidatos exclusivos do par achatado ignorados",
                )
                continue
            raiz_b = base_payload.setdefault("cand", [])
            conhecidos_raiz = {
                str(c.get("n")) for c in raiz_b if isinstance(c, dict)
            }
            for cand_o in outro.get("cand") or []:
                if not isinstance(cand_o, dict):
                    continue
                if str(cand_o.get("n")) in conhecidos_raiz:
                    continue
                raiz_b.append(copy.deepcopy(cand_o))
                conhecidos_raiz.add(str(cand_o.get("n")))
            continue
        for carg_o in _cargos(outro):
            carg_b = _achar_ou_criar(
                base_payload.setdefault("carg", []), carg_o, "cd", "agr"
            )
            for agr_o in carg_o.get("agr") or []:
                if not isinstance(agr_o, dict):
                    continue
                agr_b = _achar_ou_criar(carg_b.setdefault("agr", []), agr_o, "n", "par")
                for par_o in agr_o.get("par") or []:
                    if not isinstance(par_o, dict):
                        continue
                    par_b = _achar_ou_criar(
                        agr_b.setdefault("par", []), par_o, "n", "cand"
                    )
                    cands_b = par_b.setdefault("cand", [])
                    conhecidos = {
                        str(c.get("n")) for c in cands_b if isinstance(c, dict)
                    }
                    for cand_o in par_o.get("cand") or []:
                        if not isinstance(cand_o, dict):
                            continue
                        if str(cand_o.get("n")) in conhecidos:
                            continue
                        cands_b.append(copy.deepcopy(cand_o))
                        conhecidos.add(str(cand_o.get("n")))


def _achar_ou_criar(
    destino: list[Any], origem: dict[str, Any], chave: str, filhos: str
) -> dict[str, Any]:
    """Acha em `destino` o nó com a mesma `chave` de `origem`; se não houver,
    cria uma cópia de `origem` **sem** a lista de `filhos` (que é preenchida
    pelo nível seguinte da recursão) e devolve o nó."""
    alvo = str(origem.get(chave))
    for no in destino:
        if isinstance(no, dict) and str(no.get(chave)) == alvo:
            return no
    novo = {k: copy.deepcopy(v) for k, v in origem.items() if k != filhos}
    novo[filhos] = []
    destino.append(novo)
    return novo


def _aplicar_vap(
    base_payload: dict[str, Any], vap_por_n: dict[str, float], soma_vvc: float
) -> None:
    """Reescreve, in place, `cand[].vap` com a soma da zona e recalcula
    `pvap`/`pvapn` (percentual sobre `v.vvc`) quando `Σvvc > 0`."""
    for cand in _cand_nodes(base_payload):
        n = cand.get("n")
        if n is None or str(n) not in vap_por_n:
            continue
        total = vap_por_n[str(n)]
        cand["vap"] = _fmt_int(total)
        if soma_vvc > 0:
            pct = 100.0 * total / soma_vvc
            if "pvap" in cand:
                cand["pvap"] = _fmt_pct_br(pct, 2)
            if "pvapn" in cand:
                cand["pvapn"] = _fmt_pct_br(pct, 9)


def _merge_um_grupo(uf: str, cod_zona: int, rows: list[SnapshotRow]) -> SnapshotRow:
    """Constrói a linha sintética de uma zona a partir de N ≥ 2 pares."""
    # Par dominante (maior `e.te`, empate pelo primeiro) — doa envelope,
    # metadados e campos não aditivos.
    dominante = max(range(len(rows)), key=lambda i: (_te_of(rows[i]), -i))
    base_row = rows[dominante]
    base_payload_original = base_row.get("payload")
    if not isinstance(base_payload_original, dict):
        # Nenhum payload utilizável — devolve o par dominante intacto.
        _log(
            "warn",
            "zona_merge: par dominante sem payload dict — devolvendo par inalterado",
            uf=uf,
            cod_zona=cod_zona,
            n_pares=len(rows),
        )
        return base_row

    payloads = [r["payload"] for r in rows if isinstance(r.get("payload"), dict)]
    merged_payload = copy.deepcopy(base_payload_original)

    # 1. Campos aditivos de raiz.
    for grupo, campos in (("e", _E_ADITIVOS), ("v", _V_ADITIVOS), ("s", _S_ADITIVOS)):
        somado = _sum_group(payloads, grupo, campos)
        if somado is None:
            continue
        destino = merged_payload.get(grupo)
        if not isinstance(destino, dict):
            destino = {}
            merged_payload[grupo] = destino
        destino.update(somado)

    # 2. `psa` / `pct_apurado`.
    psa, usou_fallback = _psa_merged(rows)
    if usou_fallback:
        _log(
            "warn",
            "zona_merge: s.si ausente em algum par — psa por média ponderada de e.te",
            uf=uf,
            cod_zona=cod_zona,
            n_pares=len(rows),
        )
    s_node = merged_payload.get("s")
    if not isinstance(s_node, dict):
        s_node = {}
        merged_payload["s"] = s_node
    s_node["psa"] = _fmt_pct_br(psa, 2)

    # 3. Candidatos — união da hierarquia + Σ vap (+ pvap recalculado).
    outros = [p for i, p in enumerate(payloads) if p is not base_payload_original]
    _merge_estrutura_candidatos(merged_payload, outros)
    vap_por_n = _vap_por_numero(payloads)
    v_node = merged_payload.get("v")
    soma_vvc = _num(v_node.get("vvc")) if isinstance(v_node, dict) else None
    _aplicar_vap(merged_payload, vap_por_n, soma_vvc or 0.0)

    return {
        "uf": uf,
        # Sentinela `0`: a linha sintética é da ZONA INTEIRA, não de um
        # município — mesma convenção de `snapshots.cod_municipio_tse`.
        "cod_municipio_tse": 0,
        "cod_zona": cod_zona,
        "pct_apurado": psa,
        "payload": merged_payload,
    }


def cod_zona_de_agrupamento(uf: Any, cod_zona: Any, cod_municipio_tse: Any) -> int:
    """`cod_zona` que identifica a UNIDADE de reamostragem da linha.

    Regra geral: o próprio `cod_zona`. **Única exceção, declarada (ADR-0045
    item 5): `uf == "ZZ"`**, onde a unidade é a localidade e a chave vira o
    `cod_municipio_tse`. Sentinela (`cod_municipio_tse <= 0`) mantém o
    `cod_zona` original — não é localidade.

    Ponto ÚNICO da exceção no lado dos snapshots (merge e guarda de sanidade);
    o lado do eleitorado é o `GROUP BY` de `project.fetch_eleitorado`.
    """
    zona = int(cod_zona or 0)
    mun = int(cod_municipio_tse or 0)
    if str(uf) == UF_EXTERIOR and mun > 0:
        return mun
    return zona


def chave_de_zona(row: SnapshotRow) -> tuple[str, int]:
    """`(uf, cod_zona de agrupamento)` de uma linha de `fetch_snapshots`."""
    return (
        str(row.get("uf")),
        cod_zona_de_agrupamento(
            row.get("uf"), row.get("cod_zona"), row.get("cod_municipio_tse")
        ),
    )


def merge_pairs_into_zonas(rows: list[SnapshotRow]) -> list[SnapshotRow]:
    """Soma os pares `(município, zona)` de volta à zona (decisão D-g).

    Entrada: linhas de `fetch_snapshots` (uma por par). Saída: uma linha por
    `(uf, cod_zona)`, no mesmo formato — zona com 1 par sai **inalterada** (o
    mesmo objeto), zona com N pares sai como envelope sintético.

    Ver o docstring do módulo para a regra completa (sentinela, campos
    aditivos, `psa`, campos preservados do par dominante, determinismo).
    """
    grupos: dict[tuple[str, int], list[SnapshotRow]] = {}
    ordem: list[tuple[str, int]] = []
    for r in rows:
        chave = chave_de_zona(r)
        if chave not in grupos:
            grupos[chave] = []
            ordem.append(chave)
        grupos[chave].append(r)

    out: list[SnapshotRow] = []
    n_zonas_merged = 0
    n_sentinelas_descartadas = 0
    for chave in ordem:
        uf, cod_zona = chave
        do_grupo = grupos[chave]
        reais = [r for r in do_grupo if int(r.get("cod_municipio_tse") or 0) > 0]
        if reais and len(reais) < len(do_grupo):
            n_sentinelas_descartadas += len(do_grupo) - len(reais)
        efetivos = reais if reais else do_grupo
        if len(efetivos) == 1:
            unico = efetivos[0]
            if int(unico.get("cod_zona") or 0) != cod_zona:
                # Só o exterior chega aqui (`chave_de_zona`): a linha da
                # localidade passa a carregar a pseudo-zona, para casar com o
                # eleitorado agrupado pela mesma chave. Cópia rasa — o payload
                # continua sendo o mesmo objeto.
                out.append({**unico, "cod_zona": cod_zona})
                continue
            # Identidade — nem o dict nem o payload são reconstruídos.
            out.append(unico)
            continue
        out.append(_merge_um_grupo(uf, cod_zona, efetivos))
        n_zonas_merged += 1

    if n_zonas_merged or n_sentinelas_descartadas:
        _log(
            "info",
            "zona_merge: pares somados em zonas",
            linhas_entrada=len(rows),
            zonas_saida=len(out),
            zonas_multi_municipio=n_zonas_merged,
            sentinelas_descartadas=n_sentinelas_descartadas,
        )
    return out


# ---------------------------------------------------------------------------
# Guarda de sanidade — a premissa da "fatia por município" nunca foi
# verificada contra dado real (plano `perfeito-monte-um-plano-eventual-
# candle.md`, 2026-09-11).
# ---------------------------------------------------------------------------

# Faixa "esperado" para a razão `Σ e.te da zona mesclada / eleitorado da zona`.
# Se a premissa da fatia vale, essa razão deveria rondar 1 — mas o `e.te` do
# EA20 (eleitorado apto NA ELEIÇÃO de 2026) e o `eleitores_aptos` de
# `eleitorado` (cadastro fechado de 2024, `fetch_eleitorado`) nunca vão bater
# byte a byte: há reajuste de dois anos de cadastro, seções que abrem/fecham
# entre pleitos, e o próprio risco já catalogado de `eleitorado` estar
# inflada de forma desigual por UF (`docs/reference/risks.md` — "eleitorado
# inflada em 21,8%", fator até 1,526 em algumas UFs). Por isso o piso do
# "ok" é 0,5, não 0,9: ele absorve a inflação conhecida do lado do
# denominador sem esconder um numerador dobrado.
#
# O teto de violação é 1,8, bem abaixo de 2 (o menor N possível de pares por
# zona multi-município): se os arquivos trazem a zona INTEIRA em vez da
# fatia, `merge_pairs_into_zonas` soma N cópias da mesma zona e a razão salta
# para ~N — 2, 3, ..., até 8. Nenhuma fonte de ruído de cadastro chega a
# quase dobrar o eleitorado apurado; only a estrutura errada do arquivo
# explicaria isso. A faixa 1,5–1,8 fica como zona cinzenta: fora do "ok" mas
# abaixo do "quase certamente multiplicado" — logada como warn para
# acompanhar, sem contar como violação confirmada no agregado do ciclo.
_RATIO_OK_MIN = 0.5
_RATIO_OK_MAX = 1.5
_RATIO_VIOLACAO = 1.8


def check_zona_merge_sanity(
    raw_rows: list[SnapshotRow],
    merged_rows: list[SnapshotRow] | None,
    eleitorado: dict[tuple[str, int], int],
) -> int:
    """Guarda de sanidade: a premissa de que o EA20 de zona publica só a
    **fatia** do município (`docs/reference/tse-2026-leiautes.md`) nunca foi
    confirmada contra dado real do TSE — ver
    `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:118-123` (o
    nome do arquivo exige um município) e
    `tse_docs/txt/apresentacao-interessados-2026.txt:195-200` (6.083 arquivos
    de zona por cargo, não ~2.619 zonas reais) contra a descrição de
    conteúdo do próprio EA20 ("na abrangência da zona eleitoral", sem
    qualificar). **O simulado de 15/09 é onde essa dúvida se resolve** —
    até lá, esta função é a rede de segurança que torna a violação da
    premissa ruidosa em vez de silenciosa.

    Se a premissa for falsa (o arquivo por par já traz a zona inteira),
    `merge_pairs_into_zonas` soma N cópias da mesma zona — o eleitorado
    apurado (`e.te`) da zona mesclada vira ~N vezes o eleitorado real dela.
    Comparamos contra `eleitorado` (`fetch_eleitorado`, agregado por
    `(uf, cod_zona)`) — é o mesmo dado usado como peso do estimador, então
    a comparação é barata e não introduz nenhuma fonte nova.

    Só examina zonas com **mais de um par efetivo** (sentinela descartada
    quando há par real, mesmo critério de `merge_pairs_into_zonas`) — zona
    de par único não pôde ter sido multiplicada por este código. Zona sem
    eleitorado conhecido é ignorada (sem dado, sem falso positivo).

    Não aborta o ciclo (constituição § 7 — degradar é melhor que ficar mudo
    na noite da apuração): cada violação vira um `_log("error", ...)`
    estruturado com UF, zona, nº de pares e a razão medida; o retorno é a
    contagem agregada, para o chamador logar um resumo do ciclo e, se
    configurado, acionar o alerta Slack.

    Devolve o número de zonas em estado de **violação confirmada**
    (`razao >= 1.8`). Zonas na faixa cinzenta (`1.5 <= razao < 1.8`) geram
    um log `warn` mas não entram nessa contagem.

    **`merged_rows=None` — o modo do cargo proporcional (2026-09-13).** O
    ramo do cargo 6 não chama `merge_pairs_into_zonas`: lê `fetch_snapshots`
    direto e soma os pares em `api.model.deputado.combinar_entradas`. Até o
    ADR-0036 isso não expunha nada — o cargo vinha em granularidade UF, um
    arquivo por estado, e não havia o que somar. Depois dele, passou a somar
    ~6.110 pares **sem guarda nenhuma**, enquanto os outros três cargos
    gritavam; o ADR chegou a afirmar por escrito que a trava vinha junto, o
    que era falso (corrigido em 13/09).

    Com `merged_rows=None`, `te_somado` é calculado somando `e.te` dos
    próprios pares do grupo. É **idêntico** ao valor que sairia do merge —
    `te` está em `_E_ADITIVOS`, ou seja, `merge_pairs_into_zonas` faz
    exatamente essa soma — então os dois modos medem a mesma coisa, com os
    mesmos limiares e a mesma semântica de log. Uma guarda só, dois
    chamadores: duas implementações divergiriam com o tempo, e é o tipo de
    divergência que só aparece na noite em que ela importa.
    """
    grupos: dict[tuple[str, int], list[SnapshotRow]] = {}
    for r in raw_rows:
        chave = chave_de_zona(r)
        grupos.setdefault(chave, []).append(r)

    # As linhas MESCLADAS já carregam o `cod_zona` de agrupamento (a
    # pseudo-zona do exterior, ADR-0045) — a chave delas é a própria.
    merged_by_key: dict[tuple[str, int], SnapshotRow] = (
        {(str(r.get("uf")), int(r.get("cod_zona") or 0)): r for r in merged_rows}
        if merged_rows is not None
        else {}
    )

    n_violacoes = 0
    for chave, pares in grupos.items():
        uf, cod_zona = chave
        reais = [r for r in pares if int(r.get("cod_municipio_tse") or 0) > 0]
        efetivos = reais if reais else pares
        n_pares = len(efetivos)
        if n_pares <= 1:
            continue

        eleitores_zona = eleitorado.get(chave)
        if not eleitores_zona:
            continue

        if merged_rows is None:
            # Modo proporcional: não há linha mesclada — soma `e.te` dos pares
            # do grupo, que é o que o merge produziria (`te` é aditivo).
            te_somado: float | None = sum(_te_of(r) for r in efetivos)
        else:
            merged = merged_by_key.get(chave)
            if merged is None:
                continue
            payload = merged.get("payload")
            e_node = payload.get("e") if isinstance(payload, dict) else None
            te_somado = _num(e_node.get("te")) if isinstance(e_node, dict) else None
        if te_somado is None or te_somado <= 0:
            continue

        razao = te_somado / eleitores_zona
        if _RATIO_OK_MIN <= razao <= _RATIO_OK_MAX:
            continue

        ctx = dict(
            uf=uf,
            cod_zona=cod_zona,
            n_pares=n_pares,
            razao=round(razao, 3),
            te_zona_somado=te_somado,
            eleitorado_zona=eleitores_zona,
        )
        if razao >= _RATIO_VIOLACAO:
            n_violacoes += 1
            _log(
                "error",
                "zona_merge_sanity: razão te-somado/eleitorado compatível com "
                "zona inteira somada N vezes — premissa da fatia por "
                "município parece violada (ver docstring de "
                "check_zona_merge_sanity)",
                **ctx,
            )
        else:
            _log(
                "warn",
                "zona_merge_sanity: razão te-somado/eleitorado fora da faixa "
                "esperada mas abaixo do limiar de violação confirmada — "
                "observar, não conta no agregado do ciclo",
                **ctx,
            )

    return n_violacoes
