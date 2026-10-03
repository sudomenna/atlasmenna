---
title: Visão de Produto — AtlasMenna
description: Sumário executivo, contexto, problema, oportunidade e visão do AtlasMenna
status: stable
source: PRD.md §§ 1, 2
---

# Visão de Produto

## Sumário Executivo

AtlasMenna é uma plataforma web pública para acompanhar a apuração das eleições brasileiras de 2026 (Presidente + 27 Governadores) com **projeção estatística em tempo real**, **mapas coordenados** (brushing & linking) e **transparência metodológica** total.

**Diferencial central**: enquanto Globo, UOL e TSE mostram o **parcial atual**, AtlasMenna mostra o **resultado final projetado** com intervalo de confiança, baseado em comparação zona-a-zona com 2022 — o equivalente brasileiro do "election needle" do NYT, tecnicamente mais simples e jornalisticamente mais defensável porque o Brasil tem dados melhores.

O produto deve suportar **20.000+ acessos simultâneos** no pico da noite eleitoral, com latência percebida **abaixo de 100ms globalmente**, sustentado por arquitetura "estado quente na borda" (Vercel Edge Config) + invalidação por tag.

## Contexto e Problema

No Brasil de 2026, o eleitor que quer acompanhar a apuração com profundidade enfrenta uma fragmentação irritante:

1. **TSE Divulga** mostra números brutos sem narrativa nem projeção
2. **TV** mostra projeção mas não permite explorar drill-downs
3. **Portais (G1, UOL, Folha)** competem entre si com layouts confusos e contagem manual de tempos de apuração
4. **Twitter/X** vira fonte primária de gente que faz "regra de três no Excel" sem rigor
5. **Ninguém** mostra **probabilidade de vitória** com intervalo de confiança, comparação visual com 2022, ou mapa coordenado de drill-down

## Oportunidade

O TSE expõe **dados públicos extraordinários** em near-real-time via CDN:

- Granularidade até seção eleitoral
- Histórico completo de 2018, 2022, 2024
- Atualizações a cada poucos segundos
- Acesso aberto, sem cadastro prévio: o pleito 2026 é regido pela **Resolução TSE 23.751/2026, arts. 264–269**, que não prevê figura de "interessado na divulgação" cadastrado. Há, porém, limites técnicos reais — 100 req/s por IP sob pena de bloqueio de 10 minutos (ver [reference/regulatory.md](../reference/regulatory.md) e [reference/tse-2026-leiautes.md](../reference/tse-2026-leiautes.md))

A infraestrutura brasileira é **mais favorável** que a americana para construir um needle: tudo eletrônico, sem voto antecipado, sem voto por correio, totalização centralizada. O NYT precisa modelar viés temporal por estado — nós não.

## Visão de Produto

> "A página que todo brasileiro vai abrir às 17h01 do dia da eleição."

Uma narrativa visual única que combina: **projeção** (onde vamos parar) + **apuração** (onde estamos agora) + **comparação** (como isso se compara a 2022) — em uma interface coordenada onde hover em qualquer entidade conecta automaticamente todas as visualizações da mesma entidade.

## Janela-alvo

- **1º turno**: 04/10/2026
- **2º turno**: 25/10/2026
- **Janela crítica de operação**: 17h–04h dos dias D
