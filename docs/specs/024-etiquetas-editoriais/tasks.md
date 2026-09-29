---
id: 024-etiquetas-editoriais
type: tasks
status: in_progress
spec: docs/specs/024-etiquetas-editoriais/spec.md
started: 2026-09-29
---

# Tasks — spec 024 (Etiquetas editoriais) · frente B: infraestrutura

Escopo desta frente: tudo **desligado** e **sem página**. As telas (spec 025)
vêm depois. Baseline antes da frente, no worktree: vitest 4.208 passados
(10 arquivos de integração que exigem banco falham na coleta, como na `main`).

## Documentação

- [x] T1. `spec.md` (RF-220..RF-239, EARS), `design.md`, este `tasks.md`.
- [x] T2. `editorial/README.md` — guia leigo de preenchimento, compilação,
      publicação, chaves de visão e reversão.

## lib/

- [x] T3. `lib/etiquetas/catalogo.ts` — categorias, valores, rótulos, ordem,
      matriz alvo × categoria, herança, sentinela, limiares 65/35/30, colchão 5,
      corte 03/09, mapeamento da trajetória, `SEM_PARTIDO`, ordem dos blocos,
      visões e `CATEGORIA_DA_VISAO` (RF-220).
- [x] T4. `lib/etiquetas/formato.ts` — contrato dos gerados, guardas,
      `normalizarSqcand`, `normalizarSigla`, `registroPublico` (RF-228/229/232).
- [x] T5. `lib/etiquetas/resolver.ts` + `montagem.ts` — precedência e turno
      (RF-223/224/225), derivados da Câmara e do Senado.
- [x] T6. `lib/etiquetas/leitor.ts` + `embutido.ts` + `caminhos.ts` — Blob
      (revalidate 60) × cópia do build, maior versão, chaves desligadas no
      build, junção por sqcand (RF-231/232).
- [x] T7. `lib/etiquetas/portao.ts` — portão de cobertura (RF-233).
- [x] T8. `lib/etiquetas/juncao.ts` — junção que preserva a ordem (RF-238).
- [x] T9. `lib/etiquetas/vigia.ts` — avaliação do vigia (RF-234).

## data-pipeline/ e scripts/

- [x] T10. `etiquetas-csv.ts`, `etiquetas-universo.ts` (5 colunas do TSE),
      `etiquetas-insumos.ts` (foto do Senado + 4 derivados, recusa de dado
      pessoal) (RF-221/222/226/227/229).
- [x] T11. `etiquetas-nucleo.ts` + `etiquetas-compilar.ts` — validação tudo ou
      nada, meta preservada, histórico append-only; `pnpm etiquetas:compilar`
      e `pnpm etiquetas:conferir` (RF-222..229, RF-239).
- [x] T12. `etiquetas-publicar.ts` — árvore limpa, HEAD vs `origin/main`,
      validador + deriva, versão monotônica, lista branca, `cacheControlMaxAge`
      60, nacional por último; `pnpm etiquetas:publicar` (RF-230).
- [x] T13. `scripts/etiquetas-vigia.ts` — env por lista branca, exit 0/2/1;
      `pnpm etiquetas:vigia` (RF-234). **Não agendado.**
- [x] T14. Fontes vazias (`editorial/etiquetas/*.csv` só com cabeçalho,
      `publicar.json` tudo `false`) e primeira compilação: 29 gerados, tudo
      `a_classificar`, versão 1790658482.

## components/

- [x] T15. `EtiquetaEditorial` + `.module.css` (tokens locais `--etq-*`),
      `EtiquetasLinha`, `EtiquetasAviso` + `.module.css` (RF-235/236/237).

## Testes (160 novos em 11 arquivos: vitest 4.208 → 4.367 passados + 1 pulado — a deriva, sem o cadastro do TSE no worktree)

- [x] T16. `tests/unit/etiquetas/{catalogo,portao,leitor,vigia,juncao}.test.ts`
      + `_fixtures.ts` + `ordem-invariante.ts` (auxiliar para a spec 025).
- [x] T17. `tests/unit/data-pipeline/etiquetas-{nucleo,fontes,publicar,deriva}.test.ts`.
- [x] T18. `tests/unit/components/EtiquetaEditorial.test.tsx`,
      `tests/unit/design-system/etiqueta-editorial-contraste.test.tsx`.

## 🔴 MUTAÇÃO — aplicadas à mão, uma por vez, arquivo restaurado e conferido por sha

| # | Mutação | Onde | Morta por |
|---|---|---|---|
| M1 | portão sem união das bases (Parcial desligada) | `portao.ts` | "UNIÃO das bases…", "sem número numa base…" |
| M2 | colchão off-by-one (`<=`+tolerância → `<`) | `portao.ts` | "a exatamente 5,0 pp… DENTRO", "tolerância… 23,4 − 18,4" |
| M3 | anulado não excluído | `portao.ts` | "anulado não conta…", "pré-eleição…", "universo exigido…" |
| M4 | precedência invertida (partido antes do individual) | `resolver.ts` | "individual > partido", "derivado vence o partido…" |
| M5 | valor do 2º turno vazando para o 1º | `resolver.ts` | "valor do 2º turno não vaza para o 1º" |
| M6 | `≥` → `>` em 65 | `etiquetas-nucleo.ts` | "taxa exatamente 65 ⇒ base", "vários ids…" |
| M7 | `≤` → `<` em 35 | `etiquetas-nucleo.ts` | "taxa exatamente 35 ⇒ oposição" |
| M8 | regra do mínimo de 30 votos removida | `etiquetas-nucleo.ts` | "29 votos ⇒ amostra pequena", "vários ids…", "derivado… amostra pequena cai no partido" |
| M9a | `a_classificar` renderizado (componente cai no id cru) | `EtiquetaEditorial.tsx` | "nunca renderiza a_classificar…" |
| M9b | `a_classificar` renderizado (catálogo sem a guarda) | `catalogo.ts` | "nunca renderiza…", "rotuloDoValor nunca devolve texto…" |
| M10a | compilador não exige `fonte_url` | `etiquetas-nucleo.ts` | "exige fonte_url", "exige fonte_url sem http" |
| M10b | compilador não exige `data` | `etiquetas-nucleo.ts` | "exige data vazia", "exige data impossível" |
| M10c | compilador não exige `revisado` | `etiquetas-nucleo.ts` | "exige revisado vazio" |
| M11 | `revisado=nao` publicado | `etiquetas-nucleo.ts` | "revisado=nao compila como se não existisse", "…vale o partido" |
| M12a | campo pessoal (nome civil) no universo | `etiquetas-universo.ts` | "conjunto EXATO de chaves de CandidaturaUniverso" |
| M12b | `nota` vazando para o gerado | `etiquetas-nucleo.ts` | "a coluna `nota` nunca chega ao gerado" |
| M12c | publicador copiando campos fora do contrato | `etiquetas-publicar.ts` | "`nota` e qualquer campo fora do contrato ficam para trás" |
| M13 | etiqueta mudando a ordem (classificados primeiro) | `juncao.ts` | "mesma ordem com etiqueta presente, ausente, parcial ou trocada" |
| M14 | cópia do build com chaves ligadas | `leitor.ts` | "cópia do build ⇒ chaves desligadas…" |
| M15 | Blob vence no empate de versão (`>=`) | `leitor.ts` | "Blob só vence com versão ESTRITAMENTE maior" |

Nenhuma sobreviveu. Roteiro reproduzível: substituição literal única por
mutação, `npx vitest run <arquivos do alvo>`, restauração e `shasum -c`.

## Verificações feitas

- [x] `pnpm typecheck`, `pnpm lint` (árvore inteira) limpos.
- [x] Teste de deriva com o cadastro do TSE (`ETIQUETAS_TSE_CACHE`): passa;
      sem o cadastro: pulado com o motivo.
- [x] Junção com a fixture do simulado: 106/106 Governador, 107/107 Senador,
      2.648/2.648 deputados (`sqcand` número).
- [x] Vigia contra `scripts/edge-config-falso.ts`: 214 alertas, exit 2.
- [x] `next build` compila (falha depois, na coleta de `/api/ingest`, por falta
      de `DATABASE_URL` no worktree — pré-existente) e `next dev` serve uma rota
      temporária que carregou SP e RJ pela cópia do build; rota apagada.

## Pendente (fora desta frente)

- [ ] Números dos ADRs conferidos na barreira; `traceability.md`, `index.json`,
      `components.md`, `tokens.md`, `folder-structure.md` (`editorial/`) — `spec-syncer`.
- [ ] Spec 025: páginas, `/sobre-as-etiquetas`, filtro, visões.
- [ ] Preenchimento das classificações (frente D) e publicação pelo dono.
- [ ] Agendar o vigia (decisão do dono).
