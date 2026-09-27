---
id: ADR-0054
title: "Resíduo do simulado oficial do TSE: o cálculo ignora leituras anteriores ao dia da eleição (corte por turno, pelo trigger_ts)"
status: accepted
date: 2026-09-27
---

# ADR-0054 — Resíduo do simulado oficial do TSE: o cálculo ignora leituras anteriores ao dia da eleição (corte por turno, pelo `trigger_ts`)

## Status

Aceito.

## Contexto

De 22/09 a 03/10 a produção roda em modo simulado (roteiro `docs/operations/vespera-03-10.md`): a
escrita no Edge Config foi desviada para outro store (`EDGE_CONFIG_ID`), mas o **banco** de
produção recebeu tudo normalmente — o simulado oficial do TSE é um boletim EA20 real, gravado pelo
mesmo caminho de ingestão que grava o boletim de 04/10. Contagem feita pelo dono em 27/09 (SELECT
read-only): **~296 mil linhas** em `snapshots` gravadas entre 23–26/09 com `payload->>'ele'` igual
a 21270/21272 (códigos de eleição do simulado), cargos 1/3/5/6, turno 1, nos **mesmos pares**
uf×município×zona dos reais, com `pct_apurado` = 100%. A ingestão do simulado continua até a
virada de 03/10 (`docs/reference/risks.md:95`).

`snapshots` não tem coluna de eleição nem de ambiente — não há como distinguir "linha do simulado"
de "linha real" pelo schema. `fetch_snapshots` (`api/model/project.py:469`) e
`fetch_municipio_aggregates` (`api/model/project.py:1774`) escolhem a linha vencedora por par com
`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ts DESC, id DESC)` (`project.py:551-555` e
`:1844-1847`), filtrando só por `cargo`/`turno` — sem olhar para o código de eleição do payload. A
consequência prática: em 04/10, todo par que ainda não tivesse recebido boletim real entraria no
cálculo com os votos do simulado a 100% apurado — nas primeiras horas da noite, quando poucos pares
já têm boletim real, o placar publicado seria majoritariamente simulado, sem nenhum alarme (o
`dado_ts` nacional é o máximo entre os pares, e o simulado publica `dg`/`hg` válidos — o relógio
não denuncia o problema). `docs/operations/runbook.md` chegava a especular, em 22/09, que o
resíduo "provavelmente não contamina" o cálculo de 04/10 — palpite não verificado, corrigido por
esta medição.

## Decisão

O cálculo passa a ignorar, a partir do instante do turno, qualquer linha de `snapshots` com `ts`
anterior a esse instante — decisão do dono em 27/09 (opção B de duas apresentadas: "B agora, A
depois").

**Onde.** `_CORTE_RESIDUO_SIMULADO_POR_TURNO` (`api/model/project.py:330-333`) mapeia turno → 
instante BRT: turno 1 → `2026-10-04T00:00:00-03:00`, turno 2 → `2026-10-25T00:00:00-03:00`. Os
valores espelham `lib/config/calendar.ts:92-103` (`CALENDAR_2026`) — a regra é "o início mais
tardio de cada turno" naquele calendário (turno 1 tem duas entradas, `2026-01-01` pré-apuração e
`2026-10-04`; o corte usa a mais tardia, nunca a de pré-apuração). `_ts_minimo_valido`
(`project.py:336-363`) devolve esse instante quando `agora >= corte`, e `None` antes disso — `None`
significa "sem filtro, comportamento idêntico ao anterior a esta mudança". O filtro entra no
`WHERE` da CTE, antes do `ROW_NUMBER`, como `AND ts >= %s` (`project.py:539-540` em
`fetch_snapshots`, `:1832-1834` em `fetch_municipio_aggregates`) — nunca `AND payload->>'ele' = ...`,
que destoastaria o JSONB inteiro de cada linha no caminho quente do modelo. `ts` é a última coluna
de `ix_snap_lookup_par` (`cargo, turno, uf, cod_municipio_tse, cod_zona, ts` —
`lib/db/schema.ts:206`, `docs/architecture/data-model.md:104`); o filtro soma uma comparação sobre
coluna já indexada, no mesmo scan que o `ROW_NUMBER` já percorre.

**"Já é dia da eleição?" segundo o gatilho do ciclo, não o relógio da máquina.** `_ts_minimo_valido`
recebe `agora` como parâmetro; os dois call sites de produção passam
`agora=_instante_do_gatilho(req.trigger_ts)` (`project.py:7683`, `:8105`, `:8191`) —
`_instante_do_gatilho` (`project.py:366-393`) converte `req.trigger_ts`, a mesma string que já
alimenta `derive_seed` (`project.py:273-279`, `:7781`, `:8089`), em `datetime`. Essa escolha não é
cosmética: a primeira versão do corte usava `datetime.now()` diretamente, e foi o
`constitution-guard`, em revisão de 27/09, que apontou a violação — constituição § 6 exige que o
resultado seja reproduzível a partir de snapshot + código + request, e `datetime.now()` quebra isso
(reprocessar o mesmo `(cargo, turno, trigger_ts)` sobre as mesmas linhas de `snapshots` em dois
dias diferentes devolveria resultados diferentes só pelo corte). Com `trigger_ts`, o mesmo request
sempre produz o mesmo corte, em qualquer data em que for reprocessado. `trigger_ts` ilegível (falha
de parse) cai para o relógio real com log `warn` (`project.py:384-390`) — fail-**safe**, não
fail-open: preferimos cortar (arriscando reprodutibilidade só daquele ciclo, já registrada no log)
a deixar passar resíduo do simulado por um `trigger_ts` corrompido. Turno fora de `{1, 2}` devolve
`None` — sem corte — mas é caminho inalcançável em produção: `ProjectRequest.turno`
(`project.py:237`, via Pydantic) só aceita 1 ou 2.

**Antes do corte ativar, nada muda.** Hoje (27/09), o ensaio de 03/10 e os testes de integração que
gravam `ts = now()` ficam todos abaixo do instante do turno — `_ts_minimo_valido` devolve `None`,
`filtro_corte` fica vazio, e a query roda exatamente como antes desta mudança.

**Fora de escopo deste ADR — decisão futura do dono.** Apagar fisicamente o resíduo (opção A) seria
exceção ao princípio de append-only da constituição § 10; o precedente é a migration 0006/ADR-0035
D3, que apagou linhas de mock com autorização explícita do dono — mas ali as linhas eram lixo de
teste, e aqui o simulado é payload genuíno do TSE (ambiente de teste oficial, não harness interno).
A decisão de apagar fica para depois da eleição.

## Consequências

**Positivas**:
- Nada é apagado — `snapshots` continua append-only, constituição § 10 intacto. O corte é
  puramente uma restrição de leitura no `WHERE`.
- O corte é por **data**, não por código de eleição — cobre qualquer leitura anterior ao turno,
  incluindo o ensaio de 03/10 (que já usa os códigos reais do TSE, sem voto de verdade). Não é
  preciso manter uma lista de códigos de eleição "bons"/"ruins" que ficaria desatualizada a cada
  simulado novo.
- O gatilho por `trigger_ts` (não pelo relógio da máquina) preserva a reprodutibilidade bit-a-bit
  da constituição § 6: o mesmo `(cargo, turno, trigger_ts)` sobre as mesmas linhas de `snapshots`
  sempre devolve o mesmo resultado, em qualquer data em que for reprocessado.
- Custo marginal desprezível: o filtro usa a última coluna de um índice já percorrido pelo
  `ROW_NUMBER` (`ix_snap_lookup_par`), sem query adicional nem parse de payload.
- Cobertura: 11 testes do corte em si + 3 de `trigger_ts`/instante ilegível/ciclo proporcional + 2
  de sincronia do calendário; mutações aplicadas e mortas (filtro removido, `>=`→`>` na função e na
  SQL, turnos trocados, call sites revertidos para o relógio real, data do calendário alterada).
  pytest 892 verdes; replay 2022 idêntico (MAE@1h PT 2,3623pp / cobertura 82,5% — o replay não passa
  por `fetch_snapshots`/`fetch_municipio_aggregates`, então não é afetado).

**Negativas**:
- **Duplicação TS→Python do calendário.** `_CORTE_RESIDUO_SIMULADO_POR_TURNO`
  (`project.py:330-333`) copia à mão os instantes de `lib/config/calendar.ts:92-103`, porque o
  módulo Python não importa TypeScript. A cópia é amarrada por
  `tests/unit/model/test_corte_residuo_calendario_sync.py` (molde de `test_cargos_sync.py`), mas se
  o TSE adiar um turno, os dois lados precisam mudar juntos — a guarda impede que a divergência
  passe despercebida, não impede que alguém esqueça de editar os dois arquivos.
- **A série por candidatura (spec 020) não passa por este filtro** — ela lê `projections`, não
  `snapshots`, e tem janela própria de 24h por `ts`/`dado_ts` (`SERIE_JANELA_HORAS`,
  `_SERIE_POR_CANDIDATO_SQL`, `project.py:962`, `:1068`). Linhas de projeção gravadas em setembro
  saem da janela por decurso de tempo, não por este corte; o único caso que ainda caberia na janela
  de 24h seriam projeções gravadas em 03/10 depois de ~17h (o ensaio, já com códigos reais e sem
  voto), se o modelo rodar nessa janela.
- **2º turno ainda sem roteiro de virada.** O corte de 25/10 só protege o cálculo se o ciclo de
  ingestão gravar com `TSE_TURNO=2` — hoje o turno da escrita vem da env var `TSE_TURNO` (default
  1), não do calendário. A transição 1T→2T (quem muda a env var, quando) é um risco aberto,
  registrado aqui só como referência — fora do escopo desta decisão.
- **Resíduo do simulado continua fisicamente no banco** (~296 mil linhas, medidas em 27/09, e
  crescendo até 03/10). A decisão de apagar (opção A) fica pendente do dono, para depois da
  eleição — até lá, qualquer ferramenta de auditoria que faça `SELECT * FROM snapshots` sem filtro
  de data vai ver o resíduo, mesmo que o cálculo já o ignore.
- **Fail-safe de `trigger_ts` ilegível usa o relógio da máquina** — um único ciclo com
  `trigger_ts` corrompido perde a garantia de reprodutibilidade da constituição § 6 (mitigado por
  log `warn`, mas o preço é real, não hipotético).

## Cross-refs

- [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) — par município×zona como unidade de
  ingestão; `ix_snap_lookup_par` (última coluna `ts`) é o índice que este ADR reaproveita para o
  corte sem custo de query adicional.
- [ADR-0038](0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — `dg`/`hg`/`dado_ts` continuam
  vindos do envelope do simulado normalmente (o TSE de teste publica horários válidos); este ADR
  não altera o cálculo de `dado_ts`, só decide quais linhas de `snapshots` entram no `ROW_NUMBER`
  antes de qualquer relógio de dado ser computado.
- Constituição § 6 (determinismo — corte pelo instante do gatilho, `trigger_ts`, não pelo relógio
  da máquina) e § 10 (append-only — nenhuma linha é apagada): [../../constitution.md](../../constitution.md).
- `docs/reference/risks.md:95` — risco "Resíduo do simulado oficial do TSE em `snapshots` de
  produção", medido e mitigado por este ADR; a limpeza física (opção A) permanece como pendência
  registrada ali, para decisão do dono depois da eleição.
- `docs/operations/runbook.md:1293-1324` — seção "Resíduo no banco", com o passo a passo de como
  medir o resíduo (`ts >= '2026-09-14'`) e por que a conferência de resíduo de harness existente
  não o detecta.
- `docs/operations/vespera-03-10.md` — roteiro da virada de produção do modo simulado para o modo
  real; o corte deste ADR é o que torna a virada segura mesmo se parte do resíduo não for apagado a
  tempo.
- Spec: [002-modelo-estatistico](../../specs/002-modelo-estatistico/spec.md) — `fetch_snapshots`
  e `fetch_municipio_aggregates` ganham o corte; gate OT-4/replay 2022 não é afetado (replay não
  passa por essas funções).
