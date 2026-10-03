---
title: Casos de Uso
description: Casos de uso primários e secundários do AtlasMenna mapeados a personas
status: stable
source: PRD.md § 4.2
---

# Casos de Uso

| ID | Caso de Uso | Persona | Frequência |
|---|---|---|---|
| UC-01 | Visualizar projeção nacional presidencial | P1, P4 | Sempre |
| UC-02 | Ver UFs decisivas com status rápido | P1, P4 | Alta |
| UC-03 | Drill-down em UF específica | P1, P2, P3 | Alta |
| UC-04 | Comparar resultado atual com 2022 | P1, P2, P3 | Média |
| UC-05 | Acompanhar 27 governadores em paralelo | P1, P2 | Média |
| UC-06 | Ver mapa de swing por município | P2, P3 | Média |
| UC-07 | Entender como o modelo funciona | P2, P3 | Baixa mas crítica para credibilidade |
| UC-08 | Compartilhar snapshot atual em redes | P1, P2 | Alta |
| UC-09 | Drill-down de município (capitais) | P3 | Baixa |
| UC-10 | Acompanhar % apurado por UF | P1 | Alta |
| UC-11 | Ver série temporal da projeção | P2, P3 | Média |
| UC-12 | Ver o que está "movendo" o modelo agora | P2, P3 | Baixa |
| UC-13 | Acompanhar paralelamente em segunda tela | P1 | Alta |
| UC-14 | Recarregar página/aba aberta por horas | P1 | Constante |

## Fluxos de uso primários

### Fluxo Principal: "Quem está ganhando?"

```
[Usuário acessa /] →
  [Vê agulha + projeção nacional] →
  [Decide se quer profundidade] →
    SIM → [Scroll para UFs decisivas] →
            [Click em SP] →
              [Vê /uf/sp] →
                [Hover em município] →
                  [Vê todas as visualizações destacarem] →
                    [Decide se quer mais] →
                      SIM → [Click no município] → [/uf/sp/municipio/3550308]
                      NÃO → [Volta para nacional]
    NÃO → [Sai (sessão de 30s, principal P4)]
```

### Fluxo Secundário: "Acompanhar governador do meu estado"

```
[Usuário acessa /] →
  [Click em tab "Governador"] →
    [Vê /governador, grid das 27] →
      [Click em "MG"] →
        [Vê /uf/mg/governador] →
          [Acompanha com aba aberta]
```

### Fluxo de Atualização Live (background, todos os clientes)

```
Background loop:
  [SWR poll /api/projection a cada 5s] →
    [Recebe payload (cacheado pela CDN, hit em 99%)] →
      [Diff com último estado] →
        [Atualiza apenas componentes afetados (selectors finos)] →
          [Anima transições com Framer Motion]
```

---

## Cross-refs

- Personas: [./personas.md](./personas.md)
- Specs que atendem cada UC: ver matriz em [../_meta/traceability.md](../_meta/traceability.md)
