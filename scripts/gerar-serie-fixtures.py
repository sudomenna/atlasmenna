#!/usr/bin/env python3
"""scripts/gerar-serie-fixtures.py — põe `serie_por_candidato` nas fixtures de simulação.

Uso:
    .venv-model/bin/python3.14 scripts/gerar-serie-fixtures.py
    .venv-model/bin/python3.14 scripts/gerar-serie-fixtures.py --check   # não escreve

Fase 3 da spec 020 / chore 1 da sprint S09.

---------------------------------------------------------------------------
Por que este arquivo existe
---------------------------------------------------------------------------
O gráfico de evolução foi entregue em 18/09 e publicado nas 4 rotas, e
**nunca foi visto com uma linha desenhada em tela nenhuma**. Medido:
`grep -l serie_por_candidato tests/fixtures/simulacao/*.json` devolvia zero
sobre os 9 arquivos. O que `pnpm dev:sim` mostrava era o estado vazio — que
está correto, é a entrega da Fase 0, mas não prova a linha.

É um gerador, não um editor de JSON à mão, por dois motivos: a série precisa
ser **coerente com o placar da mesma fixture** (senão o gráfico e o painel
logo acima discordam na tela, que é o defeito mais confuso possível), e a
Fase 4 vai querer regenerar.

---------------------------------------------------------------------------
As regras que o gerador respeita — todas do contrato do produtor
---------------------------------------------------------------------------
1. **O último ponto é o placar de agora.** `apurado[-1] == pct_atual` e
   `projetado[-1] == pct_projetado`, exatos. É o gate de coerência da S09.
2. **O eixo é a grade de baldes**, não a lista de instantes medidos
   (`EdgeSeriePorCandidato.eixo`) — é o que permite um balde vazio existir.
3. **Balde sem ciclo é `null`, nunca `0`.** A regra dos três estados do dono
   aplicada a um ponto: "não medimos" e "mediu-se zero" são fatos diferentes,
   e colapsá-los desenha um mergulho ao chão que nunca aconteceu. O gerador
   **injeta um furo de propósito** — sem ele, `pnpm dev:sim` nunca exercita
   o RF-175b (a linha que interrompe) e o defeito só apareceria em 04/10.
4. **Elenco = as 4 primeiras que COMPETEM por `rankByParcial`**: `pct_atual`
   desc → `pct_projetado` desc → `id` asc (`lib/utils/rank-parcial.ts`); a
   anulada nunca entra (emenda ao ADR-0053, 27/09). **Não** é o
   rank por `pct_projetado` que o Python calcula — os dois divergem
   justamente quando apurado e projetado discordam.
5. **Ordem do array é contrato** (ADR-0046 D4): o consumidor não reordena.
6. `eixo.length <= SERIE_MAX_PONTOS` (120) e 2 casas decimais
   (`SERIE_CASAS_DECIMAIS`), como `api/model/project.py`.
7. **Determinístico** — sem `random`, sem `now()`. Constituição § 6, e roda
   no CI sem produzir diff espúrio.

---------------------------------------------------------------------------
Governador e Senador: este script escreve a SÉRIE, nunca os municípios
---------------------------------------------------------------------------
🔴 **Mudou em 2026-09-19, e a mudança é o ponto mais perigoso deste arquivo.**

Até esta data os dois arquivos eram RECONSTRUÍDOS do zero aqui, com
`municipios: []` — a proposta escrita na spec 020 (§ Questões em aberto,
item 1), que julgava não valer os ~10 MB de fixture. O dono decidiu o
contrário: `data-pipeline/simulacao-gerar.ts` passou a produzir detalhe
municipal para os três cargos majoritários, porque sem ele
`/uf/<sigla>/governador` e `/uf/<sigla>/senador` não têm mapa em
`pnpm dev:sim` e não há como conferir o conserto do endpoint.

Consequência direta: **reconstruir estes arquivos aqui apagaria ~6 MB de
dado do gerador em silêncio**, e o único sintoma seria o mapa dessas duas
telas voltando a ficar vazio depois de alguém rodar este script. Por isso os
passos 3 e 4 agora fazem o MESMO que o passo 2 sempre fez para o
presidencial: leem o arquivo existente e **acrescentam**
`series_temporais.por_candidato` dentro dele, sem tocar em `municipios`.

O arquivo ausente continua sendo tratado — nasce com `municipios: []`, que
segue sendo um estado legítimo (`municipioDetailReason` o distingue de falha
de leitura). O que não pode acontecer é um arquivo POVOADO virar vazio.

De onde vêm os números de cada corrida, e por que não é a mesma fonte:

  - **Governador** — desde 2026-09-27, `governador-uf.json[uf].candidatos`
    (`cands_gov`), que é o que a página lê desde 21/09. Até então a série
    repetia a junção de `synthesizeGovUfFromFixture` (IDENTIDADE de
    `por_uf[uf].top_candidatos`, NÚMEROS de `national.candidatos`); com a
    emenda ao ADR-0053 os percentuais da UF passaram a ser sobre os votos em
    disputa e o bloco nacional de Governador não, e aquela junção poria na
    série um número que o painel não mostra. Ela segue como fallback, para
    quando o arquivo da UF não existe.
  - **Senador** — `senador-uf.json[uf].candidatos` já traz tudo junto.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parent.parent
FIXTURES = RAIZ / "tests" / "fixtures" / "simulacao"

#: Espelham `api/model/project.py`.
SERIE_MAX_PONTOS = 120
SERIE_CASAS_DECIMAIS = 2

#: Janela e cadência da série gerada. 90 min / 5 min = 18 baldes — bem abaixo
#: do teto de 120, e o bastante para a linha ter forma na tela.
JANELA_MIN = 90
CADENCIA_MIN = 5

#: Índice do balde que fica VAZIO de propósito, para exercitar o RF-175b.
#: Não pode ser o último (quebraria o gate de coerência) nem o primeiro (o
#: furo ficaria invisível na borda).
IDX_FURO = 7

ELENCO_MAX = 4


#: ADR-0053 / RF-213 — destino que NÃO disputa a vaga. Espelha
#: `DESTINO_FORA_DA_DECISAO` de `api/model/project.py`.
DESTINO_ANULADO = "anulado"


def rank_parcial(candidatos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`pct_atual` desc → `pct_projetado` desc → `id` asc, anuladas no fim.

    É `ordensPorBase(...).parcial` de `lib/utils/rank-parcial.ts` — o
    comparador de `rankByParcial` seguido de `anuladasAoFim` — e o mesmo que
    `ordenar_por_parcial` do produtor. Partição estável: `destino != "anulado"`
    compete (sub judice e ausente incluídos), então sem destino na fixture a
    ordem é a de antes.
    """
    ordenados = sorted(
        candidatos,
        key=lambda c: (
            -(c.get("pct_atual") or 0.0),
            -(c.get("pct_projetado") or 0.0),
            c.get("id", 0),
        ),
    )
    return [c for c in ordenados if c.get("destino") != DESTINO_ANULADO] + [
        c for c in ordenados if c.get("destino") == DESTINO_ANULADO
    ]


def _r(x: float) -> float:
    return round(x, SERIE_CASAS_DECIMAIS)


def eixo_de(ts_iso: str, n: int) -> list[str]:
    """Grade regular de `n` baldes terminando no balde de `ts_iso`."""
    fim = datetime.fromisoformat(ts_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    # Ancora no início do balde — o eixo é a grade, não o instante medido.
    fim = fim.replace(second=0, microsecond=0)
    fim -= timedelta(minutes=fim.minute % CADENCIA_MIN)
    return [
        (fim - timedelta(minutes=CADENCIA_MIN * (n - 1 - i))).strftime("%Y-%m-%dT%H:%M:%SZ")
        for i in range(n)
    ]


def coluna(valor_final: float, n: int, semente: int) -> list[float | None]:
    """Série que CONVERGE para `valor_final`, com o último ponto exato.

    A forma imita o que a noite faz de verdade: as primeiras urnas dão um
    número enviesado (poucas zonas, mix geográfico ruim) e ele se aproxima do
    real conforme a apuração avança. O desvio inicial é proporcional ao valor,
    então candidatura grande oscila em pontos absolutos maiores — o que é o
    comportamento real e o que torna a tela legível.

    `semente` só desloca a fase da oscilação para que as 4 linhas não subam
    em paralelo; é determinística, não aleatória.
    """
    out: list[float | None] = []
    for i in range(n):
        if i == IDX_FURO:
            out.append(None)  # 🔴 furo: balde sem ciclo. NUNCA 0.
            continue
        progresso = i / (n - 1)  # 0 → 1
        # Amplitude cai com o progresso; oscilação determinística por semente.
        amplitude = (1.0 - progresso) ** 2 * valor_final * 0.35
        fase = ((i * 7 + semente * 13) % 10) / 10.0 - 0.5
        out.append(_r(max(0.0, valor_final + amplitude * fase * 2)))
    # Cinto e suspensório. Com a fórmula atual esta linha é REDUNDANTE — a
    # amplitude é `(1 - progresso)²` e zera exatamente no último balde, então
    # `coluna()` já converge sozinha. Medido em 18/09 mutando a linha: os
    # testes continuaram verdes, e a conclusão errada seria "o gate não
    # discrimina". Não é o caso — um desvio real de 0,01 no último ponto
    # reprova os dois testes.
    #
    # A linha fica porque a redundância é do ACASO da fórmula, não do desenho:
    # basta alguém trocar `(1 - progresso)²` por algo que não zere no fim para
    # a garantia passar a depender dela. Mutar as duas coisas juntas (amplitude
    # que não some + esta linha removida) reprova, o que é a prova de que ela
    # não é decoração.
    out[-1] = _r(valor_final)
    return out


def serie_de(candidatos: list[dict[str, Any]], ts_iso: str) -> dict[str, Any] | None:
    # 🔴 Decisão do dono (2026-09-27, emenda ao ADR-0053): com anulada no
    # escopo, a linha dela NÃO entra no gráfico — nem quando competem menos de
    # 4 e sobraria vaga. O percentual dela é sobre o `vvc` e o das outras sobre
    # os votos em disputa: desenhar as duas no mesmo eixo compararia bases
    # diferentes. `rank_parcial` segue pondo a anulada no fim (paridade de
    # ORDEM com o produtor); o corte é aqui.
    elenco = [
        c
        for c in rank_parcial([c for c in candidatos if c.get("id") is not None])
        if c.get("destino") != DESTINO_ANULADO
    ][:ELENCO_MAX]
    if not elenco:
        return None

    n = min(JANELA_MIN // CADENCIA_MIN, SERIE_MAX_PONTOS)
    eixo = eixo_de(ts_iso, n)

    saida = []
    for ordem, c in enumerate(elenco):
        item: dict[str, Any] = {
            "id": c["id"],
            "nome": c.get("nome") or f"CANDIDATO {c['id']}",
            # 🔴 A cor da linha sai do PARTIDO, nunca do campo `cor` (ADR-0046 D5).
            "partido": c.get("partido") or "—",
            "apurado": coluna(float(c.get("pct_atual") or 0.0), n, ordem),
            "projetado": coluna(float(c.get("pct_projetado") or 0.0), n, ordem + 5),
        }
        if c.get("sqcand"):
            item["sqcand"] = c["sqcand"]
        saida.append(item)

    return {"eixo": eixo, "cadencia_min": CADENCIA_MIN, "candidatos": saida}


def cands_gov_da_uf(row: dict[str, Any], numeros: dict[Any, dict[str, Any]]) -> list[dict[str, Any]]:
    """Candidaturas de Governador de UMA UF, na junção da tela.

    Mesma junção de `synthesizeGovUfFromFixture`: identidade da UF, números do
    nacional, casados por `id`. Não é o `pct` de `top_candidatos` — esse é
    outro número, e usá-lo faria a série discordar do painel.

    ADR-0053 / RF-213 — o `destino` segue a mesma precedência da tela
    (`daUf?.destino ?? c.destino`): o da linha DA UF primeiro, o do nacional
    como fallback. É ele que manda a anulada para o fim do elenco.
    """
    cands: list[dict[str, Any]] = []
    for t in row.get("top_candidatos") or []:
        n_ = numeros.get(t["id"])
        if n_ is None:
            continue
        c = dict(n_)
        c["nome"] = t.get("nome") or n_.get("nome")
        c["partido"] = t.get("partido") or n_.get("partido")
        if t.get("sqcand"):
            c["sqcand"] = t["sqcand"]
        if t.get("destino"):
            c["destino"] = t["destino"]
        cands.append(c)
    return cands


def cands_gov(
    sigla: str,
    row: dict[str, Any],
    numeros: dict[Any, dict[str, Any]],
    resumos_gov: dict[str, Any],
) -> list[dict[str, Any]]:
    """Candidaturas de Governador de UMA UF — a MESMA lista que a tela mostra.

    🔴 Emenda ao ADR-0053 (opção A, decisão do dono 2026-09-27): com anulada
    publicada na UF, o `pct_atual`/`pct_projetado` de quem compete é sobre os
    votos EM DISPUTA (`vvc − anuladas`) — e o bloco nacional de Governador NÃO
    muda (o número de urna repete entre UFs). Ler os números dele, como
    `cands_gov_da_uf` faz, poria na série um percentual sobre o `vvc` ao lado
    de um painel sobre a disputa.

    Por isso a fonte é `governador-uf.json[sigla].candidatos`: é o que a
    página lê desde 2026-09-21 (`simulacaoGovernadorUf`, antes da síntese — ver
    `app/(gov)/uf/[sigla]/governador/page.tsx`), e já traz identidade, números
    e `destino` juntos, como `senador-uf.json`. A junção antiga fica só como
    fallback para quando o arquivo não existe — é também o último recurso da
    página.
    """
    resumo = resumos_gov.get(sigla) or {}
    if resumo.get("candidatos"):
        return list(resumo["candidatos"])
    return cands_gov_da_uf(row, numeros)


def _carregar_detalhes(nome: str) -> dict[str, Any]:
    """Detalhe municipal já existente, ou `{}` se o arquivo ainda não nasceu.

    Ler antes de escrever é o que impede este script de apagar os municípios
    que `data-pipeline/simulacao-gerar.ts` produz desde 19/09 — ver o cabeçalho.
    """
    p = FIXTURES / nome
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _com_serie(
    existente: dict[str, Any] | None,
    sigla: str,
    cargo: str,
    ts: str,
    serie: dict[str, Any],
) -> dict[str, Any]:
    """Acrescenta `series_temporais.por_candidato` ao detalhe de uma UF.

    🔴 **`municipios` é PRESERVADO como veio.** Reconstruir o objeto do zero —
    que é o que este arquivo fazia até 19/09 — apagaria as 5.570 linhas que o
    gerador escreve para gov e sen, e o sintoma seria só o mapa dessas telas
    voltando a ficar vazio.

    `municipios: []` continua sendo o valor de nascimento quando o arquivo não
    existe: `UfDetailBlob.municipios` é obrigatório no tipo, e
    `municipioDetailReason` trata lista vazia como `"empty"` — estado legítimo
    e distinto de falha de leitura.

    O resto do envelope (`ts`, `uf`, `cargo`, `turno`) também vem do arquivo
    quando ele existe: o `ts` gravado pelo gerador é o eixo de tempo das OUTRAS
    séries do mesmo objeto (`turnout`, `margem`, `p_vitoria`), e sobrescrevê-lo
    com o `ts` do payload nacional desalinharia os dois relógios dentro do
    mesmo arquivo.
    """
    base = dict(existente or {})
    base.setdefault("ts", ts)
    base["uf"] = sigla
    base["cargo"] = cargo
    base["turno"] = base.get("turno", 1)
    base.setdefault("municipios", [])
    series = dict(base.get("series_temporais") or {})
    series["por_candidato"] = serie
    base["series_temporais"] = series
    return base


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="não escreve; só relata")
    args = ap.parse_args()

    mudancas: list[str] = []

    # ---- 1. Nacional presidencial → `/`
    p_nac = FIXTURES / "presidente.json"
    nac = json.loads(p_nac.read_text())
    serie = serie_de(nac["national"]["candidatos"], nac["ts"])
    if serie is None:
        print("🔴 presidente.json: sem candidatos — nada gerado", file=sys.stderr)
        return 1
    nac["serie_por_candidato"] = serie
    mudancas.append(
        f"presidente.json → serie_por_candidato "
        f"({len(serie['eixo'])} baldes × {len(serie['candidatos'])} candidaturas)"
    )
    if not args.check:
        p_nac.write_text(json.dumps(nac, ensure_ascii=False, indent=2) + "\n")

    # ---- 2. Detalhe por UF presidencial → `/uf/<sigla>`
    p_uf = FIXTURES / "presidente-uf.json"
    p_mun = FIXTURES / "municipios-pres-t1.json"
    resumos = json.loads(p_uf.read_text())
    detalhes = json.loads(p_mun.read_text())

    feitas, sem_cands = 0, []
    for sigla, detalhe in detalhes.items():
        resumo = resumos.get(sigla)
        if not resumo or not resumo.get("candidatos"):
            sem_cands.append(sigla)
            continue
        s = serie_de(resumo["candidatos"], detalhe.get("ts") or resumo.get("ts") or nac["ts"])
        if s is None:
            sem_cands.append(sigla)
            continue
        detalhe.setdefault("series_temporais", {})["por_candidato"] = s
        feitas += 1

    mudancas.append(f"municipios-pres-t1.json → series_temporais.por_candidato em {feitas} UFs")
    if sem_cands:
        mudancas.append(f"  ⚠️ sem candidatos, puladas: {', '.join(sem_cands)}")
    if not args.check:
        p_mun.write_text(json.dumps(detalhes, ensure_ascii=False, indent=2) + "\n")

    # ---- 3. Governador → `/uf/<sigla>/governador`
    gov = json.loads((FIXTURES / "governador.json").read_text())
    numeros = {c["id"]: c for c in gov["national"]["candidatos"]}
    # A lista que a página mostra (emenda ao ADR-0053) — ver `cands_gov`.
    resumos_gov: dict[str, Any] = _carregar_detalhes("governador-uf.json")
    # 🔴 Parte do que JÁ ESTÁ no disco — os municípios do gerador. Ver o
    # cabeçalho: até 19/09 este dicionário nascia vazio e o arquivo era
    # reescrito do zero.
    det_gov: dict[str, Any] = _carregar_detalhes("municipios-gov-t1.json")
    for row in gov["por_uf"]:
        sigla = row["sigla"]
        # O resumo DA UF (`governador-uf.json`), que é o que a página mostra;
        # a junção de `synthesizeGovUfFromFixture` (identidade da UF, números
        # do nacional) só quando ele falta. Não é o `pct` de `top_candidatos`
        # — esse é outro número, e usá-lo faria a série discordar do painel.
        cands = cands_gov(sigla, row, numeros, resumos_gov)
        s_ = serie_de(cands, gov["ts"])
        if s_ is None:
            continue
        det_gov[sigla] = _com_serie(det_gov.get(sigla), sigla, "gov", gov["ts"], s_)
    n_muns_gov = sum(len(v.get("municipios") or []) for v in det_gov.values())
    mudancas.append(
        f"municipios-gov-t1.json → {len(det_gov)} UFs (série; "
        f"{n_muns_gov} municípios preservados do gerador)"
    )
    if not args.check:
        (FIXTURES / "municipios-gov-t1.json").write_text(
            json.dumps(det_gov, ensure_ascii=False, indent=2) + "\n"
        )

    # ---- 4. Senador → `/uf/<sigla>/senador`
    sen = json.loads((FIXTURES / "senador-uf.json").read_text())
    det_sen: dict[str, Any] = _carregar_detalhes("municipios-sen-t1.json")
    for sigla, resumo in sen.items():
        s_ = serie_de(resumo.get("candidatos") or [], resumo.get("ts") or gov["ts"])
        if s_ is None:
            continue
        det_sen[sigla] = _com_serie(
            det_sen.get(sigla), sigla, "sen", resumo.get("ts") or gov["ts"], s_
        )
    n_muns_sen = sum(len(v.get("municipios") or []) for v in det_sen.values())
    mudancas.append(
        f"municipios-sen-t1.json → {len(det_sen)} UFs (série; "
        f"{n_muns_sen} municípios preservados do gerador)"
    )
    if not args.check:
        (FIXTURES / "municipios-sen-t1.json").write_text(
            json.dumps(det_sen, ensure_ascii=False, indent=2) + "\n"
        )

    print(("[check] " if args.check else "[escrito] ") + "\n          ".join(mudancas))
    print()
    print("Este script escreve SÉRIE. Os municípios são do gerador")
    print("(data-pipeline/simulacao-gerar.ts) e passam por aqui intactos — desde")
    print("19/09 gov e sen também têm os 5.570. Se um destes números vier zerado,")
    print("o gerador é que não rodou; não reconstrua os arquivos aqui.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
