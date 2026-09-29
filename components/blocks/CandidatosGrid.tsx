/**
 * components/blocks/CandidatosGrid.tsx
 *
 * RF-146 / RF-148 / RF-149 — a grade de candidaturas de UMA corrida
 * (um cargo, uma UF), já filtrada pelo chamador.
 *
 * **Puro e burro de propósito.** Não lê Blob, não conhece `searchParams`, não
 * decide publicabilidade nem situação. Recebe a lista pronta e a desenha — é o
 * que permite o mesmo bloco servir `/candidatos` (T-13) e o estado "aguardando
 * dados" das páginas de cargo (T-14, RF-149) sem uma segunda implementação.
 *
 * Server Component puro: zero JS novo (RF-146). Medido em 13/09 contra o build
 * de produção: `/candidatos` baixa as MESMAS 8 requisições de `/sobre-o-modelo`
 * — 150.285 B gz descontado o chunk `nomodule`, abaixo do piso de framework
 * registrado (RNF-007a-floor, 153.482 B). Pela definição vigente do RNF-007a
 * (ADR-0030: total medido − piso), o above-the-fold **de aplicação** desta rota
 * é zero e a folga é o orçamento inteiro de 150 KB. O que continua valendo é a
 * consequência, não o número: qualquer fronteira de cliente aberta aqui
 * deixaria de ser zero.
 *
 * ## `<ul>`/`<li>`, não tabela
 *
 * Não há relação linha × coluna aqui: cada célula é uma candidatura inteira, e
 * as colunas são acidente de largura de viewport. Marcar como `<table>` faria o
 * leitor de tela anunciar coordenadas que não significam nada. Lista semântica
 * com nome e partido em texto é o que o RNF-023 pede (RF-149, último critério).
 *
 * ## Ordem: por número, sempre
 *
 * Constituição § 2 — "nomes e siglas aparecem sempre na mesma ordem dentro de
 * uma mesma corrida" — e § 6 (determinismo). Ordenar por nome, por partido ou
 * por "relevância" introduziria critério editorial onde não pode haver nenhum.
 * O desempate por `sqcand` existe porque `(cargo, uf, numero)` **não é única
 * nem na fonte oficial**: 4 colisões sobrevivem ao filtro de publicabilidade,
 * todas cargo 6 na Bahia, duas delas com o mesmo nome no mesmo número
 * (ADR-0042 item 5). Sem ele, a ordem de duas candidaturas com o mesmo número
 * dependeria da ordem de leitura do banco.
 *
 * ## `content-visibility` — e por que ele não bastou
 *
 * Cargo 6 em São Paulo tem 1.061 candidaturas publicáveis. Sem
 * `content-visibility: auto`, o navegador faz layout e paint das 1.061 células
 * de uma vez. `contain-intrinsic-size` dá a altura estimada de uma célula
 * ainda não renderizada — sem ela, a barra de rolagem salta durante o scroll,
 * que é CLS (RNF-002) só que pior, porque acontece enquanto o leitor lê.
 *
 * O que `content-visibility` **não** resolve é a etapa anterior: o HTML
 * prerenderizado de `/uf/SP/deputado-federal` no estado de espera media
 * 4.015.398 bytes com 1.061 `<img>` (medido em 13/09 no build de produção).
 * Gzip cuida da rede — 109 KB na linha —, não da construção do DOM: o
 * navegador ainda parseia e materializa 1.061 subárvores antes de o
 * `content-visibility` ter o que pular. Daí o corte de exibição, abaixo.
 *
 * ## Corte de EXIBIÇÃO, nunca de cálculo
 *
 * `CANDIDATOS_POR_PAGINA` fatias de 60 por vez, e o corte é responsabilidade do
 * **chamador** — este bloco continua puro e recebe a lista já cortada. A regra
 * que a separação protege: nenhuma conta de cadeiras, percentual ou projeção
 * pode enxergar a lista cortada. Este arquivo não faz conta nenhuma, e é assim
 * que tem que continuar.
 *
 * Por isso `total` é um prop separado de `candidatos.length`: quem corta sabe o
 * tamanho real da corrida, e a contagem na tela é a REAL, nunca a da fatia
 * exibida. Uma tela que dissesse "60 candidaturas" numa corrida de 1.061
 * mentiria por generalização — exatamente o que a constituição § 8 proíbe.
 *
 * ## Âncora estável por célula
 *
 * Cada `<li>` recebe `id="c-<índice global>"` (`ancoraCandidato`). É o que faz
 * o "carregar mais" — um `<a href="?limite=120#c-60">`, sem JavaScript —
 * devolver o leitor exatamente onde ele parou, em vez de jogá-lo no topo. Um
 * fragmento que não encontra elemento **não dá erro**: só não rola. É defeito
 * silencioso, e por isso a correspondência entre o `id` e a âncora é testada.
 */

import { CandidateCard } from "@/components/atoms/data/CandidateCard";
import { EtiquetasLinha } from "@/components/atoms/data/EtiquetasLinha";
import { EtiquetasAviso } from "@/components/blocks/EtiquetasAviso";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import type { ResolucoesExibiveis } from "@/lib/etiquetas/telas";

/**
 * Quantas células saem com `loading="eager"`.
 *
 * ~6 é o que cabe acima da dobra em desktop; abaixo disso o LCP espera uma
 * imagem preguiçosa, acima disso a rede fica ocupada com foto que ninguém vê.
 * Nenhuma delas usa `priority` — ver `<CandidateAvatar>`, bloco 4.
 */
export const CANDIDATOS_GRID_EAGER_CELLS = 6;

/**
 * Altura estimada de uma célula, para `contain-intrinsic-size`.
 *
 * A foto é 161×225 numa coluna de ~160px, mais nome, chip e número. É
 * estimativa declarada, não medição — e é exatamente para isso que a
 * propriedade serve: errar aqui custa um salto de barra de rolagem, não um
 * erro de layout.
 */
const CELULA_INTRINSIC_SIZE = "auto 320px";

/**
 * Quantas candidaturas por página.
 *
 * **60 fecha linha em toda largura.** A grade é `repeat(auto-fill,
 * minmax(140px, 1fr))`, que em 960px de `max-width` resolve para 6 colunas, em
 * tablet para 3 ou 4 e em 375px para 2. 60 é divisível por 2, 3, 4, 5 e 6:
 * nenhuma dessas larguras termina com uma linha órfã de um ou dois cartões, que
 * é o ruído visual que denuncia o corte antes de o texto explicá-lo.
 */
export const CANDIDATOS_POR_PAGINA = 60;

/**
 * Teto de sanidade do `?limite=`.
 *
 * **2.000.** O número não é redondo por estética: a maior corrida real medida é
 * cargo 6 em São Paulo, com 1.061 publicáveis (13/09), seguida de RJ 722 e MG
 * 720. 2.000 fica confortavelmente acima da maior — então "ver todas" funciona
 * de verdade em todo estado, sem truncar em silêncio — e ainda assim **limita**
 * o DOM a menos que o dobro da pior página de hoje. Sem teto, `?limite=999999999`
 * é um pedido que o servidor atende: ele não estoura nada no servidor, ele
 * monta o DOM absurdo no celular de quem clicou no link.
 *
 * Se uma corrida algum dia passar de 2.000, o corte continua **honesto**: o
 * texto abaixo da grade diz "mostrando 2.000 de N" com o N real. O teto limita
 * o que se desenha, nunca o que se conta.
 */
export const CANDIDATOS_LIMITE_MAX = 2_000;

/**
 * Lê `?limite=` degradando **fechado** para `CANDIDATOS_POR_PAGINA`.
 *
 * É o mesmo padrão que a rota já aplica a `?cargo=` e `?uf=` inválidos, e a
 * escolha é deliberada: entrada irreconhecível volta ao default, nunca abre a
 * lista inteira. `abc`, `-5`, `0`, `1.5`, `60abc` e vazio → 60.
 *
 * ⚠️ `Number.parseInt` está **fora de questão** aqui: `parseInt("60abc")` é 60,
 * o que aceitaria lixo em silêncio. O guarda é `^\d+$` sobre a string crua, e
 * ele também elimina `-5` e `+60` antes de qualquer conversão.
 *
 * Cadeia de dígitos longa demais vira `Infinity` na conversão e cai no teto —
 * que é o comportamento certo: `?limite=` com 400 noves é um pedido de "tudo",
 * não um pedido malformado.
 */
export function parseLimite(raw: string | string[] | undefined): number {
  const bruto = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!/^\d+$/.test(bruto)) return CANDIDATOS_POR_PAGINA;

  const n = Number(bruto);
  // `?limite=0` é pedido de nada; degradar para 60 é mais útil que uma grade
  // vazia que o leitor não sabe desfazer.
  if (n < 1) return CANDIDATOS_POR_PAGINA;
  return Math.min(n, CANDIDATOS_LIMITE_MAX);
}

/**
 * O `id` da célula de índice `i`, e o alvo do fragmento do "carregar mais".
 *
 * Uma função e não dois literais em lugares diferentes: o `id` do `<li>` e o
 * `#...` do `<a>` **têm** que ser a mesma string. Quando divergem, o navegador
 * não reclama — o link simplesmente não rola, e o leitor volta ao topo da
 * página achando que o produto está quebrado.
 */
export function ancoraCandidato(i: number): string {
  return `c-${i}`;
}

/** Ordem canônica — ver o bloco "Ordem" no cabeçalho. */
function porNumero(a: CandidatoIdentidade, b: CandidatoIdentidade): number {
  if (a.numero !== b.numero) return a.numero - b.numero;
  return a.sqcand.localeCompare(b.sqcand);
}

/**
 * Ordena por número de urna, sem mutar a entrada.
 *
 * Exportada porque **quem corta precisa ordenar antes**. Cortar os 60 primeiros
 * de uma lista na ordem de leitura do Blob entregaria 60 candidaturas
 * arbitrárias apresentadas como "as 60 primeiras por número" — critério
 * editorial acidental, que é o que a constituição § 2 proíbe. A grade continua
 * ordenando por conta própria (a operação é idempotente): o invariante dela não
 * passa a depender de o chamador ter lembrado.
 */
export function ordenarCandidatosPorNumero(
  candidatos: readonly CandidatoIdentidade[],
): readonly CandidatoIdentidade[] {
  return [...candidatos].sort(porNumero);
}

/** "1.061", "60", "1" — separador de milhar pt-BR, nunca `${n}` cru. */
export function formatarContagem(n: number): string {
  return n.toLocaleString("pt-BR");
}

export interface CandidatosGridProps {
  /**
   * A fatia já filtrada por cargo, UF e busca — e já **cortada**, quando o
   * chamador corta. Pode vir vazia.
   */
  candidatos: readonly CandidatoIdentidade[];
  /** Sigla da UF da fatia — `"BR"` em Presidente. Endereça a foto. */
  uf: string;
  /** Nome acessível da lista — ex. "Candidaturas a Deputado Federal na Bahia". */
  rotulo: string;
  /**
   * O que dizer quando não há nada a mostrar. Estado **nomeado**: o RF-147
   * proíbe tanto o 500 quanto a grade vazia em silêncio, e o chamador é quem
   * sabe se o vazio é "filtro sem resultado" ou "esta corrida não foi
   * publicada" — são notícias diferentes para o leitor (constituição § 8).
   */
  textoVazio: string;
  /**
   * O tamanho **real** da corrida, quando `candidatos` é uma fatia dela.
   *
   * Ausente = a lista recebida é a corrida inteira. Presente, é ele que a
   * contagem na tela exibe — nunca `candidatos.length`. Ver "Corte de exibição"
   * no cabeçalho: a tela jamais apresenta o número cortado como se fosse o
   * total.
   */
  total?: number;
  className?: string;
  /**
   * Spec 025 (RF-245) — etiquetas editoriais por `sqcand` (`etiquetasDaLista`),
   * sob o cartão. Ausente ou vazio ⇒ grade idêntica. Não muda a ordem (que é
   * o número na urna) nem o corte.
   */
  etiquetas?: ReadonlyMap<string, ResolucoesExibiveis>;
}

export function CandidatosGrid({
  candidatos,
  uf,
  rotulo,
  textoVazio,
  total,
  className,
  etiquetas,
}: CandidatosGridProps) {
  const ordenados = ordenarCandidatosPorNumero(candidatos);
  // O `??` aqui é o oposto do "default silencioso" que já mordeu este repo: a
  // ausência do prop significa literalmente "a lista É a corrida", e não um
  // palpite sobre um valor que faltou.
  const totalReal = total ?? ordenados.length;

  return (
    <div data-testid="candidatos-grid" className={className}>
      {/*
        A contagem sai de `totalReal`, nunca de constante e nunca do tamanho da
        FATIA (design 018 § D8: quatro frases da spec 017 viraram falsas de uma
        vez quando a granularidade mudou). `aria-live` porque o filtro é
        `<form method="get">`: em navegação com leitor de tela, a contagem é a
        confirmação de que o submit fez alguma coisa.
      */}
      <p
        data-testid="candidatos-grid-contagem"
        data-total={totalReal}
        aria-live="polite"
        style={{
          font: "var(--type-data)",
          color: "var(--text-secondary)",
          margin: "0 0 var(--space-3)",
        }}
      >
        {totalReal === 1 ? "1 candidatura" : `${formatarContagem(totalReal)} candidaturas`}
      </p>

      {ordenados.length === 0 ? (
        <p
          data-testid="candidatos-grid-vazio"
          style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0 }}
        >
          {textoVazio}
        </p>
      ) : (
        <ul
          aria-label={rotulo}
          data-testid="candidatos-grid-lista"
          className="grid list-none"
          style={{
            gap: "var(--space-5) var(--space-4)",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            margin: 0,
            padding: 0,
          }}
        >
          {ordenados.map((candidato, i) => (
            <li
              key={candidato.sqcand}
              // O alvo do fragmento do "carregar mais". `i` é índice GLOBAL
              // porque o corte é sempre um prefixo (`slice(0, limite)`) sobre a
              // lista já ordenada — a 61ª célula é `c-60` com limite 120, 600
              // ou 1.061.
              id={ancoraCandidato(i)}
              style={{ contentVisibility: "auto", containIntrinsicSize: CELULA_INTRINSIC_SIZE }}
            >
              <CandidateCard
                candidato={candidato}
                uf={uf}
                eager={i < CANDIDATOS_GRID_EAGER_CELLS}
              />
              {etiquetas?.has(candidato.sqcand) ? (
                <div
                  data-testid="candidatos-grid-etiquetas"
                  style={{ marginTop: "var(--space-1)" }}
                >
                  <EtiquetasLinha resolucoes={etiquetas.get(candidato.sqcand)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {/* Spec 025 (RF-248) — o aviso vai junto de toda superfície com etiqueta. */}
      {etiquetas && etiquetas.size > 0 && ordenados.some((c) => etiquetas.has(c.sqcand)) ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <EtiquetasAviso />
        </div>
      ) : null}
    </div>
  );
}
