# Plano — Projeção por regra de três (extrapolação do apurado por zona, sem 2022)

## Context

**O pedido (2026-09-05).** Projetar o resultado de cada candidato por **regra de três por
localidade**: em cada localidade com apuração parcial, usar aptos, abstenção observada e votos
por candidato até o momento para projetar os **votos absolutos finais**; somar → UF → Brasil.
Presidente e governador; também brancos/nulos e abstenção. **Sem usar 2022.**

**Por que é mudança de modelo.** Hoje candidatos são projetados por **swing vs. 2022**
(`swing_c(z) = p_c(z,t) − p_c^2022(z)`, spec 002 RF-011/012/013) — 2022 é a âncora. Nesta mesma
sprint (D5, RF-020.1), **abstenção e brancos/nulos já passaram** a ser projetados por regra de
três sem 2022 (`api/model/turnout.py`). O pedido estende o mesmo princípio aos candidatos e a
tudo que deriva deles (`p_vitoria`, 2º turno, cenários, "Outros").

**Duas descobertas que tiram o peso da decisão.** (1) O gate OT-4 que "validava" o swing é
**tautológico**: `scripts/build-replay-fixtures.ts:11` constrói o dataset a partir do próprio
2022, logo swing ≡ 0 e projeção = 2022 = gabarito (já registrado em `risks.md:27`). Não há
evidência empírica a favor do método atual. (2) Com o default de produção `TSE_GRANULARIDADE=uf`,
**o modelo atual está quebrado** — ver § Achado urgente.

**Resultado pretendido.** Um método só, explicável numa frase — "a partir do que cada zona já
apurou, projetamos o total daquela zona e somamos" — coerente entre candidatos e participação,
sem dependência de histórico, com faixa de incerteza honesta.

## Decisões do usuário (fechadas em 2026-09-05)

| # | Decisão |
|---|---|
| **E1** | 2022 **sai da projeção**; **fica como comparação visual** (setas/textos "mudou X pontos desde 2022" = apurado de agora vs. 2022, fato observado). |
| **E2** | Duas visões da parcela do candidato: **% dos votos a votáveis** (default; base `v.vvc`, como `pvap` do TSE) e **% de quem compareceu** (base `e.c`; candidatos + brancos + nulos = 100%). |
| **E2b** | **Um botão alterna a base** de todos os termômetros de uma vez. Tela abre em votáveis. |
| **E3** | Localidade com **0% apurado** usa a **proporção observada na UF** até a primeira urna. Total nacional completo desde o início; IC maior. |
| **E4** | **Zona eleitoral.** Município (pedido literal) é inviável antes de 04/10: ~11.140 GETs/ciclo não cabem em `maxDuration=180` em nenhum rps permitido, `snapshots` não tem coluna, `TSE_GRANULARIDADE` não aceita. Zona é a mesma ideia num recorte mais fino que município nas capitais. Ciclo ~104 s a 50 rps → **cadência efetiva ~120 s** (aceito). |

**Assumidos (não perguntados, coerentes com as decisões acima):**
- **IC fica** (ADR-0018 e constituição § 8 exigem faixa). Bootstrap de zonas, como `turnout.py`.
- **E3 é hierárquico**: zona sem urna → proporção da UF; **UF sem urma nenhuma → proporção
  nacional** (só cargo 1; governador não tem "nacional" → "aguardando projeção"). Reusa
  `inflate_ci_zero_apurado` (RF-017) centrado no nacional em vez de 2022.
- **Rótulo "votáveis", não "válidos"**: o EA20 e o ADR-0018 proíbem chamar `vvc` de válidos.
- Na base comparecimento a soma fecha em 100% **menos** anulados/sub judice (identidade exata do
  EA20: `Σvap + vb + tvn + van + vansj + vscv = c`). A legenda declara o resíduo.

## ⚠️ Achado urgente, independente da mudança: modo `uf` em produção não projeta

`compute_uf_projections:1010,1046` e `compute_participacao:1542` fazem
`eleitorado.get((uf, cod_zona), 0)`. A linha de UF é gravada com `cod_zona = 0`
(`lib/tse/targets.ts:410`) e `eleitorado` **não tem** linha `(uf, 0)` → peso 0 → zona descartada.
Consequência hoje, com o default `TSE_GRANULARIDADE=uf`: candidatos caem no caminho RF-017 e
**mostram 2022 ± 10pp como se fosse projeção**; participação devolve `None`. Ninguém viu porque
em dev as páginas usam fixture (`EDGE_CONFIG` comentada). Sozinho, isto já justifica `zona`.

## O que a exploração estabeleceu (3 agentes read-only + leitura direta)

### O molde: `api/model/turnout.py` (337 l.)
`estimate_uf_participacao(zonas, metric, pct_apurado_uf, seed, n_resamples=1000)` (l. 176):
filtra zonas úteis → `pct_atual = Σnum/Σden` → ponto por fórmula fechada → bootstrap vetorizado
de zonas (`idx = rng.integers(0,k,(1000,k))`, l. 238) → `inflate_ci_low_apurado` (<5%) → clip →
0–100 fora, `estimates` em fração. `aggregate_national_participacao` (l. 276) agrega arrays por
peso. Seed: `seed_base ^ sha256(f"{uf}:{metric}")` (`project.py:1556`).

### Onde o 2022 está — concentrado em ~180 linhas
`compute_uf_projections` (`project.py:942–1122`) + `bootstrap.py:43–96`. Pontos: `fetch_historical_2022:236`,
`hist_idx`/`p_2022_uf:963–988`, **`if p_2022 is None: continue`:1034** (quem entra na corrida
é quem tem 2022), `swing_*`, `project_uf`, `bootstrap_uf` (reamostra swings),
`inflate_ci_zero_apurado(p_2022):1050`. K-1 (`swing.resolve_k1_tier`, `party_mapping`,
`pre_election_polls`, coluna `model_fallback_tier`) **já é código morto**.
**Tudo a jusante de `estimates_by_uf` é agnóstico** — `compute_national:1599`, `p_vitoria`,
`compute_p_passa_2t:1139`, `compute_p_fecha_1t:1193`, `compute_two_round_scenarios:1219`,
`compute_outros_estimates:1356` — **desde que** os arrays sigam em **share fracionário**,
pareados, shape `(1000,)`. Votos absolutos nos arrays quebrariam `>= 0.50` em silêncio.

### Dados que já existem e não são usados
- `cand[].vap` (votos absolutos por zona) chega em `_iter_cands:682`; `_extract_zone_candidate_pcts:868` **joga fora** e lê `pvap`.
- `_extract_zone_participacao:788` extrai `e.te, e.esi, e.c, e.a, v.vv, v.vb, v.tvn, v.van, v.vansj, s.psa`. **Não** extrai `v.vvc` — uma linha.
- `projections.votos_projetados BIGINT` existe (`schema.ts:147`), sempre `NULL`. **Sem migration.**
- Nacional: `votos_atuais: 0` e `votos_projetados: 0` **hardcoded** (`:2440–2480`). `HeadlineScore.tsx:194,205` **já exibe** `votos_projetados`.
- `EdgeUfRow.swing_vs_2022` hardcoded `0.0` (`:2545`); UI já renderiza neutro.
- `pct_atual` de candidato (`build_uf_payloads:2114`) divide `vap` por `votos_total` = **`e.c`**, mas rotula "votáveis" — **base errada hoje**; a mudança corrige.
- `historical_results.votos INT NOT NULL` (`schema.ts:41`) — o swing descritivo (E1) pode usar `votos`, o que **elimina** o bloqueador `fix-pct_validos-null-in-historical_results`.

### Ingestão por nível (2 cargos)
| Nível | GETs/ciclo | @50 rps | Cabe em 180 s? | Observação |
|---|---|---|---|---|
| `uf` | 55 | 1,1 s | sim | **modelo quebrado** (achado acima) |
| **`zona`** | ~5.200 | ~104 s | **sim** | desenho original; `fetch_snapshots` já particiona por `(uf, cod_zona)` |
| `municipio` | ~11.140 | ~223 s | não | inviável antes de 04/10 |

Todo EA20 (qualquer nível) traz `e.te, e.esi, e.c, e.a, v.vvc, v.vv, cand[].vap`. O TSE define
`esi = c + a` — **`esi` é a base correta do parcial**; fator de escala `te/esi`.
`INGEST_CONCURRENCY=20` binda em ~40 rps antes do rate limiter; para 50 rps precisa ≥ 30.
`fetch_snapshots` + `fetch_municipio_aggregates` leem os ~2.600 JSONB **duas vezes** por ciclo
em zona — unificar. Sentinela `cod_zona = 0` de ciclos anteriores em nível UF coexistiria com
zonas reais → **dupla contagem**; descartar quando houver `cod_zona > 0` na UF.

### Precedentes de UI e contrato
- `EdgeParticipacaoMetric = {pct_atual, pct_projetado, lower, upper, base}` — shape de "métrica com base rotulada".
- `MapViewToggle.tsx` — client toggle com `role="tablist"`/`aria-selected`, `{value, onChange}` do pai.
- `ProjectionThermometers`/`ProjectionThermometer` são **Server Components** (a string `"use client"` neles está em comentário).
- `app/governador/page.tsx:114,147` **já lê `searchParams`** com `revalidate = 60` — precedente para `?base=`.
- Rótulo "projeção a partir do apurado" (RF-062) **não existe** no código; ninguém lê `participacao.metodo.tipo`.
- Cargo 3: `national.candidatos` (81 itens) é **catálogo** de `GovernorCard`/`HexCartogramBrasil` — não pode sumir.

### Replay (`tests/fixtures/replay-2022/`, 6,1 MB, 17/05)
`{historical, eleitorado, timesteps[5]}`; snapshot `{uf, cod_zona, pct_apurado, payload:{cand:[{n,pvap}]}}`
— **sem `vap`, `e`, `v`, `s`**; 349 zonas/timestep de 2.619 (amostra). `historical` do fixture sem
votos absolutos (o banco tem). **Brancos/nulos 2022 por zona não existem em lugar nenhum.**
`build-replay-fixtures.ts:268` **já lê `r.votos`** e descarta; **l. 273 `pct_apurado: 100`** é a
tautologia (zona apura inteira num instante — nada a extrapolar).

### Docs que ficam falsas
Constituição **§ 8 linha 74** nomeia "swing". Spec 002 RF-011/013/017 morrem, RF-012 muda a
métrica, Escopo In `:26–28`, `design.md:19–31,57–60,152–160`. ADR-0015 (K-1) → obsoleto.
`/sobre-o-modelo` seção 2 + `:18,23,35,55,99,261,269,292,335,341` + `SwingIllustration:392–480`.
Spec 011 `:31,49,64,67`. `DecisiveUFsGrid.tsx:100`. **Sobrevivem**: ADR-0006, 0007 (zona), 0014,
0018 (precedente a favor); RF-014/015/016/018/019/020/020.1; todo o payload; os 3 fixtures.

---

## Abordagem

### A. Estimador — `api/model/extrapolation.py` (novo; `turnout.py` intocado)

Módulo irmão, não generalização: semânticas diferentes (razão de somas escaladas vs. média de
taxas ponderada), e `turnout.py` acabou de ser entregue com 14 testes. Importa `_frac_to_pct`,
`_clip01` de `turnout`; `inflate_ci_low_apurado`, `inflate_ci_zero_apurado` de `edge_cases`.

**Notação por zona** (EA20 da zona + `w` = aptos 2026 da tabela `eleitorado`): `te, esi, c, vvc,
vv, vb, tvn, vap_c`. **Fator de escala `k(z) = te/esi`.** Zona **apurada** ⇔ `esi > 0 ∧ vvc > 0 ∧ w > 0`.

**A fórmula colapsa:** todo total projetado da zona é a contagem observada × `k(z)`:
```
V_c(z) = vap_c·k     B_v(z) = vvc·k     B_c(z) = c·k     BN(z) = (vb+tvn)·k
```
`V_c` é **o mesmo** nas duas bases; só o denominador muda.

**UF** — razão de somas sobre zonas apuradas `A`: `s_v_c = ΣV_c/ΣB_v`, `s_c_c = ΣV_c/ΣB_c`;
`pct_atual_v = Σvap_c/Σvvc`, `pct_atual_c = Σvap_c/Σc` (literal, sem `k`). Ponderação por votos
projetados emerge da soma — não há peso explícito.

**E3 — zona não apurada**: `B_v(z) = te·r_v(U)`, `r_v = ΣB_v/Σte` sobre `A`; `V_c(z) = s_v_c(U)·B_v(z)`.
Algebricamente **o share da UF não muda** com a imputação — só os votos absolutos, o que garante
"total nacional completo desde o início". Fórmula fechada: `B_v(U) = ΣB_v·(Σte_todas/Σte_A)`.
**UF sem zona apurada** (cargo 1): `s_c(U) := s_c(BR)`, `V_c(U) = s_c(BR)·w(U)·r_v(BR)`,
CI `inflate_ci_zero_apurado(s_c(BR))`, `estimates` = array nacional pareado, `metodo = "imputado_nacional"`.
Cargo 3: UF omitida → "aguardando projeção".

**IC — um `idx` por UF**: `idx = default_rng(seed_uf).integers(0, k_A, (1000, k_A))` sobre zonas
**apuradas** (imputadas são constantes; entrariam encolhendo o IC). `den_v = (vvc·k)[idx].sum(1)`,
`den_c = (c·k)[idx].sum(1)` uma vez; por candidato `num_c = (vap_c·k)[idx].sum(1)`;
`est_v_c = num_c/den_v`, `est_c_c = num_c/den_c`. **Mesmo `idx` para todos os candidatos e as duas
bases** → um bootstrap por UF, segunda base custa uma divisão, arrays **pareados de verdade** (hoje
cada `(uf, cand)` tem seed própria — o pareamento é nominal). Seed `seed_base ^ sha256(f"{uf}:candidatos")`.
Ponto = fórmula fechada (não `mean`). RF-018 nas duas bases. SP (~430 zonas): `idx` 3,4 MB.

**Contrato**: `estimates_by_uf[uf][cand]` **continua** share votáveis, fração, `(1000,)`, pareado →
`compute_national`, `p_vitoria`, `p_passa_2t`, `p_fecha_1t`, `two_round_scenarios`, `outros`
**sem mudança**. Novo `estimates_c_by_uf` só alimenta o payload. Votos absolutos derivam nas
`rows` e o nacional soma UF a UF (RF-014).

```python
class ZonaCandidatos(TypedDict):
    cod_zona: int; weight: int
    eleitores_aptos: int; eleitores_instalados: int; comparecimento: int
    votaveis: int; validos: int; brancos: int; nulos: int
    votos: dict[int, int]                          # cand -> vap
class CandidatoEstimate(TypedDict):
    pct_atual_votaveis: float|None; pct_projetado_votaveis: float; lower_votaveis: float; upper_votaveis: float
    pct_atual_comparecimento: float|None; pct_projetado_comparecimento: float; lower_comparecimento: float; upper_comparecimento: float
    votos_atuais: int; votos_projetados: int
    estimates_votaveis: np.ndarray; estimates_comparecimento: np.ndarray
class UfCandidatosEstimate(TypedDict):
    por_candidato: dict[int, CandidatoEstimate]; n_zonas: int; n_zonas_imputadas: int
    base_votaveis_projetada: int; base_comparecimento_projetada: int
    brancos_nulos_comparecimento: CandidatoEstimate|None    # Fase 5, mesmo idx
def estimate_uf_candidatos(zonas, pct_apurado_uf, seed, n_resamples=1000) -> UfCandidatosEstimate|None
def impute_uf_from_national(national_shares, national_point, w_uf, r_v_br) -> UfCandidatosEstimate
def aggregate_national_votos(by_uf) -> tuple[dict[int,int], int]
```
Candidatos = união dos `n` vistos nas zonas apuradas (não mais "quem tem 2022").

**Coerência das bases (E2)**: `brancos_nulos` hoje vem de `turnout.py` com seed própria → soma
fecha em 100 ± 0,3 pp. **Fase 1 aceita** (uma casa na UI; teste com tolerância). **Fase 5** move
`brancos_nulos` para `extrapolation.py` no mesmo `idx` → identidade exata por resample;
`turnout.py` fica só com abstenção (base `esi`, fora do 100% por E2).

> **ENTREGUE 18/09.** `estimate_uf_candidatos` passou a emitir
> `brancos_nulos_comparecimento` (mais `comparecimento_observado`, o denominador bruto que o
> agregado nacional soma UF a UF). O corpo por candidato virou a closure `_estimate_for`, que
> brancos/nulos reusa — mesmo `idx`, mesmos estratos, **zero sorteio novo**, logo nenhum número
> de candidato se moveu. Medido: `max |Σ_c share_comp + bn − 1| = 0.0` sobre os 1.000 resamples,
> contra os ~3e-3 do caminho antigo. O resíduo de anulados/sub judice (art. 265 §2º) continua
> aparecendo como resíduo — a soma NÃO é normalizada à força. Testes em
> `tests/unit/model/test_extrapolation.py` (bloco Fase 5) e
> `tests/unit/model/test_participacao_brancos_nulos.py`.
>
> A identidade é **por UF**. No nacional ela só fecha quando todo candidato existe em toda UF
> (o caso do cargo 1): `aggregate_national_estimates` normaliza cada candidato pelo eleitorado
> das UFs em que ele aparece, então um candidato presente em 1 de 5 UFs sai com share inflado.
> Isso é **anterior** a esta mudança e não foi tocado aqui.

**Cargo 3**: `compute_national` inalterado — cada candidato existe numa UF; `aggregate_national_estimates`
devolve o array da UF dele; `national.candidatos` segue catálogo. Pular imputação nacional.

### B. `api/model/project.py`

| Onde | Mudança |
|---|---|
| imports `:73–85` | − `bootstrap_uf, project_uf, swing_zone, swing_uf`; + `extrapolation` |
| `ZonaParticipacaoRaw:763` (+ espelho `turnout.py:62`) | + `votaveis: int` ← `v.vvc` (uma linha em `_extract_zone_participacao:849`) |
| `_extract_zone_candidate_pcts:868` | **substituir** por `_extract_zone_candidatos(payload, cargo) -> ZonaCandidatosRaw|None` = participação + `{int(c["n"]): int(_parse_br_number(c["vap"]))}` via `_iter_cands`. Apagar a versão `pvap` (o `pct_atual` passa a vir de `Σvap/Σvvc`, corrigindo a base) |
| `build_candidate_to_partido_2022:924` | apagar (K-1 morto) |
| `fetch_snapshots:197` | ⚠️ **descartar `cod_zona = 0` quando houver `cod_zona > 0` na UF**; se só houver zona 0, `weight = eleitorado_total_by_uf[uf]` (conserta o modo `uf`) |
| `compute_uf_projections:942` | nova assinatura `(cargo, turno, seed_base, snapshots, eleitorado) -> (rows, estimates_by_uf, estimates_c_by_uf, cand_by_uf)`. Sai tudo de 2022/swing/bootstrap_uf. Entra: por UF montar `ZonaCandidatos` (`w > 0`), `uf_pct_apurado` como hoje, seed por UF, `estimate_uf_candidatos`; segunda passada para UFs `None` (cargo 1) via `impute_uf_from_national`. `rows` ganham `votos_projetados: int`, `pct_atual`, `metodo`, `n_zonas`, `n_zonas_imputadas`, bloco comparecimento |
| `fetch_historical_2022:236` | mantém, **não-fatal** (`try` → `[]`), SQL lê `votos`; só alimenta `compute_swing_descritivo` |
| **nova** `compute_swing_descritivo(uf_rows, historical) -> dict[str, float|None]` | E1: `pct_atual_v(líder) − votos_2022(n)/Σvotos_2022(U)`; `None` se o número não existiu. **Fase 5 — ENTREGUE 18/09** (`api/model/project.py`, `tests/unit/model/test_swing_descritivo.py`). Líder = líder do **apurado** (`pct_atual`), não da projeção: os dois termos da subtração precisam ser fatos observados. Chave 2022: o surrogate `cargo*1e6+ano*1000+turno*100+nr_partido` de `historical-import.ts` é reconstruído e **conferido** — código fora do formato é ignorado em vez de casar por `% 100` (senão um `SQ_CANDIDATO` terminado em 13 viraria o número 13). Só cargos 1 e 3. |
| `compute_national:1599` | assinatura estável; kwarg opcional `votos_by_uf` → `rows[*]["votos_projetados"] = Σ_U` |
| `compute_participacao:1497` | inalterada na Fase 1; **Fase 5 — ENTREGUE 18/09**: ganhou o kwarg opcional `cand_by_uf` e, com ele, `brancos_nulos` sai de `extrapolation.py` (`_participacao_de_brancos_nulos`). `turnout.py` segue respondendo por `abstencao`; o ramo `brancos_nulos` de `estimate_uf_participacao` continua no arquivo, **sem caller em produção** |
| `_national_votos_por_candidato:1581` / `build_edge_payload:2427–2480` | `pct_atual`/`votos_atuais` das `national_rows` (razão de somas, não mais `0`); `votos_projetados` real; `comparecimento` por candidato; `participacao.outros.comparecimento`; `swing_vs_2022` do descritivo (Fase 5) |
| `build_uf_payloads:2105–2130` | remover `total_votos_uf/(pct_apurado/100)`; `votos_*`/`pct_atual` do `row`; `comparecimento`; `outros` na 2ª base via `compute_outros_estimates(estimates_c_by_uf[uf], rank, 4)`; `metodo.n_zonas_imputadas` |
| `insert_projections:581` | sem mudança de SQL; recebe `votos_projetados` inteiro |
| `fetch_municipio_aggregates:471` | Fase 3: virar `aggregate_municipios(snapshots, zona_municipio)` pura sobre os snapshots já lidos (evita 2ª leitura de 2.600 JSONB) |
| `_do_project:2760` | novo desempacotamento; `historical` só para descritivo; `votos_by_uf` → `compute_national`; `estimates_c_by_uf` → builders |
| `replay_batch._run_one_timestep:155` | nova assinatura; `historical` do stdin ignorado (contrato TS intacto) |

**Deletar (Fase 1, mesmo PR)**: `api/model/{swing,projection,weighted_average,bootstrap,party_mapping,pre_election_polls}.py`,
`edge_cases.is_candidate_unmappable`; testes `test_{swing,bootstrap,projection,weighted_average,k1_fallback_tiers}.py`
(30 testes órfãos). `edge_cases.py` fica (docstring RF-017 → centra no nacional). Coluna
`model_fallback_tier` e `EdgePayloadUf.model_fallback_tier?` ficam, `@deprecated` — sem migration.

**Contrato `lib/edge-config/types.ts`** (atualizar `docs/architecture/data-model.md § Payload` antes — regra de `types.ts:9`):
```ts
export interface EdgeBaseComparecimento { pct_atual: number|null; pct_projetado: number; lower: number; upper: number }
// EdgeCandidate, EdgeUfCandidate:            comparecimento?: EdgeBaseComparecimento;
// EdgeParticipacao.outros:                    ... & { comparecimento?: EdgeBaseComparecimento };
// EdgeParticipacao.metodo.tipo:               "extrapolacao_apurado" | "imputado_nacional"; n_zonas_imputadas?: number
// EdgeUfRow:                                  swing_vs_2022: number | null;   // Fase 5, descritivo
```
Tudo opcional → os 3 fixtures continuam válidos. Tamanho: nacional 20 → ~21 KB (alvo 75),
`gov-current` 50 → ~58 KB. `edge-write` é `.passthrough()`.

### C. UI — botão de base (E2b) e rótulo RF-062

**Toggle = search param `?base=comparecimento`, botões como `<Link>` (segmented control,
`aria-pressed`), zero JS novo.** Mantém `ProjectionThermometers` Server Component (RNF-007a está a
~1,3 KiB do teto), há precedente (`governador/page.tsx:114,147`), testável com `renderToStaticMarkup`.
Custo: duas variantes de cache CDN (ADR-0002) e um round-trip RSC ao alternar. **Verificar no
`next build` que `/` e `/uf/[sigla]` não mudam de modo de renderização** ao ler `searchParams`.
Canonical (RNF-027) sem query. A alternativa client (~0,6 KB, `data-base` + meters duplicados com
`hidden`) fica para depois do simulado 1, se pedirem troca instantânea.

- `ProjectionThermometers` + `base: "votaveis"|"comparecimento"` (default votaveis); candidatos e
  Outros leem `c.comparecimento?.*` na 2ª base; payload sem o campo → `aguardando` (nunca base errada);
  `scaleMax` recalculado. Novo átomo `components/atoms/controls/BaseToggle.tsx` (RSC, dois `<Link scroll={false}>`,
  rótulos via `denominadorLabel`). Legenda por base — comparecimento: "Candidatos, Outros, brancos e
  nulos somam 100% de quem compareceu (resíduo: anulados e sub judice). Abstenção tem base própria."
- **Rótulo RF-062 universal**, linha sob o `<h2>`, lida de `participacao.metodo`:
  `"Projeção a partir do apurado · N zonas · X% apurado"`; `imputado_nacional` → "Projeção provisória
  a partir da proporção nacional — sem urna desta UF ainda"; sem `metodo` → "Aguardando primeira
  apuração". Nas 4 rotas.
- `HeadlineScore.tsx:95` subtítulo "comparação com 2022" → "extrapolação do apurado";
  `ForecastTransparency.tsx:10` comentário. `CandidateRow:47`, `HeadlineScore:194,205` já formatam
  votos — passam a receber valor real.

### D. Ingestão — zona

Env: `TSE_GRANULARIDADE=zona`, `TSE_MAX_RPS=50`, `INGEST_CONCURRENCY=30`, `maxDuration=180` (já),
`TSE_ACOMPANHAMENTO=on`. Ciclo ~104 s; cron 60 s + lock 3 min → tick de 60 s `skipped: overlap`,
o de 120 s roda → **cadência ~120 s, lag ~130–160 s** (meta S07 <90 s; aceito em E4, medir no
simulado 1). Opções se precisar: **Z1** aceitar e medir (agora); **Z2** dois shards
(`?shard=0|1`, 45 rps cada → ~58 s, mas 90 rps agregados encostam nos 100/IP do TSE) — só com dado;
**Z3** híbrido UF+zona — não antes de 04/10. Ensaiar escala com `scripts/tse-mock-server.ts` a
2.600 zonas antes de 15/09. EA15 gating por município (`and="f"`) → Fase 6.

### E. Replay — regenerar não-tautológico (sem download)

`scripts/build-replay-fixtures.ts`: (1) emitir cada zona como **envelope real**
`{carg:[{cd:1, agr:[{par:[{cand:[{n, vap, pvap}]}]}]}], e:{te,esi,c,a}, v:{vvc,vv,vb,tvn,van:0,vansj:0}, s:{psa}}`
com `vv = vvc = Σvotos_c(z)` (2022 real), `c = round(vv/(1−0,0457))`, `vb = 0,0159·c`,
`tvn = 0,0298·c` (taxas nacionais 1T 2022), `te = max(w_2026, round(c/(1−0,2095)))`, `esi = te`;
(2) **ordem de apuração enviesada** — `T_zona` com probabilidade crescente em `te` e atraso
regional (N/NE +3) — reproduz o viés de composição e faz 1h ≠ gabarito; (3) **apuração
progressiva intra-zona** `f ∈ {0,25; 0,5; 0,75; 1}` entre `T_zona` e `T_zona+3` (exercita `k` e
`vvc = 0`); (4) gabarito continua `votos_2022` por UF. **E2 (se der tempo)**:
`detalhe_votacao_munzona_2022` de `dadosabertos.tse.jus.br` — **pedir ok ao usuário antes de baixar**.

**OT-4 novo**: `MAE@1h < 2 pp` (mantido) **+** cobertura do IC95 em 1h ≥ 90% dos pares (UF, cand)
**+** MAE@15min reportado sem gate. Esperar MAE **maior** que 0,998 pp — é o gate ficando honesto.
Caveat obrigatório: brancos/nulos sintéticos, ordem simulada. Participação fora do replay.

### F. Testes

**Novo `tests/unit/model/test_extrapolation.py`** (espelho de `test_turnout.py`, builder `_zona(...)`):
reprodutibilidade bit a bit nas duas bases; seeds divergem; `esi = te/2` dobra votos; razão de
somas ≠ média; E3 não altera share, soma `te·r_v·s_c`, `n_zonas_imputadas == 1`; RF-018 ×1,5 nas
duas bases + clip; `Σ_c est_c` por resample == `vv/c` do resample (exata com `van=0`), com `turnout`
`± 0,01` (Fase 1) → exata (Fase 5); pareamento `est_a + est_b == 1` elementwise com 2 candidatos;
`None` para 0 zonas / `vvc = 0` / `w = 0`; `aggregate_national_votos` soma; imputação nacional ±10 pp;
`cod_zona = 0` descartado com zona real, usado com peso total sozinho; **invariância a
`historical`** — resultado idêntico com `[]` e cheio (o teste que prova o pedido).

**Ajustar**: `test_orchestrator.py:1162` (esperado vira `45.0` direto; `_synthetic_envelope:105`
tem `vap: "0"` — derivar `vap = round(pct/100·vvc)`, `vv = Σvap`), `:1260` (+ `votos_projetados > 0`,
`comparecimento` presente), 3 primeiros de `test_scale.py` (envelope com `vap`; RF-017 → imputado
nacional), `test_replay_batch.py`. **Deletar** 5 órfãos. Baseline esperada ≈ 135 pytest.

**Vitest**: `ProjectionThermometers` com `base="comparecimento"` troca os 4 meters e a legenda;
sem `comparecimento` → `data-estado="aguardando"`; rótulo RF-062 nos 3 estados; `BaseToggle`
`aria-pressed` + `href` preservando rota; `HeadlineScore`/`UFPage` com `votos_projetados` pt-BR;
`generate.test.ts`/`DecisiveUFsGrid` com `swing_vs_2022: null` → "—" (Fase 5).

### G. Documentação e conformidade

- **ADR-0021** — "Projeção de candidatos por extrapolação do apurado, não swing vs. 2022".
  Contexto: 2022 como âncora exigia K-1 que nunca operou, `pct_validos` nulo, replay tautológico,
  modo `uf` quebrado. Decisão: A. Alternativas: swing; regra de três por UF (não corrige
  composição); município (custo). Consequências: viés de composição em baixa apuração é o risco
  central e o bootstrap não o vê (mitigado por RF-018 + rótulo); `p_vitoria` pareado de verdade;
  `model_fallback_tier` deprecado. `supersedes: ADR-0015`; mantém 0006, 0007, 0018.
- **Constituição 1.1 → 1.2**: § 8 l. 74 → "como a projeção é extrapolada do apurado, como o IC é
  construído e o que 2022 significa na tela (comparação, não insumo)". Mesmo mecanismo do ADR-0020.
- **Spec 002**: título; Escopo In; RF-011 → "WHEN zona tem `esi > 0 ∧ vvc > 0`, SHALL calcular
  `k = te/esi` e `V_c = vap_c·k`"; RF-012 → razão de somas nas duas bases; RF-013 → E3 hierárquico;
  RF-017 → "IF UF sem zona apurada, SHALL usar proporção nacional, CI ±10 pp, `metodo =
  imputado_nacional`"; **RF-020.2** (duas bases, identidade com resíduo declarado); **RF-020.3**
  (`votos_projetados` = Σ zona→UF→BR, persistido); `ship_blocked_on` remove
  `fix-pct_validos-null-in-historical_results`, `fix-p_vitoria-a-by-pct`, `sobre-o-modelo-page`,
  `botid-adr` (resolvidos) — mantém `simulado-tse-2026`; `design.md` reescrito.
- **`/sobre-o-modelo`** + spec 011: seção 2 → "Regra de três por zona" com ilustração de `k`;
  limitações + "viés de composição". Strings: `DecisiveUFsGrid.tsx:100`, `uf/[sigla]/governador/page.tsx:316–331`
  (disclaimer K-1 → remover), `lib/insights/generate.ts:37,49,97` (tolerar `null`).
  `MapViewToggle:37` "Swing vs 2022" **fica** (E1).
- `spec-syncer`: traceability, `index.json`, README, `components.md` (`BaseToggle`), runbook (env zona).

### H. Faseamento e despacho

| Fase | Janela | Conteúdo | Pronto quando | Agente(s) |
|---|---|---|---|---|
| **0 Contrato** | 05–06/09 | ADR-0021 rascunho; constituição 1.2; `types.ts` + `data-model.md` fechados | ADR revisado; shape aprovado | `adr-author` ∥ `constitution-guard` |
| **1 Estimador** | 06–10/09 | `extrapolation.py`; `_extract_zone_candidatos`; `compute_uf_projections` novo; votos UF/BR; E3; deletar 6 módulos + 5 testes; `test_extrapolation.py`; ajustes; `replay_batch` | pytest verde; `_do_project` com envelope publica `votos_projetados > 0` e `comparecimento`; **idêntico com `historical=[]`** | `model-validator` |
| **2 Payload + UI mínima** | 08–12/09 ∥ | `types.ts`; builders; rótulo RF-062; votos exibidos; vitest | typecheck/lint/vitest verdes; nacional < 75 KB | `spec-implementer` |
| **3 Ingestão zona** | 09–12/09 ∥ | env; sentinela; `aggregate_municipios` puro; ensaio mock 2.600 zonas; medir ciclo e Python | ciclo < 180 s; modelo < 60 s | `tse-parser-builder` + `model-validator` |
| **4 Gates + freeze** | 12–14/09 | `constitution-guard` ∥ `a11y-perf-auditor` ∥ `rf-coverage-checker`; preview; runbook | sem HIGH; freeze 14/09 | os três |
| **Simulado 1** | 15–17/09 | lag, 429, tamanho, coerência das bases, UFs imputadas | dois ciclos completos | orquestrador |
| **5 E2b/E1/coerência** | 18–21/09 | `BaseToggle` + `?base=`; swing descritivo; `brancos_nulos` no mesmo `idx`; `/sobre-o-modelo`; spec 002/011; replay E1 + OT-4 novo; Z1/Z2 | simulado 2 valida | `spec-implementer`, `model-validator`, `spec-syncer` |
| **6 Hardening** | 25/09–01/10 | Z2 se lag > 90 s; EA15 gating; replay E2 (com ok); `spec-syncer`; freeze 02/10 | OT-4 verde; docs sincronizadas | `tse-parser-builder`, `model-validator`, `spec-syncer` |

**Mínimo antes de 15/09: Fases 0–4.** Pode esperar: toggle E2b (payload já traz a 2ª base; UI
abre em votáveis como E2b manda), swing descritivo, `/sobre-o-modelo`, replay, identidade exata.

## Arquivos críticos

- `api/model/project.py` — o núcleo da mudança (B)
- `api/model/turnout.py` — molde; **não editar** além de `votaveis` no `ZonaParticipacaoRaw`
- `api/model/extrapolation.py` — **novo**
- `api/model/edge_cases.py` — reuso; docstring RF-017
- `lib/edge-config/types.ts`, `docs/architecture/data-model.md` — contrato
- `components/blocks/ProjectionThermometers.tsx`, `components/atoms/controls/BaseToggle.tsx` (novo)
- `app/page.tsx`, `app/uf/[sigla]/page.tsx`, `app/governador/page.tsx`, `app/uf/[sigla]/governador/page.tsx` — `?base=`
- `scripts/build-replay-fixtures.ts`, `api/model/replay_batch.py` — replay
- `docs/constitution.md` § 8, `docs/architecture/adrs/0021-*.md` (novo), `0015` (superseded), `docs/specs/002-*/`, `docs/specs/011-*/`, `app/sobre-o-modelo/page.tsx`

## Verificação

**Baseline** (`set -a; . ./.env.local; set +a`): 507 vitest / 68 arq / 1 skipped · 153 pytest ·
typecheck limpo · lint 5 warnings 0 erros · above-the-fold ~148,7 KiB gz (filtrando `nomodule`).
Pós-mudança: vitest ≥ 507 + novos; pytest ≈ 135 (153 − 30 órfãos + ~12); typecheck/lint no
baseline; bundle **não cresce** (toggle é RSC).

**Invariantes que os testes travam**: determinismo bit a bit (§ 6); **zero 2022 no caminho da
projeção** (`historical=[]` ≡ cheio); `Σ share_comp + bn = 1 ± tol` por resample; `share_v ≥ share_c`;
E3 dupla imputação e total nacional completo desde o 1º ciclo; RF-018; contrato a jusante intacto
(`test_outros.py`, `test_compute_*.py` **passam sem alteração**); `Σ_UF votos = votos_BR > 0`;
`EdgeCandidate` decoda os 3 fixtures; nacional < 75 KB; sentinela `cod_zona = 0` não conta duas vezes.

**Replay**: regerar (E) → `pnpm replay-2022` → `model-validator`. MAE@1h < 2 pp + cobertura IC ≥ 90%
+ MAE@15min reportado. Esperar MAE > 0,998 pp. Falha → decisão do usuário (relaxar via ADR só após
3 tentativas, regra de `risks.md`).

**Visual/conformidade**: `rm -rf .next`; `preview_start atlasmenna-dev`; 4 rotas em 375 px e
desktop, 1T e 2T (`FIXTURE_VARIANT=t2` — **`binary` inalterado**); toggle alterna os seis, abre em
votáveis, rótulo acompanha, nada some do DOM, teclado; RF-062 nos seis; `/sobre-o-modelo` sem
swing como método; `next build` confirma modo de renderização das 4 rotas. Gates: `model-validator`
∥ `constitution-guard` ∥ `a11y-perf-auditor` → `rf-coverage-checker` → `spec-syncer`. Nenhuma spec
promovida sem os 4.

## Riscos e o que não fazer

- **Viés de composição** em baixa apuração é o risco metodológico central; o bootstrap não o vê.
  RF-018 + rótulo são a mitigação — não inventar inflações extras sem ADR.
- Não tocar `binary`/2T (`HeadlineScore`, `NationalNeedle`, `TurnoOneRecap`); `--color-cand-*`,
  `colorForRank`, `bandForRank` (ADR-0013); não voltar `.strict()`.
- **Não sondar `resultados*.tse.jus.br`**; download de dados abertos só com ok do usuário.
- Não misturar níveis em `snapshots` sem descartar `cod_zona = 0`; não trocar `TSE_GRANULARIDADE`
  no meio de um simulado.
- Não mudar o contrato de `estimates` (share fracionário pareado).
- Não generalizar `turnout.py`; não persistir participação em `projections`; não migration para
  `model_fallback_tier`.
- `ProjectionThermometers` sem `"use client"`. Não remover `national.candidatos` em cargo 3.
- Commit/push só com ordem explícita.
