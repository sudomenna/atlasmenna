# Bandeiras das 27 unidades federativas — proveniência

Mesmo papel de `scripts/data/party-official-hexes.json`: **dado-fonte
versionado, para auditoria**. Os SVG deste diretório **não são lidos por código
de runtime nem pelo build** — o site serve os arquivos rasterizados de
`public/bandeiras/`, gerados a partir daqui pela receita abaixo.

- **Fonte (este diretório)**: 27 SVG originais, nomeados pela sigla em
  maiúsculas, exatamente como baixados do Wikimedia Commons.
- **Servido**: `public/bandeiras/<SIGLA>.webp` — 60 px de altura, WebP q90,
  0,5–1,9 KB cada, ~29 KB as 27.
- **Render**: `<UfFlag sigla="AC" />` (`components/atoms/data/UfFlag.tsx`), um
  `<img src="/bandeiras/AC.webp" alt="">`.
- **Decisão**: [ADR-0070](../../../docs/architecture/adrs/0070-bandeiras-de-uf-em-webp-same-origin-no-lugar-do-sprite-svg-inline.md)
  (decisão do dono, 2026-10-03).

```
AC.svg AL.svg AM.svg AP.svg BA.svg CE.svg DF.svg ES.svg GO.svg
MA.svg MG.svg MS.svg MT.svg PA.svg PB.svg PE.svg PI.svg PR.svg
RJ.svg RN.svg RO.svg RR.svg RS.svg SC.svg SE.svg SP.svg TO.svg
```

## Arquitetura: arquivo no nosso domínio + `<img>`

De 2026-09-18 a 2026-10-03 o desenho era outro: um gerador
(`scripts/gen-uf-flags.ts`, removido) embutia os 27 SVG no HTML como sprite
`<symbol>`, com teto de 4 KB por bandeira e 60 KB o sprite. Ele nunca chegou a
receber uma bandeira — e não aguentaria as reais. Depois de otimizadas com
`svgo`, as que têm brasão pesam **AL 147 KB, RJ 66, RN 54, PR 37, RS 28, SC 26,
CE 8, AM 5** — várias vezes o teto. E `/deputado-federal` media 307,8 KiB de um
teto de 320 KiB para o documento HTML (`docs/nfr/performance.md`), com o sprite
contado **duas vezes**: no markup e de novo no payload RSC.

O que ficou, e por quê:

- **Raster pequeno, não SVG.** A bandeira aparece entre 17 e 34 px de largura.
  Nesse tamanho o brasão é uma mancha de cor de qualquer jeito, e o WebP de
  60 px de altura cobre telas de densidade 2× e 3× com folga, a 0,5–1,9 KB.
- **No nosso domínio (`public/`), não em CDN de terceiro.** Sem dependência
  externa na noite da apuração, sem DNS/TLS a mais, sem terceiro sabendo quem
  lê o site.
- **`<img>` comum, não `next/image`.** Zero JavaScript de aplicação; o
  arquivo já está no tamanho final. O HTML só ganha a tag (~110 bytes), e a
  imagem vai para o cache do navegador uma vez para todas as telas.
- **Decorativa (`alt=""`).** Onde a bandeira aparece, o nome do estado e/ou a
  sigla estão em texto ao lado (RF-162/163, constituição § 4).
- **Sigla fora das 27 ⇒ nada.** `<UfFlag>` devolve `null` — nunca um `<img>`
  apontando para arquivo inexistente.

Onde aparece: grade "Estado a estado" de Deputado (`UfBandeirasGrid`), seletor
de UF (`UfPicker`), cartões de governador/senado/presidente por UF
(`GovernorCard`) e o `<h1>` das páginas de UF. **Não** aparece na grade sem
payload (`UfLinksGrid`, spec 019 — de propósito sem bandeira), nem em balão de
mapa ou na folha do estado (`StateResultSheet`).

## Guarda de tamanho

O teste `tests/unit/components/UfFlag.test.tsx` exige, em `public/bandeiras/`,
**exatamente** os 27 `.webp` (nenhum a mais — nem `BR.webp`) e **≤ 3 KB cada**.
Substitui os tetos de 4 KB/60 KB do gerador antigo: é o portão que impede
alguém de colar um arquivo de 200 KB sem perceber.

## Receita de regeneração

Com o `sharp` que já vem no `node_modules` como dependência transitiva do Next
(`sharp@0.34.5` na geração de 2026-10-03). Ele **não** fica em
`node_modules/sharp` — o pnpm o guarda em `node_modules/.pnpm/` —, daí o
`createRequire`. A partir da raiz do repositório:

```bash
node --input-type=module -e "
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/');
const sharp = require('sharp');
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
for (const uf of UFS) {
  await sharp('scripts/data/bandeiras-uf/' + uf + '.svg', { density: 300 })
    .resize({ height: 60 })
    .webp({ quality: 90 })
    .toFile('public/bandeiras/' + uf + '.webp');
}"
```

Conferido em 2026-10-03: com `sharp@0.34.5`, a receita reproduz os arquivos
commitados **byte a byte** (as 27 comparadas com `cmp`). Outra versão do
`sharp` (ou da `libvips`) pode mudar alguns bytes sem mudar a imagem.

`density: 300` rasteriza o SVG com resolução de sobra antes de reduzir — sem
ele, o brasão sai serrilhado. Largura resultante: 83–90 px (as proporções vão
de 1,38 a 1,50); o componente usa caixa fixa com `object-fit: cover`.

Depois de regenerar: rodar o teste acima (tamanho e contagem) e olhar as 27 lado
a lado antes de commitar.

## Fonte de cada arquivo

Todas do **Wikimedia Commons**, localizadas pela propriedade P41 ("imagem da
bandeira") do item Wikidata de cada estado e baixadas em **2026-10-03**. A
licença foi conferida no `extmetadata` do Commons: **domínio público** em
todas (símbolos oficiais definidos em lei estadual).

| Sigla | Arquivo no Commons | Licença | Data |
|---|---|---|---|
| AC | Bandeira do Acre.svg | Domínio público | 2026-10-03 |
| AL | Bandeira de Alagoas.svg | Domínio público | 2026-10-03 |
| AM | Bandeira do Amazonas.svg | Domínio público | 2026-10-03 |
| AP | Bandeira do Amapá.svg | Domínio público | 2026-10-03 |
| BA | Bandeira da Bahia.svg | Domínio público | 2026-10-03 |
| CE | Bandeira do Ceará.svg | Domínio público | 2026-10-03 |
| DF | Bandeira do Distrito Federal (Brasil).svg | Domínio público | 2026-10-03 |
| ES | Bandeira do Espírito Santo.svg | Domínio público | 2026-10-03 |
| GO | Flag of Goiás.svg | Domínio público | 2026-10-03 |
| MA | Bandeira do Maranhão.svg | Domínio público | 2026-10-03 |
| MG | Bandeira de Minas Gerais.svg | Domínio público | 2026-10-03 |
| MS | Bandeira de Mato Grosso do Sul.svg | Domínio público | 2026-10-03 |
| MT | Bandeira de Mato Grosso.svg | Domínio público | 2026-10-03 |
| PA | Bandeira do Pará.svg | Domínio público | 2026-10-03 |
| PB | Bandeira da Paraíba.svg | Domínio público | 2026-10-03 |
| PE | Bandeira de Pernambuco.svg | Domínio público | 2026-10-03 |
| PI | Bandeira do Piauí.svg | Domínio público | 2026-10-03 |
| PR | Bandeira do Paraná.svg | Domínio público | 2026-10-03 |
| RJ | Bandeira do estado do Rio de Janeiro.svg | Domínio público | 2026-10-03 |
| RN | Bandeira do Rio Grande do Norte.svg | Domínio público | 2026-10-03 |
| RO | Bandeira de Rondônia.svg | Domínio público | 2026-10-03 |
| RR | Bandeira de Roraima.svg | Domínio público | 2026-10-03 |
| RS | Bandeira do Rio Grande do Sul.svg | Domínio público | 2026-10-03 |
| SC | Bandeira de Santa Catarina.svg | Domínio público | 2026-10-03 |
| SE | Bandeira de Sergipe.svg | Domínio público | 2026-10-03 |
| SP | Bandeira do estado de São Paulo.svg | Domínio público | 2026-10-03 |
| TO | Bandeira do Tocantins.svg | Domínio público | 2026-10-03 |

A bandeira nacional (`Flag of Brazil.svg`) foi baixada junto mas **não** está
aqui nem em `public/`: nenhuma tela a usa.
