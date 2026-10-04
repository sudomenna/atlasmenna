---
title: Mapas no Mobile — Tap to Select e gestos de zoom
description: Substitui hover por click; bottom sheet abre via consumer; zoom por gestos cooperativos abaixo de 960px
status: stable
source: PRD.md § 15.5
---

# Mobile — Tap to Select

```ts
if (isMobile) {
  map.on('click', 'municipios-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    useHoverStore.getState().setHovered(
      { type: 'municipio', codIbge: feature.properties.CD_MUN },
      'map'
    );
    // Bottom sheet abre automaticamente via consumer
  });
}
```

## Gestos de zoom (ADR-0071, 2026-10-03)

Vale para os dois mapas MapLibre no ar (Brasil por UF e estado por município). O modo é escolhido pela
**largura** (`matchMedia("(min-width: 960px)")`, o corte de `AppShellSplit`), não pelo ponteiro, e troca ao vivo
quando a largura muda.

| | < 960px (celular / tela estreita) | ≥ 960px (desktop) |
|---|---|---|
| Um dedo | **rola a página** (o mapa não consome o gesto) | — |
| Dois dedos | movem e ampliam o mapa (pinça) | — |
| Mouse | só **Ctrl/⌘ + roda** amplia; roda sozinha rola a página | roda e pinça do trackpad ampliam, centradas no cursor; arrastar com o botão do mouse move |
| Aviso | pt-BR: "Use dois dedos para mover o mapa" / "Use Ctrl/⌘ + rolagem para ampliar o mapa" | — |
| Botões +/−/⟲ | na **faixa abaixo do mapa** (`mobileChrome > .bar`), alvo `--tap-min` (44px); **nada sobre o mapa** (ADR-0056) | sobre o mapa, canto inferior direito do cromo, sem cobrir a legenda |

Nos dois modos: duplo clique/toque duplo **não** amplia (o 1º toque abre a ficha, ADR-0050); rotação, `boxZoom`,
teclado do canvas e cópias do mundo ficam desligados; o balão de passar o mouse fecha no `movestart`/`zoomstart`.

**Limites**: o zoom mínimo é o enquadramento inicial (Brasil nunca abaixo de z2 + 0,15, onde o desenho some); o
máximo é enquadramento + 4 (Brasil) ou z11 (estado); o arraste fica numa caixa ~25% maior que o país/estado. O
reset (⟲) volta ao enquadramento e fica desabilitado enquanto a câmera já está nele.

**Acessibilidade**: as animações dos botões não usam `essential: true` — sob `prefers-reduced-motion` o MapLibre
zera a duração (RNF-026). O canvas do mapa do Brasil não entra na ordem de Tab; o teclado usa os botões, e a
tabela/lista paralela segue como alternativa (RNF-025).

> **Verificação**: a pinça de dois dedos não se emula em ferramenta automatizada; só se confirma num aparelho real.

## Cross-refs

- RF-049, RF-050 (mobile tap, bottom sheet): [../specs/008-interatividade-brushing/spec.md](../specs/008-interatividade-brushing/spec.md)
- RF-292, RF-293 (zoom por largura, limites e botões): [../specs/003-home-nacional/spec.md](../specs/003-home-nacional/spec.md)
- Decisão: [ADR-0071](../architecture/adrs/0071-interacao-de-zoom-nos-mapas.md); cromo em fluxo no celular:
  [ADR-0056](../architecture/adrs/0056-mapa-celular-cromo-em-fluxo-versao-b.md)
- Componente `<BottomSheet />`, `<MapZoomControls />`: [../design-system/components.md](../design-system/components.md)
