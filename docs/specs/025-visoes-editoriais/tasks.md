---
id: 025-visoes-editoriais
type: tasks
status: in_progress
spec: docs/specs/025-visoes-editoriais/spec.md
started: 2026-09-29
---

# Tasks — spec 025 (Visões editoriais)

Frente F do plano de 29/09. Worktree isolado, avançado por fast-forward até `4ad6e5f` (main com a
V3 da outra frente e os derivados do Senado); sem commit (o orquestrador mescla). Faixa de RF
reservada RF-240..RF-259, conferida por grep (nenhum uso anterior); usados RF-240..RF-253.

## Documentação

- [x] T1. `spec.md`, `design.md`, `tasks.md`.
- [x] T2. Emendas curtas: 006 (/governador: filtro, chips, V3), 017 (a regra "sem 257" vale só
      para a visão por partido; Câmara 2027), 004 (Presidente sem etiqueta), 005 (chips na UF),
      011 (parágrafo com link), 016 (/senador: V1/V2/V4/filtro), 018 (/candidatos).
- [x] T3. Spec 024 emendada (RF-228, RF-231, open questions 2 e 5 resolvidas; design § 2.1,
      § 2.3, § 3.3, § 6, § 7), `editorial/README.md` ("deploy não apaga visão"), ADR-0060 com a
      seção "Emenda 2026-09-29". **Não** tocados: `docs/_meta/*`, `docs/README.md`,
      `components.md` (spec-syncer, na barreira).

## 0. Armadilha da spec 024 (RF-253)

- [x] T4. `lerChavesPublicacao` movido para `lib/etiquetas/formato.ts` (reexportado pelo
      publicador); o compilador lê `editorial/etiquetas/publicar.json` (ausente/inválido ⇒ erro) e
      grava as chaves na cópia do build, FORA do `conteudo_sha256`.
- [x] T5. Leitor honra as chaves de qualquer fonte (sem forçar `false` no build).
- [x] T6. Publicador recusa `publicar.json` ≠ chaves da cópia do build.
- [x] T7. Testes: "deploy depois da publicação NÃO apaga as visões" (leitor), "publicar.json vai
      para a cópia do build sem mudar a versão" (núcleo), recusa por divergência (publicador),
      deriva (`publicar.json` válido e igual ao compilado). `pnpm etiquetas:conferir` em dia (o
      `publicar.json` versionado é todo `false`, então o gerado não muda).

## 1. Hemiciclo por bloco (RF-240/241)

- [x] T8. `lib/utils/hemiciclo-bloco.ts`: `layoutPorBloco` (desempate tolerante por arco),
      `limiaresDaCasa` (do total), `marcaDoBloco` (com `raioCorte` no empate).
- [x] T9. `Hemiciclo.tsx`: props opcionais `folga`, `defs`, `sobreposicao`, `tracejado` — retrato
      da Câmara byte a byte igual (`camara-hemiciclo-retrato.test.tsx` verde).
- [x] T10. `components/blocks/HemicicloPorBloco.tsx` (texturas em tinta neutra, marcas, placar dos
      dois lados, nota do empate, `<desc>` "relação com o governo Lula, não posição ideológica").
- [x] T11. Testes: geometria, componente, neutralidade (ΔE ≥ 10 nos dois temas), peso (81 < 12 KiB,
      513 < 36 KiB).

## 2–4, 8. Visões agregadas

- [x] T12. `lib/etiquetas/visoes.ts` — três portas (chave, critério, portão); V1, V2, Câmara 2027,
      V4. `avaliarUniverso` novo em `portao.ts`. `senado-2027.ts` exporta `vagasDerivadas` com
      identidade (mesma derivação). `Etiquetas` ganhou `universo`, `federacaoDoPartido`,
      `nacional`, `arquivoUf`; `lerHistoricoEtiquetas`.
- [x] T13. `SenadoDe2027Panel` (V1 + V2), `Camara2027Panel`, `RenovacaoPanel`;
      `lib/senado/mandato-2027.ts`.
- [x] T14. Páginas: `/senador` (depois do hemiciclo por partido), `/deputado-federal` (depois do
      painel da Câmara).
- [ ] T15. **Câmara 2027 deputado a deputado depois do resultado** — exige ler os 27 payloads de
      UF (ou um agregado novo) em `/deputado-federal`. W3.
- [ ] T16. **V4 de Governador** — a trajetória de governador existe só como rascunho não revisado
      (`governador.csv`, 200 linhas de 29/09, `revisado=nao`) e o critério de "quem ocupa o cargo"
      no 2º turno não está escrito. Só Senado por ora.

## 5–7. Etiquetas nas telas, filtro, metodologia

- [x] T17. `lib/etiquetas/telas.ts` (`exibiveis`, `etiquetasDasCorridas`, `editorialDaCapa`,
      `etiquetasDaLista`, `opcoesDoFiltro`), usando `comEtiquetas` (juncao.ts).
- [x] T18. `GovernorCard` (chip dentro do `<span>` do nome, na posição do selo — sem etiqueta a
      lista de filhos é a de antes; `data-etq` por spread), `CandidateResultRow`/`ResultPanel`
      (linha sob o nome + aviso no painel), `CandidatosGrid` (sob o cartão + aviso).
- [x] T19. `EtiquetaEditorial`: critério publicado é porta (RF-250); impeachment sempre
      qualificado (RF-246); `text-transform: none`; quebra em vez de invadir a barra (visto no
      navegador).
- [x] T20. `EtiquetaFiltro` + CSS module (20 regras, uma por token, `:global` sob
      `biome-ignore-start/end`); `/senador` (esconde região vazia), `/governador` (ao lado do
      filtro de status; região fica).
- [x] T21. Critérios no catálogo (`CRITERIOS`): relação com o governo e trajetória. Os outros
      quatro ficam `null` — "critério em definição".
- [x] T22. `/sobre-as-etiquetas` + `lib/etiquetas/metodologia.ts`; parágrafo em `/sobre-o-modelo`
      (seção 6, sem `<h2>`).
- [x] T23. Comentários "não classifica partido" reescritos (`CamaraHemiciclo.tsx`,
      `lib/utils/bancada.ts`, `GovernadoresPorPartido.tsx`).

## 9. V3 (mapa dos palanques)

- [x] T24. Ligado em `/governador` por `components/blocks/_palanques-capa.ts`
      (`palanquesDaCapa`): três portas; só então UMA leitura do payload de Presidente
      (`resultadoEleitoral` → `readProjection({ cargo: "pres", turno })`); painel "Palanques
      presidenciais nos estados" logo depois do "1º ou 2º turno". Hoje não aparece: palanque sem
      critério publicado.

## Validação

- [x] T25. `pnpm lint` limpo; `pnpm typecheck` limpo.
- [x] T26. `pnpm test`: **4951 passando, 1 pulado**; só os 10 arquivos que exigem `DATABASE_URL`
      não coletam (worktree sem `.env.local`, anterior a esta frente).
- [x] T27. `pnpm build` (com `DATABASE_URL` postiço apontando para `127.0.0.1:9` — o build coleta
      `/api/ingest/*`, que avalia `neon()` no carregamento; nenhuma conexão é feita) +
      `pnpm start:e2e` + `pnpm test:e2e`: **118 passed, 18 skipped, 0 failed**.
      `/sobre-as-etiquetas` entrou nas rotas de a11y (verde nos 2 temas × 2 larguras) e de peso;
      `/senador` entrou nas de peso.
- [x] T28. Verificação visual em `dev:sim` com etiquetas de TESTE compiladas no scratchpad (cópia
      de `editorial/`, nada versionado), servidas por um Blob falso só-leitura em 127.0.0.1:3102, e
      `categoriaExibivel` forçado a `true` só durante a verificação (revertido; conferido por
      grep): V1, V2, filtro (contagem, regiões, ordem intacta), chips (sem invadir a barra depois
      do ajuste), V3 no tema escuro, Câmara 2027, página de UF do Senado, metodologia; 375 px sem
      rolagem lateral.

### 🔴 MUTAÇÃO — aplicadas à mão, todas mortas

| # | Mutação | Onde | Morta por |
|---|---|---|---|
| M0 | cópia do build volta a forçar chaves desligadas | `leitor.ts` | leitor: "deploy depois da publicação…" + "cópia do build ⇒ chaves do publicar.json" |
| M1 | portão ignorado (V1) | `visoes.ts` | visoes: 2 casos de portão; painéis: "portão fechado ⇒ HTML vazio" |
| M2 | chave de visão ignorada | `visoes.ts` | 5 casos "desligada ⇒ nada" |
| M3 | `a_classificar` vai à tela (id cru) | `EtiquetaEditorial.tsx` | "nunca renderiza a_classificar…" |
| M4 | ordem dos blocos trocada (Oposição à esquerda) | `catalogo.ts` | visoes + HemicicloPorBloco (ordem fixa) |
| M5 | marca em k/k+1 em vez de k−1/k | `hemiciclo.ts` | "49 no Senado…" + "41 cai dentro da coluna…" |
| M6a | filtro reordena (`order`) em vez de esconder | CSS do filtro | "as regras só ESCONDEM" |
| M6b | filtro move nós (reanexa os que casam) | `EtiquetaFiltro.tsx` | "NÃO mexe na ordem da página" |
| M7 | chip interativo dentro do `<a>` (`tabIndex`) | `EtiquetaEditorial.tsx` | "nunca interativa — pode morar dentro de um <a>" |
| M8 | impeachment sem qualificador ("A favor" solto) | `EtiquetaEditorial.tsx` | 3 casos "a frase inteira é VISÍVEL" |
| M9 | `/sobre-o-modelo` ganha um `<h2>` | `sobre-o-modelo/page.tsx` | teste de estrutura (8 `<h2>`) + o do parágrafo |
| M10 | critério não publicado não barra a etiqueta | `catalogo.ts` | V2 sem critério; painéis |
| M11 | cartão põe quem tem chip primeiro | `GovernorCard.tsx` | invariância de ordem do cartão |
| M12 | publicador aceita `publicar.json` ≠ build | `etiquetas-publicar.ts` | "publicar.json diverge ⇒ recusa" |
| M13 | compilador ignora o `publicar.json` | `etiquetas-nucleo.ts` | núcleo + leitor |
| M14 | portão da Câmara 2027 ignorado | `visoes.ts` | "agremiação com cadeira sem padrão ⇒ oculta" |
| M15 | V3 lê Presidente mesmo sem critério | `_palanques-capa.ts` | `palanques-capa.test.ts` (a 1ª versão SOBREVIVEU: o teste de página tinha o portão fechado por outro motivo; o caso isolado com portão aberto mata) |

## Achados para o orquestrador

- 🔴 **`/governador` já passa do teto de peso do documento** (300 KiB): 324.213 B medidos no
  servidor e2e com as etiquetas DESLIGADAS — peso anterior a esta frente (consolidado por região do
  ADR-0057 + 27 cartões duas vezes, HTML e payload RSC do `<RegiaoRecolhivel>`). Por isso a rota
  NÃO entrou em `perf-budget.spec.ts` (nota no arquivo); decisão do dono.
- **Critérios**: sem critério publicado, campo ideológico, palanque, centrão e impeachment não vão à
  tela (RF-250) — V2 e V3 ficam apagados mesmo ligados. O critério mora no catálogo (código):
  precisa entrar ANTES do deploy de 03/10.
- **Canal de correção**: não há e-mail de redação no site; a metodologia aponta para o repositório
  público.
- **Peso dos chips**: pior caso +4,3 KiB por cartão (27 cartões ⇒ ~116 KiB antes de gzip); hoje,
  com 2 categorias exibíveis, ~15 KiB.
- **Build local no worktree** precisa de um `DATABASE_URL` qualquer (não carregar `.env.local`).
