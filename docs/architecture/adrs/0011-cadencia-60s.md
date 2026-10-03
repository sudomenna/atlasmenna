---
id: ADR-0011
title: Cadência de polling TSE em 60s (Vercel Cron nativo), não self-loop 15s
status: accepted
date: 2026-05-17
---

# ADR-0011 — Cadência de polling TSE em 60s (Vercel Cron nativo), não self-loop 15s

## Status

Aceito.

**Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D3).** O cadenciamento em 60s conforme este ADR permanece válido; contudo, a implementação mudou:
- Duas rotas agora: `/api/ingest` (todos os cargos, manual/preview) e `/api/ingest/[cargo]` (Pres/Gov isolados via cron de produção).
- `maxDuration` subiu de 180s para **300s** (fan-out por par: ~6.110 arquivos por cargo; ~153s a 40 rps).
- `TSE_MAX_RPS_DEFAULT` subiu de 30 para **40 rps** (com dois cargos concorrentes, pior caso agregado 80 rps, 20% abaixo do teto do TSE de 100 rps).
- Lock anti-overlap agora é **por cargo** (janela 6 min ≥ maxDuration), permitindo Presidente e Governador em paralelo.
- Ambas as rotas aceitam `Authorization: Bearer <CRON_SECRET>` (Vercel Cron padrão) ou `x-cron-secret` (runbook manual).

## Contexto

O design original de `spec 001-ingestao-tse` previa cadência de **15s** para buscar novos arquivos no CDN do TSE durante a janela de apuração (17h–04h BRT do Dia D). Com o ambiente de produção definido em cima do **Vercel Pro**, o mínimo granular do Vercel Cron é **1 disparo por minuto**. Para atingir 15s, o handler teria de implementar um self-loop interno: um único disparo do cron executando 4 iterações sequenciais com `setTimeout` espaçadas 15s.

Essa abordagem tem três problemas concretos:

1. **Risco de estouro de `maxDuration`.** Em preview (escala reduzida, ~500 GETs por ciclo) o handler fecha dentro de 60s. Em produção, com ~73k arquivos teóricos do TSE, qualquer iteração que atrasar (rede, cold Neon, pico de write) pode empurrar o tempo total além do `maxDuration` configurado (60s padrão Pro; 800s com Fluid Compute, mas com billing diferente).

2. **Fragilidade de sobreposição.** Se um ciclo de 15s demora 20s, o próximo já deve disparar. Em self-loop dentro de um único handler isso é gerenciável enquanto o handler é sequencial; mas sob carga, dois disparos de cron próximos produzem handlers sobrepostos que concorrem em gravação no Edge Config e no Postgres.

3. **Raciocínio operacional degradado.** Entender o estado do pipeline no runbook já inclui ler logs de ETags, snapshots e propagação Edge Config. Um handler com 4 micro-ciclos internos multiplica a superfície de diagnóstico sem ganho proporcional de precisão.

O Vercel Cron nativo com 1 disparo/min resulta em **1 ciclo completo por invocação**, sem estado interno a propagar entre iterações.

## Decisão

A cadência de ingestão TSE é fixada em **60s** via `vercel.json` `crons` nativo. O handler `/api/ingest` executa **um único ciclo completo** por invocação: busca lista de arquivos modificados, filtra por ETag, faz download seletivo, processa e propaga para Edge Config + Neon. Não há `setTimeout` interno, não há loop multi-ciclo, não há estado compartilhado entre ticks consecutivos além do ETag cache no Edge Config.

Esta decisão renegocia o RNF-006: a defasagem máxima TSE→tela passa de <30s para <90s (60s polling + ~10s processamento + ~10s propagação Edge Config). Para o público-alvo do AtlasMenna — acompanhamento em tempo real por audiência geral — 90s permanece operacionalmente "tempo real".

## Consequências

**Positivas**:
- Simplicidade operacional: 1 handler = 1 ciclo = 1 entrada de log. Diagnóstico linear.
- Robustez: sem sobreposição entre ticks; cron com disparo fixo a cada 60s tem comportamento determinístico.
- Conformidade com plano Vercel Pro sem necessidade de Fluid Compute para a janela normal.
- Alinhamento com constituição § 7 (resiliência operacional) — favorece previsibilidade sobre agressividade de cadência.
- Alinhamento com constituição § 9 (stack 100% Vercel) — nenhum scheduler externo introduzido.

**Negativas**:
- Defasagem TSE→tela vai de <30s para <90s; RNF-006 foi renegociado para refletir esse novo teto.
- Para audiência técnica comparando com cobertura ao vivo de TV (latência ~5s), a defasagem de 90s pode parecer "lenta". Trade-off aceito: robustez operacional no Dia D supera precisão de latência mínima.

**Neutras**:
- Handler `/api/ingest` ganha simplicidade de implementação: sem self-loop, sem `setTimeout`, sem propagação de ETags entre micro-ciclos. A lógica de deduplicação fica restrita à comparação ETag por arquivo entre invocações consecutivas do cron.

## Cross-refs

- ADR-0002 (polling com CDN cache) — complementar; define a cadência do cliente (SWR 5s). ADR-0011 define a cadência do servidor (Cron 60s).
- ADR-0008 (não Convex) — coerente: não introduz scheduler externo de nenhum tipo.
- Spec afetada: `docs/specs/001-ingestao-tse/spec.md` (RF-002, RF-003 — cadência de ingestão)
- Design afetado: `docs/specs/001-ingestao-tse/design.md` (§ Cadenciamento)
- NFR renegociado: `docs/nfr/performance.md` (RNF-006, defasagem máxima TSE→tela)
- Constituição § 7 (resiliência operacional): `docs/constitution.md`
- Constituição § 9 (stack 100% Vercel): `docs/constitution.md`
