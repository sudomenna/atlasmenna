"""api/model/extrapolation.py

Projeção de candidatos por REGRA DE TRÊS POR ZONA — RF-011/012/013 (spec
002-modelo-estatistico), plano `tem-um-erro-eu-velvety-sprout.md` § A,
decisões E1-E4 fechadas com o usuário em 2026-09-05.

Por que este módulo, e não uma extensão de `turnout.py`:
  Semânticas diferentes. `turnout.py` faz MÉDIA PONDERADA de taxas por
  zona (cada zona contribui uma fração já calculada, ponderada por
  `weight`). Aqui fazemos RAZÃO DE SOMAS de contagens absolutas
  extrapoladas — cada zona contribui contagens brutas escaladas por
  `k(z) = te/esi`, e o share da UF sai de Σ(numeradores)/Σ(denominadores),
  não de uma média. Módulo IRMÃO, não generalização — reusa só os
  helpers de escala/clip de `turnout.py` (`_frac_to_pct`, `_clip01`) e os
  casos de borda de `edge_cases.py` (RF-017/018).

Decisão do usuário (E1, 2026-09-05): 2022 SAI da projeção de candidatos.
Este módulo não importa `historical_results`, não conhece `pct_validos`
2022, não faz swing. A projeção nasce inteiramente do que a própria UF
já apurou no ciclo 2026 — "a partir do que cada zona já apurou,
projetamos o total daquela zona e somamos".

Notação por zona (EA20 + `w` = aptos 2026 da tabela `eleitorado`):
  te   = eleitores aptos da zona (EA20 `e.te`)
  esi  = eleitores das seções instaladas (EA20 `e.esi`)
  c    = comparecimento (EA20 `e.c`)
  vvc  = votos a votáveis concorrentes (EA20 `v.vvc`) — base "votáveis"
         (RÓTULO OBRIGATÓRIO: nunca "válidos" — ADR-0018/EA20 são
         explícitos que `vvc` != `vv`)
  vv   = votos válidos (EA20 `v.vv`) — carregado por completude no tipo
         `ZonaCandidatos`, não usado nas fórmulas abaixo (Fase 1)
  vap_c = votos absolutos do candidato `c` na zona (EA20
         `carg[].agr[].par[].cand[].vap`)

Fator de escala da zona: `k(z) = te/esi` — "se `esi` eleitores já têm
seção instalada e resultaram em `c` comparecimentos, o total `te`
eleitores da zona deveria produzir aproximadamente `c*k` comparecimentos
e `vap_c*k` votos para o candidato `c`" (regra de três literal).

Zona APURADA <=> `esi > 0 E vvc > 0 E w > 0` — caso contrário a zona
entra no balde "não apurada" (E3, ver `estimate_uf_candidatos`).

Duas bases (E2/E2b — um botão alterna as duas, tela abre em "votaveis"):
  - "votaveis"       -> denominador `vvc*k` (default).
  - "comparecimento" -> denominador `c*k` (candidatos + brancos + nulos =
    100%, resíduo = anulados/sub judice).
`V_c(z) = vap_c*k` é O MESMO nas duas bases — só o denominador muda.

UF (zonas apuradas `A`):
  s_v_c = SomaV_c / SomaB_v      (share votaveis, PROJETADO)
  s_c_c = SomaV_c / SomaB_c      (share comparecimento, PROJETADO)
  pct_atual_v = Soma(vap_c) / Soma(vvc)   (LITERAL, sem k)
  pct_atual_c = Soma(vap_c) / Soma(c)     (LITERAL, sem k)

E3 — zonas NÃO apuradas usam a proporção observada nas zonas apuradas da
MESMA UF (hierárquico — `impute_uf_from_national` cobre o próximo nível,
UF inteira sem nenhuma zona apurada):
  r_v = SomaB_v(A) / SomaTe(A)   (taxa de conversão eleitor apto -> base votável)
  B_v(z) = te(z) * r_v            (para z fora de A)
  V_c(z) = s_v_c * B_v(z)         (share da UF aplicado ao volume imputado)

Algebricamente o share da UF (`s_v_c`/`s_c_c`) NÃO MUDA com a imputação
— só os totais absolutos crescem (RF-013: total nacional completo desde
o 1o ciclo). Fórmula fechada usada abaixo (evita loop por zona
não-apurada):
  B_v(U) = SomaB_v(A) * (SomaTe(TODAS) / SomaTe(A))
  B_c(U) = SomaB_c(A) * (SomaTe(TODAS) / SomaTe(A))   (mesmo fator de escala)

Incerteza — um UNICO bootstrap por UF (não um por candidato, não um por
base): `idx = default_rng(seed).integers(0, k_A, (n_resamples, k_A))`
sorteado sobre as zonas APURADAS (as imputadas são constantes — entrariam
encolhendo artificialmente o CI). O MESMO `idx` reamostra todos os
candidatos e as duas bases -> arrays pareados de verdade (com 2
candidatos e sem sobra de votos, `est_a + est_b == 1` elementwise, por
construção algébrica).

Determinismo (constituição § 6): `np.random.default_rng(seed)` sempre —
nunca `np.random.seed()` global. `seed` é responsabilidade do CALLER
(`project.py::compute_uf_projections`, mesmo padrão de `local_seed`).

Casos de borda:
  - Nenhuma zona apurada na UF -> `estimate_uf_candidatos` retorna
    `None`. Cargo 1 (presidente/nacional): caller recorre a
    `impute_uf_from_national` (E3 hierárquico, 2o nível — RF-017).
    Cargo 3 (governador): não existe "nacional" por corrida estadual —
    caller OMITE a UF ("aguardando projeção").
  - `pct_apurado_uf < 5` -> CI inflado 1.5x nas DUAS bases via
    `edge_cases.inflate_ci_low_apurado` (RF-018), reusado tal qual.

Cobre: RF-011 (fator de escala `k`), RF-012 (razão de somas, duas
bases), RF-013 (E3 hierárquico) — spec 002-modelo-estatistico (redação
pendente, Fase 0 do plano — fora do escopo desta tarefa).
"""

from __future__ import annotations

from typing import Any, TypedDict

import numpy as np

from api.model.edge_cases import inflate_ci_low_apurado, inflate_ci_zero_apurado
from api.model.turnout import _clip01, _frac_to_pct, _votos_por_eleitor_valido

# ---------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------


class ZonaCandidatos(TypedDict):
    """Contagens absolutas de uma zona — EA20 (`e`/`v` de raiz + `cand[].vap`)
    + `weight` (eleitores aptos 2026, tabela `eleitorado`, RF-008).

    Extraído por `api.model.project._extract_zone_candidatos` — espelha
    `ZonaParticipacaoRaw`/`ZonaParticipacao` de `turnout.py`, mas com
    `votos` (dict candidato -> `vap`) no lugar dos agregados de
    participação já prontos.

    `validos` (EA20 `v.vv`) é carregado por completude — não participa
    de nenhuma fórmula de `estimate_uf_candidatos`. A identidade exata de
    brancos/nulos da Fase 5 (plano § A) usa `brancos + nulos` sobre a base
    COMPARECIMENTO, não `vv`: `vv` é uma terceira base, e somar `vv` com
    shares em base comparecimento misturaria denominadores.
    """

    cod_zona: int
    weight: int
    eleitores_aptos: int
    eleitores_instalados: int
    comparecimento: int
    votaveis: int
    validos: int
    brancos: int
    nulos: int
    votos: dict[int, int]


class CandidatoEstimate(TypedDict):
    """Resultado por candidato — as DUAS bases (E2), percentuais em
    escala 0-100 (mesma convenção de `project.py::_frac_to_pct`).
    `estimates_*` ficam em fração [0,1] (espaço do bootstrap) — reusados
    por `project.py` sem recomputar (contrato de `estimates_by_uf`)."""

    pct_atual_votaveis: float | None
    pct_projetado_votaveis: float
    lower_votaveis: float
    upper_votaveis: float
    pct_atual_comparecimento: float | None
    pct_projetado_comparecimento: float
    lower_comparecimento: float
    upper_comparecimento: float
    votos_atuais: int
    votos_projetados: int
    estimates_votaveis: np.ndarray
    estimates_comparecimento: np.ndarray


class UfCandidatosEstimate(TypedDict):
    por_candidato: dict[int, CandidatoEstimate]
    n_zonas: int
    n_zonas_imputadas: int
    base_votaveis_projetada: int
    base_comparecimento_projetada: int
    # Σ comparecimento OBSERVADO nas zonas apuradas (sem `k`, sem
    # extrapolação), **na unidade de VOTO do cargo** (`e.c ×
    # votos_por_eleitor` — o dobro das pessoas no Senado de 2026, spec 022
    # RF-210; igual às pessoas nos demais) — é o denominador bruto de `pct_atual` de
    # brancos/nulos, e é o `den` que `turnout.aggregate_national_
    # participacao` soma UF a UF para o `pct_atual` nacional. Fica `0`
    # numa UF imputada (`impute_uf_from_national`), que por definição não
    # observou nada.
    comparecimento_observado: int
    # Fase 5 (plano § A): brancos/nulos no MESMO `idx` do bootstrap acima
    # — identidade exata `Σ share_comp + bn = 1` resample a resample.
    # `None` só quando não há o que observar (UF imputada do nacional).
    brancos_nulos_comparecimento: CandidatoEstimate | None


# ---------------------------------------------------------------------------
# Estimativa por UF (regra de três + bootstrap de zonas apuradas)
# ---------------------------------------------------------------------------


def _is_apurada(z: ZonaCandidatos) -> bool:
    """Zona apurada <=> `esi > 0 E vvc > 0 E weight > 0` (plano § A)."""
    return (
        z.get("eleitores_instalados", 0) > 0
        and z.get("votaveis", 0) > 0
        and z.get("weight", 0) > 0
    )


def estimate_uf_candidatos(
    zonas: list[ZonaCandidatos],
    pct_apurado_uf: float,
    seed: int,
    n_resamples: int = 1000,
    estrato_by_cod_zona: dict[int, int] | None = None,
    te_total_by_estrato: dict[int, float] | None = None,
    *,
    votos_por_eleitor: int = 1,
) -> UfCandidatosEstimate | None:
    """Projeta candidatos de uma UF por regra de três + bootstrap de zonas.

    Args:
        zonas: TODAS as zonas da UF com dado parseável (`_extract_zone_
            candidatos` já devolveu não-`None` para elas — `eleitores_
            aptos > 0` garantido, fail-safe herdado de `_extract_zone_
            participacao`). Zonas com `esi <= 0 OU votaveis <= 0 OU
            weight <= 0` entram no balde "não apurada" (E3) — NÃO são
            descartadas, são IMPUTADAS a partir das zonas apuradas da
            própria UF.
        pct_apurado_uf: percentual apurado da UF em [0, 100] — RF-018.
        seed: determinístico, DERIVADO PELO CALLER de `(uf, "candidatos")`
            (mesmo padrão de `local_seed` em `project.py`).
        n_resamples: default 1000 (paridade com `turnout.py`/`bootstrap.py`).
        estrato_by_cod_zona: pós-estratificação por porte de zona (tercis
            de `te` a priori, ver `project.py::_compute_estratos_por_uf`)
            — `None` (default) preserva o comportamento ORIGINAL,
            byte-a-byte (nenhum sorteio adicional é consumido do `rng`).
            Quando fornecido, `{cod_zona: 0|1|2}` classifica CADA zona da
            UF (apurada ou não) — construído a partir de TODAS as zonas
            conhecidas em `eleitorado`, não apenas as que já reportaram
            (é isso que fixa o peso de cada estrato a priori e mata o
            viés de composição — zonas grandes reportam primeiro, mas o
            peso do estrato "grande" não cresce por causa disso).
        te_total_by_estrato: `{estrato: Σte_apriori}` — peso a priori de
            cada estrato (soma de `eleitorado` sobre TODAS as zonas do
            estrato, apuradas ou não). Share da UF = média dos shares por
            estrato ponderada por este peso (RF-013 estendido — estrato
            sem nenhuma zona apurada cai para a proporção da UF inteira,
            mesma hierarquia já usada para zona individual).
        votos_por_eleitor: votos que cada eleitor deposita no cargo (2 no
            Senado de 2026 — `cargos.votos_por_eleitor`). Multiplica SÓ a
            base "comparecimento" (`c*k`), que é a única base em PESSOAS: os
            numeradores (`vap`, `brancos + nulos`) e a base "votáveis"
            (`vvc`) já vêm em VOTOS do TSE. Sem o fator, medido nas capturas
            reais de Senador (`tests/fixtures/tse/2026-sim/senado/`), a soma
            dos shares "comparecimento" dos candidatos dava 184–188% e
            brancos+nulos 11,8–15,1% (o dobro do real). Com ele, a identidade
            da Fase 5 (`Σ_c share_comp + bn + anulados == 1`) volta a valer
            no Senado como vale nos outros cargos. `1` é o valor dos cargos
            de voto único; o chamador de produção
            (`project.py::compute_uf_projections`) o passa sempre, explícito.
            A base "votáveis" — e portanto `estimates_votaveis`, `p_vitoria`,
            `p_eleito` e `votos_projetados` — NÃO muda.

    Returns:
        `None` se NENHUMA zona estiver apurada — caller decide o
        fallback (`impute_uf_from_national` para cargo 1; omitir a UF
        para cargo 3, que não tem "nacional").
    """
    apuradas = [z for z in zonas if _is_apurada(z)]
    if not apuradas:
        return None
    vpe = float(_votos_por_eleitor_valido(votos_por_eleitor))

    k_a = len(apuradas)
    te_a = np.array([float(z["eleitores_aptos"]) for z in apuradas])
    esi_a = np.array([float(z["eleitores_instalados"]) for z in apuradas])
    # Base "comparecimento" em VOTOS (`e.c × votos_por_eleitor`, == `v.tv`
    # nas capturas do TSE): ver o argumento `votos_por_eleitor`. Com `vpe ==
    # 1.0` a multiplicação é exata em ponto flutuante — os cargos de voto
    # único saem bit a bit iguais ao que saíam antes.
    c_a = np.array([float(z["comparecimento"]) for z in apuradas]) * vpe
    vvc_a = np.array([float(z["votaveis"]) for z in apuradas])

    # esi_a > 0 garantido por `_is_apurada` — divisão direta é segura.
    k_arr = te_a / esi_a
    bv_arr = vvc_a * k_arr
    bc_arr = c_a * k_arr

    sum_bv = float(bv_arr.sum())
    sum_bc = float(bc_arr.sum())
    sum_vvc = float(vvc_a.sum())
    sum_c = float(c_a.sum())

    # E3 — fator de escala fechado para as zonas NÃO apuradas (o share da
    # UF não muda com a imputação; só o volume absoluto).
    nao_apuradas = [z for z in zonas if not _is_apurada(z)]
    sum_te_a = float(te_a.sum())
    sum_te_todas = sum_te_a + sum(
        float(z["eleitores_aptos"]) for z in nao_apuradas
    )
    scale = (sum_te_todas / sum_te_a) if sum_te_a > 0 else 1.0
    base_votaveis_projetada = sum_bv * scale
    base_comparecimento_projetada = sum_bc * scale

    # Candidatos = união dos vistos nas zonas APURADAS (RF-013 — não mais
    # "quem tem 2022", ver docstring do módulo).
    candidatos: set[int] = set()
    for z in apuradas:
        candidatos.update(z["votos"].keys())

    # Bootstrap ÚNICO por UF — o MESMO `idx` reamostra todos os
    # candidatos e as duas bases (pareamento de verdade).
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, k_a, size=(n_resamples, k_a))
    den_v_boot = bv_arr[idx].sum(axis=1)
    den_c_boot = bc_arr[idx].sum(axis=1)

    # --- Pós-estratificação por porte de zona (tercis de `te` a priori) ---
    # `estratificar` fica `False` (e ZERO sorteios extras são consumidos
    # do `rng`) sempre que o caller não passar os dois dicts — garante
    # que o caminho ORIGINAL (sem estratos) permaneça byte-a-byte idêntico
    # ao de antes desta mudança (testes de reprodutibilidade/seed cobrem).
    estratificar = bool(estrato_by_cod_zona) and bool(te_total_by_estrato)
    w_total = 0.0
    strata_boot: dict[int, dict[str, Any]] = {}
    if estratificar:
        assert te_total_by_estrato is not None  # narrows for mypy/type-checkers
        w_total = sum(w for w in te_total_by_estrato.values() if w > 0)
        estratificar = w_total > 0
    if estratificar:
        assert estrato_by_cod_zona is not None
        strata_zone_idx: dict[int, list[int]] = {}
        for i, z in enumerate(apuradas):
            k_estrato = estrato_by_cod_zona.get(z["cod_zona"])
            if k_estrato is None:
                continue
            strata_zone_idx.setdefault(k_estrato, []).append(i)
        for k_estrato, zone_positions in strata_zone_idx.items():
            zone_idx_arr = np.array(zone_positions, dtype=np.int64)
            bv_k = bv_arr[zone_idx_arr]
            bc_k = bc_arr[zone_idx_arr]
            kk = len(zone_positions)
            idx_k = rng.integers(0, kk, size=(n_resamples, kk))
            strata_boot[k_estrato] = {
                "zone_idx_arr": zone_idx_arr,
                "idx_k": idx_k,
                "den_v_boot": bv_k[idx_k].sum(axis=1),
                "den_c_boot": bc_k[idx_k].sum(axis=1),
                "sum_bv": float(bv_k.sum()),
                "sum_bc": float(bc_k.sum()),
            }
        # Nenhuma zona apurada caiu em nenhum estrato conhecido (dado
        # inconsistente) -> desiste da estratificação, mantém o share UF.
        estratificar = bool(strata_boot)

    def _estimate_for(vap_arr: np.ndarray) -> CandidatoEstimate:
        """Estimativa nas DUAS bases para UM numerador por zona apurada.

        `vap_arr` é o vetor de contagens brutas da entidade sendo estimada,
        na MESMA ordem de `apuradas`: os votos de um candidato, ou —
        Fase 5 do plano § A — `brancos + nulos` da zona. Tudo o que é
        comum a todas as entidades (`k_arr`, `idx`, `den_*_boot`, os
        estratos) vem do closure: é **o mesmo sorteio**, e é isso que
        torna a identidade `Σ_c share_comp(c) + share_comp(bn) == 1`
        exata resample a resample, em vez de fechar "em 100 ± 0,3 pp"
        como fechava quando `brancos_nulos` vinha de `turnout.py` com
        seed própria e estimador próprio.

        NÃO consome nada do `rng`: `idx`/`idx_k` já foram sorteados acima.
        Chamar esta função uma vez a mais (para brancos/nulos) portanto
        **não move nenhum número de candidato** — reprodutibilidade
        byte-a-byte preservada (constituição § 6).
        """
        vc_arr = vap_arr * k_arr

        sum_vap = float(vap_arr.sum())
        sum_vc = float(vc_arr.sum())

        # Share/estimativa SEM estratificação — sempre calculado: é o
        # resultado final quando `estratificar` é `False`, E é o fallback
        # RF-013 para qualquer estrato sem nenhuma zona apurada.
        s_v_uf = (sum_vc / sum_bv) if sum_bv > 0 else 0.0
        s_c_uf = (sum_vc / sum_bc) if sum_bc > 0 else 0.0
        pct_atual_v = (sum_vap / sum_vvc) if sum_vvc > 0 else None
        pct_atual_c = (sum_vap / sum_c) if sum_c > 0 else None

        num_boot = vc_arr[idx].sum(axis=1)
        est_v_uf = np.divide(
            num_boot,
            den_v_boot,
            out=np.zeros_like(num_boot),
            where=den_v_boot > 0,
        )
        est_c_uf = np.divide(
            num_boot,
            den_c_boot,
            out=np.zeros_like(num_boot),
            where=den_c_boot > 0,
        )

        if estratificar:
            assert te_total_by_estrato is not None
            point_v_num = 0.0
            point_c_num = 0.0
            boot_v = np.zeros(n_resamples)
            boot_c = np.zeros(n_resamples)
            for k_estrato, w_k in te_total_by_estrato.items():
                if w_k <= 0:
                    continue
                sb = strata_boot.get(k_estrato)
                if sb is not None:
                    vc_k = vc_arr[sb["zone_idx_arr"]]
                    sum_vc_k = float(vc_k.sum())
                    s_v_k = (sum_vc_k / sb["sum_bv"]) if sb["sum_bv"] > 0 else 0.0
                    s_c_k = (sum_vc_k / sb["sum_bc"]) if sb["sum_bc"] > 0 else 0.0
                    num_boot_k = vc_k[sb["idx_k"]].sum(axis=1)
                    p_v_k = np.divide(
                        num_boot_k,
                        sb["den_v_boot"],
                        out=np.zeros(n_resamples),
                        where=sb["den_v_boot"] > 0,
                    )
                    p_c_k = np.divide(
                        num_boot_k,
                        sb["den_c_boot"],
                        out=np.zeros(n_resamples),
                        where=sb["den_c_boot"] > 0,
                    )
                else:
                    # Estrato SEM nenhuma zona apurada (RF-013 estendido):
                    # cai para a proporção (ponto + bootstrap) da UF.
                    s_v_k = s_v_uf
                    s_c_k = s_c_uf
                    p_v_k = est_v_uf
                    p_c_k = est_c_uf
                point_v_num += w_k * s_v_k
                point_c_num += w_k * s_c_k
                boot_v = boot_v + w_k * p_v_k
                boot_c = boot_c + w_k * p_c_k
            s_v = point_v_num / w_total
            s_c = point_c_num / w_total
            est_v = boot_v / w_total
            est_c = boot_c / w_total
        else:
            s_v = s_v_uf
            s_c = s_c_uf
            est_v = est_v_uf
            est_c = est_c_uf

        ci_v = inflate_ci_low_apurado(
            {
                "point": s_v,
                "ci_lower": float(np.percentile(est_v, 2.5)),
                "ci_upper": float(np.percentile(est_v, 97.5)),
            },
            pct_apurado_uf,
        )
        ci_c = inflate_ci_low_apurado(
            {
                "point": s_c,
                "ci_lower": float(np.percentile(est_c, 2.5)),
                "ci_upper": float(np.percentile(est_c, 97.5)),
            },
            pct_apurado_uf,
        )

        point_v = _clip01(ci_v["point"])
        votos_projetados = int(round(point_v * base_votaveis_projetada))

        return {
            "pct_atual_votaveis": (
                _frac_to_pct(pct_atual_v) if pct_atual_v is not None else None
            ),
            "pct_projetado_votaveis": _frac_to_pct(point_v),
            "lower_votaveis": _frac_to_pct(_clip01(ci_v["ci_lower"])),
            "upper_votaveis": _frac_to_pct(_clip01(ci_v["ci_upper"])),
            "pct_atual_comparecimento": (
                _frac_to_pct(pct_atual_c) if pct_atual_c is not None else None
            ),
            "pct_projetado_comparecimento": _frac_to_pct(_clip01(ci_c["point"])),
            "lower_comparecimento": _frac_to_pct(_clip01(ci_c["ci_lower"])),
            "upper_comparecimento": _frac_to_pct(_clip01(ci_c["ci_upper"])),
            "votos_atuais": int(round(sum_vap)),
            "votos_projetados": votos_projetados,
            "estimates_votaveis": np.clip(est_v, 0.0, 1.0),
            "estimates_comparecimento": np.clip(est_c, 0.0, 1.0),
        }

    por_candidato: dict[int, CandidatoEstimate] = {}
    for cod in sorted(candidatos):
        por_candidato[cod] = _estimate_for(
            np.array([float(z["votos"].get(cod, 0)) for z in apuradas])
        )

    # Fase 5 (plano § A, "Coerência das bases (E2)") — brancos + nulos pelo
    # MESMO caminho, com o MESMO `idx`. Antes disto o número vinha de
    # `turnout.py::estimate_uf_participacao` com seed própria E estimador
    # próprio (média de frações por zona ponderada por `weight`, contra a
    # razão de somas escalada por `k` daqui), e o resultado era uma soma que
    # "fechava em 100 ± 0,3 pp" — ou seja, a tela publicava candidatos e
    # brancos/nulos que não somavam o inteiro que a própria tela afirma
    # estar dividindo. Agora:
    #
    #     Σ_c estimates_comparecimento[c][r] + bn[r] == 1   para TODO r
    #
    # exatamente (a menos do épsilon de ponto flutuante), porque numerador e
    # denominador saem do mesmo resample `idx[r]` e o denominador `c*k` é
    # literalmente a soma dos numeradores quando a zona satisfaz
    # `Σ_c vap + brancos + nulos == comparecimento`. O resíduo que sobra
    # quando essa identidade NÃO vale na zona (anulados/sub judice, art. 265
    # §2º da Res. 23.751/2026) é dado do TSE, não erro de amostragem nosso —
    # e agora aparece como resíduo em vez de se misturar com ruído de seed.
    #
    # ⚠️ Os campos `*_votaveis` deste `CandidatoEstimate` existem porque o
    # tipo é compartilhado; para brancos/nulos eles significam "(b+n) sobre
    # a base votáveis", que NÃO é a base que a UI rotula. Só os
    # `*_comparecimento` (e `votos_atuais`/`votos_projetados`, que são
    # contagens absolutas e independem da base) devem ser consumidos — é o
    # que `project.py::_participacao_de_brancos_nulos` lê.
    brancos_nulos = _estimate_for(
        np.array([float(z["brancos"] + z["nulos"]) for z in apuradas])
    )

    return {
        "por_candidato": por_candidato,
        "n_zonas": len(apuradas),
        "n_zonas_imputadas": len(nao_apuradas),
        "base_votaveis_projetada": int(round(base_votaveis_projetada)),
        "base_comparecimento_projetada": int(round(base_comparecimento_projetada)),
        "comparecimento_observado": int(round(sum_c)),
        "brancos_nulos_comparecimento": brancos_nulos,
    }


# ---------------------------------------------------------------------------
# Imputação nacional — E3, 2o nível hierárquico (RF-017)
# ---------------------------------------------------------------------------


def impute_uf_from_national(
    national_shares: dict[int, np.ndarray],
    national_point: dict[int, float],
    w_uf: int,
    r_v_br: float,
) -> UfCandidatosEstimate:
    """RF-017, 2o nível hierárquico (E3): UF SEM NENHUMA zona apurada.

    Só se aplica a cargo 1 (presidente) — existe um "nacional" para
    ancorar a imputação. Cargo 3 (governador) não tem corrida nacional;
    o caller (`project.py::compute_uf_projections`) OMITE a UF em vez de
    chamar esta função ("aguardando projeção").

    `s_c(U) := s_c(BR)` (plano § A): a projeção da UF assume a MESMA
    proporção observada no Brasil até agora — CI +-10pp
    (`inflate_ci_zero_apurado`, RF-017) em vez de bootstrap (não há
    nenhuma zona da própria UF para reamostrar).

    `estimates_votaveis` reusa o array NACIONAL pareado (não gera um
    array constante `np.full(n, point)`) — decisão de desenho desta
    Fase 1: mantém correlação genuína entre todas as UFs 0%-apuradas e o
    nacional (equivalente a "esta UF vota como o resto do país, incerteza
    incluída"), coerente com o pedido do plano ("estimates = array
    nacional pareado").

    Simplificação assumida nesta Fase 1 (reportada no handoff — não há
    contrato prévio que a contradiga): a base "comparecimento" desta UF
    reusa os MESMOS valores/array da base "votaveis", porque
    `compute_national`/`aggregate_national_estimates` só agregam
    estimates em base votável neste ponto do pipeline — não existe um
    "national_point"/"national_shares" equivalente em base comparecimento
    para ancorar separadamente. Preferimos essa aproximação explícita a
    inventar um número sem lastro; refinar quando o nacional também
    agregar estimates em base comparecimento (Fase 5+).

    Args:
        national_shares: `{cod: ndarray}` — estimates nacionais (fração,
            base votáveis), MESMO shape usado pelas demais UFs (garante
            pareamento honesto no cálculo nacional a jusante).
        national_point: `{cod: float}` — ponto oficial nacional (fração),
            centro do CI +-10pp.
        w_uf: eleitorado total da UF (peso) — usado para estimar o volume
            absoluto de votos que a UF deve produzir.
        r_v_br: Σ base_votaveis_projetada(BR) / Σ eleitorado(BR) — taxa
            nacional de conversão eleitor apto -> base votável, usada
            para estimar `base_votaveis_projetada` desta UF SEM depender
            de nenhum dado próprio dela.
    """
    base_votaveis_projetada = w_uf * r_v_br
    por_candidato: dict[int, CandidatoEstimate] = {}
    for cod, point in national_point.items():
        inflated = inflate_ci_zero_apurado(point)
        point_v = _clip01(inflated["point"])
        estimates = national_shares.get(
            cod, np.full(1000, point_v, dtype=np.float64)
        )
        votos_projetados = int(round(point_v * base_votaveis_projetada))
        por_candidato[cod] = {
            "pct_atual_votaveis": None,
            "pct_projetado_votaveis": _frac_to_pct(point_v),
            "lower_votaveis": _frac_to_pct(_clip01(inflated["ci_lower"])),
            "upper_votaveis": _frac_to_pct(_clip01(inflated["ci_upper"])),
            "pct_atual_comparecimento": None,
            "pct_projetado_comparecimento": _frac_to_pct(point_v),
            "lower_comparecimento": _frac_to_pct(_clip01(inflated["ci_lower"])),
            "upper_comparecimento": _frac_to_pct(_clip01(inflated["ci_upper"])),
            "votos_atuais": 0,
            "votos_projetados": votos_projetados,
            "estimates_votaveis": np.clip(estimates, 0.0, 1.0),
            "estimates_comparecimento": np.clip(estimates, 0.0, 1.0),
        }
    return {
        "por_candidato": por_candidato,
        "n_zonas": 0,
        "n_zonas_imputadas": 0,
        "base_votaveis_projetada": int(round(base_votaveis_projetada)),
        "base_comparecimento_projetada": int(round(base_votaveis_projetada)),
        # UF sem NENHUMA zona apurada: não há comparecimento observado e não
        # há brancos/nulos observados. `None`/`0` — nunca um número imputado
        # do nacional, porque brancos/nulos não é o que esta função ancora
        # (ela ancora share de candidato) e publicar um valor aqui afirmaria
        # ter medido participação numa UF que não reportou nada.
        "comparecimento_observado": 0,
        "brancos_nulos_comparecimento": None,
    }


# ---------------------------------------------------------------------------
# Agregação nacional de votos absolutos (RF-014)
# ---------------------------------------------------------------------------


def aggregate_national_votos(
    by_uf: dict[str, UfCandidatosEstimate | None],
) -> tuple[dict[int, int], int]:
    """Σ `votos_projetados` por candidato, UF -> Brasil (RF-014).

    Determinismo (§ 6): soma aritmética pura sobre valores já calculados
    — zero `random` novo aqui.

    Returns:
        `({cod_candidato: total_votos}, total_geral)`.
    """
    totals: dict[int, int] = {}
    grand_total = 0
    for est in by_uf.values():
        if est is None:
            continue
        for cod, cand_est in est["por_candidato"].items():
            v = int(cand_est["votos_projetados"])
            totals[cod] = totals.get(cod, 0) + v
            grand_total += v
    return totals, grand_total
