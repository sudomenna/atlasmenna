# Atlas Menna — kit de design (export do Claude Design, 2026-09-07)

Cópia fiel do export `Design system para apuração eleitoral.zip` (projeto Claude Design
`a2991f9b-6ed8-40ac-88a7-308c8dc9ea42`), **sem** `assets/geo/` (TopoJSON de 1,2 MB — o
AtlasMenna usa MapLibre + PMTiles, ADR-0003/0004).

- `readme.md` — fundamentos do design (leia primeiro).
- `tokens/` — `colors.css` (light + `[data-theme=dark]`), `typography.css`, `spacing.css`, `fonts.css`, `base.css`.
- `components/` — 17 componentes React (inline-style) com `.d.ts` e `.prompt.md`.
- `ui_kits/atlas-menna/` — protótipo completo (`index.html`, `App.jsx`, `MapView.jsx`, `data.js`).
- `guidelines/` — 14 cards de fundamentos.

## Como ver o protótipo

O `index.html` faz `fetch` dos componentes e (no original) dos mapas; abrir via `file://` não
funciona. Sirva esta pasta e abra `ui_kits/atlas-menna/index.html`:

```bash
npx serve docs/design-system/atlas-menna
```

Sem `assets/geo/` o mapa do protótipo fica em "carregando geometria…"; tudo o mais renderiza.
Para o mapa, extraia o zip original em outra pasta.

## Como este kit é aplicado no AtlasMenna

Ver ADR-0025 (adoção por restyle-in-place, tokens em Tailwind v4 `@theme static`), ADR-0024
(paleta por partido) e `docs/design-system/tokens.md`. Divergências deliberadas: wordmark
"AtlasMenna"; mapa MapLibre; Senado 2026 tem **2 vagas por UF** (o protótipo diz 1); rodapé
constitucional em vez de "Protótipo com dados simulados".
